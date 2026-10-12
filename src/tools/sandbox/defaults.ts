import type { DefaultsManifest } from '../types';

export const defaults: DefaultsManifest = [
  { key: 'matte', options: ['black', 'white', 'lathe'], label: 'Matte', value: 'black' },
  { key: 'view', options: ['fit', 'actual'], label: 'View', value: 'fit' },
  { key: 'colorSpace', editable: false, label: 'Export color space', value: 'sRGB' },
];
