/* tokens-exempt: writes PPTX/PDF/PNG/SVG deck content, not Lathe's interface.

   Bento exports. All formats render the same drawing model (draw.ts):
   - .pptx (pptxgenjs): native, editable text boxes, shapes and images; Helvetica Neue with an Arial
     fallback declared (panose/pitch family) so PowerPoint, Keynote and Google Slides substitute
     cleanly where Helvetica Neue is not installed.
   - .pdf (jsPDF): vector text and shapes; Helvetica is the PDF base font (Helvetica Neue cannot be
     embedded: licensed).
   - .png per slide, .svg per slide with embedded images, and "Copy for Figma" (SVG markup). */
import JSZip from 'jszip';
import type { AssetsAPI } from '../types';
import type { Deck } from './model';
import type { DrawConfig, Prim, SlideDrawing } from './draw';
import { slideSvg, PX_PER_IN } from './render-svg';
import { coverCrop, resolveImage, type ResolvedImage } from './images';

export interface ExportCtx { cfg: DrawConfig; assets: AssetsAPI; imageMaxPx: number; pngWidth: number }

async function resolveAll(drawings: SlideDrawing[], ctx: ExportCtx): Promise<Map<string, ResolvedImage>> {
  const srcs = new Map<string, string | undefined>();
  for (const d of drawings) for (const p of d.prims) if (p.kind === 'image') srcs.set(p.src, p.thumb);
  const out = new Map<string, ResolvedImage>();
  await Promise.all([...srcs].map(async ([s, thumb]) => {
    // Full size first; if the archive refuses it (rate limit, missing original), use the thumbnail
    // rather than dropping the image from the deck.
    // The proxy serves the thumbnail in the same request when the original is refused or too large.
    try { out.set(s, await resolveImage(s, ctx.assets, ctx.imageMaxPx, thumb)); return; } catch { /* fall through */ }
    console.warn('[bento] image unavailable for export', s);
  }));
  return out;
}

/* ---------------- SVG / PNG / Figma ---------------- */
export async function slideToSvg(d: SlideDrawing, ctx: ExportCtx): Promise<string> {
  const imgs = await resolveAll([d], ctx);
  return slideSvg(d, ctx.cfg, p => imgs.get(p.src)?.dataUrl, { idPrefix: 'x' });
}

export async function slideToPng(d: SlideDrawing, ctx: ExportCtx): Promise<Blob> {
  const svg = await slideToSvg(d, ctx);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = ctx.pngWidth, H = Math.round(W * ctx.cfg.slideH / ctx.cfg.slideW);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d')!.drawImage(img, 0, 0, W, H);
    return await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export async function slidesToPngZip(ds: SlideDrawing[], ctx: ExportCtx, base: string): Promise<Blob> {
  const zip = new JSZip();
  for (let i = 0; i < ds.length; i++) zip.file(`${base}-${String(i + 1).padStart(2, '0')}.png`, await slideToPng(ds[i], ctx));
  return zip.generateAsync({ type: 'blob' });
}

/** SVG markup to the clipboard; Figma pastes it as editable vector layers. */
export async function copyForFigma(d: SlideDrawing, ctx: ExportCtx): Promise<string> {
  const svg = await slideToSvg(d, ctx);
  await navigator.clipboard.writeText(svg);
  return svg;
}

/* ---------------- PDF ---------------- */
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function containRect(p: Extract<Prim, { kind: 'image' }>, img: ResolvedImage) {
  const a = img.w / img.h;
  let w = p.w, h = p.w / a;
  if (h > p.h) { h = p.h; w = p.h * a; }
  return { x: p.x + (p.w - w) / 2, y: p.y + (p.h - h) / 2, w, h };
}

export async function deckToPdf(ds: SlideDrawing[], ctx: ExportCtx, title: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { slideW: W, slideH: H } = ctx.cfg;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [W, H], compress: true });
  doc.setProperties({ title, creator: 'Lathe Bento' });
  const imgs = await resolveAll(ds, ctx);
  for (let i = 0; i < ds.length; i++) {
    if (i) doc.addPage([W, H], 'landscape');
    const d = ds[i];
    doc.setFillColor(...hexRgb(d.bg)); doc.rect(0, 0, W, H, 'F');
    for (const p of d.prims) {
      if (p.kind === 'rect') { doc.setFillColor(...hexRgb(p.fill)); doc.rect(p.x, p.y, p.w, p.h, 'F'); }
      else if (p.kind === 'image') {
        const img = imgs.get(p.src); if (!img) continue;
        const fmt = img.mime === 'image/png' ? 'PNG' : 'JPEG';
        if (p.fit === 'cover') {
          const data = await coverCrop(img, p.w / p.h, Math.round(Math.max(p.w, p.h) * 200)); // ~200 dpi
          doc.addImage(data, fmt, p.x, p.y, p.w, p.h, undefined, 'FAST');
        } else {
          const r = containRect(p, img);
          doc.addImage(img.dataUrl, fmt, r.x, r.y, r.w, r.h, undefined, 'FAST');
        }
      } else {
        if (!p.lines.length) continue;
        doc.setFont('helvetica', p.weight >= 500 ? 'bold' : 'normal');
        doc.setFontSize(p.size);
        doc.setTextColor(...hexRgb(p.color));
        const lh = p.size / 72 * p.lineHeight;
        const blockH = p.lines.length * lh;
        const top = p.valign === 'top' ? p.y : p.valign === 'bottom' ? p.y + p.h - blockH : p.y + (p.h - blockH) / 2;
        p.lines.forEach((l, k) => {
          const y = top + k * lh + p.size / 72 * 0.8;
          doc.text(l, p.align === 'center' ? p.x + p.w / 2 : p.x, y, { baseline: 'alphabetic', align: p.align === 'center' ? 'center' : 'left', charSpace: p.tracking * p.size / 72 });
        });
      }
    }
  }
  return doc.output('blob');
}

/* ---------------- PPTX ---------------- */
/* Arial's PANOSE and the swiss pitch family: what PowerPoint, Keynote and Slides use to pick a
   substitute when Helvetica Neue is missing. Added only where absent (pptxgenjs writes some). */
const FALLBACK_ATTRS: [string, string][] = [['panose', '020B0604020202020204'], ['pitchFamily', '34'], ['charset', '0']];
function declareFallback(xml: string): string {
  return xml.replace(/<a:(latin|ea|cs) typeface="(Helvetica Neue[^"]*)"([^>]*?)(\/?)>/g, (_m, tag, face, attrs: string, close) => {
    const add = FALLBACK_ATTRS.filter(([k]) => !new RegExp(`\\b${k}=`).test(attrs)).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<a:${tag} typeface="${face}"${attrs}${add}${close}>`;
  });
}

export async function deckToPptx(ds: SlideDrawing[], deck: Deck, ctx: ExportCtx): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'LATHE_16x9', width: ctx.cfg.slideW, height: ctx.cfg.slideH });
  pptx.layout = 'LATHE_16x9';
  pptx.title = deck.title;
  pptx.company = 'Lathe';
  pptx.theme = { headFontFace: 'Helvetica Neue', bodyFontFace: 'Helvetica Neue' };
  const imgs = await resolveAll(ds, ctx);
  const c = (h: string) => h.replace('#', '').toUpperCase();
  for (const d of ds) {
    const s = pptx.addSlide();
    s.background = { color: c(d.bg) };
    for (const p of d.prims) {
      if (p.kind === 'rect') s.addShape('rect', { x: p.x, y: p.y, w: p.w, h: p.h, fill: { color: c(p.fill) }, line: { type: 'none' } });
      else if (p.kind === 'image') {
        const img = imgs.get(p.src); if (!img) continue;
        const data = img.dataUrl.replace(/^data:/, '');
        if (p.fit === 'cover') {
          // Native crop (srcRect): the full image stays in the file and can be re-cropped in PowerPoint.
          s.addImage({ data, x: p.x, y: p.y, w: p.w, h: p.w * img.h / img.w, sizing: { type: 'cover', w: p.w, h: p.h } });
        } else {
          const r = containRect(p, img);
          s.addImage({ data, x: r.x, y: r.y, w: r.w, h: r.h });
        }
      } else {
        if (!p.lines.length) continue;
        const whole = p.lines.join(' ').replace(/\s+/g, ' ').trim() === p.text.replace(/\s+/g, ' ').trim();
        s.addText(whole ? p.text : p.lines.join('\n'), {
          x: p.x, y: p.y, w: p.w, h: p.h, margin: 0,
          fontFace: p.weight === 500 ? 'Helvetica Neue Medium' : 'Helvetica Neue', bold: p.weight >= 700,
          fontSize: p.size, color: c(p.color), align: p.align, valign: p.valign,
          lineSpacingMultiple: p.lineHeight, charSpacing: p.tracking ? p.tracking * p.size : undefined,
          wrap: true, fit: 'none',
        });
      }
    }
  }
  const raw = await pptx.write({ outputType: 'blob', compression: true }) as Blob;
  // Declare the Arial fallback: give every Helvetica Neue face Arial's panose and pitch family.
  const zip = await JSZip.loadAsync(raw);
  await Promise.all(Object.keys(zip.files).filter(n => /^ppt\/(slides\/slide\d+|theme\/theme\d+|slideMasters\/slideMaster\d+)\.xml$/.test(n)).map(async n => {
    const xml = await zip.file(n)!.async('string');
    zip.file(n, declareFallback(xml));
  }));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
}

export const pxSize = (cfg: DrawConfig) => ({ w: Math.round(cfg.slideW * PX_PER_IN), h: Math.round(cfg.slideH * PX_PER_IN) });
