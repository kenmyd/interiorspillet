import * as THREE from 'three';
import { SlidingDoor } from './SlidingDoor.js';

const _p = new THREE.Vector3();
const _corner = new THREE.Vector3();
/** Clearance between the door and the player's capsule (m). */
const CLEAR = 0.02;

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** Distance between the 2D segments a–b and c–d ([y, z] points). */
function segDist(a, b, c, d) {
  const pt = (p, q, r) => {
    const qy = r[0] - q[0], qz = r[1] - q[1];
    const l2 = qy * qy + qz * qz;
    const k = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * qy + (p[1] - q[1]) * qz) / l2)) : 0;
    return Math.hypot(p[0] - q[0] - k * qy, p[1] - q[1] - k * qz);
  };
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
}

/**
 * Garage door (garasjeport, notes/dortyper.md): a sectional door (leddport) – horizontal sections hinged edge to edge
 * that run up vertical tracks, round a bend and in under the ceiling – or an up-and-over door (vippeport) – one panel
 * whose top runs in along a track under the head while its bottom swings out and up, so it ends level under the head
 * with a third of it out over the drive. No swing area on the floor. Same API as SlidingDoor / world/Door.js (E, sound,
 * prompt, setOpen …).
 *
 * Door-local frame as world/Door.js (+z into the owner room = the garage). Every section is a leaf: a pivot at its
 * bottom edge, turned about x so its local +y runs along the track (section-local: x across the door, y from 0 to the
 * section's height, z from 0 into the room – under the track once it lies flat). One collision box per section (its
 * world AABB). Moving, the door stops where it would come closer to the player's capsule than it already is.
 */
export class GarageDoor extends SlidingDoor {
  /**
   * @param {object} ctx
   * @param {object} o   as SlidingDoor, without o.leaves, and o.garage:
   * @param {'sectional'|'tilt'} o.garage.style
   * @param {number} o.garage.x0 @param {number} o.garage.x1  the door's width (door-local x)
   * @param {number} o.garage.T  section / panel thickness
   * sectional: sections (count), sectionH (each), z0 (the closed curtain's face toward the wall; the sections lie from
   *            it into the room), bendY (where the vertical track turns), radius (of the bend), lift (how far the
   *            curtain runs: the bottom edge's travel along the track)
   * tilt:      top (the panel's top edge, closed), h (its height), z0 (its outer face, closed), run (how far the top
   *            edge runs in along the head track)
   */
  constructor(ctx, o) {
    super(ctx, { ...o, leaves: [] });
  }

  promptText() {
    if (this.isOpen) return 'Lukk garasjeporten';
    if (this.locked) return 'Garasjeporten er låst';
    return 'Åpne garasjeporten';
  }

  /** One leaf per section (called from the SlidingDoor constructor). */
  _makeLeaves(o) {
    const g = (this.garage = { ...o.garage });
    const n = g.style === 'tilt' ? 1 : Math.max(1, Math.round(g.sections));
    const h = g.style === 'tilt' ? g.h : g.sectionH;
    const leaves = [];
    for (let k = 0; k < n; k++) {
      const pivot = new THREE.Group();
      pivot.name = `door:${this.id}:leaf${k}`;
      this.root.add(pivot);
      // section-local body: the panel hangs down from its pivot (tilt: the top edge), or runs up (sectional)
      const y0 = g.style === 'tilt' ? -h : 0;
      const y1 = g.style === 'tilt' ? 0 : h - 0.002;
      leaves.push({
        index: k,
        pivot,
        k,
        segmentCount: 1,
        segments: [],
        bodyMin: new THREE.Vector3(g.x0, y0, 0),
        bodyMax: new THREE.Vector3(g.x1, y1, g.T),
      });
    }
    return leaves;
  }

  /** Sectional: the track point at arc length s from the floor ([y, z] door-local) and its direction angle (0 = up). */
  _track(s) {
    const g = this.garage;
    if (s <= g.bendY) return { y: s, z: g.z0, a: 0 };
    const arc = (g.radius * Math.PI) / 2;
    if (s <= g.bendY + arc) {
      const f = (s - g.bendY) / g.radius;
      return { y: g.bendY + g.radius * Math.sin(f), z: g.z0 + g.radius * (1 - Math.cos(f)), a: f };
    }
    return { y: g.bendY + g.radius, z: g.z0 + g.radius + (s - g.bendY - arc), a: Math.PI / 2 };
  }

  /** The door's sections at t as 2D segments [[y, z] bottom/top edge] (for the body test) – placed when `apply`. */
  _pose(t, apply = false) {
    const g = this.garage;
    const e = easeInOut(t);
    const segs = [];
    if (g.style === 'tilt') {
      const th = (Math.PI / 2) * e;
      const zt = g.z0 + g.run * Math.sin(th);
      const top = [g.top, zt];
      const bottom = [g.top - g.h * Math.cos(th), zt - g.h * Math.sin(th)];
      segs.push([bottom, top]);
      if (apply) {
        const leaf = this.leaves[0];
        leaf.pivot.position.set(0, g.top, zt);
        leaf.pivot.rotation.x = th;
      }
      return segs;
    }
    const lift = g.lift * e;
    for (const leaf of this.leaves) {
      const s0 = leaf.k * g.sectionH + lift;
      const a = this._track(s0);
      const b = this._track(s0 + g.sectionH);
      segs.push([[a.y, a.z], [b.y, b.z]]);
      if (apply) {
        leaf.pivot.position.set(0, a.y, a.z);
        // the chord from this hinge to the next one
        leaf.pivot.rotation.x = Math.atan2(b.z - a.z, b.y - a.y);
      }
    }
    return segs;
  }

  _applyOffset() {
    this._pose(this.t, true);
    for (const leaf of this.leaves) {
      leaf.pivot.updateMatrixWorld(true);
      this._fitSegments(leaf);
    }
  }

  /**
   * The door may move only as far as it does not come closer to the player's capsule (a vertical segment from the
   * feet up its height, radius R + CLEAR, door-local) than it already is: closing, the curtain stops over a head in the
   * doorway; opening, a tilt door's bottom stops in front of someone outside.
   */
  _limitByBody(prev, next, feet) {
    _p.copy(feet).applyMatrix4(this._inverse);
    const g = this.garage;
    const R = this.bodyRadius + CLEAR;
    if (_p.x < g.x0 - R || _p.x > g.x1 + R) return next;
    const body = [[_p.y, _p.z], [_p.y + this.bodyHeight, _p.z]];
    const pen = (t) => Math.max(0, ...this._pose(t).map(([a, b]) => R - segDist(a, b, body[0], body[1])));
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

  /** World box of the door over its whole travel (closed: the hole; open: under the ceiling / out over the drive). */
  sweptBox() {
    const g = this.garage;
    const box = new THREE.Box3();
    const add = (y, z) => {
      for (const x of [g.x0, g.x1]) box.expandByPoint(_corner.set(x, y, z).applyMatrix4(this.matrix));
    };
    for (let i = 0; i <= 8; i++) for (const [a, b] of this._pose(i / 8)) for (const [y, z] of [a, b]) add(y, z + (g.style === 'tilt' ? 0 : g.T));
    return box.isEmpty() ? null : box.expandByScalar(0.05);
  }
}
