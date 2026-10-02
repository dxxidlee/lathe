import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'paletteSize', min: 1, max: 12, step: 1, label: 'Swatches per image', value: 5, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paletteSample', min: 16, max: 512, step: 1, label: 'Palette sample size', value: 120, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'lowResEdge', min: 0, max: 10000, step: 1, label: 'Low-resolution warning below', value: 800, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'upgradeTimeoutMs', min: 500, max: 30000, step: 100, label: 'Full-size upgrade timeout', value: 6000, unit: 'ms', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'floatWidth', min: 160, max: 1600, step: 1, label: 'Float window width', value: 340, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'floatHeight', min: 160, max: 1600, step: 1, label: 'Float window height', value: 720, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
];
