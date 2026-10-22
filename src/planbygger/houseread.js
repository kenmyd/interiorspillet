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
  for (const m of marks) {
    if (m.from === 'bruker') continue;
    const n = (m.points ?? []).filter(inside).length;
    if (!n) continue;
    if (m.kind === 'sloped' || m.kind === 'open') {
      up += n;
      upText ??= m.text;
    } else if (m.kind === 'flat') {
      flat += n;
      flatText ??= m.text;
    }
  }
  if (up || flat) return { slope: up >= flat, why: 'tegning', text: up >= flat ? upText : flatText };
  if (marks.some((m) => m.from !== 'bruker' && m.kind !== 'height')) return { slope: false, why: 'tegning', text: null };
  if (L?.ceilingRule === 'roof') return { slope: true, why: 'regel', text: null };
  return { slope: false, why: null, text: null };
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
