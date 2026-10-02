/* Tracing off the main thread. One color: Potrace (WebAssembly) on a thresholded bitmap. Many
   colors: ImageTracer with a palette chosen in OKLab by the tool. */
import { init, potrace } from 'esm-potrace-wasm';
import ImageTracer from 'imagetracerjs';

export type TraceJob =
  | { id: number; kind: 'mono'; image: ImageData; turdsize: number; alphamax: number; opttolerance: number; turnpolicy: number }
  | { id: number; kind: 'multi'; image: ImageData; pal: { r: number; g: number; b: number; a: number }[]; ltres: number; qtres: number; pathomit: number; blurradius: number; rightangleenhance: boolean };
export interface TraceReply { id: number; svg?: string; ms?: number; error?: string }

let ready: Promise<void> | null = null;

self.onmessage = async (e: MessageEvent<TraceJob>) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    let svg: string;
    if (job.kind === 'mono') {
      ready ??= init();
      await ready;
      svg = await potrace(job.image, { turdsize: job.turdsize, alphamax: job.alphamax, opttolerance: job.opttolerance, turnpolicy: job.turnpolicy, opticurve: 1, extractcolors: false, posterizelevel: 1, pathonly: false });
    } else {
      svg = ImageTracer.imagedataToSVG(job.image, {
        pal: job.pal, colorquantcycles: 1, ltres: job.ltres, qtres: job.qtres, pathomit: job.pathomit,
        blurradius: job.blurradius, rightangleenhance: job.rightangleenhance, strokewidth: 0, roundcoords: 1, viewbox: true, linefilter: false,
      });
    }
    (self as unknown as Worker).postMessage({ id: job.id, svg, ms: Math.round(performance.now() - t0) } satisfies TraceReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) } satisfies TraceReply);
  }
};
