/* Icon-set (Export): one SVG or PNG in; a full favicon and app icon set out: PNGs from 16 to 1024,
   favicon.ico (PNG-compressed entries), the source SVG as favicon.svg, an Apple touch icon, a
   maskable icon with its safe zone, manifest.webmanifest and an HTML snippet, zipped. */
import JSZip from 'jszip';
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { canvasBlob, imageInput, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { button, field, note, section, slider, statList } from '../../ui/primitives';
import './icon-set.css';

interface Rendered { name: string; size: number; blob: Blob; kind: 'png' | 'apple' | 'maskable' }

/** favicon.ico with PNG-compressed images (supported by every current browser and Windows Vista+). */
export async function icoFrom(pngs: { size: number; blob: Blob }[]): Promise<Blob> {
  const datas = await Promise.all(pngs.map(async p => new Uint8Array(await p.blob.arrayBuffer())));
  const head = new ArrayBuffer(6 + 16 * pngs.length); const v = new DataView(head);
  v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true);
  let offset = head.byteLength;
  pngs.forEach((p, i) => {
    const o = 6 + i * 16;
    v.setUint8(o, p.size >= 256 ? 0 : p.size); v.setUint8(o + 1, p.size >= 256 ? 0 : p.size);
    v.setUint8(o + 2, 0); v.setUint8(o + 3, 0); v.setUint16(o + 4, 1, true); v.setUint16(o + 6, 32, true);
    v.setUint32(o + 8, datas[i].length, true); v.setUint32(o + 12, offset, true);
    offset += datas[i].length;
  });
  return new Blob([head, ...datas as BlobPart[]], { type: 'image/x-icon' });
}

export const tool: LatheTool = {
  id: 'icons',
  name: 'Icons',
  group: 'Drawer',
  defaults,
  accepts: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    let source: Asset | undefined;
    let svgText: string | null = null;
    let rendered: Rendered[] = [];
    const s = {
      padding: settings.get<number>('padding', d.padding as number),
      applePadding: settings.get<number>('applePadding', d.applePadding as number),
      background: settings.get<string>('background', d.background as string),
      themeColor: settings.get<string>('themeColor', d.themeColor as string),
      appName: settings.get<string>('appName', d.appName as string),
    };
    const sizes = [...(d.sizes as number[])].sort((a, b) => a - b);
    const icoSizes = [...(d.icoSizes as number[])].sort((a, b) => a - b);

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'ic';
    stage.appendChild(root);

    /* ---------------- inspector ---------------- */
    const srcSec = section('Source');
    const stats = statList();
    const input = imageInput({ toolId: 'icons', name: 'Icons', assets, settings, emit, onLoad: a => void load(a), accepts: t => ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'].includes(t) });
    srcSec.body.append(stats.el, input.urlEl, note('An SVG gives the sharpest small sizes and is shipped as favicon.svg too.'));

    const lSec = section('Look');
    const color = (label: string, k: 'background' | 'themeColor') => {
      const w = document.createElement('label'); w.className = 'ic-color';
      const c = document.createElement('input'); c.type = 'color'; c.className = 'l-swatch-input'; c.value = s[k].toLowerCase(); c.setAttribute('aria-label', label);
      c.addEventListener('input', () => { s[k] = c.value.toUpperCase(); settings.set(k, s[k]); schedule(); });
      w.append(c, document.createTextNode(label)); return w;
    };
    const colors = document.createElement('div'); colors.className = 'l-row ic-colors';
    colors.append(color('Background', 'background'), color('Theme color', 'themeColor'));
    const name = field({ label: 'App name', value: s.appName, onChange: v => { s.appName = v.trim() || s.appName; settings.set('appName', s.appName); } });
    lSec.body.append(
      slider({ label: 'Padding', min: 0, max: 40, value: Math.round(s.padding * 100), unit: '%', onChange: v => { s.padding = v / 100; settings.set('padding', s.padding); schedule(); } }).el,
      slider({ label: 'Apple touch padding', min: 0, max: 40, value: Math.round(s.applePadding * 100), unit: '%', onChange: v => { s.applePadding = v / 100; settings.set('applePadding', s.applePadding); schedule(); } }).el,
      colors, name.el,
      note(`Maskable icons keep the mark within ${Math.round((1 - 2 * (d.maskableSafe as number)) * 100)}% of the icon, inside the safe circle.`),
    );

    const oSec = section('Export');
    const zipBtn = button({ label: 'Export icon set (.zip)', primary: true, onClick: () => void exportZip() });
    const send = sendControl({ from: 'icons', type: () => (rendered.length ? 'image/png' : null), get: async () => { const r = rendered.find(x => x.size === 512 && x.kind === 'png') ?? rendered[rendered.length - 1]; return r ? assets.add(r.blob, { name: r.name, source: 'export', origin: 'icons' }) : null; }, emit });
    oSec.body.append(zipBtn, note('PNG sizes, favicon.ico, favicon.svg, apple-touch-icon.png, a maskable icon, manifest.webmanifest and an HTML snippet.'), send.el);
    inspector.append(srcSec.el, lSec.el, oSec.el);

    /* ---------------- rendering ---------------- */
    let img: HTMLImageElement | ImageBitmap | null = null;
    let srcW = 0, srcH = 0;
    async function load(a: Asset) {
      source = a;
      statusbar.set({ name: a.name, width: a.width, height: a.height, bytes: a.size, state: 'Reading' });
      try {
        svgText = a.type === 'image/svg+xml' ? await a.blob.text() : null;
        if (svgText) {
          const url = URL.createObjectURL(a.blob);
          const el = new Image(); el.src = url; await el.decode(); URL.revokeObjectURL(url);
          img = el; srcW = el.naturalWidth || 512; srcH = el.naturalHeight || 512;
        } else { const b = await createImageBitmap(a.blob); img = b; srcW = b.width; srcH = b.height; }
        stats.set([['Name', a.name], ['Type', a.type], ['Size', `${srcW}×${srcH}`], ['File', formatBytes(a.size)]]);
        if (!svgText && Math.max(srcW, srcH) < 512) emit('toast', `This image is ${srcW}×${srcH}; sizes above that will be upscaled`);
        schedule();
      } catch (e) { emit('toast', `Could not read ${a.name}`); console.warn(e); }
    }

    /** One icon: the mark fitted (contain) inside the size minus padding, on an optional background. */
    function draw(size: number, pad: number, bg: string | null): HTMLCanvasElement {
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const ctx = cv.getContext('2d')!;
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
      if (!img) return cv;
      const box = size * (1 - 2 * pad), k = Math.min(box / srcW, box / srcH);
      const w = srcW * k, h = srcH * k, x = (size - w) / 2, y = (size - h) / 2;
      ctx.imageSmoothingQuality = 'high';
      if (svgText || k >= 0.5) { ctx.drawImage(img, x, y, w, h); return cv; }
      // Large rasters shrink in halving steps, which keeps small icons crisp.
      let cur: CanvasImageSource = img, cw = srcW, ch = srcH;
      while (cw * 0.5 > w) {
        const t = document.createElement('canvas'); t.width = Math.round(cw / 2); t.height = Math.round(ch / 2);
        const tc = t.getContext('2d')!; tc.imageSmoothingQuality = 'high'; tc.drawImage(cur, 0, 0, t.width, t.height);
        cur = t; cw = t.width; ch = t.height;
      }
      ctx.drawImage(cur, x, y, w, h);
      return cv;
    }

    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = window.setTimeout(() => void renderAll(), 80); };
    async function renderAll() {
      if (!img) return;
      const out: Rendered[] = [];
      for (const n of sizes) out.push({ name: `icon-${n}.png`, size: n, kind: 'png', blob: await canvasBlob(draw(n, s.padding, null)) });
      out.push({ name: 'apple-touch-icon.png', size: 180, kind: 'apple', blob: await canvasBlob(draw(180, s.applePadding, s.background)) });
      out.push({ name: 'icon-maskable-512.png', size: 512, kind: 'maskable', blob: await canvasBlob(draw(512, d.maskableSafe as number, s.background)) });
      rendered = out;
      paint();
      statusbar.set({ name: source?.name, width: srcW, height: srcH, bytes: source?.size, state: `${out.length + 3} files ready` });
      send.refresh();
    }
    const urls: string[] = [];
    function paint() {
      urls.splice(0).forEach(u => URL.revokeObjectURL(u));
      const u = (b: Blob) => { const x = URL.createObjectURL(b); urls.push(x); return x; };
      const sizesRow = document.createElement('div'); sizesRow.className = 'ic__sizes';
      for (const r of rendered.filter(x => x.kind === 'png')) {
        const f = document.createElement('figure'); f.className = 'ic-size'; f.dataset.size = String(r.size);
        const im = document.createElement('img'); im.src = u(r.blob); im.width = Math.min(r.size, 256); im.height = Math.min(r.size, 256); im.alt = r.name;
        const c = document.createElement('figcaption'); c.textContent = `${r.size}`;
        f.append(im, c); sizesRow.append(f);
      }
      const masks = document.createElement('div'); masks.className = 'ic__masks';
      const shape = (label: string, r: Rendered, cls: string) => {
        const f = document.createElement('figure'); f.className = `ic-mask ${cls}`;
        const im = document.createElement('img'); im.src = u(r.blob); im.alt = label;
        const c = document.createElement('figcaption'); c.textContent = label;
        f.append(im, c); return f;
      };
      const mk = rendered.find(r => r.kind === 'maskable')!, ap = rendered.find(r => r.kind === 'apple')!;
      masks.append(shape('Maskable · circle', mk, 'ic-mask--circle'), shape('Maskable · squircle', mk, 'ic-mask--squircle'), shape('Apple touch icon', ap, 'ic-mask--apple'));
      const tab = document.createElement('div'); tab.className = 'ic-tab';
      const fav = document.createElement('img'); fav.src = u(rendered.find(r => r.size === 32 && r.kind === 'png')?.blob ?? rendered[0].blob); fav.width = 16; fav.height = 16; fav.alt = 'Favicon in a tab';
      tab.append(fav, document.createTextNode(s.appName));
      root.replaceChildren(h('Sizes'), sizesRow, h('Masks and platforms'), masks, h('Browser tab'), tab);
    }
    const h = (t: string) => { const x = document.createElement('h3'); x.className = 'ic__h'; x.textContent = t; return x; };

    /* ---------------- export ---------------- */
    function manifest() {
      return JSON.stringify({
        name: s.appName, short_name: s.appName.slice(0, 12), start_url: '/', display: d.display,
        theme_color: s.themeColor, background_color: s.background,
        icons: [
          ...(sizes.includes(192) ? [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] : []),
          ...(sizes.includes(512) ? [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] : []),
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }, null, 2) + '\n';
    }
    function snippet() {
      return [
        '<link rel="icon" href="/favicon.ico" sizes="any">',
        ...(svgText ? ['<link rel="icon" href="/favicon.svg" type="image/svg+xml">'] : []),
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/manifest.webmanifest">',
        `<meta name="theme-color" content="${s.themeColor}">`, '',
      ].join('\n');
    }
    async function exportZip() {
      if (!img || !rendered.length) { emit('toast', 'Load an SVG or PNG first'); return; }
      const zip = new JSZip();
      for (const r of rendered) zip.file(r.name, r.blob);
      const ico = await icoFrom(await Promise.all(icoSizes.map(async n => ({ size: n, blob: rendered.find(r => r.kind === 'png' && r.size === n)?.blob ?? await canvasBlob(draw(n, s.padding, null)) }))));
      zip.file('favicon.ico', ico);
      if (svgText) zip.file('favicon.svg', svgText);
      zip.file('manifest.webmanifest', manifest());
      zip.file('icons.html', snippet());
      zip.file('README.txt', `Icon set made with Lathe from ${source?.name}.\nCopy every file to your site's root and paste icons.html into <head>.\n`);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const base = (source?.name ?? 'icon').replace(/\.[^.]+$/, '');
      await saveExport(blob, `${base}-icons.zip`, 'icons');
      statusbar.set({ name: source?.name, state: `Exported ${Object.keys(zip.files).length} files · ${formatBytes(blob.size)}` });
    }

    const empty = document.createElement('p'); empty.className = 'ic__empty'; empty.textContent = 'Drop an SVG or a large PNG of your mark, send one from the tray, or fetch a URL.';
    root.append(empty);
    return { unmount() { input.off(); clearTimeout(timer); urls.forEach(x => URL.revokeObjectURL(x)); }, export: () => void exportZip() };
  },
};
