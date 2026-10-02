/* imagetracerjs ships CommonJS without types; only the parts Vectorize uses. */
declare module 'imagetracerjs' {
  interface RGBA { r: number; g: number; b: number; a: number }
  interface TracerOptions {
    ltres?: number; qtres?: number; pathomit?: number; rightangleenhance?: boolean;
    colorsampling?: number; numberofcolors?: number; colorquantcycles?: number; mincolorratio?: number;
    blurradius?: number; blurdelta?: number; strokewidth?: number; linefilter?: boolean;
    scale?: number; roundcoords?: number; viewbox?: boolean; desc?: boolean; lcpr?: number; qcpr?: number;
    pal?: RGBA[];
  }
  const ImageTracer: { imagedataToSVG(imgd: ImageData, options?: TracerOptions): string };
  export default ImageTracer;
}
