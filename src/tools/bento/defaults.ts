import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'theme', label: 'Deck theme', value: 'dark', options: ['dark', 'light'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'slideSize', label: 'Slide size', value: '13.333 × 7.5', unit: 'in', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: 'PowerPoint 16:9 widescreen (13.333 × 7.5 in)' },
  { key: 'grid', label: 'Grid', value: '12 × 8', unit: 'columns × rows', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'margin', label: 'Slide margin', value: 0.4, unit: 'in', min: 0, max: 1.5, step: 0.02, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'gutter', label: 'Gutter', value: 0.12, unit: 'in', min: 0, max: 0.6, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'padding', label: 'Tile padding', value: 0.18, unit: 'in', min: 0, max: 0.6, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'displaySize', label: 'Display text', value: 54, unit: 'pt', min: 12, max: 200, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'titleSize', label: 'Title text', value: 28, unit: 'pt', min: 8, max: 120, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'bodySize', label: 'Body text', value: 14, unit: 'pt', min: 6, max: 48, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'captionSize', label: 'Captions and credits', value: 8, unit: 'pt', min: 5, max: 24, step: 0.5, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'statSize', label: 'Stat value', value: 72, unit: 'pt', min: 12, max: 240, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'statLabelSize', label: 'Stat label', value: 12, unit: 'pt', min: 6, max: 48, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'hexSize', label: 'Hex labels', value: 9, unit: 'pt', min: 5, max: 24, step: 0.5, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'showCaptions', label: 'Credit line under images', value: true, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'font', label: 'Deck font', value: '"Helvetica Neue", Helvetica, Arial, sans-serif', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'starterPalette', label: 'New palette tiles start with', value: ['#E8FF1A', '#000000', '#FFFFFF'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'pngWidth', label: 'PNG width', value: 1920, unit: 'px', min: 640, max: 7680, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'imageMaxPx', label: 'Largest embedded image', value: 2400, unit: 'px longest edge', min: 400, max: 6000, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
];
