import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'resultsPerSource', label: 'Results per source, per page', value: 24, editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'cacheHours', label: 'Cache responses for', value: 24, unit: 'hours', min: 0, max: 720, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paletteSize', label: 'Swatches per image', value: 6, min: 5, max: 8, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paletteSample', label: 'Palette sample size', value: 64, unit: 'px longest edge', min: 16, max: 256, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'paletteIterations', label: 'k-means iterations', value: 12, min: 1, max: 50, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'minSwatches', label: 'Fewest swatches per image', value: 5, min: 1, max: 8, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'minSwatchShare', label: 'Smallest swatch kept', value: 0.02, unit: 'share of pixels', min: 0, max: 0.2, step: 0.005, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colorSpace', label: 'Palette color space', value: 'OKLab', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colorThreshold', label: 'Color match distance', value: 0.12, unit: 'ΔE OKLab', min: 0.01, max: 0.5, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colorMode', label: 'Color search', value: 'sort', options: ['sort', 'filter'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'publicDomainOnly', label: 'Public domain only', value: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'aggregateSize', label: 'Collection palette size', value: 8, min: 3, max: 16, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'imagesPerSlide', label: 'Images per deck slide', value: 4, min: 1, max: 8, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'deckTheme', label: 'Deck theme', value: 'dark', options: ['dark', 'light'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  /* brand mode */
  { key: 'cssColorMerge', label: 'CSS colors merged within', value: 0.04, unit: 'ΔE OKLab', min: 0, max: 0.3, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'cssColorTop', label: 'CSS colors kept', value: 12, min: 3, max: 32, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'declaredMatch', label: 'Screenshot color counts as declared within', value: 0.05, unit: 'ΔE OKLab', min: 0.01, max: 0.3, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'desktopWidth', label: 'Desktop screenshot width', value: 1440, unit: 'px', min: 800, max: 2560, step: 10, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'desktopHeight', label: 'Desktop screenshot height', value: 900, unit: 'px', min: 480, max: 1600, step: 10, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'mobileWidth', label: 'Mobile screenshot width', value: 390, unit: 'px', min: 320, max: 480, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'mobileHeight', label: 'Mobile screenshot height', value: 844, unit: 'px', min: 568, max: 1000, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'timelineSnapshots', label: 'Timeline snapshots', value: 6, min: 1, max: 16, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'timelineSpan', label: 'Timeline reaches back', value: 20, unit: 'years', min: 1, max: 30, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'observationImagePx', label: 'Captures sent for observations', value: 1280, unit: 'px longest edge', min: 512, max: 1568, step: 16, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'observationModel', label: 'Observations model', value: 'claude-opus-5-5', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
];
