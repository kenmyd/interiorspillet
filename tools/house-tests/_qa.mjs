/**
 * Shared helpers for the round's cross-package tests (design/qa.md §3.0; MASTER §4.2 P09) – not a test itself
 * (tools/test-house.mjs only runs *.test.mjs). Import _lib.mjs first, then this file; the line works from
 * tools/house-tests/ and from tools/house-tests/wip/:
 *
 *   const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
 *   const Q = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_qa.mjs' : './_qa.mjs', import.meta.url));
 *
 *   PARTIAL                 QA_PARTIAL=1: «the round is not finished yet» checks print an info line instead of failing
 *   soft(name, ok, detail)  check() in strict mode, an info line under QA_PARTIAL (round targets, builders that do not
 *                           exist yet for NEW archetypes – never regressions of baseline facts)
 *   pending(name, detail)   an info line «venter: …» (a contract the owning package has not delivered); counts as a
 *                           failure in strict mode
 *   WAIVERS                 { '<target>': 'note' } – only the integrator fills it (MASTER D43), e.g.
 *                           { 'bildebelysning>=2': 'Bare én butikk hadde bildelamper på lager – se notes/…' }
 *   BASE                    tools/house-tests/fixtures/catalog-baseline.json (c28070d facts)
 *   SCHEMA, NEW_ARCHETYPES, isNewArchetype(id)   archetypes.json and the archetypes added this round
 *   cssHook()               stylesheets load as empty modules (Placement → Selection → panelKit imports CSS)
 *   quiet(fn)               runs fn with console.warn silenced
 *   three()                 three.js – the same module file the app's `import 'three'` resolves to
 *   syncedHome(o)           SceneSync + LightManager in Node with a stub home (qa §3.0, scratchpad/qa/probe-sync.mjs)
 *   ceilAt(layout, x, z, y) the ceiling height over (x, z) on the level whose floor is under y
 *   memStorage(), memBackend(map)                 an in-memory localStorage and an ImageStore-shaped backend
 *   pngBytes(w, h, rgbAt), jpegHeader(w, h), webpHeader(w, h)   real/minimal image bytes for sniffMime/imageSize
 *   SPOT_ROLES, spotSpec(role, o), pick(role)    item specs of the six spot archetypes (synthetic – no product id) and
 *                                                the catalogue's spotter product for a role (null until research lands)
 */
import { registerHooks, createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ROOT, imp, readJson, check } from './_lib.mjs';

export const PARTIAL = process.env.QA_PARTIAL === '1';

/** Round targets the integrator waives (MASTER D43: a shortfall is reported, never faked). Only the integrator edits this. */
export const WAIVERS = {};

export const BASE = readJson('tools/house-tests/fixtures/catalog-baseline.json');
export const SCHEMA = readJson('src/data/archetypes.json');
const BASE_ARCH = new Set(BASE.archetypes);
/** Archetypes of archetypes.json that were not there at c28070d (the round's new ones). */
export const NEW_ARCHETYPES = Object.freeze(Object.keys(SCHEMA.archetypes).filter((id) => !BASE_ARCH.has(id)));
export const isNewArchetype = (id) => !BASE_ARCH.has(id) && !!SCHEMA.archetypes[id];

let infos = 0;
/** check() in strict mode; under QA_PARTIAL a passing check counts, a failing one prints «info» and does not fail. */
export function soft(name, ok, detail = '') {
  if (ok || !PARTIAL) return check(name, ok, detail);
  infos++;
  console.log(`  info ${name}${detail ? `  → ${detail}` : ''}  (QA_PARTIAL: runden er ikke ferdig)`);
  return false;
}
/** A contract the owning package has not delivered yet: «venter» under QA_PARTIAL, a failure in strict mode. */
export function pending(name, detail = '') {
  if (!PARTIAL) return check(name, false, `venter fortsatt: ${detail}`);
  infos++;
  console.log(`  venter ${name}${detail ? `  → ${detail}` : ''}`);
  return false;
}
/** Number of info/pending lines printed so far (for a test's own summary line). */
export const infoCount = () => infos;

let hooked = false;
/** Stylesheets as empty modules (editor-levels.test.mjs:9-17). Idempotent. */
export function cssHook() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    },
  });
}

/** fn() with console.warn silenced (the registry and the LightManager warn about things the tests provoke). */
export function quiet(fn) {
  const w = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = w;
  }
}

let _three = null;
/** three.js – the module file the app's `import 'three'` resolves to (one THREE instance with the src/ modules). */
export async function three() {
  if (_three) return _three;
  try {
    _three = await import('three');
  } catch {
    const req = createRequire(path.join(ROOT, 'package.json'));
    _three = await import(pathToFileURL(path.join(path.dirname(req.resolve('three')), 'three.module.js')).href);
  }
  return _three;
}

/** Ceiling height (world y) over (x, z) on the level whose floor is under y (layout.house when it knows levels). */
export function ceilAt(layout, x, z, y = 1) {
  const own = layout.ceilingHeightAt, house = layout.house?.ceilingHeightAt;
  return house && own.length < 3 ? house(x, z, y) : own(x, z, y);
}

/**
 * SceneSync + LightManager in Node with a stub home (no renderer): the built-ins, and the original design's items
 * queued and flushed when `original` (default). Same construction as the lighting fixture's generator.
 * @param {{ level?: 'low'|'medium'|'high', doors?: Array<{ id: string, door: { t: number } }>, original?: boolean }} [o]
 */
export async function syncedHome({ level = 'medium', doors = [], original = true } = {}) {
  cssHook();
  const THREE = await three();
  (await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
  const { layout } = await imp('src/home/layout.js');
  const { LightManager } = await imp('src/home/lighting.js');
  const { DesignState } = await imp('src/design/DesignState.js');
  const { SceneSync } = await imp('src/design/SceneSync.js');
  const lights = layout.builtInLights.map((l) => ({ ...l }));
  const scene = new THREE.Scene();
  const M = quiet(() => new LightManager({ scene, home: { layout, builtInLights: lights, house: { builtInLights: [...lights] }, doors }, quality: { level } }));
  const items = new THREE.Group();
  scene.add(items);
  const own = layout.ceilingHeightAt, house = layout.house?.ceilingHeightAt;
  const home = { roots: { items }, layout, walls: layout.walls, windows: layout.windows, ceilingHeightAt: (!house || own.length >= 3) ? own : (x, z, y) => (y == null ? own(x, z) : house(x, z, y)) };
  const design = new DesignState({ original });
  const sync = new SceneSync({ home, design, lighting: M });
  sync.gating = false;
  for (const it of design.list()) sync._queue.add(it.uid);
  quiet(() => sync.flush());
  const cam = new THREE.PerspectiveCamera();
  const r12 = (v) => (typeof v === 'number' ? +v.toPrecision(12) : v);
  const api = {
    THREE, layout, M, sync, design, scene, home, items, level,
    /** Applies queued design changes (SceneSync listens to the design and queues; flush builds now). */
    flush: () => quiet(() => sync.flush()),
    /** The LightManager at `hour` seen from pos → look (selection forced, two updates like the fixture). */
    at(hour, pos, look) {
      api.flush();
      M.setTime({ hour, month: 10, day: 18 });
      cam.position.set(...(pos.isVector3 ? pos.toArray() : pos));
      if (look) cam.lookAt(...(look.isVector3 ? look.toArray() : look));
      cam.updateMatrixWorld(true);
      M._selectAt = -1e9;
      M.update(0, cam);
      M.update(1 / 60, cam);
      return M;
    },
    /** Pool slots of a kind: [{ i, id, cand, shadowed }]. */
    slots: (kind = 'spot') => M._pool[kind].map((s, i) => ({ i, id: s.cand?.id ?? null, cand: s.cand ?? null, shadowed: !!s.shadowed })),
    lightCount() {
      const c = {};
      scene.traverse((o) => {
        if (o.isLight) c[o.type] = (c[o.type] || 0) + 1;
      });
      return c;
    },
    pools: () => Object.fromEntries(['point', 'spot', 'rect'].map((k) => [k, M._pool[k].length])),
    /** The fixture's per-pose fields (lighting-baseline.json format). */
    snap() {
      const info = M.info();
      return {
        room: M.cameraRoomId, Lkey: r12(M._Lkey), S: r12(M._Starget), wb: M._wbTarget.toArray().map(r12), wbK: r12(M._wbK), amb: r12(M._ambTarget),
        info: { effective: info.effective, lampsOnByDefault: info.lampsOnByDefault, lampLumens: r12(info.lampLumens) },
        slots: ['point', 'spot', 'rect'].map((k) => M._pool[k].map((s) => s.cand?.id ?? null).join(',')).join('|'),
      };
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// Storage stand-ins (persistence §7)

/** An in-memory localStorage (getItem/setItem/removeItem/key/length/clear). `fail` makes every call throw. */
export function memStorage(init = {}, { fail = false } = {}) {
  const m = new Map(Object.entries(init));
  const guard = () => {
    if (fail) throw new Error('storage unavailable');
  };
  return {
    get length() {
      guard();
      return m.size;
    },
    key: (i) => (guard(), [...m.keys()][i] ?? null),
    getItem: (k) => (guard(), m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => (guard(), void m.set(String(k), String(v))),
    removeItem: (k) => (guard(), void m.delete(String(k))),
    clear: () => (guard(), void m.clear()),
    _map: m,
  };
}

/** An ImageStore-shaped backend over a Map (same shape as src/design/ImageStore.js memBackend). */
export function memBackend(map = new Map(), { persistent = false } = {}) {
  const clone = (r) => (r == null ? r : { ...r, bytes: r.bytes instanceof Uint8Array ? new Uint8Array(r.bytes) : r.bytes });
  return {
    name: 'memory',
    persistent,
    get: async (id) => (map.has(id) ? clone(map.get(id)) : undefined),
    put: async (rec) => void map.set(rec.id, clone(rec)),
    delete: async (id) => void map.delete(id),
    keys: async () => [...map.keys()],
    all: async () => [...map.values()].map(clone),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Image bytes

/** A real RGB PNG (8 bit, no filter) – rgbAt(x, y) → [r, g, b]. */
export function pngBytes(w, h, rgbAt = (x, y) => [(x * 255) / Math.max(1, w - 1), (y * 255) / Math.max(1, h - 1), 128]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbAt(x, y);
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** A minimal JPEG header (SOI + APP0 + SOF0 with the size + EOI) – enough for a mime sniff and a size read. */
export function jpegHeader(w, h) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

/** A minimal WebP (RIFF + VP8X with the canvas size). */
export function webpHeader(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return new Uint8Array(b);
}

// ---------------------------------------------------------------------------------------------------------------
// Spot fittings (MASTER §2.3, §2.5; qa §3.1 roles)

/** role → archetype + params of a synthetic fitting (the contract's defaults with the role's distinguishing params). */
export const SPOT_ROLES = Object.freeze({
  recessedRound: { archetype: 'downlight', dims: { w: 0.09, d: 0.09, h: 0.008 }, params: { shape: 'round' }, lumens: 450, sub: 'innfelt', match: (p) => p.archetype === 'downlight' && p.params?.shape !== 'square' && !p.params?.tiltable },
  recessedSquare: { archetype: 'downlight', dims: { w: 0.09, d: 0.09, h: 0.008 }, params: { shape: 'square' }, lumens: 450, sub: 'innfelt', match: (p) => p.archetype === 'downlight' && p.params?.shape === 'square' },
  recessedTilt: { archetype: 'downlight', dims: { w: 0.09, d: 0.09, h: 0.01 }, params: { shape: 'round', tiltable: true, tilt: 30 }, lumens: 450, sub: 'innfelt', match: (p) => p.archetype === 'downlight' && p.params?.tiltable === true },
  surface: { archetype: 'downlight-surface', dims: { w: 0.09, d: 0.09, h: 0.1 }, params: { shape: 'round' }, lumens: 500, sub: 'utenpaliggende', match: (p) => p.archetype === 'downlight-surface' },
  rail: { archetype: 'spot-track', dims: { w: 1.2, d: 0.055, h: 0.16 }, params: { heads: 4, railKind: 'track', tilt: 25 }, lumens: 1200, sub: 'skinne', match: (p) => p.archetype === 'spot-track' && (p.params?.heads ?? 3) >= 3 },
  spotSingle: { archetype: 'spot-ceiling', dims: { w: 0.08, d: 0.08, h: 0.16 }, params: { tilt: 20 }, lumens: 350, sub: 'takspot', match: (p) => p.archetype === 'spot-ceiling' },
  wallSpot: { archetype: 'spot-wall', dims: { w: 0.08, d: 0.16, h: 0.12 }, params: { heads: 1, tilt: 45 }, lumens: 300, sub: 'veggspot', match: (p) => p.archetype === 'spot-wall' },
  pictureLight: { archetype: 'picture-light', dims: { w: 0.45, d: 0.2, h: 0.12 }, params: { tilt: 40 }, lumens: 250, sub: 'bildebelysning', match: (p) => p.archetype === 'picture-light' },
});

const SPOT_COLORS = { shade: '#f2f2f0', inner: '#d8d8d4', base: '#f2f2f0', metal: '#bfbfbf', cord: '#1a1a1a' };
const SPOT_MATERIALS = { shade: 'painted', inner: 'chrome', base: 'painted', metal: 'steel', cord: 'cotton' };

/**
 * A synthetic DesignState spec of a spot role (no product id): `o` = { position, rotationDeg, level, params, dims,
 * attach, light, name }. Ceiling fittings: position y = the ceiling height there (Placement's convention).
 */
export function spotSpec(role, o = {}) {
  const r = SPOT_ROLES[role];
  if (!r) throw new Error(`ukjent rolle ${role}`);
  const mount = SCHEMA.archetypes[r.archetype]?.mount ?? 'ceiling';
  return {
    source: 'custom',
    refId: null,
    name: o.name ?? `QA ${role}`,
    category: 'spotter',
    archetype: r.archetype,
    mount,
    position: o.position ?? [0, 0, 0],
    level: o.level ?? 'hoved',
    rotationDeg: o.rotationDeg ?? 0,
    dims: { ...r.dims, ...(o.dims || {}) },
    params: { ...r.params, ...(o.params || {}) },
    colors: { ...SPOT_COLORS },
    materials: { ...SPOT_MATERIALS },
    light: { on: true, dimmer: 0.4, colorK: 2700, lumens: r.lumens, ...(o.light || {}) },
    ...(o.attach ? { attach: o.attach } : {}),
  };
}

/** The catalogue's first spotter product for a role (default variant), or null (research not promoted yet). */
export async function pick(role, { products } = {}) {
  const r = SPOT_ROLES[role];
  if (!r) return null;
  const list = products ?? (await imp('src/catalog/index.js')).products('spotter');
  return list.find((p) => p.subcategory === r.sub && r.match(p)) ?? list.find((p) => r.match(p)) ?? null;
}

/** True when a project file exists (relative to the repo root). */
export const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
