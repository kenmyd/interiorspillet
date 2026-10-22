/**
 * Feature hooks of Placement (design/lighting.md §5.5; MASTER §2.7):
 *
 *   wallSnap(placement, { wall, u, v, dims, archetype, uid, placing })
 *     → { u, v, note?, supportUid?, patch? } | null
 *     A wall item snapped to something on the same wall: a picture light (picture-light) over a picture, a canvas, a
 *     picture wall, an acoustic art panel or a mirror – centred over it, its bottom 3 cm above the frame, the item it
 *     rests over not counted as an overlap; while placing a new one its wash is sized to the picture (params washH,
 *     washW, artDepth – the ghost is rebuilt with them). Alt (no snap) places it freely.
 */

/** Wall items a picture light snaps over. */
const ART = new Set(['art-frame', 'art-set', 'acoustic-art', 'mirror']);
/** Gap between the top of the picture and the bottom of the picture light (m). */
const GAP = 0.03;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * A picture light over a picture on the same wall: centred over it, its bottom 3 cm above the frame, its wash sized to
 * the picture. Only when the cursor is near: within half the picture's width (≥ 40 cm) along the wall and 60 cm of
 * the snapped height.
 * @param {object} placement  design/Placement.js (its editor.design)
 * @param {{ wall: { id: string, sx: number, sz: number, dx: number, dz: number, fy: number }, u: number, v: number,
 *   dims: { w: number, d: number, h: number }, archetype: string, uid?: string, placing: boolean }} o
 *   u along the wall, v the item's centre height above the wall's floor
 * @returns {{ u: number, v: number, note: string, supportUid: string, patch: object|null } | null}
 */
export function wallSnap(placement, { wall, u, v, dims, archetype, uid, placing }) {
  if (archetype !== 'picture-light' || !wall || !dims) return null;
  const items = placement?.editor?.design?.list?.() ?? [];
  let best = null;
  for (const it of items) {
    if (it.uid === uid || it.hidden || it.mount !== 'wall' || it.attach?.wallId !== wall.id || !ART.has(it.archetype)) continue;
    if (!it.dims || !Array.isArray(it.position)) continue;
    const au = (it.position[0] - wall.sx) * wall.dx + (it.position[2] - wall.sz) * wall.dz;
    if (Math.abs(au - u) > Math.max(0.4, it.dims.w / 2)) continue;
    // a wall item's position is its centre; its top above the wall's floor
    const top = it.position[1] - (wall.fy || 0) + it.dims.h / 2;
    const want = top + GAP + dims.h / 2;
    const dv = Math.abs(want - v);
    if (dv > 0.6) continue;
    if (!best || dv < best.dv) best = { it, au, want, dv };
  }
  if (!best) return null;
  const a = best.it;
  return {
    u: r3(best.au),
    v: r3(best.want),
    note: a.archetype === 'mirror' ? 'over speilet' : 'over bildet',
    supportUid: a.uid,
    patch: placing
      ? { params: { washH: r2(clamp(a.dims.h + 0.06, 0.2, 1.6)), washW: r2(clamp(a.dims.w + 0.06, 0.2, 2.2)), artDepth: r3(clamp(a.dims.d ?? 0.04, 0, 0.1)) } }
      : null,
  };
}
