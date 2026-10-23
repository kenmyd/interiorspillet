import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, emissive } from './materials.js';
import { ledStrip } from './shell.js';

/**
 * The fittings of the lights the lighting rules make (home/lightplan.js, notes/belysning-genererte-hus.md), built by
 * rooms.js: downlights and ceiling lamps that follow a sloping ceiling, pendants, wall lamps (sconce, reading lamp,
 * mirror bar, outdoor lantern), step lights and LED strips under the upper cabinets. The file's own lights (the owner's
 * house) never come here – rooms.js builds them as before.
 *
 * Cost: the housings go into the room's fittings batch (one draw call per material and room), the glowing faces into a
 * GlowBatch – merged per room, light group and kind of fitting, so a group of twelve spots is one mesh with one
 * material (the LightManager and lamprig.js light it by its group). Dark until something lights it.
 *
 *   const glow = new GlowBatch();
 *   const entry = ruleFitting(l, { fittings: rr.fittings, parent: rr.lamps, glow, label, alu: K.alu, ceilingHeightAt });
 *   …
 *   glow.build(owned)          → the merged meshes (each entry's emissiveMeshes gets its own)
 *
 * The entry is what rooms.js returns for the LightManager: { id, group, label, type, lightType, fitting, roomId,
 * levelId, position, direction, angle?, penumbra?, from?, to?, colorK, lumens, emissiveMeshes }.
 */

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const DEG = Math.PI / 180;
/** Look of the fittings (not measured: plain white housings, black pendants, dark outdoor lanterns). */
export const FITTING_LOOK = {
  white: '#f0efec',
  black: '#1e1f21',
  outdoor: '#2a2b2d',
  led: '#ffd8a6',
  face: '#f4f1ea',
};
/** Glow strength of each kind (materials.emissive baseIntensity: the LightManager's nits scale, lamprig's display). */
const GLOW = { lens: 2.4, opal: 1.6, shade: 1.4, wall: 1.2, step: 1.8 };

/** Glowing faces merged per (parent, key): one mesh, one material each. */
export class GlowBatch {
  constructor() {
    this._parts = new Map();
    this.meshes = [];
  }

  /**
   * Queue a glowing face (geometry in world space; it is taken over). `target` (an entry's emissiveMeshes) gets the
   * merged mesh when built.
   */
  add(parent, key, geometry, target, { kind = 'lens', hex = FITTING_LOOK.led, face = FITTING_LOOK.face } = {}) {
    const k = `${parent.uuid}|${key}|${kind}`;
    let p = this._parts.get(k);
    if (!p) this._parts.set(k, (p = { parent, name: `lamp-glow:${key}:${kind}`, kind, hex, face, geos: [], targets: new Set() }));
    p.geos.push(geometry);
    p.targets.add(target);
  }

  /** Merge and add the meshes; `owned` collects geometries and materials to dispose. */
  build(owned = []) {
    for (const p of this._parts.values()) {
      const g = p.geos.length === 1 ? p.geos[0] : mergeGeometries(p.geos.map((x) => (x.index ? x.toNonIndexed() : x)), false);
      for (const x of p.geos) if (x !== g) x.dispose();
      const m = emissive(p.hex, GLOW[p.kind] ?? 1.5, { color: p.face });
      m.emissiveIntensity = 0;
      const mesh = new THREE.Mesh(g, m);
      mesh.name = p.name;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.noCollide = true;
      p.parent.add(mesh);
      owned.push(g, m);
      for (const t of p.targets) t.push(mesh);
      this.meshes.push(mesh);
    }
    this._parts.clear();
    return this.meshes;
  }
}

/** Matrix of a fitting's local frame: origin `o`, local +y along `up`, local +z along `front` (made ⟂ to up). */
function frame(o, up, front = null) {
  const y = up.clone().normalize();
  let z = front ? front.clone().addScaledVector(y, -front.dot(y)) : null;
  if (!z || z.lengthSq() < 1e-8) z = Math.abs(y.y) > 0.9 ? new THREE.Vector3(0, 0, 1).addScaledVector(y, -y.z) : new THREE.Vector3(0, 1, 0).addScaledVector(y, -y.y);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}
const at = (g, x, y, z) => g.translate(x, y, z);
const faceDown = (g) => g.rotateX(Math.PI / 2); // a Circle/Plane (facing +z) → facing −y
const faceUp = (g) => g.rotateX(-Math.PI / 2);

/**
 * Build the fitting of a rule-made light (layout.house.builtInLights entry) and return its LightManager entry.
 * @param {object} l  the light (layout.js parseLight: position / from / to world Vector3, normal, ceilingNormal, dims)
 * @param {{ fittings: object, parent: THREE.Object3D, glow: GlowBatch, label?: string, alu?: THREE.Material,
 *           ceilingHeightAt?: (x: number, z: number) => number }} o
 * @returns {object|null}
 */
export function ruleFitting(l, { fittings, parent, glow, label, alu = null, ceilingHeightAt = null }) {
  const em = [];
  const base = { id: l.id, group: l.group, label: label ?? l.name ?? l.id, roomId: l.roomId, levelId: l.levelId, colorK: l.colorK, lumens: l.lumens, emissiveMeshes: em };
  const key = `${l.roomId}:${l.group}`;
  const dims = l.dims || {};
  const add = (geo, material, m) => {
    fittings.add(geo, material, { matrix: m, collide: false, castShadow: false });
    geo.dispose();
  };
  const glowAt = (geo, m, kind) => glow.add(parent, key, geo.applyMatrix4(m), em, { kind });

  if (l.type === 'led-strip' && l.from && l.to) {
    // under the upper cabinets: at its own height (not the ceiling's)
    const strip = ledStrip(l, l.mount === 'under-cabinet' ? null : ceilingHeightAt, fittings, alu);
    strip.mesh.material.emissiveIntensity = 0;
    parent.add(strip.mesh);
    em.push(strip.mesh);
    return { ...base, type: 'led-strip', fitting: l.mount ?? 'strip', from: strip.from, to: strip.to, direction: DOWN.clone(), owned: [strip.mesh.geometry, strip.mesh.material] };
  }
  if (!l.position) return null;
  const p = l.position;
  const white = mat('plastic', l.color && l.color !== '#151515' ? l.color : FITTING_LOOK.white, { roughness: 0.5 });

  if (l.type === 'downlight' || l.type === 'plafond') {
    // flush with the ceiling, tilted with it on a slope (the light itself aims straight down: a gimbal)
    const n = l.ceilingNormal ?? DOWN;
    const m = frame(p, n.clone().negate());
    if (l.type === 'downlight') {
      const r = (dims.d ?? 0.08) / 2;
      add(at(new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.006, 24), 0, -0.003, 0), white, m);
      glowAt(at(faceDown(new THREE.CircleGeometry(r - 0.004, 20)), 0, -0.0065, 0), m, 'lens');
      return { ...base, type: 'spot', lightType: 'spot', fitting: 'downlight', position: p.clone().addScaledVector(n, 0.01), direction: DOWN.clone(), angle: 45 * DEG, penumbra: 0.6 };
    }
    const d = dims.d ?? 0.4, h = dims.h ?? 0.08;
    add(at(new THREE.CylinderGeometry(d / 2, d / 2 - 0.006, h - 0.012, 40), 0, -(h - 0.012) / 2, 0), white, m);
    glowAt(at(new THREE.CylinderGeometry(d / 2 - 0.02, d / 2 - 0.03, 0.012, 40), 0, -h + 0.006, 0), m, 'opal');
    return { ...base, type: 'ceiling', lightType: 'point', fitting: 'plafond', position: p.clone().addScaledVector(n, h + 0.05), direction: DOWN.clone() };
  }

  if (l.type === 'pendant') {
    // canopy on the ceiling (12 mm into it, as lamps.js), a cord straight down, a metal dome with an opal bottom
    const d = dims.d ?? 0.35, h = dims.h ?? 0.25, drop = Math.max(h + 0.1, dims.drop ?? 0.7);
    const black = mat('black-metal', l.color && l.color !== '#151515' ? l.color : FITTING_LOOK.black, { roughness: 0.45, side: 'double', flat: true });
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
    add(at(new THREE.CylinderGeometry(0.045, 0.05, 0.032, 20), 0, -0.004, 0), black, m);
    add(at(new THREE.CylinderGeometry(0.0025, 0.0025, drop - h - 0.02, 6), 0, -0.02 - (drop - h - 0.02) / 2, 0), black, m);
    const top = Math.max(0.03, d * 0.16);
    add(at(new THREE.CylinderGeometry(top, d / 2, h, 32, 1, true), 0, -drop + h / 2, 0), black, m);
    add(at(faceUp(new THREE.CircleGeometry(top, 16)), 0, -drop + h, 0), black, m);
    glowAt(at(faceDown(new THREE.CircleGeometry(d / 2 - 0.012, 28)), 0, -drop + 0.012, 0), m, 'shade');
    return { ...base, type: 'pendant', lightType: 'spot', fitting: 'pendant', position: p.clone().setY(p.y - drop + 0.02), direction: DOWN.clone(), angle: 55 * DEG, penumbra: 0.8 };
  }

  if (l.type === 'wall' || l.type === 'step') {
    const n = l.normal ?? new THREE.Vector3(0, 0, 1);
    const depth = dims.depth ?? 0.02;
    const o = p.clone().addScaledVector(n, -depth / 2); // on the wall face
    const m = frame(o, UP, n);
    if (l.type === 'step') {
      // a small plate flush in the wall, its light slit facing down and out
      const dark = mat('plastic', '#3a3b3d', { roughness: 0.6, flat: true });
      const w = dims.w ?? 0.08, hh = dims.h ?? 0.08;
      add(at(new THREE.BoxGeometry(w, hh, 0.004), 0, 0, 0.002), dark, m);
      glowAt(at(new THREE.PlaneGeometry(w - 0.02, 0.014), 0, -hh / 2 + 0.016, 0.0045), m, 'step');
      return { ...base, type: 'spot', lightType: 'spot', fitting: 'step', position: o.clone().addScaledVector(n, 0.03), direction: n.clone().multiplyScalar(0.6).add(DOWN).normalize(), angle: 60 * DEG, penumbra: 0.9 };
    }
    const style = l.style ?? 'sconce';
    if (style === 'outdoor') {
      // a lantern: back plate, dark metal box, a glass front and bottom
      const metal = mat('black-metal', FITTING_LOOK.outdoor, { roughness: 0.55, flat: true });
      const w = dims.w ?? 0.12, hh = dims.h ?? 0.24, dp = depth;
      add(at(new THREE.BoxGeometry(w * 0.8, hh * 1.1, 0.015), 0, 0, 0.0075), metal, m);
      add(at(new THREE.BoxGeometry(w, 0.02, dp), 0, hh / 2 - 0.01, dp / 2), metal, m);
      add(at(new THREE.BoxGeometry(w, 0.015, dp), 0, -hh / 2 + 0.0075, dp / 2), metal, m);
      glowAt(at(new THREE.BoxGeometry(w - 0.012, hh - 0.035, dp - 0.012), 0, -0.0025, dp / 2), m, 'wall');
    } else if (style === 'bar') {
      // the mirror lamp: a slim bar, glowing front and underside
      const metal = mat('painted', FITTING_LOOK.white, { roughness: 0.4 });
      const w = Math.max(0.3, dims.w ?? 0.5);
      add(at(new THREE.BoxGeometry(w, 0.045, depth * 0.6), 0, 0, depth * 0.3), metal, m);
      glowAt(at(new THREE.PlaneGeometry(w - 0.02, 0.02), 0, 0, depth * 0.6 + 0.001), m, 'wall');
    } else if (style === 'reading') {
      // a plate, a short arm out and a small cone shade aimed down
      const black = mat('black-metal', FITTING_LOOK.black, { roughness: 0.45, side: 'double', flat: true });
      add(at(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 20).rotateX(Math.PI / 2), 0, 0, 0.0075), black, m);
      add(at(new THREE.BoxGeometry(0.012, 0.012, 0.2), 0, 0.02, 0.1), black, m);
      add(at(new THREE.CylinderGeometry(0.025, 0.06, 0.11, 24, 1, true), 0, -0.035, 0.2), black, m);
      glowAt(at(faceDown(new THREE.CircleGeometry(0.052, 20)), 0, -0.088, 0.2), m, 'shade');
      return { ...base, type: 'spot', lightType: 'spot', fitting: 'wall', position: o.clone().addScaledVector(n, 0.2).setY(o.y - 0.1), direction: DOWN.clone(), angle: 50 * DEG, penumbra: 0.7 };
    } else {
      // up-and-down sconce: a half cylinder on a plate, glowing at both ends
      const metal = mat('painted', FITTING_LOOK.white, { roughness: 0.45 });
      const r = Math.min(depth, (dims.w ?? 0.14) / 2), hh = dims.h ?? 0.2;
      add(at(new THREE.CylinderGeometry(r, r, hh, 24, 1, false, -Math.PI / 2, Math.PI), 0, 0, 0.004), metal, m);
      glowAt(at(faceUp(new THREE.CircleGeometry(r - 0.006, 16, Math.PI, Math.PI)), 0, hh / 2 + 0.0015, 0.004), m, 'wall');
      glowAt(at(faceDown(new THREE.CircleGeometry(r - 0.006, 16, 0, Math.PI)), 0, -hh / 2 - 0.0015, 0.004), m, 'wall');
    }
    return { ...base, type: 'wall', lightType: 'point', fitting: style === 'outdoor' ? 'outdoor' : 'wall', position: o.clone().addScaledVector(n, depth + 0.06), direction: DOWN.clone() };
  }
  return null;
}
