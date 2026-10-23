/**
 * The cladding and deck test houses (notes/kledning.md): five small houses side by side, each its own house file (the
 * cladding is one per house), built with the game's own builders by dev/kledning.html (look at them) and
 * tools/house-tests/kledning.test.mjs (build them in Node, check them).
 *
 *   A  x 0–10    hvitt hus med saltak: liggende dobbeltfals, fasadeplater i gavlene, betongsokkel, hvite hjørnekasser og
 *                omramming; en veranda (bord, lukket under, spilerekkverk på sidene, ett trinn) og en flisplatting uten
 *                rekkverk
 *   B  x 14–23   to etasjer med valmtak: stående tømmermannskledning, et teglbånd nederst i 1. etasje, steinsokkel, mørke
 *                hjørnekasser; en balkong med glassrekkverk i 2. etasje
 *   C  x 28–37   sokkelhus i skrånende tomt: skyggepanel over, puss på kjelleren, liggende kledning i gavlene; en terrasse
 *                på stolper med stående spiler og en lang tretrapp ned til gårdsplassen foran kjelleren (groundY)
 *   D  x 42–50   flate tak: fasadeplater, liggende kledning i 2. etasje, stein på nordveggen, pusset sokkel; en
 *                takterrasse med fliser og stålspiler på taket over fløyen
 *   E  x 55–58   en bod i naturstein med rød tømmermannskledning i gavlene, og en frittstående betongplatting (uten
 *                levelId, y over bakken) med stålspiler og en støpt trapp
 *
 *   kledningHus() → [{ key, name, house, site }]   site: what the test page puts round the house (a sunken yard)
 *   kledningSpec(house) → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * z = 0 is the south side (the sun on the test page comes from −z).
 */

const T = 0.3; // exterior walls
const H = 2.4; // wall height

let nOpen = 0;
const win = (offset, width, height, sill, color = '#25272b', extra = {}) => ({
  id: `win-kl-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color, width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 }, ...(sill > 0 ? { sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } } : {}),
  sashes: [{ opening: true }], ...extra,
});
const door = (offset, width, roomId, color = '#25272b', extra = {}) => ({
  id: `door-kl-${++nOpen}`, type: 'door', offset, width, height: 2.1, sill: 0,
  frame: { color, width: 0.05, depth: 0.06 }, reveal: { depth: 0.21 },
  door: { hinge: 'from', swing: 'out', opensInto: 'ute', openAngleDeg: 95 }, connects: [roomId, 'ute'], ...extra,
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
  kjeller: { id: 'kjeller', name: 'Kjeller', floorY: -2.7, slabThickness: 0.3, ceilingDefault: H },
  hoved: { id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: H },
  etg2: { id: 'etg2', name: '2. etasje', floorY: 2.7, slabThickness: 0.3, ceilingDefault: H },
};

/** A house file from its parts. */
function houseOf(levels, parts, extra) {
  const h = { levels: levels.map((id) => ({ ...LEVELS[id] })), rooms: [], walls: [], ceilings: [], ...extra };
  for (const { r, w, c } of parts) {
    h.rooms.push(r);
    h.walls.push(...w);
    h.ceilings.push({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon, height: H, color: '#f4f2ee', ...c });
  }
  return h;
}

/** The test houses. */
export function kledningHus() {
  nOpen = 0;
  const out = [];

  // ---- A: white, gable roof, shiplap, panels in the gables, a porch and a tiled patio
  {
    const WHITE = '#f2f0eb';
    const m = boxWalls('a1', 'a-stue', [0, 0, 10, 8], {
      s: { openings: [win(1.0, 1.2, 1.3, 0.8, WHITE), door(4.25, 1.0, 'a-stue', WHITE), win(7.4, 1.2, 1.3, 0.8, WHITE)] },
      n: { openings: [win(2.0, 1.0, 1.2, 0.9, WHITE), win(6.4, 1.0, 1.2, 0.9, WHITE)] },
      v: { openings: [win(3.1, 1.0, 1.2, 0.9, WHITE)] },
      o: { openings: [win(1.4, 1.0, 1.2, 0.9, WHITE), door(4.6, 1.0, 'a-stue', WHITE)] },
    });
    out.push({
      key: 'A', name: 'A: liggende dobbeltfals, plater i gavlen',
      house: houseOf(['hoved'], [{ r: room('a-stue', 'A: Stue', 'hoved', m.polygon, 'living'), w: m.walls }], {
        roofs: [{ id: 'roof-a', type: 'gable', levelId: 'hoved', outline: [[0, 0], [10, 0], [10, 8], [0, 8]], pitch: 35, ridge: [1, 0], covering: 'tile', trimColor: '#ece9e3' }],
        cladding: {
          default: { type: 'wood', direction: 'horizontal', profile: 'shiplap', color: '#e6e2d8' },
          zones: [{ id: 'gavl-plater', gable: true, type: 'panels', color: '#4f565b' }],
          plinth: { height: 0.3, material: 'concrete' },
          trim: { color: '#f4f2ee', corners: true, surrounds: true },
        },
        decks: [
          {
            id: 'a-veranda', kind: 'porch', levelId: 'hoved', y: -0.02, outline: [[3.6, 0], [3.6, -1.6], [6.3, -1.6], [6.3, 0]],
            surface: 'boards', color: '#8b7d6b', supports: 'solid', railing: { type: 'wood-slats', edges: [0, 2], height: 0.9 },
            stairs: [{ edge: 1, at: 1.35, width: 1.4 }],
          },
          { id: 'a-platting', kind: 'terrace', levelId: 'hoved', y: -0.02, outline: [[10, 1.2], [12.6, 1.2], [12.6, 6.4], [10, 6.4]], surface: 'tiles', supports: 'none', railing: { type: 'none' } },
        ],
      }),
    });
  }

  // ---- B: two storeys, hip roof, board-and-batten with a brick band, a balcony with a glass railing
  {
    const g = boxWalls('b1', 'b-stue', [14, 0, 23, 7], {
      s: { openings: [win(1.2, 1.6, 1.4, 0.7), win(5.0, 2.4, 1.4, 0.7)] },
      o: { openings: [door(2.6, 1.0, 'b-stue')] },
      n: { openings: [win(2.0, 1.2, 1.2, 0.9), win(5.6, 1.0, 1.2, 0.9)] },
      v: { openings: [win(2.6, 1.0, 1.2, 0.9)] },
    });
    const u = boxWalls('b2', 'b-sov', [14, 0, 23, 7], {
      s: { openings: [win(1.0, 1.2, 1.3, 0.8), door(3.9, 1.0, 'b-sov', '#25272b'), win(6.2, 1.2, 1.3, 0.8)] },
      n: { openings: [win(3.6, 1.2, 1.2, 0.9)] },
      v: { openings: [win(2.6, 1.0, 1.2, 0.9)] },
      o: { openings: [win(2.6, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'B', name: 'B: to etasjer, teglbånd, balkong',
      house: houseOf(['hoved', 'etg2'], [
        { r: room('b-stue', 'B: Stue', 'hoved', g.polygon, 'living'), w: g.walls },
        { r: room('b-sov', 'B: Soverom', 'etg2', u.polygon), w: u.walls },
      ], {
        roofs: [{ id: 'roof-b', type: 'hip', levelId: 'etg2', outline: [[14, 0], [23, 0], [23, 7], [14, 7]], pitch: 25, covering: 'slate' }],
        cladding: {
          default: { type: 'wood', direction: 'vertical', profile: 'board-batten', color: '#6b4a36' },
          zones: [{ id: 'teglband', levelId: 'hoved', to: 1.0, type: 'brick', color: '#8c4b3c' }],
          plinth: { height: 0.25, material: 'stone' },
          trim: { color: '#2f2f31', corners: true, surrounds: false },
        },
        decks: [
          { id: 'b-balkong', kind: 'balcony', levelId: 'etg2', y: -0.02, outline: [[16.6, 0], [16.6, -1.5], [21.0, -1.5], [21.0, 0]], surface: 'boards', color: '#7d746a' },
        ],
      }),
    });
  }

  // ---- C: a house with a basement on a slope: shadow-gap boards, render on the basement, lying boards in the gables,
  //         a terrace on posts with a long wooden stair down to the yard in front of the basement
  {
    const k = boxWalls('c0', 'c-kjeller', [28, 0, 37, 8], {
      s: { openings: [win(1.0, 1.4, 1.2, 0.9), door(4.0, 1.0, 'c-kjeller'), win(6.4, 1.4, 1.2, 0.9)] },
      v: { openings: [win(1.6, 1.0, 0.8, 1.3)] },
      o: { openings: [win(1.6, 1.0, 0.8, 1.3)] },
    });
    const m = boxWalls('c1', 'c-stue', [28, 0, 37, 8], {
      s: { openings: [win(0.9, 2.0, 1.6, 0.6), door(3.6, 1.0, 'c-stue'), win(5.4, 2.4, 1.6, 0.6)] },
      n: { openings: [door(3.8, 1.0, 'c-stue'), win(1.2, 1.2, 1.2, 0.9)] },
      v: { openings: [win(3.0, 1.2, 1.2, 0.9)] },
      o: { openings: [win(3.0, 1.2, 1.2, 0.9)] },
    });
    out.push({
      key: 'C', name: 'C: sokkelhus, skyggepanel og puss, terrasse på stolper',
      site: { yard: { x0: 25, x1: 40, z0: -11, z1: 0, y: -2.85 } },
      house: houseOf(['kjeller', 'hoved'], [
        { r: room('c-kjeller', 'C: Kjellerstue', 'kjeller', k.polygon, 'living'), w: k.walls },
        { r: room('c-stue', 'C: Stue', 'hoved', m.polygon, 'living'), w: m.walls },
      ], {
        roofs: [{ id: 'roof-c', type: 'gable', levelId: 'hoved', outline: [[28, 0], [37, 0], [37, 8], [28, 8]], pitch: 27, ridge: [1, 0], covering: 'steel', color: '#2b2e33' }],
        cladding: {
          default: { type: 'wood', direction: 'vertical', profile: 'shadow', color: '#3b3f43' },
          zones: [
            { id: 'kjeller-puss', levelId: 'kjeller', type: 'render', color: '#cfc9bd' },
            { id: 'gavl-liggende', gable: true, type: 'wood', direction: 'horizontal', profile: 'plain', color: '#3b3f43' },
          ],
          trim: { color: '#3b3f43', corners: true, surrounds: true },
        },
        decks: [
          {
            id: 'c-terrasse', kind: 'terrace', levelId: 'hoved', y: -0.02, groundY: -2.85, outline: [[28.6, 0], [28.6, -3.2], [36.4, -3.2], [36.4, 0]],
            surface: 'boards', supports: 'posts', railing: { type: 'wood-vertical' }, stairs: [{ edge: 1, at: 6.6, width: 1.1 }],
          },
        ],
      }),
    });
  }

  // ---- D: flat roofs: panels, lying boards upstairs, stone on the north wall, a rendered plinth, a roof terrace
  {
    const s = boxWalls('d1', 'd-stue', [42, 0, 46.05, 7], {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [win(1.0, 1.8, 1.6, 0.6)] },
      v: { openings: [door(2.8, 1.0, 'd-stue')] },
      n: { openings: [win(1.4, 1.0, 1.2, 0.9)] },
    });
    const f = boxWalls('d2', 'd-hage', [45.95, 0, 50, 7], {
      v: { backOf: 'w-d1-o', thickness: 0.1 },
      s: { openings: [win(0.9, 2.2, 2.1, 0)] },
      o: { openings: [win(2.6, 1.6, 1.4, 0.7)] },
      n: { openings: [win(1.4, 1.0, 1.2, 0.9)] },
    });
    const u = boxWalls('d3', 'd-sov', [42, 0, 46.05, 7], {
      s: { openings: [win(1.2, 1.4, 1.3, 0.8)] },
      o: { openings: [door(2.0, 1.0, 'd-sov'), win(4.0, 1.4, 1.3, 0.8)] },
      n: { openings: [win(1.4, 1.0, 1.2, 0.9)] },
      v: { openings: [win(3.0, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'D', name: 'D: fasadeplater, takterrasse',
      house: houseOf(['hoved', 'etg2'], [
        { r: room('d-stue', 'D: Stue', 'hoved', s.polygon, 'living'), w: s.walls },
        { r: room('d-hage', 'D: Hagestue', 'hoved', f.polygon), w: f.walls },
        { r: room('d-sov', 'D: Soverom', 'etg2', u.polygon), w: u.walls },
      ], {
        roofs: [
          { id: 'roof-d1', type: 'flat', levelId: 'hoved', outline: [[46.05, 0], [50, 0], [50, 7], [46.05, 7]], thickness: 0.2 },
          { id: 'roof-d2', type: 'flat', levelId: 'etg2', outline: [[42, 0], [46.05, 0], [46.05, 7], [42, 7]] },
        ],
        cladding: {
          default: { type: 'panels', color: '#c9c6bf', module: [0.6, 3.0] },
          zones: [
            { id: 'etg2-liggende', levelId: 'etg2', type: 'wood', direction: 'horizontal', profile: 'plain', color: '#3a3633' },
            { id: 'nord-stein', walls: ['w-d1-n', 'w-d2-n'], type: 'stone' },
          ],
          plinth: { height: 0.3, material: 'render' },
          trim: { color: '#2f2f31', corners: true, surrounds: true },
        },
        decks: [
          {
            id: 'd-takterrasse', kind: 'roof-terrace', levelId: 'etg2', y: -0.02, thickness: 0.06, outline: [[46.05, 0.3], [49.7, 0.3], [49.7, 6.7], [46.05, 6.7]],
            surface: 'tiles', color: '#a29d95', railing: { type: 'steel-bars' },
          },
        ],
      }),
    });
  }

  // ---- E: a stone shed with red board-and-batten in the gables, a free-standing concrete patio with a cast stair
  {
    const b = boxWalls('e1', 'e-bod', [55, 4, 58, 6.5], {
      s: { openings: [door(1.0, 0.9, 'e-bod', '#f2f0eb')] },
      o: { openings: [win(0.8, 0.6, 0.6, 1.2, '#f2f0eb')] },
    });
    out.push({
      key: 'E', name: 'E: steinbod og frittstående platting',
      house: houseOf(['hoved'], [{ r: room('e-bod', 'E: Bod', 'hoved', b.polygon, 'storage'), w: b.walls }], {
        roofs: [{ id: 'roof-e', type: 'gable', levelId: 'hoved', outline: [[55, 4], [58, 4], [58, 6.5], [55, 6.5]], pitch: 35, ridge: [0, 1], covering: 'slate' }],
        cladding: {
          default: { type: 'stone', color: '#85817a' },
          zones: [{ id: 'gavl-rod', gable: true, type: 'wood', direction: 'vertical', profile: 'board-batten', color: '#7a2e24' }],
          trim: { color: '#f4f2ee', corners: true, surrounds: true },
        },
        decks: [
          {
            id: 'e-platting', kind: 'terrace', y: 0.75, outline: [[54, -0.5], [58.5, -0.5], [58.5, 2.6], [54, 2.6]],
            surface: 'concrete', supports: 'solid', railing: { type: 'steel-bars' }, stairs: [{ edge: 3, at: 1.2, width: 1.2 }],
          },
        ],
      }),
    });
  }
  return out;
}

/**
 * The spec for buildLayout: the house on the empty base the planbygger's viewer uses (a zero-area living-room floor
 * at the first corner). With roofs the cladding follows them (notes/tak.md), so no «roof line» ceiling.
 */
export function kledningSpec(house) {
  return {
    meta: { name: 'Kledning', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
  };
}
