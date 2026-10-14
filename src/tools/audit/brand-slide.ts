/* Brand slide: one slide per audit. Template slots, assignment, and palette. */

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const GUTTER = 12;
export const RADIUS = 16;

export interface SlotRect {
  name: string;
  x: number; y: number; w: number; h: number; // in pixels at 1920×1080
  ar: number; // aspect ratio w/h
  hasTileBg: boolean; // false for cutout column
  role: 'image' | 'logo' | 'palette' | 'cutout';
}

export interface BrandSlide {
  id: string;
  variant: number;
  theme: 'dark' | 'light';
  logo: { assetUrl: string; bgColor: string; candidateIdx: number };
  palette: string[]; // hex array, ordered
  slots: Array<{
    name: string;
    assetUrl: string | null;
    assetThumbUrl: string | null;
    fit: 'cover' | 'contain';
    cropX: number; cropY: number; cropZoom: number;
    removedBg: boolean;
    focalX: number; focalY: number; // 0-1, for object-position
  }>;
  motion: { assetUrl: string; gifUrl: string | null } | null;
}

// --- Template variants ---
// All share: logo center-ish, palette top-right, cutout left edge
// Positions as px at 1920×1080

const BASE_SLOTS: SlotRect[] = [
  // Top row
  { name: 'top_wide',    x: 115, y: 27,  w: 442, h: 297, ar: 1.49, hasTileBg: true,  role: 'image' },
  { name: 'top_small',   x: 566, y: 27,  w: 221, h: 297, ar: 0.74, hasTileBg: true,  role: 'image' },
  { name: 'top_product', x: 797, y: 27,  w: 288, h: 297, ar: 0.97, hasTileBg: true,  role: 'image' },
  { name: 'top_hero',    x: 1094, y: 27, w: 384, h: 297, ar: 1.29, hasTileBg: true,  role: 'image' },
  { name: 'palette',     x: 1488, y: 27, w: 384, h: 297, ar: 1.29, hasTileBg: true,  role: 'palette' },

  // Middle row
  { name: 'logo',        x: 442, y: 335, w: 595, h: 400, ar: 1.49, hasTileBg: true,  role: 'logo' },
  { name: 'mid_sq1',     x: 1046, y: 335, w: 269, h: 194, ar: 1.38, hasTileBg: true, role: 'image' },
  { name: 'mid_sq2',     x: 1325, y: 335, w: 269, h: 194, ar: 1.38, hasTileBg: true, role: 'image' },
  { name: 'mid_right',   x: 1603, y: 335, w: 278, h: 400, ar: 0.70, hasTileBg: true, role: 'image' },
  { name: 'mid_lower1',  x: 1046, y: 540, w: 269, h: 200, ar: 1.35, hasTileBg: true, role: 'image' },
  { name: 'mid_lower2',  x: 1325, y: 540, w: 269, h: 200, ar: 1.35, hasTileBg: true, role: 'image' },

  // Bottom row
  { name: 'bot_sq',      x: 115, y: 745, w: 326, h: 308, ar: 1.06, hasTileBg: true,  role: 'image' },
  { name: 'bot_port',    x: 451, y: 745, w: 307, h: 308, ar: 1.00, hasTileBg: true,  role: 'image' },
  { name: 'bot_sm1',     x: 768, y: 745, w: 269, h: 151, ar: 1.78, hasTileBg: true,  role: 'image' },
  { name: 'bot_sm2',     x: 768, y: 906, w: 269, h: 151, ar: 1.78, hasTileBg: true,  role: 'image' },
  { name: 'bot_large',   x: 1046, y: 745, w: 547, h: 308, ar: 1.78, hasTileBg: true, role: 'image' },

  // Left edge cutouts (no tile background)
  { name: 'cutout_1',    x: 0, y: 335, w: 115, h: 400, ar: 0.29, hasTileBg: false, role: 'cutout' },
  { name: 'cutout_2',    x: 0, y: 745, w: 115, h: 308, ar: 0.37, hasTileBg: false, role: 'cutout' },
];

// Variant 1: swap top_wide and bot_large positions
export function getTemplate(variant: number): SlotRect[] {
  if (variant === 0) return BASE_SLOTS;
  if (variant === 1) {
    return BASE_SLOTS.map(s => {
      if (s.name === 'top_wide') return { ...BASE_SLOTS.find(b => b.name === 'bot_large')!, name: 'top_wide', role: 'image' as const };
      if (s.name === 'bot_large') return { ...BASE_SLOTS.find(b => b.name === 'top_wide')!, name: 'bot_large', role: 'image' as const };
      return s;
    });
  }
  // Variant 2: mirror horizontally
  return BASE_SLOTS.map(s => ({
    ...s,
    x: SLIDE_W - s.x - s.w,
  }));
}

// --- Palette logic ---

/** Merge near-duplicate colors (rough ΔE proxy), order by saturation then luminance. */
export function buildPalette(cssColors: string[], brandfetchColors: string[]): string[] {
  const all = [...new Set([...brandfetchColors, ...cssColors])].filter(c => /^#[0-9a-f]{6}$/i.test(c));
  if (!all.length) return [];

  // Merge near-duplicates: keep the first of each cluster
  const kept: string[] = [];
  for (const c of all) {
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    const isDupe = kept.some(k => {
      const kr = parseInt(k.slice(1, 3), 16), kg = parseInt(k.slice(3, 5), 16), kb = parseInt(k.slice(5, 7), 16);
      return Math.abs(r - kr) + Math.abs(g - kg) + Math.abs(b - kb) < 30;
    });
    if (!isDupe) kept.push(c);
  }

  // Sort: most saturated first, then dark to light
  return kept.slice(0, 6).sort((a, b) => {
    const satA = Math.max(parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)) - Math.min(parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16));
    const satB = Math.max(parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)) - Math.min(parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16));
    if (satA !== satB) return satB - satA;
    const lumA = parseInt(a.slice(1, 3), 16) * 0.299 + parseInt(a.slice(3, 5), 16) * 0.587 + parseInt(a.slice(5, 7), 16) * 0.114;
    const lumB = parseInt(b.slice(1, 3), 16) * 0.299 + parseInt(b.slice(3, 5), 16) * 0.587 + parseInt(b.slice(5, 7), 16) * 0.114;
    return lumA - lumB;
  });
}

// --- Logo contrast ---

/** Pick a background color for the logo tile that gives >= 3:1 contrast. */
export function pickLogoBg(palette: string[], logoIsLight: boolean): string {
  const luminance = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const srgb = (c: number) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  };
  const contrast = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const logoLum = logoIsLight ? 0.9 : 0.05;

  for (const c of palette) {
    const bgLum = luminance(c);
    if (contrast(logoLum, bgLum) >= 3) return c;
  }
  return logoIsLight ? '#000000' : '#FFFFFF';
}

// --- Slot assignment ---

export interface AssetCandidate {
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  priority: number; // lower = better (0=logo, 1=instagram, 2=youtube, 3=brand, 4=screenshot)
  isTransparent?: boolean; // for cutout column
  type: 'logo' | 'instagram' | 'youtube' | 'brand' | 'screenshot' | 'video';
}

/** Assign assets to slots by aspect ratio match, respecting priority. */
export function assignSlots(
  template: SlotRect[],
  assets: AssetCandidate[],
): Map<string, AssetCandidate | null> {
  const imageSlots = template.filter(s => s.role === 'image');
  const cutoutSlots = template.filter(s => s.role === 'cutout');
  const available = [...assets].sort((a, b) => a.priority - b.priority);
  const assigned = new Map<string, AssetCandidate | null>();
  const used = new Set<string>();
  const isUsed = (a: AssetCandidate) => used.has(a.url);
  const markUsed = (a: AssetCandidate) => { used.add(a.url); };

  // Assign cutout slots first (prefer transparent images)
  for (const slot of cutoutSlots) {
    const transparent = available.filter(a => a.isTransparent && !isUsed(a));
    const pick = transparent[0] ?? null;
    assigned.set(slot.name, pick);
    if (pick) markUsed(pick);
  }

  // Sort image slots by restrictiveness (extreme aspect ratios are pickiest)
  const sorted = [...imageSlots].sort((a, b) => {
    const distA = Math.abs(Math.log(a.ar));
    const distB = Math.abs(Math.log(b.ar));
    return distB - distA; // most extreme first
  });

  for (const slot of sorted) {
    let best: AssetCandidate | null = null;
    let bestScore = Infinity;
    for (const asset of available) {
      if (isUsed(asset)) continue;
      const assetAr = (asset.width && asset.height) ? asset.width / asset.height : 1;
      const score = Math.abs(Math.log(assetAr / slot.ar)) + asset.priority * 0.1;
      if (score < bestScore) { best = asset; bestScore = score; }
    }
    assigned.set(slot.name, best);
    if (best) markUsed(best);
  }

  return assigned;
}

/** Create a default BrandSlide from audit data. */
export function createSlide(
  assets: AssetCandidate[],
  logoUrl: string,
  logoIsLight: boolean,
  cssColors: string[],
  brandfetchColors: string[],
  variant = 0,
): BrandSlide {
  const template = getTemplate(variant);
  const palette = buildPalette(cssColors, brandfetchColors);
  const logoBg = pickLogoBg(palette, logoIsLight);
  const assignment = assignSlots(template, assets);

  return {
    id: crypto.randomUUID(),
    variant,
    theme: 'dark',
    logo: { assetUrl: logoUrl, bgColor: logoBg, candidateIdx: 0 },
    palette,
    slots: template.filter(s => s.role === 'image' || s.role === 'cutout').map(s => {
      const asset = assignment.get(s.name);
      return {
        name: s.name,
        assetUrl: asset?.url ?? null,
        assetThumbUrl: asset?.thumbUrl ?? null,
        fit: s.role === 'cutout' ? 'contain' as const : 'cover' as const,
        cropX: 0.5, cropY: 0.3, cropZoom: 1, // default: center-top bias
        removedBg: false,
        focalX: 0.5, focalY: 0.3,
      };
    }),
    motion: null,
  };
}
