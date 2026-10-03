// ===================== GIF ENCODER =====================
// Turns a list of RGBA frames into an animated, looping GIF (no libraries needed).
// Usage:  const blob = GifMaker.encode(frames, width, height, { delay: 12 });
//   frames = array of Uint8ClampedArray (RGBA) or ImageData.data, delay in 1/100 s.

const GifMaker = (() => {
  // ---- colour palette (median cut on a 15-bit histogram) ----
  function buildPalette(frames, w, h) {
    const hist = new Uint32Array(32768);
    const step = Math.max(1, Math.floor((frames.length * w * h) / 120000));
    let n = 0;
    for (const f of frames) {
      for (let i = 0; i < w * h; i++, n++) {
        if (n % step) continue;
        const p = i * 4;
        hist[((f[p] >> 3) << 10) | ((f[p + 1] >> 3) << 5) | (f[p + 2] >> 3)]++;
      }
    }
    const colors = [];
    for (let k = 0; k < 32768; k++) if (hist[k]) colors.push(k);

    const chan = (k, c) => (c === 0 ? (k >> 10) & 31 : c === 1 ? (k >> 5) & 31 : k & 31);
    let boxes = [colors];
    while (boxes.length < 256) {
      // split the box with the most pixels (that still has >1 colour)
      let bi = -1, bestCount = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        let cnt = 0;
        for (const k of b) cnt += hist[k];
        if (cnt > bestCount) { bestCount = cnt; bi = i; }
      });
      if (bi < 0) break;
      const box = boxes[bi];
      let ch = 0, bestRange = -1;
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0;
        for (const k of box) { const v = chan(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > bestRange) { bestRange = hi - lo; ch = c; }
      }
      box.sort((a, b) => chan(a, ch) - chan(b, ch));
      let total = 0;
      for (const k of box) total += hist[k];
      let acc = 0, cut = 1;
      for (let i = 0; i < box.length - 1; i++) {
        acc += hist[box[i]];
        cut = i + 1;
        if (acc >= total / 2) break;
      }
      boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
    }

    const palette = new Uint8Array(256 * 3);
    boxes.forEach((b, i) => {
      let r = 0, g = 0, bl = 0, cnt = 0;
      for (const k of b) {
        const c = hist[k];
        r += ((k >> 10) & 31) * c; g += ((k >> 5) & 31) * c; bl += (k & 31) * c; cnt += c;
      }
      cnt = cnt || 1;
      palette[i * 3]     = Math.min(255, Math.round((r / cnt) * 8 + 4));
      palette[i * 3 + 1] = Math.min(255, Math.round((g / cnt) * 8 + 4));
      palette[i * 3 + 2] = Math.min(255, Math.round((bl / cnt) * 8 + 4));
    });
    return { palette, count: boxes.length };
  }

  function mapFrame(f, w, h, pal, cache) {
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const key = ((f[p] >> 3) << 10) | ((f[p + 1] >> 3) << 5) | (f[p + 2] >> 3);
      let idx = cache[key];
      if (idx < 0) {
        const r = f[p], g = f[p + 1], b = f[p + 2];
        let best = 0, bd = Infinity;
        for (let c = 0; c < pal.count; c++) {
          const dr = r - pal.palette[c * 3], dg = g - pal.palette[c * 3 + 1], db = b - pal.palette[c * 3 + 2];
          const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
          if (d < bd) { bd = d; best = c; }
        }
        cache[key] = idx = best;
      }
      out[i] = idx;
    }
    return out;
  }

  // ---- LZW (classic GIF compression) ----
  function lzw(pixels, initBits) {
    const out = [];
    let curAccum = 0, curBits = 0;
    const clearCode = 1 << (initBits - 1);
    const eofCode = clearCode + 1;
    let nBits = initBits;
    let maxcode = (1 << nBits) - 1;
    let freeEnt = clearCode + 2;
    let clearFlg = false;
    let dict = new Map();
    const block = [];

    const flushBytes = () => {
      while (curBits >= 8) { block.push(curAccum & 0xff); curAccum >>= 8; curBits -= 8; }
    };
    const output = (code) => {
      curAccum |= code << curBits;
      curBits += nBits;
      flushBytes();
      if (freeEnt > maxcode || clearFlg) {
        if (clearFlg) { nBits = initBits; maxcode = (1 << nBits) - 1; clearFlg = false; }
        else { nBits++; maxcode = nBits === 12 ? 1 << 12 : (1 << nBits) - 1; }
      }
      if (code === eofCode) {
        if (curBits > 0) { block.push(curAccum & 0xff); }
        curAccum = 0; curBits = 0;
      }
    };

    output(clearCode);
    let ent = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const c = pixels[i];
      const key = (c << 12) + ent;
      const found = dict.get(key);
      if (found !== undefined) { ent = found; continue; }
      output(ent);
      ent = c;
      if (freeEnt < 4096) {
        dict.set(key, freeEnt++);
      } else {
        dict = new Map();
        freeEnt = clearCode + 2;
        clearFlg = true;
        output(clearCode);
      }
    }
    output(ent);
    output(eofCode);

    // split into <=255 byte sub-blocks
    for (let i = 0; i < block.length; i += 255) {
      const chunk = block.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
    return out;
  }

  function encode(frames, w, h, opts) {
    const delay = (opts && opts.delay) || 10;
    const pal = buildPalette(frames, w, h);
    const cache = new Int16Array(32768).fill(-1);
    const bytes = [];
    const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
    const str = (s) => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); };

    str('GIF89a');
    u16(w); u16(h);
    bytes.push(0xF7, 0, 0);                     // global colour table, 256 colours
    for (let i = 0; i < 768; i++) bytes.push(pal.palette[i]);
    // loop forever
    bytes.push(0x21, 0xFF, 0x0B); str('NETSCAPE2.0'); bytes.push(3, 1, 0, 0, 0);

    for (const f of frames) {
      const idx = mapFrame(f, w, h, pal, cache);
      bytes.push(0x21, 0xF9, 4, 0x04); u16(delay); bytes.push(0, 0);   // graphic control
      bytes.push(0x2C); u16(0); u16(0); u16(w); u16(h); bytes.push(0);  // image descriptor
      bytes.push(8);                                                    // min code size
      const data = lzw(idx, 9);
      for (let i = 0; i < data.length; i++) bytes.push(data[i]);
    }
    bytes.push(0x3B);
    return new Uint8Array(bytes);
  }

  return {
    // returns a Blob (browser) of type image/gif
    encode(frames, w, h, opts) {
      return new Blob([encode(frames, w, h, opts)], { type: 'image/gif' });
    },
    encodeBytes: encode
  };
})();

if (typeof module !== 'undefined') module.exports = GifMaker;