/**
 * The test houses for the facade types (notes/vindusmodeller.md, notes/dortyper.md): what the facade drawings show
 * beyond the plain window and door – two small houses side by side, each its own house file (the cladding is one per
 * house), built with the game's own builders by dev/fasadetyper.html (look at them, open the doors) and
 * tools/house-tests/fasadetyper.test.mjs (build them in Node, check them).
 *
 *   A  x 0–10    1 etasje, saltak 35° åpent til mønet: en glassvegg (4 m, til gulvet, fem felt) og en dør i glassvegg
 *                (dør med tre sidefelt) i sørveggen, et hjørnevindu i sørøst, et femkantet gavlvindu langs taket i
 *                vestgavlen, et trekantvindu og et rundt vindu i østgavlen; hvit stående kledning
 *   B  x 14–22   2 etasjer, saltak 25°: en leddport og en ytterdør med sidefelt og overlys nede, en dobbeltdør med fransk
 *                balkong av glass og et vindu til gulvet med fransk balkong av stål oppe; mørk kledning med omramming
 *
 *   fasadetyperHus() → [{ key, name, house }]
 *   fasadetyperSpec(house) → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * z = 0 is the south side (the sun on the test page comes from −z).
 */

const T = 0.3; // exterior walls

let nOpen = 0;
const win = (offset, width, height, sill, extra = {}) => ({
  id: `win-ft-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color: extra.color ?? '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 },
  ...(sill > 0 ? { sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } } : {}),
  ...extra,
});
const door = (offset, width, height, roomId, extra = {}) => ({
  id: `door-ft-${++nOpen}`, type: 'door', offset, width, height, sill: 0, interactive: true,
  frame: { color: '#25272b', width: 0.05, depth: 0.06 }, reveal: { depth: 0.2, color: '#1d1e21' },
  connects: [roomId, 'ute'], ...extra,
});

/**
 * The four walls of a rectangular room (outer faces x0…x1, z0…z1; the room inside by T), the room on the right of
 * from → to. sides: { s, o, n, v } = { exterior?, openings?, thickness?, backOf? } per side (south z0, east x1, north z1,
 * west x0). Wall ids w-<prefix>-<side>.
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
const room = (id, name, levelId, polygon, kind = 'bedroom') => ({
  id, name, levelId, kind, polygon, floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' }, ceilingIds: [`c-${id}`], acoustic: { mode: 'estimate' },
});

/** The test houses. */
export function fasadetyperHus() {
  nOpen = 0;
  const out = [];

  // ---- A: one storey under a gable roof open to the ridge – a glass wall, a corner window, gable and round windows
  {
    const WHITE = '#f2f0eb';
    const H = 2.4;
    const g = boxWalls('a', 'a-stue', [0, 0, 10, 7], H, {
      // south (x 0.3 → 9.7): a glass wall of five fixed fields to the floor, a door in a glass wall (three sidelights,
      // one on the left and two on the right), the south half of the corner window at the east end
      s: {
        openings: [
          { ...win(0.3, 4.0, 2.25, 0, { name: 'Glassvegg (fem felt til gulvet)' }), sashes: [{ to: 0.2 }, { from: 0.2, to: 0.4 }, { from: 0.4, to: 0.6, opening: true, hinge: 'left' }, { from: 0.6, to: 0.8 }, { from: 0.8 }] },
          door(4.6, 3.05, 2.25, 'a-stue', {
            name: 'Dør i glassvegg (tre sidefelt)',
            door: { hinge: 'from', swing: 'out', opensInto: 'ute', leafColor: '#25272b', glass: { from: 0.12, to: 2.1, margin: 0.08 }, sidelights: [{ side: 'from', w: 0.7 }, { side: 'to', w: 0.62 }, { side: 'to', w: 0.62 }] },
          }),
          win(8.3, 1.1, 1.3, 0.8, { name: 'Hjørnevindu (sør)', corner: 'to', sashes: [{ opening: true, hinge: 'left' }] }),
        ],
      },
      // east gable (z 0.3 → 6.7): the east half of the corner window, a triangle up in the gable, a round window
      o: {
        openings: [
          win(0, 1.4, 1.3, 0.8, { name: 'Hjørnevindu (øst)', corner: 'from' }),
          win(2.45, 1.5, 1.05, 2.75, { name: 'Trekantvindu i gavlen', shape: 'triangle', sillBoard: undefined }),
          win(4.65, 0.7, 0.7, 1.3, { name: 'Rundt vindu', shape: 'round', panes: [2, 2], sillBoard: undefined }),
        ],
      },
      n: { openings: [win(1.5, 1.2, 1.2, 0.9, { name: 'Vanlig vindu' }), win(6.7, 1.2, 1.2, 0.9)] },
      // west gable (z 6.7 → 0.3): a five-sided window whose top follows both slopes of the roof, with posts
      v: { openings: [win(1.7, 3.0, 3.6, 0.5, { name: 'Gavlvindu (femkant langs taket)', shape: 'gable', sashes: [{ to: 1 / 3 }, { from: 1 / 3, to: 2 / 3 }, { from: 2 / 3 }] })] },
    });
    out.push({
      key: 'A', name: 'A: glassvegg, hjørnevindu, gavlvinduer',
      house: {
        levels: [{ id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H }],
        rooms: [room('a-stue', 'A: Stue åpen til mønet', 'hoved', g.polygon, 'living')],
        walls: g.walls,
        ceilings: [{ id: 'c-a-stue', roomId: 'a-stue', polygon: g.polygon, type: 'roof', color: '#f4f2ee' }],
        roofs: [{ id: 'roof-a', name: 'A: saltak', type: 'gable', levelId: 'hoved', outline: [[0, 0], [10, 0], [10, 7], [0, 7]], pitch: 35, ridge: [1, 0], covering: 'tile', color: '#3a3a3c' }],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: WHITE },
          trim: { color: '#f4f2ee', corners: true, surrounds: true },
        },
      },
    });
  }

  // ---- B: two storeys – a sectional garage door, a front door with a sidelight and a top light, french balconies
  {
    const DARK = '#3b3f44';
    const H0 = 2.6;
    const H1 = 2.4;
    const gar = boxWalls('b1g', 'b-garasje', [14, 0, 18.05, 8], H0, {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [door(0.5, 2.6, 2.1, 'b-garasje', { name: 'Leddport', frame: { color: '#ecebe7', width: 0.06, depth: 0.06 }, door: { variant: 'garage', style: 'sectional', leafColor: '#ecebe7', glass: { cols: 4 } } })] },
      n: { openings: [win(1.2, 1.0, 0.6, 1.6)] },
    });
    const stue = boxWalls('b1s', 'b-stue', [17.95, 0, 22, 8], H0, {
      v: { backOf: 'w-b1g-o', thickness: 0.1 },
      s: {
        openings: [
          door(0.4, 1.5, 2.45, 'b-stue', {
            name: 'Ytterdør med sidefelt og overlys',
            door: { hinge: 'to', swing: 'in', opensInto: 'b-stue', leafColor: '#2b2c2e', glass: { width: 0.18, align: 'lock', from: 0.3, to: 1.85 }, sidelights: [{ side: 'from', w: 0.35 }], transom: { h: 0.4 }, hardware: { type: 'lever', lock: 'keypad' } },
          }),
          win(2.3, 1.2, 1.3, 0.8, { color: DARK }),
        ],
      },
      o: { openings: [win(2.0, 1.6, 1.3, 0.8, { color: DARK })] },
    });
    const sov1 = boxWalls('b2v', 'b-sov1', [14, 0, 18.05, 8], H1, {
      o: { exterior: false, thickness: 0.1 },
      // a double door opening in to a french balcony of glass
      s: {
        openings: [door(1.0, 1.3, 2.1, 'b-sov1', {
          name: 'Dobbeltdør med fransk balkong (glass)', frenchBalcony: { style: 'glass' },
          door: { variant: 'double', hinge: 'from', swing: 'in', opensInto: 'b-sov1', leafColor: '#2b2c2e', glass: { cols: 1, rows: 1 } },
        })],
      },
      v: { openings: [win(3.0, 1.2, 1.2, 0.9, { color: DARK })] },
    });
    const sov2 = boxWalls('b2o', 'b-sov2', [17.95, 0, 22, 8], H1, {
      v: { backOf: 'w-b2v-o', thickness: 0.1 },
      // a window down to the floor (two sashes) behind a french balcony of steel bars
      s: { openings: [win(0.9, 1.6, 2.1, 0, { name: 'Vindu til gulvet med fransk balkong (stål)', color: DARK, frenchBalcony: { style: 'bars' }, sashes: [{ to: 0.5, opening: true, hinge: 'left' }, { from: 0.5, opening: true, hinge: 'right' }] })] },
      o: { openings: [win(3.0, 1.2, 1.2, 0.9, { color: DARK })] },
    });
    const parts = [
      [room('b-garasje', 'B: Garasje', 'hoved', gar.polygon, 'storage'), gar.walls, H0],
      [room('b-stue', 'B: Stue og entré', 'hoved', stue.polygon, 'living'), stue.walls, H0],
      [room('b-sov1', 'B: Soverom 1', 'over', sov1.polygon), sov1.walls, H1],
      [room('b-sov2', 'B: Soverom 2', 'over', sov2.polygon), sov2.walls, H1],
    ];
    out.push({
      key: 'B', name: 'B: leddport, ytterdør med overlys, franske balkonger',
      house: {
        levels: [
          { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H0 },
          { id: 'over', name: '2. etasje', floorY: 2.9, slabThickness: 0.3, ceilingDefault: H1 },
        ],
        rooms: parts.map((p) => p[0]),
        walls: parts.flatMap((p) => p[1]),
        ceilings: parts.map(([r, , h]) => ({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon, height: h, color: '#f4f2ee' })),
        roofs: [{ id: 'roof-b', name: 'B: saltak', type: 'gable', levelId: 'over', outline: [[14, 0], [22, 0], [22, 8], [14, 8]], pitch: 25, ridge: [1, 0], covering: 'steel', color: '#2b2e33' }],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#5d6166' },
          trim: { color: '#ecebe7', corners: true, surrounds: true },
        },
      },
    });
  }
  return out;
}

/**
 * The spec for buildLayout: the house on the empty base the planbygger's viewer uses (a zero-area living-room floor
 * at the first corner). With roofs the cladding follows them (notes/tak.md), so no «roof line» ceiling.
 */
export function fasadetyperSpec(house) {
  return {
    meta: { name: 'Fasadetyper', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
  };
}
