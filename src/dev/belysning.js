import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../core/Settings.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { createHouseRoots } from '../home/index.js';
import { buildStairs } from '../home/stairs.js';
import { LampRig } from '../home/lamprig.js';
import { belysningHus, mergeOnto, baseSpec } from './belysning-hus.js';

/**
 * Dev page for the lighting of generated houses (notes/belysning-genererte-hus.md): the lighting test house
 * (src/dev/belysning-hus.js) – or a house file (?file=/.shots/belysning-hus1.json, `lighting` added when it has none) –
 * built with the game's builders (buildLayout + buildRooms, as the planbygger's 3D view does), lit by home/lamprig.js:
 * a fixed pool of lights handed to the lamps near the camera, every lamp's glow by its group. Buttons for the views,
 * evening / day, the ceilings and the loft; the groups with on/off and dimmer on the right.
 *
 * URL params: view=<key>, mode=evening|day, level=basic|standard|rich, pools=<point>,<spot>, shadows=<n>, ceil=0,
 * file=<url>.
 * Globals: window.__ready, window.__setView(key | pos, look, fov), window.__bench({ lamps: 'rig'|'naive'|'none',
 * frames }) → { ms, compileMs, calls, triangles, programs, lights }, window.__belysning = { scene, camera, renderer,
 * layout, rooms, rig, render }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const panel = document.getElementById('groups');
const quality = QUALITY.medium ?? QUALITY.high;

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
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.03, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;

configureMaterials({ quality });
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic']);

// ---- the house
let house, frame = null;
const level = ['basic', 'standard', 'rich'].includes(params.get('level')) ? params.get('level') : 'standard';
if (params.get('file')) {
  house = await (await fetch(params.get('file'))).json();
  if (!house.lighting) house.lighting = { level };
  else house.lighting.level ??= level;
} else {
  const made = belysningHus({ level });
  house = made.house;
  frame = made.frame;
}
const t0 = performance.now();
const layout = buildLayout(mergeOnto(baseSpec(), house), undefined, { devWarnings: true });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const rooms = buildRooms({ scene, camera, renderer, quality, roots }, layout, null);
const stairs = layout.house.stairs.length ? buildStairs({ scene, camera, renderer, quality, roots }, layout) : null;
const buildMs = performance.now() - t0;
scene.add(...Object.values(roots.levels));
for (const p of [rooms, stairs]) if (p?.group && !p.group.parent) scene.add(p.group);
const H = layout.house;
const b = H.bounds;
const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
const mainY = H.levelsById.hoved?.floorY ?? 0;

// ground, sky light and the sun (the sun and most of the sky only by day)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 8, size * 8), new THREE.MeshStandardMaterial({ color: '#6f7d5a', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(cx, mainY - 0.15, cz);
ground.receiveShadow = true;
scene.add(ground);
const hemi = new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3df', 2.4);
sun.position.set(cx + size * 1.2, mainY + size * 1.4, cz + size * 0.5);
sun.target.position.set(cx, mainY, cz);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 0.5, far: size * 5 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---- the lamps
const [pp, sp] = (params.get('pools') || '4,4').split(',').map(Number);
const rig = new LampRig({ scene, layout, lights: rooms.builtInLights, pools: { point: pp || 4, spot: sp || 4 }, shadows: Number(params.get('shadows')) || 0 });
let mode = params.get('mode') === 'day' ? 'day' : 'evening';
function setMode(m) {
  mode = m;
  rig.setMode(m);
  const day = m === 'day';
  scene.background = new THREE.Color(day ? '#cfdbe6' : '#141a24');
  hemi.intensity = day ? 1.1 : 0.06;
  hemi.color.set(day ? '#e8f0ff' : '#6f86b8');
  sun.visible = day;
  scene.environmentIntensity = day ? 0.5 : 0.03;
  for (const btn of bar.querySelectorAll('button[data-mode]')) btn.classList.toggle('on', btn.dataset.mode === m);
  drawPanel();
}

// ---- views: from the test house's plan (metres) when it is the test house, else from the bounds
const G = (p, lv = 'hoved', y = 1.6) => {
  const q = frame.toGame(p, lv);
  return [q[0], (H.levelsById[lv]?.floorY ?? 0) + y, q[1]];
};
const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [cx - size * 0.9, mainY + size * 0.9, cz + size * 0.9], look: [cx, mainY + 1, cz] },
  dukkehus: { label: 'Dukkehus', pos: [cx + size * 0.2, mainY + size * 1.5, cz + size * 0.6], look: [cx, mainY, cz], ceil: false, loft: false },
};
if (frame) {
  Object.assign(VIEWS, {
    kjokken: { label: 'Kjøkken og stue', pos: G([5.4, 4.6]), look: G([1.6, 1.4], 'hoved', 1.1), fov: 72 },
    trapp: { label: 'Trappa', pos: G([10.6, 4.6]), look: G([7.2, 3.1], 'hoved', 2.4), fov: 72 },
    bad: { label: 'Bad', pos: G([8.7, 7.6]), look: G([6.1, 6.3], 'hoved', 1.6), fov: 75 },
    soverom: { label: 'Soverom', pos: G([5.5, 7.6]), look: G([0.4, 6.5], 'hoved', 1.0), fov: 72 },
    loft: { label: 'Loftsstue (skrå himling)', pos: G([5.5, 4.4], 'etasje-2'), look: G([0.3, 2.6], 'etasje-2', 1.7), fov: 78 },
    kontor: { label: 'Kontor (under skråtaket)', pos: G([10.6, 2.3], 'etasje-2'), look: G([6.6, 0.4], 'etasje-2', 1.6), fov: 75 },
    inngang: { label: 'Inngang og carport', pos: G([4.5, -6.5], 'hoved', 1.7), look: G([9, 0], 'hoved', 1.6), fov: 60 },
    terrasse: { label: 'Terrassen', pos: G([-6.5, 6.5], 'hoved', 2.0), look: G([0, 2.5], 'hoved', 1.4), fov: 60 },
  });
}

let ceilOn = params.get('ceil') !== '0';
let loftOn = true;
function setCeilings(on) {
  ceilOn = on;
  for (const m of rooms.pickables.ceilings) m.visible = on;
  for (const o of scene.children) if (o.name === 'roofs' || /^roof/.test(o.name)) o.visible = on;
  ceilBtn.classList.toggle('on', on);
}
function setLoft(on) {
  loftOn = on;
  for (const [id, g] of Object.entries(roots.levels)) if (id !== 'hoved' && (H.levelsById[id]?.floorY ?? 0) > mainY + 0.5) g.visible = on;
  loftBtn.classList.toggle('on', on);
}

function render() {
  controls.update();
  rig.update(camera);
  renderer.render(scene, camera);
}

window.__setView = (a, bb, c) => {
  const v = typeof a === 'string' ? VIEWS[a] : { pos: a, look: bb, fov: c };
  if (!v) return;
  camera.position.set(...v.pos);
  controls.target.set(...v.look);
  camera.fov = v.fov ?? 60;
  camera.updateProjectionMatrix();
  if (typeof a === 'string') {
    setCeilings(v.ceil ?? true);
    setLoft(v.loft ?? true);
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
for (const [m, label] of [['evening', 'Kveld'], ['day', 'Dag']]) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset.mode = m;
  btn.onclick = () => setMode(m);
  bar.appendChild(btn);
}
const ceilBtn = document.createElement('button');
ceilBtn.textContent = 'Tak';
ceilBtn.onclick = () => setCeilings(!ceilOn);
bar.appendChild(ceilBtn);
const loftBtn = document.createElement('button');
loftBtn.textContent = '2. etasje';
loftBtn.onclick = () => setLoft(!loftOn);
bar.appendChild(loftBtn);

/** The groups: on/off and dimmer. */
function drawPanel() {
  panel.replaceChildren();
  const h3 = document.createElement('h3');
  h3.textContent = `Lysgrupper (${rig.groups.length})`;
  panel.appendChild(h3);
  for (const g of rig.groups) {
    const row = document.createElement('div');
    row.className = 'grp';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: g.on });
    cb.onchange = () => rig.setGroup(g.id, { on: cb.checked });
    const lb = document.createElement('label');
    lb.textContent = `${g.label} (${g.lamps})`;
    lb.title = `${g.id} · auto: ${g.auto}`;
    const sl = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, value: Math.round(g.dimmer * 100) });
    sl.oninput = () => rig.setGroup(g.id, { dimmer: sl.value / 100 });
    row.append(cb, lb, sl);
    panel.appendChild(row);
  }
}

// ---- measuring: frame time of the current view with the rig, with one point light per lamp (the planbygger's 3D view
//      today), and without lamps; gl.finish via a 1-pixel read after every frame
const naive = new THREE.Group();
naive.name = 'naive-lamps';
for (const l of rooms.builtInLights) {
  const p = l.position ?? (l.from && l.to ? l.from.clone().add(l.to).multiplyScalar(0.5) : null);
  if (!p) continue;
  const pl = new THREE.PointLight('#ffe2bf', 4, 0, 2);
  pl.position.copy(p).add(new THREE.Vector3(0, -0.25, 0));
  naive.add(pl);
}
window.__bench = async ({ lamps = 'rig', frames = 120 } = {}) => {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  rig.group.visible = lamps === 'rig';
  if (lamps === 'naive') scene.add(naive);
  else naive.removeFromParent();
  let lights = 0;
  scene.traverseVisible((o) => {
    if (o.isLight && !o.isHemisphereLight && !o.isAmbientLight && o.intensity > 0) lights++;
  });
  const p0 = renderer.info.programs?.length ?? 0;
  let t = performance.now();
  rig.update(camera, 1);
  renderer.render(scene, camera);
  finish();
  const compileMs = performance.now() - t;
  for (let i = 0; i < 10; i++) {
    renderer.render(scene, camera);
    finish();
  }
  t = performance.now();
  for (let i = 0; i < frames; i++) {
    renderer.render(scene, camera);
    finish();
  }
  const ms = (performance.now() - t) / frames;
  const out = { lamps, ms: Math.round(ms * 100) / 100, compileMs: Math.round(compileMs), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? 0, newPrograms: (renderer.info.programs?.length ?? 0) - p0, lights };
  rig.group.visible = true;
  naive.removeFromParent();
  return out;
};

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

window.__belysning = { THREE, scene, camera, renderer, layout, rooms, rig, render };
setMode(mode);
window.__setView(VIEWS[params.get('view')] ? params.get('view') : frame ? 'kjokken' : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
const st = H.lightPlan?.stats;
info.textContent = `${st?.lights ?? H.builtInLights.length} lys i ${st?.groups ?? '?'} grupper (${Object.entries(st?.byType ?? {}).map(([k, n]) => `${n} ${k}`).join(', ')}) · rigg: ${rig.stats.pool} lys, ${rig.stats.candidates} kandidater · bygget på ${Math.round(buildMs)} ms – dra for å se rundt`;
renderer.setAnimationLoop(render);
window.__ready = true;
