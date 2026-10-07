/* tokens-exempt: reads SVG file content (colors and sizes here are the file's data).
   parse(svg) → Master. Reads an Illustrator SVG into a layer tree with stable ids: class styles
   inlined, every transform flattened into each node's absolute matrix, clip groups resolved to
   absolute clip shapes, live text kept as text (and a warning when a bound layer holds outlines),
   rules read from layer names, and the layout units picked out. */
import { decodeIllustratorId, parseLayerName, placesItself, slug } from './names';
import { segmentsBox, shapeSegments } from './geometry';
import { apply, axisAligned, intersect, mul, parseTransform, scaleOf, translate, union, type Box, type M } from './matrix';
import type { Breakpoint, Clip, ClipShape, Field, FontRequest, LayerNode, Master, TextInfo, Warning } from './types';
import { elements, local, parseXml, serialize, textOf, type XEl, type XNode } from './xml';

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [{ id: 'square', max: 1.5 }, { id: 'wide', min: 1.5, max: 4 }, { id: 'ultrawide', min: 4 }];
export interface ParseOptions {
  /** Line advance for single-line text, as a multiple of the font size. */
  lineHeight?: number;
  /** Used when the file has no `breakpoints [...]` layer. */
  breakpoints?: Breakpoint[];
  /** Average advance per character, in em, for boxes estimated before fonts are measured. */
  estimateAdvance?: number;
}

const DEF_TAGS = new Set(['linearGradient', 'radialGradient', 'pattern', 'filter', 'mask', 'symbol', 'marker']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const GROUPS = new Set(['g', 'svg', 'a']);
const TEXT_PROPS = ['fill', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor'];
/** Properties a child inherits; a unit keeps its ancestors' values when drawn on its own. */
export const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-opacity', 'color', ...TEXT_PROPS.slice(1)];
const DROP = new Set(['id', 'class', 'style', 'transform', 'data-name', 'clip-path', 'xml:space', 'enable-background']);
const WEIGHTS: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold|heavy/i, 800], [/black/i, 900], [/bold/i, 700], [/medium/i, 500]];

const decls = (s: string | undefined) => {
  const out: Record<string, string> = {};
  for (const d of (s ?? '').split(';')) { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  return out;
};

export function parse(svg: string, opts: ParseOptions = {}): Master {
  const rootEl = parseXml(svg);
  if (local(rootEl.tag) !== 'svg') throw new Error(`Not an SVG: the file starts with <${rootEl.tag}>`);
  const adv = opts.estimateAdvance ?? 0.55, lh1 = opts.lineHeight ?? 1.2;
  const warnings: Warning[] = [];

  /* class styles from every <style> block (`.cls-1, .cls-2 { fill: #fff; }`) */
  const classes = new Map<string, Record<string, string>>();
  const byId = new Map<string, XEl>();
  (function scan(el: XEl) {
    if (el.attrs.id) byId.set(el.attrs.id, el);
    if (local(el.tag) === 'style') {
      for (const r of textOf(el).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const d = decls(r[2]);
        for (const sel of r[1].split(',').map(s => s.trim())) if (/^\.[\w-]+$/.test(sel)) classes.set(sel.slice(1), { ...classes.get(sel.slice(1)), ...d });
      }
    }
    elements(el).forEach(scan);
  })(rootEl);
  /** Attributes with class rules and the style attribute applied (CSS beats presentation attributes). */
  const styled = (el: XEl): Record<string, string> => {
    const out = { ...el.attrs };
    for (const c of (el.attrs.class ?? '').split(/\s+/)) Object.assign(out, classes.get(c));
    Object.assign(out, decls(el.attrs.style));
    return out;
  };
  const own = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).filter(([k]) => !DROP.has(k) && !k.startsWith('data-') && !k.startsWith('i:')));
  /** An element serialized with its classes inlined, ids kept (for defs). */
  const inline = (n: XNode): XNode => typeof n === 'string' ? n : {
    tag: n.tag, attrs: Object.fromEntries(Object.entries(styled(n)).filter(([k]) => k !== 'class' && k !== 'style' && k !== 'data-name')), children: n.children.map(inline),
  };

  /* artboard */
  const vb = (rootEl.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  let W: number, H: number, ox = 0, oy = 0;
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) [ox, oy, W, H] = vb;
  else {
    W = parseFloat(rootEl.attrs.width ?? '') || 0; H = parseFloat(rootEl.attrs.height ?? '') || 0;
    warnings.push({ code: 'no-viewbox', message: `No viewBox; using width and height (${W}×${H}).` });
  }
  if (!(W > 0 && H > 0)) throw new Error('The SVG has no size: give it a viewBox');
  const base: M = translate(-ox, -oy);

  const defs: string[] = [];
  let breakpoints: Breakpoint[] | null = null;
  const used = new Set<string>();
  const makeId = (name: string | null, tag: string, path: string) => {
    const b = (name && slug(name)) || `${tag}-${path}`;
    let id = b; for (let k = 2; used.has(id); k++) id = `${b}-${k}`;
    used.add(id); return id;
  };

  /** Box of a referenced element (for <use>) under a matrix. */
  const refBox = (el: XEl, m: M): Box | null => {
    const tag = local(el.tag), mm = mul(m, parseTransform(el.attrs.transform));
    if (GROUPS.has(tag) || tag === 'symbol') return elements(el).reduce<Box | null>((b, c) => union(b, refBox(c, mm)), null);
    return segmentsBox(shapeSegments(tag, styled(el)), mm);
  };
  const href = (el: XEl) => (el.attrs['xlink:href'] ?? el.attrs.href ?? '').replace(/^#/, '');

  function resolveClip(v: string | undefined, m: M): Clip | null {
    const id = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(v ?? '')?.[1];
    const cp = id ? byId.get(id) : undefined;
    if (!cp) return null;
    const shapes: ClipShape[] = [];
    const add = (el: XEl, mm: M) => {
      const tag = local(el.tag);
      if (tag === 'use') { const ref = byId.get(href(el)); if (ref) add(ref, mul(mul(mm, parseTransform(el.attrs.transform)), translate(parseFloat(el.attrs.x ?? '0') || 0, parseFloat(el.attrs.y ?? '0') || 0))); return; }
      const m2 = mul(mm, parseTransform(el.attrs.transform));
      if (GROUPS.has(tag)) { elements(el).forEach(c => add(c, m2)); return; }
      if (SHAPES.has(tag)) shapes.push({ tag, attrs: own(styled(el)), matrix: m2 });
    };
    const cm = mul(m, parseTransform(cp.attrs.transform));
    elements(cp).forEach(c => add(c, cm));
    return { shapes, bbox: shapes.reduce<Box | null>((b, s) => union(b, segmentsBox(shapeSegments(s.tag, s.attrs), s.matrix)), null) };
  }

  function readText(el: XEl, a: Record<string, string>, inh: Record<string, string>, m: M): TextInfo {
    const st: Record<string, string> = { ...inh };
    for (const k of TEXT_PROPS) if (a[k] != null) st[k] = a[k];
    const firstSpan = elements(el).find(c => local(c.tag) === 'tspan');
    if (firstSpan) { const fs = styled(firstSpan); for (const k of TEXT_PROPS) if (fs[k] != null && a[k] == null) st[k] = fs[k]; }
    // Lines: spans grouped by their y (Illustrator splits kerned runs into tspans on one baseline).
    const lines: { y: number; x: number; text: string }[] = [];
    let curY = parseFloat(el.attrs.y ?? '0') || 0, curX = parseFloat(el.attrs.x ?? '0') || 0;
    const push = (text: string, x?: string, y?: string) => {
      const ny = y != null ? parseFloat(y) || 0 : curY;
      if (!lines.length || Math.abs(ny - curY) > 1e-6) lines.push({ y: ny, x: x != null ? parseFloat(x) || 0 : curX, text: '' });
      curY = ny; if (x != null) curX = parseFloat(x) || 0;
      lines[lines.length - 1].text += text;
    };
    for (const c of el.children) {
      if (typeof c === 'string') { if (c.trim()) push(c, el.attrs.x, el.attrs.y); continue; }
      if (local(c.tag) === 'tspan') push(textOf(c), c.attrs.x, c.attrs.y);
    }
    const clean = lines.map(l => l.text.replace(/\s+/g, ' ').trim());
    const k = scaleOf(m);
    const size0 = parseFloat(st['font-size'] ?? '16') || 16;
    const fontSize = size0 * k;
    const lineHeight = lines.length > 1 ? Math.abs(lines[1].y - lines[0].y) / size0 : lh1;
    const [x, y] = apply(m, lines[0]?.x ?? 0, lines[0]?.y ?? 0);
    const ls = st['letter-spacing'];
    const letterSpacing = !ls || ls === 'normal' ? 0 : /em$/.test(ls) ? parseFloat(ls) * fontSize : (parseFloat(ls) || 0) * k;
    const anchor = st['text-anchor'];
    return {
      content: clean.join('\n'), font: fontRequest(st), fontSize, lineHeight, x, y,
      align: anchor === 'middle' || anchor === 'end' ? anchor : 'start',
      fill: st.fill ?? '#000000', letterSpacing,
      rotated: !axisAligned(m) || Math.abs(Math.abs(m[0]) - Math.abs(m[3])) > 1e-6 * Math.abs(m[0]) || m[0] < 0 || m[3] < 0,
      inner: el.children.map(c => serialize(inline(c))).join(''),
    };
  }
  const estimateBox = (t: TextInfo): Box => {
    const n = t.content.split('\n');
    const w = Math.max(...n.map(l => l.length)) * adv * t.fontSize;
    const x = t.align === 'middle' ? t.x - w / 2 : t.align === 'end' ? t.x - w : t.x;
    return { x, y: t.y - 0.8 * t.fontSize, w, h: (1 + (n.length - 1) * t.lineHeight) * t.fontSize };
  };

  function walk(el: XEl, parentM: M, inh: Record<string, string>, path: string): LayerNode | null {
    const tag = local(el.tag);
    if (tag === 'defs') { for (const c of elements(el)) if (local(c.tag) !== 'clipPath') defs.push(serialize(inline(c))); return null; }
    if (DEF_TAGS.has(tag)) { defs.push(serialize(inline(el))); return null; }
    if (tag === 'switch') { const c = elements(el).find(x => local(x.tag) !== 'foreignObject'); return c ? walk(c, parentM, inh, path) : null; }
    if (el.tag.includes(':') && !el.tag.startsWith('svg:')) return null; // Illustrator's private data (i:pgf and the like)
    if (!GROUPS.has(tag) && !SHAPES.has(tag) && tag !== 'text' && tag !== 'image' && tag !== 'use') return null;
    const a = styled(el);
    if (a.display === 'none' || a.visibility === 'hidden') return null;
    const m = mul(parentM, parseTransform(el.attrs.transform));
    const rawName = el.attrs['data-name'] ?? (el.attrs.id ? decodeIllustratorId(el.attrs.id) : null);
    const pn = rawName ? parseLayerName(rawName) : null;
    if (pn?.breakpoints) { breakpoints = pn.breakpoints; return null; }
    const id = makeId(pn?.base ?? null, tag, path);
    if (pn?.unknown.length) warnings.push({ code: 'unknown-rule', layer: id, message: `“${pn.base}”: unknown rule${pn.unknown.length > 1 ? 's' : ''} ${pn.unknown.map(u => `“${u}”`).join(', ')} ignored.` });
    if (a.mask) warnings.push({ code: 'mask', layer: id, message: `“${pn?.base ?? id}” uses a mask, which resizing may misplace.` });
    const node: LayerNode = { id, name: pn?.base ?? null, rules: pn?.rules ?? {}, kind: 'shape', tag, attrs: own(a), matrix: m, bbox: null, children: [], clip: resolveClip(a['clip-path'], m), text: null };
    if (GROUPS.has(tag)) {
      node.kind = 'group'; node.tag = 'g';
      const next = { ...inh }; for (const k of TEXT_PROPS) if (a[k] != null) next[k] = a[k];
      elements(el).forEach((c, i) => { const ch = walk(c, m, next, path ? `${path}.${i}` : String(i)); if (ch) node.children.push(ch); });
      if (!node.children.length) { used.delete(id); return null; }
      node.bbox = node.children.reduce<Box | null>((b, c) => union(b, c.bbox), null);
    } else if (tag === 'text') {
      node.kind = 'text';
      node.text = readText(el, a, inh, m);
      if (!node.text.content) { used.delete(id); return null; }
      node.bbox = node.text.rotated ? null : estimateBox(node.text);
      if (node.text.rotated) {
        const lb = estimateBox({ ...node.text, x: 0, y: 0, fontSize: node.text.fontSize / scaleOf(m) });
        node.bbox = segmentsBox(shapeSegments('rect', { x: String(lb.x), y: String(lb.y), width: String(lb.w), height: String(lb.h) }), m);
        if (node.rules.text) warnings.push({ code: 'rotated-text', layer: id, message: `“${node.name ?? id}” is rotated or skewed, so it is drawn as is and not refit.` });
      }
    } else if (tag === 'use') {
      const ref = byId.get(href(el));
      node.bbox = ref ? refBox(ref, mul(m, translate(parseFloat(a.x ?? '0') || 0, parseFloat(a.y ?? '0') || 0))) : null;
    } else {
      node.kind = tag === 'image' ? 'image' : 'shape';
      node.bbox = segmentsBox(shapeSegments(tag, a), m);
    }
    if (node.clip) node.bbox = intersect(node.bbox, node.clip.bbox);
    return node;
  }

  const rootAttrs = styled(rootEl);
  const rootInh: Record<string, string> = {}; for (const k of TEXT_PROPS) if (rootAttrs[k] != null) rootInh[k] = rootAttrs[k];
  const root: LayerNode = { id: 'root', name: null, rules: {}, kind: 'group', tag: 'g', attrs: Object.fromEntries(INHERITED.filter(k => rootAttrs[k] != null).map(k => [k, rootAttrs[k]])), matrix: base, bbox: null, children: [], clip: null, text: null };
  used.add('root');
  elements(rootEl).forEach((c, i) => { const n = walk(c, base, rootInh, String(i)); if (n) root.children.push(n); });
  root.bbox = { x: 0, y: 0, w: W, h: H };

  /* Layout units. An unnamed top-level group that is an Illustrator layer (named "Layer …", the only
     group, or covering most of the artboard) is a container: its children are placed one by one.
     Inside a unit, any descendant with placing rules is placed on its own as well. */
  const units: string[] = [];
  const topGroups = root.children.filter(c => c.kind === 'group');
  const isContainer = (n: LayerNode) => n.kind === 'group' && !Object.keys(n.rules).length && !n.clip && !n.attrs.opacity && !n.attrs.filter && !n.attrs.mask &&
    (/^layer\b/i.test(n.name ?? '') || topGroups.length === 1 || (n.bbox ? n.bbox.w * n.bbox.h >= 0.8 * W * H : false));
  const nested = (n: LayerNode) => { for (const c of n.children) { if (placesItself(c.rules)) units.push(c.id); nested(c); } };
  for (const c of root.children) {
    if (isContainer(c)) { for (const g of c.children) { units.push(g.id); nested(g); } }
    else { units.push(c.id); nested(c); }
  }
  if (!units.length) warnings.push({ code: 'empty', message: 'Nothing to lay out: the SVG has no visible shapes, images or text.' });

  /* Fields, fonts, outlined text */
  const fields: Field[] = [];
  const fonts = new Map<string, FontRequest>();
  (function scan(n: LayerNode) {
    if (n.rules.text) {
      if (n.kind !== 'text') warnings.push({ code: 'outlined-text', layer: n.id, message: `“${n.name ?? n.id}” is bound to the field “${n.rules.text}” but holds no live text (outlined?). Export it with live text to make it editable.` });
      else {
        const f = fields.find(x => x.id === n.rules.text);
        if (f) f.layers.push(n.id);
        else fields.push({ id: n.rules.text, label: n.rules.text.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()), value: n.text!.content, layers: [n.id], fit: n.rules.fit ?? [], min: n.rules.min, lines: n.rules.lines });
      }
    }
    if (n.text) fonts.set(JSON.stringify(n.text.font), n.text.font);
    n.children.forEach(scan);
  })(root);

  return { version: 1, width: W, height: H, root, units, fields, breakpoints: breakpoints ?? opts.breakpoints ?? DEFAULT_BREAKPOINTS, defs: defs.join(''), fonts: [...fonts.values()], warnings };
}

/** `font-family: Inter-Bold, Inter` (Illustrator: PostScript name, then family) to a request. */
export function fontRequest(st: Record<string, string>): FontRequest {
  const toks = (st['font-family'] ?? 'sans-serif').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const ps = toks.length > 1 || /-/.test(toks[0]) && !/\s/.test(toks[0]) ? toks[0] : null;
  const family = toks.length > 1 ? toks[1] : ps ? ps.replace(/-.*$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : toks[0];
  const fw = st['font-weight'];
  const weight = fw && /^\d+$/.test(fw) ? Number(fw) : fw === 'bold' ? 700 : fw === 'normal' ? 400
    : WEIGHTS.find(([re]) => re.test(ps?.replace(/^[^-]*/, '') ?? ''))?.[1] ?? 400;
  const style = st['font-style'] === 'italic' || st['font-style'] === 'oblique' || /italic|oblique/i.test(ps?.replace(/^[^-]*/, '') ?? '') ? 'italic' : 'normal';
  return { family, postscript: ps, weight, style };
}
