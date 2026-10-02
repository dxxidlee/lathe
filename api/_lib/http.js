// @ts-check
/* Shared server helpers for /api: outbound fetch with timeout, JSON responses, rate limiting. */

export const UA = 'LatheAudit/0.1 (open-source design research tool)';

/* Wikimedia rate-limits agents without contact details (429) and asks for a URL or email in the
   User-Agent; the Art Institute's firewall rejects agents that carry one (403). So the contact form
   goes only to Wikimedia hosts. Set LATHE_CONTACT_URL to the deployed site; it defaults to the
   project owner's public GitHub profile. */
const CONTACT_UA = () => `LatheAudit/0.1 (+${process.env.LATHE_CONTACT_URL || 'https://github.com/dxxidlee'})`;
/** @param {string | URL} url */
export const uaFor = url => (/(^|\.)wikimedia\.org$/.test(new URL(url).hostname) ? CONTACT_UA() : UA);

/**
 * Fetch JSON with a timeout and a descriptive User-Agent. Throws with the HTTP status on failure.
 * @param {string} url
 * @param {{ headers?: Record<string, string>, timeout?: number }} [opts]
 * @returns {Promise<any>}
 */
export async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': uaFor(url), Accept: 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout ?? 12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/**
 * JSON response. Successful source responses are CDN-cached for 24 hours.
 * @param {unknown} data
 * @param {{ status?: number, cache?: string }} [opts]
 */
export function json(data, opts = {}) {
  return new Response(JSON.stringify(data), {
    status: opts.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': opts.cache ?? (opts.status && opts.status >= 400 ? 'no-store' : 'public, s-maxage=86400, stale-while-revalidate=3600'),
    },
  });
}

/** Map with bounded concurrency; failed items become null. 
 * @template T, R
 * @param {T[]} items @param {number} n @param {(t: T, i: number) => Promise<R>} fn
 * @returns {Promise<(R | null)[]>} */
export async function mapLimit(items, n, fn) {
  /** @type {(R | null)[]} */
  const out = new Array(items.length).fill(null);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch { out[k] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/* Best-effort per-instance rate limiter (serverless instances do not share state; the 24 h CDN
   and client caches carry most of the load). */
/** @type {Map<string, number[]>} */
const hits = new Map();
/** @param {string} key @param {number} perMinute */
export async function rateLimit(key, perMinute) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < 60000);
  if (list.length >= perMinute) {
    const wait = 60000 - (now - list[0]);
    await new Promise(r => setTimeout(r, Math.min(wait, 3000)));
  }
  list.push(Date.now());
  hits.set(key, list);
}
