/* Color-swap: recolor images and video to a target palette (WebGL2, OKLab), with rules, presets,
   preserved colors and export. Ported from reference/color-swap; the engine and controller are
   the original JavaScript (engine.js, ui.js) with the Lathe fixes listed in their headers. */
import type { LatheTool } from '../types';
import { defaults } from './defaults';
import { UIController } from './ui.js';
import './color-swap.css';

export const tool: LatheTool = {
  id: 'color-swap',
  name: 'Color-swap',
  group: 'Color',
  defaults,
  accepts: ['image/*', 'video/*'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const ui = new UIController({
      stage, inspector, defaults: d, settings, statusbar, assets, emit,
      palette: d.palette as unknown[],
      presets: d.presets as Record<string, Record<string, number>>,
    });
    // Export dialog starts from the manifest's choices.
    const set = (id: string, v: unknown) => { const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; if (!el) return; if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v; else el.value = String(v); };
    set('expRes', d.exportResolution); set('expFps', d.exportFps); set('expQual', d.exportQuality); set('expAudio', d.exportAudio);

    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'color-swap') void ui.loadAsset(e.asset); });
    return {
      unmount() { off(); ui.destroy(); },
      export: () => { const btn = document.getElementById('btnExport') as HTMLButtonElement | null; if (btn && !btn.disabled) ui.openExport(); else emit('toast', 'Load an image or video first'); },
    };
  },
};
