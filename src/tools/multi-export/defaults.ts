import type { DefaultsManifest } from '../types';
export const defaults: DefaultsManifest = [
  { key: 'formats', options: ['png', 'jpg', 'svg', 'eps'], label: 'File formats', value: ['png', 'jpg', 'svg', 'eps'] },
  { key: 'colorSpaces', options: ['rgb', 'cmyk'], label: 'Color spaces', value: ['rgb', 'cmyk'] },
  { key: 'treatments', options: ['color', 'grayscale'], label: 'Treatments', value: ['color', 'grayscale'] },
  { key: 'rasterSize', min: 16, max: 16000, step: 1, label: 'Raster size', value: 2000, unit: 'px longest edge' },
  { key: 'rasterMin', min: 16, max: 16000, step: 1, label: 'Smallest raster', value: 64, unit: 'px' },
  { key: 'rasterMax', min: 16, max: 16000, step: 1, label: 'Largest raster', value: 6000, unit: 'px' },
  { key: 'jpegQuality', min: 1, max: 100, step: 1, label: 'JPEG quality', value: 92, unit: '%' },
  { key: 'jpgMatte', label: 'JPEG matte', value: '#FFFFFF' },
  { key: 'epsRasterMax', min: 16, max: 4000, step: 1, label: 'Raster EPS size', value: 600, unit: 'px longest edge' },
  { key: 'grayWeights', label: 'Grayscale weights', value: [0.2126, 0.7152, 0.0722], unit: 'R G B' },
  { key: 'cmykSeparation', editable: false, label: 'CMYK separation', value: 'Uncalibrated, K = 1 − max(R,G,B)' },
  { key: 'rgbSpace', editable: false, label: 'RGB color space', value: 'sRGB' },
  { key: 'previewOn', options: ['light', 'dark'], label: 'Preview surface', value: 'light' },
];
