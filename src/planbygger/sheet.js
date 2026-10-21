/**
 * Planbygger: several drawings on one sheet – split a sheet into blocks (plans, facades, sections, text) with
 * classical image processing only (no OCR, no learning). Pure JS on typed arrays, like image.js, so it runs the same
 * in the browser (canvas ImageData) and in Node (tools/planbygger-png.mjs).
 *
 *   splitSheet(img) → { blocks: [{ bbox: [x0, y0, x1, y1], kind: 'plan'|'facade'|'section'|'text'|'other', score }] }
 *   cropImage(img, bbox, pad = 0) → img
 *
 * Bounding boxes are in pixels of the input image, x1/y1 exclusive, in reading order. A sheet with one drawing gives
 * one drawing block (plus perhaps a title such as «Etasje 1», a compass far away or a disclaimer as their own blocks).
 * score is 0–1: how clearly the features point to the kind.
 *
 * The method:
 *   1. Ink is everything clearly darker than the paper (the brightest real peak of the histogram). It is pooled to a
 *      working raster of about 1000 px (a cell is ink if any pixel in it is), so thin lines survive. Long thin
 *      straight lines of light ink (slightly darker than the paper) count as ink too: the light ground line and
 *      cladding of a rendered facade sit right at the ink threshold and come and go when the sheet is resampled.
 *   2. Leader lines are cut: a thick, dark, axis-parallel polyline with a filled dot at one end that bridges a note
 *      and a drawing, or two drawings (the municipality's notes on hus7). Without the cut, the plan and the section
 *      there are one block.
 *   3. The ink is dilated by 0.6 % of the long side; its components are the first blocks. Islands are then merged
 *      into the block around them: room labels and furniture inside a plan (rays in all four directions cross the
 *      plan), and small bits whose box lies inside a much larger block (a letter inside a garage open at the front).
 *   4. Each block is classified on features of its own ink at the working scale:
 *      - text: what is left after removing long thin lines is only word-high pieces;
 *      - plan: fat enclosed paper regions (rooms), or outer walls that reach the left or right side of the block on
 *        most rows;
 *      - facade: a ground line that sticks out past the building at both ends, a sloped roof outline at the top, or a
 *        wide drawing without walls at its sides. A ground line outweighs rooms: the enclosed regions of a facade
 *        drawn without cladding (wall faces, windows) look like rooms;
 *      - section: only with positive evidence, else a side view is a facade. It needs a pitched roof outline with an
 *        empty band under it (a gable facade has cladding there) and cut walls at both ends of the roof: bands of
 *        solid ink whose inside at full resolution is grey fill or hatching (hus7 SNITT). A section with a flat roof,
 *        or with walls drawn as single lines or solid black, becomes a facade.
 *      A sheet frame around other drawings is 'other'. Then the drawings are measured against each other: a
 *      symbol-sized drawing right beside one four times its size is 'other' (a compass beside a plan), and a block
 *      too small by the sheet's measure but half the size of the drawings found is a drawing (a strip of facades).
 *   5. Parts the dilation left on their own are merged into their drawing, so its crop keeps them: dimension chains
 *      beside it, level rulers (columns of numbers) and small symbols (a compass) next to it.
 *
 * Tested on the test set at its own size and resampled 0.5–2× (box filter down, bilinear up), and on synthetic gable
 * and flat facades with and without cladding, a section and plans. A flat box with windows and no ground line
 * sticking out is a plan (it is also what a one-room plan with furniture looks like); hus7 holds from 1500 px up.
 *
 * Speed: the full-resolution passes are thresholds, box counts and one erosion; everything else runs on the
 * working raster. 0.1–0.35 s for a 2000–2400 px sheet in Node, about 1 s for the 16 MP scan of hus7.
 */
import { luma, histogram, raster, erode, dilate, open, components, runLengths } from './image.js';

export const SHEET_DEFAULTS = {
  workSide: 1000, // the working raster's long side (px); the sheet is pooled down to about this
  paperDrop: 30, // ink = darker than the paper tone minus this
  gap: 0.006, // dilation radius as a fraction of the working long side: ink closer than 2× this is one block
};

/** The paper tone: the brightest grey level with a real peak in the histogram (≥ 5 % of the pixels around it). */
export function paperLevel(hist) {
  let n = 0;
  for (let i = 0; i < 256; i++) n += hist[i];
  const mass = (c, r) => {
    let s = 0;
    for (let i = Math.max(0, c - r); i <= Math.min(255, c + r); i++) s += hist[i];
    return s;
  };
  for (let c = 255; c >= 96; c--) {
    if (mass(c, 6) < 0.05 * n) continue;
    // the local maximum of the smoothed histogram at or below c
    let best = c;
    for (let i = c; i >= Math.max(96, c - 12); i--) if (mass(i, 2) > mass(best, 2)) best = i;
    return best;
  }
  return 255;
}

/** Sums of a 0/1 full-resolution mask over f × f cells. */
function poolCount(mask, w, h, f) {
  const W = Math.ceil(w / f);
  const H = Math.ceil(h / f);
  const out = raster(W, H, Uint16Array);
  for (let y = 0; y < h; y++) {
    const row = ((y / f) | 0) * W;
    const src = y * w;
    for (let x = 0; x < w; x++) if (mask[src + x]) out.data[row + ((x / f) | 0)]++;
  }
  return out;
}

/** Bounding box of each label over the 1-pixels of a mask, plus the ink count. */
function labelStats(labels, mask, n) {
  const st = Array.from({ length: n }, () => ({ minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, ink: 0 }));
  const { w } = mask;
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0 || !mask.data[i]) continue;
    const s = st[l];
    const x = i % w;
    const y = (i - x) / w;
    s.ink++;
    if (x < s.minX) s.minX = x;
    if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
  }
  return st;
}

/**
 * The working rasters of a sheet, one cell per f × f pixels: m (any ink in the cell), thick (dark ink that survives an
 * erosion at full resolution), faint (a quarter of the cell slightly darker than the paper) and light (any pixel of
 * the cell slightly darker than the paper). Also the full-resolution grey image and its thresholds (t ink, td dark).
 */
function workRasters(img, o) {
  const { width: w, height: h } = img;
  const grey = luma(img);
  const paper = paperLevel(histogram(grey));
  const t = Math.max(96, Math.min(232, paper - o.paperDrop));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = grey.data[i] < t ? 1 : 0;
  const f = Math.max(1, Math.ceil(Math.max(w, h) / o.workSide));
  const count = poolCount(ink, w, h, f);
  const m = raster(count.w, count.h);
  for (let i = 0; i < m.data.length; i++) m.data[i] = count.data[i] ? 1 : 0;
  // thick strokes: dark ink at least 2k + 1 px wide at full resolution, k growing with the sheet (a 2000 px sheet:
  // 3 px; below 1800 px every dark stroke, since a leader is then only 2–3 px). Dark, so that two thin lines blurred
  // into one grey band at a lower resolution do not count.
  const k = Math.max(w, h) >= 1800 ? Math.max(1, Math.round(Math.max(w, h) / 2000)) : 0;
  const td = Math.min(t, Math.round(paper / 2));
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) dark[i] = grey.data[i] < td ? 1 : 0;
  const tc = poolCount(erode({ w, h, data: dark }, k).data, w, h, f);
  const thick = raster(count.w, count.h);
  for (let i = 0; i < thick.data.length; i++) thick.data[i] = tc.data[i] ? 1 : 0;
  // faint ink (light cladding lines, shading): a quarter of the cell darker than the paper minus 12
  const tf = paper - 12;
  for (let i = 0; i < ink.length; i++) ink[i] = grey.data[i] < tf ? 1 : 0;
  const fc = poolCount(ink, w, h, f);
  const faint = raster(count.w, count.h);
  const q = Math.max(1, Math.ceil((f * f) / 4));
  for (let i = 0; i < faint.data.length; i++) faint.data[i] = fc.data[i] >= q ? 1 : 0;
  const light = raster(count.w, count.h);
  for (let i = 0; i < light.data.length; i++) light.data[i] = fc.data[i] ? 1 : 0;
  return { paper, t, td, f, m, thick, faint, light, k, grey };
}

/**
 * Long thin straight lines of light ink: axis-parallel runs of at least 3 % of the sheet, at most 3 cells across (a
 * light ground line or light cladding; a light fill is wide both ways and is left out).
 */
function lightLines(light, W) {
  const hr = runLengths(light, 'h');
  const vr = runLengths(light, 'v');
  const L = Math.max(8, Math.round(0.03 * W));
  const out = raster(light.w, light.h);
  for (let i = 0; i < out.data.length; i++) {
    if (!light.data[i]) continue;
    if ((hr.data[i] >= L && vr.data[i] <= 3) || (vr.data[i] >= L && hr.data[i] <= 3)) out.data[i] = 1;
  }
  return out;
}

/**
 * Leader candidates: the thick lines from a note to the drawing it explains (hus7: «Plan og snitt er påført …» runs
 * from inside the plan, through its wall and dimensions, into the section). A candidate is a polyline of long
 * axis-parallel thick strokes, at most 3 px across at the working scale, with a filled dot clearly fatter than the
 * stroke at one of its ends. Returns [{ box, px }] (px: working-raster indices of the line and its dot).
 */
function findLeaders(thick) {
  const { w, h } = thick;
  const W = Math.max(w, h);
  const hr = runLengths(thick, 'h');
  const vr = runLengths(thick, 'v');
  const seg = raster(w, h);
  const minSeg = Math.max(8, Math.round(0.02 * W));
  for (const axis of ['h', 'v']) {
    const along = axis === 'h' ? hr : vr;
    const across = axis === 'h' ? vr : hr;
    const n = axis === 'h' ? w : h;
    const lines = axis === 'h' ? h : w;
    const at = (l, i) => (axis === 'h' ? l * w + i : i * w + l);
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < n; ) {
        const len = along.data[at(l, i)];
        if (!len) {
          i++;
          continue;
        }
        if (len >= minSeg) {
          let thin = 0;
          for (let k = i; k < i + len; k++) if (across.data[at(l, k)] <= 3) thin++;
          if (thin >= 0.8 * len) for (let k = i; k < i + len; k++) seg.data[at(l, k)] = 1;
        }
        i += len;
      }
    }
  }
  // dots: small, compact, solid blobs (they survive an opening that removes the strokes)
  const blobs = components(open(thick, 1), 8);
  const maxDot = Math.max(3, Math.round(0.015 * W));
  const dots = blobs.comps.filter((c) => {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    return bw >= 3 && bh >= 3 && bw <= maxDot && bh <= maxDot && Math.max(bw, bh) <= 1.6 * Math.min(bw, bh) && c.area >= 0.55 * bw * bh;
  });
  const lines = components(seg, 8);
  const found = [];
  for (const c of lines.comps) {
    if (Math.max(c.maxX - c.minX, c.maxY - c.minY) + 1 < 0.04 * W) continue;
    const px = [];
    const across = [];
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const i = y * w + x;
        if (lines.labels[i] !== c.id) continue;
        px.push(i);
        across.push(Math.min(hr.data[i], vr.data[i]));
      }
    }
    across.sort((a, b) => a - b);
    const t = across[across.length >> 1];
    const dot = dots.find((d) => {
      if (Math.min(d.maxX - d.minX, d.maxY - d.minY) + 1 < 2 * t + 1) return false;
      const cx = (d.minX + d.maxX) / 2;
      const cy = (d.minY + d.maxY) / 2;
      if (cx < c.minX - 3 || cx > c.maxX + 3 || cy < c.minY - 3 || cy > c.maxY + 3) return false;
      // at an end of the polyline's box, and touching the polyline
      if (Math.min(Math.abs(cx - c.minX), Math.abs(cx - c.maxX), Math.abs(cy - c.minY), Math.abs(cy - c.maxY)) > 3) return false;
      for (let y = Math.max(0, d.minY - 2); y <= Math.min(h - 1, d.maxY + 2); y++) {
        for (let x = Math.max(0, d.minX - 2); x <= Math.min(w - 1, d.maxX + 2); x++) if (lines.labels[y * w + x] === c.id) return true;
      }
      return false;
    });
    if (!dot) continue;
    for (let y = dot.minY; y <= dot.maxY; y++) for (let x = dot.minX; x <= dot.maxX; x++) if (blobs.labels[y * w + x] === dot.id) px.push(y * w + x);
    found.push({ box: [Math.min(c.minX, dot.minX), Math.min(c.minY, dot.minY), Math.max(c.maxX, dot.maxX) + 1, Math.max(c.maxY, dot.maxY) + 1], px });
  }
  return found;
}

/**
 * Keeps the leader candidates that are bridges: with all candidates removed, a real leader touches two or more
 * substantial parts (a note and a drawing, or two drawings). A thick line inside a plan touches only its plan.
 */
function confirmLeaders(m, cands, r) {
  const { w, h } = m;
  const leaders = raster(w, h);
  if (!cands.length) return { leaders, kept: [] };
  const cmask = raster(w, h);
  for (const c of cands) for (const i of c.px) cmask.data[i] = 1;
  const cgrow = dilate(cmask, 1);
  const rest = raster(w, h);
  for (let i = 0; i < m.data.length; i++) rest.data[i] = m.data[i] && !cgrow.data[i] ? 1 : 0;
  const L0 = components(dilate(rest, r), 4);
  const st = labelStats(L0.labels, rest, L0.comps.length);
  const diag = Math.hypot(w, h);
  const substantial = st.map((s) => s.ink > 0 && Math.hypot(s.maxX - s.minX + 1, s.maxY - s.minY + 1) >= 0.05 * diag);
  const reach = r + 2;
  const kept = [];
  for (const c of cands) {
    const touched = new Set();
    for (const i of c.px) {
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const l = L0.labels[yy * w + xx];
        if (l >= 0 && substantial[l]) touched.add(l);
      }
    }
    c.touched = touched.size;
    if (touched.size < 2) continue;
    kept.push(c);
    for (const i of c.px) leaders.data[i] = 1;
  }
  return { leaders, kept };
}

/** Union–find over label ids. */
function unionFind(n) {
  const p = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => {
    while (p[a] !== a) a = p[a] = p[p[a]];
    return a;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) p[a] = b;
    return b;
  };
  return { find, union };
}

const gdiag = (e) => Math.hypot(e.maxX - e.minX + 1, e.maxY - e.minY + 1);

/**
 * Whether a solid run of ink cells (working row y, cells xa–xb) is a cut band, looked at in the middle pixel row at
 * full resolution: between its outer ink edges it is mostly lighter than dark ink, with grey fill (a third) or three
 * or more dark strokes (hatching). One thick stroke is dark throughout; two lines with paper between (a corner board)
 * have neither fill nor hatching.
 */
function cutBand(R, y, xa, xb) {
  const { grey, f, t, td } = R;
  const gw = grey.w;
  const row = Math.min(grey.h - 1, y * f + (f >> 1)) * gw;
  let pa = -1;
  let pb = -1;
  for (let x = xa * f; x < Math.min(gw, (xb + 1) * f); x++) {
    if (grey.data[row + x] >= t) continue;
    if (pa < 0) pa = x;
    pb = x;
  }
  if (pb - pa < 3) return false;
  let light = 0;
  let mid = 0;
  let strokes = 0;
  let inDark = false;
  for (let x = pa + 1; x < pb; x++) {
    const g = grey.data[row + x];
    const dark = g < td;
    if (!dark) light++;
    if (!dark && g < t) mid++;
    if (dark && !inDark) strokes++;
    inDark = dark;
  }
  const n = pb - pa - 1;
  return light >= 0.5 * n && (mid >= 0.3 * n || strokes >= 3);
}

/**
 * The blocks: components of the dilated ink, with islands merged into the block that encloses them. Specks (grid
 * crossings, scan dust: under 8 ink cells and 1 % of the sheet) are left out.
 * @returns {{ list: { id, ids: number[], ink, minX, minY, maxX, maxY }[], uf }}  working-raster boxes, max inclusive
 */
function groupBlocks(labels, st, w, h) {
  const uf = unionFind(st.length);
  const W = Math.max(w, h);
  const live = st.map((s, id) => id).filter((id) => st[id].ink >= 8 || (st[id].ink > 0 && gdiag(st[id]) > 0.01 * W));
  const diag = Math.hypot(w, h);
  const groups = () => {
    const g = new Map();
    for (const id of live) {
      const root = uf.find(id);
      const s = st[id];
      let e = g.get(root);
      if (!e) g.set(root, (e = { id: root, ids: [], minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, ink: 0 }));
      e.ids.push(id);
      e.ink += s.ink;
      e.minX = Math.min(e.minX, s.minX);
      e.minY = Math.min(e.minY, s.minY);
      e.maxX = Math.max(e.maxX, s.maxX);
      e.maxY = Math.max(e.maxY, s.maxY);
    }
    return g;
  };
  // 1. islands enclosed by a bigger block (room labels and furniture inside a plan): rays in all four directions
  //    cross it (the whole ray counts, so furniture between a label and the wall does not hide the wall)
  for (let pass = 0; pass < 3; pass++) {
    const g = groups();
    let changed = false;
    for (const e of [...g.values()].sort((a, b) => a.ink - b.ink)) {
      const me = uf.find(e.id);
      const perDir = [];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const hits = new Set();
        for (const q of [0.25, 0.5, 0.75]) {
          let x = dx ? (dx < 0 ? e.minX : e.maxX) : Math.round(e.minX + q * (e.maxX - e.minX));
          let y = dy ? (dy < 0 ? e.minY : e.maxY) : Math.round(e.minY + q * (e.maxY - e.minY));
          for (;;) {
            x += dx;
            y += dy;
            if (x < 0 || y < 0 || x >= w || y >= h) break;
            const l = labels[y * w + x];
            if (l < 0 || st[l].ink === 0) continue;
            const root = uf.find(l);
            if (root !== me) hits.add(root);
          }
        }
        perDir.push(hits);
      }
      const host = [...perDir[0]]
        .filter((id) => perDir.every((s) => s.has(id)))
        .map((id) => g.get(id))
        .filter((b) => b && b.ink > e.ink)
        .sort((a, b) => b.ink - a.ink)[0];
      if (!host) continue;
      uf.union(me, host.id);
      changed = true;
    }
    if (!changed) break;
  }
  // 2. small bits whose box lies inside a much bigger block's box (a letter in a garage with an open front)
  const list = [...groups().values()].sort((a, b) => a.ink - b.ink);
  for (const e of list) {
    if (gdiag(e) > 0.035 * diag) continue;
    const host = list
      .filter((b) => b !== e && b.minX <= e.minX + 1 && b.minY <= e.minY + 1 && b.maxX >= e.maxX - 1 && b.maxY >= e.maxY - 1 && gdiag(b) >= 3 * gdiag(e))
      .sort((a, b) => gdiag(a) - gdiag(b))[0];
    if (host) uf.union(e.id, host.id);
  }
  return { list: [...groups().values()], uf };
}

/**
 * Features of one block, from its own ink at the working scale (W: the working raster's long side).
 *   w, h, ink, aspect, inkFrac   box size, ink pixels, w / h, ink per box area
 *   roomFrac, maxHole            fat enclosed paper regions (rooms) and the largest enclosed region, per box area
 *   overL, overR                 share of the width at each end that is only a line low down (a ground line)
 *   overDy                       height difference of those two lines, per box height (1 without both)
 *   topSlope                     share of the columns where the top outline climbs or falls steadily (a roof)
 *   underRoof                    faint-ink share in a band under the sloped top outline (cladding or an empty attic)
 *   cutWalls                     ends of the sloped roof (0–2) with a cut wall under them (see cutBand)
 *   occL, occR                   share of the rows whose outermost ink lies at the left (right) side of the box
 *   lineH, lineV                 columns (rows) crossed by a thin horizontal (vertical) line of 5 % of the sheet or more
 *   textLike                     without the long thin lines, only word-high pieces are left
 * cut: the ink the leader cut took away (a leader may run along a wall); only the cut-wall test sees it.
 */
function blockFeatures(ink, R, labels, b, uf, W, cut) {
  const { faint } = R;
  const { minX: x0, minY: y0 } = b;
  const bw = b.maxX - b.minX + 1;
  const bh = b.maxY - b.minY + 1;
  const B = raster(bw, bh);
  const root = uf.find(b.id);
  let n = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * ink.w + x0 + x;
      if (!ink.data[i] || labels[i] < 0 || uf.find(labels[i]) !== root) continue;
      B.data[y * bw + x] = 1;
      n++;
    }
  }
  const f = { w: bw, h: bh, ink: n, aspect: +(bw / bh).toFixed(2), inkFrac: +(n / (bw * bh)).toFixed(3) };
  // enclosed paper regions (after closing 1-px gaps)
  const C = dilate(B, 1);
  const bg = raster(bw, bh);
  for (let i = 0; i < bg.data.length; i++) bg.data[i] = C.data[i] ? 0 : 1;
  let roomArea = 0;
  let maxHole = 0;
  for (const c of components(bg, 4).comps) {
    if (!(c.minX > 0 && c.minY > 0 && c.maxX < bw - 1 && c.maxY < bh - 1)) continue;
    const hw = c.maxX - c.minX + 1;
    const hh = c.maxY - c.minY + 1;
    maxHole = Math.max(maxHole, c.area);
    if (c.area >= 0.01 * bw * bh && Math.min(hw, hh) >= 0.05 * Math.min(bw, bh) && c.area >= 0.4 * hw * hh) roomArea += c.area;
  }
  f.roomFrac = +(roomArea / (bw * bh)).toFixed(3);
  f.maxHole = +(maxHole / (bw * bh)).toFixed(3);
  // column profiles
  const low = new Int32Array(bw).fill(-1);
  const top = new Int32Array(bw).fill(-1);
  const colInk = new Int32Array(bw);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!B.data[y * bw + x]) continue;
      if (top[x] < 0) top[x] = y;
      low[x] = y;
      colInk[x]++;
    }
  }
  // the ends: columns whose only ink is a line (or a band of two) low down – a ground line sticking out past the walls
  const thinCol = (x) => low[x] >= 0 && colInk[x] <= Math.max(4, 0.04 * bh) && top[x] >= 0.6 * bh;
  let l = 0;
  while (l < bw && thinCol(l)) l++;
  let r = 0;
  while (r < bw && thinCol(bw - 1 - r)) r++;
  f.overL = +(l / bw).toFixed(3);
  f.overR = +(r / bw).toFixed(3);
  // one ground line is straight across: the lines at the two ends lie at the same height
  const lowAt = (xa, xb) => {
    const ys = [];
    for (let x = xa; x < xb; x++) if (low[x] >= 0) ys.push(low[x]);
    ys.sort((a, c) => a - c);
    return ys[ys.length >> 1];
  };
  f.overDy = l && r ? +(Math.abs(lowAt(0, l) - lowAt(bw - r, bw)) / bh).toFixed(3) : 1;
  // sloped top outline: the top profile climbs or falls steadily (slope 0.15–3) over ±2 % of the width
  let sloped = 0;
  const slopedCols = [];
  let under = 0;
  let underN = 0;
  const s = Math.max(3, Math.round(0.02 * bw));
  const band = Math.max(4, Math.round(0.2 * bh));
  for (let x = s; x < bw - s; x++) {
    if (top[x - s] < 0 || top[x] < 0 || top[x + s] < 0) continue;
    const d1 = top[x] - top[x - s];
    const d2 = top[x + s] - top[x];
    const ok = (d) => Math.abs(d / s) >= 0.15 && Math.abs(d / s) <= 3;
    if (!(Math.sign(d1) === Math.sign(d2) && ok(d1) && ok(d2) && Math.abs(d1 - d2) <= Math.max(2, 0.5 * Math.abs(d1)))) continue;
    sloped++;
    slopedCols.push(x);
    // below the sloped roof edge: the lower part of a band under it (cladding in a gable, empty in a cut attic)
    for (let y = top[x] + Math.round(0.5 * band); y < Math.min(bh, top[x] + band); y++) {
      underN++;
      if (faint.data[(y0 + y) * ink.w + x0 + x]) under++;
    }
  }
  f.topSlope = +(sloped / bw).toFixed(3);
  f.underRoof = +(under / Math.max(1, underN)).toFixed(3);
  // thin lines (at most 2 px across): how many columns (rows) one of 5 % of the sheet or more passes through, and a
  // mask of the long ones (8 %) for the text test
  const vr = runLengths(B, 'v');
  const hr = runLengths(B, 'h');
  const longLine = 0.08 * W;
  const midLine = 0.05 * W;
  const thinLine = raster(bw, bh);
  const rowHas = new Uint8Array(bh);
  let lineH = 0;
  for (let x = 0; x < bw; x++) {
    let hasH = false;
    for (let y = 0; y < bh; y++) {
      const i = y * bw + x;
      if (!B.data[i]) continue;
      const thinV = hr.data[i] <= 2;
      const thinH = vr.data[i] <= 2;
      if (thinV && vr.data[i] >= midLine) rowHas[y] = 1;
      if (thinH && hr.data[i] >= midLine) hasH = true;
      if ((thinH && hr.data[i] >= longLine) || (thinV && vr.data[i] >= longLine)) thinLine.data[i] = 1;
    }
    if (hasH) lineH++;
  }
  f.lineH = lineH;
  f.lineV = rowHas.reduce((a, v) => a + v, 0);
  // cut walls (a section): near each end of the sloped roof, a column crossed by solid ink bands (3 cells to 8 % of
  // the width across) on a fifth of the rows, most of them cut bands at full resolution
  f.cutWalls = 0;
  if (slopedCols.length >= 2) {
    const BW = raster(bw, bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) BW.data[y * bw + x] = B.data[y * bw + x] || cut.data[(y0 + y) * ink.w + x0 + x] ? 1 : 0;
    const hw = runLengths(BW, 'h');
    const rx0 = slopedCols[0];
    const rx1 = slopedCols[slopedCols.length - 1];
    const span = rx1 - rx0;
    const bandMax = Math.max(3, Math.round(0.08 * bw));
    for (const [xa, xb] of [[rx0 - 2, rx0 + 0.35 * span], [rx1 - 0.35 * span, rx1 + 2]]) {
      let wall = false;
      for (let x = Math.max(0, Math.round(xa)); x <= Math.min(bw - 1, Math.round(xb)) && !wall; x++) {
        const rows = [];
        for (let y = 0; y < bh; y++) if (BW.data[y * bw + x] && hw.data[y * bw + x] >= 3 && hw.data[y * bw + x] <= bandMax) rows.push(y);
        if (rows.length < 0.2 * bh) continue;
        const nS = Math.min(7, rows.length);
        let pass = 0;
        for (let k = 0; k < nS; k++) {
          const y = rows[Math.floor(((k + 0.5) * rows.length) / nS)];
          let s0 = x;
          while (s0 > 0 && BW.data[y * bw + s0 - 1]) s0--;
          if (cutBand(R, y0 + y, x0 + s0, x0 + s0 + hw.data[y * bw + x] - 1)) pass++;
        }
        wall = pass >= 0.6 * nS;
      }
      if (wall) f.cutWalls++;
    }
  }
  // side occupancy: outer walls reach the sides of a plan's box on most rows; a facade touches its sides only with
  // the ground line (where a line sticks out at an end, only ink out on that line counts)
  const dx = Math.max(2, Math.round(0.04 * bw));
  const dxL = l > 0 ? Math.min(dx, l) : dx;
  const dxR = r > 0 ? Math.min(dx, r) : dx;
  let oL = 0;
  let oR = 0;
  for (let y = 0; y < bh; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < bw; x++) {
      if (!B.data[y * bw + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first >= 0 && first < dxL) oL++;
    if (last >= 0 && last >= bw - dxR) oR++;
  }
  f.occL = +(oL / bh).toFixed(2);
  f.occR = +(oR / bh).toFixed(2);
  // text: without the long thin lines (table rules, dimension lines), only word-high pieces are left
  const rest = raster(bw, bh);
  let restInk = 0;
  for (let i = 0; i < rest.data.length; i++) if (B.data[i] && !thinLine.data[i]) (rest.data[i] = 1), restInk++;
  let wordInk = 0;
  for (const c of components(rest, 8).comps) {
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;
    if (Math.min(cw, ch) <= 0.03 * W && Math.max(cw, ch) <= 0.3 * W) wordInk += c.area;
  }
  f.textLike = restInk > 0 && wordInk >= 0.85 * restInk;
  return f;
}

/** Big enough for a drawing by the sheet's measure: a tenth of it across, a twentieth across and long, or a long line. */
export function bigEnough(f, W) {
  const minSide = Math.min(f.w, f.h);
  return minSide >= 0.1 * W || (minSide >= 0.05 * W && Math.max(f.w, f.h) >= 0.15 * W) || Math.max(f.lineH, f.lineV) >= 0.15 * W;
}

/** The kind of a block from its features: { kind, score }. big: whether it is big enough for a drawing. */
export function classifyBlock(f, W, big = bigEnough(f, W)) {
  const minSide = Math.min(f.w, f.h);
  // thin lines across most of the block in both directions and a squarish box: a drawing drawn with thin lines
  // (hus7's plan: contour walls, dimensions and its labels), not a note or a table with rules
  const framed = f.lineH >= 0.6 * f.w && f.lineV >= 0.6 * f.h && f.aspect >= 0.4 && f.aspect <= 2.5;
  if (!big || (f.textLike && !framed)) {
    const text = f.textLike && minSide >= 3 && (f.aspect >= 1.5 || f.aspect <= 1 / 1.5);
    if (text) return { kind: 'text', score: f.aspect >= 2.5 || f.aspect <= 0.4 ? 0.8 : 0.6 };
    return { kind: 'other', score: 0.5 };
  }
  const occSide = Math.max(f.occL, f.occR);
  // a ground line: one straight line low down that sticks out past the drawing at both ends. The enclosed regions of
  // such a drawing are wall faces and windows, not rooms (a facade without cladding), and count as weak evidence only.
  const ground = f.overL >= 0.025 && f.overR >= 0.025 && f.overDy <= 0.03;
  // rooms count less in a wide drawing: a facade's roof plane or ground band is a big enclosed region too
  const wide = f.aspect >= 1.8;
  const rooms = Math.max(f.roomFrac / (wide ? 0.3 : 0.18), f.maxHole / (wide ? 0.3 : 0.17));
  const p = Math.max(ground ? Math.min(1, rooms) : rooms, occSide / 0.5);
  const s = Math.max(ground ? 1.5 : 0, f.topSlope / 0.15, wide && occSide < 0.5 ? 1.2 : 0);
  const score = (a, b) => +Math.min(0.95, Math.max(0.3, 0.5 + 0.2 * (a - b))).toFixed(2);
  const plan = (p >= 1 && p >= s) || (s < 1 && p > s);
  if (plan) return { kind: 'plan', score: score(p, s) };
  // a side view, a facade unless there is positive evidence of a section: a pitched roof cut through, with the attic
  // under it empty (a gable facade has cladding there, faint lines count) and cut walls at both ends
  const section = f.topSlope >= 0.3 && f.underRoof <= 0.25 && f.cutWalls >= 2;
  return { kind: section ? 'section' : 'facade', score: section ? +(0.8 * score(s, p)).toFixed(2) : score(s, p) };
}

const DRAWINGS = new Set(['plan', 'facade', 'section']);

/** Gap between two boxes (0 when they overlap) along x and y. */
const gaps = (a, b) => [Math.max(0, a.minX - b.maxX - 1, b.minX - a.maxX - 1), Math.max(0, a.minY - b.maxY - 1, b.minY - a.maxY - 1)];

/** Chebyshev distance from box s to the nearest ink of block d, if it is within g (else Infinity). */
function inkGap(s, d, g, ctx) {
  const { labels, ink, uf, w, h } = ctx;
  const root = uf.find(d.id);
  let best = Infinity;
  for (let y = Math.max(0, s.minY - g); y <= Math.min(h - 1, s.maxY + g); y++) {
    const dy = y < s.minY ? s.minY - y : y > s.maxY ? y - s.maxY : 0;
    for (let x = Math.max(0, s.minX - g); x <= Math.min(w - 1, s.maxX + g); x++) {
      const i = y * w + x;
      if (!ink.data[i] || labels[i] < 0 || uf.find(labels[i]) !== root) continue;
      const dx = x < s.minX ? s.minX - x : x > s.maxX ? x - s.maxX : 0;
      best = Math.min(best, Math.max(dx, dy));
    }
  }
  return best;
}

/**
 * Parts of a drawing that the dilation left on their own are merged into it (in place), so its crop keeps them:
 *   - dimension chains: long and thin, with a thin line along most of their length, beside the drawing over half
 *     their length, closer than 12 % of the sheet and 30 % of the drawing;
 *   - level rulers and other narrow columns of numbers (twice as tall as wide, at most 6 % of the sheet wide) with
 *     the drawing's ink within 3 % of the sheet;
 *   - small symbols ('other', at most 12 % of the sheet, such as a compass) inside its box or within 2 % of the
 *     sheet of its ink.
 */
function attachSatellites(blocks, ctx) {
  const { W, r, uf } = ctx;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const drawings = blocks.filter((b) => DRAWINGS.has(b.kind));
    for (const s of blocks) {
      if (DRAWINGS.has(s.kind) || s.merged) continue;
      const f = s.f;
      const vertical = f.h >= 4 * f.w && f.lineV >= 0.5 * f.h;
      const horizontal = f.w >= 4 * f.h && f.lineH >= 0.5 * f.w;
      const column = f.h >= 2 * f.w && f.w <= 0.06 * W;
      const small = s.kind === 'other' && Math.max(f.w, f.h) <= 0.12 * W;
      let best = null;
      let bestGap = Infinity;
      for (const d of drawings) {
        const [gx, gy] = gaps(s, d);
        let ok = false;
        let g = Math.hypot(gx, gy);
        if (vertical && gy === 0) {
          const over = Math.min(s.maxY, d.maxY) - Math.max(s.minY, d.minY) + 1;
          ok = over >= 0.5 * f.h && gx <= Math.min(0.12 * W, 0.3 * (d.maxX - d.minX + 1));
        } else if (horizontal && gx === 0) {
          const over = Math.min(s.maxX, d.maxX) - Math.max(s.minX, d.minX) + 1;
          ok = over >= 0.5 * f.w && gy <= Math.min(0.12 * W, 0.3 * (d.maxY - d.minY + 1));
        }
        if (!ok && (column || small) && g <= 0.03 * W) {
          const near = inkGap(s, d, Math.ceil(0.03 * W), ctx);
          if (column && near <= 0.03 * W) ok = true;
          if (small && (g === 0 || near <= Math.max(2.5 * r, 0.02 * W))) ok = true;
          if (ok) g = near;
        }
        if (ok && g < bestGap) {
          best = d;
          bestGap = g;
        }
      }
      if (!best) continue;
      best.minX = Math.min(best.minX, s.minX);
      best.minY = Math.min(best.minY, s.minY);
      best.maxX = Math.max(best.maxX, s.maxX);
      best.maxY = Math.max(best.maxY, s.maxY);
      best.ink += s.ink;
      uf.union(s.id, best.id);
      s.merged = true;
      changed = true;
    }
    if (!changed) break;
  }
  return blocks.filter((b) => !b.merged);
}

/**
 * The drawings measured against each other on the sheet (in place):
 *   - a symbol-sized drawing (at most 12 % of the sheet and a quarter of the largest drawing) within 3 % of the sheet
 *     of a drawing four times its size is a symbol beside it (a compass beside a plan): 'other', so it is attached;
 *   - a block too small by the sheet's measure (bigEnough), but a 25th of the sheet across and at least 30 % of the
 *     area of the smallest drawing, is classified as a drawing (one facade in a long strip of them, a faint one).
 */
function relativeSizes(blocks, ctx) {
  const { W } = ctx;
  const long = (b) => Math.max(b.f.w, b.f.h);
  let drawings = blocks.filter((b) => DRAWINGS.has(b.kind));
  if (!drawings.length) return;
  const Lmax = Math.max(...drawings.map(long));
  const g = Math.ceil(0.03 * W);
  const symbol = (b) =>
    long(b) <= 0.12 * W &&
    long(b) <= 0.25 * Lmax &&
    drawings.some((d) => d !== b && long(d) >= 4 * long(b) && Math.max(...gaps(b, d)) <= g && inkGap(b, d, g, ctx) <= g);
  for (const b of drawings) if (symbol(b)) Object.assign(b, { kind: 'other', score: 0.5 });
  drawings = blocks.filter((b) => DRAWINGS.has(b.kind));
  if (!drawings.length) return;
  const minArea = Math.min(...drawings.map((b) => b.f.w * b.f.h));
  for (const b of blocks) {
    if (DRAWINGS.has(b.kind) || bigEnough(b.f, W) || Math.min(b.f.w, b.f.h) < 0.04 * W || b.f.w * b.f.h < 0.3 * minArea) continue;
    const c = classifyBlock(b.f, W, true);
    if (DRAWINGS.has(c.kind) && !symbol(b)) Object.assign(b, c);
  }
}

/** Reading order: rows of blocks (by vertical overlap of their centres), left to right in each row. */
function readingOrder(blocks) {
  const rows = [];
  for (const b of [...blocks].sort((a, c) => a.minY + a.maxY - c.minY - c.maxY)) {
    const cy = (b.minY + b.maxY) / 2;
    const row = rows.find((rw) => cy >= rw.minY && cy <= rw.maxY);
    if (row) row.items.push(b);
    else rows.push({ minY: b.minY, maxY: b.maxY, items: [b] });
  }
  return rows.flatMap((rw) => rw.items.sort((a, c) => a.minX - c.minX));
}

/**
 * The whole analysis; splitSheet returns its blocks. With { debug: true } the result also carries the working
 * rasters and the features of each block.
 */
export function analyzeSheet(img, opts = {}) {
  const o = { ...SHEET_DEFAULTS, ...opts };
  const R = workRasters(img, o);
  const { f } = R;
  const { w, h } = R.m;
  const W = Math.max(w, h);
  // the ink, with the long thin lines of light ink
  const ll = lightLines(R.light, W);
  const m = raster(w, h);
  for (let i = 0; i < m.data.length; i++) m.data[i] = R.m.data[i] || ll.data[i] ? 1 : 0;
  const r = Math.max(2, Math.round(o.gap * W));
  const cands = findLeaders(R.thick);
  const L = confirmLeaders(m, cands, r);
  const lgrow = dilate(L.leaders, 1);
  const ink = raster(w, h);
  const cut = raster(w, h); // the ink the leader cut takes away
  for (let i = 0; i < ink.data.length; i++) {
    ink.data[i] = m.data[i] && !lgrow.data[i] ? 1 : 0;
    cut.data[i] = m.data[i] && lgrow.data[i] ? 1 : 0;
  }
  const { labels, comps } = components(dilate(ink, r), 4);
  const st = labelStats(labels, ink, comps.length);
  const { list: blocks, uf } = groupBlocks(labels, st, w, h);
  for (const b of blocks) {
    b.f = blockFeatures(ink, R, labels, b, uf, W, cut);
    Object.assign(b, classifyBlock(b.f, W));
  }
  // a sheet frame (border, often with the title block hanging on it) around other drawings is not a drawing
  for (const b of blocks) {
    if (!DRAWINGS.has(b.kind) || b.f.w < 0.85 * w || b.f.h < 0.85 * h || b.f.inkFrac > 0.06) continue;
    const inside = blocks.some((c) => c !== b && DRAWINGS.has(c.kind) && c.minX >= b.minX && c.maxX <= b.maxX && c.minY >= b.minY && c.maxY <= b.maxY && gdiag(c) >= 0.2 * Math.hypot(w, h));
    if (inside) Object.assign(b, { kind: 'other', score: 0.6 });
  }
  const ctx = { W, r, labels, ink, uf, w, h };
  relativeSizes(blocks, ctx);
  const final = readingOrder(attachSatellites(blocks, ctx));
  return { R, m, r, f, w, h, W, cands, leaders: L, labels, blocks: final };
}

export function splitSheet(img, opts = {}) {
  const A = analyzeSheet(img, opts);
  const { f } = A;
  const blocks = A.blocks.map((b) => ({
    bbox: [b.minX * f, b.minY * f, Math.min(img.width, (b.maxX + 1) * f), Math.min(img.height, (b.maxY + 1) * f)],
    kind: b.kind,
    score: b.score,
    ...(opts.debug ? { f: b.f } : {}),
  }));
  return opts.debug ? { blocks, debug: A } : { blocks };
}

/** A copy of the region bbox (grown by pad px, clamped to the image) as a new image. */
export function cropImage(img, bbox, pad = 0) {
  const x0 = Math.max(0, Math.floor(bbox[0] - pad));
  const y0 = Math.max(0, Math.floor(bbox[1] - pad));
  const x1 = Math.min(img.width, Math.ceil(bbox[2] + pad));
  const y1 = Math.min(img.height, Math.ceil(bbox[3] + pad));
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const s = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(s, s + width * 4), y * width * 4);
  }
  return { width, height, data };
}
