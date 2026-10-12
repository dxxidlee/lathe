import type { DefaultsManifest } from '../types';

const setting = (key: string, label: string, value: number) =>
  ({ key, label, value, unit: '0–1', min: 0, max: 1, step: 0.01 });

export const defaults: DefaultsManifest = [
  {
    key: 'palette', label: 'Target palette',
    // Hex values kept from the original; swatch names neutralised (see VERIFY.md, Milestone 3).
    value: [
      { name: 'Red', hex: '#E71324', role: 'Primary', weight: 100, enabled: true, locked: false },
      { name: 'Dark red', hex: '#92001D', role: 'Midtone', weight: 90, enabled: true, locked: false },
      { name: 'Deep red', hex: '#500010', role: 'Shadow', weight: 85, enabled: true, locked: false },
      { name: 'White', hex: '#FFFFFF', role: 'Highlight', weight: 55, enabled: true, locked: false },
      { name: 'Stone', hex: '#DCE2E9', role: 'Neutral', weight: 60, enabled: true, locked: false },
      { name: 'Sun', hex: '#FF9D00', role: 'Accent', weight: 22, enabled: true, locked: false },
      { name: 'Amethyst', hex: '#A200ED', role: 'Accent', weight: 28, enabled: true, locked: false },
      { name: 'Ocean', hex: '#00B0F2', role: 'Accent', weight: 18, enabled: true, locked: false },
    ],
  },
  setting('strength', 'Recolor strength', 0.85),
  setting('lumaPreserve', 'Luminance preservation', 0.78),
  setting('texture', 'Texture preservation', 0.70),
  setting('shadowProtect', 'Shadow protection', 0.72),
  setting('highlightProtect', 'Highlight protection', 0.68),
  setting('neutral', 'Neutral preservation', 0.62),
  setting('accentFreq', 'Accent frequency', 0.30),
  setting('softness', 'Palette softness', 0.35),
  setting('satLimit', 'Saturation limit', 0.58),
  setting('temporal', 'Temporal stability', 0.55),
  setting('separation', 'Color separation', 0.55),
  setting('skin', 'Skin-tone protection', 0.55),
  {
    key: 'presets', label: 'Presets',
    value: {
      'Balanced': {},
      'Red Dominant': { accentFreq: 0.08, neutral: 0.40, strength: 0.95, separation: 0.70, satLimit: 0.62 },
      'Cinematic': { strength: 0.70, lumaPreserve: 0.88, shadowProtect: 0.85, highlightProtect: 0.80, satLimit: 0.42, softness: 0.60, texture: 0.80, temporal: 0.68, accentFreq: 0.18 },
      'Graphic': { strength: 1.0, lumaPreserve: 0.45, softness: 0.05, separation: 0.90, texture: 0.35, satLimit: 0.80, neutral: 0.30, accentFreq: 0.42 },
      'Preserve Neutrals': { neutral: 0.95, strength: 0.72, accentFreq: 0.15, satLimit: 0.48, highlightProtect: 0.85 },
      'Maximum Palette': { strength: 1.0, neutral: 0.10, accentFreq: 0.55, satLimit: 0.85, softness: 0.20, lumaPreserve: 0.60, separation: 0.75 },
      'Subtle Brand Grade': { strength: 0.34, lumaPreserve: 0.92, satLimit: 0.36, accentFreq: 0.10, neutral: 0.80, softness: 0.65, texture: 0.85, temporal: 0.70 },
    },
  },
  { key: 'analysisFrames', min: 1, max: 60, step: 1, label: 'Frames sampled per video', value: 12 },
  { key: 'exportResolution', options: ['original', '1080', '720', '480'], label: 'Export resolution', value: 'original' },
  { key: 'exportFps', options: ['original', '30', '24'], label: 'Export frame rate', value: 'original' },
  { key: 'exportQuality', options: ['high', 'medium', 'small'], label: 'Export quality', value: 'high' },
  { key: 'exportAudio', label: 'Include audio', value: true },
  { key: 'videoFormat', editable: false, label: 'Video format', value: 'WebM (VP9/VP8, Opus)' },
];
