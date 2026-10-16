import type { DefaultsManifest } from '../types';
export const defaults: DefaultsManifest = [
  /* (a) User: publicDomainOnly and colorMode are inspector controls */
  { key: 'publicDomainOnly', label: 'Public domain only', value: false },
  { key: 'colorMode', label: 'Color search', value: 'sort', options: ['sort', 'filter'] },
  /* (b) Advanced: collapsed inspector section */
  { key: 'paletteSize', label: 'Swatches per image', value: 6, min: 5, max: 8, step: 1 },
  { key: 'aggregateSize', label: 'Board palette size', value: 8, min: 3, max: 16, step: 1 },
  { key: 'colorThreshold', label: 'Color match distance', value: 0.12, unit: 'ΔE OKLab', min: 0.01, max: 0.5, step: 0.01 },
  /* Build-deck step */
  { key: 'deckTheme', label: 'Deck theme', value: 'dark', options: ['dark', 'light'] },
  { key: 'imagesPerSlide', label: 'Images per deck slide', value: 4, min: 1, max: 8, step: 1 },
  /* (c) Code only */
  { key: 'resultsPerSource', label: 'Results per source, per page', value: 24, editable: false },
  { key: 'paletteSample', label: 'Palette sample size', value: 64, unit: 'px longest edge', editable: false },
  { key: 'paletteIterations', label: 'k-means iterations', value: 12, editable: false },
  { key: 'minSwatches', label: 'Fewest swatches per image', value: 5, editable: false },
  { key: 'minSwatchShare', label: 'Smallest swatch kept', value: 0.02, unit: 'share of pixels', editable: false },
  { key: 'colorSpace', label: 'Palette color space', value: 'OKLab', editable: false },
  { key: 'cacheHours', label: 'Cache responses for', value: 24, unit: 'hours', editable: false },
];
