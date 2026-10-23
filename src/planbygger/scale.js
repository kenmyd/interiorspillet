/**
 * Planbygger: help with the scale – no OCR, only rules on what floor plans draw.
 *
 *   suggestScale(img) → { pxPerM, from: 'dører'|'vegger', wallPx, doorPx, doors, confidence: 'middels'|'lav' } | null
 *       1. the thinnest common wall thickness in the image (the first strong mode of the dark run lengths) is taken as
 *          an interior wall of 10 cm → a first guess;
 *       2. the detection runs with that guess; the median width of the doors it finds (the hole, frame included) is
 *          taken as 90 cm (the common Norwegian 9M door) → the suggestion.
 *       A suggestion only: the user checks it against a dimension in the plan (the editor shows a measured line).
 *   traceLine(grey, x, y) → { a: [x, y], b: [x, y], length } | null
 *       Snaps a click on a dimension line to its two ends: the thin dark line through the click is followed both ways
 *       (across the white label box in its middle) to its end ticks / arrow heads. The user then only types the
 *       number written on it.
 */
import { luma, histogram, threshold, runLengths } from './image.js';
import { detectPlan, autoDarkThreshold } from './detect.js';

export const ASSUMED_WALL = 0.1;
export const ASSUMED_DOOR = 0.9;

/** Modes of the run-length histogram of the dark pixels (both axes), runs of 3 … 80 px. */
function runModes(img) {
  const grey = luma(img);
  const t = autoDarkThreshold(histogram(grey));
  const dark = threshold(grey, t);
  const counts = new Float64Array(81);
  for (const axis of ['h', 'v']) {
    const rl = runLengths(dark, axis);
    // count each run once: at its first pixel
    const { w, h } = dark;
    for (let l = 0; l < (axis === 'h' ? h : w); l++) {
      let prev = 0;
      for (let i = 0; i < (axis === 'h' ? w : h); i++) {
        const idx = axis === 'h' ? l * w + i : i * w + l;
        const v = rl.data[idx];
        if (v && !prev && v >= 3 && v <= 80) counts[v]++;
        prev = v;
      }
    }
  }
  return counts;
}

export function suggestScale(img, { detect = detectPlan } = {}) {
  const counts = runModes(img);
  const smooth = (i) => (counts[i - 1] || 0) * 0.5 + counts[i] + (counts[i + 1] || 0) * 0.5;
  let total = 0;
  for (let i = 3; i <= 80; i++) total += counts[i];
  if (!total) return null;
  // the first local maximum that is a real share of all runs (text and lines give runs of 1–2 px, below 3)
  let wallPx = null;
  for (let i = 3; i <= 40; i++) {
    const v = smooth(i);
    if (v > total * 0.03 && v >= smooth(i - 1) && v >= smooth(i + 1)) {
      // the centre of the mode (two neighbouring lengths are one antialiased mode)
      const a = counts[i - 1] || 0;
      const b = counts[i];
      const c = counts[i + 1] || 0;
      wallPx = i + (c - a) / (2 * Math.max(1, a + b + c));
      break;
    }
  }
  if (!wallPx) return null;
  const guess = wallPx / ASSUMED_WALL;
  let doorPx = null;
  let doors = 0;
  try {
    const det = detect(img, { pxPerM: guess });
    const widths = det.openings.filter((o) => o.type === 'door').map((o) => o.to - o.from).sort((x, y) => x - y);
    doors = widths.length;
    if (widths.length) doorPx = widths[widths.length >> 1];
  } catch {
    doorPx = null;
  }
  if (doorPx && doors >= 2) {
    const fromDoors = doorPx / ASSUMED_DOOR;
    // the two must roughly agree, else the door guess is safer only with several doors
    const agree = Math.abs(fromDoors - guess) / guess < 0.35;
    return { pxPerM: fromDoors, from: 'dører', wallPx, doorPx, doors, confidence: agree && doors >= 3 ? 'middels' : 'lav' };
  }
  return { pxPerM: guess, from: 'vegger', wallPx, doorPx, doors, confidence: 'lav' };
}

/**
 * Follows a thin dark line through the clicked point (see the top of the file).
 * @param {{ w, h, data }} grey  luma raster
 */
export function traceLine(grey, x, y, { search = 6, maxGap = 70 } = {}) {
  const { w, h } = grey;
  const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 255 : grey.data[yy * w + xx]);
  // paper: the median of the neighbourhood
  const around = [];
  for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) around.push(at(Math.round(x) + dx, Math.round(y) + dy));
  around.sort((p, q) => p - q);
  const paper = around[around.length >> 1];
  const ink = (v) => v < paper - 45;
  // the nearest ink pixel
  let best = null;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const xx = Math.round(x) + dx;
      const yy = Math.round(y) + dy;
      if (ink(at(xx, yy)) && (!best || dx * dx + dy * dy < best.d)) best = { xx, yy, d: dx * dx + dy * dy };
    }
  }
  if (!best) return null;
  // the orientation: the longer ink run through it
  const run = (dx, dy) => {
    let n = 0;
    for (let k = 1; k < 40 && ink(at(best.xx + dx * k, best.yy + dy * k)); k++) n++;
    return n;
  };
  const horiz = run(1, 0) + run(-1, 0) >= run(0, 1) + run(0, -1);
  const [dx, dy] = horiz ? [1, 0] : [0, 1];
  // the line's own row / column: the darkest within ±2 px across
  let row = horiz ? best.yy : best.xx;
  {
    let dmin = 256;
    for (let k = -2; k <= 2; k++) {
      const v = horiz ? at(best.xx, best.yy + k) : at(best.xx + k, best.yy);
      if (v < dmin) {
        dmin = v;
        row = (horiz ? best.yy : best.xx) + k;
      }
    }
  }
  const inkAt = (s) => {
    for (let k = -1; k <= 1; k++) if (ink(horiz ? at(s, row + k) : at(row + k, s))) return true;
    return false;
  };
  // the ink across the line at s: a wall (or another drawn line crossing) is thick across – the line ends there
  const across = (s) => {
    let n = 0;
    for (const sgn of [1, -1]) {
      for (let k = sgn > 0 ? 0 : 1; k < 16; k++) {
        const v = horiz ? at(s, row + sgn * k) : at(row + sgn * k, s);
        if (!ink(v)) break;
        n++;
      }
    }
    return n;
  };
  const walk = (dir) => {
    let s = horiz ? best.xx : best.yy;
    let lastInk = s;
    let beforeThick = s;
    let thick = 0;
    const limit = horiz ? w : h;
    for (let gap = 0; s >= 0 && s < limit && gap <= maxGap; s += dir) {
      if (inkAt(s)) {
        // thick across for 3 px in a row = a wall (a crossing thin dimension line is thick across for 1–2 px only)
        if (across(s) >= 9) {
          if (!thick) beforeThick = lastInk;
          if (++thick >= 3) return beforeThick;
        } else thick = 0;
        lastInk = s;
        gap = 0;
      } else {
        gap++;
        thick = 0;
      }
    }
    return lastInk;
  };
  const s0 = walk(-1);
  const s1 = walk(1);
  if (s1 - s0 < 8) return null;
  const a = horiz ? [s0, row + 0.5] : [row + 0.5, s0];
  const b = horiz ? [s1 + 1, row + 0.5] : [row + 0.5, s1 + 1];
  return { a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]), horizontal: horiz, dx, dy };
}
