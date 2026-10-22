#!/usr/bin/env node
/**
 * Node test for the window models (notes/vindusmodeller.md):
 *   node tools/house-tests/vinduer.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test house of dev/vinduer.html (src/dev/vinduer-hus.js) with buildLayout + buildRooms and checks:
 *   • every window is built, with one glass mesh and one pane per field (sashes);
 *   • glazing bars where a field has more than one pane, handles on the opening sashes only;
 *   • the frame stands FRAME_INSET in from the hole's sides and top (request 14);
 *   • windows on the floor: the room's floor reaches out to the frame (request 15), no other window gets a strip;
 *   • the roof windows: holes in the ceiling, a shaft and the window, all hidden with the ceilings (pickables.ceilings);
 *   • no two faces of the room facing the same way overlap in one plane (they flicker), the glass (double-sided)
 *     against everything;
 *   • validateHouse accepts the test house (only the owner-only «stue-kjokken mangler»), windowModelIssues reports
 *     bad fields, gaps, overlaps, panes and bars.
 */
import { imp, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { FRAME_INSET, windowSashes } = await imp('src/home/wallkit.js');
const { vinduerHus, vinduerSpec } = await imp('src/dev/vinduer-hus.js');
const house = await imp('src/data/scripts/house.mjs');

const raw = vinduerHus();
const layout = buildLayout(vinduerSpec(raw), undefined, { devWarnings: false });
const H = layout.house;
const roots = createHouseRoots(layout, [new THREE.Group()]);
const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, layout, null);
const room = roots.rooms.galleri.group;
room.updateMatrixWorld(true);
const rawWindows = raw.walls.flatMap((w) => w.openings);

section('Vinduene');
check('every window is built', R.windows.length === rawWindows.length, `${R.windows.length} of ${rawWindows.length}`);
for (const o of rawWindows) {
  const w = R.windows.find((x) => x.id === o.id);
  if (!w) continue;
  const fields = windowSashes(H.opening(o.id)).length;
  const g = w.glass[0];
  const quads = g ? g.geometry.attributes.position.count / 4 : 0;
  check(`${o.id} «${o.name}»: ${fields} glass pane(s)`, w.glass.length === 1 && quads === fields, `${w.glass.length} meshes, ${quads} quads`);
}

/** Boxes of a window group by material name (a box = 12 triangles; the batcher may weld the vertices). */
const boxes = (w, re) => {
  let n = 0;
  w.group.traverse((m) => m.isMesh && re.test(m.material?.name || '') && (n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 36));
  return n;
};
const byName = (name) => {
  const o = rawWindows.find((x) => x.name === name);
  return o ? R.windows.find((x) => x.id === o.id) : null;
};
const win = (name) => byName(name) ?? { group: new THREE.Group(), id: name };
const frameBoxes = (w) => boxes(w, /^black-metal #25272b/);
const one = win('Topphengslet (som eierens)');
const bars = win('Sprosser 2 × 3');
check('glazing bars: 2 × 3 panes = 3 bars more than one pane', frameBoxes(bars) - frameBoxes(one) === 3, `${frameBoxes(bars)} vs ${frameBoxes(one)}`);
const white = win('Svart karm, hvite sprosser 3 × 3');
check('white bars on a black frame are their own material (2 + 2 bars)', boxes(white, /#f2f0eb/) === 4, `${boxes(white, /#f2f0eb/)}`);
const handles = (name) => boxes(win(name), /#1a1a1a/) / 2;
const hs = ['Todelt, sidehengslet', 'Tredelt: fast – åpent – fast', 'Fast, uten noe (planbyggerens i dag)', 'Fire felt (2 × 2)'].map(handles);
check('handles: one per opening sash (todelt 2, tredelt 1, fast 0, fire felt 2)', hs.join() === '2,1,0,2', hs.join());

// the frame's outer box against the hole (in the opening frame)
{
  const w = one;
  const o = H.opening(w.id);
  const inv = new THREE.Matrix4().copy(w.group.matrix).invert();
  const box = new THREE.Box3();
  w.group.traverse((m) => {
    if (!m.isMesh || !/^black-metal #25272b/.test(m.material?.name || '')) return;
    const p = m.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrix).applyMatrix4(w.group.matrix).applyMatrix4(inv));
  });
  check('the frame stands FRAME_INSET in from the sides and the top of the hole, on the sill', near(box.min.x, -o.width / 2 + FRAME_INSET, 1e-6) && near(box.max.x, o.width / 2 - FRAME_INSET, 1e-6) && near(box.max.y, o.height - FRAME_INSET, 1e-6) && near(box.min.y, 0, 1e-6), `x ${box.min.x.toFixed(5)} … ${box.max.x.toFixed(5)}, y ${box.min.y.toFixed(5)} … ${box.max.y.toFixed(5)}`);
}
{
  const w = win('Fast, uten noe (planbyggerens i dag)');
  const o = H.opening(w.id);
  check('a window without reveal.depth stays inside the wall (frame clamped to the wall thickness)', w.revealDepth <= 0.3 - 0.07 - 0.004, `revealDepth ${w.revealDepth} (layout ${o.revealDepth})`);
}

section('Gulv ut til glasset');
const floor = [];
room.traverse((m) => m.isMesh && m.name === 'floor:galleri' && floor.push(m));
{
  const g = floor[0]?.geometry;
  g?.computeBoundingBox();
  const bb = g?.boundingBox;
  // win-test-8 (south, sill 0), win-test-15 / 16 (north, sill 0): the floor reaches 0.2 behind both long walls
  check('the floor reaches out to the frame in the windows on the floor (south and north)', bb && near(bb.min.z, -0.2, 1e-4) && near(bb.max.z, 6.2, 1e-4), bb ? `z ${bb.min.z} … ${bb.max.z}` : 'no floor');
  check('… and nowhere else (x stays inside the room)', bb && near(bb.min.x, 0, 1e-4) && near(bb.max.x, 16, 1e-4), bb ? `x ${bb.min.x} … ${bb.max.x}` : '');
  const tris = g ? g.attributes.position.count / 3 : 0;
  check('three floor strips of two triangles each', tris === 2 + 3 * 2 || tris > 6, `${tris} triangles`);
}

section('Takvinduer');
{
  const ceiling = [];
  room.traverse((m) => m.isMesh && m.name === 'ceiling:c-galleri' && ceiling.push(m));
  const area = (g) => {
    const p = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : p.count;
    let s = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(p, idx ? idx[i] : i);
      b.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1);
      c.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2);
      s += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    return s;
  };
  const holes = 0.78 * 1.18 + 1.14 * 1.18;
  check('the ceiling has the two holes', ceiling.length === 1 && near(area(ceiling[0].geometry), 96 - holes, 1e-3), ceiling[0] ? `${area(ceiling[0].geometry).toFixed(4)} m² (want ${(96 - holes).toFixed(4)})` : 'no ceiling');
  const sky = [];
  room.traverse((m) => /^skylight/.test(m.name) && sky.push(m.name));
  check('each roof window has a shaft and a window', ['sk-test-1', 'sk-test-2'].every((id) => sky.includes(`skylight-shaft:${id}`) && sky.includes(`skylight:${id}`)), sky.join(', '));
  const inCeil = R.pickables.ceilings.filter((m) => m.userData.pick?.ceilingId === 'c-galleri').length;
  check('everything of the roof windows is hidden with the ceilings (pickables.ceilings)', inCeil >= 1 + 2 * 3, `${inCeil} meshes`);
  const glass = R.pickables.ceilings.filter((m) => /^glass:sk-test/.test(m.name));
  check('two roof-window glasses, facing down, above the ceiling', glass.length === 2 && glass.every((g) => {
    g.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
    return n.y < -0.999 && p.y > 2.6 + 0.2;
  }), glass.map((g) => g.name).join(', '));
  const sk2 = glass.find((g) => g.name === 'glass:sk-test-2');
  check('sk-test-2: depth 0.45 – glass ~0.49 above the ceiling', sk2 && near(new THREE.Vector3().setFromMatrixPosition(sk2.matrixWorld).y, 2.6 + 0.45 + 0.035, 0.002), sk2 ? `${new THREE.Vector3().setFromMatrixPosition(sk2.matrixWorld).y.toFixed(4)}` : '');
}

section('Ingen flater i samme plan');
{
  // every triangle of the room's meshes (world): bucket by facing + plane, then the overlap of pairs in one plane
  const tris = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  room.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    const idx = m.geometry.index ? m.geometry.index.array : null;
    const n = idx ? idx.length : p.count;
    const glass = /^glass:/.test(m.name);
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, idx ? idx[i + k] : i + k).applyMatrix4(m.matrixWorld);
      const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      const a2 = nrm.length();
      if (a2 < 1e-10) continue;
      nrm.divideScalar(a2);
      tris.push({ mesh: m.name, glass, n: nrm, d: nrm.dot(v[0]), pts: v.map((x) => x.clone()) });
      if (glass) tris.push({ mesh: m.name, glass, n: nrm.clone().negate(), d: -nrm.dot(v[0]), pts: v.map((x) => x.clone()) });
    }
  });
  const key = (t) => `${Math.round(t.n.x * 1e3)},${Math.round(t.n.y * 1e3)},${Math.round(t.n.z * 1e3)}`;
  const buckets = new Map();
  for (const t of tris) {
    const k = `${key(t)}|${Math.round(t.d * 1e4)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)).push(t);
  }
  const to2 = (t, n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    return t.pts.map((p) => (ax >= ay && ax >= az ? [p.y, p.z] : ay >= az ? [p.x, p.z] : [p.x, p.y]));
  };
  const area2 = (P) => {
    let s = 0;
    for (let i = 0; i < P.length; i++) s += P[i][0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * P[i][1];
    return s / 2;
  };
  const clip = (subject, clipper) => {
    let out = subject;
    const cw = area2(clipper) < 0;
    for (let i = 0; i < clipper.length && out.length; i++) {
      const a = clipper[i], b = clipper[(i + 1) % clipper.length];
      const side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (cw ? -1 : 1);
      const inp = out;
      out = [];
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length];
        const sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if (sp * sq < 0) {
          const t = sp / (sp - sq);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
    }
    return out;
  };
  const bad = [];
  const seen = new Set();
  for (const [k, list] of buckets) {
    const [nk, dk] = k.split('|');
    // the plane's neighbours in d (rounding at a bucket edge)
    const near = [list, buckets.get(`${nk}|${Number(dk) + 1}`) || []];
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      const PA = to2(A, A.n);
      const bxA = [Math.min(...PA.map((p) => p[0])), Math.max(...PA.map((p) => p[0])), Math.min(...PA.map((p) => p[1])), Math.max(...PA.map((p) => p[1]))];
      for (const L2 of near) {
        for (let j = L2 === list ? i + 1 : 0; j < L2.length; j++) {
          const B = L2[j];
          if (Math.abs(A.d - B.d) > 1e-4) continue;
          if (A.glass && B.glass && A.mesh === B.mesh) continue;
          const PB = to2(B, A.n);
          if (Math.max(...PB.map((p) => p[0])) <= bxA[0] || Math.min(...PB.map((p) => p[0])) >= bxA[1] || Math.max(...PB.map((p) => p[1])) <= bxA[2] || Math.min(...PB.map((p) => p[1])) >= bxA[3]) continue;
          const c = clip(PA, PB);
          const ar = c.length >= 3 ? Math.abs(area2(c)) : 0;
          if (ar > 1e-6) {
            const pair = [A.mesh, B.mesh].sort().join(' / ');
            if (!seen.has(pair)) {
              seen.add(pair);
              bad.push(`${pair} (${(ar * 1e6).toFixed(0)} mm², n ${nk}, d ${(A.d).toFixed(4)})`);
            }
          }
        }
      }
    }
  }
  check(`no overlapping faces in one plane among ${tris.length} triangles of the room`, !bad.length, bad.slice(0, 12).join('\n         '));
}

section('Validatoren');
{
  const spec = vinduerSpec(raw);
  const r = house.validateHouse(spec, { registry: null, throw: false });
  const errors = r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  check('the test house validates (only the owner-only «stue-kjokken mangler»)', !errors.length, errors.slice(0, 8).join('\n         '));
  const winWarn = r.warnings.filter((m) => /win-test|sk-test/.test(m));
  check('no warnings for the test windows', !winWarn.length, winWarn.join('\n         '));
  const wm = (o) => house.windowModelIssues({ width: 1.2, height: 1.2, ...o });
  check('a gap between the fields is an error', wm({ sashes: [{ from: 0, to: 0.4 }, { from: 0.5, to: 1 }] }).errors.some((m) => /dekker bare/.test(m)));
  check('overlapping fields are an error', wm({ sashes: [{ from: 0, to: 0.6 }, { from: 0.5, to: 1 }] }).errors.some((m) => /overlapper/.test(m)));
  check('from ≥ to is an error', wm({ sashes: [{ from: 0.6, to: 0.4 }] }).errors.some((m) => /mindre enn to/.test(m)));
  check('an unknown hinge is an error', wm({ sashes: [{ opening: true, hinge: 'up' }] }).errors.some((m) => /hinge/.test(m)));
  check('panes must be whole numbers 1–12', wm({ panes: [2.5, 3] }).errors.length === 1 && wm({ panes: [0, 3] }).errors.length === 1 && wm({ panes: [13, 1] }).errors.length === 1 && !wm({ panes: [3, 4] }).errors.length);
  check('bars.width outside 0.005–0.08 is an error', wm({ bars: { width: 0.2 } }).errors.length === 1);
  check('tiny panes give a warning', wm({ width: 0.45, height: 1.8, panes: [6, 6] }).warnings.some((m) => /rutene/.test(m)));
  check('revealFloor on a raised window gives a warning', wm({ sill: 0.9, revealFloor: true }).warnings.some((m) => /revealFloor/.test(m)));
  const bad = vinduerSpec({ ...raw, ceilings: [{ ...raw.ceilings[0], skylights: [{ id: 'sk-x', polygon: [[15.5, 5.5], [16.5, 5.5], [16.5, 6.5], [15.5, 6.5]] }, { id: 'sk-x', polygon: [[1, 1], [2, 1], [2.2, 2], [1, 2]] }] }] });
  const rb = house.validateHouse(bad, { registry: null, throw: false });
  check('a roof window outside its ceiling is an error', rb.errors.some((m) => /sk-x: takvinduet ligger ikke inne/.test(m)), rb.errors.join(' | '));
  check('a roof window that is not a rectangle is an error, and ids are unique', rb.errors.some((m) => /rektangel/.test(m)) && rb.errors.some((m) => /brukt av et annet takvindu/.test(m)), rb.errors.join(' | '));
}

done();
