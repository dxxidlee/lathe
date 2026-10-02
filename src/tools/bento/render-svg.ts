/* tokens-exempt: writes SVG slide content, not Lathe's interface.

   Slide drawing → SVG. Used for the live preview (thumbnail hrefs), the .svg export and PNG
   rasterising (embedded data URIs), and "Copy for Figma". */
import type { DrawConfig, Prim, SlideDrawing } from './draw';

export const PX_PER_IN = 144; // 13.333 × 7.5 in → 1920 × 1080

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Math.round(v * PX_PER_IN * 100) / 100;

function textSvg(p: Extract<Prim, { kind: 'text' }>, font: string) {
  const sizePx = p.size * PX_PER_IN / 72, lh = sizePx * p.lineHeight;
  const blockH = p.lines.length * lh;
  const top = p.valign === 'top' ? n(p.y) : p.valign === 'bottom' ? n(p.y + p.h) - blockH : n(p.y + p.h / 2) - blockH / 2;
  const x = p.align === 'center' ? n(p.x + p.w / 2) : n(p.x);
  const tspans = p.lines.map((l, i) => `<tspan x="${x}" y="${(top + i * lh + sizePx * 0.8).toFixed(2)}">${esc(l) || ' '}</tspan>`).join('');
  return `<text font-family="${esc(font)}" font-size="${sizePx.toFixed(2)}" font-weight="${p.weight}" fill="${p.color}"`
    + `${p.tracking ? ` letter-spacing="${(p.tracking * sizePx).toFixed(2)}"` : ''}${p.align === 'center' ? ' text-anchor="middle"' : ''} xml:space="preserve">${tspans}</text>`;
}

/**
 * @param href maps an image prim to the URL to embed (thumbnail for preview, data URI for export).
 */
export function slideSvg(d: SlideDrawing, cfg: DrawConfig, href: (p: Extract<Prim, { kind: 'image' }>) => string | undefined, opts: { idPrefix?: string } = {}) {
  const W = n(cfg.slideW), H = n(cfg.slideH);
  const pre = opts.idPrefix ?? 's';
  const body = d.prims.map((p, i) => {
    if (p.kind === 'rect') return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${p.fill}"/>`;
    if (p.kind === 'text') return textSvg(p, cfg.font);
    const url = href(p);
    if (!url) return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="#808080" opacity="0.25"/>`;
    const par = p.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
    return `<clipPath id="${pre}c${i}"><rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"/></clipPath>`
      + `<image clip-path="url(#${pre}c${i})" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="${par}" href="${esc(url)}" xlink:href="${esc(url)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="${d.bg}"/>${body}</svg>`;
}
