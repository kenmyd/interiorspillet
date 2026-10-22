/**
 * The roof test houses (notes/tak.md): six small houses side by side, one per roof type, built with the game's own
 * builders by dev/tak.html (look at them) and tools/house-tests/tak.test.mjs (build them in Node, check them).
 *
 *   A  x 0–10    saltak (gable 40°, takstein) over a loft: 1 ½ etasje, knevegg 1,0 m, two rooms under the slope (one
 *                with a flat collar ceiling at 2,5 m and two roof windows in the slope, one open to the ridge with an
 *                ark (gable dormer) on the south side and a takopplett (shed dormer with a window) on the north side)
 *   B  x 14–24   valmtak (hip 30°, skifer), one storey: a room with a flat ceiling and one open to the roof
 *   C  x 28–36   pulttak (mono-pitch 12°, stålplater), one storey, the ceiling follows the roof
 *   D  x 40–46   flatt tak (papp), one storey
 *   E  x 50–58   saltak 24° (red tiles), one storey: «SKRÅ HIMLING 24°» – the living room open to the ridge
 *   F  x 62–70   an L: a main house and a lower wing (two gable parts), both rooms open to the roof – the valleys
 *
 *   takHus() → the house file (house format, like a planbygger house: no living room of the owner's)
 *   takSpec(house) → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * z = 0 is the south side (the sun on the test page comes from −z).
 */

const T = 0.3; // exterior walls
const H = 2.4; // wall height
const OWNER = { frame: { color: '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 }, sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } };

let nWin = 0;
const win = (offset, width, height, sill, extra = {}) => ({ id: `win-tak-${++nWin}`, type: 'window', offset, width, height, sill, ...OWNER, ...(sill > 0 ? {} : { sillBoard: undefined }), sashes: [{ opening: true }], ...extra });

/**
 * The four exterior walls of a rectangular room (outer faces x0…x1, z0…z1; the room inside by T), walls on the room's
 * face, the room on the right of from → to. sides: { s, o, n, v } = { exterior?, openings?, thickness? } per side
 * (south z0, east x1, north z1, west x0); `backOf` sides are another room's slab.
 */
function boxWalls(prefix, roomId, [x0, z0, x1, z1], sides = {}) {
  const t = (k) => sides[k]?.thickness ?? T;
  const a = [x0 + t('v'), z0 + t('s')], b = [x1 - t('o'), z0 + t('s')], c = [x1 - t('o'), z1 - t('n')], d = [x0 + t('v'), z1 - t('n')];
  const defs = [
    ['s', a, b, [0, 1]],
    ['o', b, c, [-1, 0]],
    ['n', c, d, [0, -1]],
    ['v', d, a, [1, 0]],
  ];
  const walls = [];
  for (const [k, from, to, normal] of defs) {
    const s = sides[k] || {};
    if (s.backOf) {
      walls.push({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: 0, height: H, backOf: s.backOf, color: '#ece9e3' });
      continue;
    }
    walls.push({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: t(k), height: H, exterior: s.exterior ?? true, color: '#ece9e3', openings: s.openings ?? [] });
  }
  return { polygon: [a, b, c, d], walls };
}

function room(id, name, levelId, polygon, extra = {}) {
  return {
    id, name, levelId, kind: extra.kind ?? 'bedroom', polygon,
    floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' },
    ceilingIds: [`c-${id}`],
    acoustic: { mode: 'estimate' },
  };
}

/** The house file. */
export function takHus() {
  nWin = 0;
  const rooms = [];
  const walls = [];
  const ceilings = [];
  const add = (r, w, c) => (rooms.push(r), walls.push(...w), ceilings.push(c));

  // ---- A: 1 ½ storey with a gable roof over the loft
  {
    const m = boxWalls('a1', 'a-stue', [0, 0, 10, 8], {
      s: { openings: [win(1.0, 1.2, 1.3, 0.8), win(4.2, 1.8, 2.1, 0, { sashes: [{ from: 0, to: 0.5 }, { from: 0.5, to: 1, opening: true, hinge: 'right' }] }), win(7.4, 1.2, 1.3, 0.8)] },
      n: { openings: [win(2.0, 1.0, 1.2, 0.9), win(6.4, 1.0, 1.2, 0.9)] },
      v: { openings: [win(3.1, 1.0, 1.2, 0.9)] },
      o: { openings: [win(3.1, 1.0, 1.2, 0.9)] },
    });
    add(room('a-stue', 'A: Stue', 'hoved', m.polygon, { kind: 'living' }), m.walls, { id: 'c-a-stue', roomId: 'a-stue', polygon: m.polygon, height: H, color: '#f4f2ee' });
    // the loft: two rooms split by a 0.1 slab at x 4.95–5.05 (owned by the west room)
    const w = boxWalls('a2v', 'a-sov', [0, 0, 5.05, 8], {
      o: { exterior: false, thickness: 0.1 },
      v: { openings: [win(2.85, 0.9, 1.1, 0.9, { panes: [2, 2] })] },
    });
    add(room('a-sov', 'A: Soverom (hanebjelke 2,5 m)', 'loft', w.polygon), w.walls, {
      id: 'c-a-sov', roomId: 'a-sov', type: 'roof', height: 2.5, polygon: w.polygon, color: '#f4f2ee',
      skylights: [
        { id: 'sk-tak-1', name: 'Takvindu i skråtaket', polygon: [[1.4, 0.9], [2.2, 0.9], [2.2, 2.0], [1.4, 2.0]], opening: true },
        { id: 'sk-tak-2', name: 'Takvindu, 1 × 2 ruter', polygon: [[3.0, 6.0], [3.8, 6.0], [3.8, 7.1], [3.0, 7.1]], panes: [1, 2] },
      ],
    });
    const e = boxWalls('a2o', 'a-hems', [4.95, 0, 10, 8], {
      v: { backOf: 'w-a2v-o', thickness: 0.1 },
      s: { openings: [win(1.95, 1.0, 1.2, 0.8)] }, // under the ark (x 6.5–8.5): x 7.0–8.0
      o: { openings: [win(2.85, 0.9, 1.1, 0.9, { panes: [2, 2] })] },
    });
    add(room('a-hems', 'A: Loftsstue (åpen til mønet)', 'loft', e.polygon), e.walls, { id: 'c-a-hems', roomId: 'a-hems', type: 'roof', polygon: e.polygon, color: '#f4f2ee' });
  }
  // ---- B: hip roof, one storey: a room with a flat ceiling and one open to the roof
  {
    const w = boxWalls('b1', 'b-sov', [14, 0, 19.05, 8], {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [win(1.7, 1.2, 1.2, 0.9)] },
      v: { openings: [win(3.2, 1.0, 1.2, 0.9)] },
    });
    add(room('b-sov', 'B: Flatt himling', 'hoved', w.polygon), w.walls, { id: 'c-b-sov', roomId: 'b-sov', polygon: w.polygon, height: H, color: '#f4f2ee' });
    const e = boxWalls('b2', 'b-stue', [18.95, 0, 24, 8], {
      v: { backOf: 'w-b1-o', thickness: 0.1 },
      s: { openings: [win(1.6, 1.6, 1.4, 0.7)] },
      o: { openings: [win(3.0, 1.2, 1.4, 0.7)] },
      n: { openings: [win(1.6, 1.2, 1.2, 0.9)] },
    });
    add(room('b-stue', 'B: Skrå himling (valm)', 'hoved', e.polygon, { kind: 'living' }), e.walls, { id: 'c-b-stue', roomId: 'b-stue', type: 'roof', polygon: e.polygon, color: '#f4f2ee' });
  }
  // ---- C: mono-pitch, one storey, the ceiling follows the roof
  {
    const w = boxWalls('c1', 'c-stue', [28, 0, 36, 6], {
      s: { openings: [win(1.2, 1.2, 1.2, 0.9), win(4.4, 2.4, 2.1, 0)] },
      n: { openings: [win(1.4, 3.0, 0.6, 2.4)] }, // a high strip under the high side
      o: { openings: [win(2.2, 1.0, 1.2, 0.9)] },
    });
    add(room('c-stue', 'C: Pulttak, himling følger taket', 'hoved', w.polygon, { kind: 'living' }), w.walls, { id: 'c-c-stue', roomId: 'c-stue', type: 'roof', polygon: w.polygon, color: '#f4f2ee' });
  }
  // ---- D: flat roof
  {
    const w = boxWalls('d1', 'd-rom', [40, 0, 46, 6], {
      s: { openings: [win(1.5, 2.4, 1.3, 0.7)] },
      o: { openings: [win(2.2, 1.0, 1.2, 0.9)] },
    });
    add(room('d-rom', 'D: Flatt tak', 'hoved', w.polygon), w.walls, { id: 'c-d-rom', roomId: 'd-rom', polygon: w.polygon, height: H, color: '#f4f2ee' });
  }
  // ---- E: gable 24°, the living room open to the ridge, a bedroom with a flat ceiling
  {
    const w = boxWalls('e1', 'e-stue', [50, 0, 55.05, 9], {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [win(0.9, 3.0, 2.1, 0)] },
      v: { openings: [win(3.9, 1.2, 1.2, 0.9)] },
      n: { openings: [win(1.6, 1.2, 1.2, 0.9)] },
    });
    add(room('e-stue', 'E: Skrå himling 24°', 'hoved', w.polygon, { kind: 'living' }), w.walls, { id: 'c-e-stue', roomId: 'e-stue', type: 'roof', polygon: w.polygon, color: '#f4f2ee' });
    const e = boxWalls('e2', 'e-sov', [54.95, 0, 58, 9], {
      v: { backOf: 'w-e1-o', thickness: 0.1 },
      s: { openings: [win(0.9, 1.0, 1.2, 0.9)] },
      o: { openings: [win(3.9, 1.0, 1.2, 0.9)] },
    });
    add(room('e-sov', 'E: Soverom, flatt', 'hoved', e.polygon), e.walls, { id: 'c-e-sov', roomId: 'e-sov', polygon: e.polygon, height: H, color: '#f4f2ee' });
  }
  // ---- F: an L – a main house with a lower wing, both open to the roof (the valleys inside and out)
  {
    const m = boxWalls('f1', 'f-stue', [62, 0, 70, 6], {
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(4.6, 1.8, 2.1, 0)] },
      v: { openings: [win(2.2, 1.0, 1.2, 0.9)] },
    });
    add(room('f-stue', 'F: L-hus, hovedfløy', 'hoved', m.polygon, { kind: 'living' }), m.walls, { id: 'c-f-stue', roomId: 'f-stue', type: 'roof', polygon: m.polygon, color: '#f4f2ee' });
    const w = boxWalls('f2', 'f-floy', [66, 5.7, 70, 11], {
      s: { backOf: 'w-f1-n', thickness: 0.3 },
      o: { openings: [win(1.6, 1.0, 1.2, 0.9)] },
      n: { openings: [win(1.2, 1.2, 1.2, 0.9)] },
    });
    add(room('f-floy', 'F: L-hus, sidefløy', 'hoved', w.polygon), w.walls, { id: 'c-f-floy', roomId: 'f-floy', type: 'roof', polygon: w.polygon, color: '#f4f2ee' });
  }

  return {
    levels: [
      { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H },
      { id: 'loft', name: 'Loft', floorY: 2.7, slabThickness: 0.3, ceilingDefault: H },
    ],
    rooms,
    walls,
    ceilings,
    roofs: [
      {
        id: 'roof-a', name: 'A: saltak med ark og takopplett', type: 'gable', levelId: 'loft', outline: [[0, 0], [10, 0], [10, 8], [0, 8]],
        pitch: 40, kneeHeight: 1.0, covering: 'tile',
        dormers: [
          { id: 'ark-a-sor', type: 'gable', front: [[6.5, 0], [8.5, 0]], height: 2.3 },
          { id: 'opp-a-nord', type: 'shed', front: [[8.0, 7.2], [6.0, 7.2]], height: 2.6, pitch: 10, window: { width: 1.2, height: 0.7 } },
        ],
      },
      { id: 'roof-b', name: 'B: valmtak', type: 'hip', levelId: 'hoved', outline: [[14, 0], [24, 0], [24, 8], [14, 8]], pitch: 30, covering: 'slate' },
      { id: 'roof-c', name: 'C: pulttak', type: 'mono-pitch', levelId: 'hoved', outline: [[28, 0], [36, 0], [36, 6], [28, 6]], pitch: 12, fall: [0, -1], covering: 'steel' },
      { id: 'roof-d', name: 'D: flatt tak', type: 'flat', levelId: 'hoved', outline: [[40, 0], [46, 0], [46, 6], [40, 6]], covering: 'felt' },
      { id: 'roof-e', name: 'E: saltak 24°', type: 'gable', levelId: 'hoved', outline: [[50, 0], [58, 0], [58, 9], [50, 9]], pitch: 24, ridge: [0, 1], covering: 'tile', color: '#7a3b2c', trimColor: '#ece9e3' },
      { id: 'roof-f1', name: 'F: L-hus', type: 'gable', levelId: 'hoved', outline: [[62, 0], [70, 0], [70, 6], [62, 6]], pitch: 30, covering: 'tile' },
      { id: 'roof-f2', name: '', type: 'gable', levelId: 'hoved', outline: [[66, 6], [70, 6], [70, 11], [66, 11]], pitch: 30, ridge: [0, 1], covering: 'tile' },
    ],
  };
}

/**
 * The spec for buildLayout: the house on the empty base the planbygger's viewer uses (a zero-area living-room floor
 * at the first corner). No «roof line» ceiling: with roofs the cladding follows them (notes/tak.md).
 */
export function takSpec(house = takHus()) {
  return {
    meta: { name: 'Tak', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
  };
}
