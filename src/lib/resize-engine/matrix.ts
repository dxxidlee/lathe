/* Affine matrices [a b c d e f] (SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f) and boxes. */

export type M = readonly [number, number, number, number, number, number];
export interface Box { x: number; y: number; w: number; h: number }

export const IDENTITY: M = [1, 0, 0, 1, 0, 0];

/** m · n: apply n first, then m (a parent's matrix times its child's). */
export const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): M => [sx, 0, 0, sy, 0, 0];
/** True for matrices that only scale and translate (no rotation or skew). */
export const axisAligned = (m: M) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
/** The uniform scale a matrix applies to lengths (square root of the area factor). */
export const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/** An SVG transform list as one matrix. */
export function parseTransform(s: string | undefined): M {
  let out = IDENTITY;
  if (!s) return out;
  for (const m of s.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = (m[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let t: M = IDENTITY;
    switch (m[1]) {
      case 'matrix': if (v.length === 6) t = v as unknown as M; break;
      case 'translate': t = translate(v[0] ?? 0, v[1] ?? 0); break;
      case 'scale': t = scale(v[0] ?? 1, v[1] ?? v[0] ?? 1); break;
      case 'rotate': {
        const r = (v[0] ?? 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
        t = [cos, sin, -sin, cos, 0, 0];
        if (v.length >= 3) t = mul(mul(translate(v[1], v[2]), t), translate(-v[1], -v[2]));
        break;
      }
      case 'skewX': t = [1, 0, Math.tan((v[0] ?? 0) * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan((v[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    out = mul(out, t);
  }
  return out;
}

/** A number for SVG output: at most 4 decimals, no "-0". */
export const num = (n: number) => { const r = Math.round(n * 1e4) / 1e4; return Object.is(r, -0) ? '0' : String(r); };
export const matrixAttr = (m: M) => `matrix(${m.map(num).join(' ')})`;

/** The matrix that maps box `from` onto box `to` (scale and translate). */
export function boxToBox(from: Box, to: Box): M {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
}
export function transformBox(m: M, b: Box): Box {
  const pts = [apply(m, b.x, b.y), apply(m, b.x + b.w, b.y), apply(m, b.x, b.y + b.h), apply(m, b.x + b.w, b.y + b.h)];
  return boundsOf(pts) as Box;
}
export function boundsOf(pts: [number, number][]): Box | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function intersect(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w >= 0 && h >= 0 ? { x, y, w, h } : { x, y, w: 0, h: 0 };
}
