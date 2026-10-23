/**
 * The site test house (notes/uteomradet.md): a house with a walk-out basement on a lot that falls to the south, built
 * with the game's own builders by dev/uteomrade.html (look at it, walk round it) and
 * tools/house-tests/uteomrade.test.mjs (build it in Node, check it).
 *
 *   house   x 0–12, z 0–9 (outer faces): a basement (floor −2.7) and the main level (floor 0) with a gable roof, stående
 *           kledning on a concrete plinth, the basement rendered. Doors: the entrance in the north wall (the ground
 *           0.25 under the floor: landing slabs), a side door in the east wall (the ground ≈ 1 m down: a porch with
 *           steps, auto), the terrace door in the south wall (a deck on posts with a long stair down to the lawn on the
 *           west) and the basement's walk-out door in the south wall (the ground at its step: the patio)
 *   terrain one line per facade: −0.2…−0.35 along the north wall, −2.85 along the south wall (the basement stands
 *           free), the side walls falling between them; spot heights further out (up to the road in the north-east,
 *           a flatter lawn in the south)
 *   site    a driveway (asphalt, following the ground) from the road in the east to a gravel yard (level, cut into the
 *           slope: a retaining wall along its north edge), a path of slabs from the entrance to the yard (auto), a
 *           paver patio in front of the walk-out, garden steps with cheek walls from the yard down to the lawn, a
 *           picket fence along the south boundary, a hedge along the west, a screen east of the patio, a low stone
 *           wall on the lawn
 *
 *   uteHus() → { house }        uteSpec(house) → the spec for buildLayout (as the planbygger's viewer does it)
 *
 * z = 0 is the south side (the sun on the test page comes from −z).
 */

const T = 0.3; // exterior walls
const H = 2.4; // wall height

let nOpen = 0;
const win = (offset, width, height, sill, extra = {}) => ({
  id: `win-ute-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color: '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 }, ...(sill > 0 ? { sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } } : {}),
  sashes: [{ opening: true }], ...extra,
});
const door = (id, offset, width, roomId, extra = {}) => ({
  id, type: 'door', offset, width, height: 2.1, sill: 0,
  frame: { color: '#25272b', width: 0.05, depth: 0.06 }, reveal: { depth: 0.21 },
  door: { hinge: 'from', swing: 'out', opensInto: 'ute', openAngleDeg: 95 }, connects: [roomId, 'ute'], interactive: true, ...extra,
});

/** The four walls of a rectangular room (outer faces x0…x1, z0…z1), the room on the right of from → to. */
function boxWalls(prefix, roomId, [x0, z0, x1, z1], openings = {}) {
  const a = [x0 + T, z0 + T], b = [x1 - T, z0 + T], c = [x1 - T, z1 - T], d = [x0 + T, z1 - T];
  const defs = [['s', a, b, [0, 1]], ['o', b, c, [-1, 0]], ['n', c, d, [0, -1]], ['v', d, a, [1, 0]]];
  return {
    polygon: [a, b, c, d],
    walls: defs.map(([k, from, to, normal]) => ({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: T, height: H, exterior: true, color: '#ece9e3', openings: openings[k] ?? [] })),
  };
}
const room = (id, name, levelId, polygon, kind) => ({
  id, name, levelId, kind, polygon, floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' }, ceilingIds: [`c-${id}`], acoustic: { mode: 'estimate' },
});

/** The test house. */
export function uteHus() {
  nOpen = 0;
  // the walls run from a = (x0 + T, z0 + T): offsets along the south wall from x 0.3, along the east wall from z 0.3,
  // along the north wall from x 11.7 (westward), along the west wall from z 8.7 (southward)
  const k = boxWalls('k', 'u-kjeller', [0, 0, 12, 9], {
    s: [win(1.7, 1.6, 1.2, 0.9), win(4.7, 1.6, 1.2, 0.9), door('door-ute-kjeller', 8.4, 1.0, 'u-kjeller')],
    o: [win(3.2, 1.0, 0.6, 1.5)],
  });
  const m = boxWalls('h', 'u-stue', [0, 0, 12, 9], {
    s: [win(0.6, 1.4, 1.5, 0.7), door('door-ute-terrasse', 3.2, 1.0, 'u-stue'), win(4.7, 1.6, 1.5, 0.7), win(8.7, 2.0, 1.5, 0.7)],
    o: [win(1.2, 1.4, 1.3, 0.8), door('door-ute-side', 5.6, 0.9, 'u-stue')],
    n: [win(1.0, 1.2, 1.2, 0.9), door('door-ute-inngang', 6.0, 1.0, 'u-stue'), win(8.6, 1.2, 1.2, 0.9)],
    v: [win(3.2, 1.6, 1.3, 0.8)],
  });
  const house = {
    levels: [
      { id: 'kjeller', name: 'Kjeller', floorY: -2.7, slabThickness: 0.3, ceilingDefault: H },
      { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H },
    ],
    rooms: [room('u-kjeller', 'Kjellerstue', 'kjeller', k.polygon, 'living'), room('u-stue', 'Stue', 'hoved', m.polygon, 'living')],
    walls: [...k.walls, ...m.walls],
    ceilings: [
      { id: 'c-u-kjeller', roomId: 'u-kjeller', polygon: k.polygon, height: H, color: '#f4f2ee' },
      { id: 'c-u-stue', roomId: 'u-stue', polygon: m.polygon, height: H, color: '#f4f2ee' },
    ],
    roofs: [{ id: 'roof-ute', type: 'gable', levelId: 'hoved', outline: [[0, 0], [12, 0], [12, 9], [0, 9]], pitch: 30, ridge: [1, 0], covering: 'tile' }],
    cladding: {
      default: { type: 'wood', direction: 'vertical', profile: 'board-batten', color: '#5d5a54' },
      plinth: { height: 0.3, material: 'concrete' },
      trim: { color: '#f2f0eb', corners: true, surrounds: true },
    },
    decks: [
      {
        id: 'u-terrasse', kind: 'terrace', levelId: 'hoved', y: -0.02, outline: [[1, -3.5], [7, -3.5], [7, 0], [1, 0]],
        surface: 'boards', supports: 'posts', railing: { type: 'glass' }, stairs: [{ edge: 3, at: 1.6, width: 1.0 }],
      },
    ],
    site: {
      lot: [[-10, -12], [26, -12], [26, 22], [-10, 22]],
      terrain: {
        lines: [
          { id: 'nord', side: 'nord', points: [[12, 9, -0.35], [6, 9, -0.25], [0, 9, -0.2]] },
          { id: 'sor', side: 'sør', points: [[0, 0, -2.85], [12, 0, -2.85]] },
          { id: 'ost', side: 'øst', points: [[12, 0, -2.85], [12, 3, -2.2], [12, 6, -1.15], [12, 9, -0.35]] },
          { id: 'vest', side: 'vest', points: [[0, 9, -0.2], [0, 6, -1.0], [0, 3, -2.1], [0, 0, -2.85]] },
        ],
        points: [[6, 20, 0.6], [22, 18, 0.4], [-6, 16, 0.3], [6, -10, -3.4], [20, -9, -3.3], [-7, -9, -3.3]],
      },
      surfaces: [
        { id: 'innkjorsel', kind: 'driveway', surface: 'asphalt', path: [[26.5, 11.6], [21, 11.6], [19.5, 11.6]], width: 3.4 },
        { id: 'gardsplass', kind: 'yard', surface: 'gravel', outline: [[12.6, 9.6], [20, 9.6], [20, 14], [12.6, 14]], y: -0.3, walls: [2] },
        { id: 'uteplass', kind: 'patio', surface: 'pavers', outline: [[7.6, -4.2], [12.4, -4.2], [12.4, 0], [7.6, 0]], y: -2.85 },
        { id: 'bed-vest', kind: 'bed', outline: [[-0.4, 1.0], [-0.4, 7.5], [-1.4, 7.5], [-1.4, 1.0]] },
      ],
      walls: [{ id: 'steinmur', line: [[-6, -9], [-6, -3], [-4, 2]], height: 0.5, material: 'stone' }],
      fences: [
        { id: 'stakitt-sor', kind: 'fence', line: [[-9.5, -11.5], [25.5, -11.5]] },
        { id: 'hekk-vest', kind: 'hedge', line: [[-9.5, -10.5], [-9.5, 21.5]] },
        { id: 'levegg', kind: 'screen', line: [[13.0, -4.4], [13.0, -0.6]] },
      ],
      steps: [{ id: 'hagetrapp', from: [17.5, 9.3], to: [17.5, 1.2], width: 1.2, material: 'stone' }],
    },
  };
  return { house };
}

/** The spec for buildLayout: the house on the empty base the planbygger's viewer uses (as src/dev/kledning-hus.js). */
export function uteSpec(house) {
  return {
    meta: { name: 'Uteområde', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
    roofs: house.roofs,
    cladding: house.cladding,
    decks: house.decks,
    site: house.site,
  };
}
