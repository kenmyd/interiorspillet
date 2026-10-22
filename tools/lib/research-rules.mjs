/**
 * Research data rules for the møbler/lys/kunst round (runde 3): the one rule set behind tools/check-research.mjs and
 * tools/house-tests/catalog-round.test.mjs (MASTER D20, D36, D38, D46, D50, §2.1–§2.5; catalogdata §4–§6.2; qa §3.4 A).
 *
 * Pure and fast at import: reads src/data/archetypes.json only – no catalogue, no three.js. Things that need the app
 * (registry Def.params, SUBCATEGORY_LABELS, FRAME_OPTIONS/LAYOUT_OPTIONS from models/artlayout.js, motif variants, the
 * frozen catalogue) come in through `ctx` (makeContext imports them with the caller's `imp`) and are all optional.
 *
 *   makeContext({ imp, today })              → ctx for lintProduct/loopProblems (async; a failing import is listed in ctx.missing)
 *   lintFileName(name)                       → findings for the file itself (D50 «*-hele-huset.json»)
 *   lintProduct(src, ctx)                    → findings for one research product (raw, as written); ctx.strict = runde-3 rules
 *   loopProblems(p, ctx)                     → test-design's per-product loop on a NORMALISED product (strings)
 *   keepProblems(src, p, fx)                 → test-design's KEEP comparison research → normalised (strings)
 *   identityKeys(p) / normUrl(u) / skuKeys(p) / claimKeys(p) / makeIndex()   duplicate detection (D36)
 *   artKey(p)                                → «motif|seed|palette» of an art-frame (uniqueness inside kunst)
 *   isStrictFile(name, baseFiles)            → runde-3 rules apply (every file that is not a pre-round catalog-new file)
 *
 * A finding is { level: 'FAIL' | 'WARN', rule, msg } (msg in Norwegian: the research agents read it). Rule ids and
 * what they check are listed in RULES.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Project root (tools/lib → ../..); CR_ROOT overrides it (self-test of a copy outside the repo). */
export const ROOT = process.env.CR_ROOT ? path.resolve(process.env.CR_ROOT) : path.resolve(HERE, '..', '..');
export const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'archetypes.json'), 'utf8'));

/** The round's first day: every runde-3 price note is dated on or after it (qa §3.4 A). */
export const ROUND_START = '2026-10-21';
/** Local calendar date yyyy-mm-dd. */
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Stores (catalogdata §4 `store`, qa §3.4 A STORE_DOMAINS, MASTER §4.4 RF's widened list)

/** store name → id prefix, page domains, image hosts (the store's CDNs). */
export const STORES = Object.freeze({
  Bohus: { prefix: 'bohus', domains: ['bohus.no'], img: ['bohus.no'] },
  IKEA: { prefix: 'ikea', domains: ['ikea.com'], img: ['ikea.com'] },
  Skeidar: { prefix: 'skeidar', domains: ['skeidar.no'], img: ['skeidar.no', 'azurefd.net'] },
  Jysk: { prefix: 'jysk', domains: ['jysk.no'], img: ['jysk.no', 'jysk.com', 'jysk.io'] },
  Fagmøbler: { prefix: 'fagmobler', domains: ['fagmobler.no'], img: ['fagmobler.no', 'imagedelivery.net'] },
  'Nordic Nest': { prefix: 'nordicnest', domains: ['nordicnest.no'], img: ['nordicnest.no', 'nordicnest.com', 'nordicnest.dev'] },
  Lampehuset: { prefix: 'lampehuset', domains: ['lampehuset.no'], img: ['lampehuset.no'] },
  Elektroimportøren: { prefix: 'elektroimportoren', domains: ['elektroimportoren.no'], img: ['elektroimportoren.no'] },
  Lampemesteren: { prefix: 'lampemesteren', domains: ['lampemesteren.no'], img: ['lampemesteren.no', 'lw-cdn.com'] },
  'Clas Ohlson': { prefix: 'clasohlson', domains: ['clasohlson.com'], img: ['clasohlson.com'] },
  Belysningsdirektøren: { prefix: 'belysningsdirektoren', domains: ['belysningsdirektoren.no'], img: ['belysningsdirektoren.no'] },
});
/** Stores that block research (productapis §0): out this round. */
export const BLOCKED_STORES = Object.freeze(['Desenio', 'Posterstore', 'Møbelringen']);
const PREFIX_TO_STORE = Object.fromEntries(Object.entries(STORES).map(([name, s]) => [s.prefix, name]));

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const onDomain = (host, domains) => !!host && domains.some((d) => host === d || host.endsWith(`.${d}`));

// ---------------------------------------------------------------------------------------------------------------
// Where every type lives (MASTER §2.1): category → { subcategory → archetypes }, '' = no subcategory

const FLOOR_LAMPS = Object.keys(SCHEMA.archetypes).filter((a) => a.startsWith('floor-'));
export const SCOPE = Object.freeze({
  sofa: Object.fromEntries(['2-seter', '3-seter', '4-seter', 'hjornesofa', 'sjeselong', 'sovesofa'].map((s) => [s, ['sofa-straight', 'sofa-modular-l', 'sofa-curved']])),
  bord: {
    sofabord: ['coffee-table', 'coffee-table-rect', 'coffee-table-round-nesting'],
    sidebord: ['coffee-table', 'side-table-round', 'side-table-c', 'side-table-nesting'],
    skrivebord: ['desk'],
    konsollbord: ['coffee-table'],
    spisebord: ['dining-table-oval'],
  },
  stoler: {
    spisestol: ['chair', 'dining-chair', 'shell-chair'],
    barkrakk: ['bar-stool', 'stool'],
    krakk: ['stool'],
    kontorstol: ['office-chair'],
    spisebenk: ['bench'],
  },
  tvbenk: { '': ['tv-bench'] },
  vitrineskap: { '': ['display-cabinet'] },
  kommode: { '': ['dresser'] },
  hylle: { bokhylle: ['bookcase'], vegghylle: ['wall-shelf'] },
  nattbord: { vegghengt: ['bedside-table'], '': ['bedside-table', 'coffee-table'] },
  gang: { benk: ['bench'] },
  tekstil: { puff: ['pouf'] },
  smalamper: {
    bordlampe: ['table-shade', 'table-globe', 'table-mushroom', 'table-portable', 'table-dome'],
    arbeidslampe: ['table-task'],
    gulvlampe: FLOOR_LAMPS,
    vegglampe: ['wall-arm', 'wall-sconce'],
  },
  spotter: {
    innfelt: ['downlight'],
    utenpaliggende: ['downlight-surface'],
    takspot: ['spot-ceiling', 'spot-track'],
    skinne: ['spot-track'],
    veggspot: ['spot-wall'],
    bildebelysning: ['picture-light'],
  },
  kunst: { lerret: ['art-frame'], innrammet: ['art-frame'], plakat: ['art-frame'], ramme: ['art-frame'], bildevegg: ['art-set'] },
});
/** Categories the round must not add to (catalogdata §6.2, D50). */
export const CLOSED_CATEGORIES = Object.freeze({ lenestol: 'D50: ingen nye lenestoler (test-design teller dem)', taklampe: 'ingen nye taklamper denne runden' });

// ---------------------------------------------------------------------------------------------------------------
// Light (MASTER §2.5)

export const LIGHT_KINDS = Object.freeze(['downlight', 'spot', 'track', 'wall-spot', 'picture', 'table', 'floor', 'wall', 'pendant']);
export const SPOT_ARCHETYPES = Object.freeze(['downlight', 'downlight-surface', 'spot-ceiling', 'spot-track', 'spot-wall', 'picture-light']);
/** The light kind a product's archetype/subcategory implies (a mismatch is a WARN: light.kind is not read in src/). */
function expectedKind(p) {
  if (p.archetype === 'downlight' || p.archetype === 'downlight-surface') return ['downlight'];
  if (p.archetype === 'spot-ceiling') return ['spot'];
  if (p.archetype === 'spot-track') return p.subcategory === 'takspot' ? ['spot'] : ['track'];
  if (p.archetype === 'spot-wall') return ['wall-spot'];
  if (p.archetype === 'picture-light') return ['picture'];
  if (p.category === 'smalamper') return { bordlampe: ['table'], arbeidslampe: ['table'], gulvlampe: ['floor'], vegglampe: ['wall'] }[p.subcategory] || null;
  return null;
}
const LIGHT_KEY_ORDER = ['lumens', 'colorK', 'dimmable', 'kind', 'bulb'];

// ---------------------------------------------------------------------------------------------------------------
// Art keys (MASTER §2.3; FRAME/LAYOUT keys are re-read from models/artlayout.js by makeContext when it imports)

export const MOTIF_KEYS = Object.freeze([
  'misty-trees', 'abstract', 'landscape', 'botanical', 'line-art', 'photo',
  'bauhaus', 'mid-century', 'cutouts', 'arches', 'sunset', 'moon-phases', 'geometric-lines', 'stripes', 'dots', 'typography', 'wave', 'blobs',
  'line-face', 'kids-animals', 'city-map', 'topo-map',
  'color-field', 'brush-abstract', 'expressionist', 'texture-plaster', 'impression', 'still-life', 'stag', 'botanical-print', 'big-leaf',
  'fruit', 'fjord', 'mountain', 'ocean', 'forest', 'city-night', 'bw-photo', 'northern-lights',
]);
/**
 * What each new motif reads from `motifOpts` (ART §2.4/§2.5): variant keys and text options. The registry's
 * ART_MOTIFS wins once P03 has filled it (makeContext); the 6 legacy motifs read none.
 */
export const MOTIF_SPEC = Object.freeze({
  bauhaus: {}, 'mid-century': {}, cutouts: { variants: ['shapes', 'flower'] }, arches: { variants: ['rainbow', 'doors'] },
  sunset: { variants: ['stripes', 'hills', 'moon', 'boho'] }, 'moon-phases': {}, 'geometric-lines': {},
  stripes: { variants: ['vertical', 'diagonal', 'blocks'] }, dots: { variants: ['grid', 'scatter', 'big'] },
  typography: { opts: ['text', 'subtext'], variants: ['centre', 'bottom', 'block', 'vertical'] }, wave: { variants: ['great', 'seigaiha'] },
  blobs: {}, 'line-face': { variants: ['single', 'kiss', 'front'] },
  'kids-animals': { variants: ['bear', 'fox', 'whale', 'bunny', 'deer', 'cat', 'bird'] }, 'city-map': { opts: ['text', 'subtext'] },
  'topo-map': { opts: ['subtext'] }, 'color-field': {}, 'brush-abstract': { variants: ['diagonal', 'horizon', 'centre'] },
  expressionist: { variants: ['abstract', 'flowers'] }, 'texture-plaster': { variants: ['scrape', 'concrete', 'waves', 'maze', 'dots'] },
  impression: { variants: ['river', 'garden', 'field'] }, 'still-life': { variants: ['vase', 'bottles', 'fruitbowl'] },
  stag: { variants: ['stag', 'reindeer', 'moose'] }, 'botanical-print': { variants: ['ginkgo', 'fern', 'eucalyptus', 'olive', 'monstera', 'poppy'] },
  'big-leaf': { variants: ['palm', 'monstera', 'striped', 'banana'] }, fruit: { variants: ['lemons', 'apples', 'pears', 'chart'] },
  fjord: {}, mountain: {}, ocean: { variants: ['sea', 'beach', 'rocks'] }, forest: { variants: ['mist', 'graphic'] }, 'city-night': {},
  'bw-photo': { variants: ['coast', 'pier', 'forest', 'dunes', 'city'] }, 'northern-lights': {},
});
export const FRAME_KEYS = Object.freeze(['none', 'thin', 'black', 'oak', 'white', 'box', 'floater', 'alu', 'ornate', 'hanger']);
export const LAYOUT_KEYS = Object.freeze(['custom', 'pair-h', 'pair-v', 'triptych', 'row-3', 'row-4', 'grid-2x2', 'grid-2x3', 'grid-2x4', 'grid-3x3',
  'salon-5', 'salon-7', 'salon-9', 'stair', 'ledge']);
const TEXTURES = ['canvas', 'painted', 'relief', 'paper', 'photo'];
const EDGES = ['wrap', 'white', 'dark'];

// ---------------------------------------------------------------------------------------------------------------
// Param contract (MASTER §2.3 new archetypes, §2.4 extensions). Spec: { t: 'enum'|'num'|'bool'|'str'|'hex'|'any'|…, … }

const en = (...o) => ({ t: 'enum', o });
const num = (lo, hi) => ({ t: 'num', r: [lo, hi] });
const int = (lo, hi) => ({ t: 'num', r: [lo, hi], int: true });
const BOOL = { t: 'bool' };
const STR = { t: 'str' };
const HEXV = { t: 'hex' };
const ANY = { t: 'any' };
const POS = { t: 'num', r: [0, 1e6] };
const ARR = { t: 'arr' };
const PALETTE = { t: 'palette' };
const MOTIF_OPTS = { t: 'motifOpts' };

const BEAM = num(10, 120);
const SPOT_HIDDEN = { ip: int(0, 69), driver: en('integrated', 'separate', 'socket'), lumens: num(1, 30000) };
const HEAD = { headShape: en('cylinder', 'cone', 'dome', 'cube'), headD: num(0.04, 0.12), headL: num(0.05, 0.2) };
const MOUNT_H = num(0.05, 2.8);

/**
 * New archetypes: every declared and hidden param; dims = the schema's dimsRange; head = ONE fitting's range
 * (GRID_HEAD_RANGE, a single product is one fitting).
 */
export const CONTRACT = Object.freeze({
  downlight: {
    declared: { shape: en('round', 'square'), trim: en('ring', 'flush'), reflector: en('smooth', 'deep', 'honeycomb'), beamDeg: BEAM, tilt: num(0, 35) },
    hidden: { tiltable: BOOL, aperture: num(0.3, 0.9), cutout: num(0.02, 0.4), recessDepth: num(0.005, 0.3), tiltMax: num(0, 90), lensShape: en('round', 'square'), ...SPOT_HIDDEN },
    dims: { w: [0.05, 7.5], d: [0.05, 7.5], h: [0.005, 0.04] },
    head: { w: [0.05, 0.3], d: [0.05, 0.3], h: [0.005, 0.04] },
  },
  'downlight-surface': {
    declared: { shape: en('round', 'square'), lensDepth: num(0, 0.06), beamDeg: BEAM },
    hidden: { ...SPOT_HIDDEN, plateD: num(0, 0.3), plateH: num(0.004, 0.1) },
    dims: { w: [0.05, 7.5], d: [0.05, 7.5], h: [0.03, 0.3] },
    head: { w: [0.05, 0.25], d: [0.05, 0.25], h: [0.03, 0.3] },
  },
  'spot-ceiling': {
    declared: { ...HEAD, tilt: num(0, 90), beamDeg: BEAM },
    hidden: { ...SPOT_HIDDEN },
    dims: { w: [0.05, 7.5], d: [0.05, 7.5], h: [0.08, 0.4] },
    head: { w: [0.05, 0.2], d: [0.05, 0.2], h: [0.08, 0.4] },
  },
  'spot-track': {
    declared: { heads: int(1, 8), trackShape: en('straight', 'L'), railKind: en('track', 'bar', 'plate'), ...HEAD, tilt: num(0, 90),
      aim: en('parallel', 'alternate', 'fan'), spread: num(0, 120), beamDeg: BEAM },
    hidden: { ...SPOT_HIDDEN, canopyD: num(0, 0.3), canopyH: num(0.008, 0.12), barShape: en('round', 'flat'), railW: num(0.006, 0.12),
      railH: num(0.004, 0.06), stemLen: num(0, 0.4) },
    dims: { w: [0.15, 3.0], d: [0.04, 2.0], h: [0.06, 0.4] },
  },
  'spot-wall': {
    declared: { heads: int(1, 2), layout: en('side', 'updown'), plateShape: en('round', 'square'), ...HEAD, armLen: num(0.02, 0.3),
      tilt: num(0, 180), aimYaw: num(-60, 60), beamDeg: BEAM },
    hidden: { ...SPOT_HIDDEN, powered: en('wired', 'cord'), mountHeight: MOUNT_H, plateD: num(0.04, 0.15) },
    dims: { w: [0.05, 0.4], d: [0.05, 0.5], h: [0.05, 0.4] },
  },
  'picture-light': {
    declared: { headShape: en('bar', 'hood'), armShape: en('straight', 'swan'), tilt: num(0, 75), washH: num(0.2, 1.6), beamDeg: BEAM },
    hidden: { washW: { t: 'num', r: [0.1, 4], nullable: true }, artDepth: num(0, 0.2), powered: en('cord', 'battery', 'wired'), mountHeight: MOUNT_H,
      ip: SPOT_HIDDEN.ip, driver: SPOT_HIDDEN.driver, lumens: SPOT_HIDDEN.lumens, armGap: num(0.02, 1.5) },
    dims: { w: [0.15, 1.5], d: [0.05, 0.5], h: [0.04, 0.5] },
  },
  'coffee-table': {
    declared: {
      topT: num(0.008, 0.06), shape: en('rect', 'rounded', 'soft', 'round', 'oval', 'stadium', 'organic'), cornerR: num(0.005, 0.3),
      edge: en('straight', 'bevel', 'rounded'),
      base: en('legs', 'pedestal', 'drum', 'ribbed', 'panel', 'frame', 'sled', 'x', 'v', 'spider', 'cabinet', 'cross'),
      legStyle: en('square', 'round-taper', 'splayed', 'angled', 'block', 'metal-thin', 'hairpin'), legCount: int(3, 4), legInset: num(0, 0.4),
      legD: num(0.01, 0.12), apron: BOOL, shelf: en('none', 'board', 'slats', 'cane', 'glass'), shelfH: num(0.04, 0.35), drawers: int(0, 4),
      handle: en('none', 'knob', 'bar', 'cutout'), baseInset: num(0, 0.4), tray: BOOL,
    },
    hidden: {
      seed: int(1, 1e6), softness: num(3, 6), waterfall: BOOL, tubeW: POS, frameFloor: ANY, ribPitch: POS, ribDepth: POS, plinthH: POS, drumTaper: ANY,
      drumDrawers: int(0, 3), apronH: POS, drawersBack: ANY, set: { t: 'set' }, fronts: ARR, frontStyle: STR, slidingDoors: ANY, cabinetLegH: POS,
      cabinetLegStyle: STR, hubH: POS, crossL: num(0.1, 1.5), dent: num(0, 0.35), dentAt: num(-6.3, 6.3), vDepth: num(0.05, 1.2),
      trayH: num(0.015, 0.1),
    },
    dims: { w: [0.3, 2.0], d: [0.3, 1.3], h: [0.25, 0.85] },
  },
  desk: {
    declared: {
      topT: num(0.008, 0.06), shape: en('rect', 'rounded', 'stadium'), cornerR: num(0.002, 0.3), edge: en('straight', 'bevel', 'rounded'),
      frame: en('legs', 'u-frame', 'a-frame', 'panel', 'trestle', 'x', 'sit-stand'),
      legStyle: en('square', 'round-taper', 'splayed', 'metal-thin', 'metal-square', 'hairpin'), legD: num(0.012, 0.08), drawers: int(0, 3),
      unit: en('none', 'left', 'right', 'both'), unitFronts: en('drawers:2', 'drawers:3', 'drawers:4', 'door', 'open', 'tambour'),
      unitW: num(0.25, 0.7), unitH: num(0, 0.8), shelf: en('none', 'low', 'under'), modesty: BOOL, hutch: en('none', 'shelf', 'upstand'),
      hutchH: num(0.1, 0.6), handle: en('none', 'knob', 'bar', 'cutout', 'edge'),
    },
    hidden: { frontStyle: STR, legInset: num(0, 0.4), heightMin: num(0.5, 1.4), heightMax: num(0.5, 1.4), topPattern: STR, unitDepth: num(0.2, 0.9), unitLegH: num(0, 0.3), gableStyle: en('framed') },
    dims: { w: [0.6, 2.2], d: [0.35, 0.9], h: [0.6, 1.3] },
  },
  'shell-chair': {
    declared: { shellShape: en('scoop', 'square', 'tub'), arms: BOOL, pad: en('none', 'seat', 'full'),
      legStyle: en('wood-dowel', 'eiffel', 'metal-thin', 'wood-taper', 'sled', 'swivel-star'), seatH: num(0.4, 0.5) },
    hidden: { shellT: num(0.004, 0.015), wireHex: HEXV, legD: num(0.008, 0.06), square: BOOL },
    dims: { w: [0.4, 0.68], d: [0.42, 0.65], h: [0.7, 0.95] },
  },
  stool: {
    declared: { seatShape: en('round', 'square', 'saddle'), seat: en('wood', 'upholstered', 'cushion', 'cord', 'cane'),
      legStyle: en('wood-splayed', 'wood-straight', 'metal-thin', 'hairpin', 'pedestal'), legs: int(3, 4), footrest: en('none', 'ring', 'rungs', 'bar'),
      footrestH: num(0.12, 0.5), back: en('none', 'low', 'spindles', 'shell'), swivel: BOOL },
    hidden: { seatH: num(0.3, 1.0), seatT: num(0.01, 0.15), legD: num(0.008, 0.12), square: BOOL, foot: en('trumpet', 'disc') },
    dims: { w: [0.28, 0.6], d: [0.28, 0.6], h: [0.35, 1.1] },
  },
  'office-chair': {
    declared: { style: en('task', 'executive', 'lounge'), back: en('mesh', 'upholstered', 'shell'), channels: BOOL, headrest: BOOL, lumbar: BOOL,
      arms: en('none', 'fixed', 'adjustable', 'loop'), base: en('castors', 'glides', 'disc'), starArms: int(4, 5), seatH: num(0.4, 0.6), recline: num(0, 20) },
    hidden: { seatW: num(0.36, 0.72), seatD: num(0.36, 0.68) },
    dims: { w: [0.45, 0.8], d: [0.45, 0.8], h: [0.75, 1.35] },
  },
  'table-task': {
    declared: { armShape: en('articulated', 'straight', 'gooseneck', 'banker'), headShape: en('cone', 'dome', 'cylinder', 'banker'),
      baseShape: en('disc', 'square'), tilt: num(0, 80), springs: BOOL, translucent: num(0, 1) },
    hidden: { shadeD: num(0.03, 0.5), shadeH: num(0.02, 0.5), baseD: num(0.03, 0.5), elbowAt: POS, elbowY: num(0, 1), headAt: num(0, 1) },
    dims: { w: [0.1, 0.5], d: [0.12, 0.8], h: [0.2, 0.9] },
  },
  'art-frame': {
    declared: { motif: en(...MOTIF_KEYS), frame: { t: 'frame' }, frameW: num(0.005, 0.08), texture: en(...TEXTURES), mat: BOOL, matW: num(0.015, 0.15),
      matH: num(0.015, 0.15), glass: BOOL, seed: int(1, 20) },
    hidden: { palette: PALETTE, motifOpts: MOTIF_OPTS, depth: num(0.005, 0.1), edge: en(...EDGES), edgeHex: HEXV, matColor: HEXV, imageAspect: num(0.2, 5),
      fit: en('cover', 'contain'), focus: ARR, cord: ANY, acceptsImage: BOOL, frameStyle: STR },
    dims: { w: [0.1, 3.0], d: [0.005, 0.1], h: [0.1, 3.0] },
  },
  'art-set': {
    declared: { layout: { t: 'layout' }, gap: num(0.02, 0.25), frame: { t: 'frame' }, mat: BOOL, glass: BOOL, mirror: BOOL, seed: int(1, 20) },
    hidden: { frames: { t: 'frames' }, motifs: { t: 'motifs' }, motif: en(...MOTIF_KEYS), palette: PALETTE, motifOpts: MOTIF_OPTS, span: ANY,
      frameW: num(0.005, 0.08), matW: num(0.015, 0.15), matH: num(0.015, 0.15), matColor: HEXV, texture: en(...TEXTURES), edge: en(...EDGES), rise: POS, overlap: POS },
    dims: { w: [0.25, 3.6], d: [0.005, 0.12], h: [0.2, 2.4] },
  },
});

/**
 * Extended existing archetypes (§2.4): `add` = enum values added to the builder's options, `declared`/`hidden` = new
 * params (their spec wins), `dims` = the new dimsRange keys. Enum options of an extended archetype = the registry's
 * options ∪ add ∪ the values products of the archetype already use (they build today).
 */
const CABINET_FRONT = { add: { frontStyle: ['fabric'] }, hidden: { slatDir: en('v', 'h'), squareFeet: BOOL, legMaxFrac: num(0.6, 0.95), lowerShelf: num(0, 0.4) } };
export const EXTENSIONS = Object.freeze({
  chair: { add: { legStyle: ['cantilever', 'metal-frame', 'swivel-legs', 'swivel-star', 'swivel-disc'], seat: ['saddle'], back: ['framed-pad'] },
    // armStyle data values are frame|pad|loop; the builder's UI-only 'auto' (follow back and legs) is not a data value (P07)
    declared: { armStyle: en('frame', 'pad', 'loop') }, hidden: { legD: num(0.008, 0.08), panelH: num(0.08, 0.3), splay: BOOL } },
  'bar-stool': { declared: { back: en('shell', 'pad', 'upholstered', 'none'), legStyle: en('slim-metal', 'wood', 'pedestal', 'sled'), arms: BOOL },
    hidden: { square: BOOL }, dims: { h: [0.6, 1.15] } },
  'dining-chair': { declared: { legStyle: en('slim-metal', 'wood-taper', 'block', 'swivel-disc', 'swivel-star') } },
  'sofa-straight': { dims: { h: [0.6, 1.0] }, hidden: { headrest: BOOL, backSplit: BOOL } },
  'sofa-modular-l': { declared: { openEnd: en('none', '-x', '+x'), openEndW: num(0.5, 1.2) }, hidden: { chaiseArm: en('short'), plinthInset: num(0.01, 0.12) } },
  bench: { declared: { back: en('none', 'rail', 'spindles', 'panel', 'upholstered'), arms: BOOL, cubbies: int(0, 4) },
    add: { legStyle: ['trestle', 'x', 'sled', 'hairpin', 'none'] }, hidden: { seatH: num(0.3, 0.85) }, dims: { h: [0.3, 1.0] } },
  pouf: { add: { shape: ['oval'], legs: ['metal', 'block', 'sled'] }, declared: { tufted: BOOL, handle: BOOL, woodTrim: BOOL },
    hidden: { legsOutside: BOOL, legCount: int(3, 6), legRise: num(0, 0.4) } },
  'table-shade': { declared: { shadeShape: en('drum', 'wavy', 'cone', 'pleated', 'empire', 'rect', 'woven', 'lantern', 'dome') },
    add: { baseShape: ['vase', 'cylinder', 'wavy-column', 'disc', 'cone', 'bullet', 'dome', 'stacked-pebbles', 'rect', 'candlestick', 'ball'] },
    hidden: { shadeTopD: POS, shadeDepth: POS, pleats: int(0, 400), openingTopD: POS, openingBottomD: POS } },
  'wall-arm': { add: { shadeShape: ['drum', 'cone', 'globe', 'bell', 'dome'] }, declared: { armShape: en('straight', 'swing', 'curved', 'flex'), plug: BOOL },
    hidden: { armReach: POS, swingDeg: num(-60, 60), shadeUp: BOOL, plateShape: en('disc', 'rect'), shadeD: POS, shadeH: POS, shadeTopD: POS } },
  'wall-sconce': { add: { shadeShape: ['globe', 'updown', 'flush', 'bar', 'shell'] }, hidden: { frontPlate: BOOL, beamDeg: BEAM } },
  'floor-pole-shade': { declared: { baseShape: en('disc', 'cone', 'cylinder', 'bullet', 'vase', 'wavy-column', 'stacked-pebbles', 'rect', 'tripod') } },
  'floor-arc': { add: { shadeShape: ['dome'] }, hidden: { baseShape: en('disc', 'rect', 'block', 'bullet'), baseH: num(0.01, 0.6) } },
  'floor-reading': { add: { headShape: ['cylinder'] } },
  'wall-shelf': { add: { style: ['box'] }, declared: { cols: int(1, 6), rows: int(1, 5) },
    hidden: { backPanel: BOOL, battenCount: int(2, 5), rails: int(0, 8), hooks: int(0, 10) } },
  sideboard: CABINET_FRONT,
  'tv-bench': CABINET_FRONT,
  dresser: CABINET_FRONT,
  'bedside-table': CABINET_FRONT,
});

/** Param keys research must not write (§2.4 «Not available», D3, D18, catalogdata names RF must translate). */
const SPOT_CAT_NAMES = ['install', 'trimD', 'holeD', 'installDepth', 'bodyH', 'lens', 'len', 'barW', 'armReach'];
export const FORBIDDEN_KEYS = Object.freeze({
  '*': { innerW: 'D18: ingen innerW/innerH', innerH: 'D18: ingen innerW/innerH', imageId: 'D18: ingen imageId i katalogdata', notes: 'ingen params.notes (catalogdata §6.2)',
    gridRows: 'D3: produkter setter aldri grid*', gridCols: 'D3: produkter setter aldri grid*', gridDx: 'D3: produkter setter aldri grid*', gridDz: 'D3: produkter setter aldri grid*' },
  bench: { backH: '§2.4: bench.backH finnes ikke' },
  'side-table-round': { base: '§2.4: side-table-round har ingen base', shelf: '§2.4: side-table-round har ingen shelf', tray: '§2.4: side-table-round har ingen tray' },
  'wall-arm': { cord: '§2.4: wall-arm.cord finnes ikke (bruk plug)' },
  'floor-pole-shade': { heads: '§2.4: floor-pole-shade.heads finnes ikke' },
  'coffee-table': { tables: '§2.4: bruk set, ikke tables', legW: '§2.4: bruk legD, ikke legW' },
  ...Object.fromEntries(SPOT_ARCHETYPES.map((a) => [a, Object.fromEntries(SPOT_CAT_NAMES
    .map((k) => [k, `MASTER §4.4 RF: catalogdata-navnet «${k}» oversettes (trimD → dims.w/d, holeD → cutout, installDepth → recessDepth, bodyH → dims.h, lens → reflector, armReach → dims.d, len/barW → dims.w)`]))])),
});

/** Params every product of a mount may carry (D7). */
const UNIVERSAL_HIDDEN = { wall: { mountHeight: MOUNT_H } };

// ---------------------------------------------------------------------------------------------------------------
// Product shape (catalogdata §4)

export const TOP_KEYS = Object.freeze(['id', 'category', 'subcategory', 'name', 'brand', 'store', 'url', 'priceNok', 'salePriceNok', 'priceNote',
  'priceConfidence', 'dims', 'archetype', 'mount', 'params', 'variants', 'defaultVariant', 'absorption', 'absorptionNote', 'light', 'packSize',
  'packPriceNok', 'requiredExtras', 'shippingNok', 'shapeNote', 'description', 'why', 'imageUrl', 'verified', 'verifiedNote']);
export const VARIANT_KEYS = Object.freeze(['name', 'colors', 'materials', 'url', 'priceNok', 'salePriceNok', 'priceConfidence', 'paramsOverride', 'imageUrl']);
const MATERIALS = new Set(Object.values(SCHEMA.materials).flat());
const MOUNTS = ['floor', 'wall', 'ceiling', 'surface', 'soft', 'rug', 'window'];
const HEX = /^#[0-9a-f]{6}$/;
const NUMERIC = /^\s*-?\d+(?:[.,]\d+)?\s*$/; // normalize-data.mjs numbersAreNumbers
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /\b(20\d\d-[01]\d-[0-3]\d)\b/;
const BAD_VARIANT = /utgående|\(tilbud\)|egen farge/i;
/** The check date of a note: the date after «sjekket» / «Bekreftet på …», else the first date in it. */
function noteDate(note, lead) {
  const s = String(note || '');
  return lead.exec(s)?.[1] || DATE.exec(s)?.[1] || null;
}
const PRICE_DATE = /sjekket\D{0,40}?(20\d\d-[01]\d-[0-3]\d)/i;
const VERIFIED_DATE = /bekreftet\D{0,60}?(20\d\d-[01]\d-[0-3]\d)/i;

/** Archetypes one builder serves (tables.js buildCabinet): a param one of them declares or uses is read by all. */
const BUILDER_GROUPS = [['sideboard', 'tv-bench', 'dresser', 'bedside-table', 'shoe-cabinet']];
const groupOf = (a) => BUILDER_GROUPS.find((g) => g.includes(a)) || [a];

/**
 * Parts every variant must name: the family's parts plus the archetype's (MASTER §2.2); the bed and fixture families
 * keep only the parts their archetype lists (normalize-data onlyParts).
 */
export function requiredParts(archetype) {
  const a = SCHEMA.archetypes[archetype];
  if (!a) return [];
  const fam = SCHEMA.families[a.family] || { parts: [] };
  if (['bed', 'fixture'].includes(a.family) && Array.isArray(a.parts)) return [...a.parts];
  return [...new Set([...fam.parts, ...(a.parts || [])])];
}
function allowedParts(archetype) {
  const a = SCHEMA.archetypes[archetype];
  if (!a) return new Set();
  const fam = SCHEMA.families[a.family] || { parts: [], optionalParts: [] };
  return new Set([...(a.parts || []), ...fam.parts, ...(fam.optionalParts || [])]);
}
const mountsOf = (archetype) => {
  const a = SCHEMA.archetypes[archetype];
  return a ? (Array.isArray(a.mounts) ? a.mounts : [a.mount]) : [];
};

/** Folded text the catalogue search indexes (catalog/index.js SEARCH_INDEX + fold; labels from ctx when loaded). */
export function foldText(p, ctx = {}) {
  const labels = ctx.labels || {};
  return [p.name, p.brand, p.store, p.subcategory, labels[p.subcategory], ctx.categoryLabel?.(p.category), SCHEMA.archetypes[p.archetype]?.label,
    p.description, p.why, ...(Array.isArray(p.variants) ? p.variants.map((v) => v?.name) : [])]
    .filter((x) => typeof x === 'string').join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9æøå]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------------
// The rules

/** Rule ids → one-line description (printed by check-research --rules and listed in the report). */
export const RULES = Object.freeze({
  'json': 'FAIL: the file is a JSON array of objects (parse errors with position)',
  'file-name': 'FAIL D50: a research file is never named *-hele-huset.json',
  'shape': 'FAIL: id slug, variants array with colors/materials objects, explicit mount and integer defaultVariant',
  'numeric-string': 'FAIL: no numeric strings anywhere (the normaliser turns them into numbers → KEEP breaks)',
  'dims': 'FAIL D38: dims w, d, h are numbers, 0.005 ≤ x ≤ 6, ≤ 4 decimals',
  'parts': 'FAIL: lowercase #rrggbb + a valid material (no aliases) for every family part in every variant; no foreign parts',
  'variant-names': 'FAIL D50: variant names present, trimmed, unique, without «utgående» / «(tilbud)» / «egen farge»',
  'name-decimal': 'FAIL D50: no dotted decimal in the name («H24.4» → «H24,4»)',
  'motif-text': 'FAIL D50: motifOpts.text is never purely numeric',
  'vitrine-absorption': 'FAIL D50: vitrineskap absorption is exactly 0',
  'archetype': 'FAIL: archetype is a real archetypes.json id (no alias); mount is the archetype mount or one of its mounts',
  'normalise': 'FAIL: normalize-data.mjs --catalog-new=<tmp> --out=<tmp> runs and keeps the product (unknown category/archetype throws); WARN normaliser notes on the product',
  'loop': 'FAIL: test-design per-product loop on the normalised product (archetype, mount, dims, numbers, parts, productToItemSpec, light)',
  'keep': 'FAIL: test-design KEEP – the normalised product equals the research product field by field (fixes.mjs honoured)',
  'duplicate': 'FAIL D36: id, url (incl. variant urls) and store SKU unique across src/data/catalog, research/catalog-new, research/runde3 and the files under test (WARN for pre-round files)',
  'keys': 'FAIL: only catalogdata §4 top-level keys, no _keys; WARN unknown variant keys, > 6 variants, priceFromNok, params.shapeNote',
  'store': 'FAIL: store in the list, id prefix of the store, not a blocked store (Desenio, Posterstore, Møbelringen)',
  'scope': 'FAIL: category/subcategory/archetype per MASTER §2.1; no new lenestol/taklampe; subcategory has a label; WARN per-type hints',
  'secto': 'FAIL D50: no «secto»/«octo» in the searchable text',
  'url': 'FAIL: https product page on the store domain (no search page); variant urls on the same domain',
  'image': 'FAIL: https imageUrl (and variant imageUrls); WARN host outside the store domain/CDN allow-list',
  'price': 'FAIL: priceNok > 0; salePriceNok < priceNok or omitted (no null); variant prices; pack: priceNok = packPriceNok / packSize; requiredExtras with a real price',
  'date': 'FAIL: priceNote dated 2026-10-21 ≤ d ≤ today («Pris sjekket <dato>»)',
  'confidence': 'FAIL: priceConfidence checked|check, never estimate (verified ⇒ checked)',
  'verified': 'FAIL: verified boolean; true ⇒ verifiedNote dated 2026-10-21 ≤ d ≤ today, not «IKKE verifisert»; false ⇒ «IKKE verifisert …»; WARN verified false',
  'texts': 'FAIL: name, brand, description, why, verifiedNote non-empty; WARN > 240 characters, poster/frame wording',
  'params': 'FAIL: contract enum/number/type for new and extended archetypes (MASTER §2.3/§2.4), declared numbers in range, forbidden keys (aliases of catalogdata names, grid*, imageId, innerW/H, notes); WARN unknown keys, enum values of other archetypes outside Def + catalogue',
  'dims-range': 'FAIL: dims outside the DesignState clamp band of dimsRange (0.5·min … 1.6·max); WARN outside dimsRange / one fitting (GRID_HEAD_RANGE)',
  'light': 'FAIL: lamps and spotter have light { lumens > 0, colorK 1800–6500, kind ∈ §2.5 }; spotter lumens 100–4000; WARN key order, unknown keys, kind vs archetype, missing dimmable/bulb',
  'spot': 'FAIL: spotter mount = archetype mount; takspot spot-track uses railKind plate|bar; spotter wall fittings have params.mountHeight; WARN other wall items without mountHeight, tilt without tiltable',
  'art': 'FAIL: motif ∈ 39 keys (not custom), frame ∈ FRAME_OPTIONS, layout ∈ LAYOUT_OPTIONS, palette 3–6 hex with colors.print = palette[1], no imageId, acceptsImage ⇔ ramme, depth = dims.d, posters unframed paper 5 mm, bildevegg = art-set; WARN motifOpts the motif does not read, duplicate motif+seed+palette',
  'decor': 'WARN D46: new hylle/tvbenk products of a decor archetype write decor:false, vitrineskap decor:true',
  'absorption': 'FAIL: absorption is a number ≥ 0; WARN far from catalogdata §5.7',
  'claims': 'WARN: no claim directory <store>-<sku-or-slug> for the product (--claims)',
  'build': 'FAIL: the builder throws (archetypes with a builder); WARN no builder yet (stub), bbox vs dims ±20 %, lamp without lights, builder warnings; SKIP canvas-only errors',
});

const F = (rule, msg) => ({ level: 'FAIL', rule, msg });
const W = (rule, msg) => ({ level: 'WARN', rule, msg });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const show = (v) => (typeof v === 'string' ? `«${v}»` : JSON.stringify(v));
const decimals = (x) => {
  const s = String(x);
  if (/e-/i.test(s)) return 99;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

/** File-level findings (D50). */
export function lintFileName(name) {
  return /-hele-huset\.json$/i.test(path.basename(name)) ? [F('file-name', `filnavnet ${path.basename(name)} er reservert (test-design teller *-hele-huset.json)`)] : [];
}

/** Runde-3 rules apply to every file except the pre-round research/catalog-new files (fixture list `researchNewFiles`). */
export function isStrictFile(name, baseFiles = []) {
  return !baseFiles.includes(path.basename(name));
}

/** Walks every string in a value: cb(path, string). */
function walkStrings(v, at, cb) {
  if (typeof v === 'string') cb(at, v);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${at}[${i}]`, cb));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, at ? `${at}.${k}` : k, cb);
}

/**
 * Universal checks (every file, also the pre-round ones): what the normaliser and test-design need.
 * @returns {Array<{level, rule, msg}>}
 */
function lintUniversal(src, out) {
  if (!isObj(src)) {
    out.push(F('shape', 'produktet er ikke et objekt'));
    return false;
  }
  if (typeof src.id !== 'string' || !ID.test(src.id)) out.push(F('shape', `id ${show(src.id)} er ikke en slug [a-z0-9-] (normaliseringen endrer den)`));
  if (!Array.isArray(src.variants) || !src.variants.length) {
    out.push(F('shape', 'variants mangler eller er tom (test-design krasjer)'));
    return false;
  }
  src.variants.forEach((v, i) => {
    if (!isObj(v) || !isObj(v.colors) || !isObj(v.materials)) out.push(F('shape', `variants[${i}] mangler colors/materials-objekter`));
  });
  if (!Number.isInteger(src.defaultVariant) || src.defaultVariant < 0 || src.defaultVariant >= src.variants.length) out.push(F('shape', `defaultVariant ${show(src.defaultVariant)} er ikke en gyldig indeks`));
  // numeric strings anywhere (numbersAreNumbers runs over the whole product; variant names are kept as strings)
  walkStrings(src, '', (at, s) => {
    if (/^variants\[\d+\]\.name$/.test(at)) return;
    if (NUMERIC.test(s)) out.push(F('numeric-string', `${at} = ${show(s)} er en talltekst – normaliseringen gjør den til et tall (skriv tallet uten anførselstegn)`));
  });
  // archetype / mount
  const a = SCHEMA.archetypes[src.archetype];
  if (!a) out.push(F('archetype', `archetype ${show(src.archetype)} finnes ikke i archetypes.json${SCHEMA.archetypeAliases[src.archetype] ? ` (alias for ${SCHEMA.archetypeAliases[src.archetype]} – skriv det)` : ''}`));
  if (src.mount == null) out.push(F('archetype', 'mount mangler (skriv den eksplisitt)'));
  else if (a && !mountsOf(src.archetype).includes(src.mount) && !(src.archetype === 'vase' && src.mount === 'floor')) out.push(F('archetype', `mount ${show(src.mount)} passer ikke til ${src.archetype} (${mountsOf(src.archetype).join('|')})`));
  // dims (D38)
  if (!isObj(src.dims)) out.push(F('dims', 'dims mangler'));
  else {
    for (const k of ['w', 'd', 'h']) {
      const x = src.dims[k];
      if (!isNum(x)) out.push(F('dims', `dims.${k} = ${show(x)} er ikke et tall`));
      else if (x < 0.005 || x > 6) out.push(F('dims', `dims.${k} = ${x} m er utenfor 0,005–6 m (meter!)`));
      else if (decimals(x) > 4) out.push(F('dims', `dims.${k} = ${x} har mer enn 4 desimaler (normaliseringen runder)`));
    }
  }
  // parts: hex + material for every given part; foreign part keys
  const allowed = allowedParts(src.archetype);
  src.variants.forEach((v, i) => {
    if (!isObj(v?.colors) || !isObj(v?.materials)) return;
    for (const [part, hex] of Object.entries(v.colors)) {
      if (!HEX.test(String(hex))) out.push(F('parts', `variants[${i}].colors.${part} = ${show(hex)} er ikke #rrggbb med små bokstaver`));
      if (a && !allowed.has(part)) out.push(F('parts', `variants[${i}]: «${part}» er ikke en del av ${src.archetype} (${[...allowed].join(', ')})`));
    }
    for (const [part, m] of Object.entries(v.materials)) {
      if (!MATERIALS.has(m)) out.push(F('parts', `variants[${i}].materials.${part} = ${show(m)} er ikke et materiale i archetypes.json${SCHEMA.materialAliases?.[m] ? ` (alias for ${SCHEMA.materialAliases[m]})` : ''}`));
      if (!(part in v.colors)) out.push(F('parts', `variants[${i}].materials.${part} uten farge`));
    }
    for (const part of Object.keys(v.colors)) if (!(part in v.materials)) out.push(F('parts', `variants[${i}].colors.${part} uten materiale`));
  });
  // variant names (D50 / test-design l.340)
  const names = src.variants.map((v) => v?.name);
  names.forEach((n, i) => {
    if (typeof n !== 'string' || !n.trim()) out.push(F('variant-names', `variants[${i}].name mangler`));
    else {
      if (n !== n.trim()) out.push(F('variant-names', `variants[${i}].name ${show(n)} har mellomrom i kanten`));
      if (BAD_VARIANT.test(n)) out.push(F('variant-names', `variants[${i}].name ${show(n)} inneholder «utgående» / «(tilbud)» / «egen farge»`));
    }
  });
  if (new Set(names).size !== names.length) out.push(F('variant-names', 'to varianter har samme navn'));
  // D50 hazards that hold for every file
  if (typeof src.name === 'string' && /\d\.\d/.test(src.name)) out.push(F('name-decimal', `navnet ${show(src.name)} har desimalpunktum – skriv desimalkomma (fixes.mjs endrer det, KEEP brytes)`));
  for (const [where, mo] of motifOptsOf(src)) {
    if (isObj(mo) && typeof mo.text === 'string' && NUMERIC.test(mo.text)) out.push(F('motif-text', `${where}.text ${show(mo.text)} er bare et tall`));
  }
  if (src.category === 'vitrineskap' && src.absorption !== 0) out.push(F('vitrine-absorption', `vitrineskap absorberer nøyaktig 0 (har ${show(src.absorption)})`));
  return true;
}

/** Every motifOpts object of a product (params, variant paramsOverride, art-set frames/motifs). */
function motifOptsOf(src) {
  const out = [];
  const scan = (P, at) => {
    if (!isObj(P)) return;
    if ('motifOpts' in P) out.push([`${at}.motifOpts`, P.motifOpts]);
    for (const list of ['frames', 'motifs']) if (Array.isArray(P[list])) P[list].forEach((f, i) => isObj(f) && 'motifOpts' in f && out.push([`${at}.${list}[${i}].motifOpts`, f.motifOpts]));
  };
  scan(src.params, 'params');
  (src.variants || []).forEach((v, i) => scan(v?.paramsOverride, `variants[${i}].paramsOverride`));
  return out;
}

/**
 * Context for the strict rules (all optional): built by makeContext() in check-research, or by a test.
 * @typedef {{ strict?: boolean, today?: string, defs?: object, labels?: object, categoryLabel?: Function, frameKeys?: string[], layoutKeys?: string[],
 *   motifSpec?: Object<string, { variants: string[], opts: string[] }>, knownKeys?: Map<string, Set<string>>,
 *   usedEnums?: Map<string, Map<string, Set<string>>>, productToItemSpec?: Function }} Ctx
 */

/**
 * Lints one research product as written (before normalisation).
 * @param {object} src
 * @param {Ctx} ctx
 * @returns {Array<{level, rule, msg}>}
 */
export function lintProduct(src, ctx = {}) {
  const out = [];
  if (!lintUniversal(src, out) || !ctx.strict) return out;
  const day = ctx.today || today();
  const a = SCHEMA.archetypes[src.archetype];

  // top-level keys
  for (const k of Object.keys(src)) {
    if (k.startsWith('_')) out.push(F('keys', `nøkkelen ${k} (ingen _-nøkler)`));
    else if (k === 'priceFromNok') out.push(W('keys', 'priceFromNok: nye produkter har en ekte pris'));
    else if (!TOP_KEYS.includes(k)) out.push(F('keys', `ukjent nøkkel ${k} (catalogdata §4: ingen andre nøkler)`));
  }
  // (lintUniversal FAILed non-object variants already; every later loop reads them as {})
  const variants = src.variants.map((v) => (isObj(v) ? v : {}));
  variants.forEach((v, i) => {
    for (const k of Object.keys(v)) {
      if (k.startsWith('_')) out.push(F('keys', `variants[${i}].${k} (ingen _-nøkler)`));
      else if (!VARIANT_KEYS.includes(k)) out.push(W('keys', `variants[${i}].${k} er ikke en variantnøkkel (${VARIANT_KEYS.join(', ')})`));
    }
  });
  if (src.variants.length > 6) out.push(W('keys', `${src.variants.length} varianter (maks 6)`));

  // store, id prefix
  const store = STORES[src.store];
  if (BLOCKED_STORES.includes(src.store)) out.push(F('store', `${src.store} er utelatt denne runden`));
  else if (!store) out.push(F('store', `butikken ${show(src.store)} er ikke i listen (${Object.keys(STORES).join(', ')})`));
  else if (typeof src.id === 'string' && !src.id.startsWith(`${store.prefix}-`)) out.push(F('store', `id må begynne med «${store.prefix}-»`));
  if (store && typeof src.id === 'string') {
    const pre = src.id.split('-')[0];
    if (PREFIX_TO_STORE[pre] && PREFIX_TO_STORE[pre] !== src.store) out.push(F('store', `id-prefikset ${pre} hører til ${PREFIX_TO_STORE[pre]}, ikke ${src.store}`));
  }

  // scope (§2.1)
  lintScope(src, ctx, out);

  // D50 text hazards
  const text = foldText(src, ctx);
  if (/secto|octo/.test(text)) out.push(F('secto', 'teksten inneholder «secto» eller «octo» (test-design teller søket)'));

  // urls / images
  const page = hostOf(src.url);
  if (typeof src.url !== 'string' || !/^https:\/\//.test(src.url) || !page) out.push(F('url', `url ${show(src.url)} er ikke en https-adresse`));
  else {
    if (store && !onDomain(page, store.domains)) out.push(F('url', `url-verten ${page} er ikke ${src.store} (${store.domains.join(', ')})`));
    if (/[?&]q=|\/search\b|\/sok\b|\/søk\b/i.test(src.url)) out.push(F('url', 'url er en søkeside, ikke produktsiden'));
  }
  variants.forEach((v, i) => {
    if (v.url == null) return;
    const h = hostOf(v.url);
    if (typeof v.url !== 'string' || !/^https:\/\//.test(v.url) || !h) out.push(F('url', `variants[${i}].url ${show(v.url)} er ikke https`));
    else if (store && !onDomain(h, store.domains)) out.push(F('url', `variants[${i}].url er ikke på ${store.domains[0]}`));
    else if (/[?&]q=|\/search\b|\/sok\b|\/søk\b/i.test(v.url)) out.push(F('url', `variants[${i}].url er en søkeside, ikke produktsiden`));
  });
  const imgs = [['imageUrl', src.imageUrl], ...variants.map((v, i) => [`variants[${i}].imageUrl`, v.imageUrl]).filter(([, u]) => u != null)];
  for (const [at, u] of imgs) {
    const h = hostOf(u);
    if (typeof u !== 'string' || !/^https:\/\//.test(u) || !h) out.push(F('image', `${at} ${show(u)} er ikke en https-adresse`));
    else if (store && !onDomain(h, [...store.domains, ...store.img])) out.push(W('image', `${at}: verten ${h} er ikke ${src.store}s egen CDN (sjekk at bildet er butikkens)`));
  }

  // price
  const priceOk = isNum(src.priceNok) && src.priceNok > 0;
  if (!priceOk) out.push(F('price', `priceNok ${show(src.priceNok)} er ikke et tall > 0`));
  if ('salePriceNok' in src) {
    if (!isNum(src.salePriceNok)) out.push(F('price', `salePriceNok ${show(src.salePriceNok)}: utelat feltet når det ikke er kampanje (ingen null)`));
    else if (priceOk && !(src.salePriceNok < src.priceNok)) out.push(F('price', `salePriceNok ${src.salePriceNok} er ikke lavere enn priceNok ${src.priceNok}`));
  }
  variants.forEach((v, i) => {
    if ('priceNok' in v && !(isNum(v.priceNok) && v.priceNok > 0)) out.push(F('price', `variants[${i}].priceNok ${show(v.priceNok)} er ikke et tall > 0`));
    if ('salePriceNok' in v) {
      const list = isNum(v.priceNok) ? v.priceNok : src.priceNok;
      if (!isNum(v.salePriceNok) || !(v.salePriceNok < list)) out.push(F('price', `variants[${i}].salePriceNok ${show(v.salePriceNok)} er ikke lavere enn ${list}`));
    }
    if ('priceConfidence' in v && !['checked', 'check'].includes(v.priceConfidence)) out.push(F('confidence', `variants[${i}].priceConfidence ${show(v.priceConfidence)}`));
  });
  if ('packSize' in src || 'packPriceNok' in src) {
    if (!Number.isInteger(src.packSize) || src.packSize < 2) out.push(F('price', `packSize ${show(src.packSize)} må være et heltall ≥ 2`));
    else if (!isNum(src.packPriceNok) || src.packPriceNok <= 0) out.push(F('price', `packPriceNok ${show(src.packPriceNok)} mangler (pakkeprisen)`));
    else if (priceOk && Math.abs(src.priceNok - Math.round((src.packPriceNok / src.packSize) * 100) / 100) > 0.011) {
      out.push(F('price', `priceNok ${src.priceNok} er ikke pakkepris/antall = ${Math.round((src.packPriceNok / src.packSize) * 100) / 100}`));
    }
  }
  if ('requiredExtras' in src) {
    if (!Array.isArray(src.requiredExtras) || src.requiredExtras.some((x) => !isObj(x) || typeof x.name !== 'string' || !(isNum(x.priceNok) && x.priceNok > 0))) {
      out.push(F('price', 'requiredExtras: [{ name, priceNok (ekte pris), store, perUnit }]'));
    }
  }
  if ('shippingNok' in src && !isNum(src.shippingNok)) out.push(F('price', 'shippingNok er ikke et tall'));

  // date + confidence + verified (qa §3.4 A honesty)
  const pd = noteDate(src.priceNote, PRICE_DATE);
  if (typeof src.priceNote !== 'string' || !src.priceNote.trim()) out.push(F('date', 'priceNote mangler'));
  else if (!pd) out.push(F('date', 'priceNote har ingen dato («Pris sjekket 2026-10-21 på produktsiden …»)'));
  else if (pd < ROUND_START || pd > day) out.push(F('date', `priceNote-datoen ${pd} er ikke mellom ${ROUND_START} og ${day}`));
  if (!['checked', 'check'].includes(src.priceConfidence)) out.push(F('confidence', `priceConfidence ${show(src.priceConfidence)} (checked eller check; nye produkter er aldri estimate)`));
  if (typeof src.verified !== 'boolean') out.push(F('verified', `verified ${show(src.verified)} er ikke true/false`));
  else if (src.verified) {
    if (src.priceConfidence !== 'checked') out.push(F('verified', 'verified: true krever priceConfidence «checked» (lest på produktsiden)'));
    const vd = noteDate(src.verifiedNote, VERIFIED_DATE);
    if (!vd) out.push(F('verified', 'verified: true krever en dato i verifiedNote («Bekreftet på <domene> <dato> …»)'));
    else if (vd < ROUND_START || vd > day) out.push(F('verified', `verifiedNote-datoen ${vd} er ikke mellom ${ROUND_START} og ${day}`));
    if (/^\s*IKKE verifisert/i.test(String(src.verifiedNote || ''))) out.push(F('verified', 'verified: true, men verifiedNote sier «IKKE verifisert»'));
  } else {
    if (!/^IKKE verifisert/.test(String(src.verifiedNote || ''))) out.push(F('verified', 'verified: false krever at verifiedNote begynner med «IKKE verifisert: mangler …»'));
    out.push(W('verified', 'verified: false'));
  }

  // texts
  for (const k of ['name', 'brand', 'description', 'why', 'verifiedNote']) {
    if (typeof src[k] !== 'string' || !src[k].trim()) out.push(F('texts', `${k} mangler`));
  }
  for (const k of ['description', 'why']) if (typeof src[k] === 'string' && src[k].length > 240) out.push(W('texts', `${k} er ${src[k].length} tegn (maks 240)`));

  // every family part in every variant (§2.2)
  const req = requiredParts(src.archetype);
  variants.forEach((v, i) => {
    const miss = req.filter((part) => !isObj(v.colors) || !(part in v.colors));
    if (miss.length) out.push(F('parts', `variants[${i}] mangler delene ${miss.join(', ')} (alle familiedeler i hver variant)`));
  });

  // params
  if (src.params != null && !isObj(src.params)) out.push(F('params', 'params er ikke et objekt'));
  else if (a) {
    lintParams(src, src.params || {}, 'params', ctx, out);
    variants.forEach((v, i) => {
      if (v.paramsOverride != null) {
        if (!isObj(v.paramsOverride)) out.push(F('params', `variants[${i}].paramsOverride er ikke et objekt`));
        else lintParams(src, v.paramsOverride, `variants[${i}].paramsOverride`, ctx, out);
      }
    });
    lintDimsRange(src, ctx, out);
  }
  if (isObj(src.params) && 'shapeNote' in src.params) out.push(W('keys', 'shapeNote hører hjemme på toppnivå, ikke i params'));

  // light, spotter, art, decor, absorption
  lintLight(src, out);
  lintSpot(src, out);
  if (src.archetype === 'art-frame' || src.archetype === 'art-set') lintArt({ ...src, variants }, ctx, out);
  lintDecor(src, ctx, out);
  lintAbsorption(src, out);
  return out;
}

function lintScope(src, ctx, out) {
  const cat = src.category;
  if (CLOSED_CATEGORIES[cat]) {
    out.push(F('scope', `kategori ${cat}: ${CLOSED_CATEGORIES[cat]}`));
    return;
  }
  const table = SCOPE[cat];
  if (!table) {
    out.push(F('scope', `kategori ${show(cat)} er ikke med i runde 3 (${Object.keys(SCOPE).join(', ')})`));
    return;
  }
  const sub = src.subcategory ?? '';
  if (src.subcategory != null && (typeof src.subcategory !== 'string' || !src.subcategory)) out.push(F('scope', `subcategory ${show(src.subcategory)}: utelat feltet i stedet`));
  const allowed = table[sub];
  if (!allowed) {
    const subs = Object.keys(table).map((s) => s || '(ingen)').join(', ');
    out.push(F('scope', `subcategory ${sub ? show(sub) : '(ingen)'} passer ikke i ${cat} (${subs})`));
    return;
  }
  if (!allowed.includes(src.archetype)) out.push(F('scope', `${cat}/${sub || '(ingen)'} bruker ${allowed.join(' | ')}, ikke ${show(src.archetype)}`));
  if (sub && ctx.labels && !ctx.labels[sub]) out.push(F('scope', `subcategory ${sub} har ingen etikett i SUBCATEGORY_LABELS`));
  // per-type hints
  const P = isObj(src.params) ? src.params : {};
  if (cat === 'nattbord' && src.archetype === 'coffee-table' && (P.shape !== 'round' || P.base !== 'drum')) out.push(W('scope', 'runde nattbord: coffee-table med shape:\'round\', base:\'drum\''));
  if (cat === 'nattbord' && sub === 'vegghengt' && P.base !== 'wall') out.push(W('scope', 'vegghengt nattbord: params.base \'wall\' + mountHeight'));
  if (sub === 'barkrakk' && src.archetype === 'stool' && isNum(src.dims?.h) && src.dims.h < 0.6) out.push(W('scope', 'barkrakk som stool: sete ≥ 0,6 m'));
}

/** The spec of one param for an archetype (contract, extension, registry Def), or null. */
function paramSpec(archetype, key, ctx) {
  const c = CONTRACT[archetype];
  if (c) return c.declared[key] || c.hidden[key] || null;
  const x = EXTENSIONS[archetype];
  if (x?.declared?.[key]) return x.declared[key];
  if (x?.hidden?.[key]) return x.hidden[key];
  const used = [...(ctx.usedEnums?.get(archetype)?.get(key) || [])];
  // the archetype's own Def first, else a sibling's that the same builder serves (buildCabinet reads every cabinet param)
  const d = ctx.defs?.[archetype]?.params?.[key] || groupOf(archetype).map((g) => ctx.defs?.[g]?.params?.[key]).find(Boolean);
  if (!d) {
    // a value list §2.4 adds to a param the Def does not declare (hidden today): the additions + what builds today
    if (x?.add?.[key]) {
      const dflt = ctx.defs?.[archetype]?.defaults?.params?.[key];
      return { t: 'enum', o: [...new Set([...x.add[key], ...used, ...(typeof dflt === 'string' ? [dflt] : [])])], fromDef: true };
    }
    return null;
  }
  if (d.type === 'enum') {
    const o = (d.options || []).map((opt) => (Array.isArray(opt) ? opt[0] : opt));
    return { t: 'enum', o: [...new Set([...o, ...(x?.add?.[key] || []), ...used])], fromDef: true };
  }
  if (d.type === 'number') return { t: 'num', r: [d.min ?? -1e9, d.max ?? 1e9], fromDef: true };
  if (d.type === 'bool') return { t: 'bool', fromDef: true };
  if (d.type === 'color') return { t: 'hex', fromDef: true };
  return { t: 'any', fromDef: true };
}

/**
 * Levels: every contract param of a new or extended archetype (MASTER §2.3/§2.4) and every declared number (the
 * Inspector slider range) is a FAIL; an enum value of an archetype the round does not extend outside its Def options
 * plus the values the frozen catalogue already uses is a WARN (hidden values may build); unknown keys are a WARN.
 */
function lintParams(src, P, at, ctx, out) {
  const arch = src.archetype;
  const strictContract = !!CONTRACT[arch] || !!EXTENSIONS[arch];
  const forbidden = { ...FORBIDDEN_KEYS['*'], ...(FORBIDDEN_KEYS[arch] || {}) };
  const known = ctx.knownKeys?.get(arch);
  const univ = UNIVERSAL_HIDDEN[src.mount] || {};
  for (const [k, v] of Object.entries(P)) {
    if (k.startsWith('_')) {
      out.push(F('params', `${at}.${k} (ingen _-nøkler)`));
      continue;
    }
    if (forbidden[k]) {
      out.push(F('params', `${at}.${k}: ${forbidden[k]}`));
      continue;
    }
    const spec = paramSpec(arch, k, ctx) || univ[k] || null;
    if (!spec) {
      const isKnown = known?.has(k) || (k === 'decor' && hasDecor(arch, ctx))
        || groupOf(arch).some((g) => ctx.knownKeys?.get(g)?.has(k) || ctx.defs?.[g]?.defaults?.params?.[k] !== undefined);
      if (!isKnown) out.push(W('params', `${at}.${k} er ikke en kjent param for ${arch} (MASTER §2.3/§2.4)`));
      continue;
    }
    const bad = checkValue(spec, v, ctx);
    if (!bad) continue;
    const level = !spec.fromDef || strictContract || spec.t === 'num' ? 'FAIL' : 'WARN';
    out.push({ level, rule: 'params', msg: `${at}.${k} = ${show(v)}: ${bad} (${arch})` });
  }
}

/** Why a value breaks its spec, or null. */
function checkValue(spec, v, ctx) {
  switch (spec.t) {
    case 'enum':
      return typeof v === 'string' && spec.o.includes(v) ? null : `ikke en av ${spec.o.join('|')}`;
    case 'frame': {
      const keys = ctx.frameKeys || FRAME_KEYS;
      return keys.includes(v) ? null : `ikke en av ${keys.join('|')}`;
    }
    case 'layout': {
      const keys = ctx.layoutKeys || LAYOUT_KEYS;
      return keys.includes(v) ? null : `ikke en av ${keys.join('|')}`;
    }
    case 'num':
      if (v === null && spec.nullable) return null;
      if (!isNum(v)) return 'ikke et tall';
      if (spec.int && !Number.isInteger(v)) return 'ikke et heltall';
      return v < spec.r[0] - 1e-9 || v > spec.r[1] + 1e-9 ? `utenfor ${spec.r[0]}–${spec.r[1]}` : null;
    case 'bool':
      return typeof v === 'boolean' ? null : 'ikke true/false';
    case 'str':
      return typeof v === 'string' ? null : 'ikke tekst';
    case 'hex':
      return typeof v === 'string' && HEX.test(v) ? null : 'ikke #rrggbb med små bokstaver';
    case 'arr':
      return Array.isArray(v) ? null : 'ikke en liste';
    case 'palette':
      return Array.isArray(v) && v.length >= 3 && v.length <= 6 && v.every((h) => typeof h === 'string' && HEX.test(h)) ? null : 'palette er 3–6 #rrggbb (små bokstaver)';
    case 'motifOpts':
      return isObj(v) && Object.keys(v).every((k) => ['variant', 'text', 'subtext'].includes(k) && typeof v[k] === 'string') ? null : 'motifOpts er { variant?, text?, subtext? } (tekst)';
    case 'set':
      return Array.isArray(v) && v.length >= 1 && v.every((t) => isObj(t) && ['w', 'd', 'h', 'dx', 'dz'].every((k) => isNum(t[k]))) ? null : 'set er [{ w, d, h, dx, dz, shape? }]';
    case 'frames':
      if (!Array.isArray(v) || !v.length) return 'frames er en ikke-tom liste';
      if (v.length > 16) return `${v.length} rammer (maks 16)`;
      return v.every((f) => isObj(f) && ['x', 'y', 'w', 'h'].every((k) => isNum(f[k]))) ? null : 'hver ramme har tallene x, y, w, h';
    case 'motifs':
      return Array.isArray(v) && v.every((m) => isObj(m) && typeof m.motif === 'string') ? null : 'motifs er [{ motif, seed?, palette?, motifOpts? }]';
    default:
      return null;
  }
}

function hasDecor(arch, ctx) {
  const d = ctx.defs?.[arch];
  return !!(d?.params?.decor || d?.defaults?.params?.decor !== undefined);
}

function lintDimsRange(src, ctx, out) {
  if (!isObj(src.dims)) return;
  const arch = src.archetype;
  const range = { ...(ctx.defs?.[arch]?.dimsRange || {}), ...(CONTRACT[arch]?.dims || {}), ...(EXTENSIONS[arch]?.dims || {}) };
  const head = CONTRACT[arch]?.head;
  for (const k of ['w', 'd', 'h']) {
    const x = src.dims[k];
    const r = range[k];
    if (!isNum(x) || !Array.isArray(r)) continue;
    if (x < r[0] * 0.5 - 1e-9 || x > r[1] * 1.6 + 1e-9) out.push(F('dims-range', `dims.${k} = ${x} m: DesignState klipper ${arch} til ${+(r[0] * 0.5).toFixed(4)}–${+(r[1] * 1.6).toFixed(4)} m`));
    else if (x < r[0] - 1e-9 || x > r[1] + 1e-9) out.push(W('dims-range', `dims.${k} = ${x} m er utenfor ${arch}-området ${r[0]}–${r[1]} m`));
    else if (head?.[k] && (x < head[k][0] - 1e-9 || x > head[k][1] + 1e-9)) out.push(W('dims-range', `dims.${k} = ${x} m er utenfor området for én armatur ${head[k][0]}–${head[k][1]} m`));
  }
}

function lintLight(src, out) {
  const a = SCHEMA.archetypes[src.archetype];
  const isLamp = a?.family === 'lamp';
  const isSpot = src.category === 'spotter' || SPOT_ARCHETYPES.includes(src.archetype);
  if (!isLamp && !isSpot) return;
  const L = src.light;
  if (!isObj(L)) {
    out.push(F('light', 'light mangler (lamper og spotter: { lumens, colorK, dimmable, kind, bulb })'));
    return;
  }
  if (!(isNum(L.lumens) && L.lumens > 0)) out.push(F('light', `light.lumens ${show(L.lumens)} er ikke et tall > 0`));
  else if (isSpot && (L.lumens < 100 || L.lumens > 4000)) out.push(F('light', `light.lumens ${L.lumens} er utenfor 100–4000 per armatur (spotter)`));
  if (!(isNum(L.colorK) && L.colorK >= 1800 && L.colorK <= 6500)) out.push(F('light', `light.colorK ${show(L.colorK)} er utenfor 1800–6500`));
  if (!LIGHT_KINDS.includes(L.kind)) out.push(F('light', `light.kind ${show(L.kind)} er ikke en av ${LIGHT_KINDS.join('|')}`));
  else {
    const want = expectedKind(src);
    if (want && !want.includes(L.kind)) out.push(W('light', `light.kind ${show(L.kind)}: ${src.archetype}${src.subcategory ? `/${src.subcategory}` : ''} er «${want.join('|')}»`));
  }
  if (typeof L.dimmable !== 'boolean') out.push(W('light', 'light.dimmable mangler (true/false)'));
  if (typeof L.bulb !== 'string' || !L.bulb.trim()) out.push(W('light', 'light.bulb mangler (lyskilde, W, lm, K)'));
  const keys = Object.keys(L);
  const extra = keys.filter((k) => !LIGHT_KEY_ORDER.includes(k));
  if (extra.length) out.push(W('light', `light har ukjente nøkler ${extra.join(', ')}`));
  const order = keys.filter((k) => LIGHT_KEY_ORDER.includes(k));
  if (order.join() !== LIGHT_KEY_ORDER.filter((k) => keys.includes(k)).join()) out.push(W('light', `light-nøklene i rekkefølgen ${LIGHT_KEY_ORDER.join(', ')}`));
}

function lintSpot(src, out) {
  const a = SCHEMA.archetypes[src.archetype];
  const P = isObj(src.params) ? src.params : {};
  if (!SPOT_ARCHETYPES.includes(src.archetype)) {
    // other wall items: params.mountHeight is the shop's height (D7); without it WALL_V or a default start height applies
    const onWall = src.mount === 'wall' || P.base === 'wall';
    if (onWall && a && a.family !== 'framed' && !isNum(P.mountHeight)) out.push(W('spot', 'vegghengt produkt uten params.mountHeight (underkant over gulv, m)'));
    return;
  }
  if (a && src.mount !== a.mount) out.push(F('spot', `mount ${show(src.mount)} må være ${a.mount} for ${src.archetype}`));
  if (src.archetype === 'spot-track' && src.subcategory === 'takspot' && !['plate', 'bar'].includes(P.railKind)) out.push(F('spot', 'takspot med flere hoder: spot-track med railKind \'plate\' eller \'bar\''));
  if (src.archetype === 'spot-track' && src.subcategory === 'skinne' && P.railKind === 'plate') out.push(W('spot', 'skinne med railKind \'plate\' – takplate-spotter hører til takspot'));
  if (src.archetype === 'downlight' && isNum(P.tilt) && P.tilt > 0 && P.tiltable !== true) out.push(W('spot', 'tilt > 0 uten tiltable: true'));
  if (a?.mount === 'wall' && !isNum(P.mountHeight)) out.push(F('spot', 'veggarmatur uten params.mountHeight (underkant over gulv, m – catalogdata §6.2)'));
}

function lintArt(src, ctx, out) {
  const P = isObj(src.params) ? src.params : {};
  const set = src.archetype === 'art-set';
  // no imageId anywhere (D18)
  JSON.stringify(src, (k, v) => {
    if (k === 'imageId') out.push(F('art', 'imageId i katalogdata (D18)'));
    return v;
  });
  if (!set) {
    if (typeof P.motif !== 'string') out.push(F('art', 'params.motif mangler (et av de 39 motivene; rammer: et eksempelmotiv)'));
    if (!('palette' in P) && !src.variants.some((v) => isObj(v.paramsOverride) && 'palette' in v.paramsOverride)) out.push(F('art', 'params.palette mangler (3–6 hex, palette[1] = colors.print)'));
    if (!('seed' in P)) out.push(W('art', 'params.seed mangler (1–20)'));
  } else if (typeof P.layout !== 'string') out.push(F('art', 'params.layout mangler (LAYOUT_OPTIONS)'));
  else if (P.layout === 'custom' && !Array.isArray(P.frames)) out.push(W('art', 'layout \'custom\' uten params.frames (faller tilbake til salon-5)'));
  // palette[1] = colors.print in every variant
  src.variants.forEach((v, i) => {
    const pal = (isObj(v.paramsOverride) && v.paramsOverride.palette) || P.palette;
    const print = isObj(v.colors) ? v.colors.print : undefined;
    if (Array.isArray(pal) && pal.length > 1 && print !== undefined && pal[1] !== print) {
      out.push((set ? W : F)('art', `variants[${i}]: colors.print ${show(print)} ≠ palette[1] ${show(pal[1])}`));
    }
  });
  // depth = dims.d (D18)
  if ('depth' in P && !(isNum(P.depth) && isNum(src.dims?.d) && Math.abs(P.depth - src.dims.d) < 1e-9)) out.push(F('art', `params.depth ${show(P.depth)} ≠ dims.d ${show(src.dims?.d)} (utelat depth)`));
  // subcategory rules
  if (P.acceptsImage === true && src.subcategory !== 'ramme') out.push(F('art', 'acceptsImage: true bare for tomme rammer (subcategory ramme)'));
  if (src.subcategory === 'ramme' && P.acceptsImage !== true) out.push(F('art', 'rammer (subcategory ramme) har acceptsImage: true'));
  if (src.subcategory === 'plakat') {
    if (P.frame !== 'none') out.push(F('art', 'plakat: frame \'none\' (selges uten ramme)'));
    if (P.texture !== 'paper') out.push(F('art', 'plakat: texture \'paper\''));
    if (src.dims?.d !== 0.005) out.push(F('art', `plakat: dims.d 0.005 (har ${show(src.dims?.d)})`));
    if (P.edge !== 'white') out.push(W('art', 'plakat: edge \'white\''));
  }
  if (src.subcategory === 'bildevegg' && !set) out.push(F('art', 'bildevegg bruker art-set'));
  // motif keys in sets, variants and lengths of texts
  const motifs = [];
  if (typeof P.motif === 'string') motifs.push(['params.motif', P.motif, P.motifOpts]);
  for (const list of ['frames', 'motifs']) {
    if (Array.isArray(P[list])) P[list].forEach((f, i) => isObj(f) && f.motif !== undefined && motifs.push([`params.${list}[${i}].motif`, f.motif, f.motifOpts]));
  }
  src.variants.forEach((v, i) => {
    if (isObj(v.paramsOverride) && v.paramsOverride.motif !== undefined) motifs.push([`variants[${i}].paramsOverride.motif`, v.paramsOverride.motif, v.paramsOverride.motifOpts]);
  });
  for (const [where, key, mo] of motifs) {
    if (key === 'custom') out.push(F('art', `${where}: motif 'custom' er bare for egne bilder, ikke katalogdata`));
    else if (!MOTIF_KEYS.includes(key)) out.push(F('art', `${where} ${show(key)} er ikke et av de 39 motivene`));
    else if (isObj(mo)) {
      // what the motif reads (cleanMotifOpts drops the rest silently)
      const spec = ctx.motifSpec?.[key] || MOTIF_SPEC[key] || {};
      const vars = spec.variants || [];
      if (mo.variant !== undefined && !vars.includes(mo.variant)) out.push(W('art', `${where}: motifOpts.variant ${show(mo.variant)} finnes ikke for ${key} (${vars.join('|') || 'motivet har ingen varianter'})`));
      for (const k of ['text', 'subtext']) {
        if (mo[k] !== undefined && !(spec.opts || []).includes(k)) out.push(W('art', `${where}: ${key} leser ikke motifOpts.${k} (bare typography, city-map, topo-map)`));
      }
      if (typeof mo.text === 'string' && mo.text.length > 24) out.push(W('art', `${where}: motifOpts.text er over 24 tegn (kuttes)`));
      if (typeof mo.subtext === 'string' && mo.subtext.length > 40) out.push(W('art', `${where}: motifOpts.subtext er over 40 tegn (kuttes)`));
    }
  }
  // texts the catalogue design asks for (catalogdata §5.8, MASTER §4.4 RG)
  const desc = String(src.description || '');
  if (src.subcategory === 'plakat' && !/uten ramme/i.test(desc)) out.push(W('texts', 'plakat: description sier «Selges uten ramme – se Rammer i samme størrelse»'));
  if (src.subcategory === 'ramme' && !/selges tom/i.test(desc)) out.push(W('texts', 'ramme: description sier «Selges tom – legg inn ditt eget bilde i spillet»'));
}

/** «motif|seed|palette» of an art-frame product's default look (null for other products): never twice in kunst (MASTER §4.3 RG). */
export function artKey(p) {
  if (!isObj(p) || p.archetype !== 'art-frame' || !isObj(p.params) || typeof p.params.motif !== 'string') return null;
  const v = Array.isArray(p.variants) ? p.variants[Number.isInteger(p.defaultVariant) ? p.defaultVariant : 0] : null;
  const pal = (isObj(v?.paramsOverride) && v.paramsOverride.palette) || p.params.palette || null;
  return `${p.params.motif}|${p.params.seed ?? ''}|${JSON.stringify(pal)}`;
}

function lintDecor(src, ctx, out) {
  if (!['hylle', 'tvbenk', 'vitrineskap'].includes(src.category)) return;
  const P = isObj(src.params) ? src.params : {};
  if (src.category === 'vitrineskap') {
    if (P.decor !== true) out.push(W('decor', 'D46: nye vitrineskap skriver "decor": true'));
  } else if (hasDecor(src.archetype, ctx) && P.decor !== false) out.push(W('decor', `D46: ${src.archetype} har pynt – skriv "decor": false (ryddig hus)`));
}

function lintAbsorption(src, out) {
  const x = src.absorption;
  if (!isNum(x) || x < 0) {
    out.push(F('absorption', `absorption ${show(x)} er ikke et tall ≥ 0`));
    return;
  }
  const fam = SCHEMA.archetypes[src.archetype]?.family;
  const { w = 0, h = 0 } = isObj(src.dims) ? src.dims : {};
  if (['table', 'storage', 'lamp'].includes(fam) && x !== 0) out.push(W('absorption', `${fam}: absorption 0 (har ${x})`));
  if (src.category === 'sofa' && isNum(w) && w > 0 && Math.abs(x - 1.05 * w) > 0.3 * w) out.push(W('absorption', `sofa: ≈ 1,05 × bredde = ${(1.05 * w).toFixed(2)} (har ${x})`));
  if (fam === 'framed' && isNum(w) && isNum(h)) {
    const hi = Math.max(0.01, 0.075 * w * h) * 1.25 + 0.005;
    if (x < 0.01 - 1e-9 || x > hi) out.push(W('absorption', `kunst: 0,01 × / 0,03 × / 0,075 × b × h, min 0,01 (har ${x})`));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// After normalisation: test-design's per-product loop and its KEEP comparison (tools/test-design.mjs l.113-140, 172-190)

/**
 * @param {object} p normalised product
 * @param {{ productToItemSpec?: Function }} ctx
 * @returns {string[]}
 */
export function loopProblems(p, ctx = {}) {
  const problems = [];
  const a = SCHEMA.archetypes[p.archetype];
  if (!a) return [`archetype ${p.archetype}`];
  if (!MOUNTS.includes(p.mount)) problems.push(`mount ${p.mount}`);
  if (p.mount !== a.mount && !(p.archetype === 'vase' && p.mount === 'floor') && !(a.mounts || []).includes(p.mount)) problems.push(`mount ${p.mount} ≠ ${a.mount}`);
  for (const k of ['w', 'd', 'h']) if (typeof p.dims[k] !== 'number' || p.dims[k] <= 0 || p.dims[k] > 6) problems.push(`dims.${k}=${p.dims[k]}`);
  for (const f of ['priceNok', 'salePriceNok', 'absorption']) if (p[f] != null && typeof p[f] !== 'number') problems.push(`${f} not a number`);
  if (!(p.defaultVariant >= 0 && p.defaultVariant < p.variants.length)) problems.push('defaultVariant');
  const required = a.parts || SCHEMA.families[a.family].parts;
  p.variants.forEach((v, i) => {
    for (const part of required) {
      if (!HEX.test(v.colors?.[part] || '')) problems.push(`#${i}: colour ${part}=${v.colors?.[part]}`);
      if (!MATERIALS.has(v.materials?.[part])) problems.push(`#${i}: material ${part}=${v.materials?.[part]}`);
    }
    const allowed = new Set([...required, ...SCHEMA.families[a.family].parts, ...(SCHEMA.families[a.family].optionalParts || [])]);
    for (const part of Object.keys(v.colors || {})) if (!allowed.has(part)) problems.push(`#${i}: non-canonical part ${part}`);
    for (const m of Object.values(v.materials || {})) if (!MATERIALS.has(m)) problems.push(`#${i}: material ${m}`);
  });
  if (ctx.productToItemSpec) {
    const item = ctx.productToItemSpec(p);
    if (!item || item.archetype !== p.archetype || item.mount !== p.mount || item.source !== 'catalog' || item.refId !== p.id) problems.push('productToItemSpec');
    if (p.light && !(item?.light?.lumens > 0)) problems.push('light lumens');
  }
  return problems;
}

export const KEEP_FIELDS = Object.freeze(['category', 'subcategory', 'name', 'brand', 'store', 'url', 'priceNok', 'salePriceNok', 'priceNote', 'priceConfidence',
  'archetype', 'defaultVariant', 'description', 'why', 'imageUrl', 'verified', 'verifiedNote', 'light']);
const brief = (v) => {
  const s = v === undefined ? 'undefined' : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/**
 * test-design KEEP: research product `src` vs the normalised `p` (fixes.mjs PRODUCTS[src.id] = `fx` honoured).
 * @returns {string[]}
 */
export function keepProblems(src, p, fx = {}) {
  if (!p) return ['finnes ikke etter normaliseringen (id endret eller kollisjon)'];
  const out = [];
  for (const k of KEEP_FIELDS) if (JSON.stringify(p[k]) !== JSON.stringify(src[k])) out.push(`${k}: ${brief(src[k])} → ${brief(p[k])}`);
  for (const k of ['w', 'd', 'h']) {
    const want = fx.dims?.[k] ?? src.dims?.[k];
    if (!(Math.abs(p.dims?.[k] - want) <= 1e-9)) out.push(`dims.${k}: ${brief(want)} → ${brief(p.dims?.[k])}`);
  }
  if (p.mount !== src.mount) out.push(`mount ${p.mount} ≠ research ${src.mount}`);
  for (const [k, v] of Object.entries(src.params || {})) {
    const want = fx.params && k in fx.params ? fx.params[k] ?? undefined : v;
    if (JSON.stringify(p.params?.[k]) !== JSON.stringify(want)) out.push(`params.${k}: ${brief(want)} → ${brief(p.params?.[k])}`);
  }
  const vs = Array.isArray(src.variants) ? src.variants.map((v) => (isObj(v) ? v : {})) : [];
  if (p.variants.length !== vs.length) out.push('variants (antall)');
  vs.forEach((v, i) => {
    const pv = p.variants[i];
    for (const k of ['name', 'priceNok', 'salePriceNok', 'priceConfidence', 'url', 'paramsOverride']) if (JSON.stringify(pv?.[k]) !== JSON.stringify(v[k])) out.push(`#${i}.${k}: ${brief(v[k])} → ${brief(pv?.[k])}`);
    for (const [part, hex] of Object.entries(v.colors || {})) {
      if (pv?.colors?.[part] !== hex || pv?.materials?.[part] !== v.materials?.[part]) out.push(`#${i}.${part}: ${hex}/${v.materials?.[part]} → ${pv?.colors?.[part]}/${pv?.materials?.[part]}`);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Identity: ids, urls, store SKUs, claims (D36)

/** Comparable url: no scheme, no www., lower-case host and path, no trailing slash, sorted query without utm_*. */
export function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    const q = [...x.searchParams].filter(([k]) => !/^utm_|^gclid$|^fbclid$/i.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const path0 = decodeURIComponent(x.pathname).toLowerCase().replace(/\/+$/, '');
    return `${x.hostname.toLowerCase().replace(/^www\d?\./, '')}${path0}${q.length ? `?${q.map(([k, v]) => `${k}=${v}`).join('&')}` : ''}`;
  } catch {
    return null;
  }
}

const storePrefix = (p) => STORES[p.store]?.prefix || (typeof p.id === 'string' ? p.id.split('-')[0] : '') || String(p.store || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// «varenr. 294524», «art.nr. 606.279.80», «art. 305.512.03», «artikkelnr: 123», «SKU 12-3»
const SKU_IN_NOTE = /\b(?:vare-?nr|varenummer|art(?:ikkel)?\.?\s?(?:nr|nummer)?|artnr|produktnr|sku)\.?\s*:?\s*([a-z]?\d[\w.\-/]*\w|\d)/i;
const normSku = (prefix, s) => {
  let x = String(s).toLowerCase().replace(/[.\s/]/g, '');
  if (prefix === 'ikea') x = x.replace(/^s(?=\d{8}$)/, '');
  return x;
};

/** Store SKU keys «<prefix>-<sku>» of a product: the first «varenr./art.nr.» in priceNote, and store url patterns. */
export function skuKeys(p) {
  const prefix = storePrefix(p);
  const keys = new Set();
  const m = SKU_IN_NOTE.exec(String(p.priceNote || ''));
  if (m) keys.add(`${prefix}-${normSku(prefix, m[1])}`);
  for (const u of [p.url]) {
    let x;
    try {
      x = new URL(String(u));
    } catch {
      continue;
    }
    const pth = x.pathname.replace(/\/+$/, '');
    let s = null;
    if (prefix === 'ikea') s = /-(s?\d{8})$/i.exec(pth)?.[1];
    else if (prefix === 'elektroimportoren') s = /\/(\d{3,})\/Product\.html$/i.exec(pth)?.[1];
    else if (prefix === 'nordicnest') s = x.searchParams.get('variantId');
    else if (prefix === 'skeidar') s = x.searchParams.get('VariationId');
    if (s) keys.add(`${prefix}-${normSku(prefix, s)}`);
  }
  return [...keys];
}

/** Candidate claim directory names of a product: its SKU keys and «<prefix>-<url slug>». */
export function claimKeys(p) {
  const prefix = storePrefix(p);
  const keys = new Set(skuKeys(p));
  try {
    const x = new URL(String(p.url));
    const seg = x.pathname.split('/').filter(Boolean);
    const last = (seg[seg.length - 1] || '').replace(/\.(html?|aspx)$/i, '').toLowerCase();
    if (/^product$/i.test(last) && seg.length > 1) keys.add(`${prefix}-${seg[seg.length - 2].toLowerCase()}`);
    else if (last) keys.add(`${prefix}-${last}`);
    if (x.searchParams.get('variantId')) keys.add(`${prefix}-${x.searchParams.get('variantId').toLowerCase()}`);
  } catch {
    /* no url */
  }
  return [...keys];
}

/** Every identity of a product: { ids, urls (product + variants), skus }. */
export function identityKeys(p) {
  const urls = new Set();
  for (const u of [p?.url, ...(Array.isArray(p?.variants) ? p.variants.map((v) => v?.url) : [])]) {
    const n = u ? normUrl(u) : null;
    if (n) urls.add(n);
  }
  return { id: typeof p?.id === 'string' ? p.id.trim().toLowerCase() : null, urls: [...urls], skus: p ? skuKeys(p) : [] };
}

/**
 * An identity index over product lists: add(products, source) registers every product as its own entry
 * (uid = «source#index»); find(p, uid) → [{ kind: 'id'|'url'|'sku', key, source, id, uid }] of every OTHER entry that
 * shares an id, a url (product or variant) or a store SKU with p. A product is never a duplicate of itself (its own
 * uid); two entries of the same id in one file are.
 */
export function makeIndex() {
  const maps = { id: new Map(), url: new Map(), sku: new Map() };
  const put = (kind, key, entry) => {
    if (!key) return;
    if (!maps[kind].has(key)) maps[kind].set(key, []);
    maps[kind].get(key).push(entry);
  };
  return {
    add(list, source) {
      list.forEach((p, i) => {
        if (!isObj(p)) return;
        const k = identityKeys(p);
        const entry = { source, id: k.id, uid: `${source}#${i}` };
        put('id', k.id, entry);
        for (const u of k.urls) put('url', u, entry);
        for (const s of k.skus) put('sku', s, entry);
      });
    },
    find(p, uid) {
      const k = identityKeys(p);
      const hits = [];
      const seen = new Set();
      const look = (kind, key) => {
        for (const e of maps[kind].get(key) || []) {
          if (e.uid === uid || seen.has(`${kind}|${e.uid}`)) continue;
          seen.add(`${kind}|${e.uid}`);
          hits.push({ kind, key, ...e });
        }
      };
      look('id', k.id);
      for (const u of k.urls) look('url', u);
      for (const s of k.skus) look('sku', s);
      return hits;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// App context (optional; check-research and catalog-round.test build it once)

/**
 * Loads what the strict rules can use from the app. Every import is optional: a failing one is listed in
 * ctx.missing and its rules fall back to the embedded tables (MASTER §2.3/§2.4).
 * @param {{ imp: (rel: string) => Promise<object>, today?: string }} o  imp = import of a project-relative module (with the JSON hook)
 * @returns {Promise<object>} ctx: { today, defs, registry, labels, categoryLabel, productToItemSpec, products, knownKeys, usedEnums, frameKeys, layoutKeys, motifSpec, missing }
 */
export async function makeContext({ imp, today: day } = {}) {
  const ctx = { today: day || today(), missing: [] };
  const load = async (rel) => {
    try {
      return await imp(rel);
    } catch (err) {
      ctx.missing.push(`${rel}: ${String(err?.message || err).split('\n')[0]}`);
      return null;
    }
  };
  const reg = await load('src/models/registry.js');
  if (reg?.ARCHETYPES) {
    ctx.defs = reg.ARCHETYPES;
    ctx.registry = reg;
  }
  const cat = await load('src/catalog/index.js');
  if (cat?.allProducts) {
    ctx.labels = cat.SUBCATEGORY_LABELS;
    ctx.categoryLabel = cat.categoryLabel;
    ctx.productToItemSpec = cat.productToItemSpec;
    ctx.products = cat.allProducts();
    // the frozen catalogue: param keys and string values per archetype (they build today)
    const knownKeys = new Map();
    const usedEnums = new Map();
    for (const p of ctx.products) {
      const keys = knownKeys.get(p.archetype) || knownKeys.set(p.archetype, new Set()).get(p.archetype);
      const enums = usedEnums.get(p.archetype) || usedEnums.set(p.archetype, new Map()).get(p.archetype);
      for (const P of [p.params, ...(p.variants || []).map((v) => v.paramsOverride)]) {
        if (!isObj(P)) continue;
        for (const [k, v] of Object.entries(P)) {
          keys.add(k);
          if (typeof v === 'string') (enums.get(k) || enums.set(k, new Set()).get(k)).add(v);
        }
      }
    }
    ctx.knownKeys = knownKeys;
    ctx.usedEnums = usedEnums;
  }
  const al = await load('src/models/artlayout.js');
  if (Array.isArray(al?.FRAME_OPTIONS)) ctx.frameKeys = al.FRAME_OPTIONS.map((o) => (Array.isArray(o) ? o[0] : o));
  if (Array.isArray(al?.LAYOUT_OPTIONS)) ctx.layoutKeys = al.LAYOUT_OPTIONS.map((o) => (Array.isArray(o) ? o[0] : o));
  const am = await load('src/models/artmotifs.js');
  if (am?.ART_MOTIFS && Object.keys(am.ART_MOTIFS).length) {
    ctx.motifSpec = Object.fromEntries(Object.entries(am.ART_MOTIFS).map(([k, m]) => [k, { variants: (m.variants || []).map((v) => (Array.isArray(v) ? v[0] : v)), opts: m.opts || [] }]));
  }
  return ctx;
}
