// Milestone 8: Grid, Specimen, Kinetic-type, Icon-set, against the production build (vite preview).
// Outputs are checked independently: grid geometry recomputed here and the CSS laid out by Chrome;
// a test font generated with known metrics; every icon decoded and the .ico parsed byte by byte;
// GIF frames counted from the file; WebM read with ffprobe.
// Usage: npm run verify:m8
import { chromium } from 'playwright';
import JSZip from 'jszip';
import opentype from 'opentype.js';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, assert, check, openPage, download, pngInfo, imgStats, ffprobe, HAS_GS } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'out', 'm8');
const FX = join(HERE, 'fixtures');
const PORT = 4326;
const BASE = `http://127.0.0.1:${PORT}`;
state.out = OUT;
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
state.vp = await ctx.newPage(); await state.vp.goto(BASE + '/');
console.log('lathe grid, specimen, kinetic-type, icon-set (milestone 8)');

/* ---------------- helpers ---------------- */
async function dropBytes(page, name, type, buf) {
  await page.evaluate(({ name, type, b64 }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type }));
    const el = document.querySelector('.stage');
    for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, type, b64: buf.toString('base64') });
}
const drop = (page, file, type) => dropBytes(page, file, type, readFileSync(join(FX, file)));
const setSlider = (page, label, v) => page.locator(`.inspector .l-slider:has(.l-slider__label:text-is("${label}")) input`).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const clickChip = (page, text, scope = '.inspector') => page.locator(`${scope} .l-chip`, { hasText: new RegExp(`^${text.replace(/[.+()-]/g, '\\$&')}$`) }).first().click();
const btn = label => `.inspector .l-btn:text-is("${label}")`;
const statusState = page => page.textContent('.statusbar__state');
/** Decode an image in Chrome: size and the RGBA of some sample points. */
const pixels = (buf, type, pts) => state.vp.evaluate(async ({ b64, type, pts }) => {
  const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type }));
  const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, at: pts.map(([px, py]) => [...x.getImageData(Math.floor(px * bmp.width), Math.floor(py * bmp.height), 1, 1).data]) };
}, { b64: buf.toString('base64'), type, pts });

const { page, errors } = await openPage(ctx, BASE + '/t/grid');

/* ================= Grid ================= */
state.tool = 'grid';
const svgOut = async () => readFileSync(await download(page, () => page.click(btn('SVG overlay'))), 'utf8');
await check('Desktop 1440: 12 columns, 24 gutter, 80 margins; column width and positions match an independent computation', async () => {
  const svg = await svgOut();
  execFileSync('xmllint', ['--noout', '-'], { input: svg });
  const cols = [...svg.matchAll(/<g id="columns"[^>]*>(.*?)<\/g>/g)][0][1].match(/<rect [^>]+>/g).map(r => ({ x: +/x="([\d.]+)"/.exec(r)[1], w: +/width="([\d.]+)"/.exec(r)[1] }));
  const colW = (1440 - 160 - 11 * 24) / 12;
  const off = cols.filter((c, i) => Math.abs(c.w - colW) > 0.01 || Math.abs(c.x - (80 + i * (colW + 24))) > 0.01);
  const lines = (svg.match(/<line /g) || []).length;
  assert(/width="1440px" height="1024px"/.test(svg) && cols.length === 12 && !off.length && lines === Math.floor((1024 - 160) / 8) + 1, `${cols.length} cols, ${off.length} off, ${lines} baselines`);
  return `column ${colW.toFixed(2)} px, 12 columns placed exactly, ${lines} baselines`;
});
await check('CSS snippet lays out in Chrome to the same columns', async () => {
  const css = readFileSync(await download(page, () => page.click(btn('CSS'))), 'utf8');
  const widths = await state.vp.evaluate(css => {
    const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    const g = document.createElement('div'); g.className = 'grid'; for (let i = 0; i < 12; i++) g.append(document.createElement('div'));
    document.body.append(g); const w = [...g.children].map(c => c.getBoundingClientRect().width); const x0 = g.children[0].getBoundingClientRect().left - g.getBoundingClientRect().left;
    g.remove(); st.remove(); return { w, x0 };
  }, css);
  const colW = (1440 - 160 - 11 * 24) / 12;
  assert(widths.w.length === 12 && widths.w.every(w => Math.abs(w - colW) < 0.6) && Math.abs(widths.x0 - 80) < 0.6, JSON.stringify(widths));
  return `12 × ${widths.w[0].toFixed(2)} px from x = ${widths.x0}`;
});
await check('A4 (ISO 216) in mm: 210 × 297 mm SVG; PNG at 300 dpi is 2480 × 3508', async () => {
  await page.locator('.inspector select').first().selectOption('a4');
  const svg = await svgOut();
  const png = readFileSync(await download(page, () => page.click(btn('PNG'))));
  const { w, h } = pngInfo(png);
  assert(/width="210mm" height="297mm"/.test(svg) && w === 2480 && h === 3508, `${w}×${h}`);
  return `SVG 210mm × 297mm; PNG ${w}×${h}`;
});
await check('Rows snap to the baseline; swapping orientation swaps the page', async () => {
  await page.locator('.inspector select').first().selectOption('slide');
  const svg = await svgOut();
  const rows = [...svg.matchAll(/<g id="rows"[^>]*>(.*?)<\/g>/g)][0][1].match(/height="([\d.]+)"/g).map(x => +/[\d.]+/.exec(x)[0]);
  await page.click(btn('Swap orientation'));
  const swapped = await svgOut();
  assert(rows.length === 8 && rows.every(h => h % 8 === 0) && /viewBox="0 0 1080 1920"/.test(swapped), `${rows}`);
  return `8 rows of ${rows[0]} px (a multiple of the 8 px baseline); 1920×1080 → 1080×1920`;
});
await check('Custom columns, gutter and margins', async () => {
  await page.locator('.inspector select').first().selectOption('desktop');
  await setSlider(page, 'Columns', 6);
  await page.fill('.inspector input[data-key="gutter"]', '40'); await page.press('.inspector input[data-key="gutter"]', 'Enter');
  await page.fill('.inspector input[data-key="mt"]', '100'); await page.press('.inspector input[data-key="mt"]', 'Enter');
  const svg = await svgOut();
  const cols = svg.match(/<g id="columns"[^>]*>(.*?)<\/g>/)[1].match(/width="([\d.]+)"/g).map(x => +/[\d.]+/.exec(x)[0]);
  const colW = (1440 - 200 - 5 * 40) / 6;
  assert(cols.length === 6 && cols.every(w => Math.abs(w - colW) < 0.01), `${cols}`);
  return `6 × ${colW.toFixed(2)} px with 40 px gutters and 100 px margins`;
});

/* ================= Icon-set ================= */
state.tool = 'icon-set';
await page.goto(BASE + '/t/icon-set', { waitUntil: 'networkidle' });
let zipFiles;
await check('SVG mark → icon set: every PNG size exact, Apple and maskable icons opaque on the background', async () => {
  await drop(page, 'logo.svg', 'image/svg+xml');
  await page.waitForFunction(() => /files ready/.test(document.querySelector('.statusbar__state')?.textContent ?? ''));
  const f = await download(page, () => page.click(btn('Export icon set (.zip)')));
  const zip = await JSZip.loadAsync(readFileSync(f));
  zipFiles = Object.keys(zip.files);
  const bad = [];
  for (const n of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) {
    const b = Buffer.from(await zip.file(`icon-${n}.png`).async('uint8array'));
    const { w, h } = pngInfo(b); if (w !== n || h !== n) bad.push(`icon-${n} is ${w}×${h}`);
  }
  const apple = await pixels(Buffer.from(await zip.file('apple-touch-icon.png').async('uint8array')), 'image/png', [[0.01, 0.01]]);
  const mask = await pixels(Buffer.from(await zip.file('icon-maskable-512.png').async('uint8array')), 'image/png', [[0.02, 0.02], [0.5, 0.08], [0.5, 0.5]]);
  assert(!bad.length && apple.w === 180 && apple.at[0].join() === '255,255,255,255' && mask.at[0][3] === 255 && mask.at[1].slice(0, 3).join() === '255,255,255', bad.join('; ') + JSON.stringify([apple.at, mask.at]));
  return `${zipFiles.length} files: ${zipFiles.join(', ')}`;
});
await check('favicon.ico parses: 3 PNG entries (16, 32, 48) with matching sizes and offsets', async () => {
  const f = join(OUT, 'icon-set'); const zip = await JSZip.loadAsync(readFileSync((await import('node:fs')).readdirSync(f).map(x => join(f, x)).find(x => x.endsWith('.zip'))));
  const ico = Buffer.from(await zip.file('favicon.ico').async('uint8array'));
  assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'header');
  const n = ico.readUInt16LE(4), out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16, w = ico[o] || 256, size = ico.readUInt32LE(o + 8), off = ico.readUInt32LE(o + 12);
    const png = ico.subarray(off, off + size); const p = pngInfo(png);
    assert(p.w === w && p.h === w && ico.readUInt16LE(o + 6) === 32, `entry ${i}: ${p.w} vs ${w}`);
    out.push(w);
  }
  assert(out.join() === '16,32,48', out.join());
  const manifest = JSON.parse(await zip.file('manifest.webmanifest').async('string'));
  const html = await zip.file('icons.html').async('string');
  const svg = await zip.file('favicon.svg').async('string');
  assert(manifest.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512') && manifest.icons.some(i => i.sizes === '192x192') && /rel="apple-touch-icon"/.test(html) && /rel="manifest"/.test(html) && svg === readFileSync(join(FX, 'logo.svg'), 'utf8'), 'manifest/html/svg');
  return `ICO ${out.join(', ')}; manifest with maskable 512; favicon.svg identical to the source; HTML snippet links all`;
});
await check('Maskable icon keeps the mark inside the 40% safe circle', async () => {
  const f = join(OUT, 'icon-set'); const zip = await JSZip.loadAsync(readFileSync((await import('node:fs')).readdirSync(f).map(x => join(f, x)).find(x => x.endsWith('.zip'))));
  const b = Buffer.from(await zip.file('icon-maskable-512.png').async('uint8array'));
  const outside = await state.vp.evaluate(async b64 => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(512, 512); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, 512, 512).data; let n = 0;
    for (let yy = 0; yy < 512; yy++) for (let xx = 0; xx < 512; xx++) { if (Math.hypot(xx - 256, yy - 256) <= 0.4 * 512) continue; const i = (yy * 512 + xx) * 4; if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) n++; }
    return n;
  }, b.toString('base64'));
  assert(outside === 0, `${outside} non-background pixels outside the safe circle`);
  return 'no mark pixels outside the safe circle';
});
await check('A PNG logo works too (no favicon.svg); padding shrinks the mark', async () => {
  await drop(page, 'logo.png', 'image/png');
  await page.waitForFunction(() => /logo\.png/.test(document.querySelector('.statusbar')?.textContent ?? '') && /files ready/.test(document.querySelector('.statusbar__state')?.textContent ?? ''));
  await setSlider(page, 'Padding', 20);
  await page.waitForTimeout(500);
  const zip = await JSZip.loadAsync(readFileSync(await download(page, () => page.click(btn('Export icon set (.zip)')))));
  const b = Buffer.from(await zip.file('icon-512.png').async('uint8array'));
  const st = await pixels(b, 'image/png', [[0.5, 0.15], [0.5, 0.5]]);
  assert(!zip.file('favicon.svg') && st.at[0][3] === 0, JSON.stringify(st.at));
  return 'no favicon.svg for a raster source; with 20% padding the top band is empty';
});

/* ================= Specimen ================= */
state.tool = 'specimen';
await page.goto(BASE + '/t/specimen', { waitUntil: 'networkidle' });
// A test font with known metrics: 1000 UPM, ascender 800, descender −200, x-height 500, cap height 700.
const box = (n, w, h) => { const p = new opentype.Path(); p.moveTo(50, 0); p.lineTo(50, h); p.lineTo(w - 50, h); p.lineTo(w - 50, 0); p.close(); return new opentype.Glyph({ name: n, unicode: n.length === 1 ? n.charCodeAt(0) : undefined, advanceWidth: w, path: p }); };
const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() }), box('H', 700, 700), box('x', 550, 500), box('a', 560, 500), box('space', 250, 0)];
glyphs[4].unicode = 32; glyphs[4].unicodes = [32];
const testFont = new opentype.Font({ familyName: 'Lathe Test', styleName: 'Medium', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
testFont.tables.os2 = { ...(testFont.tables.os2 || {}), sxHeight: 500, sCapHeight: 700 };
const otf = Buffer.from(testFont.toArrayBuffer());
writeFileSync(join(OUT, 'LatheTest.otf'), otf);
await check('Generated OTF: family, style, glyph count and vertical metrics read exactly', async () => {
  await dropBytes(page, 'LatheTest.otf', 'font/otf', otf);
  await page.waitForFunction(() => /Lathe Test/.test(document.querySelector('.statusbar__state')?.textContent ?? ''));
  const stats = await page.$$eval('.sp-ov__stats .l-stat', r => Object.fromEntries(r.map(x => [x.querySelector('.l-stat__label').textContent, x.querySelector('.l-stat__value').textContent])));
  const name = await page.textContent('.sp-ov__name');
  assert(name === 'Lathe Test' && stats.Ascender === '800' && stats.Descender === '-200' && stats['x-height'] === '500' && stats['Cap height'] === '700' && stats['Units per em'] === '1000', JSON.stringify(stats));
  return `${name}: ${JSON.stringify(stats)}`;
});
await check('Inter WOFF2: unpacked and parsed; glyph grid; features listed', async () => {
  await drop(page, 'inter-latin.woff2', 'font/woff2');
  await page.waitForFunction(() => /Inter/.test(document.querySelector('.statusbar__state')?.textContent ?? ''));
  const st = await statusState(page);
  await clickChip(page, 'Glyphs', '.sp__tabs');
  const cells = await page.locator('.sp-glyph').count();
  await page.locator('.sp-glyph').nth(40).click();
  const g = await page.$$eval('.inspector .l-stats', s => s.map(x => x.textContent).join(' '));
  const n = Number(/(\d+) glyphs/.exec(st)[1]);
  assert(cells === Math.min(n, 1200) && /Unicode/.test(g) && /\d+ features/.test(st), `${cells} cells, ${st}`);
  return `${st}; ${cells} glyph cells; glyph details on click`;
});
await check('Features: each shown off and on; toggling tnum applies it to live text', async () => {
  await clickChip(page, 'Features', '.sp__tabs');
  const rows = await page.$$eval('.sp-ft__row', r => r.map(x => x.dataset.tag));
  const offOn = await page.$eval('.sp-ft__row[data-tag="frac"]', r => [...r.querySelectorAll('.sp-ft__sample')].map(s => s.style.fontFeatureSettings));
  await clickChip(page, 'tnum');
  await clickChip(page, 'Waterfall', '.sp__tabs');
  const ffs = await page.$eval('.sp-wf__text', e => e.style.fontFeatureSettings);
  await clickChip(page, 'tnum');
  // Chrome writes '"frac" 1' back as '"frac"' (1 is the default value).
  assert(rows.includes('frac') && rows.includes('tnum') && offOn[0] === '"frac" 0' && /^"frac"( 1)?$/.test(offOn[1]) && /"tnum"( 1)?/.test(ffs), `${rows} ${offOn} ${ffs}`);
  return `${rows.length} features: ${rows.join(' ')}`;
});
await check('Scale: 9 steps of 16 px × 1.25ⁿ; CSS tokens carry the same values', async () => {
  await clickChip(page, 'Scale', '.sp__tabs');
  const shown = await page.$$eval('.sp-sc__row', r => r.map(x => [Number(x.dataset.step), parseFloat(x.querySelector('.sp-sc__px').textContent)]));
  const expect = Array.from({ length: 9 }, (_, i) => 6 - i).map(st => [st, Math.round(16 * 1.25 ** st * 100) / 100]);
  const css = readFileSync(await download(page, () => page.click(btn('CSS scale tokens'))), 'utf8');
  const tok = Object.fromEntries([...css.matchAll(/--step-(n?\d+): ([\d.]+)rem/g)].map(m => [m[1].replace('n', '-'), Number(m[2])]));
  const off = expect.filter(([st, px]) => Math.abs(tok[st] * 16 - px) > 0.02);
  assert(JSON.stringify(shown) === JSON.stringify(expect) && !off.length && /font-family: "Inter"/.test(css), `${JSON.stringify(shown)} / ${JSON.stringify(tok)}`);
  return expect.map(e => `${e[0]}:${e[1]}`).join(' ');
});
await check('Specimen PDF: vector outlines from the font; pages for cover, waterfall, glyphs, scale', async () => {
  const f = await download(page, () => page.click(btn('Specimen PDF')), 120000);
  const buf = readFileSync(f);
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert(buf.slice(0, 5).toString() === '%PDF-' && pages >= 4, `${pages} pages`);
  if (!HAS_GS) return `${pages} pages`;
  const png = join(OUT, 'specimen-p1.png');
  execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-r50', '-dFirstPage=1', '-dLastPage=1', `-sOutputFile=${png}`, f]);
  const st = await imgStats(readFileSync(png), 'image/png');
  const txt = execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=txtwrite', '-sOutputFile=-', f]).toString();
  const fontsInPdf = /\/FontFile|\/Subtype\s*\/Type0/.test(buf.toString('latin1'));
  assert(st.std > 8 && /Lathe Specimen/.test(txt) && !fontsInPdf, `σ ${st.std}, embedded font ${fontsInPdf}`);
  return `${basename(f)}: ${pages} pages; page 1 renders (σ ${st.std.toFixed(0)}); glyphs drawn as paths, no font embedded`;
});

/* ================= Kinetic-type ================= */
state.tool = 'kinetic-type';
await page.goto(BASE + '/t/kinetic-type', { waitUntil: 'networkidle' });
const frameStats = () => page.$eval('.kt__canvas', c => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 200) ink++;
  return ink / (d.length / 16);
});
const scrubTo = async f => { await setSlider(page, 'Time', Math.round(f * 1000)); await page.waitForTimeout(80); };
let cycleLen = 0; // read once while playing; the status line pauses with the scrubber
const cycleSec = async () => cycleLen || (cycleLen = parseFloat(/([\d.]+) s cycle/.exec(await statusState(page))[1]));
await check('Cycle length = duration + stagger × (letters − 1) + hold', async () => {
  await page.waitForFunction(() => /cycle/.test(document.querySelector('.statusbar__state')?.textContent ?? ''));
  const c = await cycleSec();
  // Letters keep their index in the text, spaces included; a line break drops its space, so the
  // 32-character line wrapped in two gives 31 stagger slots.
  const expect = 2.4 + 0.04 * (31 - 1) + 1;
  assert(Math.abs(c - expect) < 0.02, `${c} vs ${expect}`); return `${c} s (31 slots)`;
});
const settled = {};
for (const p of ['Stagger', 'Fall', 'Drift', 'Scramble', 'Dissolve']) {
  await check(`${p}: blank at the start, the full text when settled, in motion between`, async () => {
    await clickChip(page, p);
    await scrubTo(0); const a = await frameStats();
    await scrubTo(0.3); const mid = await frameStats();
    await scrubTo(0.999); const end = await frameStats();
    settled[p] = end;
    assert(end > 0.02 && a < end * 0.6 && mid !== end, `start ${a.toFixed(4)} mid ${mid.toFixed(4)} end ${end.toFixed(4)}`);
    return `ink ${(a * 100).toFixed(1)}% → ${(mid * 100).toFixed(1)}% → ${(end * 100).toFixed(1)}%`;
  });
}
await check('Every preset settles on the same set text', async () => {
  const v = Object.values(settled); const spread = Math.max(...v) - Math.min(...v);
  assert(spread < 0.004, JSON.stringify(settled)); return `ink ${(v[0] * 100).toFixed(2)}% ± ${(spread * 100).toFixed(2)}`;
});
await check('GIF: GIF89a, 540 px wide, one frame per 1/25 s of the cycle, loops forever', async () => {
  await clickChip(page, 'Stagger');
  const c = await cycleSec();
  const buf = readFileSync(await download(page, () => page.click(btn('Export GIF')), 180000));
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  // Walk the GIF's blocks (a byte scan would also match inside the LZW data).
  let o = 13 + (buf[10] & 0x80 ? 3 * 2 ** ((buf[10] & 7) + 1) : 0), frames = 0;
  const skipSub = () => { while (buf[o]) o += buf[o] + 1; o++; };
  while (o < buf.length && buf[o] !== 0x3b) {
    if (buf[o] === 0x21) { o += 2; skipSub(); }
    else if (buf[o] === 0x2c) { frames++; const p = buf[o + 9]; o += 10 + (p & 0x80 ? 3 * 2 ** ((p & 7) + 1) : 0) + 1; skipSub(); }
    else throw new Error(`bad block 0x${buf[o].toString(16)} at ${o}`);
  }
  const loops = buf.includes(Buffer.from('NETSCAPE2.0'));
  assert(buf.slice(0, 6).toString() === 'GIF89a' && w === 540 && h === 540 && Math.abs(frames - Math.round(c * 25)) <= 1 && loops, `${w}×${h}, ${frames} frames for ${c}s, loop ${loops}`);
  return `${w}×${h}, ${frames} frames (${c} s × 25), ${(buf.length / 1024).toFixed(0)} KB`;
});
await check('WebM: VP8/VP9 at 1080 × 1080, duration written into the header', async () => {
  const c = await cycleSec();
  const f = await download(page, () => page.click(btn('Export WebM')), 120000);
  const info = ffprobe(f);
  const v = info.streams.find(s => s.codec_type === 'video');
  const dur = Number(info.format.duration);
  assert(/vp8|vp9/.test(v.codec_name) && v.width === 1080 && v.height === 1080 && Math.abs(dur - c) < 0.5, `${v.codec_name} ${v.width}×${v.height} ${dur}s vs ${c}`);
  return `${v.codec_name} ${v.width}×${v.height}, ${dur.toFixed(2)} s (cycle ${c} s)`;
});
await check('A dropped font replaces Helvetica Neue', async () => {
  await scrubTo(0.999); const before = await frameStats();
  await drop(page, 'inter-latin.woff2', 'font/woff2');
  await page.waitForFunction(() => /inter-latin/.test(document.querySelector('.inspector')?.textContent ?? ''));
  await scrubTo(0.999); const after = await frameStats();
  assert(Math.abs(after - before) > 0.0005, `${before} → ${after}`);
  return `typeface inter-latin; settled ink ${(before * 100).toFixed(2)}% → ${(after * 100).toFixed(2)}%`;
});

/* ================= shared ================= */
state.tool = 'shared';
await check('All four tools ready, each with a Defaults panel; Fork downloads their source', async () => {
  const out = [];
  for (const id of ['grid', 'specimen', 'kinetic-type', 'icon-set']) {
    await page.goto(`${BASE}/t/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.defaults__row');
    const rows = await page.locator('.defaults__row').count(), todo = await page.locator('.defaults__row', { hasText: 'TODO(David)' }).count();
    const f = await download(page, () => page.click('.defaults .l-btn:text-is("Fork this tool")'));
    const listing = execFileSync('unzip', ['-l', f]).toString();
    assert(rows >= 7 && todo === rows && /index\.ts/.test(listing) && /FORK\.md/.test(listing), `${id}: ${rows}/${todo}`);
    out.push(`${id} ${rows}`);
  }
  return out.join(', ') + ' default rows (all TODO(David)); forks contain index.ts and FORK.md';
});
await check('No console errors across the run', () => {
  const real = errors.filter(e => !/favicon/.test(e));
  assert(!real.length, real.slice(0, 3).join(' | ')); return 'clean';
});

await browser.close(); server.kill();
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
