/* Cutout (Image): in-browser background removal with @imgly/background-removal (AGPL-3.0; see
   LICENSES.md). The model runs on this device; its files download once from the host in Defaults.
   Edge refine (shift, hardness, feather), transparent PNG or WebP out, and Send to any tool. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { composite, maskCanvas, refineMask } from './refine';
import { canvasBlob, imageInput, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { button, chips, note, section, slider, statList } from '../../ui/primitives';
import './cutout.css';

type Backdrop = 'checker' | 'black' | 'white' | 'lathe';
type View = 'cutout' | 'mask' | 'original';

export const tool: LatheTool = {
  id: 'cutout',
  name: 'Cutout',
  group: 'Image',
  defaults,
  accepts: ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp', 'image/gif'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const s = {
      shift: settings.get<number>('shift', d.shift as number),
      hardness: settings.get<number>('hardness', d.hardness as number),
      feather: settings.get<number>('feather', d.feather as number),
      backdrop: settings.get<Backdrop>('backdrop', d.backdrop as Backdrop),
      view: 'cutout' as View,
    };
    let source: Asset | undefined;
    let bitmap: ImageBitmap | null = null;
    let rawMask: OffscreenCanvas | null = null;
    let result: OffscreenCanvas | null = null;
    let size = { w: 0, h: 0 };
    let runId = 0;
    let busy = false;

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'co';
    const view = document.createElement('canvas'); view.className = 'co__canvas';
    const status = document.createElement('div'); status.className = 'co__status';
    const bar = document.createElement('div'); bar.className = 'co__bar'; const fill = document.createElement('div'); fill.className = 'co__fill'; bar.append(fill);
    const msg = document.createElement('p'); msg.className = 'co__msg'; msg.textContent = 'Drop a photo, send one from the tray, or fetch a URL. The background is removed on this device.';
    status.append(msg, bar);
    root.append(view, status);
    stage.appendChild(root);
    const paintBackdrop = () => { root.dataset.backdrop = s.backdrop; root.dataset.view = s.view; };

    /* ---------------- inspector ---------------- */
    const srcSec = section('Source');
    const stats = statList();
    const input = imageInput({ toolId: 'cutout', name: 'Cutout', assets, settings, emit, onLoad: a => void run(a), accepts: t => t.startsWith('image/') && t !== 'image/svg+xml' });
    srcSec.body.append(stats.el, input.urlEl);

    const eSec = section('Edge');
    const debounced = (() => { let t = 0; return () => { clearTimeout(t); t = window.setTimeout(applyRefine, 60); }; })();
    eSec.body.append(
      slider({ label: 'Shift', min: -20, max: 20, value: s.shift, unit: ' px', onChange: v => { s.shift = v; settings.set('shift', v); debounced(); } }).el,
      slider({ label: 'Hardness', min: 0, max: 100, value: Math.round(s.hardness * 100), format: v => (v / 100).toFixed(2), onChange: v => { s.hardness = v / 100; settings.set('hardness', s.hardness); debounced(); } }).el,
      slider({ label: 'Feather', min: 0, max: 40, step: 0.5, value: s.feather, unit: ' px', onChange: v => { s.feather = v; settings.set('feather', v); debounced(); } }).el,
      note('Shift chokes (−) or spreads (+) the edge; hardness tightens the soft fringe; feather blurs it.'),
    );

    const vSec = section('View');
    vSec.body.append(
      chips<View>({ value: s.view, options: [{ value: 'cutout', label: 'Cutout' }, { value: 'mask', label: 'Mask' }, { value: 'original', label: 'Original' }], onChange: v => { s.view = v as View; paintBackdrop(); draw(); } }).el,
      chips<Backdrop>({ label: 'Backdrop', value: s.backdrop, options: [{ value: 'checker', label: 'Checker' }, { value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'lathe', label: 'Lathe' }], onChange: v => { s.backdrop = v as Backdrop; settings.set('backdrop', v); paintBackdrop(); } }).el,
    );

    const oSec = section('Export');
    const oRow = document.createElement('div'); oRow.className = 'l-row';
    const pngBtn = button({ label: 'Export PNG', primary: true, onClick: () => void exp('image/png') });
    const webpBtn = button({ label: 'Export WebP', onClick: () => void exp('image/webp') });
    oRow.append(pngBtn, webpBtn);
    const send = sendControl({ from: 'cutout', type: () => (result ? 'image/png' : null), get: () => resultAsset(), emit });
    oSec.body.append(oRow, note('Transparent PNG or WebP at the processed size.'), send.el);
    inspector.append(srcSec.el, eSec.el, vSec.el, oSec.el);

    const setBusy = (b: boolean, text?: string, frac?: number) => {
      busy = b; root.dataset.busy = String(b);
      if (text) msg.textContent = text;
      fill.style.transform = `scaleX(${frac ?? 0})`; bar.hidden = frac == null;
      pngBtn.disabled = webpBtn.disabled = !result || b;
    };

    /* ---------------- pipeline ---------------- */
    async function run(a: Asset) {
      const id = ++runId;
      source = a; rawMask = null; result = null;
      statusbar.set({ name: a.name, width: a.width, height: a.height, bytes: a.size, state: 'Loading model' });
      try {
        bitmap?.close();
        const bmp = await createImageBitmap(a.blob);
        const k = Math.min(1, (d.maxSize as number) / Math.max(bmp.width, bmp.height));
        size = { w: Math.round(bmp.width * k), h: Math.round(bmp.height * k) };
        bitmap = k < 1 ? await createImageBitmap(bmp, { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'high' }) : bmp;
        if (k < 1) bmp.close();
        s.view = s.view === 'mask' ? 'mask' : 'cutout';
        draw(true);
        setBusy(true, 'Loading the segmentation model…', 0);
        const t0 = performance.now();
        const { segmentForeground } = await import('@imgly/background-removal');
        const seen = new Map<string, [number, number]>();
        const maskBlob = await segmentForeground(a.blob, {
          model: d.model as 'isnet' | 'isnet_fp16' | 'isnet_quint8', device: d.device as 'cpu' | 'gpu', publicPath: d.assetHost as string,
          output: { format: 'image/png', quality: 1 },
          progress: (key, cur, total) => {
            if (id !== runId) return;
            seen.set(key, [cur, total]);
            const [c, t] = [...seen.values()].reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
            const done = t && c >= t;
            setBusy(true, done ? 'Finding the subject…' : `Downloading the model (first run only): ${formatBytes(c)} of ${formatBytes(t)}`, t ? c / t : 0);
          },
        });
        if (id !== runId) return;
        rawMask = await maskCanvas(maskBlob, size.w, size.h);
        const ms = Math.round(performance.now() - t0);
        setBusy(false);
        applyRefine();
        stats.set([['Name', a.name], ['Source', a.width && a.height ? `${a.width}×${a.height}` : '—'], ['Processed', `${size.w}×${size.h}`], ['Model', `${d.model} · ${d.device}`], ['Time', `${(ms / 1000).toFixed(1)} s`]]);
      } catch (e) {
        if (id !== runId) return;
        console.warn('[cutout]', e);
        setBusy(false, `Background removal failed: ${e instanceof Error ? e.message : e}`);
        statusbar.set({ name: a.name, state: 'Failed' });
      }
    }
    function applyRefine() {
      if (!rawMask || !bitmap) return;
      const t0 = performance.now();
      const m = refineMask(rawMask, { shift: s.shift, hardness: s.hardness, feather: s.feather });
      result = composite(bitmap, m);
      maskView = m;
      draw();
      // Coverage: share of the frame kept, for the status bar.
      const a = m.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, m.width, m.height).data;
      let sum = 0; for (let i = 3; i < a.length; i += 16) sum += a[i];
      const cover = sum / (a.length / 16) / 255;
      statusbar.set({ name: source?.name, width: size.w, height: size.h, bytes: source?.size, state: `${Math.round(cover * 100)}% kept · refine ${Math.round(performance.now() - t0)} ms` });
      setBusy(false); send.refresh();
      root.dataset.done = 'true';
    }
    let maskView: OffscreenCanvas | null = null;
    function draw(originalOnly = false) {
      if (!bitmap) return;
      view.width = size.w; view.height = size.h;
      const ctx = view.getContext('2d')!;
      ctx.clearRect(0, 0, size.w, size.h);
      if (originalOnly || s.view === 'original' || !result) { ctx.drawImage(bitmap, 0, 0, size.w, size.h); return; }
      if (s.view === 'mask' && maskView) {
        ctx.fillStyle = getComputedStyle(root).getPropertyValue('--black').trim();
        ctx.fillRect(0, 0, size.w, size.h); ctx.drawImage(maskView, 0, 0); return;
      }
      ctx.drawImage(result, 0, 0);
    }

    /* ---------------- export ---------------- */
    const base = () => (source?.name ?? 'image').replace(/\.[^.]+$/, '');
    async function exp(type: 'image/png' | 'image/webp') {
      if (!result) { emit('toast', 'Load an image first'); return; }
      const b = await canvasBlob(result, type, type === 'image/webp' ? d.webpQuality as number : undefined);
      await saveExport(b, `${base()}-cutout.${type === 'image/png' ? 'png' : 'webp'}`, 'cutout');
      statusbar.set({ name: source?.name, width: size.w, height: size.h, state: `Exported ${formatBytes(b.size)}` });
    }
    async function resultAsset() {
      if (!result) return null;
      return assets.add(await canvasBlob(result, 'image/png'), { name: `${base()}-cutout.png`, source: 'export', origin: 'cutout' });
    }

    paintBackdrop(); setBusy(false);
    return {
      unmount() { runId++; input.off(); bitmap?.close(); },
      export: () => { if (!busy) void exp('image/png'); },
    };
  },
};
