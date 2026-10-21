/**
 * The walking tours of tools/tour.mjs (notes/hele-huset-design.md §7.4; steg 5, 8, 22 and 26) – shared with the Node
 * check tools/house-tests/tour-routes.test.mjs, which tests the routes against layout.house without a browser (not a
 * test itself: tools/test-house.mjs only runs *.test.mjs).
 *
 * A tour:
 *   start      feet x, y, z where the tour teleports to – or `spawn` instead: the tour does not teleport, it walks from
 *              where the game itself started (the page is loaded with &spawn=<spawn> in a fresh browser context, so the
 *              saved position is empty) and checks that start against `expectStart`
 *   route      steps in order:
 *                [x, z]               walk there (hold W, steer toward it every frame; reached within 0.2 m)
 *                { open: '<door id>' } stand still, look at the door (Door.position), check that the interaction
 *                                     system targets it (the HUD prompt, e.g. «Åpne dør – Entré»), press E
 *                                     (interaction.interact) and wait until the leaf is fully open
 *   doors      the ?doors= parameter ('open', 'closed', ids) – null: none, every door as the data says (closed)
 *   rooms      expected room sequence (game.roomId, consecutive repeats collapsed, '-' = outside every room)
 *   names / eyebrows   expected HUD banners (.kv-room__name / .kv-room__eyebrow) in the order they are shown,
 *              including the one shown when the game started
 *   resume     after the route: write the remembered position (LastPosition), reload the page with &spawn=saved and
 *              check that the game starts where the tour ended (in `resume.room`, banner `resume.name`)
 *
 * Coordinates: notes/hele-huset-avstemming.md (V-numbers) over the plan, as built in src/data/room-spec.json:
 *   door-gang     w-gang x 3.12–3.22, hole z 3.36–4.43; opens 180° into the hall and lies flat on the wall at
 *                 z 2.50–3.43 (D6) – the hinge at z ≈ 3.43
 *   stair         top nosing x 1.45 (z 2.32–3.10), down toward north; winders round the well x 1.04–1.45 ·
 *                 z 3.10–3.48; foot nosing x 1.73 (z 3.48–4.43), down toward south into kjeller-gang (V12–V23)
 *   entré ↔ GANG  x 5.75–6.16, z 3.42–4.35, 2 risers à 0.15 (V24)
 *   door-ute      w-entre-sor (inner face x 8.67, outer 8.88), leaf z 3.81–4.81, hinges east, opens out 95°, swing
 *                 x 8.88–9.88 · z 3.81–4.81 (V27); spawnOutside (12.2, −2.87, 4.6), yaw 85° (V32)
 */

/** Where the game starts on the first visit (outsideHouse.spawnOutside, avstemming V32). */
export const SPAWN_OUTSIDE = { pos: [12.2, -2.87, 4.6], yawDeg: 85 };

/**
 * The stair, from the hall (2.0, 2.71) down to the basement hall (2.2, 3.955): along the walk line of house.mjs
 * stairWalk (V13: z 2.71 in the upper flight, round the well corners A (1.04, 3.10) and B (1.04, 3.48) at r 0.39 →
 * 0.455 → 0.475, z 3.955 in the lower flight), 8 cm outside it in the turns. A short cut over the inside of the
 * winders is steeper than a walkable slope (inner going 0.07 m): going up the player stops there, as on the real stair.
 */
const STAIR_DOWN = [[2.0, 2.71], [1.45, 2.71], [1.04, 2.68], [0.794, 2.674], [0.596, 2.843], [0.505, 3.1], [0.505, 3.48], [0.571, 3.751], [0.766, 3.955], [1.2, 3.955], [2.2, 3.955]];
const STAIR_UP = [...STAIR_DOWN].reverse();

export const TOURS = {
  // steg 5 (M1): over the terrace door's threshold onto the deck and back
  terrasse: {
    start: [5.6, 0, 5.9],
    route: [[6.5, 5.89], [7.5, 5.89], [8.6, 3.2], [7.5, 5.89], [6.0, 5.89]],
    rooms: ['stue-kjokken', '-', 'stue-kjokken'],
    names: ['Stue/kjøkken'],
  },
  // steg 5 / 8: through door-gang into the hall and back
  'gang-terskel': {
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.95], [3.6, 3.95], [4.4, 4.0]],
    rooms: ['stue-kjokken', 'gang', 'stue-kjokken'],
    names: ['Stue/kjøkken', 'Gang', 'Stue/kjøkken'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje'],
  },
  // steg 8: stua → the hall → the bathroom
  'stua-bad': {
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.9], [2.05, 2.9], [1.98, 2.27], [1.5, 1.3]],
    rooms: ['stue-kjokken', 'gang', 'bad'],
    names: ['Stue/kjøkken', 'Gang', 'Bad'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje'],
  },
  // steg 8: stua → the hall → the bedroom
  'stua-soverom': {
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.95], [2.58, 4.48], [2.3, 5.4], [1.5, 5.7]],
    rooms: ['stue-kjokken', 'gang', 'soverom'],
    names: ['Stue/kjøkken', 'Gang', 'Soverom'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje'],
  },
  // steg 22: stua → the hall → the stair → the basement hall
  trapp: {
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.4], ...STAIR_DOWN, [3.5, 3.8]],
    rooms: ['stue-kjokken', 'gang', 'trapp', 'kjeller-gang'],
    names: ['Stue/kjøkken', 'Gang', 'Trappa', 'Gang'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje', 'Kjeller'],
  },
  // steg 22: the basement hall → up the stair → the hall → stua
  'trapp-opp': {
    start: [3.5, -2.55, 3.8],
    route: [...STAIR_UP, [2.6, 3.4], [3.6, 3.95], [4.4, 4.0]],
    rooms: ['kjeller-gang', 'trapp', 'gang', 'stue-kjokken'],
    names: ['Gang', 'Trappa', 'Gang', 'Stue/kjøkken'],
    eyebrows: ['Kjeller', 'Kjeller', '1. etasje', '1. etasje'],
  },
  // steg 24 / 26: round the basement – the living room, its bedroom, the laundry, the entrance (every door open)
  'kjeller-runde': {
    start: [3.5, -2.55, 3.8],
    route: [
      [3.65, 4.7], [3.65, 5.9], [4.6, 7.2], [4.0, 10.45], [2.2, 10.45], [1.4, 10.1], // kjellerstue → soverom
      [2.2, 10.45], [4.0, 10.45], [4.4, 7.0], [3.65, 5.9], [3.65, 4.7], // back to the hall
      [2.27, 4.1], [2.27, 5.0], [1.5, 6.2], // vaskerommet (door-vaskerom x 1.84–2.71, clear 1.91–2.64)
      [2.27, 5.0], [2.27, 4.1], [5.0, 3.9], [7.4, 4.4], // the entrance
    ],
    rooms: ['kjeller-gang', 'kjellerstue', 'soverom-kjeller', 'kjellerstue', 'kjeller-gang', 'vaskerom', 'kjeller-gang', 'entre-kjeller'],
    names: ['Gang', 'Kjellerstue', 'Soverom', 'Kjellerstue', 'Gang', 'Vaskerom', 'Gang', 'Entré'],
    eyebrows: ['Kjeller', 'Kjeller', 'Kjeller', 'Kjeller', 'Kjeller', 'Kjeller', 'Kjeller', 'Kjeller'],
  },
  // steg 26 (U2, the owner's «Start ute»): an empty saved position starts outside on the forecourt → open the front
  // door → the entrance → up the two steps → the basement hall → up the stair → open door-gang → stua; then the
  // remembered position brings the next visit back to stua
  'ute-inn': {
    spawn: 'saved',
    expectStart: { from: 'outside', ...SPAWN_OUTSIDE, room: null },
    doors: null,
    route: [
      [10.45, 4.4],
      { open: 'door-ute' },
      [9.3, 4.31], [8.2, 4.31], [6.9, 3.9], [5.3, 3.9], [3.2, 3.95],
      // up the stair, and stop at the top 1.5 m from door-gang's hinge (3.12, 3.36): the leaf (0.93) sweeps the hall
      // in front of it, and a player running up overshoots the stop by ~0.25 m
      ...STAIR_UP.slice(0, -1), [1.75, 2.71],
      { open: 'door-gang' },
      [2.5, 3.9], [3.6, 3.95], [4.4, 4.0],
    ],
    rooms: ['-', 'entre-kjeller', 'kjeller-gang', 'trapp', 'gang', 'stue-kjokken'],
    names: ['Forplassen', 'Entré', 'Gang', 'Trappa', 'Gang', 'Stue/kjøkken'],
    eyebrows: ['Ute', 'Kjeller', 'Kjeller', 'Kjeller', '1. etasje', '1. etasje'],
    resume: { room: 'stue-kjokken', name: 'Stue/kjøkken' },
  },
  // the way back: stua → the stair → the basement hall → down the steps → open the front door from inside → out
  'stua-ute': {
    start: [4.4, 0, 4.0],
    doors: null,
    route: [
      [3.9, 3.95],
      { open: 'door-gang' },
      [3.6, 3.95], [2.6, 3.4], ...STAIR_DOWN,
      [3.2, 3.95], [5.3, 3.9], [6.9, 3.9], [7.9, 4.31],
      { open: 'door-ute' },
      [9.3, 4.31], [10.6, 4.4], [12.2, 4.6],
    ],
    rooms: ['stue-kjokken', 'gang', 'trapp', 'kjeller-gang', 'entre-kjeller', '-'],
    names: ['Stue/kjøkken', 'Gang', 'Trappa', 'Gang', 'Entré', 'Forplassen'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje', 'Kjeller', 'Kjeller', 'Ute'],
  },
};

/** The tours `--tour=all` runs (every tour). */
export const ALL = Object.keys(TOURS);
