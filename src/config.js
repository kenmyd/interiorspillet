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

/**
 * How much of the house the game shows (layout.js gameLayout). basement false (2026-10-22, the owner: too many bugs
 * down there for now): no basement, no stair down, no outside of the whole house (forecourt, entrance, the terrace
 * stair down to it), and the hall door is locked – the player stays in the living room and on the terrace. true: the
 * whole house (notes/hele-huset-design.md).
 */
export const HOUSE = Object.freeze({
  basement: false,
});

export const INTERACT = Object.freeze({
  /** Default max distance from the eye to an interactable surface. */
  range: 2.6,
});

/** Walkable-surface threshold: normal.y above this counts as ground. */
export const WALKABLE_NORMAL_Y = 0.62;
