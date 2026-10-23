/**
 * The window-model test house (notes/vindusmodeller.md): one room of 16 × 6 m with every window type of the house
 * format on its four walls and two roof windows in its ceiling. Used by dev/vinduer.html (look at it) and
 * tools/house-tests/vinduer.test.mjs (build it in Node, check it).
 *
 *   vinduerHus() → the house file (house format, like a planbygger house: no living room of the owner's)
 *   vinduerSpec() → the spec for buildLayout (the house on an empty base, as the planbygger's viewer does it)
 *
 * Windows are listed by wall with `name` = the label on the test page.
 */

/** The owner's black window, as in research/house/10-hoved-rom.json (win-sov). */
const OWNER = {
  frame: { color: '#25272b', width: 0.07, depth: 0.07 },
  reveal: { depth: 0.2 },
  sillBoard: { depth: 0.2, thickness: 0.025, overhang: 0.01 },
};

const WINDOWS = {
  // south wall (z = 0, from x 0 to 16): divisions
  'w-test-s': [
    { name: 'Topphengslet (som eierens)', offset: 0.5, width: 1.2, height: 1.2, sill: 0.9, ...OWNER, sashes: [{ opening: true, hinge: 'top' }] },
    { name: 'Fast, uten noe (planbyggerens i dag)', offset: 2.2, width: 1.2, height: 1.2, sill: 0.9 },
    { name: 'Todelt, sidehengslet', offset: 3.9, width: 1.4, height: 1.2, sill: 0.9, ...OWNER, sashes: [{ from: 0, to: 0.5, opening: true, hinge: 'left' }, { from: 0.5, to: 1, opening: true, hinge: 'right' }] },
    { name: 'Tredelt: fast – åpent – fast', offset: 5.8, width: 2.1, height: 1.3, sill: 0.8, ...OWNER, sashes: [{ from: 0, to: 1 / 3 }, { from: 1 / 3, to: 2 / 3, opening: true }, { from: 2 / 3, to: 1 }] },
    { name: 'Med overlys', offset: 8.4, width: 1.2, height: 1.7, sill: 0.6, ...OWNER, sashes: [{ top: 0.7, opening: true, hinge: 'left' }, { bottom: 0.7 }] },
    { name: 'Todelt med overlys', offset: 10.1, width: 1.6, height: 1.8, sill: 0.5, ...OWNER, sashes: [{ from: 0, to: 0.5, top: 0.72, opening: true, hinge: 'left' }, { from: 0.5, to: 1, top: 0.72, opening: true, hinge: 'right' }, { bottom: 0.72 }] },
    { name: 'Lite firkantet', offset: 12.2, width: 0.6, height: 0.6, sill: 1.4, ...OWNER, sashes: [{ opening: true }] },
    { name: 'Helt ned til gulvet, todelt', offset: 13.3, width: 1.8, height: 2.3, sill: 0, frame: OWNER.frame, reveal: OWNER.reveal, sashes: [{ from: 0, to: 0.5 }, { from: 0.5, to: 1, opening: true, hinge: 'right' }] },
  ],
  // north wall (z = 6, from x 16 to 0): glazing bars
  'w-test-n': [
    { name: 'Sprosser 2 × 3', offset: 0.6, width: 1.0, height: 1.4, sill: 0.8, ...OWNER, panes: [2, 3], sashes: [{ opening: true }] },
    { name: 'Todelt, 2 × 3 ruter i hvert felt', offset: 2.2, width: 1.4, height: 1.3, sill: 0.8, ...OWNER, panes: [2, 3], sashes: [{ from: 0, to: 0.5, opening: true, hinge: 'left' }, { from: 0.5, to: 1, opening: true, hinge: 'right' }] },
    { name: 'Smalt og veldig oppdelt (2 × 6)', offset: 4.2, width: 0.45, height: 1.8, sill: 0.5, ...OWNER, panes: [2, 6], bars: { width: 0.02 } },
    { name: 'Smalt med overlys', offset: 5.2, width: 0.45, height: 1.8, sill: 0.5, ...OWNER, sashes: [{ top: 0.75, opening: true, hinge: 'left' }, { bottom: 0.75 }] },
    { name: 'Hvit karm, sprosser 3 × 4', offset: 6.3, width: 1.5, height: 1.5, sill: 0.7, ...OWNER, frame: { color: '#f2f0eb', width: 0.07, depth: 0.07 }, panes: [3, 4], sashes: [{ opening: true }] },
    { name: 'Tredelt med sprosser', offset: 8.4, width: 2.4, height: 1.4, sill: 0.7, ...OWNER, sashes: [{ from: 0, to: 0.3, panes: [2, 3] }, { from: 0.3, to: 0.7, opening: true, panes: [3, 3] }, { from: 0.7, to: 1, panes: [2, 3] }] },
    { name: 'Smalt gulvvindu, 1 × 4', offset: 11.4, width: 0.5, height: 2.3, sill: 0, frame: OWNER.frame, reveal: OWNER.reveal, panes: [1, 4] },
    { name: 'Gulvvindu, tredelt med sprosser', offset: 12.4, width: 2.4, height: 2.3, sill: 0, frame: OWNER.frame, reveal: OWNER.reveal, panes: [2, 5], sashes: [{ from: 0, to: 1 / 3 }, { from: 1 / 3, to: 2 / 3, opening: true, hinge: 'left' }, { from: 2 / 3, to: 1 }] },
  ],
  // west wall (x = 0, from z 6 to 0)
  'w-test-v': [
    { name: 'Svart karm, hvite sprosser 3 × 3', offset: 1.0, width: 1.3, height: 1.3, sill: 0.8, ...OWNER, panes: [3, 3], bars: { color: '#f2f0eb', width: 0.03 } },
    { name: 'Bred post (frame.mullion 0,12)', offset: 3.3, width: 1.8, height: 1.3, sill: 0.8, ...OWNER, frame: { ...OWNER.frame, mullion: 0.12 }, sashes: [{ from: 0, to: 0.5, opening: true, hinge: 'left' }, { from: 0.5, to: 1, opening: true, hinge: 'right' }] },
  ],
  // east wall (x = 16, from z 0 to 6)
  'w-test-o': [
    { name: 'Bunnhengslet', offset: 1.0, width: 1.0, height: 0.8, sill: 1.2, ...OWNER, sashes: [{ opening: true, hinge: 'bottom' }] },
    { name: 'Fire felt (2 × 2)', offset: 3.0, width: 1.4, height: 1.6, sill: 0.6, ...OWNER, sashes: [{ from: 0, to: 0.5, top: 0.5 }, { from: 0.5, to: 1, top: 0.5 }, { from: 0, to: 0.5, bottom: 0.5, opening: true, hinge: 'left' }, { from: 0.5, to: 1, bottom: 0.5, opening: true, hinge: 'right' }] },
  ],
};

const L = 16;
const D = 6;
const HGT = 2.6;

/** The house file. */
export function vinduerHus() {
  const corners = [[0, 0], [L, 0], [L, D], [0, D]];
  const ids = ['w-test-s', 'w-test-o', 'w-test-n', 'w-test-v'];
  const normals = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  let n = 0;
  const walls = ids.map((id, i) => ({
    id,
    roomId: 'galleri',
    from: corners[i],
    to: corners[(i + 1) % 4],
    normal: normals[i],
    thickness: 0.3,
    height: HGT,
    exterior: true,
    color: '#ece9e3',
    openings: (WINDOWS[id] || []).map((w) => ({ id: `win-test-${++n}`, type: 'window', ...w })),
  }));
  return {
    levels: [{ id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: HGT }],
    rooms: [{
      id: 'galleri',
      name: 'Vindusgalleri',
      levelId: 'hoved',
      kind: 'bedroom',
      polygon: corners,
      floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' },
      ceilingIds: ['c-galleri'],
      acoustic: { mode: 'estimate' },
    }],
    walls,
    ceilings: [{
      id: 'c-galleri',
      roomId: 'galleri',
      polygon: corners,
      height: HGT,
      color: '#f4f2ee',
      skylights: [
        { id: 'sk-test-1', name: 'Takvindu, fast', polygon: [[4, 2.4], [4.78, 2.4], [4.78, 3.58], [4, 3.58]] },
        { id: 'sk-test-2', name: 'Takvindu, åpnes, 1 × 2 ruter, dyp sjakt', polygon: [[9, 2.4], [10.14, 2.4], [10.14, 3.58], [9, 3.58]], depth: 0.45, opening: true, panes: [1, 2] },
      ],
    }],
  };
}

/**
 * The spec for buildLayout: the house on the empty base the planbygger's viewer uses (src/planbygger/export.js
 * baseSpec + mergeOnto on its branch) – a zero-area living-room floor at the first corner, and a flat «roof line» far
 * away so rooms.js lets the outer cladding end 0.25 over the walls instead of following the owner's sloping ceiling.
 */
export function vinduerSpec(house = vinduerHus()) {
  return {
    meta: { name: 'Vindusmodeller', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
    zones: [],
    floor: { polygon: [[0, 0], [0, 0], [0, 0]], material: 'oak-plank', color: '#b8a48c' },
    baseboard: { height: 0.07, thickness: 0.012, color: '#ece9e3' },
    walls: house.walls,
    ceilings: [
      ...house.ceilings,
      { id: 'c-taklinje', type: 'slope', polygon: [[-900, -900], [-899, -900], [-899, -899]], highLine: [[-900, -900], [-899, -900]], lowLine: [[-900, -899], [-899, -899]], highHeight: HGT, lowHeight: HGT, color: '#ffffff' },
    ],
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
  };
}
