// @ts-check
/* GET /api/brand/shot?url=<page>&device=desktop|mobile[&w=&h=] → a JPEG screenshot from Microlink,
   same-origin so the client can read its pixels. Works without a key on Microlink's free tier (a
   small daily quota); MICROLINK_KEY switches to the pro endpoint. Screenshots are CDN-cached for a
   week and memoised per instance, so re-running an audit does not spend quota.
   MICROLINK_API overrides the endpoint (the verify suite points it at a local stand-in). */
import { MAX_BYTES } from '../img.js';
import { rateLimit } from '../_lib/http.js';

/** @type {Map<string, { buf: ArrayBuffer, type: string, at: number }>} */
const memo = new Map();
const MEMO_MAX = 40, MEMO_MS = 24 * 3600_000;

/** @param {string | null} v @param {number} def @param {number} lo @param {number} hi */
const clampInt = (v, def, lo, hi) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
/** @param {number} status @param {string} error @param {Record<string, string>} [extra] */
const fail = (status, error, extra = {}) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

/** @param {Request} request */
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  /** @type {URL} */ let target;
  try { target = new URL(p.get('url') || ''); } catch { return fail(400, 'Bad url'); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return fail(400, 'Only http and https pages');
  const mobile = p.get('device') === 'mobile';
  const w = clampInt(p.get('w'), mobile ? 390 : 1440, 320, 2560), h = clampInt(p.get('h'), mobile ? 844 : 900, 320, 2560);

  const key = process.env.MICROLINK_KEY;
  const endpoint = process.env.MICROLINK_API || (key ? 'https://pro.microlink.io/' : 'https://api.microlink.io/');
  const q = new URLSearchParams({
    url: target.toString(), screenshot: 'true', meta: 'false', embed: 'screenshot.url', 'screenshot.type': 'jpeg',
    'viewport.width': String(w), 'viewport.height': String(h), 'viewport.deviceScaleFactor': mobile ? '2' : '1',
    'viewport.isMobile': String(mobile), 'viewport.hasTouch': String(mobile), waitForTimeout: '1500',
  });
  const upstream = `${endpoint}?${q}`;
  const hit = memo.get(upstream);
  if (hit && Date.now() - hit.at < MEMO_MS) return image(hit.buf, hit.type, { 'x-lathe-cache': 'memo' });

  await rateLimit('microlink', 20);
  let res;
  try {
    res = await fetch(upstream, { headers: key ? { 'x-api-key': key } : {}, signal: AbortSignal.timeout(55000) });
  } catch { return fail(504, 'The screenshot service did not answer in time'); }
  const remaining = res.headers.get('x-rate-limit-remaining');
  const quota = /** @type {Record<string, string>} */ (remaining != null ? { 'x-lathe-quota-remaining': remaining, 'x-lathe-quota-limit': res.headers.get('x-rate-limit-limit') ?? '' } : {});
  const type = res.headers.get('content-type') || '';
  if (res.status === 429) return fail(429, key ? 'Microlink rate limit reached; try again shortly' : 'Microlink’s free daily screenshot quota is used up. Set MICROLINK_KEY in .env.local to lift it, or try again tomorrow.', quota);
  if (!res.ok || !/^image\//.test(type)) {
    const body = await res.json().catch(() => null);
    return fail(502, `Screenshot failed: ${body?.message || body?.code || `HTTP ${res.status}`}`, quota);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return fail(413, 'Screenshot too large', quota);
  if (memo.size >= MEMO_MAX) memo.delete(/** @type {string} */ (memo.keys().next().value));
  memo.set(upstream, { buf, type, at: Date.now() });
  return image(buf, type, quota);
}

/** @param {ArrayBuffer} buf @param {string} type @param {Record<string, string>} extra */
function image(buf, type, extra) {
  return new Response(buf, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, s-maxage=604800', ...extra } });
}
