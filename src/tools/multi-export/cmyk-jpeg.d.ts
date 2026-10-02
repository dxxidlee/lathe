export declare const CmykJpeg: {
  /** sRGB(A) bytes to C,M,Y,K ink coverage (0 = no ink). */
  rgbaToCmyk(rgba: Uint8ClampedArray | Uint8Array, out?: Uint8Array): Uint8Array;
  /** Baseline 4-channel Adobe CMYK JPEG. */
  encode(ink: Uint8Array, width: number, height: number, quality?: number): Uint8Array;
};
