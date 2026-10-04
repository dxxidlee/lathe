// @ts-check
/* Wayback Machine helpers. The availability API answers in about a second; the CDX index can take
   30 s or more for a big site's whole history, so it is only asked about single years, as a fallback. archive.org rate-limits bursts (429),
   so calls are paced and run at most two at a time. */
import { getJson, rateLimit } from './http.js';

/**
 * The capture closest to a timestamp (YYYYMMDD…), or null.
 * @param {string} url @param {string} timestamp
 * @returns {Promise<{ timestamp: string, original: string } | null>}
 */
export async function closestSnapshot(url, timestamp) {
  // Under load archive.org answers 429/5xx, or an empty result for a URL it does have; both are
  // retried with a growing pause before the year is given up.
  const waits = [0, 1500, 4000];
  /** @type {unknown} */ let lastError = null;
  for (let attempt = 0; attempt < waits.length; attempt++) {
    if (waits[attempt]) await new Promise(r => setTimeout(r, waits[attempt]));
    await rateLimit('wayback-available', 15); // archive.org answers 429 to bursts
    /** @type {any} */ let r;
    try { r = await getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${timestamp}`, { timeout: 12000 }); }
    catch (e) {
      lastError = e;
      if (/HTTP (429|5\d\d)|JSON|Unexpected token|abort|timeout/i.test(String(e))) continue;
      throw e;
    }
    lastError = null;
    const c = r?.archived_snapshots?.closest;
    if (!c) { if (attempt < 1) continue; return null; }
    if (!c.available || String(c.status) !== '200' || !/^\d{14}$/.test(c.timestamp)) return null;
    const original = String(c.url).replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:[a-z_]+)?\//, '').replace(/^(https?:\/\/[^/]+):80\//, '$1/');
    return { timestamp: c.timestamp, original };
  }
  if (lastError) throw new Error(/JSON|Unexpected token/.test(String(lastError)) ? 'archive.org is temporarily offline' : lastError instanceof Error ? lastError.message : String(lastError));
  return null;
}

/**
 * The first 200 capture of `url` from `from` to `to` (YYYYMMDD) in the CDX index, or null. Used when
 * the availability API comes back empty, which it does for whole sites when archive.org is degraded.
 * @param {string} url @param {string} from @param {string} to
 * @returns {Promise<{ timestamp: string, original: string } | null>}
 */
export async function firstCapture(url, from, to) {
  await rateLimit('wayback-cdx', 20);
  const r = await getJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&from=${from}&to=${to}&limit=1&filter=statuscode:200&fl=timestamp,original&output=json`, { timeout: 20000 });
  const row = Array.isArray(r) ? r[1] : null;
  return row && /^\d{14}$/.test(row[0]) ? { timestamp: row[0], original: row[1] } : null;
}

/** Raw archived bytes of a URL near a timestamp (no Wayback toolbar or rewriting). @param {string} ts @param {string} url */
export const rawUrl = (ts, url) => `https://web.archive.org/web/${ts}id_/${url}`;
/** The archived page as a browser replays it, without the toolbar. @param {string} ts @param {string} url */
export const renderUrl = (ts, url) => `https://web.archive.org/web/${ts}if_/${url}`;
/** @param {string} ts @param {string} url */
export const archiveUrl = (ts, url) => `https://web.archive.org/web/${ts}/${url}`;
