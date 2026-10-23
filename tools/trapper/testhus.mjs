/**
 * Testhuset for trappetypene (notes/trapper.md): en kjeller (−2,6) og en hovedetasje (0), begge ett stort rom
 * (x −0,5–18, z −0,5–6), og fem trapper i hver sin åpning i hovedetasjens gulv, med hver sin rekkverksstil:
 *
 *   trapp-rett       rett, åpne opptrinn, antall opptrinn beregnet (2R + G ≈ 0,62), spiler, stolpene slutter ved gulvet
 *   trapp-tett       rett, tette hvite opptrinn, glassrekkverk uten stolper på kanten av etasjeskillet
 *   trapp-l-sving    kvartsvingt med svingtrinn (venstre ned), liggende spiler, rekkverk på begge sider
 *   trapp-l-repos    kvartsvingt med repos (høyre ned), stag, stolpene slutter ved gulvet
 *   trapp-bratt      bratt rett trapp (trappestige) i en smal åpning, spiler
 *
 * tools/trapper/index.html (se, gå, gå opp og ned automatisk) og tools/house-tests/stairtypes.test.mjs (bygg,
 * valider, gangtest) bruker samme hus.
 *
 *   testHouse()      → husfila (formatet i research/house/NN-*.json, som planbyggeren lager)
 *   testHouseSpec()  → husfila lagt på en tom grunnspes, klar for home/layout.js buildLayout
 *   STAIRS           → trappenes id-er
 */

const WALL = { height: 2.4, paint: '#e6e1d8', thickness: 0.25, exterior: true };
const BASE_WALL = { height: 2.3, paint: '#dcd6cb', thickness: 0.25, exterior: true };
const ROOM = [[-0.5, -0.5], [18, -0.5], [18, 6], [-0.5, 6]];
const GUARD = { height: 1.0, stairHeight: 0.9, post: 0.065, baluster: 0.022, spacing: 0.13, topRail: [0.07, 0.05], color: '#1d1e21' };
const TREAD = { thickness: 0.04, nosing: 0.03, material: 'oak', color: '#bfab9b' };
const STRINGERS = { color: '#1d1e21', thickness: 0.05, depth: 0.28 };

/** Upper-floor guard lines along the hole's edges, except the top edge (a and b of that edge). */
function holeGuards(prefix, hole, top) {
  const out = [];
  for (let i = 0; i < hole.length; i++) {
    const a = hole[i];
    const b = hole[(i + 1) % hole.length];
    const isTop = top.some((p) => p[0] === a[0] && p[1] === a[1]) && top.some((p) => p[0] === b[0] && p[1] === b[1]);
    if (!isTop) out.push({ id: `${prefix}-${out.length + 1}`, level: 'hoved', line: [a, b] });
  }
  return out;
}

function walls(levelId, roomId, w) {
  const [a, b, c, d] = ROOM;
  return [
    { id: `w-${roomId}-nord`, roomId, levelId, from: a, to: b, normal: [0, 1], ...w },
    { id: `w-${roomId}-ost`, roomId, levelId, from: b, to: c, normal: [-1, 0], ...w },
    { id: `w-${roomId}-sor`, roomId, levelId, from: c, to: d, normal: [0, -1], ...w },
    { id: `w-${roomId}-vest`, roomId, levelId, from: d, to: a, normal: [1, 0], ...w },
  ];
}

export function testHouse() {
  // the holes (x, z): the stairs come up at z 1,0 and go down toward +z (the L stairs turn in the hole)
  const h1 = [[1.0, 1.0], [1.9, 1.0], [1.9, 4.3], [1.0, 4.3]];
  const h2 = [[4.0, 1.0], [4.9, 1.0], [4.9, 4.3], [4.0, 4.3]];
  const h3 = [[7.0, 1.0], [7.9, 1.0], [7.9, 2.5], [9.0, 2.5], [9.0, 3.4], [7.0, 3.4]];
  const h4 = [[12.0, 1.0], [12.9, 1.0], [12.9, 3.4], [10.45, 3.4], [10.45, 2.5], [12.0, 2.5]];
  const h5 = [[15.0, 1.0], [15.7, 1.0], [15.7, 2.55], [15.0, 2.55]];
  const hole = (id, polygon, stairId) => ({ id, levelId: 'hoved', roomId: 'stue', stairId, polygon, edgeBand: { color: '#f2efe8', depth: 0.3, edges: 'free' } });
  const stair = (id, name, openingId, extra) => ({
    id,
    name,
    fromLevel: 'kjeller',
    toLevel: 'hoved',
    openingId,
    roomIds: ['kjeller', 'stue'],
    tread: TREAD,
    stringers: STRINGERS,
    ...extra,
  });
  return {
    $comment: 'Testhus for trappetypene (tools/trapper, notes/trapper.md). Ikke en del av spillets hus.',
    levels: [
      { id: 'hoved', name: 'Hovedetasje', floorY: 0, slabThickness: 0.3, ceilingDefault: 2.4 },
      { id: 'kjeller', name: 'Kjeller', floorY: -2.6, slabThickness: 0.3, ceilingDefault: 2.3 },
    ],
    rooms: [
      { id: 'stue', name: 'Stue', levelId: 'hoved', kind: 'living', acoustic: { mode: 'estimate' }, polygon: ROOM, floor: { material: 'oak-plank', color: '#b8a48c' }, ceilingIds: ['c-stue'] },
      { id: 'kjeller', name: 'Kjeller', levelId: 'kjeller', kind: 'hall', acoustic: { mode: 'estimate' }, polygon: ROOM, floor: { material: 'oak-plank', color: '#a8916f' }, ceilingIds: ['c-kjeller'] },
    ],
    walls: [...walls('hoved', 'stue', WALL), ...walls('kjeller', 'kjeller', BASE_WALL)],
    ceilings: [
      { id: 'c-stue', roomId: 'stue', polygon: ROOM, type: 'flat', height: 2.4, paint: '#f2f2f0' },
      { id: 'c-kjeller', roomId: 'kjeller', polygon: ROOM, type: 'flat', height: 2.3, paint: '#f2f2f0' },
    ],
    floorOpenings: [hole('hull-rett', h1, 'trapp-rett'), hole('hull-tett', h2, 'trapp-tett'), hole('hull-l-sving', h3, 'trapp-l-sving'), hole('hull-l-repos', h4, 'trapp-l-repos'), hole('hull-bratt', h5, 'trapp-bratt')],
    stairs: [
      // straight, the risers left out (2R + G ≈ 0,62 gives 14), open, balusters; the posts end on the floor (hang 0)
      stair('trapp-rett', 'Rett trapp', 'hull-rett', {
        type: 'straight',
        top: { edge: [[1.0, 1.0], [1.9, 1.0]], down: [0, 1] },
        foot: { edge: [[1.0, 4.24], [1.9, 4.24]], down: [0, 1] },
        guards: [...holeGuards('rekk-rett', h1, [[1.0, 1.0], [1.9, 1.0]]), { id: 'rekk-rett-v', on: 'left' }, { id: 'rekk-rett-h', on: 'right' }],
        guardStyle: { ...GUARD, hang: 0 },
        handrails: [],
      }),
      // straight with closed white risers; frameless glass on the slab's edge with a top rail
      stair('trapp-tett', 'Rett trapp med tette opptrinn', 'hull-tett', {
        type: 'straight',
        risers: 14,
        top: { edge: [[4.0, 1.0], [4.9, 1.0]], down: [0, 1] },
        foot: { edge: [[4.0, 4.24], [4.9, 4.24]], down: [0, 1] },
        openRisers: false,
        riser: { color: '#f2efe8' },
        guards: [...holeGuards('rekk-tett', h2, [[4.0, 1.0], [4.9, 1.0]]), { id: 'rekk-tett-v', on: 'left' }, { id: 'rekk-tett-h', on: 'right' }],
        guardStyle: { ...GUARD, infill: 'glass', mount: 'edge', posts: false },
      }),
      // an L with balanced winders, turning left going down; flat bars (liggende spiler) on both sides
      stair('trapp-l-sving', 'Kvartsvingt trapp med svingtrinn', 'hull-l-sving', {
        type: 'quarter-turn-winder',
        risers: 14,
        top: { edge: [[7.0, 1.0], [7.9, 1.0]], down: [0, 1] },
        foot: { edge: [[8.95, 2.5], [8.95, 3.4]], down: [1, 0] },
        winders: 'balanced',
        guards: [...holeGuards('rekk-l-sving', h3, [[7.0, 1.0], [7.9, 1.0]]), { id: 'rekk-l-sving-inn', on: 'inner' }, { id: 'rekk-l-sving-ut', on: 'outer' }],
        guardStyle: { ...GUARD, infill: 'bars', hang: 0 },
      }),
      // an L with a landing, turning right going down; rods (stag); the posts end on the floor
      stair('trapp-l-repos', 'Kvartsvingt trapp med repos', 'hull-l-repos', {
        type: 'quarter-turn-landing',
        risers: 14,
        top: { edge: [[12.0, 1.0], [12.9, 1.0]], down: [0, 1] },
        foot: { edge: [[10.5, 2.5], [10.5, 3.4]], down: [-1, 0] },
        guards: [...holeGuards('rekk-l-repos', h4, [[12.0, 1.0], [12.9, 1.0]]), { id: 'rekk-l-repos-inn', on: 'inner' }, { id: 'rekk-l-repos-ut', on: 'outer' }],
        guardStyle: { ...GUARD, infill: 'rods', hang: 0 },
      }),
      // a steep stair (ship's ladder) in a 0,7 × 1,55 hole: 11 risers à 0,236, 57°; balusters
      stair('trapp-bratt', 'Bratt trapp', 'hull-bratt', {
        type: 'steep',
        top: { edge: [[15.0, 1.0], [15.7, 1.0]], down: [0, 1] },
        foot: { edge: [[15.0, 2.5], [15.7, 2.5]], down: [0, 1] },
        tread: { ...TREAD, nosing: 0.02 },
        guards: [...holeGuards('rekk-bratt', h5, [[15.0, 1.0], [15.7, 1.0]]), { id: 'rekk-bratt-v', on: 'left' }, { id: 'rekk-bratt-h', on: 'right' }],
        guardStyle: { ...GUARD, hang: 0 },
      }),
    ],
    builtInLights: [],
  };
}

export const STAIRS = ['trapp-rett', 'trapp-tett', 'trapp-l-sving', 'trapp-l-repos', 'trapp-bratt'];

/**
 * An empty base spec with the house laid over it (planbygger export.js baseSpec + mergeOnto): the living room's floor
 * polygon degenerate at the first room corner, and a flat «roof line» far away so rooms.js's cladding does not follow
 * the owner's sloping living-room ceiling (as the planbygger viewer does).
 */
export function testHouseSpec(house = testHouse()) {
  const spec = {
    meta: { name: 'Trappetyper', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
    zones: [],
    floor: { polygon: [[-0.5, -0.5], [-0.5, -0.5], [-0.5, -0.5]], material: 'oak-plank', color: '#b8a48c' },
    baseboard: { height: 0.07, thickness: 0.012, color: '#ece9e3' },
    walls: [],
    ceilings: [],
    bulkheads: [],
    builtInLights: [],
    kitchen: { items: [] },
    furniture: [],
    fixtures: [],
    highWall: { wallId: null, name: '', start: [0, 0], end: [0, 0], uDir: [1, 0], normal: [0, 1], width: 0, height: 0, obstacles: [] },
    outside: {},
    photoCameras: [],
  };
  for (const [k, v] of Object.entries(house)) {
    if (k.startsWith('$')) continue;
    spec[k] = Array.isArray(v) ? [...(spec[k] || []), ...structuredClone(v)] : structuredClone(v);
  }
  spec.ceilings.push({ id: 'c-taklinje', type: 'slope', polygon: [[-900, -900], [-899, -900], [-899, -899]], highLine: [[-900, -900], [-899, -900]], lowLine: [[-900, -899], [-899, -899]], highHeight: 2.4, lowHeight: 2.4, color: '#ffffff' });
  return spec;
}
