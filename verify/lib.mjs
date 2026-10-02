// Shared harness for verify/run.mjs (reference tools) and verify/port.mjs (Lathe ports):
// check bookkeeping, page tracking, downloads, and file validators (Chrome decode, Ghostscript, ffprobe).
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const HAS_GS = (() => { try { execFileSync('gs', ['--version']); return true; } catch { return false; } })();

/** Mutable run state: current tool, results, output dir, and the validator page (a same-origin
    blank page used to decode images and fonts in Chrome). */
export const state = { tool: '', results: [], out: '', vp: null };

export function log(status, check, detail) {
  const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' }[status];
  console.log(`  ${icon}  ${check}${detail ? ' — ' + detail : ''}`);
}
export function assert(cond, msg) { if (!cond) throw new Error(msg); }
export class Warn extends Error {}

/** Runs one check. fn returns a detail string (pass), throws Error (fail) or Warn (pass-with-note). */
export async function check(name, fn) {
  let status = 'pass', detail = '';
  try { detail = (await fn()) ?? ''; }
  catch (e) { status = e instanceof Warn ? 'warn' : 'fail'; detail = String(e.message).split('\n')[0]; }
  state.results.push({ tool: state.tool, check: name, status, detail });
  log(status, name, detail);
  return status !== 'fail';
}

export async function openPage(ctx, url) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/__fixtures/')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  return { page, errors };
}

export async function shot(page, name) {
  const dir = join(state.out, 'screens'); mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name + '.png') });
}

export async function download(page, action, timeout = 60000) {
  const dir = join(state.out, state.tool); mkdirSync(dir, { recursive: true });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  const file = join(dir, dl.suggestedFilename());
  await dl.saveAs(file);
  const failure = await dl.failure();
  assert(!failure, 'download failed: ' + failure);
  return file;
}

/* ---------------- validators ---------------- */

export function pngInfo(buf) {
  assert(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'not a PNG signature');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
export function jpegInfo(buf) {
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
export async function imgStats(buf, type) {
  return state.vp.evaluate(async ({ b64, type }) => {
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
export async function diffImages(a, b, w, h, mask = false) {
  return state.vp.evaluate(async ({ a, b, w, h, mask }) => {
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
export function gsRender(epsPath) {
  const png = epsPath + '.gs.png';
  execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-dEPSCrop', '-r72', '-sOutputFile=' + png, epsPath], { stdio: 'pipe' });
  return readFileSync(png);
}

export async function validateEps(file, { sourceSvg, mask = false } = {}) {
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

export function ffprobe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
}

export function readText(file) { return readFileSync(file, 'utf8'); }
