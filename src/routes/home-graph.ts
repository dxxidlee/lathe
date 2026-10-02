/* Home graph geometry: the Lathe mark drawn as a construction outline at the centre, two dashed
   axes and one guide circle, and one gently bent route per tool from the circle out to its label,
   ending in an arrowhead. Deterministic, in a 1200 × 900 viewBox; Home.tsx renders and animates it. */
import { MARK_PATH } from '../brand/mark-path';

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

export interface Structure { d: string; dashed?: boolean; mark?: boolean }
/** The mark sits at the centre, ~MARK_R across its widest radius. */
export const MARK_R = 200;
/** Routes leave from this circle around the mark. */
const RING = 268;
/** The construction lines every route grows from. */
export const STRUCTURE: Structure[] = [
  { d: `M600 110 L600 830`, dashed: true },
  { d: `M190 455 L1010 455`, dashed: true },
  { d: circle(C, RING) },
  { d: MARK_PATH, mark: true },
];
/** Transform that places the mark (viewBox 300 300 2400 2400, centred on 1500) at the drawing's centre. */
export const MARK_TRANSFORM = `translate(${C.x} ${C.y}) scale(${MARK_R / 1200}) translate(-1500 -1500)`;

function circle(o: P, r: number) { return `M${f(o.x - r)} ${f(o.y)} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`; }
export interface Route { line: string; head: string; label: P; anchor: 'start' | 'middle' | 'end'; baseline: 'auto' | 'hanging' | 'middle' }

/**
 * Routes for `n` labels spread around the drawing. Shapes cycle through rays, arcs, swoops and
 * loops so the drawing reads as one tangle; each ends a little short of its label.
 */
export function routes(n: number): Route[] {
  const out: Route[] = [];
  // Clockwise from the top, leaving a wedge at the bottom for "Make a tool".
  const gap = 16, step = (360 - 2 * gap) / n;
  for (let i = 0; i < n; i++) {
    let deg = -90 + (i + 0.5) * step;
    if (deg > 90 - gap) deg += 2 * gap;
    const cx = Math.cos(deg * Math.PI / 180), cy = Math.sin(deg * Math.PI / 180);
    const reach = i % 2 ? 0.9 : 1; // alternate two rings of labels so neighbours don't crowd
    const label: P = { x: C.x + cx * 500 * reach, y: C.y + cy * 360 * reach };
    const anchor = cx > 0.3 ? 'start' : cx < -0.3 ? 'end' : 'middle';
    const baseline = Math.abs(cx) <= 0.3 ? (cy < 0 ? 'auto' : 'hanging') : 'middle';
    const end: P = { x: label.x - cx * 16, y: label.y - cy * 16 + (baseline === 'auto' ? 8 : baseline === 'hanging' ? -6 : 0) };
    const start = pol(deg, RING);
    // A gentle bend, alternating sides, so the routes read as drawn rather than ruled.
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const len = Math.hypot(end.x - start.x, end.y - start.y), bend = (i % 2 ? 1 : -1) * len * 0.12;
    const ctl: P = { x: mid.x - cy * bend, y: mid.y + cx * bend };
    out.push({ line: `M${pt(start)} Q${pt(ctl)} ${pt(end)}`, head: arrow(end, ctl), label, anchor, baseline });
  }
  return out;
}

/** "Make a tool" sits at the foot of the vertical axis. */
export const MAKE: Route = { line: `M600 ${C.y + RING} L600 828`, head: arrow({ x: 600, y: 828 }, { x: 600, y: 700 }), label: { x: 600, y: 846 }, anchor: 'middle', baseline: 'hanging' };
