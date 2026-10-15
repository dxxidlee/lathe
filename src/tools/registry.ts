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
  /** Mobile support: 'full' = fully usable, 'view' = read-only, 'desktop' = hidden on mobile. */
  mobile?: 'full' | 'view' | 'desktop';
  /** Hidden from rail, Cmd+K, and keyboard shortcuts. Reachable only via direct URL. */
  hidden?: boolean;
  load?: () => Promise<LatheTool>;
}

export const TOOLS: ToolEntry[] = [
  /* ---- Workbench ---- */
  {
    id: 'subject-audit', name: 'Subject Audit', group: 'Workbench', milestone: 5, mobile: 'full',
    blurb: 'Search open archives, collect results, export as a deck.',
    load: () => import('./subject-audit').then(m => m.tool),
  },
  {
    id: 'brand-audit', name: 'Brand Audit', group: 'Workbench', milestone: 6, mobile: 'full',
    blurb: 'Visual audit of a company: site, screenshots, palette, timeline.',
    load: () => import('./brand-audit').then(m => m.tool),
  },
  {
    id: 'deck', name: 'Deck', group: 'Workbench', milestone: 5, mobile: 'view', accepts: ['image/*', 'application/vnd.lathe.deck+json', 'application/json'],
    blurb: 'Compose assets into bento slides, out to pptx, pdf, svg.',
    load: () => import('./bento').then(m => m.tool),
  },
  {
    id: 'palette', name: 'Palette', group: 'Workbench', milestone: 7, mobile: 'full', accepts: ['image/*'],
    blurb: 'Image or URL in, palette, scales and tokens out.',
    load: () => import('./palette').then(m => m.tool),
  },
  {
    id: 'contrast', name: 'Contrast', group: 'Workbench', milestone: 2, mobile: 'full', accepts: ['text/plain', 'font/*'],
    blurb: 'WCAG 2.2 and APCA contrast matrix from pasted hex.',
    load: () => import('./color-check').then(m => m.tool),
  },
  {
    id: 'logo-export', name: 'Logo Export', group: 'Workbench', milestone: 2, mobile: 'view', accepts: ['image/png', 'image/jpeg', 'image/svg+xml'],
    blurb: 'One logo to png, jpg, svg, eps in rgb and cmyk.',
    load: () => import('./multi-export').then(m => m.tool),
  },
  /* ---- Drawer ---- */
  {
    id: 'icons', name: 'Icons', group: 'Drawer', milestone: 8, mobile: 'view', accepts: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'],
    blurb: 'One mark to a full favicon and app icon set.',
    load: () => import('./icon-set').then(m => m.tool),
  },
  {
    id: 'specimen', name: 'Specimen', group: 'Drawer', milestone: 8, mobile: 'view', accepts: ['font/*', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],
    blurb: 'Drop a font: glyphs, metrics, features, scale.',
    load: () => import('./specimen').then(m => m.tool),
  },
  {
    id: 'reference', name: 'Reference', group: 'Drawer', milestone: 3, mobile: 'desktop', accepts: ['image/*'],
    blurb: 'A floating strip of reference images.',
    load: () => import('./mood-strip').then(m => m.tool),
  },
  /* ---- Offcuts ---- */
  {
    id: 'dither', name: 'Dither', group: 'Offcuts', milestone: 7, mobile: 'desktop', accepts: ['image/*'],
    blurb: 'Bayer, error diffusion and halftone.',
    load: () => import('./dither').then(m => m.tool),
  },
  {
    id: 'gradient', name: 'Gradient', group: 'Offcuts', milestone: 3, mobile: 'desktop',
    blurb: 'Animated mesh gradients with grain, PNG and GIF out.',
    load: () => import('./mesh-gradient').then(m => m.tool),
  },
  {
    id: 'kinetic-type', name: 'Kinetic Type', group: 'Offcuts', milestone: 8, mobile: 'desktop', accepts: ['font/*', 'text/plain', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],
    blurb: 'Animated type presets, GIF and WebM out.',
    load: () => import('./kinetic-type').then(m => m.tool),
  },
  {
    id: 'recolor', name: 'Recolor', group: 'Offcuts', milestone: 3, mobile: 'desktop', hidden: true, accepts: ['image/*', 'video/*'],
    blurb: 'Recolor images and video to a target palette.',
    load: () => import('./color-swap').then(m => m.tool),
  },
];

/** Old tool id -> current tool id. Lets the command palette, routes and settings migration find
 *  renamed tools. Keys are the names that used to exist; values are what they became. */
export const ID_ALIASES: Record<string, string> = {
  'audit': 'subject-audit',
  'bento': 'deck',
  'color-check': 'contrast',
  'multi-export': 'logo-export',
  'icon-set': 'icons',
  'mood-strip': 'reference',
  'mesh-gradient': 'gradient',
  'color-swap': 'recolor',
};

/** Reverse lookup: new id -> old id (for settings migration). */
export const REVERSE_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(ID_ALIASES).map(([old, cur]) => [cur, old]),
);

/** Tools that don't appear in the rail but are reachable via Cmd+K. */
export const HIDDEN_TOOLS: ToolEntry[] = [
  { id: 'cutout', name: 'Cutout', group: 'Offcuts' as ToolGroup, blurb: 'In-browser background removal.', milestone: 7, mobile: 'desktop', accepts: ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp', 'image/gif'], load: () => import('./cutout').then(m => m.tool) },
  { id: 'vectorize', name: 'Vectorize', group: 'Offcuts' as ToolGroup, blurb: 'Raster to SVG.', milestone: 7, mobile: 'desktop', accepts: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'], load: () => import('./vectorize').then(m => m.tool) },
  { id: 'grid', name: 'Grid', group: 'Drawer' as ToolGroup, blurb: 'Columns, gutters, baseline.', milestone: 8, mobile: 'desktop', load: () => import('./grid').then(m => m.tool) },
  { id: 'resize', name: 'Resize', group: 'Workbench' as ToolGroup, blurb: 'One tagged SVG, every size.', milestone: 11, mobile: 'desktop', accepts: ['image/svg+xml', 'font/*', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'], load: () => import('./resize').then(m => m.tool) },
  { id: 'sandbox', name: 'Sandbox', group: 'Offcuts' as ToolGroup, blurb: 'Contract test: load, inspect, recolor the matte, export.', milestone: 1, dev: true, mobile: 'desktop', accepts: ['image/*'], load: () => import('./sandbox').then(m => m.tool) },
];

export const findTool = (id: string | undefined): ToolEntry | undefined => {
  if (!id) return undefined;
  const found = TOOLS.find(t => t.id === id)
    ?? HIDDEN_TOOLS.find(t => t.id === id)
    ?? customEntries.find(t => t.id === id);
  if (found) return found;
  const alias = ID_ALIASES[id];
  if (alias) return TOOLS.find(t => t.id === alias) ?? HIDDEN_TOOLS.find(t => t.id === alias);
  return undefined;
};

export const isReady = (t: ToolEntry) => !!t.load;

export function toolsByGroup(): { group: ToolGroup; tools: ToolEntry[] }[] {
  const all = [...TOOLS, ...customEntries];
  const groups = [...GROUPS.map(group => ({ group, tools: all.filter(t => t.group === group) })).filter(g => g.tools.length)];
  const yours = all.filter(t => t.custom && !GROUPS.includes(t.group as ToolGroup));
  if (yours.length) groups.push({ group: 'Offcuts' as ToolGroup, tools: yours });
  return groups;
}

/** Keyboard 1–9 follow rail order (Workbench 6 + Drawer 3). */
export const numberedTools = () => TOOLS.filter(t => !t.hidden).slice(0, 9);

/** All tools including hidden and user-generated ones. */
export const allTools = () => [...TOOLS, ...HIDDEN_TOOLS, ...customEntries];

/* ---- Custom (user-generated) tools ---- */
const customEntries: ToolEntry[] = [];

function entryFor(t: CustomTool): ToolEntry {
  return {
    id: t.id,
    name: t.name,
    group: (GROUPS.includes(t.group as ToolGroup) ? t.group : 'Offcuts') as ToolGroup,
    blurb: t.description,
    milestone: 0,
    custom: true,
    load: () => import('../lib/custom-tools').then(m => ({
      id: t.id, name: t.name, group: (GROUPS.includes(t.group as ToolGroup) ? t.group : 'Offcuts') as ToolGroup,
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
