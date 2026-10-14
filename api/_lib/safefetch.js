// @ts-check
/* Fetch a user-supplied URL from the server without exposing internal networks (SSRF):
   http(s) only, standard ports only, every hostname resolved and refused if any address is private,
   loopback, link-local, multicast or otherwise reserved, redirects followed manually and re-checked,
   bodies capped while streaming. (DNS can change between the check and the fetch; the window is
   small, and nothing the function can reach privately is exposed by a Vercel deployment.) */
import dns from 'node:dns/promises';
import net from 'node:net';
import { uaFor } from './http.js';

/** @param {string} ip */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff') || v.startsWith('64:ff9b');
}

/** @param {URL} u */
export async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https URLs');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Only standard ports');
  if (u.username || u.password) throw new Error('No credentials in URLs');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error('Private host');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Private address');
}

/**
 * @param {string} url
 * @param {{ maxBytes?: number, timeout?: number, accept?: string, maxRedirects?: number }} [o]
 * @returns {Promise<{ url: string, status: number, type: string, buffer: Buffer }>}
 */
export async function safeFetch(url, o = {}) {
  const maxBytes = o.maxBytes ?? 2_000_000;
  let u = new URL(url);
  for (let hop = 0; hop <= (o.maxRedirects ?? 5); hop++) {
    await assertPublic(u);
    const res = await fetch(u, {
      redirect: 'manual',
      headers: { 'User-Agent': uaFor(u), Accept: o.accept ?? '*/*', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(o.timeout ?? 12000),
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { void res.body?.cancel(); u = new URL(loc, u); continue; }
    const type = res.headers.get('content-type') || '';
    if (Number(res.headers.get('content-length') || 0) > maxBytes) { void res.body?.cancel(); throw new Error('Response too large'); }
    /** @type {Uint8Array[]} */ const chunks = [];
    let size = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error('Response too large'); }
        chunks.push(value);
      }
    }
    return { url: u.toString(), status: res.status, type, buffer: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}

/** Normalise user input ("stripe", "stripe.com", "https://stripe.com/x") to an https URL, or null. @param {string} input */
export function toSiteUrl(input) {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes('.')) return null;
    return u;
  } catch { return null; }
}
