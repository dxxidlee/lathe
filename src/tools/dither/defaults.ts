import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'method', label: 'Method', value: 'floyd', options: ['bayer2', 'bayer4', 'bayer8', 'floyd', 'atkinson', 'dots', 'lines'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'threshold', label: 'Threshold', value: 0.5, min: 0, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'scale', label: 'Pixel size', value: 2, unit: 'source px per dither px', min: 1, max: 16, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'cell', label: 'Halftone cell', value: 10, unit: 'px', min: 3, max: 80, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'angle', label: 'Halftone angle', value: 45, unit: '°', min: 0, max: 180, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'gain', label: 'Halftone gain', value: 1, min: 0.2, max: 3, step: 0.05, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colorMode', label: 'Colors', value: 'two', options: ['two', 'palette'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'ink', label: 'Ink', value: '#000000', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paper', label: 'Paper', value: '#FFFFFF', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paletteCount', label: 'Palette colors from the image', value: 4, min: 2, max: 16, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'nearest', label: 'Nearest color measured in', value: 'OKLab', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'serpentine', label: 'Serpentine scan (error diffusion)', value: true, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'workingSize', label: 'Largest image processed', value: 2400, unit: 'px longest edge', min: 256, max: 6000, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'transparentPaper', label: 'Halftone paper transparent in exports', value: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
];
