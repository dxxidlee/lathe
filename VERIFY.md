# VERIFY: Milestone 0

Verification of the five reference tools in `/reference` (cloned from `dxxidlee/ADAbyMcCANN`) before porting.

- **Date:** 2026-10-01
- **Browser:** Google Chrome 154.0.8037.93 (real Chrome via Playwright `channel: 'chrome'`, so H.264 and Document PiP match what users run). Mood-strip was also tested in Firefox 155.
- **Viewport:** 1440×900
- **Totals:** 103 pass · 8 warn · 11 fail (122 checks)

| Tool | Pass | Warn | Fail |
|---|---|---|---|
| color-check | 13 | 0 | 0 |
| multi-export | 46 | 3 | 8 |
| mesh-gradient | 15 | 1 | 0 |
| color-swap | 12 | 2 | 3 |
| mood-strip | 17 | 2 | 0 |

**Fail** means the original is broken. **Warn** means it works but has a gap or a McCann string to strip. The port must pass every check the original passed and fix every Fail listed below. The Fix column describes what the port will do; nothing in `/reference` was changed.

**Port status:** all five tools are ported and pass every original check plus the fixes: Color-check and Multi-export in Milestone 2, Mesh-gradient, Color-swap and Mood-strip in Milestone 3. See the sections at the end of this file.

## How to rerun

```bash
cd verify && npm install && npx playwright install chromium firefox
node make-fixtures.mjs     # writes verify/fixtures/
node run.mjs               # all tools; or: node run.mjs color-swap mood-strip
```

The run needs Chrome, `ffmpeg`/`ffprobe` (MP4 fixture, WebM checks) and Ghostscript `gs` (renders every EPS). Downloads, unzipped exports, screenshots and `results.json` go to `verify/out/`, which is gitignored.

## Fixtures (`verify/fixtures/`, generated)

| File | What it is |
|---|---|
| `logo.png` | 1500×300 wordmark on a transparent background |
| `logo.svg` | 600×200 flat mark: rect, circle, paths (one even-odd, one stroke-only), polygon |
| `photo.jpg` | 1600×1067 photo-like scene with sky gradient, hills, a skin tone patch and noise |
| `clip.mp4` | 3 s, 640×360, 30 fps H.264 with a 440 Hz AAC tone |

## How exports were validated

Every downloaded file is decoded, not just checked for existence:

- **PNG/JPG:** signature and dimensions read from the header, then decoded in Chrome. The checker measures luminance variance (not blank), grayscale (R=G=B) and alpha coverage.
- **CMYK JPEG:** 4-component SOF plus an Adobe APP14 marker. The decoded mean colour must stay within 25 levels of the RGB JPEG.
- **SVG:** rendered through `<img>` and checked non-blank. Vector stays vector, and the raster wrapper uses `xlink:href`.
- **EPS:** EPSF header, BoundingBox and `%%EOF`, then rendered with Ghostscript and checked non-blank. Vector EPS renders are compared pixel by pixel against Chrome's render of the source SVG.
- **ZIP:** opened with JSZip; every entry is validated as above.
- **GIF:** `GIF89a` header, then frames and size counted with `ImageDecoder`.
- **WebM:** `ffprobe` reads the codecs and dimensions, and every frame is decoded and counted.
- **HTML/JSON:** structure parsed.

## Results

### color-check: 13/13 pass

| Flow | Result | Bug | Fix in port |
|---|---|---|---|
| Load | Pass | — | — |
| Paste hex: mixed separators, missing `#`, 3-digit, duplicates → 5 colors, 20 pairings | Pass | — | — |
| WCAG 2.2 ratios match an independent calculation (black/white 21.00; #2B2BE6/white 8.11) | Pass | — | — |
| APCA: black/white +106, white/black −108 | Pass | — | — |
| "Show only AAA" dims 12/20 cells | Pass | — | — |
| Auto-repair on a failing pair suggests a ≥4.5 fix (#E8FF1A/white → #6E7D00, 4.57) | Pass | — | — |
| Export `.svg`: valid, renders, 5 rows | Pass | — | — |
| Export `.html`: standalone report, 20 cells | Pass | — | — |
| Repeat exports get unique names | Pass | — | Name counter lives in localStorage; move it to IndexedDB settings |
| Uploaded font (woff2) embedded in the SVG as `@font-face` | Pass | — | — |
| Junk input returns the empty state | Pass | — | — |

### multi-export: 46 pass · 3 warn · 8 fail

| Flow | Result | Bug | Fix in port |
|---|---|---|---|
| Load; Export disabled until a file is loaded | Pass | — | — |
| `logo.png`, `logo.svg`, `photo.jpg`: name, dimensions and size tags | Pass | — | — |
| Zip has 12 files plus README per input (RGB: png/jpg/svg/eps; CMYK: jpg/eps; × color/grayscale) | Pass | — | — |
| PNG: longest edge = raster size; grayscale is true gray; transparency kept for PNG input | Pass | — | — |
| JPG: white matte; CMYK JPEG is 4-channel + Adobe APP14 and decodes close to the RGB version | Pass | — | — |
| SVG: vector input stays vector; raster input is embedded via `xlink:href`; grayscale filter works | Pass | — | — |
| Raster EPS (PNG/JPG input), RGB and CMYK: Ghostscript renders correctly | Pass | — | — |
| Vector EPS from `logo.svg`, color, RGB and CMYK | **Fail** | Differs from the SVG on 3.6% of pixels: the stroke-only curve is filled solid black | See EPS bugs below |
| EPS: `fill="none"` path | **Fail** | `parseColorToPS("none", [0,0,0])` returns the black fallback, so stroke-only shapes get a black fill | Treat `none` as no fill when a fallback is given |
| EPS: `fill-rule="evenodd"` | **Fail** | Always uses `fill` (nonzero winding); counter-shapes fill in | Emit `eofill` for even-odd |
| EPS: `<g transform>` | **Fail** | Transforms are ignored, so shapes land in the wrong place | Apply the CTM (`getCTM` or `concat`) |
| EPS: CSS class / `<style>` fill | **Fail** | Only `fill` attributes and inline `style` are read; class fills become black | Use computed style from a rendered clone |
| EPS: `rect rx` | **Fail** | Corner radius is ignored | Emit arcs for rounded rects |
| EPS: `<text>` | **Fail** | Text is dropped, so the EPS renders blank | Fall back to a raster EPS when the SVG has text (or outline it) |
| README.txt | Warn | Says "Generated by the McCANN Export tool"; EPS `%%Creator: McCANN Export` | Replace with Lathe (Milestone 3) |

Not a bug: CMYK EPS colours look duller in Ghostscript because it converts DeviceCMYK through a press profile, and #1A1A1A becomes K-only grey. The tool's README already documents the uncalibrated split, and shape coverage matches the RGB EPS. Arc commands (`A`) are approximated as straight lines; the fixtures don't use them, but they're worth fixing alongside the bugs above.

### mesh-gradient: 15 pass · 1 warn

| Flow | Result | Bug | Fix in port |
|---|---|---|---|
| Load; preview renders a non-flat gradient | Pass | — | — |
| All 12 variants render across 3 families | Pass | — | — |
| Element selection (Spheres): highlight appears; editing a stop recolors that element | Pass | — | — |
| Sliders, Randomize, Play/Stop | Pass | — | — |
| `.png` 16:9 → 3840×2160, 4:5 → 2160×2700, 9:16 → 2160×3840; `.jpeg` 3840×2160 | Pass | — | — |
| `.gif`: 40 frames, 720×405, ~7 MB | Pass | gif.js and its worker load from cdnjs at click time, so GIF export fails offline | `gif.js` from npm, worker bundled by Vite |
| Family labels | Warn | "Truth / Well / Told" is McCann's tagline (also used in internal keys and the export filename prefix) | Rename to Conic / Field / Sphere (Milestone 3) |

### color-swap: 12 pass · 2 warn · 3 fail

| Flow | Result | Bug | Fix in port |
|---|---|---|---|
| Load; WebGL2 renderer compiles | Pass | — | — |
| **Preview stage visible** | **Fail** | `nav.js` turns every tool page into a 5-column grid and flattens only known wrappers (`.mx .vl .ada .bb .gt .ms`) with `display:contents`. `#recolor` isn't listed, so the 3-panel app is squeezed into one auto-placed cell. The stage is 28px wide, the canvas 0×0, the view toggles are covered, and `body{overflow:hidden}` prevents scrolling. **In the original you cannot see the recolor at 1440×900 or 1920×1080.** See `verify/out/screens/color-swap-loaded.png`. | The tool mounts into the shell's stage/inspector, not the suite grid. Add a check that the stage is visible at 1440×900. |
| `photo.jpg`: analysis finds 8 color families | Pass | — | — |
| Recolored vs original differ (~95% of pixels); split view works (tested with DOM clicks because of the layout bug) | Pass | — | — |
| Presets, add rule, import palette | Pass | — | — |
| **Modals close on Escape** | **Fail** | The handler queries `.overlay`, but the modals use `.rc-overlay` | Use the shared modal primitive; query the right class |
| **Modals close on backdrop click** | **Fail** | Same selector bug | Same |
| Save preset `.json` / load preset | Pass | — | — |
| Export still (`photo.jpg`) → 1600×1067 recolored PNG | Pass | — | — |
| Export still (`logo.png`, transparent) | Warn | Exports at the right size, but transparency becomes near-black. Stills go through `canvas.captureStream` → `<video>` → a WebGL context with `alpha:false` | Upload stills straight to the texture, keep alpha, and use an alpha-enabled export context |
| `clip.mp4` loads (H.264/AAC), 30 fps detected, analysis runs | Pass | — | — |
| Seeking renders different recolored frames | Pass | — | — |
| Export `clip.mp4` → WebM: VP9 640×360, 90 frames, Opus audio | Warn | MediaRecorder WebM has no duration in its header, so the seek bar doesn't work in some players. Export runs in real time. | Patch the duration into the EBML header after recording (e.g. `fix-webm-duration`) |

Also noted for Milestone 3: the default palette is "Scarlet Red / Dark Red / Deep Red" (#E71324, #92001D, #500010), and a tooltip says "keep Scarlet Red dominant". This looks like a brand palette, so I need David to confirm whether it's McCann's before replacing it.

### mood-strip: 17 pass · 2 warn

| Flow | Result | Bug | Fix in port |
|---|---|---|---|
| Load | Pass | — | — |
| Add PNG + JPG via picker; live dimensions | Pass | — | — |
| Palette: 5 swatches; Copy all / Copy as CSS reach the clipboard | Pass | — | — |
| Save downloads byte-identical bytes | Pass | — | — |
| Paste image; paste link; WordPress `-300x200` URL upgrades to the full-size image | Pass | — | — |
| "Paste link" button (uses `prompt()`) | Pass | — | Replace `prompt()` with an inline field |
| Drop a file; drag to reorder; remove | Pass | — | — |
| Board persists across reload (IndexedDB) | Pass | Startup race: the initial empty `render()` schedules a save 400 ms out, so if restoring takes longer than that, the saved board is overwritten with an empty one (not reproduced) | Restore before the first save |
| Pop out opens a separate window with the image | Pass | — | — |
| **Float (Chrome):** strip moves into a Document PiP window and back | Pass | — | — |
| Float in Firefox 155 | Pass | Firefox now ships Document PiP; Float opened | — |
| Float in a browser without PiP (simulated in Chrome by removing the API) | Warn | The Float button is hidden; the board still works. There is no popup fallback for the whole strip. | Fall back to `window.open` with the strip, as CLAUDE.md requires |
| WebKit / Safari | Warn | Playwright's WebKit build crashes on launch on macOS 14.3, so it wasn't run; the simulated no-PiP check covers the same path | Retest on newer macOS or in Safari by hand |
| Clear (confirm) | Pass | — | — |

## Not covered

- Safari itself (see above). `prompt`/`confirm` dialogs were accepted by Playwright, not clicked by a person.
- Color-swap's eyedropper flows (sample rule / sample preserve / cluster pick) depend on the preview, which is invisible in the original (layout bug), so they were not exercised.
- EPS files were validated with Ghostscript, not opened in Illustrator.

---

# VERIFY: Milestone 1 (shell)

`npm run verify:shell` builds the app, serves the production build with `vite preview`, and drives it in Chrome at 1440×900 (`verify/shell.mjs`). Screenshots go to `verify/out/shell/`. **24/24 pass.**

| Check | Result |
|---|---|
| `check:tokens`: no hex, color functions, numeric weights or px outside `tokens.css` | Pass |
| Home: hero photo, accessible h1, index of 16 tools + Make a tool | Pass |
| Favicons, apple-touch-icon, manifest and manifest icons resolve | Pass |
| Tokens applied: black panels, white text, Helvetica Neue stack | Pass |
| Wordmark is live text (Medium) with the mark at cap height (0.714em) | Pass |
| Layout: top bar 40, rail 208, stage 944×836, inspector 288, status bar 24 | Pass |
| Defaults panel renders the manifest (chosenBy, `TODO(David)`, inheritedFrom) | Pass |
| Drop a PNG anywhere → tool loads it, status bar reads `logo.png  1500×300  24 KB`, tray +1 | Pass |
| Drop overlay names the target tool | Pass |
| Tool settings and last asset persist across reload (IndexedDB) | Pass |
| ⌘E exports a 1500×300 PNG and adds it to the tray as `Export · sandbox` | Pass |
| Tray lists assets, Send to menu, persists (with its open state) across reload | Pass |
| Send to from another tool switches routes and loads the asset after mount | Pass |
| Dropping on an unbuilt tool adds to the tray with a toast | Pass |
| Remove from tray | Pass |
| ⌘K palette: fuzzy match (`clrchk` → Color-check), Enter navigates | Pass |
| Palette closes on Escape and on backdrop click | Pass |
| 1–9 switch tools in rail order; ignored while typing | Pass |
| `?` shortcut sheet; Escape closes | Pass |
| ⌘⇧F shows the Milestone 4 notice | Pass |
| Rail collapses to 40px and stays collapsed after reload | Pass |
| `/make`, unknown tool, deep-link reload | Pass |
| No console errors or failed requests across the run | Pass |
| IndexedDB blocked: the app runs from memory | Pass |

Bugs found and fixed while building: the tray's Send to menu was clipped by the tray's scroll container (now rendered in a portal), and Sandbox revoked a blob URL while an image was still loading it (now revoked after the new image settles).

---

# VERIFY: Milestone 2 (Color-check, Multi-export ports)

`npm run verify:port` builds the app and reruns the Milestone 0 checks against the Lathe ports in Chrome (`verify/port.mjs`, validators shared with `run.mjs` via `verify/lib.mjs`). **72/72 pass.** The shell suite still passes 24/24.

| Tool | Original (M0) | Port (M2) |
|---|---|---|
| color-check | 13 pass | 14 pass (13 originals plus persistence), including: repair modal closes on Escape; exports land in the tray; palette, standard and uploaded font persist across reload; the HTML report no longer links Google Fonts |
| multi-export | 46 pass · 3 warn · 8 fail | 59 pass, 0 warn, 0 fail |

### Multi-export fixes (all verified with Ghostscript)

| Bug (M0) | Port result |
|---|---|
| Vector EPS from `logo.svg` differed from the SVG on 3.6% of pixels | 1.0% (RGB) and 0.2% shape coverage (CMYK); the remainder is anti-aliasing |
| `fill="none"` filled black | Pass: vector EPS, interior stays white |
| `fill-rule="evenodd"` ignored | Pass: `eofill`, hole stays white |
| `<g transform>` ignored | Pass: shapes measured in the live DOM and written with their CTM |
| CSS class / `<style>` fill ignored | Pass: computed style, red rect renders red |
| `rect rx` ignored | Pass: rounded rect built from arcs |
| `<text>` dropped (blank EPS) | Pass: falls back to a raster EPS of the rendered artwork; the README notes why |
| Arc commands drawn as straight lines (noted, untested in M0) | Pass: arcs converted to Béziers; new probe |
| README / EPS `%%Creator` said McCANN | Pass: "Lathe Multi-export" |

Each probe also asserts the EPS is not blank, so white-pixel checks cannot pass on an empty page. Stroke caps and joins now follow the SVG (the original forced round).

### Behaviour notes

- **Color-check:** the default chart font is Helvetica Neue (was Inter, loaded from Google Fonts). The grade colors, export hairline and label colors are defaults in the manifest. A dropped `.txt` loads into the palette field, and a dropped font file becomes the chart font.
- **Multi-export:** the zip, like every export, also lands in the asset tray. The preview surface (light/dark) is a new viewing control and doesn't affect the files.
- Bug found and fixed during the port: Multi-export cleared its "Export completed" status as soon as the export finished.

---

# VERIFY: Milestone 3 (Mesh-gradient, Color-swap, Mood-strip ports; McCann removed)

`npm run verify:port` now covers all five tools plus a McCann scan. **128/128 pass**, and the shell suite still passes 24/24.

| Tool | Original (M0) | Port |
|---|---|---|
| color-check | 13 pass | 14 pass |
| multi-export | 46 pass · 3 warn · 8 fail | 58 pass |
| mesh-gradient | 15 pass · 1 warn | 17 pass |
| color-swap | 12 pass · 2 warn · 3 fail | 18 pass |
| mood-strip | 17 pass · 2 warn | 18 pass |
| McCann removal | — | 3 pass |

### Fixes, each with a check

| Tool | Bug (M0) | Port |
|---|---|---|
| color-swap | Preview stage 28px wide, canvas 0×0, invisible | Mounted into the shell's stage: 944px wide at 1440×900, view toggles clickable |
| color-swap | Escape and backdrop clicks don't close modals (`.overlay` vs `.rc-overlay`) | Selector fixed; both close |
| color-swap | Transparent PNG exports with a black background | Stills render from their source canvas, the shader passes source alpha through, and the export context has alpha: `logo.png` exports 72% transparent |
| color-swap | WebM has no duration in its header | `fix-webm-duration` writes it: 3.00 s in the header |
| mesh-gradient | GIF encoder and worker loaded from cdnjs at click time | `gif.js` from npm with the worker bundled; no CDN requests during export |
| mood-strip | No Float fallback without Document PiP | A popup window holds the strip and returns it on close (simulated in Chrome); Firefox 155 uses PiP |
| mood-strip | Possible restore race (an early empty save could overwrite the board) | The board is restored before the first save |
| mood-strip | "Paste link" used `prompt()`; Clear used `confirm()` | Inspector link field; Lathe modal |

Other fixes found while porting:
- **mesh-gradient:** `mix()` only parses 6-digit hex, so the original's `mix(c, '#fff', t)` blended toward #000FFF and gave sphere/orbit highlights a blue cast. White and black are now written in full.
- **color-swap:** the original's collapsed-section CSS was malformed, so "Presets file" never collapsed. It now does; it starts collapsed, as the original markup intended.

### McCann removed

- Mesh-gradient families TRUTH / WELL / TOLD are now **Conic / Field / Sphere** (also in export filenames: `conic-conic-16x9-42.png`).
- Multi-export writes "Lathe Multi-export" into the EPS `%%Creator` and the README.
- None of the McCann suite chrome was ported: no `nav.js` "McCann Design" menu, no `design.css` header, no `home-mark.svg`, no gallery assets, no `McCann-Headline_4.ttf` or `PPNeueMontreal-Book.otf`.
- `verify/port.mjs` scans `src/` and the production build for "McCann" (none) and checks no gallery, home-mark or licensed-font files were copied.
- **Decided (David, Milestone 4):** keep the red. Color-swap's default palette keeps the original hex values (#E71324, #92001D, #500010…), with the swatch names neutralised to "Red / Dark red / Deep red".

### Behaviour notes

- **Color-swap** keeps its engine and controller as the original JavaScript (`engine.js`, `ui.js`, with the marked Lathe edits), rather than a TypeScript rewrite, to keep its 2,500 lines of behaviour intact. Its state persists through Lathe settings (IndexedDB), not localStorage. Uploaded files and exports land in the asset tray. Every global listener, the render loop, the media and the GL context are released on unmount.
- **Mood-strip** stores images in the asset tray and the board as references, so a reload restores order without storing data URLs. Linked images load with CORS first so their colors can be read. Hosts without CORS headers log a console error before the retry; this is the original's strategy and is expected.
- **Mesh-gradient:** the overlay handles drop their drop-shadows (no shadows in chrome) for a black keyline, and the selected element is outlined in chartreuse.

---

# VERIFY: Milestone 4 (Defaults panel, Fork)

`npm run verify:defaults` builds the app and drives the Defaults panel and Fork in Chrome (`verify/defaults.mjs`). **17/17 pass.** Ports (128/128) and shell (24/24) still pass.

| Check | Result |
|---|---|
| Every default listed with chosenBy / inheritedFrom and `TODO(David)` | Pass (Color-check: 17 rows) |
| Number edit applies at once; maker value struck through; "Edited by you" | Pass: WCAG AA 4.5 → 6 changes Pass/Large/Usable 10/4/50% → 8/6/40% |
| Option edit switches the tool | Pass: Standard wcag → apca, matrix shows +106 |
| A reason is saved with the edit and survives reload | Pass |
| Edits persist across reload | Pass |
| Invalid JSON, or a list where the maker had an object, is refused | Pass |
| Descriptive rows (CMYK separation, sRGB…) shown, not editable | Pass |
| Fork (⌘⇧F): tool source byte-identical to the repo, contract files, `defaults.json` (maker / current / edits with reasons / manifest with `chosenBy: You`), `FORK.md` listing each change struck through with the maker's choice and your reason; zip lands in the tray | Pass |
| Reset one row; "Reset to maker's defaults" | Pass |
| Fork on an unbuilt tool explains itself | Pass |
| Multi-export: raster size 2000 → 1000 replaces the working value; formats, color spaces and treatments edited as chips; export follows (one 1000×200 PNG) | Pass |
| Mesh-gradient: family default → sphere shows Sphere / spheres; reset → Conic | Pass |
| Color-swap: strength 0.85 → 0.5 moves the slider; the loaded photo survives the remount; reset → 85 | Pass |
| Mood-strip: swatches per image 5 → 3 | Pass |
| Fork works for every built tool | Pass |
| No console errors | Pass |

### How it works

- Edits live per tool in IndexedDB. A tool receives `ctx.defaults` (the maker's values with your edits applied), and an edit remounts it so the change shows at once.
- When a default's value changes (an edit or a reset), the shell drops your saved working value under the same key and passes `ctx.changedDefaults` to the tool. Tools with composite state (Mesh-gradient, Color-swap) drop their own working copies, so the new default always shows.
- Editors follow each row's shape: select (options), toggle chips (option lists), number (clamped to min/max), color, text, JSON (validated against the maker's shape). Manifests carry the hints. Rows the code doesn't read are marked `editable: false`.
- If a tool fails to start with edited defaults, the stage offers "Reset to maker's defaults".
- Color-swap now reopens its last image or video after a reload or remount.

---

# VERIFY: Milestone 5 (Audit subject mode, palettes, Bento)

`npm run verify:audit` builds the app, serves it with the `/api` functions (`vite preview` runs them the way Vercel does), and drives Audit and Bento in Chrome against the live archive APIs (`verify/audit.mjs`). **33/33 pass.** Ports, shell and defaults still pass.

### API (`/api`)

| Check | Result |
|---|---|
| `/api/sources` lists all 13 sources; the 6 keyless ones are available; keyed ones are hidden; no key values in the response | Pass |
| Every available source returns the normalized schema (`id, source, title, creator, date, year, imageUrl, thumbUrl, width, height, license, isPublicDomain, sourceUrl` + `type`) | Pass. "poster": AIC 23/133,118 · Archive 24/13,552 · LoC 23/18,704 · Met 2/9,242 · Openverse 20/240 · Wikimedia 24 |
| Source responses CDN-cacheable for 24 h (`s-maxage=86400`); errors `no-store`; unknown and locked sources 404; missing `q` 400 | Pass |
| `/api/img` serves allowlisted images and refuses the cloud metadata IP, foreign hosts, `file:`, HTML pages and junk; images capped at 4 MB (Vercel's response limit is 4.5 MB) with a `fallback=` thumbnail | Pass |

### Audit

| Check | Result |
|---|---|
| Parallel fan-out; results stream in; per-source counts, totals, timings and errors in the inspector | Pass: 116 results from 6 sources |
| Every thumbnail gets a 5–8 swatch palette (k-means in OKLab, in a Web Worker) with hex codes under each result | Pass: 92/116 within the run window, 5–6 swatches each |
| Repeat search served from the 24 h IndexedDB cache (no network) | Pass |
| Filters: public domain only, orientation, year range, source toggle, type | Pass |
| Color: sort by OKLab distance to a typed hex; filter within a ΔE threshold (checked against an independent OKLab computation) | Pass |
| Collections: add results, aggregate palette for the selection, persist across reload, multiple collections | Pass |

### Bento

| Check | Result |
|---|---|
| Audit → "Build deck in Bento": cover, palette + stats, imagery slides, auto-generated credits slide | Pass |
| Reshuffle, lock, drag to swap, corner resize snapping to the 12 × 8 grid, keyboard move/resize/delete | Pass |
| Tiles: image, logo, palette (swatches + hex), hex list, type specimen, text, stat | Pass |
| `.pptx`: opens in python-pptx (independent OOXML reader); 5 slides, 13.333 × 7.5 in; 8 pictures natively cropped (re-croppable in PowerPoint); 35 editable text boxes; all runs Helvetica Neue, with Arial's PANOSE and pitch family declared as the fallback; every slide XML valid (`xmllint`) | Pass |
| `.pdf`: 5 pages; Ghostscript renders; text extractable (cover and credits). Helvetica is the PDF base font, since Helvetica Neue is licensed and can't be embedded | Pass |
| `.png` per slide (1920 × 1080) and all slides zipped | Pass |
| `.svg` per slide: valid XML, images embedded as data URIs (no external links), renders | Pass |
| Copy for Figma: the slide's SVG markup on the clipboard | Pass |
| Light/dark theme; deck persists across reload; every export lands in the tray | Pass |

### Not verified

- Opening the `.pptx` in PowerPoint, Keynote and Google Slides themselves (no licenses or accounts here). It is checked with python-pptx and `xmllint`, the font fallback is declared, and images use standard `srcRect` crops.
- Pasting into Figma (the clipboard holds valid SVG markup, which Figma imports as layers).

### Deviations from CLAUDE.md, found against the live APIs on 2026-10-01

- **The Met:** `/public/collection/v1/search` was retired on 2026-10-01 (HTTP 410), so the adapter uses `/v1.1/search` (paginated). In-copyright Met objects publish no image, so queries like "poster" return few Met results.
- **Are.na:** listed as keyless in CLAUDE.md, but v3 search now returns 401 without a token, and v2 sits behind a Cloudflare bot challenge (not something to work around). It is implemented against v3 and appears only when `ARENA_TOKEN` is set in `.env.local`.
- **User-Agent:** Wikimedia rate-limits clients that don't identify themselves (429), while the Art Institute's firewall rejects agents carrying a URL (403). Wikimedia hosts get `LatheAudit/0.1 (+LATHE_CONTACT_URL)`, which defaults to the project owner's public GitHub profile (set it to the deployed site); every other host gets a plain agent.
- **Function layout:** adapters live in `api/_lib/sources/*.js`, served by one dynamic route `api/sources/[source].js`, to stay within Vercel Hobby's function limit (three functions in total). They are JavaScript with JSDoc types, checked by `tsc` (`tsconfig.api.json`), so they run unmodified on Vercel and in Node.
- **Image sizes:** each source's `imageUrl` is deck-sized (Met web-large, Wikimedia ≤ 1920 px, Archive ≤ 4 MB) to fit through the 4 MB proxy.

Bugs found and fixed while building:
- The Audit/Bento grids sized to their content's minimum width, overflowing narrow stages.
- Bento's slide fit ignored padding.
- Exports dropped images whose originals were refused or too large; they now fall back to the thumbnail.
- Color-swap's stage ResizeObserver fired after unmount; it is now disconnected.
