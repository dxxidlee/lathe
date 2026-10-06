// Milestone 5: Audit (subject mode, no-key sources), palettes, collections, and Bento with every export.
// Runs against the production build with the /api functions (vite preview). Hits the live archive APIs,
// so checks tolerate a source being slow or down, but not a broken schema.
// Usage: npm run verify:audit
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, assert, check, openPage, download, pngInfo, imgStats, HAS_GS, Warn } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'out', 'audit');
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;
const Q = 'poster';
state.out = OUT;

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, ARENA_TOKEN: '', SMITHSONIAN_KEY: '', HARVARD_KEY: '', EUROPEANA_KEY: '', UNSPLASH_KEY: '' } }); // keyless, whatever .env.local holds
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) return proc; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  proc.kill(); throw new Error('vite preview did not start');
}

const SCHEMA = { id: 'string', source: 'string', title: 'string', imageUrl: 'string', thumbUrl: 'string', license: 'string', isPublicDomain: 'boolean', sourceUrl: 'string' };
const NULLABLE = { creator: 'string', date: 'string', year: 'number', width: 'number', height: 'number', type: 'string' };
function checkResult(r) {
  for (const [k, t] of Object.entries(SCHEMA)) if (typeof r[k] !== t || (t === 'string' && !r[k])) return `${k} ${JSON.stringify(r[k])}`;
  for (const [k, t] of Object.entries(NULLABLE)) if (!(k in r) || (r[k] !== null && typeof r[k] !== t)) return `${k} ${JSON.stringify(r[k])}`;
  if (!/^https?:\/\//.test(r.imageUrl) || !/^https?:\/\//.test(r.sourceUrl)) return 'urls';
  if (!r.id.startsWith(r.source + ':')) return 'id prefix';
  return null;
}

// OKLab for verifying color sort/filter independently of the app.
const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map(i => s2l(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nearest = (target, hexes) => Math.min(...hexes.map(h => dist(oklab(target), oklab('#' + h))));

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = await startPreview();
console.log('lathe audit + bento');

/* ================= API ================= */
state.tool = 'api';
let available = [];
await check('/api/sources lists every source; keyless ones available; no key values leak', async () => {
  const r = await fetch(BASE + '/api/sources'); const j = await r.json();
  const ids = j.sources.map(s => s.id);
  available = j.sources.filter(s => s.available).map(s => s.id);
  assert(ids.length === 13, `${ids.length} sources`);
  for (const id of ['met', 'aic', 'archive', 'wikimedia', 'loc', 'openverse']) assert(available.includes(id), `${id} not available`);
  assert(!available.includes('arena') && !available.includes('unsplash'), 'keyed source available without a key');
  assert(!/KEY|TOKEN|secret/i.test(JSON.stringify(j).replace(/needsKey/g, '')), 'key-looking text in response');
  return `${available.length} available: ${available.join(', ')}; ${ids.length - available.length} hidden (keyed)`;
});
const pages = {};
await check(`Every available source returns the normalized schema for "${Q}"`, async () => {
  const out = [];
  await Promise.all(available.map(async id => {
    const r = await fetch(`${BASE}/api/sources/${id}?q=${encodeURIComponent(Q)}`);
    const j = await r.json(); pages[id] = j;
    if (j.error) { out.push(`${id}: ERROR ${j.error}`); return; }
    for (const x of j.results) { const bad = checkResult(x); if (bad) throw new Error(`${id} ${x.id}: ${bad}`); }
    out.push(`${id} ${j.results.length}/${j.total} ${j.ms}ms`);
  }));
  const ok = Object.values(pages).filter(p => !p.error && p.results.length).length;
  assert(ok >= 5, `only ${ok} sources returned results: ${out.join('; ')}`);
  return out.sort().join('; ');
});
await check('Source responses are CDN-cacheable for 24 h; errors are not cached', async () => {
  const ok = await fetch(`${BASE}/api/sources/aic?q=${Q}`);
  const bad = await fetch(`${BASE}/api/sources/aic`);
  assert(/s-maxage=86400/.test(ok.headers.get('cache-control')), ok.headers.get('cache-control'));
  assert(bad.status === 400 && /no-store/.test(bad.headers.get('cache-control')), `${bad.status} ${bad.headers.get('cache-control')}`);
  const unk = await fetch(`${BASE}/api/sources/nope?q=x`); const kd = await fetch(`${BASE}/api/sources/unsplash?q=x`);
  assert(unk.status === 404 && kd.status === 404, `${unk.status} ${kd.status}`);
  return 'ok: s-maxage=86400; 400 missing q; 404 unknown and keyless-locked';
});
await check('/api/img proxies allowlisted images and refuses everything else', async () => {
  const thumb = pages.aic?.results?.[0]?.thumbUrl;
  const ok = await fetch(`${BASE}/api/img?url=${encodeURIComponent(thumb)}`);
  const buf = Buffer.from(await ok.arrayBuffer());
  assert(ok.status === 200 && /^image\//.test(ok.headers.get('content-type')) && buf.length > 1000, `${ok.status} ${ok.headers.get('content-type')}`);
  const cases = { 'http://169.254.169.254/latest/meta-data': 403, 'https://evil.example.com/a.png': 403, 'file:///etc/passwd': 403, 'https://www.artic.edu/': 415, 'nonsense': 400 };
  for (const [u, code] of Object.entries(cases)) {
    const r = await fetch(`${BASE}/api/img?url=${encodeURIComponent(u)}`);
    assert(r.status === code, `${u} → ${r.status}, expected ${code}`);
  }
  return `image ${buf.length} B; metadata IP, foreign host, file:, HTML page and junk refused`;
});

/* ================= UI ================= */
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
state.vp = await ctx.newPage(); await state.vp.goto(BASE + '/');
const { page, errors } = await openPage(ctx, BASE + '/t/audit');
state.tool = 'audit';
const apiCalls = [];
page.on('request', r => { if (r.url().includes('/api/sources/')) apiCalls.push(r.url()); });
const cardsData = () => page.$$eval('.au__grid .au-card', cs => cs.map(c => ({
  id: c.dataset.id, pd: !!c.querySelector('.au-card__pd'), hex: [...c.querySelectorAll('.au-sw__hex')].map(h => h.textContent),
  w: c.querySelector('img').naturalWidth, h: c.querySelector('img').naturalHeight, selected: c.classList.contains('is-selected'),
})));

await page.waitForSelector('.au__q');
await check('Search streams results from every source with per-source counts', async () => {
  await page.fill('.au__q', Q); await page.press('.au__q', 'Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.au-src__meta')].every(m => m.dataset.state === 'done' || m.dataset.state === 'error'), null, { timeout: 90000 });
  const rows = await page.$$eval('.au-src__row', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  const n = await page.locator('.au__grid .au-card').count();
  assert(n >= 40, `${n} cards`);
  await page.screenshot({ path: join(OUT, 'audit-results.png') });
  return `${n} cards; ${rows.join(' | ')}`;
});
await check('Every result gets a 5–8 swatch OKLab palette with hex codes', async () => {
  await page.waitForFunction(() => { const c = [...document.querySelectorAll('.au__grid .au-card')]; return c.filter(x => x.querySelector('.au-sw__hex')).length >= Math.min(30, c.length * 0.7); }, null, { timeout: 90000 });
  const data = await cardsData();
  const withPal = data.filter(c => c.hex.length);
  const bad = withPal.filter(c => c.hex.length < 5 || c.hex.length > 8 || !c.hex.every(h => /^[0-9A-F]{6}$/.test(h)));
  assert(!bad.length, `bad palettes ${JSON.stringify(bad[0])}`);
  const sizes = withPal.map(c => c.hex.length);
  return `${withPal.length}/${data.length} palettes; swatches per image ${Math.min(...sizes)}–${Math.max(...sizes)}`;
});
await check('Repeat search is served from the 24 h IndexedDB cache', async () => {
  apiCalls.length = 0;
  await page.press('.au__q', 'Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.au-src__meta')].every(m => m.dataset.state !== 'loading'), null, { timeout: 30000 });
  const metas = await page.$$eval('.au-src__meta', ms => ms.map(m => m.textContent));
  // Failed sources are not cached (by design), so they are retried; only successful ones must be cached.
  const down = Object.entries(pages).filter(([, p]) => p.error).map(([id]) => id);
  const uncached = apiCalls.filter(u => !down.some(id => u.includes(`/api/sources/${id}?`)));
  assert(!uncached.length, `${uncached.length} network calls`);
  assert(metas.filter(m => /cached/.test(m)).length >= 5, metas.join(' | '));
  return `0 network calls; ${metas.filter(m => /cached/.test(m)).length} sources cached`;
});
await check('Filter: public domain only', async () => {
  await page.click('.inspector .l-chip:has-text("Public domain only")');
  const data = await cardsData();
  await page.click('.inspector .l-chip:has-text("All")');
  assert(data.length && data.every(c => c.pd), `${data.filter(c => !c.pd).length} non-PD shown`); return `${data.length} shown, all PD`;
});
await check('Filter: orientation (landscape)', async () => {
  await page.click('.inspector .l-chip:has-text("Landscape")');
  await page.waitForTimeout(300);
  const data = await cardsData();
  await page.click('.inspector .l-chip:text-is("Any")');
  const wrong = data.filter(c => c.w && c.h && c.w / c.h <= 1.05);
  assert(data.length && !wrong.length, `${wrong.length} not landscape of ${data.length}`); return `${data.length} shown, all landscape`;
});
await check('Filter: year range', async () => {
  const before = await page.locator('.au__grid .au-card').count();
  await page.fill('input[aria-label="From year"], .inspector .au-years input >> nth=0', '1900'); await page.keyboard.press('Tab');
  await page.fill('.inspector .au-years input >> nth=1', '1950'); await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  const after = await page.locator('.au__grid .au-card').count();
  await page.fill('.inspector .au-years input >> nth=0', ''); await page.keyboard.press('Tab');
  await page.fill('.inspector .au-years input >> nth=1', ''); await page.keyboard.press('Tab');
  assert(after > 0 && after < before, `${before} → ${after}`); return `${before} → ${after} for 1900–1950`;
});
await check('Filter: turning a source off hides its results', async () => {
  const before = await page.locator('.au__grid .au-card').count();
  const aicRow = page.locator('.au-src__row', { hasText: 'Art Institute of Chicago' });
  await aicRow.locator('input').uncheck();
  const ids = (await cardsData()).map(c => c.id);
  await aicRow.locator('input').check();
  assert(!ids.some(i => i.startsWith('aic:')) && ids.length < before, `${before} → ${ids.length}`); return `${before} → ${ids.length}, no AIC`;
});
await check('Filter: type chips', async () => {
  const chip = page.locator('.inspector .l-group:has(.l-label:text-is("Type")) .l-chip').first();
  const label = await chip.textContent(); await chip.click();
  const n = await page.locator('.au__grid .au-card').count(); await chip.click();
  assert(n > 0, 'none'); return `"${label}": ${n} shown`;
});
await check('Color: sort by closeness to #E8FF1A orders results by OKLab distance', async () => {
  await page.fill('.au-hex', '#E8FF1A'); await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  const data = (await cardsData()).filter(c => c.hex.length);
  const ds = data.map(c => nearest('#E8FF1A', c.hex));
  // Hex text is rounded to 8 bits; the app sorts on exact OKLab centroids, so allow rounding error.
  const sorted = ds.every((v, i) => i === 0 || v >= ds[i - 1] - 0.006);
  assert(sorted, `not sorted: ${ds.slice(0, 6).map(v => v.toFixed(3))}`);
  return `nearest ${ds[0].toFixed(3)}, farthest ${ds[ds.length - 1].toFixed(3)}`;
});
await check('Color: filter keeps only results within the match distance', async () => {
  await page.click('.inspector .l-chip:has-text("Filter")');
  await page.locator('.inspector .l-slider:has-text("Match distance") input').evaluate(el => { el.value = 25; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(300);
  const data = await cardsData();
  const far = data.filter(c => !c.hex.length || nearest('#E8FF1A', c.hex) > 0.25 + 0.003);
  await page.click('.inspector .l-chip:has-text("Sort by closeness")');
  await page.click('.inspector .l-btn:text-is("Clear") >> nth=0');
  assert(!far.length, `${far.length} outside 0.25`); return `${data.length} within ΔE 0.25`;
});
let picked = [];
await check('Collect results; the collection palette aggregates them; persists across reload', async () => {
  const picks = page.locator('.au__grid .au-card .au-card__pick');
  for (let i = 0; i < 6; i++) await picks.nth(i).click();
  picked = (await cardsData()).filter(c => c.selected).map(c => c.id);
  const agg = await page.$$eval('.au-agg__hex', hs => hs.map(h => h.textContent));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' }); // Audit re-runs the saved search, so the network never idles
  await page.waitForSelector('.au-agg__hex');
  const stats = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' '));
  assert(picked.length === 6 && agg.length >= 3 && /Images6/.test(stats), `${picked.length} picked, ${agg.length} agg, ${stats}`);
  return `6 images; collection palette ${agg.join(' ')}`;
});
await check('Collections: create a second one and switch back', async () => {
  await page.click('.inspector .l-btn:text-is("New")');
  const empty = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' '));
  await page.locator('.inspector select').first().selectOption({ index: 0 });
  const back = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' '));
  assert(/Images0/.test(empty) && /Images6/.test(back), `${empty} | ${back}`); return '2 collections, switching keeps contents';
});

/* ================= Bento ================= */
state.tool = 'bento';
await check('Build deck in Bento: cover, palette, imagery, auto credits', async () => {
  await page.click('.inspector .l-btn--primary:has-text("Build deck in Bento")');
  await page.waitForURL('**/t/bento');
  await page.waitForSelector('.bt__thumb');
  const thumbs = await page.$$eval('.bt__thumb', ts => ts.map(t => t.getAttribute('aria-label')));
  const cover = await page.textContent('.bt__svg');
  assert(thumbs.length === 5 && /Credits/.test(thumbs[4]) && new RegExp(Q, 'i').test(cover), thumbs.join(','));
  await page.screenshot({ path: join(OUT, 'bento-cover.png') });
  return thumbs.join(', ');
});
const rects = () => page.$$eval('.bt__tile', ts => ts.map(t => `${t.dataset.id}@${t.style.left},${t.style.top},${t.style.width},${t.style.height}`));
await page.locator('.bt__thumb').nth(2).click();
await check('Reshuffle picks an alternate layout', async () => {
  const a = await rects(); await page.click('.inspector .l-btn:has-text("Reshuffle")'); const b = await rects();
  assert(a.join() !== b.join(), 'unchanged'); return `${a.length} tiles moved`;
});
await check('Lock keeps a tile in place through reshuffles', async () => {
  const first = page.locator('.bt__tile').first();
  const id = await first.getAttribute('data-id');
  await first.click(); await page.click('.inspector .l-btn:text-is("Lock")');
  const pos = r => r.find(x => x.startsWith(id));
  const a = pos(await rects());
  for (let i = 0; i < 3; i++) await page.click('.inspector .l-btn:has-text("Reshuffle")');
  const b = pos(await rects());
  await page.locator(`.bt__tile[data-id="${id}"]`).click(); await page.click('.inspector .l-btn:text-is("Unlock")');
  assert(a === b, `${a} → ${b}`); return 'locked tile held its cell';
});
await check('Drag a tile onto another to swap them', async () => {
  const ts = page.locator('.bt__tile');
  const [ida, idb] = [await ts.nth(0).getAttribute('data-id'), await ts.nth(1).getAttribute('data-id')];
  const before = await rects();
  const A = await ts.nth(0).boundingBox(), B = await ts.nth(1).boundingBox();
  await page.mouse.move(A.x + A.width / 2, A.y + A.height / 2); await page.mouse.down();
  await page.mouse.move(A.x + A.width / 2 + 20, A.y + A.height / 2 + 5, { steps: 3 });
  await page.mouse.move(B.x + B.width / 2, B.y + B.height / 2, { steps: 6 }); await page.mouse.up();
  const after = await rects();
  const geo = (list, id) => list.find(x => x.startsWith(id)).split('@')[1];
  assert(geo(after, ida) === geo(before, idb) && geo(after, idb) === geo(before, ida), 'not swapped'); return 'swapped';
});
await check('Resize a tile by dragging its corner (snaps to the 12 × 8 grid)', async () => {
  await page.click('.inspector .l-btn:has-text("Add slide")');
  await page.click('.inspector .l-btn:text-is("Text")');
  const before = await page.inputValue('input[aria-label="Span w"]');
  const h = await page.locator('.bt__handle').boundingBox(); const s = await page.locator('.bt__slide').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(s.x + s.width * 0.5, s.y + s.height * 0.5, { steps: 8 }); await page.mouse.up();
  const w = await page.inputValue('input[aria-label="Span w"]'), hh = await page.inputValue('input[aria-label="Span h"]');
  assert(w !== before && Number(w) >= 1 && Number(w) <= 12 && Number(hh) >= 1, `${before} → ${w}×${hh}`); return `w ${before} → ${w}, h ${hh}`;
});
await check('Keyboard: arrows move, Shift+arrows resize, Delete removes', async () => {
  await page.locator('.bt__tile').first().click();
  const x0 = Number(await page.inputValue('input[aria-label="Span x"]')), w0 = Number(await page.inputValue('input[aria-label="Span w"]'));
  await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('ArrowRight');
  const x1 = Number(await page.inputValue('input[aria-label="Span x"]')), w1 = Number(await page.inputValue('input[aria-label="Span w"]'));
  await page.keyboard.press('Delete');
  const n = await page.locator('.bt__tile').count();
  await page.click('.inspector .l-btn:text-is("Delete")');
  assert(w1 === w0 - 1 && x1 === x0 + 1 && n === 0, `x ${x0}→${x1}, w ${w0}→${w1}, tiles ${n}`); return 'ok';
});
await check('Add tiles: title, stat, palette, hex list, type specimen', async () => {
  await page.click('.inspector .l-btn:has-text("Add slide")');
  for (const t of ['Title', 'Stat', 'Palette', 'Hex list', 'Type']) await page.click(`.inspector .l-btn:text-is("${t}")`);
  const n = await page.locator('.bt__tile').count();
  const txt = await page.textContent('.bt__svg');
  await page.click('.inspector .l-btn:text-is("Delete")');
  assert(n === 5 && /E8FF1A/.test(txt) && /Aa/.test(txt), `${n} tiles`); return '5 tiles laid out';
});
await page.locator('.bt__thumb').nth(0).click();

/* ---- exports ---- */
await check('.pptx: opens in python-pptx; 5 slides; editable text; cropped images; Helvetica Neue with Arial fallback declared', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn--primary:text-is(".pptx")'), 120000);
  const zip = await JSZip.loadAsync(readFileSync(f));
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const n of slides) {
    const p = join(OUT, basename(n)); writeFileSync(p, await zip.file(n).async('string'));
    execFileSync('xmllint', ['--noout', p]);
  }
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert(/<a:latin typeface="Helvetica Neue[^"]*"[^>]*panose="020B0604020202020204"/.test(xml), 'no Arial panose fallback on Helvetica Neue');
  const media = Object.keys(zip.files).filter(n => n.startsWith('ppt/media/'));
  const info = JSON.parse(execFileSync(join(HERE, '.venv/bin/python'), [join(HERE, 'pptx_check.py'), f]).toString());
  const pics = info.slides.reduce((a, s) => a + s.pictures, 0), texts = info.slides.reduce((a, s) => a + s.text_boxes, 0), cropped = info.slides.reduce((a, s) => a + s.cropped, 0);
  assert(info.slides.length === 5 && Math.abs(info.slide_w_in - 13.333) < 0.01, `${info.slides.length} slides ${info.slide_w_in}`);
  assert(pics >= 6 && texts >= 8 && cropped >= 1, `pictures ${pics}, text boxes ${texts}, cropped ${cropped}`);
  assert(info.slides[0].texts.some(t => new RegExp(Q, 'i').test(t)) && info.slides[4].texts.some(t => /Credits/.test(t)), 'cover/credits text');
  assert(info.slides.flatMap(s => s.fonts).every(fn => /^Helvetica Neue/.test(fn)), info.slides.flatMap(s => s.fonts).join(','));
  return `${basename(f)}: ${info.slides.length} slides ${info.slide_w_in}×${info.slide_h_in} in, ${pics} pictures (${cropped} natively cropped), ${texts} editable text boxes, ${media.length} media; XML valid`;
});
await check('.pdf: 5 pages; Ghostscript renders; text extractable', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn:text-is(".pdf")'), 120000);
  const buf = readFileSync(f);
  assert(buf.slice(0, 5).toString() === '%PDF-', 'not a PDF');
  const pagesN = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert(pagesN === 5, `${pagesN} pages`);
  if (!HAS_GS) return `${pagesN} pages (Ghostscript missing: not rendered)`;
  const png = join(OUT, 'pdf-p1.png');
  execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-r40', '-dFirstPage=1', '-dLastPage=1', `-sOutputFile=${png}`, f]);
  const st = await imgStats(readFileSync(png), 'image/png');
  const txt = execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=txtwrite', '-sOutputFile=-', f]).toString();
  assert(st.std > 10 && new RegExp(Q, 'i').test(txt) && /Credits/.test(txt), `σ ${st.std}, text ok ${/Credits/.test(txt)}`);
  return `${basename(f)}: ${pagesN} pages, page 1 renders (σ ${st.std.toFixed(0)}), text includes cover and credits`;
});
await check('.png: current slide at 1920×1080', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn:text-is(".png")'), 120000);
  const buf = readFileSync(f); const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
  assert(w === 1920 && h === 1080 && st.std > 10, `${w}×${h} σ ${st.std}`); return `${basename(f)} ${w}×${h}`;
});
await check('.png all: one PNG per slide, zipped', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn:text-is(".png all")'), 180000);
  const zip = await JSZip.loadAsync(readFileSync(f));
  const pngs = Object.keys(zip.files).filter(n => n.endsWith('.png'));
  for (const n of pngs) { const { w, h } = pngInfo(await zip.file(n).async('nodebuffer')); assert(w === 1920 && h === 1080, `${n} ${w}×${h}`); }
  assert(pngs.length === 5, `${pngs.length}`); return `${pngs.length} slides`;
});
let svgText = '';
await check('.svg: valid, embeds its images, renders', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn:text-is(".svg")'), 120000);
  svgText = readText(f);
  const p = join(OUT, 'slide.svg'); writeFileSync(p, svgText); execFileSync('xmllint', ['--noout', p]);
  const imgs = (svgText.match(/<image [^>]*href="data:image\/(png|jpeg)/g) || []).length;
  const st = await imgStats(Buffer.from(svgText), 'image/svg+xml');
  assert(imgs >= 1 && !/href="https?:/.test(svgText) && st.std > 10 && /Helvetica Neue/.test(svgText), `${imgs} embedded`);
  return `${basename(f)}: ${imgs} embedded images, ${(svgText.length / 1024).toFixed(0)} KB, renders ${st.w}×${st.h}`;
});
function readText(f) { return readFileSync(f, 'utf8'); }
await check('Copy for Figma puts the slide SVG on the clipboard', async () => {
  await page.click('.inspector .l-btn:text-is("Copy for Figma")');
  await page.waitForFunction(() => /Copied for Figma/.test(document.querySelector('.inspector [role=status]').textContent));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('<svg') && clip.length === svgText.length, `${clip.slice(0, 20)} ${clip.length} vs ${svgText.length}`);
  return `${(clip.length / 1024).toFixed(0)} KB of SVG`;
});
await check('Light theme switches the deck background', async () => {
  await page.click('.inspector .l-chip:text-is("Light")');
  const bg = await page.$eval('.bt__svg svg > rect', r => r.getAttribute('fill'));
  await page.click('.inspector .l-chip:text-is("Dark")');
  assert(bg === '#FFFFFF', bg); return 'white background';
});
await check('Deck persists across reload', async () => {
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.bt__thumb');
  const n = await page.locator('.bt__thumb').count(); assert(n === 5, `${n}`); return `${n} slides`;
});
await check('Exports landed in the tray', async () => {
  const n = Number(await page.textContent('[data-testid="tray-count"]')); assert(n >= 6, `${n}`); return `${n} items`;
});
await check('No console errors across the run', () => {
  // A source that is down upstream answers 502, which the inspector shows; that is not an app error.
  const down = Object.entries(pages).filter(([, p]) => p.error).map(([id]) => id);
  const real = errors.filter(e => !down.some(id => e.includes(`/api/sources/${id}?`)) && !(down.length && /status of 502/.test(e)));
  assert(!real.length, real.join(' | '));
  if (real.length !== errors.length) throw new Warn(`clean apart from 502s from sources down upstream: ${down.join(', ')}`);
  return 'clean';
});

await browser.close(); server.kill();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(state.results, null, 2));
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
