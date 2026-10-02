// @ts-check
/* GET /api/fetch?url=<image or page> → an image from any public URL, for the image tools' "From URL".
   SSRF-safe (public addresses only, redirects re-checked, bounded size). A web page resolves to its
   Open Graph image. The response names the file (x-lathe-filename) and the final URL (x-lathe-source). */
import { json, rateLimit } from './_lib/http.js';
import { safeFetch, toSiteUrl } from './_lib/safefetch.js';
import { scanHtml } from './_lib/site.js';
import { MAX_BYTES } from './img.js';

/** @param {string} url @param {string} type */
function filename(url, type) {
  const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'image').replace(/[^\w.-]+/g, '-').slice(0, 80);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[type] ?? 'img';
  return /\.\w{2,4}$/.test(last) ? last : `${last}.${ext}`;
}

/** @param {Request} request */
export async function GET(request) {
  const raw = new URL(request.url).searchParams.get('url') || '';
  const target = toSiteUrl(raw);
  if (!target) return json({ error: 'Paste an image or page URL' }, { status: 400 });
  await rateLimit('fetch', 30);
  try {
    let r = await safeFetch(target.toString(), { maxBytes: MAX_BYTES, accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,text/html;q=0.8' });
    if (r.status >= 400) return json({ error: `The address answered ${r.status}` }, { status: 502 });
    let type = r.type.split(';')[0].trim().toLowerCase();
    if (/html/.test(type)) {
      const og = scanHtml(r.buffer.toString('utf8'), r.url).og.image;
      if (!og) return json({ error: 'That page has no share image; paste the image’s own URL' }, { status: 415 });
      r = await safeFetch(og, { maxBytes: MAX_BYTES, accept: 'image/*' });
      if (r.status >= 400) return json({ error: `The page’s share image answered ${r.status}` }, { status: 502 });
      type = r.type.split(';')[0].trim().toLowerCase();
    }
    if (!/^image\//.test(type)) return json({ error: 'That URL is not an image' }, { status: 415 });
    return new Response(new Uint8Array(r.buffer), { status: 200, headers: {
      'content-type': type, 'cache-control': 'no-store', 'x-lathe-filename': filename(r.url, type), 'x-lathe-source': r.url,
    } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg === 'Response too large' ? 'Image larger than 4 MB' : msg }, { status: /Private|Only|credentials/.test(msg) ? 400 : 502 });
  }
}
