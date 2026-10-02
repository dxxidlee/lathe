// @ts-check
/* Wikimedia Commons: File-namespace search with image info and license metadata. */
import { getJson, rateLimit } from '../http.js';
import { PD, result, stripHtml } from '../normalize.js';

const WEB = /^image\/(jpeg|png|gif|webp)$/;

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('wikimedia', 120);
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + `&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=${limit}&gsroffset=${(page - 1) * limit}`
    + '&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=640';
  const r = await getJson(url);
  const pages = Object.values(r.query?.pages || {}).sort((/** @type {any} */ a, /** @type {any} */ b) => a.index - b.index);
  const results = pages.filter((/** @type {any} */ p) => p.imageinfo?.[0]).map((/** @type {any} */ p) => {
    const ii = p.imageinfo[0], m = ii.extmetadata || {};
    const lic = stripHtml(m.LicenseShortName?.value) || 'See file page';
    const date = stripHtml(m.DateTimeOriginal?.value);
    return result({
      id: String(p.pageid), source: 'wikimedia',
      title: stripHtml(m.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      creator: stripHtml(m.Artist?.value), date,
      // Originals up to 1920 px wide as-is; larger ones (or non-web formats) as a 1920 px thumbnail.
      imageUrl: WEB.test(ii.mime) && (ii.width || 0) <= 1920 ? ii.url : String(ii.thumburl).replace(/\/\d+px-/, '/1920px-'),
      thumbUrl: ii.thumburl, width: ii.width ?? null, height: ii.height ?? null,
      license: lic, isPublicDomain: PD.test(lic) || /^pd/i.test(lic), sourceUrl: ii.descriptionurl, type: ii.mime,
    });
  });
  return { total: r.query?.searchinfo?.totalhits ?? results.length, results };
}
