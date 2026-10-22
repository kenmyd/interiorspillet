/**
 * Fasadesjekk – the house's facades drawn from the plan like a facade drawing, one side at a time (nord, øst, sør, vest
 * as tabs, a small plan that marks the side): every exterior wall seen from outside, the levels stacked with their lines,
 * the ground, the windows and doors where they are. Pick one (or step through all with ‹ › and the arrow keys) to set its
 * width, height and sill in centimetres and its type as pictures (a window: export.js WINDOW_STYLES and bars; a door:
 * DOOR_TYPES). The changes go straight into the document (with undo); «Ferdig» rebuilds the 3D house.
 *
 * For a house without facade drawings, where one sill and height for every window was wrong for half of them (the
 * owner's own house, F110, F112: «generer huset først og vis fasadene side etter side der jeg kan klikke på vinduene»).
 *
 *   buildFacades(doc)   → [{ key, name, walls, openings, sMin, sMax, yMin, yMax }]   pure, plan metres
 *   openFacadeCheck({ getDoc, h, intro, onChange(label, fn), onDone(changed) }) → { el, close }
 */
import { WINDOW_STYLES, windowSashes } from './export.js';
import { DEFAULT_SETTINGS, setOpeningKind, openingKind } from './model.js';
import { round } from './geom.js';

const SIDES = [
  ['N', 'Nord'],
  ['E', 'Øst'],
  ['S', 'Sør'],
  ['W', 'Vest'],
];

/** The door types the facade check offers, [type, Norwegian label] (doorType / setDoorType). */
export const DOOR_TYPES = Object.freeze([
  ['single', 'Vanlig dør'],
  ['glass', 'Dør med glassfelt'],
  ['double', 'Dobbeltdør'],
  ['sliding-surface', 'Skyvedør på skinne'],
  ['sliding-pocket', 'Skyvedør inn i veggen'],
  ['patio', 'Glass-skyvedør (terrasse)'],
  ['folding', 'Foldedør'],
]);

/** Bars (sprosser) the facade check offers: [value, label, [columns, rows] | null]. */
const PANES = [
  ['0', 'Ingen', null],
  ['2x2', '2 × 2 ruter', [2, 2]],
  ['2x3', '2 × 3 ruter', [2, 3]],
  ['3x3', '3 × 3 ruter', [3, 3]],
  ['2x4', '2 × 4 ruter', [2, 4]],
  ['3x4', '3 × 4 ruter', [3, 4]],
];

/** A door's type as DOOR_TYPES names it. */
export function doorType(o) {
  const kind = openingKind(o);
  if (kind === 'double' || kind === 'folding') return kind;
  if (kind === 'sliding') return o.mount === 'patio' ? 'patio' : o.mount === 'pocket' ? 'sliding-pocket' : 'sliding-surface';
  return o.glass ? 'glass' : 'single';
}

/** Makes a door the DOOR_TYPES type: variant, mount and glass together. */
export function setDoorType(o, type, settings = DEFAULT_SETTINGS) {
  const kind = type === 'glass' ? 'single' : type.startsWith('sliding') || type === 'patio' ? 'sliding' : type;
  setOpeningKind(o, kind, settings);
  if (kind === 'sliding') o.mount = type === 'patio' ? 'patio' : type === 'sliding-pocket' ? 'pocket' : 'surface';
  // a hinged door chosen plain stays plain (the export would give a terrace door glass by its room)
  if (kind === 'single') o.glass = type === 'glass';
  else if (type === 'patio') delete o.glass;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);

/** How many of the segments a ray from p in direction d crosses. */
function crossings(p, d, segs) {
  let n = 0;
  for (const [c, e] of segs) {
    const r = sub(e, c);
    const den = d[0] * r[1] - d[1] * r[0];
    if (Math.abs(den) < 1e-12) continue;
    const q = sub(c, p);
    const t = (q[0] * r[1] - q[1] * r[0]) / den;
    const s = (q[0] * d[1] - q[1] * d[0]) / den;
    if (t > 1e-6 && s >= 0 && s < 1) n++;
  }
  return n;
}

/**
 * The facades of the house from the document: the exterior walls of each level grouped by the compass side they face
 * (doc.settings.north), each projected on its facade (s: metres from the left as seen from outside, y: metres above the
 * main floor), with its windows and doors. The outward side of a wall is the one from which a ray crosses the level's
 * other exterior walls an even number of times.
 */
export function buildFacades(doc) {
  const settings = { ...DEFAULT_SETTINGS, ...(doc.settings || {}) };
  const t = ((settings.north ?? 0) * Math.PI) / 180;
  const N = [Math.sin(t), -Math.cos(t)]; // north in the plan (y down)
  const E = [-N[1], N[0]];
  const dirs = { N, E, S: [-N[0], -N[1]], W: [-E[0], -E[1]] };
  const out = Object.fromEntries(SIDES.map(([key, name]) => [key, { key, name, walls: [], openings: [] }]));
  for (const L of doc.levels) {
    const ext = L.walls.filter((w) => w.exterior && len(sub(w.b, w.a)) > 0.05);
    const y0 = L.floorY ?? 0;
    const y1 = y0 + (L.ceiling ?? settings.ceiling ?? 2.4);
    for (const w of ext) {
      const lw = len(sub(w.b, w.a));
      const u = [(w.b[0] - w.a[0]) / lw, (w.b[1] - w.a[1]) / lw];
      const n = [-u[1], u[0]];
      const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const others = ext.filter((x) => x !== w).map((x) => [x.a, x.b]);
      const outward = crossings(mid, n, others) % 2 === 0 ? n : [-n[0], -n[1]];
      const dn = outward[0] * N[0] + outward[1] * N[1];
      const de = outward[0] * E[0] + outward[1] * E[1];
      const key = Math.abs(dn) >= Math.abs(de) ? (dn > 0 ? 'N' : 'S') : de > 0 ? 'E' : 'W';
      const d = dirs[key];
      const right = [d[1], -d[0]]; // the right hand of someone outside looking at the wall
      const s = (p) => p[0] * right[0] + p[1] * right[1];
      const depth = mid[0] * d[0] + mid[1] * d[1];
      const F = out[key];
      F.walls.push({ level: L.id, levelName: L.name, id: w.id, a: w.a, b: w.b, s0: Math.min(s(w.a), s(w.b)), s1: Math.max(s(w.a), s(w.b)), y0, y1, depth });
      for (const o of L.openings) {
        if (o.wall !== w.id || (o.type !== 'window' && o.type !== 'door')) continue;
        const pa = [w.a[0] + u[0] * (o.at - o.width / 2), w.a[1] + u[1] * (o.at - o.width / 2)];
        const pb = [w.a[0] + u[0] * (o.at + o.width / 2), w.a[1] + u[1] * (o.at + o.width / 2)];
        const win = o.type === 'window';
        const sill = win ? (o.sill ?? settings.windowSill) : 0;
        const height = o.height ?? (win ? settings.windowHeight : settings.doorHeight);
        F.openings.push({ level: L.id, levelName: L.name, id: o.id, win, s0: Math.min(s(pa), s(pb)), s1: Math.max(s(pa), s(pb)), y0: y0 + sill, y1: y0 + sill + height, sill, height, depth });
      }
    }
  }
  const list = SIDES.map(([key]) => out[key]).filter((F) => F.walls.length);
  for (const F of list) {
    F.walls.sort((a, b) => a.depth - b.depth); // far ones first, the near ones drawn over them
    F.sMin = Math.min(...F.walls.map((w) => w.s0));
    F.sMax = Math.max(...F.walls.map((w) => w.s1));
    F.yMin = Math.min(...F.walls.map((w) => w.y0));
    F.yMax = Math.max(...F.walls.map((w) => w.y1));
    F.dir = dirs[F.key];
    // the levels on this side, top first (the level lines and their names)
    F.levels = [...new Map(F.walls.map((w) => [w.level, { id: w.level, name: w.levelName, y0: w.y0, y1: w.y1 }])).values()].sort((a, b) => b.y0 - a.y0);
  }
  return list;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

/** The opening and its wall in the document. */
function find(doc, levelId, id) {
  const L = doc.levels.find((l) => l.id === levelId);
  const o = L?.openings.find((x) => x.id === id);
  return o ? { L, o, w: L.walls.find((x) => x.id === o.wall) } : null;
}

const cm = (m) => Math.round(m * 100);
const mFmt = (m) => `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(2).replace('.', ',')}`;

/**
 * A window drawn the way a facade drawing shows it, into the rectangle x0..x1 × yT..yB (px): the frame, the glass of
 * each sash, the opening symbol (two lines from the far corners to the middle of the hinge side) and the bars. The
 * sashes are fractions from the left as seen from the room – from outside their order is mirrored.
 */
function drawWindow(g, x0, yT, x1, yB, sashes, panes) {
  const fw = Math.max(1.2, Math.min(4, Math.min(x1 - x0, yB - yT) * 0.07));
  g.append(svg('rect', { x: x0, y: yT, width: x1 - x0, height: yB - yT, class: 'fc-frame' }));
  for (const sa of sashes) {
    const sx0 = x0 + (1 - sa.to) * (x1 - x0);
    const sx1 = x0 + (1 - sa.from) * (x1 - x0);
    const sy1 = yB - sa.top * (yB - yT);
    const sy0 = yB - sa.bottom * (yB - yT);
    const ix0 = sx0 + fw;
    const ix1 = sx1 - fw;
    const iy1 = sy1 + fw;
    const iy0 = sy0 - fw;
    if (ix1 - ix0 < 1 || iy0 - iy1 < 1) continue;
    g.append(svg('rect', { x: ix0, y: iy1, width: ix1 - ix0, height: iy0 - iy1, class: 'fc-glass' }));
    const p = sa.panes ?? panes;
    if (Array.isArray(p)) {
      for (let i = 1; i < p[0]; i++) {
        const x = ix0 + ((ix1 - ix0) * i) / p[0];
        g.append(svg('line', { x1: x, x2: x, y1: iy1, y2: iy0, class: 'fc-bar' }));
      }
      for (let i = 1; i < p[1]; i++) {
        const y = iy1 + ((iy0 - iy1) * i) / p[1];
        g.append(svg('line', { x1: ix0, x2: ix1, y1: y, y2: y, class: 'fc-bar' }));
      }
    }
    if (sa.opening) {
      const side = sa.hinge === 'left' ? 'right' : sa.hinge === 'right' ? 'left' : sa.hinge ?? 'top';
      const mx = (ix0 + ix1) / 2;
      const my = (iy0 + iy1) / 2;
      const pts =
        side === 'top' ? [[ix0, iy0], [mx, iy1], [ix1, iy0]]
        : side === 'bottom' ? [[ix0, iy1], [mx, iy0], [ix1, iy1]]
        : side === 'left' ? [[ix1, iy1], [ix0, my], [ix1, iy0]]
        : [[ix0, iy1], [ix1, my], [ix0, iy0]];
      g.append(svg('path', { d: `M${pts[0][0]} ${pts[0][1]}L${pts[1][0]} ${pts[1][1]}L${pts[2][0]} ${pts[2][1]}`, class: 'fc-symbol' }));
    }
  }
}

/** A door drawn as on a facade drawing: the frame, the leaf or leaves, glass, a handle and the way it opens. */
function drawDoor(g, x0, yT, x1, yB, type) {
  const fw = Math.max(1.2, Math.min(4, (x1 - x0) * 0.06));
  const W = x1 - x0;
  const H = yB - yT;
  g.append(svg('rect', { x: x0, y: yT, width: W, height: H, class: 'fc-frame' }));
  const lx0 = x0 + fw;
  const lx1 = x1 - fw;
  const ly = yT + fw;
  const leaf = (a, b, glass, handleAt) => {
    g.append(svg('rect', { x: a, y: ly, width: b - a, height: yB - ly, class: glass ? 'fc-leaf is-glass' : 'fc-leaf' }));
    if (glass) {
      const gx0 = a + (b - a) * 0.18;
      const gx1 = b - (b - a) * 0.18;
      const gy0 = ly + H * 0.08;
      const gy1 = ly + H * 0.62;
      g.append(svg('rect', { x: gx0, y: gy0, width: gx1 - gx0, height: gy1 - gy0, class: 'fc-glass' }));
      for (let i = 1; i < 3; i++) g.append(svg('line', { x1: gx0, x2: gx1, y1: gy0 + ((gy1 - gy0) * i) / 3, y2: gy0 + ((gy1 - gy0) * i) / 3, class: 'fc-bar' }));
    }
    if (handleAt != null) g.append(svg('circle', { cx: handleAt, cy: yT + H * 0.52, r: Math.max(1.2, W * 0.025), class: 'fc-handle' }));
  };
  const mid = (lx0 + lx1) / 2;
  const arrow = (xa, xb, y) => g.append(svg('path', { d: `M${xa} ${y}L${xb} ${y}M${xb - Math.sign(xb - xa) * 5} ${y - 4}L${xb} ${y}L${xb - Math.sign(xb - xa) * 5} ${y + 4}`, class: 'fc-arrow' }));
  if (type === 'double') {
    leaf(lx0, mid, false, mid - W * 0.06);
    leaf(mid, lx1, false, null);
  } else if (type === 'patio') {
    g.append(svg('rect', { x: lx0, y: ly, width: lx1 - lx0, height: yB - ly, class: 'fc-glass' }));
    g.append(svg('line', { x1: mid, x2: mid, y1: ly, y2: yB, class: 'fc-mullion' }));
    arrow(mid + W * 0.08, lx1 - W * 0.08, yT + H * 0.5);
  } else if (type === 'folding') {
    const n = 4;
    for (let i = 0; i < n; i++) leaf(lx0 + ((lx1 - lx0) * i) / n, lx0 + ((lx1 - lx0) * (i + 1)) / n, false, null);
    g.append(svg('path', { d: `M${lx0} ${yB - 4}${Array.from({ length: n }, (_, i) => `L${lx0 + ((lx1 - lx0) * (i + 0.5)) / n} ${yB - 10}L${lx0 + ((lx1 - lx0) * (i + 1)) / n} ${yB - 4}`).join('')}`, class: 'fc-arrow' }));
  } else if (type === 'sliding-surface' || type === 'sliding-pocket') {
    leaf(lx0, lx1, false, lx0 + W * 0.12);
    if (type === 'sliding-pocket') g.append(svg('rect', { x: x1, y: ly, width: W * 0.92, height: yB - ly, class: 'fc-pocket' }));
    arrow(mid - W * 0.18, mid + W * 0.22, yT + H * 0.32);
  } else {
    leaf(lx0, lx1, type === 'glass', lx1 - W * 0.12);
  }
}

/** The house's outline seen from above with this side marked, and an eye where you stand. */
function drawCompass(F, all, size = 92) {
  const segs = all.flatMap((x) => x.walls.map((w) => ({ a: w.a, b: w.b, on: x === F })));
  const xs = segs.flatMap((w) => [w.a[0], w.b[0]]);
  const ys = segs.flatMap((w) => [w.a[1], w.b[1]]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const pad = 18;
  const k = (size - 2 * pad) / Math.max(spanX, spanY, 1);
  const ox = pad + ((size - 2 * pad) - spanX * k) / 2;
  const oy = pad + ((size - 2 * pad) - spanY * k) / 2;
  const P = (p) => [ox + (p[0] - minX) * k, oy + (p[1] - minY) * k];
  const g = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'fc-compass' });
  for (const w of segs.sort((a, b) => Number(a.on) - Number(b.on))) {
    const [a, b] = [P(w.a), P(w.b)];
    g.append(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: w.on ? 'fc-compass-on' : 'fc-compass-wall' }));
  }
  const c = [size / 2, size / 2];
  const d = F.dir;
  const e = [c[0] + d[0] * (size / 2 - 7), c[1] + d[1] * (size / 2 - 7)];
  const t = [c[0] + d[0] * (size / 2 - 15), c[1] + d[1] * (size / 2 - 15)];
  g.append(svg('path', { d: `M${e[0]} ${e[1]}L${t[0]} ${t[1]}`, class: 'fc-compass-eye' }), svg('circle', { cx: e[0], cy: e[1], r: 3.2, class: 'fc-compass-dot' }));
  return g;
}

/**
 * The facade check as an overlay over the page. getDoc() is the current document (undo replaces it), onChange(label,
 * fn) runs fn on it with an undo step, onDone(changed) when it is closed.
 */
export function openFacadeCheck({ getDoc, h, intro = null, onChange, onDone }) {
  let selected = null; // { level, id }
  let side = null; // the facade on screen
  let changed = false;
  const seen = new Set();
  const key = (o) => `${o.level}:${o.id}`;
  const settings = () => ({ ...DEFAULT_SETTINGS, ...(getDoc().settings || {}) });
  const tabs = h('div', { class: 'fc-tabs', role: 'tablist' });
  const stage = h('div', { class: 'fc-stage' });
  const panel = h('aside', { class: 'fc-panel' });
  const close = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    el.remove();
    onDone?.(changed);
  };
  const step = (dir) => {
    const list = order();
    if (!list.length) return;
    const i = selected ? list.findIndex((x) => x.level === selected.level && x.id === selected.id) : -1;
    select(list[(i + dir + list.length) % list.length]);
  };
  const onKey = (e) => {
    const tag = e.target?.tagName;
    if (e.key === 'Escape') close();
    else if (tag === 'INPUT' || tag === 'SELECT') return;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      step(1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      step(-1);
      e.preventDefault();
    }
  };
  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 120);
  };
  const el = h('div', { class: 'fc' },
    h('header', { class: 'fc-head' },
      h('div', { class: 'fc-title' }, h('h2', {}, 'Fasadesjekk'), h('p', {}, intro ?? 'Huset sett utenfra, side for side. Velg et vindu eller en dør for å rette mål og type.')),
      tabs,
      h('div', { class: 'fc-head-actions' }, h('button', { class: 'pb-btn is-primary', onclick: () => close() }, 'Ferdig – bygg 3D-huset'))),
    h('div', { class: 'fc-body' }, stage, panel));
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.body.append(el);

  /** Every window and door in reading order: side by side, top level first, left to right. */
  function order() {
    return buildFacades(getDoc()).flatMap((F) =>
      [...F.openings].sort((a, b) => (Math.abs(a.y0 - b.y0) > 1 ? b.y0 - a.y0 : a.s0 - b.s0)).map((o) => ({ ...o, side: F.key })));
  }
  function select(o) {
    selected = { level: o.level, id: o.id };
    seen.add(key(o));
    side = o.side ?? side;
    render();
  }
  const apply = (label, fn) => {
    onChange(label, () => {
      const f = selected && find(getDoc(), selected.level, selected.id);
      if (f) fn(f);
    });
    changed = true;
    render();
  };

  function render() {
    const doc = getDoc();
    const facades = buildFacades(doc);
    if (!side || !facades.some((F) => F.key === side)) side = facades[0]?.key ?? null;
    tabs.innerHTML = '';
    for (const F of facades) {
      const n = F.openings.length;
      const done = F.openings.filter((o) => seen.has(key(o))).length;
      tabs.append(h('button', { class: `fc-tab${F.key === side ? ' is-on' : ''}`, role: 'tab', onclick: () => ((side = F.key), render()) },
        F.name, h('span', { class: `fc-badge${n && done === n ? ' is-done' : ''}` }, n ? `${done}/${n}` : '–')));
    }
    stage.innerHTML = '';
    const F = facades.find((x) => x.key === side);
    if (!F) {
      stage.append(h('p', { class: 'fc-empty' }, 'Fant ingen yttervegger å vise. Merk ytterveggene i «Finjuster».'));
      renderPanel(doc, facades);
      return;
    }
    const wins = F.openings.filter((o) => o.win).length;
    stage.append(h('div', { class: 'fc-sheet-head' }, drawCompass(F, facades),
      h('div', {}, h('h3', {}, `${F.name}fasaden`), h('p', {}, `Sett utenfra fra ${F.name.toLowerCase()} · ${wins} vindu${wins === 1 ? '' : 'er'}, ${F.openings.length - wins} dør${F.openings.length - wins === 1 ? '' : 'er'}`))));
    const sheet = h('div', { class: 'fc-sheet' });
    stage.append(sheet);
    // the drawing, fitted to the stage
    const box = stage.getBoundingClientRect();
    const padL = 96;
    const padR = 40;
    const padT = 40;
    const padB = 26;
    const ground = -0.15;
    const yBottom = Math.min(F.yMin, ground) - 0.4;
    const availW = Math.max(380, box.width - 56) - padL - padR;
    const availH = Math.max(240, box.height - 170) - padT - padB;
    const k = Math.min(availW / Math.max(1, F.sMax - F.sMin), availH / Math.max(1, F.yMax - yBottom));
    const X = (s) => padL + (s - F.sMin) * k;
    const Y = (y) => padT + (F.yMax - y) * k;
    const W = padL + padR + (F.sMax - F.sMin) * k;
    const Hh = padT + padB + (F.yMax - yBottom) * k;
    const g = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: 'fc-svg' },
      svg('defs', {}, svg('pattern', { id: 'fc-earth', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, class: 'fc-earth-line' }))));
    for (const w of F.walls) g.append(svg('rect', { x: X(w.s0), y: Y(w.y1), width: Math.max(1, (w.s1 - w.s0) * k), height: (w.y1 - w.y0) * k, class: 'fc-wall' }));
    for (const l of F.levels) {
      g.append(svg('line', { x1: padL - 10, x2: W - padR + 10, y1: Y(l.y0), y2: Y(l.y0), class: 'fc-level' }));
      g.append(svg('text', { x: 10, y: Y(l.y0) - 6, class: 'fc-level-name' }, l.name), svg('text', { x: 10, y: Y(l.y0) + 13, class: 'fc-level-h' }, mFmt(l.y0)));
    }
    for (const op of F.openings) {
      const f = find(doc, op.level, op.id);
      if (!f) continue;
      const x0 = X(op.s0);
      const x1 = X(op.s1);
      const yT = Y(op.y1);
      const yB = Y(op.y0);
      const isSel = selected && selected.level === op.level && selected.id === op.id;
      const grp = svg('g', { class: `fc-op${isSel ? ' is-selected' : ''}${seen.has(key(op)) ? ' is-seen' : ''}` });
      if (op.win) drawWindow(grp, x0, yT, x1, yB, windowSashes(f.o.style, f.o.width, op.height, op.sill), f.o.panes);
      else drawDoor(grp, x0, yT, x1, yB, doorType(f.o));
      grp.append(svg('rect', { x: x0 - 5, y: yT - 5, width: x1 - x0 + 10, height: yB - yT + 10, rx: 4, class: 'fc-hit' }));
      if (seen.has(key(op)) && !isSel) grp.append(svg('circle', { cx: x1 + 1, cy: yT - 1, r: 5, class: 'fc-check' }));
      grp.addEventListener('click', () => select({ ...op, side: F.key }));
      g.append(grp);
    }
    g.append(svg('rect', { x: 0, y: Y(ground), width: W, height: Hh - Y(ground), class: 'fc-earth' }), svg('line', { x1: 0, x2: W, y1: Y(ground), y2: Y(ground), class: 'fc-ground' }));
    // the chosen one's measures: its width over it, its height to the right, the sill under it
    const sel = selected && F.openings.find((o) => o.level === selected.level && o.id === selected.id);
    if (sel) {
      const x0 = X(sel.s0);
      const x1 = X(sel.s1);
      const yT = Y(sel.y1);
      const yB = Y(sel.y0);
      const dim = (xa, ya, xb, yb, label, lx, ly, vertical = false) => {
        g.append(svg('line', { x1: xa, y1: ya, x2: xb, y2: yb, class: 'fc-dim' }));
        for (const [x, y] of [[xa, ya], [xb, yb]]) g.append(svg('line', { x1: x - 3, y1: y + 3, x2: x + 3, y2: y - 3, class: 'fc-dim' }));
        g.append(svg('text', { x: lx, y: ly, class: 'fc-dim-text', ...(vertical ? { transform: `rotate(-90 ${lx} ${ly})` } : {}) }, label));
      };
      dim(x0, yT - 14, x1, yT - 14, `${cm(sel.s1 - sel.s0)}`, (x0 + x1) / 2, yT - 19);
      dim(x1 + 14, yT, x1 + 14, yB, `${cm(sel.height)}`, x1 + 26, (yT + yB) / 2, true);
      if (sel.win && sel.sill > 0.02) dim(x0 - 14, yB, x0 - 14, Y(sel.y0 - sel.sill), `${cm(sel.sill)}`, x0 - 19, (yB + Y(sel.y0 - sel.sill)) / 2, true);
    }
    sheet.append(g);
    renderPanel(doc, facades);
  }

  function renderPanel(doc, facades) {
    panel.innerHTML = '';
    const list = order();
    const total = list.length;
    const done = list.filter((o) => seen.has(key(o))).length;
    const progress = h('div', { class: 'fc-progress' }, h('div', { class: 'fc-progress-bar' }, h('span', { style: `width:${total ? (100 * done) / total : 0}%` })), h('span', {}, `${done} av ${total} sett over`));
    const f = selected && find(doc, selected.level, selected.id);
    if (!f) {
      panel.append(h('div', { class: 'fc-panel-empty' },
        h('h3', {}, 'Gå gjennom vinduer og dører'),
        h('p', {}, 'Klikk på et vindu eller en dør på tegningen, eller gå gjennom alle én etter én. Piltastene går til forrige og neste.'),
        h('button', { class: 'pb-btn is-primary', onclick: () => list[0] && select(list[0]) }, 'Begynn med den første')), progress);
      return;
    }
    const { L, o, w } = f;
    const S = settings();
    const win = o.type === 'window';
    const idx = list.findIndex((x) => x.level === selected.level && x.id === selected.id);
    const sideName = facades.find((F) => F.openings.some((x) => x.level === selected.level && x.id === selected.id))?.name ?? '';
    panel.append(h('div', { class: 'fc-nav' },
      h('button', { class: 'fc-navbtn', title: 'Forrige (←)', onclick: () => step(-1) }, '‹'),
      h('div', { class: 'fc-nav-title' }, h('strong', {}, `${win ? 'Vindu' : 'Dør'} ${idx + 1} av ${total}`), h('span', {}, `${sideName} · ${L.name}`)),
      h('button', { class: 'fc-navbtn', title: 'Neste (→)', onclick: () => step(1) }, '›')));
    const wallLen = w ? Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) : Infinity;
    const measure = (label, value, min, max, onSet) => {
      const input = h('input', { type: 'number', min, max, step: 1, value: cm(value) });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= min && v <= max) onSet(v / 100);
        else input.value = cm(value);
      });
      return h('label', { class: 'fc-measure' }, h('span', {}, label), h('span', { class: 'fc-input' }, input, h('em', {}, 'cm')));
    };
    const setWidth = (v) =>
      v <= wallLen &&
      apply('Bredde', ({ o: x }) => {
        x.width = round(v, 3);
        x.at = round(Math.max(v / 2, Math.min(wallLen - v / 2, x.at)), 4);
        if (x.variant === 'double') x.leaf = x.leaf2 = round(v / 2, 3);
      });
    const sill = o.sill ?? S.windowSill;
    const height = o.height ?? (win ? S.windowHeight : S.doorHeight);
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Mål'),
      h('div', { class: 'fc-measures' },
        measure('Bredde', o.width, 30, Math.round(Math.min(wallLen, 8) * 100), setWidth),
        measure('Høyde', height, win ? 20 : 160, win ? 350 : 340, (v) => apply(win ? 'Vindushøyde' : 'Dørhøyde', ({ o: x }) => (x.height = round(v, 3)))),
        win ? measure('Brystning', sill, 0, 250, (v) => apply('Brystning', ({ o: x }) => (x.sill = round(v, 3)))) : null)));
    const pick = (title, options, current, onPick) =>
      h('section', { class: 'fc-section' }, h('h4', {}, title),
        h('div', { class: 'fc-picks' }, options.map(([value, label, drawFn]) => {
          const t = svg('svg', { viewBox: '0 0 56 52', width: 56, height: 52 });
          drawFn(t);
          return h('button', { class: `fc-pick${value === current ? ' is-on' : ''}`, title: label, onclick: () => onPick(value) }, t, h('span', {}, label));
        })));
    if (win) {
      const ratio = Math.min(1.6, Math.max(0.45, o.width / height));
      const tw = 20 * Math.sqrt(ratio);
      const th = 20 / Math.sqrt(ratio);
      const thumb = (fn) => (t) => fn(t, 28 - tw, 26 - th, 28 + tw, 26 + th);
      panel.append(pick('Type', WINDOW_STYLES.map(([v, label]) => [v, label.replace(' (etter bredden)', ''), thumb((t, a, b, c, d) => drawWindow(t, a, b, c, d, windowSashes(v, o.width, height, sill), null))]), o.style ?? 'auto', (v) =>
        apply('Vindustype', ({ o: x }) => (v === 'auto' ? delete x.style : (x.style = v)))));
      panel.append(pick('Sprosser', PANES.map(([v, label, p]) => [v, label, thumb((t, a, b, c, d) => drawWindow(t, a, b, c, d, [{ from: 0, to: 1, bottom: 0, top: 1 }], p))]), Array.isArray(o.panes) ? `${o.panes[0]}x${o.panes[1]}` : '0', (v) =>
        apply('Sprosser', ({ o: x }) => {
          const p = PANES.find((q) => q[0] === v)?.[2];
          if (p) x.panes = p;
          else delete x.panes;
        })));
      const like = doc.levels.flatMap((l) => l.openings.filter((x) => x !== o && x.type === 'window' && Math.abs(x.width - o.width) < 0.06));
      if (like.length)
        panel.append(h('button', { class: 'pb-btn fc-wide', onclick: () => {
          onChange('Like vinduer', () => {
            const cur = find(getDoc(), selected.level, selected.id)?.o;
            if (!cur) return;
            for (const l of getDoc().levels)
              for (const x of l.openings) {
                if (x === cur || x.type !== 'window' || Math.abs(x.width - cur.width) >= 0.06) continue;
                x.sill = cur.sill ?? S.windowSill;
                x.height = cur.height ?? S.windowHeight;
                if (cur.style) x.style = cur.style;
                else delete x.style;
                if (cur.panes) x.panes = [...cur.panes];
                else delete x.panes;
                seen.add(`${l.id}:${x.id}`);
              }
          });
          changed = true;
          render();
        } }, `Gjør de ${like.length} andre like brede vinduene slik`));
    } else {
      panel.append(pick('Type', DOOR_TYPES.map(([v, label]) => [v, label, (t) => drawDoor(t, 16, 6, 40, 48, v)]), doorType(o), (v) => apply('Dørtype', ({ o: x }) => setDoorType(x, v, S))));
      if (doorType(o) === 'patio' && o.width < 1.35) panel.append(h('p', { class: 'fc-note' }, 'En glass-skyvedør trenger minst 135 cm. Smalere blir den en skyvedør på skinne.'));
    }
    panel.append(progress);
  }

  render();
  return { el, close };
}
