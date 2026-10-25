import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';
import {
  buildCabinet, recolorer, P_TOP, add, pm, qSeg, tone, finish, darkInside, ribPanelGeometry, herringboneGeometry, barYZ,
  tableTop, legAnchors, legMats, styledLeg, drawerHandle,
} from './tables.js';

/**
 * Desks (design/furniture.md §3.2): desk – «Skrivebord». A top (rect, rounded, stadium; the coffee-table's edges and
 * an optional herringbone veneer) on one of seven frames – four legs, metal U-frames, A-frames, gables, trestles,
 * crossed legs or an electric sit-stand frame – with optional apron drawers, a drawer/door unit on either side
 * (buildCabinet; a unit standing on the floor replaces the legs on its side), a low or under-top shelf, a modesty
 * panel and a hutch. Measures itself from dims (w × d of the top, h = top height) and never stretches.
 *
 * Parts: body (apron, shelves, modesty panel, hutch, unit carcass), front (drawer and door fronts), top, legs (frame),
 * handle. Exports: `archetypes` (the Def table for registry.js).
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Def from the shared schema (honours the archetype's partLabels – design/furniture.md §2.2). */
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

const FRAMES = ['legs', 'u-frame', 'a-frame', 'panel', 'trestle', 'x', 'sit-stand'];
const DESK_LEGS = ['square', 'round-taper', 'splayed', 'metal-thin', 'metal-square', 'hairpin'];
const UNIT_FRONTS = ['drawers:2', 'drawers:3', 'drawers:4', 'door', 'open', 'tambour'];

function buildDesk(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const seg = qSeg(spec, 12);
  const shape = ['rect', 'rounded', 'stadium'].includes(P.shape) ? P.shape : 'rect';
  const topT = clamp(num(P.topT, 0.025), 0.008, Math.min(0.06, h * 0.1));
  const edge = ['straight', 'bevel', 'rounded'].includes(P.edge) ? P.edge : 'straight';
  const cornerR = clamp(num(P.cornerR, 0.005), 0.002, 0.3);
  const frame = FRAMES.includes(P.frame) ? P.frame : 'legs';
  const legStyle = DESK_LEGS.includes(P.legStyle) ? P.legStyle : 'metal-thin';
  const legD = clamp(num(P.legD, 0.03), 0.012, 0.08);
  const legInset = clamp(num(P.legInset, 0.04), 0, Math.min(0.3, w / 4));
  const unit = ['left', 'right', 'both'].includes(P.unit) ? P.unit : 'none';
  const unitFronts = UNIT_FRONTS.includes(P.unitFronts) ? P.unitFronts : 'drawers:3';
  const drawers = clamp(Math.round(num(P.drawers, 0)), 0, 3);
  const shelf = ['low', 'under'].includes(P.shelf) ? P.shelf : 'none';
  const hutch = ['shelf', 'upstand'].includes(P.hutch) ? P.hutch : 'none';
  const hutchH = clamp(num(P.hutchH, 0.3), 0.1, 0.6);
  const handle = ['knob', 'bar', 'cutout', 'edge'].includes(P.handle) ? P.handle : 'none';
  const frontStyle = typeof P.frontStyle === 'string' ? P.frontStyle : 'flat';
  const lm = legMats(spec, 'black-metal');
  const body = pm(spec, 'body', 'painted');
  const front = pm(spec, 'front', 'painted');
  const hm = pm(spec, 'handle', 'black-metal');
  const yUnder = h - topT;
  const surfaces = [{ y: h, w: +(w - 0.06).toFixed(3), d: +(d - 0.06).toFixed(3), center: [0, 0] }];

  // -- top ------------------------------------------------------------------------------------------------------
  const outline = tableTop(g, spec, { shape, w, d, h, topT, edge, cornerR, n: qSeg(spec, 48) });
  const herring = P.topPattern === 'herringbone' && shape === 'rect';
  if (herring) {
    // herringbone veneer (Øland): a dark joint sheet and the tiles just on the top face
    const face = herringboneGeometry(w - 0.004, d - 0.004);
    face.rotateX(-Math.PI / 2);
    add(g, K.box(w - 0.004, 0.0003, d - 0.004), mat(M.top || 'oak', tone(C.top, 0.45)), 'top', 0, h + 0.00015, 0);
    add(g, face, pm(spec, 'top', 'oak'), 'top', 0, h + 0.0005, 0);
  }

  // -- units (drawer/door sections) ------------------------------------------------------------------------------
  const sides = unit === 'both' ? [-1, 1] : unit === 'left' ? [-1] : unit === 'right' ? [1] : [];
  const uw = clamp(num(P.unitW, 0.4), 0.25, Math.min(0.7, w * (sides.length > 1 ? 0.4 : 0.6)));
  const uhP = clamp(num(P.unitH, 0), 0, 0.8);
  const uh = uhP > 0 ? Math.min(Math.max(uhP, 0.08), yUnder) : yUnder;
  const toFloor = uh >= yUnder - 0.02;
  const ud = clamp(num(P.unitDepth, d - 0.04), 0.25, d - 0.02);
  const tambour = unitFronts === 'tambour';
  // hidden unitLegH: a floor-standing unit on four short square feet instead of a plinth (Madrid)
  const unitLegH = clamp(num(P.unitLegH, 0), 0, 0.3);
  const floorSides = new Set();
  for (const s of sides) {
    const cab = buildCabinet({
      dims: { w: uw, d: ud, h: toFloor ? yUnder : uh },
      params: {
        fronts: [tambour ? 'door' : unitFronts], frontStyle: tambour ? 'ribbed' : frontStyle, slidingDoors: tambour,
        base: toFloor ? (unitLegH > 0.01 ? 'legs' : 'plinth') : 'none', legH: toFloor ? (unitLegH > 0.01 ? unitLegH : 0.02) : 0, handle, top: 'same', corners: 'square',
        ...(toFloor && unitLegH > 0.01 ? { legStyle: 'block', squareFeet: true } : {}),
      },
      colors: spec.colors, materials: spec.materials, quality: spec.quality,
    }, 'desk-unit');
    cab.position.set(s * (w / 2 - uw / 2 - 0.01), toFloor ? 0 : yUnder - uh, -0.01);
    g.add(cab);
    if (toFloor) floorSides.add(s);
  }
  const keep = (x) => !floorSides.has(Math.sign(x));

  // -- frame ----------------------------------------------------------------------------------------------------
  let inner = w / 2 - 0.05; // x of the frame's inner face (free span between the ends)
  let zBack = -d / 2 + 0.03; // plane of a modesty panel
  let zFront = d / 2 - Math.max(0.02, legInset); // drawer faces
  const wood = lm.group === 'wood';
  if (frame === 'legs') {
    const anchors = legAnchors(shape, outline, w, d, legInset, legD, 4);
    for (const a of anchors) if (keep(a.x)) styledLeg(g, legStyle, a, yUnder, legD, lm, seg);
    inner = Math.max(...anchors.map((a) => Math.abs(a.x))) - legD / 2;
    const az = Math.max(...anchors.map((a) => Math.abs(a.z)));
    zBack = -(az - legD / 2) - 0.008;
    zFront = Math.min(zFront, az + legD / 2);
  } else if (frame === 'u-frame') {
    // a closed tube rectangle at each end (top rail, two posts, floor rail) and a back stretcher
    const tw = clamp(legD, 0.02, 0.05);
    const fx = w / 2 - legInset - tw / 2;
    const dz = d - 2 * Math.max(legInset, 0.03);
    for (const sx of [-1, 1]) {
      if (!keep(sx)) continue;
      const x = sx * fx;
      add(g, K.box(tw, tw, dz, { grain: 'z' }), lm.box, 'legs', x, yUnder - tw / 2, 0);
      add(g, K.box(tw, tw, dz, { grain: 'z' }), lm.box, 'legs', x, tw / 2, 0);
      for (const sz of [-1, 1]) add(g, K.box(tw, yUnder - 2 * tw, tw, { grain: 'y' }), lm.box, 'legs', x, yUnder / 2, sz * (dz / 2 - tw / 2));
    }
    inner = fx - tw / 2;
    zBack = -dz / 2 + tw / 2;
    const xa = floorSides.has(-1) ? -w / 2 + uw : -inner, xb = floorSides.has(1) ? w / 2 - uw : inner;
    add(g, K.box(xb - xa, 0.04, 0.02, { grain: 'x' }), lm.box, 'legs', (xa + xb) / 2, yUnder - 0.06, zBack);
  } else if (frame === 'a-frame' || frame === 'trestle' || frame === 'x') {
    const fx = w / 2 - Math.max(legInset, 0.06) - 0.03;
    const span = clamp(d * 0.72, 0.25, d - 0.06);
    for (const sx of [-1, 1]) {
      if (!keep(sx)) continue;
      const x = sx * fx;
      if (frame === 'a-frame') {
        // two flat bars splayed across the depth and a rail under the top (the dining table's A-frames)
        const legW = 0.05, legT = wood ? 0.035 : 0.022, railH = 0.04;
        const zTop = clamp(d * 0.27, 0.1, d / 2 - 0.06);
        const zFoot = Math.min(d / 2 - 0.03, zTop + yUnder * 0.12);
        for (const sz of [-1, 1]) add(g, barYZ(sz * zFoot, 0, sz * zTop, yUnder - railH, legW, legT), lm.box, 'legs', x, 0, 0);
        add(g, K.box(legT, railH, 2 * zTop + legW, { grain: 'z' }), lm.box, 'legs', x, yUnder - railH / 2, 0);
      } else if (frame === 'trestle') {
        // a solid panel with a narrow waist on a foot rail
        const pw = wood ? 0.04 : 0.015;
        const s2 = [[-span / 2, 0], [span / 2, 0], [span / 2, 0.05], [span * 0.2, 0.12], [span * 0.2, yUnder - 0.1], [span * 0.4, yUnder], [-span * 0.4, yUnder], [-span * 0.2, yUnder - 0.1], [-span * 0.2, 0.12], [-span / 2, 0.05]];
        const geo = K.extrudeShape(s2, pw, { center: true, bevel: Math.min(0.004, pw / 4), bevelSegments: 1, curveSegments: 2 });
        geo.rotateY(Math.PI / 2);
        K.worldUV(geo, 1, { grain: 'y' });
        add(g, geo, lm.box, 'legs', x, 0, 0);
      } else {
        const bw = wood ? 0.05 : 0.035, bt = wood ? 0.035 : 0.015;
        const len = Math.hypot(span, yUnder), ang = Math.atan2(span, yUnder);
        for (const s2 of [-1, 1]) add(g, K.box(bt, len, bw, { grain: 'y' }), lm.box, 'legs', x + s2 * bt * 0.55, yUnder / 2, 0, [s2 * ang, 0, 0]);
      }
    }
    inner = fx - 0.03;
    const xa = floorSides.has(-1) ? -w / 2 + uw : -fx, xb = floorSides.has(1) ? w / 2 - uw : fx;
    // stretcher (trestle, x) low between the ends; a spine under the top toward the back
    if (frame !== 'a-frame') add(g, K.box(xb - xa, 0.04, 0.035, { grain: 'x' }), lm.box, 'legs', (xa + xb) / 2, frame === 'trestle' ? 0.2 : yUnder * 0.45, 0);
    add(g, K.box(xb - xa, 0.03, 0.03, { grain: 'x' }), body, 'body', (xa + xb) / 2, yUnder - 0.015, -d / 4);
  } else if (frame === 'panel') {
    // end gables and (always) a back panel between them; hidden gableStyle 'framed': each gable is two square legs
    // with a recessed panel between them (Madrid)
    for (const sx of [-1, 1]) {
      if (!keep(sx)) continue;
      if (P.gableStyle === 'framed') {
        const s = clamp(legD, 0.03, 0.07), gd = d - 0.02;
        for (const sz of [-1, 1]) add(g, K.box(s, yUnder, s, { grain: 'y' }), lm.box, 'legs', sx * (w / 2 - s / 2), yUnder / 2, -0.01 + sz * (gd / 2 - s / 2));
        add(g, K.box(0.016, yUnder - 0.06, gd - 2 * s + 0.004, { grain: 'y' }), lm.box, 'legs', sx * (w / 2 - s / 2), (yUnder + 0.06) / 2, -0.01);
      } else add(g, K.box(0.03, yUnder, d - 0.02, { grain: 'y' }), lm.box, 'legs', sx * (w / 2 - 0.015), yUnder / 2, -0.01);
    }
    inner = w / 2 - 0.03;
    zBack = -d / 2 + 0.02;
  } else {
    // sit-stand: a T foot, an outer and an inner column and a side rail at each end; a crossbar and a control panel
    const colH = Math.min(0.55, yUnder * 0.6);
    const fx = w / 2 - 0.12;
    for (const sx of [-1, 1]) {
      if (!keep(sx)) continue;
      const x = sx * fx;
      add(g, K.roundedBox(0.07, 0.035, d - 0.06, 0.01, 2, { grain: 'z', bottom: true }), lm.box, 'legs', x, 0, 0);
      add(g, K.box(0.085, colH, 0.065, { grain: 'y' }), lm.box, 'legs', x, 0.035 + colH / 2, -0.02);
      const iy0 = 0.035 + colH - 0.02, iy1 = yUnder - 0.03;
      if (iy1 > iy0 + 0.01) add(g, K.box(0.075, iy1 - iy0, 0.055, { grain: 'y' }), lm.box, 'legs', x, (iy0 + iy1) / 2, -0.02);
      add(g, K.box(0.05, 0.03, d - 0.1, { grain: 'z' }), lm.box, 'legs', x, yUnder - 0.015, 0);
    }
    add(g, K.box(w - 0.24, 0.03, 0.05, { grain: 'x' }), lm.box, 'legs', 0, yUnder - 0.03, -0.05);
    add(g, K.roundedBox(0.07, 0.018, 0.045, 0.006, 2), hm, 'handle', w / 2 - 0.22, yUnder - 0.009, d / 2 - 0.04);
    inner = fx - 0.045;
  }

  // free span between the ends / units
  const xa = sides.includes(-1) ? -w / 2 + 0.01 + uw + 0.004 : -inner;
  const xb = sides.includes(1) ? w / 2 - 0.01 - uw - 0.004 : inner;
  const span = xb - xa, cx0 = (xa + xb) / 2;

  // -- apron drawers ----------------------------------------------------------------------------------------------
  let complexFront = sides.length > 0 && (tambour || frontStyle !== 'flat' || handle === 'cutout');
  if (drawers > 0 && span > 0.2) {
    const bandH = Math.min(0.1, yUnder * 0.3);
    const yc = yUnder - bandH / 2;
    const zb = -d / 2 + Math.max(0.04, legInset);
    const housingD = zFront - 0.019 - zb;
    if (housingD > 0.05) add(g, K.box(span, bandH, housingD, { grain: 'x' }), body, 'body', cx0, yc, zb + housingD / 2);
    add(g, K.box(span, bandH - 0.002, 0.004), darkInside(), null, cx0, yc, zFront - 0.021);
    const fw = (span - 0.003 * (drawers - 1)) / drawers, fh = bandH - 0.006;
    const ribbed = frontStyle === 'ribbed';
    for (let k = 0; k < drawers; k++) {
      const cx = xa + fw / 2 + k * (fw + 0.003);
      if (ribbed) add(g, ribPanelGeometry(fw, fh, { pitch: 0.016, depth: 0.0045, t: 0.0145, seg: spec.quality === 'low' ? 3 : 5 }), front, 'front', cx, yc, zFront - 0.019);
      else add(g, K.roundedBox(fw, fh, 0.019, 0.0012, 1, { grain: 'x' }), front, 'front', cx, yc, zFront - 0.0095);
      drawerHandle(g, handle, hm, cx, yc, zFront, fw, fh, 16, C.front);
    }
    complexFront = complexFront || ribbed || handle === 'cutout';
  }

  // -- shelf, modesty panel ---------------------------------------------------------------------------------------
  if (shelf === 'low' && span > 0.15) {
    const sd = d - 2 * Math.max(legInset + legD, 0.05);
    add(g, K.roundedBox(span, 0.018, sd, 0.002, 1, { grain: 'x' }), body, 'body', cx0, 0.111, 0);
    surfaces.push({ y: 0.12, w: +(span - 0.04).toFixed(3), d: +(sd - 0.04).toFixed(3), center: [+cx0.toFixed(3), 0] });
  } else if (shelf === 'under' && span > 0.15) {
    const sd = d * 0.75, y = yUnder - 0.16, zc = -d / 2 + 0.02 + sd / 2;
    add(g, K.roundedBox(span, 0.018, sd, 0.002, 1, { grain: 'x' }), body, 'body', cx0, y, zc);
    for (const sx of [-1, 1]) add(g, K.box(0.012, 0.16, sd, { grain: 'y' }), body, 'body', cx0 + sx * (span / 2 - 0.006), yUnder - 0.08, zc);
    surfaces.push({ y: +(y + 0.009).toFixed(4), w: +(span - 0.04).toFixed(3), d: +(sd - 0.04).toFixed(3), center: [+cx0.toFixed(3), +zc.toFixed(3)] });
  }
  if ((P.modesty === true || frame === 'panel') && span > 0.1) {
    const mh = Math.min(0.32, yUnder - 0.05);
    add(g, K.box(span, mh, 0.016, { grain: 'x' }), body, 'body', cx0, yUnder - mh / 2, zBack);
  }

  // -- hutch ------------------------------------------------------------------------------------------------------
  if (hutch !== 'none') {
    const ex = w / 2 - Math.max(0.03, shape === 'stadium' ? Math.min(w, d) / 2 : shape === 'rounded' ? cornerR : 0);
    const hd = Math.min(0.25, d * 0.5);
    if (hutch === 'shelf') {
      for (const sx of [-1, 1]) add(g, K.box(0.02, hutchH, 0.02, { grain: 'y' }), body, 'body', sx * ex, h + hutchH / 2, -d / 2 + 0.02);
      add(g, K.roundedBox(2 * ex + 0.04, 0.018, hd, 0.002, 1, { grain: 'x' }), body, 'body', 0, h + hutchH - 0.009, -d / 2 + hd / 2);
      surfaces.push({ y: +(h + hutchH).toFixed(4), w: +(2 * ex).toFixed(3), d: +(hd - 0.04).toFixed(3), center: [0, +(-d / 2 + hd / 2).toFixed(3)] });
    } else {
      const ed = Math.min(0.2, d * 0.4);
      add(g, K.box(2 * ex + 0.06, hutchH, 0.018, { grain: 'x' }), body, 'body', 0, h + hutchH / 2, -d / 2 + 0.009);
      for (const sx of [-1, 1]) add(g, K.box(0.018, hutchH, ed, { grain: 'y' }), body, 'body', sx * (ex + 0.021), h + hutchH / 2, -d / 2 + ed / 2);
      add(g, K.box(2 * ex + 0.024, 0.018, ed - 0.018, { grain: 'x' }), body, 'body', 0, h + hutchH * 0.5, -d / 2 + 0.018 + (ed - 0.018) / 2);
      surfaces.push({ y: +(h + hutchH * 0.5 + 0.009).toFixed(4), w: +(2 * ex).toFixed(3), d: +(ed - 0.04).toFixed(3), center: [0, +(-d / 2 + ed / 2).toFixed(3)] });
    }
  }

  const legKind = M.legs || 'black-metal';
  const handleKind = M.handle || 'black-metal';
  const rc = recolorer(g, (part, kind) => {
    if (part === 'top') return edge === 'bevel' || herring;
    if (part === 'front') return complexFront || (!!kind && kind !== (M.front || 'painted'));
    if (part === 'legs') return !!kind && kindGroup(kind) !== kindGroup(legKind);
    if (part === 'handle') return !!kind && kindGroup(kind) !== kindGroup(handleKind);
    return false;
  });
  g.name = 'desk';
  return K.finishModel(g, { surfaces, recolor: rc });
}

/**
 * Desk archetypes for models/registry.js: { id: Def } with Norwegian labels, the table parts, defaults, the Inspector
 * param schema and dims ranges. Hidden params (products): frontStyle, legInset, heightMin / heightMax (sit-stand),
 * topPattern ('herringbone'), unitDepth, unitLegH (a floor unit on square feet), gableStyle ('framed': panel frame).
 * @type {Record<string, object>}
 */
export const archetypes = {
  desk: def('desk', {
    defaults: {
      dims: { w: 1.2, d: 0.6, h: 0.75 },
      params: { shape: 'rect', cornerR: 0.005, edge: 'straight', topT: 0.025, frame: 'legs', legStyle: 'metal-thin', legD: 0.03, drawers: 0, unit: 'none', unitFronts: 'drawers:3', unitW: 0.4, unitH: 0, shelf: 'none', modesty: false, hutch: 'none', hutchH: 0.3, handle: 'none' },
      ...finish('#e9e6df', 'painted', '#e9e6df', 'painted', '#1c1c1c', 'black-metal'),
    },
    params: {
      ...P_TOP,
      shape: { type: 'enum', label: 'Form', options: [['rect', 'Rett'], ['rounded', 'Avrundede hjørner'], ['stadium', 'Avrundede ender']] },
      cornerR: { type: 'number', min: 0.002, max: 0.3, step: 0.002, label: 'Hjørneradius (m)' },
      edge: { type: 'enum', label: 'Kant', options: [['straight', 'Rett kant'], ['bevel', 'Tynn kant med skråfas'], ['rounded', 'Avrundet kant']] },
      frame: { type: 'enum', label: 'Understell', options: [['legs', 'Fire ben'], ['u-frame', 'Metallrammer'], ['a-frame', 'A-rammer'], ['panel', 'Gavler'], ['trestle', 'Bukker'], ['x', 'Kryssben'], ['sit-stand', 'Hev-senk (elektrisk)']] },
      legStyle: { type: 'enum', label: 'Ben', options: [['square', 'Firkantede'], ['round-taper', 'Runde, smalnende'], ['splayed', 'Skrå'], ['metal-thin', 'Tynne runde metallben'], ['metal-square', 'Firkantrør'], ['hairpin', 'Hårnålsben']] },
      legD: { type: 'number', min: 0.012, max: 0.08, step: 0.002, label: 'Bentykkelse (m)' },
      drawers: { type: 'number', min: 0, max: 3, step: 1, label: 'Skuffer under platen' },
      unit: { type: 'enum', label: 'Skuffeseksjon', options: [['none', 'Ingen'], ['left', 'Til venstre'], ['right', 'Til høyre'], ['both', 'På begge sider']] },
      unitFronts: { type: 'enum', label: 'Seksjonen', options: [['drawers:2', 'To skuffer'], ['drawers:3', 'Tre skuffer'], ['drawers:4', 'Fire skuffer'], ['door', 'Dør'], ['open', 'Åpen hylle'], ['tambour', 'Sjalusidør']] },
      unitW: { type: 'number', min: 0.25, max: 0.7, step: 0.01, label: 'Bredde seksjon (m)' },
      unitH: { type: 'number', min: 0, max: 0.8, step: 0.01, label: 'Høyde seksjon (m) – 0 = helt ned' },
      shelf: { type: 'enum', label: 'Hylle', options: [['none', 'Ingen'], ['low', 'Hylle nede'], ['under', 'Hylle under platen']] },
      modesty: { type: 'bool', label: 'Bakplate mellom bena' },
      hutch: { type: 'enum', label: 'Overbygg', options: [['none', 'Uten'], ['shelf', 'Hylle over platen'], ['upstand', 'Påbygg bak']] },
      hutchH: { type: 'number', min: 0.1, max: 0.6, step: 0.01, label: 'Høyde overbygg (m)' },
      handle: { type: 'enum', label: 'Håndtak', options: [['none', 'Uten'], ['knob', 'Knott'], ['bar', 'Stanggrep'], ['cutout', 'Innfrest grep'], ['edge', 'Grepslist']] },
    },
    dimsRange: { w: [0.6, 2.2], d: [0.35, 0.9], h: [0.6, 1.3] },
    build: buildDesk,
  }),
};
