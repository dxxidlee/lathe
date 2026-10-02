// @ts-check
/* Wayback Machine helpers. The availability API answers in about a second; the CDX index can take
   30 s or more for a big site's history, so it is not used. archive.org rate-limits bursts (429),
   so calls are paced and run at most two at a time. */
import { getJson, rateLimit } from './http.js';

/**
 * The capture closest to a timestamp (YYYYMMDD…), or null.
 * @param {string} url @param {string} timestamp
 * @returns {Promise<{ timestamp: string, original: string } | null>}
 */
export async function closestSnapshot(url, timestamp) {
  await rateLimit('wayback-available', 15); // archive.org answers 429 to bursts
  /** @type {any} */ let r;
  try { r = await getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${timestamp}`, { timeout: 12000 }); }
  catch (e) { throw new Error(/JSON|Unexpected token/.test(String(e)) ? 'archive.org is temporarily offline' : e instanceof Error ? e.message : String(e)); }
  const c = r?.archived_snapshots?.closest;
  if (!c?.available || String(c.status) !== '200' || !/^\d{14}$/.test(c.timestamp)) return null;
  const original = String(c.url).replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:[a-z_]+)?\//, '').replace(/^(https?:\/\/[^/]+):80\//, '$1/');
  return { timestamp: c.timestamp, original };
}

/** Raw archived bytes of a URL near a timestamp (no Wayback toolbar or rewriting). @param {string} ts @param {string} url */
export const rawUrl = (ts, url) => `https://web.archive.org/web/${ts}id_/${url}`;
/** The archived page as a browser replays it, without the toolbar. @param {string} ts @param {string} url */
export const renderUrl = (ts, url) => `https://web.archive.org/web/${ts}if_/${url}`;
/** @param {string} ts @param {string} url */
export const archiveUrl = (ts, url) => `https://web.archive.org/web/${ts}/${url}`;
