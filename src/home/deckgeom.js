/**
 * DECKS – terraces, balconies, porches and roof terraces of the house format (notes/kledning.md), without three.js:
 * layout.js (layout.house.decks, floorYAt, walkRects), the builder (home/decks.js) and the validator
 * (data/scripts/house.mjs) all read the same model.
 *
 *   resolveDecks(raw, ctx) → { decks, issues }   the house's `decks[]` with every default filled in, each with
 *     edges      per outline edge (outline[i] → outline[i + 1]): `house` / `free` intervals [s0, s1] along it (against
 *                an exterior wall of the house or not) and the fall outside every free interval
 *     railings   the straight runs that get a railing: free, not where a stair is, fall > FALL_LIMIT (or the edges
 *                listed in railing.edges)
 *     stairs     straight stairs out from an edge down to the ground: risers, going, the walking ramp
 *     posts      plan points of the posts under the free edges (supports 'posts')
 *     surfaceY(x, z)  world y of the walking surface: the deck's top, or the ramp over a stair; null elsewhere
 *
 * Plan points are [x, z] (metres, the house's coordinates). Heights: `y` in the data is local (over the floor of
 * `levelId`, or over the ground without one); everything resolved here (top, bottom, groundY, …) is world y.
 * ctx: { levels: [{ id, floorY }], walls: [{ id, levelId, exterior, start, end, normal, thickness, floorY, height }]
 *        (start / end on the room face, normal into the room, floorY world), rooms: [{ id, levelId, floorY, polygon }],
 *        groundY }
 */

export const DECK_KINDS = Object.freeze(['terrace', 'balcony', 'porch', 'roof-terrace']);
export const DECK_SURFACES = Object.freeze(['boards', 'tiles', 'concrete']);
export const DECK_SUPPORTS = Object.freeze(['posts', 'solid', 'none']);
export const RAILING_TYPES = Object.freeze(['glass', 'wood-slats', 'wood-vertical', 'steel-bars', 'none']);
/** A free edge with more fall than this gets a railing (TEK17 § 12-17: fall over 0,5 m). */
export const FALL_LIMIT = 0.5;

/** Defaults of the format (notes/kledning.md). */
export const DECK_DEFAULTS = Object.freeze({
  surface: Object.freeze({ terrace: 'boards', balcony: 'boards', porch: 'boards', 'roof-terrace': 'tiles' }),
  color: Object.freeze({ boards: '#8b7d6b', tiles: '#9a9690', concrete: '#a7a49e' }),
  thickness: Object.freeze({ terrace: 0.2, balcony: 0.18, porch: 0.2, 'roof-terrace': 0.12 }),
  supports: Object.freeze({ terrace: 'posts', balcony: 'none', porch: 'solid', 'roof-terrace': 'none' }),
  railing: Object.freeze({
    type: Object.freeze({ terrace: 'wood-vertical', balcony: 'glass', porch: 'wood-vertical', 'roof-terrace': 'glass' }),
    height: 1.0,
    color: Object.freeze({ glass: '#1d1e21', 'steel-bars': '#1d1e21' }),
  }),
  y: 0,
  stair: Object.freeze({ width: 1.0, maxRise: 0.18, going: 0.62, minGoing: 0.26, maxGoing: 0.32 }),
  /** posts: at most this far apart along a free edge, and this far in from the edge */
  postSpacing: 2.0,
  postInset: 0.08,
  postSize: 0.12,
});

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const KNOWN = {
  deck: ['id', 'name', 'kind', 'levelId', 'outline', 'y', 'surface', 'color', 'supports', 'railing', 'stairs', 'thickness', 'groundY', 'source', 'estimated'],
  railing: ['type', 'height', 'edges', 'color'],
  stair: ['edge', 'at', 'width'],
};
const STEP = 0.05; // sampling step along an edge
const SLIVER = 0.08; // shorter house / free pieces than this go to the neighbour

/** Even-odd point in polygon ([x, z] points); points on an edge count as inside. */
export function inPolygon(x, z, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (segDist([x, z], P[i], P[j]) < 1e-6) return true;
    const a = P[i], b = P[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Distance from p to the segment a–b. */
export function segDist(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return len(sub(add(a, d, t), p));
}
function signedArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function isSimple(P) {
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === P.length - 1)) continue;
      if (segmentsCross(P[i], P[(i + 1) % P.length], P[j], P[(j + 1) % P.length])) return false;
    }
  }
  return true;
}
/** Intervals [s0, s1] of [0, L] minus the cut intervals. */
function minus(intervals, cuts) {
  let out = intervals.map((r) => [...r]);
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) next.push([a, b]);
      else {
        if (c0 > a) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
    }
    out = next;
  }
  return out;
}

/**
 * The house's `decks[]` with every default filled in (see the top of this file).
 * @param {Array|undefined} raw  spec.decks
 * @param {object} ctx
 * @returns {{ decks: object[], issues: Array<{level: 'error'|'warn', where: string, msg: string}> }}
 */
export function resolveDecks(raw, { levels = [], walls = [], rooms = [], groundY = -0.15 } = {}) {
  const issues = [];
  const decks = [];
  if (raw == null) return { decks, issues };
  if (!Array.isArray(raw)) {
    issues.push({ level: 'error', where: 'decks', msg: 'må være en liste' });
    return { decks, issues };
  }
  const levelsById = new Map(levels.map((l) => [l.id, l]));
  const err = (where, msg) => issues.push({ level: 'error', where, msg });
  const warn = (where, msg) => issues.push({ level: 'warn', where, msg });
  const seen = new Set();
  const outer = walls
    .filter((w) => w.exterior && w.thickness > 0.02 && isPt(w.start) && isPt(w.end) && isPt(w.normal))
    .map((w) => {
      const o = [-w.normal[0] * w.thickness, -w.normal[1] * w.thickness];
      return { w, a: add(w.start, o), b: add(w.end, o), quad: [w.start, w.end, add(w.end, o), add(w.start, o)] };
    });

  raw.forEach((d, i) => {
    const where = `decks/${isObj(d) && d.id != null ? d.id : i}`;
    if (!isObj(d)) return err(where, 'en oppføring er ikke et objekt');
    const bad = Object.keys(d).filter((k) => !KNOWN.deck.includes(k));
    if (bad.length) warn(where, `ukjente felt ${bad.map((k) => `«${k}»`).join(', ')} (brukes ikke)`);
    if (d.id == null) return err(where, 'mangler id');
    if (seen.has(d.id)) err(where, `id-en «${d.id}» er brukt av et annet dekk`);
    seen.add(d.id);
    const kind = d.kind ?? 'terrace';
    if (!DECK_KINDS.includes(kind)) return err(where, `kind «${kind}» er ikke en av ${DECK_KINDS.join(', ')}`);
    if (d.levelId != null && !levelsById.has(d.levelId)) return err(where, `nivået «${d.levelId}» finnes ikke`);
    const P = d.outline;
    if (!(Array.isArray(P) && P.length >= 3 && P.every(isPt))) return err(where, 'outline må være minst tre punkter [x, z]');
    const outline = P.map((p) => [p[0], p[1]]);
    const area = signedArea(outline);
    if (Math.abs(area) < 0.25) return err(where, `outline er for lite (${Math.abs(area).toFixed(2)} m², minst 0,25)`);
    if (!isSimple(outline)) return err(where, 'outline krysser seg selv');
    for (let k = 0; k < outline.length; k++) if (len(sub(outline[(k + 1) % outline.length], outline[k])) < 0.05) return err(where, `kant ${k} er kortere enn 5 cm`);
    if (d.y != null && !num(d.y)) return err(where, 'y må være et tall (toppen av dekket)');
    if (d.groundY != null && !num(d.groundY)) err(where, 'groundY må være et tall (verdens-y)');
    const gY = num(d.groundY) ? d.groundY : groundY;
    const y = num(d.y) ? d.y : DECK_DEFAULTS.y;
    const base = d.levelId != null ? levelsById.get(d.levelId).floorY ?? 0 : gY;
    const top = base + y;
    if (top < gY - 1e-6) err(where, `toppen av dekket (y ${top.toFixed(2)}) ligger under bakken (${gY.toFixed(2)})`);
    let surface = d.surface ?? DECK_DEFAULTS.surface[kind];
    if (!DECK_SURFACES.includes(surface)) {
      err(where, `surface «${surface}» er ikke en av ${DECK_SURFACES.join(', ')}`);
      surface = DECK_DEFAULTS.surface[kind];
    }
    let color = d.color ?? DECK_DEFAULTS.color[surface];
    if (typeof color !== 'string' || !HEX.test(color)) {
      err(where, `color «${color}» må være en hex-farge`);
      color = DECK_DEFAULTS.color[surface];
    }
    let supports = d.supports ?? DECK_DEFAULTS.supports[kind];
    if (!DECK_SUPPORTS.includes(supports)) {
      err(where, `supports «${supports}» er ikke en av ${DECK_SUPPORTS.join(', ')}`);
      supports = DECK_DEFAULTS.supports[kind];
    }
    let thickness = d.thickness ?? DECK_DEFAULTS.thickness[kind];
    if (!(num(thickness) && thickness >= 0.04 && thickness <= 1)) {
      err(where, 'thickness må være et tall mellom 0,04 og 1');
      thickness = DECK_DEFAULTS.thickness[kind];
    }
    // the railing
    const r = d.railing ?? {};
    if (d.railing != null && !isObj(d.railing)) err(where, 'railing må være et objekt { type, height, edges }');
    const rbad = isObj(r) ? Object.keys(r).filter((k) => !KNOWN.railing.includes(k)) : [];
    if (rbad.length) warn(`${where}.railing`, `ukjente felt ${rbad.map((k) => `«${k}»`).join(', ')} (brukes ikke)`);
    let rType = r.type ?? DECK_DEFAULTS.railing.type[kind];
    if (!RAILING_TYPES.includes(rType)) {
      err(where, `railing.type «${rType}» er ikke en av ${RAILING_TYPES.join(', ')}`);
      rType = DECK_DEFAULTS.railing.type[kind];
    }
    let rHeight = r.height ?? DECK_DEFAULTS.railing.height;
    if (!(num(rHeight) && rHeight >= 0.5 && rHeight <= 2)) {
      err(where, 'railing.height må være et tall mellom 0,5 og 2');
      rHeight = DECK_DEFAULTS.railing.height;
    }
    let rColor = r.color ?? DECK_DEFAULTS.railing.color[rType] ?? color;
    if (typeof rColor !== 'string' || !HEX.test(rColor)) {
      err(where, `railing.color «${rColor}» må være en hex-farge`);
      rColor = color;
    }
    let rEdges = null;
    if (r.edges != null) {
      if (!Array.isArray(r.edges) || !r.edges.every((k) => Number.isInteger(k) && k >= 0 && k < outline.length)) err(where, `railing.edges må være kantnumre 0–${outline.length - 1} (kant i går fra outline[i] til outline[i + 1])`);
      else rEdges = [...new Set(r.edges)];
    }

    // ---- the edges: against the house or free, and the fall outside
    const ccw = area > 0;
    const n = outline.length;
    const houseAt = (p) => {
      for (const o of outer) {
        const fy = o.w.floorY ?? 0;
        if (top < fy - 0.4 || top > fy + (o.w.height ?? 2.4) + 0.05) continue;
        if (segDist(p, o.a, o.b) <= 0.08 || inPolygon(p[0], p[1], o.quad)) return true;
      }
      for (const rm of rooms) if (Math.abs((rm.floorY ?? 0) - top) < 0.6 && inPolygon(p[0], p[1], rm.polygon)) return true;
      return false;
    };
    const edges = [];
    for (let k = 0; k < n; k++) {
      const a = outline[k], b = outline[(k + 1) % n];
      const L = len(sub(b, a));
      const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      // outward: right of the direction for a counter-clockwise outline (x right, z down the page … the sign of the area)
      const out = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
      const m = Math.max(2, Math.ceil(L / STEP) + 1);
      const flags = [];
      for (let j = 0; j < m; j++) flags.push(houseAt(add(a, dir, (L * j) / (m - 1))));
      // runs → intervals (boundaries halfway between samples), slivers to the neighbour
      let runs = [];
      for (let j = 0; j < m; j++) {
        const s = (L * j) / (m - 1);
        const last = runs[runs.length - 1];
        if (last && last.house === flags[j]) last.s1 = s;
        else runs.push({ house: flags[j], s0: s, s1: s });
      }
      for (let j = 0; j < runs.length; j++) {
        if (j > 0) runs[j].s0 = (runs[j - 1].s1 + runs[j].s0) / 2;
        if (j < runs.length - 1) runs[j].s1 = (runs[j].s1 + runs[j + 1].s0) / 2;
      }
      runs[0].s0 = 0;
      runs[runs.length - 1].s1 = L;
      let changed = true;
      while (changed && runs.length > 1) {
        changed = false;
        const j = runs.findIndex((q) => q.s1 - q.s0 < SLIVER);
        if (j < 0) break;
        const q = runs[j];
        const nb = runs[j - 1] ?? runs[j + 1];
        nb.s0 = Math.min(nb.s0, q.s0);
        nb.s1 = Math.max(nb.s1, q.s1);
        runs.splice(j, 1);
        // merge equal neighbours
        runs = runs.reduce((acc, x) => {
          const l = acc[acc.length - 1];
          if (l && l.house === x.house) l.s1 = x.s1;
          else acc.push({ ...x });
          return acc;
        }, []);
        changed = true;
      }
      const house = runs.filter((q) => q.house).map((q) => [q.s0, q.s1]);
      const free = runs.filter((q) => !q.house).map((q) => [q.s0, q.s1]);
      edges.push({ index: k, a, b, length: L, dir, out, house, free, falls: [] });
    }
    const contains = (x, z) => inPolygon(x, z, outline);
    const bottom = supports === 'solid' ? gY - 0.1 : Math.max(top - thickness, Math.min(top - 0.04, gY - 0.05));
    // posts under the free edges (none against the house wall: the deck hangs on it there)
    const posts = [];
    if (supports === 'posts' && bottom - gY > 0.1) {
      const D = DECK_DEFAULTS;
      const nearHouse = (p) => outer.some((o) => top >= (o.w.floorY ?? 0) - 0.4 && top <= (o.w.floorY ?? 0) + (o.w.height ?? 2.4) + 0.05 && segDist(p, o.a, o.b) < 0.3);
      for (const e of edges) {
        for (const [s0, s1] of e.free) {
          const p0 = Math.min(s1, s0 + D.postInset), p1 = Math.max(p0, s1 - D.postInset);
          const k = Math.max(1, Math.ceil((p1 - p0) / D.postSpacing));
          for (let j = 0; j <= k; j++) {
            const p = add(add(e.a, e.dir, p0 + ((p1 - p0) * j) / k), e.out, -D.postInset - D.postSize / 2);
            if (contains(p[0], p[1]) && !nearHouse(p) && !posts.some((q) => len(sub(p, q)) < 0.3)) posts.push(p);
          }
        }
      }
    }
    const deck = {
      id: d.id, name: d.name ?? '', kind, levelId: d.levelId ?? null, y, top, thickness, groundY: gY, bottom,
      outline, area: Math.abs(area), ccw, surface, color: color.toLowerCase(), supports,
      railing: { type: rType, height: rHeight, color: rColor.toLowerCase(), edges: rEdges },
      edges, stairs: [], railings: [], stairRailings: [], posts, boardDir: [1, 0], contains,
    };
    decks.push(deck);

    // board direction: along the longest edge against the house, else the longest edge
    const against = edges.filter((e) => e.house.length);
    const longest = (list) => list.reduce((m, e) => (e.length > m.length ? e : m), list[0]);
    deck.boardDir = [...longest(against.length ? against : edges).dir];
    if (kind === 'balcony' && !against.length) warn(where, 'ingen kant står mot huset (en balkong henger på en yttervegg)');

    // ---- stairs
    const st = d.stairs ?? [];
    if (d.stairs != null && !Array.isArray(d.stairs)) err(where, 'stairs må være en liste');
    (Array.isArray(st) ? st : []).forEach((s, k) => {
      const sw = `${where}.stairs[${k}]`;
      if (!isObj(s)) return err(sw, 'må være et objekt { edge, at, width }');
      const sbad = Object.keys(s).filter((q) => !KNOWN.stair.includes(q));
      if (sbad.length) warn(sw, `ukjente felt ${sbad.map((q) => `«${q}»`).join(', ')} (brukes ikke)`);
      if (!(Number.isInteger(s.edge) && s.edge >= 0 && s.edge < n)) return err(sw, `edge må være et kantnummer 0–${n - 1}`);
      const e = edges[s.edge];
      const width = s.width ?? Math.min(DECK_DEFAULTS.stair.width, e.length);
      if (!(num(width) && width >= 0.6 && width <= 4)) return err(sw, 'width må være et tall mellom 0,6 og 4');
      const at = s.at ?? e.length / 2;
      if (!num(at)) return err(sw, 'at må være et tall (meter fra outline[edge] til midten av trappa)');
      const s0 = at - width / 2, s1 = at + width / 2;
      if (s0 < -1e-6 || s1 > e.length + 1e-6) return err(sw, `trappa (${s0.toFixed(2)}–${s1.toFixed(2)}) går utenfor kanten (0–${e.length.toFixed(2)})`);
      if (e.house.some(([h0, h1]) => h1 > s0 + 1e-6 && h0 < s1 - 1e-6)) return err(sw, `kant ${s.edge} står mot huset der trappa er`);
      const rise = top - gY;
      if (rise < 0.1) warn(sw, `dekket er bare ${rise.toFixed(2)} m over bakken – trappa trengs ikke`);
      if (rise > 4) warn(sw, `trappa er ${rise.toFixed(2)} m høy (mer enn 4 m uten repos)`);
      const D = DECK_DEFAULTS.stair;
      const risers = Math.max(1, Math.ceil(rise / D.maxRise - 1e-9));
      const riserH = rise / risers;
      const going = Math.max(D.minGoing, Math.min(D.maxGoing, D.going - 2 * riserH));
      const origin = add(e.a, e.dir, at);
      const reach = risers * going;
      const half = width / 2;
      const footprint = [add(origin, e.dir, -half), add(origin, e.dir, half), add(add(origin, e.dir, half), e.out, reach), add(add(origin, e.dir, -half), e.out, reach)];
      deck.stairs.push({
        index: k, edge: s.edge, at, width, s0, s1, origin, out: e.out, across: e.dir, rise, risers, riserH, going,
        run: (risers - 1) * going, reach, footprint, top, bottom: gY,
      });
    });

    // ---- what is below outside each free interval (the ground, a floor, another deck) → the fall
    deck._fallSamples = (e) => e.free.map(([s0, s1]) => {
      let f = 0;
      const k = Math.max(2, Math.ceil((s1 - s0) / 0.25) + 1);
      for (let j = 0; j < k; j++) {
        const s = s0 + ((s1 - s0) * j) / (k - 1);
        const q = add(add(e.a, e.dir, s), e.out, 0.3);
        f = Math.max(f, top - belowAt(q, deck));
      }
      return [s0, s1, f];
    });
  });

  /** Does a plan point lie on the outer face of an exterior wall standing at height `top` (a railing's end)? */
  function touchesHouse(p, top) {
    return outer.some((o) => top >= (o.w.floorY ?? 0) - 0.4 && top <= (o.w.floorY ?? 0) + (o.w.height ?? 2.4) + 0.05 && segDist(p, o.a, o.b) < 0.05);
  }

  /** Height of what one lands on outside a deck: the ground, a room's floor, another deck's top (never a roof). */
  function belowAt(q, self) {
    let h = self.groundY;
    for (const rm of rooms) if ((rm.floorY ?? 0) <= self.top + 0.01 && inPolygon(q[0], q[1], rm.polygon)) h = Math.max(h, rm.floorY ?? 0);
    for (const o of decks) if (o !== self && o.top <= self.top + 0.01 && o.contains(q[0], q[1])) h = Math.max(h, o.top);
    return h;
  }

  // second pass (every deck known): falls, railings, posts, the walking surface
  for (const deck of decks) {
    const where = `decks/${deck.id}`;
    for (const e of deck.edges) e.falls = deck._fallSamples(e);
    delete deck._fallSamples;
    const R = deck.railing;
    let unguarded = false;
    for (const e of deck.edges) {
      const listed = R.edges ? R.edges.includes(e.index) : null;
      if (listed && !e.free.length) warn(where, `railing.edges: kant ${e.index} står mot huset (ingen rekkverk der)`);
      const stairCuts = deck.stairs.filter((s) => s.edge === e.index).map((s) => [s.s0, s.s1]);
      for (const [s0, s1, fall] of e.falls) {
        const wants = R.edges ? listed : fall > FALL_LIMIT;
        if (fall > FALL_LIMIT && (R.type === 'none' || (R.edges && !listed))) {
          const open = minus([[s0, s1]], stairCuts).filter(([p, q]) => q - p > 0.1);
          if (open.length) unguarded = true;
        }
        if (!wants || R.type === 'none') continue;
        for (const [p, q] of minus([[s0, s1]], stairCuts)) {
          if (q - p < 0.1) continue;
          const a = add(e.a, e.dir, p), b = add(e.a, e.dir, q);
          deck.railings.push({ edge: e.index, s0: p, s1: q, a, b, out: e.out, fall, house0: touchesHouse(a, deck.top), house1: touchesHouse(b, deck.top) });
        }
      }
    }
    if (unguarded) warn(where, `en fri kant har mer enn ${FALL_LIMIT} m fall uten rekkverk (TEK17 § 12-17)`);
    if (R.type !== 'none' && R.height < 0.9 && deck.edges.some((e) => e.falls.some((f) => f[2] > FALL_LIMIT))) warn(where, `railing.height ${R.height} er lavere enn 0,9 m der det er fall`);
    // stair railings: both sides when the stair has fall, in the deck's railing type
    for (const s of deck.stairs) {
      if (R.type === 'none' || s.rise <= FALL_LIMIT) continue;
      for (const side of [-1, 1]) {
        const a = add(s.origin, s.across, side * s.width / 2);
        deck.stairRailings.push({ stair: s.index, side, a, b: add(a, s.out, Math.max(s.run, s.going * 0.5)), topY: s.top, bottomY: s.top - (s.run > 0 ? s.risers - 1 : 0.5) * s.riserH, out: [s.across[0] * side, s.across[1] * side] });
      }
    }
    deck.surfaceY = (x, z) => {
      if (deck.contains(x, z)) return deck.top;
      for (const s of deck.stairs) {
        const v = sub([x, z], s.origin);
        const u = dot(v, s.out), c = dot(v, s.across);
        if (u >= -1e-6 && u <= s.reach + 1e-6 && Math.abs(c) <= s.width / 2 + 1e-6) return Math.max(s.bottom, s.top - (s.riserH / s.going) * u);
      }
      return null;
    };
    const pts = [...deck.outline, ...deck.stairs.flatMap((s) => s.footprint)];
    deck.bounds = { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])) };
  }

  // overlaps: a deck in a room, two decks in one plane
  const cellsIn = (dk) => {
    const out = [];
    const b = dk.bounds;
    for (let x = b.minX + 0.05; x < b.maxX; x += 0.1) for (let z = b.minZ + 0.05; z < b.maxZ; z += 0.1) if (dk.contains(x, z)) out.push([x, z]);
    return out;
  };
  for (const dk of decks) {
    const cells = cellsIn(dk);
    const inRoom = cells.filter(([x, z]) => rooms.some((rm) => Math.abs((rm.floorY ?? 0) - dk.top) < 2 && inPolygon(x, z, rm.polygon))).length * 0.01;
    if (inRoom > 0.05) warn(`decks/${dk.id}`, `outline går ${inRoom.toFixed(2)} m² inn i et rom (legg kanten på yttersiden av veggen)`);
    for (const o of decks) {
      if (o === dk || decks.indexOf(o) < decks.indexOf(dk) || Math.abs(o.top - dk.top) > 0.01) continue;
      const shared = cells.filter(([x, z]) => o.contains(x, z)).length * 0.01;
      if (shared > 0.02) warn(`decks/${dk.id}`, `overlapper dekket «${o.id}» i samme høyde (${shared.toFixed(2)} m²)`);
    }
  }
  return { decks, issues };
}

/** The walking rectangle of a deck for the collision bounds (layout.house.walkRects): its outline and stairs. */
export function deckWalkRect(dk) {
  const b = dk.bounds;
  return { levelId: dk.levelId, deckId: dk.id, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, minY: dk.groundY - 0.5, maxY: dk.top + 2.5 };
}
