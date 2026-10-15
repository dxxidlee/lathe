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

/** Add grid slides to a PDF doc. When existingDoc is passed, adds pages to it. */
export async function deckToPdf(ds: SlideDrawing[], ctx: ExportCtx, title: string, existingDoc?: any): Promise<Blob> {
  const { slideW: W, slideH: H } = ctx.cfg;
  let doc = existingDoc;
  if (!doc) { const { jsPDF } = await import('jspdf'); doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [W, H], compress: true }); doc.setProperties({ title, creator: 'Lathe Deck' }); }
  const imgs = await resolveAll(ds, ctx);
  for (let i = 0; i < ds.length; i++) {
    if (i || existingDoc) doc.addPage([W, H], 'landscape');
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

/** Add grid-based slides to an existing pptx instance. */
export async function addGridSlidesToPptx(ds: SlideDrawing[], pptx: any, ctx: ExportCtx): Promise<void> {
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
}

/** Write a pptx instance to a Blob with Arial fallback declarations. */
export async function writePptx(pptx: any): Promise<Blob> {
  const raw = await pptx.write({ outputType: 'blob', compression: true }) as Blob;
  const zip = await JSZip.loadAsync(raw);
  await Promise.all(Object.keys(zip.files).filter(n => /^ppt\/(slides\/slide\d+|theme\/theme\d+|slideMasters\/slideMaster\d+)\.xml$/.test(n)).map(async n => {
    const xml = await zip.file(n)!.async('string');
    zip.file(n, declareFallback(xml));
  }));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
}

/** Full pipeline: create pptx, add grid slides, write. For backward compat. */
export async function deckToPptx(ds: SlideDrawing[], deck: Deck, ctx: ExportCtx): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'LATHE_16x9', width: ctx.cfg.slideW, height: ctx.cfg.slideH });
  pptx.layout = 'LATHE_16x9'; pptx.title = deck.title; pptx.company = 'Lathe';
  pptx.theme = { headFontFace: 'Helvetica Neue', bodyFontFace: 'Helvetica Neue' };
  await addGridSlidesToPptx(ds, pptx, ctx);
  return writePptx(pptx);
}

export const pxSize = (cfg: DrawConfig) => ({ w: Math.round(cfg.slideW * PX_PER_IN), h: Math.round(cfg.slideH * PX_PER_IN) });

/* ---- Brand slide exports ---- */
import { getTemplate, resolveSlotRect, SLIDE_W as B_SW, SLIDE_H as B_SH, RADIUS as B_RAD, type BrandSlide } from '../audit/brand-slide';
import { renderSlideCanvas } from '../audit/brand-slide-render';

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(blob); });
  } catch { return null; }
}

async function loadDataUrl(src: string, assets: AssetsAPI, thumb?: string | null): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  if (src.startsWith('blob:')) return fetchAsDataUrl(src);
  if (src.startsWith('asset:')) {
    const a = assets.get(src.slice(6));
    if (!a) return null;
    const u = URL.createObjectURL(a.blob);
    try { return await fetchAsDataUrl(u); } finally { URL.revokeObjectURL(u); }
  }
  // Remote URL: try the image proxy first, then direct fetch with the proxy path
  const proxied = `/api/img?url=${encodeURIComponent(thumb || src)}`;
  const result = await fetchAsDataUrl(proxied);
  if (result) return result;
  // Proxy failed (host not allowed) — try loading via an Image element which uses browser cache
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = thumb || src;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    cv.getContext('2d')!.drawImage(img, 0, 0);
    return cv.toDataURL('image/png');
  } catch { /* try proxied version */ }
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = `/api/img?url=${encodeURIComponent(src)}`;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    cv.getContext('2d')!.drawImage(img, 0, 0);
    return cv.toDataURL('image/png');
  } catch { return null; }
}

/** Render a brand slide tile image to a data URL with rounded corners baked in. */
async function renderTileImage(brand: BrandSlide, slotName: string, assets: AssetsAPI): Promise<string | null> {
  const template = getTemplate(brand.variant);
  const slotDef = template.find(s => s.name === slotName);
  if (!slotDef) return null;
  const sd = brand.slots.find(s => s.name === slotName);
  const r = resolveSlotRect(slotDef, sd?.rect);
  // For motion tiles: try GIF URL, then poster, then the original asset
  const gifUrl = sd?.gifUrl || (brand.motion?.slotName === slotName ? brand.motion.gifUrl : null);
  const posterUrl = sd?.posterUrl || (brand.motion?.slotName === slotName ? brand.motion.posterUrl : null);
  const src = gifUrl || posterUrl || sd?.assetThumbUrl || sd?.assetUrl;
  if (!src) return null;
  const dataUrl = await loadDataUrl(src, assets);
  if (!dataUrl) return null;
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = dataUrl;
  await img.decode().catch(() => {});
  const cv = document.createElement('canvas'); cv.width = Math.round(r.w); cv.height = Math.round(r.h);
  const ctx = cv.getContext('2d')!;
  ctx.beginPath(); ctx.roundRect(0, 0, r.w, r.h, B_RAD); ctx.clip();
  if (sd?.fit === 'contain') {
    const s = Math.min(r.w / img.width, r.h / img.height);
    ctx.drawImage(img, (r.w - img.width * s) / 2, (r.h - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const z = sd?.cropZoom ?? 1;
    const imgAr = img.width / img.height, slotAr = r.w / r.h;
    let sw: number, sh: number;
    if (imgAr > slotAr) { sh = img.height / z; sw = sh * slotAr; }
    else { sw = img.width / z; sh = sw / slotAr; }
    const sx = (img.width - sw) * (sd?.focalX ?? 0.5), sy = (img.height - sh) * (sd?.focalY ?? 0.3);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, r.w, r.h);
  }
  return cv.toDataURL('image/png');
}

/** Brand slide → PPTX: each tile as a separate element, palette as native rects. */
export async function brandSlideToPptx(
  brand: BrandSlide,
  pptx: any,
  assets: AssetsAPI,
): Promise<void> {
  const template = getTemplate(brand.variant);
  const s = pptx.addSlide();
  const SW = 13.333, SH = 7.5;
  s.background = { color: brand.theme === 'dark' ? '000000' : 'FFFFFF' };

  for (const slot of template) {
    const sd = brand.slots.find(d => d.name === slot.name);
    const r = resolveSlotRect(slot, sd?.rect);
    const x = r.x / B_SW * SW, y = r.y / B_SH * SH, w = r.w / B_SW * SW, h = r.h / B_SH * SH;
    const rad = B_RAD / B_SW * SW;

    if (slot.role === 'palette') {
      const pw = w / Math.max(1, brand.palette.length);
      brand.palette.forEach((hex, i) => {
        s.addShape('rect', { x: x + i * pw, y, w: pw, h, fill: { color: hex.replace('#', '') }, line: { type: 'none' }, rectRadius: i === 0 ? rad : i === brand.palette.length - 1 ? rad : 0 });
      });
      continue;
    }

    if (slot.role === 'logo') {
      s.addShape('rect', { x, y, w, h, fill: { color: brand.logo.bgColor.replace('#', '') }, line: { type: 'none' }, rectRadius: rad });
      if (brand.logo.assetUrl) {
        const data = await loadDataUrl(brand.logo.assetUrl, assets);
        if (data) {
          const img = new Image(); img.src = data;
          await img.decode().catch(() => {});
          const maxW = w * 0.6, maxH = h * 0.6;
          const sc = Math.min(maxW / (img.width || 1), maxH / (img.height || 1));
          const iw = (img.width || maxW) * sc, ih = (img.height || maxH) * sc;
          s.addImage({ data: data.replace(/^data:/, ''), x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih });
        }
      }
      continue;
    }

    // Image / motion tile
    const isMotion = brand.motion?.slotName === slot.name && brand.motion.gifUrl;
    if (isMotion) {
      try {
        const r2 = await fetch(brand.motion!.gifUrl!);
        const blob = await r2.blob();
        const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(blob); });
        s.addImage({ data: data.replace(/^data:/, ''), x, y, w, h, rounding: true });
      } catch { /* skip motion */ }
      continue;
    }

    if (sd?.assetUrl) {
      const data = await renderTileImage(brand, slot.name, assets);
      if (data) s.addImage({ data: data.replace(/^data:/, ''), x, y, w, h });
    } else if (slot.hasTileBg) {
      s.addShape('rect', { x, y, w, h, fill: { color: brand.theme === 'dark' ? '141414' : 'F0F0F0' }, line: { type: 'none' }, rectRadius: rad });
    }
  }
}

/** Brand slide → SVG with editable structure: each tile as a <image> with rounded clipPath, palette as <rect>s. */
export async function brandSlideToSvg(brand: BrandSlide, assets: AssetsAPI): Promise<string> {
  const template = getTemplate(brand.variant);
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${B_SW} ${B_SH}" width="${B_SW}" height="${B_SH}">`];
  parts.push(`<defs>`);
  for (const slot of template) {
    const sd = brand.slots.find(d => d.name === slot.name);
    const r = resolveSlotRect(slot, sd?.rect);
    parts.push(`<clipPath id="clip-${slot.name}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${B_RAD}"/></clipPath>`);
  }
  parts.push(`</defs>`);
  parts.push(`<rect width="${B_SW}" height="${B_SH}" fill="${brand.theme === 'dark' ? '#000' : '#fff'}"/>`);

  for (const slot of template) {
    const sd = brand.slots.find(d => d.name === slot.name);
    const r = resolveSlotRect(slot, sd?.rect);

    if (slot.role === 'palette') {
      const pw = r.w / Math.max(1, brand.palette.length);
      parts.push(`<g clip-path="url(#clip-${slot.name})">`);
      brand.palette.forEach((hex, i) => parts.push(`<rect x="${r.x + i * pw}" y="${r.y}" width="${pw}" height="${r.h}" fill="${hex}"/>`));
      parts.push(`</g>`);
      continue;
    }

    if (slot.role === 'logo') {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${B_RAD}" fill="${brand.logo.bgColor}"/>`);
      if (brand.logo.assetUrl) {
        const data = await loadDataUrl(brand.logo.assetUrl, assets);
        if (data) {
          const img = new Image(); img.src = data;
          await img.decode().catch(() => {});
          const maxW = r.w * 0.6, maxH = r.h * 0.6;
          const sc = Math.min(maxW / (img.width || 1), maxH / (img.height || 1));
          const iw = (img.width || maxW) * sc, ih = (img.height || maxH) * sc;
          parts.push(`<image href="${data}" x="${r.x + (r.w - iw) / 2}" y="${r.y + (r.h - ih) / 2}" width="${iw}" height="${ih}"/>`);
        }
      }
      continue;
    }

    if (sd?.assetUrl) {
      const data = await renderTileImage(brand, slot.name, assets);
      if (data) parts.push(`<image clip-path="url(#clip-${slot.name})" href="${data}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`);
    } else if (slot.hasTileBg) {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${B_RAD}" fill="${brand.theme === 'dark' ? '#141414' : '#f0f0f0'}"/>`);
    }
  }
  parts.push(`</svg>`);
  return parts.join('\n');
}

/** Brand slide → PNG at 2x (3840×2160). */
export async function brandSlideToPng(brand: BrandSlide): Promise<Blob> {
  const canvas = await renderSlideCanvas(brand, 2);
  return new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('PNG encode failed')), 'image/png'));
}

/** Brand slide → PDF page. */
export async function brandSlideToPdf(brand: BrandSlide, doc: any): Promise<void> {
  const canvas = await renderSlideCanvas(brand, 2);
  const data = canvas.toDataURL('image/png');
  const W = 13.333, H = 7.5;
  doc.addImage(data, 'PNG', 0, 0, W, H);
}
