import * as THREE from 'three';
import { layout as roomLayout, LIVING_ROOM_ID, MAIN_LEVEL_ID } from './layout.js';
import { originalItems } from './existing.js';
import { configureMaterials, prepareMaterials, ALL_KINDS } from './materials.js';
import { buildShell } from './shell.js';
import { buildKitchen } from './kitchen.js';
import { buildExterior } from './exterior.js';
import { buildRooms } from './rooms.js';
import { buildStairs } from './stairs.js';
import { buildBuiltIns } from './builtins.js';
import { createVisibility } from './visibility.js';
import { LightManager } from './lighting.js';
import { DesignState, setDesignLimits } from '../design/DesignState.js';
import { Saves } from '../design/Saves.js';
import { SceneSync } from '../design/SceneSync.js';
import { setModelQuality, ARCHETYPES } from '../models/registry.js';
import { setWallQuality, ELEMENT_TYPES } from '../models/walldesigns.js';

/** The open-plan room the HUD names (the zones of room-spec are not separate rooms). */
const OPEN_ROOM = Object.freeze({ id: 'stue-kjokken', name: 'Stue/kjøkken' });

/**
 * The home – the real house (ARCHITECTURE §4, notes/hele-huset-design.md). Game.js (and dev/sandbox) call
 * createHome(ctx) once.
 *
 *   createHome(ctx) → home = {
 *     spawn: { position: Vector3 (feet), yaw, pitch },     dining area, looking toward the sitting area / windows
 *     rooms: [{ id, name, zoneId, box: Box3 }],            one box per room-spec zone, all the same room
 *                                                          (id 'stue-kjokken', HUD «Stue/kjøkken»)
 *     layout,                                              home/layout.js
 *     walls: WallInfo[], windows: WindowInfo[], doors: DoorInfo[]     shell.js + the house builders (merged, below)
 *     highWall: HighWallInfo                                           shell.js
 *     ceilingHeightAt(x, z, y?), floorY: 0,                            y (world) given → the house's ceiling there
 *                                                                      (layout.house.ceilingHeightAt); without y the
 *                                                                      living room's, as before (§1.8)
 *     roots: { shell, kitchen, exterior, items, wall, shading,         THREE.Groups in the scene
 *              levels: { [levelId]: Group },                           everything of a level (below)
 *              rooms: { [roomId]: { id, name, levelId, kind, hud, group, surfaces, contents } } },
 *     pickables: { floor, walls, ceilings, windows },                  meshes for Selection/Placement (merged)
 *     builtInLights: [...],                                            shell + kitchen (§15) – the LightManager's list,
 *                                                                      still the living room's only (§4.2)
 *     house: { walls, windows, doors, pickables, builtInLights, colliders },   the whole house, every builder
 *     lighting: LightManager, design: DesignState, saves: Saves, sync: SceneSync, visibility (visibility.js),
 *     shell, kitchen, exterior,                                        the builder results
 *     parts: { rooms, stairs, builtIns },                              the house builders' results (rooms.js,
 *                                                                      stairs.js, builtins.js)
 *     setPaint(id, color|null), paintOf(wallId) → colour or name in use
 *     update(dt, time, state), dispose(),
 *   }
 *
 * The house builders (notes/hele-huset-design.md §2.1, steg 6 S0-stub) – buildRooms(ctx, layout, shell.materials),
 * buildStairs(ctx, layout), buildBuiltIns(ctx, layout) – all return the same build contract:
 *   { group, walls, windows, doors, pickables: { floor, walls, ceilings, windows }, builtInLights, colliders,
 *     update?(dt, state), setPaint?(id, color), dispose() }
 *   • walls / windows / doors / pickables are appended (after the shell's) to home.walls / windows / doors / pickables;
 *     a window's `anchor` is attached to roots.shading like the shell's. While every builder returns empty lists the
 *     home fields are the shell's own arrays, as before.
 *   • builtInLights go to home.house.builtInLights (the living room's first) – NOT to home.builtInLights, which the
 *     LightManager reads (lighting.js _buildBuiltIns): an unknown group starts at dimmer 1 and would light the living
 *     room's model. Steg 13 (L1) switches lighting.js to home.house.builtInLights.
 *   • colliders: static THREE.Box3 (→ collision.addStaticBox) or THREE.Object3D (→ collision.addStatic), registered
 *     here before Game.load builds the octree. Door leaves (Door.js addDynamicBox) and surface zones the builder
 *     registers itself through ctx.collision. home.house.colliders lists them all.
 *   • group: the builder's root; added to the scene when the builder left it without a parent.
 *   • update(dt, state) runs every frame after the shell's and must animate the builder's doors (a builder without
 *     update() gets door.update called on its doors here); setPaint(id, color) runs on every builder (each ignores
 *     ids it does not own); dispose() runs before the shell's.
 *
 * Scene roots of the levels and rooms (built from layout.house before the builders run, also given as ctx.roots):
 *   roots.levels[id]          one Group per level ('level:<id>'), everything of that level (visibility.js hides the
 *                             other level, §4.12). The living room's shell and kitchen are the first children of their
 *                             level, so the scene is traversed in the same order as before.
 *   roots.rooms[id].group     'room:<id>' in its level, with two children:
 *     .surfaces               'room:<id>:surfaces' – the room's walls, floor, ceilings, fittings (rooms.js; ViewModes
 *                             cuts them like roots.shell, §5.2)
 *     .contents               'room:<id>:contents' – built-ins, room lamps, decor: what visibility.js hides when the
 *                             room cannot be seen (§4.12)
 *   The living room's surfaces are roots.shell and roots.kitchen; its group stays empty. Every room of
 *   layout.house.rooms gets an entry, hud rooms (the stair, `hud: true`) included. Furniture stays in roots.items
 *   (SceneSync), the exterior in roots.exterior (no level).
 *
 * ctx (from Game.js, see SCAFFOLD.md) gets ctx.design, ctx.roots and ctx.lighting added here (ctx.lighting only after
 * the builders ran). Start design (ctx.dev):
 *   dev.start = 'original' (default; the previous unnamed session is kept as «Forrige økt …») | 'continue' (Saves.restore)
 *   dev.params ?design=<saved name> loads that design, &start=continue continues.
 *   dev.readOnlySaves = true (dev pages): saved designs are read but never written, no autosave.
 */

/** Material kinds the shell, kitchen and exterior use besides the furniture (textures made up front). */
const BASE_KINDS = ['white-oak', 'marble-dark', 'black-metal', 'glass-clear', 'painted', 'steel', 'moss'];

/**
 * Start-screen prefetch (main.js, idle time): generates – or loads from the IndexedDB cache – the textures of today's
 * room and of the design «Fortsett» would open (then those of every other material kind), so «Gå inn i stua» only has
 * to assemble the scene.
 * @param {{ quality?: object, kinds?: string[] }} [o]
 */
export async function prefetchHome({ quality = {}, kinds = [] } = {}) {
  configureMaterials({ quality });
  const all = new Set([...BASE_KINDS, ...kinds]);
  try {
    for (const it of originalItems(roomLayout)) for (const k of Object.values(it.materials || {})) all.add(k);
  } catch {
    /* only a prefetch */
  }
  await prepareMaterials([...all], null, { idle: true });
  // then everything the catalogue can bring (cached in IndexedDB: a later visit and «Plasser» never generate)
  await prepareMaterials([...ALL_KINDS], null, { idle: true });
}

export async function createHome(ctx) {
  const { scene, quality = {} } = ctx;
  const layout = ctx.layout ?? roomLayout;
  const progress = (p, t) => ctx.progress?.(p, t);
  const tick = () => new Promise((r) => setTimeout(r, 0));

  configureMaterials({ quality });
  setModelQuality(quality.level === 'low' ? 'low' : quality.level === 'high' ? 'high' : 'medium');
  // the first wall design is built by SceneSync before the WallPanel exists
  setWallQuality(quality.level === 'low' ? 'low' : quality.level === 'high' ? 'high' : 'medium');

  // ---- design first (it decides which textures we need)
  progress(0.05, 'Leser designet');
  registerDesignLimits();
  const design = new DesignState({ layout });
  const dev = ctx.dev || {};
  // dev pages read saved designs but never write them (dev.readOnlySaves)
  const saves = new Saves(design, dev.readOnlySaves ? { autosave: false, storage: readOnlyStorage() } : { autosave: false });
  let lastWriteToast = 0;
  saves.onWriteError = () => {
    const now = performance.now();
    if (now - lastWriteToast < 30000) return;
    lastWriteToast = now;
    ctx.events?.emit?.('toast', { text: 'Klarte ikke å lagre designet – lagringsplassen i nettleseren er full eller blokkert. Eksporter det til fil, eller slett gamle design under Design (M).', seconds: 7 });
  };
  chooseStartDesign(design, saves, dev);
  if (!dev.readOnlySaves) saves.enableAutosave();
  ctx.design = design;

  progress(0.12, 'Lager materialer');
  const kinds = new Set(BASE_KINDS);
  for (const it of design.list()) for (const k of Object.values(it.materials || {})) kinds.add(k);
  await prepareMaterials([...kinds], (f) => progress(0.12 + 0.3 * f, 'Lager materialer'));

  // ---- the house
  const roots = {
    shell: null,
    kitchen: null,
    exterior: null,
    items: new THREE.Group(),
    wall: new THREE.Group(),
    shading: new THREE.Group(),
    levels: {},
    rooms: {},
  };
  roots.items.name = 'items';
  roots.wall.name = 'wall-design';
  roots.shading.name = 'shading';

  progress(0.45, 'Bygger rommet');
  await tick();
  const shell = buildShell(ctx, layout);
  roots.shell = shell.group;
  progress(0.55, 'Bygger kjøkkenet');
  await tick();
  const kitchen = buildKitchen(ctx, layout);
  roots.kitchen = kitchen.group;
  progress(0.6, 'Utsikten');
  const exterior = buildExterior(ctx, layout);
  roots.exterior = exterior.group;

  // the levels and rooms of the house; the living room's shell and kitchen lead their level (same order as before)
  Object.assign(roots, createHouseRoots(layout, [shell.group, kitchen.group]));
  ctx.roots = roots;
  progress(0.62, 'Bygger resten av huset');
  await tick();
  const parts = {
    rooms: buildRooms(ctx, layout, shell.materials ?? null),
    stairs: buildStairs(ctx, layout),
    builtIns: buildBuiltIns(ctx, layout),
  };
  const built = Object.values(parts);

  scene.add(roots.exterior, ...Object.values(roots.levels), roots.items, roots.wall, roots.shading);
  for (const p of built) if (p.group && !p.group.parent) scene.add(p.group);
  const livingLights = [...(shell.builtInLights || []), ...(kitchen.builtInLights || [])];
  const house = mergeHouseParts(shell, built, livingLights);
  addColliders(ctx.collision, house.colliders);
  scene.updateMatrixWorld(true);
  // window anchors → roots.shading, the high wall anchor → roots.wall (same world transform)
  for (const w of house.windows) if (w.anchor) roots.shading.attach(w.anchor);
  if (shell.highWall?.anchor) roots.wall.attach(shell.highWall.anchor);

  // one open room: the zones' boxes all count as «Stue/kjøkken», so walking between kitchen, dining area and the two
  // living areas never announces a new room (the HUD banner shows once, when the game starts)
  const rooms = layout.zones.map((z) => ({ id: OPEN_ROOM.id, name: OPEN_ROOM.name, zoneId: z.id, box: z.box.clone() }));
  // any wall of the house (layout.house.wallsById holds the living room's walls as the same objects)
  const paintOf = (wallId) => design.paints[wallId] ?? (layout.house?.wallsById?.[wallId] ?? layout.wallsById[wallId])?.paint ?? null;

  const home = {
    spawn: spawnPoint(layout),
    rooms,
    layout,
    walls: house.walls,
    windows: house.windows,
    doors: house.doors,
    highWall: shell.highWall,
    ceilingHeightAt: homeCeilingHeightAt(layout),
    floorY: 0,
    roots,
    pickables: house.pickables,
    builtInLights: livingLights,
    house,
    shell,
    kitchen,
    exterior,
    parts,
    design,
    saves,
    lighting: null,
    sync: null,
    visibility: null,
    setPaint: (id, color) => {
      shell.setPaint?.(id, color);
      for (const p of built) p.setPaint?.(id, color);
    },
    paintOf,
    update(dt, time, state) {
      shell.update?.(dt, state);
      // a builder without update() still gets its doors animated
      for (const p of built) {
        if (p.update) p.update(dt, state);
        else for (const d of p.doors || []) d.door?.update?.(dt, state);
      }
      home.sync.update(dt);
      home.visibility?.update(dt, state);
      home.lighting.update(dt, state?.camera ?? ctx.camera);
    },
    dispose() {
      home.visibility?.dispose?.();
      home.sync.dispose();
      saves.dispose?.();
      home.lighting.dispose?.();
      for (const p of built) p.dispose?.();
      shell.dispose?.();
      kitchen.dispose?.();
      exterior.dispose?.();
      for (const r of [roots.items, roots.wall, roots.shading, ...Object.values(roots.levels)]) r.removeFromParent();
    },
  };

  progress(0.66, 'Lys');
  home.lighting = new LightManager({ scene, renderer: ctx.renderer, camera: ctx.camera, home, settings: ctx.settings, quality });
  ctx.lighting = home.lighting;

  progress(0.72, 'Møblerer');
  await tick();
  home.sync = new SceneSync({ home, design, lighting: home.lighting, collision: ctx.collision, renderer: ctx.renderer, scene, camera: ctx.camera });
  // the first build is compiled as one scene by Game.load (no per-model placeholders); later models are gated
  home.sync.gating = false;
  await home.sync.syncAllAsync((f) => progress(0.72 + 0.14 * f, 'Møblerer'));
  home.sync.gating = true;
  await exterior.ready?.catch?.(() => {});
  // last: it hides levels / room contents only once the game loop runs (after Game._precompile, §4.12)
  home.visibility = createVisibility(home, layout);
  progress(0.88, 'Nesten klar');
  return home;
}

/**
 * The scene roots of the house: one Group per level of layout.house.levels and one entry per room of
 * layout.house.rooms (see the top of this file). `lead` (the living room's shell and kitchen) become the first
 * children of the living room's level, before the room groups. A layout without `house` gets the ground floor and the
 * living room only. Pure (Node-testable): nothing is added to a scene.
 * @param {object} layout       home/layout.js
 * @param {THREE.Object3D[]} [lead]
 * @returns {{ levels: Object<string, THREE.Group>, rooms: Object<string, { id: string, name: string, levelId: string,
 *   kind: string, hud: boolean, group: THREE.Group, surfaces: THREE.Group, contents: THREE.Group }> }}
 */
export function createHouseRoots(layout, lead = []) {
  const h = layout?.house;
  const levelList = h?.levels?.length ? h.levels : [{ id: MAIN_LEVEL_ID }];
  const roomList = h?.rooms?.length ? h.rooms : [{ id: LIVING_ROOM_ID, name: OPEN_ROOM.name, levelId: MAIN_LEVEL_ID, kind: 'living', hud: false }];
  const levels = {};
  for (const lv of levelList) {
    const g = new THREE.Group();
    g.name = `level:${lv.id}`;
    g.userData.levelId = lv.id;
    levels[lv.id] = g;
  }
  const fallbackLevel = levelList.find((lv) => lv.id === MAIN_LEVEL_ID)?.id ?? levelList[0].id;
  const living = roomList.find((r) => r.id === LIVING_ROOM_ID);
  const livingLevel = levels[living?.levelId] ? living.levelId : fallbackLevel;
  for (const o of lead) if (o) levels[livingLevel].add(o);
  const rooms = {};
  for (const r of roomList) {
    const levelId = levels[r.levelId] ? r.levelId : fallbackLevel;
    const group = new THREE.Group();
    group.name = `room:${r.id}`;
    group.userData.roomId = r.id;
    group.userData.levelId = levelId;
    const surfaces = new THREE.Group();
    surfaces.name = `room:${r.id}:surfaces`;
    const contents = new THREE.Group();
    contents.name = `room:${r.id}:contents`;
    group.add(surfaces, contents);
    levels[levelId].add(group);
    rooms[r.id] = { id: r.id, name: r.name ?? r.id, levelId, kind: r.kind ?? 'room', hud: !!r.hud, group, surfaces, contents };
  }
  return { levels, rooms };
}

/**
 * Merges the house builders' results with the shell's (see the top of this file). A list no builder adds to is the
 * shell's own array (the same object as before the house builders existed).
 * @param {object} shell         buildShell result
 * @param {object[]} parts       build-contract results (rooms, stairs, built-ins)
 * @param {object[]} livingLights  the living room's built-in lights (shell + kitchen)
 * @returns {{ walls: object[], windows: object[], doors: object[], pickables: Object<string, THREE.Mesh[]>,
 *   builtInLights: object[], colliders: Array<THREE.Box3|THREE.Object3D> }}
 */
export function mergeHouseParts(shell, parts, livingLights = []) {
  const list = (key) => {
    const extra = parts.flatMap((p) => p?.[key] || []);
    const base = shell?.[key] || [];
    return extra.length ? [...base, ...extra] : base;
  };
  const basePick = shell?.pickables || { floor: [], walls: [], ceilings: [], windows: [] };
  const pickParts = parts.map((p) => p?.pickables).filter(Boolean);
  let pickables = basePick;
  if (pickParts.some((pk) => Object.values(pk).some((l) => l?.length))) {
    pickables = {};
    for (const k of new Set([...Object.keys(basePick), ...pickParts.flatMap((pk) => Object.keys(pk))])) {
      pickables[k] = [...(basePick[k] || []), ...pickParts.flatMap((pk) => pk[k] || [])];
    }
  }
  return {
    walls: list('walls'),
    windows: list('windows'),
    doors: list('doors'),
    pickables,
    builtInLights: [...livingLights, ...parts.flatMap((p) => p?.builtInLights || [])],
    colliders: parts.flatMap((p) => p?.colliders || []),
  };
}

/**
 * Registers static colliders of the build contract: THREE.Box3 → addStaticBox, anything else (an Object3D) →
 * addStatic. Call before collision.build() (Game.load builds after createHome).
 * @param {object|null} collision  CollisionWorld
 * @param {Array<THREE.Box3|THREE.Object3D>} [colliders]
 */
export function addColliders(collision, colliders) {
  if (!collision) return;
  for (const c of colliders || []) {
    if (!c) continue;
    if (c.isBox3) collision.addStaticBox(c);
    else collision.addStatic(c);
  }
}

/**
 * home.ceilingHeightAt(x, z, y?): with y (world) the house's ceiling there, without y the living room's (§1.8).
 * layout.ceilingHeightAt already forwards y to layout.house – it is used as is, so its dev warning about 2-argument
 * calls in other rooms names the real call site; an older layout without that gets a wrapper.
 * @param {object} layout
 * @returns {(x: number, z: number, y?: number) => number}
 */
export function homeCeilingHeightAt(layout) {
  const own = layout.ceilingHeightAt;
  const house = layout.house?.ceilingHeightAt;
  if (!house || own.length >= 3) return own;
  return (x, z, y) => (y === undefined || y === null ? own(x, z) : house(x, z, y));
}

/**
 * Start design: ?design=<name> → that saved design; dev.start 'continue' (or ?start=continue) → the last session;
 * otherwise today's room. Starting fresh keeps an unnamed previous session with real changes as «Forrige økt (dato)»
 * (at most the last three are kept – Saves.archiveSession).
 */
function chooseStartDesign(design, saves, dev) {
  const params = dev.params;
  try {
    if (params?.get?.('design') && saves.loadFromParams(params)) {
      design.clearHistory();
      return;
    }
    const start = dev.start ?? params?.get?.('start') ?? 'original';
    if (start === 'continue') {
      saves.restore();
      design.clearHistory();
      return;
    }
    // the design is already today's room (new DesignState): only the stored state needs to follow
    if (saves.activeName || saves.hasAutosave()) saves.archiveSession();
    design.clearHistory();
  } catch (err) {
    console.warn('[home] could not choose the start design', err);
  }
}

/** Model limits for loaded/imported designs (DesignState clamps sizes, params and wall elements with them). */
function registerDesignLimits() {
  try {
    const archetypes = {};
    for (const [id, def] of Object.entries(ARCHETYPES)) {
      const params = {};
      for (const [k, p] of Object.entries(def.params || {})) {
        if (p?.type === 'number' && Number.isFinite(p.min) && Number.isFinite(p.max)) params[k] = { type: 'number', min: p.min, max: p.max };
      }
      archetypes[id] = { dimsRange: def.dimsRange || null, params };
    }
    setDesignLimits({ archetypes, wallTypes: Object.keys(ELEMENT_TYPES) });
  } catch (err) {
    console.warn('[home] design limits not registered', err);
  }
}

/** localStorage wrapper that ignores writes (dev pages). */
function readOnlyStorage() {
  let ls = null;
  try {
    ls = typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    ls = null;
  }
  return {
    getItem: (k) => {
      try {
        return ls?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem() {},
    removeItem() {},
  };
}

/** Dining area, looking past the table toward the sitting area and the big south windows. */
function spawnPoint(layout) {
  const z = layout.zones.find((zn) => zn.id === 'spisestue');
  const pos = new THREE.Vector3(4.2, 0, 4.0);
  if (z && !z.contains(pos.x, pos.z)) pos.set(z.centroid.x, 0, z.centroid.y);
  // look past the dining table toward the swivel chairs and the south windows; yaw 0 = −z, + turns left
  const target = new THREE.Vector3(6.2, 1.2, 10.3);
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(target.y - 1.66, Math.hypot(dx, dz));
  return { position: pos, yaw, pitch };
}
