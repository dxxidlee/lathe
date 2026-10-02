/* tokens-exempt: writes export files (PNG/JPG/SVG/EPS/README), not Lathe's interface.

   Multi-export engine, ported from reference/multi-export/index.html. Raster, SVG, CMYK JPEG
   and zip assembly are the original algorithms; the EPS writers live in eps.ts. Metadata and README credit
   "Lathe Multi-export". */
import JSZip from 'jszip';
import { CmykJpeg } from './cmyk-jpeg.js';
import { epsFromCanvas, epsFromSvg } from './eps';

export const CREATOR = 'Lathe Multi-export';
export type Fmt = 'png' | 'jpg' | 'svg' | 'eps';
export type Space = 'rgb' | 'cmyk';
export type Treat = 'color' | 'grayscale';

export interface Source {
  name: string;       // stem
  fileName: string;
  fileSize: number;
  isSvg: boolean;
  svgText: string | null;
  dataUrl: string;
  img: HTMLImageElement;
}

export interface Options {
  fmts: Fmt[]; spaces: Space[]; treats: Treat[]; size: number;
  jpegQuality: number; jpgMatte: string; epsRasterMax: number; grayWeights: number[];
}

const CMYK_FORMATS = new Set<Fmt>(['jpg', 'eps']);

/* ---------- Load ---------- */
export async function loadSource(blob: Blob, fileName: string): Promise<Source> {
  const isSvg = blob.type === 'image/svg+xml' || fileName.toLowerCase().endsWith('.svg');
  let svgText: string | null = null, dataUrl: string;
  if (isSvg) {
    const text = await blob.text();
    svgText = text.indexOf('<svg') >= 0 ? text : null;
    dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText || '')));
  } else {
    dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
  }
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not read that image. Try a PNG, JPG, or SVG.')); img.src = dataUrl; });
  return { name: fileName.replace(/\.[^.]+$/, '') || 'logo', fileName, fileSize: blob.size, isSvg, svgText, dataUrl, img };
}

/* ---------- Raster helpers ---------- */
function drawToCanvas(img: HTMLImageElement, size: number, { gray = false, matte = null as string | null, w: gw = [0.2126, 0.7152, 0.0722] } = {}) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = size / Math.max(w, h);
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const x = cv.getContext('2d', { willReadFrequently: true })!;
  if (matte) { x.fillStyle = matte; x.fillRect(0, 0, cw, ch); }
  x.drawImage(img, 0, 0, cw, ch);
  if (gray) {
    const id = x.getImageData(0, 0, cw, ch); const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = gw[0] * d[i] + gw[1] * d[i + 1] + gw[2] * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    x.putImageData(id, 0, 0);
  }
  return cv;
}
const canvasBlob = (cv: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), type, q));
const nextFrame = () => new Promise<void>(res => requestAnimationFrame(() => res()));

/* ---------- SVG helpers ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const grayMatrix = (w: number[]) => `${w[0]} ${w[1]} ${w[2]} 0 0 ${w[0]} ${w[1]} ${w[2]} 0 0 ${w[0]} ${w[1]} ${w[2]} 0 0 0 0 0 1 0`;

function serializeSvg(svgEl: Element) {
  svgEl.setAttribute('xmlns', SVG_NS);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgEl);
}
function grayFilter(doc: Document, w: number[]) {
  const filter = doc.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', 'mx-gray');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const fe = doc.createElementNS(SVG_NS, 'feColorMatrix');
  fe.setAttribute('type', 'matrix');
  fe.setAttribute('values', grayMatrix(w));
  filter.appendChild(fe);
  return filter;
}

/* Raster embedded in an SVG wrapper. Illustrator and Photoshop implement SVG 1.1, where an
   <image> is only linked through xlink:href. */
function svgFromRaster(dataUrl: string, w: number, h: number, gray: boolean, gw: number[]) {
  const doc = document.implementation.createDocument(SVG_NS, 'svg', null);
  const svg = doc.documentElement;
  svg.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS);
  svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (gray) { const defs = doc.createElementNS(SVG_NS, 'defs'); defs.appendChild(grayFilter(doc, gw)); svg.appendChild(defs); }
  const image = doc.createElementNS(SVG_NS, 'image');
  image.setAttribute('x', '0'); image.setAttribute('y', '0');
  image.setAttribute('width', String(w)); image.setAttribute('height', String(h));
  image.setAttributeNS(XLINK_NS, 'xlink:href', dataUrl);
  if (gray) image.setAttribute('filter', 'url(#mx-gray)');
  svg.appendChild(image);
  return serializeSvg(svg);
}

/* Returns null when the upload can't be reparsed, so the caller falls back to the raster wrapper. */
function svgFromVector(svgText: string, gray: boolean, gw: number[]) {
  let text = svgText;
  if (!/<svg[^>]*\sxmlns\s*=/i.test(text)) text = text.replace(/<svg\b/i, '<svg xmlns="' + SVG_NS + '"');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const svg = doc.documentElement;
  if (!svg || svg.localName.toLowerCase() !== 'svg') return null;
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(n => Number.isFinite(n));
  if (hasVb) {
    if (!svg.getAttribute('width')) svg.setAttribute('width', String(vb[2]));
    if (!svg.getAttribute('height')) svg.setAttribute('height', String(vb[3]));
  } else {
    const w = parseFloat(svg.getAttribute('width') || ''), h = parseFloat(svg.getAttribute('height') || '');
    if (Number.isFinite(w) && Number.isFinite(h)) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  if (gray) {
    const defs = doc.createElementNS(SVG_NS, 'defs');
    defs.appendChild(grayFilter(doc, gw));
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('filter', 'url(#mx-gray)');
    while (svg.firstChild) g.appendChild(svg.firstChild);
    svg.appendChild(defs); svg.appendChild(g);
  }
  return serializeSvg(svg);
}

/* ---------- Generate ZIP ---------- */
export interface Result { blob: Blob; zipName: string; count: number; folders: number; notes: string[] }

export async function generate(src: Source, o: Options, status: (s: string) => void): Promise<Result | { error: string }> {
  if (!o.fmts.length || !o.spaces.length || !o.treats.length) return { error: 'Pick at least one format, color space, and treatment.' };
  const zip = new JSZip();
  const base = src.name;
  const root = zip.folder(base + '-Exports')!;
  const img = src.img;
  const spaceLabel = { rgb: 'RGB', cmyk: 'CMYK' }, treatLabel = { color: 'COLOR', grayscale: 'GRAYSCALE' };
  const notes = new Set<string>();
  let count = 0, folders = 0;

  for (const sp of o.spaces) {
    const cmyk = sp === 'cmyk';
    /* PNG has no CMYK color model and SVG colors are sRGB by definition, so the CMYK folder
       only gets the formats that can really carry ink. */
    const spaceFmts = cmyk ? o.fmts.filter(f => CMYK_FORMATS.has(f)) : o.fmts;
    if (!spaceFmts.length) continue;
    for (const tr of o.treats) {
      const gray = tr === 'grayscale';
      const dir = root.folder(spaceLabel[sp])!.folder(treatLabel[tr])!;
      const stem = base + '-' + spaceLabel[sp].toLowerCase() + '-' + treatLabel[tr].toLowerCase();
      folders++;
      const cvPng = drawToCanvas(img, o.size, { gray, w: o.grayWeights });
      const cvJpg = drawToCanvas(img, o.size, { gray, matte: o.jpgMatte, w: o.grayWeights });
      for (const fm of spaceFmts) {
        if (fm === 'png') dir.file(stem + '.png', await canvasBlob(cvPng, 'image/png'));
        else if (fm === 'jpg') {
          if (cmyk) {
            status('Encoding CMYK JPEG…');
            await nextFrame();
            const id = cvJpg.getContext('2d')!.getImageData(0, 0, cvJpg.width, cvJpg.height);
            const ink = CmykJpeg.rgbaToCmyk(id.data);
            dir.file(stem + '.jpg', CmykJpeg.encode(ink, cvJpg.width, cvJpg.height, o.jpegQuality));
            status('Rendering…');
          } else dir.file(stem + '.jpg', await canvasBlob(cvJpg, 'image/jpeg', o.jpegQuality / 100));
        } else if (fm === 'svg') {
          let svg: string | null = null;
          if (src.isSvg && src.svgText) svg = svgFromVector(src.svgText, gray, o.grayWeights);
          if (!svg) svg = svgFromRaster(cvPng.toDataURL('image/png'), cvPng.width, cvPng.height, gray, o.grayWeights);
          dir.file(stem + '.svg', svg);
        } else if (fm === 'eps') {
          let epsBlob: Blob | null = null;
          if (src.isSvg && src.svgText) {
            const r = epsFromSvg(src.svgText, { gray, cmyk, grayWeights: o.grayWeights, creator: CREATOR });
            epsBlob = r.blob;
            if (!epsBlob && r.fallbackReason) notes.add(`EPS is raster because the SVG ${r.fallbackReason}.`);
          }
          if (!epsBlob) epsBlob = epsFromCanvas(cvJpg, cmyk, o.epsRasterMax, CREATOR);
          dir.file(stem + '.eps', epsBlob);
        }
        count++;
      }
    }
  }
  if (!count) return { error: 'Nothing to export: cmyk only covers .jpg and .eps. Add one of those, or turn rgb on.' };

  root.file('README.txt', readmeText(base, [...notes]));
  status('Packaging…');
  const blob = await zip.generateAsync({ type: 'blob' }, meta => status('Packaging… ' + Math.round(meta.percent) + '%'));
  return { blob, zipName: base + '-Exports.zip', count, folders, notes: [...notes] };
}

function readmeText(base: string, notes: string[]) {
  return `${base} — Export package
Generated by ${CREATOR}
${notes.length ? '\nNOTES FOR THIS FILE\n' + notes.map(n => '  ' + n).join('\n') + '\n' : ''}
FOLDER STRUCTURE
  ${base}-Exports/
    RGB/ and CMYK/      -> color space
      COLOR/ GRAYSCALE/ -> treatment
        .png .jpg .svg .eps -> formats (CMYK holds .jpg and .eps only)

WHAT IS REAL
  PNG   Real raster, transparent background.
  JPG   Real raster, flattened on white.
  SVG   Vector if you uploaded an SVG; otherwise the raster is embedded
        inside an SVG wrapper. Grayscale uses an SVG color-matrix filter.
  EPS   If you uploaded an SVG, the EPS is TRUE VECTOR — the shapes are
        converted to PostScript paths (moveto/lineto/curveto) with their
        transforms, CSS colors, fill rules and rounded corners, and open as
        editable vector art in Illustrator. SVGs with text, embedded images,
        gradients, masks or filters get a raster EPS of the rendered artwork
        instead (see NOTES above). If you uploaded a PNG/JPG, the EPS embeds
        the bitmap (a photo can't be vectorized without tracing).
  GRAYSCALE  Real luminance conversion (Rec. 709 weights).

THE CMYK FOLDER
  Only .jpg and .eps appear here, because they are the only two formats that
  can carry ink values. Both are the real thing:
  JPG   Four-channel JPEG with an Adobe APP14 marker. Photoshop opens it as
        a CMYK document with no conversion step.
  EPS   Vector art writes ink values through setcmykcolor; embedded rasters
        write a four-component DeviceCMYK image.

  PNG and SVG are deliberately absent rather than quietly duplicated as RGB.
  PNG has no CMYK color model at all, and SVG colors are sRGB by definition,
  so a "CMYK" copy of either would just be a mislabeled RGB file. Take those
  two from the RGB folder.

IMPORTANT LIMITS (please read)
  CMYK  The separation uses the standard uncalibrated formula, NOT an ICC
        press profile, so the ink split is naive — rich blacks in particular
        become K-only. Always soft-proof in Photoshop or Illustrator against
        your actual profile (SWOP, GRACoL, Fogra39) and re-separate there
        before sending anything to press.

Treat this package as a fast first pass for screen and layout use. Anything
going to press should be finalized in Adobe tools against the right profile.`;
}
