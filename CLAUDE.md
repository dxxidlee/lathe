# Lathe

Thesis project by David Lee (Parsons Communication Design).
Lathe is a browser-based application that houses a suite of design tools. Tools for people who make tools.

**Thesis**
- Subject: design practice when the software is self-authored.
- Question: what ideology does a tool carry from its maker?
- Line: "Every default was someone else's decision."

Lathe makes that literal. Every tool exposes its defaults, says who chose them and why, and can be forked.
v1 is a browser app only. No desktop build.

## Brand

Assets are in `/brand` (copy into `public/brand`):
- `lathe-mark.svg`: the mark, `fill="currentColor"`. Use it inline so it takes the text color.
- `lathe-logo-original.svg`: original mark on chartreuse (reference only).
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`: wire all into `index.html` and a web manifest.
- `hero-campaign.jpg`: campaign photo. Home screen hero, with "Tools for people who make tools." and the wordmark set in chartreuse over it.
- `app-icon-dock.jpg`: reference for icon treatment only.

Wordmark: "Lathe" set in Helvetica Neue Medium, followed by the mark at cap height. Build it as a component, never as an image.

**Colors (exactly three)**
- `--lathe` `#E8FF1A`
- `--black` `#000000`
- `--white` `#FFFFFF`

All other tones come from opacity on these three: 100 / 64 / 40 / 16 / 8. No grays as new hex values.

**Type: Helvetica Neue only**
- Stack: `"Helvetica Neue", Helvetica, Arial, sans-serif`. Do not self-host Helvetica Neue (licensed). It is native on macOS/iOS.
- Hierarchy through weight (300 / 400 / 500 / 700) and opacity, not new colors or new families.
- Tight tracking on display sizes (-0.02em to -0.04em), normal on UI text.
- Tabular figures (`font-variant-numeric: tabular-nums`) for every value, dimension, hex, and size readout.
- Sentence case labels.

**Look**
- Panels black, text white at 100/64/40 opacity, hairlines white at 16%.
- Chartreuse for active state, primary actions, selection, focus, and the home screen. Black text on chartreuse.
- Chips 22.5px high, 2.5px radius. Rails 7.5px. Keep the rail/chip/stat-row structure from the reference suite (`/reference/assets/design.css`).
- No gradients in chrome, no shadows, no icon libraries. Edgy comes from scale contrast, density, and the chartreuse, not decoration.
- All values in `src/styles/tokens.css`. No hardcoded colors, sizes, or weights in components. David will redesign.

## Source material

Existing tools: https://github.com/dxxidlee/ADAbyMcCANN (vanilla HTML/JS, one folder per tool). Clone into `/reference` (gitignored) and port from there.

Port these five, logic intact:
- `color-check`: WCAG 2.2 / APCA contrast matrix from pasted hex codes
- `multi-export`: logo to png/jpg/svg/eps, rgb/cmyk, color/grayscale, zip (JSZip, `assets/cmyk-jpeg.js`)
- `mesh-gradient`: animated mesh gradients, families/variants/palettes, grain, PNG/GIF export (gif.js)
- `color-swap`: recolor images and video to a target palette, rules, presets, export
- `mood-strip`: floating reference strip, drop/paste/link images, Float via Document Picture-in-Picture (Chrome only, fall back to popup)

Optional: `glyph-trace` (word image to OTF; opentype.js, tesseract.js, `assets/fit-curve.js`). Do NOT port `logo-variant`.

## Strip McCann

- Mesh-gradient families `TRUTH / WELL / TOLD` (McCann's tagline) become `Conic / Field / Sphere`.
- Multi-export writes `McCANN Export` into EPS/SVG metadata and a readme. Replace with `Lathe`.
- Remove every "McCann" string, preset, gallery asset, and `home-mark.svg`.
- Do not copy `McCann-Headline_4.ttf` or `PPNeueMontreal-Book.otf` (licensed).

## Step 0: verify before porting

Serve `/reference` locally and test the five tools in Chrome (Playwright is fine):
- No console errors on load.
- Main flow end to end with fixtures you create: PNG logo, SVG logo, JPG photo, short MP4.
- Every export downloads a valid file.
- Mood-strip Float works in Chrome and degrades elsewhere.

Write `VERIFY.md` (tool, flow, pass/fail, bug, fix). Fix bugs in the port, not in /reference. A ported tool is done only when it passes every check the original passed.

## Stack

- Vite + React + TypeScript shell. Deploy to Vercel.
- Tools are framework-agnostic vanilla TS modules mounted into shell-provided DOM nodes. Port logic as-is; do not rewrite algorithms.
- Libraries via npm, not CDN tags.
- IndexedDB for assets and per-tool settings, every call in try/catch.
- Vercel serverless functions in `/api` for anything needing API keys or server-side fetching (Audit). Keys live only in env vars, never in client code.

## Tool contract

```ts
export const tool: LatheTool = {
  id, name, group,   // Research | Color | Image | Type | Layout | Motion | Export | Reference
  defaults,          // DefaultsManifest
  mount({ stage, inspector, statusbar, assets, settings, emit }) { return unmount },
}
```

- `stage`: center canvas. `inspector`: right panel controls, built from shared primitives. `statusbar`: file name, dimensions, size, state.
- `assets`: shared tray API (get, add, onChange). `emit('send', asset, targetToolId)`: chaining between tools.

## Shell (Figma-like)

- Top bar: wordmark, current tool, command palette (Cmd+K), Export, Fork.
- Left rail: tools grouped by `group`, "Make a tool" pinned at bottom. Collapsible.
- Center stage: drop a file anywhere to load it into the active tool. Pan/zoom where supported.
- Right inspector: tool controls, Defaults panel below.
- Bottom status bar, e.g. `hardaun-logo.png  3750×450  31 KB`.
- Asset tray: every dropped, fetched, or exported file lands here and is usable by every tool. "Send to" on any output.
- Keyboard: 1–9 switch tools, Cmd+K palette, Cmd+E export, Cmd+Shift+F fork, ? shortcut sheet.
- Routes: `/` home (campaign hero + tool index), `/t/:toolId`, `/make`.

## Defaults panel

Each tool ships `defaults.ts`:

```ts
{ key: 'rasterSize', label: 'Raster size', value: 2000, unit: 'px longest edge',
  chosenBy: 'David Lee', reason: 'TODO(David)', inheritedFrom: null }
```

- Lists every starting default. Rows are editable; edited rows show the original struck through.
- `inheritedFrom` only for verifiable industry conventions (sRGB, 72 dpi, WCAG thresholds, 8pt grid). Otherwise `TODO(David)`.
- Never invent David's reasons. `reason: 'TODO(David)'` everywhere.
- "Reset to maker's defaults".

## Fork

Downloads a zip: the tool's source (Vite `?raw` imports), `defaults.json` with current edits, and `FORK.md` listing changes from the maker's defaults.

---

## Flagship: Audit (group: Research)

A professional research tool. Two modes, one output: a bento deck you can take into Slides, Keynote, PowerPoint, or Figma.

### Mode A: Subject audit
Query a subject ("1970s Japanese product photography", "Swiss transit signage", "Bauhaus posters") across many open archives at once.

Sources. Each is a server adapter in `/api/sources/*` returning one normalized schema. Sources whose key is missing are hidden in the UI, never broken.

| Source | Key |
|---|---|
| The Met Collection | none |
| Art Institute of Chicago | none |
| Internet Archive | none |
| Wikimedia Commons | none |
| Library of Congress | none |
| Openverse | none |
| Are.na | none for public search (optional token) |
| Cooper Hewitt | `COOPER_HEWITT_KEY` |
| Smithsonian Open Access | `SMITHSONIAN_KEY` (api.data.gov) |
| Harvard Art Museums | `HARVARD_KEY` |
| Europeana | `EUROPEANA_KEY` |
| Rijksmuseum | `RIJKS_KEY` |
| Unsplash | `UNSPLASH_KEY` |

Normalized result: `{ id, source, title, creator, date, year, imageUrl, thumbUrl, width, height, license, isPublicDomain, sourceUrl, palette? }`

Features:
- Parallel fan-out, results stream in as each source returns. Per-source counts and errors in the inspector.
- Filters: source, type, year range, public domain only, orientation.
- **Color:** extract a 5–8 swatch palette from every thumbnail (client-side, k-means in OKLab, in a worker). Show hex codes under each result. Filter or sort results by distance to any hex you type. Aggregate palette for the whole selection.
- Select results into a collection. Collections persist in IndexedDB.
- Every image carries license and credit through to export. Auto-generated credits slide.
- Cache responses (IndexedDB, 24h) and respect each API's rate limits.

### Mode B: Brand audit
Input a domain or company name. Produces a visual audit of that company.
- **Site capture:** server fetches the homepage and extracts title, meta, OG images, favicon/logo candidates (link icons, header SVGs), declared typefaces (@font-face, Google Fonts, Adobe Fonts kit links), and CSS color frequency (parse linked stylesheets, cluster, rank).
- **Screenshots:** desktop and mobile via Microlink (`MICROLINK_KEY` optional, free tier works without). Palette from pixels compared against the declared CSS palette.
- **Brand evolution:** Wayback Machine CDX API, one snapshot per year. Screenshot each to build a timeline of logo, color, and layout change.
- **Official assets:** Brandfetch (`BRANDFETCH_KEY`) for logos, colors, fonts when the key is present.
- **Observations (optional):** with `ANTHROPIC_API_KEY`, send captured screenshots plus extracted data to Claude (vision) for a short audit: consistency, hierarchy, type, color, tone. Every observation must reference something visible in the captures. Label as generated.

### Audit output: Bento
Audit results flow into Bento (below) as a prebuilt deck: cover, palette, typography, imagery, timeline (brand mode), observations, credits.

---

## Bento (group: Layout)

Compose assets into bento-box slides. Standalone tool, and the output stage for Audit.
- Tiles: image, palette swatches with hex, hex list, type specimen, logo, caption/text, stat.
- Layout engine: 16:9 slides on a 12×8 grid. Auto-layout picks a template by tile count and image aspect ratios. "Reshuffle" for alternates. Drag to swap, resize spans, lock tiles.
- Multi-slide decks.
- **Export:**
  - `.pptx` via pptxgenjs, with native editable text, shapes, and images. Opens in PowerPoint, Keynote, and Google Slides (import).
  - `.pdf` and `.png` per slide.
  - `.svg` per slide with embedded images, plus "Copy for Figma" (SVG to clipboard, pastes as editable layers).
- Fonts in exports: Helvetica Neue with Arial fallback declared in the pptx.

---

## New tools

Same contract, same defaults panel, same asset tray.

1. **Palette** (Color): image or URL in, palette out. OKLCH tint/shade scales per swatch, contrast pairs (hand off to Color-check), export CSS vars, JSON tokens, Figma variables JSON, Tailwind config, `.ase`.
2. **Dither** (Image): Bayer 2/4/8, Floyd-Steinberg, Atkinson, halftone dots/lines. Threshold, scale, two-color or palette. Export PNG, SVG for halftone.
3. **Vectorize** (Image): raster to SVG (potrace WASM for one-color, imagetracerjs for multi-color). Color count, smoothing, corner threshold, live overlay comparison. Export SVG.
4. **Cutout** (Image): in-browser background removal (`@imgly/background-removal`, AGPL: note it in `LICENSES.md`, and keep the repo open source). Edge refine, export transparent PNG/WebP, send to any tool.
5. **Grid** (Layout): columns, gutters, margins, baseline, rows. Presets for common formats. Export SVG overlay, PNG, CSS grid snippet.
6. **Specimen** (Type): drop any font file. Glyph grid, metrics, OpenType features toggle, waterfall, modular type-scale tab. Export specimen PDF, CSS scale tokens.
7. **Kinetic-type** (Motion): text + font in, presets (stagger, fall, drift, scramble, dissolve). Duration, easing, loop. Export GIF and WebM (MediaRecorder).
8. **Icon-set** (Export): one SVG/PNG in, full favicon + app icon set out (16 to 1024, apple-touch, maskable, `.ico`, `manifest.webmanifest`, HTML snippet). Zip.

Backlog (do not build): Line-work, Glyph-render, Batch resize, QR.

## Make a tool (dummy for v1)

Visual prototype only, no API calls.
- `/make`: one prompt field, "Describe a tool you wish existed".
- Scripted generation: parsing intent → inputs → outputs → defaults (chosenBy: "You") → inspector assembling control by control → stage preview.
- Three scripted examples with convincing results: "turn my photo into a halftone poster", "make a grid for a 12-column editorial spread", "animate my logo letters falling into place". Any other prompt plays a generic sequence ending on "Tool generation arrives in v2."

## Env

`.env.local` with placeholders for every key above. App works with zero keys; each key unlocks its source.

## Milestones

Stop after each, summarize, wait for David.
0. Verify the five originals, write VERIFY.md.
1. Shell, brand, tokens, home, command palette, asset tray, tool contract, IndexedDB.
2. Port Color-check, Multi-export.
3. Port Mesh-gradient, Color-swap, Mood-strip. Strip McCann.
4. Defaults panel + Fork for all ported tools.
5. Audit subject mode (no-key sources first) + palette extraction + Bento with all exports.
6. Keyed sources, then Audit brand mode.
7. Palette, Dither, Vectorize, Cutout.
8. Grid, Specimen, Kinetic-type, Icon-set.
9. Make a tool dummy.
10. (Optional) Glyph-trace. Deploy to Vercel.
