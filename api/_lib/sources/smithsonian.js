// @ts-check
/* Smithsonian Open Access (api.data.gov key in SMITHSONIAN_KEY). */
import { getJson, rateLimit } from '../http.js';
import { result, str, yearFrom } from '../normalize.js';

/** @param {string} q @param {{ page: number, limit: number, env: Record<string, string | undefined> }} o */
export async function search(q, { page, limit, env }) {
  await rateLimit('smithsonian', 60);
  // The Open Access API includes media URLs only for CC0 items, so ask for those.
  const query = `${q} AND online_media_type:"Images" AND media_usage:"CC0"`;
  const r = await getJson(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(query)}&start=${(page - 1) * limit}&rows=${limit}&api_key=${encodeURIComponent(env.SMITHSONIAN_KEY || '')}`);
  const rows = r.response?.rows || [];
  const results = rows.map((/** @type {any} */ row) => {
    const c = row.content || {}, d = c.descriptiveNonRepeating || {};
    const m = (d.online_media?.media || []).find((/** @type {any} */ x) => x.type === 'Images' && x.content);
    if (!m) return null;
    const ids = (/** @type {number} */ max) => (/ids\.si\.edu\/ids\/deliveryService/.test(m.content) ? `${m.content}${m.content.includes('?') ? '&' : '?'}max=${max}` : m.content);
    const date = str(c.freetext?.date?.[0]?.content) || str(c.indexedStructured?.date?.[0]);
    const cc0 = m.usage?.access === 'CC0';
    return result({
      id: String(row.id), source: 'smithsonian',
      title: row.title, creator: str(c.freetext?.name?.[0]?.content), date, year: yearFrom(date),
      imageUrl: ids(1600), thumbUrl: ids(400),
      license: cc0 ? 'CC0, Smithsonian Open Access' : 'Usage conditions apply; see the Smithsonian record',
      isPublicDomain: cc0, sourceUrl: d.record_link || d.guid || 'https://www.si.edu/openaccess',
      type: str(c.indexedStructured?.object_type?.[0]),
    });
  }).filter(Boolean);
  return { total: r.response?.rowCount ?? results.length, results: /** @type {any[]} */ (results) };
}
