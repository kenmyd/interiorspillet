// WALLKIT – the pure wall / floor / ceiling / window geometry of the house (notes/hele-huset-design.md §2.1), moved
// out of shell.js so the living room's shell (shell.js) and the other rooms (rooms.js) build with the same code.
// The living room's behaviour is unchanged: every function here is the shell's own, with optional extra arguments
// whose defaults give exactly the old result (floorY 0, no holes, planks along z).
//
// Wall-local frame used throughout: origin at the wall's start on the room-side face (at the wall's floor), +x along
// the wall, +y up, +z = room normal (into the room); the wall occupies z ∈ [−thickness, 0]. Opening-local frame: origin
// at the bottom centre of the hole on the room face (y = sill), +x = right seen from the room, +z = into the room.
import * as THREE from 'three';
import { extrudeWall, basis, MeshBatcher, place } from '../world/buildKit.js';

export const UP = new THREE.Vector3(0, 1, 0);
const EPS = 1e-4;

const v2 = (x, y) => new THREE.Vector2(x, y);

/**
 * Right-handed frame of a wall: x = dir, y = up, z = dir × up (must equal the wanted normal; flip dir otherwise), at
 * the wall's start on the room face. floorY lifts it onto the wall's floor (world y; the living room's is 0).
 * @param {object} w  a layout wall
 * @param {number} [floorY=0]
 */
export function wallMatrix(w, floorY = 0) {
  return basis(w.dir3, UP, w.normal3, new THREE.Vector3(w.start.x, floorY, w.start.y));
}

/** Frame of an opening (origin = bottom centre of the hole on the room face; y overrides its height). */
export function openingMatrix(o, y = null) {
  const origin = o.bottomCenter.clone();
  if (y != null) origin.y = y;
  return basis(o.right, UP, o.normal, origin);
}

/** Copy of one material group of a non-indexed geometry (null when empty). */
export function groupGeometry(g, materialIndex) {
  const gr = g.groups.find((x) => x.materialIndex === materialIndex);
  if (!gr || !gr.count) return null;
  const sub = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const s = attr.itemSize;
    sub.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(gr.start * s, (gr.start + gr.count) * s), s));
  }
  return sub;
}

/**
 * Extruded layer of a wall in wall-local coordinates with mitred ends.
 * @param {object} o
 * @param {number} o.L                       wall length
 * @param {number} o.bottom                  bottom edge height
 * @param {Array<[number, number]>} o.top    top edge [[u, y], …] from u = 0 to u = L (steps allowed)
 * @param {Array<{x0,x1,y1}>} o.notches      openings cut from the bottom edge (doors)
 * @param {Array<{x0,x1,y0,y1}>} o.holes     openings inside (windows)
 * @param {number} o.z0 @param {number} o.z1 layer depth range (z1 > z0, both ≤ 0)
 * @param {number} o.kStart @param {number} o.kEnd  mitre factors: x += ∓k·depth at the ends (see buildWalls)
 * @returns {THREE.BufferGeometry} groups 0 back (−z), 1 front (+z), 2 sides
 */
export function wallLayer({ L, bottom, top, notches = [], holes = [], z0, z1, kStart = 0, kEnd = 0 }) {
  const pts = [];
  const push = (x, y) => {
    const p = pts[pts.length - 1];
    if (!p || Math.abs(p.x - x) > 1e-6 || Math.abs(p.y - y) > 1e-6) pts.push(v2(x, y));
  };
  const ns = notches.filter((n) => n.x1 > EPS && n.x0 < L - EPS).sort((a, b) => a.x0 - b.x0);
  let startNotch = null;
  let endNotch = null;
  if (ns.length && ns[0].x0 <= EPS) startNotch = ns.shift();
  if (ns.length && ns[ns.length - 1].x1 >= L - EPS) endNotch = ns.pop();
  if (startNotch) {
    push(0, startNotch.y1);
    push(startNotch.x1, startNotch.y1);
    push(startNotch.x1, bottom);
  } else push(0, bottom);
  for (const n of ns) {
    push(n.x0, bottom);
    push(n.x0, n.y1);
    push(n.x1, n.y1);
    push(n.x1, bottom);
  }
  if (endNotch) {
    push(endNotch.x0, bottom);
    push(endNotch.x0, endNotch.y1);
    push(L, endNotch.y1);
  } else push(L, bottom);
  for (let i = top.length - 1; i >= 0; i--) push(Math.max(0, Math.min(L, top[i][0])), top[i][1]);
  if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  const shape = new THREE.Shape(pts);
  for (const h of holes) shape.holes.push(new THREE.Path([v2(h.x0, h.y0), v2(h.x0, h.y1), v2(h.x1, h.y1), v2(h.x1, h.y0)]));
  const g = extrudeWall(shape, z1 - z0, z0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const d = -pos.getZ(i);
    if (x < EPS) pos.setX(i, x - kStart * d);
    else if (x > L - EPS) pos.setX(i, x + kEnd * d);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  // UVs in metres from the (mitred) positions – the mitre shift would otherwise shear the caps' texture across
  // their long triangles: faces of the wall planes (u along the wall, v up), ends (depth, up), top/bottom (u, depth)
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (az >= ax && az >= ay) uv.setXY(i, x, y);
    else if (ax >= ay) uv.setXY(i, -z, y);
    else uv.setXY(i, x, -z);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Notches (door holes cut from the bottom edge) side by side merged into one (an outer door between two sidelights):
 * wallLayer would otherwise trace a zero-width spike down to the bottom edge between them.
 * @param {Array<{x0,x1,y1}>} notches
 * @returns {Array<{x0,x1,y1}>}
 */
export function mergeNotches(notches) {
  const ns = [...notches].sort((a, b) => a.x0 - b.x0).map((n) => ({ ...n }));
  const out = [];
  for (const n of ns) {
    const p = out[out.length - 1];
    if (p && n.x0 <= p.x1 + 1e-4 && Math.abs(n.y1 - p.y1) < 1e-4) p.x1 = Math.max(p.x1, n.x1);
    else out.push(n);
  }
  return out;
}

/** Piecewise-linear [[u, h], …] lookup (steps: two points with the same u, the left segment's value at the step). */
export function profileAt(profile, u) {
  if (!profile.length) return 0;
  if (u <= profile[0][0]) return profile[0][1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [u0, h0] = profile[i];
    const [u1, h1] = profile[i + 1];
    if (u1 - u0 < 1e-9) continue;
    if (u <= u1 + 1e-9) return h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
  }
  return profile[profile.length - 1][1];
}

/**
 * The part a … b of a top profile, shifted to start at 0 (steps inside are kept; at a step on the cut the side inside
 * the part counts).
 * @param {Array<[number, number]>} profile
 * @param {number} a
 * @param {number} b
 * @returns {Array<[number, number]>}
 */
export function profileSlice(profile, a, b) {
  const out = [[0, profileAt(profile, a + 1e-6)]];
  for (const [u, h] of profile) if (u > a + 1e-6 && u < b - 1e-6) out.push([u - a, h]);
  out.push([b - a, profileAt(profile, b - 1e-6)]);
  return out;
}

/** Four boxes forming a rectangular ring (outer size w × h centred on x = cx, bottom y0) in a batch frame. */
export function ring(f, cx, y0, w, h, side, topW, bottomW, z0, z1, material, o = {}) {
  const d = z1 - z0;
  const zc = (z0 + z1) / 2;
  if (topW > 0) f.box(w, topW, d, cx, y0 + h - topW / 2, zc, material, o);
  if (bottomW > 0) f.box(w, bottomW, d, cx, y0 + bottomW / 2, zc, material, o);
  const hh = h - topW - bottomW;
  if (hh > 0 && side > 0) {
    f.box(side, hh, d, cx - w / 2 + side / 2, y0 + bottomW + hh / 2, zc, material, o);
    f.box(side, hh, d, cx + w / 2 - side / 2, y0 + bottomW + hh / 2, zc, material, o);
  }
}

/** Even-odd point in polygon ([x, z] or Vector2 points). */
function inside(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[i].x ?? poly[i][0], az = poly[i].y ?? poly[i][1];
    const bx = poly[j].x ?? poly[j][0], bz = poly[j].y ?? poly[j][1];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
  }
  return c;
}

/**
 * A rectilinear polygon minus rectilinear holes as merged rectangles [x0, z0, x1, z1] (grid of all their corner
 * coordinates, a cell is in when its centre is inside the polygon and in no hole; runs along x merged per band, equal
 * bands merged). Robust where earcut is not: a hole that touches the outline (the stairwell along the shaft walls).
 * @returns {Array<[number, number, number, number]>}
 */
export function rectCells(poly, holes = []) {
  const P = poly.map((p) => [p.x ?? p[0], p.y ?? p[1]]);
  const Hs = holes.filter((h) => h?.length >= 3).map((h) => h.map((p) => [p.x ?? p[0], p.y ?? p[1]]));
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const X = [...new Set([...P, ...Hs.flat()].map((p) => r4(p[0])))].sort((a, b) => a - b);
  const Z = [...new Set([...P, ...Hs.flat()].map((p) => r4(p[1])))].sort((a, b) => a - b);
  const on = (x, z) => inside(x, z, P) && !Hs.some((h) => inside(x, z, h));
  const bands = [];
  for (let j = 0; j < Z.length - 1; j++) {
    const zc = (Z[j] + Z[j + 1]) / 2;
    const runs = [];
    let s0 = null;
    for (let i = 0; i < X.length - 1; i++) {
      const v = on((X[i] + X[i + 1]) / 2, zc);
      if (v && s0 === null) s0 = X[i];
      if (!v && s0 !== null) {
        runs.push([s0, X[i]]);
        s0 = null;
      }
    }
    if (s0 !== null) runs.push([s0, X[X.length - 1]]);
    bands.push({ z0: Z[j], z1: Z[j + 1], runs });
  }
  const key = (b) => b.runs.map((r) => r.join(':')).join('|');
  const out = [];
  for (let j = 0; j < bands.length; j++) {
    const b = bands[j];
    if (!b.runs.length) continue;
    let z1 = b.z1;
    while (j + 1 < bands.length && key(bands[j + 1]) === key(b)) z1 = bands[++j].z1;
    for (const [x0, x1] of b.runs) out.push([x0, b.z0, x1, z1]);
  }
  return out;
}

/** Is every edge of the polygon on a world axis? */
const rectilinear = (poly) => poly.every((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return Math.abs((p.x ?? p[0]) - (q.x ?? q[0])) < 1e-6 || Math.abs((p.y ?? p[1]) - (q.y ?? q[1])) < 1e-6;
});

/** Horizontal quads of rectCells at y(x, z), facing up (floor) or down (ceiling). */
function cellsGeometry(cells, yAt, up) {
  const pos = [];
  const nrm = [];
  for (const [x0, z0, x1, z1] of cells) {
    const a = [x0, yAt(x0, z0), z0], b = [x1, yAt(x1, z0), z0], c = [x1, yAt(x1, z1), z1], d = [x0, yAt(x0, z1), z1];
    // up: counter-clockwise seen from above (+y) = a, d, c / a, c, b
    const tris = up ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
    for (const v of tris) pos.push(...v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (let i = 0; i < pos.length / 3; i++) nrm.push(0, up ? 1 : -1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/**
 * Floor (x, z polygon) → horizontal ShapeGeometry at y with UVs in metres: boards 'z' (default, the living room's
 * planks) u = z (along the planks), v = x; boards 'x' u = x, v = z. holes: polygons cut out (the stairwell).
 * @param {Array} poly   Vector2(x, z) or [x, z]
 * @param {number} [y=0]
 * @param {{ holes?: Array<Array>, boards?: 'x'|'z' }} [o]
 */
export function floorGeometry(poly, y = 0, { holes = [], boards = 'z' } = {}) {
  const hs = holes.filter((h) => h?.length >= 3);
  let g;
  if (hs.length && rectilinear(poly) && hs.every(rectilinear)) g = cellsGeometry(rectCells(poly, hs), () => y, true);
  else {
    const pt = (p) => v2(p.x ?? p[0], -(p.y ?? p[1]));
    const shape = new THREE.Shape(poly.map(pt));
    for (const h of hs) shape.holes.push(new THREE.Path(h.map(pt)));
    g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
  }
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  if (boards === 'x') for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  else for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i), pos.getX(i));
  return g;
}

/**
 * Ceiling polygon → downward-facing geometry, y from heightAt(x, z) (world), UVs (x, z) metres; holes cut out (the
 * stairwell in the ceiling of the level below).
 */
export function ceilingGeometry(poly, heightAt, holes = []) {
  const hs = holes.filter((h) => h?.length >= 3);
  let g;
  if (hs.length && rectilinear(poly) && hs.every(rectilinear)) g = cellsGeometry(rectCells(poly, hs), heightAt, false);
  else {
    const pt = (p) => v2(p.x ?? p[0], p.y ?? p[1]);
    const shape = new THREE.Shape(poly.map(pt));
    for (const h of hs) shape.holes.push(new THREE.Path(h.map(pt)));
    g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
  }
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Window glass: only the specular (environment reflection with Fresnel + light highlights) is added to what lies
 * behind, which is dimmed by a constant, slightly green-grey transmission – reads as glass, costs one draw, no
 * transmission pass. Shared by every pane (do not dispose per window).
 * @returns {THREE.MeshStandardMaterial}
 */
export function glassMaterial() {
  if (glassMaterial._m) return glassMaterial._m;
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.035,
    metalness: 0,
    envMapIntensity: 1.1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusConstantColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  // transmission ≈ (0.88, 0.91, 0.895): double glazing, faintly green-grey
  m.blendColor.setRGB(0.12, 0.09, 0.105);
  m.name = 'window-glass';
  m.userData = { cached: true, kind: 'glass-window' };
  glassMaterial._m = m;
  return m;
}

/**
 * Frosted (sandblasted) glass of the bathroom window: a milky, slightly translucent pane – the light outside shows as
 * a soft glow, nothing behind it is recognisable. Shared (do not dispose per window).
 * @returns {THREE.MeshStandardMaterial}
 */
export function frostedGlassMaterial() {
  if (frostedGlassMaterial._m) return frostedGlassMaterial._m;
  const m = new THREE.MeshStandardMaterial({
    color: '#dfe3e3',
    roughness: 0.55,
    metalness: 0,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.6,
  });
  m.name = 'window-glass-frosted';
  m.userData = { cached: true, kind: 'glass-frosted' };
  frostedGlassMaterial._m = m;
  return m;
}

/**
 * Builds the frame / sash / glass / board of one opening in its local frame (origin bottom centre of the hole on the
 * room face at y = sill): a glazed terrace door's karm and threshold, a top-hung window (karm + sash with a shadow gap
 * and a handle) or fixed glazing (karm + glazing bead). The exterior window sill (vannbrett) goes into
 * `exteriorBatch`.
 * @param {object} o        a layout window (or terrace door) opening
 * @param {boolean} isDoor  terrace door
 * @param {object} k
 * @param {object} k.M      materials: frame, gasket, hardware, threshold, sill, trim, glass
 * @param {MeshBatcher} k.exteriorBatch
 * @param {Array} k.batchers  { geometries } of the window kit is pushed here (disposed with the builder)
 * @param {(x: any) => any} k.keep  registers a geometry / material to dispose
 * @returns {{ group: THREE.Group, glass: THREE.Mesh|null, pickMeshes: THREE.Mesh[], sillY: number|null }}
 */
export function buildWindow(o, isDoor, { M, exteriorBatch, batchers, keep }) {
  const kit = new MeshBatcher(`window:${o.id}`);
  const f = kit.frame(new THREE.Matrix4());
  const W = o.width;
  const H = o.height;
  const rd = o.revealDepth;
  const fd = o.frame?.depth ?? 0.07;
  const fw = o.frame?.width ?? 0.07;
  const zF = -rd; // room-side face of the frame
  const zB = -rd - fd; // outside face
  const opening = !isDoor && o.sashes?.some((s) => s.opening);
  let glass = null;
  let glassRect = null;
  const nf = { collide: false };
  const gk = { collide: false, castShadow: false };
  if (isDoor) {
    // karm (jambs + head) around the door leaf; the leaf itself is built on the Door's pivot
    const fk = 0.055;
    f.box(fk, H, fd, -W / 2 + fk / 2, H / 2, (zF + zB) / 2, M.frame, nf);
    f.box(fk, H, fd, W / 2 - fk / 2, H / 2, (zF + zB) / 2, M.frame, nf);
    f.box(W - 2 * fk, fk, fd, 0, H - fk / 2, (zF + zB) / 2, M.frame, nf);
    // aluminium threshold sill under the leaf and the light oak threshold across the reveal floor
    f.box(W, 0.018, fd + 0.03, 0, 0.009, zB + (fd + 0.03) / 2, M.frame, nf);
    f.box(W, 0.012, rd, 0, 0.006, -rd / 2, M.threshold, nf);
  } else if (opening) {
    // top-hung window: outer frame (karm) + sash with a shadow gap and a heavier bottom rail, handle on the rail
    const fk = Math.max(0.025, fw * 0.42);
    const gap = 0.004;
    const fs = Math.max(0.03, fw - fk - gap);
    const fsB = fs + 0.012;
    ring(f, 0, 0, W, H, fk, fk, fk, zB, zF, M.frame, nf);
    ring(f, 0, fk, W - 2 * fk, H - 2 * fk, gap, gap, gap, zB + 0.03, zF - 0.012, M.gasket, gk);
    const sw = W - 2 * fk - 2 * gap;
    const sh = H - 2 * fk - 2 * gap;
    const sy = fk + gap;
    ring(f, 0, sy, sw, sh, fs, fs, fsB, zB + 0.012, zF + 0.002, M.frame, nf);
    ring(f, 0, sy + fsB, sw - 2 * fs, sh - fs - fsB, 0.004, 0.004, 0.004, zB + 0.03, zF - 0.008, M.gasket, gk);
    glassRect = { w: sw - 2 * fs + 0.01, h: sh - fs - fsB + 0.01, y: sy + fsB + (sh - fs - fsB) / 2, z: zF - 0.035 };
    // handle: rose + horizontal lever in the middle of the bottom rail
    const hy = sy + fsB / 2;
    f.box(0.034, 0.07, 0.012, 0, hy + 0.005, zF + 0.008, M.hardware, nf);
    f.box(0.12, 0.018, 0.02, 0.045, hy + 0.012, zF + 0.026, M.hardware, nf);
  } else {
    // fixed glazing: karm + glazing bead, glass set ~4 cm into the frame
    const fk = Math.max(0.03, fw * 0.62);
    const fb = Math.max(0.015, fw - fk);
    ring(f, 0, 0, W, H, fk, fk, fk, zB, zF, M.frame, nf);
    ring(f, 0, fk, W - 2 * fk, H - 2 * fk, fb, fb, fb, zF - 0.034, zF - 0.007, M.frame, nf);
    ring(f, 0, fw, W - 2 * fw, H - 2 * fw, 0.004, 0.004, 0.004, zF - 0.04, zF - 0.032, M.gasket, gk);
    glassRect = { w: W - 2 * fw + 0.01, h: H - 2 * fw + 0.01, y: H / 2, z: zF - 0.04 };
  }
  let sillY = null;
  if (o.sillBoard && !isDoor) {
    const st = o.sillBoard.thickness ?? 0.025;
    const over = o.sillBoard.overhang ?? 0.01;
    const depth = rd + over;
    const g = new THREE.BoxGeometry(W, st, depth);
    f.add(g, M.sill, { matrix: place(0, -st / 2, -rd + depth / 2), collide: false, boxUV: true });
    g.dispose();
    sillY = o.sill;
    // exterior window sill (vannbrett), sloping outward
    exteriorBatch.frame(openingMatrix(o)).box(W, 0.012, 0.075, 0, -0.012, zB - 0.025, M.trim, { rot: [0.14, 0, 0], collide: false, castShadow: false });
  }
  const built = kit.build();
  batchers.push({ geometries: kit.geometries });
  built.name = `window:${o.id}`;
  built.matrixAutoUpdate = false;
  built.matrix.copy(openingMatrix(o));
  const pickMeshes = [];
  built.traverse((m) => {
    if (!m.isMesh) return;
    m.matrixAutoUpdate = false;
    if (m.material !== M.sill) pickMeshes.push(m);
  });
  if (glassRect) {
    glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(glassRect.w, glassRect.h)), M.glass);
    glass.name = `glass:${o.id}`;
    glass.position.set(0, glassRect.y, glassRect.z);
    glass.updateMatrix();
    glass.applyMatrix4(openingMatrix(o));
    glass.castShadow = false;
    glass.receiveShadow = false;
    glass.renderOrder = 2;
    glass.userData.pick = { kind: 'window', windowId: o.id };
  }
  return { group: built, glass, pickMeshes, sillY };
}
