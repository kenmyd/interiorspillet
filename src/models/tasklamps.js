/**
 * Task lamps (design/furniture.md §3.6): `table-task` – «Arbeidslampe»: architect lamps (IKEA FORSÅ / TERTIAL,
 * Anglepoise, Tolomeo), gooseneck reading lamps (Juno), straight-arm desk lamps and banker's lamps.
 *
 * Origin: on the table, bottom centre of the footprint; the foot at the back (−z), the head reaching toward +z.
 * dims: w = foot width (banker: the glass shade's length), d = from the back of the foot to the front of the head,
 * h = the highest joint (elbow / top of the arm). Parts: shade = head outside, inner = inside of the head, base = foot,
 * metal = arms, joints, springs, pull chain (cord: the family part, not used).
 *
 * Params: armShape 'articulated' | 'straight' | 'gooseneck' | 'banker'; headShape 'cone' | 'dome' | 'cylinder' |
 * 'banker' (half-cylinder glass shade along x); baseShape 'disc' | 'square'; tilt = the head's angle from straight down
 * toward the front (0–80°); springs (articulated arms); translucent. Hidden: shadeD / shadeH (head Ø and length),
 * baseD (foot), elbowAt (0..1 along the reach), elbowY / headAt (articulated: elbow and head-pivot heights as
 * fractions of h, default 1 / 0.72). Exactly one light: a spot along the head.
 */
import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { Lamp, foot, footDisc, shell, rod, xf, aim, look, num, clamp, SHADE_GLOW } from './lamps.js';

const DEG = Math.PI / 180;

function def(id, { defaults, params = {}, dimsRange, build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const parts = a.parts || fam.parts;
  return {
    label: a.label, mount: a.mount, parts: [...parts],
    partLabels: Object.fromEntries(parts.map((p) => [p, a.partLabels?.[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults }, params, dimsRange, build,
  };
}

/** Coil spring (wire r 1.2 mm) of radius `r` from a to b, `pitch` per turn. */
function spring(a, b, r = 0.006, pitch = 0.006) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const axis = B.clone().sub(A);
  const len = axis.length();
  axis.normalize();
  const u = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  const turns = Math.max(3, Math.round(len / pitch));
  const n = turns * 6;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, ang = t * turns * Math.PI * 2;
    pts.push(A.clone().addScaledVector(axis, t * len).addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r));
  }
  return K.tube(pts, 0.0012, { radial: 3, seg: n, curve: 'line' });
}

/**
 * The head at pivot `hp` (its back), opening along `dir`. Returns { bulb, angle } of the spot.
 * cone / dome / cylinder: shells of revolution; banker: a half cylinder along x (length bL), opening along dir.
 */
function head(L, kind, hp, dir, { sD, sH, bL }) {
  const R = sD / 2;
  const o = L.shadeMat('shade', 1.1);
  const im = L.innerMat('inner', 0.55);
  if (kind === 'banker') {
    // half cylinder along x, opening down, then tilted about x so the opening faces dir; hp = middle of its top edge
    const Rs = R;
    const s = shell([[Rs, -bL / 2], [Rs, 0], [Rs, bL / 2]], 0.002, L.q.lathe, { phiStart: 0, phiLength: Math.PI });
    const tilt = Math.atan2(dir.z, -dir.y);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0));
    const place = (g) => xf(g.rotateZ(Math.PI / 2).translate(0, -Rs, 0), hp, q);
    for (const g of [s.outer, ...s.rims]) L.auto(place(g), o, 'shade');
    L.auto(place(s.inner), im, 'inner');
    for (const sx of [-1, 1]) {
      const cap = new THREE.CircleGeometry(Rs, Math.max(8, L.q.lathe / 2), 0, Math.PI).rotateY(sx * Math.PI / 2).translate(sx * bL / 2, 0, 0);
      L.auto(xf(cap.translate(0, -Rs, 0), hp, q), o, 'shade');
    }
    const bulb = new THREE.Vector3(0, -Rs * 0.85, 0).applyQuaternion(q).add(hp);
    L.bulb('globe', bulb, clamp(Rs * 0.35, 0.01, 0.025));
    return { bulb, angle: 1.0 };
  }
  let prof, bulbAt, led = false;
  if (kind === 'dome') {
    const H = clamp(sH ?? R, 0.02, 0.25);
    prof = [[R, -H], [R * 0.97, -H * 0.75], [R * 0.86, -H * 0.45], [R * 0.6, -H * 0.18], [R * 0.3, -H * 0.03], [0.008, 0]];
    bulbAt = H * 0.5;
  } else if (kind === 'cylinder') {
    const H = clamp(sH ?? sD * 1.2, 0.02, 0.3);
    prof = [[R, -H], [R, -H * 0.5], [R, -0.004], [Math.max(0.004, R - 0.004), 0], [0.004, 0]];
    bulbAt = H - 0.006;
    led = true;
  } else {
    const H = clamp(sH ?? sD * 0.75, 0.02, 0.3);
    prof = [[R, -H], [R * 0.84, -H * 0.6], [R * 0.44, -H * 0.11], [0.012, 0]];
    bulbAt = H * 0.45;
  }
  const q = aim(dir.clone().negate());
  const s = shell(prof, 0.0015, L.q.lathe, { rimTop: false });
  for (const g of [s.outer, ...s.rims]) L.auto(xf(g, hp, q), o, 'shade');
  L.auto(xf(s.inner, hp, q), im, 'inner');
  const bulb = hp.clone().addScaledVector(dir, bulbAt);
  if (led) L.bulb('led', bulb, R * 0.75, { dir: dir.toArray(), intensity: 3 });
  else L.bulb('globe', bulb, clamp(R * 0.3, 0.008, 0.025));
  return { bulb, angle: led ? 0.5 : 0.6 };
}

/**
 * How far the head reaches from its pivot: down (so it never goes through the table) and forward (so it stays inside
 * dims.d). The opening rim (radius R, length len along dir) is the extreme; the banker half cylinder hangs below its top edge.
 */
function headExtent(kind, dir, { sD, sH }) {
  const R = sD / 2;
  const c = -dir.y, s = dir.z;
  if (kind === 'banker') return { down: R + R * c, fwd: R + R * s };
  const len = kind === 'dome' ? sH ?? R : kind === 'cylinder' ? sH ?? sD * 1.2 : sH ?? sD * 0.75;
  return { down: len * c + R * s, fwd: len * s + R * c };
}

function buildTableTask(spec) {
  const L = new Lamp('table-task', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const arm = ['articulated', 'straight', 'gooseneck', 'banker'].includes(P.armShape) ? P.armShape : 'articulated';
  const kind = ['cone', 'dome', 'cylinder', 'banker'].includes(P.headShape) ? P.headShape : 'cone';
  const tilt = clamp(num(P.tilt, 25), 0, 80) * DEG;
  const dir = new THREE.Vector3(0, -Math.cos(tilt), Math.sin(tilt));
  const metal = L.mat('metal');
  const bankerHead = kind === 'banker';
  const sD = clamp(num(P.shadeD, bankerHead ? Math.min(0.14, d * 0.7) : 0.14), 0.04, Math.max(0.04, Math.min(0.3, d)));
  const sH = Number.isFinite(P.shadeH) ? clamp(P.shadeH, 0.02, 0.3) : undefined;
  const bL = clamp(w * 0.92, 0.1, 0.5);
  const hd = { sD, sH, bL };
  const rodR = 0.004;
  // foot
  let footH, zb, fw, fd;
  if (arm === 'banker') {
    // rectangular plinth under the whole lamp, the pole at its back
    fw = Math.max(0.08, w * 0.9);
    fd = Math.min(d, 0.16);
    zb = -d / 2 + fd / 2;
    L.add(K.roundedBox(fw, 0.03, fd, 0.006, 2).translate(0, 0.015, zb), L.mat('base'), 'base');
    footH = 0.03;
  } else {
    const bD = clamp(num(P.baseD, Math.min(w * 0.9, 0.3)), 0.06, Math.max(0.06, Math.min(w, d)));
    fw = fd = bD;
    zb = -d / 2 + bD / 2;
    const n0 = L.g.children.length;
    footH = P.baseShape === 'square' ? foot(L, 'rect', { W: bD, Dd: bD, H: 0.025 }) : footDisc(L, bD, 0.022);
    for (const c of L.g.children.slice(n0)) c.geometry.translate(0, 0, zb);
  }
  // head pivot: in front, low enough for the arm, high enough that the head clears the table
  const ext = headExtent(kind, dir, hd);
  const drop = ext.down + 0.01;
  const front = d / 2 - ext.fwd;
  let hp;
  if (arm === 'articulated') {
    // pivot block, two parallel rods to the elbow (the top), two more down to the head
    // elbowY / headAt (hidden, fractions of h): the elbow's and the head pivot's heights – by default the elbow is the
    // top and the head hangs below it (FORSÅ); Tolomeo: a near-vertical lower arm to ≈ 0.55 h, the upper arm rising
    // forward to the head at the top
    const zE = clamp(zb + clamp(num(P.elbowAt, 0.3), 0, 1) * d, zb, d / 2);
    const elbow = new THREE.Vector3(0, clamp(num(P.elbowY, 1), 0.2, 1) * h - 0.012, zE);
    hp = new THREE.Vector3(0, Math.max(clamp(num(P.headAt, 0.72), 0.2, 1) * h, drop), Math.max(front, zE + 0.02));
    const base = new THREE.Vector3(0, footH + 0.03, zb);
    L.add(K.roundedBox(0.032, 0.03, 0.03, 0.004, 1).translate(0, footH + 0.015, zb), metal, 'metal');
    for (const x of [-0.01, 0.01]) {
      L.add(rod([x, base.y, base.z], [x, elbow.y, elbow.z], rodR, L.q.rod), metal, 'metal');
      L.add(rod([x, elbow.y, elbow.z], [x, hp.y, hp.z], rodR, L.q.rod), metal, 'metal');
    }
    L.add(xf(K.sphere(0.01, { wSeg: 12, hSeg: 8 }), elbow), metal, 'metal');
    L.add(K.cylinder(0.006, 0.006, 0.03, { seg: L.q.rod, center: true }).rotateZ(Math.PI / 2).translate(0, base.y, base.z), metal, 'metal');
    if (P.springs !== false) {
      // one coil spring beside the lower arm, near the foot
      const a = base.clone().lerp(elbow, 0.12), len = Math.min(0.09, base.distanceTo(elbow) * 0.35);
      const b = a.clone().add(elbow.clone().sub(base).normalize().multiplyScalar(len));
      L.add(spring([0.022, a.y, a.z], [0.022, b.y, b.z]), metal, 'metal');
      L.add(rod([0.012, a.y, a.z], [0.022, a.y, a.z], 0.0015, 4), metal, 'metal');
      L.add(rod([0.012, b.y, b.z], [0.022, b.y, b.z], 0.0015, 4), metal, 'metal');
    }
  } else if (arm === 'straight') {
    // a pole up from the foot, one angled rod up and forward to the head at the top
    const yJ = Math.min(0.85 * h, h - 0.03);
    hp = new THREE.Vector3(0, Math.max(h - 0.015, drop), Math.max(front, zb + 0.04));
    L.add(K.cylinder(0.006, 0.006, yJ - footH + 0.004, { seg: L.q.rod + 2 }).translate(0, footH - 0.004, zb), metal, 'metal');
    L.add(xf(K.sphere(0.009, { wSeg: 12, hSeg: 8 }), [0, yJ, zb]), metal, 'metal');
    L.add(rod([0, yJ, zb], hp, 0.005, L.q.rod), metal, 'metal');
  } else if (arm === 'gooseneck') {
    hp = new THREE.Vector3(0, Math.max(0.78 * h, drop), Math.max(front, zb + 0.3 * d + 0.02));
    const pts = [[0, footH - 0.004, zb], [0, 0.55 * h, zb], [0, h - 0.008, zb + 0.3 * d], [0, hp.y + 0.35 * (h - hp.y), hp.z - 0.02], hp.toArray()];
    L.add(K.tube(pts, 0.006, { radial: L.q.rod, seg: 48 }), metal, 'metal');
  } else {
    // banker: a pole up at the back of the plinth and an arm forward; the glass shade's top edge at h
    const zS = bankerHead ? d / 2 - sD / 2 : front;
    hp = new THREE.Vector3(0, bankerHead ? h : Math.max(h - 0.03, drop), zS);
    const yTop = bankerHead ? Math.max(footH + 0.05, h - 0.08) : hp.y;
    const zP = zb - fd / 2 + 0.035;
    L.add(K.cylinder(0.006, 0.006, yTop - footH + 0.002, { seg: L.q.rod + 2 }).translate(0, footH - 0.002, zP), metal, 'metal');
    L.add(xf(K.sphere(0.008, { wSeg: 10, hSeg: 8 }), [0, yTop, zP]), metal, 'metal');
    L.add(rod([0, yTop, zP], [0, yTop, zS], 0.005, L.q.rod), metal, 'metal');
    if (bankerHead) {
      // a short post up into the shade, and the pull chain under its front
      L.add(rod([0, yTop, zS], [0, h - sD * 0.45, zS], 0.005, L.q.rod), metal, 'metal');
      const cy = h - sD / 2 - 0.004;
      L.add(rod([bL * 0.3, cy, zS], [bL * 0.3, cy - 0.09, zS], 0.0012, 4), metal, 'metal');
      L.add(xf(K.sphere(0.005, { wSeg: 8, hSeg: 6 }), [bL * 0.3, cy - 0.092, zS]), metal, 'metal');
    }
  }
  if (!bankerHead) L.add(xf(K.sphere(0.008, { wSeg: 10, hSeg: 8 }), hp), metal, 'metal');
  const res = head(L, kind, hp, dir, hd);
  L.spot(res.bulb.toArray(), dir.toArray(), L.lumens(400), res.angle, 0.6);
  L.colliders.push({ min: [-fw / 2, 0, zb - fd / 2], max: [fw / 2, h * 0.9, zb + fd / 2] });
  return L.finish();
}

/** @type {Record<string, object>} */
export const archetypes = {
  'table-task': def('table-task', {
    defaults: {
      dims: { w: 0.18, d: 0.42, h: 0.5 },
      params: { armShape: 'articulated', headShape: 'cone', baseShape: 'disc', tilt: 25, springs: true },
      ...look('#1d1d1d', 'black-metal', '#1d1d1d', 'black-metal', '#f2efe8', 'painted'),
    },
    params: {
      armShape: { type: 'enum', options: [['articulated', 'Leddarm (arkitektlampe)'], ['straight', 'Rett arm'], ['gooseneck', 'Svanehals'], ['banker', 'Bankerlampe']], label: 'Arm', default: 'articulated' },
      headShape: { type: 'enum', options: [['cone', 'Kjegle'], ['dome', 'Kuppel'], ['cylinder', 'Sylinder'], ['banker', 'Glasskjerm (banker)']], label: 'Lampehode', default: 'cone' },
      baseShape: { type: 'enum', options: [['disc', 'Rund fot'], ['square', 'Firkantet fot']], label: 'Fot', default: 'disc' },
      tilt: { type: 'number', min: 0, max: 80, step: 1, unit: '°', label: 'Vinkel på hodet', hint: '0° = lyset rett ned. Høyere tall vipper lampehodet fram mot forsiden – roter lampen for å rette den en annen vei.' },
      springs: { type: 'bool', label: 'Fjærer på armen' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.1, 0.5], d: [0.12, 0.8], h: [0.2, 0.9] },
    build: buildTableTask,
  }),
};
