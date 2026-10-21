import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { WALKABLE_NORMAL_Y } from '../config.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Smallest octree cell (m): a cell this small is never split further, however many triangles it holds. */
const OCTREE_MIN_CELL = 0.04;

/**
 * three's Octree with a floor on the cell size. Its own split() gives every subtree the default limits and goes on to
 * level 16 wherever more than 8 triangles share a point, an edge or a plane – a wall corner where the faces, end caps
 * and mitre slivers of several slabs meet, or nested boxes sharing faces. Over a line or an area that is hundreds of
 * thousands of cells: with the whole house the build never finished (the page hung at «Møblerer», integrator bølge 1
 * gruppe 2). Here a cell under OCTREE_MIN_CELL stays a leaf; the queries are three's (a node with triangles is a
 * leaf), only the candidate lists in dense spots grow a little.
 */
class HouseOctree extends Octree {
  split(level) {
    if (!this.box) return this;
    const half = new THREE.Vector3().copy(this.box.max).sub(this.box.min).multiplyScalar(0.5);
    const subTrees = [];
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          const box = new THREE.Box3();
          box.min.copy(this.box.min).add(new THREE.Vector3(x, y, z).multiply(half));
          box.max.copy(box.min).add(half);
          const t = new HouseOctree(box);
          t.trianglesPerLeaf = this.trianglesPerLeaf;
          t.maxLevel = this.maxLevel;
          subTrees.push(t);
        }
      }
    }
    let triangle;
    while ((triangle = this.triangles.pop())) {
      for (let i = 0; i < subTrees.length; i++) if (subTrees[i].box.intersectsTriangle(triangle)) subTrees[i].triangles.push(triangle);
    }
    const splittable = Math.max(half.x, half.y, half.z) > OCTREE_MIN_CELL;
    for (let i = 0; i < subTrees.length; i++) {
      const len = subTrees[i].triangles.length;
      if (len > this.trianglesPerLeaf && level < this.maxLevel && splittable) subTrees[i].split(level + 1);
      if (len !== 0) this.subTrees.push(subTrees[i]);
    }
    return this;
  }
}
const _mi = new THREE.Matrix4();
const _ray = new THREE.Ray();
/** cos 30°: a sloped summed octree push this close to a walkable face under the foot takes its normal (resolveCapsule). */
const FACE_MATCH = Math.cos((30 * Math.PI) / 180);

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
 *
 * Levels (notes/hele-huset-design.md §3.4, steg 20): the walkable area is one rectangle (setBounds, any height) or a
 * list of rectangles with a band of feet heights each (setBoundsList: one per level of the house, the forecourt
 * outside). isWalkable(x, z, y) tests the union – with y the feet (world), without y every rectangle counts.
 * groundHeight(x, z, y) is the terrain, or where the house has a floor (setFloorField(layout.house.floorYAt)) that
 * floor when it is higher. Neither the bounds nor the floor field collide: the floors, the slab and the stair wedge are
 * ordinary static colliders.
 */
export class CollisionWorld {
  constructor() {
    this.octree = new HouseOctree();
    this._statics = [];
    this._staticBoxes = [];
    this.dynamic = [];
    this.heightfield = null;
    this.surfaceZones = [];
    /** true: dynamic boxes flagged `furniture` do not block the player (settings.physicalBody off). */
    this.ghostFurniture = false;
    /** true: a sloped static push close to the walkable face under the foot takes that face's normal (resolveCapsule). */
    this.faceGround = true;
    this.waterLevel = -Infinity;
    this.maxWadeDepth = 0.7;
    /** The walkable rectangle (setBounds), or with a list (setBoundsList) the bounding rectangle of the list. */
    this.bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
    /** null, or [{ minX, maxX, minZ, maxZ, minY, maxY, levelId? }] (y = feet, world): the walkable area is their union. */
    this.boundsList = null;
    /** null, or (x, z, y) → world y of the house floor under / just above a point, or null (layout.house.floorYAt). */
    this.floorField = null;
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
      /** The static ground under the foot is a sloped walkable face (a stair wedge), not a floor, a sill or a step. */
      slope: false,
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

  /** One walkable rectangle at every height (replaces a list from setBoundsList). */
  setBounds(minX, maxX, minZ, maxZ) {
    this.bounds = { minX, maxX, minZ, maxZ };
    this.boundsList = null;
  }

  /**
   * Several walkable rectangles, each for a band of feet heights (world y): one per level (layout.house.walkRects),
   * the forecourt (outsideHouse.walkRects). The walkable area is their union; `bounds` becomes their bounding
   * rectangle. A missing minY / maxY is open (−∞ / +∞). An empty list or null goes back to the plain `bounds`.
   * @param {Array<{minX:number,maxX:number,minZ:number,maxZ:number,minY?:number|null,maxY?:number|null,levelId?:string}>|null} list
   */
  setBoundsList(list) {
    const rects = (list || [])
      .filter((r) => r && [r.minX, r.maxX, r.minZ, r.maxZ].every((v) => typeof v === 'number' && !Number.isNaN(v)))
      .map((r) => ({
        minX: r.minX,
        maxX: r.maxX,
        minZ: r.minZ,
        maxZ: r.maxZ,
        minY: typeof r.minY === 'number' && !Number.isNaN(r.minY) ? r.minY : -Infinity,
        maxY: typeof r.maxY === 'number' && !Number.isNaN(r.maxY) ? r.maxY : Infinity,
        levelId: r.levelId ?? null,
      }));
    if (!rects.length) {
      this.boundsList = null;
      return;
    }
    this.boundsList = rects;
    this.bounds = {
      minX: Math.min(...rects.map((r) => r.minX)),
      maxX: Math.max(...rects.map((r) => r.maxX)),
      minZ: Math.min(...rects.map((r) => r.minZ)),
      maxZ: Math.max(...rects.map((r) => r.maxZ)),
    };
  }

  /**
   * The house's floors as a query (not a collider): (x, z, y) → world y of the floor under / just above (x, y, z), or
   * null where the house has none (layout.house.floorYAt). groundHeight falls back to it.
   * @param {((x: number, z: number, y?: number) => number|null)|null} fn
   */
  setFloorField(fn) {
    this.floorField = typeof fn === 'function' ? fn : null;
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
      // a zero-area triangle (a mitre or profile sliver) never stops a capsule, but it crowds the octree's cells
      if (_p.subVectors(b, a).cross(_q.subVectors(c, a)).lengthSq() < 1e-14) return;
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

  /**
   * Ground height under a point: the terrain, or the house floor there (setFloorField) when that is higher; -Infinity
   * when there is neither. y (feet, world) picks the floor of the level the point is on – without it the highest one.
   */
  groundHeight(x, z, y) {
    const h = this.heightfield ? this.heightfield.getHeight(x, z) : -Infinity;
    if (!this.floorField) return h;
    const f = this.floorField(x, z, y);
    return typeof f === 'number' && f > h ? f : h;
  }

  /**
   * False outside the walkable area (setBounds / setBoundsList: with y (feet, world) only the rectangles whose band
   * holds y count, without y all of them) or where the terrain is deeper than wading depth under water.
   */
  isWalkable(x, z, y) {
    if (!this._inBounds(x, z, y)) return false;
    if (this.heightfield && this.heightfield.getHeight(x, z) < this.waterLevel - this.maxWadeDepth) return false;
    return true;
  }

  /**
   * How far (m) a point lies outside the walkable area: ≤ 0 inside (the deepest inside of the rectangles that hold it),
   * Infinity when no rectangle's band holds y.
   */
  outsideDistance(x, z, y) {
    const list = this.boundsList;
    if (!list) return outsideRect(this.bounds, x, z);
    let d = Infinity;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (y != null && (y < r.minY || y > r.maxY)) continue;
      d = Math.min(d, outsideRect(r, x, z));
    }
    return d;
  }

  _inBounds(x, z, y) {
    const list = this.boundsList;
    if (!list) {
      const b = this.bounds;
      return !(x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ);
    }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      if (y != null && (y < r.minY || y > r.maxY)) continue;
      return true;
    }
    return false;
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
    res.slope = false;

    // 1) Static octree
    if (this.triangleCount > 0) {
      const hit = this.octree.capsuleIntersect(capsule);
      if (hit && hit.depth > 1e-10) {
        // The octree sums the pushes of every triangle the capsule touches. On a slope of many triangles (the stair
        // wedge, notes/hele-huset-design.md §3.1) the neighbours' edges, and in the winders the steeper inner side
        // touching the body, tilt the sum: it came out up to ~30° off the face under the foot, under WALKABLE_NORMAL_Y
        // on the 42° wedge, and the ground snap then went on down and shoved the player along it, or pushed the player
        // back down the slope walking up (tools/test-stairs.mjs, the control runs). So a sloped sum close to the sloped
        // walkable face straight under the foot (within FACE_MATCH) takes that face's normal – the push is then made
        // vertical like any ground push. Only on sloped static ground: on a flat face below (every floor, sill and step
        // of the living room) and for flat pushes, walls and step noses nothing changes.
        let n = hit.normal;
        if (this.faceGround && n.y > 0.2 && n.y < 0.999 && this._faceBelow(capsule, _n2) && _n2.y >= WALKABLE_NORMAL_Y && _n2.y < 0.999 && _n2.dot(n) > FACE_MATCH) {
          n = _n2;
          res.slope = true;
        }
        capsule.translate(_v1.copy(hit.normal).multiplyScalar(hit.depth));
        this._classify(res, n, 'static');
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

  /**
   * Normal of the static face straight under the foot sphere's centre (front faces only), if one lies within reach of
   * the sphere on walkable ground (radius / WALKABLE_NORMAL_Y). Writes it into out.
   * @returns {boolean}
   */
  _faceBelow(capsule, out) {
    _ray.origin.copy(capsule.start);
    _ray.direction.set(0, -1, 0);
    const hit = this.octree.rayIntersect(_ray);
    if (!hit || hit.distance > capsule.radius / WALKABLE_NORMAL_Y + 0.02) return false;
    hit.triangle.getNormal(out);
    return out.y > 0;
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

/** How far (m) a point lies outside a rectangle { minX, maxX, minZ, maxZ }; ≤ 0 inside. */
function outsideRect(b, x, z) {
  return Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
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
