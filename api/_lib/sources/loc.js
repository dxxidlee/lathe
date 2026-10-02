// @ts-check
/* Library of Congress: Prints & Photographs search. */
import { getJson, rateLimit } from '../http.js';
import { PD, result, str } from '../normalize.js';

/** "https://…jpg#h=640&w=524" → { url, w, h } @param {string} u */
function sized(u) {
  const m = u.match(/#h=(\d+)&w=(\d+)/);
  return { url: u.replace(/#.*$/, ''), h: m ? Number(m[1]) : 0, w: m ? Number(m[2]) : 0 };
}

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('loc', 60);
  const r = await getJson(`https://www.loc.gov/photos/?q=${encodeURIComponent(q)}&fo=json&c=${limit}&sp=${page}`);
  const results = (r.results || []).filter((/** @type {any} */ x) => Array.isArray(x.image_url) && x.image_url.length).map((/** @type {any} */ x) => {
    const imgs = x.image_url.map(sized).sort((/** @type {any} */ a, /** @type {any} */ b) => a.w - b.w);
    const big = imgs[imgs.length - 1], thumb = imgs.find((/** @type {any} */ i) => i.w >= 300) || big;
    const rights = str(x.item?.rights_advisory) || str(x.rights);
    return result({
      id: String(x.id || x.url).replace(/^https?:\/\/[^/]+\//, ''), source: 'loc',
      title: x.title, creator: str(x.contributor) || str(x.item?.contributors),
      date: str(x.date), imageUrl: big.url, thumbUrl: thumb.url,
      width: big.w || null, height: big.h || null,
      license: rights || 'Library of Congress; check rights on the item page',
      isPublicDomain: !!rights && PD.test(rights),
      sourceUrl: String(x.url || x.id).replace(/^\/\//, 'https://'), type: str(x.original_format),
    });
  });
  return { total: r.pagination?.of ?? results.length, results };
}
