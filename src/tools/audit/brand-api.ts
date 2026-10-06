/* Audit brand mode client: site capture, Wayback timeline, Microlink screenshots and Claude
   observations from /api/brand/*, cached in IndexedDB (screenshots as blobs) so a re-run spends no
   screenshot quota. */
import { cacheGet, cacheSet } from '../../lib/idb';

export interface LogoCandidate { kind: string; label: string; url: string | null; dataUri: string; type: string; bytes: number; sizes: string | null; theme?: string | null }
export interface Typeface { family: string; source: string; weights: number[]; styles: string[]; uses: number; stack: string | null }
export interface CssColor { hex: string; count: number; share: number; members: string[]; vars: string[] }
export interface SiteCapture {
  url: string; host: string; via: 'live' | 'wayback'; liveStatus: number | null; liveError: string | null;
  snapshot: { timestamp: string; archiveUrl: string } | null;
  title: string | null; description: string | null; siteName: string | null; themeColor: string | null; lang: string | null; generator: string | null;
  og: { title: string | null; type: string | null; image: string | null; imageData: string | null };
  logos: LogoCandidate[]; typefaces: Typeface[]; colors: CssColor[]; declared: string[];
  /** Social profiles the site links to, by platform (youtube, instagram, tiktok, x, …). */
  social: Record<string, string>;
  /** Large content images on the homepage (hero, product, campaign photography). */
  images: { url: string; alt: string | null; w: number | null }[];
  colorStats: { declarations: number; unique: number; clusters: number };
  stylesheets: { url: string; bytes: number; ok: boolean }[]; googleFonts: string[]; adobeKits: string[]; ms: number;
}
export interface Brandfetch {
  name: string | null; description: string | null; claimed: boolean; url: string;
  logos: LogoCandidate[]; colors: { hex: string; type: string | null }[]; fonts: { name: string; type: string | null; origin: string | null }[];
}
export interface BrandCapture {
  query: string; domain: string; capturedAt: string;
  company: { name: string; description: string | null; website: string; wikidata: string | null } | null;
  site: SiteCapture; brandfetch: Brandfetch | null; brandfetchError: string | null;
}
export interface Snapshot { year: number; timestamp: string; original: string; archiveUrl: string; renderUrl: string }
export interface Timeline { domain: string; firstYear: number; years: number[]; snapshots: Snapshot[]; ms: number }
export interface Observation { area: 'consistency' | 'hierarchy' | 'type' | 'color' | 'tone'; text: string; evidence: string[] }
export interface Observations { generated: true; model: string; generatedAt: string; summary: string; observations: Observation[]; dropped: number }

export interface Still { url: string; fallback: string[]; label: string }
export interface Video { id: string; title: string; duration: string | null; url: string; stills: Still[]; channel?: string | null }
export interface Social {
  youtube: { source: 'channel' | 'search'; channel: { id: string; title: string; url: string } | null; query?: string; videos: Video[] } | null;
  notes?: string[]; ms: number;
}

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || body.error) throw new ApiError(body.error || `HTTP ${r.status}`, r.status);
  return body as T;
}

export async function captureBrand(q: string, o: { merge: number; top: number; cacheHours: number }, signal?: AbortSignal): Promise<BrandCapture & { cached?: boolean }> {
  const key = `brand:capture2:${q.trim().toLowerCase()}:${o.merge}:${o.top}`;
  const hit = await cacheGet<BrandCapture>(key);
  if (hit) return { ...hit, cached: true };
  const out = await getJson<BrandCapture>(`/api/brand/capture?q=${encodeURIComponent(q)}&merge=${o.merge}&top=${o.top}`, signal);
  await cacheSet(key, out, o.cacheHours * 3600_000);
  return out;
}

export async function fetchTimeline(domain: string, o: { snapshots: number; span: number; cacheHours: number }, signal?: AbortSignal): Promise<Timeline> {
  const key = `brand:timeline:${domain}:${o.snapshots}:${o.span}`;
  const hit = await cacheGet<Timeline>(key);
  if (hit) return hit;
  const out = await getJson<Timeline>(`/api/brand/timeline?domain=${encodeURIComponent(domain)}&snapshots=${o.snapshots}&span=${o.span}`, signal);
  await cacheSet(key, out, o.cacheHours * 3600_000);
  return out;
}

export interface Shot { blob: Blob; width: number; height: number; quotaRemaining: number | null; cached: boolean }

/** A screenshot as a Blob. Throws ApiError (429 when the free quota is spent). */
export async function fetchShot(url: string, device: 'desktop' | 'mobile', size: { w: number; h: number }, cacheHours: number, signal?: AbortSignal): Promise<Shot> {
  const key = `brand:shot:${device}:${size.w}x${size.h}:${url}`;
  const hit = await cacheGet<{ blob: Blob; width: number; height: number }>(key);
  if (hit?.blob instanceof Blob) return { ...hit, quotaRemaining: null, cached: true };
  const r = await fetch(`/api/brand/shot?url=${encodeURIComponent(url)}&device=${device}&w=${size.w}&h=${size.h}`, { signal });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new ApiError(body?.error || `Screenshot failed (HTTP ${r.status})`, r.status);
  }
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob);
  const out = { blob, width: bmp.width, height: bmp.height };
  bmp.close();
  await cacheSet(key, out, cacheHours * 3600_000);
  const q = r.headers.get('x-lathe-quota-remaining');
  return { ...out, quotaRemaining: q == null || q === '' ? null : Number(q), cached: false };
}

/** JPEG data URL of a blob, longest edge at most `maxPx` (keeps observation requests small). */
export async function downscale(blob: Blob, maxPx: number, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  return cv.toDataURL('image/jpeg', quality);
}

export async function requestObservations(body: unknown, signal?: AbortSignal): Promise<Observations> {
  const r = await fetch('/api/brand/observe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new ApiError(j.error || `HTTP ${r.status}`, r.status);
  return j as Observations;
}

/** YouTube stills for the brand (its own channel when it has one), cached like the capture. */
export async function fetchSocial(name: string, youtube: string | undefined, o: { videos: number; cacheHours: number }, signal?: AbortSignal): Promise<Social> {
  const key = `brand:social2:${name.toLowerCase()}:${youtube ?? ''}:${o.videos}`;
  const hit = await cacheGet<Social>(key);
  if (hit) return hit;
  const out = await getJson<Social>(`/api/brand/social?name=${encodeURIComponent(name)}${youtube ? `&youtube=${encodeURIComponent(youtube)}` : ''}&videos=${o.videos}`, signal);
  await cacheSet(key, out, o.cacheHours * 3600_000);
  return out;
}

/** The site's images and logos as a browser renders them (only needed when the HTML capture found few). */
export async function fetchRendered(siteUrl: string, cacheHours: number, signal?: AbortSignal): Promise<{ images: SiteCapture['images']; logos: string[] }> {
  const key = `brand:rendered2:${siteUrl}`;
  const hit = await cacheGet<{ images: SiteCapture['images']; logos: string[] }>(key);
  if (hit) return hit;
  const out = await getJson<{ images: SiteCapture['images']; logos?: string[] }>(`/api/brand/social?render=${encodeURIComponent(siteUrl)}`, signal);
  const val = { images: out.images, logos: out.logos ?? [] };
  await cacheSet(key, val, cacheHours * 3600_000);
  return val;
}

/** A logo file from any public URL (through /api/fetch) as a logo candidate. */
export async function logoFromUrl(url: string, label: string): Promise<LogoCandidate | null> {
  try {
    const r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const blob = await r.blob();
    const dataUri = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { kind: blob.type === 'image/svg+xml' ? 'svg' : 'img', label, url, dataUri, type: blob.type, bytes: blob.size, sizes: null };
  } catch { return null; }
}
