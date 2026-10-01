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
