/* Bento layout engine: 16:9 slides on a 12×8 grid. Templates by tile count; tiles are matched to
   cells by aspect ratio; "Reshuffle" walks the alternates; locked tiles keep their cells. */
import { COLS, ROWS, type Rect, type Slide, type Tile } from './model';

type R = [number, number, number, number];
const T: Record<number, R[][]> = {
  1: [[[0, 0, 12, 8]]],
  2: [
    [[0, 0, 6, 8], [6, 0, 6, 8]], [[0, 0, 8, 8], [8, 0, 4, 8]], [[0, 0, 12, 5], [0, 5, 12, 3]], [[0, 0, 4, 8], [4, 0, 8, 8]],
  ],
  3: [
    [[0, 0, 8, 8], [8, 0, 4, 4], [8, 4, 4, 4]], [[0, 0, 4, 8], [4, 0, 4, 8], [8, 0, 4, 8]], [[0, 0, 6, 8], [6, 0, 6, 4], [6, 4, 6, 4]],
    [[0, 0, 12, 5], [0, 5, 6, 3], [6, 5, 6, 3]], [[0, 0, 4, 4], [0, 4, 4, 4], [4, 0, 8, 8]],
  ],
  4: [
    [[0, 0, 6, 4], [6, 0, 6, 4], [0, 4, 6, 4], [6, 4, 6, 4]], [[0, 0, 8, 8], [8, 0, 4, 3], [8, 3, 4, 3], [8, 6, 4, 2]],
    [[0, 0, 6, 8], [6, 0, 6, 4], [6, 4, 3, 4], [9, 4, 3, 4]], [[0, 0, 3, 8], [3, 0, 3, 8], [6, 0, 3, 8], [9, 0, 3, 8]],
    [[0, 0, 12, 4], [0, 4, 4, 4], [4, 4, 4, 4], [8, 4, 4, 4]],
  ],
  5: [
    [[0, 0, 6, 8], [6, 0, 3, 4], [9, 0, 3, 4], [6, 4, 3, 4], [9, 4, 3, 4]], [[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 4, 4], [0, 4, 6, 4], [6, 4, 6, 4]],
    [[0, 0, 8, 5], [8, 0, 4, 5], [0, 5, 4, 3], [4, 5, 4, 3], [8, 5, 4, 3]],
  ],
  6: [
    [[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 4, 4], [0, 4, 4, 4], [4, 4, 4, 4], [8, 4, 4, 4]],
    [[0, 0, 6, 5], [6, 0, 3, 5], [9, 0, 3, 5], [0, 5, 4, 3], [4, 5, 4, 3], [8, 5, 4, 3]],
    [[0, 0, 6, 8], [6, 0, 3, 3], [9, 0, 3, 3], [6, 3, 6, 2], [6, 5, 3, 3], [9, 5, 3, 3]],
  ],
  7: [
    [[0, 0, 6, 8], [6, 0, 3, 3], [9, 0, 3, 3], [6, 3, 3, 2], [9, 3, 3, 2], [6, 5, 3, 3], [9, 5, 3, 3]],
    [[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 4, 4], [0, 4, 3, 4], [3, 4, 3, 4], [6, 4, 3, 4], [9, 4, 3, 4]],
  ],
  8: [
    [[0, 0, 3, 4], [3, 0, 3, 4], [6, 0, 3, 4], [9, 0, 3, 4], [0, 4, 3, 4], [3, 4, 3, 4], [6, 4, 3, 4], [9, 4, 3, 4]],
    [[0, 0, 6, 4], [6, 0, 3, 4], [9, 0, 3, 4], [0, 4, 3, 4], [3, 4, 3, 4], [6, 4, 2, 4], [8, 4, 2, 4], [10, 4, 2, 4]],
  ],
  9: [[[0, 0, 4, 3], [4, 0, 4, 3], [8, 0, 4, 3], [0, 3, 4, 3], [4, 3, 4, 3], [8, 3, 4, 3], [0, 6, 4, 2], [4, 6, 4, 2], [8, 6, 4, 2]]],
};

/** Even grid for counts without a template. */
function gridFallback(n: number): R[] {
  const cols = Math.min(COLS, Math.ceil(Math.sqrt(n * 1.5))), rows = Math.ceil(n / cols);
  const out: R[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x0 = Math.round(c * COLS / cols), x1 = Math.round((c + 1) * COLS / cols);
    const y0 = Math.round(r * ROWS / rows), y1 = Math.round((r + 1) * ROWS / rows);
    out.push([x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]);
  }
  return out;
}

export function variantsFor(n: number): Rect[][] {
  const list = T[n] ?? [gridFallback(n)];
  return list.map(v => v.map(([x, y, w, h]) => ({ x, y, w, h })));
}

/** Width/height of a grid rect on a 16:9 slide. */
export const rectAspect = (r: Rect) => (r.w / COLS * 16) / (r.h / ROWS * 9);

/** The aspect each tile wants; images use their own. */
export function wantAspect(t: Tile): number {
  if ((t.type === 'image' || t.type === 'logo') && t.aspect) return t.aspect;
  return { image: 1.4, logo: 1.6, palette: 3, hexlist: 1.2, type: 1.3, text: t.role === 'body' ? 1.4 : 2.6, stat: 1.2 }[t.type] ?? 1.4;
}
const weight = (t: Tile) => (t.type === 'image' ? 3 : t.type === 'logo' ? 2 : t.type === 'text' && t.role === 'display' ? 2 : 1);

/** Greedy match: biggest cells first, each takes the tile whose aspect fits best (images favoured). */
function assign(tiles: Tile[], rects: Rect[]): { cost: number; map: Map<string, Rect> } {
  const free = [...tiles];
  const map = new Map<string, Rect>();
  let cost = 0;
  for (const r of [...rects].sort((a, b) => b.w * b.h - a.w * a.h)) {
    let best = 0, bestScore = Infinity;
    free.forEach((t, i) => {
      const fit = Math.abs(Math.log(wantAspect(t)) - Math.log(rectAspect(r)));
      const score = fit - weight(t) * 0.35 * (r.w * r.h) / (COLS * ROWS);
      if (score < bestScore) { bestScore = score; best = i; }
    });
    const t = free.splice(best, 1)[0];
    if (!t) break;
    map.set(t.id, r);
    cost += Math.abs(Math.log(wantAspect(t)) - Math.log(rectAspect(r))) * weight(t);
  }
  return { cost, map };
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Lay out a slide. With `variant` undefined the best-fitting template is chosen; otherwise that
 * alternate is used. Locked tiles keep their cells: only templates containing every locked cell
 * qualify, and unlocked tiles fill the rest.
 */
export function layoutSlide(slide: Slide, variant?: number): Slide {
  const tiles = slide.tiles;
  if (!tiles.length) return { ...slide, variant: 0 };
  const locked = tiles.filter(t => t.locked && t.rect);
  const free = tiles.filter(t => !(t.locked && t.rect));
  const all = variantsFor(tiles.length);
  const ok = all.map((v, i) => ({ v, i })).filter(({ v }) => locked.every(l => v.some(r => sameRect(r, l.rect!))));
  let chosen: { v: Rect[]; i: number };
  if (!ok.length) {
    // No template keeps every locked cell: keep current cells and rotate the unlocked tiles among them.
    const cells = free.map(t => t.rect).filter(Boolean) as Rect[];
    if (cells.length === free.length) {
      const rot = cells.length ? (variant ?? 0) % cells.length : 0;
      return { ...slide, variant: variant ?? slide.variant, tiles: tiles.map(t => (t.locked ? t : { ...t, rect: cells[(free.indexOf(t) + rot) % cells.length] })) };
    }
    chosen = { v: all[0], i: 0 };
  } else if (variant === undefined) {
    chosen = ok.map(o => ({ ...o, cost: assign(free, o.v.filter(r => !locked.some(l => sameRect(l.rect!, r)))).cost }))
      .sort((a, b) => a.cost - b.cost)[0];
  } else {
    chosen = ok[((variant % ok.length) + ok.length) % ok.length];
  }
  const open = chosen.v.filter(r => !locked.some(l => sameRect(l.rect!, r)));
  const { map } = assign(free, open);
  return { ...slide, variant: chosen.i, tiles: tiles.map(t => (locked.includes(t) ? t : { ...t, rect: map.get(t.id) ?? t.rect ?? { x: 0, y: 0, w: 1, h: 1 } })) };
}

/** Next alternate layout ("Reshuffle"). */
export function reshuffle(slide: Slide): Slide {
  const n = variantsFor(slide.tiles.length).length;
  return layoutSlide(slide, n > 1 ? slide.variant + 1 : slide.variant + 1);
}

/** Every tile has a rect inside the grid (repair after edits or imports). */
export function ensureLayout(slide: Slide): Slide {
  const bad = slide.tiles.some(t => !t.rect || t.rect.x < 0 || t.rect.y < 0 || t.rect.x + t.rect.w > COLS || t.rect.y + t.rect.h > ROWS || t.rect.w < 1 || t.rect.h < 1);
  return bad ? layoutSlide(slide) : slide;
}
