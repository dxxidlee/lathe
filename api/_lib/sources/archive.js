// @ts-check
/* Internet Archive: advanced search for images, then each item's metadata for its largest web image. */
import { getJson, mapLimit, rateLimit } from '../http.js';
import { PD, result, str } from '../normalize.js';

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('archive', 60);
  const fl = ['identifier', 'title', 'creator', 'date', 'year', 'licenseurl', 'rights'].map(f => `fl[]=${f}`).join('&');
  const r = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:image`)}&${fl}&rows=${limit}&page=${page}&output=json`);
  const docs = r.response?.docs || [];
  const files = await mapLimit(docs, 6, async (/** @type {any} */ d) => {
    const m = await getJson(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}/files`, { timeout: 8000 });
    const web = (m.result || []).filter((/** @type {any} */ f) => /\.(jpe?g|png|gif)$/i.test(f.name) && !/thumb|_itemimage/i.test(f.name) && Number(f.size || 0) < 4e6);
    web.sort((/** @type {any} */ a, /** @type {any} */ b) => Number(b.size || 0) - Number(a.size || 0));
    return web[0] || null;
  });
  const results = docs.map((/** @type {any} */ d, /** @type {number} */ i) => {
    const f = files[i];
    const lic = str(d.licenseurl) || str(d.rights);
    return result({
      id: d.identifier, source: 'archive',
      title: str(d.title) || d.identifier, creator: str(d.creator),
      date: str(d.date)?.slice(0, 10) || (d.year ? String(d.year) : null), year: d.year ? Number(d.year) : null,
      imageUrl: f ? `https://archive.org/download/${encodeURIComponent(d.identifier)}/${encodeURIComponent(f.name)}` : `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      thumbUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      width: f?.width ? Number(f.width) : null, height: f?.height ? Number(f.height) : null,
      license: lic ? (lic.length > 140 ? lic.slice(0, 137) + '…' : lic) : 'Rights not stated; check the item',
      isPublicDomain: !!lic && PD.test(lic), sourceUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`, type: 'image',
    });
  });
  return { total: r.response?.numFound ?? results.length, results };
}
