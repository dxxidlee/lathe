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
  id, name, group,   // Workbench | Drawer | Offcuts
  defaults,          // DefaultsManifest
  mount({ stage, inspector, statusbar, assets, settings, emit }) { return unmount },
}
```

- `stage`: center canvas. `inspector`: right panel controls, built from shared primitives. `statusbar`: file name, dimensions, size, state.
- `assets`: shared tray API (get, add, onChange). `emit('send', asset, targetToolId)`: chaining between tools.

## Shell (Figma-like)

- Top bar: wordmark, current tool, command palette (Cmd+K), Export.
- Left rail: tools grouped by `group` (Workbench, Drawer, Offcuts collapsed). "Your Tools" section for custom tools, "Make a tool" pinned at bottom. Collapsible.
- Center stage: drop a file anywhere to load it into the active tool. Pan/zoom where supported.
- Right inspector: tool controls, Defaults panel below.
- Bottom status bar, e.g. `hardaun-logo.png  3750×450  31 KB`.
- Asset tray: every dropped, fetched, or exported file lands here and is usable by every tool. "Send to" on any output.
- Keyboard: 1–9 switch tools (Workbench 6 + Drawer 3), Cmd+K palette, Cmd+E export, ? shortcut sheet.
- Routes: `/` home, `/t/:toolId`, `/make`. Old routes redirect (e.g. `/t/bento` → `/t/deck`).

## Defaults panel

Each tool ships `defaults.ts`:

```ts
{ key: 'rasterSize', label: 'Raster size', value: 2000, unit: 'px longest edge' }
```

- Lists every starting default. Rows are editable; edited rows show the original struck through.
- "Reset to defaults".

---

## Tool IDs, names, and groups

### Workbench (keys 1–6)
| ID | Name | Source folder |
|---|---|---|
| `subject-audit` | Subject Audit | `src/tools/subject-audit/` (shared code in `src/tools/audit/`) |
| `brand-audit` | Brand Audit | `src/tools/brand-audit/` (shared code in `src/tools/audit/`) |
| `deck` | Deck | `src/tools/bento/` |
| `palette` | Palette | `src/tools/palette/` |
| `contrast` | Contrast | `src/tools/color-check/` |
| `logo-export` | Logo Export | `src/tools/multi-export/` |

### Drawer (keys 7–9)
| ID | Name | Source folder |
|---|---|---|
| `icons` | Icons | `src/tools/icon-set/` |
| `specimen` | Specimen | `src/tools/specimen/` |
| `reference` | Reference | `src/tools/mood-strip/` |

### Offcuts (collapsed in rail)
| ID | Name | Source folder |
|---|---|---|
| `dither` | Dither | `src/tools/dither/` |
| `gradient` | Gradient | `src/tools/mesh-gradient/` |
| `kinetic-type` | Kinetic Type | `src/tools/kinetic-type/` |
| `recolor` | Recolor | `src/tools/color-swap/` |

### Hidden (reachable via Cmd+K, not in rail)
| ID | Name | Notes |
|---|---|---|
| `cutout` | Cutout | Will become an action inside other tools |
| `vectorize` | Vectorize | Will become an action inside other tools |
| `grid` | Grid | Will become a setting inside Deck |
| `resize` | Resize | Phase 1 only |
| `sandbox` | Sandbox | Dev tool |

### Alias map (old ID → current ID)
`audit` → `subject-audit`, `bento` → `deck`, `color-check` → `contrast`, `multi-export` → `logo-export`, `icon-set` → `icons`, `mood-strip` → `reference`, `mesh-gradient` → `gradient`, `color-swap` → `recolor`. Old routes redirect. Settings migrate on first load.

### Send-to flows
- Subject Audit → Deck (deck JSON)
- Brand Audit → Deck (deck JSON)
- Palette → Contrast (hex list)

## Make a tool

`/make`: describe a tool, Lathe generates it via the Claude API and runs it in a sandboxed iframe.
- Split view: chat thread (left), live sandbox preview (right).
- Iterative: each chat message refines the current version. Version history with restore.
- "Start from an existing tool" sends built-in source as context.
- "Test with a file" sends tray assets into the sandbox.
- Error catch + "Fix it" sends errors back for correction.
- Custom tools persist in IndexedDB, appear in "Your Tools" in the rail and Cmd+K.
- Export/Import library as JSON.

## Env

`.env.local` with placeholders for every key above. App works with zero keys; each key unlocks its source.

**Auth**: Email+password via Supabase. Google and GitHub OAuth are configured in Supabase but hidden in the UI — re-enable them in `src/shell/AuthModal.tsx` only after a custom domain is set so the Google consent screen shows "Lathe" instead of a Vercel preview URL. Email confirmation is disabled for now (Supabase's built-in SMTP has a low hourly cap that could fail during demos). Before a real public launch, add custom SMTP in Supabase Dashboard → Settings → Auth → SMTP Settings (e.g. Resend, Postmark, or AWS SES) and re-enable email confirmation.

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
