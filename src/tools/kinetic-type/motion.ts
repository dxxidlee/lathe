/* Kinetic-type motion: a pure function of time. Text is laid out once (letters with their resting
   positions, kerning kept by measuring prefixes); each preset maps a letter's progress (0–1) to an
   offset, rotation, opacity or glyph. Frames are deterministic, so previews, GIFs and WebMs match. */

export type Preset = 'stagger' | 'fall' | 'drift' | 'scramble' | 'dissolve';
export type Easing = 'linear' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutBack' | 'easeOutBounce';
export type Loop = 'loop' | 'pingpong' | 'once';

export const EASE: Record<Easing, (t: number) => number> = {
  linear: t => t,
  easeOutCubic: t => 1 - (1 - t) ** 3,
  easeInOutCubic: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  easeOutBounce: t => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

export interface Spec {
  text: string; font: string; weight: number; size: number; tracking: number; leading: number;
  ink: string; paper: string; w: number; h: number;
  preset: Preset; duration: number; stagger: number; hold: number; easing: Easing; loop: Loop;
}
export interface Letter { ch: string; x: number; y: number; i: number }

/** Deterministic pseudo-random in [0, 1) from integers. */
export const hash = (...n: number[]) => { let h = 2166136261; for (const v of n) { h ^= v; h = Math.imul(h, 16777619); h ^= h >>> 13; } return ((h >>> 0) % 100000) / 100000; };

/** Lines wrapped to 86% of the canvas width, centred; letters placed by measuring prefixes. */
export function layout(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, s: Spec): Letter[] {
  ctx.font = `${s.weight} ${s.size}px ${s.font}`;
  (ctx as CanvasRenderingContext2D).letterSpacing = `${s.tracking * s.size}px`;
  const maxW = s.w * 0.86, words = s.text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const lh = s.size * s.leading, total = lh * lines.length;
  const out: Letter[] = []; let i = 0;
  lines.forEach((line, li) => {
    const lw = ctx.measureText(line).width, x0 = (s.w - lw) / 2;
    const y = (s.h - total) / 2 + lh * li + lh * 0.78;
    for (let k = 0; k < line.length; k++) {
      if (line[k] === ' ') { i++; continue; }
      out.push({ ch: line[k], x: x0 + ctx.measureText(line.slice(0, k)).width, y, i: i++ });
    }
  });
  return out;
}

/** Stagger slots: letters keep their index in the text (spaces included), so the last letter starts at slot n − 1. */
export const slots = (letters: Letter[]) => (letters.length ? letters[letters.length - 1].i + 1 : 0);

/** Seconds in one cycle (what a GIF or WebM records), for `letters` stagger slots. */
export function cycle(s: Spec, letters: number): number {
  const anim = s.duration + s.stagger * Math.max(0, letters - 1);
  return s.loop === 'pingpong' ? 2 * anim + 2 * s.hold : anim + s.hold;
}

/** Progress of the animation at time t in the cycle (0 → 1 → hold; ping-pong plays it back). */
function clock(s: Spec, t: number, letters: number) {
  const anim = s.duration + s.stagger * Math.max(0, letters - 1);
  if (s.loop === 'pingpong') { const half = anim + s.hold; return t < half ? Math.min(t, anim) : Math.max(0, anim - (t - half)); }
  return Math.min(t, anim);
}

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?';

export function drawFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, s: Spec, letters: Letter[], t: number, frame: number, scratch?: OffscreenCanvas) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.paper; ctx.fillRect(0, 0, s.w, s.h);
  ctx.font = `${s.weight} ${s.size}px ${s.font}`;
  (ctx as CanvasRenderingContext2D).letterSpacing = '0px'; // tokens-allow: canvas state, letters are placed individually
  ctx.fillStyle = s.ink; ctx.textBaseline = 'alphabetic';
  const n = slots(letters), now = clock(s, t, n), ease = EASE[s.easing];
  const prog = (l: Letter, order = l.i) => ease(Math.min(1, Math.max(0, (now - order * s.stagger) / s.duration)));

  if (s.preset === 'dissolve') {
    // The settled text, revealed cell by cell in a noise order as time passes.
    const sc = scratch ?? new OffscreenCanvas(s.w, s.h);
    const c2 = sc.getContext('2d')!; c2.clearRect(0, 0, s.w, s.h);
    c2.font = ctx.font; c2.fillStyle = s.ink;
    for (const l of letters) c2.fillText(l.ch, l.x, l.y);
    const cell = Math.max(4, Math.round(s.size / 16)), p = ease(Math.min(1, now / (s.duration + s.stagger * n * 0.5)));
    for (let y = 0; y < s.h; y += cell) for (let x = 0; x < s.w; x += cell) {
      if (hash(x / cell, y / cell) * 0.85 + (x / s.w) * 0.15 < p) ctx.drawImage(sc, x, y, cell, cell, x, y, cell, cell);
    }
    return;
  }
  for (const l of letters) {
    let p: number;
    if (s.preset === 'fall') {
      const order = Math.floor(hash(l.i, 7) * n);
      p = prog(l, order);
      const yOff = -(1 - p) * (l.y + s.size);
      ctx.globalAlpha = p > 0 ? 1 : 0;
      ctx.fillText(l.ch, l.x, l.y + yOff);
    } else if (s.preset === 'drift') {
      p = prog(l);
      const dx = (1 - p) * (hash(l.i, 3) - 0.5) * s.size * 3, dy = (1 - p) * (hash(l.i, 5) - 0.5) * s.size * 1.5, rot = (1 - p) * (hash(l.i, 9) - 0.5) * 1.2;
      ctx.globalAlpha = Math.min(1, p * 1.4);
      ctx.save(); ctx.translate(l.x + dx, l.y + dy); ctx.rotate(rot); ctx.fillText(l.ch, 0, 0); ctx.restore();
    } else if (s.preset === 'scramble') {
      p = Math.min(1, Math.max(0, (now - l.i * s.stagger) / s.duration));
      ctx.globalAlpha = p > 0 ? 1 : 0.18;
      const ch = p >= 1 ? l.ch : SCRAMBLE[Math.floor(hash(l.i, Math.floor(frame / 2)) * SCRAMBLE.length)];
      ctx.fillText(ch, l.x, l.y);
    } else { // stagger
      p = prog(l);
      ctx.globalAlpha = Math.min(1, p * 1.2);
      ctx.fillText(l.ch, l.x, l.y + (1 - p) * s.size * 0.6);
    }
  }
  ctx.globalAlpha = 1;
}
