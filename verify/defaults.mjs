// Milestone 4: Defaults panel + Fork, against the production build (vite preview).
// Usage: npm run verify:defaults
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, assert, check, openPage, download, pngInfo } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FX = join(HERE, 'fixtures');
const OUT = join(HERE, 'out', 'defaults');
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
state.out = OUT;

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) return proc; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  proc.kill(); throw new Error('vite preview did not start');
}

const row = (page, key) => page.locator(`.defaults__row[data-key="${key}"]`);
async function setNumber(page, key, v) {
  const input = row(page, key).locator('input[type=number]');
  await input.fill(String(v)); await input.press('Enter');
  await page.waitForFunction(k => document.querySelector(`.defaults__row[data-key="${k}"]`)?.classList.contains('is-edited'), key);
  await page.waitForTimeout(250); // remount
}
async function setSelect(page, key, v) {
  await row(page, key).locator('select').selectOption(String(v));
  await page.waitForFunction(k => document.querySelector(`.defaults__row[data-key="${k}"]`)?.classList.contains('is-edited'), key);
  await page.waitForTimeout(250);
}
const editedCount = page => page.textContent('[data-testid="defaults-edited"]');

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const { page, errors } = await openPage(ctx, BASE + '/t/color-check');
console.log('lathe defaults + fork');

/* ---------------- Color-check ---------------- */
state.tool = 'color-check';
await page.waitForSelector('.cc');
await page.fill('.inspector textarea', '#E8FF1A #000000 #FFFFFF #2B2BE6 #FF2E7E');
await check('Every default is listed with who chose it and why', async () => {
  const rows = await page.locator('.defaults__row').count();
  const who = await page.$$eval('.defaults__who', ws => ws.map(w => w.textContent));
  assert(rows === 17, `${rows} rows`);
  assert(who.every(w => /Chosen by David Lee|Inherited from/.test(w) && /TODO\(David\)/.test(w)), who.find(w => !/TODO/.test(w)));
  return `${rows} rows, all TODO(David)`;
});
await check('Editing a number default applies at once and strikes through the maker value', async () => {
  const stat = () => page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' '));
  const before = await stat();
  await setNumber(page, 'wcagAA', 6);
  const after = await stat();
  const was = await row(page, 'wcagAA').locator('.defaults__was s').textContent();
  const who = await row(page, 'wcagAA').locator('.defaults__who').textContent();
  assert(before !== after, `results unchanged: ${after}`);
  assert(/4\.5/.test(was) && /Edited by you/.test(who), `${was} | ${who}`);
  assert(await editedCount(page) === '1 edited', await editedCount(page));
  await page.screenshot({ path: join(OUT, 'color-check-edited.png') });
  return `${before.replace(/\s+/g, ' ')} → ${after.replace(/\s+/g, ' ')}; maker ${was.trim()} struck`;
});
await check('Editing an option default (Standard → apca) switches the tool', async () => {
  await setSelect(page, 'standard', 'apca');
  const active = await page.$$eval('.inspector .l-chip.is-active', bs => bs.map(b => b.textContent));
  const v = (await page.textContent('td.cell[title^="fg #000000 on bg #FFFFFF"] .val')).trim();
  assert(active.includes('APCA WCAG 3') && v === '+106', `${active} ${v}`);
  return `APCA chip active, black/white ${v}`;
});
await check('A reason is saved with the edit', async () => {
  const r = row(page, 'wcagAA').locator('.defaults__reason-input');
  await r.fill('Our brand guide asks for 6:1'); await r.press('Enter');
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.cc');
  const v = await row(page, 'wcagAA').locator('.defaults__reason-input').inputValue();
  assert(v === 'Our brand guide asks for 6:1', v); return 'kept across reload';
});
await check('Edits persist across reload', async () => {
  assert(await editedCount(page) === '2 edited', await editedCount(page));
  assert(await row(page, 'wcagAA').locator('input[type=number]').inputValue() === '6', 'wcagAA');
  return '2 edited';
});
await check('Invalid JSON for an object default is rejected, not applied', async () => {
  const r = row(page, 'gradeColors');
  await r.locator('button:has-text("Edit")').click();
  await r.locator('textarea').fill('{ not json');
  await r.locator('button:has-text("Apply")').click();
  const err = await r.locator('[role=alert]').textContent();
  assert(/Not applied/.test(err) && !(await r.evaluate(el => el.classList.contains('is-edited'))), err);
  await r.locator('textarea').fill('["#000000"]'); await r.locator('button:has-text("Apply")').click();
  const err2 = await r.locator('[role=alert]').textContent();
  assert(/an object/.test(err2), err2);
  await r.locator('button:has-text("Close")').click();
  return 'parse errors and shape mismatches refused';
});
await check('Descriptive defaults are shown but not editable', async () => {
  await page.goto(BASE + '/t/multi-export', { waitUntil: 'networkidle' }); await page.waitForSelector('.mx');
  const r = row(page, 'cmykSeparation');
  assert(await r.locator('input, select, textarea, button').count() === 0, 'editable');
  assert(/descriptive/.test(await r.textContent()), 'no note'); return 'cmykSeparation read-only';
});
await page.goto(BASE + '/t/color-check', { waitUntil: 'networkidle' }); await page.waitForSelector('.cc');

/* ---------------- Fork ---------------- */
await check('Fork (⌘⇧F): zip with tool source, contract files, defaults.json, FORK.md; lands in tray', async () => {
  const before = Number(await page.textContent('[data-testid="tray-count"]'));
  const f = await download(page, () => page.keyboard.press('Meta+Shift+f'));
  assert(basename(f) === 'color-check-fork.zip', basename(f));
  const zip = await JSZip.loadAsync(readFileSync(f));
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  for (const need of ['color-check-fork/src/tools/color-check/index.ts', 'color-check-fork/src/tools/color-check/engine.ts',
    'color-check-fork/src/tools/color-check/defaults.ts', 'color-check-fork/src/tools/color-check/color-check.css',
    'color-check-fork/lathe/tools/types.ts', 'color-check-fork/lathe/ui/primitives.ts', 'color-check-fork/lathe/styles/tokens.css',
    'color-check-fork/defaults.json', 'color-check-fork/FORK.md']) assert(names.includes(need), 'missing ' + need);
  assert(!names.some(n => /tools\/(multi-export|mesh-gradient)\//.test(n)), 'other tools leaked into the fork');
  const src = await zip.file('color-check-fork/src/tools/color-check/engine.ts').async('string');
  assert(src === readFileSync(join(ROOT, 'src/tools/color-check/engine.ts'), 'utf8'), 'source differs from repo');
  const dj = JSON.parse(await zip.file('color-check-fork/defaults.json').async('string'));
  assert(dj.maker.wcagAA === 4.5 && dj.current.wcagAA === 6 && dj.edits.wcagAA.reason === 'Our brand guide asks for 6:1', JSON.stringify(dj.edits));
  const m = dj.manifest.find(x => x.key === 'wcagAA');
  assert(m.chosenBy === 'You' && m.maker.value === 4.5 && m.maker.inheritedFrom, JSON.stringify(m));
  const md = await zip.file('color-check-fork/FORK.md').async('string');
  assert(/~~4\.5 :1~~ → 6 :1/.test(md) && /Why: Our brand guide asks for 6:1/.test(md) && /~~wcag~~ → apca/.test(md), md.slice(0, 400));
  writeFileSync(join(OUT, 'FORK.md'), md);
  await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) === n + 1, before);
  return `${names.length} files; FORK.md lists 2 changes with reasons; tray +1`;
});
await check('Reset one row restores the maker value', async () => {
  await row(page, 'standard').locator('.defaults__reset').click();
  await page.waitForFunction(() => !document.querySelector('.defaults__row[data-key="standard"]').classList.contains('is-edited'));
  await page.waitForTimeout(250);
  const v = (await page.textContent('td.cell[title^="fg #000000 on bg #FFFFFF"] .val')).trim();
  assert(v === '21.00', 'still APCA: ' + v); return 'Standard back to wcag; matrix shows 21.00';
});
await check("Reset to maker's defaults clears every edit", async () => {
  await page.click(".defaults__actions .l-btn:has-text(\"Reset to maker’s defaults\")");
  await page.waitForFunction(() => document.querySelector('[data-testid="defaults-edited"]').textContent === 'Maker’s');
  await page.waitForTimeout(250);
  const s = await page.$$eval('.inspector .l-stat', r => r.map(x => x.textContent).join(' '));
  assert(/Pass10/.test(s), s); return s.replace(/\s+/g, ' ');
});
await check('Fork from a tool that is not built yet explains itself', async () => {
  await page.goto(BASE + '/t/grid', { waitUntil: 'networkidle' });
  await page.keyboard.press('Meta+Shift+f');
  const t = await page.textContent('.l-toasts'); assert(/Open a built tool to fork it/.test(t), t); return t;
});

/* ---------------- Each ported tool picks up an edited default ---------------- */
state.tool = 'multi-export';
await check('Multi-export: Raster size 2000 → 1000 replaces the working value; export follows', async () => {
  await page.goto(BASE + '/t/multi-export', { waitUntil: 'networkidle' }); await page.waitForSelector('.mx');
  await page.setInputFiles('.mx input[type=file]', join(FX, 'logo.png'));
  await page.waitForSelector('.mx__img');
  await setNumber(page, 'rasterSize', 1000);
  await page.waitForSelector('.mx__img');
  const field = await page.inputValue('input[aria-label="Raster size in pixels"]');
  await row(page, 'formats').locator('.l-chip', { hasText: /^jpg$/ }).click(); await page.waitForTimeout(250);
  for (const t of ['svg', 'eps']) { await row(page, 'formats').locator('.l-chip', { hasText: new RegExp(`^${t}$`) }).click(); await page.waitForTimeout(250); }
  await row(page, 'colorSpaces').locator('.l-chip', { hasText: /^cmyk$/ }).click(); await page.waitForTimeout(250);
  await row(page, 'treatments').locator('.l-chip', { hasText: /^grayscale$/ }).click(); await page.waitForTimeout(250);
  const f = await download(page, () => page.click('.inspector .l-btn--primary:has-text("Export .zip")'));
  const zip = await JSZip.loadAsync(readFileSync(f));
  const files = Object.keys(zip.files).filter(n => !zip.files[n].dir && !n.endsWith('README.txt'));
  const png = await zip.file(files[0]).async('nodebuffer'); const { w, h } = pngInfo(png);
  assert(field === '1000' && files.length === 1 && w === 1000 && h === 200, `field ${field}, files ${files}, ${w}×${h}`);
  await page.click(".defaults__actions .l-btn:has-text(\"Reset to maker’s defaults\")"); await page.waitForTimeout(400);
  return `field 1000; formats [png], rgb, color → 1 file, 1000×200`;
});
state.tool = 'mesh-gradient';
await check('Mesh-gradient: Family default conic → sphere shows Sphere', async () => {
  await page.goto(BASE + '/t/mesh-gradient', { waitUntil: 'networkidle' }); await page.waitForSelector('.mg__canvas');
  await setSelect(page, 'family', 'sphere');
  const active = await page.$$eval('.inspector .l-section:first-child .l-chip.is-active', bs => bs.map(b => b.textContent));
  const variant = await page.locator('.inspector select').first().inputValue();
  await page.click(".defaults__actions .l-btn:has-text(\"Reset to maker’s defaults\")"); await page.waitForTimeout(400);
  const back = await page.$$eval('.inspector .l-section:first-child .l-chip.is-active', bs => bs.map(b => b.textContent));
  assert(active.includes('Sphere') && variant === 'spheres' && back.includes('Conic'), `${active} ${variant} ${back}`);
  return 'Sphere / spheres; reset → Conic';
});
state.tool = 'color-swap';
await check('Color-swap: Recolor strength 0.85 → 0.5 moves the slider; loaded media survives the remount', async () => {
  await page.goto(BASE + '/t/color-swap', { waitUntil: 'networkidle' }); await page.waitForSelector('#statusText');
  await page.setInputFiles('#fileInput', join(FX, 'photo.jpg'));
  await page.waitForFunction(() => /Analysis complete/.test(document.getElementById('statusText').textContent), null, { timeout: 60000 });
  await setNumber(page, 'strength', 0.5);
  await page.waitForFunction(() => /Analysis complete/.test(document.getElementById('statusText')?.textContent || ''), null, { timeout: 60000 });
  const v = await page.inputValue('#set_strength');
  const file = await page.textContent('[data-testid="status-file"]');
  await page.click(".defaults__actions .l-btn:has-text(\"Reset to maker’s defaults\")"); await page.waitForTimeout(600);
  const back = await page.inputValue('#set_strength');
  assert(v === '50' && /photo\.jpg/.test(file) && back === '85', `slider ${v}, file ${file}, reset ${back}`);
  return `slider 50, ${file.trim()}; reset → 85`;
});
state.tool = 'mood-strip';
await check('Mood-strip: Swatches per image 5 → 3', async () => {
  await page.goto(BASE + '/t/mood-strip', { waitUntil: 'networkidle' }); await page.waitForSelector('.ms');
  await page.setInputFiles('.ms input[type=file]', join(FX, 'photo.jpg'));
  await page.waitForSelector('.ms-card');
  await setNumber(page, 'paletteSize', 3);
  await page.waitForSelector('.ms-card');
  await page.locator('.ms-card').last().locator('.ms-icon[title="Colors"]').click();
  await page.locator('.ms-card').last().locator('.ms-palette.open .ms-sw').first().waitFor();
  const n = await page.locator('.ms-card').last().locator('.ms-sw').count();
  await page.click(".defaults__actions .l-btn:has-text(\"Reset to maker’s defaults\")"); await page.waitForTimeout(400);
  assert(n === 3, `${n} swatches`); return '3 swatches';
});
state.tool = 'sandbox';
await check('Fork works for every built tool', async () => {
  const out = [];
  for (const id of ['multi-export', 'mesh-gradient', 'color-swap', 'mood-strip', 'sandbox']) {
    await page.goto(BASE + '/t/' + id, { waitUntil: 'networkidle' });
    await page.waitForSelector('.defaults__row');
    const f = await download(page, () => page.click('.defaults__actions .l-btn:has-text("Fork this tool")'));
    const zip = await JSZip.loadAsync(readFileSync(f));
    const names = Object.keys(zip.files);
    assert(names.some(n => n.endsWith(`src/tools/${id}/index.ts`)) && names.some(n => n.endsWith('FORK.md')), id);
    out.push(`${id} ${names.filter(n => !zip.files[n].dir).length}`);
  }
  return out.join(', ');
});
await check('No console errors across the run', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });

await browser.close(); server.kill();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(state.results, null, 2));
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
