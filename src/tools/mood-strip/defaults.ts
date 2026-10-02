import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'paletteSize', label: 'Swatches per image', value: 5, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paletteSample', label: 'Palette sample size', value: 120, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'lowResEdge', label: 'Low-resolution warning below', value: 800, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'upgradeTimeoutMs', label: 'Full-size upgrade timeout', value: 6000, unit: 'ms', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'floatWidth', label: 'Float window width', value: 340, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'floatHeight', label: 'Float window height', value: 720, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
];
