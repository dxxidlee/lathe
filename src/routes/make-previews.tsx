import { useEffect, useRef, useState } from 'react';
import { drawHalftone, halftone, hexToRgbTriple, type RGB } from '../tools/dither/engine';
import { cycle, drawFrame, layout, slots, type Easing, type Loop, type Spec } from '../tools/kinetic-type/motion';
import type { Script } from './make-scripts';

/* Previews for the scripted tools, built on Lathe's own engines: Dither's halftone, Grid's
   geometry, Kinetic-type's motion. The controls in the inspector drive them. */

const tok = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let photo: Promise<ImageData> | null = null;
/** The campaign photograph, at 720 px, as the sample image. */
function samplePhoto(): Promise<ImageData> {
  photo ??= (async () => {
    const img = new Image(); img.src = '/brand/hero-campaign.jpg'; await img.decode();
    const k = 720 / Math.max(img.naturalWidth, img.naturalHeight);
    const c = new OffscreenCanvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0, c.width, c.height);
    return x.getImageData(0, 0, c.width, c.height);
  })();
  return photo;
}

export function HalftonePreview({ v }: { v: Record<string, unknown> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState<ImageData | null>(null);
  useEffect(() => { void samplePhoto().then(setSrc); }, []);
  useEffect(() => {
    const cv = ref.current; if (!cv || !src) return;
    cv.width = src.width * 2; cv.height = src.height * 2;
    const ht = halftone(src, { method: 'dots', cell: Number(v.cell) / 2, angle: Number(v.angle), threshold: 0.5, gain: 1.1 });
    drawHalftone(cv.getContext('2d')!, ht, 2, hexToRgbTriple(String(v.ink)) ?? [0, 0, 0] as RGB, hexToRgbTriple(String(v.paper)) ?? [255, 255, 255] as RGB);
  }, [src, v.cell, v.angle, v.ink, v.paper]);
  return <canvas ref={ref} className="mk-canvas" aria-label="Halftone poster preview of the campaign photograph" />;
}

/** A 420 × 297 mm spread with the grid and placeholder copy laid on it. */
export function GridPreview({ v }: { v: Record<string, unknown> }) {
  const W = 420, H = 297, cols = Number(v.cols), g = Number(v.gutter), m = Number(v.margin), base = Number(v.baseline);
  const colW = (W - 2 * m - (cols - 1) * g) / cols, x = (i: number) => m + i * (colW + g);
  const span = (a: number, b: number) => x(Math.min(b, cols) - 1) + colW - x(a);
  const lines: number[] = []; for (let y = m; y <= H - m; y += base) lines.push(y);
  const red = '#FF0000'; // tokens-allow: the conventional layout-grid red
  const text = Math.max(1, Math.floor(cols / 4));
  return (
    <svg className="mk-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${cols}-column editorial spread grid`}>
      <rect width={W} height={H} fill={tok('--white')} />
      <g fill={red} fillOpacity={0.1}>{Array.from({ length: cols }, (_, i) => <rect key={i} x={x(i)} y={m} width={colW} height={H - 2 * m} />)}</g>
      <g stroke={red} strokeOpacity={0.3} strokeWidth={0.15}>{lines.map(y => <line key={y} x1={m} x2={W - m} y1={y} y2={y} />)}</g>
      {v.fold !== false && <line x1={W / 2} x2={W / 2} y1={0} y2={H} stroke={tok('--black')} strokeOpacity={0.4} strokeWidth={0.3} strokeDasharray="2 2" />}
      {/* placeholder layout: a headline, an image and body text snapped to the columns and baseline */}
      <rect x={x(0)} y={m} width={span(0, Math.ceil(cols * 0.6))} height={base * 5} fill={tok('--black')} />
      <rect x={x(Math.ceil(cols / 2))} y={m + base * 8} width={span(Math.ceil(cols / 2), cols)} height={base * 24} fill={tok('--black')} fillOpacity={0.16} />
      {Array.from({ length: Math.min(3, cols) }, (_, c) => (
        <g key={c} fill={tok('--black')} fillOpacity={0.55}>
          {Array.from({ length: 30 }, (_, r) => (
            <rect key={r} x={x(c * text)} y={m + base * (8 + r) + base * 0.35} width={span(c * text, c * text + text) * (r % 7 === 6 ? 0.6 : 1)} height={base * 0.45} />
          ))}
        </g>
      ))}
    </svg>
  );
}

export function FallingPreview({ v }: { v: Record<string, unknown> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const s: Spec = {
      text: String(v.text || 'Lathe'), font: tok('--font') || 'Helvetica Neue, Helvetica, Arial, sans-serif', weight: 500, size: 300, tracking: -0.04, leading: 1,
      ink: tok('--black'), paper: tok('--lathe'), w: 1600, h: 900,
      preset: 'fall', duration: Number(v.duration), stagger: Number(v.stagger), hold: 0.8, easing: v.easing as Easing, loop: v.loop as Loop,
    };
    cv.width = s.w; cv.height = s.h;
    const ctx = cv.getContext('2d')!;
    const letters = layout(ctx, s), c = cycle(s, slots(letters));
    let raf = 0; const t0 = performance.now();
    const tick = () => { const t = ((performance.now() - t0) / 1000) % c; drawFrame(ctx, s, letters, t, Math.floor(t * 30)); raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [v.text, v.duration, v.stagger, v.easing, v.loop]);
  return <canvas ref={ref} className="mk-canvas" aria-label="Logo letters falling into place" />;
}

/** For prompts without a scripted tool: the tool as a wiring sketch, unbuilt. */
export function SketchPreview({ script, prompt }: { script: Script; prompt: string }) {
  return (
    <div className="mk-sketch" aria-label="Sketch of the requested tool">
      <div className="mk-sketch__box">{script.inputs[0]}</div>
      <span className="mk-sketch__arrow">→</span>
      <div className="mk-sketch__box mk-sketch__box--tool"><b>{script.name}</b><span>“{prompt}”</span></div>
      <span className="mk-sketch__arrow">→</span>
      <div className="mk-sketch__box">{script.outputs[0]}</div>
    </div>
  );
}
