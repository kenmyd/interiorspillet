/**
 * Testhuset for kjøkken, bad og vaskerom i genererte hus (notes/kjokken-bad-genererte-hus.md): én etasje med tre rom på
 * rad langs z, alle 4 m (x 0–4): kjøkkenet (z 0–6) med benk, overskap, ventilator, høyskapsrad og øy, badet (z 6,1–8,5)
 * med dusjhjørne, badekar, WC, servant, speil og håndkletørker, og vaskerommet (z 8,6–11,1, skrått tak 2,4 → 2,1) med
 * benk over vaskemaskin og tørketrommel, skyllekar, VVB, en dusj uten vegger og et sluk midt i rommet. Fliser på
 * gulvet og veggene i badet (til taket) og vaskerommet (1,2 m, dusjveggene til taket). Alt er slik planbyggeren skal
 * sende det: én oppføring per symbol, med type, posisjon, retning og størrelse – resten finner motoren ut av.
 * tools/kjokkenbad/index.html (se og gå) og tools/house-tests/kjokkenbad.test.mjs (valider og bygg) bruker samme hus.
 *
 *   testHouse()      → husfila (formatet i research/house/NN-*.json, som planbyggeren lager)
 *   testHouseSpec()  → husfila lagt på en tom grunnspes, klar for home/layout.js buildLayout
 *   VIEWS            → kameraplasser for skjermbilder (?view=<navn>)
 */

const WALL = { height: 2.4, paint: '#ebe8e2' };
const EXT = { ...WALL, thickness: 0.25, exterior: true };
const INNER = { frame: { color: '#e9e7e1', width: 0.06, depth: 0.02 }, reveal: { depth: 0.1, color: '#e9e7e1' } };
const WIN = { frame: { color: '#2b2c2e', width: 0.05, depth: 0.06 }, reveal: { depth: 0.2, color: '#ece9e3' } };

/** A door in a wall owned by `owner` between `owner` and `other` (swing 'in' = into the owner). */
function door(id, name, offset, width, owner, other, { swing = 'in', hinge = 'from', outside = false } = {}) {
  return {
    id, name, type: 'door', offset, width, height: 2.1, sill: 0, ...INNER, connects: [owner, outside ? 'ute' : other],
    ...(outside ? { interactive: true } : {}),
    door: { leafColor: '#f1efea', opensInto: swing === 'in' ? owner : outside ? 'ute' : other, handleHeight: 1.05, closed: true, hinge, swing },
  };
}

export function testHouse() {
  return {
    $comment: 'Testhus for kjøkken, bad og vaskerom (tools/kjokkenbad, notes/kjokken-bad-genererte-hus.md). Ikke en del av spillets hus.',
    levels: [{ id: 'hoved', name: 'Hovedetasje', floorY: 0, slabThickness: 0.3, ceilingDefault: 2.4 }],
    rooms: [
      { id: 'kjokken', name: 'Kjøkken', levelId: 'hoved', kind: 'living', acoustic: { mode: 'estimate' }, polygon: [[0, 0], [4, 0], [4, 6], [0, 6]], floor: { material: 'oak-plank', color: '#b8a48c', boards: 'x' }, ceilingIds: ['c-kjokken'] },
      {
        id: 'bad', name: 'Bad', levelId: 'hoved', kind: 'bathroom', acoustic: { mode: 'estimate' }, polygon: [[0, 6.1], [4, 6.1], [4, 8.5], [0, 8.5]],
        floor: { material: 'tiles', color: '#8f8c88', size: [0.3, 0.3], surface: 'tile' },
        // a bathroom is tiled to the ceiling (the defaults: 'ceiling', 30 × 60 white)
        wallTiles: { height: 'ceiling', color: '#ecebe7', size: [0.3, 0.6] },
        ceilingIds: ['c-bad'],
      },
      {
        id: 'vask', name: 'Vaskerom', levelId: 'hoved', kind: 'laundry', acoustic: { mode: 'estimate' }, polygon: [[0, 8.6], [4, 8.6], [4, 11.1], [0, 11.1]],
        floor: { material: 'tiles', color: '#7f7c78', size: [0.2, 0.2], surface: 'tile' },
        // tiled to 1.2 m (the shower's walls go to the ceiling anyway)
        wallTiles: { height: 1.2, color: '#dcdad5', size: [0.2, 0.4] },
        ceilingIds: ['c-vask'],
      },
    ],
    walls: [
      // kjøkkenet
      { id: 'w-kj-ost', roomId: 'kjokken', levelId: 'hoved', from: [0, 0], to: [4, 0], normal: [0, 1], ...EXT },
      { id: 'w-kj-sor', roomId: 'kjokken', levelId: 'hoved', from: [4, 0], to: [4, 6], normal: [-1, 0], ...EXT, openings: [{ id: 'win-kj', type: 'window', offset: 2.2, width: 1.6, height: 1.3, sill: 0.8, ...WIN }] },
      { id: 'w-kj-vest', roomId: 'kjokken', levelId: 'hoved', from: [4, 6], to: [0, 6], normal: [0, -1], thickness: 0.1, ...WALL, openings: [door('door-kj-bad', 'Dør til badet', 1.0, 0.9, 'kjokken', 'bad')] },
      { id: 'w-kj-nord', roomId: 'kjokken', levelId: 'hoved', from: [0, 6], to: [0, 0], normal: [1, 0], ...EXT },
      // badet
      { id: 'w-bad-kj', roomId: 'bad', levelId: 'hoved', from: [0, 6.1], to: [4, 6.1], normal: [0, 1], backOf: 'w-kj-vest', ...WALL },
      { id: 'w-bad-sor', roomId: 'bad', levelId: 'hoved', from: [4, 6.1], to: [4, 8.5], normal: [-1, 0], ...EXT, openings: [{ id: 'win-bad', type: 'window', offset: 1.75, width: 0.5, height: 0.8, sill: 1.2, frosted: true, ...WIN }] },
      { id: 'w-bad-vask', roomId: 'bad', levelId: 'hoved', from: [4, 8.5], to: [0, 8.5], normal: [0, -1], thickness: 0.1, ...WALL, openings: [door('door-bad-vask', 'Dør til vaskerommet', 2.0, 0.8, 'bad', 'vask', { hinge: 'from' })] },
      { id: 'w-bad-nord', roomId: 'bad', levelId: 'hoved', from: [0, 8.5], to: [0, 6.1], normal: [1, 0], ...EXT },
      // vaskerommet (skrått tak: 2,4 mot badet, 2,1 mot vest)
      { id: 'w-vask-bad', roomId: 'vask', levelId: 'hoved', from: [0, 8.6], to: [4, 8.6], normal: [0, 1], backOf: 'w-bad-vask', ...WALL },
      { id: 'w-vask-sor', roomId: 'vask', levelId: 'hoved', from: [4, 8.6], to: [4, 11.1], normal: [-1, 0], ...EXT, topProfile: [[0, 2.4], [2.5, 2.1]], openings: [{ id: 'win-vask', type: 'window', offset: 1.3, width: 0.6, height: 0.6, sill: 1.1, ...WIN }] },
      { id: 'w-vask-vest', roomId: 'vask', levelId: 'hoved', from: [4, 11.1], to: [0, 11.1], normal: [0, -1], ...EXT, height: 2.1, openings: [door('door-vask-ute', 'Ytterdør', 1.5, 0.9, 'vask', 'ute', { swing: 'out', outside: true })] },
      { id: 'w-vask-nord', roomId: 'vask', levelId: 'hoved', from: [0, 11.1], to: [0, 8.6], normal: [1, 0], ...EXT, topProfile: [[0, 2.1], [2.5, 2.4]] },
    ],
    ceilings: [
      { id: 'c-kjokken', roomId: 'kjokken', polygon: [[0, 0], [4, 0], [4, 6], [0, 6]], type: 'flat', height: 2.4, paint: '#f2f2f0' },
      { id: 'c-bad', roomId: 'bad', polygon: [[0, 6.1], [4, 6.1], [4, 8.5], [0, 8.5]], type: 'flat', height: 2.4, paint: '#f2f2f0' },
      { id: 'c-vask', roomId: 'vask', polygon: [[0, 8.6], [4, 8.6], [4, 11.1], [0, 11.1]], type: 'slope', highLine: [[0, 8.6], [4, 8.6]], lowLine: [[0, 11.1], [4, 11.1]], highHeight: 2.4, lowHeight: 2.1, paint: '#f2f2f0' },
    ],
    builtInLights: [],
    builtIns: [
      // ---- kjøkkenet: benken på nordveggen (x = 0) z 0,6–4,2 med dobbel kum (KV), oppvaskmaskin (OM), koketopp (KT)
      //      over stekeovn (ST) og flis mellom benken og overskapene; overskap og ventilator (V) over; høyskapsraden
      //      på østveggen (z = 0): HS, K, F, M/O; øya med en kum, fronter mot benken og sitteplass mot sør
      { id: 'bi-kj-benk', roomId: 'kjokken', type: 'kitchen-bench', name: 'Kjøkkenbenk', mount: 'wall', wallId: 'w-kj-nord', position: [0, 0, 2.4], rotationDeg: 90, dims: { w: 3.6, d: 0.6, h: 0.9 }, params: { backsplash: { color: '#d9d6d0', size: [0.1, 0.3] } } },
      { id: 'bi-kj-kum', roomId: 'kjokken', type: 'sink', name: 'Kjøkkenvask', mount: 'floor', position: [0.3, 0, 1.3], rotationDeg: 90, dims: { w: 0.8, d: 0.5, h: 0.9 }, params: { bowls: 2 } },
      { id: 'bi-kj-om', roomId: 'kjokken', type: 'dishwasher', name: 'Oppvaskmaskin', mount: 'floor', position: [0.3, 0, 2.0], rotationDeg: 90, dims: { w: 0.6, d: 0.6, h: 0.9 } },
      { id: 'bi-kj-topp', roomId: 'kjokken', type: 'hob', name: 'Koketopp', mount: 'floor', position: [0.3, 0, 3.3], rotationDeg: 90, dims: { w: 0.6, d: 0.52, h: 0.9 } },
      { id: 'bi-kj-ovn', roomId: 'kjokken', type: 'oven', name: 'Stekeovn', mount: 'floor', position: [0.3, 0, 3.3], rotationDeg: 90, dims: { w: 0.6, d: 0.6, h: 0.9 } },
      { id: 'bi-kj-overskap', roomId: 'kjokken', type: 'wall-cabinets', name: 'Overskap', mount: 'wall', wallId: 'w-kj-nord', position: [0, 1.45, 1.5], rotationDeg: 90, dims: { w: 1.8, d: 0.35, h: 0.7 } },
      { id: 'bi-kj-vent', roomId: 'kjokken', type: 'hood', name: 'Ventilator', mount: 'wall', wallId: 'w-kj-nord', position: [0, 1.55, 3.3], rotationDeg: 90, dims: { w: 0.6, d: 0.48, h: 0.5 } },
      { id: 'bi-kj-hs', roomId: 'kjokken', type: 'tall-cabinet', name: 'Høyskap', mount: 'wall', wallId: 'w-kj-ost', position: [0.3, 0, 0], rotationDeg: 0, dims: { w: 0.6, d: 0.6, h: 2.1 } },
      { id: 'bi-kj-k', roomId: 'kjokken', type: 'fridge', name: 'Kjøleskap', mount: 'wall', wallId: 'w-kj-ost', position: [0.9, 0, 0], rotationDeg: 0, dims: { w: 0.6, d: 0.6, h: 2.1 } },
      { id: 'bi-kj-f', roomId: 'kjokken', type: 'freezer', name: 'Fryser', mount: 'wall', wallId: 'w-kj-ost', position: [1.5, 0, 0], rotationDeg: 0, dims: { w: 0.6, d: 0.6, h: 2.1 } },
      { id: 'bi-kj-mo', roomId: 'kjokken', type: 'oven-tower', name: 'Ovn og mikro', mount: 'wall', wallId: 'w-kj-ost', position: [2.1, 0, 0], rotationDeg: 0, dims: { w: 0.6, d: 0.6, h: 2.1 } },
      { id: 'bi-kj-oy', roomId: 'kjokken', type: 'kitchen-island', name: 'Kjøkkenøy', mount: 'floor', position: [2.3, 0, 3.0], rotationDeg: -90, dims: { w: 2.4, d: 0.9, h: 0.9 } },
      { id: 'bi-kj-oykum', roomId: 'kjokken', type: 'sink', name: 'Kum i øya', mount: 'floor', position: [2.1, 0, 3.6], rotationDeg: -90, dims: { w: 0.6, d: 0.5, h: 0.9 } },
      // ---- badet: dusjhjørne i nordvest (glassvegger og sluk finner motoren), badekar mot sørveggen, WC på nordveggen,
      //      servant og speil på veggen mot kjøkkenet, håndkletørker mot vaskerommet
      { id: 'bi-bad-dusj', roomId: 'bad', type: 'shower', name: 'Dusj', mount: 'floor', position: [0.45, 0, 8.05], rotationDeg: 0, dims: { w: 0.9, d: 0.9, h: 2 } },
      { id: 'bi-bad-kar', roomId: 'bad', type: 'bathtub', name: 'Badekar', mount: 'floor', position: [3.625, 0, 6.95], rotationDeg: -90, dims: { w: 1.7, d: 0.75, h: 0.58 } },
      { id: 'bi-bad-wc', roomId: 'bad', type: 'wc', name: 'WC', mount: 'wall', wallId: 'w-bad-nord', position: [0, 0, 7.0], rotationDeg: 90, dims: { w: 0.6, d: 0.2, h: 1.1 } },
      { id: 'bi-bad-servant', roomId: 'bad', type: 'vanity', name: 'Servant', mount: 'wall', wallId: 'w-bad-kj', position: [1.2, 0.35, 6.1], rotationDeg: 0, dims: { w: 0.8, d: 0.46, h: 0.5 } },
      { id: 'bi-bad-speil', roomId: 'bad', type: 'mirror', name: 'Speil', mount: 'wall', wallId: 'w-bad-kj', position: [1.2, 1.1, 6.1], rotationDeg: 0, dims: { w: 0.8, d: 0.03, h: 0.8 } },
      { id: 'bi-bad-hk', roomId: 'bad', type: 'towel-radiator', name: 'Håndkletørker', mount: 'wall', wallId: 'w-bad-vask', position: [2.6, 0.2, 8.5], rotationDeg: 180, dims: { w: 0.5, d: 0.08, h: 1.2 }, params: { form: 'ladder' } },
      // ---- vaskerommet: benken på nordveggen over vaskemaskinen (VM) og tørketrommelen (TT), skyllekaret, VVB i
      //      sørvesthjørnet, en dusj uten vegger i sørøst (rennesluk langs veggen) og et sluk midt i rommet
      { id: 'bi-vask-benk', roomId: 'vask', type: 'laundry-bench', name: 'Benk', mount: 'wall', wallId: 'w-vask-nord', position: [0, 0, 9.5], rotationDeg: 90, dims: { w: 1.8, d: 0.6, h: 0.9 }, colors: { fronts: '#e6e4df', top: '#8f8a85' } },
      { id: 'bi-vask-vm', roomId: 'vask', type: 'washer', name: 'Vaskemaskin', mount: 'floor', position: [0.3, 0, 8.9], rotationDeg: 90, dims: { w: 0.6, d: 0.6, h: 0.85 } },
      { id: 'bi-vask-tt', roomId: 'vask', type: 'dryer', name: 'Tørketrommel', mount: 'floor', position: [0.3, 0, 9.52], rotationDeg: 90, dims: { w: 0.6, d: 0.6, h: 0.85 } },
      { id: 'bi-vask-skyllekar', roomId: 'vask', type: 'utility-sink', name: 'Skyllekar', mount: 'wall', wallId: 'w-vask-nord', position: [0, 0, 10.75], rotationDeg: 90, dims: { w: 0.6, d: 0.5, h: 0.9 } },
      { id: 'bi-vask-vvb', roomId: 'vask', type: 'water-heater', name: 'Varmtvannsbereder', mount: 'floor', position: [3.67, 0, 10.77], rotationDeg: 0, dims: { w: 0.55, d: 0.55, h: 1.3 } },
      { id: 'bi-vask-dusj', roomId: 'vask', type: 'shower', name: 'Dusj uten vegger', mount: 'floor', position: [3.55, 0, 9.05], rotationDeg: 0, dims: { w: 0.9, d: 0.9, h: 2 }, params: { enclosure: 'none', drain: 'linear' } },
      { id: 'bi-vask-sluk', roomId: 'vask', type: 'floor-drain', name: 'Sluk', mount: 'floor', position: [2.0, 0, 9.9], rotationDeg: 0, dims: { w: 0.15, d: 0.15, h: 0.005 }, params: { shape: 'round' }, collide: false },
    ],
  };
}

/** Kameraplasser: [x, y, z, mot x, y, z]. */
export const VIEWS = {
  kjokken: [3.6, 1.7, 5.4, 0.6, 1.0, 2.0],
  benk: [2.2, 1.6, 2.4, 0, 1.2, 2.4],
  hoyskap: [2.6, 1.6, 3.2, 1.2, 1.1, 0],
  bad: [3.2, 1.65, 6.5, 0.4, 1.0, 8.2],
  dusj: [2.4, 1.6, 6.8, 0.2, 1.1, 8.3],
  kar: [1.2, 1.6, 7.9, 3.8, 0.6, 6.6],
  vask: [3.4, 1.6, 10.6, 0.2, 0.9, 9.3],
  vaskdusj: [1.4, 1.5, 10.3, 3.9, 1.0, 8.8],
};

/**
 * An empty base spec with the house laid over it (as the planbygger viewer and tools/dortyper do): the living room's
 * floor polygon degenerate, and a flat «roof line» far away.
 */
export function testHouseSpec(house = testHouse()) {
  const spec = {
    meta: { name: 'Kjøkken og bad', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
    zones: [],
    floor: { polygon: [[0, 0], [0, 0], [0, 0]], material: 'oak-plank', color: '#b8a48c' },
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
