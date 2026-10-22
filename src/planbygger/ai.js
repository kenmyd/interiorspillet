/**
 * Planbygger: the AI layer's client side (notes/planbygger-runde1-design.md, «KI-laget»). The server
 * (server/planbygger-ai/index.mjs) holds the key and talks to Claude; this file scales the drawing down, sends it,
 * and tidies the answer. Without a server, a key or quota everything still works – the calls just give null.
 *
 *   aiStatus() → { available, model, remaining }                       never throws
 *   aiRead(task, { image, marks, unmarked, hints, model }) → response | null     never throws
 *   aiRead('readHouse', { images: [{ image, kind: 'plan'|'facade', label, marks }], hints }) → the whole house read
 *               together (plans ≤ AI_MAX_SIDE, facades ≤ AI_FACADE_SIDE); tidied: room marks named in the answer carry
 *               their mark's own position (houseread.js turns them into plan metres)
 *     task:     'classify' (the whole sheet) | 'readPlan' (one marked plan) | 'readFacade' (not sent while no part of
 *               its answer is in use: AI_FACADE_USE below – aiRead gives null at once, aiLastError().error 'off')
 *     image:    RGBA { width, height, data } (ImageData shape), any size: scaled down here to ≤ 1600 px
 *     marks:    drawMarks(...).marks (marks.js), drawn into image by the caller
 *     unmarked: drawMarks(...).unmarked – the rooms and openings marks.js could not mark (never sent to the server)
 *     hints:    { fileName?, levelName?, sheet?, note? }                short context for the prompt
 *     model:  'haiku' | 'sonnet' | a full id – normally left out (the server picks per task)
 *   setAiTransport(fn) / resetAiTransport()   fn(request) → reply; the tests replay recorded replies with it
 *   AI_FACADE_USE { roof, kinds }             the parts of a readFacade answer facade.js gets (both off, measured)
 *   setAiFacadeUse({ roof?, kinds? } | null) / aiFacadeUse() / aiTaskInUse(task)   turn parts on for a measurement
 *   tidyResponse(task, response, marks, unmarked, { facadeUse }) → the tidied answer (below)
 *   downscaleImage(img, maxSide = 1600) → img       area-averaged, alpha flattened on white
 *   roomKindOf(kind) → a ROOM_KINDS key (model.js) or null
 *   aiLastError() → { error, message } | null       why the last call gave null (message in Norwegian)
 *
 * Responses (the schemas in server/planbygger-ai/prompts.mjs) follow the design; this file adds:
 *   - readPlan rooms / openings with a known mark: at = the mark's own position (exact, from marks.js), aiAt = where
 *     the model put it, ref = the mark's ref (the room index / opening id it was drawn for); rooms and labels:
 *     roomKind = roomKindOf(kind)
 *   - a marked room left without a name takes the nearest label inside its polygon (mark.polygon), fromLabel: true
 *   - a room marks.js left unmarked (too small for a disc beside its label) takes the label inside its polygon: it is
 *     added to rooms as { mark: null, ref, at (its interior point), aiAt (the label), …, fromLabel, unmarked: true }
 *   - an opening reported without a mark, within 2.5 % of the image from an unmarked opening, gets that one's ref
 *   - every point and box clamped to 0–1, boxes ordered (x0 < x1, y0 < y1), missing lists as []
 *   - readFacade: roof null and windows [] for the parts AI_FACADE_USE leaves off; seen = { roof, windows } is what
 *     the model said either way
 *   - meta: { model, promptVersion, cached }
 *
 * request = { op: 'status' } | { op: 'read', task, image (RGBA, already scaled), marks, hints, model }
 * reply   = the server's JSON: { ok, response, model, promptVersion, cached, remaining } | { ok: false, error, message }
 */
import { ROOM_KINDS } from './model.js';
import { pointInPolygon, dist } from './geom.js';

export const AI_TASKS = Object.freeze(['classify', 'readPlan', 'readFacade', 'readHouse']);
export const AI_MAX_SIDE = 1600;
/** readHouse: a facade is scaled to at most this (a plan keeps AI_MAX_SIDE: its texts and dash-dot lines are small) */
export const AI_FACADE_SIDE = 1200;

/**
 * The parts of a readFacade answer that facade.js gets: the roof (a vote in houseRoof, and the tie-breaker) and the
 * door/window kinds (applyAiKinds). Both are off, from «Generer» on the 24 facades of hus1–hus5 and hus7 against the
 * fasit (tools/planbygger-measure-all.mjs; notes/planbygger.md, «KI-laget»), house roof right / facade window counts
 * exact (total error) / door counts exact (total error):
 *   - without the facade AI      5 of 6 / 19 of 24 (5) / 19 of 24 (5)
 *   - Haiku, both parts          3 of 6 / 17 (8) / 18 (8): the roof of one view counts as a full vote (hus1's half-hip
 *                                with a dormer read as hip and gable, hus2's 200 × 80 px crops as mono-pitch); the kinds
 *                                that swap a door and a window fix 1 facade (hus1 fasade 1) and spoil 5 (hus2 1 and 3,
 *                                hus3 1 and 2, hus4 3)
 *   - Haiku, roof only           3 of 6 / 19 (5) / 19 (5);  kinds only: 5 of 6 / 17 (8) / 18 (8)
 *   - Sonnet (7 facades)         4 of 6 / 18 (8) / 18 (10)
 * The storeys are not used (generate passes the plans' count). With nothing in use aiRead does not send readFacade at
 * all (no cost, no wait: 4 calls of 5–7 s per house). setAiFacadeUse turns parts on again, for measuring them.
 */
export const AI_FACADE_USE = Object.freeze({ roof: false, kinds: false });
let facadeUse = { ...AI_FACADE_USE };
/** Overrides AI_FACADE_USE ({ roof?, kinds? }; null: back to it). */
export function setAiFacadeUse(use = null) {
  facadeUse = use ? { ...AI_FACADE_USE, ...use } : { ...AI_FACADE_USE };
}
export const aiFacadeUse = () => ({ ...facadeUse });
/** Whether aiRead sends this task (readFacade only while a part of its answer is in use). */
export const aiTaskInUse = (task, use = null) => AI_TASKS.includes(task) && (task !== 'readFacade' || !!((use ?? facadeUse).roof || (use ?? facadeUse).kinds));

const ENDPOINT = '/api/planbygger/ai';
const TIMEOUT_MS = 100_000; // the server's own deadline is 60 s, plus the queue

// ---------------------------------------------------------------------------------------------------------------
// Image

/** Area-average resize along one axis: weights per output index. */
function axisWeights(n, m) {
  const s = n / m;
  const out = [];
  for (let j = 0; j < m; j++) {
    const a = j * s;
    const b = (j + 1) * s;
    const taps = [];
    for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b)); i++) {
      const w = Math.min(b, i + 1) - Math.max(a, i);
      if (w > 1e-9) taps.push(i, w / s);
    }
    out.push(taps);
  }
  return out;
}

/**
 * The image scaled down so its long side is at most maxSide (a copy, also when no scaling is needed), with alpha
 * flattened on white.
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img
 */
export function downscaleImage(img, maxSide = AI_MAX_SIDE) {
  const { width: W, height: H, data: d } = img;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  // flatten on white
  const flat = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = d[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) flat[i * 4 + c] = d[i * 4 + c] * a + 255 * (1 - a);
    flat[i * 4 + 3] = 255;
  }
  if (w === W && h === H) return { width: W, height: H, data: flat };
  const xw = axisWeights(W, w);
  const yw = axisWeights(H, h);
  const mid = new Uint8ClampedArray(w * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w; x++) {
      const taps = xw[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let t = 0; t < taps.length; t += 2) {
        const i = (y * W + taps[t]) * 4;
        r += flat[i] * taps[t + 1];
        g += flat[i + 1] * taps[t + 1];
        b += flat[i + 2] * taps[t + 1];
      }
      const o = (y * w + x) * 4;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
      mid[o + 3] = 255;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const taps = yw[y];
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let t = 0; t < taps.length; t += 2) {
        const i = (taps[t] * w + x) * 4;
        r += mid[i] * taps[t + 1];
        g += mid[i + 1] * taps[t + 1];
        b += mid[i + 2] * taps[t + 1];
      }
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** PNG base64 of an RGBA image, in the browser (OffscreenCanvas or a canvas element). */
async function encodePngBrowser(img) {
  const imageData = typeof ImageData === 'function' ? new ImageData(new Uint8ClampedArray(img.data), img.width, img.height) : null;
  if (!imageData) throw new Error('no ImageData');
  let blob;
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').putImageData(imageData, 0, 0);
    blob = await c.convertToBlob({ type: 'image/png' });
  } else {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------------------------------------------------------
// Transport

async function httpTransport(req) {
  if (typeof fetch !== 'function') return { ok: false, error: 'no_fetch', message: 'Ingen nettverkstilgang.' };
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), TIMEOUT_MS) : null;
  try {
    if (req.op === 'status') {
      const r = await fetch(`${ENDPOINT}/status`, { credentials: 'same-origin', signal: ac?.signal });
      if (!r.ok) return { ok: false, available: false, error: `http_${r.status}` };
      return await r.json();
    }
    const pics = req.images
      ? { images: await Promise.all(req.images.map(async (im) => ({ mediaType: 'image/png', data: await encodePngBrowser(im.image), kind: im.kind, label: im.label }))) }
      : { image: { mediaType: 'image/png', data: await encodePngBrowser(req.image) } };
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: ac?.signal,
      body: JSON.stringify({ task: req.task, ...pics, marks: req.marks, hints: req.hints, model: req.model }),
    });
    const body = await r.json().catch(() => null);
    return body ?? { ok: false, error: `http_${r.status}`, message: 'KI-tjenesten svarte ikke.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let transport = httpTransport;
let lastError = null;

/** Replaces the transport (tests: replay recorded replies). fn(request) → reply (or a promise of one). */
export function setAiTransport(fn) {
  transport = typeof fn === 'function' ? fn : httpTransport;
}
export const resetAiTransport = () => setAiTransport(null);
export const aiLastError = () => lastError;

// ---------------------------------------------------------------------------------------------------------------
// Answers

const KIND_FALLBACK = {
  living: 'living',
  kitchen: 'living',
  dining: 'living',
  office: 'bedroom',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  wc: 'bathroom',
  hall: 'hall',
  entrance: 'entrance',
  laundry: 'laundry',
  storage: 'storage',
  wardrobe: 'storage',
  technical: 'storage',
  garage: 'storage',
  carport: null,
  terrace: null,
  balcony: null,
  other: null,
};
const KNOWN_KINDS = new Set(ROOM_KINDS.map(([k]) => k));

/** The plan document's room kind (model.js ROOM_KINDS) for an AI room kind; null for outdoor areas and «other». */
export function roomKindOf(kind) {
  if (KNOWN_KINDS.has(kind)) return kind;
  const k = KIND_FALLBACK[kind];
  return k && KNOWN_KINDS.has(k) ? k : null;
}

const c01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const pt = (p) => (Array.isArray(p) && p.length >= 2 && c01(p[0]) != null && c01(p[1]) != null ? [c01(p[0]), c01(p[1])] : null);
const bx = (b) => {
  if (!Array.isArray(b) || b.length < 4 || b.some((v) => !Number.isFinite(v))) return null;
  const [x0, y0, x1, y1] = b.map((v) => Math.max(0, Math.min(1, v)));
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
};
const arr = (v) => (Array.isArray(v) ? v : []);
const numOrNull = (v) => (Number.isFinite(v) ? v : null);
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** The nearest label (index) inside a normalised polygon, or -1. */
function labelIn(labels, polygon, at) {
  let best = -1;
  let bestD = Infinity;
  labels.forEach((l, k) => {
    if (!l.at || !pointInPolygon(l.at, polygon)) return;
    const d = at ? dist(l.at, at) : 0;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/**
 * Tidies one task's answer (see the top of the file). unmarked: drawMarks(...).unmarked; facadeUse: the readFacade
 * parts kept (default: AI_FACADE_USE, or what setAiFacadeUse set).
 */
export function tidyResponse(task, response, marks = [], unmarked = [], { facadeUse: use = facadeUse } = {}) {
  const r = response && typeof response === 'object' ? response : {};
  if (task === 'classify') {
    return {
      drawings: arr(r.drawings).map((d) => ({
        kind: d.kind ?? 'other',
        bbox: bx(d.bbox) ?? [0, 0, 1, 1],
        title: strOrNull(d.title),
        levelName: strOrNull(d.levelName),
        level: Number.isInteger(d.level) ? d.level : null,
        detached: !!d.detached,
      })),
      scaleText: strOrNull(r.scaleText),
      notes: typeof r.notes === 'string' ? r.notes : '',
    };
  }
  if (task === 'readHouse') return tidyHouse(r, marks);
  if (task === 'readFacade') {
    const roof = r.roof ?? null;
    const windows = arr(r.windows).map((w) => ({ bbox: bx(w.bbox), kind: w.kind === 'door' ? 'door' : 'window' })).filter((w) => w.bbox);
    return {
      title: strOrNull(r.title),
      roof: use?.roof ? roof : null,
      storeys: Number.isInteger(r.storeys) ? r.storeys : null,
      windows: use?.kinds ? windows : [],
      seen: { roof, windows },
      notes: typeof r.notes === 'string' ? r.notes : '',
    };
  }
  // readPlan
  const byId = new Map(arr(marks).map((m) => [m.id, m]));
  const linked = (item, kind) => {
    const m = item.mark != null ? byId.get(String(item.mark)) : null;
    const aiAt = pt(item.at);
    if (m && m.kind === kind) return { ...item, mark: m.id, at: [...m.at], aiAt, ref: m.ref ?? null };
    return { ...item, mark: item.mark != null ? String(item.mark) : null, at: aiAt, aiAt, ref: null };
  };
  const st = r.stair && typeof r.stair === 'object' ? r.stair : {};
  const rooms = arr(r.rooms).map((x) => {
    const room = linked(x, 'room');
    return { mark: room.mark, ref: room.ref, at: room.at, aiAt: room.aiAt, name: typeof x.name === 'string' ? x.name : '', area: numOrNull(x.area), kind: x.kind ?? 'other', roomKind: roomKindOf(x.kind) };
  });
  const labels = arr(r.labels).map((x) => ({ text: typeof x.text === 'string' ? x.text : '', area: numOrNull(x.area), kind: x.kind ?? 'other', roomKind: roomKindOf(x.kind), at: pt(x.at) }));
  // a marked room the model left without a name, with a label inside the room's polygon (marks.js): that label is the
  // room's (Haiku sometimes lists a label beside the disc as «another label»)
  for (const room of rooms) {
    const m = room.name ? null : byId.get(room.mark);
    if (!m?.polygon || m.polygon.length < 3) continue;
    const best = labelIn(labels, m.polygon, m.at);
    if (best < 0) continue;
    const [l] = labels.splice(best, 1);
    Object.assign(room, { name: l.text, area: l.area, kind: l.kind, roomKind: l.roomKind, fromLabel: true });
  }
  // the rooms marks.js could not mark: the label inside the polygon is theirs
  for (const u of arr(unmarked)) {
    if (u?.kind !== 'room' || !Array.isArray(u.polygon) || u.polygon.length < 3) continue;
    const best = labelIn(labels, u.polygon, u.at);
    if (best < 0) continue;
    const [l] = labels.splice(best, 1);
    rooms.push({ mark: null, ref: u.ref ?? null, at: pt(u.at), aiAt: l.at, name: l.text, area: l.area, kind: l.kind, roomKind: l.roomKind, fromLabel: true, unmarked: true });
  }
  return {
    levelTitle: strOrNull(r.levelTitle),
    scaleText: strOrNull(r.scaleText),
    rooms,
    labels,
    dimensions: arr(r.dimensions).map((x) => ({ text: typeof x.text === 'string' ? x.text : '', value: numOrNull(x.value), at: pt(x.at), along: x.along === 'v' ? 'v' : 'h', what: x.what ?? 'other' })),
    openings: linkUnmarkedOpenings(
      arr(r.openings).map((x) => {
        const o = linked(x, 'opening');
        return { mark: o.mark, ref: o.ref, at: o.at, aiAt: o.aiAt, kind: x.kind ?? 'none' };
      }),
      arr(unmarked).filter((u) => u?.kind === 'opening' && pt(u.at)),
    ),
    skylights: arr(r.skylights).map((x) => ({ at: pt(x.at) })).filter((x) => x.at),
    stair: { present: !!st.present, at: pt(st.at), type: st.type ?? (st.present ? 'unknown' : 'none'), up: st.up ?? 'unknown' },
    ceiling: arr(r.ceiling).filter((s) => typeof s === 'string' && s.trim()),
    furniture: arr(r.furniture).map((x) => ({ kind: x.kind ?? 'other', at: pt(x.at) })).filter((x) => x.at),
    notes: typeof r.notes === 'string' ? r.notes : '',
  };
}

const oneOfOr = (v, list, dflt) => (list.includes(v) ? v : dflt);
/** Two end points [x0, y0, x1, y1] clamped to 0–1, in the order given (a line, not a box), or null. */
const seg = (b) => (Array.isArray(b) && b.length >= 4 && b.slice(0, 4).every(Number.isFinite) ? b.slice(0, 4).map((v) => Math.max(0, Math.min(1, v))) : null);

/**
 * A readHouse answer (server/planbygger-ai/prompts.mjs): every list a list, enums checked, points clamped, and each
 * room mark the model names tied to the mark drawn on that image ({ mark, at, ref, image }; a number that is no mark
 * on that image is dropped). marks: [{ id, kind, at, ref, image (1-based) }].
 */
function tidyHouse(r, marks = []) {
  const markOf = (image, id) => arr(marks).find((m) => m.kind === 'room' && m.image === image && String(m.id) === String(id).trim()) ?? null;
  const roomsOf = (image, list) =>
    arr(list)
      .map((id) => markOf(image, id))
      .filter(Boolean)
      .filter((m, i, all) => all.indexOf(m) === i)
      .map((m) => ({ mark: m.id, at: [...m.at], ref: m.ref ?? null, image }));
  const roof = r.roof && typeof r.roof === 'object' ? r.roof : {};
  return {
    facades: arr(r.facades).map((f) => ({
      image: Number.isInteger(f.image) ? f.image : null,
      title: strOrNull(f.title),
      facing: oneOfOr(f.facing, ['N', 'E', 'S', 'W', 'NE', 'NW', 'SE', 'SW'], null),
      planSide: oneOfOr(f.planSide, ['top', 'bottom', 'left', 'right'], null),
      cladding: arr(f.cladding).map((c) => ({
        part: oneOfOr(c.part, ['all', 'lower', 'upper', 'gable', 'basement', 'other'], 'all'),
        type: oneOfOr(c.type, ['wood', 'panels', 'render', 'brick', 'stone'], null),
        direction: oneOfOr(c.direction, ['vertical', 'horizontal'], null),
        color: strOrNull(c.color),
      })),
      terrain: oneOfOr(f.terrain, ['flat', 'falls-left', 'falls-right', 'stepped'], null),
      basement: oneOfOr(f.basement, ['none', 'partly', 'full'], null),
    })),
    roof: {
      covering: oneOfOr(roof.covering, ['tiles', 'slate', 'felt', 'metal'], null),
      color: strOrNull(roof.color),
      pitch: Number.isFinite(roof.pitch) && roof.pitch > 0 && roof.pitch < 75 ? roof.pitch : null,
      wings: arr(roof.wings).map((w) => ({
        image: Number.isInteger(w.image) ? w.image : null,
        rooms: roomsOf(w.image, w.rooms),
        type: oneOfOr(w.type, ['gable', 'hip', 'mono-pitch', 'flat'], 'gable'),
        ridge: oneOfOr(w.ridge, ['horizontal', 'vertical'], null),
        high: w.type === 'mono-pitch' ? oneOfOr(w.high, ['top', 'bottom', 'left', 'right'], null) : null,
      })),
      chimney: !!roof.chimney,
    },
    ceilings: arr(r.ceilings)
      .map((c) => ({
        image: Number.isInteger(c.image) ? c.image : null,
        text: typeof c.text === 'string' ? c.text : '',
        kind: oneOfOr(c.kind, ['sloped', 'flat', 'open', 'height'], 'height'),
        degrees: Number.isFinite(c.degrees) && c.degrees > 0 && c.degrees < 75 ? c.degrees : null,
        rooms: roomsOf(c.image, c.rooms),
        ridge: c.kind === 'sloped' ? seg(c.ridge) : null,
      }))
      .filter((c) => c.text.trim()),
    decks: arr(r.decks).map((d) => ({
      kind: oneOfOr(d.kind, ['terrace', 'balcony', 'porch', 'roof-terrace'], 'terrace'),
      image: Number.isInteger(d.image) ? d.image : null,
      at: pt(d.at),
      railing: oneOfOr(d.railing, ['glass', 'wood-slats', 'wood-vertical', 'steel-bars', 'none'], null),
      stairs: !!d.stairs,
    })),
    notes: typeof r.notes === 'string' ? r.notes : '',
  };
}

/** Openings the model reported without a mark get the ref of the nearest unmarked opening within 2.5 % (each once). */
function linkUnmarkedOpenings(openings, unmarked) {
  const free = [...unmarked];
  for (const o of openings) {
    if (o.mark != null || !o.at || !free.length) continue;
    let k = -1;
    let bestD = 0.025;
    free.forEach((u, j) => {
      const d = dist(o.at, u.at);
      if (d < bestD) {
        bestD = d;
        k = j;
      }
    });
    if (k < 0) continue;
    const [u] = free.splice(k, 1);
    Object.assign(o, { ref: u.ref ?? null, at: pt(u.at), unmarked: true });
  }
  return openings;
}

/** { available, model, remaining } – available false when the server, the key or the SDK is missing. */
export async function aiStatus() {
  try {
    const s = await transport({ op: 'status' });
    if (!s || s.available !== true) return { available: false, model: s?.model ?? null, remaining: 0 };
    return { available: true, model: s.model ?? null, remaining: Number.isFinite(s.remaining) ? s.remaining : 0 };
  } catch {
    return { available: false, model: null, remaining: 0 };
  }
}

/**
 * One AI task on one drawing (see the top of the file). Never throws: any failure gives null (aiLastError() says why).
 * @param {'classify'|'readPlan'|'readFacade'} task
 * @param {{ image: { width: number, height: number, data: Uint8ClampedArray }, marks?: Array, unmarked?: Array, hints?: object, model?: string }} input
 */
export async function aiRead(task, { image, images, marks = [], unmarked = [], hints = {}, model } = {}) {
  lastError = null;
  try {
    if (!AI_TASKS.includes(task)) throw Object.assign(new Error('task'), { code: 'bad_request' });
    if (!aiTaskInUse(task)) {
      lastError = { error: 'off', message: 'KI-en leser ikke fasadene: tegningen alene ga et bedre resultat.' };
      return null;
    }
    if (task === 'readHouse') {
      // images: [{ image, kind: 'plan'|'facade', label, marks }] – each image's marks get its number (1-based)
      const list = arr(images).filter((im) => im?.image?.width && im.image.height && im.image.data);
      if (!list.length) throw Object.assign(new Error('image'), { code: 'bad_image' });
      const all = list.flatMap((im, i) => arr(im.marks).filter((m) => m.kind === 'room').map((m) => ({ ...m, image: i + 1 })));
      const sent = list.map((im) => ({ image: downscaleImage(im.image, im.kind === 'facade' ? AI_FACADE_SIDE : AI_MAX_SIDE), kind: im.kind, label: im.label ?? '' }));
      const reply = await transport({ op: 'read', task, images: sent, marks: all.map((m) => ({ id: m.id, kind: m.kind, at: m.at, drawnAt: m.drawnAt ?? m.at, image: m.image })), hints, model });
      if (!reply || reply.ok !== true || !reply.response) {
        lastError = { error: reply?.error ?? 'unknown', message: reply?.message ?? 'KI-en ga ikke noe svar.' };
        return null;
      }
      const out = tidyResponse(task, reply.response, all);
      out.meta = { model: reply.model ?? null, promptVersion: reply.promptVersion ?? null, cached: !!reply.cached };
      return out;
    }
    if (!image?.width || !image?.height || !image?.data) throw Object.assign(new Error('image'), { code: 'bad_image' });
    const small = downscaleImage(image, AI_MAX_SIDE);
    const cleanMarks = arr(marks).map((m) => ({ id: m.id, kind: m.kind, at: m.at, drawnAt: m.drawnAt ?? m.at }));
    const reply = await transport({ op: 'read', task, image: small, marks: cleanMarks, hints, model });
    if (!reply || reply.ok !== true || !reply.response) {
      lastError = { error: reply?.error ?? 'unknown', message: reply?.message ?? 'KI-en ga ikke noe svar.' };
      return null;
    }
    const out = tidyResponse(task, reply.response, arr(marks), arr(unmarked));
    out.meta = { model: reply.model ?? null, promptVersion: reply.promptVersion ?? null, cached: !!reply.cached };
    return out;
  } catch (err) {
    lastError = { error: err?.code ?? (err?.name === 'AbortError' ? 'timeout' : 'client'), message: err?.name === 'AbortError' ? 'KI-en svarte ikke i tide.' : 'KI-kallet feilet.' };
    return null;
  }
}
