#!/usr/bin/env node
/**
 * Pixel diff of two PNG screenshots, without extra packages (Node zlib only) – notes/hele-huset-design.md §7.1.
 *
 *   node tools/imgdiff.mjs <ref.png> <new.png> [--max=<percent>] [--tol=6] [--max-mean=<0..255>] [--out=diff.png]
 *                          [--rect=x,y,w,h] [--ignore=x,y,w,h;x,y,w,h] [--json]
 *
 * A pixel counts as changed when any of its R, G, B channels differs by more than --tol (0–255, default 6).
 * Printed (one line, or JSON with --json):
 *   changed   share of changed pixels in percent (the number --max is compared with)
 *   mean      mean absolute channel difference over all compared pixels (0–255)
 *   rms       root mean square channel difference (0–255)
 *   maxd      largest channel difference
 *   bbox      bounding box x,y,w,h of the changed pixels (or -)
 * --max=P        fail (exit 1) when changed > P percent. The house references come with a measured noise per image in
 *                .shots/hus/ref/noise.json; use --max = its "max" (2 × the noise measured between two takes).
 * --max-mean=M   also fail when mean > M.
 * --rect / --ignore   compare only inside one rectangle / leave rectangles out (pixels, top-left origin).
 * --out=diff.png      the reference greyed out with the changed pixels in red (brighter = larger difference).
 * Exit codes: 0 within the limits, 1 over a limit, 2 bad input (missing file, different sizes, unsupported PNG).
 *
 * Supported PNGs: 8-bit greyscale, grey+alpha, RGB, RGBA and palette, non-interlaced (what browsers and Playwright
 * write). Alpha is ignored.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// ---- PNG -----------------------------------------------------------------------------------------------------------

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{ width: number, height: number, rgb: Uint8Array }} 3 bytes per pixel */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
  let off = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (only 8)`);
  if (interlace) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
  if (ctype === 3 && !palette) throw new Error('palette PNG without PLTE');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const rgb = new Uint8Array(width * height * 3);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${f} in row ${y}`);
      }
      cur[i] = v & 255;
    }
    for (let i = 0, o = y * width * 3; i < width; i++, o += 3) {
      if (ctype === 2 || ctype === 6) {
        rgb[o] = cur[i * channels];
        rgb[o + 1] = cur[i * channels + 1];
        rgb[o + 2] = cur[i * channels + 2];
      } else if (ctype === 3) {
        const k = cur[i] * 3;
        rgb[o] = palette[k];
        rgb[o + 1] = palette[k + 1];
        rgb[o + 2] = palette[k + 2];
      } else {
        rgb[o] = rgb[o + 1] = rgb[o + 2] = cur[i * channels];
      }
    }
    prev.set(cur);
  }
  return { width, height, rgb };
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
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGB (3 bytes per pixel) → PNG buffer. */
export function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- diff ----------------------------------------------------------------------------------------------------------

const rectOf = (s) => {
  const [x, y, w, h] = s.split(',').map(Number);
  if (![x, y, w, h].every(Number.isFinite)) throw new Error(`bad rectangle "${s}" (x,y,w,h)`);
  return { x, y, w, h };
};

/**
 * @param {{width,height,rgb}} A  reference
 * @param {{width,height,rgb}} B
 * @param {{ tol?: number, rect?: {x,y,w,h}|null, ignore?: Array<{x,y,w,h}>, diff?: boolean }} [o]
 */
export function diffImages(A, B, { tol = 6, rect = null, ignore = [], diff = false } = {}) {
  if (A.width !== B.width || A.height !== B.height) throw new Error(`different sizes: ${A.width}×${A.height} vs ${B.width}×${B.height}`);
  const W = A.width, H = A.height;
  const inside = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const out = diff ? new Uint8Array(W * H * 3) : null;
  let n = 0, changed = 0, sum = 0, sum2 = 0, maxd = 0;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const use = (!rect || inside(x, y, rect)) && !ignore.some((r) => inside(x, y, r));
      if (out) {
        const g = ((A.rgb[o] * 0.2126 + A.rgb[o + 1] * 0.7152 + A.rgb[o + 2] * 0.0722) * 0.35 + 40) | 0;
        out[o] = out[o + 1] = out[o + 2] = use ? g : g >> 1;
      }
      if (!use) continue;
      n++;
      const dr = Math.abs(A.rgb[o] - B.rgb[o]), dg = Math.abs(A.rgb[o + 1] - B.rgb[o + 1]), db = Math.abs(A.rgb[o + 2] - B.rgb[o + 2]);
      sum += dr + dg + db;
      sum2 += dr * dr + dg * dg + db * db;
      const m = Math.max(dr, dg, db);
      if (m > maxd) maxd = m;
      if (m > tol) {
        changed++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
        if (out) {
          out[o] = 255;
          out[o + 1] = out[o + 2] = Math.max(0, 120 - m);
        }
      }
    }
  }
  return {
    width: W,
    height: H,
    pixels: n,
    changedPixels: changed,
    changed: n ? (100 * changed) / n : 0,
    mean: n ? sum / (3 * n) : 0,
    rms: n ? Math.sqrt(sum2 / (3 * n)) : 0,
    maxd,
    bbox: changed ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null,
    diff: out,
  };
}

/** Reads, diffs and (optionally) writes the diff image. @returns the diffImages result without the pixel buffer */
export function diffFiles(refPath, newPath, { tol = 6, rect = null, ignore = [], out = null } = {}) {
  const A = decodePng(readFileSync(refPath));
  const B = decodePng(readFileSync(newPath));
  const r = diffImages(A, B, { tol, rect, ignore, diff: !!out });
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, encodePng(r.width, r.height, r.diff));
  }
  delete r.diff;
  return r;
}

// ---- CLI -----------------------------------------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => !a.startsWith('--'));
  const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
  }));
  if (pos.length < 2) {
    console.error('usage: node tools/imgdiff.mjs <ref.png> <new.png> [--max=<percent>] [--tol=6] [--max-mean=] [--out=diff.png] [--rect=x,y,w,h] [--ignore=x,y,w,h;…] [--json]');
    process.exit(2);
  }
  let r;
  try {
    r = diffFiles(pos[0], pos[1], {
      tol: Number(opt.tol ?? 6),
      rect: opt.rect ? rectOf(opt.rect) : null,
      ignore: opt.ignore ? opt.ignore.split(';').filter(Boolean).map(rectOf) : [],
      out: opt.out ?? null,
    });
  } catch (e) {
    console.error(`[imgdiff] ${e.message}`);
    process.exit(2);
  }
  const max = opt.max != null ? Number(opt.max) : null;
  const maxMean = opt['max-mean'] != null ? Number(opt['max-mean']) : null;
  const over = (max != null && r.changed > max + 1e-12) || (maxMean != null && r.mean > maxMean + 1e-12);
  const res = { ...r, max, maxMean, ok: !over };
  if (opt.json === 'true') console.log(JSON.stringify(res));
  else {
    console.log(`${over ? 'FAIL' : 'ok  '} changed ${r.changed.toFixed(4)} % (${r.changedPixels} px > ${opt.tol ?? 6})${max != null ? ` max ${max}` : ''}  mean ${r.mean.toFixed(4)}${maxMean != null ? ` max ${maxMean}` : ''}  rms ${r.rms.toFixed(3)}  maxd ${r.maxd}  bbox ${r.bbox ? r.bbox.join(',') : '-'}${opt.out ? `  → ${opt.out}` : ''}`);
  }
  process.exit(over ? 1 : 0);
}
