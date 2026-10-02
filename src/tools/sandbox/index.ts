/* Sandbox: the development tool that proves the contract end to end. It loads an image
   (drop, tray, "Send to"), builds its inspector from shared primitives, persists settings,
   drives the status bar, and exports into the tray. Removed once real tools land. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { button, chips, note, rail, section, statList } from '../../ui/primitives';
import { formatBytes, formatDims } from '../../lib/format';
import { saveExport } from '../../lib/download';
import './sandbox.css';

type Matte = 'black' | 'white' | 'lathe';
type View = 'fit' | 'actual';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const tool: LatheTool = {
  id: 'sandbox',
  name: 'Sandbox',
  group: 'Reference',
  defaults,
  accepts: ['image/*'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    let matte = settings.get<Matte>('matte', d.matte as Matte);
    let view = settings.get<View>('view', d.view as View);
    let current: Asset | undefined;
    let url: string | null = null;

    /* ---- stage ---- */
    const root = document.createElement('div');
    root.className = 'sandbox';
    stage.appendChild(root);
    const paint = () => { root.dataset.matte = matte; root.dataset.view = view; };

    const showEmpty = () => {
      const p = document.createElement('p');
      p.className = 'sandbox__empty';
      p.textContent = 'Drop an image anywhere, or send one here from the tray.';
      root.replaceChildren(p);
    };

    /* ---- inspector ---- */
    const file = section('File');
    const stats = statList();
    file.body.append(stats.el, note('Load an image to inspect it.'));

    const look = section('Look');
    look.body.append(
      rail<Matte>({
        label: 'Matte', value: matte,
        options: [{ value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'lathe', label: 'Lathe' }],
        onChange: v => { matte = v; settings.set('matte', v); paint(); },
      }).el,
      chips<View>({
        label: 'View', value: view,
        options: [{ value: 'fit', label: 'Fit' }, { value: 'actual', label: 'Actual size' }],
        onChange: v => { view = v as View; settings.set('view', v); paint(); },
      }).el,
    );

    const out = section('Export');
    const exportBtn = button({ label: 'Export PNG on matte', primary: true, onClick: () => void doExport() });
    exportBtn.disabled = true;
    out.body.append(exportBtn, note('Exports land in the asset tray too.'));
    inspector.append(file.el, look.el, out.el);

    /* ---- load ---- */
    function load(a: Asset) {
      if (!a.type.startsWith('image/')) { emit('toast', `Sandbox takes images, not ${a.type || 'this file'}`); return; }
      current = a;
      settings.set('lastAsset', a.id);
      // Revoke the previous URL only once the new image settles; revoking a URL that an
      // <img> is still fetching fails the request.
      const prev = url;
      url = URL.createObjectURL(a.blob);
      const img = document.createElement('img');
      img.className = 'sandbox__img';
      img.alt = a.name;
      const settle = () => { if (prev) URL.revokeObjectURL(prev); };
      img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', settle, { once: true });
      img.src = url;
      root.replaceChildren(img);
      stats.set([
        ['Name', a.name], ['Type', a.type], ['Dimensions', formatDims(a.width, a.height) || '—'],
        ['Size', formatBytes(a.size)], ['Source', a.source],
      ]);
      file.body.querySelector('.l-note')?.remove();
      exportBtn.disabled = false;
      statusbar.set({ name: a.name, width: a.width, height: a.height, bytes: a.size, state: 'Ready' });
    }

    async function doExport() {
      if (!current || !url) { emit('toast', 'Load an image first'); return; }
      statusbar.set({ name: current.name, width: current.width, height: current.height, bytes: current.size, state: 'Exporting' });
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d')!;
      x.fillStyle = token(`--${matte}`);
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
      if (!blob) { emit('toast', 'Could not encode PNG'); return; }
      const name = `${current.name.replace(/\.[^.]+$/, '')}-${matte}.png`;
      await saveExport(blob, name, 'sandbox');
      statusbar.set({ name: current.name, width: current.width, height: current.height, bytes: current.size, state: `Exported ${name}` });
    }

    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'sandbox') load(e.asset); });

    paint();
    const last = assets.get(settings.get<string>('lastAsset', ''));
    if (last) load(last); else showEmpty();

    return {
      unmount() { off(); if (url) URL.revokeObjectURL(url); },
      export: () => void doExport(),
    };
  },
};
