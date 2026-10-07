/* The engine's data: a parsed master (JSON-serializable, so it can be stored), the rules read from
   layer names, and the layouts render() produces. */
import type { Box, M } from './matrix';

export type Anchor = 'tl' | 'tc' | 'tr' | 'cl' | 'c' | 'cr' | 'bl' | 'bc' | 'br';
/** Where a layer goes: an anchor, or its centre at a percentage of the artboard. */
export type Position = Anchor | { x: number; y: number };
export type Fit = 'shrink' | 'wrap' | 'truncate';

export interface Rules {
  fixed?: boolean;
  anchor?: Anchor;
  stretchX?: boolean;
  stretchY?: boolean;
  /** Present when the layer scales with explicit bounds (`scale`, `scale:0.5-2`). */
  scale?: { min?: number; max?: number };
  tile?: boolean;
  /** Position per breakpoint id. */
  reflow?: Record<string, Position>;
  /** Hidden when the artboard's shorter side (or width `w`, height `h`) is below `px`. */
  hideBelow?: { axis: 'min' | 'w' | 'h'; px: number };
  /** Field this text layer is bound to. */
  text?: string;
  fit?: Fit[];
  /** Smallest font size in output px (fit:shrink). */
  min?: number;
  /** Most lines (fit:wrap, fit:truncate). */
  lines?: number;
}

export interface Breakpoint { id: string; min?: number; max?: number }

export interface FontRequest { family: string; postscript: string | null; weight: number; style: 'normal' | 'italic' }

export interface TextInfo {
  /** Text as written, lines joined with "\n". */
  content: string;
  font: FontRequest;
  /** In master px (the text matrix's scale applied). */
  fontSize: number;
  /** Line advance as a multiple of the font size. */
  lineHeight: number;
  /** Absolute anchor point of the first baseline. */
  x: number; y: number;
  align: 'start' | 'middle' | 'end';
  fill: string;
  letterSpacing: number;
  /** Rotated or skewed text is drawn as it is, through the layer matrix, and never refit. */
  rotated: boolean;
  /** The original element's inner XML, for rotated text. */
  inner: string;
}

export interface ClipShape { tag: string; attrs: Record<string, string>; matrix: M }
export interface Clip { shapes: ClipShape[]; bbox: Box | null }

export interface LayerNode {
  /** Stable: from the layer name (slugged, deduplicated), or the tag and its path for unnamed layers. */
  id: string;
  name: string | null;
  rules: Rules;
  kind: 'group' | 'shape' | 'text' | 'image';
  tag: string;
  /** Own presentation attributes, classes and style inlined; no transform, id or class. */
  attrs: Record<string, string>;
  /** Absolute matrix (all ancestors' transforms and its own, flattened). */
  matrix: M;
  /** Absolute box in master px (live text estimated until a shaper measures it). */
  bbox: Box | null;
  children: LayerNode[];
  clip: Clip | null;
  text: TextInfo | null;
}

export interface Field { id: string; label: string; value: string; layers: string[]; fit: Fit[]; min?: number; lines?: number }
export interface Warning { code: 'outlined-text' | 'unknown-rule' | 'mask' | 'rotated-text' | 'missing-font' | 'no-viewbox' | 'empty'; message: string; layer?: string }

export interface Master {
  version: 1;
  width: number; height: number;
  root: LayerNode;
  /** Layout units in paint order: layers placed against the artboard by their rules. */
  units: string[];
  fields: Field[];
  breakpoints: Breakpoint[];
  /** Gradients, patterns, symbols, filters and the like, serialized, ids kept. */
  defs: string;
  fonts: FontRequest[];
  warnings: Warning[];
}

/* ---------------- render ---------------- */

export interface ResolvedFont {
  /** CSS family to draw with: the face that was measured, so drawing matches measuring. */
  css: string;
  weight: number;
  style: 'normal' | 'italic';
  /** Ascent and descent as fractions of the font size. */
  ascent: number; descent: number;
  /** False when the requested font is missing and another stands in. */
  exact: boolean;
  /** Opaque handle for the shaper. */
  key: string;
}
/** Measures text. The engine takes any implementation; createShaper() uses HarfBuzz. */
export interface Shaper {
  resolve(req: FontRequest): ResolvedFont;
  /** Advance width in px of one line of text. */
  measure(font: ResolvedFont, text: string, size: number, letterSpacing?: number): number;
}

export type FitStatus = 'fit' | 'shrunk' | 'wrapped' | 'truncated' | 'overflow';
export interface FieldResult { overflow: boolean; truncated: boolean; status: FitStatus; fontSize: number; lines: number; layers: string[] }

export type Item =
  /** A layer drawn through a matrix; `skip` lists descendants drawn as their own items. `inherit`
      carries the properties its (undrawn) ancestors passed down, such as fill. */
  | { type: 'unit'; id: string; node: LayerNode; matrix: M; skip: string[]; inherit: Record<string, string> }
  | { type: 'tile'; id: string; node: LayerNode; region: Box; cell: Box; scale: number; inherit: Record<string, string> }
  | { type: 'text'; id: string; node: LayerNode; field: string | null; lines: string[]; x: number; y: number; align: TextInfo['align']; fontSize: number; lineHeight: number;
      font: ResolvedFont; fill: string; letterSpacing: number; box: Box; status: FitStatus };

export interface Layout {
  width: number; height: number;
  breakpoint: string | null;
  items: Item[];
  /** Fit result per field (worst layer wins). */
  fields: Record<string, FieldResult>;
  /** True when any field overflows. */
  overflow: boolean;
  hidden: string[];
  defs: string;
  warnings: Warning[];
}
