/**
 * The test houses for the new roof types (notes/tak.md «Flere taktyper»): ten small houses side by side, each its own
 * house file (the cladding is one per house), built with the game's own builders by dev/taktyper.html (look at them)
 * and tools/house-tests/taktyper.test.mjs (build them in Node, check them).
 *
 *   A  x 0–10     L-hus i to etasjer: 1 ½ etasje med saltak (40°, knevegg 1,0) over loftet, en lavere og smalere
 *                 sidefløy i én etasje (30°) mot nord og et vindfang med pulttak mot sør – fløyer på etasjen under, som
 *                 møter hovedtaket i kiler og vinkelrenner eller står inntil veggen under takfoten
 *   B  x 16–30    U-hus i én etasje: hovedfløy (30°), en smal fløy mot nordvest som går inn i hovedtaket, en bredere og
 *                 brattere fløy mot nordøst som er høyere enn mønet og går tvers gjennom (kryssark med gavl mot sør)
 *   C  x 34–44    saltak med ulike takfall og takfot: 25° ned til 2,4 m mot sør, 45° ned til 3,6 m mot nord
 *   D  x 48–58    mansardtak (65° / 25°) over loftet med en kvist (ark med saltak) i den bratte delen
 *   E  x 62–70    valmet mansardtak (60° / 22°) over en stue åpen til taket
 *   F  x 74–82    funkis i to etasjer: flatt tak med parapet (attika) 0,45 m over tekkingen
 *   G  x 86–93    pulttak (4°) bak en parapet med vannrett topp
 *   H  x 97–107   1 ½ etasje med en innfelt takterrasse i sørtaket (3 × 2,2 m) og dør ut fra rommet bak
 *   I  x 111–121  1 ½ etasje med en valmet ark (ark med valm) mot sør og en takopplett med tre vinduer mot nord
 *   J  x 125–134  V-tak (sommerfugltak, 10° / 14°) over en stue åpen til taket
 *
 *   taktyperHus() → [{ key, name, house }]
 *   taktyperSpec(house) → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * z = 0 is the south side (the sun on the test page comes from −z).
 */

const T = 0.3; // exterior walls
const H = 2.4; // wall height

let nOpen = 0;
const win = (offset, width, height, sill, extra = {}) => ({
  id: `win-tt-${++nOpen}`, type: 'window', offset, width, height, sill,
  frame: { color: extra.color ?? '#25272b', width: 0.07, depth: 0.07 }, reveal: { depth: 0.2 },
  ...(sill > 0 ? { sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 } } : {}),
  sashes: [{ opening: true }], ...extra,
});
const door = (offset, width, roomId, extra = {}) => ({
  id: `door-tt-${++nOpen}`, type: 'door', offset, width, height: extra.height ?? 2.1, sill: 0,
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

/** A house file from its parts ({ r, w, c }: the room, its walls, its ceiling's own fields). */
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
const wood = (color, trim = '#f4f2ee', extra = {}) => ({ default: { type: 'wood', profile: 'board-batten', color }, trim: { color: trim, corners: true, surrounds: true }, ...extra });

/** The test houses. */
export function taktyperHus() {
  nOpen = 0;
  const out = [];

  // ---- A: an L on two levels – the main roof over the loft, a lower, narrower wing and an entry under the floor
  {
    const st = boxWalls('a1', 'a-stue', [0, 0, 10, 8], {
      s: { openings: [win(0.7, 1.2, 1.3, 0.8), win(7.6, 1.2, 1.3, 0.8)] },
      v: { openings: [win(3.0, 1.2, 1.2, 0.9)] },
      n: { openings: [win(1.4, 1.2, 1.2, 0.9)] },
    });
    const loft = boxWalls('a2', 'a-loft', [0, 0, 10, 8], {
      v: { openings: [win(3.2, 1.0, 1.2, 0.8)] },
      o: { openings: [win(3.2, 1.0, 1.2, 0.8)] },
    });
    const floy = boxWalls('a3', 'a-floy', [5.5, 7.7, 10, 13], {
      s: { backOf: 'w-a1-n', thickness: 0.3 },
      o: { openings: [win(1.4, 1.2, 1.2, 0.9)] },
      n: { openings: [win(1.6, 1.0, 1.2, 0.9)] },
    });
    const vf = boxWalls('a4', 'a-vindfang', [3, -2.5, 7, 0.3], {
      n: { backOf: 'w-a1-s', thickness: 0.3 },
      s: { openings: [door(1.5, 1.0, 'a-vindfang')] },
    });
    out.push({
      key: 'A', name: 'A: L-hus i to etasjer – sidefløy og vindfang på etasjen under',
      house: houseOf(['hoved', 'loft'], [
        { r: room('a-stue', 'A: Stue', 'hoved', st.polygon, 'living'), w: st.walls },
        { r: room('a-loft', 'A: Loft (hanebjelke 2,3)', 'loft', loft.polygon), w: loft.walls, c: { type: 'roof', height: 2.3 } },
        { r: room('a-floy', 'A: Sidefløy', 'hoved', floy.polygon), w: floy.walls },
        { r: room('a-vindfang', 'A: Vindfang', 'hoved', vf.polygon, 'hall'), w: vf.walls, c: { height: 2.2 } },
      ], {
        roofs: [
          { id: 'roof-a', name: 'A: hovedtak', type: 'gable', levelId: 'loft', outline: [[0, 0], [10, 0], [10, 8], [0, 8]], pitch: 40, kneeHeight: 1.0, covering: 'tile', color: '#3b3734' },
          { id: 'roof-a-floy', name: 'A: sidefløy', type: 'gable', levelId: 'hoved', outline: [[5.5, 8], [10, 8], [10, 13], [5.5, 13]], pitch: 30, ridge: [0, 1], covering: 'tile', color: '#3b3734' },
          { id: 'roof-a-vf', name: 'A: vindfang', type: 'mono-pitch', levelId: 'hoved', outline: [[3, -2.5], [7, -2.5], [7, 0], [3, 0]], pitch: 12, fall: [0, -1], eaveHeight: 2.25, covering: 'steel' },
        ],
        cladding: wood('#e9e5dc'),
      }),
    });
  }

  // ---- B: a U on one level – a narrow wing running into the main roof, a wider, steeper one through it
  {
    const vest = boxWalls('b1', 'b-vest', [16, 0, 25.05, 7], {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [win(1.0, 1.2, 1.3, 0.8), win(5.0, 1.2, 1.3, 0.8)] },
      v: { openings: [win(2.9, 1.0, 1.2, 0.9)] },
    });
    const ost = boxWalls('b2', 'b-ost', [24.95, 0, 30, 7], {
      v: { backOf: 'w-b1-o', thickness: 0.1 },
      s: { openings: [win(1.4, 1.6, 1.6, 0.6)] },
      o: { openings: [win(2.9, 1.0, 1.2, 0.9)] },
    });
    const vf = boxWalls('b3', 'b-vfloy', [16, 6.7, 20.5, 12], {
      s: { backOf: 'w-b1-n', thickness: 0.3 },
      n: { openings: [win(1.4, 1.2, 1.2, 0.9)] },
    });
    const of = boxWalls('b4', 'b-ofloy', [25, 6.7, 30, 12], {
      s: { backOf: 'w-b2-n', thickness: 0.3 },
      n: { openings: [win(1.6, 1.2, 1.2, 0.9)] },
      o: { openings: [win(1.8, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'B', name: 'B: U-hus – smal fløy inn i hovedtaket, kryssark gjennom det',
      house: houseOf(['hoved'], [
        { r: room('b-vest', 'B: Stue (flatt)', 'hoved', vest.polygon, 'living'), w: vest.walls },
        { r: room('b-ost', 'B: Rom under kryssarken', 'hoved', ost.polygon, 'living'), w: ost.walls, c: { type: 'roof' } },
        { r: room('b-vfloy', 'B: Smal fløy', 'hoved', vf.polygon), w: vf.walls, c: { type: 'roof' } },
        { r: room('b-ofloy', 'B: Bred fløy', 'hoved', of.polygon), w: of.walls, c: { type: 'roof' } },
      ], {
        roofs: [
          { id: 'roof-b', name: 'B: hovedfløy', type: 'gable', levelId: 'hoved', outline: [[16, 0], [30, 0], [30, 7], [16, 7]], pitch: 30, covering: 'tile', color: '#6b3226' },
          { id: 'roof-b-v', name: 'B: smal fløy', type: 'gable', levelId: 'hoved', outline: [[16, 7], [20.5, 7], [20.5, 12], [16, 12]], pitch: 30, ridge: [0, 1], covering: 'tile', color: '#6b3226' },
          { id: 'roof-b-o', name: 'B: bred fløy', type: 'gable', levelId: 'hoved', outline: [[25, 7], [30, 7], [30, 12], [25, 12]], pitch: 42, ridge: [0, 1], covering: 'tile', color: '#6b3226' },
        ],
        cladding: wood('#c9c1ad', '#ece9e3'),
      }),
    });
  }

  // ---- C: a gable with two different sides – a long slope to a low eave, a short steep one to a high wall
  {
    const st = boxWalls('c1', 'c-stue', [34, 0, 40.05, 9], {
      o: { exterior: false, thickness: 0.1 },
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(3.6, 1.2, 1.3, 0.8)] },
      n: { openings: [win(1.0, 1.2, 1.2, 1.6), win(3.6, 1.2, 1.2, 1.6)] },
      v: { openings: [win(5.4, 1.0, 1.4, 1.4, { topSlope: 'follow-roof' })] },
    });
    const sov = boxWalls('c2', 'c-sov', [39.95, 0, 44, 9], {
      v: { backOf: 'w-c1-o', thickness: 0.1 },
      s: { openings: [win(1.4, 1.0, 1.2, 0.9)] },
      o: { openings: [win(3.9, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'C', name: 'C: saltak med ulike takfall og takfot',
      house: houseOf(['hoved'], [
        { r: room('c-stue', 'C: Stue åpen til mønet', 'hoved', st.polygon, 'living'), w: st.walls, c: { type: 'roof' } },
        { r: room('c-sov', 'C: Soverom (flatt)', 'hoved', sov.polygon), w: sov.walls },
      ], {
        roofs: [{
          id: 'roof-c', name: 'C: skjevt saltak', type: 'gable', levelId: 'hoved', outline: [[34, 0], [44, 0], [44, 9], [34, 9]], ridge: [1, 0], fall: [0, -1],
          pitch: 25, eaveHeight: 2.4, pitchBack: 45, eaveHeightBack: 3.6, overhangBack: 0.3, covering: 'tile', color: '#34322f',
        }],
        cladding: wood('#56625a', '#ece9e3', { zones: [{ id: 'c-gavl', gable: true, direction: 'horizontal', profile: 'shiplap', color: '#c9b79c' }] }),
      }),
    });
  }

  // ---- D: a mansard over the loft with a kvist (a gable dormer) in its steep lower slope
  {
    const st = boxWalls('d1', 'd-stue', [48, 0, 58, 8], {
      s: { openings: [win(1.2, 1.2, 1.4, 0.8), win(7.4, 1.2, 1.4, 0.8)] },
      n: { openings: [win(3.6, 1.2, 1.2, 0.9)] },
    });
    const loft = boxWalls('d2', 'd-loft', [48, 0, 58, 8], {
      s: { openings: [win(4.3, 0.8, 0.9, 0.9, { panes: [1, 2] })] },
      v: { openings: [win(3.1, 1.2, 1.2, 0.9, { panes: [2, 2] })] },
      o: { openings: [win(3.1, 1.2, 1.2, 0.9, { panes: [2, 2] })] },
    });
    out.push({
      key: 'D', name: 'D: mansardtak med kvist',
      house: houseOf(['hoved', 'loft'], [
        { r: room('d-stue', 'D: Stue', 'hoved', st.polygon, 'living'), w: st.walls },
        { r: room('d-loft', 'D: Loft (hanebjelke 2,5)', 'loft', loft.polygon), w: loft.walls, c: { type: 'roof', height: 2.5 } },
      ], {
        roofs: [{
          id: 'roof-d', name: 'D: mansard', type: 'mansard', levelId: 'loft', outline: [[48, 0], [58, 0], [58, 8], [48, 8]],
          pitch: 65, pitchUpper: 25, eaveHeight: 0.3, breakDepth: 1.2, covering: 'slate', trimColor: '#ece9e3',
          dormers: [{ id: 'kvist-d', type: 'gable', front: [[52.4, 0], [53.6, 0]], height: 1.9, pitch: 35, overhang: 0.15 }],
        }],
        cladding: wood('#d8cfbd', '#f4f2ee'),
      }),
    });
  }

  // ---- E: a hipped mansard over a living room open to the roof
  {
    const st = boxWalls('e1', 'e-stue', [62, 0, 70, 7], {
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(5.2, 1.2, 1.3, 0.8)] },
      n: { openings: [win(3.2, 1.2, 1.2, 0.9)] },
      v: { openings: [win(2.9, 1.0, 1.2, 0.9)] },
      o: { openings: [win(2.9, 1.0, 1.2, 0.9)] },
    });
    out.push({
      key: 'E', name: 'E: valmet mansardtak',
      house: houseOf(['hoved'], [{ r: room('e-stue', 'E: Stue åpen til taket', 'hoved', st.polygon, 'living'), w: st.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-e', name: 'E: valmet mansard', type: 'mansard', hipped: true, levelId: 'hoved', outline: [[62, 0], [70, 0], [70, 7], [62, 7]], pitch: 60, pitchUpper: 22, breakDepth: 0.8, covering: 'tile', color: '#7a3b2c', trimColor: '#ece9e3' }],
        cladding: wood('#efe9dc'),
      }),
    });
  }

  // ---- F: a funkis house on two levels, a flat roof behind a parapet
  {
    const st = boxWalls('f1', 'f-stue', [74, 0, 82, 7], {
      s: { openings: [win(0.8, 2.4, 1.6, 0.6, { sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] }), door(5.4, 1.0, 'f-stue')] },
      o: { openings: [win(2.6, 1.2, 1.2, 0.9)] },
    });
    const ov = boxWalls('f2', 'f-ovre', [74, 0, 82, 7], {
      s: { openings: [win(0.8, 3.6, 1.2, 0.9, { sashes: [{ to: 0.33 }, { from: 0.33, to: 0.67, opening: true }, { from: 0.67 }] })] },
      v: { openings: [win(2.6, 1.2, 1.2, 0.9)] },
      n: { openings: [win(3.0, 1.2, 1.0, 1.1)] },
    });
    out.push({
      key: 'F', name: 'F: funkis – flatt tak med parapet',
      house: houseOf(['hoved', 'loft'], [
        { r: room('f-stue', 'F: Stue', 'hoved', st.polygon, 'living'), w: st.walls },
        { r: room('f-ovre', 'F: 2. etasje', 'loft', ov.polygon), w: ov.walls },
      ], {
        roofs: [{ id: 'roof-f', name: 'F: flatt tak med attika', type: 'flat', levelId: 'loft', outline: [[74, 0], [82, 0], [82, 7], [74, 7]], covering: 'felt', parapet: { height: 0.45 } }],
        cladding: { default: { type: 'render', color: '#f1efe9' }, trim: { color: '#2b2d31', corners: false, surrounds: true } },
      }),
    });
  }

  // ---- G: a mono-pitch roof hidden behind a parapet with a level top
  {
    const st = boxWalls('g1', 'g-stue', [86, 0, 93, 6], {
      s: { openings: [win(0.8, 2.6, 1.8, 0.4, { color: '#2b2d31', sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] })] },
      o: { openings: [win(2.4, 1.0, 1.2, 0.9, { color: '#2b2d31' })] },
    });
    out.push({
      key: 'G', name: 'G: pulttak bak attika',
      house: houseOf(['hoved'], [{ r: room('g-stue', 'G: Stue åpen til taket', 'hoved', st.polygon, 'living'), w: st.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-g', name: 'G: pulttak med parapet', type: 'mono-pitch', levelId: 'hoved', outline: [[86, 0], [93, 0], [93, 6], [86, 6]], pitch: 4, fall: [0, 1], eaveHeight: 2.6, covering: 'steel', parapet: { top: 3.6, copingColor: '#2b2d31' } }],
        cladding: { default: { type: 'wood', direction: 'horizontal', profile: 'shadow', color: '#3d3f42' }, trim: { color: '#2b2d31', corners: false, surrounds: true } },
      }),
    });
  }

  // ---- H: 1 ½ storeys with a recessed roof terrace in the south slope
  {
    const st = boxWalls('h1', 'h-stue', [97, 0, 107, 8], {
      s: { openings: [win(0.8, 1.2, 1.3, 0.8), win(4.2, 1.6, 1.3, 0.8), win(8.0, 1.2, 1.3, 0.8)] },
    });
    const vest = boxWalls('h2v', 'h-vest', [97, 0, 100.5, 8], { v: { openings: [win(3.1, 1.0, 1.2, 0.8)] } });
    const midt = boxWalls('h2m', 'h-midt', [100.2, 2.2, 103.8, 8], {
      v: { backOf: 'w-h2v-o', thickness: 0.3 },
      o: { backOf: 'w-h2o-v', thickness: 0.3 },
      s: { openings: [door(0.3, 0.9, 'h-midt', { height: 2.0 }), win(1.6, 1.0, 1.4, 0.6)] },
    });
    const ost = boxWalls('h2o', 'h-ost', [103.5, 0, 107, 8], { o: { openings: [win(3.1, 1.0, 1.2, 0.8)] } });
    out.push({
      key: 'H', name: 'H: innfelt takterrasse',
      house: houseOf(['hoved', 'loft'], [
        { r: room('h-stue', 'H: Stue', 'hoved', st.polygon, 'living'), w: st.walls },
        { r: room('h-vest', 'H: Soverom vest', 'loft', vest.polygon), w: vest.walls, c: { type: 'roof', height: 2.3 } },
        { r: room('h-midt', 'H: Loftsstue bak terrassen', 'loft', midt.polygon, 'living'), w: midt.walls, c: { type: 'roof', height: 2.3 } },
        { r: room('h-ost', 'H: Soverom øst', 'loft', ost.polygon), w: ost.walls, c: { type: 'roof', height: 2.3 } },
      ], {
        roofs: [{
          id: 'roof-h', name: 'H: saltak med innfelt terrasse', type: 'gable', levelId: 'loft', outline: [[97, 0], [107, 0], [107, 8], [97, 8]], pitch: 40, kneeHeight: 1.0, covering: 'tile', color: '#3a3634',
          terraces: [{ id: 'terrasse-h', front: [[100.5, 0], [103.5, 0]], depth: 2.2 }],
        }],
        decks: [{ id: 'h-terrasse', kind: 'roof-terrace', levelId: 'loft', y: 0.02, outline: [[100.52, 0.02], [103.48, 0.02], [103.48, 2.18], [100.52, 2.18]], surface: 'boards', color: '#8b8580', railing: { type: 'glass' } }],
        cladding: wood('#e6e2d8'),
      }),
    });
  }

  // ---- I: 1 ½ storeys with a hipped ark (south) and a takopplett with three windows (north)
  {
    const st = boxWalls('i1', 'i-stue', [111, 0, 121, 8], {
      s: { openings: [win(1.2, 1.2, 1.3, 0.8), win(7.2, 1.2, 1.3, 0.8)] },
    });
    const loft = boxWalls('i2', 'i-loft', [111, 0, 121, 8], {
      // under the hipped ark (x 114–117): two windows in the wall that rises into it
      s: { openings: [win(3.0, 0.9, 1.2, 0.8, { panes: [1, 2] }), win(4.5, 0.9, 1.2, 0.8, { panes: [1, 2] })] },
      v: { openings: [win(3.2, 1.0, 1.2, 0.8)] },
    });
    out.push({
      key: 'I', name: 'I: valmet ark og takopplett med tre vinduer',
      house: houseOf(['hoved', 'loft'], [
        { r: room('i-stue', 'I: Stue', 'hoved', st.polygon, 'living'), w: st.walls },
        { r: room('i-loft', 'I: Loft åpent til mønet', 'loft', loft.polygon, 'living'), w: loft.walls, c: { type: 'roof' } },
      ], {
        roofs: [{
          id: 'roof-i', name: 'I: saltak med arker', type: 'gable', levelId: 'loft', outline: [[111, 0], [121, 0], [121, 8], [111, 8]], pitch: 40, kneeHeight: 1.0, covering: 'tile', color: '#3a3634', trimColor: '#efede6',
          dormers: [
            { id: 'ark-i', type: 'hip', front: [[114, 0], [117, 0]], height: 2.3, pitch: 40, pitchFront: 45, overhang: 0.3 },
            { id: 'opp-i', type: 'shed', front: [[119.5, 7.2], [112.5, 7.2]], height: 2.6, pitch: 8, windows: [{ width: 1.0, height: 0.8 }, { width: 1.0, height: 0.8 }, { width: 1.0, height: 0.8 }] },
          ],
        }],
        cladding: wood('#efede6'),
      }),
    });
  }

  // ---- J: a V roof (butterfly) over a living room open to it
  {
    const st = boxWalls('j1', 'j-stue', [125, 0, 134, 7], {
      s: { openings: [win(0.8, 3.0, 2.0, 0.5, { color: '#2b2d31', sashes: [{ to: 0.5 }, { from: 0.5, opening: true, hinge: 'right' }] }), win(5.2, 1.2, 1.3, 0.8, { color: '#2b2d31' })] },
      n: { openings: [win(3.0, 1.6, 1.0, 1.4, { color: '#2b2d31' })] },
      v: { openings: [win(2.6, 1.0, 1.2, 0.9, { color: '#2b2d31' })] },
    });
    out.push({
      key: 'J', name: 'J: V-tak (sommerfugltak)',
      house: houseOf(['hoved'], [{ r: room('j-stue', 'J: Stue åpen til taket', 'hoved', st.polygon, 'living'), w: st.walls, c: { type: 'roof' } }], {
        roofs: [{ id: 'roof-j', name: 'J: V-tak', type: 'butterfly', levelId: 'hoved', outline: [[125, 0], [134, 0], [134, 7], [125, 7]], ridge: [1, 0], fall: [0, -1], pitch: 10, pitchBack: 14, eaveHeight: 3.0, covering: 'steel', color: '#3a3e44' }],
        cladding: { default: { type: 'wood', profile: 'board-batten', color: '#d8d2c6' }, zones: [{ id: 'j-gavl', gable: true, type: 'panels', color: '#3d4247' }], trim: { color: '#2b2d31', corners: true, surrounds: true } },
      }),
    });
  }
  return out;
}

/**
 * The spec for buildLayout: the house on the empty base the planbygger's viewer uses (a zero-area living-room floor
 * at the first corner). With roofs the cladding follows them (notes/tak.md), so no «roof line» ceiling.
 */
export function taktyperSpec(house) {
  return {
    meta: { name: 'Taktyper', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
