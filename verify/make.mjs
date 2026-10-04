// Milestone 9: Make a tool (v1 dummy), against the production build (vite preview).
// The three scripted prompts play their generation in order and end on a working preview whose
// controls (and Defaults rows, chosen by "You") drive it; any other prompt ends on "Tool generation
// arrives in v2."; nothing is sent to a server.
// Usage: npm run verify:make
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, assert, check, openPage } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'out', 'make');
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;
state.out = OUT;
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
console.log('lathe make a tool (milestone 9)');
state.tool = 'make';
const { page, errors } = await openPage(ctx, BASE + '/make');
const apiCalls = [];
page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url()); });

const run = async text => { await page.click(`.mk__examples .l-chip:text-is("${text}")`); };
const done = () => page.waitForSelector('.mk__run[data-done="true"]', { timeout: 20000 });
const logState = () => page.$$eval('.mk-step', s => s.map(x => x.classList.contains('is-on')));
const canvasSig = () => page.$eval('.mk__preview canvas', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, ink = 0; for (let i = 0; i < d.length; i += 97) { h = (h * 31 + d[i]) >>> 0; if (d[i] < 60) ink++; } return { h, ink: ink / (d.length / 97) }; });
const setSlider = (label, v) => page.locator(`.mk-controls .l-slider:has(.l-slider__label:text-is("${label}")) input`).evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

await check('The page asks: “Describe a tool you wish existed”', async () => {
  const label = await page.textContent('label[for="make-prompt"]');
  assert(label === 'Describe a tool you wish existed', label); return label;
});
await check('Halftone poster: steps play in order, then a working preview, 4 controls and 5 defaults chosen by You', async () => {
  await run('Turn my photo into a halftone poster');
  const early = await logState();
  await page.waitForTimeout(1600); const mid = await logState();
  await done();
  const end = await logState();
  const order = (a, b) => a.every((v, i) => !v || b[i]);
  const controls = await page.locator('.mk-controls .mk-in').count();
  const rows = await page.$$eval('.defaults__row', r => r.map(x => x.textContent));
  const sig = await canvasSig();
  assert(order(early, mid) && order(mid, end) && end.every(Boolean) && early.filter(Boolean).length < end.length, `${early} / ${mid} / ${end}`);
  assert(controls === 4 && rows.length === 5 && rows.every(t => /Chosen by You/.test(t) && /From your words/.test(t)) && sig.ink > 0.15, `${controls} controls, ${rows.length} rows, ink ${sig.ink}`);
  return `steps ${early.filter(Boolean).length} → ${mid.filter(Boolean).length} → ${end.length}; halftone ink ${(sig.ink * 100).toFixed(0)}%`;
});
await check('Halftone controls drive the preview (dot cell, screen angle)', async () => {
  const a = await canvasSig();
  await setSlider('Dot cell', 30); await page.waitForTimeout(400); const b = await canvasSig();
  await setSlider('Screen angle', 0); await page.waitForTimeout(400); const c = await canvasSig();
  assert(a.h !== b.h && b.h !== c.h, 'unchanged'); return 'preview redraws on each change';
});
await check('Spread grid: 12 columns from the prompt; a Defaults edit (Columns 8) redraws the grid', async () => {
  await run('Make a grid for a 12-column editorial spread');
  await done();
  const cols = () => page.$$eval('.mk-svg g[fill-opacity="0.1"] rect, .mk-svg g[fill-opacity=".1"] rect', r => r.length);
  const a = await cols();
  const input = page.locator('.defaults__row[data-key="cols"] input');
  await input.fill('8'); await input.press('Enter');
  await page.waitForTimeout(300);
  const b = await cols();
  const edited = await page.textContent('[data-testid="defaults-edited"]');
  assert(a === 12 && b === 8 && /1 edited/.test(edited), `${a} → ${b}, ${edited}`);
  return `12 → 8 columns; Defaults shows “${edited}”`;
});
await check('Logo drop: letters fall and settle; the Letters control changes the word', async () => {
  await run('Animate my logo letters falling into place');
  await done();
  const s1 = await canvasSig(); await page.waitForTimeout(300); const s2 = await canvasSig();
  await page.fill('.mk-controls input.l-input', 'Tools');
  await page.waitForTimeout(2600); const s3 = await canvasSig();
  assert(s1.h !== s2.h && s3.h !== s2.h, 'not animating'); return 'animating; word changed to “Tools”';
});
await check('Any other prompt sketches the tool and ends on “Tool generation arrives in v2.”', async () => {
  await page.fill('#make-prompt', 'Sort my moodboard by season and mood'); await page.click('.mk__go');
  await done();
  const note = await page.textContent('.mk__note');
  const sketch = await page.textContent('.mk-sketch');
  assert(note.trim() === 'Tool generation arrives in v2.' && /Sort my moodboard/.test(sketch), `${note} / ${sketch}`);
  return `sketch: ${sketch.replace(/\s+/g, ' ').slice(0, 80)}`;
});
await check('Skip jumps to the end', async () => {
  await run('Turn my photo into a halftone poster');
  await page.click('.mk__skip');
  await done();
  return 'done at once';
});
await check('Reduced motion: the generation appears at once', async () => {
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
  await p2.goto(BASE + '/make', { waitUntil: 'networkidle' });
  await p2.click('.mk__examples .l-chip >> nth=1');
  await p2.waitForSelector('.mk__run[data-done="true"]', { timeout: 1500 });
  await p2.close(); return 'complete within 1.5 s';
});
await check('No server calls (scripted, no API) and no console errors', () => {
  const real = errors.filter(e => !/favicon/.test(e));
  assert(!apiCalls.length && !real.length, `${apiCalls.length} api calls; ${real.slice(0, 2).join(' | ')}`); return 'none';
});

await browser.close(); server.kill();
const n = s => state.results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
