/* Build a Bento deck from a brand audit: the board (logo at the centre, palette top right, the brand's
   imagery around them), cover, palette, typography, imagery, timeline, observations, method (credits
   are added by Bento from every image's credit). */
import { hexToOklab, type Swatch } from '../../lib/color';
import { layoutSlide } from '../bento/layout';
import { uid, type Credit, type Deck, type Slide, type Tile } from '../bento/model';
import type { BrandCapture, LogoCandidate, Observations, Typeface } from './brand-api';

export interface DeckImage { src: string; aspect: number; credit: Credit }
export interface BrandDeckInput {
  cap: BrandCapture;
  name: string;
  desktop: DeckImage | null;
  mobile: DeckImage | null;
  og: DeckImage | null;
  timeline: (DeckImage & { year: number })[];
  logos: LogoCandidate[];
  pixelPalette: Swatch[];
  declaredShare: number | null;   // share of screenshot pixels whose color is declared in CSS
  observations: Observations | null;
  theme: Deck['theme'];
  imagesPerSlide: number;
  paletteSize: number;
  /** Imagery picked for the board (video stills, site photography), in order of preference. */
  board: DeckImage[];
  /** The mark for the board's centre, and the tile color that sets it off. */
  boardLogo: { logo: LogoCandidate; fill: string | null } | null;
  /** The logo's own colors (measured from its pixels), which usually are the brand's palette. */
  logoColors: string[];
}

/* The board on the 12 × 8 grid: the logo in a wide centre cell, the palette in the top-right cell,
   imagery in every other cell (filled in order; cells without an image are left out). */
const BOARD = {
  logo: { x: 3, y: 3, w: 6, h: 3 },
  palette: { x: 9, y: 0, w: 3, h: 3 },
  images: [
    { x: 4, y: 0, w: 5, h: 3 }, { x: 0, y: 0, w: 4, h: 3 }, { x: 0, y: 3, w: 3, h: 5 }, { x: 9, y: 3, w: 3, h: 3 },
    { x: 3, y: 6, w: 3, h: 2 }, { x: 6, y: 6, w: 3, h: 2 }, { x: 9, y: 6, w: 3, h: 2 },
  ],
};

const imageTile = (im: DeckImage, caption = true): Tile => ({ id: uid(), type: 'image', src: im.src, aspect: im.aspect, fit: 'cover', caption, credit: im.credit });
const logoTile = (l: LogoCandidate, site: string, date: string): Tile => ({
  id: uid(), type: 'logo', src: l.dataUri, fit: 'contain',
  credit: { title: l.label, creator: null, date, source: l.kind === 'brandfetch' ? 'Brandfetch' : site, license: 'Trademark of its owner; shown for research', url: l.url ?? `https://${site}` },
});
/** Drop colors within ΔE 0.06 (OKLab) of one already kept. */
function distinct(hexes: string[]): string[] {
  const kept: { h: string; l: [number, number, number] }[] = [];
  for (const h of hexes) {
    const l = hexToOklab(h); if (!l) continue;
    if (!kept.some(k => Math.hypot(k.l[0] - l[0], k.l[1] - l[1], k.l[2] - l[2]) < 0.06)) kept.push({ h, l });
  }
  return kept.map(k => k.h);
}
/** Chromatic colors first (OKLCH chroma ≥ 0.04, in the given order), then the lightest and darkest neutral; up to `n`. */
export function brandHues(hexes: string[], n = 6): string[] {
  const lab = hexes.map(h => ({ h, l: hexToOklab(h) })).filter(x => x.l) as { h: string; l: [number, number, number] }[];
  const chroma = (x: { l: [number, number, number] }) => Math.hypot(x.l[1], x.l[2]);
  const hues = lab.filter(x => chroma(x) >= 0.04);
  const neutrals = lab.filter(x => chroma(x) < 0.04).sort((a, b) => b.l[0] - a.l[0]);
  const ends = neutrals.length ? [neutrals[0], ...(neutrals.length > 1 ? [neutrals[neutrals.length - 1]] : [])] : [];
  return [...ends.slice(0, 1), ...hues.slice(0, n - ends.length), ...ends.slice(1)].map(x => x.h).slice(0, n);
}
const weightsText = (t: Typeface) => (t.weights.length ? (t.weights.length === 2 && t.weights[1] - t.weights[0] > 100 ? `${t.weights[0]}–${t.weights[1]}` : t.weights.join(' / ')) : '');

export function buildBrandDeck(inp: BrandDeckInput): Deck {
  const { cap } = inp;
  const site = cap.site ?? { via: 'brandfetch-only' as const, url: `https://${cap.domain}`, host: cap.domain, snapshot: null, title: null, description: null, siteName: null, themeColor: null, lang: null, generator: null, og: { title: null, type: null, image: null, imageData: null }, logos: [] as any[], typefaces: [] as any[], colors: [] as any[], declared: [] as string[], social: {} as Record<string, string>, images: [] as any[], liveStatus: null, liveError: null, colorStats: { declarations: 0, unique: 0, clusters: 0 }, stylesheets: [], googleFonts: [], adobeKits: [], ms: 0 };
  const date = new Date(cap.capturedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const slides: Slide[] = [];
  const how = site.via === 'wayback' && site.snapshot
    ? `From the Wayback Machine capture of ${site.snapshot.timestamp.slice(0, 4)}-${site.snapshot.timestamp.slice(4, 6)}-${site.snapshot.timestamp.slice(6, 8)} (the live site refused automated requests)`
    : site.via === 'brandfetch-only' ? 'Site not captured (blocked); brand data from Brandfetch' : 'Captured from the live site';

  // The board: the brand at a glance. Official colors when Brandfetch has them; otherwise the logo's
  // colors, then those measured on the homepage, then the CSS colors (which mix in interface states),
  // hue first, then at most one light and one dark neutral.
  const boardColors = inp.cap.brandfetch?.colors.length ? inp.cap.brandfetch.colors.map(c => c.hex).slice(0, 6) : brandHues(distinct([...inp.logoColors, ...inp.pixelPalette.map(p => p.hex), ...site.colors.map(c => c.hex)]));
  if (inp.boardLogo || inp.board.length) {
    const tiles: Tile[] = [];
    if (inp.boardLogo) tiles.push({ ...logoTile(inp.boardLogo.logo, cap.domain, date), fill: inp.boardLogo.fill ?? undefined, rect: BOARD.logo });
    else tiles.push({ id: uid(), type: 'text', role: 'display', text: inp.name, rect: BOARD.logo });
    if (boardColors.length) tiles.push({ id: uid(), type: 'palette', colors: boardColors, hexLabels: false, rect: BOARD.palette });
    inp.board.slice(0, BOARD.images.length).forEach((im, i) => tiles.push({ ...imageTile(im, false), rect: BOARD.images[i] }));
    slides.push({ id: uid('s'), variant: 0, tiles });
  }

  // Cover: fixed composition like the subject deck; the desktop capture on the right.
  const hero = inp.desktop ?? inp.og;
  const coverTiles: Tile[] = [
    { id: uid(), type: 'text', role: 'display', text: inp.name, rect: { x: 0, y: 0, w: hero ? 7 : 12, h: 5 } },
    { id: uid(), type: 'text', role: 'body', text: `Brand audit · ${cap.domain}\n${date}\n${how}`, rect: { x: 0, y: 5, w: hero ? 7 : 12, h: 3 } },
  ];
  if (hero) { const t = imageTile(hero); t.rect = { x: 7, y: 0, w: 5, h: 8 }; coverTiles.push(t); }
  slides.push({ id: uid('s'), variant: 0, tiles: coverTiles });

  // Palette: declared in CSS vs measured in the screenshot. Fixed composition: two swatch rows, the
  // share of the screenshot's color that CSS declares as the stat.
  const css = site.colors.slice(0, inp.paletteSize).map(c => c.hex);
  const px = inp.pixelPalette.map(s => s.hex);
  if (css.length || px.length) {
    const both = css.length && px.length;
    const rowA = both ? { y: 2, h: 3 } : { y: 2, h: 6 }, rowB = both ? { y: 5, h: 3 } : rowA;
    const tiles: Tile[] = [
      { id: uid(), type: 'text', role: 'title', text: 'Palette', rect: { x: 0, y: 0, w: 8, h: 2 } },
      inp.declaredShare != null
        ? { id: uid(), type: 'stat', value: `${Math.round(inp.declaredShare * 100)}%`, label: 'of the screenshot’s color is declared in CSS', rect: { x: 8, y: 0, w: 4, h: 2 } }
        : { id: uid(), type: 'stat', value: String(site.colorStats.unique), label: 'distinct colors declared in CSS', rect: { x: 8, y: 0, w: 4, h: 2 } },
    ];
    if (css.length) tiles.push(
      { id: uid(), type: 'palette', colors: css, rect: { x: 0, ...rowA, w: 9 } },
      { id: uid(), type: 'text', role: 'caption', text: `Declared in CSS: the ${css.length} most used of ${site.colorStats.unique} colors (${site.colorStats.declarations} declarations), merged in OKLab.`, rect: { x: 9, ...rowA, w: 3 } },
    );
    if (px.length) tiles.push(
      { id: uid(), type: 'palette', colors: px, rect: { x: 0, ...rowB, w: 9 } },
      { id: uid(), type: 'text', role: 'caption', text: 'Measured in the desktop capture (k-means in OKLab), largest share first.', rect: { x: 9, ...rowB, w: 3 } },
    );
    slides.push({ id: uid('s'), variant: 0, tiles });
  }
  const bfColors = inp.cap.brandfetch?.colors ?? [];
  if (bfColors.length) {
    slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles: [
      { id: uid(), type: 'text', role: 'title', text: 'Official colors' },
      { id: uid(), type: 'palette', colors: bfColors.slice(0, 8).map(c => c.hex) },
      { id: uid(), type: 'text', role: 'caption', text: `From Brandfetch: ${bfColors.slice(0, 8).map(c => `${c.hex}${c.type ? ` ${c.type}` : ''}`).join(', ')}.` },
    ] }));
  }

  // Typography
  const faces = site.typefaces.filter(t => t.source !== 'system or unresolved' || t.uses > 0).slice(0, 3);
  const bfFonts = inp.cap.brandfetch?.fonts ?? [];
  if (faces.length || bfFonts.length) {
    const tiles: Tile[] = [{ id: uid(), type: 'text', role: 'title', text: 'Typography' }];
    for (const t of faces) tiles.push({ id: uid(), type: 'type', family: t.family, sample: [t.source, weightsText(t) && `weights ${weightsText(t)}`, t.uses ? `leads ${t.uses} font stacks` : ''].filter(Boolean).join(' · ') });
    const lines = site.typefaces.slice(0, 10).map(t => `${t.family} — ${t.source}${weightsText(t) ? `, ${weightsText(t)}` : ''}${t.uses ? `, ${t.uses} uses` : ''}`);
    if (bfFonts.length) lines.push('', `Brandfetch: ${bfFonts.map(f => `${f.name}${f.type ? ` (${f.type})` : ''}`).join(', ')}`);
    tiles.push({ id: uid(), type: 'text', role: 'body', text: lines.join('\n') });
    slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles }));
  }

  // Captures: desktop and mobile side by side at their own proportions.
  if (inp.desktop || inp.mobile) {
    const tiles: Tile[] = [{ id: uid(), type: 'text', role: 'title', text: 'Homepage', rect: { x: 0, y: 0, w: inp.mobile ? 9 : 12, h: 1 } }];
    if (inp.desktop) { const t = imageTile(inp.desktop); t.rect = { x: 0, y: 1, w: inp.mobile ? 9 : 12, h: 7 }; tiles.push(t); }
    if (inp.mobile) { const t = imageTile(inp.mobile); t.rect = inp.desktop ? { x: 9, y: 0, w: 3, h: 8 } : { x: 4, y: 0, w: 4, h: 8 }; tiles.push(t); }
    slides.push({ id: uid('s'), variant: 0, tiles });
  }

  // Identity: logo candidates and the Open Graph image
  const identity: Tile[] = [];
  if (inp.og) identity.push(imageTile(inp.og));
  for (const l of inp.logos.slice(0, 5)) identity.push(logoTile(l, cap.domain, date));
  if (identity.length) slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles: [{ id: uid(), type: 'text', role: 'title', text: 'Identity' }, ...identity] }));

  // Timeline
  const per = Math.max(1, Math.min(8, inp.imagesPerSlide));
  const tl = [...inp.timeline].sort((a, b) => a.year - b.year);
  for (let i = 0; i < tl.length; i += per) {
    const chunk = tl.slice(i, i + per);
    slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles: [
      { id: uid(), type: 'text', role: 'title', text: `Timeline ${chunk[0].year}${chunk.length > 1 ? `–${chunk[chunk.length - 1].year}` : ''}` },
      ...chunk.map(t => imageTile(t)),
    ] }));
  }

  // Observations (generated, labelled as such on every slide)
  const obs = inp.observations;
  if (obs?.observations.length) {
    const label = `Generated by ${obs.model} from the captures in this deck, ${new Date(obs.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}. Check each against the captures it cites.`;
    const cap = (a: string) => a[0].toUpperCase() + a.slice(1);
    for (let i = 0; i < obs.observations.length; i += 4) {
      const chunk = obs.observations.slice(i, i + 4);
      slides.push(layoutSlide({ id: uid('s'), variant: 0, tiles: [
        { id: uid(), type: 'text', role: 'title', text: i ? 'Observations (cont.)' : 'Observations' },
        ...(i === 0 && obs.summary ? [{ id: uid(), type: 'text', role: 'body', text: obs.summary } as Tile] : []),
        ...chunk.map(o => ({ id: uid(), type: 'text', role: 'body', text: `${cap(o.area)}\n${o.text}\nSeen in: ${o.evidence.join(', ')}` }) as Tile),
        { id: uid(), type: 'text', role: 'caption', text: label },
      ] }));
    }
  }

  // Method: where every number came from
  const method = [
    `Site: ${site.url} — HTML and ${site.stylesheets.filter(s => s.ok).length} stylesheets read ${site.via === 'wayback' ? 'from the Wayback Machine' : 'live'} on ${date}.`,
    'Colors: every CSS color value counted, translucent ones under 50% skipped, merged within the set ΔE in OKLab.',
    'Typefaces: @font-face rules, Google Fonts and Adobe Fonts links, ranked by how many font stacks lead with them.',
    inp.desktop || inp.mobile ? 'Screenshots: Microlink headless browser.' : '',
    tl.length ? 'Timeline: Internet Archive Wayback Machine, one capture per year.' : '',
    inp.cap.brandfetch ? 'Official assets: Brandfetch Brand API.' : '',
    inp.cap.company ? (inp.cap.company.wikidata ? `Company resolved via Wikidata: ${inp.cap.company.wikidata}` : `Site found from the name: ${inp.cap.company.website}`) : '',
    inp.board.length ? 'Board imagery: the brand’s Instagram posts (Graph API Business Discovery), YouTube stills and its site’s photography, picked in Audit.' : '',
    obs ? `Observations: ${obs.model} (Anthropic), generated, cited to captures.` : '',
  ].filter(Boolean);
  slides.push({ id: uid('s'), variant: 0, tiles: [
    { id: uid(), type: 'text', role: 'title', text: 'Method', rect: { x: 0, y: 0, w: 12, h: 1 } },
    { id: uid(), type: 'text', role: 'body', text: method.join('\n'), rect: { x: 0, y: 1, w: 12, h: 7 } },
  ] });

  return { version: 1, title: `${inp.name}: brand audit`, theme: inp.theme, slides };
}
