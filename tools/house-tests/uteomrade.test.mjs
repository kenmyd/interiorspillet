#!/usr/bin/env node
/**
 * Node test for the site round a generated house (notes/uteomradet.md):
 *   node tools/house-tests/uteomrade.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test house of dev/uteomrade.html (src/dev/uteomrade-hus.js: a walk-out basement on a lot falling to the
 * south) with buildLayout + buildRooms, and two small houses without a basement on a slope (one with `cladding`, one
 * without), and checks:
 *   • the terrain (sitegeom.js): flat at the main floor's step without data, through every terrain line, the slope
 *     from the lines, the flat surfaces level inside and blending out over their open edges, a step at a walled edge;
 *   • the entrances: landing slabs where the ground is near the floor, a porch with steps where it falls away, a sunken
 *     yard with steps where the door stands under the ground, none where a deck or a paved surface is in front; the
 *     auto paths to the yard; the decks' groundY from the ground at a stair's foot and slabs there;
 *   • the ground mesh: no cracks (every open edge lies on a hole, a walled edge or the far border), nothing of it inside
 *     the house, the surfaces' materials where they are;
 *   • the build: one group in the main level's root, ≤ 20 meshes (draw calls), no shadow casters, the retaining walls
 *     from under the lower side to over the higher, cheek walls never under the ground beside them, the deck's posts
 *     down to the ground under each, no overlapping faces in one plane;
 *   • the plinth follows the ground: on the low side of a house without a basement the outer layer reaches down to the
 *     ground – concrete under the main floor's step (cladding's plinth, or a bare one without cladding);
 *   • the walk: the game's PlayerController and CollisionWorld down and up the garden steps, up and down the terrace
 *     stair, up the porch, to the entrance, at 30, 60 and 144 Hz; the retaining wall stops the player;
 *   • validateHouse accepts the test house (no errors, no warnings) and catches a broken site;
 *   • the owner's house has no site and its geometry is unchanged (tools/house-tests/owner-fingerprint.mjs).
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { resolveSite, sitePieces, terrainModel, pointInPolygon, SITE_DEFAULTS } = await imp('src/home/sitegeom.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController } = await imp('src/player/PlayerController.js');
const { uteHus, uteSpec } = await imp('src/dev/uteomrade-hus.js');
const house = await imp('src/data/scripts/house.mjs');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');

const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

/** Builds a spec: layout, roots, rooms and one group with every level (for rays). */
function build(spec) {
  const layout = buildLayout(spec, undefined, { devWarnings: false });
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, layout, null);
  const all = new THREE.Group();
  for (const g of Object.values(roots.levels)) all.add(g);
  all.updateMatrixWorld(true);
  return { layout, roots, R, all, H: layout.house, S: layout.house.site };
}
function hit(all, from, dir, filter = () => true) {
  const rc = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize(), 0, 60);
  const meshes = [];
  all.traverse((m) => m.isMesh && m.visible && filter(m) && meshes.push(m));
  return rc.intersectObjects(meshes, false)[0] ?? null;
}

// ---- the test house
const T0 = Date.now();
const U = build(uteSpec(uteHus().house));
const buildMs = Date.now() - T0;
const S = U.S;

/** A small house without a basement (6 × 5, outer faces x 40–46, z 0–5) on a slope falling 1.2 m to the south. */
function slopeSpec({ cladding = null } = {}) {
  const t = 0.3, x0 = 40, x1 = 46, z0 = 0, z1 = 5;
  const a = [x0 + t, z0 + t], b = [x1 - t, z0 + t], c = [x1 - t, z1 - t], d = [x0 + t, z1 - t];
  const walls = [['s', a, b, [0, 1]], ['o', b, c, [-1, 0]], ['n', c, d, [0, -1]], ['v', d, a, [1, 0]]].map(([k, from, to, normal]) => ({
    id: `w-b-${k}`, roomId: 'b-stue', from, to, normal, thickness: t, height: 2.4, exterior: true, color: '#ece9e3',
    openings: k === 'n' ? [{ id: 'door-b', type: 'door', offset: 2.5, width: 1.0, height: 2.1, sill: 0, frame: { color: '#25272b', width: 0.05, depth: 0.06 }, reveal: { depth: 0.21 }, door: { hinge: 'from', swing: 'out', opensInto: 'ute', openAngleDeg: 95 }, connects: ['b-stue', 'ute'] }] : [],
  }));
  const spec = uteSpec({
    levels: [{ id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: 2.4 }],
    rooms: [{ id: 'b-stue', name: 'Stue', levelId: 'hoved', kind: 'living', polygon: [a, b, c, d], floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' }, ceilingIds: ['c-b-stue'], acoustic: { mode: 'estimate' } }],
    walls,
    ceilings: [{ id: 'c-b-stue', roomId: 'b-stue', polygon: [a, b, c, d], height: 2.4, color: '#f4f2ee' }],
    site: {
      terrain: {
        lines: [
          { id: 'sor', points: [[x0, z0, -1.35], [x1, z0, -1.35]] },
          { id: 'nord', points: [[x1, z1, -0.15], [x0, z1, -0.15]] },
          { id: 'ost', points: [[x1, z0, -1.35], [x1, z1, -0.15]] },
          { id: 'vest', points: [[x0, z1, -0.15], [x0, z0, -1.35]] },
        ],
      },
    },
  });
  delete spec.roofs;
  delete spec.decks;
  delete spec.cladding;
  if (cladding) spec.cladding = cladding;
  return spec;
}

section('Terrenget (sitegeom.js)');
{
  const flat = terrainModel(null, { groundY: -0.15 });
  check('without lines or points the ground is flat at the main floor − one step (−0.15)', flat.flat && flat.naturalAt(3, 7) === -0.15 && flat.naturalAt(-40, 90) === -0.15);
  const errs = [];
  for (const l of S.terrain.lines) {
    for (let i = 0; i < l.points.length - 1; i++) {
      const p = l.points[i], q = l.points[i + 1];
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t, y = p[2] + (q[2] - p[2]) * t;
        const e = Math.abs(S.naturalAt(x, z) - y);
        if (e > 0.012) errs.push(`${l.id} (${f2(x)}, ${f2(z)}): ${f3(S.naturalAt(x, z))} ≠ ${f3(y)}`);
      }
    }
  }
  check('the ground passes through every terrain line (≤ 12 mm, the facades\' ground lines)', !errs.length, errs.slice(0, 5).join(' | '));
  check(`the plane falls to the south (dy/dz ${f3(S.terrain.plane.c)} > 0) and the ground goes on beyond the house (z −8: ${f2(S.heightAt(6, -8))}, z 18: ${f2(S.heightAt(6, 18))})`, S.terrain.plane.c > 0.05 && S.heightAt(6, -8) < -2.9 && S.heightAt(6, 18) > 0.2);
  const yard = S.surfaces.find((s) => s.id === 'gardsplass');
  check('a flat surface is level inside (the yard at −0.30)', [[13, 10], [19.5, 13.5], [16, 12]].every(([x, z]) => near(S.heightAt(x, z), -0.3, 1e-9)));
  const nat = S.naturalAt(16, 8.4), blended = S.heightAt(16, 8.4);
  check(`outside an open edge the ground blends back to the terrain within ${SITE_DEFAULTS.blend} m (1.2 m south of the yard: ${f3(blended)}, the terrain ${f3(nat)}, the yard −0.30)`, near(S.heightAt(16, 9.6 - 1.25), S.naturalAt(16, 9.6 - 1.25), 1e-9) && near(S.heightAt(16, 9.59), -0.3, 0.01));
  const inYard = S.heightIn(16, 14, [S.surfaces.indexOf(yard)]), outYard = S.heightIn(16, 14 + yard.wall.thickness, []);
  check(`a walled edge is a step: the yard ${f3(inYard)} at its north edge, the terrain beyond the wall ${f3(outYard)} (no blend)`, near(inYard, -0.3, 1e-9) && outYard - inYard > 0.3 && near(outYard, S.naturalAt(16, 14.2), 1e-9));
  check(`the ground's range for the walk rectangle: ${S.yRange.map(f2).join(' … ')}`, S.yRange[0] < -2.9 && S.yRange[1] > 0.3 && U.H.walkRects.some((r) => r.site && r.minY < S.yRange[0] && r.maxY > S.yRange[1]));
}

section('Inngangene, dekkene og stiene');
{
  const E = Object.fromEntries(S.entrances.map((e) => [e.doorId, e]));
  check(`the entrance (the ground ${f2(E['door-ute-inngang'].drop)} under the floor): landing slabs at the floor's step, 1.4 m out`, E['door-ute-inngang'].kind === 'slabs' && S.surfaces.some((s) => s.id === 'ute-inngang-door-ute-inngang' && s.surface === 'slabs' && near(s.y, -0.15, 1e-9)));
  const porch = U.H.decks.find((d) => d.id === 'ute-trapp-door-ute-side');
  const ps = porch?.stairs[0];
  check(`the side door (the ground ${f2(E['door-ute-side'].drop)} m down): a porch at the threshold with ${ps?.risers} steps (≤ 0.18) down to the ground at its foot`, E['door-ute-side'].kind === 'porch' && porch.supports === 'solid' && near(porch.top, -0.02, 1e-9) && ps.riserH <= 0.18 + 1e-9 && near(ps.bottom, S.naturalAt(ps.origin[0] + ps.out[0] * (ps.reach + 0.3), ps.origin[1] + ps.out[1] * (ps.reach + 0.3)), 0.01));
  check('the terrace door has the deck in front, the walk-out door the paver patio: no auto landing', E['door-ute-terrasse'].kind === 'deck' && E['door-ute-kjeller'].kind === 'surface');
  const terr = U.H.decks.find((d) => d.id === 'u-terrasse');
  const ts = terr.stairs[0];
  const foot = [ts.origin[0] + ts.out[0] * (ts.reach + 0.3), ts.origin[1] + ts.out[1] * (ts.reach + 0.3)];
  check(`the terrace's groundY from the ground at its stair's foot (${f3(terr.groundY)}; ${ts.risers} risers of ${f3(ts.riserH)})`, near(terr.groundY, S.naturalAt(...foot), 0.01) && ts.riserH <= 0.18 + 1e-9);
  const feet = S.surfaces.filter((s) => s.auto === 'deck-foot');
  check('slabs at the foot of both deck stairs, level with the stair\'s bottom', feet.length === 2 && feet.every((s) => U.H.decks.some((d) => d.stairs.some((x) => near(x.bottom, s.y, 1e-9)))));
  const paths = S.surfaces.filter((s) => s.auto === 'path');
  check(`auto paths of slabs from the landing and the porch's foot to the yard (${paths.map((s) => s.id).join(', ')})`, paths.length === 2 && paths.every((s) => s.y === null && s.surface === 'slabs'));
  // a door under the ground: a walled yard and steps up out of it
  const spec = uteSpec(uteHus().house);
  spec.site = { ...spec.site, terrain: { lines: spec.site.terrain.lines.map((l) => (l.id === 'sor' ? { ...l, points: [[0, 0, -1.9], [12, 0, -1.9]] } : l)) } };
  spec.site.surfaces = spec.site.surfaces.filter((s) => s.id !== 'uteplass');
  const sunk = resolveSite(spec.site, {
    levels: [{ id: 'kjeller', floorY: -2.7 }, { id: 'hoved', floorY: 0 }], mainLevelId: 'hoved', decks: spec.decks,
    walls: U.H.walls.map((w) => ({ id: w.id, levelId: w.levelId, exterior: w.exterior, start: [w.start.x, w.start.y], end: [w.end.x, w.end.y], normal: [w.normal.x, w.normal.y], thickness: w.thickness, floorY: w.floorY, height: w.height, openings: w.openings.map((o) => ({ id: o.id, type: o.type, offset: o.offset, width: o.width, door: !!o.door, connects: o.connects })) })),
    rooms: U.H.rooms.map((r) => ({ id: r.id, levelId: r.levelId, floorY: r.floorY, polygon: r.polygon.map((p) => [p.x, p.y]) })),
  });
  const yd = sunk.site.surfaces.find((s) => s.auto === 'yard');
  const yst = sunk.site.steps.find((s) => s.auto === 'yard');
  check(`a door under the ground (the walk-out with the ground at −1.9): a walled yard at its step (${yd && f2(yd.y)}) and ${yst?.risers} steps up (${yst && f2(yst.top)}), a warning`, !!yd && near(yd.y, -2.85, 1e-9) && yd.walls.length === 4 && !!yst && yst.riserH <= 0.17 + 1e-9 && sunk.issues.some((i) => /under terrenget/.test(i.msg)));
}

section('Bakken (sitePieces)');
{
  const P = sitePieces(S);
  const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  const E = new Map();
  for (const p of P) {
    const t = p.tri;
    const v = [key(t[0], t[1], t[2]), key(t[3], t[4], t[5]), key(t[6], t[7], t[8])];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      E.set(k, (E.get(k) || 0) + 1);
    }
  }
  const segD = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
  };
  const onPoly = (p, Q, edges = null) => Q.some((a, i) => (!edges || edges.includes(i)) && segD(p, a, Q[(i + 1) % Q.length]) < 1e-3);
  const { xs, zs } = S.grid;
  const onBorder = (p) => near(p[0], xs[0], 1e-3) || near(p[0], xs.at(-1), 1e-3) || near(p[1], zs[0], 1e-3) || near(p[1], zs.at(-1), 1e-3);
  const explained = (p) => onBorder(p) || S.holes.some((Q) => onPoly(p, Q)) || S.surfaces.some((s) => s.y != null && (s.walls.length && onPoly(p, s.polygon, s.walls)));
  // an edge one cell has whole and its neighbour in two (a point on it, at the height of the line: a T-junction) is no
  // crack: split every open edge at the open edges' end points that lie on it, then count again
  const open3 = [...E].filter(([, n]) => n === 1).map(([k]) => k.split('|').map((q) => q.split(',').map((v) => v / 1e5)));
  const pts = [...new Map(open3.flat().map((q) => [q.join(','), q])).values()];
  const E2 = new Map();
  for (const [a, b] of open3) {
    const d = b.map((v, i) => v - a[i]);
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const on = pts.map((q) => {
      const t = ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1] + (q[2] - a[2]) * d[2]) / L2;
      const e = Math.hypot(a[0] + d[0] * t - q[0], a[1] + d[1] * t - q[1], a[2] + d[2] * t - q[2]);
      return { q, t, e };
    }).filter(({ t, e }) => t > 1e-6 && t < 1 - 1e-6 && e < 2e-4).sort((u, v) => u.t - v.t).map(({ q }) => q);
    const chain = [a, ...on, b];
    for (let i = 0; i < chain.length - 1; i++) {
      const ka = chain[i].map((v) => Math.round(v * 1e4)).join(','), kb = chain[i + 1].map((v) => Math.round(v * 1e4)).join(',');
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      E2.set(k, [...(E2.get(k) ?? []), [chain[i], chain[i + 1]]]);
    }
  }
  const open = [...E2.values()].filter((l) => l.length === 1).map(([[a, b]]) => [[a[0], a[2]], [b[0], b[2]]]);
  const bad = open.filter(([a, b]) => !(explained(a) && explained(b)));
  check(`no cracks: all ${open.length} open edges of the ${P.length} triangles lie on a hole, a walled edge or the far border`, !bad.length, bad.slice(0, 4).map((e) => JSON.stringify(e)).join(' | '));
  const inside = P.filter((p) => {
    const cx = (p.tri[0] + p.tri[3] + p.tri[6]) / 3, cz = (p.tri[2] + p.tri[5] + p.tri[8]) / 3;
    return S.footprint.some((Q) => pointInPolygon(cx, cz, Q));
  });
  check('nothing of the ground inside the house (its footprint at and under the main floor is a hole)', !inside.length, `${inside.length} trekanter`);
  const at = (x, z) => P.find((p) => {
    const t = p.tri;
    const A = [[t[0], t[2]], [t[3], t[5]], [t[6], t[8]]];
    return pointInPolygon(x, z, A);
  });
  const sIdx = (id) => String(S.surfaces.findIndex((s) => s.id === id));
  check('the materials where they belong: asphalt on the driveway, gravel in the yard, pavers on the patio, bark in the bed, lawn in the lot, meadow outside it',
    at(24, 11.6)?.key === sIdx('innkjorsel') && at(16, 12)?.key === sIdx('gardsplass') && at(10, -2)?.key === sIdx('uteplass') && at(-0.9, 4)?.key === sIdx('bed-vest') && at(-5, -5)?.key === 'grass' && at(-20, 0)?.key === 'meadow');
  const t = at(16, 12);
  check('a flat surface\'s triangles are level (the yard: every corner at −0.30)', [t.tri[1], t.tri[4], t.tri[7]].every((y) => near(y, -0.3, 1e-9)));
}

section('Bygget (site.js)');
{
  const site = U.roots.levels.hoved.getObjectByName('site');
  const meshes = [];
  site?.traverse((m) => m.isMesh && meshes.push(m));
  const tris = meshes.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  check(`one group «site» in the main level's root: ${meshes.length} meshes (≤ 20 draw calls), ${tris} triangles, built with the house in ${buildMs} ms`, !!site && meshes.length <= 20 && tris < 60000);
  check('no shadow from the site (castShadow false on every mesh), the ground receives', meshes.every((m) => !m.castShadow) && meshes.some((m) => m.receiveShadow && /moss/.test(m.material.name)));
  check('the site is a collider (the octree) and every garden step has an invisible walking wedge', U.R.colliders.includes(site) && U.R.colliders.filter((c) => c.name?.startsWith('site-wedge:')).length === S.steps.length);
  // retaining walls: from under the lower side to over the higher
  const yard = S.surfaces.find((s) => s.id === 'gardsplass');
  const ws = S.retaining.filter((r) => r.surfaceId === 'gardsplass');
  check(`the yard's retaining wall: ${ws.length} pieces along its north edge, ${f2(Math.max(...ws.map((r) => r.step)))} m step at most, its top over the higher side, its foot under the yard`, ws.length >= 7 && ws.every((r) => r.top.every((y, i) => y >= Math.max(yard.y, S.heightIn(r.quad[i][0], r.quad[i][1], [])) - 1e-6) && r.bottom < yard.y - 0.3));
  const wallHit = hit(U.all, [16, -0.1, 12.5], [0, 0, 1], (m) => m.userData.site);
  check(`a ray from the yard north hits the wall (${wallHit?.object.material.name} at z ${wallHit && f2(wallHit.point.z)})`, !!wallHit && near(wallHit.point.z, 14, 0.01) && /concrete/.test(wallHit.object.material.name));
  // the cheek walls of the garden steps never under the ground beside them
  const st = S.steps[0];
  const lowCheek = [];
  for (let k = 0; k <= 10; k++) {
    const u = (st.length * k) / 10;
    for (const side of [-1, 1]) {
      const c = side * (st.width / 2 + st.cheek / 2);
      const p = [st.origin[0] + st.out[0] * u + st.across[0] * c, st.origin[1] + st.out[1] * u + st.across[1] * c];
      const h = hit(U.all, [p[0], 10, p[1]], [0, -1, 0], (m) => m.userData.site);
      const g = S.heightAt(p[0] + st.across[0] * side * 0.2, p[1] + st.across[1] * side * 0.2);
      if (!h || h.point.y < g) lowCheek.push(`u ${f2(u)}: ${h ? f3(h.point.y) : '–'} < ${f3(g)}`);
    }
  }
  check(`the garden steps (${st.risers} × ${f3(st.riserH)}, going ${f2(st.going)}): the cheek walls stand over the ground beside them all the way`, !lowCheek.length && st.riserH <= 0.17 + 1e-9, lowCheek.slice(0, 4).join(' | '));
  // the deck's posts down to the ground under each
  const terr = U.H.decks.find((d) => d.id === 'u-terrasse');
  // a ray just over the ground toward each post hits it (the posts reach the ground under each, not one level)
  const groundUnder = terr.posts.map((p) => S.heightAt(p[0], p[1]));
  const postBad = terr.posts.filter((p) => {
    const h = hit(U.all, [p[0] - 0.5, S.heightAt(p[0], p[1]) + 0.04, p[1]], [1, 0, 0], (m) => /^deck:/.test(m.name));
    return !h || h.distance > 0.5;
  });
  check(`the terrace's ${terr.posts.length} posts reach the ground under each (${f2(Math.min(...groundUnder))} … ${f2(Math.max(...groundUnder))})`, terr.posts.length > 2 && !postBad.length, postBad.map((p) => p.map(f2).join(', ')).join(' | '));
  const r = await coplanarOverlaps(site, { minArea: 2e-6 });
  check(`no overlapping faces in one plane among the site's ${r.triangles} triangles`, !r.bad.length, r.bad.slice(0, 6).join('\n         '));
}

section('Sokkelen følger terrenget');
{
  const B = build(slopeSpec());
  const BC = build(slopeSpec({ cladding: { default: { type: 'wood', direction: 'horizontal', profile: 'shiplap', color: '#e8e4dc' }, plinth: { height: 0.3, material: 'concrete' } } }));
  for (const [name, X] of [['uten kledning', B], ['med kledning', BC]]) {
    const low = X.S.heightAt(43, -0.05);
    // on the low (south) side, between the ground and the main floor's step: the plinth (concrete)
    const ys = [low + 0.1, (low - 0.15) / 2, -0.2];
    const hits = ys.map((y) => hit(X.all, [43, y, -3], [0, 0, 1], (m) => !m.userData.site));
    const conc = hits.map((h) => h?.object.material.userData?.hex ?? h?.object.material.name);
    check(`${name}: the south wall reaches the ground (${f2(low)}): concrete at y ${ys.map(f2).join(', ')} (${conc.join(', ')})`, hits.every((h) => !!h && near(h.point.z, 0, 0.03)) && hits.every((h) => /9c9b96|concrete/.test(`${h.object.material.name} ${h.object.material.userData?.hex}`)));
    const above = hit(X.all, [43, 0.6, -3], [0, 0, 1], (m) => !m.userData.site);
    check(`${name}: above the floor the facade is not concrete (${above?.object.material.name})`, !!above && !/9c9b96/.test(`${above.object.material.name} ${above.object.material.userData?.hex}`));
  }
  const E = B.S.entrances[0];
  check(`the slope house's door on the high side gets landing slabs (the ground ${f2(E.drop)} under the floor)`, E.kind === 'slabs');
}

section('Gangtesten (PlayerController + CollisionWorld)');
const col = new CollisionWorld();
for (const c of U.R.colliders) {
  if (c.isBox3) col.addStaticBox(c);
  else col.addStatic(c);
}
col.build();
col.setBounds(S.grid.xs[0], S.grid.xs.at(-1), S.grid.zs[0], S.grid.zs.at(-1));
/** Walks through plan points (from the ground at the first, or y0), ≤ secs. */
function walk(pts, { hz = 60, y0 = null, secs = 40 } = {}) {
  const input = { move: { forward: 0, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const events = [];
  const player = new PlayerController({ camera: new THREE.PerspectiveCamera(), collision: col, input, settings: { get: () => undefined }, events: { emit: (name, data) => events.push({ name, data }) } });
  player.teleport(new THREE.Vector3(pts[0][0], (y0 ?? S.heightAt(pts[0][0], pts[0][1])) + 0.05, pts[0][1]), 0, 0);
  for (let i = 0; i < 12; i++) player.update(1 / hz);
  events.length = 0;
  input.move.forward = 1;
  let air = 0, n = 0, k = 1;
  for (let i = 0; i < secs * hz && k < pts.length; i++) {
    const t = pts[k];
    const dx = t[0] - player.position.x, dz = t[1] - player.position.z;
    if (Math.hypot(dx, dz) < 0.3) {
      k++;
      continue;
    }
    player.yaw = Math.atan2(-dx, -dz);
    player.update(1 / hz);
    n++;
    if (!player.onGround) air++;
  }
  const hard = events.filter((e) => e.name === 'land' && (e.data?.speed ?? 0) > 1.5).length;
  return { p: player.position.clone(), reached: k >= pts.length, air: air / Math.max(1, n), hard };
}
{
  const st = (id) => {
    const s = U.H.decks.find((d) => d.id === id).stairs[0];
    return { s, foot: [s.origin[0] + s.out[0] * (s.reach + 1.0), s.origin[1] + s.out[1] * (s.reach + 1.0)], on: [s.origin[0] - s.out[0] * 0.9, s.origin[1] - s.out[1] * 0.9] };
  };
  const T = st('u-terrasse'), P = st('ute-trapp-door-ute-side');
  const routes = [
    { name: 'ned hagetrappa til uteplassen', pts: [[17.5, 10.6], [17.5, 9.6], [17.5, 0.4], [12.6, 0.3], [10, -2]], want: -2.85 },
    { name: 'opp hagetrappa til gårdsplassen', pts: [[10, -2], [12.6, 0.3], [17.5, 0.4], [17.5, 9.0], [17.5, 11.0]], want: -0.3 },
    { name: 'opp terrassetrappa', pts: [[10, -2], [T.foot[0] + 1.5, -5], [T.foot[0], T.foot[1] - 1.5], T.foot, T.on, [4, -2]], want: T.s.top },
    { name: 'ned terrassetrappa', pts: [[4, -2], T.on, T.foot, [T.foot[0] - 0.5, T.foot[1]]], y0: T.s.top, want: T.s.bottom },
    { name: 'opp trappa til sidedøra', pts: [[15, 11], P.foot, P.on], want: P.s.top },
    { name: 'fra gårdsplassen til inngangen', pts: [[15, 11], [12, 10.4], [6.5, 10.2], [6.5, 9.5]], want: -0.15 },
  ];
  for (const r of routes) {
    const fails = [];
    for (const hz of [30, 60, 144]) {
      const w = walk(r.pts, { hz, y0: r.y0 ?? null });
      if (!(w.reached && near(w.p.y, r.want, 0.03) && w.air < 0.03 && !w.hard)) fails.push(`${hz} Hz: (${f2(w.p.x)}, ${f3(w.p.y)}, ${f2(w.p.z)}) skal ${f3(r.want)}, fram ${w.reached}, i lufta ${(w.air * 100).toFixed(1)} %, harde ${w.hard}`);
    }
    check(`${r.name}: fram og på bakken ved 30, 60 og 144 Hz, ingen harde landinger`, !fails.length, fails.join(' | '));
  }
  const w = walk([[16, 12], [16, 16]], { secs: 6 });
  check(`the yard's retaining wall stops the player (z ${f2(w.p.z)} < 14, y ${f3(w.p.y)})`, w.p.z < 14 && near(w.p.y, -0.3, 0.02));
}

section('Validatoren');
{
  const full = house.loadRegistry();
  const reg = { schema: full.schema, pseudoRooms: full.pseudoRooms };
  const v = (spec) => house.validateHouse(spec, { registry: reg, throw: false });
  const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  const ok = v(uteSpec(uteHus().house));
  check('the test house validates (schema.topLevel has site; no errors, no warnings)', !errs(ok).length && !ok.warnings.length && reg.schema.topLevel.includes('site'), [...errs(ok), ...ok.warnings].slice(0, 6).join('\n         '));
  const withSite = (f) => {
    const spec = uteSpec(JSON.parse(JSON.stringify(uteHus().house)));
    f(spec.site, spec);
    return v(spec);
  };
  const has = (r, re, kind = 'errors') => r[kind].some((m) => re.test(m));
  check('a broken site is caught: unknown kind and surface, a bad terrain line, a fence kind, steps without an end, a wall material, an unknown field (warning), a fence through the house (warning)', [
    has(withSite((s) => (s.surfaces[0].kind = 'carpark')), /site.surfaces\/innkjorsel: kind «carpark»/),
    has(withSite((s) => (s.surfaces[1].surface = 'marble')), /surface «marble»/),
    has(withSite((s) => (s.terrain.lines[0].points = [[0, 9]])), /site.terrain.lines\/nord: points må være minst to punkter \[x, z, y\]/),
    has(withSite((s) => (s.fences[0].kind = 'wire')), /kind «wire»/),
    has(withSite((s) => delete s.steps[0].to), /site.steps\/hagetrapp: from og to/),
    has(withSite((s) => (s.walls[0].material = 'glass')), /material «glass»/),
    has(withSite((s) => (s.surfaces[0].colour = '#ffffff')), /ukjente felt «colour»/, 'warnings'),
    has(withSite((s) => s.fences.push({ id: 'gjennom', kind: 'fence', line: [[-2, 4], [14, 4]] })), /site.fences\/gjennom: går gjennom huset/, 'warnings'),
    has(withSite((s) => (s.surfaces[2].walls = [9])), /walls må være true, false eller kantnumre/),
  ].every(Boolean));
  check('the ground over the main floor is a warning (the north line raised to +0.2)', has(withSite((s) => (s.terrain.lines[0].points = s.terrain.lines[0].points.map(([x, z]) => [x, z, 0.2]))), /terrenget ligger 0,[0-9]+ m over gulvet/, 'warnings'));
  check('an unknown top-level key is still an error', has(withSite((s, spec) => (spec.sites = {})), /ukjent toppnøkkel «sites»/));
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no site (spec.site is absent) and no extra walk rectangle', OH.site === null && OH.walkRects.length === OH.levels.length);
  const fp = ownerFingerprint();
  check(`the owner's geometry is unchanged: layout ${fp.layout}, rooms ${fp.rooms} (${fp.meshes} meshes) – as in notes/kledning.md and notes/tak.md`, fp.layout === '9fd8f7a355b0f410' && fp.rooms === 'a7cf211c026c6559' && fp.meshes === 301);
}

done();
