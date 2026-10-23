import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../core/Settings.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { createHouseRoots } from '../home/index.js';
import { takHus, takSpec } from './tak-hus.js';

/**
 * Dev page for the roofs (notes/tak.md): the test houses of src/dev/tak-hus.js built with the game's own builders
 * (buildLayout + buildRooms, as the planbygger's 3D view does), a sky, the sun from the south and a lamp per room, a
 * label over every roof, buttons for the views outside and inside, and «Tak» to hide the ceilings and the roofs
 * together (the dollhouse view).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0 (hide ceilings and roofs), labels=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'),
 * window.__tak = { scene, camera, renderer, layout, rooms, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;

const EYE = 2.7 + 1.6; // on the loft
const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [35, 22, -24], look: [35, 2, 4] },
  aSor: { label: 'A: saltak og ark (sør)', pos: [3, 5.5, -10.5], look: [5, 4.2, 4] },
  aNord: { label: 'A: takopplett og takvindu (nord)', pos: [10, 9, 17], look: [5, 4.5, 4] },
  aGavl: { label: 'A: gavl (vest)', pos: [-9, 5, 6], look: [5, 4, 4] },
  bValm: { label: 'B: valmtak', pos: [28, 7.5, -8], look: [19, 2.5, 4] },
  cPult: { label: 'C: pulttak', pos: [40.5, 5, 13], look: [32, 2.5, 3] },
  dFlat: { label: 'D: flatt tak', pos: [49, 6, -7], look: [43, 2, 3] },
  eSaltak: { label: 'E: saltak 24°', pos: [63, 5.5, -7], look: [54, 3, 4.5] },
  fL: { label: 'F: L-hus', pos: [76, 8, 15], look: [67, 2.5, 5] },
  aSov: { label: 'Inne: loft med hanebjelke', pos: [4.6, EYE, 5.2], look: [1.6, 3.9, 1.0], fov: 75 },
  aArk: { label: 'Inne: arken', pos: [7.5, EYE, 6.2], look: [7.5, 4.4, 0.3], fov: 75 },
  aOpp: { label: 'Inne: takoppletten', pos: [7.0, EYE, 2.2], look: [7.0, 4.7, 7.2], fov: 75 },
  bStue: { label: 'Inne: valm, skrå himling', pos: [21.4, 1.6, 7.3], look: [21.4, 3.2, 1.0], fov: 75 },
  cStue: { label: 'Inne: pulttak', pos: [28.8, 1.6, 0.8], look: [34.5, 2.6, 5.4], fov: 75 },
  eStue: { label: 'Inne: skrå himling 24°', pos: [51.0, 1.6, 8.3], look: [53.8, 3.3, 1.0], fov: 75 },
  fInne: { label: 'Inne: L-huset', pos: [68.0, 1.6, 10.2], look: [67.5, 3.0, 3.0], fov: 75 },
  dukkehus: { label: 'Dukkehus', pos: [30, 28, -16], look: [34, 0, 4], ceil: false },
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
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;

configureMaterials({ quality });
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic']);
const house = takHus();
const layout = buildLayout(takSpec(house), undefined, { devWarnings: false });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const rooms = buildRooms({ scene, camera, renderer, quality, roots }, layout, null);
scene.add(...Object.values(roots.levels));
if (rooms.group && !rooms.group.parent) scene.add(rooms.group);

// ground a step under the floor, sky light, the sun from the south side (−z) and a lamp in every room
const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(35, -0.15, 4);
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(42, 22, -16);
sun.target.position.set(35, 0, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 26, bottom: -26, near: 1, far: 100 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const r of layout.house.rooms) {
  if (r.hud || r.area < 0.5 || r.id === 'stue-kjokken') continue;
  const lamp = new THREE.PointLight('#ffe2bf', Math.max(5, r.area * 0.7), 0, 2);
  lamp.position.set(r.centroid.x, r.floorY + 2.1, r.centroid.y);
  scene.add(lamp);
}

// labels: a name over every roof (outside), over every roof window and dormer (inside)
const labels = [];
const label = (text, at, inside) => {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = text;
  labelsEl.appendChild(el);
  labels.push({ el, at, inside });
};
for (const p of layout.house.roofs) {
  if (!p.name) continue;
  const cx = p.outline.reduce((s, q) => s + q[0], 0) / 4, cz = p.outline.reduce((s, q) => s + q[1], 0) / 4;
  label(p.name, new THREE.Vector3(cx, p.ridgeY + 0.8, cz), false);
  for (const d of p.dormers) {
    const F = d.frame;
    const x = F.O[0] + F.eu[0] * d.width / 2 + F.ev[0] * 0.6, z = F.O[1] + F.eu[1] * d.width / 2 + F.ev[1] * 0.6;
    label(d.ark ? 'Ark' : 'Takopplett', new THREE.Vector3(x, p.floorY + d.height - 0.25, z), true);
  }
}
for (const c of house.ceilings) for (const s of c.skylights || []) {
  const x = s.polygon.reduce((a, p) => a + p[0], 0) / 4, z = s.polygon.reduce((a, p) => a + p[1], 0) / 4;
  const lc = layout.house.ceilings.find((k) => k.id === c.id);
  label(s.name || s.id, new THREE.Vector3(x, lc.topAt(x, z) - 0.15, z), true);
}
const showLabels = params.get('labels') !== '0';
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  const c = camera.position;
  const inRoom = !!layout.house.roomAt?.(c.x, c.y, c.z);
  for (const l of labels) {
    if (!showLabels || l.inside !== inRoom) {
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

window.__tak = { THREE, scene, camera, renderer, layout, rooms, render };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
info.textContent = `${layout.house.roofs.length} tak · ${layout.house.roofs.reduce((s, p) => s + p.dormers.length, 0)} arker · ${house.ceilings.flatMap((c) => c.skylights || []).length} takvinduer – dra for å se rundt, hjulet zoomer`;
renderer.setAnimationLoop(render);
window.__ready = true;
