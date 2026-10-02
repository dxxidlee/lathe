import type { DefaultsManifest } from '../types';

export const defaults: DefaultsManifest = [
  { key: 'matte', options: ['black', 'white', 'lathe'], label: 'Matte', value: 'black', chosenBy: 'David Lee', reason: 'TODO(David)', inheritedFrom: null },
  { key: 'view', options: ['fit', 'actual'], label: 'View', value: 'fit', chosenBy: 'David Lee', reason: 'TODO(David)', inheritedFrom: null },
  { key: 'colorSpace', editable: false, label: 'Export color space', value: 'sRGB', chosenBy: 'David Lee', reason: 'TODO(David)', inheritedFrom: 'sRGB (IEC 61966-2-1), the web default' },
];
