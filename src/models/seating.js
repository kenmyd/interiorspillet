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
 *   bar-stool       counter stool with a quilted shell back (or a pad on tube posts, or a straight parsons back) and a
 *                   foot rest frame
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

/** Superellipse plan point at angle a (0 = back centre −z, +90° = +x side): exponent n (2 = ellipse, ≈3.5 = rounded square). */
function superPt(a, rx, rz, n, zc = 0) {
  const s = Math.sin(a), c = Math.cos(a), e = 2 / n;
  return [rx * Math.sign(s) * Math.abs(s) ** e, zc - rz * Math.sign(c) * Math.abs(c) ** e];
}

/** Closed superellipse plan loop, resampled by arc length (count points, the first at the front centre). */
function superLoop(rx, rz, n, zc, count) {
  const N = 360;
  const fine = [];
  for (let i = 0; i <= N; i++) fine.push(superPt(Math.PI + (2 * Math.PI * i) / N, rx, rz, n, zc));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (cum[N] * k) / count;
    while (seg < N - 1 && cum[seg + 1] < s) seg++;
    const f = clamp((s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1e-9), 0, 1);
    out.push([lerp(fine[seg][0], fine[seg + 1][0], f), lerp(fine[seg][1], fine[seg + 1][1], f)]);
  }
  return out;
}

/**
 * Upholstered band swept along a plan path with a free cross-section (bandGeometry with a section callback):
 * section(u, sm, f, dEnd) returns a closed loop [[a, b], …] – a outward from the path, b up from y0 – with the same
 * point count for every sample; f is the rounded-end factor (1 away from the ends → 0 at the tips, over endLen).
 */
function profileBand(path, { y0 = 0, center = [0, 0], endLen, section, closed = false, capUV = false }) {
  const { L, samples } = path;
  const rows = samples.map((sm) => {
    let nx = sm.tz, nz = -sm.tx;
    if ((sm.x - center[0]) * nx + (sm.z - center[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const dEnd = closed ? Infinity : Math.min(sm.s, L - sm.s);
    const k = dEnd < endLen ? 1 - dEnd / endLen : 0;
    const f = Math.sqrt(Math.max(0, 1 - k * k));
    const Y0 = typeof y0 === 'function' ? y0(sm) : y0;
    return section(sm.s / L, sm, f, dEnd).map(([a, b]) => [sm.x + nx * a, Y0 + b, sm.z + nz * a]);
  });
  const geo = gridGeometry(rows);
  if (!capUV) return geo;
  // capUV: u (round the section) is the arc length up each face from the foot plus the foot's height, folded at the
  // top, and v (along the path) only the horizontal run of each column – so both stay true to the surface even where
  // the section height changes fast along the path (rounded top corners, rounded ends, receding ends), and the
  // fabric is not sheared into streaks there
  const m = rows[0].length, nc = m + 1;
  const uv = geo.attributes.uv;
  const v = new Array(nc).fill(0);
  rows.forEach((row, i) => {
    if (i) {
      // (the foot's own points run along a rising foot too: there the full 3D step)
      const y0 = Math.min(...row.map((p) => p[1]));
      for (let j = 0; j <= m; j++) {
        const a = rows[i - 1][j % m], b = row[j % m];
        v[j] += Math.hypot(b[0] - a[0], b[1] - y0 < 1e-5 ? b[1] - a[1] : 0, b[2] - a[2]);
      }
    }
    for (let j = 0; j <= m; j++) uv.setY(i * nc + j, v[j]);
    let jt = 0, yMin = Infinity;
    for (let j = 0; j < m; j++) {
      if (row[j][1] > row[jt][1]) jt = j;
      yMin = Math.min(yMin, row[j][1]);
    }
    const s = [0];
    for (let j = 1; j <= m; j++) {
      const a = row[(j - 1) % m], b = row[j % m];
      s.push(s[j - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const S = s[m], c = (s[jt] - (S - s[jt])) / 2;
    for (let j = 0; j <= m; j++) uv.setX(i * nc + j, (j <= jt ? s[j] - c : S - s[j] + c) + yMin);
  });
  uv.needsUpdate = true;
  return geo;
}

/**
 * Section of a shell wall: thickness 2·hw, fully rounded top at Ht, centre line offset off(b) (flare / tuck-under);
 * `bulge` pushes the outer face out in the middle of its height.
 */
function wallSection(hw, Ht, off, { nW = 7, nc = 4, ns = 2, bulge = 0, sq = 1 } = {}) {
  hw = Math.max(1e-4, hw);
  const Hc = Math.max(0.002, Ht - hw);
  const pts = [];
  for (let j = 0; j < ns; j++) pts.push([off(0) + hw * (2 * j / ns - 1), 0]);
  for (let j = 0; j < nW; j++) {
    const b = Hc * (j / nW) ** 1.4;
    pts.push([off(b) + hw + bulge * Math.sin((Math.PI * b) / Hc) * Math.min(1, hw * 20), b]);
  }
  const c = off(Hc);
  // top: a semicircle (sq = 1) or, sq < 1, a squarer superellipse cap (a flat-topped slab with rounded edges)
  for (let j = 0; j <= 2 * nc; j++) {
    const t = (Math.PI * j) / (2 * nc);
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push(sq === 1 ? [c + hw * ct, Hc + hw * st] : [c + hw * Math.sign(ct) * Math.abs(ct) ** sq, Hc + hw * Math.abs(st) ** sq]);
  }
  for (let j = nW - 1; j >= 1; j--) {
    const b = Hc * (j / nW) ** 1.4;
    pts.push([off(b) - hw, b]);
  }
  return pts;
}

/** Quarter-round tuck: how far a wall is pulled in at height b above its foot (radius r). */
const tuckIn = (b, r) => (b < r ? r - Math.sqrt(Math.max(0, r * r - (r - b) ** 2)) : 0);

/**
 * Welt round a plan loop at height y, inset along the loop normals: closed, or (keep(p) given, the loop starting at
 * the front centre) only the front run of points that keep accepts.
 */
function loopWelt(loop, y, inset, r, q, keep) {
  let cx = 0, cz = 0;
  for (const p of loop) {
    cx += p[0];
    cz += p[1];
  }
  cx /= loop.length;
  cz /= loop.length;
  const { N } = curveFrames(loop, [cx, cz], true);
  let pts = loop.map((p, j) => new THREE.Vector3(p[0] - N[j][0] * inset, y, p[1] - N[j][1] * inset));
  if (keep) {
    const n = pts.length;
    let k1 = 0, k2 = n;
    while (k1 < n - 1 && keep(loop[k1 + 1])) k1++;
    while (k2 > k1 + 1 && keep(loop[k2 - 1])) k2--;
    pts = [...pts.slice(k2), ...pts.slice(0, k1 + 1)];
    if (pts.length < 3) return null;
  }
  return seamTube(pts, r, { closed: !keep, radial: q < 1 ? 3 : 4, seg: Math.max(keep ? 16 : 48, Math.round(pts.length * 2 * q)) });
}

/**
 * Bucket tub (params.shellToFloor): one upholstered shell from the swivel plate to the top, flaring toward the top and
 * tucked under at the foot, round or rounded-square in plan (planN), with near-full-height ends that turn down in a
 * rounded corner (endR) into a vertical front edge; a seat block (drum) inside it, narrower (drumR) and domed with a
 * welt, or (cushion 'pillow') a flush seat cushion and one loose back pillow standing above the shell (shellH < h).
 */
function buildTubBucket(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'swivel-disc';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const Rx = w / 2, Rz = d / 2, R = Math.min(Rx, Rz);
  const n = clamp(num(P.planN, 2), 1.6, 6);
  const pillow = P.cushion === 'pillow';
  const seatH = clamp(num(P.seatH, 0.44), 0.3, h - 0.2);
  const T = clamp(num(P.shellT, 0.09), 0.05, R * 0.4);
  const hw = T / 2;
  const shellH = clamp(num(P.shellH, h), seatH + 0.15, h);
  const armH = clamp(num(P.armH, shellH), seatH + 0.08, shellH);
  const yb = clamp(num(P.legH, 0.02), 0.005, 0.12);
  const wrap = clamp(num(P.backWrapDeg, 195), 120, 320) * DEG;
  const off = num(P.wrapOffsetDeg, 0) * DEG;
  const a0 = -wrap / 2 + off, a1 = wrap / 2 + off;
  const k = num(P.flare, 0.05); // the shell leans outward by this much per metre of height
  const rB = clamp(num(P.bottomR, 0.06), 0.005, 0.15);
  const rc = clamp(num(P.endR, 0.07), hw, 0.2);
  const slopeFrom = clamp(num(P.armSlopeFrom, 0.3), 0, 0.95);
  const yRef = shellH - hw - yb; // the path is the shell's centre line at this height (relative to yb)
  const cline = (b) => -k * (yRef - b) - tuckIn(b, rB);
  // shell
  const px = Rx - hw, pz = Rz - hw;
  const path = samplePath((t) => superPt(lerp(a0, a1, t), px, pz, n), Math.round(56 * q), [rc, rc], 6);
  const topAt = (sm, dEnd) => {
    const a = lerp(a0, a1, sm.t);
    const frac = a < 0 ? a / a0 : a / a1;
    return shellH - (shellH - armH) * sstep(slopeFrom, 1, frac) - tuckIn(dEnd, rc);
  };
  // bulge: the outer face swells out by this much at mid-height (a soft bucket rather than a straight wall)
  const secOpts = { nW: q < 1 ? 5 : 7, nc: q < 1 ? 3 : 4, bulge: clamp(num(P.bulge, 0), 0, 0.05) };
  // endLean (m, or [start, end]): the shell's vertical end edges lean back below the seat – the foot of the end
  // recedes this far along the path from just under the seat (beside the drum) down to the floor
  const eL = Array.isArray(P.endLean) ? P.endLean.map((v) => num(v, 0)) : [num(P.endLean, 0), num(P.endLean, 0)];
  const leanTop = seatH - 0.06 - yb;
  const lift = (sm) => {
    const atStart = sm.s < path.L / 2, e = atStart ? eL[0] : eL[1], dEnd = atStart ? sm.s : path.L - sm.s;
    return e > 0 && dEnd < e ? leanTop * (1 - dEnd / e) : 0;
  };
  g.add(K.partMesh(profileBand(path, {
    y0: (sm) => yb + lift(sm),
    endLen: hw,
    capUV: true,
    section: (u, sm, f, dEnd) => {
      const lf = lift(sm);
      return wallSection(hw * f, topAt(sm, dEnd) - yb - lf, lf ? (b) => cline(b + lf) : cline, secOpts);
    },
  }), ms.up, 'upholstery'));
  if (P.piping !== false && P.shellPiping !== false) {
    // the welt along the shell's top edge (shellPiping false: only the seat block is welted)
    const wr = 0.0042;
    const pts = [];
    for (const sm of path.samples) {
      const dEnd = Math.min(sm.s, path.L - sm.s);
      if (dEnd < hw * 1.1) continue;
      const Hc = topAt(sm, dEnd) - yb - hw;
      let nx = sm.tz, nz = -sm.tx;
      if (sm.x * nx + sm.z * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const a = cline(Hc) + (hw + wr * 0.3) * Math.SQRT1_2, b = Hc + (hw + wr * 0.3) * Math.SQRT1_2;
      pts.push(new THREE.Vector3(sm.x + nx * a, yb + b, sm.z + nz * a));
    }
    if (pts.length > 2) g.add(K.partMesh(seamTube(pts, wr, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
  }
  // seat block (drum): kept inside the shell's outer face at every height (the shell flares and tucks under)
  const dR = clamp(num(P.drumR, 0.9), 0.6, 0.99);
  const rdx = Rx * dR, rdz = Rz * dR;
  const zd = num(P.drumZ, (Rz - rdz) * 0.8);
  const taper = clamp(num(P.drumTaper, 0.94), 0.7, 1);
  // pillow mode: the seat is the block's own flat, welted top (flush with the front), not a domed drum top
  const dome = pillow ? 0.01 : 0.02;
  const blockTop = seatH - dome;
  const rTd = pillow ? 0.03 : 0.045;
  const rBd = clamp(num(P.drumBottomR, 0.06), 0.01, 0.12);
  const nLoop = Math.max(32, Math.round(64 * q));
  const levels = [];
  const nLev = 5;
  for (let i = 0; i <= nLev; i++) {
    const y = lerp(yb + rBd, blockTop - rTd, i / nLev);
    const b = y - yb;
    const shellOut = Rx + cline(b) - 0.008;
    const s = Math.min(lerp(taper, 1, sstep(0, 1, i / nLev)), shellOut / rdx);
    levels.push({ y, loop: superLoop(rdx * s, rdz * s, n, zd, nLoop) });
  }
  g.add(K.partMesh(loftGeometry(levels, { top: rTd, bottom: rBd, nEdge: 3, nCap: 4, dome }), ms.up, 'upholstery'));
  const topLoop = levels[nLev].loop;
  if (P.piping !== false) {
    // a block flush with the shell: the welt only in front of the shell's ends (it would show through the sides)
    const keep = dR > 0.95 ? (p) => {
      const a = Math.atan2(p[0], -p[1]);
      return a > a1 - 4 * DEG || a < a0 + 4 * DEG;
    } : null;
    const welt = loopWelt(topLoop, blockTop - rTd + rTd * Math.SQRT1_2 + 0.002, rTd * (1 - Math.SQRT1_2) - 0.002, 0.0045, q, keep);
    if (welt) g.add(K.partMesh(welt, ms.pipe, ms.pipePart));
  }
  if (pillow) {
    // one loose back pillow leaning on the shell, standing above it: pillowSink = how far its foot sits below the
    // seat (in the seat–back gap), pillowH its height (default: up to dims.h), pillowRound its edge rounding (a
    // fraction of its thickness: 0.75 a puffy bolster, ≈0.3–0.5 a square scatter cushion), pillowPiping a welt
    // round its knife edge
    const pw = clamp(num(P.pillowW, w * 0.72), 0.3, w - 2 * T), pd = clamp(num(P.pillowD, 0.16), 0.08, 0.25);
    const tilt = num(P.pillowTilt, 14) * DEG;
    const sink = clamp(num(P.pillowSink, 0.01), 0, 0.15);
    const ph = clamp(num(P.pillowH, (h - seatH + sink) / Math.cos(tilt)), 0.2, 0.8);
    const yc = seatH - sink + (ph / 2) * Math.cos(tilt);
    const zIn = -(pz + cline(yc - yb) - hw); // the shell's inner face at the back centre
    const zc = zIn + (pd / 2) / Math.cos(tilt) - (ph / 2) * Math.sin(tilt) + 0.01;
    const pg = softBox(pw, ph, pd, 'z', { puff: num(P.pillowPuff, 0.2), round: clamp(num(P.pillowRound, 0.75), 0.1, 1), sides: 0.25, bottom: 0.4, pinch: 0.3, q });
    const at = { position: [0, yc, zc], rotation: [-tilt, 0, 0] };
    g.add(K.partMesh(pg, ms.up, 'upholstery', at));
    if (P.pillowPiping) {
      const E = pg.userData.edges, R = pg.userData.R;
      g.add(K.partMesh(pipeLoop([0, 0, 0], X, Y, (E.x[1] - E.x[0]) / 2 - 0.002, (E.y[1] - E.y[0]) / 2 - 0.002, R, 0.0045, q), ms.pipe, ms.pipePart, at));
    }
  }
  // swivel plate / base under the block
  if (style === 'swivel-disc') swivelDisc(g, ms, clamp(num(P.discR, R * 0.52), 0.12, 0.3), yb, q);
  else if (style === 'swivel-star') swivelStar(g, ms, clamp(R * 0.92, 0.22, 0.36), yb + 0.004, q);
  else addBase(g, ms, style, { hx: rdx * 0.8, hz: rdz * 0.8, topY: yb + 0.01, q, inset: 0 });
  return K.finishModel(g, { seatY: seatH });
}

function buildTub(spec) {
  if (spec.params.shellToFloor) return buildTubBucket(spec);
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

/**
 * Monotone cubic through [[x, v], …] (x ascending, flat at both ends), clamped outside: a smooth profile from a few
 * control points (shell top heights by plan angle, petal half widths by height).
 */
function monoSpline(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  if (n < 2) return () => ys[0] ?? 0;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i] || 1e-9);
    m.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const t = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) continue;
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const hh = dx[i], s = (x - xs[i]) / hh, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * hh * t[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * hh * t[i + 1];
  };
}

/** A [[x, v], …] profile from the params (array of pairs) or the fallback, as a monotone spline. */
const paramProfile = (v, fb) => monoSpline(Array.isArray(v) && v.length > 1 && v.every((p) => Array.isArray(p) && p.length === 2) ? v : fb);

/**
 * Upholstered wall round a superellipse plan arc about (0, zc) – angles a0..a1 (rad, 0 = back centre, +90° = +x) –
 * for the sculpted shell modes: top(aDeg) and foot(aDeg) heights, thickness T, centre-line offset lean(aDeg, b)
 * (outward, b = height above the foot), outer-face bulge, foot tuck-under radius, rounded vertical ends whose top
 * turns down in a radius endR. closed: a full ring (a1 = a0 + 360°, no ends). Returns { geo, path, at }.
 */
function sculptBand({ a0, a1, rx, rz, zc = 0, n = 2, T, top, foot, lean, tuck = 0, bulge = 0, endR = 0.05, closed = false, samples = 56, sq = 1, nW, nc, q }) {
  // plan angle folded to 0..180° (0 = back centre, 180° = front centre), the same on both sides
  const fold = (a) => Math.abs(((((a / DEG + 180) % 360) + 360) % 360) - 180);
  const thick = typeof T === 'function' ? T : () => T; // thickness by folded plan angle
  const nAt = typeof n === 'function' ? n : () => n; // plan exponent, optionally by folded plan angle (squarer front)
  const hwEnd = thick(fold(a1)) / 2;
  const er = Math.max(hwEnd, endR);
  const path = samplePath((t) => {
    const a = lerp(a0, a1, t);
    return superPt(a, rx, rz, nAt(fold(a)), zc);
  }, Math.round(samples * q), closed ? 0 : [er, er], 6);
  const aDeg = (sm) => fold(lerp(a0, a1, sm.t));
  const at = (sm, dEnd) => {
    const A = aDeg(sm);
    const y0 = foot(A);
    const Ht = top(A) - (closed ? 0 : tuckIn(dEnd, er)) - y0;
    return { A, y0, Ht, hw: thick(A) / 2, off: (b) => (lean ? lean(A, b) : 0) - tuckIn(b, tuck) };
  };
  const opts = { nW: nW ?? (q < 1 ? 5 : 7), nc: nc ?? (q < 1 ? 3 : 4), bulge, sq };
  const geo = profileBand(path, {
    y0: (sm) => foot(aDeg(sm)),
    center: [0, zc],
    endLen: hwEnd,
    closed,
    capUV: true,
    section: (u, sm, f, dEnd) => {
      const s = at(sm, dEnd);
      return wallSection(s.hw * f, Math.max(s.hw * f + 0.002, s.Ht), s.off, opts);
    },
  });
  return { geo, path, at };
}

/**
 * Free-form petal back (stacked plan arcs, as chairShell): halfW(y), depth(y) (how far the sides come forward),
 * theta(y) (deg) and zBack(y) are functions of height; rounded top corners of radius rc. Returns { levels, topPts }.
 */
function petalShell({ yb, yt, T, halfW, depth, theta, zBack, rc, nLev, nCurve }) {
  const fn = (t) => {
    const y = lerp(yb, yt, t);
    return { halfW: Math.max(0.02, halfW(y) - cornerCut(y, yt + T / 2, rc)), depth: depth(y), zBack: zBack(y), theta: theta(y) * DEG, T };
  };
  const levels = shellLevels(yb, yt, fn, nLev, nCurve);
  const nC = levels[0].pts.length - 1;
  const topPts = (y) => shellCurve(Math.max(0.02, halfW(yt) - cornerCut(y, yt + T / 2, rc)), depth(yt), zBack(yt), theta(yt) * DEG, nC);
  return { levels, topPts };
}

/** Four splayed legs from the corners (lx, ±lz around z0) with given splay angles (deg). */
function splayLegs(g, ms, { lx, lz0, lz1, topY, rTop, rBot, splayX, splayF, splayB, square = false, q }) {
  const m = ms.legs(square ? undefined : { grain: 'v' });
  const seg = Math.max(6, Math.round(12 * q));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = sz > 0 ? lz1 : lz0;
      const dx = Math.tan(splayX * DEG) * topY * sx, dz = Math.tan((sz > 0 ? splayF : splayB) * DEG) * topY * sz;
      addLeg(g, m, 'legs', [sx * lx, topY, z], [sx * lx + dx, 0, z + dz], rTop, rBot, { seg, square });
    }
  }
}

/**
 * «Little Petra» pillow chair (shell 'pillow'): a puffy pouf seat with a near-semicircular front, a thick pillow back
 * as wide as the seat with a broad level top whose sides fall in a long S into the seat at mid-depth (ears), on four
 * stubby, strongly splayed conical legs. pile > 0 roughens the surfaces (shaggy faux fur).
 */
/**
 * Long-pile fur (shell 'pillow' with pileStyle 'fur'): like fluff, but spikier and finer – clumps ≈ 5 cm broken into
 * ≈ 2 cm tufts that stand out of the silhouette – faded out by weight(x, y, z) (0 = smooth, e.g. where one part
 * runs into another, so the joint does not tear open).
 */
function furPile(geo, amp, seed = 1, weight) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const clump = vnoise3(x * 20, y * 20, z * 20, seed);
    const tuft = 1 - Math.abs(2 * vnoise3(x * 48 + 1.7, y * 48, z * 48, seed + 11) - 1);
    const v = 0.55 * clump + 0.45 * tuft * tuft;
    const dd = amp * (v - 0.42) * (weight ? weight(x, y, z) : 1);
    p.setXYZ(i, x + n.getX(i) * dd, y + n.getY(i) * dd, z + n.getZ(i) * dd);
  }
  p.needsUpdate = true;
  K.smoothNormals(geo);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function buildShellPillow(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'wood-taper';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.415), 0.3, h - 0.15);
  const legH = clamp(num(P.legH, 0.15), 0.04, seatH - 0.14);
  const T = clamp(num(P.shellT, 0.2), 0.08, 0.28), hw = T / 2;
  // pile: fluff amplitude; pileStyle 'fur' = long shaggy pile on a denser mesh (furPile), else the curly fluff
  const fur = P.pileStyle === 'fur';
  const pile = clamp(num(P.pile, 0), 0, fur ? 0.05 : 0.03);
  const dn = fur ? 1.6 : 1; // mesh density factor
  // pouf seat
  const sx = w / 2 - 0.012, z0 = -d / 2 + clamp(num(P.seatBack, 0.12), 0.04, d * 0.4), z1 = d / 2 - 0.004;
  const seatOut = rrOutline(-sx, sx, z0, z1, 0.18, sx, Math.round(9 * dn), Math.round(4 * dn));
  const seat = slabGeometry(seatOut, { y0: legH, y1: seatH - 0.012, rTop: 0.085, rBot: 0.07, dome: 0.014, belly: 0.022, nEdge: Math.round(4 * dn), nCap: Math.round(4 * dn) });
  // pillow back with ears (bandIn: how far the band's outer face stays inside the seat's side, so where the ears
  // run into the seat their faces do not coincide)
  const wrap = clamp(num(P.backWrapDeg, 228), 150, 260) * DEG;
  const rz = clamp(num(P.backRz, 0.26), 0.12, d * 0.6);
  const zc = -d / 2 + hw + rz;
  if (pile && fur) {
    // the seat's fur fades out under the ears (round the seat's top edge, within the band's plan), so the joint
    // between them stays closed
    const rxB = w / 2 - hw - clamp(num(P.bandIn, 0.02), 0, 0.08);
    const underBand = (x, z) => {
      const a = Math.atan2(x, -(z - zc));
      if (Math.abs(a) > wrap / 2 + 0.05) return false;
      const [px, pz] = superPt(a, rxB, rz, clamp(num(P.planN, 2.4), 1.6, 5), zc);
      return Math.hypot(x, z - zc) > Math.hypot(px, pz - zc) - hw - 0.03;
    };
    furPile(seat, pile, 3, (x, y, z) => (underBand(x, z) ? 1 - sstep(seatH - 0.12, seatH - 0.05, y) : 1));
  } else if (pile) fluff(seat, pile, 3);
  g.add(K.partMesh(seat, ms.up, 'upholstery'));
  const top = paramProfile(P.topProfile, [[0, h], [62, h - 0.01], [84, h - 0.07], [99, seatH + 0.13], [108, seatH + 0.03], [114, seatH - 0.03]]);
  const rec = Math.tan(clamp(num(P.recline, 7), 0, 25) * DEG);
  const band = sculptBand({
    a0: -wrap / 2, a1: wrap / 2, rx: w / 2 - hw - clamp(num(P.bandIn, 0.02), 0, 0.08), rz, zc, n: clamp(num(P.planN, 2.4), 1.6, 5), T,
    top, foot: () => legH + 0.035, lean: (A, b) => -rec * Math.max(0, Math.cos(A * DEG)) ** 2 * (h - legH - b),
    tuck: 0.07, bulge: num(P.backBulge, 0.028), endR: 0.12, samples: Math.round(56 * dn), nW: fur ? 20 : undefined, nc: fur ? 6 : undefined, q,
  });
  if (pile && fur) {
    // the fur fades out where the band runs down into the seat (above the seat's outline, near its top)
    const inSeat = (x, z) => Math.abs(x) < sx + 0.02 && z > z0 - 0.01;
    furPile(band.geo, pile, 5, (x, y, z) => (inSeat(x, z) ? sstep(seatH - 0.01, seatH + 0.06, y) : 1));
  } else if (pile) fluff(band.geo, pile, 5);
  g.add(K.partMesh(band.geo, ms.up, 'upholstery'));
  // stubby conical legs, strongly splayed, feet near the seat outline
  const lr = clamp(num(P.legR, 0.028), 0.012, 0.04);
  const inset = clamp(num(P.legInset, 0.17), 0.06, 0.3);
  const sp = num(P.legSplay, 15);
  splayLegs(g, ms, { lx: w / 2 - inset, lz0: -d / 2 + inset, lz1: d / 2 - inset, topY: legH + 0.03, rTop: lr, rBot: lr * 0.68, splayX: sp, splayF: sp - 1, splayB: sp + 3, q });
  return K.finishModel(g, { seatY: seatH });
}

/**
 * High-backed shell (shell 'high'): one wall from the plinth up, highest at the back, falling in a smooth curve along
 * the sides to low round arm fronts (topProfile: [[deg, m], …] by plan angle); a thick round seat cushion with a
 * semicircular front over a thin plinth; four splayed legs from a swivel cross under the middle (legStyle
 * 'wood-taper', square) or the usual bases.
 */
function buildShellHigh(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'wood-taper';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.43), 0.3, h - 0.2);
  const legH = clamp(num(P.legH, 0.24), 0.04, seatH - 0.15);
  const armH = clamp(num(P.armH, seatH + 0.17), seatH + 0.06, h - 0.05);
  const T = clamp(num(P.shellT, 0.09), 0.05, 0.16), hw = T / 2;
  const cushT = clamp(num(P.cushT, 0.12), 0.06, 0.18);
  const foot = legH + 0.012;
  // shell: its lower edge rises toward the arm fronts, so the arm noses float over the cushion's sides
  const wrap = clamp(num(P.backWrapDeg, 250), 160, 290) * DEG;
  const rz = clamp(num(P.backRz, 0.38), 0.15, d * 0.6);
  const zc = -d / 2 + hw + rz;
  const top = paramProfile(P.topProfile, [[0, h], [22, h - 0.02], [48, h - 0.11], [75, armH + 0.08], [100, armH + 0.01], [125, armH]]);
  const footP = paramProfile(P.footProfile, [[0, foot], [78, foot], [wrap / 2 / DEG, seatH - 0.035]]);
  const rec = Math.tan(clamp(num(P.recline, 9), 0, 25) * DEG);
  // above the arms the sides draw in, so the back rises narrower than the arms (pinch metres per metre, eased in)
  const pinch = num(P.backPinch, 0.3);
  const bArm = armH - foot - 0.06;
  const ramp = (x) => (x > 0 ? (x * x) / (x + 0.1) : 0);
  const band = sculptBand({
    a0: -wrap / 2, a1: wrap / 2, rx: w / 2 - hw - 0.004, rz, zc, n: clamp(num(P.planN, 2.2), 1.6, 5), T, top, foot: footP,
    lean: (A, b) => -rec * Math.max(0, Math.cos(A * DEG)) ** 2 * (h - foot - b) - pinch * Math.sin(A * DEG) ** 2 * ramp(b + footP(A) - foot - bArm),
    tuck: 0.03, endR: clamp(num(P.endR, 0.1), hw, 0.15), q,
  });
  g.add(K.partMesh(band.geo, ms.up, 'upholstery'));
  if (P.buttons !== false) {
    // two covered buttons in the back's inner face, about a third down
    const by = lerp(seatH, h, 0.66);
    const zb = -d / 2 + T + rec * (h - foot - (by - foot)) + 0.002;
    const bg = K.sphere(0.012, { wSeg: 10, hSeg: 6 });
    bg.scale(1, 1, 0.45);
    for (const sx of [-1, 1]) g.add(K.partMesh(sx > 0 ? bg : bg.clone(), ms.up, 'upholstery', { position: [sx * 0.055, by, zb] }));
  }
  // seat cushion (semicircular front) over a thin plinth
  const sx = w / 2 - T - 0.004;
  const zs0 = -d / 2 + T + 0.02, zs1 = d / 2 - 0.006;
  const nO = Math.max(32, Math.round(56 * q));
  const cushOut = superLoop(sx, (zs1 - zs0) / 2, 2.2, (zs0 + zs1) / 2, nO);
  g.add(K.partMesh(slabGeometry(cushOut, { y0: seatH - cushT, y1: seatH - 0.008, rTop: 0.05, rBot: 0.035, dome: 0.008, belly: 0.012, nEdge: 3 }), ms.up, 'upholstery'));
  const plOut = superLoop(sx - 0.025, (zs1 - zs0) / 2 - 0.03, 2.2, (zs0 + zs1) / 2 - 0.01, nO);
  g.add(K.partMesh(slabGeometry(plOut, { y0: foot, y1: seatH - cushT + 0.004, rTop: 0.012, rBot: 0.02, belly: 0.003 }), ms.up, 'upholstery'));
  // base: four splayed square legs on the diagonals, their tops near the plinth's edge (a swivel cross inside)
  const zm = (zs0 + zs1) / 2 - 0.02;
  if (style === 'wood-taper') {
    const m = ms.legs({ grain: 'v' });
    const r0 = clamp(num(P.legSpread, 0.17), 0.04, 0.3), r1 = clamp(num(P.footSpread, 0.37), 0.15, 0.5);
    const lw = clamp(num(P.legW, 0.018), 0.012, 0.03);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const c = Math.cos(a), s = Math.sin(a);
      addLeg(g, m, 'legs', [c * r0, foot - 0.004, zm + s * r0], [c * r1, 0, zm + s * r1], lw, lw * 0.8, { square: true, seg: 4 });
    }
    g.add(K.partMesh(K.cylinder(0.1, 0.1, 0.012, { seg: Math.max(12, Math.round(24 * q)) }), mat('black-metal', '#1b1b1b'), null, { position: [0, foot - 0.012, zm] }));
  } else addBase(g, ms, style, { hx: sx - 0.06, hz: (zs1 - zs0) / 2 - 0.06, topY: foot, q, z: zm, inset: 0.04 });
  return K.finishModel(g, { seatY: seatH });
}

/**
 * One closed upholstered skin for a scoop seat (shell 'swan', seat 'skin'): round a superellipse plan (rx, rz about
 * z = zc, exponent n; egg > 0 widens it toward the front) a thin wall – foot(A) to top(A) by folded plan angle A,
 * thickness T(A), outward lean(A, b), tuck-under radius tuck – whose rounded top edge turns into the dished seat
 * (falling to seatY at z = sz, exponent dp) and whose foot turns into the hull underside running in to the column top
 * (hullY at z = hz, exponent hp). The thin edge reads as one shell, the seat as an open scoop.
 */
function scoopShell({ rx, rz, zc, n = 2.2, egg = 0, top, foot, T, lean, tuck = 0.03, seatY, sz, dp = 2, hullY, hz, hp = 1.6, q }) {
  const fold = (a) => Math.abs(((((a / DEG + 180) % 360) + 360) % 360) - 180);
  const plan = (a) => {
    const p = superPt(a, rx, rz, n, zc);
    return [p[0] * (1 + egg * clamp((p[1] - zc) / rz, -1, 1)), p[1]];
  };
  const nA = Math.max(40, Math.round(72 * q));
  const nH = q < 1 ? 5 : 7, nW = q < 1 ? 4 : 6, nc = q < 1 ? 3 : 4, nD = q < 1 ? 6 : 9;
  const sections = [];
  for (let i = 0; i < nA; i++) {
    const a = (2 * Math.PI * i) / nA, A = fold(a);
    const p = plan(a), p1 = plan(a + 1e-3);
    let nx = p1[1] - p[1], nz = -(p1[0] - p[0]);
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    if (p[0] * nx + (p[1] - zc) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const hw = T(A) / 2, y0 = foot(A), Hc = Math.max(0.002, top(A) - y0 - hw);
    const off = (b) => lean(A, b) - tuckIn(b, tuck);
    const at = (o, y) => [p[0] + nx * o, y, p[1] + nz * o];
    const sec = [];
    const F = at(off(0) + hw, y0);
    for (let k = 0; k < nH; k++) {
      const r = k / nH;
      sec.push([F[0] * r, hullY + (y0 - hullY) * r ** hp, lerp(hz, F[2], r)]);
    }
    for (let j = 0; j < nW; j++) {
      const b = Hc * (j / nW) ** 1.4;
      sec.push(at(off(b) + hw, y0 + b));
    }
    for (let j = 0; j <= 2 * nc; j++) {
      const t = (Math.PI * j) / (2 * nc);
      sec.push(at(off(Hc) + hw * Math.cos(t), y0 + Hc + hw * Math.sin(t)));
    }
    const I = sec[sec.length - 1];
    for (let k = 1; k <= nD; k++) {
      const r = 1 - k / nD;
      sec.push([I[0] * r, seatY + (I[1] - seatY) * r ** dp, lerp(sz, I[2], r)]);
    }
    sections.push(sec);
  }
  const rows = sections[0].map((_, k) => sections.map((s) => s[k]));
  const w0 = nH, c1 = nH + nW + 2 * nc;
  return stripsGeometry([{ rows: rows.slice(0, w0 + 1), uv: 'bottom' }, { rows: rows.slice(w0, c1 + 1), uv: 'grid' }, { rows: rows.slice(c1), uv: 'top' }]);
}

/**
 * Swivel star with flat paddle arms (Conform Daisy): each arm widens from the hub to a rounded tip that turns up a
 * little, a slim column with a collar.
 */
function paddleStar(g, ms, { r, topY, q, arms = 5, z = 0, colR = 0.024, collarY }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const m = ms.legs();
  const len = Math.max(0.12, r - 0.01), w0 = 0.016, w1 = 0.03, th = 0.016;
  // plan outline (x along the arm, y across), extruded th thick and laid flat
  const pts = [[0, -w0], [len - w1, -w1]];
  for (let k = 0; k <= 8; k++) {
    const t = -Math.PI / 2 + (Math.PI * k) / 8;
    pts.push([len - w1 + w1 * Math.cos(t), w1 * Math.sin(t)]);
  }
  pts.push([0, w0]);
  const geo = K.extrudeShape(pts, th, { bevel: 0.004, center: true, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    // resting on its glide at the tip (6 mm), the tip itself turned up a little
    p.setY(i, p.getY(i) + th / 2 + 0.006 + 0.012 * clamp01((x - len * 0.7) / (len * 0.3)) ** 2);
  }
  K.smoothNormals(geo, 1e4, 50);
  for (let i = 0; i < arms; i++) {
    const a = Math.PI / 2 + (i / arms) * Math.PI * 2;
    sub.add(K.partMesh(i ? geo.clone() : geo, m, 'legs', { rotation: [0, -a, 0] }));
    sub.add(K.partMesh(K.cylinder(0.012, 0.014, 0.008, { seg: 10 }), mat('plastic', '#1a1a1a'), null, { position: [Math.cos(a) * (len - w1 * 1.6), 0, Math.sin(a) * (len - w1 * 1.6)] }));
  }
  const seg = Math.max(10, Math.round(20 * q));
  sub.add(K.partMesh(K.cylinder(0.036, 0.042, 0.03, { seg }), m, 'legs'));
  sub.add(K.partMesh(K.cylinder(colR, colR * 1.1, topY - 0.03, { seg }), m, 'legs', { position: [0, 0.03, 0] }));
  sub.add(K.partMesh(K.cylinder(colR * 1.35, colR * 1.35, 0.016, { seg }), m, 'legs', { position: [0, collarY ?? topY * 0.55, 0] }));
}

/**
 * Swan / egg shell (shell 'swan'): a tall, reclined back petal that flares into big rounded shoulders, narrow at the
 * waist; low, out-flaring wings that sweep forward from the waist to upturned front tips beside a rolled seat lip; a
 * dished seat on a hull-shaped underside, all one thin upholstered skin over a slim 5-arm swivel star with a collar.
 * seat 'skin': the seat is one closed thin skin (scoopShell) – wings at the waist, a thin edge sweeping out to a wide
 * front, the underside rising from the column to it – on a paddle star (star 'paddle').
 */
function buildShellSwan(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'swivel-star';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.41), 0.3, h - 0.2);
  const under = clamp(num(P.underH, 0.3), 0.12, seatH - 0.06); // shell underside
  const armH = clamp(num(P.armH, seatH + 0.14), seatH + 0.04, h - 0.1);
  const T = clamp(num(P.shellT, 0.05), 0.03, 0.1), hw = T / 2;
  // back petal: rises from the seat, narrow at the waist, flaring into big rounded shoulders, strongly reclined
  const yb = seatH - 0.03, yt = h - hw;
  const rec = clamp(num(P.recline, 27), 0, 35) * DEG;
  const zTop = -d / 2 + hw + 0.004;
  const halfW = paramProfile(P.petalW, [[yb, w * 0.21], [seatH + 0.08, w * 0.25], [lerp(seatH, h, 0.5), w * 0.38], [lerp(seatH, h, 0.86), w / 2 - hw - 0.004], [yt, w / 2 - hw - 0.012]]);
  const depth = monoSpline([[yb, 0.2], [seatH + 0.1, 0.15], [yt, clamp(num(P.petalDepth, 0.06), 0.02, 0.3)]]);
  const theta = monoSpline([[yb, 105], [seatH + 0.1, 90], [yt, 60]]);
  const petal = petalShell({
    yb, yt, T, halfW, depth, theta, zBack: (y) => zTop + (yt - y) * Math.tan(rec), rc: clamp(num(P.shoulderR, 0.1), 0.04, 0.25),
    nLev: Math.max(10, Math.round(22 * q)), nCurve: Math.max(12, Math.round(22 * q)),
  });
  g.add(K.partMesh(shellGeometry(petal.levels, { center: [0, 0.1], nEnd: q < 1 ? 3 : 4, nCap: 4, topPts: petal.topPts }), ms.up, 'upholstery'));
  // seat bowl: a ring wall from the narrow underside, low at the back (under the petal), rising into the out-flaring
  // wings and falling to the rolled front lip
  const flare = num(P.flare, 0.6);
  const lean = (A, b) => flare * Math.max(Math.sin(A * DEG) ** 2, A > 90 ? 0.5 : 0) * b;
  const zBackB = num(P.bowlBack, -0.2);
  const wrz = (d / 2 - hw - lean(180, seatH - under) - zBackB) / 2, wzc = zBackB + wrz;
  // wings: from the waist they dip a little, then rise to upturned front tips; the front lip a little lower
  const top = paramProfile(P.topProfile, [[0, seatH + 0.02], [35, armH - 0.05], [72, armH - 0.09], [112, armH - 0.07], [146, armH], [180, armH - 0.07]]);
  const brx = clamp(num(P.bowlRx, 0.21), 0.1, w / 2 - hw);
  // lipK: the front lip's thickness as a factor of T (a rolled lip; 1 = as thin as the rest)
  const lipK = clamp(num(P.lipK, 1.7), 0.8, 2.5);
  const thick = monoSpline([[0, T], [115, T], [160, T * lerp(1, lipK, 6 / 7)], [180, T * lipK]]);
  // the hull: the wall's foot rises toward the wings and the lip, so the edges read thin and the underside curves
  const footP = paramProfile(P.footProfile, [[0, under], [50, under + 0.03], [100, under + 0.07], [150, under + 0.09], [180, under + 0.08]]);
  const zm = wzc - 0.02 + num(P.columnZ, 0);
  if (P.seat === 'skin') {
    g.add(K.partMesh(scoopShell({
      rx: brx, rz: wrz, zc: wzc, n: clamp(num(P.planN, 2.2), 1.6, 5), egg: num(P.egg, 0), top, foot: footP, T: thick, lean: (A, b) => lean(A, b + footP(A) - under),
      tuck: clamp(num(P.tuck, 0.03), 0.005, 0.1), seatY: seatH, sz: wzc + num(P.seatZ, -0.02), dp: num(P.dishExp, 2), hullY: under, hz: zm, hp: num(P.hullExp, 1.6), q,
    }), ms.up, 'upholstery'));
  } else {
    const bowl = sculptBand({ a0: 0, a1: 2 * Math.PI, rx: brx, rz: wrz, zc: wzc, n: 2.2, T: thick, top, foot: footP, lean: (A, b) => lean(A, b + footP(A) - under), tuck: 0.05, closed: true, samples: 64, q });
    g.add(K.partMesh(bowl.geo, ms.up, 'upholstery'));
    // dished seat filling the bowl: its edge rises toward the rim, its middle is the seat height
    const dish = clamp(num(P.seatDish, 0.05), 0, 0.1);
    const sOut = superLoop(brx + lean(90, seatH + dish - under) - hw, wrz - hw * 0.6, 2.2, wzc + 0.01, Math.max(32, Math.round(48 * q)));
    g.add(K.partMesh(slabGeometry(sOut, { y0: under + 0.01, y1: seatH + dish, rTop: 0.03, rBot: Math.min(0.1, seatH + dish - under - 0.05), dome: -dish, belly: 0, nCap: 6, nEdge: 4 }), ms.up, 'upholstery'));
  }
  // base
  if (style === 'swivel-star' && P.star === 'paddle') {
    paddleStar(g, ms, { r: clamp(num(P.starR, w * 0.46), 0.2, 0.4), topY: under + 0.01, q, arms: clamp(Math.round(num(P.starArms, 5)), 3, 6), z: zm, collarY: under * 0.55 });
  } else if (style === 'swivel-star') {
    starBase(g, ms, { r: clamp(num(P.starR, w * 0.46), 0.2, 0.4), topY: under + 0.004, q, arms: clamp(Math.round(num(P.starArms, 5)), 3, 6), slim: P.starSlim !== false, z: zm, plate: num(P.plate, 0.18) });
    g.add(K.partMesh(K.cylinder(0.034, 0.034, 0.014, { seg: Math.max(12, Math.round(20 * q)) }), ms.legs(), 'legs', { position: [0, under * 0.55, zm] }));
  } else addBase(g, ms, style, { hx: w * 0.3, hz: d * 0.28, topY: under, q, z: zm, inset: 0.04 });
  return K.finishModel(g, { seatY: seatH });
}

/**
 * A lens-shaped arm slab of the pod chair (arms 'lens'): its side outline (z, y) is a superellipse-like lens from z0
 * to z1 and y0 to y1 (centre zc, yc) with exponents mTop / mBot (2 = elliptic, larger = squarer), standing between
 * the faces xIn..xOut (at height yRef) on side s (±1), edges rounded (r); the slab leans outward (lean m/m of height
 * above yRef) and its ends toe in (bend m at the tips).
 */
function lensArm({ s, xIn, xOut, z0, z1, zc, y0, y1, yc, mTop = 3, mBot = 2.4, r = 0.04, lean = 0, yRef = 0, bend = 0, dome = 0, curl = 0, tilt = 0, q }) {
  const n = Math.max(32, Math.round(56 * q));
  const loop = [];
  const ct = Math.cos(tilt), st = Math.sin(tilt); // tilt (rad): the outline turned about its centre, front up
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const c = Math.cos(t), sn = Math.sin(t);
    const m = sn >= 0 ? mTop : mBot;
    const a = c >= 0 ? z1 - zc : zc - z0, b = sn >= 0 ? y1 - yc : yc - y0;
    const dz = a * Math.sign(c) * Math.abs(c) ** (2 / m), dy = b * Math.sign(sn) * Math.abs(sn) ** (2 / m);
    loop.push([zc + dz * ct - dy * st, yc + dz * st + dy * ct]);
  }
  // built on the +x side (the outer face is the loft's top cap, domed outward), mirrored for the −x arm
  const geo = loftGeometry([{ y: xIn + r, loop }, { y: xOut - r, loop }], { top: r, bottom: r, nEdge: q < 1 ? 3 : 4, nCap: 4, dome, matrix: PROFILE_X });
  const p = geo.attributes.position;
  const half = Math.max(0.05, (z1 - z0) / 2), zm = (z0 + z1) / 2;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    p.setX(i, s * (p.getX(i) + lean * (y - yRef) - bend * ((z - zm) / half) ** 2 - curl * clamp01((y1 - y) / (y1 - y0)) ** 2.5));
  }
  if (s < 0) {
    const ix = geo.index.array;
    for (let t = 0; t < ix.length; t += 3) {
      const tmp = ix[t + 1];
      ix[t + 1] = ix[t + 2];
      ix[t + 2] = tmp;
    }
  }
  K.smoothNormals(geo);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** The lens arm's outer face x at height y and depth z (null outside the outline, less a rounded edge r). */
function lensArmOuter({ xOut, z0, z1, zc, y0, y1, yc, mTop = 3, mBot = 2.4, r = 0.04, lean = 0, yRef = 0, bend = 0, dome = 0, curl = 0, tilt = 0 }, y, z) {
  // into the untilted outline's frame
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const zt = zc + (z - zc) * ct + (y - yc) * st, yt = yc - (z - zc) * st + (y - yc) * ct;
  const a = zt >= zc ? z1 - zc : zc - z0;
  const u = Math.abs(zt - zc) / a;
  if (u >= 1) return null;
  // the outline's top and bottom at this z
  const yAt = (m, b, sg) => yc + sg * b * Math.sqrt(Math.max(0, 1 - u ** m)) ** (2 / m);
  const top = yAt(mTop, y1 - yc, 1), bot = yAt(mBot, yc - y0, -1);
  const dy = Math.min(yt - bot, top - yt);
  if (dy <= 0) return null;
  const cut = dy < r ? r - Math.sqrt(Math.max(0, r * r - (r - dy) ** 2)) : 0;
  const half = Math.max(0.05, (z1 - z0) / 2), zm = (z0 + z1) / 2;
  const rho2 = Math.min(1, u * u + ((yt - yc) / (yt >= yc ? y1 - yc : yc - y0)) ** 2);
  return xOut - cut + dome * (1 - rho2) + lean * (y - yRef) - bend * ((z - zm) / half) ** 2 - curl * clamp01((y1 - y) / (y1 - y0)) ** 2.5;
}

/**
 * Pod chair (shell 'pod'): seat and arms are one egg-shaped pod (a ring wall whose rim rises into wide, outward-leaning
 * arm wings and dips to the seat lip at the front, lens-shaped from the side), with a separate shield-shaped back
 * petal (narrow, a waist at the shoulders, broad rounded top) standing in it; S20 hairpin wire base under a ring
 * (legStyle 'slim-metal') or a swivel star. arms 'lens': the arms are separate lens-shaped slabs on the pod's sides.
 */
function buildShellPod(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = P.legStyle || 'slim-metal';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.44), 0.3, h - 0.2);
  const armH = clamp(num(P.armH, seatH + 0.14), seatH + 0.05, h - 0.1);
  const under = clamp(num(P.underH, 0.27), 0.1, seatH - 0.1); // lowest point of the pod
  const Ta = clamp(num(P.shellT, 0.125), 0.06, 0.2); // arm thickness (thinner round the back and at the front lip)
  const lipT = clamp(num(P.lipT, 0.08), 0.05, 0.16); // the front lip roll
  const thick = monoSpline([[0, 0.08], [40, Ta], [130, Ta], [165, Math.max(0.09, lipT)], [180, lipT]]);
  // pod ring (the seam at the back centre, behind the petal): rim low at the back, the arm tops, the seat lip in front;
  // the underside a lens, lowest behind the middle
  // the arms are separate lobes at the sides: low behind the petal, rising to meet its sides, level, a rounded nose
  // falling to a broad, level seat lip in front
  const top = paramProfile(P.topProfile, [[0, seatH - 0.04], [40, seatH + 0.02], [56, armH + 0.05], [90, armH + 0.005], [132, armH - 0.04], [150, armH - 0.075], [163, seatH + 0.01], [180, seatH]]);
  const footP = paramProfile(P.footProfile, [[0, under + 0.05], [60, under + 0.01], [90, under], [135, under + 0.03], [160, under + 0.05], [180, under + 0.06]]);
  const flare = num(P.flare, 0.3);
  // the outward lean is full at the sides; leanHold [A0, A1] keeps it full round the front corners (the arm noses
  // overhang the narrower belly) and fades it out to the front lip
  const hold = Array.isArray(P.leanHold) && P.leanHold.length === 2 ? P.leanHold : null;
  const leanW = (A) => (hold && A > 90 ? 1 - sstep(hold[0], hold[1], A) : Math.max(0, Math.sin(A * DEG)) ** 3);
  const lean = (A, b) => flare * leanW(A) * b;
  const rx = clamp(num(P.podRx, w / 2 - Ta / 2 - lean(90, armH - under) + 0.004), 0.1, w / 2), rz = d / 2 - 0.05 - 0.008;
  // plan exponent: planN at the back half, planNFront (default the same) toward the front, so the arms can run
  // straight forward to square-ish front corners
  const nB = clamp(num(P.planN, 2.1), 1.6, 5), nF = clamp(num(P.planNFront, nB), 1.6, 6);
  const nAt = (A) => (nF === nB ? nB : lerp(nB, nF, sstep(60, 120, A)));
  const tuck = clamp(num(P.tuck, 0.06), 0.01, 0.15);
  const pod = sculptBand({
    a0: 0, a1: 2 * Math.PI, rx, rz, zc: 0, n: nF === nB ? nB : nAt, T: thick, top, foot: footP, closed: true,
    lean, tuck, bulge: 0.008, samples: 80, sq: clamp(num(P.topSq, 1), 0.3, 1), q,
  });
  g.add(K.partMesh(pod.geo, ms.up, 'upholstery'));
  // pod floor + seat cushion (floorIn: how far the floor sits inside the wall's centre line – a deep tuck-under
  // curls the wall in to meet a smaller floor, so the belly reads round)
  const nO = Math.max(32, Math.round(48 * q));
  const fIn = clamp(num(P.floorIn, 0.03), 0.01, 0.15);
  const inner = superLoop(rx - fIn, rz - fIn, nB, 0, nO);
  g.add(K.partMesh(slabGeometry(inner, { y0: under + 0.02, y1: seatH - 0.07, rTop: 0.01, rBot: 0.06 }), ms.up, 'upholstery'));
  // arms 'lens': each arm a separate lens-shaped slab (level top, big round nose, the belly below) standing on the
  // pod's sides – the ring then only shapes the low back, the seat lip and the inside (its sides hide in the arms)
  let cushX = rx + lean(90, seatH - under) - Ta / 2 + 0.01;
  let lens = null;
  if (P.arms === 'lens') {
    const aT = clamp(num(P.armT, Ta), 0.06, 0.22), aLean = num(P.armLean, 0.2), dome = clamp(num(P.armDome, 0.012), 0, 0.04);
    const xOut = w / 2 - 0.002 - dome, xIn = xOut - aT;
    const [z0, z1] = Array.isArray(P.armZ) ? P.armZ : [-d / 2 + 0.02, d / 2];
    const [y0, y1] = Array.isArray(P.armY) ? P.armY : [under, armH];
    const [mTop, mBot] = Array.isArray(P.armM) ? P.armM : [3, 2.4];
    lens = { xIn, xOut, z0, z1, zc: num(P.armZc, (z0 + z1) / 2), y0, y1, yc: num(P.armYc, (y0 + y1) / 2), mTop, mBot, r: clamp(num(P.armR, 0.035), 0.01, aT * 0.45), lean: aLean, yRef: y1, bend: num(P.armBend, 0.02), dome, curl: num(P.armCurl, 0), tilt: num(P.armTilt, 0) * DEG, q };
    for (const s of [-1, 1]) g.add(K.partMesh(lensArm({ ...lens, s }), ms.up, 'upholstery'));
    cushX = xIn + aLean * (seatH - y1) + 0.012;
  }
  const cushOut = superLoop(cushX, rz - 0.04, Math.max(2.3, nF), 0.01, nO);
  g.add(K.partMesh(slabGeometry(cushOut, { y0: seatH - 0.08, y1: seatH, rTop: 0.035, rBot: 0.01, dome: 0.01, belly: 0.004 }), ms.up, 'upholstery'));
  // back petal (shield): narrow where it rises from the pod, a waist at the shoulders, a broad rounded top
  const Tb = clamp(num(P.backT, 0.08), 0.04, 0.12);
  const yb = clamp(num(P.petalFrom, under + 0.05), under, seatH), yt = h - Tb / 2;
  const rec = clamp(num(P.recline, 6), 0, 35) * DEG;
  const zTop = -d / 2 + Tb / 2 + 0.01;
  const hwW = paramProfile(P.petalW, [[yb, 0.18], [seatH, 0.2], [lerp(seatH, h, 0.38), 0.19], [lerp(seatH, h, 0.62), 0.245], [lerp(seatH, h, 0.84), 0.285], [yt, 0.28]]);
  const petal = petalShell({
    yb, yt, T: Tb, halfW: hwW, depth: monoSpline([[yb, 0.07], [yt, 0.025]]), theta: monoSpline([[yb, 60], [yt, 40]]),
    zBack: (y) => zTop + (yt - y) * Math.tan(rec), rc: clamp(num(P.shoulderR, 0.1), 0.03, 0.2), nLev: Math.max(12, Math.round(24 * q)), nCurve: Math.max(12, Math.round(22 * q)),
  });
  g.add(K.partMesh(shellGeometry(petal.levels, { center: [0, 0.2], nEnd: q < 1 ? 3 : 4, nCap: 4, topPts: petal.topPts }), ms.up, 'upholstery'));
  g.add(K.partMesh(backSeam(petal.levels, Tb), ms.pipe, ms.pipePart));
  {
    // horizontal seam across the inner face at the shoulders: seamSpan = fraction of the width it crosses, seamDip
    // = how far it sags in the middle (it follows the petal between its levels)
    const ys = lerp(seatH, h, num(P.seamAt, 0.5));
    const span = clamp(num(P.seamSpan, 0.72), 0.2, 0.98), dip = clamp(num(P.seamDip, 0), 0, 0.08);
    const L = petal.levels;
    const m = L[0].pts.length;
    const j0 = Math.round((m - 1) * (0.5 - span / 2)), j1 = Math.round((m - 1) * (0.5 + span / 2));
    const p2 = [], yy = [];
    for (let j = j0; j <= j1; j++) {
      const s = Math.abs(j / (m - 1) - 0.5);
      const y = ys - dip * (1 - sstep(0.08, 0.5, s));
      let i = 0;
      while (i < L.length - 2 && L[i + 1].y < y) i++;
      const f = clamp((y - L[i].y) / (L[i + 1].y - L[i].y || 1e-9), 0, 1);
      p2.push([lerp(L[i].pts[j][0], L[i + 1].pts[j][0], f), lerp(L[i].pts[j][1], L[i + 1].pts[j][1], f)]);
      yy.push(y);
    }
    const { N } = curveFrames(p2, [0, 0.2]);
    const pts = p2.map((p, k) => new THREE.Vector3(p[0] - N[k][0] * (Tb / 2 + 0.0005), yy[k], p[1] - N[k][1] * (Tb / 2 + 0.0005)));
    if (pts.length > 2) g.add(K.partMesh(seamTube(pts, 0.0025, { radial: 4 }), ms.pipe, ms.pipePart));
  }
  // base
  if (style === 'slim-metal') {
    // S20: a black wire ring under the pod, four hairpin legs (two rods each) splayed out to the corners
    const m = ms.legs();
    const rr = 0.006;
    const rxr = rx * 0.92, rzr = rz * 0.88;
    const foldA = (a) => Math.abs((((a / DEG + 180) % 360) + 360) % 360 - 180);
    // ringProfile [[deg, m], …]: the ring hugs the pod's outer face at those heights (round its girth) instead of
    // running under the wall's foot
    const ringY = Array.isArray(P.ringProfile) ? paramProfile(P.ringProfile, [[0, under]]) : null;
    const ringAt = (a) => {
      if (!ringY) return new THREE.Vector3(Math.sin(a) * rxr, footP(foldA(a)) - 0.004, -Math.cos(a) * rzr);
      const A = foldA(a), y = ringY(A), b = Math.max(0, y - footP(A));
      const p = superPt(a, rx, rz, nAt(A)), p1 = superPt(a + 0.002, rx, rz, nAt(A));
      let nx = p1[1] - p[1], nz = -(p1[0] - p[0]);
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      if (p[0] * nx + p[1] * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const o = lean(A, b) - tuckIn(b, tuck) + thick(A) / 2 + rr * 0.5;
      const v = new THREE.Vector3(p[0] + nx * o, y, p[1] + nz * o);
      // lens arms: round their sides the ring hugs the arms' outer faces
      const xo = lens ? lensArmOuter(lens, y, v.z) : null;
      if (xo != null && Math.abs(v.x) < xo + rr) v.x = Math.sign(v.x || 1) * (xo + rr * 0.6);
      return v;
    };
    const ring = [];
    const nr = Math.max(32, Math.round(56 * q));
    for (let i = 0; i < nr; i++) ring.push(ringAt((i / nr) * Math.PI * 2));
    g.add(K.partMesh(seamTube(ring, rr, { closed: true, radial: 6, seg: nr * 2 }), m, 'legs'));
    const fx = clamp(num(P.footX, w / 2 - 0.1), 0.15, w / 2), fzF = clamp(num(P.footZ, d / 2 - 0.07), 0.15, d / 2), fzB = d / 2 - 0.01;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const f3 = new THREE.Vector3(sx * fx, 0.006, sz * (sz > 0 ? fzF : fzB));
        for (const da of [-0.17, 0.17]) {
          const a = Math.atan2(sx * 0.9, -sz) + da;
          g.add(K.partMesh(K.tube([ringAt(a), f3], rr, { curve: 'line', radial: 6, seg: 2 }), m, 'legs'));
        }
        g.add(K.partMesh(K.cylinder(0.011, 0.011, 0.008, { seg: 8 }), m, 'legs', { position: [f3.x, 0, f3.z] }));
      }
    }
  } else if (style === 'swivel-star') starBase(g, ms, { r: clamp(num(P.starR, 0.32), 0.2, 0.4), topY: under + 0.02, q, arms: clamp(Math.round(num(P.starArms, 4)), 3, 6), plate: 0.2 });
  else addBase(g, ms, style, { hx: rx * 0.7, hz: rz * 0.7, topY: under + 0.02, q, inset: 0.04 });
  return K.finishModel(g, { seatY: seatH });
}

function buildShellLegs(spec) {
  const mode = spec.params.shell;
  if (mode === 'pillow') return buildShellPillow(spec);
  if (mode === 'high') return buildShellHigh(spec);
  if (mode === 'swan') return buildShellSwan(spec);
  if (mode === 'pod') return buildShellPod(spec);
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

/** Trumpet pedestal under a seat at z (bar stools): lathe foot, column, gas-lift sleeve and swivel disc; foot ring. */
function trumpetBase(g, ms, { w, d, z, seatBot, q, footY }) {
  const m = ms.legs();
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const R = clamp(Math.min(w, d) * 0.5, 0.18, 0.24);
  const seg = Math.max(16, Math.round(36 * q));
  sub.add(K.partMesh(K.lathe([[0.001, 0], [R, 0], [R, 0.005], [0.96 * R, 0.012], [0.5 * R, 0.03], [0.06, 0.06], [0.035, 0.1], [0.03, 0.14]], { seg }), m, 'legs'));
  const sleeve0 = Math.max(0.2, seatBot - 0.12);
  sub.add(K.partMesh(K.cylinder(0.025, 0.025, Math.max(0.01, sleeve0 - 0.135), { seg: Math.max(10, Math.round(18 * q)) }), m, 'legs', { position: [0, 0.135, 0] }));
  sub.add(K.partMesh(K.cylinder(0.032, 0.032, Math.max(0.01, seatBot - 0.02 - sleeve0), { seg: Math.max(10, Math.round(18 * q)) }), m, 'legs', { position: [0, sleeve0, 0] }));
  sub.add(K.partMesh(K.cylinder(0.09, 0.09, 0.012, { seg: Math.max(14, Math.round(28 * q)) }), m, 'legs', { position: [0, seatBot - 0.02, 0] }));
  if (footY != null && footY < sleeve0 - 0.02) {
    // a foot ring on three spokes
    const Rr = clamp(0.95 * R, 0.15, 0.21);
    sub.add(K.partMesh(K.torus(Rr, 0.008, { radial: 6, tubular: Math.max(24, Math.round(48 * q)) }), m, 'legs', { position: [0, footY, 0], rotation: [Math.PI / 2, 0, 0] }));
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      const u = [Math.cos(a), Math.sin(a)];
      sub.add(K.partMesh(K.tube([[u[0] * 0.024, footY, u[1] * 0.024], [u[0] * Rr, footY, u[1] * Rr]], 0.006, { curve: 'line', radial: 6, seg: 1 }), m, 'legs'));
    }
  }
}

/** dimsRange.h of the bar stool (from 0.6: a backless stool's dims.h is its seat height). */
const BAR_STOOL_H = [0.6, 1.15];

/**
 * Seat height of a bar stool of height h. Only a backless stool (back 'none') may have its seat right at dims.h
 * (design/furniture.md §4.2). With a back the seat is capped 15 cm under dims.h and the back is kept, as before round
 * 3: a saved stool whose seat slider sits close to its height keeps its shell instead of losing it.
 */
function barSeat(P, h) {
  const backless = P.back === 'none';
  return clamp(num(P.seatH, backless ? h : 0.65), 0.45, backless ? h : h - 0.15);
}

/**
 * Inspector hook (def.paramPatch): the extra { dims, params } patch when params[key] becomes value, or null. A
 * backless bar stool that gets a back keeps its seat and grows by the back (0.32); one that loses its back shrinks to
 * its seat.
 */
function barStoolParamPatch(item, key, value) {
  if (key !== 'back') return null;
  const P = item?.params || {};
  if ((P.back === 'none') === (value === 'none')) return null;
  const seat = barSeat({ seatH: 0.65, ...P }, num(item?.dims?.h, 0.97));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const [lo, hi] = BAR_STOOL_H;
  if (value === 'none') return { params: { seatH: r3(seat) }, dims: { h: r3(clamp(seat, lo, hi)) } };
  const top = clamp(seat + 0.32, lo, hi);
  return { params: { seatH: r3(clamp(seat, 0.45, top - 0.15)) }, dims: { h: r3(top) } };
}

function buildBarStool(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const style = ['slim-metal', 'wood', 'pedestal', 'sled'].includes(P.legStyle) ? P.legStyle : 'slim-metal';
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = barSeat(P, h);
  const hasBack = P.back !== 'none' && h > seatH + 0.12;
  const arms = hasBack && P.arms === true;
  // back: shell (a quilted bucket), pad (a loose pad on two tube posts, Zed) or upholstered (a straight parsons back,
  // Ella)
  const backKind = !hasBack ? 'none' : P.back === 'pad' || P.back === 'upholstered' ? P.back : 'shell';
  const cushT = 0.075;
  const seatBot = seatH - cushT;
  const T = 0.045;
  const halfW0 = w * 0.43, halfW1 = w / 2 - T / 2 - 0.003;
  let sz0 = -d / 2 + 0.05;
  if (backKind === 'upholstered') {
    // a straight upholstered back from below the seat to dims.h, leaning 5°, its top kept inside dims.d
    const bt = 0.07, lean = 5 * DEG;
    const y0 = seatBot - 0.03, bh = h - y0;
    const grp = new THREE.Group();
    grp.position.set(0, y0, -d / 2 + bt / 2 + bh * Math.sin(lean));
    grp.rotation.x = -lean;
    g.add(grp);
    grp.add(K.partMesh(softBox(w * 0.92, bh, bt, 'z', { puff: 0.12, round: 0.7, sides: 0.08, bottom: 0.15, q }), ms.up, 'upholstery', { position: [0, bh / 2, 0] }));
    sz0 = -d / 2 + bt + (bh - (seatH - y0)) * Math.sin(lean) - 0.008;
  } else if (backKind === 'pad') {
    sz0 = -d / 2 + 0.03;
  } else if (hasBack) {
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
    // arms: the shell wraps further forward round the seat and forms the armrests (Zed, Henry)
    const shell = chairShell({
      yb, yt, T, halfW0, halfW1, depth0: arms ? 0.27 : 0.18, depth1: 0.09, theta0: arms ? 115 : 95, theta1: 66, zTop, recline: 8 * DEG,
      rc: Math.min(0.12, (yt - yb) * 0.4), nLev: Math.max(10, Math.round(22 * q)), nCurve: Math.max(14, Math.round(30 * q)), quilt,
    });
    g.add(K.partMesh(shellGeometry(shell.levels, { center: [0, 0.1], nEnd: q < 1 ? 3 : 4, nCap: 4, topPts: shell.topPts }), ms.up, 'upholstery'));
    g.add(K.partMesh(backSeam(shell.levels, T), ms.pipe, ms.pipePart));
    sz0 = shell.zBot + T * 0.15;
  }
  const sz1 = d / 2 - 0.02;
  const sw0 = halfW0 - T / 2 - 0.004, sw1 = w * 0.46;
  // a parsons seat is a square block; the others round off toward the front
  const seatOut = backKind === 'upholstered' ? rrOutline(-sw1, sw1, sz0, sz1, 0.02, 0.035, 6, 4) : rrOutline(-sw1, sw1, sz0, sz1, 0.06, 0.075, 6, 4, (x) => 0.012 * (1 - (x / sw1) ** 2));
  const zm = (sz0 + sz1) / 2;
  if (backKind === 'shell') for (const p of seatOut) p[0] *= lerp(sw0 / sw1, 1, sstep(0, 1, clamp((p[1] - sz0) / (zm - sz0), 0, 1)));
  g.add(K.partMesh(slabGeometry(seatOut, { y0: seatBot, y1: seatH, rTop: 0.03, rBot: 0.012, dome: 0.008, belly: 0.004 }), ms.up, 'upholstery'));
  // frame: under-seat plate and the base (four slim legs or wood legs with a foot rest, a trumpet pedestal or sleds)
  const m = ms.legs({ grain: 'v' });
  const sd = sz1 - sz0;
  const legTop = seatBot - 0.006;
  g.add(K.partMesh(K.roundedBox(w * 0.6, 0.012, sd * 0.62, 0.003, 1), ms.legs(), 'legs', { position: [0, seatBot - 0.004, zm] }));
  const fy = clamp(num(P.footrestH, seatH * 0.4), 0.15, seatH - 0.15);
  // pad back (Zed): two tube posts just outside the seat's rear corners, raked 8° back up behind a slightly curved
  // loose pad; arms are tube loops from the posts forward and down into the seat sides
  const post = { x: sw1 + 0.006, z: sz0 + 0.04, r: clamp(num(P.legD, 0.022) / 2, 0.007, 0.02) * 0.85 };
  if (backKind === 'pad') {
    const steel = ms.legs();
    const rake = Math.tan(8 * DEG);
    const yTop = h - 0.04;
    const zAt = (y) => post.z - rake * (y - legTop);
    for (const sx of [-1, 1]) g.add(K.partMesh(K.tube([[sx * post.x, legTop, post.z], [sx * post.x, yTop, zAt(yTop)]], post.r, { curve: 'line', radial: Math.max(6, Math.round(10 * q)), seg: 1 }), steel, 'legs'));
    const pw = Math.min(w, 2 * post.x + 0.03), ph = Math.min(0.2, h - seatH - 0.08), pt = 0.05, R = 0.9;
    const geo = softBox(pw, ph, pt, 'z', { puff: 0.14, round: 0.8, sides: 0.15, bottom: 0.4, q: Math.max(q, 1.2) });
    // bend the pad round the sitter (sides forward); its back rests on the posts' front where they cross it
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + (pos.getX(i) ** 2) / (2 * R));
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const yc = h - ph / 2 - 0.005;
    g.add(K.partMesh(geo, ms.up, 'upholstery', { position: [0, yc, zAt(yc) + post.r + pt / 2 + 0.001 - (post.x ** 2) / (2 * R)], rotation: [-8 * DEG, 0, 0] }));
    if (arms) {
      const ay = Math.min(seatH + 0.1, yc - ph / 2 - 0.01);
      const zF = sz1 - 0.05;
      for (const sx of [-1, 1]) {
        const { pts } = filletPolyline([[zAt(ay), ay], [zF, ay], [zF, seatBot + 0.02]], [0, 0.05, 0], Math.max(4, Math.round(8 * q)));
        g.add(K.partMesh(K.tube(pts.map(([z, y]) => [sx * post.x, y, z]), post.r, { curve: 'line', radial: Math.max(6, Math.round(10 * q)) }), steel, 'legs'));
      }
    }
  }
  if (style === 'pedestal') {
    trumpetBase(g, ms, { w, d, z: zm, seatBot, q, footY: P.footrest !== false ? fy : null });
    return K.finishModel(g, { seatY: seatH });
  }
  if (style === 'sled') {
    // one bent tube per side: under the seat at the back, down to a floor runner, forward and up to the seat front
    const tr = clamp(num(P.legD, 0.022) / 2, 0.008, 0.014);
    const ax = w * 0.36;
    const zb = zm - sd * 0.34, zf = zm + sd * 0.34;
    const fb = Math.max(-d / 2 + tr, zb - 0.07), ff = Math.min(d / 2 - tr, zf + 0.07);
    const { pts } = filletPolyline([[zb, legTop], [fb, tr], [ff, tr], [zf, legTop]], [0, 0.06, 0.06, 0], Math.max(4, Math.round(8 * q)));
    const steel = ms.legs();
    for (const sx of [-1, 1]) g.add(K.partMesh(K.tube(pts.map(([z, y]) => [sx * ax, y, z]), tr, { curve: 'line', radial: Math.max(6, Math.round(10 * q)) }), steel, 'legs'));
    if (P.footrest !== false) {
      const zr = ff + ((zf - ff) * (fy - tr)) / Math.max(0.01, legTop - tr);
      g.add(K.partMesh(K.tube([[-ax, fy, zr], [ax, fy, zr]], tr * 0.8, { curve: 'line', radial: 6, seg: 1 }), steel, 'legs'));
    }
    return K.finishModel(g, { seatY: seatH });
  }
  const wood = style === 'wood';
  const ax = w * 0.33, az = sd * 0.34;
  const r = wood ? 0.016 : clamp(num(P.legD, 0.022) / 2, 0.007, 0.02);
  const feet = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // a pad back's rear legs carry on up as its posts
      const top = backKind === 'pad' && sz < 0 ? [sx * post.x, legTop, post.z] : [sx * ax, legTop, zm + sz * az];
      const bot = [sx * (w / 2 - 0.025), 0, clamp(zm + sz * (az + 0.07), -d / 2 + 0.02, d / 2 - 0.02)];
      addLeg(g, m, 'legs', top, bot, r, wood ? 0.012 : r * 0.85, { seg: Math.max(6, Math.round((wood ? 12 : 10) * q)), square: wood && P.square === true });
      feet.push({ top, bot });
    }
  }
  if (P.footrest !== false) {
    const at = (f) => {
      const t = fy / f.top[1];
      return new THREE.Vector3(lerp(f.bot[0], f.top[0], t), fy, lerp(f.bot[2], f.top[2], t));
    };
    // order: (−x,−z) (−x,+z) (+x,−z) (+x,+z); wood: front and side rungs, no back rung
    const [a, b, c, e] = feet.map(at);
    const rungs = wood ? [[b, e], [a, b], [c, e]] : [[b, e], [a, b], [c, e], [a, c]];
    for (const [p0, p1] of rungs) g.add(K.partMesh(K.tube([p0, p1], wood ? 0.009 : r * 0.7, { curve: 'line', radial: wood ? 8 : 6, seg: 2 }), m, 'legs'));
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
  // open end («endeavslutning»): a backless, armless seat module instead of the arm at that end. On the short-leg
  // side of a corner/chaise sofa the corner or chaise already ends the sofa, so it changes nothing there.
  const openSide = P.openEnd === '-x' || P.openEnd === '+x' ? (flip ? swap(P.openEnd) : P.openEnd) : 'none';
  const openPos = openSide === '+x';
  const openNeg = openSide === '-x' && !hasChaise;
  const fixedW = (openNeg ? 0 : armNeg ? armW : 0) + (hasChaise ? depth : 0) + (openPos ? 0 : armPos ? armW : 0);
  // at least 0.6 m of seats stay between the ends
  const openW = Math.max(0.2, Math.min(clamp(num(P.openEndW, 0.8), 0.5, 1.2), w - fixedW - 0.6));
  // modules from the short-leg end (canonical −x) toward the arm end
  let mods = Array.isArray(P.modules) ? P.modules.filter((m) => m && m.kind !== 'chaise' && num(m.w, 0) > 0).map((m) => ({ kind: m.kind, w: m.w })) : null;
  if (flip && mods) mods = mods.slice(); // order is already from the short-leg side
  if (!mods || !mods.length) {
    mods = [];
    if (openNeg) mods.push({ kind: 'open', w: openW });
    else if (armNeg) mods.push({ kind: 'arm', w: armW });
    if (hasChaise) mods.push({ kind: 'corner', w: depth });
    const rest = w - (openNeg ? openW : armNeg ? armW : 0) - (hasChaise ? depth : 0) - (openPos ? openW : armPos ? armW : 0);
    const n = Math.max(1, Math.round(rest / 0.86));
    for (let i = 0; i < n; i++) mods.push({ kind: 'seat', w: rest / n });
    if (openPos) mods.push({ kind: 'open', w: openW });
    else if (armPos) mods.push({ kind: 'arm', w: armW });
  }
  const sum = mods.reduce((s, m) => s + m.w, 0) || 1;
  const k = w / sum;
  const kit = boxSofaKit({ g: inner, ms, q, piping, plinthH, baseTop, seatH, backH, frameT, backT, lean: 6 * DEG });
  const zr = -d / 2, zf = -d / 2 + depth;
  let x = -w / 2;
  let cornerX1 = -w / 2 + depth;
  const openSpans = [];
  for (const m of mods) {
    const x0 = x, x1 = x + m.w * k;
    x = x1;
    if (m.kind === 'open') {
      // base and a full-depth seat, no back and no arm
      kit.base(x0, x1, zr, zf);
      kit.seat(x0, x1, zr, zf);
      openSpans.push([x0, x1]);
      continue;
    }
    if (m.kind === 'arm') {
      // the arm beside an open chaise runs along it, or (hidden chaiseArm 'short') only beside the back seat (Tampa)
      kit.arm(x0, x1, zr, chaiseLayout && x0 <= -w / 2 + 1e-6 && P.chaiseArm !== 'short' ? d / 2 : zf, armH, plinthH, P.armStyle);
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
  for (const [x0, x1] of openSpans) {
    // the open end is only seat-high
    if (x0 <= -w / 2 + 1e-6) colliders[0].min[0] = x1;
    if (x1 >= w / 2 - 1e-6) colliders[0].max[0] = x0;
    colliders.push({ min: [x0, 0, zr], max: [x1, seatH, zf] });
  }
  if (hasChaise && chaiseLayout) {
    const x0 = -w / 2 + (armNeg && P.chaiseArm !== 'short' ? armW : 0), x1 = cornerX1;
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
    // recessed under the base modules: 2.5 cm by default (the house's own corner sofa, as before runde 3); hidden
    // plinthInset 0.06 makes it a shadow gap under rounded modules instead of a tray (Tampa)
    const pm = ms.legs();
    const ip = clamp(num(P.plinthInset, 0.025), 0.01, 0.12);
    inner.add(K.partMesh(K.roundedBox(w - 2 * ip, plinthH + 0.004, depth - 2 * ip, 0.004, 1, { bottom: true }), pm, 'legs', { position: [0, 0, (zr + zf) / 2] }));
    if (hasChaise) inner.add(K.partMesh(K.roundedBox(cornerX1 + w / 2 - 2 * ip, plinthH + 0.004, chaiseL, 0.004, 1, { bottom: true }), pm, 'legs', { position: [(-w / 2 + cornerX1) / 2, 0, zf + chaiseL / 2 - ip] }));
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
  // a tight back leans 5° from its foot; its foot sits that far forward so the top's rear face stays at z = −d/2, and
  // the seat starts in front of the back's face at seat height
  const tightLean = 5 * DEG;
  const tightBt = frameT + 0.03, tightBh = backH - legH;
  const tightShift = tightBh * Math.sin(tightLean) + (tightBt / 2) * (1 - Math.cos(tightLean));
  const seatZ0 = tightBack ? zr + tightBt + Math.max(0, (backH - seatH) * Math.sin(tightLean) - 0.012) : zr + backT;
  if (benchSeat) kit.seat(ix0, ix1, seatZ0, zf);
  for (let i = 0; i < n; i++) {
    if (!benchSeat) kit.seat(ix0 + i * sw, ix0 + (i + 1) * sw, seatZ0, zf);
    if (!tightBack) kit.backX(ix0 + i * sw, ix0 + (i + 1) * sw, zr, { frame: i === 0 });
  }
  if (tightBack) {
    // a fixed upholstered back, slightly reclined: in one piece across the sofa, or (hidden backSplit) one panel per
    // seat with a crowned top – the outer corners highest, dipping toward the middle of the sofa (Fia)
    const bt = tightBt, bh = tightBh;
    const panels = P.backSplit === true ? Array.from({ length: n }, (_, i) => [ix0 + i * sw + (i > 0 ? 0.005 : 0), ix0 + (i + 1) * sw - (i < n - 1 ? 0.005 : 0)]) : [[ix0, ix1]];
    const hw = (ix1 - ix0) / 2, cx0 = (ix0 + ix1) / 2;
    const rise = P.backSplit === true ? Math.min(0.05, bh * 0.08) : 0;
    for (const [xa, xb] of panels) {
      const grp = new THREE.Group();
      grp.position.set((xa + xb) / 2, legH, zr + bt / 2 + tightShift);
      grp.rotation.x = -tightLean;
      g.add(grp);
      const geo = softBox(xb - xa - 0.004, bh, bt, 'z', { puff: 0.12, round: rise ? 1 : 0.8, sides: 0.08, bottom: 0.2, q: rise ? Math.max(q, 1.3) : q });
      if (rise) {
        // lower the top toward the sofa's middle: full height at the outer ends, `rise` lower where the panels meet
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const t = clamp((pos.getY(i) + bh / 2) / bh, 0, 1);
          const u = clamp(Math.abs((xa + xb) / 2 + pos.getX(i) - cx0) / hw, 0, 1);
          pos.setY(i, pos.getY(i) - rise * (1 - sstep(0.15, 1, u)) * t ** 3);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      }
      grp.add(K.partMesh(geo, ms.up, 'upholstery', { position: [0, bh / 2, 0] }));
    }
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
  // params.piping false: no welt round the seat or the bolster's end disc (Andrup: plain bouclé)
  const welts = P.piping !== false;
  if (welts) inner.add(K.partMesh(slabSeam(seatOut, seatH, rT, 0.0035, q), ms.pipe, ms.pipePart));
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
  if (welts) {
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

/**
 * Samples a plan path like samplePath(), but spaced by length in (plan, height) space, so the band gets more sections
 * where its top or bottom changes fast (a wing's front edge, a shell's underside). edge(x, z) → [top, bottom, …more
 * weights]: every value's change adds to the spacing length; endLen: cosine-packed samples toward both ends (domed
 * ends). Returns { L, samples: [{ x, z, tx, tz, s }] } (s = plan length).
 */
function wingSamples(fn, n, endLen, endN, edge) {
  const N = 900;
  const pts = [], cp = [0], cw = [0];
  for (let i = 0; i <= N; i++) {
    const [x, z] = fn(i / N);
    pts.push([x, z, ...edge(x, z)]);
  }
  for (let i = 1; i <= N; i++) {
    const ds = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let dv = 0;
    for (let k = 2; k < pts[i].length; k++) dv += Math.abs(pts[i][k] - pts[i - 1][k]);
    cp.push(cp[i - 1] + ds);
    cw.push(cw[i - 1] + Math.hypot(ds, dv));
  }
  const L = cp[N], W = cw[N];
  const e = clamp(endLen, 0.002, L * 0.3);
  const S = [e, L - e];
  for (let k = 0; k < endN; k++) {
    const c = e * (1 - Math.cos((Math.PI / 2) * (k / endN)));
    S.push(c, L - c);
  }
  const m = Math.max(4, Math.round(n));
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const wv = (W * k) / m;
    while (j < N - 1 && cw[j + 1] < wv) j++;
    const s = lerp(cp[j], cp[j + 1], clamp((wv - cw[j]) / (cw[j + 1] - cw[j] || 1e-9), 0, 1));
    if (s > e && s < L - e) S.push(s);
  }
  S.sort((a, b) => a - b);
  const U = S.filter((s, i) => i === 0 || s - S[i - 1] > 1e-4);
  let seg = 0;
  // tangents from a short central difference (~±2 cm): a polyline path's corners would otherwise turn the sections
  // abruptly, creasing faces that stand far off the path (the inner face of a thick back round a tight corner)
  const wT = Math.max(1, Math.round((0.02 * N) / Math.max(1e-6, L)));
  const samples = U.map((s) => {
    while (seg < N - 1 && cp[seg + 1] < s) seg++;
    const a = pts[seg], b = pts[seg + 1];
    const f = clamp((s - cp[seg]) / (cp[seg + 1] - cp[seg] || 1e-9), 0, 1);
    const a2 = pts[Math.max(0, seg - wT)], b2 = pts[Math.min(N, seg + 1 + wT)];
    const tx = b2[0] - a2[0], tz = b2[1] - a2[1], tl = Math.hypot(tx, tz) || 1;
    return { x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f), tx: tx / tl, tz: tz / tl, s };
  });
  return { L, samples };
}

/**
 * Sculpted U band of a wing chair: one upholstered surface running arm → wing → back → wing → arm. Every plan sample
 * gets its own vertical section from y0 up to `top`, with the outer / inner face offsets (along the outward plan
 * normal) as functions of height – the arm bulb, the shelf where a wing stands on the arm, the wing, the back – and a
 * fully rounded top (radius = half the thickness there). Face points sit at the fixed heights `ys` (clamped into the
 * section), so the rows stay level from section to section whatever the top does along the wing's front edge. The
 * ends are domed in plan (capLen × half thickness). sec(sm) → { y0, top, out(y), inn(y), rb }; warp(p, sm) moves the
 * finished points (recline shear, taper / flare, front rounding).
 */
function wingBand(path, ys, { sec, warp, center, capLen = 1, nc = 4, nb = 2, steadyU = false }) {
  const { L, samples } = path;
  const inCap = [];
  const rows = samples.map((sm, si) => {
    let nx = sm.tz, nz = -sm.tx;
    if ((sm.x - center[0]) * nx + (sm.z - center[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const S = sec(sm);
    const yr = S.top - 0.05;
    const re = Math.max(0.005, (S.out(yr) - S.inn(yr)) / 2);
    const eLen = re * capLen;
    const dEnd = Math.min(sm.s, L - sm.s);
    const k = dEnd < eLen ? 1 - dEnd / eLen : 0;
    inCap[si] = k > 0 ? (sm.s <= L - sm.s ? -1 : 1) : 0;
    const f = Math.max(0.002, Math.sqrt(Math.max(0, 1 - k * k)));
    const O = (y) => {
      const o = S.out(y), i = S.inn(y);
      return (o + i) / 2 + ((o - i) / 2) * f;
    };
    const I = (y) => {
      const o = S.out(y), i = S.inn(y);
      return (o + i) / 2 - ((o - i) / 2) * f;
    };
    const y0 = S.y0;
    const top = Math.max(y0 + 0.012, S.top - re * (1 - f));
    let yT = top - Math.max(1e-4, (O(top) - I(top)) / 2);
    yT = top - Math.max(1e-4, (O(yT) - I(yT)) / 2);
    const rb = clamp(S.rb ?? 0.01, 1e-4, Math.max(1e-4, Math.min((O(y0) - I(y0)) * 0.45, (yT - y0) * 0.45)));
    const yB = y0 + rb;
    yT = Math.max(yT, yB + 1e-4);
    const oB = O(yB), iB = I(yB), mB = (oB + iB) / 2;
    const ac = (O(yT) + I(yT)) / 2, ar = Math.max(1e-4, (O(yT) - I(yT)) / 2);
    const loop = [];
    for (let j = 0; j < nb; j++) loop.push([lerp(mB, oB - rb, j / nb), y0]);
    for (let j = 0; j < nc; j++) {
      const p = -Math.PI / 2 + (Math.PI / 2) * (j / nc);
      loop.push([oB - rb + rb * Math.cos(p), yB + rb * Math.sin(p)]);
    }
    for (const y of ys) {
      const yy = clamp(y, yB, yT);
      loop.push([O(yy), yy]);
    }
    for (let j = 1; j < 2 * nc; j++) {
      const p = (Math.PI * j) / (2 * nc);
      loop.push([ac + ar * Math.cos(p), yT + ar * Math.sin(p)]);
    }
    for (let i = ys.length - 1; i >= 0; i--) {
      const yy = clamp(ys[i], yB, yT);
      loop.push([I(yy), yy]);
    }
    for (let j = 1; j <= nc; j++) {
      const p = Math.PI + (Math.PI / 2) * (j / nc);
      loop.push([iB + rb + rb * Math.cos(p), yB + rb * Math.sin(p)]);
    }
    for (let j = 1; j < nb; j++) loop.push([lerp(iB + rb, mB, j / nb), y0]);
    return loop.map(([a, y]) => warp([sm.x + nx * a, y, sm.z + nz * a], sm));
  });
  // never fold: along each side every row must keep running back (right side, path start) / forward (left side) –
  // a strong recline shear low down could otherwise push rear sections past the front ones
  const n = rows.length, m = rows[0].length, half = Math.floor(n / 2);
  for (let j = 0; j < m; j++) {
    for (let i = 1; i <= half; i++) if (rows[i][j][2] > rows[i - 1][j][2]) rows[i][j][2] = rows[i - 1][j][2];
    for (let i = n - 2; i >= half; i--) if (rows[i][j][2] > rows[i + 1][j][2]) rows[i][j][2] = rows[i + 1][j][2];
  }
  // the domed ends (the arm fronts) take u round the section from their base row: no texture streaks where the
  // section shrinks to a line
  let i0 = 0, i1 = n - 1;
  while (i0 < n - 1 && inCap[i0] === -1) i0++;
  while (i1 > i0 && inCap[i1] === 1) i1--;
  const strips = [];
  if (i0 > 0) strips.push({ rows: rows.slice(0, i0 + 1), uv: 'grid', uRow: i0 });
  strips.push({ rows: rows.slice(i0, i1 + 1), uv: 'grid' });
  if (i1 < n - 1) strips.push({ rows: rows.slice(i1), uv: 'grid', uRow: 0 });
  const geo = stripsGeometry(strips);
  if (!steadyU) return geo;
  // steady u: measured from the bottom up the outer face, and from the loop's other end up the inner face, so
  // neighbouring sections of different height (a wing's front edge, a dipped top) do not shear the texture into
  // streaks; the top cap takes up the difference to a loop length smoothed along the band
  const c0 = nb + nc + ys.length, c1 = c0 + 2 * nc - 2; // first / last point of the top cap
  const arc = rows.map((r) => {
    const a = [0];
    for (let j = 1; j <= m; j++) {
      const p = r[j % m], o = r[j - 1];
      a.push(a[j - 1] + Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]));
    }
    return a;
  });
  const Ls = samples.map((sm) => {
    let s = 0, w = 0;
    for (let k = 0; k < n; k++) {
      const wt = 1 - Math.abs(samples[k].s - sm.s) / 0.12;
      if (wt > 0) {
        s += arc[k][m] * wt;
        w += wt;
      }
    }
    return s / w;
  });
  const uOf = (i, j) => {
    const a = arc[i], Lt = a[m];
    if (j < c0) return a[j];
    if (j > c1) return Ls[i] - (Lt - a[j]);
    const t = (a[j] - a[c0 - 1]) / Math.max(1e-9, a[c1 + 1] - a[c0 - 1]);
    return lerp(a[c0 - 1], Ls[i] - (Lt - a[c1 + 1]), t);
  };
  const uv = geo.attributes.uv.array;
  let base = 0;
  const fill = (from, to, ref) => {
    for (let i = from; i <= to; i++, base++) for (let j = 0; j <= m; j++) uv[(base * (m + 1) + j) * 2] = uOf(ref ?? i, j);
  };
  if (i0 > 0) fill(0, i0, i0);
  fill(i0, i1);
  if (i1 < n - 1) fill(i1, n - 1, i1);
  geo.attributes.uv.needsUpdate = true;
  return geo;
}

/** Flattened fabric button of radius r (shared geometry). */
function wingButton(r, q) {
  return K.sharedGeometry(`wing-button-${Math.round(r * 1000)}-${q < 1 ? 0 : 1}`, () => {
    const s = K.sphere(r, { wSeg: q < 1 ? 10 : 14, hSeg: q < 1 ? 5 : 7 });
    s.scale(1, 1, 0.38);
    return s;
  });
}

/**
 * Wing chair footstool: 'box' = a crisp lidded box (STRANDMON: straight sides, a lid with welts on its top edge and
 * at the lid seam, short tapered legs); otherwise the shared pouf (addFootstool). Returns its collider.
 */
function wingStool(g, spec, ms, style, { w, d, h, z, q, box }) {
  if (!box) return addFootstool(g, spec, ms, style, { w, d, h, z, q });
  const fs = new THREE.Group();
  fs.position.z = z;
  g.add(fs);
  const legH = clamp(num(spec.params.stoolLegH, 0.1), 0.03, h * 0.5);
  const bodyH = h - legH;
  const lidH = Math.min(0.075, bodyH * 0.3);
  const baseH = bodyH - lidH + 0.004;
  fs.add(K.partMesh(softBox(w - 0.008, baseH, d - 0.008, 'y', { puff: 0.015, round: 0.12, sides: 0.03, top: 0, bottom: 0, q }), ms.up, 'upholstery', { position: [0, legH + baseH / 2, 0] }));
  addCushion(fs, ms, softBox(w, lidH, d, 'y', { puff: 0.08, round: 0.45, sides: 0.05, bottom: 0, q }), [0, h - lidH / 2, 0], ['top', 'bottom'], q);
  const r = clamp(0.012 + legH * 0.08, 0.016, 0.024);
  fourLegs(fs, ms, style, { ax: w / 2 - 0.055, az0: -d / 2 + 0.055, az1: d / 2 - 0.055, topY: legH + 0.004, q, rTop: r, rBot: r * 0.62, splayX: 3, splayF: 3, splayB: 3 });
  return { min: [-w / 2, 0, z - d / 2], max: [w / 2, h, z + d / 2] };
}

/**
 * Rounds the corners of a 2D polyline [[a, b], …] with radii[i] (0 / the ends: sharp), each arc in n steps; fillets
 * that would overlap on a segment are shrunk to share it. Returns { pts, arcs: [[i0, i1] per rounded corner] }
 * (index ranges into pts).
 */
function filletPolyline(src, radii, n = 8) {
  const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9;
  const m = src.length;
  const dir = (i) => [(src[i + 1][0] - src[i][0]) / len(src[i], src[i + 1]), (src[i + 1][1] - src[i][1]) / len(src[i], src[i + 1])];
  const phi = src.map((p, i) => {
    if (i === 0 || i === m - 1 || !(radii[i] > 0)) return 0;
    const u = dir(i - 1), v = dir(i);
    return Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1));
  });
  const tl = phi.map((f, i) => (f > 1e-4 ? radii[i] * Math.tan(f / 2) : 0));
  for (let i = 0; i < m - 1; i++) {
    const L = len(src[i], src[i + 1]), s = tl[i] + tl[i + 1];
    if (s > L * 0.98) {
      tl[i] *= (L * 0.98) / s;
      tl[i + 1] *= (L * 0.98) / s;
    }
  }
  const pts = [src[0]], arcs = [];
  for (let i = 1; i < m - 1; i++) {
    if (!(tl[i] > 1e-5)) {
      pts.push(src[i]);
      continue;
    }
    const u = dir(i - 1), v = dir(i), p = src[i];
    const r = tl[i] / Math.tan(phi[i] / 2);
    const s = u[0] * v[1] - u[1] * v[0] > 0 ? 1 : -1;
    const T1 = [p[0] - u[0] * tl[i], p[1] - u[1] * tl[i]];
    const C = [T1[0] - s * u[1] * r, T1[1] + s * u[0] * r];
    const a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    const i0 = pts.length;
    for (let k = 0; k <= n; k++) {
      const a = a0 + (s * phi[i] * k) / n;
      pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]);
    }
    arcs.push([i0, pts.length - 1]);
  }
  pts.push(src[m - 1]);
  return { pts, arcs };
}

/** Wing chair legs: like fourLegs, but the back pair may stand further in (axB) than the front pair (axF). */
function wingLegs(g, ms, style, { axF, axB, az0, az1, topY, q, rTop, rBot, splayX = 4, splayF = 6, splayB = 8, square }) {
  if (Math.abs(axF - axB) < 1e-4) {
    fourLegs(g, ms, style, { ax: axF, az0, az1, topY, q, rTop, rBot, splayX, splayF, splayB, square });
    return;
  }
  const wood = kindGroup(ms.legKind) === 'wood';
  const m = ms.legs(square ? undefined : { grain: 'v' });
  const seg = Math.max(6, Math.round((wood ? 12 : 10) * q));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = sz > 0 ? az1 : az0, ax = sz > 0 ? axF : axB;
      const dx = Math.tan(splayX * DEG) * topY * sx;
      const dz = Math.tan((sz > 0 ? splayF : splayB) * DEG) * topY * sz;
      addLeg(g, m, 'legs', [sx * ax, topY, z], [sx * ax + dx, 0, z + dz], rTop, rBot, { seg, square });
    }
  }
}

/**
 * Wing chair. One sculpted band (wingBand) runs arm → wing → back → wing → arm, so the wings rise out of the arms and
 * curve round into the back without a seam. The wing's front edge is concave: it leaves the arm top almost level at
 * wingJoin and sweeps up ever steeper to the ear at full height (wingEar), leaning back with the back (recline shear).
 *   body       'classic' (legs, front rail, cushion) | 'shell' (egg shell on a swivel star: V-shaped from the front,
 *              underside curving up to the arm fronts, tight seat with a welt)
 *   armStyle   'slim' (straight padded arm, round top) | 'tulip' (body narrows to the legs, the arm top a round bulb
 *              and the wing standing on its inner part: a shelf outside) | 'scroll' (English roll arm on a panel)
 *   wingEar / wingJoin / wingCurve / earR   ear front at the top and where the edge meets the arm (fractions of d
 *              from the rear), edge exponent (1 straight, 2–3 concave, higher = steeper ear), ear corner rounding
 *   wingLean   0..1: how far the edge leans back with the back (0 = upright ears); wingT wing thickness
 *   wingW / topRound / topDip / waist   width over the ears (fraction of w), front-view top corner radius, dip of the
 *              back's top between the ears, pinch of the wings just above the arms
 *   taper / taperPow   how far each side draws in toward the underside (m) and how fast
 *   shelf / shelfH / wallT / armDrop / armNose / armCap / armSplay   outer step from the arm to the wing, its height,
 *              side wall under the arm pad, arm top lower at the wing, shell arm front roll-over, plan rounding of the
 *              arm fronts, arms opening outward toward the front
 *   rollR / rollOver / panelT / earRoll   scroll arms: roll radius, overhang, panel thickness; ear scrolls
 *   backDeg / backCurve / backBow / backRound / backT / backTBot / backCorner   outer back recline at the top, forward
 *              curve toward the underside, convexity, rear-bottom rounding, thickness at the top / seat, plan corner
 *   underRise / underLen   shell: the sides' underside sweeping up to the arm fronts
 *   seatD / seatOver / cushT / piping ('both') / railIn / railBow / railWelt / padTop / padPow   seat depth (a tight
 *              inner back pad fills what the back does not), cushion proud of the arms, front rail
 *   buttons + buttonRows/Cols/Y/R/Gap; backTuft (+ tuftY/tuftW); backSeams (+ seamY); rearSeam
 *   headrest   neck pillow (pillowW/H/Drop); legInsetF/B/X, legR, legTaper, splayX/F/B; starR, baseZ;
 *   footstool + stoolStyle 'box' (stoolW/D/H, stoolLegH)
 */
function buildWingback(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const q = qf(spec);
  const shell = P.body === 'shell';
  const style = P.legStyle || (shell ? 'swivel-star' : 'wood-taper');
  const ms = materials(spec, style);
  const g = new THREE.Group();
  const seatH = clamp(num(P.seatH, 0.45), 0.32, h - 0.3);
  const armH = clamp(num(P.armH, 0.62), seatH + 0.08, h - 0.2);
  const armW = clamp(num(P.armW, 0.1), 0.06, w * 0.22);
  const legH = clamp(num(P.legH, legHeightFor(style, 0.2)), 0.02, seatH - 0.18);
  const loose = P.cushion === 'loose';
  const arm = shell ? 'shell' : ['slim', 'tulip', 'scroll'].includes(P.armStyle) ? P.armStyle : armW >= 0.12 ? 'scroll' : 'slim';
  const scroll = arm === 'scroll';
  const buttons = P.buttons ?? loose;
  const zr = -d / 2, zf = d / 2;
  const cushT = clamp(num(P.cushT, shell ? 0.1 : loose ? 0.11 : 0.08), 0.05, 0.18);
  const deckTop = seatH - cushT;
  const yb = legH; // underside of the body
  const seatOver = clamp(num(P.seatOver, 0), 0, 0.06);
  const zA = zf - seatOver; // arm fronts (a loose cushion may stand proud of them)

  // --- back: outer surface z(y) – reclined by backDeg at the top, curving forward toward the underside (backCurve ×
  // depth², the convex back of a mid-century wing chair), rounded into the underside (backRound) – and a thickness
  // from backTBot (at the seat) to backT (at the top)
  const rec = clamp(num(P.backDeg, shell ? 15 : 12), 0, 30) * DEG;
  const curve = clamp(num(P.backCurve, 0), 0, 0.8);
  const TbTop = clamp(num(P.backT, 0.12), 0.07, 0.2);
  const TbBot = clamp(num(P.backTBot, TbTop), 0.07, 0.3);
  const Tb = (y) => lerp(TbBot, TbTop, sstep(seatH, h - 0.1, y));
  const rBot = clamp(num(P.backRound, shell ? 0.18 : 0.06), 0.01, (h - yb) * 0.4);
  const bow = clamp(num(P.backBow, 0.012), 0, 0.05);
  const zOut = (y) => {
    const t = clamp((y - yb) / (h - yb), 0, 1);
    const u = clamp((yb + rBot - y) / rBot, 0, 1);
    return Math.max(zr, zr + (h - y) * Math.tan(rec) + curve * (h - y) ** 2 - bow * Math.sin(Math.PI * t)) + rBot * (1 - Math.sqrt(1 - u * u));
  };
  const zInB = (y) => zOut(y) + Tb(y); // the band's inner back face
  // how far the back's centre line (and with it the rear of the sides) has come forward at height y
  const shear = (y) => zOut(y) + Tb(y) / 2 - zr - TbTop / 2;

  // --- sides: arm part (thickness tArm, round top) and wing (Tw) standing on it, before taper / flare
  const rr = scroll ? clamp(num(P.rollR, armW * 0.42), 0.035, 0.08) : 0;
  const over = scroll ? clamp(num(P.rollOver, 0.03), 0, rr) : 0;
  const tArm = scroll ? clamp(num(P.panelT, 0.08), 0.05, 0.14) : armW;
  const Tw = clamp(num(P.wingT, 0.07), 0.04, tArm);
  const xArm = w / 2 - over;
  const shelf = clamp(num(P.shelf, arm === 'tulip' ? tArm - Tw : 0), 0, tArm - 0.03);
  const yArmTop = scroll ? armH - rr : armH;
  const rA = tArm / 2;
  const yS0 = yArmTop - rA, yS1 = yArmTop + 0.012;
  // arm → wing over shelfH: the outer face steps in by `shelf` and the thickness eases from tArm to Tw
  const shelfH = clamp(num(P.shelfH, 0.1), 0.02, 0.3);
  const sW = (y) => sstep(yArmTop - rA * 0.5, yArmTop + shelfH, y);
  // shelfRound (tulip arms): the wing stands on the arm like a panel on a bolster – behind the join the side keeps
  // the arm's round top and meets the wing's faces in small concave fillets, instead of the straight shelf slope
  const shelfRound = P.shelfRound === true && arm === 'tulip';
  // (capTop: the arm top at the join, set below once armDrop is known)
  let capTop = yArmTop, ycA = yArmTop - rA;
  const xcA = xArm - rA, xWo = xArm - shelf, xWi = xArm - shelf - Tw;
  const capX = (y) => (y <= ycA ? rA : y <= capTop ? Math.sqrt(Math.max(0, rA * rA - (y - ycA) ** 2)) : -(y - capTop) * 4);
  const smaxP = (a, b, k) => {
    const t = clamp(0.5 + (0.5 * (a - b)) / k, 0, 1);
    return lerp(b, a, t) + k * t * (1 - t);
  };
  const outPlain = (y) => xArm - shelf * sW(y);
  const out = (y) => (shelfRound ? (y <= ycA ? xArm : smaxP(xcA + capX(y), xWo, 0.035)) : outPlain(y));
  // below its round top the arm may thin to a side wall (wallT): a thick pad over a wide seat (Bella)
  const wallT = clamp(num(P.wallT, tArm), 0.04, tArm);
  const tSide = (y) => lerp(lerp(wallT, tArm, sstep(yArmTop - tArm * 1.7, yArmTop - tArm * 0.45, y)), Tw, sW(y));
  const innPlain = (y) => outPlain(y) - tSide(y);
  const inn = (y) => (shelfRound ? lerp(xArm - tArm, -smaxP(-(xcA - capX(y)), -xWi, 0.025), sstep(ycA - 0.03, ycA + 0.01, y)) : innPlain(y));
  // taper below the arms (the body draws in toward the legs / the star) and flare above them, as an x-scale
  const taper = clamp(num(P.taper, arm === 'tulip' ? 0.07 : shell ? 0.15 : scroll ? 0.05 : 0), 0, xArm * 0.6);
  const taperPow = clamp(num(P.taperPow, shell ? 1.7 : 1.2), 0.5, 3);
  const taperAt = (y) => taper * Math.pow(clamp((yS0 - y) / Math.max(0.05, yS0 - yb), 0, 1), taperPow);
  // (above 1: ears wider than the arms behind them – with armSplay the sides behind the arm fronts are drawn in)
  const wingW = clamp(num(P.wingW, scroll ? 0.97 : shell ? 1 : 0.93), 0.6, 1.15);
  const flareK = (w / 2) * wingW / Math.max(0.1, xArm - shelf) - 1;
  const waist = clamp(num(P.waist, 0), 0, 0.06);
  const xTop = (w / 2) * wingW;
  const rTop = clamp(num(P.topRound, 0.05), 0, Math.min(0.15, (h - armH) * 0.4)); // top corners seen from the front
  // flarePow: how the flare is spread over the height above the arms (higher = kept for the top: a fan-shaped back
  // with a concave waist just above the arms)
  const flarePow = clamp(num(P.flarePow, 1.3), 0.5, 5);
  const sx = (y) => {
    if (y < yS1) return 1 - taperAt(y) / xArm;
    const t = clamp((y - yS1) / (h - yS1), 0, 1);
    // (the waist eases in and out with zero slope: no notch where it ends)
    return 1 + flareK * Math.pow(t, flarePow) - (waist / xArm) * Math.sin(Math.PI * Math.min(1, t * 1.5)) ** 2 - cornerCut(y, h, rTop) / xTop;
  };

  // --- plan path: sides at ±hx from the arm fronts back to the corners, the back at zbP (at the top)
  const hx = xArm - tArm / 2;
  const zbP = zr + TbTop / 2;
  const rc = clamp(num(P.backCorner, shell ? 0.14 : 0.1), Math.max(TbTop, TbBot) / 2 + 0.03, hx * 0.6);
  const zCornerN = zbP + rc;
  // wing front edge (nominal z: the shear brings the lower part forward with the back)
  const armDrop = scroll ? 0 : clamp(num(P.armDrop, 0.02), 0, 0.08);
  const zJoinF = zr + d * clamp(num(P.wingJoin, shell ? 0.45 : scroll ? 0.5 : 0.48), 0.25, 0.8);
  // wingLean: how far the wing edge leans back with the back (1: the shear runs on to the arm fronts; 0: it fades out
  // between the back corner and the ear, so the ear stands upright – STRANDMON)
  const wLean = clamp(num(P.wingLean, 1), 0, 1);
  // (a filleted edge may start on the back corner's arc: a shallow ear on a well-rounded back, and run down almost
  // upright – the shear then leans it with the back)
  const filleted = num(P.wingFillet, 0) > 0;
  const zJoinN = Math.max(filleted ? zbP + 0.09 : zCornerN + 0.08, zJoinF - shear(yArmTop - armDrop) * wLean);
  const zEarN = clamp(zr + d * clamp(num(P.wingEar, shell ? 0.27 : scroll ? 0.44 : 0.3), 0.15, 0.7), filleted ? zbP + 0.06 : zCornerN + 0.02, zJoinN - (filleted ? 0.015 : 0.03));
  const wCurve = clamp(num(P.wingCurve, scroll ? 4 : 2.6), 1, 8);
  const kEar = clamp(num(P.earR, scroll ? 0.05 : 0.07), 0.01, 0.2);
  const dip = clamp(num(P.topDip, 0), 0, 0.06);
  // arm top: a little lower where it meets the wing; a shell arm rolls down over its front (armNose radius)
  const nose = clamp(num(P.armNose, shell ? 0.1 : 0), 0, 0.2);
  const armTop = (z) => {
    const u = nose > 0 ? clamp((z - (zA - nose)) / nose, 0, 1) : 0;
    return yArmTop - armDrop * (1 - sstep(zJoinN, zA, z)) - nose * (1 - Math.sqrt(1 - u * u));
  };
  const yJ = armTop(zJoinN);
  if (shelfRound) {
    capTop = yJ;
    ycA = yJ - rA;
  }
  // wingFillet > 0: the wing's front edge runs straight from the ear (zEarN, top) down to the join on the arm
  // (zJoinN), its top corner rounded by earR and its foot run into the arm top by a concave fillet of radius
  // wingFillet, and the edge is a rounded lip (radius lipR) instead of a flat cut. 0: the power curve (wingCurve).
  const rF = clamp(num(P.wingFillet, 0), 0, 0.3);
  const lipR = clamp(num(P.lipR, Tw * 0.5), 0.005, 0.1);
  let topLine = null, edgeLine = null;
  if (rF > 0) {
    const zJ = Math.max(zJoinN, zEarN + 0.01);
    const zN = zJ + Math.max(0.03, Math.min(0.25, (zA - zJ) * 0.8));
    const { pts, arcs } = filletPolyline([[zbP, h], [zEarN, h], [zJ, yJ], [zN, armTop(zN)]], [0, kEar, rF, 0], 12);
    // the fillet's foot lands on the chord to zN: ease it onto the arm top itself
    const [c0, c1] = arcs[arcs.length - 1];
    const za = pts[c0][0], zb = pts[c1][0], dy = armTop(zb) - pts[c1][1];
    for (let i = c0; i <= c1; i++) pts[i][1] += dy * sstep(za, zb, pts[i][0]);
    topLine = pts.slice(0, c1 + 1);
    const e = pts.slice(arcs[0][0], c1 + 1); // the edge, from the top corner down: y falling, z rising
    edgeLine = e.map((p, i) => {
      const a = e[Math.max(0, i - 1)], b = e[Math.min(e.length - 1, i + 1)];
      return { z: p[0], y: p[1], v: Math.abs(b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) };
    });
  }
  const lineAt = (L, x, key, val) => {
    // linear interpolation in a monotonic polyline: the entry where L[i][key] crosses x
    const inc = L[L.length - 1][key] > L[0][key];
    let i = 1;
    while (i < L.length - 1 && (inc ? L[i][key] < x : L[i][key] > x)) i++;
    const a = L[i - 1], b = L[i];
    const f = clamp((x - a[key]) / (b[key] - a[key] || 1e-9), 0, 1);
    return val(a, b, f);
  };
  const sideTop = (z) => {
    if (topLine) {
      if (z >= topLine[topLine.length - 1][0]) return armTop(z);
      return lineAt(topLine, z, 0, (a, b, f) => lerp(a[1], b[1], f));
    }
    if (z >= zJoinN) return armTop(z);
    const t = (zJoinN - z) / Math.max(0.02, zJoinN - zEarN);
    const c = yJ + (h - yJ) * Math.pow(t, wCurve);
    const b = h + kEar * 0.5;
    return Math.min(h, 0.5 * (c + b - Math.sqrt((c - b) ** 2 + kEar * kEar)));
  };
  // the lip: a side section close behind the edge thins toward it (round in plan) where the edge is steep
  const yLipLow = edgeLine ? edgeLine[edgeLine.length - 1].y : 0;
  const lip = (z, y) => {
    if (!edgeLine || y <= yLipLow || y > h) return 1;
    const e = lineAt(edgeLine, y, 'y', (a, b, f) => [lerp(a.z, b.z, f), lerp(a.v, b.v, f)]);
    const dz = e[0] - z;
    if (dz >= lipR) return 1;
    const k = 1 - Math.max(0, dz) / lipR;
    // (eased out toward the fillet's foot, where the wing widens into the arm)
    return lerp(1, Math.max(0.2, Math.sqrt(Math.max(0, 1 - k * k))), e[1] * sstep(yJ + rF * 0.15, yJ + rF * 0.9, y));
  };
  const zLip0 = edgeLine ? edgeLine[0].z - lipR : 0, zLip1 = edgeLine ? edgeLine[edgeLine.length - 1].z : 0;
  // (the dip meets the ears with zero slope: no shoulders where it ends)
  const backTop = (x) => h - dip * (1 - Math.min(1, (x / Math.max(0.05, hx - rc * 0.5)) ** 2)) ** 2;
  // underside of the sides: a short rounding at the arm fronts (classic) or the shell's big sweep up to the arms
  const uRise = clamp(num(P.underRise, shell ? seatH - 0.07 - yb : 0.025), 0, armH - yb - 0.05);
  const uLen = clamp(num(P.underLen, shell ? (zA - zJoinN) * 0.95 : 0.05), 0.01, zA - zCornerN);
  const under = (z) => {
    const u = clamp((z - (zA - uLen)) / uLen, 0, 1);
    return yb + uRise * (1 - Math.sqrt(1 - u * u));
  };
  // (a lip packs the side sections behind the edge closer)
  const lipW = (z) => (edgeLine ? 1.5 * clamp(z, zLip0, zLip1) : 0);
  const cornerTop = (x, z) => (edgeLine && z > zbP + 0.005 ? Math.min(backTop(x), sideTop(z)) : backTop(x));
  // (… and a band dimple packs the back sections across it)
  const dimW = (x, z) => (bandDimple && z < zCornerN ? 1.2 * clamp(x, -tuftHalf * 1.4, tuftHalf * 1.4) : 0);
  const edge = (x, z) => (z > zCornerN ? [sideTop(z), under(z), lipW(z), 0] : [cornerTop(x, z), yb, lipW(z), dimW(x, z)]);
  const zR0 = lerp(zCornerN, zJoinN, wLean), zR1 = Math.max(zR0 + 0.05, lerp(zEarN, zA, wLean));
  const lenF = zR1 - zR0;
  // (the linear part eased in and out over its first / last quarter: no crease down the sides where it starts)
  const easeLin = (t) => {
    const k = 0.25;
    t = clamp(t, 0, 1);
    const E = t < k ? (t * t) / (2 * k) : t > 1 - k ? 1 - k - ((1 - t) ** 2) / (2 * k) : t - k / 2;
    return E / (1 - k);
  };
  // (where the shear is large – low down on a well-rounded back – the fade is lengthened so it cannot fold the side)
  const rampW = (z, y) => {
    const L = y == null ? lenF : clamp(2 * shear(y), lenF, Math.max(lenF, zA - zR0));
    return 1 - (0.5 * easeLin((z - zR0) / L) + 0.5 * sstep(zR0, zR0 + L, z));
  };
  // below the arms the back's lean and rounded bottom (a large shear) fade out over the whole side, back corner to arm
  // front – a short fade would crease or fold the lower sides
  const rampLow = (z) => 1 - easeLin((z - zCornerN) / Math.max(0.05, zA - zCornerN));
  const ramp = (z, y) => (y == null ? rampW(z) : lerp(rampLow(z), rampW(z, y), sstep(yArmTop - 0.22, yArmTop - 0.02, y)));
  // armSplay: the arms open outward toward their fronts (STRANDMON) – everything behind them is drawn in instead
  const splayK = clamp(num(P.armSplay, 0), 0, 0.08) / xArm;
  const spl = (z) => 1 - splayK * (1 - sstep(zJoinN - 0.05, zA, z));
  const innXz = (y, z) => inn(y) * sx(y) * spl(z); // inner face of the sides at height y, plan z (nominal)
  const innX = (y) => innXz(y, zr); // … at the back
  const warp = ([x, y, z], sm) => [x * sx(y) * spl(sm.z), y, z + shear(y) * ramp(sm.z, y)];
  const hug = P.cornerHug === true;
  // inner back pad (built after the band): how far it stands proud of the band's inner back
  const zSeatF = zf; // front of the seat
  const padSeat = P.seatD != null ? Math.max(0, zSeatF - clamp(num(P.seatD, 0.5), 0.35, 0.75) - zInB(seatH)) : 0;
  const padTop = clamp(num(P.padTop, 0), 0, 0.15);
  const padPow = clamp(num(P.padPow, 1), 0.4, 3);
  const pad = (y) => lerp(padSeat, padTop, Math.pow(clamp((y - seatH) / Math.max(0.1, h - 0.1 - seatH), 0, 1), padPow));
  const hasPad = padSeat > 0.012 || padTop > 0.012;
  const crown = hasPad ? 0.008 : 0;
  const backFront = (y) => zInB(y) + (hasPad ? pad(y) : 0);
  // backTuft + tuftD: the tuft pulls the inner back in (a dimple along the seam) – the pad's face, or without a pad
  // the band's own inner back; padR: the pad's front corners
  const tuftD = P.backTuft ? clamp(num(P.tuftD, 0), 0, 0.04) : 0;
  const yTuft = seatH + (h - seatH) * clamp(num(P.tuftY, 0.66), 0.3, 0.9), tuftHalf = clamp(num(P.tuftW, 0.1), 0.03, 0.2);
  const dimple = (x, y) => (tuftD ? tuftD * Math.exp(-(((y - yTuft) / 0.03) ** 2)) * Math.exp(-((x / (tuftHalf * 1.25)) ** 4)) : 0);
  const bandDimple = tuftD > 0 && !hasPad;
  const sec = (sm) => {
    const wB = sstep(0, 1, Math.abs(sm.tx));
    const side = sm.z > zCornerN;
    // (shelfRound shapes only the sections behind the join: the arm's own sections keep the plain arm)
    // (blended over a short run, so there is no crease where the wing's sections hand over to the arm's)
    const zH = edgeLine ? zLip1 : zJoinN;
    const kA = shelfRound ? sstep(zH - 0.06, zH + 0.02, sm.z) : 0;
    const oF = kA > 0 ? (y) => lerp(out(y), outPlain(y), kA) : out, iF = kA > 0 ? (y) => lerp(inn(y), innPlain(y), kA) : inn;
    const oRaw = (y) => lerp(oF(y) - hx, Tb(y) / 2, wB);
    const dm = bandDimple && !side ? wB : 0;
    const i = (y) => lerp(iF(y) - hx, -Tb(y) / 2, wB) + (dm ? dm * dimple(sm.x, y) : 0);
    // cornerHug: round a back corner the side's outer face cannot bulge past (seen from the front, the thicker back
    // otherwise sticks out beside a thin, inset wing as a hood)
    let cosA = 1;
    if (hug && sm.z < zCornerN && Math.abs(sm.x) > hx - rc) cosA = clamp((Math.abs(sm.x) - (hx - rc)) / rc, 0.05, 1);
    // (the excess over the bound is eased off: untouched where there is none, so no step where the corner starts)
    const ease = (t, k = 0.016) => (t <= 0 ? 0 : t < k ? (t * t) / (2 * k) : t - k / 2);
    const o = cosA < 0.999 ? (y) => oRaw(y) - ease(oRaw(y) - ((rc + oF(y) - hx) / cosA - rc)) : oRaw;
    // (the lip fades out round the back corner's arc: no seam where it stops)
    const wL = 1 - sstep(0.15, 0.6, Math.abs(sm.tx));
    const lp = edgeLine && sm.z > zLip0 - 0.01 && sm.z < zLip1 && wL > 0;
    const lipW = (y) => lerp(1, lip(sm.z, y), wL);
    return {
      y0: side ? under(sm.z) : yb,
      top: side ? sideTop(sm.z) : cornerTop(sm.x, sm.z),
      out: lp ? (y) => (o(y) + i(y)) / 2 + ((o(y) - i(y)) / 2) * lipW(y) : o,
      inn: lp ? (y) => (o(y) + i(y)) / 2 - ((o(y) - i(y)) / 2) * lipW(y) : i,
      rb: shell ? 0.03 : 0.015,
    };
  };
  const ys = [];
  const nY = Math.max(8, Math.round(15 * q));
  for (let i = 0; i <= nY; i++) ys.push(lerp(yb - 0.002, h + 0.002, i / nY));
  const nA = Math.max(3, Math.round(6 * q));
  for (let i = 0; i <= nA; i++) ys.push(lerp(yArmTop - 0.13, yArmTop + 0.06, i / nA));
  if (shell) for (let i = 1; i < 4; i++) ys.push(yb + (uRise * i) / 4);
  if (bandDimple) for (const dy of [-0.06, -0.035, -0.015, 0, 0.015, 0.035, 0.06]) ys.push(yTuft + dy);
  if (edgeLine) {
    // rows through the fillet and the ear corner
    for (let i = 1; i <= 3; i++) ys.push(yJ + rF * (0.35 + 0.4 * i));
    for (let i = 1; i <= 2; i++) ys.push(h - (kEar * i) / 2);
  }
  ys.sort((a, b) => a - b);
  const Y = ys.filter((y, i) => i === 0 || y - ys[i - 1] > 0.006);
  const capLen = clamp(num(P.armCap, scroll ? 0.35 : 1), 0.1, 1);
  const path = wingSamples(uPath(hx, zA, zbP, rc), Math.round(90 * q), (tArm / 2) * capLen, 4, edge);
  g.add(K.partMesh(wingBand(path, Y, { sec, warp, center: [0, (zA + zbP) / 2], capLen, nc: q < 1 ? 3 : 4, steadyU: true }), ms.up, 'upholstery'));

  // --- inner back pad (tight): fills the band's inner back forward to the seat depth, tucked into the wings
  if (hasPad) {
    const y0p = deckTop - 0.03, y1p = h - TbTop * 0.5 - 0.03;
    const levels = [];
    const nL = Math.max(6, Math.round(12 * q));
    const padR = clamp(num(P.padR, 0.03), 0.01, 0.2);
    let yl = [];
    for (let i = 0; i <= nL; i++) yl.push(lerp(y0p, y1p, i / nL));
    if (tuftD) for (const dy of [-0.07, -0.045, -0.025, -0.01, 0, 0.01, 0.025, 0.045, 0.07]) if (yTuft + dy > y0p + 0.01 && yTuft + dy < y1p - 0.01) yl.push(yTuft + dy);
    yl.sort((a, b) => a - b);
    yl = yl.filter((y, i) => i === 0 || i === yl.length - 1 || (y - yl[i - 1] > 0.006 && yl[yl.length - 1] - y > 0.006));
    // padBulge: the pad is a bulge that fades into the band toward the wings (one continuous inner back) instead of
    // a box standing proud of it
    const bulge = P.padBulge === true;
    for (const y of yl) {
      // (a bulge stays on the band's flat inner back, clear of the rounded back corners)
      const hw = bulge ? Math.min(innX(y) + 0.012, (hx - rc) * sx(y) + 0.03) : innX(y) + 0.012;
      const pd = Math.max(0.004, pad(y));
      // a big front rounding (padR) needs a deeper pad: its back sinks further into the band (hidden)
      // (a bulge's rim lies just under the band's surface: it rises out of it without an edge)
      const zB = zInB(y) - (padR > 0.03 ? Math.max(0.035, Tb(y) * 0.6) : 0.035), zF = zInB(y) + (bulge ? -0.004 : pd);
      const bf = bulge ? (x) => Math.max(0, pad(y)) * (1 - sstep(hw * 0.35, hw * 0.97, Math.abs(x))) : () => 0;
      levels.push({ y, loop: rrLoop(hw, zB, zF, Math.min(padR, (zF - zB) * 0.45), padR > 0.03 ? 0.04 : 0.02, { nx: tuftD || bulge ? 20 : 12, nArc: padR > 0.03 ? 6 : 4, nSide: 2, front: (x) => crown * (1 - (x / hw) ** 2) - dimple(x, y) + bf(x) }) });
    }
    g.add(K.partMesh(loftGeometry(levels, { top: Math.min(0.025, (Math.max(0.004, pad(y1p)) + 0.035) * 0.45), bottom: 0.005, nEdge: 3, nCap: 2 }), ms.up, 'upholstery'));
  }

  // --- deck / hull: fills between the sides from the underside to under the seat
  {
    // the sides' underside reaches height y at this nominal z (inverse of under())
    const underZ = (y) => {
      if (uRise <= 0 || y >= yb + uRise) return zA;
      const v = clamp(1 - (y - yb) / uRise, 0, 1);
      return zA - uLen + uLen * Math.sqrt(Math.max(0, 1 - v * v));
    };
    const railIn = clamp(num(P.railIn, shell ? 0.015 : 0.012), 0, 0.08);
    const bowF = clamp(num(P.railBow, 0), 0, 0.05);
    const yd0 = yb + (shell ? 0.045 : 0.004), yd1 = deckTop + 0.01;
    const levels = [];
    const nL = shell ? Math.max(5, Math.round(9 * q)) : 3;
    for (let i = 0; i <= nL; i++) {
      const y = lerp(yd0, yd1, shell ? 1 - (1 - i / nL) ** 1.5 : i / nL);
      const hw = innXz(y, zA) + 0.015;
      const zN = underZ(y);
      const zF = shell ? zN + shear(y) * ramp(zN, y) - 0.004 : zA - railIn;
      const zB = Math.min(zF - 0.06, zInB(y) - 0.03);
      levels.push({ y, loop: rrLoop(hw, zB, zF, Math.min(shell ? 0.06 : 0.025, hw * 0.5), 0.02, { nx: 12, nArc: 4, nSide: 2, front: bowF ? (x) => bowF * (1 - (x / hw) ** 2) : null }) });
    }
    g.add(K.partMesh(loftGeometry(levels, { top: 0.01, bottom: shell ? 0.03 : 0.012, nEdge: 3, nCap: 2 }), ms.up, 'upholstery'));
    if (P.railWelt) {
      // welt along the lower front edge of the rail
      const hw = innXz(yd0 + 0.02, zA) + 0.01, pts = [];
      for (let i = 0; i <= 12; i++) {
        const x = lerp(-hw, hw, i / 12);
        pts.push(new THREE.Vector3(x, yd0 + 0.012, zA - railIn + bowF * (1 - (x / hw) ** 2) + 0.002));
      }
      g.add(K.partMesh(seamTube(pts, 0.0042, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
    }
  }

  // --- seat
  const zSB = backFront(seatH - cushT / 2) - 0.015;
  const sw = 2 * Math.min(innXz(deckTop + 0.01, zA - 0.12), innXz(seatH, zA - 0.12)) - 0.004;
  if (shell) {
    const outline = rrOutline(-sw / 2, sw / 2, zSB, zA - 0.004, 0.03, Math.min(0.08, sw * 0.2), 6, 4, (x) => 0.01 * (1 - (x / (sw / 2)) ** 2));
    g.add(K.partMesh(slabGeometry(outline, { y0: deckTop - 0.01, y1: seatH, rTop: 0.03, rBot: 0.012, dome: 0.008, belly: 0.004 }), ms.up, 'upholstery'));
    g.add(K.partMesh(slabSeam(outline, seatH, 0.03, 0.0042, q), ms.pipe, ms.pipePart));
  } else {
    const sd = zSeatF - zSB;
    const faces = loose && P.piping !== false ? (P.piping === 'both' ? ['top', 'bottom'] : ['top']) : null;
    addCushion(g, ms, softBox(sw, cushT + 0.01, sd, 'y', { puff: loose ? 0.16 : 0.08, round: 0.6, sides: 0.25, bottom: 0.2, q }), [0, deckTop + (cushT + 0.01) / 2 - 0.01, zSB + sd / 2], faces, q);
  }

  // --- scroll arms: a roll on top of each side panel, overhanging outward, with a welt round its front face that
  // runs on down the panel's front edges
  if (scroll) {
    const xr = w / 2 - rr, yr = armH - rr;
    const z0 = zJoinF - 0.03, z1 = zA - 0.002;
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const z = lerp(z0, z1 - rr * 0.35, i / 6);
        pts.push([s * xr * spl(z), yr, z]);
      }
      g.add(K.partMesh(sweepGeometry(pts, { a: rr, b: rr, r: 1, nc: q < 1 ? 3 : 4, ns: 2, nEnd: 3, capLen: 0.35 }), ms.up, 'upholstery'));
      const wp = [];
      // the ring lies on the roll's domed front (end cap 0.35·rr from the last path point, at radius ra)
      const ra = rr * 0.86, zw = z1 - rr * 0.35 + rr * 0.35 * Math.sqrt(1 - 0.86 * 0.86) + 0.0025, yLow = yb + 0.035;
      const xo = (y) => s * (xArm - 0.01) * sx(y), xi = (y) => s * (xArm - tArm + 0.01) * sx(y);
      for (let i = 0; i <= 4; i++) {
        const y = lerp(yLow, yr - ra * 0.75, i / 4);
        wp.push(new THREE.Vector3(xo(y), y, zA - 0.004));
      }
      const n = Math.max(10, Math.round(18 * q));
      for (let i = 0; i <= n; i++) {
        const a = lerp(-0.25 * Math.PI, 1.25 * Math.PI, i / n);
        wp.push(new THREE.Vector3(s * (xr + Math.cos(a) * ra), yr + Math.sin(a) * ra, zw));
      }
      for (let i = 0; i <= 4; i++) {
        const y = lerp(yr - ra * 0.75, Math.max(yLow, seatH - 0.02), i / 4);
        wp.push(new THREE.Vector3(xi(y), y, zA - 0.004));
      }
      g.add(K.partMesh(seamTube(wp, 0.0042, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
    }
  }

  // --- ear scrolls (STRANDMON): the ear's top front corner rolled outward – a roll along the wing's outer top edge
  // round the corner and a little way down the front edge
  if (num(P.earRoll, 0) > 0) {
    const er = clamp(P.earRoll, 0.01, 0.05);
    const yEnd = Math.max(yJ + 0.05, h - clamp(num(P.earRollDrop, 0.18), 0.05, 0.6));
    const raw = [];
    if (topLine) {
      // a filleted edge: the roll follows the wing's top and its whole front edge (a piped lip), set in by its radius
      const zS = zEarN - clamp(num(P.earRollBack, 0.12), 0.03, 0.3);
      for (let i = 1; i < topLine.length; i++) {
        const [z, y] = topLine[i], [zp, yp] = topLine[i - 1];
        if (z < zS) continue;
        const tl = Math.hypot(z - zp, y - yp) || 1;
        const nz = -(y - yp) / tl, ny = (z - zp) / tl; // outward normal: up on the top, forward on the edge
        const yc = y - ny * er * 0.9, zc = z - nz * er * 0.9;
        if (yc < yEnd) break;
        raw.push([zc + shear(yc) * ramp(zc, yc), yc]);
      }
    } else {
      for (let i = 0; i <= 80; i++) {
        const zN = lerp(zEarN - clamp(num(P.earRollBack, 0.12), 0.03, 0.3), zJoinN, i / 80);
        const y = sideTop(zN) - er * 0.9;
        if (y < yEnd) break;
        raw.push([zN + shear(y) * ramp(zN, y) - er * 0.25, y]);
      }
    }
    // resample by length
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const n = Math.max(6, Math.round(12 * q)), Lr = cum[cum.length - 1];
    if (raw.length > 2 && Lr > 0.05) {
      for (const s of [-1, 1]) {
        const pts = [];
        let j = 0;
        for (let i = 0; i <= n; i++) {
          const v = (Lr * i) / n;
          while (j < cum.length - 2 && cum[j + 1] < v) j++;
          const f = clamp((v - cum[j]) / (cum[j + 1] - cum[j] || 1e-9), 0, 1);
          const z = lerp(raw[j][0], raw[j + 1][0], f), y = lerp(raw[j][1], raw[j + 1][1], f);
          pts.push([s * (out(y) * sx(y) * spl(z) - er * 0.55), y, z]);
        }
        g.add(K.partMesh(sweepGeometry(pts, { a: er, b: er, r: 1, side: [1, 0, 0], nc: q < 1 ? 3 : 4, ns: 2, nEnd: 3, capLen: 0.8 }), ms.up, 'upholstery'));
      }
    }
  }

  // --- buttons, tuft seam, shell seams, neck pillow: all on the inner back
  const backSlope = (y) => Math.atan2(backFront(y + 0.01) - backFront(y - 0.01), 0.02);
  if (buttons) {
    const rows = Math.max(1, Math.round(num(P.buttonRows, 1))), cols = Math.max(1, Math.round(num(P.buttonCols, 3)));
    const br = clamp(num(P.buttonR, 0.014), 0.006, 0.03);
    const gap = clamp(num(P.buttonGap, 0.1), 0.04, 0.2);
    const by = clamp(num(P.buttonY, 0.45), 0.1, 0.9);
    const bgeo = wingButton(br, q);
    for (let r = 0; r < rows; r++) {
      const y = seatH + (h - seatH) * (by + (r - (rows - 1) / 2) * (gap / (h - seatH)));
      const hw = innX(y);
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * gap;
        if (Math.abs(x) > hw - 0.05) continue;
        const z = backFront(y) + crown * (1 - (x / hw) ** 2) + br * 0.1;
        g.add(K.partMesh(bgeo, ms.up, 'upholstery', { position: [x, y, z], rotation: [backSlope(y), 0, 0] }));
      }
    }
  }
  if (P.backTuft) {
    // a short horizontal stitched tuft across the upper back (Habo)
    const y = seatH + (h - seatH) * clamp(num(P.tuftY, 0.66), 0.3, 0.9), half = clamp(num(P.tuftW, 0.1), 0.03, 0.2);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = lerp(-half, half, i / 8);
      pts.push(new THREE.Vector3(x, y, backFront(y) + crown * (1 - (x / innX(y)) ** 2) - dimple(x, y) - 0.0015));
    }
    g.add(K.partMesh(seamTube(pts, 0.0035, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
  }
  if (P.backSeams) {
    // shell: a lumbar seam across the inner back just above the arms and a centre seam from it up to the top
    const yL = clamp(num(P.seamY, armH + 0.06), seatH + 0.08, h - 0.2);
    const across = [];
    const hw = innX(yL) - 0.004;
    for (let i = 0; i <= 14; i++) {
      const x = lerp(-hw, hw, i / 14);
      const edgeIn = Math.max(0, Math.abs(x) - (hw - rc * 0.5)) / (rc * 0.5);
      across.push(new THREE.Vector3(x, yL, backFront(yL) - 0.002 - 0.06 * edgeIn * edgeIn));
    }
    g.add(K.partMesh(seamTube(across, 0.0028, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
    const up = [];
    // (up to where the top's round begins – with a dipped top it would otherwise poke out above the fabric)
    const yU = dip > 0 ? backTop(0) - TbTop * 0.5 : h - TbTop * 0.35;
    for (let i = 0; i <= 8; i++) {
      const y = lerp(yL, yU, i / 8);
      up.push(new THREE.Vector3(0, y, backFront(y) - 0.002));
    }
    g.add(K.partMesh(seamTube(up, 0.0028, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
  }
  if (P.rearSeam) {
    // vertical seam down the middle of the outer back (Scapa)
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const y = lerp(yb + rBot * 0.8, h - TbTop * 0.45, i / 10);
      pts.push(new THREE.Vector3(0, y, zOut(y) + 0.0015));
    }
    g.add(K.partMesh(seamTube(pts, 0.0028, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
  }
  if (P.headrest === true) {
    // neck pillow: a soft bolster strapped high on the inner back
    const ph = clamp(num(P.pillowH, 0.13), 0.08, 0.2), pw = clamp(num(P.pillowW, 0.38), 0.2, innX(h - 0.2) * 2 - 0.04), pt = 0.085;
    const y = h - clamp(num(P.pillowDrop, 0.17), 0.1, 0.4);
    const a = backSlope(y);
    g.add(K.partMesh(softBox(pw, ph, pt, 'z', { puff: 0.35, round: 0.95, sides: 0.4, bottom: 0.2, pinch: 0.25, q }), ms.up, 'upholstery', { position: [0, y, backFront(y) + pt * 0.4], rotation: [a, 0, 0] }));
  }

  // --- base
  const colliders = [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] }];
  if (style === 'swivel-star' || style === 'swivel-disc') {
    // centred under the seat
    const zc = clamp(num(P.baseZ, (zSB + zA) / 2 - 0.03), zr + 0.2, zf - 0.2);
    addBase(g, ms, style, { hx: clamp(num(P.starR, 0.32), 0.2, 0.4) / 1.05, hz: clamp(num(P.starR, 0.32), 0.2, 0.4) / 1.05, topY: yb + 0.01, q, z: zc });
  } else if (style === 'wood-taper' || style === 'slim-metal') {
    const ax = (xArm - taper) - clamp(num(P.legInsetX, 0.05), 0.02, 0.15);
    const az1 = zA - clamp(num(P.legInsetF, 0.06), 0.02, 0.2);
    const az0 = Math.max(zOut(yb) + 0.05, zr + clamp(num(P.legInsetB, 0), 0, d * 0.5));
    const r = clamp(num(P.legR, clamp(0.012 + yb * 0.04, 0.014, 0.024)), 0.01, 0.035);
    // legInsetXB: the back legs further in than the front ones (Habo)
    const axB = P.legInsetXB != null ? (xArm - taper) - clamp(num(P.legInsetXB, 0.05), 0.02, 0.25) : ax;
    wingLegs(g, ms, style, { axF: ax, axB, az0, az1, topY: yb + 0.004, q, rTop: r, rBot: r * clamp(num(P.legTaper, 0.62), 0.3, 1), splayX: num(P.splayX, 5), splayF: num(P.splayF, 6), splayB: num(P.splayB, 9), square: style === 'slim-metal' });
  } else addBase(g, ms, style, { hx: xArm - taper, hz: d / 2 - 0.05, topY: yb + 0.004, q, inset: 0.05 });
  if (P.footstool) {
    const fd = Math.min(0.42, d * 0.5);
    const sw0 = clamp(num(P.stoolW, Math.min(w * 0.68, 0.6)), 0.3, 0.8), sd0 = clamp(num(P.stoolD, fd), 0.28, 0.6);
    colliders.push(wingStool(g, spec, ms, style, { w: sw0, d: sd0, h: clamp(num(P.stoolH, seatH - 0.02), 0.25, seatH + 0.02), z: d / 2 + 0.14 + sd0 / 2, q, box: P.stoolStyle === 'box' }));
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
 * Closed 2D outline through polygon corners [[a, b, r], …]: every corner gets a circular fillet of radius r (n + 1
 * points, clamped so neighbouring fillets fit; concave corners too), r = 0 keeps the point as it is. Straight runs
 * get extra points at most `step` apart, so a later warp bends them. minR: the smallest fillet (≥ the edge radius of a
 * profileLoft made from it – a smaller convex corner folds over when the edge rings are inset).
 */
function filletOutline(corners, n = 4, step = 0.05, minR = 0) {
  const m = corners.length;
  const arcs = [];
  for (let i = 0; i < m; i++) {
    const P = corners[i], A = corners[(i - 1 + m) % m], B = corners[(i + 1) % m];
    let ux = A[0] - P[0], uy = A[1] - P[1], vx = B[0] - P[0], vy = B[1] - P[1];
    const la = Math.hypot(ux, uy) || 1e-9, lb = Math.hypot(vx, vy) || 1e-9;
    ux /= la;
    uy /= la;
    vx /= lb;
    vy /= lb;
    const phi = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
    const r0 = P[2] > 0 ? Math.max(P[2], minR) : 0;
    if (r0 < 1e-5 || phi > Math.PI - 1e-3 || phi < 1e-3) {
      arcs.push([[P[0], P[1]]]);
      continue;
    }
    const tn = Math.tan(phi / 2);
    const t = Math.min(r0 / tn, la * 0.49, lb * 0.49);
    const r = t * tn;
    let bx = ux + vx, by = uy + vy;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const dc = r / Math.sin(phi / 2);
    const cx = P[0] + bx * dc, cy = P[1] + by * dc;
    const a0 = Math.atan2(P[1] + uy * t - cy, P[0] + ux * t - cx);
    let da = Math.atan2(P[1] + vy * t - cy, P[0] + vx * t - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const arc = [];
    for (let k = 0; k <= n; k++) arc.push([cx + r * Math.cos(a0 + (da * k) / n), cy + r * Math.sin(a0 + (da * k) / n)]);
    arcs.push(arc);
  }
  const out = [];
  for (let i = 0; i < m; i++) {
    const arc = arcs[i], next = arcs[(i + 1) % m][0], last = arc[arc.length - 1];
    out.push(...arc);
    const L = Math.hypot(next[0] - last[0], next[1] - last[1]);
    const k = Math.floor(L / step);
    for (let j = 1; j <= k; j++) out.push([lerp(last[0], next[0], j / (k + 1)), lerp(last[1], next[1], j / (k + 1))]);
  }
  return out;
}

/** Outward unit normals [nz, ny] of a closed (z, y) outline, from its winding (concave outlines work). */
function outlineNormals(outline) {
  const m = outline.length;
  let area = 0;
  for (let j = 0; j < m; j++) {
    const a = outline[j], b = outline[(j + 1) % m];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sg = area > 0 ? 1 : -1;
  return outline.map((p, j) => {
    const a = outline[(j - 1 + m) % m], b = outline[(j + 1) % m];
    const tz = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tz, ty) || 1;
    return [(sg * ty) / l, (-sg * tz) / l];
  });
}

/**
 * Solid from a closed side-profile outline [[z, y], …] lofted across x from x0 to x1 (club-chair arm panels, back
 * frames, the tufted lounge's seat and back): flat faces with a rounded edge of radius r, `nx` extra levels between
 * them (for `disp`). disp(x, p, n) moves outline point p (outward normal n) along n at level x – faded out over the
 * rounded edges. The faces are triangulated, so any simple outline works.
 */
function profileLoft(outline, x0, x1, r, { nEdge = 3, nx = 0, disp } = {}) {
  const m = outline.length;
  const N = outlineNormals(outline);
  const S = [0];
  for (let j = 1; j <= m; j++) S.push(S[j - 1] + Math.hypot(outline[j % m][0] - outline[j - 1][0], outline[j % m][1] - outline[j - 1][1]));
  r = clamp(r, 0.001, (x1 - x0) / 2 - 1e-4);
  const lv = [];
  for (let k = 0; k <= nEdge; k++) {
    const a = (Math.PI / 2) * (k / nEdge);
    lv.push([x0 + r - r * Math.cos(a), r - r * Math.sin(a)]);
  }
  for (let k = 1; k <= nx; k++) lv.push([lerp(x0 + r, x1 - r, k / (nx + 1)), 0]);
  for (let k = nEdge; k >= 0; k--) {
    const a = (Math.PI / 2) * (k / nEdge);
    lv.push([x1 - r + r * Math.cos(a), r - r * Math.sin(a)]);
  }
  const nc = m + 1, nr = lv.length;
  const pos = [], uv = [], idx = [];
  lv.forEach(([x, inset], i) => {
    const f = 1 - inset / r;
    for (let j = 0; j < nc; j++) {
      const p = outline[j % m], n = N[j % m];
      const o = (disp && f > 0 ? disp(x, p, n) * f : 0) - inset;
      pos.push(x, p[1] + n[1] * o, p[0] + n[0] * o);
      uv.push(S[j], x + (i < nr / 2 ? -inset : inset));
    }
  });
  const side = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * nc + j, b = a + 1, c = a + nc, dd = c + 1;
      side.push(a, b, c, b, dd, c);
    }
  }
  // the side's winding from one quad against the outline normal there
  const P3 = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const i0 = nEdge * nc;
  const fnm = cross(sub(P3(i0 + 1), P3(i0)), sub(P3(i0 + nc), P3(i0)));
  const nmid = N[0];
  if (fnm[2] * nmid[0] + fnm[1] * nmid[1] < 0) for (let t = 0; t < side.length; t += 3) [side[t + 1], side[t + 2]] = [side[t + 2], side[t + 1]];
  idx.push(...side);
  // flat faces: the first and last ring (inset r), triangulated
  const contour = [];
  for (let j = 0; j < m; j++) contour.push(new THREE.Vector2(pos[j * 3 + 2], pos[j * 3 + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [ring, sx] of [[0, -1], [nr - 1, 1]]) {
    const base = pos.length / 3;
    for (let j = 0; j < m; j++) {
      const k = (ring * nc + j) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
      uv.push(sx * pos[k + 2], pos[k + 1]);
    }
    const t0 = tris[0];
    const fn = cross(sub(P3(base + t0[1]), P3(base + t0[0])), sub(P3(base + t0[2]), P3(base + t0[0])));
    const flip = fn[0] * sx < 0;
    for (const t of tris) idx.push(base + t[0], base + (flip ? t[2] : t[1]), base + (flip ? t[1] : t[2]));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  K.smoothNormals(geo);
  // the flat faces and the rings round them face straight along x (a triangulated face has only rim vertices)
  const nrm = geo.attributes.normal;
  const flat = (k, sx) => nrm.setXYZ(k, sx, 0, 0);
  for (let j = 0; j < nc; j++) {
    flat(j, -1);
    flat((nr - 1) * nc + j, 1);
  }
  for (let k = nr * nc; k < nr * nc + 2 * m; k++) flat(k, k < nr * nc + m ? -1 : 1);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Welt along the edge of a profileLoft face at x = xFace (side = +1: the face at the loft's x1 end, −1: x0), on the
 * 45° point of the edge rounding r, for the outline points where keep(p, n) holds (one contiguous run).
 */
function profileWelt(outline, xFace, side, r, keep, { tube = 0.0035, q = 1 } = {}) {
  const N = outlineNormals(outline);
  const e = r * (1 - Math.SQRT1_2) - tube * 0.3;
  const x = xFace - side * e;
  const pts = [];
  outline.forEach((p, j) => {
    if (keep(p, N[j])) pts.push(new THREE.Vector3(x, p[1] - N[j][1] * e, p[0] - N[j][0] * e));
  });
  return pts.length > 2 ? seamTube(pts, tube, { radial: q < 1 ? 3 : 4 }) : null;
}

/**
 * Bakes every mesh below grp into grp's space and moves its vertices through fn(v: Vector3) (club-chair flare); the
 * normals follow the warp's (numerical) Jacobian, so flat faces and seams keep their shading.
 */
function warpMeshes(grp, fn) {
  grp.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
  const meshes = [];
  grp.traverse((o) => o.isMesh && meshes.push(o));
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), nv = new THREE.Vector3();
  const J = new THREE.Matrix3();
  const e = 1e-4;
  const col = (i, x, y, z) => {
    fn(a.set(x + (i === 0 ? e : 0), y + (i === 1 ? e : 0), z + (i === 2 ? e : 0)));
    fn(b.set(x - (i === 0 ? e : 0), y - (i === 1 ? e : 0), z - (i === 2 ? e : 0)));
    return a.sub(b).divideScalar(2 * e).toArray();
  };
  for (const o of meshes) {
    const geo = o.geometry.clone();
    geo.userData = {};
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const p = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (n) {
        const c0 = col(0, x, y, z), c1 = col(1, x, y, z), c2 = col(2, x, y, z);
        J.set(c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]).invert().transpose();
        nv.fromBufferAttribute(n, i).applyMatrix3(J).normalize();
        n.setXYZ(i, nv.x, nv.y, nv.z);
      }
      fn(v.set(x, y, z));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    if (n) n.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    if (!o.geometry.userData?.shared) o.geometry.dispose();
    o.geometry = geo;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    grp.add(o);
  }
}

/**
 * Tailored skirt round a skirted club chair (IKEA SALTSJÖBADEN): a band from the floor to `top`, `out` proud of the
 * body faces (w × d footprint), flaring at the hem, tucked in at both edges, with an inverted kick pleat (a groove
 * fading out upward) `pleatOff` from every corner on every face.
 */
function clubSkirt(w, d, { top = 0.2, pleatH = 0.17, out = 0.0015, flare = 0.012, rc = 0.03, pleatOff = 0.035, depth = 0.018, tuck = 0.014 } = {}) {
  const hx = w / 2 + out, hz = d / 2 + out;
  const ax = hx - rc, az = hz - rc, arcL = (Math.PI / 2) * rc;
  const L = 4 * ax + 4 * az + 4 * arcL;
  // walk: front edge (x from −ax to ax), front-right arc, right edge (z from az to −az), …
  const segs = [
    { len: 2 * ax, at: (s) => [-ax + s, hz, 0, 1] },
    { len: arcL, at: (s) => { const a = s / rc; return [ax + Math.sin(a) * rc, az + Math.cos(a) * rc, Math.sin(a), Math.cos(a)]; } },
    { len: 2 * az, at: (s) => [hx, az - s, 1, 0] },
    { len: arcL, at: (s) => { const a = s / rc; return [ax + Math.cos(a) * rc, -az - Math.sin(a) * rc, Math.cos(a), -Math.sin(a)]; } },
    { len: 2 * ax, at: (s) => [ax - s, -hz, 0, -1] },
    { len: arcL, at: (s) => { const a = s / rc; return [-ax - Math.sin(a) * rc, -az - Math.cos(a) * rc, -Math.sin(a), -Math.cos(a)]; } },
    { len: 2 * az, at: (s) => [-hx, -az + s, -1, 0] },
    { len: arcL, at: (s) => { const a = s / rc; return [-ax - Math.cos(a) * rc, az + Math.sin(a) * rc, -Math.cos(a), Math.sin(a)]; } },
  ];
  const at = (s) => {
    s = ((s % L) + L) % L;
    for (const sg of segs) {
      if (s <= sg.len) return sg.at(s);
      s -= sg.len;
    }
    return segs[0].at(0);
  };
  // pleat positions (arc length) and the samples: coarse along the faces, dense across the pleats and the corners
  const pleats = [];
  let s0 = 0;
  segs.forEach((sg, i) => {
    if (i % 2 === 0) pleats.push(s0 + pleatOff - rc, s0 + sg.len - pleatOff + rc);
    s0 += sg.len;
  });
  const S = [];
  for (let s = 0; s < L; s += 0.05) S.push(s);
  s0 = 0;
  segs.forEach((sg, i) => {
    if (i % 2) for (let k = 0; k <= 4; k++) S.push(s0 + (sg.len * k) / 4);
    s0 += sg.len;
  });
  for (const p of pleats) for (let k = -6; k <= 6; k++) S.push(p + k * 0.0035);
  S.sort((a, b) => a - b);
  const samples = S.filter((s, i) => s < L - 1e-4 && (i === 0 || s - S[i - 1] > 0.0015));
  const groove = (s) => {
    let gsum = 0;
    for (const p of pleats) gsum += Math.exp(-(((s - p) / 0.006) ** 2));
    return Math.min(1, gsum);
  };
  const ring = (y, o, withPleat = true) => samples.map((s) => {
    const [x, z, nx, nz] = at(s);
    const k = withPleat && y < pleatH ? depth * Math.pow(1 - y / pleatH, 0.7) * groove(s) : 0;
    const off = o - k;
    return [x + nx * off, y, z + nz * off];
  });
  const fl = (y) => flare * (1 - Math.min(1, y / (top * 0.7))) ** 2;
  const rows = [ring(0.002, -0.012, false), ring(0.003, fl(0.003) - 0.002), ring(0.006, fl(0.006))];
  for (const y of [0.02, 0.045, 0.08, 0.12, pleatH * 0.85, pleatH]) rows.push(ring(y, fl(y)));
  // the band runs gently into the body at its top (no step); tuck: how far its top edge dips in (≤ 3 mm: none – the
  // band simply ends, a hair proud of the body faces, which carry the cover on up without a seam)
  if (tuck > 0.003) rows.push(ring(Math.max(pleatH + 0.005, top - 0.1), 0, false), ring(top, -0.003, false), ring(top + 0.002, -tuck, false));
  else rows.push(ring(top, 0, false));
  return gridGeometry(rows);
}

/**
 * Low, deep, armless lounge chair of soft pillows (Jakobsen Cooper, backShape 'tufted'): an upholstered base band
 * (plinthH, slightly recessed) under one thick seat pillow (its gathered front bulging out over the band, four blind
 * dimples in line with the back's channels) and one thick wedge back across the full width (rear face leaning ≈ 19°
 * into a broad elliptic crown roll that peaks ≈ 40 % from the rear, a front face reclined ≈ 27°: an unbroken head
 * roll over one cross seam and three vertical channels below it, seams at ±tuftX), lofted from side profiles measured
 * on the shop's side photo (0.97 deep, 0.72 high, scaled to the dims), on small hidden glides.
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
  const zr = -d / 2;
  const Z = (u) => zr + (u / 0.97) * d;
  const Yh = (v) => (v / 0.72) * h;
  const y0 = legH + 0.003;
  const gs = (v, c, s) => Math.exp(-(((v - c) / s) ** 2));
  const hw = w / 2;
  const edge = (x) => 1 - Math.pow(Math.min(1, Math.abs(x) / hw), 6);
  const nxs = Math.max(14, Math.round(44 * q));
  const plinthH = clamp(num(P.plinthH, 0.155), y0 + 0.06, seatH - 0.16);
  // rear face (photo: from u 0.2 at the floor to u 0 at v 0.57), as z at height y
  const zRear = (y) => Z(0.202 * (1 - (y / h) * (0.72 / 0.572)));
  // channel seams (photo: x ≈ ±0.13 m on the 0.77 m wide chair)
  const xs = clamp(num(P.tuftX, w * 0.17), 0.06, hw - 0.1);
  // back: sits on the base band; rear face, crown (rear corner + a gently falling top + front corner), front face
  const rB = 0.085, rS = 0.065; // edge radii of the back and the seat pillow
  const yb = plinthH - 0.012;
  // crown: an elliptic roll (photo: r ≈ 0.15 m, touching the rear plane at v 0.57 and the top at u 0.14), the rear
  // face and the front face run tangentially into it from the base and from the seat
  const rz = 0.15 * (d / 0.97), ry = 0.15 * (h / 0.72);
  const C = [zr + rz + 0.004, h - ry - 0.002];
  const A = [zRear(yb), yb], J = [Z(0.4), seatH - 0.01];
  const tangent = (p, pickFront) => {
    const dz = (p[0] - C[0]) / rz, dy = (p[1] - C[1]) / ry, dist = Math.hypot(dz, dy);
    const al = Math.acos(clamp(1 / dist, -1, 1)), ph = Math.atan2(dy, dz);
    const c1 = ph + al, c2 = ph - al;
    return pickFront === Math.cos(c1) > Math.cos(c2) ? c1 : c2;
  };
  let aRear = tangent(A, false);
  const aFront = tangent(J, true);
  while (aRear < aFront) aRear += 2 * Math.PI;
  const backPts = [[A[0], A[1], 0.03]];
  const nRoll = 16;
  for (let k = 0; k <= nRoll; k++) {
    const a = lerp(aRear, aFront, k / nRoll);
    backPts.push([C[0] + rz * Math.cos(a), C[1] + ry * Math.sin(a), 0]);
  }
  backPts.push([J[0], J[1], 0.08], [Z(0.405), yb, 0.02]);
  const backOut = filletOutline(backPts, 6, 0.03, rB * 1.02);
  const yTopF = C[1] + ry * Math.sin(aFront);
  const yFace0 = seatH, yFace1 = yTopF;
  const ySeam = lerp(yFace0, yFace1, 0.5);
  const backDisp = (x, p, n) => {
    const wf = sstep(0.15, 0.5, n[0]) * sstep(seatH - 0.03, seatH + 0.02, p[1]) * edge(x);
    if (wf <= 0) return 0;
    const below = 1 - sstep(ySeam - 0.015, ySeam + 0.005, p[1]);
    const seamV = gs(x, xs, 0.012) + gs(x, -xs, 0.012);
    // channels: each one a soft roll between its seams, fading out at the cross seam and into the seat
    const chan = clamp01(1 - gs(x, xs, 0.06) - gs(x, -xs, 0.06));
    let dd = 0.02 * chan * below * (1 - gs(p[1], ySeam, 0.04)) * sstep(seatH, seatH + 0.07, p[1]);
    dd -= 0.02 * seamV * below * sstep(seatH, seatH + 0.04, p[1]);
    dd -= 0.015 * gs(p[1], ySeam, 0.012);
    // the head roll: one soft bulge above the cross seam
    dd += 0.014 * sstep(ySeam + 0.01, ySeam + 0.07, p[1]);
    return dd * wf;
  };
  g.add(K.partMesh(profileLoft(backOut, -hw + 0.004, hw - 0.004, rB, { nEdge: 5, nx: nxs, disp: backDisp }), ms.up, 'upholstery'));
  // base band: from the glides to plinthH, slightly recessed at the sides and the front, its rear flush with the back's
  const zP1 = Z(0.937);
  const baseOut = filletOutline([[zRear(y0) + 0.004, y0, 0.03], [zP1, y0, 0.035], [zP1, plinthH, 0.015], [zRear(plinthH) + 0.002, plinthH, 0.01]], 5, 0.04, 0.031);
  g.add(K.partMesh(profileLoft(baseOut, -hw + 0.012, hw - 0.012, 0.03, { nEdge: 3 }), ms.up, 'upholstery'));
  // seat: one pillow on the band, its front bulging out over it, tucked into the back
  const zF = d / 2 - 0.004;
  const seatOut = filletOutline([[Z(0.38), plinthH - 0.004, 0.02], [Z(0.93), plinthH - 0.004, 0.03], [zF, Yh(0.24), 0.1], [Z(0.925), seatH, 0.12], [Z(0.38), seatH, 0.02]], 6, 0.03, rS * 1.02);
  const zTop0 = Z(0.43), zTop1 = Z(0.9);
  const dimples = [];
  for (const sx of [-1, 1]) for (const f of [0.3, 0.68]) dimples.push([sx * xs, lerp(zTop0, zTop1, f)]);
  const lam = clamp(w / 11, 0.05, 0.09);
  const seatDisp = (x, p, n) => {
    let dd = 0;
    const top = sstep(0.3, 0.7, n[1]);
    if (top > 0) {
      dd += 0.02 * gs(p[0], (zTop0 + zTop1) / 2, 0.22) * top;
      for (const [dx, dz] of dimples) dd -= 0.028 * gs(x, dx, 0.035) * gs(p[0], dz, 0.035) * top;
    }
    if (n[0] > 0.2 && p[1] < seatH - 0.03) {
      // gathered (ruched) front: vertical folds, fading out toward the top and into the band
      const fade = sstep(plinthH, plinthH + 0.05, p[1]) * (1 - sstep(seatH - 0.12, seatH - 0.03, p[1]));
      dd += 0.0065 * (0.5 + 0.5 * Math.cos((2 * Math.PI * x) / lam)) * fade * n[0] - 0.003 * fade;
    }
    return dd * edge(x);
  };
  g.add(K.partMesh(profileLoft(seatOut, -hw, hw, rS, { nEdge: 5, nx: nxs, disp: seatDisp }), ms.up, 'upholstery'));
  // small round glides, hidden under the band
  const gm = ms.legs();
  for (const sx of [-1, 1]) for (const u of [0.32, 0.8]) g.add(K.partMesh(K.cylinder(0.02, 0.02, legH + 0.004, { seg: 12 }), gm, 'legs', { position: [sx * (hw - 0.17), 0, Z(u)] }));
  return K.finishModel(g, { seatY: seatH });
}

/**
 * Side-panel (arm) outline of a club chair in (z, y): bottom y0 from the rear to zf; the front edge (set back by
 * `inset` above a concave sweep from footY) up to armH with a rounded top corner (frontR); a level arm top that
 * rises in a concave sweep (radius sweepR, horizontal run `rise`) to a rear part of height backH and depth
 * `plateau`; a rear face leaning back by `rec` (radians).
 */
function clubArmOutline({ zr, zf, y0, armH, backH, plateau, rise, sweepR, topR, inset, footY, frontR, rec, rearR, minR = 0 }) {
  const zb = zr + Math.max(0, backH - y0) * Math.tan(rec);
  const pts = [[zb, y0, 0.012], [zf, y0, 0.012]];
  if (inset > 0.01) pts.push([zf, footY, 0.012], [zf - inset, footY, inset]);
  pts.push([zf - inset, armH, frontR]);
  if (backH > armH + 0.015) {
    const zP = zr + plateau;
    pts.push([Math.min(zf - inset - frontR - 0.02, zP + rise), armH, sweepR]);
    if (plateau > 0.03) pts.push([zP, backH, topR]);
  }
  pts.push([zr, backH, rearR]);
  return filletOutline(pts, 6, 0.04, minR);
}

/**
 * Boxy club chair. backShape 'square': upholstered side panels lofted from a side profile (box arms, or arms that
 * sweep up into a higher rear part, set back with a foot sweep; optional flare / lean-in / toe-in as a warp of the
 * whole body), a back frame (between or across the arms, reclined), loose or tight back and seat, a deck between
 * the arms, legs / swivel / star or a tailored skirt with kick pleats. 'curved': a quilted band wrapping round
 * the seat. 'tufted': buildTuftedLounge.
 * Square-back params (defaults = the plain box): cushT, seatD, seatOver, seatPuff, seatRound, seatWelt
 * ('top' | 'both' | 'none'), backT, backFrameH, backRec (°), backFull, backCushT, backCushRec (° – default: leans
 * on the frame), backPuff, backRound, pillow, armBackH, armPlateau, armRise, armSweepR, armTopR, armInset, armFrontR, armRound (fraction
 * of armW / 2), armRec (°), armFlare (°, below the arm top), armFlarePow, armLean (m, above it), armTaper (m, the
 * panels' outer faces lean in further above the arm top), armWedge (m, the inner faces lean outward up to the arm
 * top), armToe (°),
 * armWelt, legShape ('square'), legW, legInset, legSplay (°), skirtH, starR.
 * More (all off by default): armCut (m: the arms stop this far behind the front) with armFootR (a concave sweep onto
 * the seat top), seatWing (m: T-cushion – the cushion's front part reaches this far beyond the arm gap per side),
 * seatSides (side bulge of the seat cushion), apron 'flat' (a flat apron flush with the arm fronts) with apronR and
 * deckWing (the apron band runs the full width in front of cut-back arms), backPinch / backSides / backWelt false
 * (knife-edge, straight-edged back pillow without a front welt), pillowW, pillowRound, armBackThin (m: the rear
 * sections' inner faces move outward above the arm top), skirtTuck (0: the skirt runs on without a seam), starArms.
 */
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
  const zr = -d / 2, zf = d / 2;
  const skirt = style === 'none';
  const y0 = skirt ? 0.012 : legH;
  if (curved) {
    const cushT = loose ? 0.13 : 0.1;
    const deckTop = seatH - cushT;
    const backT = clamp(0.2, 0.14, d * 0.25);
    const piping = P.piping !== false && loose;
    // body / deck
    const ix0 = -w / 2 + (armed ? armW : 0), ix1 = w / 2 - (armed ? armW : 0);
    const bodyH = deckTop - y0;
    g.add(K.partMesh(softBox(ix1 - ix0 + (armed ? 0.02 : 0), bodyH, d - 0.04, 'y', { puff: 0.03, round: 0.35, sides: 0.18, bottom: 0, q }), ms.up, 'upholstery', { position: [0, y0 + bodyH / 2, 0.02] }));
    if (armed) {
      for (const sx of [-1, 1]) {
        const ah = armH - y0;
        g.add(K.partMesh(softBox(armW, ah, d - 0.01, 'x', { puff: 0.06, round: 0.75, sides: 0.12, top: 0.8, bottom: 0.2, q }), ms.up, 'upholstery', { position: [sx * (w / 2 - armW / 2), y0 + ah / 2, 0] }));
      }
    }
    const sw = ix1 - ix0 - 0.01;
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
    const seatZ0 = zc - rz + backT * 0.3;
    // seat cushion
    const sd = zf - seatZ0 - 0.005;
    const sc = [0, deckTop + cushT / 2, seatZ0 + sd / 2];
    addCushion(g, ms, softBox(sw, cushT, sd, 'y', { puff: 0.14, round: 0.6, sides: 0.25, bottom: 0.25, q }), sc, piping ? ['top'] : null, q);
    if (skirt) {
      // a skirt hem line just above the floor
      const hem = pipeLoop([0, 0.03, 0.02], X, Z, w / 2 + 0.002, d / 2 - 0.02 + 0.002, 0.03, 0.004, q);
      g.add(K.partMesh(hem, ms.up, 'upholstery'));
    }
    addBase(g, ms, style, { hx: w / 2, hz: d / 2, topY: legH + 0.004, q, inset: 0.05 });
    return K.finishModel(g, { seatY: seatH });
  }

  // ---- square back
  const cushT = clamp(num(P.cushT, loose ? 0.13 : 0.1), 0.05, 0.3);
  const deckTop = seatH - cushT;
  const piping = P.piping === true || (P.piping !== false && loose);
  const ix = w / 2 - (armed ? armW : 0); // inner half width (between the arms)
  const body = new THREE.Group();
  g.add(body);
  const up = (geo, o) => body.add(K.partMesh(geo, ms.up, 'upholstery', o));
  const pipe = (geo) => geo && body.add(K.partMesh(geo, ms.pipe, ms.pipePart));
  // back frame: between the arms (or across them: backFull), reclined about its top rear edge
  const backT = clamp(num(P.backT, 0.12), 0.04, d * 0.3);
  const frameH = clamp(num(P.backFrameH, loose ? h - 0.06 : h - 0.012), seatH + 0.05, h);
  const frameRec = clamp(num(P.backRec, 0), -5, 25) * DEG;
  const backFull = armed && P.backFull === true;
  // the frame runs down to the body bottom (armless: one upholstered panel behind the base, flush with its sides)
  const fy0 = y0;
  const zFF = (y) => zr + backT + (frameH - y) * Math.tan(frameRec); // front face of the frame at height y
  {
    const zb = zr + (frameH - fy0) * Math.tan(frameRec), rt = Math.min(backT * 0.45, loose ? 0.04 : 0.05);
    const fr = Math.min(backT * 0.4, armed && !backFull ? 0.012 : 0.03);
    const out = filletOutline([[zb, fy0, 0.01], [zb + backT, fy0, 0.01], [zr + backT, frameH, rt], [zr, frameH, rt]], 5, 0.04, fr * 1.02);
    const fx = backFull || !armed ? w / 2 - (backFull ? 0.002 : 0) : ix + 0.012;
    up(profileLoft(out, -fx, fx, fr, { nEdge: 3 }));
  }
  // arms that stop armCut behind the front (plain vertical front): the seat wings / apron band run in front of them
  const armCut = armed ? clamp(num(P.armCut, 0), 0, d * 0.3) : 0;
  const zArmF = zf - armCut;
  // side panels
  if (armed) {
    const backH = clamp(num(P.armBackH, armH), armH, h);
    // cut-back arms: armFootR > 0 sweeps the front edge forward in a concave curve onto the seat cushion's top (the
    // part below it hides in the cushion wing / apron band)
    const footR = armCut > 0 ? clamp(num(P.armFootR, 0), 0, armCut - 0.005) : 0;
    const inset = armCut > 0 ? (footR > 0.011 ? footR : 0) : clamp(num(P.armInset, 0), 0, d * 0.3);
    const rEdge = (clamp(num(P.armRound, 0.75), 0.05, 1) * armW) / 2;
    const outline = clubArmOutline({
      zr: backFull ? zr + 0.01 : zr, zf: zArmF + (armCut > 0 ? inset : 0), y0, armH, backH,
      plateau: clamp(num(P.armPlateau, 0), 0, d * 0.6),
      rise: clamp(num(P.armRise, 0.1), 0.01, d * 0.7),
      sweepR: clamp(num(P.armSweepR, 0.05), 0, 0.6),
      topR: clamp(num(P.armTopR, 0.04), 0, 0.3),
      inset,
      footY: armCut > 0 ? seatH - 0.012 : clamp(num(P.armFootY, deckTop - inset), y0 + 0.02, armH - inset - 0.02),
      frontR: clamp(num(P.armFrontR, Math.min(armW * 0.4, 0.05)), 0, 0.15),
      rec: clamp(num(P.armRec, 0), -5, 25) * DEG,
      rearR: clamp(num(P.armRearR, backH > armH + 0.015 ? 0.05 : 0.03), 0, 0.2),
      minR: rEdge * 1.02,
    });
    const welt = P.armWelt === true || P.armWelt === 'both' ? 'both' : P.armWelt === 'outer' ? 'outer' : null;
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -w / 2 : ix, x1 = sx < 0 ? -ix : w / 2;
      up(profileLoft(outline, x0, x1, rEdge, { nEdge: 4 }));
      if (welt) {
        const keep = (p) => p[1] > y0 + 0.06;
        pipe(profileWelt(outline, sx < 0 ? x0 : x1, sx, rEdge, keep, { q }));
        if (welt === 'both') pipe(profileWelt(outline, sx < 0 ? x1 : x0, -sx, rEdge, keep, { q }));
      }
    }
  }
  // deck (under the seat): between the arms, or a flat-sided base under an armless chair
  const bh = deckTop - y0;
  if (bh > 0.015) {
    // (a tight seat block reaching the body bottom needs no deck)
    const dz0 = zFF(y0) - backT * (armed ? 1 : 0.5) + 0.02, dz1 = (armed ? zArmF : zf) - clamp(num(P.deckInset, armed ? 0 : 0.012), 0, 0.1);
    const dw = armed ? 2 * ix + 0.02 : w - 0.012;
    if (armed && P.apron === 'flat') {
      // a flat apron flush with the arm fronts (one plane from the seat cushion down), its ends hidden in the arms
      const ar = clamp(num(P.apronR, 0.012), 0.004, bh * 0.4);
      const flatDeck = (za, zb, x, r) => up(profileLoft(filletOutline([[za, y0, 0.01], [zb, y0, ar], [zb, deckTop, ar], [za, deckTop, 0.01]], 4, 0.05, Math.max(ar, r) * 1.02), -x, x, r, { nEdge: 3 }));
      flatDeck(dz0, dz1, ix + 0.015, 0.004);
      // deckWing: the apron band runs the full width in front of cut-back arms (Noelle's plinth)
      if (P.deckWing && armCut > 0.01) flatDeck(zArmF - 0.03, zf - clamp(num(P.deckInset, 0), 0, 0.1), w / 2 - 0.002, clamp(num(P.apronR, 0.012) * 1.5, 0.008, 0.03));
    } else up(softBox(dw, bh, dz1 - dz0, 'y', { puff: 0.02, round: armed ? 0.3 : 0.25, sides: armed ? 0 : 0.03, bottom: 0, q }), { position: [0, y0 + bh / 2, (dz0 + dz1) / 2] });
  }
  // back: loose cushion leaning on the frame, or a tight reclined panel
  const sw = armed ? 2 * ix - 0.012 : w - 0.004;
  const seatD = num(P.seatD, null);
  let seatZ0;
  if (loose) {
    const ct = clamp(num(P.backCushT, 0.16), 0.06, 0.32);
    const zBF = seatD != null ? zf - clamp(seatD, 0.35, d - 0.2) : zFF(deckTop) + ct;
    const zp = Math.max(zBF - ct, zFF(deckTop) + 0.004);
    const lean = Math.max(0.1, Math.min(frameH, h - 0.04) - deckTop);
    const rec = P.backCushRec != null ? num(P.backCushRec, 9) * DEG : clamp(Math.atan((zp - zFF(Math.min(frameH, h - 0.04)) + 0.012) / lean), 3 * DEG, 25 * DEG);
    // height so the tilted cushion's rounded top-front corner (radius cr) just reaches h
    const cr = (clamp01(num(P.backRound, 0.7)) * ct) / 2;
    const ch = (h - deckTop - 0.005 - (ct - cr) * Math.sin(rec) - cr) / Math.cos(rec) + cr;
    const grp = new THREE.Group();
    grp.position.set(0, deckTop + 0.005, zp);
    grp.rotation.x = -rec;
    body.add(grp);
    // backPinch: knife-edge pillow corners (thinner toward the corners); backSides: how much the outline bulges
    // (low: a straight-edged rectangle); backWelt false: no welt round the front face (a knife-edge pillow)
    addCushion(grp, ms, softBox(sw, ch, ct, 'z', { puff: num(P.backPuff, 0.14), round: num(P.backRound, 0.7), sides: num(P.backSides, 0.25), bottom: 0.5, pinch: num(P.backPinch, 0), q }), [0, ch / 2, ct / 2], piping && P.backWelt !== false ? ['front'] : null, q);
    if (P.pillow) {
      // a loose rectangular throw pillow in front of the back cushion
      const pw = P.pillowW != null ? Math.min(num(P.pillowW, 0.56), sw * 0.85) : Math.min(0.56, sw * 0.62), ph = 0.3, pt = 0.12;
      grp.add(K.partMesh(softBox(pw, ph, pt, 'z', { puff: 0.3, round: num(P.pillowRound, 0.85), sides: 0.15, pinch: 0.55, q }), ms.up, 'upholstery', { position: [0, cushT * 0.6 + ph / 2 + 0.01, ct + pt / 2 - 0.035], rotation: [0.12, 0, 0] }));
    }
    seatZ0 = zp + ct * 0.4;
  } else {
    // tight back panel between the arms (Ronda), reclined like the frame
    const tb = clamp(num(P.backCushT, 0.08), 0.04, 0.2);
    const topY = Math.min(h - 0.008, num(P.armBackH, h) - 0.008);
    const rec = num(P.backCushRec, frameRec / DEG + 2) * DEG;
    const yb = Math.max(deckTop - 0.03, y0 + 0.005);
    const zTopF = zFF(topY) - 0.01 + tb; // front face at the top (its rear rests on the frame)
    const zBotF = zTopF + (topY - yb) * Math.tan(rec);
    const out = filletOutline([[zBotF - tb, yb, 0.01], [zBotF, yb, 0.01], [zTopF, topY, Math.min(0.02, tb * 0.4)], [zTopF - tb, topY, 0.01]], 5, 0.04, 0.021);
    const bx = ix + 0.012;
    up(profileLoft(out, -bx, bx, 0.02, { nEdge: 3 }));
    const zAt = (y) => zBotF + 0.003 - (y - yb) * Math.tan(rec);
    if (P.piping !== false) {
      // welt round the panel's front face
      const pts = [];
      const xe = ix - 0.004, yt = topY - 0.022;
      for (let k = 0; k <= 8; k++) { const y = lerp(seatH, yt, k / 8); pts.push(new THREE.Vector3(-xe, y, zAt(y))); }
      for (let k = 1; k < 8; k++) pts.push(new THREE.Vector3(lerp(-xe, xe, k / 8), yt + 0.012, zAt(yt) - 0.006));
      for (let k = 8; k >= 0; k--) { const y = lerp(seatH, yt, k / 8); pts.push(new THREE.Vector3(xe, y, zAt(y))); }
      pipe(seamTube(pts, 0.0035, { radial: q < 1 ? 3 : 4 }));
    }
    seatZ0 = zAt(deckTop) - 0.02;
  }
  // seat cushion
  {
    const z1 = zf + num(P.seatOver, 0) - 0.005;
    const sd = z1 - seatZ0;
    const sc = [0, deckTop + cushT / 2, seatZ0 + sd / 2];
    const weltF = !piping ? null : P.seatWelt === 'both' ? ['top', 'bottom'] : P.seatWelt === 'none' ? null : ['top'];
    const tight = !loose;
    const wing = armed ? clamp(num(P.seatWing, 0), 0, armW + 0.006) : 0;
    const sg = wing > 0.003 ? new THREE.Group() : body;
    if (sg !== body) body.add(sg);
    addCushion(sg, ms, softBox(sw, cushT, sd, 'y', { puff: num(P.seatPuff, tight ? 0.06 : 0.14), round: num(P.seatRound, tight ? 0.35 : 0.6), sides: num(P.seatSides, tight ? 0.1 : 0.25), bottom: tight ? 0.1 : 0.25, seg: sg !== body ? 22 : 10, q }), sc, weltF, q);
    if (sg !== body) {
      // seatWing: a T-cushion – its front part, ahead of the arm fronts, reaches `wing` beyond the arm gap per side
      // (a crisp shoulder: the cushion widens within ≈ 1 cm ahead of the arm fronts; keep seatSides low so the front
      // stays straight in plan and its corners reach the wing)
      const zA = zArmF + 0.002, bl = Math.max(0.006, Math.min(0.012, (z1 - zA) * 0.4));
      const k = 1 + (2 * wing) / sw;
      warpMeshes(sg, (v) => { v.x *= lerp(1, k, sstep(zA, zA + bl, v.z)); });
    }
  }
  if (skirt) {
    const sh = clamp(num(P.skirtH, 0.2), 0.08, deckTop);
    const rc = armed ? clamp((clamp(num(P.armRound, 0.75), 0.05, 1) * armW) / 2, 0.012, 0.05) : 0.03;
    const sk = 0.012; // hem flare: the body is scaled in by this much per side so the hem stays inside the dims
    body.scale.set((w - 2 * sk) / w, 1, (d - 2 * sk) / d);
    g.add(K.partMesh(clubSkirt(w - 2 * sk, d - 2 * sk, { top: sh, pleatH: sh * 0.85, rc, flare: 0.01, tuck: num(P.skirtTuck, 0.014) }), ms.up, 'upholstery'));
  }
  // flare / lean-in / toe-in: the arm panels move sideways by D(y, z), the parts between them stretch with them
  const flare = clamp(num(P.armFlare, 0), -10, 25) * DEG, fpow = clamp(num(P.armFlarePow, 1), 0.5, 4);
  const leanIn = clamp(num(P.armLean, 0), -0.1, 0.2), toe = clamp(num(P.armToe, 0), -10, 20) * DEG;
  const taper = clamp(num(P.armTaper, 0), 0, armW * 0.8); // the panels thin toward the top (outer face leans in more)
  const wedge = clamp(num(P.armWedge, 0), 0, armW * 0.7); // the inner faces lean outward up to the arm top (thin tops)
  // armBackThin: above the arm top the rear sections' inner faces move outward (thinner tops, a wider back opening;
  // the back cushion widens with them)
  const backThin = clamp(num(P.armBackThin, 0), 0, armW * 0.6), backTop = Math.max(armH + 0.05, num(P.armBackH, armH));
  const bottomIn = armed ? Math.tan(flare) * (armH - y0) : 0;
  if (armed && (flare || leanIn || toe || taper || wedge || backThin)) {
    const D = (y, z) => -bottomIn * Math.pow(clamp01((armH - y) / Math.max(0.05, armH - y0)), fpow)
      - leanIn * clamp01((y - armH) / Math.max(0.05, h - armH)) - Math.tan(toe) * (zf - z);
    const W = (y) => wedge * clamp01((y - y0) / Math.max(0.05, armH - y0)) + backThin * sstep(armH - 0.02, backTop, y);
    warpMeshes(body, (v) => {
      const a = Math.abs(v.x), dd = D(v.y, v.z), t = clamp01((a - ix) / armW);
      const tp = taper * clamp01((v.y - armH) / Math.max(0.05, h - armH)) * t;
      v.x = a >= ix ? v.x + Math.sign(v.x) * (dd - tp + W(v.y) * (1 - t)) : (v.x * (ix + dd + W(v.y))) / ix;
    });
  }
  // legs / base
  const topY = legH + 0.004;
  const hx = w / 2 - bottomIn;
  if (style === 'swivel-star') starBase(g, ms, { r: clamp(num(P.starR, Math.min(w, d) * 0.48), 0.18, 0.4), topY, q, arms: clamp(Math.round(num(P.starArms, 4)), 3, 6), plate: 0.15 });
  else if (style === 'wood-taper' && (P.legShape === 'square' || P.legSplay != null || P.legW != null)) {
    const sq = P.legShape === 'square';
    const r = num(P.legW, sq ? 0.05 : clamp(0.024 + topY * 0.08, 0.028, 0.048)) / 2, inset = num(P.legInset, 0.05);
    const sp = num(P.legSplay, 6);
    // rear legs under the body's real rear face at the bottom (an armless chair's reclined back frame starts forward of zr)
    const zRear = armed ? zr : zr + (frameH - y0) * Math.tan(frameRec);
    fourLegs(g, ms, style, { ax: hx - inset, az0: zRear + inset, az1: zf - inset, topY, q, rTop: r, rBot: r * (sq ? 0.72 : 0.8), splayX: sp * 0.8, splayF: sp * 0.7, splayB: sp * 1.3, square: sq });
  } else addBase(g, ms, style, { hx, hz: d / 2, topY, q, inset: num(P.legInset, 0.05) });
  return K.finishModel(g, { seatY: seatH });
}

// ---------------------------------------------------------------------------------------------------------------
// Recliner: high back with a neck cushion on a swivel base, a separate footstool or an integrated footrest.
// Bodies (params.body; 'auto' = from the product):
//   box      upholstered side panels with rounded, slightly flared arm tops (Chicago, Bern). sides 'shell': outer
//            panels, back and apron in a smooth `frame` fabric with upholstered arm caps (Zermatt); 'veneer':
//            wooden side plates (`frame`) on the outer faces, fabric over the arm tops and fronts (Grande)
//   shell    moulded veneer shell (`frame`, or the cover fabric) round seat and back that forms the arms, padded
//            arm tops, thick cushions inside, a sausage neck roll on posts (Conform Timeout); shellTaper / shellTop /
//            shellBottom / shellFront shape the bowl (tulip, up the back), armPad 'lid' | 'petal' | 'scroll' the arm
//            pads (Timeout, Falcon, Afterwork), backW / backFlare / neckPillow / seatT / seatNose the cushions
//   tulip    thin tulip-shaped arms: broad, outward-curling tops narrowing to the foot (IMG Taycan)
//   classic  Stressless: a wedge seat (seatLip) and a channelled back (backBands, backW, backT) between arm pads
//            (armPad 'slab' | 'plump' | 'slim'), on the Classic wooden ring whose uprights carry the pads, or on a
//            metal Cross / Star base with steel arm loops (params.base); footstool on the same base (stoolSeams …)
// 'auto' params are read from params.notes (the shop description) when the explicit params are missing – the
// explicit values per product are listed in notes/add-seating.md.

const RECLINER_BODIES = ['box', 'shell', 'tulip', 'classic'];
const RECLINER_HEADS = ['integrated', 'block', 'roll', 'wing', 'none', 'pillow', 'flap'];

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
  const seams = pick(P.backSeams, ['none', 'cross', 'cross-v', 'buttons', 'bolster', 'tufted', 'v', 'neck', 'quilt'])
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
 * topRing(inset, y) (optional): the top edge rings / cap as given loops (same point count) instead of insetting the
 * last loop along its normals – a thin loop inset by nearly its half width folds over at its short ends.
 */
function loftGeometry(levels, { top = 0.01, bottom = 0.01, nEdge = 3, nCap = 3, dome = 0, matrix, topRing } = {}) {
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
  const ring = (L, y, inset, s = 1, given) => {
    const lp = given ? given(inset, y) : null;
    return L.loop.map((p, j) => {
      const x = lp ? lp[j][0] : p[0] - L.N[j][0] * inset, z = lp ? lp[j][1] : p[1] - L.N[j][1] * inset;
      return [L.c[0] + (x - L.c[0]) * s, y, L.c[1] + (z - L.c[1]) * s];
    });
  };
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
    side.push(ring(last, y1 + top * Math.sin(a), top * (1 - Math.cos(a)), 1, topRing));
  }
  for (let k = nCap; k >= 0; k--) {
    const s = k / nCap;
    const row = ring(last, y1 + top, top, s, topRing);
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

/**
 * Stressless «Classic» base: a flat, round wooden ring (radius r, a band `band` wide and `bandH` tall) on a thin black
 * floor strip, and two wide wooden uprights (postD deep, postT thick) that leave the ring's inner edge at its left and
 * right sides, swing out in an S and rise straight to postTop at |x| = postX (under the arm pads, or the footstool
 * cushion). rx / rz (the old oval-ring call) still work: r = max(rx, rz), uprights up to topY.
 */
function ringBase(g, ms, { r, rx, rz, topY, q, z = 0, postX, postTop, postD = 0.1, postT = 0.034, band = 0.07, bandH = 0.038 }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const m = ms.legs();
  const R = num(r, Math.max(num(rx, 0.28), num(rz, 0.28)));
  const n = Math.max(24, Math.round(44 * q));
  const y0 = 0.009, rows = [];
  const sec = roundRectLoop(band / 2, y0, y0 + bandH, Math.min(0.014, bandH * 0.45), 0.006, 2, 1);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    rows.push(sec.map(([u, v]) => [(R - band / 2 + u) * c, v, (R - band / 2 + u) * s]));
  }
  sub.add(K.partMesh(gridGeometry(rows), m, 'legs'));
  // the black rubber strip under the ring
  sub.add(K.partMesh(K.lathe([[R - band + 0.012, 0], [R - 0.006, 0], [R - 0.006, y0 + 0.002], [R - band + 0.012, y0 + 0.002], [R - band + 0.012, 0]], { seg: n }), mat('plastic', '#1a1a1a'), null));
  // the uprights: from the ring's inner edge out in an S, then straight up
  const xF = R - band - 0.012, xT = num(postX, xF + 0.04), yTop = num(postTop, topY);
  const yS = y0 + bandH - 0.004, hS = clamp((yTop - yS) * 0.45, 0.06, 0.17);
  for (const sx of [-1, 1]) {
    const col = [];
    const nP = 8;
    for (let i = 0; i <= nP; i++) {
      const y = yS + (hS * i) / nP;
      col.push([sx * lerp(xF, xT, sstep(0, 1, i / nP)), y, 0]);
    }
    col.push([sx * xT, yTop, 0]);
    sub.add(K.partMesh(sweepGeometry(col, { a: postD / 2, b: postT / 2, r: 0.45, side: [0, 0, 1], nc: 2, ns: 2, nEnd: 2, capLen: 0.25 }), m, 'legs'));
  }
}

/**
 * Stressless metal swivel bases: 'cross' (four straight round bars in an X just above the floor, a column – Cross)
 * or 'star' (four slender bars curving down from a raised hub to the floor – Star). Column up to topY.
 */
function stresslessBase(g, ms, { kind = 'cross', r, topY, q, z = 0 }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const m = ms.legs();
  const seg = Math.max(10, Math.round(18 * q));
  const glide = mat('plastic', '#1a1a1a');
  const star = kind === 'star';
  // (the Star's hub stands high, about 15 cm, under a short column: its thin arms run down from it to the floor)
  const hubY = star ? Math.min(0.15, topY - 0.06) : 0.03, hubR = star ? 0.03 : 0.034;
  sub.add(K.partMesh(K.cylinder(hubR * 0.8, hubR * 1.05, hubY + 0.03, { seg }), m, 'legs', { position: [0, star ? 0.0 : 0.004, 0] }));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const pts = [];
    const nA = 10;
    for (let k = 0; k <= nA; k++) {
      const t = k / nA;
      const rr = lerp(hubR * 0.6, r - 0.012, t);
      const y = star ? 0.012 + (hubY - 0.004) * (1 - t) ** 1.3 : lerp(0.032, 0.018, t);
      pts.push([c * rr, y, s * rr]);
    }
    sub.add(K.partMesh(sweepGeometry(pts, { a: (u) => lerp(star ? 0.014 : 0.016, star ? 0.009 : 0.012, u), b: (u) => lerp(star ? 0.012 : 0.015, star ? 0.008 : 0.011, u), r: 1, nc: 3, ns: 1, nEnd: 2, capLen: 0.6 }), m, 'legs'));
    sub.add(K.partMesh(K.cylinder(0.011, 0.012, 0.008, { seg: 8 }), glide, null, { position: [c * (r - 0.02), 0, s * (r - 0.02)] }));
  }
  const colY0 = hubY + 0.02;
  if (topY - 0.03 > colY0) sub.add(K.partMesh(K.cylinder(0.026, 0.028, topY - 0.03 - colY0, { seg }), m, 'legs', { position: [0, colY0, 0] }));
  sub.add(K.partMesh(K.cylinder(0.05, 0.034, 0.032, { seg }), mat('black-metal', '#1b1b1b', { flat: true }), null, { position: [0, topY - 0.032, 0] }));
}

/** Stressless glide-wheel knob (dark ribbed disc with a small silver plate) on a side face, axis along x (sx outward). */
function stresslessKnob(g, [x, y, z], sx, q) {
  const knob = new THREE.Group();
  knob.position.set(x, y, z);
  knob.rotation.z = (-sx * Math.PI) / 2;
  g.add(knob);
  knob.add(K.partMesh(K.cylinder(0.03, 0.03, 0.022, { seg: Math.max(12, Math.round(20 * q)) }), mat('plastic', '#1d1d1d'), null, { position: [0, -0.011, 0] }));
  knob.add(K.partMesh(K.cylinder(0.011, 0.012, 0.004, { seg: 10 }), mat('chrome', '#c8c8c8'), null, { position: [0, 0.011, 0] }));
}

/**
 * Closed 2D outline through polygon corners verts [[a, b], …] with a fillet radius per corner: each corner becomes an
 * arc of nArc + 1 points, the edge from corner i to i + 1 gets nEdge[i] points between the arcs, moved by
 * edgeFn(i, t) → [da, db] (t ∈ (0, 1) along the edge: a domed top, a sagging underside). Constant point count.
 */
function filletProfile(verts, radii, { nArc = 4, nEdge = 3, edgeFn } = {}) {
  const n = verts.length;
  const arcs = verts.map((v, i) => {
    const p = verts[(i + n - 1) % n], q = verts[(i + 1) % n];
    const la = Math.hypot(p[0] - v[0], p[1] - v[1]), lb = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const ua = [(p[0] - v[0]) / la, (p[1] - v[1]) / la], ub = [(q[0] - v[0]) / lb, (q[1] - v[1]) / lb];
    const th = Math.acos(clamp(ua[0] * ub[0] + ua[1] * ub[1], -0.995, 0.995)); // interior angle
    let r = Math.max(0.002, radii[i]), tl = r / Math.tan(th / 2);
    if (tl > Math.min(la, lb) * 0.48) {
      tl = Math.min(la, lb) * 0.48;
      r = tl * Math.tan(th / 2);
    }
    const bl = Math.hypot(ua[0] + ub[0], ua[1] + ub[1]), dc = r / Math.sin(th / 2);
    const c = [v[0] + ((ua[0] + ub[0]) / bl) * dc, v[1] + ((ua[1] + ub[1]) / bl) * dc];
    const a0 = Math.atan2(v[1] + ua[1] * tl - c[1], v[0] + ua[0] * tl - c[0]);
    let da = Math.atan2(v[1] + ub[1] * tl - c[1], v[0] + ub[0] * tl - c[0]) - a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    const pts = [];
    for (let k = 0; k <= nArc; k++) pts.push([c[0] + r * Math.cos(a0 + (da * k) / nArc), c[1] + r * Math.sin(a0 + (da * k) / nArc)]);
    return pts;
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(...arcs[i]);
    const a = arcs[i][nArc], b = arcs[(i + 1) % n][0], ne = Array.isArray(nEdge) ? nEdge[i] : nEdge;
    for (let k = 1; k <= ne; k++) {
      const t = k / (ne + 1), off = edgeFn ? edgeFn(i, t) : null;
      out.push([lerp(a[0], b[0], t) + (off ? off[0] : 0), lerp(a[1], b[1], t) + (off ? off[1] : 0)]);
    }
  }
  return out;
}

/** Small black recline lever on the right-hand side face (x = side face, sx = outward sign). */
function addLever(g, m, [x, y, z], sx) {
  g.add(K.partMesh(K.cylinder(0.006, 0.006, 0.028, { seg: 8, center: true }), m, null, { position: [x + sx * 0.012, y, z], rotation: [0, 0, Math.PI / 2] }));
  g.add(K.partMesh(K.roundedBox(0.011, 0.013, 0.07, 0.005, 1), m, null, { position: [x + sx * 0.026, y - 0.01, z - 0.028], rotation: [0.35, 0, 0] }));
}

/**
 * Fabric side panels of a box recliner by arm style (params.armStyle; unset = the older panel code):
 *   petal  narrow foot, the outer face curving out under a broad rounded top with an outward lip (Zermatt, Girona,
 *          Sublim, Kansas, Taycan)
 *   board  flat boards, the outer face leaning out, small radii (Chicago, Ottawa, Astra, Relieve, Choice)
 *   round  thick soft panels with a big rounded top-front corner (Nakskov, Bredbjerg, Prince, Amina)
 *   roll   a narrower panel under a padded roll that overhangs outward and curls down at the front (Bern; MUREN's
 *          rolled arm with armFrontDrop 0)
 * Numbers (m) override the style: armFlare (outer face inset at the foot), armLip / armLipH (outward lip of the
 * top), armTopR (top edge radius), armFrontR / armRearR (bottom corners seen from the side), armFrontTopR,
 * armFrontLean (the front recedes toward the foot), armPlanR (front corner radius seen from above), armRoll /
 * armRollH (roll overhang / height), armFrontDrop, seatNose (the arm fronts stand back from the seat front),
 * armWelt (a welt round the top).
 */
const RECLINER_ARMS = {
  petal: { flare: 0.065, flarePow: 1, lip: 0.03, topR: 0.045, topTilt: 0.02, frontR: 0.12, rearR: 0.22, frontTopR: 0.06, planR: 0.9, welt: true },
  board: { flare: 0.035, flarePow: 1, lip: 0, topR: 0.022, frontR: 0.05, rearR: 0.06, frontTopR: 0.015, planR: 0.3, welt: true },
  round: { flare: 0.012, flarePow: 1.5, lip: 0, topR: 0.05, frontR: 0.06, rearR: 0.08, frontTopR: 0.12, planR: 0.9, welt: false },
  roll: { flare: 0.02, flarePow: 1, lip: 0, topR: 0.02, frontR: 0.1, rearR: 0.08, frontTopR: 0, planR: 0.5, welt: false, roll: 0.03, rollH: 0.1 },
  // none: armless – the sides are only a thin shell lip round the seat cushion, armLipH high (HAVBERG)
  none: { flare: 0, flarePow: 1, lip: 0, topR: 0.01, frontR: 0.05, rearR: 0.06, frontTopR: 0, planR: 0.5, welt: false, none: true },
  // egg: the sides of a deep egg-shaped bowl – round top dropping toward the back (armRise < 0), big radii all
  // round, the outer face bulging and curving in under the bowl (Paz)
  egg: { flare: 0.05, flarePow: 2.2, lip: 0, topR: 0.045, frontR: 0.2, rearR: 0.26, frontTopR: 0.2, planR: 0.95, welt: false },
  // pad: no side panels – a wide, low saucer under the seat (saucerH deep, its rim under the cushion) and short
  // thick pillow pads (armPadL long, armRollH tall, armW wide) floating over its rim near the back (Split)
  pad: { flare: 0, flarePow: 1, lip: 0, topR: 0.02, frontR: 0.05, rearR: 0.05, frontTopR: 0, planR: 0.5, welt: false, pad: true },
};

function reclinerArmStyle(P) {
  const base = RECLINER_ARMS[P.armStyle];
  if (!base) return null;
  const o = { ...base };
  const map = { armFlare: 'flare', armFlarePow: 'flarePow', armLip: 'lip', armTopR: 'topR', armFrontR: 'frontR', armRearR: 'rearR', armFrontTopR: 'frontTopR', armPlanR: 'planR', armRoll: 'roll', armRollH: 'rollH', armFrontLean: 'frontLean' };
  for (const [k, v] of Object.entries(map)) if (typeof P[k] === 'number') o[v] = P[k];
  if (typeof P.armWelt === 'boolean' || P.armWelt === 'edge') o.welt = P.armWelt;
  o.frontLean = num(o.frontLean, 0);
  o.roll = num(o.roll, 0);
  o.rollH = num(o.rollH, 0.1);
  return o;
}

/** Low-poly covered button for tufted recliner backs, seats and stools (HAVBERG has dozens). */
function tuftButton(q) {
  return K.sharedGeometry(`recliner-tuft-button-${q < 1 ? 0 : 1}`, () => {
    const s = K.sphere(0.01, { wSeg: q < 1 ? 6 : 8, hSeg: 4 });
    s.scale(1, 1, 0.5);
    return s;
  });
}

/** «Spider» swivel base (Bern): flat bars arching from a tall hub down to small feet, a column up to topY. */
function spiderBase(g, ms, { r, topY, q, arms = 4, z = 0, bend = 1.6, bar = 0.017, hub = 0.1 }) {
  const sub = new THREE.Group();
  sub.position.z = z;
  g.add(sub);
  const m = ms.legs();
  const hubH = Math.min(hub, topY - 0.02), hubR = 0.036;
  sub.add(K.partMesh(K.cylinder(hubR * 0.8, hubR, hubH, { seg: Math.max(12, Math.round(20 * q)) }), m, 'legs'));
  const a0 = arms === 4 ? Math.PI / 4 : Math.PI / 2;
  for (let i = 0; i < arms; i++) {
    const ang = a0 + (i / arms) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
    const pts = [];
    for (let k = 0; k <= 9; k++) {
      const t = k / 9, rr = lerp(hubR * 0.6, r - 0.015, t);
      // up a little off the hub, then a long arch down to the floor
      const y = t < 0.2 ? lerp(hubH * 0.72, hubH * 0.8, t / 0.2) : lerp(hubH * 0.8, 0.01, ((t - 0.2) / 0.8) ** bend);
      pts.push([c * rr, y, s * rr]);
    }
    sub.add(K.partMesh(sweepGeometry(pts, { a: bar, b: 0.007, r: 0.5, side: [-s, 0, c], nc: 2, ns: 1, nEnd: 2, capLen: 0.5 }), m, 'legs'));
    sub.add(K.partMesh(K.cylinder(0.013, 0.015, 0.006, { seg: 10 }), mat('plastic', '#1a1a1a'), null, { position: [c * (r - 0.02), 0, s * (r - 0.02)] }));
  }
  if (topY > hubH + 0.004) sub.add(K.partMesh(K.cylinder(0.022, 0.024, topY - hubH, { seg: Math.max(10, Math.round(18 * q)) }), m, 'legs', { position: [0, hubH, 0] }));
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
  // Stressless (body 'classic'): params.base 'classic' (wooden ring + uprights), 'cross' or 'star' (metal; the arm pads
  // ride on steel arm loops) – default from legStyle / star; params.armPad 'slab' (Opal), 'plump' (Mayfair) or 'slim'
  const sBase = body !== 'classic' ? null : ['classic', 'cross', 'star'].includes(P.base) ? P.base : P.legStyle === 'swivel-star' ? (st.slim ? 'star' : 'cross') : 'classic';
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
  const legH = clamp(num(P.legH, 0.15), 0.04, seatH - (body === 'shell' ? 0.1 : 0.2)); // (a shallow shell bowl can sit high on its column)
  const zr = -d / 2, zf = d / 2;
  const yb = legH + 0.02; // underside of the chair body (mechanism plate under it)
  // moulded shell options (body 'shell'): params.armPad 'round' (default) | 'lid' (flat, piped lid: Timeout) | 'petal'
  // (broad front curling out, narrowing back: Falcon) | 'scroll' (front end rolled down: Afterwork); the shell's top
  // stays shIn inside dims.w so the pads can curl out over it. shellTaper: a tulip bowl (its half-width at the bottom
  // as a fraction of the half-width at the arms, 1 = straight walls); shellBottom: the bowl's underside (m)
  const shPad = body === 'shell' && ['lid', 'petal', 'scroll'].includes(P.armPad) ? P.armPad : 'round';
  const shIn = { round: 0, lid: 0.012, petal: 0.04, scroll: 0.012 }[shPad];
  const shTaper = clamp(num(P.shellTaper, 1), 0.3, 1), shYB = num(P.shellBottom, NaN);
  const shF = (y, y0, y1) => (shTaper >= 1 ? 1 : lerp(shTaper, 1, clamp01((y - y0) / Math.max(0.05, y1 - y0))));
  // the shell's front: params.seatNose (m) – the seat's rounded front stands that much out over the shell's front lip;
  // negative: the shell comes forward round the seat (Timeout: arm fronts, shell and seat one rounded «D»)
  const zFsh = zf - 0.045 - clamp(num(P.seatNose, 0), -0.04, 0.1);
  const shT = 0.022; // moulded shell wall
  const integrated = st.rest === 'integrated' || P.frontPanel === true; // frontPanel: a seat cushion over a closed front panel
  // tulip arm: thickness tkT(t) and centre |x| xcT(t) from the foot (t = 0) to the top (t = 1): it hugs the seat at
  // tS and leans out above it into the broad, outward-curling top (Taycan); the foot tucks in under the seat
  const tk0 = 0.045, tk1 = clamp(armW * 0.85, 0.06, 0.11), tFlare = clamp(w * 0.08, 0.04, 0.075);
  const ya0 = body === 'tulip' && typeof P.armBottom === 'number' ? clamp(P.armBottom, yb + 0.01, seatH - 0.1) : Math.max(yb + 0.03, seatH - 0.3);
  const tS = clamp01((seatH - 0.07 - ya0) / (armH - ya0));
  const tkT = (t) => lerp(tk0, tk1, sstep(0.4, 1, t));
  // inner face beside the seat; the rounded top cap insets the curl, so the arms are pushed out to reach dims.w
  const xI0 = w / 2 - tk1 - tFlare + Math.min(0.035, tk1 * 0.35);
  const tC = lerp(tS, 1, 0.3); // the curl starts a little above the seat
  const xInT = (t) => (t >= tC ? xI0 + tFlare * ((t - tC) / (1 - tC || 1)) ** 1.8 : xI0 - 0.05 * (1 - Math.min(1, t / (tS || 1))) ** 1.5);
  const xcT = (t) => xInT(t) + tkT(t) / 2;
  let iw, bw;
  if (body === 'box' && P.armStyle === 'pad') {
    iw = w - 0.03; // the seat cushion spans the saucer under it (Split)
    bw = Math.min(w - 0.2, iw);
  } else if (body === 'box') {
    iw = w - 2 * armW + 0.012;
    // the back sits between the arm panels' inner halves (Chicago, Bern); Zermatt / Grande have a narrower back
    bw = Math.min(w - armW, iw + (P.sides === 'fabric' || (!P.sides && st.sides === 'fabric') ? 0.05 : 0.025));
  } else if (body === 'shell') {
    // (a tulip bowl is narrower at the seat: the seat fits inside its walls)
    iw = (w - 2 * shIn) * shF(seatH - 0.03, num(shYB, legH + 0.02), armH - 0.06) - 2 * shT - 0.03;
    bw = num(P.backW, w * 0.6);
  } else if (body === 'classic') {
    iw = w - 2 * armW - 0.006; // the arm pads sit outboard of the seat (Stressless)
    bw = clamp(num(P.backW, iw - 0.01), 0.4, iw - 0.01); // params.backW: a slimmer Stressless back (Paris)
  } else {
    iw = 2 * xI0 + 0.01; // tucked into the arms (its rounded sides would leave a gap)
    bw = iw + 0.01;
  }
  if (typeof P.backW === 'number' && (body === 'box' || body === 'tulip')) bw = clamp(P.backW, 0.3, w - 0.04); // back width at the seat
  const seatD = clamp(num(P.seatD, d * 0.62), 0.36, d - 0.22);
  const zSF = zf - 0.012; // seat front
  const zP = zSF - seatD * 0.93; // front of the back at the seat (seatD is measured to the bulging lumbar)
  const yP = seatH - (body === 'classic' ? 0.15 : 0.1); // bottom of the back (inside the seat; Stressless: the body runs on down behind it)
  const T0 = body === 'shell' ? 0.15 : body === 'classic' ? 0.16 : 0.19, T1 = body === 'shell' ? 0.12 : body === 'classic' ? num(P.backT, 0.14) : 0.135;
  const sep = st.head === 'block' || st.head === 'roll' || st.head === 'wing';
  const headH = st.head === 'roll' ? clamp(h * 0.19, 0.15, 0.21) : st.head === 'wing' || st.head === 'block' ? (typeof P.headH === 'number' ? clamp(P.headH, 0.1, 0.3) : clamp(h * 0.2, 0.16, 0.24)) : 0;
  const gap = sep ? (st.head === 'roll' ? -0.03 : st.head === 'block' || st.head === 'wing' ? clamp(num(P.headGap, 0.007), -0.3, 0.08) : 0.007) : 0; // the roll rests on the rounded top of the back cushion
  // recline: as much as the depth behind the seat allows (the top of the back stays inside dims.d)
  const recDef = num(P.recline, body === 'shell' ? 20 : body === 'tulip' ? 20 : 18) * DEG;
  // (the shell's back rim is low, so only the cushion top of a Timeout may lean a little past dims.d)
  const room = zP - zr + (body === 'shell' ? 0.05 : body === 'classic' ? 0.04 : 0.012) - T1 - (body === 'shell' ? shT + 0.012 : 0); // (a Stressless head leans out over its base a little too)
  const rec = clamp(Math.atan(Math.max(0, room) / (h - yP)), 2 * DEG, recDef);
  const cr = Math.cos(rec), tr = Math.tan(rec);
  const L = (h - yP) / cr - headH - gap - (st.head === 'wing' ? 0.02 : sep ? 0.008 : 0); // the back's own length (local y); a separate neck cushion leans forward and up
  const Tat = (yl) => lerp(T0, T1, clamp01(yl / L));
  const rearZ = (y) => zP - Math.max(0, y - yP) * tr - Tat(Math.max(0, y - yP) / cr) / cr; // world z of the back's rear
  const ylSeat = Math.max(0.03, (seatH - 0.035 - yP) / cr); // the seat surface in back coordinates
  // Stressless (classic): the back runs on down behind the seat to its rear-bottom edge at params.bodyBottom (m), and the
  // seat's underside sweeps up from its foot to the nose – one «dyne» body; back coordinates → world [z, y]
  const yBotC = clamp(num(P.bodyBottom, seatH - 0.21), 0.06, yP - 0.03), y0C = Math.min(-0.02, (yBotC - yP + T0 * Math.sin(rec)) / cr);
  const backToWorld = (yl, zl) => [zP - yl * Math.sin(rec) + zl * cr, yP + yl * cr + zl * Math.sin(rec)];

  // ---- back: one loft with sewn seams (pillowed panels, creased seam lines), or a smooth shell + cushion
  const back = new THREE.Group();
  back.position.set(0, yP, zP);
  back.rotation.x = -rec;
  g.add(back);
  const yNeck = st.head === 'integrated' ? L - (typeof P.neckH === 'number' ? clamp(P.neckH, 0.1, 0.3) : clamp(h * 0.2, 0.17, 0.24)) : Infinity;
  // lumbarH: the lumbar seam's height above the seat (along the back); backBands: extra evenly spaced seams between
  // it and the neck / top (stacked puffed panels); seamCurve: the seam ends rise toward the sides (a «smile»)
  const yLum = ylSeat + num(P.lumbarH, st.seams === 'buttons' ? 0.25 : body === 'shell' ? 0.24 : 0.2);
  const seamsY = [];
  // 'neck': only the seam under the integrated neck (Tankedal); 'bolster' has no lumbar seam either (Prince)
  const noLum = st.seams === 'none' || st.seams === 'v' || st.seams === 'neck' || st.seams === 'quilt' || st.seams === 'bolster';
  if (!noLum && yLum < Math.min(yNeck, L) - 0.12) seamsY.push(yLum);
  if (seamsY.length && P.backBands > 0) {
    const nB = Math.round(clamp(P.backBands, 0, 4)), yE = Math.min(yNeck, L);
    for (let i = 1; i <= nB; i++) seamsY.push(lerp(yLum, yE, i / (nB + 1)));
  }
  if (yNeck < L) seamsY.push(yNeck);
  // 'v': only the vertical centre seam, from the seat up (two back cushions side by side, Sublim)
  // (vSeam 'top': the seam runs right up over the top edge, Sublim's two back cushions)
  const vBand = (st.seams === 'cross-v' && seamsY.length) || st.seams === 'v' ? [P.vSeam === 'full' || P.vSeam === 'top' || st.seams === 'v' ? ylSeat + 0.02 : yLum, Math.min(yNeck, L - (P.vSeam === 'top' ? 0 : 0.08))] : null;
  // 'bolster' (Prince): a centre panel between two side bolsters, narrowing toward the seat (slanted seams)
  const bolster = st.seams === 'bolster' && seamsY.length ? [ylSeat + 0.02, Math.min(yNeck, L - 0.06)] : null;
  // 'tufted' (HAVBERG): tuftCols × tuftRows dimples (with buttons) over the back between the seat and the top
  // 'quilt' (HAVBERG's pinched tufting): the same points pinched without buttons, seams through them in both
  // directions and the square pads between them puffed
  const quilt = st.seams === 'quilt';
  const tufts = st.seams === 'tufted' || quilt ? (() => {
    const nc = Math.round(clamp(num(P.tuftCols, 3), 1, 5)), nr = Math.round(clamp(num(P.tuftRows, 3), 1, 6));
    const y0 = ylSeat + clamp(num(P.tuftFrom, 0.12), 0, 0.4), y1 = L - clamp(num(P.tuftTop, 0.1), 0.02, 0.4);
    const ys = [];
    for (let i = 0; i < nr; i++) ys.push(lerp(y0, y1, nr > 1 ? i / (nr - 1) : 0.5));
    return { nc, ys, xs: (xf) => Array.from({ length: nc }, (_, i) => (nc > 1 ? lerp(-1, 1, i / (nc - 1)) : 0) * xf * clamp(num(P.tuftSpread, 0.55), 0.1, 0.9)) };
  })() : null;
  const sig = 0.032;
  const dip = (v, s0) => 1 - Math.exp(-(((v - s0) / sig) ** 2));
  const groove = (v, s0) => Math.exp(-(((v - s0) / 0.007) ** 2));
  const pillowA = pile ? 0.006 : clamp(num(P.backPuff, 0.02), 0, 0.05);
  const curveA = clamp(num(P.seamCurve, 0), -0.08, 0.08);
  // seam pillowing on the front face (0 at the edge of the flat front, xf); the lumbar / neck profile moves the whole front
  const backFront = (x, yl, xf) => {
    let py = 1, gr = 0;
    const cy = curveA ? curveA * Math.min(1, (x / xf) ** 2) : 0;
    for (const s of seamsY) {
      const s1 = s === yLum ? s + cy : s;
      py *= dip(yl, s1);
      gr += groove(yl, s1);
    }
    let px = 1 - Math.pow(Math.min(1, Math.abs(x) / xf), 4);
    if (vBand) {
      const inside = sstep(vBand[0] - 0.01, vBand[0] + 0.03, yl) * (1 - sstep(vBand[1] - 0.03, vBand[1] + 0.01, yl));
      px *= 1 - inside * (1 - dip(x, 0));
      gr += inside * groove(x, 0);
    }
    if (bolster) {
      const inside = sstep(bolster[0] - 0.01, bolster[0] + 0.03, yl) * (1 - sstep(bolster[1] - 0.03, bolster[1] + 0.01, yl));
      const xs = xf * lerp(0.3, 0.62, clamp01((yl - bolster[0]) / (bolster[1] - bolster[0])));
      const ax = Math.abs(x);
      // the bolsters stand proud of the centre panel, with a seam where they meet
      px = lerp(px, ax > xs ? px * (1 + 0.6 * sstep(xs, xs + 0.05, ax)) : px * 0.55, inside);
      gr += inside * groove(ax, xs);
    }
    let tu = 0;
    if (tufts) for (const ty of tufts.ys) for (const tx of tufts.xs(xf)) tu += Math.exp(-((x - tx) ** 2 + (yl - ty) ** 2) / 0.034 ** 2);
    if (quilt) {
      const y0 = tufts.ys[0], y1 = tufts.ys[tufts.ys.length - 1];
      const yIn = sstep(y0 - 0.14, y0 - 0.07, yl) * (1 - sstep(y1 + 0.07, y1 + 0.14, yl)), xIn = 1 - sstep(xf * 0.8, xf * 1.05, Math.abs(x));
      for (const tx of tufts.xs(xf)) {
        px *= 1 - yIn * (1 - dip(x, tx));
        gr += yIn * groove(x, tx) * 0.8;
      }
      for (const ty of tufts.ys) {
        py *= 1 - xIn * (1 - dip(yl, ty));
        gr += xIn * groove(yl, ty) * 0.8;
      }
    }
    return pillowA * py * px - 0.006 * Math.min(1, gr) - (quilt ? 0.012 : 0.018) * Math.min(1, tu);
  };
  const backBase = (yl) => 0.016 * Math.exp(-(((yl - (ylSeat + 0.12)) / 0.13) ** 2)) + (Number.isFinite(yNeck) ? 0.026 * sstep(yNeck - 0.01, yNeck + 0.07, yl) : 0);
  const seamExtra = seamsY.flatMap((s) => [s - 0.03, s - 0.012, s, s + 0.012, s + 0.03]).concat(vBand ? [vBand[0] + 0.03, vBand[1] - 0.03] : [], tufts ? tufts.ys.flatMap((t) => [t - 0.025, t, t + 0.025]) : []);
  // roundTop: the top edge rings follow hw(y) (an arched back, Bredbjerg) instead of insetting the last level's loop
  const backLoft = ({ hw, zRear, zFront = () => 0, front, y0 = 0, y1, rTop, rBot = 0.012, rf = 0.04, rb = 0.05, coarse = false, extra = [], roundTop = false }) => {
    // coarse: a plain shell behind inset cushions needs no seam rows; extra: more levels (a rounded top)
    const ys = levelsY(y0 + rBot, y1 - rTop, (coarse ? [] : seamExtra).concat(extra), coarse ? step * 1.5 : step);
    const hw0 = typeof hw === 'function' ? hw(0) : hw;
    const nx = 2 * Math.max(4, Math.round(hw0 / (coarse ? step : bolster ? step * 0.45 : tufts ? step * 0.75 : step)));
    const levels = ys.map((yl) => {
      const hwv = typeof hw === 'function' ? hw(yl) : hw;
      // corner radii never below the cap radii (an inset ring larger than a corner radius folds over)
      const rMin = Math.max(rTop, rBot) * 1.02, rfE = Math.max(rf, rMin);
      return { y: yl, loop: rrLoop(hwv, zRear(yl), zFront(yl), rfE, Math.max(rb, rMin), { nx, nArc: 5, nSide: 3, front: front ? (x) => front(x, yl, hwv - rfE) : null }) };
    });
    const yT = ys[ys.length - 1], rMin = Math.max(rTop, rBot) * 1.02;
    const topRing = roundTop && typeof hw === 'function' ? (ins, y) => {
      const yl = Math.min(y, y1 - 0.002), hwv = Math.max(0.02, hw(yl) - ins * 0.3), zR = zRear(yT) + ins, zF = Math.max(zR + 0.01, zFront(yT) - ins);
      const rfE = Math.max(1e-4, Math.min(Math.max(rf, rMin) - ins, hwv * 0.9)), fade = 1 - clamp01(ins / Math.max(1e-4, rTop));
      return rrLoop(hwv, zR, zF, rfE, Math.max(1e-4, Math.min(Math.max(rb, rMin) - ins, hwv * 0.9)), { nx, nArc: 5, nSide: 3, front: front ? (x) => front(x, yT, hwv - rfE) * fade : null });
    } : undefined;
    return loftGeometry(levels, { top: rTop, bottom: rBot, nEdge: roundTop ? 7 : 4, nCap: 3, topRing });
  };
  const rTopB = Math.min(T1 * 0.48, 0.075);
  let tuftHw = () => bw / 2 - Math.max(0.04, rTopB * 1.02); // half width of the back's flat front (tuft buttons)
  if (body === 'shell') {
    // params.backFlare: the back widens (+, wing back: Afterwork) or narrows (−) toward the top – linearly, or from
    // params.flareFrom (a fraction of its length) up; params.backEdge: the radius of its edges (small: crisp, square
    // shoulders); in a tulip bowl (shellTaper) its foot narrows with the bowl's walls
    const flareB = num(P.backFlare, -0.1), fFrom = clamp(num(P.flareFrom, 0), 0, 0.9);
    const eB = clamp(num(P.backEdge, Math.min(T1 * 0.5, 0.065)), 0.012, 0.08);
    const flareAt = (yl) => (fFrom > 0 ? sstep(fFrom * L, L - eB, yl) : clamp01(yl / L));
    const ysB = Math.min(num(shYB, legH + 0.02), seatH - clamp(num(P.seatT, 0.16), 0.08, 0.22) - 0.01);
    const yArmB = armH - num(P.armPadH, shPad === 'lid' ? 0.055 : 0.065) + 0.006;
    const footW = (yl) => (shTaper < 1 ? (w / 2 - shIn) * shF(yP + yl * cr - 0.05, ysB, yArmB) - shT - 0.015 : Infinity);
    const hwS = (yl) => Math.min((bw / 2) * (1 + flareB * flareAt(yl)), footW(yl));
    // params.wingAngle (°): the outer parts beyond params.wingX (fraction of the half width) turn forward above
    // params.wingFrom (fraction of the length) – wing panels, marked by a soft seam (Afterwork)
    const wingA = clamp(num(P.wingAngle, 0), 0, 45) * DEG, wX = clamp(num(P.wingX, 0.62), 0.3, 0.9), wFrom = clamp(num(P.wingFrom, 0.45), 0, 0.95) * L;
    const wingOn = (yl) => sstep(wFrom, wFrom + 0.25, yl);
    const frontS = wingA ? (x, yl, xf) => backFront(x, yl, xf) - 0.007 * wingOn(yl) * Math.exp(-(((Math.abs(x) - wX * hwS(yl)) / 0.022) ** 2)) : backFront;
    const crisp = wingA > 0 || P.backEdge != null, rC = Math.max(eB * 1.05, 0.03);
    const geoS = backLoft({ hw: hwS, zRear: (yl) => -Tat(yl), zFront: backBase, front: frontS, y1: L, rTop: eB, rBot: Number.isFinite(shYB) ? 0.04 : 0.012, rf: crisp ? Math.max(rC, 0.035) : 0.06, rb: crisp ? Math.max(rC, 0.04) : 0.07 });
    if (wingA) {
      const p = geoS.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const yl = p.getY(i), xw = wX * hwS(yl), ax = Math.abs(p.getX(i));
        if (ax > xw) p.setZ(i, p.getZ(i) + (ax - xw) * Math.tan(wingA) * wingOn(yl));
      }
      p.needsUpdate = true;
      K.smoothNormals(geoS);
      geoS.computeBoundingBox();
      geoS.computeBoundingSphere();
    }
    addUp(back, geoS);
    if (P.neckPillow === true) {
      // a separate neck pillow on the front of the head section (Afterwork, held by a magnet): params.pillowW / pillowH
      // / pillowD (m), its centre params.pillowDrop below the top of the back
      const pw = clamp(num(P.pillowW, Math.min(0.36, bw * 0.58)), 0.15, bw), ph = clamp(num(P.pillowH, 0.13), 0.06, 0.3);
      const pd = clamp(num(P.pillowD, 0.065), 0.03, 0.12), yl = L - clamp(num(P.pillowDrop, 0.075 + ph / 2), ph / 2, L * 0.4);
      addUp(back, softBox(pw, ph, pd, 'z', { puff: 0.18, round: 0.85, sides: 0.2, q, seg: segFor(pw, ph) }), { position: [0, yl, backBase(yl) + pd / 2 - 0.012] });
    }
  } else if (body === 'classic') {
    // Stressless: the back runs on down behind the seat to the body's rear-bottom edge (yBotC); params.backFlare widens
    // (+) or narrows (−) it from the arms to the top (Mayfair's broad shoulders)
    const flareC = clamp(num(P.backFlare, 0), -0.3, 0.3), ylArm = (armH - yP) / cr;
    const hwC = flareC ? (yl) => (bw / 2) * (1 + flareC * sstep(ylArm, L - 0.08, yl)) : bw / 2;
    // channel backs: params.backBands extra cross seams evenly between the lumbar and neck seams (Opal 1) – unless the
    // shared seam code has added them already; the panels puff up more between the seams than on other backs
    if (seamsY.length === 2 && Number.isFinite(yNeck)) {
      const nB = clamp(Math.round(num(P.backBands, 0)), 0, 3), s0 = seamsY[0], s1 = seamsY[1];
      for (let k = 1; k <= nB; k++) {
        const s = lerp(s0, s1, k / (nB + 1));
        seamsY.splice(k, 0, s);
        seamExtra.push(s - 0.03, s - 0.012, s, s + 0.012, s + 0.03);
      }
    }
    // (the Stressless head section stands further forward: a rounded head roll)
    const headFwd = (yl) => (Number.isFinite(yNeck) ? 0.014 * sstep(yNeck - 0.01, yNeck + 0.07, yl) : 0);
    // params.vSeam 'full': the vertical centre seam (cross-v) runs from the seat up, through every row (Mayfair) – unless
    // the shared seam code already starts it there
    const v0 = vBand && P.vSeam === 'full' && vBand[0] > ylSeat + 0.06 ? vBand[0] : 0;
    const vLow = (x, yl) => (v0 ? sstep(ylSeat + 0.01, ylSeat + 0.05, yl) * (1 - sstep(v0 - 0.03, v0 + 0.01, yl)) * (0.016 * (1 - dip(x, 0)) + 0.006 * groove(x, 0)) : 0);
    addUp(back, backLoft({ hw: hwC, zRear: (yl) => -Tat(yl), zFront: (yl) => backBase(yl) + headFwd(yl), front: (x, yl, xf) => 1.4 * backFront(x, yl, xf) - vLow(x, yl), y0: y0C, y1: L, rTop: rTopB, rBot: 0.05, rf: 0.05, rb: 0.06 }));
  } else if (body === 'box' && st.sides === 'shell') {
    addFrame(back, backLoft({ hw: bw / 2, zRear: (yl) => -Tat(yl), y1: L, rTop: rTopB, rf: 0.03 }));
    const cT = 0.075;
    addUp(back, backLoft({ hw: bw / 2 - 0.024, zRear: () => -0.035, zFront: (yl) => cT + backBase(yl), front: backFront, y0: ylSeat - 0.07, y1: L - 0.004, rTop: 0.045, rBot: 0.03, rf: 0.035, rb: 0.01 }));
  } else if ((body === 'box' || body === 'tulip') && (P.backTaper > 0 || P.backTopR > 0 || P.armStyle)) {
    // backTaper: the back narrows toward the top by this fraction; backTopR: rounded top corners seen from the front
    const taper = clamp(num(P.backTaper, 0), -0.3, 0.4), rC = clamp(num(P.backTopR, 0), 0, bw * 0.45); // (< 0: the back widens toward the shoulders, MUREN)
    // backWaist (Paz): the back narrows by this fraction round backWaistY (fraction of its length) and widens again above
    const waist = clamp(num(P.backWaist, 0), -0.3, 0.3), wY = clamp(num(P.backWaistY, 0.5), 0.1, 0.9);
    const hwB = (yl) => (bw / 2) * (1 - taper * sstep(0.25 * L, L, yl)) * (1 - waist * Math.exp(-(((yl / L - wY) / 0.16) ** 2))) - (rC > 0 ? rC - Math.sqrt(Math.max(0, rC * rC - Math.max(0, yl - (L - rC)) ** 2)) : 0);
    const wrap = clamp(num(P.backWrap, 0), 0, bw * 0.2);
    if (wrap > 0) {
      // backWrap (Amina): an upholstered outer shell round inset back cushions that stand proud of it (m of the
      // shell showing at each side); backWrapTop: the cushions stop this far below the shell top (its «ears»);
      // armFrame: the shell in the frame material (HAVBERG)
      const shellGeo = backLoft({ hw: hwB, zRear: (yl) => -Tat(yl), y0: -0.04, y1: L, rTop: rTopB, rf: 0.03, coarse: true });
      if (P.armFrame === true && hasFrame) addFrame(back, shellGeo);
      else addUp(back, shellGeo);
      const cT = clamp(num(P.backWrapT, 0.08), 0.03, 0.16), topC = clamp(num(P.backWrapTop, 0.05), 0, 0.3);
      tuftHw = (yl) => Math.max(0.05, hwB(Math.min(yl, L - topC)) - wrap) - 0.0459;
      addUp(back, backLoft({ hw: (yl) => Math.max(0.05, hwB(Math.min(yl, L - topC)) - wrap), zRear: () => -0.03, zFront: (yl) => cT + backBase(yl), front: backFront, y0: ylSeat - 0.06, y1: L - topC, rTop: 0.045, rBot: 0.03, rf: 0.04, rb: 0.01 }));
    } else {
      tuftHw = (yl) => hwB(yl) - Math.max(0.04, rTopB * 1.02);
      // a big top radius (Bredbjerg's arched back) needs denser levels and a smaller cap radius
      // (fabric arm styles: the arch rounds front to back too, its top edge rings following the arch)
      const roundTop = rC > 0.1 && !!P.armStyle && st.sides === 'fabric';
      const rTopC = rC > 0.1 && !roundTop ? Math.min(rTopB, 0.015) : rTopB, extraC = [];
      if (rC > 0.1) for (let k = 1; k < 8; k++) extraC.push(L - rTopC - (rC - rTopC) * (1 - k / 8) ** 1.6);
      addUp(back, backLoft({ hw: hwB, zRear: (yl) => -Tat(yl), zFront: backBase, front: backFront, y0: P.armStyle ? -0.04 : 0, y1: L, rTop: rTopC, extra: extraC, roundTop }));
    }
  } else {
    addUp(back, backLoft({ hw: bw / 2, zRear: (yl) => -Tat(yl), zFront: backBase, front: backFront, y1: L, rTop: rTopB }));
  }
  if (tufts && !quilt) {
    const bg = tuftButton(q), wrapT = P.backWrap > 0 ? clamp(num(P.backWrapT, 0.08), 0.03, 0.16) : 0;
    for (const ty of tufts.ys) {
      const xf = Math.max(0.05, tuftHw(ty));
      for (const tx of tufts.xs(xf)) back.add(K.partMesh(bg, ms.up, 'upholstery', { position: [tx, ty, wrapT + backBase(ty) + backFront(tx, ty, xf) + 0.003] }));
    }
  }
  if (st.seams === 'buttons' && seamsY.length) {
    const bg = sharedButton(q);
    for (let i = 0; i < 4; i++) back.add(K.partMesh(bg, ms.up, 'upholstery', { position: [((i + 0.5) / 4 - 0.5) * bw * 0.72, yLum + 0.004, backBase(yLum) + backFront(0, yLum, bw / 2) + 0.002] }));
  }

  // ---- neck cushion (separate pieces sit on two posts above the back)
  const yH = L + gap;
  if (gap > 0 && P.headPosts !== false) {
    for (const sx of [-1, 1]) back.add(K.partMesh(K.cylinder(0.006, 0.006, gap + 0.09, { seg: 8 }), ms.legs(), 'legs', { position: [sx * bw * 0.22, L - 0.05, -0.06] }));
  }
  // block / pillow head: headW, headH, headD (m), headRound, headPuff, headSeams (2 = vertical seams at ±headSeamX
  // of the width, Zermatt), headTilt (deg forward); pillow: a small cushion hanging in front of the back's top
  // (headDrop below it, Choice, Paz)
  const headSeamed = (geo, hwB, hd) => {
    if (!(P.headSeams > 0)) return geo;
    const xs = (hwB / 2) * clamp(num(P.headSeamX, 0.5), 0.15, 0.85);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const fr = clamp01(p.getZ(i) / (hd / 2));
      if (fr > 0.2) p.setZ(i, p.getZ(i) - fr * (0.01 * (1 - dip(Math.abs(p.getX(i)), xs)) + 0.003 * groove(Math.abs(p.getX(i)), xs)));
    }
    p.needsUpdate = true;
    K.smoothNormals(geo);
    K.worldUV(geo);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  };
  if (st.head === 'block' || st.head === 'pillow') {
    const pillow = st.head === 'pillow';
    const hwB = clamp(num(P.headW, pillow ? bw * 0.6 : bw * 0.97), 0.15, w), hd = clamp(num(P.headD, pillow ? 0.1 : 0.15), 0.04, 0.25);
    const hh = pillow ? clamp(num(P.headH, 0.15), 0.08, 0.3) : headH;
    const seg = P.headSeams > 0 ? Math.max(18, segFor(hwB) * 3) : segFor(hwB, hh);
    const geo = headSeamed(softBox(hwB, hh, hd, 'z', { puff: num(P.headPuff, 0.14), round: clamp(num(P.headRound, 0.75), 0.1, 1), sides: 0.2, q, seg }), hwB, hd);
    // headTaper: the bottom's width as a fraction of the top's (a wing-shaped cushion, Relieve); headWing (m): its
    // top corners rise and come forward by this much
    const hTaper = clamp(num(P.headTaper, 1), 0.6, 1.2), hWing = clamp(num(P.headWing, 0), 0, 0.08);
    if (hTaper !== 1 || hWing) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = clamp01(p.getY(i) / hh + 0.5), x = p.getX(i) * lerp(hTaper, 1, t), k = clamp01(Math.abs(x) / (hwB / 2)) ** 2;
        p.setXYZ(i, x, p.getY(i) + hWing * 0.6 * k * t, p.getZ(i) + hWing * k * t);
      }
      p.needsUpdate = true;
      K.smoothNormals(geo);
      K.worldUV(geo);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
    }
    const yc = pillow ? L - clamp(num(P.headDrop, 0.03), -0.1, 0.3) - hh / 2 : yH + hh / 2;
    const pos = [0, yc, (pillow ? backBase(yc) + pillowA + hd / 2 - 0.02 : 0.035 - hd / 2) + clamp(num(P.headFwd, 0), -0.1, 0.15)];
    addUp(back, geo, { position: pos, rotation: [clamp(num(P.headTilt, 0), -20, 30) * DEG, 0, 0] });
  } else if (st.head === 'flap') {
    // MUREN: a thin padded flap sewn on across the top of the back front, piped round the edge
    const fw = clamp(num(P.headW, bw * 0.78), 0.2, bw), fh = clamp(num(P.headH, 0.14), 0.06, 0.25), ft = 0.045;
    const yc = L - clamp(num(P.headDrop, 0.05), 0, 0.3) - fh / 2;
    addCushion(back, ms, softBox(fw, fh, ft, 'z', { puff: 0.12, round: 0.6, sides: 0.1, bottom: 0, q, seg: segFor(fw, fh) }), [0, yc, backBase(yc) + pillowA * 0.5 + ft / 2 - 0.012], ['front'], q);
  } else if (st.head === 'roll') {
    const hr = clamp(num(P.headW, bw * 1.04), 0.2, w) / 2, a = 0.08, b = headH / 2; // params.headW: the roll's width (Timeout)
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([lerp(-hr + a * 0.8, hr - a * 0.8, i / 8), yH + b, 0.065 - a]);
    addUp(back, sweepGeometry(pts, { a, b, r: 1, nc: Math.max(4, Math.round(6 * q)), ns: 2, nEnd: 5, capLen: 0.8 }));
  } else if (st.head === 'wing') {
    // wing-shaped neck cushion (Taycan): one cushion bent so the wings come forward, wider at the top, with two
    // vertical seams between the centre panel and the wings (a softBox deformed in place)
    // headW (top width), headTaper (bottom / top), headD, headFwd, headTilt override the proportions
    const T = clamp(num(P.headD, 0.11), 0.06, 0.2), hw1 = typeof P.headW === 'number' ? clamp(P.headW / 2, 0.12, w * 0.45) : Math.min(w * 0.38, bw * 0.62);
    const hw0 = typeof P.headTaper === 'number' ? hw1 * clamp(P.headTaper, 0.5, 1) : Math.min(bw * 0.5, w * 0.34), xc0 = Math.min(0.14, hw0 * 0.55);
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
    addUp(back, geo, { position: [0, yH + headH / 2, 0.035 - T / 2 + clamp(num(P.headFwd, 0), -0.1, 0.15)], rotation: [clamp(num(P.headTilt, 0), -20, 30) * DEG, 0, 0] });
  }

  // ---- arm style of a box with fabric sides (RECLINER_ARMS): the arms' side profile also shapes the body under the seat
  const AS = body === 'box' && st.sides === 'fabric' ? reclinerArmStyle(P) : null;
  // armFrame: side panels and the body under the seat in the frame material (HAVBERG's coated shell)
  const addSide = (parent, geo, opts) => (P.armFrame === true && hasFrame ? addFrame(parent, geo, opts) : addPlain(parent, geo, opts));
  const AG = AS && (() => {
    const yA0 = clamp(num(P.armBottom, Math.max(yb + 0.004, seatH - 0.3)), yb + 0.004, seatH - 0.05);
    const roll = AS.roll > 0 ? clamp(AS.roll, 0.005, armW * 0.45) : 0;
    const rollH = roll ? clamp(AS.rollH, 0.05, (armH - yA0) * 0.4) : 0;
    const yLip = AS.none ? clamp(num(P.armLipH, seatH - num(P.seatT, 0.14) + 0.03), yA0 + 0.04, armH) : 0;
    const yTop = yLip || (roll ? armH - rollH * 0.55 : armH); // panel top (inside the roll)
    const xi = w / 2 - armW;
    const xOut = w / 2 - roll;
    const tOf = (y) => clamp01((y - yA0) / (yTop - yA0));
    // armSplay: above the seat the inner face leans out by this much at the top (thin tulip petals, Girona, Taycan)
    const splay = clamp(num(P.armSplay, 0), 0, armW * 0.5);
    const rT = clamp(AS.topR, 0.008, ((xOut - xi - splay) / 2) * 0.85);
    // outer face: a round lip curling out under the rounded top (quarter circle of radius lip under yC), then the
    // face recedes by `flare` toward the foot (flarePow 1 = straight lean, > 1 = steep above / tucked in at the foot)
    const rl = clamp(AS.lip, 0, (yTop - yA0) * 0.3), yC = yTop - rT, yL = yC - rl;
    const circ = (r, dy) => r - Math.sqrt(Math.max(0, r * r - dy * dy));
    // armFootR: seen from the front the outer face curves in under the panel (a rounded foot, Zermatt, Amina)
    const footR = clamp(num(P.armFootR, 0), 0, (yTop - yA0) * 0.5);
    const xo = (y) => {
      const dy = Math.max(0, yC - y);
      const lipIn = rl > 0 ? (dy < rl ? rl - Math.sqrt(rl * rl - dy * dy) : rl) : 0;
      const x = xOut - lipIn - AS.flare * clamp01((yL - y) / Math.max(0.05, yL - yA0)) ** AS.flarePow;
      return footR > 0 ? Math.max(xi + 0.02, x - circ(footR, Math.max(0, yA0 + footR - y))) : x;
    };
    const zFa = zf - 0.006 - clamp(num(P.seatNose, 0), 0, 0.15);
    const rFB = clamp(AS.frontR, 0.02, (yTop - yA0) * 0.6), rBB = clamp(AS.rearR, 0.02, (yTop - yA0) * 0.75);
    const zFat = (y) => zFa - AS.frontLean * (1 - tOf(y)) - circ(rFB, Math.max(0, yA0 + rFB - y)) - (AS.frontTopR > rT ? circ(AS.frontTopR, Math.max(0, y - (yTop - AS.frontTopR))) : 0);
    // below the back the body's rear continues the back's rear line (half its slope) into the rounded bottom;
    // bodyRear 1: a vertical rear edge under the arm top's rear instead (Ottawa, Prince, MUREN; 0..1 blends)
    const rearV = clamp(num(P.bodyRear, 0), 0, 1);
    const rearX = (y) => lerp(y >= yP ? rearZ(y) : rearZ(yP) + (yP - y) * tr * 0.5, rearZ(Math.max(yP, yTop)), rearV);
    const zBat = (y) => rearX(y) + 0.012 + circ(rBB, Math.max(0, yA0 + rBB - y));
    const xiA = (y) => xi + splay * sstep(seatH - 0.08, yC, y) ** 1.4;
    return { yA0, roll, rollH, yTop, xi, xiA, rT, rl, yC, xo, lipH: rl, zFa, rFB, rBB, zFat, zBat, rearX, rearV };
  })();

  // ---- seat (Chicago / Bern: one thick block down to the body bottom), apron, chassis
  const tilt = clamp(num(P.seatTilt, 4), -5, 15) * DEG; // seatTilt (deg): the seat slopes down toward the back (HAVBERG 41 / 33 cm)
  // seatT (box): a seat cushion of this thickness over the body instead of one block down to the base (Paz, HAVBERG)
  const seatT = body === 'box' && typeof P.seatT === 'number' ? clamp(P.seatT, 0.06, 0.3) : 0;
  const seatFull = body === 'box' && st.sides !== 'shell' && !integrated && !seatT;
  const sTh = seatT || (seatFull ? Math.max(0.12, seatH - yb - 0.01) : body === 'shell' ? clamp(num(P.seatT, 0.16), 0.08, 0.22) : body === 'tulip' && integrated ? 0.19 : pile ? 0.17 : 0.14);
  const sD = zSF - zP + 0.05;
  const seat = new THREE.Group();
  seat.position.set(0, seatH, zSF);
  seat.rotation.x = -tilt;
  g.add(seat);
  const seatTufts = Math.round(clamp(num(P.seatTufts, 0), 0, 4));
  const seatGeo = body === 'classic' ? null : softBox(iw, sTh, sD, 'y', { puff: seatFull ? 0.05 : 0.1, round: seatFull ? 0.55 : 0.85, sides: 0.15, bottom: 0.05, q, seg: seatTufts ? Math.max(18, Math.round(segFor(iw, sD) * 1.5)) : segFor(iw, sD) });
  if (seatTufts) {
    // seatTufts: n × n buttoned dimples in the top (HAVBERG)
    const pts = [];
    for (let i = 0; i < seatTufts; i++) for (let k = 0; k < seatTufts; k++) pts.push([((i + 0.5) / seatTufts - 0.5) * iw * 0.75, ((k + 0.5) / seatTufts - 0.5) * sD * 0.7]);
    const p = seatGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < sTh * 0.2) continue;
      let t = 0;
      for (const [x, z] of pts) t += Math.exp(-((p.getX(i) - x) ** 2 + (p.getZ(i) - z) ** 2) / 0.03 ** 2);
      p.setY(i, p.getY(i) - 0.016 * Math.min(1, t) * clamp01((p.getY(i) - sTh * 0.2) / (sTh * 0.3)));
    }
    p.needsUpdate = true;
    K.smoothNormals(seatGeo);
    seatGeo.computeBoundingBox();
    seatGeo.computeBoundingSphere();
    const bg = tuftButton(q);
    for (const [x, z] of pts) seat.add(K.partMesh(bg, ms.up, 'upholstery', { position: [x, -0.016 + 0.002, z - sD / 2], rotation: [-Math.PI / 2, 0, 0] }));
  }
  let underC = null; // (classic) height of the seat body's underside at z
  if (body === 'classic') {
    // Stressless «dyne»: one side profile lofted across the seat – a thick, blunt nose params.seatLip tall whose top
    // stands params.seatCrown above seatH, the underside sweeping down and back (sagging params.seatSag) into the foot
    // of the back; the top rises params.seatRise toward the sides, under the arm pads
    const lip = clamp(num(P.seatLip, 0.14), 0.07, 0.22), crown = clamp(num(P.seatCrown, 0.025), 0, 0.08);
    const riseS = clamp(num(P.seatRise, 0.03), 0, 0.08), sag = clamp(num(P.seatSag, 0.018), 0, 0.05), rS = 0.035;
    // (the side edges stay nearly level under the pads: they rise params.seatRiseRear more toward the back)
    const riseR = clamp(num(P.seatRiseRear, 0.07), 0, 0.12);
    const V1 = backToWorld(ylSeat, -0.09), V4 = backToWorld(y0C + 0.04, -0.06);
    const yT0 = seatH + crown, zN = zSF;
    const zV3 = zN - 0.008, yV3 = yT0 - lip;
    underC = (z) => {
      const t = clamp01((zV3 - z) / (zV3 - V4[0]));
      return lerp(yV3, V4[1], t) - sag * Math.sin(Math.PI * t);
    };
    const xe = iw / 2 - rS;
    const levels = levelsY(-xe, xe, [], 0.035).map((x) => {
      const side = sstep(0.35, 1, Math.abs(x) / xe), yT = yT0 + riseS * side;
      const verts = [[V1[0], V1[1] + (riseS + riseR) * side], [zN, yT], [zV3, yT0 - lip], V4];
      const loop = filletProfile(verts, [0.02, Math.min(lip * 0.42, 0.06), Math.min(lip * 0.5, 0.075), 0.03], {
        nArc: 5,
        nEdge: [9, 2, 8, 2],
        // a little dome on the top, the nose bulging, the underside sagging (a convex hull)
        edgeFn: (i, t) => (i === 0 ? [0, 0.012 * Math.sin(Math.PI * t)] : i === 1 ? [0.006 * Math.sin(Math.PI * t), 0] : i === 2 ? [0, -sag * Math.sin(Math.PI * t)] : [0, 0]),
      });
      return { y: x, loop };
    });
    addUp(g, loftGeometry(levels, { top: rS, bottom: rS, nEdge: 3, nCap: 2, matrix: PROFILE_X }));
  } else if (body === 'shell' && shTaper < 1) {
    // in a tulip bowl the seat narrows toward its underside with the walls (a U from the front)
    const y0 = num(shYB, legH + 0.02), y1 = armH - 0.06, f0 = shF(seatH - 0.03, y0, y1), p = seatGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * Math.min(1, shF(seatH - sTh / 2 + p.getY(i), y0, y1) / f0));
    p.needsUpdate = true;
    K.smoothNormals(seatGeo);
    seatGeo.computeBoundingBox();
    seatGeo.computeBoundingSphere();
  }
  if (body === 'shell' && num(P.seatNose, 0) < 0) {
    // the shell comes forward round the seat (seatNose < 0): the seat moves back behind its front wall and its front
    // corners follow the shell's rounded plan
    seat.position.z = Math.min(zSF, zFsh - shT - 0.008);
    const zc = (seat.position.z + rearZ(seatH) - 0.03) / 2, az = (seat.position.z - rearZ(seatH) + 0.03) / 2, p = seatGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = clamp01(Math.abs(seat.position.z + p.getZ(i) - sD / 2 - zc) / az);
      p.setX(i, p.getX(i) * Math.min(1, 1.03 * Math.pow(Math.max(0, 1 - u ** 3.2), 1 / 3.2)));
    }
    p.needsUpdate = true;
    K.smoothNormals(seatGeo);
    seatGeo.computeBoundingBox();
    seatGeo.computeBoundingSphere();
  }
  if (seatGeo) addUp(seat, seatGeo, { position: [0, -sTh / 2, -sD / 2] });
  if (body === 'box' && !seatFull && !integrated && !AG) {
    const apH = Math.max(0.05, seatH - sTh + 0.03 - yb);
    const geo = softBox(iw - 0.01, apH, 0.1, 'z', { puff: 0.06, round: 0.6, sides: 0.1, q });
    const pos = [0, yb + apH / 2, zSF - 0.085];
    if (st.sides === 'shell') addFrame(g, geo, { position: pos });
    else addPlain(g, geo, { position: pos });
  }
  if (AG && AS.pad) {
    // saucer (Split): a wide, low lens under the seat cushion, tapering to a small hub over the column
    const yRim = seatH - sTh + 0.015, sH = clamp(num(P.saucerH, 0.17), 0.06, yRim - legH - 0.02);
    const zS0 = Math.min(zP - 0.02, AG.zBat(seatH)), zS1 = zf - 0.004, hx0 = w / 2 - 0.004, hz0 = (zS1 - zS0) / 2, zc = (zS0 + zS1) / 2;
    const sHub = clamp(0.1 / Math.min(hx0, hz0), 0.05, 0.5), rc0 = Math.min(hx0, hz0) * clamp(num(P.saucerR, 0.75), 0.2, 0.98);
    const lv = [];
    // the underside a flat superellipse (exponent 1.6) from the rounded rim down to the hub: a lens, not a deep bowl
    for (let k = 0; k <= 10; k++) {
      const s = lerp(sHub, 1, 1 - (1 - k / 10) ** 1.6);
      lv.push({ y: yRim - 0.012 - (sH - 0.012) * Math.max(0, 1 - s ** 1.6) ** (1 / 1.6), loop: rrLoop(hx0 * s, zc - hz0 * s, zc + hz0 * s, rc0 * s, rc0 * s, { nx: 12, nArc: 6, nSide: 4 }) });
    }
    const saucer = new THREE.Group();
    g.add(saucer);
    addSide(saucer, loftGeometry(lv, { top: 0.012, bottom: 0.01, nEdge: 3, nCap: 3 }));
    AG.yA0 = yRim - sH; // the column reaches the hub
  } else if (AG) {
    // body under the seat between the arm panels, with the arms' side profile (no box corner shows under a rounded
    // panel): a side outline [z, y] lofted across the width
    const yTopC = seatT ? Math.max(yP + 0.04, seatH - seatT + 0.03) : yP + 0.04, y0 = AG.yA0 + 0.004;
    const cz1 = seatFull ? zP + 0.05 : integrated ? zSF - 0.18 : seatT ? zSF - 0.015 : zSF - 0.1;
    const zR = (y) => AG.zBat(y) - 0.008, zFr = (y) => Math.min(cz1, AG.zFat(y) - 0.01);
    const n = 10, prof = [];
    // bodyRear: behind the reclined back the body fills up to the vertical rear edge (a wedge inside the back)
    const yTopR = AG.rearV > 0 ? lerp(yTopC, Math.max(yTopC, AG.yTop - 0.03), AG.rearV) : yTopC;
    for (let i = 0; i <= n; i++) prof.push([zR(lerp(yTopR, y0, (i / n) ** 0.7)), lerp(yTopR, y0, (i / n) ** 0.7)]);
    for (let i = 1; i < n; i++) prof.push([lerp(zR(y0), zFr(y0), i / n), y0]);
    for (let i = 0; i <= n; i++) prof.push([zFr(lerp(y0, yTopC, 1 - (1 - i / n) ** 0.7)), lerp(y0, yTopC, 1 - (1 - i / n) ** 0.7)]);
    if (yTopR > yTopC + 0.01) {
      const zIn = Math.max(zR(yTopC) + 0.02, Math.min(zFr(yTopC) - 0.02, rearZ(yTopC) + 0.05));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        prof.push(t <= 0.5 ? [lerp(zFr(yTopC), zIn, t * 2), yTopC] : [lerp(zIn, zR(yTopR), t * 2 - 1), lerp(yTopC, yTopR, t * 2 - 1)]);
      }
    } else for (let i = 1; i < n; i++) prof.push([lerp(zFr(yTopC), zR(yTopC), i / n), yTopC]);
    const hwC = Math.max(iw / 2, Math.min(bw / 2, AG.xi + 0.01)) - 0.003, lv = [];
    // bodyBowl (m): seen from the front the body's bottom rounds up toward the arms with this radius (Bern's bowl):
    // the side outline is squeezed up toward its top near the sides
    const bowl = clamp(num(P.bodyBowl, 0), 0, (yTopR - y0) * 0.8), nL = bowl ? 12 : 4;
    const circ0 = (r, dy) => r - Math.sqrt(Math.max(0, r * r - dy * dy));
    for (let k = 0; k <= nL; k++) {
      const x = lerp(-hwC + 0.006, hwC - 0.006, k / nL), lift = bowl ? circ0(bowl, Math.max(0, Math.abs(x) - (hwC - bowl))) : 0;
      const f = 1 - lift / (yTopR - y0);
      lv.push({ y: x, loop: lift ? prof.map(([z, y]) => [z, yTopR - (yTopR - y) * f]) : prof });
    }
    addSide(g, loftGeometry(lv, { top: 0.006, bottom: 0.006, nEdge: 2, nCap: 2, matrix: PROFILE_X }));
  } else if (body === 'box') {
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
    // closed, the panel reaches well up behind the seat front, so no notch shows between seat and footrest;
    // footSplit (m): the panel stops just under the seat cushion with a rounded top edge of this radius, so the
    // cushion front and the panel read as two parts (Nakskov, Bredbjerg, Prince, MUREN)
    const split = st.open ? 0 : clamp(num(P.footSplit, 0), 0, 0.06);
    const hingeY = seatH - sTh + (st.open ? 0.025 : split ? 0.012 : sTh * 0.55), hingeZ = zSF - 0.035;
    // footBottom: the closed panel's lower edge above the floor; footTilt (deg): it slopes back toward the base
    const pH = Math.max(0.1, hingeY - clamp(num(P.footBottom, 0.07), 0.02, 0.3));
    const fr = new THREE.Group();
    fr.position.set(0, hingeY + (st.open ? 0.02 : 0), hingeZ + (st.open ? 0.1 : 0));
    fr.rotation.x = st.open ? -76 * DEG : num(P.footTilt, body === 'tulip' ? 2 : 7) * DEG; // closed: nearly upright, sloping back a little toward the base
    g.add(fr);
    if (P.footTaper != null || P.footR != null || split) {
      // shaped front panel (Zermatt): narrowing toward its rounded lower corners (footR, seen from the front), a
      // slightly bulging front; plan loops lofted down the panel
      const taper = clamp(num(P.footTaper, 1), 0.6, 1), rB = clamp(num(P.footR, 0.04), 0.012, iw * 0.3), hwF = (iw - 0.004) / 2;
      // footRE: the lower edge's radius seen from the side; footBulge: the front bulges out by this much (Zermatt)
      const rE = clamp(num(P.footRE, 0.03), 0.012, 0.08), z0 = 0.035 - fT, z1 = 0.035 - split * 0.3, rTp = Math.max(0.012, split), bulge = clamp(num(P.footBulge, 0.012), 0, 0.05);
      const hwAt = (y) => hwF * lerp(taper, 1, sstep(-pH, 0, y)) - (rB - Math.sqrt(Math.max(0, rB * rB - Math.max(0, -pH + rB - y) ** 2)));
      const nx = 2 * Math.max(6, Math.round(hwF / step));
      const lv = levelsY(-pH + rE, -rTp, [-pH + rB * 0.3, -pH + rB * 0.6], step).map((y) => {
        const hw = Math.max(0.02, hwAt(y));
        return { y, loop: rrLoop(hw, z0, z1, Math.max(Math.min(0.045, hw * 0.9), rE * 1.03), Math.max(0.032, rE * 1.03), { nx, nArc: 5, nSide: 3, front: (x) => bulge * (1 - Math.min(1, (x / hw) ** (bulge > 0.012 ? 2 : 4))) }) };
      });
      addUp(fr, loftGeometry(lv, { top: rTp, bottom: rE, nEdge: 3, nCap: 3 }));
    } else {
      // closed: as wide as the seat and flush with its front, so seat and footrest read as one block (Taycan, Grande)
      addUp(fr, softBox(iw - (st.open ? 0.008 : 0.002), pH, fT, 'z', { puff: 0.08, round: st.open ? 0.7 : 0.45, sides: 0.12, bottom: 0.3, q, seg: segFor(iw, pH) }), { position: [0, -pH / 2, 0.035 - fT / 2] });
    }
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
  if (AS && AS.pad) {
    // pillow pads over the saucer rim (Split): armPadL long from armPadZ behind the back's front at the seat,
    // armRollH tall, armW wide, top at armH, on a short hidden stub
    const padL = clamp(num(P.armPadL, 0.4), 0.2, d * 0.7), pH = clamp(num(P.armRollH, 0.15), 0.06, 0.25), pW = armW;
    const z0 = zP - clamp(num(P.armPadZ, 0.06), -0.2, 0.25), yc = armH - pH / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - pW / 2 - 0.012), pts = [];
      for (let i = 0; i <= 6; i++) pts.push([x, yc - 0.012 * (i / 6) ** 2, z0 + (padL - pH * 0.5) * (i / 6)]);
      addUp(g, sweepGeometry(pts, { a: pW / 2, b: pH / 2, r: 0.75, side: [1, 0, 0], nc: 5, ns: 3, nEnd: 5, capLen: 0.85 }));
      const yS = seatH - sTh - 0.01;
      g.add(K.partMesh(K.cylinder(0.022, 0.022, Math.max(0.02, yc - pH / 2 - yS + 0.01), { seg: 10 }), metal, null, { position: [x, yS, z0 + padL * 0.25] }));
    }
  } else if (AS) {
    // fabric side panels by arm style (RECLINER_ARMS): plan loops lofted up the panel; the inner face stands
    // beside the seat at xi, the outer face leans / curls out to w / 2 at the top
    const { yA0, roll, rollH, yTop, xi, rT, rl, yC, xo, lipH, zFa, rFB, rBB, zFat, zBat } = AG;
    const rBot = 0.012;
    const extra = [];
    for (let k = 1; k < 5; k++) extra.push(yA0 + Math.max(rFB, rBB) * (k / 5) ** 1.5);
    // (big bottom radii read as chamfers with only those levels)
    if (Math.max(rFB, rBB) > 0.12) for (let k = 0; k < 4; k++) extra.push(yA0 + Math.max(rFB, rBB) * ((k + 0.5) / 5) ** 1.5);
    if (lipH > 0) for (let k = 1; k <= 4; k++) extra.push(yC - lipH * (k / 4) ** 0.7);
    // a big top-front radius needs levels along its curve
    if (AS.frontTopR > rT) for (let k = 1; k < 6; k++) extra.push(yTop - AS.frontTopR * (k / 6) ** 1.3);
    const yW = rl > 0 ? yC - rl * 0.6 : yTop - rT - 0.006; // welt height (under the lip / the rounded top)
    const { xiA } = AG;
    // armTopTilt: the top slopes down toward the outer lip by this much (up when negative)
    const tiltT = clamp(num(P.armTopTilt, AS.topTilt || 0), -0.05, 0.06);
    const tx0 = xiA(yTop), tSpan = Math.max(0.03, w / 2 - tx0);
    const tiltAt = (x, y) => (tiltT ? tiltT * clamp01((Math.abs(x) - tx0) / tSpan) ** 2 * sstep(yC - rl - 0.1, yTop, y) : 0);
    // armRise (Tankedal): the arm top sweeps up toward the rear into the back shell by this much; negative: it
    // drops toward the rear (Paz's egg), over the top armRiseH of the panel
    const rise = clamp(num(P.armRise, 0), -0.2, 0.3), riseH = clamp(num(P.armRiseH, 0.2), 0.08, (yTop - yA0) * 0.9);
    const riseAt = (y, z) => {
      if (!rise) return 0;
      const zB = zBat(yTop), zF = zFat(yTop);
      return rise * (1 - clamp01((z - zB) / Math.max(0.05, (zF - zB) * 0.75))) ** 2 * sstep(yTop - riseH, yTop, y);
    };
    for (const sx of [-1, 1]) {
      const loopAt = (y, grow = 0) => {
        const hwA = (xo(y) - xiA(y)) / 2 + grow, zB = zBat(y) - grow, zF = Math.max(zB + 0.06, zFat(y) + grow);
        const rf = clamp(AS.planR * hwA, rT * 1.03, hwA * 0.97), rb = clamp(0.025, rT * 1.03, hwA * 0.97);
        return rrLoop(hwA, zB, zF, rf, rb, { nx: 4, nArc: 5, nSide: 4, cx: sx * (xiA(y) + (xo(y) - xiA(y)) / 2) });
      };
      const levels = levelsY(yA0 + rBot, yTop - rT, extra, 0.045).map((y) => ({ y, loop: loopAt(y) }));
      // the rounded top as true offsets of the last loop (its front following the top-front radius)
      const yT1 = levels[levels.length - 1].y;
      const topRing = (ins, yy) => {
        const hwA = (xo(yT1) - xiA(yT1)) / 2, zB = zBat(yT1), zF = Math.max(zB + 0.06, zFat(yT1));
        const rf = clamp(AS.planR * hwA, rT * 1.03, hwA * 0.97), rb = clamp(0.025, rT * 1.03, hwA * 0.97);
        const zF1 = Math.max(zB + ins + 0.02, Math.min(zF - ins, zFat(Math.min(yy, yTop))));
        return rrLoop(Math.max(1e-3, hwA - ins), zB + ins, zF1, Math.max(1e-4, rf - ins), Math.max(1e-4, rb - ins), { nx: 4, nArc: 5, nSide: 4, cx: sx * (xiA(yT1) + (xo(yT1) - xiA(yT1)) / 2) });
      };
      const armGeo = loftGeometry(levels, { top: rT, bottom: rBot, nEdge: AS.frontTopR > rT ? 7 : 4, nCap: 3, topRing });
      if (tiltT || rise) {
        const p = armGeo.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - tiltAt(p.getX(i), p.getY(i)) + riseAt(p.getY(i), p.getZ(i)));
        p.needsUpdate = true;
        K.smoothNormals(armGeo);
        armGeo.computeBoundingBox();
        armGeo.computeBoundingSphere();
      }
      addSide(g, armGeo);
      if (AS.welt === 'edge' && !roll) {
        // armWelt 'edge' (Zermatt): a seam along the outer face's edge, under the lip from the rear to the front, then
        // down the front curve toward the foot (the outer side panel is a separate piece)
        const rfAt = (y) => clamp(AS.planR * ((xo(y) - xiA(y)) / 2), rT * 1.03, ((xo(y) - xiA(y)) / 2) * 0.97);
        const pts = [], zE = (y) => zFat(y) - rfAt(y) * 0.55;
        for (let i = 0; i <= 8; i++) {
          const z = lerp(zBat(yW) + 0.06, zE(yW), i / 8);
          pts.push([sx * (xo(yW) + 0.001), yW - tiltAt(sx * xo(yW), yW) + riseAt(yW, z), z]);
        }
        const yEnd = yA0 + Math.min(0.05, rFB * 0.4), nD = Math.max(4, Math.round((yW - yEnd) / 0.025));
        for (let i = 1; i <= nD; i++) {
          const y = lerp(yW, yEnd, i / nD);
          pts.push([sx * (xo(y) + 0.001), y, zE(y)]);
        }
        g.add(K.partMesh(seamTube(pts, 0.0045, { radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
      } else if (AS.welt && !roll) {
        const pts = loopAt(yW, 0.002).map(([x, z]) => [x, yW - tiltAt(x, yW) + riseAt(yW, z), z]);
        g.add(K.partMesh(seamTube(pts, 0.0045, { closed: true, radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
      }
      if (hasFrame && kindGroup(M.frame || '') === 'wood') {
        // «vanger»: a thin wooden plate on the outer face (Taycan Wood)
        const lv = levelsY(lerp(yA0, yTop, 0.1), lerp(yA0, yTop, 0.86), [], 0.03).map((y) => {
          const zB = zBat(y) + 0.03, zF = Math.max(zB + 0.04, zFat(y) - 0.03);
          return { y, loop: rrLoop(0.006, zB, zF, 0.0055, 0.0055, { nx: 2, nArc: 3, nSide: 6, cx: sx * (xo(y) - 0.002) }) };
        });
        addFrame(g, loftGeometry(lv, { top: 0.005, bottom: 0.005, nEdge: 2, nCap: 2 }), {}, frameMat({ grain: 'v' }));
      }
      if (roll) {
        // padded roll over the panel top, overhanging the outer face, curling down the front (armFrontDrop)
        // armRollFwd: the roll (an arm pad, Split / Nova) reaches this far past the panel front
        const a = armW / 2 + 0.004, b = rollH / 2, cx = sx * (xi + armW / 2 - 0.002), yC = armH - b;
        const z0 = zBat(yTop) + 0.03, z1 = zFa - b * 0.6 + clamp(num(P.armRollFwd, 0), -0.1, 0.12), rc = Math.min(0.06, b * 1.2);
        const yDown = yC - clamp(num(P.armFrontDrop, 0.05), 0, yC - yA0 - 0.05);
        const pts = [];
        for (let i = 0; i <= 6; i++) pts.push([cx, yC, lerp(z0, z1 - rc, i / 6)]);
        const down = yC - yDown > rc * 0.6;
        for (let k = 1; k <= 6; k++) {
          const ang = (Math.PI / 2) * (k / 6) * (down ? 1 : 0.35);
          pts.push([cx, yC - rc + rc * Math.cos(ang), z1 - rc + rc * Math.sin(ang)]);
        }
        if (down) {
          const nD = Math.max(2, Math.round((yC - rc - yDown) / 0.03));
          for (let i = 1; i <= nD; i++) pts.push([cx, lerp(yC - rc, yDown, i / nD), z1]);
        }
        addUp(g, sweepGeometry(pts, { a, b, r: 0.92, side: [1, 0, 0], nc: 4, ns: 2, nEnd: 4, capLen: 0.7 }));
      }
    }
    if (st.lever && (P.leverStyle === 'inset' || P.leverStyle === 'chrome')) {
      // leverStyle 'inset': a recessed black handle flush in the outer face (Nakskov, Bredbjerg); 'chrome': a chrome
      // framed inset handle (Relieve)
      const yL = Math.min(yTop - 0.09, armH - 0.15), x = -xo(yL), zL = zFa - 0.24;
      if (P.leverStyle === 'chrome') g.add(K.partMesh(K.roundedBox(0.008, 0.06, 0.12, 0.012, 2), mat('chrome', '#cfd0d2'), null, { position: [x - 0.001, yL, zL] }));
      g.add(K.partMesh(K.roundedBox(0.008, 0.04, 0.085, 0.014, 2), metal, null, { position: [x - (P.leverStyle === 'chrome' ? 0.0025 : 0.0015), yL, zL] }));
    } else if (st.lever) {
      const yL = Math.min(yTop - 0.08, armH - 0.14);
      addLever(g, metal, [-(xo(yL) + 0.002), yL, zFa - 0.26], -1);
    }
  } else if (body === 'box') {
    const veneer = st.sides === 'veneer', shellSides = st.sides === 'shell';
    // an upholstered roll over the top and down the front (Zermatt, Grande); armCap: false keeps the plain panel top
    // (Timeout in a wooden shell: veneer on the outer face, the upholstered panel forms the arm top)
    const capped = (veneer || shellSides) && P.armCap !== false;
    // (veneer: params.armFlare – the outer face that much further in at the bottom: a thin petal flaring to the top, Grande)
    const flare = veneer ? clamp(num(P.armFlare, 0.012), 0, armW - 0.03) : shellSides ? 0.02 : Math.min(0.05, armW * 0.4);
    // armBottom: the side panels may stop above the base (Timeout: the column shows under them)
    const yA0 = clamp(num(P.armBottom, Math.max(yb + 0.004, seatH - 0.3)), yb + 0.004, seatH - 0.05);
    // half height of the arm roll (its top = armH); veneer: params.bandT – a thinner fabric band round the plate (Grande)
    const capB = veneer ? clamp(num(P.bandT, 0.052), 0.02, 0.07) : 0.058;
    const topA = capped ? armH - capB * 1.45 : armH; // panel top (inside the lower half of the roll)
    const xi = w / 2 - armW;
    const rTopA = Math.min(armW * 0.45, 0.055, (topA - yA0) * 0.3);
    // armTuck: the panels lean out toward the top (petal arms, Timeout): pulled in by `tuck` at the bottom
    const tuck = clamp(num(P.armTuck, 0), 0, 0.08);
    const shiftX = (y) => -tuck * (1 - sstep(yA0, topA, y)) ** 1.6;
    // panelRadius (veneer sides): a near-rectangular wooden plate with this corner radius front and rear (Grande)
    const pRad = veneer && P.panelRadius != null ? clamp(num(P.panelRadius, 0.06), 0.02, 0.24) : null;
    // veneer: params.panelRadiusFront – a bigger front-bottom corner; params.panelRise – the plate's bottom edge rises
    // this much toward the front; params.seatNose – the arm fronts stand that much behind the seat / footrest front
    const rFB = veneer && P.panelRadiusFront != null ? clamp(num(P.panelRadiusFront, 0.1), 0.02, 0.3) : pRad ?? Math.min(0.24, (topA - yA0) * 0.55);
    const riseP = veneer ? clamp(num(P.panelRise, 0), 0, 0.2) : 0;
    const zFa = zf - 0.006 - (veneer ? clamp(num(P.seatNose, 0), 0, 0.12) : 0);
    // the outer face leans out toward the rolled top (Chicago: «buer litt utover»)
    const over = capped ? (shellSides ? 0.02 : 0.012) : 0; // the roll over the top overhangs the panel by this much
    const xo = (y) => w / 2 - over - flare * (1 - sstep(yA0, topA + 0.02, y)) ** 1.3;
    const rBB = pRad ?? rFB * 0.7; // the rear-bottom corner rounds up too (the side reads as a «D»)
    const zBat = (y) => {
      const dy = Math.max(0, yA0 + rBB - y);
      return rearZ(y) + 0.012 + (rBB - Math.sqrt(Math.max(0, rBB * rBB - dy * dy)));
    };
    const zFat = (y) => {
      const yFB = yA0 + riseP, dy = Math.max(0, yFB + rFB - y);
      const zC = zFa - (rFB - Math.sqrt(Math.max(0, rFB * rFB - dy * dy)));
      if (!riseP || y >= yFB) return zC;
      // below the raised front-bottom corner: the sloping bottom edge, from the rear-bottom corner
      const zR0 = zBat(yA0 + 0.012);
      return lerp(zR0, zFa - rFB, clamp01((y - yA0) / riseP));
    };
    const extra = [];
    for (let k = 1; k < 7; k++) extra.push(yA0 + riseP + rFB * (k / 7) ** 1.5);
    for (let k = 1; k < 5 && riseP; k++) extra.push(yA0 + (riseP * k) / 5);
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
        // veneer: the band follows the tucked-in panel (a petal from the front) and narrows away from the top;
        // params.bandRear (m below the roll) also takes it down the plate's rear edge (Grande: a fabric frame ∩)
        const vx = (y) => (veneer ? sx * ((xi + xo(y)) / 2 + shiftX(y)) : cx);
        const yRear = veneer && P.bandRear != null ? Math.max(yA0 + 0.03, yC - num(P.bandRear, 0.2)) : null;
        let zT0 = z0;
        if (yRear != null) {
          const zR = zBat(topA) + bT - 0.012;
          const nR = Math.max(3, Math.round((yC - rc - yRear) / 0.03));
          for (let i = 0; i < nR; i++) {
            const y = lerp(yRear, yC - rc, i / nR);
            pts.push([vx(y), y, zBat(y) + bT - 0.012]);
          }
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 2) * (k / 6);
            pts.push([cx, yC - rc + rc * Math.sin(a), zR + rc - rc * Math.cos(a)]);
          }
          zT0 = zR + rc;
        }
        for (let i = 0; i <= 8; i++) pts.push([cx, yC, lerp(zT0, z1 - rc, i / 8)]);
        for (let k = 1; k <= 6; k++) {
          const a = (Math.PI / 2) * (k / 6);
          pts.push([cx, yC - rc + rc * Math.cos(a), z1 - rc + rc * Math.sin(a)]);
        }
        const nD = Math.max(3, Math.round((yC - rc - yDown) / 0.03));
        for (let i = 1; i <= nD; i++) {
          const y = lerp(yC - rc, yDown, i / nD);
          pts.push([vx(y), y, zFat(y) - bT + 0.012]);
        }
        let aT = hwT, bF = bT;
        if (veneer) {
          // half-width by path fraction: full over the top, about 60 % at the band's lower ends
          const S = [0];
          for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
          const yAt = (u) => {
            const s = u * S[S.length - 1];
            let i = 1;
            while (i < S.length - 1 && S[i] < s) i++;
            return lerp(pts[i - 1][1], pts[i][1], clamp01((s - S[i - 1]) / (S[i] - S[i - 1] || 1)));
          };
          aT = (u) => hwT * lerp(0.6, 1, sstep(Math.min(yDown, yRear ?? yDown), yC - rc, yAt(u)));
          // (a thin band also thins out toward its ends, so they fade into the plate's edges instead of ending in stubs)
          if (P.bandT != null) bF = (u) => bT * lerp(0.45, 1, sstep(Math.min(yDown, yRear ?? yDown), yC - rc - 0.08, yAt(u)));
        }
        addUp(g, sweepGeometry(pts, { a: aT, b: bF, r: 0.9, side: [1, 0, 0], nc: 5, ns: 3, nEnd: 4, capLen: 0.8 }));
      }
    }
    if (st.lever) addLever(g, metal, [-(xo(armH - 0.13) + shiftX(armH - 0.13) + (veneer ? 0.004 : 0)), Math.min(topA - 0.06, armH - 0.13), zf - 0.27], -1);
  } else if (body === 'classic') {
    // Stressless: padded arm pads above the seat, open underneath, from beside the back's front to short of the seat
    // front. On the Classic base the wooden uprights carry them and a thin black stay runs from under the pad front to
    // the glide knob; on the Cross / Star bases a steel arm loop runs under each pad, curls down round its front and
    // back down past the knob to the mechanism, and up behind the seat to the pad's rear end
    const aStyle = ['slab', 'plump', 'slim'].includes(P.armPad) ? P.armPad : sBase === 'classic' ? 'slab' : 'slim';
    const plump = aStyle === 'plump';
    const padW = Math.max(armW, 0.07), padH = num(P.armPadH, plump ? 0.105 : aStyle === 'slim' ? 0.062 : 0.08);
    const flare = plump ? 0.28 : 0; // the plump pad swells toward its rolled front
    const xPad = w / 2 - (padW / 2) * (1 + flare);
    const yPadB = armH - padH; // underside of the pads
    const aOf = (u) => (padW / 2) * (1 + flare * sstep(0.4, 1, u));
    const bOf = (u) => (padH / 2) * (1 + (plump ? 0.14 : 0) * sstep(0.5, 1, u));
    const capL = aStyle === 'slab' ? 0.7 : 0.9;
    // (the pads run back beside the back to params.armRear (m) short of its rear face)
    const zA0 = Math.max(rearZ(armH - padH / 2) + num(P.armRear, 0.035), zr + 0.02) + Math.min(aOf(0), bOf(0)) * capL;
    const zA1 = zSF - num(P.armSetback, sBase === 'classic' ? 0.075 : 0.13) - Math.min(aOf(1), bOf(1)) * capL;
    const steel = ms.legs();
    const zMid = lerp(zr, zf, 0.47); // the swivel column (as the base below)
    const seatBot = underC; // underside of the seat body at z
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) pts.push([sx * xPad, armH - bOf(i / 10), lerp(zA0, zA1, i / 10)]);
      addUp(g, sweepGeometry(pts, { a: aOf, b: bOf, r: aStyle === 'slim' ? 0.8 : plump ? 0.65 : 0.55, nc: 5, ns: 3, nEnd: 4, capLen: capL }));
      const zK = zA1 - 0.16, yK = Math.min(seatH - 0.02, yPadB - 0.1);
      stresslessKnob(g, [sx * (iw / 2 + (sBase === 'classic' ? 0.012 : 0.026)), yK, zK], sx, q);
      if (sBase === 'classic') {
        // the black stay: from under the pad front, down and back past the knob into the seat side
        const stay = [[sx * (xPad - padW * 0.2), yPadB + 0.006, zA1 - 0.03], [sx * (iw / 2 + 0.03), yPadB - 0.05, zA1 - 0.09], [sx * (iw / 2 + 0.008), yK, zK], [sx * (iw / 2 - 0.004), yK - 0.07, zK - 0.07]];
        g.add(K.partMesh(K.tube(stay, 0.0055, { radial: 6, seg: 16 }), metal, null));
      } else {
        // the steel arm loop
        const xR = sx * (xPad + padW * 0.1), yU = yPadB - 0.004, rc = 0.042, xS = sx * (iw / 2 + 0.012);
        const zBk = zA0 - Math.min(aOf(0), bOf(0)) * capL + 0.03;
        const loop = [[sx * 0.06, legH + 0.05, zMid - 0.05], [xS, seatBot(zBk) - 0.005, zBk + 0.035], [lerp(xS, xR, 0.5), lerp(seatBot(zBk), yU, 0.55), zBk - 0.008], [xR, yU, zBk + 0.03]];
        for (let i = 1; i <= 3; i++) loop.push([xR, yU, lerp(zBk + 0.03, zA1 - 0.01, i / 3)]);
        for (let k = 1; k <= 6; k++) {
          const th = Math.PI / 2 - (k / 6) * (Math.PI * 0.9);
          loop.push([xR, yU - rc + rc * Math.sin(th), zA1 - 0.01 + rc * Math.cos(th)]);
        }
        loop.push([xS, yK, zK], [sx * 0.06, legH + 0.05, zMid + 0.05]);
        g.add(K.partMesh(K.tube(loop, 0.0085, { radial: 8, seg: Math.max(40, Math.round(72 * q)) }), steel, 'legs'));
      }
    }
    if (sBase === 'classic') {
      const R = clamp(w * 0.42, 0.25, 0.33);
      // (the ring's centre about a third of a metre behind the seat nose, its uprights under the middle of the pads)
      ringBase(g, ms, { r: R, topY: yPadB, q, z: clamp(zSF - num(P.ringBack, 0.335), zr + R, zf - R), postX: iw / 2 + 0.02, postTop: yPadB + 0.004 });
    } else {
      // the swivel mechanism under the seat, on the column
      const fH = Math.max(0.02, seatBot(zMid) - legH - 0.004);
      g.add(K.partMesh(K.roundedBox(0.1, fH + 0.02, 0.16, 0.01, 2, { bottom: true }), metal, null, { position: [0, legH + 0.004, zMid] }));
      stresslessBase(g, ms, { kind: sBase, r: clamp(Math.min(w, d) * (sBase === 'star' ? 0.56 : 0.5), 0.3, 0.44), topY: legH + 0.004, q, z: zMid });
    }
  } else if (body === 'tulip') {
    // thin petals: broad top from beside the back to near the seat front, narrowing to a foot under the seat
    const zTop0 = zP - 0.045, zTop1 = zSF - 0.075;
    const zMidB = lerp(zTop0, zTop1, 0.38);
    const rTopT = tk1 * 0.48, rBotT = tk0 * 0.45;
    // tulipFoot: the foot's depth as a fraction of the top's (0.38: a narrow petal foot; Brian's paddle ≈ 0.65)
    const tf = clamp(num(P.tulipFoot, 0.38), 0.2, 0.95);
    const petal = (t) => {
      const s = Math.sin((Math.PI / 2) * clamp01(t));
      // a rounded petal from the side: a fairly broad foot, the front edge curving up and forward to the top
      return [zMidB - (zMidB - zTop0) * (tf + (1 - tf) * clamp01(t) ** 0.8), zMidB + (zTop1 - zMidB) * (tf + (1 - tf) * s ** 0.55)];
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
    const zFs = zFsh; // (params.seatNose)
    // the shell's back rim just above the arms: the back cushion stands free above it (params.shellTop: higher, up the
    // back – Timeout's shell is the whole rear of the chair)
    const yTopSh = clamp(num(P.shellTop, armH + 0.02), armH + 0.02, h - 0.05);
    const padH = num(P.armPadH, shPad === 'lid' ? 0.055 : 0.065), padW = armW + 0.026;
    const yArmRim = armH - padH + 0.006;
    const yLip = seatH - sTh + 0.005;
    const Rx = 0.06, Rz = 0.21;
    // shell bottom: the seat cushion sits on the flat of the bowl
    const ys = Number.isFinite(shYB) ? Math.min(shYB, seatH - sTh - 0.01) : Math.min(yb, seatH - sTh - Rx + 0.004);
    // (a raised bowl rounds its rear-bottom less, so the back cushion's foot – lower behind as the back leans – stays
    // inside it)
    const RzB = Number.isFinite(shYB) ? clamp(yP - ys - T0 * Math.sin(rec), 0.04, Rz) : Rz;
    // (a shell rising up the back narrows quickly above the arms to wrap the back cushion)
    const sleeve = P.shellTop != null;
    const xHalf = (y) => lerp(w / 2 - shIn, bw / 2 + T + (sleeve ? 0.006 : 0.025), sstep(armH - 0.02, sleeve ? armH + 0.07 : yTopSh, y)) * shF(y, ys, yArmRim);
    const zBk = (y) => rearZ(Math.max(y, yP)) - T - 0.008;
    const pt = (phi, y, t) => {
      const yy = Math.max(y, ys + t + 1e-4);
      const ax = xHalf(yy) - t, zF = zFs - t, zB = zBk(yy) + t;
      const zc = (zF + zB) / 2, az = (zF - zB) / 2;
      const kx = yy < ys + Rx ? Math.sqrt(Math.max(0, 1 - ((ys + Rx - yy) / (Rx - t)) ** 2)) : 1;
      const R2 = Math.cos(phi) > 0 ? RzB : Rz;
      const kz = yy < ys + R2 ? Math.sqrt(Math.max(0, 1 - ((ys + R2 - yy) / (R2 - t)) ** 2)) : 1;
      return [ax * kx * Sx(Math.sin(phi)), yy, zc - az * kz * Sx(Math.cos(phi))];
    };
    const phiAt = (z, y) => {
      const zB = zBk(y), zc = (zFs + zB) / 2, az = (zFs - zB) / 2;
      const u = clamp((zc - z) / az, -1, 1);
      return Math.acos(Math.sign(u) * Math.pow(Math.abs(u), n / 2));
    };
    const ph2 = phiAt(zP + 0.02, yArmRim), ph3 = phiAt(Math.min(zf - 0.075, zFs - 0.03), yArmRim), ph1 = Math.max(0.15, ph2 - 0.5);
    // params.shellFront: the rim falls from the arms to the front lip over this fraction of the front (1: a long slope
    // across the front; ~0.3: a steep front edge under the arm end, the lip low across the seat front)
    const phF = ph3 + (Math.PI - ph3) * clamp(num(P.shellFront, 1), 0.15, 1);
    // (a sleeve up the back: its front edge runs up parallel to the back cushion's front, a little behind it, so from
    // the front only the cushion shows above the arms)
    const sleeveRim = (pa) => clamp(yP + (zP - 0.045 - pt(pa, yArmRim, 0)[2]) / Math.max(tr, 0.05), yArmRim, yTopSh);
    const rim = (phi) => {
      const pa = phi <= Math.PI ? phi : 2 * Math.PI - phi;
      if (sleeve && pa <= ph2) return sleeveRim(pa);
      if (pa <= ph1) return yTopSh;
      if (pa <= ph2) return lerp(yTopSh, yArmRim, sstep(ph1, ph2, pa));
      if (pa <= ph3) return yArmRim;
      return lerp(yArmRim, yLip, sstep(ph3, phF, pa));
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
    // padded arm tops along the rim ('round'); a flat lid overhanging the wall, its front turned down ('lid'); a petal,
    // narrow behind and broad in front, curling out over the wall ('petal'); a front rolled down ('scroll')
    const curl = shPad === 'round' ? 0.022 : shIn, rise = shPad === 'round' ? 0.016 : shPad === 'petal' ? 0.012 : 0;
    // params.armDrop (m): how far the front end turns down (lid, scroll)
    const drop = clamp(num(P.armDrop, shPad === 'lid' ? 0.03 : shPad === 'scroll' ? 0.045 : 0), 0, 0.15);
    const aP = shPad === 'petal' ? (u) => (padW / 2) * lerp(0.7, 1.2, sstep(0.15, 0.8, u)) : (padW / 2) + (shPad === 'lid' ? 0.004 : 0);
    const bP = shPad === 'petal' ? (u) => (padH / 2) * lerp(0.8, 1.12, sstep(0.3, 0.9, u)) : padH / 2;
    const val = (f, u) => (typeof f === 'function' ? f(u) : f);
    // params.armTilt (m): the pad's top slopes down toward the seat, its outer edge that much above the inner one (from
    // the middle of the pad forward); params.armCurl (m): its outer edge rolls down over the wall (Falcon, Timeout)
    const tiltA = clamp(num(P.armTilt, 0), -0.05, 0.15), curlA = clamp(num(P.armCurl, 0), 0, 0.08);
    for (const sx of [-1, 1]) {
      const pts = [], np = 14;
      for (let k = 0; k <= np; k++) {
        const u = k / np, ph0 = lerp(ph2 - 0.16, ph3 + 0.05, u);
        const pm = pt(sx > 0 ? ph0 : 2 * Math.PI - ph0, yArmRim, T / 2);
        // the pad's outer edge follows the wall (the round pads: their old inset from the rim) and curls out in front
        const xo = shPad === 'round' ? pm[0] - sx * (padW / 2 - T / 2 - 0.004) + sx * (padW / 2) : pm[0] + sx * (T / 2 + 0.004);
        pts.push([xo - sx * val(aP, u) + sx * curl * sstep(shPad === 'round' ? 0.72 : 0.45, 1, u), yArmRim + val(bP, u) - 0.006 + rise * sstep(0.75, 1, u) - drop * sstep(0.82, 1, u), pm[2]]);
      }
      const padGeo = sweepGeometry(pts, { a: aP, b: bP, r: shPad === 'lid' ? 0.75 : 0.85, nc: 5, ns: 3, nEnd: 4, capLen: shPad === 'lid' ? 0.8 : 1 });
      if (tiltA || curlA) {
        const p = padGeo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const z = p.getZ(i);
          let k = 1;
          while (k < np && pts[k][2] < z) k++;
          const f = clamp01((z - pts[k - 1][2]) / (pts[k][2] - pts[k - 1][2] || 1)), u = (k - 1 + f) / np;
          const s = clamp((sx * (p.getX(i) - lerp(pts[k - 1][0], pts[k][0], f))) / val(aP, u), -1.2, 1.2);
          p.setY(i, p.getY(i) + sstep(0.1, 0.6, u) * (tiltA * 0.5 * s - curlA * (Math.max(0, s - 0.3) / 0.7) ** 2));
        }
        p.needsUpdate = true;
        K.smoothNormals(padGeo);
        padGeo.computeBoundingBox();
        padGeo.computeBoundingSphere();
      }
      addUp(g, padGeo);
    }
    if (st.lever) {
      const pl = pt(2 * Math.PI - phiAt(zf - 0.3, yArmRim - 0.08), yArmRim - 0.08, 0);
      addLever(g, metal, [pl[0] - 0.002, pl[1], pl[2]], -1);
    }
  }

  // ---- base (swivel star of 5 flat bars, slim 4-bar star, or round plate)
  const zBase = body === 'shell' ? (zf - 0.045 + rearZ(yb)) / 2 : lerp(zr, zf, 0.47);
  // (starR / discR: radius, basePlate: width of the plate under the seat; legStyle 'block' = four short legs (MUREN),
  // 'runners' = two low hidden runners (Nakskov); star 'spider' = arched bars on a tall hub (Bern))
  const yBody = AG ? AG.yA0 : yb;
  if (AG && P.baseCone > 0) {
    // baseCone (HAVBERG): the body narrows to a cone hub over the column (radius at the top), in the side material
    const r1 = clamp(P.baseCone, 0.05, 0.3), y1 = yBody + 0.02, y0 = Math.min(legH + 0.01, y1 - 0.04);
    const geo = K.lathe([[0.001, y0], [0.045, y0], [0.05, y0 + 0.006], [r1 * 0.55, lerp(y0, y1, 0.55)], [r1, y1 - 0.004], [r1 - 0.01, y1], [0.001, y1]], { seg: Math.max(16, Math.round(32 * q)) });
    const cone = new THREE.Group();
    cone.position.z = zBase;
    g.add(cone);
    addSide(cone, geo);
  }
  if (body === 'classic') {
    // (built with the arm pads: the Classic ring's uprights carry them, the Cross / Star bases carry the steel arm loops)
  } else if (P.legStyle === 'block') {
    // four short square legs under the arm panels' corners (MUREN); legR: half the leg's thickness at the top
    const ax = w / 2 - Math.min(armW * 0.5, 0.075), r = clamp(num(P.legR, 0.024), 0.01, 0.04);
    const az0 = AG ? AG.zBat(yBody) + 0.06 : zr + 0.1, az1 = AG ? AG.zFat(yBody) - 0.05 : zf - 0.1;
    fourLegs(g, ms, 'block', { ax, az0, az1, topY: yBody + 0.004, q, rTop: r, rBot: r * 0.72, splayX: 3, splayF: 4, splayB: 6, square: true });
  } else if (P.legStyle === 'runners') {
    // two low runners almost hidden under the body (Nakskov)
    // runnerL: the runners' length as a fraction of the body's depth (short: only small feet show)
    const rl = (AG ? AG.zFat(yBody) - AG.zBat(yBody) - 0.08 : d * 0.6) * clamp(num(P.runnerL, 1), 0.2, 1), rz = AG ? (AG.zFat(yBody) + AG.zBat(yBody)) / 2 : zBase;
    for (const sx of [-1, 1]) g.add(K.partMesh(K.roundedBox(0.03, Math.max(0.012, yBody - 0.002), Math.max(0.2, rl), 0.006, 1, { bottom: true }), ms.legs(), 'legs', { position: [sx * (iw / 2 - 0.08), 0, rz] }));
  } else if (disc && P.discT > 0) {
    // discT (m): a thick round plate on the floor right under the body, a short wide collar up to it (Prince)
    const sub = new THREE.Group();
    sub.position.z = zBase;
    g.add(sub);
    const r = typeof P.discR === 'number' ? clamp(P.discR, 0.1, 0.4) : clamp(Math.min(w, d) * 0.4, 0.2, 0.32), T = clamp(P.discT, 0.01, Math.max(0.012, yBody - 0.004));
    const prof = [[0.001, 0], [r - 0.01, 0], [r - 0.002, 0.004], [r, 0.012], [r, T - 0.008], [r - 0.006, T - 0.001], [r - 0.012, T]];
    if (yBody > T + 0.006) prof.push([0.09, T], [0.09, yBody + 0.004]);
    prof.push([0.001, prof[prof.length - 1][1]]);
    sub.add(K.partMesh(K.lathe(prof, { seg: Math.max(20, Math.round(44 * q)) }), ms.legs(), 'legs'));
  } else if (disc) {
    const sub = new THREE.Group();
    sub.position.z = zBase;
    g.add(sub);
    swivelDisc(sub, ms, typeof P.discR === 'number' ? clamp(P.discR, 0.1, 0.4) : clamp(Math.min(w, d) * 0.4, 0.2, 0.32), legH + 0.004, q);
  } else if (body === 'shell' && Number.isFinite(shYB)) {
    // a raised shell bowl (shellBottom): the column runs up into its underside under a round swivel disc
    // (params.shellDisc, its radius in m; 0 = none), no square plate
    const yS = Math.min(shYB, seatH - sTh - 0.01), rD = clamp(num(P.shellDisc, 0.08), 0, 0.2);
    starBase(g, ms, { r: clamp(Math.min(w, d) * 0.44, 0.24, 0.38), topY: yS + 0.006, q, arms: st.starArms, slim: st.slim, z: zBase, plate: 0 });
    if (rD > 0) g.add(K.partMesh(K.cylinder(rD, rD * 0.92, 0.014, { seg: Math.max(16, Math.round(28 * q)) }), ms.legs(), 'legs', { position: [0, yS - 0.012, zBase] }));
  } else if (P.star === 'spider') spiderBase(g, ms, { r: clamp(num(P.starR, 0.36), 0.2, 0.45), topY: yBody + 0.004, q, arms: st.starArms, z: zBase, bend: clamp(num(P.starBend, 1.6), 0.6, 3), bar: clamp(num(P.starBar, 0.017), 0.008, 0.03), hub: clamp(num(P.starHub, 0.1), 0.03, 0.2) });
  // (fabric box arm styles: the column reaches the body's underside, which may stand well above legH)
  else starBase(g, ms, { r: typeof P.starR === 'number' ? clamp(P.starR, 0.2, 0.45) : clamp(Math.min(w, d) * 0.44, 0.24, 0.38), topY: AG ? Math.max(legH, yBody) + 0.004 : legH + 0.004, q, arms: st.starArms, slim: st.slim, z: zBase, plate: num(P.basePlate, 0.24) });

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
      // small moulded tray with a thick cushion – params.stoolTray: the tray's height (m; Afterwork's covers most of the
      // side), params.stoolT: the cushion's thickness, params.stoolTuft: a button tuft in the middle of its top
      const cS = clamp(num(P.stoolT, cT), 0.04, 0.2);
      yc0 = fh - cS;
      const trayH = clamp(num(P.stoolTray, 0.06), 0.03, 0.2), ty0 = yc0 + Math.min(0.03, cS * 0.3) - trayH;
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
      const cGeo = softBox(fw - 0.03, cS - 0.01, fd - 0.03, 'y', { puff: 0.12, round: 0.8, sides: 0.2, bottom: 0.1, q, seg: segFor(fw, fd) });
      if (P.stoolTuft === true) {
        const p = cGeo.attributes.position, yT = (cS - 0.01) / 2;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > yT * 0.4) p.setY(i, p.getY(i) - 0.012 * clamp01((p.getY(i) - yT * 0.4) / (yT * 0.6)) * Math.exp(-(p.getX(i) ** 2 + p.getZ(i) ** 2) / 0.035 ** 2));
        p.needsUpdate = true;
        K.smoothNormals(cGeo);
        top.add(K.partMesh(sharedButton(q), ms.up, 'upholstery', { position: [0, cS - 0.01 + 0.004 - 0.012, 0], rotation: [-Math.PI / 2, 0, 0] }));
      }
      addUp(top, cGeo, { position: [0, (cS - 0.01) / 2, 0] });
      yc0 = ty0;
    } else if (body === 'box' && st.sides === 'shell') {
      // smooth fabric body, sheepskin top
      const bH = cT * 0.55, tH = cT - bH + 0.04;
      addFrame(fs, softBox(fw, bH, fd, 'y', { puff: 0.03, round: 0.5, sides: 0.1, q }), { position: [0, yc0 + bH / 2, 0] });
      addUp(fs, softBox(fw + 0.012, tH, fd + 0.012, 'y', { puff: 0.12, round: 0.9, sides: 0.25, bottom: 0.2, q, seg: segFor(fw, fd) }), { position: [0, fh - tH / 2, 0] });
    } else if (body === 'classic') {
      // Stressless footstool: a domed, puffy pad falling away from the chair (params.stoolTilt°) to a rounded far nose,
      // with params.stoolSeams cross seams (default 1) and an optional centre seam (stoolCenterSeam), on its own small
      // base of the chair's type
      const fall = num(P.stoolTilt, 7) * DEG;
      const tH = clamp(fh * 0.42, 0.13, 0.2);
      yc0 = fh - tH - (fd / 2) * Math.sin(fall);
      const top = new THREE.Group();
      top.position.set(0, yc0, 0);
      top.rotation.x = fall;
      fs.add(top);
      const nS = clamp(Math.round(num(P.stoolSeams, 1)), 0, 3), cSeam = P.stoolCenterSeam === true;
      const zsS = [];
      // (params.stoolSeamAt: a single seam that far along from the chair end, as a fraction – Tokyo, near the chair)
      for (let k = 1; k <= nS; k++) zsS.push(-fd / 2 + fd * (nS === 1 && P.stoolSeamAt != null ? clamp(num(P.stoolSeamAt, 0.5), 0.1, 0.9) : k / (nS + 1)));
      const domeS = clamp(num(P.stoolDome, 0.02), 0, 0.05); // the top's puff between the seams
      const rS = Math.min(0.055, fw * 0.1);
      const nxS = 2 * Math.max(8, Math.round(fd / 0.022));
      const levels = levelsY(-fw / 2 + rS, fw / 2 - rS, cSeam ? [-0.03, -0.012, 0, 0.012, 0.03] : [], step * 2.2).map((x) => {
        const ex = 1 - Math.pow(Math.abs(x) / (fw / 2), 6);
        const cx = cSeam ? dip(x, 0) : 1, gx = cSeam ? groove(x, 0) : 0;
        const front = (zz) => {
          let py = 1, gr = gx;
          for (const s of zsS) {
            py *= dip(zz, s);
            gr += groove(zz, s);
          }
          return ex * (domeS * (1 - Math.pow(Math.min(1, Math.abs(zz) / (fd / 2)), 4)) * py * cx - 0.0045 * Math.min(1, gr));
        };
        return { y: x, loop: rrLoop(fd / 2, 0, tH - 0.02, Math.min(0.075, tH * 0.48), 0.03, { nx: nxS, nArc: 5, nSide: 2, front }) };
      });
      addUp(top, loftGeometry(levels, { top: rS, bottom: rS, nEdge: 3, nCap: 2, matrix: PROFILE_X }));
      if (P.stoolWelt === true) {
        // params.stoolWelt: piping round the top's rounded edge (Paris, Tokyo)
        const rT = Math.min(0.075, tH * 0.48), e = rT * 0.3, ins = (r) => r - Math.sqrt(Math.max(0, r * r - (r - e) ** 2));
        addUp(top, pipeLoop([0, tH - 0.02 - e, 0], X, Z, fw / 2 - ins(rS), fd / 2 - ins(rT), Math.min(rS, rT), 0.0055, q));
      }
    } else if (P.stoolSeam != null || P.stoolWedge != null || P.stoolT != null || P.stoolWelt != null || P.stoolTufts != null || P.stoolTray != null) {
      // shaped stool cushion (fabric box recliners): stoolT thickness, stoolSeam 'full' | 'short' | 'center' |
      // 'none', stoolWedge (m higher at the chair end), stoolDome, stoolR (edge radius), stoolWelt (welt round the
      // top), stoolTufts (n × n buttons, HAVBERG)
      const sT = clamp(num(P.stoolT, cT), 0.06, fh - 0.1);
      yc0 = fh - sT;
      const mode = P.stoolSeam || 'none', wedge = clamp(num(P.stoolWedge, 0), -0.1, 0.12), dome = clamp(num(P.stoolDome, 0.012), 0, 0.05);
      const zg = mode === 'center' || mode === 'short' ? 0 : -fd / 2 + fd * 0.3;
      const nxS = 2 * Math.max(6, Math.round(fd / (step * 1.35)));
      const rS = clamp(num(P.stoolR, Math.min(0.05, fw * 0.1)), 0.015, Math.min(fw, sT) * 0.45);
      const top = (zz) => -wedge * clamp01((zz + fd / 2) / fd) + wedge / 2;
      // tufts: n × n dimples pulled into the top, pillowed between them
      const nT = Math.round(clamp(num(P.stoolTufts, 0), 0, 4));
      const tx = [], tz = [];
      for (let i = 0; i < nT; i++) {
        tx.push(((i + 1) / (nT + 1) - 0.5) * fw * 0.92);
        tz.push(((i + 1) / (nT + 1) - 0.5) * fd * 0.92);
      }
      const tuft = (x, zz) => {
        let s = 0;
        for (const a of tx) for (const b of tz) s += Math.exp(-((x - a) ** 2 + (zz - b) ** 2) / 0.038 ** 2);
        return -0.012 * Math.min(1, s);
      };
      const nxT = nT ? 2 * Math.max(8, Math.round(fd / (step * 1.2))) : nxS;
      const levels = levelsY(-fw / 2 + rS, fw / 2 - rS, nT ? tx : [-0.03, 0, 0.03], step * 1.5).map((x) => {
        const ex = 1 - Math.pow(Math.abs(x) / (fw / 2), 6);
        const ms0 = mode === 'none' ? 0 : mode === 'short' ? 1 - sstep(0.22 * fw, 0.3 * fw, Math.abs(x)) : 1;
        const front = (zz) => top(zz) + ex * (dome * (1 - Math.pow(Math.min(1, Math.abs(zz) / (fd / 2)), 4)) * (ms0 ? lerp(1, dip(zz, zg), ms0) : 1) - 0.0035 * ms0 * groove(zz, zg) + (nT ? tuft(x, zz) : 0));
        return { y: x, loop: rrLoop(fd / 2, yc0, fh - 0.012 - wedge / 2, Math.max(rS * 1.02, Math.min(0.06, sT * 0.4)), rS * 1.02, { nx: nxT, nArc: 4, nSide: 3, front }) };
      });
      addUp(fs, loftGeometry(levels, { top: rS, bottom: rS, nEdge: 3, nCap: 2, matrix: PROFILE_X }));
      if (nT && P.tuftButtons !== false) {
        const bg = tuftButton(q);
        for (const a of tx) for (const b of tz) fs.add(K.partMesh(bg, ms.up, 'upholstery', { position: [a, fh - 0.012 - wedge / 2 + top(b) + dome - 0.012, b], rotation: [-Math.PI / 2, 0, 0] }));
      }
      if (P.stoolWelt) {
        const e = rS * 0.35, pts = [];
        for (const p of rectLoop3([0, 0, 0], X, Z, fw / 2 - e, fd / 2 - e, rS * 0.9, 4)) pts.push([p.x, fh - 0.012 - wedge / 2 - e * 0.6 + top(p.z), p.z]);
        fs.add(K.partMesh(seamTube(pts, 0.0045, { closed: true, radial: q < 1 ? 3 : 4 }), ms.pipe, ms.pipePart));
      }
      if (P.stoolTray > 0) {
        // stoolTray (HAVBERG): a shallow shell (side material) round the cushion's lower part, this tall
        const tH = clamp(P.stoolTray, 0.03, sT), yT0 = yc0 - tH * 0.45, yT1 = yc0 + tH * 0.55, lv = [];
        for (let k = 0; k <= 4; k++) {
          const t = k / 4, sc = lerp(0.9, 1, Math.sin((t * Math.PI) / 2));
          const hx = (fw / 2 + 0.012) * sc, hz = (fd / 2 + 0.012) * sc, r = Math.min(hx, hz) * 0.35;
          lv.push({ y: lerp(yT0 + 0.008, yT1 - 0.008, t), loop: rrLoop(hx, -hz, hz, r, r, { nx: 6, nArc: 4, nSide: 4 }) });
        }
        const geo = loftGeometry(lv, { top: 0.008, bottom: 0.008, nEdge: 2, nCap: 3 });
        if (P.armFrame === true && hasFrame) addFrame(fs, geo);
        else addUp(fs, geo);
        yc0 = yT0;
      }
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
    if (body === 'classic') {
      const Rs = clamp(fd * 0.52, 0.17, 0.23);
      if (sBase === 'classic') ringBase(fs, ms, { r: Rs, topY: yc0, q, postX: Rs - 0.03, postTop: yc0 + 0.02, postD: 0.08, band: 0.05, bandH: 0.03 });
      else stresslessBase(fs, ms, { kind: sBase, r: clamp(Math.min(fw, fd) * 0.62, 0.22, 0.3), topY: yc0 + 0.01, q });
    } else if (body === 'shell' && Number.isFinite(shYB)) {
      // (as the chair: the column into the tray under a round disc)
      const rD = clamp(num(P.shellDisc, 0.08), 0, 0.2) * 0.8;
      starBase(fs, ms, { r: clamp(Math.min(fw, fd) * 0.62, 0.17, 0.3), topY: yc0 + 0.006, q, arms: 4, slim: st.slim, plate: 0 });
      if (rD > 0) fs.add(K.partMesh(K.cylinder(rD, rD * 0.92, 0.012, { seg: Math.max(16, Math.round(24 * q)) }), ms.legs(), 'legs', { position: [0, yc0 - 0.01, 0] }));
    } else if (P.star === 'spider') spiderBase(fs, ms, { r: clamp(num(P.stoolStarR, Math.min(fw, fd) * 0.62), 0.15, 0.32), topY: yc0 - 0.004, q, arms: 4, bend: clamp(num(P.starBend, 1.6), 0.6, 3), bar: clamp(num(P.starBar, 0.017), 0.008, 0.03), hub: Math.min(0.08, (yc0 - 0.004) * 0.4) });
    else starBase(fs, ms, { r: typeof P.stoolStarR === 'number' ? clamp(P.stoolStarR, 0.15, 0.35) : clamp(Math.min(fw, fd) * 0.62, 0.17, 0.3), topY: yc0 - 0.004, q, arms: Math.round(clamp(num(P.stoolStarArms, 4), 3, 6)), slim: st.slim, plate: 0.14 });
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
  // named frame styles (the products' own constructions); unset = the classic open frame / wrapped back below
  const frameStyle = LOUNGE_FRAMES[P.frameStyle];
  if (frameStyle) return frameStyle({ g, ms, q, w, d, h, P, frame, legsM, seatH, armH, armW, loose });
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

// ---- lounge-wood frame styles (P.frameStyle) and the bentwood rocking chair --------------------------------------

/** Side-profile polyline [[z, y], …] with its inner corners rounded (one radius, or one per inner corner). */
function filletPath(pts, radii, step = 0.02) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const lu = Math.hypot(ax - bx, ay - by) || 1e-9, lv = Math.hypot(cx - bx, cy - by) || 1e-9;
    const ux = (ax - bx) / lu, uy = (ay - by) / lu, vx = (cx - bx) / lv, vy = (cy - by) / lv;
    const ang = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
    const r0 = Array.isArray(radii) ? radii[i - 1] : radii;
    if (!(r0 > 0) || ang > Math.PI - 0.01) {
      out.push(pts[i]);
      continue;
    }
    const t = Math.min(r0 / Math.tan(ang / 2), lu * 0.49, lv * 0.49);
    const r = t * Math.tan(ang / 2);
    const ml = Math.hypot(ux + vx, uy + vy) || 1e-9;
    const dc = r / Math.sin(ang / 2);
    const c = [bx + ((ux + vx) / ml) * dc, by + ((uy + vy) / ml) * dc];
    const a0 = Math.atan2(by + uy * t - c[1], bx + ux * t - c[0]);
    let da = Math.atan2(by + vy * t - c[1], bx + vx * t - c[0]) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(2, Math.ceil((Math.abs(da) * r) / step));
    for (let k = 0; k <= n; k++) {
      const a = a0 + (da * k) / n;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Smooth side-profile curve through [[z, y], …] (centripetal Catmull-Rom): n + 1 points evenly spaced. */
function splinePath(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map(([a, b]) => new THREE.Vector3(a, b, 0)), false, 'centripetal');
  return c.getSpacedPoints(n).map((v) => [v.x, v.y]);
}

/** Wooden member swept along a side profile [[z, y], …] at x: wx wide (along x) × th thick (in the profile plane). */
function profileBeam(pts, x, wx, th, { r = 0.4, capLen = 0.25, nEnd = 2 } = {}) {
  return sweepGeometry(pts.map(([z, y]) => [x, y, z]), { a: wx / 2, b: th / 2, r, side: [1, 0, 0], nc: 3, ns: 1, nEnd, capLen });
}

/** Wooden rail between two points with an upright section (wide × tall; tall stays as vertical as it can), grain along it. */
function addRail(g, material, part, a, b, wide, tall, r = 0.004) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.005) return;
  const geo = K.roundedBox(wide, tall, len, Math.min(r, wide / 2.2, tall / 2.2), 1, { grain: 'z' });
  const m = K.partMesh(geo, material, part, { position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
  const zAx = new THREE.Vector3(dx, dy, dz).normalize();
  const xAx = new THREE.Vector3().crossVectors(_UP, zAx);
  if (xAx.lengthSq() < 1e-8) xAx.set(1, 0, 0);
  xAx.normalize();
  const yAx = new THREE.Vector3().crossVectors(zAx, xAx);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, yAx, zAx));
  g.add(m);
}

/** Plan path [[x, z], …] of a U: sides at ±xs from the front ends (zEnd) back into corners of radius rc, back at zb (bowed by bow). */
function uPlan(xs, zEnd, zb, rc, { nArc = 8, nBack = 6, bow = 0 } = {}) {
  const pts = [[xs, zEnd], [xs, (zEnd + zb + rc) / 2]];
  for (let k = 0; k <= nArc; k++) {
    const a = -(Math.PI / 2) * (k / nArc);
    pts.push([xs - rc + rc * Math.cos(a), zb + rc + rc * Math.sin(a)]);
  }
  const xb = Math.max(1e-4, xs - rc);
  for (let k = 1; k < nBack; k++) {
    const x = xb * (1 - (2 * k) / nBack);
    pts.push([x, zb - bow * (1 - (x / xb) ** 2)]);
  }
  for (let k = 0; k <= nArc; k++) {
    const a = -Math.PI / 2 - (Math.PI / 2) * (k / nArc);
    pts.push([-(xs - rc) + rc * Math.cos(a), zb + rc + rc * Math.sin(a)]);
  }
  pts.push([-xs, (zEnd + zb + rc) / 2], [-xs, zEnd]);
  return pts;
}

/**
 * Upholstered pad lying on a side-profile support line [[z, y], …] (seat front → top of the back): rounded sections
 * across x, from the support (back face) out toward the sitter by thick(u, x) (u = arc fraction). Half width hw (a
 * number or a function of u), side edges rounded over re, bull-nosed ends (endLen × half thickness). xs = front /
 * back face samples in −1..1 (fractions of the flat part; put groove positions in), at = extra arc lengths to sample
 * (grooves across). Metre UVs (u round the section, v along the support).
 */
function padGeometry(support, { thick, hw, xs, re = 0.03, step = 0.03, at = [], nc = 3, nEnd = 4, endLen = 1 }) {
  const val = (f, u) => (typeof f === 'function' ? f(u) : f);
  const cum = [0];
  for (let i = 1; i < support.length; i++) cum.push(cum[i - 1] + Math.hypot(support[i][0] - support[i - 1][0], support[i][1] - support[i - 1][1]));
  const L = cum[cum.length - 1];
  const pointAt = (s) => {
    s = clamp(s, 0, L);
    let j = 0;
    while (j < support.length - 2 && cum[j + 1] < s) j++;
    const f = clamp((s - cum[j]) / (cum[j + 1] - cum[j] || 1e-9), 0, 1);
    return [lerp(support[j][0], support[j + 1][0], f), lerp(support[j][1], support[j + 1][1], f)];
  };
  const n = Math.max(4, Math.round(L / step));
  const raw = [];
  for (let k = 0; k <= n; k++) raw.push((L * k) / n);
  for (const s of at) if (s > 0.002 && s < L - 0.002) raw.push(s);
  raw.sort((a, b) => a - b);
  const S = [];
  for (const s of raw) if (!S.length || s - S[S.length - 1] > 0.0015 || s === L) S.push(s);
  const frameAt = (s) => {
    const p = pointAt(s), a = pointAt(s - 0.008), b = pointAt(s + 0.008);
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = [(b[0] - a[0]) / tl, (b[1] - a[1]) / tl];
    return { p, t, n: [t[1], -t[0]] };
  };
  const ring = (s, scale = 1, shift = 0) => {
    const u = s / L;
    const H = Math.max(0.01, val(hw, u));
    const r = Math.min(re, H * 0.9);
    const xf = H - r;
    const T = (x) => Math.max(0.004, thick(u, x));
    const loop = [];
    for (const f of xs) loop.push([f * xf, 0]);
    const Tr = T(xf), Tl = T(-xf);
    for (let k = 1; k < 2 * nc; k++) {
      const ph = (Math.PI * k) / (2 * nc);
      loop.push([xf + r * Math.sin(ph), (Tr / 2) * (1 - Math.cos(ph))]);
    }
    for (let i = xs.length - 1; i >= 0; i--) loop.push([xs[i] * xf, T(xs[i] * xf)]);
    for (let k = 1; k < 2 * nc; k++) {
      const ph = (Math.PI * k) / (2 * nc);
      loop.push([-xf - r * Math.sin(ph), (Tl / 2) * (1 + Math.cos(ph))]);
    }
    const { p, t, n: nn } = frameAt(s);
    const co = T(0) / 2;
    const sx = 1 - (1 - scale) * 0.12;
    return loop.map(([x, o]) => {
      const O = co + (o - co) * scale;
      return [x * sx, p[1] + nn[1] * O + t[1] * shift, p[0] + nn[0] * O + t[0] * shift];
    });
  };
  const rows = [];
  const e0 = endLen * Math.max(0.004, thick(0, 0)) / 2, e1 = endLen * Math.max(0.004, thick(1, 0)) / 2;
  for (let k = nEnd; k >= 1; k--) {
    const f = (Math.PI / 2) * (k / nEnd);
    rows.push(ring(0, Math.max(1e-3, Math.cos(f)), -e0 * Math.sin(f)));
  }
  for (const s of S) rows.push(ring(s));
  for (let k = 1; k <= nEnd; k++) {
    const f = (Math.PI / 2) * (k / nEnd);
    rows.push(ring(L, Math.max(1e-3, Math.cos(f)), e1 * Math.sin(f)));
  }
  const geo = gridGeometry(rows);
  geo.userData.L = L;
  return geo;
}

/** Support line [[z, y], …] offset by o (number or function of the arc fraction) along its sitter-side normal. */
function offsetPath(pts, o) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1] || 1;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tz = (b[0] - a[0]) / tl, ty = (b[1] - a[1]) / tl;
    const v = typeof o === 'function' ? o(cum[i] / L) : o;
    return [p[0] + ty * v, p[1] - tz * v];
  });
}

/** Smooth bump of half width hw at c (grooves, seams). */
const bump = (x, c, hw) => Math.exp(-(((x - c) / hw) ** 2));

/**
 * Tube with a (super)elliptic section swept along a polyline: half sizes a (across, horizontal) × b (up), squareness
 * p (2 = ellipse, higher = squarer), domed ends of capLen · min(a, b). For upholstered rolls taller than they are wide.
 */
function ovalSweep(points, { a, b, p = 2, n = 24, nEnd = 5, capLen = 0.4 }) {
  const P = points.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  const m = P.length;
  const loop = [];
  for (let k = 0; k < n; k++) {
    const t = -Math.PI / 2 + (2 * Math.PI * k) / n;
    const c = Math.cos(t), s = Math.sin(t);
    loop.push([a * Math.sign(c) * Math.abs(c) ** (2 / p), b * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  const up = new THREE.Vector3(0, 1, 0);
  const frames = P.map((_, i) => {
    const t = new THREE.Vector3().subVectors(P[Math.min(m - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
    const nn = up.clone().addScaledVector(t, -up.dot(t)).normalize();
    return { t, n: nn, b: new THREE.Vector3().crossVectors(t, nn).normalize() };
  });
  const sect = (i, scale, shift) => {
    const { t, n: nn, b: bb } = frames[i];
    const c = P[i].clone().addScaledVector(t, shift);
    return loop.map(([x, y]) => [c.x + (bb.x * x + nn.x * y) * scale, c.y + (bb.y * x + nn.y * y) * scale, c.z + (bb.z * x + nn.z * y) * scale]);
  };
  const e = Math.min(a, b) * capLen;
  const rows = [];
  for (let k = nEnd; k >= 1; k--) rows.push(sect(0, Math.max(1e-3, Math.cos((Math.PI / 2) * (k / nEnd))), -e * Math.sin((Math.PI / 2) * (k / nEnd))));
  for (let i = 0; i < m; i++) rows.push(sect(i, 1, 0));
  for (let k = 1; k <= nEnd; k++) rows.push(sect(m - 1, Math.max(1e-3, Math.cos((Math.PI / 2) * (k / nEnd))), e * Math.sin((Math.PI / 2) * (k / nEnd))));
  return gridGeometry(rows);
}

/**
 * Actona Ellis: a thick bolster (U in plan) on four straight round legs, a pillow seat on a wooden apron. The roll is
 * round (rollD) unless rollW (across) / rollH (tall) give it an upright oval section; rearLegRake sets the rear legs'
 * feet back from their tops.
 */
function loungeRoll({ g, ms, q, w, d, h, P, frame, legsM, seatH, armW }) {
  const zr = -d / 2, zf = d / 2;
  const R = clamp(num(P.rollD, Math.max(armW, 0.12)), 0.1, 0.28) / 2;
  const oval = P.rollW != null || P.rollH != null;
  const Ra = oval ? clamp(num(P.rollW, R * 2), 0.08, 0.28) / 2 : R, Rb = oval ? clamp(num(P.rollH, R * 2), 0.08, 0.3) / 2 : R;
  const yc = h - Rb;
  const xs = w / 2 - Ra, zb = zr + Ra;
  const capLen = 0.4;
  const zEnd = zf - num(P.rollInset, 0.03) - Math.min(Ra, Rb) * capLen;
  const rc = clamp(num(P.rollCorner, 0.2), Ra * 1.05, Math.min(xs * 0.95, (zEnd - zb) * 0.7));
  const plan = uPlan(xs, zEnd, zb, rc, { nArc: Math.max(6, Math.round(10 * q)), nBack: 6, bow: num(P.rollBow, 0) });
  const rollPath = plan.map(([x, z]) => [x, yc, z]);
  const rollGeo = oval
    ? ovalSweep(rollPath, { a: Ra, b: Rb, p: num(P.rollSquare, 2.4), n: Math.max(16, Math.round(24 * q)), nEnd: 5, capLen })
    : sweepGeometry(rollPath, { a: R, b: R, r: 0.98, nc: Math.max(4, Math.round(6 * q)), ns: 1, nEnd: 5, capLen });
  g.add(K.partMesh(rollGeo, ms.up, 'upholstery'));
  // four straight round legs carrying the roll: the front pair under its ends, the rear pair in its back corners
  const lr = num(P.legD, 0.052) / 2;
  const seg = Math.max(10, Math.round(16 * q));
  const zFL = zEnd - num(P.frontLegBack, 0.07);
  const xFL = xs + num(P.frontLegOut, 0.02);
  const aR = num(P.rearLegAngle, 55) * DEG;
  const xRL = xs - rc + rc * Math.cos(aR), zRL = zb + rc - rc * Math.sin(aR);
  const rake = num(P.rearLegRake, 0);
  const zRLat = (y) => zRL - rake * (1 - y / yc);
  for (const sx of [-1, 1]) {
    addLeg(g, legsM, 'legs', [sx * xFL, yc, zFL], [sx * xFL, 0, zFL], lr, lr, { seg });
    addLeg(g, legsM, 'legs', [sx * xRL, yc, zRL], [sx * xRL, 0, zRLat(0)], lr, lr, { seg });
  }
  // apron rails between the legs, the seat cushion resting on them
  const apT = num(P.apronTop, 0.25), apH = 0.042, ya = apT - apH / 2;
  addRail(g, frame, 'frame', [-xFL, ya, zFL], [xFL, ya, zFL], 0.024, apH);
  addRail(g, frame, 'frame', [-xRL, ya, zRLat(ya)], [xRL, ya, zRLat(ya)], 0.024, apH);
  for (const sx of [-1, 1]) addRail(g, frame, 'frame', [sx * xFL, ya, zFL], [sx * xRL, ya, zRLat(ya)], 0.024, apH);
  const sw = Math.min(xFL - lr - 0.003, w / 2 - 0.05);
  const out = rrOutline(-sw, sw, zr + num(P.seatBack, 0.1), zf, num(P.seatRBack, 0.22), num(P.seatRFront, 0.17), 8, 4);
  const sH = seatH - apT;
  g.add(K.partMesh(slabGeometry(out, { y0: apT, y1: seatH, rTop: Math.min(num(P.seatRTop, 0.06), sH * 0.45), rBot: Math.min(num(P.seatRBot, 0.04), sH * 0.3), belly: 0.007, dome: 0.012, nEdge: 4, nCap: 4 }), ms.up, 'upholstery'));
  return K.finishModel(g, { seatY: seatH });
}

/** Signature 920: square legs, the rear leg raked forward to the arm, the arm board bent up into a reclined horn, loose cushions. */
function loungeSled({ g, ms, q, w, d, h, P, frame, legsM, seatH, armH, loose }) {
  const zr = -d / 2, zf = d / 2;
  const frameV = ms.frame({ grain: 'v' });
  const lw = num(P.legW, 0.04);
  const aw = Math.max(lw + 0.008, num(P.armBoardW, 0.05)), at = num(P.armT, 0.032);
  const x = w / 2 - aw / 2;
  const zFL = zf - num(P.frontLegInset, 0.075);
  const zJ = zr + num(P.junctionZ, 0.2);
  const yA = armH - at / 2, yJ = yA - num(P.armDrop, 0.02);
  let rec = num(P.backRecline, 22) * DEG;
  const hornTop = h - num(P.hornDrop, 0.11);
  const hornRec = num(P.hornRecline, 30) * DEG;
  const zH = zJ - num(P.hornBack, 0); // where the arm bends up into the horn (default: over the rear leg)
  const zFoot = zr + num(P.rearFoot, 0.03);
  const yLegTop = yJ - at / 2 + 0.004;
  const zRear = (y) => zFoot + ((zJ - zFoot) * y) / yLegTop;
  const railH = 0.04;
  const railTop = clamp(num(P.legH, 0.25) + railH, 0.15, seatH - 0.08);
  const yR = railTop - railH / 2;
  for (const sx of [-1, 1]) {
    const X = sx * x;
    addRail(g, legsM, 'legs', [X, 0, zFL], [X, yA - at / 2 + 0.004, zFL], lw, lw, 0.005);
    addRail(g, legsM, 'legs', [X, 0, zFoot], [X, yLegTop, zJ], lw, lw, 0.005);
    const prof = filletPath([[zf - num(P.armFront, 0.02), yA], [zH, yJ], [zH - (hornTop - yJ) * Math.tan(hornRec), hornTop]], num(P.armBend, 0.09));
    g.add(K.partMesh(profileBeam(prof, X, aw, at, { r: 0.3, capLen: 0.15 }), frameV, 'frame'));
    addRail(g, frame, 'frame', [X, yR, zRear(yR)], [X, yR, zFL], 0.024, railH);
  }
  addRail(g, frame, 'frame', [-x, yR, zFL], [x, yR, zFL], 0.024, railH);
  addRail(g, frame, 'frame', [-x, yR, zRear(yR)], [x, yR, zRear(yR)], 0.024, railH);
  const xb = x - aw / 2 - 0.03;
  const zB0 = zRear(yR) + 0.02, yB0 = yR;
  const zPlane = (y) => zB0 - (y - yB0) * Math.tan(rec);
  // zLean(y): where the back cushion's rear face stands (minus its 0.012 clearance)
  let zLean = zPlane;
  if (P.backFrame === 'horns') {
    // back frame hung on the horns (they are its sides): a top rail between the horn tips, slats from the rear seat
    // rail up to it; the back cushion leans on the top rail
    const yTR = hornTop - num(P.topRailDrop, 0.035);
    const zTR = zH - (yTR - yJ) * Math.tan(hornRec);
    const zS = zRear(yR), yS = yR + railH / 2 - 0.004;
    const pr = Math.atan2(zS - zTR, yTR - yS);
    const tr = K.partMesh(K.roundedBox(2 * x, 0.055, 0.022, 0.005, 1, { grain: 'x' }), frame, 'frame', { position: [0, yTR, zTR], rotation: [-pr, 0, 0] });
    g.add(tr);
    for (const X of [-xb / 2, 0, xb / 2]) addRail(g, frame, 'frame', [X, yS, zS], [X, yTR - 0.02, zTR + (zS - zTR) * (0.02 / (yTR - yS))], 0.035, 0.02);
    if (P.backRecline == null) rec = pr; // the cushion lies on the slats
    const Cz = zTR + 0.011 / Math.cos(pr), Cy = yTR;
    zLean = (y) => Cz + (Cy - y) * Math.tan(rec) - 0.012;
  } else {
    // back frame (behind the cushion): reclined side members, top rail, three slats
    const yBT = h - 0.1;
    for (const X of [-xb, xb, -xb / 2, 0, xb / 2]) {
      const side = Math.abs(X) === xb;
      const y0 = side ? yB0 : seatH;
      addRail(g, frame, 'frame', [X, y0, zPlane(y0)], [X, side ? yBT : yBT - 0.03, zPlane(side ? yBT : yBT - 0.03)], side ? 0.035 : 0.03, 0.022);
    }
    addRail(g, frame, 'frame', [-xb, yBT - 0.03, zPlane(yBT - 0.03)], [xb, yBT - 0.03, zPlane(yBT - 0.03)], 0.022, 0.05);
  }
  // loose back cushion leaning on the back frame, resting on the seat cushion
  const bt = num(P.backCushionT, loose ? 0.16 : 0.1);
  const iw = 2 * (x - aw / 2) - 0.012;
  const yb = seatH - num(P.backTuck, 0.11);
  const bl = (h - yb) / Math.cos(rec) - 0.01 - num(P.backTrim, 0);
  const grp = new THREE.Group();
  grp.position.set(0, yb + (Math.sin(rec) * bt) / 2, zLean(yb) + 0.012 + (Math.cos(rec) * bt) / 2);
  grp.rotation.x = -rec;
  g.add(grp);
  const bgeo = softBox(iw - 0.01, bl, bt, 'z', { puff: loose ? 0.3 : 0.1, round: num(P.backRound, 0.9), sides: num(P.backSides, 0.35), bottom: 0.3, pinch: num(P.backPinch, loose ? 0.3 : 0.1), seg: 12, q });
  const ears = num(P.backEars, 0);
  if (ears) {
    // a stuffed pillow's top corners stand up a little above the middle of its top edge
    const pos = bgeo.attributes.position, hx = (iw - 0.01) / 2, hy = bl / 2;
    for (let i = 0; i < pos.count; i++) {
      const fx = Math.abs(pos.getX(i)) / hx, fy = pos.getY(i) / hy;
      if (fy > 0) pos.setY(i, pos.getY(i) + ears * fx ** 3 * fy ** 2);
    }
    pos.needsUpdate = true;
    K.smoothNormals(bgeo);
  }
  grp.add(K.partMesh(bgeo, ms.up, 'upholstery', { position: [0, bl / 2, 0] }));
  // seat cushion on the seat frame
  const st = seatH - railTop + 0.01;
  const zS0 = zLean(seatH) + 0.012 + bt * 0.62;
  const zS1 = zf - num(P.seatInset, 0.012);
  addCushion(g, ms, softBox(iw, st, zS1 - zS0, 'y', { puff: loose ? 0.14 : 0.08, round: 0.6, sides: 0.2, bottom: 0.1, q }), [0, railTop - 0.005 + st / 2, (zS0 + zS1) / 2], loose && P.piping !== false ? ['top'] : null, q);
  return K.finishModel(g, { seatY: seatH });
}

/** IKEA EKENÄSET: rear legs raked up to tapered arm boards, deep plank rails, a box seat and a full upholstered back panel. */
function loungeRaked({ g, ms, q, w, d, h, P, frame, legsM, seatH, armH, armW }) {
  const zr = -d / 2, zf = d / 2;
  const lr = num(P.legD, 0.042) / 2;
  const lx = w / 2 - num(P.legInset, 0.03);
  const seg = Math.max(8, Math.round(12 * q));
  const armT = num(P.armT, 0.024);
  const yU = armH - armT;
  const fTop = [lx, yU, zf - num(P.frontLegInset, 0.075)];
  const fFoot = [lx + 0.005, 0, fTop[2] + num(P.frontSplay, 0.03)];
  const rTop = [lx, yU, zr + num(P.rearLegTop, 0.17)];
  const rFoot = [lx + 0.005, 0, zr + num(P.rearFoot, 0.02)];
  const zOn = (top, foot, y) => foot[2] + ((top[2] - foot[2]) * y) / top[1];
  for (const sx of [-1, 1]) {
    for (const [tp, ft] of [[fTop, fFoot], [rTop, rFoot]]) addLeg(g, legsM, 'legs', [sx * tp[0], tp[1], tp[2]], [sx * ft[0], 0, ft[2]], lr, lr * 0.72, { seg });
  }
  // arm boards: wider at the front with a round end over the front leg, tapering toward the rear leg
  const aF = Math.max(0.045, num(P.armFrontW, armW + 0.012)), aB = aF * 0.66;
  const z1 = zf - num(P.armFront, 0.012), z0 = rTop[2] - num(P.armBack, 0.035);
  const shape = [[-aB / 2, -z0], [aB / 2, -z0]];
  for (let k = 0; k <= 10; k++) {
    const a = (Math.PI * k) / 10;
    shape.push([(aF / 2) * Math.cos(a), -(z1 - aF / 2 + (aF / 2) * Math.sin(a))]);
  }
  for (const sx of [-1, 1]) {
    const geo = K.extrudeShape(shape, armT, { bevel: 0.006, bevelSegments: 2, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2);
    K.worldUV(geo, 1, { grain: 'z' });
    g.add(K.partMesh(geo, frame, 'frame', { position: [sx * lx, yU, 0] }));
  }
  // deep plank rails round the seat
  const railT = num(P.railT, 0.075), y0r = num(P.legH, 0.22), yr = y0r + railT / 2, railTop = y0r + railT;
  const zF = zOn(fTop, fFoot, yr), zR = zOn(rTop, rFoot, yr);
  const xr = lx - lr * 0.4;
  for (const sx of [-1, 1]) addRail(g, frame, 'frame', [sx * xr, yr, zR], [sx * xr, yr, zF], 0.022, railT, 0.005);
  addRail(g, frame, 'frame', [-xr, yr, zF], [xr, yr, zF], 0.022, railT, 0.005);
  addRail(g, frame, 'frame', [-xr, yr, zR], [xr, yr, zR], 0.022, railT, 0.005);
  // full back panel, reclined, its top = the top of the chair
  const rec = num(P.backRecline, 15) * DEG;
  const bt = num(P.backT, 0.095);
  const iw = 2 * (lx - lr) - 0.006;
  const yb = railTop - 0.01;
  const bl = (h - yb - (bt / 2) * Math.sin(rec)) / Math.cos(rec) - 0.004;
  const zg = zr + num(P.backTopInset, 0.005) + bl * Math.sin(rec) + (bt / 2) * Math.cos(rec);
  const grp = new THREE.Group();
  grp.position.set(0, yb, zg);
  grp.rotation.x = -rec;
  g.add(grp);
  grp.add(K.partMesh(softBox(iw, bl, bt, 'z', { puff: 0.04, round: 0.32, sides: 0.08, bottom: 0.25, q }), ms.up, 'upholstery', { position: [0, bl / 2, 0] }));
  // crisp box seat cushion, a little past the front rail
  const st = seatH - railTop + 0.008;
  const zS0 = zg - (seatH - yb) * Math.tan(rec) + (bt / 2) / Math.cos(rec) - 0.01;
  const zS1 = zF + 0.011 + num(P.seatOver, 0.02);
  // seatTilt (degrees): the seat falls toward the back panel, its front edge staying at seatH
  const tilt = num(P.seatTilt, 0) * DEG;
  g.add(K.partMesh(softBox(iw, st, zS1 - zS0, 'y', { puff: 0.035, round: 0.28, sides: 0.05, bottom: 0.1, q }), ms.up, 'upholstery', { position: [0, railTop - 0.004 + st / 2 - ((zS1 - zS0) / 2) * Math.sin(tilt), (zS0 + zS1) / 2], rotation: [-tilt, 0, 0] }));
  return K.finishModel(g, { seatY: seatH });
}

/** Jakobsen Fjell: one round arm hoop round the back on four splayed round legs, a double-Y stretcher, oval seat and back pads. */
function loungeHoop({ g, ms, q, w, d, h, P, frame, legsM, seatH, armH }) {
  const zr = -d / 2, zf = d / 2;
  const frameV = ms.frame({ grain: 'v' });
  const brass = mat('brass', '#c8a463');
  const rr = num(P.armD, 0.036) / 2;
  const yH = armH - rr;
  const xs = w / 2 - rr - 0.012;
  const zEnd = zf - num(P.armInset, 0.045) - rr * 0.7;
  const zb = zr + num(P.hoopBack, 0.09);
  const rc = clamp(num(P.hoopCorner, 0.16), rr * 2, Math.min(xs * 0.9, (zEnd - zb) * 0.6));
  const plan = uPlan(xs, zEnd, zb, rc, { nArc: Math.max(6, Math.round(10 * q)), nBack: 6, bow: num(P.hoopBow, 0.015) });
  g.add(K.partMesh(sweepGeometry(plan.map(([x, z]) => [x, yH, z]), { a: rr, b: rr, r: 0.98, nc: 4, ns: 1, nEnd: 4, capLen: 0.7 }), frameV, 'frame'));
  // legs: round, tapered, splayed; the front pair under the arm ends, the rear pair in the hoop's corners
  const lt = num(P.legD, 0.038) / 2;
  const seg = Math.max(8, Math.round(12 * q));
  const zFL = zEnd - num(P.frontLegBack, 0.035);
  const aR = num(P.rearLegAngle, 50) * DEG;
  const xRL = xs - rc + rc * Math.cos(aR), zRL = zb + rc - rc * Math.sin(aR);
  const legs = [
    { top: [xs, yH, zFL], foot: [xs + num(P.splayX, 0.012), 0, zFL + num(P.splayF, 0.03)] },
    { top: [xRL, yH, zRL], foot: [xRL + num(P.splayX, 0.012) + 0.004, 0, zRL - num(P.splayB, 0.06)] },
  ];
  const onLeg = (L, y) => [L.foot[0] + ((L.top[0] - L.foot[0]) * y) / L.top[1], y, L.foot[2] + ((L.top[2] - L.foot[2]) * y) / L.top[1]];
  for (const sx of [-1, 1]) for (const L of legs) addLeg(g, legsM, 'legs', [sx * L.top[0], L.top[1], L.top[2]], [sx * L.foot[0], 0, L.foot[2]], lt, lt * 0.72, { seg });
  // X / double-Y stretcher of flat planks: a short spine along the middle, diagonals out to the four legs
  const yS = num(P.stretcherY, 0.265), sT = num(P.stretcherT, 0.05), sW = 0.028;
  const zA = zRL + num(P.spineBack, 0.24), zB = Math.max(zA + 0.02, zFL - num(P.spineFront, 0.26));
  addRail(g, frame, 'frame', [0, yS, zA - 0.01], [0, yS, zB + 0.01], sW, sT);
  const posts = [];
  for (const sx of [-1, 1]) {
    const f = onLeg(legs[0], yS - 0.005), b = onLeg(legs[1], yS - 0.01);
    addRail(g, frame, 'frame', [0, yS, zB], [sx * f[0], f[1], f[2]], sW, sT);
    addRail(g, frame, 'frame', [0, yS, zA], [sx * b[0], b[1], b[2]], sW, sT);
    posts.push([sx * f[0] * 0.55, lerp(zB, f[2], 0.55)], [sx * b[0] * 0.4, lerp(zA, b[2], 0.4)]);
  }
  // seat pad: a thin oval cushion, tilted back, floating on four brass posts
  const tilt = num(P.seatTilt, 4) * DEG;
  const pT = num(P.seatPadT, 0.08);
  const sw = num(P.seatW, 0.52) / 2;
  const sz0 = zr + num(P.seatBack, 0.25), sz1 = zf - 0.005, zp = sz1 - 0.1;
  const yBot = seatH + 0.012 - pT;
  const out = rrOutline(-sw, sw, sz0 - zp, sz1 - zp, num(P.seatRBack, 0.18), num(P.seatRFront, 0.2), 8, 4);
  const sTaper = num(P.seatTaper, 0.84);
  for (const p of out) p[0] *= lerp(sTaper, 1, sstep(sz0 - zp, sz1 - zp - 0.12, p[1]));
  const sg = new THREE.Group();
  sg.position.set(0, yBot, zp);
  sg.rotation.x = -tilt;
  g.add(sg);
  sg.add(K.partMesh(slabGeometry(out, { y0: 0, y1: pT, rTop: pT * 0.45, rBot: pT * 0.42, dome: 0.008, belly: 0.004, nEdge: 4, nCap: 4 }), ms.up, 'upholstery'));
  for (const [px, pz] of posts) {
    const yTop = yBot + (pz - zp) * Math.sin(tilt);
    const y0 = yS + sT / 2 - 0.004;
    if (yTop - y0 > 0.005) g.add(K.partMesh(K.cylinder(0.008, 0.008, yTop - y0 + 0.006, { seg: 10 }), brass, null, { position: [px, y0, pz] }));
  }
  // back pad: a reclined, rounded (tombstone) plate fixed to the hoop with brass standoffs
  const rec = num(P.backRecline, 34) * DEG;
  const bt = num(P.backPadT, 0.065), bw = num(P.backW, 0.42) / 2;
  const yB0 = num(P.backBottom, 0.335);
  const bh = (h - yB0 - (bt / 2) * Math.sin(rec)) / Math.cos(rec) - 0.004;
  const zB0 = zr + num(P.backTopInset, 0.006) + bh * Math.sin(rec) + (bt / 2) * Math.cos(rec);
  const bo = rrOutline(-bw, bw, 0, bh, num(P.backRBottom, 0.11), num(P.backRTop, 0.15), 8, 4);
  const taper = num(P.backTaper, 0.86);
  for (const p of bo) p[0] *= lerp(taper, 1, sstep(0, bh * 0.6, p[1]));
  const bgeo = slabGeometry(bo, { y0: -bt / 2, y1: bt / 2, rTop: bt * 0.46, rBot: bt * 0.46, belly: 0.003, nEdge: 4, nCap: 4 });
  bgeo.rotateX(-Math.PI / 2);
  const bg = new THREE.Group();
  bg.position.set(0, yB0, zB0);
  bg.rotation.x = -rec;
  g.add(bg);
  bg.add(K.partMesh(bgeo, ms.up, 'upholstery'));
  // standoffs: from the plate's rear face back to the hoop
  const vH = (yH - yB0) / Math.cos(rec);
  const zRearAtH = zB0 - vH * Math.sin(rec) - (bt / 2) * Math.cos(rec);
  const sox = num(P.standoffX, 0.12);
  const xbk = Math.max(0.01, xs - rc);
  const zHoop = sox <= xbk ? zb - num(P.hoopBow, 0.015) * (1 - (sox / xbk) ** 2) : zb + rc - Math.sqrt(Math.max(0, rc * rc - (sox - xbk) ** 2));
  if (zRearAtH - zHoop > 0.01) {
    for (const sx of [-1, 1]) {
      const m = K.partMesh(K.cylinder(0.009, 0.009, zRearAtH - zHoop + 0.01, { seg: 10 }), brass, null, { position: [sx * sox, yH, zHoop - 0.005], rotation: [Math.PI / 2, 0, 0] });
      g.add(m);
      // the bolt's round brass head on the back of the hoop
      g.add(K.partMesh(K.cylinder(0.011, 0.011, 0.006, { seg: 12 }), brass, null, { position: [sx * sox, yH, zHoop - rr - 0.004], rotation: [Math.PI / 2, 0, 0] }));
    }
  }
  return K.finishModel(g, { seatY: seatH });
}

/** IKEA POÄNG: cantilevered laminated bands (floor runner → front post → arm), an S-shaped seat/back band, one long cushion. */
function loungeCantilever({ g, ms, q, w, d, h, P, frame, seatH, armH }) {
  const zr = -d / 2, zf = d / 2;
  const frameV = ms.frame({ grain: 'v' });
  const bw = num(P.bandW, 0.05), bt = num(P.bandT, 0.024);
  const xb = w / 2 - bw / 2;
  // seat/back band (inside the arm bands): from the front post at seat height, sagging back, then up the reclined back
  const bw2 = num(P.backBandW, 0.045), bt2 = num(P.backBandT, 0.02);
  const x2 = xb - bw / 2 - bw2 / 2 - 0.002;
  const zFront = zf - num(P.frontInset, 0.03);
  const ySF = seatH - num(P.seatFrontDrop, 0.075);
  const sb = num(P.seatSag, 0.09);
  const zSR = zr + num(P.seatRear, 0.3);
  const back = filletPath([
    [zFront - bt - 0.004, ySF],
    [zSR, ySF - sb],
    [zr + num(P.lumbarZ, 0.19), num(P.lumbarY, 0.56)],
    [zr + num(P.topZ, 0.025), h - bt2 / 2 - 0.004],
  ], [num(P.seatBend, 0.13), num(P.backBend, 0.35)], 0.015);
  // the arm meets the back band at its rear end
  const yArmR = armH - bt / 2, yArmF = yArmR - num(P.armRise, 0.045);
  let zArmR = zr + 0.2;
  for (let i = 1; i < back.length; i++) {
    const [z0, y0] = back[i - 1], [z1, y1] = back[i];
    if (y1 > y0 && y0 <= yArmR && y1 >= yArmR) zArmR = lerp(z0, z1, (yArmR - y0) / (y1 - y0 || 1e-9));
  }
  // armTail: the arm runs on past the back band (bolted to it) and ends square
  const armEnd = [zArmR - 0.01, yArmR];
  const tail = num(P.armTail, 0);
  if (tail > 0) {
    const az = armEnd[0] - (zFront - num(P.postLean, 0.02)), ay = armEnd[1] - yArmF, al = Math.hypot(az, ay) || 1;
    armEnd[0] += (az / al) * tail;
    armEnd[1] += (ay / al) * tail;
  }
  const base = filletPath([
    [zr + num(P.runnerBack, 0.13), bt / 2],
    [zFront, bt / 2],
    [zFront - num(P.postLean, 0.02), yArmF],
    armEnd,
  ], [num(P.footBend, 0.085), num(P.armBend, 0.075)], 0.015);
  for (const sx of [-1, 1]) {
    g.add(K.partMesh(profileBeam(base, sx * xb, bw, bt, { r: 0.35, capLen: 0.3 }), frameV, 'frame'));
    g.add(K.partMesh(profileBeam(back, sx * x2, bw2, bt2, { r: 0.35, capLen: 0.3 }), frameV, 'frame'));
  }
  // cross bars: under the seat front, between the runner ends, and the back ladder (behind the cushion)
  const yFr = ySF - 0.06;
  addRail(g, frame, 'frame', [-xb + bw / 2, yFr, zFront - bt * 1.5], [xb - bw / 2, yFr, zFront - bt * 1.5], 0.018, 0.065);
  addRail(g, frame, 'frame', [-xb, 0.012, zr + num(P.runnerBack, 0.13) + 0.035], [xb, 0.012, zr + num(P.runnerBack, 0.13) + 0.035], 0.05, 0.016);
  const bc = [0];
  for (let i = 1; i < back.length; i++) bc.push(bc[i - 1] + Math.hypot(back[i][0] - back[i - 1][0], back[i][1] - back[i - 1][1]));
  const BL = bc[bc.length - 1];
  const onBack = (s) => {
    let j = 1;
    while (j < back.length - 1 && bc[j] < s) j++;
    const f = clamp((s - bc[j - 1]) / (bc[j] - bc[j - 1] || 1e-9), 0, 1);
    return [lerp(back[j - 1][0], back[j][0], f), lerp(back[j - 1][1], back[j][1], f)];
  };
  // ladder slats lying in the back plane, flush with the bands' rear face
  for (const u of [0.5, 0.63, 0.76, 0.88, 0.975]) {
    const [z, y] = onBack(BL * u), [za, ya] = onBack(BL * u - 0.01), [zb, yb] = onBack(BL * u + 0.01);
    const ang = Math.atan2(zb - za, yb - ya);
    const sh = u > 0.97 ? 0.055 : 0.045;
    g.add(K.partMesh(K.roundedBox(2 * x2 + bw2 * 0.6, sh, 0.014, 0.004, 1, { grain: 'x' }), frame, 'frame', { position: [0, y + Math.sin(ang) * 0.004, z - Math.cos(ang) * 0.004], rotation: [ang, 0, 0] }));
  }
  // one long cushion on the seat/back band: seat, back and a separate head pad; channels / tufts / plain per cover
  let support = offsetPath(back, bt2 / 2 + 0.002);
  // cushionTopCut: the cushion (with its rounded head end) stops that much short of the band's top, flush with the top bar
  const topCut = clamp(num(P.cushionTopCut, 0), 0, 0.2);
  if (topCut > 0) {
    const cs = [0];
    for (let i = 1; i < support.length; i++) cs.push(cs[i - 1] + Math.hypot(support[i][0] - support[i - 1][0], support[i][1] - support[i - 1][1]));
    const Ls = cs[cs.length - 1] - topCut;
    const cutPath = [support[0]];
    for (let i = 1; i < support.length; i++) {
      if (cs[i] < Ls) cutPath.push(support[i]);
      else {
        const f = (Ls - cs[i - 1]) / (cs[i] - cs[i - 1] || 1e-9);
        cutPath.push([lerp(support[i - 1][0], support[i][0], f), lerp(support[i - 1][1], support[i][1], f)]);
        break;
      }
    }
    support = cutPath;
  }
  const pad = num(P.cushionT, 0.075);
  const headL = num(P.headL, 0.2);
  const quilt = P.quilt || 'plain';
  const sHead = BL - topCut - headL;
  const sSeatEnd = Math.hypot(back[0][0] - zSR, back[0][1] - (ySF - sb));
  const at = [sHead - 0.008, sHead, sHead + 0.008];
  let grooveU = () => 0, grooveX = () => 0, xs = [];
  const nxs = 12;
  for (let i = 0; i <= nxs; i++) xs.push(-1 + (2 * i) / nxs);
  if (quilt === 'channels') {
    const s0 = sSeatEnd + num(P.channelFrom, 0.04), s1 = sHead - 0.035, n = Math.max(3, Math.round((s1 - s0) / num(P.channelStep, 0.03)));
    const cs = [];
    for (let k = 0; k <= n; k++) cs.push(lerp(s0, s1, k / n));
    for (const c of cs) at.push(c - 0.006, c, c + 0.006);
    grooveU = (s) => cs.reduce((m, c) => Math.max(m, bump(s, c, 0.005)), 0) * 0.012;
  } else if (quilt === 'tufted') {
    const cs = [];
    for (let s = sSeatEnd - 0.24; s < sHead - 0.05; s += 0.12) cs.push(s);
    for (const c of cs) at.push(c - 0.012, c, c + 0.012);
    grooveU = (s) => cs.reduce((m, c) => Math.max(m, bump(s, c, 0.012)), 0) * 0.018;
    const xg = 0.34;
    xs = [...new Set([...xs, -xg - 0.06, -xg, -xg + 0.06, xg - 0.06, xg, xg + 0.06].map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    grooveX = (xf) => Math.max(bump(xf, -xg, 0.035), bump(xf, xg, 0.035)) * 0.016;
  }
  const hwC = num(P.cushionW, 0.54) / 2;
  const SL = BL - topCut;
  const crease = num(P.headCrease, 0.03);
  const thick = (u, x) => {
    const s = u * SL;
    let T = s < sSeatEnd ? pad : lerp(pad, pad * 0.85, sstep(sSeatEnd, sSeatEnd + 0.2, s));
    T += (num(P.headT, 0.095) - T) * sstep(sHead - 0.005, sHead + 0.03, s);
    T -= crease * bump(s, sHead, 0.007);
    if (s < sHead - 0.02) T -= grooveU(s) + grooveX(x / Math.max(0.05, hwC - 0.03)) * (quilt === 'tufted' && s > sSeatEnd - 0.3 ? 1 : 0);
    return T;
  };
  const cgeo = padGeometry(support, { thick, hw: hwC, xs, re: 0.035, step: 0.03, at, nc: 3, nEnd: 4, endLen: 0.9 });
  g.add(K.partMesh(cgeo, ms.up, 'upholstery'));
  return K.finishModel(g, { seatY: seatH });
}

const LOUNGE_FRAMES = { roll: loungeRoll, sled: loungeSled, raked: loungeRaked, hoop: loungeHoop, cantilever: loungeCantilever };

/**
 * Bentwood rocking chair (Brunstad Delta): flat runners, one bow per side from the runner up the front leg into the
 * arm, a bowed rear post and a rising seat rail, a thick seat-and-back pad (sheepskin over fabric when the cover is
 * teddy) with a centre seam and flared «ears», and a strap-hung neck pillow.
 */
function buildRockingBentwood(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params, C = spec.colors, M = spec.materials;
  const q = qf(spec);
  const ms = materials(spec, 'wood-taper');
  const g = new THREE.Group();
  const frameV = ms.frame({ grain: 'v' }), legsV = ms.legs({ grain: 'v' }), frame = ms.frame();
  const upKind = M.upholstery || 'woven';
  const pile = Math.max(0, num(P.pile, upKind === 'teddy' ? 0.02 : 0));
  const up = pile ? mat(upKind, C.upholstery, { scale: 4 }) : ms.up;
  const shellM = pile ? mat('wool', C.upholstery) : ms.up;
  const pillowM = pile ? mat('leather', C.upholstery) : ms.up;
  const seatH = clamp(num(P.seatH, 0.44), 0.3, h - 0.3);
  const armH = clamp(num(P.armH, 0.54), seatH + 0.05, h - 0.2);
  const zf = d / 2;
  // profile coordinates are measured on the store's side photo (d 0.9, arm top 0.54, seat front 0.44): v = metres
  // behind the seat front, y = height
  const Z = (v) => zf + v * (d / 0.9);
  const Ya = (y) => y * (armH / 0.54);
  const Ys = (y) => y * (seatH / 0.44);
  const xr = w / 2 - num(P.bowW, 0.045) / 2;
  // runners: shallow arcs, ends curling up a little
  const rt = 0.022, zc = Z(-0.4), half = 0.39 * (d / 0.9);
  const Rr = num(P.runnerR, 1.3);
  const runY = (z) => {
    const e = clamp(Math.abs(z - zc), 0, Rr * 0.9);
    return rt / 2 + Rr - Math.sqrt(Rr * Rr - e * e) + 1.2 * Math.max(0, e - half * 0.75) ** 2;
  };
  const run = [];
  for (let k = 0; k <= 24; k++) {
    const z = zc - half + (2 * half * k) / 24;
    run.push([z, runY(z)]);
  }
  const bow = splinePath([[-0.075, 0.03], [-0.08, 0.12], [-0.095, 0.22], [-0.12, 0.31], [-0.16, 0.39], [-0.22, 0.45], [-0.3, 0.5], [-0.39, 0.523], [-0.48, 0.525], [-0.71, 0.525]].map(([v, y]) => [Z(v), Ya(y)]), 40);
  bow[0][1] = runY(bow[0][0]) + 0.01;
  const post = splinePath([[-0.635, 0.03], [-0.6, 0.14], [-0.58, 0.26], [-0.595, 0.38], [-0.63, 0.5]].map(([v, y]) => [Z(v), Ya(y)]), 16);
  post[0][1] = runY(post[0][0]) + 0.01;
  const rail = splinePath([[-0.6, 0.13], [-0.55, 0.19], [-0.47, 0.245], [-0.33, 0.29], [-0.2, 0.325], [-0.135, 0.345]].map(([v, y]) => [Z(v), Ys(y)]), 18);
  for (const sx of [-1, 1]) {
    g.add(K.partMesh(profileBeam(run, sx * xr, 0.036, rt, { r: 0.45, capLen: 0.5 }), frameV, 'frame'));
    g.add(K.partMesh(profileBeam(bow, sx * xr, num(P.bowW, 0.045), 0.03, { r: 0.4, capLen: 0.35 }), frameV, 'frame'));
    g.add(K.partMesh(profileBeam(post, sx * (xr - 0.004), 0.04, 0.03, { r: 0.4, capLen: 0.2 }), legsV, 'legs'));
    g.add(K.partMesh(profileBeam(rail, sx * (xr - 0.006), 0.034, 0.028, { r: 0.4, capLen: 0.2 }), legsV, 'legs'));
  }
  // cross bars: a wide one under the seat, one between the rear posts
  addRail(g, frame, 'frame', [-xr, Ys(0.282), Z(-0.36)], [xr, Ys(0.282), Z(-0.36)], 0.024, 0.045, 0.006);
  addRail(g, frame, 'frame', [-xr, Ya(0.2), Z(-0.59)], [xr, Ya(0.2), Z(-0.59)], 0.024, 0.05, 0.006);
  // seat-and-back pad: support = its underside / rear face, seat front → top of the back
  const topY = h;
  const support = splinePath([[-0.025, 0.335], [-0.2, 0.31], [-0.4, 0.285], [-0.53, 0.285], [-0.6, 0.33], [-0.64, 0.45], [-0.69, 0.62], [-0.745, 0.8], [-0.785, 0.93]].map(([v, y]) => [Z(v), y <= 0.4 ? Ys(y) : lerp(Ys(y), y * ((topY - 0.05) / 0.93), sstep(0.4, 0.93, y))]), 60);
  const sc = [0];
  for (let i = 1; i < support.length; i++) sc.push(sc[i - 1] + Math.hypot(support[i][0] - support[i - 1][0], support[i][1] - support[i - 1][1]));
  const SL = sc[sc.length - 1];
  let sBend = 0;
  for (let i = 0; i < support.length; i++) if (support[i][1] < support[Math.max(0, i - 1)][1] + 1e-4 || i < 3) sBend = sc[i];
  const backness = (s) => sstep(sBend + 0.02, sBend + 0.15, s);
  const T0 = num(P.seatPadT, 0.105);
  const thickBase = (s) => {
    let T = T0;
    T += 0.03 * backness(s) * bump(s, sBend + 0.24, 0.13);
    T -= 0.005 * backness(s) * sstep(SL * 0.7, SL, s);
    return T;
  };
  const seamX = (x) => 0.016 * bump(x, 0, 0.012);
  const hwF = (u) => {
    const s = u * SL;
    return lerp(0.265, 0.235, backness(s)) + num(P.ears, 0.03) * sstep(SL - 0.28, SL - 0.02, s);
  };
  const xs = [];
  const nx = Math.max(10, Math.round(18 * Math.min(q, 1.25)));
  for (let i = 0; i <= nx; i++) xs.push(-1 + (2 * i) / nx);
  xs.push(-0.04, 0.04);
  xs.sort((a, b) => a - b);
  const step = pile ? 0.025 / Math.min(q, 1.25) : 0.035;
  const fuzzy = [];
  if (pile) {
    // fabric shell, the sheepskin cover over its front half
    g.add(K.partMesh(padGeometry(support, { thick: (u) => thickBase(u * SL), hw: (u) => hwF(u) - 0.006, xs: xs.filter((_, i) => i % 2 === 0 || i === xs.length - 1), re: 0.04, step: 0.04, nc: 3, nEnd: 3 }), shellM, 'upholstery'));
    const cover = offsetPath(support, (u) => thickBase(u * SL) * 0.42);
    const cs = [0];
    for (let i = 1; i < cover.length; i++) cs.push(cs[i - 1] + Math.hypot(cover[i][0] - cover[i - 1][0], cover[i][1] - cover[i - 1][1]));
    const CL = cs[cs.length - 1];
    const m = K.partMesh(padGeometry(cover, { thick: (u, x) => thickBase(u * CL) * 0.58 + 0.012 - seamX(x) * backness(u * CL), hw: hwF, xs, re: 0.045, step, nc: 3, nEnd: 4 }), up, 'upholstery');
    g.add(m);
    fuzzy.push(m);
  } else {
    g.add(K.partMesh(padGeometry(support, { thick: (u, x) => thickBase(u * SL) - seamX(x) * backness(u * SL), hw: hwF, xs, re: 0.045, step, nc: 3, nEnd: 4 }), up, 'upholstery'));
  }
  // neck pillow hanging on a strap over the top of the back
  const sP = SL - num(P.pillowDrop, 0.16);
  const i0 = sc.findIndex((s) => s >= sP);
  const pa = support[Math.max(1, i0) - 1], pb = support[Math.min(support.length - 1, Math.max(1, i0) + 1)];
  const ang = Math.atan2(pb[0] - pa[0], pb[1] - pa[1]);
  const Tp = thickBase(sP) + (pile ? 0.012 : 0);
  const pt = 0.065, ph = 0.14;
  const pc = support[Math.max(0, i0)];
  const nz = Math.cos(ang), ny = -Math.sin(ang);
  const pgeo = softBox(num(P.pillowW, 0.3), ph, pt, 'z', { puff: 0.22, round: 0.85, sides: 0.3, pinch: 0.25, q });
  g.add(K.partMesh(pgeo, pillowM, 'upholstery', { position: [0, pc[1] + ny * (Tp + pt / 2), pc[0] + nz * (Tp + pt / 2)], rotation: [ang, 0, 0] }));
  const top = support[support.length - 1];
  const Tt = thickBase(SL) + (pile ? 0.012 : 0);
  const tz = support[support.length - 1][0] - support[support.length - 3][0], ty = support[support.length - 1][1] - support[support.length - 3][1];
  const tl = Math.hypot(tz, ty) || 1;
  const strap = [
    [pc[0] + nz * (Tp + 0.01) + Math.sin(ang) * ph * 0.3, pc[1] + ny * (Tp + 0.01) + Math.cos(ang) * ph * 0.3],
    [top[0] + (ty / tl) * (Tt + 0.004), top[1] - (tz / tl) * (Tt + 0.004)],
    [top[0] + (ty / tl) * (Tt / 2) + (tz / tl) * (Tt / 2 + 0.006), top[1] - (tz / tl) * (Tt / 2) + (ty / tl) * (Tt / 2 + 0.006)],
    [top[0] - (ty / tl) * 0.004, top[1] + (tz / tl) * 0.004],
    [top[0] - (ty / tl) * 0.006 - (tz / tl) * 0.2, top[1] + (tz / tl) * 0.006 - (ty / tl) * 0.2],
  ];
  g.add(K.partMesh(profileBeam(splinePath(strap, 16), 0, 0.035, 0.004, { r: 0.5, capLen: 0.3 }), pillowM, 'upholstery'));
  if (pile) {
    let s = 5;
    for (const m of fuzzy) fluff(m.geometry, pile * 0.85, s++);
  }
  // recolouring in place for the wood; the cover layers (sheepskin / fabric / leather) rebuild
  const recolor = (part, hex, kind) => {
    if (part === 'upholstery') return false;
    const meshes = g.userData.model?.parts?.[part];
    if (!meshes?.length) return true;
    for (const mm of meshes) if (!mm.material?.userData?.cached) return false;
    for (const mm of meshes) {
      const ud = mm.material.userData;
      mm.material = mat(kind || ud.kind, hex || ud.hex, ud.opts);
    }
    return true;
  };
  return K.finishModel(g, { seatY: seatH, recolor });
}

function buildRocking(spec) {
  if (spec.params.frameStyle === 'bentwood') return buildRockingBentwood(spec);
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
  wood: 'Treben',
  pedestal: 'Trompetfot (dreibar)',
  sled: 'Medeben',
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
function def(id, defaults, build, { params = {}, dimsRange, parts, paramPatch } = {}) {
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
    // paramPatch(item, key, value) → { dims?, params? } | null: what else changes when the user sets a param
    ...(paramPatch ? { paramPatch } : {}),
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
    params: {
      seatH: SEAT,
      armH: ARMH,
      armW: ARMW,
      body: { type: 'enum', label: 'Utforming', options: [['classic', 'Klassisk på ben'], ['shell', 'Formstøpt skall (eggform)']], default: 'classic' },
      armStyle: { type: 'enum', label: 'Armlener', options: [['slim', 'Smale, runde'], ['tulip', 'Tulipan (smal nede, rund topp)'], ['scroll', 'Engelsk rullearm']], default: 'slim' },
      legStyle: legParam(['wood-taper', 'swivel-star', 'swivel-disc', 'block']),
      legH: LEGH,
      cushion: CUSHION,
      buttons: { type: 'bool', label: 'Knapper i ryggen' },
      footstool: FOOT,
    },
    dimsRange: { w: [0.65, 1.0], d: [0.7, 1.05], h: [0.85, 1.2] },
  }),
  'lounge-wood': def('lounge-wood', { dims: { w: 0.78, d: 0.68, h: 0.71 }, params: { seatH: 0.43, armH: 0.6, armW: 0.06, legH: 0.22, backShape: 'curved', cushion: 'loose' }, colors: { upholstery: '#cbbfae', legs: '#5a4232', frame: '#5a4232' }, materials: { upholstery: 'linen', legs: 'oak', frame: 'oak' } }, buildLoungeWood, {
    params: {
      seatH: SEAT,
      armH: ARMH,
      armW: { ...ARMW, label: 'Armlenebredde (m) – bred = polstret rygg rundt' },
      legH: LEGH,
      cushion: CUSHION,
      frameStyle: { type: 'enum', label: 'Ramme', options: [['classic', 'Klassisk (åpen ramme / polstret rygg)'], ['roll', 'Pølserygg på fire ben'], ['sled', 'Armlene bøyd opp i ryggen'], ['raked', 'Skrå bakben og polstret ryggpanel'], ['hoop', 'Rund armbue rundt ryggen'], ['cantilever', 'Frittbærende bøyd finér']], default: 'classic' },
    },
    dimsRange: { w: [0.6, 1.0], d: [0.6, 1.0], h: [0.62, 1.0] },
  }),
  'club-box': def('club-box', { dims: { w: 0.84, d: 0.89, h: 0.82 }, params: { seatH: 0.44, armW: 0.16, armH: 0.62, legStyle: 'wood-taper', legH: 0.1, backShape: 'square', cushion: 'loose' }, ...fabric('#8b4e2b', 'leather', '#1f1f1f', 'black-metal') }, buildClubBox, {
    params: {
      seatH: SEAT,
      armW: ARMW,
      armH: ARMH,
      legStyle: legParam(['wood-taper', 'block', 'none', 'swivel-disc', 'swivel-star']),
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
    params: { seatH: SEAT, armH: ARMH, frameStyle: { type: 'enum', label: 'Ramme', options: [['classic', 'Klassisk (rette ben)'], ['bentwood', 'Bøyde armbuer og høy polstret rygg']], default: 'classic' } },
    dimsRange: { w: [0.55, 0.9], d: [0.7, 1.1], h: [0.8, 1.15] },
  }),
  'dining-chair': def('dining-chair', { dims: { w: 0.52, d: 0.58, h: 0.88 }, params: { seatH: 0.47, shell: 'shell', legStyle: 'slim-metal', legD: 0.02 }, ...fabric('#d2cbc2', 'boucle', '#1a1a1a', 'black-metal') }, buildDiningChair, {
    params: { seatH: { ...SEAT, min: 0.4, max: 0.55 }, legStyle: legParam(['slim-metal', 'wood-taper', 'block', 'swivel-disc', 'swivel-star']) },
    dimsRange: { w: [0.42, 0.65], d: [0.48, 0.68], h: [0.75, 1.0] },
  }),
  'bar-stool': def('bar-stool', { dims: { w: 0.45, d: 0.48, h: 0.97 }, params: { seatH: 0.65, back: 'shell', legStyle: 'slim-metal', footrest: true, quilt: true }, ...fabric('#4a5646', 'velvet', '#1a1a1a', 'black-metal') }, buildBarStool, {
    params: {
      seatH: { ...SEAT, min: 0.55, max: 0.82, label: 'Setehøyde (m) – 0,65 benk / 0,75 bar' },
      back: { type: 'enum', label: 'Rygg', options: [['shell', 'Skallrygg'], ['pad', 'Ryggpute på rør'], ['upholstered', 'Rett polstret rygg'], ['none', 'Uten rygg']] },
      legStyle: legParam(['slim-metal', 'wood', 'pedestal', 'sled']),
      arms: { type: 'bool', label: 'Armlener' },
      footrest: { type: 'bool', label: 'Fotstøtte' },
      quilt: { type: 'bool', label: 'Stikninger i ryggen' },
    },
    dimsRange: { w: [0.38, 0.55], d: [0.4, 0.56], h: [...BAR_STOOL_H] },
    paramPatch: barStoolParamPatch,
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
      openEnd: { type: 'enum', label: 'Endeavslutning', options: [['none', 'Ingen'], ['-x', 'Venstre (sett forfra)'], ['+x', 'Høyre (sett forfra)']], default: 'none' },
      openEndW: { type: 'number', min: 0.5, max: 1.2, step: 0.01, label: 'Bredde endeavslutning (m)', default: 0.8 },
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
      piping: { ...PIPE, default: true },
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
    dimsRange: { w: [1.4, 3.2], d: [0.8, 1.15], h: [0.6, 1.0] },
  }),
};
