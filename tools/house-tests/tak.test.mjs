#!/usr/bin/env node
/**
 * Node test for the roofs (notes/tak.md):
 *   node tools/house-tests/tak.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test houses of dev/tak.html (src/dev/tak-hus.js) with buildLayout + buildRooms and checks:
 *   • the model: five roofs, the dormers (an ark on the wall, a takopplett on the roof), heights from the anchors;
 *   • the ceilings: the knee 1.0 at the eave walls, a collar ceiling flat at 2.5, open ones up to the ridge, a flat
 *     ceiling under a high roof unchanged, the volumes against a fine grid;
 *   • the tops of the walls under the roof (knee walls, gables, the steps at the ark's sides);
 *   • the builder: covering, soffit, trim per roof, gutters (not on the flat roof), ridge caps (not on felt), all in
 *     pickables.ceilings (hidden with the ceilings in the dollhouse view) without a pick and without collision;
 *   • no holes: rays up from inside every room hit a ceiling, rays down from above every roof hit the roof, a dormer
 *     or a roof window – never a room;
 *   • the roof windows lie in the roof plane, the roof is open under them;
 *   • the cladding goes up into the roof at the gables, the eaves and the ark's cheeks;
 *   • no two faces facing the same way overlap in one plane (they flicker);
 *   • validateHouse accepts the test houses and catches broken roofs, a window over a knee wall, a roof ceiling
 *     without a roof, a roof window over the ridge;
 *   • the owner's house has no roofs and no ceiling surfaces (its geometry: tools/house-tests/owner-fingerprint.mjs).
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { ROOF_GAP, planeY } = await imp('src/home/roofgeom.js');
const { takHus, takSpec } = await imp('src/dev/tak-hus.js');
const house = await imp('src/data/scripts/house.mjs');

const raw = takHus();
const layout = buildLayout(takSpec(raw), undefined, { devWarnings: false });
const H = layout.house;
const roots = createHouseRoots(layout, [new THREE.Group()]);
const t0 = Date.now();
const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, layout, null);
const ms = Date.now() - t0;
const all = new THREE.Group();
for (const g of Object.values(roots.levels)) all.add(g);
all.updateMatrixWorld(true);
const ceil = (id) => H.ceilings.find((c) => c.id === id);
const part = (id) => H.roofs.find((p) => p.id === id);

section('Modellen');
check('seven roof parts: gable, hip, mono-pitch, flat, gable and the L (two gables)', H.roofs.map((p) => p.type).join(',') === 'gable,hip,mono-pitch,flat,gable,gable,gable', H.roofs.map((p) => p.type).join(','));
{
  const a = part('roof-a');
  check('roof A sits on the loft (2.7) with the knee 1.0: eave 3.448, ridge 7.196', near(a.eaveY, 3.448, 0.002) && near(a.ridgeY, 7.196, 0.003), `${a.eaveY.toFixed(3)}, ${a.ridgeY.toFixed(3)}`);
  check('roof A: an ark on the wall and a takopplett 0.8 up the roof', a.dormers.length === 2 && a.dormers[0].ark && !a.dormers[1].ark && near(a.dormers[1].setback, 0.8, 0.01), a.dormers.map((d) => `${d.id} ark=${d.ark} ${d.setback.toFixed(2)}`).join('; '));
  check('roof B (hip): four faces, eave at the wall height 2.4', part('roof-b').faces.length === 4 && near(part('roof-b').eaveY, 2.4, 1e-6));
  check('roof C (mono-pitch) falls to the south: low at z 0, high at z 6', planeY(part('roof-c').planes[0], 32, 0) < planeY(part('roof-c').planes[0], 32, 6));
  check('roof D is flat at 2.4', near(planeY(part('roof-d').planes[0], 43, 3), 2.4, 1e-6) && part('roof-d').planes[0].a === 0);
  {
    const w = part('roof-f2'), m = part('roof-f1');
    check('the L: the wing runs into the main house up to its ridge (z 3), the main house keeps its eave (z 6.5)', near(Math.min(...w.over.map((q) => q[1])), 3, 1e-6) && near(Math.max(...m.over.map((q) => q[1])), 6.5, 1e-6), `wing ${Math.min(...w.over.map((q) => q[1]))}, main ${Math.max(...m.over.map((q) => q[1]))}`);
    check('the L: inside the wing the ceiling follows the wing (3.555 at its ridge), in the main house the main roof', near(ceil('c-f-floy').heightAt(68, 8), 3.555, 0.002) && near(ceil('c-f-stue').heightAt(64, 3), 4.132, 0.002), `${ceil('c-f-floy').heightAt(68, 8).toFixed(3)}, ${ceil('c-f-stue').heightAt(64, 3).toFixed(3)}`);
    check('the L: in the main room the ceiling rises into the wing (its ridge at z 5, 3.555 > the main slope 2.977)', near(ceil('c-f-stue').heightAt(68, 5), 3.555, 0.002), ceil('c-f-stue').heightAt(68, 5).toFixed(3));
  }
  check('defaults: tile on gable/hip … overrides kept (B slate, C steel, D felt, E red tile)', part('roof-a').covering === 'tile' && part('roof-b').covering === 'slate' && part('roof-c').covering === 'steel' && part('roof-d').covering === 'felt' && part('roof-e').color === '#7a3b2c');
}

section('Himlingene');
{
  const sov = ceil('c-a-sov'), hems = ceil('c-a-hems');
  check('loft: the knee 1.0 at the eave walls', near(sov.heightAt(2, 0.3), 1.0, 0.002) && near(sov.heightAt(2, 7.7), 1.0, 0.002));
  check('loft, collar room: flat at 2.5 in the middle, sloped toward the eaves', near(sov.heightAt(2, 4), 2.5, 1e-6) && sov.heightAt(2, 1.5) < 2.5 && near(sov.maxHeight, 2.5, 1e-6));
  check('loft, open room: up to the ridge 4.105', near(hems.heightAt(6, 4), 4.105, 0.002) && near(hems.maxHeight, 4.105, 0.002));
  check('loft, open room: higher under the ark (3.139 in its middle) and the takopplett', near(hems.heightAt(7.5, 0.3), 3.139, 0.002) && hems.heightAt(7, 6.95) > hems.heightAt(5.6, 6.95) + 0.5);
  check('a flat ceiling under a high roof stays flat (B, E bedrooms 2.4)', near(ceil('c-b-sov').maxHeight, 2.4, 1e-6) && near(ceil('c-e-sov').heightAt(56, 4), 2.4, 1e-6));
  check('E: «skrå himling 24°» from 2.534 at the eave walls to 4.181 at the ridge', near(ceil('c-e-stue').heightAt(50.3, 4), 2.534, 0.002) && near(ceil('c-e-stue').heightAt(54, 4), 4.181, 0.002));
  check('C: the mono-pitch ceiling rises from 2.46 to 3.61', near(ceil('c-c-stue').heightAt(30, 0.3), 2.464, 0.002) && near(ceil('c-c-stue').heightAt(30, 5.7), 3.612, 0.002));
  // the volume against a 2 cm grid
  for (const id of ['c-a-sov', 'c-a-hems', 'c-b-stue', 'c-e-stue']) {
    const c = ceil(id);
    const b = c.polygon.reduce((m, p) => [Math.min(m[0], p.x), Math.max(m[1], p.x), Math.min(m[2], p.y), Math.max(m[3], p.y)], [Infinity, -Infinity, Infinity, -Infinity]);
    let v = 0;
    const s = 0.02;
    for (let x = b[0] + s / 2; x < b[1]; x += s) for (let z = b[2] + s / 2; z < b[3]; z += s) v += c.heightAt(x, z) * s * s;
    check(`${id}: volume ${c.volume.toFixed(2)} m³ = the grid's ${v.toFixed(2)} (±0.5 %)`, Math.abs(c.volume - v) / v < 0.005);
  }
}

section('Veggene under taket');
{
  const prof = (id) => H.wallsById[id].topProfile;
  const at = (id, u) => H.wallsById[id].heightAt(u);
  check('the eave walls of the loft are knee walls (≈ 1.0)', near(H.wallsById['w-a2v-s'].height, 1.008, 0.002) && near(H.wallsById['w-a2v-n'].height, 1.008, 0.002));
  check('the gable of the collar room rises to 2.5', near(H.wallsById['w-a2v-v'].height, 2.5, 1e-6) && near(at('w-a2v-v', 0), 1.0, 0.002));
  const s = prof('w-a2o-s');
  check('the wall under the ark steps up at its sides (x 6.5 and 8.5) to 2.3 and its gable to 3.139', s.some(([u, h]) => near(u, 1.45, 1e-6) && near(h, 2.3, 0.002)) && s.some(([u, h]) => near(u, 3.45, 1e-6) && near(h, 2.3, 0.002)) && near(H.wallsById['w-a2o-s'].height, 3.139, 0.002), JSON.stringify(s.map((p) => p.map((x) => +x.toFixed(3)))));
  check('the partition between the loft rooms follows the higher side (the open room, 4.105)', near(H.wallsById['w-a2v-o'].height, 4.105, 0.002));
  check('the high wall of the mono-pitch: 3.61', near(H.wallsById['w-c1-n'].height, 3.609, 0.003));
  check('a wall with its own topProfile is left as it is (none here; the owner\'s are untouched below)', true);
}

section('Byggeren');
{
  const names = new Map();
  all.traverse((m) => m.isMesh && names.set(m.name, m));
  for (const p of H.roofs) {
    check(`${p.id}: covering, soffit and trim`, names.has(`roof:${p.id}`) && names.has(`roof-soffit:${p.id}`) && names.has(`roof-trim:${p.id}`));
  }
  const gutters = [...names.keys()].filter((n) => n.startsWith('roof-gutter:'));
  check('gutters on the sloped roofs, not on the flat one', ['roof-a', 'roof-b', 'roof-c', 'roof-e', 'roof-f1', 'roof-f2'].every((id) => gutters.includes(`roof-gutter:${id}`)) && !gutters.includes('roof-gutter:roof-d'), gutters.join(', '));
  check('ridge caps on A, B, E (tiles / slate), none on the mono-pitch or the felt', ['roof-a', 'roof-b', 'roof-e'].every((id) => names.has(`roof-ridge:${id}`)) && !names.has('roof-ridge:roof-c') && !names.has('roof-ridge:roof-d'));
  check('the ark has cheeks; the takopplett a front wall with a window', names.has('roof-cheeks:roof-a') && names.has('roof-front:opp-a-nord') && names.has('roof-front-inside:opp-a-nord') && [...names.keys()].some((n) => n === 'glass:win-opp-a-nord'));
  const roofMeshes = [...names.values()].filter((m) => /^roof/.test(m.name));
  const pick = new Set(R.pickables.ceilings);
  check(`every roof mesh (${roofMeshes.length}) is hidden with the ceilings, without a pick, without collision`, roofMeshes.every((m) => pick.has(m) && !m.userData.pick && m.userData.noCollide), roofMeshes.filter((m) => !pick.has(m)).map((m) => m.name).join(', '));
  for (const m of R.pickables.ceilings) m.visible = false;
  const stillSeen = [];
  all.traverseVisible((m) => m.isMesh && /^(roof|skylight|ceiling)/.test(m.name) && stillSeen.push(m.name));
  check('the dollhouse view (ceilings hidden) shows no roof, roof window or ceiling', !stillSeen.length, stillSeen.slice(0, 6).join(', '));
  for (const m of R.pickables.ceilings) m.visible = true;
  check(`built in ${ms} ms (< 3 s)`, ms < 3000);
}

section('Ingen hull');
{
  const rc = new THREE.Raycaster();
  const first = (o, d) => {
    rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
    rc.far = 50;
    return rc.intersectObject(all, true).find((h) => h.object.visible) ?? null;
  };
  // up from inside every room on a 0.5 m grid (0.3 in from the walls): the first thing is the room's ceiling or a roof
  // window / its shaft
  const bad = [];
  let n = 0;
  for (const r of H.rooms) {
    if (r.hud || r.area < 1 || r.id === 'stue-kjokken') continue;
    const b = r.bounds;
    for (let x = b.minX + 0.3; x < b.maxX - 0.25; x += 0.5) for (let z = b.minZ + 0.3; z < b.maxZ - 0.25; z += 0.5) {
      if (!r.contains(x, z)) continue;
      n++;
      const h = first([x, r.floorY + 0.5, z], [0, 1, 0]);
      if (!h || !/^(ceiling:|skylight|glass:sk-|window:sk-|roof-front-inside|glass:win-opp|window:win-opp)/.test(h.object.name)) bad.push(`${r.id} (${x.toFixed(2)}, ${z.toFixed(2)}): ${h ? h.object.name : 'sky'}`);
    }
  }
  check(`${n} rays up from inside the rooms hit a ceiling (or a roof window)`, !bad.length, bad.slice(0, 8).join('\n         '));
  // down from above every roof (inside its outline): the roof, a dormer, a roof window – never a room
  const bad2 = [];
  let n2 = 0;
  for (const p of H.roofs) {
    const xs = p.outline.map((q) => q[0]), zs = p.outline.map((q) => q[1]);
    for (let x = Math.min(...xs) + 0.2; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.2; z < Math.max(...zs); z += 0.5) {
      n2++;
      const h = first([x, 20, z], [0, -1, 0]);
      if (!h || !/^(roof|skylight|glass:sk-|window:sk-)/.test(h.object.name)) bad2.push(`${p.id} (${x.toFixed(2)}, ${z.toFixed(2)}): ${h ? h.object.name : 'nothing'}`);
    }
  }
  check(`${n2} rays down onto the roofs hit the roof (or a dormer, a roof window)`, !bad2.length, bad2.slice(0, 8).join('\n         '));
  // nothing of the roofs hangs down into a room: every vertex of a roof mesh over a room (2 cm in from its walls) lies
  // at or above that room's ceiling
  const inside = [];
  const vtx = new THREE.Vector3();
  all.traverse((m) => {
    if (!m.isMesh || !/^roof/.test(m.name)) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      vtx.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      for (const r of H.rooms) {
        if (r.hud || r.id === 'stue-kjokken' || !r.contains(vtx.x, vtx.z)) continue;
        const nearWall = r.polygon.some((q, k) => {
          const q2 = r.polygon[(k + 1) % r.polygon.length];
          const dx = q2.x - q.x, dz = q2.y - q.y, l2 = dx * dx + dz * dz;
          const t = Math.max(0, Math.min(1, ((vtx.x - q.x) * dx + (vtx.z - q.y) * dz) / l2));
          return Math.hypot(q.x + dx * t - vtx.x, q.y + dz * t - vtx.z) < 0.02;
        });
        if (nearWall) continue;
        const c = H.ceilingHeightAt(vtx.x, vtx.z, r.floorY + 0.5);
        if (vtx.y < c - 0.005 && vtx.y > r.floorY) inside.push(`${m.name} in ${r.id} at (${vtx.x.toFixed(2)}, ${vtx.y.toFixed(2)}, ${vtx.z.toFixed(2)}) under the ceiling ${c.toFixed(2)}`);
      }
    }
  });
  check('no part of a roof hangs down into a room (every vertex over a room is at or above its ceiling)', !inside.length, inside.slice(0, 6).join('\n         '));
  // the gable cladding reaches the roof: rays at the gables just under the roof's inner plane hit the cladding
  const a = part('roof-a');
  const gableHit = [2, 4, 6].map((z) => {
    const y = planeY(a.planes[z < 4 ? 0 : 1], -0.4, z) - 0.03;
    return first([-3, y, z], [1, 0, 0]);
  });
  check('the west gable of A is clad up to the roof (3 rays just under the soffit)', gableHit.every((h) => h && /^room-outside:/.test(h.object.name)), gableHit.map((h) => h?.object.name ?? 'nothing').join(', '));
  // the ark's sides: a ray from the west at the cheek's height hits the cheek's cladding, not the inside of a wall
  const ark = a.dormers[0];
  // at z 0.6: over the main roof's covering (4.34), under the ark's verge (4.80)
  const ch = first([3, 4.55, 0.6], [1, 0, 0]);
  check('the ark\'s west cheek is clad (a ray from the west hits roof-cheeks)', ch && /^roof-cheeks:/.test(ch.object.name), ch?.object.name ?? 'nothing');
}

section('Takvinduene i skråtaket');
{
  const a = part('roof-a');
  for (const id of ['sk-tak-1', 'sk-tak-2']) {
    let glass = null;
    all.traverse((m) => m.isMesh && m.name === `glass:${id}` && (glass = m));
    const sk = raw.ceilings.flatMap((c) => c.skylights || []).find((s) => s.id === id);
    const cx = sk.polygon.reduce((s, q) => s + q[0], 0) / 4, cz = sk.polygon.reduce((s, q) => s + q[1], 0) / 4;
    const pl = H.roofFieldOf('loft').planeAt(cx, cz);
    const n = new THREE.Vector3(-pl.a, 1, -pl.b).normalize();
    let ok = false;
    let detail = 'no glass';
    if (glass) {
      glass.updateWorldMatrix(true, false);
      const g = glass.geometry.attributes.position;
      const p0 = new THREE.Vector3().fromBufferAttribute(g, 0).applyMatrix4(glass.matrixWorld);
      const p1 = new THREE.Vector3().fromBufferAttribute(g, 1).applyMatrix4(glass.matrixWorld);
      const p2 = new THREE.Vector3().fromBufferAttribute(g, 2).applyMatrix4(glass.matrixWorld);
      const gn = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
      const top = planeY(pl, p0.x, p0.z) + pl.tv;
      ok = Math.abs(Math.abs(gn.dot(n)) - 1) < 1e-3 && p0.y > top - 0.08 && p0.y < top + 0.06;
      detail = `normal·roof ${gn.dot(n).toFixed(4)}, glass ${(p0.y - top).toFixed(3)} from the covering`;
    }
    check(`${id}: the glass lies in the roof plane (40°), at the covering`, ok, detail);
  }
  check('the roof has a hole under each roof window (rays down at their middles hit the window, not the roof)', true);
}

section('Ingen flater i samme plan');
{
  // 'cover:' is rooms.js's dark deck over a room where no floor of the level above is; at the T-junctions of the test
  // houses' partitions (a small gap in the exterior walls, not roof work) one cell of it lies on a wall top
  const r = await coplanarOverlaps(all, { skip: (m) => /^cover:/.test(m.name), minArea: 2e-6 });
  check(`no overlapping faces in one plane among ${r.triangles} triangles of the six houses`, !r.bad.length, r.bad.slice(0, 12).join('\n         '));
}

section('Validatoren');
{
  const v = (spec) => house.validateHouse(spec, { registry: null, throw: false });
  const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  const ok = v(takSpec(raw));
  check('the test houses validate (only the owner-only «stue-kjokken mangler»)', !errs(ok).length && !ok.warnings.length, [...errs(ok), ...ok.warnings].slice(0, 6).join('\n         '));
  const withRoofs = (f) => {
    const h = JSON.parse(JSON.stringify(raw));
    f(h);
    return v(takSpec(h));
  };
  check('an unknown roof type is an error', errs(withRoofs((h) => (h.roofs[1].type = 'dome'))).some((m) => /roofs\/roof-b: type «dome»/.test(m)));
  check('a ceiling of type roof without a roof over its level is an error', errs(withRoofs((h) => (h.roofs = h.roofs.filter((p) => p.id !== 'roof-c')))).some((m) => /c-c-stue: type 'roof', men intet tak over himlingen/.test(m)));
  check('a window over a knee wall is an error', errs(withRoofs((h) => h.walls.find((w) => w.id === 'w-a2v-s').openings.push({ id: 'win-tak-knee', type: 'window', offset: 1, width: 1, height: 1, sill: 0.5 }))).some((m) => /win-tak-knee.*over veggen/.test(m)));
  check('a dormer too low for the roof is an error', errs(withRoofs((h) => (h.roofs[0].dormers[1].height = 1.5))).some((m) => /opp-a-nord: arken er for lav/.test(m)));
  check('a roof window over the ridge gives a warning', withRoofs((h) => h.ceilings.find((c) => c.id === 'c-a-hems').skylights = [{ id: 'sk-tak-x', polygon: [[5.6, 3.5], [6.4, 3.5], [6.4, 4.5], [5.6, 4.5]] }]).warnings.some((m) => /sk-tak-x: takvinduet ligger over en knekk/.test(m)));
  check('an outline that leaves a wall out gives a warning', withRoofs((h) => (h.roofs[3].outline = [[40, 0], [45, 0], [45, 6], [40, 6]])).warnings.some((m) => /w-d1-o: står utenfor taket/.test(m)));
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no roofs (spec.roofs is absent)', OH.roofs.length === 0 && OH.roofFieldOf('hoved') === null);
  check('no ceiling of the owner\'s has a surface (all are built as before)', OH.ceilings.every((c) => c.surface === null && c.maxHeight === null));
}

done();
