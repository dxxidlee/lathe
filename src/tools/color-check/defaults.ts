import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'standard', options: ['wcag', 'apca'], label: 'Standard', value: 'wcag', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'threshold', options: ['all', 'AALarge', 'AA', 'AAA'], label: 'Show only', value: 'all', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'wcagAAA', min: 1, max: 21, label: 'WCAG AAA', value: 7, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.6 Contrast (Enhanced)' },
  { key: 'wcagAA', min: 1, max: 21, label: 'WCAG AA', value: 4.5, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.3 Contrast (Minimum)' },
  { key: 'wcagAALarge', min: 1, max: 21, label: 'WCAG AA large text', value: 3, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.3, large-scale text' },
  { key: 'apcaAAA', min: 0, max: 108, label: 'APCA "AAA"', value: 75, unit: 'Lc', chosenBy: DL, reason: TODO, inheritedFrom: 'APCA readability guidance: Lc 75 minimum for body text' },
  { key: 'apcaAA', min: 0, max: 108, label: 'APCA "AA"', value: 60, unit: 'Lc', chosenBy: DL, reason: TODO, inheritedFrom: 'APCA readability guidance: Lc 60 for content text' },
  { key: 'apcaAALarge', min: 0, max: 108, label: 'APCA "AA large"', value: 45, unit: 'Lc', chosenBy: DL, reason: TODO, inheritedFrom: 'APCA readability guidance: Lc 45 for large or heavy text' },
  { key: 'repairTarget', min: 1, max: 21, label: 'Auto-repair target', value: 4.5, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.3 Contrast (Minimum)' },
  { key: 'repairStep', min: 0.001, max: 0.1, label: 'Auto-repair step', value: 0.01, unit: 'OKLCH L', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'repairMaxSteps', min: 1, max: 1000, step: 1, label: 'Auto-repair search', value: 100, unit: 'steps', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'dimOpacity', min: 0, max: 1, step: 0.01, label: 'Below-threshold opacity', value: 0.12, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'chartFont', label: 'Chart font', value: 'Helvetica Neue', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'exportFormat', options: ['svg', 'html'], label: 'Export format', value: 'svg', chosenBy: DL, reason: TODO, inheritedFrom: null },
  {
    key: 'gradeColors', label: 'Grade colors', chosenBy: DL, reason: TODO, inheritedFrom: null,
    value: { fail: '#FF0004', aaLarge: '#FFD400', aa: '#B6E662', aaa: '#0FB800' },
  },
  { key: 'exportStroke', label: 'Export hairline', value: '#EDEDED', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'exportLabel', label: 'Export label color', value: '#969696', chosenBy: DL, reason: TODO, inheritedFrom: null },
];
