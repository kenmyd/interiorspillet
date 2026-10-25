import schema from '../data/archetypes.json';

/**
 * The furniture that stands in the real room today (room-spec «furniture») as DesignState item specs.
 *
 * originalItems(layout) → ItemSpec[] with source 'existing', refId = room-spec id, Norwegian names, canonical part
 * names (ARCHITECTURE §13), valid material kinds (§4), cleaned params (descriptive text moves to `notes`) and an
 * absorption estimate (`acoustic: { m2, ref }`, Sabine m² at the reference dims) that Acoustics scales on resize.
 *
 * Position convention per mount (same as the model origins in §5): floor/surface/rug/soft = bottom centre of the
 * footprint; wall = centre of the back face, y = vertical middle (room-spec «center»); ceiling = attachment point.
 * The kitchen and the built-in lights stay in the shell; the molecule chandelier is an item (it can be moved).
 *
 * Pure data – no three.js; `layout` is only read (walls for wall normals, ceiling height for the chandelier).
 *
 * The rest of the house (hele-huset step 12+31i): `originalItems(layout, { rooms })` also gives the original furniture
 * of the other rooms (layout.house.furniture: bedroom, bathroom, basement …) with `roomId`, `level` and a y over the
 * room's own floor. Without `rooms` the result is the living room's, byte for byte as before.
 */

const VALID_MATERIALS = new Set(Object.values(schema.materials).flat());

/** room-spec «kind» / «archetype» → model archetype (ARCHITECTURE §5). */
const KIND_TO_ARCHETYPE = {
  'armchair-tub-swivel': 'tub-swivel',
  painting: 'art-frame',
  candle: 'candle-holder',
  'decor-group': 'vase',
  decor: 'vase',
};

/**
 * Item category for every archetype in data/archetypes.json (catalog keys where they exist – the category most of the
 * catalogue's products of that archetype are in – otherwise the extra furniture categories in catalog/index.js).
 * The living room's entries are unchanged; the rest of the house (beds, wardrobes, bathroom and hall furniture …) gets
 * its own catalogue category instead of «Smått».
 */
export const CATEGORY_BY_ARCHETYPE = {
  'sofa-modular-l': 'sofa', 'sofa-curved': 'sofa', 'sofa-straight': 'sofa',
  'tub-swivel': 'lenestol', wingback: 'lenestol', 'lounge-wood': 'lenestol', 'club-box': 'lenestol', recliner: 'lenestol',
  'shell-legs': 'lenestol', rocking: 'lenestol',
  'dining-chair': 'stoler', 'bar-stool': 'stoler', chair: 'stoler',
  'office-chair': 'stoler', 'shell-chair': 'stoler', stool: 'stoler',
  'coffee-table-rect': 'bord', 'coffee-table-round-nesting': 'bord', 'dining-table-oval': 'bord',
  'coffee-table': 'bord', desk: 'bord',
  'side-table-round': 'bord', 'side-table-c': 'bord', 'side-table-nesting': 'bord',
  sideboard: 'skjenk', 'tv-bench': 'skjenk', 'wall-shelf': 'hylle',
  'display-cabinet': 'vitrineskap', bookcase: 'hylle',
  cushion: 'tekstil', throw: 'tekstil', pouf: 'tekstil', rug: 'teppe',
  tv: 'elektronikk', speaker: 'elektronikk',
  'chandelier-molecule': 'taklampe',
  'pendant-dome': 'taklampe', 'pendant-globe': 'taklampe', 'pendant-cylinder': 'taklampe', 'pendant-linear': 'taklampe',
  'pendant-multi': 'taklampe', 'pendant-tiered': 'taklampe', 'pendant-woven': 'taklampe', 'pendant-mushroom': 'taklampe',
  'pendant-slatted': 'taklampe', 'pendant-felt': 'taklampe', 'ceiling-ring': 'taklampe',
  'floor-arc': 'smalamper', 'floor-tripod': 'smalamper', 'floor-pole-shade': 'smalamper', 'floor-mushroom': 'smalamper',
  'floor-uplight': 'smalamper', 'floor-globe': 'smalamper', 'floor-reading': 'smalamper', 'table-mushroom': 'smalamper',
  'table-shade': 'smalamper', 'table-globe': 'smalamper', 'table-portable': 'smalamper', 'table-dome': 'smalamper',
  'wall-sconce': 'smalamper', 'wall-arm': 'smalamper', 'table-task': 'smalamper',
  // runde 3: spots and downlights, art (the round-1 art and side tables left «Smått»)
  downlight: 'spotter', 'downlight-surface': 'spotter', 'spot-ceiling': 'spotter', 'spot-track': 'spotter',
  'spot-wall': 'spotter', 'picture-light': 'spotter',
  'art-frame': 'kunst', 'art-set': 'kunst',
  'plant-floor': 'smatt', 'plant-small': 'smatt', vase: 'smatt', 'candle-holder': 'smatt', basket: 'smatt',
  mirror: 'speil', 'mirror-floor': 'speil',
  'slat-panel': 'akustikk', 'fabric-panel': 'akustikk', 'acoustic-art': 'akustikk', 'felt-shape': 'akustikk', 'ceiling-absorber': 'akustikk',
  venetian: 'solskjerming', roller: 'solskjerming', pleated: 'solskjerming', 'duo-roller': 'solskjerming', vertical: 'solskjerming',
  curtain: 'solskjerming', roman: 'solskjerming', 'exterior-screen': 'solskjerming',
  // the rest of the house (the catalogue merged in hele-huset step 11)
  bed: 'seng', headboard: 'seng', bench: 'gang',
  wardrobe: 'garderobe', dresser: 'kommode', 'bedside-table': 'nattbord', 'shoe-cabinet': 'gang',
  'wall-cabinet': 'bad', 'mirror-cabinet': 'bad', towel: 'bad', 'towel-ladder': 'bad', 'towel-rail': 'bad', 'bath-accessory': 'bad',
  'coat-rack': 'gang', 'coat-stand': 'gang',
};

/** Plant species codes of models/decor.js (SPECIES) a spec may name directly. */
const PLANT_SPECIES = new Set(['palm', 'kentia', 'monstera', 'olive', 'ficus-lyrata', 'strelitzia', 'pampas', 'pothos', 'anthurium', 'herb', 'fern', 'eucalyptus']);

/** Rug absorption coefficient (Sabine m² per m² of rug) by pile. */
export const RUG_ALPHA = { flat: 0.18, low: 0.25, medium: 0.28, high: 0.32 };

/** Absorption estimates (m² at the spec dims) for the existing soft furniture; anything not listed absorbs ~0. */
const ABSORPTION_BY_ID = {
  'f-hjornesofa': 3.0, // large woven L-sofa, 5 modules
  'f-buet-sofa': 2.2, // 2.1 m bouclé sofa
  'f-svingstol-1': 0.6,
  'f-svingstol-2': 0.6,
  'f-pute-1': 0.1,
  'f-pute-2': 0.1,
  'f-pute-3': 0.11,
  'f-pute-4': 0.1,
  'f-pledd-tv': 0.25, // folded
  'f-pledd-salvie': 0.3, // draped
  'f-spisestol-1': 0.25,
  'f-spisestol-2': 0.25,
  'f-spisestol-3': 0.25,
  'f-spisestol-4': 0.25,
  'f-spisestol-5': 0.25,
  'f-spisestol-6': 0.25,
  'f-barkrakk-1': 0.15,
  'f-barkrakk-2': 0.15,
  'f-barkrakk-3': 0.15,
  'f-palme': 0.1,
  'f-plante-sokkel': 0.05,
  'f-plante-stativ': 0.04,
  'f-plante-v2': 0.02,
  'f-plante-benk': 0.02,
  'f-gulvvase': 0.03,
  'f-maleri': 0.05, // unframed canvas, not an acoustic print
  'f-sylinder': 0.02,
  // the rest of the house (per room once Acoustics computes per room, §5.4)
  'f-sov-seng': 2.4, // 180 cm continental bed with a duvet and two pillows
  'f-ks-stol-a': 0.3, // metal armchairs with a loose seat cushion
  'f-ks-stol-b': 0.3,
  'f-sk-stol': 0.25,
  'f-sk-bokhylle': 0.1, // empty open shelves
  'f-kg-oliventre': 0.05,
  'f-entre-vase': 0.02,
};

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** Maps a material value to a known material kind. */
export function normaliseMaterial(kind, fallback = 'plastic') {
  if (kind == null) return fallback;
  const k = String(kind).trim().toLowerCase();
  if (VALID_MATERIALS.has(k)) return k;
  const alias = schema.materialAliases[k];
  return alias && VALID_MATERIALS.has(alias) ? alias : fallback;
}

function shadeHex(hex, factor) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(factor <= 1 ? v * factor : v + (255 - v) * Math.min(1, factor - 1)),
  );
  return `#${ch.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Rug pile from text ('lav–middels luv', '1,5–2 cm', 'low' …) → RUG_ALPHA key. */
export function parsePile(text) {
  const s = String(text || '').toLowerCase().replace(',', '.');
  if (RUG_ALPHA[s]) return s;
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length && /cm|mm/.test(s)) {
    const cm = (nums.reduce((a, b) => a + b, 0) / nums.length) * (s.includes('mm') ? 0.1 : 1);
    return cm < 0.8 ? 'flat' : cm < 1.5 ? 'low' : cm < 2.5 ? 'medium' : 'high';
  }
  if (/flat|flatvevd|flatt/.test(s)) return 'flat';
  if (/høy|high|shaggy|lang/.test(s)) return 'high';
  if (/middels|medium/.test(s) && !/lav/.test(s)) return 'medium';
  return 'low';
}

/**
 * Generic param cleaning: numbers, booleans, numeric arrays, short code strings (no spaces) and objects of those are
 * kept; descriptive text is returned separately for the notes.
 */
function cleanParams(params) {
  const out = {};
  const notes = [];
  const keep = (v) => {
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    // short codes without spaces; «:» for the cabinet front codes ('drawers:2', 'door+drawers:3', 'flip:2')
    if (typeof v === 'string') return /^[#+\-\w.:]{1,24}$/.test(v) ? v : undefined;
    if (Array.isArray(v)) {
      const arr = v.map(keep);
      return arr.every((x) => x !== undefined) ? arr : undefined;
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        const kept = keep(x);
        if (kept !== undefined) o[k] = kept;
      }
      return Object.keys(o).length ? o : undefined;
    }
    return undefined;
  };
  for (const [k, v] of Object.entries(params || {})) {
    const kept = keep(v);
    if (kept !== undefined) out[k] = kept;
    else if (typeof v === 'string') notes.push(`${k}: ${v}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) notes.push(`${k}: ${v.join('; ')}`);
  }
  return { params: out, notes };
}

/**
 * Canonical part colours/materials for an archetype from room-spec colour keys ('main', 'top', 'frame', 'legs',
 * 'pot', 'leaves', 'inner', 'flowers', 'stems', 'accent1' …). Pattern colours without a part go to params.
 */
function canonicalParts(archetype, colors = {}, materials = {}) {
  const family = schema.archetypes[archetype]?.family;
  const c = colors;
  const m = materials;
  const mat = (k, fb) => normaliseMaterial(m[k], fb);
  const P = { colors: {}, materials: {}, params: {} };
  const set = (part, hex, kind) => {
    if (!hex) return;
    P.colors[part] = hex;
    P.materials[part] = kind;
  };
  switch (family) {
    case 'seating': {
      set('upholstery', c.main ?? c.upholstery, mat('main', 'woven'));
      // Plinth/drum bases are upholstered: legs follow the upholstery unless the spec gives a leg colour.
      set('legs', c.legs ?? c.main, m.legs ? mat('legs') : mat('main', 'woven'));
      if (c.frame) set('frame', c.frame, mat('frame', 'oak'));
      if (c.piping) set('piping', c.piping, mat('main', 'woven'));
      break;
    }
    case 'table': {
      const body = c.frame ?? c.legs ?? c.main ?? c.top;
      const bodyMat = m.frame ?? m.legs ?? m.main ?? m.top;
      set('body', body, normaliseMaterial(bodyMat, 'black-metal'));
      set('front', c.front ?? body, normaliseMaterial(m.front ?? bodyMat, 'black-metal'));
      set('top', c.top ?? body, normaliseMaterial(m.top ?? bodyMat, 'oak'));
      set('legs', c.legs ?? body, normaliseMaterial(m.legs ?? bodyMat, 'black-metal'));
      set('handle', c.handle ?? c.legs ?? body, normaliseMaterial(m.handle ?? m.legs ?? bodyMat, 'black-metal'));
      break;
    }
    case 'lamp': {
      const metal = c.main ?? c.metal ?? '#1a1a1a';
      const metalMat = normaliseMaterial(m.main ?? m.metal, 'black-metal');
      set('shade', c.shade ?? metal, normaliseMaterial(m.shade ?? m.main, 'black-metal'));
      set('inner', c.inner ?? c.shade ?? metal, normaliseMaterial(m.inner ?? m.shade, 'brass'));
      set('base', c.base ?? metal, normaliseMaterial(m.base, metalMat));
      set('metal', metal, metalMat);
      set('cord', c.cord ?? metal, normaliseMaterial(m.cord, 'cotton'));
      break;
    }
    case 'textile':
      set('fabric', c.main ?? c.fabric, mat('main', 'woven'));
      set('piping', c.piping ?? c.main ?? c.fabric, mat('main', 'woven'));
      break;
    case 'rug': {
      const base = c.main ?? c.base ?? '#c4c2bf';
      const kind = mat('main', 'wool');
      set('base', base, kind);
      set('accent', c.accent1 ?? c.fleck1 ?? c.accent ?? shadeHex(base, 0.8), kind);
      set('accent2', c.accent2 ?? c.fleck2 ?? shadeHex(base, 1.12), kind);
      if (c.accent3) P.params.accent3Color = c.accent3;
      break;
    }
    case 'plant':
      set('leaves', c.leaves ?? '#4f6b3a', normaliseMaterial(m.leaves, 'plant-leaf'));
      set('pot', c.pot ?? '#e8e4dc', normaliseMaterial(m.pot, 'ceramic'));
      break;
    case 'object':
      set('body', c.main ?? c.body ?? '#cfc6b8', mat('main', 'ceramic'));
      if (c.flowers || c.stems) set('flowers', c.flowers ?? c.stems, 'plant-leaf');
      if (c.candle) P.params.candleColor = c.candle;
      if (c.lid) P.params.lidColor = c.lid;
      break;
    case 'framed':
      set('print', c.main ?? c.print ?? '#c9cfcd', mat('main', 'cotton'));
      set('frame', c.frame ?? shadeHex(c.main ?? '#c9cfcd', 0.35), normaliseMaterial(m.frame, 'painted'));
      break;
    default:
      for (const [k, hex] of Object.entries(c)) set(k, hex, mat(k));
  }
  return P;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-archetype param translation (spec text → code values the model builders can switch on)

const MODULE_KINDS = { hjørne: 'corner', sete: 'seat', armlene: 'arm', sjeselong: 'chaise' };
const parseNum = (s) => Number(String(s).replace(',', '.'));

function translateParams(f, archetype, cleaned) {
  const p = f.params || {};
  const d = f.dims;
  const out = { ...cleaned };
  switch (archetype) {
    case 'sofa-modular-l':
      out.base = 'plinth';
      out.modules = (p.modules || []).map((txt) => {
        const [word] = String(txt).split(' ');
        const nums = (String(txt).match(/\d+(?:,\d+)?/g) || []).map(parseNum);
        const mod = { kind: MODULE_KINDS[word] || 'seat', w: nums[0] ?? 0.8 };
        if (nums[1] != null) mod.d = nums[1];
        return mod;
      });
      break;
    case 'sofa-curved':
      out.base = 'plinth';
      out.backH = 0.78; // highest at the wing end (spec notes)
      out.wingEnd = '-x';
      out.bolsterEnd = '+x';
      break;
    case 'tub-swivel':
      out.legStyle = 'drum';
      out.baseD = p.base?.d ?? 0.64;
      out.baseH = p.base?.h ?? 0.3;
      out.backH = d.h;
      out.backShape = 'round';
      out.cushion = 'tight';
      delete out.base;
      break;
    case 'dining-chair':
      out.shell = 'shell';
      out.legStyle = 'slim-metal';
      out.legD = 0.02;
      delete out.legs;
      break;
    case 'bar-stool':
      out.back = 'shell';
      out.legStyle = 'slim-metal';
      out.footrest = true;
      delete out.legs;
      break;
    case 'coffee-table-rect':
      out.frame = 'tube-box';
      out.tubeW = 0.02;
      break;
    case 'coffee-table-round-nesting':
      out.frame = 'ring';
      break;
    case 'dining-table-oval':
      out.shape = 'stadium';
      out.legs = 'a-frame';
      out.legInset = 0.4;
      out.edge = 'bevel';
      break;
    case 'wall-shelf':
      out.style = 'grid';
      break;
    case 'cushion':
      out.shape = 'square';
      out.size = [d.w, d.h];
      out.texture = /popcorn|bobl/i.test(p.style || '') ? 'bobble' : normaliseMaterial(f.materials?.main, 'woven');
      out.pattern = 'solid';
      out.flange = 0;
      break;
    case 'throw':
      out.size = [d.w, d.d];
      out.texture = normaliseMaterial(f.materials?.main, 'wool');
      out.pattern = /vaffel/i.test(f.name) ? 'waffle' : 'solid';
      out.folded = p.folded === true;
      if (p.draped) out.draped = 'arm';
      // explicit drape so the Inspector's «Plassering» select shows the real state (textiles.md #2)
      out.drape = p.draped ? 'over-arm' : out.folded ? 'folded' : undefined;
      if (!out.drape) delete out.drape;
      out.fringe = p.fringe === true;
      break;
    case 'rug': {
      // explicit code values (the jute placemats: round, braided, solid) win over the text parsing
      const code = (v, list) => (typeof v === 'string' && list.includes(v) ? v : null);
      out.shape = code(p.shape, ['rect', 'round', 'oval', 'organic']) ?? 'rect';
      out.pile = parsePile(p.pile);
      out.pattern = code(p.pattern, ['solid', 'melange', 'border', 'stripes', 'geometric', 'abstract', 'wool-knotted', 'pebble'])
        ?? (/pebble|kuler/i.test(p.pattern || '') ? 'pebble' : /geometr/i.test(p.pattern || '') ? 'geometric' : 'melange');
      out.thickness = d.h;
      out.weave = code(p.weave, ['hand-tufted', 'handwoven', 'machine-woven', 'flatweave', 'braided', 'felted']) ?? (out.pattern === 'pebble' ? 'felted' : 'machine-woven');
      out.fringe = false;
      if (/kant/i.test(p.edge || '')) {
        out.border = true;
        out.borderColor = '#e9e6df';
      }
      delete out.edge;
      break;
    }
    case 'plant-floor':
    case 'plant-small': {
      const sp = String(p.species || '').toLowerCase();
      out.species = /anthurium|satengranke/.test(sp) ? 'anthurium' : /palme|kentia|areca/.test(sp) ? 'palm'
        : /pothos|gullranke/.test(sp) ? 'pothos' : /rosmarin|bregne/.test(sp) ? 'fern' : 'herb';
      if (p.pot?.d) out.potD = p.pot.d;
      if (p.pot?.h) out.potH = p.pot.h;
      // an explicit species code from the photos of the rest of the house ('olive' …) wins over the text parsing
      if (typeof p.species === 'string' && /^[a-z-]+$/.test(p.species) && PLANT_SPECIES.has(p.species)) out.species = p.species;
      const below = p.pedestal?.h ?? p.stand?.h ?? 0;
      out.plantH = round(d.h - below, 3);
      if (p.pedestal) out.pedestal = { w: p.pedestal.w, d: p.pedestal.d, h: p.pedestal.h, color: p.pedestal.color ?? '#1a1a1a' };
      if (p.stand) out.stand = { d: p.stand.d, h: p.stand.h, color: p.stand.color ?? '#1a1a1a', style: 'wire' };
      delete out.pot;
      break;
    }
    case 'vase': {
      const stems = String(p.flowers || p.stems || '').toLowerCase();
      out.flowers = /hortensia/.test(stems) ? 'hydrangea' : /pampas/.test(stems) ? 'pampas' : /eukalyptus/.test(stems) ? 'eucalyptus' : null;
      out.d = p.vaseD ?? d.w;
      out.h = p.vaseH ?? d.h;
      if (out.flowers) out.stemsH = p.flowerTop ?? d.h;
      const shapes = ['round', 'ribbed', 'wave', 'sculptural', 'bottle', 'bud', 'bubble', 'cylinder'];
      out.shape = shapes.includes(p.shape) ? p.shape : p.ribbed ? 'ribbed' : out.flowers === 'pampas' ? 'wave' : f.id === 'f-knivblokk' ? 'block' : 'round';
      delete out.vaseH;
      delete out.vaseD;
      delete out.flowerTop;
      delete out.ribbed;
      break;
    }
    case 'basket':
      if (f.id === 'f-avfallsbotte') {
        out.shape = 'pedal-bin';
        out.lid = true;
        out.weave = 'none';
      } else {
        out.shape = 'cylinder';
        out.weave = 'foam';
        out.hollow = true;
      }
      out.d = d.w;
      out.h = d.h;
      break;
    case 'candle-holder':
      if (['lantern', 'tealight', 'candlestick', 'pillar'].includes(p.kind)) {
        // explicit kind (the decor from the photos): keep its own count / spacing / lit
        out.kind = p.kind;
        if (p.kind === 'tealight') {
          out.count = p.count ?? 1;
          if (p.spacing != null) out.spacing = p.spacing;
        }
      } else if (/lykt/i.test(f.name)) {
        out.kind = 'lantern';
        out.glass = 'smoked';
        out.candles = 1;
      } else {
        out.kind = 'tealight';
        out.count = p.count ?? 2;
        out.spacing = p.spacing ?? 0.12;
      }
      break;
    case 'art-frame':
      out.motif = 'misty-trees';
      out.frame = 'none';
      out.frameW = 0;
      out.depth = d.d;
      out.texture = 'canvas';
      break;
    case 'chandelier-molecule': {
      const ceilingY = f.position[1];
      out.hubDrop = round(ceilingY - (p.hubY ?? ceilingY - 0.42), 3);
      out.bulbs = 'visible';
      delete out.hubY;
      delete out.lowestShadeY;
      break;
    }
    case 'speaker':
      out.inWall = true;
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

/** Footprint-based absorption for rugs. */
function rugAbsorption(params, dims) {
  return round((RUG_ALPHA[params.pile] ?? RUG_ALPHA.low) * dims.w * dims.d, 3);
}

function wallAttach(layout, wallId) {
  // the living room's walls first (old fields), then every wall of the house (layout.house, hele-huset §1.8)
  const wall = layout?.wallsById?.[wallId] ?? layout?.walls?.find?.((w) => w.id === wallId) ?? layout?.house?.wallsById?.[wallId];
  if (!wall) return { wallId };
  const n = wall.normal3 ?? { x: wall.normal.x, z: wall.normal.y };
  return { wallId, normal: [n.x, 0, n.z] };
}

/** Splits the window-sill decor group of the TV-stue (f-dekor-overlys) into its pieces. */
function splitDecorGroup(f) {
  const looks = [
    { match: /blader|bøker/, name: 'Bunke med blader og bøker', archetype: 'basket', color: '#d9d2c4', kind: 'paper', params: { shape: 'rect', weave: 'none' } },
    { match: /boblevase/, name: 'Boblevase (klar)', archetype: 'vase', color: '#dfe6e4', kind: 'glass-clear', params: { shape: 'bubble' } },
    { match: /kremfarget/, name: 'Liten kremfarget vase med eukalyptus', archetype: 'vase', color: '#e8e0d0', kind: 'ceramic', flowers: '#8fa39a', params: { shape: 'round', flowers: 'eucalyptus' } },
    { match: /terrakotta/, name: 'Liten terrakottavase med grønn kvist', archetype: 'vase', color: '#b4674a', kind: 'ceramic', flowers: '#6f8f5a', params: { shape: 'bottle', flowers: 'sprig' } },
    { match: /kurv/, name: 'Oval grå kurv', archetype: 'basket', color: '#8f8d88', kind: 'woven', params: { shape: 'oval', weave: 'rope' } },
  ];
  const [x, y] = f.position;
  return (f.params?.items || []).map(([label, z, w, h], i) => {
    const look = looks.find((l) => l.match.test(label)) || looks[1];
    const dims = { w, d: Math.min(w, 0.16), h };
    const colors = { body: look.color };
    const materials = { body: look.kind };
    if (look.flowers) {
      colors.flowers = look.flowers;
      materials.flowers = 'plant-leaf';
    }
    const params = { ...look.params, d: dims.w, h: look.flowers ? round(h * 0.55, 3) : h };
    if (look.flowers) params.stemsH = h;
    return {
      uid: `ex-${f.id}-${i + 1}`,
      source: 'existing',
      refId: f.id,
      name: look.name,
      category: 'smatt',
      archetype: look.archetype,
      mount: 'surface',
      position: [x, y, z],
      rotationDeg: f.rotationDeg ?? 90,
      dims,
      params,
      colors,
      materials,
      variantIndex: 0,
      acoustic: { m2: 0, ref: { ...dims } },
      notes: `${label} (del av «${f.name}»). ${f.notes || ''}`.trim(),
      confidence: f.confidence ?? 'low',
    };
  });
}

/** The living room's id (layout.js LIVING_ROOM_ID; entries without roomId belong to it). */
const LIVING_ROOM = 'stue-kjokken';
const warnedUnknown = new Set();

/** Canonical archetype of a room-spec furniture entry, or null when it names none the models know. */
export function archetypeOf(f) {
  if (f?.archetype && schema.archetypes[f.archetype]) return f.archetype;
  const a = KIND_TO_ARCHETYPE[f?.kind] || f?.kind || f?.archetype;
  if (a && schema.archetypes[a]) return a;
  const alias = a ? schema.archetypeAliases[a] : null;
  return alias && schema.archetypes[alias] ? alias : null;
}

/** The furniture entries `originalItems` reads: the living room's (default) or the house's, per room. */
function sourceFurniture(layout, rooms) {
  if (rooms == null) return layout?.furniture ?? layout?.spec?.furniture ?? [];
  const all = layout?.house?.furniture ?? layout?.spec?.furniture ?? layout?.furniture ?? [];
  if (rooms === 'all') return all;
  const want = new Set(Array.isArray(rooms) ? rooms : [rooms]);
  return all.filter((f) => want.has(f.roomId ?? LIVING_ROOM));
}

/**
 * Item specs for the furniture entries in room-spec (the ORIGINAL design).
 *
 * Without options it reads the living room's furniture (`layout.furniture`, the old field) – exactly as before the
 * rest of the house came. `{ rooms: 'all' }` reads every room of the house (`layout.house.furniture`, hele-huset §1.8),
 * `{ rooms: ['soverom', …] }` only those rooms (an entry without roomId is the living room's). An entry from another
 * room carries `roomId` and `level` (the level id) and keeps its y over its room's floor (level-local, §1.1 and §5.5:
 * the caller adds the room's floorY). Decor the photo notes call optional (`optional: true`) becomes a hidden original
 * (`hidden: true`, `optional: true`). An entry whose archetype the models do not know is left out with a warning –
 * it never silently becomes a vase (the validator rejects it in the data already).
 *
 * @param {Object} layout  home/layout.js object (or anything with `furniture`, `wallsById`, `ceilingHeightAt`)
 * @param {{ rooms?: 'all'|string|string[] }} [opts]
 * @returns {Object[]} item specs for DesignState.add (with stable uids 'ex-<spec id>')
 */
export function originalItems(layout, opts = {}) {
  const furniture = sourceFurniture(layout, opts?.rooms);
  const items = [];
  for (const f of furniture) {
    if (f.kind === 'decor-group') {
      items.push(...splitDecorGroup(f));
      continue;
    }
    const archetype = archetypeOf(f);
    if (!archetype) {
      if (!warnedUnknown.has(f.id)) {
        warnedUnknown.add(f.id);
        console.warn(`[existing] ${f.id}: unknown archetype «${f.archetype ?? f.kind}» – left out of the original design`);
      }
      continue;
    }
    const def = schema.archetypes[archetype];
    const mount = f.mount || def.mount;
    const dims = { w: f.dims.w, d: f.dims.d, h: f.dims.h };
    const { params: cleaned, notes } = cleanParams(f.params);
    const parts = canonicalParts(archetype, f.colors, f.materials);
    const params = { ...translateParams(f, archetype, cleaned), ...parts.params };
    const position = mount === 'wall' && Array.isArray(f.center) ? [...f.center] : [...f.position];
    let m2 = ABSORPTION_BY_ID[f.id] ?? 0;
    if (archetype === 'rug') m2 = rugAbsorption(params, dims);
    const item = {
      uid: `ex-${f.id}`,
      source: 'existing',
      refId: f.id,
      name: f.name,
      category: CATEGORY_BY_ARCHETYPE[archetype] || 'smatt',
      archetype,
      mount,
      position,
      rotationDeg: f.rotationDeg ?? 0,
      dims,
      params,
      colors: parts.colors,
      materials: parts.materials,
      variantIndex: 0,
      acoustic: { m2, ref: { ...dims } },
      notes: [f.notes, ...notes].filter(Boolean).join(' · '),
      confidence: f.confidence ?? 'med',
    };
    // the rest of the house: which room and level the item stands in (its y is over that room's floor)
    if (f.roomId != null) {
      item.roomId = f.roomId;
      item.level = f.levelId ?? layout?.house?.room?.(f.roomId)?.levelId ?? null;
    }
    if (f.optional === true) {
      item.optional = true;
      item.hidden = true;
      item.notes = ['Valgfri pynt (skjult til den slås på).', item.notes].filter(Boolean).join(' ');
    }
    if (mount === 'wall' && f.wallId) item.attach = wallAttach(layout, f.wallId);
    if (f.light) {
      // the room-spec may give the level a lamp starts at (the chandelier: 0.29), else full
      const dimmer = Number.isFinite(f.light.dimmer) ? Math.min(1, Math.max(0, f.light.dimmer)) : 1;
      item.light = { on: f.light.on !== false, dimmer, colorK: f.light.colorK ?? 2700, lumens: f.light.lumens ?? 800 };
    }
    items.push(clone(item));
  }
  liftOntoRugs(items);
  return items;
}

/**
 * Floor furniture whose centre stands on a rug stands ON it (the same rule Placement uses for new placements):
 * otherwise thin floor rings / frames (settbord, TV coffee table) disappear into the 1.5–2 cm pile (tables.md #2).
 * Only a rug in the same room counts (the basement lies under the first floor, at the same x/z).
 * @param {object[]} items  original item specs (mutated)
 */
function liftOntoRugs(items) {
  const rugs = items.filter((it) => it.archetype === 'rug' && !it.hidden);
  const roomOf = (it) => it.roomId ?? LIVING_ROOM;
  for (const it of items) {
    if (it.mount !== 'floor' || it.archetype === 'rug' || (it.position[1] ?? 0) > 0.001) continue;
    for (const r of rugs) {
      if (roomOf(r) !== roomOf(it)) continue;
      const a = (-(r.rotationDeg || 0) * Math.PI) / 180;
      const dx = it.position[0] - r.position[0], dz = it.position[2] - r.position[2];
      // into the rug frame (rotation.y = rotationDeg)
      const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
      const hw = r.dims.w / 2, hd = r.dims.d / 2;
      const round = r.params?.shape === 'round' || r.params?.shape === 'oval';
      const inside = round ? (lx / hw) ** 2 + (lz / hd) ** 2 <= 1 : Math.abs(lx) <= hw && Math.abs(lz) <= hd;
      if (inside) it.position[1] = Math.max(it.position[1] || 0, Math.round((r.dims.h || 0) * 1000) / 1000);
    }
  }
}

/** Total absorption (m²) of the original furniture – used by Acoustics for the calibration. */
export function originalAbsorption(layout) {
  return originalItems(layout).reduce((s, it) => s + (it.acoustic?.m2 ?? 0), 0);
}
