// @ts-check
/* Art Institute of Chicago API (IIIF images). */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

const FIELDS = 'id,title,artist_display,date_display,date_start,image_id,thumbnail,is_public_domain,artwork_type_title,copyright_notice';

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('aic', 60);
  const r = await getJson(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}&fields=${FIELDS}`, { headers: { 'AIC-User-Agent': 'LatheAudit/0.1' } });
  const iiif = r.config?.iiif_url || 'https://www.artic.edu/iiif/2';
  const results = (r.data || []).filter((/** @type {any} */ a) => a.image_id).map((/** @type {any} */ a) => result({
    id: String(a.id), source: 'aic',
    title: a.title, creator: str(String(a.artist_display || '').split('\n')[0]),
    date: str(a.date_display), year: a.date_start ?? null,
    imageUrl: `${iiif}/${a.image_id}/full/1686,/0/default.jpg`, thumbUrl: `${iiif}/${a.image_id}/full/400,/0/default.jpg`,
    width: a.thumbnail?.width ?? null, height: a.thumbnail?.height ?? null,
    license: a.is_public_domain ? 'Public domain (CC0), Art Institute of Chicago' : (str(a.copyright_notice) || 'In copyright; see the Art Institute'),
    isPublicDomain: !!a.is_public_domain, sourceUrl: `https://www.artic.edu/artworks/${a.id}`, type: str(a.artwork_type_title),
  }));
  return { total: r.pagination?.total ?? results.length, results };
}
