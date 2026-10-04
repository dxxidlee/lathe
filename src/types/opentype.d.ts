/* opentype.js 2.0 ships without types; only the parts Specimen uses. */
declare module 'opentype.js' {
  export interface PathCommand { type: 'M' | 'L' | 'C' | 'Q' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
  export interface BoundingBox { x1: number; y1: number; x2: number; y2: number }
  export class Path { commands: PathCommand[]; toPathData(decimals?: number): string; getBoundingBox(): BoundingBox }
  export class Glyph { index: number; name: string | null; unicode?: number; unicodes: number[]; advanceWidth?: number; getPath(x?: number, y?: number, fontSize?: number): Path }
  export interface FeatureRecord { tag: string }
  export class Font {
    names: Record<string, Record<string, string> | undefined>;
    unitsPerEm: number; ascender: number; descender: number; numGlyphs: number;
    glyphs: { length: number; get(i: number): Glyph };
    tables: {
      os2?: { sxHeight?: number; sCapHeight?: number; usWeightClass?: number; sTypoLineGap?: number; version?: number };
      hhea?: { lineGap?: number };
      head?: { fontRevision?: number };
      gsub?: { features?: FeatureRecord[] };
      gpos?: { features?: FeatureRecord[] };
      [k: string]: unknown;
    };
    outlinesFormat: string;
    charToGlyph(c: string): Glyph;
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean; features?: Record<string, boolean> }): Path;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
