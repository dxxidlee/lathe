/* Color-swap: recolor images and video to a target palette (WebGL2, OKLab), with rules, presets,
   preserved colors and export. Ported from reference/color-swap; the engine and controller are
   the original JavaScript (engine.js, ui.js) with the Lathe fixes listed in their headers. */
import type { LatheTool } from '../types';
import { defaults } from './defaults';
import { UIController } from './ui.js';
import { button } from '../../ui/primitives';
import './color-swap.css';

export const tool: LatheTool = {
  id: 'recolor',
  name: 'Recolor',
  group: 'Offcuts',
  defaults,
  accepts: ['image/*', 'video/*'],

  mount({ defaults: d, changedDefaults, stage, inspector, statusbar, assets, settings, emit, onActivate, requireAuth }) {
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
      onActivate,
      palette: d.palette as unknown[],
      presets: d.presets as Record<string, Record<string, number>>,
    } as any);
    // Export dialog starts from the manifest's choices.
    const set = (id: string, v: unknown) => { const el = (stage.querySelector('#' + id) ?? inspector.querySelector('#' + id)) as HTMLInputElement | HTMLSelectElement | null; if (!el) return; if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v; else el.value = String(v); };
    set('expRes', d.exportResolution); set('expFps', d.exportFps); set('expQual', d.exportQuality); set('expAudio', d.exportAudio);

    // Save to Library button in the inspector
    const saveSec = inspector.querySelector('[data-sec="presetio"] .section-body');
    if (saveSec) saveSec.appendChild(button({ label: 'Save to Library', onClick: async () => {
      if (requireAuth(() => {})) return;
      const { supabase } = await import('../../lib/supabase');
      if (!supabase) { emit('toast', 'Sign in to save'); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { emit('toast', 'Sign in to save'); return; }
      const { cloudSaveItem } = await import('../../lib/cloud-library');
      const snap = settings.get('state', null) as any;
      await cloudSaveItem(user.id, { type: 'palette', name: `Recolor · ${snap?.palette?.colors?.length ?? 0} colors`, toolId: 'recolor', data: snap });
      emit('toast', 'Saved to Library');
    }}));

    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'recolor') void ui.loadAsset(e.asset); });
    // Reopen the last image or video (after a reload, or a remount from a Defaults edit).
    const last = assets.get(settings.get<string>('lastAsset', ''));
    if (last) void ui.loadAsset(last);
    return {
      unmount() { off(); ui.destroy(); },
      export: () => { const btn = (stage.querySelector('#btnExport') ?? inspector.querySelector('#btnExport')) as HTMLButtonElement | null; if (btn && !btn.disabled) ui.openExport(); else emit('toast', 'Load an image or video first'); },
    };
  },
};
