// Milestone 6: keyed sources (fixture-tested without keys) and Audit brand mode: site capture,
// SSRF guard, screenshots, Wayback timeline, observations, and the brand deck in Bento with exports.
// Unit checks run in-process against fixtures; API checks hit live sites, archive.org and Wikidata;
// the UI runs against the production build (vite preview) with Microlink replaced by a local
// stand-in that screenshots with Playwright (MICROLINK_API), so the suite spends no screenshot quota.
// One live Microlink request checks the real integration.
// Usage: npm run verify:brand
import { chromium } from 'playwright';
import JSZip from 'jszip';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, assert, check, openPage, download, pngInfo, jpegInfo, imgStats, HAS_GS, Warn } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'out', 'brand');
const PORT = 4323, ML_PORT = 4324;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = 'stripe.com';
state.out = OUT;
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const api = p => import(join(ROOT, 'api', p));
const fixture = n => JSON.parse(readFileSync(join(HERE, 'fixtures', 'api', n), 'utf8'));
console.log('lathe brand audit (milestone 6)');

/* ================= unit: keyed sources on fixtures ================= */
state.tool = 'sources';
const realFetch = globalThis.fetch;
/** Replace fetch for one block; `route` returns a Response or undefined (falls through). */
async function withFetch(route, fn) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(new Headers(input instanceof Request ? input.headers : init.headers || {}));
    const body = input instanceof Request ? await input.clone().text() : init.body;
    calls.push({ url, headers, body });
    const r = await route(url, headers, body);
    if (!r) throw new Error('unrouted fetch ' + url);
    return r;
  };
  try { return await fn(calls); } finally { globalThis.fetch = realFetch; }
}
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const SCHEMA = { id: 'string', source: 'string', title: 'string', imageUrl: 'string', thumbUrl: 'string', license: 'string', isPublicDomain: 'boolean', sourceUrl: 'string' };
const schemaBad = r => Object.entries(SCHEMA).find(([k, t]) => typeof r[k] !== t || (t === 'string' && !r[k]))?.[0] ?? (!r.id.startsWith(r.source + ':') ? 'id prefix' : null);

await check('Harvard adapter (fixture): key sent, restricted images dropped, IIIF sizes, normalized schema', async () => {
  const { search } = await api('_lib/sources/harvard.js');
  return withFetch(() => jsonRes(fixture('harvard.json')), async calls => {
    const r = await search('bauhaus', { page: 2, limit: 24, env: { HARVARD_KEY: 'k-test' } });
    const u = new URL(calls[0].url);
    assert(u.searchParams.get('apikey') === 'k-test' && u.searchParams.get('page') === '2' && u.searchParams.get('hasimage') === '1', calls[0].url);
    assert(r.total === 3 && r.results.length === 2, `${r.total} / ${r.results.length}`);
    const [a, b] = r.results;
    assert(!schemaBad(a) && !schemaBad(b), schemaBad(a) || schemaBad(b));
    assert(a.imageUrl === 'https://ids.lib.harvard.edu/ids/iiif/18737480/full/1600,/0/default.jpg' && a.thumbUrl.endsWith('/full/400,/0/default.jpg'), a.imageUrl);
    assert(a.creator === 'Joost Schmidt' && a.year === 1923 && a.width === 2400 && /Artists Rights/.test(a.license), JSON.stringify(a));
    assert(b.imageUrl === 'https://nrs.harvard.edu/urn-3:HUAM:2' && b.sourceUrl.endsWith('/object/2'), b.imageUrl);
    return `2 of 3 kept (imagepermissionlevel 1 dropped); IIIF 1600/400; fallback primaryimageurl`;
  });
});
await check('Unsplash adapter (fixture): Client-ID header, credit line, UTM links, deck-sized URLs', async () => {
  const { search } = await api('_lib/sources/unsplash.js');
  return withFetch(() => jsonRes(fixture('unsplash.json')), async calls => {
    const r = await search('swiss signage', { page: 1, limit: 24, env: { UNSPLASH_KEY: 'u-test' } });
    assert(calls[0].headers.authorization === 'Client-ID u-test' && calls[0].headers['accept-version'] === 'v1', JSON.stringify(calls[0].headers));
    const [a, b] = r.results;
    assert(r.results.length === 2 && !schemaBad(a) && !schemaBad(b), schemaBad(a) || schemaBad(b));
    assert(a.creator === 'Photo by Ada Lovelace on Unsplash' && a.license === 'Unsplash License' && !a.isPublicDomain, a.creator);
    assert(a.imageUrl === 'https://images.unsplash.com/photo-1?ixid=x&w=1920&q=80&fm=jpg' && /utm_source=lathe/.test(a.sourceUrl), a.imageUrl);
    assert(b.title === 'Untitled photograph' && b.creator === null && b.date === null, JSON.stringify(b));
    return 'credit "Photo by … on Unsplash"; utm_source=lathe; 1920px imageUrl';
  });
});
await check('Keyed adapters surface API errors (401 without a valid key)', async () => {
  const out = [];
  for (const [file, env] of [['harvard.js', { HARVARD_KEY: 'bad' }], ['unsplash.js', { UNSPLASH_KEY: 'bad' }], ['europeana.js', { EUROPEANA_KEY: 'bad' }], ['smithsonian.js', { SMITHSONIAN_KEY: 'bad' }]]) {
    const { search } = await api('_lib/sources/' + file);
    await withFetch(() => jsonRes({ error: 'unauthorized' }, 401), async () => {
      try { await search('x', { page: 1, limit: 24, env }); out.push(`${file}: no error`); } catch (e) { out.push(`${file}: ${e.message}`); }
    });
  }
  assert(out.every(o => /HTTP 401/.test(o)), out.join('; '));
  return out.map(o => o.split(':')[0]).join(', ') + ' throw HTTP 401';
});

/* ================= unit: brand extraction ================= */
state.tool = 'extract';
const color = await api('_lib/color.js');
const site = await api('_lib/site.js');
await check('CSS color parsing: hex, rgb, hsl, oklch, oklab, alpha; variables refused', async () => {
  const cases = {
    '#e8ff1a': '#E8FF1A', '#fff': '#FFFFFF', '#0008': null, '#11223380': '#112233', 'rgb(232, 255, 26)': '#E8FF1A', 'rgb(232 255 26 / 50%)': '#E8FF1A',
    'rgba(0,0,0,.2)': '#000000', 'rgb(100%, 0%, 0%)': '#FF0000', 'hsl(0 100% 50%)': '#FF0000', 'hsl(120deg, 100%, 25%)': '#008000',
    'oklch(0.628 0.2577 29.23)': '#FF0000', 'oklab(1 0 0)': '#FFFFFF', 'var(--x)': null, 'rgb(var(--r) 0 0)': null, white: '#FFFFFF',
  };
  const bad = [];
  for (const [inp, want] of Object.entries(cases)) {
    const got = color.parseColor(inp);
    if (want === null ? got && got.alpha === 1 && inp !== '#0008' : got?.hex !== want) bad.push(`${inp} → ${got?.hex}`);
  }
  assert(color.parseColor('rgba(0,0,0,.2)').alpha === 0.2 && Math.abs(color.parseColor('#11223380').alpha - 0.502) < 0.01, 'alpha');
  assert(!bad.length, bad.join(', '));
  return `${Object.keys(cases).length} values`;
});
await check('Color clustering merges near colors in OKLab and ranks by use', async () => {
  const c = color.clusterColors(new Map([['#635BFF', 10], ['#635CFF', 4], ['#FFFFFF', 7], ['#FEFEFE', 2], ['#000000', 1]]), 0.04);
  assert(c.length === 3 && c[0].hex === '#635BFF' && c[0].count === 14 && c[1].count === 9 && Math.abs(c.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, JSON.stringify(c));
  return c.map(x => `${x.hex}×${x.count}`).join(' ');
});
await check('CSS scan: @font-face, font stacks through variables and shorthand, colors and their custom properties', async () => {
  const f = site.emptyFacts();
  site.scanCss(`
    /* #ABCDEF in a comment is ignored */
    @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Space+Grotesk");
    @font-face { font-family: "Brand Sans"; font-weight: 100 900; src: url(a.woff2) format("woff2"); }
    @font-face { font-family: 'Brand Sans'; font-style: italic; src: url(b.woff2); }
    :root { --font-body: "Brand Sans", -apple-system, sans-serif; --brand-primary: #635BFF; --shadow: rgba(0,0,0,.1); }
    body { font-family: var(--font-body); color: #0A2540; background: url(data:image/png;base64,#FF0000) }
    h1 { font: 700 48px/1.1 "Brand Sans", serif; color: #635BFF; }
    code { font-family: Menlo, monospace }`, 'https://ex.com/', 'self-hosted', f);
  site.resolveFontVars(f);
  const face = f.faces.find(x => x.family === 'Brand Sans');
  assert(face && face.files === 2 && face.weights.join() === '100,900,400' && face.styles.includes('italic'), JSON.stringify(f.faces));
  assert(f.stacks.get('brand sans')?.count === 2 && f.stacks.get('menlo')?.count === 1, JSON.stringify([...f.stacks]));
  assert(f.colors.get('#635BFF') === 2 && f.colors.get('#0A2540') === 1 && !f.colors.has('#ABCDEF') && !f.colors.has('#FF0000') && !f.colors.has('#000000'), JSON.stringify([...f.colors]));
  assert(f.vars.get('#635BFF')?.includes('--brand-primary') && f.imports[0].startsWith('https://fonts.googleapis.com/'), 'vars/imports');
  assert(site.googleFamilies(f.imports[0]).join() === 'Inter,Space Grotesk', site.googleFamilies(f.imports[0]).join());
  return 'faces, var() stacks, shorthand, comments/url()/translucent skipped, custom-property names, Google families';
});
await check('HTML scan: meta, Open Graph, icons, manifest, logo SVGs (sprites inlined, scripts stripped); menu photos ignored', async () => {
  const h = site.scanHtml(`<!doctype html><html lang="en"><head><title> Acme — Tools </title>
    <meta name="description" content="We make tools."><meta property="og:image" content="/og.png"><meta name="theme-color" content="#E8FF1A">
    <link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png"><link rel="manifest" href="/site.webmanifest">
    <link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto+Mono|Lora:400,700">
    <link rel="stylesheet" href="https://use.typekit.net/abc1234.css"></head><body>
    <svg style="display:none"><symbol id="mark" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></svg>
    <header><a href="/" aria-label="Acme home"><svg viewBox="0 0 10 10" onload="alert(1)"><use href="#mark"/><script>alert(1)</script></svg></a>
      <nav><img src="/photos/street.jpg" alt="A street"><svg class="chevron" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></nav></header>
    <img src="/img/acme-logo.png" alt="Acme logo"><div style="color: #FF5500">x</div></body></html>`, 'https://acme.test/');
  assert(h.title === 'Acme — Tools' && h.description === 'We make tools.' && h.themeColor === '#E8FF1A' && h.lang === 'en', JSON.stringify([h.title, h.description]));
  assert(h.og.image === 'https://acme.test/og.png' && h.manifest === 'https://acme.test/site.webmanifest', h.og.image);
  assert(h.stylesheets.length === 3 && h.googleFonts.join() === 'Roboto Mono,Lora' && h.adobeKits.length === 1, JSON.stringify(h.googleFonts));
  const kinds = h.logos.map(l => l.kind);
  assert(kinds.includes('icon') && kinds.includes('apple-touch-icon'), kinds.join());
  const svg = h.logos.find(l => l.kind === 'svg');
  assert(svg && /<defs><symbol id="mark"/.test(svg.svg) && /xmlns="http:\/\/www.w3.org\/2000\/svg"/.test(svg.svg) && !/script|onload/i.test(svg.svg), svg?.svg);
  const imgs = h.logos.filter(l => l.kind === 'img').map(l => l.url);
  assert(imgs.join() === 'https://acme.test/img/acme-logo.png', imgs.join());
  assert(h.inlineCss.some(c => /#FF5500/.test(c)), 'inline style attributes');
  return `${h.logos.length} logo candidates: ${kinds.join(', ')}`;
});
await check('SSRF guard: private, loopback, link-local, metadata and non-HTTP targets refused', async () => {
  const { safeFetch, isPrivateIp } = await api('_lib/safefetch.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert(!isPrivateIp(ip), ip);
  const refused = [];
  for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.1/', 'https://example.com:8443/', 'file:///etc/passwd', 'http://user:pw@example.com/', 'http://localtest.me/']) {
    try { await safeFetch(u, { timeout: 4000 }); } catch (e) { refused.push(`${u}: ${e.message}`); continue; }
    throw new Error(`${u} was fetched`);
  }
  return `${refused.length} refused (incl. a public name resolving to 127.0.0.1)`;
});
await check('Timeline year picking spreads snapshots evenly, first and last included', async () => {
  const { pickYears } = await api('brand/timeline.js');
  const a = pickYears(2006, 2026, 6), b = pickYears(2022, 2026, 8), c = pickYears(2026, 2026, 6);
  assert(a.join() === '2006,2010,2014,2018,2022,2026' && b.join() === '2022,2023,2024,2025,2026' && c.join() === '2026', `${a} | ${b} | ${c}`);
  return a.join(' ');
});
await check('Observations endpoint (stubbed Claude): model, fallback, JSON schema, images; uncited observations dropped', async () => {
  const { POST, MODEL } = await api('brand/observe.js');
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const answer = { summary: 'Purple accents on white.', observations: [
    { area: 'color', text: 'The primary button is #635BFF in both captures.', evidence: ['desktop', 'mobile'] },
    { area: 'tone', text: 'Invented claim with no capture.', evidence: ['nope'] },
  ] };
  const img = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
  const body = { name: 'Stripe', domain: 'stripe.com', captures: [{ id: 'desktop', label: 'Homepage, desktop', dataUrl: img }, { id: 'mobile', label: 'Homepage, mobile', dataUrl: img }, { id: 'x', label: 'bad', dataUrl: 'javascript:1' }], facts: { cssColors: [{ hex: '#635BFF' }] } };
  try {
    const ok = await withFetch(() => jsonRes({ id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } }), async calls => {
      const res = await POST(new Request('http://x/api/brand/observe', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
      const j = await res.json();
      const sent = JSON.parse(calls[0].body);
      assert(/api\.anthropic\.com\/v1\/messages/.test(calls[0].url) && calls[0].headers['x-api-key'] === 'sk-ant-test', calls[0].url);
      assert(/server-side-fallback-2026-07-01/.test(calls[0].headers['anthropic-beta']) && sent.fallbacks === 'default', 'fallbacks');
      assert(sent.model === 'claude-opus-5-5' && sent.output_config.format.type === 'json_schema' && sent.thinking.type === 'adaptive', JSON.stringify(sent.output_config));
      const images = sent.messages[0].content.filter(b => b.type === 'image');
      assert(images.length === 2 && images[0].source.media_type === 'image/jpeg', `${images.length} images`);
      assert(res.status === 200 && j.generated === true && j.observations.length === 1 && j.dropped === 1 && j.observations[0].evidence.join() === 'desktop,mobile', JSON.stringify(j));
      return j;
    });
    const refused = await withFetch(() => jsonRes({ id: 'msg_2', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null }, usage: { input_tokens: 1, output_tokens: 0 } }),
      async () => (await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).status);
    assert(refused === 422, `refusal → ${refused}`);
    delete process.env.ANTHROPIC_API_KEY;
    const nokey = await POST(new Request('http://x/', { method: 'POST', body: '{}' }));
    assert(nokey.status === 404 && /ANTHROPIC_API_KEY/.test((await nokey.json()).error), 'no key');
    return `1 kept, 1 uncited dropped; refusal → 422; no key → 404 (${ok.model})`;
  } finally { if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev; }
});

/* ================= Microlink: one live request ================= */
state.tool = 'microlink';
await check('Live Microlink screenshot through /api/brand/shot (spends 1 free-tier request)', async () => {
  const { GET } = await api('brand/shot.js');
  const res = await GET(new Request('http://x/api/brand/shot?url=' + encodeURIComponent('https://example.com/') + '&device=desktop&w=1280&h=800'));
  if (res.status === 429) throw new Error('free quota spent today: ' + (await res.json()).error);
  const buf = Buffer.from(await res.arrayBuffer());
  assert(res.status === 200 && res.headers.get('content-type') === 'image/jpeg', `${res.status} ${buf.toString().slice(0, 120)}`);
  const { w, h } = jpegInfo(buf);
  assert(w === 1280 && h === 800, `${w}×${h}`);
  return `${w}×${h} JPEG, ${(buf.length / 1024).toFixed(0)} KB; quota left ${res.headers.get('x-lathe-quota-remaining') ?? '?'}`;
});

/* ================= Microlink stand-in + preview ================= */
const browser = await chromium.launch({ channel: 'chrome' });
const mlCalls = [];
const ml = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').searchParams;
  mlCalls.push(p.get('url'));
  const mobile = p.get('viewport.isMobile') === 'true';
  const ctx = await browser.newContext({ viewport: { width: Number(p.get('viewport.width')), height: Number(p.get('viewport.height')) }, deviceScaleFactor: Number(p.get('viewport.deviceScaleFactor')), isMobile: mobile, hasTouch: mobile });
  try {
    const pg = await ctx.newPage();
    await pg.goto(p.get('url'), { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    await pg.waitForTimeout(Number(p.get('waitForTimeout') || 0));
    const buf = await pg.screenshot({ type: 'jpeg', quality: 80 });
    res.writeHead(200, { 'content-type': 'image/jpeg', 'x-rate-limit-limit': '999', 'x-rate-limit-remaining': '998' }); res.end(buf);
  } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'fail', message: e.message })); }
  finally { await ctx.close(); }
});
await new Promise(r => ml.listen(ML_PORT, '127.0.0.1', r));
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe',
  env: { ...process.env, MICROLINK_API: `http://127.0.0.1:${ML_PORT}/`, BRANDFETCH_KEY: '', ANTHROPIC_API_KEY: '', MICROLINK_KEY: '' } });
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }

/* The Internet Archive goes down or rate-limits at times. When it does, the checks that need it are
   reported as skipped (WARN), not passed. */
let archiveDown = false;
try { archiveDown = !(await fetch('https://archive.org/wayback/available?url=stripe.com&timestamp=20140701', { signal: AbortSignal.timeout(20000) })).ok; } catch { archiveDown = true; }
const needsArchive = () => { if (archiveDown) throw new Warn('skipped: the Internet Archive is unavailable right now'); };

/* ================= API (live sites) ================= */
state.tool = 'api';
await check('/api/sources: 8 keyless sources available, keyed ones hidden, brand features reported without key values', async () => {
  const j = await (await fetch(BASE + '/api/sources')).json();
  const avail = j.sources.filter(s => s.available).map(s => s.id);
  for (const id of ['met', 'aic', 'archive', 'wikimedia', 'loc', 'openverse', 'cooperhewitt', 'rijks']) assert(avail.includes(id), `${id} missing`);
  for (const id of ['arena', 'smithsonian', 'harvard', 'europeana', 'unsplash']) assert(!avail.includes(id), `${id} available without key`);
  assert(j.brand && j.brand.capture && j.brand.screenshots && !j.brand.brandfetch && !j.brand.observations, JSON.stringify(j.brand));
  return `${avail.length} available; brand ${JSON.stringify(j.brand)}`;
});
await check('Cooper Hewitt and Rijksmuseum (keyless now) return the schema; their images pass the proxy', async () => {
  const out = [];
  for (const id of ['cooperhewitt', 'rijks']) {
    const j = await (await fetch(`${BASE}/api/sources/${id}?q=poster`)).json();
    assert(!j.error && j.results.length, `${id}: ${j.error}`);
    for (const r of j.results) { const b = schemaBad(r); if (b) throw new Error(`${id} ${r.id}: ${b}`); }
    const img = await fetch(`${BASE}/api/img?url=${encodeURIComponent(j.results[0].imageUrl)}`);
    assert(img.ok && /^image\//.test(img.headers.get('content-type')), `${id} image ${img.status}`);
    out.push(`${id} ${j.results.length}/${j.total}`);
  }
  return out.join('; ');
});
let capture;
await check(`Capture ${SITE}: title, ranked CSS colors, typefaces, logos as data URIs, under Vercel's 4.5 MB`, async () => {
  const r = await fetch(`${BASE}/api/brand/capture?q=${SITE}`);
  const text = await r.text(); capture = JSON.parse(text);
  assert(r.ok && !capture.error, capture.error);
  const s = capture.site;
  assert(/Stripe/.test(s.title) && s.via === 'live' && s.colors.length >= 8 && s.stylesheets.some(x => x.ok), s.title);
  const purple = s.colors.find(c => color.deltaE(color.hexOklab(c.hex), color.hexOklab('#635BFF')) < 0.05);
  assert(purple, 'Stripe purple not among the top colors: ' + s.colors.map(c => c.hex).join(' '));
  assert(s.typefaces.some(t => /sohne/i.test(t.family) && t.source === 'self-hosted'), s.typefaces.map(t => t.family).join());
  assert(s.logos.length >= 3 && s.logos.every(l => /^data:image\/[\w.+-]+;base64,/.test(l.dataUri)), 'logos');
  assert(text.length < 4.5 * 1024 * 1024 && /s-maxage=86400/.test(r.headers.get('cache-control')), `${text.length} B`);
  return `${s.colors.length} colors (purple ${purple.hex}), ${s.typefaces.length} typefaces, ${s.logos.length} logos, ${(text.length / 1024).toFixed(0)} KB, ${s.ms} ms`;
});
await check('A company name resolves to its site through Wikidata', async () => {
  const j = await (await fetch(`${BASE}/api/brand/capture?q=Stripe%2C%20Inc.`)).json();
  assert(!j.error && j.domain === 'stripe.com' && /wikidata\.org\/wiki\/Q/.test(j.company?.wikidata), j.error || JSON.stringify(j.company));
  return `“Stripe, Inc.” → ${j.company.name} (${j.company.wikidata.split('/').pop()}) → ${j.domain}`;
});
await check('Capture refuses private and non-web targets (SSRF) with 400', async () => {
  const out = [];
  for (const q of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.1', 'http://[::1]/', 'example.com:8080', 'localtest.me']) {
    const r = await fetch(`${BASE}/api/brand/capture?q=${encodeURIComponent(q)}`);
    assert(r.status === 400 && /no-store/.test(r.headers.get('cache-control')), `${q} → ${r.status}`);
    out.push(q);
  }
  const empty = await fetch(`${BASE}/api/brand/capture`);
  assert(empty.status === 400, 'missing q');
  return `${out.length} refused: ${out.join(', ')}`;
});
await check('Sites that wall off automated requests are read from their latest Wayback capture', async () => {
  needsArchive();
  const j = await (await fetch(`${BASE}/api/brand/capture?q=vitra.com`)).json();
  if (j.error) throw new Error(j.error);
  assert(j.site.via === 'wayback' ? !!j.site.snapshot && /web\.archive\.org/.test(j.site.snapshot.archiveUrl) : j.site.via === 'live', j.site.via);
  return j.site.via === 'wayback' ? `live answered ${j.site.liveStatus ?? j.site.liveError}; read capture ${j.site.snapshot.timestamp} (${j.site.colors.length} colors, ${j.site.logos.length} logos)` : 'live site answered this time';
});
let timeline;
await check(`Wayback timeline for ${SITE}: one capture per year, ascending`, async () => {
  needsArchive();
  let r = await fetch(`${BASE}/api/brand/timeline?domain=${SITE}&snapshots=6&span=20`);
  if (r.status >= 500 || r.status === 429) { await new Promise(res => setTimeout(res, 20000)); r = await fetch(`${BASE}/api/brand/timeline?domain=${SITE}&snapshots=6&span=20`); }
  timeline = await r.json();
  assert(r.ok, timeline.error);
  const ys = timeline.snapshots.map(s => s.year);
  assert(ys.length >= 3 && ys.every((y, i) => !i || y > ys[i - 1]) && timeline.snapshots.every(s => /^https:\/\/web\.archive\.org\/web\/\d{14}if_\//.test(s.renderUrl)), ys.join());
  return `${ys.join(', ')} in ${timeline.ms} ms`;
});
await check('Screenshot endpoint: desktop and mobile sizes, same-origin JPEG, bad URLs refused', async () => {
  const d = await fetch(`${BASE}/api/brand/shot?url=${encodeURIComponent('https://example.com/')}&device=desktop&w=1440&h=900`);
  const m = await fetch(`${BASE}/api/brand/shot?url=${encodeURIComponent('https://example.com/')}&device=mobile&w=390&h=844`);
  const [db, mb] = [Buffer.from(await d.arrayBuffer()), Buffer.from(await m.arrayBuffer())];
  const [di, mi] = [jpegInfo(db), jpegInfo(mb)];
  assert(di.w === 1440 && di.h === 900 && mi.w === 780 && mi.h === 1688, `${di.w}×${di.h}, ${mi.w}×${mi.h}`);
  assert(d.headers.get('x-lathe-quota-remaining') === '998' && /s-maxage=604800/.test(d.headers.get('cache-control')), 'headers');
  for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'nonsense']) assert((await fetch(`${BASE}/api/brand/shot?url=${encodeURIComponent(u)}`)).status === 400, u);
  return `desktop ${di.w}×${di.h}, mobile ${mi.w}×${mi.h} (2×); javascript:, file:, junk → 400`;
});

/* ================= UI ================= */
state.tool = 'ui';
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
state.vp = await ctx.newPage(); await state.vp.goto(BASE + '/');
const { page, errors } = await openPage(ctx, BASE + '/t/audit');
const shotReqs = [];
page.on('request', r => { if (r.url().includes('/api/brand/shot')) shotReqs.push(r.url()); });
await check('Mode switch: Brand audit replaces the subject controls; inspector reports missing keys', async () => {
  await page.click('.inspector .l-chip:text-is("Brand audit")');
  await page.waitForSelector('input[aria-label="Domain or company"]');
  // Fewer timeline snapshots keep the run short: an edited default the tool must honour.
  const row = page.locator('.defaults__row[data-key="timelineSnapshots"] input');
  await row.fill('3'); await row.press('Enter');
  await page.waitForSelector('input[aria-label="Domain or company"]');
  await page.waitForFunction(() => /Needs ANTHROPIC_API_KEY/.test(document.querySelector('.inspector')?.textContent ?? ''));
  const stats = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' | '));
  const obsBtn = await page.locator('.inspector .l-btn:text-is("Write observations")').isVisible();
  assert(/Needs BRANDFETCH_KEY/.test(stats) && /Needs ANTHROPIC_API_KEY/.test(stats) && !obsBtn, stats);
  assert(!(await page.locator('.au-src').count()), 'subject controls still shown');
  return 'brand controls; Brandfetch and observations show their keys; observations button hidden';
});
// The timeline settles either with every year captured (or failed) or with an error note.
const timelineSettled = () => page.waitForFunction(() => {
  const sec = [...document.querySelectorAll('.ab__sec')].find(x => x.querySelector('.ab__h')?.textContent.startsWith('Timeline'));
  if (!sec) return false;
  const figs = [...sec.querySelectorAll('.ab-shot--year')];
  return figs.length ? figs.every(x => x.querySelector('.ab-shot__img, .ab-shot__ph--err')) : !!sec.querySelector('.l-note') && !/Finding/.test(sec.textContent);
}, null, { timeout: 240000 });
await check(`Audit ${SITE}: captures, palette, measured colors vs CSS, typography, logos`, async () => {
  await page.fill('input[aria-label="Domain or company"]', SITE);
  await page.press('input[aria-label="Domain or company"]', 'Enter');
  await page.waitForSelector('.ab__name', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.ab-shot--desktop .ab-shot__img, .ab-shot--mobile .ab-shot__img').length === 2, null, { timeout: 120000 });
  await page.waitForSelector('.ab-cmp__row', { timeout: 60000 });
  await timelineSettled();
  const r = await page.evaluate(() => ({
    name: document.querySelector('.ab__name').textContent,
    css: [...document.querySelectorAll('.ab-pal__sw')].map(s => s.dataset.hex).filter(Boolean),
    cmp: [...document.querySelectorAll('.ab-cmp__row')].map(x => ({ hex: x.dataset.hex, match: x.classList.contains('is-match') })),
    sub: [...document.querySelectorAll('.ab__sub')].map(x => x.textContent),
    type: [...document.querySelectorAll('.ab-type__fam')].map(x => x.textContent),
    logos: document.querySelectorAll('.ab-logo').length, picked: document.querySelectorAll('.ab-logo.is-picked').length,
    years: [...document.querySelectorAll('.ab-shot--year')].map(f => ({ y: f.querySelector('.ab-tl__year').textContent, ok: !!f.querySelector('.ab-shot__img') })),
    deskW: document.querySelector('.ab-shot--desktop .ab-shot__img').naturalWidth,
  }));
  assert(r.name === 'Stripe' && r.css.length >= 8 && r.cmp.length >= 5 && r.cmp.some(c => c.match), JSON.stringify(r).slice(0, 300));
  assert(r.type.some(t => /sohne/i.test(t)) && r.logos >= 3 && r.picked === 3 && r.deskW === 1440, JSON.stringify(r).slice(0, 300));
  await page.screenshot({ path: join(OUT, 'brand-report.png'), fullPage: false });
  return `${r.css.length} CSS colors; ${r.cmp.filter(c => c.match).length}/${r.cmp.length} measured colors declared (${r.sub.find(s => /declared/.test(s))}); typefaces ${r.type.slice(0, 3).join(', ')}; ${r.logos} logos (3 picked)`;
});
let yearsShown = 0;
await check('Timeline in the report: one Wayback screenshot per year (3, from the edited default)', async () => {
  const years = await page.$$eval('.ab-shot--year', fs => fs.map(f => ({ y: f.querySelector('.ab-tl__year').textContent, ok: !!f.querySelector('.ab-shot__img') })));
  yearsShown = years.filter(y => y.ok).length;
  if (!years.length) needsArchive();
  if (!years.length) throw new Error('no timeline: ' + await page.locator('.ab__sec:has(.ab__h:text("Timeline")) .l-note').textContent());
  assert(years.length === 3 && yearsShown >= 2, JSON.stringify(years));
  return years.map(y => y.y + (y.ok ? '' : ' ✗')).join(', ');
});
await check('Measured-vs-declared rows agree with an independent OKLab check', async () => {
  const rows = await page.$$eval('.ab-cmp__row', rs => rs.map(x => ({ hex: x.dataset.hex, match: x.classList.contains('is-match') })));
  const declared = capture.site.declared;
  const wrong = rows.filter(r => {
    const near = Math.min(...declared.map(h => color.deltaE(color.hexOklab(r.hex), color.hexOklab(h))));
    return (near <= 0.05 + 0.003) !== r.match && Math.abs(near - 0.05) > 0.003;
  });
  assert(!wrong.length, JSON.stringify(wrong)); return `${rows.length} rows consistent at ΔE 0.05`;
});
await check('Logo picks toggle; re-running from cache spends no screenshots', async () => {
  const before = await page.locator('.ab-logo.is-picked').count();
  await page.locator('.ab-logo:not(.is-picked)').first().click();
  await page.waitForTimeout(300); // the report repaints on the next frame
  const after = await page.locator('.ab-logo.is-picked').count();
  await page.locator('.ab-logo.is-picked').first().click();
  await page.waitForTimeout(300);
  const n = shotReqs.length;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.ab-shot--desktop .ab-shot__img, .ab-shot--mobile .ab-shot__img').length === 2, null, { timeout: 60000 });
  await timelineSettled();
  await page.waitForTimeout(1500);
  const stats = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' | '));
  assert(after === before + 1 && shotReqs.length === n && /cached/.test(stats), `${before}→${after}, ${shotReqs.length - n} new shot requests, ${stats}`);
  return `picks ${before}→${after}; reload reran from IndexedDB with 0 screenshot requests (mode and query restored)`;
});

/* ---- deck ---- */
state.tool = 'bento';
let thumbs = [];
await check('Build deck in Bento: cover, palette, typography, homepage, identity, timeline, method, credits', async () => {
  await page.click('.inspector .l-btn--primary:has-text("Build deck in Bento")');
  await page.waitForURL('**/t/bento');
  await page.waitForSelector('.bt__thumb');
  thumbs = await page.$$eval('.bt__thumb', ts => ts.map(t => t.getAttribute('aria-label')));
  const texts = [];
  for (let i = 0; i < thumbs.length; i++) { await page.locator('.bt__thumb').nth(i).click(); texts.push(await page.textContent('.bt__svg')); }
  const all = texts.join(' | ');
  for (const t of ['Stripe', 'Brand audit · stripe.com', 'Palette', 'Typography', 'Homepage', 'Identity', 'Method', 'Credits', ...(yearsShown ? ['Timeline'] : [])]) assert(all.includes(t), `missing “${t}”`);
  assert(/Microlink/.test(all) && (!yearsShown || /Wayback Machine/.test(all)), 'credits');
  await page.locator('.bt__thumb').nth(0).click();
  await page.screenshot({ path: join(OUT, 'brand-deck-cover.png') });
  return `${thumbs.length} slides (${yearsShown ? 'with' : 'without'} timeline)`;
});
await check('.pptx: opens in python-pptx; every slide; screenshots embedded; editable text', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn--primary:text-is(".pptx")'), 180000);
  const zip = await JSZip.loadAsync(readFileSync(f));
  const media = Object.keys(zip.files).filter(n => n.startsWith('ppt/media/'));
  const info = JSON.parse(execFileSync(join(HERE, '.venv/bin/python'), [join(HERE, 'pptx_check.py'), f]).toString());
  const pics = info.slides.reduce((a, s) => a + s.pictures, 0), texts = info.slides.flatMap(s => s.texts).join(' ');
  assert(info.slides.length === thumbs.length && pics >= 6 + yearsShown && /Brand audit/.test(texts) && /Method/.test(texts), `${info.slides.length} slides, ${pics} pictures`);
  return `${basename(f)}: ${info.slides.length} slides, ${pics} pictures, ${media.length} media files`;
});
await check('.pdf: every slide; Ghostscript renders; text includes cover, method and credits', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn:text-is(".pdf")'), 180000);
  const buf = readFileSync(f);
  const n = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert(buf.slice(0, 5).toString() === '%PDF-' && n === thumbs.length, `${n} pages`);
  if (!HAS_GS) return `${n} pages`;
  const txt = execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=txtwrite', '-sOutputFile=-', f]).toString();
  const png = join(OUT, 'pdf-p4.png');
  execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-r40', '-dFirstPage=4', '-dLastPage=4', `-sOutputFile=${png}`, f]);
  const st = await imgStats(readFileSync(png), 'image/png');
  assert(/Stripe/.test(txt) && /Method/.test(txt) && /Credits/.test(txt) && st.std > 10, `σ ${st.std}`);
  return `${n} pages; page 4 renders (σ ${st.std.toFixed(0)})`;
});
await check('.png and .svg of the homepage slide embed the screenshots', async () => {
  const idx = thumbs.findIndex(t => /Homepage/.test(t));
  await page.locator('.bt__thumb').nth(idx >= 0 ? idx : 3).click();
  const p = await download(page, () => page.click('.inspector .l-btn:text-is(".png")'), 120000);
  const { w, h } = pngInfo(readFileSync(p));
  const s = await download(page, () => page.click('.inspector .l-btn:text-is(".svg")'), 120000);
  const svg = readFileSync(s, 'utf8');
  const imgs = (svg.match(/<image[^>]+href="data:image\/(jpeg|png)/g) || []).length;
  assert(w === 1920 && h === 1080 && imgs >= 2, `${w}×${h}, ${imgs} embedded images`);
  return `${basename(p)} ${w}×${h}; ${basename(s)} with ${imgs} embedded images`;
});
await check('No console errors across the brand flow', async () => {
  // A Wayback outage shows as the timeline's 5xx; it is reported by the timeline checks above.
  const real = errors.filter(e => !/favicon/.test(e) && !(archiveDown && /api\/brand\/timeline|status of 50[23]/.test(e)));
  assert(!real.length, real.slice(0, 3).join(' | ')); return 'clean';
});

await ctx.close(); await browser.close(); ml.close(); server.kill();
const fails = state.results.filter(r => r.status === 'fail');
console.log(`\n${state.results.length - fails.length}/${state.results.length} passed; ${mlCalls.length} stand-in screenshots`);
process.exit(fails.length ? 1 : 0);
