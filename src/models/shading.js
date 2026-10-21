// Sun shading for the windows (ARCHITECTURE §8): venetian blinds, roller blinds, pleated blinds, duo rollers,
// vertical blinds, curtains, roman blinds and exterior screens, built in a window's shading anchor.
//
//   SHADING_TYPES                     [{ archetype, label, params, mounts, defaultMount, tilt, band, main, partLabels }]
//   FABRICS, MOUNT_LABELS             fabric types (light transmission / see-through) and mount names (Norwegian)
//   defaultShadingSpec(archetype, windowInfo?) → ShadingSpec   a sensible spec without a product
//   applyShading(windowInfo, spec|null) → { group, transmission }   builds in windowInfo.anchor, removes the old one;
//                                     when only open/tilt (and params.band/params.top) change, the existing model
//                                     animates smoothly to the new state instead of being rebuilt
//   shadingTransmission(spec) → 0..1  share of daylight let in (1 = no shading / fully open)
//   shadingSize(windowInfo, spec)     the computed size (width, drop, track, fabric width, pieces …) for prices/UI
//   updateShading(dt)                 optional per-frame driver (animations also run from the renderer by themselves)
//   setShadingDaylight(colour|null, windowId?)  unshaded sky radiance behind translucent fabrics (null = automatic:
//                                     the window's sky RectAreaLight, else setShadingDaylightHint(), else hemi/sun)
//   shadingHooks.requestShadowUpdate  called once when an animation ends (while moving: renderer.shadowMap at 30 Hz)
//   productSizing(product)            made to measure or ready-made (widths, length, pair, max size) from the notes
//   shadingMounts(archetype, windowInfo) / defaultShadingMount(…) / shadingMountLabel(mount, archetype, windowInfo)
//                                     mounts per window: on the terrace door 'frame' = on the door leaf (blinds)
//   shadingDoorNote(windowInfo, spec) what happens to the shading when the terrace door opens (Norwegian, or null)
//   releaseShading(windows?)          removes/frees the shading of these windows and forgets the module state
//                                     (WindowPanel calls it when the editor is disposed)
//
// Terrace door (windowInfo.door = world/Door.js): venetian / roller / pleated / duo blinds mounted 'frame' hang on
// the leaf's pivot and swing with the door; other blinds go up while the door is open (Door.onChange) and come back
// down when it has closed; an exterior screen holds the outward-opening door (door.open is wrapped) until it is up.
//
// Anchor frame (home.windows[].anchor): origin = top middle of the opening in the wall's room-side plane, +x = right
// seen from the room, −y = down, +z = into the room. The reveal goes from z = 0 back to z = −revealDepth where the
// window frame sits. Everything here is built in that frame in metres.
//
// Light: opaque parts cast normal shadows (tilted venetian slats give striped sunlight from real geometry);
// translucent fabrics cast an ordered-dither shadow (customDepthMaterial, density = 1 − transmission) so the PCF
// filter turns it into a partial shadow, and their room side glows when the sun or the daylit window is behind them
// (a translucency term patched into the standard lighting). See-through fabrics (sheer, screen) are transparent.
import * as THREE from 'three';
import { mat, resolveColor } from '../home/materials.js';
import { layout as roomLayout } from '../home/layout.js';
import { getProduct } from '../catalog/index.js';
import { box, roundedBox, rng, clamp01, lerp, DEG } from './kit.js';
import { mergeSpec } from './registry.js';

// ---------------------------------------------------------------------------------------------------------------
// Fabrics, mounts, archetype definitions

/**
 * Fabric types. T = share of light let through when the fabric covers the window, view = how see-through it is
 * (rendered as transparency), kind = default material kind (home/materials.js).
 */
export const FABRICS = Object.freeze({
  sheer: { label: 'Flortynn (voile)', T: 0.7, view: 0.5, kind: 'linen' },
  linen: { label: 'Lin (halvtransparent)', T: 0.5, view: 0.16, kind: 'linen' },
  screen: { label: 'Screen (ser ut, skjermer sol)', T: 0.12, view: 0.32, kind: 'woven' },
  filter: { label: 'Lysfiltrerende', T: 0.35, view: 0.04, kind: 'woven' },
  dimout: { label: 'Lysdempende', T: 0.1, view: 0, kind: 'woven' },
  blackout: { label: 'Mørklegging (lystett)', T: 0, view: 0, kind: 'woven' },
  velvet: { label: 'Fløyel', T: 0.04, view: 0, kind: 'velour' },
  wool: { label: 'Ull', T: 0.1, view: 0, kind: 'wool' },
});

/** Norwegian names of the mounts. */
export const MOUNT_LABELS = Object.freeze({
  recess: 'Innenfor lysningen',
  frame: 'På vinduskarmen',
  wall: 'På veggen over vinduet',
  ceiling: 'I taket',
  exterior: 'Utvendig på fasaden',
});

const fabricOptions = (keys) => keys.map((k) => [k, FABRICS[k].label]);

const DEFS = {
  venetian: {
    label: 'Persienne',
    main: 'slat',
    mounts: ['recess', 'frame', 'wall'],
    mount: 'recess',
    tilt: true,
    params: {
      slatMm: { type: 'enum', label: 'Lamellbredde', options: [[16, '16 mm'], [25, '25 mm'], [35, '35 mm'], [50, '50 mm']] },
      material: { type: 'enum', label: 'Lameller', options: [['alu', 'Aluminium'], ['wood', 'Tre'], ['bamboo', 'Bambus']] },
      ladderTape: { type: 'bool', label: 'Stigebånd i stedet for snor' },
    },
    defaults: {
      params: { slatMm: 25, material: 'alu', ladderTape: false },
      colors: { slat: '#f1efe9', rail: '#f1efe9' },
      materials: { slat: 'painted', rail: 'painted' },
      open: 0,
      tilt: 45,
    },
  },
  roller: {
    label: 'Rullegardin',
    main: 'fabric',
    mounts: ['recess', 'wall', 'ceiling'],
    mount: 'recess',
    params: {
      fabric: { type: 'enum', label: 'Stoff', options: fabricOptions(['screen', 'sheer', 'linen', 'filter', 'dimout', 'blackout']) },
      cassette: { type: 'bool', label: 'Kassett over rullen' },
      operation: { type: 'enum', label: 'Betjening', options: [['chain', 'Kjede'], ['cordless', 'Snorløs (fjær)'], ['motor', 'Motor']] },
    },
    defaults: {
      params: { fabric: 'screen', cassette: false, operation: 'chain' },
      colors: { fabric: '#cfcac0', rail: '#e6e6e3' },
      materials: { fabric: 'woven', rail: 'painted' },
      open: 0.5,
      tilt: 0,
    },
  },
  pleated: {
    label: 'Plissé',
    main: 'fabric',
    mounts: ['recess', 'frame'],
    mount: 'recess',
    top: true,
    params: {
      mode: { type: 'enum', label: 'Type', options: [['single', 'Enkel'], ['topdown-bottomup', 'Opp og ned (fri topp)'], ['duette', 'Dobbel (honeycomb)']] },
      pleatMm: { type: 'enum', label: 'Foldebredde', options: [[15, '15 mm'], [20, '20 mm'], [25, '25 mm']] },
      fabric: { type: 'enum', label: 'Stoff', options: fabricOptions(['sheer', 'filter', 'dimout', 'blackout']) },
    },
    defaults: {
      params: { mode: 'single', pleatMm: 20, fabric: 'filter', top: 0 },
      colors: { fabric: '#efece5', rail: '#eeeeec' },
      materials: { fabric: 'woven', rail: 'painted' },
      open: 0.5,
      tilt: 0,
    },
  },
  'duo-roller': {
    label: 'Duo-rullegardin',
    main: 'fabric',
    mounts: ['recess', 'wall', 'ceiling'],
    mount: 'recess',
    band: true,
    params: {
      cassette: { type: 'bool', label: 'Kassett over rullen' },
      operation: { type: 'enum', label: 'Betjening', options: [['chain', 'Kjede'], ['motor', 'Motor']] },
    },
    defaults: {
      params: { cassette: true, operation: 'chain', band: 0, transmission: 0.4 },
      colors: { fabric: '#d9d4ca', rail: '#e6e6e3' },
      materials: { fabric: 'woven', rail: 'painted' },
      open: 0,
      tilt: 0,
    },
  },
  vertical: {
    label: 'Lamellgardin',
    main: 'fabric',
    mounts: ['ceiling', 'wall', 'recess'],
    mount: 'ceiling',
    tilt: true,
    params: {
      vaneMm: { type: 'enum', label: 'Lamellbredde', options: [[89, '89 mm'], [127, '127 mm']] },
      stack: { type: 'enum', label: 'Trekkes til', options: [['left', 'Venstre'], ['right', 'Høyre'], ['split', 'Begge sider']] },
      length: { type: 'enum', label: 'Lengde', options: [['floor', 'Til gulvet'], ['sill', 'Til vindusbrettet']] },
      fabric: { type: 'enum', label: 'Stoff', options: fabricOptions(['filter', 'dimout', 'blackout']) },
    },
    defaults: {
      params: { vaneMm: 89, stack: 'left', fabric: 'dimout' },
      colors: { fabric: '#efede8', rail: '#e6e6e3' },
      materials: { fabric: 'woven', rail: 'painted' },
      open: 0,
      tilt: 30,
    },
  },
  curtain: {
    label: 'Gardin',
    main: 'fabric',
    mounts: ['ceiling', 'wall'],
    mount: 'ceiling',
    params: {
      fold: { type: 'enum', label: 'Foldetype', options: [['wave', 'Wave (bølgefold)'], ['pleat', 'Rynkebånd (fold)'], ['ring', 'Ringer på stang'], ['eyelet', 'Maljer på stang']] },
      fabric: { type: 'enum', label: 'Stoff', options: fabricOptions(['sheer', 'linen', 'velvet', 'wool', 'dimout', 'blackout']) },
      span: { type: 'enum', label: 'Bredde', options: [['window', 'Bare dette vinduet'], ['wall', 'Hele vindusveggen']] },
      panels: { type: 'enum', label: 'Oppdeling', options: [[2, 'To gardiner (par)'], [1, 'Én gardin']] },
      side: { type: 'enum', label: 'Trekkes til', options: [['left', 'Venstre'], ['right', 'Høyre']] },
      length: { type: 'enum', label: 'Lengde', options: [['floor', 'Til gulvet'], ['sill', 'Til vindusbrettet']] },
      fullness: { type: 'number', label: 'Fylde (stoff ÷ bredde)', min: 1, max: 3, step: 0.1 },
    },
    defaults: {
      params: { fold: 'wave', fabric: 'linen', span: 'window', panels: 2, side: 'left' },
      colors: { fabric: '#ddd3c3', rail: '#1e1e1e' },
      materials: { fabric: 'linen', rail: 'black-metal' },
      open: 1,
      tilt: 0,
    },
  },
  roman: {
    label: 'Liftgardin',
    main: 'fabric',
    mounts: ['recess', 'frame', 'wall', 'ceiling'],
    mount: 'recess',
    params: {
      folds: { type: 'number', label: 'Antall folder', min: 3, max: 10, step: 1 },
      fabric: { type: 'enum', label: 'Stoff', options: fabricOptions(['sheer', 'linen', 'filter', 'dimout', 'blackout']) },
    },
    defaults: {
      params: { folds: 6, fabric: 'filter' },
      colors: { fabric: '#cbbca5', rail: '#e6e6e3' },
      materials: { fabric: 'woven', rail: 'painted' },
      open: 0.6,
      tilt: 0,
    },
  },
  'exterior-screen': {
    label: 'Utvendig screen',
    main: 'fabric',
    mounts: ['exterior'],
    mount: 'exterior',
    params: {
      motor: { type: 'bool', label: 'Motor' },
    },
    defaults: {
      params: { fabric: 'screen', motor: true, transmission: 0.05 },
      colors: { fabric: '#2f2f2e', rail: '#1f1f1f' },
      materials: { fabric: 'woven', rail: 'black-metal' },
      open: 0.4,
      tilt: 0,
    },
  },
};

const PART_LABELS = { fabric: 'Stoff', slat: 'Lameller', rail: 'Skinne og beslag' };

/** Shading archetypes for the WindowPanel (params in Def.params format, labels in Norwegian). */
export const SHADING_TYPES = Object.freeze(Object.entries(DEFS).map(([archetype, d]) => Object.freeze({
  archetype,
  label: d.label,
  params: d.params,
  mounts: d.mounts,
  defaultMount: d.mount,
  tilt: !!d.tilt,
  band: !!d.band,
  top: !!d.top,
  main: d.main,
  partLabels: PART_LABELS,
})));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------------------------------------------
// Terrace door: blinds on the door leaf («dørpersienne», follows the leaf) or raised when the door opens

/** Types that can be mounted on the terrace door's leaf (mount 'frame' on a terrace door = on the leaf). */
const LEAF_TYPES = new Set(['venetian', 'pleated', 'roller', 'duo-roller']);
const isDoorInfo = (info) => info?.type === 'terrace-door';

/**
 * Mounts a shading type can have on this window (the terrace door adds «on the door leaf» for blinds).
 * @param {string} archetype
 * @param {object} [windowInfo]
 * @returns {string[]}
 */
export function shadingMounts(archetype, windowInfo) {
  const d = DEFS[archetype];
  if (!d) return [];
  const m = [...d.mounts];
  if (isDoorInfo(windowInfo) && LEAF_TYPES.has(archetype) && !m.includes('frame')) m.unshift('frame');
  return m;
}

/** The mount a new shading of this type gets on this window (blinds go on the terrace door's leaf). */
export function defaultShadingMount(archetype, windowInfo) {
  if (isDoorInfo(windowInfo) && LEAF_TYPES.has(archetype)) return 'frame';
  return DEFS[archetype]?.mount ?? 'recess';
}

/** Norwegian name of a mount on this window («På dørbladet» for the terrace door's leaf). */
export function shadingMountLabel(mount, archetype, windowInfo) {
  if (mount === 'frame' && isDoorInfo(windowInfo) && LEAF_TYPES.has(archetype)) return 'På dørbladet (følger døra)';
  return MOUNT_LABELS[mount] || mount;
}

/**
 * How a shading on the terrace door behaves when the door is opened (null for ordinary windows / no shading).
 * @param {object} windowInfo
 * @param {object|null} spec
 * @returns {string|null}
 */
export function shadingDoorNote(windowInfo, spec) {
  if (!isDoorInfo(windowInfo) || !spec || !DEFS[spec.archetype]) return null;
  const a = spec.archetype;
  if (a === 'curtain' || a === 'vertical') return 'Trekk den til side før du går ut – den henger fritt foran døra.';
  if (a === 'exterior-screen') return 'Døra går utover: screenen kjøres helt opp før døra åpnes, og ned igjen når den er lukket.';
  if (fitMount(windowInfo, spec) === 'frame' && LEAF_TYPES.has(a)) return 'Sitter på dørbladet og følger døra når den åpnes.';
  return 'Trekkes opp av seg selv når døra åpnes, og ned igjen når den lukkes.';
}

/** The mount computeFit will use for a spec on a window. */
function fitMount(info, spec) {
  const a = DEFS[spec.archetype] ? spec.archetype : 'roller';
  const mount = spec.mount;
  if (a === 'exterior-screen') return 'exterior';
  if (a === 'curtain') return mount === 'wall' || mount === 'ceiling' ? mount : spec.params?.track === 'wall' ? 'wall' : 'ceiling';
  return shadingMounts(a, info).includes(mount) ? mount : defaultShadingMount(a, info);
}

/**
 * The terrace door's leaf in the shading anchor's frame (closed door): the glazed area, the hinge side and the
 * matrix that hangs anchor-space geometry on the leaf's pivot. null when the window is not a door with a leaf.
 */
function leafFrame(info) {
  const door = info?.door;
  const leaf = door?.leaves?.[0];
  const anchor = info?.anchor;
  if (!leaf?.pivot || !anchor || !door.root) return null;
  const isUnder = (o) => {
    for (let p = o; p; p = p.parent) if (p === leaf.pivot) return true;
    return false;
  };
  const glass = (info.glass || []).find(isUnder);
  if (!glass?.geometry) return null;
  try {
    anchor.updateWorldMatrix(true, false);
    door.root.updateWorldMatrix(true, false);
    glass.updateWorldMatrix(true, false);
    // the pivot's closed pose (Door: angle = 0 at t = 0), independent of the door's current angle
    const closed = new THREE.Matrix4().makeTranslation(leaf.pivot.position.x, leaf.pivot.position.y, leaf.pivot.position.z);
    const pivotClosed = door.root.matrixWorld.clone().multiply(closed);
    const glassInPivot = leaf.pivot.matrixWorld.clone().invert().multiply(glass.matrixWorld);
    const anchorInv = anchor.matrixWorld.clone().invert();
    const toAnchor = anchorInv.clone().multiply(pivotClosed);
    glass.geometry.computeBoundingBox();
    const bb = glass.geometry.boundingBox.clone().applyMatrix4(toAnchor.clone().multiply(glassInPivot));
    const hinge = new THREE.Vector3().setFromMatrixPosition(toAnchor);
    if (!Number.isFinite(bb.min.x) || !Number.isFinite(hinge.x)) return null;
    return { door, pivot: leaf.pivot, rect: bb, hingeX: hinge.x, toPivot: pivotClosed.clone().invert().multiply(anchor.matrixWorld) };
  } catch {
    return null;
  }
}

/**
 * A complete ShadingSpec of an archetype without a product (sensible mount for the window).
 * @param {string} archetype
 * @param {object} [windowInfo]  home.windows[] entry (used to pick a mount that fits)
 * @returns {object} ShadingSpec
 */
export function defaultShadingSpec(archetype, windowInfo) {
  const d = DEFS[archetype] || DEFS.roller;
  const spec = {
    archetype: DEFS[archetype] ? archetype : 'roller',
    params: clone(d.defaults.params),
    colors: clone(d.defaults.colors),
    materials: clone(d.defaults.materials),
    open: d.defaults.open,
    tilt: d.defaults.tilt,
    mount: defaultShadingMount(DEFS[archetype] ? archetype : 'roller', windowInfo),
  };
  if (spec.archetype === 'curtain') {
    spec.params.track = 'ceiling';
    if (windowInfo && (windowInfo.sill ?? 0) > 0.55) spec.params.length = 'sill';
  }
  if (spec.archetype === 'vertical' && windowInfo && (windowInfo.sill ?? 0) > 0.55) spec.params.length = 'sill';
  return spec;
}

/** Fabric type of a spec (params.fabric, else from the archetype/material). */
function fabricType(spec) {
  const p = spec?.params || {};
  if (FABRICS[p.fabric]) return p.fabric;
  if (spec?.archetype === 'exterior-screen') return 'screen';
  const k = spec?.materials?.fabric;
  if (k === 'velvet' || k === 'velour') return 'velvet';
  if (k === 'wool') return 'wool';
  if (k === 'linen') return 'linen';
  return 'filter';
}

/** Transmission of the fabric/slats when they cover the window (catalogue value wins). */
function coveredT(spec) {
  const p = spec?.params || {};
  if (typeof p.transmission === 'number') return clamp01(p.transmission);
  if (spec?.archetype === 'venetian') return 0.05;
  return FABRICS[fabricType(spec)]?.T ?? 0.25;
}

/**
 * Share of daylight let in (0..1) by a shading spec (1 = no shading / fully open). Used for the LightManager's sky
 * and fill light; direct sun is shadowed by the geometry itself.
 * @param {object|null} spec ShadingSpec
 * @returns {number}
 */
export function shadingTransmission(spec) {
  if (!spec || !DEFS[spec.archetype]) return 1;
  const a = spec.archetype;
  const open = clamp01(num(spec.open, 1));
  const p = spec.params || {};
  let Tc = coveredT(spec);
  let cover;
  if (a === 'venetian' || a === 'vertical') {
    // diffuse daylight between slats (pitch ≈ 0.85 × slat width): ≈ 50 % horizontal, ≈ 15 % at 45°, closed ≈ Tc
    const t = Math.min(90, Math.abs(num(spec.tilt, 0))) * DEG;
    Tc = Tc + (1 - Tc) * (Math.max(0, 0.5 - 0.62 * Math.sin(t)) + 0.04 * Math.cos(t));
    cover = a === 'vertical' ? 0.06 + 0.94 * (1 - open) : 0.03 + 0.97 * (1 - open);
  } else if (a === 'curtain') {
    cover = (p.span === 'wall' ? 0.14 : 0.08) + (p.span === 'wall' ? 0.86 : 0.92) * (1 - open);
  } else if (a === 'pleated' && p.mode === 'topdown-bottomup') {
    cover = clamp01(1 - open - clamp01(num(p.top, 0))) * 0.97 + 0.03;
  } else {
    cover = 0.03 + 0.97 * (1 - open);
  }
  if (a === 'duo-roller') Tc *= lerp(1, 0.3, clamp01(num(p.band, 0)));
  return clamp01(1 - cover * (1 - Tc));
}

// ---------------------------------------------------------------------------------------------------------------
// Products (ready-made sizes vs made to measure)

/**
 * How a catalogue product is sized: made to measure (fits exactly) or ready-made (fixed widths/lengths).
 * @param {object|null} product
 * @returns {{ custom: boolean, cuttable: boolean, maxW: number, w: number, h: number, pair: boolean }|null}
 */
export function productSizing(product) {
  if (!product) return null;
  const note = `${product.priceNote || ''} ${product.description || ''}`;
  // made to measure: «Måltilpasset», or a configurator/estimate price quoted «for 220x180»
  const custom = /måltilpass/i.test(note) || /\bfor\s+(ca\.\s*)?\d{3}\s*[x×]\s*\d{3}/i.test(product.priceNote || '');
  const noCut = /(ikke|bør ikke)\s+(kappes|kuttes)/i.test(note);
  const cuttable = !noCut && /\bkan\s+(kappes|kuttes)/i.test(note);
  let maxW = product.dims?.w || 1;
  for (const m of note.matchAll(/(\d{2,3})\s*[x×]\s*\d{2,3}/g)) maxW = Math.max(maxW, Number(m[1]) / 100);
  for (const m of note.matchAll(/((?:\d{2,3}\s*\/\s*)+\d{2,3})\s*[x×]\s*\d{2,3}/g)) for (const w of m[1].split('/')) maxW = Math.max(maxW, Number(w) / 100);
  const br = note.match(/bredder?\s+(\d{2,3})\s*[–-]\s*(\d{2,3})\s*cm/i);
  if (br) maxW = Math.max(maxW, Number(br[2]) / 100);
  if (product.archetype === 'curtain') maxW = product.dims?.w || 1.4;
  const max = note.match(/maks\.?\s*(\d{2,3})\s*[x×]\s*(\d{2,3})\s*cm/i);
  return {
    custom,
    cuttable,
    maxW,
    w: product.dims?.w || 1,
    h: product.dims?.h || 2,
    pair: /\bpar\b/i.test(product.name || '') || /per par/i.test(product.priceNote || ''),
    maxSize: max ? [Number(max[1]) / 100, Number(max[2]) / 100] : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fitting: where the shading goes for a window and mount

const _v = new THREE.Vector3();

/**
 * Size and placement of a shading spec on a window (anchor coordinates, metres).
 * @param {object} info   home.windows[] entry (WindowInfo) – or a layout opening
 * @param {object} spec   ShadingSpec
 * @returns {object} fit
 */
function computeFit(info, spec) {
  // every window of the house (layout.house holds the living room's as the same objects): the ceiling over a
  // basement window needs its own wall (ceilAt below)
  const op = roomLayout.house?.opening?.(info.id) || roomLayout.opening?.(info.id) || null;
  const W = num(info.width, op?.width ?? 1.2);
  const H = num(info.height, op?.height ?? 1.2);
  const sill = num(info.sill, op?.sill ?? 0.9);
  const top = sill + H;
  const reveal = num(info.revealDepth, op?.revealDepth ?? 0.2);
  const fw = num(info.frameWidth, op?.frame?.width ?? 0.07);
  const wall = op ? roomLayout.house?.wall?.(op.wallId) ?? roomLayout.wall(op.wallId) : null;
  const thick = wall?.thickness ?? 0.3;
  const mount = fitMount(info, spec);

  // room-side face of the window frame (z < 0): the frame stands at the back of the reveal (shell convention); the
  // glass sits ~4 cm behind that face – measured when the shell exposes it
  let zFrame = -reveal;
  const glass = info.glass?.[0];
  const origin = op?.topCenter ?? (info.center ? _v.copy(info.center).setY(info.center.y + H / 2) : null);
  if (glass && origin && info.normal) {
    try {
      glass.updateWorldMatrix(true, false);
      const p = glass.getWorldPosition(new THREE.Vector3());
      const zg = p.sub(origin).dot(info.normal);
      if (Number.isFinite(zg) && zg < 0 && zg > -reveal - 0.15) zFrame = Math.min(-reveal + 0.08, zg + 0.04);
    } catch {
      /* keep the layout estimate */
    }
  }
  zFrame = clamp(zFrame, -reveal - 0.005, -0.02);
  const handles = (op?.sashes || []).some((s) => s.opening) || info.type === 'terrace-door';
  const zMin = zFrame + (handles ? 0.04 : 0.012);

  // limits along the wall: midpoints to the neighbouring openings and the wall ends (local x)
  let midL = -W / 2 - 0.6;
  let midR = W / 2 + 0.6;
  let endL = true;
  let endR = true;
  let uc = 0;
  if (op && wall) {
    uc = (op.u0 + op.u1) / 2;
    let lo = 0;
    let hi = wall.length;
    for (const o of wall.openings) {
      if (o.id === op.id) continue;
      if (o.u1 <= op.u0 + 1e-3) lo = Math.max(lo, o.u1);
      if (o.u0 >= op.u1 - 1e-3) hi = Math.min(hi, o.u0);
    }
    endL = lo === 0;
    endR = hi === wall.length;
    midL = (endL ? 0.025 : (lo + op.u0) / 2) - uc;
    midR = (endR ? wall.length - 0.025 : (hi + op.u1) / 2) - uc;
  }
  const ceilAt = (x, z = 0.1) => {
    if (!wall || !roomLayout.ceilingHeightAt) return 0.3;
    const p = wall.pointAt(uc + x, 0, new THREE.Vector3());
    p.addScaledVector(wall.normal3, z);
    // the ceiling of the window's own room (world y, §1.8: a point a metre over the wall's floor picks the level);
    // top is over the wall's floor
    const fy = Number.isFinite(wall.floorY) ? wall.floorY : 0;
    const c = roomLayout.ceilingHeightAt(p.x, p.z, fy + 1);
    return Number.isFinite(c) ? c - fy - top : 0.3;
  };
  const extent = (e) => [Math.max(-W / 2 - e, midL + 0.006), Math.min(W / 2 + e, midR - 0.006)];

  const fit = { id: info.id, W, H, sill, top, reveal, fw, zFrame, zMin, thick, mount, midL, midR, endL, endR, floorY: -top, sillY: -H, handles, ceilAt, opSide: 1 };
  const leaf = mount === 'frame' && isDoorInfo(info) && LEAF_TYPES.has(spec.archetype) ? leafFrame(info) : null;
  if (leaf) {
    // on the door leaf, over the glazing and its beads; cords / wand / chain on the hinge side (the lever handle
    // reaches into the glass area on the other side), everything within 6 cm of the leaf (the lever is 4.6 cm out)
    const r = leaf.rect;
    const bead = 0.018;
    const zGlass = (r.min.z + r.max.z) / 2;
    Object.assign(fit, {
      x0: r.min.x - bead, x1: r.max.x + bead, yTop: r.max.y + bead + 0.004, yBottom: r.min.y - bead,
      zBack: zGlass + 0.025 + 0.006, zFront: zGlass + 0.025 + 0.066, leaf, opSide: leaf.hingeX >= 0 ? 1 : -1,
    });
  } else if (mount === 'recess') {
    Object.assign(fit, { x0: -W / 2 + 0.006, x1: W / 2 - 0.006, yTop: -0.002, yBottom: -H + 0.006, zBack: zMin, zFront: -0.004 });
  } else if (mount === 'frame') {
    Object.assign(fit, { x0: -W / 2 + fw - 0.012, x1: W / 2 - fw + 0.012, yTop: -fw + 0.012, yBottom: -H + fw - 0.012, zBack: zFrame + 0.004, zFront: zFrame + 0.07 });
  } else if (mount === 'wall') {
    const [x0, x1] = extent(0.08);
    const cy = Math.min(ceilAt(x0), ceilAt(x1), ceilAt(0));
    Object.assign(fit, { x0, x1, yTop: Math.min(0.11, cy - 0.025), yBottom: -H - 0.05, zBack: 0.004, zFront: 0.12, ceilY: cy });
  } else if (mount === 'ceiling') {
    const [x0, x1] = extent(0.1);
    const cy = Math.min(ceilAt(x0), ceilAt(x1), ceilAt(0));
    Object.assign(fit, { x0, x1, yTop: cy - 0.003, yBottom: -H - 0.05, zBack: 0.05, zFront: 0.16, ceilY: cy });
  } else {
    // exterior: on the facade (z = −thickness) above and beside the opening
    Object.assign(fit, { x0: -W / 2 - 0.045, x1: W / 2 + 0.045, yTop: 0.12, yBottom: -H - 0.01, zBack: -thick - 0.11, zFront: -thick });
  }
  fit.width = fit.x1 - fit.x0;
  fit.drop = fit.yTop - fit.yBottom;
  return fit;
}

/**
 * The computed size of a shading spec on a window – for the panel's price estimate.
 * @param {object} info  WindowInfo (home.windows[] entry)
 * @param {object} spec  ShadingSpec
 * @returns {{ mount: string, width: number, drop: number, area: number, track?: number, fabricWidth?: number,
 *   pieces: number, pieceWidth?: number, maxDrop?: number, short?: number, panels?: number, fullness?: number }}
 */
export function shadingSize(info, spec) {
  if (!info || !spec || !DEFS[spec.archetype]) return null;
  spec = completeSpec(spec);
  const fit = computeFit(info, spec);
  if (spec.archetype === 'curtain') {
    const c = curtainLayout(fit, spec);
    return {
      mount: fit.mount,
      width: c.X1 - c.X0,
      track: c.X1 - c.X0,
      drop: c.yTop - c.yBot,
      needDrop: c.needDrop,
      area: (c.X1 - c.X0) * (c.yTop - c.yBot),
      fabricWidth: c.fabricTotal,
      pieces: c.pieces,
      pieceWidth: c.pieceW,
      fullness: c.fullness,
      panels: c.panels.length,
      short: c.short,
    };
  }
  const p = blindPieces(fit, spec);
  return { mount: fit.mount, width: fit.width, drop: fit.drop, area: fit.width * fit.drop, pieces: p.n, pieceWidth: p.w, maxDrop: p.maxDrop, short: p.short };
}

/** Ready-made blinds: how many side by side, and the longest drop the product allows. */
function blindPieces(fit, spec) {
  const product = spec.productId ? getProduct(spec.productId) : null;
  const sz = productSizing(product);
  let n = Math.max(1, Math.round(num(spec.params?.pieces, 0)));
  let maxDrop = Infinity;
  if (sz && !sz.custom && spec.archetype !== 'exterior-screen') {
    if (!spec.params?.pieces) n = Math.max(1, Math.ceil((fit.width - 0.01) / sz.maxW));
    maxDrop = sz.h;
  } else if (sz?.maxSize && !spec.params?.pieces) {
    n = Math.max(1, Math.ceil((fit.width - 0.01) / sz.maxSize[0]));
  }
  if (!sz && !spec.params?.pieces) n = 1;
  const need = fit.drop;
  return { n, w: fit.width / n, maxDrop, short: Number.isFinite(maxDrop) && maxDrop < need - 0.01 ? need - maxDrop : 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Materials: translucent fabric (patched standard lighting) and the dithered shadow material

/**
 * Radiance of the daylit window behind translucent fabrics – the UNSHADED sky luminance of the glass in render
 * units (the LightManager's window luminance × scene scale, linear RGB). Without a call the shading finds the
 * window's sky RectAreaLight itself (intensity ÷ the shading's transmission) or falls back to the scene's
 * HemisphereLight / sun.
 * @param {THREE.Color|string|number|null} c   null = back to automatic
 * @param {string} [windowId]                   one window (default: every window)
 */
export function setShadingDaylight(c, windowId = '*') {
  if (c == null) {
    SKY_MANUAL.delete(windowId);
    if (windowId === '*') SKY_MANUAL.clear();
    return;
  }
  const col = typeof c === 'number' ? new THREE.Color(c, c, c) : new THREE.Color(c);
  SKY_MANUAL.set(windowId, col);
  for (const rig of LIVE) applyManualSky(rig);
}

function applyManualSky(rig) {
  const c = SKY_MANUAL.get(rig.info.id) || SKY_MANUAL.get('*');
  if (!c) return false;
  rig.sky.value.copy(c);
  rig.skyKnown = true;
  return true;
}

/** Optional hooks set by the integrator (e.g. `shadingHooks.requestShadowUpdate = () => lighting.requestShadowUpdate()`). */
export const shadingHooks = { requestShadowUpdate: null };

const FABRIC_VERT_HEAD = /* glsl */ `#include <common>
uniform vec3 uShadeOut;
varying vec2 vShadeXY;
varying vec2 vShadeUV;`;
const FABRIC_VERT_BODY = /* glsl */ `#include <project_vertex>
{
  vec4 shadeP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    shadeP = instanceMatrix * shadeP;
  #endif
  vShadeXY = shadeP.xy;
  vShadeUV = uv;
}`;
const SHADOW_VERT = THREE.ShaderChunk.shadowmap_vertex.replace('shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias', 'uShadeOut');
const FABRIC_FRAG_HEAD = /* glsl */ `#include <common>
uniform float uGlow;
uniform vec3 uSkyBack;
uniform vec4 uGlassRect;
uniform vec4 uCheck;
varying vec2 vShadeXY;
varying vec2 vShadeUV;
float shadeMask() {
  vec2 lo = smoothstep( uGlassRect.xy - 0.02, uGlassRect.xy + 0.03, vShadeXY );
  vec2 hi = 1.0 - smoothstep( uGlassRect.zw - 0.03, uGlassRect.zw + 0.02, vShadeXY );
  return lo.x * lo.y * hi.x * hi.y;
}
float shadeBand( float p, float size, float w ) {
  float f = fract( p / size );
  float d = min( f, 1.0 - f ) * size;
  float aa = fwidth( p ) * 0.8 + 1e-4;
  return 1.0 - smoothstep( w * 0.5 - aa, w * 0.5 + aa, d );
}
float shadeCheck( vec2 p ) {
  float bx = shadeBand( p.x, uCheck.y, uCheck.z );
  float by = shadeBand( p.y, uCheck.y, uCheck.z );
  float tx = shadeBand( p.x + uCheck.y * 0.5, uCheck.y, uCheck.z * 0.25 );
  float ty = shadeBand( p.y + uCheck.y * 0.5, uCheck.y, uCheck.z * 0.25 );
  float k = max( bx, by ) * 0.65 + bx * by * 0.35 + max( tx, ty ) * 0.35;
  return 1.0 - uCheck.x * k;
}`;
const FABRIC_FRAG_LIGHT = /* glsl */ `#include <lights_physical_pars_fragment>
void RE_Direct_Shade( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( - dot( geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += back * directLight.color * material.diffuseColor * ( uGlow * RECIPROCAL_PI );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Shade`;

/**
 * Fabric material: a clone of the cached mat() material (never mutate those) with a translucency term and the
 * optional check pattern. Owned by the rig (disposed with it).
 */
function fabricMaterial(rig, kind, hex, { view = 0, glow = 0, check = 0, rect, grain } = {}) {
  const base = mat(kind, hex, grain ? { side: 'double', grain } : { side: 'double' });
  const m = base.clone();
  m.name = `shading ${kind} ${hex}`;
  m.userData = { cached: false, kind, hex, shading: true };
  if (view > 0.01) {
    m.transparent = true;
    m.opacity = 1 - view;
    m.depthWrite = false;
  }
  const u = {
    uGlow: { value: glow },
    uSkyBack: rig.sky,
    uShadeOut: rig.out,
    uGlassRect: { value: rect ? rect.clone() : new THREE.Vector4(-10, -10, 10, 10) },
    uCheck: { value: new THREE.Vector4(check, 0.17, 0.034, 0) },
  };
  m.userData.shadeUniforms = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', FABRIC_VERT_HEAD)
      .replace('#include <project_vertex>', FABRIC_VERT_BODY)
      // the sun's shadow is looked up a little outside the fabric (toward the window), so the fabric's own dithered
      // shadow does not darken its translucency – walls, reveals and frames still shade it
      .replace('#include <shadowmap_vertex>', SHADOW_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FABRIC_FRAG_HEAD)
      .replace('#include <map_fragment>', '#include <map_fragment>\n  if ( uCheck.x > 0.0 ) diffuseColor.rgb *= shadeCheck( vShadeUV );')
      .replace('#include <lights_physical_pars_fragment>', FABRIC_FRAG_LIGHT)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uSkyBack * diffuseColor.rgb * ( uGlow * shadeMask() );');
  };
  m.customProgramCacheKey = () => 'shading-fabric-v1';
  return rig.own(m);
}

const DITHER_HEAD = /* glsl */ `#include <common>
uniform float uDensity;
float shadeBayer( vec2 p ) {
  ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
  int i = q.x + q.y * 4;
  const float B[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( B[i] + 0.5 ) / 16.0;
}`;

/** Shadow material for a translucent fabric: an ordered-dither cut-out with coverage = density (× alpha map). */
function ditherDepth(rig, density) {
  const m = new THREE.MeshDepthMaterial();
  const u = { value: density };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDensity = u;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', DITHER_HEAD)
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  if ( shadeBayer( gl_FragCoord.xy ) >= uDensity * diffuseColor.a ) discard;');
  };
  m.customProgramCacheKey = () => 'shading-dither-v1';
  m.userData.density = u;
  return rig.own(m);
}

/** Shadow casting for a fabric mesh with light transmission T (0 = opaque). */
function castFabric(rig, mesh, T, { force = false } = {}) {
  const d = 1 - clamp01(T);
  mesh.receiveShadow = true;
  if (d <= 0.03 && !force) {
    mesh.castShadow = false;
    return;
  }
  mesh.castShadow = true;
  if (d < 0.985 || force) mesh.customDepthMaterial = ditherDepth(rig, d);
}

/**
 * Depth pre-pass for a see-through fabric whose folds overlap each other (curtains, pleats, roman folds): it writes
 * the fabric's depth first, so only the front-most layer blends over what is behind. Without it the folds of one
 * mesh blend in index order – back folds over front ones – and the fabric reads as stacked translucent plates;
 * the window glass behind (drawn later) also stops painting its reflection on top of the fabric.
 */
function depthPrepass(rig, mesh) {
  if (!mesh.material?.transparent) return null;
  const m = rig.own(new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  }));
  m.name = 'shading fabric depth';
  const pre = new THREE.Mesh(mesh.geometry, m);
  pre.name = 'shading-depth';
  pre.renderOrder = (mesh.renderOrder ?? 0) - 1;
  pre.castShadow = false;
  pre.receiveShadow = false;
  pre.userData.noHighlight = true;
  pre.userData.noCollide = true;
  pre.raycast = () => {}; // the fabric itself is the pick target
  rig.group.add(pre);
  return pre;
}

/** Solid (rails, slats): cached mat(). */
function solid(kind, hex, opts) {
  return mat(kind || 'painted', hex || '#e6e6e3', opts);
}

/** Glow factor for a fabric: the diffusely transmitted share, compensated for the see-through alpha blend. */
function glowOf(T, view) {
  const diffuse = Math.max(0, T - view * 0.9);
  return clamp(diffuse / Math.max(0.25, 1 - view), 0, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Rig: one built shading (group + pose function + owned resources + animation state)

const ANIM_KEYS = ['open', 'tilt', 'band', 'top'];
const SPEED = { open: 0.7, tilt: 120, band: 1.6, top: 0.7 };
const ACTIVE = new Set();
/** Every built shading (for the daylight lookup). */
const LIVE = new Set();
/** Manual daylight per window id (setShadingDaylight(c, windowId)). */
const SKY_MANUAL = new Map();

class Rig {
  constructor(info, spec, fit, quality) {
    this.info = info;
    this.spec = spec;
    this.fit = fit;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = `shading:${info.id}`;
    this.group.userData.pick = { kind: 'window', windowId: info.id };
    this.group.userData.noCollide = true;
    this.resources = [];
    this.pose = () => {};
    this.state = {};
    this.target = {};
    this.time = 0;
    this.driver = null;
    // daylight radiance behind this window (fabric glow) and the outward shadow-lookup offset (world)
    this.sky = { value: new THREE.Color(0, 0, 0) };
    this.skyKnown = false;
    this.out = { value: info.normal ? new THREE.Vector3().copy(info.normal).multiplyScalar(-0.03) : new THREE.Vector3() };
    this.glassWorld = null;
    this.seen = performance.now();
    // terrace door: held up while the door is open (doorUp), speed factor of the current animation
    this.wanted = null;
    this.doorUp = false;
    this.fast = 1;
    this.unbind = null;
    this.pendingDoor = null;
    LIVE.add(this);
  }

  /** New animation target from the spec (a terrace door that is open keeps the blind raised). */
  setTarget(target) {
    this.wanted = target;
    this.target = this.doorUp ? { ...target, open: 1, top: 0 } : { ...target };
    this.time = performance.now();
    ACTIVE.add(this);
  }

  /** World position of the middle of the glass (for finding the window's sky light). */
  glassPoint() {
    if (this.glassWorld) return this.glassWorld;
    const op = roomLayout.opening?.(this.info.id);
    const c = op?.center ?? this.info.center;
    const n = this.info.normal;
    if (!c || !n) return null;
    this.glassWorld = new THREE.Vector3().copy(c).addScaledVector(n, this.fit.zFrame - 0.035);
    return this.glassWorld;
  }

  own(x) {
    if (x) this.resources.push(x);
    return x;
  }

  geo(g) {
    return this.own(g);
  }

  add(mesh, part) {
    if (part) mesh.userData.part = part;
    this.group.add(mesh);
    return mesh;
  }

  /** Moves the animated values toward the target. @returns {boolean} still moving */
  step(dt) {
    let moving = false;
    for (const k of ANIM_KEYS) {
      const t = this.target[k];
      const c = this.state[k];
      if (t == null || c == null) continue;
      const d = t - c;
      if (Math.abs(d) < (k === 'tilt' ? 0.05 : 0.0006)) {
        this.state[k] = t;
        continue;
      }
      const sp = SPEED[k] * this.fast * dt;
      this.state[k] = c + clamp(d * (1 - Math.exp(-dt * 7 * this.fast)), -sp, sp);
      moving = true;
    }
    this.pose(this.state);
    // an exterior screen holding the terrace door: open the door once the screen is up
    if (this.pendingDoor && (this.state.open ?? 0) >= 0.985) {
      const go = this.pendingDoor;
      this.pendingDoor = null;
      go();
    }
    if (!moving) this.fast = 1;
    return moving;
  }

  dispose() {
    ACTIVE.delete(this);
    LIVE.delete(this);
    try {
      this.unbind?.();
    } catch {
      /* the door may be gone already */
    }
    this.unbind = null;
    this.pendingDoor = null;
    for (const r of this.resources) r.dispose?.();
    this.resources = [];
  }
}

/**
 * Terrace door: a blind that is not on the leaf goes up by itself while the door is open (and back down when it is
 * closed); an exterior screen holds the outward-opening door until it is up. Curtains and vertical blinds hang
 * freely in front of the door and are left alone.
 */
function bindDoor(rig) {
  const door = rig.info?.door;
  const a = rig.spec.archetype;
  if (!door || !isDoorInfo(rig.info) || rig.fit.leaf || a === 'curtain' || a === 'vertical' || typeof door.onChange !== 'function') return;
  const update = (up, fast) => {
    if (rig.doorUp === up) return;
    rig.doorUp = up;
    rig.fast = fast;
    rig.setTarget(rig.wanted || rig.target);
  };
  const off = door.onChange((d, state) => {
    if (state === 'opening' || state === 'open') update(true, a === 'exterior-screen' ? 3 : 1.8);
    else if (state === 'closed') update(false, 1);
  });
  let restore = null;
  if (a === 'exterior-screen' && typeof door.open === 'function' && !Object.prototype.hasOwnProperty.call(door, 'open')) {
    // the leaf swings out through the screen: run the screen up first, then open (motor screens with a door switch)
    const open = door.open;
    const held = function heldOpen() {
      if (this.locked || this.isOpen || ((rig.state.open ?? 0) >= 0.985 && !rig.pendingDoor)) return open.call(this);
      if (rig.pendingDoor) return undefined;
      rig.pendingDoor = () => {
        if (!this.isOpen) open.call(this);
      };
      update(true, 3);
      return undefined;
    };
    door.open = held;
    restore = () => {
      if (door.open === held) delete door.open;
    };
  }
  rig.unbind = () => {
    off?.();
    restore?.();
  };
  if (door.isOpen || door.t > 0) {
    rig.doorUp = true;
    rig.target = { ...rig.target, open: 1, top: 0 };
    rig.state = { ...rig.state, open: 1, top: 0 };
  }
}

/**
 * Releases every shading built in these windows (or all): removes the models, frees their GPU resources and
 * forgets the module state (renderer, daylight hints, door bindings) – call it when the home is disposed, so a
 * session that ended is not kept alive by this module.
 * @param {object[]} [windows]  home.windows (default: every shading this module knows)
 */
export function releaseShading(windows) {
  const anchors = windows ? new Set(windows.map((w) => w?.anchor).filter(Boolean)) : null;
  for (const rig of [...LIVE]) {
    if (anchors && !anchors.has(rig.anchor)) continue;
    if (rig.anchor && rig.anchor.userData.shadingRig === rig) removeRig(rig.anchor, rig);
    else {
      rig.group.removeFromParent();
      rig.dispose();
    }
  }
  if (!LIVE.size) {
    ACTIVE.clear();
    _renderer = null;
    _lastFrame = -1;
    SKY_HINT = null;
    SKY_MANUAL.clear();
  }
}

let _lastFrame = -1;
let _lastSkyCheck = 0;
const _lightCache = new WeakMap();
const _wp = new THREE.Vector3();

/** Advances every animating shading to now. */
function tick(renderer, scene) {
  const now = performance.now();
  if (scene && LIVE.size && now - _lastSkyCheck > 250) {
    _lastSkyCheck = now;
    autoSky(scene, now);
  }
  if (renderer) _renderer = renderer;
  if (!ACTIVE.size) return;
  let moved = false;
  let finished = false;
  for (const rig of [...ACTIVE]) {
    const dt = Math.min(0.25, Math.max(0, (now - rig.time) / 1000));
    if (dt <= 0) {
      moved = true;
      continue;
    }
    rig.time = now;
    if (rig.step(dt)) moved = true;
    else {
      ACTIVE.delete(rig);
      finished = true;
    }
  }
  // while moving: refresh the shadow maps at ~30 Hz; when done: one full update (the LightManager also refreshes
  // its bounce light then – not every frame)
  if (moved && (++_shadowFrame & 1) === 0 && _renderer?.shadowMap) _renderer.shadowMap.needsUpdate = true;
  if (finished && !ACTIVE.size) {
    if (_renderer?.shadowMap) _renderer.shadowMap.needsUpdate = true;
    try {
      shadingHooks.requestShadowUpdate?.();
    } catch {
      /* optional hook */
    }
  }
}
let _renderer = null;
let _shadowFrame = 0;

/**
 * Daylight behind each shaded window: the window's sky RectAreaLight (the LightManager puts one at the glass; its
 * intensity is the sky luminance × the shading's transmission, so divide that out), else the last value seen, else
 * an estimate from a HemisphereLight or the sun.
 */
function autoSky(scene, now) {
  let cache = _lightCache.get(scene);
  if (!cache || now - cache.time > 2000) {
    cache = { time: now, rects: [], hemis: [], suns: [] };
    scene.traverse((o) => {
      if (o.isRectAreaLight) cache.rects.push(o);
      else if (o.isHemisphereLight) cache.hemis.push(o);
      else if (o.isDirectionalLight) cache.suns.push(o);
    });
    _lightCache.set(scene, cache);
  }
  for (const rig of [...LIVE]) {
    // a home that was disposed (back to the start screen) leaves its rigs behind: forget them after a while
    let root = rig.group;
    while (root.parent) root = root.parent;
    if (root !== scene) {
      if ((root.isScene || now - (rig.seen ?? now) > 60000)) {
        LIVE.delete(rig);
        ACTIVE.delete(rig);
      }
      continue;
    }
    rig.seen = now;
    if (applyManualSky(rig)) continue;
    const p = rig.glassPoint();
    if (!p) continue;
    let best = null;
    let bd = 0.45;
    for (const l of cache.rects) {
      if (!l.visible || !(l.intensity > 0) || !l.parent) continue;
      const d = l.getWorldPosition(_wp).distanceTo(p);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (best) {
      const t = Math.max(0.04, shadingTransmission(rig.spec));
      rig.sky.value.copy(best.color).multiplyScalar(Math.min(best.intensity / t, best.intensity * 25));
      rig.skyKnown = true;
    } else if (SKY_HINT) {
      rig.sky.value.copy(SKY_HINT);
    } else {
      const c = rig.sky.value.setScalar(0);
      const addC = (col, k) => {
        c.r += col.r * k;
        c.g += col.g * k;
        c.b += col.b * k;
      };
      for (const l of cache.hemis) if (l.visible) addC(l.color, l.intensity * 0.55);
      if (!cache.hemis.length) for (const l of cache.suns) if (l.visible) addC(l.color, l.intensity * 0.04);
    }
  }
}

let SKY_HINT = null;

/**
 * Fallback daylight for windows whose sky light is not active right now (render units, linear RGB): the WindowPanel
 * feeds it from the LightManager's outdoor illuminance × scene scale. null = no hint.
 * @param {THREE.Color|number|null} c
 */
export function setShadingDaylightHint(c) {
  if (c == null) SKY_HINT = null;
  else (SKY_HINT ||= new THREE.Color()).copy(typeof c === 'number' ? new THREE.Color(c, c, c) : c);
}

/**
 * Optional per-frame driver (animations also advance from the renderer on their own).
 * @param {number} [dt]
 */
export function updateShading(dt) { // eslint-disable-line no-unused-vars
  tick(null, null);
}

function driverMesh(rig, mesh) {
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (renderer, scene) => {
    const f = renderer.info?.render?.frame;
    if (f === _lastFrame) return;
    _lastFrame = f;
    tick(renderer, scene);
  };
  rig.driver = mesh;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers

/** Box geometry translated to a centre (fabric meshes stay at the identity transform). */
function boxAt(rig, w, h, d, x, y, z, { r = 0, grain } = {}) {
  const g = r > 0 ? roundedBox(w, h, d, r, 2, { grain }) : box(w, h, d, { grain });
  g.translate(x, y, z);
  return rig.geo(g);
}

/** Cylinder along x (rod/tube) centred at (x, y, z). */
function rodX(rig, r, len, x, y, z, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  g.rotateZ(Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r, uv.getY(i) * len);
  g.translate(x, y, z);
  return rig.geo(g);
}

/** Dynamic grid geometry (rows × cols vertices, indexed). */
function gridGeometry(rig, rows, cols) {
  const g = new THREE.BufferGeometry();
  const n = rows * cols;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.userData.rows = rows;
  g.userData.cols = cols;
  return rig.geo(g);
}

function finishDynamic(g) {
  g.attributes.position.needsUpdate = true;
  g.attributes.uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
}

/** A flat quad (2 × 2 grid) at z, x0..x1, yTop..yBot; v measured in metres from vTop. */
function setQuad(g, x0, x1, yTop, yBot, z, vTop = 0, z2 = z) {
  const p = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  const pts = [[x0, yTop, z], [x1, yTop, z], [x0, yBot, z2], [x1, yBot, z2]];
  for (let i = 0; i < 4; i++) {
    p.set(pts[i], i * 3);
    uv[i * 2] = pts[i][0];
    uv[i * 2 + 1] = -(vTop + (i < 2 ? 0 : yTop - yBot));
  }
  finishDynamic(g);
}

/** Glass rectangle in anchor coordinates (x0, y0, x1, y1) – where a fabric has daylight behind it. */
function glassRect(fit) {
  return new THREE.Vector4(-fit.W / 2 + fit.fw, -fit.H + fit.fw, fit.W / 2 - fit.fw, -fit.fw);
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _sc = new THREE.Vector3(1, 1, 1);
const _p3 = new THREE.Vector3();
const _e = new THREE.Euler();
const X_AXIS = new THREE.Vector3(1, 0, 0);

// ---------------------------------------------------------------------------------------------------------------
// Venetian blind (persienne)

const SLAT = {
  16: { pitch: 0.0135, head: [0.018, 0.02], stack: 0.0008 },
  25: { pitch: 0.0212, head: [0.025, 0.026], stack: 0.0009 },
  35: { pitch: 0.03, head: [0.035, 0.04], stack: 0.0016 },
  50: { pitch: 0.0425, head: [0.05, 0.058], stack: 0.0055 },
};

function buildVenetian(rig) {
  const { fit, spec, quality } = rig;
  const p = spec.params || {};
  const C = spec.colors || {};
  const M = spec.materials || {};
  let mm = [16, 25, 35, 50].includes(Number(p.slatMm)) ? Number(p.slatMm) : 25;
  // on a door leaf there are only 6 cm to the lever handle: door blinds come with 16/25 mm slats
  if (fit.leaf && mm > 25) mm = 25;
  const S = SLAT[mm];
  const woodLike = !fit.leaf && (p.material === 'wood' || p.material === 'bamboo' || ['ash', 'oak', 'walnut', 'teak', 'white-oak', 'smoked-oak', 'black-oak'].includes(M.slat));
  const ws = mm / 1000;
  const thick = woodLike ? (mm >= 50 ? 0.0028 : 0.0022) : 0.0004;
  const pitch = woodLike ? Math.max(S.pitch, ws * 0.86) : S.pitch;
  const stackP = woodLike ? Math.max(S.stack, 0.005) : S.stack;
  const [headH, headD] = woodLike ? [Math.max(0.045, S.head[0]), Math.max(0.055, ws + 0.006)] : S.head;
  const slatKind = M.slat || (woodLike ? 'ash' : 'painted');
  const slatHex = C.slat || C.fabric || '#f1efe9';
  const railKind = M.rail || slatKind;
  const railHex = C.rail || slatHex;
  const slatMat = solid(slatKind, slatHex, woodLike ? { grain: 'x' } : { side: 'double', roughness: 0.42 });
  const railMat = solid(railKind, railHex, woodLike ? { grain: 'x' } : { roughness: 0.42 });
  const cordHex = new THREE.Color(slatHex).lerp(new THREE.Color('#ffffff'), 0.15).getStyle();
  const cordMat = solid('woven', `#${new THREE.Color(cordHex).getHexString()}`, { flat: true });

  const pieces = blindPieces(fit, spec);
  const gap = pieces.n > 1 ? 0.012 : 0;
  const zc = clamp(fit.zBack + headD / 2 + 0.003, fit.zBack, Math.max(fit.zBack, fit.zFront - headD / 2));
  const maxDrop = Math.min(fit.drop, pieces.maxDrop);
  const yHead = fit.yTop - headH; // underside of the head rail
  const railH = woodLike ? 0.012 : 0.009;
  const N = Math.max(2, Math.floor((maxDrop - headH - railH - 0.004) / pitch));
  const yRailDown = yHead - N * pitch - railH / 2;
  const yRailUp = yHead - N * stackP - railH / 2 - 0.002;

  // slat geometry: crowned aluminium sheet (double-sided) or a flat wood slat
  const segX = 1;
  const makeSlat = (len) => {
    if (woodLike) {
      const g = roundedBox(len, thick, ws, thick * 0.45, 1, { grain: 'x' });
      return rig.geo(g);
    }
    const segZ = quality === 'low' ? 2 : 4;
    const g = new THREE.PlaneGeometry(len, ws, segX, segZ);
    g.rotateX(-Math.PI / 2); // plane in x/z, normal +y
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const crown = ws * 0.07;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      pos.setY(i, crown * (1 - (2 * z / ws) ** 2));
      uv.setXY(i, pos.getX(i), z);
    }
    g.computeVertexNormals();
    return rig.geo(g);
  };

  const pieceRigs = [];
  for (let k = 0; k < pieces.n; k++) {
    const px0 = fit.x0 + k * pieces.w + (k > 0 ? gap / 2 : 0);
    const px1 = fit.x0 + (k + 1) * pieces.w - (k < pieces.n - 1 ? gap / 2 : 0);
    const len = px1 - px0;
    const cx = (px0 + px1) / 2;
    // head rail (+ valance for wood)
    const head = new THREE.Mesh(boxAt(rig, len, headH, headD, cx, fit.yTop - headH / 2, zc, { r: woodLike ? 0.002 : 0.004 }), railMat);
    head.castShadow = head.receiveShadow = true;
    rig.add(head, 'rail');
    if (k === 0) driverMesh(rig, head);
    if (woodLike) {
      const val = new THREE.Mesh(boxAt(rig, len + 0.01, headH + 0.008, 0.008, cx, fit.yTop - headH / 2 - 0.002, zc + headD / 2 + 0.004, { r: 0.002, grain: 'x' }), railMat);
      val.castShadow = val.receiveShadow = true;
      rig.add(val, 'rail');
    }
    const slatLen = len - 0.006;
    const slats = new THREE.InstancedMesh(makeSlat(slatLen), slatMat, N);
    slats.castShadow = slats.receiveShadow = true;
    slats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rig.add(slats, 'slat');
    const rail = new THREE.Mesh(boxAt(rig, slatLen, railH, ws * 0.92, 0, 0, 0, { r: Math.min(0.004, railH / 2.2), grain: 'x' }), railMat);
    rail.castShadow = rail.receiveShadow = true;
    rig.add(rail, 'rail');
    // ladders (front + back cords or tapes)
    const L = Math.max(2, Math.round(len / 0.55) + 1);
    const tape = !!p.ladderTape;
    const cordGeo = rig.geo(new THREE.BoxGeometry(tape ? 0.038 : 0.0012, 1, tape ? 0.0005 : 0.0012));
    const cords = new THREE.InstancedMesh(cordGeo, tape ? railMat : cordMat, L * 2);
    cords.castShadow = true;
    cords.receiveShadow = false;
    cords.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rig.add(cords, 'rail');
    const ladderX = [];
    for (let i = 0; i < L; i++) ladderX.push(cx - len / 2 + 0.09 + (i * (len - 0.18)) / (L - 1));
    // tilt wand on the operating side (right; the hinge side on a door leaf) of the outermost piece
    let wand = null;
    if (k === (fit.opSide < 0 ? 0 : pieces.n - 1)) {
      const wl = Math.min(1.1, 0.55 * maxDrop);
      const wx = fit.opSide < 0 ? px0 + 0.035 : px1 - 0.035;
      wand = new THREE.Mesh(boxAt(rig, 0.006, wl, 0.006, wx, yHead - wl / 2, zc + headD / 2 + 0.006, { r: 0.0025 }), solid('plastic', '#e9eef0', { roughness: 0.25, opacity: 0.75 }));
      wand.castShadow = false;
      rig.add(wand, 'rail');
    }
    pieceRigs.push({ slats, rail, cords, ladderX, cx });
  }

  rig.pose = ({ open = 0, tilt = 0 }) => {
    const o = clamp01(open);
    const yRail = lerp(yRailDown, yRailUp, o);
    const phi = clamp(tilt, -88, 88) * DEG;
    for (const pr of pieceRigs) {
      for (let i = 0; i < N; i++) {
        const hang = yHead - pitch * (i + 0.5);
        const stack = yRail + railH / 2 + stackP * (N - 1 - i + 0.5);
        const y = Math.max(hang, stack);
        const f = clamp((hang - stack) / (pitch * 0.5), 0, 1);
        _e.set(phi * f, 0, 0);
        _q.setFromEuler(_e);
        _m4.compose(_p3.set(pr.cx, y, zc), _q, _s);
        pr.slats.setMatrixAt(i, _m4);
      }
      pr.slats.instanceMatrix.needsUpdate = true;
      pr.slats.computeBoundingSphere();
      pr.rail.position.set(pr.cx, yRail, zc);
      pr.rail.rotation.x = phi * 0.35;
      const len = Math.max(0.002, yHead - yRail);
      const dz = (ws / 2) * Math.cos(phi) + 0.0008;
      pr.ladderX.forEach((x, i) => {
        for (let s = 0; s < 2; s++) {
          _m4.compose(_p3.set(x, yHead - len / 2, zc + (s ? dz : -dz)), _q.identity(), _sc.set(1, len, 1));
          pr.cords.setMatrixAt(i * 2 + s, _m4);
        }
      });
      pr.cords.instanceMatrix.needsUpdate = true;
      pr.cords.computeBoundingSphere();
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Roller blind (rullegardin) and duo roller

let _stripeTex = null;
/** Stripe alpha map for duo rollers (v: 0..0.5 opaque band, 0.5..1 sheer band). */
function stripeTexture() {
  if (_stripeTex) return _stripeTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 64; y++) {
    const v = y < 32 ? 255 : 70;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, 4, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.channel = 1;
  _stripeTex = t;
  return t;
}

function buildRoller(rig, duo = false) {
  const { fit, spec, quality } = rig;
  const p = spec.params || {};
  const C = spec.colors || {};
  const M = spec.materials || {};
  const ftype = duo ? 'filter' : fabricType(spec);
  const F = FABRICS[ftype] || FABRICS.filter;
  const T = coveredT(spec);
  const view = duo ? 0 : F.view;
  const kind = M.fabric || F.kind;
  const hex = C.fabric || C.slat || '#d8d4cc';
  const railKind = M.rail || 'painted';
  const railHex = C.rail || '#e6e6e3';
  const railMat = solid(railKind, railHex, { roughness: 0.4 });
  const cassette = !!p.cassette;
  const pieces = blindPieces(fit, spec);
  const r0 = fit.width > 1.6 ? 0.019 : 0.0145;
  const tf = ftype === 'blackout' ? 0.0007 : 0.00045;
  const boxH = cassette ? (duo ? 0.085 : 0.075) : 0;
  const zc = clamp(fit.zBack + 0.035, fit.zBack, Math.max(fit.zBack, fit.zFront - 0.035));
  const yTube = fit.yTop - (cassette ? boxH * 0.5 : 0.028);
  const barH = duo ? 0.03 : 0.028;
  const maxDrop = Math.min(fit.drop - (fit.yTop - yTube) - barH * 0.5, pieces.maxDrop);
  const rect = glassRect(fit);
  const gap = pieces.n > 1 ? 0.01 : 0;
  const rows = [];

  for (let k = 0; k < pieces.n; k++) {
    const px0 = fit.x0 + k * pieces.w + (k > 0 ? gap / 2 : 0);
    const px1 = fit.x0 + (k + 1) * pieces.w - (k < pieces.n - 1 ? gap / 2 : 0);
    const cx = (px0 + px1) / 2;
    const len = px1 - px0;
    const fx0 = px0 + 0.018, fx1 = px1 - 0.018;
    // brackets or cassette
    if (cassette) {
      const cas = new THREE.Mesh(boxAt(rig, len, boxH, 0.075, cx, fit.yTop - boxH / 2, zc + 0.004, { r: 0.012, grain: 'x' }), railMat);
      cas.castShadow = cas.receiveShadow = true;
      rig.add(cas, 'rail');
      if (k === 0) driverMesh(rig, cas);
    } else {
      for (const sx of [px0 + 0.006, px1 - 0.006]) {
        const br = new THREE.Mesh(boxAt(rig, 0.012, 0.05, 0.05, sx, yTube, zc, { r: 0.004 }), railMat);
        br.castShadow = br.receiveShadow = true;
        rig.add(br, 'rail');
        if (k === 0 && !rig.driver) driverMesh(rig, br);
      }
    }
    // the roll of fabric (radius grows when rolled up)
    const fabMat = fabricMaterial(rig, kind, hex, { view, glow: glowOf(T, view), rect });
    const rollGeo = rodX(rig, 1, fx1 - fx0, cx, 0, 0, quality === 'low' ? 12 : 20);
    rollGeo.translate(-cx, 0, 0);
    const roll = new THREE.Mesh(rollGeo, cassette ? railMat : fabMat);
    roll.castShadow = roll.receiveShadow = true;
    rig.add(roll, cassette ? 'rail' : 'fabric');
    roll.visible = !cassette;
    // fabric layers
    const layers = [];
    const nLayers = duo ? 2 : 1;
    for (let l = 0; l < nLayers; l++) {
      // duo: the glow is mostly the opaque (dimout) bands; the sheer bands are see-through via the alpha map
      const m = duo ? fabricMaterial(rig, kind, hex, { view: 0.001, glow: 0.09, rect }) : fabMat;
      if (duo) {
        m.transparent = true;
        m.depthWrite = false;
        m.alphaMap = stripeTexture().clone();
        rig.own(m.alphaMap);
        m.alphaMap.channel = 1;
        m.alphaMap.repeat.set(1, 1 / 0.11);
        m.alphaMap.needsUpdate = true;
      }
      const g = gridGeometry(rig, 2, 2);
      if (duo) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(8), 2).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.Mesh(g, m);
      castFabric(rig, mesh, duo ? 0.08 : T, { force: duo });
      mesh.renderOrder = duo ? 1 + l : 0;
      rig.add(mesh, 'fabric');
      layers.push({ mesh, g, m });
    }
    // bottom bar
    const bar = new THREE.Mesh(boxAt(rig, fx1 - fx0 + 0.008, barH * (duo ? 0.9 : 0.55), duo ? 0.02 : 0.013, 0, 0, 0, { r: 0.004, grain: 'x' }), railMat);
    bar.castShadow = bar.receiveShadow = true;
    rig.add(bar, 'rail');
    // chain (right side) or a pull handle (cordless)
    let chain = null;
    if ((p.operation || 'chain') === 'chain' && k === (fit.opSide < 0 ? 0 : pieces.n - 1)) {
      const cl = Math.min(1.3, maxDrop * 0.62);
      const chx = fit.opSide < 0 ? px0 + 0.008 : px1 - 0.008;
      chain = new THREE.Mesh(boxAt(rig, 0.003, cl, 0.012, chx, yTube - cl / 2, zc + 0.022, { r: 0.0014 }), solid('plastic', railHex === '#1f1f1f' ? '#2a2a2a' : '#f2f2f0', { roughness: 0.35 }));
      chain.castShadow = false;
      rig.add(chain, 'rail');
    }
    // cordless: a small pull handle in the middle of the bottom bar
    let handle = null;
    if (p.operation === 'cordless') {
      handle = new THREE.Mesh(boxAt(rig, 0.06, 0.014, 0.014, 0, 0, 0, { r: 0.006 }), railMat);
      handle.castShadow = true;
      rig.add(handle, 'rail');
    }
    rows.push({ roll, layers, bar, handle, fx0, fx1, cx });
  }

  rig.pose = ({ open = 0, band = 0 }) => {
    const o = clamp01(open);
    const l = Math.max(0.02, (1 - o) * maxDrop + o * 0.025);
    const rolled = Math.max(0, maxDrop - l) * (duo ? 2 : 1);
    const r = Math.sqrt(r0 * r0 + (tf * rolled) / Math.PI);
    for (const row of rows) {
      row.roll.scale.set(1, r, r);
      row.roll.position.set(row.cx, yTube, zc);
      const zFab = zc - r;
      const yBot = yTube - l;
      if (duo) {
        // back layer from the back of the tube, around the bottom bar, front layer up to the head
        const sep = 0.011;
        const [back, front] = row.layers;
        setQuad(back.g, row.fx0, row.fx1, yTube, yBot, zFab, 0);
        setQuad(front.g, row.fx0, row.fx1, yTube - 0.006, yBot, zFab + sep, 0);
        for (const [L, phase] of [[back, band * 0.5], [front, 0]]) {
          const uv1 = L.g.attributes.uv1.array;
          const top = 0;
          const bot = (yTube - yBot) / 1;
          uv1.set([0, top, 1, top, 0, -bot, 1, -bot]);
          L.g.attributes.uv1.needsUpdate = true;
          L.m.alphaMap.offset.y = phase;
        }
        row.bar.position.set(row.cx, yBot - barH * 0.35, zFab + sep / 2);
      } else {
        setQuad(row.layers[0].g, row.fx0, row.fx1, yTube, yBot, zFab, rolled);
        row.bar.position.set(row.cx, yBot - barH * 0.2, zFab + 0.0045);
      }
      row.handle?.position.set(row.cx, row.bar.position.y - 0.006, row.bar.position.z + 0.014);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pleated blind (plissé, single / top-down-bottom-up / honeycomb)

function buildPleated(rig) {
  const { fit, spec } = rig;
  const p = spec.params || {};
  const C = spec.colors || {};
  const M = spec.materials || {};
  const mode = p.mode === 'duette' || p.mode === 'topdown-bottomup' ? p.mode : 'single';
  const ftype = fabricType(spec);
  const F = FABRICS[ftype] || FABRICS.filter;
  const T = coveredT(spec);
  const view = Math.min(F.view, 0.3);
  const kind = M.fabric || 'woven';
  const hex = C.fabric || '#efece5';
  const railMat = solid(M.rail || 'painted', C.rail || '#eeeeec', { roughness: 0.4 });
  const pieces = blindPieces(fit, spec);
  const L = clamp(num(p.pleatMm, mode === 'duette' ? 25 : 20), 12, 40) / 1000;
  const railH = 0.021;
  const railD = mode === 'duette' ? 0.032 : 0.022;
  const zc = clamp(fit.zBack + railD / 2 + 0.002, fit.zBack, Math.max(fit.zBack, fit.zFront - railD / 2));
  const maxDrop = Math.min(fit.drop, pieces.maxDrop);
  const yHi = fit.yTop - railH; // fabric top when the top rail is up
  const yLo = fit.yTop - maxDrop + railH; // fabric bottom when fully down
  const span0 = yHi - yLo;
  const faces = Math.max(4, Math.round(span0 / (L * 0.93)));
  const hmin = mode === 'duette' ? 0.0011 : 0.00045;
  const stackH = faces * hmin + 0.004;
  const rect = glassRect(fit);
  const gap = pieces.n > 1 ? 0.01 : 0;
  const sub = mode === 'duette' ? 3 : 1;
  const rowsPer = faces * sub + 1;
  const items = [];
  for (let k = 0; k < pieces.n; k++) {
    const px0 = fit.x0 + k * pieces.w + (k > 0 ? gap / 2 : 0);
    const px1 = fit.x0 + (k + 1) * pieces.w - (k < pieces.n - 1 ? gap / 2 : 0);
    const cx = (px0 + px1) / 2;
    const len = px1 - px0;
    const top = new THREE.Mesh(boxAt(rig, len, railH, railD, 0, 0, 0, { r: 0.005, grain: 'x' }), railMat);
    top.castShadow = top.receiveShadow = true;
    rig.add(top, 'rail');
    if (k === 0) driverMesh(rig, top);
    let head = null;
    if (mode === 'topdown-bottomup') {
      head = new THREE.Mesh(boxAt(rig, len, 0.012, railD * 0.9, cx, fit.yTop - 0.006, zc, { r: 0.004, grain: 'x' }), railMat);
      head.castShadow = head.receiveShadow = true;
      rig.add(head, 'rail');
    }
    const bot = new THREE.Mesh(boxAt(rig, len, railH, railD, 0, 0, 0, { r: 0.005, grain: 'x' }), railMat);
    bot.castShadow = bot.receiveShadow = true;
    rig.add(bot, 'rail');
    const grip = new THREE.Mesh(boxAt(rig, 0.06, 0.008, 0.008, 0, 0, 0, { r: 0.003 }), railMat);
    rig.add(grip, 'rail');
    const fm = fabricMaterial(rig, kind, hex, { view, glow: glowOf(T, view), rect });
    const layers = mode === 'duette' ? [1, -1] : [1];
    const meshes = layers.map((side) => {
      const g = mode === 'duette' ? gridGeometry(rig, rowsPer, 2) : faceGeometry(rig, faces);
      const mesh = new THREE.Mesh(g, fm);
      castFabric(rig, mesh, mode === 'duette' ? T * 0.8 : T);
      rig.add(mesh, 'fabric');
      depthPrepass(rig, mesh);
      return { g, side };
    });
    items.push({ top, bot, grip, meshes, x0: px0 + 0.002, x1: px1 - 0.002, cx });
  }

  rig.pose = ({ open = 0, top = 0 }) => {
    const tdbu = mode === 'topdown-bottomup';
    const tp = tdbu ? clamp01(top) : 0;
    let yUp = lerp(yHi, yLo + stackH, tp);
    let yDn = lerp(yLo, yUp - stackH, clamp01(open));
    if (yDn > yUp - stackH) yDn = yUp - stackH;
    const S = Math.max(stackH, yUp - yDn);
    const h = S / faces;
    const depth = Math.sqrt(Math.max(0, L * L - h * h));
    for (const it of items) {
      it.top.position.set(it.cx, yUp + railH / 2, zc);
      it.bot.position.set(it.cx, yDn - railH / 2, zc);
      it.grip.position.set(it.cx, yDn - railH / 2, zc + railD / 2 + 0.004);
      for (const { g, side } of it.meshes) {
        if (mode !== 'duette') {
          poseFaces(g, faces, it.x0, it.x1, (f) => yUp - f * h, (f) => zc + (f % 2 ? depth / 2 : -depth / 2), L);
          continue;
        }
        const pos = g.attributes.position.array;
        const uv = g.attributes.uv.array;
        for (let r = 0; r < rowsPer; r++) {
          const f = r / sub; // face coordinate
          const y = yUp - f * h;
          let z;
          if (mode === 'duette') {
            // honeycomb cells: round bulges on both faces between the glued creases
            const t = f % 1;
            const cell = Math.sin(Math.PI * t);
            z = zc + side * (0.0035 + (depth * 0.45 + 0.002) * cell);
          } else {
            z = zc + ((Math.round(f) % 2) ? depth / 2 : -depth / 2);
          }
          const v = f * L;
          for (let c = 0; c < 2; c++) {
            const i = r * 2 + c;
            pos[i * 3] = c ? it.x1 : it.x0;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = z;
            uv[i * 2] = c ? it.x1 : it.x0;
            uv[i * 2 + 1] = -v;
          }
        }
        finishDynamic(g);
      }
    }
  };
}

/** Zigzag strip with its own 4 vertices per face (crisp pleats). */
function faceGeometry(rig, faces) {
  const g = new THREE.BufferGeometry();
  const n = faces * 4;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let f = 0; f < faces; f++) {
    const a = f * 4;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  return rig.geo(g);
}

/** Writes the faces of a pleated strip: rows at y(f), z(f) for f = 0..faces, x from x0 to x1, flat normals. */
function poseFaces(g, faces, x0, x1, yOf, zOf, L) {
  const pos = g.attributes.position.array;
  const nrm = g.attributes.normal.array;
  const uv = g.attributes.uv.array;
  for (let f = 0; f < faces; f++) {
    const ya = yOf(f), yb = yOf(f + 1), za = zOf(f), zb = zOf(f + 1);
    let ny = zb - za;
    let nz = ya - yb;
    if (nz < 0) {
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(ny, nz) || 1;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const lower = k >= 2;
      const x = k % 2 ? x1 : x0;
      pos[i * 3] = x;
      pos[i * 3 + 1] = lower ? yb : ya;
      pos[i * 3 + 2] = lower ? zb : za;
      nrm[i * 3] = 0;
      nrm[i * 3 + 1] = ny;
      nrm[i * 3 + 2] = nz;
      uv[i * 2] = x;
      uv[i * 2 + 1] = -(f + (lower ? 1 : 0)) * L;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.attributes.uv.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
}

// ---------------------------------------------------------------------------------------------------------------
// Vertical blind (lamellgardin)

function buildVertical(rig) {
  const { fit, spec, quality } = rig;
  const p = spec.params || {};
  const C = spec.colors || {};
  const M = spec.materials || {};
  const T = coveredT(spec);
  const kind = M.fabric || M.slat || 'woven';
  const hex = C.fabric || C.slat || '#efede8';
  const railMat = solid(M.rail || 'painted', C.rail || '#e6e6e3', { roughness: 0.4 });
  const vw = (Number(p.vaneMm) === 127 ? 127 : 89) / 1000;
  const trackH = 0.03;
  const trackD = 0.034;
  const zc = clamp(fit.zBack + Math.max(trackD, vw) / 2 + 0.006, fit.zBack, Math.max(fit.zBack, fit.zFront));
  const len = fit.width;
  const cx = (fit.x0 + fit.x1) / 2;
  const yHook = fit.yTop - trackH - 0.008;
  const sz = productSizing(spec.productId ? getProduct(spec.productId) : null);
  const length = p.length === 'sill' || p.length === 'floor' ? p.length : fit.sill > 0.55 ? 'sill' : 'floor';
  let yEnd = length === 'sill' || fit.mount === 'recess' ? fit.sillY - (fit.mount === 'recess' ? -0.008 : 0.02) : fit.floorY + 0.012;
  if (sz && !sz.custom && !sz.cuttable) yEnd = Math.max(yEnd, yHook - sz.h);
  const vh = yHook - yEnd;
  const pitch = vw * 0.88;
  const N = Math.max(2, Math.round(len / pitch));
  const rect = glassRect(fit);

  const track = new THREE.Mesh(boxAt(rig, len, trackH, trackD, cx, fit.yTop - trackH / 2, zc, { r: 0.005, grain: 'x' }), railMat);
  track.castShadow = track.receiveShadow = true;
  rig.add(track, 'rail');
  driverMesh(rig, track);

  // vane: slightly curved vertical strip, width along local z (so tilt 0 = edge-on to the window)
  const segZ = quality === 'low' ? 2 : 4;
  const vg = new THREE.PlaneGeometry(vw, vh, segZ, 1);
  vg.rotateY(Math.PI / 2); // width along z, normal +x
  vg.translate(0, -vh / 2, 0);
  const vp = vg.attributes.position;
  const vuv = vg.attributes.uv;
  for (let i = 0; i < vp.count; i++) {
    const z = vp.getZ(i);
    vp.setX(i, vw * 0.06 * (1 - (2 * z / vw) ** 2));
    vuv.setXY(i, z, vp.getY(i));
  }
  vg.computeVertexNormals();
  rig.geo(vg);
  const vmat = fabricMaterial(rig, kind, hex, { view: 0, glow: glowOf(T, 0), rect });
  const vanes = new THREE.InstancedMesh(vg, vmat, N);
  vanes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  castFabric(rig, vanes, T);
  rig.add(vanes, 'fabric');
  const carriers = new THREE.InstancedMesh(boxAt(rig, 0.012, 0.012, 0.02, 0, -0.004, 0, { r: 0.002 }), railMat, N);
  carriers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rig.add(carriers, 'rail');
  const chainGeo = rig.geo(new THREE.BoxGeometry(1, 0.0025, 0.0025));
  const chain = new THREE.InstancedMesh(chainGeo, solid('plastic', '#f2f2f0', { roughness: 0.4 }), Math.max(1, N - 1));
  chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rig.add(chain, 'rail');
  const weights = new THREE.InstancedMesh(boxAt(rig, 0.004, 0.035, vw * 0.9, 0, -vh + 0.02, 0), solid('woven', hex, { flat: true }), N);
  weights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  weights.castShadow = true;
  rig.add(weights, 'fabric');

  const stack = p.stack === 'right' || p.stack === 'split' ? p.stack : 'left';
  const pts = [];
  rig.pose = ({ open = 0, tilt = 0 }) => {
    const o = clamp01(open);
    const t = clamp(tilt, -84, 84) * DEG * (1 - smooth(clamp01(o * 1.6)));
    pts.length = 0;
    for (let i = 0; i < N; i++) {
      const spread = fit.x0 + pitch * 0.5 + (i * (len - pitch)) / Math.max(1, N - 1);
      let st;
      if (stack === 'left') st = fit.x0 + 0.012 + i * 0.0105;
      else if (stack === 'right') st = fit.x1 - 0.012 - (N - 1 - i) * 0.0105;
      else st = i < N / 2 ? fit.x0 + 0.012 + i * 0.0105 : fit.x1 - 0.012 - (N - 1 - i) * 0.0105;
      const x = lerp(spread, st, o);
      _q.setFromAxisAngle(_up, t);
      _m4.compose(_p3.set(x, yHook, zc), _q, _s);
      vanes.setMatrixAt(i, _m4);
      weights.setMatrixAt(i, _m4);
      _m4.compose(_p3.set(x, yHook + 0.006, zc), _q, _s);
      carriers.setMatrixAt(i, _m4);
      pts.push(new THREE.Vector3(0, -vh + 0.012, vw * 0.38).applyAxisAngle(_up, t).add(_p3.set(x, yHook, zc)));
    }
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = _p3.subVectors(b, a);
      const l = d.length() || 1e-4;
      _q.setFromUnitVectors(X_AXIS, d.normalize());
      _m4.compose(a.clone().add(b).multiplyScalar(0.5), _q, new THREE.Vector3(l, 1, 1));
      chain.setMatrixAt(i, _m4);
    }
    for (const m of [vanes, carriers, chain, weights]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  };
}
const _up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------------------------
// Curtains (gardin)

const AMP = (() => {
  // arc length of one half-wave z = A·sin(πt), t ∈ [0, 1], span 1: f(A) – tabulated for the inverse
  const n = 360;
  const As = new Float64Array(n + 1);
  const fs = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const A = 14 * (i / n) ** 2;
    let s = 0;
    const m = 96;
    for (let j = 0; j < m; j++) {
      const t = (j + 0.5) / m;
      const d = A * Math.PI * Math.cos(Math.PI * t);
      s += Math.sqrt(1 + d * d) / m;
    }
    As[i] = A;
    fs[i] = s;
  }
  return { As, fs, n };
})();

/** Amplitude of a half-sine fold with arc length `arc` over a horizontal span `span`. */
function sineAmp(arc, span) {
  if (span <= 1e-5) return arc / 2;
  const r = arc / span;
  if (r <= 1) return 0;
  const { As, fs, n } = AMP;
  if (r >= fs[n]) return ((arc - span * 0.35) / 2);
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fs[mid] < r) lo = mid;
    else hi = mid;
  }
  const t = (r - fs[lo]) / (fs[hi] - fs[lo]);
  return lerp(As[lo], As[hi], t) * span;
}

const FOLD = {
  wave: { spacing: 0.06, fullness: 2.2, stackPer: 0.0145, z: 0.1 },
  pleat: { spacing: 0.06, fullness: 2.0, stackPer: 0.017, z: 0.1 },
  ring: { spacing: 0.1, fullness: 1.8, stackPer: 0.021, z: 0.105 },
  eyelet: { spacing: 0.085, fullness: 1.7, stackPer: 0.024, z: 0.105 },
};

/** Track, panels and fabric of a curtain on a window (shared by the builder and shadingSize). */
function curtainLayout(fit, spec) {
  const p = spec.params || {};
  const fold = FOLD[p.fold] ? p.fold : 'wave';
  const FD = FOLD[fold];
  const span = p.span === 'wall' ? 'wall' : 'window';
  const track = fit.mount === 'wall' ? 'wall' : 'ceiling';
  const ext = 0.2;
  const X0 = span === 'wall' ? fit.midL + (fit.endL ? 0 : 0.002) : Math.max(-fit.W / 2 - ext, fit.midL + 0.006);
  const X1 = span === 'wall' ? fit.midR - (fit.endR ? 0 : 0.002) : Math.min(fit.W / 2 + ext, fit.midR - 0.006);
  const cy = Math.min(fit.ceilAt(X0), fit.ceilAt(X1), fit.ceilAt(0));
  const rod = fold === 'ring' || fold === 'eyelet';
  const zc = FD.z;
  let yTrack;
  let yTop;
  if (track === 'ceiling') {
    yTrack = rod ? cy - 0.06 : cy - 0.007;
    yTop = rod ? (fold === 'eyelet' ? yTrack + 0.04 : yTrack - 0.035) : cy - 0.012;
  } else {
    yTrack = Math.min(cy - 0.07, 0.13);
    yTop = rod ? (fold === 'eyelet' ? yTrack + 0.04 : yTrack - 0.035) : yTrack + 0.025;
  }
  const length = p.length === 'sill' ? 'sill' : p.length === 'floor' ? 'floor' : fit.sill > 0.55 ? 'sill' : 'floor';
  const yBotNeed = length === 'sill' ? fit.sillY - 0.015 : fit.floorY + 0.008;
  const needDrop = yTop - yBotNeed;
  const product = spec.productId ? getProduct(spec.productId) : null;
  const sz = productSizing(product);
  let yBot = yBotNeed;
  let short = 0;
  if (sz && !sz.custom && sz.h < needDrop - 0.005) {
    yBot = yTop - sz.h;
    short = needDrop - sz.h;
  }
  const trackW = X1 - X0;
  const nPanels = Number(p.panels) === 1 ? 1 : 2;
  // fabric: ready-made lengths/pairs → the real fabric width; made to measure → track × fullness
  let fullness = clamp(num(p.fullness, FD.fullness), 1, 3.2);
  let pieces = 0;
  let pieceW = 0;
  let fabricTotal = trackW * fullness;
  if (sz && !sz.custom) {
    pieceW = sz.w;
    const perPiece = pieceW;
    pieces = Math.max(1, Math.round(num(p.pieces, 0)) || Math.max(nPanels === 2 && !sz.pair ? 2 : 1, Math.round((trackW * fullness) / perPiece)));
    if (nPanels === 2 && !sz.pair && pieces % 2) pieces += 1;
    fabricTotal = pieces * perPiece;
    fullness = fabricTotal / trackW;
  }
  const panels = [];
  const side = p.side === 'right' ? 'right' : 'left';
  if (nPanels === 2) {
    const mid = (X0 + X1) / 2;
    panels.push({ fixed: X0, dir: 1, closedW: mid - X0 + 0.015, fabricW: fabricTotal / 2 });
    panels.push({ fixed: X1, dir: -1, closedW: X1 - mid + 0.015, fabricW: fabricTotal / 2 });
  } else {
    panels.push(side === 'left' ? { fixed: X0, dir: 1, closedW: trackW, fabricW: fabricTotal } : { fixed: X1, dir: -1, closedW: trackW, fabricW: fabricTotal });
  }
  for (const pn of panels) {
    // too little fabric cannot cover the track: the panel stops where the fabric runs out (flat)
    pn.closedW = Math.min(pn.closedW, pn.fabricW / 1.04);
    pn.K = Math.max(2, Math.round(pn.closedW / FD.spacing));
    pn.stackW = Math.min(pn.closedW, pn.K * FD.stackPer + 0.02);
  }
  return { fold, FD, span, track, X0, X1, cy, rod, zc, yTrack, yTop, yBot, needDrop, short, length, fullness, pieces, pieceW, fabricTotal, panels, nPanels };
}

function buildCurtain(rig) {
  const { fit, spec, quality } = rig;
  const p = spec.params || {};
  const C = spec.colors || {};
  const M = spec.materials || {};
  const c = curtainLayout(fit, spec);
  const ftype = fabricType(spec);
  const F = FABRICS[ftype] || FABRICS.linen;
  let T = coveredT(spec);
  if (p.lining === 'blackout') T = 0;
  else if (p.lining === 'cotton') T *= 0.4;
  const view = p.lining && p.lining !== 'none' ? 0 : F.view;
  const kind = M.fabric || F.kind;
  const hex = C.fabric || '#ddd3c3';
  const railMat = solid(M.rail || 'black-metal', C.rail || '#1e1e1e', { roughness: 0.45 });
  const check = p.pattern === 'check' ? 0.16 : 0;
  const rect = glassRect(fit);
  const R = rng(`curtain:${fit.id}`);

  // track / rod
  const tl = c.X1 - c.X0;
  const tcx = (c.X0 + c.X1) / 2;
  let driver;
  if (c.rod) {
    const rr = 0.0125;
    const rodMesh = new THREE.Mesh(rodX(rig, rr, tl, tcx, c.yTrack, c.zc, 16), railMat);
    rodMesh.castShadow = rodMesh.receiveShadow = true;
    rig.add(rodMesh, 'rail');
    driver = rodMesh;
    const nb = Math.max(2, Math.ceil(tl / 1.3) + 1);
    for (let i = 0; i < nb; i++) {
      const x = c.X0 + 0.07 + (i * (tl - 0.14)) / (nb - 1);
      const g = c.track === 'ceiling'
        ? boxAt(rig, 0.016, c.cy - c.yTrack, 0.016, x, (c.cy + c.yTrack) / 2, c.zc, { r: 0.005 })
        : boxAt(rig, 0.016, 0.03, c.zc + 0.01, x, c.yTrack + 0.006, c.zc / 2, { r: 0.005 });
      const b = new THREE.Mesh(g, railMat);
      b.castShadow = b.receiveShadow = true;
      rig.add(b, 'rail');
    }
    // finials at the free ends
    for (const [x, free] of [[c.X0, c.span === 'window' || fit.endL], [c.X1, c.span === 'window' || fit.endR]]) {
      if (!free) continue;
      const g = rig.geo(new THREE.SphereGeometry(0.021, 16, 10));
      g.translate(x + (x < tcx ? -0.012 : 0.012), c.yTrack, c.zc);
      const f = new THREE.Mesh(g, railMat);
      f.castShadow = true;
      rig.add(f, 'rail');
    }
  } else {
    const g = c.track === 'ceiling'
      ? boxAt(rig, tl, 0.013, 0.026, tcx, c.cy - 0.0065, c.zc, { r: 0.003, grain: 'x' })
      : boxAt(rig, tl, 0.018, 0.026, tcx, c.yTrack, c.zc, { r: 0.003, grain: 'x' });
    const t = new THREE.Mesh(g, railMat);
    t.castShadow = t.receiveShadow = true;
    rig.add(t, 'rail');
    driver = t;
    if (c.track === 'wall') {
      const nb = Math.max(2, Math.ceil(tl / 1.2) + 1);
      for (let i = 0; i < nb; i++) {
        const x = c.X0 + 0.05 + (i * (tl - 0.1)) / (nb - 1);
        const b = new THREE.Mesh(boxAt(rig, 0.02, 0.025, c.zc, x, c.yTrack + 0.015, c.zc / 2, { r: 0.004 }), railMat);
        b.castShadow = true;
        rig.add(b, 'rail');
      }
    }
  }
  driverMesh(rig, driver);

  const fm = fabricMaterial(rig, kind, hex, { view, glow: glowOf(T, view), check, rect });
  const sub = quality === 'low' ? 4 : quality === 'high' ? 8 : 6;
  const rows = quality === 'low' ? 10 : quality === 'high' ? 26 : 18;
  const drop = c.yTop - c.yBot;
  const panelRigs = c.panels.map((pn) => {
    const cols = pn.K * sub + 1;
    const g = gridGeometry(rig, rows, cols);
    const mesh = new THREE.Mesh(g, fm);
    castFabric(rig, mesh, T);
    rig.add(mesh, 'fabric');
    depthPrepass(rig, mesh);
    // per-fold variation (deterministic) and the fabric arc per half-fold
    const vary = Array.from({ length: pn.K }, () => 1 + (R() - 0.5) * (c.fold === 'wave' ? 0.08 : 0.26));
    const sway = Array.from({ length: pn.K + 1 }, () => (R() - 0.5) * (c.fold === 'wave' ? 0.004 : 0.016));
    let rings = null;
    if (c.rod) {
      const n = c.fold === 'eyelet' ? pn.K + 1 : Math.floor(pn.K / 2) + 1;
      const tg = c.fold === 'eyelet' ? new THREE.TorusGeometry(0.02, 0.0045, 6, 18) : new THREE.TorusGeometry(0.019, 0.0028, 6, 18);
      rings = new THREE.InstancedMesh(rig.geo(tg), c.fold === 'eyelet' ? solid('black-metal', C.rail || '#1e1e1e', { roughness: 0.4 }) : railMat, n);
      rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      rings.castShadow = true;
      rig.add(rings, 'rail');
    }
    // per column: fold coordinate, sine profile, fold sign × variation, sway (deterministic), pleat heading bump
    const colS = new Float32Array(cols);
    const colSin = new Float32Array(cols);
    const colAmp = new Float32Array(cols);
    const colSway = new Float32Array(cols);
    const colBump = new Float32Array(cols);
    for (let j = 0; j < cols; j++) {
      const s = j / sub;
      const k = Math.min(pn.K - 1, Math.floor(s));
      const t = s - k;
      const sgn = k % 2 === 0 ? 1 : -1;
      colS[j] = s;
      colSin[j] = Math.sin(Math.PI * t);
      colAmp[j] = sgn * vary[k];
      colSway[j] = lerp(sway[k], sway[k + 1] ?? 0, t);
      colBump[j] = Math.exp(-((t - (sgn > 0 ? 0.5 : 0)) ** 2) / 0.02);
    }
    return { pn, g, mesh, cols, rings, colS, colSin, colAmp, colSway, colBump };
  });

  const yRows = Array.from({ length: rows }, (_, r) => c.yTop - drop * (r / (rows - 1)) ** 1.08);
  const rowM = yRows.map((y) => {
    const below = c.yTop - y;
    const vN = below / drop;
    let m = 1;
    if (c.fold === 'pleat') m = 0.38 + 0.62 * smooth(clamp01(below / 0.3));
    else if (c.fold === 'ring') m = 0.75 + 0.25 * smooth(clamp01(below / 0.25));
    return { below, vN, m: m * (1 + (c.fold === 'wave' ? 0.03 : 0.12) * vN), bump: c.fold === 'pleat' && below < 0.11 ? 0.012 * (1 - below / 0.11) : 0 };
  });
  rig.pose = ({ open = 1 }) => {
    const o = clamp01(open);
    for (const pr of panelRigs) {
      const { pn, g, cols, colS, colSin, colAmp, colSway, colBump } = pr;
      const wp = lerp(pn.closedW, pn.stackW, smooth(o));
      const cs = wp / pn.K; // carrier spacing
      const arc = pn.fabricW / pn.K;
      const A0 = Math.min(sineAmp(arc, cs), c.zc - 0.016 + 0.03);
      const pos = g.attributes.position.array;
      const nrm = g.attributes.normal.array;
      const uv = g.attributes.uv.array;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let r = 0; r < rows; r++) {
        const y = yRows[r];
        const { below, vN, m, bump } = rowM[r];
        const sv = vN * vN;
        const ringTop = c.fold === 'ring' && r === 0;
        const base = r * cols;
        for (let j = 0; j < cols; j++) {
          let z = c.zc + A0 * m * colAmp[j] * colSin[j];
          if (bump) z += bump * colBump[j];
          if (ringTop) z = c.zc + A0 * colAmp[j] * 0.3 * colSin[j];
          if (z < 0.014) z = 0.014;
          const x = pn.fixed + pn.dir * (colS[j] * cs) + colSway[j] * sv;
          const i = (base + j) * 3;
          pos[i] = x;
          pos[i + 1] = ringTop ? y - 0.006 * Math.sin(Math.PI * ((colS[j] / 2) % 1)) : y;
          pos[i + 2] = z;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
        // normals (finite differences across the folds) and the fabric arc length as u
        let u = 0;
        for (let j = 0; j < cols; j++) {
          const a = (base + Math.max(0, j - 1)) * 3;
          const b = (base + Math.min(cols - 1, j + 1)) * 3;
          const dx = pos[b] - pos[a];
          const dz = pos[b + 2] - pos[a + 2];
          const l = Math.hypot(dx, dz) || 1;
          const i = (base + j) * 3;
          nrm[i] = -dz / l;
          nrm[i + 1] = 0;
          nrm[i + 2] = dx / l;
          if (j > 0) u += Math.hypot(pos[i] - pos[i - 3], pos[i + 2] - pos[i - 1]);
          const iu = (base + j) * 2;
          uv[iu] = pn.dir > 0 ? u : -u;
          uv[iu + 1] = -below;
        }
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
      g.attributes.uv.needsUpdate = true;
      (g.boundingBox ||= new THREE.Box3()).min.set(minX, c.yBot - 0.01, minZ);
      g.boundingBox.max.set(maxX, c.yTop + 0.01, maxZ);
      (g.boundingSphere ||= new THREE.Sphere());
      g.boundingBox.getBoundingSphere(g.boundingSphere);
      if (pr.rings) {
        const n = pr.rings.count;
        for (let i = 0; i < n; i++) {
          const s = c.fold === 'eyelet' ? i : i * 2;
          const x = pn.fixed + pn.dir * Math.min(pn.K, s) * cs;
          _q.setFromAxisAngle(_up, Math.PI / 2);
          _m4.compose(_p3.set(x, c.yTrack - (c.fold === 'ring' ? 0.006 : 0), c.zc), _q, _s);
          pr.rings.setMatrixAt(i, _m4);
        }
        pr.rings.instanceMatrix.needsUpdate = true;
        pr.rings.computeBoundingSphere();
      }
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Roman blind (liftgardin)

function buildRoman(rig) {
  const { fit, spec } = rig;
  const p = spec.params || {};
  const C = spec.colors || {};
  const M = spec.materials || {};
  const ftype = fabricType(spec);
  const F = FABRICS[ftype] || FABRICS.filter;
  const T = coveredT(spec);
  const view = Math.min(F.view, 0.35);
  const kind = M.fabric || F.kind;
  const hex = C.fabric || '#cbbca5';
  const pieces = blindPieces(fit, spec);
  const headH = 0.035;
  const zc = clamp(fit.zBack + 0.03, fit.zBack, Math.max(fit.zBack, fit.zFront - 0.03));
  const maxDrop = Math.min(fit.drop, pieces.maxDrop) - headH;
  const n = clamp(Math.round(num(p.folds, 6)), 2, 12);
  const s = maxDrop / n; // fabric per fold
  const hmin = 0.022;
  const rect = glassRect(fit);
  const fm = fabricMaterial(rig, kind, hex, { view, glow: glowOf(T, view), rect });
  const PER = 16; // polyline points per fold
  const rowsN = n * PER + 1;
  const gap = pieces.n > 1 ? 0.01 : 0;
  const items = [];
  for (let k = 0; k < pieces.n; k++) {
    const px0 = fit.x0 + k * pieces.w + (k > 0 ? gap / 2 : 0);
    const px1 = fit.x0 + (k + 1) * pieces.w - (k < pieces.n - 1 ? gap / 2 : 0);
    const cx = (px0 + px1) / 2;
    const head = new THREE.Mesh(boxAt(rig, px1 - px0, headH, 0.045, cx, fit.yTop - headH / 2, zc + 0.006, { r: 0.004, grain: 'x' }), fm);
    head.castShadow = head.receiveShadow = true;
    rig.add(head, 'fabric');
    if (k === 0) driverMesh(rig, head);
    const g = gridGeometry(rig, rowsN, 2);
    const mesh = new THREE.Mesh(g, fm);
    castFabric(rig, mesh, T);
    rig.add(mesh, 'fabric');
    depthPrepass(rig, mesh);
    const bar = new THREE.Mesh(boxAt(rig, px1 - px0 - 0.004, 0.018, 0.012, 0, 0, 0, { r: 0.005, grain: 'x' }), fm);
    bar.castShadow = true;
    rig.add(bar, 'fabric');
    items.push({ g, bar, x0: px0 + 0.002, x1: px1 - 0.002, cx });
  }
  const yA0 = fit.yTop - headH;
  const ys = new Float64Array(rowsN);
  const zs = new Float64Array(rowsN);
  const vs = new Float64Array(rowsN);

  /** One fold from (ya, z0) to (yb, z0) with fabric length s, depth d, back offset e → PER+1 points. */
  const foldPoints = (ya, yb, d, e, out, o0) => {
    const h = ya - yb;
    const slack = s - h;
    if (slack < 0.002 || d < 0.002) {
      // nearly flat: a gentle half-sine bulge toward the room
      const A = slack > 0 ? sineAmp(s, Math.max(h, 1e-4)) : 0;
      for (let i = 0; i <= PER; i++) {
        const t = i / PER;
        out.y[o0 + i] = ya - h * t;
        out.z[o0 + i] = zc + A * Math.sin(Math.PI * t);
      }
      return;
    }
    // U-shaped fold hanging in front: down the front at zc+e+d, round the bottom, up the back at zc+e
    const zf = zc + e + d;
    const zb = zc + e;
    const curve = (u) => {
      const yLow = yb - u;
      const pts = [];
      const jTop = Math.min(0.012, h * 0.5);
      pts.push([ya, zc], [ya - jTop * 0.5, zc + (zf - zc) * 0.7], [ya - jTop, zf]);
      const yTurn = yLow + d / 2;
      pts.push([Math.min(ya - jTop, Math.max(yTurn, yb - 0.004)), zf]);
      for (let a = 1; a <= 4; a++) {
        const th = (a / 5) * Math.PI;
        pts.push([yTurn - (d / 2) * Math.sin(th), zb + d / 2 + (d / 2) * Math.cos(th)]);
      }
      pts.push([Math.min(yTurn, yb - 0.006), zb]);
      pts.push([yb - 0.002, zc + (zb - zc) * 0.4], [yb, zc]);
      return pts;
    };
    const lenOf = (pts) => {
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return l;
    };
    let lo = 0, hi = s;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2;
      if (lenOf(curve(mid)) < s) lo = mid;
      else hi = mid;
    }
    const pts = curve(lo);
    // resample to PER+1 points by arc length
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    let seg = 1;
    for (let i = 0; i <= PER; i++) {
      const target = (i / PER) * total;
      while (seg < pts.length - 1 && cum[seg] < target) seg++;
      const t = (target - cum[seg - 1]) / Math.max(1e-6, cum[seg] - cum[seg - 1]);
      out.y[o0 + i] = lerp(pts[seg - 1][0], pts[seg][0], t);
      out.z[o0 + i] = lerp(pts[seg - 1][1], pts[seg][1], t);
    }
  };

  rig.pose = ({ open = 0 }) => {
    const o = clamp01(open);
    const total = lerp(maxDrop, n * hmin, o);
    // segments collapse from the bottom up
    const hs = new Float64Array(n);
    let remaining = total;
    for (let k = 0; k < n; k++) {
      const h = clamp(remaining - (n - k - 1) * hmin, hmin, s);
      hs[k] = h;
      remaining -= h;
    }
    // depth of each fold: upper folds hang in front of the lower ones
    const d = new Float64Array(n);
    const e = new Float64Array(n);
    let acc = 0;
    for (let k = n - 1; k >= 0; k--) {
      const slack = s - hs[k];
      d[k] = Math.min(0.032, slack * 0.5);
      e[k] = acc;
      if (slack > 0.002) acc += d[k] + 0.003;
    }
    let ya = yA0;
    const out = { y: ys, z: zs };
    for (let k = 0; k < n; k++) {
      const yb = ya - hs[k];
      foldPoints(ya, yb, d[k], e[k], out, k * PER);
      ya = yb;
    }
    let v = 0;
    vs[0] = 0;
    for (let i = 1; i < rowsN; i++) {
      v += Math.hypot(ys[i] - ys[i - 1], zs[i] - zs[i - 1]);
      vs[i] = v;
    }
    for (const it of items) {
      const pos = it.g.attributes.position.array;
      const uv = it.g.attributes.uv.array;
      for (let r = 0; r < rowsN; r++) {
        for (let cI = 0; cI < 2; cI++) {
          const i = r * 2 + cI;
          pos[i * 3] = cI ? it.x1 : it.x0;
          pos[i * 3 + 1] = ys[r];
          pos[i * 3 + 2] = zs[r];
          uv[i * 2] = cI ? it.x1 : it.x0;
          uv[i * 2 + 1] = -vs[r];
        }
      }
      finishDynamic(it.g);
      it.bar.position.set(it.cx, ya - 0.006, zc + 0.002);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Exterior screen (utvendig screen, zip guides)

function buildExterior(rig) {
  const { fit, spec } = rig;
  const C = spec.colors || {};
  const M = spec.materials || {};
  const T = coveredT(spec);
  const railMat = solid(M.rail || 'black-metal', C.rail || '#1f1f1f', { roughness: 0.5 });
  const hex = C.fabric || '#2f2f2e';
  const zf = -fit.thick - 0.035;
  const casH = 0.11;
  const x0 = fit.x0, x1 = fit.x1;
  const cas = new THREE.Mesh(boxAt(rig, x1 - x0 + 0.02, casH, 0.11, (x0 + x1) / 2, casH / 2 + 0.005, -fit.thick - 0.055, { r: 0.018, grain: 'x' }), railMat);
  cas.castShadow = cas.receiveShadow = true;
  rig.add(cas, 'rail');
  driverMesh(rig, cas);
  const gh = fit.H + 0.005;
  for (const x of [x0 + 0.017, x1 - 0.017]) {
    const g = new THREE.Mesh(boxAt(rig, 0.034, gh, 0.03, x, -gh / 2 + 0.005, zf, { r: 0.004 }), railMat);
    g.castShadow = g.receiveShadow = true;
    rig.add(g, 'rail');
  }
  const fm = fabricMaterial(rig, M.fabric || 'woven', hex, { view: 0.3, glow: 0.05, rect: new THREE.Vector4(-10, -10, -10, -10) });
  const fg = gridGeometry(rig, 2, 2);
  const fabric = new THREE.Mesh(fg, fm);
  castFabric(rig, fabric, T, { force: true });
  rig.add(fabric, 'fabric');
  const bar = new THREE.Mesh(boxAt(rig, x1 - x0 - 0.03, 0.04, 0.03, 0, 0, 0, { r: 0.006, grain: 'x' }), railMat);
  bar.castShadow = true;
  rig.add(bar, 'rail');
  const maxL = fit.H - 0.01;
  rig.pose = ({ open = 0 }) => {
    const l = Math.max(0.01, (1 - clamp01(open)) * maxL);
    setQuad(fg, x0 + 0.03, x1 - 0.03, 0.005, -l, zf, 0);
    bar.position.set((x0 + x1) / 2, -l - 0.015, zf);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// applyShading

const BUILDERS = {
  venetian: buildVenetian,
  roller: (rig) => buildRoller(rig, false),
  'duo-roller': (rig) => buildRoller(rig, true),
  pleated: buildPleated,
  vertical: buildVertical,
  curtain: buildCurtain,
  roman: buildRoman,
  'exterior-screen': buildExterior,
};

/** Everything that needs a rebuild (open/tilt/band/top animate instead). */
function structureKey(info, spec) {
  const rest = { ...spec };
  delete rest.open;
  delete rest.tilt;
  delete rest.params;
  const pr = { ...(spec.params || {}) };
  delete pr.band;
  delete pr.top;
  return JSON.stringify([info.id, info.width, info.height, rest, pr]);
}

function animTarget(spec) {
  const d = DEFS[spec.archetype]?.defaults || {};
  return {
    open: clamp01(num(spec.open, d.open ?? 1)),
    tilt: clamp(num(spec.tilt, d.tilt ?? 0), -90, 90),
    band: clamp01(num(spec.params?.band, 0)),
    top: clamp01(num(spec.params?.top, 0)),
  };
}

function currentQuality() {
  try {
    return mergeSpec(null, {}).quality || 'medium';
  } catch {
    return 'medium';
  }
}

/** Fills in what a product spec leaves out (operation for cordless products …). */
function completeSpec(spec) {
  const d = DEFS[spec.archetype] || DEFS.roller;
  const s = {
    ...spec,
    params: { ...clone(d.defaults.params), ...(spec.params || {}) },
    colors: { ...d.defaults.colors, ...(spec.colors || {}) },
    materials: { ...d.defaults.materials, ...(spec.materials || {}) },
  };
  if (!s.colors.slat && s.colors.fabric) s.colors.slat = s.colors.fabric;
  const product = s.productId ? getProduct(s.productId) : null;
  if (product && spec.params?.operation == null && /snorløs/i.test(`${product.description} ${product.priceNote}`)) s.params.operation = 'cordless';
  if (product && spec.params?.operation == null && /motor/i.test(`${product.name}`)) s.params.operation = 'motor';
  if (s.archetype === 'venetian' && spec.params?.material == null) {
    const k = s.materials.slat;
    s.params.material = ['ash', 'oak', 'walnut', 'teak'].includes(k) ? 'wood' : 'alu';
  }
  return s;
}

/**
 * Builds the shading of a window in windowInfo.anchor and removes the previous one. When only the animated values
 * change (open, tilt, params.band, params.top) the existing model moves smoothly to the new state instead.
 * @param {object} windowInfo  home.windows[] entry (anchor: origin top middle of the opening, x right, −y down, z into the room)
 * @param {object|null} spec   ShadingSpec
 * @returns {{ group: THREE.Group|null, transmission: number }}
 */
export function applyShading(windowInfo, spec) {
  const anchor = windowInfo?.anchor;
  const transmission = shadingTransmission(spec);
  if (!anchor) return { group: null, transmission };
  const old = anchor.userData.shadingRig || null;
  if (!spec || !BUILDERS[spec.archetype]) {
    if (old) removeRig(anchor, old);
    if (anchor.userData.shading && !old) {
      anchor.userData.shading.removeFromParent();
      anchor.userData.shading = null;
    }
    return { group: null, transmission: spec ? transmission : 1 };
  }
  const full = completeSpec(spec);
  const key = structureKey(windowInfo, full);
  const target = animTarget(full);
  if (old && old.key === key) {
    old.spec = full;
    old.setTarget(target);
    return { group: old.group, transmission };
  }
  // carry the current animation state over when the same kind of shading is rebuilt (colour, product …)
  const carry = old && old.spec.archetype === full.archetype && old.fit.mount === computeFit(windowInfo, full).mount ? { ...old.state } : null;
  if (old) removeRig(anchor, old);
  else if (anchor.userData.shading) {
    anchor.userData.shading.removeFromParent();
    anchor.userData.shading = null;
  }
  const fit = computeFit(windowInfo, full);
  const rig = new Rig(windowInfo, full, fit, full.quality || currentQuality());
  rig.key = key;
  rig.anchor = anchor;
  try {
    BUILDERS[full.archetype](rig);
  } catch (err) {
    console.warn('[shading] build failed', windowInfo.id, full.archetype, err);
    rig.dispose();
    return { group: null, transmission };
  }
  rig.state = carry ? { ...target, ...carry } : { ...target };
  rig.target = { ...target };
  rig.wanted = target;
  bindDoor(rig);
  rig.pose(rig.state);
  if (ANIM_KEYS.some((k) => Math.abs((rig.state[k] ?? 0) - (rig.target[k] ?? 0)) > 1e-4)) {
    rig.time = performance.now();
    ACTIVE.add(rig);
  }
  const g = rig.group;
  g.userData.model = { parts: {}, lights: [], surfaces: [] };
  g.traverse((o) => {
    if (o.isMesh && o.userData.part) (g.userData.model.parts[o.userData.part] ||= []).push(o);
  });
  g.userData.shading = { archetype: full.archetype, mount: fit.mount, windowId: windowInfo.id, onLeaf: !!fit.leaf };
  if (fit.leaf) {
    // a door blind hangs on the leaf's pivot (same place as in the anchor while the door is closed) and swings with it
    g.matrixAutoUpdate = false;
    g.matrix.copy(fit.leaf.toPivot);
    fit.leaf.pivot.add(g);
    g.updateMatrixWorld(true);
  } else anchor.add(g);
  anchor.userData.shading = g;
  anchor.userData.shadingRig = rig;
  return { group: g, transmission };
}

function removeRig(anchor, rig) {
  rig.group.removeFromParent();
  rig.dispose();
  anchor.userData.shadingRig = null;
  anchor.userData.shading = null;
}
