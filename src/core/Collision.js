import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { WALKABLE_NORMAL_Y } from '../config.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();
const _ray = new THREE.Ray();

/**
 * Collision world for the first-person player.
 *
 * Three kinds of colliders:
 *  1. Static triangle soup in an Octree – building walls, floors, props. Register with addStatic(object3D)
 *     (all meshes below it, InstancedMesh supported) or addStaticBox(box3). Call build() once after everything
 *     is registered. Objects with userData.noCollide = true (or any ancestor flagged) are skipped.
 *  2. Dynamic axis-aligned boxes that can be toggled at runtime – door leaves, the sectional port.
 *     addDynamicBox(box3) returns a handle { box, enabled }; mutate handle.box / handle.enabled freely.
 *  3. One heightfield (the terrain) – anything with getHeight(x,z), getNormal(x,z,target) and optionally
 *     getSurface(x,z).
 *
 * resolveCapsule(capsule) pushes a THREE Capsule out of everything and reports ground contact.
 */
export class CollisionWorld {
  constructor() {
    this.octree = new Octree();
    this._statics = [];
    this._staticBoxes = [];
    this.dynamic = [];
    this.heightfield = null;
    this.surfaceZones = [];
    /** true: dynamic boxes flagged `furniture` do not block the player (settings.physicalBody off). */
    this.ghostFurniture = false;
    this.waterLevel = -Infinity;
    this.maxWadeDepth = 0.7;
    this.bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
    /** Footstep surface on static/dynamic ground outside every surface zone (the house has wooden floors). */
    this.defaultSurface = 'wood';
    this.triangleCount = 0;
    this.built = false;

    this._result = {
      onGround: false,
      groundNormal: new THREE.Vector3(0, 1, 0),
      /** Normals of non-walkable contacts this call (for clipping velocity). Reused vectors. */
      wallNormals: [],
      wallCount: 0,
      /** Surface tag under the feet: 'wood' (default here) | 'tile' | 'rug' | 'concrete' ... (addSurfaceZone / defaultSurface) */
      surface: null,
      groundSource: null, // 'static' | 'dynamic' | 'terrain'
    };
    for (let i = 0; i < 8; i++) this._result.wallNormals.push(new THREE.Vector3());
  }

  /* ------------------------------------------------------------------ registration */

  /** Register an Object3D (mesh, group, InstancedMesh) whose triangles become static colliders. */
  addStatic(object3D) {
    if (this.built) console.warn('[collision] addStatic after build() – call build() again');
    this._statics.push(object3D);
  }

  /** Register an invisible static box collider (world space Box3). */
  addStaticBox(box3) {
    this._staticBoxes.push(box3.clone());
  }

  /**
   * Register a toggleable axis-aligned box (world space).
   * @returns {{ box: THREE.Box3, enabled: boolean, id?: string }}
   */
  addDynamicBox(box3, { enabled = true, id } = {}) {
    const handle = { box: box3.clone(), enabled, id };
    this.dynamic.push(handle);
    return handle;
  }

  removeDynamic(handle) {
    const i = this.dynamic.indexOf(handle);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  /** Terrain: { getHeight(x,z), getNormal(x,z,target), getSurface?(x,z) } */
  setHeightfield(heightfield) {
    this.heightfield = heightfield;
  }

  /**
   * Tag a world-space volume with a footstep surface (checked for static/dynamic ground). Later zones win.
   * @returns {{ box: THREE.Box3, surface: string }} handle for removeSurfaceZone (mutating handle.box is fine)
   */
  addSurfaceZone(box3, surface) {
    const zone = { box: box3.clone(), surface };
    this.surfaceZones.push(zone);
    return zone;
  }

  /** Removes a zone returned by addSurfaceZone (e.g. a rug that was moved or deleted). */
  removeSurfaceZone(zone) {
    const i = this.surfaceZones.indexOf(zone);
    if (i >= 0) this.surfaceZones.splice(i, 1);
  }

  setBounds(minX, maxX, minZ, maxZ) {
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  setWater(level, maxWadeDepth = 0.7) {
    this.waterLevel = level;
    this.maxWadeDepth = maxWadeDepth;
  }

  /** Builds the octree from everything registered with addStatic/addStaticBox. Safe to call again. */
  build() {
    this.octree.clear();
    let count = 0;
    const add = (a, b, c) => {
      this.octree.addTriangle(new THREE.Triangle(a.clone(), b.clone(), c.clone()));
      count++;
    };

    for (const root of this._statics) {
      root.updateWorldMatrix(true, true);
      root.traverse((obj) => {
        if (!obj.isMesh || isNoCollide(obj)) return;
        const geom = obj.geometry;
        const pos = geom.getAttribute('position');
        if (!pos) return;
        const index = geom.index;
        const triCount = index ? index.count / 3 : pos.count / 3;
        const instanceCount = obj.isInstancedMesh ? obj.count : 1;
        for (let inst = 0; inst < instanceCount; inst++) {
          if (obj.isInstancedMesh) {
            obj.getMatrixAt(inst, _mi);
            _m.multiplyMatrices(obj.matrixWorld, _mi);
          } else {
            _m.copy(obj.matrixWorld);
          }
          for (let t = 0; t < triCount; t++) {
            const ia = index ? index.getX(t * 3) : t * 3;
            const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
            const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
            _v1.fromBufferAttribute(pos, ia).applyMatrix4(_m);
            _v2.fromBufferAttribute(pos, ib).applyMatrix4(_m);
            _v3.fromBufferAttribute(pos, ic).applyMatrix4(_m);
            add(_v1, _v2, _v3);
          }
        }
      });
    }

    for (const box of this._staticBoxes) {
      const { min, max } = box;
      const c = [
        new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(max.x, max.y, min.z), new THREE.Vector3(min.x, max.y, min.z),
        new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3(max.x, max.y, max.z), new THREE.Vector3(min.x, max.y, max.z),
      ];
      const faces = [
        [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0],
      ];
      // the corner loops above run clockwise seen from outside; Octree's capsule test is one-sided (it ignores
      // triangles the capsule is behind), so emit them reversed – counter-clockwise, normals pointing out of the box
      for (const [a, b, cc, d] of faces) {
        add(c[a], c[cc], c[b]);
        add(c[a], c[d], c[cc]);
      }
    }

    if (count > 0) this.octree.build();
    this.triangleCount = count;
    this.built = true;
    return this;
  }

  /* ------------------------------------------------------------------ queries */

  /** Terrain height or -Infinity when there is no heightfield. */
  groundHeight(x, z) {
    return this.heightfield ? this.heightfield.getHeight(x, z) : -Infinity;
  }

  /** False outside the world bounds or where the terrain is deeper than wading depth under water. */
  isWalkable(x, z) {
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    if (this.heightfield && this.heightfield.getHeight(x, z) < this.waterLevel - this.maxWadeDepth) return false;
    return true;
  }

  /**
   * Push the capsule (THREE Capsule, mutated in place) out of all colliders.
   * Returns a shared result object (do not keep a reference across frames).
   */
  resolveCapsule(capsule) {
    const res = this._result;
    res.onGround = false;
    res.groundNormal.set(0, 1, 0);
    res.wallCount = 0;
    res.surface = null;
    res.groundSource = null;

    // 1) Static octree
    if (this.triangleCount > 0) {
      const hit = this.octree.capsuleIntersect(capsule);
      if (hit && hit.depth > 1e-10) {
        capsule.translate(_v1.copy(hit.normal).multiplyScalar(hit.depth));
        this._classify(res, hit.normal, 'static');
      }
    }

    // 2) Dynamic boxes (doors etc.)
    for (let i = 0; i < this.dynamic.length; i++) {
      const d = this.dynamic[i];
      if (!d.enabled || (d.furniture && this.ghostFurniture)) continue;
      if (pushCapsuleOutOfBox(capsule, d.box, _n)) this._classify(res, _n, 'dynamic');
    }

    // 3) Terrain heightfield
    const hf = this.heightfield;
    if (hf) {
      const c = capsule.start; // lower sphere centre
      const h = hf.getHeight(c.x, c.z);
      const bottom = c.y - capsule.radius;
      if (bottom < h + 0.02) {
        hf.getNormal(c.x, c.z, _n);
        if (_n.y >= WALKABLE_NORMAL_Y) {
          if (bottom < h) capsule.translate(_v1.set(0, h - bottom, 0));
          // within 2 cm counts as standing (prevents ground flicker on slopes)
          res.onGround = true;
          res.groundNormal.copy(_n);
          res.groundSource = 'terrain';
          res.surface = hf.getSurface ? hf.getSurface(c.x, c.z) : 'grass';
        } else if (bottom < h) {
          // Too steep: treat terrain locally as a plane and push out along its normal → slides off.
          const dist = _n.y * (c.y - h);
          const depth = capsule.radius - dist;
          if (depth > 0) capsule.translate(_v1.copy(_n).multiplyScalar(depth));
          // guarantee we never end up below the surface
          const nb = capsule.start.y - capsule.radius;
          if (nb < h - 0.25) capsule.translate(_v1.set(0, h - 0.25 - nb, 0));
          this._pushWall(res, _n);
        }
      }
    }

    if (res.onGround && res.groundSource !== 'terrain') {
      res.surface = this.surfaceAt(capsule.start.x, capsule.start.y - capsule.radius, capsule.start.z) ?? this.defaultSurface;
    }
    return res;
  }

  /** Surface tag at a world point, from surface zones. */
  surfaceAt(x, y, z) {
    _p.set(x, y, z);
    for (let i = this.surfaceZones.length - 1; i >= 0; i--) {
      if (this.surfaceZones[i].box.containsPoint(_p)) return this.surfaceZones[i].surface;
    }
    return null;
  }

  /**
   * Nearest hit along a ray against static triangles and enabled dynamic boxes.
   * @returns {{distance:number, point:THREE.Vector3, dynamic?:object}|null}
   */
  raycast(ray, maxDistance = Infinity, { includeDynamic = true, includeTerrain = false } = {}) {
    let best = null;
    if (this.triangleCount > 0) {
      const hit = this.octree.rayIntersect(ray);
      if (hit && hit.distance <= maxDistance) best = { distance: hit.distance, point: hit.position };
    }
    if (includeDynamic) {
      for (const d of this.dynamic) {
        if (!d.enabled) continue;
        const p = ray.intersectBox(d.box, _q);
        if (!p) continue;
        const dist = p.distanceTo(ray.origin);
        if (dist <= maxDistance && (!best || dist < best.distance)) best = { distance: dist, point: p.clone(), dynamic: d };
      }
    }
    if (includeTerrain && this.heightfield) {
      // coarse march + bisection
      const step = 0.5;
      const limit = Math.min(maxDistance, best ? best.distance : maxDistance, 300);
      let prev = 0;
      for (let t = step; t <= limit; t += step) {
        ray.at(t, _p);
        if (_p.y < this.heightfield.getHeight(_p.x, _p.z)) {
          let lo = prev, hi = t;
          for (let k = 0; k < 10; k++) {
            const mid = (lo + hi) / 2;
            ray.at(mid, _p);
            if (_p.y < this.heightfield.getHeight(_p.x, _p.z)) hi = mid; else lo = mid;
          }
          ray.at(hi, _p);
          if (!best || hi < best.distance) best = { distance: hi, point: _p.clone(), terrain: true };
          break;
        }
        prev = t;
      }
    }
    return best;
  }

  /** Convenience: is the straight segment a→b blocked by static/dynamic geometry? */
  segmentBlocked(a, b) {
    const dir = _v3.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return false;
    _ray.set(a, dir.multiplyScalar(1 / len));
    return !!this.raycast(_ray, len);
  }

  _classify(res, normal, source) {
    if (normal.y >= WALKABLE_NORMAL_Y) {
      res.onGround = true;
      if (normal.y > 0.999 || res.groundSource === null || normal.y > res.groundNormal.y) res.groundNormal.copy(normal);
      res.groundSource = source;
    } else {
      this._pushWall(res, normal);
    }
  }

  _pushWall(res, normal) {
    if (res.wallCount < res.wallNormals.length) res.wallNormals[res.wallCount++].copy(normal);
  }
}

function isNoCollide(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData && o.userData.noCollide) return true;
  return false;
}

/**
 * Push a capsule out of an axis-aligned box. Approximates the capsule segment with samples.
 * Writes the push direction into outNormal. Returns true if a push happened.
 */
function pushCapsuleOutOfBox(capsule, box, outNormal) {
  const r = capsule.radius;
  // quick reject: expanded box vs segment AABB
  const minX = Math.min(capsule.start.x, capsule.end.x) - r, maxX = Math.max(capsule.start.x, capsule.end.x) + r;
  const minY = Math.min(capsule.start.y, capsule.end.y) - r, maxY = Math.max(capsule.start.y, capsule.end.y) + r;
  const minZ = Math.min(capsule.start.z, capsule.end.z) - r, maxZ = Math.max(capsule.start.z, capsule.end.z) + r;
  if (maxX < box.min.x || minX > box.max.x || maxY < box.min.y || minY > box.max.y || maxZ < box.min.z || minZ > box.max.z) return false;

  const SAMPLES = 7;
  let bestDist = Infinity;
  const bestP = _v2;
  const bestQ = _v3;
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    _p.lerpVectors(capsule.start, capsule.end, t);
    box.clampPoint(_p, _q);
    const d = _p.distanceTo(_q);
    if (d < bestDist) {
      bestDist = d;
      bestP.copy(_p);
      bestQ.copy(_q);
    }
  }
  if (bestDist >= r) return false;

  if (bestDist > 1e-6) {
    outNormal.subVectors(bestP, bestQ).divideScalar(bestDist);
    capsule.translate(_p.copy(outNormal).multiplyScalar(r - bestDist));
    return true;
  }

  // Segment point inside the box: leave through the closest face (horizontal faces preferred for walls).
  const p = bestP;
  const exits = [
    [p.x - box.min.x, -1, 0, 0], [box.max.x - p.x, 1, 0, 0],
    [p.z - box.min.z, 0, 0, -1], [box.max.z - p.z, 0, 0, 1],
    [p.y - box.min.y + 0.5, 0, -1, 0], [box.max.y - p.y, 0, 1, 0],
  ];
  exits.sort((a, b) => a[0] - b[0]);
  const [dist, nx, ny, nz] = exits[0];
  outNormal.set(nx, ny, nz);
  capsule.translate(_p.copy(outNormal).multiplyScalar(dist + r));
  return true;
}
