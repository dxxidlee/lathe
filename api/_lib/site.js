// @ts-check
/* Brand capture: fetch a homepage and its stylesheets (SSRF-safe), then extract title, meta, Open
   Graph images, favicon and logo candidates, declared typefaces (@font-face, Google Fonts, Adobe
   Fonts) and CSS color frequency. The extractors are pure functions of HTML/CSS text so they can be
   tested without the network. */
import { parse } from 'node-html-parser';
import { safeFetch } from './safefetch.js';
import { mapLimit } from './http.js';
import { COLOR_RE, parseColor, clusterColors } from './color.js';
import { archiveUrl, closestSnapshot, rawUrl } from './wayback.js';

export const LIMITS = { html: 3_000_000, css: 2_000_000, cssTotal: 6_000_000, sheets: 48, asset: 300_000, og: 900_000, logos: 12 };

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', '-apple-system', 'blinkmacsystemfont', 'apple color emoji',
  'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'android emoji', 'emojisymbols']);

/** Strip comments, then split CSS into rule bodies we can scan; returns plain text. @param {string} css */
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const unquote = (/** @type {string} */ s) => s.trim().replace(/^['"]|['"]$/g, '').trim();
/** @param {string} href @param {string} base */
const abs = (href, base) => { try { const u = new URL(href.trim(), base); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; } };

/* ------------------------------------------------------------------ CSS */

/**
 * @typedef {{ family: string, source: 'self-hosted' | 'Google Fonts' | 'Adobe Fonts' | 'Brandfetch', weights: number[], styles: string[], files: number }} FontFace
 * @typedef {{ colors: Map<string, number>, vars: Map<string, string[]>, faces: FontFace[], stacks: Map<string, { family: string, count: number, stack: string }>, fontVars: Map<string, string>, varRefs: Map<string, number>, imports: string[] }} CssFacts
 */

/** @returns {CssFacts} */
export const emptyFacts = () => ({ colors: new Map(), vars: new Map(), faces: [], stacks: new Map(), fontVars: new Map(), varRefs: new Map(), imports: [] });

/* A custom property that holds a font stack: named for fonts (not their size or weight), or ending in a generic family. */
const isFontVar = (/** @type {string} */ name, /** @type {string} */ value) =>
  (/font|family|typeface/i.test(name) && !/size|weight|height|spacing|feature|variation|style|smoothing|display/i.test(name) && /[a-z"']/i.test(value) && !/^[\d.]/.test(value))
  || /,\s*(sans-serif|serif|monospace|system-ui)\s*$/i.test(value);

/** Count a font stack by its first named (non-generic) family. @param {CssFacts} into @param {string} stack @param {number} n */
function addStack(into, stack, n) {
  const first = stack.split(',').map(unquote).find(f => f && !GENERIC.has(f.toLowerCase()) && !/^var\(/.test(f) && !/^(inherit|initial|unset)$/i.test(f) && !/^-(apple|webkit)-/i.test(f));
  if (!first) return;
  const k = first.toLowerCase(), cur = into.stacks.get(k);
  into.stacks.set(k, { family: cur?.family ?? first, count: (cur?.count ?? 0) + n, stack: cur?.stack ?? stack });
}

/** After every sheet is scanned: count `font-family: var(--x)` uses against the stack --x holds. @param {CssFacts} f */
export function resolveFontVars(f) {
  for (const [name, n] of f.varRefs) {
    let stack = f.fontVars.get(name);
    for (let i = 0; i < 3 && stack; i++) { const r = /^var\(\s*(--[\w-]+)/.exec(stack); if (!r) break; stack = f.fontVars.get(r[1]); }
    if (stack) addStack(f, stack, n);
  }
  f.varRefs.clear();
}

/**
 * Scan one stylesheet. Colors are counted per declaration value (translucent ones under 50% alpha are
 * skipped: they are overlays, not brand colors); custom properties keep the names that hold a color.
 * @param {string} cssText @param {string} base @param {FontFace['source']} source @param {CssFacts} [into]
 */
export function scanCss(cssText, base, source = 'self-hosted', into = emptyFacts()) {
  const css = stripComments(cssText);
  // Quoted URLs may contain ';' (Google Fonts css2: wght@400;700), so read them to the closing quote.
  for (const m of css.matchAll(/@import\s+(?:url\(\s*(?:(['"])(.*?)\1|([^)\s]+))\s*\)|(['"])(.*?)\4)/gi)) { const u = abs(m[2] ?? m[3] ?? m[5], base); if (u) into.imports.push(u); }
  // @font-face blocks
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = m[1];
    const fam = /font-family\s*:\s*([^;]+)/i.exec(body);
    if (!fam) continue;
    const family = unquote(fam[1]);
    const weight = /font-weight\s*:\s*([^;]+)/i.exec(body)?.[1].trim() ?? '400';
    const style = /font-style\s*:\s*([^;]+)/i.exec(body)?.[1].trim() ?? 'normal';
    let f = into.faces.find(x => x.family.toLowerCase() === family.toLowerCase());
    if (!f) { f = { family, source, weights: [], styles: [], files: 0 }; into.faces.push(f); }
    for (const w of weight.split(/\s+/).map(x => (x === 'normal' ? 400 : x === 'bold' ? 700 : parseInt(x, 10))).filter(Number.isFinite)) if (!f.weights.includes(w)) f.weights.push(w);
    if (!f.styles.includes(style)) f.styles.push(style);
    f.files++;
  }
  const noFaces = css.replace(/@font-face\s*\{[^}]*\}/gi, '');
  // declarations
  for (const m of noFaces.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+)/gi)) {
    const prop = m[1].toLowerCase(), value = m[2].replace(/url\([^)]*\)/gi, '').trim();
    if (prop === 'font-family' || prop === 'font' || (prop.startsWith('--') && isFontVar(prop, value))) {
      let stack = value.replace(/\s*!important/i, '').trim();
      if (prop === 'font') stack = /^(?:.*\s)?[\d.]+[a-z%]*(?:\s*\/\s*[\d.]+[a-z%]*)?\s+([^\d\s][\s\S]*)$/i.exec(stack)?.[1] ?? '';
      const ref = /^var\(\s*(--[\w-]+)/.exec(stack);
      if (prop.startsWith('--')) into.fontVars.set(prop, stack);
      else if (ref) into.varRefs.set(ref[1], (into.varRefs.get(ref[1]) ?? 0) + 1);
      else if (stack) addStack(into, stack, 1);
      if (prop !== 'font') continue;
    }
    for (const c of value.match(COLOR_RE) ?? []) {
      const p = parseColor(c);
      if (!p || p.alpha < 0.5) continue;
      into.colors.set(p.hex, (into.colors.get(p.hex) ?? 0) + 1);
      if (prop.startsWith('--')) { const names = into.vars.get(p.hex) ?? []; if (!names.includes(prop) && names.length < 4) names.push(prop); into.vars.set(p.hex, names); }
    }
  }
  return into;
}

/** Families named in a Google Fonts stylesheet URL (css and css2 APIs). @param {string} href */
export function googleFamilies(href) {
  try {
    const u = new URL(href);
    return u.searchParams.getAll('family').flatMap(f => f.split('|')).map(f => f.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean);
  } catch { return []; }
}

/* ------------------------------------------------------------------ HTML */

/**
 * @typedef {{ kind: 'icon' | 'apple-touch-icon' | 'mask-icon' | 'manifest' | 'favicon' | 'svg' | 'img' | 'brandfetch', label: string, url: string | null, svg?: string, sizes?: string, theme?: string }} LogoRef
 */

/**
 * Everything we can read from the HTML alone.
 * @param {string} html @param {string} base final URL after redirects
 */
export function scanHtml(html, base) {
  const root = parse(html, { comment: false, blockTextElements: { script: false, noscript: false, style: true, pre: true } });
  const meta = (/** @type {string} */ sel) => root.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const out = {
    title: root.querySelector('title')?.text.trim() || null,
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || meta('meta[name="apple-mobile-web-app-title"]'),
    themeColor: meta('meta[name="theme-color"]'),
    lang: root.querySelector('html')?.getAttribute('lang') || null,
    generator: meta('meta[name="generator"]'),
    og: {
      title: meta('meta[property="og:title"]'),
      image: abs(meta('meta[property="og:image"]') || meta('meta[property="og:image:url"]') || meta('meta[name="twitter:image"]') || '', base),
      type: meta('meta[property="og:type"]'),
    },
    /** @type {string[]} */ stylesheets: [],
    /** @type {string[]} */ inlineCss: [],
    /** @type {string[]} */ googleFonts: [],
    /** @type {string[]} */ adobeKits: [],
    /** @type {LogoRef[]} */ logos: [],
    manifest: /** @type {string | null} */ (null),
  };
  for (const l of root.querySelectorAll('link')) {
    const rel = (l.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    const href = abs(l.getAttribute('href') || '', base);
    if (!href) continue;
    if (rel.includes('stylesheet') || (rel.includes('preload') && l.getAttribute('as') === 'style')) {
      if (/fonts\.googleapis\.com\/css/.test(href)) out.googleFonts.push(...googleFamilies(href));
      if (/use\.typekit\.net\//.test(href)) out.adobeKits.push(href);
      if (!out.stylesheets.includes(href)) out.stylesheets.push(href);
    }
    if (rel.includes('icon') || rel.includes('shortcut')) out.logos.push({ kind: 'icon', label: `Icon${l.getAttribute('sizes') ? ' ' + l.getAttribute('sizes') : ''}`, url: href, sizes: l.getAttribute('sizes') || undefined });
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) out.logos.push({ kind: 'apple-touch-icon', label: 'Apple touch icon', url: href, sizes: l.getAttribute('sizes') || undefined });
    if (rel.includes('mask-icon')) out.logos.push({ kind: 'mask-icon', label: 'Safari mask icon', url: href });
    if (rel.includes('manifest')) out.manifest = href;
  }
  for (const s of root.querySelectorAll('script[src]')) { const src = abs(s.getAttribute('src') || '', base); if (src && /use\.typekit\.net\/\w+\.js/.test(src)) out.adobeKits.push(src); }
  for (const s of root.querySelectorAll('style')) out.inlineCss.push(s.text);
  // inline style attributes count toward color frequency like a stylesheet
  const inlineStyles = root.querySelectorAll('[style]').map(e => `x{${e.getAttribute('style')}}`).join('\n');
  if (inlineStyles) out.inlineCss.push(inlineStyles);
  if (!out.logos.some(l => l.kind === 'icon')) out.logos.push({ kind: 'favicon', label: 'favicon.ico', url: abs('/favicon.ico', base) });

  // Logo candidates in the page: SVGs and images in the header/nav or the home link, or named "logo".
  const named = (/** @type {import('node-html-parser').HTMLElement} */ e) => /logo|brand|wordmark/i.test([e.getAttribute('class'), e.getAttribute('id'), e.getAttribute('aria-label'), e.getAttribute('alt'), e.getAttribute('title'), e.getAttribute('src')].join(' '));
  const homeHref = (/** @type {string} */ h) => h === '/' || abs(h, base) === new URL('/', base).toString();
  /** Inside the header/nav (`header`), or inside the link back to the home page (`home`). @param {import('node-html-parser').HTMLElement} e */
  const where = e => {
    let header = false, home = false;
    for (let p = e.parentNode; p && p.tagName; p = p.parentNode) {
      const tag = p.tagName.toLowerCase();
      if (tag === 'header' || tag === 'nav' || named(p)) header = true;
      if (tag === 'a' && homeHref(p.getAttribute('href') || '')) home = true;
    }
    return { header, home };
  };
  const byId = (/** @type {string} */ id) => root.querySelector(`[id="${id.replace(/"/g, '')}"]`);
  let svgs = 0, imgs = 0;
  for (const svg of root.querySelectorAll('svg')) {
    if (svgs >= 3) break;
    const w = where(svg);
    if (!(named(svg) || w.home || (w.header && svgs === 0 && !svg.querySelector('use')))) continue;
    let markup = svg.toString();
    if (markup.length > 60_000 || markup.length < 80) continue;
    // Pull in sprite symbols referenced by <use href="#id">, so the SVG stands alone.
    const defs = [...markup.matchAll(/<use[^>]+(?:xlink:)?href="#([^"]+)"/g)].map(m => byId(m[1])).filter(Boolean).map(el => String(el));
    if (defs.length) markup = markup.replace(/>/, `><defs>${defs.join('')}</defs>`);
    if (!/xmlns=/.test(markup)) markup = markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/xlink:href/.test(markup) && !/xmlns:xlink=/.test(markup)) markup = markup.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    // Scripts and handlers never run in an <img>, but strip them so the markup is inert anywhere.
    markup = markup.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
    out.logos.push({ kind: 'svg', label: named(svg) ? 'Inline SVG (named logo)' : w.home ? 'Inline SVG in the home link' : 'Inline SVG in header', url: null, svg: markup });
    svgs++;
  }
  for (const img of root.querySelectorAll('img')) {
    if (imgs >= 3) break;
    const src = abs(img.getAttribute('src') || img.getAttribute('data-src') || '', base);
    // Images count when named as a logo, inside the home link, or an SVG file in the header: photos in menus do not.
    const w = where(img);
    if (!src || !(named(img) || w.home || (w.header && /\.svg(\?|$)/i.test(src)))) continue;
    out.logos.push({ kind: 'img', label: img.getAttribute('alt') ? `Image “${img.getAttribute('alt')}”` : 'Image in header', url: src });
    imgs++;
  }
  return out;
}

/* ------------------------------------------------------------------ fetch + assemble */

/** @param {Buffer} buf @param {string} type */
const dataUri = (buf, type) => `data:${type};base64,${buf.toString('base64')}`;
/** @param {Buffer} buf @param {string} url @param {string} type */
function imageType(buf, url, type) {
  const t = type.split(';')[0].trim().toLowerCase();
  if (/^image\//.test(t)) return t === 'image/vnd.microsoft.icon' ? 'image/x-icon' : t;
  const head = buf.subarray(0, 64).toString('latin1');
  if (/<svg|<\?xml/i.test(head) || /\.svg(\?|$)/i.test(url)) return 'image/svg+xml';
  if (head.startsWith('\x89PNG')) return 'image/png';
  if (head.startsWith('\xFF\xD8')) return 'image/jpeg';
  if (head.startsWith('\0\0\x01\0')) return 'image/x-icon';
  if (head.startsWith('GIF8')) return 'image/gif';
  if (head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Fetch an image as a data URI (bounded), or null.
 * @param {string} url @param {number} maxBytes
 */
export async function fetchImageData(url, maxBytes) {
  try {
    const r = await safeFetch(url, { maxBytes, accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.5', timeout: 8000 });
    if (r.status !== 200 || !r.buffer.length) return null;
    const type = imageType(r.buffer, r.url, r.type);
    return type ? { dataUri: dataUri(r.buffer, type), type, bytes: r.buffer.length, url: r.url } : null;
  } catch { return null; }
}

/** @param {string} url @param {number} maxBytes */
async function fetchText(url, maxBytes) {
  const r = await safeFetch(url, { maxBytes, accept: 'text/css,*/*;q=0.5', timeout: 8000 });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return { text: r.buffer.toString('utf8'), url: r.url };
}

/**
 * Capture a site. Returns everything the Audit brand mode shows, with logos inlined as data URIs.
 * @param {URL} site
 * @param {{ merge: number, top: number }} o
 */
export async function captureSite(site, o) {
  const t0 = Date.now();
  /* Many sites put automated requests behind a bot wall (401/403/429/503). Then the capture reads
     the Wayback Machine's latest snapshot instead, raw (id_), resolving every subresource through it. */
  /** @type {{ timestamp: string, original: string } | null} */ let snap = null;
  let liveStatus = 0, liveError = null;
  /** @type {Awaited<ReturnType<typeof safeFetch>> | null} */ let page = null;
  try {
    page = await safeFetch(site.toString(), { maxBytes: LIMITS.html, accept: 'text/html,application/xhtml+xml', timeout: 15000 });
    liveStatus = page.status;
  } catch (e) {
    liveError = e instanceof Error ? e.message : String(e);
    if (/Private|Only|credentials|redirects/.test(liveError)) throw e; // refused by the SSRF guard: no fallback
  }
  if (!page || [401, 403, 429].includes(page.status) || page.status >= 500) {
    const why = liveError ?? `The site answered ${liveStatus}`;
    try { snap = await closestSnapshot(site.toString(), new Date().toISOString().slice(0, 10).replace(/-/g, '')); }
    catch (e) { throw new Error(`${why}, and the Wayback Machine fallback failed (${e instanceof Error ? e.message : e})`); }
    if (!snap) throw new Error(`${why}, and the Wayback Machine has no capture of it`);
    page = await safeFetch(rawUrl(snap.timestamp, snap.original), { maxBytes: LIMITS.html, accept: 'text/html', timeout: 20000 });
    if (page.status >= 400) throw new Error(`The site answered ${liveStatus || liveError} and its Wayback capture answered ${page.status}`);
  } else if (page.status >= 400) throw new Error(`The site answered ${page.status}`);
  const ts = snap?.timestamp;
  /** Unwrap an archive URL back to the original it captured. @param {string} u */
  const unwrap = u => u.replace(/^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//, '');
  /** Where to fetch a subresource from: live, or through the snapshot. @param {string} u */
  const via = u => (ts && !/^https?:\/\/web\.archive\.org\//.test(u) ? rawUrl(ts, u) : u);
  const base = ts ? unwrap(page.url) : page.url;
  if (!/html|xml/i.test(page.type) && !/<html|<head|<body/i.test(page.buffer.subarray(0, 2000).toString('utf8'))) throw new Error('The address did not return a web page');
  const html = page.buffer.toString('utf8');
  const h = scanHtml(html, base);
  const facts = emptyFacts();
  for (const css of h.inlineCss) scanCss(css, base, 'self-hosted', facts);

  // Stylesheets (one level of @import), bounded in count and total bytes.
  /** @type {{ url: string, bytes: number, ok: boolean }[]} */ const sheets = [];
  let total = 0;
  const loadSheets = async (/** @type {string[]} */ urls) => {
    const todo = urls.filter(u => !sheets.some(s => s.url === u)).slice(0, Math.max(0, LIMITS.sheets - sheets.length));
    const before = facts.imports.length;
    await mapLimit(todo, 6, async u => {
      if (total > LIMITS.cssTotal) return;
      const src = /fonts\.googleapis\.com/.test(u) ? 'Google Fonts' : /typekit\.net/.test(u) ? 'Adobe Fonts' : 'self-hosted';
      if (/use\.typekit\.net\/\w+\.js/.test(u)) { sheets.push({ url: u, bytes: 0, ok: false }); return; }
      try {
        const r = await fetchText(via(u), LIMITS.css);
        total += r.text.length; sheets.push({ url: u, bytes: r.text.length, ok: true });
        // Font services' CSS: keep their @font-face families, not their declarations.
        if (src === 'self-hosted') scanCss(r.text, unwrap(r.url), src, facts);
        else for (const f of scanCss(r.text, unwrap(r.url), src).faces) if (!facts.faces.some(x => x.family.toLowerCase() === f.family.toLowerCase())) facts.faces.push(f);
      } catch { sheets.push({ url: u, bytes: 0, ok: false }); }
    });
    return facts.imports.slice(before);
  };
  const imported = await loadSheets([...h.stylesheets, ...h.adobeKits.filter(k => k.endsWith('.css'))]);
  if (imported.length) await loadSheets(imported);
  for (const u of facts.imports.filter(u => /fonts\.googleapis\.com\/css/.test(u))) h.googleFonts.push(...googleFamilies(u));

  resolveFontVars(facts);
  // Typefaces: declared faces (and Google families) ranked by how often stacks lead with them.
  /** @type {Map<string, { family: string, source: string, weights: number[], styles: string[], uses: number, stack: string | null }>} */
  const fonts = new Map();
  for (const f of facts.faces) fonts.set(f.family.toLowerCase(), { family: f.family, source: f.source, weights: f.weights.sort((a, b) => a - b), styles: f.styles, uses: 0, stack: null });
  for (const g of h.googleFonts) if (!fonts.has(g.toLowerCase())) fonts.set(g.toLowerCase(), { family: g, source: 'Google Fonts', weights: [], styles: [], uses: 0, stack: null });
  for (const [k, s] of facts.stacks) {
    const f = fonts.get(k);
    if (f) { f.uses += s.count; f.stack ??= s.stack; }
    else fonts.set(k, { family: s.family, source: 'system or unresolved', weights: [], styles: [], uses: s.count, stack: s.stack });
  }
  const typefaces = [...fonts.values()].filter(f => f.uses > 0 || f.source !== 'system or unresolved')
    .sort((a, b) => b.uses - a.uses || a.family.localeCompare(b.family)).slice(0, 12);

  // Colors: clustered, ranked, with the custom properties that name them.
  const theme = h.themeColor ? parseColor(h.themeColor) : null;
  if (theme) facts.colors.set(theme.hex, (facts.colors.get(theme.hex) ?? 0) + 1);
  const clusters = clusterColors(facts.colors, o.merge);
  const colors = clusters.slice(0, o.top).map(c => ({ ...c, vars: c.members.flatMap(m => facts.vars.get(m) ?? []).slice(0, 3) }));

  // Logos: manifest icons first (largest), then link icons, inline SVGs and header images.
  if (h.manifest) {
    try {
      const m = JSON.parse((await fetchText(via(h.manifest), 200_000)).text);
      const icons = (Array.isArray(m.icons) ? m.icons : []).map((/** @type {any} */ i) => ({ ...i, px: Math.max(...String(i.sizes || '0').split(/\s+/).map(s => parseInt(s, 10) || 0)) }))
        .sort((/** @type {any} */ a, /** @type {any} */ b) => b.px - a.px);
      const best = icons[0] && abs(icons[0].src, h.manifest);
      if (best) h.logos.unshift({ kind: 'manifest', label: `Manifest icon${icons[0].sizes ? ' ' + icons[0].sizes : ''}`, url: best, sizes: icons[0].sizes });
      h.siteName ??= m.name || m.short_name || null;
    } catch { /* no manifest */ }
  }
  // A few of each kind: sites often list a dozen icon sizes, which would crowd out the real logos.
  const PER_KIND = /** @type {Record<string, number>} */ ({ icon: 2, 'apple-touch-icon': 1, manifest: 1, 'mask-icon': 1, favicon: 1, svg: 3, img: 3 });
  const px = (/** @type {LogoRef} */ l) => (/\.svg(\?|$)/i.test(l.url ?? '') || l.sizes === 'any' ? 1e4 : Math.max(0, ...String(l.sizes ?? '0').split(/\s+/).map(v => parseInt(v, 10) || 0)));
  const seen = new Set(), taken = /** @type {Record<string, number>} */ ({});
  const refs = h.logos.map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.kind === b.l.kind ? px(b.l) - px(a.l) : 0) || a.i - b.i)
    .map(x => x.l)
    .filter(l => { const k = l.url ?? l.svg; if (seen.has(k) || (taken[l.kind] ?? 0) >= (PER_KIND[l.kind] ?? 1)) return false; seen.add(k); taken[l.kind] = (taken[l.kind] ?? 0) + 1; return true; })
    .slice(0, LIMITS.logos);
  const logos = (await mapLimit(refs, 4, async l => {
    if (l.svg) {
      const bytes = Buffer.byteLength(l.svg);
      return bytes > LIMITS.asset ? null : { kind: l.kind, label: l.label, url: null, dataUri: dataUri(Buffer.from(l.svg), 'image/svg+xml'), type: 'image/svg+xml', bytes, sizes: l.sizes ?? null };
    }
    const d = l.url ? await fetchImageData(via(l.url), LIMITS.asset) : null;
    return d ? { kind: l.kind, label: l.label, url: unwrap(d.url), dataUri: d.dataUri, type: d.type, bytes: d.bytes, sizes: l.sizes ?? null } : null;
  })).filter(Boolean);
  const og = h.og.image ? await fetchImageData(via(h.og.image), LIMITS.og) : null;

  return {
    url: base, host: new URL(base).hostname,
    via: ts ? 'wayback' : 'live', liveStatus: liveStatus || null, liveError,
    snapshot: snap ? { timestamp: snap.timestamp, archiveUrl: archiveUrl(snap.timestamp, snap.original) } : null,
    title: h.title, description: h.description, siteName: h.siteName, themeColor: theme?.hex ?? null, lang: h.lang, generator: h.generator,
    og: { title: h.og.title, type: h.og.type, image: h.og.image, imageData: og?.dataUri ?? null },
    logos, typefaces, colors,
    declared: [...facts.colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([hex]) => hex), // every declared color, for matching screenshot colors
    colorStats: { declarations: [...facts.colors.values()].reduce((s, n) => s + n, 0), unique: facts.colors.size, clusters: clusters.length },
    stylesheets: sheets, adobeKits: h.adobeKits, googleFonts: [...new Set(h.googleFonts)],
    ms: Date.now() - t0,
  };
}
