import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'sizes', label: 'PNG sizes', value: [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024], options: [16, 24, 32, 48, 64, 96, 128, 152, 167, 180, 192, 256, 384, 512, 1024], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'icoSizes', label: 'Sizes inside favicon.ico', value: [16, 32, 48], options: [16, 24, 32, 48, 64, 128, 256], chosenBy: DL, reason: TODO, inheritedFrom: 'Windows and browser favicon convention (16, 32, 48)' },
  { key: 'padding', label: 'Padding around the mark', value: 0, unit: 'of the icon', min: 0, max: 0.4, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'appleSize', label: 'Apple touch icon', value: 180, unit: 'px', editable: false, chosenBy: DL, reason: TODO, inheritedFrom: 'Apple Human Interface Guidelines (180 × 180 for iPhone @3x)' },
  { key: 'applePadding', label: 'Apple touch icon padding', value: 0.12, unit: 'of the icon', min: 0, max: 0.4, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'maskableSafe', label: 'Maskable safe padding', value: 0.2, unit: 'of the icon, each side', min: 0.1, max: 0.4, step: 0.01, chosenBy: DL, reason: TODO, inheritedFrom: 'W3C maskable icons: keep content inside the central circle of 40% radius' },
  { key: 'background', label: 'Background (Apple and maskable)', value: '#FFFFFF', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'themeColor', label: 'Theme color', value: '#FFFFFF', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'appName', label: 'App name', value: 'My app', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'display', label: 'Manifest display mode', value: 'standalone', options: ['standalone', 'minimal-ui', 'browser', 'fullscreen'], chosenBy: DL, reason: TODO, inheritedFrom: null },
];
