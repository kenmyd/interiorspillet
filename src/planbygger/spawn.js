/**
 * Planbygger: where the player starts in a generated house – in the largest room of a level, at a free point: at least
 * FREE from the room's edges and from the furniture (the colliders' boxes, notes/moblering-genererte-hus.md: a sofa
 * stood where the room's lamp hung, and the player started inside it), the nearest such point to the room's middle; in a
 * room with no such point, its freest one. Plain data, no three.js: viewer.js and the 3D test (test-planbygger-
 * build3d.mjs) use the same.
 *
 *   spawnPoint(layout, { levelId, boxes }) → { room, position: [x, y, z], yaw, clear } | null
 *     layout  buildLayout's (layout.house: rooms with polygon [{ x, y }], centroid, area, floorY, levelId)
 *     boxes   [{ min: { x, y, z }, max: { x, y, z } }]: what the player collides with besides the walls (furniture)
 *     clear   metres from the point to the nearest room edge or box
 */
const FREE = 0.7;
const STEP = 0.15;
/** the player's height over the floor: boxes outside it (a rug, a shelf over the head) do not stop it */
const BODY = [0.05, 1.75];

function edgeDistance(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const L2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.y + dz * t)));
  }
  return best;
}

function inside(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export function spawnPoint(layout, { levelId = null, boxes = [] } = {}) {
  const H = layout.house;
  const lv = (levelId && H.levelsById[levelId]) || H.levelsById.hoved || H.levels[0];
  if (!lv) return null;
  const rooms = H.rooms.filter((r) => !r.hud && !r.outdoor && r.polygon.length >= 3 && r.levelId === lv.id && r.id !== 'stue-kjokken').sort((a, b) => b.area - a.area);
  const r = rooms[0];
  if (!r) return null;
  const y = r.floorY;
  const near = boxes.filter((b) => b.min.y < y + BODY[1] && b.max.y > y + BODY[0]);
  const boxDistance = (x, z) => {
    let best = Infinity;
    for (const b of near) best = Math.min(best, Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z)));
    return best;
  };
  const xs = r.polygon.map((p) => p.x);
  const zs = r.polygon.map((p) => p.y);
  const mid = [r.centroid.x, r.centroid.y];
  let best = null;
  let freest = null;
  for (let x = Math.min(...xs) + STEP / 2; x < Math.max(...xs); x += STEP) {
    for (let z = Math.min(...zs) + STEP / 2; z < Math.max(...zs); z += STEP) {
      if (!inside(x, z, r.polygon)) continue;
      // on the room's floor: not over a stair hole (hus11: the loft lounge round the stair)
      if (H.floorYAt) {
        const fy = H.floorYAt(x, z, y + 0.1);
        if (fy == null || Math.abs(fy - y) > 0.02) continue;
      }
      const clear = Math.min(edgeDistance(x, z, r.polygon), boxDistance(x, z));
      const d = Math.hypot(x - mid[0], z - mid[1]);
      if (!freest || clear > freest.clear) freest = { x, z, clear };
      if (clear >= FREE && (!best || d < best.d)) best = { x, z, clear, d };
    }
  }
  const p = best ?? freest;
  if (!p) return null;
  // look across the room (toward its far corner from the point)
  let far = null;
  let fd = -1;
  for (const q of r.polygon) {
    const d = Math.hypot(q.x - p.x, q.y - p.z);
    if (d > fd) {
      fd = d;
      far = q;
    }
  }
  const yaw = far ? Math.atan2(-(far.x - p.x), -(far.y - p.z)) : 0;
  return { room: r, position: [p.x, y, p.z], yaw, clear: p.clear };
}
