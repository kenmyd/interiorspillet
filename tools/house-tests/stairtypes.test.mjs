#!/usr/bin/env node
/**
 * Node test for the stair types (notes/trapper.md; src/home/stairtypes.js, src/home/stairs.js, src/home/layout.js,
 * validateHouse in src/data/scripts/house.mjs, the climbs of src/core/Collision.js) on the test house
 * tools/trapper/testhus.mjs (five stairs: straight with computed risers, straight with closed risers and glass, an L
 * with winders, an L with a landing, a steep stair):
 *
 *   node tools/house-tests/stairtypes.test.mjs [--verbose]
 *
 *   • the owner's stair is unchanged: the fingerprint of tools/house-tests/stair-owner-snapshot.mjs (every number of
 *     stairLayout, the built geometry, the colliders, the layout's surface, the validator's report) equals
 *     tools/house-tests/fixtures/stair-owner.json;
 *   • validateHouse: the test house has no errors or warnings; risers left out are 2R + G ≈ 0,62; a stair steeper than
 *     the player walks is an error (a warning when estimated), a steep stair is judged by its own norms; unknown types
 *     and a half-turn stair without risers are errors;
 *   • the geometry: risers × riser = the rise, a tread per going, the treads inside the footprint and not overlapping,
 *     equal goings on the walk line, the L's winders balanced (no inner going under 8 cm), one landing, the straight
 *     stair with a rectangular footprint (forespørsel 6) and with its edges listed either way;
 *   • the options: closed risers, glass, hang 0 (no post below the floor; F12, F21, F42), mount 'edge';
 *   • no two faces of the stairs and the rooms lie in one plane facing the same way (they would flicker);
 *   • the walk: the game's PlayerController and CollisionWorld (the steep stair on its climb) down and up every stair at
 *     30, 60 and 144 Hz walking, and running and crouched at 60 Hz: it arrives at the other floor (± 2 cm), is airborne
 *     in < 2 % of the frames, no hard landing, the capsule stays out of the slab and the guards; standing still in the
 *     middle of each stair for 2 s it does not slide.
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';
import { ownerFingerprint } from './stair-owner-snapshot.mjs';

const VERBOSE = process.argv.includes('--verbose');
const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { stairLayout, stairColliders, slabColliders, buildStairs, pointInPolygon, distToPolygon, signedArea } = await imp('src/home/stairs.js');
const T = await imp('src/home/stairtypes.js');
const H = await imp('src/data/scripts/house.mjs');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController, MOVE } = await imp('src/player/PlayerController.js');
const { PLAYER } = await imp('src/config.js');
const { testHouse, testHouseSpec, STAIRS } = await imp('tools/trapper/testhus.mjs');

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const quiet = (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = w;
  }
};

// ---------------------------------------------------------------------------------------------------------------
section('Eierens trapp er uendret (stair-owner-snapshot.mjs mot fixtures/stair-owner.json)');
{
  const want = readJson('tools/house-tests/fixtures/stair-owner.json');
  const got = await ownerFingerprint();
  const diff = Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
  check(`alle ${Object.keys(want).length} fingeravtrykk er like (stairLayout, geometrien, kollisjonen, layout, validatoren)`, !diff.length, diff.join(', '));
}

// ---------------------------------------------------------------------------------------------------------------
section('Validatoren');
const house = testHouse();
const ids = readJson('research/house/00-ids.json');
const registry = { levels: { hoved: { name: 'Hovedetasje', floorY: 0 }, kjeller: { name: 'Kjeller', floorY: -2.6 } }, rooms: Object.fromEntries(house.rooms.map((r) => [r.id, { levelId: r.levelId, kind: r.kind }])), pseudoRooms: ['ute'], lightGroups: {}, schema: ids.schema };
const validate = (h) => {
  const rep = quiet(() => H.validateHouse(testHouseSpec(h), { registry, archetypes: { archetypes: {}, archetypeAliases: {} }, throw: false }));
  return { ...rep, errors: rep.errors.filter((e) => !/rommet «stue-kjokken» mangler/.test(e)) };
};
const rep = validate(house);
check('testhuset: ingen feil', !rep.errors.length, rep.errors.join(' | '));
check('testhuset: ingen advarsler', !rep.warnings.length, rep.warnings.join(' | '));
const vr = Object.fromEntries(rep.stairs.map((s) => [s.id, s]));
check('trapp-rett uten risers: 14 opptrinn fra 2R + G ≈ 0,62', vr['trapp-rett']?.risers === 14 && vr['trapp-rett'].risersComputed && near(vr['trapp-rett'].twoRG, 0.62, 0.01), `${vr['trapp-rett']?.risers}, 2R+G ${f3(vr['trapp-rett']?.twoRG)}`);
for (const id of ['trapp-rett', 'trapp-tett', 'trapp-l-sving', 'trapp-l-repos']) check(`${id}: 2R + G ${f3(vr[id]?.twoRG)} i 0,60–0,64, ganglinja ${f2(vr[id]?.walkDeg)}° ≤ ${T.WALK_MAX_DEG}°`, vr[id] && vr[id].twoRG >= 0.6 && vr[id].twoRG <= 0.64 && vr[id].walkDeg <= T.WALK_MAX_DEG);
check('trapp-l-repos: inntrinnet er løpenes (reposet regnes ikke med)', vr['trapp-l-repos'] && near(vr['trapp-l-repos'].going, 0.25, 0.01), f3(vr['trapp-l-repos']?.going));
check(`trapp-bratt: ${vr['trapp-bratt']?.risers} opptrinn à ${f3(vr['trapp-bratt']?.riser)} ≤ ${T.STEEP.riserMax}, ${f2(vr['trapp-bratt']?.slopeDeg)}° ≥ ${T.STEEP.minDeg}, rampa ${f2(vr['trapp-bratt']?.walkDeg)}° ≤ ${T.STEEP.maxRampDeg}`, vr['trapp-bratt'] && vr['trapp-bratt'].riser <= T.STEEP.riserMax && vr['trapp-bratt'].slopeDeg >= T.STEEP.minDeg && vr['trapp-bratt'].walkDeg <= T.STEEP.maxRampDeg);
{
  // the steep stair's hole with an ordinary straight stair: too steep to walk
  const h = testHouse();
  const st = h.stairs.find((s) => s.id === 'trapp-bratt');
  st.type = 'straight';
  const r1 = validate(h);
  check('en rett trapp i den bratte trappas hull: «for bratt å gå i» er en feil', r1.errors.some((e) => /trapp-bratt: trappa er for bratt å gå i/.test(e)), r1.errors.join(' | '));
  st.estimated = ['top', 'foot'];
  const r2 = validate(h);
  check('… og en advarsel når top/foot er anslått', !r2.errors.some((e) => /for bratt å gå i/.test(e)) && r2.warnings.some((w) => /for bratt å gå i.*anslått/.test(w)), r2.warnings.join(' | '));
  // a steep stair steeper than the climb works (its foot 0,55 m nearer the top: a 70° ramp)
  const h5 = testHouse();
  h5.stairs.find((x) => x.id === 'trapp-bratt').foot.edge = [[15.0, 1.95], [15.7, 1.95]];
  const r5 = validate(h5);
  check('en bratt trapp med rampe over 68°: «for bratt å klatre» er en feil', r5.errors.some((e) => /trapp-bratt: den bratte trappa er for bratt å klatre/.test(e)), r5.errors.join(' | '));
  const h3 = testHouse();
  h3.stairs.find((s) => s.id === 'trapp-tett').type = 'spiral';
  check('ukjent trappetype er en feil', validate(h3).errors.some((e) => /ukjent trappetype «spiral»/.test(e)));
  const h4 = testHouse();
  const u = h4.stairs.find((s) => s.id === 'trapp-tett');
  u.type = 'half-turn-winder';
  delete u.risers;
  check('en halvsvingt trapp uten risers er en feil (som før)', validate(h4).errors.some((e) => /trapp-tett: risers må være et heltall/.test(e)));
}

// ---------------------------------------------------------------------------------------------------------------
section('Geometrien');
const layout = quiet(() => buildLayout(testHouseSpec(), undefined, { devWarnings: false }));
const HL = layout.house;
const lays = Object.fromEntries(HL.stairs.map((st) => [st.id, quiet(() => stairLayout(st, HL.levels))]));
const overlapPoly = (a, b) => {
  // convex a ∩ convex b (Sutherland–Hodgman), both counter-clockwise
  let out = a;
  for (let i = 0; i < b.length && out.length; i++) {
    const p = b[i];
    const q = b[(i + 1) % b.length];
    const side = (v) => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const c = inp[j];
      const d = inp[(j + 1) % inp.length];
      const sc = side(c);
      const sd = side(d);
      if (sc >= 0) out.push(c);
      if (sc * sd < 0) {
        const t = sc / (sc - sd);
        out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]);
      }
    }
  }
  return out;
};
const overlapArea = (a, b) => {
  const out = overlapPoly(a, b);
  return out.length >= 3 ? Math.abs(signedArea(out)) : 0;
};
const ccwPoly = (p) => (signedArea(p) < 0 ? [...p].reverse() : p);
for (const id of STAIRS) {
  const lay = lays[id];
  const rise = lay.topY - lay.bottomY;
  check(`${id} (${lay.type}): ${lay.risers} opptrinn × ${f3(lay.riser)} = ${f2(rise)}, ${lay.treads.length} trinn`, near(lay.risers * lay.riser, rise, 1e-9) && lay.treads.length === lay.risers - 1);
  const fp = lay.footprint;
  const outside = lay.treads.flatMap((t) => t.polygon).find((p) => !pointInPolygon(p, fp) && distToPolygon(p, fp) > 0.035);
  check(`${id}: trinnene ligger i fotavtrykket`, !outside, outside && `(${f3(outside[0])}; ${f3(outside[1])})`);
  // treads: convex pieces of the plates; winders can be concave around a corner → compare their triangles
  let worst = 0;
  for (let i = 0; i < lay.treads.length; i++) {
    for (let j = i + 1; j < lay.treads.length; j++) {
      const a = lay.treads[i].polygon;
      const b = lay.treads[j].polygon;
      const ta = THREE.ShapeUtils.triangulateShape(a.map((p) => new THREE.Vector2(...p)), []).map((t) => ccwPoly(t.map((k) => a[k])));
      const tb = THREE.ShapeUtils.triangulateShape(b.map((p) => new THREE.Vector2(...p)), []).map((t) => ccwPoly(t.map((k) => b[k])));
      for (const x of ta) for (const y of tb) worst = Math.max(worst, overlapArea(x, y));
    }
  }
  check(`${id}: trinnene overlapper ikke (største ${(worst * 1e4).toFixed(2)} cm²)`, worst < 5e-4);
  const gs = lay.treads.filter((t) => !t.landing).map((t) => t.going);
  check(`${id}: like inntrinn på ganglinja (${f3(Math.min(...gs))}–${f3(Math.max(...gs))})`, Math.max(...gs) - Math.min(...gs) < 0.005);
}
{
  const l = lays['trapp-l-sving'];
  const winders = l.treads.filter((t) => t.kind === 'winder');
  const minIn = Math.min(...l.treads.map((t) => t.innerGoing));
  check(`trapp-l-sving: ${winders.length} svingtrinn rundt hjørnet, balansert (minste inntrinn ved den indre vangen ${f3(minIn)} ≥ 0,08)`, winders.length >= 4 && minIn >= 0.08);
  const r = lays['trapp-l-repos'];
  const landing = r.treads.filter((t) => t.landing);
  check(`trapp-l-repos: ett repos (trinn ${landing[0]?.k}) som fyller hjørnet (${f2(landing[0] ? Math.abs(signedArea(landing[0].polygon)) : 0)} m²)`, landing.length === 1 && Math.abs(signedArea(landing[0].polygon)) > 0.7);
  check('trapp-l-repos: rampa er vannrett over reposet', near(r.rampY(r.plan.L1 + 0.05), r.rampY(r.plan.L1 + r.plan.La - 0.05), 1e-9));
  check('trapp-bratt: klatres (lay.climb), kilen går ikke i octreet', !!lays['trapp-bratt'].climb && stairColliders(lays['trapp-bratt'])[0].userData.climb === lays['trapp-bratt'].climb);
}
{
  // forespørsel 6: a straight stair whose footprint is the rectangular hole – and its foot edge listed the other way
  const st = HL.stairs.find((s) => s.id === 'trapp-rett');
  const raw = { ...house.stairs.find((s) => s.id === 'trapp-rett'), footprint: house.floorOpenings[0].polygon };
  const a = quiet(() => stairLayout(raw, HL.levels));
  const b = quiet(() => stairLayout({ ...raw, foot: { ...raw.foot, edge: [...raw.foot.edge].reverse() }, top: { ...raw.top, edge: [...raw.top.edge].reverse() } }, HL.levels));
  check(`rett trapp med rektangulært fotavtrykk (hullet): ${a.treads.length} trinn og ${stairColliders(a).length} kolliderere (forespørsel 6)`, a.treads.length === 13 && stairColliders(a).length > 10);
  check('… og like trinn når kantene er listet motsatt vei', b.treads.length === 13 && near(b.treads[5].going, a.treads[5].going, 1e-9) && near(Math.abs(signedArea(b.treads[5].polygon)), Math.abs(signedArea(a.treads[5].polygon)), 1e-9));
  check('layout: den rette trappas fotavtrykk er hullet, flata følger rampa', st.footprint.length === 4 && near(st.surfaceY(1.45, 2.62), a.rampY(a.walk.param([1.45, 2.62])), 1e-6));
}

// ---------------------------------------------------------------------------------------------------------------
section('Valgene: tette opptrinn, glass, stolpene ved gulvet, på kanten');
const roots = createHouseRoots(layout, [new THREE.Group()]);
const ctx = { scene: new THREE.Scene(), quality: {}, roots, collision: { addSurfaceZone() {}, addDynamicBox: (b) => ({ box: b.clone(), enabled: true }), removeDynamic() {} } };
const R = quiet(() => buildRooms(ctx, layout, null));
const S = quiet(() => buildStairs(ctx, layout));
const meshesOf = (id) => {
  const out = [];
  for (const lv of Object.values(roots.levels)) lv.traverse((o) => o.isMesh && o.name.endsWith(`:${id}`) && out.push(o));
  return out;
};
check('trapp-tett: tette opptrinn (stair-risers, ett per trinn) og glass (stair-glass)', meshesOf('trapp-tett').some((m) => m.name.startsWith('stair-risers:')) && lays['trapp-tett'].riserBoards.length === 13 && meshesOf('trapp-tett').some((m) => m.name.startsWith('stair-glass:')));
check('trapp-rett: åpne opptrinn (ingen stair-risers)', !meshesOf('trapp-rett').some((m) => m.name.startsWith('stair-risers:')));
{
  // hang 0: no steel below the floor in the upper guards' posts (F12, F21, F42): the post centres as buildStairs puts
  // them (a free end half a post along the line, a shared one where the shifted lines meet)
  const postCentres = (lay) => {
    const out = [];
    for (const g of lay.guards) {
      const [a, b] = g.line;
      const d = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])];
      for (const [p, raw, k] of [[a, g.raw[0], 1], [b, g.raw[1], -1]]) {
        const other = lay.guards.find((o) => o !== g && o.raw.some((q) => Math.hypot(q[0] - raw[0], q[1] - raw[1]) < 0.02));
        if (!other) out.push([p[0] + (d[0] * k * g.post) / 2, p[1] + (d[1] * k * g.post) / 2]);
        else {
          const e = [other.line[1][0] - other.line[0][0], other.line[1][1] - other.line[0][1]];
          const den = d[0] * e[1] - d[1] * e[0];
          const w = [other.line[0][0] - a[0], other.line[0][1] - a[1]];
          const t = (w[0] * e[1] - w[1] * e[0]) / den;
          out.push([a[0] + d[0] * t, a[1] + d[1] * t]);
        }
      }
    }
    return out;
  };
  const lowNearEdge = (id) => {
    const lay = lays[id];
    const posts = postCentres(lay);
    const steel = meshesOf(id).find((m) => m.name.startsWith('stair-steel:'));
    const pos = steel.geometry.attributes.position.array;
    let low = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      if (!posts.some((c) => Math.abs(pos[i] - c[0]) < 0.0315 && Math.abs(pos[i + 2] - c[1]) < 0.0315)) continue;
      low = Math.min(low, pos[i + 1]);
    }
    return low;
  };
  check(`trapp-rett (hang 0): stolpene ved hullet slutter ved gulvet (lavest ${f3(lowNearEdge('trapp-rett'))})`, lowNearEdge('trapp-rett') >= -1e-6);
  // the same stair with the default: the posts over the stair hang 0.45 below the floor (the owner's detail)
  const h = testHouse();
  delete h.stairs[0].guardStyle.hang;
  const L2 = quiet(() => buildLayout(testHouseSpec(h), undefined, { devWarnings: false }));
  const roots2 = createHouseRoots(L2, [new THREE.Group()]);
  quiet(() => buildStairs({ scene: new THREE.Scene(), quality: {}, roots: roots2 }, L2));
  let low = Infinity;
  roots2.levels.hoved.traverse((o) => {
    if (!o.isMesh || o.name !== 'stair-steel:trapp-rett') return;
    const pos = o.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - 4.3) < 0.07 && pos[i + 1] > -0.6) low = Math.min(low, pos[i + 1]);
  });
  check(`uten hang: stolpene over trappa henger 0,45 under gulvet som før (lavest ${f3(low)})`, near(low, -0.45, 1e-6));
  // mount 'edge': the guard line 3 mm off the hole's edge, into the hole
  const g = lays['trapp-tett'].guards[0];
  const hole = lays['trapp-tett'].stair.holePolygon;
  const m = [(g.line[0][0] + g.line[1][0]) / 2, (g.line[0][1] + g.line[1][1]) / 2];
  check(`trapp-tett (mount 'edge'): rekkverkslinja står i hullet, ${f3(distToPolygon(m, hole))} fra kanten (stolpe/2 + 3 mm)`, pointInPolygon(m, hole) && near(distToPolygon(m, hole), 0.065 / 2 + 0.003, 1e-6));
  check('trapp-tett: trapperekkverket stopper under etasjeskillet der et rekkverk på gulvet går langs samme side', lays['trapp-tett'].sideGuards.every((sg) => sg.covered && Math.max(...sg.rail.map((q) => q.y)) < -0.3));
}

// ---------------------------------------------------------------------------------------------------------------
section('Ingen flater i samme plan (de ville flimret)');
{
  // every triangle of the stairs and the rooms; two facing the same way in one plane (± 0,6 mm) that overlap
  const tris = [];
  const grab = (root, part) =>
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let t = 0; t < n; t += 3) {
        for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
        const nn = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
        const area = nn.length() / 2;
        if (area < 1e-6) continue;
        nn.normalize();
        tris.push({ part, name: o.name, n: nn, d: nn.dot(v[0]), p: v.map((x) => x.clone()) });
      }
    });
  for (const lv of Object.values(roots.levels)) {
    lv.traverse((o) => {
      if (/^stair:/.test(o.name)) grab(o, 'stair');
    });
  }
  const stairRoots = new Set();
  for (const lv of Object.values(roots.levels)) lv.traverse((o) => /^stair:/.test(o.name) && stairRoots.add(o));
  for (const lv of Object.values(roots.levels)) {
    lv.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (stairRoots.has(p)) return;
      grab({ traverse: (fn) => fn(o) }, 'room');
    });
  }
  if (R.group) grab(R.group, 'room');
  const buckets = new Map();
  const key = (t) => {
    const n = t.n;
    return `${Math.round(n.x * 200)},${Math.round(n.y * 200)},${Math.round(n.z * 200)}`;
  };
  for (const t of tris) {
    if (t.part !== 'stair' && !tris.length) continue;
    const k = key(t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const project = (t) => {
    const a = Math.abs(t.n.x) > Math.abs(t.n.y) ? (Math.abs(t.n.x) > Math.abs(t.n.z) ? 'x' : 'z') : Math.abs(t.n.y) > Math.abs(t.n.z) ? 'y' : 'z';
    const [u, w] = a === 'x' ? ['y', 'z'] : a === 'y' ? ['x', 'z'] : ['x', 'y'];
    return ccwPoly(t.p.map((q) => [q[u], q[w]]));
  };
  // a face whose front (2 mm out along its normal) lies inside the slab or under the basement floor is never seen:
  // the stringers' ends and the nosing list against the hole's edge, the undersides of posts standing on a floor
  const slabs = slabColliders(layout, 'hoved').filter((b) => near(b.max.y, 0, 1e-6) && near(b.max.y - b.min.y, 0.3, 1e-6));
  const hidden = (t, ov) => {
    const ax = Math.abs(t.n.x) > Math.abs(t.n.y) ? (Math.abs(t.n.x) > Math.abs(t.n.z) ? 'x' : 'z') : Math.abs(t.n.y) > Math.abs(t.n.z) ? 'y' : 'z';
    const [u, w] = ax === 'x' ? ['y', 'z'] : ax === 'y' ? ['x', 'z'] : ['x', 'y'];
    const c = ov.reduce((acc, q) => [acc[0] + q[0] / ov.length, acc[1] + q[1] / ov.length], [0, 0]);
    const p = new THREE.Vector3();
    p[u] = c[0];
    p[w] = c[1];
    p[ax] = (t.d - t.n[u] * c[0] - t.n[w] * c[1]) / t.n[ax];
    p.addScaledVector(t.n, 0.002);
    return p.y < -2.6 || slabs.some((b) => b.containsPoint(p));
  };
  const hits = [];
  for (const list of buckets.values()) {
    const stairs = list.filter((t) => t.part === 'stair');
    if (!stairs.length) continue;
    list.sort((a, b) => a.d - b.d);
    for (const a of stairs) {
      const pa = project(a);
      for (const b of list) {
        if (b === a || Math.abs(b.d - a.d) > 0.0006 || (b.part === 'stair' && b.name === a.name && tris.indexOf(b) < tris.indexOf(a))) continue;
        if (a.n.dot(b.n) < 0.9999) continue;
        const ov = overlapPoly(pa, project(b));
        const area = ov.length >= 3 ? Math.abs(signedArea(ov)) : 0;
        if (area <= 2e-6 || hidden(a, ov)) continue;
        hits.push(`${a.name} / ${b.name} (n ${f2(a.n.x)},${f2(a.n.y)},${f2(a.n.z)}, d ${f3(a.d)}, ${(area * 1e4).toFixed(2)} cm²)`);
      }
    }
  }
  const uniq = [...new Set(hits)];
  check(`${tris.filter((t) => t.part === 'stair').length} trekanter i trappene mot ${tris.filter((t) => t.part === 'room').length} i rommene: ingen i samme plan og retning som overlapper`, !uniq.length, uniq.slice(0, VERBOSE ? 400 : 6).join(' | '));
}

// ---------------------------------------------------------------------------------------------------------------
section('Gangtesten (PlayerController + CollisionWorld)');
const levelBoxes = slabColliders(layout, 'hoved');
// the basement floor, and the main floor's ceiling over the holes (the room builder's colliders are the floors' meshes,
// not Node-testable here; the slab boxes are the main floor)
const basement = new THREE.Box3(new THREE.Vector3(-0.5, -2.9, -0.5), new THREE.Vector3(18, -2.6, 6));
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);
function world(lay) {
  const col = new CollisionWorld();
  for (const c of [...stairColliders(lay), ...levelBoxes, basement]) {
    if (c.isBox3) col.addStaticBox(c);
    else col.addStatic(c);
  }
  col.build();
  col.setBounds(-0.45, 17.95, -0.45, 5.95);
  return col;
}
function capsulePenetration(cap, boxes) {
  // the deepest the capsule reaches into a box (radius − distance from its axis), sampled along the axis
  let worst = -Infinity;
  const c = new THREE.Vector3();
  for (let k = 0; k <= 12; k++) {
    c.copy(cap.start).lerp(cap.end, k / 12);
    for (const b of boxes) worst = Math.max(worst, cap.radius - b.distanceToPoint(c));
  }
  return worst;
}
function drive(lay, col, { hz, dir, gait = 'walk', stopAtU = null, hold = 2 }) {
  const input = { move: { forward: 0, right: 0 }, running: gait === 'run', crouch: gait === 'crouch', jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const events = [];
  const player = new PlayerController({ camera: new THREE.PerspectiveCamera(), collision: col, input, settings: { get: () => undefined }, events: { emit: (name, data) => events.push({ name, data }) } });
  const L = lay.walk.length;
  const down = dir === 'down';
  const sign = down ? 1 : -1;
  const s = down ? lay.walk.at(-0.9).p : lay.walk.at(L + 0.8).p;
  const near2 = (x, z, around) => {
    let best = around;
    let bd = Infinity;
    for (let u = around - 0.6; u <= around + 0.6; u += 0.005) {
      const p = lay.walk.at(u).p;
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  };
  let u = down ? -0.9 : L + 0.8;
  const look = lay.walk.at(u + sign * 0.3).p;
  player.teleport(new THREE.Vector3(s[0], down ? lay.topY : lay.bottomY, s[1]), yawToward(look[0] - s[0], look[1] - s[1]), 0);
  for (let i = 0; i < 12; i++) player.update(1 / hz);
  events.length = 0;
  input.move.forward = 1;
  const dt = 1 / hz;
  let air = 0;
  let frames = 0;
  let maxDy = 0;
  let pen = -Infinity;
  let stopped = null;
  let drift = 0;
  const obstacles = levelBoxes;
  for (let i = 0; i < 20 * hz; i++) {
    const p0 = player.position.clone();
    u = near2(p0.x, p0.z, u);
    if (!stopped) {
      const tgt = lay.walk.at(u + sign * 0.3).p;
      const on = lay.walk.at(u).p;
      player.yaw = yawToward(tgt[0] + (on[0] - p0.x) - p0.x, tgt[1] + (on[1] - p0.z) - p0.z);
    }
    if (stopAtU != null && !stopped && sign * (u - stopAtU) >= 0) {
      input.move.forward = 0;
      stopped = { i, pos: null };
    }
    player.update(dt);
    frames++;
    if (!player.onGround) air++;
    maxDy = Math.max(maxDy, Math.abs(player.position.y - p0.y));
    pen = Math.max(pen, capsulePenetration(player.capsule, obstacles));
    if (stopped) {
      if (i - stopped.i === Math.round(0.5 * hz)) stopped.pos = player.position.clone();
      if (stopped.pos) drift = Math.max(drift, Math.hypot(player.position.x - stopped.pos.x, player.position.z - stopped.pos.z), Math.abs(player.position.y - stopped.pos.y));
      if (i - stopped.i >= Math.round(hold * hz)) break;
    } else if (sign * (u - (down ? L + 0.6 : -0.6)) >= 0) break;
  }
  const hard = events.filter((e) => e.name === 'land' && (e.data?.speed ?? 0) > 1.5).length;
  const toasts = events.filter((e) => e.name === 'toast').length;
  return { y: player.position.y, air: air / frames, maxDy, pen, hard, toasts, drift, t: frames * dt, u };
}
for (const id of STAIRS) {
  const lay = lays[id];
  const col = world(lay);
  if (id === 'trapp-bratt') check('trapp-bratt: kollisjonen har klatreflaten', col.climbs.length === 1);
  const runs = [];
  for (const hz of [30, 60, 144]) for (const dir of ['down', 'up']) runs.push({ hz, dir, gait: 'walk' });
  for (const gait of ['run', 'crouch']) for (const dir of ['down', 'up']) runs.push({ hz: 60, dir, gait });
  let fails = [];
  for (const r of runs) {
    const res = drive(lay, col, r);
    const want = r.dir === 'down' ? lay.bottomY : lay.topY;
    const ok = near(res.y, want, 0.02) && res.air < 0.02 && !res.hard && !res.toasts && res.pen <= 0.02;
    const line = `${r.hz} Hz ${r.gait} ${r.dir === 'down' ? 'ned' : 'opp'}: slutt-y ${f3(res.y)}, i lufta ${(res.air * 100).toFixed(1)} %, størst Δy ${f3(res.maxDy)}, inn i dekket/rekkverket ${f3(res.pen)}, ${f2(res.t)} s`;
    if (VERBOSE || !ok) console.log(`       ${id} ${line}`);
    if (!ok) fails.push(line);
  }
  check(`${id}: ned og opp ved 30, 60 og 144 Hz (gange), løp og huk ved 60 Hz – fram, på bakken, ingen harde landinger, ikke inn i dekket`, !fails.length, fails.join(' | '));
  // standing still in the middle
  const st = drive(lay, col, { hz: 60, dir: 'up', stopAtU: lay.walk.length / 2 });
  check(`${id}: stående midt i trappa i 2 s – glir ikke (${(st.drift * 1000).toFixed(1)} mm)`, st.drift < 0.01);
}

done();
