// @ts-check
/* The Met Collection API. v1/search was retired on 2026-10-01; v1.1/search is paginated. */
import { getJson, mapLimit, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

const BASE = 'https://collectionapi.metmuseum.org/public/collection';

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('met', 600);
  const s = await getJson(`${BASE}/v1.1/search?q=${encodeURIComponent(q)}&hasImages=true&limit=${limit}&offset=${(page - 1) * limit}`);
  const ids = (s.objectIDs || []).slice(0, limit);
  const objs = await mapLimit(ids, 8, async (/** @type {number} */ id) => { await rateLimit('met', 600); return getJson(`${BASE}/v1/objects/${id}`, { timeout: 8000 }); });
  const results = objs.filter(o => o && o.primaryImageSmall).map(o => result({
    id: String(o.objectID), source: 'met',
    title: o.title, creator: str(o.artistDisplayName) || str(o.culture) || null,
    date: str(o.objectDate), year: o.objectBeginDate || null,
    // web-large (~1–2k px) is deck-sized; originals run to tens of MB, past the proxy's 4 MB cap.
    imageUrl: o.primaryImageSmall || o.primaryImage, thumbUrl: o.primaryImageSmall,
    license: o.isPublicDomain ? 'Public domain (CC0), The Met Open Access' : 'In copyright; see The Met',
    isPublicDomain: !!o.isPublicDomain, sourceUrl: o.objectURL, type: str(o.classification) || str(o.objectName),
  }));
  return { total: s.total ?? results.length, results };
}
