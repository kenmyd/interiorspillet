import { createDoc, createLevel } from '../planbygger/model.js';
import { exportHouse, labelRooms, houseFrame, baseSpec, mergeOnto } from '../planbygger/export.js';

/**
 * The furnishing test house (notes/moblering-genererte-hus.md): a one-storey house of 12 × 9 m drawn as a planbygger
 * document and exported by the planbygger itself (export.js exportHouse) – a generated house – with `furnishing` added
 * the way the planbygger is to send it (the plan's furniture symbols in house metres). Built by dev/moblering.html (look
 * at it, walk it) and tools/house-tests/moblering.test.mjs (build it in Node, check it).
 *
 *   plan (x right, y down, north up):
 *     y 0–3.8   Soverom 1 (x 0–3.6, a window to the floor on the west wall) · Bad (3.6–5.8) · Vaskerom (5.8–7.4) ·
 *               Soverom 2 (7.4–10) · Soverom 3 (10–12, narrow: a single bed)
 *     y 3.8–5.2 Gang (x 2.4–12), a door to every room
 *     y 5.2–9   Entré (x 0–2.4, the front door) · Stue/kjøkken (2.4–9.2, a passage from the hall, a sliding door to the
 *               south) · Kontor (9.2–12)
 *   hints: the kitchen on the stue's east wall, the bed of Soverom 1 against its east wall, the desk of the Kontor by its
 *   east window, the bathroom's toilet, shower and basin, the laundry's washer.
 *
 *   mobleringDoc() → the planbygger document
 *   mobleringHus() → { doc, house, hints, toGame }   house = exportHouse(doc).house + furnishing
 *   mobleringSpec(house) → the spec for buildLayout (the house on the planbygger's empty base, as its 3D view does it)
 */

const EXT = 0.25;
const INT = 0.1;

export function mobleringDoc() {
  const doc = createDoc('Møbleringshuset');
  const lv = createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  const W = (id, a, b, t = INT) => lv.walls.push({ id, a, b, t });
  W('n', [0, 0], [12, 0], EXT);
  W('e', [12, 0], [12, 9], EXT);
  W('s', [12, 9], [0, 9], EXT);
  W('w', [0, 9], [0, 0], EXT);
  W('gang-n', [0, 3.8], [12, 3.8]);
  W('gang-s', [2.4, 5.2], [12, 5.2]);
  W('entre-o', [2.4, 3.8], [2.4, 9]);
  W('sk1', [3.6, 0], [3.6, 3.8]);
  W('sk2', [5.8, 0], [5.8, 3.8]);
  W('sk3', [7.4, 0], [7.4, 3.8]);
  W('sk4', [10, 0], [10, 3.8]);
  W('kontor-v', [9.2, 5.2], [9.2, 9]);
  const O = (id, wall, type, at, width, extra = {}) => lv.openings.push({ id, wall, type, at, width, ...extra });
  const door = (id, wall, at, width = 0.8, side = 1) => O(id, wall, 'door', at, width, { hinge: 'start', side });
  const win = (id, wall, at, width, sill = 0.9, height = 1.2) => O(id, wall, 'window', at, width, { sill, height });
  // doors and passages
  door('d-ute', 's', 10.8, 1.0, -1);
  door('d-entre', 'entre-o', 0.7, 0.9);
  // the doors on the hall's north wall open into the rooms (side −1), not into the 1.4 m hall
  door('d-sov1', 'gang-n', 3.0, 0.8, -1);
  door('d-bad', 'gang-n', 4.7, 0.8, -1);
  door('d-vask', 'gang-n', 6.6, 0.8, -1);
  door('d-sov2', 'gang-n', 8.7, 0.8, -1);
  door('d-sov3', 'gang-n', 10.5, 0.8, -1);
  O('p-stue', 'gang-s', 'opening', 1.6, 1.4, { height: 2.1 });
  door('d-kontor', 'gang-s', 8.2);
  O('d-terrasse', 's', 'door', 6.0, 2.0, { variant: 'sliding', hinge: 'start', side: 1 });
  // windows (a window to the floor in Soverom 1)
  win('v-sov1', 'n', 1.8, 1.2);
  win('v-sov1-gulv', 'w', 7.0, 1.0, 0.1, 2.0);
  win('v-bad', 'n', 4.7, 0.6, 1.3, 0.7);
  win('v-vask', 'n', 6.6, 0.6, 1.3, 0.7);
  win('v-sov2', 'n', 8.7, 1.0);
  win('v-sov3', 'n', 11.0, 0.9);
  win('v-entre', 'w', 2.0, 0.6);
  win('v-stue-1', 's', 8.5, 1.4);
  win('v-stue-2', 's', 3.8, 1.2);
  win('v-kontor-s', 's', 1.4, 1.2);
  win('v-sov3-o', 'e', 2.0, 0.9);
  win('v-kontor-o', 'e', 7.0, 1.2);
  // the rooms (labels at a seed point)
  const R = (name, kind, seed) => lv.rooms.push({ id: `r-${lv.rooms.length + 1}`, name, kind, seed });
  R('Soverom 1', 'bedroom', [1.8, 1.9]);
  R('Bad', 'bathroom', [4.7, 1.9]);
  R('Vaskerom', 'laundry', [6.6, 1.9]);
  R('Soverom 2', 'bedroom', [8.7, 1.9]);
  R('Soverom 3', 'bedroom', [11.0, 1.9]);
  R('Gang', 'hall', [7.0, 4.5]);
  R('Entré', 'entrance', [1.2, 6.5]);
  R('Stue/kjøkken', 'living', [5.8, 7.1]);
  R('Kontor', 'bedroom', [10.6, 7.1]);
  return doc;
}

/** The plan's furniture symbols (plan metres) – what the KI's readPlan `furniture` gives, in the plan's frame. */
const HINTS = [
  { kind: 'kitchen', at: [8.8, 6.6] },
  { kind: 'bed', at: [2.6, 1.9] },
  { kind: 'desk', at: [11.5, 7.0] },
  { kind: 'toilet', at: [5.4, 0.5] },
  { kind: 'shower', at: [4.15, 0.55] },
  { kind: 'washbasin', at: [5.45, 2.1] },
  { kind: 'washer', at: [6.6, 0.45] },
];

export function mobleringHus() {
  const doc = mobleringDoc();
  const ex = exportHouse(doc);
  const frame = houseFrame(doc, doc.levels.map((l) => labelRooms(l).found));
  const toGame = (p) => frame.toGame(p, 'hoved').map((v) => Math.round(v * 1000) / 1000);
  const hints = HINTS.map((h) => ({ ...h, at: toGame(h.at), levelId: 'hoved' }));
  const house = { ...ex.house, furnishing: { hints } };
  return { doc, house, hints, toGame, report: ex.report };
}

export function mobleringSpec(house) {
  return mergeOnto(baseSpec('Møblering'), house);
}
