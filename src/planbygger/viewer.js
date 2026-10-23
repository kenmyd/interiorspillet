/**
 * Planbygger: the 3D house of a generated house file – built by the game's own builders (home/layout.js buildLayout,
 * home/rooms.js buildRooms, home/stairs.js buildStairs: walls with their faces and backOf, floors, ceilings, doors that
 * open, windows), walked with the game's player (PlayerController, Input, CollisionWorld, InteractionSystem).
 *
 *   const v = createViewer(container, { onInfo })
 *   await v.load(house)           house = exportHouse(doc).house
 *   v.setMode('walk' | 'orbit')   walk: first person (WASD, the mouse as in the game); orbit: dollhouse without ceilings
 *                                 (the mouse, or WASD / the arrows to move along the ground)
 *   v.showLevel(levelId | null)   orbit: only that level (and the ones under it)
 *   v.dispose()
 *
 * The game's living room (shell.js, kitchen.js, lighting.js, the design) is not used: a customer's house has none. The
 * light: sky, sun from the south of the plan, and the house's lamps (the lighting rules' fittings) through the lamp rig
 * (home/lamprig.js); shadows only from the sun. The player starts clear of the furniture (spawn.js).
 *
 * Skylights (house.ceilings[].skylights) are built by the game with the ceilings, and hidden with them in the
 * dollhouse view.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { buildStairs } from '../home/stairs.js';
import { buildBuiltIns } from '../home/builtins.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { CollisionWorld } from '../core/Collision.js';
import { InteractionSystem } from '../core/Interaction.js';
import { Input } from '../core/Input.js';
import { Settings, QUALITY } from '../core/Settings.js';
import { Emitter } from '../core/Events.js';
import { PlayerController } from '../player/PlayerController.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { baseSpec, mergeOnto } from './export.js';
import { footprint } from './regions.js';
import { spawnPoint } from './spawn.js';
import { LampRig } from '../home/lamprig.js';

/** metres from the ground up to the main floor: one threshold step the player walks up (its stepHeight is 0.3) */
const GROUND_STEP = 0.15;
const KINDS = ['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic'];

/** Scene roots like home/index.js createHouseRoots: one group per level, one per room (surfaces + contents). */
function houseRoots(layout) {
  const levels = {};
  for (const lv of layout.house.levels) {
    const g = new THREE.Group();
    g.name = `level:${lv.id}`;
    levels[lv.id] = g;
  }
  const rooms = {};
  for (const r of layout.house.rooms) {
    const lg = levels[r.levelId] ?? Object.values(levels)[0];
    const group = new THREE.Group();
    group.name = `room:${r.id}`;
    const surfaces = new THREE.Group();
    surfaces.name = `room:${r.id}:surfaces`;
    const contents = new THREE.Group();
    contents.name = `room:${r.id}:contents`;
    group.add(surfaces, contents);
    lg.add(group);
    rooms[r.id] = { id: r.id, name: r.name, levelId: r.levelId, kind: r.kind, hud: !!r.hud, group, surfaces, contents };
  }
  return { levels, rooms };
}

/**
 * The game's builders put some faces of different materials in one plane: a window frame's sides lie on the reveal
 * (the frame is exactly as wide as the hole), the dark lining of an outer door on its trim, the cladding on the
 * reveal's edge, the end of a neighbour's outer wall in a room's face (F40). In the planbygger's houses that flickers
 * (F3, F4, F6, F8, F14, F29, F40). A depth offset per role settles who wins: the outside of the walls and the dark
 * deck step back the most, the room paint and the ceilings step back, the dark linings step forward, frames, leaves
 * and trims stay. Only depth is changed, no geometry; the fix in the builders (a frame 2–3 mm narrower than its hole)
 * is a request to the house work.
 *
 * The builders share one material per colour (paint('#ece9e3') on the room faces and on the reveals alike), so each
 * role gets its own copy: set on the shared material, the offset moved every face of that colour and the room faces
 * tied with what they should hide (fase D). `made` (material → role → copy) is kept for clear().
 *
 * The outside of a level over the main floor reaches down past its floor and lies in the plane of the main floor's
 * cladding, which goes up to just under that floor: two facades in one band, dark and light, flickered (F59). The
 * upper levels' outside (`far` = 'farUp') steps back further, so the main floor's cladding wins there.
 */
const DEPTH = { farUp: [3, 6], far: [2, 4], side: [1.5, 3], back: [1, 2], front: [-1, -2] };

function depthRole(name, mn) {
  if (/^(room-outside|cover):/.test(name)) return 'far';
  // the ends and reveal sides of the walls (room-walls) step back a little more than the room faces: the end of a wall
  // piece lying in the plane of the face beside it flickered against it (F105, hus6)
  if (/^room-walls:/.test(name) && /^paint #/.test(mn)) return 'side';
  if (/^ceiling:/.test(name) || (/^wall:/.test(name) && /^paint #/.test(mn))) return 'back';
  if (/^room-walls:/.test(name) && /#1d1e21/.test(mn)) return 'front';
  return null;
}

function separateCoplanar(root, made, far = 'far') {
  root.traverse((m) => {
    if (!m.isMesh) return;
    const name = m.name || '';
    let changed = false;
    const mats = [].concat(m.material).map((mat) => {
      // a copy made on an earlier pass (a mesh reached from two roots) keeps its role
      let role = mat && mat.userData?.pbDepth == null ? depthRole(name, mat.name || '') : null;
      if (role === 'far') role = far;
      if (!role) return mat;
      const key = `${mat.uuid}:${role}`;
      let c = made.get(key);
      if (!c) {
        c = mat.clone();
        // clone() leaves out the shader hooks some of the game's materials use
        c.onBeforeCompile = mat.onBeforeCompile;
        c.customProgramCacheKey = mat.customProgramCacheKey;
        c.polygonOffset = true;
        [c.polygonOffsetFactor, c.polygonOffsetUnits] = DEPTH[role];
        c.userData.pbDepth = role;
        made.set(key, c);
      }
      changed = true;
      return c;
    });
    if (changed) m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

/**
 * A passage (an opening without a door) leaves the bottom of its reveal open: the rooms' floors stop at the wall faces,
 * and the ground shows through the wall's thickness (F28; doors have a threshold, and windows on the floor get the
 * room's floor out to the frame from the game itself since the window models). The floor is carried through: a thin box
 * in the owner room's own floor material, walkable. Returns the meshes (colliders).
 */
function revealFloors(parts, roots, layout) {
  const floorMat = new Map();
  for (const g of [...Object.values(roots.levels), ...parts.map((p) => p.group)]) {
    g?.traverse((m) => {
      if (m.isMesh && /^floor:/.test(m.name) && !floorMat.has(m.name)) floorMat.set(m.name, [].concat(m.material)[0]);
    });
  }
  const out = [];
  for (const o of layout.house?.openings || []) {
    const wall = layout.house.wallsById?.[o.wallId];
    const mat = floorMat.get(`floor:${o.roomId}`);
    if (o.type !== 'opening' || o.sill > 0.03 || !wall || !(wall.thickness > 0.02) || !mat || !o.bottomCenter) continue;
    // steps between two floors (rooms.js buildSteps) fill their own reveal
    const ys = (o.connects || []).map((id) => layout.house.roomsById?.[id]?.floorY).filter((y) => y != null);
    if (ys.length === 2 && Math.abs(ys[0] - ys[1]) > 0.02) continue;
    const t = 0.03;
    const box = new THREE.Mesh(new THREE.BoxGeometry(o.width, t, wall.thickness), mat.clone());
    const pos = o.bottomCenter.clone().addScaledVector(o.normal, -wall.thickness / 2).add(new THREE.Vector3(0, -t / 2, 0));
    box.matrixAutoUpdate = false;
    box.matrix.makeBasis(o.right, new THREE.Vector3(0, 1, 0), o.normal).setPosition(pos);
    box.matrixWorldNeedsUpdate = true;
    box.name = `reveal-floor:${o.id}`;
    box.receiveShadow = true;
    out.push(box);
  }
  return out;
}

/**
 * An invisible ramp from the ground up to the threshold in front of each outer door of the main level, for the
 * collision only. The player is a capsule with a round foot: at the sharp edge of the step from the ground up to the
 * floor (GROUND_STEP) its foot meets the corner with a slanted normal, the step-up fails, and it had to jump to get in
 * (F60). The game's own steps have such a wedge (rooms.js buildSteps); it starts on the threshold, not below it.
 */
function doorRamps(layout, groundY) {
  const H = layout.house;
  const mainY = H.levelsById.hoved?.floorY ?? 0;
  const out = [];
  const RUN = 0.45;
  for (const o of H.openings || []) {
    if (o.type !== 'door' || !(o.connects || []).includes('ute') || Math.abs((o.floorY ?? 0) - mainY) > 0.01) continue;
    const wall = H.wallsById?.[o.wallId];
    if (!wall || !(wall.thickness > 0.02) || !o.bottomCenter || !o.normal) continue;
    const rise = mainY + 0.012 - groundY;
    if (rise < 0.03) continue;
    // profile in (s: out from the outer face, y: up from the ground): flat on the threshold, down to the ground
    const shape = new THREE.Shape([
      new THREE.Vector2(-0.12, rise),
      new THREE.Vector2(0, rise),
      new THREE.Vector2(RUN, 0),
      new THREE.Vector2(RUN, -0.03),
      new THREE.Vector2(-0.12, -0.03),
    ]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.3, o.width - 0.02), bevelEnabled: false });
    g.translate(0, 0, -Math.max(0.3, o.width - 0.02) / 2);
    const outward = o.normal.clone().setY(0).normalize().negate();
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(outward, up);
    const origin = o.bottomCenter.clone().addScaledVector(outward, wall.thickness);
    origin.y = groundY;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.matrixAutoUpdate = false;
    m.matrix.makeBasis(outward, up, across).setPosition(origin);
    m.matrixWorldNeedsUpdate = true;
    m.visible = false;
    m.name = `door-ramp:${o.id}`;
    out.push(m);
  }
  return out;
}

/**
 * A basement with a door or low windows in an outer wall stands free on that side (F111, F118: out of the basement door the
 * player fell into nothing): a sunken yard at the basement's floor in front of that wall – flat for YARD_FLAT, then a slope
 * up to the ground, between two retaining walls. Each run of outer basement walls on one line with an opening gets one.
 * → { footprints: the yards' outlines in plan (holes in the ground), meshes: the yards, slopes and walls (colliders) }
 */
const YARD_FLAT = 2.5;
const YARD_SLOPE_DEG = 28;
function basementYards(layout, mainY, groundY) {
  const H = layout.house;
  const out = { footprints: [], meshes: [] };
  const lower = H.levels.filter((l) => l.floorY < mainY - 0.5);
  if (!lower.length) return out;
  const paving = new THREE.MeshStandardMaterial({ color: '#9b958b', roughness: 0.95 });
  const grass = new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#a8a39a', roughness: 0.9, side: THREE.DoubleSide });
  const quad = (pts, mat, name) => {
    const g = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.receiveShadow = true;
    return m;
  };
  for (const lv of lower) {
    const outer = H.walls.filter((w) => w.levelId === lv.id && w.exterior && w.thickness > 0);
    const done = new Set();
    // the side with the basement door stands free (a walk-out basement); without a door, the sides with windows low
    // enough to look out of (a small one high up has a light well) – the owner's house: its front, not its back
    const hasDoor = outer.some((w) => (w.openings || []).some((o) => o.type === 'door'));
    const opens = (w) => (w.openings || []).some((o) => (hasDoor ? o.type === 'door' : o.type === 'window' && o.sill < 1.2));
    for (const w of outer) {
      if (done.has(w) || !opens(w)) continue;
      const n = new THREE.Vector2(-w.normal.x, -w.normal.y); // out of the house
      const dir = new THREE.Vector2(-n.y, n.x);
      const c = w.start.dot(n);
      // the whole run of outer walls on this line
      const run = outer.filter((x) => Math.abs(-x.normal.x * n.x - x.normal.y * n.y - 1) < 0.01 && Math.abs(x.start.dot(n) - c) < 0.05);
      run.forEach((x) => done.add(x));
      const ts = run.flatMap((x) => [x.start.dot(dir), x.end.dot(dir)]);
      const t0 = Math.min(...ts) - 0.4;
      const t1 = Math.max(...ts) + 0.4;
      const face = c + Math.max(...run.map((x) => x.thickness));
      const yardY = lv.floorY - GROUND_STEP;
      const rise = groundY - yardY;
      if (rise < 0.4) continue;
      const slope = rise / Math.tan((YARD_SLOPE_DEG * Math.PI) / 180);
      const P = (t, d, y) => new THREE.Vector3(dir.x * t + n.x * (face + d), y, dir.y * t + n.y * (face + d));
      const far = YARD_FLAT + slope;
      // the hole in the ground: the yard and its slope, a little into the wall so nothing is left between them
      out.footprints.push([P(t0, -0.05, 0), P(t1, -0.05, 0), P(t1, far, 0), P(t0, far, 0)].map((p) => [p.x, p.z]));
      const up = (a, b, cc, dd) => (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(dd, a)).y > 0 ? [a, b, cc, dd] : [a, dd, cc, b]);
      out.meshes.push(quad(up(P(t0, -0.05, yardY), P(t1, -0.05, yardY), P(t1, YARD_FLAT, yardY), P(t0, YARD_FLAT, yardY)), paving, `yard:${w.id}`));
      out.meshes.push(quad(up(P(t0, YARD_FLAT, yardY), P(t1, YARD_FLAT, yardY), P(t1, far, groundY), P(t0, far, groundY)), grass, `yard-slope:${w.id}`));
      // the retaining walls at the two ends: from the yard up to the ground
      for (const t of [t0, t1]) out.meshes.push(quad([P(t, -0.05, yardY), P(t, YARD_FLAT, yardY), P(t, far, groundY), P(t, -0.05, groundY)], concrete, `yard-wall:${w.id}`));
    }
  }
  return out;
}

/** A minimal HUD for the interaction prompt («E Åpne døra»). */
function promptHud(container) {
  const el = document.createElement('div');
  el.className = 'pb-prompt';
  el.hidden = true;
  container.appendChild(el);
  return {
    el,
    setPrompt(text, key = 'E', status = null) {
      if (!text) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.innerHTML = '';
      const k = document.createElement('kbd');
      k.textContent = key ?? 'E';
      const t = document.createElement('span');
      t.textContent = text;
      el.append(k, t);
      if (status) {
        const s = document.createElement('small');
        s.textContent = status;
        el.append(s);
      }
    },
    setCursor(kind) {
      container.style.cursor = kind === 'pointer' ? 'pointer' : '';
    },
  };
}

export function createViewer(container, { onInfo = () => {} } = {}) {
  const settings = new Settings();
  const quality = QUALITY[settings.get?.('quality') ?? 'medium'] ?? QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'pb-canvas3d';
  container.appendChild(renderer.domElement);
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  const hud = promptHud(container);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfdbe6');
  const camera = new THREE.PerspectiveCamera(settings.get?.('fov') ?? 72, 1, 0.05, 400);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const events = new Emitter();
  let input = null;
  let state = null; // the built house
  let mode = 'orbit';
  let showRoof = false; // the dollhouse with its roof on (setRoof)
  let orbit = null;
  let raf = 0;
  let last = 0;
  let disposed = false;
  // the dollhouse view moves with WASD / the arrow keys as well as the mouse (F34)
  const held = new Set();
  const ORBIT_KEYS = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], a: [0, -1], arrowleft: [0, -1], d: [0, 1], arrowright: [0, 1] };
  const onKeyDown = (e) => {
    const tag = e.target?.tagName;
    if (mode !== 'orbit' || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (!ORBIT_KEYS[k]) return;
    held.add(k);
    e.preventDefault();
  };
  const onKeyUp = (e) => held.delete(e.key.toLowerCase());
  const onBlur = () => held.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const resize = () => {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function clear() {
    if (!state) return;
    for (const p of state.parts) p.dispose?.();
    for (const o of state.extra) {
      o.removeFromParent();
      o.traverse?.((m) => {
        if (m.isMesh) {
          m.geometry?.dispose?.();
          if (!m.material?.userData?.cached) m.material?.dispose?.();
        }
      });
    }
    for (const g of Object.values(state.roots.levels)) g.removeFromParent();
    for (const m of state.depthMats?.values() ?? []) m.dispose();
    state.rig?.dispose();
    state.interaction?.dispose?.();
    hud.setPrompt(null);
    state = null;
  }

  async function load(house) {
    clear();
    onInfo('Bygger huset …');
    configureMaterials({ quality });
    await prepareMaterials(KINDS);
    const spec = mergeOnto(baseSpec(), house);
    // rooms.js lets the outer cladding of the main floor follow the living room's sloping ceiling (the owner's house)
    // and falls back to its slope 0,16216 from x 3,22: a customer's house would get cladding 3,35 m high on one side.
    // A flat «roof line» for the 3D view only (not in the house file): a living-room ceiling of type slope with zero
    // slope at the highest ceiling of the main floor, far away from the house (request to the house work: a data field)
    let mainCeil = Math.max(2.4, ...(house.ceilings || []).filter((c) => (house.rooms || []).find((r) => r.id === c.roomId)?.levelId === 'hoved').map((c) => c.height ?? 2.4));
    // never above the floor of the level over the main floor: rooms.js lets the cladding reach 0.35 m over the roof line,
    // which ran into the windows of the floor above (F1)
    const mainFloor = (house.levels || []).find((l) => l.id === 'hoved')?.floorY ?? 0;
    const above = (house.levels || []).map((l) => l.floorY).filter((y) => y > mainFloor + 0.5);
    if (above.length) mainCeil = Math.max(1.8, Math.min(mainCeil, Math.min(...above) - mainFloor - 0.35));
    // (only without a real roof: with roofs[] the cladding follows the roof, notes/tak.md)
    if (!house.roofs?.length) spec.ceilings.push({ id: 'c-planbygger-taklinje', type: 'slope', polygon: [[-900, -900], [-899, -900], [-899, -899]], highLine: [[-900, -900], [-899, -900]], lowLine: [[-900, -899], [-899, -899]], highHeight: mainCeil, lowHeight: mainCeil, color: '#ffffff' });
    const layout = buildLayout(spec, undefined, { devWarnings: false });
    const collision = new CollisionWorld();
    const interaction = new InteractionSystem({ camera, collision, events });
    const roots = houseRoots(layout);
    const ctx = { scene, camera, renderer, collision, interaction, events, settings, quality, roots, audio: null, lighting: null };
    const parts = [buildRooms(ctx, layout, null)];
    if (layout.house.stairs.length) parts.push(buildStairs(ctx, layout));
    // the kitchens', bathrooms' and laundries' fittings and the wall tiles (notes/kjokken-bad-genererte-hus.md)
    parts.push(buildBuiltIns(ctx, layout));
    scene.add(...Object.values(roots.levels));
    for (const p of parts) if (p.group && !p.group.parent) scene.add(p.group);
    const depthMats = new Map();
    const mainLevel = layout.house.levelsById.hoved;
    for (const [id, g] of Object.entries(roots.levels)) {
      const lv = layout.house.levelsById[id];
      separateCoplanar(g, depthMats, mainLevel && lv && lv.floorY > mainLevel.floorY + 0.5 ? 'farUp' : 'far');
    }
    for (const g of parts.map((p) => p.group)) if (g) separateCoplanar(g, depthMats);
    for (const p of parts) {
      for (const c of p.colliders || []) {
        if (c?.isBox3) collision.addStaticBox(c);
        else if (c) collision.addStatic(c);
      }
    }
    const extra = [];
    // the floor through passages (F28)
    for (const box of revealFloors(parts, roots, layout)) {
      scene.add(box);
      box.updateMatrixWorld(true);
      extra.push(box);
      collision.addStatic(box);
    }
    // ---- ground, sky light, sun, one lamp per room
    const b = layout.house.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
    const mainY = layout.house.levelsById.hoved?.floorY ?? 0;
    // the ground one threshold step (GROUND_STEP) below the main floor, so the player walks in without jumping (the
    // controller steps up 0.3 m at most; the slab underside at −0.31 was just too high – F13), with a hole over the
    // basement (it must not see the ground): the exact outline of the levels below (their rooms + wall slabs,
    // regions.js footprint). The ground is a mesh with its normal up, also the walkable surface outside (Octree,
    // one-sided).
    // A house with `site` (notes/uteomradet.md) has its ground, its entrances and the basement's open sides from the
    // game's builders (rooms.js, colliders in parts): no plate, yards or ramps of the view's own then
    const site = layout.house.site ?? null;
    const lowerIds = new Set(layout.house.levels.filter((l) => l.floorY < mainY - 0.5).map((l) => l.id));
    const polys = [];
    for (const r of layout.house.rooms) if (lowerIds.has(r.levelId) && !r.hud && r.polygon.length >= 3) polys.push(r.polygon.map((p) => [p.x, p.y]));
    for (const w of layout.house.walls) {
      if (!lowerIds.has(w.levelId) || !(w.thickness > 0)) continue;
      const o = (p, k) => [p.x - w.normal.x * k, p.y - w.normal.y * k];
      polys.push([o(w.start, 0), o(w.end, 0), o(w.end, w.thickness), o(w.start, w.thickness)]);
    }
    // the basement's open sides: sunken yards, cut out of the ground (F118)
    const yards = site ? { footprints: [], meshes: [] } : basementYards(layout, mainY, mainY - GROUND_STEP);
    polys.push(...yards.footprints);
    const hole = polys.length ? footprint(polys) : [];
    const R = size * 4;
    // the shape lies in (x, −z): rotated −90° about x it lands in (x, z) with its normal up
    const V = (x, z) => new THREE.Vector2(x, -z);
    const shape = new THREE.Shape([V(cx - R, cz - R), V(cx + R, cz - R), V(cx + R, cz + R), V(cx - R, cz + R)]);
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => V(p[0], p[1]))));
    if (!site) {
      const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = mainY - GROUND_STEP;
      ground.receiveShadow = true;
      ground.name = 'ground';
      scene.add(ground);
      ground.updateMatrixWorld(true);
      extra.push(ground);
      collision.addStatic(ground);
    }
    for (const m of yards.meshes) {
      m.castShadow = false;
      scene.add(m);
      m.updateMatrixWorld(true);
      extra.push(m);
      collision.addStatic(m);
    }
    // up the step at the outer doors without jumping (F60)
    for (const ramp of site ? [] : doorRamps(layout, mainY - GROUND_STEP)) {
      scene.add(ramp);
      ramp.updateMatrixWorld(true);
      extra.push(ramp);
      collision.addStatic(ramp);
    }
    const hemi = new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.1);
    scene.add(hemi);
    extra.push(hemi);
    const sun = new THREE.DirectionalLight('#fff3df', 2.4);
    // the sun from the south (+x) and a bit west, high in the sky
    sun.position.set(cx + size * 1.2, mainY + size * 1.4, cz + size * 0.5);
    sun.target.position.set(cx, mainY, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -size;
    sc.right = size;
    sc.top = size;
    sc.bottom = -size;
    sc.near = 0.5;
    sc.far = size * 5;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    extra.push(sun, sun.target);
    // the lamps (the lighting rules' fittings, notes/belysning-genererte-hus.md): a fixed pool of lights handed to the
    // lamps nearest the camera (home/lamprig.js) – one PointLight per lamp gave 30–70 lights and seconds of shader
    // compiling; every group on, as an evening
    const rig = new LampRig({ scene, layout, lights: parts.flatMap((p) => p.builtInLights ?? []) });
    // skylights are built by the game with the ceilings (rooms.js, since the window models)
    const skylights = [];
    collision.build();
    // the walkable ground: the site's fine grid when the house has one, else the house's bounds and its size round it
    const sb = site?.bounds;
    if (collision.setBounds) collision.setBounds(...(sb ? [sb.minX, sb.maxX, sb.minZ, sb.maxZ] : [b.minX - size, b.maxX + size, b.minZ - size, b.maxZ + size]));
    if (collision.setFloorField && layout.house.floorYAt) {
      collision.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));
    }
    // ---- the player
    if (!input) input = new Input(renderer.domElement, settings);
    const player = new PlayerController({ camera, collision, input, settings, events });
    // never inside a piece of furniture (the furnishing's colliders are boxes)
    const sp = spawnPoint(layout, { boxes: parts.flatMap((p) => p.colliders || []).filter((c) => c?.isBox3) });
    const start = sp ? { position: new THREE.Vector3(...sp.position), yaw: sp.yaw } : { position: new THREE.Vector3(), yaw: 0 };
    player.teleport(start.position, start.yaw, 0);
    state = { layout, collision, interaction, roots, parts, extra, skylights, player, start, bounds: b, center: new THREE.Vector3(cx, mainY, cz), size, groundY: site ? Math.min(mainY - GROUND_STEP, site.yRange?.[0] ?? -Infinity) : mainY - GROUND_STEP, depthMats, rig };
    setMode(mode);
    const realRooms = layout.house.rooms.filter((r) => !r.hud && r.area > 0.01 && r.id !== 'stue-kjokken');
    onInfo(`${realRooms.length} rom, ${layout.house.doors.length} dører, ${layout.house.windows.length} vinduer`);
    if (!raf) loop();
    return state;
  }

  function setMode(m) {
    mode = m;
    if (!state) return;
    const walk = m === 'walk';
    // the ceilings and the roof (rooms.js puts the roof among the ceilings): shown when walking, and in the dollhouse
    // when «Vis taket» is on
    for (const mesh of state.parts.flatMap((p) => p.pickables?.ceilings || [])) mesh.visible = walk || showRoof;
    for (const g of state.skylights || []) g.visible = walk;
    // the dark deck over basement rooms outside the main floor (rooms.js «cover:<room>»): off in the dollhouse view
    for (const g of Object.values(state.roots.levels)) g.traverse((o) => o.isMesh && o.name.startsWith('cover:') && (o.visible = walk));
    if (walk) {
      orbit?.dispose();
      orbit = null;
      showLevel(null);
      input?.setEnabled?.(true);
      const p = state.player;
      camera.position.copy(p.position);
    } else {
      input?.setEnabled?.(false);
      hud.setPrompt(null);
      if (!orbit) {
        orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.maxPolarAngle = Math.PI * 0.49;
        // panning slides along the ground, not up and down the screen: the camera went under the ground (F33)
        orbit.screenSpacePanning = false;
      }
      const c = state.center;
      orbit.target.set(c.x, c.y + 0.5, c.z);
      camera.position.set(c.x + state.size * 0.9, c.y + state.size * 1.1, c.z + state.size * 0.6);
      camera.lookAt(orbit.target);
      orbit.update();
    }
  }

  /** Orbit view: show only this level and those under it (null = all). */
  function showLevel(levelId) {
    if (!state) return;
    const lv = levelId ? state.layout.house.levelsById[levelId] : null;
    for (const l of state.layout.house.levels) state.roots.levels[l.id].visible = !lv || l.floorY <= lv.floorY;
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    if (!state) {
      renderer.render(scene, camera);
      return;
    }
    if (mode === 'walk') {
      input.update(dt);
      state.player.update(dt);
      const captured = input.isCaptured || input.isMouseLook;
      state.interaction.update(input, hud, captured);
      const click = input.consumeClick?.();
      if (input.consumeAction?.('interact') || click) state.interaction.interact({});
      input.consumeAction?.('pause');
      input.consumeAction?.('help');
    } else if (orbit) {
      orbitKeys(dt);
      orbit.update();
      // never under the ground (F33): zooming toward a low target or panning could take it there
      const g = state.groundY;
      if (orbit.target.y < g) orbit.target.y = g;
      if (camera.position.y < g + 0.3) camera.position.y = g + 0.3;
    }
    state.rig?.update(camera, dt);
    const pstate = { camera, playerPosition: state.player.position };
    for (const p of state.parts) {
      if (p.update) p.update(dt, pstate);
      else for (const d of p.doors || []) d.door?.update?.(dt, pstate);
    }
    renderer.render(scene, camera);
  }

  /** WASD / arrows in the dollhouse view: forward, back and sideways along the ground, faster the further out. */
  function orbitKeys(dt) {
    if (!held.size) return;
    let f = 0;
    let r = 0;
    for (const k of held) {
      f += ORBIT_KEYS[k][0];
      r += ORBIT_KEYS[k][1];
    }
    if (!f && !r) return;
    const fwd = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const speed = Math.max(2, camera.position.distanceTo(orbit.target) * 0.8);
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(speed * dt);
    orbit.target.add(move);
    camera.position.add(move);
  }

  function dispose() {
    disposed = true;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    cancelAnimationFrame(raf);
    raf = 0;
    clear();
    orbit?.dispose();
    input?.dispose?.();
    ro.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
    hud.el.remove();
  }

  return {
    load,
    setMode,
    showLevel,
    /** The dollhouse with or without its roof and ceilings. */
    setRoof(on) {
      showRoof = !!on;
      setMode(mode);
    },
    get roofShown() {
      return showRoof;
    },
    dispose,
    get mode() {
      return mode;
    },
    get state() {
      return state;
    },
    get disposed() {
      return disposed;
    },
    renderer,
    scene,
    camera,
  };
}
