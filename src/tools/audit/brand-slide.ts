/* Brand slide: one slide per audit. Template slots, assignment, and palette. */

export const BRAND_SLIDE_MIME = 'application/vnd.lathe.brand-slide+json';

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const GUTTER = 11;
export const RADIUS = 13;
export const MARGIN = 24;

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
    rect?: { x: number; y: number; w: number; h: number }; // fractional 0-1 override
    isMotion?: boolean;
    gifUrl?: string;
    posterUrl?: string;
  }>;
  removed?: string[]; // slot names that have been removed (neighbor expanded to fill)
  motion: { assetUrl: string; gifUrl: string | null; posterUrl: string | null; slotName: string | null } | null;
}

// --- Template variants ---
// All share: logo center-ish, palette top-right, cutout left edge
// Positions as px at 1920×1080

const BASE_SLOTS: SlotRect[] = [
  // Top row (y=24, h=325) — 3 images + palette
  { name: 'top_1',       x: 24,   y: 24,  w: 563, h: 325, ar: 1.73, hasTileBg: true,  role: 'image' },
  { name: 'top_2',       x: 598,  y: 24,  w: 370, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
  { name: 'top_3',       x: 979,  y: 24,  w: 526, h: 325, ar: 1.62, hasTileBg: true,  role: 'image' },
  { name: 'palette',     x: 1516, y: 24,  w: 380, h: 325, ar: 1.17, hasTileBg: true,  role: 'palette' },

  // Middle row (y=360, h=360) — left image + LOGO center + right image
  { name: 'mid_left',    x: 24,   y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'logo',        x: 720,  y: 360, w: 480, h: 360, ar: 1.33, hasTileBg: true,  role: 'logo' },
  { name: 'mid_right',   x: 1211, y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },

  // Bottom row (y=731, h=325) — 6 images (one stacked pair)
  { name: 'bot_1',       x: 24,   y: 731, w: 281, h: 325, ar: 0.86, hasTileBg: true,  role: 'image' },
  { name: 'bot_2',       x: 316,  y: 731, w: 262, h: 325, ar: 0.81, hasTileBg: true,  role: 'image' },
  { name: 'bot_3a',      x: 589,  y: 731, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_3b',      x: 589,  y: 899, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_4',       x: 862,  y: 731, w: 562, h: 325, ar: 1.73, hasTileBg: true,  role: 'image' },
  { name: 'bot_5',       x: 1435, y: 731, w: 262, h: 325, ar: 0.81, hasTileBg: true,  role: 'image' },
  { name: 'bot_6',       x: 1708, y: 731, w: 188, h: 325, ar: 0.58, hasTileBg: true,  role: 'image' },
];

// Variant 2: wider hero top-left, fewer bottom tiles
const VARIANT_2: SlotRect[] = [
  { name: 'top_1',       x: 24,   y: 24,  w: 745, h: 325, ar: 2.29, hasTileBg: true,  role: 'image' },
  { name: 'top_2',       x: 780,  y: 24,  w: 370, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
  { name: 'top_3',       x: 1161, y: 24,  w: 344, h: 325, ar: 1.06, hasTileBg: true,  role: 'image' },
  { name: 'palette',     x: 1516, y: 24,  w: 380, h: 325, ar: 1.17, hasTileBg: true,  role: 'palette' },
  { name: 'mid_left',    x: 24,   y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'logo',        x: 720,  y: 360, w: 480, h: 360, ar: 1.33, hasTileBg: true,  role: 'logo' },
  { name: 'mid_right',   x: 1211, y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'bot_1',       x: 24,   y: 731, w: 370, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
  { name: 'bot_2',       x: 405,  y: 731, w: 262, h: 325, ar: 0.81, hasTileBg: true,  role: 'image' },
  { name: 'bot_3a',      x: 678,  y: 731, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_3b',      x: 678,  y: 899, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_4',       x: 951,  y: 731, w: 473, h: 325, ar: 1.46, hasTileBg: true,  role: 'image' },
  { name: 'bot_5',       x: 1435, y: 731, w: 461, h: 325, ar: 1.42, hasTileBg: true,  role: 'image' },
];

// Variant 3: palette on left, asymmetric grid
const VARIANT_3: SlotRect[] = [
  { name: 'palette',     x: 24,   y: 24,  w: 380, h: 325, ar: 1.17, hasTileBg: true,  role: 'palette' },
  { name: 'top_1',       x: 415,  y: 24,  w: 526, h: 325, ar: 1.62, hasTileBg: true,  role: 'image' },
  { name: 'top_2',       x: 952,  y: 24,  w: 473, h: 325, ar: 1.46, hasTileBg: true,  role: 'image' },
  { name: 'top_3',       x: 1436, y: 24,  w: 460, h: 325, ar: 1.42, hasTileBg: true,  role: 'image' },
  { name: 'mid_left',    x: 24,   y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'logo',        x: 720,  y: 360, w: 480, h: 360, ar: 1.33, hasTileBg: true,  role: 'logo' },
  { name: 'mid_right',   x: 1211, y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'bot_1',       x: 24,   y: 731, w: 460, h: 325, ar: 1.42, hasTileBg: true,  role: 'image' },
  { name: 'bot_2',       x: 495,  y: 731, w: 262, h: 325, ar: 0.81, hasTileBg: true,  role: 'image' },
  { name: 'bot_3a',      x: 768,  y: 731, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_3b',      x: 768,  y: 899, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_4',       x: 1041, y: 731, w: 473, h: 325, ar: 1.46, hasTileBg: true,  role: 'image' },
  { name: 'bot_5',       x: 1525, y: 731, w: 371, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
];

// Variant 4: even grid, more uniform tiles
const VARIANT_4: SlotRect[] = [
  { name: 'top_1',       x: 24,   y: 24,  w: 460, h: 325, ar: 1.42, hasTileBg: true,  role: 'image' },
  { name: 'top_2',       x: 495,  y: 24,  w: 460, h: 325, ar: 1.42, hasTileBg: true,  role: 'image' },
  { name: 'top_3',       x: 966,  y: 24,  w: 539, h: 325, ar: 1.66, hasTileBg: true,  role: 'image' },
  { name: 'palette',     x: 1516, y: 24,  w: 380, h: 325, ar: 1.17, hasTileBg: true,  role: 'palette' },
  { name: 'mid_left',    x: 24,   y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'logo',        x: 720,  y: 360, w: 480, h: 360, ar: 1.33, hasTileBg: true,  role: 'logo' },
  { name: 'mid_right',   x: 1211, y: 360, w: 685, h: 360, ar: 1.90, hasTileBg: true,  role: 'image' },
  { name: 'bot_1',       x: 24,   y: 731, w: 371, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
  { name: 'bot_2',       x: 406,  y: 731, w: 371, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
  { name: 'bot_3a',      x: 788,  y: 731, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_3b',      x: 788,  y: 899, w: 262, h: 157, ar: 1.67, hasTileBg: true,  role: 'image' },
  { name: 'bot_4',       x: 1061, y: 731, w: 371, h: 325, ar: 1.14, hasTileBg: true,  role: 'image' },
  { name: 'bot_5',       x: 1443, y: 731, w: 453, h: 325, ar: 1.39, hasTileBg: true,  role: 'image' },
];

const VARIANTS = [BASE_SLOTS, VARIANT_2, VARIANT_3, VARIANT_4];

export function getTemplate(variant: number): SlotRect[] {
  return VARIANTS[variant % VARIANTS.length];
}

/** Resolve slot positions: use slot.rect (fractional) override when present, else template pixels. */
export function resolveSlotRect(
  tmpl: SlotRect,
  slotRect: { x: number; y: number; w: number; h: number } | undefined,
): { x: number; y: number; w: number; h: number } {
  if (slotRect) return { x: slotRect.x * SLIDE_W, y: slotRect.y * SLIDE_H, w: slotRect.w * SLIDE_W, h: slotRect.h * SLIDE_H };
  return { x: tmpl.x, y: tmpl.y, w: tmpl.w, h: tmpl.h };
}

export const GUTTER_FX = GUTTER / SLIDE_W;
export const GUTTER_FY = GUTTER / SLIDE_H;

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
