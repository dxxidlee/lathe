/* tokens-exempt: builds the exported SVG/HTML documents, whose internal styling is file
   content, not Lathe's interface.

   Color-check engine, ported from reference/color-check/index.html. The color math, grading,
   repair search and matrix/SVG/HTML builders are the original algorithms; constants that were
   decisions (thresholds, repair step, colors) now come from the defaults manifest. */

export type RGB = [number, number, number];
export type Standard = 'wcag' | 'apca';
export type Threshold = 'all' | 'AALarge' | 'AA' | 'AAA';

export interface Params {
  standard: Standard;
  wcag: { AAA: number; AA: number; AALarge: number };
  apca: { AAA: number; AA: number; AALarge: number };
  repairTarget: number;
  repairStep: number;
  repairMaxSteps: number;
  dimOpacity: number;
  grade: [string, string, string, string]; // tier 0..3 = Fail, AA Lg, AA, AAA
  exportStroke: string;
  exportLabel: string;
  fontStack: string;
  /** @font-face rule for an uploaded font, embedded in exports. */
  fontFaceCss: string;
}

/* ---------- Color math ---------- */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const rgbToHex = ([r, g, b]: RGB) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
export function relLum([r, g, b]: RGB) { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
export function wcagRatio(a: RGB, b: RGB) { const L1 = relLum(a), L2 = relLum(b); const lo = Math.min(L1, L2), hi = Math.max(L1, L2); return (hi + 0.05) / (lo + 0.05); }
export function apcaContrast(txt: RGB, bg: RGB) {
  const Y = (rgb: RGB) => { const lin = (c: number) => Math.pow(c / 255, 2.4); return 0.2126729 * lin(rgb[0]) + 0.7151522 * lin(rgb[1]) + 0.072175 * lin(rgb[2]); };
  let Yt = Y(txt), Yb = Y(bg); const bt = 0.022, bc = 1.414; const cb = (y: number) => y > bt ? y : y + Math.pow(bt - y, bc); Yt = cb(Yt); Yb = cb(Yb);
  if (Math.abs(Yb - Yt) < 0.0005) return 0; let o: number;
  if (Yb > Yt) { o = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14; o = o < 0.001 ? 0 : o - 0.027; }
  else { o = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14; o = o > -0.001 ? 0 : o + 0.027; }
  return o * 100;
}
/* OKLCH for repair */
function s2l(c: number) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function l2s(c: number) { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return clamp(v * 255, 0, 255); }
function rgbToOklch([r, g, b]: RGB) {
  const lr = s2l(r), lg = s2l(g), lb = s2l(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb, m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb, s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_, a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_, bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + bb * bb); let H = Math.atan2(bb, a) * 180 / Math.PI; if (H < 0) H += 360; return { L, C, H };
}
function oklchToRgb({ L, C, H }: { L: number; C: number; H: number }): RGB {
  const hr = H * Math.PI / 180, a = C * Math.cos(hr), bb = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb, m_ = L - 0.1055613458 * a - 0.0638541728 * bb, s_ = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [l2s(lr), l2s(lg), l2s(lb)];
}
export function repair(fixRgb: RGB, againstRgb: RGB, p: Params): string | null {
  const againstL = relLum(againstRgb); const base = rgbToOklch(fixRgb); const goDarker = relLum(fixRgb) < againstL;
  for (let i = 1; i <= p.repairMaxSteps; i++) {
    const L = goDarker ? base.L - i * p.repairStep : base.L + i * p.repairStep; if (L < 0 || L > 1) continue;
    const rgb = oklchToRgb({ L, C: base.C, H: base.H }).map(Math.round) as RGB;
    if (wcagRatio(rgb, againstRgb) >= p.repairTarget) return rgbToHex(rgb);
  }
  return null;
}
function rateWcag(r: number, t: Params['wcag']) { if (r >= t.AAA) return { grade: 'AAA', tier: 3 }; if (r >= t.AA) return { grade: 'AA', tier: 2 }; if (r >= t.AALarge) return { grade: 'AA Lg', tier: 1 }; return { grade: 'Fail', tier: 0 }; }
function rateApca(s: number, t: Params['apca']) { const a = Math.abs(s); if (a >= t.AAA) return { grade: 'AAA', tier: 3 }; if (a >= t.AA) return { grade: 'AA', tier: 2 }; if (a >= t.AALarge) return { grade: 'AA Lg', tier: 1 }; return { grade: 'Fail', tier: 0 }; }

export function parseColors(text: string): string[] {
  const found = text.match(/#?[0-9a-fA-F]{6}\b|#?[0-9a-fA-F]{3}\b/g) || []; const seen = new Set<string>(), out: string[] = [];
  for (const raw of found) { const hex = raw.startsWith('#') ? raw : '#' + raw; const rgb = hexToRgb(hex); if (!rgb) continue; const n = rgbToHex(rgb); if (!seen.has(n)) { seen.add(n); out.push(n); } } return out;
}

export interface Cell { grade: string; tier: number; value: string }
export function cellData(fgHex: string, bgHex: string, p: Params): Cell {
  const fg = hexToRgb(fgHex)!, bg = hexToRgb(bgHex)!;
  if (p.standard === 'wcag') { const r = wcagRatio(fg, bg); return { ...rateWcag(r, p.wcag), value: r.toFixed(2) }; }
  const s = apcaContrast(fg, bg); return { ...rateApca(s, p.apca), value: (s >= 0 ? '+' : '') + s.toFixed(0) };
}

export const minTierFor = (t: Threshold) => ({ all: 0, AALarge: 1, AA: 2, AAA: 3 })[t];

export function score(colors: string[], p: Params) {
  let total = 0, pass = 0, fail = 0;
  for (const fg of colors) for (const bg of colors) { if (fg === bg) continue; total++; const c = cellData(fg, bg, p); if (c.tier >= 2) pass++; else if (c.tier === 0) fail++; }
  return { total, pass, fail, large: total - pass - fail, usable: total ? Math.round(pass / total * 100) + '%' : '—' };
}

/* ---------- Matrix markup (shared by the stage and the .html export) ---------- */
export function matrixHtml(colors: string[], minTier: number, p: Params, interactive: boolean) {
  const cf = p.fontStack;
  let html = '<table class="matrix"><thead><tr><th class="corner"></th>';
  for (const c of colors) html += `<th class="head"><span class="swatch" style="background:${c}"></span>${c.slice(1)}</th>`;
  html += '</tr></thead><tbody>';
  for (const fg of colors) {
    html += `<tr><th class="head" style="text-align:left"><span class="swatch" style="background:${fg}"></span>${fg.slice(1)}</th>`;
    for (const bg of colors) {
      if (fg === bg) { html += '<td class="diag"></td>'; continue; }
      const c = cellData(fg, bg, p); const dim = c.tier < minTier; const clickable = interactive && c.tier < 2;
      html += `<td class="cell${clickable ? ' is-repairable' : ''}" style="background:${bg};color:${fg};opacity:${dim ? p.dimOpacity : 1}"
             ${clickable ? `data-fg="${fg}" data-bg="${bg}" tabindex="0"` : ''} title="fg ${fg} on bg ${bg} — ${c.grade}">
             <span class="val" style="font-family:${cf}">${c.value}</span>
             <span class="grade" style="font-family:${cf}">${c.grade}</span>
             <span class="tier" style="background:${p.grade[c.tier]}"></span></td>`;
    }
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

/* ---------- SVG export ---------- */
function svgEscape(s: string) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* Geometry mirrors the matrix table, so the exported matrix is the same drawing as the stage. */
const MX = { fs: 13, padX: 2.5, padY: 3, line: 15, gradeGap: 1, swatch: 6.5, swatchGap: 2, minCell: 28, tier: 2.5, tierInset: 1.5 };

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, weight: number, size: number, stack: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${weight} ${size}px ${stack}`;
  return measureCtx.measureText(String(text)).width;
}

export function buildSvg(colors: string[], threshold: Threshold, p: Params): string {
  const minTier = minTierFor(threshold);
  const cf = p.fontStack;
  const headH = MX.padY * 2 + MX.line;
  const rowH = MX.padY * 2 + MX.line * 2 + MX.gradeGap;
  const baseline = (top: number) => top + MX.line / 2 + MX.fs * 0.36;

  let content = MX.minCell - MX.padX * 2;
  colors.forEach(c => { content = Math.max(content, MX.swatch + MX.swatchGap + measure(c.slice(1), 400, MX.fs, cf)); });
  colors.forEach(fg => colors.forEach(bg => {
    if (fg === bg) return;
    const c = cellData(fg, bg, p);
    content = Math.max(content, measure(c.value, 600, MX.fs, cf), measure(c.grade, 400, MX.fs, cf));
  }));
  const cw = Math.ceil(content + MX.padX * 2);
  const W = cw * (colors.length + 1) + 1, H = headH + colors.length * rowH + 1;

  const box = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w}" height="${h}" fill="${fill}" stroke="${p.exportStroke}" stroke-width="1"/>`;
  const swatch = (x: number, y: number, fill: string) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${MX.swatch - 1}" height="${MX.swatch - 1}" rx="0.5" fill="${fill}" stroke="${p.exportStroke}" stroke-width="1"/>`;
  const label = (x: number, y: number, text: string, anchor?: string) => `<text x="${x}" y="${y}" font-family="${cf}" font-size="${MX.fs}" font-weight="400" letter-spacing="-1" ${anchor ? `text-anchor="${anchor}" ` : ''}fill="${p.exportLabel}">${svgEscape(text)}</text>`;

  let g = '<g id="col-headers">';
  g += box(0, 0, cw, headH, '#FFFFFF');
  colors.forEach((c, j) => {
    const cx = cw + j * cw, text = c.slice(1);
    const sx = cx + (cw - (MX.swatch + MX.swatchGap + measure(text, 400, MX.fs, cf))) / 2;
    g += box(cx, 0, cw, headH, '#FFFFFF');
    g += swatch(sx, (headH - MX.swatch) / 2, c);
    g += label(sx + MX.swatch + MX.swatchGap, baseline(MX.padY), text);
  });
  g += '</g>';

  colors.forEach((fg, i) => {
    const cy = headH + i * rowH, text = fg.slice(1);
    g += `<g id="row-${i + 1}-${svgEscape(text)}">`;
    g += box(0, cy, cw, rowH, '#FFFFFF');
    g += swatch(MX.padX, cy + (rowH - MX.swatch) / 2, fg);
    g += label(MX.padX + MX.swatch + MX.swatchGap, cy + rowH / 2 + MX.fs * 0.36, text);
    colors.forEach((bg, j) => {
      const cx = cw + j * cw;
      if (fg === bg) { g += box(cx, cy, cw, rowH, '#FFFFFF'); return; }
      const c = cellData(fg, bg, p);
      g += `<g opacity="${c.tier < minTier ? p.dimOpacity : 1}">`;
      g += box(cx, cy, cw, rowH, bg);
      g += `<text x="${cx + cw / 2}" y="${baseline(cy + MX.padY)}" font-family="${cf}" font-size="${MX.fs}" font-weight="600" letter-spacing="-1" text-anchor="middle" fill="${fg}">${svgEscape(c.value)}</text>`;
      g += `<text x="${cx + cw / 2}" y="${baseline(cy + MX.padY + MX.line + MX.gradeGap)}" font-family="${cf}" font-size="${MX.fs}" font-weight="400" letter-spacing="-1" text-anchor="middle" fill="${fg}">${svgEscape(c.grade)}</text>`;
      g += `<rect x="${cx + cw - MX.tierInset - MX.tier}" y="${cy + MX.tierInset}" width="${MX.tier}" height="${MX.tier}" rx="0.5" fill="${p.grade[c.tier]}"/>`;
      g += '</g>';
    });
    g += '</g>';
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><style>${p.fontFaceCss} text{font-family:${cf}}</style></defs>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${g}
</svg>`;
}

/* ---------- HTML export ---------- */
function matrixCss(p: Params) {
  return `
body{ margin:0; padding:20px; background:#fff; color:#333; font-family:${p.fontStack}; font-size:15px; letter-spacing:-1px; }
.stats{ display:flex; flex-direction:column; gap:2px; max-width:280px; margin:0 0 20px; color:${p.exportLabel}; line-height:1.2; }
.stat{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; }
.stat .v{ color:#757575; }
.matrixWrap{ overflow:auto; border:2px solid #F4F4F4; border-radius:10px; padding:10px; box-sizing:border-box; }
table.matrix{ border-collapse:collapse; font-family:inherit; width:100%; }
table.matrix th, table.matrix td{ border:1px solid ${p.exportStroke}; padding:${MX.padY}px ${MX.padX}px; text-align:center; font-weight:400; font-size:12.5px; white-space:nowrap; letter-spacing:-1px; }
table.matrix th.corner{ text-align:left; min-width:26px; line-height:1.15; color:${p.exportLabel}; font-weight:400; }
table.matrix th.head{ font-size:${MX.fs}px; font-weight:400; color:${p.exportLabel}; }
table.matrix th .swatch{ display:inline-block; width:4.5px; height:4.5px; border:1px solid ${p.exportStroke}; vertical-align:middle; margin-right:${MX.swatchGap}px; border-radius:0.5px; }
table.matrix td.cell{ position:relative; min-width:${MX.minCell}px; }
table.matrix td.cell .val{ display:block; font-weight:600; font-size:${MX.fs}px; line-height:1.15; }
table.matrix td.cell .grade{ display:block; font-weight:400; font-size:${MX.fs}px; margin-top:${MX.gradeGap}px; }
table.matrix td.cell .tier{ position:absolute; top:${MX.tierInset}px; right:${MX.tierInset}px; width:${MX.tier}px; height:${MX.tier}px; border-radius:0.5px; }
table.matrix td.diag{ background:transparent; }
`;
}

export function buildReport(colors: string[], threshold: Threshold, p: Params): string {
  const s = score(colors, p);
  const stat = (k: string, v: string | number) => `<div class="stat"><span>${k}</span><span class="v">${v}</span></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Color-check</title>
<meta name="generator" content="Lathe Color-check">
<style>${p.fontFaceCss}${matrixCss(p)}</style></head>
<body>
<div class="stats">${stat('Pass', s.pass)}${stat('Large only', s.large)}${stat('Fail', s.fail)}${stat('Usable', s.usable)}</div>
<div class="matrixWrap">${matrixHtml(colors, minTierFor(threshold), p, false)}</div>
</body></html>`;
}

/** @font-face rule for an uploaded chart font (descriptor, not UI styling). */
export const fontFaceRule = (family: string, dataUrl: string, format: string) =>
  `@font-face{font-family:'${family}';src:url('${dataUrl}') format('${format}');font-weight:100 900;font-display:swap;}`;
