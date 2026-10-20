import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';
import { recolorer } from './tables.js';

/**
 * Dining chairs with a frame (ARCHITECTURE §5; seating parts upholstery, frame, legs) – the shell chair is seating.js
 * `dining-chair`:
 *
 *   chair   back: upholstered (straight) / upholstered-round (a curved band) / spindles / slats / rail (one broad top
 *           rail) / y-back (wishbone) / panel (bent wood) / cane / ladder; seat: upholstered / wood / cord / cane /
 *           cushion; arms; legs: wood-taper / wood-square / metal-thin / sled; stretchers.
 *
 * Origin: floor, centre of the footprint, the front toward +z. dims.h = top of the back.
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
const QF = { low: 0.6, medium: 1, high: 1.5 };
const seg = (spec, n) => Math.max(4, Math.round(n * (QF[spec.quality] ?? 1)));
const _UP = new THREE.Vector3(0, 1, 0);

function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

/** A round or square stick between two points (legs, posts, spindles, rails). */
function stick(g, material, part, a, b, r0, r1 = r0, { square = false, n = 10 } = {}) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  if (len < 0.003) return null;
  dir.normalize();
  const m = K.partMesh(K.taperLeg(len, r1, r0, { seg: n, square }), material, part, { position: a });
  m.quaternion.setFromUnitVectors(_UP, dir);
  g.add(m);
  return m;
}

/** Curved board in plan (an arc of radius R round (0, zc), half-angle a), height bh, thickness t, bottom at y0. */
function arcBoard(R, a, t, bh, n, bevel = Math.min(0.004, t * 0.3)) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const ang = -a + (2 * a * k) / n;
    pts.push([Math.sin(ang) * (R + t / 2), -Math.cos(ang) * (R + t / 2)]);
  }
  for (let k = n; k >= 0; k--) {
    const ang = -a + (2 * a * k) / n;
    pts.push([Math.sin(ang) * (R - t / 2), -Math.cos(ang) * (R - t / 2)]);
  }
  // shape in x/(−z) → extrude along +z, then turn the extrusion upward (+y)
  const geo = K.extrudeShape(pts.map(([x, z]) => [x, -z]), bh, { bevel, bevelSegments: bevel > 0.006 ? 3 : 1, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  K.worldUV(geo, 1, { grain: 'x' });
  return geo;
}

/** arcBoard whose height falls from full at the back to `endRatio` × full at the two front ends (tub backs). */
function tubBand(R, a, t, bh, n, endRatio) {
  const geo = arcBoard(R, a, t, bh, n, Math.min(0.03, t * 0.4));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ang = Math.abs(Math.atan2(pos.getX(i), -pos.getZ(i)));
    const k = 1 - (1 - endRatio) * Math.min(1, ang / a) ** 1.6;
    pos.setY(i, pos.getY(i) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function def(id, { defaults, params = {}, dimsRange, build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const parts = a.parts || fam.parts;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...parts],
    partLabels: Object.fromEntries(parts.map((p) => [p, a.partLabels?.[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange,
    build,
  };
}

const BACKS = ['upholstered', 'upholstered-round', 'pad', 'spindles', 'slats', 'rail', 'y-back', 'panel', 'cane', 'ladder'];
const SEATS = ['upholstered', 'wood', 'cord', 'cane', 'cushion'];
const LEGS = ['wood-taper', 'wood-square', 'metal-thin', 'sled'];

function buildChair(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const back = BACKS.includes(P.back) ? P.back : 'upholstered';
  const seat = SEATS.includes(P.seat) ? P.seat : 'upholstered';
  const legStyle = LEGS.includes(P.legStyle) ? P.legStyle : 'wood-taper';
  const upKind = M.upholstery || 'woven';
  const up = mat(upKind, C.upholstery, kindGroup(upKind) === 'wood' ? { grain: 'z' } : undefined);
  const frameKind = M.frame || M.legs || 'oak';
  const frameWood = kindGroup(frameKind) === 'wood';
  const frame = mat(frameKind, C.frame || C.legs, frameWood ? { grain: 'y' } : undefined);
  const frameX = mat(frameKind, C.frame || C.legs, frameWood ? { grain: 'x' } : undefined);
  const legsKind = M.legs || frameKind;
  const metalLegs = kindGroup(legsKind) === 'metal';
  const legs = mat(legsKind, C.legs, kindGroup(legsKind) === 'wood' ? { grain: 'y' } : undefined);
  const n = seg(spec, 12);
  const seatH = clamp(num(P.seatH, 0.46), 0.38, Math.min(0.6, h - 0.15));
  const arms = P.arms === true;
  const softBack = back === 'upholstered' || back === 'upholstered-round' || back === 'pad';
  // seat geometry
  const seatT = seat === 'upholstered' ? 0.075 : seat === 'cushion' ? 0.06 : 0.03;
  const zb = -d / 2 + 0.03, zfr = d / 2 - 0.01; // seat back / front edge
  const sd = zfr - zb;
  const sw = w - (arms ? 0.08 : 0.02);
  const legTop = seatH - (seat === 'upholstered' ? seatT : seat === 'cushion' ? seatT + 0.02 : 0.02);
  // legs: front pair, back pair (the back legs rise into back posts for frame backs)
  const lx = w / 2 - (metalLegs ? 0.035 : 0.04);
  const fz = d / 2 - 0.05, bz = -d / 2 + 0.06;
  const postsUp = !softBack || frameWood; // wood chairs: the back posts continue above the seat
  // wishbone: the back legs rise only to the bent top rail
  const backTopY = back === 'y-back' ? seatH + (h - seatH) * 0.62 : h;
  const rake = 8 * DEG;
  const postTop = (sx) => [sx * (lx - 0.01), backTopY - 0.01, bz - Math.tan(rake) * (backTopY - legTop)];
  const sq = legStyle === 'wood-square';
  const rLeg = metalLegs || legStyle === 'metal-thin' ? 0.01 : sq ? 0.017 : 0.019;
  if (legStyle === 'sled') {
    // a bent tube on each side: front post → floor → back → up (into the back frame when the back is a frame)
    const r = 0.009;
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      const pts = [[x, legTop, fz], [x, 0.012, fz + 0.01], [x, 0.012, bz - 0.01], [x, legTop, bz]];
      g.add(K.partMesh(K.tube(pts, r, { curve: 'line', radial: 8 }), legs, 'legs'));
      for (const p of [[x, 0.012, fz + 0.01], [x, 0.012, bz - 0.01]]) add(g, K.sphere(r, { wSeg: 8, hSeg: 6 }), legs, 'legs', ...p);
      // the tube carries on up as a back post for a frame back
      if (!softBack) stick(g, legs, 'legs', [x, legTop, bz], postTop(sx), r, r, { n: 8 });
    }
  } else {
    for (const sx of [-1, 1]) {
      const sp = legStyle === 'metal-thin' ? 0.02 : sq ? 0 : 0.025; // splay at the foot
      stick(g, legs, 'legs', [sx * (lx + sp), 0, fz + sp], [sx * lx, legTop, fz], rLeg * 0.78, rLeg, { square: sq, n });
      const footB = [sx * (lx + sp), 0, bz - sp * 1.4];
      if (postsUp && !softBack && legStyle !== 'metal-thin') {
        // one piece: back leg → seat → back post, bent at the seat
        stick(g, legs, 'legs', footB, [sx * lx, legTop, bz], rLeg * 0.78, rLeg, { square: sq, n });
        stick(g, frame, 'frame', [sx * lx, legTop, bz], postTop(sx), rLeg, rLeg * 0.85, { square: sq, n });
      } else stick(g, legs, 'legs', footB, [sx * lx, legTop, bz], rLeg * 0.78, rLeg, { square: sq, n });
    }
  }
  // apron / seat frame
  if (seat !== 'upholstered' || !metalLegs) {
    const ah = seat === 'upholstered' ? 0.05 : 0.04;
    const at = 0.018;
    for (const sz of [-1, 1]) add(g, K.box(2 * lx - 0.02, ah, at, { grain: 'x' }), frameX, 'frame', 0, legTop - ah / 2 + (seat === 'upholstered' ? 0.005 : 0), sz > 0 ? fz : bz);
    for (const sx of [-1, 1]) add(g, K.box(at, ah, fz - bz - 0.02, { grain: 'z' }), frame, 'frame', sx * lx, legTop - ah / 2 + (seat === 'upholstered' ? 0.005 : 0), (fz + bz) / 2);
  }
  // seat
  if (seat === 'upholstered') {
    add(g, K.cushion(sw, seatT, sd, { axis: 'y', puff: 0.12, round: 0.8, sides: 0.12, bottom: 0.1, seg: 12 }), up, 'upholstery', 0, seatH - seatT / 2, (zb + zfr) / 2);
  } else if (seat === 'cushion') {
    add(g, K.roundedBox(sw, 0.022, sd, 0.004, 1, { grain: 'z' }), frameX, 'frame', 0, legTop + 0.011, (zb + zfr) / 2);
    add(g, K.cushion(sw - 0.03, seatT, sd - 0.03, { axis: 'y', puff: 0.2, round: 0.9, sides: 0.15, seg: 10 }), up, 'upholstery', 0, legTop + 0.022 + seatT / 2, (zb + zfr) / 2);
  } else if (seat === 'wood') {
    add(g, K.roundedBox(sw, 0.025, sd, 0.006, 2, { grain: 'z' }), up, 'upholstery', 0, seatH - 0.0125, (zb + zfr) / 2);
  } else {
    // cord / cane: a seat frame with the woven surface inside it
    const ft = 0.03;
    for (const sz of [-1, 1]) add(g, K.roundedBox(sw, ft, ft, 0.005, 1, { grain: 'x' }), frameX, 'frame', 0, seatH - ft / 2, sz > 0 ? zfr - ft / 2 : zb + ft / 2);
    for (const sx of [-1, 1]) add(g, K.roundedBox(ft, ft, sd - 2 * ft, 0.005, 1, { grain: 'z' }), frame, 'frame', sx * (sw / 2 - ft / 2), seatH - ft / 2, (zb + zfr) / 2);
    const woven = seat === 'cane' ? mat('rattan', C.upholstery || '#c7a777', { open: true }) : up;
    add(g, K.box(sw - 2 * ft + 0.006, 0.012, sd - 2 * ft + 0.006), woven, 'upholstery', 0, seatH - 0.014, (zb + zfr) / 2);
  }
  // stretchers between the legs
  if (P.stretchers === true && legStyle !== 'sled') {
    const y = 0.16, r = rLeg * 0.55;
    for (const sx of [-1, 1]) stick(g, legs, 'legs', [sx * (lx + 0.012), y, fz + 0.01], [sx * (lx + 0.012), y, bz - 0.014], r, r, { n: 8, square: sq });
    stick(g, legs, 'legs', [-(lx + 0.01), y + 0.04, (fz + bz) / 2], [lx + 0.01, y + 0.04, (fz + bz) / 2], r, r, { n: 8, square: sq });
  }
  // back
  const bY0 = seatH + 0.04;
  const bY1 = h;
  const bzc = bz - Math.tan(rake) * ((bY0 + bY1) / 2 - legTop);
  const bw = 2 * (lx - 0.01);
  switch (back) {
    case 'upholstered': {
      // one upholstered piece from the seat frame up, standing behind the seat cushion (Parsons-style)
      const bt = 0.07;
      const y0 = legTop - (frameWood ? 0.04 : 0);
      const bh = bY1 - y0;
      const lean = 5 * DEG;
      const grp = new THREE.Group();
      grp.position.set(0, y0, zb + bt / 2 - 0.01);
      grp.rotation.x = -lean;
      g.add(grp);
      grp.add(K.partMesh(K.cushion(sw, bh, bt, { axis: 'z', puff: 0.12, round: 0.7, sides: 0.08, bottom: 0.15, seg: 12 }), up, 'upholstery', { position: [0, bh / 2, 0] }));
      break;
    }
    case 'upholstered-round': {
      // a tub: a thick curved band round the back, its top falling toward the front (into the arms when there are arms)
      const R = Math.max(0.2, w * 0.47);
      const bh = bY1 - (seatH - 0.03);
      const a = (arms ? 100 : 75) * DEG;
      const geo = tubBand(R, a, 0.09, bh, seg(spec, 16), arms ? 0.38 : 0.7);
      add(g, geo, up, 'upholstery', 0, seatH - 0.03, bz + R - 0.01);
      break;
    }
    case 'pad': {
      // a curved upholstered back pad above the seat with a gap (KRYLBO), on two hidden stays
      const R = Math.max(0.22, w * 0.55);
      const y0 = seatH + 0.07;
      const ph = Math.max(0.15, h - y0);
      const a = Math.asin(Math.min(0.95, (w / 2) / R));
      add(g, arcBoard(R, a, 0.07, ph, seg(spec, 16), 0.028), up, 'upholstery', 0, y0, bz + R - 0.02);
      for (const sx of [-1, 1]) stick(g, legs, 'legs', [sx * (lx - 0.03), legTop, bz + 0.02], [sx * (lx - 0.05), y0 + 0.05, bz - 0.01], 0.008, 0.008, { n: 8 });
      break;
    }
    case 'spindles':
    case 'ladder':
    case 'slats':
    case 'rail':
    case 'cane':
    case 'panel': {
      // top rail between the posts (slightly curved board); a panel back is one broad board, wider than the posts
      const railH = back === 'panel' ? clamp((bY1 - bY0) * 0.5, 0.12, 0.24) : back === 'rail' ? 0.1 : back === 'ladder' ? 0.035 : 0.05;
      const R = 0.55;
      const a = Math.asin(Math.min(0.95, (bw / 2 + (back === 'panel' ? 0.03 : 0)) / R));
      const railGeo = arcBoard(R, a, back === 'panel' ? 0.018 : 0.02, railH, back === 'panel' ? 14 : 10);
      const zAt = (y) => bz - Math.tan(rake) * (y - legTop);
      if (!(back === 'spindles' && P.hoop === true)) add(g, railGeo, frame, 'frame', 0, bY1 - railH, zAt(bY1) + R - 0.02);
      if (back === 'spindles' && P.hoop === true) {
        const rx = w / 2 - 0.02, zc = bz + rx * 0.5, rz = zc - (bz - 0.04);
        const yT = bY1 - railH;
        const hp = [];
        for (let k = 0; k <= 16; k++) {
          const t = Math.PI * (k / 16);
          hp.push([-Math.cos(t) * rx, yT + Math.sin(t) * (bY1 - yT), zc - Math.sin(t) * rz]);
        }
        g.add(K.partMesh(K.tube(hp, 0.014, { radial: 8 }), frame, 'frame'));
        const nS = clamp(Math.round(num(P.spindles, 5)), 3, 12);
        for (let k = 1; k <= nS; k++) {
          const t = Math.PI * (0.18 + (0.64 * k) / (nS + 1));
          const top = [-Math.cos(t) * rx, yT + Math.sin(t) * (bY1 - yT) - 0.01, zc - Math.sin(t) * rz];
          stick(g, frame, 'frame', [top[0] * 0.8, seatH, zAt(seatH) + 0.01], top, 0.007, 0.006, { n: 8 });
        }
      } else if (back === 'spindles') {
        const nS = clamp(Math.round(num(P.spindles, Math.round(bw / 0.06))), 3, 12);
        for (let k = 1; k <= nS; k++) {
          const x = -bw / 2 + (k * bw) / (nS + 1);
          stick(g, frame, 'frame', [x, seatH, zAt(seatH) + 0.004], [x, bY1 - railH + 0.005, zAt(bY1 - railH) + 0.02], 0.007, 0.006, { n: 8 });
        }
      } else if (back === 'slats' || back === 'ladder') {
        const nS = back === 'ladder' ? 3 : clamp(Math.round(num(P.slats, 2)), 1, 4);
        for (let k = 1; k <= nS; k++) {
          const y = bY1 - railH - k * ((bY1 - railH - bY0) / (nS + 0.6));
          add(g, arcBoard(R, a, 0.018, back === 'ladder' ? 0.03 : 0.05, 10), frame, 'frame', 0, y, zAt(y) + R - 0.03);
        }
      } else if (back === 'cane') {
        const y0c = bY0 + 0.05, y1c = bY1 - railH;
        add(g, K.roundedBox(bw, 0.03, 0.02, 0.004, 1, { grain: 'x' }), frameX, 'frame', 0, y0c, zAt(y0c));
        const cm = add(g, K.box(bw - 0.01, y1c - y0c - 0.015, 0.004), mat('rattan', '#c7a777', { open: true }), null, 0, (y0c + y1c) / 2, zAt((y0c + y1c) / 2), [-rake, 0, 0]);
        cm.userData.noShadow = true;
      }
      break;
    }
    case 'y-back': {
      // wishbone: a bent top rail from post to post round the back, and a Y-shaped splat in the middle
      const r = 0.012;
      const yT = backTopY;
      const rx = w / 2 - 0.02;
      const zc = bz + rx * 0.55, rz = zc - (bz - 0.04);
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const a = Math.PI * (k / 16); // 0 = left end, π/2 = the back, π = right end
        pts.push([-Math.cos(a) * rx, yT + Math.sin(a) * 0.02, zc - Math.sin(a) * rz]);
      }
      g.add(K.partMesh(K.tube(pts, r * 1.7, { radial: 8 }), frame, 'frame'));
      // short posts carry the free ends from the seat frame
      for (const sx of [-1, 1]) stick(g, frame, 'frame', [sx * (lx - 0.005), legTop, zc + 0.01], [sx * rx, yT - 0.01, zc], 0.011, 0.01, { n: 8 });
      // Y splat
      const sm = K.extrudeShape([[-0.012, 0], [0.012, 0], [0.012, 0.09], [0.05, (yT - seatH) * 0.95], [-0.05, (yT - seatH) * 0.95], [-0.012, 0.09]], 0.012, { bevel: 0.002, bevelSegments: 1, curveSegments: 2 });
      K.worldUV(sm, 1, { grain: 'y' });
      add(g, sm, frame, 'frame', 0, seatH, bz - 0.04);
      break;
    }
    default:
  }
  // arms (frame backs: wooden arm rests on the front legs; upholstered: soft pads)
  if (arms && back !== 'y-back' && back !== 'upholstered-round') {
    const ay = seatH + 0.2;
    for (const sx of [-1, 1]) {
      const x = sx * (lx + 0.005);
      stick(g, frame, 'frame', [x, legTop, fz], [x, ay, fz - 0.03], rLeg * 0.8, rLeg * 0.75, { n, square: sq });
      if (softBack) add(g, K.cushion(0.05, 0.05, fz - bz, { axis: 'y', puff: 0.15, round: 0.9, seg: 8 }), up, 'upholstery', x, ay + 0.02, (fz + bz) / 2 - 0.02);
      else add(g, K.roundedBox(0.04, 0.022, fz - bz + 0.04, 0.008, 2, { grain: 'z' }), frameX, 'frame', x, ay + 0.011, (fz + bz) / 2 - 0.02);
    }
  }
  const rc = recolorer(g, (part, kind) => !!kind && kindGroup(kind) !== kindGroup(part === 'upholstery' ? upKind : part === 'legs' ? legsKind : frameKind));
  g.name = 'chair';
  return K.finishModel(g, { seatY: seatH, recolor: rc });
}

/** @type {Record<string, object>} */
export const archetypes = {
  chair: def('chair', {
    defaults: {
      dims: { w: 0.5, d: 0.55, h: 0.82 },
      params: { back: 'upholstered', seat: 'upholstered', arms: false, legStyle: 'wood-taper', seatH: 0.46, stretchers: false },
      colors: { upholstery: '#c8bfb2', frame: '#7a5a3f', legs: '#7a5a3f' },
      materials: { upholstery: 'woven', frame: 'oak', legs: 'oak' },
    },
    params: {
      back: { type: 'enum', label: 'Rygg', options: [['upholstered', 'Polstret, rett'], ['upholstered-round', 'Polstret, rund'], ['pad', 'Polstret ryggpute'], ['spindles', 'Pinner'], ['slats', 'Tverrspiler'], ['rail', 'Bred toppspile'], ['y-back', 'Y-rygg (wishbone)'], ['panel', 'Bøyd treplate'], ['cane', 'Rotting'], ['ladder', 'Stige']] },
      seat: { type: 'enum', label: 'Sete', options: [['upholstered', 'Polstret'], ['wood', 'Tre'], ['cord', 'Flettet papirsnor'], ['cane', 'Rotting'], ['cushion', 'Tre med pute']] },
      arms: { type: 'bool', label: 'Armlener' },
      legStyle: { type: 'enum', label: 'Ben', options: [['wood-taper', 'Runde treben'], ['wood-square', 'Firkantede treben'], ['metal-thin', 'Tynne metallben'], ['sled', 'Medeben i metall']] },
      seatH: { type: 'number', min: 0.4, max: 0.55, step: 0.01, label: 'Setehøyde (m)' },
      stretchers: { type: 'bool', label: 'Sprosser mellom bena' },
    },
    dimsRange: { w: [0.4, 0.7], d: [0.42, 0.7], h: [0.7, 1.05] },
    build: buildChair,
  }),
};
