import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Settings, QUALITY } from '../core/Settings.js';
import { Emitter } from '../core/Events.js';
import { CollisionWorld } from '../core/Collision.js';
import { InteractionSystem } from '../core/Interaction.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { createHome } from '../home/index.js';

/**
 * Dev sandbox: the full home (shell, kitchen, exterior, lighting, the design with SceneSync) under a free
 * OrbitControls camera – no player, no editor UI. For humans (orbit with the mouse) and tools/shot.mjs.
 *
 * URL params:
 *   cam=x,y,z  look=x,y,z  fov=deg        camera (default: an overview of the dining/sitting area)
 *   photo=<id>                             look through a room-spec photo camera (e.g. 20261018_082909, 0_for)
 *                                          – use the photo's aspect: --w=1280 --h=960 (4:3)
 *   mode=auto|day|evening|night  hour=h  month=m  day=d   design env (time of day / light mode)
 *   quality=low|medium|high               Settings QUALITY preset (default medium)
 *   design=<saved name>  start=continue    which design to show (default: today's room)
 *   orbit=0                                no OrbitControls (keeps the exact camera)
 *   ceil=0                                 hide the ceilings (look in from above)
 *
 * Globals: window.__ready (true once rendered), window.__setView({ pos, look, fov }) or __setView(pos, look, fov),
 * window.__sandbox = { scene, camera, renderer, home, design, sync, lighting, collision, render() }.
 */

const params = new URLSearchParams(location.search);
const vec = (s, d) => (s ? s.split(',').map(Number) : d);
const info = document.getElementById('info');

const settings = new Settings();
const quality = QUALITY[params.get('quality') ?? 'medium'] ?? QUALITY.medium;

const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; // the LightManager's tone mapping (no double compile)
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 60), window.innerWidth / window.innerHeight, 0.05, quality.drawDistance);
camera.rotation.order = 'YXZ';
scene.add(camera);
const events = new Emitter();
const collision = new CollisionWorld();
const interaction = new InteractionSystem({ camera, collision, events });
const noopAudio = { play() {}, setPaused() {}, update() {}, stopAll() {}, setEnvironment() {} };

let controls = null;
let home = null;
let time = 0;

const sandbox = { scene, camera, renderer, collision, events, settings, quality, render: () => render() };
window.__sandbox = sandbox;

function render() {
  if (home?.lighting?.render) home.lighting.render(renderer, scene, camera);
  else renderer.render(scene, camera);
}

/** Moves the camera: __setView({ pos, look, fov }) or __setView(pos, look, fov). */
window.__setView = (a, b, c) => {
  const v = Array.isArray(a) ? { pos: a, look: b, fov: c } : a || {};
  if (v.pos) camera.position.set(...v.pos);
  if (v.fov) {
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
  }
  if (v.look) {
    if (controls) {
      controls.target.set(...v.look);
      controls.update();
    } else camera.lookAt(...v.look);
  }
  home?.update?.(0, time, { camera, playerPosition: camera.position });
  render();
};

async function main() {
  const t0 = performance.now();
  const ctx = {
    scene,
    camera,
    renderer,
    collision,
    interaction,
    events,
    audio: noopAudio,
    settings,
    quality,
    input: null,
    hud: null,
    uiRoot: null,
    game: null,
    dev: { params, start: params.get('start') || 'original', readOnlySaves: true },
    progress: (p, t) => (info.textContent = `${Math.round(p * 100)} % ${t}`),
  };
  home = await createHome(ctx);
  collision.build();
  Object.assign(sandbox, { home, design: home.design, sync: home.sync, lighting: home.lighting });

  const env = {};
  for (const k of ['hour', 'month', 'day']) if (params.has(k)) env[k] = Number(params.get(k));
  if (params.has('mode')) env.mode = params.get('mode');
  if (Object.keys(env).length) home.design.setEnv(env);
  if (params.get('ceil') === '0') for (const m of home.pickables?.ceilings || []) m.visible = false;

  const photo = params.get('photo') ? home.layout.photoCamera(params.get('photo')) : null;
  if (photo) {
    camera.position.copy(photo.pos);
    camera.rotation.set(photo.rotation.x, photo.rotation.y, photo.rotation.z, 'YXZ');
    camera.fov = photo.vfovDeg;
    camera.updateProjectionMatrix();
  } else {
    camera.position.set(...vec(params.get('cam'), [1.2, 2.3, 3.2]));
    camera.lookAt(...vec(params.get('look'), [6.2, 0.9, 9.5]));
    if (params.get('orbit') !== '0') {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(...vec(params.get('look'), [6.2, 0.9, 9.5]));
      controls.update();
    }
  }
  home.update(0, 0, { camera, playerPosition: camera.position });
  home.sync.flush();
  render();
  info.textContent = `bygget på ${Math.round(performance.now() - t0)} ms · ${home.design.items.size} ting · ${renderer.info.render.calls} tegnekall`;

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    controls?.update();
    home.update(dt, time, { camera, playerPosition: camera.position });
    render();
  });
  requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

main().catch((err) => {
  console.error(err);
  info.textContent = `FEIL: ${err.message}`;
  window.__error = String(err.stack ?? err);
  window.__ready = true;
});
