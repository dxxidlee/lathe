/* Build a Bento deck from an Audit collection: cover, palette, imagery, credits (auto in Bento). */
import { aggregatePalette, type Swatch } from '../../lib/color';
import { layoutSlide } from '../bento/layout';
import { uid, type Deck, type Slide, type Tile } from '../bento/model';
import type { AuditResult } from './api';

export interface DeckInput {
  query: string;
  items: (AuditResult & { swatches?: Swatch[] })[];
  sourceNames: Record<string, string>;
  theme: Deck['theme'];
  imagesPerSlide: number;
  paletteSize: number;
}

const imageTile = (r: DeckInput['items'][number], sourceName: string): Tile => ({
  id: uid(), type: 'image', src: r.imageUrl, thumb: r.thumbUrl, fit: 'cover', caption: true,
  aspect: r.width && r.height ? r.width / r.height : undefined,
  credit: { title: r.title, creator: r.creator, date: r.date, source: sourceName, license: r.license, url: r.sourceUrl },
});

export function buildDeck(inp: DeckInput): Deck {
  const { items } = inp;
  const sources = [...new Set(items.map(i => inp.sourceNames[i.source] ?? i.source))];
  const years = items.map(i => i.year).filter((y): y is number => typeof y === 'number').sort((a, b) => a - b);
  const pd = items.filter(i => i.isPublicDomain).length;
  const palette = aggregatePalette(items.filter(i => i.swatches?.length).map(i => i.swatches!), inp.paletteSize);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const slides: Slide[] = [];

  // Cover: a fixed composition (title large, summary under it, images in a column on the right).
  // Reshuffle in Bento still offers the alternates.
  const hero = items.slice(0, 2).map(r => imageTile(r, inp.sourceNames[r.source] ?? r.source));
  hero.forEach((t, i) => { t.rect = hero.length === 1 ? { x: 7, y: 0, w: 5, h: 8 } : { x: 7, y: i * 4, w: 5, h: 4 }; });
  slides.push({ id: uid('s'), variant: 0, tiles: [
    { id: uid(), type: 'text', role: 'display', text: inp.query, rect: { x: 0, y: 0, w: hero.length ? 7 : 12, h: 5 } },
    { id: uid(), type: 'text', role: 'body', text: `Subject audit · ${items.length} images from ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}\n${date}`, rect: { x: 0, y: 5, w: hero.length ? 7 : 12, h: 3 } },
    ...hero,
  ] });

  // Palette and numbers
  if (palette.length) {
    slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles: [
      { id: uid(), type: 'text', role: 'title', text: 'Palette' },
      { id: uid(), type: 'palette', colors: palette.map(s => s.hex) },
      { id: uid(), type: 'hexlist', colors: palette.map(s => s.hex) },
      { id: uid(), type: 'stat', value: String(items.length), label: 'images collected' },
      { id: uid(), type: 'stat', value: years.length ? (years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`) : '—', label: 'date range' },
      { id: uid(), type: 'stat', value: `${Math.round(pd / Math.max(1, items.length) * 100)}%`, label: 'public domain' },
    ] }));
  }

  // Imagery
  const per = Math.max(1, Math.min(8, inp.imagesPerSlide));
  for (let i = 0; i < items.length; i += per) {
    slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles: items.slice(i, i + per).map(r => imageTile(r, inp.sourceNames[r.source] ?? r.source)) }));
  }
  return { version: 1, title: `${inp.query}: subject audit`, theme: inp.theme, slides };
}
