/**
 * The test houses for the roof details (notes/tak.md: halvvalm, pulttaksark i ytterveggen, piper; notes/vindusmodeller.md:
 * vinduer med skrå overkant): four small houses side by side, each its own house file (the cladding is one per house),
 * built with the game's own builders by dev/takdetaljer.html (look at them, walk into the chimneys) and
 * tools/house-tests/takdetaljer.test.mjs (build them in Node, check them).
 *
 *   A  x 0–10    hus1, fasade 1: 1 ½ etasje med halvvalm (40°, valmen 1,2 m ned fra mønet), en ark med pulttak og front
 *                i ytterveggen (balkongdør og to vinduer i veggen under), en balkong foran, en murpipe fra stua opp
 *                gjennom hanebjelkeloftet, vinduer med skrå overkant langs taket i gavlene på loftet; hvit kledning
 *   B  x 14–22   hus4 / hus5: pulttak (15°, høyt mot nord) over en stue åpen til taket, et stort vindu med skrå overkant
 *                og fire felt (tverrpost) i vestveggen, et skrått vindu med topSlope i grader og en dør med skrått
 *                overlys i østveggen, en stålpipe fra gulvet; kledning med mørk omramming
 *   C  x 30–38   saltak (35°) åpent til mønet: to speilvendte vinduer med skrå overkant i vestgavlen, liggende kledning i
 *                gavlen, en pusset pipe på mønet (from: 'roof')
 *   D  x 44–51   bratt halvvalm (30°, valmene 50°, hipDepth 0,7) over en stue åpen til taket, plater i gavlene
 *
 *   takdetaljerHus() → [{ key, name, house }]
 *   takdetaljerSpec(house) → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * z = 0 is the south side (the sun on the test page comes from −z).
 */

const T = 0.3; // exterior walls
const H = 2.4; // wall height

let nOpen = 0;
const win = (offset, width, height, sill, extra = {}) => ({
  id: `win-td-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color: extra.color ?? '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 },
  ...(sill > 0 ? { sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } } : {}),
  sashes: [{ opening: true }], ...extra,
});
const door = (offset, width, roomId, extra = {}) => ({
  id: `door-td-${++nOpen}`, type: 'door', offset, width, height: extra.height ?? 2.1, sill: 0,
  frame: { color: extra.color ?? '#25272b', width: 0.05, depth: 0.06 }, reveal: { depth: 0.21 },
  door: { hinge: 'from', swing: 'out', opensInto: 'ute', openAngleDeg: 95 }, connects: [roomId, 'ute'],
});

/**
 * The four walls of a rectangular room (outer faces x0…x1, z0…z1; the room inside by T), the room on the right of
 * from → to. sides: { s, o, n, v } = { exterior?, openings?, thickness?, backOf? } per side (south z0, east x1, north z1,
 * west x0). Wall ids w-<prefix>-<side>.
 */
function boxWalls(prefix, roomId, [x0, z0, x1, z1], sides = {}) {
  const t = (k) => sides[k]?.thickness ?? T;
  const a = [x0 + t('v'), z0 + t('s')], b = [x1 - t('o'), z0 + t('s')], c = [x1 - t('o'), z1 - t('n')], d = [x0 + t('v'), z1 - t('n')];
  const defs = [['s', a, b, [0, 1]], ['o', b, c, [-1, 0]], ['n', c, d, [0, -1]], ['v', d, a, [1, 0]]];
  const walls = [];
  for (const [k, from, to, normal] of defs) {
    const s = sides[k] || {};
    if (s.backOf) walls.push({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: 0, height: H, backOf: s.backOf, color: '#ece9e3' });
    else walls.push({ id: `w-${prefix}-${k}`, roomId, from, to, normal, thickness: t(k), height: H, exterior: s.exterior ?? true, color: '#ece9e3', openings: s.openings ?? [] });
  }
  return { polygon: [a, b, c, d], walls };
}
const room = (id, name, levelId, polygon, kind = 'bedroom') => ({
  id, name, levelId, kind, polygon, floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' }, ceilingIds: [`c-${id}`], acoustic: { mode: 'estimate' },
});
const LEVELS = {
  hoved: { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H },
  loft: { id: 'loft', name: 'Loft', floorY: 2.7, slabThickness: 0.3, ceilingDefault: H },
};

/** A house file from its parts. */
function houseOf(levels, parts, extra) {
  const h = { levels: levels.map((id) => ({ ...LEVELS[id] })), rooms: [], walls: [], ceilings: [], ...extra };
  for (const { r, w, c } of parts) {
    h.rooms.push(r);
    h.walls.push(...w);
    // (a ceiling that follows the roof is open to the ridge unless it has its own height – a collar beam)
    h.ceilings.push({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon, ...(c?.type === 'roof' ? {} : { height: H }), color: '#f4f2ee', ...c });
  }
  return h;
}

/** The test houses. */
export function takdetaljerHus() {
  nOpen = 0;
  const out = [];

  // ---- A: hus1 – half-hip, a shed ark with its front in the wall over a balcony, a brick chimney, sloped windows
  {
    const WHITE = '#f2f0eb';
    const w = (o, wd, h, s, x = {}) => win(o, wd, h, s, { color: WHITE, panes: [2, 3], ...x });
    const g = boxWalls('a1', 'a-stue', [0, 0, 10, 8], {
      s: { openings: [w(0.7, 1.0, 1.3, 0.8), w(2.0, 1.0, 1.3, 0.8), door(4.2, 1.0, 'a-stue', { color: WHITE }), w(6.4, 1.0, 1.3, 0.8), w(7.7, 1.0, 1.3, 0.8)] },
      n: { openings: [w(2.0, 1.0, 1.2, 0.9), w(6.4, 1.0, 1.2, 0.9)] },
      v: { openings: [w(3.2, 1.0, 1.2, 0.9)] },
      o: { openings: [w(3.2, 1.0, 1.2, 0.9)] },
    });
    // the loft: a bedroom under a collar beam (2.4) in the west, the rest open to the ridge, split at x 3.45–3.55
    const sov = boxWalls('a2v', 'a-sov', [0, 0, 3.55, 8], {
      o: { exterior: false, thickness: 0.1 },
      // the west gable: a window under each slope with its top along the roof, a plain one in the middle
      v: { openings: [w(0.55, 0.8, 1.3, 0.7, { topSlope: 'follow-roof', panes: [1, 1] }), w(3.2, 1.0, 1.2, 0.9), w(6.05, 0.8, 1.3, 0.7, { topSlope: 'follow-roof', panes: [1, 1] })] },
    });
    const stue = boxWalls('a2o', 'a-loftstue', [3.45, 0, 10, 8], {
      v: { backOf: 'w-a2v-o', thickness: 0.1 },
      // under the ark (x 4.0–7.6): a window, the balcony door, a window – as on hus1, fasade 1
      s: { openings: [w(0.7, 0.6, 1.4, 0.6, { panes: [1, 3] }), door(1.75, 1.0, 'a-loftstue', { color: WHITE, height: 2.05 }), w(3.2, 0.6, 1.4, 0.6, { panes: [1, 3] })] },
      // the east gable under the half-hip: a sloped window under the south slope, a tall one in the middle
      o: { openings: [w(0.6, 0.8, 1.3, 0.7, { topSlope: 'follow-roof', panes: [1, 1] }), w(3.2, 1.0, 1.6, 0.8)] },
    });
    out.push({
      key: 'A', name: 'A: hus1 – halvvalm, pulttaksark over balkong, murpipe',
      house: houseOf(['hoved', 'loft'], [
        { r: room('a-stue', 'A: Stue', 'hoved', g.polygon, 'living'), w: g.walls },
        { r: room('a-sov', 'A: Soverom (hanebjelke 2,4)', 'loft', sov.polygon), w: sov.walls, c: { type: 'roof', height: 2.4 } },
        { r: room('a-loftstue', 'A: Loftsstue under arken', 'loft', stue.polygon, 'living'), w: stue.walls, c: { type: 'roof' } },
      ], {
        roofs: [{
          id: 'roof-a', name: 'A: halvvalm', type: 'half-hip', levelId: 'loft', outline: [[0, 0], [10, 0], [10, 8], [0, 8]],
          pitch: 40, kneeHeight: 1.0, hipHeight: 1.2, covering: 'tile', color: '#34322f', trimColor: '#efede6',
          dormers: [{ id: 'ark-a', type: 'shed', front: [[4.0, 0], [7.6, 0]], height: 2.4, pitch: 15, overhang: 0.35 }],
        }],
        chimneys: [{ id: 'pipe-a', material: 'brick', at: [2.2, 4.7], size: [0.5, 0.5], color: '#7d4636' }],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#efede6' },
          trim: { color: '#f4f2ee', corners: true, surrounds: true },
        },
        decks: [{
          id: 'a-balkong', kind: 'balcony', levelId: 'loft', y: -0.02, outline: [[4.2, 0], [4.2, -1.2], [7.4, -1.2], [7.4, 0]],
          surface: 'boards', color: '#8b8580', railing: { type: 'wood-vertical', color: '#f2f0eb' },
        }],
      }),
    });
  }

  // ---- B: hus4 / hus5 – a mono-pitch, high to the north, sloped windows, a door with a sloped top light, steel chimney
  {
    const DARK = '#2b2d31';
    const g = boxWalls('b1', 'b-stue', [14, 0, 22, 6], {
      s: { openings: [win(1.0, 1.2, 1.2, 0.9, { color: DARK }), win(4.6, 2.2, 1.2, 0.9, { color: DARK, sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] })] },
      n: { openings: [win(2.0, 3.4, 0.5, 2.9, { color: DARK, sashes: [{ to: 0.5 }, { from: 0.5 }] })] },
      // west: hus5's big window – four fields, the upper two up to the sloped top
      v: {
        openings: [win(0.9, 2.0, 3.0, 0.4, {
          color: DARK, topSlope: 'follow-roof',
          sashes: [{ to: 0.5, top: 0.7 }, { from: 0.5, top: 0.7, opening: true, hinge: 'right' }, { to: 0.5, bottom: 0.7 }, { from: 0.5, bottom: 0.7 }],
        })],
      },
      // east: a door with a sloped top light over it (hus4), a narrow window with its top at 15°
      o: {
        openings: [
          door(0.8, 1.0, 'b-stue', { color: DARK }),
          win(0.8, 1.0, 0.55, 2.2, { color: DARK, topSlope: 'follow-roof', sashes: [{}], sillBoard: undefined }),
          win(2.6, 0.9, 1.6, 0.8, { color: DARK, topSlope: 15, panes: [1, 2] }),
        ],
      },
    });
    out.push({
      key: 'B', name: 'B: pulttak, skrå vinduer, stålpipe',
      house: houseOf(['hoved'], [{ r: room('b-stue', 'B: Stue åpen til taket', 'hoved', g.polygon, 'living'), w: g.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-b', name: 'B: pulttak', type: 'mono-pitch', levelId: 'hoved', outline: [[14, 0], [22, 0], [22, 6], [14, 6]], pitch: 15, fall: [0, -1], covering: 'steel', color: '#2b2e33' }],
        chimneys: [{ id: 'pipe-b', material: 'steel', at: [19.4, 4.3] }],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#e8e6e0' },
          trim: { color: DARK, corners: false, surrounds: true },
        },
      }),
    });
  }

  // ---- C: a gable roof open to the ridge, two mirrored sloped windows in the west gable, a rendered chimney on the ridge
  {
    const g = boxWalls('c1', 'c-stue', [30, 0, 38, 8], {
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(4.6, 2.4, 2.1, 0, { sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] })] },
      n: { openings: [win(3.2, 1.2, 1.2, 0.9)] },
      // the gable (from north to south): the left window's top rises to the ridge, the right one's falls from it
      v: { openings: [win(1.4, 1.4, 2.4, 1.4, { topSlope: 'follow-roof', panes: [2, 2] }), win(4.0, 1.4, 2.4, 1.4, { topSlope: 'follow-roof', panes: [2, 2] })] },
      o: { openings: [win(3.2, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'C', name: 'C: saltak, speilvendte skrå gavlvinduer, pipe på mønet',
      house: houseOf(['hoved'], [{ r: room('c-stue', 'C: Stue åpen til mønet', 'hoved', g.polygon, 'living'), w: g.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-c', name: 'C: saltak', type: 'gable', levelId: 'hoved', outline: [[30, 0], [38, 0], [38, 8], [30, 8]], pitch: 35, ridge: [1, 0], covering: 'slate' }],
        chimneys: [{ id: 'pipe-c', material: 'render', from: 'roof', at: [34.6, 4.0], size: [0.6, 0.45] }],
        cladding: {
          default: { type: 'wood', profile: 'board-batten', color: '#5b6b62' },
          zones: [{ id: 'c-gavl', gable: true, direction: 'horizontal', profile: 'shiplap', color: '#c9b79c' }],
          trim: { color: '#ece9e3', corners: true, surrounds: true },
        },
      }),
    });
  }

  // ---- D: a steep half-hip (the hips 50°, 0.7 m in from the gables) over one storey, panels in the gables
  {
    const g = boxWalls('d1', 'd-stue', [44, 0, 51, 6], {
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(4.0, 1.6, 1.3, 0.8)] },
      v: { openings: [win(2.2, 1.0, 1.2, 0.9)] },
      o: { openings: [win(2.2, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'D', name: 'D: bratt halvvalm, plater i gavlen',
      house: houseOf(['hoved'], [{ r: room('d-stue', 'D: Stue åpen til taket', 'hoved', g.polygon, 'living'), w: g.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-d', name: 'D: halvvalm', type: 'half-hip', levelId: 'hoved', outline: [[44, 0], [51, 0], [51, 6], [44, 6]], pitch: 30, pitchEnds: 50, hipDepth: 0.7, ridge: [1, 0], covering: 'tile', color: '#6e3226' }],
        cladding: {
          default: { type: 'wood', direction: 'horizontal', profile: 'shiplap', color: '#e6e2d8' },
          zones: [{ id: 'd-gavl', gable: true, type: 'panels', color: '#4f565b' }],
          trim: { color: '#f4f2ee', corners: true, surrounds: true },
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
export function takdetaljerSpec(house) {
  return {
    meta: { name: 'Takdetaljer', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
  };
}
