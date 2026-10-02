/* tokens-exempt: color science for content (palettes), not Lathe's interface.

   OKLCH tint/shade scales: each step sets lightness to a target, keeps the swatch's hue, and keeps
   its chroma unless that leaves the sRGB gamut, where chroma is reduced until it fits. */
import { hexToOklab, rgbToHex } from '../../lib/color';

export interface Lch { L: number; C: number; H: number }

export function hexToOklch(hex: string): Lch | null {
  const lab = hexToOklab(hex);
  if (!lab) return null;
  const [L, a, b] = lab;
  const C = Math.hypot(a, b);
  return { L, C, H: C < 1e-6 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
}

/** OKLCH → linear sRGB (unclamped). */
function lchToLinear({ L, C, H }: Lch): [number, number, number] {
  const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const EPS = 1e-4;
export const inGamut = (c: Lch) => lchToLinear(c).every(v => v >= -EPS && v <= 1 + EPS);
const enc = (v: number) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
export const oklchToHex = (c: Lch) => rgbToHex(...(lchToLinear(c).map(enc) as [number, number, number]));

/** Largest chroma ≤ c.C that is inside sRGB at this L and H (binary search). */
export function fitChroma(c: Lch): Lch {
  if (inGamut(c)) return c;
  let lo = 0, hi = c.C;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut({ ...c, C: mid })) lo = mid; else hi = mid; }
  return { ...c, C: lo };
}

export interface Step { step: number; hex: string; lch: Lch; base: boolean }

/**
 * A scale for one color. `ladder` maps step names (50…950) to OKLCH lightness. With `anchor`, the
 * step nearest the color's own lightness is the color itself, exactly.
 */
export function scaleFor(hex: string, ladder: [number, number][], anchor: boolean): Step[] {
  const base = hexToOklch(hex);
  if (!base) return [];
  let nearest = 0;
  ladder.forEach(([, L], i) => { if (Math.abs(L - base.L) < Math.abs(ladder[nearest][1] - base.L)) nearest = i; });
  return ladder.map(([step, L], i) => {
    if (anchor && i === nearest) return { step, hex: hex.toUpperCase(), lch: base, base: true };
    const lch = fitChroma({ L, C: base.C, H: base.H });
    return { step, hex: oklchToHex(lch), lch, base: false };
  });
}

export const fmtOklch = (c: Lch) => `oklch(${(c.L * 100).toFixed(1)}% ${c.C.toFixed(3)} ${c.H.toFixed(1)})`;
