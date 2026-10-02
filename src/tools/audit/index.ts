/* Audit (Research): two modes, one output. Subject mode queries open archives; brand mode audits a
   company's site. Both build a deck in Bento. */
import type { LatheTool, MountResult } from '../types';
import { defaults } from './defaults';
import { mountSubject } from './subject';
import { mountBrand } from './brand';
import { chips, section } from '../../ui/primitives';

type Mode = 'subject' | 'brand';

export const tool: LatheTool = {
  id: 'audit',
  name: 'Audit',
  group: 'Research',
  defaults,

  mount(ctx) {
    let mode = ctx.settings.get<Mode>('mode', 'subject');
    let current: Exclude<MountResult, () => void> | null = null;
    const start = () => {
      current?.unmount();
      ctx.stage.replaceChildren(); ctx.inspector.replaceChildren();
      const modeSec = section('Mode');
      modeSec.body.append(chips<Mode>({
        value: mode, options: [{ value: 'subject', label: 'Subject audit' }, { value: 'brand', label: 'Brand audit' }],
        onChange: v => { if (v === mode) return; mode = v as Mode; ctx.settings.set('mode', mode); start(); },
      }).el);
      const r = (mode === 'brand' ? mountBrand : mountSubject)(ctx, modeSec.el);
      current = typeof r === 'function' ? { unmount: r } : r;
    };
    start();
    return {
      unmount: () => current?.unmount(),
      export: () => current?.export?.(),
    };
  },
};
