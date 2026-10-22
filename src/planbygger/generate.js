/**
 * Planbygger: «Generer» – all of a customer's drawings (plans, facades, a sheet with several, a phone photo, a PDF
 * page) → a plan document with its levels in order, scaled, with named rooms, door variants, skylights, a stair and
 * window heights, plus the few questions it could not answer itself (notes/planbygger-runde1-design.md, «generate.js –
 * flyten»). The AI reads text and symbols; every length and position comes from the classical modules.
 *
 *   generate(inputs, opts) → Promise<{ doc, questions, report, images }>
 *     inputs   [{ name, img, pdfPage?, focal?, kind?, level? }]   img RGBA { width, height, data }; pdfPage { widthPt, heightPt,
 *              widthPx?, heightPx? } of a rendered PDF page (widthPx / heightPx: the page as rendered, = img's size);
 *              focal: a photo's EXIF FocalLengthIn35mmFilm / 43.27 (photo.js rectifyPhoto); kind ('plan'|'facade') and
 *              level (an integer, 0 = the main level) are the customer's choices in the page's drawing stack (stack.js):
 *              the kind of a file that is one drawing, and its floor before its file name
 *     opts.ai  { read(task, payload) → Promise<answer | null> } or null (no AI: everything still works, with more
 *              questions). In the browser { read: (task, p) => aiRead(task, p) } (ai.js); in Node the recorded answers
 *              (tools/planbygger-ai-fixtures.mjs). payload = { image, marks, unmarked, hints, source }: source = { file,
 *              part, width, height, bbox, photo } says where `image` lies in the upload (aiRead ignores it)
 *     opts.exec(name, ...args)   the heavy steps, so the page can run them in its worker: 'rectifyPhoto', 'splitSheet',
 *              'cleanForWalls', 'detectPlan', 'autoScale', 'readFacade', 'findStairs' with the modules' own arguments
 *              (plain data only; may return a promise). Default: the functions called directly
 *     opts.aiConcurrency   how many AI answers are waited for at once (default 3, as the server runs them; a recording
 *              transport that sets the page's AI transport per call wants 1)
 *     opts.onProgress({ step, text, done, total })   Norwegian text per step
 *     opts.bra       { [file name]: m² } BRA per plan, when the customer knows it
 *     opts.answers   { [question id]: value } from an earlier run: given scales (scale, bra) and the chosen alternative
 *              drawing are used as inputs instead of being estimated; the rest goes through applyAnswers at the end
 *     opts.detect    another detector for the direct executor (tests)
 *   → doc        model.js document; level.image = { name, width, height, pxPerM, scaleFrom, source }, level.generated
 *                (order, scale, counts), doc.roof, doc.generated (requests, notes, floorHeight)
 *     questions  questions.js shape, with crops in images' px
 *     report     { steps: [{ step, file, level, method, confidence, detail, ms }], notes: [Norwegian], requests,
 *                  ai: [{ task, file, ok, ms }], ms }
 *     images     { [level id]: { img, file, bbox, rectified } }   the image each level was detected on (the editor shows it)
 *
 *   applyAnswers(doc, questions, answers) → doc   (questions.js, re-exported)
 *
 * The steps:
 *   1. every input through rectifyPhoto (it declines digital drawings itself); a photo it is unsure of → a question
 *      for a new photo, a cut-off sheet → a question about the shape
 *   2. a sheet with several drawings (splitSheet) is cut into them (cropImage); the AI's classify answer decides
 *      facade vs section, and gives titles, level names and «detached» (a garage beside the house)
 *   3. plans: the same drawing in two files is used once (the one alone on its sheet), unless the two names say two
 *      floors (floors drawn alike); a small plan beside the house on a sheet, or one the AI calls detached, is left out
 *      when there are others; «…-alternativ» is an alternative
 *   4. per plan: the provisional scale (autoScale without AI, or a surer level of the same drawing set: one sheet, or
 *      similarSource) → marks (drawMarks, the unmarked passed on) → readPlan → estimateScale with that answer (pdfPage,
 *      BRA, sameSource with the other levels' full results; a looser set – other image sizes, the same style – only
 *      where the outlines agree), and autoScale again at the estimate when it moved → detectPlan at the final scale
 *      with clean: true → the semantics: room names and kinds (AI positions in the found rooms), door variants (the AI
 *      wins where the classical variant is the weaker one), skylights (detected, plus the AI's), stair symbols.
 *      A level left without walls or rooms at an inherited scale is measured again alone; one still empty tries other
 *      readings of its walls (without the cleaner; outlines filled and an open side closed; the provisional ones), and
 *      is asked about (questions.js wallsQuestion). Plans of different drawing sets are measured side by side, so
 *      their AI answers come together
 *   5. the floor order: file names, then titles (AI), then content (entrance and kitchen → main level, skylights →
 *      top, basement words → bottom)
 *   6. levels on top of each other (alignLevelTo with the plan images); a stair where both floors show it (addStair;
 *      half-turn → 'u', quarter-turn → the nearest kind the house format has, with a note and a request)
 *   7. facades (readFacade; one sheet shares the scale of its surest door reading): the roof (houseRoof), sill and
 *      height per storey → the windows of that level; without facades, per room kind
 *   8. the questions (questions.js)
 */
import { rectifyPhoto, isPhoto } from './photo.js';
import { splitSheet, cropImage } from './sheet.js';
import { cleanForWalls } from './clean.js';
import { detectPlan } from './detect.js';
import { autoScale, estimateScale, similarSource, innerArea, wallModes } from './autoscale.js';
import { readFacade, houseRoof } from './facade.js';
import { findStairs, alignLevelTo } from './align.js';
import { drawMarks, targetsFromLevel } from './marks.js';
import { findRooms } from './regions.js';
import { roomKindOf } from './ai.js';
import { luma } from './image.js';
import { guessKind, exportHouse, baseSpec, ownerOnly } from './export.js';
import { createDoc, applyDetection, addStair, addWall, setOpeningKind, wallById, wallPoint, DEFAULT_SETTINGS } from './model.js';
import { clipPolygon, signedArea, dist, round, pointInPolygon } from './geom.js';
import {
  applyAnswers,
  windowsPerStorey,
  setWindowHeights,
  scaleQuestion,
  braQuestion,
  ceilingQuestion,
  windowsQuestion,
  roomQuestion,
  stairQuestion,
  orderQuestion,
  alternativeQuestion,
  photoQuestion,
  shapeQuestion,
  facadeQuestion,
  wallsQuestion,
} from './questions.js';

export { applyAnswers };

export const GENERATE_DEFAULTS = Object.freeze({
  /** floor to floor, metres (ceiling 2.4 + slab 0.3) */
  floorHeight: 2.7,
  /** a plan on a sheet smaller than this share of the sheet's largest plan is a building beside the house */
  companionShare: 0.3,
  /** two plan crops are the same drawing when their sizes agree within this and their thumbnails within dupGrey */
  dupSize: 0.04,
  dupGrey: 14,
  /** an AI opening is about one of ours when its point is within max(this, half the opening's width), metres */
  openingTol: 0.4,
  /** a skylight the AI saw and the detection did not: a roof window of this size (m) at its point */
  skylight: [0.78, 1.18],
  /** a facade or section block under this share of a plan's block on the same sheet is not a drawing */
  sideDrawing: 0.15,
  /** rooms smaller than this (m²) get no question */
  roomQuestionMin: 2,
  /** the estimate moved more than this from the provisional scale: autoScale again there */
  rescan: 0.04,
});

/** Default window sill / height per room kind, metres, when there are no facades. */
const WINDOW_BY_KIND = {
  bathroom: { sill: 1.2, height: 0.8 },
  laundry: { sill: 1.1, height: 0.9 },
  storage: { sill: 1.2, height: 0.6 },
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const relDiff = (a, b) => Math.abs(a / b - 1);
const fmt = (v, d = 1) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',') : '–');
const DRAWING_KINDS = new Set(['plan', 'facade', 'section']);
const NOT_A_ROOM = /brutto|\bbta\b|\bbra\b|p-rom|s-rom|totalt|\bsum\b|tomt|bebygd|åpent opp|apent opp/i;
const OUTDOOR = new Set(['terrace', 'balcony', 'carport', 'garage']);

/** The functions the default executor calls. */
const DIRECT = { rectifyPhoto, splitSheet, cleanForWalls, detectPlan, autoScale, readFacade, findStairs };

// ---------------------------------------------------------------------------------------------------------------
// Names, titles and levels

const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a');

/**
 * What a file name or a title says about the level: { level: n | null, tag: 'basement'|'upper'|'loft'|null, why }.
 * «1etg», «2. etasje», «Etasje 1», «plan-1etg-tilbygg» → 0 / 1; «kjeller», «underetasje», «Under etg», «sokkel» → −1;
 * «øvre», «overetasje» → above the basement; «loft» → the top.
 */
export function levelWords(text) {
  const s = fold(text).replace(/[_]+/g, ' ');
  if (!s.trim()) return { level: null, tag: null };
  if (/kjeller|underetasje|under ?etg|under ?etasje|u\.? ?etg|sokkel/.test(s)) return { level: -1, tag: 'basement' };
  const n = s.match(/(?:^|[^0-9])([1-9])\s*[.-]?\s*(?:etg|etasje|etage|et\b)/) ?? s.match(/(?:etg|etasje|etage|plan)\s*[.-]?\s*([1-9])(?![0-9])/);
  if (n) return { level: Number(n[1]) - 1, tag: null };
  if (/loft/.test(s)) return { level: null, tag: 'loft' };
  if (/ovre|overetasje|over etg|hovedetasje|hovedplan|inngangsplan/.test(s)) return { level: /hoved|inngang/.test(s) ? 0 : null, tag: 'upper' };
  return { level: null, tag: null };
}

/** The level a classify drawing names (an integer, or its level name). */
function classifyLevel(d) {
  if (!d) return { level: null, tag: null };
  if (Number.isInteger(d.level) && !d.detached) return { level: d.level, tag: d.level < 0 ? 'basement' : null, why: `KI: ${d.levelName ?? `nivå ${d.level}`}` };
  return levelWords(d.levelName ?? d.title ?? '');
}

/** The level's display name. */
function levelName(n, tag, words) {
  const s = fold(words);
  if (n < 0) return /underetasje|under ?etg|under ?etasje/.test(s) ? 'Underetasje' : n === -1 ? 'Kjeller' : `${-n}. kjeller`;
  if (tag === 'upper' && /ovre/.test(s)) return 'Øvre etasje';
  if (tag === 'loft' || /loft/.test(s)) return 'Loft';
  return `${n + 1}. etasje`;
}

/** A level's id: the main level 'hoved' (export.js), then «etasje-2», «kjeller», … */
const levelId = (n) => (n === 0 ? 'hoved' : n > 0 ? `etasje-${n + 1}` : n === -1 ? 'kjeller' : `kjeller-${-n}`);

/** «KJØKKEN/STUE» → «Kjøkken/stue»; short tokens (WC, TV, VF) stay as they are; mixed case is kept. */
export function displayName(name) {
  const s = (name ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  let first = true;
  return s.replace(/[\p{L}]+/gu, (w) => {
    const out = w.length <= 2 ? w : first ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase();
    first = false;
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

/** A grey thumbnail of an image's ink box (long side n) for comparing two drawings. */
function thumbnail(img, n = 48) {
  const g = luma(img);
  let x0 = g.w;
  let y0 = g.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.data[y * g.w + x] < 160) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const k = n / Math.max(bw, bh);
  const tw = Math.max(1, Math.round(bw * k));
  const th = Math.max(1, Math.round(bh * k));
  const sum = new Float64Array(tw * th);
  const cnt = new Float64Array(tw * th);
  for (let y = y0; y <= y1; y++) {
    const ty = Math.min(th - 1, Math.floor((y - y0) * k));
    for (let x = x0; x <= x1; x++) {
      const t = ty * tw + Math.min(tw - 1, Math.floor((x - x0) * k));
      sum[t] += g.data[y * g.w + x];
      cnt[t]++;
    }
  }
  const data = new Float64Array(tw * th);
  for (let i = 0; i < data.length; i++) data[i] = cnt[i] ? sum[i] / cnt[i] : 255;
  return { w: tw, h: th, bw, bh, data };
}

/** Whether two RGBA buffers differ anywhere. */
function differs(a, b) {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/** Mean grey difference of two thumbnails of the same shape, or Infinity. */
function thumbDiff(a, b, sizeTol) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return Infinity;
  if (relDiff(a.bw, b.bw) > sizeTol || relDiff(a.bh, b.bh) > sizeTol) return Infinity;
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / a.data.length;
}

const iou = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
};

/** The room index at plan point p, looking around it (a label on a wall line, a mark in a doorway). */
function roomAt(found, p, r = 0.35) {
  const i = found.at(p[0], p[1]);
  if (i >= 0) return i;
  for (const d of [0.1, 0.2, r]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const j = found.at(p[0] + d * Math.cos(a), p[1] + d * Math.sin(a));
      if (j >= 0) return j;
    }
  }
  return -1;
}

const openingCentre = (level, o) => {
  const w = wallById(level, o.wall);
  return w ? wallPoint(w, o.at) : null;
};

/**
 * Two plans from one drawing set, whose scales may be passed on (sameSource): two drawings cut from one sheet, or
 * similarSource (autoscale.js: the same image size and a wall thickness in common). Files of the same type that only
 * share a wall thickness are not enough – hus9's two floors (713 × 485 and 766 × 518 px, both with 6 px partitions) are
 * drawn at 45 and 54 px/m, and the main level inherited the basement's scale (+17 %) and lost its walls. estimateScale
 * compares the outlines before it inherits, and generate asks when they do not agree (outlineAgrees).
 */
function sameSet(a, b) {
  if (a.input === b.input && a.part != null && b.part != null) return true;
  return similarSource(a.img, b.img);
}

/**
 * Two plans that may be of one drawing set although their images differ in size (hus3: 701 × 1001 and 440 × 925, at
 * 47.9 and 47.7 px/m): the same file type and a wall thickness in common (3 px or more, ±1 px or ±10 %). Their scales
 * are passed on only where the outlines confirm it (outlineMatch), never as the provisional scale.
 */
function looseSet(a, b) {
  const ext = (f) => (f.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (ext(a.file) !== ext(b.file)) return false;
  const modes = (d) => (d.wallModes ??= wallModes(d.img).filter((m) => m.px >= 3 && m.share >= 0.1));
  const ma = modes(a);
  const mb = modes(b);
  return ma.some((x) => mb.some((y) => Math.abs(x.px - y.px) <= Math.max(1, 0.1 * Math.max(x.px, y.px))));
}

/**
 * Two outlines (w × h px) of one house: the same within 1.2 % per axis (→ 1), or one zoom factor on both axes within
 * 1 % (→ that factor, 0.75–1.33: hus1's loft 0.965) – else null (another footprint, or a detection that broke).
 */
function outlineMatch(o, s) {
  if (!(o?.w > 0 && o?.h > 0 && s?.w > 0 && s?.h > 0)) return null;
  const rx = o.w / s.w;
  const ry = o.h / s.h;
  if (Math.abs(rx - 1) <= 0.012 && Math.abs(ry - 1) <= 0.012) return 1;
  const k = Math.sqrt(rx * ry);
  return relDiff(rx, ry) <= 0.01 && k > 0.75 && k < 1.33 ? k : null;
}

/**
 * Whether an inherited scale (estimateScale's winner 'sameSource') was checked by the outlines: this level's outline
 * against the source level's, the same within 1.2 % per axis or one zoom factor on both (autoscale.js sameSourceLayer).
 * An outline that differs (another footprint, or a detection that broke at the inherited scale) is an unchecked guess.
 */
function outlineAgrees(scale, same) {
  return (same || []).some((r) => {
    const k = outlineMatch(scale?.outline, r?.outline);
    return k != null && Math.abs((r.pxPerM * k) / scale.pxPerM - 1) <= 0.01;
  });
}

/** The px box of a polygon in metres, padded, inside the image. */
function cropBox(points, ppm, img, pad = 0.6) {
  if (!points?.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    Math.max(0, Math.floor((Math.min(...xs) - pad) * ppm)),
    Math.max(0, Math.floor((Math.min(...ys) - pad) * ppm)),
    Math.min(img.width, Math.ceil((Math.max(...xs) + pad) * ppm)),
    Math.min(img.height, Math.ceil((Math.max(...ys) + pad) * ppm)),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The flow

/**
 * See the top of the file.
 * @param {{ name: string, img: { width: number, height: number, data: Uint8ClampedArray }, pdfPage?: object }[]} inputs
 * @param {object} [opts]
 */
export async function generate(inputs, opts = {}) {
  const T0 = now();
  const o = { ...GENERATE_DEFAULTS, ...(opts.defaults || {}) };
  const direct = opts.detect ? { ...DIRECT, detectPlan: opts.detect, autoScale: (img, a) => autoScale(img, { ...a, detect: opts.detect }) } : DIRECT;
  const exec = opts.exec ?? ((name, ...args) => direct[name](...args));
  const run = async (name, ...args) => exec(name, ...args);
  const answers = opts.answers || {};
  const report = { steps: [], notes: [], requests: [], ai: [], ms: 0 };
  const questions = [];
  const images = {};
  const step = (s) => {
    const entry = { file: null, level: null, method: null, confidence: null, detail: null, ...s };
    report.steps.push(entry);
    return entry;
  };
  let progressDone = 0;
  const progress = (stepName, text, total) => {
    progressDone++;
    try {
      opts.onProgress?.({ step: stepName, text, done: progressDone, total: Math.max(total, progressDone) });
    } catch {
      /* the page's progress bar must not stop the flow */
    }
  };
  // the AI's answers are waited for side by side, at most aiConcurrency at a time (the server runs 3 at once and queues
  // the rest; a recording transport wants 1): every sheet's classify while the next sheets are split, the facades
  // while the plans are measured, and the plans of different drawing sets at the same time
  const aiLimit = Math.max(1, Math.floor(opts.aiConcurrency ?? 3));
  let aiBusy = 0;
  const aiWaiting = [];
  const askAi = async (task, payload) => {
    if (!opts.ai?.read) return null;
    if (aiBusy < aiLimit) aiBusy++;
    else await new Promise((go) => aiWaiting.push(go));
    const t = now();
    let res = null;
    try {
      res = await opts.ai.read(task, payload);
    } catch {
      res = null;
    } finally {
      // the slot goes to the next in line, or is let go
      const next = aiWaiting.shift();
      if (next) next();
      else aiBusy--;
    }
    report.ai.push({ task, file: payload?.source?.file ?? null, part: payload?.source?.part ?? null, ok: !!res, ms: Math.round(now() - t), fixture: res?.meta?.fixture ?? null, marksMatch: res?.meta?.marksMatch ?? null });
    return res;
  };
  // the steps the progress bar counts: rectify and split per file, one per plan (a file each until the sheets are split),
  // then order, align, facades, validate, questions and done
  let totalSteps = inputs.length * 3 + 6;

  // ---- 1. photos straightened, 2. sheets split (the AI's classify of each sheet is asked as soon as it is straight, and
  //      waited for when its drawings are made)
  const sheetsIn = [];
  const names = new Set();
  for (let fi = 0; fi < inputs.length; fi++) {
    const input = inputs[fi];
    // a name once (two uploads of «plan.png» from different folders): the questions' ids and the AI's files go by it
    let name = input.name ?? `fil-${fi + 1}`;
    for (let k = 2; names.has(name); k++) name = (input.name ?? 'fil').replace(/(\.[^.]+)?$/, ` (${k})$1`);
    names.add(name);
    let img = input.img;
    let photo = null;
    let t = now();
    progress('rectify', `Ser om «${name}» er et foto …`, totalSteps);
    let rect = null;
    try {
      // a phone's EXIF focal length (35 mm equivalent / 43.27 = the share of the diagonal) places a cut side better
      rect = await run('rectifyPhoto', img, input.focal > 0 ? { focal: input.focal } : {});
    } catch (err) {
      rect = { applied: false, reason: 'error', cut: [], error: String(err?.message ?? err) };
    }
    if (rect?.applied) {
      img = rect.img;
      photo = { quad: rect.quad, width: img.width, height: img.height, cut: rect.cut ?? [], aspect: rect.aspect ?? null };
      step({ step: 'rectify', file: name, method: 'photo', confidence: rect.cut?.length ? 'medium' : 'high', detail: `rettet opp til ${img.width} × ${img.height} px${rect.cut?.length ? `, arket går ut av bildet (${rect.cut.join(', ')})` : ''}`, ms: Math.round(now() - t) });
      if (rect.cut?.length) questions.push(shapeQuestion({ file: name, cut: rect.cut, level: null }));
    } else {
      const ph = rect?.reason === 'unsure' || rect?.reason === 'no-sheet' ? isPhoto(input.img) : null;
      step({ step: 'rectify', file: name, method: 'none', confidence: ph?.photo ? 'low' : 'high', detail: rect?.reason ?? null, ms: Math.round(now() - t) });
      if (ph?.photo) {
        questions.push(photoQuestion({ file: name, reason: rect.reason === 'unsure' ? 'usikre hjørner' : 'fant ikke arket' }));
        report.notes.push(`«${name}» ser ut som et foto, men arket ble ikke funnet sikkert. Planen er lest som den er.`);
      }
    }

    t = now();
    progress('split', `Deler opp «${name}» …`, totalSteps);
    let blocks = [];
    try {
      blocks = (await run('splitSheet', img))?.blocks ?? [];
    } catch {
      blocks = [];
    }
    // the AI's view of the sheet: kinds, titles, levels, detached buildings
    const clsP = askAi('classify', { image: img, hints: { fileName: name }, source: { file: name, part: null, width: input.img.width, height: input.img.height, bbox: null, photo } });
    sheetsIn.push({ fi, input, name, img, photo, blocks, clsP, ms: now() - t });
  }
  const drawings = [];
  for (const { fi, input, name, img, photo, blocks, clsP, ms } of sheetsIn) {
    const t = now() - ms;
    const cls = await clsP;
    const aiDrawings = classifyDrawings(cls).map((d) => ({ ...d, px: [d.bbox[0] * img.width, d.bbox[1] * img.height, d.bbox[2] * img.width, d.bbox[3] * img.height] }));
    let found = blocks.filter((b) => DRAWING_KINDS.has(b.kind));
    // a «facade» or «section» far smaller than a plan on the same sheet is not a drawing of the house: the terrace's
    // tile grid or a shadow at the edge of a rectified photo (hus3-foto), unless the AI saw a facade there
    const boxArea = (b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
    const planArea = Math.max(0, ...found.filter((b) => b.kind === 'plan').map(boxArea));
    found = found.filter((b) => {
      if (b.kind === 'plan' || !(planArea > 0) || boxArea(b) >= o.sideDrawing * planArea) return true;
      return aiDrawings.some((x) => x.kind === b.kind && iou(b.bbox, x.px) > 0.25);
    });
    const multi = found.length >= 2;
    // no block (the sheet could not be split): the AI's kind, else the file's name («fasade-nord.png», «snitt.pdf»), else a plan
    const byName = /fasade|facade|elevation/i.test(name) ? 'facade' : /snitt|section/i.test(name) ? 'section' : 'plan';
    if (!found.length) found = [{ bbox: [0, 0, img.width, img.height], kind: aiDrawings.find((d) => DRAWING_KINDS.has(d.kind))?.kind ?? byName, score: 0, none: true }];
    const pad = Math.round(0.008 * Math.max(img.width, img.height));
    found.forEach((b, k) => {
      // the AI drawing for this block: the best box overlap (a single drawing on both sides: that one)
      const aiOnly = aiDrawings.filter((d) => DRAWING_KINDS.has(d.kind));
      let ad = null;
      let best = 0.25;
      for (const d of aiOnly) {
        const v = iou(b.bbox, d.px);
        if (v > best) {
          best = v;
          ad = d;
        }
      }
      if (!ad && !multi && aiOnly.length === 1) ad = aiOnly[0];
      let kind = b.kind;
      let kindFrom = b.none ? 'ingen blokk' : 'sheet';
      // facade or section: the AI decides when it is there (sheet.js has one real section to go by)
      if (ad && (kind === 'facade' || kind === 'section') && (ad.kind === 'facade' || ad.kind === 'section') && ad.kind !== kind) {
        kind = ad.kind;
        kindFrom = 'ai';
      }
      // the customer's chip in the drawing stack (stack.js, input.kind): a file that is one drawing
      if (!multi && (input.kind === 'plan' || input.kind === 'facade') && kind !== input.kind) {
        kind = input.kind;
        kindFrom = 'kunden';
      }
      const bbox = multi ? [Math.max(0, b.bbox[0] - pad), Math.max(0, b.bbox[1] - pad), Math.min(img.width, b.bbox[2] + pad), Math.min(img.height, b.bbox[3] + pad)] : null;
      drawings.push({
        id: `d${drawings.length + 1}`,
        key: multi ? `${name}#${k + 1}` : name,
        file: name,
        input: fi,
        part: multi ? k : null,
        blockBox: b.none ? null : b.bbox,
        sheetImg: img,
        onSheet: found.length,
        kind,
        kindFrom,
        score: b.score,
        bbox,
        img: bbox ? cropImage(img, bbox) : img,
        sheet: { width: input.img.width, height: input.img.height, photo },
        pdfPage: input.pdfPage ? { ...input.pdfPage, widthPx: input.pdfPage.widthPx ?? input.img.width, heightPx: input.pdfPage.heightPx ?? input.img.height } : null,
        ai: ad,
        title: ad?.title ?? null,
        levelNameAi: ad?.levelName ?? null,
        detached: !!ad?.detached,
        scaleText: cls?.scaleText ?? null,
      });
    });
    step({ step: 'split', file: name, method: multi ? 'sheet' : 'single', confidence: cls ? 'high' : 'medium', detail: `${found.length} tegning${found.length === 1 ? '' : 'er'}: ${found.map((b, k) => drawings[drawings.length - found.length + k].kind).join(', ')}${cls ? ` (KI: ${aiDrawings.map((d) => d.kind).join(', ') || 'ingen'})` : ''}`, ms: Math.round(now() - t) });
  }

  // ---- 3. plans: duplicates, buildings beside the house, alternatives
  let plans = drawings.filter((d) => d.kind === 'plan');
  // alternatives first: «underetasje-alternativ» beside «underetasje» is the same level drawn another way, not the same
  // drawing twice – the base drawing is used unless an answer chose the alternative (generate(inputs, { answers }))
  const altPairs = [];
  for (const d of plans) {
    const m = fold(d.file).match(/^(.*?)[-_ ]+alt(?:ernativ|\.)?[-_ ]*\d*(\.[a-z0-9]+)?$/);
    if (!m) continue;
    const of = plans.find((x) => x !== d && fold(x.file).replace(/\.[a-z0-9]+$/, '') === m[1]);
    if (!of) continue;
    const chosen = answers[`alternative:${of.file}`] === d.file;
    (chosen ? of : d).skip = 'alternative';
    altPairs.push({ file: of.file, alternative: d.file, used: chosen ? d.file : of.file });
  }
  plans = plans.filter((d) => !d.skip);
  // the floor a plan's own file names (or the customer's chip in the drawing stack), for telling duplicates from floors
  // drawn alike
  const namedLevel = (d) => {
    const given = inputs[d.input]?.level;
    if (Number.isInteger(given) && d.onSheet === 1) return given;
    const w = levelWords(d.file);
    return w.level ?? (w.tag === 'basement' ? -1 : null);
  };
  // thumbnails of the drawing itself (a single drawing's image also holds its title, compass and disclaimer)
  const thumbs = new Map(plans.map((d) => [d, thumbnail(d.bbox || !d.blockBox ? d.img : cropImage(d.sheetImg, d.blockBox))]));
  for (let i = 0; i < plans.length; i++) {
    const a = plans[i];
    if (a.duplicateOf) continue;
    for (let j = i + 1; j < plans.length; j++) {
      const b = plans[j];
      if (b.duplicateOf || a.file === b.file) continue;
      const diff = thumbDiff(thumbs.get(a), thumbs.get(b), o.dupSize);
      if (diff > o.dupGrey) continue;
      // two files that name different floors («2etg» and «3etg», or the customer's chips) are floors drawn alike (a
      // block of flats), not one drawing twice: both stay, and the customer is told
      const la = namedLevel(a);
      const lb = namedLevel(b);
      if (la != null && lb != null && la !== lb) {
        step({ step: 'dedup', file: b.file, method: 'thumbnail', confidence: 'medium', detail: `samme tegning som «${a.file}», men en annen etasje i navnet: begge brukt` });
        report.notes.push(`«${a.file}» og «${b.file}» viser samme tegning, men navnene sier forskjellige etasjer. Begge er brukt som egne etasjer.`);
        continue;
      }
      // keep the one alone on its sheet (then the larger)
      const [keep, drop] = a.onSheet < b.onSheet || (a.onSheet === b.onSheet && a.img.width * a.img.height >= b.img.width * b.img.height) ? [a, b] : [b, a];
      drop.duplicateOf = keep.id;
      keep.title ??= drop.title;
      keep.levelNameAi ??= drop.levelNameAi;
      if (drop.ai && !keep.ai) keep.ai = drop.ai;
      keep.detached ||= drop.detached;
      step({ step: 'dedup', file: drop.file, method: 'thumbnail', confidence: diff < o.dupGrey / 2 ? 'high' : 'medium', detail: `samme tegning som «${keep.file}»${keep.part != null ? ` (del ${keep.part + 1})` : ''}, avvik ${fmt(diff)}` });
      report.notes.push(`«${drop.file}»${drop.part != null ? ` (del ${drop.part + 1})` : ''} er samme tegning som «${keep.file}»${keep.part != null ? ` (del ${keep.part + 1})` : ''}, og er brukt én gang.`);
    }
  }
  plans = plans.filter((d) => !d.duplicateOf);
  // a building beside the house: a small companion of a larger plan on its sheet, or one the AI calls detached – left
  // out when other plans remain (hus7's garage is the only building: it stays)
  const area = (d) => d.img.width * d.img.height;
  for (const d of plans) {
    const mates = plans.filter((x) => x.file === d.file && x !== d);
    const largest = Math.max(area(d), ...mates.map(area));
    d.companion = d.detached || (mates.length > 0 && area(d) < o.companionShare * largest);
  }
  if (plans.some((d) => !d.companion)) {
    for (const d of plans.filter((x) => x.companion)) {
      d.skip = 'besides';
      step({ step: 'dedup', file: d.file, method: d.detached ? 'ai' : 'size', confidence: 'medium', detail: `${d.title ?? 'en mindre bygning'} ved siden av huset (${d.part != null ? `del ${d.part + 1}` : 'hele arket'}) er ikke tatt med` });
      report.notes.push(`«${d.file}»: ${d.title ? `«${d.title}»` : 'en mindre bygning'} ved siden av huset er ikke tatt med som etasje.`);
    }
  }
  plans = plans.filter((d) => !d.skip);
  totalSteps = inputs.length * 2 + plans.length + 6;
  if (!plans.length) {
    // nothing to build a house from (no files, or only facades and sections): said, not an empty house in silence
    step({ step: 'plans', method: 'none', confidence: 'low', detail: `ingen plantegning blant ${inputs.length} fil${inputs.length === 1 ? '' : 'er'}` });
    report.notes.push(inputs.length ? 'Fant ingen plantegning blant tegningene, bare fasader eller snitt. Legg til en plantegning per etasje, eller merk tegningen som «Etasje» i stabelen.' : 'Ingen tegninger å lage huset av.');
  }

  // ---- 4. per plan: scale, detection, semantics (provisional order: names first, the main level first)
  for (const d of plans) {
    const given = inputs[d.input]?.level;
    d.words = Number.isInteger(given) && d.onSheet === 1 ? { level: given, tag: null, user: true } : levelWords(d.file);
    d.titleWords = classifyLevel(d.ai ?? (d.levelNameAi ? { levelName: d.levelNameAi } : null));
  }
  const provisional = (d) => d.words.level ?? d.titleWords.level ?? (d.words.tag === 'basement' ? -1 : d.words.tag === 'upper' ? 0 : null);
  const order = [...plans].sort((a, b) => Math.abs(provisional(a) ?? 9) - Math.abs(provisional(b) ?? 9) || (provisional(a) ?? 9) - (provisional(b) ?? 9));
  // the facades' AI answers are asked now, and waited for in step 7
  for (const d of drawings.filter((x) => x.kind === 'facade')) {
    const source = { file: d.file, part: d.part, width: d.sheet.width, height: d.sheet.height, bbox: d.bbox, photo: d.sheet.photo ? { quad: d.sheet.photo.quad, width: d.sheet.photo.width, height: d.sheet.photo.height } : null };
    d.aiFacadeP = askAi('readFacade', { image: d.img, hints: { fileName: d.file, ...(d.title ? { note: d.title } : {}) }, source });
  }
  // a plan waits only for the earlier plans of its own drawing set (their scales are its sameSource, or – of a looser
  // set – checked against its outline); the others are measured side by side, so their AI answers are waited for
  // together
  const ready = new Map();
  await Promise.all(order.map((d, j) => {
    const task = (async () => {
      const set = [];
      const loose = [];
      for (const x of order.slice(0, j)) {
        const strong = sameSet(x, d);
        if (!strong && !looseSet(x, d)) continue;
        await ready.get(x);
        (strong ? set : loose).push(x);
      }
      progress('plan', `Leser planen «${d.file}»${d.part != null ? ` (del ${d.part + 1})` : ''} …`, totalSteps);
      await analysePlan(d, set, loose);
    })();
    ready.set(d, task);
    return task;
  }));

  /**
   * One plan: measured with the scales of its drawing set (sameSource); a level that comes out (nearly) empty at an
   * inherited scale is measured again on its own (the AI's answer is kept: no second call), and the better of the two
   * stays; a level that is still empty tries the other readings of its walls (rescueWalls).
   */
  async function analysePlan(d, set, loose = []) {
    const same = set.filter((x) => x.scale).map((x) => x.scale);
    const looseScales = loose.filter((x) => x.scale).map((x) => x.scale);
    await measurePlan(d, same, false, looseScales);
    d.inherited = d.scale.method === 'sameSource' || (same.length > 0 && d.provisionalFrom === 'sameSource');
    if (d.inherited && weakLevel(d)) {
      const first = keepPass(d);
      await measurePlan(d, [], true, []);
      const own = keepPass(d);
      const drop = (steps) => {
        const gone = new Set(steps);
        report.steps.splice(0, report.steps.length, ...report.steps.filter((x) => !gone.has(x)));
      };
      if (levelScore(own) > levelScore(first)) {
        drop(first.passSteps);
        d.inherited = false;
        step({ step: 'scale', file: d.file, method: 'own', confidence: d.scale.confidence, detail: `den arvede skalaen (${fmt(first.ppm, 2)} px/m fra en annen etasje) ga ${first.det.walls.length} vegger og ${roomsOf(first)} rom; målt alene: ${fmt(d.ppm, 2)} px/m, ${d.det.walls.length} vegger og ${roomsOf(own)} rom` });
        report.notes.push(`«${d.file}»: målestokken fra en annen etasje passet ikke (${fmt(first.ppm, 1)} mot ${fmt(d.ppm, 1)} px/m), så etasjen er målt for seg.`);
      } else {
        drop(own.passSteps);
        Object.assign(d, first);
      }
    }
    // an inherited scale the outlines did not confirm is a guess: asked (step 8)
    d.inheritChecked = d.scale.method !== 'sameSource' || outlineAgrees(d.scale, d.inherited ? [...same, ...(d.looseUsed ?? [])] : []);
    if (weakLevel(d)) await rescueWalls(d);
  }

  /** The fields one measuring pass writes on a plan (to keep the better of two). */
  function keepPass(d) {
    const keys = ['ppm0', 'provisionalFrom', 'det0', 'level0', 'rooms0', 'refs', 'cleanedForScale', 'scale', 'ppm', 'det', 'level', 'found', 'rooms', 'openingChanges', 'error', 'wallsFrom', 'semSteps', 'passSteps', 'looseUsed'];
    return Object.fromEntries(keys.map((k) => [k, d[k]]));
  }
  /** Rooms of at least roomQuestionMin m² (a sliver between two lines is not a room). */
  function roomsOf(p) {
    return (p.found?.rooms ?? []).filter((r) => r.area >= o.roomQuestionMin).length;
  }
  function levelScore(p) {
    return roomsOf(p) * 1000 + Math.min(999, p.det?.walls?.length ?? 0);
  }
  /** Nothing to walk in: fewer than four walls, or no room of a few m². */
  function weakLevel(p) {
    return (p.det?.walls?.length ?? 0) < 4 || roomsOf(p) === 0;
  }

  /** The scale, the detection at it and the semantics of one plan (one pass); again: keep the AI answer and its marks. */
  async function measurePlan(d, same, again, loose = []) {
    const t = now();
    const img = d.img;
    const source = { file: d.file, part: d.part, width: d.sheet.width, height: d.sheet.height, bbox: d.bbox, photo: d.sheet.photo ? { quad: d.sheet.photo.quad, width: d.sheet.photo.width, height: d.sheet.photo.height } : null };
    const braGiven = Number(answers[`bra:${d.key}`]);
    const bra = braGiven > 5 ? braGiven : opts.bra?.[d.key] ?? opts.bra?.[d.file] ?? null;
    const given = answers[`scale:${d.key}`] ?? null;
    const pdfPage = d.pdfPage;
    // the provisional scale and the detection there (no AI yet)
    let first = null;
    try {
      first = await run('autoScale', img, { ai: null, pdfPage, bra, sameSource: same });
    } catch (err) {
      first = null;
      d.error = String(err?.message ?? err);
    }
    const ppm0 = first?.ppm0 > 0 ? first.ppm0 : first?.result?.pxPerM > 0 ? first.result.pxPerM : 50;
    // autoScale starts at a surer level's scale of the same set when there is one (and checks it there)
    const sibling = same.find((r) => r && r.pxPerM > 0 && (r.confidence === 'high' || r.confidence === 'medium'));
    d.provisionalFrom = sibling && Math.abs(ppm0 / sibling.pxPerM - 1) < 1e-6 ? 'sameSource' : 'standard';
    let det0 = first?.det?.walls ? first.det : { walls: [], openings: [], skylights: [], stairs: [] };
    // the walls' cleaner at the provisional scale: on grey-walled, hatched or coloured plans (hus4, hus6, hus9) the
    // rooms the scale and the marks are measured on close far better; a black plan comes back unchanged and keeps the
    // detection it has
    let scaleImg = img;
    try {
      const cleaned = await run('cleanForWalls', img, { pxPerM: ppm0 });
      if (cleaned?.data && differs(cleaned.data, img.data)) {
        const detC = await run('detectPlan', cleaned, { pxPerM: ppm0, clean: false });
        if (detC?.walls?.length) {
          det0 = detC;
          scaleImg = cleaned;
          d.cleanedForScale = true;
        }
      }
    } catch {
      /* the uncleaned detection stands */
    }
    const level0 = applyDetection({}, det0, ppm0);
    const rooms0 = findRooms(level0.walls);
    if (!again) {
      // marks for the AI: the rooms and openings the classical detection found
      const targets = targetsFromLevel(level0, rooms0.rooms, ppm0);
      const marked = drawMarks(img, targets);
      const hints = { fileName: d.file };
      if (d.levelNameAi) hints.levelName = d.levelNameAi;
      d.aiPlan = tidyPlan(await askAi('readPlan', { image: marked.img, marks: marked.marks, unmarked: marked.unmarked, hints, source }));
      // what the marks were drawn on: the answer's mark ids point into these
      d.refs = { ppm0, level0, rooms0 };
    }
    const ai = d.aiPlan;
    Object.assign(d, { ppm0, det0, level0, rooms0 });
    // the scale with the AI's reading; the sheet's scale text («1:100» in a title block, from classify) counts too when
    // the plan's own reading has none (a crop of a sheet)
    const sheetScale = d.scaleText && !ai?.scaleText ? d.scaleText : null;
    const aiScale = ai ? (sheetScale ? { ...ai, scaleText: sheetScale } : ai) : sheetScale ? { levelTitle: null, scaleText: sheetScale, rooms: [], labels: [], dimensions: [], openings: [], skylights: [], stair: { present: false, at: null, type: 'none', up: 'unknown' }, ceiling: [], furniture: [], notes: '' } : null;
    let scale = first?.result ?? { pxPerM: ppm0, method: 'standard', confidence: 'low', candidates: [], outline: null, n: 0 };
    let how = 'uten KI';
    if (aiScale) {
      try {
        scale = estimateScale({ img, det0, rooms0, ppm0, ai: aiScale, pdfPage, bra, sameSource: same });
        how = ai ? `med KI${sheetScale ? `, arkets «${sheetScale}»` : ''}` : `arkets «${sheetScale}» (KI)`;
      } catch {
        /* keep the first */
      }
      const reading = scale.method !== 'standard';
      if (reading && relDiff(scale.pxPerM, ppm0) > o.rescan) {
        try {
          const again = await run('autoScale', scaleImg, { ai: aiScale, ppm0: scale.pxPerM, pdfPage, bra, sameSource: same, maxPasses: 2 });
          if (again?.result?.pxPerM > 0) {
            scale = again.result;
            how = `${how}, ${again.passes + 1} runder`;
          }
        } catch {
          /* keep the estimate */
        }
      }
    }
    // a looser set's scales (other image sizes, the same style) only where this level's outline is theirs, or theirs
    // at one zoom: hus3's upper floor, cropped to another size, at the floor below's 47.9 px/m
    d.looseUsed = [];
    const confirmed = loose.filter((r) => r?.pxPerM > 0 && outlineMatch(scale.outline, r.outline) != null);
    if (confirmed.length) {
      try {
        const s2 = estimateScale({ img, det0, rooms0, ppm0, ai: aiScale, pdfPage, bra, sameSource: [...same, ...confirmed] });
        if (s2.method === 'sameSource' && s2.pxPerM > 0) {
          scale = s2;
          d.looseUsed = confirmed;
          how = `${how}, en annen etasje med samme omriss`;
        }
      } catch {
        /* keep the scale */
      }
    }
    if (Number(given) > 0 && scale.outline?.w > 0) {
      scale = { ...scale, pxPerM: scale.outline.w / Number(given), method: 'given', confidence: 'high', detail: `husets bredde ${fmt(Number(given), 2)} m (svar)` };
    }
    if (!(scale?.pxPerM > 0)) scale = { pxPerM: ppm0, method: 'standard', confidence: 'low', candidates: [], outline: null, n: 0 };
    d.scale = scale;
    d.ppm = scale.pxPerM;
    const scaleStep = step({ step: 'scale', file: d.file, method: scale.method, confidence: scale.confidence, detail: `${fmt(d.ppm, 2)} px/m (${how}; foreløpig ${fmt(ppm0, 2)}${d.provisionalFrom === 'sameSource' ? ' fra en annen etasje' : ''}${d.cleanedForScale ? ', ryddet før målingen' : ''})`, ms: Math.round(now() - t) });

    // the detection at the final scale, cleaned
    const t2 = now();
    let det;
    try {
      det = await run('detectPlan', img, { pxPerM: d.ppm, clean: true });
    } catch (err) {
      det = { stats: { error: String(err?.message ?? err) } };
    }
    setDetection(d, tidyDetection(det), 'clean');
    const detectStep = step({ step: 'detect', file: d.file, method: d.det.stats?.cleaned ? 'clean' : 'raw', confidence: d.det.walls.length >= 8 ? 'high' : d.det.walls.length ? 'medium' : 'low', detail: `${d.det.walls.length} vegger, ${d.det.openings.length} åpninger, ${d.det.skylights.length} takvinduer, ${d.det.stairs.length} trapper`, ms: Math.round(now() - t2) });
    semantics(d);
    d.passSteps = [scaleStep, detectStep, ...d.semSteps];
  }

  /** The level of a plan from a detection (px) at its scale. */
  function setDetection(d, det, from) {
    const img = d.img;
    const scale = d.scale;
    d.det = det;
    d.wallsFrom = from;
    const L = { id: `tmp-${d.id}`, name: d.file, floorY: 0, ceiling: null, offset: [0, 0], walls: [], openings: [], rooms: [], stairs: [], image: null };
    L.image = { name: d.file, width: img.width, height: img.height, pxPerM: Math.round(d.ppm * 1e4) / 1e4, scaleRef: null, scaleFrom: { method: scale.method, confidence: scale.confidence, n: scale.n ?? null, spread: scale.spread ?? null }, source: { file: d.file, part: d.part, bbox: d.bbox, rectified: !!d.sheet.photo } };
    applyDetection(L, det, d.ppm, DEFAULT_SETTINGS);
    d.level = L;
  }

  /**
   * A level with nothing to walk in at its final scale (hus7's garage: walls drawn as two thin lines, which the
   * detection takes for lines, not walls): the other readings of its walls, the first that gives a room –
   *   1. the detection without the cleaner;
   *   2. the outlines filled (fillOutlinedWalls), and a side the walls leave open closed with a wall and a passage
   *      (closeOpenSide: a garage's door wall, drawn as gaps);
   *   3. the provisional detection, at the final scale.
   * The scale stays. A level still without a room gets a question (questions.js wallsQuestion) and a note.
   */
  async function rescueWalls(d) {
    const t = now();
    const before = keepPass(d);
    const tries = [];
    const attempt = async (label, make, close = false) => {
      let det = null;
      try {
        det = tidyDetection(await make());
      } catch {
        det = null;
      }
      if (!det?.walls.length) return;
      setDetection(d, det, label);
      const closed = close ? closeOpenSide(d.level) : null;
      // the fill and the provisional scale also make walls of text and dimension lines: those with no room beside them go
      if (label !== 'raw') dropLoose(d.level, o.roomQuestionMin);
      d.found = findRooms(d.level.walls);
      tries.push({ label, pass: keepPass(d), closed });
    };
    const found = () => tries.some((x) => roomsOf(x.pass) > 0);
    if (d.det.stats?.cleaned !== false) await attempt('raw', () => run('detectPlan', d.img, { pxPerM: d.ppm, clean: false }));
    if (!found()) {
      const filled = fillOutlinedWalls(d.img, d.ppm);
      if (filled) await attempt('outlined', () => run('detectPlan', filled, { pxPerM: d.ppm, clean: false }), true);
    }
    if (!found() && d.det0?.walls?.length) await attempt('provisional', () => d.det0);
    const best = tries.filter((x) => roomsOf(x.pass) > 0).sort((a, b) => levelScore(b.pass) - levelScore(a.pass))[0];
    if (!best) {
      Object.assign(d, before);
      step({ step: 'detect', file: d.file, method: 'none', confidence: 'low', detail: `ingen rom å gå i (${d.det.walls.length} vegger); prøvd ${tries.map((x) => `${WALLS_FROM[x.label]}: ${x.pass.det.walls.length} vegger, ${roomsOf(x.pass)} rom`).join('; ') || 'ingenting annet'}`, ms: Math.round(now() - t) });
      return;
    }
    Object.assign(d, best.pass);
    // the semantics again on these walls (the first pass's rooms, openings and skylights steps go)
    const stale = new Set(before.semSteps ?? []);
    const kept = report.steps.filter((s) => !stale.has(s));
    report.steps.splice(0, report.steps.length, ...kept);
    step({ step: 'detect', file: d.file, method: best.label, confidence: 'low', detail: `ingen rom ved første forsøk (${before.det.walls.length} vegger): ${WALLS_FROM[best.label]} ga ${d.det.walls.length} vegger og ${roomsOf(d)} rom${best.closed ? `; ${best.closed}` : ''}`, ms: Math.round(now() - t) });
    semantics(d);
    report.notes.push(`«${d.file}»: veggene ble ikke funnet på vanlig måte, så de er lest ${WALLS_FROM[best.label]}${best.closed ? ` (${best.closed})` : ''}. Sjekk dem i «Finjuster».`);
  }

  /** Room names and kinds, door variants, skylights from the AI answer onto the level (positions only). */
  function semantics(d) {
    const firstStep = report.steps.length;
    const L = d.level;
    const ai = d.aiPlan;
    const W = d.img.width;
    const H = d.img.height;
    const ppm = d.ppm;
    const toPlan = (n) => [(n[0] * W) / ppm, (n[1] * H) / ppm];
    // by the mark's id when the marks are ours (a live answer, or a recording made with these very marks): the room or
    // opening it was drawn for, at the provisional scale the marks were drawn at (d.refs); else by the answer's
    // normalised position
    const refs = d.refs ?? {};
    const byRef = !!ai && ai.meta?.marksMatch !== false;
    const k0 = refs.ppm0 > 0 ? refs.ppm0 / ppm : 1;
    const refRoom = (it) => {
      const r0 = byRef && it.ref != null ? refs.rooms0?.rooms?.[it.ref] : null;
      return r0 ? [r0.inside[0] * k0, r0.inside[1] * k0] : null;
    };
    const refOpening = (it) => {
      const o0 = byRef && it.ref != null ? refs.level0?.openings?.find((x) => x.id === it.ref) : null;
      const c = o0 ? openingCentre(refs.level0, o0) : null;
      return c ? [c[0] * k0, c[1] * k0] : null;
    };
    const found = findRooms(L.walls);
    d.found = found;
    // ---- rooms
    const items = [];
    if (ai) {
      for (const r of ai.rooms) if (r.name && r.at) items.push({ name: r.name, area: r.area, kind: r.kind, roomKind: r.roomKind, at: r.at, p: refRoom(r), how: r.mark ? 'merke' : 'etikett' });
      for (const l of ai.labels) if (l.text && l.at && !NOT_A_ROOM.test(l.text)) items.push({ name: l.text, area: l.area, kind: l.kind, roomKind: l.roomKind, at: l.at, how: 'etikett' });
    }
    const per = new Map();
    let unplaced = 0;
    for (const it of items) {
      const idx = (it.p ? roomAt(found, it.p) : -1) >= 0 ? roomAt(found, it.p) : roomAt(found, toPlan(it.at));
      if (idx < 0) {
        unplaced++;
        continue;
      }
      if (!per.has(idx)) per.set(idx, []);
      per.get(idx).push(it);
    }
    L.rooms = [];
    const unnamed = [];
    let merged = 0;
    // the guessed kinds for unnamed rooms (export.js guessKind, the same features labelRooms uses)
    const feats = roomFeatures(L, found);
    const largest = found.rooms.reduce((b, r) => (!b || r.area > b.area ? r : b), null);
    for (const room of found.rooms) {
      const its = per.get(room.index) ?? [];
      if (its.length) {
        // several labels in one region (an open loft, a hall the detection merged with a store): the largest first
        its.sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
        const main = its[0];
        let kind = main.roomKind ?? null;
        if (!kind && OUTDOOR.has(main.kind)) kind = 'storage';
        if (!kind) kind = guessKind({ area: room.area, ...(feats.get(room.index) ?? { doors: 0, windows: 0, exteriorDoors: 0 }) }, room === largest);
        const name = its.map((x) => displayName(x.name)).join(' + ');
        if (its.length > 1) merged++;
        L.rooms.push({ id: `r${L.rooms.length + 1}`, name, kind, seed: [round(room.inside[0], 3), round(room.inside[1], 3)], auto: true, from: 'ai', labels: its.map((x) => ({ text: x.name, area: x.area ?? null })), ...(OUTDOOR.has(main.kind) ? { outdoor: main.kind } : {}) });
      } else if (room.area >= 0.5) {
        unnamed.push(room);
      }
    }
    d.rooms = { named: L.rooms.length, merged, unplaced, unnamed: unnamed.map((r) => r.index), total: found.rooms.length };
    const bigRooms = found.rooms.filter((r) => r.area >= o.roomQuestionMin).length;
    const roomsConf = !ai || !bigRooms || unplaced > L.rooms.length ? 'low' : unnamed.some((r) => r.area >= o.roomQuestionMin) || unplaced || merged ? 'medium' : 'high';
    step({ step: 'rooms', file: d.file, method: ai ? 'ai' : 'guess', confidence: roomsConf, detail: `${found.rooms.length} rom, ${L.rooms.length} med navn fra tegningen${merged ? `, ${merged} med flere etiketter` : ''}${unplaced ? `, ${unplaced} etiketter utenfor rommene` : ''}` });

    // ---- openings: the AI's kinds where they are about one of ours
    const ours = L.openings.map((op) => ({ op, c: openingCentre(L, op) })).filter((x) => x.c);
    const pairs = [];
    if (ai) {
      for (const a of ai.openings) {
        if (!a.at) continue;
        const p = refOpening(a) ?? toPlan(a.at);
        for (const x of ours) {
          const dd = dist(p, x.c);
          if (dd <= Math.max(o.openingTol, x.op.width / 2)) pairs.push({ a, x, dd });
        }
      }
    }
    pairs.sort((p, q) => p.dd - q.dd);
    const usedA = new Set();
    const usedO = new Set();
    const changes = [];
    for (const { a, x } of pairs) {
      if (usedA.has(a) || usedO.has(x.op)) continue;
      usedA.add(a);
      usedO.add(x.op);
      const to = aiOpeningKind(x.op, a.kind, L);
      if (to) {
        changes.push(`${kindOf(x.op)}→${to}`);
        setOpeningKind(x.op, to, DEFAULT_SETTINGS);
        x.op.from = 'ai';
      }
    }
    d.openingChanges = changes;
    const v = { single: 0, double: 0, sliding: 0, window: 0, opening: 0 };
    for (const op of L.openings) v[kindOf(op)]++;
    step({ step: 'openings', file: d.file, method: ai ? 'ai+klassisk' : 'klassisk', confidence: ai ? 'medium' : 'medium', detail: `dører ${v.single}/${v.double}/${v.sliding} (enkel/dobbel/skyve), ${v.window} vinduer, ${v.opening} åpninger${ai ? `; KI koblet til ${usedO.size} av ${ours.length}${changes.length ? `, endret: ${changes.join(', ')}` : ''}` : ''}` });

    // ---- skylights: the detected ones, plus the AI's where nothing was found
    L.skylights ||= [];
    let added = 0;
    for (const s of ai?.skylights ?? []) {
      const p = toPlan(s.at);
      const near = L.skylights.some((k) => p[0] >= k.rect[0][0] - 0.6 && p[0] <= k.rect[1][0] + 0.6 && p[1] >= k.rect[0][1] - 0.6 && p[1] <= k.rect[1][1] + 0.6);
      if (near || roomAt(found, p, 0.2) < 0) continue;
      const [sw, sh] = o.skylight;
      L.skylights.push({ id: `k${L.skylights.length + 1}`, rect: [[round(p[0] - sw / 2, 4), round(p[1] - sh / 2, 4)], [round(p[0] + sw / 2, 4), round(p[1] + sh / 2, 4)]], auto: true, from: 'ai' });
      added++;
    }
    if (L.skylights.length || ai?.skylights?.length) step({ step: 'skylights', file: d.file, method: added ? 'klassisk+ai' : 'klassisk', confidence: ai ? 'high' : 'medium', detail: `${L.skylights.length} takvinduer (${L.skylights.length - added} funnet i tegningen, ${added} fra KI)` });
    d.semSteps = report.steps.slice(firstStep);
  }

  // ---- 5. the floor order
  progress('order', 'Ordner etasjene …', totalSteps);
  const ordered = orderLevels(plans);
  for (const d of ordered.list) step({ step: 'order', file: d.file, method: d.orderFrom, confidence: ordered.confidence, detail: `${d.levelNo}: ${d.orderWhy}` });
  // the document
  const doc = createDoc(houseName(inputs));
  doc.settings = { ...DEFAULT_SETTINGS };
  doc.generated = { version: 1, floorHeight: o.floorHeight, notes: report.notes, requests: report.requests, inputs: inputs.map((x) => x.name) };
  for (const d of ordered.list) {
    const L = d.level;
    L.id = levelId(d.levelNo);
    L.name = levelName(d.levelNo, d.words.tag ?? d.titleWords.tag, `${d.file} ${d.aiPlan?.levelTitle ?? ''} ${d.levelNameAi ?? ''}`);
    L.floorY = round(d.levelNo * o.floorHeight, 3);
    L.generated = { orderFrom: d.orderFrom, orderWhy: d.orderWhy, scale: { method: d.scale.method, confidence: d.scale.confidence, pxPerM: L.image.pxPerM, candidates: (d.scale.candidates || []).slice(0, 8) } };
    doc.levels.push(L);
    images[L.id] = { img: d.img, file: d.file, bbox: d.bbox, part: d.part, rectified: !!d.sheet.photo };
  }
  // the main level first in the list (export.js origin), then the others bottom up
  doc.levels.sort((a, b) => (a.id === 'hoved' ? -1 : b.id === 'hoved' ? 1 : a.floorY - b.floorY));

  // ---- 6. levels on top of each other, the stair
  progress('align', 'Legger etasjene oppå hverandre …', totalSteps);
  const byNo = [...ordered.list].sort((a, b) => a.levelNo - b.levelNo);
  for (const d of byNo) d.stairsPx = d.det?.stairs?.length ? d.det.stairs : null;
  const mainD = byNo.find((d) => d.levelNo === 0) ?? byNo[0];
  const alignOrder = [...byNo].filter((d) => d !== mainD).sort((a, b) => Math.abs(a.levelNo - mainD.levelNo) - Math.abs(b.levelNo - mainD.levelNo));
  for (const d of byNo) {
    if (d.stairsPx) continue;
    try {
      d.stairsPx = (await run('findStairs', d.img, { pxPerM: d.ppm })) ?? [];
      if (d.stairsPx.length) d.stairsFrom = 'finder';
    } catch {
      d.stairsPx = [];
    }
  }
  for (const d of alignOrder) {
    const t = now();
    const towards = d.levelNo > mainD.levelNo ? -1 : 1;
    const ref = byNo.find((x) => x.levelNo === d.levelNo + towards) ?? mainD;
    let r = null;
    try {
      r = alignLevelTo(d.level, ref.level, { img: d.img, refImg: ref.img, stairs: d.stairsPx, refStairs: ref.stairsPx, findStairs: false, pxPerM: d.ppm, refPxPerM: ref.ppm, north: doc.settings.north });
    } catch (err) {
      r = { offset: [0, 0], method: 'corner', score: 0, detail: { error: String(err?.message ?? err) } };
    }
    d.level.offset = r.offset;
    d.align = r;
    step({ step: 'align', file: d.file, level: d.level.id, method: r.method, confidence: r.score >= 0.6 ? 'high' : r.score >= 0.3 ? 'medium' : 'low', detail: `mot ${ref.level.name}: forskyvning ${fmt(r.offset[0], 2)}, ${fmt(r.offset[1], 2)} m, poeng ${fmt(r.score, 2)}`, ms: Math.round(now() - t) });
  }
  for (let i = 1; i < byNo.length; i++) placeStair(byNo[i - 1], byNo[i]);
  // the export must take the stair: one it skips (a hole over a wall, no room under it) is taken out again, and asked
  if (byNo.some((d) => d.stairPlaced)) {
    let ex = null;
    try {
      ex = exportHouse(doc);
    } catch {
      ex = null;
    }
    for (const d of byNo.filter((x) => x.stairPlaced)) {
      const U = d.level;
      const bad = !ex || ex.report.warnings.find((w) => w.startsWith(`${U.name}: `) && /trapp|U-trappa/.test(w) && /hoppet over|går over en vegg|for liten|ingen tydelig retning|fant ikke rommet under/.test(w));
      if (!bad) continue;
      U.stairs = U.stairs.filter((s) => s !== d.stairPlaced);
      questions.push(stairQuestion({ level: U.id, levelName: U.name, file: d.file, crop: { file: d.file, level: U.id, bbox: cropBox(d.stairPlaced.rect, d.ppm, d.img) }, value: d.stairPlaced.kind === 'u' ? 'u' : 'straight', why: `Trappa kunne ikke bygges slik den ble funnet (${typeof bad === 'string' ? bad.replace(`${U.name}: `, '') : 'eksporten feilet'}). Tegn den inn i «Finjuster».` }));
      step({ step: 'stairs', file: d.file, level: U.id, method: 'none', confidence: 'low', detail: `tatt ut igjen: ${typeof bad === 'string' ? bad : 'eksporten feilet'}` });
      d.stairPlaced = null;
    }
  }

  /** A stair from the upper floor down to the lower one where both show it (or one shows it and the AI the other). */
  function placeStair(lower, upper) {
    if (upper.levelNo - lower.levelNo !== 1) return;
    const U = upper.level;
    const boxes = (d) => (d.stairsPx || []).map((s) => {
      const k = 1 / d.ppm;
      const off = d.level.offset || [0, 0];
      return { s, main: [s.bbox[0] * k + off[0], s.bbox[1] * k + off[1], s.bbox[2] * k + off[0], s.bbox[3] * k + off[1]] };
    });
    const bu = boxes(upper);
    const bl = boxes(lower);
    let pair = null;
    for (const a of bu) for (const b of bl) {
      const v = iou(a.main, b.main);
      if (v > 0.15 && (!pair || v > pair.v)) pair = { a, b, v };
    }
    const aiU = upper.aiPlan?.stair;
    const aiL = lower.aiPlan?.stair;
    let use = null;
    let why = '';
    if (pair) {
      // the larger of the two: a flight is often only partly drawn on one floor (up to the cut line below, behind a
      // wall above)
      const ar = (b) => (b[2] - b[0]) * (b[3] - b[1]);
      use = ar(pair.a.main) >= ar(pair.b.main) ? pair.a.main : pair.b.main;
      why = `begge etasjene viser trappa (overlapp ${Math.round(pair.v * 100)} %)`;
    } else if (bu.length && (aiL?.present || bl.length === 0) && aiU?.present !== false) {
      use = bu[0].main;
      why = `bare ${U.name.toLowerCase()} viser trappa tydelig`;
    } else if (bl.length && (aiU?.present || !upper.aiPlan)) {
      use = bl[0].main;
      why = `bare ${lower.level.name.toLowerCase()} viser trappa tydelig`;
    }
    const classical = pair?.a.s.kind ?? pair?.b.s.kind ?? bu[0]?.s.kind ?? bl[0]?.s.kind ?? null;
    const aiType = aiU?.present ? aiU.type : aiL?.present ? aiL.type : null;
    if (!use) {
      if (aiU?.present || aiL?.present) {
        questions.push(stairQuestion({ level: U.id, levelName: U.name, file: upper.file, crop: { file: upper.file, level: U.id, bbox: null }, value: 'straight', why: 'KI-en ser en trapp, men vi fant den ikke i tegningen. Tegn den inn i «Finjuster» om svaret er ja.' }));
        step({ step: 'stairs', file: upper.file, level: U.id, method: 'none', confidence: 'low', detail: `KI ser en trapp (${aiType ?? 'ukjent type'}), men den ble ikke funnet` });
      }
      return;
    }
    // the type: the classical kind (the treads), else the AI's
    let type = classical && classical !== 'unknown' ? classical : aiType && aiType !== 'unknown' && aiType !== 'none' ? aiType : null;
    const typeFrom = classical && classical !== 'unknown' ? 'tegningen' : type ? 'KI' : null;
    // into the upper level's frame, inside one of its rooms
    const off = U.offset || [0, 0];
    let rect = [[use[0] - off[0], use[1] - off[1]], [use[2] - off[0], use[3] - off[1]]];
    const fit = fitInRoom(U, rect);
    if (!fit) {
      questions.push(stairQuestion({ level: U.id, levelName: U.name, file: upper.file, crop: { file: upper.file, level: U.id, bbox: cropBox(rect, upper.ppm, upper.img) }, value: type === 'half-turn' ? 'u' : 'straight', why: 'Trappa går over en vegg i tegningen, så den ble ikke lagt inn. Tegn den inn i «Finjuster».', rect: null }));
      step({ step: 'stairs', file: upper.file, level: U.id, method: 'none', confidence: 'low', detail: `${why}, men hullet går over en vegg` });
      return;
    }
    rect = fit;
    // the stair lands in a room of the floor below (export.js needs it; the validator wants the stair's rooms on both)
    const lo = lower.level.offset || [0, 0];
    const cm = [(rect[0][0] + rect[1][0]) / 2 + off[0] - lo[0], (rect[0][1] + rect[1][1]) / 2 + off[1] - lo[1]];
    const lowerFound = lower.found ?? findRooms(lower.level.walls);
    if (roomAt(lowerFound, cm, 0.6) < 0) {
      questions.push(stairQuestion({ level: U.id, levelName: U.name, file: upper.file, crop: { file: upper.file, level: U.id, bbox: cropBox(rect, upper.ppm, upper.img) }, value: type === 'half-turn' ? 'u' : 'straight', why: `Vi fant ikke noe rom under trappa i ${lower.level.name.toLowerCase()}. Tegn den inn i «Finjuster» om den finnes.`, rect: null }));
      step({ step: 'stairs', file: upper.file, level: U.id, method: 'none', confidence: 'low', detail: `${why}, men det er ikke noe rom under den i ${lower.level.name}` });
      return;
    }
    const w = rect[1][0] - rect[0][0];
    const h = rect[1][1] - rect[0][1];
    const longSide = Math.max(w, h);
    const shortSide = Math.min(w, h);
    let kind = 'straight';
    let note = null;
    if (type === 'half-turn') kind = 'u';
    else if (type === 'quarter-turn' || type === 'spiral' || !type) {
      // the house format has straight and U stairs: the nearest for an L stair is a U in a squarish box
      kind = shortSide >= 1.3 && longSide / shortSide < 1.7 ? 'u' : 'straight';
      if (type) {
        note = `${U.name}: trappa er ${type === 'spiral' ? 'en spiraltrapp' : 'kvartsvingt (svinger 90°)'}, men husformatet har bare rette trapper og U-trapper. Den er lagt inn som ${kind === 'u' ? 'U-trapp' : 'rett trapp'}.`;
        report.notes.push(note);
        if (!report.requests.some((r) => /kvartsvingt/.test(r))) report.requests.push('Motoren (stairs.js og husformatet): kvartsvingte trapper (L-trapp med svingtrinn), så planbyggeren kan bygge dem som tegnet i stedet for som U-trapp eller rett trapp.');
      }
    }
    const axis = w >= h ? 'x' : 'y';
    const a = rect[0];
    const b = rect[1];
    const st = addStair(U, a, b);
    if (kind === 'u') st.kind = 'u';
    st.auto = true;
    st.from = { type, typeFrom, why };
    upper.stairPlaced = st;
    step({ step: 'stairs', file: upper.file, level: U.id, method: kind, confidence: pair ? 'high' : 'medium', detail: `${why}; ${type ?? 'ukjent type'}${typeFrom ? ` (fra ${typeFrom})` : ''} → ${kind === 'u' ? 'U-trapp' : 'rett trapp'} ${fmt(w, 2)} × ${fmt(h, 2)} m` });
    const unclear = !pair || !type || (aiType && classical && aiType !== classical && aiType !== 'unknown');
    if (unclear) questions.push(stairQuestion({ level: U.id, levelName: U.name, file: upper.file, crop: { file: upper.file, level: U.id, bbox: cropBox(rect, upper.ppm, upper.img) }, value: kind, why: `${why[0].toUpperCase()}${why.slice(1)}. ${type ? `Tegningen ser ut som ${TYPE_NO[type] ?? 'en trapp'}${aiType && classical && aiType !== classical && aiType !== 'unknown' ? `, men KI-en mener ${TYPE_NO[aiType] ?? aiType}` : ''}.` : 'Typen er usikker.'}`, stairId: st.id, rect: st.rect, axis }));
  }

  // ---- 7. facades
  progress('facades', 'Leser fasadene …', totalSteps);
  const facades = drawings.filter((d) => d.kind === 'facade');
  const storeys = Math.max(1, byNo.filter((d) => d.levelNo >= 0).length);
  const readings = [];
  for (const d of facades) {
    const t = now();
    const ai = await d.aiFacadeP;
    let r = null;
    try {
      r = await run('readFacade', d.img, { ai, storeys });
    } catch (err) {
      r = null;
      d.error = String(err?.message ?? err);
    }
    d.aiFacade = ai;
    d.reading = r;
    readings.push(d);
    step({ step: 'facade', file: d.file, method: r?.method ?? null, confidence: r?.confidence ?? 'low', detail: r ? `${d.title ? `«${d.title}»: ` : ''}${r.roof ?? 'ukjent tak'}${r.roofFrom === 'ai' ? ' (KI)' : ''}, ${r.windows.filter((w) => w.kind === 'window').length} vinduer, ${r.windows.filter((w) => w.kind === 'door').length} dører, ${fmt(r.pxPerM, 1)} px/m${r.skew ? `, skjev ${fmt(r.skew, 2)}°` : ''}` : 'ikke lest', ms: Math.round(now() - t) });
    // what the reading could not settle, for the wizard (facade.js notes)
    for (const n of r?.notes ?? []) if (/bakkelinje|Oppgitt \d+ etasje/.test(n)) report.notes.push(`«${d.file}»${d.title ? ` («${d.title}»)` : d.part != null ? ` (fasade ${d.part + 1})` : ''}: ${n}`);
  }
  // one sheet shares one scale: the surest door reading's
  const sheets = new Map();
  for (const d of readings) {
    if (!sheets.has(d.input)) sheets.set(d.input, []);
    sheets.get(d.input).push(d);
  }
  for (const list of sheets.values()) {
    if (list.length < 2) continue;
    const sure = list.filter((d) => d.reading?.method === 'door' && d.reading.confidence === 'high').sort((a, b) => b.reading.windows.filter((w) => w.kind === 'door').length - a.reading.windows.filter((w) => w.kind === 'door').length)[0];
    if (!sure) continue;
    for (const d of list) {
      if (d === sure || (d.reading?.method === 'door' && d.reading.confidence === 'high')) continue;
      try {
        const r = await run('readFacade', d.img, { ai: d.aiFacade, storeys, pxPerM: sure.reading.pxPerM });
        if (r) {
          d.reading = r;
          d.sharedFrom = sure;
          step({ step: 'facade', file: d.file, method: 'given', confidence: 'medium', detail: `skalaen fra en dør i en annen fasade på samme ark (${fmt(sure.reading.pxPerM, 1)} px/m)` });
        }
      } catch {
        /* keep its own reading */
      }
    }
  }
  const trusted = [];
  const storeyLevels = Object.fromEntries(byNo.filter((d) => d.levelNo >= 0).map((d) => [d.levelNo, d.level.id]));
  for (const d of readings) {
    const r = d.reading;
    if (!r) continue;
    if (r.method === 'eave' && r.confidence === 'low') {
      const wallPx = Number.isFinite(r.groundY) && Number.isFinite(r.eaveY) ? r.groundY - r.eaveY : null;
      questions.push(facadeQuestion({ file: d.file, part: d.part, crop: { file: d.file, level: null, bbox: d.bbox }, wallPx, pxPerM: r.pxPerM, reading: { floorYs: r.floorYs, windows: r.windows.map((w) => ({ y0: w.y0, y1: w.y1, kind: w.kind, storey: w.storey })) }, storeyLevels, title: d.title }));
      continue;
    }
    trusted.push(r);
  }
  if (readings.length) {
    const roof = houseRoof(readings.map((d) => d.reading).filter(Boolean));
    doc.roof = { type: roof, from: readings.some((d) => d.reading?.roofFrom === 'ai') ? 'fasader+KI' : 'fasader', facades: readings.length };
    step({ step: 'roof', method: 'facades', confidence: readings.length >= 2 ? 'medium' : 'low', detail: `${roof ?? 'ukjent'} fra ${readings.length} fasade${readings.length === 1 ? '' : 'r'}` });
    if (!report.requests.some((r) => /takform/.test(r))) report.requests.push('Husformatet og motoren: et felt for takformen (saltak, pulttak, valm …) og skrå himling, så fasadenes tak kan bygges. I dag står takformen bare i dokumentet (doc.roof).');
  }
  doc.facades = readings.map((d) => ({ file: d.file, part: d.part, title: d.title, roof: d.reading?.roof ?? null, method: d.reading?.method ?? null, confidence: d.reading?.confidence ?? null, pxPerM: d.reading?.pxPerM ?? null, windows: d.reading ? d.reading.windows.filter((w) => w.kind === 'window').length : null, doors: d.reading ? d.reading.windows.filter((w) => w.kind === 'door').length : null, storeys: d.reading?.storeys ?? null }));
  // sill and height per storey → the windows of that level
  const perStorey = windowsPerStorey(trusted);
  if (Object.keys(perStorey).length) {
    for (const [k, w] of Object.entries(perStorey)) {
      const lid = storeyLevels[k];
      const L = lid ? doc.levels.find((l) => l.id === lid) : null;
      if (!L) continue;
      const n = setWindowHeights(L, w, { ceiling: doc.settings.ceiling });
      L.generated.windows = { sill: w.sill, height: w.height, from: 'fasader', n: w.n };
      step({ step: 'windows', level: L.id, method: 'facades', confidence: w.n >= 3 ? 'medium' : 'low', detail: `${n} vinduer: brystning ${fmt(w.sill, 2)} m, høyde ${fmt(w.height, 2)} m (median av ${w.n} fasadevinduer)` });
    }
  } else {
    // no facades: per room kind
    for (const d of byNo) {
      const L = d.level;
      const found = d.found ?? findRooms(L.walls);
      const kindAt = new Map();
      for (const r of L.rooms) {
        const idx = found.at(r.seed[0], r.seed[1]);
        if (idx >= 0) kindAt.set(idx, r.kind);
      }
      for (const op of L.openings) {
        if (op.type !== 'window') continue;
        const w = wallById(L, op.wall);
        if (!w) continue;
        const c = wallPoint(w, op.at);
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
        const n = [-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len];
        const sides = [1, -1].map((s) => found.at(c[0] + n[0] * s * (w.t / 2 + 0.1), c[1] + n[1] * s * (w.t / 2 + 0.1))).filter((i) => i >= 0);
        const kind = sides.map((i) => kindAt.get(i)).find(Boolean);
        const def = WINDOW_BY_KIND[kind];
        if (def) {
          op.sill = def.sill;
          op.height = def.height;
        }
      }
      L.generated.windows = { sill: DEFAULT_SETTINGS.windowSill, height: DEFAULT_SETTINGS.windowHeight, from: 'romtype' };
    }
    if (byNo.length) questions.push(windowsQuestion({ sill: DEFAULT_SETTINGS.windowSill, height: DEFAULT_SETTINGS.windowHeight }));
    step({ step: 'windows', method: 'room-kind', confidence: 'low', detail: 'ingen fasader: brystning 0,9 / høyde 1,2 m, bad og vaskerom høyere' });
  }

  // ---- the 3D house must be valid (validateHouse): repairs that only change what the detection could not know, each
  //      kept only when it lowers the number of errors – a door whose open leaf blocks the way (D6) is hinged at its
  //      other jamb, swung the other way or opened to 180°; of two passages the export puts on one room wall, the
  //      smaller goes; collinear walls a few mm apart in thickness (the export pairs their faces) get one thickness
  progress('validate', 'Kontrollerer huset …', totalSteps);
  // (a house without levels has nothing to check: the note about the missing plans says it)
  const validate = doc.levels.length ? await makeValidator(opts.validate) : null;
  if (validate) {
    const t = now();
    const check = async () => {
      try {
        return await validate(doc);
      } catch (err) {
        return { ex: null, errors: [`kontrollen feilet: ${err?.message ?? err}`], warnings: [], failed: true };
      }
    };
    let res = await check();
    const before = res.errors.length;
    const fixes = [];
    /** Tries changes in turn (each: apply() → undo); keeps the first that lowers the errors (and passes ok(res)). */
    const attempt = async (variants, ok = () => true) => {
      for (const v of variants) {
        const undo = v.apply();
        const r2 = await check();
        if (!r2.failed && r2.errors.length < res.errors.length && ok(r2)) {
          res = r2;
          return v;
        }
        undo();
      }
      return null;
    };
    if (!res.failed) {
      // doors
      const tried = new Set();
      for (let round = 0; round < 6; round++) {
        const todo = res.errors.map(parseBlocked).filter(Boolean).map((b) => docDoorOf(doc, res.ex, b)).filter((h) => h && !tried.has(h.op));
        if (!todo.length) break;
        const { L, op } = todo[0];
        tried.add(op);
        const flip = (h) => (h === 'end' ? 'start' : 'end');
        const set = (v, label) => ({
          label,
          apply: () => {
            const orig = { hinge: op.hinge, side: op.side, openAngle: op.openAngle };
            Object.assign(op, v);
            return () => {
              Object.assign(op, orig);
              if (op.openAngle == null) delete op.openAngle;
            };
          },
        });
        const variants = op.variant === 'double'
          ? [set({ openAngle: 180 }, 'åpningsvinkel 180°')]
          : [set({ hinge: flip(op.hinge) }, 'hengsel byttet'), set({ side: -(op.side || 1) }, 'slagretning byttet'), set({ hinge: flip(op.hinge), side: -(op.side || 1) }, 'hengsel og slagretning byttet'), set({ openAngle: 180 }, 'åpningsvinkel 180°'), set({ hinge: flip(op.hinge), openAngle: 180 }, 'hengsel byttet, 180°')];
        const still = (r2) => !r2.errors.map(parseBlocked).filter(Boolean).map((b) => docDoorOf(doc, r2.ex, b)).some((h) => h?.op === op);
        const v = await attempt(variants, still);
        if (v) fixes.push(`${L.name}: dør ${v.label}`);
      }
      // two passages on one room wall
      const gone = new Set();
      for (let round = 0; round < 8; round++) {
        const ov = res.errors.map(parseOverlap).filter(Boolean).map((o) => smallerOf(doc, res.ex, o)).filter((h) => h && !gone.has(h.op));
        if (!ov.length) break;
        const { L, op } = ov[0];
        gone.add(op);
        const drop = {
          label: 'åpning fjernet',
          apply: () => {
            const i = L.openings.indexOf(op);
            L.openings.splice(i, 1);
            return () => L.openings.splice(i, 0, op);
          },
        };
        if (await attempt([drop])) fixes.push(`${L.name}: en åpning som lå oppå en annen, er fjernet`);
      }
      // wall thicknesses a few mm apart on one line
      if (res.errors.some((e) => /backOf-par|står inne i rommet|overlapper \(to vegger/.test(e))) {
        const unify = {
          label: 'veggtykkelser',
          apply: () => {
            const saved = doc.levels.map((L) => JSON.stringify(L.walls));
            for (const L of doc.levels) unifyWalls(L);
            return () => doc.levels.forEach((L, i) => (L.walls = JSON.parse(saved[i])));
          },
        };
        if (await attempt([unify])) fixes.push('like tykkelser på vegglinjer som skifter noen millimeter');
      }
      // one thin line found twice, a few cm apart (hus9's kitchen line): the export puts both walls' passages on one
      // room wall, on top of each other
      if (res.errors.some((e) => /overlapper/.test(e))) {
        const twins = {
          label: 'doble vegger',
          apply: () => {
            const saved = doc.levels.map((L) => JSON.stringify({ walls: L.walls, openings: L.openings }));
            for (const L of doc.levels) mergeTwinWalls(L);
            return () => doc.levels.forEach((L, i) => Object.assign(L, JSON.parse(saved[i])));
          },
        };
        if (await attempt([twins])) fixes.push('en vegg som var funnet to ganger, noen centimeter fra hverandre, er slått sammen');
      }
    }
    if (fixes.length) report.notes.push(`Rettet for 3D-huset: ${fixes.join('; ')}.`);
    report.validation = { errors: res.errors, warnings: res.warnings.length, before, fixes };
    step({ step: 'validate', method: 'validateHouse', confidence: res.errors.length ? 'low' : 'high', detail: `${res.errors.length} feil${before !== res.errors.length ? ` (var ${before})` : ''}, ${res.warnings.length} advarsler${fixes.length ? `; rettet: ${fixes.join('; ')}` : ''}${res.errors.length ? `: ${res.errors.slice(0, 3).join(' | ')}` : ''}`, ms: Math.round(now() - t) });
    if (res.errors.length) report.notes.push(`Kontrollen fant ${res.errors.length} feil i 3D-huset; rett dem i «Finjuster» (${res.errors.slice(0, 2).join('; ')}${res.errors.length > 2 ? ' …' : ''}).`);
  }

  // ---- 8. questions
  progress('questions', 'Lager spørsmålene …', totalSteps);
  if (ordered.confidence === 'low' && byNo.length > 1) questions.push(orderQuestion({ levels: byNo.map((d) => ({ id: d.level.id, name: d.level.name, file: d.file })), why: ordered.why }));
  for (const p of altPairs) {
    const d = byNo.find((x) => x.file === p.used);
    questions.push(alternativeQuestion({ file: p.file, alternative: p.alternative, levelName: d?.level.name ?? 'etasjen' }));
    report.notes.push(`«${p.alternative}» er et alternativ til «${p.file}»; huset er bygd med «${p.used}».`);
    step({ step: 'order', file: p.alternative, method: 'filnavn', confidence: 'medium', detail: `alternativ til «${p.file}», ikke brukt${p.used === p.alternative ? ' (byttet etter svar)' : ''}` });
  }
  for (const d of byNo) {
    const L = d.level;
    const crop = { file: d.file, level: L.id, bbox: null };
    const s = d.scale;
    const ai = d.aiPlan;
    const printed = ai ? ai.rooms.some((r) => r.area > 0) || ai.labels.some((l) => l.area > 0) || ai.dimensions.length > 0 || !!ai.scaleText : null;
    const unsure = s.method === 'standard' || s.confidence === 'low' || !d.inheritChecked;
    if (s.method !== 'given' && unsure) {
      if (printed === false) {
        const inner = innerArea(d.det, d.found, d.ppm);
        questions.push(braQuestion({ key: d.key, level: L.id, levelName: L.name, file: d.file, crop, innerM2: inner, pxPerM: d.ppm, confidence: s.confidence }));
      } else {
        const why = s.method === 'standard' ? 'Vi fant ingen mål, arealer eller målestokk vi kunne bruke.' : !d.inheritChecked ? 'Målestokken er hentet fra en annen etasje, men omrisset av huset stemmer ikke med den etasjens.' : 'Målene på tegningen stemmer dårlig med hverandre.';
        questions.push(scaleQuestion({ key: d.key, level: L.id, file: d.file, crop, outlinePx: s.outline?.w ?? null, pxPerM: d.ppm, method: s.method, confidence: s.confidence, why }));
      }
    }
    // nothing to walk in: said, with the way on (the editor)
    if (weakLevel(d)) {
      questions.push(wallsQuestion({ level: L.id, levelName: L.name, file: d.file, crop, walls: d.det.walls.length }));
      report.notes.push(`${L.name} («${d.file}»): ${d.det.walls.length ? `${d.det.walls.length} vegger, men ingen rom å gå i` : 'ingen vegger'} ble funnet. Tegn etasjen i «Finjuster».`);
    }
    const loft = (L.skylights?.length ?? 0) > 0 || /loft/i.test(`${d.file} ${ai?.levelTitle ?? ''}`) || (ai?.rooms ?? []).some((r) => /loft/i.test(r.name));
    questions.push(ceilingQuestion({ level: L.id, levelName: L.name, file: d.file, crop, value: L.ceiling ?? DEFAULT_SETTINGS.ceiling, texts: (ai?.ceiling ?? []).filter((x) => !/åpent opp|apent opp/i.test(x)), loft }));
    // the rooms without a name from the drawing
    if (d.found) {
      for (const idx of d.rooms?.unnamed ?? []) {
        const room = d.found.rooms[idx];
        if (!room || room.area < o.roomQuestionMin) continue;
        const f = roomFeatures(L, d.found).get(idx) ?? { doors: 0, windows: 0, exteriorDoors: 0 };
        const largest = d.found.rooms.reduce((b, r) => (!b || r.area > b.area ? r : b), null);
        const kind = guessKind({ area: room.area, ...f }, room === largest);
        const rid = `r${L.rooms.length + 1 + idx}`;
        questions.push(roomQuestion({ level: L.id, levelName: L.name, file: d.file, crop: { file: d.file, level: L.id, bbox: cropBox(room.polygon, d.ppm, d.img) }, roomId: rid, seed: [round(room.inside[0], 3), round(room.inside[1], 3)], area: room.area, name: KIND_LABEL[kind] ?? 'Rom', kind, why: ai ? 'KI-en fant ingen etikett i dette rommet.' : 'Uten KI kan ikke romnavnene leses. Typen er gjettet ut fra størrelse, dører og vinduer.' }));
      }
    }
  }

  // answers from an earlier run that are not inputs to the flow
  let outDoc = doc;
  const rest = Object.fromEntries(Object.entries(answers).filter(([k]) => !/^(scale:|bra:|alternative:)/.test(k)));
  if (Object.keys(rest).length) outDoc = applyAnswers(doc, questions, rest);
  report.ms = Math.round(now() - T0);
  progress('done', 'Ferdig', totalSteps);
  return { doc: outDoc, questions, report, images };
}

const KIND_LABEL = { living: 'Stue', bedroom: 'Soverom', bathroom: 'Bad', hall: 'Gang', laundry: 'Vaskerom', storage: 'Bod', entrance: 'Entré' };
const TYPE_NO = { straight: 'en rett trapp', 'quarter-turn': 'en kvartsvingt trapp', 'half-turn': 'en U-trapp', spiral: 'en spiraltrapp' };

const kindOf = (op) => (op.type === 'door' ? op.variant ?? 'single' : op.type);

/**
 * The kind an AI opening gives one of ours, or null to keep ours. The AI wins only where the classical reading is the
 * weaker evidence. Measured on the recorded Haiku answers (round 1): the detection's own variants were right on hus1,
 * hus2 and hus5 (4/2/1, 10/0/5, 10/0/4), and every other change the AI asked for made a count worse – a window → a
 * sliding door (hus2, hus3), a plain passage → a hinged door (hus2, hus5); Haiku over-counts hinged doors and
 * under-counts sliding ones on marked plans (notes). So the AI decides only
 *   - a hinged door wide enough for two leaves (≥ 1.05 m) that it calls a double door (two arcs read as one);
 *   - a plain passage in an interior wall that it calls a sliding door (a pocket door drawn as a gap: hus8).
 */
function aiOpeningKind(op, aiKind, L) {
  const ours = kindOf(op);
  const want = { door: 'single', 'double-door': 'double', 'sliding-door': 'sliding', window: 'window', opening: 'opening' }[aiKind];
  if (!want || want === ours) return null;
  const exterior = !!wallById(L, op.wall)?.exterior;
  if (ours === 'single' && want === 'double') return op.width >= 1.05 ? 'double' : null;
  if (ours === 'opening' && want === 'sliding' && !exterior) return 'sliding';
  return null;
}

/** Doors, windows and front doors per found room (the features export.js guessKind uses). */
function roomFeatures(L, found) {
  const feat = new Map();
  const F = (i) => feat.get(i) ?? feat.set(i, { doors: 0, windows: 0, exteriorDoors: 0 }).get(i);
  for (const op of L.openings) {
    const w = wallById(L, op.wall);
    if (!w) continue;
    const c = wallPoint(w, op.at);
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const n = [-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len];
    const sides = [1, -1].map((s) => found.at(c[0] + n[0] * s * (w.t / 2 + 0.06), c[1] + n[1] * s * (w.t / 2 + 0.06)));
    const outside = sides.some((i) => i === -1);
    for (const i of sides) {
      if (i < 0) continue;
      if (op.type === 'window') F(i).windows++;
      else {
        F(i).doors++;
        if (op.type === 'door' && outside) F(i).exteriorDoors++;
      }
    }
  }
  return feat;
}

/**
 * A stair hole rect inside one room of the level: the room under the rect's centre, and the rect shrunk to the room's
 * polygon until at least 95 % of it lies inside (export.js skips a hole that crosses a wall). → rect | null
 */
function fitInRoom(L, rect) {
  const found = findRooms(L.walls);
  const c = [(rect[0][0] + rect[1][0]) / 2, (rect[0][1] + rect[1][1]) / 2];
  let idx = roomAt(found, c, 0.5);
  if (idx < 0) {
    // the room that holds most of it
    let best = 0;
    for (const r of found.rooms) {
      const a = Math.abs(signedArea(clipPolygon(r.polygon, rectPoly(rect))));
      if (a > best) {
        best = a;
        idx = r.index;
      }
    }
  }
  if (idx < 0) return null;
  const poly = found.rooms[idx].polygon;
  const full = (rect[1][0] - rect[0][0]) * (rect[1][1] - rect[0][1]);
  const cl = clipPolygon(poly, rectPoly(rect));
  if (cl.length >= 3 && Math.abs(signedArea(cl)) >= 0.97 * full) return rect.map((p) => [round(p[0], 4), round(p[1], 4)]);
  // the largest axis-parallel rectangle of the stair box that lies in the room (5 cm cells, the histogram method), 2 cm
  // in from the walls
  const res = 0.05;
  const nx = Math.max(1, Math.round((rect[1][0] - rect[0][0]) / res));
  const ny = Math.max(1, Math.round((rect[1][1] - rect[0][1]) / res));
  const dx = (rect[1][0] - rect[0][0]) / nx;
  const dy = (rect[1][1] - rect[0][1]) / ny;
  const heights = new Array(nx).fill(0);
  let best = null;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = [rect[0][0] + (i + 0.5) * dx, rect[0][1] + (j + 0.5) * dy];
      heights[i] = pointInPolygon(p, poly) ? heights[i] + 1 : 0;
    }
    const stack = [];
    for (let i = 0; i <= nx; i++) {
      const hgt = i < nx ? heights[i] : 0;
      let start = i;
      while (stack.length && stack[stack.length - 1][1] >= hgt) {
        const [s0, h0] = stack.pop();
        const area = h0 * (i - s0) * dx * dy;
        if (!best || area > best.area) best = { area, i0: s0, i1: i, j0: j - h0 + 1, j1: j + 1 };
        start = s0;
      }
      stack.push([start, hgt]);
    }
  }
  if (!best || best.area < 0.4 * full) return null;
  const r = [[rect[0][0] + best.i0 * dx + 0.02, rect[0][1] + best.j0 * dy + 0.02], [rect[0][0] + best.i1 * dx - 0.02, rect[0][1] + best.j1 * dy - 0.02]];
  if (r[1][0] - r[0][0] < 0.75 || r[1][1] - r[0][1] < 0.75) return null;
  return r.map((p) => [round(p[0], 4), round(p[1], 4)]);
}
const rectPoly = (r) => [[r[0][0], r[0][1]], [r[1][0], r[0][1]], [r[1][0], r[1][1]], [r[0][0], r[1][1]]];

/**
 * Walls with no room of minArea m² on either side – text, ticks and pointer lines a fallback reading made walls of,
 * outside the house – go, with their openings. → how many
 */
function dropLoose(L, minArea) {
  let total = 0;
  // a wall between a room and a scrap under 1 m² (a dimension's ticks boxing in a corner) goes too, one at a time
  for (let round = 0; round < 4; round++) {
    const found = findRooms(L.walls);
    const big = new Set(found.rooms.filter((r) => r.area >= minArea).map((r) => r.index));
    const scrap = new Set(found.rooms.filter((r) => r.area < 1).map((r) => r.index));
    if (!big.size) return total;
    const sidesOf = (w) => {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
      const n = [-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len];
      const out = [];
      for (const f of [0.25, 0.5, 0.75]) {
        const c = [w.a[0] + (w.b[0] - w.a[0]) * f, w.a[1] + (w.b[1] - w.a[1]) * f];
        for (const sg of [1, -1]) out.push(found.at(c[0] + n[0] * sg * (w.t / 2 + 0.08), c[1] + n[1] * sg * (w.t / 2 + 0.08)));
      }
      return out;
    };
    const loose = [];
    let fence = null;
    for (const w of L.walls) {
      const sides = sidesOf(w);
      if (!sides.some((i) => big.has(i))) loose.push(w.id);
      else if (!fence && sides.some((i) => scrap.has(i)) && sides.every((i) => big.has(i) || scrap.has(i))) fence = w.id;
    }
    if (!loose.length && fence) loose.push(fence);
    if (!loose.length) return total;
    const gone = new Set(loose);
    L.walls = L.walls.filter((w) => !gone.has(w.id));
    L.openings = (L.openings || []).filter((op) => !gone.has(op.wall));
    total += gone.size;
  }
  return total;
}

/** How a level's walls were read (report and notes). */
const WALLS_FROM = { clean: 'med ryddingen', raw: 'uten ryddingen', outlined: 'som konturlinjer (to tynne streker per vegg)', provisional: 'fra den foreløpige gjenkjenningen' };

const arr = (v) => (Array.isArray(v) ? v : []);
const isPoint = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite);

/** A detection as generate uses it: the arrays always there (an executor may hand back null or half a result). */
function tidyDetection(det) {
  const d = det && typeof det === 'object' ? det : {};
  return { ...d, walls: arr(d.walls), openings: arr(d.openings), skylights: arr(d.skylights), stairs: arr(d.stairs), stats: d.stats && typeof d.stats === 'object' ? d.stats : {} };
}

/** A readPlan answer with its lists always lists and its points points (an injected transport may answer {}); null stays. */
function tidyPlan(ai) {
  if (!ai || typeof ai !== 'object') return null;
  // «GARASJE 30,25»: the area printed after the name is the area, not part of the name
  const strip = (x, key) => {
    const m = typeof x[key] === 'string' ? x[key].match(/^(.*?\S)[\s:]+(\d{1,4}[.,]\d{1,2})\s*(?:m2|m²)?$/i) : null;
    if (!m) return x;
    const a = Number(m[2].replace(',', '.'));
    return { ...x, [key]: m[1], area: x.area > 0 ? x.area : a };
  };
  const items = (v, key = null) => arr(v).filter((x) => x && typeof x === 'object').map((x) => (key ? strip(x, key) : x)).map((x) => (x.at == null || isPoint(x.at) ? x : { ...x, at: null }));
  const stair = ai.stair && typeof ai.stair === 'object' ? { ...ai.stair, at: isPoint(ai.stair.at) ? ai.stair.at : null } : { present: false, at: null, type: 'none', up: 'unknown' };
  return {
    ...ai,
    levelTitle: typeof ai.levelTitle === 'string' ? ai.levelTitle : null,
    scaleText: typeof ai.scaleText === 'string' ? ai.scaleText : null,
    rooms: items(ai.rooms, 'name'),
    labels: items(ai.labels, 'text'),
    dimensions: items(ai.dimensions),
    openings: items(ai.openings),
    skylights: items(ai.skylights).filter((s) => isPoint(s.at)),
    stair,
    ceiling: arr(ai.ceiling).filter((x) => typeof x === 'string'),
    furniture: items(ai.furniture),
  };
}

/** A classify answer's drawings that have a box (normalised); [] for none. */
const classifyDrawings = (cls) => arr(cls?.drawings).filter((d) => d && typeof d === 'object' && isBox(d.bbox));

/**
 * Walls drawn as two thin lines with paper between (hus7's garage: 12 px apart at 117 px/m) → solid ink: along every
 * row and column, a gap of paper of at most 0.2 m between two ink pixels is filled. Only for a level that has no room
 * otherwise (rescueWalls): it also fills text and the gaps in hatching, which a plan with walls does not need.
 * → an RGBA image (black ink on white), or null when there is too little ink to go by
 */
function fillOutlinedWalls(img, ppm) {
  const g = luma(img);
  const { w, h } = g;
  const n = w * h;
  const ink = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (g.data[i] < 128) {
    ink[i] = 1;
    count++;
  }
  if (count < 0.002 * n) return null;
  const gap = Math.max(3, Math.round(0.2 * (ppm > 0 ? ppm : 50)));
  const out = ink.slice();
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      if (last >= 0 && x - last > 1 && x - last - 1 <= gap) for (let k = last + 1; k < x; k++) out[y * w + k] = 1;
      last = x;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < h; y++) {
      if (!ink[y * w + x]) continue;
      if (last >= 0 && y - last > 1 && y - last - 1 <= gap) for (let k = last + 1; k < y; k++) out[k * w + x] = 1;
      last = y;
    }
  }
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = out[i] ? 0 : 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/**
 * A house whose walls stand on three sides of a rectangle and leave the fourth open (a garage or a carport: the doors
 * are gaps in the plan, with no line across): that side is closed by a wall, with a passage where no wall stood, so
 * the inside is a room. Only the long walls (≥ 1.5 m) count; the walls short of the open side are lengthened to it,
 * and short pieces on it (the piers beside the gates) become the solid parts of the new wall.
 * → Norwegian text about what was closed, or null when the walls are not like that
 */
function closeOpenSide(L) {
  const axisOf = (w) => (Math.abs(w.a[1] - w.b[1]) < 0.02 ? 'h' : Math.abs(w.a[0] - w.b[0]) < 0.02 ? 'v' : null);
  const len = (w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const long = L.walls.filter((w) => axisOf(w) && len(w) >= 1.5);
  if (long.length < 3) return null;
  const xs = long.flatMap((w) => [w.a[0], w.b[0]]);
  const ys = long.flatMap((w) => [w.a[1], w.b[1]]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const W = box[2] - box[0];
  const H = box[3] - box[1];
  if (W < 2 || H < 2) return null;
  const tol = 0.3;
  // per side: the share of its length that long walls on it cover
  const sides = [
    { name: 'top', ax: 'h', at: box[1], from: box[0], to: box[2] },
    { name: 'bottom', ax: 'h', at: box[3], from: box[0], to: box[2] },
    { name: 'left', ax: 'v', at: box[0], from: box[1], to: box[3] },
    { name: 'right', ax: 'v', at: box[2], from: box[1], to: box[3] },
  ];
  const k = (s) => (s.ax === 'h' ? 1 : 0);
  const u = (s) => 1 - k(s);
  for (const s of sides) {
    const on = long.filter((w) => axisOf(w) === s.ax && Math.abs(w.a[k(s)] - s.at) <= tol);
    let cover = 0;
    for (const w of on) cover += Math.max(0, Math.min(Math.max(w.a[u(s)], w.b[u(s)]), s.to) - Math.max(Math.min(w.a[u(s)], w.b[u(s)]), s.from));
    s.cover = cover / (s.to - s.from);
    s.walls = on;
  }
  const open = sides.filter((s) => s.cover < 0.3);
  if (open.length !== 1 || sides.some((s) => s !== open[0] && s.cover < 0.6)) return null;
  const s = open[0];
  const ts = long.map((w) => w.t).sort((a, b) => a - b);
  const t = ts[ts.length >> 1];
  // the arms: the two long walls across the open side at its ends. The new wall goes where the shorter one ends (the
  // longer one may have run into a title or a dimension below it); the other is cut or lengthened to it, by at most 1 m
  const across = s.ax === 'h' ? 'v' : 'h';
  const sign = s.name === 'bottom' || s.name === 'right' ? 1 : -1;
  const arms = [s.from, s.to].map((c) => long.filter((w) => axisOf(w) === across && Math.abs(w.a[u(s)] - c) <= tol).sort((p, q) => sign * (Math.max(sign * q.a[k(s)], sign * q.b[k(s)]) - Math.max(sign * p.a[k(s)], sign * p.b[k(s)])))[0]);
  if (arms.some((w) => !w)) return null;
  const endOf = (w) => (sign * w.a[k(s)] > sign * w.b[k(s)] ? 'a' : 'b');
  const line = sign > 0 ? Math.min(...arms.map((w) => w[endOf(w)][k(s)])) : Math.max(...arms.map((w) => w[endOf(w)][k(s)]));
  if (Math.abs(line - s.at) > 1) return null;
  s.at = line;
  for (const w of arms) {
    const end = endOf(w);
    const p = w[end];
    w[end] = s.ax === 'h' ? [round(p[0], 4), round(line, 4)] : [round(line, 4), round(p[1], 4)];
  }
  // the short pieces on the side are its solid parts; the rest between the corners is open
  const pieces = L.walls.filter((w) => axisOf(w) === s.ax && Math.abs(w.a[k(s)] - s.at) <= tol && len(w) < 1.5);
  const solid = pieces.map((w) => [Math.min(w.a[u(s)], w.b[u(s)]), Math.max(w.a[u(s)], w.b[u(s)])]).sort((a, b) => a[0] - b[0]);
  const drop = new Set(pieces.map((w) => w.id));
  L.walls = L.walls.filter((w) => !drop.has(w.id));
  L.openings = (L.openings || []).filter((op) => !drop.has(op.wall));
  const a = s.ax === 'h' ? [s.from, s.at] : [s.at, s.from];
  const b = s.ax === 'h' ? [s.to, s.at] : [s.at, s.to];
  const wall = addWall(L, a, b, t);
  wall.exterior = true;
  wall.auto = true;
  wall.from = 'closed';
  // the gaps: from the corner (half a wall in) to the first solid piece, between the pieces, to the other corner
  const gaps = [];
  let cur = s.from + t;
  for (const [p0, p1] of solid) {
    if (p0 - cur >= 0.6) gaps.push([cur, p0]);
    cur = Math.max(cur, p1);
  }
  if (s.to - t - cur >= 0.6) gaps.push([cur, s.to - t]);
  for (const [g0, g1] of gaps) {
    L.openings.push({ id: `o-port-${L.openings.length + 1}`, wall: wall.id, type: 'opening', at: round((g0 + g1) / 2 - s.from, 4), width: round(g1 - g0, 4), auto: true, from: 'closed' });
  }
  const where = { top: 'øverst', bottom: 'nederst', left: 'til venstre', right: 'til høyre' }[s.name];
  return `den åpne siden ${where} er lukket med en vegg med ${gaps.length} åpning${gaps.length === 1 ? '' : 'er'} der portene står`;
}

/**
 * The validator for the finished document: opts.validate (doc → { ex, errors, warnings }, may be async), false for
 * none, or by default the game's own validateHouse (src/data/scripts/house.mjs, as app.js runs it: no furniture, so no
 * archetypes) – null when it cannot be loaded (house.mjs reads JSON: Node needs the loader hook in planbygger-lib.mjs,
 * the browser the shims of tools/planbygger-vite-plugin.mjs).
 */
async function makeValidator(v) {
  if (v === false) return null;
  if (typeof v === 'function') return v;
  try {
    const H = await import('../data/scripts/house.mjs');
    return (doc) => {
      const ex = exportHouse(doc);
      const spec = H.mergeHouse(baseSpec(doc.name), null, { files: [{ name: '10-plan.json', data: ex.house }], registry: ex.registry });
      const rep = H.validateHouse(spec, { registry: ex.registry, archetypes: { archetypes: {}, archetypeAliases: {} }, throw: false });
      return { ex, errors: rep.errors.filter((m) => !ownerOnly(m)), warnings: rep.warnings };
    };
  } catch {
    return null;
  }
}

/** A validator error about an open door leaf blocking the way → { doorId, wallId } | null. */
function parseBlocked(msg) {
  const m = /^openings\/(\S+) \((\S+)\): det åpne dørbladet/.exec(msg);
  return m ? { doorId: m[1], wallId: m[2] } : null;
}

/** The document's opening behind an exported one (by position: the export's ids are its own) → { L, op } | null. */
function docOpeningOf(doc, ex, openingId, wallId, type = null) {
  const w = ex?.house?.walls?.find((x) => x.id === wallId);
  const e = w?.openings?.find((x) => x.id === openingId);
  if (!w || !e) return null;
  const levelId = ex.house.rooms.find((r) => r.id === w.roomId)?.levelId;
  const L = doc.levels.find((l) => l.id === levelId);
  if (!L) return null;
  const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]) || 1;
  const s = e.offset + e.width / 2;
  const g = [w.from[0] + ((w.to[0] - w.from[0]) / len) * s, w.from[1] + ((w.to[1] - w.from[1]) / len) * s];
  const p = ex.frame.toPlan(g, levelId);
  let best = null;
  for (const op of L.openings) {
    if (type && op.type !== type) continue;
    const c = openingCentre(L, op);
    const d = c ? dist(c, p) : Infinity;
    if (d <= 0.6 && (!best || d < best.d)) best = { L, op, d, width: e.width };
  }
  return best;
}
const docDoorOf = (doc, ex, { doorId, wallId }) => docOpeningOf(doc, ex, doorId, wallId, 'door');

/** «openings/A overlapper B i veggen W» → { a, b, wallId } | null. */
function parseOverlap(msg) {
  const m = /^openings\/(\S+) overlapper (\S+) i veggen (\S+)/.exec(msg);
  return m ? { a: m[1], b: m[2], wallId: m[3] } : null;
}

/** Of two exported openings that overlap, the document's opening behind the smaller (a passage before a door). */
function smallerOf(doc, ex, { a, b, wallId }) {
  const A = docOpeningOf(doc, ex, a, wallId);
  const B = docOpeningOf(doc, ex, b, wallId);
  if (!A || !B) return A ?? B ?? null;
  // one opening of ours the export put on the wall twice: it goes (the other room's piece keeps the passage)
  if (A.op === B.op) return A;
  const rank = (h) => (h.op.type === 'opening' ? 0 : 100) + h.width;
  return rank(A) <= rank(B) ? A : B;
}

/**
 * Collinear walls of one level whose thickness differs by a few mm (a line drawn 10 and 10.6 cm thick: the export pairs
 * one room's face with the other wall's): both get the thicker one's thickness and centre line. → how many pairs
 */
function unifyWalls(L) {
  let n = 0;
  const ws = L.walls;
  const axisOf = (w) => (Math.abs(w.a[1] - w.b[1]) < 1e-6 ? 'h' : Math.abs(w.a[0] - w.b[0]) < 1e-6 ? 'v' : null);
  for (let i = 0; i < ws.length; i++) {
    for (let j = i + 1; j < ws.length; j++) {
      const A = ws[i];
      const B = ws[j];
      const ax = axisOf(A);
      if (!ax || ax !== axisOf(B)) continue;
      const k = ax === 'h' ? 1 : 0;
      const u = 1 - k;
      if (Math.abs(A.a[k] - B.a[k]) > 0.02) continue;
      const gap = Math.max(Math.min(A.a[u], A.b[u]), Math.min(B.a[u], B.b[u])) - Math.min(Math.max(A.a[u], A.b[u]), Math.max(B.a[u], B.b[u]));
      if (gap > 0.05) continue;
      const dt = Math.abs(A.t - B.t);
      if (dt < 1e-4 || dt > 0.015) continue;
      const [thick, thin] = A.t >= B.t ? [A, B] : [B, A];
      thin.t = thick.t;
      thin.a[k] = thick.a[k];
      thin.b[k] = thick.b[k];
      n++;
    }
  }
  return n;
}

/**
 * Parallel axis walls of one level whose centre lines lie closer than their thicknesses together (one thin line the
 * detection found twice): one wall over both spans, as thick as both together, and the other's openings moved onto it
 * at the same place. → how many pairs
 */
function mergeTwinWalls(L) {
  let n = 0;
  const axisOf = (w) => (Math.abs(w.a[1] - w.b[1]) < 1e-6 ? 'h' : Math.abs(w.a[0] - w.b[0]) < 1e-6 ? 'v' : null);
  for (let i = 0; i < L.walls.length; i++) {
    for (let j = i + 1; j < L.walls.length; j++) {
      const A = L.walls[i];
      const B = L.walls[j];
      const ax = axisOf(A);
      if (!ax || ax !== axisOf(B)) continue;
      const k = ax === 'h' ? 1 : 0;
      const u = 1 - k;
      const gap = Math.abs(A.a[k] - B.a[k]);
      if (gap < 1e-4 || gap > (A.t + B.t) / 2 + 0.01) continue;
      const a0 = Math.min(A.a[u], A.b[u]);
      const a1 = Math.max(A.a[u], A.b[u]);
      const b0 = Math.min(B.a[u], B.b[u]);
      const b1 = Math.max(B.a[u], B.b[u]);
      const common = Math.min(a1, b1) - Math.max(a0, b0);
      if (common < 0.5 * Math.min(a1 - a0, b1 - b0)) continue;
      // the openings of both, as plan points
      const pts = L.openings.filter((op) => op.wall === A.id || op.wall === B.id).map((op) => {
        const w = op.wall === A.id ? A : B;
        const c = wallPoint(w, op.at);
        return { op, s: c[u] };
      });
      const lo = Math.min(A.a[k] - A.t / 2, B.a[k] - B.t / 2);
      const hi = Math.max(A.a[k] + A.t / 2, B.a[k] + B.t / 2);
      const c = (lo + hi) / 2;
      const s0 = Math.min(a0, b0);
      const s1 = Math.max(a1, b1);
      A.a = ax === 'h' ? [round(s0, 4), round(c, 4)] : [round(c, 4), round(s0, 4)];
      A.b = ax === 'h' ? [round(s1, 4), round(c, 4)] : [round(c, 4), round(s1, 4)];
      A.t = round(hi - lo, 4);
      A.exterior = !!(A.exterior || B.exterior);
      for (const { op, s } of pts) {
        op.wall = A.id;
        op.at = round(s - s0, 4);
      }
      // openings now on top of each other on the one wall: the smaller goes
      const on = L.openings.filter((op) => op.wall === A.id).sort((p, q) => p.at - q.at);
      const gone = new Set();
      for (let x = 1; x < on.length; x++) {
        const p = on[x - 1];
        const q = on[x];
        if (gone.has(p) || q.at - q.width / 2 >= p.at + p.width / 2) continue;
        gone.add((p.type === 'opening' ? 0 : 100) + p.width <= (q.type === 'opening' ? 0 : 100) + q.width ? p : q);
      }
      L.openings = L.openings.filter((op) => !gone.has(op));
      L.walls.splice(j, 1);
      j--;
      n++;
    }
  }
  return n;
}

/** The house's name from the files (their common folder-free stem, or «Mitt hus»). */
function houseName(inputs) {
  const names = inputs.map((x) => x.name).filter(Boolean);
  return names.length ? `Hus fra ${names.length} tegning${names.length === 1 ? '' : 'er'}` : 'Mitt hus';
}

/**
 * The floor order (step 5): per plan a level number from its file name, else its title (the AI's readPlan title or
 * classify level), else its content; numbers that collide or are missing are filled in by the content. (An answer to
 * the order question is applied afterwards, by applyAnswers.)
 * → { list (plans with levelNo, orderFrom, orderWhy), confidence, why }
 */
function orderLevels(plans) {
  for (const d of plans) {
    const t = levelWords(d.aiPlan?.levelTitle ?? '');
    const c = d.titleWords;
    d.orderFrom = null;
    d.levelNo = null;
    if (d.words.level != null) {
      d.levelNo = d.words.level;
      d.orderFrom = d.words.user ? 'kunden' : 'filnavn';
      d.orderWhy = d.words.user ? 'rekkefølgen du valgte' : `«${d.file}»`;
    } else if (t.level != null || c.level != null) {
      d.levelNo = t.level ?? c.level;
      d.orderFrom = 'tittel';
      d.orderWhy = t.level != null ? `tittelen «${d.aiPlan.levelTitle}»` : c.why ?? `KI: «${d.levelNameAi}»`;
    } else if (d.words.tag || t.tag || c.tag) {
      d.tag = d.words.tag ?? t.tag ?? c.tag;
      d.orderFrom = d.words.tag ? 'filnavn' : 'tittel';
      d.orderWhy = d.words.tag ? `«${d.file}»` : `tittelen «${d.aiPlan?.levelTitle ?? d.levelNameAi}»`;
      if (d.tag === 'basement') d.levelNo = -1;
    }
    // what the content says (for the ones without a number)
    const kinds = (d.level?.rooms ?? []).map((r) => r.kind);
    const names = (d.level?.rooms ?? []).map((r) => fold(r.name)).join(' ');
    const extDoors = (d.level?.openings ?? []).filter((op) => op.type === 'door' && wallById(d.level, op.wall)?.exterior).length;
    d.content = {
      main: kinds.includes('entrance') || /kjokken|entre|vindfang/.test(names),
      top: (d.level?.skylights?.length ?? 0) > 0 || /loft/.test(names),
      bottom: /kjeller|sokkel|tekn/.test(names),
      extDoors,
    };
  }
  let list = [...plans];
  let confidence = 'high';
  let why = '';
  if (list.length === 1) {
    list[0].levelNo = list[0].levelNo != null && list[0].orderFrom ? list[0].levelNo : 0;
    list[0].orderFrom ??= 'eneste plan';
    list[0].orderWhy ??= 'den eneste planen';
    if (list[0].levelNo !== 0 && list[0].levelNo !== -1) list[0].levelNo = 0;
    if (list[0].levelNo === -1) list[0].levelNo = 0;
    return { list, confidence, why };
  }
  // tags: «øvre» above a basement, «loft» on top
  const has = (n) => list.some((d) => d.levelNo === n);
  for (const d of list.filter((x) => x.levelNo == null && x.tag === 'upper')) d.levelNo = has(0) ? Math.max(...list.filter((x) => x.levelNo != null).map((x) => x.levelNo)) + 1 : 0;
  // collisions: the one named by its file keeps the number, the other moves by its content
  const seen = new Map();
  for (const d of [...list].sort((a, b) => (a.orderFrom === 'filnavn' || a.orderFrom === 'kunden' ? -1 : 1) - (b.orderFrom === 'filnavn' || b.orderFrom === 'kunden' ? -1 : 1))) {
    if (d.levelNo == null) continue;
    if (seen.has(d.levelNo)) {
      d.collided = d.levelNo;
      d.levelNo = null;
      confidence = 'medium';
    } else seen.set(d.levelNo, d);
  }
  // the rest by content: the entrance → 0, a loft → the top, the others below
  const free = list.filter((d) => d.levelNo == null);
  if (free.length) confidence = free.some((d) => d.content.main || d.content.top || d.content.bottom) ? 'medium' : 'low';
  const mainFree = !list.some((d) => d.levelNo === 0);
  free.sort((a, b) => Number(b.content.main) - Number(a.content.main) || b.content.extDoors - a.content.extDoors);
  for (const d of free) {
    const taken = new Set(list.filter((x) => x.levelNo != null).map((x) => x.levelNo));
    if (mainFree && !taken.has(0) && (d.content.main || d.content.extDoors > 0 || d === free[0]) && !d.content.bottom && !d.content.top) {
      d.levelNo = 0;
      d.orderWhy = d.content.main ? 'inngang og kjøkken' : d.content.extDoors ? `${d.content.extDoors} ytterdør${d.content.extDoors > 1 ? 'er' : ''}` : 'gjettet';
    } else if (d.content.top) {
      d.levelNo = Math.max(0, ...taken) + 1;
      d.orderWhy = 'takvinduer eller loft';
    } else if (d.content.bottom || !d.content.extDoors) {
      d.levelNo = Math.min(0, ...taken) - 1;
      d.orderWhy = d.content.bottom ? 'kjellerord i romnavnene' : 'ingen ytterdør';
    } else {
      d.levelNo = Math.max(0, ...taken) + 1;
      d.orderWhy = 'gjettet';
    }
    d.orderFrom = 'innhold';
  }
  // no level 0 (two upper floors from the names): the lowest above ground becomes 0
  if (!list.some((d) => d.levelNo === 0)) {
    const above = list.filter((d) => d.levelNo > 0).sort((a, b) => a.levelNo - b.levelNo);
    const shift = above.length ? above[0].levelNo : 0;
    for (const d of list) if (d.levelNo > 0) d.levelNo -= shift;
  }
  // gaps (1etg and 3etg): close them, keeping the order
  const nums = [...new Set(list.map((d) => d.levelNo))].sort((a, b) => a - b);
  const zero = nums.indexOf(0);
  for (const d of list) d.levelNo = nums.indexOf(d.levelNo) - zero;
  if (confidence !== 'high') why = list.map((d) => `«${d.file}»: ${d.orderWhy ?? 'gjettet'}`).join('; ');
  list.sort((a, b) => a.levelNo - b.levelNo);
  return { list, confidence, why };
}

export const _internal = { aiOpeningKind, orderLevels, fitInRoom, thumbnail, thumbDiff, roomAt };
