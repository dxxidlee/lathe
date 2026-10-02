import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'standard', label: 'Standard', value: 'wcag', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'threshold', label: 'Show only', value: 'all', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'wcagAAA', label: 'WCAG AAA', value: 7, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.6 Contrast (Enhanced)' },
  { key: 'wcagAA', label: 'WCAG AA', value: 4.5, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.3 Contrast (Minimum)' },
  { key: 'wcagAALarge', label: 'WCAG AA large text', value: 3, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.3, large-scale text' },
  { key: 'apcaAAA', label: 'APCA "AAA"', value: 75, unit: 'Lc', chosenBy: DL, reason: TODO, inheritedFrom: 'APCA readability guidance: Lc 75 minimum for body text' },
  { key: 'apcaAA', label: 'APCA "AA"', value: 60, unit: 'Lc', chosenBy: DL, reason: TODO, inheritedFrom: 'APCA readability guidance: Lc 60 for content text' },
  { key: 'apcaAALarge', label: 'APCA "AA large"', value: 45, unit: 'Lc', chosenBy: DL, reason: TODO, inheritedFrom: 'APCA readability guidance: Lc 45 for large or heavy text' },
  { key: 'repairTarget', label: 'Auto-repair target', value: 4.5, unit: ':1', chosenBy: DL, reason: TODO, inheritedFrom: 'WCAG 2.2 SC 1.4.3 Contrast (Minimum)' },
  { key: 'repairStep', label: 'Auto-repair step', value: 0.01, unit: 'OKLCH L', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'repairMaxSteps', label: 'Auto-repair search', value: 100, unit: 'steps', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'dimOpacity', label: 'Below-threshold opacity', value: 0.12, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'chartFont', label: 'Chart font', value: 'Helvetica Neue', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'exportFormat', label: 'Export format', value: 'svg', chosenBy: DL, reason: TODO, inheritedFrom: null },
  {
    key: 'gradeColors', label: 'Grade colors', chosenBy: DL, reason: TODO, inheritedFrom: null,
    value: { fail: '#FF0004', aaLarge: '#FFD400', aa: '#B6E662', aaa: '#0FB800' },
  },
  { key: 'exportStroke', label: 'Export hairline', value: '#EDEDED', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'exportLabel', label: 'Export label color', value: '#969696', chosenBy: DL, reason: TODO, inheritedFrom: null },
];
