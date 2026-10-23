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
import { uteromHus, uteromSpec } from './uterom-hus.js';

/**
 * Dev page for the outdoor rooms (notes/uterom.md): the test house of src/dev/uterom-hus.js – a carport under a
 * terrace and a porch under the upper floor – built with the game's own builders (buildLayout + buildRooms, as the
 * planbygger's 3D view does), a ground at −0.15, the sun from the south, a warm lamp at every built-in light (the
 * carport's and the porch's downlights included), buttons for the views, «Tak» (hide ceilings and roofs: the
 * dollhouse), «Kveld» (dark sky, the lamps alone) and «Gå» (walk with the game's player: WASD, the mouse after a click).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, evening=1.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__ut = { scene, camera,
 * renderer, layout, rooms, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [16.5, 7.5, -9.5], look: [7, 1.6, 3.5] },
  carport: { label: 'Carporten', pos: [9.9, 1.6, -3.2], look: [9.9, 1.2, 5.3] },
  bodfront: { label: 'Bodfronten (F149)', pos: [9.6, 1.55, 1.2], look: [10.2, 1.1, 5.35], fov: 60 },
  vegg: { label: 'Husveggen i carporten', pos: [11.8, 1.5, 3.8], look: [7, 1.3, 2.4], fov: 60 },
  himling: { label: 'Himlingen', pos: [11.6, 0.9, 0.9], look: [8.6, 2.3, 3.6], fov: 60 },
  inngang: { label: 'Inngangen', pos: [-2.4, 1.6, -2.2], look: [1.6, 1.3, 1.6], fov: 60 },
  terrasse: { label: 'Terrassen', pos: [15.5, 6.2, 11], look: [9.5, 2.6, 4] },
  dukkehus: { label: 'Dukkehus', pos: [8, 16, -8], look: [8, 0, 4], ceil: false },
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
const SKY = new THREE.Color('#cfdbe6');
scene.background = SKY.clone();
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

// ---- the house
const h = uteromHus();
const layout = buildLayout(uteromSpec(h.house), undefined, { devWarnings: false });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const rooms = buildRooms({ scene, camera, renderer, quality, roots, collision }, layout, null);
scene.add(...Object.values(roots.levels));
if (rooms.group && !rooms.group.parent) scene.add(rooms.group);
for (const c of rooms.colliders) {
  if (c?.isBox3) collision.addStaticBox(c);
  else if (c) collision.addStatic(c);
}

// ---- the ground at −0.15 (one step under the main floor)
{
  const g = new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
  ground.position.set(6, -0.15, 4);
  ground.name = 'ground';
  ground.receiveShadow = true;
  scene.add(ground);
  ground.updateMatrixWorld(true);
  collision.addStatic(ground);
}
collision.build();
collision.setBounds(-50, 60, -50, 60);

// ---- light: sky, the sun from the south-east, a lamp at every built-in light of the house
const hemi = new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(16, 16, -14);
sun.target.position.set(7, 0, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const lamps = [];
for (const l of rooms.builtInLights) {
  const p = l.position ?? l.from;
  if (!p) continue;
  const spot = l.lightType === 'spot';
  const lamp = spot ? new THREE.SpotLight('#ffd9a8', 0, 9, (50 * Math.PI) / 180, 0.6, 2) : new THREE.PointLight('#ffe2bf', 0, 0, 2);
  lamp.position.copy(p).add(new THREE.Vector3(0, -0.03, 0));
  if (spot) {
    lamp.target.position.copy(p).add(new THREE.Vector3(0, -2, 0));
    scene.add(lamp.target);
  }
  lamp.userData.lumens = l.lumens ?? 600;
  lamp.userData.meshes = l.emissiveMeshes || [];
  scene.add(lamp);
  lamps.push(lamp);
}
let evening = params.get('evening') === '1';
function setEvening(on) {
  evening = on;
  scene.background = on ? new THREE.Color('#1b2230') : SKY.clone();
  hemi.intensity = on ? 0.06 : 1.2;
  sun.intensity = on ? 0 : 2.6;
  scene.environmentIntensity = on ? 0.04 : 0.5;
  for (const l of lamps) {
    l.intensity = (on ? 1 : 0.15) * (l.isSpotLight ? l.userData.lumens / 60 : l.userData.lumens / 120);
    for (const m of l.userData.meshes) if (m.material) m.material.emissiveIntensity = on ? 1 : 0;
  }
  eveningBtn?.classList.toggle('on', on);
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
function setWalking(on) {
  walking = on;
  controls.enabled = !on;
  input.setEnabled?.(on);
  walkBtn.classList.toggle('on', on);
  if (on) player.teleport(new THREE.Vector3(9.9, -0.15, -3), 0, 0);
}

function render() {
  if (walking) {
    input.update(1 / 60);
    player.update(1 / 60);
    input.consumeClick?.();
    input.consumeAction?.('interact');
    input.consumeAction?.('pause');
    input.consumeAction?.('help');
  } else controls.update();
  renderer.render(scene, camera);
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
const eveningBtn = document.createElement('button');
eveningBtn.textContent = 'Kveld';
eveningBtn.onclick = () => setEvening(!evening);
bar.appendChild(eveningBtn);
const walkBtn = document.createElement('button');
walkBtn.textContent = 'Gå (WASD)';
walkBtn.onclick = () => setWalking(!walking);
bar.appendChild(walkBtn);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

window.__ut = { THREE, scene, camera, renderer, layout, rooms, player, collision, render };
setEvening(evening);
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
info.textContent = `${h.name} – dra for å se rundt, hjulet zoomer, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
