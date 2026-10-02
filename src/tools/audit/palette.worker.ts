/* Palette extraction off the main thread: fetch the thumbnail (same-origin via /api/img), downsample,
   convert to OKLab, k-means. Replies with swatches and the image's natural size. */
import { kmeans, rgbToOklab, type Lab } from '../../lib/color';

export interface PaletteJob { id: string; url: string; k: number; sample: number; iterations: number; minShare: number; minSwatches: number }
export interface PaletteReply { id: string; swatches?: { hex: string; share: number; lab: Lab }[]; width?: number; height?: number; error?: string }

self.onmessage = async (e: MessageEvent<PaletteJob>) => {
  const job = e.data;
  try {
    const res = await fetch(job.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const scale = Math.min(1, job.sample / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const pts: Lab[] = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) pts.push(rgbToOklab(data[i], data[i + 1], data[i + 2]));
    // Drop clusters too small to matter, but never below the minimum palette size.
    const all = kmeans(pts, job.k, job.iterations);
    let swatches = all.filter(s => s.share >= job.minShare);
    if (swatches.length < job.minSwatches) swatches = all.slice(0, Math.min(job.minSwatches, all.length));
    const reply: PaletteReply = { id: job.id, swatches, width: bmp.width, height: bmp.height };
    bmp.close();
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) } satisfies PaletteReply);
  }
};
