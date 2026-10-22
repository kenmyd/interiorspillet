import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../core/Settings.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { createHouseRoots } from '../home/index.js';
import { vinduerHus, vinduerSpec } from './vinduer-hus.js';

/**
 * Dev page for the window models (notes/vindusmodeller.md): the test house of src/dev/vinduer-hus.js built with the
 * game's own builders (buildLayout + buildRooms, as the planbygger's 3D view does), a simple sky, sun and room light,
 * a label over every window and roof window, buttons for the views and the ceiling.
 *
 * URL params: view=<key of VIEWS> (default sor), ceil=0 (hide the ceilings), labels=0.
 * Globals: window.__ready (true once rendered), window.__setView(pos, look, fov) | __setView('<view key>'),
 * window.__vinduer = { scene, camera, renderer, layout, rooms, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;

const VIEWS = {
  sor: { label: 'Sør utenfra', pos: [8, 1.7, -8.5], look: [8, 1.3, 0] },
  nord: { label: 'Nord utenfra', pos: [8, 1.7, 14.5], look: [8, 1.3, 6] },
  vest: { label: 'Vest utenfra', pos: [-6.5, 1.7, 3], look: [0, 1.3, 3] },
  ost: { label: 'Øst utenfra', pos: [22.5, 1.7, 3], look: [16, 1.3, 3] },
  inneSor: { label: 'Inne mot sør', pos: [8, 1.6, 5.6], look: [8, 1.3, 0] },
  inneNord: { label: 'Inne mot nord', pos: [8, 1.6, 0.4], look: [8, 1.3, 6] },
  gulv: { label: 'Gulvvindu nær', pos: [14.2, 1.5, 2.2], look: [14.2, 0.3, 0] },
  tak: { label: 'Takvinduer', pos: [7.1, 0.5, 5.8], look: [7.1, 2.7, 3.0], fov: 80 },
  topp: { label: 'Ovenfra', pos: [8, 16, -6], look: [8, 0, 3], ceil: false },
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
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;

configureMaterials({ quality });
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic']);
const house = vinduerHus();
const layout = buildLayout(vinduerSpec(house), undefined, { devWarnings: false });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const rooms = buildRooms({ scene, camera, renderer, quality, roots }, layout, null);
scene.add(...Object.values(roots.levels));
if (rooms.group && !rooms.group.parent) scene.add(rooms.group);

// ground a step under the floor, sky light, the sun from the south side (−z) and a lamp in the room
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(8, -0.15, 3);
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(13, 14, -9);
sun.target.position.set(8, 0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const lamp = new THREE.PointLight('#ffe2bf', 10, 0, 2);
lamp.position.set(8, 2.2, 3);
scene.add(lamp);

// labels: over each window on the side the camera is on, under each roof window
const labels = [];
for (const o of house.walls.flatMap((w) => w.openings)) {
  const lo = layout.house.opening(o.id);
  if (!lo) continue;
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = o.name;
  labelsEl.appendChild(el);
  labels.push({ el, top: lo.topCenter.clone(), normal: lo.normal.clone(), depth: layout.house.wallsById[lo.wallId]?.thickness ?? 0.3 });
}
for (const c of house.ceilings) for (const s of c.skylights || []) {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = s.name || s.id;
  labelsEl.appendChild(el);
  const [x, z] = [s.polygon.reduce((a, p) => a + p[0], 0) / 4, s.polygon.reduce((a, p) => a + p[1], 0) / 4];
  labels.push({ el, at: new THREE.Vector3(x, c.height - 0.08, z), sky: true });
}
const showLabels = params.get('labels') !== '0';
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  const c = camera.position;
  const inRoom = layout.house.roomsById.galleri?.contains(c.x, c.z) && c.y > 0 && c.y < 2.6;
  for (const l of labels) {
    let p;
    if (l.sky) {
      p = _p.copy(l.at);
      if (!inRoom || !ceilOn) {
        l.el.style.display = 'none';
        continue;
      }
    } else {
      // inside: every window, on its room face; outside: only the windows of the walls the camera stands outside of
      const outside = _d.copy(c).sub(l.top).dot(l.normal) < 0;
      if (!inRoom && !outside) {
        l.el.style.display = 'none';
        continue;
      }
      p = _p.copy(l.top).addScaledVector(l.normal, outside ? -l.depth - 0.02 : 0.02).add(new THREE.Vector3(0, outside ? 0.14 : 0.08, 0));
    }
    const v = p.clone().project(camera);
    const vis = showLabels && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
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

function render() {
  controls.update();
  renderer.render(scene, camera);
  placeLabels();
}

/** Moves the camera: __setView('<view key>') or __setView(pos, look, fov). */
window.__setView = (a, b, c) => {
  const v = typeof a === 'string' ? VIEWS[a] : { pos: a, look: b, fov: c };
  if (!v) return;
  camera.position.set(...v.pos);
  controls.target.set(...v.look);
  if (v.fov) camera.fov = v.fov;
  else if (typeof a === 'string') camera.fov = 55;
  camera.updateProjectionMatrix();
  if (typeof a === 'string') {
    setCeilings(v.ceil ?? true);
    for (const btn of bar.querySelectorAll('button[data-view]')) btn.classList.toggle('on', btn.dataset.view === a);
  }
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

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
controls.addEventListener('change', placeLabels);

/** Close-up of one window: __closeUp('<name or id>', 'ute' | 'inne', distance = 2.2 × its size). */
window.__closeUp = (key, side = 'ute', dist = null) => {
  const raw = house.walls.flatMap((w) => w.openings).find((o) => o.id === key || o.name === key);
  const o = raw && layout.house.opening(raw.id);
  if (!o) return null;
  const d = dist ?? Math.max(1.2, 1.25 * Math.max(o.width, o.height));
  const pos = o.center.clone().addScaledVector(o.normal, side === 'inne' ? d : -d - 0.3);
  window.__setView(pos.toArray(), o.center.toArray(), 50);
  return raw.id;
};

window.__vinduer = { scene, camera, renderer, layout, rooms, render };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'sor');
if (params.get('ceil') === '0') setCeilings(false);
info.textContent = `${house.walls.flatMap((w) => w.openings).length} vinduer · ${house.ceilings.flatMap((c) => c.skylights || []).length} takvinduer – dra for å se rundt, hjulet zoomer`;
renderer.setAnimationLoop(render);
window.__ready = true;
