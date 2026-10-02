import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'family', label: 'Family', value: 'conic', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'variant', label: 'Variant', value: 'conic', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'palette', label: 'Palette', value: 'electric', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'ratio', label: 'Ratio', value: '16:9', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'seed', label: 'Seed', value: 42, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'density', label: 'Density', value: 5, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'angle', label: 'Angle', value: 90, unit: '°', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'blur', label: 'Blur', value: 14, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'grain', label: 'Grain', value: 55, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'drift', label: 'Drift', value: 0, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'cycle', label: 'Hue cycle', value: 0, unit: 'turns per loop', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'loopSeconds', label: 'Loop length', value: 2, unit: 's', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'exportLandscapeWidth', label: 'Still width, landscape', value: 3840, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'exportPortraitWidth', label: 'Still width, portrait', value: 2160, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'jpegQuality', label: 'JPEG quality', value: 95, unit: '%', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'gifSize', label: 'GIF size', value: 720, unit: 'px landscape width', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'gifFps', label: 'GIF frame rate', value: 20, unit: 'fps', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'gifQuality', label: 'GIF quantizer sampling', value: 8, unit: '(1 best – 30 fastest)', chosenBy: DL, reason: TODO, inheritedFrom: null },
  {
    key: 'palettes', label: 'Palettes', chosenBy: DL, reason: TODO, inheritedFrom: null,
    value: {
      electric: ['#12082e', '#2b2be6', '#7b5cff', '#ff2e7e', '#ff4d3d'],
      sunset: ['#3a0d0d', '#d94a2a', '#ecdcc4', '#0b1a5e', '#2b6bff'],
      aura: ['#2540ff', '#ff3ea5', '#ff8a4c', '#ffd6a8', '#fff2e0'],
      candy: ['#ff2fb0', '#c94fff', '#3aa0ff', '#8fe8ff', '#ffe3f2'],
      ember: ['#0a1240', '#5b1e8a', '#c81f4b', '#ff5a2c', '#ffc93a'],
      cyber: ['#ffab2e', '#ff3b3b', '#ff2fb0', '#2c6bff', '#22d0e0'],
      moss: ['#b7e26a', '#6d8f7b', '#3d3f8f', '#8a2be2', '#c77dff'],
      bloom: ['#1a0620', '#6b1d5c', '#d43f8d', '#ff9ec4', '#ffe8f2'],
    },
  },
];
