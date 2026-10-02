/* Audit client: source list, per-source search with a 24 h IndexedDB cache, and the palette queue. */
import { cacheGet, cacheSet } from '../../lib/idb';
import type { Swatch } from '../../lib/color';
import type { PaletteJob, PaletteReply } from './palette.worker';

export interface AuditResult {
  id: string; source: string; title: string; creator: string | null; date: string | null; year: number | null;
  imageUrl: string; thumbUrl: string; width: number | null; height: number | null;
  license: string; isPublicDomain: boolean; sourceUrl: string; type: string | null;
  palette?: string[];
}
export interface SourceInfo { id: string; name: string; homepage: string; needsKey: boolean; available: boolean }
export interface SourcePage { source: string; query: string; page: number; total: number; results: AuditResult[]; ms: number; error?: string; cached?: boolean }

export const proxied = (url: string) => `/api/img?url=${encodeURIComponent(url)}`;

export async function listSources(): Promise<SourceInfo[]> {
  try {
    const r = await fetch('/api/sources');
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).sources;
  } catch (e) {
    console.warn('[audit] /api/sources unavailable', e);
    return [];
  }
}

export async function searchSource(id: string, q: string, page: number, cacheHours: number, signal?: AbortSignal): Promise<SourcePage> {
  const key = `audit:${id}:${q.toLowerCase()}:${page}`;
  const hit = await cacheGet<SourcePage>(key);
  if (hit) return { ...hit, cached: true };
  const t0 = performance.now();
  const r = await fetch(`/api/sources/${encodeURIComponent(id)}?q=${encodeURIComponent(q)}&page=${page}`, { signal });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || body.error) return { source: id, query: q, page, total: 0, results: [], ms: Math.round(performance.now() - t0), error: body.error || `HTTP ${r.status}` };
  await cacheSet(key, body, cacheHours * 3600_000);
  return body as SourcePage;
}

/* ---- palettes: a worker pool, cached per thumbnail ---- */
export interface PaletteOpts { k: number; sample: number; iterations: number; minShare: number; minSwatches: number; cacheHours: number }
interface PaletteResult { swatches: Swatch[]; width?: number; height?: number }

export class PaletteQueue {
  private workers: Worker[] = [];
  private waiting = new Map<string, (r: PaletteReply) => void>();
  private queue: PaletteJob[] = [];
  private busy = new Set<Worker>();
  constructor(private opts: PaletteOpts, size = 3) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./palette.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<PaletteReply>) => { this.busy.delete(w); this.waiting.get(e.data.id)?.(e.data); this.waiting.delete(e.data.id); this.pump(); };
      this.workers.push(w);
    }
  }
  private pump() {
    for (const w of this.workers) {
      if (this.busy.has(w) || !this.queue.length) continue;
      this.busy.add(w); w.postMessage(this.queue.shift());
    }
  }
  async get(id: string, thumbUrl: string): Promise<PaletteResult | null> {
    const key = `palette:${this.opts.k}:${this.opts.minSwatches}:${this.opts.sample}:${thumbUrl}`;
    const hit = await cacheGet<PaletteResult>(key);
    if (hit) return hit;
    const reply = await new Promise<PaletteReply>(res => {
      this.waiting.set(id, res);
      this.queue.push({ id, url: proxied(thumbUrl), k: this.opts.k, sample: this.opts.sample, iterations: this.opts.iterations, minShare: this.opts.minShare, minSwatches: this.opts.minSwatches });
      this.pump();
    });
    if (reply.error || !reply.swatches) return null;
    const out = { swatches: reply.swatches, width: reply.width, height: reply.height };
    await cacheSet(key, out, this.opts.cacheHours * 3600_000);
    return out;
  }
  cancelPending() { this.queue = []; for (const [, r] of this.waiting) r({ id: '', error: 'cancelled' }); this.waiting.clear(); }
  destroy() { this.cancelPending(); this.workers.forEach(w => w.terminate()); }
}
