/* Lathe's adaptive resize engine. Pure TypeScript with no DOM or UI dependency: the Resize tool
   imports it, never the reverse.

     parse(svgString) → Master                     an Illustrator SVG as a tagged layer tree
     render(master, {w, h}, fields, opts) → Layout  placement by rules, text fit, overflow flags
     layoutToSVG(layout) → string                   one variant as SVG

   Text is measured with HarfBuzz: createShaper(loadFonts(bytes)) from './shaper' (imported on its
   own, since it loads the WASM), passed as opts.shaper. */
export { parse, DEFAULT_BREAKPOINTS, type ParseOptions } from './parse';
export { render, breakpointFor, type RenderOptions, type Size, type Override } from './render';
export { layoutToSVG, type SvgOptions } from './svg';
export { approxShaper } from './approx';
export { parseLayerName, decodeIllustratorId } from './names';
export * from './model';
export type * from './types';
