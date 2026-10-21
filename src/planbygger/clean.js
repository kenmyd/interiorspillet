/**
 * Planbygger: tidies a floor-plan image before the wall detection – classical image processing only (chroma, grey
 * morphology, run lengths, connected components). No learning, no OCR.
 *
 *   cleanForWalls(img, { pxPerM, ...CLEAN_DEFAULTS }) → img     RGBA in, RGBA out (same size; the input is not changed)
 *   img.cleanStats = { wallTone: [lo, hi] | null, wallChroma, cast, colouredWalls, greyWalls,
 *                      colour: { changed, inpainted, guard }, darkFurniture, lightFills, hatchedWalls, hatch, ms }
 *                      what each step found and did (pixels changed) and how long it took
 *
 * detectPlan(img, { pxPerM, clean: cleanForWalls }) runs it first (the clean hook of detect.js). The cleaned image is
 * for the walls only; the page keeps showing the original.
 *
 * Walls in plans are mostly drawn neutral: black, dark grey, or a light grey fill between dark outlines – sometimes
 * faintly tinted (the slate walls of hus3, the bluish ink of a phone photo), sometimes in colour. The steps:
 *   1. The wall tone (estimateWallTone): the grey band whose thick strokes – after a grey closing that removes thin
 *      lines – are most often wall-shaped: long one way, at most a thick wall across, lighter on both sides. Twice: over
 *      the neutral pixels (faint tints count as neutral), and over the coloured ones, where a wall must also be clearly
 *      darker than its sides (the planks of a wood floor are not walls).
 *      - Coloured walls: when the coloured wall-shaped strokes hold at least a quarter of the neutral ones, they are
 *        walls and stay as drawn (with a 2 px rim); when they outnumber them, they are the walls: their tone is the
 *        wall tone and the guard is on.
 *      - The colour cast: the neutral walls' own mean chroma (minus castFree) lifts every chroma threshold of step 2, so
 *        a phone photo's bluish walls, door arcs and window lines are not taken for colour.
 *   2. Colour → paper (removeColour). The colour of a pixel is its chroma (max − min of R, G, B, judged over ±2 px).
 *      - Coloured ink drawn on top (the municipality's blue callouts on hus6) becomes paper; where a thin line of it
 *        crosses a wall or a window, the pixels are filled in from across the line, so the wall stays whole.
 *      - Coloured fills (yellow, beige and blue rooms, wood textures, coloured furniture: hus8, hus9) become paper.
 *      - Faintly tinted fills (chroma 10–18) only when lighter than the wall tone, or darker than neutral walls (the
 *        blue-grey bathroom of hus9). The slate-blue walls of hus3 have that chroma too, and stay: they are the tone.
 *      - A clearly darker pixel on a coloured fill is a neutral stroke on it (a door arc on a yellow floor, a wall's
 *        antialiased edge) and keeps its grey, so the detection sees the stroke as dark as before.
 *      - Guard: when coloured ink is the plan's main ink (every pixel this step would touch, counted against the neutral
 *        dark ink), dark coloured pixels are kept; with coloured walls every coloured stroke is kept, and only fills
 *        about as light as the paper go.
 *   3. Only on light grey walls (neutral, the tone from greyWallFrom up, little wall-shaped ink darker than it, no
 *      coloured walls, no guard: hus4 and hus9): thick dark furniture becomes paper – the detection's dark pass would
 *      take a black sofa for a wall and never try the grey walls – except dark strokes shaped like walls (walls
 *      sketched with a marker), which take the wall tone; and light floors between the wall tone and the paper become
 *      paper.
 *   4. Hatched walls → solid ink (fillHatchedWalls): two outlines with dense parallel diagonal hatching between them
 *      (architect drawings, hus6). Every stroke of such a wall is thinner than the thinnest wall, so the detection
 *      cannot see it.
 *   5. Hatching → paper (removeHatch), by default only on light grey walls, where it has the walls' tone: wood-floor
 *      lines, tile grids and terrace boards in regular parallel fields (hus4).
 *
 * Each step is kept because it measurably helps the walls and rooms of the test set (tools/test-planbygger-clean.mjs,
 * notes/planbygger.md). On the black and dark grey plans only colour is touched, and the detection comes out the same;
 * a black-and-white plan comes back byte for byte (hus1, hus5).
 *
 * Cost: every filter reads the image in memory order (the column passes run a row at a time), about 0.15–0.5 s per
 * megapixel in Node, most of it the wall tone and the hatched-wall search, which run on every plan.
 */
import { luma, raster, runLengths, components } from './image.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** Rec. 601 luma of the RGB of an (opaque) RGBA buffer. */
function lumaOf(data, n) {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  return g;
}

export const CLEAN_DEFAULTS = Object.freeze({
  /** coloured ink and coloured fills → paper */
  colour: true,
  /** chroma (0–255, the mean over ±2 px) where a pixel starts to count as coloured, and where it is fully coloured */
  colourFrom: 18,
  colourFull: 22,
  /** a pixel's own chroma must be at least this to be touched (a neutral wall next to a coloured floor keeps its edge) */
  ownChroma: 10,
  /** faintly tinted pixels (mean chroma from tintFrom up to colourFrom) become paper when lighter than the wall tone */
  tintFrom: 10,
  /** the plan's own colour cast: every chroma threshold here moves up by the neutral walls' mean chroma minus castFree
   *  (the slate walls of hus3, the bluish ink of a phone photo), so faintly tinted walls and strokes stay */
  castFree: 4,
  /** a coloured pixel's brightest channel against the brightest around it: from fillTo up it is the fill (→ paper), up
   *  to fillFrom a stroke on the fill (keeps its grey) */
  fillFrom: 0.78,
  fillTo: 0.88,
  /** a coloured pixel next to (within 1 px) a pixel this saturated and darker than inkLuma is ink (blue and red
   *  callouts, their dark fringe) */
  inkChroma: 100,
  /** coloured ink darker than this luma is «ink» for the guard */
  inkLuma: 150,
  /** coloured strokes shaped like walls (clearly darker than both sides by wallContrast more than a neutral wall) are
   *  walls when they hold at least colouredWalls of the neutral walls' wall-shaped pixels: kept as drawn, the guard on
   *  when they are the main walls, and the steps for light grey walls skipped */
  wallContrast: 24,
  colouredWalls: 0.25,
  /** thick dark furniture → paper, on plans whose walls are light grey (the wall tone starts at greyWallFrom or above) */
  darkFurniture: true,
  greyWallFrom: 140,
  /** light fills between the wall tone and the paper → paper, on the same plans */
  lightFills: true,
  /** hatched walls (two outlines with diagonal hatching between, architect drawings) → solid ink; the share of thin
   *  diagonal stroke pixels in a 7 × 7 window from which it is a hatched wall */
  hatchedWalls: true,
  hatchFill: 0.08,
  /** hatching (wood-floor lines, tile grids, terrace boards) → paper: 'grey' = only when the walls are light grey,
   *  true = always, false = never */
  hatch: 'grey',
  /** a stroke is faint when its darkest pixel is at most this much darker than the paper or floor around it */
  hatchDepth: 70,
  /** a field: at least this many parallel strokes after each other with even gaps (one missing line allowed) */
  hatchLines: 4,
});

// ---------------------------------------------------------------------------------------------------------------
// small raster filters on Uint8 arrays

/**
 * Box mean over a (2r + 1)² window (cut at the border), as Float32: integer row sums, then a running sum per column
 * while the rows go by – both passes read the image in memory order.
 */
function boxMean(src, w, h, r) {
  const n = w * h;
  const rows = (2 * r + 1) * 255 < 65536 ? new Uint16Array(n) : new Uint32Array(n);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = 0; x < Math.min(w, r); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) s += src[o + x + r];
      if (x - r - 1 >= 0) s -= src[o + x - r - 1];
      rows[o + x] = s;
    }
  }
  const across = new Float64Array(w); // 1 / the window's width at x
  for (let x = 0; x < w; x++) across[x] = 1 / (Math.min(w, x + r + 1) - Math.max(0, x - r));
  const col = new Float64Array(w);
  for (let y = 0; y < Math.min(h, r); y++) for (let x = 0; x < w; x++) col[x] += rows[y * w + x];
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    if (y + r < h) for (let x = 0, o = (y + r) * w; x < w; x++) col[x] += rows[o + x];
    if (y - r - 1 >= 0) for (let x = 0, o = (y - r - 1) * w; x < w; x++) col[x] -= rows[o + x];
    const down = 1 / (Math.min(h, y + r + 1) - Math.max(0, y - r));
    for (let x = 0, o = y * w; x < w; x++) out[o + x] = col[x] * across[x] * down;
  }
  return out;
}

/** One line (length N, in P[r … r + N − 1], padded around) through van Herk / Gil–Werman; result in Q[0 … N − 1]. */
function vhgwLine(P, G, Hh, Q, N, r, M, isMax) {
  const k = 2 * r + 1;
  if (isMax) {
    for (let j = 0; j < M; j++) G[j] = j % k === 0 || G[j - 1] < P[j] ? P[j] : G[j - 1];
    for (let j = M - 1; j >= 0; j--) Hh[j] = j === M - 1 || (j + 1) % k === 0 || Hh[j + 1] < P[j] ? P[j] : Hh[j + 1];
    for (let i = 0; i < N; i++) Q[i] = Hh[i] > G[i + 2 * r] ? Hh[i] : G[i + 2 * r];
  } else {
    for (let j = 0; j < M; j++) G[j] = j % k === 0 || G[j - 1] > P[j] ? P[j] : G[j - 1];
    for (let j = M - 1; j >= 0; j--) Hh[j] = j === M - 1 || (j + 1) % k === 0 || Hh[j + 1] > P[j] ? P[j] : Hh[j + 1];
    for (let i = 0; i < N; i++) Q[i] = Hh[i] < G[i + 2 * r] ? Hh[i] : G[i + 2 * r];
  }
}

/**
 * Max (or min) filter over a (2r + 1)² window: separable, van Herk / Gil–Werman (three comparisons per pixel whatever r
 * is). Rows one by one; the columns all at once, a row at a time, block by block of 2r + 1 rows (each block's running
 * max upwards, and the next block's downwards, as whole rows), so the image is read in memory order and only two blocks
 * are held. Outside the raster counts as the neutral value.
 */
function rankFilter(src, w, h, r, isMax) {
  const out = new Uint8Array(w * h);
  if (r <= 0) {
    out.set(src);
    return out;
  }
  const k = 2 * r + 1;
  const pad = isMax ? 0 : 255;
  // rows
  const Mw = Math.ceil((w + 2 * r) / k) * k;
  const P = new Uint8Array(Mw);
  const G = new Uint8Array(Mw);
  const Hh = new Uint8Array(Mw);
  const Q = new Uint8Array(w);
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    P.fill(pad);
    P.set(src.subarray(row, row + w), r);
    vhgwLine(P, G, Hh, Q, w, r, Mw, isMax);
    tmp.set(Q, row);
  }
  // columns. Padded row j is image row j − r; the window of output row y is padded rows y … y + 2r, which lie in y's
  // block (from y to the block's end: «up», the running max from the end back to y) and the next block (from its start
  // to y + 2r: «down»). For y at a block's start the window is the whole block (up[0]).
  const up = new Uint8Array(k * w);
  const down = new Uint8Array(k * w);
  const better = isMax ? (a, b) => (a > b ? a : b) : (a, b) => (a < b ? a : b);
  // one padded row into a block buffer at row t: a copy, or the running max with the buffer's row t ± 1
  const put = (buf, t, j, from) => {
    const y = j - r;
    const o = t * w;
    if (from < 0) {
      if (y >= 0 && y < h) buf.set(tmp.subarray(y * w, y * w + w), o);
      else buf.fill(pad, o, o + w);
    } else if (y < 0 || y >= h) buf.copyWithin(o, from * w, from * w + w);
    else {
      const s = y * w;
      const p = from * w;
      if (isMax) for (let x = 0; x < w; x++) buf[o + x] = buf[p + x] > tmp[s + x] ? buf[p + x] : tmp[s + x];
      else for (let x = 0; x < w; x++) buf[o + x] = buf[p + x] < tmp[s + x] ? buf[p + x] : tmp[s + x];
    }
  };
  for (let b = 0; b * k < h; b++) {
    const j0 = b * k;
    for (let t = k - 1; t >= 0; t--) put(up, t, j0 + t, t === k - 1 ? -1 : t + 1);
    for (let t = 0; t < k - 1; t++) put(down, t, j0 + k + t, t === 0 ? -1 : t - 1);
    for (let t = 0; t < k && j0 + t < h; t++) {
      const a = (j0 + t) * w;
      const u = t * w;
      if (t === 0) out.set(up.subarray(0, w), a);
      else {
        const d = (t - 1) * w;
        for (let x = 0; x < w; x++) out[a + x] = better(up[u + x], down[d + x]);
      }
    }
  }
  return out;
}
const maxFilter = (src, w, h, r) => rankFilter(src, w, h, r, true);
const minFilter = (src, w, h, r) => rankFilter(src, w, h, r, false);
/** Grey closing: thin dark strokes (narrower than 2r + 1) take the tone around them. */
const closing = (src, w, h, r) => minFilter(maxFilter(src, w, h, r), w, h, r);

/** Paper colour: the most common grey value above 150 among the pixels where `use` is set (as detect.js reads it). */
function paperOf(grey, use) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) if (!use || use[i]) hist[grey[i]]++;
  let best = 255;
  for (let i = 150; i < 256; i++) if (hist[i] > hist[best]) best = i;
  return hist[best] ? best : 255;
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Wall-shaped pixels per grey band of the closed grey image `c` (thin strokes gone), the pixels where `use` is set
 * only. Bands are 24 grey values wide, every 8, up to paper − 25; a band with less than 0.2 % of the pixels is skipped.
 * A pixel of a band is wall-shaped when it lies on a run of the band along one axis at least `minLen` (0.6 m) long, and
 * across it on a run of at most a thick wall (0.45 m) with lighter pixels on both sides, 2 px out: at least the band's
 * top + `contrast` (a wall is darker than the rooms on either side of it; a strip of grey floor between a black wall
 * and a worktop is not a wall).
 *
 * The bands overlap (each grey value is in three), but every third band does not: v mod 24 = 0, 8 and 16 are three
 * groups, each scored in one pass over the image with the pixel's band in the group as its label – two scans per group
 * (rows, then columns with a state per column, so the image is read in memory order), no per-band rasters.
 * @param {Uint8Array} c  closed grey
 * @param {Uint8Array | null} use  1 where a pixel may be wall (null: everywhere)
 * @param {Float32Array | null} chroma  per pixel (the smoothed chroma), summed over each band's wall-shaped pixels
 * @param {{ contrast?: number, only?: number[], mask?: Uint8Array }} [opt]  only: score just these bands (by v);
 *   mask: set to 1 at the wall-shaped pixels of the scored bands
 * @returns {{ v: number, wallish: number, tint: number }[]}  per scored band, in order of v
 */
function wallBands(c, use, w, h, ppm, paper, chroma, opt = {}) {
  const { contrast = 0, only = null, mask = null } = opt;
  const n = w * h;
  const minLen = Math.max(8, Math.round(0.6 * ppm));
  const maxT = Math.round(0.45 * ppm) + 2;
  const hist = new Uint32Array(256);
  if (use) {
    for (let i = 0; i < n; i++) if (use[i]) hist[c[i]]++;
  } else for (let i = 0; i < n; i++) hist[c[i]]++;
  const bands = [];
  for (let v = 0; v + 23 <= paper - 25; v += 8) {
    if (only && !only.includes(v)) continue;
    let count = 0;
    for (let k = v; k < v + 24; k++) count += hist[k];
    if (count >= n * 0.002) bands.push({ v, wallish: 0, tint: 0 });
  }
  if (!bands.length) return bands;
  const NONE = 255;
  const label = new Uint8Array(n);
  const flags = new Uint8Array(n); // bit 1: on a long horizontal run, bit 2: on a short horizontal run, lighter beyond
  const startY = new Int32Array(w);
  const labY = new Uint8Array(w);
  for (let g = 0; g < 3; g++) {
    const group = bands.filter((b) => b.v % 24 === g * 8);
    if (!group.length) continue;
    const lut = new Uint8Array(256).fill(NONE); // grey value → the band of the group it is in
    group.forEach((b, id) => lut.fill(id, b.v, b.v + 24));
    const side = group.map((b) => b.v + 24 + contrast); // what the pixels beyond a short run must reach
    // rows: the runs of one band label, long ones and short bounded ones
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let L = NONE;
      let s = 0;
      for (let x = 0; x <= w; x++) {
        const i = row + x;
        let l = NONE;
        if (x < w) {
          l = use && !use[i] ? NONE : lut[c[i]];
          label[i] = l;
          flags[i] = 0;
        }
        if (l === L) continue;
        if (L !== NONE) {
          const len = x - s;
          let f = 0;
          if (len >= minLen) f |= 1;
          if (len <= maxT && s >= 2 && x + 1 < w && c[row + s - 2] >= side[L] && c[row + x + 1] >= side[L]) f |= 2;
          if (f) for (let q = row + s; q < i; q++) flags[q] = f;
        }
        L = l;
        s = x;
      }
    }
    // columns, row by row with a run state per column: a wall-shaped pixel is long one way and short the other
    startY.fill(0);
    labY.fill(NONE);
    for (let y = 0; y <= h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = y < h ? label[row + x] : NONE;
        const L = labY[x];
        if (l === L) continue;
        if (L !== NONE) {
          const s = startY[x];
          const len = y - s;
          const long = len >= minLen;
          const short = len <= maxT && s >= 2 && y + 1 < h && c[(s - 2) * w + x] >= side[L] && c[(y + 1) * w + x] >= side[L];
          if (long || short) {
            const b = group[L];
            for (let q = s * w + x; q < row; q += w) {
              const f = flags[q];
              if ((short && f & 1) || (long && f & 2)) {
                b.wallish++;
                if (chroma) b.tint += chroma[q];
                if (mask) mask[q] = 1;
              }
            }
          }
        }
        labY[x] = l;
        startY[x] = y;
      }
    }
  }
  return bands;
}

/**
 * The tone of the walls: the band of 24 grey values (wallBands) with the most wall-shaped pixels.
 * @param {Uint8Array} grey  luma (or, with opt.closed, the closed grey itself)
 * @param {Uint8Array | null} use  1 where the pixel may be wall (the neutral pixels; or the coloured ones)
 * @param {Float32Array} [chroma]  the (smoothed) chroma per pixel, for the walls' own tint
 * @param {{ closed?: boolean, contrast?: number }} [opt]  closed: `grey` is already closed; contrast: see wallBands
 * @returns {{ tone: [number, number], share: number, darker: number, chroma: number } | null}  share = wall-shaped
 *   pixels / all pixels; darker = the best band entirely 40 grey values or more under the winner, relative to the
 *   winner (0–1); chroma = the mean chroma of the winner's wall-shaped pixels (0 for neutral walls, ~15 for hus3)
 */
export function estimateWallTone(grey, use, w, h, ppm, paper, chroma = null, opt = {}) {
  const c = opt.closed ? grey : closing(grey, w, h, closeRadius(ppm));
  const bands = wallBands(c, use, w, h, ppm, paper, chroma, { contrast: opt.contrast ?? 0 });
  if (!bands.length) return null;
  const best = bands.reduce((p, q) => (q.wallish > p.wallish ? q : p));
  if (best.wallish <= w * h * 0.001) return null;
  const darker = Math.max(0, ...bands.filter((q) => q.v + 23 < best.v - 40).map((q) => q.wallish)) / best.wallish;
  return { tone: [best.v, best.v + 23], share: best.wallish / (w * h), darker, chroma: best.tint / best.wallish, bands };
}

/** The closing radius that removes strokes thinner than the thinnest wall (6 cm) – text, door arcs, window lines. */
const closeRadius = (ppm) => Math.max(1, Math.min(4, Math.round((0.06 * ppm) / 2 - 0.5)));

/**
 * Coloured ink and fills → paper (see the top of the file). Writes into `out` (RGBA, a copy of the input).
 * ctx.cast moves every chroma threshold up (the plan's own colour cast); ctx.keep marks coloured walls, which stay as
 * drawn; ctx.colouredWalls turns the guard on.
 * @returns {{ changed, inpainted, guard, colouredInk, neutralInk, paper }}  pixels changed, ink pixels filled in from
 *   across, the guard (coloured ink is the main ink), the ink counts behind it, the paper tone used
 */
function removeColour(img, out, grey, ctx, o) {
  const { width: w, height: h } = img;
  const n = w * h;
  const { chroma, smooth, mx, wallTone, keep } = ctx;
  const cast = ctx.cast || 0;
  const ownChroma = o.ownChroma + cast;
  const colourFrom = o.colourFrom + cast;
  const colourSpan = o.colourFull - o.colourFrom;
  const tintFrom = o.tintFrom + cast;
  // with coloured walls every antialiased edge is a faint tint: the tint rule is off
  const lightOf = ctx.colouredWalls ? 256 : wallTone ? wallTone[1] + 12 : 200;
  // neutral walls (their own chroma under 5): a tinted fill cannot be a wall, darker or lighter (the blue-grey bathroom
  // of hus9 under its grey walls)
  const tintAny = wallTone && ctx.wallChroma < 5;
  const weight = new Float32Array(n);
  let any = 0;
  for (let i = 0; i < n; i++) {
    if (chroma[i] < ownChroma || (keep && keep[i])) continue;
    let t = (smooth[i] - colourFrom) / colourSpan;
    // a faint tint counts only on fills lighter than the walls (or darker than neutral walls)
    if (t <= 0 && smooth[i] >= tintFrom && (grey[i] > lightOf || (tintAny && grey[i] < wallTone[0] - 12))) t = 1;
    if (t <= 0) continue;
    weight[i] = t >= 1 ? 1 : t;
    any++;
  }
  if (!any) return { changed: 0, guard: !!ctx.colouredWalls, colouredInk: 0, neutralInk: 0 };
  // the guard: coloured ink (every pixel this step would touch) against neutral dark ink
  let colouredInk = 0;
  let neutralInk = 0;
  for (let i = 0; i < n; i++) {
    if (grey[i] >= o.inkLuma) continue;
    if (weight[i] > 0) colouredInk++;
    else if (smooth[i] < colourFrom) neutralInk++;
  }
  const guard = !!ctx.colouredWalls || colouredInk > neutralInk;
  const neutral = new Uint8Array(n);
  for (let i = 0; i < n; i++) neutral[i] = weight[i] === 0 ? 1 : 0;
  const paper = paperOf(grey, neutral);
  // what the guard keeps: the dark coloured ink; with coloured walls every coloured stroke (their window lines and door
  // arcs are coloured too, and lighter) – only fills about as light as the paper go
  const guardLuma = ctx.colouredWalls ? paper - 40 : o.inkLuma;
  // the local fill brightness: the brightest channel of the coloured pixels around (a flat fill: its own value)
  const fillSrc = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (weight[i] > 0) fillSrc[i] = mx[i];
  const fill = maxFilter(fillSrc, w, h, 4);
  // next to (within 1 px) strongly saturated dark ink – not a bright yellow fill – : the dark JPEG fringe of a blue
  // line is ink too
  const satInk = new Uint8Array(n);
  for (let i = 0; i < n; i++) satInk[i] = chroma[i] >= o.inkChroma && grey[i] < o.inkLuma ? 1 : 0;
  const satNear = maxFilter(satInk, w, h, 1);
  let changed = 0;
  const inkMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = weight[i];
    if (!t) continue;
    if (guard && grey[i] < guardLuma) continue; // coloured walls: keep the ink
    // more saturated than its surroundings: coloured ink (a callout line, a red chair) → paper. Otherwise: as bright as
    // the local fill (or the grain of a wood texture) is the fill itself → paper; clearly darker is a neutral stroke on
    // the fill (a door arc, a wall's edge), which keeps its grey – the darkness the detection knows
    const k = mx[i] / Math.max(fill[i], mx[i], 1);
    const ink = chroma[i] > smooth[i] + 12 || satNear[i] === 1;
    const s = ink || k >= o.fillTo ? 1 : k <= o.fillFrom ? 0 : (k - o.fillFrom) / (o.fillTo - o.fillFrom);
    if (ink && t >= 0.5) inkMask[i] = 1;
    const v = Math.round(grey[i] + Math.max(0, paper - grey[i]) * s * t); // never darker: a fill lighter than the paper stays
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    changed++;
  }
  const inpainted = inpaintInk(out, inkMask, w, h, 5);
  return { changed, inpainted, guard, colouredInk, neutralInk, paper };
}

/**
 * Coloured ink drawn on top of the drawing (a callout line across a wall or a window) is filled in from across it:
 * along x and along y the nearest pixels that are not ink within r are looked up, and the axis with the shorter gap
 * (across the stroke) is interpolated. A blue line over a black wall becomes wall again, over a window's lines the
 * lines; on paper it was paper already. Ink wider than 2r stays paper.
 */
function inpaintInk(out, ink, w, h, r) {
  const grey = (i) => out[i * 4];
  let count = 0;
  const vals = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      let best = null;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        let a = 0;
        let b = 0;
        for (let k = 1; k <= r && !a; k++) {
          const xx = x - dx * k;
          const yy = y - dy * k;
          if (xx < 0 || yy < 0) break;
          if (!ink[yy * w + xx]) a = k;
        }
        for (let k = 1; k <= r && !b; k++) {
          const xx = x + dx * k;
          const yy = y + dy * k;
          if (xx >= w || yy >= h) break;
          if (!ink[yy * w + xx]) b = k;
        }
        if (!a || !b) continue;
        if (!best || a + b < best.a + best.b) best = { a, b, dx, dy };
      }
      if (!best) continue;
      const { a, b, dx, dy } = best;
      const va = grey((y - dy * a) * w + (x - dx * a));
      const vb = grey((y + dy * b) * w + (x + dx * b));
      vals.push(i, Math.round(va + ((vb - va) * a) / (a + b)));
    }
  }
  // written after the scan, so a filled pixel is never the source of another
  for (let k = 0; k < vals.length; k += 2) {
    const i = vals[k];
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = vals[k + 1];
    count++;
  }
  return count;
}

/**
 * Hatching → paper (see the top of the file). Thin strokes on paper or a light floor (the grey closing over (2r + 1)²,
 * r ≈ 2 cm, makes them lighter) go when they are one of a field: across them, parallel strokes follow each other with
 * even gaps (a gap of twice the others – a line hidden under a label – is allowed, as long as half the gaps are single).
 * Two kinds of field:
 *   - faint strokes, at most hatchDepth darker than the ground (wood-floor lines and tile grids, hus4; with hatch: true
 *     also the graph paper of the owner's plan and the terrace tiles of hus2 and hus3), at least hatchLines of them;
 *   - long strokes of any darkness, at least 1.5 m (the terrace boards of hus4), at least hatchLines + 1 of them – a
 *     stair's treads are shorter, a window has two or three lines, a dimension line is alone.
 * A straight faint stroke (8-connected) of which a third is in a field goes entirely (the ends of a floor line next to
 * a bed or a label); the antialiased fringe of a removed stroke goes with it. The pixels take the closing's value (the
 * floor under the line).
 * @returns {{ changed: number, r: number, paper: number }}
 */
function removeHatch(out, o) {
  const { width: w, height: h, data } = out;
  const n = w * h;
  const ppm = o.pxPerM > 0 ? o.pxPerM : 50;
  const r = Math.max(1, Math.min(3, Math.round(0.02 * ppm)));
  const g = lumaOf(data, n);
  const paper = paperOf(g, null);
  const c = closing(g, w, h, r);
  const depth = new Uint8Array(n);
  for (let i = 0; i < n; i++) depth[i] = c[i] - g[i];
  const near = maxFilter(depth, w, h, r);
  const faint = raster(w, h);
  const stroke = raster(w, h);
  for (let i = 0; i < n; i++) {
    const ground = c[i] >= paper - 45;
    faint.data[i] = ground && depth[i] >= 4 && near[i] <= o.hatchDepth ? 1 : 0;
    stroke.data[i] = ground && depth[i] >= 12 ? 1 : 0;
  }
  // the long strokes per axis
  const Lmin = Math.round(1.5 * ppm);
  const Hs = runLengths(stroke, 'h');
  const Vs = runLengths(stroke, 'v');
  const longH = new Uint8Array(n);
  const longV = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    longH[i] = Hs.data[i] >= Lmin ? 1 : 0;
    longV[i] = Vs.data[i] >= Lmin ? 1 : 0;
  }
  const hatch = new Uint8Array(n); // bit 1: a horizontal stroke of a field, bit 2: a vertical one
  const maxThick = 2 * r + 1;
  const minGap = maxThick + 1;
  const maxGap = Math.max(minGap + 2, Math.round(0.6 * ppm));
  const single = (g0, gap) => gap <= g0 * 1.25 + 1;
  const even = (g0, gap) => single(g0, gap) || (gap >= g0 * 1.75 - 1 && gap <= g0 * 2.3 + 1);
  const columns = (x, y) => y * w + x; // walk down a column: strokes across it are horizontal
  const rows = (y, x) => y * w + x;
  // one pass along lines of pixels: thin runs of the mask are strokes across; k strokes with even gaps are a field
  const pass = (mask, k, lines, len, at, bit) => {
    const runs = [];
    for (let l = 0; l < lines; l++) {
      runs.length = 0;
      let start = -1;
      for (let p = 0; p <= len; p++) {
        const on = p < len && mask[at(l, p)];
        if (on && start < 0) start = p;
        else if (!on && start >= 0) {
          if (p - start <= maxThick) runs.push([start, p - 1]);
          start = -1;
        }
      }
      if (runs.length < k) continue;
      const mid = runs.map(([a, b]) => (a + b) / 2);
      const mark = new Uint8Array(runs.length);
      for (let s = 0; s + k <= runs.length; s++) {
        let g0 = Infinity;
        for (let j = s + 1; j < s + k; j++) g0 = Math.min(g0, mid[j] - mid[j - 1]);
        if (g0 < minGap || g0 > maxGap) continue;
        let ok = true;
        let ones = 0;
        for (let j = s + 1; j < s + k && ok; j++) {
          const gap = mid[j] - mid[j - 1];
          ok = even(g0, gap);
          if (single(g0, gap)) ones++;
        }
        if (ok && ones * 2 >= k - 1) for (let j = s; j < s + k; j++) mark[j] = 1;
      }
      runs.forEach(([a, b], j) => {
        if (mark[j]) for (let p = a; p <= b; p++) hatch[at(l, p)] |= bit;
      });
    }
  };
  pass(faint.data, o.hatchLines, w, h, columns, 1);
  pass(faint.data, o.hatchLines, h, w, rows, 2);
  pass(longH, o.hatchLines + 1, w, h, columns, 1);
  pass(longV, o.hatchLines + 1, h, w, rows, 2);
  // whole straight faint strokes with a third or more of them in a field
  const { labels, comps } = components(faint, 8);
  const marked = new Uint32Array(comps.length);
  for (let i = 0; i < n; i++) if (hatch[i] && labels[i] >= 0) marked[labels[i]]++;
  const straight = comps.map((cp, j) => Math.min(cp.maxX - cp.minX, cp.maxY - cp.minY) + 1 <= 2 * maxThick && marked[j] * 3 >= cp.area);
  // … and the faint fringe of every removed stroke
  const grown = maxFilter(hatch, w, h, 1);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (c[i] <= g[i]) continue;
    // where another stroke crosses a field's line (a door arc, a letter), the crossing stays: no gap in the arc
    const hb = hatch[i];
    if ((hb === 1 && Vs.data[i] > maxThick + 1) || (hb === 2 && Hs.data[i] > maxThick + 1)) continue;
    const l = labels[i];
    if (!(hb || (grown[i] && faint.data[i]) || (l >= 0 && straight[l]))) continue;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c[i];
    changed++;
  }
  return { changed, r, paper };
}

/**
 * Dark furniture on a plan with light grey walls → paper: black sofas, beds, worktops and dark tiled floors (hus9).
 * With grey walls the detection's dark pass takes them for walls and never tries the wall tone. Thick only: what stays
 * darker than wallTone[0] − 40 after a grey closing that removes strokes thinner than the thinnest wall (text, door
 * arcs, window lines stay). Its antialiased rim goes with it, the wall band itself is never touched. A dark stroke that
 * is shaped like a wall (at least 1 m long, at most 30 cm thick on average: area / (width + height) of its box, and no
 * loop round more than 40 × 40 cm) and runs from wall to wall (it meets the printed walls in two places at least 80 cm
 * apart) stays: walls sketched by hand with a marker on a printed plan (hus9 «alternativ»), and takes the wall tone, so
 * the detection finds it together with the printed walls. A black shelf or a bath's rim along one wall, the frame of a
 * rug, are furniture.
 * A dark object drawn on its own – its dark pixels (8-connected) little more than its thick parts: a sofa, two pillows
 * joined by a line, a marker scribble – is judged whole, and its thin pixels go with it: the wall tone within 15 cm of
 * a wall-shaped part (a scribble's black tips would otherwise stay and send the detection back to the dark pass), paper
 * elsewhere. One that runs into other dark ink (text, a wall's dark outline) is judged by its thick parts only.
 * @returns {{ changed: number, kept: number, darkT: number }}
 */
function removeDarkFurniture(out, wallTone, ppm) {
  const { width: w, height: h, data } = out;
  const n = w * h;
  const g = lumaOf(data, n);
  const r = Math.max(2, Math.min(5, Math.round((0.06 * ppm) / 2 + 0.5)));
  const c = closing(g, w, h, r);
  const darkT = wallTone[0] - 40;
  const thick = new Uint8Array(n);
  const raw = new Uint8Array(n);
  let thickN = 0;
  for (let i = 0; i < n; i++) {
    raw[i] = g[i] < darkT ? 1 : 0;
    thick[i] = c[i] < darkT ? 1 : 0; // the closing only lightens: thick ⊆ raw
    thickN += thick[i];
  }
  if (!thickN) return { changed: 0, kept: 0, darkT }; // nothing thick and dark: text and lines only
  // a wall is a stroke: at least 1 m long, at most 30 cm thick on average, and it encloses nothing larger than
  // 40 × 40 cm (the frame of a rug or a bed is a loop; the zigzag of a scribble only has small gaps)
  const minHole = Math.round((0.4 * ppm) ** 2);
  const gapR = Math.max(1, Math.round(0.05 * ppm));
  const wallShaped = (cp, labels, j) => {
    const bw = cp.maxX - cp.minX + 1;
    const bh = cp.maxY - cp.minY + 1;
    return Math.max(bw, bh) >= 1.0 * ppm && cp.area / (bw + bh) <= 0.3 * ppm && largestHole(labels, j, cp, w, h, gapR) < minHole;
  };
  const R = components({ w, h, data: raw }, 8);
  const thickIn = new Uint32Array(R.comps.length);
  for (let i = 0; i < n; i++) if (thick[i]) thickIn[R.labels[i]]++;
  const whole = R.comps.map((cp, j) => thickIn[j] > 0 && cp.area <= 3 * thickIn[j]);
  const T = components({ w, h, data: thick }, 8);
  const wallT = T.comps.map((cp, j) => wallShaped(cp, T.labels, j));
  // a wall drawn by hand runs from wall to wall: it meets the printed walls (their band, within 3 px) in two places at
  // least 80 cm apart – a black shelf or a bath's rim along one wall, a rug in the room, are furniture. Judged per dark
  // object when it is drawn on its own, else per thick part
  const band = new Uint8Array(n);
  for (let i = 0; i < n; i++) band[i] = g[i] >= wallTone[0] - 10 && g[i] <= wallTone[1] + 10 ? 1 : 0;
  const meets = (labels, j, cp) => contactSpan(labels, j, cp, band, w, h, 3) >= 0.8 * ppm;
  const anyWall = new Uint8Array(R.comps.length);
  T.comps.forEach((cp, j) => {
    if (wallT[j]) anyWall[R.labels[cp.minY * w + firstX(T.labels, j, cp, w)]] = 1;
  });
  R.comps.forEach((cp, j) => {
    if (anyWall[j] && whole[j] && !meets(R.labels, j, cp)) anyWall[j] = 0;
  });
  T.comps.forEach((cp, j) => {
    if (!wallT[j]) return;
    const k = R.labels[cp.minY * w + firstX(T.labels, j, cp, w)];
    if (whole[k] ? !anyWall[k] : !meets(T.labels, j, cp)) wallT[j] = false;
  });
  // the thin dark pixels of an object drawn on its own go with its thick parts: the wall tone near (within 15 cm of) a
  // wall-shaped part – the black tips of a scribbled wall – and paper elsewhere
  const sketchThick = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (thick[i] && wallT[T.labels[i]]) sketchThick[i] = 1;
  const nearWall = maxFilter(sketchThick, w, h, Math.max(1, Math.round(0.15 * ppm)));
  const kept = wallT.filter(Boolean).length;
  // furniture → paper (and its rim); the wall-shaped strokes take the wall tone (so the detection finds them with the
  // other walls, in one pass)
  const furniture = new Uint8Array(n);
  const sketch = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!raw[i]) continue;
    const j = R.labels[i];
    if (!thickIn[j]) continue; // text and thin lines
    const wall = thick[i] ? wallT[T.labels[i]] : whole[j] ? anyWall[j] === 1 && nearWall[i] === 1 : null;
    if (wall === true) sketch[i] = 1;
    else if (wall === false) furniture[i] = 1;
  }
  const rim = maxFilter(furniture, w, h, 2);
  const sketchRim = kept ? maxFilter(sketch, w, h, 1) : sketch;
  const paper = paperOf(g, null);
  const tone = Math.round((wallTone[0] + wallTone[1]) / 2);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (sketchRim[i] && g[i] < wallTone[0] - 10) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = tone;
      changed++;
      continue;
    }
    if (!rim[i] || (g[i] >= wallTone[0] - 10 && g[i] <= wallTone[1])) continue;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = paper;
    changed++;
  }
  return { changed, kept, darkT };
}

/**
 * The largest area that component j encloses (px), its gaps up to 2r + 1 px closed first: the pixels of its box that
 * are not it and cannot reach the box's border (4-connected) – the inside of a loop, even a loop with small gaps (the
 * frame of a rug).
 */
function largestHole(labels, j, cp, w, h, r) {
  const x0 = Math.max(0, cp.minX - r - 1);
  const y0 = Math.max(0, cp.minY - r - 1);
  const bw = Math.min(w - 1, cp.maxX + r + 1) - x0 + 1;
  const bh = Math.min(h - 1, cp.maxY + r + 1) - y0 + 1;
  let m = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (labels[(y0 + y) * w + x0 + x] === j) m[y * bw + x] = 1;
  if (r > 0) m = closing(m, bw, bh, r);
  // 0: free, 1: the component, 2: reached from the border (or counted)
  const stack = new Int32Array(bw * bh);
  const fill = (s) => {
    let top = 0;
    let area = 0;
    stack[top++] = s;
    m[s] = 2;
    while (top) {
      const p = stack[--top];
      area++;
      const x = p % bw;
      const y = (p - x) / bw;
      if (x > 0 && !m[p - 1]) { m[p - 1] = 2; stack[top++] = p - 1; }
      if (x < bw - 1 && !m[p + 1]) { m[p + 1] = 2; stack[top++] = p + 1; }
      if (y > 0 && !m[p - bw]) { m[p - bw] = 2; stack[top++] = p - bw; }
      if (y < bh - 1 && !m[p + bw]) { m[p + bw] = 2; stack[top++] = p + bw; }
    }
    return area;
  };
  for (let x = 0; x < bw; x++) {
    if (!m[x]) fill(x);
    if (!m[(bh - 1) * bw + x]) fill((bh - 1) * bw + x);
  }
  for (let y = 0; y < bh; y++) {
    if (!m[y * bw]) fill(y * bw);
    if (!m[y * bw + bw - 1]) fill(y * bw + bw - 1);
  }
  let best = 0;
  for (let p = 0; p < bw * bh; p++) if (!m[p]) best = Math.max(best, fill(p));
  return best;
}

/**
 * How far apart the places are where component j meets the mask `band` (px, within d px of it): the largest distance
 * between the centres of the 8-connected groups of band pixels it touches (0 when it touches one group or none).
 */
function contactSpan(labels, j, cp, band, w, h, d) {
  const x0 = Math.max(0, cp.minX - d);
  const y0 = Math.max(0, cp.minY - d);
  const bw = Math.min(w - 1, cp.maxX + d) - x0 + 1;
  const bh = Math.min(h - 1, cp.maxY + d) - y0 + 1;
  const m = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (labels[(y0 + y) * w + x0 + x] === j) m[y * bw + x] = 1;
  const near = maxFilter(m, bw, bh, d);
  const touch = { w: bw, h: bh, data: new Uint8Array(bw * bh) };
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (near[y * bw + x] && !m[y * bw + x] && band[(y0 + y) * w + x0 + x]) touch.data[y * bw + x] = 1;
  const groups = components(touch, 8).comps.filter((g) => g.area >= 3).map((g) => [g.sx / g.area, g.sy / g.area]);
  let span = 0;
  for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) span = Math.max(span, Math.hypot(groups[a][0] - groups[b][0], groups[a][1] - groups[b][1]));
  return span;
}

/** The first x of component j on its top row (a pixel of it, to look up what contains it). */
function firstX(labels, j, cp, w) {
  const row = cp.minY * w;
  for (let x = cp.minX; x <= cp.maxX; x++) if (labels[row + x] === j) return x;
  return cp.minX;
}

/**
 * Light fills on a plan with light grey walls → paper: what is left of a floor between the wall tone and the paper
 * (the grain of a wood texture, a light grey tile floor). The detection's grey band reaches up from the wall tone and
 * takes such floors in as walls. Thick and light only: the pixel and its grey closing (thin strokes gone) are both at
 * least 16 lighter than the wall tone, and it is not next to a wall-tone pixel (the walls keep their antialiased edge).
 * @returns {{ changed: number }}
 */
function flattenLightFills(out, wallTone, ppm) {
  const { width: w, height: h, data } = out;
  const n = w * h;
  const g = lumaOf(data, n);
  const r = Math.max(1, Math.min(4, Math.round((0.06 * ppm) / 2 - 0.5)));
  const c = closing(g, w, h, r);
  const paper = paperOf(g, null);
  const light = wallTone[1] + 16;
  const band = new Uint8Array(n);
  for (let i = 0; i < n; i++) band[i] = g[i] >= wallTone[0] - 10 && g[i] < light ? 1 : 0;
  const nearBand = maxFilter(band, w, h, 1);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (g[i] < light || c[i] < light || g[i] >= paper || nearBand[i]) continue;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = paper;
    changed++;
  }
  return { changed };
}

/** Per pixel the length of the run of 1s through it along a diagonal (dx = +1: down-right, dx = −1: down-left). */
function diagonalRuns(mask, w, h, dx) {
  const out = new Uint16Array(w * h);
  const step = w + dx;
  const walk = (x0, y0) => {
    let start = -1;
    let x = x0;
    let y = y0;
    let i = y * w + x;
    for (; ; x += dx, y++, i += step) {
      const inside = x >= 0 && x < w && y < h;
      const on = inside && mask[i];
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        const len = (i - start) / step;
        for (let q = start; q < i; q += step) out[q] = len;
        start = -1;
      }
      if (!inside) break;
    }
  };
  for (let x = 0; x < w; x++) walk(x, 0);
  for (let y = 1; y < h; y++) walk(dx > 0 ? 0 : w - 1, y);
  return out;
}

/**
 * Hatched walls → solid walls: architect drawings draw a wall as two thin outlines with diagonal hatching between them
 * (hus6), which the detection cannot see as a wall (every stroke is thinner than the thinnest wall). Where thin
 * diagonal strokes (at least 5 px along a diagonal, short along the axes) of one direction form a field – three or
 * more of them start along a row or a column within ±13 cm, and two the other way, and they cover at least hatchFill of a 7 × 7
 * window – the area between them is closed and filled with ink, outlines included. A single diagonal line or a door
 * arc at 45° is one stroke; text rarely has three parallel strokes in a row and in a column.
 * @returns {{ changed: number }}
 */
function fillHatchedWalls(out, o) {
  const { width: w, height: h, data } = out;
  const n = w * h;
  const g = lumaOf(data, n);
  const paper = paperOf(g, null);
  const dark = raster(w, h);
  for (let i = 0; i < n; i++) dark.data[i] = g[i] < paper - 70 ? 1 : 0;
  // one mask per direction: a hatch is parallel strokes, text and arcs mix both directions (the run rasters are let go
  // as soon as the masks are made: a large page holds a lot of them)
  const diag1 = new Uint8Array(n);
  const diag2 = new Uint8Array(n);
  let any = 0;
  {
    const Hr = runLengths(dark, 'h');
    const Vr = runLengths(dark, 'v');
    const D1 = diagonalRuns(dark.data, w, h, 1);
    const D2 = diagonalRuns(dark.data, w, h, -1);
    for (let i = 0; i < n; i++) {
      if (!dark.data[i] || Hr.data[i] > 3 || Vr.data[i] > 3) continue;
      if (D1[i] >= 5 && D1[i] > D2[i]) diag1[i] = 1;
      else if (D2[i] >= 5 && D2[i] > D1[i]) diag2[i] = 1;
      else continue;
      any++;
    }
  }
  if (any < n * 0.0005) return { changed: 0 };
  // a hatch is several parallel strokes: along a row and along a column through the pixel, at least three strokes of
  // the same direction start within ±half (a single diagonal line, a door arc at 45°, are one stroke)
  const half = Math.max(8, Math.round(0.13 * (o.pxPerM > 0 ? o.pxPerM : 50)));
  const strokes = (mask) => {
    const rowsN = new Uint8Array(n);
    const colsN = new Uint8Array(n);
    const pre = new Int32Array(w + 1);
    for (let y = 0; y < h; y++) {
      pre[0] = 0;
      for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + (mask[y * w + x] && !(x > 0 && mask[y * w + x - 1]) ? 1 : 0);
      for (let x = 0; x < w; x++) rowsN[y * w + x] = Math.min(255, pre[Math.min(w, x + half + 1)] - pre[Math.max(0, x - half)]);
    }
    // per column, the starts within ±half rows: a running count while the rows go by
    const count = new Int32Array(w);
    const startAt = (y, x) => (mask[y * w + x] && !(y > 0 && mask[(y - 1) * w + x]) ? 1 : 0);
    for (let y = 0; y < Math.min(h, half); y++) for (let x = 0; x < w; x++) count[x] += startAt(y, x);
    for (let y = 0; y < h; y++) {
      if (y + half < h) for (let x = 0; x < w; x++) count[x] += startAt(y + half, x);
      if (y - half - 1 >= 0) for (let x = 0; x < w; x++) count[x] -= startAt(y - half - 1, x);
      for (let x = 0; x < w; x++) colsN[y * w + x] = Math.min(255, count[x]);
    }
    return { rowsN, colsN };
  };
  // a field of one direction: a hatched wall crossed across is only a few strokes wide – three one way, two the other –
  // and its strokes cover hatchFill of the 7 × 7 window (one direction at a time, so only one set of counts is held)
  const dense = new Uint8Array(n);
  for (const diag of [diag1, diag2]) {
    const { rowsN, colsN } = strokes(diag);
    const den = boxMean(diag, w, h, 3);
    for (let i = 0; i < n; i++) {
      const a = rowsN[i];
      const b = colsN[i];
      if ((a >= 3 ? b >= 2 : b >= 3 && a >= 2) && den[i] >= o.hatchFill) dense[i] = 1;
    }
  }
  // close the gaps between the strokes (and reach the outlines); a hatched wall is at least a 25 × 25 cm patch
  const region = minFilter(maxFilter(dense, w, h, 3), w, h, 3);
  const minArea = Math.round((0.25 * (o.pxPerM > 0 ? o.pxPerM : 50)) ** 2);
  const { labels, comps } = components({ w, h, data: region }, 8);
  const big = comps.map((cp) => cp.area >= minArea);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (!region[i] || g[i] === 0 || !big[labels[i]]) continue;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;
    changed++;
  }
  return { changed };
}

/**
 * The plan image tidied for the wall detection (see the top of the file).
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img  RGBA
 * @param {object} options  pxPerM (the scale, or an estimate; 50 when missing) + CLEAN_DEFAULTS
 */
export function cleanForWalls(img, options = {}) {
  const o = { ...CLEAN_DEFAULTS, ...options };
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const out = { width: w, height: h, data: new Uint8ClampedArray(d) };
  // transparent pixels composited on white, as luma (and so detect.js) reads them; the output is opaque
  for (let i = 3; i < out.data.length; i += 4) {
    const a = out.data[i];
    if (a === 255) continue;
    for (let k = i - 3; k < i; k++) out.data[k] = Math.round((out.data[k] * a) / 255 + 255 - a);
    out.data[i] = 255;
  }
  const ppm = o.pxPerM > 0 ? o.pxPerM : 50;
  const stats = { pxPerM: o.pxPerM ?? null, wallTone: null, ms: {} };
  const step = (name, fn) => {
    const t = now();
    const r = fn();
    stats.ms[name] = Math.round(now() - t);
    return r;
  };
  const t0 = now();
  // colour per pixel: chroma, its mean over ±2 px, and the brightest channel
  const grey = luma(img).data;
  const chroma = new Uint8Array(n);
  const mx = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    chroma[i] = d[i * 4 + 3] < 128 ? 0 : hi - lo; // transparent = paper (luma composites it on white)
    mx[i] = hi;
  }
  const smooth = boxMean(chroma, w, h, 2);
  // 1. the wall tone, twice over the closed grey (thin strokes gone): over the neutral pixels – faintly tinted walls
  // (hus3, a phone photo's bluish ink) count as neutral – and over the coloured ones, where a wall must be clearly darker
  // than both its sides (the planks of a wood floor are not walls). (Not at half the resolution: there the dark outline
  // of a light grey wall blends into a dark band of its own.)
  let cw = null;
  const wt = step('wallTone', () => {
    const c = closing(grey, w, h, closeRadius(ppm));
    const neutral = new Uint8Array(n);
    let colouredN = 0;
    for (let i = 0; i < n; i++) {
      neutral[i] = smooth[i] < o.colourFrom ? 1 : 0;
      colouredN += 1 - neutral[i];
    }
    const paper = paperOf(grey, neutral);
    const tone = estimateWallTone(c, neutral, w, h, ppm, paper, smooth, { closed: true });
    if (colouredN >= n * 0.002) {
      for (let i = 0; i < n; i++) neutral[i] = 1 - neutral[i];
      cw = estimateWallTone(c, neutral, w, h, ppm, paper, smooth, { closed: true, contrast: o.wallContrast });
      // coloured walls: more wall-shaped than the neutral ink, or a fair share of it (walls of two colours) – they are
      // kept as drawn, with a rim of 2 px (their antialiased edge)
      if (cw && (!tone || cw.share >= o.colouredWalls * tone.share)) {
        const best = Math.max(...cw.bands.map((b) => b.wallish));
        const only = cw.bands.filter((b) => b.wallish >= 0.25 * best).map((b) => b.v);
        const mask = new Uint8Array(n);
        wallBands(c, neutral, w, h, ppm, paper, null, { contrast: o.wallContrast, only, mask });
        cw.keep = maxFilter(mask, w, h, 2);
      }
    }
    return tone;
  });
  const colouredWalls = !!cw && (!wt || cw.share > wt.share);
  const walls = colouredWalls ? cw : wt;
  stats.wallTone = walls?.tone ?? null;
  stats.wallToneDarker = walls ? Math.round(walls.darker * 100) / 100 : null;
  stats.wallChroma = walls ? Math.round(walls.chroma * 10) / 10 : null;
  stats.colouredWalls = cw ? { tone: cw.tone, share: Math.round(cw.share * 1e5) / 1e5, chroma: Math.round(cw.chroma * 10) / 10, walls: colouredWalls, kept: !!cw.keep } : null;
  // the plan's own colour cast: what neutral walls carry above castFree lifts every chroma threshold
  const cast = o.colour && wt && !colouredWalls ? Math.max(0, Math.min(o.colourFrom, wt.chroma - o.castFree)) : 0;
  stats.cast = Math.round(cast * 10) / 10;
  // 2. colour
  let coloured = 0;
  for (let i = 0; i < n; i++) if (chroma[i] >= o.ownChroma && smooth[i] >= o.tintFrom) coloured++;
  const ctx = { chroma, smooth, mx, wallTone: stats.wallTone, wallChroma: walls?.chroma ?? 99, cast, keep: cw?.keep ?? null, colouredWalls };
  stats.colour = o.colour && coloured ? step('colour', () => removeColour(img, out.data, grey, ctx, o)) : { changed: 0, guard: colouredWalls };
  // light grey walls, clearly: neutral, the band starts at greyWallFrom or above, the darker bands hold little wall-shaped
  // ink, and no coloured ink is wall-shaped or the plan's main ink (red walls are not dark furniture)
  const greyWalls = !!wt && !colouredWalls && !cw?.keep && !stats.colour.guard && wt.tone[0] >= o.greyWallFrom && wt.darker < 0.25;
  stats.greyWalls = greyWalls;
  // 3. on light grey walls: dark furniture and light floors
  if (o.darkFurniture && greyWalls) stats.darkFurniture = step('darkFurniture', () => removeDarkFurniture(out, stats.wallTone, ppm));
  if (o.lightFills && greyWalls) stats.lightFills = step('lightFills', () => flattenLightFills(out, stats.wallTone, ppm));
  // 4. hatched walls → solid
  if (o.hatchedWalls) stats.hatchedWalls = step('hatchedWalls', () => fillHatchedWalls(out, { ...o, pxPerM: ppm }));
  // 5. hatching, by default only on light grey walls: there its tone is the walls' tone (measured: on the black and dark
  // grey plans of the test set it changed no wall and no room, only a door here and there)
  if (o.hatch === true || (o.hatch === 'grey' && greyWalls)) stats.hatch = step('hatch', () => removeHatch(out, { ...o, pxPerM: ppm }));
  stats.ms.total = Math.round(now() - t0);
  out.cleanStats = stats;
  return out;
}
