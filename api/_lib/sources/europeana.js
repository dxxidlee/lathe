// @ts-check
/* Europeana Search API (EUROPEANA_KEY). Full images live on each provider's servers, which the
   allowlisted proxy cannot cover, so imageUrl is Europeana's own 400 px preview. */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

/** @param {string} uri */
function rightsLabel(uri) {
  if (/publicdomain\/zero/.test(uri)) return 'CC0';
  if (/publicdomain\/mark/.test(uri)) return 'Public Domain Mark';
  const cc = uri.match(/licenses\/([a-z-]+)\/([\d.]+)/);
  if (cc) return `CC ${cc[1].toUpperCase()} ${cc[2]}`;
  if (/InC-EDU/.test(uri)) return 'In copyright, educational use permitted';
  if (/InC/.test(uri)) return 'In copyright';
  if (/NoC/.test(uri)) return 'No copyright (see statement)';
  return 'See rights statement';
}

/** @param {string} q @param {{ page: number, limit: number, env: Record<string, string | undefined> }} o */
export async function search(q, { page, limit, env }) {
  await rateLimit('europeana', 60);
  const r = await getJson(`https://api.europeana.eu/record/v2/search.json?wskey=${encodeURIComponent(env.EUROPEANA_KEY || '')}&query=${encodeURIComponent(q)}&rows=${limit}&start=${(page - 1) * limit + 1}&media=true&thumbnail=true&qf=TYPE:IMAGE`);
  const results = (r.items || []).filter((/** @type {any} */ e) => e.edmPreview?.[0]).map((/** @type {any} */ e) => {
    const rights = str(e.rights) || '';
    const preview = String(e.edmPreview[0]).replace(/&size=w\d+/, '') + '&size=w400';
    return result({
      id: String(e.id).replace(/^\//, '').replace(/\//g, '_'), source: 'europeana',
      title: str(e.title) || 'Untitled', creator: str(e.dcCreator), date: str(e.year), year: e.year ? Number(String(e.year[0]).slice(0, 4)) || null : null,
      imageUrl: preview, thumbUrl: preview,
      license: `${rightsLabel(rights)}${e.dataProvider?.[0] ? `, ${e.dataProvider[0]}` : ''}`,
      isPublicDomain: /publicdomain\/(zero|mark)/.test(rights),
      sourceUrl: String(e.guid || '').replace(/\?.*$/, '') || 'https://www.europeana.eu', type: str(e.type)?.toLowerCase() ?? null,
    });
  });
  return { total: r.totalResults ?? results.length, results };
}
