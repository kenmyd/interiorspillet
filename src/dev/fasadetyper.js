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
import { fasadetyperHus, fasadetyperSpec } from './fasadetyper-hus.js';

/**
 * Dev page for the facade types (notes/vindusmodeller.md: glassvegg, hjørnevindu, gavlvinduer, rundt vindu, fransk
 * balkong; notes/dortyper.md: garasjeport, ytterdør med overlys, dør i glassvegg): the test houses of
 * src/dev/fasadetyper-hus.js, each its own house file built with the game's own builders (buildLayout + buildRooms, as
 * the planbygger's 3D view does), the sun from the south and a lamp per room, a label per window and door, buttons for
 * the views, «Tak» (hide ceilings and roofs), «Dører» (open / close every door) and «Gå» (walk with the game's player:
 * WASD, the mouse after a click; the railings of the french balconies stop it).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0, open=1.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__ft = { scene, camera,
 * renderer, houses, player, collision, render(), open(id | null, on) }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [11, 13, -19], look: [11, 2, 3] },
  aSor: { label: 'A: glassvegg og dør i glassvegg', pos: [4.8, 2.0, -7.5], look: [4.8, 1.3, 0] },
  aHjorne: { label: 'A: hjørnevindu (sørøst)', pos: [14.2, 1.8, -4.2], look: [9.7, 1.4, 0.4] },
  aVest: { label: 'A: femkantet gavlvindu (vest)', pos: [-7.5, 2.8, 3.5], look: [0, 2.8, 3.5] },
  aOst: { label: 'A: trekant og rundt vindu (øst)', pos: [17.5, 2.8, 3.5], look: [10, 3, 3.5] },
  aInneVest: { label: 'Inne: gavlvinduet', pos: [6.5, 1.6, 3.5], look: [0.3, 2.6, 3.5], fov: 70 },
  aInneHjorne: { label: 'Inne: hjørnevinduet', pos: [7.2, 1.5, 2.8], look: [9.7, 1.4, 0.3], fov: 70 },
  aInneSor: { label: 'Inne: glassveggen', pos: [5, 1.6, 5.6], look: [5, 1.2, 0.3], fov: 70 },
  bSor: { label: 'B: leddport, overlys, franske balkonger', pos: [18, 3.0, -9.5], look: [18, 2.8, 0] },
  bBalkong: { label: 'B: franske balkonger nær', pos: [18, 4.4, -4.2], look: [18, 4.0, 0] },
  bInne: { label: 'Inne: fransk balkong', pos: [16.2, 2.9 + 1.6, 3.5], look: [15.6, 2.9 + 1.0, 0.3], fov: 70 },
  bGarasje: { label: 'Inne: garasjen', pos: [17.2, 1.4, 5.5], look: [15.8, 1.6, 0.3], fov: 75 },
  dukkehus: { label: 'Dukkehus', pos: [11, 24, -14], look: [11, -1, 3.5], ceil: false },
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
for (const h of fasadetyperHus()) {
  const layout = buildLayout(fasadetyperSpec(h.house), undefined, { devWarnings: false });
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const rooms = buildRooms({ scene, camera, renderer, quality, roots, collision, events }, layout, null);
  scene.add(...Object.values(roots.levels));
  if (rooms.group && !rooms.group.parent) scene.add(rooms.group);
  for (const c of rooms.colliders) {
    if (c?.isBox3) collision.addStaticBox(c);
    else if (c) collision.addStatic(c);
  }
  houses.push({ ...h, layout, roots, rooms });
}
const doors = houses.flatMap((h) => h.rooms.doors);

// ---- the ground a step (0.15) under the main floors
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(11, -0.15, 3);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  ground.updateMatrixWorld(true);
  collision.addStatic(ground);
}
collision.build();
collision.setBounds(-50, 70, -45, 50);

// ---- light: sky, the sun from the south, a lamp in every room
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(19, 22, -20);
sun.target.position.set(11, 0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 20, bottom: -20, near: 1, far: 90 });
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

// ---- labels: over each named window and door, on the side the camera is on
const labels = [];
for (const h of houses) {
  for (const w of h.house.walls) {
    for (const o of w.openings || []) {
      if (!o.name) continue;
      const lo = h.layout.house.opening?.(o.id);
      if (!lo) continue;
      const el = document.createElement('div');
      el.className = 'lbl';
      el.textContent = o.name;
      labelsEl.appendChild(el);
      labels.push({ el, key: h.key, top: lo.topCenter.clone(), normal: lo.normal.clone(), depth: w.thickness ?? 0.3 });
    }
  }
}
const showLabels = params.get('labels') !== '0';
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  const c = camera.position;
  // inside a house: its own openings on their room side; outside: the ones on the facades facing the camera
  const inHouse = houses.find((x) => !!x.layout.house.roomAt?.(c.x, c.y, c.z));
  for (const l of labels) {
    const outside = _d.copy(c).sub(l.top).dot(l.normal) < 0;
    if (inHouse ? l.key !== inHouse.key || outside : !outside) {
      l.el.style.display = 'none';
      continue;
    }
    const p = _p.copy(l.top).addScaledVector(l.normal, outside ? -l.depth - 0.02 : 0.02).add(new THREE.Vector3(0, outside ? 0.16 : 0.08, 0));
    const v = p.clone().project(camera);
    const vis = showLabels && !walking && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && c.distanceTo(l.top) < 14;
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
  // into B's upper bedroom, facing the french balcony
  if (on) player.teleport(new THREE.Vector3(15.6, 2.9, 3.2), Math.PI, 0);
}

/** Opens (on) or closes every door, or the one with id. */
function openDoors(id = null, on = true) {
  for (const d of doors) if (!id || d.id === id) d.door.setOpen(on);
  doorsBtn.classList.toggle('on', doors.some((d) => d.door.isOpen));
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
  const state = { playerPosition: walking ? player.position : null };
  for (const h of houses) h.rooms.update?.(dt, state);
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
const doorsBtn = document.createElement('button');
doorsBtn.textContent = 'Dører';
doorsBtn.onclick = () => openDoors(null, !doors.some((d) => d.door.isOpen));
bar.appendChild(doorsBtn);
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

window.__ft = { THREE, scene, camera, renderer, houses, player, collision, render, open: openDoors };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
if (params.get('open') === '1') for (const d of doors) d.door.setOpen(true, { instant: true });
const nOpen = houses.reduce((s, h) => s + h.house.walls.flatMap((w) => w.openings || []).filter((o) => o.name).length, 0);
info.textContent = `${houses.length} hus · ${nOpen} fasadetyper – dra for å se rundt, hjulet zoomer, «Dører» åpner alle, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
