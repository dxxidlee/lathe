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

---

## Milestone 6: keyed sources and Audit brand mode

`npm run verify:brand` (plus the earlier suites, rerun). Unit checks run in-process on fixtures; the API checks hit live sites, Wikidata and archive.org; the UI runs on the production build. Microlink is replaced by a local stand-in that screenshots with Playwright (`MICROLINK_API`), so the suite spends one real screenshot, not dozens: the free tier allows 25 a day.

### Keyed sources

| Check | Result |
|---|---|
| Harvard Art Museums (fixture): key sent, images with `imagepermissionlevel` > 0 dropped, IIIF 1600/400 px, `primaryimageurl` fallback | Pass |
| Unsplash (fixture): `Client-ID` header, "Photo by … on Unsplash" credit, `utm_source=lathe` links, 1920 px images | Pass |
| Harvard, Unsplash, Europeana and Smithsonian report HTTP 401 for a bad key | Pass |
| Cooper Hewitt (5,247 for "poster") and the Rijksmuseum (41) return the schema; their image hosts pass `/api/img` | Pass |
| Smithsonian with `DEMO_KEY` (304 results) and Europeana with `api2demo`: live, during development | Pass |

Not verified: Harvard and Unsplash against the live APIs (no keys here). They follow the published response formats and are fixture-tested.

### Brand mode

| Check | Result |
|---|---|
| CSS colors: hex (3/4/6/8), `rgb()`/`hsl()` in comma and space syntax, `oklch()`, `oklab()`, alpha; `var()` refused; translucent overlays (< 50%) skipped | Pass |
| Clustering merges near colors in OKLab and ranks by use | Pass |
| CSS scan: `@font-face` (weights, styles), stacks through `var()` and the `font` shorthand, comments and `url()` ignored, custom-property names kept, `@import` incl. Google `css2` URLs | Pass |
| HTML scan: title, meta, Open Graph, theme color, icons, manifest, Google/Adobe font links, logo SVGs (sprite `<use>` inlined, scripts and handlers stripped); photos in menus ignored | Pass |
| SSRF guard: loopback, private, link-local, metadata, CGNAT, IPv6 private, `::ffff:` mapped, non-standard ports, credentials, `file:`, and a public name resolving to 127.0.0.1, all refused; redirects re-checked | Pass |
| Capture stripe.com: 12 ranked colors incl. #635BFF, Söhne self-hosted, 9 logo candidates as data URIs, 693 KB response (under Vercel's 4.5 MB) | Pass |
| "Stripe, Inc." → Wikidata Q7624104 → stripe.com | Pass |
| Screenshot endpoint: desktop 1440 × 900, mobile 780 × 1688 (2×), same-origin JPEG; `javascript:`/`file:` refused. One live Microlink request: 1280 × 800 | Pass |
| Observations endpoint, with Claude stubbed: `claude-opus-5-5`, adaptive thinking, `fallbacks: "default"`, JSON-schema output, images sent; observations citing no capture dropped; refusal → 422; no key → 404 | Pass |
| UI: mode switch, missing keys named in the inspector, report (captures, CSS palette, measured vs declared colors, typography, logos), independent OKLab recheck of the comparison | Pass |
| Re-running from the IndexedDB cache spends no screenshots | Pass |
| Deck in Bento: cover, palette, official colors (Brandfetch), typography, homepage, identity, timeline, observations, method, credits; `.pptx` (python-pptx), `.pdf` (Ghostscript), `.png`, `.svg` with embedded screenshots | Pass |
| Wayback timeline (API and in the report); Wayback fallback for sites that block automated requests | **Skipped**: archive.org answered 503 "Temporarily Offline" for the whole session. Both worked earlier in development (stripe.com 2006 → 2026; Muji captured from its snapshot); the suite reruns them whenever archive.org is up |

Not verified: Brandfetch (no key) and live Claude observations (no key; the request shape is tested against a stub).

### Deviations from CLAUDE.md, found against the live APIs

- **Cooper Hewitt and the Rijksmuseum** no longer use keys: Cooper Hewitt moved to a keyless GraphQL API, and the Rijksmuseum to its keyless Linked Art search. `COOPER_HEWITT_KEY` and `RIJKS_KEY` are not read; `.env.example` says so.
- **Smithsonian** exposes media only for CC0 objects, so the query adds `media_usage:"CC0"`.
- **Europeana** images come through its thumbnail API, since provider hosts can't be allowlisted.
- **Wayback:** the CDX index takes 25–30 s per query for a big site (it timed out collapsed), so the timeline uses the availability API, about 1 s per year, paced against archive.org's 429s.
- **Microlink's free tier is 25 screenshots a day.** A brand audit takes 2 + the timeline count (default 6). Screenshots are cached for a week at the CDN and 24 h in IndexedDB. `MICROLINK_KEY` lifts the limit.
- **Bot walls:** many sites (Vitra, Muji, Parsons, NYT) answer 403/429 to any server request, whatever the User-Agent. The capture then reads the site's latest Wayback snapshot and says so in the report and on the cover.
- **Brandfetch** needs a key, and the brand is looked up by domain.
- **Functions:** `api/brand/capture`, `shot`, `timeline`, `observe`, so seven functions in total, with `maxDuration` set in `vercel.json`.

---

## Milestone 7: Palette, Dither, Vectorize, Cutout

`npm run verify:image`: 35 checks, all pass. Outputs are checked independently of the app: palettes and scales in OKLab, contrast with the WCAG formula, `.ase` parsed byte by byte, dithers by their pixels, traced SVGs rendered and compared with the source, cutouts by their alpha channel. Every tool takes images by drop, the tray, Send to, or a URL (`/api/fetch`, SSRF-safe; a web page gives its share image), and every output can be sent on to another tool.

### Palette

| Check | Result |
|---|---|
| Photo → 6 swatches (OKLab k-means), shares sum to 100% | Pass |
| OKLCH scales: 11 steps per swatch; lightness descends; hue held within 4°; chroma reduced only to stay in sRGB; the swatch replaces its nearest step | Pass |
| Swatches editable: add a hex, rename (slugged), recolor, remove | Pass |
| Contrast pairs: every ratio shown matches an independent WCAG 2.2 computation; AA / AAA / all filters | Pass |
| Exports: CSS (72 custom properties), DTCG 2025.10 tokens (sRGB components match hex), Figma variables (REST payload), Tailwind config (evaluated), `.ase` (independent parser: header, 6 groups, 72 RGB swatches, exact byte length) | Pass |
| "Open in Color-check" hands over the hex list | Pass |

### Dither

| Check | Result |
|---|---|
| Floyd–Steinberg on a gray ramp keeps the average tone (0.500 vs 0.500) | Pass |
| Bayer 2/4/8, Floyd–Steinberg, Atkinson: exactly two colors, PNG at source size (1600 × 1067) | Pass |
| Threshold moves ink coverage (30% → 70%); pixel size 8 gives exact 8 × 8 blocks | Pass |
| Palette mode: at most 4 colors, all from the image's OKLab palette | Pass |
| Halftone dots (17,633) and lines (191 bands): PNG and SVG; the SVG is valid XML and renders to the same tone as the PNG (±0.03) | Pass |

### Vectorize

| Check | Result |
|---|---|
| One color (Potrace WASM): PNG logo → SVG covering the same ink, IoU 0.98 at source proportions | Pass |
| Specks and smoothing change the trace (2,141 paths → 2 ignoring specks under 80 px²) | Pass |
| Multi-color (ImageTracer, OKLab palette): 4 fills, mean tone within 0.01 of the photo | Pass |
| Compare: wipe, overlay, SVG only, original | Pass |
| SVG sent to Multi-export | Pass |

### Cutout

| Check | Result |
|---|---|
| Met *Teapot* (CC0): corners transparent, object opaque, 23% kept, 15 s on CPU incl. model download | Pass |
| Edge refine: choke < base < spread; hardness removes the soft fringe; feather widens it | Pass |
| WebP keeps alpha; cutout sent to Dither | Pass |

Shared: all four tools have a Defaults panel (every reason `TODO(David)`), and Fork downloads each one's source.

Bugs found and fixed while testing:
- **Dither:** at pixel sizes that don't divide the image, blocks were uneven. The grid now uses whole cells from the top left.
- **Cutout:** a +10 px spread lifted the background to 25% opacity. The soft edge window now stays inside 0–1.
- **Server fetches:** they now send the Wikimedia contact User-Agent.

### Notes and deviations

- **Cutout's model files** (ONNX and WebAssembly, about 80 MB for `isnet_fp16`) download from IMG.LY's CDN on first use and are cached by the browser. The host is a Defaults row, so the files can be self-hosted later. Inference runs single-threaded because the app doesn't send the cross-origin isolation headers. Those headers would block images from archives that don't send CORP in Audit.
- **Licensing (`LICENSES.md`):** @imgly/background-removal is AGPL-3.0, so the repository must stay open source and the deployed app should link to its source. esm-potrace-wasm declares GPL-2.0; upstream Potrace is "GPL-2.0 or later". Lathe's own license is still David's decision.
- **Tailwind export** is a v3 config, which v4 loads with `@config`.
- **Figma variables** use the REST API's `POST /v1/files/:key/variables` payload, since Figma has no file format for variables.
- **Not verified:** opening the `.ase` in Adobe apps, and importing the Figma payload into a live file (both need accounts). Both follow the published formats, and the `.ase` is read back by an independent parser.

---

## Milestone 8: Grid, Specimen, Kinetic-type, Icon-set

`npm run verify:m8`: 26 checks, all pass. Checks are independent of the app:
- Grid geometry is recomputed, and the CSS is laid out by Chrome.
- Specimen is tested against a font generated with known metrics.
- Every icon is decoded and the `.ico` parsed byte by byte.
- GIF frames are counted by walking the file's blocks, and WebM is read with ffprobe.

| Tool | Check | Result |
|---|---|---|
| Grid | Desktop 1440 (12 columns, 24 gutter, 80 margins): column 84.67 px, every column placed exactly, 109 baselines | Pass |
| Grid | CSS snippet lays out in Chrome to the same 12 × 84.66 px columns from x = 80 | Pass |
| Grid | A4 (ISO 216): SVG 210 × 297 mm, PNG at 300 dpi 2480 × 3508 | Pass |
| Grid | Slide: 8 rows snapped to the 8 px baseline (80 px each); orientation swap | Pass |
| Grid | Custom columns, gutter and margins | Pass |
| Icon-set | SVG mark → 17 files: PNGs 16–1024 at exact sizes; Apple touch and maskable icons opaque on the background | Pass |
| Icon-set | `favicon.ico`: 3 PNG entries (16, 32, 48), sizes and offsets valid; manifest with maskable 512; `favicon.svg` identical to the source; HTML snippet | Pass |
| Icon-set | Maskable: no mark pixels outside the 40% safe circle | Pass |
| Icon-set | PNG source (no `favicon.svg`); padding shrinks the mark | Pass |
| Specimen | Generated OTF: family, style and metrics read exactly (UPM 1000, ascender 800, descender −200, x-height 500, cap height 700) | Pass |
| Specimen | Inter WOFF2 unpacked and parsed: 518 glyphs in the grid, glyph details, 11 features | Pass |
| Specimen | Features shown off and on; toggling `tnum` applies it to live text | Pass |
| Specimen | Type scale 16 px × 1.25ⁿ (9 steps) on screen and in the CSS tokens | Pass |
| Specimen | Specimen PDF (7 pages): glyphs drawn as vector paths from the font's outlines, no font embedded, Ghostscript renders | Pass |
| Kinetic-type | Cycle = duration + stagger × (slots − 1) + hold (4.6 s) | Pass |
| Kinetic-type | Stagger, fall, drift, scramble, dissolve: blank at the start, in motion, then all settle on the same set text | Pass |
| Kinetic-type | GIF89a 540 × 540, 115 frames (4.6 s × 25 fps), loops | Pass |
| Kinetic-type | WebM VP9 1080 × 1080, 4.60 s duration written into the header | Pass |
| Kinetic-type | A dropped font replaces Helvetica Neue | Pass |
| All four | Defaults panels (every reason `TODO(David)`); Fork downloads their source; no console errors | Pass |

Bugs found and fixed while testing:
- **Specimen:** opentype.js's text shaping throws on GSUB lookups it doesn't support (Inter's `ccmp`). Outlines are now laid out from the character map, advances and pair kerning; live text on the page keeps the browser's full shaping.
- **Specimen:** opentype.js 2 groups name-table entries by platform, so names were read from the wrong place.
- **Kinetic-type:** the cycle length counted letters without spaces while the stagger order counts them, so the last letters could be cut off.

Notes:
- **Every registered tool is built now.** The tests that used an unbuilt tool (fork and drop with no tool) run on the Make a tool page instead.
- **Test fixture:** Inter (OFL 1.1) is a test fixture only; see `verify/fixtures/CREDITS.md`.
- **Not verified:** opening the specimen PDF in Acrobat or Preview (Ghostscript renders it), and installing the icon set on a phone home screen.

---

## Milestone 9: Make a tool (v1 dummy)

`npm run verify:make`: 9 checks, all pass.

`/make` asks "Describe a tool you wish existed". A prompt plays a scripted generation, one step at a time (about 5 seconds):
1. The request read into an intent (verb, object, result)
2. Inputs
3. Outputs
4. Defaults, chosen by "You", each quoting the words it came from
5. The inspector assembling control by control
6. A stage preview

The three scripted tools run on Lathe's own engines, and their controls and Defaults rows drive the preview:

| Prompt | Tool | Preview |
|---|---|---|
| Turn my photo into a halftone poster | Halftone poster (Image) | Dither's halftone on the campaign photograph: dot cell, screen angle, ink, paper |
| Make a grid for a 12-column editorial spread | Spread grid (Layout) | A 420 × 297 mm spread with Grid's geometry, the fold, a baseline and placeholder copy snapped to it: columns (read from the prompt), gutter, margins, baseline |
| Animate my logo letters falling into place | Logo drop (Motion) | Kinetic-type's fall preset with a bounce: letters, fall time, stagger, landing |

Any other prompt sketches the tool from its words and ends on "Tool generation arrives in v2."

| Check | Result |
|---|---|
| The prompt field's label | Pass |
| Halftone: the steps play in order; then a preview, 4 controls and 5 defaults (all "Chosen by You · From your words …") | Pass |
| Halftone controls redraw the preview | Pass |
| Spread grid: 12 columns from the prompt; editing Columns to 8 in the Defaults panel redraws it ("1 edited") | Pass |
| Logo drop animates; the Letters control changes the word | Pass |
| An unscripted prompt ends on "Tool generation arrives in v2." with a sketch of the tool | Pass |
| "Skip to the end"; reduced motion shows the generation at once | Pass |
| No server calls, no console errors | Pass |

Notes:
- **No tool is written.** Fork on a generated tool says forking arrives with tool generation in v2.
- **The rest of Lathe:** ⌘⇧F and dropping a file on this page behave as on any page without a tool.

### Wayback, rechecked (2026-10-04)

The Internet Archive was back for this milestone's full rerun, so the three checks skipped in Milestone 6 now pass:
- The stripe.com timeline: 2006, 2014, 2022, 2026 from the API; 2006, 2016, 2026 in the report.
- Vitra read from its Wayback capture after a live 403.

Its availability API was still degraded: it returned empty results for years it has. The timeline now retries throttled answers with a pause, and falls back to a one-year CDX lookup when availability comes back empty.

### All suites after Milestones 8–9

| Suite | Result |
|---|---|
| shell | 27 / 27 |
| defaults | 17 / 17 |
| port | 128 / 128 |
| audit | 33 / 33 |
| brand | 29 / 29 |
| image | 35 / 35 |
| m8 | 26 / 26 |
| make | 9 / 9 |

## Audit brand mode: the board (social imagery)

David asked for a brand board, to be built before Milestone 10. A brand or product name gives a bento: the logo in the centre, the palette top right, and imagery around them from the site and its social channels. The reference was an Erleada board.

Agent-Reach (Panniantong/Agent-Reach) is a Python CLI for agents (yt-dlp, Jina, OpenCLI with a signed-in Chrome) and cannot run in a Vercel function. Its public channels were rebuilt in Node instead:
- **YouTube, no key.** Lathe uses the channel the site links to. Failing that, it uses the brand's own channel if a search shows one. Failing that, it searches for videos whose titles name the brand, then "<name> commercial".
- **Stills.** Each video gives four stills from i.ytimg.com: three frames YouTube captured from the video, and the thumbnail. When the 1280 × 720 frames are missing, the stills fall back to the 16:9 thumbnail. Letterbox bars are trimmed before a still goes on the board.
- **Instagram, TikTok, X and the rest** need a signed-in session. Scraping them would break their terms, so they are listed as links only.
- **Site imagery.** Large photos are read from the homepage HTML. For script-built sites (erleada.com), they are read from the rendered page through Microlink.
- **Site guessing.** A product with no Wikidata website is matched to `<name>.com` when that page's title names it.
- **Palette.** Brandfetch colours are used when its key is set. Otherwise the palette is the logo's colours and the measured homepage colours, chromatic ones first.

| Check | Result |
|---|---|
| Capture finds social profiles and photography (stripe.com) | pass: youtube, instagram, x, facebook, linkedin; 9 images |
| YouTube from the linked channel: 4 videos × 4 stills, a still through /api/img | pass |
| A product with no channel (Erleada): site guessed from its title, videos found by search | pass: erleada.com; 4 videos naming it |
| /api/img tries fallbacks in order | pass |
| Rendered-page images (Microlink stand-in): icons and logos kept out | pass: 16 images |
| Imagery section: 7 picked in order, YouTube and site mixed; un-pick and re-pick keeps order | pass |
| Deck slide 1 is the board: logo {3,3,6,3}, palette {9,0,3,3}, 7 credited image tiles | pass |
| pptx / pdf / png / svg exports with the board added | pass: 9 slides |

Live boards were checked by eye:
- **Erleada:** the SVG logo on white in the centre; a white, purple, slate, chartreuse and blue-grey palette; the site's photography, then stills from the ads.
- **Glossier:** stills from its own channel, plus product images from the site.

Without Brandfetch, Glossier's palette picks up the blue and red that its site's CSS uses. Setting the Brandfetch key gives the official colours.

Bug fixed along the way: when the Wayback availability API answered empty for a walled-off site, the capture failed. It now asks the CDX index for a capture from the past year first.

The brand suite passed 34 / 35. Vitra's Wayback read was skipped because archive.org rate-limited the third consecutive run; it passed on 2026-10-04. Other suites rerun: audit 33 / 33, shell 27 / 27, defaults 17 / 17.

## Audit brand mode: Instagram (2026-10-06)

Instagram is one more feed into the brand audit. It appears in the Imagery section, on the board and in the observations. No new layout: posts reuse the pick tiles and video cards.

How it works:
- **Data.** `/api/ig/:username` calls the Graph API's Business Discovery (v26.0) with `INSTAGRAM_ACCESS_TOKEN` (a never-expiring Page token) and `INSTAGRAM_USER_ID`. Both are read on the server only.
  - Usernames are sanitized to letters, numbers, periods and underscores.
  - Responses are cached for an hour, on the server and in IndexedDB.
  - Posts are normalized to `{ id, type, src, poster, slides, permalink, caption, likes, comments, timestamp, score }`, plus `mediaType` (Instagram's own type).
- **Handle.** It comes from Brandfetch's social links, then the site's own Instagram link. When neither has one, or the account fails, an "Instagram handle" field appears in the inspector; a typed handle is remembered for that domain.
- **Media.** Images and videos stream through `/api/ig-media`. Only `*.cdninstagram.com` and `*.fbcdn.net` over https are fetched, redirects are re-checked, Range is passed on, and responses are cached as immutable.
- **Display.**
  - Videos play muted on a loop while on screen and pause off screen (IntersectionObserver). Their files load only when scrolled near.
  - Carousels show their cover and a "1/n" count.
  - Clicking a post opens it on Instagram in a new tab; the corner badge picks it for the board.
  - Tiles are kept between repaints, so playback doesn't restart.
- **Board.** By default it leads with the three most engaged posts (score = likes + comments × 3), credited `@handle · Instagram` with the post link.
- **Observations.** Claude receives the 30 posts' types, dates, engagement and captions, plus the top three as images (`ig1`–`ig3`). Observations about the feed cite those, or "instagram" for the data.
- **No token.** Sample posts from `public/data/mock-posts.json` are served (Lathe's own images and the test clip). They are labelled as samples and never picked for the board by default.
- **Removed.** `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`. There is no token refresh.

| Check | Result |
|---|---|
| @nike: profile and 30 posts | pass: 291,042,090 followers; 6 images, 9 carousels, 15 reels. Instagram withholds every reel's file (licensed audio), so each is shown as its thumbnail, labelled "Video (still)". |
| @glossier: profile and 30 posts | pass: 3,128,698 followers; 7 images, 18 carousels, 5 playable videos |
| Handle found by Brandfetch for both | pass |
| Second request served from the hour cache; `@Glossier` → `glossier` | pass (2 ms) |
| Errors are JSON with a code | pass: bad name 400 `bad_username`; missing account 404 `not_found`; bad token 401 `invalid_token`; Graph codes 4 and 17 → 429 `rate_limited`; code 10 → 403 `permission` |
| Token never appears in any response | pass |
| Media proxy: image 200, video Range 206, carousel slide; foreign, look-alike and http hosts refused | pass |
| UI: 30 cards; videos muted, looping, inline, with poster; play on screen, pause off screen; permalinks open in a new tab; badge toggles the pick | pass |
| Board: 3 Instagram posts, then YouTube and site imagery; Glossier's official palette from Brandfetch | pass |
| Claude observations for Glossier cover the feed (cadence, post mix, top posts, captions against the site), each citing ig1–ig3 or "instagram" | pass |
| Keyless: sample posts, labelled; not on the board | pass |

Not separable: Business Discovery answers the same error (code 110, subcode 2207013) for a username that doesn't exist and for a personal account. The message says it could be either; a separate "personal account" message is used only if Graph's text says so.

Seen locally only: a video can wait several seconds to start while the page's other images load. The local server serves six requests at a time per page; Vercel's HTTP/2 doesn't have that limit.

Not yet checked on Vercel: whether streamed video responses get past Vercel's 4.5 MB function response limit. Images are well under it; most feed videos are a few MB.

Test servers now treat an empty environment variable as set, so the verify suites stay keyless whatever `.env.local` holds. Suites: brand 35 / 37 (archive.org rate-limited the vitra and timeline checks), audit 33 / 33, shell 27 / 27, defaults 17 / 17.
