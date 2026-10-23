import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY, Settings } from '../core/Settings.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { createHouseRoots } from '../home/index.js';
import { furnishingKinds } from '../home/furnish.js';
import { CollisionWorld } from '../core/Collision.js';
import { Input } from '../core/Input.js';
import { Emitter } from '../core/Events.js';
import { PlayerController } from '../player/PlayerController.js';
import { mobleringHus, mobleringSpec } from './moblering-hus.js';

/**
 * Dev page for the furnishing of generated houses (notes/moblering-genererte-hus.md): the test house of
 * src/dev/moblering-hus.js (a planbygger document exported by the planbygger, with `furnishing`), built with the game's
 * own builders the way the planbygger's 3D view does it (buildLayout + buildRooms: the furniture comes with the rooms,
 * its colliders in rooms.colliders), the sun from the south and a lamp per room, a label per room (its use and the
 * number of pieces), buttons for the views, «Tak» (hide the ceilings: the dollhouse), «Navn» and «Gå» (walk with the
 * game's player: WASD, the mouse after a click; the furniture stops you).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__walkTo(x, z, { from,
 * hz }) (walks the game's player straight from `from` [x, z] to (x, z) and returns where it ended),
 * window.__mb = { scene, camera, renderer, layout, rooms, furniture, fallbacks, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

// game coordinates of the test house: x 0–9 (north → south), z 0–12 (east → west)
const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [15.5, 13, 6], look: [4.5, 0, 6], ceil: false },
  ovenfra: { label: 'Ovenfra', pos: [4.6, 17, 6.01], look: [4.6, 0, 6], fov: 45, ceil: false },
  stue: { label: 'Stue/kjøkken', pos: [8.4, 1.6, 9.2], look: [5.6, 0.8, 4.0], fov: 70 },
  stueGang: { label: 'Stua fra gangen', pos: [5.4, 1.6, 8.3], look: [8.2, 0.7, 4.6], fov: 75 },
  sov1: { label: 'Soverom 1', pos: [3.3, 1.6, 8.9], look: [0.8, 0.6, 10.6], fov: 75 },
  sov2: { label: 'Soverom 2 og 3', pos: [4.6, 6.5, 2.2], look: [1.6, 0, 2.2], fov: 60, ceil: false },
  kontor: { label: 'Kontor', pos: [5.5, 1.6, 1.4], look: [7.6, 0.7, 0.6], fov: 75 },
  entre: { label: 'Entré og gang', pos: [4.4, 5.5, 13.5], look: [4.6, 0, 8.5], fov: 60, ceil: false },
  bad: { label: 'Bad og vaskerom', pos: [4.4, 6, 7.6], look: [1.6, 0, 6.6], fov: 60, ceil: false },
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

// ---- the house: the planbygger's export with `furnishing`, on the planbygger's empty base
const T = mobleringHus();
const layout = buildLayout(mobleringSpec(T.house), undefined, { devWarnings: false });
configureMaterials({ quality });
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic', ...furnishingKinds(layout)]);
const fallbacks = [];
const warn = console.warn;
console.warn = (...a) => {
  if (String(a[0]).includes('[registry]')) fallbacks.push(String(a[0]));
  warn(...a);
};
const roots = createHouseRoots(layout, [new THREE.Group()]);
const rooms = buildRooms({ scene, camera, renderer, quality, roots }, layout, null);
console.warn = warn;
scene.add(...Object.values(roots.levels));
if (rooms.group && !rooms.group.parent) scene.add(rooms.group);
for (const c of rooms.colliders) {
  if (c?.isBox3) collision.addStaticBox(c);
  else if (c) collision.addStatic(c);
}
const furniture = rooms.furniture;

// ---- the ground: one step under the floor
{
  const g = new THREE.PlaneGeometry(80, 80);
  g.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
  ground.position.set(4.5, -0.15, 6);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  ground.updateMatrixWorld(true);
  collision.addStatic(ground);
}
collision.build();
collision.setBounds(-30, 40, -30, 40);

// ---- light: sky, the sun from the south, a lamp in every room
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(16, 14, 2);
sun.target.position.set(4.5, 0, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const r of layout.house.rooms) {
  if (r.hud || r.area < 0.5) continue;
  const lamp = new THREE.PointLight('#ffe2bf', Math.max(5, r.area * 0.7), 0, 2);
  lamp.position.set(r.centroid.x, r.floorY + 2.1, r.centroid.y);
  scene.add(lamp);
}

// ---- labels: the room's name, its use and its pieces
const USE = { living: 'stue', kitchen: 'kjøkken', dining: 'spisestue', bedroom: 'soverom', office: 'kontor', hall: 'gang', entrance: 'entré', bathroom: 'bad', wc: 'wc', laundry: 'vaskerom', storage: 'bod', wardrobe: 'garderobe' };
const labels = [];
for (const r of layout.house.rooms) {
  const res = furniture?.rooms?.[r.id];
  if (!res) continue;
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = `${r.name} (${USE[res.use] ?? res.use}): ${res.items.length} møbler`;
  labelsEl.appendChild(el);
  labels.push({ el, at: new THREE.Vector3(r.centroid.x, r.floorY + 2.6, r.centroid.y) });
}
let showLabels = params.get('labels') !== '0';
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labels) {
    if (!showLabels || walking) {
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
  for (const m of rooms.pickables.ceilings) m.visible = on;
  ceilBtn.classList.toggle('on', on);
}

// ---- walking: the game's player on the same collision (WASD, the mouse after a click)
const input = new Input(renderer.domElement, settings);
input.setEnabled?.(false);
const player = new PlayerController({ camera, collision, input, settings, events });
let walking = false;
const front = layout.house.doors.find((d) => (d.connects || []).includes('ute') || (d.connects || []).length < 2);
function setWalking(on) {
  walking = on;
  controls.enabled = !on;
  input.setEnabled?.(on);
  walkBtn.classList.toggle('on', on);
  if (on && front) {
    const n = front.normal, b = front.bottomCenter;
    player.teleport(new THREE.Vector3(b.x + n.x * 0.8, 0, b.z + n.z * 0.8), Math.atan2(n.x, n.z), 0);
  }
}

/** Walks the game's player straight from `from` (default: inside the front door) to (x, z); returns where it ended. */
window.__walkTo = (x, z, { from = null, hz = 60, seconds = 12 } = {}) => {
  const bot = { move: { forward: 1, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const real = player.input;
  player.input = bot;
  const p = from ?? [front.bottomCenter.x + front.normal.x * 0.8, front.bottomCenter.z + front.normal.z * 0.8];
  const yaw = Math.atan2(-(x - p[0]), -(z - p[1]));
  player.teleport(new THREE.Vector3(p[0], 0, p[1]), yaw, 0);
  for (let i = 0; i < seconds * hz; i++) {
    const dx = x - player.position.x, dz = z - player.position.z;
    if (Math.hypot(dx, dz) < 0.15) break;
    player.yaw = Math.atan2(-dx, -dz);
    player.update(1 / hz);
  }
  player.input = real;
  render();
  return { x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), left: +Math.hypot(x - player.position.x, z - player.position.z).toFixed(2) };
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
  rooms.update?.(dt, {});
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
  camera.fov = v.fov ?? 55;
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
const nameBtn = document.createElement('button');
nameBtn.textContent = 'Navn';
nameBtn.classList.toggle('on', showLabels);
nameBtn.onclick = () => {
  showLabels = !showLabels;
  nameBtn.classList.toggle('on', showLabels);
  placeLabels();
};
bar.appendChild(nameBtn);
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

window.__mb = { THREE, scene, camera, renderer, layout, rooms, furniture, fallbacks, player, collision, render };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
info.textContent = `${furniture?.items.length ?? 0} møbler i ${Object.keys(furniture?.rooms ?? {}).length} rom – dra for å se rundt, hjulet zoomer, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
