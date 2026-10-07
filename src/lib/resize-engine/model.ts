/* The project data model, kept as plain JSON so it can move from local state to a database as is:
   Project → Master → SizeSet → Variant { size, fieldValues, overrides[] }. A size set's field values
   apply to all its variants; a variant's own fieldValues override them per size. Overrides (patches
   keyed by layer id) are stored but not applied yet. */
import type { Override, Size } from './render';

export interface Variant { id: string; size: Size; fieldValues: Record<string, string>; overrides: Override[] }
export interface SizeSet { id: string; name: string; fieldValues: Record<string, string>; variants: Variant[] }
export interface MasterDoc { id: string; name: string; fileName: string; svg: string; sizeSets: SizeSet[] }
export interface Project { id: string; name: string; createdAt: number; updatedAt: number; masters: MasterDoc[] }

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function newProject(name = 'Untitled'): Project {
  const t = Date.now();
  return { id: newId('prj'), name, createdAt: t, updatedAt: t, masters: [] };
}
export function newMaster(fileName: string, svg: string, sizes: Size[]): MasterDoc {
  return { id: newId('mst'), name: fileName.replace(/\.svg$/i, ''), fileName, svg, sizeSets: [{ id: newId('set'), name: 'Sizes', fieldValues: {}, variants: sizes.map(newVariant) }] };
}
export const newVariant = (size: Size): Variant => ({ id: newId('var'), size: { ...size }, fieldValues: {}, overrides: [] });

/** The size set's variants for a new size list: variants for sizes already there are kept (with their values and overrides). */
export function withSizes(set: SizeSet, sizes: Size[]): SizeSet {
  const pool = [...set.variants];
  const variants = sizes.map(s => {
    const i = pool.findIndex(v => v.size.w === s.w && v.size.h === s.h);
    return i >= 0 ? pool.splice(i, 1)[0] : newVariant(s);
  });
  return { ...set, variants };
}
/** Field values for one variant: the set's, then the variant's own. */
export const valuesFor = (set: SizeSet, v: Variant): Record<string, string> => ({ ...set.fieldValues, ...v.fieldValues });

/** One size per line: "1080×1080", "1080x1080", "1080 x 1080" or "1080, 1080". */
export function parseSizes(text: string): { sizes: Size[]; errors: string[] } {
  const sizes: Size[] = [], errors: string[] = [];
  text.split(/\n/).map(l => l.trim()).filter(Boolean).forEach((l, i) => {
    const m = /^(\d+(?:\.\d+)?)\s*(?:[x×*,]|\s)\s*(\d+(?:\.\d+)?)(?:\s*px)?$/i.exec(l);
    const w = m ? Number(m[1]) : NaN, h = m ? Number(m[2]) : NaN;
    if (m && w >= 1 && h >= 1 && w <= 20000 && h <= 20000) sizes.push({ w, h });
    else errors.push(`Line ${i + 1}: “${l}” isn’t a size (use 1080×1080)`);
  });
  return { sizes, errors };
}
export const sizesToText = (sizes: Size[]) => sizes.map(s => `${s.w}×${s.h}`).join('\n');
/** "16:9" with a base, longest side first at `long` px. */
export function ratioSize(ratio: string, long: number): Size | null {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return a >= b ? { w: long, h: Math.round(long * b / a) } : { w: Math.round(long * a / b), h: long };
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** "16:9" for 1920×1080; "4.05:1" when the sides share no small ratio. */
export function ratioLabel(s: Size): string {
  const g = gcd(Math.round(s.w), Math.round(s.h));
  const a = Math.round(s.w) / g, b = Math.round(s.h) / g;
  return a <= 32 && b <= 32 ? `${a}:${b}` : s.w >= s.h ? `${(s.w / s.h).toFixed(2).replace(/\.?0+$/, '')}:1` : `1:${(s.h / s.w).toFixed(2).replace(/\.?0+$/, '')}`;
}
