// Port verification: rerun every check the reference tool passed (verify/run.mjs) against the
// Lathe port, plus the bug fixes promised in VERIFY.md. Serves the production build (vite preview).
// Usage: npm run verify:port   or   node verify/port.mjs [color-check multi-export]
import { chromium, firefox } from 'playwright';
import JSZip from 'jszip';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HAS_GS, state, assert, Warn, check, openPage, download, pngInfo, jpegInfo,
  imgStats, diffImages, gsRender, validateEps, readText, ffprobe,
} from './lib.mjs';
import { serve } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FX = join(HERE, 'fixtures');
const OUT = join(HERE, 'out', 'port');
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = process.argv.slice(2);
const MOD = 'Meta';
const FXPORT = 4320; // verify/serve.mjs: serves /__fixtures/ for URL-based flows (cross-origin, like the web)
const FXBASE = `http://127.0.0.1:${FXPORT}`;
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

/* ================================================================
   MESH-GRADIENT
   ================================================================ */
async function testMeshGradient(ctx) {
  const { page, errors } = await openPage(ctx, BASE + '/t/mesh-gradient');
  await page.waitForSelector('.mg__canvas');
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  const canvasStats = async () => {
    const url = await page.evaluate(() => document.querySelector('.mg__canvas').toDataURL('image/png'));
    return { url, ...(await imgStats(Buffer.from(url.split(',')[1], 'base64'), 'image/png')) };
  };
  const variantSel = page.locator('.inspector select').first();
  const slider = (label) => page.locator('.l-slider', { has: page.locator('.l-slider__label', { hasText: new RegExp(`^${label}$`) }) }).locator('input');
  const setSlider = (label, v) => slider(label).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }, v);
  await check('Preview renders a non-flat gradient on load', async () => {
    const s = await canvasStats(); assert(s.std > 5, 'flat'); return `canvas ${s.w}×${s.h}, σ ${s.std.toFixed(1)}`;
  });
  await check('UI labels: families are Conic / Field / Sphere (McCann tagline removed)', async () => {
    const fams = await page.$$eval('.inspector .l-section:first-child .l-chip', bs => bs.map(b => b.textContent));
    assert(fams.slice(0, 3).join('/') === 'Conic/Field/Sphere', fams.join('/'));
    return fams.slice(0, 3).join(' / ');
  });
  for (const fam of ['Conic', 'Field', 'Sphere']) {
    await chip(page, fam).click();
    const vars = await variantSel.evaluate(s => [...s.options].map(o => o.value));
    await check(`Family "${fam}": all variants render (${vars.join(', ')})`, async () => {
      const out = [];
      for (const v of vars) {
        await variantSel.selectOption(v);
        const st = await canvasStats(); assert(st.std > 3, `${v} flat`); out.push(`${v} σ${st.std.toFixed(0)}`);
      }
      return out.join(', ');
    });
  }
  await check('Element selection (Sphere/Spheres): click picks an element, stops edit it', async () => {
    await chip(page, 'Sphere').click(); await variantSel.selectOption('spheres');
    const before = (await canvasStats()).url;
    const box = await page.locator('.mg__canvas').boundingBox();
    const den = Number(await slider('Density').inputValue()), N = 2 + Math.round(den), r = box.width / N / 2 * 0.99;
    await page.mouse.click(box.x + 4 * r, box.y + r);
    assert(await page.locator('.mg__sel').count() === 1, 'no highlight');
    await page.locator('.inspector input[type=color]').first().evaluate(i => { i.value = '#00ff00'; i.dispatchEvent(new Event('input')); });
    assert((await canvasStats()).url !== before, 'unchanged');
    return 'highlight + per-element recolor';
  });
  await check('Sliders (density/angle/blur/grain) redraw the preview', async () => {
    await chip(page, 'Conic').click();
    const a = (await canvasStats()).url;
    await setSlider('Density', 9); await setSlider('Angle', 200); await setSlider('Blur', 60); await setSlider('Grain', 10);
    const b = (await canvasStats()).url;
    assert(a !== b, 'unchanged'); return 'redraws';
  });
  await check('Randomize changes the output', async () => {
    const a = (await canvasStats()).url; await page.click('.inspector .l-btn:has-text("Randomize")'); const b = (await canvasStats()).url;
    assert(a !== b, 'unchanged'); return 'changes';
  });
  await check('Play animates, Stop returns to still', async () => {
    await setSlider('Drift', 60);
    await page.click('.inspector .l-btn:has-text("Play")'); await page.waitForTimeout(400);
    const a = (await canvasStats()).url; await page.waitForTimeout(300); const b = (await canvasStats()).url;
    await page.click('.inspector .l-btn:has-text("Stop")');
    await setSlider('Drift', 0);
    assert(a !== b, 'frames identical'); assert(await page.locator('.inspector .l-btn:has-text("Play")').count() === 1, 'stuck on Stop');
    return 'animates';
  });
  for (const [ratio, ew, eh] of [['16:9', 3840, 2160], ['4:5', 2160, 2700], ['9:16', 2160, 3840]]) {
    await chip(page, ratio).click();
    await check(`Export .png at ${ratio} → ${ew}×${eh}`, async () => {
      const f = await download(page, () => page.click('.inspector .l-btn:has-text(".png")'));
      const buf = readFileSync(f); const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
      assert(w === ew && h === eh, `${w}×${h}`); assert(st.std > 3, 'flat');
      return `${basename(f)} ${w}×${h}`;
    });
  }
  await chip(page, '16:9').click();
  await check('Export .jpeg → 3840×2160', async () => {
    const f = await download(page, () => page.click('.inspector .l-btn:has-text(".jpeg")'));
    const j = jpegInfo(readFileSync(f)); assert(j.w === 3840 && j.h === 2160, `${j.w}×${j.h}`); return `${basename(f)} ${j.w}×${j.h}`;
  });
  await check('Export .gif → 40-frame 720×405 loop, encoder bundled (no CDN)', async () => {
    const cdn = []; page.on('request', r => { if (/cdnjs|jsdelivr|unpkg/.test(r.url())) cdn.push(r.url()); });
    const f = await download(page, () => page.click('.inspector .l-btn:has-text(".gif")'), 180000);
    const buf = readFileSync(f);
    assert(buf.slice(0, 6).toString() === 'GIF89a', 'not GIF89a');
    const info = await state.vp.evaluate(async b64 => {
      const d = new ImageDecoder({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), type: 'image/gif' }); await d.tracks.ready;
      const fr = await d.decode({ frameIndex: 0 });
      return { frames: d.tracks.selectedTrack.frameCount, w: fr.image.displayWidth, h: fr.image.displayHeight };
    }, buf.toString('base64'));
    assert(info.frames === 40 && info.w === 720 && info.h === 405, JSON.stringify(info));
    assert(!cdn.length, 'CDN requests: ' + cdn.join(', '));
    return `${basename(f)} ${info.w}×${info.h}, ${info.frames} frames, no CDN requests`;
  });
  await check('State persists across reload (family, ratio, sliders)', async () => {
    await chip(page, 'Field').click(); await chip(page, '4:5').click();
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.mg__canvas');
    const active = await page.$$eval('.inspector .l-chip.is-active', bs => bs.map(b => b.textContent));
    assert(active.includes('Field') && active.includes('4:5'), active.join(','));
    await chip(page, 'Conic').click(); await chip(page, '16:9').click();
    return active.join(', ');
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   COLOR-SWAP
   ================================================================ */
async function testColorSwap(ctx) {
  const { page, errors } = await openPage(ctx, BASE + '/t/color-swap');
  await page.waitForSelector('#statusText');
  const waitAnalysis = (t = 60000) => page.waitForFunction(() => /Analysis complete|Analysis failed/.test(document.getElementById('statusText').textContent), null, { timeout: t });
  const grab = async () => {
    await page.waitForTimeout(250);
    return Buffer.from((await page.evaluate(() => document.getElementById('outCanvas').toDataURL('image/png'))).split(',')[1], 'base64');
  };
  await check('Loads with no console errors, WebGL2 renderer ok', async () => {
    assert(!errors.length, errors.join(' | '));
    const st = await page.textContent('#statusText');
    assert(!/WebGL2 is unavailable/.test(st), st); return 'clean, WebGL2 ok';
  });
  await page.setInputFiles('#fileInput', join(FX, 'photo.jpg'));
  await check('photo.jpg: loads, analysis finds color families', async () => {
    await waitAnalysis();
    const st = await page.textContent('#statusText'); assert(/Analysis complete/.test(st), st);
    const n = await page.locator('#clusterList > *').count(); assert(n > 0, 'no clusters');
    return `${n} cluster rows`;
  });
  await check('Preview stage is visible at 1440×900 (was 28px wide in the original)', async () => {
    const m = await page.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect(), c = document.getElementById('outCanvas').getBoundingClientRect();
      const b = document.querySelector('[data-view="original"]'), r = b.getBoundingClientRect();
      return { stageW: Math.round(st.width), canvas: `${Math.round(c.width)}×${Math.round(c.height)}`, covered: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== b };
    });
    assert(m.stageW > 800 && !m.covered, JSON.stringify(m));
    return `stage ${m.stageW}px, canvas ${m.canvas}`;
  });
  await check('photo.jpg: recolored view differs from original; split view works', async () => {
    const rec = await grab();
    await page.click('[data-view="original"]'); const orig = await grab();
    await page.click('[data-view="split"]'); const split = await grab();
    await page.click('[data-view="recolored"]');
    const d = await diffImages({ buf: rec, type: 'image/png' }, { buf: orig, type: 'image/png' }, 200, 133);
    const ds = await diffImages({ buf: split, type: 'image/png' }, { buf: orig, type: 'image/png' }, 200, 133);
    assert(d > 0.1, `only ${(d * 100).toFixed(1)}%`); assert(ds > 0.02 && ds < d, `split ${(ds * 100).toFixed(1)}%`);
    return `${(d * 100).toFixed(0)}% px recolored; split ${(ds * 100).toFixed(0)}%`;
  });
  await check('Presets apply settings (Graphic → strength 100)', async () => {
    await page.click('#presetGrid button:has-text("Graphic")');
    const v = await page.inputValue('#set_strength'); await page.click('#presetGrid button:has-text("Balanced")');
    assert(v === '100', 'strength ' + v); return 'ok';
  });
  await check('Add rule', async () => { await page.click('#btnAddRule'); const t = await page.textContent('#ruleCount'); assert(/^1 rule/.test(t), t); return t; });
  await check('Import palette modal replaces palette', async () => {
    await page.click('#btnImportPalette'); await page.fill('#importText', '#000000 #E8FF1A #FFFFFF'); await page.click('#importApply');
    const t = await page.textContent('#paletteCount'); assert(/^3 active/.test(t), t); return t;
  });
  await check('Modals close on Escape (fixed)', async () => {
    await page.click('#btnImportPalette'); await page.keyboard.press('Escape');
    const hidden = await page.$eval('#importModal', m => m.hidden);
    if (!hidden) await page.click('#importModal [data-close]');
    assert(hidden, 'Escape did not close'); return 'closes';
  });
  await check('Modals close on backdrop click (fixed)', async () => {
    await page.click('#btnImportPalette'); await page.mouse.click(5, 5);
    const hidden = await page.$eval('#importModal', m => m.hidden);
    if (!hidden) await page.click('#importModal [data-close]');
    assert(hidden, 'backdrop did not close'); return 'closes';
  });
  let presetFile;
  await check('Save preset .json downloads valid JSON', async () => {
    await page.click('[data-sec="presetio"] .section-head'); // collapsed by default (the original's collapse CSS never applied)
    presetFile = await download(page, () => page.click('#btnSavePreset'));
    const j = JSON.parse(readText(presetFile)); return `${basename(presetFile)} keys: ${Object.keys(j).join(', ')}`;
  });
  await check('Load preset .json restores state', async () => {
    await page.setInputFiles('#presetInput', presetFile);
    await page.waitForFunction(() => /Preset loaded|not a valid/.test(document.querySelector('.l-toasts').textContent));
    return 'Preset loaded';
  });
  await check('Palette and settings persist across reload (IndexedDB)', async () => {
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#paletteCount');
    const t = await page.textContent('#paletteCount'); assert(/^3 active/.test(t), t);
    await page.setInputFiles('#fileInput', join(FX, 'photo.jpg')); await waitAnalysis();
    return t;
  });
  const exportOnce = async (timeout) => {
    const before = await trayCount(page);
    await page.click('#btnExport'); await page.waitForSelector('#exportModal:not([hidden])');
    await page.click('#expStart'); await page.waitForSelector('#expDownload:not([hidden])', { timeout });
    const f = await download(page, () => page.click('#expDownload'));
    const status = await page.textContent('#expStatus');
    await page.click('#expCancel');
    await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) >= n + 1, before);
    return { f, status };
  };
  await check('photo.jpg: export still → recolored PNG at original size, lands in tray', async () => {
    const { f, status } = await exportOnce(30000);
    const buf = readFileSync(f); const { w, h } = pngInfo(buf);
    assert(w === 1600 && h === 1067, `${w}×${h}`);
    const d = await diffImages({ buf, type: 'image/png' }, { buf: readFileSync(join(FX, 'photo.jpg')), type: 'image/jpeg' }, 200, 133);
    assert(d > 0.1, 'not recolored'); return `${basename(f)} ${w}×${h}, ${(d * 100).toFixed(0)}% recolored; ${status}`;
  });
  await page.setInputFiles('#fileInput', join(FX, 'logo.png'));
  await check('logo.png: export keeps transparency (fixed)', async () => {
    await waitAnalysis();
    const { f } = await exportOnce(30000);
    const buf = readFileSync(f); const { w, h } = pngInfo(buf); const st = await imgStats(buf, 'image/png');
    assert(w === 1500 && h === 300, `${w}×${h}`);
    assert(st.transparent > 0.05, `transparency lost (${(st.transparent * 100).toFixed(1)}% transparent)`);
    return `${w}×${h}, ${(st.transparent * 100).toFixed(0)}% transparent`;
  });
  await page.setInputFiles('#fileInput', join(FX, 'clip.mp4'));
  await check('clip.mp4: loads (H.264/AAC), fps detected, analysis runs', async () => {
    await waitAnalysis(90000);
    const st = await page.textContent('#statusText'); assert(/Analysis complete/.test(st), st);
    return `duration ${await page.textContent('#timeDur')}; ${(await page.textContent('[data-testid="status-file"]')).trim()}`;
  });
  await check('clip.mp4: renders recolored frames as the video moves', async () => {
    const seek = t => page.evaluate(t => new Promise(r => { const v = document.getElementById('srcVideo'); v.pause(); v.addEventListener('seeked', () => requestAnimationFrame(() => requestAnimationFrame(r)), { once: true }); v.currentTime = t; }), t);
    await seek(0.5); const a = await grab(); await seek(2.0); const b = await grab();
    const d = await diffImages({ buf: a, type: 'image/png' }, { buf: b, type: 'image/png' }, 160, 90);
    assert(d > 0.005, 'identical'); return `${(d * 100).toFixed(1)}% px differ between 0.5 s and 2.0 s`;
  });
  await check('clip.mp4: export → WebM with video + audio and a duration header (fixed)', async () => {
    const { f, status } = await exportOnce(60000);
    const p = ffprobe(f);
    const v = p.streams.find(s => s.codec_type === 'video'), a = p.streams.find(s => s.codec_type === 'audio');
    assert(v && /vp8|vp9/.test(v.codec_name) && v.width === 640 && v.height === 360, 'video stream');
    const frames = parseInt(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString(), 10);
    const dur = parseFloat(p.format.duration);
    assert(frames >= 60, `${frames} frames`); assert(a, 'no audio');
    assert(isFinite(dur) && Math.abs(dur - 3) < 0.5, `header duration ${p.format.duration}`);
    return `${basename(f)} ${v.codec_name} ${v.width}×${v.height}, ${frames} frames, ${a.codec_name}, duration ${dur.toFixed(2)} s; ${status}`;
  });
  await check('No console errors during the flow', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await page.close();
}

/* ================================================================
   MOOD-STRIP
   ================================================================ */
async function testMoodStrip(ctx) {
  const { page, errors } = await openPage(ctx, BASE + '/t/mood-strip');
  await page.waitForSelector('.ms');
  const count = async () => (await page.textContent('[data-testid="status-file"]')).trim();
  const waitCount = n => page.waitForFunction(n => document.querySelector('[data-testid="status-file"]').textContent.trim().startsWith(n + ' '), n);
  await check('Loads with no console errors', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });
  await check('Add images (file picker): PNG + JPG, into the tray once each', async () => {
    const before = await trayCount(page);
    await page.setInputFiles('.ms input[type=file]', [join(FX, 'logo.png'), join(FX, 'photo.jpg')]);
    await waitCount(2);
    await page.waitForFunction(() => [...document.querySelectorAll('.ms-dim')].every(d => /×/.test(d.textContent)));
    const dims = await page.$$eval('.ms-dim', ds => ds.map(d => d.textContent));
    assert(dims[0] === '1500 × 300' && dims[1] === '1600 × 1067', dims.join(', '));
    assert(await trayCount(page) === before + 2, `tray ${before} → ${await trayCount(page)}`);
    return `${await count()}: ${dims.join(', ')}`;
  });
  await check('Palette: 5 swatches extracted from the photo', async () => {
    const card = page.locator('.ms-card').nth(1);
    await card.locator('.ms-icon[title="Colors"]').click();
    await card.locator('.ms-palette.open .ms-sw').first().waitFor();
    const hex = await card.locator('.ms-sw-hex').allTextContents();
    assert(hex.length === 5 && hex.every(h => /^[0-9A-F]{6}$/.test(h)), hex.join(','));
    return hex.join(' ');
  });
  await check('Copy all / Copy as CSS put hex codes on the clipboard', async () => {
    const card = page.locator('.ms-card').nth(1);
    await card.locator('.ms-mini:has-text("Copy all")').click(); const a = await page.evaluate(() => navigator.clipboard.readText());
    await card.locator('.ms-mini:has-text("Copy as CSS")').click(); const b = await page.evaluate(() => navigator.clipboard.readText());
    assert(a.split('\n').length === 5 && /^:root \{\n  --color-1: #/.test(b), JSON.stringify([a, b])); return 'ok';
  });
  await check('Save downloads the original file bytes', async () => {
    const f = await download(page, () => page.locator('.ms-card').nth(1).locator('.ms-icon[title="Save"]').click());
    assert(readFileSync(f).equals(readFileSync(join(FX, 'photo.jpg'))), 'bytes differ'); return basename(f) + ' (byte-identical)';
  });
  await check('Paste an image from the clipboard', async () => {
    const b64 = readFileSync(join(FX, 'logo.png')).toString('base64');
    await page.evaluate(b64 => {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'pasted.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, b64);
    await waitCount(3); return await count();
  });
  await check('Paste a link: WordPress-style thumb URL upgrades to full size', async () => {
    await page.evaluate(u => {
      const dt = new DataTransfer(); dt.setData('text/plain', u);
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, FXBASE + '/__fixtures/photo-300x200.jpg');
    await waitCount(4);
    await page.waitForFunction(() => /1600 × 1067/.test(document.querySelectorAll('.ms-dim')[3].textContent));
    assert(/Upgraded to full size/.test(await page.textContent('.l-toasts')), 'no upgrade toast');
    return 'photo-300x200.jpg → photo.jpg, 1600 × 1067';
  });
  await check('Link field (replaces prompt()) adds a ref; typing in it does not trigger paste-to-add', async () => {
    const input = page.locator('.inspector input[placeholder="https://…"]');
    await input.fill(FXBASE + '/__fixtures/logo.png'); await input.press('Enter');
    await waitCount(5);
    await input.evaluate(el => { el.focus(); const dt = new DataTransfer(); dt.setData('text/plain', 'https://example.com/x.png'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
    await page.waitForTimeout(300);
    assert((await count()).startsWith('5 '), 'paste in field added a ref: ' + await count());
    return await count();
  });
  await check('Drop a file onto the strip: added once (not also by the shell)', async () => {
    const before = await trayCount(page);
    const b64 = readFileSync(join(FX, 'photo.jpg')).toString('base64');
    await page.evaluate(b64 => {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'dropped.jpg', { type: 'image/jpeg' }));
      const el = document.querySelector('.ms');
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64);
    await waitCount(6); await page.waitForTimeout(300);
    assert(await trayCount(page) === before + 1, `tray ${before} → ${await trayCount(page)}`);
    assert(await page.locator('.dropzone').count() === 0, 'shell drop overlay stuck');
    return await count();
  });
  await check('Drag to reorder cards', async () => {
    const before = await page.$$eval('.ms-card', cs => cs.map(c => c.dataset.id));
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ms-card'); const dt = new DataTransfer();
      cards[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const r = cards[2].getBoundingClientRect();
      cards[2].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: r.bottom - 2 }));
    });
    const after = await page.$$eval('.ms-card', cs => cs.map(c => c.dataset.id));
    assert(after[2] === before[0], `${before} → ${after}`); return `${before.join(',')} → ${after.join(',')}`;
  });
  await check('Remove a ref', async () => { await page.locator('.ms-card').last().locator('.ms-icon[title="Remove"]').click(); await waitCount(5); return await count(); });
  await check('Board persists across reload', async () => {
    const order = await page.$$eval('.ms-label', ls => ls.map(l => l.textContent));
    await page.waitForTimeout(700); // let the IndexedDB write land (the original test waited too)
    await page.reload({ waitUntil: 'networkidle' }); await waitCount(5);
    await page.waitForFunction(() => [...document.querySelectorAll('.ms-dim')].every(d => /×/.test(d.textContent)));
    const again = await page.$$eval('.ms-label', ls => ls.map(l => l.textContent));
    assert(again.join('|') === order.join('|'), `${order} vs ${again}`); return `${await count()}, order kept`;
  });
  await check('Pop out opens a separate window with the image', async () => {
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.locator('.ms-card').first().locator('.ms-icon[title="Pop out"]').click()]);
    await pop.waitForFunction(() => { const i = document.querySelector('.ms-float-body img'); return i && i.naturalWidth > 0; });
    const w = await pop.evaluate(() => document.querySelector('.ms-float-body img').naturalWidth); await pop.close();
    return `popup image ${w}px wide`;
  });
  await check('Float (Document PiP) moves the strip into an always-on-top window and back', async () => {
    await page.click('.inspector .l-btn:has-text("Float")');
    await page.waitForFunction(() => documentPictureInPicture.window && documentPictureInPicture.window.document.querySelector('.ms-strip'), null, { timeout: 5000 });
    const inPip = await page.evaluate(() => documentPictureInPicture.window.document.querySelectorAll('.ms-card').length);
    const label = await page.textContent('.inspector .l-btn:has-text("Return strip")');
    await page.click('.inspector .l-btn:has-text("Return strip")');
    await page.waitForFunction(() => !documentPictureInPicture.window && document.querySelector('.ms .ms-strip'));
    assert(inPip === 5 && label === 'Return strip', `${inPip} cards`); return `${inPip} cards floated and returned`;
  });
  // Linked images load with crossOrigin first so their colors can be read; hosts without CORS
  // headers (like the fixture server, and most of the web) log an error before the retry.
  const corsRetry = e => /blocked by CORS policy|net::ERR_FAILED/.test(e);
  await check('Clear (Lathe modal) empties the board; images stay in the tray', async () => {
    const tray = await trayCount(page);
    await page.click('.inspector .l-btn:has-text("Clear")');
    await page.click('.l-modal .l-btn--primary:has-text("Remove all")');
    await waitCount(0);
    assert(await trayCount(page) === tray, 'tray changed'); return await count();
  });
  await check('No console errors during the flow (besides the CORS-first retry for linked images)', () => {
    const real = errors.filter(e => !corsRetry(e));
    assert(!real.length, real.join(' | '));
    return `clean; ${errors.length} expected CORS-retry messages`;
  });
  await page.close();

  // ---- Browser without Document PiP: Float falls back to a popup window (fixed) ----
  {
    const c2 = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
    await c2.addInitScript(() => { delete window.documentPictureInPicture; delete Window.prototype.documentPictureInPicture; });
    const { page: p2, errors: e2 } = await openPage(c2, BASE + '/t/mood-strip');
    await check('No-PiP browser (simulated): Float opens a popup window holding the strip', async () => {
      await p2.setInputFiles('.ms input[type=file]', join(FX, 'photo.jpg'));
      await p2.waitForSelector('.ms-card');
      const [pop] = await Promise.all([p2.waitForEvent('popup'), p2.click('.inspector .l-btn:has-text("Float")')]);
      await pop.waitForSelector('.ms-strip .ms-card');
      const placeholder = await p2.textContent('.ms');
      await pop.close();
      await p2.waitForSelector('.ms .ms-strip .ms-card');
      assert(/Strip is floating/.test(placeholder) && !e2.length, `${placeholder} ${e2.join('|')}`);
      return 'popup held the strip; strip returned when the window closed';
    });
    await c2.close();
  }
  // ---- Firefox ----
  {
    let b;
    try { b = await firefox.launch(); } catch (e) { await check('Firefox: loads, add image, Float', () => { throw new Warn('Firefox could not launch: ' + e.message.split('\n')[0]); }); return; }
    const c3 = await b.newContext();
    const { page: p3, errors: e3 } = await openPage(c3, BASE + '/t/mood-strip');
    await check('Firefox: loads, add image, Float', async () => {
      await p3.setInputFiles('.ms input[type=file]', join(FX, 'photo.jpg'));
      await p3.waitForSelector('.ms-card');
      await p3.click('.inspector .l-btn:has-text("Float")');
      await p3.waitForTimeout(1500);
      const pip = await p3.evaluate(() => !!(window.documentPictureInPicture && documentPictureInPicture.window));
      const ua = await p3.evaluate(() => navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0]);
      assert(!e3.length, e3.join(' | '));
      return `${ua}; Float ${pip ? 'opened PiP' : 'used a popup'}`;
    });
    await b.close();
  }
}

/* ================================================================
   McCANN STRIP
   ================================================================ */
async function testMcCannStrip() {
  await check('No McCann strings in src/ or the production build', () => {
    const hits = [];
    const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|js|css|html|json|map)$/.test(f)) { const t = readFileSync(p, 'utf8'); if (/mccann/i.test(t)) hits.push(p.replace(ROOT + '/', '')); } } };
    walk(join(ROOT, 'src')); walk(join(ROOT, 'dist'));
    assert(!hits.length, hits.join(', ')); return 'none';
  });
  await check('No McCann tagline families (TRUTH / WELL / TOLD) in source', () => {
    const t = readFileSync(join(ROOT, 'src/tools/mesh-gradient/engine.ts'), 'utf8') + readFileSync(join(ROOT, 'src/tools/mesh-gradient/index.ts'), 'utf8');
    const m = t.match(/['"](TRUTH|WELL|TOLD)['"]/g); assert(!m, m && m.join(',')); return 'Conic / Field / Sphere';
  });
  await check('No McCann gallery assets, home-mark or licensed fonts copied', () => {
    const bad = []; const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/home-mark|McCann-Headline|PPNeueMontreal|gallery/i.test(f)) bad.push(p); } };
    for (const d of ['src', 'public', 'dist']) walk(join(ROOT, d));
    assert(!bad.length, bad.join(', ')); return 'none';
  });
}

/* ---------------- main ---------------- */
const TOOLS = {
  'color-check': testColorCheck, 'multi-export': testMultiExport, 'mesh-gradient': testMeshGradient,
  'color-swap': testColorSwap, 'mood-strip': testMoodStrip, 'mccann-strip': testMcCannStrip,
};
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = await startPreview();
const fixtureServer = await serve(FXPORT);
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
await browser.close(); server.kill(); fixtureServer.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(state.results, null, 2));
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
