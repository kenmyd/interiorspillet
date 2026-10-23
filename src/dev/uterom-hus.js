import { kledningSpec } from './kledning-hus.js';

/**
 * The outdoor-room test house (notes/uterom.md), modelled on hus4's carport under the terrace (planbygger F149): a
 * two-storey house with a covered entrance under the upper floor, and a one-storey annex beside it – a carport open
 * to the south and a storage room behind it – under a terrace from the upper floor. Built with the game's own
 * builders by dev/uterom.html (look at it) and tools/house-tests/uterom.test.mjs (build it in Node, check it).
 *
 *   x 0–7    the house: hoved f-gang (entrance hall) and f-stue, etg2 f-sov over both; a gable roof
 *            f-port (porch, outdoor) in front of the hall under f-sov: open to the south and the west (two walls that
 *            are one opening each, a corner post between them), paving, a white board soffit, the front door
 *   x 7–13   the annex: f-carport (outdoor) open to the south (a wall that is one opening, a beam over it), concrete,
 *            its doors into f-stue (owned by the stue's wall) and into f-bod (owned by the carport's wall: the turned
 *            outer door), the bod front in grey facade panels with a grey door (F149); f-bod (indoor storage)
 *            a terrace (boards, glass railing) over the annex from a door in f-sov
 *
 *   uteromHus() → { key, name, house }
 *   uteromSpec(house) → the spec for buildLayout (kledningSpec + the lamps and their groups)
 *
 * z = 0 is the south side.
 */

const T = 0.3; // exterior walls and the house's wall to the annex
const P = 0.15; // partitions
const GREY = '#6f7377'; // the bod front's panels, its door and frame (F149)

let nOpen = 0;
const win = (offset, width, height, sill) => ({
  id: `win-ut-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color: '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 }, sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 },
  sashes: [{ opening: true }],
});
/** A door of the owner wall's room `owner` into `other` (swing 'in' = into the owner's room). */
const door = (offset, width, owner, other, { swing = 'out', color = '#25272b', hinge = 'from' } = {}) => ({
  id: `door-ut-${++nOpen}`, type: 'door', offset, width, height: 2.1, sill: 0,
  frame: { color, width: 0.05, depth: 0.06 }, reveal: { depth: 0.21 },
  door: { hinge, swing, opensInto: swing === 'in' ? owner : other, openAngleDeg: 95, leafColor: color },
  connects: [owner, other],
});
/** A passage over a wall's length (the open side of the carport / the porch: a wall that is one opening). */
const passage = (length, height, roomId) => ({ id: `open-ut-${++nOpen}`, type: 'opening', offset: 0.01, width: length - 0.02, height, sill: 0, connects: [roomId, 'ute'] });

/**
 * The four walls of a rectangular room (outer faces x0…x1, z0…z1; the room inside by each side's thickness), as
 * src/dev/kledning-hus.js. sides: { s, o, n, v } = { exterior?, openings?, thickness?, backOf?, height? } per side
 * (south z0, east x1, north z1, west x0). Wall ids w-<prefix>-<side>.
 */
function boxWalls(prefix, roomId, [x0, z0, x1, z1], height, sides = {}) {
  const t = (k) => sides[k]?.thickness ?? T;
  const a = [x0 + t('v'), z0 + t('s')], b = [x1 - t('o'), z0 + t('s')], c = [x1 - t('o'), z1 - t('n')], d = [x0 + t('v'), z1 - t('n')];
  const defs = [['s', a, b, [0, 1]], ['o', b, c, [-1, 0]], ['n', c, d, [0, -1]], ['v', d, a, [1, 0]]];
  const walls = [];
  for (const [k, from, to, normal] of defs) {
    const s = sides[k] || {};
    if (s.backOf) walls.push({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: 0, height, backOf: s.backOf, color: '#ece9e3' });
    else walls.push({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: t(k), height, exterior: s.exterior ?? true, color: '#ece9e3', openings: s.openings ?? [] });
  }
  return { polygon: [a, b, c, d], walls };
}
const lengthOf = (w) => Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);

/** The test house. */
export function uteromHus() {
  nOpen = 0;
  // ---- hoved: the hall, the living room, the porch in front of the hall (under f-sov)
  const stue = boxWalls('f-stue', 'f-stue', [3.0, 0, 7, 8], 2.5, {
    s: { openings: [win(1.0, 2.0, 1.5, 0.6)] },
    o: { exterior: false, openings: [door(3.0, 1.0, 'f-stue', 'f-carport')] }, // to the carport: an outer door, swing out
    n: { openings: [win(1.2, 1.2, 1.2, 0.9)] },
    v: { exterior: false, thickness: P, openings: [door(3.4, 0.9, 'f-stue', 'f-gang', { swing: 'in' })] },
  });
  const gang = boxWalls('f-gang', 'f-gang', [0, 1.8, 3.15, 8], 2.5, {
    s: { exterior: false, openings: [door(0.8, 1.0, 'f-gang', 'f-port', { color: '#2b2e33' })] }, // the front door
    o: { backOf: 'w-f-stue-v', thickness: P },
    n: { openings: [win(1.0, 0.8, 1.0, 1.1)] },
    v: { openings: [win(2.4, 0.8, 1.2, 0.9)] },
  });
  const port = boxWalls('f-port', 'f-port', [0, 0, 3.15, 2.1], 2.5, {
    n: { backOf: 'w-f-gang-s', thickness: T },
    o: { backOf: 'w-f-stue-v', thickness: P },
  });
  port.walls.find((w) => w.id === 'w-f-port-s').openings.push(passage(2.7, 2.2, 'f-port'));
  port.walls.find((w) => w.id === 'w-f-port-v').openings.push(passage(1.5, 2.2, 'f-port'));
  // ---- the annex: the carport (its open side a wall that is one opening) and the storage room behind it
  const carport = boxWalls('f-carport', 'f-carport', [6.7, 0, 13, 5.5], 2.3, {
    v: { backOf: 'w-f-stue-o', thickness: T },
    n: { exterior: false, thickness: P, openings: [door(2.0, 0.9, 'f-carport', 'f-bod', { swing: 'in', color: GREY, hinge: 'to' })] }, // the bod door: swings out into the carport
  });
  const cs = carport.walls.find((w) => w.id === 'w-f-carport-s');
  cs.openings.push(passage(lengthOf(cs), 2.1, 'f-carport'));
  const bod = boxWalls('f-bod', 'f-bod', [6.7, 5.35, 13, 8], 2.3, {
    v: { backOf: 'w-f-stue-o', thickness: T },
    s: { backOf: 'w-f-carport-n', thickness: P },
    o: { openings: [win(0.8, 0.8, 0.6, 1.3)] },
  });
  // ---- etg2: the bedroom over the house, its door to the terrace
  const sov = boxWalls('f-sov', 'f-sov', [0, 0, 7, 8], 2.4, {
    s: { openings: [win(1.2, 1.4, 1.3, 0.8), win(4.2, 1.4, 1.3, 0.8)] },
    o: { openings: [door(3.2, 1.0, 'f-sov', 'ute')] },
    n: { openings: [win(2.6, 1.2, 1.2, 0.9)] },
    v: { openings: [win(3.0, 1.0, 1.2, 0.9)] },
  });

  const room = (id, name, levelId, polygon, kind, floor, extra = {}) => ({
    id, name, levelId, kind, polygon, floor, ceilingIds: [`c-${id}`], acoustic: { mode: 'estimate' }, ...extra,
  });
  const oak = { material: 'oak-plank', color: '#b8a48c', boards: 'x' };
  const skirting = { height: 0.07, thickness: 0.012, color: '#ece9e3' }; // (none in the carport: it is outside)
  const rooms = [
    [room('f-stue', 'F: Stue', 'hoved', stue.polygon, 'living', oak), stue.walls, 2.5],
    [room('f-gang', 'F: Gang', 'hoved', gang.polygon, 'entrance', { material: 'vinyl', color: '#7d7a78' }), gang.walls, 2.5],
    [room('f-port', 'F: Inngang', 'hoved', port.polygon, 'entrance', { material: 'paving', color: '#8f8b85' }, { outdoor: 'porch', soffit: { type: 'boards', color: '#ece9e3' } }), port.walls, 2.5],
    [room('f-carport', 'F: Carport', 'hoved', carport.polygon, 'storage', { material: 'concrete', color: '#a7a49e' }, { outdoor: 'carport', baseboard: skirting }), carport.walls, 2.3],
    [room('f-bod', 'F: Bod', 'hoved', bod.polygon, 'storage', { material: 'concrete', color: '#8a8580' }, { baseboard: skirting }), bod.walls, 2.3],
    [room('f-sov', 'F: Soverom', 'etg2', sov.polygon, 'bedroom', oak), sov.walls, 2.4],
  ];
  const at = (polygon) => [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length];
  const lamp = (id, roomId, type, [x, z], y, lumens, extra = {}) => ({ id, roomId, group: roomId, type, position: [x, y, z], lumens, lightColorK: 2800, ...extra });
  const [cx, cz] = at(carport.polygon);
  const house = {
    levels: [
      { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: 2.5 },
      { id: 'etg2', name: '2. etasje', floorY: 2.8, slabThickness: 0.3, ceilingDefault: 2.4 },
    ],
    rooms: rooms.map(([r]) => r),
    walls: rooms.flatMap(([, w]) => w),
    ceilings: rooms.map(([r, , h]) => ({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon, height: h, color: '#f4f2ee' })),
    lightGroups: rooms.map(([r]) => ({ id: r.id, label: r.name, roomId: r.id, dimmer: true, defaultDimmer: 0.6 })),
    builtInLights: [
      lamp('l-f-stue', 'f-stue', 'plafond', at(stue.polygon), 2.5, 1800, { dims: { d: 0.35, h: 0.07 } }),
      lamp('l-f-gang', 'f-gang', 'plafond', at(gang.polygon), 2.5, 900, { dims: { d: 0.35, h: 0.07 } }),
      lamp('l-f-bod', 'f-bod', 'plafond', at(bod.polygon), 2.3, 800, { dims: { d: 0.35, h: 0.07 } }),
      lamp('l-f-sov', 'f-sov', 'plafond', at(sov.polygon), 2.4, 1600, { dims: { d: 0.35, h: 0.07 } }),
      // outdoor lights: downlights in the soffits (as the planbygger should send them) …
      lamp('l-f-port', 'f-port', 'downlight', at(port.polygon), 2.5, 350, { dims: { d: 0.09 } }),
      lamp('l-f-carport-1', 'f-carport', 'downlight', [cx, cz - 1.4], 2.3, 350, { dims: { d: 0.09 } }),
      // … and a ceiling lamp as the planbygger sends one today: it becomes a downlight (layout.js, a validator warning)
      lamp('l-f-carport-2', 'f-carport', 'plafond', [cx, cz + 1.4], 2.3, 2400, { dims: { d: 0.35, h: 0.07 } }),
    ],
    roofs: [{ id: 'roof-f', type: 'gable', levelId: 'etg2', outline: [[0, 0], [7, 0], [7, 8], [0, 8]], pitch: 30, ridge: [0, 1], covering: 'tile' }],
    cladding: {
      default: { type: 'wood', direction: 'horizontal', profile: 'shiplap', color: '#8a6a4f' },
      zones: [{ id: 'bodfront', name: 'Bodfronten i carporten (F149)', walls: ['w-f-carport-n'], type: 'panels', color: GREY, module: [0.6, 2.4] }],
      plinth: { height: 0.3, material: 'concrete' },
      trim: { color: '#3a3633', corners: true, surrounds: true },
    },
    decks: [
      {
        // over the annex, from the door in f-sov, its edges on the annex's outer faces (the annex's cladding stops at
        // its underside)
        id: 'f-terrasse', kind: 'terrace', levelId: 'etg2', y: -0.02,
        outline: [[7, 0], [13, 0], [13, 8], [7, 8]],
        surface: 'boards', color: '#8b7d6b', supports: 'none', railing: { type: 'glass' },
      },
    ],
  };
  return { key: 'F', name: 'F: carport under terrasse, inngang under etasjen', house };
}

/** The spec for buildLayout: the cladding pages' empty base (kledningSpec) with the lamps and their groups. */
export function uteromSpec(house) {
  return { ...kledningSpec(house), builtInLights: house.builtInLights, lightGroups: house.lightGroups };
}
