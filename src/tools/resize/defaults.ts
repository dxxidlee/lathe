import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

/* One size per ratio preset (the "16:9" chip adds 1920×1080). */
export const PRESETS = [
  { ratio: '1:1', w: 1080, h: 1080 },
  { ratio: '16:9', w: 1920, h: 1080 },
  { ratio: '9:16', w: 1080, h: 1920 },
  { ratio: '4:1', w: 1200, h: 300 },
  { ratio: '10:1', w: 1500, h: 150 },
  { ratio: '20:1', w: 2000, h: 100 },
];
export const SAMPLES = ['headline-cta', 'logo-lockup', 'tiled-pattern'] as const;

export const defaults: DefaultsManifest = [
  { key: 'presets', label: 'Ratio presets and the size each adds', value: PRESETS, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'sizes', label: 'Starting sizes', value: PRESETS.map(p => `${p.w}×${p.h}`).join('\n'), chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'breakpoints', label: 'Breakpoints when the master defines none (aspect ratio w ÷ h)', value: [{ id: 'square', max: 1.5 }, { id: 'wide', min: 1.5, max: 4 }, { id: 'ultrawide', min: 4 }], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'lineHeight', label: 'Line height of single-line text', value: 1.2, unit: '× font size', min: 0.8, max: 2, step: 0.05, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'shrinkFloor', label: 'Smallest fit:shrink size when a layer sets no min', value: 0.5, unit: '× starting size', min: 0.1, max: 1, step: 0.05, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'ellipsis', label: 'Truncation mark', value: '…', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'standInFont', label: 'Stand-in font for missing fonts', value: 'Inter (SIL Open Font License)', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'sample', label: 'Sample shown on first open', value: 'headline-cta', options: [...SAMPLES, 'none'], chosenBy: DL, reason: TODO, inheritedFrom: null },
];
