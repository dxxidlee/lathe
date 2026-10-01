// Milestone 0: drive the five reference tools in Chrome and validate every export.
// Usage: node run.mjs [toolId ...]   (default: all five)
// Writes downloads to verify/out/<tool>/ and a machine-readable verify/out/results.json.
import { chromium, firefox, webkit } from 'playwright';
import JSZip from 'jszip';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, 'fixtures');
const OUT = join(HERE, 'out');
const PORT = 4317;
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = process.argv.slice(2);
const HAS_GS = (() => { try { execFileSync('gs', ['--version']); return true; } catch { return false; } })();

const results = [];
let currentTool = '';

function log(status, check, detail) {
  const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' }[status];
  console.log(`  ${icon}  ${check}${detail ? ' — ' + detail : ''}`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
class Warn extends Error {}

/** Runs one check. fn returns a detail string (pass), throws Error (fail) or Warn (pass-with-note). */
async function check(name, fn) {
  let status = 'pass', detail = '';
  try { detail = (await fn()) ?? ''; }
  catch (e) { status = e instanceof Warn ? 'warn' : 'fail'; detail = String(e.message).split('\n')[0]; }
  results.push({ tool: currentTool, check: name, status, detail });
  log(status, name, detail);
  return status !== 'fail';
}

async function openTool(ctx, path) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/__fixtures/')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  return { page, errors };
}

async function shot(page, name) {
  const dir = join(OUT, 'screens'); mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name + '.png') });
}

async function download(page, action, timeout = 60000) {
  const dir = join(OUT, currentTool); mkdirSync(dir, { recursive: true });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  const file = join(dir, dl.suggestedFilename());
  await dl.saveAs(file);
  const failure = await dl.failure();
  assert(!failure, 'download failed: ' + failure);
  return file;
}

/* ---------------- validators ---------------- */
let vp; // validator page (same-origin blank page with decoders)

function pngInfo(buf) {
  assert(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'not a PNG signature');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegInfo(buf) {
  assert(buf[0] === 0xff && buf[1] === 0xd8, 'not a JPEG (no SOI)');
  assert(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9, 'JPEG truncated (no EOI)');
  let i = 2, adobe = false, comps = null, w, h;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd9 || m === 0xda) break;
    const len = buf.readUInt16BE(i + 2);
    if (m === 0xee && buf.slice(i + 4, i + 9).toString() === 'Adobe') adobe = true;
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); comps = buf[i + 9]; }
    i += 2 + len;
  }
  return { w, h, comps, adobe };
}

/** Decode in Chrome and return {w,h,std,gray,transparent,mean:[r,g,b]} */
async function imgStats(buf, type) {
  return vp.evaluate(async ({ b64, type }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type });
    let src;
    if (type === 'image/svg+xml') {
      const url = URL.createObjectURL(blob);
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('SVG failed to render')); i.src = url; });
    } else src = await createImageBitmap(blob);
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const s = Math.min(1, 400 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sum = 0, sum2 = 0, gray = true, transparent = 0, mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { transparent++; continue; }
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++; sum += l; sum2 += l * l; mr += d[i]; mg += d[i + 1]; mb += d[i + 2];
      if (Math.abs(d[i] - d[i + 1]) > 3 || Math.abs(d[i + 1] - d[i + 2]) > 3) gray = false;
    }
    const mean = n ? sum / n : 0;
    return { w, h, std: n ? Math.sqrt(sum2 / n - mean * mean) : 0, gray, transparent: transparent / (d.length / 4), mean: n ? [mr / n, mg / n, mb / n].map(Math.round) : [0, 0, 0] };
  }, { b64: buf.toString('base64'), type });
}

/** Fraction of pixels that differ noticeably between two rendered images, both scaled to w×h on white. */
async function diffImages(a, b, w, h, mask = false) {
  return vp.evaluate(async ({ a, b, w, h, mask }) => {
    const load = async ({ b64, type }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
      return x.getImageData(0, 0, w, h).data;
    };
    const [da, db] = await Promise.all([load(a), load(b)]);
    let diff = 0;
    // mask mode compares ink coverage only (paper vs not-paper), for colour-managed CMYK renders
    const ink = (d, i) => d[i] + d[i + 1] + d[i + 2] < 700;
    for (let i = 0; i < da.length; i += 4) {
      if (mask ? ink(da, i) !== ink(db, i) : Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 90) diff++;
    }
    return diff / (w * h);
  }, { a: { b64: a.buf.toString('base64'), type: a.type }, b: { b64: b.buf.toString('base64'), type: b.type }, w, h, mask });
}

/** Render an EPS with Ghostscript; returns PNG buffer. */
function gsRender(epsPath) {
  const png = epsPath + '.gs.png';
  execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-dEPSCrop', '-r72', '-sOutputFile=' + png, epsPath], { stdio: 'pipe' });
  return readFileSync(png);
}

async function validateEps(file, { sourceSvg, mask = false } = {}) {
  const buf = readFileSync(file);
  const head = buf.slice(0, 40).toString();
  assert(head.startsWith('%!PS-Adobe-3.0 EPSF-3.0'), 'missing EPSF header');
  assert(/%%BoundingBox: 0 0 \d+ \d+/.test(buf.slice(0, 600).toString()), 'missing BoundingBox');
  assert(buf.toString('latin1').trimEnd().endsWith('%%EOF'), 'missing %%EOF');
  if (!HAS_GS) return { rendered: false };
  const png = gsRender(file);
  const st = await imgStats(png, 'image/png');
  assert(st.std > 1, 'Ghostscript renders a blank page');
  let diff = null;
  if (sourceSvg) diff = await diffImages({ buf: png, type: 'image/png' }, { buf: sourceSvg, type: 'image/svg+xml' }, st.w, st.h, mask);
  return { rendered: true, w: st.w, h: st.h, diff };
}

function ffprobe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
}

function readText(file) { return readFileSync(file, 'utf8'); }

/* ================================================================
   COLOR-CHECK
   ================================================================ */
async function testColorCheck(ctx) {
  const { page, errors } = await openTool(ctx, '/color-check/');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await check('Empty state shown before input', async () => {
    const t = await page.textContent('#matrixWrap');
    assert(/Paste the hex codes/.test(t), 'no empty state');
  });

  const palette = '#E8FF1A, #000000\nFFFFFF #2B2BE6 #ff2e7e #fff';
  await page.fill('#input', palette);
  await check('Parses pasted hex (mixed separators, no #, 3-digit, dedupe)', async () => {
    const colors = await page.textContent('#countColors');
    const pairs = await page.textContent('#countPairs');
    const cells = await page.locator('td.cell').count();
    assert(colors === '5 colors', 'got ' + colors);
    assert(pairs === '20 pairings' && cells === 20, `${pairs}, ${cells} cells`);
    return `${colors}, ${pairs}`;
  });
  await check('WCAG 2.2 ratios correct (black/white 21.00 AAA; #2B2BE6 on white)', async () => {
    const bw = await page.getAttribute('td.cell[title^="fg #000000 on bg #FFFFFF"]', 'title');
    const v = await page.textContent('td.cell[title^="fg #000000 on bg #FFFFFF"] .val');
    assert(v.trim() === '21.00' && /AAA/.test(bw), `black/white = ${v} (${bw})`);
    // independent WCAG computation
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const exp = ((lum('#FFFFFF') + 0.05) / (lum('#2B2BE6') + 0.05)).toFixed(2);
    const got = (await page.textContent('td.cell[title^="fg #2B2BE6 on bg #FFFFFF"] .val')).trim();
    assert(got === exp, `#2B2BE6/white got ${got}, expected ${exp}`);
    const s = await page.textContent('#score');
    return `#2B2BE6/white ${got}; ${s.replace(/\s+/g, ' ').trim()}`;
  });
  await check('APCA mode: black on white ≈ +106, white on black ≈ −108', async () => {
    await page.click('#segStandard [data-v="apca"]');
    const a = (await page.textContent('td.cell[title^="fg #000000 on bg #FFFFFF"] .val')).trim();
    const b = (await page.textContent('td.cell[title^="fg #FFFFFF on bg #000000"] .val')).trim();
    assert(a === '+106' && b === '-108', `got ${a}, ${b}`);
    await page.click('#segStandard [data-v="wcag"]');
    return `${a}, ${b}`;
  });
  await check('"Show only AAA" dims cells below threshold', async () => {
    await page.click('#segThreshold [data-v="AAA"]');
    const op = await page.$$eval('td.cell', tds => tds.map(t => t.style.opacity));
    const dim = op.filter(o => o === '0.12').length;
    await page.click('#segThreshold [data-v="all"]');
    assert(dim > 0 && dim < op.length, `${dim}/${op.length} dimmed`);
    return `${dim}/${op.length} dimmed`;
  });
  await check('Auto-repair modal on a failing pair suggests a ≥4.5 fix', async () => {
    await page.click('td.cell[data-fg="#E8FF1A"][data-bg="#FFFFFF"]');
    await page.waitForSelector('.modal');
    const ratios = await page.$$eval('.repairOpt .ratio', els => els.map(e => parseFloat(e.textContent)));
    const hexes = await page.$$eval('.repairOpt .hex', els => els.map(e => e.textContent));
    assert(ratios.length && ratios.every(r => r >= 4.5), 'ratios ' + ratios);
    await page.click('.modal .close');
    assert(!(await page.$('.modal')), 'modal did not close');
    return hexes.map((h, i) => `${h} → ${ratios[i]}`).join(', ');
  });

  await shot(page, 'color-check-matrix');
  let svgFile;
  await check('Export .svg downloads a valid, renderable SVG matrix', async () => {
    svgFile = await download(page, () => page.click('#exportActions [data-exp="svg"]'));
    const txt = readText(svgFile);
    const st = await imgStats(Buffer.from(txt), 'image/svg+xml');
    const rows = (txt.match(/<g id="row-/g) || []).length;
    assert(rows === 5, `${rows} rows`);
    assert(st.std > 5, 'renders blank');
    return `${basename(svgFile)} ${st.w}×${st.h}, 5 rows`;
  });
  await check('Export .html downloads a standalone report with 20 cells', async () => {
    const f = await download(page, () => page.click('#exportActions [data-exp="html"]'));
    const html = readText(f);
    const cells = (html.match(/<td class="cell"/g) || []).length;
    assert(html.startsWith('<!DOCTYPE html>') && cells === 20, `${cells} cells`);
    return `${basename(f)}, ${cells} cells, stats block present: ${/class="stats"/.test(html)}`;
  });
  await check('Repeat exports get unique names', async () => {
    const f = await download(page, () => page.click('#exportActions [data-exp="svg"]'));
    assert(basename(f) !== basename(svgFile), 'same name ' + basename(f));
    return `${basename(svgFile)} → ${basename(f)}`;
  });
  await check('Uploaded chart font is embedded in the SVG export', async () => {
    await page.setInputFiles('#fontFile', join(HERE, '..', 'reference', 'mood-strip', 'fonts', 'inter-latin.woff2'));
    await page.waitForFunction(() => /Embedded/.test(document.getElementById('fontHint').textContent));
    const f = await download(page, () => page.click('#exportActions [data-exp="svg"]'));
    const txt = readText(f);
    assert(/@font-face\{font-family:'inter-latin';src:url\('data:/.test(txt), 'no @font-face in SVG');
    return 'font-face data URL embedded';
  });
  await check('Invalid input falls back to empty state', async () => {
    await page.fill('#input', 'zzz not a color 12');
    const t = await page.textContent('#matrixWrap');
    assert(/Paste the hex codes/.test(t), 'matrix rendered for junk');
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   MULTI-EXPORT
   ================================================================ */
async function testMultiExport(ctx) {
  const { page, errors } = await openTool(ctx, '/multi-export/');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await check('Export disabled until a file is loaded', async () => { assert(await page.isDisabled('#runBtn'), 'enabled'); });

  const cases = [
    { file: 'logo.png', w: 1500, h: 300, vector: false, alpha: true },
    { file: 'logo.svg', w: 600, h: 200, vector: true },
    { file: 'photo.jpg', w: 1600, h: 1067, vector: false },
  ];
  for (const c of cases) {
    const stem = c.file.replace(/\.[^.]+$/, '');
    await page.setInputFiles('#file', join(FX, c.file));
    await check(`${c.file}: loads, shows name/dims/size`, async () => {
      await page.waitForFunction(n => document.getElementById('metaName').textContent === n, c.file);
      const dims = await page.textContent('#metaDims');
      assert(dims === `${c.w}x${c.h}`, 'dims ' + dims);
      return `${dims}, ${await page.textContent('#metaBytes')}`;
    });
    if (c.file === 'logo.svg') await shot(page, 'multi-export-loaded');
    await page.fill('#size', '800');
    let zipFile;
    const ok = await check(`${c.file}: .zip downloads`, async () => {
      zipFile = await download(page, () => page.click('#runBtn'));
      await page.waitForFunction(() => /Export completed/.test(document.getElementById('status').textContent));
      return `${basename(zipFile)} — ${(await page.textContent('#status')).replace(/\s+/g, ' ')}`;
    });
    if (!ok) continue;
    const zip = await JSZip.loadAsync(readFileSync(zipFile));
    const files = Object.values(zip.files).filter(f => !f.dir);
    await check(`${c.file}: zip has 12 files + README in RGB/CMYK × COLOR/GRAYSCALE`, async () => {
      const names = files.map(f => f.name);
      const expect = [];
      for (const [sp, fmts] of [['rgb', ['png', 'jpg', 'svg', 'eps']], ['cmyk', ['jpg', 'eps']]])
        for (const tr of ['color', 'grayscale']) for (const f of fmts)
          expect.push(`${stem}-Exports/${sp.toUpperCase()}/${tr.toUpperCase()}/${stem}-${sp}-${tr}.${f}`);
      const missing = expect.filter(e => !names.includes(e));
      assert(!missing.length, 'missing ' + missing.join(', '));
      assert(names.includes(`${stem}-Exports/README.txt`), 'no README');
      return `${names.length} entries`;
    });
    const exDir = join(OUT, currentTool, stem + '-unzipped'); rmSync(exDir, { recursive: true, force: true }); mkdirSync(exDir, { recursive: true });
    const expW = c.w >= c.h ? 800 : Math.round(c.w * 800 / c.h), expH = c.w >= c.h ? Math.round(c.h * 800 / c.w) : 800;
    let rgbJpgMean = {};
    for (const f of files) {
      const buf = await f.async('nodebuffer');
      const local = join(exDir, basename(f.name)); writeFileSync(local, buf);
      const ext = extname(f.name).slice(1), gray = /GRAYSCALE/.test(f.name), cmyk = /\/CMYK\//.test(f.name);
      const label = `${c.file}: ${f.name.split('/').slice(1).join('/')}`;
      if (ext === 'png') await check(label, async () => {
        const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
        assert(w === expW && h === expH, `${w}×${h}, expected ${expW}×${expH}`);
        assert(st.std > 1, 'blank');
        if (gray) assert(st.gray, 'not grayscale');
        if (c.alpha) assert(st.transparent > 0.05, 'transparency lost');
        return `${w}×${h}${gray ? ' gray' : ''}${c.alpha ? `, ${Math.round(st.transparent * 100)}% transparent` : ''}`;
      });
      else if (ext === 'jpg') await check(label, async () => {
        const j = jpegInfo(buf); const st = await imgStats(buf, 'image/jpeg');
        assert(j.w === expW && j.h === expH, `${j.w}×${j.h}`);
        assert(st.std > 1, 'blank');
        if (cmyk) {
          assert(j.comps === 4 && j.adobe, `components=${j.comps}, Adobe APP14=${j.adobe}`);
          const ref = rgbJpgMean[gray ? 'g' : 'c'];
          if (ref) { const d = Math.max(...ref.map((v, i) => Math.abs(v - st.mean[i]))); assert(d < 25, `CMYK decodes to mean ${st.mean} vs RGB ${ref}`); }
        } else { assert(j.comps === (gray ? 3 : 3), 'components ' + j.comps); rgbJpgMean[gray ? 'g' : 'c'] = st.mean; }
        if (gray) assert(st.gray, 'not grayscale');
        return `${j.w}×${j.h}, ${j.comps} ch${j.adobe ? ' + Adobe APP14' : ''}, mean rgb ${st.mean}`;
      });
      else if (ext === 'svg') await check(label, async () => {
        const txt = buf.toString();
        const st = await imgStats(buf, 'image/svg+xml');
        assert(st.std > 1, 'renders blank');
        const kind = /<image/.test(txt) ? 'raster-in-SVG' : 'vector';
        if (c.vector) assert(kind === 'vector', 'vector source exported as raster');
        if (kind === 'raster-in-SVG') assert(/xlink:href="data:image\/png/.test(txt), 'raster SVG lacks xlink:href');
        if (gray) assert(/feColorMatrix/.test(txt) && st.gray, 'gray filter missing or not gray');
        return `${kind}, renders ${st.w}×${st.h}${gray ? ' gray' : ''}`;
      });
      else if (ext === 'eps') await check(label, async () => {
        const r = await validateEps(local, c.vector ? { sourceSvg: readFileSync(join(FX, c.file)), mask: cmyk } : {});
        const txt = buf.toString('latin1');
        if (cmyk) assert(/setcmykcolor|false 4 colorimage/.test(txt), 'CMYK EPS has no CMYK operators');
        const kind = /colorimage/.test(txt) ? 'raster EPS' : 'vector EPS';
        if (!r.rendered) throw new Warn(`${kind}; header ok, not rendered (no Ghostscript)`);
        if (r.diff != null && !gray && r.diff > 0.02) throw new Error(`${kind} renders, but differs from the source SVG on ${(r.diff * 100).toFixed(1)}% of pixels${cmyk ? ' (shape coverage)' : ''}`);
        return `${kind}, Ghostscript renders ${r.w}×${r.h}${r.diff != null ? `, ${(r.diff * 100).toFixed(1)}% px differ from source` : ''}`;
      });
      else if (ext === 'txt') await check(`${c.file}: README.txt`, async () => {
        const t = buf.toString();
        if (/McCANN/i.test(t)) throw new Warn('valid, but says "McCANN Export" (strip in port)');
        return 'ok';
      });
    }
  }

  // Targeted EPS fidelity probes: call the tool's own epsFromSvg on minimal SVGs.
  if (HAS_GS) {
    const probes = [
      ['fill="none" stroke-only path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 L90 10 L90 90 Z" fill="none" stroke="#000" stroke-width="4"/></svg>', [70, 40], 'white'],
      ['fill-rule="evenodd" hole', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0H100V100H0Z M30 30H70V70H30Z" fill="#000" fill-rule="evenodd"/></svg>', [50, 50], 'white'],
      ['<g transform> translate', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50 0)"><rect x="0" y="0" width="50" height="100" fill="#000"/></g></svg>', [75, 50], 'black'],
      ['CSS class fill', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.a{fill:#ff0000}</style><rect class="a" width="100" height="100"/></svg>', [50, 50], 'red'],
      ['rect rx (rounded corners)', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="40" fill="#000"/></svg>', [3, 3], 'white'],
      ['<text> element', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="5" y="80" font-size="90" font-weight="bold">W</text></svg>', [], 'nonblank'],
    ];
    for (const [name, svg, [px, py], want] of probes) {
      await check(`EPS fidelity: ${name}`, async () => {
        const eps = await page.evaluate(async s => { const b = epsFromSvg(s, {}); return b ? await b.text() : null; }, svg);
        const f = join(OUT, currentTool, 'probe-' + name.replace(/\W+/g, '-') + '.eps'); writeFileSync(f, eps);
        const png = gsRender(f);
        const pix = await vp.evaluate(async ({ b64, px, py }) => {
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const bm = await createImageBitmap(new Blob([bytes]));
          const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
          const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
          const all = x.getImageData(0, 0, c.width, c.height).data; let dark = 0;
          for (let i = 0; i < all.length; i += 4) if (all[i] + all[i + 1] + all[i + 2] < 600) dark++;
          return { p: px == null ? null : [...x.getImageData(px, py, 1, 1).data].slice(0, 3), dark };
        }, { b64: png.toString('base64'), px, py });
        const is = { white: p => p.every(v => v > 230), black: p => p.every(v => v < 30), red: p => p[0] > 200 && p[1] < 60 && p[2] < 60 };
        if (want === 'nonblank') { assert(pix.dark > 0, 'text dropped: EPS renders blank'); return 'rendered'; }
        assert(is[want](pix.p), `pixel (${px},${py}) is rgb(${pix.p}), expected ${want}`);
        return `pixel is ${want}`;
      });
    }
  }
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   MESH-GRADIENT
   ================================================================ */
async function testMeshGradient(ctx) {
  const { page, errors } = await openTool(ctx, '/mesh-gradient/');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  const canvasStats = async () => {
    const url = await page.evaluate(() => document.getElementById('cv').toDataURL('image/png'));
    return { url, ...(await imgStats(Buffer.from(url.split(',')[1], 'base64'), 'image/png')) };
  };
  await check('Preview renders a non-flat gradient on load', async () => {
    const s = await canvasStats(); assert(s.std > 5, 'flat canvas std ' + s.std.toFixed(1));
    return `canvas ${s.w}×${s.h}, luminance σ ${s.std.toFixed(1)}`;
  });
  await shot(page, 'mesh-gradient-default');
  const fams = await page.$$eval('.modes button', bs => bs.map(b => [b.dataset.m, b.textContent]));
  for (const [fam, label] of fams) {
    await page.click(`.modes button[data-m="${fam}"]`);
    const vars = await page.$$eval('#vars option', os => os.map(o => o.value));
    await check(`Family "${label}": all variants render (${vars.join(', ')})`, async () => {
      const out = [];
      for (const v of vars) {
        await page.selectOption('#vars', v);
        const s = await canvasStats();
        assert(s.std > 3, `${v} flat (σ ${s.std.toFixed(1)})`);
        out.push(`${v} σ${s.std.toFixed(0)}`);
      }
      return out.join(', ');
    });
  }
  await check('Element selection (Told/Spheres): click picks an element, stops edit it', async () => {
    await page.click('.modes button[data-m="TOLD"]'); await page.selectOption('#vars', 'spheres');
    const before = (await canvasStats()).url;
    // Click the centre of a sphere: N = 2 + round(density), r = W/N/2*.99, centres at (i*2r, r).
    const box = await page.locator('#cv').boundingBox();
    const den = Number(await page.inputValue('#den')), N = 2 + Math.round(den), r = box.width / N / 2 * 0.99;
    await page.mouse.click(box.x + 4 * r, box.y + r);
    const hl = await page.$$eval('#ov circle', cs => cs.filter(c => c.getAttribute('stroke-width') === '2.5').length);
    assert(hl === 1, 'no highlight drawn');
    await page.$eval('#stops input', i => { i.value = '#00ff00'; i.dispatchEvent(new Event('input')); });
    const after = (await canvasStats()).url;
    assert(before !== after, 'canvas unchanged after stop edit');
    return 'highlight + per-element recolor';
  });
  await check('Sliders (density/angle/blur/grain) redraw the preview', async () => {
    await page.click('.modes button[data-m="TRUTH"]');
    const a = (await canvasStats()).url;
    for (const [id, v] of [['den', 9], ['ang', 200], ['soft', 60], ['grain', 10]])
      await page.$eval('#' + id, (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }, v);
    const b = (await canvasStats()).url;
    assert(a !== b, 'unchanged'); return 'redraws';
  });
  await check('Randomize changes the output', async () => {
    const a = (await canvasStats()).url; await page.click('#rand'); const b = (await canvasStats()).url;
    assert(a !== b, 'unchanged'); return 'changes';
  });
  await check('Play animates, Stop returns to still', async () => {
    await page.$eval('#drift', el => { el.value = 60; el.dispatchEvent(new Event('input')); });
    await page.click('#play'); await page.waitForTimeout(400);
    const a = (await canvasStats()).url; await page.waitForTimeout(300); const b = (await canvasStats()).url;
    await page.click('#play');
    assert(a !== b, 'frames identical'); assert((await page.textContent('#play')) === 'Play', 'button stuck on Stop');
    await page.$eval('#drift', el => { el.value = 0; el.dispatchEvent(new Event('input')); });
    return 'animates';
  });
  for (const [ratio, ew, eh] of [['16:9', 3840, 2160], ['4:5', 2160, 2700], ['9:16', 2160, 3840]]) {
    await page.click(`#ratios button[data-r="${ratio}"]`);
    await check(`Export .png at ${ratio} → ${ew}×${eh}`, async () => {
      const f = await download(page, () => page.click('#png'));
      const buf = readFileSync(f); const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
      assert(w === ew && h === eh, `${w}×${h}`); assert(st.std > 3, 'flat');
      return `${basename(f)} ${w}×${h}`;
    });
  }
  await page.click('#ratios button[data-r="16:9"]');
  await check('Export .jpeg → 3840×2160', async () => {
    const f = await download(page, () => page.click('#jpg'));
    const j = jpegInfo(readFileSync(f)); assert(j.w === 3840 && j.h === 2160, `${j.w}×${j.h}`);
    return `${basename(f)} ${j.w}×${j.h}`;
  });
  await check('Export .gif → 40-frame 720×405 loop', async () => {
    const f = await download(page, () => page.click('#gif'), 180000);
    const buf = readFileSync(f);
    assert(buf.slice(0, 6).toString() === 'GIF89a', 'not GIF89a');
    const info = await vp.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const d = new ImageDecoder({ data: bytes, type: 'image/gif' }); await d.tracks.ready;
      const fr = await d.decode({ frameIndex: 0 });
      return { frames: d.tracks.selectedTrack.frameCount, w: fr.image.displayWidth, h: fr.image.displayHeight };
    }, buf.toString('base64'));
    assert(info.frames === 40 && info.w === 720 && info.h === 405, JSON.stringify(info));
    return `${basename(f)} ${info.w}×${info.h}, ${info.frames} frames, ${(buf.length / 1024).toFixed(0)} KB (gif.js from CDN)`;
  });
  await check('UI labels: families are Truth / Well / Told', async () => {
    throw new Warn(`families labelled ${fams.map(f => f[1]).join(' / ')} (McCann tagline; rename to Conic / Field / Sphere in port)`);
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   COLOR-SWAP
   ================================================================ */
async function testColorSwap(ctx) {
  const { page, errors } = await openTool(ctx, '/color-swap/');
  await check('Loads with no console errors, WebGL2 renderer ok', async () => {
    assert(!errors.length, errors.join(' | '));
    const ok = await page.evaluate(() => window.app && window.app.renderer.ok);
    assert(ok, 'renderer not ok'); return 'clean, WebGL2 ok';
  });
  const waitAnalysis = (t = 60000) => page.waitForFunction(() => /Analysis complete|Analysis failed/.test(document.getElementById('statusText').textContent), null, { timeout: t });
  const grab = async () => {
    await page.waitForTimeout(250);
    const url = await page.evaluate(() => document.getElementById('outCanvas').toDataURL('image/png'));
    return Buffer.from(url.split(',')[1], 'base64');
  };

  // ---- still image ----
  await page.setInputFiles('#fileInput', join(FX, 'photo.jpg'));
  await check('photo.jpg: loads, analysis finds color families', async () => {
    await waitAnalysis();
    const st = await page.textContent('#statusText');
    assert(/Analysis complete/.test(st), st);
    const n = await page.locator('#clusterList > *').count();
    assert(n > 0, 'no clusters');
    return `${n} cluster rows; ${await page.textContent('#clusterNote')}`;
  });
  await check('Preview stage is visible at 1440×900', async () => {
    const m = await page.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect(), c = document.getElementById('outCanvas').getBoundingClientRect();
      const b = document.querySelector('[data-view="original"]'), r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { stageW: Math.round(st.width), canvas: `${Math.round(c.width)}×${Math.round(c.height)}`, viewBtnCovered: top !== b };
    });
    await shot(page, 'color-swap-loaded');
    assert(m.stageW > 400 && !m.viewBtnCovered, `stage ${m.stageW}px wide, canvas ${m.canvas}, view buttons covered=${m.viewBtnCovered}. nav.js flattens only known wrappers (.mx/.ada/.bb/.ms…) with display:contents; #recolor is missing, so the 3-panel app is squeezed into one 1/5 grid cell and body overflow is hidden`);
    return `stage ${m.stageW}px, canvas ${m.canvas}`;
  });
  await check('photo.jpg: recolored view differs from original; split view works', async () => {
    const view = v => page.$eval(`[data-view="${v}"]`, b => b.click()); // DOM click: buttons are covered (layout bug above)
    const rec = await grab();
    await view('original'); const orig = await grab();
    await view('split'); const split = await grab();
    await view('recolored');
    const a = await imgStats(rec, 'image/png'), b = await imgStats(orig, 'image/png');
    const d = await diffImages({ buf: rec, type: 'image/png' }, { buf: orig, type: 'image/png' }, 200, 133);
    const ds = await diffImages({ buf: split, type: 'image/png' }, { buf: orig, type: 'image/png' }, 200, 133);
    assert(d > 0.1, `only ${(d * 100).toFixed(1)}% of pixels changed`);
    assert(ds > 0.02 && ds < d, `split diff ${(ds * 100).toFixed(1)}%`);
    return `${(d * 100).toFixed(0)}% px recolored (mean ${b.mean} → ${a.mean}); split ${(ds * 100).toFixed(0)}%`;
  });
  await check('Presets apply settings (Graphic → strength 100)', async () => {
    await page.click('#presetGrid button:has-text("Graphic")');
    const v = await page.inputValue('#set_strength'); assert(v === '100', 'strength ' + v);
    await page.click('#presetGrid button:has-text("Balanced")');
    return 'ok';
  });
  await check('Add rule', async () => {
    await page.click('#btnAddRule'); const t = await page.textContent('#ruleCount');
    assert(/^1 rule/.test(t), t); return t;
  });
  await check('Import palette modal replaces palette', async () => {
    await page.click('#btnImportPalette');
    await page.fill('#importText', '#000000 #E8FF1A #FFFFFF');
    await page.click('#importApply');
    const t = await page.textContent('#paletteCount');
    assert(/^3 active/.test(t), t); return t;
  });
  await check('Modals close on Escape', async () => {
    await page.click('#btnImportPalette');
    await page.keyboard.press('Escape');
    const hidden = await page.$eval('#importModal', m => m.hidden);
    if (!hidden) await page.click('#importModal [data-close]');
    assert(hidden, 'Escape does nothing: handler queries ".overlay" but modals use class "rc-overlay"');
  });
  await check('Modals close on backdrop click', async () => {
    await page.click('#btnImportPalette');
    await page.mouse.click(5, 5);
    const hidden = await page.$eval('#importModal', m => m.hidden);
    if (!hidden) await page.click('#importModal [data-close]');
    assert(hidden, 'backdrop click does nothing (same ".overlay" selector bug)');
  });
  let presetFile;
  await check('Save preset .json downloads valid JSON', async () => {
    presetFile = await download(page, () => page.click('#btnSavePreset'));
    const j = JSON.parse(readText(presetFile));
    assert(j && typeof j === 'object', 'not an object');
    return `${basename(presetFile)} keys: ${Object.keys(j).join(', ')}`;
  });
  await check('Load preset .json restores state', async () => {
    await page.setInputFiles('#presetInput', presetFile);
    await page.waitForFunction(() => /Preset loaded|not a valid/.test(document.getElementById('toast').textContent));
    const t = await page.textContent('#toast'); assert(/Preset loaded/.test(t), t); return t;
  });
  const exportOnce = async (timeout) => {
    await page.click('#btnExport');
    await page.waitForSelector('#exportModal:not([hidden])');
    await page.click('#expStart');
    await page.waitForSelector('#expDownload:not([hidden])', { timeout });
    const f = await download(page, () => page.click('#expDownload'));
    const status = await page.textContent('#expStatus');
    await page.click('#expCancel');
    return { f, status };
  };
  await check('photo.jpg: export still → recolored PNG at original size', async () => {
    const { f, status } = await exportOnce(30000);
    const buf = readFileSync(f); const { w, h } = pngInfo(buf);
    assert(w === 1600 && h === 1067, `${w}×${h}`);
    const d = await diffImages({ buf, type: 'image/png' }, { buf: readFileSync(join(FX, 'photo.jpg')), type: 'image/jpeg' }, 200, 133);
    assert(d > 0.1, 'export not recolored');
    return `${basename(f)} ${w}×${h}, ${(d * 100).toFixed(0)}% px recolored; ${status}`;
  });

  // ---- PNG logo with transparency ----
  await page.setInputFiles('#fileInput', join(FX, 'logo.png'));
  await check('logo.png: loads and exports', async () => {
    await waitAnalysis();
    const { f } = await exportOnce(30000);
    const buf = readFileSync(f); const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
    assert(w === 1500 && h === 300, `${w}×${h}`);
    if (st.transparent < 0.01) throw new Warn(`${w}×${h}, but transparency is lost (background becomes ${st.mean.join(',')} mean); still path goes through a video stream with alpha:false`);
    return `${w}×${h}`;
  });

  // ---- video ----
  await page.setInputFiles('#fileInput', join(FX, 'clip.mp4'));
  await check('clip.mp4: loads (H.264/AAC), fps detected, analysis runs', async () => {
    await waitAnalysis(90000);
    const st = await page.textContent('#statusText'); assert(/Analysis complete/.test(st), st);
    const dur = await page.textContent('#timeDur');
    const fps = await page.evaluate(() => app.video.fps);
    return `duration ${dur}, ${fps} fps detected`;
  });
  await check('clip.mp4: renders recolored frames as the video moves', async () => {
    const seek = t => page.evaluate(t => new Promise(r => { const v = app.video.v; v.pause(); v.addEventListener('seeked', () => requestAnimationFrame(() => requestAnimationFrame(r)), { once: true }); v.currentTime = t; }), t);
    await seek(0.5); const a = await grab(); await seek(2.0); const b = await grab();
    const st = await imgStats(a, 'image/png'); assert(st.std > 5, 'blank output');
    const d = await diffImages({ buf: a, type: 'image/png' }, { buf: b, type: 'image/png' }, 160, 90);
    assert(d > 0.005, 'frames at 0.5 s and 2.0 s render identically'); return `${(d * 100).toFixed(1)}% px differ between 0.5 s and 2.0 s`;
  });
  await check('clip.mp4: export → WebM with video + audio, full duration', async () => {
    const { f, status } = await exportOnce(60000);
    const p = ffprobe(f);
    const v = p.streams.find(s => s.codec_type === 'video'), a = p.streams.find(s => s.codec_type === 'audio');
    assert(v && /vp8|vp9/.test(v.codec_name), 'no VP8/9 video');
    assert(v.width === 640 && v.height === 360, `${v.width}×${v.height}`);
    // MediaRecorder WebM often lacks a duration header; decode to count real duration.
    const decoded = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim();
    const frames = parseInt(decoded, 10);
    const durHeader = parseFloat(p.format.duration);
    assert(frames >= 60, `only ${frames} frames decoded`);
    const notes = [];
    if (!a) notes.push('no audio track');
    if (!isFinite(durHeader)) notes.push('WebM has no duration in header (seek bar unusable in some players)');
    const detail = `${basename(f)} ${v.codec_name} ${v.width}×${v.height}, ${frames} frames, audio ${a ? a.codec_name : 'none'}; ${status}`;
    if (notes.length) throw new Warn(detail + ' — ' + notes.join('; '));
    return detail;
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   MOOD-STRIP
   ================================================================ */
async function testMoodStrip(ctx) {
  const { page, errors } = await openTool(ctx, '/mood-strip/');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  const count = () => page.textContent('#count');
  const waitCount = n => page.waitForFunction(n => document.getElementById('count').textContent.startsWith(n + ' '), n);

  await check('Add images (file picker): PNG + JPG', async () => {
    await page.setInputFiles('#file-input', [join(FX, 'logo.png'), join(FX, 'photo.jpg')]);
    await waitCount(2);
    await page.waitForFunction(() => [...document.querySelectorAll('.card-dim')].every(d => /×/.test(d.textContent)));
    const dims = await page.$$eval('.card-dim', ds => ds.map(d => d.textContent));
    assert(dims[0] === '1500 × 300' && dims[1] === '1600 × 1067', dims.join(', '));
    return `${await count()}: ${dims.join(', ')}`;
  });
  await shot(page, 'mood-strip-two-refs');
  await check('Palette: 5 swatches extracted from the photo', async () => {
    const card = page.locator('.card').nth(1);
    await card.locator('.icon-btn[title="Colors"]').click();
    await card.locator('.palette.open .sw').first().waitFor();
    const hex = await card.locator('.sw-hex').allTextContents();
    assert(hex.length === 5 && hex.every(h => /^[0-9A-F]{6}$/.test(h)), hex.join(','));
    return hex.join(' ');
  });
  await check('Copy all / Copy as CSS put hex codes on the clipboard', async () => {
    const card = page.locator('.card').nth(1);
    await card.locator('.mini:has-text("Copy all")').click();
    const a = await page.evaluate(() => navigator.clipboard.readText());
    await card.locator('.mini:has-text("Copy as CSS")').click();
    const b = await page.evaluate(() => navigator.clipboard.readText());
    assert(a.split('\n').length === 5 && /^:root \{\n  --color-1: #/.test(b), JSON.stringify([a, b]));
    return 'ok';
  });
  await check('Save downloads the original file bytes', async () => {
    const f = await download(page, () => page.locator('.card').nth(1).locator('.icon-btn[title="Save"]').click());
    assert(readFileSync(f).equals(readFileSync(join(FX, 'photo.jpg'))), 'bytes differ');
    return basename(f) + ' (byte-identical)';
  });
  await check('Paste an image from the clipboard', async () => {
    await page.evaluate(async () => {
      const b = await (await fetch('/__fixtures/logo.png')).blob();
      const dt = new DataTransfer(); dt.items.add(new File([b], 'pasted.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
    });
    await waitCount(3); return await count();
  });
  await check('Paste a link: WordPress-style thumb URL upgrades to full size', async () => {
    await page.evaluate(() => {
      const dt = new DataTransfer(); dt.setData('text/plain', location.origin + '/__fixtures/photo-300x200.jpg');
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
    });
    await waitCount(4);
    await page.waitForFunction(() => /1600 × 1067/.test(document.querySelectorAll('.card-dim')[3].textContent));
    return 'photo-300x200.jpg → photo.jpg, 1600 × 1067';
  });
  await check('"Paste link" button (prompt) adds a ref', async () => {
    page.once('dialog', d => d.accept(BASE + '/__fixtures/logo.png'));
    await page.click('#btn-link'); await waitCount(5); return await count();
  });
  await check('Drop a file onto the strip', async () => {
    await page.evaluate(async () => {
      const b = await (await fetch('/__fixtures/photo.jpg')).blob();
      const dt = new DataTransfer(); dt.items.add(new File([b], 'dropped.jpg', { type: 'image/jpeg' }));
      document.getElementById('app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await waitCount(6); return await count();
  });
  await check('Drag to reorder cards', async () => {
    const before = await page.$$eval('.card', cs => cs.map(c => c.dataset.id));
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.card'); const dt = new DataTransfer();
      cards[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const r = cards[2].getBoundingClientRect();
      cards[2].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: r.bottom - 2 }));
    });
    const after = await page.$$eval('.card', cs => cs.map(c => c.dataset.id));
    assert(after[2] === before[0], `${before} → ${after}`); return `${before.join(',')} → ${after.join(',')}`;
  });
  await check('Remove a ref', async () => {
    await page.locator('.card').last().locator('.icon-btn[title="Remove"]').click();
    await waitCount(5); return await count();
  });
  await check('Board persists across reload (IndexedDB)', async () => {
    await page.waitForTimeout(700); await page.reload({ waitUntil: 'networkidle' });
    await waitCount(5); return await count();
  });
  await check('Pop out opens a separate window with the image', async () => {
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.locator('.card').first().locator('.icon-btn[title="Pop out"]').click()]);
    await pop.waitForFunction(() => { const i = document.querySelector('.float-body img'); return i && i.naturalWidth > 0; });
    const w = await pop.evaluate(() => document.querySelector('.float-body img').naturalWidth);
    await pop.close(); return `popup image ${w}px wide`;
  });
  await check('Float (Document PiP) moves the strip into an always-on-top window and back', async () => {
    assert(await page.isVisible('#btn-float'), 'Float button hidden in Chrome');
    await page.click('#btn-float');
    await page.waitForFunction(() => documentPictureInPicture.window && documentPictureInPicture.window.document.getElementById('strip'), null, { timeout: 5000 });
    const inPip = await page.evaluate(() => documentPictureInPicture.window.document.querySelectorAll('.card').length);
    const label = await page.textContent('#btn-float');
    const placeholder = await page.evaluate(() => /Strip is floating/.test(document.body.textContent));
    await page.click('#btn-float');
    await page.waitForFunction(() => !documentPictureInPicture.window && document.getElementById('strip'));
    assert(inPip === 5 && label === 'Return strip' && placeholder, `${inPip} cards in PiP, label "${label}"`);
    return `${inPip} cards floated, returned to page`;
  });
  await check('Clear (confirm) empties the board', async () => {
    page.once('dialog', d => d.accept()); await page.click('#btn-clear'); await waitCount(0); return await count();
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

async function testMoodStripElsewhere(chromeBrowser) {
  // 1) Chrome with Document PiP removed: the code path every non-Chromium browser takes.
  {
    const ctx = await chromeBrowser.newContext();
    await ctx.addInitScript(() => { delete window.documentPictureInPicture; delete Window.prototype.documentPictureInPicture; });
    const { page, errors } = await openTool(ctx, '/mood-strip/');
    await check('No-PiP browser (simulated): Float degrades', async () => {
      const pip = await page.evaluate(() => 'documentPictureInPicture' in window);
      const visible = await page.isVisible('#btn-float');
      await page.setInputFiles('#file-input', join(FX, 'photo.jpg'));
      await page.waitForFunction(() => document.getElementById('count').textContent.startsWith('1 '));
      assert(!pip && !visible && !errors.length, `PiP=${pip}, Float visible=${visible}, errors=${errors.join('|')}`);
      throw new Warn('Float button is hidden and the board still works, but there is no popup fallback for the whole strip (CLAUDE.md asks for one in the port)');
    });
    await ctx.close();
  }
  // 2) Real Firefox and WebKit, when they run on this machine.
  for (const [name, type] of [['Firefox', firefox], ['WebKit (Safari engine)', webkit]]) {
    let b;
    try { b = await type.launch(); }
    catch (e) { await check(`${name}: loads, Float behaviour`, () => { throw new Warn(`could not launch on this macOS (${e.message.split('\n')[0].slice(0, 80)}); covered by the simulated no-PiP check`); }); continue; }
    const ctx = await b.newContext();
    const { page, errors } = await openTool(ctx, '/mood-strip/');
    await check(`${name}: loads, add image, Float behaviour`, async () => {
      await page.setInputFiles('#file-input', join(FX, 'photo.jpg'));
      await page.waitForFunction(() => document.getElementById('count').textContent.startsWith('1 '));
      const pip = await page.evaluate(() => 'documentPictureInPicture' in window);
      const visible = await page.isVisible('#btn-float');
      let float = 'n/a';
      if (visible) {
        await page.click('#btn-float');
        await page.waitForTimeout(1500);
        float = await page.evaluate(() => !!(window.documentPictureInPicture && documentPictureInPicture.window) ? 'opened' : 'did not open');
        const toast = await page.textContent('#toast');
        if (float !== 'opened') float += toast ? ` (toast: "${toast}")` : '';
      }
      const errs = errors.filter(e => !/fonts\.g/.test(e));
      const detail = `${await page.evaluate(() => navigator.userAgent.match(/(Firefox|Version)\/[\d.]+/)?.[0])}; PiP API=${pip}, Float button ${visible ? 'shown' : 'hidden'}, Float ${float}`;
      assert(!errs.length, detail + '; console: ' + errs.join(' | '));
      if (visible && float !== 'opened') throw new Error(detail);
      return detail;
    });
    await b.close();
  }
}

/* ---------------- main ---------------- */
const TOOLS = {
  'color-check': testColorCheck,
  'multi-export': testMultiExport,
  'mesh-gradient': testMeshGradient,
  'color-swap': testColorSwap,
  'mood-strip': testMoodStrip,
};

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = await serve(PORT);
// Real Chrome (not Playwright's Chromium) so H.264 and Document PiP match what users run.
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
vp = await ctx.newPage(); await vp.goto(BASE + '/__blank');
console.log(`Chrome ${browser.version()} · Ghostscript ${HAS_GS ? 'yes' : 'NO (EPS only header-checked)'}`);

for (const [id, fn] of Object.entries(TOOLS)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  currentTool = id; console.log(`\n${id}`);
  try { await fn(ctx); } catch (e) { results.push({ tool: id, check: 'runner', status: 'fail', detail: e.message.split('\n')[0] }); log('fail', 'runner crashed', e.message.split('\n')[0]); }
  if (id === 'mood-strip') await testMoodStripElsewhere(browser);
}
await browser.close(); server.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ chrome: browser.version(), ghostscript: HAS_GS, results }, null, 2));
const tally = s => results.filter(r => r.status === s).length;
console.log(`\n${tally('pass')} pass · ${tally('warn')} warn · ${tally('fail')} fail`);
