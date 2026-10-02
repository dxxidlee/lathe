// @ts-check
/* Openverse (anonymous access is rate-limited; the 24 h caches absorb repeat queries). */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('openverse', 20);
  const r = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page=${page}&page_size=${Math.min(limit, 20)}`);
  const results = (r.results || []).map((/** @type {any} */ o) => {
    const lic = String(o.license || '').toLowerCase();
    const label = lic === 'pdm' ? 'Public Domain Mark' : lic === 'cc0' ? 'CC0' : `CC ${lic.toUpperCase()} ${o.license_version || ''}`.trim();
    return result({
      id: o.id, source: 'openverse',
      title: str(o.title) || 'Untitled', creator: str(o.creator), date: null,
      // Full-size through Openverse's own proxy keeps image hosts to one allowlisted domain.
      imageUrl: `https://api.openverse.org/v1/images/${o.id}/thumb/?full_size=true`, thumbUrl: o.thumbnail || `https://api.openverse.org/v1/images/${o.id}/thumb/`,
      width: o.width ?? null, height: o.height ?? null,
      license: `${label}${o.provider ? ` via ${o.provider}` : ''}`, isPublicDomain: lic === 'cc0' || lic === 'pdm',
      sourceUrl: o.foreign_landing_url || o.url, type: str(o.category) || 'image',
    });
  });
  return { total: r.result_count ?? results.length, results };
}
