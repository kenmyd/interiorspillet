/**
 * Planbygger: the scale in layers – how many pixels per metre a plan is drawn at. The AI only reads what the plan
 * prints (areas, dimension texts, «1:100»); every length and area is measured classically in the image (detectPlan,
 * findRooms, traceLine). Round 1 design: notes/planbygger-runde1-design.md («autoscale.js – målestokken i lag»).
 *
 *   estimateScale({ img, det0, rooms0, ppm0, ai, pdfPage?, bra?, sameSource? }) → {
 *     pxPerM, method: 'dimensions'|'paper'|'areas'|'sameSource'|'bra'|'standard', spread, n,
 *     confidence: 'high'|'medium'|'low', candidates: [{ method, pxPerM, weight, detail }], outline: { w, h } | null
 *   }
 *       img      the image the detection ran on (RGBA); the AI's normalised `at` points are fractions of it
 *       det0     detectPlan(img, { pxPerM: ppm0 }) – walls and openings in pixels
 *       rooms0   findRooms(level.walls) of that detection (plan metres at ppm0), or its rooms array
 *       ai       the readPlan answer, or null (then only paper/standard/bra/sameSource can speak)
 *       pdfPage  { widthPt, heightPt, widthPx?, heightPx? } of the PDF page the image was rendered from. widthPx /
 *                heightPx (an addition to the design's shape) are the rendered page's size when img is a crop of it
 *                (sheet.js): without them a crop cannot be put on the paper, and the paper layer stays silent
 *       bra      BRA of this level from the user (m²)
 *       sameSource  results of other levels of the same drawing set (similarSource). Same set does not mean the same
 *                px/m: the levels' outlines (result.outline) are compared – a 1½-storey house shares its exterior walls,
 *                so a loft drawn at another zoom is rescaled by the ratio of the outlines (hus1: 0.965)
 *       debug    optional array: the candidates of every dimension are pushed to it (for tools and tests)
 *       ai.rooms[].at is the room's mark (ai.js puts the mark there), ai.labels[].at the label; both tie a printed area
 *       to the room polygon they lie in
 *       outline  (result) the outer faces of det0's exterior walls, w × h px: what a later level's sameSource compares
 *   standardScale(img, { detect, maxRuns = 3, budget = 12e6 }) → the same shape, method 'standard': the provisional ppm0 before any AI –
 *       the thinnest wall mode is taken as a 12 cm interior wall, the detection runs there with a wide door window, and
 *       the median door hole (frame included) is taken as 0.93 m; up to three wall modes are tried. Without a clear
 *       wall thickness (walls drawn as thin outlines, hus4) the walls' extent is taken as a house of 11 m. The ordinary
 *       detection at the result, when it ran one, is kept on the result (non-enumerable `det`) for autoScale.
 *   autoScale(img, { ai, detect, ppm0?, pdfPage?, bra?, sameSource?, maxPasses = 3 }) → { result, ppm0, det, rooms, passes }
 *       the whole step for one plan: standardScale (or a sure level of sameSource) → detectPlan + findRooms at ppm0 →
 *       estimateScale, and again at the estimate while a reading moves it more than 4 % (a provisional scale 20 % off
 *       can leave the walls too broken to measure). The standard sizes alone are not iterated on.
 *   wallModes(img, { mask: 'auto'|'dark'|'tone' }) → [{ px, share }]  thickness modes of wall-like ink (long stacks
 *                                          of equal runs) in the dark mask or the grey wall band
 *   parseScaleText(text) → 100 | null      «Målestokk 1:100», «M 1:50»
 *   dimensionMetres(value, text) → metres  «9815» (mm) → 9.815, «12.21 m» → 12.21
 *   similarSource(imgA, imgB) → bool       same image size (±3 %) and a wall thickness in common: the same drawing set
 *   isLoft(ai) → bool                      skylights or «loft» in the title / a room name
 *   innerArea(det0, rooms0, ppm0) → m²     the inner footprint BRA is compared with (rooms + interior walls)
 *
 * The layers, and how they are weighed (weight 0–1; the heaviest wins, the others check it):
 *   dimensions  each dimension text gets candidate pixel lengths: the dimension line traced near the text (and the
 *               segment of a chain between its ticks), and – for outer dimensions – the house's outer extent along that
 *               axis and the outer faces of the facade the text is written along. The scale that most dimensions agree
 *               on (±1.5 %) wins, searched within 1.5× of the areas, 2.5× of the doors (or a sure level of the same
 *               source), 5× of a provisional scale that only walls gave. A dimension with many candidates agrees with
 *               almost anything, so the agreement is tested against chance: P = (scales in the window) · e_n(c_1 … c_D),
 *               c_i = the share of readings that would hit one of dimension i's candidates by accident, e_n the chance
 *               that n of the D hit the same scale. A layer that does not use the dimensions and agrees narrows the
 *               window. P < 1 % and 2+ dimensions: high (1.0 / 0.92); P < 20 %: medium (0.6); else low (0.25 · (1 − P):
 *               below the doors, and near P = 1 below the provisional scale).
 *   paper       «1:N» + the paper: px/mm = page width in px / page width in mm, pxPerM = px/mm · 1000 / N. A PDF page
 *               of a standard ISO size 0.9; a page of no standard size (a scan embedded at another dpi) is doubted, and
 *               the ISO A sizes with the page's aspect are tried too (a round scan dpi and A3/A4 are preferred); the
 *               other layers choose among them – a loose prior (standard sizes) only among the guessed ISO sizes.
 *   areas       per room polygon: ppm0 · sqrt(polygon area at ppm0 / printed area), labels in one polygon summed (a
 *               merged hall + store), weighted median, outliers out (MAD). 3+ rooms 0.8, less when the rooms disagree
 *               with each other (× 4 % / spread). On a loft ×0.35 (below the doors).
 *   sameSource  the other level's result: high 0.78, medium 0.55, low 0.25 – one step down when the outlines differ.
 *   bra         sqrt(inner footprint px² / BRA): rooms + interior walls, inside the exterior walls. 0.45.
 *   standard    door holes (0.93 m) of det0 0.3 (3+ doors) / 0.2, the provisional scale itself 0.15, the thinnest wall
 *               (0.12 m) of det0 0.12 – a wall thickness alone never moves the scale away from the one that found it.
 * Confidence: the winner's own (dimensions by their chance, paper/areas with enough samples: high), one step down when
 * another precise layer disagrees by more than 3 % (areas: 1.5 × their spread at least; bra 8 %; doors 5 % with 4+,
 * 8 % with 3, 15 % with 2). A loft's own areas larger than the winner are expected and do not count against it, nor
 * do the areas of a single room or dimensions at chance level.
 */
import { luma, histogram, raster } from './image.js';
import { autoDarkThreshold, autoWallTone, detectPlan } from './detect.js';
import { traceLine } from './scale.js';
import { pointInPolygon, projectToSegment } from './geom.js';
import { applyDetection } from './model.js';
import { levelRooms } from './regions.js';

/** The median door hole (frame included) of Norwegian plans, metres: 0.91–0.95 on the test plans at their truth. */
export const DOOR_HOLE = 0.93;
/** The thinnest common wall (an interior wall), metres: 0.09–0.15 on the test plans. */
export const THIN_WALL = 0.12;
/** The thick (exterior) wall when it is the only clear mode, metres. */
export const THICK_WALL = 0.3;
/** A typical house's size (the geometric mean of the walls' extent), metres: only orders the hypotheses. */
const HOUSE_SIZE = 11;

/** ISO 216 A sizes [short, long] in mm. */
const ISO_A = Object.freeze({ A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] });
/** Scan / render resolutions that are «round»: a page at one of these is likely the real paper size. */
const ROUND_DPI = [72, 75, 96, 100, 150, 200, 300, 400, 600];
/** Layer order when weights tie. */
const ORDER = ['dimensions', 'paper', 'areas', 'sameSource', 'bra', 'standard'];
/** How far another layer may be from the winner before it counts as disagreeing. */
const AGREE = { dimensions: 0.03, paper: 0.03, areas: 0.03, sameSource: 0.03, bra: 0.08, standard: 0.15 };
const LEVELS = ['low', 'medium', 'high'];
const down = (conf) => LEVELS[Math.max(0, LEVELS.indexOf(conf) - 1)];
/** Two dimensions agree on a scale within this. */
const DIM_TOL = 0.015;
/**
 * The spread of wrong readings (a misread digit, a value tied to the wrong line), as ln(max / min) of plan lengths:
 * 0.8–20 m. A candidate catches a wrong reading with chance 2 · DIM_TOL / DIM_RANGE ≈ 0.9 %.
 */
const DIM_RANGE = Math.log(20 / 0.8);
/** Outlines of two levels: the same within this per axis; a uniform zoom when both axes agree within OUTLINE_UNIFORM. */
const OUTLINE_SAME = 0.012;
const OUTLINE_UNIFORM = 0.01;
const NOT_A_ROOM = /brutto|\bbta\b|\bbra\b|p-rom|s-rom|totalt|\bsum\b|tomt|bebygd/i;

const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Weighted median of [{ v, w }]. */
function weightedMedian(items) {
  const s = items.filter((it) => it.w > 0 && Number.isFinite(it.v)).sort((a, b) => a.v - b.v);
  if (!s.length) return NaN;
  const total = s.reduce((a, it) => a + it.w, 0);
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc += s[i].w;
    if (acc >= total / 2 - 1e-12) {
      // exactly half: the mean of the two middle values (an even count of equal weights)
      if (Math.abs(acc - total / 2) < 1e-9 && i + 1 < s.length) return (s[i].v + s[i + 1].v) / 2;
      return s[i].v;
    }
  }
  return s[s.length - 1].v;
}

const relDiff = (a, b) => Math.abs(a / b - 1);
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

// ---------------------------------------------------------------------------------------------------------------
// Text

/** «Målestokk 1:100», «M 1 : 50», «1:100 (A3)» → 100; null when there is none. */
export function parseScaleText(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/(?:^|[^\d.,])1\s*:\s*(\d{1,4})(?![\d.,])/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 10 && n <= 2000 ? n : null;
}

/**
 * A dimension's value in metres. The AI is asked for metres, but plans print mm («9815») and sometimes cm: a value over
 * 100 is mm (a house is not 100 m long); a value that is just the printed number takes the unit printed with it
 * («735 cm»).
 */
export function dimensionMetres(value, text = '') {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  const printed = num((t.match(/\d+(?:[.,]\d+)?/) || [])[0]);
  let v = num(value);
  if (!Number.isFinite(v)) v = printed;
  if (!(v > 0)) return null;
  const copied = Number.isFinite(printed) && Math.abs(printed - v) < 1e-9;
  if (copied && /\bcm\b/.test(t)) v /= 100;
  else if ((copied && /\bmm\b/.test(t)) || v >= 100) v /= 1000;
  return v >= 0.2 && v <= 120 ? v : null;
}

/** A loft (under the roof): skylights, or «loft» in the level title or a room name. */
export function isLoft(ai) {
  if (!ai) return false;
  if (Array.isArray(ai.skylights) && ai.skylights.length) return true;
  const names = [ai.levelTitle, ...(ai.rooms || []).map((r) => r?.name), ...(ai.labels || []).map((l) => l?.text)];
  return names.some((n) => typeof n === 'string' && /loft/i.test(n));
}

// ---------------------------------------------------------------------------------------------------------------
// Wall thickness modes (classical, scale-free)

function paperGrey(hist) {
  let best = 255;
  for (let i = 150; i < 256; i++) if (hist[i] > hist[best]) best = i;
  return best;
}

/**
 * Thicknesses of wall-like ink: runs along one axis that repeat with the same extent (±1 px) in at least
 * max(minStack, ratio · thickness) consecutive rows / columns. A wall of t px and L px gives L rows of t; text, arcs
 * and hatching give short stacks and drop out. Returns the stack length per rounded thickness (both axes).
 */
function stackHistogram(mask, { ratio = 8, minStack = 20 } = {}) {
  const hist = new Float64Array(256);
  const stacks = [];
  const { w, h, data } = mask;
  for (const axis of ['h', 'v']) {
    const W = axis === 'h' ? w : h;
    const L = axis === 'h' ? h : w;
    let open = new Map();
    let l = 0;
    const flush = (p) => {
      const t = p.sum / p.len;
      if (t >= 1.5 && t < 255 && p.len >= Math.max(minStack, ratio * t)) {
        hist[Math.round(t)] += p.len;
        // the stack's centre in the image (for the extent of the walls)
        const along = p.b - t / 2;
        const across = l - p.len / 2;
        stacks.push({ x: axis === 'h' ? along : across, y: axis === 'h' ? across : along, len: p.len, t });
      }
    };
    for (l = 0; l <= L; l++) {
      const next = new Map();
      if (l < L) {
        let s = -1;
        for (let i = 0; i <= W; i++) {
          const v = i < W ? (axis === 'h' ? data[l * w + i] : data[i * w + l]) : 0;
          if (v && s < 0) s = i;
          else if (!v && s >= 0) {
            const a = s;
            const b = i - 1;
            let prev = null;
            for (const da of [0, -1, 1]) {
              const p = open.get(a + da);
              if (p && Math.abs(p.b - b) <= 1) {
                prev = p;
                open.delete(a + da);
                break;
              }
            }
            next.set(a, prev ? { b: prev.b, len: prev.len + 1, sum: prev.sum + (b - a + 1) } : { b, len: 1, sum: b - a + 1 });
            s = -1;
          }
        }
      }
      for (const p of open.values()) flush(p);
      open = next;
    }
  }
  return { hist, stacks };
}

/** Weighted percentile of [{ v, w }]. */
function percentile(items, q) {
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, it) => a + it.w, 0);
  let acc = 0;
  for (const it of s) {
    acc += it.w;
    if (acc >= q * total) return it.v;
  }
  return s.length ? s[s.length - 1].v : NaN;
}

/**
 * Wall statistics of an image: the thickness modes (see wallModes) and the extent of the wall-like ink in pixels
 * ({ w, h }: the 2nd–98th percentile of the stacks of 3 px and more, so a page frame or a stray line counts little).
 */
/** Thickness modes of a stack histogram: local maxima with ≥ 5 % of the mass, sub-pixel centres. */
function modesOf(sh, total) {
  const modes = [];
  for (let i = 2; i < 250; i++) {
    // a local maximum of the raw histogram; its mass and centre over ±1 px (an antialiased thickness splits over two
    // neighbouring lengths)
    if (!(sh[i] > 0 && sh[i] >= sh[i - 1] && sh[i] > sh[i + 1])) continue;
    const a = sh[i - 1] || 0;
    const b = sh[i];
    const c = sh[i + 1] || 0;
    const mass = a + b + c;
    if (mass / total < 0.05) continue;
    modes.push({ px: ((i - 1) * a + i * b + (i + 1) * c) / mass, share: mass / total });
  }
  return modes;
}

/** A mode that can be a wall: 3 px or more, with a share of the wall-like ink. */
const usableMode = (m) => m.px >= 3 && m.share >= 0.06;

function wallStats(img, { mask = 'auto' } = {}) {
  const grey = luma(img);
  const hist = histogram(grey);
  const mk = (test) => {
    const m = raster(grey.w, grey.h);
    for (let i = 0; i < grey.data.length; i++) m.data[i] = test(grey.data[i]) ? 1 : 0;
    return m;
  };
  const t = autoDarkThreshold(hist);
  let st = mask === 'tone' ? { hist: new Float64Array(256), stacks: [] } : stackHistogram(mk((v) => v < t));
  let total = st.hist.reduce((a, b) => a + b, 0);
  let modes = total ? modesOf(st.hist, total) : [];
  // grey walls: almost nothing dark and long (the grey band instead), or grey walls drawn with thin dark outlines
  // (hus4: the dark ink is all 2–3 px lines) – the grey band when it gives a wall thickness the dark mask does not
  if (mask !== 'dark' && (mask === 'tone' || total < 0.5 * (grey.w + grey.h) || !modes.some(usableMode))) {
    const tone = autoWallTone(grey, hist, paperGrey(hist));
    if (tone) {
      const st2 = stackHistogram(mk((v) => v >= tone[0] && v <= tone[1]));
      const t2 = st2.hist.reduce((a, b) => a + b, 0);
      const modes2 = t2 ? modesOf(st2.hist, t2) : [];
      if (mask === 'tone' || t2 > total || (modes2.some(usableMode) && !modes.some(usableMode) && t2 > 0.5 * (grey.w + grey.h))) {
        st = st2;
        total = t2;
        modes = modes2;
      }
    }
  }
  if (!total) return { modes: [], extent: null };
  const wallish = st.stacks.filter((s) => s.t >= 2.5);
  let extent = null;
  if (wallish.length >= 4) {
    const xs = wallish.map((s) => ({ v: s.x, w: s.len }));
    const ys = wallish.map((s) => ({ v: s.y, w: s.len }));
    extent = { w: percentile(xs, 0.98) - percentile(xs, 0.02), h: percentile(ys, 0.98) - percentile(ys, 0.02) };
    // a few lines in a row are no house (hus4's loft: 410 × 1 px)
    if (!(extent.w >= 0.05 * grey.w && extent.h >= 0.05 * grey.h)) extent = null;
  }
  return { modes, extent };
}

/**
 * The thickness modes of the walls in pixels, thinnest first: [{ px (sub-pixel), share (of all wall-like stacks) }].
 * The dark mask is the detector's (valley after the black peak); with grey walls (almost nothing dark and long) the
 * grey band of autoWallTone is used instead. Modes under 3 px are mostly drawn lines (furniture, dimensions).
 */
export function wallModes(img, opts) {
  return wallStats(img, opts).modes;
}

/**
 * Same source: two drawings from one set (the same tool) – the same image size within 3 % and a wall thickness in
 * common (a mode of 3 px or more within ±1 px or ±10 %; a loft's partitions may be thinner than the floor's below, its
 * exterior walls are drawn alike). generate.js uses it to decide which levels may pass their scale on (sameSource).
 * It does not mean the same px/m: hus1's loft is drawn at 0.966 of the floor below in an image of the same height, and
 * estimateScale compares the outlines before it inherits.
 */
export function similarSource(a, b) {
  if (!a || !b) return false;
  const near = (x, y) => Math.abs(x - y) <= 0.03 * Math.max(x, y);
  if (!near(a.width, b.width) || !near(a.height, b.height)) return false;
  const ma = wallModes(a).filter((m) => usableMode(m) && m.share >= 0.1);
  const mb = wallModes(b).filter((m) => usableMode(m) && m.share >= 0.1);
  if (!ma.length || !mb.length) return true; // nothing to compare: the sizes decide
  return ma.some((x) => mb.some((y) => Math.abs(x.px - y.px) <= Math.max(1, 0.1 * Math.max(x.px, y.px))));
}

// ---------------------------------------------------------------------------------------------------------------
// Standard sizes

/** The door holes of a detection (px) that agree with their median (±15 %), from arcs that are clearly drawn. */
function doorCluster(det) {
  const doors = (det?.openings || []).filter((o) => o.type === 'door' && !(o.score < 0.85));
  const holes = doors.map((o) => o.to - o.from).filter((v) => v > 0);
  if (!holes.length) return { n: 0, px: NaN, holes };
  const m0 = median(holes);
  const kept = holes.filter((v) => Math.abs(v / m0 - 1) <= 0.15);
  return { n: kept.length, px: median(kept), holes };
}

/** The thinnest interior wall of a detection (px): the length-weighted median of the walls ≥ 1 m that are not exterior. */
function thinWallPx(det, ppm) {
  const ws = (det?.walls || []).filter((w) => !w.exterior && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= ppm);
  if (!ws.length) return NaN;
  const ts = ws.map((w) => w.t).sort((a, b) => a - b);
  // the thin family: within 30 % of the thinnest decile
  const t0 = ts[Math.floor(ts.length * 0.1)];
  const thin = ws.filter((w) => w.t <= t0 * 1.3);
  return weightedMedian(thin.map((w) => ({ v: w.t, w: Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) })));
}

/**
 * The provisional scale before any AI (see the top of the file): wall modes → hypotheses → the detection with a wide
 * door window at each until one finds 3+ doors that agree → the median door hole is 0.93 m.
 * A hypothesis whose detection would be upsampled past `budget` pixels (the detector doubles a plan under 50 px/m: a
 * 7.7 MP scan becomes 31 MP) is detected at the image's own resolution: only the doors are wanted from it.
 * @returns {{ pxPerM, method: 'standard', spread, n, confidence, candidates, from: 'dører'|'vegger'|'omriss', modes, extent }} | null
 */
export function standardScale(img, { detect = detectPlan, maxRuns = 3, budget = 12e6 } = {}) {
  const { modes, extent } = wallStats(img);
  const usable = modes.filter(usableMode);
  const hyps = [];
  const add = (ppm, why) => {
    if (ppm > 5 && ppm < 2000 && !hyps.some((h) => relDiff(h.ppm, ppm) < 0.15)) hyps.push({ ppm, why });
  };
  if (usable.length) {
    add(usable[0].px / THIN_WALL, `tynneste vegg ${fmt(usable[0].px)} px = ${THIN_WALL * 100} cm`);
    if (usable[1]) add(usable[1].px / THIN_WALL, `neste vegg ${fmt(usable[1].px)} px = ${THIN_WALL * 100} cm`);
    const thick = usable[usable.length - 1];
    if (thick.px >= 1.8 * usable[0].px) add(thick.px / THICK_WALL, `tykkeste vegg ${fmt(thick.px)} px = ${THICK_WALL * 100} cm`);
  }
  const gm = extent && extent.w > 0 && extent.h > 0 ? Math.sqrt(extent.w * extent.h) : null;
  // no wall thickness to go by (walls drawn as thin outlines): the walls' extent – or the image – as a house of 11 m
  if (!hyps.length) add((gm ?? 0.6 * Math.sqrt(img.width * img.height)) / HOUSE_SIZE, `${gm ? 'veggene' : 'bildet'} som et hus på ${HOUSE_SIZE} m`);
  if (!hyps.length) return null;
  // the most plausible first: the walls' extent as a house of about 11 m (the geometric mean of its sides)
  if (gm) {
    for (const h of hyps) h.size = gm / h.ppm;
    hyps.sort((a, b) => Math.abs(Math.log(a.size / HOUSE_SIZE)) - Math.abs(Math.log(b.size / HOUSE_SIZE)));
  }

  const tried = [];
  for (const h of hyps.slice(0, maxRuns)) {
    let det = null;
    // a wide door window: the hypothesis may be 40 % off
    const opts = { pxPerM: h.ppm, doorMin: 0.45, doorMax: 1.6 };
    const up = h.ppm < 50 ? Math.min(4, Math.ceil(50 / h.ppm)) : 1;
    if (img.width * img.height * up * up > budget) opts.minPxPerM = Math.min(50, h.ppm);
    try {
      det = detect(img, opts);
    } catch {
      det = null;
    }
    const dc = doorCluster(det);
    tried.push({ ...h, doors: dc.n, ppmDoors: dc.n ? dc.px / DOOR_HOLE : NaN, det });
    if (dc.n >= 3) break;
  }
  const best = tried.filter((t) => t.doors >= 2).sort((a, b) => b.doors - a.doors)[0];
  const candidates = hyps.map((h) => ({ method: 'standard', pxPerM: h.ppm, weight: 0.1, detail: h.why }));
  if (!best) {
    return { pxPerM: hyps[0].ppm, method: 'standard', spread: null, n: 0, confidence: 'low', candidates, from: usable.length ? 'vegger' : 'omriss', modes, extent };
  }
  let ppm = best.ppmDoors;
  let n = best.doors;
  let spread = null;
  let kept = null;
  // away from the hypothesis: the detection measured the doors at another scale – confirm with the ordinary detection at
  // the result (its door window and wall widths now fit); autoScale starts from that detection
  if (relDiff(ppm, best.ppm) > 0.08) {
    try {
      const det = detect(img, { pxPerM: ppm });
      kept = { det, pxPerM: ppm };
      const dc = doorCluster(det);
      if (dc.n >= 2) {
        ppm = dc.px / DOOR_HOLE;
        n = dc.n;
      }
    } catch {
      /* keep the first estimate */
    }
  }
  const holes = doorCluster(best.det).holes;
  if (holes.length > 1) spread = median(holes.map((v) => Math.abs(v / (ppm * DOOR_HOLE) - 1)));
  candidates.unshift({ method: 'standard', pxPerM: ppm, weight: 0.3, detail: `${n} dører, medianen av døråpningene = ${fmt(DOOR_HOLE * 100, 0)} cm` });
  const result = { pxPerM: ppm, method: 'standard', spread, n, confidence: n >= 3 ? 'medium' : 'low', candidates, from: 'dører', modes, extent };
  // the ordinary detection that ran (at kept.pxPerM, within a few % of the result): not part of the result's data
  if (kept) Object.defineProperty(result, 'det', { value: kept, enumerable: false });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Layers

const roomList = (rooms0) => (Array.isArray(rooms0) ? rooms0 : rooms0?.rooms || []).filter((r) => r && Array.isArray(r.polygon) && r.polygon.length >= 3);

/** The room (index into the list) a label at plan metres p lies in: point in polygon, else within 0.3 m of an edge. */
function roomAt(rooms, p) {
  for (let i = 0; i < rooms.length; i++) if (pointInPolygon(p, rooms[i].polygon)) return i;
  let best = -1;
  let bestD = 0.3;
  for (let i = 0; i < rooms.length; i++) {
    const poly = rooms[i].polygon;
    for (let k = 0; k < poly.length; k++) {
      const d = projectToSegment(p, poly[k], poly[(k + 1) % poly.length]).d;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

/** areas: printed room areas against the room polygons (labels in one polygon are summed). */
function areasLayer({ img, rooms0, ppm0, ai }) {
  const rooms = roomList(rooms0);
  if (!ai || !rooms.length || !(ppm0 > 0)) return null;
  const entries = [];
  for (const e of [...(ai.rooms || []), ...(ai.labels || [])]) {
    const a = num(e?.area);
    const at = e?.at;
    if (!(a > 0.3) || !Array.isArray(at) || at.length < 2) continue;
    if (NOT_A_ROOM.test(String(e.name ?? e.text ?? ''))) continue;
    // the same label twice (in rooms and in labels): once
    if (entries.some((x) => x.a === a && Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) < 0.01)) continue;
    entries.push({ a, at, name: e.name ?? e.text ?? '' });
  }
  const sums = new Map();
  for (const e of entries) {
    const p = [(e.at[0] * img.width) / ppm0, (e.at[1] * img.height) / ppm0];
    const i = roomAt(rooms, p);
    if (i < 0) continue;
    const s = sums.get(i) || { label: 0, names: [] };
    s.label += e.a;
    s.names.push(e.name);
    sums.set(i, s);
  }
  const samples = [];
  for (const [i, s] of sums) {
    const area0 = Math.abs(rooms[i].area);
    if (!(area0 > 0)) continue;
    const v = ppm0 * Math.sqrt(area0 / s.label);
    // a room that puts the scale 2.5× from the one it was detected at is not that room (walls detected that far off
    // are other lines: hus7's crop at 25 px/m gave a 0.6 m² box for a 30 m² garage)
    if (v / ppm0 > 2.5 || ppm0 / v > 2.5) continue;
    samples.push({ v, w: s.label / (s.label + 2), names: s.names, label: s.label, area0 });
  }
  if (!samples.length) return null;
  const m0 = weightedMedian(samples);
  const res = samples.map((s) => Math.abs(s.v / m0 - 1));
  const mad = median(res);
  const lim = Math.max(0.03, 3 * 1.4826 * mad);
  const inl = samples.filter((s, k) => res[k] <= lim);
  const v = weightedMedian(inl);
  const spread = inl.length > 1 ? 1.4826 * median(inl.map((s) => Math.abs(s.v / v - 1))) : null;
  const loft = isLoft(ai);
  const n = inl.length;
  let weight = n >= 3 ? 0.8 : n === 2 ? 0.62 : 0.45;
  // rooms that disagree with each other (a detection that split or merged rooms, hus4): the areas say less – at 25 %
  // spread less than the doors
  if (spread != null && spread > 0.04) weight *= 0.04 / spread;
  // a loft's labels count the floor above 1.9 m only: its scale comes out too large, by 15 % on hus1 – below the doors
  if (loft) weight *= 0.35;
  const detail =
    `${n} av ${samples.length} rom (${inl.map((s) => `${s.names.join('+')} ${fmt(s.label)} m²`).join(', ')})` +
    (spread != null ? `, spredning ${fmt(spread * 100)} %` : '') +
    (loft ? ', loft: arealene er mindre enn gulvet' : '');
  return { method: 'areas', pxPerM: v, weight, detail, n, spread, loft };
}

/**
 * The outer faces of the exterior walls along one axis (px): v walls give x faces (for horizontal dimensions). Each face
 * keeps the span of its walls across (s0–s1), so a dimension can be tied to the facade it is written along. lo / hi:
 * the house's outer extent along the axis – the outermost faces of the exterior walls (of all walls when fewer than two
 * are marked exterior).
 */
function exteriorFaces(det, rooms0, ppm0, along) {
  const walls = det?.walls || [];
  const at = typeof rooms0?.at === 'function' ? rooms0.at : null;
  const isOut = (x, y) => (at && ppm0 > 0 ? at(x / ppm0, y / ppm0) === -1 : null);
  const faces = [];
  const push = (pos, s0, s1) => {
    const f = faces.find((g) => Math.abs(g.pos - pos) <= 2);
    if (f) {
      f.s0 = Math.min(f.s0, s0);
      f.s1 = Math.max(f.s1, s1);
    } else faces.push({ pos, s0, s1 });
  };
  const axis = along === 'h' ? 'v' : 'h'; // a horizontal length runs between vertical walls
  const all = { lo: Infinity, hi: -Infinity, n: 0 };
  const ext = { lo: Infinity, hi: -Infinity, n: 0 };
  for (const w of walls) {
    const isAxis = w.axis ? w.axis === axis : axis === 'v' ? Math.abs(w.a[0] - w.b[0]) < 1 : Math.abs(w.a[1] - w.b[1]) < 1;
    if (!isAxis) continue;
    const c = axis === 'v' ? w.a[0] : w.a[1];
    const s0 = Math.min(axis === 'v' ? w.a[1] : w.a[0], axis === 'v' ? w.b[1] : w.b[0]) - w.t;
    const s1 = Math.max(axis === 'v' ? w.a[1] : w.a[0], axis === 'v' ? w.b[1] : w.b[0]) + w.t;
    for (const e of w.exterior ? [all, ext] : [all]) {
      e.lo = Math.min(e.lo, c - w.t / 2);
      e.hi = Math.max(e.hi, c + w.t / 2);
      e.n++;
    }
    if (!w.exterior) continue;
    // outsideSide is along the wall's normal (−d.y, d.x): h → +y, v → −x
    const sign = axis === 'v' ? -(w.outsideSide || 0) : w.outsideSide || 0;
    if (sign) push(c + (sign * w.t) / 2, s0, s1);
    // a free-standing exterior wall (outside on both sides): both faces
    if (isOut) {
      const mid = (s0 + s1) / 2;
      const probe = (k) => (axis === 'v' ? isOut(c + k * (w.t / 2 + 3), mid) : isOut(mid, c + k * (w.t / 2 + 3)));
      if (probe(1) && probe(-1)) {
        push(c + w.t / 2, s0, s1);
        push(c - w.t / 2, s0, s1);
      }
    }
  }
  const e = ext.n >= 2 ? ext : all;
  return { faces: faces.sort((a, b) => a.pos - b.pos), lo: e.n ? e.lo : null, hi: e.n ? e.hi : null };
}

/** The outline of a detection: the house's outer extent, w × h px (see exteriorFaces), or null. */
function outlineOf(det0, rooms0, ppm0) {
  const x = exteriorFaces(det0, rooms0, ppm0, 'h');
  const y = exteriorFaces(det0, rooms0, ppm0, 'v');
  if (x.lo == null || y.lo == null) return null;
  const w = x.hi - x.lo;
  const h = y.hi - y.lo;
  return w > 10 && h > 10 ? { w, h } : null;
}

/** Paper grey around a point and the «ink» test traceLine uses (darker than the paper by 45). */
function inkTest(grey, x, y) {
  const { w, h } = grey;
  const vals = [];
  for (let dy = -12; dy <= 12; dy += 3) {
    for (let dx = -12; dx <= 12; dx += 3) {
      const xx = Math.round(x) + dx;
      const yy = Math.round(y) + dy;
      vals.push(xx < 0 || yy < 0 || xx >= w || yy >= h ? 255 : grey.data[yy * w + xx]);
    }
  }
  const paper = median(vals);
  return (v) => v < paper - 45;
}

/**
 * The ticks of a traced dimension line: places where the ink across the line is clearly wider than the line itself
 * (arrow heads, slashes, the extension lines crossing it). Returns their centres along the line (px), the ends
 * excluded.
 */
function ticksOf(grey, tr, skip) {
  const horiz = tr.horizontal;
  const row = Math.floor(horiz ? tr.a[1] : tr.a[0]);
  const s0 = Math.round(horiz ? tr.a[0] : tr.a[1]);
  const s1 = Math.round(horiz ? tr.b[0] : tr.b[1]) - 1;
  const ink = inkTest(grey, horiz ? (s0 + s1) / 2 : row, horiz ? row : (s0 + s1) / 2);
  const { w, h } = grey;
  const at = (s, k) => {
    const x = horiz ? s : row + k;
    const y = horiz ? row + k : s;
    return x < 0 || y < 0 || x >= w || y >= h ? 255 : grey.data[y * w + x];
  };
  const across = [];
  for (let s = s0; s <= s1; s++) {
    let n = 0;
    for (const sg of [1, -1]) {
      for (let k = sg > 0 ? 0 : 1; k < 14; k++) {
        if (!ink(at(s, sg * k))) break;
        n++;
      }
    }
    across.push(n);
  }
  const base = Math.max(1, median(across.filter((n) => n > 0)));
  const ticks = [];
  let start = -1;
  for (let i = 0; i <= across.length; i++) {
    const t = i < across.length && across[i] >= base + 3;
    if (t && start < 0) start = i;
    else if (!t && start >= 0) {
      const c = s0 + (start + i - 1) / 2;
      if (c - s0 > 4 && s1 - c > 4 && !(skip && c > skip[0] && c < skip[1])) ticks.push(c);
      start = -1;
    }
  }
  return { ticks, s0, s1: s1 + 1 };
}

/**
 * Dimension lines near a label: traceLine from seeds around it (the text sits on or beside its line, and may break it),
 * kept when the line runs along the dimension's axis past the label. Each gives its full length and, when it has ticks,
 * the segment of the chain the label lies on.
 */
function tracedLengths(grey, lx, ly, along, S) {
  const horiz = along === 'h';
  const out = [];
  const offA = [0, 0.015, -0.015, 0.03, -0.03, 0.05, -0.05].map((k) => k * S);
  const offP = [0, 0.006, -0.006, 0.012, -0.012, 0.02, -0.02].map((k) => k * S);
  for (const da of offA) {
    for (const dp of offP) {
      const x = horiz ? lx + da : lx + dp;
      const y = horiz ? ly + dp : ly + da;
      if (x < 0 || y < 0 || x >= grey.w || y >= grey.h) continue;
      let tr = null;
      try {
        tr = traceLine(grey, x, y);
      } catch {
        tr = null;
      }
      if (!tr || tr.horizontal !== horiz || tr.length < 0.02 * S) continue;
      const row = horiz ? tr.a[1] : tr.a[0];
      const a0 = horiz ? tr.a[0] : tr.a[1];
      const a1 = horiz ? tr.b[0] : tr.b[1];
      const lAlong = horiz ? lx : ly;
      const lPerp = horiz ? ly : lx;
      if (lAlong < a0 - 0.01 * S || lAlong > a1 + 0.01 * S) continue;
      const dPerp = Math.abs(row - lPerp);
      if (dPerp > 0.035 * S) continue;
      if (out.some((o) => Math.abs(o.row - row) <= 2 && Math.abs(o.a0 - a0) <= 3 && Math.abs(o.a1 - a1) <= 3)) continue;
      const wt = Math.exp(-dPerp / (0.02 * S));
      const rec = { row, a0, a1, len: tr.length, w: wt, kind: 'linje' };
      out.push(rec);
      // the chain segment the label is on
      const { ticks, s0, s1 } = ticksOf(grey, tr, [lAlong - 0.03 * S, lAlong + 0.03 * S]);
      if (ticks.length) {
        const bounds = [s0, ...ticks, s1];
        for (let k = 0; k + 1 < bounds.length; k++) {
          if (lAlong >= bounds[k] && lAlong <= bounds[k + 1] && bounds[k + 1] - bounds[k] >= 8) {
            out.push({ row, a0: bounds[k], a1: bounds[k + 1], len: bounds[k + 1] - bounds[k], w: wt * 0.9, kind: 'kjede', seg: true });
          }
        }
      }
    }
  }
  return out;
}

/**
 * dimensions: printed lengths against traced dimension lines and outer wall faces; the scale most dimensions agree on
 * wins. `chance` is e_n of the dimensions' chances of catching a wrong reading (see the top of the file), `window` the
 * width of the searched scales (ln); estimateScale turns them into the weight and the confidence, since the layers that
 * can narrow the window are known there.
 */
function dimensionsLayer({ img, det0, rooms0, ppm0, ai, debug }, grey, prior, lim) {
  const dims = [];
  for (const d of ai?.dimensions || []) {
    const m = dimensionMetres(d?.value, d?.text ?? '');
    if (!m || !(d.along === 'h' || d.along === 'v') || !Array.isArray(d.at) || d.at.length < 2) continue;
    // the same dimension listed twice: once
    if (dims.some((x) => x.along === d.along && Math.abs(x.m - m) < 1e-6 && Math.hypot(x.at[0] - d.at[0], x.at[1] - d.at[1]) < 0.01)) continue;
    dims.push({ ...d, m });
  }
  if (!dims.length) return null;
  const S = Math.max(img.width, img.height);
  // outer faces only from a detection that closed some rooms (else its «walls» are lines, hatching or text)
  const closed = roomList(rooms0).length > 0;
  const facesBy = closed ? { h: exteriorFaces(det0, rooms0, ppm0, 'h'), v: exteriorFaces(det0, rooms0, ppm0, 'v') } : null;
  const perDim = [];
  for (const d of dims) {
    const lx = d.at[0] * img.width;
    const ly = d.at[1] * img.height;
    const what = d.what || 'other';
    const cands = [];
    const wTrace = what === 'outer' ? 0.8 : 1;
    for (const t of tracedLengths(grey, lx, ly, d.along, S)) {
      const k = t.seg ? (what === 'chain' ? 1 : 0.8) : what === 'chain' ? 0.6 : 1;
      cands.push({ p: t.len / d.m, w: t.w * wTrace * k, how: `${t.kind} ${fmt(t.len, 0)} px` });
    }
    if (facesBy && (what === 'outer' || what === 'chain')) {
      const { faces, lo, hi } = facesBy[d.along];
      // an outer dimension is the house's outer extent along its axis (the design's rule) …
      if (what === 'outer' && lo != null && hi - lo >= 10) cands.push({ p: (hi - lo) / d.m, w: 1, how: `ytre utstrekning ${fmt(hi - lo, 0)} px` });
      // … or a facade between two outer corners (a wing, hus2): both faces must reach the text written along it
      const wFace = what === 'outer' ? 1 : 0.5;
      const lAlong = d.along === 'h' ? lx : ly;
      const lPerp = d.along === 'h' ? ly : lx;
      const ext = d.along === 'h' ? img.width : img.height;
      const extP = d.along === 'h' ? img.height : img.width;
      const dist = (f) => Math.max(0, f.s0 - lPerp, lPerp - f.s1);
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const L = faces[j].pos - faces[i].pos;
          if (L < 10) continue;
          const m = 0.06 * ext;
          if (lAlong < faces[i].pos - m || lAlong > faces[j].pos + m) continue;
          const wp = Math.exp(-(dist(faces[i]) + dist(faces[j])) / (0.25 * extP));
          if (wp < 0.5) continue;
          cands.push({ p: L / d.m, w: wFace * wp, how: `ytterflater ${fmt(L, 0)} px` });
        }
      }
    }
    // every distinct length could catch a wrong reading: a dimension with many candidates agrees with almost anything
    const distinct = [];
    for (const c of cands) if (!distinct.some((p) => relDiff(p, c.p) <= DIM_TOL)) distinct.push(c.p);
    const chance = Math.min(1, (distinct.length * 2 * DIM_TOL) / DIM_RANGE);
    const ok = cands.filter((c) => !(prior > 0) || (c.p / prior < lim && prior / c.p < lim));
    if (Array.isArray(debug)) debug.push({ dim: d.text ?? d.value, m: d.m, along: d.along, what, chance, cands: ok.map((c) => [Math.round(c.p * 100) / 100, Math.round(c.w * 100) / 100, c.how]) });
    perDim.push({ d, cands: ok, chance });
  }
  if (!perDim.some((pd) => pd.cands.length)) return null;
  // the support of a scale: per dimension its best candidate there, worth ln(1 / chance) – a match of a dimension
  // with one candidate says more than one of a dimension with forty (face pairs of a broken detection)
  const supportOf = (p) => {
    let s = 0;
    const matched = [];
    for (const pd of perDim) {
      let best = null;
      for (const c of pd.cands) if (relDiff(c.p, p) <= DIM_TOL && (!best || c.w > best.w)) best = c;
      if (best) {
        s += best.w * Math.log(1 / Math.max(1e-3, Math.min(0.9, pd.chance)));
        matched.push({ pd, c: best });
      }
    }
    return { s, matched };
  };
  let best = null;
  const closer = (x) => (prior > 0 ? Math.abs(Math.log(x / prior)) : 0);
  for (const pd of perDim) {
    for (const c of pd.cands) {
      const sup = supportOf(c.p);
      if (!best || sup.s > best.s + 1e-9 || (Math.abs(sup.s - best.s) < 1e-9 && closer(c.p) < closer(best.p))) best = { ...sup, p: c.p };
    }
  }
  const items = best.matched.map((m) => ({ v: m.c.p, w: m.c.w }));
  const v = weightedMedian(items);
  const n = best.matched.length;
  const spread = n > 1 ? Math.max(...items.map((it) => Math.abs(it.v / v - 1))) : null;
  // the chance that n of the D dimensions hit one scale by accident: e_n of their chances (an upper bound)
  const e = new Float64Array(perDim.length + 1);
  e[0] = 1;
  for (const pd of perDim) for (let k = perDim.length; k >= 1; k--) e[k] += e[k - 1] * pd.chance;
  const detail = `${n} av ${perDim.length} mål stemmer: ${best.matched
    .slice(0, 6)
    .map((m) => `«${m.pd.d.text ?? m.pd.d.value}» (${m.c.how})`)
    .join(', ')}${n > 6 ? ' …' : ''}`;
  return { method: 'dimensions', pxPerM: v, weight: 0, detail, n, spread, chance: e[n], window: 2 * Math.log(lim) };
}

/**
 * The dimensions' weight and confidence from their chance (see the top of the file): the number of scales the window
 * holds, narrowed by a layer that does not use the dimensions and agrees (areas, paper without the dimensions, a sure
 * level of the same source: ±3 %; 3+ doors: ±6 %), times e_n.
 */
function judgeDimensions(dims, checks) {
  let window = dims.window;
  for (const c of checks) if (c && c.p > 0 && relDiff(dims.pxPerM, c.p) <= c.tol) window = Math.min(window, 2 * c.tol);
  const P = Math.max(1, window / (2 * DIM_TOL)) * dims.chance;
  const conf = dims.n >= 2 && P < 0.01 ? 'high' : P < 0.2 ? 'medium' : 'low';
  // low: no better than chance – near 1 it says less than the provisional scale (0.15)
  const weight = conf === 'high' ? (dims.n >= 3 ? 1 : 0.92) : conf === 'medium' ? 0.6 : Math.max(0.02, 0.25 * (1 - Math.min(1, P)));
  const p = P < 1e-4 ? '< 0,01' : fmt(Math.min(1, P) * 100, P < 0.01 ? 2 : 0);
  return { ...dims, weight, conf, pChance: P, detail: `${dims.detail}; tilfeldig samsvar ${p} %` };
}

/**
 * The page in px, along the page's own width and height ({ w, h }), and its size in mm (or null): from pdfPage.widthPx /
 * heightPx when the image is a crop of the rendered page; else the image itself when it has the page's aspect (maybe
 * turned); without a PDF the image is taken as the whole sheet. null: a crop of a PDF page of unknown px size.
 */
function pageOf(img, pdfPage) {
  const pg = pdfPage || {};
  const mm = pg.widthPt > 0 && pg.heightPt > 0 ? { w: (pg.widthPt * 25.4) / 72, h: (pg.heightPt * 25.4) / 72 } : null;
  const crop = pg.widthPx > 0 || pg.heightPx > 0;
  if (crop) {
    const asp = mm ? mm.w / mm.h : null;
    const w = pg.widthPx > 0 ? pg.widthPx : asp ? pg.heightPx * asp : null;
    const h = pg.heightPx > 0 ? pg.heightPx : asp ? pg.widthPx / asp : null;
    return w > 0 && h > 0 ? { px: { w, h }, mm, crop: true } : null;
  }
  if (!mm) return { px: { w: img.width, h: img.height }, mm: null, crop: false };
  const aImg = img.width / img.height;
  const ap = mm.w / mm.h;
  if (relDiff(aImg, ap) < 0.02) return { px: { w: img.width, h: img.height }, mm, crop: false };
  if (relDiff(aImg, 1 / ap) < 0.02) return { px: { w: img.height, h: img.width }, mm, crop: false }; // turned a quarter
  return null;
}

/** paper: «1:N» and the paper size (the PDF page, or the ISO A sizes with the page's aspect). */
function paperLayer({ img, ai, pdfPage }, prior, priorTight) {
  const N = parseScaleText(ai?.scaleText) ?? parseScaleText(ai?.levelTitle) ?? parseScaleText(ai?.notes);
  if (!N) return null;
  // a crop (sheet.js) of a page whose px size is not given cannot be put on the paper: its width is not the page's
  const page = pageOf(img, pdfPage);
  if (!page) return null;
  const pxLong = Math.max(page.px.w, page.px.h);
  const pxShort = Math.min(page.px.w, page.px.h);
  const cands = [];
  const roundDpi = (pxmm) => ROUND_DPI.some((d) => relDiff(pxmm * 25.4, d) < 0.006);
  const isoName = (longMm, shortMm) =>
    Object.entries(ISO_A).find(([, [s, l]]) => relDiff(longMm, l) < 0.015 && (!shortMm || relDiff(shortMm, s) < 0.015))?.[0] ?? null;
  const where = page.crop ? ', utsnitt av siden' : '';
  let pageAspect = pxLong / pxShort;
  if (page.mm) {
    // px per mm along the page width
    const pxmm = page.px.w / page.mm.w;
    const longMm = Math.max(page.mm.w, page.mm.h);
    const shortMm = Math.min(page.mm.w, page.mm.h);
    pageAspect = longMm / shortMm;
    const iso = isoName(longMm, shortMm);
    let w = iso ? 0.9 : 0.55;
    if (roundDpi(pxmm)) w += 0.1;
    cands.push({ p: (pxmm * 1000) / N, w, pdf: true, iso: !!iso, detail: `1:${N}, PDF-siden ${fmt(longMm, 0)} × ${fmt(shortMm, 0)} mm${iso ? ` (${iso})` : ' (ingen standardstørrelse)'}, ${fmt(pxmm * 25.4, 0)} dpi${where}` });
  }
  // the ISO A sizes when the page has their aspect – a scan, or a page embedded at another dpi
  if (Math.abs(pageAspect / Math.SQRT2 - 1) < 0.02 || Math.abs(pxLong / pxShort / Math.SQRT2 - 1) < 0.02) {
    for (const [name, [, l]] of Object.entries(ISO_A)) {
      const pxmm = pxLong / l;
      const p = (pxmm * 1000) / N;
      if (cands.some((c) => relDiff(c.p, p) < 0.01)) continue;
      let w = page.mm ? 0.5 : 0.45;
      if (roundDpi(pxmm)) w += 0.1;
      if (name === 'A3' || name === 'A4') w += 0.05;
      cands.push({ p, w, detail: `1:${N} på ${name} (${fmt(pxmm * 25.4, 0)} dpi)${where}` });
    }
  }
  if (!cands.length) return null;
  // the prior chooses among the paper sizes: tight when it is measured (dimensions, areas); loose (standard sizes, which
  // can be 80 % off on a crop) it only chooses among the guessed ISO sizes – the PDF page stands
  const g = (c) => {
    if (!(prior > 0)) return 1;
    const r = Math.abs(Math.log(c.p / prior));
    if (priorTight) return r <= Math.log(1.08) ? 1 : r <= Math.log(1.3) ? 0.5 : 0.2;
    if (c.pdf) return 1;
    return r <= Math.log(2) ? 1 : 0.4;
  };
  const scored = cands.map((c) => ({ ...c, g: g(c), score: c.w * g(c) })).sort((a, b) => b.score - a.score);
  const top = scored[0];
  return {
    method: 'paper',
    pxPerM: top.p,
    weight: top.w,
    detail: top.detail,
    n: 1,
    spread: null,
    sure: !!top.iso || (priorTight && top.g === 1),
    others: scored.slice(1).map((c) => ({ method: 'paper', pxPerM: c.p, weight: Math.min(c.w, 0.3), detail: c.detail })),
  };
}

/**
 * The inner footprint of a level in px²: the rooms and the interior walls, inside the exterior walls – the floor BRA
 * measures. From findRooms' raster: wall cells reached from the outside within the exterior wall thickness are the
 * exterior walls; the rest of the not-outside cells count, in the largest connected part (the house, not a garage).
 */
function innerFootprintPx2(det0, rooms0, ppm0) {
  const R = rooms0?.raster;
  if (!R || typeof rooms0.at !== 'function' || !roomList(rooms0).length) return null;
  const { w, h, x0, y0, res, labels } = R;
  const cls = new Int8Array(w * h); // 0 outside, 1 wall, 2 room
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (labels[k] === -2) cls[k] = 1;
      else cls[k] = rooms0.at(x0 + (i + 0.5) * res, y0 + (j + 0.5) * res) >= 0 ? 2 : 0;
    }
  }
  const ext = (det0?.walls || []).filter((wl) => wl.exterior).map((wl) => wl.t / ppm0);
  const tExt = ext.length ? median(ext) : 0.25;
  const depth = Math.max(1, Math.round(tExt / res) + 1);
  // BFS from the outside into the wall cells, up to the exterior wall thickness
  const dist = new Int32Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  for (let k = 0; k < w * h; k++) {
    if (cls[k] === 0) {
      dist[k] = 0;
      q[qt++] = k;
    }
  }
  while (qh < qt) {
    const k = q[qh++];
    if (dist[k] >= depth) continue;
    const i = k % w;
    for (const nb of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, k >= w ? k - w : -1, k + w < w * h ? k + w : -1]) {
      if (nb < 0 || dist[nb] >= 0 || cls[nb] !== 1) continue;
      dist[nb] = dist[k] + 1;
      q[qt++] = nb;
    }
  }
  // the inner cells, and of them only the largest connected part: the house, not a garage drawn beside it
  const inner = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (cls[k] === 2 || (cls[k] === 1 && dist[k] < 0)) inner[k] = 1;
  const seen = new Uint8Array(w * h);
  let cells = 0;
  for (let s = 0; s < w * h; s++) {
    if (!inner[s] || seen[s]) continue;
    let n = 0;
    qh = 0;
    qt = 0;
    q[qt++] = s;
    seen[s] = 1;
    while (qh < qt) {
      const k = q[qh++];
      n++;
      const i = k % w;
      for (const nb of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, k >= w ? k - w : -1, k + w < w * h ? k + w : -1]) {
        if (nb < 0 || seen[nb] || !inner[nb]) continue;
        seen[nb] = 1;
        q[qt++] = nb;
      }
    }
    cells = Math.max(cells, n);
  }
  const pxPerCell = res * ppm0;
  return cells * pxPerCell * pxPerCell;
}

/** The inner footprint (what BRA measures) in m² at ppm0, or null without closed rooms – the default of a BRA question. */
export function innerArea(det0, rooms0, ppm0) {
  const px2 = ppm0 > 0 ? innerFootprintPx2(det0, rooms0, ppm0) : null;
  return px2 > 0 ? px2 / ppm0 / ppm0 : null;
}

function braLayer({ det0, rooms0, ppm0, bra }) {
  const b = num(bra);
  if (!(b > 5) || !(ppm0 > 0)) return null;
  const px2 = innerFootprintPx2(det0, rooms0, ppm0);
  if (!(px2 > 0)) return null;
  const p = Math.sqrt(px2 / b);
  return { method: 'bra', pxPerM: p, weight: 0.45, detail: `BRA ${fmt(b)} m² mot innvendig fotavtrykk (${fmt(px2 / ppm0 / ppm0)} m² ved foreløpig skala)`, n: 1, spread: null };
}

function standardLayer({ det0, ppm0 }) {
  const out = [];
  const dc = doorCluster(det0);
  if (dc.n >= 2) {
    out.push({
      method: 'standard',
      pxPerM: dc.px / DOOR_HOLE,
      weight: dc.n >= 3 ? 0.3 : 0.2,
      detail: `${dc.n} dører, medianen av døråpningene = ${fmt(DOOR_HOLE * 100, 0)} cm`,
      n: dc.n,
      spread: null,
    });
  }
  const t = thinWallPx(det0, ppm0 > 0 ? ppm0 : 50);
  if (t > 0) out.push({ method: 'standard', pxPerM: t / THIN_WALL, weight: 0.12, detail: `tynneste innervegg ${fmt(t)} px = ${THIN_WALL * 100} cm`, n: 1, spread: null });
  // the provisional scale itself: a wall thickness of its own detection does not overrule it (that throws away what found
  // it – hus4's loft fell from 50 to 8 px/m in three passes of autoScale)
  if (ppm0 > 0) out.push({ method: 'standard', pxPerM: ppm0, weight: 0.15, detail: 'den foreløpige skalaen', n: 0, spread: null });
  return out;
}

/**
 * sameSource: the scale of another level of the same drawing set, checked against the outlines. A 1½-storey house (or
 * any two floors) shares its exterior walls, so the outlines should be the same in px:
 *   both axes within 1.2 %        the same zoom: inherited as it is, at the other level's confidence
 *   both axes off by one factor   drawn at another zoom (hus1's loft: 0.965 in an image of the same height): the scale
 *                                 times that factor, one step less sure
 *   otherwise                     another footprint (a basement without the garage, a set-back storey) or a broken
 *                                 detection: inherited as it is, one step less sure
 */
function sameSourceLayer({ sameSource }, outline) {
  const W = { high: 0.78, medium: 0.55, low: 0.25 };
  return (sameSource || [])
    .filter((r) => r && r.pxPerM > 0)
    .map((r) => {
      let p = r.pxPerM;
      let conf = LEVELS.includes(r.confidence) ? r.confidence : 'low';
      let how;
      const o = r.outline;
      if (o && outline && o.w > 0 && o.h > 0) {
        const rx = outline.w / o.w;
        const ry = outline.h / o.h;
        const k = Math.sqrt(rx * ry);
        const pct = (v) => `${fmt(v * 100)} %`;
        if (Math.abs(rx - 1) <= OUTLINE_SAME && Math.abs(ry - 1) <= OUTLINE_SAME) how = `samme omriss (${pct(rx)} × ${pct(ry)})`;
        else if (relDiff(rx, ry) <= OUTLINE_UNIFORM && k > 0.75 && k < 1.33) {
          p *= k;
          conf = down(conf);
          how = `omrisset er ${pct(rx)} × ${pct(ry)} av den andre etasjens: tegnet i en annen målestokk, skalaen × ${fmt(k, 3)}`;
        } else {
          conf = down(conf);
          how = `et annet omriss (${pct(rx)} × ${pct(ry)}): samme målestokk antatt`;
        }
      } else {
        conf = down(conf);
        how = 'omrisset kan ikke sammenlignes: samme målestokk antatt';
      }
      return {
        method: 'sameSource',
        pxPerM: p,
        weight: W[conf],
        detail: `samme kilde: ${r.method} ${fmt(r.pxPerM, 2)} (${r.confidence}), ${how}`,
        n: r.n ?? 1,
        spread: r.spread ?? null,
        confidence: conf,
        source: r,
      };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The layers together

export function estimateScale(input) {
  const { img, ppm0, ai = null } = input;
  if (!img || !(img.width > 0)) throw new Error('estimateScale: bildet mangler');
  const grey = ai?.dimensions?.length ? luma(img) : null;

  const outline = outlineOf(input.det0, input.rooms0, ppm0);
  const areas = areasLayer(input);
  const standard = standardLayer(input);
  const same = sameSourceLayer(input, outline);
  // the prior for choosing among readings: the areas when they are clear; else (loosely) a sure level of the same
  // source, the doors of this detection, the provisional scale
  const areasPrior = areas && areas.n >= 2 && !areas.loft ? areas.pxPerM : null;
  const doors = standard.find((l) => l.weight >= 0.2);
  const sureSameP = same.find((l) => l.confidence === 'high')?.pxPerM ?? null;
  const loosePrior = sureSameP ?? doors?.pxPerM ?? ppm0;
  // a scale far from the prior is not a reading of this plan: 1.5× from the areas, 2.5× from doors or a sure level of
  // the same source, 5× from a provisional scale that only walls gave (hus7's crop: 25 px/m for 117)
  const lim = areasPrior != null ? 1.5 : sureSameP != null || doors ? 2.5 : 5;
  let dims = grey ? dimensionsLayer(input, grey, areasPrior ?? loosePrior, lim) : null;
  if (dims) {
    // the layers that do not use the dimensions, to test their agreement against chance
    const paperFree = paperLayer(input, areasPrior ?? loosePrior, areasPrior != null);
    const sureSame = same.find((l) => l.confidence === 'high');
    dims = judgeDimensions(dims, [
      areasPrior != null && !(areas.spread > 0.04) ? { p: areasPrior, tol: 0.03 } : null,
      paperFree ? { p: paperFree.pxPerM, tol: 0.03 } : null,
      sureSame ? { p: sureSame.pxPerM, tol: 0.03 } : null,
      doors && doors.n >= 3 ? { p: doors.pxPerM, tol: 0.06 } : null,
    ]);
  }
  const tightPrior = dims && dims.conf === 'high' ? dims.pxPerM : areasPrior;
  const paper = paperLayer(input, tightPrior ?? loosePrior, tightPrior != null);
  const bra = braLayer(input);

  const layers = [dims, paper, areas, ...same, bra, ...standard].filter((l) => l && l.pxPerM > 0 && Number.isFinite(l.pxPerM));
  const candidates = [
    ...layers.map((l) => ({ method: l.method, pxPerM: l.pxPerM, weight: Math.round(l.weight * 1000) / 1000, detail: l.detail })),
    ...(paper?.others || []),
  ];
  if (!layers.length) return { pxPerM: ppm0 > 0 ? ppm0 : null, method: 'standard', spread: null, n: 0, confidence: 'low', candidates, outline };

  const win = [...layers].sort((a, b) => b.weight - a.weight || ORDER.indexOf(a.method) - ORDER.indexOf(b.method))[0];

  // the winner's own confidence
  let conf;
  switch (win.method) {
    case 'dimensions':
      conf = win.conf;
      break;
    case 'paper':
      conf = paper.sure ? 'high' : 'medium';
      break;
    case 'areas':
      conf = win.n >= 3 && !(win.spread > 0.04) && !win.loft ? 'high' : win.n >= 2 && !(win.spread > 0.06) ? 'medium' : 'low';
      break;
    case 'sameSource':
      conf = win.confidence || 'low';
      break;
    case 'bra':
      conf = 'medium';
      break;
    default:
      conf = 'low';
  }
  // the others check it: one step down when one of them disagrees
  const best = new Map();
  for (const l of layers) if (l !== win && (!best.has(l.method) || l.weight > best.get(l.method).weight)) best.set(l.method, l);
  let disagree = false;
  for (const l of best.values()) {
    if (l.method === win.method) continue;
    if (l.method === 'standard' && l.weight < 0.2) continue; // a wall thickness alone checks nothing
    if (l.method === 'areas' && l.loft && l.pxPerM > win.pxPerM) continue; // a loft's labels are smaller than its floor
    if (l.method === 'paper' && !paper.sure && relDiff(l.pxPerM, win.pxPerM) > 0.3) continue; // a guessed paper size
    if (l.method === 'dimensions' && l.conf === 'low') continue; // dimensions that agree no better than chance
    if (l.method === 'areas' && l.n < 2) continue; // one room may be a merged polygon: nothing to check it by
    // areas whose rooms disagree with each other check only as well as they agree
    // and the doors as well as their number allows: ±3 % on the test plans with 3+ doors, ±15 % with 2
    let tol = AGREE[l.method] ?? 0.03;
    if (l.method === 'areas' && l.spread > 0) tol = Math.max(AGREE.areas, 1.5 * l.spread);
    if (l.method === 'standard') tol = l.n >= 4 ? 0.05 : l.n === 3 ? 0.08 : AGREE.standard;
    if (relDiff(l.pxPerM, win.pxPerM) > tol) disagree = true;
  }
  if (disagree) conf = down(conf);
  return { pxPerM: win.pxPerM, method: win.method, spread: win.spread ?? null, n: win.n ?? 1, confidence: conf, candidates, outline };
}

/**
 * The scale step for one plan (see the top of the file): the provisional scale, the detection and the rooms there, the
 * layers – and once more at the estimate while a reading (not the standard sizes alone) moves it by more than 4 %. The
 * last pass is returned with its detection; the first reuses the ordinary detection standardScale ran.
 * @returns {{ result, ppm0: number, det, rooms, passes: number } | null}
 */
export function autoScale(img, { ai = null, detect = detectPlan, ppm0 = null, pdfPage, bra, sameSource, maxPasses = 3 } = {}) {
  // the provisional scale: given; else a surer level of the same set (its outline is checked in estimateScale); else
  // the standard sizes
  const sibling = (sameSource || []).find((r) => r && r.pxPerM > 0 && (r.confidence === 'high' || r.confidence === 'medium'));
  const std = ppm0 > 0 || sibling ? null : standardScale(img, { detect });
  let p0 = ppm0 > 0 ? ppm0 : sibling ? sibling.pxPerM : std?.pxPerM;
  if (!(p0 > 0)) return null;
  // the ordinary detection standardScale already ran (within a few % of its result): the first pass starts there
  let reuse = std?.det ?? null;
  if (reuse) p0 = reuse.pxPerM;
  let last = null;
  for (let pass = 1; pass <= maxPasses; pass++) {
    let det;
    let rooms;
    try {
      det = reuse ? reuse.det : detect(img, { pxPerM: p0 });
      // the rooms with the detection's separators (an open plan's zones: hus4's TV room) and islands cut out
      rooms = levelRooms(applyDetection({}, det, p0));
    } catch (e) {
      // a scale so far off that the detection or the room search gives up (findRooms: «planen er for stor»): the last
      // pass stands; on the first, the layers that need no rooms still speak
      if (last) break;
      det = det || { walls: [], openings: [] };
      rooms = { rooms: [], at: () => -1, raster: null };
    }
    reuse = null;
    const result = estimateScale({ img, det0: det, rooms0: rooms, ppm0: p0, ai, pdfPage, bra, sameSource });
    last = { result, ppm0: p0, det, rooms, passes: pass };
    // again only when a layer that says something moved it (weight ≥ 0.3: a reading, or 3+ doors) – a wall thickness,
    // 2 doors or dimensions at chance level have nothing better to converge on
    const winW = Math.max(0, ...result.candidates.filter((c) => c.method === result.method && c.pxPerM === result.pxPerM).map((c) => c.weight));
    if (!(result.pxPerM > 0) || relDiff(result.pxPerM, p0) <= 0.04 || winW < 0.3) break;
    p0 = result.pxPerM;
  }
  return last;
}
