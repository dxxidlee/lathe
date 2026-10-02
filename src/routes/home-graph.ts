/* Home graph geometry: a construction drawing (axes, square, circles, a tilted card, sweeping
   curves) and one route per tool from the drawing out to its label, ending in an arrowhead.
   Deterministic, in a 1200 × 900 viewBox; Home.tsx renders and animates it. */

export const VIEW = { w: 1200, h: 900 };
const C = { x: 600, y: 455 };
type P = { x: number; y: number };

const pol = (deg: number, r: number, o: P = C): P => ({ x: o.x + Math.cos(deg * Math.PI / 180) * r, y: o.y + Math.sin(deg * Math.PI / 180) * r });
const f = (n: number) => Math.round(n * 10) / 10;
const pt = (p: P) => `${f(p.x)} ${f(p.y)}`;

/** Chevron arrowhead at `tip`, pointing along `dir` (a unit-ish vector). */
function arrow(tip: P, from: P, size = 11): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = { x: tip.x - Math.cos(a - 0.5) * size, y: tip.y - Math.sin(a - 0.5) * size };
  const r = { x: tip.x - Math.cos(a + 0.5) * size, y: tip.y - Math.sin(a + 0.5) * size };
  return `M${pt(l)} L${pt(tip)} L${pt(r)}`;
}

export interface Structure { d: string; dashed?: boolean }
/** The construction lines every route grows from. */
export const STRUCTURE: Structure[] = [
  { d: `M600 120 L600 820`, dashed: true },
  { d: `M250 455 L950 455`, dashed: true },
  { d: `M${pt(pol(135, 360))} L${pt(pol(-45, 360))}`, dashed: true },
  { d: `M${pt(pol(-135, 330))} L${pt(pol(45, 330))}`, dashed: true },
  { d: `M410 265 L790 265 L790 645 L410 645 Z` },
  { d: circle(C, 262) },
  { d: circle({ x: 618, y: 440 }, 205) },
  { d: roundedRect({ x: 432, y: 300 }, 300, 118, -45, 8) },
  { d: `M180 520 C 180 300, 760 290, 860 360 S 1080 520, 1010 300` },
  { d: `M300 840 C 520 820, 760 700, 720 520 S 420 430, 470 560` },
];

function circle(o: P, r: number) { return `M${f(o.x - r)} ${f(o.y)} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`; }
function roundedRect(o: P, w: number, h: number, deg: number, rx: number) {
  const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const loc = (x: number, y: number): P => ({ x: o.x + x * ca - y * sa, y: o.y + x * sa + y * ca });
  const W = w / 2, H = h / 2, k = rx;
  const seq: [number, number][] = [[-W + k, -H], [W - k, -H], [W, -H + k], [W, H - k], [W - k, H], [-W + k, H], [-W, H - k], [-W, -H + k]];
  const ctl: [number, number][] = [[W, -H], [W, H], [-W, H], [-W, -H]];
  let d = `M${pt(loc(...seq[0]))}`;
  for (let i = 0; i < 4; i++) d += ` L${pt(loc(...seq[i * 2 + 1]))} Q${pt(loc(...ctl[i]))} ${pt(loc(...seq[(i * 2 + 2) % 8]))}`;
  return d + ' Z';
}

export interface Route { line: string; head: string; label: P; anchor: 'start' | 'middle' | 'end'; baseline: 'auto' | 'hanging' | 'middle' }

/**
 * Routes for `n` labels spread around the drawing. Shapes cycle through rays, arcs, swoops and
 * loops so the drawing reads as one tangle; each ends a little short of its label.
 */
export function routes(n: number): Route[] {
  const out: Route[] = [];
  const kinds = ['ray', 'arc', 'swoop', 'ray', 'arc', 'loop', 'ray', 'arc', 'swoop'] as const;
  // Clockwise from the top, leaving a wedge at the bottom for "Make a tool".
  const gap = 16, step = (360 - 2 * gap) / n;
  for (let i = 0; i < n; i++) {
    let deg = -90 + (i + 0.5) * step;
    if (deg > 90 - gap) deg += 2 * gap;
    const jitter = [0.94, 1, 0.86, 0.97, 0.9, 1, 0.88, 0.95][i % 8];
    const label: P = { x: C.x + Math.cos(deg * Math.PI / 180) * 500 * jitter, y: C.y + Math.sin(deg * Math.PI / 180) * 372 * jitter };
    const cx = Math.cos(deg * Math.PI / 180), cy = Math.sin(deg * Math.PI / 180);
    const anchor = cx > 0.3 ? 'start' : cx < -0.3 ? 'end' : 'middle';
    const baseline = Math.abs(cx) <= 0.3 ? (cy < 0 ? 'auto' : 'hanging') : 'middle';
    // End a little short of the label, on the side facing the drawing.
    const end: P = { x: label.x - cx * 18, y: label.y - cy * 18 + (baseline === 'auto' ? 8 : baseline === 'hanging' ? -6 : 0) };
    const kind = kinds[i % kinds.length];
    let line: string, from: P;
    if (kind === 'ray') {
      const s = pol(deg + 180 + ((i * 37) % 50) - 25, 120);
      line = `M${pt(s)} L${pt(end)}`; from = s;
    } else if (kind === 'arc') {
      const r = Math.hypot(end.x - C.x, end.y - C.y);
      const a1 = Math.atan2(end.y - C.y, end.x - C.x) * 180 / Math.PI;
      const sweep = i % 2 ? 70 : -70;
      const s = pol(a1 - sweep, r);
      line = `M${pt(s)} A${f(r)} ${f(r)} 0 0 ${sweep > 0 ? 1 : 0} ${pt(end)}`;
      from = pol(a1 - (sweep > 0 ? 4 : -4), r); // a point just before the end, along the arc
    } else if (kind === 'swoop') {
      const s = pol(deg + 150, 140);
      const c1 = pol(deg + 95, 540), c2: P = { x: end.x - cy * 220, y: end.y + cx * 220 };
      line = `M${pt(s)} C${pt(c1)} ${pt(c2)} ${pt(end)}`; from = c2;
    } else {
      const s = pol(deg - 130, 205, { x: 618, y: 440 });
      const c1 = pol(deg - 210, 560), c2 = pol(deg + 35, 640);
      line = `M${pt(s)} C${pt(c1)} ${pt(c2)} ${pt(end)}`; from = c2;
    }
    out.push({ line, head: arrow(end, from), label, anchor, baseline });
  }
  return out;
}

/** "Make a tool" sits at the foot of the vertical axis. */
export const MAKE: Route = { line: 'M600 470 L600 828', head: arrow({ x: 600, y: 828 }, { x: 600, y: 700 }), label: { x: 600, y: 846 }, anchor: 'middle', baseline: 'hanging' };
