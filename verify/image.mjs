// Milestone 7: Palette, Dither, Vectorize, Cutout, against the production build (vite preview).
// Outputs are checked independently of the app: palettes and scales in OKLab, contrast with the
// WCAG formula, .ase parsed byte by byte, dithers by their pixels, traced SVGs rendered and compared
// with the source, cutouts by their alpha channel.
// Usage: npm run verify:image
import { chromium } from 'playwright';
import vm from 'node:vm';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, assert, check, openPage, download, pngInfo } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'out', 'image');
const FX = join(HERE, 'fixtures');
const PORT = 4325;
const BASE = `http://127.0.0.1:${PORT}`;
state.out = OUT;
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
state.vp = await ctx.newPage(); await state.vp.goto(BASE + '/');
console.log('lathe image tools (milestone 7)');

/* ---------------- helpers ---------------- */
const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map(i => s2l(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const lch = hex => { const [L, a, b] = oklab(hex); return { L, C: Math.hypot(a, b), H: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 }; };
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const wcag = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

async function drop(page, file, type) {
  const b64 = readFileSync(join(FX, file)).toString('base64');
  await page.evaluate(({ b64, file, type }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], file, { type }));
    const el = document.querySelector('.stage');
    for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64, file, type });
}
/** Drop an image generated in the page (a canvas drawing) onto the stage. */
async function dropDrawn(page, name, w, h, draw) {
  await page.evaluate(async ({ name, w, h, draw }) => {
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d');
    new Function('x', 'w', 'h', draw)(x, w, h);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(new File([blob], name, { type: 'image/png' }));
    const el = document.querySelector('.stage');
    for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, w, h, draw });
}
const setSlider = (page, label, v) => page.locator(`.inspector .l-slider:has(.l-slider__label:text-is("${label}")) input`).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const clickChip = (page, text) => page.locator('.inspector .l-chip', { hasText: new RegExp(`^${text.replace(/[.+()]/g, '\\$&')}$`) }).first().click();

/** Pixel statistics of an image file, decoded in Chrome at full size. */
async function pix(buf, type, o = {}) {
  return state.vp.evaluate(async ({ b64, type, o }) => {
    const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });
    let src, w, h;
    if (type === 'image/svg+xml') {
      const url = URL.createObjectURL(blob); src = new Image(); src.src = url; await src.decode();
      w = o.w ?? src.naturalWidth; h = o.h ?? src.naturalHeight;
    } else { src = await createImageBitmap(blob); w = o.w ?? src.width; h = o.h ?? src.height; }
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d', { willReadFrequently: true });
    if (o.bg) { x.fillStyle = o.bg; x.fillRect(0, 0, w, h); }
    x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const colors = new Map(); let sum = 0, dark = 0, transparent = 0, semi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (colors.size < 5000) colors.set(k, (colors.get(k) ?? 0) + 1);
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; if (l < 128) dark++;
      if (d[i + 3] < 8) transparent++; else if (d[i + 3] < 248) semi++;
    }
    const n = d.length / 4;
    const at = (px, py) => { const i = (Math.floor(py) * w + Math.floor(px)) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    let blocky = null;
    if (o.block) { // every o.block×o.block cell is one color
      blocky = true;
      for (let by = 0; by + o.block <= Math.min(h, 400) && blocky; by += o.block) for (let bx = 0; bx + o.block <= Math.min(w, 400) && blocky; bx += o.block) {
        const k0 = at(bx, by).join();
        for (let yy = 0; yy < o.block && blocky; yy++) for (let xx = 0; xx < o.block; xx++) if (at(bx + xx, by + yy).join() !== k0) { blocky = false; break; }
      }
    }
    const ink = o.inkMask ? (() => { const m = new Uint8Array(n); for (let i = 0; i < n; i++) { const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; m[i] = d[i * 4 + 3] > 128 && l < 160 ? 1 : 0; } return Array.from(m); })() : null;
    return { w, h, unique: colors.size, top: [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ['#' + k.toString(16).padStart(6, '0').toUpperCase(), v / n]),
      mean: sum / n / 255, dark: dark / n, transparent: transparent / n, semi: semi / n,
      corners: [at(2, 2)[3], at(w - 3, 2)[3], at(2, h - 3)[3], at(w - 3, h - 3)[3]], center: at(w / 2, h / 2)[3], blocky, ink };
  }, { b64: buf.toString('base64'), type, o });
}
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 1; };

/* ================= Palette ================= */
state.tool = 'palette';
const { page, errors } = await openPage(ctx, BASE + '/t/palette');
let swatches = [];
await check('Drop a photo: palette extracted (6 swatches, OKLab k-means), shares sum to 1', async () => {
  await drop(page, 'photo.jpg', 'image/jpeg');
  await page.waitForSelector('.pl-sw');
  swatches = await page.$$eval('.pl-sw', ss => ss.map(s => ({ hex: s.dataset.hex, meta: s.querySelector('.pl-sw__meta').textContent })));
  const shares = swatches.map(s => Number(/(\d+)%/.exec(s.meta)?.[1] ?? 0));
  assert(swatches.length === 6 && swatches.every(s => /^#[0-9A-F]{6}$/.test(s.hex)) && Math.abs(shares.reduce((a, b) => a + b, 0) - 100) <= 3, JSON.stringify(swatches));
  return swatches.map(s => s.hex).join(' ');
});
await check('Scales: 11 steps per swatch; lightness descends; hue held; swatch anchored at its nearest step', async () => {
  const rows = await page.$$eval('.pl-scales', g => {
    const cells = [...g[0].querySelectorAll('.pl-cell')].map(c => ({ hex: c.dataset.hex, base: c.classList.contains('is-base') }));
    return Array.from({ length: cells.length / 11 }, (_, i) => cells.slice(i * 11, i * 11 + 11));
  });
  assert(rows.length === 6, `${rows.length} rows`);
  const bad = [];
  rows.forEach((r, i) => {
    const Ls = r.map(c => lch(c.hex).L);
    const base = r.filter(c => c.base);
    if (base.length !== 1 || base[0].hex !== swatches[i].hex) bad.push(`row ${i}: base ${base.map(b => b.hex)}`);
    r.forEach((c, k) => { if (k && !c.base && !r[k - 1].base && Ls[k] > Ls[k - 1] + 0.005) bad.push(`row ${i} step ${k} lighter`); });
    const h0 = lch(swatches[i].hex);
    if (h0.C > 0.04) r.forEach((c, k) => { const x = lch(c.hex); if (!c.base && x.C > 0.02 && Math.min(Math.abs(x.H - h0.H), 360 - Math.abs(x.H - h0.H)) > 4) bad.push(`row ${i} step ${k} hue ${x.H.toFixed(1)} vs ${h0.H.toFixed(1)}`); });
  });
  assert(!bad.length, bad.slice(0, 4).join('; '));
  return `${rows.length} × 11 cells`;
});
await check('Edit swatches: add a hex, rename, remove', async () => {
  await page.fill('.inspector input[placeholder="#E8FF1A"]', 'E8FF1A'); await page.click('.inspector .l-btn:text-is("Add")');
  const n1 = await page.locator('.pl-sw').count();
  const name = page.locator('.pl-row__name').last(); await name.fill('Lathe Green'); await name.press('Enter');
  await page.waitForTimeout(100);
  const label = await page.locator('.pl-sw').last().textContent();
  await page.locator('.pl-row').first().locator('.l-btn:text-is("Remove")').click();
  const n2 = await page.locator('.pl-sw').count();
  assert(n1 === 7 && /#E8FF1A/.test(label) && /lathe-green/.test(label) && n2 === 6, `${n1} → ${n2}, ${label}`);
  swatches = await page.$$eval('.pl-sw', ss => ss.map(s => ({ hex: s.dataset.hex, name: s.querySelector('.pl-sw__meta').textContent.split(' · ')[0] })));
  return 'added #E8FF1A as lathe-green; removed the first';
});
await check('Contrast pairs shown all pass AA (independent WCAG 2.2 ratio); levels filter', async () => {
  const read = () => page.$$eval('.pl-pair', ps => ps.map(p => ({ names: p.querySelector('.pl-pair__names').textContent, ratio: parseFloat(p.querySelector('.pl-pair__ratio').textContent), grade: p.dataset.grade })));
  const aa = await read();
  const byName = Object.fromEntries([...swatches.map(s => [s.name, s.hex]), ['white', '#FFFFFF'], ['black', '#000000']]);
  for (const p of aa) {
    const [fg, bg] = p.names.split(' on ');
    const r = wcag(byName[fg], byName[bg]);
    assert(Math.abs(r - p.ratio) < 0.01 && r >= 4.5, `${p.names}: shown ${p.ratio}, computed ${r.toFixed(2)}`);
  }
  await clickChip(page, 'All'); const all = await read(); await clickChip(page, 'AAA'); const aaa = await read(); await clickChip(page, 'AA');
  assert(all.length >= aa.length && aa.length >= aaa.length && aaa.every(p => p.ratio >= 7), `${all.length}/${aa.length}/${aaa.length}`);
  return `${all.length} pairs; ${aa.length} pass AA; ${aaa.length} pass AAA`;
});
const exp = label => download(page, () => page.click(`.inspector .l-btn:text-is("${label}")`));
await check('CSS export: one variable per swatch and per step', async () => {
  const css = readFileSync(await exp('CSS'), 'utf8');
  const vars = [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-F]{6});/g)];
  assert(vars.length === 6 * 12 && vars.some(v => v[1] === 'lathe-green' && v[2] === '#E8FF1A') && /^:root \{/.test(css), `${vars.length} vars`);
  return `${vars.length} custom properties`;
});
await check('Design tokens (DTCG 2025.10): color tokens with sRGB components matching hex', async () => {
  const j = JSON.parse(readFileSync(await exp('Tokens JSON'), 'utf8'));
  const toks = []; const walk = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') { if (v.$type === 'color') toks.push(v); walk(v); } };
  walk(j.color);
  const off = toks.filter(t => { const h = t.$value.hex; return t.$value.colorSpace !== 'srgb' || t.$value.components.some((c, i) => Math.abs(c - parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255) > 0.001); });
  assert(toks.length === 72 && !off.length && /designtokens\.org/.test(j.$schema), `${toks.length} tokens, ${off.length} mismatched`);
  return `${toks.length} color tokens`;
});
await check('Figma variables: REST payload with one collection, one mode, a COLOR per token', async () => {
  const j = JSON.parse(readFileSync(await exp('Figma variables'), 'utf8'));
  const ok = j.variableCollections.length === 1 && j.variables.length === 72 && j.variables.every(v => v.resolvedType === 'COLOR' && v.variableCollectionId === 'collection')
    && j.variableModeValues.length === 72 && j.variableModeValues.every(v => ['r', 'g', 'b', 'a'].every(k => v.value[k] >= 0 && v.value[k] <= 1));
  assert(ok, JSON.stringify(j).slice(0, 200));
  return `${j.variables.length} variables in “${j.variableCollections[0].name}”`;
});
await check('Tailwind config evaluates; colors nest DEFAULT + steps', async () => {
  const code = readFileSync(await exp('Tailwind'), 'utf8');
  const m = { exports: {} }; vm.runInNewContext(code, { module: m });
  const c = m.exports.theme.extend.colors;
  assert(Object.keys(c).length === 6 && c['lathe-green'].DEFAULT === '#E8FF1A' && Object.keys(c['lathe-green']).length === 12, JSON.stringify(c['lathe-green']));
  return `${Object.keys(c).length} color families`;
});
await check('.ase parses (independent reader): ASEF 1.0, groups, RGB floats match the hexes', async () => {
  const b = readFileSync(await exp('.ase'));
  assert(b.slice(0, 4).toString() === 'ASEF' && b.readUInt16BE(4) === 1 && b.readUInt16BE(6) === 0, 'header');
  const count = b.readUInt32BE(8); let o = 12; const colors = []; let groups = 0;
  for (let k = 0; k < count; k++) {
    const type = b.readUInt16BE(o), len = b.readUInt32BE(o + 2); const body = b.slice(o + 6, o + 6 + len); o += 6 + len;
    if (type === 0xc001) groups++;
    if (type !== 0x0001) continue;
    const nl = body.readUInt16BE(0); const name = Buffer.from(body.slice(2, 2 + (nl - 1) * 2)).swap16().toString('utf16le');
    const p = 2 + nl * 2; const model = body.slice(p, p + 4).toString();
    const rgb = [0, 1, 2].map(i => Math.round(body.readFloatBE(p + 4 + i * 4) * 255));
    colors.push({ name, model, hex: '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() });
  }
  assert(o === b.length && groups === 6 && colors.length === 72 && colors.every(c => c.model === 'RGB '), `${o}/${b.length}, ${groups} groups, ${colors.length} colors`);
  assert(colors.some(c => c.name === 'lathe-green' && c.hex === '#E8FF1A'), 'lathe-green');
  return `${count} blocks, ${colors.length} RGB swatches in ${groups} groups, byte length exact`;
});
await check('Open in Color-check hands the hex list over', async () => {
  await page.click('.inspector .l-btn:text-is("Open in Color-check")');
  await page.waitForURL('**/t/color-check');
  await page.waitForFunction(() => /#E8FF1A/.test(document.querySelector('.inspector textarea')?.value ?? ''));
  const v = await page.inputValue('.inspector textarea');
  assert(v.trim().split('\n').length === 6, v); return v.trim().split('\n').join(' ');
});
await check('/api/fetch: a page resolves to its share image; private addresses refused', async () => {
  const ok = await fetch(`${BASE}/api/fetch?url=${encodeURIComponent('https://stripe.com')}`);
  const bytes = (await ok.arrayBuffer()).byteLength;
  assert(ok.ok && /^image\//.test(ok.headers.get('content-type')) && bytes > 1000 && ok.headers.get('x-lathe-filename'), `${ok.status}`);
  for (const u of ['http://127.0.0.1:4325/', 'http://169.254.169.254/', 'file:///etc/passwd']) { const r = await fetch(`${BASE}/api/fetch?url=${encodeURIComponent(u)}`); assert(r.status === 400, `${u} → ${r.status}`); }
  return `stripe.com → ${ok.headers.get('x-lathe-filename')} (${(bytes / 1024).toFixed(0)} KB); loopback, metadata, file: refused`;
});

/* ================= Dither ================= */
state.tool = 'dither';
await page.goto(BASE + '/t/dither', { waitUntil: 'networkidle' });
const ditherPng = async () => readFileSync(await download(page, () => page.click('.inspector .l-btn:text-is("Export PNG")')));
const waitRender = async () => { await page.waitForTimeout(250); await page.waitForFunction(() => /ms/.test(document.querySelector('.statusbar')?.textContent ?? '')); };
await check('Floyd–Steinberg on a gray ramp keeps the average tone (two colors, ±3%)', async () => {
  await dropDrawn(page, 'ramp.png', 512, 256, `const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, w, h);`);
  await page.waitForSelector('.dt__canvas'); await waitRender();
  await setSlider(page, 'Pixel size', 1); await waitRender();
  const p = await pix(await ditherPng(), 'image/png');
  assert(p.w === 512 && p.h === 256 && p.unique === 2 && Math.abs(p.mean - 0.5) < 0.03, JSON.stringify({ u: p.unique, mean: p.mean }));
  return `2 colors, mean ${p.mean.toFixed(3)} (ramp 0.500)`;
});
await page.evaluate(() => {});
await drop(page, 'photo.jpg', 'image/jpeg'); await waitRender();
for (const m of ['Bayer 2', 'Bayer 4', 'Bayer 8', 'Floyd–Steinberg', 'Atkinson']) {
  await check(`${m}: two-color PNG at the source size`, async () => {
    await clickChip(page, m); await waitRender();
    const p = await pix(await ditherPng(), 'image/png', { block: 1 });
    assert(p.w === 1600 && p.h === 1067 && p.unique === 2 && p.top.map(t => t[0]).sort().join() === '#000000,#FFFFFF', JSON.stringify(p.top));
    return `1600×1067, ink ${(p.dark * 100).toFixed(0)}%`;
  });
}
await check('Threshold: higher puts more pixels in ink', async () => {
  await clickChip(page, 'Floyd–Steinberg');
  await setSlider(page, 'Threshold', 30); await waitRender(); const lo = (await pix(await ditherPng(), 'image/png')).dark;
  await setSlider(page, 'Threshold', 70); await waitRender(); const hi = (await pix(await ditherPng(), 'image/png')).dark;
  await setSlider(page, 'Threshold', 50); await waitRender();
  assert(hi > lo + 0.1, `${lo.toFixed(3)} → ${hi.toFixed(3)}`); return `ink ${(lo * 100).toFixed(0)}% → ${(hi * 100).toFixed(0)}%`;
});
await check('Pixel size 8: the output is 8 × 8 blocks of one color', async () => {
  await setSlider(page, 'Pixel size', 8); await waitRender();
  const p = await pix(await ditherPng(), 'image/png', { block: 8 });
  await setSlider(page, 'Pixel size', 2); await waitRender();
  assert(p.blocky, 'not blocky'); return '8 × 8 blocks';
});
await check('Palette mode: at most 4 colors, all from the image palette', async () => {
  await clickChip(page, 'Palette'); await waitRender();
  const pal = await page.$$eval('.dt-pal__sw', s => s.map(x => x.title));
  const p = await pix(await ditherPng(), 'image/png');
  const used = p.top.filter(t => t[1] > 0.001).map(t => t[0]);
  await clickChip(page, 'Two colors'); await waitRender();
  assert(pal.length === 4 && p.unique <= 4 && p.unique >= 3 && used.every(h => pal.includes(h)), `${pal} vs ${used}`);
  return `palette ${pal.join(' ')}; ${p.unique} used`;
});
for (const [m, kind] of [['Halftone dots', 'dots'], ['Halftone lines', 'lines']]) {
  await check(`${m}: PNG and an SVG of vector shapes that renders like the PNG`, async () => {
    await clickChip(page, m); await waitRender();
    const png = await pix(await ditherPng(), 'image/png', { w: 400, h: 267 });
    const f = await download(page, () => page.click('.inspector .l-btn:text-is("Export SVG")'));
    execFileSync('xmllint', ['--noout', f]);
    const svg = readFileSync(f, 'utf8');
    const shapes = kind === 'dots' ? (svg.match(/a[\d.]+ [\d.]+ 0 1 0/g) || []).length / 2 : (svg.match(/<path d="M/g) || []).length;
    const sv = await pix(Buffer.from(svg), 'image/svg+xml', { w: 400, h: 267, bg: '#FFFFFF' });
    assert(/width="1600" height="1067"/.test(svg) && shapes > (kind === 'dots' ? 2000 : 40) && Math.abs(sv.mean - png.mean) < 0.03, `${shapes} shapes, mean svg ${sv.mean.toFixed(3)} png ${png.mean.toFixed(3)}`);
    return `${basename(f)}: ${shapes} ${kind === 'dots' ? 'dots' : 'bands'}, ${(svg.length / 1024).toFixed(0)} KB; tone matches PNG (${sv.mean.toFixed(3)} vs ${png.mean.toFixed(3)})`;
  });
}

/* ================= Vectorize ================= */
state.tool = 'vectorize';
await page.goto(BASE + '/t/vectorize', { waitUntil: 'networkidle' });
const svgOut = async () => readFileSync(await download(page, () => page.click('.inspector .l-btn:text-is("Export SVG")')));
// Waits for the next completed trace (the stage counts them in data-traces).
const traceCount = () => page.evaluate(() => Number(document.querySelector('.vz')?.dataset.traces ?? 0));
const traced = async before => { await page.waitForFunction(n => Number(document.querySelector('.vz')?.dataset.traces ?? 0) > n, before, { timeout: 60000 }); };
await check('One color (Potrace): the PNG logo traces to an SVG that covers the same ink (IoU ≥ 0.9)', async () => {
  const before = await traceCount();
  await drop(page, 'logo.png', 'image/png'); await traced(before);
  const svg = await svgOut();
  execFileSync('xmllint', ['--noout', '-'], { input: svg });
  const s = svg.toString();
  const src = await pix(readFileSync(join(FX, 'logo.png')), 'image/png', { w: 600, h: 120, inkMask: true, bg: '#FFFFFF' });
  const out = await pix(svg, 'image/svg+xml', { w: 600, h: 120, inkMask: true, bg: '#FFFFFF' });
  const j = iou(src.ink, out.ink);
  assert(/width="1500" height="300"/.test(s) && (s.match(/<path/g) || []).length > 0 && j >= 0.9, `IoU ${j.toFixed(3)}`);
  return `${(s.match(/<path/g) || []).length} paths, ${(svg.length / 1024).toFixed(1)} KB, IoU ${j.toFixed(3)}`;
});
await check('On a photo, ignoring specks removes paths and smoothing changes the curves', async () => {
  const paths = async () => (await svgOut()).toString().match(/<path/g)?.length ?? 0;
  let before = await traceCount();
  await drop(page, 'photo.jpg', 'image/jpeg'); await traced(before);
  const set = async (label, v) => { const b = await traceCount(); await setSlider(page, label, v); await traced(b); };
  await set('Ignore specks', 0); const fine = await paths();
  await set('Ignore specks', 80); const coarse = await paths();
  await set('Ignore specks', 4);
  await set('Smoothing', 0); const sharp = (await svgOut()).toString();
  await set('Smoothing', 100); const smooth = (await svgOut()).toString();
  await set('Smoothing', 40);
  assert(coarse < fine && sharp !== smooth, `paths ${fine} → ${coarse}; smoothing ${sharp.length} vs ${smooth.length} B`);
  return `paths ${fine} → ${coarse} ignoring specks under 80 px²; smoothing 0 → 1: ${(sharp.length / 1024).toFixed(0)} → ${(smooth.length / 1024).toFixed(0)} KB`;
});
await check('Multi-color (ImageTracer): 4 colors from the photo; fills limited to the OKLab palette; render close to source', async () => {
  let before = await traceCount();
  await clickChip(page, 'Multi-color (ImageTracer)'); await traced(before);
  before = await traceCount();
  await setSlider(page, 'Colors', 4); await traced(before);
  const svg = (await svgOut()).toString();
  const fills = new Set([...svg.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)].map(m => m.slice(1).join()));
  const src = await pix(readFileSync(join(FX, 'photo.jpg')), 'image/jpeg', { w: 400, h: 267 });
  const out = await pix(Buffer.from(svg), 'image/svg+xml', { w: 400, h: 267 });
  assert(fills.size >= 2 && fills.size <= 4 && Math.abs(src.mean - out.mean) < 0.06 && /width="1600" height="1067"/.test(svg), `${fills.size} fills, mean ${src.mean.toFixed(3)} vs ${out.mean.toFixed(3)}`);
  return `${fills.size} fills, ${(svg.match(/<path/g) || []).length} paths; mean tone ${out.mean.toFixed(3)} vs ${src.mean.toFixed(3)}`;
});
await check('Compare: wipe, overlay, SVG only, original', async () => {
  const modes = [];
  for (const m of ['Overlay', 'SVG', 'Original', 'Wipe']) { await clickChip(page, m); modes.push(await page.getAttribute('.vz', 'data-compare')); }
  const wipeVisible = await page.locator('.vz__wipe').isVisible();
  assert(modes.join() === 'overlay,svg,raster,wipe' && wipeVisible, modes.join()); return modes.join(', ');
});
await check('Send the SVG to Multi-export', async () => {
  await page.locator('.l-send select').selectOption('multi-export');
  await page.click('.l-send .l-btn:text-is("Send")');
  await page.waitForURL('**/t/multi-export');
  await page.waitForFunction(() => /traced\.svg/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 15000 });
  return 'Multi-export loaded photo-traced.svg';
});

/* ================= Cutout ================= */
state.tool = 'cutout';
await page.goto(BASE + '/t/cutout', { waitUntil: 'networkidle' });
const cutPng = async () => readFileSync(await download(page, () => page.click('.inspector .l-btn:text-is("Export PNG")')));
let base;
await check('Remove the background of a photographed object (model runs in the browser)', async () => {
  const t0 = Date.now();
  await drop(page, 'teapot.jpg', 'image/jpeg');
  await page.waitForSelector('.co[data-done="true"]', { timeout: 300000 });
  base = await pix(await cutPng(), 'image/png');
  assert(base.w === 599 && base.h === 502 && base.corners.every(a => a < 10) && base.center > 240 && base.transparent > 0.15 && base.transparent < 0.85, JSON.stringify({ c: base.corners, center: base.center, t: base.transparent }));
  return `${base.w}×${base.h}; corners transparent, centre opaque; ${(100 - base.transparent * 100).toFixed(0)}% kept; ${((Date.now() - t0) / 1000).toFixed(0)} s incl. model download`;
});
await check('Edge refine: spread keeps more, choke less; hardness narrows the soft edge; feather widens it', async () => {
  const run = async (label, v) => { await setSlider(page, label, v); await page.waitForTimeout(400); return pix(await cutPng(), 'image/png'); };
  const spread = await run('Shift', 10), choke = await run('Shift', -10); await run('Shift', 0);
  const hard = await run('Hardness', 100), soft = await run('Hardness', 0); await run('Hardness', 30);
  const feather = await run('Feather', 12); await run('Feather', 0);
  assert(spread.transparent < base.transparent && choke.transparent > base.transparent, `kept ${(1 - choke.transparent).toFixed(3)} < ${(1 - base.transparent).toFixed(3)} < ${(1 - spread.transparent).toFixed(3)}`);
  assert(hard.semi < soft.semi && feather.semi > base.semi * 1.5, `semi hard ${hard.semi.toFixed(4)} soft ${soft.semi.toFixed(4)} base ${base.semi.toFixed(4)} feather ${feather.semi.toFixed(4)}`);
  return `kept: choke ${(100 - choke.transparent * 100).toFixed(1)}% < base ${(100 - base.transparent * 100).toFixed(1)}% < spread ${(100 - spread.transparent * 100).toFixed(1)}%; soft-edge pixels: hard ${(hard.semi * 100).toFixed(2)}%, feather ${(feather.semi * 100).toFixed(2)}%`;
});
await check('WebP export keeps transparency', async () => {
  const f = await download(page, () => page.click('.inspector .l-btn:text-is("Export WebP")'));
  const p = await pix(readFileSync(f), 'image/webp');
  assert(readFileSync(f).slice(8, 12).toString() === 'WEBP' && p.corners.every(a => a < 16) && p.center > 230, JSON.stringify(p.corners));
  return `${basename(f)} ${(readFileSync(f).length / 1024).toFixed(0)} KB, alpha kept`;
});
await check('Send the cutout to Dither', async () => {
  await page.locator('.l-send select').selectOption('dither');
  await page.click('.l-send .l-btn:text-is("Send")');
  await page.waitForURL('**/t/dither');
  await page.waitForFunction(() => /cutout\.png/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 15000 });
  return 'Dither loaded teapot-cutout.png';
});

/* ================= shared ================= */
state.tool = 'shared';
await check('All four tools are ready in the rail, each with a Defaults panel', async () => {
  const out = [];
  for (const id of ['palette', 'dither', 'vectorize', 'cutout']) {
    await page.goto(`${BASE}/t/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.defaults__row');
    const rows = await page.locator('.defaults__row').count();
    const todo = await page.locator('.defaults__row', { hasText: 'TODO(David)' }).count();
    assert(rows >= 8 && todo === rows, `${id}: ${rows} rows, ${todo} TODO`);
    out.push(`${id} ${rows}`);
  }
  return out.join(', ') + ' default rows, every reason TODO(David)';
});
await check('Fork downloads each new tool’s source', async () => {
  const out = [];
  for (const id of ['palette', 'dither', 'vectorize', 'cutout']) {
    await page.goto(`${BASE}/t/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.defaults__row');
    const f = await download(page, () => page.click('.defaults .l-btn:text-is("Fork this tool")'));
    const listing = execFileSync('unzip', ['-l', f]).toString();
    assert(/index\.ts/.test(listing) && /defaults\.json/.test(listing) && /FORK\.md/.test(listing), listing.slice(0, 200));
    out.push(`${id} ${(listing.match(/\n\s+\d+\s/g) || []).length - 1}`);
  }
  return out.join(', ') + ' files';
});
await check('LICENSES.md records the AGPL obligation', async () => {
  const t = readFileSync(join(ROOT, 'LICENSES.md'), 'utf8');
  assert(/AGPL-3\.0/.test(t) && /background-removal/.test(t) && /open source/.test(t), 'missing'); return 'present';
});
await check('No console errors across the run', () => {
  const real = errors.filter(e => !/favicon/.test(e));
  assert(!real.length, real.slice(0, 3).join(' | ')); return 'clean';
});

await browser.close(); server.kill();
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
