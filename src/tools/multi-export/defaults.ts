import type { DefaultsManifest } from '../types';

const TODO = 'TODO(David)';
const DL = 'David Lee';

export const defaults: DefaultsManifest = [
  { key: 'formats', label: 'File formats', value: ['png', 'jpg', 'svg', 'eps'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'colorSpaces', label: 'Color spaces', value: ['rgb', 'cmyk'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'treatments', label: 'Treatments', value: ['color', 'grayscale'], chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rasterSize', label: 'Raster size', value: 2000, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rasterMin', label: 'Smallest raster', value: 64, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rasterMax', label: 'Largest raster', value: 6000, unit: 'px', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'jpegQuality', label: 'JPEG quality', value: 92, unit: '%', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'jpgMatte', label: 'JPEG matte', value: '#FFFFFF', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'epsRasterMax', label: 'Raster EPS size', value: 600, unit: 'px longest edge', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'grayWeights', label: 'Grayscale weights', value: [0.2126, 0.7152, 0.0722], unit: 'R G B', chosenBy: DL, reason: TODO, inheritedFrom: 'ITU-R BT.709 luma coefficients' },
  { key: 'cmykSeparation', label: 'CMYK separation', value: 'Uncalibrated, K = 1 − max(R,G,B)', chosenBy: DL, reason: TODO, inheritedFrom: null },
  { key: 'rgbSpace', label: 'RGB color space', value: 'sRGB', chosenBy: DL, reason: TODO, inheritedFrom: 'sRGB (IEC 61966-2-1), the color space of canvas and SVG' },
  { key: 'previewOn', label: 'Preview surface', value: 'light', chosenBy: DL, reason: TODO, inheritedFrom: null },
];
