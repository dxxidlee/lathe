/* Bounding boxes of SVG shapes under a matrix. Every shape becomes line and cubic segments (arcs
   and ellipses converted to cubics), the segments are transformed (affine maps keep Béziers
   Béziers), and the box takes each cubic's true extrema, so boxes stay tight under rotation. */
import { apply, boundsOf, type Box, type M } from './matrix';

type P = [number, number];
/** A start point and line or cubic segments from it. */
interface Seg { from: P; c1?: P; c2?: P; to: P }

const n = (v: string | undefined, d = 0) => { const x = parseFloat(v ?? ''); return Number.isFinite(x) ? x : d; };

export function shapeSegments(tag: string, a: Record<string, string>): Seg[] {
  switch (tag) {
    case 'rect': { const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height); return w > 0 && h > 0 ? poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true) : []; }
    case 'circle': return ellipse(n(a.cx), n(a.cy), n(a.r), n(a.r));
    case 'ellipse': return ellipse(n(a.cx), n(a.cy), n(a.rx), n(a.ry));
    case 'line': return [{ from: [n(a.x1), n(a.y1)], to: [n(a.x2), n(a.y2)] }];
    case 'polyline': case 'polygon': {
      const v = (a.points?.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      const pts: P[] = []; for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      return poly(pts, tag === 'polygon');
    }
    case 'path': return pathSegments(a.d ?? '');
    case 'image': case 'use': { const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height); return w > 0 && h > 0 ? poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true) : []; }
    default: return [];
  }
}

const poly = (pts: P[], close: boolean): Seg[] => {
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ from: pts[i - 1], to: pts[i] });
  if (close && pts.length > 2) out.push({ from: pts[pts.length - 1], to: pts[0] });
  if (pts.length === 1) out.push({ from: pts[0], to: pts[0] });
  return out;
};
const K = 0.5522847498;
function ellipse(cx: number, cy: number, rx: number, ry: number): Seg[] {
  if (rx <= 0 || ry <= 0) return [];
  const q: P[] = [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]];
  const out: Seg[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const ta: P = i % 2 === 0 ? [0, (i === 0 ? 1 : -1) * ry * K] : [(i === 1 ? -1 : 1) * rx * K, 0];
    const tb: P = i % 2 === 0 ? [(i === 0 ? 1 : -1) * rx * K, 0] : [0, (i === 1 ? -1 : 1) * ry * K];
    out.push({ from: a, c1: [a[0] + ta[0], a[1] + ta[1]], c2: [b[0] + tb[0], b[1] + tb[1]], to: b });
  }
  return out;
}

/** Path data as segments in absolute coordinates. */
export function pathSegments(d: string): Seg[] {
  const toks = d.match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out: Seg[] = [];
  let i = 0, cmd = '', cur: P = [0, 0], start: P = [0, 0], lastC: P | null = null, lastQ: P | null = null;
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/^[a-z]$/i.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z';
    const R = (x: number, y: number): P => rel ? [cur[0] + x, cur[1] + y] : [x, y];
    switch (cmd.toUpperCase()) {
      case 'M': { const p = R(num(), num()); cur = start = p; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; out.push({ from: p, to: p }); break; }
      case 'L': { const p = R(num(), num()); out.push({ from: cur, to: p }); cur = p; lastC = lastQ = null; break; }
      case 'H': { const v = num(); const p: P = [rel ? cur[0] + v : v, cur[1]]; out.push({ from: cur, to: p }); cur = p; lastC = lastQ = null; break; }
      case 'V': { const v = num(); const p: P = [cur[0], rel ? cur[1] + v : v]; out.push({ from: cur, to: p }); cur = p; lastC = lastQ = null; break; }
      case 'C': { const c1 = R(num(), num()), c2 = R(num(), num()), p = R(num(), num()); out.push({ from: cur, c1, c2, to: p }); lastC = c2; lastQ = null; cur = p; break; }
      case 'S': {
        const c1: P = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur;
        const c2 = R(num(), num()), p = R(num(), num()); out.push({ from: cur, c1, c2, to: p }); lastC = c2; lastQ = null; cur = p; break;
      }
      case 'Q': { const q = R(num(), num()), p = R(num(), num()); out.push(quad(cur, q, p)); lastQ = q; lastC = null; cur = p; break; }
      case 'T': {
        const q: P = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur;
        const p = R(num(), num()); out.push(quad(cur, q, p)); lastQ = q; lastC = null; cur = p; break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(); const p = R(num(), num());
        out.push(...arc(cur, rx, ry, rot, !!large, !!sweep, p)); cur = p; lastC = lastQ = null; break;
      }
      case 'Z': out.push({ from: cur, to: start }); cur = start; lastC = lastQ = null; cmd = ''; break;
      default: i++;
    }
  }
  return out;
}
const quad = (a: P, q: P, b: P): Seg => ({ from: a, c1: [a[0] + 2 / 3 * (q[0] - a[0]), a[1] + 2 / 3 * (q[1] - a[1])], c2: [b[0] + 2 / 3 * (q[0] - b[0]), b[1] + 2 / 3 * (q[1] - b[1])], to: b });

/** An elliptical arc as cubics (endpoint to centre parameterization, SVG spec F.6). */
function arc(p0: P, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, p1: P): Seg[] {
  if (!rx || !ry) return [{ from: p0, to: p1 }];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = rotDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = co * rx * y1 / ry, cy1 = -co * ry * x1 / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2, cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / parts, k = 4 / 3 * Math.tan(step / 4);
  const pt = (t: number): P => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t: number): P => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: Seg[] = [];
  for (let i = 0; i < parts; i++) {
    const a = t1 + i * step, b = a + step, pa = pt(a), pb = pt(b), da = der(a), db = der(b);
    out.push({ from: pa, c1: [pa[0] + k * da[0], pa[1] + k * da[1]], c2: [pb[0] - k * db[0], pb[1] - k * db[1]], to: i === parts - 1 ? p1 : pb });
  }
  return out;
}

/** Tight box of segments after the matrix (cubic extrema solved per axis). */
export function segmentsBox(segs: Seg[], m: M): Box | null {
  const pts: P[] = [];
  for (const s of segs) {
    const a = apply(m, ...s.from), b = apply(m, ...s.to);
    pts.push(a, b);
    if (s.c1 && s.c2) {
      const c1 = apply(m, ...s.c1), c2 = apply(m, ...s.c2);
      for (const t of [...extrema(a[0], c1[0], c2[0], b[0]), ...extrema(a[1], c1[1], c2[1], b[1])]) pts.push(cubicAt(a, c1, c2, b, t));
    }
  }
  return boundsOf(pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
}
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const A = p3 - 3 * p2 + 3 * p1 - p0, B = 2 * (p2 - 2 * p1 + p0), C = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) ts.push(-C / B); }
  else { const disc = B * B - 4 * A * C; if (disc >= 0) { const r = Math.sqrt(disc); ts.push((-B + r) / (2 * A), (-B - r) / (2 * A)); } }
  return ts.filter(t => t > 0 && t < 1);
}
const cubicAt = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
};
