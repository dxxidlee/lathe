/* tokens-exempt: paints gradient artwork (content colors), not Lathe's interface.

   Mesh-gradient engine, ported from reference/mesh-gradient/index.html. Layout, base render,
   blur, grain, hit-testing and hue cycling are the original algorithms. The only mechanical
   change: values the original read from DOM inputs ($('den').value…) come from `ctl`.
   Families are Conic, Field and Sphere (renamed from the reference; see VERIFY.md).
   Fix: mix() parses 6-digit hex only, so the original's mix(c,'#fff') blended toward #000FFF
   (a blue cast in sphere/orbit highlights); white and black are now written in full. */

export type FamKey = 'conic' | 'field' | 'sphere';
export interface Stop { t: number; color: string }
export interface Controls { den: number; ang: number; soft: number; grain: number; drift: number; cyc: number }
export interface MeshState {
  fam: FamKey; variant: string; palette: string; seed: number;
  base: Stop[]; elems: Record<number, Stop[]>; selEl: number | null;
  ratio: string; cx: number; cy: number;
}
export interface Phase { t: number; on: boolean; frame: number }
export interface FamilyDef { label: string; vars: string[]; blur: Record<string, number>; ctrl: Record<string, 'center' | 'dir' | 'none'> }

export const FAMILIES: Record<FamKey, FamilyDef> = {
  conic: { label: 'Conic', vars: ['conic', 'sweep', 'radial', 'bloom'], blur: { conic: 1.0, sweep: 1.3, radial: 1.0, bloom: 1.8 },
    ctrl: { conic: 'center', sweep: 'center', radial: 'center', bloom: 'center' } },
  field: { label: 'Field', vars: ['horizon', 'columns', 'stripes', 'weave'], blur: { horizon: .9, columns: .5, stripes: .7, weave: .5 },
    ctrl: { horizon: 'dir', columns: 'dir', stripes: 'dir', weave: 'center' } },
  sphere: { label: 'Sphere', vars: ['spheres', 'aura', 'mesh', 'orbit'], blur: { spheres: .14, aura: 1.5, mesh: 2.6, orbit: .9 },
    ctrl: { spheres: 'none', aura: 'none', mesh: 'none', orbit: 'center' } },
};
export const ELEMENTAL = ['spheres', 'aura', 'mesh', 'orbit', 'radial', 'bloom', 'columns', 'stripes', 'weave'];
export const RATIOS = ['16:9', '4:5', '1:1', '9:16', '4:3', '3:2'];
export const ratioN = (r: string) => { const [a, b] = r.split(':').map(Number); return a / b; };

/* ---------- helpers ---------- */
export const cl = (v: number, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const cl255 = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
export function mulberry32(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hexToRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 }; };
const rgbToHex = (r: number, g: number, b: number) => '#' + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
const mix = (a: string, b: string, t: number) => { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t); };
const hexA = (h: string, a: number) => { const { r, g, b } = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };
export const mkStops = (cols: string[]): Stop[] => cols.map((c, i) => ({ t: i / (cols.length - 1), color: c }));
export const clone = (st: Stop[]) => st.map(s => ({ ...s }));
function rgbToHsv(r: number, g: number, b: number) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return { h, s: mx ? d / mx : 0, v: mx }; }
function hsvToRgb(h: number, s: number, v: number) { h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; let r, g, b; if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]; return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }; }
function hueShift(hex: string, deg: number) { const { r, g, b } = hexToRgb(hex); const hsv = rgbToHsv(r, g, b); const o = hsvToRgb(hsv.h + deg, hsv.s, hsv.v); return rgbToHex(o.r, o.g, o.b); }

export type Element =
  | { kind: 'circle'; i: number; cx: number; cy: number; r: number }
  | { kind: 'rect'; i: number; x: number; y: number; w: number; h: number; horiz?: boolean }
  | { kind: 'band' | 'ringr'; i: number };

export function createEngine(S: MeshState, ctl: Controls, PH: Phase) {
  const effAngle = () => ctl.ang * Math.PI / 180;
  function effC(W: number, H: number) {
    const d = ctl.drift / 100 * .12;
    return { cx: (S.cx + d * Math.cos(PH.t * 2 * Math.PI)) * W, cy: (S.cy + d * Math.sin(PH.t * 2 * Math.PI)) * H };
  }
  function shifted(st: Stop[]) {
    const deg = PH.t * 360 * ctl.cyc;
    return deg ? st.map(o => ({ t: o.t, color: hueShift(o.color, deg) })) : st;
  }

  /* ---------- ramp sampling ---------- */
  const sortSt = (a: Stop[]) => [...a].sort((x, y) => x.t - y.t);
  function sampleStops(st: Stop[], t: number) {
    st = shifted(st); const s = sortSt(st); t = cl(t);
    if (t <= s[0].t) return s[0].color; if (t >= s[s.length - 1].t) return s[s.length - 1].color;
    let i = 0; while (i < s.length - 1 && s[i + 1].t < t) i++;
    const l = (t - s[i].t) / (s[i + 1].t - s[i].t || 1); return mix(s[i].color, s[i + 1].color, l);
  }
  function rampSeg(gr: CanvasGradient, st: Stop[], a = 0, b = 1) { sortSt(shifted(st)).forEach(o => gr.addColorStop(cl(a + (b - a) * o.t), o.color)); }
  const rampFor = (i: number) => S.elems[i] || S.base;
  const hasOv = (i: number) => !!S.elems[i];

  /* ---------- element layout ---------- */
  function layout(W: number, H: number): Element[] {
    const v = S.variant, out: Element[] = [], rng = mulberry32(S.seed * 2654435761 >>> 0);
    const den = ctl.den, { cx, cy } = effC(W, H);
    if (v === 'spheres') {
      const N = 2 + Math.round(den), r = W / N / 2 * .99, rows = Math.ceil(H / (r * 2)) + 1;
      for (let row = 0; row < rows; row++) for (let i = 0; i < N + 1; i++) out.push({ kind: 'circle', i: row * (N + 1) + i, cx: i * r * 2, cy: row * r * 2 * .99 + r, r });
    } else if (v === 'aura') {
      const cX = 2 + Math.round(den * .9), r = W / cX * .62, cY = Math.ceil(H / (r * 1.5)) + 1;
      for (let row = 0; row < cY; row++) for (let col = 0; col < cX; col++)
        out.push({ kind: 'circle', i: row * cX + col, cx: (col + .5) * (W / cX) + (row % 2 ? W / cX / 2 : 0), cy: H - row * r * 1.5 - r * .2, r });
    } else if (v === 'mesh') {
      const N = Math.round(den * 4);
      for (let i = 0; i < N; i++) { const x = rng() * W, y = rng() * H, r = W * (.22 + rng() * .28); out.push({ kind: 'circle', i, cx: x, cy: y, r: r * .55 }); }
    } else if (v === 'orbit') {
      const N = Math.round(3 + den * 1.5), R = Math.hypot(W, H) * .42;
      for (let i = N; i > 0; i--) { const f = i / N; out.push({ kind: 'circle', i, cx, cy, r: R * f }); }
    } else if (v === 'columns') {
      const N = Math.round(3 + den * 1.3), bw = W / N;
      for (let i = 0; i < N; i++) out.push({ kind: 'rect', i, x: i * bw, y: 0, w: bw, h: H });
    } else if (v === 'weave') {
      const N = Math.round(2 + den), tile = W / N, rows = Math.ceil(H / tile) + 1;
      for (let r = 0; r < rows; r++) for (let c = -1; c <= N; c++)
        out.push({ kind: 'rect', i: r * (N + 2) + (c + 1), x: c * tile + (r % 2 ? tile / 2 : 0), y: r * tile, w: tile, h: tile, horiz: (r + c) % 2 === 0 });
    } else if (v === 'stripes') { const D = Math.round(den); for (let k = 0; k < D; k++) out.push({ kind: 'band', i: k }); }
    else if (v === 'radial') { const D = Math.round(den); for (let k = 0; k < D; k++) out.push({ kind: 'ringr', i: k }); }
    else if (v === 'bloom') {
      const N = Math.round(den * 2);
      for (let i = 0; i < N; i++) {
        const ang = i / N * Math.PI * 2, rad = Math.hypot(W, H) * (.18 + rng() * .22);
        out.push({ kind: 'circle', i, cx: cx + Math.cos(ang) * W * .28, cy: cy + Math.sin(ang) * H * .28, r: rad * .5 });
      }
    }
    return out;
  }

  /* ---------- base render ---------- */
  const buf = document.createElement('canvas'), bx = buf.getContext('2d', { willReadFrequently: true })!;

  function drawBase(b: CanvasRenderingContext2D, W: number, H: number) {
    const v = S.variant, rng = mulberry32(S.seed * 2654435761 >>> 0);
    const den = ctl.den, a = effAngle(), { cx, cy } = effC(W, H);
    b.clearRect(0, 0, W, H);

    if (v === 'spheres') {
      const bg = sampleStops(S.base, .5), w = b.createLinearGradient(0, 0, 0, H);
      w.addColorStop(0, mix(bg, '#000000', .06)); w.addColorStop(1, mix(bg, '#ffffff', .06));
      b.fillStyle = w; b.fillRect(0, 0, W, H);
      const N = 2 + Math.round(den), r = W / N / 2 * .99, rows = Math.ceil(H / (r * 2)) + 1;
      for (let row = 0; row < rows; row++) for (let i = 0; i < N + 1; i++) {
        const idx = row * (N + 1) + i, st = rampFor(idx), x = i * r * 2, y = row * r * 2 * .99 + r;
        const gr = b.createRadialGradient(x, y - r * .35, r * .12, x, y - r * .1, r * 1.15);
        gr.addColorStop(0, sampleStops(st, 0)); gr.addColorStop(.45, sampleStops(st, .45));
        gr.addColorStop(.9, sampleStops(st, .9)); gr.addColorStop(1, mix(sampleStops(st, .9), '#ffffff', .35));
        b.fillStyle = gr; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
      }
    } else if (v === 'aura') {
      const bg = b.createLinearGradient(0, 0, 0, H); rampSeg(bg, S.base); b.fillStyle = bg; b.fillRect(0, 0, W, H);
      const cX = 2 + Math.round(den * .9), r = W / cX * .62, cY = Math.ceil(H / (r * 1.5)) + 1;
      for (let row = 0; row < cY; row++) for (let col = 0; col < cX; col++) {
        const idx = row * cX + col, st = rampFor(idx);
        const orb = sampleStops(st, .55), hi = mix(orb, '#fff7ec', .55);
        const x = (col + .5) * (W / cX) + (row % 2 ? W / cX / 2 : 0), y = H - row * r * 1.5 - r * .2;
        const gr = b.createRadialGradient(x, y - r * .15, r * .05, x, y, r * 1.05);
        gr.addColorStop(0, hi); gr.addColorStop(.55, orb); gr.addColorStop(1, hexA(orb, 0));
        b.fillStyle = gr; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
      }
    } else if (v === 'mesh') {
      b.fillStyle = sampleStops(S.base, 0); b.fillRect(0, 0, W, H);
      const N = Math.round(den * 4);
      for (let i = 0; i < N; i++) {
        const x = rng() * W, y = rng() * H, r = W * (.22 + rng() * .28), st = rampFor(i);
        const c = hasOv(i) ? sampleStops(st, .5) : sampleStops(st, (i * 0.6180339887) % 1);
        const gr = b.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, hexA(c, .95)); gr.addColorStop(1, hexA(c, 0));
        b.fillStyle = gr; b.fillRect(0, 0, W, H);
      }
    } else if (v === 'orbit') {
      b.fillStyle = sampleStops(S.base, .15); b.fillRect(0, 0, W, H);
      const N = Math.round(3 + den * 1.5), R = Math.hypot(W, H) * .42;
      for (let i = N; i > 0; i--) {
        const f = i / N, r = R * f, st = rampFor(i);
        const x = cx + Math.cos(a) * W * .06 * (1 - f), y = cy + Math.sin(a) * H * .06 * (1 - f);
        const c = hasOv(i) ? sampleStops(st, .5) : sampleStops(st, 1 - f);
        const gr = b.createRadialGradient(x, y - r * .3, r * .05, x, y, r);
        gr.addColorStop(0, mix(c, '#ffffff', .3)); gr.addColorStop(.7, c); gr.addColorStop(1, hexA(c, 0));
        b.fillStyle = gr; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
      }
    } else if (v === 'conic') {
      const gr = b.createConicGradient(a, cx, cy); rampSeg(gr, S.base); b.fillStyle = gr; b.fillRect(0, 0, W, H);
    } else if (v === 'sweep') {
      const gr = b.createConicGradient(a, cx, cy), s = sortSt(shifted(S.base));
      s.forEach(o => gr.addColorStop(cl(o.t * .5), o.color));
      [...s].reverse().forEach(o => gr.addColorStop(cl(.5 + (1 - o.t) * .5), o.color));
      b.fillStyle = gr; b.fillRect(0, 0, W, H);
      const vg = b.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * .5);
      vg.addColorStop(0, hexA(sampleStops(S.base, .5), .5));
      vg.addColorStop(1, hexA(sampleStops(S.base, .5), 0));
      b.fillStyle = vg; b.fillRect(0, 0, W, H);
    } else if (v === 'radial') {
      const R = Math.hypot(W, H) * .72, D = Math.round(den);
      const gr = b.createRadialGradient(cx, cy, 0, cx, cy, R);
      for (let k = 0; k < D; k++) rampSeg(gr, rampFor(k), k / D, (k + 1) / D);
      b.fillStyle = gr; b.fillRect(0, 0, W, H);
    } else if (v === 'bloom') {
      b.fillStyle = sampleStops(S.base, 0); b.fillRect(0, 0, W, H);
      const N = Math.round(den * 2);
      for (let i = 0; i < N; i++) {
        const ang = a + i / N * Math.PI * 2, rad = Math.hypot(W, H) * (.18 + rng() * .22), st = rampFor(i);
        const x = cx + Math.cos(ang) * W * .28, y = cy + Math.sin(ang) * H * .28;
        const c = hasOv(i) ? sampleStops(st, .5) : sampleStops(st, i / N);
        const gr = b.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, hexA(c, .9)); gr.addColorStop(1, hexA(c, 0));
        b.fillStyle = gr; b.fillRect(0, 0, W, H);
      }
    } else if (v === 'horizon') {
      const L = Math.hypot(W, H);
      const gr = b.createLinearGradient(cx - Math.cos(a) * L / 2, cy - Math.sin(a) * L / 2, cx + Math.cos(a) * L / 2, cy + Math.sin(a) * L / 2);
      rampSeg(gr, S.base); b.fillStyle = gr; b.fillRect(0, 0, W, H);
    } else if (v === 'columns') {
      const N = Math.round(3 + den * 1.3), bw = W / N;
      for (let i = 0; i < N; i++) {
        const off = (rng() - .5) * H * .6;
        const gr = b.createLinearGradient(0, -off, 0, H - off); rampSeg(gr, rampFor(i));
        b.fillStyle = gr; b.fillRect(i * bw, -H, bw + 1, H * 3);
      }
    } else if (v === 'stripes') {
      const span = Math.hypot(W, H) * 1.15, D = Math.round(den);
      b.save(); b.translate(cx, cy); b.rotate(a);
      const gr = b.createLinearGradient(0, -span / 2, 0, span / 2);
      for (let k = 0; k < D; k++) rampSeg(gr, rampFor(k), k / D, (k + 1) / D);
      b.fillStyle = gr; b.fillRect(-span / 2, -span / 2, span, span); b.restore();
    } else if (v === 'weave') {
      const N = Math.round(2 + den), tile = W / N, rows = Math.ceil(H / tile) + 1;
      for (let r = 0; r < rows; r++) for (let c = -1; c <= N; c++) {
        const x = c * tile + (r % 2 ? tile / 2 : 0), y = r * tile, idx = r * (N + 2) + (c + 1), horiz = (r + c) % 2 === 0;
        const gr = horiz ? b.createLinearGradient(x, 0, x + tile, 0) : b.createLinearGradient(0, y, 0, y + tile);
        rampSeg(gr, rampFor(idx)); b.fillStyle = gr; b.fillRect(x, y, tile + 1, tile + 1);
      }
    }
  }

  /* ---------- gradient render: base -> blur -> grain ---------- */
  function renderGrad(target: HTMLCanvasElement, W: number, H: number, refW: number) {
    buf.width = W; buf.height = H; drawBase(bx, W, H);
    const t = target.getContext('2d', { willReadFrequently: true })!;
    target.width = W; target.height = H; t.clearRect(0, 0, W, H);
    const blur = (ctl.soft / 100) * refW * .04 * (FAMILIES[S.fam].blur[S.variant] || 1);
    t.filter = blur > .4 ? `blur(${blur}px)` : 'none';
    const ox = W * .06, oy = H * .06;
    t.drawImage(buf, -ox, -oy, W + ox * 2, H + oy * 2);
    t.filter = 'none';
    addGrain(t, W, H, refW);
  }
  function addGrain(c: CanvasRenderingContext2D, W: number, H: number, refW: number) {
    const G = ctl.grain; if (G <= 0) return;
    const img = c.getImageData(0, 0, W, H), d = img.data;
    const fseed = PH.on ? PH.frame : 0;
    const rng = mulberry32(((S.seed * 2654435761 >>> 0) ^ 0x9e3779b9) + fseed * 7919);
    const amt = (G / 100) * 95, cell = Math.max(1, Math.round(W / refW));
    if (cell === 1) {
      for (let i = 0; i < d.length; i += 4) {
        const n = (rng() - .5) * amt * 2;
        d[i] = cl255(d[i] + n); d[i + 1] = cl255(d[i + 1] + n); d[i + 2] = cl255(d[i + 2] + n);
      }
    } else {
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
        const n = (rng() - .5) * amt * 2;
        for (let dy = 0; dy < cell && y + dy < H; dy++) for (let dx = 0; dx < cell && x + dx < W; dx++) {
          const i = ((y + dy) * W + x + dx) * 4;
          d[i] = cl255(d[i] + n); d[i + 1] = cl255(d[i + 1] + n); d[i + 2] = cl255(d[i + 2] + n);
        }
      }
    }
    c.putImageData(img, 0, 0);
  }

  /* ---------- element hit-test ---------- */
  function hitTest(px: number, py: number, cw: number, ch: number): number | null {
    const v = S.variant, den = ctl.den;
    if (v === 'stripes') {
      const cx = S.cx * cw, cy = S.cy * ch, a = ctl.ang * Math.PI / 180;
      const dx = px - cx, dy = py - cy, ly = -dx * Math.sin(a) + dy * Math.cos(a);
      const span = Math.hypot(cw, ch) * 1.15, D = Math.round(den);
      return cl(Math.floor((ly + span / 2) / span * D), 0, D - 1);
    }
    if (v === 'radial') {
      const cx = S.cx * cw, cy = S.cy * ch, d = Math.hypot(px - cx, py - cy);
      const R = Math.hypot(cw, ch) * .72, D = Math.round(den);
      return cl(Math.floor(d / R * D), 0, D - 1);
    }
    let best: number | null = null, bd = 1e9;
    for (const e of layout(cw, ch)) {
      if (e.kind === 'circle') { const d = Math.hypot(px - e.cx, py - e.cy); if (d <= e.r && d < bd) { bd = d; best = e.i; } }
      else if (e.kind === 'rect') { if (px >= e.x && px <= e.x + e.w && py >= e.y && py <= e.y + e.h) { best = e.i; break; } }
    }
    return best;
  }

  return { layout, renderGrad, hitTest };
}
