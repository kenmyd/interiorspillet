import * as THREE from 'three';

/**
 * Where the player sits on a chair, sofa, stool or pouf: anything on the floor whose model reports seatY (the top of
 * the seat, models/seating.js · textiles.js · kit block-outs). Models face local +z, the back is at −z.
 *
 *   seatFor(object, item, point?) → { eye: Vector3, yaw } | null
 *       object: the item's root (SceneSync.getObject), item: the DesignState item, point: the world point aimed at.
 *       Narrow seats: the middle. Wider than SEAT.wideFrom (sofas, benches): where you aim along the width, kept
 *       SEAT.edge from the ends. The eye sits SEAT.eyeAboveSeat over the seat, a little behind the middle of the
 *       depth (deep sofas and chaises: a fixed distance from the back). yaw looks out over the front.
 *   SEAT.reach   how far from the eye a seat can be aimed at (Selection.hoverSeat)
 *
 * PlayerController.sit / standUp move the camera; Game binds E.
 */
export const SEAT = Object.freeze({
  reach: 2.6,
  eyeAboveSeat: 0.74,
  minSeatY: 0.2,
  maxSeatY: 0.95,
  wideFrom: 1.15,
  edge: 0.32,
});

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();

export function seatFor(object, item, point = null) {
  const seatY = object?.userData?.model?.seatY;
  if (!item || item.mount !== 'floor' || !(seatY >= SEAT.minSeatY && seatY <= SEAT.maxSeatY)) return null;
  const w = item.dims?.w ?? 0.6;
  const d = item.dims?.d ?? 0.6;
  object.updateWorldMatrix(true, false);
  let x = 0;
  if (w > SEAT.wideFrom && point) {
    _p.copy(point);
    object.worldToLocal(_p);
    x = THREE.MathUtils.clamp(_p.x, -w / 2 + SEAT.edge, w / 2 - SEAT.edge);
  }
  const z = -d / 2 + THREE.MathUtils.clamp(0.45 * d, 0.2, 0.42);
  const eye = object.localToWorld(new THREE.Vector3(x, seatY + SEAT.eyeAboveSeat, z));
  _f.set(0, 0, 1).transformDirection(object.matrixWorld);
  return { eye, yaw: Math.atan2(-_f.x, -_f.z) };
}
