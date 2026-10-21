/**
 * Global gameplay constants. Units: meters, seconds, radians.
 *
 * World axes (see SCAFFOLD.md): +x = plan right (south, the big windows), +z = plan down (west, TV-stue),
 * +y = up; origin = floor level at the top-left interior corner of plantegning.png.
 */
export const PLAYER = Object.freeze({
  /** Capsule radius. */
  radius: 0.3,
  /** Total standing height (feet to top of head). */
  height: 1.8,
  /** Eye height above the feet. */
  eyeHeight: 1.66,
  walkSpeed: 2.2,
  runSpeed: 4.6,
  backwardFactor: 0.7,
  strafeFactor: 0.85,
  jumpSpeed: 4.4,
  gravity: 18,
  /** Ground acceleration / damping. */
  groundAccel: 14,
  airAccel: 2.5,
  /** Keyboard turn speed when turnWithKeys is on (rad/s). */
  keyTurnSpeed: 2.4,
  /** Pitch limits. */
  minPitch: -1.45,
  maxPitch: 1.45,
  /** Collision sub-steps per frame. */
  substeps: 4,
});

export const INTERACT = Object.freeze({
  /** Default max distance from the eye to an interactable surface. */
  range: 2.6,
});

/** Walkable-surface threshold: normal.y above this counts as ground. */
export const WALKABLE_NORMAL_Y = 0.62;
