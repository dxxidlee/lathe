/* tokens-exempt: color science for content (palettes), not Lathe's interface.

   OKLab conversion (Björn Ottosson), perceptual distance, and k-means palette extraction.
   Pure functions: shared by the Audit palette worker, the UI and Bento. */

export type Lab = [number, number, number];
export interface Swatch { hex: string; share: number; lab: Lab }

const s2l = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const l2s = (c: number) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = s2l(r), lg = s2l(g), lb = s2l(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    l2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const oklabToHex = (lab: Lab) => rgbToHex(...oklabToRgb(lab));

export function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function hexToOklab(hex: string): Lab | null { const rgb = hexToRgb(hex); return rgb ? rgbToOklab(...rgb) : null; }

/** Euclidean distance in OKLab (ΔE_OK). Just-noticeable ≈ 0.02; "same family" ≈ 0.1. */
export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest swatch distance from a target color to a palette. */
export const paletteDistance = (target: Lab, swatches: Swatch[]) =>
  swatches.length ? Math.min(...swatches.map(s => deltaE(target, s.lab))) : Infinity;

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * k-means in OKLab with k-means++ seeding (seeded, so the same image gives the same palette).
 * `weights` lets callers cluster swatches by their share (aggregate palettes).
 */
export function kmeans(points: Lab[], k: number, iterations = 12, weights?: number[], seed = 7): Swatch[] {
  const n = points.length;
  if (!n) return [];
  k = Math.max(1, Math.min(k, n));
  const w = weights ?? new Array(n).fill(1);
  const rand = mulberry32(seed);
  const centers: Lab[] = [points[Math.floor(rand() * n)].slice() as Lab];
  const d2 = new Float64Array(n);
  while (centers.length < k) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const c of centers) { const d = deltaE(points[i], c); if (d < best) best = d; }
      d2[i] = best * best * w[i]; sum += d2[i];
    }
    if (sum === 0) break;
    let r = rand() * sum, pick = 0;
    for (; pick < n - 1; pick++) { r -= d2[pick]; if (r <= 0) break; }
    centers.push(points[pick].slice() as Lab);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = deltaE(points[i], centers[c]); if (d < bd) { bd = d; bi = c; } }
      if (assign[i] !== bi) { assign[i] = bi; moved++; }
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const a = acc[assign[i]], p = points[i]; a[0] += p[0] * w[i]; a[1] += p[1] * w[i]; a[2] += p[2] * w[i]; a[3] += w[i]; }
    acc.forEach((a, c) => { if (a[3] > 0) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    if (!moved && it > 0) break;
  }
  const mass = new Array(centers.length).fill(0);
  let total = 0;
  for (let i = 0; i < n; i++) { mass[assign[i]] += w[i]; total += w[i]; }
  return centers.map((lab, c) => ({ lab, share: total ? mass[c] / total : 0, hex: oklabToHex(lab) }))
    .filter(s => s.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** One palette for many: cluster every swatch, weighted by its share. */
export function aggregatePalette(palettes: Swatch[][], k: number): Swatch[] {
  const pts: Lab[] = [], ws: number[] = [];
  for (const p of palettes) for (const s of p) { pts.push(s.lab); ws.push(s.share); }
  return kmeans(pts, k, 16, ws, 11);
}
