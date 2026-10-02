// @ts-check
/* Are.na v3 search. CLAUDE.md lists public search as keyless, but as of 2026-10 v3 search returns
   401 without a token and v2 sits behind a bot challenge, so this source needs ARENA_TOKEN. */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

/** @param {string} q @param {{ page: number, limit: number, env: Record<string, string | undefined> }} o */
export async function search(q, { page, limit, env }) {
  await rateLimit('arena', 60);
  const r = await getJson(`https://api.are.na/v3/search?query=${encodeURIComponent(q)}&type=Image&page=${page}&per=${limit}`,
    { headers: { Authorization: `Bearer ${env.ARENA_TOKEN}` } });
  const results = (r.data || []).filter((/** @type {any} */ b) => b.type === 'Image' && b.image?.src).map((/** @type {any} */ b) => result({
    id: String(b.id), source: 'arena',
    title: str(b.title) || str(b.image.filename) || 'Untitled', creator: str(b.source?.provider?.name) || null, date: null,
    imageUrl: b.image.large?.src || b.image.src, thumbUrl: b.image.medium?.src || b.image.small?.src || b.image.src,
    width: b.image.width ?? null, height: b.image.height ?? null,
    license: 'Rights unknown; saved to Are.na, check the original source', isPublicDomain: false,
    sourceUrl: b.source?.url || `https://www.are.na/block/${b.id}`, type: 'image',
  }));
  return { total: r.meta?.total_count ?? r.total ?? results.length, results };
}
