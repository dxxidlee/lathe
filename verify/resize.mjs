// Resize (Phase 1): upload a tagged SVG, enter six sizes from 1:1 to 20:1, edit the headline, and
// check every variant updates, with overflow flagged. Engine logic is unit-tested (npm test); this
// drives the tool in Chrome against `vite preview`.
// Usage: npm run verify:resize
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const OUT = join(HERE, 'out', 'resize'); mkdirSync(OUT, { recursive: true });
const PORT = 4327, BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const check = async (name, fn) => {
  try { const d = await fn(); results.push(['PASS', name, d]); console.log(`  PASS  ${name}${d ? ` — ${d}` : ''}`); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log('lathe resize (phase 1)');
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const variants = () => page.$$eval('.rz-card', cs => cs.map(c => ({ size: c.dataset.variant, overflow: c.classList.contains('is-overflow'), flags: [...c.querySelectorAll('.rz-flag')].map(f => f.textContent), meta: c.querySelector('.rz-card__meta').textContent,
  headline: [...c.querySelectorAll('text[data-field="headline"] tspan')].map(t => t.textContent).join(' / '), fontSize: Number(c.querySelector('text[data-field="headline"]')?.getAttribute('font-size') ?? 0) })));
const fontsReady = () => page.waitForFunction(() => !/loading fonts/.test(document.querySelector('.statusbar, [class*="status"]')?.textContent ?? 'loading fonts') , null, { timeout: 30000 });

await check('/resize opens the tool at /t/resize, with a sample rendered', async () => {
  await page.goto(`${BASE}/resize`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.rz-card svg');
  assert(new URL(page.url()).pathname === '/t/resize', page.url());
  await fontsReady();
  return `${(await variants()).length} variants of the sample`;
});
await check('Upload a tagged SVG (logo lockup, old Illustrator export): layers, field and breakpoints read', async () => {
  await page.setInputFiles('.inspector input[type=file]', join(ROOT, 'fixtures', 'logo-lockup.svg'));
  await page.waitForFunction(() => /logo-lockup/.test(document.querySelector('.inspector')?.textContent ?? ''));
  const ins = await page.textContent('.inspector');
  assert(/Layers placed\s*3/.test(ins) && /Text fields\s*1/.test(ins) && /square 0–1.5, wide 1.5–4, ultrawide 4–∞/.test(ins), ins.slice(0, 400));
  return 'logo-lockup.svg: 3 layers, field “brand”, 3 breakpoints';
});
await check('Upload the headline + CTA banner and enter six sizes, 1:1 to 20:1', async () => {
  await page.setInputFiles('.inspector input[type=file]', join(ROOT, 'fixtures', 'headline-cta.svg'));
  await page.waitForFunction(() => /headline-cta/.test(document.querySelector('.inspector')?.textContent ?? ''));
  const ta = page.locator('.inspector textarea').first();
  await ta.fill('1080x1080\n1920 x 1080\n1080×1920\n1200×300\n1500×150\n2000×100');
  await page.waitForFunction(() => document.querySelectorAll('.rz-card').length === 6);
  await fontsReady();
  const v = await variants();
  assert(v.map(x => x.size).join() === '1080x1080,1920x1080,1080x1920,1200x300,1500x150,2000x100', v.map(x => x.size).join());
  assert(v.every(x => !x.overflow && x.headline === 'Summer sale'), JSON.stringify(v));
  assert(v.map(x => x.meta).join('|') === '1:1 · square|16:9 · wide|9:16 · square|4:1 · ultrawide|10:1 · ultrawide|20:1 · ultrawide', v.map(x => x.meta).join('|'));
  await page.screenshot({ path: join(OUT, 'six-sizes.png'), fullPage: true });
  return v.map(x => `${x.size} ${x.fontSize}px`).join(', ');
});
await check('Each variant SVG uses the measured font, and fonts are loaded for drawing', async () => {
  const r = await page.evaluate(async () => ({ fam: document.querySelector('.rz-card text[data-field="headline"]').getAttribute('font-family'), loaded: [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'lr-inter' && f.status === 'loaded').length, fonts: document.querySelector('.rz-fonts').textContent }));
  assert(/lr-inter/.test(r.fam) && r.loaded >= 1 && /Inter-Bold\s*Inter 700/.test(r.fonts), JSON.stringify(r));
  return `${r.fam}; ${r.fonts}`;
});
await check('Typing a longer headline updates every variant at once; small ones overflow, with a red outline and a label', async () => {
  const h = page.locator('.inspector textarea[data-field="headline"]');
  await h.fill('Summer sale on absolutely everything');
  const v = await variants();
  assert(v.every(x => x.headline.replace(/ \/ /g, ' ') === 'Summer sale on absolutely everything'), JSON.stringify(v.map(x => x.headline)));
  const over = v.filter(x => x.overflow);
  assert(over.length >= 1 && over.every(x => x.flags.includes('Headline overflows')), JSON.stringify(v));
  const outline = await page.$eval('.rz-card.is-overflow .rz-card__art', e => getComputedStyle(e).outlineColor);
  assert(outline === 'rgb(255, 59, 48)', outline);
  const state = await page.textContent('.inspector .rz-field__state');
  await page.screenshot({ path: join(OUT, 'overflow.png'), fullPage: true });
  return `${over.map(x => x.size).join(', ')} overflow; shrunk sizes: ${v.filter(x => !x.overflow).map(x => `${x.size} ${x.fontSize.toFixed(1)}px`).join(', ')}; inspector: “${state}”`;
});
await check('Each keystroke re-renders every variant', async () => {
  const h = page.locator('.inspector textarea[data-field="headline"]');
  await h.fill(''); await h.pressSequentially('Sale', { delay: 20 });
  const v = await variants();
  assert(v.every(x => x.headline === 'Sale' && !x.overflow), JSON.stringify(v));
  return 'S, Sa, Sal, Sale: all six show “Sale”';
});
await check('Truncation (CTA) and hide-below (subline) are reported per variant', async () => {
  await page.locator('.inspector textarea[data-field="cta"]').fill('Shop the whole collection');
  const v = await variants();
  assert(v.every(x => x.flags.includes('Cta truncated')), JSON.stringify(v.map(x => x.flags)));
  assert(v.filter(x => x.flags.includes('subline hidden')).map(x => x.size).join() === '1200x300,1500x150,2000x100', JSON.stringify(v.map(x => x.flags)));
  return 'CTA truncated in all six; subline hidden below 400 px tall';
});
await check('State survives a reload (project in local storage)', async () => {
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.rz-card svg'); await fontsReady();
  const v = await variants();
  const val = await page.inputValue('.inspector textarea[data-field="headline"]');
  assert(v.length === 6 && val === 'Sale' && v.every(x => x.headline === 'Sale'), JSON.stringify({ n: v.length, val }));
  return '6 sizes, headline “Sale”';
});
await check('Tiled pattern: tiles fill every ratio', async () => {
  await page.click('.inspector button:text-is("Tiled pattern")');
  await page.waitForFunction(() => /tiled-pattern/.test(document.querySelector('.inspector')?.textContent ?? ''));
  const n = await page.$$eval('.rz-card svg pattern', p => p.length);
  await page.screenshot({ path: join(OUT, 'pattern.png'), fullPage: true });
  assert(n === 12, `${n} patterns`);
  return '2 tiled layers × 6 variants';
});
await check('No console errors', async () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });

await browser.close(); server.kill();
const fails = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
