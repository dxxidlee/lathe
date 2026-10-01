import type { LatheTool, ToolGroup } from './types';
import { GROUPS } from './types';

/* Every tool Lathe will ship, in rail order. Tools without `load` are not built yet:
   they appear in the rail and index, dimmed, with the milestone that brings them. */

export interface ToolEntry {
  id: string;
  name: string;
  group: ToolGroup;
  blurb: string;
  milestone: number;
  /** MIME patterns it can load; mirrors the tool module's `accepts` so menus work before it loads. */
  accepts?: string[];
  /** Development-only tool used to prove the contract; removed once real tools land. */
  dev?: boolean;
  load?: () => Promise<LatheTool>;
}

export const TOOLS: ToolEntry[] = [
  { id: 'audit', name: 'Audit', group: 'Research', milestone: 5, blurb: 'Subject and brand audits across open archives, out as a deck.' },
  { id: 'color-check', name: 'Color-check', group: 'Color', milestone: 2, blurb: 'WCAG 2.2 and APCA contrast matrix from pasted hex.' },
  { id: 'palette', name: 'Palette', group: 'Color', milestone: 7, blurb: 'Image or URL in, palette, scales and tokens out.' },
  { id: 'color-swap', name: 'Color-swap', group: 'Color', milestone: 3, blurb: 'Recolor images and video to a target palette.' },
  { id: 'mesh-gradient', name: 'Mesh-gradient', group: 'Color', milestone: 3, blurb: 'Animated mesh gradients with grain, PNG and GIF out.' },
  { id: 'dither', name: 'Dither', group: 'Image', milestone: 7, blurb: 'Bayer, error diffusion and halftone.' },
  { id: 'vectorize', name: 'Vectorize', group: 'Image', milestone: 7, blurb: 'Raster to SVG, one or many colors.' },
  { id: 'cutout', name: 'Cutout', group: 'Image', milestone: 7, blurb: 'In-browser background removal.' },
  { id: 'specimen', name: 'Specimen', group: 'Type', milestone: 8, blurb: 'Drop a font: glyphs, metrics, features, scale.' },
  { id: 'bento', name: 'Bento', group: 'Layout', milestone: 5, blurb: 'Compose assets into bento slides, out to pptx, pdf, svg.' },
  { id: 'grid', name: 'Grid', group: 'Layout', milestone: 8, blurb: 'Columns, gutters, baseline. SVG, PNG and CSS out.' },
  { id: 'kinetic-type', name: 'Kinetic-type', group: 'Motion', milestone: 8, blurb: 'Animated type presets, GIF and WebM out.' },
  { id: 'multi-export', name: 'Multi-export', group: 'Export', milestone: 2, blurb: 'One logo to png, jpg, svg, eps in rgb and cmyk.' },
  { id: 'icon-set', name: 'Icon-set', group: 'Export', milestone: 8, blurb: 'One mark to a full favicon and app icon set.' },
  { id: 'mood-strip', name: 'Mood-strip', group: 'Reference', milestone: 3, blurb: 'A floating strip of reference images.' },
  {
    id: 'sandbox', name: 'Sandbox', group: 'Reference', milestone: 1, dev: true, accepts: ['image/*'],
    blurb: 'Contract test: load, inspect, recolor the matte, export.',
    load: () => import('./sandbox').then(m => m.tool),
  },
];

export const findTool = (id: string | undefined) => TOOLS.find(t => t.id === id);
export const isReady = (t: ToolEntry) => !!t.load;

export function toolsByGroup(): { group: ToolGroup; tools: ToolEntry[] }[] {
  return GROUPS.map(group => ({ group, tools: TOOLS.filter(t => t.group === group) })).filter(g => g.tools.length);
}

/** Keyboard 1–9 follow rail order. */
export const numberedTools = () => TOOLS.slice(0, 9);
