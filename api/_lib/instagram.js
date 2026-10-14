// @ts-check
/* Instagram for brand audits: a business or creator account's profile and latest 30 posts through
   the Graph API's Business Discovery (INSTAGRAM_ACCESS_TOKEN, a never-expiring Page token, asking as
   INSTAGRAM_USER_ID). The token stays on the server: it is never logged, echoed or put in an error. */

const GRAPH = 'https://graph.facebook.com/v21.0';
const MEDIA_FIELDS = 'id,media_type,media_url,thumbnail_url,permalink,caption,like_count,comments_count,timestamp,children{media_type,media_url,thumbnail_url}';
const FIELDS = 'username,name,biography,profile_picture_url,followers_count,media_count,'
  + `media.limit(30){${MEDIA_FIELDS}}`;
const TTL = 3600_000;

/** Instagram usernames: letters, numbers, periods and underscores, at most 30. */
export const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
/** A handle from user input ("@glossier", "glossier", or a profile URL); null when it isn't one. @param {string} raw */
export function cleanHandle(raw) {
  const s = String(raw || '').trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i.exec(s)?.[1];
  const h = (fromUrl ?? s).replace(/^@/, '');
  return USERNAME.test(h) && !/^(p|reel|reels|explore|stories|accounts|tv)$/i.test(h) ? h.toLowerCase() : null;
}

/** An error with a status for the response and a code the client can act on. */
export class IgError extends Error {
  /** @param {string} message @param {number} status @param {string} code */
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

/**
 * @typedef {{ type: 'image' | 'video', src: string, poster: string | null }} Slide
 * @typedef {{ id: string, type: 'image' | 'video' | 'carousel', mediaType: string, src: string, poster: string | null, slides: Slide[],
 *   permalink: string, caption: string | null, likes: number | null, comments: number | null, timestamp: string, score: number }} Post
 */

/**
 * One Graph media object in the normalized shape, or null when it has nothing to show. Videos whose
 * file Instagram withholds (licensed audio) become their thumbnail, as an image; `mediaType` keeps
 * Instagram's own type so the audit still counts them as videos.
 * @param {any} m @returns {Post | null}
 */
export function normalizePost(m) {
  /** @param {any} c @returns {Slide | null} */
  const slide = c => c.media_type === 'VIDEO'
    ? (c.media_url ? { type: 'video', src: c.media_url, poster: c.thumbnail_url ?? null } : c.thumbnail_url ? { type: 'image', src: c.thumbnail_url, poster: null } : null)
    : c.media_url ? { type: 'image', src: c.media_url, poster: null } : null;
  const likes = Number.isFinite(m.like_count) ? m.like_count : null;
  const comments = Number.isFinite(m.comments_count) ? m.comments_count : null;
  const base = { id: String(m.id), mediaType: String(m.media_type || ''), permalink: String(m.permalink || ''), caption: m.caption ? String(m.caption) : null,
    likes, comments, timestamp: String(m.timestamp || ''), score: (likes ?? 0) + (comments ?? 0) * 3 };
  if (m.media_type === 'CAROUSEL_ALBUM') {
    const slides = /** @type {Slide[]} */ ((m.children?.data ?? []).map(slide).filter(Boolean));
    if (!slides.length) return null;
    return { ...base, type: 'carousel', src: slides[0].src, poster: slides[0].poster, slides };
  }
  const s = slide(m);
  return s ? { ...base, type: s.type, src: s.src, poster: s.poster, slides: [] } : null;
}

/** @type {Map<string, { at: number, data: any }>} */
const cache = new Map();

/**
 * Profile and posts for a business or creator account, cached for an hour per instance.
 * @param {string} username @param {{ token: string, userId: string }} auth
 */
export async function businessDiscovery(username, { token, userId }) {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };
  /** @type {Response} */ let r;
  try {
    r = await fetch(`${GRAPH}/${encodeURIComponent(userId)}?fields=${encodeURIComponent(`business_discovery.username(${username}){${FIELDS}}`)}&access_token=${encodeURIComponent(token)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  } catch { throw new IgError('Instagram did not answer in time', 504, 'timeout'); }
  const j = /** @type {any} */ (await r.json().catch(() => null));
  if (!r.ok || j?.error) throw graphError(j?.error, username, r.status);
  const b = j?.business_discovery;
  if (!b) throw new IgError(`Instagram returned no account for @${username}`, 404, 'not_found');
  const data = {
    username: b.username,
    profile: { username: b.username, name: b.name ?? null, biography: b.biography ?? null, picture: b.profile_picture_url ?? null, followers: b.followers_count ?? null, mediaCount: b.media_count ?? null },
    posts: /** @type {Post[]} */ ((b.media?.data ?? []).map(normalizePost).filter(Boolean)),
    nextCursor: b.media?.paging?.cursors?.after ?? null,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(username, { at: Date.now(), data });
  return data;
}

/**
 * Fetch more posts for a business account using pagination cursor.
 * @param {string} username @param {string} after @param {{ token: string, userId: string }} auth
 * @returns {Promise<{ posts: Post[], nextCursor: string | null }>}
 */
export async function fetchMorePosts(username, after, { token, userId }) {
  const fields = `business_discovery.username(${username}){media.limit(30).after(${after}){${MEDIA_FIELDS}}}`;
  /** @type {Response} */ let r;
  try {
    r = await fetch(`${GRAPH}/${encodeURIComponent(userId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  } catch { throw new IgError('Instagram did not answer in time', 504, 'timeout'); }
  const j = /** @type {any} */ (await r.json().catch(() => null));
  if (!r.ok || j?.error) throw graphError(j?.error, username, r.status);
  const media = j?.business_discovery?.media;
  const posts = /** @type {Post[]} */ ((media?.data ?? []).map(normalizePost).filter(Boolean));
  const nextCursor = media?.paging?.cursors?.after ?? null;
  return { posts, nextCursor };
}

/**
 * Graph errors as clear messages. Business Discovery answers code 110 / subcode 2207013 both for a
 * username that doesn't exist and for a personal account (it only shares business and creator
 * accounts), so the two are told apart only when Graph's message says which.
 * @param {any} e @param {string} username @param {number} status
 */
function graphError(e, username, status) {
  const code = e?.code, sub = e?.error_subcode, text = `${e?.message ?? ''} ${e?.error_user_msg ?? ''}`;
  if (code === 190) return new IgError('The Instagram token was rejected (invalid or revoked); replace INSTAGRAM_ACCESS_TOKEN', 401, 'invalid_token');
  if ([4, 17, 32, 613].includes(code) || /rate|limit reached/i.test(text) && code !== 100) return new IgError('Instagram’s rate limit is reached; try again in a few minutes', 429, 'rate_limited');
  if (/business|professional|creator/i.test(text) && !/cannot be found/i.test(text)) return new IgError(`@${username} is a personal account; Instagram only shares business and creator accounts`, 404, 'not_business');
  if (code === 110 || sub === 2207013) return new IgError(`Instagram has no business or creator account @${username}. Either it doesn't exist, or it's a personal account, which Instagram doesn't share`, 404, 'not_found');
  if (code === 10 || code === 200) return new IgError('The Instagram token lacks the permission for Business Discovery (instagram_basic)', 403, 'permission');
  if (code === 100 && /user id|ig.?user/i.test(text)) return new IgError('INSTAGRAM_USER_ID isn’t an Instagram business account this token can use', 400, 'bad_user_id');
  return new IgError(`Instagram error${code ? ` ${code}` : ` (HTTP ${status})`}`, 502, 'graph_error');
}
