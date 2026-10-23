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
import { peisHus, peisSpec } from './peis-hus.js';

/**
 * Dev page for fireplaces and stoves (notes/peis-og-ovn.md): the test houses of src/dev/peis-hus.js, each its own house
 * file built with the game's own builders (buildLayout + buildRooms, as the planbygger's 3D view does), the sun from the
 * south and a lamp per room, a label per house, buttons for the views, «Tak» (hide ceilings and roofs: the dollhouse),
 * «Kveld» (the sun down and the lamps off: only the fires light the rooms), «Ild» (the fires on and off) and «Gå» (walk
 * with the game's player: WASD, the mouse after a click; the fireplaces and chimneys collide).
 *
 * The game's LightManager is not used here (a customer's house has none yet): each fire's builtInLights entry
 * (type 'fire') becomes a flickering point light, and the flames follow the embers' glow as with the LightManager.
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0, evening=1, fire=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__bump(fireplaceId)
 * (walks the game's player at a fireplace's front and returns how close it got), window.__fires(on), window.__evening(on),
 * window.__pk = { scene, camera, renderer, houses, player, collision, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const UP2 = 2.7 + 1.6; // eye height upstairs in A
const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [25, 18, -26], look: [25, 1, 3] },
  aUte: { label: 'A: stålpipa (hus4)', pos: [15.5, 10.5, -7], look: [4.5, 6.2, 5], fov: 45 },
  aOvn: { label: 'A: vedovn oppe', pos: [7.6, UP2, 3.6], look: [4.2, 3.4, 5.9], fov: 60 },
  aNede: { label: 'A: 1. etasje (ingen pipe)', pos: [8.2, 1.6, 2.0], look: [4.2, 1.6, 5.9], fov: 60 },
  bPeis: { label: 'B: åpen peis', pos: [18.5, 1.55, 3.4], look: [18.5, 1.25, 7.4], fov: 60 },
  bOvn: { label: 'B: peisovn i hjørnet', pos: [17.1, 1.6, 3.1], look: [15.0, 0.9, 1.0], fov: 60 },
  bUte: { label: 'B: pipene', pos: [27, 9, -8], look: [18, 4, 4], fov: 50 },
  cPeis: { label: 'C: murt innsats', pos: [32.6, 1.6, 4.6], look: [28.6, 1.0, 3.5], fov: 60 },
  cKjeller: { label: 'C: pipa i kjelleren', pos: [32.4, -1.0, 1.4], look: [28.55, -1.6, 3.5], fov: 60 },
  dInne: { label: 'D: platekledd innsats og vedovn', pos: [45.2, 1.6, 1.1], look: [47.2, 1.2, 4.4], fov: 70 },
  dOvn: { label: 'D: vedovn og røykrør', pos: [46.4, 1.5, 3.6], look: [44.6, 1.1, 6.0], fov: 55 },
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
const DAY_BG = new THREE.Color('#cfdbe6'), EVENING_BG = new THREE.Color('#1c2433');
scene.background = DAY_BG.clone();
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

// ---- the houses, each its own layout
const houses = [];
for (const h of peisHus()) {
  const layout = buildLayout(peisSpec(h.house), undefined, { devWarnings: false });
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

// ---- light: sky, the sun from the south, a lamp in every room; a flickering light at every fire
const hemi = new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(33, 24, -22);
sun.target.position.set(25, 0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 24, bottom: -24, near: 1, far: 100 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const lamps = [];
for (const h of houses) {
  for (const r of h.layout.house.rooms) {
    if (r.hud || r.area < 0.5 || r.id === 'stue-kjokken') continue;
    const lamp = new THREE.PointLight('#ffe2bf', Math.max(3, r.area * 0.3), 0, 2);
    lamp.position.set(r.centroid.x + 0.7, r.floorY + 1.9, r.centroid.y + 0.4);
    scene.add(lamp);
    lamps.push({ lamp, base: lamp.intensity });
  }
}
/** A colour temperature as a light colour (a few points of the black-body curve, enough for a fire). */
const kelvin = (k) => new THREE.Color().lerpColors(new THREE.Color('#ff7a1e'), new THREE.Color('#ffc58a'), Math.max(0, Math.min(1, (k - 1700) / 1300)));
const fires = [];
for (const h of houses) {
  for (const l of h.rooms.builtInLights.filter((x) => x.type === 'fire')) {
    // a wide spot out of the window or opening, as the LightManager's (lighting.js HOUSE.fire: Lambertian, 85°)
    const light = new THREE.SpotLight(kelvin(l.colorK), 0, 9, (85 * Math.PI) / 180, 1, 2);
    light.position.copy(l.position);
    light.target.position.copy(l.position).add(l.direction);
    scene.add(light, light.target);
    fires.push({ light, base: (l.lumens / Math.PI) * 0.03, ember: l.emissiveMeshes[0]?.material, glow: l.emissiveMeshes[0]?.material.emissiveIntensity ?? 1, t: Math.random() * 9 });
  }
}
let firesOn = params.get('fire') !== '0';
let evening = params.get('evening') === '1';
function setFires(on) {
  firesOn = on;
  for (const f of fires) if (f.ember) f.ember.emissiveIntensity = on ? f.glow : 0;
  fireBtn.classList.toggle('on', on);
}
function setEvening(on) {
  evening = on;
  hemi.intensity = on ? 0.04 : 1.2;
  sun.intensity = on ? 0 : 2.6;
  scene.environmentIntensity = on ? 0.03 : 0.5;
  scene.background.copy(on ? EVENING_BG : DAY_BG);
  for (const l of lamps) l.lamp.intensity = on ? 0 : l.base;
  eveBtn.classList.toggle('on', on);
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
  // into B's living room, facing the open fireplace
  if (on) player.teleport(new THREE.Vector3(18.5, 0, 4.0), Math.atan2(0, 7.4 - 4.0) + Math.PI, 0);
}

/**
 * Walks the game's player straight at a fireplace's front: from 1.5 m in front of it toward its middle for 4 s.
 * Returns { gap } – how far the body's axis stayed from the fireplace's front (≈ the body's radius when it collides;
 * negative: it walked in).
 */
window.__bump = (fireplaceId, hz = 60) => {
  const h = houses.find((x) => x.layout.house.fireplaces.some((f) => f.id === fireplaceId));
  const f = h.layout.house.fireplaces.find((x) => x.id === fireplaceId);
  const front = f.shape === 'round' ? f.size[0] / 2 : f.size[1] / 2;
  const start = [f.at[0] + f.facing[0] * (front + 1.5), f.at[1] + f.facing[1] * (front + 1.5)];
  const bot = { move: { forward: 1, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const real = player.input;
  player.input = bot;
  const yaw = Math.atan2(f.facing[0], f.facing[1]);
  player.teleport(new THREE.Vector3(start[0], f.floorY, start[1]), yaw, 0);
  for (let i = 0; i < 4 * hz; i++) {
    player.yaw = yaw;
    player.update(1 / hz);
  }
  player.input = real;
  const p = player.position;
  const along = (p.x - f.at[0]) * f.facing[0] + (p.z - f.at[1]) * f.facing[1];
  render();
  return { gap: +(along - front).toFixed(3), at: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] };
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
  // the flames (rooms.update) and the fires' flicker
  for (const h of houses) h.rooms.update?.(dt, {});
  for (const f of fires) {
    f.t += dt;
    const k = 1 + 0.14 * (0.6 * Math.sin(f.t * 9.1) + 0.3 * Math.sin(f.t * 23.7 + 1.3) + 0.25 * Math.sin(f.t * 4.3 + 0.4)) / 1.15;
    f.light.intensity = firesOn ? f.base * k * (evening ? 1 : 0.6) : 0;
  }
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
const eveBtn = document.createElement('button');
eveBtn.textContent = 'Kveld';
eveBtn.onclick = () => setEvening(!evening);
bar.appendChild(eveBtn);
const fireBtn = document.createElement('button');
fireBtn.textContent = 'Ild';
fireBtn.onclick = () => setFires(!firesOn);
bar.appendChild(fireBtn);
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

window.__fires = (on) => setFires(on);
window.__evening = (on) => setEvening(on);
window.__pk = { THREE, scene, camera, renderer, houses, player, collision, render };
setEvening(evening);
setFires(firesOn);
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
const nFp = houses.reduce((s, h) => s + h.layout.house.fireplaces.length, 0);
const nCh = houses.reduce((s, h) => s + h.layout.house.chimneys.length, 0);
info.textContent = `${houses.length} hus · ${nFp} ildsteder · ${nCh} piper – dra for å se rundt, hjulet zoomer, «Kveld» for ildlyset, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
