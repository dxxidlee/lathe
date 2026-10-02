/* Resolve image tiles to bytes for export: remote URLs go through the same-origin /api/img proxy
   (so canvas, PDF and PPTX can embed them), tray assets come from IndexedDB. Large images are
   downscaled to keep decks portable. Results are cached for the session. */
import type { AssetsAPI } from '../types';

export interface ResolvedImage { dataUrl: string; w: number; h: number; mime: string }

const cache = new Map<string, Promise<ResolvedImage>>();
export const proxied = (url: string, fallback?: string) => `/api/img?url=${encodeURIComponent(url)}${fallback && fallback !== url ? `&fallback=${encodeURIComponent(fallback)}` : ''}`;

async function blobFor(src: string, assets: AssetsAPI, fallback?: string): Promise<Blob> {
  if (src.startsWith('asset:')) {
    const a = assets.get(src.slice(6));
    if (!a) throw new Error('Tray file is gone');
    return a.blob;
  }
  if (src.startsWith('data:')) return (await fetch(src)).blob();
  const res = await fetch(proxied(src, fallback));
  if (!res.ok) throw new Error(`Image ${res.status}`);
  return res.blob();
}

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });

export function resolveImage(src: string, assets: AssetsAPI, maxPx: number, fallback?: string): Promise<ResolvedImage> {
  const key = `${src}|${maxPx}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const blob = await blobFor(src, assets, fallback);
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
      const keepAlpha = blob.type === 'image/png' || blob.type === 'image/webp' || blob.type === 'image/gif' || blob.type === 'image/svg+xml';
      if (scale === 1 && /^image\/(jpeg|png)$/.test(blob.type)) {
        const out = { dataUrl: await toDataUrl(blob), w: bmp.width, h: bmp.height, mime: blob.type };
        bmp.close(); return out;
      }
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const mime = keepAlpha ? 'image/png' : 'image/jpeg';
      return { dataUrl: cv.toDataURL(mime, 0.9), w, h, mime };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Crop an image to an aspect ratio (cover) for formats without native cropping (PDF). */
export async function coverCrop(img: ResolvedImage, aspect: number, maxPx: number): Promise<string> {
  const el = new Image();
  el.src = img.dataUrl;
  await el.decode();
  let sw = img.w, sh = img.h;
  if (img.w / img.h > aspect) sw = img.h * aspect; else sh = img.w / aspect;
  const sx = (img.w - sw) / 2, sy = (img.h - sh) / 2;
  const scale = Math.min(1, maxPx / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * scale)); cv.height = Math.max(1, Math.round(sh * scale));
  cv.getContext('2d')!.drawImage(el, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv.toDataURL(img.mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
}
