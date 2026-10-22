// LIGHT CLUSTERS – pure helpers of the LightManager (home/lighting.js) for the spot category's fittings
// (models/spots.js; design/lighting.md §4.4, MASTER §2.5). No three.js: vectors are plain { x, y, z } (a THREE.Vector3
// works too), colours { r, g, b }.
//
//   splitClusters(list, { maxParts, gap, span })   item downlights of one room / zone → ≤ maxParts runs
//   pooledSpot(part, { floorY, maxAngle, penumbra }) one pooled spot for a run (flux-weighted centroid and aim)
//   aimGroups(heads, maxRad)                       the heads of one rail / multi-spot → 1 or 2 groups by aim
//   planSpotSeats(list, { slots, shadowSlots, cap, room })
//                                                  who may hold a spot slot when the spot category's fittings compete:
//                                                  the per-room seat plan (MASTER D5)

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

/**
 * Splits item downlights (each { position: {x, z}, id }) into at most maxParts runs: sorted along the axis they spread
 * most over (ties by id – stable), cut first at gaps > gap (largest first), else a run longer than span is halved into
 * equal counts (the house's built-in rule, lighting.js _buildHouseLamps). Deterministic for a given set.
 * @param {Array<{ id: string, position: { x: number, z: number } }>} list
 * @param {{ maxParts?: number, gap?: number, span?: number }} [o]
 * @returns {Array<Array>} parts, in sorted order (part k keeps its index while members come and go)
 */
export function splitClusters(list, { maxParts = 2, gap = 2.0, span = 2.4 } = {}) {
  if (list.length <= 1) return list.length ? [list] : [];
  const xs = list.map((c) => c.position.x), zs = list.map((c) => c.position.z);
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const at = (c) => (alongX ? c.position.x : c.position.z);
  const s = [...list].sort((a, b) => at(a) - at(b) || byId(a, b));
  let cuts = [];
  for (let i = 1; i < s.length; i++) {
    const g = at(s[i]) - at(s[i - 1]);
    if (g > gap + 1e-3) cuts.push({ i, g });
  }
  cuts = cuts.sort((a, b) => b.g - a.g || a.i - b.i).slice(0, Math.max(0, maxParts - 1)).map((c) => c.i).sort((a, b) => a - b);
  // (a millimetre of slack: four fittings 0.8 m apart span 2.4000000000000004 m, not «longer than» 2.4)
  if (!cuts.length && maxParts >= 2 && at(s[s.length - 1]) - at(s[0]) > span + 1e-3) cuts = [Math.round(s.length / 2)];
  const parts = [];
  let a = 0;
  for (const i of [...cuts, s.length]) {
    parts.push(s.slice(a, i));
    a = i;
  }
  return parts;
}

/**
 * One pooled spot for a run of item downlights (each { position, direction, angle, penumbra, flux, color: {r,g,b} }):
 * the flux-weighted centroid and aim; a single member keeps its own cone; several get the house formula (lighting.js
 * _buildHouseLamps): angle = clamp(atan((r + H·tan base) / H), base, maxAngle), base = clamp(the flux-weighted mean
 * angle, 0.15, 50°), r = the farthest member from the centroid (in plan), H = the centroid's height over the floor.
 * @param {Array<object>} part
 * @param {{ floorY?: number, maxAngle?: number, penumbra?: number }} [o]
 * @returns {{ position: {x,y,z}, direction: {x,y,z}, angle: number, penumbra: number, flux: number, color: {r,g,b}, r: number, H: number }}
 */
export function pooledSpot(part, { floorY = 0, maxAngle = 80 * DEG, penumbra = 0.7 } = {}) {
  let flux = 0;
  for (const m of part) flux += Math.max(0, m.flux || 0);
  const w = (m) => (flux > 0 ? Math.max(0, m.flux || 0) / flux : 1 / part.length);
  const position = { x: 0, y: 0, z: 0 }, dir = { x: 0, y: 0, z: 0 }, color = { r: 0, g: 0, b: 0 };
  let angle = 0;
  for (const m of part) {
    const k = w(m);
    position.x += m.position.x * k;
    position.y += m.position.y * k;
    position.z += m.position.z * k;
    const d = m.direction ?? { x: 0, y: -1, z: 0 };
    dir.x += d.x * k;
    dir.y += d.y * k;
    dir.z += d.z * k;
    angle += (m.angle ?? 0.6) * k;
    color.r += (m.color?.r ?? 1) * k;
    color.g += (m.color?.g ?? 1) * k;
    color.b += (m.color?.b ?? 1) * k;
  }
  const direction = Math.hypot(dir.x, dir.y, dir.z) > 1e-9 ? norm(dir) : { x: 0, y: -1, z: 0 };
  let r = 0;
  for (const m of part) r = Math.max(r, Math.hypot(m.position.x - position.x, m.position.z - position.z));
  const H = Math.max(0.5, position.y - floorY);
  if (part.length === 1) {
    const m = part[0];
    return { position, direction, angle: m.angle ?? angle, penumbra: m.penumbra ?? penumbra, flux, color, r, H };
  }
  const base = clamp(angle, 0.15, 50 * DEG);
  const wide = clamp(Math.atan((r + H * Math.tan(base)) / H), base, maxAngle);
  return { position, direction, angle: wide, penumbra, flux, color, r, H };
}

/**
 * The heads of one fitting (a rail, a multi-spot plate: each { direction, lumens }) → one group when all lie within
 * maxRad of their lumen-weighted mean aim, else two (seeded by the most different pair, three Lloyd rounds). Groups are
 * ordered by their first head's index, so their ids (m0 / m1) are stable.
 * @param {Array<{ direction: {x,y,z}, lumens?: number }>} heads
 * @param {number} maxRad
 * @returns {Array<Array>}
 */
export function aimGroups(heads, maxRad) {
  if (heads.length <= 1) return heads.length ? [heads] : [];
  const wt = (c) => (c.lumens > 0 ? c.lumens : 1);
  const mean = (g) => {
    const v = { x: 0, y: 0, z: 0 };
    for (const c of g) {
      v.x += c.direction.x * wt(c);
      v.y += c.direction.y * wt(c);
      v.z += c.direction.z * wt(c);
    }
    return Math.hypot(v.x, v.y, v.z) > 1e-9 ? norm(v) : norm(g[0].direction);
  };
  const ang = (a, b) => Math.acos(clamp(dot(norm(a), b), -1, 1));
  const m = mean(heads);
  if (heads.every((c) => ang(c.direction, m) <= maxRad + 1e-9)) return [heads];
  let ia = 0, ib = 1, worst = -1;
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const d = ang(heads[i].direction, norm(heads[j].direction));
      if (d > worst + 1e-12) {
        worst = d;
        ia = i;
        ib = j;
      }
    }
  }
  let ca = norm(heads[ia].direction), cb = norm(heads[ib].direction);
  let groups = [[heads[ia]], [heads[ib]]];
  for (let it = 0; it < 3; it++) {
    const A = [], B = [];
    for (const c of heads) (dot(norm(c.direction), ca) >= dot(norm(c.direction), cb) ? A : B).push(c);
    if (!A.length || !B.length) break;
    groups = [A, B];
    ca = mean(A);
    cb = mean(B);
  }
  return groups.sort((a, b) => heads.indexOf(a[0]) - heads.indexOf(b[0]));
}

/**
 * The spot pool's seats when the spot category's fittings (candidates with `capped`) compete (MASTER D5, §2.5).
 *   1. today's seats without them – the same rule as LightManager._assignSpots: the `wantsShadow` candidates take the
 *      shadow slots first, then the best of the rest fill the remaining slots;
 *   2. per room the best `cap` capped candidates, best first;
 *   3. they take free seats first (any room);
 *   4. then each may unseat the lowest-score non-shadow, non-capped seated candidate of its OWN room.
 * No candidate of another room ever loses its seat; `wantsShadow` candidates never lose theirs.
 * @param {Array<{ id: string, score: number, capped?: boolean, wantsShadow?: boolean, roomId?: string }>} list
 *   this frame's scored spot candidates
 * @param {{ slots: number, shadowSlots: number, cap: number, room?: (c: object) => string }} o
 *   slots: the pool size N; shadowSlots: S (slots with `shadowed`); cap: HOUSE.itemSpots[level]; room(c): its room id
 * @returns {Set<object>|null} the candidates allowed into _assignSpots (all of them get a seat), or null when no
 *   candidate is capped (the caller then runs today's path unchanged)
 */
export function planSpotSeats(list, { slots, shadowSlots, cap, room = (c) => c.roomId }) {
  const capped = list.filter((c) => c.capped);
  if (!capped.length) return null;
  const rank = (a, b) => b.score - a.score || byId(a, b);
  const base = list.filter((c) => !c.capped);
  // 1. today's seats without the spot category: the same rule as _assignSpots
  const sh = base.filter((c) => c.wantsShadow).sort(rank).slice(0, shadowSlots);
  const rest = base.filter((c) => !sh.includes(c)).sort(rank);
  const seated = [...sh, ...rest.slice(0, Math.max(0, slots - sh.length))];
  let free = slots - seated.length;
  // 2. per room the best `cap` capped candidates, best first
  const n = new Map(), kept = [];
  for (const c of [...capped].sort(rank)) {
    const r = room(c);
    if ((n.get(r) ?? 0) < cap) {
      n.set(r, (n.get(r) ?? 0) + 1);
      kept.push(c);
    }
  }
  // 3. free seats first (any room); 4. then the weakest non-shadow, non-capped seat of the candidate's OWN room
  const victims = new Set(), take = [];
  for (const c of kept) {
    if (free > 0) {
      free--;
      take.push(c);
      continue;
    }
    let v = null;
    for (const s of seated) if (room(s) === room(c) && !s.wantsShadow && !victims.has(s) && (!v || rank(s, v) > 0)) v = s;
    if (v) {
      victims.add(v);
      take.push(c);
    }
  }
  return new Set([...seated.filter((s) => !victims.has(s)), ...take]);
}
