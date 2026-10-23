/**
 * The test houses for fireplaces and stoves (notes/peis-og-ovn.md): four small houses side by side, each its own house
 * file, built with the game's own builders by dev/peis.html (look at them, light the fires, walk into them) and
 * tools/house-tests/peis.test.mjs (build them in Node, check them).
 *
 *   A  x 0–10    hus4: two storeys, a round wood stove in the living room upstairs (the round symbol of 2etg.avif) by
 *                the bedroom wall on a glass plate, its steel chimney straight up from it through the mono-pitch roof
 *                (fasade 1) – nothing of it on the ground floor
 *   B  x 14–23   an open fireplace in brick against the north wall (mantel, stone hearth), its brick chimney inside the
 *                surround and through the gable roof; a tall fireplace stove in the south-west corner on a quarter
 *                glass plate, its steel chimney through the roof by the eave
 *   C  x 28–36   a basement and a ground floor under a hip roof: an insert in a rendered surround against the west
 *                wall, its rendered chimney from the basement floor (a box in the basement) up through the roof
 *   D  x 42–50   a mono-pitch roof open inside: an insert in a white panel surround (2.2 m) against the east wall with
 *                its steel chimney from the surround's top; a box stove in front of a brick chimney against the north
 *                wall with a flue pipe into it, on a steel plate
 *
 *   peisHus() → [{ key, name, house }]
 *   peisSpec(house) → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * z = 0 is the south side.
 */

const T = 0.3; // exterior walls
const H = 2.4; // wall height

let nOpen = 0;
const win = (offset, width, height, sill, extra = {}) => ({
  id: `win-ps-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color: extra.color ?? '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 },
  ...(sill > 0 ? { sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } } : {}),
  sashes: [{ opening: true }], ...extra,
});
const door = (offset, width, roomId, extra = {}) => ({
  id: `door-ps-${++nOpen}`, type: 'door', offset, width, height: extra.height ?? 2.1, sill: 0,
  frame: { color: extra.color ?? '#25272b', width: 0.05, depth: 0.06 }, reveal: { depth: 0.21 },
  door: { hinge: 'from', swing: 'out', opensInto: 'ute', openAngleDeg: 95 }, connects: [roomId, 'ute'],
});

/**
 * The four walls of a rectangular room (outer faces x0…x1, z0…z1; the room inside by T), the room on the right of
 * from → to. sides: { s, o, n, v } = { exterior?, openings?, thickness?, backOf?, height? } per side (south z0, east
 * x1, north z1, west x0). Wall ids w-<prefix>-<side>.
 */
function boxWalls(prefix, roomId, [x0, z0, x1, z1], sides = {}, height = H) {
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
const room = (id, name, levelId, polygon, kind = 'living', floor = {}) => ({
  id, name, levelId, kind, polygon, floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x', ...floor }, ceilingIds: [`c-${id}`], acoustic: { mode: 'estimate' },
});
const LEVELS = {
  kjeller: { id: 'kjeller', name: 'Kjeller', floorY: -2.55, slabThickness: 0.3, ceilingDefault: 2.2 },
  hoved: { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H },
  etasje2: { id: 'etasje2', name: '2. etasje', floorY: 2.7, slabThickness: 0.3, ceilingDefault: H },
};

/** A house file from its parts. */
function houseOf(levels, parts, extra) {
  const h = { levels: levels.map((id) => ({ ...LEVELS[id] })), rooms: [], walls: [], ceilings: [], ...extra };
  for (const { r, w, c } of parts) {
    h.rooms.push(r);
    h.walls.push(...w);
    // (a ceiling that follows the roof is open to it unless it has its own height – a collar beam)
    h.ceilings.push({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon, ...(c?.type === 'roof' ? {} : { height: c?.height ?? H }), color: '#f4f2ee', ...c });
  }
  return h;
}

/** The test houses. */
export function peisHus() {
  nOpen = 0;
  const out = [];

  // ---- A: hus4 – a round stove upstairs by the bedroom wall, its steel chimney from it through the mono-pitch roof
  {
    const g = boxWalls('a1', 'a-tv', [0, 0, 10, 8], {
      s: { openings: [win(1.2, 1.2, 1.2, 0.9), door(4.4, 1.0, 'a-tv'), win(6.8, 2.0, 1.2, 0.9)] },
      n: { openings: [win(3.0, 1.0, 0.6, 1.5)] },
    });
    const sov = boxWalls('a2v', 'a-sov', [0, 0, 3.6, 8], {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [win(1.0, 1.0, 1.2, 0.9)] },
    });
    const stue = boxWalls('a2o', 'a-stue', [3.5, 0, 10, 8], {
      v: { backOf: 'w-a2v-o', thickness: 0.1 },
      s: { openings: [win(1.0, 0.6, 2.0, 0.4), win(2.6, 1.4, 2.0, 0.4), win(4.6, 0.6, 2.0, 0.4)] },
      o: { openings: [win(2.6, 1.2, 1.3, 0.8)] },
    });
    out.push({
      key: 'A', name: 'A: hus4 – rund vedovn oppe, stålpipe',
      house: houseOf(['hoved', 'etasje2'], [
        { r: room('a-tv', 'A: TV-stue', 'hoved', g.polygon), w: g.walls },
        { r: room('a-sov', 'A: Soverom', 'etasje2', sov.polygon, 'bedroom'), w: sov.walls, c: { type: 'roof', height: H } },
        { r: room('a-stue', 'A: Stue/kjøkken', 'etasje2', stue.polygon), w: stue.walls, c: { type: 'roof' } },
      ], {
        roofs: [{ id: 'roof-a', name: 'A: pulttak', type: 'mono-pitch', levelId: 'etasje2', outline: [[0, 0], [10, 0], [10, 8], [0, 8]], pitch: 8, fall: [0, -1], covering: 'steel', color: '#3a3c40' }],
        chimneys: [{ id: 'pipe-a', material: 'steel' }],
        fireplaces: [{ id: 'ovn-a', name: 'Vedovn i stua', type: 'stove', shape: 'round', roomId: 'a-stue', at: [4.2, 5.9], chimney: 'pipe-a', hearth: { material: 'glass' } }],
        cladding: {
          default: { type: 'wood', direction: 'horizontal', profile: 'shiplap', color: '#c9b293' },
          trim: { color: '#f2f0eb', corners: true, surrounds: false },
        },
      }),
    });
  }

  // ---- B: an open fireplace in brick against the north wall, a fireplace stove in the south-west corner
  {
    const g = boxWalls('b1', 'b-stue', [14, 0, 23, 8], {
      s: { openings: [win(2.4, 1.2, 1.3, 0.8), win(4.6, 2.2, 2.1, 0, { sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] })] },
      o: { openings: [win(2.2, 1.2, 1.3, 0.8), door(5.0, 1.0, 'b-stue')] },
      n: { openings: [win(0.8, 1.0, 1.2, 0.9), win(6.6, 1.0, 1.2, 0.9)] },
      v: { openings: [win(4.0, 1.2, 1.2, 0.9)] },
    });
    out.push({
      key: 'B', name: 'B: åpen peis i tegl, peisovn i hjørnet',
      house: houseOf(['hoved'], [{ r: room('b-stue', 'B: Stue', 'hoved', g.polygon), w: g.walls, c: { height: 2.5 } }], {
        roofs: [{ id: 'roof-b', name: 'B: saltak', type: 'gable', levelId: 'hoved', outline: [[14, 0], [23, 0], [23, 8], [14, 8]], pitch: 35, ridge: [1, 0], covering: 'tile', color: '#4a2f28' }],
        chimneys: [
          { id: 'pipe-b1', material: 'brick', color: '#7d4636' },
          { id: 'pipe-b2', material: 'steel' },
        ],
        fireplaces: [
          { id: 'peis-b', name: 'Åpen peis', type: 'open', wall: 'w-b1-n', offset: 4.2, chimney: 'pipe-b1', surround: { kind: 'masonry', material: 'brick', color: '#8a4b3c' } },
          { id: 'peisovn-b', name: 'Peisovn i hjørnet', type: 'fireplace-stove', at: [14.95, 0.95], chimney: 'pipe-b2' },
        ],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#e8e4dc' },
          trim: { color: '#f4f2ee', corners: true, surrounds: true },
        },
      }),
    });
  }

  // ---- C: a basement and a ground floor: an insert in a rendered surround, its chimney from the basement floor
  {
    const k = boxWalls('c0', 'c-kjeller', [28, 0, 36, 7], { s: { openings: [win(1.5, 1.0, 0.5, 1.5)] } }, 2.2);
    const g = boxWalls('c1', 'c-stue', [28, 0, 36, 7], {
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(3.8, 2.0, 1.3, 0.8)] },
      o: { openings: [door(2.6, 1.0, 'c-stue')] },
      n: { openings: [win(1.0, 1.0, 1.2, 0.9), win(5.0, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'C', name: 'C: murt peisinnsats, pipe fra kjelleren',
      house: houseOf(['kjeller', 'hoved'], [
        { r: room('c-kjeller', 'C: Kjeller', 'kjeller', k.polygon, 'storage', { material: 'concrete', color: '#9a978f' }), w: k.walls, c: { height: 2.2 } },
        { r: room('c-stue', 'C: Stue', 'hoved', g.polygon), w: g.walls },
      ], {
        roofs: [{ id: 'roof-c', name: 'C: valmtak', type: 'hip', levelId: 'hoved', outline: [[28, 0], [36, 0], [36, 7], [28, 7]], pitch: 25, covering: 'tile', color: '#3b3735' }],
        chimneys: [{ id: 'pipe-c', material: 'render', color: '#dedad2' }],
        fireplaces: [{ id: 'peis-c', name: 'Peisinnsats', type: 'insert', wall: 'w-c1-v', chimney: 'pipe-c', surround: { kind: 'masonry', material: 'render', color: '#ece9e3' } }],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#5b6b62' },
          trim: { color: '#ece9e3', corners: true, surrounds: true },
        },
      }),
    });
  }

  // ---- D: an insert in a white panel surround with a steel chimney; a stove in front of a brick chimney
  {
    const g = boxWalls('d1', 'd-stue', [42, 0, 50, 7], {
      s: { openings: [win(1.0, 1.2, 1.3, 0.8), win(4.2, 2.4, 2.1, 0, { sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] })] },
      v: { openings: [win(2.6, 1.2, 1.2, 0.9), door(4.6, 1.0, 'd-stue')] },
      n: { openings: [win(4.6, 1.4, 0.8, 1.9)] },
    });
    out.push({
      key: 'D', name: 'D: platekledd innsats, vedovn med røykrør',
      house: houseOf(['hoved'], [{ r: room('d-stue', 'D: Stue åpen til taket', 'hoved', g.polygon), w: g.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-d', name: 'D: pulttak', type: 'mono-pitch', levelId: 'hoved', outline: [[42, 0], [50, 0], [50, 7], [42, 7]], pitch: 12, fall: [0, -1], covering: 'steel', color: '#2b2e33' }],
        chimneys: [
          { id: 'pipe-d1', material: 'steel' },
          { id: 'pipe-d2', material: 'brick', at: [44.6, 6.45], size: [0.5, 0.5], color: '#7d4636' },
        ],
        fireplaces: [
          { id: 'peis-d', name: 'Peisinnsats, platekledd', type: 'insert', wall: 'w-d1-o', offset: 2.2, size: [1.0, 0.55, 2.2], chimney: 'pipe-d1', surround: { kind: 'panel', color: '#f2f0eb' } },
          { id: 'ovn-d', name: 'Vedovn foran pipa', type: 'stove', chimney: 'pipe-d2', hearth: { material: 'steel' } },
        ],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#e8e6e0' },
          trim: { color: '#2b2d31', corners: false, surrounds: true },
        },
      }),
    });
  }
  return out;
}

/**
 * The spec for buildLayout: the house on the empty base the planbygger's viewer uses (a zero-area living-room floor
 * at the first corner). With roofs the cladding follows them (notes/tak.md), so no «roof line» ceiling.
 */
export function peisSpec(house) {
  return {
    meta: { name: 'Peis og ovn', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
    zones: [],
    floor: { polygon: [[0, 0], [0, 0], [0, 0]], material: 'oak-plank', color: '#b8a48c' },
    baseboard: { height: 0.07, thickness: 0.012, color: '#ece9e3' },
    walls: house.walls,
    ceilings: house.ceilings,
    bulkheads: [],
    builtInLights: [],
    kitchen: { items: [] },
    furniture: [],
    fixtures: [],
    highWall: { wallId: null, name: '', start: [0, 0], end: [0, 0], uDir: [1, 0], normal: [0, 1], width: 0, height: 0, obstacles: [] },
    outside: {},
    photoCameras: [],
    levels: house.levels,
    rooms: house.rooms,
    ...(house.roofs ? { roofs: house.roofs } : {}),
    ...(house.cladding ? { cladding: house.cladding } : {}),
    ...(house.decks ? { decks: house.decks } : {}),
    ...(house.chimneys ? { chimneys: house.chimneys } : {}),
    ...(house.fireplaces ? { fireplaces: house.fireplaces } : {}),
  };
}
