import * as THREE from 'three';
import { MeshBatcher, place } from './buildKit.js';
import { signMaterial } from './signs.js';
import { PLAYER } from '../config.js';

const _p = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _m = new THREE.Matrix4();

const FRAME_FACE = 0.05; // visible steel frame width
const OVERLAP = 0.012; // leaf overlaps the frame rebate
const BOTTOM_GAP = 0.008;
const LEAF_T = 0.05;
/** A leaf between closed and open is approximated by this many small axis-aligned boxes for collision. */
const SEGMENTS = 6;
/**
 * Extra clearance between the swinging leaf and the player's capsule (m). The segment boxes of a diagonal leaf
 * stick out up to ≈ (leaf width / SEGMENTS) / 2 beyond its face (at 45°), so the clearance must exceed that or the
 * boxes would shove the player. Measured from the pivot line: the front face when opening, the back face (LEAF_T
 * further) when closing.
 */
const CLEAR_OPENING = 0.09;
const CLEAR_CLOSING = 0.09 + LEAF_T;

/** Height of panic hardware (bar or pad) above the floor. */
const PANIC_Y = 1.13;
/** Push pad: size, distance of its latch end from the leaf's latch edge, floor-bolt rod radius and bottom end. */
const PANIC_PAD = { length: 0.38, height: 0.075, depth: 0.06, fromEdge: 0.1, rodR: 0.008, rodBottom: 0.04 };
/**
 * Raised-panel face: stile / rail width, their thickness on the skin, relief of the fields and the width of their
 * chamfer, gap between a field and its frame, fields per leaf (equal heights).
 */
const PANELS = { stile: 0.12, frame: 0.008, field: 0.02, chamfer: 0.01, gap: 0.03, count: 3 };

/**
 * Proud panel field w × h with chamfered edges, its back face at z = 0, relief PANELS.field toward +z (the back
 * chamfer is sunk into the leaf).
 */
function raisedFieldGeometry(w, h) {
  const c = PANELS.chamfer;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + c, -h / 2 + c);
  shape.lineTo(w / 2 - c, -h / 2 + c);
  shape.lineTo(w / 2 - c, h / 2 - c);
  shape.lineTo(-w / 2 + c, h / 2 - c);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: PANELS.field - c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1 });
}

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
/** Inverse of easeInOut. */
const easeInOutInv = (e) => Math.acos(1 - 2 * THREE.MathUtils.clamp(e, 0, 1)) / Math.PI;

/**
 * Half-width δ of the range of leaf angles that touch a circle of radius R whose centre is at distance d from the
 * pivot (leaf length L), or −1 when the leaf cannot reach it.
 */
function blockedHalfAngle(d, R, L) {
  if (d - R >= L) return -1;
  if (d <= R) return Math.PI;
  if (Math.sqrt(d * d - R * R) <= L) return Math.asin(R / d); // the leaf's face touches it
  return Math.acos(THREE.MathUtils.clamp((L * L + d * d - R * R) / (2 * L * d), -1, 1)); // only the free edge reaches
}

/** Material of the invisible doorway target (raycastable, never rendered). */
let _proxyMaterial = null;
function proxyMaterial() {
  _proxyMaterial ??= new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  return _proxyMaterial;
}

/**
 * Sign materials shared by all doors (keyed by the cached sign texture), reference-counted so the last door that
 * uses one disposes it. The textures themselves belong to the signs.js cache and are not disposed here.
 */
const _signMats = new Map();
function acquireSignMaterial(sign) {
  const key = sign.texture.uuid;
  let entry = _signMats.get(key);
  if (!entry) {
    entry = { material: signMaterial(sign, { roughness: 0.45 }), refs: 0 };
    _signMats.set(key, entry);
  }
  entry.refs++;
  return { material: entry.material, dispose: () => releaseSignMaterial(key) };
}
function releaseSignMaterial(key) {
  const entry = _signMats.get(key);
  if (!entry || --entry.refs > 0) return;
  entry.material.dispose();
  _signMats.delete(key);
}

/**
 * Hinged door (single or double leaf) with frame, hardware, eased swing animation, interaction prompt,
 * sound events and a dynamic box collider per leaf.
 *
 * Door-local frame (o.matrix maps it to world): origin = bottom centre of the structural opening on the wall's
 * FRONT face; +x along the wall (to the right seen from the front), +y up, +z = front-side normal.
 * The wall occupies z ∈ [−depth, 0].
 *
 * Collision: while closed each leaf is an axis-aligned box filling the opening; fully open it moves to the open leaf
 * (at 90° or 180° – o.openAngleDeg – the box stays axis-aligned for walls on the world axes); in between, and fully
 * open at any other angle, the leaf is covered by SEGMENTS small boxes that follow it.
 *
 * The player is never swept: given state.playerPosition (feet) in update(), the swing stops where the leaf would
 * touch the player's capsule – like a real door stopping against a person – and continues once they step aside.
 * That works in both directions, so a door closing on someone standing in the doorway simply waits.
 *
 * Targeting: besides the leaves, an invisible pane filling the opening is registered while the door is open, so an
 * open door can be closed by looking through the doorway.
 *
 * Events: ctx.events 'sfx' { name: 'door-open' | 'door-close' | 'door-locked', position }.
 */
export class Door {
  /**
   * @param {object} ctx   home context (interaction, collision, events, camera) – the ctx passed to createHome
   * @param {object} o
   * @param {string} o.id
   * @param {THREE.Matrix4} o.matrix   door-local → world
   * @param {number} o.width           structural opening width
   * @param {number} o.height          structural opening height
   * @param {number} o.depth           wall thickness
   * @param {{leaf:THREE.Material, frame:THREE.Material, hardware:THREE.Material, dark:THREE.Material}} o.materials
   * @param {boolean} [o.double=false] two leaves (hinges on both jambs)
   * @param {number} [o.splitX=0]      double: x of the meeting edge (unequal leaves)
   * @param {0|1} [o.activeLeaf=1]     double: the leaf with the handle (0 = the −x leaf); the other gets flush bolts
   * @param {1|-1} [o.hingeSide=1]     single leaf: +1 = hinges on the +x jamb
   * @param {1|-1} [o.swing=1]         +1 = opens toward the front (+z), −1 toward the back
   * @param {string} [o.frontLabel]    room name shown in the prompt when the camera is on the front side
   * @param {string} [o.backLabel]     … and on the back side
   * @param {Array<{sign:object, side:'front'|'back', y:number, leaf?:number}>} [o.decals]  signs on the leaf faces
   * @param {boolean} [o.louvres]      ventilation grilles in the leaves (both faces)
   * @param {'front'|'back'} [o.panic] panic hardware on that face of the handle leaf (escape doors)
   * @param {'bar'|'pad'} [o.panicStyle='bar']  full-width push bar, or a short push pad on the latch half with a
   *                                    floor-bolt rod
   * @param {'front'|'back'} [o.panels] raised-panel mouldings (three fields per leaf) on that face, in
   *                                    o.materials.panel when given (e.g. a plain paint instead of the grooved skin);
   *                                    hardware and decals on that face sit on the mouldings
   * @param {boolean} [o.threshold=true]
   * @param {MeshBatcher|null} [o.batcher]  static frame parts go here (merged with the building, world space); without
   *                                        one the frame is built as its own mesh under `root` (this.frameGroup)
   * @param {number} [o.duration=0.7]  swing time (s)
   * @param {boolean} [o.locked=false]
   * @param {boolean} [o.interactive=true]  false: no prompt, the player cannot open it (a door that stays shut)
   * @param {number} [o.bodyRadius]    radius of the body the leaf stops against (default: PLAYER.radius)
   * @param {number} [o.bodyHeight]    its height (default: PLAYER.height)
   * @param {number} [o.openAngleDeg=90]  how far the leaf swings open (180: flat against the wall, door-gang D6;
   *                                    95 / 130: the outer door and the basement bedroom, hele-huset-avstemming §5.1)
   */
  constructor(ctx, o) {
    this.ctx = ctx;
    this.id = o.id;
    this.width = o.width;
    this.height = o.height;
    this.depth = o.depth;
    this.swing = o.swing ?? 1;
    this.duration = o.duration ?? 0.7;
    this.openAngle = THREE.MathUtils.degToRad(o.openAngleDeg ?? 90);
    /**
     * Open on a world axis (a multiple of 90°): the open leaf is one axis-aligned box. Any other angle keeps the
     * SEGMENTS boxes that follow the leaf when it is fully open, so its AABB does not block the floor diagonally.
     */
    this._openAxisAligned = Math.abs(Math.sin(this.openAngle * 2)) < 1e-6;
    this.locked = !!o.locked;
    this.frontLabel = o.frontLabel ?? null;
    this.backLabel = o.backLabel ?? null;
    this.bodyRadius = o.bodyRadius ?? PLAYER.radius;
    this.bodyHeight = o.bodyHeight ?? PLAYER.height;
    this.matrix = o.matrix.clone();
    this._inverse = this.matrix.clone().invert();
    /** True while the swing is held up by the player standing in its way. */
    this.blocked = false;

    /** 0 = closed … 1 = open (animation parameter). */
    this.t = 0;
    /** Target state: true = open. */
    this.isOpen = false;
    this._listeners = new Set();
    this._handles = [];
    this._disposables = [];

    this.root = new THREE.Group();
    this.root.name = `door:${this.id}`;
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(this.matrix);
    this.root.userData.noCollide = true;

    this.position = new THREE.Vector3(0, Math.min(1.2, this.height / 2), 0).applyMatrix4(this.matrix);

    this._buildFrame(o);
    this.leaves = this._leafSpecs(o).map((spec, i) => this._buildLeaf(spec, i, o));
    this.root.updateMatrixWorld(true);
    for (const leaf of this.leaves) this._computeBoxes(leaf);
    this._buildDoorwayProxy();

    if (o.interactive !== false) this._registerInteraction(ctx);
  }

  /* ------------------------------------------------------------------ public API */

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

  /**
   * Set the target state. With { instant: true } the door jumps there at once – no animation, no sound, colliders
   * and isAjar updated immediately (for save games, task setup …); listeners get 'open' / 'closed'.
   * @param {boolean} open
   * @param {{instant?: boolean}} [opts]
   */
  setOpen(open, { instant = false } = {}) {
    if (!instant) {
      if (open) this.open();
      else this.close();
      return;
    }
    this.isOpen = !!open;
    this.t = open ? 1 : 0;
    this.blocked = false;
    this._applyAngle();
    this._setColliders(open ? 'open' : 'closed');
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
    this._applyAngle();
    if (this.t === 1) {
      this._setColliders('open');
      this._notify('open');
    } else if (this.t === 0) {
      this._setColliders('closed');
      this._emit('door-close');
      this._notify('closed');
    } else {
      this._setColliders('moving');
    }
  }

  dispose() {
    for (const h of this._handles) h.unregister();
    for (const leaf of this.leaves) {
      this.ctx.collision?.removeDynamic(leaf.collider);
      for (const s of leaf.segments) this.ctx.collision?.removeDynamic(s);
    }
    for (const d of this._disposables) d.dispose?.();
    this.root.removeFromParent();
    this._listeners.clear();
  }

  /* ------------------------------------------------------------------ build */

  _leafSpecs(o) {
    const cw = this.width - 2 * FRAME_FACE;
    if (o.double) {
      // the meeting edge at o.splitX (unequal leaves), the handle and the astragal on o.activeLeaf
      const s = o.splitX ?? 0;
      const active = o.activeLeaf === 0 ? 0 : 1;
      return [
        { x0: -cw / 2 - OVERLAP, x1: s - 0.001, hingeSide: -1, handle: active === 0, astragal: active === 0 },
        { x0: s + 0.001, x1: cw / 2 + OVERLAP, hingeSide: 1, handle: active === 1, astragal: active === 1 },
      ];
    }
    return [{ x0: -cw / 2 - OVERLAP, x1: cw / 2 + OVERLAP, hingeSide: o.hingeSide ?? 1, handle: true }];
  }

  _buildFrame(o) {
    const m = o.materials;
    const own = !o.batcher;
    // with a batcher the frame is merged in world space; otherwise it gets its own mesh in door-local space
    const kit = o.batcher ?? new MeshBatcher(`doorframe:${this.id}`);
    const f = kit.frame(own ? new THREE.Matrix4() : this.matrix);
    const d = this.depth + 0.01;
    const zc = -this.depth / 2;
    const fw = FRAME_FACE;
    const h = this.height;
    // jambs + head (full-depth steel frame lining the reveal)
    f.box(fw, h, d, -this.width / 2 + fw / 2, h / 2, zc, m.frame, { collide: false });
    f.box(fw, h, d, this.width / 2 - fw / 2, h / 2, zc, m.frame, { collide: false });
    f.box(this.width, fw, d, 0, h - fw / 2, zc, m.frame, { collide: false });
    // rubber stop strip on the stop side
    const stopZ = this.swing > 0 ? -LEAF_T - 0.006 : -this.depth + LEAF_T + 0.006;
    f.box(0.012, h - fw, 0.008, -this.width / 2 + fw + 0.006, (h - fw) / 2, stopZ, m.dark, { collide: false, castShadow: false });
    f.box(0.012, h - fw, 0.008, this.width / 2 - fw - 0.006, (h - fw) / 2, stopZ, m.dark, { collide: false, castShadow: false });
    if (o.threshold ?? true) {
      f.box(this.width - 2 * fw, 0.008, d, 0, 0.004, zc, m.hardware, { collide: false, castShadow: false });
    }
    if (own) {
      this.frameGroup = kit.build();
      this._disposables.push(...kit.geometries);
      this.root.add(this.frameGroup);
    }
  }

  _buildLeaf(spec, index, o) {
    const m = o.materials;
    const lw = spec.x1 - spec.x0;
    const lh = this.height - FRAME_FACE + OVERLAP - BOTTOM_GAP;
    const hs = spec.hingeSide;
    const pivotX = hs > 0 ? spec.x1 : spec.x0;
    const pivotZ = this.swing > 0 ? -0.004 : -this.depth + 0.004;
    const zc = -this.swing * (LEAF_T / 2); // leaf centre relative to the pivot
    const cx = (spec.x0 + spec.x1) / 2 - pivotX; // leaf centre x relative to the pivot
    const frontZ = zc + LEAF_T / 2; // leaf face toward +z
    const backZ = zc - LEAF_T / 2;
    const panelSide = o.panels ? (o.panels === 'back' ? -1 : 1) : 0;
    /** Surface of the leaf on `side` (±1) to mount hardware on: on a raised-panel face the stiles' (or fields') top. */
    const face = (side, onFields = false) => (side > 0 ? frontZ : backZ) + (side === panelSide ? side * (onFields ? PANELS.field : PANELS.frame) : 0);

    const pivot = new THREE.Group();
    pivot.name = `door:${this.id}:leaf${index}`;
    pivot.position.set(pivotX, 0, pivotZ);
    this.root.add(pivot);

    const kit = new MeshBatcher(`doorleaf:${this.id}:${index}`);
    kit.box(lw, lh, LEAF_T, cx, BOTTOM_GAP + lh / 2, zc, m.leaf, { boxUV: true });
    // bottom drop seal
    kit.box(lw - 0.02, 0.012, LEAF_T * 0.6, cx, BOTTOM_GAP + 0.004, zc, m.dark, { castShadow: false });
    if (spec.astragal) {
      // cover strip over the meeting edge (on the swing side face, overlapping the passive leaf)
      const ax = cx - hs * (lw / 2);
      const az = this.swing > 0 ? frontZ + 0.004 : backZ - 0.004;
      kit.box(0.05, lh - 0.02, 0.008, ax, BOTTOM_GAP + lh / 2, az, m.leaf);
    }
    // hinge knuckles on the pivot axis
    for (const y of [0.22, lh / 2 + 0.1, lh - 0.22]) {
      kit.cylinder(0.011, 0.011, 0.12, 0, y, 0, m.hardware, { segments: 10 });
    }

    if (spec.handle) {
      const hx = cx - hs * (lw / 2 - 0.075); // near the free edge
      for (const side of [1, -1]) {
        const faceZ = face(side);
        this._addLever(kit, m, hx, 1.02, faceZ, side, hs);
        // lock cylinder below the handle
        kit.cylinder(0.017, 0.017, 0.012, hx, 0.93, faceZ + side * 0.006, m.hardware, { rot: [Math.PI / 2, 0, 0], segments: 14 });
        kit.box(0.004, 0.012, 0.003, hx, 0.93, faceZ + side * 0.0125, m.dark, { castShadow: false });
      }
    } else {
      // passive leaf: flush bolt plates at top and bottom of the meeting edge
      const bx = cx - hs * (lw / 2 - 0.03);
      for (const side of [1, -1]) {
        const faceZ = face(side);
        kit.box(0.022, 0.16, 0.004, bx, lh - 0.25, faceZ + side * 0.002, m.hardware, { castShadow: false });
        kit.box(0.022, 0.16, 0.004, bx, 0.25, faceZ + side * 0.002, m.hardware, { castShadow: false });
      }
    }

    if (o.panic && spec.handle) {
      const side = o.panic === 'back' ? -1 : 1;
      if (o.panicStyle === 'pad') this._addPanicPad(kit, m, cx, lw, hs, face(side, true), side);
      else this._addPanicBar(kit, m, cx, lw, hs, face(side, true), side);
    }

    if (panelSide) {
      // raised-panel face (wide stiles, rails and PANELS.count proud fields with chamfered edges), e.g. the inside of
      // an old-style outer door
      const side = panelSide;
      const z = (d) => (side > 0 ? frontZ : backZ) + side * d;
      const { stile: st, frame: t, gap } = PANELS;
      const pm = m.panel ?? m.leaf;
      kit.box(lw, lh, 0.002, cx, BOTTOM_GAP + lh / 2, z(0.001), pm, { castShadow: false }); // smooth painted skin
      for (const sx of [-1, 1]) kit.box(st, lh, t, cx + sx * (lw / 2 - st / 2), BOTTOM_GAP + lh / 2, z(t / 2), pm);
      const rails = Array.from({ length: PANELS.count + 1 }, (_, i) => (i * (lh - st)) / PANELS.count);
      for (const y of rails) kit.box(lw - 2 * st, st, t, cx, BOTTOM_GAP + y + st / 2, z(t / 2), pm);
      for (let i = 0; i < rails.length - 1; i++) {
        const y0 = rails[i] + st + gap, y1 = rails[i + 1] - gap;
        const g = raisedFieldGeometry(lw - 2 * st - 2 * gap, y1 - y0);
        kit.add(g, pm, { matrix: place(cx, BOTTOM_GAP + (y0 + y1) / 2, z(0), 0, side > 0 ? 0 : Math.PI, 0) });
        g.dispose();
      }
    }

    if (o.louvres) {
      // large fine-bladed ventilation panels (lower + upper) on both faces
      const gw = lw - 0.16;
      const hLow = Math.min(0.9, lh * 0.36), hUp = Math.min(0.8, lh * 0.3);
      for (const side of [1, -1]) {
        const faceZ = face(side);
        this._addLouvre(kit, m, cx, 0.16, gw, hLow, faceZ, side);
        this._addLouvre(kit, m, cx, lh - 0.16 - hUp, gw, hUp, faceZ, side);
      }
    }

    for (const dec of o.decals ?? []) {
      if ((dec.leaf ?? 0) !== index) continue;
      const side = dec.side === 'back' ? -1 : 1;
      const faceZ = face(side, true);
      const geo = new THREE.PlaneGeometry(dec.sign.width, dec.sign.height);
      const signMat = acquireSignMaterial(dec.sign);
      this._disposables.push(signMat);
      kit.add(geo, signMat.material, {
        matrix: place(cx + (dec.x ?? 0), dec.y, faceZ + side * 0.0015, 0, side > 0 ? 0 : Math.PI, 0),
        castShadow: false,
      });
      geo.dispose();
    }

    const group = kit.build();
    this._disposables.push(...kit.geometries);
    pivot.add(group);

    const leaf = {
      index,
      pivot,
      hingeSide: hs,
      /** Pivot → free edge (m). */
      length: lw,
      // body corners in pivot space (for the collider)
      bodyMin: new THREE.Vector3(cx - lw / 2, 0, zc - LEAF_T / 2),
      bodyMax: new THREE.Vector3(cx + lw / 2, BOTTOM_GAP + lh, zc + LEAF_T / 2),
      closedBox: new THREE.Box3(),
      openBox: new THREE.Box3(),
      collider: null,
      /** Collision boxes covering the leaf while it is between closed and open. */
      segments: [],
    };
    return leaf;
  }

  /** Full-width panic push bar at PANIC_Y (escape side): black end housings at both stiles and the bar between. */
  _addPanicBar(kit, m, cx, lw, hs, faceZ, side) {
    const y = PANIC_Y;
    const xHinge = cx + hs * (lw / 2 - 0.09), xLatch = cx - hs * (lw / 2 - 0.12);
    kit.box(0.08, 0.075, 0.06, xHinge, y, faceZ + side * 0.03, m.dark);
    kit.box(0.17, 0.085, 0.07, xLatch, y, faceZ + side * 0.035, m.dark);
    kit.box(Math.abs(xLatch - xHinge) - 0.1, 0.04, 0.035, (xHinge + xLatch) / 2, y, faceZ + side * 0.055, m.dark);
    kit.box(0.2, 0.02, 0.002, (xHinge + xLatch) / 2 - hs * 0.05, y, faceZ + side * 0.0735, m.hardware, { castShadow: false });
  }

  /**
   * Short panic push pad (PANIC_PAD) on the latch half at PANIC_Y with a label strip, and the stainless rod from its
   * hinge-side end down to a floor bolt with a black foot (bryterrom door, 360° photo).
   */
  _addPanicPad(kit, m, cx, lw, hs, faceZ, side) {
    const P = PANIC_PAD, y = PANIC_Y;
    const xEdge = cx - hs * (lw / 2); // latch (free) edge
    const xa = xEdge + hs * P.fromEdge, xb = xa + hs * P.length;
    const z = (d) => faceZ + side * d;
    kit.box(P.length, P.height, P.depth, (xa + xb) / 2, y, z(P.depth / 2), m.dark);
    kit.box(P.length * 0.55, 0.02, 0.002, (xa + xb) / 2, y, z(P.depth + 0.001), m.hardware, { castShadow: false });
    const xr = xb - hs * 0.02, top = y - 0.03;
    kit.cylinder(P.rodR, P.rodR, top - P.rodBottom, xr, (top + P.rodBottom) / 2, z(P.depth / 2), m.hardware, { segments: 8 });
    kit.box(0.04, 0.05, 0.03, xr, 0.025, z(P.depth / 2), m.dark, { castShadow: false });
  }

  /** Lever handle on one face: rose + neck + lever pointing toward the hinge side. */
  _addLever(kit, m, x, y, faceZ, side, hingeSide) {
    const rot = [Math.PI / 2, 0, 0];
    kit.cylinder(0.026, 0.026, 0.012, x, y, faceZ + side * 0.006, m.hardware, { rot, segments: 18 });
    kit.cylinder(0.009, 0.009, 0.05, x, y, faceZ + side * 0.035, m.hardware, { rot, segments: 10 });
    kit.box(0.13, 0.02, 0.018, x + hingeSide * 0.058, y, faceZ + side * 0.058, m.hardware);
  }

  /** Ventilation louvre: dark backing (m.louvreBack), frame and tilted blades, proud of the leaf face. */
  _addLouvre(kit, m, cx, y0, w, h, faceZ, side) {
    const z = (d) => faceZ + side * d;
    kit.box(w - 0.04, h - 0.04, 0.003, cx, y0 + h / 2, z(0.0015), m.louvreBack ?? m.dark, { castShadow: false });
    const fr = 0.022;
    kit.box(w, fr, 0.012, cx, y0 + fr / 2, z(0.006), m.leaf);
    kit.box(w, fr, 0.012, cx, y0 + h - fr / 2, z(0.006), m.leaf);
    kit.box(fr, h, 0.012, cx - w / 2 + fr / 2, y0 + h / 2, z(0.006), m.leaf);
    kit.box(fr, h, 0.012, cx + w / 2 - fr / 2, y0 + h / 2, z(0.006), m.leaf);
    const pitch = 0.026;
    const n = Math.floor((h - 2 * fr) / pitch);
    for (let i = 0; i < n; i++) {
      const y = y0 + fr + pitch / 2 + i * pitch;
      kit.box(w - 2 * fr, 0.026, 0.002, cx, y, z(0.008), m.leaf, { rot: [side * 0.7, 0, 0], castShadow: false });
    }
  }

  /** Closed and open world AABBs of a leaf (open = this.openAngle). */
  _computeBoxes(leaf) {
    const saved = leaf.pivot.rotation.y;
    for (const [angle, box] of [[0, leaf.closedBox], [this._angleFor(leaf, 1), leaf.openBox]]) {
      leaf.pivot.rotation.y = angle;
      leaf.pivot.updateMatrixWorld(true);
      box.makeEmpty();
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? leaf.bodyMax.x : leaf.bodyMin.x, i & 2 ? leaf.bodyMax.y : leaf.bodyMin.y, i & 4 ? leaf.bodyMax.z : leaf.bodyMin.z);
        box.expandByPoint(_corner.applyMatrix4(leaf.pivot.matrixWorld));
      }
    }
    leaf.pivot.rotation.y = saved;
    leaf.pivot.updateMatrixWorld(true);
    const col = this.ctx.collision;
    if (!col) return;
    leaf.collider = col.addDynamicBox(leaf.closedBox, { id: `${this.id}:${leaf.index}` });
    for (let k = 0; k < SEGMENTS; k++) {
      leaf.segments.push(col.addDynamicBox(new THREE.Box3(), { enabled: false, id: `${this.id}:${leaf.index}:${k}` }));
    }
  }

  _angleFor(leaf, t) {
    return leaf.hingeSide * this.swing * this.openAngle * easeInOut(t);
  }

  _applyAngle() {
    for (const leaf of this.leaves) {
      leaf.pivot.rotation.y = this._angleFor(leaf, this.t);
      leaf.pivot.updateMatrixWorld(true);
    }
  }

  /** @param {'closed'|'open'|'moving'} state */
  _setColliders(state) {
    for (const leaf of this.leaves) {
      if (!leaf.collider) continue;
      // an open leaf off the world axes is covered by the segment boxes (its AABB would block a diagonal band)
      const moving = state === 'moving' || (state === 'open' && !this._openAxisAligned);
      leaf.collider.enabled = !moving;
      if (state === 'closed') leaf.collider.box.copy(leaf.closedBox);
      else if (state === 'open') leaf.collider.box.copy(leaf.openBox);
      for (const s of leaf.segments) s.enabled = moving;
      if (moving) this._fitSegments(leaf);
    }
  }

  /** Fit the segment boxes to the leaf at its current angle (world AABB of each slice of the leaf body). */
  _fitSegments(leaf) {
    // world matrix of the pivot from the door matrix (independent of the scene graph's update state)
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
   * Limit the next animation parameter so no leaf sweeps into a body (the player's capsule, a vertical cylinder at
   * `feet`). Works in the leaf's swing plane: the leaf is a segment from its pivot at opening angle α; a circle of
   * radius R at distance d / polar angle φ blocks the angles (φ − δ, φ + δ), with δ = asin(R/d) or, when only the
   * leaf's free edge can reach it, the angle at which the edge touches the circle.
   * @returns {number} next, clamped (equal to prev when the swing is held)
   */
  _limitByBody(prev, next, feet) {
    _p.copy(feet).applyMatrix4(this._inverse);
    const leafTop = this.height;
    if (_p.y > leafTop || _p.y + this.bodyHeight < 0) return next;
    const aPrev = this.openAngle * easeInOut(prev);
    const opening = next > prev;
    let lo = -Infinity, hi = Infinity;
    for (const leaf of this.leaves) {
      const rx = _p.x - leaf.pivot.position.x;
      const rz = _p.z - leaf.pivot.position.z;
      const p0 = -leaf.hingeSide * rx; // along the closed leaf
      const p1 = this.swing * rz; // toward the open position
      const d = Math.hypot(p0, p1);
      const phi = Math.atan2(p1, p0);
      // (if the body is already touching the leaf, the bound is the current angle: it may only move away)
      if (phi >= aPrev) {
        const dAhead = blockedHalfAngle(d, this.bodyRadius + CLEAR_OPENING, leaf.length); // body on the opening side
        if (dAhead >= 0) hi = Math.min(hi, Math.max(aPrev, phi - dAhead));
      } else {
        const dBehind = blockedHalfAngle(d, this.bodyRadius + CLEAR_CLOSING, leaf.length); // body on the closing side
        if (dBehind >= 0) lo = Math.max(lo, Math.min(aPrev, phi + dBehind));
      }
    }
    if (hi === Infinity && lo === -Infinity) return next;
    const aNext = THREE.MathUtils.clamp(this.openAngle * easeInOut(next), lo, hi);
    const t = easeInOutInv(aNext / this.openAngle);
    return opening ? THREE.MathUtils.clamp(t, prev, next) : THREE.MathUtils.clamp(t, next, prev);
  }

  /** Invisible pane in the opening (mid-wall): lets an open door be targeted through its doorway. */
  _buildDoorwayProxy() {
    const w = this.width - 2 * FRAME_FACE;
    const h = this.height - FRAME_FACE;
    const geo = new THREE.PlaneGeometry(w, h);
    this._disposables.push(geo);
    const proxy = new THREE.Mesh(geo, proxyMaterial());
    proxy.name = `door:${this.id}:doorway`;
    proxy.position.set(0, h / 2, -this.depth / 2);
    proxy.castShadow = false;
    proxy.receiveShadow = false;
    this.root.add(proxy);
    this.doorway = proxy;
  }

  _registerInteraction(ctx) {
    if (!ctx.interaction) return;
    const opts = { id: this.id, prompt: () => this.promptText(), onInteract: () => this.toggle() };
    for (const leaf of this.leaves) this._handles.push(ctx.interaction.register(leaf.pivot, opts));
    // the doorway only while open (closed, the leaf in front of it is the target)
    this._handles.push(ctx.interaction.register(this.doorway, { ...opts, enabled: () => this.isOpen }));
  }

  /** Prompt for the current camera side, e.g. 'Åpne dør – Kontrollrom'. */
  promptText() {
    if (this.isOpen) return 'Lukk dør';
    const label = this._cameraOnFront() ? this.frontLabel : this.backLabel;
    if (this.locked) return label ? `Låst dør – ${label}` : 'Låst dør';
    return label ? `Åpne dør – ${label}` : 'Åpne dør';
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

/** Expose frame constants for builders that want to line up trims with the door frame. */
Door.FRAME_FACE = FRAME_FACE;
Door.LEAF_T = LEAF_T;
