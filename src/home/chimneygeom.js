/**
 * CHIMNEY GEOMETRY – the chimneys of the house format (notes/tak.md «Piper»), without three.js: layout.js, the builder
 * (home/chimney.js) and the validator (data/scripts/house.mjs) read the same model.
 *
 *   resolveChimneys(raw, { levels, rooms, roofFields, groundY }) → { chimneys, issues }
 *
 * A chimney stands on the floor of the lowest room it is in (from: 'floor'; outside the house on the ground) and goes
 * up through the roof over it, or starts in that roof (from: 'roof'). Inside the house it is split per level (a box in
 * each room it passes, its own collider), the part above the roof's inner plane is the chimney seen outside. Plan
 * points are [x, z]; heights are world y.
 */
import { planeY } from './roofgeom.js';

export const CHIMNEY_MATERIALS = Object.freeze(['brick', 'render', 'steel']);
export const CHIMNEY_FROM = Object.freeze(['floor', 'roof']);
/** Defaults of the format (notes/tak.md). */
export const CHIMNEY_DEFAULTS = Object.freeze({
  size: Object.freeze({ brick: [0.5, 0.5], render: [0.5, 0.5], steel: [0.2, 0.2] }),
  color: Object.freeze({ brick: '#8a4b3c', render: '#d9d5cd', steel: '#2f3135' }),
  /** the inside: rendered and painted, a steel chimney is steel inside too */
  insideColor: '#ece9e3',
  flashingColor: '#3a3c40',
  /** without `top`: this far over the highest point of the roof covering round the chimney */
  above: 0.8,
  /** the round steel chimney: segments round */
  segments: 20,
});

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && p.every(num);

/** Even-odd point in polygon ([x, z] points; on an edge counts as inside). */
function inPolygon(x, z, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    if (Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) < 1e-6) return true;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * The chimneys of a house with every default filled in.
 * @param {object[]} raw  spec.chimneys (house format, notes/tak.md)
 * @param {{ levels: Array<{ id, floorY }>, rooms: Array<{ id, levelId, floorY, polygon: [x, z][] }>,
 *           roofFields: Object<string, { planeAt(x, z) }>, groundY: number }} ctx
 *   roofFields: the roof over each level (roofgeom.js roofField), planes with their `tv`
 * @returns {{ chimneys: object[], issues: Array<{ level: 'error'|'warn', where: string, msg: string }> }}
 *   a chimney: { id, name, material, round, color, insideColor, flashingColor, from, at, size, footprint,
 *   bottomY, topY, roofLevelId | null, pieces: [{ levelId, y0, y1 | null }] (inside; y1 null: up to the roof's inner
 *   plane), outsideLevelId, coverMin, coverMax, innerMin, innerMax }
 */
export function resolveChimneys(raw, { levels = [], rooms = [], roofFields = {}, groundY = -0.15 } = {}) {
  const issues = [];
  const chimneys = [];
  if (raw == null) return { chimneys, issues };
  if (!Array.isArray(raw)) {
    issues.push({ level: 'error', where: 'chimneys', msg: 'må være en liste' });
    return { chimneys, issues };
  }
  const sorted = [...levels].sort((a, b) => a.floorY - b.floorY);
  const ids = new Set();
  raw.forEach((c, i) => {
    const where = `chimneys/${c?.id ?? i}`;
    const err = (msg) => issues.push({ level: 'error', where, msg });
    const warn = (msg) => issues.push({ level: 'warn', where, msg });
    if (!c || typeof c !== 'object') return err('må være et objekt');
    const id = c.id ?? `pipe-${i + 1}`;
    if (ids.has(id)) return err('id-en er brukt av en annen pipe');
    ids.add(id);
    if (!isPt(c.at)) return err('at må være [x, z] (midten av pipa)');
    const material = c.material ?? 'brick';
    if (!CHIMNEY_MATERIALS.includes(material)) return err(`material «${material}» er ikke en av ${CHIMNEY_MATERIALS.join(', ')}`);
    const from = c.from ?? 'floor';
    if (!CHIMNEY_FROM.includes(from)) return err(`from «${from}» er ikke en av ${CHIMNEY_FROM.join(', ')}`);
    const size = c.size ?? CHIMNEY_DEFAULTS.size[material];
    if (!(Array.isArray(size) && size.length === 2 && size.every((v) => num(v) && v >= 0.08 && v <= 3))) return err('size må være [bredde (x), dybde (z)] i meter, 0,08–3');
    const round = material === 'steel';
    if (round && Math.abs(size[0] - size[1]) > 1e-6) warn('en stålpipe er rund – diameteren er den minste av size');
    const levelId = c.levelId ?? null;
    if (levelId != null && !levels.some((l) => l.id === levelId)) return err(`nivået «${levelId}» finnes ikke`);
    for (const k of ['top']) if (c[k] != null && !num(c[k])) return err(`${k} må være et tall (m)`);
    const [x, z] = c.at;
    const [w, d] = round ? [Math.min(...size), Math.min(...size)] : size;
    const footprint = [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
    // the roof it goes through: the lowest roof over its middle
    let roof = null;
    for (const [lid, field] of Object.entries(roofFields)) {
      const p = field?.planeAt(x, z);
      if (!p) continue;
      const y = planeY(p, x, z);
      if (!roof || y < roof.y) roof = { levelId: lid, field, y };
    }
    const probe = [...footprint, [x, z]];
    let innerMin = null, innerMax = null, coverMin = null, coverMax = null;
    if (roof) {
      const ins = [], covs = [];
      for (const q of probe) {
        const p = roof.field.planeAt(q[0], q[1]);
        if (!p) continue;
        ins.push(planeY(p, q[0], q[1]));
        covs.push(planeY(p, q[0], q[1]) + (p.tv ?? 0));
      }
      if (ins.length < probe.length) warn('pipa står på kanten av taket (en del av den er utenfor)');
      innerMin = Math.min(...ins);
      innerMax = Math.max(...ins);
      coverMin = Math.min(...covs);
      coverMax = Math.max(...covs);
    }
    // the bottom: the floor of the lowest room it stands in, the ground outside the house, or in the roof
    const under = rooms.filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && inPolygon(x, z, r.polygon) && (!roof || r.floorY < roof.y - 0.5));
    const lowest = under.sort((a, b) => a.floorY - b.floorY)[0] ?? null;
    let bottomY;
    if (from === 'roof') {
      if (!roof) return err("from: 'roof', men intet tak over pipa");
      bottomY = innerMin;
    } else bottomY = lowest ? lowest.floorY : groundY;
    // the top: over the floor of levelId, else over the ground; without one 0.8 over the roof round it
    let topY;
    if (c.top != null) topY = (levelId ? levels.find((l) => l.id === levelId).floorY : groundY) + c.top;
    else if (roof) topY = Math.ceil((coverMax + CHIMNEY_DEFAULTS.above) * 20 - 1e-6) / 20;
    else return err('pipa står ikke under et tak – gi top (høyden over bakken, eller over gulvet i levelId)');
    if (topY < bottomY + 0.5) return err(`toppen (${topY.toFixed(2)}) er under eller for nær bunnen (${bottomY.toFixed(2)})`);
    if (roof && topY < coverMax + 0.3) err(`toppen (${topY.toFixed(2)}) når ikke 0,3 m over taket (${coverMax.toFixed(2)} der pipa går gjennom)`);
    if (!roof) warn('pipa står ikke under et tak – den bygges som en frittstående pipe');
    // the pieces inside, one per level from the bottom up to the level the roof lies over (each up to the next floor,
    // the last up to the roof's inner plane)
    const pieces = [];
    if (from === 'floor' && roof && lowest) {
      const lo = levels.find((l) => l.id === lowest.levelId);
      const hiLevel = levels.find((l) => l.id === roof.levelId);
      const stack = sorted.filter((l) => l.floorY >= (lo?.floorY ?? -Infinity) - 1e-6 && l.floorY <= (hiLevel?.floorY ?? Infinity) + 1e-6);
      if (!stack.length || stack[stack.length - 1].id !== roof.levelId) {
        err(`pipa står i «${lowest.id}», som ikke er under taket den går gjennom (over «${roof.levelId}»)`);
        return;
      }
      stack.forEach((l, k) => {
        const y0 = k === 0 ? bottomY : l.floorY;
        const y1 = k === stack.length - 1 ? null : stack[k + 1].floorY;
        pieces.push({ levelId: l.id, y0, y1 });
      });
    }
    const outsideLevelId = roof?.levelId ?? lowest?.levelId ?? sorted[0]?.id ?? null;
    chimneys.push({
      id,
      name: c.name ?? '',
      index: i,
      material,
      round,
      color: c.color ?? CHIMNEY_DEFAULTS.color[material],
      insideColor: c.insideColor ?? (round ? c.color ?? CHIMNEY_DEFAULTS.color.steel : CHIMNEY_DEFAULTS.insideColor),
      flashingColor: c.flashingColor ?? CHIMNEY_DEFAULTS.flashingColor,
      from,
      at: [x, z],
      size: [w, d],
      footprint,
      levelId,
      bottomY,
      topY,
      roofLevelId: roof?.levelId ?? null,
      roomId: lowest?.id ?? null,
      pieces,
      outsideLevelId,
      innerMin,
      innerMax,
      coverMin,
      coverMax,
      source: c.source ?? '',
    });
  });
  return { chimneys, issues };
}
