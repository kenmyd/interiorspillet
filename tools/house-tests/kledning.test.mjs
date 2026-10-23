#!/usr/bin/env node
/**
 * Node test for the cladding and the decks (notes/kledning.md):
 *   node tools/house-tests/kledning.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test houses of dev/kledning.html (src/dev/kledning-hus.js), each its own house file, with buildLayout +
 * buildRooms and checks:
 *   • the model (claddinggeom.js): the defaults, zones that inherit, the finish at a point (zones, levels, walls, height
 *     bands, the gable), the ground; the decks (deckgeom.js): edges against the house, the fall, the railings, the
 *     stairs (risers ≤ 0.18, 2R + G ≈ 0.62), the posts, the walking surface, floorYAt and the walk rectangles;
 *   • the cladding in 3D: rays from outside hit the right finish (plinth, bands, the gable triangle, the dormer-free
 *     walls), lying boards have their UVs swapped, corner boards and surrounds in the right colours (the windows' own
 *     frame colour), none where trim says no;
 *   • the decks in 3D: in their level's root, the railing kinds, a walking wedge per stair;
 *   • no two faces facing the same way overlap in one plane (the cladding, the trims, the decks);
 *   • the textures: one cached, colour-neutral set per kind (and profile / module), one material per finish;
 *   • the walk: the game's PlayerController and CollisionWorld up and down every stair at 30, 60 and 144 Hz, into a
 *     railing (it holds) and off a low deck without one;
 *   • validateHouse accepts the test houses (no errors, no warnings) and catches broken cladding and decks;
 *   • the owner's house has neither (its geometry: tools/house-tests/owner-fingerprint.mjs, also printed here).
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { resolveCladding, finishAt, wallCuts, groundLevel, GROUND_STEP, CLADDING_DEFAULTS } = await imp('src/home/claddinggeom.js');
const { FALL_LIMIT } = await imp('src/home/deckgeom.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController } = await imp('src/player/PlayerController.js');
const { kledningHus, kledningSpec } = await imp('src/dev/kledning-hus.js');
const house = await imp('src/data/scripts/house.mjs');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');

const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

// ---- build every test house
const T0 = Date.now();
const H = {};
for (const h of kledningHus()) {
  const layout = buildLayout(kledningSpec(h.house), undefined, { devWarnings: false });
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, layout, null);
  const all = new THREE.Group();
  for (const g of Object.values(roots.levels)) all.add(g);
  all.updateMatrixWorld(true);
  H[h.key] = { ...h, layout, roots, R, all, house: layout.house };
}
const buildMs = Date.now() - T0;
const deck = (key, id) => H[key].house.decks.find((d) => d.id === id);
/** The first mesh a ray from `from` along `dir` hits among the house's meshes (visible ones). */
function hit(key, from, dir) {
  const rc = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize(), 0, 50);
  const meshes = [];
  H[key].all.traverse((m) => m.isMesh && m.visible && meshes.push(m));
  return rc.intersectObjects(meshes, false)[0] ?? null;
}
const matName = (h) => [].concat(h?.object?.material).map((m) => m?.name ?? '').join('+');

section('Modellen: kledningen (claddinggeom.js)');
{
  const lv = [{ id: 'kjeller', floorY: -2.7 }, { id: 'hoved', floorY: 0 }, { id: 'etg2', floorY: 2.7 }];
  const walls = [{ id: 'w-s', levelId: 'hoved', exterior: true }, { id: 'w-n', levelId: 'hoved', exterior: true }, { id: 'w-2', levelId: 'etg2', exterior: true }, { id: 'w-k', levelId: 'kjeller', exterior: true }, { id: 'w-inne', levelId: 'hoved', exterior: false }];
  const R = (raw) => resolveCladding(raw, { levels: lv, walls, mainLevelId: 'hoved' });
  const c0 = R({}).cladding;
  check('{} gives today\'s look: stående tømmermannskledning #4a4642, no plinth, no trim', c0.default.type === 'wood' && c0.default.direction === 'vertical' && c0.default.profile === 'board-batten' && c0.default.color === '#4a4642' && c0.plinth === null && c0.trim === null);
  check('the basement keeps its plaster (#d9d6cf) without a zone of its own', finishAt(c0, { levelId: 'kjeller', wallId: 'w-k', y: 1 }).type === 'render' && finishAt(c0, { levelId: 'kjeller', wallId: 'w-k', y: 1 }).color === '#d9d6cf');
  const c1 = R({ default: { type: 'wood', direction: 'horizontal', color: '#E6E2D8' }, zones: [{ id: 'z1', color: '#000000' }, { id: 'z2', type: 'panels' }] }).cladding;
  check('horizontal wood defaults to dobbeltfals (shiplap), colours are lower case', c1.default.profile === 'shiplap' && c1.default.color === '#e6e2d8');
  check('a zone without a type inherits the default (type, direction, profile), its own colour', c1.zones[0].type === 'wood' && c1.zones[0].direction === 'horizontal' && c1.zones[0].profile === 'shiplap' && c1.zones[0].color === '#000000');
  check('a zone of another type starts from that type\'s defaults (panels 1.2 × 2.4, #8b8f91)', c1.zones[1].type === 'panels' && c1.zones[1].module.join() === '1.2,2.4' && c1.zones[1].color === CLADDING_DEFAULTS.color.panels);
  const c2 = R({ plinth: {}, trim: {} }).cladding;
  check('plinth defaults: 0.3 m concrete #9c9b96; trim defaults: the cladding\'s colour, corners and surrounds', c2.plinth.height === 0.3 && c2.plinth.material === 'concrete' && c2.plinth.color === '#9c9b96' && c2.trim.color === '#4a4642' && c2.trim.corners && c2.trim.surrounds);
  const c3 = R({
    zones: [
      { id: 'lav', levelId: 'hoved', to: 1.0, type: 'brick' },
      { id: 'gavl', gable: true, type: 'panels' },
      { id: 'nord', walls: ['w-n'], type: 'stone' },
      { id: 'kjeller', levelId: 'kjeller', type: 'render', color: '#cfc9bd' },
    ],
  }).cladding;
  const at = (levelId, wallId, y, gableY = null) => finishAt(c3, { levelId, wallId, y, gableY }).type;
  check('height band: brick under 1.0 on hoved, wood over it, not on etg2', at('hoved', 'w-s', 0.5) === 'brick' && at('hoved', 'w-s', 1.5) === 'wood' && at('etg2', 'w-2', 0.5) === 'wood');
  check('the gable zone only above the gable line (and only on a wall that has one)', at('etg2', 'w-2', 3, 2.5) === 'panels' && at('etg2', 'w-2', 2, 2.5) === 'wood' && at('etg2', 'w-2', 3) === 'wood');
  check('a walls zone only on those walls, and the last zone wins (stone over the brick band on w-n)', at('hoved', 'w-n', 0.5) === 'stone' && at('hoved', 'w-s', 0.5) === 'brick');
  check('a level zone: plaster in #cfc9bd on the basement', at('kjeller', 'w-k', 1) === 'render' && finishAt(c3, { levelId: 'kjeller', wallId: 'w-k', y: 1 }).color === '#cfc9bd');
  check('wallCuts: the band\'s top, the gable line and the plinth\'s top, sorted', wallCuts(c3, { levelId: 'hoved', wallId: 'w-s', gableY: 2.45, plinthTop: 0.15 }).join() === '0.15,1,2.45');
  check(`the ground: the main floor − ${GROUND_STEP} (the planbygger's 3D view)`, groundLevel(lv, 'hoved') === -0.15 && groundLevel([{ id: 'hoved', floorY: 0.5 }], 'hoved') === 0.35);
  const bad = (raw, re) => R(raw).issues.some((i) => i.level === 'error' && re.test(`${i.where}: ${i.msg}`));
  check('errors: an unknown type, direction, profile, a wall that is not there / not exterior / on another level, from ≥ to, a bad module, plinth material', [
    bad({ default: { type: 'vinyl' } }, /cladding.default: type «vinyl»/),
    bad({ default: { direction: 'diagonal' } }, /direction «diagonal»/),
    bad({ default: { profile: 'log' } }, /profile «log»/),
    bad({ zones: [{ id: 'z', walls: ['w-x'] }] }, /veggen «w-x» finnes ikke/),
    bad({ zones: [{ id: 'z', walls: ['w-inne'] }] }, /w-inne er ikke en yttervegg/),
    bad({ zones: [{ id: 'z', levelId: 'etg2', walls: ['w-s'] }] }, /w-s står på nivået «hoved»/),
    bad({ zones: [{ id: 'z', from: 2, to: 1 }] }, /to \(1\) må være høyere enn from/),
    bad({ default: { type: 'panels', module: [0.1, 2] } }, /module må være/),
    bad({ plinth: { material: 'wood' } }, /plinth: material «wood»/),
  ].every(Boolean));
}

section('Modellen: dekkene (deckgeom.js)');
{
  const v = deck('A', 'a-veranda');
  check('A, veranda: edge 3 stands against the house, the other three are free', v.edges[3].house.length === 1 && !v.edges[3].free.length && [0, 1, 2].every((k) => v.edges[k].free.length === 1 && !v.edges[k].house.length));
  check(`A, veranda: 0.13 over the ground (no fall over ${FALL_LIMIT}), the railing only on the listed edges 0 and 2`, v.railings.length === 2 && v.railings.every((r) => [0, 2].includes(r.edge)) && v.edges.every((e) => e.falls.every((f) => f[2] < FALL_LIMIT)));
  check('A, veranda: one step (rise 0.13) – the deck itself is the top step; the railing ends 1.2 cm off the wall', v.stairs.length === 1 && v.stairs[0].risers === 1 && v.railings.every((r) => r.house0 || r.house1));
  const p = deck('A', 'a-platting');
  check('A, platting: railing \'none\' and no fall – no railing, no posts (on the ground)', !p.railings.length && !p.posts.length && p.surface === 'tiles');
  const b = deck('B', 'b-balkong');
  check(`B, balcony: top 2.68 (y −0.02 over etg2), a railing on its three free edges (fall ${f2(b.top - b.groundY)})`, near(b.top, 2.68, 1e-9) && b.railings.length === 3 && b.railing.type === 'glass' && !b.posts.length);
  const c = deck('C', 'c-terrasse');
  const s = c.stairs[0];
  check(`C, terrace: its own ground (groundY −2.85), the stair ${s.risers} × ${f3(s.riserH)} (≤ 0.18), going ${f3(s.going)}, 2R + G = ${f3(2 * s.riserH + s.going)}`, s.risers === 16 && s.riserH <= 0.18 && near(2 * s.riserH + s.going, 0.62, 0.005) && near(s.bottom, -2.85, 1e-9));
  check('C, terrace: the south edge\'s railing stops at the stair (two runs), railings on both sides of the stair', c.railings.filter((r) => r.edge === 1).length === 2 && c.stairRailings.length === 2);
  check(`C, terrace: ${c.posts.length} posts under the free edges, none against the house wall (its outer face at z 0)`, c.posts.length >= 6 && c.posts.every((q) => q[1] < -0.3));
  const d = deck('D', 'd-takterrasse');
  const roof = H.D.house.roofs.find((q) => q.id === 'roof-d1');
  const roofTop = roof.planes[0].c + roof.tv;
  check(`D, roof terrace: lies on the wing's flat roof (deck bottom ${f3(d.bottom)} over its covering ${f3(roofTop)}), glass → steel bars on three edges`, d.bottom > roofTop + 0.005 && d.railings.length === 3 && d.railing.type === 'steel-bars');
  const e = deck('E', 'e-platting');
  check('E, free-standing (no levelId): y 0.75 over the ground, all four edges free, railings round it but not across the stair', near(e.top, 0.6, 1e-9) && e.edges.every((q) => q.free.length === 1 && !q.house.length) && e.railings.length === 5 && e.stairs[0].risers === 5);
  // the walking surface
  const st = c.stairs[0];
  const mid = [st.origin[0] + st.out[0] * st.reach / 2, st.origin[1] + st.out[1] * st.reach / 2];
  check('surfaceY: the top on the deck, the ramp along the nosings over the stair, null beside it', c.surfaceY(32, -1.5) === c.top && near(c.surfaceY(...mid), (st.top + st.bottom) / 2, 1e-6) && c.surfaceY(30, -9) === null);
  check('layout.house.floorYAt finds the deck and the stair; walkRects get one per deck', H.C.house.floorYAt(32, -1.5, 0) === c.top && near(H.C.house.floorYAt(mid[0], mid[1], (st.top + st.bottom) / 2), (st.top + st.bottom) / 2, 1e-6) && H.C.house.walkRects.some((r) => r.deckId === 'c-terrasse'));
}

section('Kledningen i 3D');
{
  check(`the five houses build in ${buildMs} ms`, buildMs < 20000);
  // A: the west gable – plinth, shiplap, flashing, panels in the gable triangle
  const westAt = (y) => matName(hit('A', [-3, y, 1.5], [1, 0, 0]));
  check('A, west wall: plinth (concrete) at 0.0, shiplap at 2.0, panels in the gable at 3.0', /facade-concrete/.test(westAt(0)) && /facade-wood-shiplap/.test(westAt(2)) && /facade-panels/.test(westAt(3)), `${westAt(0)} | ${westAt(2)} | ${westAt(3)}`);
  check('A, west wall: a white flashing where the shiplap meets the panels (the gable line 2.45)', /#f4f2ee/.test(westAt(2.44)), westAt(2.44));
  const roofA = H.A.house.roofs[0];
  const yUnder = roofA.planes.map((pl) => pl.a * -0.1 + pl.b * 1.5 + pl.c).reduce((m, y) => Math.min(m, y)) - 0.03;
  check('A, the gable is clad up to the roof (a ray 3 cm under the soffit hits the panels)', /facade-panels/.test(westAt(yUnder)), `${f3(yUnder)}: ${westAt(yUnder)}`);
  // lying boards: their UVs are swapped (u up the wall), standing ones are not
  /** every vertex of the house's clad meshes in finish re: u (lying) or v (standing) is the height over floorY */
  const uvCheck = (key, re, lying, floorY) => {
    let ok = null;
    H[key].all.traverse((m) => {
      if (!m.isMesh || !/^room-outside:/.test(m.name) || !re.test(matName({ object: m }))) return;
      const p = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
      for (let i = 0; i < p.count; i++) ok = (ok ?? true) && Math.abs((lying ? uv.getX(i) : uv.getY(i)) - (p.getY(i) - floorY)) < 1e-3;
    });
    return ok;
  };
  check('lying boards (A\'s shiplap, C\'s gable, D\'s etg2) have u up the wall; panels and standing boards v up', uvCheck('A', /facade-wood-shiplap/, true, 0) && uvCheck('C', /facade-wood-plain/, true, 0) && uvCheck('D', /facade-wood-plain/, true, 2.7) && uvCheck('A', /facade-panels/, false, 0) && uvCheck('C', /facade-wood-shadow/, false, 0));
  // corner boards and surrounds
  check('A: a white corner board at the south-west corner (22 mm proud of the cladding)', (() => {
    const h = hit('A', [-3, 1.0, 0.05], [1, 0, 0]);
    return h && /#f4f2ee/.test(matName(h)) && near(h.point.x, -0.022, 1e-3);
  })());
  // (rays from below the eave: the roof's overhang reaches down to ≈ 2.05 at its edge)
  const upTo = (x, y) => matName(hit('A', [x, 1.0, -1.0], [0, y - 1.0, 1]));
  check('A: the windows\' surrounds in their own frame colour (#f2f0eb) 5 cm over the head, shiplap 20 cm over it', /#f2f0eb/.test(upTo(1.9, 2.15)) && /shiplap/.test(upTo(1.9, 2.32)), `${upTo(1.9, 2.15)} | ${upTo(1.9, 2.32)}`);
  const jamb = matName(hit('A', [2.35, 1.5, -0.08], [1, 0, 0.6]));
  check('A: the outer reveal (the jamb of the window) in the frame colour too', /#f2f0eb/.test(jamb), jamb);
  const bNames = new Set();
  H.B.all.traverse((m) => m.isMesh && /^room-outside:/.test(m.name) && bNames.add(matName({ object: m })));
  check('B: corner boards (#2f2f31) but no surrounds (surrounds: false): no board in the frame colour', [...bNames].some((n) => /#2f2f31/.test(n)) && ![...bNames].some((n) => /#25272b/.test(n)), [...bNames].join(', '));
  const bAt = (y, x = 15.5) => matName(hit('B', [x, y, -3], [0, 0, 1]));
  check('B, south: stone plinth at 0.0, the brick band at 0.5, wood at 1.5 (hoved), wood at 3.2 (etg2, no band)', /facade-stone/.test(bAt(0)) && /facade-brick/.test(bAt(0.5)) && /#6b4a36/.test(bAt(1.5)) && /#6b4a36/.test(bAt(3.2)), `${bAt(0)} | ${bAt(0.5)} | ${bAt(1.5)} | ${bAt(3.2)}`);
  // (beside the windows, inside the terrace's railing and posts)
  const cAt = (from, dir) => matName(hit('C', from, dir));
  const c1 = cAt([29.0, -1.5, -2], [0, 0, 1]), c2 = cAt([29.0, 1.0, -0.5], [0, 0, 1]), c3 = cAt([40, 3.4, 4], [-1, 0, 0]);
  check('C: plaster (#cfc9bd) on the basement, skyggepanel on hoved, lying plain boards in the east gable', /facade-render #cfc9bd/.test(c1) && /facade-wood-shadow/.test(c2) && /facade-wood-plain/.test(c3), `${c1} | ${c2} | ${c3}`);
  {
    // C with a plinth: a band round the ground only – the exposed basement keeps its plaster under it
    const h = JSON.parse(JSON.stringify(kledningHus()[2].house));
    h.cladding.plinth = { height: 0.3, material: 'stone' };
    const lay = buildLayout(kledningSpec(h), undefined, { devWarnings: false });
    const roots = createHouseRoots(lay, [new THREE.Group()]);
    buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, lay, null);
    const ms = [];
    for (const g of Object.values(roots.levels)) {
      g.updateMatrixWorld(true);
      g.traverse((m) => m.isMesh && m.visible && ms.push(m));
    }
    const at = (y) => matName(new THREE.Raycaster(new THREE.Vector3(29, y, -2), new THREE.Vector3(0, 0, 1)).intersectObjects(ms, false)[0]);
    check('C with a plinth: stone from 0.3 under the ground (−0.45) to 0.3 over it, plaster under the band, wood over it', /facade-stone/.test(at(-0.38)) && /facade-stone/.test(at(0.0)) && /facade-render/.test(at(-1.5)) && /facade-wood-shadow/.test(at(0.5)), `${at(-0.38)} | ${at(0.0)} | ${at(-1.5)} | ${at(0.5)}`);
  }
  const dAt = (from, dir) => matName(hit('D', from, dir));
  const d1 = dAt([49.5, 1.0, -3], [0, 0, 1]), d2 = dAt([42.8, 1.0, 10], [0, 0, -1]), d3 = dAt([42.8, 4.0, 10], [0, 0, -1]), d4 = dAt([49.5, 0.0, -3], [0, 0, 1]);
  check('D: panels on hoved, stone on the north walls (walls zone), lying boards on etg2, a rendered plinth', /facade-panels/.test(d1) && /facade-stone/.test(d2) && /facade-wood-plain/.test(d3) && /facade-render/.test(d4), `${d1} | ${d2} | ${d3} | ${d4}`);
  const eAt = (y) => matName(hit('E', [55.8, y, 2.8], [0, 0, 1]));
  check('E: stone on the shed, red board-and-batten in its south gable', /facade-stone/.test(eAt(1.0)) && /#7a2e24/.test(eAt(2.7)), `${eAt(1.0)} | ${eAt(2.7)}`);
}

section('Dekkene i 3D');
{
  const groupOf = (key, id) => {
    let g = null;
    for (const [lid, root] of Object.entries(H[key].roots.levels)) root.traverse((o) => o.name === `deck:${id}` && !o.isMesh && (g = { g: o, lid }));
    return g;
  };
  check('every deck is a group in its level\'s root (B\'s balcony in etg2, E\'s free-standing one in hoved)', groupOf('B', 'b-balkong')?.lid === 'etg2' && groupOf('A', 'a-veranda')?.lid === 'hoved' && groupOf('E', 'e-platting')?.lid === 'hoved' && groupOf('D', 'd-takterrasse')?.lid === 'etg2');
  const mats = (key, id) => {
    const s = new Set();
    groupOf(key, id)?.g.traverse((m) => m.isMesh && s.add(matName({ object: m })));
    return [...s].join(', ');
  };
  check('the railing kinds: glass + black steel (B), wood (C), steel bars (D, E), none on A\'s platting', /window-glass/.test(mats('B', 'b-balkong')) && /black-metal/.test(mats('B', 'b-balkong')) && /facade-wood-plain/.test(mats('C', 'c-terrasse')) && /black-metal/.test(mats('D', 'd-takterrasse')) && !/black-metal|window-glass|facade-wood/.test(mats('A', 'a-platting')), mats('A', 'a-platting'));
  check('the surfaces: terrassebord (deck-boards), fliser (tiles), betong (concrete)', /facade-deck-boards/.test(mats('C', 'c-terrasse')) && /^tiles|, tiles/.test(mats('D', 'd-takterrasse')) && /facade-concrete/.test(mats('E', 'e-platting')));
  const wedges = Object.values(H).flatMap((h) => h.R.colliders.filter((c) => c.isMesh && /^deck-wedge:/.test(c.name)));
  check('one invisible walking wedge per stair (3), not in the scene', wedges.length === 3 && wedges.every((w) => !w.visible && !w.parent));
  const boxes = H.C.R.colliders.filter((c) => c.isBox3);
  check('railings collide (Box3 pieces up to the handrail + 0.1)', boxes.length > 20 && boxes.some((b) => near(b.max.y, deck('C', 'c-terrasse').top + 1.0 + 0.1, 1e-6)));
}

section('Ingen flater i samme plan');
{
  // room-walls: the inner layers and the doors' linings (not the cladding's work); leaf: the door leaves; cover:
  // rooms.js's dark deck
  const skip = (m) => /^(cover:|room-walls:|leaf:)/.test(m.name);
  const bad = [];
  let tris = 0;
  for (const key of Object.keys(H)) {
    const r = await coplanarOverlaps(H[key].all, { skip, minArea: 2e-6 });
    tris += r.triangles;
    bad.push(...r.bad.map((x) => `${key}: ${x}`));
  }
  check(`no overlapping faces in one plane among ${tris} triangles of the cladding, trims, roofs and decks`, !bad.length, bad.slice(0, 12).join('\n         '));
}

section('Teksturene');
{
  const facade = new Map();
  const maps = new Set();
  for (const h of Object.values(H)) {
    h.all.traverse((m) => {
      if (!m.isMesh) return;
      for (const x of [].concat(m.material)) {
        if (!/^facade-/.test(x?.userData?.kind ?? '')) continue;
        facade.set(x.uuid, x);
        maps.add(x.map.uuid);
      }
    });
  }
  const sets = new Set([...facade.values()].map((x) => x.userData.set));
  check(`one cached texture set per kind / profile / module (${maps.size} sets for ${facade.size} materials: ${[...sets].join(', ')})`, maps.size === sets.size && [...facade.values()].every((x) => x.userData.cached));
  // build A again: the very same materials, no new textures
  const again = buildLayout(kledningSpec(kledningHus()[0].house), undefined, { devWarnings: false });
  const roots2 = createHouseRoots(again, [new THREE.Group()]);
  buildRooms({ scene: new THREE.Scene(), quality: {}, roots: roots2 }, again, null);
  const ids2 = new Set();
  for (const g of Object.values(roots2.levels)) g.traverse((m) => m.isMesh && [].concat(m.material).forEach((x) => /^facade-/.test(x?.userData?.kind ?? '') && ids2.add(x.uuid)));
  check('a second build of A uses the same material instances (cached, not one per wall or per build)', ids2.size > 0 && [...ids2].every((id) => facade.has(id)));
}

section('Gangtesten (PlayerController + CollisionWorld)');
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);
function world(key, ground) {
  const col = new CollisionWorld();
  for (const c of H[key].R.colliders) {
    if (c.isBox3) col.addStaticBox(c);
    else col.addStatic(c);
  }
  for (const g of ground) col.addStaticBox(g);
  col.build();
  col.setBounds(-100, 200, -100, 100);
  return col;
}
const groundBox = (x0, x1, z0, z1, y) => new THREE.Box3(new THREE.Vector3(x0, y - 1, z0), new THREE.Vector3(x1, y, z1));
/** Walk from p (feet) along the plan direction dir for at most `secs`, stop past `until(pos)`. */
function drive(col, p, dir, { hz = 60, secs = 12, until = () => false } = {}) {
  const input = { move: { forward: 1, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const events = [];
  const player = new PlayerController({ camera: new THREE.PerspectiveCamera(), collision: col, input, settings: { get: () => undefined }, events: { emit: (name, data) => events.push({ name, data }) } });
  const yaw = yawToward(dir[0], dir[1]);
  player.teleport(new THREE.Vector3(...p), yaw, 0);
  input.move.forward = 0;
  for (let i = 0; i < 12; i++) player.update(1 / hz);
  input.move.forward = 1;
  events.length = 0;
  let air = 0, frames = 0;
  for (let i = 0; i < secs * hz; i++) {
    player.yaw = yaw;
    player.update(1 / hz);
    frames++;
    if (!player.onGround) air++;
    if (until(player.position)) break;
  }
  const hard = events.filter((e) => e.name === 'land' && (e.data?.speed ?? 0) > 1.5).length;
  return { pos: player.position.clone(), air: air / frames, hard, t: frames / hz };
}
const STAIRS = [
  { key: 'A', id: 'a-veranda', ground: [groundBox(-10, 20, -10, 15, -0.15)] },
  { key: 'C', id: 'c-terrasse', ground: [groundBox(20, 45, -15, 0, -2.85), groundBox(20, 45, 0, 15, -0.15)] },
  { key: 'E', id: 'e-platting', ground: [groundBox(45, 65, -10, 15, -0.15)] },
];
for (const { key, id, ground } of STAIRS) {
  const d = deck(key, id);
  const s = d.stairs[0];
  const col = world(key, ground);
  const fails = [];
  for (const hz of [30, 60, 144]) {
    for (const dir of ['up', 'down']) {
      const up = dir === 'up';
      const u0 = up ? s.reach + 1.0 : -1.0;
      const p = [s.origin[0] + s.out[0] * u0, up ? s.bottom : s.top, s.origin[1] + s.out[1] * u0];
      const along = up ? [-s.out[0], -s.out[1]] : s.out;
      const uOf = (q) => (q.x - s.origin[0]) * s.out[0] + (q.z - s.origin[1]) * s.out[1];
      const r = drive(col, p, along, { hz, until: (q) => (up ? uOf(q) < -0.7 : uOf(q) > s.reach + 0.8) });
      const want = up ? s.top : s.bottom;
      const ok = near(r.pos.y, want, 0.02) && r.air < 0.02 && !r.hard;
      if (!ok) fails.push(`${hz} Hz ${up ? 'opp' : 'ned'}: y ${f3(r.pos.y)} (skal ${f3(want)}), i lufta ${(r.air * 100).toFixed(1)} %, harde landinger ${r.hard}, ${f2(r.t)} s`);
    }
  }
  check(`${id}: ${s.risers} opptrinn opp og ned ved 30, 60 og 144 Hz – fram, på bakken, ingen harde landinger`, !fails.length, fails.join(' | '));
}
{
  // into the railing: B's balcony (walk south from the door), E's platting (walk east, away from the stair)
  const b = deck('B', 'b-balkong');
  const rb = drive(world('B', [groundBox(5, 30, -10, 15, -0.15)]), [18.7, b.top, -0.4], [0, -1], { secs: 4 });
  check(`B: walking into the glass railing for 4 s the player stays on the balcony (y ${f3(rb.pos.y)}, z ${f3(rb.pos.z)} > −1.5)`, near(rb.pos.y, b.top, 0.02) && rb.pos.z > -1.5);
  const e = deck('E', 'e-platting');
  const re = drive(world('E', [groundBox(45, 65, -10, 15, -0.15)]), [56, e.top, 1.0], [1, 0], { secs: 4 });
  check(`E: walking into the steel railing the player stays on the platting (y ${f3(re.pos.y)}, x ${f3(re.pos.x)} < 58.5)`, near(re.pos.y, e.top, 0.02) && re.pos.x < 58.5);
  // off a low deck without a railing: A's platting (0.13 over the ground) – down onto the ground, no hard landing
  const p = deck('A', 'a-platting');
  const ra = drive(world('A', [groundBox(-10, 20, -10, 15, -0.15)]), [11, p.top, 3], [1, 0], { secs: 3, until: (q) => q.x > 14 });
  check(`A: off the platting without a railing (fall ${f2(p.top - p.groundY)}): onto the ground, no hard landing`, near(ra.pos.y, -0.15, 0.02) && !ra.hard, `y ${f3(ra.pos.y)}, hard ${ra.hard}`);
}

section('Validatoren');
{
  // the game's schema (topLevel with cladding and decks) and its pseudo room 'ute' – not the owner's frozen ids
  const full = house.loadRegistry();
  const reg = { schema: full.schema, pseudoRooms: full.pseudoRooms };
  const v = (spec) => house.validateHouse(spec, { registry: reg, throw: false });
  const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  const all = kledningHus();
  const res = all.map((h) => ({ key: h.key, r: v(kledningSpec(h.house)) }));
  check('the five test houses validate (schema.topLevel has cladding and decks; no errors, no warnings)', res.every(({ r }) => !errs(r).length && !r.warnings.length), res.flatMap(({ key, r }) => [...errs(r), ...r.warnings].map((m) => `${key}: ${m}`)).slice(0, 8).join('\n         '));
  /** validate the spec of test house k after f(spec) */
  const withK = (k) => (f) => {
    const spec = kledningSpec(JSON.parse(JSON.stringify(all[k].house)));
    f(spec);
    return v(spec);
  };
  const withA = withK(0), withB = withK(1);
  const has = (r, re, kind = 'errors') => (kind === 'errors' ? errs(r) : r.warnings).some((m) => re.test(m));
  check('cladding errors reach validateHouse (an unknown type in a zone)', has(withA((h) => (h.cladding.zones[0].type = 'vinyl')), /cladding.zones\/gavl-plater: type «vinyl»/));
  check('a gable zone without a gabled roof is a warning', has(withB((h) => h.cladding.zones.push({ id: 'gavl', gable: true, type: 'panels' })), /cladding.zones\/gavl: gable, men intet saltak eller pulttak/, 'warnings'));
  check('cladding together with facadeSegments is a warning (cladding wins)', has(withA((h) => (h.facadeSegments = [{ id: 'f-a', wallIds: ['w-a1-s'], material: 'cladding' }])), /cladding: huset har også facadeSegments/, 'warnings'));
  check('deck errors: an unknown kind, a bad outline, a stair against the house, a stair off its edge, a bad railing edge', [
    has(withA((h) => (h.decks[0].kind = 'pier')), /decks\/a-veranda: kind «pier»/),
    has(withA((h) => (h.decks[0].outline = [[0, 0], [1, 0]])), /decks\/a-veranda: outline må være minst tre punkter/),
    has(withA((h) => (h.decks[0].stairs = [{ edge: 3 }])), /stairs\[0\]: kant 3 står mot huset/),
    has(withA((h) => (h.decks[0].stairs = [{ edge: 1, at: 2.5, width: 1.4 }])), /stairs\[0\]: trappa .* går utenfor kanten/),
    has(withA((h) => (h.decks[0].railing.edges = [7])), /railing.edges må være kantnumre 0–3/),
  ].every(Boolean));
  check('deck warnings: fall over 0.5 without a railing (TEK17), a deck into a room, a balcony not on the house', [
    has(withB((h) => (h.decks[0].railing = { type: 'none' })), /en fri kant har mer enn 0.5 m fall uten rekkverk/, 'warnings'),
    has(withA((h) => (h.decks[1].outline = [[9, 1.2], [12.6, 1.2], [12.6, 6.4], [9, 6.4]])), /outline går .* m² inn i et rom/, 'warnings'),
    has(withB((h) => (h.decks[0].outline = [[16.6, -0.5], [16.6, -1.5], [21, -1.5], [21, -0.5]])), /ingen kant står mot huset/, 'warnings'),
  ].every(Boolean));
  check('an unknown top-level key is still an error', has(withA((h) => (h.claddings = {})), /ukjent toppnøkkel «claddings»/));
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no cladding and no decks (spec.cladding / spec.decks are absent)', OH.cladding === null && OH.decks.length === 0 && OH.walkRects.length === OH.levels.length);
  const fp = ownerFingerprint();
  console.log(`       fingeravtrykk: layout ${fp.layout}, rooms ${fp.rooms} (${fp.meshes} mesher) – notes/kledning.md har verdiene før og etter`);
  check('the owner\'s rooms use none of the new materials (facade-*, deck)', (() => {
    const roots = createHouseRoots(ownerLayout, [new THREE.Group()]);
    buildRooms({ scene: new THREE.Scene(), quality: {}, roots, collision: { addSurfaceZone() {}, addDynamicBox: (b) => ({ box: b }), removeDynamic() {} } }, ownerLayout, null);
    let bad = 0;
    for (const g of Object.values(roots.levels)) g.traverse((m) => m.isMesh && ([].concat(m.material).some((x) => /^facade-/.test(x?.userData?.kind ?? '')) || /^deck/.test(m.name)) && bad++);
    return bad === 0;
  })());
}

done();
