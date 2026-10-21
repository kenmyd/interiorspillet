/**
 * Planbygger: a small PNG codec for Node (tests and debug images) – no dependencies, only node:zlib.
 *
 *   decodePng(buffer) → { width, height, data: Uint8ClampedArray (RGBA) }   the same shape as a canvas ImageData, so
 *                                                                           src/planbygger/* runs on it unchanged
 *   encodePng({ width, height, data }) → Buffer                             8-bit RGBA, no interlace
 *   readPng(file) / writePng(file, img)
 *
 * Decodes 8- and 16-bit grey, grey+alpha, RGB, RGBA and 1/2/4/8-bit palette images (with tRNS), interlaced (Adam7) or
 * not. That covers what the floor-plan tools export.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undoes the scanline filters of one (sub)image in place; returns the raw rows. */
function unfilter(src, offset, w, h, bpp, rowBytes) {
  const out = Buffer.alloc(rowBytes * h);
  let p = offset;
  for (let y = 0; y < h; y++) {
    const type = src[p++];
    const row = y * rowBytes;
    const prev = row - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = src[p++];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let v;
      switch (type) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: v = raw + paeth(a, b, c); break;
        default: throw new Error(`PNG: ukjent filter ${type}`);
      }
      out[row + x] = v & 255;
    }
  }
  return { rows: out, next: p };
}

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('ikke en PNG-fil');
  let p = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') {
      ihdr = { w: body.readUInt32BE(0), h: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG: mangler IHDR');
  const { w, h, depth, color, interlace } = ihdr;
  const ch = CHANNELS[color];
  if (!ch) throw new Error(`PNG: fargetype ${color} støttes ikke`);
  const bitsPerPixel = ch * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(w * h * 4);
  const sample = (rows, rowBytes, x, y, c) => {
    if (depth === 8) return rows[y * rowBytes + x * ch + c];
    if (depth === 16) return rows[y * rowBytes + (x * ch + c) * 2]; // high byte
    const per = 8 / depth;
    const byte = rows[y * rowBytes + Math.floor(x / per)];
    const shift = 8 - depth * ((x % per) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scaleBits = (v) => (depth < 8 && color !== 3 ? Math.round((v * 255) / ((1 << depth) - 1)) : v);
  const put = (rows, rowBytes, sx, sy, dx, dy) => {
    const o = (dy * w + dx) * 4;
    if (color === 3) {
      const i = sample(rows, rowBytes, sx, sy, 0);
      out[o] = palette[i * 3];
      out[o + 1] = palette[i * 3 + 1];
      out[o + 2] = palette[i * 3 + 2];
      out[o + 3] = trns && i < trns.length ? trns[i] : 255;
    } else if (color === 0 || color === 4) {
      const g = scaleBits(sample(rows, rowBytes, sx, sy, 0));
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = color === 4 ? sample(rows, rowBytes, sx, sy, 1) : 255;
    } else {
      out[o] = sample(rows, rowBytes, sx, sy, 0);
      out[o + 1] = sample(rows, rowBytes, sx, sy, 1);
      out[o + 2] = sample(rows, rowBytes, sx, sy, 2);
      out[o + 3] = color === 6 ? sample(rows, rowBytes, sx, sy, 3) : 255;
    }
  };
  if (!interlace) {
    const rowBytes = Math.ceil((w * bitsPerPixel) / 8);
    const { rows } = unfilter(raw, 0, w, h, bpp, rowBytes);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(rows, rowBytes, x, y, x, y);
  } else {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    let off = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((w - x0) / dx);
      const ph = Math.ceil((h - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const rowBytes = Math.ceil((pw * bitsPerPixel) / 8);
      const { rows, next } = unfilter(raw, off, pw, ph, bpp, rowBytes);
      off = next;
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) put(rows, rowBytes, x, y, x0 + x * dx, y0 + y * dy);
    }
  }
  return { width: w, height: h, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, body])));
  return Buffer.concat([len, tb, body, crc]);
}

export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0;
    for (let i = 0; i < rowBytes; i++) raw[y * (rowBytes + 1) + 1 + i] = data[y * rowBytes + i];
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const readPng = (file) => decodePng(fs.readFileSync(file));
export const writePng = (file, img) => fs.writeFileSync(file, encodePng(img));
