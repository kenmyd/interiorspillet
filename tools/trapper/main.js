/**
 * Testside for trappetypene (notes/trapper.md): testhuset (testhus.mjs) bygd med spillets egne byggere (home/layout.js
 * buildLayout, home/rooms.js buildRooms, home/stairs.js buildStairs), gått med spillets figur (PlayerController,
 * CollisionWorld – den bratte trappa klatres på CollisionWorld.climbs).
 *
 * URL: ?view=<trapp-id>&from=foot|top|side|above – kamera mot en trapp (for skjermbilder), ?mode=orbit – dukkehus.
 * window.__tt: { layout, lays, look(id, from), walk(id, dir, hz) (hele gangen med en gang → tallene), walkLive(id, dir),
 *   cam(x, y, z, tx, ty, tz), frame(n, dt), pump(ms), upper(visible) }.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLayout } from '../../src/home/layout.js';
import { buildRooms } from '../../src/home/rooms.js';
import { buildStairs, stairLayout } from '../../src/home/stairs.js';
import { createHouseRoots } from '../../src/home/index.js';
import { configureMaterials, prepareMaterials } from '../../src/home/materials.js';
import { CollisionWorld } from '../../src/core/Collision.js';
import { Input } from '../../src/core/Input.js';
import { Settings, QUALITY } from '../../src/core/Settings.js';
import { Emitter } from '../../src/core/Events.js';
import { PlayerController } from '../../src/player/PlayerController.js';
import { PLAYER } from '../../src/config.js';
import { setMaxAnisotropy } from '../../src/world/proctex.js';
import { testHouseSpec } from './testhus.mjs';

const KINDS = ['white-oak', 'oak', 'oak-plank', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic'];
const params = new URLSearchParams(location.search);
const statusEl = document.getElementById('status');

const settings = new Settings();
const quality = QUALITY[settings.get?.('quality') ?? 'medium'] ?? QUALITY.medium;
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfdbe6');
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);
const events = new Emitter();

configureMaterials({ quality });
await prepareMaterials(KINDS);
const layout = buildLayout(testHouseSpec(), undefined, { devWarnings: false });
const H = layout.house;
const collision = new CollisionWorld();
const roots = createHouseRoots(layout, [new THREE.Group()]);
const ctx = { scene, camera, renderer, collision, interaction: null, events, settings, quality, roots, audio: null, lighting: null };
const R = buildRooms(ctx, layout, null);
const S = buildStairs(ctx, layout);
scene.add(...Object.values(roots.levels));
for (const part of [R, S]) {
  if (part.group && !part.group.parent) scene.add(part.group);
  for (const c of part.colliders || []) {
    if (c?.isBox3) collision.addStaticBox(c);
    else if (c) collision.addStatic(c);
  }
}
const lays = Object.fromEntries(H.stairs.map((st) => [st.id, stairLayout(st, H.levels)]));
const HB = H.bounds;
const CX = (HB.minX + HB.maxX) / 2;
const CZ = (HB.minZ + HB.maxZ) / 2;

// light: sky, sun (through no windows – a fill), lamps on both levels
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.3));
const sun = new THREE.DirectionalLight('#fff3df', 1.2);
sun.position.set(CX - 13, 18, CZ + 16);
sun.target.position.set(CX, 0, CZ);
scene.add(sun, sun.target);
for (const y of [2.15, -0.45]) {
  for (const x of [1.5, 4.5, 8, 11.5, 15.3]) {
    for (const z of [1.2, 4.5]) {
      const pl = new THREE.PointLight('#ffe2bf', 5, 9, 1.6);
      pl.position.set(x, y, z);
      scene.add(pl);
    }
  }
}
collision.build();
collision.setBounds(HB.minX + 0.05, HB.maxX - 0.05, HB.minZ + 0.05, HB.maxZ - 0.05);
if (H.floorYAt) collision.setFloorField((x, z, y) => H.floorYAt(x, z, y));

const input = new Input(renderer.domElement, settings);
const player = new PlayerController({ camera, collision, input, settings, events });
player.teleport(new THREE.Vector3(1.45, 0, 0.1), Math.PI, 0);

let mode = params.get('mode') === 'orbit' ? 'orbit' : 'walk';
let orbit = null;
let fixed = false; // a camera set by look()/cam(): neither the player nor the orbit moves it
let auto = null; // a live walk: { lay, dir, bot, u, done }

function setMode(m) {
  mode = m;
  fixed = false;
  document.getElementById('walk').classList.toggle('on', m === 'walk');
  document.getElementById('orbit').classList.toggle('on', m === 'orbit');
  for (const mesh of R.pickables?.ceilings || []) mesh.visible = m === 'walk';
  if (m === 'walk') {
    orbit?.dispose();
    orbit = null;
    input.setEnabled?.(true);
    return;
  }
  input.setEnabled?.(false);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.set(CX, -1, CZ);
  camera.position.set(CX - 6, 9, CZ + 12);
  orbit.update();
}

/** Hide the main level (floor, walls, ceiling) but keep the stairs: see them from above. */
let upperShown = true;
function showUpper(on = !upperShown) {
  upperShown = on;
  roots.levels.hoved.traverse((o) => {
    if (!o.isMesh) return;
    let inStair = false;
    for (let p = o; p; p = p.parent) if (/^stair:/.test(p.name)) inStair = true;
    if (!inStair) o.visible = on;
  });
  document.getElementById('upper').classList.toggle('on', !on);
  return on;
}

function freeCam(x, y, z, tx, ty, tz) {
  orbit?.dispose();
  orbit = null;
  fixed = true;
  camera.position.set(x, y, z);
  camera.lookAt(tx, ty, tz);
  return true;
}

/** Camera toward a stair: from the foot (basement, looking up), the top (the upper floor), the side or above. */
function look(id, from = 'foot') {
  const lay = lays[id];
  if (!lay) return false;
  const L = lay.walk.length;
  const mid = lay.walk.at(L / 2).p;
  const midY = (lay.topY + lay.bottomY) / 2;
  if (from === 'foot') {
    const a = lay.walk.at(L + 2.4).p;
    return freeCam(a[0], lay.bottomY + 1.6, a[1], mid[0], midY, mid[1]);
  }
  if (from === 'top') {
    const a = lay.walk.at(-1.6).p;
    const b = lay.walk.at(0.8).p;
    return freeCam(a[0], lay.topY + 1.65, a[1], b[0], lay.topY - 0.6, b[1]);
  }
  if (from === 'above') return freeCam(mid[0] + 0.01, lay.topY + 4.5, mid[1] + 1.5, mid[0], lay.bottomY, mid[1]);
  // the side: across the walk line at its middle, in the basement
  const w = lay.walk.at(L / 2);
  // the side with more room in the house
  const room = (p) => Math.min(p[0] - HB.minX, HB.maxX - p[0], p[1] - HB.minZ, HB.maxZ - p[1]);
  const cands = [1, -1].map((k) => [mid[0] - w.dir[1] * 2.6 * k, mid[1] + w.dir[0] * 2.6 * k]);
  const c = room(cands[0]) >= room(cands[1]) ? cands[0] : cands[1];
  return freeCam(c[0], lay.bottomY + 1.3, c[1], mid[0], midY - 0.3, mid[1]);
}

// ---- walking the stairs with the game's player (the same driver as tools/house-tests/stairtypes.test.mjs)
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);
function nearestU(lay, x, z, around) {
  let best = around ?? 0;
  let bd = Infinity;
  const lo = around == null ? -2 : around - 0.6;
  const hi = around == null ? lay.walk.length + 2 : around + 0.6;
  for (let u = lo; u <= hi; u += 0.005) {
    const p = lay.walk.at(u).p;
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}
function startWalk(lay, dir) {
  const down = dir === 'down';
  const L = lay.walk.length;
  const s = down ? lay.walk.at(-0.9).p : lay.walk.at(L + 0.8).p;
  const u0 = nearestU(lay, s[0], s[1]);
  const look = lay.walk.at(u0 + (down ? 0.3 : -0.3)).p;
  player.teleport(new THREE.Vector3(s[0], down ? lay.topY : lay.bottomY, s[1]), yawToward(look[0] - s[0], look[1] - s[1]), 0);
  const bot = { move: { forward: 0, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  player.input = bot;
  for (let i = 0; i < 12; i++) player.update(1 / 60);
  bot.move.forward = 1;
  return { lay, dir, bot, u: u0, sign: down ? 1 : -1, t: 0, frames: 0, air: 0, maxDy: 0, lands: 0 };
}
/** One frame of a walk: steer (pure pursuit 0.3 m ahead plus the cross-track error), update; true when done. */
function stepWalk(w, dt) {
  const { lay, sign } = w;
  const L = lay.walk.length;
  const p0 = player.position.clone();
  w.u = nearestU(lay, p0.x, p0.z, w.u);
  const tgt = lay.walk.at(w.u + sign * 0.3).p;
  const on = lay.walk.at(w.u).p;
  player.yaw = yawToward(tgt[0] + (on[0] - p0.x) - p0.x, tgt[1] + (on[1] - p0.z) - p0.z);
  player.update(dt);
  w.t += dt;
  w.frames++;
  if (!player.onGround) w.air++;
  w.maxDy = Math.max(w.maxDy, Math.abs(player.position.y - p0.y));
  const end = sign > 0 ? w.u > L + 0.6 : w.u < -0.6;
  return end || w.t > 20;
}
function endWalk(w) {
  player.input = input;
  const r = { id: w.lay.id, dir: w.dir, endY: +player.position.y.toFixed(3), want: w.dir === 'down' ? w.lay.bottomY : w.lay.topY, seconds: +w.t.toFixed(2), airborne: +(w.air / Math.max(1, w.frames)).toFixed(3), maxDy: +w.maxDy.toFixed(3), lands: w.lands };
  r.ok = Math.abs(r.endY - r.want) < 0.03 && r.airborne < 0.02 && w.t < 20;
  statusEl.textContent = `${r.id} ${r.dir === 'down' ? 'ned' : 'opp'}: ${r.ok ? 'kom fram' : 'KOM IKKE FRAM'} – slutt-y ${r.endY} (skal være ${r.want}), ${r.seconds} s, i lufta ${(r.airborne * 100).toFixed(1)} %, største Δy per bilde ${r.maxDy} m`;
  return r;
}
events.on?.('land', (d) => {
  if (auto && (d?.speed ?? 0) > 1.5) auto.lands++;
});
/** The whole walk at once (fixed steps of 1/hz) → its numbers. */
function walk(id, dir = 'down', hz = 60) {
  const lay = lays[id];
  if (!lay) return null;
  setMode('walk');
  const w = startWalk(lay, dir);
  auto = w;
  while (!stepWalk(w, 1 / hz));
  auto = null;
  return endWalk(w);
}
function walkLive(id, dir = 'down') {
  const lay = lays[id];
  if (!lay) return false;
  setMode('walk');
  auto = startWalk(lay, dir);
  return true;
}

// ---- panel
document.getElementById('walk').onclick = () => setMode('walk');
document.getElementById('orbit').onclick = () => setMode('orbit');
document.getElementById('upper').onclick = () => showUpper();
const list = document.getElementById('stairs');
const button = (row, text, fn) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = fn;
  row.appendChild(b);
};
for (const st of H.stairs) {
  const lay = lays[st.id];
  const row = document.createElement('div');
  row.className = 'row';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = st.name ?? st.id;
  const info = document.createElement('span');
  info.className = 'info';
  info.textContent = `${lay.type}: ${lay.risers} opptrinn à ${lay.riser.toFixed(3)}, inntrinn ${lay.going.toFixed(3)}, 2R+G ${(2 * lay.riser + lay.going).toFixed(3)}, ${lay.slopeDeg.toFixed(1)}°`;
  row.append(name, info);
  button(row, 'Fra foten', () => look(st.id, 'foot'));
  button(row, 'Fra toppen', () => look(st.id, 'top'));
  button(row, 'Fra siden', () => look(st.id, 'side'));
  button(row, 'Ovenfra', () => look(st.id, 'above'));
  button(row, 'Ned', () => walkLive(st.id, 'down'));
  button(row, 'Opp', () => walkLive(st.id, 'up'));
  list.appendChild(row);
}

function resize() {
  const w = app.clientWidth || window.innerWidth;
  const h = app.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
setMode(mode);
if (params.get('view')) look(params.get('view'), params.get('from') ?? 'foot');

let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  step(dt);
}
/** One frame: the player (walking or a live walk), the picture. */
function step(dt) {
  if (auto && dt > 0) {
    if (stepWalk(auto, dt)) {
      endWalk(auto);
      auto = null;
    }
  } else if (mode === 'walk' && !fixed) {
    input.update(dt);
    player.update(dt);
    input.consumeClick?.();
    input.consumeAction?.('interact');
    input.consumeAction?.('pause');
    input.consumeAction?.('help');
  } else if (orbit) orbit.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

window.__tt = {
  layout,
  lays,
  player,
  collision,
  look,
  walk,
  walkLive,
  upper: showUpper,
  /** Show / hide the black steel (stringers, guards, rails) – to see the treads alone. */
  steel(on = true) {
    scene.traverse((o) => {
      if (o.isMesh && /^stair-(steel|glass):/.test(o.name)) o.visible = on;
    });
    return on;
  },
  mode: setMode,
  camera,
  cam: freeCam,
  speed: () => PLAYER.walkSpeed,
  /** Draw for `ms` (the pane's screenshot shows a frame drawn a moment ago when the page is in the background). */
  pump(ms = 1200, dt = 0) {
    clearInterval(window.__pump);
    const t0 = performance.now();
    window.__pump = setInterval(() => {
      step(dt);
      if (performance.now() - t0 > ms) clearInterval(window.__pump);
    }, 40);
    return true;
  },
  /** Run n frames of dt seconds at once (a hidden page gets no animation frames) and draw. */
  frame(n = 1, dt = 1 / 30) {
    for (let i = 0; i < n; i++) step(dt);
    return true;
  },
  ready: true,
};
