// @ts-check
/* GET /api/brand/social?name=<brand>[&youtube=<channel url>&videos=6] → video stills for the brand:
   from the YouTube channel its site links to; failing that, the channel a search shows is the
   brand's own; failing that, the brand's commercials (a search kept to videos whose titles name it).
   Stills are served through /api/img (i.ytimg.com is allowlisted). Instagram, TikTok and the rest
   need a signed-in session, so the capture reports them as links only. */
import { json, rateLimit } from '../_lib/http.js';
import { channelVideos, isBrandChannel, resolveChannel, searchVideos } from '../_lib/youtube.js';

/** @param {string | null} v @param {number} def @param {number} lo @param {number} hi */
const clampInt = (v, def, lo, hi) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

/** @param {Request} request */
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  // ?render=<site url>: the site's images as a browser renders them (for sites that draw their
  // photography with script, which the plain HTML capture can't see). One Microlink request.
  const render = p.get('render');
  if (render) return renderedImages(render);
  const name = (p.get('name') || '').trim().slice(0, 120);
  const yt = (p.get('youtube') || '').trim();
  const n = clampInt(p.get('videos'), 6, 1, 12);
  if (!name && !yt) return json({ error: 'Missing brand name' }, { status: 400 });
  if (yt && !/^https:\/\/(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{20,}|c\/[\w.-]+|user\/[\w.-]+)\/?$/i.test(yt)) return json({ error: 'Not a YouTube channel address' }, { status: 400 });
  await rateLimit('youtube', 20);
  const t0 = Date.now();
  /** @type {string[]} */ const notes = [];
  if (yt) {
    try {
      const channel = await resolveChannel(yt);
      const videos = await channelVideos(channel.id, n);
      if (videos.length) return json({ youtube: { source: 'channel', channel, videos }, ms: Date.now() - t0 });
      notes.push(`${channel.title} has no public videos`);
    } catch (e) { notes.push(`Channel: ${e instanceof Error ? e.message : e}`); }
  }
  if (!name) return json({ error: notes.join('; ') || 'No videos found' }, { status: 404 });
  try {
    // A search result from the brand's own channel means the brand has one: use its uploads.
    const found = await searchVideos(name, 20);
    const own = found.find(v => isBrandChannel(v.channel, name) && v.channelId);
    if (own?.channelId) {
      const videos = await channelVideos(own.channelId, n).catch(() => []);
      if (videos.length) return json({ youtube: { source: 'channel', channel: { id: own.channelId, title: own.channel, url: `https://www.youtube.com/channel/${own.channelId}` }, videos }, notes, ms: Date.now() - t0 });
    }
    // Otherwise the brand's commercials, which are usually re-posted by ad archives.
    let videos = await searchVideos(name, n, `${name} commercial`);
    if (!videos.length) videos = found.slice(0, n);
    if (!videos.length) return json({ youtube: null, notes: [...notes, `No YouTube videos name “${name}”`], ms: Date.now() - t0 });
    return json({ youtube: { source: 'search', channel: null, query: name, videos }, notes, ms: Date.now() - t0 });
  } catch (e) {
    return json({ error: `YouTube search failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}

/** Image URLs from the rendered page (Microlink runs a headless browser), photography only. @param {string} raw */
async function renderedImages(raw) {
  /** @type {URL} */ let target;
  try { target = new URL(raw); } catch { return json({ error: 'Bad url' }, { status: 400 }); }
  if (!/^https?:$/.test(target.protocol)) return json({ error: 'Only http and https pages' }, { status: 400 });
  const key = process.env.MICROLINK_KEY;
  const endpoint = process.env.MICROLINK_API || (key ? 'https://pro.microlink.io/' : 'https://api.microlink.io/');
  const q = new URLSearchParams({ url: target.toString(), meta: 'false', 'data.images.selectorAll': 'img', 'data.images.attr': 'src', 'data.sources.selectorAll': 'picture source', 'data.sources.attr': 'srcset' });
  await rateLimit('microlink', 20);
  try {
    const r = await fetch(`${endpoint}?${q}`, { headers: key ? { 'x-api-key': key } : {}, signal: AbortSignal.timeout(28000) });
    if (r.status === 429) return json({ error: 'Microlink’s free daily quota is used up' }, { status: 429 });
    const j = /** @type {any} */ (await r.json().catch(() => null));
    if (!r.ok || j?.status !== 'success') return json({ error: `Rendering failed: ${j?.message ?? `HTTP ${r.status}`}` }, { status: 502 });
    const all = [...(j.data?.images ?? []), ...(j.data?.sources ?? []).flatMap((/** @type {string} */ s) => String(s).split(',').map(x => x.trim().split(/\s+/)[0]))]
      .map(u => { try { return new URL(String(u), target).toString(); } catch { return null; } })
      .filter((u) => !!u && /^https?:/.test(u));
    const urls = /** @type {string[]} */ (all).filter(u => !/\.svg(\?|$)|\.gif(\?|$)|logo|icon|sprite|pixel|avatar|badge|favicon/i.test(u));
    // One variant per image: build hashes, size suffixes and desktop/mobile/@2x markers are ignored
    // when comparing names, and the desktop or @2x variant wins.
    /** @type {Map<string, string>} */ const byBase = new Map();
    const baseOf = (/** @type {string} */ u) => u.replace(/\?.*$/, '').replace(/\.[0-9a-f]{6,}(?=\.\w+$)/i, '').replace(/@\dx/g, '').replace(/[-_]?\d{2,4}w?(?=\.\w+$)/, '').replace(/[-_]?(mobile|desktop|tablet)/ig, '').toLowerCase();
    for (const u of urls) { const b = baseOf(u); const cur = byBase.get(b); if (!cur || /@2x|desktop/i.test(u)) byBase.set(b, u); }
    // Logos the page draws (often only an SVG in the rendered DOM), from the site's own host.
    const logos = [...new Set(/** @type {string[]} */ (all).filter(u => /logo/i.test(u) && new URL(u).hostname.replace(/^www\./, '') === target.hostname.replace(/^www\./, '')))].slice(0, 4);
    return json({ images: [...byBase.values()].slice(0, 16).map(url => ({ url, alt: null, w: null })), logos }, { cache: 'public, s-maxage=86400' });
  } catch { return json({ error: 'The renderer did not answer in time' }, { status: 504 }); }
}
