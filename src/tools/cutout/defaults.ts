import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'model', label: 'Segmentation model', value: 'isnet_fp16', options: ['isnet', 'isnet_fp16', 'isnet_quint8'], chosenBy: DL, reason: TODO, inheritedFrom: '@imgly/background-removal default (isnet_fp16, ~80 MB)' },
  { key: 'device', label: 'Runs on', value: 'cpu', options: ['cpu', 'gpu'], chosenBy: DL, reason: TODO, inheritedFrom: '@imgly/background-removal default (cpu, WebAssembly)' },
  { key: 'assetHost', label: 'Model files served from', value: 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/', chosenBy: DL, reason: TODO, inheritedFrom: '@imgly/background-removal default (IMG.LY CDN)' },
  { key: 'shift', label: 'Edge shift', value: 0, unit: 'px (− choke, + spread)', min: -20, max: 20, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'hardness', label: 'Edge hardness', value: 0.3, min: 0, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'feather', label: 'Feather', value: 0, unit: 'px', min: 0, max: 40, step: 0.5, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'maxSize', label: 'Largest image processed', value: 4096, unit: 'px longest edge', min: 512, max: 8192, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'backdrop', label: 'Preview backdrop', value: 'checker', options: ['checker', 'black', 'white', 'lathe'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'webpQuality', label: 'WebP quality', value: 0.9, min: 0.1, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
];
