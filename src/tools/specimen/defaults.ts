import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const RATIOS: [string, number][] = [
  ['Minor second', 1.067], ['Major second', 1.125], ['Minor third', 1.2], ['Major third', 1.25],
  ['Perfect fourth', 1.333], ['Augmented fourth', 1.414], ['Perfect fifth', 1.5], ['Golden ratio', 1.618],
];

export const defaults: DefaultsManifest = [
  { key: 'sample', label: 'Sample text', value: 'Every default was someone else’s decision.', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'pangram', label: 'Pangram', value: 'The quick brown fox jumps over the lazy dog', chosenBy: DL, reason: TODO, inheritedFrom: 'The English pangram in common use since the 1880s' },
  { key: 'waterfall', label: 'Waterfall sizes', value: [96, 72, 48, 36, 24, 18, 14, 12, 10], unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'glyphCell', label: 'Glyph cell', value: 72, unit: 'px', min: 32, max: 160, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'maxGlyphs', label: 'Glyphs shown', value: 1200, min: 50, max: 10000, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'scaleBase', label: 'Scale base size', value: 16, unit: 'px', min: 8, max: 32, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: '16 px, the browser default font size' },
  { key: 'scaleRatio', label: 'Scale ratio', value: 1.25, options: RATIOS.map(r => r[1]), chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'stepsUp', label: 'Scale steps above the base', value: 6, min: 1, max: 12, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'stepsDown', label: 'Scale steps below the base', value: 2, min: 0, max: 6, step: 1, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'scaleUnit', label: 'Scale tokens in', value: 'rem', options: ['rem', 'px'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'pdfPage', label: 'Specimen PDF page', value: 'A4 landscape', options: ['A4 landscape', 'A4 portrait', 'Letter landscape', 'Letter portrait'], chosenBy: DL, reason: TODO, inheritedFrom: null },
];
