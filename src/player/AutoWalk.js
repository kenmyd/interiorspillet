import * as THREE from 'three';

/**
 * AutoWalk – «Trykk for å gå dit» (touch layout 'tapwalk'): a tap on the floor walks the player there in a straight
 * line, turning toward it on the way. A ring on the floor marks the goal.
 *
 * CONTRACT (used by Game.js):
 *   new AutoWalk({ scene, camera, collision, player, events })
 *   walkTo(ndc) → bool    ray from the camera through ndc (the tap); a floor hit on the player's level within reach
 *                         becomes the goal. false (nothing changes) for walls, furniture tops, the sky …
 *   apply(input, dt)      call after input.update(), before player.update(): while walking it writes input.move /
 *                         input.lookDelta / input.running. The player's own input (joystick, keys, a look drag) cancels.
 *   cancel()
 *   active: boolean · target: THREE.Vector3|null
 *   dispose()
 * Stops when it arrives (within ARRIVE m), or when the player has not come closer for STUCK_S seconds (a wall or a
 * piece of furniture in the way – a toast says so).
 */

const ARRIVE = 0.3;
const MAX_DIST = 25;
/** The tapped floor must lie this close (m) to the feet: the same level, not a table top or the floor below. */
const LEVEL_TOL = 0.45;
const TURN_RATE = 3.2; // rad/s
const STUCK_S = 1.1;
/** Farther than this (m): run. */
const RUN_FROM = 6;

const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();

export class AutoWalk {
  constructor({ scene, camera, collision, player, events = null }) {
    this.camera = camera;
    this.collision = collision;
    this.player = player;
    this.events = events;
    this.target = null;
    this._best = Infinity;
    this._sinceBetter = 0;

    const geo = new THREE.RingGeometry(0.16, 0.24, 40);
    geo.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.name = 'autowalk-marker';
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.marker.raycast = () => {}; // never picked or targeted
    this.scene = scene;
    scene?.add(this.marker);
  }

  get active() {
    return !!this.target;
  }

  /** @param {{ x: number, y: number }} ndc */
  walkTo(ndc) {
    const c = this.collision;
    const p = this.player;
    if (!ndc || !c?.raycast || !p) return false;
    _ray.setFromCamera(_v2.set(ndc.x, ndc.y), this.camera);
    const hit = c.raycast(_ray.ray, MAX_DIST, { includeDynamic: false });
    if (!hit) return false;
    const q = hit.point;
    if (Math.abs(q.y - p.position.y) > LEVEL_TOL) return false;
    if (typeof c.isWalkable === 'function' && !c.isWalkable(q.x, q.z, q.y)) return false;
    this.target = new THREE.Vector3(q.x, q.y, q.z);
    this._best = Infinity;
    this._sinceBetter = 0;
    this.marker.position.set(q.x, q.y + 0.015, q.z);
    this.marker.visible = true;
    this.events?.emit('sfx', { name: 'ui-click', volume: 0.4 });
    return true;
  }

  apply(input, dt) {
    const t = this.target;
    if (!t) return;
    const p = this.player;
    // the player's own input wins
    if (input.move.forward || input.move.right || input.turn || input.lookDelta.x || input.lookDelta.y || p.seated) {
      this.cancel();
      return;
    }
    const dx = t.x - p.position.x;
    const dz = t.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVE) {
      this.cancel();
      return;
    }
    if (dist < this._best - 0.04) {
      this._best = dist;
      this._sinceBetter = 0;
    } else if ((this._sinceBetter += dt) > STUCK_S) {
      this.cancel();
      this.events?.emit('toast', { text: 'Kom ikke helt fram – noe står i veien', seconds: 2 });
      return;
    }
    // forward is (-sin yaw, -cos yaw); PlayerController subtracts lookDelta.x from the yaw
    const want = Math.atan2(-dx, -dz);
    let diff = want - p.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const step = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
    input.lookDelta.x = -step;
    const a = Math.abs(diff);
    input.move.forward = a < 0.5 ? 1 : a < 1.1 ? 0.35 : 0;
    // slow down for the last half metre so it does not overshoot
    if (dist < 0.6) input.move.forward *= Math.max(0.35, dist / 0.6);
    input.running = input.running || dist > RUN_FROM;
  }

  cancel() {
    this.target = null;
    this.marker.visible = false;
  }

  dispose() {
    this.cancel();
    this.marker.removeFromParent();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
  }
}
