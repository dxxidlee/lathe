// Milestone 1: verify the Lathe shell against the production build (vite preview).
// Usage: npm run verify:shell   (builds first)   or   node verify/shell.mjs  (uses existing dist/)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FX = join(HERE, 'fixtures');
const OUT = join(HERE, 'out', 'shell');
const PORT = 4318;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

function assert(c, m) { if (!c) throw new Error(m); }
async function check(name, fn) {
  let status = 'pass', detail = '';
  try { detail = (await fn()) ?? ''; } catch (e) { status = 'fail'; detail = String(e.message).split('\n')[0]; }
  results.push({ check: name, status, detail });
  console.log(`  ${status === 'pass' ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png') });

function track(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => errors.push(`requestfailed ${r.url().slice(0, 60)} ${r.failure()?.errorText}`));
  return errors;
}

/** Drop real files (from fixtures) onto an element, like a Finder drag. */
async function dropFiles(page, selector, files) {
  const payload = files.map(f => ({ name: basename(f.path), type: f.type, b64: readFileSync(f.path).toString('base64') }));
  await page.evaluate(({ selector, payload }) => {
    const dt = new DataTransfer();
    for (const f of payload) dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, { type: f.type }));
    const el = document.querySelector(selector);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { selector, payload });
}

const statusText = page => page.textContent('[data-testid="status-file"]');
const trayCount = async page => Number(await page.textContent('[data-testid="tray-count"]'));

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return proc; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill(); throw new Error('vite preview did not start');
}

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = track(page);
const mod = 'Meta'; // Chrome on macOS

console.log('lathe shell');

await check('token check: no hardcoded colors, sizes or weights', () => {
  return execFileSync('node', ['scripts/check-tokens.mjs'], { cwd: ROOT }).toString().trim();
});

/* ---- Home ---- */
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await check('Home: the drawing traces in with every tool on it; accessible title', async () => {
  const h1 = await page.textContent('h1');
  const n = await page.locator('.graph__tool').count();
  await page.waitForTimeout(3200); // let the drawing finish
  const bg = await page.$eval('.home', e => getComputedStyle(e).backgroundColor);
  const drawn = await page.$$eval('.graph__draw', ps => ps.every(p => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.001));
  const labels = await page.$$eval('.graph__label', ls => ls.filter(l => getComputedStyle(l).opacity === '1').length);
  assert(/Tools for people who make tools/.test(h1), h1);
  assert(n === 16 && labels === 16 && drawn && bg === 'rgb(232, 255, 26)', `${n} tools, ${labels} labels shown, drawn ${drawn}, ${bg}`);
  await shot(page, 'home-graph');
  return `${n} entries (15 tools + Make a tool), all routes drawn, on chartreuse`;
});
await check('Home: hovering a tool draws its route and fades the rest; click opens it; Tools shows the list', async () => {
  await page.hover('.graph__tool[data-tool="palette"] .graph__label');
  await page.waitForTimeout(400); // opacity transitions
  const st = await page.evaluate(() => {
    const op = el => Number(getComputedStyle(el).strokeOpacity) * Number(getComputedStyle(el).opacity);
    const act = document.querySelector('.graph__tool[data-tool="palette"] .graph__route');
    const other = document.querySelector('.graph__tool[data-tool="dither"] .graph__route');
    const lab = id => Number(getComputedStyle(document.querySelector(`.graph__tool[data-tool="${id}"] .graph__label`)).opacity);
    return { act: op(act), other: op(other), labAct: lab('palette'), labOther: lab('dither'), foot: document.querySelector('.home__foot').textContent };
  });
  await shot(page, 'home-hover');
  assert(st.act === 1 && st.other < 0.2 && st.labAct === 1 && st.labOther < 0.5 && /Palette/.test(st.foot) && /scales and tokens/.test(st.foot), JSON.stringify(st));
  await page.click('.home__link');
  const listed = await page.locator('.toollist__tool').count();
  await page.click('.home__link');
  await page.click('.graph__tool[data-tool="palette"] .graph__label');
  await page.waitForURL('**/t/palette');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  assert(listed === 15, `${listed} in list`);
  return `route ${st.act}, others ${st.other}; footer “${st.foot.slice(0, 60)}…”; list of ${listed}; click → /t/palette`;
});
await check('Brand: favicons, apple-touch-icon and manifest resolve', async () => {
  const hrefs = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]', ls => ls.map(l => l.href));
  for (const h of hrefs) { const r = await fetch(h); assert(r.ok, `${r.status} ${h}`); }
  const m = await (await fetch(BASE + '/manifest.webmanifest')).json();
  for (const i of m.icons) { const r = await fetch(BASE + i.src); assert(r.ok, `${r.status} ${i.src}`); }
  return `${hrefs.length} links, ${m.icons.length} manifest icons`;
});

/* ---- Shell layout ---- */
await page.goto(BASE + '/t/sandbox', { waitUntil: 'networkidle' });
await page.waitForSelector('.sandbox');
await check('Tokens applied: black panels, white text, Helvetica Neue', async () => {
  const s = await page.evaluate(() => { const c = getComputedStyle(document.body); return [c.backgroundColor, c.color, c.fontFamily]; });
  assert(s[0] === 'rgb(0, 0, 0)' && s[1] === 'rgb(255, 255, 255)' && s[2].startsWith('"Helvetica Neue"'), s.join(' | '));
  return s.join(' | ');
});
await check('Wordmark: text + mark, mark at cap height', async () => {
  const m = await page.evaluate(() => {
    const w = document.querySelector('.topbar .lathe-wordmark'), t = w.querySelector('.lathe-wordmark__text'), svg = w.querySelector('svg');
    const fs = parseFloat(getComputedStyle(w).fontSize);
    return { text: t.textContent, weight: getComputedStyle(t).fontWeight, fs, mark: svg.getBoundingClientRect().height, isImg: !!w.querySelector('img') };
  });
  assert(m.text === 'Lathe' && !m.isImg, 'not live text');
  assert(m.weight === '500', 'weight ' + m.weight);
  assert(Math.abs(m.mark - m.fs * 0.714) < 1, `mark ${m.mark}px vs cap ${m.fs * 0.714}px`);
  return `"Lathe" 500 at ${m.fs}px, mark ${m.mark.toFixed(1)}px`;
});
await check('Layout at 1440×900: top bar, rail, stage, inspector, status bar', async () => {
  const r = await page.evaluate(() => Object.fromEntries(['.topbar', '.nav', '.stage', '.inspector', '.statusbar'].map(s => {
    const b = document.querySelector(s).getBoundingClientRect(); return [s, [Math.round(b.width), Math.round(b.height)]];
  })));
  assert(r['.stage'][0] >= 800 && r['.stage'][1] >= 700, 'stage ' + r['.stage']);
  assert(r['.topbar'][1] === 40 && r['.statusbar'][1] === 24 && r['.inspector'][0] === 288 && r['.nav'][0] === 208, JSON.stringify(r));
  await shot(page, 'sandbox-empty');
  return Object.entries(r).map(([k, v]) => `${k.slice(1)} ${v.join('×')}`).join(', ');
});
await check('Defaults panel lists the tool manifest with chosenBy / reason / inheritedFrom', async () => {
  const rows = await page.$$eval('.defaults__row', rs => rs.map(r => r.textContent));
  assert(rows.length === 3 && rows.every(r => /TODO\(David\)/.test(r)), rows.join(' | '));
  assert(rows.some(r => /Inherited from sRGB/.test(r)), 'no inherited row');
  return `${rows.length} rows`;
});

/* ---- Drop anywhere → tool + tray + status bar ---- */
await check('Drop a PNG anywhere: loads into the tool, status bar, tray', async () => {
  await dropFiles(page, '.stage', [{ path: join(FX, 'logo.png'), type: 'image/png' }]);
  await page.waitForSelector('.sandbox__img');
  const st = await statusText(page);
  assert(st === 'logo.png  1500×300  24 KB', JSON.stringify(st));
  assert(await trayCount(page) === 1, 'tray ' + await trayCount(page));
  const stats = await page.$$eval('.l-stat', r => r.map(x => x.textContent));
  return `status "${st}"; inspector: ${stats.join(', ')}`;
});
await check('Drop overlay shows on drag', async () => {
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.png', { type: 'image/png' })); document.querySelector('.stage').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })); });
  const t = await page.textContent('.dropzone');
  await shot(page, 'drop-overlay');
  await page.evaluate(() => document.querySelector('.stage').dispatchEvent(new DragEvent('dragleave', { bubbles: true })));
  assert(/Drop to load into Sandbox/.test(t), t); return t;
});

/* ---- Settings persist ---- */
await check('Tool settings persist across reload (IndexedDB)', async () => {
  await page.click('.l-rail__opt:has-text("Lathe")');
  await page.click('.l-chip:has-text("Actual size")');
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.sandbox__img');
  const m = await page.$eval('.sandbox', el => [el.dataset.matte, el.dataset.view]);
  assert(m[0] === 'lathe' && m[1] === 'actual', m.join(','));
  await page.click('.l-chip:has-text("Fit")');
  await shot(page, 'sandbox-loaded');
  return 'matte=lathe, view=actual, last asset restored';
});

/* ---- Export ---- */
await check(`${mod}+E exports a PNG and adds it to the tray`, async () => {
  const before = await trayCount(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+e`)]);
  const f = join(OUT, dl.suggestedFilename()); await dl.saveAs(f);
  const buf = readFileSync(f);
  assert(buf.readUInt32BE(16) === 1500 && buf.readUInt32BE(20) === 300, 'dims');
  await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) === n + 1, before);
  return `${basename(f)} 1500×300, tray ${before} → ${before + 1}`;
});

/* ---- Tray ---- */
await check('Tray: lists assets with source; Send to; remove; persists', async () => {
  await page.click('.statusbar__tray');
  const items = await page.$$eval('.tray__item', is => is.map(i => i.querySelector('.tray__name').textContent + ' / ' + i.querySelector('.tray__source').textContent));
  assert(items.length === 2 && items.some(i => /Export · sandbox/.test(i)), items.join(' | '));
  await page.locator('.tray__item').first().locator('button:has-text("Send to")').click();
  const targets = await page.$$eval('.menu__item', b => b.map(x => x.textContent));
  assert(targets.includes('Sandbox'), targets.join(','));
  await page.keyboard.press('Escape');
  await shot(page, 'tray-open');
  await page.reload({ waitUntil: 'networkidle' });
  const after = await page.locator('.tray__item').count();
  assert(after === 2, `tray after reload ${after} (open state should persist too)`);
  return items.join(' | ');
});
await check('Send to from another tool switches tools and loads the asset', async () => {
  await page.goto(BASE + '/t/audit', { waitUntil: 'networkidle' });
  const name = await page.locator('.tray__item').last().locator('.tray__name').textContent();
  await page.locator('.tray__item').last().locator('button:has-text("Send to")').click();
  await page.click('.menu__item:has-text("Sandbox")');
  await page.waitForURL('**/t/sandbox');
  await page.waitForFunction(n => document.querySelector('.sandbox__img')?.alt === n, name);
  return `${name} → Sandbox`;
});
await check('Dropping on a tool that is not built yet adds to the tray', async () => {
  await page.goto(BASE + '/t/grid', { waitUntil: 'networkidle' });
  const before = await trayCount(page);
  await dropFiles(page, '.stage', [{ path: join(FX, 'photo.jpg'), type: 'image/jpeg' }]);
  await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) === n + 1, before);
  const t = await page.textContent('.l-toasts');
  assert(/Added photo.jpg to the tray/.test(t), t);
  await shot(page, 'planned-tool');
  return t;
});
await check('Remove from tray', async () => {
  const before = await trayCount(page);
  await page.locator('.tray__item').first().locator('button:has-text("Remove")').click();
  await page.waitForFunction(n => Number(document.querySelector('[data-testid="tray-count"]').textContent) === n - 1, before);
  return `${before} → ${before - 1}`;
});

/* ---- Keyboard ---- */
await check(`${mod}+K palette: fuzzy search, arrows, Enter navigates`, async () => {
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('.palette__input');
  await page.keyboard.type('clrchk');
  const first = await page.textContent('.palette__item[aria-selected="true"] .palette__label');
  await shot(page, 'palette');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/t/color-check');
  assert(first === 'Color-check', first);
  assert(!(await page.$('.palette')), 'palette still open');
  return '"clrchk" → Color-check';
});
await check('Palette closes on Escape and on backdrop click', async () => {
  await page.keyboard.press(`${mod}+k`); await page.waitForSelector('.palette');
  await page.keyboard.press('Escape'); assert(!(await page.$('.palette')), 'Escape');
  await page.keyboard.press(`${mod}+k`); await page.waitForSelector('.palette');
  await page.mouse.click(10, 880); assert(!(await page.$('.palette')), 'backdrop');
  return 'both close';
});
await check('1–9 switch tools in rail order; ignored while typing', async () => {
  await page.keyboard.press('1'); await page.waitForURL('**/t/audit');
  await page.keyboard.press('3'); await page.waitForURL('**/t/palette');
  await page.keyboard.press(`${mod}+k`); await page.waitForSelector('.palette__input');
  await page.keyboard.type('5'); const url = page.url();
  await page.keyboard.press('Escape');
  assert(url.endsWith('/t/palette'), 'navigated while typing: ' + url);
  return '1 → audit, 3 → palette, typing "5" in the palette stays put';
});
await check('? opens the shortcut sheet; Escape closes', async () => {
  await page.keyboard.press('?'); await page.waitForSelector('.l-modal:has-text("Keyboard shortcuts")');
  await shot(page, 'shortcuts');
  await page.keyboard.press('Escape'); assert(!(await page.$('.l-modal')), 'still open');
  return 'ok';
});
await check(`${mod}+Shift+F on an unbuilt tool explains there is nothing to fork`, async () => {
  await page.goto(BASE + '/t/grid', { waitUntil: 'networkidle' }); // still unbuilt (Milestone 8)
  await page.keyboard.press(`${mod}+Shift+f`);
  const t = await page.textContent('.l-toasts'); assert(/Open a built tool to fork it/.test(t), t); return t;
});
await check('Rail collapses and stays collapsed after reload', async () => {
  await page.click('.nav__toggle');
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'networkidle' });
  const w = await page.$eval('.nav', n => Math.round(n.getBoundingClientRect().width));
  await shot(page, 'rail-collapsed');
  await page.click('.nav__toggle');
  assert(w === 40, 'width ' + w); return `collapsed to ${w}px`;
});

/* ---- Routes ---- */
await check('Routes: /make, unknown tool, deep-link reload', async () => {
  await page.goto(BASE + '/make', { waitUntil: 'networkidle' });
  assert(/Describe a tool you wish existed/.test(await page.textContent('.stage')), 'make');
  await shot(page, 'make');
  await page.goto(BASE + '/t/nope', { waitUntil: 'networkidle' });
  assert(/No tool called/.test(await page.textContent('.stage')), 'not found');
  await page.goto(BASE + '/t/sandbox', { waitUntil: 'networkidle' });
  assert(await page.$('.sandbox'), 'deep link');
  return '/make, /t/nope, /t/sandbox';
});
await check('No console errors across the run', () => { assert(!errors.length, errors.join(' | ')); return 'clean'; });

/* ---- IndexedDB blocked ---- */
{
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c2.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); } }); });
  const p2 = await c2.newPage(); const e2 = track(p2);
  await check('IndexedDB blocked: app still works from memory', async () => {
    await p2.goto(BASE + '/t/sandbox', { waitUntil: 'networkidle' });
    await dropFiles(p2, '.stage', [{ path: join(FX, 'logo.png'), type: 'image/png' }]);
    await p2.waitForSelector('.sandbox__img');
    const real = e2.filter(e => !/idb|indexedDB|blocked/i.test(e));
    assert(!real.length, real.join(' | '));
    return `loaded, tray ${await trayCount(p2)}`;
  });
  await c2.close();
}

await browser.close(); server.kill();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const n = s => results.filter(r => r.status === s).length;
console.log(`\n${n('pass')} pass · ${n('fail')} fail`);
process.exit(n('fail') ? 1 : 0);
