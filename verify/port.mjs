// Port verification: rerun every check the reference tool passed (verify/run.mjs) against the
// Lathe port, plus the bug fixes promised in VERIFY.md. Serves the production build (vite preview).
// Usage: npm run verify:port   or   node verify/port.mjs [color-check multi-export]
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HAS_GS, state, assert, Warn, check, openPage, download, pngInfo, jpegInfo,
  imgStats, diffImages, gsRender, validateEps, readText,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FX = join(HERE, 'fixtures');
const OUT = join(HERE, 'out', 'port');
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = process.argv.slice(2);
const MOD = 'Meta';
state.out = OUT;

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/')).ok) return proc; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill(); throw new Error('vite preview did not start');
}
const trayCount = async page => Number(await page.textContent('[data-testid="tray-count"]'));
const chip = (page, text) => page.locator('.inspector .l-chip', { hasText: new RegExp(`^${text.replace(/[.+]/g, '\\$&')}$`) }).first();

/* ================================================================
   COLOR-CHECK
   ================================================================ */
async function testColorCheck(ctx) {
  const { page, errors } = await openPage(ctx, BASE + '/t/color-check');
  await page.waitForSelector('.cc');
  const input = page.locator('.inspector textarea');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await check('Empty state shown before input', async () => {
    assert(/Paste hex codes/.test(await page.textContent('.cc__matrix')), 'no empty state');
  });
  await input.fill('#E8FF1A, #000000\nFFFFFF #2B2BE6 #ff2e7e #fff');
  await check('Parses pasted hex (mixed separators, no #, 3-digit, dedupe)', async () => {
    const t = await page.textContent('.inspector .l-section:first-child .l-note');
    const cells = await page.locator('td.cell').count();
    assert(/5 colors · 20 pairings/.test(t) && cells === 20, `${t}, ${cells} cells`);
    return t;
  });
  await check('WCAG 2.2 ratios correct (black/white 21.00 AAA; #2B2BE6 on white)', async () => {
    const v = (await page.textContent('td.cell[title^="fg #000000 on bg #FFFFFF"] .val')).trim();
    const title = await page.getAttribute('td.cell[title^="fg #000000 on bg #FFFFFF"]', 'title');
    assert(v === '21.00' && /AAA/.test(title), `black/white = ${v}`);
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const exp = ((lum('#FFFFFF') + 0.05) / (lum('#2B2BE6') + 0.05)).toFixed(2);
    const got = (await page.textContent('td.cell[title^="fg #2B2BE6 on bg #FFFFFF"] .val')).trim();
    assert(got === exp, `${got} vs ${exp}`);
    const s = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' '));
    assert(/Pass10/.test(s) && /Large only4/.test(s) && /Fail6/.test(s) && /Usable50%/.test(s), s);
    return `#2B2BE6/white ${got}; ${s}`;
  });
  await check('APCA mode: black on white ≈ +106, white on black ≈ −108', async () => {
    await chip(page, 'APCA WCAG 3').click();
    const a = (await page.textContent('td.cell[title^="fg #000000 on bg #FFFFFF"] .val')).trim();
    const b = (await page.textContent('td.cell[title^="fg #FFFFFF on bg #000000"] .val')).trim();
    await chip(page, 'WCAG 2.2').click();
    assert(a === '+106' && b === '-108', `${a}, ${b}`); return `${a}, ${b}`;
  });
  await check('"Show only AAA" dims cells below threshold', async () => {
    await chip(page, 'AAA').click();
    const op = await page.$$eval('td.cell', tds => tds.map(t => t.style.opacity));
    const dim = op.filter(o => o === '0.12').length;
    await chip(page, 'All').click();
    assert(dim === 12, `${dim}/20`); return `${dim}/${op.length} dimmed`;
  });
  await check('Auto-repair modal suggests a ≥4.5 fix; closes on Escape (shared modal)', async () => {
    await page.click('td.cell[data-fg="#E8FF1A"][data-bg="#FFFFFF"]');
    await page.waitForSelector('.l-modal .cc-repair');
    const ratios = await page.$$eval('.cc-repair__ratio', els => els.map(e => parseFloat(e.textContent)));
    const hexes = await page.$$eval('.cc-repair__hex', els => els.map(e => e.textContent));
    await page.keyboard.press('Escape');
    assert(!(await page.$('.l-modal')), 'Escape did not close');
    assert(ratios.length && ratios.every(r => r >= 4.5), 'ratios ' + ratios);
    assert(hexes[0] === '#6E7D00', 'repair differs from reference: ' + hexes);
    return hexes.map((h, i) => `${h} → ${ratios[i]}`).join(', ');
  });
  let svgFile;
  await check('Export .svg downloads a valid, renderable SVG matrix and lands in the tray', async () => {
    const before = await trayCount(page);
    await chip(page, '.svg').click();
    svgFile = await download(page, () => page.click('.inspector .l-btn--primary'));
    const txt = readText(svgFile);
    const st = await imgStats(Buffer.from(txt), 'image/svg+xml');
    const rows = (txt.match(/<g id="row-/g) || []).length;
    assert(rows === 5 && st.std > 5, `${rows} rows, σ ${st.std}`);
    await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) === n + 1, before);
    return `${basename(svgFile)} ${st.w}×${st.h}, 5 rows, tray +1`;
  });
  await check('Export .html downloads a standalone report with 20 cells (no CDN font link)', async () => {
    await chip(page, '.html').click();
    const f = await download(page, () => page.click('.inspector .l-btn--primary'));
    const html = readText(f);
    const cells = (html.match(/<td class="cell/g) || []).length;
    assert(html.startsWith('<!DOCTYPE html>') && cells === 20 && /class="stats"/.test(html), `${cells} cells`);
    assert(!/fonts\.googleapis/.test(html), 'still links Google Fonts');
    await chip(page, '.svg').click();
    return `${basename(f)}, ${cells} cells`;
  });
  await check(`Repeat exports get unique names (${MOD}+E)`, async () => {
    const f = await download(page, () => page.keyboard.press(`${MOD}+e`));
    assert(basename(f) !== basename(svgFile), basename(f)); return `${basename(svgFile)} → ${basename(f)}`;
  });
  await check('Uploaded chart font is embedded in the SVG export', async () => {
    await page.setInputFiles('.inspector input[type=file]', join(ROOT, 'reference', 'mood-strip', 'fonts', 'inter-latin.woff2'));
    await page.waitForFunction(() => /Embedded/.test(document.querySelector('.inspector').textContent));
    const f = await download(page, () => page.click('.inspector .l-btn--primary'));
    assert(/@font-face\{font-family:'inter-latin';src:url\('data:/.test(readText(f)), 'no @font-face');
    return 'font-face data URL embedded';
  });
  await check('Palette, standard and font persist across reload', async () => {
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('td.cell');
    const v = await input.inputValue();
    const font = await page.locator('.inspector .l-chip.is-active', { hasText: 'inter-latin' }).count();
    assert(/2B2BE6/.test(v) && font === 1, `input ${JSON.stringify(v.slice(0, 20))}, font chip ${font}`);
    return 'restored';
  });
  await check('Invalid input falls back to empty state', async () => {
    await input.fill('zzz not a color 12');
    assert(/Paste hex codes/.test(await page.textContent('.cc__matrix')), 'matrix rendered for junk');
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   MULTI-EXPORT
   ================================================================ */
async function exportZip(page) {
  const before = await trayCount(page);
  const f = await download(page, () => page.click('.inspector .l-btn--primary'), 120000);
  await page.waitForFunction(() => /Export completed/.test(document.querySelector('.inspector [role=status]').textContent), null, { timeout: 120000 });
  await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) === n + 1, before);
  return f;
}

async function testMultiExport(ctx) {
  const { page, errors } = await openPage(ctx, BASE + '/t/multi-export');
  await page.waitForSelector('.mx');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await check('Export disabled until a file is loaded', async () => { assert(await page.isDisabled('.inspector .l-btn--primary'), 'enabled'); });

  const cases = [
    { file: 'logo.png', w: 1500, h: 300, vector: false, alpha: true },
    { file: 'logo.svg', w: 600, h: 200, vector: true },
    { file: 'photo.jpg', w: 1600, h: 1067, vector: false },
  ];
  for (const c of cases) {
    const stem = c.file.replace(/\.[^.]+$/, '');
    await page.setInputFiles('.mx input[type=file]', join(FX, c.file));
    await check(`${c.file}: loads, shows name/dims/size`, async () => {
      await page.waitForFunction(n => document.querySelector('[data-testid="status-file"]').textContent.startsWith(n + '  '), c.file);
      const st = await page.textContent('[data-testid="status-file"]');
      assert(st.includes(`${c.w}×${c.h}`), st);
      return st;
    });
    await page.fill('input[aria-label="Raster size in pixels"]', '800');
    await page.keyboard.press('Tab');
    let zipFile;
    const ok = await check(`${c.file}: .zip downloads and lands in the tray`, async () => {
      zipFile = await exportZip(page);
      return `${basename(zipFile)} — ${await page.textContent('.inspector [role=status]')}`;
    });
    if (!ok) continue;
    const zip = await JSZip.loadAsync(readFileSync(zipFile));
    const files = Object.values(zip.files).filter(f => !f.dir);
    await check(`${c.file}: zip has 12 files + README in RGB/CMYK × COLOR/GRAYSCALE`, async () => {
      const names = files.map(f => f.name), expect = [];
      for (const [sp, fmts] of [['rgb', ['png', 'jpg', 'svg', 'eps']], ['cmyk', ['jpg', 'eps']]])
        for (const tr of ['color', 'grayscale']) for (const f of fmts) expect.push(`${stem}-Exports/${sp.toUpperCase()}/${tr.toUpperCase()}/${stem}-${sp}-${tr}.${f}`);
      const missing = expect.filter(e => !names.includes(e));
      assert(!missing.length, 'missing ' + missing.join(', '));
      assert(names.includes(`${stem}-Exports/README.txt`), 'no README');
      return `${names.length} entries`;
    });
    const exDir = join(OUT, state.tool, stem + '-unzipped'); rmSync(exDir, { recursive: true, force: true }); mkdirSync(exDir, { recursive: true });
    const expW = c.w >= c.h ? 800 : Math.round(c.w * 800 / c.h), expH = c.w >= c.h ? Math.round(c.h * 800 / c.w) : 800;
    const rgbJpgMean = {};
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const buf = await f.async('nodebuffer');
      const local = join(exDir, basename(f.name)); writeFileSync(local, buf);
      const ext = extname(f.name).slice(1), gray = /GRAYSCALE/.test(f.name), cmyk = /\/CMYK\//.test(f.name);
      const label = `${c.file}: ${f.name.split('/').slice(1).join('/')}`;
      if (ext === 'png') await check(label, async () => {
        const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
        assert(w === expW && h === expH, `${w}×${h}`); assert(st.std > 1, 'blank');
        if (gray) assert(st.gray, 'not grayscale');
        if (c.alpha) assert(st.transparent > 0.05, 'transparency lost');
        return `${w}×${h}${gray ? ' gray' : ''}`;
      });
      else if (ext === 'jpg') await check(label, async () => {
        const j = jpegInfo(buf); const st = await imgStats(buf, 'image/jpeg');
        assert(j.w === expW && j.h === expH, `${j.w}×${j.h}`); assert(st.std > 1, 'blank');
        if (cmyk) {
          assert(j.comps === 4 && j.adobe, `components=${j.comps}, APP14=${j.adobe}`);
          const ref = rgbJpgMean[gray ? 'g' : 'c'];
          if (ref) { const d = Math.max(...ref.map((v, i) => Math.abs(v - st.mean[i]))); assert(d < 25, `CMYK mean ${st.mean} vs RGB ${ref}`); }
        } else { assert(j.comps === 3, 'components ' + j.comps); rgbJpgMean[gray ? 'g' : 'c'] = st.mean; }
        if (gray) assert(st.gray, 'not grayscale');
        return `${j.w}×${j.h}, ${j.comps} ch${j.adobe ? ' + APP14' : ''}`;
      });
      else if (ext === 'svg') await check(label, async () => {
        const txt = buf.toString(); const st = await imgStats(buf, 'image/svg+xml');
        assert(st.std > 1, 'renders blank');
        const kind = /<image/.test(txt) ? 'raster-in-SVG' : 'vector';
        if (c.vector) assert(kind === 'vector', 'vector source exported as raster');
        if (kind === 'raster-in-SVG') assert(/xlink:href="data:image\/png/.test(txt), 'no xlink:href');
        if (gray) assert(/feColorMatrix/.test(txt) && st.gray, 'gray filter');
        return `${kind}, ${st.w}×${st.h}`;
      });
      else if (ext === 'eps') await check(label, async () => {
        const r = await validateEps(local, c.vector ? { sourceSvg: readFileSync(join(FX, c.file)), mask: cmyk } : {});
        const txt = buf.toString('latin1');
        if (cmyk) assert(/setcmykcolor|false 4 colorimage/.test(txt), 'no CMYK operators');
        assert(/%%Creator: Lathe Multi-export/.test(txt), 'creator not Lathe');
        const kind = /colorimage/.test(txt) ? 'raster EPS' : 'vector EPS';
        if (!r.rendered) throw new Warn(`${kind}; not rendered (no Ghostscript)`);
        if (r.diff != null && !gray && r.diff > 0.02) throw new Error(`${kind} differs from the source SVG on ${(r.diff * 100).toFixed(1)}% of pixels`);
        return `${kind}, Ghostscript ${r.w}×${r.h}${r.diff != null ? `, ${(r.diff * 100).toFixed(1)}% px differ` : ''}`;
      });
      else if (ext === 'txt') await check(`${c.file}: README.txt says Lathe, not McCann`, async () => {
        const t = buf.toString();
        assert(!/mccann/i.test(t) && /Lathe Multi-export/.test(t), 'McCann string present');
        return 'ok';
      });
    }
  }

  // EPS fidelity probes, end to end through the UI: load each SVG, export EPS only (rgb, color).
  if (HAS_GS) {
    for (const t of ['.png', '.jpg', '.svg']) await chip(page, t).click();
    await chip(page, 'cmyk').click();
    await chip(page, 'Grayscale').click();
    const probes = [
      ['fill="none" stroke-only path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 L90 10 L90 90 Z" fill="none" stroke="#000" stroke-width="4"/></svg>', [70, 40], 'white'],
      ['fill-rule="evenodd" hole', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0H100V100H0Z M30 30H70V70H30Z" fill="#000" fill-rule="evenodd"/></svg>', [50, 50], 'white'],
      ['<g transform> translate', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50 0)"><rect x="0" y="0" width="50" height="100" fill="#000"/></g></svg>', [75, 50], 'black'],
      ['CSS class fill', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.a{fill:#ff0000}</style><rect class="a" width="100" height="100"/></svg>', [50, 50], 'red'],
      ['rect rx (rounded corners)', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="40" fill="#000"/></svg>', [3, 3], 'white'],
      ['<text> element', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="5" y="80" font-size="90" font-weight="bold">W</text></svg>', [], 'nonblank'],
      ['arc command', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 50 A40 40 0 0 1 90 50 Z" fill="#000"/></svg>', [50, 20], 'black'],
    ];
    const probeDir = join(OUT, state.tool, 'probes'); mkdirSync(probeDir, { recursive: true });
    for (const [name, svg, [px, py], want] of probes) {
      await check(`EPS fidelity: ${name}`, async () => {
        const svgPath = join(probeDir, name.replace(/\W+/g, '-') + '.svg'); writeFileSync(svgPath, svg);
        await page.setInputFiles('.mx input[type=file]', svgPath);
        await page.waitForFunction(n => document.querySelector('[data-testid="status-file"]').textContent.startsWith(n), basename(svgPath));
        const zipFile = await exportZip(page);
        const zip = await JSZip.loadAsync(readFileSync(zipFile));
        const epsEntry = Object.values(zip.files).find(f => f.name.endsWith('.eps'));
        const epsPath = svgPath.replace(/\.svg$/, '.eps'); writeFileSync(epsPath, await epsEntry.async('nodebuffer'));
        const png = gsRender(epsPath);
        const pix = await state.vp.evaluate(async ({ b64, px, py }) => {
          const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
          const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
          const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
          const all = x.getImageData(0, 0, c.width, c.height).data; let dark = 0;
          for (let i = 0; i < all.length; i += 4) if (all[i] + all[i + 1] + all[i + 2] < 600) dark++;
          const sx = px == null ? null : Math.round(px * c.width / 100), sy = py == null ? null : Math.round(py * c.height / 100);
          return { p: sx == null ? null : [...x.getImageData(sx, sy, 1, 1).data].slice(0, 3), dark, w: c.width };
        }, { b64: png.toString('base64'), px, py });
        const kind = /colorimage/.test(readFileSync(epsPath, 'latin1')) ? 'raster' : 'vector';
        const is = { white: p => p.every(v => v > 230), black: p => p.every(v => v < 40), red: p => p[0] > 200 && p[1] < 60 && p[2] < 60 };
        assert(pix.dark > 0, `${kind} EPS renders blank`); // white-pixel probes must not pass on an empty page
        if (want === 'nonblank') return `${kind} EPS (fallback), text visible`;
        assert(is[want](pix.p), `pixel is rgb(${pix.p}), expected ${want} (${kind} EPS)`);
        return `${kind} EPS, pixel ${want}`;
      });
    }
    // restore defaults for the next run's persisted settings
    for (const t of ['.png', '.jpg', '.svg', 'cmyk', 'Grayscale']) await chip(page, t).click();
  }
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ---------------- main ---------------- */
const TOOLS = { 'color-check': testColorCheck, 'multi-export': testMultiExport };
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
state.vp = await ctx.newPage(); await state.vp.goto(BASE + '/');
console.log(`Lathe ports · Chrome ${browser.version()} · Ghostscript ${HAS_GS ? 'yes' : 'NO'}`);
for (const [id, fn] of Object.entries(TOOLS)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  state.tool = id; console.log(`\n${id}`);
  try { await fn(ctx); } catch (e) { state.results.push({ tool: id, check: 'runner', status: 'fail', detail: e.message.split('\n')[0] }); console.log('  FAIL  runner crashed — ' + e.message.split('\n')[0]); }
}
await browser.close(); server.kill();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(state.results, null, 2));
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
