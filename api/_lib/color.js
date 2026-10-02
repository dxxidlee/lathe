// @ts-check
/* Server-side color helpers for brand capture: parse CSS color values (hex, rgb, hsl, oklch, oklab,
   white/black) into sRGB hex, convert to OKLab, and cluster by frequency. The same OKLab math as
   src/lib/color.ts, kept in plain JS for the /api functions. */

/** @param {number} c 0..255 */
const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** @param {number} c linear 0..1 */
const toSrgb = c => { c = Math.max(0, Math.min(1, c)); return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255); };
const h2 = (/** @type {number} */ n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** @param {number} r @param {number} g @param {number} b */
export const rgbHex = (r, g, b) => `#${h2(r)}${h2(g)}${h2(b)}`.toUpperCase();

/** @param {string} hex @returns {[number, number, number]} */
export function hexOklab(hex) {
  const [r, g, b] = [1, 3, 5].map(i => toLin(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** @param {number} L @param {number} a @param {number} b */
function oklabHex(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbHex(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
}
/** @param {[number, number, number]} p @param {[number, number, number]} q */
export const deltaE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** "50%" → 0.5 of `scale`; "128" → 128; "0.5" → 0.5. @param {string} v @param {number} scale */
const num = (v, scale) => (v.endsWith('%') ? parseFloat(v) / 100 * scale : parseFloat(v));
/** @param {string} v */
const hue = v => { const n = parseFloat(v); return /turn$/.test(v) ? n * 360 : /rad$/.test(v) ? n * 180 / Math.PI : /grad$/.test(v) ? n * 0.9 : n; };
/** @param {string | undefined} v */
const alphaOf = v => (v == null || v === '' ? 1 : num(v, 1));

/** @param {number} h @param {number} s @param {number} l 0..1 */
function hslRgb(h, s, l) {
  const k = (/** @type {number} */ n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (/** @type {number} */ n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/* Matches one color value. Functional notations accept commas or spaces and `/ alpha`. */
export const COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(\s*[^()]*\)|\b(?:white|black)\b/gi;

/**
 * Parse one CSS color into hex and alpha, or null (variables, keywords, out-of-range values).
 * @param {string} raw
 * @returns {{ hex: string, alpha: number } | null}
 */
export function parseColor(raw) {
  const v = raw.trim().toLowerCase();
  if (v === 'white') return { hex: '#FFFFFF', alpha: 1 };
  if (v === 'black') return { hex: '#000000', alpha: 1 };
  if (v[0] === '#') {
    const h = v.slice(1);
    if (![3, 4, 6, 8].includes(h.length) || !/^[0-9a-f]+$/.test(h)) return null;
    const full = h.length <= 4 ? [...h].map(c => c + c).join('') : h;
    return { hex: '#' + full.slice(0, 6).toUpperCase(), alpha: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1 };
  }
  const m = /^(\w+)\((.*)\)$/.exec(v);
  if (!m || /var\(|calc\(|from\b|none/.test(m[2])) return null;
  const [main, al] = m[2].split('/');
  const parts = main.split(/[\s,]+/).filter(Boolean);
  const alpha = alphaOf(al?.trim() ?? (parts.length === 4 ? parts[3] : undefined));
  if (parts.length < 3 || parts.slice(0, 3).some(p => Number.isNaN(parseFloat(p)))) return null;
  let hex;
  if (m[1].startsWith('rgb')) hex = rgbHex(num(parts[0], 255), num(parts[1], 255), num(parts[2], 255));
  else if (m[1].startsWith('hsl')) { const [r, g, b] = hslRgb(hue(parts[0]), num(parts[1], 1) > 1 ? parseFloat(parts[1]) / 100 : num(parts[1], 1), num(parts[2], 1) > 1 ? parseFloat(parts[2]) / 100 : num(parts[2], 1)); hex = rgbHex(r, g, b); }
  else if (m[1] === 'oklch') { const L = num(parts[0], 1), C = num(parts[1], 0.4), H = hue(parts[2]) * Math.PI / 180; hex = oklabHex(L, C * Math.cos(H), C * Math.sin(H)); }
  else if (m[1] === 'oklab') hex = oklabHex(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4));
  else return null;
  return Number.isFinite(alpha) ? { hex, alpha } : null;
}

/**
 * Cluster counted colors greedily in OKLab, most frequent first: a color within `merge` of a
 * cluster's seed joins it. Returns clusters ranked by count.
 * @param {Map<string, number>} counts hex → occurrences
 * @param {number} merge ΔE OKLab
 * @returns {{ hex: string, count: number, share: number, members: string[] }[]}
 */
export function clusterColors(counts, merge) {
  /** @type {{ hex: string, lab: [number, number, number], count: number, members: string[] }[]} */
  const clusters = [];
  for (const [hex, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const lab = hexOklab(hex);
    const near = clusters.find(c => deltaE(c.lab, lab) <= merge);
    if (near) { near.count += count; near.members.push(hex); } else clusters.push({ hex, lab, count, members: [hex] });
  }
  const total = clusters.reduce((s, c) => s + c.count, 0) || 1;
  return clusters.sort((a, b) => b.count - a.count).map(c => ({ hex: c.hex, count: c.count, share: c.count / total, members: c.members }));
}
