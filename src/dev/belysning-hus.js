import { createDoc, createLevel } from '../planbygger/model.js';
import { exportHouse } from '../planbygger/export.js';

/**
 * The lighting test house (notes/belysning-genererte-hus.md): a small 1 ½-storey house drawn as a planbygger plan
 * (src/planbygger/model.js) and exported by the planbygger itself (export.js), so the house file is exactly what the
 * planbygger sends today – then given what the planbygger should send for the lighting: no lights of its own, a gable
 * roof over the loft with the loft ceilings following it (notes/tak.md), the terrace, and `lighting` with the hints it
 * may have. Built by dev/belysning.html (look at it) and tools/house-tests/belysning.test.mjs (check it).
 *
 *   belysningHus({ level, hints }) → { house, report, frame, at(name) }
 *
 * Plan (metres, x right, y down; 11 × 8 m, exterior walls 0,25, interior 0,1):
 *   1. etasje  Kjøkken/stue 0–6 × 0–5 (counter and upper cabinets along the north wall, island, dining table, terrace
 *              door west to the deck), Entré 6–11 × 0–2,5 (front door north, the carport north of it), Gang 6–11 ×
 *              2,5–5 (the stair up along its north wall), Soverom 0–6 × 5–8 (bed against the west wall), Bad 6–9 × 5–8
 *              (mirror on its west wall), Bod 9–11 × 5–8 (no window)
 *   2. etasje  Loftstue 0–6 × 0–8, Kontor 6–11 × 0–2,5, Hall 6–11 × 2,5–5 (the stairwell), Soverom 2 6–11 × 5–8;
 *              a gable roof 35° with 1 m knee walls (the ridge along x, the gables west and east), ceilings at the
 *              collar 2,4 m and the slope
 */
export function belysningDoc() {
  const doc = createDoc('Belysningshuset');
  const box = (p) => [
    { id: `${p}-n`, a: [0, 0], b: [11, 0], t: 0.25 },
    { id: `${p}-e`, a: [11, 0], b: [11, 8], t: 0.25 },
    { id: `${p}-s`, a: [11, 8], b: [0, 8], t: 0.25 },
    { id: `${p}-w`, a: [0, 8], b: [0, 0], t: 0.25 },
  ];
  const door = (id, wall, at, width = 0.9, extra = {}) => ({ id, wall, type: 'door', at, width, hinge: 'start', side: 1, ...extra });
  const win = (id, wall, at, width = 1.2, extra = {}) => ({ id, wall, type: 'window', at, width, sill: 0.9, height: 1.2, ...extra });

  const h = createLevel(doc, { id: 'hoved', image: { name: 'belysning-1', width: 1, height: 1, pxPerM: 100 } });
  h.walls = [
    ...box('h'),
    { id: 'h-i1', a: [6, 0], b: [6, 5], t: 0.1 },
    { id: 'h-i2', a: [6, 2.5], b: [11, 2.5], t: 0.1 },
    { id: 'h-i3', a: [0, 5], b: [11, 5], t: 0.1 },
    { id: 'h-i4', a: [6, 5], b: [6, 8], t: 0.1 },
    { id: 'h-i5', a: [9, 5], b: [9, 8], t: 0.1 },
  ];
  h.openings = [
    door('h-d-inngang', 'h-n', 9, 1.0),
    door('h-d-entre-stue', 'h-i1', 1.25),
    door('h-d-gang-stue', 'h-i1', 3.75),
    door('h-d-entre-gang', 'h-i2', 0.8),
    door('h-d-stue-sov', 'h-i3', 3),
    door('h-d-gang-bad', 'h-i3', 7, 0.8),
    door('h-d-gang-bod', 'h-i3', 10, 0.8),
    { id: 'h-d-terrasse', wall: 'h-w', type: 'door', variant: 'sliding', at: 5.5, width: 1.8, hinge: 'start', side: 1 },
    win('h-v-stue', 'h-n', 4.5, 1.6),
    win('h-v-stue-v', 'h-w', 3.7, 1.0),
    win('h-v-sov-1', 'h-s', 9.5),
    win('h-v-sov-2', 'h-s', 7.0),
    win('h-v-bad', 'h-s', 3.5, 0.6, { sill: 1.3, height: 0.7 }),
    win('h-v-entre', 'h-e', 1.2, 0.6),
    win('h-v-gang', 'h-e', 4.3, 0.8),
  ];
  h.rooms = [
    { id: 'r1', name: 'Kjøkken/stue', kind: 'living', seed: [3, 2.5] },
    { id: 'r2', name: 'Entré', kind: 'entrance', seed: [8.5, 1.2] },
    { id: 'r3', name: 'Gang', kind: 'hall', seed: [6.7, 4.5] },
    { id: 'r4', name: 'Soverom', kind: 'bedroom', seed: [3, 6.5] },
    { id: 'r5', name: 'Bad', kind: 'bathroom', seed: [7.5, 6.5] },
    { id: 'r6', name: 'Bod', kind: 'storage', seed: [10, 6.5] },
  ];

  const o = createLevel(doc, { id: 'etasje-2', floorY: 2.7, image: { name: 'belysning-2', width: 1, height: 1, pxPerM: 100 } });
  o.walls = [
    ...box('o'),
    { id: 'o-i1', a: [6, 0], b: [6, 8], t: 0.1 },
    { id: 'o-i2', a: [6, 2.5], b: [11, 2.5], t: 0.1 },
    { id: 'o-i3', a: [6, 5], b: [11, 5], t: 0.1 },
  ];
  o.openings = [
    door('o-d-stue-hall', 'o-i1', 3.75),
    door('o-d-hall-kontor', 'o-i2', 0.8),
    door('o-d-hall-sov', 'o-i3', 0.8),
    win('o-v-stue-1', 'o-w', 3.0, 1.0),
    win('o-v-stue-2', 'o-w', 5.0, 1.0),
    win('o-v-kontor', 'o-e', 2.0, 0.6),
    win('o-v-sov', 'o-e', 5.5, 0.8),
  ];
  o.rooms = [
    { id: 'r7', name: 'Loftstue', kind: 'living', seed: [3, 4] },
    { id: 'r8', name: 'Kontor', kind: 'bedroom', seed: [8.5, 1.2] },
    { id: 'r9', name: 'Hall', kind: 'hall', seed: [6.7, 4.5] },
    { id: 'r10', name: 'Soverom 2', kind: 'bedroom', seed: [8.5, 6.5] },
  ];
  // the stair: the hole in the loft floor along the hall's north wall, down toward +x (its foot by the east wall)
  o.stairs = [{ id: 't1', rect: [[7.5, 2.6], [10.8, 3.6]], axis: 'x', down: 1 }];
  return doc;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The house file with what the planbygger should send for the lighting.
 * @param {{ level?: 'basic'|'standard'|'rich', hints?: boolean, lighting?: boolean }} [o]
 */
export function belysningHus({ level = 'standard', hints = true, lighting = true } = {}) {
  const ex = exportHouse(belysningDoc());
  const house = ex.house;
  const G = (p, lv = 'hoved') => ex.frame.toGame(p, lv).map(r3);
  const rect = ([x0, y0], [x1, y1], lv) => [G([x0, y0], lv), G([x1, y0], lv), G([x1, y1], lv), G([x0, y1], lv)];
  const at = (name) => house.rooms.find((r) => r.name === name);

  // what the planbygger should send (notes/belysning-genererte-hus.md): no lights of its own …
  house.builtInLights = [];
  house.lightGroups = [];
  // … the roof over the loft, the loft ceilings following it (notes/tak.md) …
  house.roofs = [{ id: 'tak-loft', type: 'gable', levelId: 'etasje-2', pitch: 35, kneeHeight: 1.0, ridge: [0, 1] }];
  for (const c of house.ceilings) if (house.rooms.find((r) => r.id === c.roomId)?.levelId === 'etasje-2') Object.assign(c, { type: 'roof', height: 2.4 });
  // … the terrace outside the sliding door (its edge on the outer face of the west wall) …
  house.decks = [{ id: 'dekk-1', kind: 'terrace', levelId: 'hoved', y: -0.02, outline: rect([-3.2, 0.6], [-0.125, 4.6]), surface: 'boards' }];
  // … and the lighting with the hints it has (plan metres → the game's x, z)
  if (lighting) {
    house.lighting = { level };
    if (hints) {
      house.lighting.hints = [
        { type: 'island', outline: rect([0.8, 1.75], [3.0, 2.65]) },
        { type: 'upper-cabinets', from: G([0.35, 0.125]), to: G([3.35, 0.125]) },
        { type: 'dining-table', outline: rect([3.6, 3.15], [5.4, 4.05]) },
        { type: 'mirror', position: G([6.06, 6.3]), height: 1.6 },
        { type: 'bed', outline: rect([0.125, 5.7], [2.125, 7.3]) },
        { type: 'carport', outline: rect([6.4, -5.6], [11.0, -0.125]) },
      ];
    }
  }
  return { house, report: ex.report, frame: ex.frame, at };
}

/** The spec for buildLayout: the house on an empty base, as the planbygger's 3D view builds it (export.js mergeOnto). */
export { mergeOnto, baseSpec } from '../planbygger/export.js';
