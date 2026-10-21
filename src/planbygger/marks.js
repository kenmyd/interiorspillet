/**
 * Planbygger: numbered marks drawn on a copy of a plan image, so the AI layer (ai.js, readPlan) can answer «room 3 is
 * KJØKKEN 16.9 m²» and «opening F is a sliding door» about the rooms and openings the classical detection found.
 *
 *   drawMarks(img, { rooms, openings, symbols }, { radius }) → {
 *     img,                                         a copy of img (RGBA) with the marks drawn on it
 *     marks: [{ id, kind: 'room'|'opening'|'symbol', at: [nx, ny], drawnAt: [nx, ny], ref, polygon? }]
 *     unmarked: [{ kind: 'room'|'opening', ref, at: [nx, ny], polygon?, reason }]   targets that got no mark
 *     radius                                       the disc radius in px
 *   }
 *   targetsFromLevel(level, rooms, pxPerM) → { rooms, openings }   the inputs above from a model level + findRooms
 *
 * Inputs are in image pixels: a room is { at: [x, y], polygon?: [[x, y], …], ref? }, an opening { at: [x, y] (centre
 * of the gap), normal?: [nx, ny] (unit, across the wall), t?: wall thickness px, ref? }, a symbol { at, ref? }; a bare
 * [x, y] works for all three. Rooms get numbers (1, 2, …) in red discs, openings letters (A, B, … without I and O, then
 * AA, AB, …) in blue discs, symbols s1, s2, … in green. White digits on a saturated disc with a white rim: nothing in a
 * plan looks like that, and the model reads it at 1600 px. Room numbers are dense (a room that gets no mark does not
 * use one up); an opening keeps the letter of its place in the input, so a letter stays with its opening when another
 * one gets no mark.
 *
 * Placement, rooms first, then openings:
 * - A room mark goes to the blankest spot inside the room polygon near its interior point. Hard rules: the disc with
 *   its white rim covers no dark pixel (grey < 140: text, walls, lines – so never the room's own label «SOV 14.8 m²»),
 *   no other mark and no opening's gap. It avoids the spots right in front of an opening, where that opening's mark
 *   will want to sit. A room with no such spot (a 1.3 m² WC whose label fills it) is left unmarked and listed in
 *   `unmarked`: its label then comes back as a free label, and ai.js gives it to the room by the polygon.
 * - An opening mark sits beside the wall with a thin leader line to the gap, so the door arc or the window lines stay
 *   visible: the side and distance with the least ink, the nearest ring first, further rings only when the near ones
 *   are taken or dark. Hard rules: the disc overlaps no other disc, no leader and no gap, its leader runs through no
 *   disc, and the coloured disc covers no dark pixel outside its own wall. Soft: nothing dark under the white rim
 *   either (it may touch a line where nothing is free, a door arc in a narrow corridor), no ink under the leader, no
 *   leader crossing another. An opening with no such spot is left unmarked (`unmarked`, reason 'crowded' or
 *   'covered'); the prompt asks the model to report unmarked doors and windows too, and ai.js links them back.
 * - All leaders are drawn first, then the discs on top.
 * Symbols are drawn where they are given.
 *
 * `at` is normalised (0–1 from the top-left corner, the AI answers' frame): the mark's disc for a room (inside the
 * room), the gap centre for an opening (what the answer is about); `drawnAt` is the disc's centre; a room's `polygon`
 * (normalised, when the input had one) lets ai.js give a label to the room it lies in. The disc size
 * scales with the image's long side (radius 13 px per 1600 px), so the marks look the same after ai.js scales the
 * image down to 1600 px. Pure JS on the RGBA buffer: the same code runs in the browser and in Node.
 */
import { sub, add, mul, unit, perp, dist, pointInPolygon } from './geom.js';

/** Disc colours [r, g, b]. */
export const MARK_COLORS = Object.freeze({
  room: [212, 0, 26],
  opening: [0, 76, 214],
  symbol: [0, 138, 62],
});

/** Opening letters: no I or O (they read as 1 and 0). */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Mark id for the i-th (0-based) item of a kind. */
export function markId(kind, i) {
  if (kind === 'room') return String(i + 1);
  if (kind === 'symbol') return `s${i + 1}`;
  const n = LETTERS.length;
  return i < n ? LETTERS[i] : LETTERS[(Math.floor(i / n) - 1) % n] + LETTERS[i % n];
}

// 5 × 7 bitmap glyphs, one string of 7 rows × 5 columns per character
const GLYPHS = {
  0: '01110100011001110101110011000101110',
  1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111',
  3: '11111000100010000010000011000101110',
  4: '00010001100101010010111110001000010',
  5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110',
  7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110',
  9: '01110100011000101111000010001001100',
  A: '01110100011000111111100011000110001',
  B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110',
  D: '11100100101000110001100011001011100',
  E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001',
  J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001',
  N: '10001100011100110101100111000110001',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010',
  X: '10001100010101000100010101000110001',
  Y: '10001100011000101010001000010000100',
  Z: '11111000010001000100010001000011111',
  s: '00000000000111010000011100000111110',
};

const BASE_RADIUS = 13; // px at a long side of 1600 px
const INK = 180; // grey below this is ink when looking for a blank spot
const DARK = 110; // … and below this it weighs as text or a line in the blank-spot score
const FORBID = 140; // grey below this is text or a line, which a mark must not cover (grey labels: 110–170)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const asPoint = (item) => (Array.isArray(item) ? item : item?.at);
/** Grey of pixel i (an RGBA index), alpha flattened on white. */
const lumaAt = (d, i) => {
  const a = d[i + 3] / 255;
  return (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
};

/** Distance between the segments a–b and c–d (0 when they cross). */
function segDist(a, b, c, d) {
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(a, b, c);
  const d2 = cr(a, b, d);
  const d3 = cr(c, d, a);
  const d4 = cr(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const pd = (p, u, v) => {
    const e = sub(v, u);
    const l2 = e[0] * e[0] + e[1] * e[1];
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * e[0] + (p[1] - u[1]) * e[1]) / l2)) : 0;
    return dist(p, add(u, mul(e, t)));
  };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}

/** Do the segments a–b and c–d cross (not just touch at an end)? */
const crosses = (a, b, c, d) => segDist(a, b, c, d) === 0 && dist(a, c) > 1 && dist(a, d) > 1 && dist(b, c) > 1 && dist(b, d) > 1;

/**
 * Ink on a coarse grid (cells of `cell` px) with a summed-area table, for blank-spot searches. A cell weighs by its
 * darkest pixel, not by how many pixels are dark: thin black text (a room's label) must cost as much as a solid
 * block, and more than grey furniture – a mark may cover a sofa but not «SOV 14.8 m²». `dark` counts the dark pixels
 * under a pill exactly, and skips the count where the grid has no dark cell.
 */
function inkGrid(img, cell) {
  const { width: W, height: H, data: d } = img;
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const counts = new Uint8Array(gw * gh);
  const forb = new Uint8Array(gw * gh); // cells with a pixel a mark must not cover
  for (let y = 0; y < H; y++) {
    const gy = ((y / cell) | 0) * gw;
    for (let x = 0; x < W; x++) {
      const l = lumaAt(d, (y * W + x) * 4);
      if (l < INK) {
        const k = gy + ((x / cell) | 0);
        const v = l < DARK ? 3 : 1;
        if (v > counts[k]) counts[k] = v;
        if (l < FORBID) forb[k] = 1;
      }
    }
  }
  const sat = new Float64Array((gw + 1) * (gh + 1));
  const dsat = new Int32Array((gw + 1) * (gh + 1)); // cells with a dark pixel
  for (let j = 0; j < gh; j++) {
    let row = 0;
    let drow = 0;
    for (let i = 0; i < gw; i++) {
      row += counts[j * gw + i];
      drow += forb[j * gw + i];
      sat[(j + 1) * (gw + 1) + i + 1] = sat[j * (gw + 1) + i + 1] + row;
      dsat[(j + 1) * (gw + 1) + i + 1] = dsat[j * (gw + 1) + i + 1] + drow;
    }
  }
  /**
   * Dark pixels (grey < FORBID) under the pill of radius R around the segment (cx ± hw, cy), inside the image; with
   * band = { p, n, h }, pixels nearer than h to the line through p across n (a wall) do not count.
   */
  const dark = (cx, cy, hw, R, band = null) => {
    const x0 = Math.max(0, Math.floor(cx - hw - R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(W - 1, Math.ceil(cx + hw + R));
    const y1 = Math.min(H - 1, Math.ceil(cy + R));
    if (x1 < x0 || y1 < y0) return 0;
    const gx0 = Math.floor(x0 / cell);
    const gy0 = Math.floor(y0 / cell);
    const gx1 = Math.floor(x1 / cell) + 1;
    const gy1 = Math.floor(y1 / cell) + 1;
    if (dsat[gy1 * (gw + 1) + gx1] - dsat[gy0 * (gw + 1) + gx1] - dsat[gy1 * (gw + 1) + gx0] + dsat[gy0 * (gw + 1) + gx0] === 0) return 0;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (capsuleDist(x + 0.5, y + 0.5, cx, cy, hw) > R || lumaAt(d, (y * W + x) * 4) >= FORBID) continue;
        if (band && Math.abs((x + 0.5 - band.p[0]) * band.n[0] + (y + 0.5 - band.p[1]) * band.n[1]) < band.h) continue;
        n++;
      }
    }
    return n;
  };
  /** Dark pixels along the segment a–b (one sample per px, on the line and 1 px to each side). */
  const darkLine = (a, b) => {
    const len = dist(a, b);
    if (len < 1) return 0;
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n = 0;
    for (let s = 0; s <= len; s++) {
      for (const o of [-1, 0, 1]) {
        const x = Math.round(a[0] + u[0] * s - u[1] * o);
        const y = Math.round(a[1] + u[1] * s + u[0] * o);
        if (x >= 0 && y >= 0 && x < W && y < H && lumaAt(d, (y * W + x) * 4) < FORBID) {
          n++;
          break;
        }
      }
    }
    return n;
  };
  /** Ink share 0–1 of the square of half-size h around (x, y) (cell resolution); outside the image counts as ink. */
  const box = (x, y, h) => {
    const x0 = Math.floor((x - h) / cell);
    const y0 = Math.floor((y - h) / cell);
    const x1 = Math.ceil((x + h) / cell);
    const y1 = Math.ceil((y + h) / cell);
    const cells = Math.max(1, (x1 - x0) * (y1 - y0));
    const cx0 = Math.max(0, x0);
    const cy0 = Math.max(0, y0);
    const cx1 = Math.min(gw, x1);
    const cy1 = Math.min(gh, y1);
    if (cx1 <= cx0 || cy1 <= cy0) return 1;
    const inside = (cx1 - cx0) * (cy1 - cy0);
    const s = sat[cy1 * (gw + 1) + cx1] - sat[cy0 * (gw + 1) + cx1] - sat[cy1 * (gw + 1) + cx0] + sat[cy0 * (gw + 1) + cx0];
    return (s + 3 * (cells - inside)) / (3 * cells);
  };
  return { box, dark, darkLine };
}

/** Half-width of the straight part of a mark's pill (0 = a disc) and the glyph scale, for a label. */
function shapeOf(label, r) {
  const s = Math.max(2, Math.floor((r * 1.1) / 7));
  const tw = label.length * 5 * s + (label.length - 1) * s;
  const hw = Math.max(0, tw / 2 + s * 1.5 - r);
  return { s, tw, th: 7 * s, hw };
}

/** Alpha-blends colour c into pixel (x, y) with coverage a. */
function blend(out, W, H, x, y, c, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const d = out.data;
  d[i] = d[i] + (c[0] - d[i]) * a;
  d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a;
  d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a;
  d[i + 3] = 255 - (255 - d[i + 3]) * (1 - a);
}

/** Distance from p to the horizontal segment centre ± hw. */
const capsuleDist = (px, py, cx, cy, hw) => {
  const dx = Math.max(0, Math.abs(px - cx) - hw);
  return Math.hypot(dx, py - cy);
};

/** A filled pill (capsule) of radius r around the segment centre ± hw, anti-aliased. */
function fillCapsule(out, cx, cy, hw, r, c) {
  const { width: W, height: H } = out;
  const x0 = Math.floor(cx - hw - r - 1);
  const x1 = Math.ceil(cx + hw + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) blend(out, W, H, x, y, c, clamp01(r + 0.5 - capsuleDist(x + 0.5, y + 0.5, cx, cy, hw)));
  }
}

/** A line of width w from a to b, anti-aliased. */
function strokeLine(out, a, b, w, c) {
  const { width: W, height: H } = out;
  const x0 = Math.floor(Math.min(a[0], b[0]) - w - 1);
  const x1 = Math.ceil(Math.max(a[0], b[0]) + w + 1);
  const y0 = Math.floor(Math.min(a[1], b[1]) - w - 1);
  const y1 = Math.ceil(Math.max(a[1], b[1]) + w + 1);
  const d = sub(b, a);
  const l2 = d[0] * d[0] + d[1] * d[1];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = [x + 0.5, y + 0.5];
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0;
      const q = add(a, mul(d, t));
      blend(out, W, H, x, y, c, clamp01(w / 2 + 0.5 - dist(p, q)));
    }
  }
}

/** White bitmap text centred on (cx, cy). */
function drawLabel(out, label, cx, cy, s, tw, th) {
  const { width: W, height: H } = out;
  let x = Math.round(cx - tw / 2);
  const y = Math.round(cy - th / 2);
  for (const ch of label) {
    const g = GLYPHS[ch];
    if (g) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (g[row * 5 + col] !== '1') continue;
          for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) blend(out, W, H, x + col * s + dx, y + row * s + dy, [255, 255, 255], 1);
        }
      }
    }
    x += 6 * s;
  }
}

/** Draws one mark: a white rim, the coloured pill, the label. */
function paintMark(out, m, r, color) {
  fillCapsule(out, m.cx, m.cy, m.hw, r + Math.max(2, r * 0.18), [255, 255, 255]);
  fillCapsule(out, m.cx, m.cy, m.hw, r, color);
  drawLabel(out, m.label, m.cx, m.cy, m.s, m.tw, m.th);
}

/**
 * Opening mark search: rings at multiples of the base distance from the wall, slides along it (× the rim radius). The
 * near set first; the far set only when the near one has no clean spot (nothing dark under the rim or the leader, no
 * crossing leaders).
 */
const NEAR = { rings: [1, 1.5, 2.1, 2.8], slides: [0, 0.6, -0.6, 1.2, -1.2] };
const FAR = { rings: [1, 1.5, 2.1, 2.8, 3.6, 4.6], slides: [0, 0.6, -0.6, 1.2, -1.2, 2, -2, 3, -3] };
const DIRS8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

/**
 * Draws the marks on a copy of img (see the top of the file).
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img  RGBA
 * @param {{ rooms?: Array, openings?: Array, symbols?: Array }} targets  pixels
 * @param {{ radius?: number }} [options]  disc radius in px (default 13 per 1600 px of the long side)
 */
export function drawMarks(img, { rooms = [], openings = [], symbols = [] } = {}, { radius } = {}) {
  const W = img.width;
  const H = img.height;
  const out = { width: W, height: H, data: new Uint8ClampedArray(img.data) };
  const r = Math.max(BASE_RADIUS, radius ?? Math.round((BASE_RADIUS * Math.max(W, H)) / 1600));
  const rim = r + Math.max(2, r * 0.18);
  const lw = Math.max(1.5, r / 7);
  const cell = Math.max(1, Math.round(r / 4));
  const ink = inkGrid(img, cell);
  const placed = []; // { cx, cy, hw } of the discs placed so far
  const leaders = []; // { a: the gap, b: the disc centre }
  const draws = []; // { m, color } in placing order
  const marks = [];
  const unmarked = [];
  const norm = (p) => [Math.round((p[0] / W) * 1e4) / 1e4, Math.round((p[1] / H) * 1e4) / 1e4];
  const overlaps = (cx, cy, hw) => placed.some((q) => Math.abs(cx - q.cx) < hw + q.hw + 2 * rim + 2 && Math.abs(cy - q.cy) < 2 * rim + 2);
  const halfBox = (hw) => rim + 1 + hw / 2;
  const axis = (cx, cy, hw) => [[cx - hw, cy], [cx + hw, cy]];
  const clear = rim + lw / 2 + 1; // a leader's distance to a disc's axis
  // every opening's gap: no disc may hide one, or that opening's leader would end under it
  const gaps = openings.map(asPoint);
  const coversGap = (cx, cy, hw, own = -1) => gaps.some((g, k) => g && k !== own && capsuleDist(g[0], g[1], cx, cy, hw) < rim + 2);
  const onLeader = (cx, cy, hw) => {
    const [p, q] = axis(cx, cy, hw);
    return leaders.some((L) => segDist(L.a, L.b, p, q) < clear);
  };
  const leaderHits = (a, b) => placed.some((q) => {
    const [p0, p1] = axis(q.cx, q.cy, q.hw);
    return segDist(a, b, p0, p1) < clear;
  });
  // the spots right in front of each opening, on both sides of the wall: a room mark there takes the opening's place
  const reserved = [];
  for (const op of openings) {
    const target = asPoint(op);
    const n = !Array.isArray(op) && op?.normal ? unit(op.normal) : null;
    if (!target || !n) continue;
    const base = (op.t ?? 0) / 2 + rim + 3;
    reserved.push(add(target, mul(n, base)), add(target, mul(n, -base)));
  }
  const nearReserved = (cx, cy, hw) => reserved.some((p) => Math.abs(cx - p[0]) < hw + 2 * rim + 2 && Math.abs(cy - p[1]) < 2 * rim + 2);

  // rooms: the blankest spot inside the polygon, near the interior point, on no dark pixel
  const roomFoot = rim + 1; // a room disc hides what lies under its white rim too
  let roomNo = 0;
  rooms.forEach((room, i) => {
    const target = asPoint(room);
    if (!target) return;
    const ref = Array.isArray(room) ? i : room.ref ?? i;
    const label = markId('room', roomNo);
    const sh = shapeOf(label, r);
    const poly = Array.isArray(room) ? null : room.polygon ?? null;
    const hb = halfBox(sh.hw * 2);
    const free = (x, y) => !overlaps(x, y, sh.hw) && !coversGap(x, y, sh.hw) && ink.dark(x, y, sh.hw, roomFoot) === 0;
    let best = null;
    let fits = false;
    /** A candidate spot: the score first (cheap), the hard rules only for a spot that would win. */
    const consider = (x, y) => {
      // ink in a wider box than the pill: a margin to the room's label and the furniture
      const wb = hb * 1.7;
      const inkShare = (ink.box(x - sh.hw, y, wb) + ink.box(x + sh.hw, y, wb)) / 2;
      const score = inkShare * 40 + (dist([x, y], target) / r) * 0.25 + (nearReserved(x, y, sh.hw) ? 1000 : 0);
      if ((!best || score < best.score) && free(x, y)) best = { x, y, score };
    };
    if (poly && poly.length >= 3) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of poly) {
        x0 = Math.min(x0, p[0]);
        y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]);
        y1 = Math.max(y1, p[1]);
      }
      const step = Math.max(r / 2, Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500));
      for (let y = y0 + hb; y <= y1 - hb; y += step) {
        for (let x = x0 + hb + sh.hw; x <= x1 - hb - sh.hw; x += step) {
          // the whole pill (with a margin) must lie inside the room
          const m = hb + 2;
          const hx = m + sh.hw;
          if (![[x, y], [x - hx, y - m], [x + hx, y - m], [x - hx, y + m], [x + hx, y + m], [x - hx, y], [x + hx, y], [x, y - m], [x, y + m]].every((p) => pointInPolygon(p, poly))) continue;
          fits = true;
          consider(x, y);
        }
      }
      // a room smaller than the search grid: its interior point itself
      if (!best && pointInPolygon(target, poly)) consider(target[0], target[1]);
    } else {
      // no polygon: the point itself, else the nearest clean spot on rings around it
      fits = true;
      for (const k of [0, 1, 2, 3]) {
        for (const a of k ? DIRS8 : [[0, 0]]) {
          const x = target[0] + a[0] * k * r;
          const y = target[1] + a[1] * k * r;
          if (x < hb + sh.hw || y < hb || x > W - hb - sh.hw || y > H - hb) continue;
          consider(x, y);
        }
        if (best) break;
      }
    }
    if (!best) {
      unmarked.push({ kind: 'room', ref, at: norm(target), ...(poly ? { polygon: poly.map(norm) } : {}), reason: fits ? 'covered' : 'small' });
      return;
    }
    roomNo++;
    const m = { cx: best.x, cy: best.y, label, ...sh };
    placed.push({ cx: m.cx, cy: m.cy, hw: sh.hw });
    draws.push({ m, color: MARK_COLORS.room });
    marks.push({ id: label, kind: 'room', at: norm([m.cx, m.cy]), drawnAt: norm([m.cx, m.cy]), ref, ...(poly ? { polygon: poly.map(norm) } : {}) });
  });

  // openings: beside the wall, on the blanker side, with a leader to the gap; the letter follows the input order
  openings.forEach((op, i) => {
    const target = asPoint(op);
    if (!target) return;
    const ref = Array.isArray(op) ? i : op.ref ?? i;
    const label = markId('opening', i);
    const sh = shapeOf(label, r);
    const n = !Array.isArray(op) && op.normal ? unit(op.normal) : null;
    const t = Array.isArray(op) ? 0 : op.t ?? 0;
    const hb = halfBox(sh.hw * 2);
    const base = t / 2 + rim + 3;
    const along = n ? perp(n) : null; // along the wall
    const band = n ? { p: target, n, h: t / 2 + Math.max(3, r * 0.3) } : null;
    let covered = false;
    const search = (set) => {
      let best = null;
      for (const k of set.rings) {
        for (const dir of n ? [n, mul(n, -1)] : DIRS8) {
          for (const slide of n ? set.slides : [0]) {
            const c = add(target, add(mul(dir, base * k), along ? mul(along, slide * rim) : [0, 0]));
            if (c[0] < hb || c[1] < hb || c[0] > W - hb || c[1] > H - hb) continue;
            if (overlaps(c[0], c[1], sh.hw) || coversGap(c[0], c[1], sh.hw, i) || onLeader(c[0], c[1], sh.hw) || leaderHits(target, c)) continue;
            // the disc with its rim, not counting the wall itself (the detected thickness may be a little thin): the
            // rim may touch a line where nothing is free, the disc itself covers nothing
            const darkN = ink.dark(c[0], c[1], sh.hw, rim + 1, band);
            if (darkN && ink.dark(c[0], c[1], sh.hw, r - 2, band)) {
              covered = true;
              continue;
            }
            const crossN = leaders.filter((L) => crosses(target, c, L.a, L.b)).length;
            // the visible leader outside the wall band (the window lines in the gap do not count) and the disc
            const len = dist(target, c);
            const u = mul(sub(c, target), 1 / len);
            const s0 = Math.min(len, (t / 2 + r * 0.6) / Math.max(0.2, n ? Math.abs(u[0] * n[0] + u[1] * n[1]) : 1));
            const lineN = len - rim > s0 ? ink.darkLine(add(target, mul(u, s0)), add(target, mul(u, len - rim))) : 0;
            const score = ink.box(c[0], c[1], hb) * 20 + k * 0.6 + Math.abs(slide) * 0.5 + (darkN ? 30 + Math.min(darkN, 400) * 0.05 : 0) + crossN * 8 + Math.min(lineN, 25);
            if (!best || score < best.score) best = { c, score, clean: !darkN && !crossN && !lineN };
          }
        }
      }
      return best;
    };
    let best = search(NEAR);
    if (!best?.clean) {
      const far = search(FAR);
      if (far && (!best || far.score < best.score)) best = far;
    }
    if (!best) {
      unmarked.push({ kind: 'opening', ref, at: norm(target), reason: covered ? 'covered' : 'crowded' });
      return;
    }
    const c = best.c;
    const m = { cx: c[0], cy: c[1], label, ...sh };
    placed.push({ cx: m.cx, cy: m.cy, hw: sh.hw });
    leaders.push({ a: target, b: c });
    draws.push({ m, color: MARK_COLORS.opening });
    marks.push({ id: label, kind: 'opening', at: norm(target), drawnAt: norm(c), ref });
  });

  symbols.forEach((sym, i) => {
    const at = asPoint(sym);
    if (!at) return;
    const label = markId('symbol', i);
    const sh = shapeOf(label, r);
    const m = { cx: at[0], cy: at[1], label, ...sh };
    placed.push({ cx: m.cx, cy: m.cy, hw: sh.hw });
    draws.push({ m, color: MARK_COLORS.symbol });
    marks.push({ id: label, kind: 'symbol', at: norm(at), drawnAt: norm(at), ref: Array.isArray(sym) ? i : sym.ref ?? i });
  });

  // all leaders first (a white casing, then the blue line), the discs on top
  for (const L of leaders) strokeLine(out, L.a, L.b, lw + 2, [255, 255, 255]);
  for (const L of leaders) strokeLine(out, L.a, L.b, lw, MARK_COLORS.opening);
  for (const { m, color } of draws) paintMark(out, m, r, color);
  return { img: out, marks, unmarked, radius: r };
}

/**
 * drawMarks' targets from a model level (walls and openings in plan metres, as model.applyDetection makes them) and
 * its rooms (regions.findRooms(level.walls).rooms), in the pixels of the level's image (the straightened image if the
 * detection rotated it).
 * Rooms under minArea m² (slivers between walls, a cupboard) get no mark: they only clutter the image.
 * @param {{ walls: Array, openings: Array }} level
 * @param {Array} rooms  findRooms(...).rooms
 * @param {number} pxPerM
 * @param {{ minArea?: number }} [options]
 */
export function targetsFromLevel(level, rooms, pxPerM, { minArea = 1 } = {}) {
  const k = pxPerM;
  const px = (p) => [p[0] * k, p[1] * k];
  const walls = new Map((level.walls ?? []).map((w) => [w.id, w]));
  return {
    rooms: (rooms ?? []).filter((r) => r.area >= minArea).map((r) => ({ at: px(r.inside), polygon: r.polygon.map(px), ref: r.index })),
    openings: (level.openings ?? [])
      .map((o) => {
        const w = walls.get(o.wall);
        if (!w) return null;
        const u = unit(sub(w.b, w.a));
        return { at: px(add(w.a, mul(u, o.at))), normal: perp(u), t: w.t * k, width: o.width * k, ref: o.id, type: o.type };
      })
      .filter(Boolean),
  };
}
