// @ts-check
/* GET /api/img?url=[&fallback=] → the image, same-origin, so the browser can read its pixels (palettes)
   and embed it in exports. Only hosts that the registered sources serve images from are allowed;
   redirects are followed manually and re-checked; responses must be images under 4 MB (Vercel caps
   function responses at 4.5 MB). When `url` is refused or too large, the first `fallback` that works
   (each also checked; the parameter may repeat) is served instead, with `x-lathe-fallback: 1`. */
import { SOURCES } from './_lib/sources/index.js';
import { uaFor } from './_lib/http.js';

export const MAX_BYTES = 4 * 1024 * 1024;
// Brand mode adds YouTube's still images (thumbnails and auto-captured frames).
const HOSTS = [...SOURCES.flatMap(s => s.imageHosts), 'i.ytimg.com'];

/** @param {string} host */
const allowed = host => HOSTS.some(h => host === h || host.endsWith('.' + h));

/** @param {number} status @param {string} msg */
const fail = (status, msg) => new Response(msg, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });

/** @param {string | null} raw @returns {Promise<Response>} */
async function fetchImage(raw) {
  /** @type {URL} */ let target;
  try { target = new URL(raw || ''); } catch { return fail(400, 'Bad url'); }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(target.protocol) || !allowed(target.hostname)) return fail(403, `Host not allowed: ${target.hostname}`);
    let res;
    try {
      res = await fetch(target, { redirect: 'manual', headers: { 'User-Agent': uaFor(target), Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8' }, signal: AbortSignal.timeout(25000) });
    } catch { return fail(502, 'Fetch failed'); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      target = new URL(/** @type {string} */ (res.headers.get('location')), target); continue;
    }
    if (!res.ok) return fail(502, `Upstream ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/^image\//.test(type)) return fail(415, 'Not an image');
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) { void res.body?.cancel(); return fail(413, 'Image too large'); }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return fail(413, 'Image too large');
    return new Response(buf, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, s-maxage=604800' } });
  }
  return fail(508, 'Too many redirects');
}

/** @param {Request} request */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const first = await fetchImage(params.get('url'));
  if (first.ok || first.status === 400 || first.status === 403) return first;
  // Fallbacks are tried in order (`fallback` may repeat); the first that works is served.
  for (const fallback of params.getAll('fallback').slice(0, 3)) {
    const next = await fetchImage(fallback);
    if (!next.ok) continue;
    const headers = new Headers(next.headers); headers.set('x-lathe-fallback', '1');
    return new Response(next.body, { status: 200, headers });
  }
  return first;
}
