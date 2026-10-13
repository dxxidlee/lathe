import type { DefaultsManifest } from '../types';
export const defaults: DefaultsManifest = [
  /* (a) User: the domain input is the only control; nothing here */
  /* (b) Advanced: collapsed inspector section */
  { key: 'desktopWidth', label: 'Desktop screenshot width', value: 1440, unit: 'px', min: 800, max: 2560, step: 10 },
  { key: 'desktopHeight', label: 'Desktop screenshot height', value: 900, unit: 'px', min: 480, max: 1600, step: 10 },
  { key: 'mobileWidth', label: 'Mobile screenshot width', value: 390, unit: 'px', min: 320, max: 480, step: 1 },
  { key: 'mobileHeight', label: 'Mobile screenshot height', value: 844, unit: 'px', min: 568, max: 1000, step: 1 },
  { key: 'timelineSnapshots', label: 'Timeline snapshots', value: 6, min: 1, max: 16, step: 1 },
  { key: 'timelineSpan', label: 'Timeline reaches back', value: 20, unit: 'years', min: 1, max: 30, step: 1 },
  { key: 'boardVideos', label: 'YouTube videos looked at', value: 6, min: 1, max: 12, step: 1 },
  /* Build-deck step */
  { key: 'deckTheme', label: 'Deck theme', value: 'dark', options: ['dark', 'light'] },
  /* (c) Code only */
  { key: 'paletteSize', label: 'Swatches per image', value: 6, editable: false },
  { key: 'cacheHours', label: 'Cache duration', value: 24, unit: 'hours', editable: false },
  { key: 'aggregateSize', label: 'Aggregate palette swatches', value: 8, editable: false },
  { key: 'imagesPerSlide', label: 'Images per slide', value: 6, editable: false },
  { key: 'cssColorMerge', label: 'CSS colors merged within', value: 0.04, unit: 'ΔE OKLab', editable: false },
  { key: 'cssColorTop', label: 'CSS colors kept', value: 12, editable: false },
  { key: 'declaredMatch', label: 'Screenshot color counts as declared within', value: 0.05, unit: 'ΔE OKLab', editable: false },
  { key: 'paletteSample', label: 'Palette sample size', value: 64, unit: 'px longest edge', editable: false },
  { key: 'paletteIterations', label: 'k-means iterations', value: 12, editable: false },
  { key: 'minSwatches', label: 'Fewest swatches per image', value: 5, editable: false },
  { key: 'minSwatchShare', label: 'Smallest swatch kept', value: 0.02, unit: 'share of pixels', editable: false },
  { key: 'observationImagePx', label: 'Captures sent for observations', value: 1280, unit: 'px longest edge', editable: false },
  { key: 'colorSpace', label: 'Palette color space', value: 'OKLab', editable: false },
  { key: 'observationModel', label: 'Observations model', value: 'claude-opus-5-5', editable: false },
];
