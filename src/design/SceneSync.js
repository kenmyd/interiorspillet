import * as THREE from 'three';
import { Emitter } from '../core/Events.js';
import { buildModel, getArchetype, mergeSpec } from '../models/registry.js';
import { disposeModel, setShadows } from '../models/kit.js';
import { mat, ghostMaterial, placeholderMaterial, warmupMaterials } from '../home/materials.js';
import { applyShading } from '../models/shading.js';
import { applyWallDesign } from '../models/walldesigns.js';
import { finishPlan, buildSurfaceFinish, disposeSurfaceFinish } from '../models/surfaceslats.js';

/**
 * SceneSync – keeps the 3D scene equal to the DesignState (ARCHITECTURE §7).
 *
 *   new SceneSync({ home, design, lighting?, collision?, renderer?, scene?, camera? })   (createHome: home.sync)
 *   syncAll()                    brings everything in line with the design (also on design 'load'): only items whose
 *                                model inputs changed are rebuilt, moved ones are moved, unchanged ones stay; the wall
 *                                is rebuilt only when its elements changed (Før/etter, Åpne, undo of a load are cheap)
 *   syncAllAsync(onProgress?)    the same, in ~8 ms slices (createHome: the loading screen keeps animating)
 *   update(dt)                   applies queued item changes (home.update calls it every frame)
 *   flush()                      apply queued item changes now (getObject/objectBounds call it)
 *   getObject(uid) → Group|null  the item's root (userData.pick = { kind: 'item', uid }, userData.uid, .model, .spec)
 *   objectBounds(uid, target?) → Box3|null   world AABB
 *   objects() → Group[]          every item root (for raycasting); itemAt(object3D) → uid|null
 *   placeObject(object, item)    position/rotation per mount (Placement uses it for ghosts)
 *   buildGhost(itemSpec) → Group translucent preview (no pick, no shadows); ghostTint(ghost, ok)
 *   prepareObject(object) → Promise   shader warm-up for any new object (e.g. WallPanel previews): compiles its
 *                                programs in parallel and shows flat placeholder materials until they are ready
 *   warmUpGroup() → Group        one tiny mesh per material variant of home/materials.js (Game compiles it at load)
 *   warmUp() → Promise           compiles warmUpGroup() in parallel
 *   finishObject(surfaceId) → Group|null   the slat finish built on a wall / ceiling (design.finishes)
 *   dispose()
 * Events (Emitter): 'built' { uid, object, item, rebuilt } · 'moved' { uid, object, item } · 'removed' { uid } ·
 *   'finish' { surfaceId, object|null } (a slat finish was built, rebuilt or removed)
 *
 * Slat finishes (design.finishes, models/surfaceslats.js): one world-space group per finished wall / ceiling in their
 * own root next to the items (not in the shell, so the overview's cut model never copies them). Every change of the
 * finishes or of a paint re-plans them all and rebuilds only those whose geometry or colour changed (a wall's panel
 * depends on its ceiling's slats and on the wall before it). Every frame a finish is shown only while its surface is:
 * hidden with the ceilings in the overview / plan, with a cut-away dollhouse wall, a hidden level or a culled room.
 *
 * Shader compiles never block a frame: a new or rebuilt model is compiled with renderer.compile (parallel on
 * KHR_parallel_shader_compile) and, while any of its programs is still compiling, shows flat placeholder materials
 * (meshes with non-shared materials are hidden) – the real materials come back as soon as the GPU is done. Ghosts use
 * one translucent material per colour (the program of glass, compiled at start) and precompile the real model.
 * Models removed by a design load are parked (up to 48) and reused when the same item comes back unchanged.
 *
 * Item changes are queued and applied once per frame: colour/material-only changes swap materials of the model's
 * parts (userData.model.parts, materials from home/materials.js) without a rebuild; position/rotation/attach move the
 * object; light changes only re-send the lights; dims/params/archetype/mount rebuild the model. Floor furniture taller
 * than 0.3 m gets a collision box (collision.addDynamicBox) that follows it – one box for the whole AABB, or one per
 * entry of userData.model.colliders ([{ min: [x,y,z], max: [x,y,z] }] in model space) when the builder gives them.
 * Mount rules: floor/surface/rug/soft at item.position with rotationDeg; wall: local +z = attach.normal (else the
 * wall's normal, else rotationDeg), attach.tilt leans the top back; ceiling: hangs from home.ceilingHeightAt(x, z, y).
 *
 * Levels (notes/hele-huset-design.md §5.3, §5.5; DesignState v2, steg 16 E3): in memory an item's position is WORLD
 * space and `item.level` names the level it stands on (a layout.house.levels id); the saved design keeps y over the
 * level's floor (DesignState converts). placeObject puts the model at the position as it is; a ceiling item hangs from
 * the ceiling of its level; the collision box and the rug zone start at the floor of its level (the entrance's lower
 * floor included). The helpers below are shared by the editor (Placement, Selection, ViewModes, Inspector): an item
 * without a known level (a design of before the house) is on the level its y lies in, as DesignState decides.
 */

const DEG = Math.PI / 180;
/** The first floor (layout.js MAIN_LEVEL_ID): the level of an item without one. */
export const MAIN_LEVEL = 'hoved';

/**
 * Level id of a design item: `item.level` when the layout knows it, else the level its y (world) lies in (a ceiling
 * item hangs just under its ceiling), else the main level.
 * @param {object} item
 * @param {object} [layout]  home/layout.js (without it only item.level counts)
 * @returns {string}
 */
export function itemLevel(item, layout = null) {
  const lv = typeof item?.level === 'string' && item.level ? item.level : null;
  const known = layout?.house?.levelsById;
  if (lv && (!known || known[lv])) return lv;
  if (!layout?.house?.levelAt) return lv ?? MAIN_LEVEL;
  const y = Number(item?.position?.[1]) || 0;
  return levelAtY(layout, item?.mount === 'ceiling' ? y - 0.1 : y + 0.05);
}

/**
 * World y of a level's floor (0 for the main level and for unknown ids).
 * @param {object} layout  home/layout.js
 * @param {string} levelId
 * @returns {number}
 */
export function levelFloorY(layout, levelId) {
  const h = layout?.house;
  const lv = h?.levelsById?.[levelId] ?? h?.level?.(levelId) ?? null;
  return Number.isFinite(lv?.floorY) ? lv.floorY : 0;
}

/**
 * The level a world point of the house is on, for the editor: the level whose floor band holds y (feet / an item's
 * base; layout.house.levelAt takes the body centre, so 0.9 is added). Without house data: the main level.
 * @param {object} layout
 * @param {number} y  world y (a floor point)
 * @returns {string}
 */
export function levelAtFloorY(layout, y) {
  return levelAtY(layout, (Number.isFinite(y) ? y : 0) + 0.9);
}

/**
 * The level a world point inside a room is on (a lamp under a ceiling, a point on a table; layout.house.levelAt).
 * @param {object} layout
 * @param {number} y  world y
 * @returns {string}
 */
export function levelAtY(layout, y) {
  const h = layout?.house;
  if (typeof h?.levelAt !== 'function') return MAIN_LEVEL;
  return h.levelAt(Number.isFinite(y) ? y : 0)?.id ?? MAIN_LEVEL;
}

const REBUILD = ['archetype', 'dims', 'params', 'mount'];
const PLACE = ['position', 'rotationDeg', 'attach'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
/** Parked models (removed by a load, reusable when the item returns unchanged). */
const MAX_PARKED = 48;
/** Give up waiting for a program after this long (a driver that never reports completion). */
const GATE_TIMEOUT_MS = 30000;

/** A wall / ceiling mesh is on screen: its whole parent chain visible, its material not swapped for ViewModes' hiding one. */
function hostShown(mesh) {
  for (let o = mesh; o; o = o.parent) if (!o.visible) return false;
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return !m?.userData?.ixConceal;
}

/** The inputs a model is built from (two items with the same key give identical models). */
function modelKey(item) {
  const s = buildSpec(item);
  return JSON.stringify([s.archetype, s.mount, s.dims, s.params, s.colors, s.materials]);
}

/** '#rrggbb' of a material (its source hex for cached materials). */
function materialHex(m) {
  if (typeof m?.userData?.hex === 'string') return m.userData.hex;
  return m?.color?.isColor ? `#${m.color.getHexString()}` : '#9a9a9a';
}

/** The spec a model is built from: the item, with a lamp's colour temperature passed on for the glow tint. */
function buildSpec(item) {
  const k = item.light?.colorK;
  if (!item.light || !Number.isFinite(k) || item.params?.colorK === k) return item;
  return { ...item, params: { ...(item.params || {}), colorK: k } };
}

export class SceneSync extends Emitter {
  /**
   * @param {object} o
   * @param {object} o.home        the home object (roots, walls, windows, highWall, setPaint, ceilingHeightAt …)
   * @param {import('./DesignState.js').DesignState} o.design
   * @param {object} [o.lighting]  LightManager (default home.lighting)
   * @param {import('../core/Collision.js').CollisionWorld} [o.collision]
   * @param {THREE.WebGLRenderer} [o.renderer]  exposure fallback when the LightManager has no setExposure
   */
  constructor({ home, design, lighting, collision, renderer, scene, camera }) {
    super();
    this.home = home;
    this.design = design;
    this.lighting = lighting ?? home.lighting ?? null;
    this.collision = collision ?? null;
    this.renderer = renderer ?? null;
    this.scene = scene ?? null;
    this.camera = camera ?? null;
    this.root = home.roots.items;
    /** @type {Map<string, { item: object, object: THREE.Object3D, handles: object[], hadLights: boolean, gate?: object }>} */
    this._entries = new Map();
    this._queue = new Set();
    /** @type {Map<string, { object: THREE.Object3D, key: string }>} uid → parked model */
    this._parked = new Map();
    this._gates = new Set();
    this._wallKey = null;
    this._wallGroup = null;
    /** surfaceId → { key, object, hosts: Mesh[]|null, gate } – the slat finishes */
    this._finishes = new Map();
    this.finishRoot = new THREE.Group();
    this.finishRoot.name = 'surface-finishes';
    this.finishRoot.userData.noCollide = true;
    (this.root.parent ?? this.root).add(this.finishRoot);
    /** Placeholder gating of new models (off while the home is first built: Game compiles that scene as a whole). */
    this.gating = true;
    this._off = [
      design.on('item:add', ({ uid }) => this._queue.add(uid)),
      design.on('item:update', ({ uid }) => this._queue.add(uid)),
      design.on('item:remove', ({ uid }) => this._queue.add(uid)),
      design.on('load', () => this.syncAll()),
      design.on('wall', () => this._syncWall()),
      design.on('window', ({ windowId }) => this._syncWindow(windowId)),
      design.on('paint', ({ wallId }) => {
        this._syncPaint(wallId);
        this._syncFinishes(); // slats painted in the surface's colour follow it
      }),
      design.on('finish', () => this._syncFinishes()),
      design.on('env', () => this._syncEnv(true)),
    ];
  }

  // ---- public ----------------------------------------------------------------------------------------------------

  /** Brings everything in line with the design (items, wall, windows, paints, env) – only what differs is rebuilt. */
  syncAll() {
    const items = this._syncItemsBegin();
    for (const item of items) this._syncItem(item);
    this._syncAllEnd();
  }

  /**
   * syncAll in slices of ~8 ms (yields to the browser between them), for the loading screen.
   * @param {(fraction: number) => void} [onProgress]
   */
  async syncAllAsync(onProgress) {
    const items = this._syncItemsBegin();
    let t0 = performance.now();
    for (let i = 0; i < items.length; i++) {
      this._syncItem(items[i]);
      if (performance.now() - t0 > 8) {
        onProgress?.((i + 1) / items.length);
        await new Promise((r) => setTimeout(r, 0));
        t0 = performance.now();
      }
    }
    this._syncAllEnd();
    onProgress?.(1);
  }

  _syncItemsBegin() {
    const items = this.design.list();
    const keep = new Set(items.map((it) => it.uid));
    for (const uid of [...this._entries.keys()]) if (!keep.has(uid)) this._remove(uid, { park: true });
    this._queue.clear();
    return items;
  }

  _syncItem(item) {
    const entry = this._entries.get(item.uid);
    if (entry) this._change(entry, item);
    else this._build(item);
  }

  _syncAllEnd() {
    this._syncWall();
    for (const w of this.home.windows || []) this._syncWindow(w.id);
    for (const w of this.home.walls || []) this._syncPaint(w.id);
    for (const id of Object.keys(this.design.paints || {})) if (!this.home.walls?.some((w) => w.id === id)) this._syncPaint(id);
    this._syncFinishes();
    this._syncEnv();
    this._shadows();
  }

  /** Applies queued item changes (call once per frame); finishes follow their surface's visibility. */
  update() {
    this.flush();
    this._finishVisibility();
  }

  /** Applies queued item changes now. */
  flush() {
    if (!this._queue.size) return;
    const uids = [...this._queue];
    this._queue.clear();
    for (const uid of uids) {
      const item = this.design.get(uid);
      const entry = this._entries.get(uid);
      if (!item) this._remove(uid);
      else if (!entry) this._build(item);
      else this._change(entry, item);
    }
    this._shadows();
  }

  /** @returns {THREE.Object3D|null} */
  getObject(uid) {
    if (this._queue.has(uid)) this.flush();
    return this._entries.get(uid)?.object ?? null;
  }

  /** World AABB of an item. */
  objectBounds(uid, target = new THREE.Box3()) {
    const o = this.getObject(uid);
    if (!o) return null;
    o.updateMatrixWorld(true);
    return target.setFromObject(o);
  }

  /** Every item root (visible or not). */
  objects() {
    this.flush();
    return [...this._entries.values()].map((e) => e.object);
  }

  /** uid of the item an object belongs to (walks up the parents), or null. */
  itemAt(object) {
    for (let o = object; o; o = o.parent) if (o.userData?.pick?.kind === 'item') return o.userData.pick.uid;
    return null;
  }

  /**
   * Positions/rotates an object like an item of that mount (also used for Placement ghosts).
   * @param {THREE.Object3D} object
   * @param {{ mount: string, position: number[], rotationDeg?: number, attach?: object }} item
   */
  placeObject(object, item) {
    const p = item.position || [0, 0, 0];
    object.position.set(p[0], p[1], p[2]);
    object.rotation.set(0, (item.rotationDeg || 0) * DEG, 0, 'YXZ');
    if (item.mount === 'wall') {
      let n = item.attach?.normal;
      if (!n && item.attach?.wallId) {
        const w = this.home.walls?.find((x) => x.id === item.attach.wallId);
        if (w) n = [w.normal.x, 0, w.normal.y];
      }
      const yaw = n ? Math.atan2(n[0], n[2]) : (item.rotationDeg || 0) * DEG;
      object.rotation.set(-(item.attach?.tilt || 0) * DEG, yaw, 0, 'YXZ');
    } else if (item.mount === 'ceiling') {
      // the ceiling of the item's level (world y; one metre over its floor picks the level, §1.8)
      const base = levelFloorY(this.home.layout, itemLevel(item, this.home.layout));
      const h = this.home.ceilingHeightAt?.(p[0], p[2], base + 1);
      if (Number.isFinite(h)) object.position.y = h;
    }
    object.updateMatrixWorld(true);
  }

  /**
   * Translucent preview of an item spec for Placement (no pick, no shadows, not in the scene). Dispose with
   * kit.disposeModel(ghost) when done.
   * @param {object} itemSpec  { archetype, dims, params, colors, materials, mount }
   * @returns {THREE.Group}
   */
  buildGhost(itemSpec) {
    const g = buildModel(itemSpec);
    // the real materials start compiling now (in parallel), so the click that places the item does not stall
    this._compile(g);
    // one translucent flat material per colour: the program of glass, compiled at start – no stall when it appears
    const clones = new Map();
    const ghost = (m) => {
      const hex = materialHex(m);
      const opacity = Math.round(Math.min(m?.opacity ?? 1, 0.55) * 100) / 100;
      const key = `${hex}|${opacity}`;
      let c = clones.get(key);
      if (!c) {
        c = ghostMaterial(hex, opacity).clone();
        c.userData = { cached: false, ghost: true, emissiveBase: c.emissive.clone() };
        clones.set(key, c);
      }
      return c;
    };
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      const src = o.material;
      o.material = Array.isArray(src) ? src.map(ghost) : ghost(src);
      o.raycast = () => {};
    });
    // right after start the ghost's variant (e.g. instanced) may still be compiling: those meshes wait hidden
    this._gateObject(g, null);
    g.userData.ghost = true;
    g.userData.mount = itemSpec.mount || getArchetype(itemSpec.archetype)?.mount || 'floor';
    g.renderOrder = 10;
    return g;
  }

  /** Tints a ghost red when the spot is not valid (ok = false). */
  ghostTint(ghost, ok = true) {
    ghost.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m.userData?.ghost || !m.emissive) continue;
        if (ok) m.emissive.copy(m.userData.emissiveBase ?? new THREE.Color(0));
        else m.emissive.setRGB(0.6, 0.05, 0.02);
      }
    });
  }

  /**
   * Compiles a new object's shader programs without blocking (KHR_parallel_shader_compile) and shows flat placeholder
   * materials until they are ready. Use it for anything new that is added to the scene outside the items (previews).
   * @param {THREE.Object3D} object  already in the scene (or about to be added)
   * @returns {Promise<void>} resolves when the real materials are shown
   */
  prepareObject(object) {
    return new Promise((resolve) => {
      const gate = this._gateObject(object, resolve);
      if (!gate) resolve();
    });
  }

/**
   * A detached group with one tiny mesh per material variant home/materials.js hands out (plain, instanced, instanced
   * with colours). Game compiles it with the scene while loading, so the catalogue, the wall proposals and the ghosts
   * never meet a new program. Never added to the scene or rendered – it only keeps the programs alive.
   * @returns {THREE.Group}
   */
  warmUpGroup() {
    if (!this._warmGroup) {
      const g = new THREE.Group();
      g.name = 'shader-warmup';
      const geo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
      geo.userData.shared = true;
      for (const v of warmupMaterials()) {
        let mesh;
        if (v.instanced) {
          mesh = new THREE.InstancedMesh(geo, v.material, 1);
          mesh.setMatrixAt(0, new THREE.Matrix4());
          if (v.instanceColor) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        } else mesh = new THREE.Mesh(geo, v.material);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
      }
      this._warmGroup = g;
    }
    return this._warmGroup;
  }

  /**
   * Precompiles warmUpGroup() in parallel (when the load did not). Resolves when the GPU is done (or after 60 s).
   * @returns {Promise<void>}
   */
  warmUp() {
    const r = this.renderer;
    const scene = this.scene ?? this.root.parent;
    if (!r?.compile || !this.camera || !scene) return Promise.resolve();
    this.warmUpGroup();
    return new Promise((resolve) => {
      const gate = this._gateObject(this._warmGroup, resolve, { swap: false, timeout: 60000 });
      if (!gate) resolve();
    });
  }

  /** The slat finish built on a wall / ceiling (null when it has none or nothing fitted). */
  finishObject(surfaceId) {
    return this._finishes.get(surfaceId)?.object ?? null;
  }

  dispose() {
    for (const off of this._off) off();
    this._off = [];
    for (const gate of [...this._gates]) this._ungate(gate, false);
    for (const uid of [...this._entries.keys()]) this._remove(uid);
    for (const p of this._parked.values()) disposeModel(p.object);
    this._parked.clear();
    for (const f of this._finishes.values()) disposeSurfaceFinish(f.object);
    this._finishes.clear();
    this.finishRoot.removeFromParent();
    this.clear();
  }

  // ---- shader readiness ------------------------------------------------------------------------------------------

  /**
   * renderer.compile(object) against the scene's lights (non-blocking with KHR_parallel_shader_compile).
   * @returns {{ materials: Set<THREE.Material>, programs: Set<object> }|null} materials / programs still compiling
   */
  _compile(object) {
    const r = this.renderer;
    const scene = this.scene ?? this.root.parent;
    if (!r?.compile || !this.camera || !scene || !object) return null;
    let mats;
    try {
      mats = r.compile(object, this.camera, scene);
    } catch (err) {
      console.warn('[sync] precompile failed', err);
      return null;
    }
    const materials = new Set();
    const programs = new Set();
    for (const m of mats) {
      // the program object itself is kept: a shared material's currentProgram changes with the object it is used on
      const p = r.properties.get(m)?.currentProgram;
      // p.program is undefined once three.js destroyed the program (its last material was disposed): polling it would
      // only produce GL_INVALID_OPERATION / GL_INVALID_VALUE warnings (seen by fix-lamps r1)
      if (p?.program && typeof p.isReady === 'function' && !p.isReady()) {
        materials.add(m);
        programs.add(p);
      }
    }
    return { materials, programs };
  }

  /**
   * Starts the compile of an object; while programs are compiling, meshes that use them show placeholders (shared
   * cached materials) or are hidden (their own materials – lamps dim those per lamp – or a placeholder variant that
   * is not compiled yet either, e.g. on an InstancedMesh). onReady() when done.
   * @returns {object|null} the gate, or null when everything is ready already
   */
  _gateObject(object, onReady, { swap = true, timeout = GATE_TIMEOUT_MS } = {}) {
    if (!this.gating && swap) return null;
    const c = this._compile(object);
    if (!c?.programs.size) return null;
    const waiting = c.programs;
    const touched = [];
    if (swap) {
      object.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        if (!list.some((m) => c.materials.has(m))) return;
        if (list.every((m) => m.userData?.cached)) {
          const ph = (m) => placeholderMaterial(materialHex(m), !!m.transparent);
          touched.push({ mesh: o, material: o.material, visible: o.visible, placeholder: (o.material = Array.isArray(o.material) ? o.material.map(ph) : ph(o.material)) });
        } else {
          touched.push({ mesh: o, visible: o.visible, hidden: true });
          o.visible = false;
        }
      });
      // the placeholders' own variant (instancing, vertex colours …) may still be compiling: hide those meshes too
      const ph = touched.some((t) => t.placeholder) ? this._compile(object) : null;
      if (ph?.materials.size) {
        for (const t of touched) {
          if (!t.placeholder || t.hidden) continue;
          if ((Array.isArray(t.placeholder) ? t.placeholder : [t.placeholder]).some((m) => ph.materials.has(m))) {
            t.hidden = true;
            t.mesh.visible = false;
          }
        }
      }
    }
    const gate = { object, waiting, touched, onReady, timer: 0, t0: performance.now() };
    const check = () => {
      // a program whose last material was disposed meanwhile is destroyed (p.program undefined): nothing to wait for
      for (const p of [...gate.waiting]) if (!p.program || p.isReady()) gate.waiting.delete(p);
      if (!gate.waiting.size || performance.now() - gate.t0 > timeout) this._ungate(gate, true);
      else gate.timer = setTimeout(check, 25);
    };
    gate.timer = setTimeout(check, 25);
    this._gates.add(gate);
    return gate;
  }

  /** Puts the real materials back (restore = false: just forget the gate, e.g. the object is being disposed). */
  _ungate(gate, restore = true) {
    if (!this._gates.has(gate)) return;
    this._gates.delete(gate);
    clearTimeout(gate.timer);
    for (const t of gate.touched) {
      if (t.placeholder && t.mesh.material === t.placeholder) t.mesh.material = t.material;
      if (t.hidden) t.mesh.visible = t.visible; // also when parked: a reused model must be complete
    }
    if (restore) {
      this._shadows();
      try {
        gate.onReady?.();
      } catch (err) {
        console.warn('[sync] ready callback failed', err);
      }
    }
  }

  // ---- items -----------------------------------------------------------------------------------------------------

  _build(item, rebuilt = false) {
    const key = modelKey(item);
    const parked = this._parked.get(item.uid);
    let object = null;
    if (parked) {
      this._parked.delete(item.uid);
      if (parked.key === key) object = parked.object;
      else disposeModel(parked.object);
    }
    const fresh = !object;
    if (fresh) object = buildModel(buildSpec(item));
    object.name = `item:${item.uid}`;
    object.userData.pick = { kind: 'item', uid: item.uid };
    object.userData.uid = item.uid;
    object.visible = !item.hidden;
    this.placeObject(object, item);
    this.root.add(object);
    const entry = { item, object, handles: [], hadLights: false, key };
    this._entries.set(item.uid, entry);
    if (fresh) {
      entry.gate = this._gateObject(object, () => {
        entry.gate = null;
      });
    }
    this._collide(entry);
    this._lights(entry);
    this.emit('built', { uid: item.uid, object, item, rebuilt });
    return entry;
  }

  /**
   * Removes an item's model. park: keep the model (out of the scene) for a while – a design load that brings the same
   * item back unchanged reuses it instead of building it again.
   */
  _remove(uid, { park = false } = {}) {
    const e = this._entries.get(uid);
    if (!e) return;
    if (e.gate) {
      this._ungate(e.gate, park); // parked models keep their real materials
      e.gate = null;
    }
    e.object.removeFromParent();
    if (park) {
      this._parked.set(uid, { object: e.object, key: e.key ?? modelKey(e.item) });
      while (this._parked.size > MAX_PARKED) {
        const [old, p] = this._parked.entries().next().value;
        this._parked.delete(old);
        disposeModel(p.object);
      }
    } else disposeModel(e.object);
    for (const h of e.handles) this.collision?.removeDynamic(h);
    this._dropZone(e);
    if (e.hadLights) this.lighting?.setItemLights?.(uid, null);
    this._entries.delete(uid);
    this.emit('removed', { uid });
  }

  _change(entry, item) {
    const prev = entry.item;
    // a lamp's glow tint follows its colour temperature (params.colorK in the build spec)
    const tint = !!item.light && prev.light?.colorK !== item.light?.colorK && !!entry.object.userData.model?.lights?.length;
    if (tint || REBUILD.some((k) => !same(prev[k], item[k]))) {
      this._rebuild(entry, item);
      return;
    }
    entry.item = item;
    if (!same(prev.colors, item.colors) || !same(prev.materials, item.materials)) {
      if (!this._recolor(entry, prev, item)) {
        this._rebuild(entry, item);
        return;
      }
    }
    if (PLACE.some((k) => !same(prev[k], item[k]))) {
      this.placeObject(entry.object, item);
      this._collide(entry);
      this._lights(entry);
      this.emit('moved', { uid: item.uid, object: entry.object, item });
    }
    if (!!prev.hidden !== !!item.hidden) {
      entry.object.visible = !item.hidden;
      for (const h of entry.handles) h.enabled = !item.hidden;
      this._rugZone(entry);
      this._lights(entry);
    } else if (!same(prev.light, item.light)) {
      this._lights(entry);
    }
  }

  /** Replaces an item's model with a freshly built one. */
  _rebuild(entry, item) {
    const uid = item.uid;
    const old = entry.object;
    if (entry.gate) {
      this._ungate(entry.gate, false);
      entry.gate = null;
    }
    old.removeFromParent();
    disposeModel(old);
    for (const h of entry.handles) this.collision?.removeDynamic(h);
    this._dropZone(entry);
    this._entries.delete(uid);
    const e = this._build(item, true);
    return e;
  }

  /** Swaps part materials; false when the model cannot be recoloured in place (→ rebuild). */
  _recolor(entry, prev, item) {
    const model = entry.object.userData.model;
    if (!model || entry.gate) return false; // still showing placeholders: rebuild (cheap – same programs)
    entry.key = modelKey(item);
    const def = getArchetype(item.archetype);
    const full = mergeSpec(def, item);
    const parts = new Set([...Object.keys(item.colors || {}), ...Object.keys(item.materials || {}), ...Object.keys(prev.colors || {}), ...Object.keys(prev.materials || {})]);
    for (const part of parts) {
      if (prev.colors?.[part] === item.colors?.[part] && prev.materials?.[part] === item.materials?.[part]) continue;
      const hex = full.colors[part];
      const kind = full.materials[part];
      if (model.recolor) {
        if (model.recolor(part, hex, kind) === false) return false;
        continue;
      }
      const meshes = model.parts?.[part];
      if (!meshes?.length) continue;
      for (const m of meshes) {
        const ud = m.material?.userData;
        if (!ud?.cached || !ud.kind || ud.kind === 'paint' || ud.kind === 'emissive') return false;
      }
      for (const m of meshes) {
        const ud = m.material.userData;
        m.material = mat(kind || ud.kind, hex || ud.hex, ud.opts);
      }
      for (const m of meshes) setShadows(m, true, true);
    }
    this._shadowsDirty = true;
    // a new kind may need a program that is not compiled yet (sheen fabrics on «høy»): placeholders until it is
    entry.gate = this._gateObject(entry.object, () => {
      entry.gate = null;
    });
    return true;
  }

  /** Dynamic collision boxes for floor furniture taller than 0.3 m. */
  _collide(entry) {
    this._rugZone(entry);
    const { item, object } = entry;
    const wants = this.collision && item.mount === 'floor' && (item.dims?.h ?? 0) > 0.3;
    if (!wants) {
      for (const h of entry.handles) this.collision?.removeDynamic(h);
      entry.handles = [];
      return;
    }
    object.updateMatrixWorld(true);
    const boxes = [];
    const colliders = object.userData.model?.colliders;
    if (Array.isArray(colliders) && colliders.length) {
      for (const c of colliders) {
        const b = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max));
        boxes.push(b.applyMatrix4(object.matrixWorld));
      }
    } else {
      boxes.push(new THREE.Box3().setFromObject(object));
    }
    const floor = this._floorOf(item);
    for (const b of boxes) {
      // a little slack so chairs pushed under the table do not trap the player
      b.expandByVector(_v.set(-0.02, 0, -0.02));
      b.min.y = Math.max(b.min.y, floor);
    }
    if (entry.handles.length !== boxes.length) {
      for (const h of entry.handles) this.collision.removeDynamic(h);
      entry.handles = boxes.map((b) => Object.assign(this.collision.addDynamicBox(b, { id: item.uid, enabled: !item.hidden }), { furniture: true }));
    } else {
      entry.handles.forEach((h, i) => {
        h.box.copy(boxes[i]);
        h.enabled = !item.hidden;
      });
    }
  }

  /** Rugs: a 'rug' footstep zone over the footprint (muffled steps), kept in step with moves/removal. */
  _rugZone(entry) {
    const { item, object } = entry;
    this._dropZone(entry);
    if (item.mount !== 'rug' || item.hidden || !this.collision?.addSurfaceZone) return;
    object.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(object);
    if (b.isEmpty()) return;
    const floor = this._floorOf(item);
    b.min.y = Math.min(b.min.y, floor) - 0.05;
    b.max.y = Math.max(b.max.y, floor) + 0.25;
    entry.zone = this.collision.addSurfaceZone(b, 'rug');
  }

  /**
   * World y of the floor an item stands on: its level's floor, or lower when the item stands lower (the entrance lies
   * 0.30 under the basement level's floor). 0 for every item of the main level, as before.
   */
  _floorOf(item) {
    const lv = itemLevel(item, this.home.layout);
    if (lv === MAIN_LEVEL) return 0;
    return Math.min(levelFloorY(this.home.layout, lv), Number(item.position?.[1]) || 0);
  }

  _dropZone(entry) {
    if (entry.zone) this.collision?.removeSurfaceZone?.(entry.zone);
    entry.zone = null;
  }

  /** Sends the model's lights (world space, with the item's on/dimmer/colorK/lumens) to the LightManager. */
  _lights(entry) {
    const { item, object } = entry;
    const lights = object.userData.model?.lights || [];
    if (!this.lighting?.setItemLights) return;
    if (!lights.length || item.hidden) {
      if (entry.hadLights) this.lighting.setItemLights(item.uid, null);
      entry.hadLights = false;
      return;
    }
    object.updateMatrixWorld(true);
    const total = lights.reduce((s, l) => s + (l.lumens || 0), 0) || 1;
    const L = item.light || {};
    const world = lights.map((l) => {
      const out = {
        type: l.type || 'point',
        position: new THREE.Vector3(...(l.position || [0, 0, 0])).applyMatrix4(object.matrixWorld),
        colorK: L.colorK ?? l.colorK ?? 2700,
        lumens: L.lumens != null ? (L.lumens * (l.lumens || 0)) / total : l.lumens ?? 800,
        on: L.on !== false,
        dimmer: L.dimmer ?? 1,
        emissiveMeshes: l.emissiveMeshes || [],
      };
      if (l.direction) out.direction = new THREE.Vector3(...l.direction).transformDirection(object.matrixWorld);
      if (l.angle != null) out.angle = l.angle;
      if (l.penumbra != null) out.penumbra = l.penumbra;
      return out;
    });
    this.lighting.setItemLights(item.uid, world);
    entry.hadLights = true;
  }

  _shadows() {
    this.lighting?.requestShadowUpdate?.();
    this._shadowsDirty = false;
  }

  // ---- wall, windows, paints, env --------------------------------------------------------------------------------

  _syncWall() {
    const hw = this.home.highWall;
    if (!hw) return;
    const key = JSON.stringify(this.design.wall?.elements ?? null);
    // unchanged and still the group we built (WallPanel previews replace it directly): nothing to do
    if (key === this._wallKey && this._wallGroup?.parent) return;
    let group = null;
    try {
      group = applyWallDesign(hw, this.design.wall?.elements ?? null);
    } catch (err) {
      console.warn('[sync] wall design failed', err);
    }
    this._wallKey = key;
    this._wallGroup = group;
    if (this._wallGate) this._ungate(this._wallGate, false); // the previous group is gone
    this._wallGate = group ? this._gateObject(group, () => (this._wallGate = null)) : null;
    const lights = group?.userData?.model?.lights || [];
    if (this.lighting?.setItemLights) {
      if (lights.length) {
        hw.anchor.updateMatrixWorld(true);
        group.updateMatrixWorld(true);
        this.lighting.setItemLights('__wall', lights.map((l) => ({
          type: l.type || 'point',
          position: new THREE.Vector3(...l.position).applyMatrix4(group.matrixWorld),
          direction: l.direction ? new THREE.Vector3(...l.direction).transformDirection(group.matrixWorld) : undefined,
          angle: l.angle,
          penumbra: l.penumbra,
          colorK: l.colorK ?? 2700,
          lumens: l.lumens ?? 400,
          on: l.on !== false,
          dimmer: l.dimmer ?? 1,
          emissiveMeshes: l.emissiveMeshes || [],
        })));
      } else this.lighting.setItemLights('__wall', null);
    }
    this._shadows();
  }

  _syncWindow(windowId) {
    const w = this.home.windows?.find((x) => x.id === windowId);
    if (!w) return;
    let t = 1;
    try {
      t = applyShading(w, this.design.windows?.[windowId] ?? null)?.transmission ?? 1;
    } catch (err) {
      console.warn('[sync] shading failed', windowId, err);
    }
    this.lighting?.setWindowTransmission?.(windowId, t);
    this._shadows();
  }

  _syncPaint(wallId) {
    this.home.setPaint?.(wallId, this.design.paints?.[wallId] ?? null);
  }

  /** '#hex' of a wall's / ceiling's paint in use (the design's colour, else the data's). */
  _surfacePaintHex(id) {
    const layout = this.home.layout;
    const own = this.design.paints?.[id];
    const data = (layout?.house?.wallsById?.[id] ?? layout?.wallsById?.[id])?.paint
      ?? (layout?.house?.ceilings ?? layout?.ceilings ?? []).find((c) => c.id === id)?.paint;
    const c = own ?? data ?? 'sand';
    return layout?.resolvePaint?.(c) ?? c;
  }

  /** The meshes of a wall / ceiling a finish is shown with (WallInfo.meshes, the ceiling mesh). */
  _finishHosts(id) {
    const wall = this.home.walls?.find((w) => w.id === id);
    if (wall) return [...(wall.meshes || [])];
    return (this.home.pickables?.ceilings || []).filter((m) => m.userData?.pick?.ceilingId === id);
  }

  /** Builds / rebuilds / removes the slat finishes so they match design.finishes (only what changed is rebuilt). */
  _syncFinishes() {
    const finishes = this.design.finishes || {};
    const layout = this.home.layout;
    let changed = false;
    for (const [id, f] of [...this._finishes]) {
      if (finishes[id]) continue;
      if (f.gate) this._ungate(f.gate, false);
      disposeSurfaceFinish(f.object);
      this._finishes.delete(id);
      this.emit('finish', { surfaceId: id, object: null });
      changed = true;
    }
    for (const [id, spec] of Object.entries(finishes)) {
      const paintHex = this._surfacePaintHex(id);
      let plan = null;
      try {
        plan = finishPlan(layout, id, spec, { finishes, paintHex });
      } catch (err) {
        console.warn('[sync] finish plan failed', id, err);
      }
      const key = plan?.key ?? 'none';
      const cur = this._finishes.get(id);
      if (cur && cur.key === key) continue;
      if (cur) {
        if (cur.gate) this._ungate(cur.gate, false);
        disposeSurfaceFinish(cur.object);
      }
      let object = null;
      try {
        object = plan ? buildSurfaceFinish(plan, spec, { paintHex }) : null;
      } catch (err) {
        console.warn('[sync] finish failed', id, err);
      }
      const entry = { key, object, hosts: this._finishHosts(id), gate: null };
      if (object) {
        this.finishRoot.add(object);
        object.updateMatrixWorld(true);
        entry.gate = this._gateObject(object, () => (entry.gate = null));
      }
      this._finishes.set(id, entry);
      this.emit('finish', { surfaceId: id, object });
      changed = true;
    }
    if (changed) {
      this._finishVisibility();
      this._shadows();
    }
  }

  /** A finish is shown while its surface is (not concealed by the view, its room / level not hidden). */
  _finishVisibility() {
    let flipped = false;
    for (const f of this._finishes.values()) {
      const o = f.object;
      if (!o) continue;
      const show = !f.hosts.length || f.hosts.some(hostShown);
      if (o.visible !== show) {
        o.visible = show;
        flipped = true;
      }
    }
    if (flipped) this._shadows();
  }

  /** Light/time from the design. force = false (a design load): skipped when the env did not change since last time. */
  _syncEnv(force = false) {
    const env = this.design.env;
    const L = this.lighting;
    if (!L || !env) return;
    const key = JSON.stringify(env);
    if (!force && key === this._envKey) return; // Før/etter keeps the env: no sky/sun/shadow refresh
    this._envKey = key;
    L.setTime?.({ hour: env.hour, month: env.month, day: env.day });
    L.setMode?.(env.mode);
    if (L.setExposure) L.setExposure(env.exposure);
    else if (this.renderer) this.renderer.toneMappingExposure = env.exposure;
    for (const g of L.builtInGroups || []) L.setBuiltIn?.(g.id, env.builtIn?.[g.id] ?? null);
  }
}

export default SceneSync;
