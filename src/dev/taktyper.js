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
import { taktyperHus, taktyperSpec } from './taktyper-hus.js';

/**
 * Dev page for the new roof types (notes/tak.md «Flere taktyper»): the test houses of src/dev/taktyper-hus.js, each its
 * own house file built with the game's own builders (buildLayout + buildRooms, as the planbygger's 3D view does), the
 * sun from the south and a lamp per room, a label per house, buttons for the views, «Tak» (hide ceilings and roofs: the
 * dollhouse) and «Gå» (walk with the game's player: WASD, the mouse after a click).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__tt = { scene, camera,
 * renderer, houses, player, collision, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const LOFT = 2.7 + 1.6; // eye height on a loft
const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [67, 52, -82], look: [67, 0, 5] },
  aL: { label: 'A: L-hus, sidefløy (nordøst)', pos: [19, 9, 21], look: [7, 3.6, 8] },
  aVf: { label: 'A: vindfang (sør)', pos: [2, 4.5, -10], look: [5, 2.8, 0] },
  bU: { label: 'B: U-hus (nord)', pos: [23, 11, 24], look: [23, 3.2, 6] },
  bKryss: { label: 'B: kryssark (sørøst)', pos: [36, 6.5, -9], look: [27.5, 3.6, 3] },
  bInne: { label: 'Inne: under kryssarken', pos: [26.4, 1.6, 2.0], look: [28, 3.6, 9.5], fov: 75 },
  cGavl: { label: 'C: skjevt saltak (sørvest)', pos: [30.6, 4.4, -7.5], look: [37.5, 3.8, 4.5] },
  cInne: { label: 'Inne: C', pos: [39, 1.6, 4.5], look: [34.3, 3.6, 4.5], fov: 75 },
  dMansard: { label: 'D: mansard med kvist', pos: [46, 6.5, -9], look: [53, 4.6, 2] },
  dInne: { label: 'Inne: mansardloftet', pos: [53, LOFT, 5.6], look: [53, 4.2, 0.2], fov: 75 },
  eValm: { label: 'E: valmet mansard', pos: [74.5, 7, -7], look: [66, 3.6, 3.5] },
  fFunkis: { label: 'F: funkis med parapet', pos: [87, 9, -9], look: [78, 4.6, 3.5] },
  fTak: { label: 'F: parapeten ovenfra', pos: [80.5, 10.5, -2.2], look: [78, 5.6, 3.2], fov: 50 },
  gAttika: { label: 'G: pulttak bak attika', pos: [97, 6, -6], look: [89.5, 2.6, 3] },
  hTerrasse: { label: 'H: innfelt takterrasse', pos: [102, 6.5, -8], look: [102, 4.4, 1.5] },
  hInne: { label: 'Inne: døra ut på terrassen', pos: [102, LOFT, 6.6], look: [102, 4.2, 1.5], fov: 75 },
  iArker: { label: 'I: valmet ark (sør)', pos: [113, 6.5, -8], look: [115.5, 4.8, 1] },
  iNord: { label: 'I: takopplett med tre vinduer', pos: [116, 8.5, 16], look: [116, 5, 6] },
  iInne: { label: 'Inne: takoppletten', pos: [116, LOFT, 3.2], look: [116, 5.4, 7.6], fov: 75 },
  jV: { label: 'J: V-tak (sørvest)', pos: [119.5, 6, -6], look: [129.5, 2.6, 3.5] },
  jInne: { label: 'Inne: V-taket', pos: [133, 1.6, 3.5], look: [125.5, 2.6, 3.5], fov: 75 },
  dukkehus: { label: 'Dukkehus', pos: [67, 70, -55], look: [67, -1, 5], ceil: false },
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
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 500);
camera.rotation.order = 'YXZ';
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
const events = new Emitter();
const collision = new CollisionWorld();

configureMaterials({ quality });
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic']);

// ---- the houses, each its own layout (the cladding is one per house file)
const houses = [];
for (const h of taktyperHus()) {
  const layout = buildLayout(taktyperSpec(h.house), undefined, { devWarnings: false });
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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 110), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(67, -0.15, 5);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  ground.updateMatrixWorld(true);
  collision.addStatic(ground);
}
collision.build();
collision.setBounds(-40, 175, -50, 60);

// ---- light: sky, the sun from the south, a lamp in every room
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(75, 26, -24);
sun.target.position.set(67, 0, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 30, bottom: -30, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const h of houses) {
  for (const r of h.layout.house.rooms) {
    if (r.hud || r.area < 0.5 || r.id === 'stue-kjokken') continue;
    const lamp = new THREE.PointLight('#ffe2bf', Math.max(3, r.area * 0.3), 0, 2);
    lamp.position.set(r.centroid.x + 0.5, r.floorY + 1.9, r.centroid.y + 0.4);
    scene.add(lamp);
  }
}

// ---- labels: the house over its roof (the middle of its roofs' outlines: the bounds hold the base's empty floor at 0, 0)
const labels = [];
for (const h of houses) {
  const pts = h.layout.house.roofs.flatMap((p) => p.outline);
  const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
  const top = Math.max(...h.layout.house.roofs.map((p) => p.ridgeY ?? 0));
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = h.name;
  labelsEl.appendChild(el);
  labels.push({ el, at: new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, top + 1.6, (Math.min(...zs) + Math.max(...zs)) / 2) });
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
  // into B's room under the cross gable
  if (on) player.teleport(new THREE.Vector3(27.5, 0, 2.5), Math.PI, 0);
}

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

window.__tt = { THREE, scene, camera, renderer, houses, player, collision, render };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
const nParts = houses.reduce((s, h) => s + h.layout.house.roofs.length, 0);
info.textContent = `${houses.length} hus · ${nParts} takdeler – dra for å se rundt, hjulet zoomer, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
