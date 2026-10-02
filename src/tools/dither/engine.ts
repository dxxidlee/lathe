/* tokens-exempt: image processing on content colors, not Lathe's interface.

   Dither engine. Pure functions on ImageData:
   - ordered (Bayer 2/4/8) and error diffusion (Floyd–Steinberg, Atkinson) to a palette of RGB colors,
     nearest color measured in OKLab;
   - halftone dots and lines as vector shapes, drawn to a canvas or written as SVG. */
import { rgbToOklab, type Lab } from '../../lib/color';

export type RGB = [number, number, number];
export type Method = 'bayer2' | 'bayer4' | 'bayer8' | 'floyd' | 'atkinson' | 'dots' | 'lines';
export const isHalftone = (m: Method) => m === 'dots' || m === 'lines';

/** Bayer index matrix of size n (power of two), values normalised to (0, 1). */
export function bayer(n: number): number[][] {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length, next: number[][] = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = 4 * m[y][x];
      next[y][x] = v; next[y][x + s] = v + 2; next[y + s][x] = v + 3; next[y + s][x + s] = v + 1;
    }
    m = next;
  }
  const N = n * n;
  return m.map(r => r.map(v => (v + 0.5) / N));
}

/** Nearest palette color in OKLab, memoised per RGB triple. */
function nearestFn(palette: RGB[]) {
  const labs = palette.map(p => rgbToOklab(...p));
  const memo = new Map<number, number>();
  return (r: number, g: number, b: number) => {
    r = r < 0 ? 0 : r > 255 ? 255 : Math.round(r); g = g < 0 ? 0 : g > 255 ? 255 : Math.round(g); b = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    const key = (r << 16) | (g << 8) | b;
    let i = memo.get(key);
    if (i === undefined) {
      const L = rgbToOklab(r, g, b);
      let best = Infinity; i = 0;
      labs.forEach((p: Lab, k) => { const d = (p[0] - L[0]) ** 2 + (p[1] - L[1]) ** 2 + (p[2] - L[2]) ** 2; if (d < best) { best = d; i = k; } });
      memo.set(key, i);
    }
    return i;
  };
}

export interface DitherOpts { method: Method; palette: RGB[]; threshold: number; serpentine: boolean }

/**
 * Ordered or error-diffusion dither of `src` (already at working resolution). `threshold` (0–1,
 * 0.5 neutral) shifts brightness before quantising: higher → more pixels fall to the darker colors.
 * Returns new ImageData; alpha is kept as is.
 */
export function dither(src: ImageData, o: DitherOpts): ImageData {
  const { width: w, height: h } = src;
  const out = new ImageData(w, h);
  const nearest = nearestFn(o.palette);
  const bias = (0.5 - o.threshold) * 255;
  const f = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < src.data.length; i += 4, j += 3) { f[j] = src.data[i] + bias; f[j + 1] = src.data[i + 1] + bias; f[j + 2] = src.data[i + 2] + bias; }
  const put = (p: number, k: number) => { const c = o.palette[k]; out.data[p * 4] = c[0]; out.data[p * 4 + 1] = c[1]; out.data[p * 4 + 2] = c[2]; out.data[p * 4 + 3] = src.data[p * 4 + 3]; };

  if (o.method.startsWith('bayer')) {
    const n = Number(o.method.slice(5)), m = bayer(n);
    // Spread: one quantisation step, treating the palette as ~cbrt(n) levels per channel, so two
    // colors dither across the full range and larger palettes dither between neighbours.
    const spread = 255 / (Math.max(2, Math.round(Math.cbrt(o.palette.length))) - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, t = (m[y % n][x % n] - 0.5) * spread;
      put(p, nearest(f[p * 3] + t, f[p * 3 + 1] + t, f[p * 3 + 2] + t));
    }
    return out;
  }
  const kernel: [number, number, number][] = o.method === 'floyd'
    ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
    : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]; // Atkinson diffuses 6/8
  for (let y = 0; y < h; y++) {
    const rev = o.serpentine && y % 2 === 1;
    for (let i = 0; i < w; i++) {
      const x = rev ? w - 1 - i : i, p = y * w + x;
      const k = nearest(f[p * 3], f[p * 3 + 1], f[p * 3 + 2]);
      put(p, k);
      const c = o.palette[k];
      const er = f[p * 3] - c[0], eg = f[p * 3 + 1] - c[1], eb = f[p * 3 + 2] - c[2];
      for (const [dx0, dy, wt] of kernel) {
        const dx = rev ? -dx0 : dx0, xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy >= h) continue;
        const q = (yy * w + xx) * 3;
        f[q] += er * wt; f[q + 1] += eg * wt; f[q + 2] += eb * wt;
      }
    }
  }
  return out;
}

/* ---------------- halftone ---------------- */

export interface HalftoneOpts { method: 'dots' | 'lines'; cell: number; angle: number; threshold: number; gain: number }
export interface Halftone { width: number; height: number; dots: [number, number, number][]; lines: [number, number][][] }

/** Darkness 0 (white) … 1 (black) of a source pixel, by Rec. 709 luma, with alpha treated as paper. */
function darknessAt(src: ImageData, x: number, y: number) {
  const xi = Math.min(src.width - 1, Math.max(0, Math.floor(x))), yi = Math.min(src.height - 1, Math.max(0, Math.floor(y)));
  const i = (yi * src.width + xi) * 4, a = src.data[i + 3] / 255;
  const luma = (0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]) / 255;
  return 1 - (luma * a + (1 - a));
}

/**
 * Halftone geometry in `src` pixel units. Dots: one circle per cell of a grid rotated by `angle`,
 * area proportional to darkness. Lines: one band per row of the rotated grid, its thickness
 * following darkness, as closed polygons.
 */
export function halftone(src: ImageData, o: HalftoneOpts): Halftone {
  const { width: w, height: h } = src;
  const a = o.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const R = Math.hypot(w, h) / 2 + o.cell, cx = w / 2, cy = h / 2;
  const tone = (x: number, y: number) => {
    // average of 5 samples across the cell, then threshold bias and gain
    const s = o.cell / 4;
    const d = (darknessAt(src, x, y) + darknessAt(src, x - s, y - s) + darknessAt(src, x + s, y - s) + darknessAt(src, x - s, y + s) + darknessAt(src, x + s, y + s)) / 5;
    return Math.max(0, Math.min(1, (d - (o.threshold - 0.5)) * o.gain));
  };
  const toImg = (u: number, v: number): [number, number] => [cx + u * ca - v * sa, cy + u * sa + v * ca];
  const res: Halftone = { width: w, height: h, dots: [], lines: [] };
  for (let v = -R; v <= R; v += o.cell) {
    if (o.method === 'dots') {
      for (let u = -R; u <= R; u += o.cell) {
        const [x, y] = toImg(u, v);
        if (x < -o.cell || y < -o.cell || x > w + o.cell || y > h + o.cell) continue;
        const t = tone(x, y);
        if (t <= 0.004) continue;
        // r so the dot's area is t × the cell's; at t=1 the dot just covers the cell's corners
        res.dots.push([x, y, Math.min(o.cell * Math.SQRT1_2, o.cell * Math.sqrt(t / Math.PI))]);
      }
    } else {
      const top: [number, number][] = [], bot: [number, number][] = [];
      let any = false;
      const step = Math.max(1, o.cell / 3);
      for (let u = -R; u <= R; u += step) {
        const [x, y] = toImg(u, v);
        const inside = x >= -o.cell && y >= -o.cell && x <= w + o.cell && y <= h + o.cell;
        const t = inside ? tone(x, y) : 0;
        if (t > 0.004) any = true;
        const half = (t * o.cell) / 2;
        top.push(toImg(u, v - half)); bot.push(toImg(u, v + half));
      }
      if (any) res.lines.push([...top, ...bot.reverse()]);
    }
  }
  return res;
}

const n2 = (v: number) => Math.round(v * 100) / 100;
const hex = (c: RGB) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

export function drawHalftone(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ht: Halftone, scale: number, ink: RGB, paper: RGB | null) {
  ctx.save();
  ctx.scale(scale, scale);
  if (paper) { ctx.fillStyle = hex(paper); ctx.fillRect(0, 0, ht.width, ht.height); } else ctx.clearRect(0, 0, ht.width, ht.height);
  ctx.fillStyle = hex(ink);
  ctx.beginPath();
  for (const [x, y, r] of ht.dots) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
  for (const poly of ht.lines) { poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  ctx.fill();
  ctx.restore();
}

/** SVG of the halftone at `width`×`height` output pixels (viewBox in source pixels). */
export function halftoneSvg(ht: Halftone, width: number, height: number, ink: RGB, paper: RGB | null): string {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${ht.width} ${ht.height}">`];
  parts.push(`<defs><clipPath id="c"><rect width="${ht.width}" height="${ht.height}"/></clipPath></defs>`);
  if (paper) parts.push(`<rect width="${ht.width}" height="${ht.height}" fill="${hex(paper)}"/>`);
  parts.push(`<g fill="${hex(ink)}" clip-path="url(#c)">`);
  if (ht.dots.length) parts.push(`<path d="${ht.dots.map(([x, y, r]) => `M${n2(x - r)} ${n2(y)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0z`).join('')}"/>`);
  for (const poly of ht.lines) parts.push(`<path d="M${poly.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L')}z"/>`);
  parts.push('</g></svg>');
  return parts.join('');
}

export const hexToRgbTriple = (h: string): RGB | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
};
export const rgbHex = hex;
