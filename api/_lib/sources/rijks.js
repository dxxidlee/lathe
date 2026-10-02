// @ts-check
/* Rijksmuseum Linked Art search (keyless). The keyed collection API (RIJKS_KEY) returns 410 Gone.
   Search returns object ids; each object resolves through its VisualItem and DigitalObject to an
   IIIF image at iiif.micr.io. */
import { getJson, mapLimit, rateLimit } from '../http.js';
import { result, yearFrom } from '../normalize.js';

const LD = { Accept: 'application/ld+json' };
const EN = 'http://vocab.getty.edu/aat/300388277';
/** @param {string} id */
const get = id => getJson(id, { headers: LD, timeout: 8000 });

/** First Person referenced anywhere in a Linked Art node. @param {any} node @returns {string | null} */
function findPerson(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Person' && typeof node.id === 'string') return node.id;
  for (const v of Array.isArray(node) ? node : Object.values(node)) { const f = findPerson(v); if (f) return f; }
  return null;
}

/** @param {any[]} ids @param {string} [lang] */
function name(ids, lang = EN) {
  const names = (ids || []).filter(x => x.type === 'Name');
  return (names.find(n => (n.language || []).some((/** @type {any} */ l) => l.id === lang)) || names[0])?.content || null;
}

/** @param {string} q @param {{ page: number, limit: number }} o */
export async function search(q, { page, limit }) {
  await rateLimit('rijks', 120);
  const per = Math.min(limit, 12); // each result costs three or four lookups
  const s = await getJson(`https://data.rijksmuseum.nl/search/collection?title=${encodeURIComponent(q)}&imageAvailable=true`, { headers: LD });
  const ids = (s.orderedItems || []).slice((page - 1) * per, page * per).map((/** @type {any} */ i) => i.id);
  const rows = await mapLimit(ids, 6, async (/** @type {string} */ id) => {
    const o = await get(id);
    const visual = o.shows?.[0]?.id ? await get(o.shows[0].id) : null;
    const digital = visual?.digitally_shown_by?.[0]?.id ? await get(visual.digitally_shown_by[0].id) : null;
    const iiif = digital?.access_point?.[0]?.id;
    if (!iiif) return null;
    // Makers sit at produced_by.carried_out_by, or nested inside parts and attribution assignments.
    const makerId = findPerson(o.produced_by);
    const maker = makerId ? await get(makerId).then(p => name(p.identified_by), () => null) : null;
    const rightsId = (visual?.subject_to || []).flatMap((/** @type {any} */ r) => r.classified_as || []).map((/** @type {any} */ c) => c.id).find(Boolean) || '';
    const pd = /publicdomain|NoC/.test(rightsId);
    const date = name(o.produced_by?.timespan?.identified_by) || null;
    const page_ = (o.subject_of || []).flatMap((/** @type {any} */ s) => s.digitally_carried_by || []).flatMap((/** @type {any} */ d) => d.access_point || [])[0]?.id;
    const objNo = (o.identified_by || []).find((/** @type {any} */ x) => x.type === 'Identifier')?.content;
    return result({
      id: String(id).split('/').pop() || objNo || id, source: 'rijks',
      title: name(o.identified_by) || objNo || 'Untitled', creator: maker, date,
      year: yearFrom(o.produced_by?.timespan?.begin_of_the_begin, date),
      imageUrl: iiif.replace('/full/max/', '/full/1600,/'), thumbUrl: iiif.replace('/full/max/', '/full/400,/'),
      license: pd ? 'Public domain, Rijksmuseum' : /InC/.test(rightsId) ? 'In copyright, Rijksmuseum' : 'See the Rijksmuseum record',
      isPublicDomain: pd, sourceUrl: page_ || `https://www.rijksmuseum.nl/en/collection/${objNo || ''}`, type: null,
    });
  });
  const results = rows.filter(Boolean);
  return { total: s.partOf?.totalItems ?? results.length, results: /** @type {any[]} */ (results) };
}
