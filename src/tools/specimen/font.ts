/* Font reading for Specimen: WOFF2 is unpacked to sfnt, then parsed with opentype.js for names,
   metrics, glyphs and OpenType feature tags; the same bytes are loaded as a FontFace so the page can
   set live text with font-feature-settings. */
import { parse, type Font, type PathCommand } from 'opentype.js';

export interface FontInfo {
  font: Font; family: string; style: string; full: string; version: string | null; designer: string | null; license: string | null;
  format: string; upm: number; ascender: number; descender: number; xHeight: number | null; capHeight: number | null; lineGap: number;
  weight: number | null; glyphs: number; features: string[]; cssFamily: string;
}

/** A name-table entry. opentype.js 2 groups names by platform (windows, macintosh, unicode); 1.x kept them flat. */
const name = (f: Font, k: string): string | null => {
  const all = f.names as unknown as Record<string, Record<string, Record<string, string> | string> | undefined>;
  for (const n of [all[k], all.windows?.[k], all.macintosh?.[k], all.unicode?.[k]]) {
    if (!n) continue;
    if (typeof n === 'string') return n;
    const v = n.en ?? Object.values(n)[0];
    if (typeof v === 'string' && v) return v;
  }
  return null;
};
let seq = 0;

export async function readFont(bytes: ArrayBuffer, fileName: string): Promise<FontInfo> {
  let sfnt = bytes;
  const sig = new TextDecoder().decode(new Uint8Array(bytes, 0, 4));
  if (sig === 'wOF2') {
    const { default: decompress } = await import('woff2-encoder/decompress');
    const out = await decompress(new Uint8Array(bytes));
    sfnt = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  }
  const font = parse(sfnt);
  const os2 = font.tables.os2 ?? {};
  const features = [...new Set([...(font.tables.gsub?.features ?? []), ...(font.tables.gpos?.features ?? [])].map(f => f.tag))].sort();
  const cssFamily = `LatheSpecimen${++seq}`;
  const face = new FontFace(cssFamily, sfnt);
  await face.load();
  document.fonts.add(face);
  return {
    font,
    family: name(font, 'preferredFamily') ?? name(font, 'fontFamily') ?? fileName.replace(/\.[^.]+$/, ''),
    style: name(font, 'preferredSubfamily') ?? name(font, 'fontSubfamily') ?? 'Regular',
    full: name(font, 'fullName') ?? fileName,
    version: name(font, 'version'), designer: name(font, 'designer'), license: name(font, 'license'),
    format: sig === 'wOF2' ? 'WOFF2' : sig === 'wOFF' ? 'WOFF' : font.outlinesFormat === 'cff' ? 'OpenType (CFF)' : 'TrueType',
    upm: font.unitsPerEm, ascender: font.ascender, descender: font.descender,
    xHeight: os2.sxHeight || measure(font, 'x'), capHeight: os2.sCapHeight || measure(font, 'H'),
    lineGap: font.tables.hhea?.lineGap ?? os2.sTypoLineGap ?? 0, weight: os2.usWeightClass ?? null,
    glyphs: font.numGlyphs, features, cssFamily,
  };
}

/** Height of a glyph's outline top, in font units (fallback when OS/2 lacks x-height or cap height). */
function measure(font: Font, ch: string): number | null {
  const g = font.charToGlyph(ch);
  if (!g || !g.unicodes.length) return null;
  const b = g.getPath(0, 0, font.unitsPerEm).getBoundingBox();
  return Math.round(-b.y1);
}

/** Quadratic segments as cubics, so every renderer gets one curve type. */
export function cubicCommands(cmds: PathCommand[]): PathCommand[] {
  const out: PathCommand[] = []; let x = 0, y = 0, sx = 0, sy = 0;
  for (const c of cmds) {
    if (c.type === 'M') { x = sx = c.x!; y = sy = c.y!; out.push(c); }
    else if (c.type === 'L') { x = c.x!; y = c.y!; out.push(c); }
    else if (c.type === 'C') { x = c.x!; y = c.y!; out.push(c); }
    else if (c.type === 'Q') {
      out.push({ type: 'C', x1: x + (2 / 3) * (c.x1! - x), y1: y + (2 / 3) * (c.y1! - y), x2: c.x! + (2 / 3) * (c.x1! - c.x!), y2: c.y! + (2 / 3) * (c.y1! - c.y!), x: c.x, y: c.y });
      x = c.x!; y = c.y!;
    } else { out.push(c); x = sx; y = sy; }
  }
  return out;
}

export interface ScaleStep { step: number; px: number }
export function typeScale(base: number, ratio: number, up: number, down: number): ScaleStep[] {
  const out: ScaleStep[] = [];
  for (let i = up; i >= -down; i--) out.push({ step: i, px: Math.round(base * ratio ** i * 100) / 100 });
  return out;
}

/* Simple layout for drawing outlines (metrics diagram, PDF): the character map, advances and pair
   kerning, without opentype.js's shaping, which throws on some GSUB lookups it doesn't support.
   Live text on the page is set by the browser with full shaping. */
function placed(font: Font, text: string, size: number) {
  const k = size / font.unitsPerEm;
  const glyphs = [...text].map(ch => font.charToGlyph(ch));
  const out: { g: ReturnType<Font['charToGlyph']>; x: number }[] = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    out.push({ g, x });
    let kern = 0;
    const next = glyphs[i + 1];
    if (next) { try { kern = font.getKerningValue(g, next); } catch { kern = 0; } }
    x += ((g.advanceWidth ?? font.unitsPerEm / 2) + kern) * k;
  });
  return { out, width: x };
}
export const textWidth = (font: Font, text: string, size: number) => placed(font, text, size).width;
export function textCommands(font: Font, text: string, x: number, y: number, size: number): PathCommand[] {
  const cmds: PathCommand[] = [];
  for (const p of placed(font, text, size).out) cmds.push(...p.g.getPath(x + p.x, y, size).commands);
  return cmds;
}
export function textPathData(font: Font, text: string, x: number, y: number, size: number): string {
  return textCommands(font, text, x, y, size).map(c =>
    c.type === 'Z' ? 'Z' : c.type === 'M' || c.type === 'L' ? `${c.type}${r(c.x!)} ${r(c.y!)}`
      : c.type === 'Q' ? `Q${r(c.x1!)} ${r(c.y1!)} ${r(c.x!)} ${r(c.y!)}` : `C${r(c.x1!)} ${r(c.y1!)} ${r(c.x2!)} ${r(c.y2!)} ${r(c.x!)} ${r(c.y!)}`).join('');
}
const r = (n: number) => Math.round(n * 100) / 100;
