/* The shared asset tray. Every dropped, fetched or exported file lands here, persists in
   IndexedDB, and is usable by every tool. */
import type { Asset, AssetAddOptions, AssetEvent, AssetsAPI } from '../tools/types';
import { idbAll, idbDelete, idbSet } from './idb';

const items = new Map<string, Asset>();
const listeners = new Set<(e: AssetEvent) => void>();
let ready: Promise<void> | null = null;

function emit(e: AssetEvent) {
  for (const cb of [...listeners]) {
    try { cb(e); } catch (err) { console.error('[lathe] asset listener', err); }
  }
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

async function probeDimensions(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    if (blob.type.startsWith('image/')) {
      if (blob.type === 'image/svg+xml') {
        const url = URL.createObjectURL(blob);
        try {
          const img = await new Promise<HTMLImageElement>((res, rej) => {
            const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
          });
          return { width: img.naturalWidth || undefined, height: img.naturalHeight || undefined };
        } finally { URL.revokeObjectURL(url); }
      }
      const bmp = await createImageBitmap(blob);
      const d = { width: bmp.width, height: bmp.height };
      bmp.close();
      return d;
    }
    if (blob.type.startsWith('video/')) {
      const url = URL.createObjectURL(blob);
      try {
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true;
        await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(); v.src = url; });
        return { width: v.videoWidth || undefined, height: v.videoHeight || undefined };
      } finally { URL.revokeObjectURL(url); }
    }
  } catch { /* undecodable: keep the asset, skip dimensions */ }
  return {};
}

export function loadAssets(): Promise<void> {
  if (!ready) {
    ready = idbAll<Asset>('assets').then(rows => {
      for (const a of rows.sort((x, y) => x.createdAt - y.createdAt)) if (a && a.id && a.blob) items.set(a.id, a);
    }).catch(e => { console.warn('[lathe] asset restore failed', e); });
  }
  return ready;
}

export const assets: AssetsAPI = {
  get: id => items.get(id),
  list: () => [...items.values()].sort((a, b) => b.createdAt - a.createdAt),
  async add(file, opts: AssetAddOptions = {}) {
    const name = opts.name ?? ((file as File).name || 'untitled');
    const asset: Asset = {
      id: uid(), name, type: file.type || 'application/octet-stream', size: file.size,
      createdAt: Date.now(), source: opts.source ?? 'drop', origin: opts.origin,
      blob: file, ...(await probeDimensions(file)),
    };
    items.set(asset.id, asset);
    await idbSet('assets', asset.id, asset);
    emit({ type: 'add', asset });
    return asset;
  },
  async remove(id) {
    if (!items.delete(id)) return;
    await idbDelete('assets', id);
    emit({ type: 'remove', id });
  },
  onChange(cb) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};

/* Hand an asset to a tool. A mounted tool gets a `load` event now; a tool that is still
   loading (e.g. after "Send to" switched routes) gets it right after it mounts. */
const mounted = new Set<string>();
const pending = new Map<string, Asset>();

export function loadInto(asset: Asset, target: string) {
  if (mounted.has(target)) emit({ type: 'load', asset, target });
  else pending.set(target, asset);
}

export function markMounted(toolId: string): () => void {
  mounted.add(toolId);
  const a = pending.get(toolId);
  if (a) { pending.delete(toolId); emit({ type: 'load', asset: a, target: toolId }); }
  return () => { mounted.delete(toolId); };
}

/* ---- Object URLs for thumbnails, cached per asset ---- */
const urls = new Map<string, string>();
export function assetUrl(a: Asset): string {
  let u = urls.get(a.id);
  if (!u) { u = URL.createObjectURL(a.blob); urls.set(a.id, u); }
  return u;
}
assets.onChange(e => {
  if (e.type === 'remove') { const u = urls.get(e.id); if (u) URL.revokeObjectURL(u); urls.delete(e.id); }
});
