import * as THREE from 'three';
import { mat } from './materials.js';
import { MeshBatcher } from '../world/buildKit.js';
import { glassMaterial } from './wallkit.js';
import { facadeFinish, surfaceFinish } from '../world/surfaces.js';
import { DECK_DEFAULTS } from './deckgeom.js';

/**
 * DECKS – terraces, balconies, porches and roof terraces (notes/kledning.md; the model is home/deckgeom.js, read by
 * layout.js into layout.house.decks). Built by rooms.js after the roofs, for every deck of layout.house.decks:
 *   • the deck as a slab from its top down `thickness` (supports 'solid': down to the ground): the surface on top
 *     (terrassebord, fliser, betong – UVs in metres, the boards along the house wall), a fascia on the free edges, the
 *     underside; no side face where the deck stands against the house;
 *   • posts under the free edges (supports 'posts'), from just under the ground to the deck's underside;
 *   • the railings of deckgeom (free edges with fall, never where a stair is): glass between black posts, horizontal
 *     wood slats, vertical wood balusters or black steel bars, with a handrail; the stairs' sloped railings the same;
 *   • the stairs: wooden treads, closed risers and stringers on a deck of boards, a solid concrete flight otherwise;
 *   • collision: the slab and the posts are solid (the octree), every railing is a row of Box3 (pieces of ≤ 0.1 m
 *     along a slanted edge), every stair an invisible closed wedge along its nosing line (as the house's stairs,
 *     stairs.js) – the player (capsule r 0.3, step 0.3) walks up the stair and over the deck.
 * Everything goes into the deck's level root (ctx.roots.levels[levelId], ground decks: the main level's).
 *
 *   buildDecks(H, opts) → { groups, colliders }
 *
 * opts: { roots (ctx.roots.levels), fallback (Group), keep, batchers, quality, mainLevelId, groundAt? } – groundAt(x, z):
 * the ground of a site (notes/uteomradet.md); the posts and a solid deck's skirt then reach down to it.
 * Mesh names: `deck:<id>:<material>` (the batch of one deck), `deck-wedge:<id>:<n>` (the stairs' colliders, not in the
 * scene).
 */

const UP = new THREE.Vector3(0, 1, 0);
const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/** Rotation y that maps local +x onto the plan direction d = [dx, dz] (as exterior.js). */
const yawOf = (d) => Math.atan2(-d[1], d[0]);

/** Collects triangles with UVs into a BufferGeometry. */
class Tris {
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
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * A closed prism from a convex profile in (u, y) (counter-clockwise), extruded across c ∈ [−w/2, w/2]: world =
 * origin + out·u + across·c, y. Every face winds outward (the octree's capsule test is one-sided).
 */
function prismGeometry(profile, origin, out, across, w) {
  const P = (u, y, c) => [origin[0] + out[0] * u + across[0] * c, y, origin[1] + out[1] * u + across[1] * c];
  const faces = [];
  const n = profile.length;
  const lo = profile.map(([u, y]) => P(u, y, -w / 2));
  const hi = profile.map(([u, y]) => P(u, y, w / 2));
  for (let i = 1; i < n - 1; i++) {
    faces.push([lo[0], lo[i], lo[i + 1]]);
    faces.push([hi[0], hi[i + 1], hi[i]]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([lo[i], hi[i], hi[j]]);
    faces.push([lo[i], hi[j], lo[j]]);
  }
  const cen = [0, 0, 0];
  for (const p of [...lo, ...hi]) for (let k = 0; k < 3; k++) cen[k] += p[k] / (2 * n);
  const pos = [];
  const v = (p) => new THREE.Vector3(...p);
  for (const [a, b, c] of faces) {
    const nrm = v(b).sub(v(a)).cross(v(c).sub(v(a)));
    if (nrm.lengthSq() < 1e-14) continue;
    const fc = v(a).add(v(b)).add(v(c)).multiplyScalar(1 / 3);
    if (nrm.dot(fc.sub(v(cen))) < 0) pos.push(...a, ...c, ...b);
    else pos.push(...a, ...b, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/**
 * Builds the decks of layout.house (see the top of this file).
 * @param {object} H  layout.house
 * @param {object} opts
 */
export function buildDecks(H, opts) {
  const { keep = (x) => x, batchers = [], quality = {}, groundAt = null } = opts;
  // the facade's texture sets (rooms.js facadeRes): full resolution on «høy» only, the decks are seen from outside
  const res = quality.level === 'high' ? 1 : 0.5;
  const groups = [];
  const colliders = [];
  const decks = H.decks || [];
  if (!decks.length) return { groups, colliders };
  const mainId = opts.mainLevelId ?? H.levels.find((l) => l.id === 'hoved')?.id ?? H.levels[0]?.id;
  const parentOf = (levelId) => opts.roots?.[levelId ?? mainId] ?? opts.fallback;
  const finish = (kind, hex, o = {}) => {
    try {
      return facadeFinish(kind, hex, { res, ...o });
    } catch {
      return mat('painted', hex, { roughness: 0.85 }); // no texture support
    }
  };
  const tiles = (hex) => {
    try {
      return surfaceFinish('tiles', hex, { size: [0.6, 0.6], grout: 0.005, groutColor: shade(hex, 0.72), res, roughness: 0.7 });
    } catch {
      return mat('painted', hex, { roughness: 0.7 });
    }
  };

  for (const d of decks) {
    const batch = new MeshBatcher(`deck:${d.id}`);
    batchers.push(batch);
    const boards = d.surface === 'boards';
    const M = {
      top: boards ? finish('deck-boards', d.color) : d.surface === 'tiles' ? tiles(d.color) : finish('concrete', d.color),
      fascia: boards ? finish('wood', shade(d.color, 0.82), { profile: 'plain' }) : finish('concrete', shade(d.color, 0.92)),
      skirt: boards ? finish('wood', shade(d.color, 0.78), { profile: 'plain' }) : finish('concrete', shade(d.color, 0.9)),
      post: boards ? finish('wood', shade(d.color, 0.8), { profile: 'plain' }) : finish('concrete', '#9c9b96'),
      tread: boards ? finish('deck-boards', d.color) : finish('concrete', d.color),
      wood: finish('wood', d.railing.color, { profile: 'plain' }),
      steel: mat('black-metal', d.railing.color, { roughness: 0.45 }),
      glass: glassMaterial(),
    };

    // ---- the slab: top, underside, the free edges' faces (fascia, or the skirt down to the ground)
    {
      const P = d.outline;
      const top = d.top, bot = d.bottom;
      const solidTo = (p, y) => (d.supports === 'solid' && groundAt ? Math.min(y, groundAt(p[0], p[1]) - 0.1) : y);
      const b = d.boardDir;
      const acrossB = [-b[1], b[0]];
      const uvTop = (x, z) => [x * acrossB[0] + z * acrossB[1], x * b[0] + z * b[1]];
      const contour = P.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const T = new Tris();
      const B = new Tris();
      const S = new Tris();
      for (const [i, j, k] of tris) {
        const a = P[i], bb = P[j], c = P[k];
        // up-facing: (b − a) × (c − a) has +y when the triangle runs clockwise in (x, z) seen from above
        const cy = (bb[1] - a[1]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[1] - a[1]);
        const [q1, q2] = cy > 0 ? [bb, c] : [c, bb];
        T.tri([a[0], top, a[1]], [q1[0], top, q1[1]], [q2[0], top, q2[1]], uvTop(...a), uvTop(...q1), uvTop(...q2));
        B.tri([a[0], bot, a[1]], [q2[0], bot, q2[1]], [q1[0], bot, q1[1]], uvTop(...a), uvTop(...q2), uvTop(...q1));
      }
      let run = 0;
      for (const e of d.edges) {
        // (a solid deck on a site: the skirt in pieces of ≤ 0.5 m, each down to the ground under its ends)
        const pieces = d.supports === 'solid' && groundAt
          ? e.free.flatMap(([f0, f1]) => {
            const m = Math.max(1, Math.ceil((f1 - f0) / 0.5));
            return Array.from({ length: m }, (_, k) => [f0 + ((f1 - f0) * k) / m, f0 + ((f1 - f0) * (k + 1)) / m]);
          })
          : e.free;
        for (const [s0, s1] of pieces) {
          const p = [e.a[0] + e.dir[0] * s0, e.a[1] + e.dir[1] * s0];
          const q = [e.a[0] + e.dir[0] * s1, e.a[1] + e.dir[1] * s1];
          const u0 = run + s0, u1 = run + s1;
          // facing e.out: p → q along the edge, seen from outside counter-clockwise (p low, q low, q high, p high)
          const bp = solidTo(p, bot), bq = solidTo(q, bot);
          const quad = [[p[0], bp, p[1]], [q[0], bq, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]];
          const nrm = new THREE.Vector3(...quad[1]).sub(new THREE.Vector3(...quad[0])).cross(new THREE.Vector3(...quad[2]).sub(new THREE.Vector3(...quad[0])));
          const flip = nrm.x * e.out[0] + nrm.z * e.out[1] < 0;
          const uv = d.supports === 'solid' ? [[u0, bp], [u1, bq], [u1, top], [u0, top]] : [[bot, u0], [bot, u1], [top, u1], [top, u0]];
          if (flip) S.quad(quad[1], quad[0], quad[3], quad[2], uv[1], uv[0], uv[3], uv[2]);
          else S.quad(...quad, ...uv);
        }
        run += e.length;
      }
      const gT = T.geometry(), gB = B.geometry(), gS = S.geometry();
      if (gT) batch.add(gT, M.top, { collide: true });
      if (gB) batch.add(gB, d.supports === 'solid' ? M.skirt : M.fascia, { collide: true, castShadow: false });
      if (gS) batch.add(gS, d.supports === 'solid' ? M.skirt : M.fascia, { collide: true });
      for (const g of [gT, gB, gS]) g?.dispose();
    }

    // ---- posts
    const ps = DECK_DEFAULTS.postSize;
    for (const p of d.posts) {
      const y0 = (groundAt ? groundAt(p[0], p[1]) : d.groundY) - 0.1;
      const h = d.bottom - y0;
      if (h > 0.05) batch.box(ps, h, ps, p[0], y0 + h / 2, p[1], M.post, { rot: [0, yawOf(d.boardDir), 0], collide: true });
    }

    // ---- railings (level runs on the deck) and the stairs' sloped ones
    const R = d.railing;
    const wood = R.type === 'wood-slats' || R.type === 'wood-vertical';
    const postW = wood ? 0.09 : 0.05;
    const postMat = wood ? M.wood : M.steel;
    const postsAt = []; // plan points of the railing posts (a corner post is shared by two runs)
    const addPost = (x, z, y0, h, yaw) => {
      if (postsAt.some((q) => Math.abs(q[0] - x) < 0.02 && Math.abs(q[1] - z) < 0.02 && Math.abs(q[2] - y0) < 0.02)) return false;
      postsAt.push([x, z, y0]);
      batch.box(postW, h, postW, x, y0 + h / 2, z, postMat, { rot: [0, yawOf(yaw), 0], collide: false });
      return true;
    };
    /**
     * One railing from a to b (plan) with its base line going from ya to yb (level when equal), `out` pointing away
     * from the walking side. The posts' centre line lies postW/2 (+ `pad`) inside the line a–b. trim0 / trim1 shorten
     * it at a or b (1 cm off the house wall, the deck's fascia and a stair's stringers: no faces in one plane).
     */
    const railing = (a0, b0, ya, yb, out, { trim0 = 0, trim1 = 0, pad = 0 } = {}) => {
      const L0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
      if (L0 - trim0 - trim1 < 0.1) return;
      const d0 = [(b0[0] - a0[0]) / L0, (b0[1] - a0[1]) / L0];
      const a = [a0[0] + d0[0] * trim0, a0[1] + d0[1] * trim0];
      const b = [b0[0] - d0[0] * trim1, b0[1] - d0[1] * trim1];
      ya += ((yb - ya) * trim0) / L0;
      yb -= ((yb - ya) * trim1) / (L0 - trim0);
      const L = L0 - trim0 - trim1;
      const dir = d0;
      const inset = postW / 2 + pad;
      const P = (u, off = 0) => [a[0] + dir[0] * u - out[0] * (inset - off), a[1] + dir[1] * u - out[1] * (inset - off)];
      const yAt = (u) => ya + ((yb - ya) * u) / L;
      const H = R.height;
      const sloped = Math.abs(yb - ya) > 1e-3;
      const pitch = Math.atan2(yb - ya, L);
      const yaw = dir;
      const spacing = wood ? 1.3 : 1.5;
      const nP = Math.max(1, Math.ceil(L / spacing));
      const us = Array.from({ length: nP + 1 }, (_, i) => Math.min(L - postW / 2, Math.max(postW / 2, (L * i) / nP)));
      // posts: up to the handrail's top + 1 cm. A corner post is shared: the run that made it (fresh) owns the corner
      const fresh = us.map((u) => {
        const p = P(u);
        return addPost(p[0], p[1], yAt(u) - (sloped ? 0.12 : 0), H + 0.01 + (sloped ? 0.12 : 0), yaw);
      });
      // a straight member from u0 to u1 with its bottom `y` over the base line, h high, d deep, `off` outward
      const member = (u0, u1, y, h, dpt, off, material) => {
        if (u1 - u0 < 0.01) return;
        const um = (u0 + u1) / 2;
        const p = P(um, off);
        const len = (u1 - u0) / Math.cos(pitch);
        batch.box(len, h, dpt, p[0], yAt(um) + y + h / 2, p[1], material, { rot: [0, yawOf(dir), pitch], order: 'YXZ', collide: false });
      };
      // the rails (narrower than the posts) run between the end posts' faces; the posts' centres for the balusters
      const uA = postW / 2, uB = L - postW / 2;
      const rA = postW, rB = L - postW;
      // the wooden handrail (12 cm, wider than the post): 6 cm past the centre of an end post this run made, 6 cm short
      // of one another run made – two handrails meeting at a corner never overlap
      const HW = 0.06;
      const hA = fresh[0] ? Math.max(0.005, uA - HW) : uA + HW;
      const hB = fresh[fresh.length - 1] ? Math.min(L - 0.005, uB + HW) : uB - HW;
      if (R.type === 'wood-slats') {
        // horizontal 7 cm boards with 3 cm gaps on the outside of the posts, a flat handrail on top
        const t = 0.022;
        if (!sloped) for (let y = 0.05; y + 0.07 <= H - 0.04; y += 0.1) member(0, L, y, 0.07, t, inset + t / 2, M.wood);
        else for (let y = -0.1; y + 0.07 <= H - 0.04; y += 0.1) member(0, L, y, 0.07, t, inset + t / 2, M.wood);
        member(hA, hB, H - 0.032, 0.032, 0.12, 0, M.wood);
      } else if (R.type === 'wood-vertical') {
        // vertical balusters 36 × 36 mm, 11 cm apart, between a bottom and a top rail, handrail on top
        member(rA, rB, 0.06, 0.07, 0.048, 0, M.wood);
        member(rA, rB, H - 0.032 - 0.07, 0.07, 0.048, 0, M.wood);
        member(hA, hB, H - 0.032, 0.032, 0.12, 0, M.wood);
        const n = Math.max(1, Math.floor((uB - uA) / 0.11));
        for (let i = 0; i <= n; i++) {
          const u = uA + ((uB - uA) * i) / n;
          if (us.some((q) => Math.abs(q - u) < postW / 2 + 0.03)) continue;
          const p = P(u);
          const y0 = yAt(u) + 0.13, y1 = yAt(u) + H - 0.102;
          batch.box(0.036, y1 - y0, 0.036, p[0], (y0 + y1) / 2, p[1], M.wood, { rot: [0, yawOf(dir), 0], collide: false });
        }
      } else if (R.type === 'steel-bars') {
        member(rA, rB, 0.08, 0.02, 0.03, 0, M.steel);
        member(rA, rB, H - 0.04, 0.04, 0.04, 0, M.steel);
        const n = Math.max(1, Math.floor((uB - uA) / 0.11));
        for (let i = 0; i <= n; i++) {
          const u = uA + ((uB - uA) * i) / n;
          if (us.some((q) => Math.abs(q - u) < postW / 2 + 0.03)) continue;
          const p = P(u);
          const y0 = yAt(u) + 0.1, y1 = yAt(u) + H - 0.04;
          batch.box(0.016, y1 - y0, 0.016, p[0], (y0 + y1) / 2, p[1], M.steel, { rot: [0, yawOf(dir), 0], collide: false });
        }
      } else if (R.type === 'glass') {
        // a glass panel per bay between the posts, a black cap rail on top
        for (let i = 0; i < us.length - 1; i++) member(us[i] + postW / 2 + 0.01, us[i + 1] - postW / 2 - 0.01, 0.06, H - 0.06 - 0.05, 0.012, 0, M.glass);
        member(rA, rB, H - 0.04, 0.04, 0.04, 0, M.steel);
      }
      // collision: a thin wall along the posts' line, Box3 pieces (axis-aligned runs: one box)
      const axis = Math.abs(dir[0]) < 1e-6 || Math.abs(dir[1]) < 1e-6;
      const pieces = axis && !sloped ? 1 : Math.max(1, Math.ceil(L / 0.1));
      for (let i = 0; i < pieces; i++) {
        const u0 = (L * i) / pieces, u1 = (L * (i + 1)) / pieces;
        const p0 = P(u0), p1 = P(u1);
        const lo = Math.min(yAt(u0), yAt(u1)) - (sloped ? 0.3 : 0);
        colliders.push(new THREE.Box3(
          new THREE.Vector3(Math.min(p0[0], p1[0]) - 0.04, lo, Math.min(p0[1], p1[1]) - 0.04),
          new THREE.Vector3(Math.max(p0[0], p1[0]) + 0.04, Math.max(yAt(u0), yAt(u1)) + H + 0.1, Math.max(p0[1], p1[1]) + 0.04),
        ));
      }
    };
    for (const r of d.railings) railing(r.a, r.b, d.top, d.top, r.out, { trim0: r.house0 ? 0.012 : 0, trim1: r.house1 ? 0.012 : 0 });

    // ---- stairs
    d.stairs.forEach((s, k) => {
      const { origin: O, out, across, width: w, risers: n, riserH: Rh, going: G, top, bottom: gY } = s;
      const yaw = yawOf(out);
      const at = (u, c) => [O[0] + out[0] * u + across[0] * c, O[1] + out[1] * u + across[1] * c];
      if (boards && n >= 2) {
        // treads (36 mm, 2 cm nosing), closed risers behind each nosing, two stringers (one riser: the deck's edge is
        // the step, nothing to build but the wedge)
        const tt = 0.036, sw = 0.04;
        for (let i = 1; i <= n - 1; i++) {
          const y = top - i * Rh;
          const u0 = (i - 1) * G, u1 = i * G + 0.02;
          const p = at((u0 + u1) / 2, 0);
          batch.box(u1 - u0, tt, w - 2 * sw, p[0], y - tt / 2, p[1], M.tread, { rot: [0, yaw, 0], collide: false });
        }
        for (let i = 2; i <= n; i++) {
          const u = (i - 1) * G - 0.011;
          const yTop = top - (i - 1) * Rh - tt, yBot = top - i * Rh;
          const p = at(u, 0);
          if (yTop - yBot > 0.01) batch.box(0.022, yTop - yBot, w - 2 * sw, p[0], (yTop + yBot) / 2, p[1], M.fascia, { rot: [0, yaw, 0], collide: false });
        }
        // stringers: from the deck edge down along the nosing line to the ground, 0.28 deep
        const slope = Rh / G;
        const upper = (u) => Math.min(top - 0.01, top - slope * u + 0.04);
        const uB = (top + 0.04 - gY) / slope;
        const uC = Math.max(0, uB - 0.28 / slope);
        const prof = [[0, upper(0)], [0, Math.max(gY, upper(0) - 0.28)], [uC, gY], [uB, gY]];
        if (uC > 0 && upper(0) - 0.28 <= gY) prof.splice(1, 1);
        // keep it counter-clockwise in (u, y)
        const area = prof.reduce((acc, p, i) => acc + p[0] * prof[(i + 1) % prof.length][1] - prof[(i + 1) % prof.length][0] * p[1], 0);
        if (area < 0) prof.reverse();
        for (const side of [-1, 1]) {
          const g = keep(prismGeometry(prof, at(0, side * (w / 2 - sw / 2)), out, across, sw));
          batch.add(g, M.fascia, { collide: false });
        }
      } else if (!boards && n >= 2) {
        // a solid flight: the steps' profile extruded across the width
        const prof = [[0, gY]];
        for (let i = 1; i <= n - 1; i++) prof.push([(i - 1) * G, top - i * Rh], [i * G, top - i * Rh]);
        prof.push([Math.max(0, (n - 1) * G), gY]);
        const shape = new THREE.Shape(prof.map(([u, y]) => new THREE.Vector2(u, y)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
        g.translate(0, 0, -w / 2);
        // local (u, y, c) → world: x = O + out·u + across·c
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(out[0], 0, out[1]), UP, new THREE.Vector3(across[0], 0, across[1])).setPosition(O[0], 0, O[1]);
        if (m.determinant() < 0) {
          m.makeBasis(new THREE.Vector3(out[0], 0, out[1]), UP, new THREE.Vector3(-across[0], 0, -across[1])).setPosition(O[0], 0, O[1]);
        }
        g.applyMatrix4(m);
        // UVs in metres: tops (u, c), faces (along, y)
        const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, x, z);
          else uv.setXY(i, Math.abs(nrm.getX(i)) > Math.abs(nrm.getZ(i)) ? z : x, y);
        }
        batch.add(g, M.tread, { collide: false });
        g.dispose();
      }
      // the walking wedge along the nosing line (as stairs.js: invisible, closed, not in the scene)
      const wedge = new THREE.Mesh(keep(prismGeometry([[-0.02, top], [-0.02, top - 0.3], [s.reach, gY - 0.1], [s.reach, gY]], O, out, across, w)));
      wedge.name = `deck-wedge:${d.id}:${k}`;
      wedge.visible = false;
      wedge.userData.collider = 'deck-stair-wedge';
      wedge.updateMatrixWorld(true);
      colliders.push(wedge);
    });
    // (1.2 cm off the deck's edge and in from the stair's side: never in the plane of the fascia, a stringer or a flight)
    for (const r of d.stairRailings) railing(r.a, r.b, r.topY, r.bottomY, r.out, { trim0: 0.012, trim1: 0.012, pad: 0.012 });

    const g = batch.build();
    g.name = `deck:${d.id}`;
    g.userData.deckId = d.id;
    parentOf(d.levelId)?.add(g);
    g.updateMatrixWorld(true);
    groups.push(g);
    colliders.push(g);
  }
  return { groups, colliders };
}
