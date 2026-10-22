// Generates the "built-ins + original design unchanged" lighting snapshot (Node, no renderer) at the current tree.
// usage: node <this> <worktree> <out.json>     (run with cwd = worktree)
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
const WT = process.argv[2];
const OUT = process.argv[3];
const { imp } = await import(pathToFileURL(WT + '/tools/house-tests/_lib.mjs').href);
registerHooks({ load(url, c, next) { return url.startsWith('file:') && url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, c); } });
const THREE = await import(pathToFileURL('C:/Dev/Interiørspillet/node_modules/three/build/three.module.js').href);
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { layout } = await imp('src/home/layout.js');
const { LightManager } = await imp('src/home/lighting.js');
const { DesignState } = await imp('src/design/DesignState.js');
const { SceneSync } = await imp('src/design/SceneSync.js');
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const r = (v) => (typeof v === 'number' ? +v.toPrecision(12) : v);
const out = { note: 'LightManager snapshot of the ORIGINAL design (built-ins + original item lamps via SceneSync), Node, no renderer', levels: {} };
for (const level of ['low', 'medium', 'high']) {
  const lights = layout.builtInLights.map((l) => ({ ...l }));
  const scene = new THREE.Scene();
  const M = quiet(() => new LightManager({ scene, home: { layout, builtInLights: lights, house: { builtInLights: [...lights] }, doors: [] }, quality: { level } }));
  const items = new THREE.Group(); scene.add(items);
  const own = layout.ceilingHeightAt, house = layout.house?.ceilingHeightAt;
  const home = { roots: { items }, layout, walls: layout.walls, windows: layout.windows, ceilingHeightAt: (!house || own.length >= 3) ? own : (x, z, y) => (y == null ? own(x, z) : house(x, z, y)) };
  const design = new DesignState();
  const sync = new SceneSync({ home, design, lighting: M });
  sync.gating = false;
  for (const it of design.list()) sync._queue.add(it.uid);
  quiet(() => sync.flush());
  const cam = new THREE.PerspectiveCamera();
  const lightCount = {};
  scene.traverse((o) => { if (o.isLight) lightCount[o.type] = (lightCount[o.type] || 0) + 1; });
  const snaps = {};
  const poses = [...layout.photoCameras.map((pc) => [pc.id, pc.pos, pc.lookAt]),
    ['soverom', new THREE.Vector3(1.5, 1.6, 5.6), new THREE.Vector3(1.5, 1.4, 8)],
    ['gang', new THREE.Vector3(2.6, 1.6, 3.2), new THREE.Vector3(0.5, 1.4, 3.2)],
    ['kjellerstue', new THREE.Vector3(3.5, -0.95, 6.2), new THREE.Vector3(3.5, -1.2, 9)]];
  for (const [id, pos, look] of poses) {
    for (const hour of [8.5, 12, 20, 23]) {
      M.setTime({ hour, month: 10, day: 18 });
      cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld(true);
      M._selectAt = -1e9; M.update(0, cam); M.update(1 / 60, cam);
      const info = M.info();
      snaps[`${id}@${hour}`] = {
        room: M.cameraRoomId, Lkey: r(M._Lkey), S: r(M._Starget), wb: M._wbTarget.toArray().map(r), wbK: r(M._wbK), amb: r(M._ambTarget),
        info: { effective: info.effective, lampsOnByDefault: info.lampsOnByDefault, lampLumens: r(info.lampLumens) },
        slots: ['point', 'spot', 'rect'].map((k) => M._pool[k].map((s) => s.cand?.id ?? null).join(',')).join('|'),
      };
    }
  }
  out.levels[level] = { lightCount, pool: Object.fromEntries(['point', 'spot', 'rect'].map((k) => [k, M._pool[k].length])), snaps };
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT, Object.keys(out.levels.medium.snaps).length, 'snaps per level');
