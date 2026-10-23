import * as THREE from 'three';
import { paint, mat } from './materials.js';
import { facadeFinish } from '../world/surfaces.js';
import { planeY, splitTriangles } from './roofgeom.js';

/**
 * CHIMNEY – the chimneys of the house format (notes/tak.md «Piper»; the model is home/chimneygeom.js, read by layout.js
 * into layout.house.chimneys). Built by rooms.js after the roofs:
 *   • inside the house a box per level (a pipe for steel) from the floor up to the next floor, the last up to the
 *     roof's inner plane – in that level's root, seen in the dollhouse like a wall, with a Box3 collider each;
 *   • from the roof's inner plane up the chimney seen outside (brick and render: surfaces.js facadeFinish; steel: a
 *     painted pipe), a crown with a flue liner on masonry, a rain cap on steel, and the flashing where it goes through
 *     the covering (a band round it and an apron on the roof; a collar round a pipe) – hidden with the ceilings and
 *     the roofs (pickables.ceilings), no collision. The roof builder stops its ridge caps at a chimney.
 *
 *   buildChimneys(H, opts) → { meshes (outside), inside (meshes), colliders: Box3[] }
 *
 * opts: { roots (ctx.roots.levels), fallback (Group), keep, quality }
 */

const CROWN = 0.06; // the concrete crown on a masonry chimney
const LINER = 0.1; // the flue liner over it
const BAND = 0.15; // the flashing band up the sides, over the covering
const PROUD = 0.008; // … standing off the chimney
const APRON = 0.1; // the apron on the covering round it

class Acc {
  constructor() {
    this.pos = [];
    this.uv = [];
  }
  tri(a, b, c, ua, ub, uc) {
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
  }
  quad(a, b, c, d, ua, ub, uc, ud) {
    this.tri(a, b, c, ua, ub, uc);
    this.tri(a, c, d, ua, uc, ud);
  }
  build(material, name, keep) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    keep(g);
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.noCollide = true;
    return m;
  }
}

/**
 * Vertical faces round a closed ring in plan (facing away from `c`), between bottom(q, i) and top(q, i) at each end of
 * each edge; `split(a, b)` cuts an edge into pieces ([[a, b], …]), i is the piece's index along the ring. UVs: metres
 * round the ring and up.
 */
function ringFaces(acc, ring, c, split, bottom, top) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    for (const [a, b] of split(ring[i], ring[(i + 1) % ring.length])) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const ya0 = bottom(a, m), yb0 = bottom(b, m), ya1 = top(a, m), yb1 = top(b, m);
      if (ya1 - ya0 < 1e-5 && yb1 - yb0 < 1e-5) {
        s += L;
        continue;
      }
      // (b − a) × up faces left of a → b; flip to face away from the middle
      const out = (b[1] - a[1]) * (m[0] - c[0]) - (b[0] - a[0]) * (m[1] - c[1]) < 0;
      const [p, q, p0, q0, p1, q1, sp, sq] = out ? [a, b, ya0, yb0, ya1, yb1, s, s + L] : [b, a, yb0, ya0, yb1, ya1, s + L, s];
      acc.quad([p[0], p0, p[1]], [q[0], q0, q[1]], [q[0], q1, q[1]], [p[0], p1, p[1]], [sp, p0], [sq, q0], [sq, q1], [sp, p1]);
      s += L;
    }
  }
}

/** The parameters (0…1 on a → b) where the segment crosses the lines. */
function lineCuts(a, b, lines) {
  const ts = [];
  for (const l of lines) {
    const fa = l.a * a[0] + l.b * a[1] + l.c, fb = l.a * b[0] + l.b * b[1] + l.c;
    if ((fa < -1e-9 && fb > 1e-9) || (fa > 1e-9 && fb < -1e-9)) ts.push(fa / (fa - fb));
  }
  return ts.sort((x, y) => x - y);
}

/** Six faces of an axis-aligned box (outward). */
function boxFaces(acc, x0, y0, z0, x1, y1, z1) {
  const P = (x, y, z) => [x, y, z];
  // −z, +z, −x, +x, +y, −y
  acc.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [x1, y0], [x0, y0], [x0, y1], [x1, y1]);
  acc.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [x0, y0], [x1, y0], [x1, y1], [x0, y1]);
  acc.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [z0, y0], [z1, y0], [z1, y1], [z0, y1]);
  acc.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [z1, y0], [z0, y0], [z0, y1], [z1, y1]);
  acc.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [x0, z1], [x1, z1], [x1, z0], [x0, z0]);
  acc.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
}

/**
 * Builds the chimneys of layout.house (see the top of this file).
 * @param {object} H  layout.house
 * @param {object} opts
 */
export function buildChimneys(H, opts) {
  const { keep, quality = {} } = opts;
  const res = quality.level === 'low' ? 0.5 : 1;
  const meshes = [];
  const inside = [];
  const colliders = [];
  const list = H.chimneys || [];
  if (!list.length) return { meshes, inside, colliders };
  const parentOf = (levelId) => opts.roots?.[levelId] ?? opts.fallback;
  const finish = (kind, hex) => {
    if (kind === 'steel') return mat('painted', hex, { roughness: 0.45, metalness: 0.35 });
    try {
      return facadeFinish(kind, hex, { res });
    } catch {
      return mat('painted', hex, { roughness: 0.9 }); // no texture support (Node)
    }
  };
  const put = (m, levelId, into) => {
    if (!m) return;
    parentOf(levelId)?.add(m);
    into.push(m);
  };

  for (const ch of list) {
    const field = ch.roofLevelId ? H.roofFieldOf?.(ch.roofLevelId) : null;
    const [cx, cz] = ch.at;
    const [w, d] = ch.size;
    const r = w / 2;
    const n = 20;
    const ring = ch.round ? Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cz + r * Math.sin((2 * Math.PI * i) / n)]) : ch.footprint;
    // a face of the masonry is cut where the roof folds (a chimney on the ridge); a pipe's narrow faces are not
    const split = (a, b) => {
      if (ch.round || !field) return [[a, b]];
      const ts = [0, ...lineCuts(a, b, field.lines), 1];
      const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      return ts.slice(1).map((t, i) => [at(ts[i]), at(t)]);
    };
    /** the roof's plane at a point (its middle m picks the plane of the piece), inner or + its build-up */
    const planeAtMid = (m) => field?.planeAt(m[0], m[1]) ?? null;
    const innerAt = (q, m) => {
      const p = planeAtMid(m);
      return p ? planeY(p, q[0], q[1]) : ch.innerMin ?? ch.bottomY;
    };
    const coverAt = (q, m) => {
      const p = planeAtMid(m);
      return p ? planeY(p, q[0], q[1]) + (p.tv ?? 0) : ch.coverMax ?? ch.bottomY;
    };
    const masonry = !ch.round;
    const bodyTop = masonry ? ch.topY - CROWN : ch.topY;

    // ---- inside: a piece per level (up to the next floor, the last up to the roof's inner plane), one collider each
    for (const pc of ch.pieces) {
      const acc = new Acc();
      ringFaces(acc, ring, ch.at, split, () => pc.y0, (q, m) => (pc.y1 ?? innerAt(q, m)));
      const kind = ch.round ? 'steel' : null;
      const m = acc.build(kind ? finish('steel', ch.insideColor) : paint(ch.insideColor, { roughness: 0.9 }), `chimney-inside:${ch.id}:${pc.levelId}`, keep);
      put(m, pc.levelId, inside);
      const y1 = pc.y1 ?? ch.innerMax ?? bodyTop;
      colliders.push(new THREE.Box3(new THREE.Vector3(cx - w / 2, pc.y0, cz - d / 2), new THREE.Vector3(cx + w / 2, y1, cz + d / 2)));
    }

    // ---- outside: from the roof's inner plane (or the ground, a chimney standing free) up to the top
    const fromRoof = ch.from === 'roof' || ch.pieces.length > 0 || !!ch.inHouse;
    const out = new Acc();
    ringFaces(out, ring, ch.at, split, (q, m) => (fromRoof && field ? innerAt(q, m) : ch.bottomY), () => bodyTop);
    const lv = ch.outsideLevelId;
    put(out.build(finish(ch.material, ch.color), `chimney:${ch.id}`, keep), lv, meshes);
    const caps = new Acc();
    const dark = new Acc();
    if (masonry) {
      // the crown (4 cm over the sides) and a flue liner in it
      boxFaces(caps, cx - w / 2 - 0.04, bodyTop, cz - d / 2 - 0.04, cx + w / 2 + 0.04, ch.topY, cz + d / 2 + 0.04);
      const fl = Math.min(0.22, Math.min(w, d) * 0.5) / 2;
      boxFaces(dark, cx - fl, ch.topY, cz - fl, cx + fl, ch.topY + LINER, cz + fl);
    } else {
      // the pipe's open top (dark, 3 cm down in it), a rain cap on three legs over it, a joint band 0.3 under the top
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n, b = (2 * Math.PI * (i + 1)) / n;
        dark.tri([cx, bodyTop - 0.03, cz], [cx + r * Math.cos(b), bodyTop - 0.03, cz + r * Math.sin(b)], [cx + r * Math.cos(a), bodyTop - 0.03, cz + r * Math.sin(a)], [0, 0], [r, 0], [0, r]);
      }
      const R = r * 1.7, h0 = bodyTop + 0.06, h1 = h0 + 0.07;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n, b = (2 * Math.PI * (i + 1)) / n;
        const pa = [cx + R * Math.cos(a), h0, cz + R * Math.sin(a)], pb = [cx + R * Math.cos(b), h0, cz + R * Math.sin(b)];
        caps.tri([cx, h1, cz], pb, pa, [0, 0], [R, 0], [0, R]); // the cone, up
        caps.tri([cx, h0 + 0.004, cz], pa, pb, [0, 0], [0, R], [R, 0]); // its underside, down
      }
      for (let k = 0; k < 3; k++) {
        const a = (2 * Math.PI * k) / 3 + 0.4;
        const lx = cx + (r - 0.006) * Math.cos(a), lz = cz + (r - 0.006) * Math.sin(a);
        boxFaces(caps, lx - 0.005, bodyTop - 0.01, lz - 0.005, lx + 0.005, h0 + 0.002, lz + 0.005);
      }
      const band = [];
      for (let i = 0; i < n; i++) band.push([cx + (r + 0.006) * Math.cos((2 * Math.PI * i) / n), cz + (r + 0.006) * Math.sin((2 * Math.PI * i) / n)]);
      ringFaces(caps, band, ch.at, (a, b) => [[a, b]], () => bodyTop - 0.34, () => bodyTop - 0.28);
    }
    put(caps.build(mat('painted', masonry ? '#6f6d68' : ch.color, { roughness: masonry ? 0.9 : 0.45, metalness: masonry ? 0 : 0.35 }), `chimney-cap:${ch.id}`, keep), lv, meshes);
    put(dark.build(mat('painted', masonry ? '#5b3f35' : '#0d0d0e', { roughness: 0.85 }), `chimney-flue:${ch.id}`, keep), lv, meshes);

    // ---- the flashing where it goes through the covering
    if (field && (fromRoof || ch.bottomY < (ch.coverMin ?? Infinity))) {
      const fl = new Acc();
      if (masonry) {
        // a band up the sides, standing off them, its top parallel to the roof
        const big = [[cx - w / 2 - PROUD, cz - d / 2 - PROUD], [cx + w / 2 + PROUD, cz - d / 2 - PROUD], [cx + w / 2 + PROUD, cz + d / 2 + PROUD], [cx - w / 2 - PROUD, cz + d / 2 + PROUD]];
        ringFaces(fl, big, ch.at, split, (q, m) => coverAt(q, m) - 0.02, (q, m) => coverAt(q, m) + BAND);
        // an apron lying on the covering round it: front and back over the whole width, the sides between them
        const x0 = cx - w / 2 - PROUD, x1 = cx + w / 2 + PROUD, z0 = cz - d / 2 - PROUD, z1 = cz + d / 2 + PROUD;
        const rects = [
          [x0 - APRON, z0 - APRON, x1 + APRON, z0],
          [x0 - APRON, z1, x1 + APRON, z1 + APRON],
          [x0 - APRON, z0, x0, z1],
          [x1, z0, x1 + APRON, z1],
        ];
        for (const [a0, b0, a1, b1] of rects) {
          const tris = splitTriangles([[[a0, b0], [a1, b0], [a1, b1]], [[a0, b0], [a1, b1], [a0, b1]]], field.lines);
          for (const t of tris) {
            const m = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
            const p = field.planeAt(m[0], m[1]);
            if (!p) continue;
            const T = t.map(([x, z]) => [x, planeY(p, x, z) + (p.tv ?? 0) + 0.006, z]);
            // facing up: (b − a) × (c − a) has y > 0
            const up = (T[1][2] - T[0][2]) * (T[2][0] - T[0][0]) - (T[1][0] - T[0][0]) * (T[2][2] - T[0][2]) > 0;
            const [a, b, c] = up ? T : [T[0], T[2], T[1]];
            fl.tri(a, b, c, [a[0], a[2]], [b[0], b[2]], [c[0], c[2]]);
          }
        }
      } else {
        // a collar round the pipe, from under the covering to over its highest point round it
        const collar = [];
        for (let i = 0; i < n; i++) collar.push([cx + (r + 0.012) * Math.cos((2 * Math.PI * i) / n), cz + (r + 0.012) * Math.sin((2 * Math.PI * i) / n)]);
        ringFaces(fl, collar, ch.at, (a, b) => [[a, b]], (q) => coverAt(q, q) - 0.02, () => (ch.coverMax ?? 0) + 0.12);
      }
      put(fl.build(mat('painted', ch.flashingColor, { roughness: 0.45, metalness: 0.4 }), `chimney-flashing:${ch.id}`, keep), lv, meshes);
    }
  }
  return { meshes, inside, colliders };
}
