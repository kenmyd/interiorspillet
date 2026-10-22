/**
 * Fasadesjekk – the house's facades drawn from the plan like a facade drawing, facade after facade (nord, øst, sør,
 * vest as tabs and «Neste fasade», a small plan that marks the side): every exterior wall seen from outside, the levels
 * stacked with their lines, the ground, the windows and doors where they are, numbered. Beside it every window and door
 * on that facade, level by level, with width, height and sill in centimetres to change right in the list, the chosen
 * one's type as pictures (a window: export.js WINDOW_STYLES and bars; a door: DOOR_TYPES), and the ticked ones changed
 * together. The changes go straight into the document (with undo); «Ferdig» rebuilds the 3D house.
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
        // flip: the facade's s runs against the wall's a → b (moving it right on the drawing lowers its at)
        F.openings.push({ level: L.id, levelName: L.name, id: o.id, win, s0: Math.min(s(pa), s(pb)), s1: Math.max(s(pa), s(pb)), y0: y0 + sill, y1: y0 + sill + height, sill, height, depth, flip: s(pa) > s(pb) });
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
 * The facade check as an overlay over the page, facade after facade: the drawing in the middle with «Neste fasade», and
 * beside it every window and door on that facade, level by level, with their measures to change right there (and the
 * ones ticked together). A click on a window or a door opens its card beside it on the drawing (measures, type, bars);
 * a drag moves it along its wall. getDoc() is the current document (undo replaces it), onChange(label, fn) runs fn on
 * it with an undo step, onDone(changed) when it is closed.
 */
export function openFacadeCheck({ getDoc, h, intro = null, onChange, onDone }) {
  let side = null; // the facade on screen
  let selected = null; // the one with its measures on the drawing: 'level:id'
  let popKey = null; // the one with its card open: 'level:id'
  let keepTop = true; // a new height keeps the top of a window where it is (the sill follows) – F115
  let changed = false;
  let drag = null; // moving a window or door along its wall
  let view = null; // the drawing on screen: { g, k, W }
  const checked = new Set(); // ticked for a change together: 'level:id'
  const visited = new Set(); // facade keys seen
  const key = (o) => `${o.level}:${o.id}`;
  const settings = () => ({ ...DEFAULT_SETTINGS, ...(getDoc().settings || {}) });
  const tabs = h('div', { class: 'fc-tabs', role: 'tablist' });
  const stage = h('div', { class: 'fc-stage' });
  const panel = h('aside', { class: 'fc-panel' });
  const pop = h('div', { class: 'fc-pop', hidden: true });
  const close = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    el.remove();
    onDone?.(changed);
  };
  const onKey = (e) => {
    const tag = e.target?.tagName;
    if (e.key === 'Escape') {
      if (popKey) {
        popKey = null;
        render();
      } else close();
    } else if (tag === 'INPUT' || tag === 'SELECT') return;
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 120);
  };
  const el = h('div', { class: 'fc' },
    h('header', { class: 'fc-head' },
      h('div', { class: 'fc-title' }, h('h2', {}, 'Fasadesjekk'), h('p', {}, intro ?? 'Huset sett utenfra, fasade for fasade. Klikk på et vindu eller en dør for å rette det, eller dra det langs veggen.')),
      tabs,
      h('div', { class: 'fc-head-actions' }, h('button', { class: 'pb-btn', onclick: () => close() }, 'Ferdig – bygg 3D-huset'))),
    h('div', { class: 'fc-body' }, stage, panel),
    pop);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.body.append(el);

  /** To the next (+1) or previous (−1) facade; past the last one closes. */
  function go(dir) {
    const keys = buildFacades(getDoc()).map((F) => F.key);
    const i = keys.indexOf(side);
    if (dir > 0 && i === keys.length - 1) return close();
    side = keys[Math.max(0, Math.min(keys.length - 1, i + dir))];
    selected = popKey = null;
    checked.clear();
    stage.scrollTop = 0;
    render();
  }
  /** Runs fn on each of the given openings (by key) in one undo step. */
  const applyTo = (keys, label, fn) => {
    onChange(label, () => {
      for (const k of keys) {
        const [level, id] = k.split(':');
        const f = find(getDoc(), level, id);
        if (f) fn(f);
      }
    });
    changed = true;
    render();
  };
  const open = (k) => {
    selected = popKey = k;
    render();
  };

  // ---- dragging a window or a door along its wall (on the stage, which stays while render() replaces the drawing)
  stage.addEventListener('pointerdown', (e) => {
    const grp = e.target.closest?.('.fc-op');
    if (!grp || !view) {
      if (popKey && view?.g.contains(e.target)) {
        popKey = null;
        render();
      }
      return;
    }
    const k = grp.getAttribute('data-key');
    const [level, id] = k.split(':');
    const f = find(getDoc(), level, id);
    if (!f?.w) return;
    const op = buildFacades(getDoc()).find((F) => F.key === side)?.openings.find((o) => key(o) === k);
    // how far it may go: the wall's ends and its neighbours on the wall, with a post of 10 cm between
    const len = Math.hypot(f.w.b[0] - f.w.a[0], f.w.b[1] - f.w.a[1]);
    const half = f.o.width / 2;
    let lo = half;
    let hi = len - half;
    for (const q of f.L.openings) {
      if (q === f.o || q.wall !== f.o.wall) continue;
      if (q.at < f.o.at) lo = Math.max(lo, q.at + q.width / 2 + 0.1 + half);
      else hi = Math.min(hi, q.at - q.width / 2 - 0.1 - half);
    }
    const scale = view.g.getBoundingClientRect().width / view.W; // screen px per drawing unit
    drag = { k, grp, x0: e.clientX, at0: f.o.at, lo, hi, flip: !!op?.flip, perM: view.k * scale, ds: 0, moved: false };
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // (a synthetic event has no pointer to capture)
    }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;
    // the facade's s runs one way or the other along the wall
    let ds = Math.round((dx / drag.perM) * 100) / 100;
    const at = drag.at0 + (drag.flip ? -ds : ds);
    const clamped = Math.max(drag.lo, Math.min(drag.hi, at));
    ds = (clamped - drag.at0) * (drag.flip ? -1 : 1);
    drag.ds = ds;
    drag.at = clamped;
    drag.grp.setAttribute('transform', `translate(${ds * view.k} 0)`);
    pop.hidden = true;
  });
  const endDrag = () => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) return open(d.k);
    if (Math.abs(d.at - d.at0) < 0.005) return render();
    selected = d.k;
    applyTo([d.k], 'Flyttet langs veggen', ({ o }) => (o.at = round(d.at, 4)));
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  function render() {
    const doc = getDoc();
    const facades = buildFacades(doc);
    if (!side || !facades.some((F) => F.key === side)) side = facades[0]?.key ?? null;
    if (side) visited.add(side);
    tabs.innerHTML = '';
    for (const F of facades) {
      const n = F.openings.length;
      const seen = visited.has(F.key) && F.key !== side;
      tabs.append(h('button', { class: `fc-tab${F.key === side ? ' is-on' : ''}`, role: 'tab', onclick: () => ((side = F.key), (selected = popKey = null), checked.clear(), render()) },
        F.name, h('span', { class: `fc-badge${seen ? ' is-done' : ''}` }, seen ? '✓' : String(n))));
    }
    const scroll = [stage.scrollTop, stage.scrollLeft];
    stage.innerHTML = '';
    const F = facades.find((x) => x.key === side);
    if (!F) {
      stage.append(h('p', { class: 'fc-empty' }, 'Fant ingen yttervegger å vise. Merk ytterveggene i «Finjuster».'));
      panel.innerHTML = '';
      pop.hidden = true;
      return;
    }
    const i = facades.indexOf(F);
    const last = i === facades.length - 1;
    const wins = F.openings.filter((o) => o.win).length;
    stage.append(h('div', { class: 'fc-sheet-head' }, drawCompass(F, facades),
      h('div', { class: 'fc-sheet-title' }, h('h3', {}, `${F.name}fasaden`), h('p', {}, `Fasade ${i + 1} av ${facades.length} · sett utenfra fra ${F.name.toLowerCase()} · ${wins} vindu${wins === 1 ? '' : 'er'}, ${F.openings.length - wins} dør${F.openings.length - wins === 1 ? '' : 'er'}`)),
      h('div', { class: 'fc-sheet-nav' },
        i > 0 ? h('button', { class: 'pb-btn', onclick: () => go(-1) }, '‹ Forrige') : null,
        h('button', { class: 'pb-btn is-primary fc-next', onclick: () => go(1) }, last ? 'Ferdig – bygg 3D-huset' : `Neste fasade: ${facades[i + 1].name} ›`))));
    const sheet = h('div', { class: 'fc-sheet' });
    stage.append(sheet);
    // the drawing, fitted to the stage
    const box = stage.getBoundingClientRect();
    const padL = 96;
    const padR = 44;
    const padT = 40;
    const padB = 26;
    const ground = -0.15;
    const yBottom = Math.min(F.yMin, ground) - 0.4;
    const availW = Math.max(380, box.width - 64) - padL - padR;
    const availH = Math.max(240, box.height - 160) - padT - padB;
    const k = Math.min(availW / Math.max(1, F.sMax - F.sMin), availH / Math.max(1, F.yMax - yBottom));
    const X = (s) => padL + (s - F.sMin) * k;
    const Y = (y) => padT + (F.yMax - y) * k;
    const W = padL + padR + (F.sMax - F.sMin) * k;
    const Hh = padT + padB + (F.yMax - yBottom) * k;
    const g = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: 'fc-svg' },
      svg('defs', {}, svg('pattern', { id: 'fc-earth', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, class: 'fc-earth-line' }))));
    for (const w of F.walls) g.append(svg('rect', { x: X(w.s0), y: Y(w.y1), width: Math.max(1, (w.s1 - w.s0) * k), height: (w.y1 - w.y0) * k, class: 'fc-wall' }));
    // the earth under the ground line over the walls, under the windows and doors (they stay clickable – F116)
    g.append(svg('rect', { x: 0, y: Y(ground), width: W, height: Hh - Y(ground), class: 'fc-earth' }), svg('line', { x1: 0, x2: W, y1: Y(ground), y2: Y(ground), class: 'fc-ground' }));
    for (const l of F.levels) {
      g.append(svg('line', { x1: padL - 10, x2: W - padR + 10, y1: Y(l.y0), y2: Y(l.y0), class: 'fc-level' }));
      g.append(svg('text', { x: 10, y: Y(l.y0) - 6, class: 'fc-level-name' }, l.name), svg('text', { x: 10, y: Y(l.y0) + 13, class: 'fc-level-h' }, mFmt(l.y0)));
    }
    const numberOf = numbering(F);
    for (const op of F.openings) {
      const f = find(doc, op.level, op.id);
      if (!f) continue;
      const x0 = X(op.s0);
      const x1 = X(op.s1);
      const yT = Y(op.y1);
      const yB = Y(op.y0);
      const k2 = key(op);
      const grp = svg('g', { class: `fc-op${selected === k2 ? ' is-selected' : ''}${checked.has(k2) ? ' is-checked' : ''}`, 'data-key': k2 });
      if (op.win) drawWindow(grp, x0, yT, x1, yB, windowSashes(f.o.style, f.o.width, op.height, op.sill), f.o.panes);
      else drawDoor(grp, x0, yT, x1, yB, doorType(f.o));
      grp.append(svg('rect', { x: x0 - 5, y: yT - 5, width: x1 - x0 + 10, height: yB - yT + 10, rx: 4, class: 'fc-hit' }));
      grp.append(svg('circle', { cx: x0, cy: yT, r: 8, class: 'fc-num' }), svg('text', { x: x0, y: yT + 3.5, class: 'fc-num-text' }, numberOf.get(k2)));
      g.append(grp);
    }
    // the chosen one's measures: its width over it, its height to the right, the sill under it
    const sel = selected && F.openings.find((o) => key(o) === selected);
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
      dim(x0, yT - 16, x1, yT - 16, `${cm(sel.s1 - sel.s0)}`, (x0 + x1) / 2, yT - 21);
      dim(x1 + 14, yT, x1 + 14, yB, `${cm(sel.height)}`, x1 + 26, (yT + yB) / 2, true);
      if (sel.win && sel.sill > 0.02) dim(x0 - 14, yB, x0 - 14, Y(sel.y0 - sel.sill), `${cm(sel.sill)}`, x0 - 19, (yB + Y(sel.y0 - sel.sill)) / 2, true);
    }
    sheet.append(g);
    view = { g, k, W };
    [stage.scrollTop, stage.scrollLeft] = scroll;
    renderPanel(doc, F, numberOf);
    renderPop(doc, F, numberOf);
  }

  /** The numbers of a facade's openings, as on the drawing and in the list: top level first, left to right. */
  function numbering(F) {
    const m = new Map();
    let n = 0;
    for (const l of F.levels) for (const o of F.openings.filter((x) => x.level === l.id).sort((a, b) => a.s0 - b.s0)) m.set(key(o), String(++n));
    return m;
  }

  // ---- the changes, for one or several
  const cmInput = (value, min, max, onSet, title) => {
    const input = h('input', { type: 'number', min, max, step: 1, value: cm(value), title });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= min && v <= max) onSet(v / 100);
      else input.value = cm(value);
    });
    return h('span', { class: 'fc-input' }, input, h('em', {}, 'cm'));
  };
  const setWidth = (v) => ({ o: x, w }) => {
    const wallLen = w ? Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) : Infinity;
    if (v > wallLen) return;
    x.width = round(v, 3);
    x.at = round(Math.max(v / 2, Math.min(wallLen - v / 2, x.at)), 4);
    if (x.variant === 'double') x.leaf = x.leaf2 = round(v / 2, 3);
  };
  // a window's new height keeps its top (the sill moves) while «Hold overkanten» is on
  const setHeight = (v) => ({ o: x }) => {
    const S = settings();
    if (x.type === 'window' && keepTop) {
      const top = (x.sill ?? S.windowSill) + (x.height ?? S.windowHeight);
      x.sill = round(Math.max(0, top - v), 3);
    }
    x.height = round(v, 3);
  };
  const setStyle = (v) => ({ o: x }) => (v === 'auto' ? delete x.style : (x.style = v));
  const setPanes = (v) => ({ o: x }) => {
    const p = PANES.find((q) => q[0] === v)?.[2];
    if (p) x.panes = [...p];
    else delete x.panes;
  };

  function renderPanel(doc, F, numberOf) {
    const scroll = panel.scrollTop;
    panel.innerHTML = '';
    const S = settings();
    panel.append(h('div', { class: 'fc-panel-head' }, h('h3', {}, `${F.name}fasaden`), h('p', {}, 'Rett målene rett i lista, eller klikk på et vindu på tegningen. Kryss av flere for å endre dem samtidig.')));
    // the ticked ones together
    const ticked = [...checked].filter((k) => F.openings.some((o) => key(o) === k));
    if (ticked.length >= 2) {
      const tw = ticked.map((k) => F.openings.find((o) => key(o) === k));
      const allWin = tw.every((o) => o.win);
      const allDoor = tw.every((o) => !o.win);
      panel.append(h('div', { class: 'fc-bulk' },
        h('div', { class: 'fc-bulk-head' }, h('strong', {}, `${ticked.length} valgt`), h('button', { class: 'fc-link', onclick: () => (checked.clear(), render()) }, 'Fjern valget')),
        h('div', { class: 'fc-row-fields' },
          h('label', {}, h('span', {}, 'Bredde'), cmInput(tw[0].s1 - tw[0].s0, 30, 800, (v) => applyTo(ticked, 'Bredde', setWidth(v)))),
          h('label', {}, h('span', {}, 'Høyde'), cmInput(tw[0].height, 20, 350, (v) => applyTo(ticked, 'Høyde', setHeight(v)))),
          allWin ? h('label', {}, h('span', {}, 'Brystning'), cmInput(tw[0].sill, 0, 250, (v) => applyTo(ticked, 'Brystning', ({ o: x }) => (x.sill = round(v, 3))))) : null),
        allWin ? h('div', { class: 'fc-row-fields' },
          h('label', {}, h('span', {}, 'Type'), h('select', { onchange: (e) => applyTo(ticked, 'Vindustype', setStyle(e.target.value)) }, h('option', { value: '' }, '–'), WINDOW_STYLES.map(([v, t]) => h('option', { value: v }, t)))),
          h('label', {}, h('span', {}, 'Sprosser'), h('select', { onchange: (e) => applyTo(ticked, 'Sprosser', setPanes(e.target.value)) }, h('option', { value: '' }, '–'), PANES.map(([v, t]) => h('option', { value: v }, t))))) : null,
        allDoor ? h('div', { class: 'fc-row-fields' },
          h('label', {}, h('span', {}, 'Type'), h('select', { onchange: (e) => applyTo(ticked, 'Dørtype', ({ o: x }) => setDoorType(x, e.target.value, S)) }, h('option', { value: '' }, '–'), DOOR_TYPES.map(([v, t]) => h('option', { value: v }, t))))) : null));
    }
    for (const l of F.levels) {
      const ops = F.openings.filter((o) => o.level === l.id).sort((a, b) => a.s0 - b.s0);
      if (!ops.length) continue;
      const allKeys = ops.map(key);
      const allTicked = allKeys.every((k) => checked.has(k));
      panel.append(h('div', { class: 'fc-level-head' }, h('h4', {}, l.name),
        h('button', { class: 'fc-link', onclick: () => (allKeys.forEach((k) => (allTicked ? checked.delete(k) : checked.add(k))), render()) }, allTicked ? 'Fjern alle' : 'Velg alle')));
      for (const op of ops) {
        const f = find(doc, op.level, op.id);
        if (!f) continue;
        const { o } = f;
        const k = key(op);
        const glyph = svg('svg', { viewBox: '0 0 40 40', width: 36, height: 36, class: 'fc-glyph' });
        const ratio = Math.min(1.8, Math.max(0.4, (op.s1 - op.s0) / op.height));
        const gw = 15 * Math.sqrt(ratio);
        const gh = 15 / Math.sqrt(ratio);
        if (op.win) drawWindow(glyph, 20 - gw, 20 - gh, 20 + gw, 20 + gh, windowSashes(o.style, o.width, op.height, op.sill), o.panes);
        else drawDoor(glyph, 12, 3, 28, 37, doorType(o));
        const tick = h('input', { type: 'checkbox', checked: checked.has(k), title: 'Endre sammen med andre', onchange: (e) => (e.target.checked ? checked.add(k) : checked.delete(k), render()) });
        panel.append(h('div', { class: `fc-row${selected === k ? ' is-selected' : ''}`, onclick: (e) => !e.target.closest('input, select, button') && open(k) },
          h('div', { class: 'fc-row-top' }, tick, h('span', { class: 'fc-row-num' }, numberOf.get(k)), glyph,
            h('div', { class: 'fc-row-name' }, h('strong', {}, op.win ? 'Vindu' : 'Dør'), h('span', {}, op.win ? WINDOW_STYLES.find((x) => x[0] === (o.style ?? 'auto'))[1].replace(' (etter bredden)', '') : DOOR_TYPES.find((x) => x[0] === doorType(o))[1]))),
          h('div', { class: 'fc-row-fields' },
            h('label', {}, h('span', {}, 'Bredde'), cmInput(o.width, 30, 800, (v) => applyTo([k], 'Bredde', setWidth(v)))),
            h('label', {}, h('span', {}, 'Høyde'), cmInput(op.height, op.win ? 20 : 160, op.win ? 350 : 340, (v) => applyTo([k], op.win ? 'Vindushøyde' : 'Dørhøyde', setHeight(v)))),
            op.win ? h('label', {}, h('span', {}, 'Brystning'), cmInput(op.sill, 0, 250, (v) => applyTo([k], 'Brystning', ({ o: x }) => (x.sill = round(v, 3))))) : h('span'))));
      }
    }
    if (!F.openings.length) panel.append(h('p', { class: 'fc-note' }, 'Ingen vinduer eller dører på denne fasaden.'));
    panel.scrollTop = scroll;
  }

  /** The card of the clicked window or door, beside it on the drawing. */
  function renderPop(doc, F, numberOf) {
    const op = popKey && F.openings.find((o) => key(o) === popKey);
    const f = op && find(doc, op.level, op.id);
    const grp = op && view?.g.querySelector(`[data-key="${CSS.escape(popKey)}"]`);
    if (!f || !grp) {
      pop.hidden = true;
      return;
    }
    const { o } = f;
    const S = settings();
    const k = popKey;
    pop.innerHTML = '';
    const pick = (options, current, onPick) =>
      h('div', { class: 'fc-picks' }, options.map(([value, label, drawFn]) => {
        const t = svg('svg', { viewBox: '0 0 56 52', width: 46, height: 42 });
        drawFn(t);
        return h('button', { class: `fc-pick${value === current ? ' is-on' : ''}`, title: label, onclick: () => onPick(value) }, t, h('span', {}, label));
      }));
    const ratio = Math.min(1.6, Math.max(0.45, o.width / op.height));
    const tw = 20 * Math.sqrt(ratio);
    const th = 20 / Math.sqrt(ratio);
    const thumb = (fn) => (t) => fn(t, 28 - tw, 26 - th, 28 + tw, 26 + th);
    pop.append(h('div', { class: 'fc-pop-head' }, h('span', { class: 'fc-row-num' }, numberOf.get(k)),
      h('div', {}, h('strong', {}, op.win ? 'Vindu' : 'Dør'), h('span', {}, op.levelName)),
      h('button', { class: 'fc-pop-close', title: 'Lukk (Esc)', onclick: () => ((popKey = null), render()) }, '×')));
    pop.append(h('div', { class: 'fc-row-fields' },
      h('label', {}, h('span', {}, 'Bredde'), cmInput(o.width, 30, 800, (v) => applyTo([k], 'Bredde', setWidth(v)))),
      h('label', {}, h('span', {}, 'Høyde'), cmInput(op.height, op.win ? 20 : 160, op.win ? 350 : 340, (v) => applyTo([k], op.win ? 'Vindushøyde' : 'Dørhøyde', setHeight(v)))),
      op.win ? h('label', {}, h('span', {}, 'Brystning'), cmInput(op.sill, 0, 250, (v) => applyTo([k], 'Brystning', ({ o: x }) => (x.sill = round(v, 3))))) : h('span')));
    if (op.win) {
      const top = op.sill + op.height;
      const same = doc.levels.find((l) => l.id === op.level)?.openings.filter((x) => x !== o && x.type === 'window') ?? [];
      pop.append(
        h('label', { class: 'fc-check-line' }, h('input', { type: 'checkbox', checked: keepTop, onchange: (e) => ((keepTop = e.target.checked), render()) }), `Hold overkanten fast (${cm(top)} cm over gulvet) når høyden endres`),
        same.length ? h('button', { class: 'pb-btn is-small fc-align', onclick: () =>
          applyTo(same.map((x) => `${op.level}:${x.id}`), 'Lik overkant', ({ o: x }) => {
            x.sill = round(Math.max(0, top - (x.height ?? S.windowHeight)), 3);
          }) }, `Samme overkant på de ${same.length} andre vinduene i ${op.levelName.toLowerCase()}`) : null,
        h('h5', {}, 'Type'),
        pick(WINDOW_STYLES.map(([v, label]) => [v, label.replace(' (etter bredden)', ''), thumb((t, a, b, c, d) => drawWindow(t, a, b, c, d, windowSashes(v, o.width, op.height, op.sill), null))]), o.style ?? 'auto', (v) => applyTo([k], 'Vindustype', setStyle(v))),
        h('h5', {}, 'Sprosser'),
        pick(PANES.map(([v, label, p]) => [v, label, thumb((t, a, b, c, d) => drawWindow(t, a, b, c, d, [{ from: 0, to: 1, bottom: 0, top: 1 }], p))]), Array.isArray(o.panes) ? `${o.panes[0]}x${o.panes[1]}` : '0', (v) => applyTo([k], 'Sprosser', setPanes(v))));
    } else {
      pop.append(h('h5', {}, 'Type'),
        pick(DOOR_TYPES.map(([v, label]) => [v, label, (t) => drawDoor(t, 16, 6, 40, 48, v)]), doorType(o), (v) => applyTo([k], 'Dørtype', ({ o: x }) => setDoorType(x, v, S))),
        doorType(o) === 'patio' && o.width < 1.35 ? h('p', { class: 'fc-note' }, 'En glass-skyvedør trenger minst 135 cm. Smalere blir den en skyvedør på skinne.') : null);
    }
    pop.append(h('p', { class: 'fc-note' }, 'Dra vinduet eller døra på tegningen for å flytte den langs veggen.'));
    // beside it: to the right, or to the left when there is no room, within the window
    pop.hidden = false;
    const r = grp.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = r.right + 14 + pw < window.innerWidth - 8 ? r.right + 14 : Math.max(8, r.left - 14 - pw);
    const top = Math.max(70, Math.min(window.innerHeight - ph - 10, r.top + r.height / 2 - ph / 2));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  render();
  return { el, close };
}
