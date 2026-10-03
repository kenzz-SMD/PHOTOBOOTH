// ===================== QR CODE GENERATOR =====================
// Small self-contained QR encoder (byte mode, error correction L or M, versions 1-20).
// Usage:  QR.toCanvas('https://example.com', { scale: 8, margin: 4 })  ->  <canvas>
// Based on the public QR Code standard (ISO/IEC 18004).

const QR = (() => {
  const ECC_PER_BLOCK = [
    // version: 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20
    /* L */ [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
    /* M */ [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
  ];
  const NUM_BLOCKS = [
    /* L */ [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
    /* M */ [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]
  ];
  const FORMAT_BITS = [1, 0];   // L, M
  const MAX_VERSION = 20;

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver, ecl) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }

  // ---- Reed-Solomon over GF(256) ----
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  function utf8(text) {
    return Array.from(new TextEncoder().encode(text));
  }

  function encode(text, ecl) {
    const bytes = utf8(text);

    // pick the smallest version that fits
    let ver = 1;
    for (; ver <= MAX_VERSION; ver++) {
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, ecl) * 8) break;
    }
    if (ver > MAX_VERSION) throw new Error('Text too long for QR code');

    // build the data bits
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0x4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    const capBits = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, capBits - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) put(pad, 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }

    // error correction + interleave
    const nBlocks = NUM_BLOCKS[ecl][ver];
    const eccLen = ECC_PER_BLOCK[ecl][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks);
    const shortLen = Math.floor(raw / nBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((blk, j) => {
        if (i !== shortLen - eccLen || j >= nShort) all.push(blk[i]);
      });
    }

    // draw
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    const bit = (v, i) => ((v >>> i) & 1) !== 0;

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = cx + dx, yy = cy + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    const nAlign = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
    const alignPos = [];
    if (nAlign) {
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (nAlign * 2 - 2)) * 2;
      alignPos.push(6);
      for (let pos = size - 7, c = 0; c < nAlign - 1; pos -= step, c++) alignPos.splice(1, 0, pos);
    }
    for (let i = 0; i < nAlign; i++) {
      for (let j = 0; j < nAlign; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === nAlign - 1) || (i === nAlign - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFn(alignPos[i] + dx, alignPos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    const drawFormat = (mask) => {
      const d = (FORMAT_BITS[ecl] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
      setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), c = Math.floor(i / 3);
        setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i));
      }
    }

    // place data bits
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!fn[y][x] && idx < all.length * 8) {
            mod[y][x] = bit(all[idx >>> 3], 7 - (idx & 7));
            idx++;
          }
        }
      }
    }

    const applyMask = (m) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let inv;
          switch (m) {
            case 0: inv = (x + y) % 2 === 0; break;
            case 1: inv = y % 2 === 0; break;
            case 2: inv = x % 3 === 0; break;
            case 3: inv = (x + y) % 3 === 0; break;
            case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
            case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          }
          if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
        }
      }
    };

    const penalty = () => {
      let result = 0;
      const addHist = (run, h) => { if (h[0] === 0) run += size; h.pop(); h.unshift(run); };
      const countPatterns = (h) => {
        const n = h[1];
        const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
        return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
      };
      const terminate = (color, run, h) => {
        if (color) { addHist(run, h); run = 0; }
        run += size;
        addHist(run, h);
        return countPatterns(h);
      };
      const scan = (get) => {
        for (let a = 0; a < size; a++) {
          let color = false, run = 0;
          const h = [0, 0, 0, 0, 0, 0, 0];
          for (let b = 0; b < size; b++) {
            const v = get(a, b);
            if (v === color) {
              run++;
              if (run === 5) result += 3; else if (run > 5) result++;
            } else {
              addHist(run, h);
              if (!color) result += countPatterns(h) * 40;
              color = v;
              run = 1;
            }
          }
          result += terminate(color, run, h) * 40;
        }
      };
      scan((y, x) => mod[y][x]);
      scan((x, y) => mod[y][x]);
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = mod[y][x];
          if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) result += 3;
        }
      }
      let dark = 0;
      mod.forEach((row) => row.forEach((v) => { if (v) dark++; }));
      const total = size * size;
      result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return result;
    };

    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty();
      if (p < bestScore) { bestScore = p; best = m; }
      applyMask(m); // undo
    }
    applyMask(best);
    drawFormat(best);

    return { size, modules: mod, version: ver };
  }

  return {
    // returns { size, modules[y][x] }
    make(text, level) { return encode(text, level === 'L' ? 0 : 1); },

    toCanvas(text, opts) {
      const o = Object.assign({ scale: 8, margin: 4, level: 'M' }, opts || {});
      const q = encode(text, o.level === 'L' ? 0 : 1);
      const px = (q.size + o.margin * 2) * o.scale;
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#000';
      for (let y = 0; y < q.size; y++) {
        for (let x = 0; x < q.size; x++) {
          if (q.modules[y][x]) ctx.fillRect((x + o.margin) * o.scale, (y + o.margin) * o.scale, o.scale, o.scale);
        }
      }
      return c;
    }
  };
})();

if (typeof module !== 'undefined') module.exports = QR;