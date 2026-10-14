// @ts-check
/* GET /api/brand/capture?q=<domain or company>[&merge=0.04&top=12] → the site capture (title, meta,
   Open Graph image, logo candidates as data URIs, typefaces, ranked CSS colors), the company resolved
   from Wikidata when a name was typed, and Brandfetch's assets when BRANDFETCH_KEY is set. */
import { json, rateLimit } from '../_lib/http.js';
import { toSiteUrl } from '../_lib/safefetch.js';
import { captureSite } from '../_lib/site.js';
import { brandfetch, guessSite, looksLikeDomain, resolveCompany } from '../_lib/brand.js';

/** @param {string | null} v @param {number} def @param {number} lo @param {number} hi */
const clampNum = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : def; };

/** @param {Request} request */
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const q = (p.get('q') || '').trim().slice(0, 200);
  if (!q) return json({ error: 'Type a domain or a company name' }, { status: 400 });
  const merge = clampNum(p.get('merge'), 0.04, 0, 0.3), top = clampNum(p.get('top'), 12, 3, 32);
  await rateLimit('brand-capture', 30);

  /** @type {{ name: string, description: string | null, website: string, wikidata: string | null } | null} */
  let company = null;
  const asDomain = looksLikeDomain(q);
  let site = asDomain ? toSiteUrl(q) : null;
  if (asDomain && !site) return json({ error: 'That is not a public web address' }, { status: 400 });
  if (!site) {
    try { company = await resolveCompany(q); } catch (e) { return json({ error: `Could not look up “${q}”: ${e instanceof Error ? e.message : e}` }, { status: 502 }); }
    company ??= /** @type {any} */ (await guessSite(q));
    if (!company) return json({ error: `No website found for “${q}”. Try its domain, like example.com.` }, { status: 404 });
    site = toSiteUrl(company.website);
  }
  if (!site) return json({ error: 'That is not a web address' }, { status: 400 });

  const domain = site.hostname.replace(/^www\./, '');
  const [cap, bf] = await Promise.allSettled([
    captureSite(site, { merge, top }),
    brandfetch(domain, process.env.BRANDFETCH_KEY),
  ]);
  const bfVal = bf.status === 'fulfilled' ? bf.value : null;
  const bfErr = bf.status === 'rejected' ? (bf.reason instanceof Error ? bf.reason.message : String(bf.reason)) : null;
  if (cap.status === 'rejected') {
    const msg = cap.reason instanceof Error ? cap.reason.message : String(cap.reason);
    if (/Private|Only|credentials/.test(msg) && !bfVal) return json({ error: `Could not capture ${site.hostname}: ${msg}`, domain, company }, { status: 400 });
    return json({
      query: q, domain, company,
      site: null, siteError: msg,
      brandfetch: bfVal, brandfetchError: bfErr,
      capturedAt: new Date().toISOString(),
    });
  }
  return json({
    query: q, domain, company,
    site: cap.value,
    brandfetch: bfVal, brandfetchError: bfErr,
    capturedAt: new Date().toISOString(),
  });
}
