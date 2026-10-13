// @ts-check
/* GET /api/sources/:source?q=&page= → { source, query, page, total, results, ms } in the normalized schema.
   GET /api/sources (no :source) → the source catalog with brand features. */
import { SOURCES, findSource, isAvailable } from '../_lib/sources/index.js';
import { json } from '../_lib/http.js';
import { brandFeatures } from '../_lib/brand.js';

const LIMIT = 24;

/** @param {Request} request */
export async function GET(request) {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const id = segments.length > 1 ? decodeURIComponent(segments.pop() || '') : '';
  // /api/sources with no :source → catalog
  if (!id || id === 'sources') {
    return json({
      sources: SOURCES.map(s => ({ id: s.id, name: s.name, homepage: s.homepage, needsKey: !!s.key, available: isAvailable(s, process.env) })),
      brand: brandFeatures(process.env),
    }, { cache: 'no-store' });
  }
  const src = findSource(id);
  if (!src) return json({ error: `Unknown source "${id}"` }, { status: 404 });
  if (!isAvailable(src, process.env) || !src.search) return json({ error: `${src.name} is not available` }, { status: 404 });
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return json({ error: 'Missing ?q=' }, { status: 400 });
  const page = Math.max(1, Math.min(20, parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const t0 = Date.now();
  try {
    const r = await src.search(q, { page, limit: LIMIT, env: process.env });
    return json({ source: src.id, query: q, page, total: r.total, results: r.results, ms: Date.now() - t0 });
  } catch (e) {
    return json({ source: src.id, query: q, page, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }, { status: 502 });
  }
}
