// @ts-check
/* Cooper Hewitt GraphQL API (keyless; 1 request/second, 30/minute). The REST API that took
   COOPER_HEWITT_KEY now redirects elsewhere. */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

const QUERY = `query($q:String,$size:Int,$page:Int){object(general:$q,hasImages:true,size:$size,page:$page){
  id title name summary date classification maker{summary} identifier legal multimedia }}`;

/** @param {any} v */
const first = v => (Array.isArray(v) ? v[0] : v);

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('cooperhewitt', 28);
  const url = `https://api.cooperhewitt.org/?query=${encodeURIComponent(QUERY)}&variables=${encodeURIComponent(JSON.stringify({ q, size: limit, page: page - 1 }))}`;
  const r = await getJson(url);
  if (r.errors) throw new Error(r.errors[0]?.message || 'GraphQL error');
  const results = (r.data?.object || []).map((/** @type {any} */ o) => {
    const media = (o.multimedia || []).find((/** @type {any} */ m) => m.type === 'image' && (m.large?.url || m.preview?.url));
    if (!media) return null;
    const dims = (/** @type {any} */ v) => Object.fromEntries((v?.measurements?.dimensions || []).map((/** @type {any} */ d) => [d.dimension, d.value]));
    const big = media.large || media.preview, size = dims(big);
    const legacy = (o.identifier || []).find((/** @type {any} */ i) => /legacy collections online id/i.test(i.type))?.value;
    const rights = (o.legal?.rights || []).map((/** @type {any} */ x) => x.details).filter(Boolean).join('; ');
    return result({
      id: String(o.id).replace(/^object-/, ''), source: 'cooperhewitt',
      title: o.summary?.title || str(first(o.title)?.value) || 'Untitled',
      creator: str(first(o.maker)?.summary?.title), date: str(first(o.date)?.value),
      year: Number(first(o.date)?.from) || null,
      imageUrl: big.url, thumbUrl: media.preview?.url || big.url,
      width: size.width ?? null, height: size.height ?? null,
      license: media.cc0 ? 'CC0, Cooper Hewitt, Smithsonian Design Museum' : (o.legal?.reproduction?.credit || rights || 'Rights restricted; see Cooper Hewitt'),
      isPublicDomain: !!media.cc0,
      sourceUrl: legacy ? `https://collection.cooperhewitt.org/objects/${legacy}/` : 'https://collection.cooperhewitt.org',
      type: str(first(o.classification)?.summary?.title),
    });
  }).filter(Boolean);
  return { total: r.extensions?.pagination?.hits ?? results.length, results: /** @type {any[]} */ (results) };
}
