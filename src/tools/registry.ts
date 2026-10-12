import type { LatheTool, ToolGroup } from './types';
import { GROUPS } from './types';
import type { CustomTool } from '../lib/custom-tools';

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
  /** True for user-generated tools. */
  custom?: boolean;
  load?: () => Promise<LatheTool>;
}

export const TOOLS: ToolEntry[] = [
  {
    id: 'audit', name: 'Audit', group: 'Research', milestone: 5,
    blurb: 'Subject and brand audits across open archives, out as a deck.',
    load: () => import('./audit').then(m => m.tool),
  },
  {
    id: 'color-check', name: 'Color-check', group: 'Color', milestone: 2, accepts: ['text/plain', 'font/*'],
    blurb: 'WCAG 2.2 and APCA contrast matrix from pasted hex.',
    load: () => import('./color-check').then(m => m.tool),
  },
  {
    id: 'palette', name: 'Palette', group: 'Color', milestone: 7, accepts: ['image/*'],
    blurb: 'Image or URL in, palette, scales and tokens out.',
    load: () => import('./palette').then(m => m.tool),
  },
  {
    id: 'color-swap', name: 'Color-swap', group: 'Color', milestone: 3, accepts: ['image/*', 'video/*'],
    blurb: 'Recolor images and video to a target palette.',
    load: () => import('./color-swap').then(m => m.tool),
  },
  {
    id: 'mesh-gradient', name: 'Mesh-gradient', group: 'Color', milestone: 3,
    blurb: 'Animated mesh gradients with grain, PNG and GIF out.',
    load: () => import('./mesh-gradient').then(m => m.tool),
  },
  {
    id: 'dither', name: 'Dither', group: 'Image', milestone: 7, accepts: ['image/*'],
    blurb: 'Bayer, error diffusion and halftone.',
    load: () => import('./dither').then(m => m.tool),
  },
  {
    id: 'vectorize', name: 'Vectorize', group: 'Image', milestone: 7, accepts: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'],
    blurb: 'Raster to SVG, one or many colors.',
    load: () => import('./vectorize').then(m => m.tool),
  },
  {
    id: 'cutout', name: 'Cutout', group: 'Image', milestone: 7, accepts: ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp', 'image/gif'],
    blurb: 'In-browser background removal.',
    load: () => import('./cutout').then(m => m.tool),
  },
  {
    id: 'specimen', name: 'Specimen', group: 'Type', milestone: 8, accepts: ['font/*', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],
    blurb: 'Drop a font: glyphs, metrics, features, scale.',
    load: () => import('./specimen').then(m => m.tool),
  },
  {
    id: 'bento', name: 'Bento', group: 'Layout', milestone: 5, accepts: ['image/*', 'application/vnd.lathe.deck+json', 'application/json'],
    blurb: 'Compose assets into bento slides, out to pptx, pdf, svg.',
    load: () => import('./bento').then(m => m.tool),
  },
  {
    id: 'grid', name: 'Grid', group: 'Layout', milestone: 8,
    blurb: 'Columns, gutters, baseline. SVG, PNG and CSS out.',
    load: () => import('./grid').then(m => m.tool),
  },
  {
    id: 'resize', name: 'Resize', group: 'Layout', milestone: 11, accepts: ['image/svg+xml', 'font/*', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],
    blurb: 'One tagged SVG, every size: rules, live text fields, overflow flags.',
    load: () => import('./resize').then(m => m.tool),
  },
  {
    id: 'kinetic-type', name: 'Kinetic-type', group: 'Motion', milestone: 8, accepts: ['font/*', 'text/plain', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],
    blurb: 'Animated type presets, GIF and WebM out.',
    load: () => import('./kinetic-type').then(m => m.tool),
  },
  {
    id: 'multi-export', name: 'Multi-export', group: 'Export', milestone: 2, accepts: ['image/png', 'image/jpeg', 'image/svg+xml'],
    blurb: 'One logo to png, jpg, svg, eps in rgb and cmyk.',
    load: () => import('./multi-export').then(m => m.tool),
  },
  {
    id: 'icon-set', name: 'Icon-set', group: 'Export', milestone: 8, accepts: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'],
    blurb: 'One mark to a full favicon and app icon set.',
    load: () => import('./icon-set').then(m => m.tool),
  },
  {
    id: 'mood-strip', name: 'Mood-strip', group: 'Reference', milestone: 3, accepts: ['image/*'],
    blurb: 'A floating strip of reference images.',
    load: () => import('./mood-strip').then(m => m.tool),
  },
  {
    id: 'sandbox', name: 'Sandbox', group: 'Reference', milestone: 1, dev: true, accepts: ['image/*'],
    blurb: 'Contract test: load, inspect, recolor the matte, export.',
    load: () => import('./sandbox').then(m => m.tool),
  },
];

export const findTool = (id: string | undefined) => TOOLS.find(t => t.id === id) ?? customEntries.find(t => t.id === id);
export const isReady = (t: ToolEntry) => !!t.load;

export function toolsByGroup(): { group: ToolGroup; tools: ToolEntry[] }[] {
  const all = [...TOOLS, ...customEntries];
  const groups = [...GROUPS.map(group => ({ group, tools: all.filter(t => t.group === group) })).filter(g => g.tools.length)];
  const yours = all.filter(t => t.custom && !GROUPS.includes(t.group as ToolGroup));
  if (yours.length) groups.push({ group: 'Reference' as ToolGroup, tools: yours });
  return groups;
}

/** Keyboard 1–9 follow rail order. */
export const numberedTools = () => TOOLS.slice(0, 9);

/** All tools including user-generated ones. */
export const allTools = () => [...TOOLS, ...customEntries];

/* ---- Custom (user-generated) tools ---- */
const customEntries: ToolEntry[] = [];

function entryFor(t: CustomTool): ToolEntry {
  return {
    id: t.id,
    name: t.name,
    group: (GROUPS.includes(t.group as ToolGroup) ? t.group : 'Reference') as ToolGroup,
    blurb: t.description,
    milestone: 0,
    custom: true,
    load: () => import('../lib/custom-tools').then(m => ({
      id: t.id, name: t.name, group: (GROUPS.includes(t.group as ToolGroup) ? t.group : 'Reference') as ToolGroup,
      defaults: t.defaults as LatheTool['defaults'],
      mount: (ctx) => m.mountCustomTool(t, ctx),
    })),
  };
}

export function addCustomEntry(t: CustomTool) {
  if (customEntries.some(e => e.id === t.id)) return;
  customEntries.push(entryFor(t));
}

export function removeCustomEntry(id: string) {
  const i = customEntries.findIndex(e => e.id === id);
  if (i >= 0) customEntries.splice(i, 1);
}

export async function loadCustomEntries() {
  const { loadCustomTools } = await import('../lib/custom-tools');
  const tools = await loadCustomTools();
  for (const t of tools) addCustomEntry(t);
}
