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
const C: P = { x: 600, y: 450 };
const SQ = { x0: 420, y0: 270, x1: 780, y1: 630 };          // tighter square
const CA = { o: C, r: 240 };                                // outer circle — pulled in
const CB = { o: { x: 618, y: 440 } as P, r: 200 };          // offset circle — smaller, less overlap
export const MARK_R = 192;                                  // mark lobes just touch the square's sides

const f = (n: number) => Math.round(n * 10) / 10;
const pt = (p: P) => `${f(p.x)} ${f(p.y)}`;
const pol = (deg: number, r: number, o: P = C): P => ({ x: o.x + Math.cos(deg * Math.PI / 180) * r, y: o.y + Math.sin(deg * Math.PI / 180) * r });

/** Chevron arrowhead at `tip`, pointing away from `from`, with a tail that overlaps the route. */
function arrow(tip: P, from: P, size = 11): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = { x: tip.x - Math.cos(a - 0.5) * size, y: tip.y - Math.sin(a - 0.5) * size };
  const r = { x: tip.x - Math.cos(a + 0.5) * size, y: tip.y - Math.sin(a + 0.5) * size };
  const tail = { x: tip.x - Math.cos(a) * size * 0.8, y: tip.y - Math.sin(a) * size * 0.8 };
  return `M${pt(tail)} L${pt(tip)} M${pt(l)} L${pt(tip)} L${pt(r)}`;
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
  'subject-audit': route(ray(pol(-135, 140), pol(-135, 330)), { x: 348, y: 196 }, 'end'),
  'brand-audit': route(ray(pol(-45, 140), pol(-45, 310)), { x: 838, y: 216 }, 'start'),
  'reference': route(cubic({ x: 600, y: 260 }, { x: 610, y: 170 }, { x: 670, y: 120 }, { x: 740, y: 110 }), { x: 752, y: 110 }, 'start'),
  'contrast': route(arc(CA, -160, -55), { x: 784, y: 240 }, 'start'),
  palette: route(cubic(pol(20, CA.r), { x: 920, y: 440 }, { x: 980, y: 230 }, { x: 1070, y: 230 }), { x: 1082, y: 230 }, 'start'),
  'recolor': route(arc(CB, -38, -8), { x: 832, y: 392 }, 'start'),
  'gradient': route(cubic({ x: 616, y: 460 }, { x: 1100, y: 580 }, { x: 1080, y: 820 }, { x: 860, y: 810 }), { x: 848, y: 818 }, 'end', 'hanging'),
  dither: route(ray(pol(45, 280), pol(45, 350)), { x: 852, y: 700 }, 'start'),
  specimen: route(ray(pol(135, 280), pol(135, 350)), { x: 340, y: 700 }, 'end'),
  deck: route(arc(CA, 200, 155), { x: 322, y: 556 }, 'end'),
  'kinetic-type': route(cubic({ x: 470, y: 550 }, { x: 320, y: 630 }, { x: 140, y: 550 }, { x: 170, y: 410 }), { x: 158, y: 402 }, 'end', 'auto'),
  'logo-export': route(arc(CB, 206, 172), { x: 374, y: 338 }, 'end'),
  'icons': route(ray({ x: SQ.x0, y: SQ.y0 }, { x: SQ.x0, y: 150 }), { x: SQ.x0, y: 140 }, 'middle', 'auto'),
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
