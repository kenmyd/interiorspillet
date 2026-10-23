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
import { uteHus, uteSpec } from './uteomrade-hus.js';

/**
 * Dev page for the site (notes/uteomradet.md): the test house of src/dev/uteomrade-hus.js on its sloping lot, built
 * with the game's own builders (buildLayout + buildRooms, as the planbygger's 3D view does – the ground, the surfaces,
 * walls, steps, fences and hedges come from the house's `site`, home/site.js), the sun from the south and a lamp per
 * room, labels on the site's parts, buttons for the views, «Tak» (hide ceilings and roofs) and «Gå» (walk with the
 * game's player: WASD, the mouse after a click; the ground, the steps and the decks are walkable).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__walkPath(points, hz, y0)
 * (walks the game's player through plan points [[x, z], …] and returns where it ended and how much it was in the air),
 * window.__ute = { scene, camera, renderer, layout, site, info(), render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [24, 9, -18], look: [6, -1.5, 4] },
  sor: { label: 'Sør: sokkel og uteplass', pos: [6, 0.2, -16], look: [6, -1.6, 2] },
  vest: { label: 'Vest: terrassetrapp', pos: [-11, 1.0, -6], look: [1, -1.4, 0] },
  ost: { label: 'Øst: sidedør og hagetrapp', pos: [26, 2.5, 0], look: [14, -1.0, 5] },
  nord: { label: 'Nord: inngang og gårdsplass', pos: [10, 4.0, 24], look: [9, -0.4, 9] },
  mur: { label: 'Muren', pos: [16, 0.6, 6.5], look: [16.5, -0.1, 14] },
  dukkehus: { label: 'Dukkehus', pos: [6, 26, -16], look: [6, -2, 4], ceil: false },
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
scene.fog = new THREE.Fog('#cfdbe6', 60, 140);
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
await prepareMaterials(['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic', 'moss', 'soil']);

// ---- the house with its site (one house file)
const { house } = uteHus();
const t0 = performance.now();
const layout = buildLayout(uteSpec(house), undefined, { devWarnings: false });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const rooms = buildRooms({ scene, camera, renderer, quality, roots, collision }, layout, null);
scene.add(...Object.values(roots.levels));
if (rooms.group && !rooms.group.parent) scene.add(rooms.group);
for (const c of rooms.colliders) {
  if (c?.isBox3) collision.addStaticBox(c);
  else if (c) collision.addStatic(c);
}
collision.build();
const site = layout.house.site;
collision.setBounds(site.grid.xs[0], site.grid.xs.at(-1), site.grid.zs[0], site.grid.zs.at(-1));
const buildMs = performance.now() - t0;

// ---- light: sky, the sun from the south (the house casts, the site only receives), a lamp in every room
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(14, 22, -20);
sun.target.position.set(6, -1, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 20, bottom: -20, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const r of layout.house.rooms) {
  if (r.hud || r.area < 0.5) continue;
  const lamp = new THREE.PointLight('#ffe2bf', Math.max(5, r.area * 0.5), 0, 2);
  lamp.position.set(r.centroid.x, r.floorY + 2.1, r.centroid.y);
  scene.add(lamp);
}

// ---- labels: the surfaces, the steps, the decks, the fences
const labels = [];
const label = (text, at) => {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = text;
  labelsEl.appendChild(el);
  labels.push({ el, at });
};
const KIND = { driveway: 'innkjørsel', yard: 'gårdsplass', path: 'sti', patio: 'uteplass', lawn: 'plen', bed: 'bed' };
const SURF = { gravel: 'grus', asphalt: 'asfalt', pavers: 'belegningsstein', slabs: 'heller', concrete: 'betong', grass: 'gress', bark: 'bark' };
const mid = (P) => P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length], [0, 0]);
for (const s of site.surfaces) {
  if (!s.surface || s.auto === 'deck-foot' || s.auto === 'path') continue;
  const c = mid(s.polygon);
  label(`${s.auto ? 'auto: ' : ''}${KIND[s.kind]} (${SURF[s.surface]}${s.y != null ? ', plan' : ''}${s.walls.length ? ', mur' : ''})`, new THREE.Vector3(c[0], site.heightAt(c[0], c[1]) + 0.8, c[1]));
}
for (const st of site.steps) {
  const c = [st.origin[0] + st.out[0] * st.length / 2, st.origin[1] + st.out[1] * st.length / 2];
  label(`hagetrapp: ${st.risers} trinn`, new THREE.Vector3(c[0], (st.top + st.bottom) / 2 + 1.2, c[1]));
}
for (const d of layout.house.decks) {
  const c = mid(d.outline);
  label(`${d.id.startsWith('ute-') ? 'auto: trapp til døra' : 'terrasse'} (${d.stairs.map((s) => s.risers).join('+')} trinn)`, new THREE.Vector3(c[0], d.top + 1.3, c[1]));
}
for (const f of site.fences) {
  const p = f.line[Math.floor(f.line.length / 2)];
  label({ fence: 'stakittgjerde', screen: 'levegg', hedge: 'hekk' }[f.kind], new THREE.Vector3(p[0], site.heightAt(p[0], p[1]) + f.height + 0.4, p[1]));
}
const showLabels = params.get('labels') !== '0';
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
function setWalking(on) {
  walking = on;
  controls.enabled = !on;
  input.setEnabled?.(on);
  walkBtn.classList.toggle('on', on);
  // start on the gravel yard, facing the entrance
  if (on) player.teleport(new THREE.Vector3(15, -0.3, 11.5), Math.atan2(1, 0), 0);
}

/**
 * Walks the game's player through plan points (straight from one to the next, ≤ 30 s), from the ground at the first
 * (or from y0: on a deck). Returns { x, y, z, reached, air, hard } – air: the share of frames off the ground, hard:
 * hard landings.
 */
window.__walkPath = (pts, hz = 60, y0 = null) => {
  const bot = { move: { forward: 1, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const real = player.input;
  player.input = bot;
  const hard = [];
  const off = events.on?.('land', (e) => (e?.speed ?? 0) > 1.5 && hard.push(e.speed));
  const p0 = pts[0];
  player.teleport(new THREE.Vector3(p0[0], (y0 ?? site.heightAt(p0[0], p0[1])) + 0.05, p0[1]), 0, 0);
  bot.move.forward = 0;
  for (let i = 0; i < 20; i++) player.update(1 / hz);
  bot.move.forward = 1;
  let air = 0, n = 0, k = 1;
  for (let i = 0; i < 30 * hz && k < pts.length; i++) {
    const t = pts[k];
    const dx = t[0] - player.position.x, dz = t[1] - player.position.z;
    if (Math.hypot(dx, dz) < 0.3) {
      k++;
      continue;
    }
    player.yaw = Math.atan2(-dx, -dz);
    player.update(1 / hz);
    n++;
    if (!player.onGround) air++;
  }
  player.input = real;
  off?.();
  render();
  return { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(3), z: +player.position.z.toFixed(2), reached: k >= pts.length, air: +(air / Math.max(1, n)).toFixed(3), hard: hard.length };
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

const siteGroup = scene.getObjectByName('site');
const siteInfo = () => {
  let tris = 0, meshes = 0, casts = 0;
  siteGroup?.traverse((m) => {
    if (!m.isMesh) return;
    meshes++;
    if (m.castShadow) casts++;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return { meshes, tris, casts, buildMs: Math.round(buildMs), calls: renderer.info.render.calls };
};
window.__ute = { THREE, scene, camera, renderer, layout, site, player, collision, render, info: siteInfo };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
const si = siteInfo();
info.textContent = `tomta: ${si.meshes} mesher (${si.tris} trekanter, ${si.casts} med skygge) · bygget på ${si.buildMs} ms – dra for å se rundt, hjulet zoomer, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
