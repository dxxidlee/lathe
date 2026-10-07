/* Text measurement with HarfBuzz (WASM) on the actual font files, so line breaks come out the same
   everywhere, unlike the DOM's. createShaper() takes TrueType/OpenType bytes (collections too) and
   matches requests by PostScript name, then family and nearest weight; variable fonts are set to the
   requested weight on their wght axis. A missing font is measured with the first loaded font, and
   the text is drawn with that same font (ResolvedFont.css), so measuring and drawing agree. */
import * as hb from 'harfbuzzjs';
import { slug } from './names';
import type { FontRequest, ResolvedFont, Shaper } from './types';

export interface LoadedFont {
  key: string;
  family: string; subfamily: string; postscript: string;
  weight: number; italic: boolean;
  /** wght axis range for variable fonts. */
  wght: { min: number; max: number } | null;
  upem: number; ascent: number; descent: number;
  /** The CSS family the UI registers this face under (shared by a family's weights). */
  css: string;
  /** The sfnt bytes, for registering the face for drawing. */
  data: Uint8Array;
}

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every face in a TrueType/OpenType file or collection. Throws on anything else (WOFF2 must be decompressed first). */
export function loadFonts(data: ArrayBuffer | Uint8Array): LoadedFont[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const sig = String.fromCharCode(...bytes.subarray(0, 4));
  if (sig === 'wOFF' || sig === 'wOF2') throw new Error('WOFF fonts must be decompressed to TrueType or OpenType first');
  const count = sig === 'ttcf' ? u32(bytes, 8) : 1;
  const blob = new hb.Blob(bytes);
  const out: LoadedFont[] = [];
  for (let i = 0; i < count; i++) {
    const face = new hb.Face(blob, i);
    const name = (id: number) => { try { return face.getName(id, 'en') || ''; } catch { return ''; } };
    const family = name(16) || name(1), subfamily = name(17) || name(2), postscript = name(6) || `${family}-${subfamily}`;
    if (!family) continue;
    const os2 = face.referenceTable('OS/2');
    const axes = face.getAxisInfos();
    const wght = axes.wght ? { min: axes.wght.min, max: axes.wght.max } : null;
    const weight = wght ? axes.wght.default : os2 && os2.length > 6 ? u16(os2, 4) : 400;
    const italic = os2 && os2.length > 64 ? (u16(os2, 62) & 1) === 1 : /italic|oblique/i.test(subfamily);
    const ext = new hb.Font(face).hExtents();
    out.push({ key: `${postscript}#${i}`, family, subfamily, postscript, weight, italic, wght, upem: face.upem, ascent: ext.ascender / face.upem, descent: -ext.descender / face.upem, css: `lr-${slug(family)}`, data: bytes });
  }
  if (!out.length) throw new Error('No readable font in the file');
  return out;
}

export interface HarfbuzzShaper extends Shaper { fonts: LoadedFont[] }

/** A shaper over the given fonts; the first one stands in for missing fonts. */
export function createShaper(fonts: LoadedFont[]): HarfbuzzShaper {
  const hbFonts = new Map<string, hb.Font>();
  const widths = new Map<string, number>();
  const byKey = new Map(fonts.map(f => [f.key, f]));
  const faceFont = (f: LoadedFont, weight: number) => {
    const k = `${f.key}@${weight}`;
    let font = hbFonts.get(k);
    if (!font) {
      font = new hb.Font(new hb.Face(new hb.Blob(f.data), Number(f.key.split('#')[1]) || 0));
      if (f.wght) font.setVariations([new hb.Variation('wght', weight)]);
      hbFonts.set(k, font);
    }
    return font;
  };
  const pick = (req: FontRequest): { f: LoadedFont; exact: boolean } | null => {
    if (!fonts.length) return null;
    const ps = req.postscript && norm(req.postscript);
    const exactPs = ps ? fonts.find(f => norm(f.postscript) === ps) : undefined;
    if (exactPs) return { f: exactPs, exact: true };
    const fam = fonts.filter(f => norm(f.family) === norm(req.family) || (ps && ps.startsWith(norm(f.family))));
    const italic = req.style === 'italic';
    const pool = fam.filter(f => f.italic === italic).length ? fam.filter(f => f.italic === italic) : fam;
    if (pool.length) {
      const dist = (f: LoadedFont) => f.wght && req.weight >= f.wght.min && req.weight <= f.wght.max ? 0 : Math.abs(f.weight - req.weight);
      return { f: [...pool].sort((a, b) => dist(a) - dist(b))[0], exact: true };
    }
    return { f: fonts[0], exact: false };
  };
  return {
    fonts,
    resolve(req) {
      const p = pick(req);
      if (!p) throw new Error('No fonts loaded');
      const weight = p.f.wght ? Math.min(p.f.wght.max, Math.max(p.f.wght.min, req.weight)) : p.f.weight;
      return { css: p.f.css, weight, style: p.f.italic ? 'italic' : 'normal', ascent: p.f.ascent, descent: p.f.descent, exact: p.exact, key: `${p.f.key}@${weight}` } satisfies ResolvedFont;
    },
    measure(rf, text, size, letterSpacing = 0) {
      if (!text) return 0;
      let units = widths.get(`${rf.key}|${text}`);
      if (units == null) {
        const [key, w] = rf.key.split('@');
        const f = byKey.get(key);
        if (!f) return 0;
        const buf = new hb.Buffer();
        buf.addText(text); buf.guessSegmentProperties();
        hb.shape(faceFont(f, Number(w)), buf);
        units = buf.getGlyphPositions().reduce((s, p) => s + p.xAdvance, 0) / f.upem;
        widths.set(`${rf.key}|${text}`, units);
      }
      return units * size + letterSpacing * Math.max(0, [...text].length - 1);
    },
  };
}

export { approxShaper } from './approx';
