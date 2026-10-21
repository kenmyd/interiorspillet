import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';

/**
 * Procedural seating (ARCHITECTURE §5, parts §13): armchairs, dining chairs, bar stools and sofas.
 *
 *   tub-swivel      round tub chair: barrel body / drum, wrap-around back band, swivel base variants
 *   wingback        wing chair: high (buttoned) back, wings, scroll or slim arms, footstool option
 *   lounge-wood     lounge chair on a visible wooden frame (wrapped back or wooden arms)
 *   club-box        boxy club chair (with or without arms, square or curved quilted back, skirt)
 *   recliner        reclining chair with headrest on a swivel base, matching footstool
 *   shell-legs      upholstered shell on legs or a swivel star
 *   rocking         rocking chair on bentwood runners
 *   dining-chair    upholstered shell dining chair on slim splayed legs
 *   bar-stool       counter stool with a quilted shell back and a foot rest frame
 *   sofa-modular-l  boxy modular corner sofa with a chaise, piped seams, loose seat/back cushions
 *   sofa-curved     organic sofa: pebble seat (convex front) + one back bolster: round arm → back → high curl
 *   sofa-straight   classic sofa with arms, seat and back cushions
 *
 * Everything is built from the dims and params (no plain scale-stretch): cushions keep their edge radius, legs
 * keep their thickness, piping keeps its diameter. Canonical parts: upholstery, legs, frame (wooden frames) and
 * piping (only where the data gives a contrast piping colour – otherwise piping follows the upholstery).
 * Every model reports seatY = top of the seat cushion.
 */

const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const QF = { low: 0.6, medium: 1, high: 1.5 };
const qf = (spec) => QF[spec.quality] ?? 1;

// ---------------------------------------------------------------------------------------------------------------
// Surface builders (metre UVs, smooth normals, outward winding)

/**
 * Indexed grid surface from rows of 3D points. Each row is a closed loop (same point count in every row);
 * consecutive rows are stitched. Rows that collapse to a point/line close the surface (caps). Winding is made
 * outward from the signed volume, UVs are arc lengths in metres (or box projection with uv: 'box').
 */
function gridGeometry(rows, { uv = 'grid' } = {}) {
  return stripsGeometry([{ rows, uv }]);
}

/**
 * Several grid strips in one geometry (shared boundary rows are repeated by the caller): each strip has its own
 * UV mapping – 'grid' (arc lengths along rows / columns), 'top' / 'bottom' (planar x/z, for caps) or 'box'
 * (box projection) – while the normals stay smooth across the strips (no visible seam, no texture smear).
 */
function stripsGeometry(strips) {
  const m = strips[0].rows[0].length;
  const nc = m + 1;
  const total = strips.reduce((s, st) => s + st.rows.length, 0);
  const pos = new Float32Array(total * nc * 3);
  const uvs = new Float32Array(total * nc * 2);
  const idx = [];
  const dist = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  let base = 0;
  let box = false;
  for (const st of strips) {
    const nr = st.rows.length;
    for (let i = 0; i < nr; i++) {
      const row = st.rows[i];
      for (let j = 0; j < nc; j++) {
        const p = row[j % m];
        const k = (base + i * nc + j) * 3;
        pos[k] = p[0];
        pos[k + 1] = p[1];
        pos[k + 2] = p[2];
      }
    }
    if (st.uv === 'top' || st.uv === 'bottom') {
      const sg = st.uv === 'top' ? -1 : 1;
      for (let k = base; k < base + nr * nc; k++) {
        uvs[k * 2] = pos[k * 3];
        uvs[k * 2 + 1] = sg * pos[k * 3 + 2];
      }
    } else if (st.uv && st.uv.A) {
      // planar projection on two given axes { A, B } (flat end discs of swept bands)
      const { A, B } = st.uv;
      for (let k = base; k < base + nr * nc; k++) {
        const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
        uvs[k * 2] = x * A[0] + y * A[1] + z * A[2];
        uvs[k * 2 + 1] = x * B[0] + y * B[1] + z * B[2];
      }
    } else if (st.uv && st.uv.cyl) {
      // cylindrical mapping round a vertical axis at c, angle measured from direction t (rounded band ends)
      const { c, t, r } = st.uv.cyl;
      for (let k = base; k < base + nr * nc; k++) {
        const dx = pos[k * 3] - c[0], dz = pos[k * 3 + 2] - c[1];
        uvs[k * 2] = r * Math.atan2(dx * t[1] - dz * t[0], dx * t[0] + dz * t[1]);
        uvs[k * 2 + 1] = pos[k * 3 + 1];
      }
    } else {
      if (st.uv === 'box') box = true;
      // u = arc length along each row – or along one reference row (st.uRow) for all rows, so rows of different
      // length (inset rings round a rounded edge) do not shear the texture into streaks
      const ref = st.uRow != null ? clamp(st.uRow, 0, nr - 1) : -1;
      for (let i = 0; i < nr; i++) {
        let s = 0;
        for (let j = 0; j < nc; j++) {
          const k = base + i * nc + j;
          if (ref >= 0) {
            const kr = base + ref * nc + j;
            if (j) s += dist(kr - 1, kr);
          } else if (j) s += dist(k - 1, k);
          uvs[k * 2] = s;
        }
      }
      for (let j = 0; j < nc; j++) {
        let s = 0;
        for (let i = 0; i < nr; i++) {
          const k = base + i * nc + j;
          if (i) s += dist(k - nc, k);
          uvs[k * 2 + 1] = s;
        }
      }
    }
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = base + i * nc + j, b = a + 1, c = a + nc, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    base += nr * nc;
  }
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  K.smoothNormals(g);
  if (box) K.worldUV(g);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Surface of revolution from a profile [[r, y], …] (bottom → top), optionally squashed along z (ez). Profile
 * indices ≤ bottomTo form a planar-mapped bottom cap, ≥ topFrom a planar-mapped top cap; the rest is the side.
 */
function revolveGeometry(profile, { seg = 48, ez = 1, bottomTo = 0, topFrom = Infinity } = {}) {
  const rows = profile.map(([r, y]) => {
    const row = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      row.push([Math.cos(a) * r, y, -Math.sin(a) * r * ez]);
    }
    return row;
  });
  const n = rows.length;
  const tf = Math.min(topFrom, n - 1);
  const strips = [];
  if (bottomTo > 0) strips.push({ rows: rows.slice(0, bottomTo + 1), uv: 'bottom' });
  strips.push({ rows: rows.slice(Math.max(0, bottomTo), tf + 1), uv: 'grid' });
  if (tf < n - 1) strips.push({ rows: rows.slice(tf), uv: 'top' });
  return stripsGeometry(strips);
}

/**
 * Closed loop around a rounded rectangle in a 2D section plane: a ∈ [−hw, hw] (thickness), b ∈ [b0, b1]
 * (height). Constant point count (8·ns + 4·nc) whatever the radii, so loops can be stitched.
 */
function roundRectLoop(hw, b0, b1, rTop, rBot, nc = 4, ns = 2, bulge = 0) {
  const H = Math.max(1e-4, b1 - b0);
  hw = Math.max(1e-5, hw);
  const rt = Math.max(0, Math.min(rTop, hw, H));
  const rb = Math.max(0, Math.min(rBot, hw, H - rt));
  const pts = [];
  const line = (a0, c0, a1, c1, n, bx) => {
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([a0 + (a1 - a0) * t + bx * Math.sin(Math.PI * t) * bulge, c0 + (c1 - c0) * t]);
    }
  };
  const arc = (ca, cb, r, t0, n) => {
    for (let k = 0; k < n; k++) {
      const t = t0 + (Math.PI / 2) * (k / n);
      pts.push([ca + r * Math.cos(t), cb + r * Math.sin(t)]);
    }
  };
  line(0, b0, hw - rb, b0, ns, 0);
  arc(hw - rb, b0 + rb, rb, -Math.PI / 2, nc);
  line(hw, b0 + rb, hw, b1 - rt, ns * 2, 1);
  arc(hw - rt, b1 - rt, rt, 0, nc);
  line(hw - rt, b1, -(hw - rt), b1, ns * 2, 0);
  arc(-(hw - rt), b1 - rt, rt, Math.PI / 2, nc);
  line(-hw, b1 - rt, -hw, b0 + rb, ns * 2, -1);
  arc(-(hw - rb), b0 + rb, rb, Math.PI, nc);
  line(-(hw - rb), b0, 0, b0, ns, 0);
  return pts;
}

/**
 * Samples a plan curve fn(t) → [x, z] (t ∈ 0..1) by arc length, with `endN` extra samples packed toward each end
 * (for the rounded end caps; `endLen` may be [start, end]). Returns { L, samples: [{ x, z, tx, tz, s, t }] }.
 */
function samplePath(fn, n, endLen = 0, endN = 4) {
  const N = 240;
  const fine = [];
  const cum = [0];
  for (let i = 0; i <= N; i++) fine.push(fn(i / N));
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const L = cum[N];
  const [e0, e1] = (Array.isArray(endLen) ? endLen : [endLen, endLen]).map((e) => clamp(e, 0, L * 0.45));
  const S = [];
  if (e0 > 0) for (let k = 0; k < endN; k++) S.push(e0 * (1 - Math.cos((Math.PI / 2) * (k / endN))));
  const m = Math.max(2, Math.round(n));
  for (let k = 0; k <= m; k++) S.push(e0 + ((L - e0 - e1) * k) / m);
  if (e1 > 0) for (let k = endN - 1; k >= 0; k--) S.push(L - e1 * (1 - Math.cos((Math.PI / 2) * (k / endN))));
  let seg = 0;
  const samples = S.map((s) => {
    while (seg < N - 1 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg] || 1e-9;
    const f = clamp((s - cum[seg]) / span, 0, 1);
    const a = fine[seg], b = fine[seg + 1];
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    return { x: a[0] + tx * f, z: a[1] + tz * f, tx: tx / tl, tz: tz / tl, s, t: (seg + f) / N };
  });
  return { L, samples };
}

/**
 * Upholstered band swept along a plan path (tub backs, wrap-around backs, sofa back rolls). The section is a
 * rounded rectangle standing on y0: thickness thick(u) across the path, height height(u) (absolute top y), both
 * functions of the arc-length fraction u. Ends are rounded (semicircular in plan, rounded top corner). `lean(u)`
 * moves the section outward per metre of height (recline), `shift(u)` moves it sideways. `rTop` (fraction of the
 * half thickness) and `rBot` (metres) may be functions of u too. `startCap` / `endCap` = { len, concentric }:
 * len scales the plan length of the rounding (1 = semicircle, < 1 flatter); concentric shrinks the whole section
 * toward its centre (the domed end of a lying bolster) instead of only rounding the top corner. capUV: the end
 * caps get a planar mapping across the path (no texture streaks where the section shrinks to a point / line).
 */
function bandGeometry(path, o) {
  const { L, samples } = path;
  const { y0 = 0, height, thick, center = [0, 0], rTop = 1, rBot = 0.01, lean, shift, nc = 4, ns = 2, bulge = 0, startCap, endCap, capUV = false } = o;
  const val = (f, u, sm) => (typeof f === 'function' ? f(u, sm) : f);
  const inCap = [];
  const rows = samples.map((sm, i) => {
    const u = sm.s / L;
    const T = val(thick, u, sm);
    const Y0 = val(y0, u, sm);
    const H = val(height, u, sm) - Y0;
    let nx = sm.tz, nz = -sm.tx;
    if ((sm.x - center[0]) * nx + (sm.z - center[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const re = T / 2;
    const atStart = sm.s <= L - sm.s;
    const cap = (atStart ? startCap : endCap) || {};
    const eLen = re * (cap.len ?? 1);
    const dEnd = atStart ? sm.s : L - sm.s;
    let f = 1;
    if (dEnd < eLen) {
      const k = 1 - dEnd / eLen;
      f = Math.sqrt(Math.max(0, 1 - k * k));
    }
    inCap[i] = f < 1 ? (atStart ? -1 : 1) : 0;
    const hw = Math.max(1e-5, re * f);
    let b0 = 0, top;
    if (cap.concentric) {
      const c = Math.max(0.004, H) / 2;
      b0 = c * (1 - f);
      top = Math.max(b0 + 0.002, c * (1 + f));
    } else top = Math.max(0.004, H - re * (1 - f));
    const ln = lean ? val(lean, u, sm) : 0;
    const sh = shift ? val(shift, u, sm) : 0;
    const loop = roundRectLoop(hw, b0, top, val(rTop, u, sm) * hw, val(rBot, u, sm) * f, nc, ns, bulge * f);
    return loop.map(([a, b]) => {
      const aa = a + sh + ln * b;
      return [sm.x + nx * aa, Y0 + b, sm.z + nz * aa];
    });
  });
  if (!capUV) return gridGeometry(rows);
  const n = rows.length;
  let i0 = 0, i1 = n - 1;
  while (i0 < n - 1 && inCap[i0] === -1) i0++;
  while (i1 > i0 && inCap[i1] === 1) i1--;
  // concentric caps are flat discs → planar across the path; rounded ends → cylindrical round the end's axis
  const capMap = (cap, sm, dir) => (cap?.concentric
    ? { A: [sm.tz, 0, -sm.tx], B: [0, 1, 0] }
    : { cyl: { c: [sm.x, sm.z], t: [sm.tx * dir, sm.tz * dir], r: val(thick, sm.s / L, sm) / 2 } });
  const strips = [];
  if (i0 > 0) strips.push({ rows: rows.slice(0, i0 + 1), uv: capMap(startCap, samples[i0], -1) });
  strips.push({ rows: rows.slice(i0, i1 + 1), uv: 'grid' });
  if (i1 < n - 1) strips.push({ rows: rows.slice(i1), uv: capMap(endCap, samples[i1], 1) });
  return stripsGeometry(strips);
}

/**
 * Welt (piping) along the rounded top edge of a band made with the same options: on the outer (side = 1) or inner
 * (side = −1) shoulder at 45°, stopping short of the rounded ends.
 */
function bandWelt(path, o, { side = 1, r = 0.0045, q = 1 } = {}) {
  const { L, samples } = path;
  const { y0 = 0, height, thick, center = [0, 0], rTop = 1, lean, shift } = o;
  const val = (f, u, sm) => (typeof f === 'function' ? f(u, sm) : f);
  const pts = [];
  for (const sm of samples) {
    const u = sm.s / L;
    const T = val(thick, u, sm);
    if (Math.min(sm.s, L - sm.s) < T * 0.7) continue;
    const Y0 = val(y0, u, sm);
    const top = val(height, u, sm) - Y0;
    let nx = sm.tz, nz = -sm.tx;
    if ((sm.x - center[0]) * nx + (sm.z - center[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const hw = T / 2, rt = Math.min(val(rTop, u, sm) * hw, hw);
    const a = side * (hw - rt + rt * Math.SQRT1_2 + r * 0.3), b = top - rt + rt * Math.SQRT1_2 + r * 0.3;
    const aa = a + (shift ? val(shift, u, sm) : 0) + (lean ? val(lean, u, sm) : 0) * b;
    pts.push(new THREE.Vector3(sm.x + nx * aa, Y0 + b, sm.z + nz * aa));
  }
  return pts.length > 2 ? seamTube(pts, r, { radial: q < 1 ? 3 : 4 }) : null;
}

/** Per-point tangents and outward normals (away from `center`) of an open or closed plan polyline. */
function curveFrames(pts, center, closed = false) {
  const m = pts.length;
  const N = [], Tg = [];
  for (let j = 0; j < m; j++) {
    const a = closed ? pts[(j - 1 + m) % m] : pts[Math.max(0, j - 1)];
    const b = closed ? pts[(j + 1) % m] : pts[Math.min(m - 1, j + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    let nx = tz, nz = -tx;
    if ((pts[j][0] - center[0]) * nx + (pts[j][1] - center[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    N.push([nx, nz]);
    Tg.push([tx, tz]);
  }
  return { N, Tg };
}

/**
 * Plan loop around an open curve with thickness T: outer side, rounded end, inner side, rounded start.
 * `pad[j]` (optional) thickens the inner side per point (quilted padding).
 */
function curveLoop(pts, T, center, nEnd = 4, pad) {
  const m = pts.length;
  const { N, Tg } = curveFrames(pts, center);
  const h = Math.max(1e-5, T / 2);
  const loop = [];
  for (let j = 0; j < m; j++) loop.push([pts[j][0] + N[j][0] * h, pts[j][1] + N[j][1] * h]);
  {
    const p = pts[m - 1], n = N[m - 1], t = Tg[m - 1];
    for (let k = 1; k < nEnd; k++) {
      const f = (Math.PI * k) / nEnd;
      loop.push([p[0] + (n[0] * Math.cos(f) + t[0] * Math.sin(f)) * h, p[1] + (n[1] * Math.cos(f) + t[1] * Math.sin(f)) * h]);
    }
  }
  for (let j = m - 1; j >= 0; j--) {
    const hi = h + (pad ? pad[j] : 0);
    loop.push([pts[j][0] - N[j][0] * hi, pts[j][1] - N[j][1] * hi]);
  }
  {
    const p = pts[0], n = N[0], t = Tg[0];
    for (let k = 1; k < nEnd; k++) {
      const f = (Math.PI * k) / nEnd;
      loop.push([p[0] + (-n[0] * Math.cos(f) - t[0] * Math.sin(f)) * h, p[1] + (-n[1] * Math.cos(f) - t[1] * Math.sin(f)) * h]);
    }
  }
  return loop;
}

/**
 * Upholstered shell from stacked plan curves (dining chair / bar stool backs): levels [{ y, pts, T }] bottom → top,
 * every level an open plan curve with the same point count. Top and bottom get rounded (bull-nose) caps of
 * radius T/2 beyond the first/last level.
 */
function shellGeometry(levels, { center = [0, 0], nEnd = 4, nCap = 4, topPts } = {}) {
  const rows = [];
  const add = (pts, T, y, pad) => rows.push(curveLoop(pts, T, center, nEnd, pad).map(([x, z]) => [x, y, z]));
  const first = levels[0], last = levels[levels.length - 1];
  for (let k = nCap; k >= 1; k--) {
    const f = (Math.PI / 2) * (k / nCap);
    add(first.pts, first.T * Math.cos(f), first.y - (first.T / 2) * Math.sin(f));
  }
  for (const l of levels) add(l.pts, l.T, l.y, l.pad);
  for (let k = 1; k <= nCap; k++) {
    const f = (Math.PI / 2) * (k / nCap);
    const y = last.y + (last.T / 2) * Math.sin(f);
    add(topPts ? topPts(y) : last.pts, last.T * Math.cos(f), y);
  }
  return gridGeometry(rows);
}

/**
 * Rounded slab from a closed plan outline [[x, z], …]: flat-ish bottom, rounded bottom/top edges, optional belly
 * (side bulge) and dome (top crown). Seats, cushions with organic outlines, plinths. Box-projected metre UVs.
 */
function slabGeometry(outline, { y0, y1, rTop = 0.02, rBot = 0.01, dome = 0, belly = 0, nEdge = 3, nCap = 4 }) {
  const m = outline.length;
  let cx = 0, cz = 0;
  for (const p of outline) {
    cx += p[0];
    cz += p[1];
  }
  cx /= m;
  cz /= m;
  const { N } = curveFrames(outline, [cx, cz], true);
  const H = Math.max(0.004, y1 - y0);
  const rt = Math.min(rTop, H * 0.95);
  const rb = Math.min(rBot, Math.max(0.001, H - rt));
  const ring = (inset, y, s = 1, lift = 0) => outline.map((p, j) => {
    const x = p[0] - N[j][0] * inset, z = p[1] - N[j][1] * inset;
    return [cx + (x - cx) * s, y + lift, cz + (z - cz) * s];
  });
  const bottom = [];
  for (let k = 0; k <= nCap; k++) bottom.push(ring(rb, y0, k / nCap));
  const side = [];
  for (let k = 0; k <= nEdge; k++) {
    const f = -Math.PI / 2 + (Math.PI / 2) * (k / nEdge);
    side.push(ring(rb * (1 - Math.cos(f)), y0 + rb * (1 + Math.sin(f))));
  }
  if (belly) side.push(ring(-belly, (y0 + rb + y1 - rt) / 2));
  for (let k = 0; k <= nEdge; k++) {
    const f = (Math.PI / 2) * (k / nEdge);
    side.push(ring(rt * (1 - Math.cos(f)), y1 - rt * (1 - Math.sin(f))));
  }
  const top = [];
  for (let k = nCap; k >= 0; k--) {
    const s = k / nCap;
    top.push(ring(rt, y1, s, dome * (1 - s * s)));
  }
  // caps mapped flat, the rounded rim along its length (no box-projection smear on the rounded corners); the rim's
  // u follows the full outline ring for every ring (no shear streaks on the rounded edges)
  return stripsGeometry([{ rows: bottom, uv: 'bottom' }, { rows: side, uv: 'grid', uRow: nEdge }, { rows: top, uv: 'top' }]);
}

/**
 * Rounded-rectangle plan outline (x0..x1, z0..z1) with back (−z) and front (+z) corner radii – each a number or
 * [left (−x), right (+x)]; `front(x)` bows the front edge.
 */
function rrOutline(x0, x1, z0, z1, rBack, rFront, n = 6, sideN = 4, front) {
  const hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
  const lim = Math.min(hw, hd) * 0.999;
  const pair = (r) => (Array.isArray(r) ? r : [r, r]).map((v) => clamp(v, 0.003, lim));
  let [rbl, rbr] = pair(rBack);
  let [rfl, rfr] = pair(rFront);
  // unequal radii: keep every straight side ≥ 0 (no back-and-forth points)
  const fit = (a, b, len) => (a + b > len * 0.999 ? (len * 0.999) / (a + b) : 1);
  const kx = Math.min(fit(rbl, rbr, 2 * hw), fit(rfl, rfr, 2 * hw)), kz = Math.min(fit(rbl, rfl, 2 * hd), fit(rbr, rfr, 2 * hd));
  const ks = Math.min(kx, kz);
  [rbl, rbr, rfl, rfr] = [rbl * ks, rbr * ks, rfl * ks, rfr * ks];
  const pts = [];
  const arc = (cx, cz, r, a0) => {
    for (let k = 0; k <= n; k++) {
      const a = a0 + (Math.PI / 2) * (k / n);
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  };
  const line = (ax, az, bx, bz) => {
    for (let k = 1; k < sideN; k++) pts.push([lerp(ax, bx, k / sideN), lerp(az, bz, k / sideN)]);
  };
  arc(x0 + rbl, z0 + rbl, rbl, Math.PI); // back-left
  line(x0 + rbl, z0, x1 - rbr, z0);
  arc(x1 - rbr, z0 + rbr, rbr, -Math.PI / 2); // back-right
  line(x1, z0 + rbr, x1, z1 - rfr);
  arc(x1 - rfr, z1 - rfr, rfr, 0); // front-right
  line(x1 - rfr, z1, x0 + rfl, z1);
  arc(x0 + rfl, z1 - rfl, rfl, Math.PI / 2); // front-left
  line(x0, z1 - rfl, x0, z0 + rbl);
  if (front) {
    const zc = (z0 + z1) / 2;
    for (const p of pts) if (p[1] > zc) p[1] += front(p[0]) * ((p[1] - zc) / hd);
  }
  return pts;
}

/** Ellipse plan outline. */
function ellipseOutline(rx, rz, cz = 0, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

/** Points of a rounded rectangle in the plane spanned by unit axes A, B around a centre (for piping loops). */
function rectLoop3(center, A, B, ha, hb, rc, n = 3) {
  const r = clamp(rc, 0.002, Math.min(ha, hb) * 0.95);
  const pts = [];
  const corners = [[ha - r, hb - r, 0], [-(ha - r), hb - r, Math.PI / 2], [-(ha - r), -(hb - r), Math.PI], [ha - r, -(hb - r), Math.PI * 1.5]];
  for (const [ca, cb, a0] of corners) {
    for (let k = 0; k <= n; k++) {
      const a = a0 + (Math.PI / 2) * (k / n);
      const pa = ca + r * Math.cos(a), pb = cb + r * Math.sin(a);
      pts.push(new THREE.Vector3(center[0] + A[0] * pa + B[0] * pb, center[1] + A[1] * pa + B[1] * pb, center[2] + A[2] * pa + B[2] * pb));
    }
  }
  return pts;
}

/**
 * Thin tube (piping, seams) through points on a centripetal Catmull-Rom curve – no overshoot where the point
 * spacing is uneven (rounded-rectangle loops). UVs in metres (u along, v around).
 */
function seamTube(points, r, { closed = false, radial = 4, seg } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const length = curve.getLength();
  const g = new THREE.TubeGeometry(curve, seg ?? Math.max(8, Math.round(length * 30)), r, radial, closed);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length, uv.getY(i) * 2 * Math.PI * r);
  return g;
}

/** Closed piping tube along a rounded rectangle. */
function pipeLoop(center, A, B, ha, hb, rc, r, q) {
  const per = 4 * (ha + hb);
  return seamTube(rectLoop3(center, A, B, ha, hb, rc), r, { closed: true, radial: q < 1 ? 3 : 4, seg: Math.max(24, Math.round(per * 20 * q)) });
}

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

/**
 * Piping loops on a softBox() cushion centred at c (geometry carries its face-edge planes after K.cushion's
 * bulge-and-rescale): the seam sits on the rounded edge. faces: any of top, bottom, front, back, left, right.
 */
function cushionPiping(c, geo, faces, r, q) {
  const E = geo.userData.edges, R = geo.userData.R;
  const e = R * 0.3; // seam inset from the face planes (≈ 45° on the edge rounding)
  const rc = R * 0.75;
  const mid = (k) => (E[k][0] + E[k][1]) / 2, half = (k) => (E[k][1] - E[k][0]) / 2 - e;
  const out = [];
  for (const f of faces) {
    if (f === 'top' || f === 'bottom') {
      const y = c[1] + (f === 'top' ? E.y[1] - e : E.y[0] + e);
      out.push(pipeLoop([c[0] + mid('x'), y, c[2] + mid('z')], X, Z, half('x'), half('z'), rc, r, q));
    } else if (f === 'front' || f === 'back') {
      const z = c[2] + (f === 'front' ? E.z[1] - e : E.z[0] + e);
      out.push(pipeLoop([c[0] + mid('x'), c[1] + mid('y'), z], X, Y, half('x'), half('y'), rc, r, q));
    } else {
      const x = c[0] + (f === 'right' ? E.x[1] - e : E.x[0] + e);
      out.push(pipeLoop([x, c[1] + mid('y'), c[2] + mid('z')], Z, Y, half('z'), half('y'), rc, r, q));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials and small parts

/** Upholstery / piping / frame / legs materials of a spec (cached mat()s, so SceneSync can recolour). */
function materials(spec, style) {
  const C = spec.colors, M = spec.materials;
  const upKind = M.upholstery || 'woven';
  const up = mat(upKind, C.upholstery);
  const hasPipeColor = !!C.piping;
  // self-welts (upholstery colour): untextured – a 4 mm cord shows no weave. A contrast piping cord uses the same
  // textured fabric material as the cover (with its sheen): the flat, sheen-less variant shaded much darker than the
  // fabric beside it and drew a cartoon outline round every cushion (082736 shows only a slightly darker cord)
  const pipe = hasPipeColor ? mat(M.piping || upKind, C.piping) : mat(upKind, C.upholstery, { flat: true });
  let legKind = M.legs || 'black-metal';
  let legHex = C.legs;
  const fabricBase = style === 'drum' || style === 'plinth' || style === 'none';
  if (!fabricBase && kindGroup(legKind) === 'fabric') {
    // an upholstered base colour on a metal base style: use dark metal instead
    legKind = 'black-metal';
    legHex = '#1c1c1c';
  }
  const frameKind = M.frame || (kindGroup(legKind) === 'wood' ? legKind : 'oak');
  return {
    up,
    pipe,
    pipePart: hasPipeColor ? 'piping' : 'upholstery',
    legs: (opts) => mat(legKind, legHex, opts),
    legKind,
    frame: (opts) => mat(frameKind, C.frame || legHex, opts),
  };
}

const _UP = new THREE.Vector3(0, 1, 0);

/** Straight (tapered) leg between two points; rTop at `top`. */
function addLeg(g, material, part, top, bottom, rTop, rBot, { seg = 12, square = false } = {}) {
  const dir = new THREE.Vector3(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]);
  const len = dir.length();
  if (len < 0.004) return null;
  dir.normalize();
  const geo = K.taperLeg(len, rTop, rBot, { seg, square });
  const m = K.partMesh(geo, material, part, { position: bottom });
  m.quaternion.setFromUnitVectors(_UP, dir);
  g.add(m);
  return m;
}

/**
 * Four legs under a seat frame: tops at (±ax, topY, front az1 / back az0), feet splayed outward by the given
 * angles. style 'wood-taper' (round, tapered), 'slim-metal' (thin square), 'block' (short square feet).
 */
function fourLegs(g, ms, style, { ax, az0, az1, topY, q, rTop, rBot, splayX = 4, splayF = 6, splayB = 8, square }) {
  const wood = kindGroup(ms.legKind) === 'wood';
  const m = ms.legs(square ? undefined : { grain: 'v' });
  const seg = Math.max(6, Math.round((wood ? 12 : 10) * q));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = sz > 0 ? az1 : az0;
      const dx = Math.tan(splayX * DEG) * topY * sx;
      const dz = Math.tan((sz > 0 ? splayF : splayB) * DEG) * topY * sz;
      addLeg(g, m, 'legs', [sx * ax, topY, z], [sx * ax + dx, 0, z + dz], rTop, rBot, { seg, square });
    }
  }
}

/** Round swivel plate with a short column up to topY (metal). */
function swivelDisc(g, ms, r, topY, q) {
  const colR = 0.032;
  const t = Math.min(0.014, topY * 0.5);
  const prof = [[0.001, 0], [r - 0.006, 0], [r, 0.003], [r - 0.002, t * 0.8], [r * 0.9, t], [colR * 2.2, t + 0.004]];
  if (topY > t + 0.02) prof.push([colR * 1.2, t + 0.012], [colR, t + 0.02], [colR, topY - 0.008], [colR * 3.2, topY - 0.006], [colR * 3.4, topY]);
  else prof.push([colR * 3.4, topY]);
  prof.push([0.001, topY]);
  g.add(K.partMesh(K.lathe(prof, { seg: Math.max(16, Math.round(40 * q)) }), ms.legs(), 'legs'));
}

/** Swivel star (cross) base: tapered arms from a hub, glides, column up to topY. */
function swivelStar(g, ms, r, topY, q, arms = 4) {
  const m = ms.legs();
  const hubR = 0.045, hubH = Math.min(0.07, topY * 0.8);
  g.add(K.partMesh(K.cylinder(hubR * 0.9, hubR, hubH, { seg: Math.max(12, Math.round(24 * q)) }), m, 'legs'));
  const len = Math.max(0.08, r - 0.01);
  const shape = [[0, 0.012], [len - 0.012, 0.008], [len, 0.012], [len, 0.026], [len - 0.03, 0.032], [0, Math.max(0.035, hubH * 0.85)]];
  const geo = K.extrudeShape(shape, 0.042, { bevel: 0.006, center: true, curveSegments: 4 });
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
    g.add(K.partMesh(i ? geo.clone() : geo, m, 'legs', { rotation: [0, -a, 0] }));
    g.add(K.partMesh(K.cylinder(0.016, 0.018, 0.009, { seg: 10 }), m, 'legs', { position: [Math.cos(a) * (len - 0.025), 0, Math.sin(a) * (len - 0.025)] }));
  }
  if (topY > hubH + 0.005) g.add(K.partMesh(K.cylinder(0.026, 0.028, topY - hubH, { seg: Math.max(10, Math.round(18 * q)) }), m, 'legs', { position: [0, hubH, 0] }));
  g.add(K.partMesh(K.cylinder(0.11, 0.11, 0.008, { seg: Math.max(12, Math.round(24 * q)) }), m, 'legs', { position: [0, topY - 0.008, 0] }));
}

/** Hidden glides under a skirted / plinth-less piece (a thin dark shadow line). */
function glides(g, ms, ax, az) {
  const m = mat('plastic', '#1a1a1a');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(K.partMesh(K.cylinder(0.02, 0.02, 0.012, { seg: 10 }), m, null, { position: [sx * ax, 0, sz * az] }));
}

/**
 * Base under a rectangular seat frame of half-size (hx, hz) whose underside is at topY.
 * styles: wood-taper, slim-metal, block, swivel-disc, swivel-star, none, plinth.
 */
function addBase(g, ms, style, { hx, hz, topY, q, z = 0, inset = 0.05 }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  if (style === 'swivel-disc') swivelDisc(sub, ms, clamp(Math.min(hx, hz) * 0.82, 0.16, 0.3), topY, q);
  else if (style === 'swivel-star') swivelStar(sub, ms, clamp(Math.min(hx, hz) * 1.05, 0.2, 0.36), topY, q);
  else if (style === 'block') {
    const m = ms.legs();
    const s = 0.045;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sub.add(K.partMesh(K.roundedBox(s, Math.max(0.01, topY), s, 0.004, 1, { bottom: true }), m, 'legs', { position: [sx * (hx - inset - 0.01), 0, sz * (hz - inset - 0.01)] }));
  } else if (style === 'none') glides(sub, ms, hx - 0.08, hz - 0.08);
  else if (style === 'plinth') {
    if (topY > 0.004) sub.add(K.partMesh(slabGeometry(rrOutline(-hx + 0.03, hx - 0.03, -hz + 0.03, hz - 0.03, 0.02, 0.02, 3, 3), { y0: 0, y1: topY + 0.002, rTop: 0.003, rBot: 0.002, nEdge: 1, nCap: 2 }), ms.legs(), 'legs'));
  } else if (style === 'slim-metal') {
    fourLegs(sub, ms, style, { ax: hx - inset, az0: -hz + inset, az1: hz - inset, topY, q, rTop: 0.011, rBot: 0.008, splayX: 4, splayF: 7, splayB: 9, square: true });
  } else {
    const r = clamp(0.012 + topY * 0.04, 0.014, 0.024);
    fourLegs(sub, ms, style, { ax: hx - inset, az0: -hz + inset, az1: hz - inset, topY, q, rTop: r, rBot: r * 0.62, splayX: 5, splayF: 6, splayB: 9 });
  }
}

/** Default leg height per base style. */
function legHeightFor(style, fallback) {
  switch (style) {
    case 'swivel-disc': return 0.05;
    case 'swivel-star': return 0.14;
    case 'block': return 0.025;
    case 'none': return 0.012;
    case 'plinth': return 0.03;
    case 'slim-metal': return 0.38;
    default: return fallback;
  }
}

/** Small pill on a seat: puffy K.cushion with the bottom on y. */
function softBox(w, h, d, axis, { puff = 0.12, round = 0.6, sides = 0.2, top = 1, bottom = 0.5, pinch, seg = 10, q = 1 } = {}) {
  const geo = K.cushion(w, h, d, { axis, puff, round, sides, top, bottom, pinch, seg: Math.max(5, Math.round(seg * q)) });
  // face-edge planes after K.cushion's bulge + rescale to exactly w × h × d (for piping)
  const dims = [w, h, d], A = 'xyz'.indexOf(axis), thin = dims[A];
  const edges = {};
  for (let k = 0; k < 3; k++) {
    const hf = dims[k] / 2;
    let hi = hf, lo = hf;
    if (k === A) {
      hi += puff * thin * top;
      lo += puff * thin * bottom;
    } else if (sides) {
      hi += sides * thin * 0.5;
      lo += sides * thin * 0.5;
    }
    const sc = dims[k] / (hi + lo), cc = (hi - lo) / 2;
    edges['xyz'[k]] = [(-hf - cc) * sc, (hf - cc) * sc];
  }
  geo.userData.edges = edges;
  geo.userData.R = (clamp01(round) * thin) / 2;
  return geo;
}

/** Adds a softBox cushion at pos (+ piping loops on the given faces). */
function addCushion(parent, ms, geo, pos, faces, q, r = 0.0042) {
  parent.add(K.partMesh(geo, ms.up, 'upholstery', { position: pos }));
  if (faces) for (const pg of cushionPiping(pos, geo, faces, r, q)) parent.add(K.partMesh(pg, ms.pipe, ms.pipePart));
}

/** Footstool (ottoman) for recliners / wing chairs, centred at z; returns its collider. */
function addFootstool(g, spec, ms, style, { w, d, h, z, q, tilt = 0 }) {
  const fs = new THREE.Group();
  fs.position.z = z;
  g.add(fs);
  const legH = style === 'swivel-disc' || style === 'swivel-star' ? 0.1 : style === 'wood-taper' ? Math.min(0.14, h * 0.4) : legHeightFor(style, 0.1);
  const top = new THREE.Group();
  top.position.y = legH;
  top.rotation.x = tilt;
  fs.add(top);
  const bodyH = Math.max(0.06, h - legH);
  const geo = softBox(w, bodyH, d, 'y', { puff: 0.1, round: 0.55, sides: 0.15, bottom: 0.2, q });
  top.add(K.partMesh(geo, ms.up, 'upholstery', { position: [0, bodyH / 2, 0] }));
  addBase(fs, ms, style, { hx: w / 2, hz: d / 2, topY: legH, q, inset: 0.05 });
  return { min: [-w / 2, 0, z - d / 2], max: [w / 2, h, z + d / 2] };
}

// ---------------------------------------------------------------------------------------------------------------
// Tub swivel chair

function buildTub(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'drum';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const Rx = w / 2, Rz = d / 2;
  const R = Math.min(Rx, Rz);
  const ez = Rz / Rx; // the lower body is a lathe scaled along z by this
  const loose = P.cushion === 'loose';
  const seatH = clamp(num(P.seatH, 0.45), 0.25, h - 0.15);
  const T = clamp(num(P.shellT, num(P.armW, 0.1)), 0.05, R * 0.45);
  const wrap = clamp(num(P.backWrapDeg, 200), 120, 320) * DEG;
  const backH = h; // the back is the tallest part (dims.h); P.backH from the data equals h
  const armH = clamp(num(P.armH, backH), seatH + 0.08, backH);
  const endH = lerp(backH, armH, clamp(num(P.armSlope, 0.85), 0, 1));
  const bodyTop = loose ? seatH - 0.085 : seatH;
  const yb = style === 'drum' ? 0 : clamp(num(P.legH, legHeightFor(style, 0.16)), 0.01, bodyTop - 0.12);
  const baseH = style === 'drum' ? clamp(num(P.baseH, 0.3), 0.06, bodyTop - 0.08) : yb;
  const r0 = style === 'drum' ? clamp(num(P.baseD, 0.64) / 2, 0.12, R) : R * 0.8;
  const rMax = Rx * 0.985;
  const rr = 0.055; // top edge rounding of the seat body
  const sideTop = bodyTop - rr;
  // barrel radius at height y (widens from r0 at yb to rMax near the top)
  const rAt = (y) => {
    const t = clamp((y - yb) / Math.max(0.01, sideTop - yb), 0, 1);
    return r0 + (rMax - r0) * (1 - (1 - t) ** 2.2);
  };
  const latheSeg = Math.max(20, Math.round(56 * q));
  const sideSamples = (ya, yb2, n) => {
    const out = [];
    for (let k = 0; k <= n; k++) {
      const y = lerp(ya, yb2, k / n);
      out.push([rAt(y), y]);
    }
    return out;
  };
  // lower body
  if (style === 'drum') {
    // the drum runs 2 cm up inside the seat body so the joint reads as a fine seam, not a step
    const drum = [[0.001, 0], [r0 - 0.014, 0], [r0 - 0.004, 0.004], [r0, 0.014], ...sideSamples(0.03, baseH, 5), [rAt(baseH + 0.02) - 0.003, baseH + 0.02], [0.001, baseH + 0.02]];
    g.add(K.partMesh(revolveGeometry(drum, { seg: latheSeg, ez, bottomTo: 1 }), ms.legs(), 'legs'));
  }
  const body = [[0.001, baseH]];
  if (style === 'drum') body.push([rAt(baseH) - 0.002, baseH], [rAt(baseH + 0.002), baseH + 0.002], ...sideSamples(baseH + 0.008, sideTop, 6));
  else body.push([r0 - 0.05, yb], [r0 - 0.012, yb + 0.006], [r0 + 0.004, yb + 0.03], ...sideSamples(yb + 0.06, sideTop, 5));
  for (let k = 1; k <= 4; k++) {
    const a = (Math.PI / 2) * (k / 4);
    body.push([rMax - rr + rr * Math.cos(a), sideTop + rr * Math.sin(a)]);
  }
  const topFrom = body.length - 1;
  body.push([rMax * 0.8, bodyTop + 0.009], [rMax * 0.45, bodyTop + 0.017], [0.001, bodyTop + 0.02]);
  g.add(K.partMesh(revolveGeometry(body, { seg: latheSeg, ez, bottomTo: 1, topFrom }), ms.up, 'upholstery'));
  // seat welt
  if (P.piping !== false) {
    const pr = rMax - rr + rr * Math.cos(Math.PI / 4) + 0.002;
    const tor = K.torus(pr, 0.0045, { radial: 5, tubular: Math.max(32, Math.round(80 * q)) });
    tor.rotateX(Math.PI / 2);
    tor.scale(1, 1, ez);
    g.add(K.partMesh(tor, ms.pipe, ms.pipePart, { position: [0, sideTop + rr * Math.sin(Math.PI / 4) + 0.001, 0] }));
  }
  // base under the body
  if (style !== 'drum') {
    if (style === 'swivel-disc') swivelDisc(g, ms, clamp(R * 0.62, 0.15, 0.3), yb + 0.004, q);
    else if (style === 'swivel-star') swivelStar(g, ms, clamp(R * 0.92, 0.22, 0.36), yb + 0.004, q);
    else addBase(g, ms, style, { hx: Rx * 0.72, hz: Rz * 0.72, topY: yb + 0.01, q, inset: 0 });
  }
  // back band around the seat
  const leanOff = (backH - bodyTop + 0.06) * Math.tan(4 * DEG);
  const tx = Rx - T / 2, tz = Rz - T / 2 - leanOff;
  const path = samplePath((t) => {
    const a = -wrap / 2 + wrap * t;
    return [tx * Math.sin(a), -tz * Math.cos(a)];
  }, Math.round(44 * q), T / 2, 4);
  const bandOpts = {
    y0: bodyTop - 0.06,
    thick: (u) => T * (1 - 0.15 * sstep(0.45, 1, Math.abs(2 * u - 1))),
    height: (u) => backH - (backH - endH) * sstep(0.18, 1.02, Math.abs(2 * u - 1)),
    lean: (u) => Math.tan(4 * DEG) * Math.cos(((2 * u - 1) * wrap) / 2) ** 2,
    rTop: 1,
    rBot: 0.035,
    bulge: 0.004,
    nc: q < 1 ? 3 : 4,
    ns: 2,
  };
  g.add(K.partMesh(bandGeometry(path, bandOpts), ms.up, 'upholstery'));
  if (P.piping !== false) {
    const welt = bandWelt(path, bandOpts, { side: 1, r: 0.004, q });
    if (welt) g.add(K.partMesh(welt, ms.pipe, ms.pipePart));
  }
  // loose cushions (seat + inner back roll)
  if (loose) {
    const sx = Rx - T * 0.55, sz = Rz - T * 0.55;
    const seat = slabGeometry(ellipseOutline(sx, sz, T * 0.2, Math.max(24, Math.round(40 * q))), { y0: bodyTop - 0.004, y1: seatH, rTop: 0.035, rBot: 0.02, dome: 0.012, belly: 0.004 });
    g.add(K.partMesh(seat, ms.up, 'upholstery'));
    const iw = wrap * 0.72;
    const bx = Rx - T - 0.05, bz = Rz - T - 0.05;
    const bp = samplePath((t) => {
      const a = -iw / 2 + iw * t;
      return [bx * Math.sin(a), -bz * Math.cos(a)];
    }, Math.round(30 * q), 0.055, 4);
    g.add(K.partMesh(bandGeometry(bp, { y0: seatH - 0.02, thick: 0.11, height: (u) => backH - 0.05 - 0.06 * sstep(0.4, 1, Math.abs(2 * u - 1)), lean: Math.tan(12 * DEG), rTop: 1, rBot: 0.04, bulge: 0.008, nc: 3, ns: 2 }), ms.up, 'upholstery'));
  }
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Shell chair on legs / swivel star (and the shared U-shaped wrap band)

/** Wrap-around back band on an elliptic U path around (0, zc). */
function wrapBand({ rx, rz, zc = 0, wrap, T, Tend = T, y0, backH, endH, endFrom = 0.35, recline = 8, q }) {
  const path = samplePath((t) => {
    const a = -wrap / 2 + wrap * t;
    return [rx * Math.sin(a), zc - rz * Math.cos(a)];
  }, Math.round(44 * q), T / 2, 4);
  return bandGeometry(path, {
    y0,
    center: [0, zc],
    thick: (u) => lerp(T, Tend, sstep(0.3, 1, Math.abs(2 * u - 1))),
    height: (u) => backH - (backH - endH) * sstep(endFrom, 1, Math.abs(2 * u - 1)),
    lean: (u) => Math.tan(recline * DEG) * Math.max(0, Math.cos(((2 * u - 1) * wrap) / 2)) ** 1.5,
    rTop: 1,
    rBot: 0.015,
    bulge: 0.005,
    nc: q < 1 ? 3 : 4,
    ns: 2,
  });
}

function buildShellLegs(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'wood-taper';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.42), 0.3, h - 0.15);
  const backH = h; // the back is the tallest part (dims.h); P.backH from the data equals h
  const legH = clamp(num(P.legH, legHeightFor(style, 0.17)), 0.02, seatH - 0.14);
  const T = clamp(num(P.shellT, 0.1), 0.05, 0.16);
  const armed = num(P.armH, 0) > seatH + 0.04;
  const endH = armed ? clamp(P.armH, seatH + 0.05, backH) : seatH + 0.03;
  const cushT = 0.085;
  const bodyTop = seatH - cushT;
  // seat pan: a rounded tub under the cushion
  const pan = rrOutline(-w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.01, d / 2 - 0.015, Math.min(w, d) * 0.42, 0.11, 7, 4);
  g.add(K.partMesh(slabGeometry(pan, { y0: legH, y1: bodyTop + 0.01, rTop: 0.03, rBot: Math.min(0.06, (bodyTop - legH) * 0.6), belly: 0.006 }), ms.up, 'upholstery'));
  // seat cushion inside the shell
  const seat = rrOutline(-w / 2 + T * 0.75, w / 2 - T * 0.75, -d / 2 + T * 0.8, d / 2 - 0.005, Math.min(w, d) * 0.3, 0.09, 7, 4, (x) => 0.012 * (1 - (x / (w / 2)) ** 2));
  g.add(K.partMesh(slabGeometry(seat, { y0: bodyTop, y1: seatH, rTop: 0.032, rBot: 0.015, dome: 0.012, belly: 0.004 }), ms.up, 'upholstery'));
  // wrap-around back (round = deeper wrap)
  const wrap = (P.backShape === 'curved' ? 190 : 215) * DEG;
  const shellLean = (backH - bodyTop + 0.03) * Math.tan(11 * DEG);
  g.add(K.partMesh(wrapBand({ rx: w / 2 - T / 2 - 0.004, rz: d / 2 - T / 2 - shellLean / 2, zc: shellLean / 2, wrap, T, Tend: T * 0.85, y0: bodyTop - 0.03, backH, endH, endFrom: armed ? 0.45 : 0.25, recline: 11, q }), ms.up, 'upholstery'));
  addBase(g, ms, style, { hx: w / 2 - 0.08, hz: d / 2 - 0.08, topY: legH + 0.01, q, inset: 0.04 });
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Dining chair and bar stool (stacked-shell backs)

/**
 * Plan curve of a shell back at one level: an elliptic arc through the back centre (0, zBack) whose ends are at
 * x = ±halfW, `depth` metres in front of the back centre. theta = half opening angle.
 */
function shellCurve(halfW, depth, zBack, theta, n) {
  const ax = halfW / Math.sin(theta);
  const az = depth / (1 - Math.cos(theta));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = -theta + (2 * theta * i) / n;
    pts.push([ax * Math.sin(a), zBack + az * (1 - Math.cos(a))]);
  }
  return pts;
}

/** Shell levels from a function of t (0 bottom … 1 top): { halfW, depth, zBack, theta, T }. */
function shellLevels(yb, yt, fn, nLev, nCurve) {
  const levels = [];
  for (let i = 0; i <= nLev; i++) {
    const t = 1 - (1 - i / nLev) ** 1.45; // denser toward the rounded top
    const L = fn(t);
    const pts = shellCurve(L.halfW, L.depth, L.zBack, L.theta, nCurve);
    const pad = L.pad ? pts.map((_, j) => L.pad(j / (pts.length - 1))) : undefined;
    levels.push({ y: lerp(yb, yt, t), T: L.T, pts, pad });
  }
  return levels;
}

/** Elevation corner rounding: how much a half-width shrinks at height y below the top yt (radius rc). */
const cornerCut = (y, yt, rc) => (y > yt - rc ? rc * (1 - Math.sqrt(Math.max(0, 1 - ((y - (yt - rc)) / rc) ** 2))) : 0);

/**
 * Shell back of a chair/stool: narrow and wrapping at the seat, wide and shallow at the top, reclined.
 * Returns { levels, fn, zBot, topPts } (topPts(y): plan curve inside the rounded top cap).
 */
function chairShell({ yb, yt, T, halfW0, halfW1, depth0, depth1, theta0, theta1, zTop, recline, rc, nLev, nCurve, quilt }) {
  const span = yt - yb;
  const zBot = zTop + span * Math.tan(recline);
  const fn = (t) => {
    const y = lerp(yb, yt, t);
    return {
      halfW: lerp(halfW0, halfW1, sstep(0, 1, t) ** 0.85) - cornerCut(y, yt + T / 2, rc),
      depth: lerp(depth0, depth1, sstep(0, 0.85, t)),
      zBack: lerp(zBot, zTop, t),
      theta: lerp(theta0, theta1, sstep(0, 0.9, t)) * DEG,
      T,
      pad: quilt ? (s) => quilt(s, y) : null,
    };
  };
  const levels = shellLevels(yb, yt, fn, nLev, nCurve);
  const nCurvePts = levels[0].pts.length - 1;
  const topPts = (y) => {
    const L = fn(1);
    return shellCurve(halfW1 - cornerCut(y, yt + T / 2, rc), L.depth, L.zBack, L.theta, nCurvePts);
  };
  return { levels, fn, zBot, topPts };
}

/** Vertical seam down the middle of a shell's outer back. */
function backSeam(levels, T) {
  const pts = levels.slice(0, -1).map((l) => new THREE.Vector3(0, l.y, l.pts[Math.floor(l.pts.length / 2)][1] - T / 2 - 0.0004));
  return seamTube(pts, 0.0022, { radial: 4 });
}

function buildDiningChair(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'slim-metal';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.47), 0.35, h - 0.2);
  const cushT = 0.075;
  const seatBot = seatH - cushT;
  const T = 0.05;
  const yb = seatBot - 0.015, yt = h - T / 2;
  const zTop = -d / 2 + T / 2 + 0.004;
  const halfW0 = w * 0.4, halfW1 = w / 2 - T / 2 - 0.003;
  const shell = chairShell({
    yb, yt, T, halfW0, halfW1, depth0: 0.22, depth1: 0.07, theta0: 98, theta1: 60, zTop, recline: 9 * DEG,
    rc: 0.08, nLev: Math.max(8, Math.round(16 * q)), nCurve: Math.max(10, Math.round(20 * q)),
  });
  g.add(K.partMesh(shellGeometry(shell.levels, { center: [0, 0.1], nEnd: q < 1 ? 3 : 4, nCap: 4, topPts: shell.topPts }), ms.up, 'upholstery'));
  g.add(K.partMesh(backSeam(shell.levels, T), ms.pipe, ms.pipePart));
  // seat cushion: tucked into the shell at the back, wider and rounder at the front
  const sz0 = shell.zBot + T * 0.15, sz1 = d / 2 - 0.035;
  const sw0 = halfW0 - T / 2 - 0.004, sw1 = w * 0.44;
  const seatOut = rrOutline(-sw1, sw1, sz0, sz1, 0.05, 0.075, 6, 4, (x) => 0.01 * (1 - (x / sw1) ** 2));
  const zm = (sz0 + sz1) / 2;
  for (const p of seatOut) p[0] *= lerp(sw0 / sw1, 1, sstep(0, 1, clamp((p[1] - sz0) / (zm - sz0), 0, 1)));
  g.add(K.partMesh(slabGeometry(seatOut, { y0: seatBot, y1: seatH, rTop: 0.028, rBot: 0.012, dome: 0.008, belly: 0.004 }), ms.up, 'upholstery'));
  // under-seat plate + splayed legs
  const sd = sz1 - sz0;
  g.add(K.partMesh(K.roundedBox(w * 0.56, 0.012, sd * 0.62, 0.003, 1), ms.legs(), 'legs', { position: [0, seatBot - 0.004, zm] }));
  if (style === 'slim-metal') {
    const r = clamp(num(P.legD, 0.02) / 2, 0.006, 0.02);
    const sub = new THREE.Group();
    sub.position.z = zm;
    g.add(sub);
    fourLegs(sub, ms, style, { ax: w * 0.3, az0: -sd * 0.34, az1: sd * 0.34, topY: seatBot - 0.008, q, rTop: r * 1.1, rBot: r * 0.75, splayX: 6, splayF: 10, splayB: 13, square: true });
  } else addBase(g, ms, style, { hx: w * 0.36, hz: sd * 0.45, topY: seatBot - 0.008, q, z: zm, inset: 0.035 });
  return K.finishModel(g, { seatY: seatH });
}

function buildBarStool(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'slim-metal';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.65), 0.45, h - 0.15);
  const cushT = 0.075;
  const seatBot = seatH - cushT;
  const T = 0.045;
  const hasBack = P.back !== 'none' && h > seatH + 0.12;
  const halfW0 = w * 0.43, halfW1 = w / 2 - T / 2 - 0.003;
  let sz0 = -d / 2 + 0.05;
  if (hasBack) {
    const yb = seatBot + 0.01, yt = h - T / 2;
    const zTop = -d / 2 + T / 2 + 0.004;
    // quilted padding on the inner face: 3 columns × 2 rows of puffy squares
    const qy0 = seatH + 0.005, qy1 = h - 0.06;
    const cols = 3, rows = 2, pd = 0.03, s0 = 0.14, s1 = 0.86;
    const quilt = P.quilt === false ? null : (s, y) => {
      if (y < qy0 || y > qy1 || s < s0 || s > s1) return 0;
      const fs = ((s - s0) / (s1 - s0)) * cols, fy = ((y - qy0) / (qy1 - qy0)) * rows;
      const bs = Math.sin(Math.PI * (fs % 1)), by = Math.sin(Math.PI * (fy % 1));
      const edge = sstep(0, 0.04, s - s0) * sstep(0, 0.04, s1 - s) * sstep(0, 0.02, y - qy0) * sstep(0, 0.03, qy1 - y);
      return pd * Math.max(0, bs) ** 0.4 * Math.max(0, by) ** 0.4 * edge;
    };
    const shell = chairShell({
      yb, yt, T, halfW0, halfW1, depth0: 0.18, depth1: 0.09, theta0: 95, theta1: 66, zTop, recline: 8 * DEG,
      rc: Math.min(0.12, (yt - yb) * 0.4), nLev: Math.max(10, Math.round(22 * q)), nCurve: Math.max(14, Math.round(30 * q)), quilt,
    });
    g.add(K.partMesh(shellGeometry(shell.levels, { center: [0, 0.1], nEnd: q < 1 ? 3 : 4, nCap: 4, topPts: shell.topPts }), ms.up, 'upholstery'));
    g.add(K.partMesh(backSeam(shell.levels, T), ms.pipe, ms.pipePart));
    sz0 = shell.zBot + T * 0.15;
  }
  const sz1 = d / 2 - 0.02;
  const sw0 = halfW0 - T / 2 - 0.004, sw1 = w * 0.46;
  const seatOut = rrOutline(-sw1, sw1, sz0, sz1, 0.06, 0.075, 6, 4, (x) => 0.012 * (1 - (x / sw1) ** 2));
  const zm = (sz0 + sz1) / 2;
  if (hasBack) for (const p of seatOut) p[0] *= lerp(sw0 / sw1, 1, sstep(0, 1, clamp((p[1] - sz0) / (zm - sz0), 0, 1)));
  g.add(K.partMesh(slabGeometry(seatOut, { y0: seatBot, y1: seatH, rTop: 0.03, rBot: 0.012, dome: 0.008, belly: 0.004 }), ms.up, 'upholstery'));
  // frame: four slim legs, under-seat plate and a foot rest ring
  const m = ms.legs({ grain: 'v' });
  const sd = sz1 - sz0;
  const legTop = seatBot - 0.006;
  g.add(K.partMesh(K.roundedBox(w * 0.6, 0.012, sd * 0.62, 0.003, 1), ms.legs(), 'legs', { position: [0, seatBot - 0.004, zm] }));
  const ax = w * 0.33, az = sd * 0.34;
  const r = clamp(num(P.legD, 0.022) / 2, 0.007, 0.02);
  const feet = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top = [sx * ax, legTop, zm + sz * az];
      const bot = [sx * (w / 2 - 0.025), 0, clamp(zm + sz * (az + 0.07), -d / 2 + 0.02, d / 2 - 0.02)];
      addLeg(g, m, 'legs', top, bot, r, r * 0.85, { seg: Math.max(6, Math.round(10 * q)) });
      feet.push({ top, bot });
    }
  }
  if (P.footrest !== false) {
    const fy = clamp(num(P.footrestH, seatH * 0.4), 0.15, seatH - 0.15);
    const at = (f) => {
      const t = fy / f.top[1];
      return new THREE.Vector3(lerp(f.bot[0], f.top[0], t), fy, lerp(f.bot[2], f.top[2], t));
    };
    // order: (−x,−z) (−x,+z) (+x,−z) (+x,+z)
    const [a, b, c, e] = feet.map(at);
    for (const [p0, p1] of [[b, e], [a, b], [c, e], [a, c]]) g.add(K.partMesh(K.tube([p0, p1], r * 0.7, { curve: 'line', radial: 6, seg: 2 }), m, 'legs'));
  }
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Box sofa kit (modular L-sofa, straight sofa): bases, seat cushions, back frames + cushions, box arms, piping

function boxSofaKit({ g, ms, q, piping, plinthH, baseTop, seatH, backH, frameT, backT, lean }) {
  const pr = 0.0032; // piping cord radius (≈ 6–7 mm cord, 082736)
  const pipeMeshes = (geos, parent = g) => {
    for (const geo of geos) parent.add(K.partMesh(geo, ms.pipe, ms.pipePart));
  };
  const kit = {
    /** Upholstered base box x0..x1, z0..z1 from plinthH to baseTop. */
    base(x0, x1, z0, z1) {
      const w = x1 - x0 - 0.004, d = z1 - z0 - 0.004, hh = baseTop - plinthH;
      const R = 0.022;
      const geo = softBox(w, hh, d, 'y', { puff: 0.02, round: (2 * R) / hh, sides: 0.06, bottom: 0, q });
      const c = [(x0 + x1) / 2, plinthH + hh / 2, (z0 + z1) / 2];
      g.add(K.partMesh(geo, ms.up, 'upholstery', { position: c }));
      if (piping) pipeMeshes(cushionPiping(c, geo, ['top'], pr, q));
    },
    /** Seat cushion (loose, piped top and bottom). */
    seat(x0, x1, z0, z1, gap = 0.006) {
      const w = x1 - x0 - gap, d = z1 - z0 - gap * 0.5, hh = seatH - baseTop;
      const R = Math.min(0.04, hh * 0.32);
      const geo = softBox(w, hh, d, 'y', { puff: 0.1, round: (2 * R) / hh, sides: 0.22, bottom: 0.25, q });
      const c = [(x0 + x1) / 2, baseTop + hh / 2, (z0 + z1) / 2 + gap * 0.25];
      g.add(K.partMesh(geo, ms.up, 'upholstery', { position: c }));
      if (piping) pipeMeshes(cushionPiping(c, geo, ['top', 'bottom'], pr, q));
    },
    /** Back (frame + leaning cushion) along x0..x1 with the rear at z = zr, facing +z. */
    backX(x0, x1, zr, { frame = true } = {}) {
      const w = x1 - x0 - 0.006;
      const cx = (x0 + x1) / 2;
      if (frame) {
        const fh = Math.min(backH - 0.12, seatH + 0.2) - plinthH;
        const fgeo = softBox(x1 - x0 - 0.004, fh, frameT, 'z', { puff: 0.04, round: 0.5, sides: 0.05, q });
        g.add(K.partMesh(fgeo, ms.up, 'upholstery', { position: [cx, plinthH + fh / 2, zr + frameT / 2] }));
      }
      const ct = backT - frameT, ch = backH - baseTop - 0.005;
      const grp = new THREE.Group();
      grp.position.set(cx, baseTop + 0.004, zr + frameT + ct / 2 + 0.004);
      grp.rotation.x = -lean;
      g.add(grp);
      const R = Math.min(0.045, ct * 0.3);
      const geo = softBox(w, ch, ct, 'z', { puff: 0.14, round: (2 * R) / ct, sides: 0.25, bottom: 0.6, q });
      grp.add(K.partMesh(geo, ms.up, 'upholstery', { position: [0, ch / 2, 0] }));
      if (piping) pipeMeshes(cushionPiping([0, ch / 2, 0], geo, ['front', 'back'], pr, q), grp);
    },
    /** Side back along z0..z1 with the rear at x = xr (facing +x). */
    backZ(z0, z1, xr, { frame = true } = {}) {
      const dd = z1 - z0 - 0.006;
      const cz = (z0 + z1) / 2;
      if (frame) {
        const fh = Math.min(backH - 0.12, seatH + 0.2) - plinthH;
        const fgeo = softBox(frameT, fh, z1 - z0 - 0.004, 'x', { puff: 0.04, round: 0.5, sides: 0.05, q });
        g.add(K.partMesh(fgeo, ms.up, 'upholstery', { position: [xr + frameT / 2, plinthH + fh / 2, cz] }));
      }
      const ct = backT - frameT, ch = backH - baseTop - 0.005;
      const grp = new THREE.Group();
      grp.position.set(xr + frameT + ct / 2 + 0.004, baseTop + 0.004, cz);
      grp.rotation.z = lean;
      g.add(grp);
      const R = Math.min(0.045, ct * 0.3);
      const geo = softBox(ct, ch, dd, 'x', { puff: 0.14, round: (2 * R) / ct, sides: 0.25, bottom: 0.6, q });
      grp.add(K.partMesh(geo, ms.up, 'upholstery', { position: [0, ch / 2, 0] }));
      if (piping) pipeMeshes(cushionPiping([0, ch / 2, 0], geo, ['left', 'right'], pr, q), grp);
    },
    /** Box arm x0..x1, z0..z1 up to armH (piped side panels); style round = a fully rounded top, sloped = the top
     * falls toward the front. */
    arm(x0, x1, z0, z1, armH, y0 = plinthH, style = 'box') {
      const w = x1 - x0 - 0.004, d = z1 - z0 - 0.004, hh = armH - y0;
      const R = style === 'round' ? w / 2 : Math.min(0.03, w * 0.2);
      const geo = softBox(w, hh, d, 'x', { puff: style === 'round' ? 0.08 : 0.03, round: Math.min(1, (2 * R) / w), sides: 0.04, top: 1, bottom: 1, q });
      if (style === 'sloped') {
        // shear the top down toward the front (≈ 12 cm lower at the front edge)
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const yy = pos.getY(i) + hh / 2, zz = (pos.getZ(i) + d / 2) / d;
          pos.setY(i, pos.getY(i) - Math.min(0.12, hh * 0.35) * zz * (yy / hh));
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      }
      const c = [(x0 + x1) / 2, y0 + hh / 2, (z0 + z1) / 2];
      g.add(K.partMesh(geo, ms.up, 'upholstery', { position: c }));
      if (piping) pipeMeshes(cushionPiping(c, geo, ['left', 'right'], pr, q));
    },
  };
  return kit;
}

function buildSofaL(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.base === 'legs' ? (P.legStyle || 'wood-taper') : 'plinth';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const flip = P.shortLegSide === '+x';
  if (flip) inner.scale.x = -1;
  const seatH = clamp(num(P.seatH, 0.45), 0.3, h - 0.2);
  const backH = Math.max(h, seatH + 0.2); // back cushions reach dims.h
  const depth = clamp(num(P.depth, 0.92), 0.6, d);
  const backT = clamp(num(P.backT, 0.25), 0.14, depth * 0.4);
  const frameT = Math.min(0.1, backT * 0.4);
  const armH = clamp(num(P.armH, 0.63), seatH + 0.05, backH);
  const plinthH = style === 'plinth' ? 0.018 : clamp(num(P.legH, 0.12), 0.03, seatH - 0.2);
  const seatT = clamp(0.16, 0.1, seatH - plinthH - 0.12);
  const baseTop = seatH - seatT;
  const piping = P.piping !== false;
  const chaiseL = d - depth;
  const hasChaise = chaiseL > 0.3;
  const swap = (s) => (s === '+x' ? '-x' : s === '-x' ? '+x' : s);
  const side = flip ? swap(P.armSide ?? '+x') : P.armSide ?? '+x';
  const armPos = side === '+x' || side === 'both';
  // layout 'chaise': an open chaise longue (no back along it), which may have its own arm along the outer side
  const chaiseLayout = P.layout === 'chaise' && hasChaise;
  const armNeg = (side === '-x' || side === 'both') && (!hasChaise || chaiseLayout);
  const armW = clamp(num(P.armW, 0.27), 0.08, w * 0.2);
  // modules from the short-leg end (canonical −x) toward the arm end
  let mods = Array.isArray(P.modules) ? P.modules.filter((m) => m && m.kind !== 'chaise' && num(m.w, 0) > 0).map((m) => ({ kind: m.kind, w: m.w })) : null;
  if (flip && mods) mods = mods.slice(); // order is already from the short-leg side
  if (!mods || !mods.length) {
    mods = [];
    if (armNeg) mods.push({ kind: 'arm', w: armW });
    if (hasChaise) mods.push({ kind: 'corner', w: depth });
    const rest = w - (armNeg ? armW : 0) - (hasChaise ? depth : 0) - (armPos ? armW : 0);
    const n = Math.max(1, Math.round(rest / 0.86));
    for (let i = 0; i < n; i++) mods.push({ kind: 'seat', w: rest / n });
    if (armPos) mods.push({ kind: 'arm', w: armW });
  }
  const sum = mods.reduce((s, m) => s + m.w, 0) || 1;
  const k = w / sum;
  const kit = boxSofaKit({ g: inner, ms, q, piping, plinthH, baseTop, seatH, backH, frameT, backT, lean: 6 * DEG });
  const zr = -d / 2, zf = -d / 2 + depth;
  let x = -w / 2;
  let cornerX1 = -w / 2 + depth;
  for (const m of mods) {
    const x0 = x, x1 = x + m.w * k;
    x = x1;
    if (m.kind === 'arm') {
      kit.arm(x0, x1, zr, chaiseLayout && x0 <= -w / 2 + 1e-6 ? d / 2 : zf, armH, plinthH, P.armStyle);
      continue;
    }
    kit.base(x0, x1, zr, zf);
    if (m.kind === 'corner' && chaiseLayout) {
      cornerX1 = x1;
      kit.seat(x0, x1, zr + backT, zf);
      kit.backX(x0, x1, zr);
    } else if (m.kind === 'corner') {
      cornerX1 = x1;
      kit.seat(x0 + backT, x1, zr + backT, zf);
      kit.backX(x0 + backT, x1, zr);
      kit.backX(x0, x0 + backT, zr, { frame: true });
      if (!hasChaise) kit.backZ(zr + backT, zf, x0);
    } else {
      kit.seat(x0, x1, zr + backT, zf);
      kit.backX(x0, x1, zr);
    }
  }
  const colliders = [{ min: [-w / 2, 0, zr], max: [w / 2, backH, zf] }];
  if (hasChaise && chaiseLayout) {
    const x0 = -w / 2 + (armNeg ? armW : 0), x1 = cornerX1;
    kit.base(x0, x1, zf, d / 2);
    kit.seat(x0, x1, zf, d / 2);
    colliders.push({ min: [-w / 2, 0, zf], max: [x1, seatH, d / 2] });
  } else if (hasChaise) {
    const x0 = -w / 2, x1 = cornerX1;
    const backTo = clamp(num(P.shortLegBackTo, depth + chaiseL * 0.5), depth, d) - d / 2;
    kit.base(x0, x1, zf, d / 2);
    // one long side-back cushion along the short leg (corner + chaise), then the open chaise end
    const bz1 = Math.max(zf, backTo);
    kit.backZ(zr + backT, bz1, x0);
    if (backTo > zf + 0.15) {
      kit.seat(x0 + backT, x1, zf, backTo);
      kit.seat(x0, x1, backTo, d / 2);
    } else kit.seat(x0, x1, zf, d / 2);
    colliders.push({ min: [x0, 0, zf], max: [x1, seatH, d / 2] });
  }
  if (style === 'plinth') {
    const pm = ms.legs();
    inner.add(K.partMesh(K.roundedBox(w - 0.05, plinthH + 0.004, depth - 0.05, 0.004, 1, { bottom: true }), pm, 'legs', { position: [0, 0, (zr + zf) / 2] }));
    if (hasChaise) inner.add(K.partMesh(K.roundedBox(cornerX1 + w / 2 - 0.05, plinthH + 0.004, chaiseL, 0.004, 1, { bottom: true }), pm, 'legs', { position: [(-w / 2 + cornerX1) / 2, 0, zf + chaiseL / 2 - 0.025] }));
  } else {
    addBase(inner, ms, style, { hx: w / 2, hz: depth / 2, topY: plinthH, q, z: (zr + zf) / 2, inset: 0.06 });
    // feet under the front of the chaise too
    if (hasChaise) {
      const cg = new THREE.Group();
      cg.position.x = (-w / 2 + cornerX1) / 2;
      inner.add(cg);
      addBase(cg, ms, style, { hx: (cornerX1 + w / 2) / 2, hz: chaiseL / 2, topY: plinthH, q, z: zf + chaiseL / 2, inset: 0.06 });
    }
  }
  if (flip) for (const c of colliders) [c.min[0], c.max[0]] = [-c.max[0], -c.min[0]];
  return K.finishModel(g, { seatY: seatH, colliders });
}

function buildSofaStraight(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'wood-taper';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.44), 0.3, h - 0.2);
  const backH = Math.max(h, seatH + 0.2); // back cushions reach dims.h
  const backT = clamp(num(P.backT, 0.24), 0.14, d * 0.4);
  const frameT = Math.min(0.1, backT * 0.4);
  const armStyle = ['box', 'slim', 'round', 'sloped', 'none'].includes(P.armStyle) ? P.armStyle : 'box';
  const armW = armStyle === 'none' ? 0 : clamp(num(P.armW, armStyle === 'slim' ? 0.1 : 0.2), 0, w * 0.2);
  const armH = clamp(num(P.armH, Math.min(backH - 0.15, seatH + 0.18)), seatH + 0.05, backH);
  const tightBack = P.backStyle === 'tight';
  const benchSeat = P.seatStyle === 'bench';
  const legH = clamp(num(P.legH, legHeightFor(style, 0.14)), 0.01, seatH - 0.22);
  const seatT = clamp(0.15, 0.1, seatH - legH - 0.1);
  const baseTop = seatH - seatT;
  const piping = !!P.piping;
  const kit = boxSofaKit({ g, ms, q, piping, plinthH: legH, baseTop, seatH, backH, frameT, backT, lean: 7 * DEG });
  const zr = -d / 2, zf = d / 2;
  const ix0 = -w / 2 + armW, ix1 = w / 2 - armW;
  kit.base(ix0, ix1, zr, zf);
  const n = clamp(Math.round(num(P.seats, Math.round((ix1 - ix0) / 0.75))), 1, 5);
  const sw = (ix1 - ix0) / n;
  if (benchSeat) kit.seat(ix0, ix1, zr + (tightBack ? frameT + 0.03 : backT), zf);
  for (let i = 0; i < n; i++) {
    if (!benchSeat) kit.seat(ix0 + i * sw, ix0 + (i + 1) * sw, zr + (tightBack ? frameT + 0.03 : backT), zf);
    if (!tightBack) kit.backX(ix0 + i * sw, ix0 + (i + 1) * sw, zr, { frame: i === 0 });
  }
  if (tightBack) {
    // a fixed upholstered back, slightly reclined, in one piece across the sofa
    const bt = frameT + 0.03, bh = backH - legH;
    const grp = new THREE.Group();
    grp.position.set((ix0 + ix1) / 2, legH, zr + bt / 2);
    grp.rotation.x = -5 * DEG;
    g.add(grp);
    grp.add(K.partMesh(softBox(ix1 - ix0 - 0.004, bh, bt, 'z', { puff: 0.12, round: 0.8, sides: 0.08, bottom: 0.2, q }), ms.up, 'upholstery', { position: [0, bh / 2, 0] }));
  } else if (n > 1) {
    const fh = Math.min(backH - 0.12, seatH + 0.2) - legH;
    g.add(K.partMesh(softBox(ix1 - ix0 - 0.004, fh, frameT, 'z', { puff: 0.04, round: 0.5, sides: 0.05, q }), ms.up, 'upholstery', { position: [(ix0 + ix1) / 2, legH + fh / 2, zr + frameT / 2] }));
  }
  if (armW > 0.03) {
    kit.arm(-w / 2, ix0, zr, zf, armH, legH, armStyle);
    kit.arm(ix1, w / 2, zr, zf, armH, legH, armStyle);
  }
  addBase(g, ms, style, { hx: w / 2, hz: d / 2, topY: legH, q, inset: 0.06 });
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Curved sofa (organic one-piece sofa: a soft pebble seat with a convex front and one continuous back bolster –
// a low round bolster arm at one end rolls up into the back, which swells into a higher, fuller curl that wraps
// forward around the other end; photos 082806 / 082819 / 082823)

/** Arc-length parametrised plan path through a polyline: fn(t) → [x, z], plus the arc length at every point. */
function polylinePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1] || 1e-9;
  let i = 1;
  const fn = (t) => {
    const s = clamp(t, 0, 1) * L;
    if (cum[i - 1] > s) i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = clamp((s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1e-9), 0, 1);
    return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)];
  };
  return { fn, L, cum };
}

/** Largest z of a closed plan outline at x (its front edge there). */
function outlineFrontZ(outline, x) {
  let best = -Infinity;
  for (let j = 0; j < outline.length; j++) {
    const a = outline[j], b = outline[(j + 1) % outline.length];
    if (a[0] === b[0] || (a[0] - x) * (b[0] - x) > 0) continue;
    best = Math.max(best, lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0])));
  }
  return best;
}

/** Welt (self-piping) around a slabGeometry() slab at the 45° point of its top edge rounding (rTop as given to it). */
function slabSeam(outline, y1, rTop, r, q) {
  let cx = 0, cz = 0;
  for (const p of outline) {
    cx += p[0];
    cz += p[1];
  }
  cx /= outline.length;
  cz /= outline.length;
  const { N } = curveFrames(outline, [cx, cz], true);
  const c = Math.SQRT1_2;
  const inset = rTop * (1 - c) - r * 0.4 * c, y = y1 - rTop * (1 - c) + r * 0.4 * c;
  const pts = outline.map((p, j) => new THREE.Vector3(p[0] - N[j][0] * inset, y, p[1] - N[j][1] * inset));
  return seamTube(pts, r, { closed: true, radial: q < 1 ? 3 : 4 });
}

function buildSofaCurved(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'plinth';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  if (P.wingEnd === '+x') inner.scale.x = -1; // canonical: high curl at −x, bolster arm at +x
  const hw = w / 2, hd = d / 2;
  const seatH = clamp(num(P.seatH, 0.43), 0.3, h - 0.2);
  // heights: the curl at the wing end is the highest point (= dims.h, so the height slider moves it); the back is
  // `wingRise` lower and sinks a little more toward the arm, where it rolls down into the bolster
  const wingTop = h;
  const rise = clamp(num(P.wingRise, 0.06), 0, Math.max(0, wingTop - seatH - 0.14));
  const backTop = wingTop - rise;
  const backArm = backTop - Math.min(0.025, rise * 0.4);
  const T = clamp(num(P.backT, 0.22), 0.14, Math.min(0.3, d * 0.28));
  const Tc = T * 1.1; // the curl is a little fuller (bulbous wing end)
  const bD = clamp(num(P.bolsterD, 0.22), 0.14, Math.min(0.3, w * 0.14));
  const bHi = backArm - 0.04;
  const bH = clamp(num(P.bolsterH, 0.58), Math.min(seatH + bD * 0.6, bHi), bHi);
  const plH = style === 'plinth' ? clamp(num(P.legH, 0.02), 0.005, 0.06) : clamp(num(P.legH, legHeightFor(style, 0.1)), 0.01, seatH - 0.25);
  const conv = P.frontConvex === false ? 0 : clamp(d * 0.055, 0.02, 0.07);
  const lean = Math.tan(7 * DEG);
  const yB = seatH - 0.075; // the back bolster sits down in the seat
  const belly = 0.016, mg = 0.01;
  const sag = clamp(d * 0.02, 0, 0.03); // kidney plan: the ends of the back sit a little forward of its middle
  // centre lines: back (z = zb in the middle), curl (x = xw at the wing end), bolster arm (x = xa)
  const zb = -hd + T / 2 + lean * (backTop - yB) + mg;
  const xw = -hw + Tc / 2 + lean * 0.5 * (wingTop - yB) + mg;
  const xa = hw - bD / 2 - 0.008;
  const rc2 = clamp(Math.min(hd * 0.55, (w - 0.9) * 0.3), 0.14, 0.3); // curl radius (centre line)
  const rc1 = clamp(hd * 0.3, 0.1, 0.18); // arm → back corner radius
  const zc1 = zb + sag + rc1, zc2 = zb + sag + rc2;

  // seat: one soft pebble slab – round wing end (concentric with the curl), convex front, tucked-in bottom
  const rBL = (xw + rc2 + hw + zc2 + hd) / 2;
  const rBR = (hw - xa + rc1 + zc1 + hd) / 2;
  const rFR = clamp(hd * 0.55, 0.15, 0.32);
  const sx0 = -hw + belly, sx1 = hw - belly, sz0 = -hd + belly, sz1 = hd - conv - belly;
  const bow = (x) => conv * (1 - (x / hw) ** 2);
  const seatOut = rrOutline(sx0, sx1, sz0, sz1, [rBL, rBR], [rBL, rFR], Math.max(8, Math.round(16 * q)), 6, bow);
  const rT = 0.095, rB = Math.min(0.1, (seatH - plH) * 0.3);
  inner.add(K.partMesh(slabGeometry(seatOut, { y0: plH, y1: seatH, rTop: rT, rBot: rB, dome: 0.02, belly, nEdge: q < 1 ? 3 : 5, nCap: q < 1 ? 4 : 6 }), ms.up, 'upholstery'));
  inner.add(K.partMesh(slabSeam(seatOut, seatH, rT, 0.0035, q), ms.pipe, ms.pipePart));
  // recessed plinth in the shadow under the seat
  if (style === 'plinth') {
    const ip = rB + 0.03;
    const plOut = rrOutline(sx0 + ip, sx1 - ip, sz0 + ip, sz1 - ip, [rBL - ip, rBR - ip], [rBL - ip, rFR - ip], 6, 4, bow);
    inner.add(K.partMesh(slabGeometry(plOut, { y0: 0, y1: plH + 0.012, rTop: 0.004, rBot: 0.003, nEdge: 1, nCap: 2 }), ms.legs(), 'legs'));
  } else addBase(inner, ms, style, { hx: hw - 0.1, hz: hd - 0.1, topY: plH, q, inset: 0.05 });

  // back bolster plan path: arm (front → back), corner, back (+x → −x, slightly kidney-shaped), curl forward
  const pts = [];
  const line = (a, b, n) => {
    for (let i = 0; i < n; i++) pts.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
  };
  const arc = (cx, cz, r, a0, a1, n) => {
    for (let i = 0; i < n; i++) {
      const a = lerp(a0, a1, i / n);
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  };
  let zFront = Infinity;
  for (const x of [xa - bD * 0.4, xa, Math.min(sx1 - 0.01, xa + bD * 0.4)]) zFront = Math.min(zFront, outlineFrontZ(seatOut, x));
  const zaF = Math.max(zc1 + 0.08, zFront - 0.075); // the arm ends a little behind the seat front
  const nA = 14, nC = 10, nB = 24;
  line([xa, zaF], [xa, zc1], nA);
  arc(xa - rc1, zc1, rc1, 0, -Math.PI / 2, nC);
  const xB0 = xa - rc1, xB1 = xw + rc2;
  for (let i = 0; i < nB; i++) {
    const t = i / nB;
    pts.push([lerp(xB0, xB1, t), zb + sag * (2 * t - 1) ** 2]);
  }
  const alpha = clamp(num(P.curlDeg, 28), 0, 60) * DEG; // how far the curl wraps past the end (hidden param)
  arc(xB1, zc2, rc2, -Math.PI / 2, -Math.PI - alpha, 16);
  pts.push([xB1 - rc2 * Math.cos(alpha), zc2 + rc2 * Math.sin(alpha)]);
  for (let it = 0; it < 3; it++) {
    const old = pts.map((p) => [...p]);
    for (let j = 1; j < pts.length - 1; j++) {
      pts[j][0] = (old[j - 1][0] + 2 * old[j][0] + old[j + 1][0]) / 4;
      pts[j][1] = (old[j - 1][1] + 2 * old[j][1] + old[j + 1][1]) / 4;
    }
  }
  const pp = polylinePath(pts);
  const uA = pp.cum[nA] / pp.L, uC = pp.cum[nA + nC] / pp.L, uK = pp.cum[nA + nC + nB] / pp.L;
  const capLen = 0.42; // the bolster's front end: a flat dome with a welt (082819)
  const path = samplePath(pp.fn, Math.round(100 * q), [(bD / 2) * capLen, Tc / 2], 5);
  const mid = (uC + uK) / 2;
  const band = bandGeometry(path, {
    // the bolster is a lying cylinder (section = circle of bD); along the back the section stands on yB
    y0: (u) => lerp(bH - bD, yB, sstep(uA - 0.03, uC, u)),
    height: (u) => lerp(bH, backArm, sstep(uA - 0.03, uC + 0.04, u)) + (backTop - backArm) * sstep(uC, mid, u) + (wingTop - backTop) * sstep(uK - 0.1, uK + 0.06, u),
    thick: (u) => lerp(bD, T, sstep(uA - 0.02, uC + 0.02, u)) * lerp(1, Tc / T, sstep(uK - 0.08, uK + 0.05, u)),
    center: [0, hd * 0.15],
    lean: (u) => lean * sstep(uA, uC + 0.03, u) * (1 - 0.5 * sstep(uK - 0.05, uK + 0.08, u)),
    rTop: 1,
    rBot: (u) => lerp(bD / 2, 0.03, sstep(uA - 0.02, uC, u)),
    bulge: 0.006,
    nc: q < 1 ? 3 : 5,
    ns: 2,
    startCap: { len: capLen, concentric: true },
    capUV: true,
  });
  inner.add(K.partMesh(band, ms.up, 'upholstery'));
  // welt round the bolster's end disc
  {
    const [px, pz] = pp.fn(((bD / 2) * capLen) / pp.L);
    const R = bD / 2 + 0.0015, cy = bH - bD / 2;
    const ring = [];
    const nR = Math.max(12, Math.round(24 * q));
    for (let k = 0; k < nR; k++) {
      const a = (k / nR) * Math.PI * 2;
      ring.push(new THREE.Vector3(px + Math.cos(a) * R, cy + Math.sin(a) * R, pz));
    }
    inner.add(K.partMesh(seamTube(ring, 0.0035, { closed: true, radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
  }
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Wing chair

/** Plan path (fn(t) → [x, z]) of a U: right side from zFront back to zBack, across, and forward on the left. */
function uPath(hx, zFront, zBack, rc) {
  const r = Math.min(rc, hx * 0.9, (zFront - zBack) * 0.9);
  const pts = [];
  const side = zFront - (zBack + r);
  const n = 24;
  for (let i = 0; i <= n; i++) pts.push([hx, zFront - (side * i) / n]);
  for (let i = 1; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    pts.push([hx - r + r * Math.cos(a), zBack + r - r * Math.sin(a)]);
  }
  for (let i = 1; i < n; i++) pts.push([hx - r - ((2 * (hx - r)) * i) / n, zBack]);
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / 8);
    pts.push([-hx + r + r * Math.cos(a), zBack + r - r * Math.sin(a)]);
  }
  for (let i = 1; i <= n; i++) pts.push([-hx, zBack + r + (side * i) / n]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  return (t) => {
    const s = t * L;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)];
  };
}

function buildWingback(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'wood-taper';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.45), 0.32, h - 0.3);
  const armH = clamp(num(P.armH, 0.62), seatH + 0.08, h - 0.2);
  const armW = clamp(num(P.armW, 0.1), 0.06, w * 0.22);
  const legH = clamp(num(P.legH, legHeightFor(style, 0.2)), 0.02, seatH - 0.18);
  const loose = P.cushion === 'loose';
  const cushT = loose ? 0.11 : 0.08;
  const deckTop = seatH - cushT;
  const scroll = (P.armStyle ?? (armW >= 0.12 ? 'scroll' : 'slim')) === 'scroll';
  const buttons = P.buttons ?? loose;
  const zr = -d / 2, zf = d / 2;
  // one continuous shell: wing – back – wing (U band), reclined at the back, wings flaring out
  const T = 0.11, Tw = 0.075;
  const rec = 9 * DEG, flare = 4 * DEG;
  const backY0 = deckTop - 0.05, wingY0 = armH - 0.05;
  const zb = zr + T / 2 + (h - backY0) * Math.tan(rec);
  const hx = w / 2 - Tw / 2 - (h - wingY0) * Math.tan(flare) - 0.004;
  const wingFront = zr + d * (scroll ? 0.58 : 0.72);
  const rcorner = 0.1;
  const zKnee = zr + d * 0.36; // where the wing reaches its full height
  const yTip = h - 0.1;
  const path = samplePath(uPath(hx, wingFront, zb, rcorner), Math.round(80 * q), Tw / 2, 4);
  const isBack = (sm) => sstep(zb + rcorner + 0.02, zb + 0.005, sm.z);
  const band = bandGeometry(path, {
    y0: (u, sm) => lerp(wingY0, backY0, isBack(sm)),
    center: [0, zb + d * 0.3],
    thick: (u, sm) => lerp(Tw, T, isBack(sm)),
    height: (u, sm) => {
      if (isBack(sm) > 0.5) return h;
      // wing top edge: low and forward at the front, rising in a concave sweep to the tip, then level to the back
      const t = clamp((wingFront - sm.z) / Math.max(0.05, wingFront - zKnee), 0, 1);
      const yw = lerp(armH + 0.1, yTip, Math.sin((t * Math.PI) / 2) ** 0.7);
      return lerp(yw, h, sstep(zKnee, zb + rcorner * 0.5, sm.z));
    },
    lean: (u, sm) => lerp(Math.tan(flare), Math.tan(rec), isBack(sm) ** 3),
    rTop: 1,
    rBot: 0.02,
    bulge: 0.005,
    nc: q < 1 ? 3 : 4,
    ns: 2,
  });
  g.add(K.partMesh(band, ms.up, 'upholstery'));
  // deck (seat frame with a front rail)
  const deckH = deckTop - legH;
  g.add(K.partMesh(softBox(w - 2 * armW + 0.03, deckH, d - 0.04, 'y', { puff: 0.03, round: 0.4, sides: 0.15, bottom: 0, q }), ms.up, 'upholstery', { position: [0, legH + deckH / 2, 0.01] }));
  // arms
  const armD = d - 0.03;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - armW / 2);
    if (scroll) {
      const rr = armW * 0.55;
      const ph = armH - rr - legH;
      g.add(K.partMesh(softBox(armW * 0.8, ph, armD, 'x', { puff: 0.04, round: 0.6, sides: 0.05, q }), ms.up, 'upholstery', { position: [x - sx * armW * 0.08, legH + ph / 2, zf - armD / 2] }));
      const roll = K.cylinder(rr, rr, armD - 0.01, { seg: Math.max(12, Math.round(22 * q)), center: true });
      roll.rotateX(Math.PI / 2);
      g.add(K.partMesh(roll, ms.up, 'upholstery', { position: [x + sx * rr * 0.12, armH - rr, zf - armD / 2] }));
      const face = softBox(rr * 2.05, rr * 2.05, 0.035, 'z', { puff: 0.25, round: 0.9, sides: 0, q });
      g.add(K.partMesh(face, ms.up, 'upholstery', { position: [x + sx * rr * 0.12, armH - rr, zf - 0.016] }));
      g.add(K.partMesh(softBox(armW * 0.9, armH - rr - legH, 0.035, 'z', { puff: 0.15, round: 0.8, q }), ms.up, 'upholstery', { position: [x, legH + (armH - rr - legH) / 2, zf - 0.018] }));
    } else {
      const ah = armH - legH;
      g.add(K.partMesh(softBox(armW, ah, armD, 'x', { puff: 0.05, round: 0.8, sides: 0.1, top: 0.6, q }), ms.up, 'upholstery', { position: [x, legH + ah / 2, zf - armD / 2] }));
    }
  }
  // inner back cushion (tight, optionally buttoned), reclined with the back
  const ibw = 2 * (hx - Tw / 2) - 0.02, ibt = 0.1;
  const ib = new THREE.Group();
  ib.position.set(0, seatH - 0.04, zb + T / 2 + ibt / 2 - 0.02);
  ib.rotation.x = -rec;
  g.add(ib);
  const ibh = (h - 0.05 - (seatH - 0.04)) / Math.cos(rec);
  const ibPuff = 0.16;
  ib.add(K.partMesh(softBox(ibw, ibh, ibt, 'z', { puff: ibPuff, round: 0.7, sides: 0.15, bottom: 0.2, q }), ms.up, 'upholstery', { position: [0, ibh / 2, 0] }));
  if (buttons) {
    const bg = sharedButton(q);
    const cols = 3, rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = ((c + 0.5) / cols) * 2 - 1, t = ((r + 0.8) / (rows + 0.6)) * 2 - 1;
        const fx = s * 0.7, fy = t * 0.7;
        const bz = ibt / 2 + ibPuff * ibt * (1 - fx * fx) * (1 - fy * fy) * 0.8 - 0.003;
        ib.add(K.partMesh(bg, ms.up, 'upholstery', { position: [(fx * ibw) / 2, ibh / 2 + (fy * ibh) / 2, bz] }));
      }
    }
  }
  // seat cushion
  const sz0 = zb + T / 2 + 0.06;
  const sw = w - 2 * armW - 0.012, sd = zf - 0.005 - sz0;
  addCushion(g, ms, softBox(sw, cushT + 0.01, sd, 'y', { puff: 0.16, round: 0.6, sides: 0.25, bottom: 0.2, q }), [0, deckTop + (cushT + 0.01) / 2 - 0.01, sz0 + sd / 2], loose && P.piping !== false ? ['top'] : null, q);
  addBase(g, ms, style, { hx: w / 2, hz: d / 2, topY: legH + 0.004, q, inset: 0.05 });
  const colliders = [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] }];
  if (P.footstool) {
    const fd = Math.min(0.42, d * 0.5);
    const sw0 = clamp(num(P.stoolW, Math.min(w * 0.68, 0.6)), 0.3, 0.8), sd0 = clamp(num(P.stoolD, fd), 0.28, 0.6);
    colliders.push(addFootstool(g, spec, ms, style, { w: sw0, d: sd0, h: clamp(num(P.stoolH, seatH - 0.02), 0.25, seatH + 0.02), z: d / 2 + 0.14 + sd0 / 2, q }));
  }
  return K.finishModel(g, { seatY: seatH, colliders });
}

/** Fabric-covered button (shared geometry). */
function sharedButton(q) {
  return K.sharedGeometry(`seat-button-${q < 1 ? 0 : 1}`, () => {
    const s = K.sphere(0.011, { wSeg: q < 1 ? 8 : 12, hSeg: q < 1 ? 5 : 7 });
    s.scale(1, 1, 0.55);
    return s;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Club chair (box)

/**
 * Low, deep, armless lounge chair of soft pillows (Jakobsen Cooper): a rounded base, a seat of 2 × 2 puffy tufts and
 * a reclined back of 2 × 3 tufts resting on the base's rear, on hidden glides (backShape 'tufted').
 */
function buildTuftedLounge(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'block';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.43), 0.3, h - 0.2);
  const legH = clamp(num(P.legH, 0.025), 0.01, 0.15);
  const zr = -d / 2, zf = d / 2;
  const seatT = 0.2, deckTop = seatH - seatT + 0.03;
  // base: one soft block over the whole footprint
  const baseH = deckTop - legH;
  g.add(K.partMesh(softBox(w, baseH, d, 'y', { puff: 0.04, round: 0.75, sides: 0.12, bottom: 0.05, q }), ms.up, 'upholstery', { position: [0, legH + baseH / 2, 0] }));
  // back: 2 × 3 tufts, reclined so its rear top stays inside dims.d
  const backT = clamp(d * 0.23, 0.18, 0.26), rec = 22 * DEG;
  const L = (h - deckTop - 0.01) / Math.cos(rec);
  const zp = zr + 0.012 + L * Math.sin(rec) + (backT / 2) * Math.cos(rec);
  const back = new THREE.Group();
  back.position.set(0, deckTop - 0.02, zp);
  back.rotation.x = -rec;
  g.add(back);
  const cw = (w - 0.012) / 2;
  for (let r = 0; r < 3; r++) {
    for (const sx of [-1, 1]) {
      const th = L / 3 + 0.035;
      const geo = softBox(cw + 0.014, th, backT, 'z', { puff: 0.1, round: 0.42, sides: 0.12, top: 1, bottom: 0.3, q, seg: 12 });
      back.add(K.partMesh(geo, ms.up, 'upholstery', { position: [sx * cw / 2, (r + 0.5) * (L / 3) + 0.01, 0] }));
    }
  }
  // seat: 2 × 2 tufts from the back to the front edge
  const z0 = zp + (backT / 2) * 0.7, sd = zf - 0.005 - z0;
  for (let r = 0; r < 2; r++) {
    for (const sx of [-1, 1]) {
      const geo = softBox(cw + 0.014, seatT, sd / 2 + 0.02, 'y', { puff: 0.14, round: 0.6, sides: 0.15, bottom: 0.05, q, seg: 12 });
      g.add(K.partMesh(geo, ms.up, 'upholstery', { position: [sx * cw / 2, seatH - seatT / 2, z0 + (r + 0.5) * (sd / 2)] }));
    }
  }
  addBase(g, ms, style, { hx: w / 2, hz: d / 2, topY: legH + 0.004, q, inset: 0.06 });
  return K.finishModel(g, { seatY: seatH });
}

function buildClubBox(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  if (P.backShape === 'tufted') return buildTuftedLounge(spec);
  const q = qf(spec);
  const style = P.legStyle || 'wood-taper';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.44), 0.3, h - 0.2);
  const armW = clamp(num(P.armW, 0.16), 0, w * 0.25);
  const armed = armW > 0.03;
  const armH = clamp(num(P.armH, seatH + 0.18), seatH + 0.06, h);
  const legH = clamp(num(P.legH, legHeightFor(style, 0.1)), 0.01, seatH - 0.2);
  const loose = P.cushion === 'loose';
  const curved = P.backShape === 'curved' || P.backShape === 'round';
  const cushT = loose ? 0.13 : 0.1;
  const deckTop = seatH - cushT;
  const backT = curved ? clamp(0.2, 0.14, d * 0.25) : 0.12;
  const zr = -d / 2, zf = d / 2;
  const skirt = style === 'none';
  const y0 = skirt ? 0.012 : legH;
  const piping = P.piping !== false && loose;
  // body / deck
  const ix0 = -w / 2 + (armed ? armW : 0), ix1 = w / 2 - (armed ? armW : 0);
  const bodyH = deckTop - y0;
  g.add(K.partMesh(softBox(ix1 - ix0 + (armed ? 0.02 : 0), bodyH, d - (curved ? 0.04 : 0.02), 'y', { puff: 0.03, round: 0.35, sides: 0.18, bottom: 0, q }), ms.up, 'upholstery', { position: [0, y0 + bodyH / 2, curved ? 0.02 : 0.01] }));
  if (armed) {
    for (const sx of [-1, 1]) {
      const ah = armH - y0;
      g.add(K.partMesh(softBox(armW, ah, d - 0.01, 'x', { puff: 0.06, round: 0.75, sides: 0.12, top: 0.8, bottom: 0.2, q }), ms.up, 'upholstery', { position: [sx * (w / 2 - armW / 2), y0 + ah / 2, 0] }));
    }
  }
  const sw = ix1 - ix0 - 0.01;
  let seatZ0;
  if (curved) {
    // pillowy back band wrapping round toward the front (low arms when armless), reclined to fill the depth
    const wrap = (armed ? 170 : 200) * DEG;
    const y0b = deckTop - 0.04;
    const seatD = clamp(num(P.seatD, d * 0.62), 0.4, d - 0.25);
    const rec = clamp(Math.atan((d - seatD - backT - 0.02) / Math.max(0.2, h - y0b)), 6 * DEG, 24 * DEG);
    const rx = w / 2 - backT / 2 - (armed ? armW * 0.6 : 0.005);
    const rz = Math.min(d * 0.42, rx * 0.9);
    const zc = zr + backT / 2 + rz + (h - y0b) * Math.tan(rec);
    const endH = armed ? armH - 0.02 : seatH + 0.1;
    const endFrom = 0.3, Tend = backT * 0.8;
    g.add(K.partMesh(wrapBand({ rx, rz, zc, wrap, T: backT, Tend, y0: y0b, backH: h, endH, endFrom, recline: rec / DEG, q }), ms.up, 'upholstery'));
    // horizontal quilting channels on the inner face of the back
    const qn = 3;
    for (let i = 1; i <= qn; i++) {
      const y = seatH + ((h - seatH) * i) / (qn + 1) - 0.02;
      const pts = [];
      for (let k = 0; k <= 30; k++) {
        const u = 0.5 + (k / 30 - 0.5) * 0.9; // arc fraction (≈ angle fraction)
        const uu = Math.abs(2 * u - 1);
        if (h - (h - endH) * sstep(endFrom, 1, uu) < y + 0.05) continue;
        const ang = (2 * u - 1) * (wrap / 2);
        let nx = Math.sin(ang) / rx, nz = -Math.cos(ang) / rz;
        const nl = Math.hypot(nx, nz);
        nx /= nl;
        nz /= nl;
        const T = lerp(backT, Tend, sstep(0.3, 1, uu));
        const off = -T / 2 + (y - y0b) * Math.tan(rec) * Math.max(0, Math.cos(ang)) ** 1.5 - 0.001;
        pts.push(new THREE.Vector3(rx * Math.sin(ang) + nx * off, y, zc - rz * Math.cos(ang) + nz * off));
      }
      if (pts.length > 3) g.add(K.partMesh(seamTube(pts, 0.004, { radial: 4 }), ms.pipe, ms.pipePart));
    }
    seatZ0 = zc - rz + backT * 0.3;
  } else {
    // square back: frame + (loose or tight) back cushion
    const fh = h - y0 - (loose ? 0.06 : 0.01);
    g.add(K.partMesh(softBox(ix1 - ix0 + (armed ? 0.02 : 0), fh, backT, 'z', { puff: 0.04, round: 0.45, sides: 0.08, q }), ms.up, 'upholstery', { position: [0, y0 + fh / 2, zr + backT / 2] }));
    const ct = loose ? 0.16 : 0.1, ch = h - deckTop - 0.03;
    const grp = new THREE.Group();
    grp.position.set(0, deckTop + 0.005, zr + backT + ct / 2 - 0.01);
    grp.rotation.x = -9 * DEG;
    g.add(grp);
    addCushion(grp, ms, softBox(sw, ch, ct, 'z', { puff: 0.14, round: 0.7, sides: 0.25, bottom: 0.5, q }), [0, ch / 2, 0], piping ? ['front'] : null, q);
    seatZ0 = zr + backT + ct * 0.7;
  }
  // seat cushion
  const sd = zf - seatZ0 - 0.005;
  const sc = [0, deckTop + cushT / 2, seatZ0 + sd / 2];
  addCushion(g, ms, softBox(sw, cushT, sd, 'y', { puff: 0.14, round: 0.6, sides: 0.25, bottom: 0.25, q }), sc, piping ? ['top'] : null, q);
  if (skirt) {
    // a skirt hem line just above the floor
    const hem = pipeLoop([0, 0.03, curved ? 0.02 : 0.01], X, Z, w / 2 + 0.002, d / 2 - (curved ? 0.02 : 0.01) + 0.002, 0.03, 0.004, q);
    g.add(K.partMesh(hem, ms.up, 'upholstery'));
  }
  addBase(g, ms, style, { hx: w / 2, hz: d / 2, topY: legH + 0.004, q, inset: 0.05 });
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Recliner: high back with a neck cushion on a swivel base, a separate footstool or an integrated footrest.
// Bodies (params.body; 'auto' = from the product):
//   box      upholstered side panels with rounded, slightly flared arm tops (Chicago, Bern). sides 'shell': outer
//            panels, back and apron in a smooth `frame` fabric with upholstered arm caps (Zermatt); 'veneer':
//            wooden side plates (`frame`) on the outer faces, fabric over the arm tops and fronts (Grande)
//   shell    moulded veneer shell (`frame`, or the cover fabric) round seat and back that forms the arms, padded
//            arm tops, thick cushions inside, a sausage neck roll on posts (Conform Timeout)
//   tulip    thin tulip-shaped arms: broad, outward-curling tops narrowing to the foot (IMG Taycan)
//   classic  Stressless: seat and seamed back between slim arm pads on wooden brackets, ring base (Stressless Opal)
// 'auto' params are read from params.notes (the shop description) when the explicit params are missing – the
// explicit values per product are listed in notes/add-seating.md.

const RECLINER_BODIES = ['box', 'shell', 'tulip', 'classic'];
const RECLINER_HEADS = ['integrated', 'block', 'roll', 'wing', 'none'];

/** Resolved recliner style: explicit params first, then the product notes, then dims / colours. */
function reclinerStyle(spec) {
  const P = spec.params || {}, C = spec.colors || {}, M = spec.materials || {};
  const notes = typeof P.notes === 'string' ? P.notes.toLowerCase() : '';
  const has = (re) => re.test(notes);
  const pick = (v, list) => (list.includes(v) ? v : null);
  const body = pick(P.body, RECLINER_BODIES)
    || (has(/formstøpt|skrog/) ? 'shell' : has(/tulipan/) ? 'tulip' : num(P.armW, 0.08) >= 0.1 || has(/sidevange|ytterskall/) ? 'box' : 'classic');
  const frameWood = !!C.frame && kindGroup(M.frame || 'oak') === 'wood';
  // «helkledd»: the frame in the same fabric and colour as the cover reads as upholstered sides
  const sameCover = !!C.frame && !frameWood && (M.frame || '') === (M.upholstery || '') && String(C.frame).toLowerCase() === String(C.upholstery || '').toLowerCase();
  const sides = pick(P.sides, ['fabric', 'shell', 'veneer'])
    || (has(/finert|vanger i (?:tre|eik|valnøtt)/) ? 'veneer' : has(/ytterskall/) ? 'shell' : C.frame && !sameCover ? (frameWood ? 'veneer' : 'shell') : 'fabric');
  const pile = Math.max(0, num(P.pile, M.upholstery === 'teddy' ? 0.02 : 0));
  const head = P.headrest === false ? 'none' : pick(P.headStyle, RECLINER_HEADS)
    || (has(/pølse/) ? 'roll' : has(/vingeformet/) ? 'wing' : has(/separat|rektangulær/) ? 'block' : body === 'shell' ? 'roll' : body === 'tulip' ? 'wing' : 'integrated');
  const seams = pick(P.backSeams, ['none', 'cross', 'cross-v', 'buttons'])
    || (has(/loddrett søm/) ? 'cross-v' : has(/knapp/) ? 'buttons' : pile > 0.004 ? 'none' : 'cross');
  let rest = pick(P.footrest, ['stool', 'integrated', 'none']);
  if (!rest) {
    if (P.footrest === true) rest = 'integrated';
    else if (P.footstool === false) rest = /(?<!ingen )(?:innebygd|integrert) fothviler/.test(notes) ? 'integrated' : 'none';
    else rest = 'stool';
  }
  const slim = P.star === 'slim' || (P.star == null && has(/slimline|tynn, firearmet/));
  const starArms = clamp(Math.round(num(P.starArms, has(/femarmet|5 armer/) && !slim ? 5 : 4)), 3, 6);
  const cm = /fotskammel(?:en)?[^×]{0,90}?(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)\s*cm/.exec(notes);
  const fromNotes = (i) => (cm ? parseFloat(cm[i].replace(',', '.')) / 100 : 0);
  return {
    body, sides, pile, head, seams, rest, slim, starArms,
    open: P.footrestOpen === true,
    lever: typeof P.lever === 'boolean' ? P.lever : has(/spak/),
    stool: [num(P.stoolW, fromNotes(1)), num(P.stoolD, fromNotes(2)), num(P.stoolH, fromNotes(3))],
  };
}

/**
 * Closed plan loop [[x, z], …] round a rounded rectangle centred on x = cx: half width hw, z from zb (back) to zf
 * (front), corner radii rf (front) / rb (back). front(x) / back(x) bulge the straight front / back edges (blended
 * out round the corners). Constant point count 2·nx + 4·nArc + 2·nSide whatever the sizes, so loops can be
 * stitched; nx even → x = cx is a vertex (centre seams). bend(x) shifts every point along z (a bent cushion).
 */
function rrLoop(hw, zb, zf, rf, rb, { nx = 12, nArc = 4, nSide = 2, front, back, bend, cx = 0 } = {}) {
  hw = Math.max(1e-4, hw);
  const D = Math.max(4e-4, zf - zb);
  zf = zb + D;
  rf = clamp(rf, 1e-4, Math.min(hw, D / 2) * 0.999);
  rb = clamp(rb, 1e-4, Math.min(hw, D / 2) * 0.999);
  const F = front || (() => 0), B = back || (() => 0);
  const xf = hw - rf, xb = hw - rb;
  const fl = F(-xf), fr = F(xf), bl = B(-xb), br = B(xb);
  const pts = [];
  for (let i = 0; i < nx; i++) {
    const x = xf - (2 * xf * i) / nx;
    pts.push([cx + x, zf + F(x)]);
  }
  for (let k = 0; k < nArc; k++) {
    const t = k / nArc, a = (Math.PI / 2) * (1 + t);
    pts.push([cx - xf + rf * Math.cos(a), zf - rf + rf * Math.sin(a) + fl * (1 - t)]);
  }
  for (let k = 0; k < nSide; k++) pts.push([cx - hw, lerp(zf - rf, zb + rb, k / nSide)]);
  for (let k = 0; k < nArc; k++) {
    const t = k / nArc, a = Math.PI * (1 + t / 2);
    pts.push([cx - xb + rb * Math.cos(a), zb + rb + rb * Math.sin(a) - bl * t]);
  }
  for (let i = 0; i < nx; i++) {
    const x = -xb + (2 * xb * i) / nx;
    pts.push([cx + x, zb - B(x)]);
  }
  for (let k = 0; k < nArc; k++) {
    const t = k / nArc, a = Math.PI * (1.5 + t / 2);
    pts.push([cx + xb + rb * Math.cos(a), zb + rb + rb * Math.sin(a) - br * (1 - t)]);
  }
  for (let k = 0; k < nSide; k++) pts.push([cx + hw, lerp(zb + rb, zf - rf, k / nSide)]);
  for (let k = 0; k < nArc; k++) {
    const t = k / nArc, a = (Math.PI / 2) * t;
    pts.push([cx + xf + rf * Math.cos(a), zf - rf + rf * Math.sin(a) + fr * t]);
  }
  if (bend) for (const p of pts) p[1] += bend(p[0] - cx);
  return pts;
}

/**
 * Closed solid lofted through plan loops (same point count) at rising heights: levels [{ y, loop }]. Both ends get
 * a rounded edge (radius top / bottom, rings inset along the loop normals beyond the last / first level) and a
 * flat, planar-mapped cap (optional dome). `matrix` re-orients the result (PROFILE_X: lofts along x).
 */
function loftGeometry(levels, { top = 0.01, bottom = 0.01, nEdge = 3, nCap = 3, dome = 0, matrix } = {}) {
  const prep = (loop) => {
    let cx = 0, cz = 0;
    for (const p of loop) {
      cx += p[0];
      cz += p[1];
    }
    cx /= loop.length;
    cz /= loop.length;
    return { loop, c: [cx, cz], N: curveFrames(loop, [cx, cz], true).N };
  };
  const ring = (L, y, inset, s = 1) => L.loop.map((p, j) => {
    const x = p[0] - L.N[j][0] * inset, z = p[1] - L.N[j][1] * inset;
    return [L.c[0] + (x - L.c[0]) * s, y, L.c[1] + (z - L.c[1]) * s];
  });
  const first = prep(levels[0].loop), last = prep(levels[levels.length - 1].loop);
  const y0 = levels[0].y, y1 = levels[levels.length - 1].y;
  const bottomRows = [], side = [], topRows = [];
  for (let k = 0; k <= nCap; k++) bottomRows.push(ring(first, y0 - bottom, bottom, k / nCap));
  for (let k = 0; k <= nEdge; k++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (k / nEdge);
    side.push(ring(first, y0 + bottom * Math.sin(a), bottom * (1 - Math.cos(a))));
  }
  for (let i = 1; i < levels.length - 1; i++) side.push(levels[i].loop.map((p) => [p[0], levels[i].y, p[1]]));
  for (let k = 0; k <= nEdge; k++) {
    const a = (Math.PI / 2) * (k / nEdge);
    side.push(ring(last, y1 + top * Math.sin(a), top * (1 - Math.cos(a))));
  }
  for (let k = nCap; k >= 0; k--) {
    const s = k / nCap;
    const row = ring(last, y1 + top, top, s);
    if (dome) for (const p of row) p[1] += dome * (1 - s * s);
    topRows.push(row);
  }
  const geo = stripsGeometry([{ rows: bottomRows, uv: 'bottom' }, { rows: side, uv: 'grid', uRow: nEdge }, { rows: topRows, uv: 'top' }]);
  if (matrix) {
    geo.applyMatrix4(matrix);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
  return geo;
}

/** Loft frame for side-profile pieces: loft levels run along world x, a loop point [a, b] → world (z = a, y = b). */
const PROFILE_X = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);

/**
 * Rounded-rectangle tube swept along a polyline (arm caps and pads, neck rolls): section half-sizes a (across) and
 * b (along the section's up), corner radius fraction r (1 = fully round), each a number or a function of the path
 * fraction u. The across axis is `side` when given (fixed), else up × tangent. Domed ends (capLen · min(a, b)).
 */
function sweepGeometry(points, { a, b, r = 1, up = [0, 1, 0], side, nc = 4, ns = 2, nEnd = 4, capLen = 1 } = {}) {
  const P = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const n = P.length;
  const S = [0];
  for (let i = 1; i < n; i++) S.push(S[i - 1] + P[i].distanceTo(P[i - 1]));
  const total = S[n - 1] || 1;
  const val = (f, u) => (typeof f === 'function' ? f(u) : f);
  const U = new THREE.Vector3(...up), SD = side ? new THREE.Vector3(...side).normalize() : null;
  const frames = P.map((p, i) => {
    const t = new THREE.Vector3().subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
    let nn, bb;
    if (SD) {
      nn = new THREE.Vector3().crossVectors(t, SD).normalize();
      bb = new THREE.Vector3().crossVectors(nn, t).normalize();
    } else {
      nn = U.clone().addScaledVector(t, -U.dot(t)).normalize();
      bb = new THREE.Vector3().crossVectors(t, nn).normalize();
    }
    return { t, n: nn, b: bb };
  });
  const sect = (i, scale, shift) => {
    const u = S[i] / total;
    const A = Math.max(1e-5, val(a, u) * scale), Bh = Math.max(1e-5, val(b, u) * scale);
    const R = Math.min(A, Bh) * val(r, u);
    const loop = roundRectLoop(A, -Bh, Bh, R, R, nc, ns);
    const { t, n: nn, b: bb } = frames[i];
    const cx = P[i].x + t.x * shift, cy = P[i].y + t.y * shift, cz = P[i].z + t.z * shift;
    return loop.map(([x, y]) => [cx + bb.x * x + nn.x * y, cy + bb.y * x + nn.y * y, cz + bb.z * x + nn.z * y]);
  };
  const e0 = Math.min(val(a, 0), val(b, 0)) * capLen, e1 = Math.min(val(a, 1), val(b, 1)) * capLen;
  const rows = [];
  for (let k = nEnd; k >= 1; k--) {
    const f = (Math.PI / 2) * (k / nEnd);
    rows.push(sect(0, Math.max(1e-3, Math.cos(f)), -e0 * Math.sin(f)));
  }
  for (let i = 0; i < n; i++) rows.push(sect(i, 1, 0));
  for (let k = 1; k <= nEnd; k++) {
    const f = (Math.PI / 2) * (k / nEnd);
    rows.push(sect(n - 1, Math.max(1e-3, Math.cos(f)), e1 * Math.sin(f)));
  }
  return gridGeometry(rows);
}

/** Flips an open surface so its normals face away from (sign 1) / toward (−1) the vertical axis through (0, cz). */
function orientRadial(geo, sign, cz) {
  const p = geo.attributes.position.array, idx = geo.index.array;
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    s += (uy * vz - uz * vy) * (p[a] + p[b] + p[c]) + (ux * vy - uy * vx) * (p[a + 2] + p[b + 2] + p[c + 2] - 3 * cz);
  }
  if (s * sign < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
    geo.index.needsUpdate = true;
    K.smoothNormals(geo);
  }
  return geo;
}

/** Deterministic lattice hash / value noise (sheepskin curls). */
function hash3(i, j, k, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    r += hash3(ix + dx, iy + dy, iz + dz, s) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

/** Curly sheepskin / long pile: bumps the surface along its normals (clumps ≈ 4 cm, curls ≈ 2 cm), re-smooths. */
function fluff(geo, amp, seed = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const v = 0.6 * vnoise3(x * 24, y * 24, z * 24, seed) + 0.4 * vnoise3(x * 52 + 3.1, y * 52, z * 52, seed + 7);
    const dd = amp * (v - 0.45);
    p.setXYZ(i, x + n.getX(i) * dd, y + n.getY(i) * dd, z + n.getZ(i) * dd);
  }
  p.needsUpdate = true;
  K.smoothNormals(geo);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/** Swivel star of flat (or slim) bars: hub, glides, column and a mechanism plate under the seat at topY. */
function starBase(g, ms, { r, topY, q, arms = 5, slim = false, z = 0, plate = 0.22 }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const m = ms.legs();
  const seg = Math.max(10, Math.round(20 * q));
  const hubR = slim ? 0.03 : 0.042, hubH = Math.min(slim ? 0.032 : 0.055, topY * 0.6);
  sub.add(K.partMesh(K.cylinder(hubR * 0.85, hubR, hubH, { seg }), m, 'legs'));
  const len = Math.max(0.1, r - 0.012);
  const shape = slim
    ? [[0, 0.003], [len - 0.012, 0.003], [len, 0.006], [len, 0.013], [len - 0.03, 0.015], [0, Math.max(0.026, hubH * 0.8)]]
    : [[0, 0.012], [len - 0.012, 0.008], [len, 0.012], [len, 0.026], [len - 0.03, 0.03], [0, Math.max(0.035, hubH * 0.8)]];
  const geo = K.extrudeShape(shape, slim ? 0.032 : 0.04, { bevel: slim ? 0.003 : 0.005, center: true, curveSegments: 4 });
  const a0 = arms === 4 ? Math.PI / 4 : Math.PI / 2;
  for (let i = 0; i < arms; i++) {
    const a = a0 + (i / arms) * Math.PI * 2;
    sub.add(K.partMesh(i ? geo.clone() : geo, m, 'legs', { rotation: [0, -a, 0] }));
    sub.add(K.partMesh(K.cylinder(0.014, 0.016, slim ? 0.004 : 0.009, { seg: 10 }), mat('plastic', '#1a1a1a'), null, { position: [Math.cos(a) * (len - 0.022), 0, Math.sin(a) * (len - 0.022)] }));
  }
  const colR = slim ? 0.021 : 0.026, pT = plate > 0 ? 0.02 : 0;
  if (topY - pT > hubH + 0.004) sub.add(K.partMesh(K.cylinder(colR, colR * 1.08, topY - pT - hubH, { seg }), m, 'legs', { position: [0, hubH, 0] }));
  if (plate > 0) sub.add(K.partMesh(K.roundedBox(plate, pT, plate * 0.9, 0.005, 1, { bottom: true }), m, 'legs', { position: [0, topY - pT, 0] }));
}

/** Stressless «Classic» base: a flat oval wooden ring on the floor and a curved plank rising from its rear to a plate under the seat. */
function ringBase(g, ms, { rx, rz, topY, q, z = 0 }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const m = ms.legs();
  const n = Math.max(32, Math.round(56 * q));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz));
  }
  const ring = K.tube(pts, 0.026, { closed: true, radial: 10, seg: n * 2 });
  ring.scale(1, 0.6, 1);
  ring.translate(0, 0.016, 0);
  sub.add(K.partMesh(ring, m, 'legs'));
  // two S-curved planks: from the ring's rear, forward and up to the plate under the seat
  for (const sx of [-1, 1]) {
    const col = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const yy = 0.03 + (topY - 0.05) * (t * t * (3 - 2 * t));
      const zz = -rz * 0.92 + (rz * 0.92 + 0.02) * Math.sin((t * Math.PI) / 2) ** 1.4;
      col.push([sx * 0.055, yy, zz]);
    }
    sub.add(K.partMesh(sweepGeometry(col, { a: 0.026, b: 0.014, r: 0.5, side: [1, 0, 0], nc: 3, ns: 2, nEnd: 2, capLen: 0.4 }), m, 'legs'));
  }
  sub.add(K.partMesh(K.roundedBox(0.2, 0.02, 0.2, 0.005, 1, { bottom: true }), mat('black-metal', '#1b1b1b', { flat: true }), null, { position: [0, topY - 0.02, 0.02] }));
}

/** Small black recline lever on the right-hand side face (x = side face, sx = outward sign). */
function addLever(g, m, [x, y, z], sx) {
  g.add(K.partMesh(K.cylinder(0.006, 0.006, 0.028, { seg: 8, center: true }), m, null, { position: [x + sx * 0.012, y, z], rotation: [0, 0, Math.PI / 2] }));
  g.add(K.partMesh(K.roundedBox(0.011, 0.013, 0.07, 0.005, 1), m, null, { position: [x + sx * 0.026, y - 0.01, z - 0.028], rotation: [0.35, 0, 0] }));
}

function buildRecliner(spec) {
  const st = reclinerStyle(spec);
  const { w, d, h } = spec.dims;
  const P = spec.params, C = spec.colors, M = spec.materials;
  const q = qf(spec);
  const disc = P.legStyle === 'swivel-disc';
  const ms = materials(spec, disc ? 'swivel-disc' : 'swivel-star');
  const g = new THREE.Group();
  const { body, pile } = st;
  const upKind = M.upholstery || 'woven';
  // sheepskin: the teddy texture at 3× (curls ≈ 1.5 cm) on bumped geometry (fluff)
  const up = pile ? mat(upKind, C.upholstery, { scale: 4 }) : ms.up;
  const hasFrame = !!C.frame;
  const frameMat = (opts) => (hasFrame ? mat(M.frame || 'oak', C.frame, opts) : ms.up);
  const framePart = hasFrame ? 'frame' : 'upholstery';
  const metal = mat('black-metal', '#1b1b1b', { flat: true });
  const fuzzy = [];
  const step = (pile ? 0.026 : 0.03) / Math.min(q, 1.25); // vertex spacing of the soft parts (the curls need it finer)
  const segFor = (...s) => Math.max(6, Math.round((Math.max(...s) / (pile ? 0.026 : 0.05)) * Math.min(q, 1.25)));
  const addUp = (parent, geo, opts) => {
    const m = K.partMesh(geo, up, 'upholstery', opts);
    parent.add(m);
    if (pile) fuzzy.push(m);
    return m;
  };
  const addFrame = (parent, geo, opts, material = frameMat()) => {
    const m = K.partMesh(geo, material, framePart, opts);
    parent.add(m);
    return m;
  };
  const addPlain = (parent, geo, opts) => {
    const m = K.partMesh(geo, ms.up, 'upholstery', opts);
    parent.add(m);
    return m;
  };
  const levelsY = (y0, y1, extra = [], st0 = step) => {
    const n = Math.max(2, Math.ceil((y1 - y0) / st0));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(y0 + ((y1 - y0) * i) / n);
    for (const e of extra) if (e > y0 + 0.004 && e < y1 - 0.004) out.push(e);
    out.sort((a, b) => a - b);
    return out.filter((v, i) => i === 0 || v - out[i - 1] > 0.003);
  };

  // ---- heights, widths, depths
  const seatH = clamp(num(P.seatH, 0.45), 0.32, h - 0.4);
  const armH = clamp(num(P.armH, 0.6), seatH + 0.08, h - 0.25);
  const armW = clamp(num(P.armW, 0.12), 0.05, w * 0.2);
  const legH = clamp(num(P.legH, 0.15), 0.04, seatH - 0.2);
  const zr = -d / 2, zf = d / 2;
  const yb = legH + 0.02; // underside of the chair body (mechanism plate under it)
  const shT = 0.022; // moulded shell wall
  const integrated = st.rest === 'integrated';
  // tulip arm: thickness tkT(t) and centre |x| xcT(t) from the foot (t = 0) to the top (t = 1): it hugs the seat at
  // tS and leans out above it into the broad, outward-curling top (Taycan); the foot tucks in under the seat
  const tk0 = 0.045, tk1 = clamp(armW * 0.85, 0.06, 0.11), tFlare = clamp(w * 0.08, 0.04, 0.075);
  const ya0 = Math.max(yb + 0.03, seatH - 0.3);
  const tS = clamp01((seatH - 0.07 - ya0) / (armH - ya0));
  const tkT = (t) => lerp(tk0, tk1, sstep(0.4, 1, t));
  // inner face beside the seat; the rounded top cap insets the curl, so the arms are pushed out to reach dims.w
  const xI0 = w / 2 - tk1 - tFlare + Math.min(0.035, tk1 * 0.35);
  const tC = lerp(tS, 1, 0.3); // the curl starts a little above the seat
  const xInT = (t) => (t >= tC ? xI0 + tFlare * ((t - tC) / (1 - tC || 1)) ** 1.8 : xI0 - 0.05 * (1 - Math.min(1, t / (tS || 1))) ** 1.5);
  const xcT = (t) => xInT(t) + tkT(t) / 2;
  let iw, bw;
  if (body === 'box') {
    iw = w - 2 * armW + 0.012;
    // the back sits between the arm panels' inner halves (Chicago, Bern); Zermatt / Grande have a narrower back
    bw = Math.min(w - armW, iw + (P.sides === 'fabric' || (!P.sides && st.sides === 'fabric') ? 0.05 : 0.025));
  } else if (body === 'shell') {
    iw = w - 2 * shT - 0.03;
    bw = w * 0.6;
  } else if (body === 'classic') {
    iw = w - 2 * armW - 0.006; // the arm pads sit outboard of the seat (Stressless)
    bw = iw - 0.01;
  } else {
    iw = 2 * xI0 + 0.01; // tucked into the arms (its rounded sides would leave a gap)
    bw = iw + 0.01;
  }
  const seatD = clamp(num(P.seatD, d * 0.62), 0.36, d - 0.22);
  const zSF = zf - 0.012; // seat front
  const zP = zSF - seatD * 0.93; // front of the back at the seat (seatD is measured to the bulging lumbar)
  const yP = seatH - 0.1; // bottom of the back (inside the seat)
  const T0 = body === 'shell' ? 0.15 : 0.19, T1 = body === 'shell' ? 0.12 : 0.135;
  const sep = st.head === 'block' || st.head === 'roll' || st.head === 'wing';
  const headH = st.head === 'roll' ? clamp(h * 0.19, 0.15, 0.21) : st.head === 'wing' ? clamp(h * 0.2, 0.16, 0.24) : st.head === 'block' ? clamp(h * 0.2, 0.16, 0.24) : 0;
  const gap = sep ? (st.head === 'roll' ? -0.03 : 0.007) : 0; // the roll rests on the rounded top of the back cushion
  // recline: as much as the depth behind the seat allows (the top of the back stays inside dims.d)
  const recDef = (body === 'shell' ? 20 : body === 'tulip' ? 20 : 18) * DEG;
  // (the shell's back rim is low, so only the cushion top of a Timeout may lean a little past dims.d)
  const room = zP - zr + (body === 'shell' ? 0.05 : 0.012) - T1 - (body === 'shell' ? shT + 0.012 : 0);
  const rec = clamp(Math.atan(Math.max(0, room) / (h - yP)), 2 * DEG, recDef);
  const cr = Math.cos(rec), tr = Math.tan(rec);
  const L = (h - yP) / cr - headH - gap - (st.head === 'wing' ? 0.02 : sep ? 0.008 : 0); // the back's own length (local y); a separate neck cushion leans forward and up
  const Tat = (yl) => lerp(T0, T1, clamp01(yl / L));
  const rearZ = (y) => zP - Math.max(0, y - yP) * tr - Tat(Math.max(0, y - yP) / cr) / cr; // world z of the back's rear
  const ylSeat = Math.max(0.03, (seatH - 0.035 - yP) / cr); // the seat surface in back coordinates

  // ---- back: one loft with sewn seams (pillowed panels, creased seam lines), or a smooth shell + cushion
  const back = new THREE.Group();
  back.position.set(0, yP, zP);
  back.rotation.x = -rec;
  g.add(back);
  const yNeck = st.head === 'integrated' ? L - clamp(h * 0.2, 0.17, 0.24) : Infinity;
  const yLum = ylSeat + (st.seams === 'buttons' ? 0.25 : body === 'shell' ? 0.24 : 0.2);
  const seamsY = [];
  if (st.seams !== 'none' && yLum < Math.min(yNeck, L) - 0.12) seamsY.push(yLum);
  if (yNeck < L) seamsY.push(yNeck);
  const vBand = st.seams === 'cross-v' && seamsY.length ? [yLum, Math.min(yNeck, L - 0.08)] : null;
  const sig = 0.032;
  const dip = (v, s0) => 1 - Math.exp(-(((v - s0) / sig) ** 2));
  const groove = (v, s0) => Math.exp(-(((v - s0) / 0.007) ** 2));
  const pillowA = pile ? 0.006 : 0.02;
  // seam pillowing on the front face (0 at the edge of the flat front, xf); the lumbar / neck profile moves the whole front
  const backFront = (x, yl, xf) => {
    let py = 1, gr = 0;
    for (const s of seamsY) {
      py *= dip(yl, s);
      gr += groove(yl, s);
    }
    let px = 1 - Math.pow(Math.min(1, Math.abs(x) / xf), 4);
    if (vBand) {
      const inside = sstep(vBand[0] - 0.01, vBand[0] + 0.03, yl) * (1 - sstep(vBand[1] - 0.03, vBand[1] + 0.01, yl));
      px *= 1 - inside * (1 - dip(x, 0));
      gr += inside * groove(x, 0);
    }
    return pillowA * py * px - 0.006 * Math.min(1, gr);
  };
  const backBase = (yl) => 0.016 * Math.exp(-(((yl - (ylSeat + 0.12)) / 0.13) ** 2)) + (Number.isFinite(yNeck) ? 0.026 * sstep(yNeck - 0.01, yNeck + 0.07, yl) : 0);
  const seamExtra = seamsY.flatMap((s) => [s - 0.03, s - 0.012, s, s + 0.012, s + 0.03]).concat(vBand ? [vBand[0] + 0.03, vBand[1] - 0.03] : []);
  const backLoft = ({ hw, zRear, zFront = () => 0, front, y0 = 0, y1, rTop, rBot = 0.012, rf = 0.04, rb = 0.05 }) => {
    const ys = levelsY(y0 + rBot, y1 - rTop, seamExtra);
    const hw0 = typeof hw === 'function' ? hw(0) : hw;
    const nx = 2 * Math.max(4, Math.round(hw0 / step));
    const levels = ys.map((yl) => {
      const hwv = typeof hw === 'function' ? hw(yl) : hw;
      // corner radii never below the cap radii (an inset ring larger than a corner radius folds over)
      const rMin = Math.max(rTop, rBot) * 1.02, rfE = Math.max(rf, rMin);
      return { y: yl, loop: rrLoop(hwv, zRear(yl), zFront(yl), rfE, Math.max(rb, rMin), { nx, nArc: 5, nSide: 3, front: front ? (x) => front(x, yl, hwv - rfE) : null }) };
    });
    return loftGeometry(levels, { top: rTop, bottom: rBot, nEdge: 4, nCap: 3 });
  };
  const rTopB = Math.min(T1 * 0.48, 0.075);
  if (body === 'shell') {
    addUp(back, backLoft({ hw: (yl) => (bw / 2) * (1 - 0.1 * clamp01(yl / L)), zRear: (yl) => -Tat(yl), zFront: backBase, front: backFront, y1: L, rTop: Math.min(T1 * 0.5, 0.065), rf: 0.06, rb: 0.07 }));
  } else if (body === 'box' && st.sides === 'shell') {
    addFrame(back, backLoft({ hw: bw / 2, zRear: (yl) => -Tat(yl), y1: L, rTop: rTopB, rf: 0.03 }));
    const cT = 0.075;
    addUp(back, backLoft({ hw: bw / 2 - 0.024, zRear: () => -0.035, zFront: (yl) => cT + backBase(yl), front: backFront, y0: ylSeat - 0.07, y1: L - 0.004, rTop: 0.045, rBot: 0.03, rf: 0.035, rb: 0.01 }));
  } else {
    addUp(back, backLoft({ hw: bw / 2, zRear: (yl) => -Tat(yl), zFront: backBase, front: backFront, y1: L, rTop: rTopB }));
  }
  if (st.seams === 'buttons' && seamsY.length) {
    const bg = sharedButton(q);
    for (let i = 0; i < 4; i++) back.add(K.partMesh(bg, ms.up, 'upholstery', { position: [((i + 0.5) / 4 - 0.5) * bw * 0.72, yLum + 0.004, backBase(yLum) + backFront(0, yLum, bw / 2) + 0.002] }));
  }

  // ---- neck cushion (separate pieces sit on two posts above the back)
  const yH = L + gap;
  if (gap > 0) {
    for (const sx of [-1, 1]) back.add(K.partMesh(K.cylinder(0.006, 0.006, gap + 0.09, { seg: 8 }), ms.legs(), 'legs', { position: [sx * bw * 0.22, L - 0.05, -0.06] }));
  }
  if (st.head === 'block') {
    const hwB = bw * 0.97, hd = 0.15;
    const geo = softBox(hwB, headH, hd, 'z', { puff: 0.14, round: 0.75, sides: 0.2, q, seg: segFor(hwB, headH) });
    const pos = [0, yH + headH / 2, 0.035 - hd / 2];
    addUp(back, geo, { position: pos });
  } else if (st.head === 'roll') {
    const hr = bw * 0.52, a = 0.08, b = headH / 2;
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([lerp(-hr + a * 0.8, hr - a * 0.8, i / 8), yH + b, 0.065 - a]);
    addUp(back, sweepGeometry(pts, { a, b, r: 1, nc: Math.max(4, Math.round(6 * q)), ns: 2, nEnd: 5, capLen: 0.8 }));
  } else if (st.head === 'wing') {
    // wing-shaped neck cushion (Taycan): one cushion bent so the wings come forward, wider at the top, with two
    // vertical seams between the centre panel and the wings (a softBox deformed in place)
    const T = 0.11, hw0 = Math.min(bw * 0.5, w * 0.34), hw1 = Math.min(w * 0.38, bw * 0.62), xc0 = Math.min(0.14, hw0 * 0.55);
    const hwM = (hw0 + hw1) / 2;
    const geo = softBox(2 * hwM, headH, T, 'z', { puff: 0.1, round: 0.6, sides: 0.12, q, seg: Math.max(16, segFor(2 * hwM) * 2) });
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = clamp01(p.getY(i) / headH + 0.5), hw = lerp(hw0, hw1, t);
      const x = (p.getX(i) / hwM) * hw, ax = Math.abs(x);
      const k = ax > xc0 ? clamp01((ax - xc0) / (hw - xc0)) : 0;
      let z = p.getZ(i) + lerp(0.025, 0.05, t) * k * k;
      const fr = clamp01(p.getZ(i) / (T / 2)); // the front face only
      if (fr > 0) z -= fr * (0.016 * (1 - dip(ax, xc0)) + 0.003 * groove(ax, xc0));
      p.setXYZ(i, x, p.getY(i), z);
    }
    p.needsUpdate = true;
    K.smoothNormals(geo);
    K.worldUV(geo);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    addUp(back, geo, { position: [0, yH + headH / 2, 0.035 - T / 2] });
  }

  // ---- seat (Chicago / Bern: one thick block down to the body bottom), apron, chassis
  const tilt = 4 * DEG;
  const seatFull = body === 'box' && st.sides !== 'shell' && !integrated;
  const sTh = seatFull ? Math.max(0.12, seatH - yb - 0.01) : body === 'shell' ? 0.16 : body === 'tulip' && integrated ? 0.19 : pile ? 0.17 : 0.14;
  const sD = zSF - zP + 0.05;
  const seat = new THREE.Group();
  seat.position.set(0, seatH, zSF);
  seat.rotation.x = -tilt;
  g.add(seat);
  addUp(seat, softBox(iw, sTh, sD, 'y', { puff: seatFull ? 0.05 : 0.1, round: seatFull ? 0.55 : 0.85, sides: 0.15, bottom: 0.05, q, seg: segFor(iw, sD) }), { position: [0, -sTh / 2, -sD / 2] });
  if (body === 'box' && !seatFull && !integrated) {
    const apH = Math.max(0.05, seatH - sTh + 0.03 - yb);
    const geo = softBox(iw - 0.01, apH, 0.1, 'z', { puff: 0.06, round: 0.6, sides: 0.1, q });
    const pos = [0, yb + apH / 2, zSF - 0.085];
    if (st.sides === 'shell') addFrame(g, geo, { position: pos });
    else addPlain(g, geo, { position: pos });
  }
  if (body === 'box') {
    const cz0 = rearZ(yb) + 0.02, cz1 = seatFull ? zP + 0.05 : zSF - 0.1;
    const cH = Math.max(0.05, yP + 0.04 - yb);
    const geo = softBox(iw - 0.004, cH, Math.max(0.05, cz1 - cz0), 'y', { puff: 0.02, round: 0.4, sides: 0.05, q });
    const pos = [0, yb + cH / 2, (cz0 + cz1) / 2];
    if (st.sides === 'shell') addFrame(g, geo, { position: pos });
    else addPlain(g, geo, { position: pos });
  }

  // ---- integrated footrest: a tall padded panel under the seat front (closed) or swung out (footrestOpen)
  const colliders = [{ min: [-w / 2, 0, zr], max: [w / 2, h, zf] }];
  if (integrated) {
    const fT = st.open ? (body === 'tulip' ? 0.12 : 0.1) : 0.15;
    // closed, the panel reaches well up behind the seat front, so no notch shows between seat and footrest
    const hingeY = seatH - sTh + (st.open ? 0.025 : sTh * 0.55), hingeZ = zSF - 0.035;
    const pH = Math.max(0.1, hingeY - 0.07);
    const fr = new THREE.Group();
    fr.position.set(0, hingeY + (st.open ? 0.02 : 0), hingeZ + (st.open ? 0.1 : 0));
    fr.rotation.x = st.open ? -76 * DEG : (body === 'tulip' ? 2 : 7) * DEG; // closed: nearly upright, sloping back a little toward the base
    g.add(fr);
    // closed: as wide as the seat and flush with its front, so seat and footrest read as one block (Taycan, Grande)
    addUp(fr, softBox(iw - (st.open ? 0.008 : 0.002), pH, fT, 'z', { puff: 0.08, round: st.open ? 0.7 : 0.45, sides: 0.12, bottom: 0.3, q, seg: segFor(iw, pH) }), { position: [0, -pH / 2, 0.035 - fT / 2] });
    if (st.open) {
      fr.updateMatrix();
      for (const sx of [-1, 1]) {
        const tip = new THREE.Vector3(sx * iw * 0.3, -pH * 0.55, 0.035 - fT - 0.005).applyMatrix4(fr.matrix);
        addLeg(g, metal, null, [sx * iw * 0.3, seatH - sTh - 0.01, zSF - 0.16], tip.toArray(), 0.008, 0.008, { seg: 6, square: true });
      }
      colliders.push({ min: [-iw / 2, 0, zf - 0.02], max: [iw / 2, hingeY + 0.08, zf + pH + 0.14] });
    }
  }

  // ---- arms
  if (body === 'box') {
    const veneer = st.sides === 'veneer', shellSides = st.sides === 'shell';
    // an upholstered roll over the top and down the front (Zermatt, Grande); armCap: false keeps the plain panel top
    // (Timeout in a wooden shell: veneer on the outer face, the upholstered panel forms the arm top)
    const capped = (veneer || shellSides) && P.armCap !== false;
    const flare = veneer ? 0.012 : shellSides ? 0.02 : Math.min(0.05, armW * 0.4);
    // armBottom: the side panels may stop above the base (Timeout: the column shows under them)
    const yA0 = clamp(num(P.armBottom, Math.max(yb + 0.004, seatH - 0.3)), yb + 0.004, seatH - 0.05);
    const capB = veneer ? 0.052 : 0.058; // half height of the arm roll (its top = armH)
    const topA = capped ? armH - capB * 1.45 : armH; // panel top (inside the lower half of the roll)
    const xi = w / 2 - armW;
    const rTopA = Math.min(armW * 0.45, 0.055, (topA - yA0) * 0.3);
    // armTuck: the panels lean out toward the top (petal arms, Timeout): pulled in by `tuck` at the bottom
    const tuck = clamp(num(P.armTuck, 0), 0, 0.08);
    const shiftX = (y) => -tuck * (1 - sstep(yA0, topA, y)) ** 1.6;
    const rFB = Math.min(0.24, (topA - yA0) * 0.55);
    const zFa = zf - 0.006;
    // the outer face leans out toward the rolled top (Chicago: «buer litt utover»)
    const over = capped ? (shellSides ? 0.02 : 0.012) : 0; // the roll over the top overhangs the panel by this much
    const xo = (y) => w / 2 - over - flare * (1 - sstep(yA0, topA + 0.02, y)) ** 1.3;
    const zFat = (y) => {
      const dy = Math.max(0, yA0 + rFB - y);
      return zFa - (rFB - Math.sqrt(Math.max(0, rFB * rFB - dy * dy)));
    };
    const rBB = rFB * 0.7; // the rear-bottom corner rounds up too (the side reads as a «D»)
    const zBat = (y) => {
      const dy = Math.max(0, yA0 + rBB - y);
      return rearZ(y) + 0.012 + (rBB - Math.sqrt(Math.max(0, rBB * rBB - dy * dy)));
    };
    const extra = [];
    for (let k = 1; k < 7; k++) extra.push(yA0 + rFB * (k / 7) ** 1.5);
    for (const sx of [-1, 1]) {
      const levels = levelsY(yA0 + 0.012, topA - rTopA, extra, 0.045).map((y) => {
        const hwA = (xo(y) - xi) / 2, zB = zBat(y), zF = Math.max(zB + 0.05, zFat(y));
        return { y, loop: rrLoop(hwA, zB, zF, Math.min(hwA * 0.96, 0.055), rTopA * 1.02, { nx: 4, nArc: 5, nSide: 4, cx: sx * (xi + hwA + shiftX(y)) }) };
      });
      const panel = loftGeometry(levels, { top: rTopA, bottom: 0.012, nEdge: 4, nCap: 3 });
      if (shellSides) addFrame(g, panel);
      else addPlain(g, panel);
      if (veneer) {
        // wooden side plate on the outer face, under the roll and behind the fabric front strip
        const levels2 = levelsY(yA0 + 0.016, capped ? topA - 0.006 : topA - rTopA * 1.15, extra, 0.045).map((y) => {
          const zB = zBat(y) + 0.012, zF = Math.max(zB + 0.04, zFat(y) - 0.045);
          return { y, loop: rrLoop(0.0075, zB, zF, 0.007, 0.007, { nx: 2, nArc: 3, nSide: 4, cx: sx * (xo(y) - 0.0035 + shiftX(y)) }) };
        });
        addFrame(g, loftGeometry(levels2, { top: 0.006, bottom: 0.006, nEdge: 2, nCap: 2 }), {}, frameMat({ grain: 'v' }));
      }
      if (capped) {
        // upholstered arm roll over the top and down the front (sheepskin on Zermatt, the cover fabric on Grande)
        const hwT = (xo(topA) - xi) / 2 + (shellSides ? 0.02 : 0.012), bT = capB;
        const yC = armH - bT, cx = sx * (xi + xo(topA)) / 2;
        const z0 = zBat(topA) + 0.04, z1 = zFa - bT + 0.012, rc = Math.min(0.07, bT * 1.4);
        // the roll wraps over the top and down the front edge to about the seat (a C seen from the side); armFrontDrop
        // (m below the roll) shortens it
        const yDown = shellSides ? Math.max(seatH - 0.06, yC - 0.2) : Math.max(yA0 + 0.03, P.armFrontDrop != null ? yC - num(P.armFrontDrop, 0.11) : seatH - 0.04);
        const pts = [];
        for (let i = 0; i <= 8; i++) pts.push([cx, yC, lerp(z0, z1 - rc, i / 8)]);
        for (let k = 1; k <= 6; k++) {
          const a = (Math.PI / 2) * (k / 6);
          pts.push([cx, yC - rc + rc * Math.cos(a), z1 - rc + rc * Math.sin(a)]);
        }
        const nD = Math.max(3, Math.round((yC - rc - yDown) / 0.03));
        for (let i = 1; i <= nD; i++) {
          const y = lerp(yC - rc, yDown, i / nD);
          pts.push([cx, y, zFat(y) - bT + 0.012]);
        }
        addUp(g, sweepGeometry(pts, { a: hwT, b: bT, r: 0.9, side: [1, 0, 0], nc: 5, ns: 3, nEnd: 4, capLen: 0.8 }));
      }
    }
    if (st.lever) addLever(g, metal, [-(xo(armH - 0.13) + shiftX(armH - 0.13) + (veneer ? 0.004 : 0)), Math.min(topA - 0.06, armH - 0.13), zf - 0.27], -1);
  } else if (body === 'classic') {
    // Stressless: thick padded arm bolsters above the seat, open underneath, on a short wooden post at the rear (the
    // base colour) that rises from the seat frame
    const padH = 0.072, padW = Math.max(armW, 0.09);
    const zA0 = rearZ(armH) + 0.03, zA1 = zf - 0.04;
    const bracket = ms.legs();
    const yS = seatH - sTh + 0.03;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - padW / 2);
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push([x, armH - padH / 2 - 0.018 * t * t, lerp(zA0, zA1, t)]);
      }
      addUp(g, sweepGeometry(pts, { a: padW / 2, b: padH / 2, r: 0.85, nc: 5, ns: 3, nEnd: 4, capLen: 0.9 }));
      const zPost = zA0 + 0.09;
      addBeam(g, bracket, 'legs', [sx * (iw / 2 - 0.02), yS, zPost - 0.05], [x, armH - padH + 0.006, zPost], 0.034, 0.024, 0.006);
      addBeam(g, bracket, 'legs', [sx * (iw / 2 - 0.02), yS, zPost - 0.05], [sx * (iw / 2 - 0.02), yS, zf - 0.2], 0.034, 0.022, 0.006);
    }
    // seat frame under the cushion, on the base plate
    const fH = Math.max(0.03, seatH - sTh - legH - 0.025);
    g.add(K.partMesh(K.roundedBox(iw * 0.6, fH, (zSF - zP) * 0.55, 0.012, 2, { bottom: true }), metal, null, { position: [0, legH + 0.025, (zSF + zP) / 2 - 0.03] }));
  } else if (body === 'tulip') {
    // thin petals: broad top from beside the back to near the seat front, narrowing to a foot under the seat
    const zTop0 = zP - 0.045, zTop1 = zSF - 0.075;
    const zMidB = lerp(zTop0, zTop1, 0.38);
    const rTopT = tk1 * 0.48, rBotT = tk0 * 0.45;
    const petal = (t) => {
      const s = Math.sin((Math.PI / 2) * clamp01(t));
      // a rounded petal from the side: a fairly broad foot, the front edge curving up and forward to the top
      return [zMidB - (zMidB - zTop0) * (0.38 + 0.62 * clamp01(t) ** 0.8), zMidB + (zTop1 - zMidB) * (0.38 + 0.62 * s ** 0.55)];
    };
    const tOf = (y) => (y - ya0) / (armH - ya0);
    for (const sx of [-1, 1]) {
      const levels = levelsY(ya0 + rBotT, armH - rTopT, [], 0.03).map((y) => {
        const t = tOf(y), [zB, zF] = petal(t), hwv = tkT(t) / 2;
        return { y, loop: rrLoop(hwv, zB, zF, hwv * 0.96, hwv * 0.96, { nx: 2, nArc: 5, nSide: 6, cx: sx * xcT(t) }) };
      });
      addUp(g, loftGeometry(levels, { top: rTopT, bottom: rBotT, nEdge: 4, nCap: 3 }));
      if (hasFrame) {
        // «vanger»: a thin plate on the outer face (walnut on Taycan Wood, the cover fabric otherwise)
        const lv = levelsY(lerp(ya0, armH, 0.12), lerp(ya0, armH, 0.8), [], 0.03).map((y) => {
          const t = tOf(y), [zB, zF] = petal(t);
          return { y, loop: rrLoop(0.006, zB + 0.02, zF - 0.02, 0.0055, 0.0055, { nx: 2, nArc: 3, nSide: 6, cx: sx * (xcT(t) + tkT(t) / 2 - 0.0035) }) };
        });
        addFrame(g, loftGeometry(lv, { top: 0.005, bottom: 0.005, nEdge: 2, nCap: 2 }), {}, frameMat({ grain: 'v' }));
      }
    }
    // mechanism under the seat, joining the arm feet
    g.add(K.partMesh(K.roundedBox(0.18, 0.05, 0.22, 0.01, 1, { bottom: true }), metal, null, { position: [0, legH, lerp(zr, zf, 0.47)] }));
    addLeg(g, metal, null, [-xcT(0.04), ya0 + 0.03, zMidB], [xcT(0.04), ya0 + 0.03, zMidB], 0.012, 0.012, { seg: 8 });
  } else {
    // ---- moulded shell (Timeout): one bowl round seat and back, rim low at the front, along the arms, high behind
    const T = shT, n = 3.2;
    const Sx = (v) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);
    const zFs = zf - 0.045;
    const yTopSh = armH + 0.02; // the shell's back rim just above the arms: the back cushion stands free above it
    const padH = 0.065, padW = armW + 0.026;
    const yArmRim = armH - padH + 0.006;
    const yLip = seatH - sTh + 0.005;
    const Rx = 0.06, Rz = 0.21;
    const ys = Math.min(yb, seatH - sTh - Rx + 0.004); // shell bottom: the seat cushion sits on the flat of the bowl
    const xHalf = (y) => lerp(w / 2, bw / 2 + T + 0.025, sstep(armH - 0.02, yTopSh, y));
    const zBk = (y) => rearZ(Math.max(y, yP)) - T - 0.008;
    const pt = (phi, y, t) => {
      const yy = Math.max(y, ys + t + 1e-4);
      const ax = xHalf(yy) - t, zF = zFs - t, zB = zBk(yy) + t;
      const zc = (zF + zB) / 2, az = (zF - zB) / 2;
      const kx = yy < ys + Rx ? Math.sqrt(Math.max(0, 1 - ((ys + Rx - yy) / (Rx - t)) ** 2)) : 1;
      const kz = yy < ys + Rz ? Math.sqrt(Math.max(0, 1 - ((ys + Rz - yy) / (Rz - t)) ** 2)) : 1;
      return [ax * kx * Sx(Math.sin(phi)), yy, zc - az * kz * Sx(Math.cos(phi))];
    };
    const phiAt = (z, y) => {
      const zB = zBk(y), zc = (zFs + zB) / 2, az = (zFs - zB) / 2;
      const u = clamp((zc - z) / az, -1, 1);
      return Math.acos(Math.sign(u) * Math.pow(Math.abs(u), n / 2));
    };
    const ph2 = phiAt(zP + 0.02, yArmRim), ph3 = phiAt(zf - 0.075, yArmRim), ph1 = Math.max(0.15, ph2 - 0.5);
    const rim = (phi) => {
      const pa = phi <= Math.PI ? phi : 2 * Math.PI - phi;
      if (pa <= ph1) return yTopSh;
      if (pa <= ph2) return lerp(yTopSh, yArmRim, sstep(ph1, ph2, pa));
      if (pa <= ph3) return yArmRim;
      return lerp(yArmRim, yLip, sstep(ph3, Math.PI, pa));
    };
    const m = 2 * Math.max(24, Math.round(36 * q));
    const nB = Math.max(5, Math.round(7 * q)), nU = Math.max(6, Math.round((yTopSh - ys - Rz) / 0.035)), nR = 4;
    const phis = [];
    for (let j = 0; j < m; j++) phis.push((j / m) * Math.PI * 2);
    const surfRows = (t) => {
      const rows = [];
      for (let k = 0; k <= nB; k++) {
        const beta = (Math.PI / 2) * (k / nB);
        rows.push(phis.map((ph) => pt(ph, Math.min(rim(ph), ys + t + (Rz - t) * (1 - Math.cos(beta))), t)));
      }
      for (let k = 1; k <= nU; k++) {
        rows.push(phis.map((ph) => {
          const r0 = Math.min(rim(ph), ys + Rz);
          return pt(ph, lerp(r0, rim(ph), k / nU), t);
        }));
      }
      return rows;
    };
    const outer = surfRows(0), inner = surfRows(T);
    const oTop = outer[outer.length - 1], iTop = inner[inner.length - 1];
    const rimRows = [];
    for (let k = 1; k < nR; k++) {
      const f = (Math.PI * k) / nR;
      rimRows.push(oTop.map((po, j) => {
        const pi = iTop[j];
        const mx = (po[0] + pi[0]) / 2, my = (po[1] + pi[1]) / 2, mz = (po[2] + pi[2]) / 2;
        const half = Math.hypot(po[0] - pi[0], po[2] - pi[2]) / 2;
        return [mx + (po[0] - mx) * Math.cos(f), my + half * Math.sin(f), mz + (po[2] - mz) * Math.cos(f)];
      }));
    }
    const zc0 = (zFs + zBk(armH)) / 2;
    addFrame(g, orientRadial(stripsGeometry([{ rows: [...outer, ...rimRows, iTop], uv: 'box' }]), 1, zc0));
    addPlain(g, orientRadial(stripsGeometry([{ rows: [...inner].reverse(), uv: 'box' }]), -1, zc0));
    // padded arm tops along the rim
    for (const sx of [-1, 1]) {
      const pts = [], np = 14;
      for (let k = 0; k <= np; k++) {
        const u = k / np, ph0 = lerp(ph2 - 0.16, ph3 + 0.05, u);
        const pm = pt(sx > 0 ? ph0 : 2 * Math.PI - ph0, yArmRim, T / 2);
        pts.push([pm[0] - sx * (padW / 2 - T / 2 - 0.004) + sx * 0.022 * sstep(0.72, 1, u), yArmRim + padH / 2 - 0.006 + 0.016 * sstep(0.75, 1, u), pm[2]]);
      }
      addUp(g, sweepGeometry(pts, { a: padW / 2, b: padH / 2, r: 0.85, nc: 5, ns: 3, nEnd: 4, capLen: 1 }));
    }
    if (st.lever) {
      const pl = pt(2 * Math.PI - phiAt(zf - 0.3, yArmRim - 0.08), yArmRim - 0.08, 0);
      addLever(g, metal, [pl[0] - 0.002, pl[1], pl[2]], -1);
    }
  }

  // ---- base (swivel star of 5 flat bars, slim 4-bar star, or round plate)
  const zBase = body === 'shell' ? (zf - 0.045 + rearZ(yb)) / 2 : lerp(zr, zf, 0.47);
  if (body === 'classic') ringBase(g, ms, { rx: clamp(w * 0.4, 0.22, 0.34), rz: clamp(d * 0.42, 0.22, 0.34), topY: legH + 0.004, q, z: zBase });
  else if (disc) {
    const sub = new THREE.Group();
    sub.position.z = zBase;
    g.add(sub);
    swivelDisc(sub, ms, clamp(Math.min(w, d) * 0.4, 0.2, 0.32), legH + 0.004, q);
  } else starBase(g, ms, { r: clamp(Math.min(w, d) * 0.44, 0.24, 0.38), topY: legH + 0.004, q, arms: st.starArms, slim: st.slim, z: zBase, plate: 0.24 });

  // ---- footstool in front of the chair (outside dims.d): own 4-arm star, same cover and outer material
  if (st.rest === 'stool') {
    const [sw0, sd0, sh0] = st.stool;
    const fw = clamp(sw0 || Math.min(0.56, w * 0.7), 0.35, w * 1.05);
    const fd = clamp(sd0 || 0.42, 0.28, 0.6);
    const fh = clamp(sh0 || Math.min(0.42, seatH - 0.02), 0.25, seatH + 0.02);
    const fz = zf + 0.14 + fd / 2;
    const fs = new THREE.Group();
    fs.position.z = fz;
    g.add(fs);
    const cT = clamp(fh * (body === 'box' && st.sides !== 'shell' ? 0.34 : 0.4), 0.11, 0.19);
    let yc0 = fh - cT;
    if (body === 'shell') {
      // small moulded tray with a thick cushion
      const trayH = 0.06, ty0 = yc0 - 0.03;
      const lv = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4, s = 0.86 + 0.14 * Math.sin((t * Math.PI) / 2);
        lv.push({ y: ty0 + 0.012 + (trayH - 0.024) * t, loop: rrLoop((fw / 2) * s, (-fd / 2) * s, (fd / 2) * s, 0.09 * s, 0.09 * s, { nx: 10, nArc: 6, nSide: 6 }) });
      }
      addFrame(fs, loftGeometry(lv, { top: 0.012, bottom: 0.012 }));
      const top = new THREE.Group();
      top.position.set(0, yc0 + 0.01, 0);
      top.rotation.x = 5 * DEG;
      fs.add(top);
      addUp(top, softBox(fw - 0.03, cT - 0.01, fd - 0.03, 'y', { puff: 0.12, round: 0.8, sides: 0.2, bottom: 0.1, q, seg: segFor(fw, fd) }), { position: [0, (cT - 0.01) / 2, 0] });
      yc0 = ty0;
    } else if (body === 'box' && st.sides === 'shell') {
      // smooth fabric body, sheepskin top
      const bH = cT * 0.55, tH = cT - bH + 0.04;
      addFrame(fs, softBox(fw, bH, fd, 'y', { puff: 0.03, round: 0.5, sides: 0.1, q }), { position: [0, yc0 + bH / 2, 0] });
      addUp(fs, softBox(fw + 0.012, tH, fd + 0.012, 'y', { puff: 0.12, round: 0.9, sides: 0.25, bottom: 0.2, q, seg: segFor(fw, fd) }), { position: [0, fh - tH / 2, 0] });
    } else {
      // upholstered block with a transverse seam across the top (Chicago, Bern): profile lofted along x
      const zg = -fd / 2 + fd * 0.3;
      const nxS = 2 * Math.max(6, Math.round(fd / (step * 1.1)));
      const rS = Math.min(0.05, fw * 0.1);
      const levels = levelsY(-fw / 2 + rS, fw / 2 - rS, [], step * 2).map((x) => {
        const ex = 1 - Math.pow(Math.abs(x) / (fw / 2), 6);
        const front = (zz) => ex * (0.012 * (1 - Math.pow(Math.min(1, Math.abs(zz) / (fd / 2)), 4)) * dip(zz, zg) - 0.0035 * groove(zz, zg));
        return { y: x, loop: rrLoop(fd / 2, yc0, fh - 0.012, Math.max(rS * 1.02, Math.min(0.06, cT * 0.4)), rS * 1.02, { nx: nxS, nArc: 5, nSide: 3, front }) };
      });
      addUp(fs, loftGeometry(levels, { top: rS, bottom: rS, nEdge: 4, nCap: 3, matrix: PROFILE_X }));
    }
    if (body === 'classic') ringBase(fs, ms, { rx: fw * 0.4, rz: fd * 0.42, topY: yc0 - 0.004, q });
    else starBase(fs, ms, { r: clamp(Math.min(fw, fd) * 0.62, 0.17, 0.3), topY: yc0 - 0.004, q, arms: 4, slim: st.slim, plate: 0.14 });
    colliders.push({ min: [-fw / 2, 0, fz - fd / 2], max: [fw / 2, fh, fz + fd / 2] });
  }

  if (pile) {
    let s = 3;
    for (const m of fuzzy) fluff(m.geometry, pile * 0.85, s++);
  }
  // recolouring in place; a switch to / from teddy (sheepskin geometry) rebuilds
  const recolor = (part, hex, kind) => {
    const meshes = g.userData.model?.parts?.[part];
    if (!meshes?.length) return true;
    for (const mm of meshes) if (!mm.material?.userData?.cached) return false;
    if (part === 'upholstery' && kind && P.pile == null && (kind === 'teddy') !== (upKind === 'teddy')) return false;
    for (const mm of meshes) {
      const ud = mm.material.userData;
      mm.material = mat(kind || ud.kind, hex || ud.hex, ud.opts);
    }
    return true;
  };
  return K.finishModel(g, { seatY: seatH, colliders, recolor });
}

// ---------------------------------------------------------------------------------------------------------------
// Lounge chair on a wooden frame, and the rocking chair

/** Wooden member (rounded box) between two points, grain along its length. */
function addBeam(g, material, part, a, b, tw, th, r = 0.004) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  if (len < 0.005) return;
  const geo = K.roundedBox(tw, len, th, Math.min(r, tw / 2.2, th / 2.2), 1, { grain: 'y' });
  const m = K.partMesh(geo, material, part, { position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
  m.quaternion.setFromUnitVectors(_UP, dir.normalize());
  g.add(m);
}

function buildLoungeWood(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const ms = materials(spec, 'wood-taper');
  const g = new THREE.Group();
  const frame = ms.frame();
  const legsM = ms.legs({ grain: 'v' });
  const seatH = clamp(num(P.seatH, 0.43), 0.3, h - 0.2);
  const armH = clamp(num(P.armH, 0.6), seatH + 0.08, h);
  const armW = clamp(num(P.armW, 0.06), 0.03, w * 0.25);
  const loose = P.cushion === 'loose';
  const wrapped = armW >= 0.1 && P.backShape !== 'square';
  const railT = 0.035;
  const railTop = clamp(num(P.legH, 0.22) + railT, 0.16, seatH - (loose ? 0.12 : 0.06));
  const zr = -d / 2, zf = d / 2;
  const legR = 0.02;
  if (wrapped) {
    // wooden base: four splayed legs + rails, upholstered seat block, thick wrap-around back acting as arms
    const ax = w / 2 - 0.09, az = d / 2 - 0.09;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addLeg(g, legsM, 'legs', [sx * ax, railTop - railT / 2, sz * az], [sx * (ax + 0.03), 0, sz * (az + 0.035)], legR, legR * 0.65, { seg: Math.max(8, Math.round(12 * q)) });
    for (const sz of [-1, 1]) addBeam(g, frame, 'frame', [-ax - 0.02, railTop - railT / 2, sz * az], [ax + 0.02, railTop - railT / 2, sz * az], 0.022, railT);
    for (const sx of [-1, 1]) addBeam(g, frame, 'frame', [sx * ax, railTop - railT / 2, -az - 0.02], [sx * ax, railTop - railT / 2, az + 0.02], 0.022, railT);
    const bodyTop = seatH - 0.08;
    const seatOut = rrOutline(-w / 2 + 0.03, w / 2 - 0.03, zr + 0.03, zf - 0.01, 0.18, 0.08, 6, 4);
    g.add(K.partMesh(slabGeometry(seatOut, { y0: railTop, y1: bodyTop + 0.01, rTop: 0.02, rBot: 0.01 }), ms.up, 'upholstery'));
    const sOut = rrOutline(-w / 2 + armW * 0.9, w / 2 - armW * 0.9, zr + armW * 0.8, zf - 0.01, 0.1, 0.07, 6, 4, (x) => 0.01 * (1 - (x / (w / 2)) ** 2));
    g.add(K.partMesh(slabGeometry(sOut, { y0: bodyTop, y1: seatH, rTop: 0.03, rBot: 0.015, dome: 0.01, belly: 0.004 }), ms.up, 'upholstery'));
    const rx = w / 2 - armW / 2 - 0.01;
    const rz = Math.min(d * 0.55, rx);
    g.add(K.partMesh(wrapBand({ rx, rz, zc: zr + armW / 2 + rz + 0.01, wrap: 196 * DEG, T: armW, Tend: armW * 0.9, y0: bodyTop - 0.03, backH: h, endH: armH, endFrom: 0.4, recline: 6, q }), ms.up, 'upholstery'));
  } else {
    // open wooden frame: front legs up to the arms, back legs rising as reclined back posts, wooden arm rests
    const rec = 14 * DEG;
    const fx = w / 2 - armW / 2 - 0.005;
    const fz = zf - 0.05, bz = zr + 0.07;
    const postTop = h - 0.02;
    const bTopZ = bz - (postTop - railTop) * Math.tan(rec) * 0.5;
    for (const sx of [-1, 1]) {
      const x = sx * fx;
      // front leg (slight splay) up to the arm rest
      addLeg(g, legsM, 'legs', [x, armH - 0.02, fz], [x + sx * 0.012, 0, fz + 0.025], legR * 1.05, legR * 0.7, { seg: Math.max(8, Math.round(12 * q)) });
      // back leg + back post
      addLeg(g, legsM, 'legs', [x, railTop, bz + 0.01], [x + sx * 0.012, 0, bz - 0.03], legR, legR * 0.7, { seg: Math.max(8, Math.round(12 * q)) });
      addBeam(g, frame, 'frame', [x, railTop - 0.01, bz + 0.01], [x, postTop, bTopZ], 0.032, 0.03);
      // side rail and arm rest
      addBeam(g, frame, 'frame', [x, railTop - railT / 2, bz], [x, railTop - railT / 2, fz], 0.024, railT);
      const arm = K.roundedBox(armW + 0.01, 0.026, (fz + 0.04) - (bz + 0.02), 0.008, 2, { grain: 'z' });
      g.add(K.partMesh(arm, frame, 'frame', { position: [x, armH, (fz + 0.04 + bz + 0.02) / 2 + 0.005] }));
    }
    for (const z of [bz, fz]) addBeam(g, frame, 'frame', [-fx, railTop - railT / 2, z], [fx, railTop - railT / 2, z], 0.024, railT);
    // top back rail
    addBeam(g, frame, 'frame', [-fx, postTop - 0.03, bTopZ + 0.004], [fx, postTop - 0.03, bTopZ + 0.004], 0.03, 0.026);
    const iw = 2 * fx - 0.04;
    // seat cushion on the rails
    const sTop = seatH;
    const st = sTop - railTop + 0.005;
    const sd = fz - bz - 0.02;
    const sc = [0, railTop - 0.005 + st / 2, (fz + bz) / 2 + 0.02];
    addCushion(g, ms, softBox(iw, st, sd, 'y', { puff: loose ? 0.14 : 0.08, round: 0.6, sides: 0.2, bottom: 0.1, q }), sc, loose && P.piping !== false ? ['top'] : null, q);
    // back cushion / curved back panel
    const ct = loose ? 0.12 : 0.06;
    const bh = Math.min(h - seatH - 0.02, (postTop - seatH) + 0.06);
    const grp = new THREE.Group();
    grp.position.set(0, seatH - 0.02, bz + 0.03 + ct / 2);
    grp.rotation.x = -rec;
    g.add(grp);
    grp.add(K.partMesh(softBox(iw - 0.01, bh, ct, 'z', { puff: loose ? 0.16 : 0.1, round: 0.7, sides: 0.2, bottom: 0.4, q }), ms.up, 'upholstery', { position: [0, bh / 2, 0] }));
  }
  return K.finishModel(g, { seatY: seatH });
}

function buildRocking(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const ms = materials(spec, 'wood-taper');
  const g = new THREE.Group();
  const frame = ms.frame();
  const legsM = ms.legs({ grain: 'v' });
  const seatH = clamp(num(P.seatH, 0.42), 0.3, h - 0.25);
  const armH = clamp(num(P.armH, seatH + 0.2), seatH + 0.1, h - 0.1);
  const zr = -d / 2, zf = d / 2;
  const rx = w / 2 - 0.035;
  // bentwood runners: an arc touching the floor at z ≈ 0
  const Rr = clamp(d * 1.5, 0.9, 2.2);
  const half = Math.asin(clamp((d / 2) / Rr, 0, 0.95));
  const runner = new THREE.Shape();
  const n = 24;
  const outer = [], innerA = [];
  for (let i = 0; i <= n; i++) {
    const a = -half + (2 * half * i) / n;
    outer.push(new THREE.Vector2(Rr * Math.sin(a), Rr - Rr * Math.cos(a)));
    innerA.push(new THREE.Vector2((Rr - 0.04) * Math.sin(a), Rr - (Rr - 0.04) * Math.cos(a)));
  }
  runner.setFromPoints([...outer, ...innerA.reverse()]);
  const yAt = (z) => Rr - Math.sqrt(Math.max(0, Rr * Rr - z * z));
  for (const sx of [-1, 1]) {
    const geo = K.extrudeShape(runner, 0.03, { bevel: 0.008, bevelSegments: 2, curveSegments: 4, center: true });
    geo.rotateY(Math.PI / 2);
    K.worldUV(geo, 1, { grain: 'z' });
    g.add(K.partMesh(geo, frame, 'frame', { position: [sx * rx, 0, 0] }));
  }
  const railTop = seatH - 0.08;
  const rec = 16 * DEG;
  const postTop = h - 0.02;
  const fz = zf - 0.12, bz = zr + 0.02 + (postTop - railTop) * Math.tan(rec);
  const bTopZ = bz - (postTop - railTop) * Math.tan(rec);
  for (const sx of [-1, 1]) {
    const x = sx * rx;
    addLeg(g, legsM, 'legs', [x, armH - 0.02, fz], [x, yAt(fz) + 0.03, fz + 0.01], 0.019, 0.016, { seg: Math.max(8, Math.round(12 * q)) });
    addLeg(g, legsM, 'legs', [x, railTop, bz], [x, yAt(bz) + 0.03, bz - 0.01], 0.019, 0.016, { seg: Math.max(8, Math.round(12 * q)) });
    addBeam(g, frame, 'frame', [x, railTop - 0.02, bz], [x, postTop, bTopZ], 0.03, 0.028);
    addBeam(g, frame, 'frame', [x, railTop - 0.02, bz], [x, railTop - 0.02, fz], 0.024, 0.04);
    g.add(K.partMesh(K.roundedBox(0.055, 0.024, fz - bz + 0.08, 0.008, 2, { grain: 'z' }), frame, 'frame', { position: [x, armH, (fz + bz) / 2 + 0.02] }));
  }
  for (const z of [bz, fz]) addBeam(g, frame, 'frame', [-rx, railTop - 0.02, z], [rx, railTop - 0.02, z], 0.024, 0.04);
  addBeam(g, frame, 'frame', [-rx, postTop - 0.03, bTopZ + 0.005], [rx, postTop - 0.03, bTopZ + 0.005], 0.03, 0.026);
  const iw = 2 * rx - 0.05;
  const st = seatH - railTop + 0.01;
  const sd = fz - bz + 0.04;
  g.add(K.partMesh(softBox(iw, st, sd, 'y', { puff: 0.14, round: 0.6, sides: 0.2, bottom: 0.1, q }), ms.up, 'upholstery', { position: [0, railTop + st / 2 - 0.01, (fz + bz) / 2 + 0.03] }));
  const bh = postTop - seatH - 0.04;
  const grp = new THREE.Group();
  grp.position.set(0, seatH - 0.01, bz + 0.07);
  grp.rotation.x = -rec;
  g.add(grp);
  grp.add(K.partMesh(softBox(iw - 0.01, bh, 0.1, 'z', { puff: 0.15, round: 0.7, sides: 0.2, bottom: 0.4, q }), ms.up, 'upholstery', { position: [0, bh / 2, 0] }));
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Definitions (ARCHITECTURE §5)

const LEG_LABELS = {
  drum: 'Trommelfot (polstret)',
  'swivel-disc': 'Dreiefot med rund plate',
  'swivel-star': 'Dreiefot med kryss',
  'wood-taper': 'Skrå treben',
  'slim-metal': 'Tynne metallben',
  block: 'Lave klosser',
  none: 'Skjørt (ingen synlige ben)',
  plinth: 'Sokkel',
};
const legParam = (keys) => ({ type: 'enum', label: 'Understell', options: keys.map((k) => [k, LEG_LABELS[k]]) });
const SEAT = { type: 'number', min: 0.3, max: 0.8, step: 0.01, label: 'Setehøyde (m)' };
const ARMH = { type: 'number', min: 0.4, max: 0.85, step: 0.01, label: 'Armlenehøyde (m)' };
const ARMW = { type: 'number', min: 0, max: 0.35, step: 0.01, label: 'Armlenebredde (m)' };
const LEGH = { type: 'number', min: 0, max: 0.4, step: 0.01, label: 'Benhøyde (m)' };
const CUSHION = { type: 'enum', label: 'Puter', options: [['tight', 'Faste'], ['loose', 'Løse']] };
const FOOT = { type: 'bool', label: 'Fotskammel' };
const PIPE = { type: 'bool', label: 'Kantbånd' };

/** Def from the shared schema (label, mount, parts, partLabels) + defaults, params schema and builder. */
function def(id, defaults, build, { params = {}, dimsRange, parts } = {}) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const list = parts || a.parts || fam.parts;
  const d = defaults.dims;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...list],
    partLabels: Object.fromEntries(list.map((p) => [p, fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange: dimsRange || {
      w: [+(d.w * 0.7).toFixed(2), +(d.w * 1.5).toFixed(2)],
      d: [+(d.d * 0.7).toFixed(2), +(d.d * 1.5).toFixed(2)],
      h: [+(d.h * 0.75).toFixed(2), +(d.h * 1.3).toFixed(2)],
    },
    build,
  };
}

const fabric = (hex, kind = 'boucle', legs = hex, legKind = kind) => ({
  colors: { upholstery: hex, legs },
  materials: { upholstery: kind, legs: legKind },
});

export const archetypes = {
  'tub-swivel': def('tub-swivel', { dims: { w: 0.75, d: 0.75, h: 0.76 }, params: { seatH: 0.45, legStyle: 'drum', baseD: 0.64, baseH: 0.3, backWrapDeg: 200, shellT: 0.1, armH: 0.62, cushion: 'tight', piping: true }, ...fabric('#b3aea6') }, buildTub, {
    params: {
      seatH: SEAT,
      legStyle: legParam(['drum', 'swivel-disc', 'swivel-star', 'wood-taper', 'none']),
      backWrapDeg: { type: 'number', min: 140, max: 300, step: 5, label: 'Ryggens omfang (°)' },
      shellT: { type: 'number', min: 0.06, max: 0.18, step: 0.01, label: 'Ryggtykkelse (m)' },
      armH: ARMH,
      cushion: CUSHION,
      piping: PIPE,
    },
    dimsRange: { w: [0.6, 1.0], d: [0.6, 1.0], h: [0.62, 0.95] },
  }),
  wingback: def('wingback', { dims: { w: 0.79, d: 0.86, h: 1.0 }, params: { seatH: 0.45, armH: 0.62, armW: 0.1, legStyle: 'wood-taper', legH: 0.24, cushion: 'loose', footstool: false }, ...fabric('#8e9a7e', 'velvet', '#5f4332', 'walnut') }, buildWingback, {
    params: { seatH: SEAT, armH: ARMH, armW: ARMW, legStyle: legParam(['wood-taper', 'swivel-star', 'swivel-disc', 'block']), legH: LEGH, cushion: CUSHION, buttons: { type: 'bool', label: 'Knapper i ryggen' }, footstool: FOOT },
    dimsRange: { w: [0.65, 1.0], d: [0.7, 1.05], h: [0.85, 1.2] },
  }),
  'lounge-wood': def('lounge-wood', { dims: { w: 0.78, d: 0.68, h: 0.71 }, params: { seatH: 0.43, armH: 0.6, armW: 0.06, legH: 0.22, backShape: 'curved', cushion: 'loose' }, colors: { upholstery: '#cbbfae', legs: '#5a4232', frame: '#5a4232' }, materials: { upholstery: 'linen', legs: 'oak', frame: 'oak' } }, buildLoungeWood, {
    params: { seatH: SEAT, armH: ARMH, armW: { ...ARMW, label: 'Armlenebredde (m) – bred = polstret rygg rundt' }, legH: LEGH, cushion: CUSHION },
    dimsRange: { w: [0.6, 1.0], d: [0.6, 1.0], h: [0.62, 1.0] },
  }),
  'club-box': def('club-box', { dims: { w: 0.84, d: 0.89, h: 0.82 }, params: { seatH: 0.44, armW: 0.16, armH: 0.62, legStyle: 'wood-taper', legH: 0.1, backShape: 'square', cushion: 'loose' }, ...fabric('#8b4e2b', 'leather', '#1f1f1f', 'black-metal') }, buildClubBox, {
    params: {
      seatH: SEAT,
      armW: ARMW,
      armH: ARMH,
      legStyle: legParam(['wood-taper', 'block', 'none', 'swivel-disc']),
      legH: LEGH,
      backShape: { type: 'enum', label: 'Rygg', options: [['square', 'Rett'], ['curved', 'Buet (quiltet)'], ['tufted', 'Puffete tufter, uten armlener']] },
      cushion: CUSHION,
    },
    dimsRange: { w: [0.65, 1.1], d: [0.7, 1.15], h: [0.65, 0.95] },
  }),
  // 'auto' = as the product (params.notes / armW / colours, see reclinerStyle); hidden but honoured: sides, backSeams,
  // pile, star, starArms, lever, stoolW/stoolD/stoolH, seatD, armW, legH, headrest, footstool
  recliner: def('recliner', { dims: { w: 0.75, d: 0.71, h: 1.0 }, params: { seatH: 0.42, armH: 0.58, armW: 0.08, legStyle: 'swivel-disc', legH: 0.14, headrest: true, footstool: true, body: 'auto', headStyle: 'auto', footrest: 'auto', footrestOpen: false }, ...fabric('#7b7a77', 'woven', '#1f1f1f', 'black-metal') }, buildRecliner, {
    parts: ['upholstery', 'frame', 'legs'],
    params: {
      seatH: SEAT,
      armH: ARMH,
      body: { type: 'enum', label: 'Utforming', options: [['auto', 'Som produktet'], ['box', 'Polstrede sidevanger'], ['shell', 'Formstøpt skall'], ['tulip', 'Tynne tulipanarmlener'], ['classic', 'Stressless (armputer på braketter, ringfot)']] },
      headStyle: { type: 'enum', label: 'Nakkepute', options: [['auto', 'Som produktet'], ['integrated', 'Innebygd i ryggen'], ['block', 'Egen pute'], ['roll', 'Pølsepute'], ['wing', 'Vingeformet'], ['none', 'Ingen']] },
      footrest: { type: 'enum', label: 'Fotstøtte', options: [['auto', 'Som produktet'], ['stool', 'Egen fotskammel'], ['integrated', 'Innebygd fothviler'], ['none', 'Ingen']] },
      footrestOpen: { type: 'bool', label: 'Fothvileren slått ut' },
      legStyle: legParam(['swivel-disc', 'swivel-star']),
    },
    dimsRange: { w: [0.65, 0.95], d: [0.65, 0.95], h: [0.9, 1.2] },
  }),
  'shell-legs': def('shell-legs', { dims: { w: 0.83, d: 0.81, h: 0.75 }, params: { seatH: 0.42, legStyle: 'wood-taper', legH: 0.16, armH: 0, backShape: 'round' }, ...fabric('#e5ded2', 'boucle', '#c39b6e', 'oak') }, buildShellLegs, {
    params: { seatH: SEAT, armH: { ...ARMH, min: 0, label: 'Armlenehøyde (m) – 0 = uten' }, legStyle: legParam(['wood-taper', 'swivel-star', 'swivel-disc', 'slim-metal']), legH: LEGH },
    dimsRange: { w: [0.6, 1.0], d: [0.6, 1.0], h: [0.6, 1.0] },
  }),
  rocking: def('rocking', { dims: { w: 0.7, d: 0.9, h: 0.95 }, params: { seatH: 0.42, armH: 0.62 }, colors: { upholstery: '#d4c8b2', legs: '#c39b6e', frame: '#c39b6e' }, materials: { upholstery: 'linen', legs: 'oak', frame: 'oak' } }, buildRocking, {
    params: { seatH: SEAT, armH: ARMH },
    dimsRange: { w: [0.55, 0.9], d: [0.7, 1.1], h: [0.8, 1.15] },
  }),
  'dining-chair': def('dining-chair', { dims: { w: 0.52, d: 0.58, h: 0.88 }, params: { seatH: 0.47, shell: 'shell', legStyle: 'slim-metal', legD: 0.02 }, ...fabric('#d2cbc2', 'boucle', '#1a1a1a', 'black-metal') }, buildDiningChair, {
    params: { seatH: { ...SEAT, min: 0.4, max: 0.55 }, legStyle: legParam(['slim-metal', 'wood-taper']) },
    dimsRange: { w: [0.42, 0.65], d: [0.48, 0.68], h: [0.75, 1.0] },
  }),
  'bar-stool': def('bar-stool', { dims: { w: 0.45, d: 0.48, h: 0.97 }, params: { seatH: 0.65, back: 'shell', legStyle: 'slim-metal', footrest: true, quilt: true }, ...fabric('#4a5646', 'velvet', '#1a1a1a', 'black-metal') }, buildBarStool, {
    params: { seatH: { ...SEAT, min: 0.55, max: 0.82, label: 'Setehøyde (m) – 0,65 benk / 0,75 bar' }, footrest: { type: 'bool', label: 'Fotstøtte' }, quilt: { type: 'bool', label: 'Stikninger i ryggen' } },
    dimsRange: { w: [0.38, 0.55], d: [0.4, 0.56], h: [0.8, 1.15] },
  }),
  'sofa-modular-l': def('sofa-modular-l', { dims: { w: 2.95, d: 2.06, h: 0.85 }, params: { seatH: 0.45, backT: 0.25, depth: 0.92, armW: 0.27, armH: 0.63, armSide: '+x', shortLegSide: '-x', shortLegBackTo: 1.48, base: 'plinth', piping: true }, colors: { upholstery: '#707173', legs: '#707173', piping: '#55514c' }, materials: { upholstery: 'woven', legs: 'woven', piping: 'woven' } }, buildSofaL, {
    parts: ['upholstery', 'piping', 'legs'],
    params: {
      seatH: SEAT,
      depth: { type: 'number', min: 0.7, max: 1.1, step: 0.01, label: 'Setedybde (m)' },
      armH: ARMH,
      shortLegSide: { type: 'enum', label: 'Sjeselong', options: [['-x', 'Venstre (sett forfra)'], ['+x', 'Høyre (sett forfra)']] },
      layout: { type: 'enum', label: 'Utforming', options: [['corner', 'Hjørnesofa (rygg rundt)'], ['chaise', 'Åpen sjeselong']], default: 'corner' },
      armStyle: { type: 'enum', label: 'Armlener', options: [['box', 'Kantete'], ['slim', 'Smale'], ['round', 'Runde'], ['sloped', 'Skrå']], default: 'box' },
      armSide: { type: 'enum', label: 'Armlene', options: [['+x', 'Høyre (sett forfra)'], ['-x', 'Venstre (sett forfra)'], ['both', 'Begge sider'], ['none', 'Ingen']] },
      piping: PIPE,
    },
    dimsRange: { w: [2.0, 3.6], d: [1.4, 2.6], h: [0.7, 0.95] },
  }),
  // dims.h = the top of the high curl (wing end); the back is wingRise lower (params.backH is not used any more)
  'sofa-curved': def('sofa-curved', { dims: { w: 2.1, d: 0.98, h: 0.75 }, params: { seatH: 0.43, backT: 0.22, wingRise: 0.06, wingEnd: '-x', bolsterD: 0.22, bolsterH: 0.58, frontConvex: true, base: 'plinth' }, ...fabric('#b5b1ab', 'boucle') }, buildSofaCurved, {
    params: {
      seatH: SEAT,
      wingRise: { type: 'number', min: 0, max: 0.15, step: 0.01, label: 'Vingeenden høyere enn ryggen (m)' },
      wingEnd: { type: 'enum', label: 'Høy vingeende', options: [['-x', 'Venstre (sett forfra)'], ['+x', 'Høyre (sett forfra)']] },
      bolsterH: { type: 'number', min: 0.5, max: 0.75, step: 0.01, label: 'Armlenehøyde (m)' },
    },
    dimsRange: { w: [1.5, 2.8], d: [0.8, 1.15], h: [0.65, 0.9] },
  }),
  'sofa-straight': def('sofa-straight', { dims: { w: 2.2, d: 0.95, h: 0.8 }, params: { seatH: 0.44, armW: 0.2, legStyle: 'wood-taper', legH: 0.14 }, ...fabric('#7b7a77', 'woven', '#1f1f1f', 'black-metal') }, buildSofaStraight, {
    params: {
      seatH: SEAT,
      armW: ARMW,
      armH: ARMH,
      seats: { type: 'number', min: 1, max: 5, step: 1, label: 'Antall seteputer' },
      armStyle: { type: 'enum', label: 'Armlener', options: [['box', 'Kantete'], ['slim', 'Smale'], ['round', 'Runde'], ['sloped', 'Skrå'], ['none', 'Uten']], default: 'box' },
      backStyle: { type: 'enum', label: 'Rygg', options: [['cushions', 'Løse ryggputer'], ['tight', 'Fast rygg']], default: 'cushions' },
      seatStyle: { type: 'enum', label: 'Sete', options: [['split', 'Én pute per plass'], ['bench', 'Gjennomgående pute']], default: 'split' },
      legStyle: legParam(['wood-taper', 'slim-metal', 'block', 'plinth']),
      legH: LEGH,
      piping: PIPE,
    },
    dimsRange: { w: [1.4, 3.2], d: [0.8, 1.15], h: [0.7, 0.95] },
  }),
};
