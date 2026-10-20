import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { PLAYER, WALKABLE_NORMAL_Y } from '../config.js';

/**
 * First-person character controller.
 *
 * CONTRACT (used by Game.js):
 *   new PlayerController({ camera, collision, input, settings, events })
 *   teleport(positionFeet: Vector3, yaw, pitch)
 *   update(dt)            read input, integrate, collide (collision.resolveCapsule), place camera
 *   position: Vector3     feet position (read-only for others)
 *   yaw, pitch: number    yaw 0 = looking along -z (north); + yaw turns left (THREE convention, rotation.y)
 *   velocity: Vector3, onGround: boolean, surface: string|null
 *   getState() → { speed, onGround, running, moving, justLanded, landImpact, lookDelta:{x,y}, pitch, time, bobPhase }
 *   Emits on events: 'footstep' {surface, running}, 'jump' {surface}, 'land' {surface, impact}
 *
 * Extras: crouching (boolean), inWater (boolean), respawn(), getState() also carries crouch, crouching,
 * justJumped, verticalSpeed, airTime, inWater, surface, bobAmount, yaw.
 *
 * How a frame works:
 *   1. look (mouse delta + keyboard turning), crouch state
 *   2. horizontal velocity eases toward the wish velocity (ground: fast, air: limited control)
 *   3. N sub-steps (≥ PLAYER.substeps, more when moving fast) each doing
 *        a) horizontal move, clipped against steep terrain first (it acts as a vertical wall, _clipTerrainWall)
 *           → resolveCapsule → step-up attempt when blocked on the ground → walkability check (deep water /
 *           world bounds) → clip velocity against walls (slide)
 *        b) vertical move (gravity) → resolveCapsule → ground / ceiling handling → ground snap when we were
 *           grounded and lost contact without jumping (walking down steps and slopes)
 *        c) walkability check for the whole sub-step (pushes in b can move us sideways too)
 *   4. footsteps and head bob from the distance walked along our own velocity (being shoved is not walking),
 *      landing, camera placement, safety respawn (void, NaN, stuck, deep water, trapped in water).
 * Moving horizontally and vertically in separate passes keeps floor contacts out of the wall normals (the
 * octree reports one combined push per call) and makes ground detection stable.
 */

/** Tuning that is private to the controller (shared gameplay constants live in config.js PLAYER). */
export const MOVE = Object.freeze({
  crouchHeight: 1.3,
  crouchEyeHeight: 1.15,
  crouchSpeedFactor: 0.48,
  /** 1/s – how fast the eye moves between standing and crouched heights. */
  crouchRate: 8,
  /** 1/s – braking when there is no movement input on the ground (groundAccel is used while steering). */
  groundFriction: 12,
  /** Highest ledge climbed without jumping (door thresholds, plinth step, stairs later). */
  stepHeight: 0.3,
  /** How far down we search for ground to stay glued when walking down steps/slopes. */
  snapDistance: 0.26,
  /** Jump is still allowed this long after walking off an edge. */
  coyoteTime: 0.12,
  /** A jump pressed this long before landing still triggers. */
  jumpBuffer: 0.12,
  /** No ground snapping right after a jump. */
  jumpSnapLock: 0.25,
  maxFallSpeed: 40,
  /** Max displacement per sub-step (m). Must stay well below radius and wall thickness (0.2 m). */
  maxSubstepMove: 0.08,
  maxSubsteps: 24,
  /**
   * Walking straight up the steepest walkable slope keeps (1 - uphillSlowdown) of the speed; gentler slopes
   * and diagonal climbs scale linearly. Downhill and flat ground are unaffected.
   */
  uphillSlowdown: 0.45,
  /** Speed factor once the feet are ~0.3 m under water. */
  waterSpeedFactor: 0.6,
  strideWalk: 0.75,
  strideRun: 1.1,
  strideCrouch: 0.6,
  /** Head bob amplitudes at walking speed (m). Scaled with speed, capped at 1.6×. */
  bobVertical: 0.016,
  bobLateral: 0.011,
  /** Landing dip spring. */
  dipStiffness: 140,
  dipDamping: 17,
  respawnY: -30,
  /** Seconds of being pushed around by geometry without making progress before we respawn. */
  stuckTime: 1.25,
  /** Steep terrain closer than this below the feet counts as touching them (see _clipTerrainWall). */
  terrainContactMargin: 0.01,
  /** Seconds on unwalkable ground (deeper than wading depth, outside the bounds) before we respawn. */
  deepWaterTime: 1.5,
  /** Trying to walk this long in water deeper than waterTrapDepth without getting 1 m anywhere → respawn. */
  waterTrapTime: 4,
  waterTrapDepth: 0.3,
});

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _before = new THREE.Vector3();
const _saveCap = new Capsule();
const _trialCap = new Capsule();
const _testCap = new Capsule();
const _walls = Array.from({ length: 8 }, () => new THREE.Vector3());
const _terrainWalls = [new THREE.Vector3(), new THREE.Vector3()];
const _move = new THREE.Vector3();
const _tn = new THREE.Vector3();

export class PlayerController {
  /**
   * @param {object} o
   * @param {THREE.PerspectiveCamera} o.camera     world camera (rotation order 'YXZ')
   * @param {import('../core/Collision.js').CollisionWorld} o.collision
   * @param {import('../core/Input.js').Input} o.input
   * @param {import('../core/Settings.js').Settings} o.settings
   * @param {import('../core/Events.js').Emitter} o.events
   */
  constructor({ camera, collision, input, settings, events }) {
    this.camera = camera;
    this.collision = collision;
    this.input = input;
    this.settings = settings;
    this.events = events;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.surface = null;
    this.crouching = false;
    this.inWater = false;

    const r = PLAYER.radius;
    this.height = PLAYER.height;
    this.capsule = new Capsule(new THREE.Vector3(0, r, 0), new THREE.Vector3(0, PLAYER.height - r, 0), r);

    this._time = 0;
    this._crouchAmt = 0; // 0 standing … 1 crouched (eased eye height)
    this._sinceGround = 0; // seconds since last ground contact
    this._airTime = 0;
    this._jumpBufferT = 0;
    this._jumpLockT = 0;
    this._jumped = false; // jumped since last ground contact (no coyote double jump)
    this._fallSpeed = 0; // downward speed just before the last ground contact
    this._groundNormal = new THREE.Vector3(0, 1, 0);
    this._wallCount = 0;
    this._terrainWallCount = 0;
    this._stepFailed = false; // a step-up attempt already failed this frame
    this._stepSmooth = 0; // camera offset that hides instant step-ups / snaps
    this._stepDist = 0; // distance since last footstep
    this._bobPhase = 0;
    this._bobAmt = 0;
    this._idleT = 0;
    this._speed = 0; // smoothed actual horizontal speed
    this._dip = 0;
    this._dipVel = 0;
    this._excessPush = 0;
    this._stuckT = 0;
    this._deepT = 0; // seconds spent on unwalkable ground
    this._trapT = 0; // seconds spent in water trying to walk without getting anywhere
    this._trapAnchor = new THREE.Vector3();
    this._safe = new THREE.Vector3();
    this._spawn = null; // first teleport target, the fallback when the safe point is unusable
    this._spawnYaw = 0;
    this._safeYaw = 0;
    this._safeT = 0;
    this._hasSafe = false;

    this._state = {
      speed: 0,
      onGround: false,
      running: false,
      moving: false,
      crouching: false,
      crouch: 0,
      justLanded: false,
      justJumped: false,
      landImpact: 0,
      lookDelta: { x: 0, y: 0 },
      pitch: 0,
      yaw: 0,
      time: 0,
      bobPhase: 0,
      bobAmount: 0,
      verticalSpeed: 0,
      airTime: 0,
      inWater: false,
      surface: null,
    };
  }

  /* ------------------------------------------------------------------ public */

  /**
   * Put the player somewhere (feet position) and stop all motion.
   * @param {THREE.Vector3} pos  feet position
   * @param {number} [yaw]       radians, 0 = north (-z), + = turned left
   * @param {number} [pitch]     radians, + = looking up
   */
  teleport(pos, yaw = 0, pitch = 0) {
    this.position.copy(pos);
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, PLAYER.minPitch, PLAYER.maxPitch);
    this.velocity.set(0, 0, 0);
    this.crouching = false;
    this._crouchAmt = 0;
    this.height = PLAYER.height;
    this._jumpBufferT = 0;
    this._jumpLockT = 0;
    this._sinceGround = 0;
    this._airTime = 0;
    this._stepSmooth = 0;
    this._dip = this._dipVel = 0;
    this._speed = 0;
    this._stuckT = 0;
    this._deepT = 0;
    this._safeT = 0;
    this._trapT = 0;
    this._trapAnchor.copy(pos);
    if (!this._spawn) {
      this._spawn = pos.clone();
      this._spawnYaw = yaw;
    }
    // a teleport target counts as safe ground only if one can stand there (not deep water, not the void)
    if (this._isSafeSpot(pos)) {
      this._safe.copy(pos);
      this._safeYaw = yaw;
      this._hasSafe = true;
    }
    this._syncCapsule();
    this._placeCamera(0);
  }

  /** Move back to the last position where we stood safely on the ground, facing the way we faced there. */
  respawn(reason = '') {
    let yaw = this.yaw;
    if (this._hasSafe && this._isSafeSpot(this._safe)) {
      _v.copy(this._safe);
      yaw = this._safeYaw;
    } else if (this._spawn && this._isSafeSpot(this._spawn)) {
      _v.copy(this._spawn);
      yaw = this._spawnYaw;
    } else if (!this._findLand(this.position, _v)) {
      if (this._spawn) _v.copy(this._spawn);
      else _v.set(0, 2, 0);
    }
    _v.y += 0.05;
    this.teleport(_v, Number.isFinite(yaw) ? yaw : 0, 0);
    if (reason) this.events?.emit('toast', { text: reason, seconds: 3 });
  }

  getState() {
    return this._state;
  }

  /** Is this feet position good for (re)spawning: finite, inside the world, on walkable ground, not in water? */
  _isSafeSpot(p) {
    const col = this.collision;
    return (
      Number.isFinite(p.x + p.y + p.z) && p.y > MOVE.respawnY + 1 && p.y >= col.waterLevel && col.isWalkable(p.x, p.z)
    );
  }

  /**
   * Nearest dry walkable terrain point around a position (rings of 16 directions, 1 m apart, up to 60 m),
   * feet on the terrain. Last resort for respawning when neither the last safe point nor the spawn is usable.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} out
   * @returns {boolean} true if found (written into out)
   */
  _findLand(from, out) {
    const col = this.collision;
    if (!col.heightfield || !Number.isFinite(from.x + from.z)) return false;
    for (let r = 1; r <= 60; r++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
        if (!col.isWalkable(x, z)) continue;
        const h = col.groundHeight(x, z);
        if (h < col.waterLevel) continue; // dry land, not the shallows
        out.set(x, h, z);
        return true;
      }
    }
    return false;
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const inp = this.input;
    const s = this._state;
    this._time += dt;
    s.justLanded = false;
    s.justJumped = false;
    s.landImpact = 0;
    this._stepFailed = false;
    this._excessPush = 0;

    // ---- 1. look
    const turn = (inp.turn || 0) * PLAYER.keyTurnSpeed * dt;
    const lookX = (inp.lookDelta?.x || 0) + turn;
    const lookY = inp.lookDelta?.y || 0;
    this.yaw = wrapAngle(this.yaw - lookX);
    this.pitch = THREE.MathUtils.clamp(this.pitch + lookY, PLAYER.minPitch, PLAYER.maxPitch);
    s.lookDelta.x = lookX;
    s.lookDelta.y = lookY;

    // ---- 2. crouch
    this._updateCrouch(!!inp.crouch, dt);

    // ---- 3. wish velocity
    const waterDepth = this.collision.waterLevel - this.position.y;
    this.inWater = waterDepth > 0;
    let f = inp.move?.forward || 0;
    let r = inp.move?.right || 0;
    const len = Math.hypot(f, r);
    if (len > 1) {
      f /= len;
      r /= len;
    }
    const hasInput = len > 0.01;
    const running = !!inp.running && !this.crouching;
    let speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    if (this.crouching) speed = PLAYER.walkSpeed * MOVE.crouchSpeedFactor;
    if (this.inWater) speed *= THREE.MathUtils.lerp(1, MOVE.waterSpeedFactor, smoothstep(0, 0.3, waterDepth));
    f *= f < 0 ? PLAYER.backwardFactor : 1;
    r *= PLAYER.strafeFactor;
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish.copy(_fwd).multiplyScalar(f * speed).addScaledVector(_right, r * speed);
    if (this.onGround && hasInput) this._slopeSlowdown(_wish);

    const v = this.velocity;
    if (this.onGround) {
      const k = 1 - Math.exp(-(hasInput ? PLAYER.groundAccel : MOVE.groundFriction) * dt);
      v.x += (_wish.x - v.x) * k;
      v.z += (_wish.z - v.z) * k;
    } else if (hasInput) {
      // limited air control: steer toward the wish velocity, never brake below the current speed
      const k = 1 - Math.exp(-PLAYER.airAccel * dt);
      const before = Math.hypot(v.x, v.z);
      v.x += (_wish.x - v.x) * k;
      v.z += (_wish.z - v.z) * k;
      const after = Math.hypot(v.x, v.z);
      const keep = Math.max(before, Math.hypot(_wish.x, _wish.z));
      if (after > keep && after > 1e-6) {
        v.x *= keep / after;
        v.z *= keep / after;
      }
    }
    if (Math.abs(v.x) < 1e-4) v.x = 0;
    if (Math.abs(v.z) < 1e-4) v.z = 0;

    // ---- 4. jump
    if (inp.jumpPressed) this._jumpBufferT = MOVE.jumpBuffer;
    const canJump = (this.onGround || this._sinceGround < MOVE.coyoteTime) && !this._jumped;
    if (this._jumpBufferT > 0 && canJump) {
      v.y = PLAYER.jumpSpeed * (this.inWater ? 0.8 : 1);
      this.onGround = false;
      this._jumped = true;
      this._jumpBufferT = 0;
      this._jumpLockT = MOVE.jumpSnapLock;
      s.justJumped = true;
      this.events?.emit('jump', { surface: this.surface ?? 'wood' });
    }
    this._jumpBufferT = Math.max(0, this._jumpBufferT - dt);
    this._jumpLockT = Math.max(0, this._jumpLockT - dt);

    // ---- 5. integrate in sub-steps
    const wasGroundedFrame = this.onGround;
    const startX = this.position.x, startY = this.position.y, startZ = this.position.z;
    const travel = Math.max(Math.hypot(v.x, v.z), Math.abs(v.y) + PLAYER.gravity * dt) * dt;
    const steps = Math.min(MOVE.maxSubsteps, Math.max(PLAYER.substeps, Math.ceil(travel / MOVE.maxSubstepMove)));
    const h = dt / steps;
    let grounded = this.onGround;
    let landingSpeed = 0;
    for (let i = 0; i < steps; i++) {
      const res = this._substep(h, grounded);
      if (res.landed) landingSpeed = Math.max(landingSpeed, res.impactSpeed);
      grounded = res.grounded;
    }
    this.onGround = grounded;
    this._readPosition();

    // ---- 6. bookkeeping: ground, landing, safety
    if (this.onGround) {
      if (!wasGroundedFrame && (this._airTime > 0.2 || landingSpeed > 2.5)) {
        const impact = THREE.MathUtils.clamp((landingSpeed - 1) / 8, 0, 1);
        s.justLanded = true;
        s.landImpact = impact;
        if (this.settings?.get?.('headBob') !== false && this.settings?.get?.('physicalBody') !== false) this._dipVel -= 0.25 + landingSpeed * 0.09;
        this.events?.emit('land', { surface: this.surface ?? 'wood', impact, speed: landingSpeed });
      }
      this._sinceGround = 0;
      this._airTime = 0;
      this._jumped = false;
    } else {
      this._sinceGround += dt;
      this._airTime += dt;
    }
    // shallow water: feet below the water level → wading (slower next frame, splashing footsteps)
    this.inWater = this.position.y < this.collision.waterLevel;
    if (this.inWater) this.surface = 'water';

    const dx = this.position.x - startX, dz = this.position.z - startZ;
    const moved = Math.hypot(dx, dz);
    // Walking progress = displacement along our own velocity. Being shoved around by geometry (a closing door,
    // jitter against an obstacle) is not walking: no footsteps, no head bob, no hand bob.
    const hv = Math.hypot(v.x, v.z);
    const walked = hv > 1e-3 ? Math.min(moved, Math.max(0, (dx * v.x + dz * v.z) / hv)) : 0;
    const actualSpeed = walked / dt;
    this._speed += (actualSpeed - this._speed) * (1 - Math.exp(-12 * dt));
    if (this._speed < 0.02) this._speed = 0;

    this._updateSafety(dt, moved + Math.abs(this.position.y - startY), hasInput);

    // ---- 7. footsteps + head bob
    const isRunStep = running && this._speed > PLAYER.walkSpeed * 1.2;
    const stride = this.crouching ? MOVE.strideCrouch : isRunStep ? MOVE.strideRun : MOVE.strideWalk;
    if (this.onGround && walked > 1e-4) {
      this._idleT = 0;
      this._stepDist += walked;
      this._bobPhase += (Math.PI * walked) / stride;
      if (this._stepDist >= stride) {
        this._stepDist %= stride;
        this.events?.emit('footstep', { surface: this.surface ?? 'wood', running: isRunStep, crouch: !!this.crouching });
      }
    } else if (this.onGround) {
      this._idleT += dt;
      // after standing still the next first step comes a little sooner (feels responsive)
      if (this._idleT > 0.35) this._stepDist = Math.max(this._stepDist, stride * 0.55);
    }
    const bobTarget = this.onGround ? Math.min(1.6, this._speed / PLAYER.walkSpeed) : 0;
    this._bobAmt += (bobTarget - this._bobAmt) * (1 - Math.exp(-7 * dt));

    // landing dip spring (critically-ish damped)
    const acc = -MOVE.dipStiffness * this._dip - MOVE.dipDamping * this._dipVel;
    this._dipVel += acc * dt;
    this._dip = THREE.MathUtils.clamp(this._dip + this._dipVel * dt, -0.2, 0.08);
    this._stepSmooth *= Math.exp(-13 * dt);
    if (Math.abs(this._stepSmooth) < 1e-4) this._stepSmooth = 0;

    this._placeCamera(dt);

    // ---- 8. state for the viewmodel / HUD
    s.speed = this._speed;
    s.onGround = this.onGround;
    s.running = isRunStep;
    s.moving = this._speed > 0.15;
    s.crouching = this.crouching;
    s.crouch = this._crouchAmt;
    s.pitch = this.pitch;
    s.yaw = this.yaw;
    s.time = this._time;
    s.bobPhase = this._bobPhase;
    s.bobAmount = this._bobAmt;
    s.verticalSpeed = v.y;
    s.airTime = this._airTime;
    s.inWater = this.inWater;
    s.surface = this.surface;
  }

  /* ------------------------------------------------------------------ movement internals */

  /**
   * One collision sub-step.
   * @returns {{grounded:boolean, landed:boolean, impactSpeed:number}}
   */
  _substep(h, wasGrounded) {
    const cap = this.capsule;
    const v = this.velocity;
    const col = this.collision;
    const out = this._subRes ?? (this._subRes = { grounded: false, landed: false, impactSpeed: 0 });
    out.landed = false;
    out.impactSpeed = 0;

    const sx0 = cap.start.x, sz0 = cap.start.z;

    // ---- a) horizontal
    const dx0 = v.x * h, dz0 = v.z * h;
    const want = Math.hypot(dx0, dz0);
    if (want > 1e-7) {
      const sx = sx0, sz = sz0;
      _saveCap.copy(cap);
      // Steep terrain acts as a vertical wall (see _clipTerrainWall): never let the heightfield push us up it.
      const terrainHit = this._clipTerrainWall(dx0, dz0);
      const dx = terrainHit ? _move.x : dx0, dz = terrainHit ? _move.z : dz0;
      _v.set(dx, 0, dz);
      cap.translate(_v);
      _before.copy(cap.start);
      const res = col.resolveCapsule(cap);
      this._copyWalls(res);
      this._trackPush(_before, cap.start, Math.hypot(dx, dz));
      let progress = ((cap.start.x - sx) * dx0 + (cap.start.z - sz) * dz0) / want;

      // blocked while on the ground → try to step up onto the obstacle (thresholds, kerbs, stairs, a low
      // terrain ledge with walkable ground on top)
      let steppedUp = false;
      if ((wasGrounded || this._sinceGround < 0.05) && progress < want * 0.6 && !this._stepFailed) {
        if (this._tryStepUp(dx0, dz0, want, progress)) {
          steppedUp = true;
          this._wallCount = 0;
        } else {
          this._stepFailed = true;
        }
      }

      // walkable area (deep water / world bounds): slide along the edge, never walk into it
      this._keepWalkable(sx, sz);

      // slide along steep terrain like along a vertical wall
      if (terrainHit && !steppedUp) {
        for (let i = 0; i < this._terrainWallCount; i++) clipHorizontal(v, _terrainWalls[i]);
      }

      // slide: remove the velocity component going into walls
      for (let i = 0; i < this._wallCount; i++) {
        const n = _walls[i];
        // on the ground only clip against real walls; rounded edges (|n.y| larger) are handled by the push
        if (wasGrounded && Math.abs(n.y) > 0.35) continue;
        const hl = Math.hypot(n.x, n.z);
        if (hl < 1e-4) continue;
        const nx = n.x / hl, nz = n.z / hl;
        const into = v.x * nx + v.z * nz;
        if (into < 0) {
          v.x -= nx * into;
          v.z -= nz * into;
        }
      }
    }

    // ---- b) vertical
    v.y = Math.max(v.y - PLAYER.gravity * h, -MOVE.maxFallSpeed);
    const fallSpeed = -v.y;
    _v.set(0, v.y * h, 0);
    cap.translate(_v);
    _before.copy(cap.start);
    const res = col.resolveCapsule(cap);
    let grounded = res.onGround && v.y <= 0.01;
    this._copyWalls(res);
    if (res.onGround) {
      this._groundNormal.copy(res.groundNormal);
      this.surface = res.surface;
      this._verticalizeGroundPush(res, _before);
    }
    this._trackPush(_before, cap.start, Math.abs(v.y * h));

    // ceiling: kill upward speed
    if (v.y > 0) {
      for (let i = 0; i < this._wallCount; i++) {
        if (_walls[i].y < -0.3) {
          v.y = 0;
          break;
        }
      }
    }

    if (grounded) {
      if (!wasGrounded) {
        out.landed = true;
        out.impactSpeed = fallSpeed;
      }
      if (v.y < 0) v.y = 0;
    } else if (wasGrounded && this._jumpLockT <= 0 && v.y <= 0) {
      // walking down a step or slope: stay glued to the ground
      if (this._snapDown()) {
        grounded = true;
        v.y = 0;
      }
    }

    // The vertical pass (a push off steep terrain, an octree edge) and the ground snap can move us sideways
    // too – the walkable-area rule applies to the whole sub-step, not only to our own horizontal move.
    this._keepWalkable(sx0, sz0);

    out.grounded = grounded;
    return out;
  }

  /**
   * Steep terrain (normal.y < WALKABLE_NORMAL_Y) behaves like a vertical wall.
   *
   * The heightfield collision treats steep terrain as a plane through the ground point under the capsule and
   * pushes the sphere out along the slope normal until it is a full radius away from that plane – for a foot
   * resting on the slope that is a jump of radius·(1 − normal.y) ≈ 11 cm, back and up. Walking into a rock face
   * therefore crept up it and got thrown back every few frames (saw-tooth camera, footsteps on the spot).
   * So we never step onto a spot where steep terrain would touch the feet: the move is clipped against the
   * slope (its horizontal normal) to slide along it, or shortened to the last free point.
   * Writes the allowed move into _move and the wall normal (horizontal, unit) into _terrainWalls.
   * @returns {boolean} true if steep terrain was in the way
   */
  _clipTerrainWall(dx, dz) {
    this._terrainWallCount = 0;
    _move.set(dx, 0, dz);
    const hf = this.collision.heightfield;
    if (!hf) return false;
    const c = this.capsule.start;
    // the feet touch the terrain when it is above this height (margin: the gravity step of the vertical pass)
    const contactY = c.y - this.capsule.radius - MOVE.terrainContactMargin;
    // already touching steep terrain (landed on a slope, teleported): the collision push sorts that out
    if (!this._terrainFree(c.x, c.z, contactY)) return false;
    if (this._terrainFree(c.x + dx, c.z + dz, contactY)) return false;

    // slide along the slope
    hf.getNormal(c.x + dx, c.z + dz, _tn);
    const hl = Math.hypot(_tn.x, _tn.z);
    if (hl > 1e-6) {
      const n = _terrainWalls[this._terrainWallCount++].set(_tn.x / hl, 0, _tn.z / hl);
      const into = dx * n.x + dz * n.z;
      if (into < 0) {
        const mx = dx - n.x * into, mz = dz - n.z * into;
        if (this._terrainFree(c.x + mx, c.z + mz, contactY)) {
          _move.set(mx, 0, mz);
          return true;
        }
      }
    }
    // no free slide (concave corner, slope edge-on): go as far as the terrain allows along the original move
    let lo = 0, hi = 1;
    for (let k = 0; k < 5; k++) {
      const mid = (lo + hi) * 0.5;
      if (this._terrainFree(c.x + dx * mid, c.z + dz * mid, contactY)) lo = mid;
      else hi = mid;
    }
    _move.set(dx * lo, 0, dz * lo);
    return true;
  }

  /** May the capsule centre stand at (x, z) without steep terrain touching feet at contactY? */
  _terrainFree(x, z, contactY) {
    const hf = this.collision.heightfield;
    if (!(hf.getHeight(x, z) > contactY)) return true;
    return hf.getNormal(x, z, _tn).y >= WALKABLE_NORMAL_Y;
  }

  /**
   * Deep water / world bounds: never move from walkable onto unwalkable ground; slide along the edge
   * (axis-separated) when one axis alone is fine. When we already are on unwalkable ground (fell in, were
   * pushed in, teleported) only moves that get us out – toward shallower water / back inside the bounds –
   * are allowed. Removes the blocked velocity components.
   * @param {number} sx  capsule x before the move
   * @param {number} sz  capsule z before the move
   * @returns {boolean} true if the position was corrected
   */
  _keepWalkable(sx, sz) {
    const col = this.collision;
    const c = this.capsule.start;
    const nx = c.x, nz = c.z;
    if ((nx === sx && nz === sz) || col.isWalkable(nx, nz)) return false;
    const v = this.velocity;
    if (!col.isWalkable(sx, sz)) {
      const outS = outsideBounds(col.bounds, sx, sz), outN = outsideBounds(col.bounds, nx, nz);
      const better = outS > 0 ? outN < outS : outN <= 0 && col.groundHeight(nx, nz) >= col.groundHeight(sx, sz);
      if (better) return false;
      this._setCapsuleXZ(sx, sz);
      v.x = v.z = 0;
      return true;
    }
    if (col.isWalkable(sx, nz)) {
      this._setCapsuleXZ(sx, nz);
      v.x = 0;
    } else if (col.isWalkable(nx, sz)) {
      this._setCapsuleXZ(nx, sz);
      v.z = 0;
    } else {
      this._setCapsuleXZ(sx, sz);
      v.x = v.z = 0;
    }
    return true;
  }

  /**
   * Classic step-up: from the pre-move position lift by stepHeight, move, drop back down.
   * Accepts the result only if it lands on walkable ground and gets further than the plain move.
   */
  _tryStepUp(dx, dz, want, plainProgress) {
    const col = this.collision;
    const sx = _saveCap.start.x, sy = _saveCap.start.y, sz = _saveCap.start.z;
    _trialCap.copy(_saveCap);
    _trialCap.translate(_v.set(0, MOVE.stepHeight, 0));
    col.resolveCapsule(_trialCap);
    const lifted = _trialCap.start.y - sy;
    if (lifted < 0.04) return false; // no headroom
    _trialCap.translate(_v.set(dx, 0, dz));
    col.resolveCapsule(_trialCap);
    _trialCap.translate(_v.set(0, -(lifted + 0.03), 0));
    const res = col.resolveCapsule(_trialCap);
    if (!res.onGround || res.groundNormal.y < WALKABLE_NORMAL_Y) return false;
    const climbed = _trialCap.start.y - sy;
    if (climbed > MOVE.stepHeight + 0.01 || climbed < -0.02) return false;
    const progress = ((_trialCap.start.x - sx) * dx + (_trialCap.start.z - sz) * dz) / want;
    if (progress < plainProgress + want * 0.25) return false;
    if (!col.isWalkable(_trialCap.start.x, _trialCap.start.z)) return false;
    this.capsule.copy(_trialCap);
    this.surface = res.surface;
    this._groundNormal.copy(res.groundNormal);
    if (climbed > 0.01) this._stepSmooth = Math.max(-0.35, this._stepSmooth - climbed);
    return true;
  }

  /** Move down up to snapDistance onto walkable ground. Returns true (and keeps the move) on success. */
  _snapDown() {
    const cap = this.capsule;
    _trialCap.copy(cap);
    const y0 = cap.start.y;
    cap.translate(_v.set(0, -MOVE.snapDistance, 0));
    _before.copy(cap.start);
    const res = this.collision.resolveCapsule(cap);
    if (!res.onGround || res.groundNormal.y < WALKABLE_NORMAL_Y || cap.start.y > y0 + 0.001) {
      cap.copy(_trialCap);
      return false;
    }
    this.surface = res.surface;
    this._groundNormal.copy(res.groundNormal);
    this._verticalizeGroundPush(res, _before);
    const drop = y0 - cap.start.y;
    if (drop > 0.04) this._stepSmooth = Math.min(0.35, this._stepSmooth + drop);
    return true;
  }

  /**
   * On sloped static geometry the octree pushes along the surface normal, which would make the player slide
   * downhill while standing still. Replace that push with the equivalent purely vertical one.
   */
  _verticalizeGroundPush(res, before) {
    if (res.groundSource === 'terrain' || res.wallCount > 0) return;
    const n = res.groundNormal;
    if (n.y > 0.999 || n.y < WALKABLE_NORMAL_Y) return;
    const cap = this.capsule;
    const px = cap.start.x - before.x, py = cap.start.y - before.y, pz = cap.start.z - before.z;
    if (Math.abs(px) + Math.abs(pz) < 1e-7) return;
    const depth = Math.hypot(px, py, pz);
    cap.translate(_v.set(-px, depth / n.y - py, -pz));
  }

  /**
   * Climbing is slower: scale the wish velocity by how steep the ground is and how much of the motion goes
   * uphill (the horizontal part of the ground normal points downhill).
   */
  _slopeSlowdown(wish) {
    const n = this._groundNormal;
    const steep = Math.min(1, (1 - n.y) / (1 - WALKABLE_NORMAL_Y));
    if (steep < 0.02) return;
    const hl = Math.hypot(n.x, n.z);
    const wl = Math.hypot(wish.x, wish.z);
    if (hl < 1e-4 || wl < 1e-4) return;
    const uphill = -(n.x * wish.x + n.z * wish.z) / (hl * wl);
    if (uphill > 0) wish.multiplyScalar(1 - MOVE.uphillSlowdown * steep * uphill);
  }

  _updateCrouch(want, dt) {
    if (want && !this.crouching) {
      this.crouching = true;
      this._setHeight(MOVE.crouchHeight);
    } else if (!want && this.crouching && this._canStand()) {
      this.crouching = false;
      this._setHeight(PLAYER.height);
    }
    const target = this.crouching ? 1 : 0;
    const step = MOVE.crouchRate * dt;
    this._crouchAmt += THREE.MathUtils.clamp(target - this._crouchAmt, -step, step);
  }

  /** Is there room above the crouched capsule to stand up? */
  _canStand() {
    const r = PLAYER.radius;
    const feet = this.capsule.start.y - r;
    const tr = r - 0.04; // a bit thinner so touching walls don't count
    _testCap.start.set(this.capsule.start.x, feet + MOVE.crouchHeight - tr, this.capsule.start.z);
    _testCap.end.set(this.capsule.start.x, feet + PLAYER.height - tr, this.capsule.start.z);
    _testCap.radius = tr;
    const sx = _testCap.start.x, sy = _testCap.start.y, sz = _testCap.start.z;
    this.collision.resolveCapsule(_testCap);
    return Math.abs(_testCap.start.x - sx) + Math.abs(_testCap.start.y - sy) + Math.abs(_testCap.start.z - sz) < 0.004;
  }

  _setHeight(height) {
    this.height = height;
    const r = PLAYER.radius;
    this.capsule.end.set(this.capsule.start.x, this.capsule.start.y - r + height - r, this.capsule.start.z);
  }

  _setCapsuleXZ(x, z) {
    const c = this.capsule;
    c.start.x = c.end.x = x;
    c.start.z = c.end.z = z;
  }

  _syncCapsule() {
    const r = PLAYER.radius;
    this.capsule.radius = r;
    this.capsule.start.set(this.position.x, this.position.y + r, this.position.z);
    this.capsule.end.set(this.position.x, this.position.y + this.height - r, this.position.z);
  }

  _readPosition() {
    const c = this.capsule.start;
    this.position.set(c.x, c.y - PLAYER.radius, c.z);
  }

  _copyWalls(res) {
    const n = Math.min(res.wallCount, _walls.length);
    for (let i = 0; i < n; i++) _walls[i].copy(res.wallNormals[i]);
    this._wallCount = n;
  }

  /** Accumulate collision pushes that are larger than our own motion explains (stuck detection). */
  _trackPush(before, after, expected) {
    const push = before.distanceTo(after);
    this._excessPush += Math.max(0, push - expected - 0.004);
  }

  /**
   * Respawn when something went wrong (NaN, fell out of the world, stuck in geometry, in deep water, trapped
   * in water) and remember the last safe ground position.
   * @param {number} dt
   * @param {number} frameMotion  distance moved this frame (m)
   * @param {boolean} wantsToMove movement input held
   */
  _updateSafety(dt, frameMotion, wantsToMove) {
    const p = this.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      this.respawn();
      return;
    }
    if (p.y < MOVE.respawnY) {
      this.respawn('Du falt ut av verden – flyttet tilbake.');
      return;
    }
    // stuck: geometry keeps shoving us around while we get nowhere
    if (this._excessPush > 0.05 && frameMotion < 0.05) this._stuckT += dt;
    else this._stuckT = Math.max(0, this._stuckT - dt * 0.5);
    if (this._stuckT > MOVE.stuckTime) {
      this.respawn('Du satt fast – flyttet tilbake.');
      return;
    }
    // deeper than wading depth / outside the world: only moves back out are allowed (see _keepWalkable);
    // if that does not get us out quickly, put us back on land
    if (!this.collision.isWalkable(p.x, p.z)) {
      this._deepT += dt;
      if (this._deepT > MOVE.deepWaterTime) {
        this.respawn('For dypt vann – flyttet tilbake.');
        return;
      }
    } else {
      this._deepT = 0;
    }
    // trapped in water (fell into a basin with steep sides, keeps wading against the deep-water edge): trying
    // to walk for a while without getting a metre anywhere → back on land
    if (wantsToMove && this.collision.waterLevel - p.y > MOVE.waterTrapDepth) {
      if (p.distanceToSquared(this._trapAnchor) > 1) {
        this._trapAnchor.copy(p);
        this._trapT = 0;
      } else if ((this._trapT += dt) > MOVE.waterTrapTime) {
        this.respawn('For dypt vann – flyttet tilbake.');
        return;
      }
    } else {
      this._trapT = 0;
      this._trapAnchor.copy(p);
    }
    // remember safe ground
    if (this.onGround && !this.inWater && this._excessPush < 0.01 && this.collision.isWalkable(p.x, p.z)) {
      this._safeT += dt;
      if (this._safeT > 0.3) {
        this._safeT = 0;
        this._safe.copy(p);
        this._safeYaw = this.yaw;
        this._hasSafe = true;
      }
    } else {
      this._safeT = 0;
    }
  }

  /* ------------------------------------------------------------------ camera */

  _placeCamera(/* dt */) {
    // a «skikkelse» (physicalBody off) glides: no head bob
    const bobOn = this.settings?.get?.('headBob') !== false && this.settings?.get?.('physicalBody') !== false;
    const eye = THREE.MathUtils.lerp(PLAYER.eyeHeight, MOVE.crouchEyeHeight, easeInOut(this._crouchAmt));
    let y = this.position.y + eye + this._stepSmooth;
    let lateral = 0;
    if (bobOn) {
      const a = this._bobAmt;
      y += -Math.cos(2 * this._bobPhase) * MOVE.bobVertical * a + this._dip;
      lateral = Math.sin(this._bobPhase) * MOVE.bobLateral * a;
    }
    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * lateral,
      y,
      this.position.z - Math.sin(this.yaw) * lateral,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

/* ------------------------------------------------------------------ helpers */

function wrapAngle(a) {
  const TAU = Math.PI * 2;
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

/** Remove the horizontal velocity component going into a wall with horizontal unit normal n. */
function clipHorizontal(v, n) {
  const into = v.x * n.x + v.z * n.z;
  if (into < 0) {
    v.x -= n.x * into;
    v.z -= n.z * into;
  }
}

/** How far (m) a point lies outside the world bounds; ≤ 0 inside. */
function outsideBounds(b, x, z) {
  return Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
}

function smoothstep(e0, e1, x) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}
