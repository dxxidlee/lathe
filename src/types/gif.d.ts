declare module 'gif.js' {
  interface GIFOptions { workers?: number; quality?: number; width?: number; height?: number; workerScript?: string; repeat?: number }
  export default class GIF {
    constructor(opts: GIFOptions);
    addFrame(image: CanvasImageSource | CanvasRenderingContext2D, opts?: { copy?: boolean; delay?: number }): void;
    on(event: 'progress', cb: (p: number) => void): void;
    on(event: 'finished', cb: (blob: Blob) => void): void;
    render(): void;
    abort(): void;
  }
}
