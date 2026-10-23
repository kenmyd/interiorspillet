/**
 * Testside for kjøkken, bad og vaskerom i genererte hus (notes/kjokken-bad-genererte-hus.md): testhuset (testhus.mjs)
 * bygd med spillets egne byggere (home/layout.js buildLayout, home/rooms.js buildRooms, home/builtins.js buildBuiltIns –
 * kjøkkenet fra home/kitchenkit.js, badet fra home/bathroom.js, vaskerommet fra home/laundry.js, flisene fra
 * home/walltiles.js), gått med spillets figur (PlayerController, CollisionWorld, InteractionSystem).
 *
 * URL: ?view=<navn> – kamera fra VIEWS i testhus.mjs (for skjermbilder), ?mode=orbit – dukkehus, ?house=<url> – en
 * annen husfil (f.eks. en eksport fra planbyggeren) i stedet for testhuset.
 * window.__kb: { layout, builtIns, view(name), cam(x, y, z, tx, ty, tz), walkTo(x, z, yawDeg), mode(m), frame(n), pump(ms) }.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLayout } from '../../src/home/layout.js';
import { buildRooms } from '../../src/home/rooms.js';
import { buildBuiltIns } from '../../src/home/builtins.js';
import { createHouseRoots } from '../../src/home/index.js';
import { configureMaterials, prepareMaterials } from '../../src/home/materials.js';
import { CollisionWorld } from '../../src/core/Collision.js';
import { InteractionSystem } from '../../src/core/Interaction.js';
import { Input } from '../../src/core/Input.js';
import { Settings, QUALITY } from '../../src/core/Settings.js';
import { Emitter } from '../../src/core/Events.js';
import { PlayerController } from '../../src/player/PlayerController.js';
import { setMaxAnisotropy } from '../../src/world/proctex.js';
import { testHouseSpec, VIEWS } from './testhus.mjs';

const KINDS = ['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'glass-smoked', 'steel', 'plastic', 'ceramic', 'mirror', 'lacquer', 'chrome'];
const params = new URLSearchParams(location.search);

const settings = new Settings();
const quality = QUALITY[settings.get?.('quality') ?? 'medium'] ?? QUALITY.medium;
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfdbe6');
// a soft room environment, so steel, glass and the mirror reflect something (the game has its own)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);
const events = new Emitter();

const promptEl = document.getElementById('prompt');
const hud = {
  setPrompt(text, key = 'E') {
    promptEl.hidden = !text;
    if (text) promptEl.innerHTML = `<kbd>${key ?? 'E'}</kbd>${text}`;
  },
  setCursor(kind) {
    renderer.domElement.style.cursor = kind;
  },
};

configureMaterials({ quality });
await prepareMaterials(KINDS);
const houseUrl = params.get('house');
const house = houseUrl ? await fetch(houseUrl).then((r) => r.json()) : undefined;
const layout = buildLayout(testHouseSpec(house), undefined, { devWarnings: false });
const collision = new CollisionWorld();
const interaction = new InteractionSystem({ camera, collision, events });
const roots = createHouseRoots(layout, [new THREE.Group()]);
const ctx = { scene, camera, renderer, collision, interaction, events, settings, quality, roots, audio: null, lighting: null };
const R = buildRooms(ctx, layout, null);
const BI = buildBuiltIns(ctx, layout);
const HB = layout.house.bounds;
const CX = (HB.minX + HB.maxX) / 2;
const CZ = (HB.minZ + HB.maxZ) / 2;
scene.add(...Object.values(roots.levels));
for (const p of [R, BI]) if (p.group && !p.group.parent) scene.add(p.group);
for (const c of [...(R.colliders || []), ...(BI.colliders || [])]) {
  if (c?.isBox3) collision.addStaticBox(c);
  else if (c) collision.addStatic(c);
}

// ground, sky light, sun, two lamps per room under the ceiling
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(CX, -0.15, CZ);
ground.receiveShadow = true;
scene.add(ground);
ground.updateMatrixWorld(true);
collision.addStatic(ground);
scene.add(new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.0));
const sun = new THREE.DirectionalLight('#fff3df', 2.2);
sun.position.set(CX + 14, 16, CZ - 6);
sun.target.position.set(CX, 0, CZ);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
for (const r of layout.house.rooms) {
  if (r.hud || !r.polygon.length) continue;
  const b = r.bounds;
  const n = (b.maxY - b.minY) > 4 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const pl = new THREE.PointLight('#ffe6c8', 6, 0, 2);
    pl.position.set((b.minX + b.maxX) / 2, 2.05, b.minY + ((b.maxY - b.minY) * (i + 0.5)) / n);
    scene.add(pl);
  }
}
collision.build();
collision.setBounds?.(HB.minX - 10, HB.maxX + 10, HB.minZ - 10, HB.maxZ + 10);
if (collision.setFloorField && layout.house.floorYAt) collision.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));

const input = new Input(renderer.domElement, settings);
const player = new PlayerController({ camera, collision, input, settings, events });
player.teleport(new THREE.Vector3(3.2, 0, 5.2), 0, 0);

const doors = new Map((R.doors || []).map((d) => [d.id, d]));
let mode = params.get('mode') === 'orbit' ? 'orbit' : 'walk';
let orbit = null;
let fixed = false;

function setMode(m) {
  mode = m;
  fixed = false;
  document.getElementById('walk').classList.toggle('on', m === 'walk');
  document.getElementById('orbit').classList.toggle('on', m === 'orbit');
  for (const mesh of R.pickables?.ceilings || []) mesh.visible = m === 'walk';
  if (m === 'walk') {
    orbit?.dispose();
    orbit = null;
    input.setEnabled?.(true);
    return;
  }
  input.setEnabled?.(false);
  hud.setPrompt(null);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.target.set(CX, 0.5, CZ);
  camera.position.set(CX + 9, 11, CZ - 4);
  orbit.update();
}

function cam(x, y, z, tx, ty, tz) {
  orbit?.dispose();
  orbit = null;
  fixed = true;
  camera.position.set(x, y, z);
  camera.lookAt(tx, ty, tz);
  return true;
}
const view = (name) => (VIEWS[name] ? cam(...VIEWS[name]) : false);

document.getElementById('walk').onclick = () => setMode('walk');
document.getElementById('orbit').onclick = () => setMode('orbit');
document.getElementById('openAll').onclick = () => doors.forEach((d) => d.door.setOpen(true));
document.getElementById('closeAll').onclick = () => doors.forEach((d) => d.door.setOpen(false));
const list = document.getElementById('views');
for (const name of Object.keys(VIEWS)) {
  const row = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = name;
  const a = document.createElement('button');
  a.textContent = 'Se';
  a.onclick = () => view(name);
  row.append(label, a);
  list.appendChild(row);
}

function resize() {
  const w = app.clientWidth || window.innerWidth;
  const h = app.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
setMode(mode);
if (params.get('open') === '1') doors.forEach((d) => d.door.setOpen(true, { instant: true }));
if (params.get('view')) view(params.get('view'));

let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  step(dt);
}
function step(dt) {
  if (mode === 'walk' && !fixed) {
    input.update(dt);
    player.update(dt);
    const captured = input.isCaptured || input.isMouseLook;
    interaction.update(input, hud, captured);
    const click = input.consumeClick?.();
    if (input.consumeAction?.('interact') || click) interaction.interact({});
    input.consumeAction?.('pause');
    input.consumeAction?.('help');
  } else if (orbit) orbit.update();
  const state = { camera, playerPosition: player.position };
  if (R.update) R.update(dt, state);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

window.__kb = {
  layout,
  builtIns: BI,
  player,
  doors,
  view,
  cam,
  mode: setMode,
  open: (on = true) => doors.forEach((d) => d.door.setOpen(on, { instant: true })),
  pump(ms = 1200, dt = 0) {
    clearInterval(window.__pump);
    const t0 = performance.now();
    window.__pump = setInterval(() => {
      step(dt);
      if (performance.now() - t0 > ms) clearInterval(window.__pump);
    }, 40);
    return true;
  },
  frame(n = 1, dt = 1 / 30) {
    for (let i = 0; i < n; i++) step(dt);
    return true;
  },
  walkTo(x, z, yawDeg = 0) {
    setMode('walk');
    player.teleport(new THREE.Vector3(x, 0, z), THREE.MathUtils.degToRad(yawDeg), 0);
  },
  ready: true,
};
