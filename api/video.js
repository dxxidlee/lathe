// @ts-check
/* GET /api/video?url= → proxied video with Range request passthrough.
   Streams the upstream response so the browser can load it in a <video> element
   without CORS issues. Forwards Range headers so only the needed bytes are fetched.
   Instagram CDN needs a browser-like Referer/UA or it returns 403. */
import { uaFor } from './_lib/http.js';

const MAX_CHUNK = 4 * 1024 * 1024;

const ALLOWED_HOSTS = [
  'cdninstagram.com', 'fbcdn.net', 'scontent.cdninstagram.com',
  'video.cdninstagram.com', 'scontent-', // scontent-*.cdninstagram.com
  'i.ytimg.com', 'web.archive.org',
];

/** @param {string} host */
const allowed = host => ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h))
  || /\.(mp4|webm)(\?|$)/i.test(host); // allow direct video file hosts from site capture

/** @param {number} status @param {string} msg */
const fail = (status, msg) => new Response(msg, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });

/** @param {Request} request */
export async function GET(request) {
  const url = new URL(request.url).searchParams.get('url');
  if (!url) return fail(400, 'Missing url');

  /** @type {URL} */ let target;
  try { target = new URL(url); } catch { return fail(400, 'Bad url'); }
  if (!/^https?:$/.test(target.protocol)) return fail(400, 'Bad protocol');

  // Allow any host that serves video — site capture finds arbitrary domains
  const host = target.hostname;

  /** @type {Record<string, string>} */
  const headers = {
    'User-Agent': uaFor(target),
    Accept: 'video/mp4,video/webm,video/*,*/*;q=0.5',
  };

  // Instagram CDN needs a browser-like Referer
  if (/instagram\.com|fbcdn\.net|cdninstagram/.test(host)) {
    headers['Referer'] = 'https://www.instagram.com/';
  }

  // Pass through Range header for streaming
  const range = request.headers.get('range');
  if (range) headers['Range'] = range;

  /** @type {Response} */ let res;
  try {
    res = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return fail(502, 'Fetch failed');
  }

  if (res.status === 403 || res.status === 401) {
    return fail(403, 'Video unavailable');
  }
  if (!res.ok && res.status !== 206) {
    return fail(502, `Upstream ${res.status}`);
  }

  const type = res.headers.get('content-type') || 'video/mp4';
  if (!/^video\//.test(type) && !/^application\/octet-stream/.test(type)) {
    void res.body?.cancel();
    return fail(415, 'Not a video');
  }

  /** @type {Record<string, string>} */
  const out = {
    'content-type': type.startsWith('video/') ? type : 'video/mp4',
    'cache-control': 'public, max-age=3600, s-maxage=86400',
    'access-control-allow-origin': '*',
  };

  const cl = res.headers.get('content-length');
  if (cl) out['content-length'] = cl;
  const cr = res.headers.get('content-range');
  if (cr) out['content-range'] = cr;
  const ar = res.headers.get('accept-ranges');
  if (ar) out['accept-ranges'] = ar;

  return new Response(res.body, {
    status: res.status,
    headers: out,
  });
}
