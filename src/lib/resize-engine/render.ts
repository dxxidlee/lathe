/* render(master, size, fields) → Layout. Places every unit on the new artboard by its rules and
   fits every text field, flagging overflow.

   Placement, for a unit with master box B on a W0×H0 master and a W×H target:
   - the artboard scale s0 = min(W/W0, H/H0) ("contain"). A layer's size scale s is s0; `fixed`
     keeps s = 1; `scale:min-max` clamps s. Margins and offsets always scale by s0.
   - stretch-x / stretch-y keep the master margins (times s0) and fill the rest of that axis.
   - otherwise the box is B times s, placed by the position for the current breakpoint
     (`reflow:bp=…`), else `anchor:` (its distance from that edge, or offset from the centre,
     times s0), else at the same relative position as on the master (its centre at the same
     fraction of the artboard). A percent position (`reflow:wide=30/50`) puts its centre there.
   - `hide-below:px` drops the unit when the artboard's shorter side (or w / h) is smaller.
   - `tile` repeats the layer's content across its region (the clip's box, stretched, or the
     whole artboard) at s when it also has `scale`, else at its master size.
   Live text is laid out in output pixels, never through a non-uniform matrix: its box is the master
   text box carried through the unit's placement, and its size is the master size times the
   unit's uniform scale, then fitted (fit:shrink down to min, fit:wrap up to lines, fit:truncate). */
import { approxShaper } from './approx';
import { boxToBox, intersect, transformBox, union, type Box } from './matrix';
import { INHERITED } from './parse';
import type { FieldResult, FitStatus, Item, LayerNode, Layout, Master, Position, ResolvedFont, Rules, Shaper, Warning } from './types';

export interface Size { w: number; h: number }
/** A per-variant patch to one layer. Phase 1 stores these but does not apply them. */
export interface Override { layerId: string; patch: Record<string, unknown> }
export interface RenderOptions {
  /** Measures text; without one, an approximate average advance is used. */
  shaper?: Shaper;
  /** Smallest size fit:shrink goes to when the layer sets no min, as a fraction of its start size. */
  shrinkFloor?: number;
  ellipsis?: string;
  /** Not applied yet (Phase 1 stub). */
  overrides?: Override[];
}

const RANK: Record<FitStatus, number> = { fit: 0, wrapped: 1, shrunk: 2, truncated: 3, overflow: 4 };
type Axis = 'start' | 'center' | 'end' | 'rel' | { pct: number };

interface Indexed { node: LayerNode; parent: LayerNode | null }
const indexes = new WeakMap<Master, Map<string, Indexed>>();
function indexOf(master: Master) {
  let ix = indexes.get(master);
  if (!ix) {
    ix = new Map();
    const walk = (n: LayerNode, parent: LayerNode | null) => { ix!.set(n.id, { node: n, parent }); n.children.forEach(c => walk(c, n)); };
    walk(master.root, null);
    indexes.set(master, ix);
  }
  return ix;
}

export function breakpointFor(master: Master, size: Size): string | null {
  const a = size.w / size.h;
  return master.breakpoints.find(b => a >= (b.min ?? -Infinity) && a < (b.max ?? Infinity))?.id ?? null;
}

export function render(master: Master, size: Size, fields: Record<string, string> = {}, opts: RenderOptions = {}): Layout {
  const shaper = opts.shaper ?? approxShaper();
  const shrinkFloor = opts.shrinkFloor ?? 0.5, ellipsis = opts.ellipsis ?? '…';
  const W = Math.max(1, size.w), H = Math.max(1, size.h), W0 = master.width, H0 = master.height;
  const bp = breakpointFor(master, { w: W, h: H });
  const ix = indexOf(master);
  const units = new Set(master.units);
  const items: Item[] = [], hidden: string[] = [], warnings: Warning[] = [];
  const results: Record<string, FieldResult> = {};
  const fonts = new Map<string, ResolvedFont>();
  const fontFor = (n: LayerNode) => {
    const k = JSON.stringify(n.text!.font);
    let f = fonts.get(k);
    if (!f) {
      f = shaper.resolve(n.text!.font); fonts.set(k, f);
      if (!f.exact) warnings.push({ code: 'missing-font', layer: n.id, message: `${n.text!.font.postscript ?? n.text!.font.family} isn’t loaded; measured and drawn with ${f.css.replace(/^lr-/, '')} instead.` });
    }
    return f;
  };

  /* Master boxes, with live text measured by the shaper (parse only estimates it). */
  const boxes = new Map<string, Box | null>();
  const textBox = (n: LayerNode): Box => {
    const t = n.text!, f = fontFor(n), lines = t.content.split('\n');
    const w = Math.max(...lines.map(l => shaper.measure(f, l, t.fontSize, t.letterSpacing)));
    const x = t.align === 'middle' ? t.x - w / 2 : t.align === 'end' ? t.x - w : t.x;
    return { x, y: t.y - f.ascent * t.fontSize, w, h: (f.ascent + f.descent + (lines.length - 1) * t.lineHeight) * t.fontSize };
  };
  const content = (n: LayerNode): Box | null => n.kind === 'group' ? n.children.reduce<Box | null>((b, c) => union(b, box(c)), null) : n.kind === 'text' && !n.text!.rotated ? textBox(n) : n.bbox;
  function box(n: LayerNode): Box | null {
    if (!boxes.has(n.id)) boxes.set(n.id, n.clip ? intersect(content(n), n.clip.bbox) : content(n));
    return boxes.get(n.id)!;
  }

  /* Placement */
  const s0 = Math.min(W / W0, H / H0);
  const scaleFor = (r: Rules) => {
    let s = r.fixed ? 1 : s0;
    if (r.scale) s = Math.min(r.scale.max ?? Infinity, Math.max(r.scale.min ?? 0, s));
    return s;
  };
  const modes = (pos: Position | null): [Axis, Axis] => {
    if (!pos) return ['rel', 'rel'];
    if (typeof pos === 'object') return [{ pct: pos.x }, { pct: pos.y }];
    const v = pos === 'c' ? 'c' : pos[0], h = pos === 'c' ? 'c' : pos[1];
    const m = (c: string): Axis => c === 'l' || c === 't' ? 'start' : c === 'r' || c === 'b' ? 'end' : 'center';
    return [m(h), m(v)];
  };
  // Sizes scale by the layer's (clamped) scale; margins and offsets by the artboard's, so a layer
  // kept large on a thin banner still sits where the artboard puts it.
  const axis = (mode: Axis, b0: number, bw: number, L0: number, L: number, w: number) =>
    mode === 'start' ? b0 * s0 : mode === 'end' ? L - (L0 - b0 - bw) * s0 - w : mode === 'center' ? L / 2 + (b0 + bw / 2 - L0 / 2) * s0 - w / 2
      : mode === 'rel' ? (b0 + bw / 2) / L0 * L - w / 2 : mode.pct / 100 * L - w / 2;
  const positionOf = (r: Rules): Position | null => (bp && r.reflow?.[bp]) || r.anchor || null;
  function place(B: Box, r: Rules): { box: Box; s: number } {
    const s = scaleFor(r);
    const [hm, vm] = modes(positionOf(r));
    let x: number, y: number, w: number, h: number;
    if (r.stretchX) { x = B.x * s0; w = Math.max(1, W - (B.x + (W0 - B.x - B.w)) * s0); } else { w = B.w * s; x = axis(hm, B.x, B.w, W0, W, w); }
    if (r.stretchY) { y = B.y * s0; h = Math.max(1, H - (B.y + (H0 - B.y - B.h)) * s0); } else { h = B.h * s; y = axis(vm, B.y, B.h, H0, H, h); }
    return { box: { x, y, w, h }, s };
  }
  const isHidden = (r: Rules) => !!r.hideBelow && (r.hideBelow.axis === 'w' ? W : r.hideBelow.axis === 'h' ? H : Math.min(W, H)) < r.hideBelow.px;
  const inherited = (n: LayerNode) => {
    const chain: LayerNode[] = [];
    for (let p = ix.get(n.id)?.parent ?? null; p; p = ix.get(p.id)?.parent ?? null) chain.unshift(p);
    const out: Record<string, string> = {};
    for (const a of chain) for (const k of INHERITED) if (a.attrs[k] != null) out[k] = a.attrs[k];
    return out;
  };
  const ancestorHidden = (n: LayerNode) => { for (let p = ix.get(n.id)?.parent ?? null; p; p = ix.get(p.id)?.parent ?? null) if (hidden.includes(p.id)) return true; return false; };

  /* Text */
  function textItem(n: LayerNode, bx: Box, k: number, valign: Axis): Item {
    const t = n.text!, font = fontFor(n), r = n.rules;
    const field = r.text ?? null;
    const value = field ? (fields[field] ?? master.fields.find(f => f.id === field)?.value ?? t.content) : t.content;
    const fit = r.fit ?? [], wrap = fit.includes('wrap'), shrink = fit.includes('shrink'), trunc = fit.includes('truncate');
    const paras = value.split(/\r?\n/).map(p => p.replace(/\s+/g, ' ').trim());
    const maxLines = r.lines ?? (wrap ? Infinity : paras.length);
    const lsEm = t.fontSize ? t.letterSpacing / t.fontSize : 0;
    const width = (s: string, size: number) => shaper.measure(font, s, size, lsEm * size);
    const breakLines = (p: string, size: number) => {
      const out: string[] = []; let cur = '';
      for (const word of p.split(' ')) {
        const cand = cur ? `${cur} ${word}` : word;
        if (!cur || width(cand, size) <= bx.w + 0.01) cur = cand; else { out.push(cur); cur = word; }
      }
      out.push(cur);
      return out;
    };
    const lay = (size: number, lines = wrap ? paras.flatMap(p => breakLines(p, size)) : paras) => ({ lines, w: Math.max(0, ...lines.map(l => width(l, size))) });
    const where = (size: number, lines: string[], w: number) => {
      const x = t.align === 'middle' ? bx.x + bx.w / 2 : t.align === 'end' ? bx.x + bx.w : bx.x;
      const left = t.align === 'middle' ? x - w / 2 : t.align === 'end' ? x - w : x;
      const blockH = (font.ascent + font.descent + (lines.length - 1) * t.lineHeight) * size;
      const top = valign === 'end' ? bx.y + bx.h - blockH : valign === 'center' ? bx.y + (bx.h - blockH) / 2 : bx.y;
      return { x, y: top + font.ascent * size, inside: left >= -0.5 && left + w <= W + 0.5 && top >= -0.5 && top + blockH <= H + 0.5 };
    };
    const fits = (size: number, L = lay(size)) => L.w <= bx.w + 0.5 && L.lines.length <= maxLines && where(size, L.lines, L.w).inside;

    let size = t.fontSize * k;
    if (r.min && size < r.min) size = r.min;
    const floor = Math.min(size, r.min ?? size * shrinkFloor);
    let status: FitStatus = 'fit';
    let L = lay(size);
    if (!fits(size, L)) {
      if (shrink && size > floor) {
        if (fits(floor)) {
          let lo = floor, hi = size;
          for (let i = 0; i < 16 && hi - lo > 0.05; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
          size = lo; L = lay(size); status = 'shrunk';
        } else { size = floor; L = lay(size); status = 'overflow'; }
      } else status = 'overflow';
      if (status === 'overflow' && trunc) {
        const cut = (s: string) => {
          if (width(s, size) <= bx.w) return s;
          let lo = 0, hi = s.length;
          while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (width(s.slice(0, mid).trimEnd() + ellipsis, size) <= bx.w) lo = mid; else hi = mid - 1; }
          return s.slice(0, lo).trimEnd() + ellipsis;
        };
        const n = Number.isFinite(maxLines) ? maxLines : L.lines.length;
        let lines = L.lines.slice(0, n);
        if (L.lines.length > n) lines[n - 1] = `${lines[n - 1]} ${L.lines.slice(n).join(' ')}`;
        lines = lines.map(cut);
        L = lay(size, lines);
        status = where(size, L.lines, L.w).inside ? 'truncated' : 'overflow';
      }
    } else if (L.lines.length > paras.length) status = 'wrapped';
    const pos = where(size, L.lines, L.w);
    if (field) {
      const prev = results[field];
      const res: FieldResult = { overflow: status === 'overflow', truncated: status === 'truncated', status, fontSize: size, lines: L.lines.length, layers: [n.id] };
      results[field] = !prev ? res : { ...(RANK[status] > RANK[prev.status] ? res : prev), overflow: prev.overflow || res.overflow, truncated: prev.truncated || res.truncated, fontSize: Math.min(prev.fontSize, size), layers: [...prev.layers, n.id] };
    }
    return { type: 'text', id: n.id, node: n, field, lines: L.lines, x: pos.x, y: pos.y, align: t.align, fontSize: size, lineHeight: t.lineHeight * size,
      font, fill: t.fill, letterSpacing: lsEm * size, box: bx, status };
  }

  /* Units, in paint order */
  for (const id of master.units) {
    const n = ix.get(id)?.node;
    if (!n) continue;
    if (isHidden(n.rules) || ancestorHidden(n)) { hidden.push(id); continue; }
    if (n.rules.tile) {
      // The cell is the content's box ignoring clips; the region is the clip's box (on the layer,
      // or on its one child, as Illustrator writes clip groups), else the whole artboard.
      const raw = (c: LayerNode): Box | null => c.kind === 'group' ? c.children.reduce<Box | null>((b, x) => union(b, raw(x)), null) : c.kind === 'text' && !c.text!.rotated ? textBox(c) : c.bbox;
      const cell = raw(n);
      if (!cell || cell.w <= 0 || cell.h <= 0) continue;
      const clip = n.clip?.bbox ?? (n.children.length === 1 ? n.children[0].clip?.bbox : null) ?? { x: 0, y: 0, w: W0, h: H0 };
      const region = place(clip, { ...n.rules, stretchX: true, stretchY: true });
      items.push({ type: 'tile', id, node: n, region: region.box, cell, scale: n.rules.scale ? scaleFor(n.rules) : 1, inherit: inherited(n) });
      continue;
    }
    const B = box(n);
    if (!B) continue;
    const { box: T, s } = place(B, n.rules);
    const vmode = modes(positionOf(n.rules))[1];
    if (n.kind === 'text' && !n.text!.rotated) { items.push(textItem(n, T, s, vmode === 'rel' ? 'start' : vmode)); continue; }
    const V = boxToBox(B, T);
    const skip: string[] = [], texts: Item[] = [];
    const k = Math.min(Math.abs(V[0]), Math.abs(V[3]));
    const scan = (c: LayerNode) => {
      if (units.has(c.id)) { skip.push(c.id); return; }
      if (c.kind === 'text' && !c.text!.rotated) {
        skip.push(c.id);
        const tb = box(c);
        if (tb) { const own = modes(positionOf(c.rules))[1]; texts.push(textItem(c, transformBox(V, tb), k, own === 'rel' ? 'start' : own)); }
        return;
      }
      c.children.forEach(scan);
    };
    n.children.forEach(scan);
    items.push({ type: 'unit', id, node: n, matrix: V, skip, inherit: inherited(n) }, ...texts);
  }

  return { width: W, height: H, breakpoint: bp, items, fields: results, overflow: Object.values(results).some(r => r.overflow), hidden, defs: master.defs, warnings };
}
