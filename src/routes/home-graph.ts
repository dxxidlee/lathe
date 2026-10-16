/* Home graph: unique smooth paths for each tool in a 1200 × 900 viewBox.
   Construction grid of dashed axes and diagonals. Each tool gets a distinct
   geometric path (arc, loop, sweep, diagonal) ending in a tangent-aligned arrow. */
import { MARK_PATH } from '../brand/mark-path';

export const VIEW = { w: 1200, h: 900 };
type P = { x: number; y: number };
const C: P = { x: 600, y: 450 };
export const MARK_R = 192;

const f = (n: number) => Math.round(n * 10) / 10;
const pt = (p: P) => `${f(p.x)} ${f(p.y)}`;

function arrow(tip: P, from: P, size = 10): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = { x: tip.x - Math.cos(a - 0.45) * size, y: tip.y - Math.sin(a - 0.45) * size };
  const r = { x: tip.x - Math.cos(a + 0.45) * size, y: tip.y - Math.sin(a + 0.45) * size };
  return `M${pt(l)} L${pt(tip)} L${pt(r)}`;
}

export interface Structure { d: string; dashed?: boolean; mark?: boolean }
export const STRUCTURE: Structure[] = [
  { d: `M600 80 L600 820`, dashed: true },
  { d: `M200 450 L1000 450`, dashed: true },
  { d: `M280 130 L920 770`, dashed: true },
  { d: `M920 130 L280 770`, dashed: true },
  { d: MARK_PATH, mark: true },
];
export const MARK_TRANSFORM = `translate(${C.x} ${C.y}) scale(${MARK_R / 1200}) translate(-1500 -1500)`;

export interface ToolRoute {
  id: string;
  line: string;
  head: string;
  label: P;
  anchor: 'start' | 'end' | 'middle';
  baseline: 'auto' | 'hanging' | 'middle';
}

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

const ROUTES: ToolRoute[] = [
  // NW diagonal — long sweeping curve
  { id: 'subject-audit', line: 'M540 400 C480 340, 400 260, 330 200', head: arrow({ x: 330, y: 200 }, { x: 370, y: 230 }), label: { x: 318, y: 186 }, anchor: 'end', baseline: 'auto' },
  // NE arc
  { id: 'brand-audit', line: 'M660 400 C720 340, 800 260, 870 210', head: arrow({ x: 870, y: 210 }, { x: 840, y: 230 }), label: { x: 882, y: 200 }, anchor: 'start', baseline: 'auto' },
  // Straight up
  { id: 'reference', line: 'M600 360 L600 160', head: arrow({ x: 600, y: 160 }, { x: 600, y: 200 }), label: { x: 600, y: 144 }, anchor: 'middle', baseline: 'auto' },
  // Wide arc over the top
  { id: 'contrast', line: 'M520 380 C440 280, 540 160, 700 160 S920 240, 960 280', head: arrow({ x: 960, y: 280 }, { x: 940, y: 264 }), label: { x: 972, y: 272 }, anchor: 'start', baseline: 'middle' },
  // Sweeping right curve
  { id: 'palette', line: 'M680 420 C780 400, 900 340, 980 340 S1080 360, 1080 400', head: arrow({ x: 1080, y: 400 }, { x: 1060, y: 380 }), label: { x: 1092, y: 400 }, anchor: 'start', baseline: 'middle' },
  // Loop to the right
  { id: 'icons', line: 'M680 450 C800 450, 920 380, 920 320 S860 260, 800 280', head: arrow({ x: 800, y: 280 }, { x: 830, y: 270 }), label: { x: 788, y: 268 }, anchor: 'end', baseline: 'auto' },
  // SE diagonal
  { id: 'dither', line: 'M660 500 C720 560, 800 640, 870 700', head: arrow({ x: 870, y: 700 }, { x: 840, y: 670 }), label: { x: 882, y: 710 }, anchor: 'start', baseline: 'hanging' },
  // Gentle arc down-right
  { id: 'gradient', line: 'M660 480 C760 520, 880 600, 940 680 S960 760, 920 790', head: arrow({ x: 920, y: 790 }, { x: 930, y: 760 }), label: { x: 910, y: 804 }, anchor: 'end', baseline: 'hanging' },
  // Straight down
  { id: 'deck', line: 'M600 540 L600 740', head: arrow({ x: 600, y: 740 }, { x: 600, y: 700 }), label: { x: 600, y: 756 }, anchor: 'middle', baseline: 'hanging' },
  // SW diagonal sweep
  { id: 'specimen', line: 'M540 500 C480 560, 400 640, 330 700', head: arrow({ x: 330, y: 700 }, { x: 360, y: 670 }), label: { x: 318, y: 710 }, anchor: 'end', baseline: 'hanging' },
  // Left arc
  { id: 'logo-export', line: 'M520 480 C420 520, 300 560, 240 520 S200 440, 240 400', head: arrow({ x: 240, y: 400 }, { x: 230, y: 430 }), label: { x: 228, y: 388 }, anchor: 'end', baseline: 'auto' },
  // Wide loop left
  { id: 'kinetic-type', line: 'M520 420 C420 380, 280 340, 220 380 S160 460, 220 500', head: arrow({ x: 220, y: 500 }, { x: 210, y: 470 }), label: { x: 208, y: 514 }, anchor: 'end', baseline: 'hanging' },
  // Gentle arc down-left
  { id: 'recolor', line: 'M560 520 C500 580, 380 660, 310 720 S260 780, 300 800', head: arrow({ x: 300, y: 800 }, { x: 290, y: 770 }), label: { x: 310, y: 814 }, anchor: 'start', baseline: 'hanging' },
  // Figure-eight from center out left-down
  { id: 'make', line: 'M580 460 C500 480, 380 540, 360 600 S400 680, 460 680 S540 640, 500 600', head: arrow({ x: 500, y: 600 }, { x: 520, y: 620 }), label: { x: 488, y: 590 }, anchor: 'end', baseline: 'auto' },
];

export function getRoutes(visibleIds: string[]): ToolRoute[] {
  return ROUTES.filter(r => visibleIds.includes(r.id));
}
