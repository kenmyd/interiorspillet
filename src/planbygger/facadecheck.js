/**
 * Fasadesjekk – the house's facades side by side, drawn from the plan: every exterior wall seen from outside on its
 * side of the house (nord, øst, sør, vest), the levels stacked, the windows and doors where they are. Click one to change
 * its width, sill, height and type (a window: export.js WINDOW_STYLES and bars; a door: DOOR_TYPES). The changes go
 * straight into the document (with undo); «Ferdig» rebuilds the 3D house.
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
      F.walls.push({ level: L.id, id: w.id, s0: Math.min(s(w.a), s(w.b)), s1: Math.max(s(w.a), s(w.b)), y0, y1, depth });
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

const num = (s) => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const fmt = (v) => (Number.isFinite(v) ? round(v, 2).toFixed(2).replace('.', ',') : '');

/**
 * The facade check as an overlay over the page. getDoc() is the current document (undo replaces it), onChange(label,
 * fn) runs fn on it with an undo step, onDone(changed) when it is closed.
 */
export function openFacadeCheck({ getDoc, h, intro = null, onChange, onDone }) {
  let selected = null; // { level, id }
  let changed = false;
  const settings = () => ({ ...DEFAULT_SETTINGS, ...(getDoc().settings || {}) });
  const sheets = h('div', { class: 'pb-fc-sheets' });
  const panel = h('div', { class: 'pb-fc-panel' });
  const close = () => {
    window.removeEventListener('keydown', onKey);
    el.remove();
    onDone?.(changed);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const el = h('div', { class: 'pb-fc' },
    h('div', { class: 'pb-fc-head' },
      h('div', {}, h('h2', {}, 'Fasadesjekk'), h('p', { class: 'pb-note' }, intro ?? 'Huset sett utenfra, side for side. Klikk på et vindu eller en dør for å endre høyde, bredde og type.')),
      h('button', { class: 'pb-btn is-primary', onclick: () => close() }, 'Ferdig – bygg 3D-huset')),
    h('div', { class: 'pb-fc-body' }, sheets, panel));
  window.addEventListener('keydown', onKey);
  document.body.append(el);

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
    sheets.innerHTML = '';
    if (!facades.length) sheets.append(h('p', { class: 'pb-note' }, 'Fant ingen yttervegger å vise. Merk ytterveggene i «Finjuster».'));
    const width = Math.max(420, sheets.clientWidth - 24 || 760);
    for (const F of facades) {
      const pad = 14;
      const k = Math.min((width - 2 * pad) / Math.max(1, F.sMax - F.sMin), 300 / Math.max(1, F.yMax - F.yMin));
      const X = (s) => pad + (s - F.sMin) * k;
      const Y = (y) => pad + (F.yMax - y) * k;
      const W = 2 * pad + (F.sMax - F.sMin) * k;
      const Hh = 2 * pad + (F.yMax - F.yMin) * k;
      const g = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: 'pb-fc-svg' });
      g.append(svg('line', { x1: 0, x2: W, y1: Y(0) + 0.5, y2: Y(0) + 0.5, class: 'pb-fc-ground' }));
      for (const w of F.walls) g.append(svg('rect', { x: X(w.s0), y: Y(w.y1), width: Math.max(1, (w.s1 - w.s0) * k), height: (w.y1 - w.y0) * k, class: 'pb-fc-wall' }));
      for (const op of F.openings) {
        const f = find(doc, op.level, op.id);
        if (!f) continue;
        const x0 = X(op.s0);
        const x1 = X(op.s1);
        const yT = Y(op.y1);
        const yB = Y(op.y0);
        const isSel = selected && selected.level === op.level && selected.id === op.id;
        const grp = svg('g', { class: `pb-fc-op ${op.win ? 'is-window' : 'is-door'}${isSel ? ' is-selected' : ''}`, 'data-id': op.id });
        grp.append(svg('rect', { x: x0, y: yT, width: x1 - x0, height: yB - yT, class: 'pb-fc-hole' }));
        if (op.win) {
          // the sashes as seen from outside: the room's left is the facade's right
          const sashes = windowSashes(f.o.style, f.o.width, op.height, op.sill);
          for (const sa of sashes) {
            const sx0 = x0 + (1 - sa.to) * (x1 - x0);
            const sx1 = x0 + (1 - sa.from) * (x1 - x0);
            const sy0 = yB - sa.bottom * (yB - yT);
            const sy1 = yB - sa.top * (yB - yT);
            grp.append(svg('rect', { x: sx0 + 1.5, y: sy1 + 1.5, width: Math.max(1, sx1 - sx0 - 3), height: Math.max(1, sy0 - sy1 - 3), class: sa.opening ? 'pb-fc-sash is-opening' : 'pb-fc-sash' }));
            const panes = f.o.panes;
            if (Array.isArray(panes)) {
              for (let i = 1; i < panes[0]; i++) {
                const x = sx0 + ((sx1 - sx0) * i) / panes[0];
                grp.append(svg('line', { x1: x, x2: x, y1: sy1 + 2, y2: sy0 - 2, class: 'pb-fc-bar' }));
              }
              for (let i = 1; i < panes[1]; i++) {
                const y = sy1 + ((sy0 - sy1) * i) / panes[1];
                grp.append(svg('line', { x1: sx0 + 2, x2: sx1 - 2, y1: y, y2: y, class: 'pb-fc-bar' }));
              }
            }
          }
        } else {
          const type = doorType(f.o);
          const mid = (x0 + x1) / 2;
          if (type === 'double' || type === 'patio') grp.append(svg('line', { x1: mid, x2: mid, y1: yT, y2: yB, class: 'pb-fc-bar' }));
          if (type === 'folding') for (let i = 1; i < 4; i++) grp.append(svg('line', { x1: x0 + ((x1 - x0) * i) / 4, x2: x0 + ((x1 - x0) * i) / 4, y1: yT, y2: yB, class: 'pb-fc-bar' }));
          if (type === 'glass' || type === 'patio') grp.append(svg('rect', { x: x0 + (x1 - x0) * 0.18, y: yT + (yB - yT) * 0.1, width: (x1 - x0) * 0.64, height: (yB - yT) * 0.62, class: 'pb-fc-sash' }));
          if (type.startsWith('sliding')) grp.append(svg('path', { d: `M${mid - 8} ${(yT + yB) / 2}h16m-4 -4l4 4l-4 4`, class: 'pb-fc-bar' }));
        }
        grp.addEventListener('click', () => {
          selected = { level: op.level, id: op.id };
          render();
        });
        g.append(grp);
      }
      const count = F.openings.filter((o) => o.win).length;
      sheets.append(h('div', { class: 'pb-fc-sheet' }, h('h3', {}, `${F.name}`, h('span', { class: 'pb-note' }, ` · ${count} vindu${count === 1 ? '' : 'er'}, ${F.openings.length - count} dør${F.openings.length - count === 1 ? '' : 'er'}`)), g));
    }
    renderPanel(doc);
  }

  function renderPanel(doc) {
    panel.innerHTML = '';
    const f = selected && find(doc, selected.level, selected.id);
    if (!f) {
      panel.append(h('p', { class: 'pb-note' }, 'Klikk på et vindu eller en dør på fasadene.'), h('p', { class: 'pb-note' }, 'Tallene er i meter. Brystning er høyden fra gulvet til underkanten av vinduet.'));
      return;
    }
    const { L, o, w } = f;
    const S = settings();
    const field = (label, value, onSet) => {
      const input = h('input', { type: 'text', inputmode: 'decimal', value: fmt(value) });
      input.addEventListener('change', () => {
        const v = num(input.value);
        if (v != null) onSet(v);
      });
      return h('div', { class: 'pb-field' }, h('label', {}, label), h('span', {}, input, h('span', { class: 'pb-unit' }, 'm')));
    };
    const select = (label, options, value, onSet) =>
      h('div', { class: 'pb-field' }, h('label', {}, label), h('select', { onchange: (e) => onSet(e.target.value) }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
    const wallLen = w ? Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) : Infinity;
    const setWidth = (v) =>
      v >= 0.3 && v <= wallLen &&
      apply('Bredde', ({ o: x }) => {
        x.width = round(v, 3);
        x.at = round(Math.max(v / 2, Math.min(wallLen - v / 2, x.at)), 4);
        if (x.variant === 'double') x.leaf = x.leaf2 = round(v / 2, 3);
      });
    const win = o.type === 'window';
    panel.append(h('h3', {}, win ? 'Vindu' : 'Dør', h('span', { class: 'pb-note' }, ` · ${L.name}`)));
    panel.append(field('Bredde', o.width, setWidth));
    if (win) {
      panel.append(
        field('Brystning', o.sill ?? S.windowSill, (v) => v >= 0 && v < 3 && apply('Brystning', ({ o: x }) => (x.sill = round(v, 3)))),
        field('Høyde', o.height ?? S.windowHeight, (v) => v >= 0.2 && v < 4 && apply('Vindushøyde', ({ o: x }) => (x.height = round(v, 3)))),
        select('Type', WINDOW_STYLES, o.style ?? 'auto', (v) => apply('Vindustype', ({ o: x }) => (v === 'auto' ? delete x.style : (x.style = v)))),
        select('Sprosser', PANES.map(([v, t]) => [v, t]), Array.isArray(o.panes) ? `${o.panes[0]}x${o.panes[1]}` : '0', (v) =>
          apply('Sprosser', ({ o: x }) => {
            const p = PANES.find((q) => q[0] === v)?.[2];
            if (p) x.panes = p;
            else delete x.panes;
          })),
      );
      // the same window is often repeated: one click sets all windows of about the same width alike
      const like = doc.levels.flatMap((l) => l.openings.filter((x) => x !== o && x.type === 'window' && Math.abs(x.width - o.width) < 0.06));
      if (like.length)
        panel.append(h('button', { class: 'pb-btn is-small', onclick: () => {
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
              }
          });
          changed = true;
          render();
        } }, `Gjør ${like.length} like brede vinduer slik`));
    } else {
      panel.append(
        field('Høyde', o.height ?? S.doorHeight, (v) => v >= 1.6 && v < 3.5 && apply('Dørhøyde', ({ o: x }) => (x.height = round(v, 3)))),
        select('Type', DOOR_TYPES, doorType(o), (v) => apply('Dørtype', ({ o: x }) => setDoorType(x, v, S))),
      );
      if (doorType(o) === 'patio' && o.width < 1.35) panel.append(h('p', { class: 'pb-note' }, 'En glass-skyvedør trenger minst 1,35 m. Smalere blir den en skyvedør på skinne.'));
    }
  }

  render();
  return { el, close };
}
