/**
 * Planbygger: the outline of a terrace or a balcony on a plan – classical, around the point the AI gave (houseread.js
 * doc.decks[].at). Decks are drawn outside the walls with boards (parallel lines) or tiles (a grid): a textured area.
 *
 *   findDeck(img, ppm, level, at, { found }) → { outline: [[x, y] × 4] (plan metres), surface: 'boards'|'tiles',
 *                                             against: wallId | null } | null
 *     img: the plan image (RGBA), ppm its px per metre, level the doc level (its walls), at the AI's point (plan m)
 *     found: levelRooms(level) (regions.js), to keep the deck outside the building; taken: [[x0, y0, x1, y1]] decks found
 *            already (plan m), kept clear like the building
 *
 * The method, on a grid of 0,1 m cells: a cell is textured when its 0,5 m surroundings are 4–60 % ink (grey 242) and it is
 * outside the building (no room, no wall within 0,1 m). The seed is the textured cell nearest the point (within 1,5 m).
 * A rectangle grows from it one row of cells at a time on each side while the new row is at least 65 % textured and
 * clear of the building; then the side that faces an exterior wall within 0,3 m is put on the wall's outer face. Kept
 * when it is 1,5–80 m² and at least 0,8 m deep. Boards or tiles: whether the ink in it runs one way or both.
 */
const CELL = 0.1;
/** ink: darker than this – the tiles' grid is drawn thin and grey (anti-aliased to 180–210), hus5's boards fainter still (222–235
 *  on paper at 253–255); a grey fill (hus2's floors) is ink everywhere, over the 60 % a texture may have */
const INK = 242;

export function findDeck(img, ppm, level, at, { found, taken = [] } = {}) {
  if (!img?.data || !(ppm > 0) || !Array.isArray(at) || !found) return null;
  const { width: W, height: H, data } = img;
  // the search window around the point: ±9 m
  const R = 9;
  const x0 = at[0] - R;
  const y0 = at[1] - R;
  const n = Math.round((2 * R) / CELL);
  const px = Math.max(1, Math.round(CELL * ppm));
  // dark ink per cell, from an integral image over the window's pixels
  const dark = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const cx = Math.round((x0 + i * CELL) * ppm);
      const cy = Math.round((y0 + j * CELL) * ppm);
      let d = 0;
      let t = 0;
      for (let y = cy; y < cy + px; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = cx; x < cx + px; x++) {
          if (x < 0 || x >= W) continue;
          const k = (y * W + x) * 4;
          t++;
          if (0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2] < INK) d++;
        }
      }
      dark[j * n + i] = t ? d / t : -1;
    }
  // the building: a room or a wall at the cell or within 0,1 m
  const building = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const c = [x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL];
      building[j * n + i] = [[0, 0], [CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]].some(([dx, dy]) => found.at(c[0] + dx, c[1] + dy) !== -1) || taken.some((t) => c[0] > t[0] && c[0] < t[2] && c[1] > t[1] && c[1] < t[3]) ? 1 : 0;
    }
  // textured: the 0,5 m around it (5 × 5 cells) 4–60 % dark, and outside the building
  const tex = new Uint8Array(n * n);
  for (let j = 2; j < n - 2; j++)
    for (let i = 2; i < n - 2; i++) {
      if (building[j * n + i]) continue;
      let s = 0;
      let c = 0;
      for (let b = -2; b <= 2; b++)
        for (let a = -2; a <= 2; a++) {
          const v = dark[(j + b) * n + i + a];
          if (v >= 0) {
            s += v;
            c++;
          }
        }
      const m = c ? s / c : 0;
      if (m >= 0.04 && m <= 0.6) tex[j * n + i] = 1;
    }
  // the seed: the textured cell nearest the point, within 1,5 m
  const ci = Math.round((at[0] - x0) / CELL);
  const cj = Math.round((at[1] - y0) / CELL);
  let seed = null;
  for (let r = 0; r <= 15 && !seed; r++)
    for (let b = -r; b <= r && !seed; b++)
      for (let a = -r; a <= r && !seed; a++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const i = ci + a;
        const j = cj + b;
        if (i >= 0 && j >= 0 && i < n && j < n && tex[j * n + i]) seed = [i, j];
      }
  if (!seed) return null;
  // grow a rectangle [i0, i1) × [j0, j1) one row at a time on each side
  let [i0, i1, j0, j1] = [seed[0], seed[0] + 1, seed[1], seed[1] + 1];
  const rowOk = (ia, ib, ja, jb) => {
    let t = 0;
    let all = 0;
    for (let j = ja; j < jb; j++)
      for (let i = ia; i < ib; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n || building[j * n + i]) return false;
        all++;
        t += tex[j * n + i];
      }
    return all > 0 && t >= 0.65 * all;
  };
  for (let grew = true, guard = 0; grew && guard < 400; guard++) {
    grew = false;
    if (rowOk(i0 - 1, i0, j0, j1)) (i0--, (grew = true));
    if (rowOk(i1, i1 + 1, j0, j1)) (i1++, (grew = true));
    if (rowOk(i0, i1, j0 - 1, j0)) (j0--, (grew = true));
    if (rowOk(i0, i1, j1, j1 + 1)) (j1++, (grew = true));
  }
  // the texture is measured over 0,5 m, so it reaches 0,2 m past the ink: each side comes in to its first row with ink
  const inked = (ia, ib, ja, jb) => {
    for (let j = ja; j < jb; j++) for (let i = ia; i < ib; i++) if (dark[j * n + i] > 0.02) return true;
    return false;
  };
  for (let k = 0; k < 3 && i1 - i0 > 2 && !inked(i0, i0 + 1, j0, j1); k++) i0++;
  for (let k = 0; k < 3 && i1 - i0 > 2 && !inked(i1 - 1, i1, j0, j1); k++) i1--;
  for (let k = 0; k < 3 && j1 - j0 > 2 && !inked(i0, i1, j0, j0 + 1); k++) j0++;
  for (let k = 0; k < 3 && j1 - j0 > 2 && !inked(i0, i1, j1 - 1, j1); k++) j1--;
  let r = [x0 + i0 * CELL, y0 + j0 * CELL, x0 + i1 * CELL, y0 + j1 * CELL];
  // the side towards an exterior wall within 0,3 m: on its outer face
  let against = null;
  for (const w of level.walls.filter((x) => x.exterior)) {
    const horiz = Math.abs(w.b[1] - w.a[1]) < 0.02 * Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const vert = Math.abs(w.b[0] - w.a[0]) < 0.02 * Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (!horiz && !vert) continue;
    const t2 = (w.t ?? 0.2) / 2;
    if (horiz) {
      const y = (w.a[1] + w.b[1]) / 2;
      const ov = Math.min(r[2], Math.max(w.a[0], w.b[0])) - Math.max(r[0], Math.min(w.a[0], w.b[0]));
      if (ov < 0.5 * (r[2] - r[0])) continue;
      if (Math.abs(r[1] - (y + t2)) <= 0.3) [r[1], against] = [y + t2, w.id];
      else if (Math.abs(r[3] - (y - t2)) <= 0.3) [r[3], against] = [y - t2, w.id];
    } else {
      const x = (w.a[0] + w.b[0]) / 2;
      const ov = Math.min(r[3], Math.max(w.a[1], w.b[1])) - Math.max(r[1], Math.min(w.a[1], w.b[1]));
      if (ov < 0.5 * (r[3] - r[1])) continue;
      if (Math.abs(r[0] - (x + t2)) <= 0.3) [r[0], against] = [x + t2, w.id];
      else if (Math.abs(r[2] - (x - t2)) <= 0.3) [r[2], against] = [x - t2, w.id];
    }
  }
  const wDeck = r[2] - r[0];
  const hDeck = r[3] - r[1];
  if (Math.min(wDeck, hDeck) < 0.8 || wDeck * hDeck < 1.5 || wDeck * hDeck > 80) return null;
  // boards or tiles: dark runs along x against along y inside it
  let hx = 0;
  let vy = 0;
  const sx = Math.max(0, Math.round(r[0] * ppm));
  const ex = Math.min(W - 1, Math.round(r[2] * ppm));
  const sy = Math.max(0, Math.round(r[1] * ppm));
  const ey = Math.min(H - 1, Math.round(r[3] * ppm));
  const isDark = (x, y) => {
    const k = (y * W + x) * 4;
    return 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2] < INK;
  };
  const minRun = Math.max(6, Math.round(0.3 * ppm));
  for (let y = sy; y <= ey; y += 2) {
    let run = 0;
    for (let x = sx; x <= ex; x++) {
      run = isDark(x, y) ? run + 1 : 0;
      if (run === minRun) hx++;
    }
  }
  for (let x = sx; x <= ex; x += 2) {
    let run = 0;
    for (let y = sy; y <= ey; y++) {
      run = isDark(x, y) ? run + 1 : 0;
      if (run === minRun) vy++;
    }
  }
  const surface = hx > 0 && vy > 0 && Math.min(hx, vy) >= 0.3 * Math.max(hx, vy) ? 'tiles' : 'boards';
  const round = (v) => Math.round(v * 1000) / 1000;
  return { outline: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map((p) => p.map(round)), surface, against };
}

/**
 * Every deck of a level the AI saw (doc.decks with this level and a point), the largest first, each kept clear of those
 * found before it (hus4: the roof terrace and the two strips along the long sides met in the corners).
 * decks: [{ at, … }] → [{ deck, outline, surface, against }]
 */
export function findDecks(img, ppm, level, decks, { found } = {}) {
  const first = decks.map((d) => ({ d, r: findDeck(img, ppm, level, d.at, { found }) })).filter((x) => x.r);
  const area = (o) => (o[1][0] - o[0][0]) * (o[2][1] - o[1][1]);
  first.sort((a, b) => area(b.r.outline) - area(a.r.outline));
  const out = [];
  const taken = [];
  for (const { d } of first) {
    const r = findDeck(img, ppm, level, d.at, { found, taken });
    if (!r) continue;
    out.push({ deck: d, ...r });
    taken.push([r.outline[0][0], r.outline[0][1], r.outline[2][0], r.outline[2][1]]);
  }
  return out;
}
