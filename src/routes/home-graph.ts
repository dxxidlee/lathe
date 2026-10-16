/* Home graph geometry, in a 1200 × 900 viewBox. A construction drawing in the manner of an
   architect's sketch: dashed axes and diagonals, a square, two offset circles, two long sweeping
   curves, and the Lathe mark (from brand/lathe-mark.svg) at the centre, its lobes on the axes
   touching the square's sides. Each tool's route rides that geometry (an arc along a circle, a ray
   along a diagonal, a run down an edge, a loop out of the centre) and ends in an arrowhead at its
   label. Routes are placed by hand; tools without one get an even placement on the outer ring.
   Home.tsx renders and animates it. */
import { MARK_PATH } from '../brand/mark-path';

export const VIEW = { w: 1200, h: 900 };
type P = { x: number; y: number };
const C: P = { x: 600, y: 455 };
const SQ = { x0: 410, y0: 265, x1: 790, y1: 645 };          // the square
const CA = { o: C, r: 262 };                                // outer circle
const CB = { o: { x: 622, y: 438 } as P, r: 222 };          // offset circle
export const MARK_R = 192;                                  // mark lobes just touch the square's sides

const f = (n: number) => Math.round(n * 10) / 10;
const pt = (p: P) => `${f(p.x)} ${f(p.y)}`;
const pol = (deg: number, r: number, o: P = C): P => ({ x: o.x + Math.cos(deg * Math.PI / 180) * r, y: o.y + Math.sin(deg * Math.PI / 180) * r });

/** Chevron arrowhead at `tip`, pointing away from `from`. */
function arrow(tip: P, from: P, size = 11): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = { x: tip.x - Math.cos(a - 0.5) * size, y: tip.y - Math.sin(a - 0.5) * size };
  const r = { x: tip.x - Math.cos(a + 0.5) * size, y: tip.y - Math.sin(a + 0.5) * size };
  return `M${pt(l)} L${pt(tip)} L${pt(r)}`;
}
function circle(o: P, r: number) { return `M${f(o.x - r)} ${f(o.y)} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`; }

export interface Structure { d: string; dashed?: boolean; mark?: boolean }
export const STRUCTURE: Structure[] = [
  { d: `M600 105 L600 835`, dashed: true },
  { d: `M240 455 L960 455`, dashed: true },
  { d: `M${pt(pol(-135, 360))} L${pt(pol(45, 360))}`, dashed: true },
  { d: `M${pt(pol(-45, 360))} L${pt(pol(135, 360))}`, dashed: true },
  { d: `M${SQ.x0} ${SQ.y0} H${SQ.x1} V${SQ.y1} H${SQ.x0} Z` },
  { d: circle(CA.o, CA.r) },
  { d: circle(CB.o, CB.r) },
  { d: MARK_PATH, mark: true },
  { d: `M300 868 C 520 860, 760 760, 742 600 S 520 470, 470 560` },
  { d: `M905 300 C 1040 230, 1110 330, 1030 400 S 760 470, 520 500 S 250 560, 300 690` },
];
export const MARK_TRANSFORM = `translate(${C.x} ${C.y}) scale(${MARK_R / 1200}) translate(-1500 -1500)`;

export interface Route { line: string; head: string; label: P; anchor: 'start' | 'middle' | 'end'; baseline: 'auto' | 'hanging' | 'middle' }

const ray = (a: P, b: P) => ({ line: `M${pt(a)} L${pt(b)}`, end: b, from: a });
function arc(c: { o: P; r: number }, a0: number, a1: number) {
  const s = pol(a0, c.r, c.o), e = pol(a1, c.r, c.o);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
  return { line: `M${pt(s)} A${c.r} ${c.r} 0 ${large} ${sweep} ${pt(e)}`, end: e, from: pol(a1 - Math.sign(a1 - a0) * 4, c.r, c.o) };
}
const cubic = (a: P, c1: P, c2: P, b: P) => ({ line: `M${pt(a)} C${pt(c1)} ${pt(c2)} ${pt(b)}`, end: b, from: c2 });
const route = (r: { line: string; end: P; from: P }, label: P, anchor: Route['anchor'], baseline: Route['baseline'] = 'middle'): Route =>
  ({ line: r.line, head: arrow(r.end, r.from), label, anchor, baseline });

const PLACED: Record<string, Route> = {
  'subject-audit': route(ray(pol(-135, 150), pol(-135, 330)), { x: 352, y: 196 }, 'end'),
  'brand-audit': route(ray(pol(-45, 150), pol(-45, 310)), { x: 828, y: 216 }, 'start'),
  'reference': route(cubic({ x: 600, y: 266 }, { x: 612, y: 190 }, { x: 650, y: 150 }, { x: 702, y: 140 }), { x: 714, y: 140 }, 'start'),
  'contrast': route(arc(CA, -160, -52), { x: 776, y: 232 }, 'start'),
  palette: route(cubic(pol(22, CA.r), { x: 930, y: 470 }, { x: 960, y: 260 }, { x: 1052, y: 258 }), { x: 1064, y: 258 }, 'start'),
  'recolor': route(arc(CB, -40, -10), { x: 856, y: 392 }, 'start'),
  'gradient': route(cubic({ x: 616, y: 462 }, { x: 1180, y: 600 }, { x: 1140, y: 830 }, { x: 880, y: 805 }), { x: 866, y: 805 }, 'end'),
  dither: route(ray(pol(45, 290), pol(45, 345)), { x: 853, y: 708 }, 'start'),
  specimen: route(ray(pol(135, 290), pol(135, 345)), { x: 347, y: 708 }, 'end'),
  deck: route(arc(CA, 196, 158), { x: 340, y: 560 }, 'end'),
  'kinetic-type': route(cubic({ x: 470, y: 560 }, { x: 330, y: 640 }, { x: 170, y: 560 }, { x: 205, y: 430 }), { x: 205, y: 416 }, 'middle', 'auto'),
  'logo-export': route(arc(CB, 200, 166), { x: 384, y: 360 }, 'end'),
  'icons': route(ray({ x: SQ.x0, y: SQ.y0 }, { x: SQ.x0, y: 165 }), { x: SQ.x0, y: 152 }, 'middle', 'auto'),
};

export function routesFor(ids: string[]): Route[] {
  const loose = ids.filter(id => !PLACED[id]);
  return ids.map(id => PLACED[id] ?? fallback(loose.indexOf(id), loose.length));
}
function fallback(i: number, n: number): Route {
  const deg = -70 + (i + 0.5) * (140 / Math.max(1, n));
  const s = pol(deg, CA.r), e = pol(deg, 400);
  return route(ray(s, e), pol(deg, 414), Math.cos(deg * Math.PI / 180) > 0 ? 'start' : 'end');
}

export const MAKE: Route = route(ray({ x: 600, y: CA.o.y + CA.r }, { x: 600, y: 818 }), { x: 600, y: 836 }, 'middle', 'hanging');

/* ---- Tool copy for hover tooltips ---- */
export interface ToolCopy { problem: string; lathe: string }
export const TOOL_COPY: Record<string, ToolCopy> = {
  'subject-audit': { problem: 'Moodboards mean hours of tabs across archives, Pinterest and stock sites.', lathe: 'Search 13 open archives at once and pin straight to a board.' },
  'brand-audit': { problem: 'Auditing a brand starts with screenshots, saved posts and eyedropper guesses.', lathe: 'Type a name. Get its logo, colors and content, then pick what goes on the slide.' },
  deck: { problem: 'Every bento slide gets rebuilt by hand, tile by tile, gap by gap.', lathe: 'Drop images in; the grid holds its gaps while you crop and resize.' },
  palette: { problem: 'Pulling colors from an image means eyedropping and retyping hex codes into three apps.', lathe: 'One image in. Scales, tokens and an Adobe swatch file out.' },
  contrast: { problem: 'Accessibility checks happen one color pair at a time, usually at the end.', lathe: 'Paste your colors and see every pairing pass or fail at once.' },
  'logo-export': { problem: 'A logo handoff means a dozen manual exports per format and color mode.', lathe: 'One file in. Every format, color space and treatment out, zipped.' },
  icons: { problem: 'Favicons and app icons need a dozen sizes nobody remembers.', lathe: 'One mark in. The full set and its code out.' },
  specimen: { problem: 'Judging a typeface means installing it and building test pages.', lathe: 'Drop a font file and see every glyph, metric and feature.' },
  reference: { problem: 'Reference images get buried behind the window you\'re working in.', lathe: 'A strip of references that floats above everything.' },
  dither: { problem: 'Halftone and dither effects take plugins or slow manual work.', lathe: 'Pick a method, export print-ready SVG or PNG.' },
  gradient: { problem: 'Mesh gradients mean nudging points until something looks right.', lathe: 'Generate, shuffle, add grain, export.' },
  'kinetic-type': { problem: 'A five-second type loop means opening After Effects.', lathe: 'Type, pick a motion, export a GIF.' },
  recolor: { problem: 'Matching footage to a brand palette means grading frame by frame.', lathe: 'Set the palette; recolor image or video in one pass.' },
  make: { problem: 'When the tool you need doesn\'t exist, you wait for someone senior to approve it.', lathe: 'Describe the chore. Lathe builds the tool.' },
};
