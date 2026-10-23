import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY, Settings } from '../core/Settings.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { createHouseRoots } from '../home/index.js';
import { CollisionWorld } from '../core/Collision.js';
import { Input } from '../core/Input.js';
import { Emitter } from '../core/Events.js';
import { PlayerController } from '../player/PlayerController.js';
import { takdetaljerHus, takdetaljerSpec } from './takdetaljer-hus.js';

/**
 * Dev page for the roof details (notes/tak.md: halvvalm, pulttaksark i ytterveggen, piper; notes/vindusmodeller.md:
 * vinduer med skrå overkant): the test houses of src/dev/takdetaljer-hus.js, each its own house file built with the
 * game's own builders (buildLayout + buildRooms, as the planbygger's 3D view does), the sun from the south and a lamp
 * per room, a label per house, buttons for the views, «Tak» (hide ceilings and roofs: the dollhouse) and «Gå» (walk
 * with the game's player: WASD, the mouse after a click; the chimneys collide).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__bump(chimneyId, side)
 * (walks the game's player into a chimney from one side and returns how close it got), window.__td = { scene, camera,
 * renderer, houses, player, collision, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const EYE = 2.7 + 1.6; // on the loft of A
const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [25, 18, -26], look: [25, 1, 3] },
  aSor: { label: 'A: arken over balkongen (hus1)', pos: [5.8, 4.2, -11.5], look: [5.8, 4.3, 2] },
  aSkra: { label: 'A: sørvest', pos: [-7, 7, -9], look: [4, 4, 3] },
  aGavl: { label: 'A: halvvalm, gavl (vest)', pos: [-10.5, 5.2, 4], look: [0, 4.6, 4] },
  aPipe: { label: 'A: murpipa', pos: [-2.5, 9.5, 11], look: [2.2, 7.2, 4.7], fov: 45 },
  aLoft: { label: 'Inne: skrå vinduer i gavlen', pos: [2.9, EYE, 4.0], look: [0.3, 4.3, 4.0], fov: 75 },
  aArk: { label: 'Inne: arken', pos: [5.8, EYE, 5.4], look: [5.8, 4.4, 0.3], fov: 75 },
  aHalv: { label: 'Inne: halvvalmen (øst)', pos: [4.6, EYE - 0.4, 4.0], look: [9.7, 5.4, 4.0], fov: 80 },
  aStue: { label: 'Inne: pipa i stua', pos: [5.2, 1.6, 6.6], look: [2.2, 1.3, 4.7], fov: 70 },
  bVest: { label: 'B: pulttak, skrått vindu (vest)', pos: [11.6, 2.3, -2.8], look: [14.3, 2.5, 2.6], fov: 60 },
  bOst: { label: 'B: overlys og 15° (øst)', pos: [27.5, 2.6, 1.5], look: [21.7, 2.2, 2.4] },
  bInne: { label: 'Inne: B', pos: [20.4, 1.6, 1.5], look: [14.3, 2.3, 4.2], fov: 75 },
  cGavl: { label: 'C: speilvendte gavlvinduer', pos: [23.6, 3.2, 4], look: [30.3, 3.4, 4], fov: 60 },
  cPipe: { label: 'C: pipe på mønet', pos: [40.5, 8.5, -3.5], look: [34.6, 5.6, 4], fov: 45 },
  cInne: { label: 'Inne: C', pos: [36.5, 1.6, 4], look: [30.3, 3.3, 4], fov: 75 },
  dHalv: { label: 'D: bratt halvvalm', pos: [56, 4.5, -6], look: [47.5, 2.8, 3] },
  dukkehus: { label: 'Dukkehus', pos: [25, 28, -20], look: [25, -1, 3], ceil: false },
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfdbe6');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 400);
camera.rotation.order = 'YXZ';
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
const events = new Emitter();
const collision = new CollisionWorld();

configureMaterials({ quality });
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic']);

// ---- the houses, each its own layout (the cladding is one per house file)
const houses = [];
for (const h of takdetaljerHus()) {
  const layout = buildLayout(takdetaljerSpec(h.house), undefined, { devWarnings: false });
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const rooms = buildRooms({ scene, camera, renderer, quality, roots, collision }, layout, null);
  scene.add(...Object.values(roots.levels));
  if (rooms.group && !rooms.group.parent) scene.add(rooms.group);
  for (const c of rooms.colliders) {
    if (c?.isBox3) collision.addStaticBox(c);
    else if (c) collision.addStatic(c);
  }
  houses.push({ ...h, layout, roots, rooms });
}

// ---- the ground a step (0.15) under the main floors
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 110), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(25, -0.15, 3);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  ground.updateMatrixWorld(true);
  collision.addStatic(ground);
}
collision.build();
collision.setBounds(-50, 100, -50, 55);

// ---- light: sky, the sun from the south, a lamp in every room
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(33, 24, -22);
sun.target.position.set(25, 0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 24, bottom: -24, near: 1, far: 100 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const h of houses) {
  for (const r of h.layout.house.rooms) {
    if (r.hud || r.area < 0.5 || r.id === 'stue-kjokken') continue;
    const lamp = new THREE.PointLight('#ffe2bf', Math.max(3, r.area * 0.3), 0, 2);
    lamp.position.set(r.centroid.x + 0.7, r.floorY + 1.9, r.centroid.y + 0.4);
    scene.add(lamp);
  }
}

// ---- labels: the house over its roof
const labels = [];
for (const h of houses) {
  const b = h.layout.house.bounds;
  const top = Math.max(...h.layout.house.roofs.map((p) => p.ridgeY ?? 0), b.maxY);
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = h.name;
  labelsEl.appendChild(el);
  labels.push({ el, at: new THREE.Vector3((b.minX + b.maxX) / 2, top + 1.6, (b.minZ + b.maxZ) / 2) });
}
const showLabels = params.get('labels') !== '0';
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  const c = camera.position;
  const inside = houses.some((x) => !!x.layout.house.roomAt?.(c.x, c.y, c.z));
  for (const l of labels) {
    if (!showLabels || walking || inside) {
      l.el.style.display = 'none';
      continue;
    }
    const v = l.at.clone().project(camera);
    const vis = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    l.el.style.display = vis ? '' : 'none';
    if (vis) {
      l.el.style.left = `${((v.x + 1) / 2) * w}px`;
      l.el.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }
}

let ceilOn = params.get('ceil') !== '0';
function setCeilings(on) {
  ceilOn = on;
  for (const h of houses) for (const m of h.rooms.pickables.ceilings) m.visible = on;
  ceilBtn.classList.toggle('on', on);
}

// ---- walking: the game's player on the same collision (WASD, the mouse after a click)
const input = new Input(renderer.domElement, settings);
input.setEnabled?.(false);
const player = new PlayerController({ camera, collision, input, settings, events });
let walking = false;
function setWalking(on) {
  walking = on;
  controls.enabled = !on;
  input.setEnabled?.(on);
  walkBtn.classList.toggle('on', on);
  // into A's living room, facing the chimney
  if (on) player.teleport(new THREE.Vector3(5.0, 0, 6.2), Math.atan2(2.2 - 5.0, 4.7 - 6.2), 0);
}

/**
 * Walks the game's player into a chimney: from 1.5 m off the side `side` ('n' | 's' | 'e' | 'w') of its piece on
 * `levelId` (default its lowest), straight at its middle for 4 s. Returns { gap } – how far the body's front stayed
 * from the chimney's face (≈ the body's radius when it collides; negative: it walked in).
 */
window.__bump = (chimneyId, side = 's', levelId = null, hz = 60) => {
  const h = houses.find((x) => x.layout.house.chimneys.some((c) => c.id === chimneyId));
  const c = h.layout.house.chimneys.find((x) => x.id === chimneyId);
  const piece = c.pieces.find((p) => !levelId || p.levelId === levelId) ?? c.pieces[0];
  const dir = { n: [0, -1], s: [0, 1], e: [-1, 0], w: [1, 0] }[side];
  const half = Math.abs(dir[0]) ? c.size[0] / 2 : c.size[1] / 2;
  const start = [c.at[0] - dir[0] * (half + 1.5), c.at[1] - dir[1] * (half + 1.5)];
  const bot = { move: { forward: 1, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const real = player.input;
  player.input = bot;
  const yaw = Math.atan2(-dir[0], -dir[1]);
  player.teleport(new THREE.Vector3(start[0], piece.y0, start[1]), yaw, 0);
  for (let i = 0; i < 4 * hz; i++) {
    player.yaw = yaw;
    player.update(1 / hz);
  }
  player.input = real;
  const p = player.position;
  // the distance from the player's axis to the chimney's face, along the walk
  const along = (p.x - c.at[0]) * -dir[0] + (p.z - c.at[1]) * -dir[1];
  render();
  return { gap: +(along - half).toFixed(3), at: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] };
};

let last = 0;
function render() {
  const now = performance.now();
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  if (walking) {
    input.update(dt);
    player.update(dt);
    input.consumeClick?.();
    input.consumeAction?.('interact');
    input.consumeAction?.('pause');
    input.consumeAction?.('help');
  } else controls.update();
  renderer.render(scene, camera);
  placeLabels();
}

/** Moves the camera: __setView('<view key>') or __setView(pos, look, fov). */
window.__setView = (a, b, c) => {
  const v = typeof a === 'string' ? VIEWS[a] : { pos: a, look: b, fov: c };
  if (!v) return;
  if (walking) setWalking(false);
  camera.position.set(...v.pos);
  controls.target.set(...v.look);
  if (v.fov) camera.fov = v.fov;
  else if (typeof a === 'string') camera.fov = 55;
  camera.updateProjectionMatrix();
  if (typeof a === 'string') {
    setCeilings(v.ceil ?? true);
    for (const btn of bar.querySelectorAll('button[data-view]')) btn.classList.toggle('on', btn.dataset.view === a);
  }
  controls.update();
  render();
};

for (const [key, v] of Object.entries(VIEWS)) {
  const btn = document.createElement('button');
  btn.textContent = v.label;
  btn.dataset.view = key;
  btn.onclick = () => window.__setView(key);
  bar.appendChild(btn);
}
const ceilBtn = document.createElement('button');
ceilBtn.textContent = 'Tak';
ceilBtn.onclick = () => setCeilings(!ceilOn);
bar.appendChild(ceilBtn);
const walkBtn = document.createElement('button');
walkBtn.textContent = 'Gå (WASD)';
walkBtn.onclick = () => setWalking(!walking);
bar.appendChild(walkBtn);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
controls.addEventListener('change', placeLabels);

window.__td = { THREE, scene, camera, renderer, houses, player, collision, render };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
const nCh = houses.reduce((s, h) => s + h.layout.house.chimneys.length, 0);
const nSlope = houses.reduce((s, h) => s + h.layout.house.walls.flatMap((w) => w.openings).filter((o) => o.topSlope).length, 0);
info.textContent = `${houses.length} hus · ${nCh} piper · ${nSlope} vinduer med skrå overkant – dra for å se rundt, hjulet zoomer, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
