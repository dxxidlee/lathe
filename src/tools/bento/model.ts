/* Bento deck model. Shared with Audit, which builds decks and sends them here. */

export const DECK_MIME = 'application/vnd.lathe.deck+json';
export const COLS = 12;
export const ROWS = 8;

export type TileType = 'image' | 'logo' | 'palette' | 'hexlist' | 'type' | 'text' | 'stat';
export type TextRole = 'display' | 'title' | 'body' | 'caption';

export interface Rect { x: number; y: number; w: number; h: number }

export interface Credit { title: string; creator: string | null; date: string | null; source: string; license: string; url: string }

export interface Tile {
  id: string;
  type: TileType;
  rect?: Rect;
  locked?: boolean;
  /* image / logo */
  src?: string;          // remote URL, or `asset:<id>` for a tray file
  thumb?: string;        // preview URL
  aspect?: number;       // width / height, when known
  fit?: 'cover' | 'contain';
  caption?: boolean;     // show the credit line under the image
  credit?: Credit;
  /** Background of a logo tile (a dark mark on light, a light mark on dark). */
  fill?: string;
  /* palette / hexlist */
  colors?: string[];
  /** Palette tiles print each hex under its swatch unless this is false. */
  hexLabels?: boolean;
  /* text */
  text?: string;
  role?: TextRole;
  /* stat */
  value?: string;
  label?: string;
  /* type specimen */
  family?: string;
  sample?: string;
}

export interface Slide { id: string; tiles: Tile[]; variant: number }

export interface Deck { version: 1; title: string; theme: 'dark' | 'light'; slides: Slide[] }

let n = 0;
export const uid = (p = 't') => `${p}${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const emptyDeck = (title = 'Untitled deck', theme: Deck['theme'] = 'dark'): Deck =>
  ({ version: 1, title, theme, slides: [{ id: uid('s'), tiles: [], variant: 0 }] });

/** Credit line used under images and on the credits slide. */
export function creditLine(c: Credit): string {
  return [c.title, [c.creator, c.date].filter(Boolean).join(', '), c.source, c.license].filter(Boolean).join(' · ');
}

/** Validate an incoming deck (from Audit, a file, or storage). */
export function parseDeck(raw: unknown): Deck | null {
  const d = raw as Deck;
  if (!d || typeof d !== 'object' || !Array.isArray(d.slides)) return null;
  return {
    version: 1,
    title: typeof d.title === 'string' ? d.title : 'Untitled deck',
    theme: d.theme === 'light' ? 'light' : 'dark',
    slides: d.slides.filter(s => s && Array.isArray(s.tiles)).map(s => ({
      id: s.id || uid('s'), variant: Number.isInteger(s.variant) ? s.variant : 0,
      tiles: s.tiles.filter(t => t && typeof t.type === 'string').map(t => ({ ...t, id: t.id || uid() })),
    })),
  };
}
