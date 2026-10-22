import * as THREE from 'three';
import { PLAYER } from '../config.js';

const _p = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** A leaf is covered by this many axis-aligned boxes for collision (a wall off the world axes stays covered). */
const SEGMENTS = 4;
/** Clearance between a sliding leaf's edge and the player's capsule (m) – the leaf stops this far from the body. */
const CLEAR = 0.02;

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
/** Inverse of easeInOut. */
const easeInOutInv = (e) => Math.acos(1 - 2 * THREE.MathUtils.clamp(e, 0, 1)) / Math.PI;

/** Material of the invisible doorway target (raycastable, never rendered). */
let _proxyMaterial = null;
function proxyMaterial() {
  _proxyMaterial ??= new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  return _proxyMaterial;
}

/**
 * Sliding door (notes/dortyper.md): one or more leaves that slide along the wall – on a rail in front of a wall face,
 * into a pocket in the wall or in a patio frame – with eased motion, the interaction prompt, sound events and dynamic
 * box colliders. No swing area. Same public API as world/Door.js (open, close, toggle, setOpen, onChange, update,
 * dispose, isOpen, t, isAjar, leaves[].pivot, root, doorway, promptText), so the home code treats both alike.
 *
 * Door-local frame as world/Door.js: origin = bottom centre of the structural opening on the wall's FRONT face; +x along
 * the wall, +y up, +z = front-side normal; the wall occupies z ∈ [−depth, 0].
 *
 * Each leaf is a pivot group at the origin that translates along x (dir · travel · ease(t)); its geometry is added by
 * the builder (home/doors.js replaceLeaf) in door-local space at the closed position. The leaf's body box (x0…x1,
 * y0…y1, z0…z1, closed) is its collider: SEGMENTS boxes that follow it. Moving, the leaf stops against the player's
 * capsule (like Door: a door closing on someone in the doorway waits).
 *
 * Events: ctx.events 'sfx' { name: 'door-open' | 'door-close' | 'door-locked', position }.
 */
export class SlidingDoor {
  /**
   * @param {object} ctx   home context (interaction, collision, events, camera)
   * @param {object} o
   * @param {string} o.id
   * @param {THREE.Matrix4} o.matrix   door-local → world
   * @param {number} o.width           structural opening width
   * @param {number} o.height          structural opening height
   * @param {number} o.depth           wall thickness
   * @param {Array<{x0:number, x1:number, y0?:number, y1:number, z0:number, z1:number, dir:1|-1, travel:number}>} o.leaves
   *        closed body of each leaf (door-local) and how far it slides open (along dir · x)
   * @param {[number, number]} [o.clear]  x range of the clear opening (the doorway target), default the whole width
   * @param {string} [o.frontLabel]    room name shown in the prompt when the camera is on the front side
   * @param {string} [o.backLabel]     … and on the back side
   * @param {number} [o.duration=0.9]  slide time (s)
   * @param {boolean} [o.locked=false]
   * @param {boolean} [o.interactive=true]
   * @param {number} [o.bodyRadius]    radius of the body the leaf stops against (default: PLAYER.radius)
   * @param {number} [o.bodyHeight]    its height (default: PLAYER.height)
   */
  constructor(ctx, o) {
    this.ctx = ctx;
    this.id = o.id;
    this.sliding = true;
    this.width = o.width;
    this.height = o.height;
    this.depth = o.depth;
    this.duration = o.duration ?? 0.9;
    this.locked = !!o.locked;
    this.frontLabel = o.frontLabel ?? null;
    this.backLabel = o.backLabel ?? null;
    this.bodyRadius = o.bodyRadius ?? PLAYER.radius;
    this.bodyHeight = o.bodyHeight ?? PLAYER.height;
    this.matrix = o.matrix.clone();
    this._inverse = this.matrix.clone().invert();
    this.clear = o.clear ?? [-this.width / 2, this.width / 2];
    this.blocked = false;
    this.t = 0;
    this.isOpen = false;
    this._listeners = new Set();
    this._handles = [];
    this._disposables = [];

    this.root = new THREE.Group();
    this.root.name = `door:${this.id}`;
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(this.matrix);
    this.root.userData.noCollide = true;

    this.position = new THREE.Vector3((this.clear[0] + this.clear[1]) / 2, Math.min(1.2, this.height / 2), -this.depth / 2).applyMatrix4(this.matrix);

    this.leaves = o.leaves.map((l, index) => {
      const pivot = new THREE.Group();
      pivot.name = `door:${this.id}:leaf${index}`;
      this.root.add(pivot);
      return {
        index,
        pivot,
        dir: l.dir < 0 ? -1 : 1,
        travel: Math.max(0, l.travel),
        bodyMin: new THREE.Vector3(Math.min(l.x0, l.x1), l.y0 ?? 0, Math.min(l.z0, l.z1)),
        bodyMax: new THREE.Vector3(Math.max(l.x0, l.x1), l.y1, Math.max(l.z0, l.z1)),
        segments: [],
      };
    });
    this.root.updateMatrixWorld(true);
    const col = ctx.collision;
    if (col) {
      for (const leaf of this.leaves) {
        for (let k = 0; k < SEGMENTS; k++) leaf.segments.push(col.addDynamicBox(new THREE.Box3(), { id: `${this.id}:${leaf.index}:${k}` }));
      }
    }
    this._applyOffset();
    this._buildDoorwayProxy();
    if (o.interactive !== false) this._registerInteraction(ctx);
  }

  /* ------------------------------------------------------------------ public API (as world/Door.js) */

  get isMoving() {
    return this.t > 0 && this.t < 1;
  }

  /** True when not fully closed (light/sound can pass). */
  get isAjar() {
    return this.t > 0.02;
  }

  open() {
    if (this.locked) return this._rattle();
    if (this.isOpen) return;
    this.isOpen = true;
    this._emit('door-open');
    this._notify('opening');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._notify('closing');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  setLocked(locked) {
    this.locked = locked;
  }

  /** As Door.setOpen: { instant: true } jumps there at once (no animation, no sound). */
  setOpen(open, { instant = false } = {}) {
    if (!instant) {
      if (open) this.open();
      else this.close();
      return;
    }
    this.isOpen = !!open;
    this.t = open ? 1 : 0;
    this.blocked = false;
    this._applyOffset();
    this._notify(open ? 'open' : 'closed');
  }

  /** Subscribe to state changes: fn(door, 'opening' | 'open' | 'closing' | 'closed'). Returns an unsubscribe. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * @param {number} dt
   * @param {{playerPosition?: THREE.Vector3}} [state]  player feet position – the leaf stops against the player
   */
  update(dt, state) {
    const target = this.isOpen ? 1 : 0;
    if (this.t === target) {
      this.blocked = false;
      return;
    }
    const prev = this.t;
    const step = dt / this.duration;
    let next = target > prev ? Math.min(1, prev + step) : Math.max(0, prev - step);
    if (state?.playerPosition) next = this._limitByBody(prev, next, state.playerPosition);
    this.blocked = next === prev;
    if (this.blocked) return;
    this.t = next;
    this._applyOffset();
    if (this.t === 1) this._notify('open');
    else if (this.t === 0) {
      this._emit('door-close');
      this._notify('closed');
    }
  }

  /** World box of the leaves over their whole travel, closed → open (for the visibility system). */
  sweptBox() {
    const box = new THREE.Box3();
    for (const leaf of this.leaves) {
      for (const s of [0, leaf.dir * leaf.travel]) {
        for (let i = 0; i < 8; i++) {
          _corner.set((i & 1 ? leaf.bodyMax.x : leaf.bodyMin.x) + s, i & 2 ? leaf.bodyMax.y : leaf.bodyMin.y, i & 4 ? leaf.bodyMax.z : leaf.bodyMin.z);
          box.expandByPoint(_corner.applyMatrix4(this.matrix));
        }
      }
    }
    return box.isEmpty() ? null : box.expandByScalar(0.05);
  }

  dispose() {
    for (const h of this._handles) h.unregister();
    for (const leaf of this.leaves) for (const s of leaf.segments) this.ctx.collision?.removeDynamic(s);
    for (const d of this._disposables) d.dispose?.();
    this.root.removeFromParent();
    this._listeners.clear();
  }

  /** Prompt for the current camera side, e.g. 'Åpne dør – Kontrollrom'. */
  promptText() {
    if (this.isOpen) return 'Lukk dør';
    const label = this._cameraOnFront() ? this.frontLabel : this.backLabel;
    if (this.locked) return label ? `Låst dør – ${label}` : 'Låst dør';
    return label ? `Åpne dør – ${label}` : 'Åpne dør';
  }

  /* ------------------------------------------------------------------ internals */

  /** Leaf offset along x for the animation parameter t. */
  _offset(leaf, t) {
    return leaf.dir * leaf.travel * easeInOut(t);
  }

  _applyOffset() {
    for (const leaf of this.leaves) {
      leaf.pivot.position.x = this._offset(leaf, this.t);
      leaf.pivot.updateMatrixWorld(true);
      this._fitSegments(leaf);
    }
  }

  /** The segment boxes: world AABB of each slice of the leaf body at its current offset. */
  _fitSegments(leaf) {
    if (!leaf.segments.length) return;
    leaf.pivot.updateMatrix();
    _m.multiplyMatrices(this.matrix, leaf.pivot.matrix);
    const { bodyMin: a, bodyMax: b } = leaf;
    const dx = (b.x - a.x) / SEGMENTS;
    for (let k = 0; k < SEGMENTS; k++) {
      const box = leaf.segments[k].box.makeEmpty();
      const x0 = a.x + k * dx;
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? x0 + dx : x0, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z);
        box.expandByPoint(_corner.applyMatrix4(_m));
      }
    }
  }

  /**
   * Limit the next animation parameter so no leaf's leading edge runs into the player's capsule (a vertical cylinder
   * at `feet`): in door-local space the body is a circle of radius R + CLEAR; where it overlaps the leaf's z band it
   * covers an x interval, and the leaf's edge stops at that interval.
   * @returns {number} next, clamped (equal to prev when the leaf is held)
   */
  _limitByBody(prev, next, feet) {
    _p.copy(feet).applyMatrix4(this._inverse);
    if (_p.y > this.height || _p.y + this.bodyHeight < 0) return next;
    const R = this.bodyRadius + CLEAR;
    const e0 = easeInOut(prev);
    const e1 = easeInOut(next);
    const opening = next > prev;
    let eLim = e1;
    for (const leaf of this.leaves) {
      if (!(leaf.travel > 0)) continue;
      const dz = Math.max(0, leaf.bodyMin.z - _p.z, _p.z - leaf.bodyMax.z);
      if (dz >= R) continue;
      const hx = Math.sqrt(R * R - dz * dz);
      const p0 = _p.x - hx;
      const p1 = _p.x + hx;
      const s0 = leaf.dir * leaf.travel * e0;
      const s1 = leaf.dir * leaf.travel * e1;
      const mid = (leaf.bodyMin.x + leaf.bodyMax.x) / 2 + s0;
      // a body on the leading side of the leaf (its centre past the leaf's middle) holds the leading edge where it
      // touches – or where it is, when it already overlaps (touching at the last stop is an overlap of a few µm)
      let s = null;
      if (s1 > s0 && _p.x > mid && p0 < leaf.bodyMax.x + s1) s = Math.max(s0, p0 - leaf.bodyMax.x); // leading edge = max x
      else if (s1 < s0 && _p.x < mid && p1 > leaf.bodyMin.x + s1) s = Math.min(s0, p1 - leaf.bodyMin.x); // leading edge = min x
      if (s === null) continue;
      const e = THREE.MathUtils.clamp(s / (leaf.dir * leaf.travel), 0, 1);
      eLim = opening ? Math.min(eLim, e) : Math.max(eLim, e);
    }
    if (eLim === e1) return next;
    const t = easeInOutInv(eLim);
    return opening ? THREE.MathUtils.clamp(t, prev, next) : THREE.MathUtils.clamp(t, next, prev);
  }

  /** Invisible pane in the clear opening (mid-wall): the door's target through its doorway, open or closed. */
  _buildDoorwayProxy() {
    const [xa, xb] = this.clear;
    const h = this.height - 0.05;
    const geo = new THREE.PlaneGeometry(Math.max(0.05, xb - xa), h);
    this._disposables.push(geo);
    const proxy = new THREE.Mesh(geo, proxyMaterial());
    proxy.name = `door:${this.id}:doorway`;
    proxy.position.set((xa + xb) / 2, h / 2, -this.depth / 2);
    proxy.castShadow = false;
    proxy.receiveShadow = false;
    this.root.add(proxy);
    this.doorway = proxy;
  }

  _registerInteraction(ctx) {
    if (!ctx.interaction) return;
    const opts = { id: this.id, prompt: () => this.promptText(), onInteract: () => this.toggle() };
    for (const leaf of this.leaves) this._handles.push(ctx.interaction.register(leaf.pivot, opts));
    // the doorway always (unlike Door): aimed at the meeting gap of two leaves, the ray goes between them
    this._handles.push(ctx.interaction.register(this.doorway, opts));
  }

  _cameraOnFront() {
    const cam = this.ctx.camera;
    if (!cam) return true;
    cam.getWorldPosition(_p).applyMatrix4(this._inverse);
    return _p.z >= 0;
  }

  _rattle() {
    this._emit('door-locked');
    this.ctx.events?.emit('toast', { text: 'Døren er låst.', seconds: 2 });
  }

  _emit(name) {
    this.ctx.events?.emit('sfx', { name, position: this.position.clone() });
  }

  _notify(state) {
    for (const fn of this._listeners) fn(this, state);
  }
}
