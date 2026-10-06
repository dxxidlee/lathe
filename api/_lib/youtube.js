// @ts-check
/* YouTube for brand audits, without an API key: the brand's channel (from the profile its site links
   to), its latest videos read from the public channel page, or a title-filtered video search when the
   site links no channel. Each video gives stills from i.ytimg.com: the thumbnail and the three frames
   YouTube captures from the video itself (1280 × 720 when the video has them; the widescreen
   thumbnail otherwise).
   No video is downloaded. */
import { safeFetch } from './safefetch.js';

/** @typedef {{ id: string, title: string, duration: string | null, url: string, stills: { url: string, fallback: string[], label: string }[] }} Video */

/** ytInitialData from a YouTube page, or null. @param {string} html */
function initialData(html) {
  const m = /var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Visit every object in a JSON tree. @param {any} node @param {(o: any) => boolean | void} fn */
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node) && fn(node) === false) return;
  for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, fn);
}

/** @param {string} url */
async function page(url) {
  const r = await safeFetch(url, { maxBytes: 4_000_000, accept: 'text/html', timeout: 15000 });
  if (r.status >= 400) throw new Error(`YouTube answered ${r.status}`);
  return r.buffer.toString('utf8');
}

/** @param {string} id */
export const stillsFor = id => [
  // Frames fall back to the widescreen thumbnail (hq720), whose 16:9 has no bars, and only then to
  // YouTube's small 4:3 frame (letterboxed), for older videos that have neither.
  { url: `https://i.ytimg.com/vi/${id}/maxres2.jpg`, fallback: [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/hq2.jpg`], label: 'Frame at 50%' },
  { url: `https://i.ytimg.com/vi/${id}/maxres1.jpg`, fallback: [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/hq1.jpg`], label: 'Frame at 25%' },
  { url: `https://i.ytimg.com/vi/${id}/maxres3.jpg`, fallback: [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/hq3.jpg`], label: 'Frame at 75%' },
  { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, fallback: [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`], label: 'Thumbnail' },
];

/**
 * A channel's id, name and handle from any channel URL (@handle, /channel/UC…, /c/…, /user/…).
 * @param {string} url
 */
export async function resolveChannel(url) {
  const html = await page(url.replace(/\/+$/, ''));
  const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/.exec(html)?.[1];
  if (!id) throw new Error('No channel at that address');
  const d = initialData(html);
  const meta = d?.metadata?.channelMetadataRenderer;
  return { id, title: meta?.title ?? /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? 'YouTube channel', url: meta?.vanityChannelUrl?.replace(/^http:/, 'https:') ?? `https://www.youtube.com/channel/${id}` };
}

/** The channel's latest uploads (newest first). @param {string} channelId @param {number} n @returns {Promise<Video[]>} */
export async function channelVideos(channelId, n) {
  const d = initialData(await page(`https://www.youtube.com/channel/${channelId}/videos`));
  /** @type {Video[]} */ const out = [];
  walk(d, o => {
    const lv = o.lockupViewModel;
    if (lv?.contentId && lv.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
      const title = lv.metadata?.lockupMetadataViewModel?.title?.content;
      let duration = null;
      walk(lv.contentImage, x => { if (x.thumbnailBadgeViewModel?.text && /^\d+:\d+/.test(x.thumbnailBadgeViewModel.text)) duration = x.thumbnailBadgeViewModel.text; });
      if (title && !out.some(v => v.id === lv.contentId)) out.push({ id: lv.contentId, title, duration, url: `https://www.youtube.com/watch?v=${lv.contentId}`, stills: stillsFor(lv.contentId) });
      return false;
    }
    const vr = o.videoRenderer ?? o.gridVideoRenderer;
    if (vr?.videoId && !out.some(v => v.id === vr.videoId)) {
      out.push({ id: vr.videoId, title: vr.title?.runs?.[0]?.text ?? vr.title?.simpleText ?? '', duration: vr.lengthText?.simpleText ?? null, url: `https://www.youtube.com/watch?v=${vr.videoId}`, stills: stillsFor(vr.videoId) });
      return false;
    }
  });
  return out.slice(0, n);
}

/**
 * Videos found by searching `query`, kept only when the title names the brand (so a search for a
 * product does not fill the audit with unrelated videos). Includes each video's channel.
 * @param {string} name @param {number} n @param {string} [query]
 * @returns {Promise<(Video & { channel: string | null, channelId: string | null })[]>}
 */
export async function searchVideos(name, n, query = name) {
  const d = initialData(await page(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`));
  const words = name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  /** @type {(Video & { channel: string | null, channelId: string | null })[]} */ const out = [];
  walk(d, o => {
    const vr = o.videoRenderer;
    if (!vr?.videoId) return;
    const title = vr.title?.runs?.map((/** @type {any} */ r) => r.text).join('') ?? '';
    const t = title.toLowerCase();
    if (words.length && words.every(w => t.includes(w)) && !out.some(v => v.id === vr.videoId)) {
      const owner = vr.ownerText?.runs?.[0];
      out.push({ id: vr.videoId, title, duration: vr.lengthText?.simpleText ?? null, url: `https://www.youtube.com/watch?v=${vr.videoId}`, stills: stillsFor(vr.videoId),
        channel: owner?.text ?? null, channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? null });
    }
    return false;
  });
  return out.slice(0, n);
}

/** True when a channel's name is the brand's (ignoring case, spaces and punctuation). @param {string | null} channel @param {string} name */
export const isBrandChannel = (channel, name) => {
  const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return !!channel && (norm(channel) === norm(name) || norm(channel).startsWith(norm(name)) && norm(channel).length - norm(name).length <= 8);
};
