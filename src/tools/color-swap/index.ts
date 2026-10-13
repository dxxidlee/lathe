/* Color-swap: recolor images and video to a target palette (WebGL2, OKLab), with rules, presets,
   preserved colors and export. Ported from reference/color-swap; the engine and controller are
   the original JavaScript (engine.js, ui.js) with the Lathe fixes listed in their headers. */
import type { LatheTool } from '../types';
import { defaults } from './defaults';
import { UIController } from './ui.js';
import './color-swap.css';

export const tool: LatheTool = {
  id: 'recolor',
  name: 'Color-swap',
  group: 'Offcuts',
  defaults,
  accepts: ['image/*', 'video/*'],

  mount({ defaults: d, changedDefaults, stage, inspector, statusbar, assets, settings, emit }) {
    // A default edited in the Defaults panel replaces the matching value in the saved snapshot.
    const snap = settings.get<{ palette?: unknown; settings?: Record<string, number> } | null>('state', null);
    if (snap && changedDefaults.length) {
      for (const k of changedDefaults) {
        if (k === 'palette') delete snap.palette;
        else if (snap.settings && k in snap.settings) delete snap.settings[k];
      }
      settings.set('state', snap);
    }
    const ui = new UIController({
      stage, inspector, defaults: d, settings, statusbar, assets, emit,
      palette: d.palette as unknown[],
      presets: d.presets as Record<string, Record<string, number>>,
    });
    // Export dialog starts from the manifest's choices.
    const set = (id: string, v: unknown) => { const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; if (!el) return; if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v; else el.value = String(v); };
    set('expRes', d.exportResolution); set('expFps', d.exportFps); set('expQual', d.exportQuality); set('expAudio', d.exportAudio);

    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'recolor') void ui.loadAsset(e.asset); });
    // Reopen the last image or video (after a reload, or a remount from a Defaults edit).
    const last = assets.get(settings.get<string>('lastAsset', ''));
    if (last) void ui.loadAsset(last);
    return {
      unmount() { off(); ui.destroy(); },
      export: () => { const btn = document.getElementById('btnExport') as HTMLButtonElement | null; if (btn && !btn.disabled) ui.openExport(); else emit('toast', 'Load an image or video first'); },
    };
  },
};
