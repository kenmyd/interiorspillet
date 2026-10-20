/**
 * Small 2D shape helpers for procedural terrain design (pure math, no THREE objects).
 *
 *  - smin / smax / softClamp   smooth (polynomial) min/max for blending height constraints without creases
 *  - sdBox                     signed distance to an axis-aligned rectangle in the x–z plane
 *  - monotoneProfile           smooth, overshoot-free 1D curve through (x, y) nodes (Fritsch–Carlson)
 *  - Polyline                  Catmull-Rom smoothed polyline with fast closest-point / signed-side queries
 *  - ScalarGrid                precomputed scalar field on a regular grid with bilinear sampling
 *
 * Conventions: works in the x–z plane of the three.js world (here: +x = south, +z = west, see SCAFFOLD.md). "Left" of a
 * polyline means left of the direction of travel seen from above (+y) with −z up on the page, like the floor plan.
 */

/** Polynomial smooth minimum. k = blend width (same units as a/b); k <= 0 → hard min. */
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Polynomial smooth maximum (see smin). */
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

/** Clamp v into [lo, hi] with soft corners of width k. */
export function softClamp(v, lo, hi, k) {
  return smax(smin(v, hi, k), lo, k);
}

/** Signed distance from (x, z) to the rectangle [minX, maxX] × [minZ, maxZ] (negative inside). */
export function sdBox(x, z, minX, minZ, maxX, maxZ) {
  const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
  const hx = (maxX - minX) * 0.5, hz = (maxZ - minZ) * 0.5;
  const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0);
}

/**
 * Monotone cubic interpolation through nodes [[x0, y0], [x1, y1], ...] (x ascending).
 * Never overshoots between nodes, so it is safe for height profiles. Outside the node range the curve
 * continues linearly with the end slopes.
 * @returns {(x:number) => number}
 */
export function monotoneProfile(nodes) {
  const n = nodes.length;
  const xs = nodes.map((p) => p[0]);
  const ys = nodes.map((p) => p[1]);
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  const m = new Float64Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return function profile(x) {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

const CHUNK = 16;

/**
 * 2D polyline in the x–z plane, optionally smoothed with a centripetal Catmull-Rom spline.
 * closest(x, z) returns the distance to the curve, which side the point is on and the arc length there.
 */
export class Polyline {
  /**
   * @param {Array<[number, number]>} points  control points [x, z]
   * @param {object} [o]
   * @param {boolean} [o.smooth=true]                 Catmull-Rom through the control points
   * @param {(x:number, z:number) => number} [o.maxSegment]  max segment length at a location (densification)
   * @param {number[]} [o.values]                     optional per-control-point values, interpolated along the
   *                                                  curve and returned as `value` by closest()
   */
  constructor(points, { smooth = true, maxSegment = () => 4, values = null } = {}) {
    const xs = [], zs = [], vs = [];
    const P = points;
    const n = P.length;
    const get = (i) => P[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n - 1; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = smooth ? Math.max(1, Math.ceil(len / Math.max(0.25, maxSegment((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)))) : 1;
      const v1 = values ? values[i] : 0, v2 = values ? values[i + 1] : 0;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        if (smooth) {
          const [x, z] = catmullRom(p0, p1, p2, p3, t);
          xs.push(x);
          zs.push(z);
        } else {
          xs.push(p1[0] + (p2[0] - p1[0]) * t);
          zs.push(p1[1] + (p2[1] - p1[1]) * t);
        }
        vs.push(v1 + (v2 - v1) * t);
      }
    }
    xs.push(P[n - 1][0]);
    zs.push(P[n - 1][1]);
    vs.push(values ? values[n - 1] : 0);

    this.count = xs.length;
    this.x = Float64Array.from(xs);
    this.z = Float64Array.from(zs);
    this.v = Float64Array.from(vs);
    this.cum = new Float64Array(this.count);
    for (let i = 1; i < this.count; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    this.length = this.cum[this.count - 1];

    // chunk bounding boxes for culling
    const segs = this.count - 1;
    this.chunkCount = Math.ceil(segs / CHUNK);
    this.chunkBox = new Float64Array(this.chunkCount * 4);
    for (let c = 0; c < this.chunkCount; c++) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      const i0 = c * CHUNK, i1 = Math.min(segs, i0 + CHUNK);
      for (let i = i0; i <= i1; i++) {
        minX = Math.min(minX, this.x[i]);
        maxX = Math.max(maxX, this.x[i]);
        minZ = Math.min(minZ, this.z[i]);
        maxZ = Math.max(maxZ, this.z[i]);
      }
      this.chunkBox.set([minX, minZ, maxX, maxZ], c * 4);
    }
    this._lastChunk = 0;
    this._res = { dist: 0, side: 0, s: 0, value: 0, index: 0, t: 0 };
  }

  /**
   * Closest point on the curve. Returns a shared result object (copy what you need):
   *   dist (≥ 0), side (+1 left of travel, -1 right), s (arc length), value (interpolated), index, t.
   */
  closest(x, z) {
    const X = this.x, Z = this.z;
    let best = Infinity, bi = 0, bt = 0;
    const testChunk = (c) => {
      const i0 = c * CHUNK, i1 = Math.min(this.count - 1, i0 + CHUNK);
      for (let i = i0; i < i1; i++) {
        const ax = X[i], az = Z[i];
        const tx = X[i + 1] - ax, tz = Z[i + 1] - az;
        const px = x - ax, pz = z - az;
        const ll = tx * tx + tz * tz;
        let t = ll > 0 ? (px * tx + pz * tz) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - tx * t, dz = pz - tz * t;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
          best = d2;
          bi = i;
          bt = t;
        }
      }
    };
    // start with the chunk that won last time (queries are spatially coherent)
    const B = this.chunkBox;
    const first = Math.min(this._lastChunk, this.chunkCount - 1);
    testChunk(first);
    let winner = first;
    for (let c = 0; c < this.chunkCount; c++) {
      if (c === first) continue;
      const ox = Math.max(B[c * 4] - x, 0, x - B[c * 4 + 2]);
      const oz = Math.max(B[c * 4 + 1] - z, 0, z - B[c * 4 + 3]);
      if (ox * ox + oz * oz >= best) continue;
      const before = best;
      testChunk(c);
      if (best < before) winner = c;
    }
    this._lastChunk = winner;

    // side: segment normal, or the bisector of both neighbours when the closest point is a vertex
    const i = bi;
    let nx, nz;
    const segN = (k) => {
      const tx = X[k + 1] - X[k], tz = Z[k + 1] - Z[k];
      const l = Math.hypot(tx, tz) || 1;
      return [tz / l, -tx / l]; // left normal
    };
    let ax, az;
    if (bt <= 1e-9 && i > 0) {
      const a = segN(i - 1), b = segN(i);
      nx = a[0] + b[0];
      nz = a[1] + b[1];
      ax = X[i];
      az = Z[i];
    } else if (bt >= 1 - 1e-9 && i + 1 < this.count - 1) {
      const a = segN(i), b = segN(i + 1);
      nx = a[0] + b[0];
      nz = a[1] + b[1];
      ax = X[i + 1];
      az = Z[i + 1];
    } else {
      [nx, nz] = segN(i);
      ax = X[i];
      az = Z[i];
    }
    const r = this._res;
    r.dist = Math.sqrt(best);
    r.side = (x - ax) * nx + (z - az) * nz >= 0 ? 1 : -1;
    r.index = i;
    r.t = bt;
    r.s = this.cum[i] + (this.cum[i + 1] - this.cum[i]) * bt;
    r.value = this.v[i] + (this.v[i + 1] - this.v[i]) * bt;
    return r;
  }

  /** Signed distance: positive on the left of the travel direction. */
  signedDistance(x, z) {
    const r = this.closest(x, z);
    return r.dist * r.side;
  }
}

function catmullRom(p0, p1, p2, p3, t) {
  // centripetal parameterisation (alpha = 0.5) avoids cusps and self-intersections
  const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp2 = (a, b, ta, tb) => {
    const w = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const A1 = lerp2(p0, p1, t0, t1), A2 = lerp2(p1, p2, t1, t2), A3 = lerp2(p2, p3, t2, t3);
  const B1 = lerp2(A1, A2, t0, t2), B2 = lerp2(A2, A3, t1, t3);
  return lerp2(B1, B2, t1, t2);
}

/**
 * Scalar field sampled on a regular grid (bilinear). Outside the grid the original function is evaluated.
 */
export class ScalarGrid {
  /**
   * @param {(x:number, z:number) => number} fn
   * @param {number} minX
   * @param {number} minZ
   * @param {number} step   grid spacing (m)
   * @param {number} nx     samples along x
   * @param {number} nz     samples along z
   */
  constructor(fn, minX, minZ, step, nx, nz) {
    this.fn = fn;
    this.minX = minX;
    this.minZ = minZ;
    this.step = step;
    this.inv = 1 / step;
    this.nx = nx;
    this.nz = nz;
    this.data = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * step;
      // serpentine order keeps successive queries close together (helps Polyline's chunk cache)
      for (let k = 0; k < nx; k++) {
        const i = j & 1 ? nx - 1 - k : k;
        this.data[j * nx + i] = fn(minX + i * step, z);
      }
    }
    this.maxX = minX + (nx - 1) * step;
    this.maxZ = minZ + (nz - 1) * step;
  }

  contains(x, z) {
    return x >= this.minX && z >= this.minZ && x < this.maxX && z < this.maxZ;
  }

  sample(x, z) {
    const gx = (x - this.minX) * this.inv, gz = (z - this.minZ) * this.inv;
    if (gx < 0 || gz < 0 || gx >= this.nx - 1 || gz >= this.nz - 1) return this.fn(x, z);
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const d = this.data, n = this.nx, k = j * n + i;
    const a = d[k] + (d[k + 1] - d[k]) * fx;
    const b = d[k + n] + (d[k + n + 1] - d[k + n]) * fx;
    return a + (b - a) * fz;
  }
}
