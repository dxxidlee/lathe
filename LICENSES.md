# Licenses

Lathe's own license is not chosen yet. The libraries below decide part of that choice: Cutout ships a library under the GNU Affero General Public License, so **this repository must stay open source**, and the deployed app must offer its source to everyone who uses it.

## Copyleft

| Library | Used by | License | What it means here |
|---|---|---|---|
| [@imgly/background-removal](https://github.com/imgly/background-removal-js) 1.7.0 | Cutout | AGPL-3.0 | Serving Lathe over a network counts as distribution under AGPL §13. Keep this repository public, link to it from the deployed app, and license Lathe's own code under terms compatible with AGPL-3.0. IMG.LY sells other licenses for closed use. |
| [esm-potrace-wasm](https://github.com/tomayac/esm-potrace-wasm) 0.5.1 (Potrace by Peter Selinger) | Vectorize, one-color tracing | GPL-2.0 (as the package declares it) | Upstream Potrace is distributed as "GPL version 2 or later", which allows it to be combined with AGPL-3.0 code under version 3. The WebAssembly port's package metadata says only "GPL-2.0"; confirm the "or later" grant carries over before relying on the combination. |
| [JSZip](https://stuk.github.io/jszip/) 3.10.2 | Multi-export, Bento, Fork | MIT or GPL-3.0-or-later | Used under MIT. |

The IMG.LY model files (ONNX weights and WebAssembly) are not in this repository. Cutout downloads them at runtime from the host set in its Defaults panel (IMG.LY's CDN by default) and the browser caches them. They are covered by the same AGPL-3.0 terms.

## Permissive

| Library | Used by | License |
|---|---|---|
| React, React DOM, React Router | Shell | MIT |
| [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs) 1.2.6 | Vectorize, multi-color tracing | Unlicense (public domain) |
| [opentype.js](https://github.com/opentypejs/opentype.js) 2.0.0 | Specimen (font parsing, outlines for the PDF) | MIT |
| [woff2-encoder](https://github.com/itskyedo/woff2-encoder) 2.0.0 | Specimen (WOFF2 → sfnt) | MIT |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.21.0 | Cutout (through @imgly/background-removal) | MIT |
| [pptxgenjs](https://github.com/gitbrent/PptxGenJS) 4.0.1 | Bento .pptx | MIT |
| [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 | Bento .pdf | MIT |
| [gif.js](https://github.com/jnordberg/gif.js) 0.2.0 | Mesh-gradient GIF | MIT |
| [fix-webm-duration](https://github.com/yusitnikov/fix-webm-duration) 1.0.6 | WebM duration metadata | MIT |
| [node-html-parser](https://github.com/taoqf/node-html-parser) 9.0.4 | Audit brand capture (server) | MIT |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) 0.131.0 | Audit observations (server) | MIT |

## Fonts and brand

- `verify/fixtures/inter-latin.woff2` (Inter, Latin subset, by Rasmus Andersson) is a test fixture under the SIL Open Font License 1.1; Lathe does not ship it.
- Helvetica Neue is never bundled. It is licensed, so Lathe uses the system copy (macOS, iOS) with Helvetica and Arial as fallbacks.
- The original suite's McCann typefaces were not copied (see VERIFY.md, Milestone 3).
- The Lathe mark, logo and campaign image in `/brand` belong to David Lee.

## Content

Audit results and Bento decks carry each image's own license and credit from its source. Brand-audit screenshots and logos stay the property of the sites they were captured from; Lathe shows them for research and labels them as such.
