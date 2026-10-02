import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'mode', label: 'Mode', value: 'one', options: ['one', 'multi'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'threshold', label: 'Threshold (one color)', value: 0.5, min: 0, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'invert', label: 'Trace light shapes (one color)', value: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colors', label: 'Colors (multi)', value: 6, min: 2, max: 32, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'smoothing', label: 'Smoothing', value: 0.4, min: 0, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'corner', label: 'Corner threshold (one color)', value: 1, min: 0, max: 1.334, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: 'Potrace alphamax default (1.0)' },
  { key: 'speckle', label: 'Ignore specks smaller than', value: 4, unit: 'px', min: 0, max: 100, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'turnpolicy', label: 'Potrace turn policy', value: 'minority', options: ['black', 'white', 'left', 'right', 'minority', 'majority'], chosenBy: DL, reason: TODO, inheritedFrom: 'Potrace default (minority)' },
  { key: 'traceSize', label: 'Trace resolution', value: 1200, unit: 'px longest edge', min: 128, max: 4000, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'fill', label: 'Fill (one color)', value: 'from image', options: ['from image', 'black'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'compare', label: 'Comparison', value: 'wipe', options: ['wipe', 'overlay', 'svg', 'raster'], chosenBy: DL, reason: TODO, inheritedFrom: null },
];
