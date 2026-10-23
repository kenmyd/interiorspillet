// FRENCH BALCONY – a railing on the facade in front of a door or a window down to the floor (fransk balkong,
// notes/vindusmodeller.md): no slab, the railing stands a few cm out from the cladding over the whole hole and a little
// beyond it, fixed to the wall with brackets beside the hole. Glass in a slim frame (style 'glass', the default) or
// steel bars (style 'bars', at most 10 cm between them). It stops the figure: static boxes over its length.
//
//   buildFrenchBalcony(o, raw, w, { batch, matrix, materials }) → Box3[] (colliders)
//
// o      the layout opening (width, sill, floorY; type 'door' or 'window'), raw its spec entry (raw.frenchBalcony),
//        w the layout wall (thickness). The frame of `matrix` is the opening's at its floor: origin at the bottom centre
//        of the hole on the room face at floor height, x right seen from the room, y up, z into the room – the facade is
//        at z = −thickness.
import * as THREE from 'three';
import { glassMaterial } from './wallkit.js';
import { mat } from './materials.js';

/** The railing's look and size: style, top height over the floor, its colour, the distance out from the facade. */
export const FRENCH_BALCONY = { style: 'glass', height: 1.0, color: '#25272b', out: 0.07, beyond: 0.06 };
const STYLES = ['glass', 'bars'];

/** The railing of an opening's `frenchBalcony` (true or { style, height, color }) with its defaults, or null. */
export function frenchBalconyOf(raw) {
  const fb = raw?.frenchBalcony;
  if (!fb) return null;
  const o = fb === true ? {} : fb;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    style: STYLES.includes(o.style) ? o.style : FRENCH_BALCONY.style,
    height: Math.min(1.3, Math.max(0.8, num(o.height, FRENCH_BALCONY.height))),
    color: typeof o.color === 'string' ? o.color : raw.frame?.color ?? FRENCH_BALCONY.color,
  };
}

/**
 * Builds the railing into `batch` (the room's outside batch) in the opening's floor frame `matrix`.
 * @returns {THREE.Box3[]} the colliders (world boxes over the railing, four along it)
 */
export function buildFrenchBalcony(o, raw, w, { batch, matrix }) {
  const fb = frenchBalconyOf(raw);
  if (!fb) return [];
  const t = w.thickness;
  const W = o.width + 2 * FRENCH_BALCONY.beyond;
  const zc = -t - FRENCH_BALCONY.out; // the railing's middle plane
  const H = fb.height;
  // the bottom rail a little over the floor (a door, a window on the floor) or over the sill
  const y0 = (o.sill > 0.005 ? o.sill : 0) + 0.06;
  const m = mat('black-metal', fb.color, { roughness: 0.42 });
  const f = batch.frame(matrix);
  const nc = { collide: false };
  const post = 0.04;
  // posts at the ends up into the handrail, the handrail over them, the bottom rail between them
  for (const s of [-1, 1]) f.box(post, H - 0.01 - (y0 - 0.03), post, s * (W / 2 - post / 2), (y0 - 0.03 + H - 0.01) / 2, zc, m, nc);
  f.box(W + 0.01, 0.045, 0.055, 0, H - 0.0225, zc, m, nc);
  f.box(W - 2 * post, 0.03, 0.03, 0, y0, zc, m, nc);
  // brackets from each post back into the facade (5 mm into the wall, through a trim board), at the bottom and under
  // the handrail
  const bl = FRENCH_BALCONY.out - post / 2 + 0.005;
  for (const s of [-1, 1]) for (const y of [y0 + 0.08, H - 0.15]) f.box(0.03, 0.03, bl + 0.005, s * (W / 2 - post / 2), y, -t + 0.005 - (bl + 0.005) / 2, m, nc);
  const ya = y0 + 0.015;
  const yb = H - 0.045;
  if (fb.style === 'glass') {
    // a pane between the posts and the rails, held by a slim bead on both faces (none of its faces in another's plane)
    const gw = W - 2 * post + 0.01;
    const g = new THREE.PlaneGeometry(gw, yb - ya + 0.01);
    f.add(g, glassMaterial(), { matrix: new THREE.Matrix4().makeTranslation(0, (ya + yb) / 2, zc), collide: false, castShadow: false });
    g.dispose();
    for (const dz of [-0.006, 0.006]) f.box(gw, 0.012, 0.004, 0, ya + 0.004, zc + dz, m, nc);
  } else {
    // bars at most 10 cm apart (12 mm square)
    const span = W - 2 * post;
    const n = Math.max(1, Math.ceil(span / 0.112));
    for (let i = 1; i < n; i++) f.box(0.012, yb - ya + 0.01, 0.012, -span / 2 + (span * i) / n, (ya + yb) / 2, zc, m, nc);
  }
  // colliders: four slices along the railing, from the floor up to the handrail (the figure cannot step out)
  const out = [];
  const n = 4;
  for (let k = 0; k < n; k++) {
    const xa = -W / 2 + (W * k) / n;
    const xb = -W / 2 + (W * (k + 1)) / n;
    const pts = [xa, xb].flatMap((x) => [zc - 0.03, zc + 0.03].flatMap((z) => [0, H].map((y) => new THREE.Vector3(x, y, z).applyMatrix4(matrix))));
    out.push(new THREE.Box3().setFromPoints(pts));
  }
  return out;
}
