/* Multi-export: one logo to png/jpg/svg/eps, rgb/cmyk, color/grayscale, zipped.
   Ported from reference/multi-export. Preview on the stage, options in the inspector. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { generate, loadSource, type Fmt, type Source, type Space, type Treat } from './engine';
import { advancedSection, button, chips, field, note, section, slider, statList } from '../../ui/primitives';
import { formatBytes, formatDims } from '../../lib/format';
import { saveExport } from '../../lib/download';
import './multi-export.css';

const ACCEPT = ['image/png', 'image/jpeg', 'image/svg+xml'];

export const tool: LatheTool = {
  id: 'logo-export',
  name: 'Logo Export',
  group: 'Workbench',
  defaults,
  accepts: ACCEPT,

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const min = d.rasterMin as number, max = d.rasterMax as number;
    const state = {
      fmts: settings.get<Fmt[]>('formats', d.formats as Fmt[]),
      spaces: settings.get<Space[]>('colorSpaces', d.colorSpaces as Space[]),
      treats: settings.get<Treat[]>('treatments', d.treatments as Treat[]),
      size: settings.get<number>('rasterSize', d.rasterSize as number),
      previewOn: settings.get<'light' | 'dark'>('previewOn', d.previewOn as 'light' | 'dark'),
    };
    let src: Source | null = null;
    let busy = false;

    /* ---- stage ---- */
    const root = document.createElement('div');
    root.className = 'mx';
    const surface = document.createElement('div');
    surface.className = 'mx__surface';
    root.appendChild(surface);
    stage.appendChild(root);
    const fileInput = document.createElement('input');
    Object.assign(fileInput, { type: 'file', accept: '.png,.jpg,.jpeg,.svg,' + ACCEPT.join(','), hidden: true });
    root.appendChild(fileInput);

    const paintSurface = () => { root.dataset.surface = state.previewOn; };
    const showEmpty = () => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mx__empty';
      b.textContent = 'Drop a logo anywhere (.png, .jpg, .svg), or click to choose one.';
      b.addEventListener('click', () => fileInput.click());
      surface.replaceChildren(b);
    };

    /* ---- inspector ---- */
    const srcSec = section('Source');
    const stats = statList();
    srcSec.body.append(stats.el, button({ label: 'Choose file', onClick: () => fileInput.click() }));

    const opts = section('Output');
    opts.body.append(
      chips<Fmt>({ label: 'File formats', multi: true, value: state.fmts,
        options: [{ value: 'png', label: '.png' }, { value: 'jpg', label: '.jpg' }, { value: 'svg', label: '.svg' }, { value: 'eps', label: '.eps' }],
        onChange: v => { state.fmts = v as Fmt[]; settings.set('formats', v); summarize(); } }).el,
      chips<Space>({ label: 'Color space', multi: true, value: state.spaces,
        options: [{ value: 'rgb', label: 'rgb' }, { value: 'cmyk', label: 'cmyk' }],
        onChange: v => { state.spaces = v as Space[]; settings.set('colorSpaces', v); summarize(); } }).el,
      note('cmyk is only available for .jpg and .eps.'),
      chips<Treat>({ label: 'Treatment', multi: true, value: state.treats,
        options: [{ value: 'color', label: 'Color' }, { value: 'grayscale', label: 'Grayscale' }],
        onChange: v => { state.treats = v as Treat[]; settings.set('treatments', v); summarize(); } }).el,
    );
    const size = field({ label: `Raster size (px longest edge, ${min}–${max})`, type: 'number', value: String(state.size),
      onChange: v => {
        const n = Math.max(min, Math.min(max, parseInt(v, 10) || (d.rasterSize as number)));
        state.size = n; size.input.value = String(n); settings.set('rasterSize', n);
      } });
    Object.assign(size.input, { min: String(min), max: String(max), step: '1' });
    size.input.setAttribute('aria-label', 'Raster size in pixels');
    opts.body.append(size.el);

    const view = section('Preview');
    view.body.append(chips<'light' | 'dark'>({ label: 'Surface', value: state.previewOn,
      options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      onChange: v => { state.previewOn = v as 'light' | 'dark'; settings.set('previewOn', v); paintSurface(); } }).el);

    const out = section('Export');
    const zipBtn = button({ label: 'Export .zip', primary: true, onClick: () => void run() });
    const status = note('');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    out.body.append(zipBtn, status);
    const advSec = advancedSection();
    advSec.body.append(
      slider({ label: 'JPEG quality', min: 1, max: 100, value: d.jpegQuality as number, unit: '%', onChange: v => { (d as Record<string, unknown>).jpegQuality = v; } }).el,
      field({ label: 'JPEG matte', value: d.jpgMatte as string, onChange: v => { (d as Record<string, unknown>).jpgMatte = v; } }).el,
      slider({ label: 'Smallest raster', min: 16, max: 16000, value: d.rasterMin as number, unit: ' px', onChange: v => { (d as Record<string, unknown>).rasterMin = v; } }).el,
      slider({ label: 'Largest raster', min: 16, max: 16000, value: d.rasterMax as number, unit: ' px', onChange: v => { (d as Record<string, unknown>).rasterMax = v; } }).el,
      slider({ label: 'Raster EPS size', min: 16, max: 4000, value: d.epsRasterMax as number, unit: ' px', onChange: v => { (d as Record<string, unknown>).epsRasterMax = v; } }).el,
    );
    inspector.append(srcSec.el, opts.el, view.el, advSec.el, out.el);

    function summarize() {
      zipBtn.disabled = !src || busy;
      if (!src) status.textContent = 'Load a logo to export.';
    }
    const setState = (s: string) => {
      status.textContent = s;
      if (src) statusbar.set({ name: src.fileName, width: src.img.naturalWidth, height: src.img.naturalHeight, bytes: src.fileSize, state: s });
    };

    /* ---- load ---- */
    async function load(a: Asset) {
      if (!ACCEPT.includes(a.type) && !/\.(png|jpe?g|svg)$/i.test(a.name)) { emit('toast', `Logo Export takes PNG, JPG or SVG, not ${a.type || 'this file'}`); return; }
      try {
        src = await loadSource(a.blob, a.name);
      } catch (e) {
        emit('toast', e instanceof Error ? e.message : 'Could not read that image.'); return;
      }
      settings.set('lastAsset', a.id);
      const img = document.createElement('img');
      img.className = 'mx__img'; img.alt = 'Preview'; img.src = src.dataUrl;
      surface.replaceChildren(img);
      const w = src.img.naturalWidth, h = src.img.naturalHeight;
      stats.set([['Name', a.name], ['Dimensions', formatDims(w, h)], ['Size', formatBytes(src.fileSize)], ['Kind', src.isSvg ? 'Vector (SVG)' : 'Raster']]);
      statusbar.set({ name: a.name, width: w, height: h, bytes: src.fileSize, state: 'Ready' });
      status.textContent = '';
      summarize();
    }
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0]; fileInput.value = '';
      if (!f) return;
      await load(await assets.add(f, { source: 'drop' }));
    });

    /* ---- export ---- */
    async function run() {
      if (!src || busy) { if (!src) emit('toast', 'Load a logo first'); return; }
      busy = true; summarize(); setState('Rendering…');
      try {
        const r = await generate(src, {
          fmts: state.fmts, spaces: state.spaces, treats: state.treats, size: state.size,
          jpegQuality: d.jpegQuality as number, jpgMatte: d.jpgMatte as string,
          epsRasterMax: d.epsRasterMax as number, grayWeights: d.grayWeights as number[],
        }, setState);
        if ('error' in r) { setState(r.error); return; }
        await saveExport(r.blob, r.zipName, 'logo-export');
        setState(`Export completed: ${r.count} files across ${r.folders} folders.${r.notes.length ? ' ' + r.notes.join(' ') : ''}`);
      } catch (err) {
        console.error(err);
        setState('Something went wrong while generating.');
      } finally {
        busy = false; summarize();
      }
    }

    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'logo-export') void load(e.asset); });

    paintSurface();
    const last = assets.get(settings.get<string>('lastAsset', ''));
    if (last) void load(last); else { showEmpty(); stats.set([['Name', '—']]); summarize(); }

    return {
      unmount() { off(); },
      export: () => void run(),
    };
  },
};
