/**
 * Planbygger AI layer: the prompts and the JSON schemas of the three tasks (notes/planbygger-runde1-design.md, «KI-laget»).
 *
 *   PROMPT_VERSION                          part of the cache key and of every recorded fixture: bump it on ANY change
 *   TASKS = { classify, readPlan, readFacade }   { schema, instructions, maxItems }
 *   SYSTEM                                  the system prompt (shared by the tasks)
 *   buildUserText(task, { marks, hints, width, height }) → the text block that follows the image
 *   ROOM_KINDS_AI, OPENING_KINDS, ROOF_KINDS, STAIR_TYPES, FURNITURE_KINDS
 *
 * Principle: the model reads text and interprets symbols, the classical detection measures. So the answers carry
 * names, areas as written, kinds and rough positions (normalised 0–1, the model sees a scaled-down image) – never
 * geometry the client should trust. The schemas stay inside the structured-output limits (at most 16 nullable
 * fields per schema; every object closed with additionalProperties: false; every field required).
 */

/** Bump on any change to SYSTEM, the instructions or the schemas (the disk cache and the fixtures key on it). */
export const PROMPT_VERSION = 'pb-ai-4';

export const ROOM_KINDS_AI = Object.freeze([
  'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'wc', 'hall', 'entrance', 'laundry', 'storage', 'wardrobe',
  'office', 'technical', 'garage', 'carport', 'terrace', 'balcony', 'other',
]);
export const OPENING_KINDS = Object.freeze(['door', 'double-door', 'sliding-door', 'window', 'opening', 'none']);
export const STAIR_TYPES = Object.freeze(['straight', 'quarter-turn', 'half-turn', 'spiral', 'unknown', 'none']);
export const ROOF_KINDS = Object.freeze(['gable', 'gable-dormer', 'hip', 'mono-pitch', 'flat', 'mixed']);
export const DRAWING_KINDS = Object.freeze(['plan', 'facade', 'section', 'site', 'text', 'other']);
export const FURNITURE_KINDS = Object.freeze([
  'bed', 'sofa', 'table', 'kitchen', 'stove', 'fridge', 'toilet', 'shower', 'bathtub', 'washbasin', 'washer',
  'wardrobe', 'fireplace', 'car', 'other',
]);

// ---------------------------------------------------------------------------------------------------------------
// Schema helpers

const str = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description) => ({ type: 'number', ...(description ? { description } : {}) });
const int = (description) => ({ type: 'integer', ...(description ? { description } : {}) });
const bool = (description) => ({ type: 'boolean', ...(description ? { description } : {}) });
const oneOf = (values, description) => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const list = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
/** A closed object with every property required. */
const obj = (properties, description) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {}),
});
const point = (description = '[x, y] normalised 0–1 from the top-left corner of the image') => list(num(), description);
const box = (description = '[x0, y0, x1, y1] normalised 0–1 from the top-left corner of the image') => list(num(), description);

// ---------------------------------------------------------------------------------------------------------------
// The system prompt

export const SYSTEM = `You read architectural drawings of homes: floor plans, facades and sections, most of them Norwegian (house supplier catalogues, estate-agent plans, architect drawings for building permits, hobby drawings, phone photos of printouts). You answer only with JSON in the schema you are given.

Rules:
- Report what is drawn or written. Never invent rooms, numbers or text. What you cannot read is null (or an empty list).
- Copy text exactly as written in the drawing, in the fields text, name, title, levelTitle, scaleText and ceiling: keep æ ø å, the abbreviations, the case and a decimal comma.
- Numeric fields (area, value) are numbers in metres and square metres with a decimal point: «5,7 m²» → 5.7, a dimension «14950» in millimetres → 14.95, «615» in centimetres → 6.15.
- Coordinates are normalised to the image you see: x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge). A point is [x, y], a box [x0, y0, x1, y1]. Three decimals.
- The software may have drawn coloured marks on the image. Red discs with a number mark rooms. Blue discs with letters mark openings in the walls, with a thin blue line from the disc to the opening. Green discs s1, s2 … mark symbols. The marks are not part of the drawing: never read them as text, and never report a disc as a window, a door or furniture.
- Free-text fields (notes) are short and in Norwegian bokmål.`;

// ---------------------------------------------------------------------------------------------------------------
// classify – the whole uploaded sheet

const classify = {
  schema: obj({
    drawings: list(
      obj({
        kind: oneOf(DRAWING_KINDS),
        bbox: box('the drawing with its own dimension lines and title, [x0, y0, x1, y1] normalised'),
        title: nullable(str('the title written for this drawing, exactly as written')),
        levelName: nullable(str('plans only: the floor in standard form – «Kjeller», «Underetasje», «1. etasje», «2. etasje», «Loft»')),
        level: nullable(int('plans only: −1 basement / underetasje, 0 the main floor (main entrance), 1 the floor above, 2 …')),
        detached: bool('true for a plan of a separate building on the same sheet (garage, annex, shed)'),
      }),
      'every separate drawing on the sheet, top to bottom, left to right',
    ),
    scaleText: nullable(str('the scale as written, e.g. «1:100»')),
    notes: str(),
  }),
  instructions: `Task: classify the drawings on this uploaded sheet. A sheet may hold one drawing or several: floor plans of several floors (or of a house and its garage), facades, sections, a site plan, a title block or legend.

For each separate drawing:
- kind: plan (one floor seen from above, with walls and rooms), facade (the building seen from the side: a ground line, walls, windows, a roof), section (a cut through the building: floor slabs as horizontal bands, often with level heights such as «+3,20»), site (situasjonsplan: the building on its plot), text (a title block, a legend, a disclaimer), other.
- bbox: the whole drawing including its dimension lines and its title.
- title: the drawing's own title («Etasje 1», «1. ETASJE», «PLAN KJELLER», «FASADE SØR», «Snitt A-A»), null if it has none. Room labels are not titles.
- levelName and level (plans only, null for everything else): from the title when there is one. Without a title, decide from the content: the floor with the main entrance (ENTRÉ, VINDFANG, an outside door with steps) and usually the kitchen is level 0; a floor with only storage, technical rooms, laundry and a stair, often with small windows, is a basement (−1); a floor reached by a stair from level 0 with bedrooms, sloping ceilings (SKRÅ HIMLING) or skylights is level 1 or a loft. When two plans are on the same sheet, the stair connects them: decide which is above. If the level cannot be decided, null.
- detached: true for a separate building (GARASJE, ANNEKS, BOD) drawn beside the house; level 0 for it, but it is not a floor of the house.

scaleText: the drawing scale if written («1:100», «M 1:50»), else null.
notes: anything that matters for using the sheet, e.g. «Plantegningen er ikke målbar» or that north is marked; empty string if nothing.`,
};

// ---------------------------------------------------------------------------------------------------------------
// readPlan – one floor plan, with the room and opening marks

const readPlan = {
  schema: obj({
    levelTitle: nullable(str('the title of this plan, exactly as written («Etasje 1», «1. ETASJE»)')),
    scaleText: nullable(str('the scale as written, e.g. «1:100»')),
    rooms: list(
      obj({
        mark: nullable(str('the number in the red disc')),
        at: point('where the room label is written (or the disc if the room has no label), [x, y] normalised'),
        name: str('the room name exactly as written, without the area; empty string if the room has none'),
        area: nullable(num('the area written in the room, m²')),
        kind: oneOf(ROOM_KINDS_AI),
      }),
      'exactly one entry per red room mark, in the order of the numbers',
    ),
    labels: list(
      obj({
        text: str('the room or area name exactly as written, without the area'),
        area: nullable(num('the area written with it, m²')),
        kind: oneOf(ROOM_KINDS_AI),
        at: point('[x, y] of the label text, normalised'),
      }),
      'every other room or area label: rooms without a mark, a second label in a marked region, outdoor areas',
    ),
    dimensions: list(
      obj({
        text: str('the number exactly as written'),
        value: nullable(num('the length in metres')),
        at: point('the middle of the dimension line, [x, y] normalised'),
        along: oneOf(['h', 'v'], 'h: a horizontal dimension line, v: a vertical one'),
        what: oneOf(['outer', 'chain', 'other'], 'outer: the whole building side; chain: one of a row of consecutive dimensions; other'),
      }),
    ),
    openings: list(
      obj({
        mark: nullable(str('the letters in the blue disc; null for an opening without a mark')),
        at: point('the middle of the opening in the wall, [x, y] normalised'),
        kind: oneOf(OPENING_KINDS),
      }),
      'one entry per blue opening mark, in letter order, then the doors and windows that have no mark',
    ),
    skylights: list(obj({ at: point() })),
    stair: obj({
      present: bool(),
      at: nullable(point('the middle of the stair, [x, y] normalised')),
      type: oneOf(STAIR_TYPES),
      up: oneOf(['here', 'elsewhere', 'unknown'], 'here: a flight goes up from this floor; elsewhere: this floor is the top of a stair from below; unknown'),
    }),
    ceiling: list(str(), 'texts about the ceiling, exactly as written'),
    furniture: list(obj({ kind: oneOf(FURNITURE_KINDS), at: point() }), 'at most 30 items, the clearly drawn ones'),
    notes: str(),
  }),
  instructions: `Task: read this floor plan.

Room labels in Norwegian plans (the name, usually with the area below it, «14.8 m²» or «5,7 m²»): STUE, TV-STUE, ALLROM, FAMILIEROM (living); KJØKKEN, KJ (kitchen); SPISESTUE, SPISE (dining); SOV, SOVEROM, SOVE (bedroom); BAD, DUSJ (bathroom); WC, TOALETT (wc); VASK, VASKEROM (laundry); BOD, LAGER, SPORTSBOD, SKAP (storage); GARD, GARDEROBE, WALK-IN (wardrobe); GANG, HALL, KORRIDOR, TRAPP, TRAPPEROM (hall); ENTRÉ, ENTRE, VINDFANG, VF (entrance); KONTOR, ARBEIDSROM (office); TEKN, TEKNISK ROM, FYRROM (technical); GARASJE (garage); CARPORT; TERRASSE, PLATTING, UTEPLASS (terrace); BALKONG, ALTAN, VERANDA (balcony). A combined label is one room: «HALL/TRAPP» is a hall, «KJØKKEN/STUE» is living. Letters on kitchen and laundry fittings are not rooms: HS (høyskap), F (fryser), K (kjøleskap), OM (oppvaskmaskin), O/M (ovn/mikro), VM (vaskemaskin), TT (tørketrommel), BVS (bereder), S.S (skyllekar). Without a label, decide the kind from the fittings (toilet and shower → bathroom, a bed → bedroom, a counter with sink and stove → kitchen) or use other.

rooms: one entry for every red room mark, in the order of the numbers. The mark sits inside one room, bounded by its walls: give the label written inside that room, even when the label is beside the mark rather than under it. Only a room with no label at all gets an empty name. The software's rooms are bounded by the walls it found, so a marked region may hold more than one room label (a wall it missed): give the label nearest to the mark in rooms, and the others in labels. If no room marks are drawn, rooms is empty and every room label goes in labels.

labels: every room or area label that is not in rooms – unmarked rooms, extra labels in a marked region, outdoor areas (TERRASSE, CARPORT).

openings: one entry for every blue opening mark, in letter order. The letter belongs to the opening at the end of its blue line: look at that whole gap in the wall and at both sides of it – the arc of a door is often drawn outside the house, or on the far side of the wall from the disc. kind:
- door: one door leaf, drawn as a line from a hinge with a quarter-circle arc for the swing. A gap that holds a door leaf with an arc and also a fixed glass panel or a sidelight is a door. A door into a cupboard, a shaft or the space under a stair is a door too;
- double-door: two leaves with two arcs that meet in the middle of one opening (two marks may sit on the two halves of one double door: give both double-door);
- sliding-door: no arc; the leaf is a thin line or a thin rectangle along the wall or inside it beside the opening, often with an arrow along the wall;
- window: thin parallel lines (two or three) across the opening, in the line of the wall, and no door leaf; mostly in exterior walls;
- opening: a gap with nothing drawn in it (a passage, an open doorway);
- none: the mark is not on an opening (a wall, a cupboard, a piece of furniture).
Then check the whole plan for doors and windows that have NO blue mark – the software misses some, for example a door whose wall it did not find – and add one entry with mark null for each of them.

dimensions: every dimension number with its dimension line (ticks or arrows at both ends). outer: a dimension of a whole outer side of the building; chain: one of several consecutive dimensions along a side; other: anything else. A short number at a corner with no visible line, like «6.15» above the plan and «14.95» rotated beside it, is the outer width and length: give it as outer.

skylights: dashed or thin rectangles inside a room, often with a cross or «TAKVINDU».
stair: parallel thin lines (the treads) in a narrow band, often with an arrow or a walking line. Dashed treads are the part of the stair above the cut of the drawing: they belong to the same stair. Judge the shape of the whole stair, dashed part included, by its runs of parallel treads: straight: one run, all treads parallel; quarter-turn: two runs at a right angle (an L), joined by a landing or by winders (treads fanning out from one corner); half-turn: two runs side by side, parallel, joined at one end (a U), by a landing or by winders; spiral: treads fanning around a centre all the way. up: here when a flight goes up from this floor (an arrow or «OPP» starting on this floor, the full stair drawn), elsewhere when this floor is the top of a stair from below (a stair opening with a railing, «NED»), else unknown.
ceiling: every text about the ceiling or the room height, exactly as written: «SKRÅ HIMLING 24°», «Skråhiml.», «Plan himling», «Himlingshøyde 2,4 m», «ÅPENT OPP», «Åpent til mønet».
furniture: the clearly drawn furniture and fittings, at most 30.
levelTitle: the plan's own title as written on the image (a heading above or below the plan), null if none is written – never a title made up from the file name or the content. scaleText: the scale if written.
notes: what else matters for building the house in 3D, e.g. a level difference, a mezzanine, «ikke målbar»; empty string if nothing.`,
};

// ---------------------------------------------------------------------------------------------------------------
// readFacade – one elevation

const readFacade = {
  schema: obj({
    title: nullable(str('the facade title, exactly as written («FASADE SØR»)')),
    roof: oneOf(ROOF_KINDS),
    storeys: int('storeys above the ground line in the main volume, counting a loft only when it has windows in this facade'),
    windows: list(
      obj({
        bbox: box('the frame of the window or door, [x0, y0, x1, y1] normalised'),
        kind: oneOf(['window', 'door']),
      }),
      'every window and door in the facade',
    ),
    notes: str(),
  }),
  instructions: `Task: read this facade (elevation) drawing.

roof: gable (saltak: two slopes meeting at a ridge), gable-dormer (saltak with one or more dormers – ark, kvist – breaking the eave), hip (valmtak: slopes on all four sides), mono-pitch (pulttak: one slope, the ridge on one side), flat (flatt tak, often with a parapet or a railing on a roof terrace), mixed (clearly different roof forms on different parts).
How a roof looks in an elevation: a sloping roof seen from its eave side shows the roof surface as a wide band (often dark, with roofing) above the eave, with a straight horizontal top edge – that is a gable roof seen from the long side (if the ends slope in as well, hip) or a mono-pitch roof seen from its low or high side. A gable end shows a triangle; a mono-pitch end shows a single sloping top edge. A flat roof shows only a thin fascia or parapet line, no roof surface. A low part with a railing on top (a roof terrace) has a flat roof, but name the roof of the main volume. A wide roof band with a horizontal top edge fits both a gable seen from the long side and a mono-pitch: if the top edge has a trim like the eave's (an edge, not a ridge) choose mono-pitch, if it has a ridge cap choose gable, and say in notes that the facade alone does not settle it.
storeys: the storeys of the main volume above the ground line. A loft counts only when it has windows in this facade; a basement counts when it has windows or doors above the ground.
windows: every window and door: bbox around the frame. door: reaches down to a floor level (front door, balcony door, garage door, a door to a storage room); window: everything else. A glass railing or a glass wall without frames is not a window.
title: the facade's title, null if none.
notes: e.g. a roof terrace, a carport, a balcony, cladding; empty string if nothing.`,
};

// ---------------------------------------------------------------------------------------------------------------
// readHouse – all the plans (with their room marks) and all the facades of one house, in one request: what no single
// drawing settles (the roof of each wing, which facade is which side, the ceilings with their ridge lines) and what
// classical detection cannot read (cladding, covering, terrain). Positions and sizes still come from the drawings.

export const CLADDING_TYPES = Object.freeze(['wood', 'panels', 'render', 'brick', 'stone', 'unknown']);
export const DECK_KINDS = Object.freeze(['terrace', 'balcony', 'porch', 'roof-terrace']);
export const RAILINGS = Object.freeze(['glass', 'wood-slats', 'wood-vertical', 'steel-bars', 'none', 'unknown']);

const readHouse = {
  /** its own version (the cache and the recordings key on it), so the other tasks' recordings stay fresh */
  version: 'pb-house-2',
  schema: obj({
    facades: list(
      obj({
        image: int('the number of the image that shows this facade'),
        title: nullable(str('the title written on this facade, exactly as written')),
        facing: oneOf(['N', 'E', 'S', 'W', 'NE', 'NW', 'SE', 'SW', 'unknown'], 'the compass direction the facade faces, from its title or a north arrow only; unknown otherwise'),
        planSide: oneOf(['top', 'bottom', 'left', 'right', 'unknown'], 'the outer wall of the first plan image this facade shows, named by the EDGE of the plan image it runs along: left = the wall along the left edge of the plan image'),
        cladding: list(
          obj({
            part: oneOf(['all', 'lower', 'upper', 'gable', 'basement', 'other'], 'where on this facade: all of it, a lower or upper band, the gable triangle, the basement wall, or another part'),
            type: oneOf(CLADDING_TYPES),
            direction: oneOf(['vertical', 'horizontal', 'none'], 'the boards or the joints: vertical (stående), horizontal (liggende); none for render, brick, stone'),
            color: nullable(str('the colour as written («hvit», «NCS S 7502-B»), or as drawn when the drawing is in colour; null in a black-and-white drawing without a colour text')),
          }),
          'one entry per kind of cladding on this facade',
        ),
        terrain: oneOf(['flat', 'falls-left', 'falls-right', 'stepped', 'unknown'], 'the ground line along the facade: flat, lower to the left, lower to the right, stepped'),
        basement: oneOf(['none', 'partly', 'full', 'unknown'], 'how much of a basement storey stands above the ground on this facade'),
      }),
      'one entry per facade image, in image order',
    ),
    roof: obj({
      covering: oneOf(['tiles', 'slate', 'felt', 'metal', 'unknown'], 'takstein / skifer / papp or a flat roof membrane / stålplater'),
      color: nullable(str('the roof colour as written, or as drawn when the drawing is in colour; null otherwise')),
      pitch: nullable(num('the roof pitch in degrees, only when it is written on a drawing («30°», «takvinkel 27»); null otherwise')),
      wings: list(
        obj({
          image: int('the plan image this part of the roof covers (the top floor under it)'),
          rooms: list(str(), 'the numbers of the red room marks under this part of the roof'),
          type: oneOf(['gable', 'hip', 'mono-pitch', 'flat']),
          ridge: oneOf(['horizontal', 'vertical', 'none'], 'the direction of the ridge in that plan image (horizontal: left–right); for a mono-pitch roof the direction of its high edge; none for a flat roof'),
          high: oneOf(['top', 'bottom', 'left', 'right', 'none'], 'mono-pitch only: the side of the plan image where the roof is highest; none for every other type'),
        }),
        'one entry per part of the house with a roof of its own (a wing, a lower annex); one entry when one roof covers it all',
      ),
      chimney: bool('a chimney shows on a facade'),
    }),
    ceilings: list(
      obj({
        image: int('the plan image the text is written on'),
        text: str('the text exactly as written'),
        kind: oneOf(['sloped', 'flat', 'open', 'height'], 'sloped: SKRÅ HIMLING, Skråhiml.; flat: PLAN HIMLING, PLANTAK, flatt tak; open: ÅPENT OPP, åpent til mønet; height: only a room height («Himlingshøyde 2,4 m»)'),
        degrees: nullable(num('the angle written in the text, degrees')),
        rooms: list(str(), 'the numbers of the red room marks this ceiling covers'),
        ridge: nullable(box('the ridge line drawn with a sloped ceiling: a long dash-dot (or dashed) line through the room along its length, often with the text written on it, [x0, y0, x1, y1] as its two end points, normalised in that plan image; null when no such line is drawn')),
      }),
      'every text about the ceiling on the plans',
    ),
    decks: list(
      obj({
        kind: oneOf(DECK_KINDS),
        image: nullable(int('the plan image it is drawn on, or null when only a facade shows it')),
        at: nullable(point('its middle in that plan image, [x, y] normalised')),
        railing: oneOf(RAILINGS),
        stairs: bool('steps from it down to the ground'),
      }),
      'terraces, balconies, porches and roof terraces',
    ),
    notes: str(),
  }),
  instructions: `Task: read all the drawings of ONE house together – its floor plans and its facades (elevations). The images are numbered in the order they are given; the text before each image says what it is. The plans carry the software's red room marks (numbered discs; blue lettered discs mark openings and do not matter here).

facades – one entry per facade image:
- title as written; facing only from the title («FASADE SØR», «Fasade mot nord», «ØST») or a north arrow, else unknown.
- planSide: which outer wall of the FIRST plan image the facade shows, named by the edge of the plan IMAGE that wall runs along: top, bottom, left or right. Match the windows and doors, their widths and spacing, the entrance door and the gable ends (a gable end shows a triangle, the long side a band of roof) against the plan's outer walls. A facade is drawn as seen by someone standing outside that wall and looking at it: for the wall along the bottom edge the facade's left end is the plan's left end; for the wall along the top edge the facade's left end is the plan's RIGHT end; for the wall along the right edge the facade's left end is the plan's bottom end; for the wall along the left edge the facade's left end is the plan's top end.
- cladding: the cladding of each part of the facade. Thin parallel vertical lines are vertical boards (stående kledning); horizontal lines are horizontal boards (liggende kledning); a grid of large rectangles is panels (fasadeplater); a plain or dotted surface is render (puss); a brick pattern is brick; irregular stones are stone. Parts: all, lower / upper (a band, e.g. render below and boards above), gable (the triangle), basement (the wall below the main floor), other. color only when written or the drawing is in colour.
- terrain: the ground line; basement: how much of a basement storey stands free.

roof:
- covering from the hatching or the text: tiles (takstein: rows of small arcs or a scale pattern), slate (skifer: small rectangles), felt (papp, or a flat roof), metal (stålplater: long vertical lines on the roof surface); unknown.
- pitch only when written (on a facade, a section or the plan: «SKRÅ HIMLING 24°» gives 24).
- wings: look at all the facades together to understand the roof: a gable end is a triangle, a hip end slopes back, a mono-pitch roof shows one slope from a low to a high edge on its ends and a band of roof with a straight top on its long sides, a flat roof only a thin edge. Different heights or different roof forms on parts of the house are separate wings: give each the room marks under it on the top floor's plan, its type, its ridge direction in that plan image and, for a mono-pitch roof, the side of the plan where it is high. A garage, carport or annex with its own lower roof is a wing too.

ceilings – every text about the ceiling on the plans («SKRÅ HIMLING 24°», «Skråhiml.», «PLAN HIMLING», «PLANTAK», «ÅPENT OPP»):
- rooms: the room the text stands in, plus the rooms open to it (no wall between) that the same ceiling covers. A text written along a long thin diagonal line across several rooms applies to all the rooms that line crosses. A flat ceiling text («PLANTAK») inside a sloped area applies to the closed rooms or the core it is written on (a WC, a storage core, tall cupboards).
- ridge: for a sloped ceiling, the dash-dot line that marks the ridge, usually along the middle of the room and through its whole length, often with the text written on it. The diagonal dashed line that only says «this room has a sloped ceiling» is not a ridge: then null.

decks: terraces, balconies, porches (an outdoor area under a roof at an entrance), roof terraces, with the railing type (glass, wood-slats: horizontal boards, wood-vertical: vertical boards or balusters, steel-bars) and whether steps go down from it.

notes: what else matters for building the outside in 3D (a carport, columns, a pergola, a garage door); empty string if nothing.`,
};

export const TASKS = Object.freeze({ classify, readPlan, readFacade, readHouse });
/** The prompt version of a task (readHouse has its own). */
export const promptVersionOf = (task) => TASKS[task]?.version ?? PROMPT_VERSION;

// ---------------------------------------------------------------------------------------------------------------
// The text block after the image

const HINT_KEYS = { fileName: 'File name', levelName: 'Floor (from the user or the file order)', sheet: 'Sheet', note: 'Note' };
const clip = (s, n = 200) => String(s).replace(/[\u0000-\u001f]+/g, ' ').slice(0, n);
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

/** What one image of a readHouse request is, for the text before it: «plan, 1. etasje (1etg.png), 1200 × 900 px». */
export function imageLabel(im = {}) {
  const kind = im.kind === 'plan' ? 'floor plan' : im.kind === 'facade' ? 'facade' : 'drawing';
  const bits = [clip(im.label ?? '', 120), im.width && im.height ? `${im.width} × ${im.height} px` : ''].filter(Boolean);
  return `${kind}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/**
 * The user text for a task: the instructions, the marks the software drew, and the hints.
 * @param {'classify'|'readPlan'|'readFacade'} task
 * @param {{ marks?: Array<{ id, kind, at, drawnAt? }>, hints?: object, width?: number, height?: number }} o
 */
export function buildUserText(task, { marks = [], hints = {}, width, height, images = null } = {}) {
  const def = TASKS[task];
  if (!def) throw new Error(`unknown task ${task}`);
  const parts = [def.instructions];
  if (task === 'readHouse' && Array.isArray(images)) {
    parts.push(`The images: ${images.map((im, i) => `${i + 1}: ${imageLabel(im)}`).join('; ')}.`);
    images.forEach((im, i) => {
      const rooms = marks.filter((m) => m.kind === 'room' && m.image === i + 1);
      if (rooms.length) parts.push(`Red room marks on image ${i + 1}, disc centres: ${rooms.map((m) => `${m.id} [${f3((m.drawnAt ?? m.at)[0])}, ${f3((m.drawnAt ?? m.at)[1])}]`).join('; ')}.`);
    });
  } else if (width && height) parts.push(`The image is ${width} × ${height} pixels.`);
  if (task === 'readPlan') {
    const rooms = marks.filter((m) => m.kind === 'room');
    const openings = marks.filter((m) => m.kind === 'opening');
    const symbols = marks.filter((m) => m.kind === 'symbol');
    const where = (m) => `${m.id} [${f3((m.drawnAt ?? m.at)[0])}, ${f3((m.drawnAt ?? m.at)[1])}]`;
    if (rooms.length) parts.push(`Red room marks (${rooms.length}), disc centres: ${rooms.map(where).join('; ')}.`);
    else parts.push('No room marks are drawn on this image.');
    if (openings.length) parts.push(`Blue opening marks (${openings.length}), disc centres: ${openings.map(where).join('; ')}.`);
    else parts.push('No opening marks are drawn on this image.');
    if (symbols.length) parts.push(`Green symbol marks (${symbols.length}): ${symbols.map(where).join('; ')}.`);
  }
  const hintLines = Object.entries(HINT_KEYS)
    .filter(([k]) => hints[k] != null && hints[k] !== '')
    .map(([k, label]) => `${label}: ${clip(hints[k])}`);
  if (hintLines.length) parts.push(`Context (may help, may be wrong):\n${hintLines.join('\n')}`);
  return parts.join('\n\n');
}
