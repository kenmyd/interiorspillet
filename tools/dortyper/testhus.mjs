/**
 * Testhuset for dørtypene (notes/dortyper.md): én etasje med en gang (z 0–3) og en stue (z 3,1–7), 17 m lange (x −3 til 14). Alle de
 * nye dørtypene står i mellomveggen og i ytterveggene, så tools/dortyper/index.html (se, gå, åpne med E) og
 * tools/house-tests/doortypes.test.mjs (bygg, valider, gå gjennom) bruker samme hus.
 *
 *   testHouse()      → husfila (formatet i research/house/NN-*.json, som planbyggeren lager)
 *   testHouseSpec()  → husfila lagt på en tom grunnspes, klar for home/layout.js buildLayout (som planbyggerens viewer)
 *   DOORS            → id, type og hvilken side figuren går gjennom fra, for testene
 */

const INNER = { frame: { color: '#1d1e21', width: 0.06, depth: 0.02 }, reveal: { depth: 0.1, color: '#1d1e21' } };
const OUTER = { frame: { color: '#25272b', width: 0.05, depth: 0.06 }, reveal: { depth: 0.2, color: '#1d1e21' } };

/** An opening in the gang ↔ stue wall (owner: gang; swing 'in' = into the gang). */
function inner(id, name, offset, width, door) {
  const swing = door.swing ?? 'in';
  return { id, name, type: 'door', offset, width, height: 2.1, sill: 0, ...INNER, connects: ['gang', 'stue'], door: { leafColor: '#1d1e21', opensInto: swing === 'in' ? 'gang' : 'stue', handleHeight: 1.05, closed: true, ...door, swing } };
}

/** An opening in an exterior wall of `room` (swing 'in' = into the room). */
function outer(room, id, name, offset, width, door) {
  const swing = door.swing ?? 'in';
  return { id, name, type: 'door', offset, width, height: 2.15, sill: 0, ...OUTER, connects: [room, 'ute'], interactive: true, door: { leafColor: '#2b2c2e', opensInto: swing === 'in' ? room : 'ute', handleHeight: 1.05, closed: true, ...door, swing } };
}

const WALL = { height: 2.4, paint: '#e6e1d8' };
const EXT = { ...WALL, thickness: 0.25, exterior: true };

export function testHouse() {
  return {
    $comment: 'Testhus for dørtypene (tools/dortyper, notes/dortyper.md). Ikke en del av spillets hus.',
    levels: [{ id: 'hoved', name: 'Hovedetasje', floorY: 0, slabThickness: 0.3, ceilingDefault: 2.4 }],
    rooms: [
      { id: 'gang', name: 'Gang', levelId: 'hoved', kind: 'hall', acoustic: { mode: 'estimate' }, polygon: [[-3, 0], [14, 0], [14, 3], [-3, 3]], floor: { material: 'oak-plank', color: '#b8a48c' }, ceilingIds: ['c-gang'] },
      { id: 'stue', name: 'Stue', levelId: 'hoved', kind: 'living', acoustic: { mode: 'estimate' }, polygon: [[-3, 3.1], [14, 3.1], [14, 7], [-3, 7]], floor: { material: 'oak-plank', color: '#a8916f' }, ceilingIds: ['c-stue'] },
    ],
    walls: [
      {
        id: 'w-gang-nord', roomId: 'gang', levelId: 'hoved', from: [-3, 0], to: [14, 0], normal: [0, 1], ...EXT,
        openings: [
          // front door: glazed leaf with bars, a sidelight on each side down to the floor
          outer('gang', 'door-inngang', 'Inngangsdør med sidefelt', 8.9, 1.9, { hinge: 'from', glass: { cols: 1, rows: 3 }, sidelights: [{ side: 'from', w: 0.4 }, { side: 'to', w: 0.4 }], hardware: { type: 'lever', lock: 'keypad' } }),
        ],
      },
      { id: 'w-gang-ost', roomId: 'gang', levelId: 'hoved', from: [14, 0], to: [14, 3], normal: [-1, 0], ...EXT },
      {
        id: 'w-gang-stue', roomId: 'gang', levelId: 'hoved', from: [14, 3], to: [-3, 3], normal: [0, -1], thickness: 0.1, ...WALL,
        openings: [
          inner('door-glass', 'Innerdør med glassfelt (3 ruter)', 0.4, 0.9, { hinge: 'from', glass: { rows: 3 }, hardware: { type: 'lever', rose: 'round' } }),
          inner('door-dobbel-glass', 'Dobbeltdør med glass og sprosser', 1.8, 1.5, { variant: 'double', hinge: 'from', swing: 'out', leaf: { w: 0.69, h: 2.03 }, leaf2: { w: 0.69, h: 2.03 }, glass: { cols: 2, rows: 4 }, hardware: { type: 'lever' } }),
          inner('door-skyve', 'Skyvedør på skinne', 5.0, 0.95, { variant: 'sliding', mount: 'surface', slide: 'from' }),
          inner('door-lomme', 'Skyvedør inn i veggen', 6.6, 0.9, { variant: 'sliding', mount: 'pocket', slide: 'to' }),
          inner('door-skyve-dobbel', 'Dobbel skyvedør med glass', 9.4, 1.6, { variant: 'sliding', mount: 'surface', slide: 'both', swing: 'out', glass: { rows: 3 } }),
          inner('door-dobbel-ulik', 'Dobbeltdør med ulike blad', 12.2, 1.3, { variant: 'double', hinge: 'to', leaf: { w: 0.8 }, leaf2: { w: 0.4 }, hardware: { type: 'lever' } }),
          // a wide folding door with many panels (F70), folding toward the wall's 'to' end, the folds into the gang
          inner('door-folde', 'Foldedør med mange ledd', 14.2, 2.4, { variant: 'folding', slide: 'to', panels: 8 }),
        ],
      },
      { id: 'w-gang-vest', roomId: 'gang', levelId: 'hoved', from: [-3, 3], to: [-3, 0], normal: [1, 0], ...EXT },
      { id: 'w-stue-gang', roomId: 'stue', levelId: 'hoved', from: [-3, 3.1], to: [14, 3.1], normal: [0, 1], backOf: 'w-gang-stue', ...WALL },
      { id: 'w-stue-ost', roomId: 'stue', levelId: 'hoved', from: [14, 3.1], to: [14, 7], normal: [-1, 0], ...EXT },
      {
        id: 'w-stue-sor', roomId: 'stue', levelId: 'hoved', from: [14, 7], to: [-3, 7], normal: [0, -1], ...EXT,
        openings: [
          outer('stue', 'door-patio', 'Skyvedør av glass (terrasse)', 1.0, 2.4, { variant: 'sliding', mount: 'patio', slide: 'from' }),
          outer('stue', 'door-terrasse', 'Terrassedør med sidefelt', 5.0, 1.45, { hinge: 'from', swing: 'out', glass: { cols: 2, rows: 3 }, sidelights: [{ side: 'to', w: 0.4 }] }),
          outer('stue', 'door-terrasse-dobbel', 'Dobbel terrassedør med sprosser', 8.0, 1.6, { variant: 'double', hinge: 'from', swing: 'out', glass: { cols: 2, rows: 4 } }),
        ],
      },
      { id: 'w-stue-vest', roomId: 'stue', levelId: 'hoved', from: [-3, 7], to: [-3, 3.1], normal: [1, 0], ...EXT,
        openings: [
          // glass folding doors to the terrace: two stacks folding out to both jambs
          outer('stue', 'door-folde-glass', 'Foldedør av glass (to pakker)', 0.75, 2.4, { variant: 'folding', slide: 'both', swing: 'out', glass: true }),
        ],
      },
    ],
    ceilings: [
      { id: 'c-gang', roomId: 'gang', polygon: [[-3, 0], [14, 0], [14, 3], [-3, 3]], type: 'flat', height: 2.4, paint: '#f2f2f0' },
      { id: 'c-stue', roomId: 'stue', polygon: [[-3, 3.1], [14, 3.1], [14, 7], [-3, 7]], type: 'flat', height: 2.4, paint: '#f2f2f0' },
    ],
    builtInLights: [],
  };
}

/** The doors and where the walk test starts / ends (world x, z on each side of the hole's middle). */
export const DOORS = [
  'door-inngang', 'door-glass', 'door-dobbel-glass', 'door-skyve', 'door-lomme', 'door-skyve-dobbel', 'door-dobbel-ulik', 'door-folde', 'door-patio', 'door-terrasse', 'door-terrasse-dobbel', 'door-folde-glass',
];

/**
 * An empty base spec with the house laid over it (planbygger export.js baseSpec + mergeOnto): the living room's floor
 * polygon degenerate at the first room corner, and a flat «roof line» far away so rooms.js's cladding does not follow
 * the owner's sloping living-room ceiling (as the planbygger viewer does).
 */
export function testHouseSpec(house = testHouse()) {
  const spec = {
    meta: { name: 'Dørtyper', units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
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
