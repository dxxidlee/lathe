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

export interface BrandFeatures { capture: boolean; screenshots: boolean; screenshotsLimited: boolean; brandfetch: boolean; observations: boolean; instagram?: boolean }
interface Catalog { sources: SourceInfo[]; brand: BrandFeatures | null }
let catalog: Promise<Catalog> | null = null;

/** /api/sources, once per session: the sources and which brand features the keys unlock. */
export function fetchCatalog(): Promise<Catalog> {
  catalog ??= (async () => {
    try {
      const r = await fetch('/api/sources');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      return { sources: j.sources, brand: j.brand ?? null };
    } catch (e) {
      console.warn('[audit] /api/sources unavailable', e);
      catalog = null;
      return { sources: [], brand: null };
    }
  })();
  return catalog;
}
export const listSources = async (): Promise<SourceInfo[]> => (await fetchCatalog()).sources;

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

const STOPWORDS = new Set([
  'a','an','the','and','or','of','in','on','at','to','for','is','it','by','as','be','no','not','with','from','this','that','which',
  'la','le','les','de','des','du','un','une','et','en','au','aux','ce','se','ne','pas','sur','par','pour','dans','est','son','sa',
  'el','los','las','del','al','es','en','con','por','una','su','se','no','como','pero','sus',
  'il','lo','gli','di','da','del','della','dei','che','non','per','con','una','suo','sua',
  'der','die','das','den','dem','des','ein','eine','und','ist','von','zu','mit','auf','fur','nicht','im','an',
  'het','de','een','van','en','op','te','met','voor','dat','zijn','niet','er','als',
]);

/** Score a result's relevance to the query. Higher is better.
 *  Returns a baseline of 1 for every result (the source API considered it relevant).
 *  Only returns 0 for results that match exclusively on excluded terms. */
export function scoreRelevance(result: AuditResult, query: string, exclude: string[] = []): number {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(t => t.length > 1 && !STOPWORDS.has(t.toLowerCase()));
  if (!terms.length) return 1;

  const title = (result.title || '').toLowerCase();
  const desc = ((result.creator || '') + ' ' + (result.date || '') + ' ' + (result.type || '')).toLowerCase();
  const all = title + ' ' + desc;

  // Only zero out results whose title matches ONLY an excluded term and nothing else
  for (const ex of exclude) {
    const exl = ex.toLowerCase();
    if (title.includes(exl) && !terms.some(t => t !== exl && all.includes(t))) return 0;
  }

  let score = 0;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordMatch = (text: string, term: string) => new RegExp(`(?:^|[\\s,;:.!?"\\'\\-])${esc(term)}(?:[\\s,;:.!?"\\'\\-]|$)`, 'i').test(text);

  // Full phrase match in title
  if (title.includes(q)) score += 100;

  // Whole-word term matches in title
  const titleWordHits = terms.filter(t => wordMatch(title, t));
  if (titleWordHits.length === terms.length) score += 50;
  else score += titleWordHits.length * 15;

  // Substring matches in title (catches partial/compound words)
  const titleSubHits = terms.filter(t => title.includes(t) && !titleWordHits.includes(t));
  score += titleSubHits.length * 5;

  // Matches in description/creator
  const descHits = terms.filter(t => all.includes(t));
  score += descHits.length * 3;

  // At least one query term must appear somewhere in the result's text
  if (score === 0) return 0;

  return score;
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
  /** Palette of a remote thumbnail, fetched through the image proxy. */
  get(id: string, thumbUrl: string): Promise<PaletteResult | null> {
    return this.run(id, proxied(thumbUrl), thumbUrl);
  }
  /** Palette of a same-origin or blob: URL; `cacheId` names it in the cache (null: do not cache). */
  async run(id: string, url: string, cacheId: string | null): Promise<PaletteResult | null> {
    const key = cacheId && `palette:${this.opts.k}:${this.opts.minSwatches}:${this.opts.sample}:${cacheId}`;
    const hit = key ? await cacheGet<PaletteResult>(key) : undefined;
    if (hit) return hit;
    const reply = await new Promise<PaletteReply>(res => {
      this.waiting.set(id, res);
      this.queue.push({ id, url, k: this.opts.k, sample: this.opts.sample, iterations: this.opts.iterations, minShare: this.opts.minShare, minSwatches: this.opts.minSwatches });
      this.pump();
    });
    if (reply.error || !reply.swatches) return null;
    const out = { swatches: reply.swatches, width: reply.width, height: reply.height };
    if (key) await cacheSet(key, out, this.opts.cacheHours * 3600_000);
    return out;
  }
  cancelPending() { this.queue = []; for (const [, r] of this.waiting) r({ id: '', error: 'cancelled' }); this.waiting.clear(); }
  destroy() { this.cancelPending(); this.workers.forEach(w => w.terminate()); }
}
