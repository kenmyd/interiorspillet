import * as THREE from 'three';
import { SlidingDoor } from './SlidingDoor.js';

const _p = new THREE.Vector3();
const _corner = new THREE.Vector3();
/** Clearance between the folding panels and the player's capsule (m). */
const CLEAR = 0.02;

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** Distance from (x, z) to the rectangle [x0, x1] × [z0, z1] (0 inside). */
function distToRect(x, z, r) {
  return Math.hypot(Math.max(r[0] - x, 0, x - r[1]), Math.max(r[2] - z, 0, z - r[3]));
}

/**
 * Folding door (foldedør / harmonikadør, notes/dortyper.md): one or two stacks of narrow panels, hinged edge to edge,
 * hanging from a track in the head. Opening folds each stack in a zigzag toward its jamb; the folds stand out toward
 * one face. Same API as SlidingDoor / world/Door.js (E, sound, prompt, setOpen …).
 *
 * Door-local frame as world/Door.js. Every panel is a leaf: a pivot at its hinge edge that moves and turns about y; the
 * builder (home/doors.js replaceLeaf) adds its geometry in panel space – x from 0 to the panel width along the stack,
 * y from the floor, z ±T/2 around the panel's centre plane. Each panel has one collision box (the world AABB of the
 * panel). Moving, the stacks stop where they would intrude further into the player's capsule.
 */
export class FoldingDoor extends SlidingDoor {
  /**
   * @param {object} ctx
   * @param {object} o   as SlidingDoor, without o.leaves, and:
   * @param {Array<{anchor:number, e:1|-1, span:number, panels:number, z0:number, side:1|-1, T:number, y0:number, y1:number}>} o.stacks
   *        anchor: x of the jamb the stack hangs at; e: the closed stack runs from it toward +x (1) or −x (−1); span: its
   *        closed length; panels: how many (even: the free end runs in the track); z0: the panels' centre plane when
   *        closed; side: the face the folds stand out toward (±z); T: panel thickness; y0, y1: panel bottom and top
   * @param {number} [o.foldDeg=84]  how far the panels fold
   */
  constructor(ctx, o) {
    super(ctx, { ...o, leaves: [] });
  }

  /** One leaf per panel (called from the SlidingDoor constructor). */
  _makeLeaves(o) {
    this.foldAngle = THREE.MathUtils.degToRad(o.foldDeg ?? 84);
    this.stacks = o.stacks.map((s) => ({ ...s, p: s.span / s.panels, leaves: [] }));
    const leaves = [];
    for (const st of this.stacks) {
      for (let k = 0; k < st.panels; k++) {
        const pivot = new THREE.Group();
        pivot.name = `door:${this.id}:leaf${leaves.length}`;
        this.root.add(pivot);
        const leaf = {
          index: leaves.length,
          pivot,
          stack: st,
          k,
          segmentCount: 1,
          segments: [],
          bodyMin: new THREE.Vector3(0, st.y0, -st.T / 2),
          bodyMax: new THREE.Vector3(st.p - 0.003, st.y1, st.T / 2),
        };
        st.leaves.push(leaf);
        leaves.push(leaf);
      }
    }
    return leaves;
  }

  /** Fold angle for the animation parameter t. */
  _fold(t) {
    return this.foldAngle * easeInOut(t);
  }

  /**
   * Panel k of a stack folded by th: its hinge edge at (anchor + e·k·p·cos th, z0 or z0 + side·p·sin th), turned so its
   * x runs along the zigzag (even panels out toward `side`, odd ones back to the track).
   */
  _applyOffset() {
    const th = this._fold(this.t);
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (const st of this.stacks) {
      for (const leaf of st.leaves) {
        const k = leaf.k;
        const dz = (k % 2 === 0 ? 1 : -1) * st.side * s;
        leaf.pivot.position.set(st.anchor + st.e * k * st.p * c, 0, st.z0 + (k % 2 ? st.side * st.p * s : 0));
        leaf.pivot.rotation.y = Math.atan2(-dz, st.e * c);
        leaf.pivot.updateMatrixWorld(true);
        this._fitSegments(leaf);
      }
    }
  }

  /** Door-local rectangle [x0, x1, z0, z1] a stack occupies at t (the zigzag's bounds). */
  _region(st, t) {
    const th = this._fold(t);
    const xe = st.anchor + st.e * st.span * Math.cos(th);
    const zf = st.z0 + st.side * st.p * Math.sin(th);
    const pad = st.T / 2;
    return [Math.min(st.anchor, xe) - pad, Math.max(st.anchor, xe) + pad, Math.min(st.z0, zf) - pad, Math.max(st.z0, zf) + pad];
  }

  /**
   * The stacks may move only as far as they do not intrude further into the player's capsule (a circle of radius
   * R + CLEAR at the feet, door-local): closing, the free end stops at the body; opening, the folds stop in front of it.
   */
  _limitByBody(prev, next, feet) {
    _p.copy(feet).applyMatrix4(this._inverse);
    if (_p.y > this.height || _p.y + this.bodyHeight < 0) return next;
    const R = this.bodyRadius + CLEAR;
    const pen = (t) => Math.max(0, ...this.stacks.map((st) => R - distToRect(_p.x, _p.z, this._region(st, t))));
    const p0 = pen(prev) + 1e-6;
    if (pen(next) <= p0) return next;
    let a = prev;
    let b = next;
    for (let i = 0; i < 16; i++) {
      const m = (a + b) / 2;
      if (pen(m) <= p0) a = m;
      else b = m;
    }
    return a;
  }

  /** World box of the stacks over the whole fold (closed: the opening; open: the folds standing out). */
  sweptBox() {
    const box = new THREE.Box3();
    for (const st of this.stacks) {
      const [x0, x1] = this._region(st, 0);
      const [, , z0, z1] = this._region(st, 1);
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? x1 : x0, i & 2 ? st.y1 : st.y0, i & 4 ? z1 : z0);
        box.expandByPoint(_corner.applyMatrix4(this.matrix));
      }
    }
    return box.isEmpty() ? null : box.expandByScalar(0.05);
  }
}
