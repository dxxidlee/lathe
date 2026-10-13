/* Shared input and output plumbing for the image tools (Palette, Dither, Vectorize, Cutout):
   take images from a drop, the tray, "Send to" or a URL; restore the last one on mount; decode to
   pixels; and hand results on to other tools. */
import type { Asset, AssetsAPI, EmitFn, SettingsAPI } from '../tools/types';
import { matchesAccept } from '../tools/types';
import { TOOLS, isReady } from '../tools/registry';
import { button, field, select } from '../ui/primitives';

export interface ImageInput {
  /** "From URL" field + button, for the inspector. */
  urlEl: HTMLElement;
  /** "Choose file" button + hidden file input, for the inspector. */
  fileEl: HTMLElement;
  current(): Asset | undefined;
  off(): void;
}

/**
 * Wire a tool to image assets. `onLoad` gets every image handed to the tool (and the last one on
 * mount). Non-images are refused with a toast.
 */
export function imageInput(o: { toolId: string; name: string; assets: AssetsAPI; settings: SettingsAPI; emit: EmitFn; onLoad: (a: Asset) => void; accepts?: (type: string) => boolean; acceptAttr?: string; multiple?: boolean }): ImageInput {
  let cur: Asset | undefined;
  const ok = o.accepts ?? ((t: string) => t.startsWith('image/'));
  const take = (a: Asset) => {
    if (!ok(a.type)) { o.emit('toast', `${o.name} takes images, not ${a.type || 'this file'}`); return; }
    cur = a; o.settings.set('lastAsset', a.id); o.onLoad(a);
  };
  const off = o.assets.onChange(e => { if (e.type === 'load' && e.target === o.toolId) take(e.asset); });

  const row = document.createElement('div'); row.className = 'l-row l-url';
  const f = field({ label: 'From URL', value: '', placeholder: 'https://…/image.jpg or a page', onChange: () => {} });
  const go = button({ label: 'Fetch', onClick: () => void fetchUrl() });
  f.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void fetchUrl(); } });
  row.append(f.el, go);
  async function fetchUrl() {
    const url = f.input.value.trim();
    if (!url) { o.emit('toast', 'Paste an image URL'); return; }
    go.disabled = true;
    try {
      const r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || `HTTP ${r.status}`); }
      const blob = await r.blob();
      const a = await o.assets.add(blob, { name: r.headers.get('x-lathe-filename') || 'image', source: 'fetch' });
      take(a);
      f.input.value = '';
    } catch (e) { o.emit('toast', `Could not fetch: ${e instanceof Error ? e.message : e}`); }
    finally { go.disabled = false; }
  }

  /* ---- File picker button ---- */
  const fileRow = document.createElement('div'); fileRow.className = 'l-row';
  const fileIn = document.createElement('input');
  Object.assign(fileIn, { type: 'file', accept: o.acceptAttr ?? 'image/*', multiple: o.multiple ?? false, hidden: true });
  fileIn.addEventListener('change', async () => {
    const files = fileIn.files; if (!files) return;
    for (const f of Array.from(files)) {
      const a = await o.assets.add(f, { name: f.name, source: 'drop' });
      take(a);
    }
    fileIn.value = '';
  });
  const pickBtn = button({ label: 'Choose file', onClick: () => fileIn.click() });
  pickBtn.style.minHeight = '44px';
  fileRow.append(pickBtn, fileIn);

  queueMicrotask(() => { if (cur) return; const last = o.assets.get(o.settings.get<string>('lastAsset', '')); if (last && ok(last.type)) take(last); });
  return { urlEl: row, fileEl: fileRow, current: () => cur, off };
}

/** Decode an image blob to pixels, longest edge at most `maxPx` (SVGs are drawn at that size). */
export async function decodePixels(blob: Blob, maxPx: number): Promise<{ data: ImageData; srcW: number; srcH: number }> {
  let src: CanvasImageSource, w: number, h: number, close = () => {};
  if (blob.type !== 'image/svg+xml') {
    try { const b = await createImageBitmap(blob); src = b; w = b.width; h = b.height; close = () => b.close(); }
    catch { ({ src, w, h } = await viaImg(blob, maxPx)); }
  } else ({ src, w, h } = await viaImg(blob, maxPx));
  const s = Math.min(1, maxPx / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const cv = new OffscreenCanvas(cw, ch);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, cw, ch);
  close();
  return { data: ctx.getImageData(0, 0, cw, ch), srcW: w, srcH: h };
}
async function viaImg(blob: Blob, maxPx: number) {
  const url = URL.createObjectURL(blob);
  const img = new Image(); img.src = url;
  try { await img.decode(); } finally { URL.revokeObjectURL(url); }
  let w = img.naturalWidth || maxPx, h = img.naturalHeight || maxPx;
  if (blob.type === 'image/svg+xml') { const a = w / h; w = a >= 1 ? maxPx : Math.round(maxPx * a); h = a >= 1 ? Math.round(maxPx / a) : maxPx; }
  return { src: img as CanvasImageSource, w, h };
}

export const canvasBlob = (cv: HTMLCanvasElement | OffscreenCanvas, type = 'image/png', quality?: number): Promise<Blob> =>
  cv instanceof OffscreenCanvas ? cv.convertToBlob({ type, quality })
    : new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('Could not encode'))), type, quality));

/** "Send to" control for a tool's latest output: a select of tools that accept it, and a button. */
export function sendControl(o: { from: string; type: () => string | null; get: () => Promise<Asset | null>; emit: EmitFn }) {
  const row = document.createElement('div'); row.className = 'l-row l-send';
  const targets = () => TOOLS.filter(t => isReady(t) && t.id !== o.from && matchesAccept(o.type() ?? '', t.accepts));
  const sel = select<string>({ label: 'Send result to', value: '', options: [], onChange: () => {} });
  const btn = button({ label: 'Send', onClick: async () => {
    const id = sel.input.value; if (!id) return;
    const a = await o.get(); if (a) o.emit('send', a, id);
  } });
  row.append(sel.el, btn);
  const refresh = () => {
    const list = targets();
    sel.setOptions(list.map(t => ({ value: t.id, label: t.name })), list[0]?.id ?? '');
    btn.disabled = !list.length || !o.type();
  };
  refresh();
  return { el: row, refresh };
}
