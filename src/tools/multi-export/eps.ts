/* tokens-exempt: writes PostScript/EPS file content, not Lathe's interface.

   EPS writers, ported from reference/multi-export. The PostScript output shape is the original's.
   Fixes from VERIFY.md (milestone 0), each covered by a Ghostscript probe in verify/port.mjs:
   1. fill="none" no longer falls back to a black fill.
   2. fill-rule="evenodd" writes `eofill` instead of `fill`.
   3. Transforms are honoured: shapes are measured in the live DOM and written with their CTM.
   4. Fills/strokes come from computed style, so CSS classes and <style> rules apply.
   5. rect rx/ry are drawn with arcs, and arc commands become Béziers instead of straight lines.
   6. SVGs the vector writer cannot represent faithfully (text, images, gradients, masks, filters,
      <use>) return null so the caller writes a raster EPS of the rendered artwork instead.
   Line caps and joins now follow the SVG (the original forced round). */

import { CmykJpeg } from './cmyk-jpeg.js';

export type RGBf = [number, number, number];
const ps = (n: number) => Math.round(n * 1000) / 1000;

export function parseColorToPS(col: string | null | undefined): RGBf | null {
  if (col == null) return null;
  col = String(col).trim();
  if (col === 'none' || col === 'transparent' || col === '') return null;
  let m = col.match(/^#([0-9a-f]{3})$/i);
  if (m) { const s = m[1]; return [parseInt(s[0] + s[0], 16) / 255, parseInt(s[1] + s[1], 16) / 255, parseInt(s[2] + s[2], 16) / 255]; }
  m = col.match(/^#([0-9a-f]{6})$/i);
  if (m) { const s = m[1]; return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255]; }
  m = col.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(s => parseFloat(s));
    if (p.length >= 4 && p[3] === 0) return null; // fully transparent
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255];
  }
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d')!;
    x.fillStyle = '#000'; x.fillStyle = col; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data; return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { return null; }
}

export function toGrayPS(rgb: RGBf | null, w: number[]): RGBf | null {
  if (!rgb) return null; const l = w[0] * rgb[0] + w[1] * rgb[1] + w[2] * rgb[2]; return [l, l, l];
}
export function rgbToCmyk(rgb: RGBf): [number, number, number, number] {
  const r = rgb[0], g = rgb[1], b = rgb[2];
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

/* SVG arc → cubic Béziers (SVG 1.1 implementation notes, F.6.5/F.6.6). */
function arcToBeziers(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): number[][] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = phiDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) coef = -coef;
  const cxp = coef * (rx * y1p / ry), cyp = coef * (-ry * x1p / rx);
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const d = dt / segs, k = 4 / 3 * Math.tan(d / 4);
  const out: number[][] = [];
  let t = t1;
  const pt = (a: number) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  const der = (a: number) => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
  for (let i = 0; i < segs; i++) {
    const a1 = t, a2 = t + d;
    const p1 = pt(a1), p2 = pt(a2), d1 = der(a1), d2 = der(a2);
    out.push([p1[0] + k * d1[0], p1[1] + k * d1[1], p2[0] - k * d2[0], p2[1] - k * d2[1], p2[0], p2[1]]);
    t = a2;
  }
  return out;
}

export function pathDataToPS(d: string): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return '';
  let i = 0, cmd = '', out = '';
  let cx = 0, cy = 0, sx = 0, sy = 0, px = 0, py = 0, prevCmd = '';
  const num = () => parseFloat(tokens[i++]);
  const isCmd = (t: string) => /^[a-zA-Z]$/.test(t);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) { cmd = tokens[i++]; }
    const abs = cmd === cmd.toUpperCase(); const C = cmd.toUpperCase();
    if (C === 'M') {
      let x = num(), y = num(); if (!abs) { x += cx; y += cy; }
      cx = x; cy = y; sx = x; sy = y; out += `${ps(x)} ${ps(y)} moveto\n`;
      cmd = abs ? 'L' : 'l';
    } else if (C === 'L') {
      let x = num(), y = num(); if (!abs) { x += cx; y += cy; } cx = x; cy = y; out += `${ps(x)} ${ps(y)} lineto\n`;
    } else if (C === 'H') {
      let x = num(); if (!abs) x += cx; cx = x; out += `${ps(x)} ${ps(cy)} lineto\n`;
    } else if (C === 'V') {
      let y = num(); if (!abs) y += cy; cy = y; out += `${ps(cx)} ${ps(y)} lineto\n`;
    } else if (C === 'C') {
      let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      if (!abs) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
      out += `${ps(x1)} ${ps(y1)} ${ps(x2)} ${ps(y2)} ${ps(x)} ${ps(y)} curveto\n`;
      px = x2; py = y2; cx = x; cy = y;
    } else if (C === 'S') {
      let x2 = num(), y2 = num(), x = num(), y = num();
      if (!abs) { x2 += cx; y2 += cy; x += cx; y += cy; }
      let x1 = cx, y1 = cy; if (prevCmd && 'CS'.includes(prevCmd.toUpperCase())) { x1 = 2 * cx - px; y1 = 2 * cy - py; }
      out += `${ps(x1)} ${ps(y1)} ${ps(x2)} ${ps(y2)} ${ps(x)} ${ps(y)} curveto\n`;
      px = x2; py = y2; cx = x; cy = y;
    } else if (C === 'Q') {
      let qx = num(), qy = num(), x = num(), y = num();
      if (!abs) { qx += cx; qy += cy; x += cx; y += cy; }
      const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy), x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
      out += `${ps(x1)} ${ps(y1)} ${ps(x2)} ${ps(y2)} ${ps(x)} ${ps(y)} curveto\n`;
      px = qx; py = qy; cx = x; cy = y;
    } else if (C === 'T') {
      let x = num(), y = num(); if (!abs) { x += cx; y += cy; }
      let qx = cx, qy = cy; if (prevCmd && 'QT'.includes(prevCmd.toUpperCase())) { qx = 2 * cx - px; qy = 2 * cy - py; }
      const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy), x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
      out += `${ps(x1)} ${ps(y1)} ${ps(x2)} ${ps(y2)} ${ps(x)} ${ps(y)} curveto\n`;
      px = qx; py = qy; cx = x; cy = y;
    } else if (C === 'A') {
      // Fix 5: arcs become curves (the original drew a straight line to the end point).
      const rx = num(), ry = num(), rot = num(), laf = num(), sf = num();
      let x = num(), y = num(); if (!abs) { x += cx; y += cy; }
      for (const b of arcToBeziers(cx, cy, rx, ry, rot, laf, sf, x, y)) out += `${b.map(ps).join(' ')} curveto\n`;
      cx = x; cy = y;
    } else if (C === 'Z') {
      out += `closepath\n`; cx = sx; cy = sy;
    } else { i++; }
    prevCmd = cmd;
  }
  return out;
}

function shapeToPathD(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const n = (a: string) => parseFloat(el.getAttribute(a) || '0') || 0;
  if (tag === 'rect') {
    const x = n('x'), y = n('y'), w = n('width'), h = n('height');
    // Fix 5: rounded corners (SVG rules: a missing rx/ry takes the other; both clamp to half size).
    let rx = el.hasAttribute('rx') ? n('rx') : NaN, ry = el.hasAttribute('ry') ? n('ry') : NaN;
    if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry; if (isNaN(ry)) ry = rx;
    rx = Math.min(Math.abs(rx), w / 2); ry = Math.min(Math.abs(ry), h / 2);
    if (!rx || !ry) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
    return `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
  }
  if (tag === 'line') return `M${n('x1')} ${n('y1')} L${n('x2')} ${n('y2')}`;
  if (tag === 'polyline' || tag === 'polygon') {
    const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
    let d = ''; for (let i = 0; i + 1 < pts.length; i += 2) d += (i === 0 ? 'M' : 'L') + pts[i] + ' ' + pts[i + 1] + ' ';
    if (tag === 'polygon') d += 'Z'; return d;
  }
  if (tag === 'circle') {
    const cx = n('cx'), cy = n('cy'), r = n('r'); const k = 0.5522847498 * r;
    return `M${cx - r} ${cy} C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} Z`;
  }
  if (tag === 'ellipse') {
    const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry'); const kx = 0.5522847498 * rx, ky = 0.5522847498 * ry;
    return `M${cx - rx} ${cy} C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy} C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry} C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy} Z`;
  }
  if (tag === 'path') return el.getAttribute('d') || '';
  return '';
}

/** Features the vector writer cannot reproduce; the caller writes a raster EPS instead. */
const UNSUPPORTED = 'text, image, use, foreignObject, mask, filter, [mask], [filter], [clip-path]';
const NOT_RENDERED = 'defs, clipPath, mask, symbol, marker, pattern, linearGradient, radialGradient';
const CAP: Record<string, number> = { butt: 0, round: 1, square: 2 };
const JOIN: Record<string, number> = { miter: 0, round: 1, bevel: 2 };

export interface EpsOptions { gray: boolean; cmyk: boolean; grayWeights: number[]; creator: string }
export interface VectorEpsResult { blob: Blob | null; fallbackReason?: string }

export function epsFromSvg(svgText: string, o: EpsOptions): VectorEpsResult {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const src = doc.querySelector('svg');
  if (!src || doc.getElementsByTagName('parsererror').length) return { blob: null, fallbackReason: 'SVG could not be parsed' };
  const bad = src.querySelector(UNSUPPORTED);
  if (bad) return { blob: null, fallbackReason: `contains <${bad.tagName}>` };

  const vb = (src.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let W: number, H: number;
  if (vb.length === 4 && vb.every(Number.isFinite)) { W = vb[2]; H = vb[3]; }
  else { W = parseFloat(src.getAttribute('width') || '') || 300; H = parseFloat(src.getAttribute('height') || '') || 150; }

  // Fix 3/4: measure in the live DOM so transforms and CSS apply. Sizing the root to the
  // viewBox makes each CTM land in 0..W × 0..H user space.
  const host = document.createElement('div');
  // Off-screen and transparent, not visibility:hidden, which shapes would inherit and be skipped.
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  const svg = document.importNode(src, true) as unknown as SVGSVGElement;
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
  host.appendChild(svg); document.body.appendChild(host);

  try {
    const colorOp = (rgb: RGBf) => {
      if (o.cmyk) { const c = rgbToCmyk(rgb); return `${ps(c[0])} ${ps(c[1])} ${ps(c[2])} ${ps(c[3])} setcmykcolor`; }
      return `${ps(rgb[0])} ${ps(rgb[1])} ${ps(rgb[2])} setrgbcolor`;
    };
    let body = '';
    for (const el of Array.from(svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon'))) {
      if (el.closest(NOT_RENDERED)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (/url\(/.test(cs.fill) || /url\(/.test(cs.stroke)) return { blob: null, fallbackReason: 'uses a gradient or pattern paint' };
      const d = shapeToPathD(el); if (!d) continue;
      const psPath = pathDataToPS(d); if (!psPath.trim()) continue;
      let fill = parseColorToPS(cs.fill);                       // Fix 1 + 4
      let stroke = parseColorToPS(cs.stroke);
      const sw = parseFloat(cs.strokeWidth) || 0;
      if (o.gray) { fill = toGrayPS(fill, o.grayWeights); stroke = toGrayPS(stroke, o.grayWeights); }
      const m = (el as SVGGraphicsElement).getCTM();                // Fix 3
      const concat = m ? `[${[m.a, m.b, m.c, m.d, m.e, m.f].map(ps).join(' ')}] concat\n` : '';
      if (fill) body += `gsave\n${concat}${colorOp(fill)}\n${psPath}${cs.fillRule === 'evenodd' ? 'eofill' : 'fill'}\ngrestore\n`; // Fix 2
      if (stroke && sw > 0) {
        body += `gsave\n${concat}${colorOp(stroke)}\n${ps(sw)} setlinewidth\n${CAP[cs.strokeLinecap] ?? 0} setlinecap\n${JOIN[cs.strokeLinejoin] ?? 0} setlinejoin\n${ps(parseFloat(cs.strokeMiterlimit) || 4)} setmiterlimit\n${psPath}stroke\ngrestore\n`;
      }
    }
    const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: ${o.creator} (vector)
%%Title: ${o.cmyk ? 'vector EPS — CMYK (uncalibrated, see README)' : 'vector EPS — RGB'}
%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}
%%LanguageLevel: 2
%%DocumentProcessColors: ${o.cmyk ? 'Cyan Magenta Yellow Black' : '(RGB)'}
%%EndComments
gsave
0 ${ps(H)} translate
1 -1 scale
${body}grestore
showpage
%%EOF`;
    return { blob: new Blob([eps], { type: 'application/postscript' }) };
  } finally {
    host.remove();
  }
}

export function epsFromCanvas(cv: HTMLCanvasElement, cmyk: boolean, maxEdge: number, creator: string): Blob {
  let src = cv;
  if (Math.max(cv.width, cv.height) > maxEdge) {
    const s = maxEdge / Math.max(cv.width, cv.height);
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(cv.width * s); tmp.height = Math.round(cv.height * s);
    tmp.getContext('2d')!.drawImage(cv, 0, 0, tmp.width, tmp.height);
    src = tmp;
  }
  const w = src.width, h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const hx = (v: number) => v.toString(16).padStart(2, '0');
  const parts: string[] = [];
  if (cmyk) {
    /* colorimage keys the color space off the component count, so four channels of ink here
       is a genuine DeviceCMYK raster. */
    const ink = CmykJpeg.rgbaToCmyk(data);
    for (let i = 0; i < ink.length; i += 4) parts.push(hx(ink[i]) + hx(ink[i + 1]) + hx(ink[i + 2]) + hx(ink[i + 3]));
  } else {
    for (let i = 0; i < data.length; i += 4) parts.push(hx(data[i]) + hx(data[i + 1]) + hx(data[i + 2]));
  }
  const head = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: ${creator} (embedded raster)
%%Title: raster EPS — ${cmyk ? 'CMYK (uncalibrated, see README)' : 'RGB'}
%%BoundingBox: 0 0 ${w} ${h}
%%LanguageLevel: 2
%%DocumentProcessColors: ${cmyk ? 'Cyan Magenta Yellow Black' : '(RGB)'}
%%EndComments
gsave
${w} ${h} scale
${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}]
{<${parts.join('')}>} false ${cmyk ? 4 : 3} colorimage
grestore
showpage
%%EOF`;
  return new Blob([head], { type: 'application/postscript' });
}
