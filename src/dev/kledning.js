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
import { kledningHus, kledningSpec } from './kledning-hus.js';

/**
 * Dev page for the cladding and the decks (notes/kledning.md): the test houses of src/dev/kledning-hus.js, each its
 * own house file built with the game's own builders (buildLayout + buildRooms, as the planbygger's 3D view does), a
 * ground with the sunken yard of the house on a slope (C), the sun from the south and a lamp per room, a label per
 * house and deck, buttons for the views, «Tak» (hide ceilings and roofs: the dollhouse) and «Gå» (walk with the game's
 * player: WASD, the mouse after a click; the decks and their stairs are walkable).
 *
 * URL params: view=<key of VIEWS> (default oversikt), ceil=0, labels=0.
 * Globals: window.__ready, window.__setView(pos, look, fov) | __setView('<view key>'), window.__walk(deckId, k, dir)
 * (walks stair k of a deck up or down with the game's player and returns where it ended),
 * window.__kl = { scene, camera, renderer, houses, render() }.
 */

const params = new URLSearchParams(location.search);
const info = document.getElementById('info');
const bar = document.getElementById('bar');
const labelsEl = document.getElementById('labels');
const quality = QUALITY.high ?? QUALITY.medium;
const settings = new Settings();

const VIEWS = {
  oversikt: { label: 'Oversikt', pos: [29, 19, -30], look: [29, 0, 3] },
  aSor: { label: 'A: veranda og gavl', pos: [-5.5, 3.2, -9], look: [4.5, 2.2, 2] },
  aOst: { label: 'A: platting', pos: [17, 3.5, 3.5], look: [9, 1.4, 3.8] },
  aHjorne: { label: 'A: hjørne og omramming', pos: [-2.6, 1.7, -2.4], look: [0.6, 1.2, 1.4], fov: 50 },
  bSor: { label: 'B: teglbånd og balkong', pos: [11.5, 3.4, -10], look: [18.5, 2.6, 1] },
  bBalkong: { label: 'B: glassrekkverk', pos: [21.5, 4.6, -4.2], look: [18.6, 3.1, -0.6], fov: 60 },
  cSor: { label: 'C: sokkelhus', pos: [22, 1.2, -16], look: [32, -0.6, 1] },
  cTrapp: { label: 'C: trappa', pos: [39.5, -1.3, -9.5], look: [34.5, -1.2, -3.6], fov: 60 },
  cGavl: { label: 'C: gavl (øst)', pos: [41.2, 3.0, -2.5], look: [36.5, 2.4, 4.5], fov: 60 },
  dSor: { label: 'D: plater og takterrasse', pos: [52.5, 6.5, -9], look: [46.5, 2.6, 2.5] },
  dNord: { label: 'D: steinvegg (nord)', pos: [53, 2.5, 15], look: [46, 1.5, 6.5] },
  ePlatting: { label: 'E: bod og platting', pos: [49.5, 3.4, -7], look: [56.2, 0.8, 2.4] },
  dukkehus: { label: 'Dukkehus', pos: [29, 30, -22], look: [29, -1, 3], ceil: false },
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
for (const h of kledningHus()) {
  const layout = buildLayout(kledningSpec(h.house), undefined, { devWarnings: false });
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

// ---- the ground: −0.15 (one step under the main floors), down to a sunken yard where a house says so (C: the
//      basement stands free to the south), with the basements cut out (it must not show inside them)
const yards = houses.map((h) => h.site?.yard).filter(Boolean);
const GROUND = -0.15;
const groundAt = (x, z) => {
  let y = GROUND;
  for (const yd of yards) {
    const dx = Math.max(yd.x0 - x, 0, x - yd.x1), dz = Math.max(yd.z0 - z, 0, z - yd.z1);
    const d = Math.hypot(dx, dz);
    const t = Math.min(1, d / 2.6);
    y = Math.min(y, yd.y + (GROUND - yd.y) * (t * t * (3 - 2 * t)));
  }
  return y;
};
const basements = [];
for (const h of houses) {
  const H = h.layout.house;
  const main = H.levelsById.hoved?.floorY ?? 0;
  for (const w of H.walls) {
    if (!(H.levelsById[w.levelId]?.floorY < main - 0.5) || !(w.thickness > 0)) continue;
    const o = (p, k) => [p.x - w.normal.x * k, p.y - w.normal.y * k];
    basements.push([o(w.start, 0), o(w.end, 0), o(w.end, w.thickness), o(w.start, w.thickness)]);
  }
  for (const r of H.rooms) if (!r.hud && H.levelsById[r.levelId]?.floorY < main - 0.5) basements.push(r.polygon.map((p) => [p.x, p.y]));
}
const inPoly = (x, z, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (P[i][1] > z !== P[j][1] > z && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  return c;
};
{
  const X0 = -40, X1 = 100, Z0 = -45, Z1 = 45, S = 0.25;
  const nx = Math.round((X1 - X0) / S), nz = Math.round((Z1 - Z0) / S);
  const pos = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = X0 + i * S, x1 = x0 + S, z0 = Z0 + j * S, z1 = z0 + S;
      if (basements.some((P) => inPoly((x0 + x1) / 2, (z0 + z1) / 2, P))) continue;
      const a = [x0, groundAt(x0, z0), z0], b = [x1, groundAt(x1, z0), z0], c = [x1, groundAt(x1, z1), z1], d = [x0, groundAt(x0, z1), z1];
      pos.push(...a, ...d, ...c, ...a, ...c, ...b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
  ground.name = 'ground';
  ground.receiveShadow = true;
  scene.add(ground);
  ground.updateMatrixWorld(true);
  collision.addStatic(ground);
}
collision.build();
collision.setBounds(-40, 100, -45, 45);

// ---- light: sky, the sun from the south, a lamp in every room
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.2));
const sun = new THREE.DirectionalLight('#fff3df', 2.6);
sun.position.set(36, 24, -22);
sun.target.position.set(29, 0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 26, bottom: -26, near: 1, far: 110 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const h of houses) {
  for (const r of h.layout.house.rooms) {
    if (r.hud || r.area < 0.5 || r.id === 'stue-kjokken') continue;
    const lamp = new THREE.PointLight('#ffe2bf', Math.max(5, r.area * 0.7), 0, 2);
    lamp.position.set(r.centroid.x, r.floorY + 2.1, r.centroid.y);
    scene.add(lamp);
  }
}

// ---- labels: the house over its roof, every deck over its middle
const labels = [];
const label = (text, at) => {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = text;
  labelsEl.appendChild(el);
  labels.push({ el, at });
};
const KIND = { terrace: 'terrasse', balcony: 'balkong', porch: 'veranda', 'roof-terrace': 'takterrasse' };
const RAIL = { glass: 'glass', 'wood-slats': 'liggende spiler', 'wood-vertical': 'stående spiler', 'steel-bars': 'stålspiler', none: 'uten rekkverk' };
for (const h of houses) {
  const b = h.layout.house.bounds;
  const top = Math.max(...h.layout.house.roofs.map((p) => p.ridgeY ?? 0), b.maxY);
  label(h.name, new THREE.Vector3((b.minX + b.maxX) / 2, top + 1.2, (b.minZ + b.maxZ) / 2));
  for (const d of h.layout.house.decks) {
    const cx = d.outline.reduce((s, p) => s + p[0], 0) / d.outline.length, cz = d.outline.reduce((s, p) => s + p[1], 0) / d.outline.length;
    label(`${KIND[d.kind]}: ${d.surface === 'boards' ? 'bord' : d.surface === 'tiles' ? 'fliser' : 'betong'}, ${RAIL[d.railing.type]}`, new THREE.Vector3(cx, d.top + 1.4, cz));
  }
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
  if (on) {
    const d = houses.find((h) => h.key === 'C').layout.house.decks[0];
    const s = d.stairs[0];
    player.teleport(new THREE.Vector3(s.origin[0] + s.out[0] * (s.reach + 1.2), s.bottom, s.origin[1] + s.out[1] * (s.reach + 1.2)), Math.atan2(s.out[0], s.out[1]), 0);
  }
}

/**
 * Walks stair k of a deck with the game's player: dir 'up' from 1.2 m beyond its foot onto the deck, 'down' from the
 * deck out over the foot. Returns { y, want, air } (air = the share of frames off the ground).
 */
window.__walk = (deckId, k = 0, dir = 'up', hz = 60) => {
  const h = houses.find((x) => x.layout.house.decks.some((d) => d.id === deckId));
  const d = h.layout.house.decks.find((x) => x.id === deckId);
  const s = d.stairs[k];
  const bot = { move: { forward: 1, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const real = player.input;
  player.input = bot;
  const up = dir === 'up';
  const u0 = up ? s.reach + 1.2 : -1.0;
  const p = [s.origin[0] + s.out[0] * u0, s.origin[1] + s.out[1] * u0];
  const yaw = up ? Math.atan2(s.out[0], s.out[1]) : Math.atan2(-s.out[0], -s.out[1]);
  player.teleport(new THREE.Vector3(p[0], up ? s.bottom : s.top, p[1]), yaw, 0);
  let air = 0, n = 0;
  const dist = s.reach + 2.2;
  for (let i = 0; i < 12 * hz; i++) {
    player.yaw = yaw;
    player.update(1 / hz);
    n++;
    if (!player.onGround) air++;
    const v = [player.position.x - s.origin[0], player.position.z - s.origin[1]];
    const u = v[0] * s.out[0] + v[1] * s.out[1];
    if (up ? u < -0.8 : u > s.reach + 1.0) break;
    if (i * (1 / hz) > dist / 0.5) break;
  }
  player.input = real;
  render();
  return { y: +player.position.y.toFixed(3), want: up ? s.top : s.bottom, air: +(air / n).toFixed(3) };
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

window.__kl = { THREE, scene, camera, renderer, houses, player, collision, render };
window.__setView(VIEWS[params.get('view')] ? params.get('view') : 'oversikt');
if (params.get('ceil') === '0') setCeilings(false);
const nDecks = houses.reduce((s, h) => s + h.layout.house.decks.length, 0);
info.textContent = `${houses.length} hus · ${nDecks} dekk – dra for å se rundt, hjulet zoomer, «Gå» for å gå (klikk for musa)`;
renderer.setAnimationLoop(render);
window.__ready = true;
