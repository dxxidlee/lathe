import type { DefaultsManifest } from '../types';
export const defaults: DefaultsManifest = [
  { key: 'swatchCount', label: 'Swatches extracted', value: 6, min: 2, max: 12, step: 1 },
  { key: 'sampleSize', label: 'Extraction sample', value: 160, unit: 'px longest edge', min: 32, max: 512, step: 1 },
  { key: 'iterations', label: 'k-means iterations', value: 16, min: 1, max: 60, step: 1 },
  { key: 'colorSpace', label: 'Clustering color space', value: 'OKLab', editable: false },
  { key: 'ladder', label: 'Scale steps (step, OKLCH lightness)', value: [[50, 0.97], [100, 0.94], [200, 0.88], [300, 0.8], [400, 0.71], [500, 0.62], [600, 0.53], [700, 0.45], [800, 0.37], [900, 0.29], [950, 0.22]] },
  { key: 'anchorBase', label: 'Swatch replaces its nearest step', value: true },
  { key: 'gamut', label: 'Scale gamut', value: 'sRGB, chroma reduced to fit', editable: false },
  { key: 'aaRatio', label: 'Contrast for body text (AA)', value: 4.5, unit: ': 1', min: 1, max: 21, step: 0.1 },
  { key: 'aaLargeRatio', label: 'Contrast for large text (AA)', value: 3, unit: ': 1', min: 1, max: 21, step: 0.1 },
  { key: 'aaaRatio', label: 'Contrast for body text (AAA)', value: 7, unit: ': 1', min: 1, max: 21, step: 0.1 },
  { key: 'pairsShown', label: 'Contrast pairs shown', value: 'AA', options: ['all', 'AA Large', 'AA', 'AAA'] },
  { key: 'includeBlackWhite', label: 'Pair against black and white', value: true },
  { key: 'cssFormat', label: 'CSS value format', value: 'hex', options: ['hex', 'oklch'] },
  { key: 'cssPrefix', label: 'CSS variable prefix', value: 'color' },
  { key: 'exportScales', label: 'Export scales with swatches', value: true },
  { key: 'figmaCollection', label: 'Figma collection name', value: 'Palette' },
];
