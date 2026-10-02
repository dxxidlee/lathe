/* Dither (Image): Bayer 2/4/8, Floyd–Steinberg, Atkinson, halftone dots and lines; threshold,
   scale, two colors or a palette from the image. PNG out, and SVG for halftones. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { dither, drawHalftone, halftone, halftoneSvg, hexToRgbTriple, isHalftone, rgbHex, type Method, type RGB } from './engine';
import { kmeans, rgbToOklab, oklabToRgb, type Lab } from '../../lib/color';
import { canvasBlob, decodePixels, imageInput, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { button, chips, note, section, slider, statList } from '../../ui/primitives';
import './dither.css';

const METHODS: { value: Method; label: string }[] = [
  { value: 'bayer2', label: 'Bayer 2' }, { value: 'bayer4', label: 'Bayer 4' }, { value: 'bayer8', label: 'Bayer 8' },
  { value: 'floyd', label: 'Floyd–Steinberg' }, { value: 'atkinson', label: 'Atkinson' },
  { value: 'dots', label: 'Halftone dots' }, { value: 'lines', label: 'Halftone lines' },
];
type ColorMode = 'two' | 'palette';
type View = 'fit' | 'actual';

export const tool: LatheTool = {
  id: 'dither',
  name: 'Dither',
  group: 'Image',
  defaults,
  accepts: ['image/*'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const s = {
      method: settings.get<Method>('method', d.method as Method),
      threshold: settings.get<number>('threshold', d.threshold as number),
      scale: settings.get<number>('scale', d.scale as number),
      cell: settings.get<number>('cell', d.cell as number),
      angle: settings.get<number>('angle', d.angle as number),
      gain: settings.get<number>('gain', d.gain as number),
      colorMode: settings.get<ColorMode>('colorMode', d.colorMode as ColorMode),
      ink: settings.get<string>('ink', d.ink as string),
      paper: settings.get<string>('paper', d.paper as string),
      count: settings.get<number>('paletteCount', d.paletteCount as number),
      view: settings.get<View>('view', 'fit'),
    };
    const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => { s[k] = v; settings.set(k === 'count' ? 'paletteCount' : k, v); schedule(); };
    let source: Asset | undefined;
    let pixels: ImageData | null = null;   // at working size
    let palette: RGB[] = [];
    let srcSize = { w: 0, h: 0 };
    let compare = false;

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'dt';
    const cv = document.createElement('canvas'); cv.className = 'dt__canvas';
    const orig = document.createElement('canvas'); orig.className = 'dt__canvas dt__orig';
    const empty = document.createElement('p'); empty.className = 'dt__empty'; empty.textContent = 'Drop an image, send one from the tray, or fetch a URL.';
    root.append(cv, orig, empty);
    stage.appendChild(root);
    const paintView = () => { root.dataset.view = s.view; root.dataset.compare = String(compare); };
    // Hold to compare with the original
    root.addEventListener('pointerdown', () => { compare = true; paintView(); });
    const release = () => { if (compare) { compare = false; paintView(); } };
    window.addEventListener('pointerup', release);

    /* ---------------- inspector ---------------- */
    const srcSec = section('Source');
    const stats = statList();
    const input = imageInput({ toolId: 'dither', name: 'Dither', assets, settings, emit, onLoad: a => void load(a) });
    srcSec.body.append(stats.el, input.urlEl);

    const mSec = section('Method');
    const ordered = document.createElement('div'); const halfCtl = document.createElement('div');
    mSec.body.append(
      chips<Method>({ value: s.method, options: METHODS, onChange: v => { set('method', v as Method); sync(); } }).el,
      slider({ label: 'Threshold', min: 0, max: 100, value: Math.round(s.threshold * 100), format: v => (v / 100).toFixed(2), onChange: v => set('threshold', v / 100) }).el,
      ordered, halfCtl,
    );
    ordered.append(slider({ label: 'Pixel size', min: 1, max: 16, value: s.scale, unit: ' px', onChange: v => set('scale', v) }).el);
    halfCtl.append(
      slider({ label: 'Cell', min: 3, max: 80, value: s.cell, unit: ' px', onChange: v => set('cell', v) }).el,
      slider({ label: 'Angle', min: 0, max: 180, value: s.angle, unit: '°', onChange: v => set('angle', v) }).el,
      slider({ label: 'Gain', min: 20, max: 300, value: Math.round(s.gain * 100), format: v => (v / 100).toFixed(2), onChange: v => set('gain', v / 100) }).el,
    );

    const cSec = section('Colors');
    const twoCtl = document.createElement('div'); twoCtl.className = 'l-row dt-two';
    const palCtl = document.createElement('div');
    const colorIn = (label: string, k: 'ink' | 'paper') => {
      const w = document.createElement('label'); w.className = 'dt-color';
      const c = document.createElement('input'); c.type = 'color'; c.className = 'l-swatch-input'; c.value = s[k].toLowerCase(); c.setAttribute('aria-label', label);
      c.addEventListener('input', () => set(k, c.value.toUpperCase()));
      w.append(c, document.createTextNode(label)); return w;
    };
    twoCtl.append(colorIn('Ink', 'ink'), colorIn('Paper', 'paper'), button({ label: 'Swap', onClick: () => { const t = s.ink; s.ink = s.paper; s.paper = t; settings.set('ink', s.ink); settings.set('paper', s.paper); twoCtl.querySelectorAll('input').forEach((el, i) => { (el as HTMLInputElement).value = (i ? s.paper : s.ink).toLowerCase(); }); schedule(); } }));
    const palView = document.createElement('div'); palView.className = 'dt-pal';
    palCtl.append(slider({ label: 'Colors from the image', min: 2, max: 16, value: s.count, onChange: v => { s.count = v; settings.set('paletteCount', v); buildPalette(); schedule(); } }).el, palView);
    cSec.body.append(
      chips<ColorMode>({ value: s.colorMode, options: [{ value: 'two', label: 'Two colors' }, { value: 'palette', label: 'Palette' }], onChange: v => { set('colorMode', v as ColorMode); sync(); } }).el,
      twoCtl, palCtl,
      note('Halftones always print one ink on paper.'),
    );

    const vSec = section('View');
    vSec.body.append(chips<View>({ value: s.view, options: [{ value: 'fit', label: 'Fit' }, { value: 'actual', label: 'Actual pixels' }], onChange: v => { s.view = v as View; settings.set('view', v); paintView(); } }).el,
      note('Press and hold the image to compare with the original.'));

    const oSec = section('Export');
    const pngBtn = button({ label: 'Export PNG', primary: true, onClick: () => void exportPng() });
    const svgBtn = button({ label: 'Export SVG', onClick: () => void exportSvg() });
    const oRow = document.createElement('div'); oRow.className = 'l-row'; oRow.append(pngBtn, svgBtn);
    const send = sendControl({ from: 'dither', type: () => (pixels ? 'image/png' : null), get: () => resultAsset(), emit });
    oSec.body.append(oRow, note('PNG at the source size. SVG for halftones: dots and bands as vector paths.'), send.el);
    inspector.append(srcSec.el, mSec.el, cSec.el, vSec.el, oSec.el);

    function sync() {
      const ht = isHalftone(s.method);
      ordered.hidden = ht; halfCtl.hidden = !ht;
      palCtl.hidden = s.colorMode !== 'palette' || ht;
      svgBtn.disabled = !ht || !pixels; pngBtn.disabled = !pixels;
    }

    /* ---------------- pipeline ---------------- */
    async function load(a: Asset) {
      source = a;
      statusbar.set({ name: a.name, width: a.width, height: a.height, bytes: a.size, state: 'Reading' });
      try {
        const r = await decodePixels(a.blob, d.workingSize as number);
        pixels = r.data; srcSize = { w: r.srcW, h: r.srcH };
        const o = orig.getContext('2d')!; orig.width = pixels.width; orig.height = pixels.height; o.putImageData(pixels, 0, 0);
        buildPalette(); empty.hidden = true; sync(); schedule();
      } catch (e) { emit('toast', `Could not read ${a.name}`); console.warn(e); }
    }
    function buildPalette() {
      if (!pixels) return;
      const pts: Lab[] = [];
      const step = Math.max(1, Math.floor((pixels.width * pixels.height) / 40000));
      for (let i = 0; i < pixels.width * pixels.height; i += step) { const j = i * 4; if (pixels.data[j + 3] >= 128) pts.push(rgbToOklab(pixels.data[j], pixels.data[j + 1], pixels.data[j + 2])); }
      palette = kmeans(pts, s.count, 16).map(sw => oklabToRgb(sw.lab).map(Math.round) as RGB).sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      palView.replaceChildren(...palette.map(c => { const x = document.createElement('span'); x.className = 'dt-pal__sw'; x.style.background = rgbHex(c); x.title = rgbHex(c); return x; }));
    }
    let raf = 0, timer = 0;
    const schedule = () => { clearTimeout(timer); timer = window.setTimeout(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderNow); }, 30); };
    const inkRgb = () => hexToRgbTriple(s.ink) ?? [0, 0, 0];
    const paperRgb = () => hexToRgbTriple(s.paper) ?? [255, 255, 255];

    /** Draw the result into `target` at `w`×`h` output pixels. */
    function drawResult(target: HTMLCanvasElement | OffscreenCanvas, w: number, h: number, transparentPaper = false) {
      if (!pixels) return;
      target.width = w; target.height = h;
      const ctx = target.getContext('2d') as CanvasRenderingContext2D;
      if (isHalftone(s.method)) {
        const ht = halftone(pixels, { method: s.method as 'dots' | 'lines', cell: s.cell * pixels.width / srcSize.w, angle: s.angle, threshold: s.threshold, gain: s.gain });
        drawHalftone(ctx, ht, w / pixels.width, inkRgb(), transparentPaper ? null : paperRgb());
        return ht;
      }
      // One dither pixel per `scale` source pixels; whole cells from the top left, so an export at the
      // source size is made of exact scale × scale blocks (the last row and column may be cropped).
      const scale = Math.max(1, s.scale * pixels.width / srcSize.w);
      const ww = Math.max(1, Math.ceil(pixels.width / scale)), hh = Math.max(1, Math.ceil(pixels.height / scale));
      const small = new OffscreenCanvas(ww, hh); const sctx = small.getContext('2d')!;
      const tmp = new OffscreenCanvas(pixels.width, pixels.height); tmp.getContext('2d')!.putImageData(pixels, 0, 0);
      sctx.imageSmoothingQuality = 'high'; sctx.drawImage(tmp, 0, 0, ww, hh);
      const pal = s.colorMode === 'palette' && palette.length ? palette : [inkRgb(), paperRgb()];
      const out = dither(sctx.getImageData(0, 0, ww, hh), { method: s.method, palette: pal, threshold: s.threshold, serpentine: d.serpentine as boolean });
      sctx.putImageData(out, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const px = s.scale * w / srcSize.w; // output pixels per dither pixel
      ctx.drawImage(small, 0, 0, ww * px, hh * px);
      return null;
    }
    function renderNow() {
      if (!pixels || !source) return;
      const t0 = performance.now();
      drawResult(cv, pixels.width, pixels.height);
      const ms = Math.round(performance.now() - t0);
      const ht = isHalftone(s.method);
      stats.set([['Name', source.name], ['Source', `${srcSize.w}×${srcSize.h}`], ['Working', `${pixels.width}×${pixels.height}`],
        ht ? ['Cell', `${s.cell} px at ${s.angle}°`] : ['Dither grid', `${Math.round(srcSize.w / s.scale)}×${Math.round(srcSize.h / s.scale)}`],
        ['Colors', ht ? '1 ink' : s.colorMode === 'palette' ? String(palette.length) : '2'], ['Render', `${ms} ms`]]);
      statusbar.set({ name: source.name, width: srcSize.w, height: srcSize.h, bytes: source.size, state: `${METHODS.find(m => m.value === s.method)!.label} · ${ms} ms` });
      send.refresh(); sync();
    }

    /* ---------------- export ---------------- */
    const base = () => `${(source?.name ?? 'image').replace(/\.[^.]+$/, '')}-${s.method}`;
    async function renderPng(): Promise<Blob | null> {
      if (!pixels) return null;
      const out = new OffscreenCanvas(1, 1);
      drawResult(out, srcSize.w, srcSize.h, isHalftone(s.method) && (d.transparentPaper as boolean));
      return canvasBlob(out, 'image/png');
    }
    async function exportPng() {
      const b = await renderPng(); if (!b) { emit('toast', 'Load an image first'); return; }
      await saveExport(b, `${base()}.png`, 'dither');
    }
    async function exportSvg() {
      if (!pixels || !isHalftone(s.method)) { emit('toast', 'SVG is for halftones'); return; }
      const ht = halftone(pixels, { method: s.method as 'dots' | 'lines', cell: s.cell * pixels.width / srcSize.w, angle: s.angle, threshold: s.threshold, gain: s.gain });
      const svg = halftoneSvg(ht, srcSize.w, srcSize.h, inkRgb(), (d.transparentPaper as boolean) ? null : paperRgb());
      await saveExport(new Blob([svg], { type: 'image/svg+xml' }), `${base()}.svg`, 'dither');
    }
    async function resultAsset() {
      const b = await renderPng(); if (!b) return null;
      return assets.add(b, { name: `${base()}.png`, source: 'export', origin: 'dither' });
    }

    paintView(); sync();
    return {
      unmount() { input.off(); clearTimeout(timer); cancelAnimationFrame(raf); window.removeEventListener('pointerup', release); },
      export: () => void exportPng(),
    };
  },
};
