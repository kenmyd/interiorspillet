/**
 * Planbygger: comparison of a generated house with the owner's hand-built house (the ground truth of the night run:
 * research/house/10-hoved-rom.json, 20-trapp.json, 30-kjeller.json + the living room in research/room-spec.json, all
 * merged in src/data/room-spec.json). Pure functions on room-spec shaped data; game coordinates (x south, z west).
 *
 *   truthLevel(spec, levelId, { zScale }) → { walls: faces[], openings[], rooms[] }   zScale: multiply z (the basement
 *                                           plan was stretched 6,1 % in z by the night run, D3 – 1/1.0616 undoes it)
 *   generatedLevel(house, levelId)        → the same from a planbygger house file
 *   compare(truth, gen)                   → { walls: {...}, openings: {...}, rooms: [...] }
 *
 * Walls are compared as room faces (the room side of every wall, backOf faces included): for each truth face the
 * generated faces that are parallel, face the same way and overlap it; the error is the perpendicular distance, length
 * weighted. A face counts as found when a generated face lies within 15 cm. Openings: matched by the centre (≤ 0,6 m)
 * on a parallel wall line; the type is compared (terrace-door = door). Rooms: matched by the largest overlap.
 */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a) => {
  const l = Math.hypot(a[0], a[1]);
  return l ? [a[0] / l, a[1] / l] : [0, 0];
};
const area = (P) => {
  let s = 0;
  for (let i = 0; i < P.length; i++) s += cross(P[i], P[(i + 1) % P.length]);
  return s / 2;
};

/** Area of the intersection of two simple polygons (grid sampling at 2 cm – plenty for a comparison). */
export function overlapArea(A, B, h = 0.02) {
  const inP = (p, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      if (P[i][1] > p[1] !== P[j][1] > p[1] && p[0] < ((P[j][0] - P[i][0]) * (p[1] - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
    }
    return c;
  };
  const bx = (P) => [Math.min(...P.map((p) => p[0])), Math.max(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[1]))];
  const a = bx(A);
  const b = bx(B);
  const x0 = Math.max(a[0], b[0]);
  const x1 = Math.min(a[1], b[1]);
  const z0 = Math.max(a[2], b[2]);
  const z1 = Math.min(a[3], b[3]);
  if (x1 <= x0 || z1 <= z0) return 0;
  let n = 0;
  for (let x = x0 + h / 2; x < x1; x += h) for (let z = z0 + h / 2; z < z1; z += h) if (inP([x, z], A) && inP([x, z], B)) n++;
  return n * h * h;
}

const roomOf = (e) => e.roomId ?? 'stue-kjokken';

function facesOf(walls, rooms, levelId, zs) {
  const ids = new Set(rooms.filter((r) => r.levelId === levelId && r.kind !== 'hud').map((r) => r.id));
  const S = (p) => [p[0], p[1] * zs];
  const out = [];
  for (const w of walls) {
    if (!ids.has(roomOf(w))) continue;
    const a = S(w.from);
    const b = S(w.to);
    const L = dist(a, b);
    if (L < 0.01) continue;
    const d = unit(sub(b, a));
    out.push({ id: w.id, room: roomOf(w), a, b, L, d, n: [-d[1], d[0]] });
  }
  return out;
}

function openingsOf(walls, rooms, levelId, zs) {
  const ids = new Set(rooms.filter((r) => r.levelId === levelId && r.kind !== 'hud').map((r) => r.id));
  const S = (p) => [p[0], p[1] * zs];
  const out = [];
  for (const w of walls) {
    if (!ids.has(roomOf(w))) continue;
    const a = S(w.from);
    const b = S(w.to);
    const d = unit(sub(b, a));
    for (const o of w.openings || []) {
      const c = add(a, mul(d, o.offset + o.width / 2));
      const type = o.type === 'terrace-door' ? 'door' : o.door && o.type !== 'window' ? 'door' : o.type;
      // a door's hinge point and the direction its leaf swings to (room-spec: hinge from/to, swing in = into the
      // owner room = along the wall's inward normal)
      let hinge = null;
      let swing = null;
      if (o.door) {
        const n = [-d[1], d[0]];
        const u = (o.door.hinge ?? 'from') === 'from' ? o.offset : o.offset + o.width;
        hinge = add(a, mul(d, u));
        swing = (o.door.swing ?? 'in') === 'in' ? n : mul(n, -1);
      }
      out.push({ id: o.id, wall: w.id, room: roomOf(w), type, centre: c, width: o.width * (Math.abs(d[1]) > 0.5 ? zs : 1), d, height: o.height, sill: o.sill ?? 0, hinge, swing });
    }
  }
  return out;
}

/** The ground truth of one level from the merged room-spec. */
export function truthLevel(spec, levelId, { zScale = 1 } = {}) {
  const rooms = (spec.rooms || []).map((r) => ({ ...r, levelId: r.levelId ?? 'hoved', polygon: r.id === 'stue-kjokken' && !r.polygon ? spec.floor.polygon : r.polygon }));
  const lr = rooms.filter((r) => r.levelId === levelId && r.kind !== 'hud' && r.polygon?.length >= 3);
  return {
    walls: facesOf(spec.walls || [], rooms, levelId, zScale),
    openings: openingsOf(spec.walls || [], rooms, levelId, zScale),
    rooms: lr.map((r) => ({ id: r.id, name: r.name, kind: r.kind, polygon: r.polygon.map((p) => [p[0], p[1] * zScale]), area: Math.abs(area(r.polygon.map((p) => [p[0], p[1] * zScale]))) })),
  };
}

/** The same from a generated house file (one level). */
export function generatedLevel(house, levelId) {
  const rooms = house.rooms.filter((r) => r.levelId === levelId);
  return {
    walls: facesOf(house.walls, house.rooms, levelId, 1),
    openings: openingsOf(house.walls, house.rooms, levelId, 1),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, polygon: r.polygon, area: Math.abs(area(r.polygon)) })),
  };
}

const quant = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};

/**
 * Compares a generated level with the truth (see the top of the file).
 * @param {{ walls, openings, rooms }} T  truth
 * @param {{ walls, openings, rooms }} G  generated
 */
export function compare(T, G, { found = 0.15, openingRadius = 0.6 } = {}) {
  // ---- walls: per truth face, sampled every 5 cm, the nearest generated face (parallel, same facing, overlapping)
  const samples = [];
  let totalLen = 0;
  let foundLen = 0;
  const perFace = [];
  for (const t of T.walls) {
    const n = Math.max(1, Math.round(t.L / 0.05));
    let fl = 0;
    const errs = [];
    for (let k = 0; k < n; k++) {
      const p = add(t.a, mul(t.d, ((k + 0.5) / n) * t.L));
      let best = Infinity;
      for (const g of G.walls) {
        if (Math.abs(cross(g.d, t.d)) > 0.05 || dot(g.n, t.n) < 0.9) continue;
        const u = dot(sub(p, g.a), g.d);
        if (u < -0.02 || u > g.L + 0.02) continue;
        const e = Math.abs(dot(sub(p, g.a), g.n));
        if (e < best) best = e;
      }
      const segL = t.L / n;
      totalLen += segL;
      if (best <= found) {
        foundLen += segL;
        fl += segL;
        samples.push({ e: best, w: segL });
        errs.push(best);
      }
    }
    perFace.push({ id: t.id, room: t.room, L: t.L, found: fl / t.L, mean: errs.length ? errs.reduce((s, x) => s + x, 0) / errs.length : null, max: errs.length ? Math.max(...errs) : null });
  }
  const wsum = samples.reduce((s, x) => s + x.w, 0);
  const mean = wsum ? samples.reduce((s, x) => s + x.e * x.w, 0) / wsum : null;
  const errs = samples.map((x) => x.e);
  // extra generated faces: generated face length with no truth face within `found`
  let extra = 0;
  let genLen = 0;
  for (const g of G.walls) {
    const n = Math.max(1, Math.round(g.L / 0.05));
    for (let k = 0; k < n; k++) {
      const p = add(g.a, mul(g.d, ((k + 0.5) / n) * g.L));
      let ok = false;
      for (const t of T.walls) {
        if (Math.abs(cross(g.d, t.d)) > 0.05 || dot(g.n, t.n) < 0.9) continue;
        const u = dot(sub(p, t.a), t.d);
        if (u < -0.02 || u > t.L + 0.02) continue;
        if (Math.abs(dot(sub(p, t.a), t.n)) <= found) {
          ok = true;
          break;
        }
      }
      genLen += g.L / n;
      if (!ok) extra += g.L / n;
    }
  }
  const walls = { truthLength: totalLen, coverage: totalLen ? foundLen / totalLen : 0, meanCm: mean * 100, medianCm: quant(errs, 0.5) * 100, p90Cm: quant(errs, 0.9) * 100, maxCm: errs.length ? Math.max(...errs) * 100 : null, extraLength: extra, generatedLength: genLen, perFace };

  // ---- openings: greedy by distance
  const pairs = [];
  for (const t of T.openings) {
    for (const g of G.openings) {
      if (Math.abs(cross(g.d, t.d)) > 0.1) continue;
      const dd = dist(t.centre, g.centre);
      if (dd <= openingRadius) pairs.push({ t, g, dd });
    }
  }
  pairs.sort((a, b) => a.dd - b.dd);
  const usedT = new Set();
  const usedG = new Set();
  const matches = [];
  for (const p of pairs) {
    if (usedT.has(p.t) || usedG.has(p.g)) continue;
    usedT.add(p.t);
    usedG.add(p.g);
    // the same door leaf: hinge on the same side (within 35 cm) and swinging to the same side of the wall
    const orient = p.t.hinge && p.g.hinge ? dist(p.t.hinge, p.g.hinge) < 0.35 && dot(p.t.swing, p.g.swing) > 0.5 : null;
    matches.push({ truth: p.t.id, gen: p.g.id, truthType: p.t.type, type: p.g.type, centreCm: p.dd * 100, widthCm: (p.g.width - p.t.width) * 100, typeOk: p.t.type === p.g.type, orientOk: orient });
  }
  const missed = T.openings.filter((t) => !usedT.has(t)).map((t) => ({ id: t.id, type: t.type, width: t.width }));
  const extraO = G.openings.filter((g) => !usedG.has(g)).map((g) => ({ id: g.id, type: g.type, width: g.width }));
  const byType = {};
  for (const ty of ['door', 'window', 'opening']) {
    const tt = T.openings.filter((o) => o.type === ty).length;
    const f = matches.filter((m) => m.truthType === ty).length;
    const ok = matches.filter((m) => m.truthType === ty && m.typeOk).length;
    const oriented = matches.filter((m) => m.truthType === ty && m.orientOk === true).length;
    byType[ty] = { truth: tt, found: f, typeOk: ok, oriented, generated: G.openings.filter((o) => o.type === ty).length };
  }
  const openings = { matches, missed, extra: extraO, byType, centreMeanCm: matches.length ? matches.reduce((s, m) => s + m.centreCm, 0) / matches.length : null, widthMeanAbsCm: matches.length ? matches.reduce((s, m) => s + Math.abs(m.widthCm), 0) / matches.length : null };

  // ---- rooms: by the largest overlap
  const rooms = T.rooms.map((t) => {
    let best = null;
    for (const g of G.rooms) {
      const ov = overlapArea(t.polygon, g.polygon);
      if (ov > 0 && (!best || ov > best.ov)) best = { g, ov };
    }
    if (!best) return { id: t.id, name: t.name, truthArea: t.area, genArea: null, iou: 0 };
    const union = t.area + best.g.area - best.ov;
    const norm = (x) => String(x ?? '').trim().toLowerCase();
    return { id: t.id, name: t.name, truthArea: t.area, gen: best.g.id, genName: best.g.name, nameOk: norm(best.g.name) === norm(t.name), kindOk: best.g.kind === t.kind, genKind: best.g.kind, genArea: best.g.area, iou: best.ov / union, diff: best.g.area - t.area };
  });
  return { walls, openings, rooms };
}
