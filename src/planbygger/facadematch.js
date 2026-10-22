/**
 * Planbygger: which side of the house each facade drawing shows, and which window or door in the plan each of its
 * openings is – classical, from the positions alone (no AI). A facade title with a compass word («FASADE SØR») also
 * gives the plan's north.
 *
 *   matchFacades(doc, drawings, { levelsByNo }) → {
 *     north:    degrees (the plan's north from the titles) | null (no titles, or they do not agree with the plan)
 *     drawings: [{ side: 'N'|'E'|'S'|'W' (under north), score, k, pairs: [{ i, level, id, win }], unmatched: [i],
 *                  missing: n (plan openings on that side the drawing does not show), title compass | null }]
 *   }
 *     drawings: [{ reading (facade.js readFacade), title, planSide ('top'|'right'|'bottom'|'left', the AI's reading of
 *               the side of the plan image it shows: worth 1 point, a tie-breaker) }]
 *     levelsByNo: { [levelNo]: levelId } – the facade's storey 0 is level 0 (a facade showing a basement storey is
 *                 tried one storey down as well)
 *   applyFacadeMatch(doc, drawings, match, { ceiling }) → n openings set: the sill and height of every matched window
 *     (and the height of a matched door that clearly differs) from its drawing, in metres above its level's floor
 *
 * The method, per drawing and side (buildFacades: the exterior walls by the compass side they face, as seen from
 * outside): the drawing's openings in metres along the house (from the left of the walls at the ground, readFacade's
 * span) against the side's openings, s = a + k·u. k starts at the ratio of the two widths (a drawing's scale is good to
 * 5–10 %, the plan's better) and a is tried from every pair of same-kind openings on the same storey; the best a
 * matches the most openings within max(0.3 m, a third of the wider), then a and k are fitted to the matches. The score
 * counts the matches (and how well the widths agree), less the openings left over on either side, less the difference
 * of the widths. The drawings are then given one side each, the best total (with titles: the north that agrees with
 * the most titles first).
 */
import { buildFacades } from './facadecheck.js';

const SIDE_KEYS = ['N', 'E', 'S', 'W'];
/** a whole word (letters around it are not part of it: \b does not know «ø») */
const word = (w) => new RegExp(`(?<!\\p{L})(?:${w})(?!\\p{L})`, 'iu');
/** compass words in facade titles → side; the longest first («nordøst» before «nord») */
const COMPASS = [
  [word('nord\\s*-?\\s*øst|nordost|north\\s*-?\\s*east'), 'NE'],
  [word('nord\\s*-?\\s*vest|northwest|north\\s*-?\\s*west'), 'NW'],
  [word('sør\\s*-?\\s*øst|syd\\s*-?\\s*øst|south\\s*-?\\s*east'), 'SE'],
  [word('sør\\s*-?\\s*vest|syd\\s*-?\\s*vest|south\\s*-?\\s*west'), 'SW'],
  [word('nord|north|n'), 'N'],
  [word('sør|syd|south|s'), 'S'],
  [word('øst|east|ø|e'), 'E'],
  [word('vest|west|v|w'), 'W'],
];

/** The compass side a facade title names ('N', 'E', 'S', 'W'; a diagonal one is null), or null. */
export function titleCompass(title) {
  if (!title) return null;
  const t = String(title).replace(/fasade|facade|elevation|oppriss/gi, ' ');
  for (const [re, side] of COMPASS) if (re.test(t)) return side.length === 1 ? side : null;
  return null;
}

/** The side a facade faces when north is turned by `deg` (clockwise from up) from where the plan's 'N' side is. */
function turned(key, deg) {
  const i = SIDE_KEYS.indexOf(key);
  return SIDE_KEYS[(((i - Math.round(deg / 90)) % 4) + 4) % 4];
}

/** The drawing's openings in metres: u along the house from the left of the span, w wide, storey, kind. */
function drawingOpenings(r) {
  const ppm = r?.pxPerM;
  if (!(ppm > 0) || !Array.isArray(r.windows)) return null;
  const x0 = Array.isArray(r.span) ? r.span[0] : Math.min(...r.windows.map((w) => w.x0));
  const x1 = Array.isArray(r.span) ? r.span[1] : Math.max(...r.windows.map((w) => w.x1));
  return {
    width: (x1 - x0) / ppm,
    list: r.windows.map((w, i) => ({ i, u: ((w.x0 + w.x1 + 1) / 2 - x0) / ppm, w: (w.x1 + 1 - w.x0) / ppm, storey: w.storey, win: w.kind !== 'door' })),
  };
}

/**
 * One drawing against one side: the best a, k and its matches.
 * D: drawingOpenings; F: a buildFacades side; levelOf(storey) → level id.
 */
function matchSide(D, F, levelOf) {
  const sideW = F.sMax - F.sMin;
  const ops = F.openings.map((o, j) => ({ j, s: (o.s0 + o.s1) / 2 - F.sMin, w: o.s1 - o.s0, level: o.level, win: o.win, id: o.id }));
  const ratio = D.width > 0 ? sideW / D.width : 1;
  const k0 = ratio > 0.8 && ratio < 1.25 ? ratio : 1;
  const levelOk = (d, o) => levelOf(d.storey) === o.level;
  const greedy = (a, k) => {
    const cand = [];
    for (const d of D.list) {
      for (const o of ops) {
        if (!levelOk(d, o)) continue;
        const e = Math.abs(a + k * d.u - o.s);
        const tol = Math.max(0.3, Math.max(k * d.w, o.w) / 3);
        if (e < tol) cand.push({ d, o, cost: e / tol + (d.win === o.win ? 0 : 0.6) });
      }
    }
    cand.sort((x, y) => x.cost - y.cost);
    const usedD = new Set();
    const usedO = new Set();
    const pairs = [];
    for (const c of cand) {
      if (usedD.has(c.d.i) || usedO.has(c.o.j)) continue;
      usedD.add(c.d.i);
      usedO.add(c.o.j);
      pairs.push(c);
    }
    let score = 0;
    for (const p of pairs) {
      const wa = k * p.d.w;
      score += 1 + 0.5 * (1 - Math.min(1, Math.abs(wa - p.o.w) / Math.max(wa, p.o.w))) - (p.d.win === p.o.win ? 0 : 0.5);
    }
    score -= 0.35 * (D.list.length - pairs.length) + 0.35 * (ops.length - pairs.length);
    return { pairs, score };
  };
  // the widths: a drawing as wide as the side is likely it (the long side against the gable end)
  const widthPenalty = (k) => (sideW > 0 ? 3 * Math.min(1, Math.abs(k * D.width - sideW) / sideW) : 0);
  let best = { pairs: [], score: -widthPenalty(k0) - 0.35 * (D.list.length + ops.length), a: 0, k: k0 };
  const tried = new Set();
  const tryA = (a, k) => {
    const key = `${Math.round(a * 20)}:${Math.round(k * 100)}`;
    if (tried.has(key)) return;
    tried.add(key);
    const g = greedy(a, k);
    const score = g.score - widthPenalty(k);
    if (score > best.score) best = { ...g, score, a, k };
  };
  tryA(0, k0);
  tryA(sideW - k0 * D.width, k0);
  for (const d of D.list) for (const o of ops) if (d.win === o.win && levelOk(d, o)) tryA(o.s - k0 * d.u, k0);
  // fit a and k to the matches (least squares), and match again
  if (best.pairs.length >= 2) {
    const xs = best.pairs.map((p) => p.d.u);
    const ys = best.pairs.map((p) => p.o.s);
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
    const my = ys.reduce((s, y) => s + y, 0) / ys.length;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    let k = best.k;
    if (best.pairs.length >= 3 && sxx > 4) k = Math.min(1.2, Math.max(0.83, sxy / sxx));
    tryA(my - k * mx, k);
  }
  return best;
}

export function matchFacades(doc, drawings, { levelsByNo = {} } = {}) {
  // the sides under north 0 (the plan's own up is N); a title then says how far north is turned
  const sides = buildFacades({ ...doc, settings: { ...(doc.settings || {}), north: 0 } });
  const byKey = Object.fromEntries(sides.map((F) => [F.key, F]));
  const D = drawings.map((d) => drawingOpenings(d.reading));
  const compass = drawings.map((d) => titleCompass(d.title));
  // the AI's reading of the side (readHouse planSide: the side of the plan image, so of the plan with north 0): a small
  // bonus that only settles a near tie
  const hint = drawings.map((d) => ({ top: 'N', right: 'E', bottom: 'S', left: 'W' })[d.planSide] ?? null);
  // the score of every drawing on every side, with the storeys as drawn and one down (a basement showing)
  const table = D.map((dd) =>
    Object.fromEntries(
      SIDE_KEYS.map((key) => {
        const F = byKey[key];
        if (!dd || !F) return [key, null];
        let best = null;
        for (const shift of [0, -1]) {
          const levelOf = (st) => levelsByNo[(Number.isInteger(st) ? st : 0) + shift] ?? null;
          const m = matchSide(dd, F, levelOf);
          if (!best || m.score > best.score) best = { ...m, shift };
        }
        return [key, best];
      }),
    ),
  );
  // every north the titles allow (none: the plan's own), each with its best assignment of drawings to sides
  const titled = compass.some(Boolean);
  const norths = titled ? [0, 90, 180, 270] : [doc.settings?.north ?? 0];
  let best = null;
  const idx = D.map((_, i) => i).filter((i) => D[i]);
  for (const north of norths) {
    // assignment: drawings in order, each to an unused side (or none), best total by search (≤ 6 drawings)
    let top = { total: -Infinity, sides: [] };
    const used = new Set();
    const pick = new Array(D.length).fill(null);
    const walk = (n, total, agree) => {
      if (n === idx.length) {
        const t = total + 4 * agree;
        if (t > top.total) top = { total: t, sides: [...pick], agree };
        return;
      }
      const i = idx[n];
      walk(n + 1, total - 2, agree); // left out
      for (const key of SIDE_KEYS) {
        if (used.has(key) || !table[i][key]) continue;
        const c = compass[i];
        const facing = turned(key, north);
        if (c && c !== facing) continue; // a titled drawing only on the side its title names
        used.add(key);
        pick[i] = key;
        walk(n + 1, total + table[i][key].score + (hint[i] === key ? 1 : 0), agree + (c ? 1 : 0));
        pick[i] = null;
        used.delete(key);
      }
    };
    walk(0, 0, 0);
    if (!best || top.total > best.total) best = { ...top, north };
  }
  const out = {
    north: titled && best && best.agree > 0 ? best.north : null,
    drawings: drawings.map((d, i) => {
      const key = best?.sides[i];
      const m = key ? table[i][key] : null;
      if (!m) return { side: null, score: null, k: null, pairs: [], unmatched: D[i] ? D[i].list.map((x) => x.i) : [], missing: 0, compass: compass[i] };
      const F = byKey[key];
      const pairs = m.pairs.map((p) => ({ i: p.d.i, level: F.openings[p.o.j].level, id: F.openings[p.o.j].id, win: p.o.win }));
      return {
        side: turned(key, best.north),
        planSide: key,
        score: Math.round(m.score * 100) / 100,
        k: Math.round(m.k * 1000) / 1000,
        shift: m.shift,
        pairs,
        unmatched: D[i].list.filter((x) => !m.pairs.some((p) => p.d.i === x.i)).map((x) => x.i),
        missing: F.openings.length - m.pairs.length,
        compass: compass[i],
      };
    }),
  };
  return out;
}

/**
 * The roof as the facades show it from their sides: the pitch (the median of the end views' slopes) and, for a
 * mono-pitch roof, the plan direction it is high towards – each end view on its side: seen from outside, the drawing's
 * right end lies towards the side's right hand. Views that disagree (two mono-pitch wings high towards the middle, hus5)
 * cancel out. → { pitch: degrees | null, high: [dx, dy] (plan, north 0) | null, n }
 */
export function roofFromFacades(drawings, match) {
  const OUT = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const pitches = [];
  const sum = [0, 0];
  let n = 0;
  match.drawings.forEach((m, i) => {
    const r = drawings[i]?.reading;
    if (!r || !m.planSide) return;
    if (r.roofPitch) pitches.push(r.roofPitch);
    if (r.roof === 'mono-pitch' && r.roofHigh) {
      const d = OUT[m.planSide];
      const right = [d[1], -d[0]];
      const v = r.roofHigh === 'right' ? right : [-right[0], -right[1]];
      sum[0] += v[0];
      sum[1] += v[1];
      n++;
    }
  });
  pitches.sort((a, b) => a - b);
  const pitch = pitches.length ? pitches[(pitches.length - 1) >> 1] : null;
  // a clear majority along one axis
  const len = Math.hypot(sum[0], sum[1]);
  const high = n && len >= Math.max(1, 0.6 * n) ? (Math.abs(sum[0]) >= Math.abs(sum[1]) ? [Math.sign(sum[0]), 0] : [0, Math.sign(sum[1])]) : null;
  return { pitch: pitch != null ? Math.round(pitch) : null, high, n };
}

/**
 * The matched openings take their height from the drawing: a window its sill and height, a door its height when it
 * differs by more than 15 cm (a tall glass door). Openings the user fixed (o.fixed) are left alone. Positions and
 * widths stay the plan's.
 */
export function applyFacadeMatch(doc, drawings, match, { ceiling = 2.4 } = {}) {
  let n = 0;
  match.drawings.forEach((m, di) => {
    const r = drawings[di]?.reading;
    if (!r || !m.side || !(r.pxPerM > 0)) return;
    // the drawing's own scale, corrected by the fit against the plan (k: plan metres per drawing metre)
    const ppm = r.pxPerM / (m.k || 1);
    for (const p of m.pairs) {
      const w = r.windows[p.i];
      const L = doc.levels.find((l) => l.id === p.level);
      const o = L?.openings.find((x) => x.id === p.id);
      if (!w || !o || o.fixed) continue;
      const floor = Array.isArray(r.floorYs) ? r.floorYs[w.storey] : null;
      const height = (w.y1 + 1 - w.y0) / ppm;
      const top = (L.ceiling ?? ceiling) - 0.05;
      if (o.type === 'window') {
        if (!Number.isFinite(floor)) continue;
        const sill = Math.max(0, (floor - (w.y1 + 1)) / ppm);
        if (!(sill <= 2.2 && height >= 0.25 && height <= 3.2)) continue;
        const s = Math.min(sill < 0.05 ? 0 : sill, top - 0.3);
        o.sill = Math.round(s * 100) / 100;
        o.height = Math.round(Math.max(0.3, Math.min(height, top - s)) * 100) / 100;
        // the top as drawn, before it was kept under a flat ceiling: higher means the room is open to the roof
        o.facadeTop = Math.round((sill + height) * 100) / 100;
        o.fromFacade = true;
        n++;
      } else if (o.type === 'door' && height >= 1.9 && height <= 2.8) {
        o.facadeTop = Math.round(height * 100) / 100;
        if (Math.abs(height - (o.height ?? 2.1)) > 0.15) {
          o.height = Math.round(Math.min(height, top) * 100) / 100;
          o.fromFacade = true;
          n++;
        }
      }
    }
  });
  return n;
}
