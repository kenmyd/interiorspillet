import * as THREE from 'three';
import { layout as roomLayout } from './layout.js';
import { originalItems } from './existing.js';
import { configureMaterials, prepareMaterials, ALL_KINDS } from './materials.js';
import { buildShell } from './shell.js';
import { buildKitchen } from './kitchen.js';
import { buildExterior } from './exterior.js';
import { LightManager } from './lighting.js';
import { DesignState, setDesignLimits } from '../design/DesignState.js';
import { Saves } from '../design/Saves.js';
import { SceneSync } from '../design/SceneSync.js';
import { setModelQuality, ARCHETYPES } from '../models/registry.js';
import { setWallQuality, ELEMENT_TYPES } from '../models/walldesigns.js';

/** The open-plan room the HUD names (the zones of room-spec are not separate rooms). */
const OPEN_ROOM = Object.freeze({ id: 'stue-kjokken', name: 'Stue/kjøkken' });

/**
 * The home – the real living room (ARCHITECTURE §4). Game.js (and dev/sandbox) call createHome(ctx) once.
 *
 *   createHome(ctx) → home = {
 *     spawn: { position: Vector3 (feet), yaw, pitch },     dining area, looking toward the sitting area / windows
 *     rooms: [{ id, name, zoneId, box: Box3 }],            one box per room-spec zone, all the same room
 *                                                          (id 'stue-kjokken', HUD «Stue/kjøkken»)
 *     layout,                                              home/layout.js
 *     walls: WallInfo[], windows: WindowInfo[], doors: DoorInfo[], highWall: HighWallInfo   (from shell.js)
 *     ceilingHeightAt(x, z), floorY: 0,
 *     roots: { shell, kitchen, exterior, items, wall, shading },        THREE.Groups in the scene
 *     pickables: { floor, walls, ceilings, windows },                   meshes for Selection/Placement
 *     builtInLights: [...],                                             shell + kitchen (§15)
 *     lighting: LightManager, design: DesignState, saves: Saves, sync: SceneSync,
 *     shell, kitchen, exterior,                                         the builder results
 *     setPaint(wallId, color|null), paintOf(wallId) → colour or name in use
 *     update(dt, time, state), dispose(),
 *   }
 *
 * ctx (from Game.js, see SCAFFOLD.md) gets ctx.design and ctx.lighting added here. Start design (ctx.dev):
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
  scene.add(roots.exterior, roots.shell, roots.kitchen, roots.items, roots.wall, roots.shading);
  scene.updateMatrixWorld(true);
  // window anchors → roots.shading, the high wall anchor → roots.wall (same world transform)
  for (const w of shell.windows) if (w.anchor) roots.shading.attach(w.anchor);
  if (shell.highWall?.anchor) roots.wall.attach(shell.highWall.anchor);

  // one open room: the zones' boxes all count as «Stue/kjøkken», so walking between kitchen, dining area and the two
  // living areas never announces a new room (the HUD banner shows once, when the game starts)
  const rooms = layout.zones.map((z) => ({ id: OPEN_ROOM.id, name: OPEN_ROOM.name, zoneId: z.id, box: z.box.clone() }));
  const paintOf = (wallId) => design.paints[wallId] ?? layout.wallsById[wallId]?.paint ?? null;

  const home = {
    spawn: spawnPoint(layout),
    rooms,
    layout,
    walls: shell.walls,
    windows: shell.windows,
    doors: shell.doors,
    highWall: shell.highWall,
    ceilingHeightAt: shell.ceilingHeightAt ?? layout.ceilingHeightAt,
    floorY: 0,
    roots,
    pickables: shell.pickables,
    builtInLights: [...(shell.builtInLights || []), ...(kitchen.builtInLights || [])],
    shell,
    kitchen,
    exterior,
    design,
    saves,
    lighting: null,
    sync: null,
    setPaint: (wallId, color) => shell.setPaint?.(wallId, color),
    paintOf,
    update(dt, time, state) {
      shell.update?.(dt, state);
      home.sync.update(dt);
      home.lighting.update(dt, state?.camera ?? ctx.camera);
    },
    dispose() {
      home.sync.dispose();
      saves.dispose?.();
      home.lighting.dispose?.();
      shell.dispose?.();
      kitchen.dispose?.();
      exterior.dispose?.();
      for (const r of [roots.items, roots.wall, roots.shading]) r.removeFromParent();
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
  progress(0.88, 'Nesten klar');
  return home;
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
