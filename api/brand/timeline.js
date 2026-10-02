// @ts-check
/* GET /api/brand/timeline?domain=<host>[&snapshots=8&span=20] → one Wayback Machine capture per
   chosen year, evenly spread from the site's first capture (or `span` years back) to this year.
   Each year asks for the capture closest to 1 July; a capture that lands in another year keeps its
   real year, and duplicates are dropped. */
import { json, mapLimit } from '../_lib/http.js';
import { toSiteUrl } from '../_lib/safefetch.js';
import { archiveUrl, closestSnapshot, renderUrl } from '../_lib/wayback.js';

/** @param {string | null} v @param {number} def @param {number} lo @param {number} hi */
const clampInt = (v, def, lo, hi) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

/** Evenly spaced years from `from` to `to`, inclusive, at most `n`. @param {number} from @param {number} to @param {number} n */
export function pickYears(from, to, n) {
  if (to <= from || n <= 1) return [to];
  const span = to - from;
  if (span + 1 <= n) return Array.from({ length: span + 1 }, (_, i) => from + i);
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(from + (span * i) / (n - 1))))];
}

/** @param {Request} request */
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const site = toSiteUrl(p.get('domain') || '');
  if (!site) return json({ error: 'Missing domain' }, { status: 400 });
  const host = site.hostname;
  const snapshots = clampInt(p.get('snapshots'), 8, 1, 16), span = clampInt(p.get('span'), 20, 1, 30);
    const t0 = Date.now();
  const now = new Date().getFullYear();
  let first = now - span;
  try {
    const earliest = await closestSnapshot(host, '19960101');
    if (earliest) first = Math.max(first, Number(earliest.timestamp.slice(0, 4)));
  } catch (e) {
    if (/HTTP 429/.test(String(e))) return json({ error: 'The Wayback Machine is rate-limiting requests; try again in a minute' }, { status: 429 });
  }

  const years = pickYears(first, now, snapshots);
  /** @type {string[]} */ const errors = [];
  const found = await mapLimit(years, 2, async year => {
    const s = await closestSnapshot(host, year === now ? new Date().toISOString().slice(0, 10).replace(/-/g, '') : `${year}0701`)
      .catch(e => { errors.push(e instanceof Error ? e.message : String(e)); return null; });
    if (!s) return null;
    return { year: Number(s.timestamp.slice(0, 4)), timestamp: s.timestamp, original: s.original, archiveUrl: archiveUrl(s.timestamp, s.original), renderUrl: renderUrl(s.timestamp, s.original) };
  });
  /** @type {Map<number, NonNullable<(typeof found)[number]>>} */
  const byYear = new Map();
  for (const f of found) if (f && f.year <= now && !byYear.has(f.year)) byYear.set(f.year, f);
  const snaps = [...byYear.values()].sort((a, b) => a.year - b.year);
  if (!snaps.length && errors.length) return json({ error: `The Wayback Machine did not answer (${errors[0]}); try again later`, domain: host, years }, { status: 502 });
  if (!snaps.length) return json({ error: `The Wayback Machine has no captures of ${host}`, domain: host, years }, { status: 404 });
  return json({ domain: host, firstYear: first, years, snapshots: snaps, ms: Date.now() - t0 });
}
