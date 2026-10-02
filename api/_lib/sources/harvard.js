// @ts-check
/* Harvard Art Museums API (HARVARD_KEY). Images through IIIF at ids.lib.harvard.edu. */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

const FIELDS = 'id,title,people,dated,datebegin,primaryimageurl,images,url,classification,imagepermissionlevel,copyright,creditline';

/** @param {string} q @param {{ page: number, limit: number, env: Record<string, string | undefined> }} o */
export async function search(q, { page, limit, env }) {
  await rateLimit('harvard', 60);
  const r = await getJson(`https://api.harvardartmuseums.org/object?apikey=${encodeURIComponent(env.HARVARD_KEY || '')}&q=${encodeURIComponent(q)}&size=${limit}&page=${page}&hasimage=1&fields=${FIELDS}`);
  const results = (r.records || []).filter((/** @type {any} */ o) => o.imagepermissionlevel === 0 && (o.images?.length || o.primaryimageurl)).map((/** @type {any} */ o) => {
    const img = o.images?.[0];
    const iiif = img?.iiifbaseuri;
    return result({
      id: String(o.id), source: 'harvard',
      title: o.title, creator: str(o.people?.[0]?.name), date: str(o.dated), year: o.datebegin || null,
      imageUrl: iiif ? `${iiif}/full/1600,/0/default.jpg` : o.primaryimageurl,
      thumbUrl: iiif ? `${iiif}/full/400,/0/default.jpg` : o.primaryimageurl,
      width: img?.width ?? null, height: img?.height ?? null,
      license: str(o.copyright) || 'Harvard Art Museums; see the object page for rights', isPublicDomain: false,
      sourceUrl: o.url || `https://harvardartmuseums.org/collections/object/${o.id}`, type: str(o.classification),
    });
  });
  return { total: r.info?.totalrecords ?? results.length, results };
}
