import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'formats', options: ['png', 'jpg', 'svg', 'eps'], label: 'File formats', value: ['png', 'jpg', 'svg', 'eps'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colorSpaces', options: ['rgb', 'cmyk'], label: 'Color spaces', value: ['rgb', 'cmyk'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'treatments', options: ['color', 'grayscale'], label: 'Treatments', value: ['color', 'grayscale'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rasterSize', min: 16, max: 16000, step: 1, label: 'Raster size', value: 2000, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rasterMin', min: 16, max: 16000, step: 1, label: 'Smallest raster', value: 64, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rasterMax', min: 16, max: 16000, step: 1, label: 'Largest raster', value: 6000, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'jpegQuality', min: 1, max: 100, step: 1, label: 'JPEG quality', value: 92, unit: '%', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'jpgMatte', label: 'JPEG matte', value: '#FFFFFF', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'epsRasterMax', min: 16, max: 4000, step: 1, label: 'Raster EPS size', value: 600, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'grayWeights', label: 'Grayscale weights', value: [0.2126, 0.7152, 0.0722], unit: 'R G B', chosenBy: DL, reason: TODO, inheritedFrom: 'ITU-R BT.709 luma coefficients' },
  { key: 'cmykSeparation', editable: false, label: 'CMYK separation', value: 'Uncalibrated, K = 1 − max(R,G,B)', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rgbSpace', editable: false, label: 'RGB color space', value: 'sRGB', chosenBy: DL, reason: TODO, inheritedFrom: 'sRGB (IEC 61966-2-1), the color space of canvas and SVG' },
  { key: 'previewOn', options: ['light', 'dark'], label: 'Preview surface', value: 'light', chosenBy: DL, reason: TODO, inheritedFrom: null },
];
