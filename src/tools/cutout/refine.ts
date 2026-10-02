/* Mask refinement and compositing on canvases. The model's soft mask is shifted (choke or spread:
   blur, then re-threshold off-centre), hardened (a smoothstep around 0.5) and feathered (a final
   Gaussian blur); the source's pixels take the result as alpha. */

export interface Refine { shift: number; hardness: number; feather: number }

const smooth = (e0: number, e1: number, x: number) => { if (e1 <= e0) return x < e0 ? 0 : 1; const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function blurred(src: OffscreenCanvas, r: number): OffscreenCanvas {
  const out = new OffscreenCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  if (r > 0) ctx.filter = `blur(${r}px)`;
  ctx.drawImage(src, 0, 0);
  return out;
}

/** The mask (alpha 0–255 per pixel, as a canvas whose alpha is the mask) after refinement. */
export function refineMask(mask: OffscreenCanvas, o: Refine): OffscreenCanvas {
  let cur = mask;
  if (o.shift !== 0 || o.hardness > 0) {
    const src = o.shift !== 0 ? blurred(mask, Math.abs(o.shift) / 2) : mask;
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, src.width, src.height);
    // Off-centre threshold moves the edge out (spread) or in (choke) by about |shift| px.
    const c = o.shift === 0 ? 0.5 : o.shift > 0 ? 0.5 - Math.min(0.45, 0.12 * Math.sqrt(Math.abs(o.shift))) : 0.5 + Math.min(0.45, 0.12 * Math.sqrt(Math.abs(o.shift)));
    // Soft window, kept inside [0, 1] so a shifted edge never lifts the background off zero.
    const w = Math.max(0.005, Math.min((1 - o.hardness) * 0.5, c, 1 - c));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * smooth(c - w, c + w, v / 255));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = lut[img.data[i]];
    const out = new OffscreenCanvas(src.width, src.height);
    out.getContext('2d')!.putImageData(img, 0, 0);
    cur = out;
  }
  return o.feather > 0 ? blurred(cur, o.feather) : cur;
}

/** Source pixels with the mask as alpha (multiplied with any alpha the source already had). */
export function composite(source: ImageBitmap | OffscreenCanvas, mask: OffscreenCanvas): OffscreenCanvas {
  const out = new OffscreenCanvas(mask.width, mask.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, 0, 0, mask.width, mask.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** Turn the model's mask image (white = keep, as luminance and/or alpha) into a canvas whose alpha is the mask. */
export async function maskCanvas(blob: Blob, w: number, h: number): Promise<OffscreenCanvas> {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.min(img.data[i + 3], Math.max(img.data[i], img.data[i + 1], img.data[i + 2]));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
