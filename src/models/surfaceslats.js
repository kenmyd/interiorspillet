// Slat finishes on walls and ceilings («spiler» / «spilepanel», ARCHITECTURE §7 DesignState.finishes): the boxes of a
// design/Finishes.js region – the slats and the felt (or nothing) behind them – batched into one mesh per material with
// walldesigns.js's Batch and slat tones (the high wall's slat panels look the same).
import * as THREE from 'three';
import { mat, resolveColor } from '../home/materials.js';
import * as K from './kit.js';
import { Batch, slatTones } from './walldesigns.js';
import { finishRegion, slatLayout, lookOf } from '../design/Finishes.js';

/**
 * Public API
 *   finishPlan(layout, surfaceId, spec, { finishes, paintHex }) → { region, key } | null   what would be built (key:
 *                     a string that changes whenever the geometry or the materials would – SceneSync rebuilds on it)
 *   buildSurfaceFinish(plan, spec, { paintHex }) → THREE.Group | null   world-space group (matrixAutoUpdate off):
 *                     meshes 'slats' (1–3 wood tones) and 'backing' (felt), userData.finish = { surfaceId, kind, area },
 *                     userData.pick = { kind: 'wall', wallId } | { kind: 'ceiling', ceilingId }
 *   disposeSurfaceFinish(group)
 * Walls: vertical slats on the wall face, cast and receive shadows. Ceilings: slats in the ceiling plane (a slope too),
 * receive shadows only – lamps sit right under the ceiling and must keep lighting the room.
 */

const BLACK_FELT = '#1b1b1b';

/** A colour a little lighter (dl > 0) or darker in HSL lightness. */
function shadeHex(hex, dl) {
  const c = new THREE.Color(resolveColor(hex, '#b08b62'));
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + dl)), THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
}

/** Kind and colour of the slats: the look, or the surface's own paint for 'surface'. */
function slatMaterialOf(spec, paintHex) {
  const look = lookOf(spec);
  return { kind: look.kind, hex: look.hex ?? resolveColor(paintHex || '#d8d2c8') };
}

/**
 * The region of a finish and its rebuild key.
 * @param {object} layout
 * @param {string} surfaceId
 * @param {object} spec
 * @param {{ finishes?: object, paintHex?: string }} [o]
 * @returns {{ region: object, key: string }|null}
 */
export function finishPlan(layout, surfaceId, spec, { finishes = {}, paintHex = null } = {}) {
  const region = finishRegion(layout, surfaceId, spec, { finishes });
  if (!region) return null;
  const m = slatMaterialOf(spec, paintHex);
  return { region, key: JSON.stringify([region, spec.look, spec.backing, m.hex]) };
}

/**
 * Builds a finish (see the top of the file).
 * @param {{ region: object }} plan  finishPlan()
 * @param {object} spec
 * @param {{ paintHex?: string }} [o]
 * @returns {THREE.Group|null}
 */
export function buildSurfaceFinish(plan, spec, { paintHex = null } = {}) {
  const r = plan?.region;
  if (!r) return null;
  // the backing strips are laid out also without felt: they give the highlight proxy
  const lay = slatLayout({ ...r, felt: true });
  if (!lay.slats.length) return null;
  const { kind, hex } = slatMaterialOf(spec, paintHex);
  const tones = slatTones(kind, hex);
  const feltHex = spec.backing === 'felt-match' ? shadeHex(hex, -0.14) : BLACK_FELT;
  const felt = r.felt ? mat('felt', feltHex) : null;
  const B = new Batch();
  const R = K.rng(r.seed);
  const vertical = r.along === 'y';
  const { slatW, depth, base } = r;
  const zc = base + depth / 2;
  for (const s of lay.slats) {
    for (const [a, b] of s.runs) {
      const m = tones[Math.floor(R() * tones.length) % tones.length];
      const mid = (a + b) / 2;
      if (vertical) B.box(m, 'slats', s.c, mid, zc, slatW, b - a, depth, { grain: 'y', uOff: R() * 3, skip: '-z' });
      else B.box(m, 'slats', mid, s.c, zc, b - a, slatW, depth, { grain: 'x', uOff: R() * 3, skip: '-z' });
    }
  }
  if (felt && base > 0) {
    for (const s of lay.strips) {
      for (const [a, b] of s.runs) {
        const mid = (a + b) / 2;
        if (vertical) B.box(felt, 'backing', s.c, mid, base / 2, lay.pitch, b - a, base, { skip: '-z' });
        else B.box(felt, 'backing', mid, s.c, base / 2, b - a, lay.pitch, base, { skip: '-z' });
      }
    }
  }
  const g = new THREE.Group();
  g.name = `finish:${r.surfaceId}`;
  B.build(g);
  const ceiling = r.kind === 'ceiling';
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !ceiling;
    o.receiveShadow = true;
    o.userData.noCollide = true;
  });
  g.add(glowProxy(lay, vertical, base + depth + 0.002));
  const f = r.frame;
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.z)).setPosition(...f.origin);
  g.userData.noCollide = true;
  g.userData.finish = { surfaceId: r.surfaceId, kind: r.kind, area: lay.area };
  g.userData.pick = ceiling ? { kind: 'ceiling', ceilingId: r.surfaceId } : { kind: 'wall', wallId: r.surfaceId };
  g.userData.model = { parts: K.collectParts(g) };
  return g;
}

/** Layer no camera renders: the highlight proxy itself is never drawn (nor in the AO pass, nor picked). */
const PROXY_LAYER = 31;
let _proxyMat = null;

/**
 * The highlight proxy (part 'glow'): one flat quad per backing strip just in front of the slats, double-sided, on a
 * layer no camera draws. core/Highlight.js glows a double-sided mesh without the per-mesh outline and draws its
 * overlays (children on layer 0) – so a hovered / selected panel gets one even glow instead of an outline around every
 * slat, which turns into a striped amber block at a grazing angle.
 */
function glowProxy(lay, vertical, z) {
  const pos = [];
  const nor = [];
  const idx = [];
  const half = lay.pitch / 2;
  for (const s of lay.strips) {
    for (const [a, b] of s.runs) {
      const k = pos.length / 3;
      const q = vertical
        ? [[s.c - half, a], [s.c + half, a], [s.c + half, b], [s.c - half, b]]
        : [[a, s.c - half], [b, s.c - half], [b, s.c + half], [a, s.c + half]];
      for (const [x, y] of q) {
        pos.push(x, y, z);
        nor.push(0, 0, 1);
      }
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  _proxyMat ||= Object.assign(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, depthWrite: false }), { name: 'finish-glow-proxy' });
  _proxyMat.userData.shared = true;
  const m = new THREE.Mesh(geo, _proxyMat);
  m.name = 'finish-glow';
  m.layers.set(PROXY_LAYER);
  m.castShadow = m.receiveShadow = false;
  m.userData.noCollide = true;
  m.userData.part = 'glow';
  return m;
}

/** Frees a finish group (geometries; the materials are home/materials.js's shared cache). */
export function disposeSurfaceFinish(group) {
  if (!group) return;
  group.removeFromParent();
  K.disposeModel(group);
}
