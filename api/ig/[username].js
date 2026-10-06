// @ts-check
/* GET /api/ig/:username → { username, profile, posts, fetchedAt } for a business or creator account
   (see _lib/instagram.js). Errors are JSON { error, code } with a status: 400 bad username, 401
   invalid token, 404 not found or personal account, 429 rate limit. Without INSTAGRAM_ACCESS_TOKEN it
   serves public/data/mock-posts.json in the same shape, marked `mock: true`. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { json, rateLimit } from '../_lib/http.js';
import { businessDiscovery, cleanHandle, IgError } from '../_lib/instagram.js';

const HOUR = 'public, max-age=3600, s-maxage=3600';

/** @param {Request} request */
export async function GET(request) {
  const raw = decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() || '');
  const username = cleanHandle(raw);
  if (!username) return json({ error: 'Not an Instagram username (letters, numbers, periods and underscores only)', code: 'bad_username' }, { status: 400 });
  const token = process.env.INSTAGRAM_ACCESS_TOKEN, userId = process.env.INSTAGRAM_USER_ID;
  if (!token) {
    try {
      const mock = JSON.parse(await readFile(join(process.cwd(), 'public', 'data', 'mock-posts.json'), 'utf8'));
      return json({ ...mock, username, profile: { ...mock.profile, username }, mock: true }, { cache: 'no-store' });
    } catch { return json({ error: 'Instagram needs INSTAGRAM_ACCESS_TOKEN, and the sample posts are missing', code: 'no_token' }, { status: 503 }); }
  }
  if (!userId) return json({ error: 'Instagram needs INSTAGRAM_USER_ID as well as the token', code: 'no_user_id' }, { status: 503 });
  await rateLimit('instagram', 30);
  try {
    return json(await businessDiscovery(username, { token, userId }), { cache: HOUR });
  } catch (e) {
    if (e instanceof IgError) return json({ error: e.message, code: e.code }, { status: e.status });
    return json({ error: 'Instagram could not be reached', code: 'unreachable' }, { status: 502 });
  }
}
