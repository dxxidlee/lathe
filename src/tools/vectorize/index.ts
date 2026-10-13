/* Vectorize (Image): raster to SVG. One color through Potrace (WebAssembly), many colors through
   ImageTracer with an OKLab palette. Color count, smoothing, corner threshold, specks; a live wipe
   or overlay against the original. SVG out. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import type { TraceJob, TraceReply } from './vectorize.worker';
import { kmeans, oklabToRgb, rgbToOklab, rgbToHex, type Lab } from '../../lib/color';
import { decodePixels, imageInput, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { button, chips, note, section, slider, statList } from '../../ui/primitives';
import './vectorize.css';

type Mode = 'one' | 'multi';
type Compare = 'wipe' | 'overlay' | 'svg' | 'raster';
const TURN: Record<string, number> = { black: 0, white: 1, left: 2, right: 3, minority: 4, majority: 5 };

export const tool: LatheTool = {
  id: 'vectorize',
  name: 'Vectorize',
  group: 'Offcuts',
  defaults,
  accepts: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const s = {
      mode: settings.get<Mode>('mode', d.mode as Mode),
      threshold: settings.get<number>('threshold', d.threshold as number),
      invert: settings.get<boolean>('invert', d.invert as boolean),
      colors: settings.get<number>('colors', d.colors as number),
      smoothing: settings.get<number>('smoothing', d.smoothing as number),
      corner: settings.get<number>('corner', d.corner as number),
      speckle: settings.get<number>('speckle', d.speckle as number),
      compare: settings.get<Compare>('compare', d.compare as Compare),
      wipe: 50,
    };
    const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => { s[k] = v; settings.set(k, v); schedule(); };
    let source: Asset | undefined;
    let pixels: ImageData | null = null;
    let srcSize = { w: 0, h: 0 };
    let rasterUrl: string | null = null, svgUrl: string | null = null;
    let svgText = '';
    let jobId = 0;
    let info = { paths: 0, ms: 0, colors: 0 };

    const worker = new Worker(new URL('./vectorize.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TraceReply>) => {
      if (e.data.id !== jobId) return; // a newer job superseded this one
      if (e.data.error || !e.data.svg) { statusbar.set({ name: source?.name, state: `Trace failed: ${e.data.error}` }); emit('toast', `Trace failed: ${e.data.error}`); return; }
      finish(e.data.svg, e.data.ms ?? 0);
    };

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'vz';
    const frame = document.createElement('div'); frame.className = 'vz__frame';
    const raster = document.createElement('img'); raster.className = 'vz__layer vz__raster'; raster.alt = 'Original';
    const vector = document.createElement('img'); vector.className = 'vz__layer vz__vector'; vector.alt = 'Traced SVG';
    const handle = document.createElement('input'); handle.type = 'range'; handle.min = '0'; handle.max = '100'; handle.value = String(s.wipe); handle.className = 'vz__wipe';
    handle.setAttribute('aria-label', 'Wipe between original and SVG');
    handle.addEventListener('input', () => { s.wipe = Number(handle.value); paintCompare(); });
    frame.append(raster, vector, handle);
    const empty = document.createElement('p'); empty.className = 'vz__empty'; empty.textContent = 'Drop a raster image (PNG, JPG, WebP), send one from the tray, or fetch a URL.';
    root.append(frame, empty);
    stage.appendChild(root);
    // Fit the frame to the stage at the image's proportions.
    const fit = () => {
      if (!srcSize.w) return;
      const pad = parseFloat(getComputedStyle(root).paddingLeft) * 2;
      const k = Math.min((root.clientWidth - pad) / srcSize.w, (root.clientHeight - pad) / srcSize.h);
      frame.style.width = `${Math.max(1, srcSize.w * k)}px`; frame.style.height = `${Math.max(1, srcSize.h * k)}px`;
    };
    const ro = new ResizeObserver(fit); ro.observe(root);
    function paintCompare() {
      root.dataset.compare = s.compare;
      frame.style.setProperty('--wipe', `${s.wipe}%`);
      handle.hidden = s.compare !== 'wipe';
    }

    /* ---------------- inspector ---------------- */
    const srcSec = section('Source');
    const stats = statList();
    const input = imageInput({ toolId: 'vectorize', name: 'Vectorize', assets, settings, emit, onLoad: a => void load(a), accepts: t => t.startsWith('image/') && t !== 'image/svg+xml' });
    srcSec.body.append(stats.el, input.fileEl, input.urlEl);

    const tSec = section('Trace');
    const oneCtl = document.createElement('div'), multiCtl = document.createElement('div'), cornerCtl = document.createElement('div');
    tSec.body.append(
      chips<Mode>({ value: s.mode, options: [{ value: 'one', label: 'One color (Potrace)' }, { value: 'multi', label: 'Multi-color (ImageTracer)' }], onChange: v => { set('mode', v as Mode); sync(); } }).el,
      oneCtl, multiCtl,
      slider({ label: 'Smoothing', min: 0, max: 100, value: Math.round(s.smoothing * 100), format: v => (v / 100).toFixed(2), onChange: v => set('smoothing', v / 100) }).el,
      cornerCtl,
      slider({ label: 'Ignore specks', min: 0, max: 100, value: s.speckle, onChange: v => set('speckle', v) }).el,
    );
    oneCtl.append(
      slider({ label: 'Threshold', min: 0, max: 100, value: Math.round(s.threshold * 100), format: v => (v / 100).toFixed(2), onChange: v => set('threshold', v / 100) }).el,
      chips<'dark' | 'light'>({ label: 'Trace', value: s.invert ? 'light' : 'dark', options: [{ value: 'dark', label: 'Dark shapes' }, { value: 'light', label: 'Light shapes' }], onChange: v => set('invert', v === 'light') }).el,
    );
    multiCtl.append(slider({ label: 'Colors', min: 2, max: 32, value: s.colors, onChange: v => set('colors', v) }).el);
    cornerCtl.append(slider({ label: 'Corner threshold', min: 0, max: 133, value: Math.round(s.corner * 100), format: v => (v / 100).toFixed(2), onChange: v => set('corner', v / 100) }).el);
    const tNote = note('');
    tSec.body.append(tNote);

    const cSec = section('Compare');
    cSec.body.append(chips<Compare>({ value: s.compare, options: [{ value: 'wipe', label: 'Wipe' }, { value: 'overlay', label: 'Overlay' }, { value: 'svg', label: 'SVG' }, { value: 'raster', label: 'Original' }], onChange: v => { s.compare = v as Compare; settings.set('compare', v); paintCompare(); } }).el);

    const oSec = section('Export');
    const svgBtn = button({ label: 'Export SVG', primary: true, onClick: () => void exportSvg() });
    const send = sendControl({ from: 'vectorize', type: () => (svgText ? 'image/svg+xml' : null), get: () => resultAsset(), emit });
    oSec.body.append(svgBtn, send.el);
    inspector.append(srcSec.el, tSec.el, cSec.el, oSec.el);

    function sync() {
      oneCtl.hidden = s.mode !== 'one'; cornerCtl.hidden = s.mode !== 'one'; multiCtl.hidden = s.mode !== 'multi';
      tNote.textContent = s.mode === 'one'
        ? 'Potrace: specks are areas in pixels (turdsize); smoothing is curve tolerance; corner threshold is alphamax.'
        : 'ImageTracer with a palette chosen in OKLab: specks are paths shorter than this many nodes; smoothing loosens line and curve fitting.';
      svgBtn.disabled = !svgText;
    }

    /* ---------------- pipeline ---------------- */
    async function load(a: Asset) {
      source = a;
      statusbar.set({ name: a.name, width: a.width, height: a.height, bytes: a.size, state: 'Reading' });
      try {
        const r = await decodePixels(a.blob, d.traceSize as number);
        pixels = r.data; srcSize = { w: r.srcW, h: r.srcH };
        if (rasterUrl) URL.revokeObjectURL(rasterUrl);
        rasterUrl = URL.createObjectURL(a.blob); raster.src = rasterUrl;
        fit();
        root.dataset.loaded = 'true';
        schedule();
      } catch (e) { emit('toast', `Could not read ${a.name}`); console.warn(e); }
    }
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = window.setTimeout(trace, 120); };
    let fillHex = '#000000'; // tokens-allow: fallback content color
    function trace() {
      if (!pixels) return;
      const id = ++jobId;
      statusbar.set({ name: source?.name, width: srcSize.w, height: srcSize.h, bytes: source?.size, state: 'Tracing…' });
      if (s.mode === 'one') {
        const { width: w, height: h, data } = pixels;
        const bw = new ImageData(w, h);
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255;
          const luma = ((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255) * a + (1 - a); // transparent = paper
          const ink = s.invert ? luma > s.threshold : luma < s.threshold;
          const v = ink ? 0 : 255;
          bw.data[i] = bw.data[i + 1] = bw.data[i + 2] = v; bw.data[i + 3] = 255;
          if (ink) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++; }
        }
        fillHex = d.fill === 'from image' && n ? rgbToHex(sr / n, sg / n, sb / n) : '#000000'; // tokens-allow: content color
        info.colors = 1;
        worker.postMessage({ id, kind: 'mono', image: bw, turdsize: s.speckle, alphamax: s.corner, opttolerance: s.smoothing, turnpolicy: TURN[d.turnpolicy as string] ?? 4 } satisfies TraceJob);
      } else {
        const { data } = pixels;
        const pts: Lab[] = []; let transparent = 0;
        const step = Math.max(1, Math.floor(data.length / 4 / 40000));
        for (let i = 0; i < data.length / 4; i += step) { const j = i * 4; if (data[j + 3] < 128) { transparent++; continue; } pts.push(rgbToOklab(data[j], data[j + 1], data[j + 2])); }
        const pal = kmeans(pts, s.colors, 16).map(sw => { const [r, g, b] = oklabToRgb(sw.lab).map(Math.round); return { r, g, b, a: 255 }; });
        if (transparent / (data.length / 4 / step) > 0.01) pal.push({ r: 0, g: 0, b: 0, a: 0 });
        info.colors = pal.filter(p => p.a).length;
        const sm = 0.01 + s.smoothing * 2.5;
        worker.postMessage({ id, kind: 'multi', image: pixels, pal, ltres: sm, qtres: sm, pathomit: s.speckle, blurradius: 0, rightangleenhance: true } satisfies TraceJob);
      }
    }
    function finish(raw: string, ms: number) {
      if (!pixels) return;
      const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.nodeName !== 'svg') { emit('toast', 'The tracer returned no SVG'); return; }
      const pw = pixels.width, ph = pixels.height;
      if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${pw} ${ph}`);
      svg.setAttribute('width', String(srcSize.w)); svg.setAttribute('height', String(srcSize.h));
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.querySelector('desc')?.remove();
      // Drop the layer ImageTracer writes for transparent pixels.
      svg.querySelectorAll('path').forEach(p => { if (p.getAttribute('opacity') === '0' || p.getAttribute('fill-opacity') === '0') p.remove(); });
      if (s.mode === 'one') svg.querySelectorAll('path').forEach(p => { p.setAttribute('fill', fillHex); p.removeAttribute('stroke'); });
      info = { ...info, paths: svg.querySelectorAll('path').length, ms };
      svgText = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
      if (svgUrl) URL.revokeObjectURL(svgUrl);
      svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      vector.src = svgUrl;
      const bytes = new Blob([svgText]).size;
      stats.set([['Name', source?.name ?? ''], ['Source', `${srcSize.w}×${srcSize.h}`], ['Traced at', `${pw}×${ph}`], ['Paths', String(info.paths)], ['Colors', String(info.colors)], ['SVG', formatBytes(bytes)], ['Trace', `${ms} ms`]]);
      statusbar.set({ name: source?.name, width: srcSize.w, height: srcSize.h, bytes: source?.size, state: `${info.paths} paths · ${formatBytes(bytes)} SVG · ${ms} ms` });
      root.dataset.traced = 'true';
      root.dataset.traces = String(Number(root.dataset.traces ?? 0) + 1); // completed traces, for tests and observers
      sync(); send.refresh();
    }

    /* ---------------- export ---------------- */
    const base = () => (source?.name ?? 'image').replace(/\.[^.]+$/, '');
    async function exportSvg() {
      if (!svgText) { emit('toast', 'Load an image to trace first'); return; }
      await saveExport(new Blob([svgText], { type: 'image/svg+xml' }), `${base()}-${s.mode === 'one' ? 'traced' : `${info.colors}c`}.svg`, 'vectorize');
    }
    async function resultAsset() {
      if (!svgText) return null;
      return assets.add(new Blob([svgText], { type: 'image/svg+xml' }), { name: `${base()}-traced.svg`, source: 'export', origin: 'vectorize' });
    }

    paintCompare(); sync();
    return {
      unmount() { input.off(); ro.disconnect(); clearTimeout(timer); worker.terminate(); [rasterUrl, svgUrl].forEach(u => u && URL.revokeObjectURL(u)); },
      export: () => void exportSvg(),
    };
  },
};
