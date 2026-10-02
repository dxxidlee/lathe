// @ts-check
/* Brand audit helpers: resolve a company name to its website (Wikidata P856), Brandfetch's official
   assets (BRANDFETCH_KEY), and which brand features the deployment's keys unlock. */
import { getJson, mapLimit } from './http.js';
import { fetchImageData, LIMITS } from './site.js';

/** Which brand-mode features are on. Never returns key values. @param {Record<string, string | undefined>} env */
export const brandFeatures = env => ({
  capture: true,
  screenshots: true,                     // Microlink's free tier works without a key
  screenshotsLimited: !env.MICROLINK_KEY, // the free tier has a small daily quota; MICROLINK_KEY lifts it
  brandfetch: !!env.BRANDFETCH_KEY,
  observations: !!env.ANTHROPIC_API_KEY,
});

/** Input that looks like a domain or URL rather than a company name. @param {string} q */
export const looksLikeDomain = q => /^(https?:\/\/)?([^\s/]+\.[a-z]{2,}|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|localhost)(:\d+)?(\/\S*)?$/i.test(q.trim());

/**
 * Company name → official website via Wikidata (the first match that has P856, preferring an exact
 * label or alias match).
 * @param {string} name
 * @returns {Promise<{ name: string, description: string | null, website: string, wikidata: string } | null>}
 */
export async function resolveCompany(name) {
  const api = 'https://www.wikidata.org/w/api.php';
  const s = await getJson(`${api}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=8&format=json`);
  const hits = /** @type {any[]} */ (s.search || []);
  if (!hits.length) return null;
  const e = await getJson(`${api}?action=wbgetentities&ids=${hits.map(h => h.id).join('|')}&props=claims|labels|descriptions&languages=en&format=json`);
  const exact = (/** @type {any} */ h) => [h.label, ...(h.aliases || []), h.match?.text].some(t => t && t.toLowerCase() === name.trim().toLowerCase());
  for (const h of [...hits.filter(exact), ...hits.filter(h => !exact(h))]) {
    const ent = e.entities?.[h.id];
    const claims = /** @type {any[]} */ (ent?.claims?.P856 || []);
    const best = claims.find(c => c.rank === 'preferred') ?? claims.find(c => c.rank !== 'deprecated');
    const url = best?.mainsnak?.datavalue?.value;
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      return { name: ent.labels?.en?.value || h.label, description: ent.descriptions?.en?.value || null, website: url, wikidata: `https://www.wikidata.org/wiki/${h.id}` };
    }
  }
  return null;
}

/**
 * Brandfetch Brand API: logos (inlined as data URIs), colors and fonts. Null when there is no key;
 * throws on API errors so the caller can report them.
 * @param {string} domain @param {string | undefined} key
 */
export async function brandfetch(domain, key) {
  if (!key) return null;
  const b = await getJson(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`, { headers: { Authorization: `Bearer ${key}` }, timeout: 12000 });
  /** @type {{ label: string, theme: string | null, src: string }[]} */
  const refs = [];
  for (const l of /** @type {any[]} */ (b.logos || [])) {
    const fmt = (l.formats || []).find((/** @type {any} */ f) => f.format === 'svg') ?? (l.formats || []).find((/** @type {any} */ f) => f.format === 'png') ?? l.formats?.[0];
    if (fmt?.src) refs.push({ label: `Brandfetch ${l.type || 'logo'}${l.theme ? ` (${l.theme})` : ''}`, theme: l.theme ?? null, src: fmt.src });
  }
  const logos = (await mapLimit(refs.slice(0, 6), 3, async r => {
    const d = await fetchImageData(r.src, LIMITS.asset);
    return d ? { kind: 'brandfetch', label: r.label, url: r.src, dataUri: d.dataUri, type: d.type, bytes: d.bytes, sizes: null, theme: r.theme } : null;
  })).filter(Boolean);
  return {
    name: b.name || null, description: b.description || null, claimed: !!b.claimed,
    logos,
    colors: (b.colors || []).filter((/** @type {any} */ c) => /^#[0-9a-f]{6}$/i.test(c.hex)).map((/** @type {any} */ c) => ({ hex: c.hex.toUpperCase(), type: c.type || null })),
    fonts: (b.fonts || []).filter((/** @type {any} */ f) => f.name).map((/** @type {any} */ f) => ({ name: f.name, type: f.type || null, origin: f.origin || null })),
    url: `https://brandfetch.com/${domain}`,
  };
}
