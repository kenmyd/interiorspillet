/**
 * Planbygger: raster operations on floor-plan images (classical image processing, no learning). Pure JS on typed
 * arrays, so the same code runs in the browser (canvas ImageData) and in Node (tools/planbygger-png.mjs).
 *
 * A raster is { w, h, data } where data is a Uint8Array (masks: 0/1, grey: 0–255) or another typed array.
 *
 *   luma(img)                     RGBA (ImageData shape) → grey 0–255, transparent pixels count as white
 *   histogram(grey) / otsu(hist, lo, hi)
 *   threshold(grey, t)            mask of pixels darker than t
 *   erode / dilate / open / close rectangular structuring elements (separable, O(n) per pixel row)
 *   runLengths(mask, 'h'|'v')     per pixel: the length of the run of 1s it lies in (0 for 0-pixels)
 *   components(mask, 4|8)         connected components with area and bounds
 *   keepLabels / maskOf           masks from component labels
 *   distanceToMask(mask)          chamfer (3-4) distance in pixels to the nearest 1-pixel
 */

export const raster = (w, h, Type = Uint8Array) => ({ w, h, data: new Type(w * h) });

/** Grey value (Rec. 601) of an RGBA image; alpha is composited on white. */
export function luma(img) {
  const { width: w, height: h, data: d } = img;
  const out = raster(w, h);
  for (let i = 0, n = w * h; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    out.data[i] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

export function histogram(grey) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.data.length; i++) hist[grey.data[i]]++;
  return hist;
}

/** Otsu's threshold over the bins lo … hi (inclusive). */
export function otsu(hist, lo = 0, hi = 255) {
  let total = 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = lo;
  let bestVar = -1;
  for (let t = lo; t <= hi; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

/** Mask of the pixels darker than t. */
export function threshold(grey, t) {
  const out = raster(grey.w, grey.h);
  for (let i = 0; i < grey.data.length; i++) out.data[i] = grey.data[i] < t ? 1 : 0;
  return out;
}

/**
 * Min (erode) or max (dilate) filter along one axis with a window of 2r + 1. Outside the raster counts as 0 for
 * erosion (a wall touching the border is cut there) and as 0 for dilation.
 */
function filter1d(src, r, axis, erodeMode) {
  const { w, h } = src;
  const out = raster(w, h);
  if (r <= 0) {
    out.data.set(src.data);
    return out;
  }
  const n = axis === 'h' ? w : h;
  const lines = axis === 'h' ? h : w;
  const step = axis === 'h' ? 1 : w;
  const pre = new Int32Array(n + 1);
  for (let l = 0; l < lines; l++) {
    const base = axis === 'h' ? l * w : l;
    pre[0] = 0;
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src.data[base + i * step];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - r);
      const b = Math.min(n, i + r + 1);
      const ones = pre[b] - pre[a];
      out.data[base + i * step] = erodeMode ? (ones === 2 * r + 1 ? 1 : 0) : ones > 0 ? 1 : 0;
    }
  }
  return out;
}

export const erode = (m, rx, ry = rx) => filter1d(filter1d(m, rx, 'h', true), ry, 'v', true);
export const dilate = (m, rx, ry = rx) => filter1d(filter1d(m, rx, 'h', false), ry, 'v', false);
export const open = (m, rx, ry = rx) => dilate(erode(m, rx, ry), rx, ry);
export const close = (m, rx, ry = rx) => erode(dilate(m, rx, ry), rx, ry);

/** a AND NOT b */
export function subtract(a, b) {
  const out = raster(a.w, a.h);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] && !b.data[i] ? 1 : 0;
  return out;
}
export function union(a, b) {
  const out = raster(a.w, a.h);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] || b.data[i] ? 1 : 0;
  return out;
}

/** Per pixel the length of the horizontal ('h') or vertical ('v') run of 1s through it. */
export function runLengths(mask, axis) {
  const { w, h } = mask;
  const out = raster(w, h, Uint16Array);
  const n = axis === 'h' ? w : h;
  const lines = axis === 'h' ? h : w;
  const step = axis === 'h' ? 1 : w;
  for (let l = 0; l < lines; l++) {
    const base = axis === 'h' ? l * w : l;
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && mask.data[base + i * step];
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        const len = i - start;
        for (let k = start; k < i; k++) out.data[base + k * step] = len;
        start = -1;
      }
    }
  }
  return out;
}

/** Pixels on runs of at least minLen along the axis (a morphological opening by a line). */
export function longRuns(mask, axis, minLen) {
  const rl = runLengths(mask, axis);
  const out = raster(mask.w, mask.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = rl.data[i] >= minLen ? 1 : 0;
  return out;
}

/**
 * Connected components of the 1-pixels.
 * @returns {{ labels: Int32Array, comps: { id, area, minX, maxX, minY, maxY, sx, sy }[] }}  label −1 = background
 */
export function components(mask, conn = 4) {
  const { w, h } = mask;
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask.data[s] || labels[s] >= 0) continue;
    const id = comps.length;
    const c = { id, area: 0, minX: w, maxX: -1, minY: h, maxY: -1, sx: 0, sy: 0 };
    let top = 0;
    stack[top++] = s;
    labels[s] = id;
    while (top) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.sx += x;
      c.sy += y;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (conn === 4 && dx && dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask.data[q] && labels[q] < 0) {
            labels[q] = id;
            stack[top++] = q;
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Mask of the pixels whose label is in `keep` (a Set or a predicate on the label). */
export function maskOf(labels, w, h, keep) {
  const out = raster(w, h);
  const test = typeof keep === 'function' ? keep : (l) => keep.has(l);
  for (let i = 0; i < labels.length; i++) out.data[i] = labels[i] >= 0 && test(labels[i]) ? 1 : 0;
  return out;
}

/** Chamfer (3-4) distance in pixels from every pixel to the nearest 1-pixel of the mask. */
export function distanceToMask(mask) {
  const { w, h } = mask;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask.data[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return { w, h, data: d };
}

/** Grey value at a sub-pixel point (nearest pixel; outside = white). */
export function sample(grey, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= grey.w || yi >= grey.h) return 255;
  return grey.data[yi * grey.w + xi];
}

/** Darkest grey value within radius r (pixels) of a point. */
export function minNear(grey, x, y, r) {
  let m = 255;
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r);
  for (let yy = y0; yy <= y1; yy++) {
    if (yy < 0 || yy >= grey.h) continue;
    for (let xx = x0; xx <= x1; xx++) {
      if (xx < 0 || xx >= grey.w) continue;
      const v = grey.data[yy * grey.w + xx];
      if (v < m) m = v;
    }
  }
  return m;
}

/** Median of the grey values (a robust background estimate). */
export function medianGrey(grey) {
  const hist = histogram(grey);
  let acc = 0;
  const half = grey.data.length / 2;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= half) return i;
  }
  return 255;
}
