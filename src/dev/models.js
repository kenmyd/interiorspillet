import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../core/Settings.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { configureMaterials, mat, ALL_KINDS, MATERIAL_LABELS, defaultColor } from '../home/materials.js';
import { ARCHETYPES, buildModel, getArchetype, setModelQuality } from '../models/registry.js';
import { roundedBox, sphere, cushion } from '../models/kit.js';
import { products, productToItemSpec } from '../catalog/index.js';

/**
 * Model gallery under neutral studio light on a light floor (dev/models.html).
 *
 * URL params (one of):
 *   arch=<id>                         one model; &dims={"w":..,"d":..,"h":..} &params={json} &colors={json}
 *                                     &materials={json} override the archetype defaults
 *   cat=<catalogKey>                  every product of a catalogue category in a labelled grid (variant 0, or
 *                                     &variant=n – clamped per product)
 *   all=1                             every archetype with its defaults, labelled
 *   mat=1                             every material kind on a sphere + a rounded box + a cushion (&kinds=a,b,…
 *                                     &color=#hex for one colour on all)
 * Common:
 *   rot=deg                           turn every model (default 0 = front toward +z, i.e. toward the default camera)
 *   cam=x,y,z  look=x,y,z  fov=deg    camera (default: auto-framed from the front-right, a little above)
 *   cols=n                            grid columns (default ≈ √count)
 *   quality=low|medium|high           texture resolution / model quality
 *   focus=<id>                        frame the camera on one model of the grid (archetype / product id / kind)
 *   labels=0                          hide the labels    bg=#hex   floor=#hex
 * Globals: window.__ready, window.__setView({ pos, look, fov }) (or positional), window.__gallery = { scene, camera,
 * renderer, models: [{ id, object, label }] }.
 */

const params = new URLSearchParams(location.search);
const json = (k) => {
  try {
    return params.has(k) ? JSON.parse(params.get(k)) : undefined;
  } catch {
    console.warn(`[models] ${k} is not valid JSON`);
    return undefined;
  }
};
const vec = (s) => (s ? s.split(',').map(Number) : null);
const info = document.getElementById('info');
const labelsEl = document.getElementById('labels');

const quality = QUALITY[params.get('quality') ?? 'medium'] ?? QUALITY.medium;
configureMaterials({ quality });
setModelQuality(params.get('quality') ?? 'medium');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.get('bg') || '#e8e6e2');
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 35), window.innerWidth / window.innerHeight, 0.02, 200);

// studio light: soft sky + key + fill, neutral room reflections
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 0.55));
const key = new THREE.DirectionalLight(0xfff4e8, 1.7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xe8f0ff, 0.45);
scene.add(fill);

const models = [];
const rot = (Number(params.get('rot') ?? 0) * Math.PI) / 180;

/** Builds the list of { id, label, sub, object } to show. */
function collect() {
  const out = [];
  if (params.has('arch')) {
    const id = params.get('arch');
    const def = getArchetype(id);
    const spec = { archetype: id, dims: json('dims'), params: json('params'), colors: json('colors'), materials: json('materials') };
    out.push({ id, label: def?.label || id, sub: id, object: buildModel(spec) });
  } else if (params.has('cat')) {
    const variant = params.has('variant') ? Number(params.get('variant')) : 0;
    for (const p of products(params.get('cat'))) {
      const spec = productToItemSpec(p, variant);
      out.push({ id: p.id, label: p.name, sub: `${p.archetype} · ${p.variants?.[spec.variantIndex]?.name || ''}`, object: buildModel(spec) });
    }
  } else if (params.has('mat')) {
    const kinds = params.get('kinds') ? params.get('kinds').split(',') : ALL_KINDS;
    for (const k of kinds) {
      const g = new THREE.Group();
      const m = mat(k, params.get('color') || defaultColor(k));
      const s = new THREE.Mesh(sphere(0.16, { wSeg: 48, hSeg: 32 }), m);
      s.position.set(-0.2, 0.16, 0);
      const b = new THREE.Mesh(roundedBox(0.3, 0.3, 0.3, 0.02, 3), m);
      b.position.set(0.18, 0.15, 0);
      const c = new THREE.Mesh(cushion(0.34, 0.12, 0.3, { axis: 'y', puff: 0.2 }), m);
      c.position.set(0, 0.06, 0.32);
      for (const o of [s, b, c]) {
        o.castShadow = !m.transparent;
        o.receiveShadow = true;
        g.add(o);
      }
      out.push({ id: k, label: MATERIAL_LABELS[k] || k, sub: k, object: g });
    }
  } else {
    for (const id of Object.keys(ARCHETYPES)) out.push({ id, label: ARCHETYPES[id].label, sub: id, object: buildModel({ archetype: id }) });
  }
  return out;
}

function layoutGrid(list) {
  const n = list.length;
  const cols = Number(params.get('cols')) || Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
  const boxes = list.map((m) => {
    m.object.rotation.y = rot;
    m.object.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(m.object);
  });
  const cell = Math.max(0.6, ...boxes.map((b) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z))) * 1.25;
  const rows = Math.ceil(n / cols);
  list.forEach((m, i) => {
    const b = boxes[i];
    const c = i % cols, r = Math.floor(i / cols);
    const cx = (c - (cols - 1) / 2) * cell;
    const cz = (r - (rows - 1) / 2) * cell;
    // centre the footprint in the cell, bottom on the floor (wall/ceiling models included)
    m.object.position.set(cx - (b.min.x + b.max.x) / 2, -b.min.y, cz - (b.min.z + b.max.z) / 2);
    m.object.updateMatrixWorld(true);
    m.box = new THREE.Box3().setFromObject(m.object);
    scene.add(m.object);
  });
  return { cols, rows, cell };
}

function frame(all) {
  const box = new THREE.Box3();
  for (const m of all.length ? all : models) box.union(m.box);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y * 1.4, size.z) * 0.6 + 0.2;
  // fit the grid's width and its (foreshortened) depth/height into the view
  const halfV = (camera.fov * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const dist = Math.max((size.x / 2 + 0.15) / Math.tan(halfH), (Math.max(size.y, size.z * 0.75) / 2 + 0.15) / Math.tan(halfV)) * 1.08 + size.z * 0.45;
  const dir = new THREE.Vector3(0.35, 0.55, 1).normalize();
  const look = vec(params.get('look')) || [center.x, center.y * 0.6, center.z];
  const pos = vec(params.get('cam')) || center.clone().addScaledVector(dir, dist).toArray();
  camera.position.set(...pos);
  camera.lookAt(...look);
  // studio lights follow the framing
  key.position.copy(center).add(new THREE.Vector3(r * 1.2, r * 2.2, r * 1.6));
  key.target.position.copy(center);
  const s = Math.max(size.x, size.z) * 0.75 + 1;
  Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: r * 8 + 10 });
  key.shadow.camera.updateProjectionMatrix();
  fill.position.copy(center).add(new THREE.Vector3(-r * 2, r, -r));
  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(s * 6, s * 6), new THREE.MeshStandardMaterial({ color: params.get('floor') || '#dcd8d1', roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, 0, center.z);
  floor.receiveShadow = true;
  scene.add(floor);
  return look;
}

let controls = null;
const showLabels = params.get('labels') !== '0';
function placeLabels() {
  if (!showLabels) return;
  const w = window.innerWidth, h = window.innerHeight;
  const p = new THREE.Vector3();
  for (const m of models) {
    if (!m.el) {
      m.el = document.createElement('div');
      m.el.className = 'lbl';
      m.el.innerHTML = `${escapeHtml(m.label)}<small>${escapeHtml(m.sub || '')}</small>`;
      labelsEl.append(m.el);
    }
    p.set((m.box.min.x + m.box.max.x) / 2, m.box.max.y + 0.04, (m.box.min.z + m.box.max.z) / 2).project(camera);
    m.el.style.display = p.z > 1 ? 'none' : '';
    m.el.style.left = `${((p.x + 1) / 2) * w}px`;
    m.el.style.top = `${((1 - p.y) / 2) * h}px`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function render() {
  renderer.render(scene, camera);
  placeLabels();
}

window.__setView = (a, b, c) => {
  const v = Array.isArray(a) ? { pos: a, look: b, fov: c } : a || {};
  if (v.fov) {
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
  }
  if (v.pos) camera.position.set(...v.pos);
  if (v.look) {
    if (controls) {
      controls.target.set(...v.look);
      controls.update();
    } else camera.lookAt(...v.look);
  }
  render();
};

function main() {
  const t0 = performance.now();
  models.push(...collect());
  const grid = layoutGrid(models);
  const focus = params.get('focus');
  const look = frame(focus ? models.filter((m) => m.id === focus) : models);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...look);
  controls.update();
  render();
  let tris = 0;
  scene.traverse((o) => {
    if (o.isMesh && o.geometry?.index) tris += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1);
    else if (o.isMesh) tris += (o.geometry.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  info.textContent = `${models.length} modeller · ${grid.cols}×${grid.rows} · ${Math.round(performance.now() - t0)} ms · ${renderer.info.render.calls} tegnekall · ${Math.round(tris / 1000)}k trekanter`;
  window.__gallery = { scene, camera, renderer, models };
  renderer.setAnimationLoop(() => {
    controls.update();
    render();
  });
  requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

try {
  main();
} catch (err) {
  console.error(err);
  info.textContent = `FEIL: ${err.message}`;
  window.__error = String(err.stack ?? err);
  window.__ready = true;
}
