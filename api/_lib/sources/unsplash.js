// @ts-check
/* Unsplash (UNSPLASH_KEY as Client-ID). Images hotlink images.unsplash.com as the API guidelines
   require; credit reads "Photo by <name> on Unsplash". */
import { getJson, rateLimit } from '../http.js';
import { result, str } from '../normalize.js';

const UTM = 'utm_source=lathe&utm_medium=referral';

/** @param {string} q @param {{ page: number, limit: number, env: Record<string, string | undefined> }} o */
export async function search(q, { page, limit, env }) {
  await rateLimit('unsplash', 45); // demo apps get 50 requests/hour
  const r = await getJson(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&page=${page}&per_page=${limit}`,
    { headers: { Authorization: `Client-ID ${env.UNSPLASH_KEY || ''}`, 'Accept-Version': 'v1' } });
  const results = (r.results || []).map((/** @type {any} */ p) => result({
    id: p.id, source: 'unsplash',
    title: str(p.description) || str(p.alt_description) || 'Untitled photograph',
    creator: p.user?.name ? `Photo by ${p.user.name} on Unsplash` : null,
    date: str(p.created_at)?.slice(0, 10) ?? null,
    imageUrl: `${p.urls.raw}&w=1920&q=80&fm=jpg`, thumbUrl: p.urls.small,
    width: p.width ?? null, height: p.height ?? null,
    license: 'Unsplash License', isPublicDomain: false,
    sourceUrl: `${p.links?.html || 'https://unsplash.com'}?${UTM}`, type: 'photograph',
  }));
  return { total: r.total ?? results.length, results };
}
