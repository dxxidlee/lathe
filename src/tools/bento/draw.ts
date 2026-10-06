/* tokens-exempt: deck artwork (exported slide content), not Lathe's interface.

   Drawing model: a slide becomes rects, images and pre-wrapped text in inches. The preview and
   every export (SVG, PNG, PDF, PPTX) render from this one list, so they agree. */
import { COLS, ROWS, creditLine, uid, type Credit, type Deck, type Slide, type Tile } from './model';

export interface DrawConfig {
  slideW: number; slideH: number; margin: number; gutter: number; pad: number;
  sizes: { display: number; title: number; body: number; caption: number; stat: number; statLabel: number; hex: number };
  font: string; showCaptions: boolean;
}

export interface Theme { bg: string; fg: string; muted: string; tile: string; accent: string; onAccent: string; line: string }
/* The brand's three colors; tile fills are white or black at 8% flattened to solid hex, since PPTX
   and PDF fills need solid colors. */
export const THEMES: Record<Deck['theme'], Theme> = {
  dark: { bg: '#000000', fg: '#FFFFFF', muted: '#A3A3A3', tile: '#141414', accent: '#E8FF1A', onAccent: '#000000', line: '#292929' },
  light: { bg: '#FFFFFF', fg: '#000000', muted: '#5C5C5C', tile: '#EBEBEB', accent: '#E8FF1A', onAccent: '#000000', line: '#D6D6D6' },
};

export type Prim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'image'; x: number; y: number; w: number; h: number; src: string; thumb?: string; fit: 'cover' | 'contain'; aspect?: number; tileId: string }
  | { kind: 'text'; x: number; y: number; w: number; h: number; text: string; lines: string[]; size: number; weight: 400 | 500 | 700;
      color: string; align: 'left' | 'center'; valign: 'top' | 'middle' | 'bottom'; lineHeight: number; tracking: number; tileId?: string };

export interface SlideDrawing { bg: string; prims: Prim[]; tileBoxes: { id: string; x: number; y: number; w: number; h: number }[] }

/* ---- text measurement (canvas), shared by every renderer ---- */
const PT_TO_IN = 1 / 72;
let mctx: CanvasRenderingContext2D | null = null;
function measure(text: string, sizePt: number, weight: number, font: string): number {
  mctx ??= document.createElement('canvas').getContext('2d')!;
  mctx.font = `${weight} ${sizePt}px ${font}`;
  return mctx.measureText(text).width * PT_TO_IN; // inches, since size is in pt
}

/** Wrap to width (inches), keep at most maxLines, ellipsize the last one. */
export function wrap(text: string, sizePt: number, weight: number, font: string, width: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next, sizePt, weight, font) <= width || !line) line = next;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, Math.max(1, maxLines));
    let last = kept[kept.length - 1] + '…';
    while (last.length > 1 && measure(last, sizePt, weight, font) > width) last = last.slice(0, -2) + '…';
    kept[kept.length - 1] = last;
    return kept;
  }
  // a single overlong word: hard-truncate
  return out.map(l => { let s = l; while (s.length > 1 && measure(s, sizePt, weight, font) > width) s = s.slice(0, -2) + '…'; return s; });
}

/* ---- geometry ---- */
export function cellBox(cfg: DrawConfig, r: { x: number; y: number; w: number; h: number }) {
  const cw = (cfg.slideW - 2 * cfg.margin - (COLS - 1) * cfg.gutter) / COLS;
  const ch = (cfg.slideH - 2 * cfg.margin - (ROWS - 1) * cfg.gutter) / ROWS;
  return {
    x: cfg.margin + r.x * (cw + cfg.gutter), y: cfg.margin + r.y * (ch + cfg.gutter),
    w: r.w * cw + (r.w - 1) * cfg.gutter, h: r.h * ch + (r.h - 1) * cfg.gutter,
  };
}

function textPrim(cfg: DrawConfig, o: Omit<Extract<Prim, { kind: 'text' }>, 'kind' | 'lines' | 'lineHeight' | 'tracking'> & { lineHeight?: number; tracking?: number; maxLines?: number }): Prim {
  const lh = o.lineHeight ?? 1.15;
  const maxLines = o.maxLines ?? Math.max(1, Math.floor(o.h / (o.size * PT_TO_IN * lh)));
  return { kind: 'text', ...o, lineHeight: lh, tracking: o.tracking ?? 0, lines: wrap(o.text, o.size, o.weight, cfg.font, o.w, maxLines) };
}

function drawTile(t: Tile, cfg: DrawConfig, th: Theme): Prim[] {
  const b = cellBox(cfg, t.rect!);
  const p = cfg.pad, s = cfg.sizes;
  const out: Prim[] = [];
  switch (t.type) {
    case 'image': {
      const cap = cfg.showCaptions && t.caption !== false && t.credit;
      const capH = cap ? s.caption * PT_TO_IN * 1.3 + 0.08 : 0;
      out.push({ kind: 'image', x: b.x, y: b.y, w: b.w, h: b.h - capH, src: t.src!, thumb: t.thumb, fit: t.fit ?? 'cover', aspect: t.aspect, tileId: t.id });
      if (cap) out.push(textPrim(cfg, { x: b.x, y: b.y + b.h - capH + 0.06, w: b.w, h: capH - 0.06, text: creditLine(t.credit!), size: s.caption, weight: 400, color: th.muted, align: 'left', valign: 'top', maxLines: 1 }));
      break;
    }
    case 'logo': {
      out.push({ kind: 'rect', ...b, fill: t.fill ?? th.tile });
      const inset = Math.min(b.w, b.h) * 0.12;
      out.push({ kind: 'image', x: b.x + inset, y: b.y + inset, w: b.w - 2 * inset, h: b.h - 2 * inset, src: t.src!, thumb: t.thumb, fit: 'contain', aspect: t.aspect, tileId: t.id });
      break;
    }
    case 'palette': {
      const cols = t.colors?.length ? t.colors : ['#808080'];
      const labels = t.hexLabels !== false;
      const labelH = labels ? s.hex * PT_TO_IN * 1.4 + 0.06 : 0, gap = 0.06;
      const vertical = b.w / b.h < 1;
      if (vertical) {
        const rh = (b.h - gap * (cols.length - 1)) / cols.length;
        cols.forEach((c, i) => {
          const y = b.y + i * (rh + gap);
          out.push({ kind: 'rect', x: b.x, y, w: labels ? b.w * 0.62 : b.w, h: rh, fill: c });
          if (labels) out.push(textPrim(cfg, { x: b.x + b.w * 0.62 + 0.08, y: y + rh / 2 - s.hex * PT_TO_IN * 0.6, w: b.w * 0.38 - 0.08, h: s.hex * PT_TO_IN * 1.3, text: c.toUpperCase(), size: s.hex, weight: 400, color: th.fg, align: 'left', valign: 'top', maxLines: 1 }));
        });
      } else {
        const sw = (b.w - gap * (cols.length - 1)) / cols.length;
        cols.forEach((c, i) => {
          const x = b.x + i * (sw + gap);
          out.push({ kind: 'rect', x, y: b.y, w: sw, h: b.h - labelH, fill: c });
          if (labels) out.push(textPrim(cfg, { x, y: b.y + b.h - labelH + 0.06, w: sw, h: labelH - 0.06, text: c.toUpperCase(), size: s.hex, weight: 400, color: th.fg, align: 'left', valign: 'top', maxLines: 1 }));
        });
      }
      break;
    }
    case 'hexlist': {
      out.push({ kind: 'rect', ...b, fill: th.tile });
      const cols = t.colors ?? [];
      const rowH = Math.min(0.42, (b.h - 2 * p) / Math.max(1, cols.length));
      const chip = Math.min(rowH * 0.7, 0.28);
      cols.slice(0, Math.floor((b.h - 2 * p) / rowH)).forEach((c, i) => {
        const y = b.y + p + i * rowH;
        out.push({ kind: 'rect', x: b.x + p, y: y + (rowH - chip) / 2, w: chip, h: chip, fill: c });
        out.push(textPrim(cfg, { x: b.x + p + chip + 0.12, y: y + (rowH - s.hex * PT_TO_IN * 1.2) / 2, w: b.w - 2 * p - chip - 0.12, h: s.hex * PT_TO_IN * 1.3, text: c.toUpperCase(), size: s.hex, weight: 400, color: th.fg, align: 'left', valign: 'top', maxLines: 1 }));
      });
      break;
    }
    case 'type': {
      out.push({ kind: 'rect', ...b, fill: th.tile });
      const big = Math.min(160, (b.h - 2 * p) * 0.5 * 72, (b.w - 2 * p) * 0.42 * 72);
      out.push(textPrim(cfg, { x: b.x + p, y: b.y + p, w: b.w - 2 * p, h: big * PT_TO_IN * 1.1, text: 'Aa', size: big, weight: 500, color: th.fg, align: 'left', valign: 'top', tracking: -0.02, maxLines: 1 }));
      const rest = b.h - 2 * p - big * PT_TO_IN * 1.1;
      out.push(textPrim(cfg, { x: b.x + p, y: b.y + b.h - p - Math.min(rest, s.body * PT_TO_IN * 3.6), w: b.w - 2 * p, h: Math.min(rest, s.body * PT_TO_IN * 3.6), text: `${t.family || 'Helvetica Neue'}\n${t.sample || 'Every default was someone else’s decision.'}`, size: s.body, weight: 400, color: th.muted, align: 'left', valign: 'bottom' }));
      break;
    }
    case 'text': {
      const role = t.role ?? 'body';
      const size = s[role];
      const filled = role !== 'display';
      if (filled) out.push({ kind: 'rect', ...b, fill: th.tile });
      const inner = filled ? p : 0;
      out.push(textPrim(cfg, {
        x: b.x + inner, y: b.y + inner, w: b.w - 2 * inner, h: b.h - 2 * inner, text: t.text || '', size,
        weight: role === 'display' || role === 'title' ? 500 : 400, color: th.fg, align: 'left',
        valign: role === 'display' ? 'bottom' : 'top', lineHeight: role === 'display' ? 1.0 : role === 'title' ? 1.1 : 1.35,
        tracking: role === 'display' ? -0.035 : role === 'title' ? -0.02 : 0,
      }));
      break;
    }
    case 'stat': {
      out.push({ kind: 'rect', ...b, fill: th.accent });
      const big = Math.min(s.stat, (b.h - 2 * p) * 0.55 * 72);
      out.push(textPrim(cfg, { x: b.x + p, y: b.y + p, w: b.w - 2 * p, h: big * PT_TO_IN * 1.1, text: t.value || '0', size: big, weight: 500, color: th.onAccent, align: 'left', valign: 'top', tracking: -0.03, maxLines: 1 }));
      out.push(textPrim(cfg, { x: b.x + p, y: b.y + b.h - p - s.statLabel * PT_TO_IN * 2.6, w: b.w - 2 * p, h: s.statLabel * PT_TO_IN * 2.6, text: t.label || '', size: s.statLabel, weight: 400, color: th.onAccent, align: 'left', valign: 'bottom' }));
      break;
    }
  }
  for (const pr of out) if (pr.kind === 'text') pr.tileId = t.id;
  return out;
}

export function drawSlide(slide: Slide, deck: Deck, cfg: DrawConfig): SlideDrawing {
  const th = THEMES[deck.theme];
  const prims: Prim[] = [];
  const tileBoxes = slide.tiles.filter(t => t.rect).map(t => ({ id: t.id, ...cellBox(cfg, t.rect!) }));
  for (const t of slide.tiles) if (t.rect) prims.push(...drawTile(t, cfg, th));
  return { bg: th.bg, prims, tileBoxes };
}

/* ---- auto-generated credits ---- */
export function deckCredits(deck: Deck): Credit[] {
  const seen = new Set<string>(), out: Credit[] = [];
  for (const s of deck.slides) for (const t of s.tiles) {
    if ((t.type === 'image' || t.type === 'logo') && t.credit && !seen.has(t.credit.url + t.credit.title)) { seen.add(t.credit.url + t.credit.title); out.push(t.credit); }
  }
  return out;
}

/** Credits slides: a title and two columns of credit lines, paginated to fit. */
export function creditSlides(deck: Deck, cfg: DrawConfig): Slide[] {
  const credits = deckCredits(deck);
  if (!credits.length) return [];
  const colBox = cellBox(cfg, { x: 0, y: 1, w: 6, h: 7 });
  const innerW = colBox.w - 2 * cfg.pad, innerH = colBox.h - 2 * cfg.pad; // caption tiles are padded
  const lh = cfg.sizes.caption * PT_TO_IN * 1.35;
  const perCol = Math.max(1, Math.floor(innerH / lh));
  const lines = credits.flatMap(c => wrap(`${creditLine(c)} — ${c.url}`, cfg.sizes.caption, 400, cfg.font, innerW, 4).concat(['']));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perCol * 2) pages.push(lines.slice(i, i + perCol * 2));
  return pages.map((pg, i) => ({
    id: `credits-${i}`, variant: 0,
    tiles: [
      { id: uid(), type: 'text', role: 'title', text: pages.length > 1 ? `Credits ${i + 1}/${pages.length}` : 'Credits', rect: { x: 0, y: 0, w: 12, h: 1 } },
      { id: uid(), type: 'text', role: 'caption', text: pg.slice(0, perCol).join('\n'), rect: { x: 0, y: 1, w: 6, h: 7 } },
      { id: uid(), type: 'text', role: 'caption', text: pg.slice(perCol).join('\n'), rect: { x: 6, y: 1, w: 6, h: 7 } },
    ] satisfies Tile[],
  }));
}

/** Every slide to render: the deck's own, then the auto credits. */
export const allSlides = (deck: Deck, cfg: DrawConfig) => [...deck.slides, ...creditSlides(deck, cfg)];
