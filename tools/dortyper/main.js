/**
 * Testside for dørtypene (notes/dortyper.md): testhuset (testhus.mjs) bygd med spillets egne byggere (home/layout.js
 * buildLayout, home/rooms.js buildRooms – dørene fra home/doors.js og home/doortypes.js), gått med spillets figur
 * (PlayerController, CollisionWorld, InteractionSystem: E åpner og lukker).
 *
 * URL: ?view=<dør-id>&side=front|back&open=1 – kamera foran en dør (for skjermbilder), ?mode=orbit – dukkehus,
 * ?house=<url> – en annen husfil (f.eks. en eksport fra planbyggeren) i stedet for testhuset.
 * window.__dt: { layout, doors, open(id, on), all(on), look(id, side, dist), walkTo(x, z, yawDeg), mode(m) }.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLayout } from '../../src/home/layout.js';
import { buildRooms } from '../../src/home/rooms.js';
import { createHouseRoots } from '../../src/home/index.js';
import { configureMaterials, prepareMaterials } from '../../src/home/materials.js';
import { CollisionWorld } from '../../src/core/Collision.js';
import { InteractionSystem } from '../../src/core/Interaction.js';
import { Input } from '../../src/core/Input.js';
import { Settings, QUALITY } from '../../src/core/Settings.js';
import { Emitter } from '../../src/core/Events.js';
import { PlayerController } from '../../src/player/PlayerController.js';
import { setMaxAnisotropy } from '../../src/world/proctex.js';
import { testHouseSpec } from './testhus.mjs';

const KINDS = ['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic'];
const params = new URLSearchParams(location.search);

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

const promptEl = document.getElementById('prompt');
const hud = {
  setPrompt(text, key = 'E') {
    promptEl.hidden = !text;
    if (text) promptEl.innerHTML = `<kbd>${key ?? 'E'}</kbd>${text}`;
  },
  setCursor(kind) {
    renderer.domElement.style.cursor = kind;
  },
};

configureMaterials({ quality });
await prepareMaterials(KINDS);
// ?house=<url of a house file> (e.g. a planbygger export) instead of the test house
const houseUrl = params.get('house');
const house = houseUrl ? await fetch(houseUrl).then((r) => r.json()) : undefined;
const layout = buildLayout(testHouseSpec(house), undefined, { devWarnings: false });
const collision = new CollisionWorld();
const interaction = new InteractionSystem({ camera, collision, events });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const ctx = { scene, camera, renderer, collision, interaction, events, settings, quality, roots, audio: null, lighting: null };
const R = buildRooms(ctx, layout, null);
const HB = layout.house.bounds;
const CX = (HB.minX + HB.maxX) / 2;
const CZ = (HB.minZ + HB.maxZ) / 2;
scene.add(...Object.values(roots.levels));
if (R.group && !R.group.parent) scene.add(R.group);
for (const c of R.colliders || []) {
  if (c?.isBox3) collision.addStaticBox(c);
  else if (c) collision.addStatic(c);
}

// ground (one threshold step below the floor, as the planbygger viewer), sky light, sun, a lamp per room
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(CX, -0.15, CZ);
ground.receiveShadow = true;
scene.add(ground);
ground.updateMatrixWorld(true);
collision.addStatic(ground);
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.1));
const sun = new THREE.DirectionalLight('#fff3df', 2.4);
sun.position.set(CX - 13, 18, CZ + 16);
sun.target.position.set(CX, 0, CZ);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const [x, z] of [0.2, 0.5, 0.8].flatMap((k) => [[HB.minX + k * (HB.maxX - HB.minX), 1.5], [HB.minX + k * (HB.maxX - HB.minX), 5]])) {
  const pl = new THREE.PointLight('#ffe2bf', 9, 0, 2);
  pl.position.set(x, 2.15, z);
  scene.add(pl);
}
collision.build();
const b = HB;
collision.setBounds?.(b.minX - 10, b.maxX + 10, b.minZ - 10, b.maxZ + 10);
if (collision.setFloorField && layout.house.floorYAt) collision.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));

const input = new Input(renderer.domElement, settings);
const player = new PlayerController({ camera, collision, input, settings, events });
player.teleport(new THREE.Vector3(CX, 0, 1.5), 0, 0);

const doors = new Map(R.doors.map((d) => [d.id, d]));
let mode = params.get('mode') === 'orbit' ? 'orbit' : 'walk';
let orbit = null;
let fixed = false; // a camera set by look(): neither the player nor the orbit moves it

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
  hud.setPrompt(null);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.target.set(CX, 0.5, CZ);
  camera.position.set(CX - 10, 14, CZ + 13);
  orbit.update();
}

/** Camera in front of a door: `side` front (the owner room) or back, `dist` m from the wall, at eye height. */
function look(id, side = 'front', dist = 2.2, height = 1.55) {
  const d = layout.house.doors.find((x) => x.id === id);
  if (!d) return false;
  const n = d.basis.zAxis;
  const s = side === 'back' ? -1 : 1;
  const depth = layout.house.wallsById[d.wallId]?.thickness ?? 0.1;
  const o = d.basis.origin.clone().addScaledVector(n, s > 0 ? 0 : -depth);
  if (orbit) {
    orbit.dispose();
    orbit = null;
  }
  fixed = true;
  camera.position.copy(o).addScaledVector(n, s * dist).add(new THREE.Vector3(0, height, 0));
  camera.lookAt(o.clone().add(new THREE.Vector3(0, 1.05, 0)));
  return true;
}

function openDoor(id, on = true, instant = true) {
  const d = doors.get(id);
  if (!d) return false;
  d.door.setOpen(on, { instant });
  return true;
}

// ---- panel
document.getElementById('walk').onclick = () => setMode('walk');
document.getElementById('orbit').onclick = () => setMode('orbit');
document.getElementById('openAll').onclick = () => doors.forEach((d) => d.door.setOpen(true));
document.getElementById('closeAll').onclick = () => doors.forEach((d) => d.door.setOpen(false));
const list = document.getElementById('doors');
for (const d of layout.house.doors) {
  const row = document.createElement('div');
  const name = document.createElement('span');
  name.textContent = d.name ?? d.id;
  const a = document.createElement('button');
  a.textContent = 'Se';
  a.onclick = () => look(d.id, 'front');
  const bk = document.createElement('button');
  bk.textContent = 'Bak';
  bk.onclick = () => look(d.id, 'back');
  const t = document.createElement('button');
  t.textContent = 'Åpne/lukk';
  t.onclick = () => doors.get(d.id)?.door.toggle();
  row.append(name, a, bk, t);
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
if (params.get('open') === '1') doors.forEach((d) => d.door.setOpen(true, { instant: true }));
if (params.get('view')) look(params.get('view'), params.get('side') ?? 'front', Number(params.get('dist')) || 2.2);

let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  step(dt);
}
/** One frame: the player (walking), the doors, the picture. */
function step(dt) {
  if (mode === 'walk' && !fixed) {
    input.update(dt);
    player.update(dt);
    const captured = input.isCaptured || input.isMouseLook;
    interaction.update(input, hud, captured);
    const click = input.consumeClick?.();
    if (input.consumeAction?.('interact') || click) interaction.interact({});
    input.consumeAction?.('pause');
    input.consumeAction?.('help');
  } else if (orbit) orbit.update();
  const state = { camera, playerPosition: player.position };
  if (R.update) R.update(dt, state);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

window.__dt = {
  layout,
  doors,
  player,
  interaction,
  /** The prompt now shown (null when none). */
  prompt: () => (promptEl.hidden ? null : promptEl.textContent),
  open: openDoor,
  all: (on) => doors.forEach((d) => d.door.setOpen(on, { instant: true })),
  look,
  mode: setMode,
  camera,
  /** Camera at (x, y, z) looking at (tx, ty, tz), fixed. */
  cam(x, y, z, tx, ty, tz) {
    orbit?.dispose();
    orbit = null;
    fixed = true;
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
    return true;
  },
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
  /** Put the player at (x, z) looking along yawDeg (0 = −z) and leave the fixed camera. */
  walkTo(x, z, yawDeg = 0) {
    setMode('walk');
    player.teleport(new THREE.Vector3(x, 0, z), THREE.MathUtils.degToRad(yawDeg), 0);
  },
  ready: true,
};
