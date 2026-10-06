// @ts-check
/* GET /api/ig-media?url= → an Instagram image or video, streamed through Lathe: CDN links expire and
   may refuse other sites' pages, and pixels read for palettes need the same origin. Only hosts on
   cdninstagram.com and fbcdn.net are fetched (redirects re-checked); Range is passed on so videos can
   seek. Each link is signed and unchanging until it expires, so responses are cached hard. */
import { UA } from './_lib/http.js';

/** @param {string} host */
const allowed = host => /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(host);
/** @param {number} status @param {string} msg */
const fail = (status, msg) => new Response(msg, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });

/** @param {Request} request */
export async function GET(request) {
  /** @type {URL} */ let target;
  try { target = new URL(new URL(request.url).searchParams.get('url') || ''); } catch { return fail(400, 'Bad url'); }
  const range = request.headers.get('range');
  for (let hop = 0; hop < 4; hop++) {
    if (target.protocol !== 'https:' || !allowed(target.hostname)) return fail(403, `Host not allowed: ${target.hostname}`);
    /** @type {Response} */ let res;
    try {
      res = await fetch(target, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'image/*,video/*;q=0.9,*/*;q=0.5', ...(range ? { Range: range } : {}) }, signal: AbortSignal.timeout(25000) });
    } catch { return fail(502, 'Fetch failed'); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { target = new URL(/** @type {string} */ (res.headers.get('location')), target); continue; }
    if (!res.ok) return fail(res.status === 403 || res.status === 404 || res.status === 410 ? 410 : 502, `Upstream ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/^(image|video)\//.test(type)) { void res.body?.cancel(); return fail(415, 'Not an image or video'); }
    const headers = new Headers({ 'content-type': type, 'cache-control': 'public, max-age=86400, s-maxage=604800, immutable', 'accept-ranges': 'bytes' });
    for (const h of ['content-length', 'content-range', 'last-modified', 'etag']) { const v = res.headers.get(h); if (v) headers.set(h, v); }
    return new Response(res.body, { status: res.status, headers });
  }
  return fail(508, 'Too many redirects');
}
