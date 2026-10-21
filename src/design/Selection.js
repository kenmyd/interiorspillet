// Selection – picking furniture, walls and windows with the mouse (ARCHITECTURE §11, §14). Owned by INTERACT.
//
//   new Selection(editor)
//   handleClick(ndc) → bool       canvas click: selects an item / wall / window (editor.select), or deselects; false
//                                 lets the InteractionSystem have the click (doors keep working)
//   pointerDown(event) → bool     left press on the canvas (Input.setPointerClaim in walk mode, ViewModes otherwise):
//                                 true when it lands on the selected item (→ move) or on its rotate handle or outline
//                                 (→ rotate): drag via Placement
//   update(dt), dispose()
//   hover                         { kind, uid?, wallId?, windowId?, name } under the cursor (null when none)
//   hoverSeat() → { uid, name, eye, yaw } | null   the hovered chair / sofa when it can be sat on (E, Game)
//
// Hover: rim glow (core/Highlight.js) + a small cursor hint («Lenestol – klikk for å endre»). The selected item gets an
// amber glow and a footprint gizmo on its underlay (outline, front arrow, rotate handle). The whole outline turns the
// item too: within EDGE_PX screen pixels of it (not on the item itself) the cursor becomes ROTATE_CURSOR and the rotate
// handle slides along the line under it. Keys for the selected item
// (only when no text field has focus): R / Shift+R ±15°, Delete/Backspace removes, D (Ctrl+D in walk mode, where D
// strafes) duplicates, arrow keys move 2 cm (Shift: 10 cm). Esc is handled by the Editor (deselect).
//
// Shared helpers for the other INTERACT modules (Placement, ViewModes): pickAt, cursorNDC, cursorClient,
// ndcFromClient, Footprint, hintUI, houseRoots, floorYAt, underlayY.
// The whole house (notes/hele-huset-design.md §5.3): picking also tests every room's surfaces and contents
// (home.roots.rooms[id], houseRoots – the bathroom, the basement …); the footprint gizmo stands on the floor of the
// item's level (the entrance's lower floor too) and only that level's rugs lift it.
import * as THREE from 'three';
import { Highlighter } from '../core/Highlight.js';
import { h, keycap } from '../ui/dom.js';
import { openPanels } from '../ui/panelKit.js';
import { SEAT, seatFor } from '../player/Seats.js';
import { MAIN_LEVEL, itemLevel, levelFloorY } from './SceneSync.js';

const DEG = Math.PI / 180;
/** Pixels the pointer may travel before a press on the selected item becomes a drag. */
const DRAG_PX = 5;
/** Screen pixels from the centre of the selected item's outline within which a press rotates the item. */
const EDGE_PX = 10;
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const SELECTABLE = new Set(['item', 'wall', 'window']);
/** Hover picking: walls, windows and items are targets; floor, ceilings and everything else only occlude. */
const HOVER = { want: SELECTABLE };
/** Visibility picking: the first visible surface of any kind (floor, wall, item …). */
const ANY = { want: { has: () => true } };

/**
 * The rotate cursor (CSS cursor value): an amber circular arrow with a dark rim, hotspot in its middle – over the
 * selected item's outline and rotate handle, and while turning the item (Placement).
 */
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<g stroke="#1d1402" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".9">' +
    '<path d="M21.5 9.5A8.5 8.5 0 1 1 8 13.1" fill="none" stroke-width="5.6"/>' +
    '<path d="M9.8 8.2L11.7 15.3L3.8 12.4Z" fill="#1d1402" stroke-width="2.6"/>' +
    '<circle cx="16" cy="16" r="1.7" fill="#ffb52e" stroke-width="1.4"/></g>' +
    '<path d="M21.5 9.5A8.5 8.5 0 1 1 8 13.1" fill="none" stroke="#ffb52e" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M9.8 8.2L11.7 15.3L3.8 12.4Z" fill="#ffb52e"/></svg>',
)}") 16 16, grab`;

const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _box = new THREE.Box3();

// ---------------------------------------------------------------------------------------------------------------
// Cached element rects: getBoundingClientRect after the frame's DOM writes forces a layout, so the canvas rect is
// read once and kept until the window or the canvas is resized.

const _rects = new WeakMap(); // element → { rect, dirty }
let _rectsEpoch = 0;
if (typeof window !== 'undefined') window.addEventListener('resize', () => _rectsEpoch++);

/**
 * The client rect of an element (canvas, ui root), cached until a resize.
 * @param {Element} el
 * @returns {DOMRect}
 */
export function cachedRect(el) {
  let c = _rects.get(el);
  if (!c) {
    c = { rect: null, epoch: -1, dirty: true };
    _rects.set(el, c);
    if (typeof ResizeObserver !== 'undefined') {
      try {
        new ResizeObserver(() => (c.dirty = true)).observe(el);
      } catch {
        /* resize events still invalidate */
      }
    }
  }
  if (c.dirty || c.epoch !== _rectsEpoch || !c.rect) {
    c.rect = el.getBoundingClientRect();
    c.epoch = _rectsEpoch;
    c.dirty = false;
  }
  return c.rect;
}

// ---------------------------------------------------------------------------------------------------------------
// Fast picking: a static bounding-volume hierarchy per geometry (built on the first pick, kept while its positions do
// not change), so the merged shell and big models cost a few dozen triangle tests per ray instead of all of them.

const BVH_MIN_TRIS = 256;
const BVH_LEAF = 8;
const _bvhs = new WeakMap(); // geometry → bvh
const _inv = new THREE.Matrix4();
const _lray = new THREE.Ray();
const _sphere = new THREE.Sphere();
const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _tc = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _bestP = new THREE.Vector3();
const _meshRaycast = THREE.Mesh.prototype.raycast;

function triCount(geo) {
  const pos = geo.attributes.position;
  return Math.floor((geo.index ? geo.index.count : pos.count) / 3);
}

function buildBVH(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = triCount(geo);
  const tb = new Float32Array(n * 6);
  const cen = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const o = t * 6;
    tb[o] = x0; tb[o + 1] = y0; tb[o + 2] = z0; tb[o + 3] = x1; tb[o + 4] = y1; tb[o + 5] = z1;
    cen[t * 3] = (x0 + x1) / 2; cen[t * 3 + 1] = (y0 + y1) / 2; cen[t * 3 + 2] = (z0 + z1) / 2;
  }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const boxes = [];
  const data = [];
  const build = (start, end) => {
    const node = data.length / 2;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let c0 = [Infinity, Infinity, Infinity], c1 = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i], o = t * 6;
      if (tb[o] < x0) x0 = tb[o];
      if (tb[o + 1] < y0) y0 = tb[o + 1];
      if (tb[o + 2] < z0) z0 = tb[o + 2];
      if (tb[o + 3] > x1) x1 = tb[o + 3];
      if (tb[o + 4] > y1) y1 = tb[o + 4];
      if (tb[o + 5] > z1) z1 = tb[o + 5];
      for (let a = 0; a < 3; a++) {
        const c = cen[t * 3 + a];
        if (c < c0[a]) c0[a] = c;
        if (c > c1[a]) c1[a] = c;
      }
    }
    boxes.push(x0, y0, z0, x1, y1, z1);
    data.push(start, end - start);
    if (end - start <= BVH_LEAF) return node;
    // split at the middle of the longest axis of the centroids (halves when everything lands on one side)
    let ax = 0;
    if (c1[1] - c0[1] > c1[ax] - c0[ax]) ax = 1;
    if (c1[2] - c0[2] > c1[ax] - c0[ax]) ax = 2;
    const mid = (c0[ax] + c1[ax]) / 2;
    let i = start, j = end - 1;
    while (i <= j) {
      if (cen[order[i] * 3 + ax] < mid) i++;
      else {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
        j--;
      }
    }
    let split = i;
    if (split <= start || split >= end) split = (start + end) >> 1;
    build(start, split);
    const right = build(split, end);
    data[node * 2] = right;
    data[node * 2 + 1] = 0; // internal: left child = node + 1
    return node;
  };
  if (n) build(0, n);
  // triangle → material index (multi-material meshes draw only the triangles inside a group)
  let triMat = null;
  if (geo.groups.length) {
    triMat = new Int32Array(n).fill(-1);
    for (const g of geo.groups) {
      const t0 = Math.floor(g.start / 3), t1 = Math.min(n, Math.floor((g.start + g.count) / 3));
      for (let t = t0; t < t1; t++) triMat[t] = g.materialIndex ?? 0;
    }
  }
  return {
    pos, idx, n, order, triMat, boxes: new Float32Array(boxes), data: new Int32Array(data),
    version: pos.version, iversion: idx?.version ?? 0, groups: geo.groups.length,
  };
}

function bvhOf(geo) {
  let b = _bvhs.get(geo);
  const pos = geo.attributes.position;
  if (!b || b.pos !== pos || b.version !== pos.version || b.idx !== geo.index || b.iversion !== (geo.index?.version ?? 0) || b.groups !== geo.groups.length) {
    b = buildBVH(geo);
    _bvhs.set(geo, b);
  }
  return b;
}

function hiddenMat(m) {
  return !m || m.visible === false || m.colorWrite === false || (m.transparent && m.opacity < 0.04);
}

/** Nearest hit of a local-space ray on a BVH'd mesh (triangles with invisible materials skipped), or null. */
function bvhNearest(mesh, bvh, ray) {
  const { boxes, data, order, triMat, pos, idx } = bvh;
  const geo = mesh.geometry;
  const mats = mesh.material;
  const multi = Array.isArray(mats);
  const dr = geo.drawRange;
  const t0 = Math.floor(Math.max(0, dr.start) / 3);
  const t1 = Number.isFinite(dr.count) ? Math.min(bvh.n, Math.floor((dr.start + dr.count) / 3)) : bvh.n;
  const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
  const dx = Math.abs(ray.direction.x) < 1e-12 ? 1e-12 : ray.direction.x;
  const dy = Math.abs(ray.direction.y) < 1e-12 ? 1e-12 : ray.direction.y;
  const dz = Math.abs(ray.direction.z) < 1e-12 ? 1e-12 : ray.direction.z;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let bestT = Infinity, best = -1;
  const stack = [0];
  while (stack.length) {
    const nd = stack.pop();
    const b = nd * 6;
    let lo = (boxes[b] - ox) * ix, hi = (boxes[b + 3] - ox) * ix;
    if (lo > hi) [lo, hi] = [hi, lo];
    let ly = (boxes[b + 1] - oy) * iy, hy = (boxes[b + 4] - oy) * iy;
    if (ly > hy) [ly, hy] = [hy, ly];
    if (ly > lo) lo = ly;
    if (hy < hi) hi = hy;
    let lz = (boxes[b + 2] - oz) * iz, hz = (boxes[b + 5] - oz) * iz;
    if (lz > hz) [lz, hz] = [hz, lz];
    if (lz > lo) lo = lz;
    if (hz < hi) hi = hz;
    if (hi < 0 || lo > hi + 1e-9 || lo > bestT) continue;
    const cnt = data[nd * 2 + 1];
    if (!cnt) {
      stack.push(data[nd * 2], nd + 1);
      continue;
    }
    const s = data[nd * 2];
    for (let i = s; i < s + cnt; i++) {
      const t = order[i];
      if (t < t0 || t >= t1) continue;
      const mi = triMat ? triMat[t] : 0;
      if (mi < 0) continue;
      const m = multi ? mats[mi] : mats;
      if (hiddenMat(m)) continue;
      const a = idx ? idx.getX(t * 3) : t * 3;
      const bb = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      _ta.fromBufferAttribute(pos, a);
      _tb.fromBufferAttribute(pos, bb);
      _tc.fromBufferAttribute(pos, c);
      const p = m.side === THREE.BackSide ? ray.intersectTriangle(_tc, _tb, _ta, true, _tp) : ray.intersectTriangle(_ta, _tb, _tc, m.side === THREE.FrontSide, _tp);
      if (!p) continue;
      const d = _tp.distanceTo(ray.origin);
      if (d < bestT) {
        bestT = d;
        best = t;
        _bestP.copy(_tp);
      }
    }
  }
  if (best < 0) return null;
  const a = idx ? idx.getX(best * 3) : best * 3;
  const b = idx ? idx.getX(best * 3 + 1) : best * 3 + 1;
  const c = idx ? idx.getX(best * 3 + 2) : best * 3 + 2;
  const normal = new THREE.Vector3();
  THREE.Triangle.getNormal(_ta.fromBufferAttribute(pos, a), _tb.fromBufferAttribute(pos, b), _tc.fromBufferAttribute(pos, c), normal);
  return { point: _bestP.clone(), face: { a, b, c, normal, materialIndex: triMat ? triMat[best] : 0 }, faceIndex: best };
}

/** Raycaster hits on one mesh: the BVH for big static meshes, three's own raycast for the rest. */
function raycastMesh(mesh, raycaster, out) {
  const geo = mesh.geometry;
  if (!geo?.attributes?.position || mesh.material === undefined) return;
  if (mesh.raycast !== _meshRaycast || mesh.isInstancedMesh || mesh.isSkinnedMesh || geo.morphAttributes?.position || triCount(geo) < BVH_MIN_TRIS) {
    mesh.raycast(raycaster, out);
    return;
  }
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  _sphere.copy(geo.boundingSphere).applyMatrix4(mesh.matrixWorld);
  if (!raycaster.ray.intersectsSphere(_sphere)) return;
  _inv.copy(mesh.matrixWorld).invert();
  _lray.copy(raycaster.ray).applyMatrix4(_inv);
  const hit = bvhNearest(mesh, bvhOf(geo), _lray);
  if (!hit) return;
  hit.point.applyMatrix4(mesh.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(hit.point);
  if (distance < raycaster.near || distance > raycaster.far) return;
  out.push({ distance, point: hit.point, object: mesh, face: hit.face, faceIndex: hit.faceIndex });
}

const _itemBoxes = new WeakMap(); // item root → { box (world, a little padded), m: matrixWorld elements, n: children }

/** World bounds of an item model, cached while it does not move (models are rebuilt as new roots). */
function itemBox(root) {
  const m = root.matrixWorld.elements;
  let c = _itemBoxes.get(root);
  let same = !!c && c.n === root.children.length;
  if (same) for (let i = 0; i < 16; i++) if (c.m[i] !== m[i]) { same = false; break; }
  if (!same) {
    c ||= { box: new THREE.Box3(), m: new Float64Array(16), n: 0 };
    c.box.setFromObject(root).expandByScalar(0.02);
    c.m.set(m);
    c.n = root.children.length;
    _itemBoxes.set(root, c);
  }
  return c.box;
}

/**
 * Like raycaster.intersectObjects(roots, true) for meshes, but faster: hidden subtrees, highlight overlays and
 * ghosts are skipped, big meshes use a cached BVH (nearest visible hit per mesh). Sorted by distance.
 * @param {THREE.Object3D[]} roots
 * @param {THREE.Raycaster} raycaster
 * @returns {object[]}
 */
export function intersectFast(roots, raycaster) {
  const out = [];
  const stack = [...roots];
  while (stack.length) {
    const o = stack.pop();
    if (!o.visible || o.userData?.isHighlight || o.userData?.ghost) continue;
    // a furniture model the ray does not come near: skip all its meshes at once
    if (o.userData?.pick?.kind === 'item' && !raycaster.ray.intersectsBox(itemBox(o))) continue;
    if (o.isMesh && o.layers.test(raycaster.layers)) raycastMesh(o, raycaster, out);
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Cursor + picking helpers (shared with Placement / ViewModes)

/**
 * Client pixels → normalised device coordinates of the canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {number} x  clientX
 * @param {number} y  clientY
 * @param {THREE.Vector2} [target]
 * @returns {THREE.Vector2}
 */
export function ndcFromClient(canvas, x, y, target = new THREE.Vector2()) {
  const r = cachedRect(canvas);
  return target.set(((x - r.left) / Math.max(1, r.width)) * 2 - 1, -((y - r.top) / Math.max(1, r.height)) * 2 + 1);
}

/**
 * The cursor in NDC in any view mode: ViewModes outside walk mode, Input in walk mode (screen centre while the
 * pointer is captured, e.g. FPS mouse mode).
 * @param {object} editor
 * @param {THREE.Vector2} [target]
 * @returns {THREE.Vector2|null}
 */
export function cursorNDC(editor, target = new THREE.Vector2()) {
  const views = editor.views;
  if (views && views.isWalking === false && views.pointerNDC) return views.pointerNDC(target);
  const input = editor.input;
  if (input?.isCaptured) return target.set(0, 0);
  return input?.getPointerNDC?.(target) ?? null;
}

/**
 * The cursor in client pixels ({ x, y }) for HUD hints, or null when hidden / unknown.
 * @param {object} editor
 * @returns {{ x: number, y: number }|null}
 */
export function cursorClient(editor) {
  const views = editor.views;
  if (views && views.isWalking === false) return views.pointerClient ?? null;
  const input = editor.input;
  if (!input || input.isCaptured) return null;
  const p = input.pointerClient;
  return p && p.known && p.inside ? { x: p.x, y: p.y } : null;
}

function pickOf(object) {
  for (let o = object; o; o = o.parent) if (o.userData?.pick) return o.userData.pick;
  return null;
}

function visibleChain(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function isUnder(object, root) {
  for (let o = object; o; o = o.parent) if (o === root) return true;
  return false;
}

function invisibleMaterial(mesh, hit) {
  let m = mesh.material;
  if (Array.isArray(m)) m = m[hit.face?.materialIndex ?? 0] ?? m[0];
  return !m || m.visible === false || m.colorWrite === false || (m.transparent && m.opacity < 0.04);
}

/** Per-home lookup of window anchors (shading lives in them) → window id. */
const _anchorMaps = new WeakMap();
function anchorMap(home) {
  let map = _anchorMaps.get(home);
  if (!map) {
    map = new Map();
    for (const w of home.windows || []) if (w.anchor) map.set(w.anchor, w.id);
    _anchorMaps.set(home, map);
  }
  return map;
}

/**
 * What a raw hit on a scene mesh means for the editor.
 * @returns {{ kind: string, uid?: string, wallId?: string, windowId?: string, ceilingId?: string }}
 */
function classify(editor, object, point) {
  const home = editor.home;
  const pick = pickOf(object);
  if (pick) return pick;
  const hw = home.highWall;
  if (hw?.anchor && isUnder(object, hw.anchor)) return { kind: 'wall', wallId: hw.wallId, design: true };
  const anchors = anchorMap(home);
  for (let o = object; o; o = o.parent) {
    const id = anchors.get(o);
    if (id) return { kind: 'window', windowId: id };
  }
  // frames, sashes and sills of a window count as the window
  const layout = editor.layout;
  if (layout?.windows && point && (object.userData.ixShell || isUnder(object, home.roots.shell) || isUnder(object, home.roots.shading))) {
    for (const o of layout.windows) {
      _box.copy(o.hole).expandByScalar(0.09);
      if (_box.containsPoint(point)) return { kind: 'window', windowId: o.id };
    }
  }
  return { kind: 'other' };
}

/**
 * Picks the scene under a point in NDC, with real occlusion: the room shell, the kitchen and every item are tested,
 * hits on meshes hidden by the view (dollhouse walls, ceilings) are skipped.
 *
 * @param {object} editor
 * @param {{ x: number, y: number }} ndc
 * @param {object} [opts]
 * @param {Set<string>} [opts.want]     kinds that count as a result (default item / wall / window); the first hit of
 *                                      any other kind stops the search (occluder) unless it is in `pass`
 * @param {Set<string>} [opts.pass]     kinds to look through (e.g. items when hanging a picture behind a sofa)
 * @param {(hit: object) => boolean} [opts.accept]  extra filter on a wanted hit (false → keep looking)
 * @param {Set<string>|string} [opts.exclude]  item uid(s) to look through (the dragged item)
 * @param {THREE.Camera} [opts.camera]
 * @returns {{ kind: string, uid?: string, wallId?: string, windowId?: string, ceilingId?: string, object: THREE.Object3D,
 *   point: THREE.Vector3, normal: THREE.Vector3, distance: number, ray: THREE.Ray }|null}
 */
export function pickAt(editor, ndc, opts = {}) {
  if (!ndc) return null;
  const want = opts.want ?? SELECTABLE;
  const pass = opts.pass ?? null;
  const exclude = typeof opts.exclude === 'string' ? new Set([opts.exclude]) : opts.exclude ?? null;
  const home = editor.home;
  const views = editor.views;
  const cam = opts.camera ?? editor.activeCamera;
  cam.updateMatrixWorld();
  _ray.setFromCamera(_v2.set(ndc.x, ndc.y), cam);
  _ray.far = 200;
  const roots = [];
  for (const o of editor.sync.objects()) if (o.visible) roots.push(o);
  for (const k of ['shell', 'kitchen', 'wall', 'shading']) if (home.roots?.[k]) roots.push(home.roots[k]);
  roots.push(...houseRoots(home)); // the other rooms' surfaces and built-ins (bathroom, basement …)
  for (const r of views?.pickRoots?.() || []) roots.push(r); // the overview's cut copy of the shell
  const hits = intersectFast(roots, _ray);
  for (const hit of hits) {
    const o = hit.object;
    if (!o.isMesh || o.userData.isHighlight || o.userData.ghost) continue;
    if (views?.isConcealed?.(o) || !visibleChain(o) || invisibleMaterial(o, hit)) continue;
    const target = classify(editor, o, hit.point);
    if (target.kind === 'item' && exclude?.has(target.uid)) continue;
    if (!want.has(target.kind)) {
      if (pass?.has(target.kind)) continue;
      return null;
    }
    const normal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      _m3.getNormalMatrix(o.matrixWorld);
      normal.copy(hit.face.normal).applyMatrix3(_m3).normalize();
    }
    if (normal.dot(_ray.ray.direction) > 0) normal.negate();
    const result = { ...target, object: o, point: hit.point.clone(), normal, distance: hit.distance, ray: _ray.ray.clone() };
    if (opts.accept && !opts.accept(result)) {
      if (pass?.has(target.kind) || target.kind === 'item') continue;
      return null;
    }
    return result;
  }
  return null;
}

/**
 * The scene roots of the house's rooms for picking (notes/hele-huset-design.md §5.3, integrator W0): every room's
 * surfaces (walls, floors, ceilings, doors, windows – rooms.js; the stair) and contents (built-ins, lamp fittings).
 * Not roots.levels (roots.shell and roots.kitchen are in there too); the living room's own group is empty.
 * @param {object} home
 * @returns {THREE.Object3D[]}
 */
export function houseRoots(home) {
  const out = [];
  for (const r of Object.values(home?.roots?.rooms || {})) {
    if (r?.surfaces?.children?.length) out.push(r.surfaces);
    if (r?.contents?.children?.length) out.push(r.contents);
  }
  return out;
}

/** Display name for an item ('Lenestol' …). */
export function itemName(item) {
  return item?.name || 'Møbel';
}

// ---------------------------------------------------------------------------------------------------------------
// Footprint gizmo (selected item, placement ghost)

const ROUND = /round|globe|dome|tub-swivel|mushroom|pouf|ring|molecule|woven|tiered|cylinder|plant|vase|basket|candle|tripod|felt-shape/;
const TONES = { selected: 0xffb52e, ghost: 0xf4f1ea, warn: 0xff6a5c, blocked: 0xff6a5c };

function roundedRectPath(path, w, d, r) {
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4));
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x1, y1 - r);
  path.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  path.lineTo(x0 + r, y1);
  path.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x0, y0 + r);
  path.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}

/** Rounded-rectangle ring (outline) of outer size w × d and line width lw, in the shape's x/y plane. */
function ringGeometry(w, d, lw, r) {
  const s = roundedRectPath(new THREE.Shape(), w, d, r);
  const inner = Math.max(0.0005, r - lw);
  if (w > 2 * lw + 0.002 && d > 2 * lw + 0.002) s.holes.push(roundedRectPath(new THREE.Path(), w - 2 * lw, d - 2 * lw, inner));
  return new THREE.ShapeGeometry(s, 12);
}

function fillGeometry(w, d, r) {
  return new THREE.ShapeGeometry(roundedRectPath(new THREE.Shape(), w, d, r), 12);
}

/** Segments per rounded corner when the outline is measured on screen (Footprint.hitEdge). */
const RING_ARC = 6;

/**
 * Points (local x, z) along the centre line of the outline – a rounded rectangle of half sizes hw × hd and corner
 * radius rc – as a closed polygon, flat [x0, z0, x1, z1 …]; the straight sides are the gaps between the corners.
 */
function ringPoints({ hw, hd, rc }, out = []) {
  out.length = 0;
  const ia = hw - rc, ib = hd - rc;
  const corners = [ia, ib, -ia, ib, -ia, -ib, ia, -ib];
  for (let q = 0; q < 4; q++) {
    for (let k = 0; k <= RING_ARC; k++) {
      const a = ((q + k / RING_ARC) * Math.PI) / 2;
      out.push(corners[q * 2] + rc * Math.cos(a), corners[q * 2 + 1] + rc * Math.sin(a));
    }
  }
  return out;
}

/** The point of the outline's centre line (ringPoints) nearest to the local point (x, z). */
function nearestOnRing(x, z, { hw, hd, rc }, out = {}) {
  const ia = hw - rc, ib = hd - rc;
  const cx = clamp(x, -ia, ia), cz = clamp(z, -ib, ib);
  const dx = x - cx, dz = z - cz;
  const len = Math.hypot(dx, dz);
  if (len > 1e-6) {
    out.x = cx + (dx / len) * rc;
    out.z = cz + (dz / len) * rc;
  } else if (hw - Math.abs(x) < hd - Math.abs(z)) {
    // inside the straight part: out to the nearest side
    out.x = x < 0 ? -hw : hw;
    out.z = z;
  } else {
    out.x = x;
    out.z = z < 0 ? -hd : hd;
  }
  return out;
}

/** Canvas texture: an amber disc with a dark circular arrow (the rotate handle). */
function handleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffb52e';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(29,20,2,0.95)';
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(64, 64, 32, -Math.PI * 0.15, Math.PI * 1.35, false);
  g.stroke();
  // arrow head at the start of the arc (pointing counter-clockwise)
  const a = -Math.PI * 0.15;
  const px = 64 + 32 * Math.cos(a), py = 64 + 32 * Math.sin(a);
  g.fillStyle = 'rgba(29,20,2,0.95)';
  g.beginPath();
  g.moveTo(px + 20, py - 4);
  g.lineTo(px - 8, py - 14);
  g.lineTo(px - 2, py + 16);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The footprint gizmo: an outline around the item on its underlay (floor, rug, table top) or on the wall, a front
 * arrow, a rotate handle and – for ceiling items – a dashed plumb line down to the outline on the floor. Sizes are
 * kept constant on screen. Not pickable by pickAt (it is not under any home root); the rotate handle is tested with
 * hitHandle(), the outline (which rotates too) with hitEdge(). The handle sits off a corner, or on the outline where
 * setGrip() puts it (under the cursor, and where it was grabbed while turning).
 */
export class Footprint {
  /** @param {object} editor */
  constructor(editor, { name = 'ix-footprint' } = {}) {
    this.editor = editor;
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.visible = false;
    this.group.userData.noCollide = true;
    const base = { transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 };
    this.mats = {
      line: new THREE.MeshBasicMaterial({ ...base, color: TONES.selected, opacity: 0.95 }),
      fill: new THREE.MeshBasicMaterial({ ...base, color: TONES.selected, opacity: 0.1 }),
      arrow: new THREE.MeshBasicMaterial({ ...base, color: TONES.selected, opacity: 0.95, side: THREE.DoubleSide }),
      handle: new THREE.MeshBasicMaterial({ ...base, map: handleTexture(), opacity: 1 }),
      plumb: new THREE.LineDashedMaterial({ color: TONES.selected, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
    };
    const mk = (mat, order) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.renderOrder = order;
      m.castShadow = m.receiveShadow = false;
      m.userData.noHighlight = true;
      m.userData.noCollide = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.fill = mk(this.mats.fill, 20);
    this.outline = mk(this.mats.line, 21);
    this.arrow = mk(this.mats.arrow, 22);
    this.handle = mk(this.mats.handle, 23);
    this.handle.geometry = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.plumbGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
    this.plumb = new THREE.Line(this.plumbGeo, this.mats.plumb);
    this.plumb.renderOrder = 20;
    this.plumb.frustumCulled = false;
    this.plumb.userData.noCollide = true;
    this.plumbHolder = new THREE.Group(); // world space, outside the rotated group
    this.plumbHolder.add(this.plumb);
    this.plumbHolder.visible = false;
    // helpers, not part of the room: «Bilde» (P) leaves them out
    this.group.userData.isGhost = true;
    this.plumbHolder.userData.isGhost = true;
    editor.scene.add(this.group, this.plumbHolder);
    this._key = '';
    this._tone = 'selected';
    this.hasHandle = false;
    /** Where the rotate handle sits on the outline instead of its corner ({ x, z } local), or null. */
    this.grip = null;
    this._ring = null; // centre line of the outline (floor-like items): { hw, hd, rc } local
    this._home = new THREE.Vector3(); // the rotate handle's own place, off a front corner
    this._pts = [];
  }

  /**
   * Shows the gizmo for an item (or a placement candidate).
   * @param {object} it  { mount, archetype, position: [x,y,z], rotationDeg, dims, attach? }
   * @param {object} [o]
   * @param {'selected'|'ghost'|'warn'|'blocked'} [o.tone]
   * @param {boolean} [o.handles]  front arrow (+ rotate handle) for floor-like items
   * @param {boolean} [o.rotateHandle]  the rotate handle (default = handles)
   * @param {THREE.Object3D} [o.object]  the built object (wall items: its orientation; ceiling items: plumb top)
   * @param {number} [o.baseY]  height of the outline (default: the item's base / the floor or rug under it)
   */
  show(it, { tone = 'selected', handles = true, rotateHandle = handles, object = null, baseY } = {}) {
    if (!it?.dims) return this.hide();
    const cam = this.editor.activeCamera;
    const mount = it.mount || 'floor';
    const wall = mount === 'wall';
    const { w, d, h: hh } = it.dims;
    // the item's level: its floor and its rugs (the basement lies under the first floor, at the same x/z)
    const lv = itemLevel(it, this.editor.layout);
    const p = it.position || [0, 0, 0];
    const g = this.group;
    // position + orientation
    if (wall && object) {
      object.updateMatrixWorld();
      g.position.setFromMatrixPosition(object.matrixWorld);
      g.quaternion.setFromRotationMatrix(_tmpM.extractRotation(object.matrixWorld));
    } else if (wall) {
      const n = it.attach?.normal;
      g.position.set(p[0], p[1], p[2]);
      g.rotation.set(0, n ? Math.atan2(n[0], n[2]) : (it.rotationDeg || 0) * DEG, 0);
    } else {
      let y = baseY;
      if (y == null && mount === 'ceiling') {
        // on whatever is below the lamp (the table top), else the floor
        if (object) _box.setFromObject(object);
        const from = object && Number.isFinite(_box.min.y) ? _box.min.y - 0.02 : levelFloorY(this.editor.layout, lv) + 2.2;
        y = this.editor.placement?.dropY?.(p[0], from, p[2], it.uid) ?? underlayY(this.editor, p[0], p[2], null, 'floor', lv);
      }
      if (y == null) y = mount === 'floor' || mount === 'rug' ? underlayY(this.editor, p[0], p[2], it.uid, mount, lv) : p[1];
      g.position.set(p[0], y + 0.004, p[2]);
      g.rotation.set(0, (it.rotationDeg || 0) * DEG, 0);
    }
    g.updateMatrixWorld(true);
    // screen-constant sizes
    const wpp = worldPerPixel(cam, g.position, this.editor.renderer);
    const lw = quant(clamp(2.6 * wpp, 0.006, 0.06), 0.002);
    const margin = quant(clamp(5 * wpp, 0.02, 0.12), 0.005);
    const sx = wall ? w : w;
    const sy = wall ? hh : d;
    const round = !wall && ROUND.test(it.archetype || '') && Math.abs(w - d) < 0.12 * Math.max(w, d);
    const ow = sx + 2 * margin, od = sy + 2 * margin;
    const r = round ? Math.min(ow, od) / 2 : Math.min(0.05, Math.min(ow, od) * 0.18) + margin * 0.5;
    const showHandles = handles && !wall;
    const arrowS = quant(clamp(16 * wpp, 0.05, 0.3), 0.005);
    const key = `${wall ? 'w' : 'f'}|${ow.toFixed(3)}|${od.toFixed(3)}|${lw}|${r.toFixed(3)}|${showHandles ? arrowS : 0}`;
    if (key !== this._key) {
      this._key = key;
      const rot = (geo) => (wall ? geo.translate(0, 0, 0.006) : geo.rotateX(-Math.PI / 2));
      this.outline.geometry.dispose();
      this.outline.geometry = rot(ringGeometry(ow, od, lw, r));
      this.fill.geometry.dispose();
      this.fill.geometry = rot(fillGeometry(ow - lw, od - lw, Math.max(0.001, r - lw / 2)));
      this.arrow.geometry.dispose();
      if (showHandles) {
        // chevron in front of the front edge (local +z)
        const s = arrowS;
        const sh = new THREE.Shape();
        sh.moveTo(-s * 0.6, 0);
        sh.lineTo(0, -s * 0.62);
        sh.lineTo(s * 0.6, 0);
        sh.lineTo(s * 0.6 - s * 0.22, 0);
        sh.lineTo(0, -s * 0.36);
        sh.lineTo(-s * 0.6 + s * 0.22, 0);
        sh.closePath();
        this.arrow.geometry = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2).translate(0, 0, od / 2 + s * 0.25);
      } else this.arrow.geometry = new THREE.BufferGeometry();
    }
    const showRotate = showHandles && rotateHandle;
    this.arrow.visible = showHandles;
    this.handle.visible = showRotate;
    this.hasHandle = showRotate;
    if (wall) this._ring = null;
    else {
      const ring = (this._ring ||= { hw: 0, hd: 0, rc: 0 });
      ring.hw = (ow - lw) / 2;
      ring.hd = (od - lw) / 2;
      ring.rc = clamp(r - lw / 2, 0, Math.min(ring.hw, ring.hd));
    }
    if (showRotate) {
      const hr = quant(clamp(11 * wpp, 0.035, 0.22), 0.005);
      this.handle.scale.setScalar(hr);
      const off = hr * 1.25 + lw;
      this._home.set(ow / 2 + off * 0.75, 0.001, od / 2 + off * 0.75);
      this._placeHandle();
    }
    this._setTone(tone);
    g.visible = true;
    // plumb line for ceiling items: from the bottom of the lamp down to the outline
    if (mount === 'ceiling' && object) {
      _box.setFromObject(object);
      const top = Number.isFinite(_box.min.y) ? _box.min.y : p[1];
      const arr = this.plumbGeo.attributes.position.array;
      arr[0] = g.position.x; arr[1] = g.position.y; arr[2] = g.position.z;
      arr[3] = g.position.x; arr[4] = Math.max(g.position.y + 0.05, top); arr[5] = g.position.z;
      this.plumbGeo.attributes.position.needsUpdate = true;
      this.plumbGeo.computeBoundingSphere();
      this.plumb.computeLineDistances();
      this.plumbHolder.visible = true;
    } else this.plumbHolder.visible = false;
  }

  hide() {
    this.group.visible = false;
    this.plumbHolder.visible = false;
    this.hasHandle = false;
    this.grip = null;
  }

  get visible() {
    return this.group.visible;
  }

  /**
   * Puts the rotate handle on the outline at a local point (from hitEdge), or back off its corner (null).
   * @param {{ x: number, z: number }|null} p
   */
  setGrip(p) {
    if (p ? this.grip?.x === p.x && this.grip?.z === p.z : !this.grip) return;
    this.grip = p ? { x: p.x, z: p.z } : null;
    this._placeHandle();
  }

  _placeHandle() {
    if (!this.hasHandle) return;
    if (this.grip && this._ring) {
      // on the line (the outline's size follows the zoom: snap the grip onto it again)
      const q = nearestOnRing(this.grip.x, this.grip.z, this._ring, _grip);
      this.handle.position.set(q.x, 0.002, q.z);
    } else this.handle.position.copy(this._home);
  }

  /** True when the NDC point is over the rotate handle. */
  hitHandle(ndc, camera = this.editor.activeCamera) {
    if (!this.group.visible || !this.hasHandle || !ndc) return false;
    _ray.setFromCamera(_v2.set(ndc.x, ndc.y), camera);
    this.group.updateMatrixWorld(true);
    const hits = _ray.intersectObject(this.handle, false);
    if (hits.length) return true;
    // a little forgiveness around the disc
    const c = new THREE.Vector3().setFromMatrixPosition(this.handle.matrixWorld);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -c.y);
    const p = _ray.ray.intersectPlane(plane, new THREE.Vector3());
    return !!p && p.distanceTo(c) < this.handle.scale.x * 1.35;
  }

  /**
   * The point of the outline nearest to an NDC point, when it lies within `px` screen pixels of it and is not hidden
   * there (behind the item itself, under a table …): { x, z } in the gizmo's local plane (for setGrip), or null.
   * Measured on screen, so the band is equally wide at every distance and zoom, in every view.
   * @param {{ x: number, y: number }} ndc
   * @param {THREE.Camera} [camera]
   * @param {number} [px]
   * @returns {{ x: number, z: number }|null}
   */
  hitEdge(ndc, camera = this.editor.activeCamera, px = EDGE_PX) {
    const ring = this._ring;
    if (!this.group.visible || !this.hasHandle || !ring || !ndc) return null;
    const rect = cachedRect(this.editor.renderer.domElement);
    const W = Math.max(1, rect.width), H = Math.max(1, rect.height);
    const mx = ((ndc.x + 1) / 2) * W, my = ((1 - ndc.y) / 2) * H;
    camera.updateMatrixWorld();
    this.group.updateMatrixWorld(true);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.group.matrixWorld);
    // segments behind the camera (walking right beside the item) are cut at its near plane
    const wMin = camera.isPerspectiveCamera ? camera.near : -Infinity;
    const pts = ringPoints(ring, this._pts);
    const n = pts.length / 2;
    let best = px, gx = 0, gz = 0, sx = 0, sy = 0, found = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      _ca.set(ax, 0, az, 1).applyMatrix4(_pm);
      _cb.set(bx, 0, bz, 1).applyMatrix4(_pm);
      if (_ca.w < wMin && _cb.w < wMin) continue;
      if (_ca.w < wMin || _cb.w < wMin) {
        const s = (wMin - _ca.w) / (_cb.w - _ca.w);
        if (_ca.w < wMin) {
          _ca.lerp(_cb, s);
          ax += (bx - ax) * s;
          az += (bz - az) * s;
        } else {
          _cb.lerpVectors(_ca, _cb, s);
          bx = ax + (bx - ax) * s;
          bz = az + (bz - az) * s;
        }
      }
      const pax = ((_ca.x / _ca.w + 1) / 2) * W, pay = ((1 - _ca.y / _ca.w) / 2) * H;
      const pbx = ((_cb.x / _cb.w + 1) / 2) * W, pby = ((1 - _cb.y / _cb.w) / 2) * H;
      const dx = pbx - pax, dy = pby - pay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 1e-9 ? clamp(((mx - pax) * dx + (my - pay) * dy) / l2, 0, 1) : 0;
      const d = Math.hypot(pax + dx * t - mx, pay + dy * t - my);
      if (d >= best) continue;
      best = d;
      found = true;
      sx = pax + dx * t;
      sy = pay + dy * t;
      // screen → segment parameter (perspective-correct)
      const s = (t * _ca.w) / ((1 - t) * _cb.w + t * _ca.w);
      gx = ax + (bx - ax) * s;
      gz = az + (bz - az) * s;
    }
    if (!found) return null;
    const g = nearestOnRing(gx, gz, ring, {});
    // hidden there: something visible lies in front of the outline along the ray through it
    _v2b.set((sx / W) * 2 - 1, 1 - (sy / H) * 2);
    const hit = pickAt(this.editor, _v2b, { ...ANY, camera });
    if (hit) {
      const at = this.group.localToWorld(_tmpV.set(g.x, 0, g.z)).sub(hit.ray.origin).dot(hit.ray.direction);
      if (hit.distance < at - 0.03) return null;
    }
    return g;
  }

  _setTone(tone) {
    if (tone === this._tone) return;
    this._tone = tone;
    const c = TONES[tone] ?? TONES.selected;
    this.mats.line.color.setHex(c);
    this.mats.fill.color.setHex(c);
    this.mats.arrow.color.setHex(c);
    this.mats.plumb.color.setHex(c);
    this.mats.fill.opacity = tone === 'ghost' ? 0.06 : tone === 'selected' ? 0.1 : 0.14;
  }

  dispose() {
    this.group.removeFromParent();
    this.plumbHolder.removeFromParent();
    for (const m of [this.outline, this.fill, this.arrow, this.handle]) m.geometry.dispose();
    this.plumbGeo.dispose();
    this.mats.handle.map?.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

const _tmpM = new THREE.Matrix4();
const _tmpV = new THREE.Vector3();
const _pm = new THREE.Matrix4();
const _ca = new THREE.Vector4();
const _cb = new THREE.Vector4();
const _v2b = new THREE.Vector2();
const _grip = { x: 0, z: 0 };

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function quant(v, q) {
  return Math.round(v / q) * q;
}

/** World size of one screen pixel at a point (perspective or orthographic camera). */
export function worldPerPixel(cam, point, renderer) {
  const hpx = Math.max(1, renderer?.domElement?.clientHeight || window.innerHeight || 720);
  if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / Math.max(1e-3, cam.zoom) / hpx;
  const dist = Math.max(0.2, _tmpV.setFromMatrixPosition(cam.matrixWorld).distanceTo(point));
  return (2 * dist * Math.tan((cam.fov * DEG) / 2)) / hpx;
}

/**
 * World y of the floor of a level under (x, z): the floor of the level's room there (the entrance lies 0.30 under
 * the basement's floor), else the level's floor. The main level without house data: 0, as before.
 * @param {object} layout
 * @param {number} x
 * @param {number} z
 * @param {string} [level]
 * @returns {number}
 */
export function floorYAt(layout, x, z, level = MAIN_LEVEL) {
  const base = levelFloorY(layout, level);
  const h = layout?.house;
  if (typeof h?.roomAt !== 'function') return base;
  const room = h.roomAt(x, base + 0.9, z, { levelId: level });
  return Number.isFinite(room?.floorY) ? room.floorY : base;
}

/**
 * Height (world y) of the floor or the top of a rug under (x, z) on a level – where an outline on the floor should
 * be drawn. Only rugs of that level count (the basement lies under the first floor, at the same x/z).
 */
export function underlayY(editor, x, z, selfUid = null, mount = 'floor', level = MAIN_LEVEL) {
  const layout = editor.layout;
  let y = floorYAt(layout, x, z, level);
  if (mount === 'rug') return y;
  for (const it of editor.design.list({ mount: 'rug' })) {
    if (it.uid === selfUid || it.hidden || itemLevel(it, layout) !== level) continue;
    const t = (it.rotationDeg || 0) * DEG;
    const dx = x - it.position[0], dz = z - it.position[2];
    const lx = dx * Math.cos(t) - dz * Math.sin(t);
    const lz = dx * Math.sin(t) + dz * Math.cos(t);
    if (Math.abs(lx) <= it.dims.w / 2 && Math.abs(lz) <= it.dims.d / 2) y = Math.max(y, (it.position[1] || 0) + it.dims.h);
  }
  return y;
}

// ---------------------------------------------------------------------------------------------------------------
// HUD hints: a small pill next to the cursor and a key bar above the toolbar

const STYLE_ID = 'ix-style';
const CSS = `
.ix-layer { position: absolute; inset: 0; pointer-events: none; z-index: 6; overflow: hidden; }
.ix-layer--tip { z-index: 9; }
.ix-tip { position: absolute; left: 0; top: 0; display: inline-flex; align-items: center; gap: 0.5em; max-width: 32em;
  padding: 0.34em 0.75em; border-radius: 1em; background: rgba(10, 16, 23, 0.84); border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 0.4em 1.2em rgba(0, 0, 0, 0.35); color: var(--kv-ink); font-size: 0.86em; line-height: 1.25; white-space: nowrap;
  opacity: 0; transition: opacity 0.12s ease; will-change: transform; }
.ix-tip.is-visible { opacity: 1; }
.ix-tip__dot { width: 0.5em; height: 0.5em; border-radius: 50%; background: var(--kv-accent); flex: none; }
.ix-tip__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ix-tip__sub { color: var(--kv-ink-3); flex: none; }
.ix-tip--warn { border-color: rgba(255, 106, 92, 0.6); }
.ix-tip--warn .ix-tip__dot { background: var(--kv-danger); }
.ix-tip--warn .ix-tip__sub { color: #ffb0a6; }
.ix-tip--ok .ix-tip__dot { background: var(--kv-ok); }
.ix-keys { position: absolute; left: 50%; bottom: 6.3em; transform: translateX(-50%); display: flex; align-items: center; gap: 1em;
  padding: 0.38em 1em; border-radius: 2em; background: rgba(10, 16, 23, 0.74); border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--kv-ink-2); font-size: 0.8em; white-space: nowrap; opacity: 0; transition: opacity 0.15s ease; max-width: calc(100% - 2em); overflow: hidden; }
.ix-keys.is-visible { opacity: 1; }
.ix-keys__item { display: inline-flex; align-items: center; gap: 0.35em; }
.ix-keys__item .kv-key { font-size: 0.78em; min-width: 1.7em; height: 1.7em; }
.ix-keys__title { color: var(--kv-accent); font-weight: 600; }
.ix-roomlabel { position: absolute; left: 0; top: 0; text-align: center; color: #2a2724; padding: 0.22em 0.65em 0.26em;
  border-radius: 0.6em; background: rgba(255, 253, 249, 0.8); box-shadow: 0 0.15em 0.6em rgba(0, 0, 0, 0.18);
  font-weight: 700; font-size: 0.86em; letter-spacing: 0.02em; white-space: nowrap; line-height: 1.2; }
.ix-roomlabel small { display: block; font-weight: 500; font-size: 0.82em; color: rgba(42, 39, 36, 0.66); }
.ix-scalebar { position: absolute; left: 1.4em; top: 1.4em; display: flex; flex-direction: column; gap: 0.25em; padding: 0.45em 0.7em 0.4em;
  border-radius: 0.6em; background: rgba(10, 16, 23, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.8em; color: var(--kv-ink-2); }
.ix-scalebar__bar { height: 0.42em; border: 2px solid var(--kv-ink); border-top: none; }
.ix-scalebar__row { display: flex; align-items: center; justify-content: space-between; gap: 0.8em; }
.ix-scalebar__north { font-weight: 700; color: var(--kv-accent); }
.ix-scalebar__level { font-weight: 700; color: var(--kv-ink); letter-spacing: 0.02em; }
.ix-scalebar__level[hidden] { display: none; }
`;

const _hints = new WeakMap();

/**
 * The editor's shared hint layer. Owners request a tip / key bar every frame with a priority; the highest request
 * of the frame is shown (applied after the frame in a microtask).
 * @param {object} editor
 * @returns {HintUI}
 */
export function hintUI(editor) {
  let hint = _hints.get(editor);
  if (!hint) {
    hint = new HintUI(editor);
    _hints.set(editor, hint);
  }
  return hint;
}

class HintUI {
  constructor(editor) {
    this.editor = editor;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.append(style);
    }
    this.layer = h('div.ix-layer.kv-scale', { 'aria-hidden': 'true' });
    this.tipEl = h('div.ix-tip');
    this.keysEl = h('div.ix-keys');
    // the cursor tip sits above the side panels (it follows the cursor over the canvas only)
    this.tipLayer = h('div.ix-layer.ix-layer--tip.kv-scale', { 'aria-hidden': 'true' });
    this.layer.append(this.keysEl);
    this.tipLayer.append(this.tipEl);
    (editor.uiRoot || document.body).append(this.layer, this.tipLayer);
    this._tip = null;
    this._keys = null;
    this._tipKey = '';
    this._keysKey = '';
    this._tipSize = [120, 24];
    this._tipVisible = false;
    this._tipXY = '';
    this._keysBottom = '';
    this._scheduled = false;
    this._users = 0;
    this._layout = null;
    this._layoutAt = -1e9;
    this._layoutSig = '';
  }

  /** Call once per frame: the hints are re-evaluated after the frame even when nobody asks for one (→ hidden). */
  tick() {
    this._schedule();
  }

  /** Request the cursor tip for this frame: { text, sub?, tone?: 'info'|'warn'|'ok' } | null. */
  tip(value, priority = 0) {
    if (value && (!this._tip || priority >= this._tip.priority)) this._tip = { ...value, priority };
    this._schedule();
  }

  /** Request the key bar for this frame: { title?, items: [[keys[], text]] } | null. */
  keys(value, priority = 0) {
    if (value && (!this._keys || priority >= this._keys.priority)) this._keys = { ...value, priority };
    this._schedule();
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /**
   * Where the HUD is on screen (client px), read at most ~5× a second or when panels open / close / the window is
   * resized – not every frame (each read after the frame's DOM writes forces a layout):
   * { layer, toolbar, panels: [{ side, rect }], keys, toasts: [rect] }.
   */
  layout(force = false) {
    const panels = openPanels();
    const sig = `${panels.map((p) => p.id).join(',')}|${window.innerWidth}x${window.innerHeight}|${this._keysKey ? 1 : 0}`;
    const now = performance.now();
    if (!force && this._layout && sig === this._layoutSig && now - this._layoutAt < 220) return this._layout;
    this._layoutSig = sig;
    this._layoutAt = now;
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const bar = document.querySelector('.ip-toolbar');
    const toolbar = bar && !bar.hidden && bar.offsetParent !== null ? rect(bar) : null;
    const list = [];
    for (const p of panels) {
      if (!p.el || p.el.hidden || p.modal || p.side === 'center') continue;
      const r = rect(p.el);
      if (r.width > 0 && r.height > 0) list.push({ side: p.side, id: p.id, rect: r });
    }
    const toasts = [];
    for (const el of document.querySelectorAll('.kv-toast')) {
      const r = rect(el);
      if (r.width > 0 && r.height > 0) toasts.push(r);
    }
    const keys = this._keysKey ? rect(this.keysEl) : null;
    this._layout = { layer: rect(this.tipLayer), toolbar, panels: list, keys: keys && keys.width > 0 ? keys : null, toasts };
    return this._layout;
  }

  /**
   * The part of the canvas no HUD covers (client px): between the toolbar (and the key bar above it) and the top,
   * right of open left panels, left of open right panels, above open bottom panels.
   * @param {{ sides?: boolean }} [o]  sides: false ignores the side panels (the plan / overview zoom fit)
   */
  freeRect({ sides = true } = {}) {
    const L = this.layout();
    const c = cachedRect(this.editor.renderer.domElement);
    let left = c.left + 12, right = c.right - 12, top = c.top + 12, bottom = c.bottom - 12;
    if (L.toolbar) bottom = Math.min(bottom, L.toolbar.top - 46); // the key bar sits just above the toolbar
    for (const p of L.panels) {
      if (p.side === 'bottom') bottom = Math.min(bottom, p.rect.top - 12);
      else if (!sides) continue;
      else if (p.side === 'left') left = Math.max(left, p.rect.right + 12);
      else if (p.side === 'right') right = Math.min(right, p.rect.left - 12);
    }
    if (right - left < 160) right = left + 160;
    if (bottom - top < 120) bottom = top + 120;
    return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  }

  /** Applies this frame's requests to the DOM (normally automatic). Reads (cached rects) come before the writes. */
  flush() {
    this._scheduled = false;
    const tip = this._tip;
    const keys = this._keys;
    this._tip = null;
    this._keys = null;
    // key bar first (the tip avoids it)
    if (keys) {
      const key = JSON.stringify([keys.title, keys.items]);
      if (key !== this._keysKey) {
        this._keysKey = key;
        const kids = [];
        if (keys.title) kids.push(h('span.ix-keys__title', { text: keys.title }));
        for (const [ks, text] of keys.items) {
          const item = h('span.ix-keys__item');
          for (const k of ks) item.append(keycap(k, { wide: k.length > 2 }));
          item.append(h('span', { text }));
          kids.push(item);
        }
        this.keysEl.replaceChildren(...kids);
        this._layoutAt = -1e9; // its width changed
      }
      // sit just above the toolbar, whatever its height
      const L = this.layout();
      const lr = cachedRect(this.layer);
      const bottom = L.toolbar && L.toolbar.height ? Math.max(8, lr.bottom - L.toolbar.top + 10) : null;
      const css = bottom != null ? `${Math.round(bottom)}px` : '';
      if (this._keysBottom !== css) {
        this._keysBottom = css;
        this.keysEl.style.bottom = css;
      }
      // centred in the part of the screen side panels leave free (not under the inspector)
      const f = this.freeRect();
      const left = `${Math.round(f.cx - lr.left)}px`;
      const maxW = `${Math.round(Math.max(200, f.width + 24))}px`;
      if (this._keysLeft !== left || this._keysMaxW !== maxW) {
        this._keysLeft = left;
        this._keysMaxW = maxW;
        this.keysEl.style.left = left;
        this.keysEl.style.maxWidth = maxW;
      }
      this.keysEl.classList.add('is-visible');
    } else if (this._keysKey) {
      this._keysKey = '';
      this.keysEl.classList.remove('is-visible');
    }
    // tip
    const pos = tip ? cursorClient(this.editor) : null;
    let placed = null;
    if (tip && pos) {
      const key = `${tip.text}|${tip.sub || ''}|${tip.tone || ''}`;
      if (key !== this._tipKey) {
        this._tipKey = key;
        this.tipEl.className = `ix-tip${this._tipVisible ? ' is-visible' : ''}${tip.tone === 'warn' ? ' ix-tip--warn' : tip.tone === 'ok' ? ' ix-tip--ok' : ''}`;
        this.tipEl.replaceChildren(h('span.ix-tip__dot'), h('span.ix-tip__name', { text: tip.text }), tip.sub ? h('span.ix-tip__sub', { text: tip.sub }) : '');
        // measured once per new text (not every frame)
        this._tipSize = [this.tipEl.offsetWidth || 120, this.tipEl.offsetHeight || 24];
      }
      placed = this._placeTip(pos);
    }
    if (placed) {
      const xy = `translate(${Math.round(placed[0])}px, ${Math.round(placed[1])}px)`;
      if (xy !== this._tipXY) {
        this._tipXY = xy;
        this.tipEl.style.transform = xy;
      }
      if (!this._tipVisible) {
        this._tipVisible = true;
        this.tipEl.classList.add('is-visible');
      }
    } else if (this._tipVisible || this._tipKey) {
      if (!tip) this._tipKey = '';
      this._tipVisible = false;
      this.tipEl.classList.remove('is-visible');
    }
  }

  /**
   * Where the cursor tip goes (tip-layer px) – beside the cursor, on whichever side keeps it off the panels, the
   * toolbar, the key bar and the toasts – or null (hidden) when the cursor itself is over a panel / the toolbar.
   */
  _placeTip(pos) {
    const L = this.layout();
    const lr = L.layer;
    const [tw, th] = this._tipSize;
    const blockers = L.panels.map((p) => p.rect);
    if (L.toolbar) blockers.push(L.toolbar);
    const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (blockers.some((r) => inside(r, pos.x, pos.y))) return null;
    const avoid = [...blockers, ...L.toasts];
    if (L.keys) avoid.push(L.keys);
    const hitsAny = (x, y, list) => list.some((r) => x < r.right + 4 && x + tw > r.left - 4 && y < r.bottom + 4 && y + th > r.top - 4);
    const within = (x, y) => x >= lr.left + 8 && y >= lr.top + 8 && x + tw <= lr.right - 8 && y + th <= lr.bottom - 8;
    const cands = [
      [pos.x + 16, pos.y + 20],
      [pos.x - tw - 12, pos.y + 20],
      [pos.x + 16, pos.y - th - 14],
      [pos.x - tw - 12, pos.y - th - 14],
    ];
    let pick = cands.find(([x, y]) => within(x, y) && !hitsAny(x, y, avoid));
    // nowhere free of toasts / the key bar: at least off the panels and the toolbar
    if (!pick) pick = cands.find(([x, y]) => within(x, y) && !hitsAny(x, y, blockers));
    if (!pick) return null;
    return [pick[0] - lr.left, pick[1] - lr.top];
  }

  dispose() {
    this.layer.remove();
    this.tipLayer.remove();
    _hints.delete(this.editor);
  }
}

// ---------------------------------------------------------------------------------------------------------------

export class Selection {
  /** @param {import('./Editor.js').Editor} editor */
  constructor(editor) {
    this.editor = editor;
    this.hint = hintUI(editor);
    // selected: mostly outline, so the colour the user just picked stays readable
    this.selectedGlow = new Highlighter({ color: 0xffb52e, glow: 0.22 });
    this.hoverGlow = new Highlighter({ color: 0xfff3dc });
    this.footprint = new Footprint(editor, { name: 'ix-selection' });
    this.hover = null;
    this._selObj = null;
    this._hoverKey = '';
    this._lastNdc = new THREE.Vector2(9, 9);
    this._lastCam = new THREE.Matrix4();
    this._pickAge = 0;
    this._pickUid = null; // the selected item at the last pick (a new selection picks again)
    this._rot = null; // _rotateAt() under the cursor: a press there turns the selected item
    this._press = null;
    this._ndc = new THREE.Vector2();
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
    this._onMove = (e) => this._pressMove(e);
    this._onUp = (e) => this._pressUp(e);
    this._offBuilt = editor.sync.on('built', ({ uid }) => {
      if (uid === editor.selected?.uid) this._selObj = null; // re-attach the glow to the rebuilt model
      if (uid === this.hover?.uid) this._hoverKey = '';
    });
    // walk mode: left presses on the selected item belong to us (no mouse-look), arrow keys nudge it
    editor.input?.setPointerClaim?.((e) => this.pointerDown(e));
    editor.input?.setKeyClaim?.((e) => this._claimKey(e));
    try {
      this.selectedGlow.warm(editor.renderer, editor.camera);
    } catch {
      /* warm-up is optional */
    }
  }

  // ---- clicks ------------------------------------------------------------------------------------------------

  /**
   * A click on the canvas (NDC). Returns true when the click was used (something selected), false to let the
   * InteractionSystem have it (doors …). A click on empty space deselects.
   * @param {{ x: number, y: number }} ndc
   */
  handleClick(ndc) {
    const e = this.editor;
    const hit = pickAt(e, ndc, HOVER);
    const it = e.views?.isWalking !== false ? e.game?.interaction?.target : null;
    if (it && (!hit || it.hit.distance <= hit.distance + 0.05)) return false;
    if (!hit) {
      if (e.selected?.kind) e.select(null);
      return false;
    }
    if (hit.kind === 'item') {
      if (e.selected?.uid !== hit.uid) e.events.emit('sfx', { name: 'ui-click', volume: 0.6 });
      e.select({ kind: 'item', uid: hit.uid });
    } else if (hit.kind === 'wall') e.select({ kind: 'wall', wallId: hit.wallId, point: hit.point }); // WallPanel picks the element under it
    else if (hit.kind === 'window') e.select({ kind: 'window', windowId: hit.windowId, point: hit.point });
    return true;
  }

  /**
   * Left press on the canvas. Claims it (returns true) when it lands on the selected item (→ drag to move) or on
   * its rotate handle or outline (→ drag to rotate); a claimed press on the item that never moves still selects like
   * a click.
   * @param {PointerEvent|MouseEvent} ev
   * @returns {boolean}
   */
  pointerDown(ev) {
    const e = this.editor;
    if (ev.button !== 0 || this._press || e.placement?.isActive) return false;
    const sel = e.selected;
    if (sel?.kind !== 'item') return false;
    const item = e.design.get(sel.uid);
    if (!item || item.hidden) return false;
    const canvas = e.renderer.domElement;
    const ndc = ndcFromClient(canvas, ev.clientX, ev.clientY, new THREE.Vector2());
    let kind = null;
    const hit = pickAt(e, ndc, HOVER);
    const grip = item.locked ? null : this._rotateAt(ndc, hit);
    if (grip) {
      kind = 'rotate';
      if (!grip.handle) this.footprint.setGrip(grip); // the handle jumps to where the outline was grabbed
    } else if (hit?.kind === 'item' && hit.uid === sel.uid) kind = 'move';
    else return false;
    if (item.locked) {
      e.events.emit('toast', { text: `${itemName(item)} er låst og kan ikke flyttes`, seconds: 2.5 });
      return false;
    }
    this._press = { uid: sel.uid, kind, hit, x: ev.clientX, y: ev.clientY, ndc };
    window.addEventListener('pointermove', this._onMove, true);
    window.addEventListener('mousemove', this._onMove, true);
    window.addEventListener('pointerup', this._onUp, true);
    window.addEventListener('mouseup', this._onUp, true);
    return true;
  }

  _pressMove(ev) {
    const p = this._press;
    if (!p) return;
    if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < DRAG_PX) return;
    this._endPress();
    const pl = this.editor.placement;
    if (p.kind === 'rotate') pl?.beginRotate?.(p.uid, { clientX: p.x, clientY: p.y });
    else pl?.beginDrag?.(p.uid, p.hit, ev);
  }

  _pressUp(ev) {
    const p = this._press;
    if (!p || ev.button !== 0) return;
    this._endPress();
    // a press without a drag is an ordinary click (on the rotate handle or the outline: nothing)
    if (p.kind === 'move') this.editor.handleClick(p.ndc);
  }

  _endPress() {
    this._press = null;
    this._pickAge = 1; // pick again on the next frame (the cursor may still be on the outline)
    window.removeEventListener('pointermove', this._onMove, true);
    window.removeEventListener('mousemove', this._onMove, true);
    window.removeEventListener('pointerup', this._onUp, true);
    window.removeEventListener('mouseup', this._onUp, true);
  }

  /**
   * Whether a press at ndc would turn the selected item: on its outline → { x, z } (the outline point, for
   * Footprint.setGrip), on its rotate handle → { handle: true }, else null. The item itself wins over its outline
   * (a press on it moves it), and so does another piece standing on the line (a stool beside the chair: a click
   * selects that one). The handle off its corner wins over both, as before; slid onto the outline it is part of the
   * line (the cursor moving onto the item sends it back).
   * @param {{ x: number, y: number }} ndc
   * @param {object|null} hit  pickAt(ndc, HOVER) – what the cursor is on
   * @returns {{ x: number, z: number }|{ handle: true }|null}
   */
  _rotateAt(ndc, hit) {
    const fp = this.footprint;
    if (!fp.hasHandle || !ndc) return null;
    const onItem = hit?.kind === 'item' && (hit.uid === this.editor.selected?.uid || hit.point.y > fp.group.position.y + 0.03);
    const p = onItem ? null : fp.hitEdge(ndc);
    if (p) return p;
    return (!onItem || !fp.grip) && fp.hitHandle(ndc) ? { handle: true } : null;
  }

  // ---- per frame ---------------------------------------------------------------------------------------------

  update(dt) {
    const e = this.editor;
    this.hint.tick();
    const sel = e.selected;
    const uid = sel?.kind === 'item' ? sel.uid : null;
    const item = uid ? e.design.get(uid) : null;
    const obj = item ? e.sync.getObject(uid) : null;
    if (obj !== this._selObj) {
      this._selObj = obj;
      this.selectedGlow.set(obj && obj.visible ? obj : null);
    }
    this.selectedGlow.update();

    const placing = !!e.placement?.isPlacing;
    const drag = e.placement?.dragState ?? null;

    // footprint gizmo of the selected item
    if (item && obj && !item.hidden && !placing) {
      const tone = drag && drag.uid === uid && drag.status !== 'ok' ? 'warn' : 'selected';
      this.footprint.show(item, { tone, handles: !item.locked && item.mount !== 'wall', object: obj });
    } else this.footprint.hide();

    // hover (not while placing or dragging)
    let hover = null;
    // no hover while the mouse turns the view (right drag in walk mode): the cursor is hidden then
    const looking = e.views?.isWalking !== false && e.input?.isMouseLook && e.input?.settings?.get?.('mouseMode') !== 'fps';
    if (!placing && !drag && !this._press && !looking && this._inputLive()) {
      const ndc = cursorNDC(e, this._ndc);
      if (ndc) {
        const cam = e.activeCamera;
        cam.updateMatrixWorld();
        this._pickAge += dt || 0;
        // picking (BVH, ≈ 0.1 ms): right away when the cursor moves, ~6×/s while only the camera moves (walking,
        // the overview's damping), a refresh every 0.5 s otherwise (the scene may have changed under the cursor)
        const pointerMoved = ndc.distanceToSquared(this._lastNdc) > 1e-8;
        const camMoved = !cam.matrixWorld.equals(this._lastCam);
        const moved = pointerMoved || (camMoved && this._pickAge > 0.16) || this._pickAge > 0.5 || uid !== this._pickUid;
        if (moved) {
          this._pickUid = uid;
          this._lastNdc.copy(ndc);
          this._lastCam.copy(cam.matrixWorld);
          this._pickAge = 0;
          const hit = pickAt(e, ndc, HOVER);
          const it = e.views?.isWalking !== false ? e.game?.interaction?.target : null;
          this.hover = hit && !(it && it.hit.distance <= hit.distance + 0.05) ? this._describe(hit) : null;
          // on the selected item's outline or rotate handle: a press there turns it (no hover target under it)
          this._rot = this._rotateAt(ndc, hit);
          if (this._rot) this.hover = null;
        }
        hover = this.hover;
      } else this.hover = this._rot = null;
    } else this.hover = this._rot = null;

    // the rotate handle slides along the outline under the cursor (and stays where it was grabbed while turning)
    if (!this.footprint.hasHandle) this._rot = null; // deselected / locked since the last pick
    const turning = this._press?.kind === 'rotate' || (drag?.kind === 'rotate' && drag.uid === uid);
    if (!turning && !this._rot?.handle) this.footprint.setGrip(this._rot);

    const key = hover ? `${hover.kind}:${hover.uid || hover.wallId || hover.windowId}` : '';
    if (key !== this._hoverKey) {
      this._hoverKey = key;
      this.hoverGlow.set(hover && !(hover.kind === 'item' && hover.uid === uid) ? this._glowRoots(hover) : null);
    }
    this.hoverGlow.update();

    if (item && (this._rot || this._press?.kind === 'rotate')) {
      this.hint.tip({ text: itemName(item), sub: '– dra for å rotere' }, 1);
      e.hud?.setCursor?.(ROTATE_CURSOR);
    } else if (hover) {
      this.hint.tip({ text: hover.name, sub: hover.action }, 1);
      e.hud?.setCursor?.(hover.kind === 'item' && hover.uid === uid && !item?.locked ? 'grab' : 'pointer');
    } else if (!placing && !drag && !e.views?.isWalking && !e.game?.interaction?.target) {
      e.hud?.setCursor?.('default');
    }

    // key bar for the selected item
    if (item && !placing && !drag) {
      const walking = e.views?.isWalking !== false;
      const items = [];
      if (item.mount !== 'wall') items.push([['R'], 'roter']);
      items.push([['←', '→', '↑', '↓'], 'flytt litt']);
      items.push([[walking ? 'Ctrl+D' : 'D'], 'dupliser']);
      items.push([['Del'], 'fjern']);
      items.push([['Esc'], 'ferdig']);
      this.hint.keys({ title: item.locked ? `${itemName(item)} (låst)` : itemName(item), items: item.locked ? [[['Esc'], 'ferdig']] : items }, 2);
    }
  }

  /** Hover/selection only while the game has the mouse (no modal, not paused). */
  _inputLive() {
    const e = this.editor;
    if (e.game?.paused || e.blocksGameInput?.()) return false;
    if (e.views?.isWalking === false) return true;
    return e.input?.enabled !== false || !e.game?.inputBlocked;
  }

  /**
   * The chair, sofa, stool or pouf under the cursor when it can be sat on from here (walk mode, within SEAT.reach):
   * { uid, name, eye, yaw } (player/Seats.js), or null. Game binds E to it.
   */
  hoverSeat() {
    const hov = this.hover;
    if (hov?.kind !== 'item' || !hov.point || !(hov.distance <= SEAT.reach) || this.editor.views?.isWalking === false) return null;
    if (this._seatFor?.hover === hov) return this._seatFor.seat;
    const seat = seatFor(hov.object || this.editor.sync.getObject(hov.uid), this.editor.design.get(hov.uid), hov.point);
    this._seatFor = { hover: hov, seat: seat ? { ...seat, uid: hov.uid, name: hov.name } : null };
    return this._seatFor.seat;
  }

  /** Name and action text for a hover target. */
  _describe(hit) {
    const e = this.editor;
    if (hit.kind === 'item') {
      const item = e.design.get(hit.uid);
      if (!item) return null;
      const selected = e.selected?.kind === 'item' && e.selected.uid === hit.uid;
      const action = item.locked ? 'låst' : selected ? 'dra for å flytte' : 'klikk for å endre';
      // point / distance: hoverSeat() sits where you aim on a sofa
      return { kind: 'item', uid: hit.uid, name: itemName(item), action: `– ${action}`, object: e.sync.getObject(hit.uid), point: hit.point, distance: hit.distance };
    }
    if (hit.kind === 'wall') {
      const high = hit.wallId === e.home.highWall?.wallId;
      const wall = e.home.walls?.find((w) => w.id === hit.wallId);
      return { kind: 'wall', wallId: hit.wallId, name: high ? 'Den høye veggen' : wall?.name || 'Vegg', action: high ? '– klikk for forslag' : '– klikk for å endre farge', object: hit.object };
    }
    if (hit.kind === 'window') {
      const win = e.home.windows?.find((w) => w.id === hit.windowId);
      // the window's own name («Stort vindu ved sofaen»), so it is clear which one the shading goes on
      const name = win?.name || (win?.type === 'terrace-door' ? 'Terrassedør' : 'Vindu');
      return { kind: 'window', windowId: hit.windowId, name, action: '– klikk for solskjerming', object: hit.object, title: win?.name };
    }
    return null;
  }

  /** Meshes to glow for a hover target. */
  _glowRoots(hover) {
    const e = this.editor;
    if (hover.kind === 'item') return hover.object || e.sync.getObject(hover.uid);
    if (hover.kind === 'wall') {
      const wall = e.home.walls?.find((w) => w.id === hover.wallId);
      const roots = [...(wall?.meshes || [hover.object])];
      if (hover.wallId === e.home.highWall?.wallId && e.home.highWall.anchor) roots.push(e.home.highWall.anchor);
      return roots.filter((m) => !e.views?.isConcealed?.(m));
    }
    if (hover.kind === 'window') {
      // the glass, the window's own frame parts (named after the opening) and its sun shading
      const id = hover.windowId;
      this._winParts ||= new Map();
      let roots = this._winParts.get(id);
      if (!roots) {
        roots = [];
        e.home.roots?.shell?.traverse((o) => {
          if (o.isMesh && (o.userData.pick?.windowId === id || (o.name && o.name.split(':').includes(id)))) roots.push(o);
        });
        this._winParts.set(id, roots);
      }
      const win = e.home.windows?.find((w) => w.id === id);
      const list = roots.filter((m) => !e.views?.isConcealed?.(m));
      if (win?.anchor) list.push(win.anchor);
      return list.length ? list : hover.object;
    }
    return null;
  }

  // ---- keys --------------------------------------------------------------------------------------------------

  /** Input key claim: arrow keys (and Ctrl+D) belong to the selected item, not to walking. */
  _claimKey(e) {
    const ed = this.editor;
    if (ed.selected?.kind !== 'item' || ed.placement?.isPlacing || !ed.keysActive()) return false;
    if (ARROWS.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
    if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) return true;
    return false;
  }

  _key(e) {
    const ed = this.editor;
    const sel = ed.selected;
    if (sel?.kind !== 'item' || !ed.keysActive() || ed.placement?.isPlacing || ed.placement?.dragState) return;
    const item = ed.design.get(sel.uid);
    if (!item) return;
    const mod = e.ctrlKey || e.metaKey;
    if (ARROWS.has(e.code) && !mod && !e.altKey) {
      e.preventDefault();
      if (!item.locked) this._nudge(item, e.code, e.shiftKey ? 0.1 : 0.02);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyD' && !e.altKey && (mod || ed.views?.isWalking === false)) {
      e.preventDefault();
      this._duplicate(item);
      return;
    }
    if (mod || e.altKey || item.locked) return;
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      ed.design.remove(sel.uid);
      ed.select(null);
      ed.events.emit('toast', { text: `${itemName(item)} er fjernet – Ctrl+Z angrer`, seconds: 3 });
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      if (item.mount === 'wall') {
        ed.events.emit('toast', { text: 'Ting på veggen følger veggen', seconds: 2 });
        return;
      }
      const cur = item.rotationDeg || 0;
      const next = e.shiftKey ? Math.ceil(cur / 15 - 1e-6) * 15 - 15 : Math.floor(cur / 15 + 1e-6) * 15 + 15;
      const patch = { rotationDeg: normDeg(next) };
      const fixed = ed.placement?.constrain?.({ ...item, rotationDeg: patch.rotationDeg });
      if (fixed?.position) patch.position = fixed.position;
      ed.design.update(sel.uid, patch, { label: `Roter ${itemName(item)}`, coalesce: 'rotate' });
    }
  }

  /** Arrow-key nudge: view-relative, snapped to the room axes; along the wall / up-down for wall items. */
  _nudge(item, code, step) {
    const ed = this.editor;
    const p = [...item.position];
    if (item.mount === 'wall') {
      const n = item.attach?.normal || [Math.sin((item.rotationDeg || 0) * DEG), 0, Math.cos((item.rotationDeg || 0) * DEG)];
      // right as seen from the room: (−n) × up
      const rx = n[2], rz = -n[0];
      if (code === 'ArrowLeft') { p[0] -= rx * step; p[2] -= rz * step; }
      if (code === 'ArrowRight') { p[0] += rx * step; p[2] += rz * step; }
      if (code === 'ArrowUp') p[1] += step;
      if (code === 'ArrowDown') p[1] -= step;
    } else {
      const cam = ed.activeCamera;
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      let fx = -e[8], fz = -e[10];
      if (Math.hypot(fx, fz) < 0.3) {
        fx = e[4];
        fz = e[6];
      }
      // snap to the dominant room axis
      if (Math.abs(fx) >= Math.abs(fz)) {
        fx = Math.sign(fx);
        fz = 0;
      } else {
        fz = Math.sign(fz);
        fx = 0;
      }
      const rx = -fz, rz = fx;
      if (code === 'ArrowUp') { p[0] += fx * step; p[2] += fz * step; }
      if (code === 'ArrowDown') { p[0] -= fx * step; p[2] -= fz * step; }
      if (code === 'ArrowRight') { p[0] += rx * step; p[2] += rz * step; }
      if (code === 'ArrowLeft') { p[0] -= rx * step; p[2] -= rz * step; }
    }
    const fixed = ed.placement?.constrain?.({ ...item, position: p }) ?? { position: p, status: 'ok' };
    if (fixed.status === 'blocked') {
      ed.events.emit('toast', { text: fixed.message || 'Kan ikke flyttes dit', seconds: 1.5 });
      return;
    }
    const pos = fixed.position.map((v) => Math.round(v * 1000) / 1000);
    const patch = { position: pos };
    if (fixed.attach) patch.attach = fixed.attach;
    ed.design.update(item.uid, patch, { label: `Flytt ${itemName(item)}`, coalesce: 'nudge' });
  }

  /** Copies the selected item next to the original (a free spot beside it when there is one). */
  _duplicate(item) {
    const ed = this.editor;
    const offset = ed.placement?.duplicateOffset?.(item) ?? [0.3, 0, 0.3];
    const uid = ed.design.duplicate(item.uid, { offset });
    if (uid) {
      ed.select({ kind: 'item', uid });
      ed.events.emit('sfx', { name: 'place' });
      ed.events.emit('toast', { text: `Kopi av ${itemName(item)} lagt til`, seconds: 2 });
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this._endPress();
    this._offBuilt?.();
    const input = this.editor.input;
    input?.setPointerClaim?.(null);
    input?.setKeyClaim?.(null);
    this.selectedGlow.dispose();
    this.hoverGlow.dispose();
    this.footprint.dispose();
    this.hint.dispose();
  }
}

/** Degrees into (−180, 180]. */
export function normDeg(d) {
  let a = ((d % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return Math.round(a * 1000) / 1000;
}

export default Selection;
