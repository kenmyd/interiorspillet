/**
 * Planbygger: the AI's reading of the whole house (ai.js readHouse) into the document, in plan metres. The AI names
 * rooms by the marks drawn on the plans; the marks' own positions (marks.js, exact) become points in the level's
 * frame, so the export finds the rooms by position, whatever the later steps merged or split.
 *
 *   applyHouseReading(doc, ai, images, { sides }) → { wings, ceilings, cladding, decks } (counts, for the report)
 *     images: [{ kind: 'plan'|'facade', level (plans: the doc level), width, height (the marked image, px) }] in the
 *             order they were sent (the AI's image numbers are 1-based into it)
 *     sides:  the compass side of each image that is a facade (facadematch.js), by index into images, or null
 *   Sets:
 *     doc.roof: pitch, covering, color, chimney (when read), and wings: [{ level, points: [[x, y]], type,
 *               ridge: [dx, dy] | null (plan direction), fall: [dx, dy] | null (mono-pitch: from high to low) }]
 *     level.ceilingMarks: [{ kind: 'sloped'|'flat'|'open'|'height', degrees, text, points: [[x, y]],
 *               ridge: [[x, y], [x, y]] | null, from: 'ki' }]   (the Himling step adds { from: 'bruker' })
 *     doc.cladding: { main: { type, direction, color } | null, facades: [{ side, title, parts }] }
 *     doc.decks: [{ kind, level, at: [x, y] | null, railing, stairs }]
 *     doc.exterior: { terrain: { side: … }, basement: { side: … }, notes }
 *
 * Plan directions: x to the right, y down in the image (model.js), so «horizontal» is [1, 0] and a mono-pitch roof high
 * at the top falls towards [0, 1].
 */

const SIDE_DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Points along a line every 0.25 m, 0.15 m in from its ends (plan metres). */
function alongLine([a, b]) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out = [];
  for (let t = 0.15; t <= len - 0.15; t += 0.25) out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
  return out;
}

/**
 * Whether one room's ceiling follows the roof (notes/tak.md type 'roof'), the same for export.js and the Himling step:
 * the Himling step's choice in the room, else the ceiling texts with points in it (sloped / open against flat, the most
 * points), else flat when the level has ceiling texts (the drawing marked the sloped rooms), else the level's rule
 * (generate.js, the question). inside(q) → whether plan point q lies in the room.
 * → { slope, why: 'bruker' | 'tegning' | 'regel' | null, text }
 */
export function ceilingSlope(L, inside) {
  const marks = L?.ceilingMarks ?? [];
  const user = marks.filter((m) => m.from === 'bruker' && (m.points ?? []).some(inside)).pop();
  if (user) return { slope: user.kind !== 'flat', why: 'bruker', text: null };
  let up = 0;
  let flat = 0;
  let upText = null;
  let flatText = null;
  // the votes: a sloped text's room 1 each, a room its ridge line runs through 2 (the rooms open to it, hus2's hall);
  // a flat text's room 1, or 3 when it names one or two rooms (PLANTAK over a WC core inside the sloped room)
  for (const m of marks) {
    if (m.from === 'bruker' && !m.ridge) continue;
    const pts = m.points ?? [];
    const n = pts.filter(inside).length;
    if (m.kind === 'sloped' || m.kind === 'open') {
      const crossed = m.ridge && alongLine(m.ridge).some(inside);
      if (!n && !crossed) continue;
      up += n + (crossed ? 2 : 0);
      upText ??= m.text;
    } else if (m.kind === 'flat' && n) {
      flat += n * (pts.length <= 2 ? 3 : 1);
      flatText ??= m.text;
    }
  }
  if (up || flat) return { slope: up >= flat, why: 'tegning', text: up >= flat ? upText : flatText };
  if (marks.some((m) => m.from !== 'bruker' && m.kind !== 'height')) return { slope: false, why: 'tegning', text: null };
  if (L?.ceilingRule === 'roof') return { slope: true, why: 'regel', text: null };
  return { slope: false, why: null, text: null };
}

/**
 * The ridge line the AI read, along the dash-dot line actually drawn (classical): for a line along the image's x or y
 * the row (column) within ±2.5 % of the image with the most dashes inside the AI's segment, then followed both ways
 * while dashes go on – across thin lines and text, over gaps up to `maxGap` m, never into a thick wall (a dark run over
 * 0.25 m) or past the image. seg: [x0, y0, x1, y1] normalised; img RGBA; ppm the plan's px per metre.
 * → the segment, normalised (the AI's when no dashes are found or the line is slanted)
 */
export function refineRidge(img, seg, ppm, { maxGap = 0.9 } = {}) {
  if (!img?.data || !Array.isArray(seg) || !(ppm > 0)) return seg;
  const { width: W, height: H, data } = img;
  const horiz = Math.abs(seg[3] - seg[1]) * H < Math.abs(seg[2] - seg[0]) * W * 0.05;
  const vert = Math.abs(seg[2] - seg[0]) * W < Math.abs(seg[3] - seg[1]) * H * 0.05;
  if (!horiz && !vert) return seg;
  // along: the pixel index along the line; across: the row (column) of it
  const n = horiz ? W : H;
  const m = horiz ? H : W;
  const dark = (a, c) => {
    if (a < 0 || a >= n || c < 0 || c >= m) return false;
    const i = (horiz ? c * W + a : a * W + c) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 150;
  };
  const a0 = Math.round(Math.min(horiz ? seg[0] : seg[1], horiz ? seg[2] : seg[3]) * n);
  const a1 = Math.round(Math.max(horiz ? seg[0] : seg[1], horiz ? seg[2] : seg[3]) * n);
  const c0 = Math.round(((horiz ? seg[1] + seg[3] : seg[0] + seg[2]) / 2) * m);
  // the runs of dark pixels along one row: dashes are 2 … 0.4 m long
  const dashes = (c, lo, hi) => {
    let count = 0;
    let run = 0;
    for (let a = lo; a <= hi + 1; a++) {
      if (a <= hi && dark(a, c)) run++;
      else {
        if (run >= 2 && run <= 0.4 * ppm) count++;
        run = 0;
      }
    }
    return count;
  };
  const band = Math.max(3, Math.round(0.025 * m));
  let best = { c: c0, n: 0 };
  for (let c = c0 - band; c <= c0 + band; c++) {
    const k = dashes(c, a0, a1);
    if (k > best.n) best = { c, n: k };
  }
  if (best.n < 5) return seg;
  const c = best.c;
  const on = (a) => dark(a, c) || dark(a, c - 1) || dark(a, c + 1);
  const gapPx = maxGap * ppm;
  const wallPx = 0.25 * ppm;
  const follow = (start, step) => {
    let last = start; // the last dark pixel of a dash (or of a thin line the ridge crosses)
    let run = 0;
    let runStart = start;
    for (let a = start; a >= 0 && a < n; a += step) {
      if (on(a)) {
        if (!run) runStart = a;
        run++;
        if (run > wallPx) return runStart - step; // a thick wall: the line ends at its face
        last = a;
      } else {
        run = 0;
        if (Math.abs(a - last) > gapPx) break;
      }
    }
    return last;
  };
  const lo = follow(a0, -1);
  const hi = follow(a1, 1);
  if (hi - lo < (a1 - a0) * 0.9) return seg;
  return horiz ? [lo / W, c / H, hi / W, c / H] : [c / W, lo / H, c / W, hi / H];
}

/** A normalised point of image `im` in its level's plan metres. */
function toPlan(im, p) {
  const ppm = im.level?.image?.pxPerM;
  if (!(ppm > 0) || !Array.isArray(p)) return null;
  return [Math.round(((p[0] * im.width) / ppm) * 1000) / 1000, Math.round(((p[1] * im.height) / ppm) * 1000) / 1000];
}

export function applyHouseReading(doc, ai, images, { sides = [] } = {}) {
  const out = { wings: 0, ceilings: 0, cladding: 0, decks: 0 };
  if (!ai || !Array.isArray(images)) return out;
  const plan = (n) => (Number.isInteger(n) && images[n - 1]?.kind === 'plan' ? images[n - 1] : null);
  // the roof
  const r = ai.roof ?? {};
  doc.roof = { ...(doc.roof || {}) };
  if (r.pitch != null) doc.roof.pitch = r.pitch;
  if (r.covering) doc.roof.covering = r.covering;
  if (r.color) doc.roof.color = r.color;
  if (r.chimney) doc.roof.chimney = true;
  const wings = [];
  for (const w of r.wings ?? []) {
    const im = plan(w.image);
    if (!im) continue;
    const points = w.rooms.map((m) => toPlan(im, m.at)).filter(Boolean);
    if (!points.length) continue;
    const ridge = w.type === 'flat' ? null : w.ridge === 'horizontal' ? [1, 0] : w.ridge === 'vertical' ? [0, 1] : null;
    const fall = w.type === 'mono-pitch' && w.high ? SIDE_DIR[w.high].map((v) => -v || 0) : null;
    wings.push({ level: im.level.id, points, type: w.type, ridge, fall });
  }
  if (wings.length) {
    doc.roof.wings = wings;
    doc.roof.from = doc.roof.from ? `${doc.roof.from}+KI` : 'KI';
    out.wings = wings.length;
  }
  // the ceilings, per level
  for (const c of ai.ceilings ?? []) {
    const im = plan(c.image);
    if (!im) continue;
    const points = c.rooms.map((m) => toPlan(im, m.at)).filter(Boolean);
    const ridge = c.ridge ? [toPlan(im, [c.ridge[0], c.ridge[1]]), toPlan(im, [c.ridge[2], c.ridge[3]])] : null;
    if (!points.length && !ridge) continue;
    const L = im.level;
    (L.ceilingMarks ||= []).push({ kind: c.kind, degrees: c.degrees, text: c.text, points, ridge: ridge && ridge.every(Boolean) ? ridge : null, from: 'ki' });
    out.ceilings++;
  }
  // the cladding per facade, and the most common as the house's own
  const facades = [];
  const count = new Map();
  for (const f of ai.facades ?? []) {
    const k = Number.isInteger(f.image) ? f.image - 1 : -1;
    if (images[k]?.kind !== 'facade') continue;
    const parts = f.cladding.filter((c) => c.type);
    facades.push({ side: sides[k] ?? null, title: f.title, parts });
    for (const c of parts) {
      const key = `${c.type}|${c.direction ?? ''}|${c.color ?? ''}`;
      count.set(key, (count.get(key) ?? 0) + (c.part === 'all' ? 2 : 1));
    }
  }
  if (facades.length) {
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    const [type, direction, color] = top ? top[0].split('|') : [];
    doc.cladding = { main: top ? { type, direction: direction || null, color: color || null } : null, facades };
    out.cladding = facades.filter((f) => f.parts.length).length;
  }
  // terraces and balconies
  const decks = [];
  for (const d of ai.decks ?? []) {
    const im = plan(d.image);
    decks.push({ kind: d.kind, level: im?.level.id ?? null, at: im && d.at ? toPlan(im, d.at) : null, railing: d.railing, stairs: d.stairs });
  }
  if (decks.length) {
    doc.decks = decks;
    out.decks = decks.length;
  }
  // what the facades show of the ground
  const terrain = {};
  const basement = {};
  for (const f of ai.facades ?? []) {
    const side = sides[(f.image ?? 0) - 1];
    if (!side) continue;
    if (f.terrain) terrain[side] = f.terrain;
    if (f.basement) basement[side] = f.basement;
  }
  doc.exterior = { terrain, basement, notes: ai.notes ?? '' };
  return out;
}
