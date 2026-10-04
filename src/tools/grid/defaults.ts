import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

/* Each format names a canvas (in its own unit) and a starting grid for it. Paper sizes follow
   their standards; screen sizes are common device and slide sizes. */
export const FORMATS = [
  { id: 'desktop', label: 'Desktop 1440', unit: 'px', w: 1440, h: 1024, cols: 12, gutter: 24, margin: 80, rows: 1, rowGutter: 24, baseline: 8 },
  { id: 'tablet', label: 'Tablet 834', unit: 'px', w: 834, h: 1194, cols: 8, gutter: 24, margin: 40, rows: 1, rowGutter: 24, baseline: 8 },
  { id: 'mobile', label: 'Phone 390', unit: 'px', w: 390, h: 844, cols: 4, gutter: 16, margin: 20, rows: 1, rowGutter: 16, baseline: 8 },
  { id: 'slide', label: 'Slide 16:9', unit: 'px', w: 1920, h: 1080, cols: 12, gutter: 32, margin: 96, rows: 8, rowGutter: 32, baseline: 8 },
  { id: 'insta', label: 'Instagram 4:5', unit: 'px', w: 1080, h: 1350, cols: 6, gutter: 24, margin: 64, rows: 1, rowGutter: 24, baseline: 8 },
  { id: 'a4', label: 'A4', unit: 'mm', w: 210, h: 297, cols: 12, gutter: 4, margin: 15, rows: 1, rowGutter: 4, baseline: 4 },
  { id: 'a3', label: 'A3', unit: 'mm', w: 297, h: 420, cols: 12, gutter: 5, margin: 20, rows: 1, rowGutter: 5, baseline: 5 },
  { id: 'letter', label: 'US Letter', unit: 'in', w: 8.5, h: 11, cols: 12, gutter: 0.1667, margin: 0.75, rows: 1, rowGutter: 0.1667, baseline: 0.1667 },
  { id: 'tabloid', label: 'Tabloid', unit: 'in', w: 11, h: 17, cols: 12, gutter: 0.1667, margin: 0.75, rows: 1, rowGutter: 0.1667, baseline: 0.1667 },
  { id: 'spread', label: 'Editorial spread', unit: 'mm', w: 420, h: 297, cols: 12, gutter: 5, margin: 18, rows: 1, rowGutter: 5, baseline: 4.5 },
];

export const defaults: DefaultsManifest = [
  { key: 'format', label: 'Format', value: 'desktop', options: FORMATS.map(f => f.id), chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'formats', label: 'Formats and their starting grids', value: FORMATS, chosenBy: DL, reason: TODO, inheritedFrom: 'A4/A3: ISO 216; Letter/Tabloid: ANSI; 8 px baseline: the 8-point grid' },
  { key: 'overlayColor', label: 'Overlay color', value: '#FF0000', chosenBy: DL, reason: TODO, inheritedFrom: 'Figma layout grid default (red)' },
  { key: 'overlayOpacity', label: 'Overlay opacity', value: 0.1, min: 0.02, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: 'Figma layout grid default (10%)' },
  { key: 'baselineOpacity', label: 'Baseline opacity', value: 0.35, min: 0.02, max: 1, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'pxPerUnitMm', label: 'PNG resolution for paper formats', value: 300, unit: 'dpi', min: 72, max: 600, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: '300 dpi, the common print resolution' },
  { key: 'snapToBaseline', label: 'Snap row heights to the baseline', value: true, chosenBy: DL, reason: TODO, inheritedFrom: null },
];
