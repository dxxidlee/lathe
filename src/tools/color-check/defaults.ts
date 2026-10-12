import type { DefaultsManifest } from '../types';
export const defaults: DefaultsManifest = [
  { key: 'standard', options: ['wcag', 'apca'], label: 'Standard', value: 'wcag' },
  { key: 'threshold', options: ['all', 'AALarge', 'AA', 'AAA'], label: 'Show only', value: 'all' },
  { key: 'wcagAAA', min: 1, max: 21, label: 'WCAG AAA', value: 7, unit: ':1' },
  { key: 'wcagAA', min: 1, max: 21, label: 'WCAG AA', value: 4.5, unit: ':1' },
  { key: 'wcagAALarge', min: 1, max: 21, label: 'WCAG AA large text', value: 3, unit: ':1' },
  { key: 'apcaAAA', min: 0, max: 108, label: 'APCA "AAA"', value: 75, unit: 'Lc' },
  { key: 'apcaAA', min: 0, max: 108, label: 'APCA "AA"', value: 60, unit: 'Lc' },
  { key: 'apcaAALarge', min: 0, max: 108, label: 'APCA "AA large"', value: 45, unit: 'Lc' },
  { key: 'repairTarget', min: 1, max: 21, label: 'Auto-repair target', value: 4.5, unit: ':1' },
  { key: 'repairStep', min: 0.001, max: 0.1, label: 'Auto-repair step', value: 0.01, unit: 'OKLCH L' },
  { key: 'repairMaxSteps', min: 1, max: 1000, step: 1, label: 'Auto-repair search', value: 100, unit: 'steps' },
  { key: 'dimOpacity', min: 0, max: 1, step: 0.01, label: 'Below-threshold opacity', value: 0.12 },
  { key: 'chartFont', label: 'Chart font', value: 'Helvetica Neue' },
  { key: 'exportFormat', options: ['svg', 'html'], label: 'Export format', value: 'svg' },
  {
    key: 'gradeColors', label: 'Grade colors',
    value: { fail: '#FF0004', aaLarge: '#FFD400', aa: '#B6E662', aaa: '#0FB800' },
  },
  { key: 'exportStroke', label: 'Export hairline', value: '#EDEDED' },
  { key: 'exportLabel', label: 'Export label color', value: '#969696' },
];
