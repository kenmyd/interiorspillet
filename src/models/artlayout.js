/**
 * Art geometry and art data shared by the builder (models/decor.js buildArt / buildArtSet) and the UI (ui/ImageUpload.js,
 * the inspector, the shopping list, design/imageArt.js): how the outer size of a picture splits into frame, passepartout
 * (mat), shadow gap and the visible picture, plus the frame profiles, frame presets, print sizes and gallery-wall
 * layouts (design/upload.md §4, design/art.md §3.2, §3.3, §4.2, §4.5, §5.2). Pure (no three.js, no DOM) – Node-testable.
 * Created by the foundation (F0); package P04 (ART-CORE) owns it. The exported names are frozen.
 *
 * Outer dims (item.dims w × h) = opening + 2 × (frame + mat + gap):
 *   frame  params.frame – a FRAME_PROFILES key ('none' = a stretched canvas); width params.frameW, else FRAME_W
 *   mat    params.mat – only a paper/photo print in a frame; width params.matW, else 9 % of the short outer side;
 *          params.matH (optional, same range) is the width over and under the opening (a 50 × 70 frame with a 40 × 50
 *          window: wider top and bottom) – without it all four sides are matW
 *   gap    a canvas floating in a frame (not a paper print) keeps FLOAT_GAP to the frame
 *   (the 'box' profile adds its front lip to the frame; the 'hanger' profile has no border: the poster is the item)
 * An uploaded picture (params.motif 'custom', params.imageAspect, params.fit):
 *   fit 'cover'    (default) the picture fills the opening and is cropped to it, centred (params.focus moves it)
 *   fit 'contain'  the whole picture: with a mat the mat's window is cut to the picture (wider on two sides);
 *                  without one the picture is drawn whole on PAPER_WHITE inside the opening (draw: 'contain')
 *
 * Builder numbers (artLayout's extra fields; the legacy profiles none/black/oak/white/floater give exactly the numbers
 * of the round-1 buildArt, proven by tools/house-tests/art.test.mjs against a copy of its formulas):
 *   stretched canvas (!paperPrint)  canvas body pw × ph × cd at z0 … z0 + cd; print plane (picW − 1 mm) at z0 + cd + 0.5 mm;
 *                                   framed: a black shadow-gap backing innerW × innerH × 4 mm at z 0
 *   paper print (paperPrint)        backing innerW × innerH × 4 mm at z 0; print plane (picW + 4 mm) at printZ; the mat
 *                                   (matW > 0) is innerW × innerH with a picW × picH hole, 2 mm thick at printZ + 0.4 mm
 *   frame                           4 bars fw wide, full depth; step 1 = the inner step of 'oak'/'white' (fw·.35 wide,
 *                                   depth·.8 deep); 'box' adds a front lip lipW = fw·.45 wide, 6 mm deep at depth − 6 mm
 *                                   inside the bars (the opening is inside the lip, so nothing visible is hidden)
 *   hanger                          no side bars: the poster plane is the full w × h at z HANGER_Z, battens over top and
 *                                   bottom (they cover fw of the poster, as a real hanger does); no mat, no backing
 */
export const FRAME_W = Object.freeze({
  black: 0.015, oak: 0.022, white: 0.03, floater: 0.012, thin: 0.010, box: 0.020, alu: 0.007, ornate: 0.055, hanger: 0.016,
});
export const FLOAT_GAP = 0.005;
export const PAPER_WHITE = '#f4f2ee';
export const ASPECT_RANGE = Object.freeze([0.2, 5]);

/** Upper bound of params.frameW (the Inspector's «Rammebredde» range; D39: the builder clamps its own params). */
export const FRAME_W_MAX = 0.08;
/** Range of an explicit params.matW (the Inspector's «Passepartoutbredde»); the 9 % default is not clamped (legacy). */
export const MAT_W_RANGE = Object.freeze([0.015, 0.15]);
/** Thinnest picture (m): 3–5 mm posters (design/art.md §3.5; the round-1 builder clamped at 0.008). */
export const ART_DEPTH_MIN = 0.002;
/** 'box' profile: the front lip reaches lipW = fw · BOX_LIP inside the bars. */
export const BOX_LIP = 0.45;
/** 'hanger' profile: z of the poster plane between the battens (back strip at z 0, front strip at z 0.009). */
export const HANGER_Z = 0.006;
/** A paper print never sits behind the 4 mm backing board (only reachable with frames thinner than 18 mm). */
const PRINT_Z_MIN = 0.0045;

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);

/** Frame bar width of params (0 for 'none'), before the 20 % cap of artLayout. */
export function frameWidth(P = {}) {
  const style = P?.frame ?? 'black';
  return style === 'none' ? 0 : clamp(num(P?.frameW, own(FRAME_W, style) ? FRAME_W[style] : 0.02), 0, FRAME_W_MAX);
}

/** params.imageAspect clamped to ASPECT_RANGE, or null. */
export function imageAspectOf(P) {
  const a = num(P?.imageAspect, NaN);
  return a > 0 ? clamp(a, ASPECT_RANGE[0], ASPECT_RANGE[1]) : null;
}

/**
 * The parts of an art-frame of outer size `dims` (exactly the builder's numbers).
 * inner = inside the frame bars (and the box lip), open = inside mat and gap, pic = the visible picture (the mat's
 * window). The second group are the builder's numbers (see the header): depth = params.depth ?? dims.d (≥ ART_DEPTH_MIN).
 * @param {{ w: number, h: number, d?: number }} dims
 * @param {object} [P] params
 * @returns {{ fw: number, framed: boolean, texture: string, paperPrint: boolean, matW: number, matH: number, gap: number,
 *   innerW: number, innerH: number, openW: number, openH: number, picW: number, picH: number, draw: 'cover'|'contain',
 *   frame: string, kind: string|null, depth: number, lipW: number, step: 0|1, cd: number, z0: number,
 *   planeW: number, planeH: number, printZ: number, aspect: number }}
 */
export function artLayout(dims, P = {}) {
  P = P || {};
  const w = num(dims?.w, 0.8), h = num(dims?.h, 1);
  const frame = P.frame ?? 'black';
  const depth = Math.max(ART_DEPTH_MIN, num(P.depth, num(dims?.d, 0.04)));
  const fw = clamp(frameWidth(P), 0, Math.min(w, h) * 0.2);
  const framed = fw > 0.001;
  const hanger = framed && frame === 'hanger';
  const texture = P.texture || (P.mat || hanger ? 'paper' : 'canvas');
  const paperPrint = framed && (hanger || !!P.mat || texture === 'paper' || texture === 'photo');
  const matW = paperPrint && P.mat && !hanger ? matWidth(P, w, h) : 0;
  const matH = matW > 0 ? matHeight(P, matW) : 0;
  const gap = framed && !paperPrint ? FLOAT_GAP : 0;
  const lipW = framed && frame === 'box' ? fw * BOX_LIP : 0;
  const border = hanger ? 0 : fw + lipW;
  const innerW = w - 2 * border, innerH = h - 2 * border;
  const openW = Math.max(0.02, innerW - 2 * matW - 2 * gap), openH = Math.max(0.02, innerH - 2 * matH - 2 * gap);
  let picW = openW, picH = openH, draw = 'cover';
  const ia = P.motif === 'custom' ? imageAspectOf(P) : null;
  if (ia && P.fit === 'contain' && Math.abs(Math.log(ia / (openW / openH))) > 0.01) {
    if (matW > 0) {
      if (ia > openW / openH) picH = openW / ia;
      else picW = openH * ia;
    } else draw = 'contain';
  }
  // builder numbers (round-1 buildArt formulas for the legacy profiles)
  let cd = 0, z0 = 0, planeW, planeH, printZ;
  if (!paperPrint) {
    cd = framed ? Math.max(0.001, Math.min(depth * 0.8, depth - 0.004)) : depth;
    z0 = framed ? depth - cd - 0.001 : 0;
    planeW = picW - 0.001;
    planeH = picH - 0.001;
    printZ = z0 + cd + 0.0005;
  } else if (hanger) {
    planeW = w;
    planeH = h;
    printZ = HANGER_Z;
  } else {
    planeW = picW + 0.004;
    planeH = picH + 0.004;
    printZ = Math.max(PRINT_Z_MIN, frame === 'box' ? depth * 0.3 : Math.min(depth * 0.55, depth - 0.006));
  }
  const kind = framed ? (own(FRAME_PROFILES, frame) && FRAME_PROFILES[frame].kind) || 'black-metal' : null;
  const step = framed && (frame === 'oak' || frame === 'white') ? 1 : 0;
  return {
    fw, framed, texture, paperPrint, matW, matH, gap, innerW, innerH, openW, openH, picW, picH, draw,
    frame, kind, depth, lipW, step, cd, z0, planeW, planeH, printZ, aspect: picW / picH,
  };
}

/** Explicit params.matW clamped to MAT_W_RANGE, else 9 % of the short outer side (round 1). */
function matWidth(P, w, h) {
  const m = num(P.matW, NaN);
  return Number.isNaN(m) ? Math.min(w, h) * 0.09 : clamp(m, MAT_W_RANGE[0], MAT_W_RANGE[1]);
}

/** Mat width over and under the opening: explicit params.matH clamped to MAT_W_RANGE, else the side width matW. */
function matHeight(P, matW) {
  const m = num(P.matH, NaN);
  return Number.isNaN(m) ? matW : clamp(m, MAT_W_RANGE[0], MAT_W_RANGE[1]);
}

/**
 * Outer dims for a wanted opening – the inverse of artLayout (matW explicit, matH optional – the mat over and under,
 * else matW; the 20 % frame cap inverted).
 * @param {{ openW: number, openH: number, frame?: string, frameW?: number, mat?: boolean, matW?: number, matH?: number,
 *   texture?: string, depth?: number }} o
 * @returns {{ w: number, d: number, h: number }} metres, rounded to 0.1 mm
 */
export function outerDims({ openW, openH, frame = 'black', frameW, mat = false, matW = 0, matH, texture = 'photo', depth = 0.025 }) {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  const fw0 = frameWidth({ frame, frameW });
  const framed = fw0 > 0.001;
  if (framed && frame === 'hanger') return { w: r(openW), d: depth, h: r(openH) }; // the poster is the item
  const paperPrint = framed && (mat || texture === 'paper' || texture === 'photo');
  const m = paperPrint && mat ? clamp(num(matW, 0), MAT_W_RANGE[0], MAT_W_RANGE[1]) : 0;
  const mh = m > 0 ? matHeight({ matH }, m) : 0;
  const gap = framed && !paperPrint ? FLOAT_GAP : 0;
  const k = frame === 'box' ? 1 + BOX_LIP : 1; // border = k · fw (+ mat + gap)
  // artLayout caps fw at 20 % of the short outer side: fw ≤ 0.2 (x + 2k fw) ⇔ fw ≤ 0.2 x / (1 − 0.4 k) (= x / 3 for k = 1)
  const x = mh === m ? Math.min(openW, openH) + 2 * (m + gap) : Math.min(openW + 2 * (m + gap), openH + 2 * (mh + gap));
  const fw = Math.min(fw0, k === 1 ? x / 3 : (0.2 * x) / (1 - 0.4 * k));
  const b = k * fw + m + gap;
  return { w: r(openW + 2 * b), d: depth, h: r(openH + 2 * (mh === m ? b : k * fw + mh + gap)) };
}

/** Source rectangle of a (sw × sh) picture covering a (dw × dh) target; fx/fy = focus 0…1 (0.5 = centred). */
export function coverRect(sw, sh, dw, dh, fx = 0.5, fy = 0.5) {
  const s = Math.max(dw / sw, dh / sh);
  const w = dw / s, h = dh / s;
  return { sx: (sw - w) * clamp(fx, 0, 1), sy: (sh - h) * clamp(fy, 0, 1), sw: w, sh: h };
}

/** Destination rectangle of a (sw × sh) picture shown whole inside (dw × dh), centred. */
export function containRect(sw, sh, dw, dh) {
  const s = Math.min(dw / sw, dh / sh);
  const w = sw * s, h = sh * s;
  return { dx: (dw - w) / 2, dy: (dh - h) / 2, dw: w, dh: h };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * Frame profiles (params.frame; design/art.md §3.2). fw = the default frameW (= FRAME_W); kind = the frame material
 * used only when materials.frame is missing (never for Def items, whose default is black-metal); legacy = the exact
 * geometry of the round-1 builder, which must never change.
 *   none     stretched canvas body, no frame (legacy)
 *   thin     4 bars, no step (IKEA LOMVIKEN/RÖDALM, Milano)
 *   black    4 bars (legacy)
 *   oak      4 bars + inner step fw·.35 wide, depth·.8 deep (legacy)
 *   white    as oak (legacy)
 *   box      4 full-depth bars + a front lip of 4 bars fw·.45 wide, .006 deep at z = depth − .006; paper print recessed
 *            at printZ = depth·.3
 *   floater  canvas floating with a 5 mm black gap (legacy)
 *   alu      4 bars as K.roundedBox(…, min(.0015, fw/3), 1) for highlights
 *   ornate   3 merged rings, part frame: outer fw·.45 × depth; cove inset fw·.45, fw·.35 × depth·.8; bead inset fw·.8,
 *            fw·.2 × depth·.9
 *   hanger   no side bars: two battens (top, bottom), each a front and back strip (w + .01) × fw × .006 at z .000/.009;
 *            the poster plane is the full w × h at z .006; a cord (cord !== false) to (0, h/2 + .12); paper print
 *            forced, no mat or backing
 * ------------------------------------------------------------------------------------------------------------------- */
export const FRAME_PROFILES = Object.freeze({
  none: Object.freeze({ label: 'Uten ramme (lerret)', fw: 0, kind: null, legacy: true }),
  thin: Object.freeze({ label: 'Tynn ramme', fw: 0.010, kind: 'black-metal', legacy: false }),
  black: Object.freeze({ label: 'Smal ramme', fw: 0.015, kind: 'black-metal', legacy: true }),
  oak: Object.freeze({ label: 'Treramme', fw: 0.022, kind: 'oak', legacy: true }),
  white: Object.freeze({ label: 'Bred ramme', fw: 0.030, kind: 'painted', legacy: true }),
  box: Object.freeze({ label: 'Dyp boksramme', fw: 0.020, kind: 'painted', legacy: false }),
  floater: Object.freeze({ label: 'Skyggefugeramme', fw: 0.012, kind: 'black-metal', legacy: true }),
  alu: Object.freeze({ label: 'Aluminiumsprofil', fw: 0.007, kind: 'steel', legacy: false }),
  ornate: Object.freeze({ label: 'Klassisk (forgylt)', fw: 0.055, kind: 'brass', legacy: false }),
  hanger: Object.freeze({ label: 'Plakatheng', fw: 0.016, kind: 'oak', legacy: false }),
});

/** [key, label] for the Inspector «Ramme» enum. */
export const FRAME_OPTIONS = Object.freeze(
  ['none', 'thin', 'black', 'oak', 'white', 'box', 'floater', 'alu', 'ornate', 'hanger'].map((k) => [k, FRAME_PROFILES[k].label]),
);

/**
 * Frame finishes = a profile + materials.frame (kind) + colors.frame (hex), for the upload dialog and catalogue authors
 * (design/art.md §3.3; the builder does not read it). Bohus Helsinki finishes for data: Natur → ash #d6c4a3, Svart →
 * black-oak #2b2623, Mørk brun → smoked-oak #5a4232.
 */
export const FRAME_PRESETS = [
  { key: 'none',          label: 'Uten ramme (lerret)', frame: 'none' },
  { key: 'thin-black',    label: 'Tynn sort',           frame: 'thin',    kind: 'black-metal', hex: '#151515' },
  { key: 'thin-white',    label: 'Tynn hvit',           frame: 'thin',    kind: 'painted',     hex: '#f1efea' },
  { key: 'thin-oak',      label: 'Tynn eik',            frame: 'thin',    kind: 'oak',         hex: '#c39b6e' },
  { key: 'thin-walnut',   label: 'Tynn valnøtt',        frame: 'thin',    kind: 'walnut',      hex: '#5f4332' },
  { key: 'thin-gold',     label: 'Tynn gull',           frame: 'thin',    kind: 'brass',       hex: '#c8a463' },
  { key: 'alu',           label: 'Aluminium',           frame: 'alu',     kind: 'steel',       hex: '#b9bcbf' },
  { key: 'oak',           label: 'Eik med kant',        frame: 'oak',     kind: 'oak',         hex: '#c39b6e' },
  { key: 'walnut',        label: 'Valnøtt med kant',    frame: 'oak',     kind: 'walnut',      hex: '#5f4332' },
  { key: 'white-wide',    label: 'Bred hvit',           frame: 'white',   kind: 'painted',     hex: '#f1efea' },
  { key: 'box-white',     label: 'Dyp hvit boks',       frame: 'box',     kind: 'painted',     hex: '#f1efea' },
  { key: 'floater-black', label: 'Skyggefuge sort',     frame: 'floater', kind: 'black-metal', hex: '#151515' },
  { key: 'floater-oak',   label: 'Skyggefuge eik',      frame: 'floater', kind: 'oak',         hex: '#c39b6e' },
  { key: 'gold-ornate',   label: 'Gull (klassisk)',     frame: 'ornate',  kind: 'brass',       hex: '#b8924f' },
  { key: 'hanger-oak',    label: 'Plakatheng eik',      frame: 'hanger',  kind: 'oak',         hex: '#c39b6e' },
];

/**
 * Print size presets of the upload dialog (design/art.md §4.5): metres, portrait (w ≤ h); the UI rotates them for
 * landscape pictures. { key, label, w, h }
 */
export const PRINT_SIZES = Object.freeze([
  { key: 'a5', label: 'A5 (14,8 × 21 cm)', w: 0.148, h: 0.21 },
  { key: '21x30', label: '21 × 30 cm', w: 0.21, h: 0.30 },
  { key: 'a4', label: 'A4 (21 × 29,7 cm)', w: 0.21, h: 0.297 },
  { key: '30x40', label: '30 × 40 cm', w: 0.30, h: 0.40 },
  { key: 'a3', label: 'A3 (29,7 × 42 cm)', w: 0.297, h: 0.42 },
  { key: '40x50', label: '40 × 50 cm', w: 0.40, h: 0.50 },
  { key: '50x70', label: '50 × 70 cm', w: 0.50, h: 0.70 },
  { key: '70x100', label: '70 × 100 cm', w: 0.70, h: 1.00 },
  { key: '30x30', label: '30 × 30 cm', w: 0.30, h: 0.30 },
  { key: '50x50', label: '50 × 50 cm', w: 0.50, h: 0.50 },
  { key: '70x70', label: '70 × 70 cm', w: 0.70, h: 0.70 },
  { key: '100x100', label: '100 × 100 cm', w: 1.00, h: 1.00 },
  { key: '30x90', label: '30 × 90 cm (panorama)', w: 0.30, h: 0.90 },
  { key: '60x90', label: '60 × 90 cm', w: 0.60, h: 0.90 },
  { key: '80x120', label: '80 × 120 cm', w: 0.80, h: 1.20 },
  { key: '100x150', label: '100 × 150 cm', w: 1.00, h: 1.50 },
].map((s) => Object.freeze(s)));

/* ---------------------------------------------------------------------------------------------------------------------
 * Gallery walls – the art-set archetype (design/art.md §4.2). LAYOUTS: frame outer sizes in cm (the packers convert
 * to metres; g = params.gap):
 *   cols        columns left to right; each column stacks its frames top-down (centred), centred vertically at y = 0
 *   rows        rows top-down, each packed horizontally and centred
 *   centerline  2 rows: the top row's frame bottoms at +g/2, the bottom row's frame tops at −g/2
 *   stair       x₀ = 0, x_{i+1} = x_i + (w_i + w_{i+1})/2 + g, y_i = rise · x_i, then centred
 *   ledge       x_{i+1} = x_i + (w_i + w_{i+1})/2 − overlap · min(w_i, w_{i+1}); the frames stand on a picture ledge
 *   span        one motif painted across all panels (triptych)
 * 'custom' (LAYOUT_OPTIONS only) = params.frames of the product; without frames it falls back to 'salon-5'.
 * ------------------------------------------------------------------------------------------------------------------- */
export const LAYOUTS = {
  'pair-h':   { cols: [[[50, 70]], [[50, 70]]] },
  'pair-v':   { rows: [[[40, 30]], [[40, 30]]] },
  triptych:   { cols: [[[45, 90]], [[45, 90]], [[45, 90]]], span: true },
  'row-3':    { cols: [[[30, 40]], [[30, 40]], [[30, 40]]] },
  'row-4':    { cols: [[[21, 30]], [[21, 30]], [[21, 30]], [[21, 30]]] },
  'grid-2x2': { cols: [[[40, 50], [40, 50]], [[40, 50], [40, 50]]] },
  'grid-2x3': { cols: [[[30, 40], [30, 40]], [[30, 40], [30, 40]], [[30, 40], [30, 40]]] },
  'grid-2x4': { cols: [[[30, 40], [30, 40]], [[30, 40], [30, 40]], [[30, 40], [30, 40]], [[30, 40], [30, 40]]] },
  'grid-3x3': { cols: [[[30, 30], [30, 30], [30, 30]], [[30, 30], [30, 30], [30, 30]], [[30, 30], [30, 30], [30, 30]]] },
  'salon-5':  { cols: [[[30, 40], [30, 30]], [[50, 70]], [[40, 30], [21, 30]]] },
  'salon-7':  { cols: [[[21, 30]], [[30, 40], [30, 30]], [[50, 70]], [[40, 30], [30, 40]], [[21, 30]]] },
  'salon-9':  { centerline: [[[30, 40], [40, 50], [21, 30], [50, 40], [30, 40]], [[30, 30], [40, 30], [30, 40], [21, 30]]] },
  stair:      { stair: [[30, 40], [40, 50], [30, 30], [40, 50], [30, 40]] },
  ledge:      { ledge: [[30, 40], [21, 30], [40, 50], [30, 30]] },
};

/** [key, label] for the Inspector «Oppsett» enum of art-set (all 15). */
export const LAYOUT_OPTIONS = [['custom','Som produktet'],['pair-h','To side om side'],['pair-v','To over hverandre'],
  ['triptych','Triptyk (ett motiv)'],['row-3','Tre på rad'],['row-4','Fire på rad'],['grid-2x2','Rutenett 2 × 2'],
  ['grid-2x3','Rutenett 2 × 3'],['grid-2x4','Rutenett 2 × 4'],['grid-3x3','Rutenett 3 × 3'],['salon-5','Salongvegg 5'],
  ['salon-7','Salongvegg 7'],['salon-9','Salongvegg 9'],['stair','Trappevegg'],['ledge','Bildehylle']];

/** Motifs of a set frame that names none: DEFAULT_SET_MOTIFS[(i + seed − 1) % 9] (design/art.md §4.3). */
export const DEFAULT_SET_MOTIFS = ['botanical-print','line-face','arches','bauhaus','fjord','geometric-lines','moon-phases','big-leaf','typography'];

/**
 * Ranges of the art-set params (D39: the builder clamps its own params). gap/rise/overlap: the galleryLayout options;
 * frames/side/xy/z/tilt: params.frames of layout 'custom' (at most 16 frames, sides 8 cm … 2 m, centre within ±4 m,
 * z = distance of the bottom edge from the wall, tilt in radians).
 */
export const SET_LIMITS = Object.freeze({
  gap: Object.freeze([0.02, 0.25]), rise: Object.freeze([0, 1.2]), overlap: Object.freeze([0, 0.4]),
  frames: 16, side: Object.freeze([0.08, 2.0]), xy: Object.freeze([-4, 4]), z: Object.freeze([0, 0.1]),
  tilt: Object.freeze([-0.35, 0.35]),
});

/**
 * The picture ledge of layout 'ledge' (m): board depth d, thickness t under the ledge top, a front lip `lip` high,
 * `overhang` past the outer frames on each side; leaning frames stand with their bottom edge at z = leanZ[i % 2] and
 * their top at z = top (tilt = asin((z − top) / h), so the top touches the wall exactly). This is the natural depth of
 * the layout; a set with dims.d < d is squeezed to it (fitSet kz).
 */
export const SET_LEDGE = Object.freeze({ d: 0.10, t: 0.02, lip: 0.015, overhang: 0.03, leanZ: Object.freeze([0.035, 0.06]), top: 0.005 });

/**
 * Natural frame positions of a gallery-wall layout (metres, set centre at the origin, y up).
 * A frame { x, y, w, h } is the unrotated outer rectangle; z = the bottom edge's distance from the wall (0 = flat on the
 * wall); tilt (rad) leans the top back to the wall: the builder rotates the piece about its bottom edge. Frames of layout
 * 'custom' also carry `data` = the params.frames entry (per-frame motif, seed, palette, motifOpts, frame, finish,
 * texture, mat, imageId).
 * @param {string} layout a LAYOUTS key or 'custom'; unknown keys (and 'custom' without frames) give 'salon-5'
 * @param {{ gap?: number, rise?: number, overlap?: number, mirror?: boolean, frames?: object[] }} [o]
 * @returns {{ frames: { x: number, y: number, w: number, h: number, z: number, tilt: number, data?: object }[],
 *   ledge: null | { x: number, y: number, w: number, d: number, t: number, lip: number }, span: boolean, layout: string }}
 */
export function galleryLayout(layout, { gap = 0.06, rise = 0.6, overlap = 0.2, mirror = false, frames = null } = {}) {
  const g = clamp(num(gap, 0.06), SET_LIMITS.gap[0], SET_LIMITS.gap[1]);
  let out = null;
  if (layout === 'custom') {
    const fr = customFrames(frames);
    if (fr.length) out = { frames: fr, ledge: null, span: false, layout: 'custom' };
  }
  if (!out) {
    const key = own(LAYOUTS, layout) ? layout : 'salon-5';
    const def = LAYOUTS[key];
    const m = (list) => list.map(([w, h]) => [w / 100, h / 100]); // cm → m
    let res;
    if (def.cols) res = { frames: packCols(def.cols.map(m), g), ledge: null };
    else if (def.rows) res = { frames: packRows(def.rows.map(m), g), ledge: null };
    else if (def.centerline) res = { frames: packCenterline(def.centerline.map(m), g), ledge: null };
    else if (def.stair) res = { frames: packStair(m(def.stair), g, clamp(num(rise, 0.6), SET_LIMITS.rise[0], SET_LIMITS.rise[1])), ledge: null };
    else res = packLedge(m(def.ledge), clamp(num(overlap, 0.2), SET_LIMITS.overlap[0], SET_LIMITS.overlap[1]));
    out = { ...res, span: !!def.span, layout: key };
  }
  if (mirror) {
    for (const f of out.frames) f.x = -f.x || 0;
    if (out.ledge) out.ledge.x = -out.ledge.x || 0;
  }
  const b = setBounds(out.frames, out.ledge);
  for (const f of out.frames) {
    f.x -= b.cx;
    f.y -= b.cy;
  }
  if (out.ledge) {
    out.ledge.x -= b.cx;
    out.ledge.y -= b.cy;
  }
  return out;
}

const flat = (x, y, w, h) => ({ x, y, w, h, z: 0, tilt: 0 });
const sum = (a) => a.reduce((s, v) => s + v, 0);

/** Columns left to right (gap g), frames stacked top-down and centred in their column, columns centred at y = 0. */
function packCols(cols, g) {
  const out = [];
  const widths = cols.map((col) => Math.max(...col.map(([w]) => w)));
  let x = -(sum(widths) + (cols.length - 1) * g) / 2;
  cols.forEach((col, i) => {
    let y = (sum(col.map(([, h]) => h)) + (col.length - 1) * g) / 2;
    for (const [w, h] of col) {
      out.push(flat(x + widths[i] / 2, y - h / 2, w, h));
      y -= h + g;
    }
    x += widths[i] + g;
  });
  return out;
}

/** Rows top-down (gap g), each packed left to right, centred, its frames centred on the row's middle line. */
function packRows(rows, g) {
  const out = [];
  const heights = rows.map((row) => Math.max(...row.map(([, h]) => h)));
  let y = (sum(heights) + (rows.length - 1) * g) / 2;
  rows.forEach((row, i) => {
    let x = -(sum(row.map(([w]) => w)) + (row.length - 1) * g) / 2;
    for (const [w, h] of row) {
      out.push(flat(x + w / 2, y - heights[i] / 2, w, h));
      x += w + g;
    }
    y -= heights[i] + g;
  });
  return out;
}

/** Two rows on a centre line: top-row bottoms at +g/2, bottom-row tops at −g/2; each row packed and centred. */
function packCenterline(rows, g) {
  const out = [];
  rows.slice(0, 2).forEach((row, i) => {
    let x = -(sum(row.map(([w]) => w)) + (row.length - 1) * g) / 2;
    for (const [w, h] of row) {
      out.push(flat(x + w / 2, i === 0 ? g / 2 + h / 2 : -g / 2 - h / 2, w, h));
      x += w + g;
    }
  });
  return out;
}

/** A rising row: x_{i+1} = x_i + (w_i + w_{i+1})/2 + g, y_i = rise · x_i. */
function packStair(list, g, rise) {
  const out = [];
  let x = 0;
  list.forEach(([w, h], i) => {
    if (i > 0) x += (list[i - 1][0] + w) / 2 + g;
    out.push(flat(x, rise * x, w, h));
  });
  return out;
}

/** Frames standing on a ledge (bottoms at y = 0), overlapping by overlap · the narrower width, alternating z layers. */
function packLedge(list, overlap) {
  const frames = [];
  let x = 0;
  list.forEach(([w, h], i) => {
    if (i > 0) x += (list[i - 1][0] + w) / 2 - overlap * Math.min(list[i - 1][0], w);
    const z = SET_LEDGE.leanZ[i % 2];
    frames.push({ x, y: h / 2, w, h, z, tilt: leanTilt(z, h) });
  });
  const x0 = Math.min(...frames.map((f) => f.x - f.w / 2)), x1 = Math.max(...frames.map((f) => f.x + f.w / 2));
  const ledge = { x: (x0 + x1) / 2, y: 0, w: x1 - x0 + 2 * SET_LEDGE.overhang, d: SET_LEDGE.d, t: SET_LEDGE.t, lip: SET_LEDGE.lip };
  return { frames, ledge };
}

/** Tilt (rad) of a frame of height h whose bottom edge stands z from the wall and whose top touches `top` from it. */
const leanTilt = (z, h, top = SET_LEDGE.top) => Math.asin(clamp((z - top) / h, 0, 1));

/** params.frames of layout 'custom' → clamped frames (invalid entries skipped, at most SET_LIMITS.frames). */
function customFrames(list) {
  if (!Array.isArray(list)) return [];
  const L = SET_LIMITS, out = [];
  for (const f of list) {
    if (out.length >= L.frames) break;
    if (!f || typeof f !== 'object') continue;
    const w = num(f.w, NaN), h = num(f.h, NaN);
    if (!(w > 0 && h > 0)) continue;
    out.push({
      x: clamp(num(f.x, 0), L.xy[0], L.xy[1]), y: clamp(num(f.y, 0), L.xy[0], L.xy[1]),
      w: clamp(w, L.side[0], L.side[1]), h: clamp(h, L.side[0], L.side[1]),
      z: clamp(num(f.z, 0), L.z[0], L.z[1]), tilt: clamp(num(f.tilt, 0), L.tilt[0], L.tilt[1]), data: f,
    });
  }
  return out;
}

/**
 * Bounding box of set frames (unrotated outer rectangles) and the ledge board (t under its top).
 * @returns {{ x0: number, x1: number, y0: number, y1: number, w: number, h: number, cx: number, cy: number }}
 */
export function setBounds(frames, ledge = null) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of frames || []) {
    x0 = Math.min(x0, f.x - f.w / 2);
    x1 = Math.max(x1, f.x + f.w / 2);
    y0 = Math.min(y0, f.y - f.h / 2);
    y1 = Math.max(y1, f.y + f.h / 2);
  }
  if (ledge) {
    x0 = Math.min(x0, ledge.x - ledge.w / 2);
    x1 = Math.max(x1, ledge.x + ledge.w / 2);
    y0 = Math.min(y0, ledge.y - ledge.t);
    y1 = Math.max(y1, ledge.y);
  }
  if (!(x1 >= x0)) return { x0: 0, x1: 0, y0: 0, y1: 0, w: 0, h: 0, cx: 0, cy: 0 };
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * Scales a layout uniformly into dims.w × dims.h and centres it at the origin (the set keeps its proportions, so a
 * changed gap re-fits the set to the same dims). x, y, w, h and the ledge's x, y, w, t and lip scale; z, ledge.d,
 * frameW and matW stay physical (artLayout clamps them per piece) – except that a set shallower than its ledge
 * (dims.d < SET_LEDGE.d) squeezes the ledge depth and the frames' z by kz = dims.d / SET_LEDGE.d (never deeper than
 * SET_LEDGE.d): placement, collisions and the selection box know only dims.d, so the set never sticks out past it
 * (buildArtSet squeezes the pieces' depth and the lip by kz too). Leaning frames on a ledge get their tilt recomputed
 * so their tops still touch the wall (at SET_LEDGE.top · kz).
 * @returns {{ frames: object[], ledge: object|null, s: number, kz: number }}
 */
export function fitSet(frames, ledge, dims) {
  const list = frames || [];
  const b = setBounds(list, ledge);
  const dw = num(dims?.w, NaN), dh = num(dims?.h, NaN), dd = num(dims?.d, NaN);
  const s = b.w > 0 && b.h > 0 && dw > 0 && dh > 0 ? Math.min(dw / b.w, dh / b.h) : 1;
  const kz = ledge && dd > 0 ? Math.min(1, dd / SET_LEDGE.d) : 1;
  const out = list.map((f) => {
    const h = f.h * s;
    const lean = ledge && f.z > SET_LEDGE.top;
    const z = ledge ? f.z * kz : f.z;
    return { ...f, x: (f.x - b.cx) * s, y: (f.y - b.cy) * s, w: f.w * s, h, z, tilt: lean ? leanTilt(z, h, SET_LEDGE.top * kz) : f.tilt ?? 0 };
  });
  const lg = ledge ? { ...ledge, x: (ledge.x - b.cx) * s, y: (ledge.y - b.cy) * s, w: ledge.w * s, d: ledge.d * kz, t: ledge.t * s, lip: ledge.lip * s } : null;
  return { frames: out, ledge: lg, s, kz };
}

/**
 * One motif across several panels (span, the triptych): the bounding box of the print planes { x, y, w, h } (centres
 * and sizes in set metres) and each plane's uvRect [u0, v0, u1, v1] inside it (v up, as PlaneGeometry and a flipY
 * canvas texture). Paint the motif at `aspect`; the gaps "eat" picture, as in a real triptych.
 */
export function spanRects(pieces) {
  const b = setBounds(pieces, null);
  const rects = (pieces || []).map((p) => [
    (p.x - p.w / 2 - b.x0) / b.w, (p.y - p.h / 2 - b.y0) / b.h, (p.x + p.w / 2 - b.x0) / b.w, (p.y + p.h / 2 - b.y0) / b.h,
  ]);
  return { w: b.w, h: b.h, aspect: b.h > 0 ? b.w / b.h : 1, rects };
}

/** uvRect [u0, v0, u1, v1] of an atlas cell { x, y, w, h } (canvas px, y down) in a W × H atlas (flipY texture). */
export function atlasUvRect(rect, W, H) {
  return [rect.x / W, 1 - (rect.y + rect.h) / H, (rect.x + rect.w) / W, 1 - rect.y / H];
}

/* ---------------------------------------------------------------------------------------------------------------------
 * Texture sizes (design/art.md §4.4, §5.2)
 * ------------------------------------------------------------------------------------------------------------------- */

/** Pixels per metre of print by render quality. */
export const PPM = Object.freeze({ low: 600, medium: 1000, high: 1300 });
/** Largest side of a set's atlas canvas by render quality. */
export const ATLAS_MAX = Object.freeze({ low: 1024, medium: 2048, high: 2048 });

/**
 * Long-side texture size of a print pw × ph (m): follows the physical size in 64 px steps between 256 and today's
 * artRes cap (low 512, medium 1024, high 1536). legacy = true returns the cap itself (legacy motifs stay byte-identical).
 */
export function artResFor(quality, pw, ph, legacy = false) {
  const cap = quality === 'low' ? 512 : quality === 'high' ? 1536 : 1024; // = today's artRes
  if (legacy) return cap;
  const long = Math.max(num(pw, 0), num(ph, 0));
  return Math.max(256, Math.min(cap, Math.round((long * (PPM[quality] ?? 1000)) / 64) * 64));
}

/** Picture aspect in ~4 % steps (a resized picture reuses its art; the stretch is invisible) – as decor.js. */
export const quantAspect = (a) => Math.exp(Math.round(Math.log(clamp(a, 0.2, 5)) / 0.04) * 0.04);

/** Canvas size for a print of aspect a = w/h: the long side `res`, the short side round(res / a), at least `min` px. */
export function canvasSize(aspect, res, min = 16) {
  const a0 = num(aspect, 1), a = a0 > 0 ? a0 : 1;
  return a >= 1 ? { W: res, H: Math.max(min, Math.round(res / a)) } : { W: Math.max(min, Math.round(res * a)), H: res };
}

/**
 * Shelf packer for a set's atlas (deterministic): cells { w, h } in px, sorted by height, each with `pad` px of gutter
 * on every side (the builder bleeds the cell's edge pixels into it against mip bleeding). Tries a few atlas widths and
 * keeps the smallest area; when nothing fits into maxSide × maxSide the cells shrink by 0.85 and it retries, up to 8
 * times. rects are the cells' painted areas in input order; scale = the shrink applied (1 = full size).
 * @param {{ w: number, h: number }[]} cells
 * @returns {{ W: number, H: number, rects: { x: number, y: number, w: number, h: number }[], scale: number } | null}
 */
export function packAtlas(cells, maxSide, pad = 6) {
  const list = cells || [];
  if (!list.length) return { W: 1, H: 1, rects: [], scale: 1 };
  const p = Math.max(0, Math.round(num(pad, 6)));
  let scale = 1;
  for (let attempt = 0; attempt <= 8; attempt++, scale *= 0.85) {
    const sc = list.map((c, i) => ({ w: Math.max(1, Math.round(num(c?.w, 1) * scale)), h: Math.max(1, Math.round(num(c?.h, 1) * scale)), i }));
    sc.sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
    const widest = Math.max(...sc.map((c) => c.w + 2 * p));
    if (widest > maxSide) continue;
    const area = sum(sc.map((c) => (c.w + 2 * p) * (c.h + 2 * p)));
    let best = null;
    for (let width = Math.max(widest, Math.ceil(Math.sqrt(area))); ; width = Math.ceil(width * 1.15)) {
      const r = shelfPack(sc, Math.min(width, maxSide), p, list.length);
      if (r && r.H <= maxSide && (!best || r.W * r.H < best.W * best.H)) best = r;
      if (width >= maxSide) break;
    }
    if (best) return { ...best, scale };
  }
  return null;
}

/** One shelf pass at a fixed width; rects back in input order. */
function shelfPack(sorted, width, p, n) {
  const rects = new Array(n);
  let x = 0, y = 0, shelf = 0, W = 0;
  for (const c of sorted) {
    const cw = c.w + 2 * p, ch = c.h + 2 * p;
    if (cw > width) return null;
    if (x + cw > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    rects[c.i] = { x: x + p, y: y + p, w: c.w, h: c.h };
    x += cw;
    shelf = Math.max(shelf, ch);
    W = Math.max(W, x);
  }
  return { W, H: y + shelf, rects };
}
