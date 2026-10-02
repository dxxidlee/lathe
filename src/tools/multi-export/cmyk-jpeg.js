/* Ported verbatim from reference/assets/cmyk-jpeg.js; only the IIFE wrapper became an ES module export. */
/* ==========================================================================
   Baseline JPEG encoder with four-channel Adobe CMYK output.

   Canvas only ever hands back sRGB, and toBlob("image/jpeg") only ever writes
   a 3-channel YCbCr file, so a genuine CMYK raster has to be assembled here.

   The file is written the way Adobe writes them: an APP14 marker with
   transform 0, four components at 1x1 sampling, and — the part that trips
   everyone up — ink values stored INVERTED, so blank paper is 0xFF and solid
   ink is 0x00. Photoshop, Illustrator and libjpeg all key off the APP14
   marker to undo that inversion on read.
   ========================================================================== */

  /* Natural (row-major) index for each zig-zag position. */
  const ZZ = [
     0,  1,  8, 16,  9,  2,  3, 10,
    17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
  ];

  /* Annex K luminance quantisation table, natural order. Every CMYK channel
     is ink coverage rather than luma, so all four share this one table. */
  const QT_BASE = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68,109,103, 77,
    24, 35, 55, 64, 81,104,113, 92,
    49, 64, 78, 87,103,121,120,101,
    72, 92, 95, 98,112,100,103, 99
  ];

  /* Annex K Huffman specs (counts indexed 1..16). */
  const BITS_DC = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const VALS_DC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  const BITS_AC = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  const VALS_AC = [
    0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,
    0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
    0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,
    0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,
    0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,
    0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,
    0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,
    0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,
    0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,
    0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,
    0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,
    0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
    0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,
    0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,
    0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,
    0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,
    0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,
    0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,
    0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,
    0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
    0xf9,0xfa
  ];

  /* AAN scale factors — the fast DCT below returns coefficients pre-scaled by
     these, so they get folded into the reciprocal quant table. */
  const AASF = [
    1.0, 1.387039845, 1.306562965, 1.175875602,
    1.0, 0.785694958, 0.541196100, 0.275899379
  ];

  function buildHuffTable(bits, vals) {
    const table = [];
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
      for (let i = 0; i < bits[len]; i++) {
        table[vals[k++]] = { code: code, len: len };
        code++;
      }
      code <<= 1;
    }
    return table;
  }

  function scaleQuantTable(base, quality) {
    const q = Math.max(1, Math.min(100, quality));
    const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
    const out = new Int32Array(64);
    for (let i = 0; i < 64; i++) {
      out[i] = Math.max(1, Math.min(255, Math.floor((base[i] * scale + 50) / 100)));
    }
    return out;
  }

  function buildFdtbl(qt) {
    const t = new Float32Array(64);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const i = row * 8 + col;
        t[i] = 1 / (qt[i] * AASF[row] * AASF[col] * 8);
      }
    }
    return t;
  }

  /* AAN forward DCT, in place, followed by quantisation into `out`. */
  function fdctQuant(d, fdtbl, out) {
    let off = 0, i, tmp0, tmp1, tmp2, tmp3, tmp4, tmp5, tmp6, tmp7;
    let tmp10, tmp11, tmp12, tmp13, z1, z2, z3, z4, z5, z11, z13;

    for (i = 0; i < 8; i++) {
      tmp0 = d[off] + d[off + 7];
      tmp7 = d[off] - d[off + 7];
      tmp1 = d[off + 1] + d[off + 6];
      tmp6 = d[off + 1] - d[off + 6];
      tmp2 = d[off + 2] + d[off + 5];
      tmp5 = d[off + 2] - d[off + 5];
      tmp3 = d[off + 3] + d[off + 4];
      tmp4 = d[off + 3] - d[off + 4];

      tmp10 = tmp0 + tmp3;
      tmp13 = tmp0 - tmp3;
      tmp11 = tmp1 + tmp2;
      tmp12 = tmp1 - tmp2;

      d[off] = tmp10 + tmp11;
      d[off + 4] = tmp10 - tmp11;

      z1 = (tmp12 + tmp13) * 0.707106781;
      d[off + 2] = tmp13 + z1;
      d[off + 6] = tmp13 - z1;

      tmp10 = tmp4 + tmp5;
      tmp11 = tmp5 + tmp6;
      tmp12 = tmp6 + tmp7;

      z5 = (tmp10 - tmp12) * 0.382683433;
      z2 = 0.541196100 * tmp10 + z5;
      z4 = 1.306562965 * tmp12 + z5;
      z3 = tmp11 * 0.707106781;

      z11 = tmp7 + z3;
      z13 = tmp7 - z3;

      d[off + 5] = z13 + z2;
      d[off + 3] = z13 - z2;
      d[off + 1] = z11 + z4;
      d[off + 7] = z11 - z4;

      off += 8;
    }

    for (i = 0; i < 8; i++) {
      off = i;
      tmp0 = d[off] + d[off + 56];
      tmp7 = d[off] - d[off + 56];
      tmp1 = d[off + 8] + d[off + 48];
      tmp6 = d[off + 8] - d[off + 48];
      tmp2 = d[off + 16] + d[off + 40];
      tmp5 = d[off + 16] - d[off + 40];
      tmp3 = d[off + 24] + d[off + 32];
      tmp4 = d[off + 24] - d[off + 32];

      tmp10 = tmp0 + tmp3;
      tmp13 = tmp0 - tmp3;
      tmp11 = tmp1 + tmp2;
      tmp12 = tmp1 - tmp2;

      d[off] = tmp10 + tmp11;
      d[off + 32] = tmp10 - tmp11;

      z1 = (tmp12 + tmp13) * 0.707106781;
      d[off + 16] = tmp13 + z1;
      d[off + 48] = tmp13 - z1;

      tmp10 = tmp4 + tmp5;
      tmp11 = tmp5 + tmp6;
      tmp12 = tmp6 + tmp7;

      z5 = (tmp10 - tmp12) * 0.382683433;
      z2 = 0.541196100 * tmp10 + z5;
      z4 = 1.306562965 * tmp12 + z5;
      z3 = tmp11 * 0.707106781;

      z11 = tmp7 + z3;
      z13 = tmp7 - z3;

      d[off + 40] = z13 + z2;
      d[off + 24] = z13 - z2;
      d[off + 8] = z11 + z4;
      d[off + 56] = z11 - z4;
    }

    for (i = 0; i < 64; i++) out[i] = Math.round(d[i] * fdtbl[i]);
  }

  function ByteWriter() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
  }
  ByteWriter.prototype._ensure = function (n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  };
  ByteWriter.prototype.u8 = function (v) {
    this._ensure(1);
    this.buf[this.len++] = v & 0xff;
  };
  ByteWriter.prototype.u16 = function (v) {
    this._ensure(2);
    this.buf[this.len++] = (v >> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  };
  ByteWriter.prototype.raw = function (arr) {
    this._ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  };
  ByteWriter.prototype.result = function () {
    return this.buf.slice(0, this.len);
  };

  /* sRGB bytes -> ink coverage, 0 = no ink. Alpha is ignored: JPEG has no
     alpha channel, so callers must flatten onto a matte first. */
  function rgbaToCmyk(rgba, out) {
    const n = rgba.length / 4;
    out = out || new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
      const k = 1 - Math.max(r, g, b);
      let c = 0, m = 0, y = 0;
      if (k < 1) {
        const d = 1 - k;
        c = (1 - r - k) / d;
        m = (1 - g - k) / d;
        y = (1 - b - k) / d;
      }
      out[p] = Math.round(c * 255);
      out[p + 1] = Math.round(m * 255);
      out[p + 2] = Math.round(y * 255);
      out[p + 3] = Math.round(k * 255);
    }
    return out;
  }

  /* `ink` is width*height*4 bytes of C,M,Y,K coverage (0 = no ink). */
  function encodeCmykJpeg(ink, width, height, quality) {
    const qt = scaleQuantTable(QT_BASE, quality == null ? 92 : quality);
    const fdtbl = buildFdtbl(qt);
    const dcTab = buildHuffTable(BITS_DC, VALS_DC);
    const acTab = buildHuffTable(BITS_AC, VALS_AC);
    const w = new ByteWriter();

    w.u16(0xffd8); // SOI

    // APP14 "Adobe", transform 0 -> components are ink channels, not YCCK.
    w.u16(0xffee);
    w.u16(14);
    w.raw([0x41, 0x64, 0x6f, 0x62, 0x65]);
    w.u16(100); // version
    w.u16(0);   // flags0
    w.u16(0);   // flags1
    w.u8(0);    // transform

    w.u16(0xffdb); // DQT
    w.u16(67);
    w.u8(0);
    for (let k = 0; k < 64; k++) w.u8(qt[ZZ[k]]);

    w.u16(0xffc0); // SOF0
    w.u16(8 + 3 * 4);
    w.u8(8);
    w.u16(height);
    w.u16(width);
    w.u8(4);
    for (let c = 1; c <= 4; c++) {
      w.u8(c);
      w.u8(0x11); // no subsampling — ink channels must not be smoothed
      w.u8(0);
    }

    w.u16(0xffc4); // DHT, DC
    w.u16(2 + 1 + 16 + VALS_DC.length);
    w.u8(0x00);
    for (let i = 1; i <= 16; i++) w.u8(BITS_DC[i]);
    w.raw(VALS_DC);

    w.u16(0xffc4); // DHT, AC
    w.u16(2 + 1 + 16 + VALS_AC.length);
    w.u8(0x10);
    for (let i = 1; i <= 16; i++) w.u8(BITS_AC[i]);
    w.raw(VALS_AC);

    w.u16(0xffda); // SOS
    w.u16(6 + 2 * 4);
    w.u8(4);
    for (let c = 1; c <= 4; c++) {
      w.u8(c);
      w.u8(0x00);
    }
    w.u8(0);
    w.u8(63);
    w.u8(0);

    let bitBuf = 0, bitCnt = 0;
    function writeBits(code, len) {
      bitBuf = (bitBuf << len) | code;
      bitCnt += len;
      while (bitCnt >= 8) {
        const b = (bitBuf >> (bitCnt - 8)) & 0xff;
        w.u8(b);
        if (b === 0xff) w.u8(0x00); // byte stuffing
        bitCnt -= 8;
      }
      bitBuf &= (1 << bitCnt) - 1;
    }
    function category(v) {
      let a = v < 0 ? -v : v, n = 0;
      while (a) { a >>= 1; n++; }
      return n;
    }
    function encodeBlock(blk, prevDC) {
      const diff = blk[0] - prevDC;
      if (diff === 0) {
        writeBits(dcTab[0].code, dcTab[0].len);
      } else {
        const s = category(diff);
        writeBits(dcTab[s].code, dcTab[s].len);
        writeBits(diff < 0 ? diff + (1 << s) - 1 : diff, s);
      }
      let end = 63;
      while (end > 0 && blk[ZZ[end]] === 0) end--;
      if (end === 0) {
        writeBits(acTab[0x00].code, acTab[0x00].len);
        return blk[0];
      }
      let run = 0;
      for (let k = 1; k <= end; k++) {
        const v = blk[ZZ[k]];
        if (v === 0) { run++; continue; }
        while (run > 15) {
          writeBits(acTab[0xf0].code, acTab[0xf0].len);
          run -= 16;
        }
        const s = category(v);
        writeBits(acTab[(run << 4) | s].code, acTab[(run << 4) | s].len);
        writeBits(v < 0 ? v + (1 << s) - 1 : v, s);
        run = 0;
      }
      if (end < 63) writeBits(acTab[0x00].code, acTab[0x00].len);
      return blk[0];
    }

    const blk = new Float32Array(64);
    const quant = new Int16Array(64);
    const prevDC = [0, 0, 0, 0];
    const bw = Math.ceil(width / 8), bh = Math.ceil(height / 8);

    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        for (let comp = 0; comp < 4; comp++) {
          for (let y = 0; y < 8; y++) {
            const sy = Math.min(height - 1, by * 8 + y);
            const rowOff = sy * width;
            for (let x = 0; x < 8; x++) {
              const sx = Math.min(width - 1, bx * 8 + x);
              // Store inverted, then level-shift by 128 as baseline JPEG wants.
              blk[y * 8 + x] = (255 - ink[(rowOff + sx) * 4 + comp]) - 128;
            }
          }
          fdctQuant(blk, fdtbl, quant);
          prevDC[comp] = encodeBlock(quant, prevDC[comp]);
        }
      }
    }

    if (bitCnt > 0) writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
    w.u16(0xffd9); // EOI
    return w.result();
  }

export const CmykJpeg = { encode: encodeCmykJpeg, rgbaToCmyk: rgbaToCmyk };
