/**
 * Plasser trapp – the plan of a level with the level under it faintly beneath, where the customer drags the stair down
 * to it into place: drag on the plan to draw one (from its top end), drag it to move, drag a corner to size it, and set
 * its type and direction beside. The changes go into the document (with undo); «Ferdig» rebuilds the 3D house.
 *
 * For a stair the plan draws in the wrong place or not at all (the owner's own house, F109, F113: the stair was drawn
 * outside the building, so no stair was made and the basement could not be reached).
 *
 *   openStairPlacer({ getDoc, h, intro, onChange(label, fn), onDone(changed) }) → { el, close }
 */
import { addStair, deleteStair, stairGeometry } from './model.js';
// (the stair kinds: none = straight, 'u' half-turn, 'l' quarter-turn – the whole L in the rectangle –, 'steep')
import { round } from './geom.js';

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
const cm = (m) => Math.round(m * 100);
const snap = (v) => Math.round(v / 0.05) * 0.05;
const RISE = 0.18; // a riser as the export counts them (export.js exportStairs)

/** The level under a level (the stair goes down to it), or null. */
export function levelBelow(doc, L) {
  return doc.levels.filter((l) => (l.floorY ?? 0) < (L.floorY ?? 0) - 0.5).sort((a, b) => b.floorY - a.floorY)[0] ?? null;
}

/** The width of an L stair's flights (export.js: st.flight, or half the short side within 0.7–1.0 m). */
export function lFlight(st) {
  const geo = stairGeometry(st);
  return st.flight ?? Math.max(0.7, Math.min(1.0, Math.min(geo.length, geo.width) * 0.5));
}

/** Steps and steepness of a stair in its rectangle: risers, the going of a tread and the angle in degrees. */
export function stairPitch(st, rise) {
  const geo = stairGeometry(st);
  const risers = Math.max(2, Math.round(rise / RISE));
  const r = rise / risers;
  // a U stair walks down one half, round the far end and back: about two lengths less the turn; an L down one long side,
  // round the corner and along the far end (export.js: flights of lFlight)
  const w = lFlight(st);
  const run = st.kind === 'u' ? Math.max(0.5, 2 * geo.length - geo.width / 2) : st.kind === 'l' ? geo.length - w + (Math.PI / 4) * w + geo.width - w : geo.length;
  const going = run / Math.max(1, risers - 1);
  return { risers, riser: r, going, angle: (Math.atan2(r, going) * 180) / Math.PI };
}

/**
 * The stair placer as an overlay over the page. getDoc() is the current document (undo replaces it), onChange(label,
 * fn) runs fn on it with an undo step, onDone(changed) when it is closed.
 */
export function openStairPlacer({ getDoc, h, intro = null, onChange, onDone }) {
  const uppers = () => getDoc().levels.filter((l) => levelBelow(getDoc(), l));
  let levelId = (uppers().find((l) => (l.stairs || []).length) ?? uppers()[0])?.id ?? null;
  let selected = null; // a stair id
  let changed = false;
  let drag = null; // { mode: 'new' | 'move' | 'corner', ... , rect }
  let view = null; // the drawing on screen: { g, k, minX, minY, X, Y }
  const tabs = h('div', { class: 'fc-tabs', role: 'tablist' });
  const stage = h('div', { class: 'fc-stage' });
  const panel = h('aside', { class: 'fc-panel' });
  const close = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    el.remove();
    onDone?.(changed);
  };
  const onKey = (e) => {
    const tag = e.target?.tagName;
    if (e.key === 'Escape') close();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && tag !== 'INPUT') remove();
  };
  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 120);
  };
  const el = h('div', { class: 'fc' },
    h('header', { class: 'fc-head' },
      h('div', { class: 'fc-title' }, h('h2', {}, 'Plasser trapp'), h('p', {}, intro ?? 'Dra på planen der trappa står, fra toppen og nedover. Etasjen under ses svakt under.')),
      tabs,
      h('div', { class: 'fc-head-actions' }, h('button', { class: 'pb-btn is-primary', onclick: () => close() }, 'Ferdig – bygg 3D-huset'))),
    h('div', { class: 'fc-body' }, stage, panel));
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.body.append(el);

  // dragging: on the stage, which stays while render() replaces the drawing
  const toPlan = (e) => {
    const p = view.g.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(view.g.getScreenCTM().inverse());
    return [q.x / view.k + view.minX, q.y / view.k + view.minY];
  };
  stage.addEventListener('pointerdown', (e) => {
    const L = level();
    if (!view || !L || !view.g.contains(e.target)) return;
    const p = toPlan(e);
    const sel = selected && stairOf(selected);
    // a corner of the chosen stair: its opposite corner stays
    const corner = sel && [[0, 0], [1, 0], [1, 1], [0, 1]].find(([i, j]) => Math.hypot(view.X(sel.rect[i][0]) - view.X(p[0]), view.Y(sel.rect[j][1]) - view.Y(p[1])) < 10);
    const hit = [...(L.stairs || [])].reverse().find((st) => p[0] >= st.rect[0][0] && p[0] <= st.rect[1][0] && p[1] >= st.rect[0][1] && p[1] <= st.rect[1][1]);
    if (corner) drag = { mode: 'corner', id: sel.id, anchor: [sel.rect[1 - corner[0]][0], sel.rect[1 - corner[1]][1]], rect: sel.rect, axis: sel.axis };
    else if (hit) {
      selected = hit.id;
      drag = { mode: 'move', id: hit.id, rect: hit.rect, orig: hit.rect, axis: hit.axis };
    } else {
      selected = null;
      drag = { mode: 'new', a: [snap(p[0]), snap(p[1])], rect: null };
    }
    drag.from = p;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // (a synthetic event has no pointer to capture)
    }
    e.preventDefault();
    render();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !view) return;
    const p = toPlan(e);
    if (drag.mode === 'new') {
      const b = [snap(p[0]), snap(p[1])];
      const a = drag.a;
      drag.rect = [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]];
      drag.axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'x' : 'y';
      drag.down = (drag.axis === 'x' ? b[0] - a[0] : b[1] - a[1]) >= 0 ? 1 : -1;
      drag.b = b;
    } else if (drag.mode === 'move') {
      const dx = snap(p[0] - drag.from[0]);
      const dy = snap(p[1] - drag.from[1]);
      drag.rect = drag.orig.map(([x, y]) => [round(x + dx, 4), round(y + dy, 4)]);
    } else {
      const b = [snap(p[0]), snap(p[1])];
      const a = drag.anchor;
      drag.rect = [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]];
      drag.axis = drag.rect[1][0] - drag.rect[0][0] >= drag.rect[1][1] - drag.rect[0][1] ? 'x' : 'y';
    }
    render();
  });
  const endDrag = () => {
    const d = drag;
    drag = null;
    if (!d) return;
    const big = (r) => r && r[1][0] - r[0][0] >= 0.6 && r[1][1] - r[0][1] >= 0.6;
    if (d.mode === 'new') {
      if (big(d.rect)) edit('Ny trapp', (Lv) => (selected = addStair(Lv, d.a, d.b).id));
      else render();
    } else if (big(d.rect) && JSON.stringify(d.rect) !== JSON.stringify(stairOf(d.id)?.rect)) {
      edit(d.mode === 'move' ? 'Flyttet trapp' : 'Endret trapp', () => {
        const st = stairOf(d.id);
        if (!st) return;
        st.rect = d.rect;
        if (d.axis && d.axis !== st.axis) st.axis = d.axis;
      });
    } else render();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  const level = () => getDoc().levels.find((l) => l.id === levelId) ?? null;
  const stairOf = (id) => (level()?.stairs || []).find((s) => s.id === id) ?? null;
  const edit = (label, fn) => {
    onChange(label, () => {
      const L = level();
      if (L) fn(L);
    });
    changed = true;
    render();
  };
  const remove = () =>
    edit('Slettet trapp', (L) => {
      deleteStair(L, selected);
      selected = null;
    });

  function render() {
    const doc = getDoc();
    tabs.innerHTML = '';
    for (const L of uppers()) {
      const below = levelBelow(doc, L);
      tabs.append(h('button', { class: `fc-tab${L.id === levelId ? ' is-on' : ''}`, onclick: () => ((levelId = L.id), (selected = null), render()) }, `${L.name} → ${below.name}`,
        h('span', { class: `fc-badge${(L.stairs || []).length ? ' is-done' : ''}` }, (L.stairs || []).length ? 'trapp' : 'ingen')));
    }
    stage.innerHTML = '';
    const L = level();
    if (!L) {
      stage.append(h('p', { class: 'fc-empty' }, 'Huset har bare én etasje – ingen trapp å plassere.'));
      renderPanel(null);
      return;
    }
    const below = levelBelow(doc, L);
    // the level under in this level's plan frame (the levels are aligned by their offsets, export.js houseFrame)
    const shift = [(below.offset?.[0] ?? 0) - (L.offset?.[0] ?? 0), (below.offset?.[1] ?? 0) - (L.offset?.[1] ?? 0)];
    const lowWalls = below.walls.map((w) => ({ ...w, a: [w.a[0] + shift[0], w.a[1] + shift[1]], b: [w.b[0] + shift[0], w.b[1] + shift[1]] }));
    const pts = [...L.walls, ...lowWalls].flatMap((w) => [w.a, w.b]);
    if (!pts.length) {
      stage.append(h('p', { class: 'fc-empty' }, 'Etasjen har ingen vegger ennå.'));
      renderPanel(null);
      return;
    }
    const minX = Math.min(...pts.map((p) => p[0])) - 0.6;
    const minY = Math.min(...pts.map((p) => p[1])) - 0.6;
    const maxX = Math.max(...pts.map((p) => p[0])) + 0.6;
    const maxY = Math.max(...pts.map((p) => p[1])) + 0.6;
    const box = stage.getBoundingClientRect();
    const k = Math.min((Math.max(380, box.width - 60)) / (maxX - minX), (Math.max(300, box.height - 60)) / (maxY - minY));
    const X = (x) => (x - minX) * k;
    const Y = (y) => (y - minY) * k;
    const W = (maxX - minX) * k;
    const Hh = (maxY - minY) * k;
    const g = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: 'fc-svg sp-svg' });
    g.append(svg('rect', { x: 0, y: 0, width: W, height: Hh, class: 'sp-paper' }));
    for (const w of lowWalls) g.append(svg('line', { x1: X(w.a[0]), y1: Y(w.a[1]), x2: X(w.b[0]), y2: Y(w.b[1]), class: 'sp-wall-below', 'stroke-width': Math.max(1, (w.t ?? 0.1) * k) }));
    for (const w of L.walls) g.append(svg('line', { x1: X(w.a[0]), y1: Y(w.a[1]), x2: X(w.b[0]), y2: Y(w.b[1]), class: 'sp-wall', 'stroke-width': Math.max(1.5, (w.t ?? 0.1) * k) }));
    for (const r of L.rooms || []) if (r.seed && r.name) g.append(svg('text', { x: X(r.seed[0]), y: Y(r.seed[1]), class: 'sp-room' }, r.name));
    for (const r of below.rooms || []) if (r.seed && r.name) g.append(svg('text', { x: X(r.seed[0] + shift[0]), y: Y(r.seed[1] + shift[1]) + 14, class: 'sp-room-below' }, r.name));
    // the stairs (the one being dragged as it is now)
    const shown = (L.stairs || []).map((s) => (drag && drag.id === s.id ? { ...s, rect: drag.rect, axis: drag.axis ?? s.axis } : s));
    if (drag?.mode === 'new' && drag.rect) shown.push({ id: '_ny', rect: drag.rect, axis: drag.axis, down: drag.down });
    for (const st of shown) drawStair(g, st, X, Y, k, st.id === selected || st.id === '_ny');
    // corner handles of the chosen one
    const sel = shown.find((s) => s.id === selected);
    if (sel) {
      const [[x0, y0], [x1, y1]] = sel.rect;
      for (const [cx, cy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) g.append(svg('circle', { cx: X(cx), cy: Y(cy), r: 6, class: 'sp-handle' }));
    }
    view = { g, k, minX, minY, X, Y };
    stage.append(h('div', { class: 'fc-sheet' }, g));
    renderPanel(L, below);
  }

  function renderPanel(L, below) {
    panel.innerHTML = '';
    const st = L && selected ? stairOf(selected) : null;
    if (!L) return;
    if (!st) {
      const n = (L.stairs || []).length;
      panel.append(h('div', { class: 'fc-panel-empty' },
        h('h3', {}, n ? 'Velg trappa' : 'Tegn trappa'),
        h('p', {}, n ? 'Klikk på trappa for å endre den, eller dra en ny på planen.' : `Dra på planen der trappa står: start i toppen (ved ${L.name.toLowerCase()}) og dra mot foten. Bredden er den korte siden.`),
        h('p', {}, `De svake strekene er ${below.name.toLowerCase()} – trappa må lande der.`)),
        ...(n ? [h('button', { class: 'pb-btn', onclick: () => ((selected = L.stairs[0].id), render()) }, 'Velg trappa')] : []));
      return;
    }
    const geo = stairGeometry(st);
    const rise = (L.floorY ?? 0) - (below.floorY ?? 0);
    const p = stairPitch(st, rise);
    panel.append(h('div', { class: 'fc-nav' }, h('div', { class: 'fc-nav-title' }, h('strong', {}, 'Trapp'), h('span', {}, `${L.name} → ${below.name}`))));
    // the type as pictures
    const pick = (value, label) => {
      const t = svg('svg', { viewBox: '0 0 56 52', width: 56, height: 52 });
      const box = value === 'l' ? [[0, 0], [1.6, 1.4]] : [[0, 0], [2, 1]];
      drawStair(t, { rect: box, axis: 'x', down: 1, kind: value === 'straight' ? undefined : value }, (x) => 6 + x * 22, (y) => (value === 'l' ? 10 : 15) + y * 22, 22, false);
      return h('button', { class: `fc-pick${(st.kind ?? 'straight') === value ? ' is-on' : ''}`, onclick: () => edit('Trappetype', () => {
        const s = stairOf(st.id);
        if (value === 'straight') delete s.kind;
        else s.kind = value;
      }) }, t, h('span', {}, label));
    };
    panel.append(...[h('section', { class: 'fc-section' }, h('h4', {}, 'Type'), h('div', { class: 'fc-picks sp-picks' }, pick('straight', 'Rett'), pick('u', 'Halvsvingt (U)'), pick('l', 'Kvartsvingt (L)'), pick('steep', 'Bratt / loftstige'))),
      st.kind === 'l' ? h('p', { class: 'fc-note' }, 'Dra rektangelet rundt hele L-en. Det øverste løpet går ned langs den ene langsiden, svinger i hjørnet og går ut langs enden. «Speilvend» bytter side.') : null,
      st.kind === 'steep' ? h('p', { class: 'fc-note' }, 'En bratt trapp eller loftstige for en liten sjakt. Figuren klatrer opp til ca. 66°.') : null].filter(Boolean));
    // direction
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Retning'),
      h('div', { class: 'sp-row' },
        h('button', { class: 'pb-btn', onclick: () => edit('Snudde trappa', () => (stairOf(st.id).down = -stairOf(st.id).down)) }, 'Snu – toppen i andre enden'),
        st.kind === 'u' || st.kind === 'l' ? h('button', { class: 'pb-btn', onclick: () => edit('Speilvendte trappa', () => (stairOf(st.id).side = stairOf(st.id).side === 1 ? 0 : 1)) }, 'Speilvend') : null)));
    // the measures
    const measure = (label, value, onSet) => {
      const input = h('input', { type: 'number', min: 60, max: 800, step: 1, value: cm(value) });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= 60 && v <= 800) onSet(v / 100);
        else input.value = cm(value);
      });
      return h('label', { class: 'fc-measure' }, h('span', {}, label), h('span', { class: 'fc-input' }, input, h('em', {}, 'cm')));
    };
    // lengthen or narrow from the top end (the foot stays where it lands)
    const setSize = (len, wid) =>
      edit('Trappas mål', () => {
        const s = stairOf(st.id);
        const [[x0, y0], [x1, y1]] = s.rect;
        const along = s.axis === 'x';
        const foot = along ? (s.down > 0 ? x1 : x0) : s.down > 0 ? y1 : y0;
        const top = foot - s.down * len;
        const c = along ? (y0 + y1) / 2 : (x0 + x1) / 2;
        const lo = [Math.min(top, foot), c - wid / 2];
        const hi = [Math.max(top, foot), c + wid / 2];
        s.rect = along ? [[round(lo[0], 4), round(lo[1], 4)], [round(hi[0], 4), round(hi[1], 4)]] : [[round(lo[1], 4), round(lo[0], 4)], [round(hi[1], 4), round(hi[0], 4)]];
      });
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Mål'),
      h('div', { class: 'fc-measures sp-measures' }, measure('Lengde', geo.length, (v) => setSize(v, geo.width)), measure('Bredde', geo.width, (v) => setSize(geo.length, v)))));
    const steep = p.angle > 42 && st.kind !== 'steep';
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Trinn'),
      h('p', { class: `sp-pitch${steep ? ' is-steep' : ''}` }, `${p.risers} opptrinn på ${cm(p.riser)} cm, inntrinn ca. ${cm(p.going)} cm – ${Math.round(p.angle)}°`),
      steep ? h('p', { class: 'fc-note' }, 'Trappa blir bratt (over 42°). Gjør den lengre, eller velg halvsvingt.') : h('p', { class: 'fc-note' }, 'En vanlig trapp er 30–40°.')));
    panel.append(h('button', { class: 'pb-btn is-danger fc-wide', onclick: remove }, 'Slett trappa'));
  }

  render();
  return { el, close };
}

/** A stair in the plan: its outline, the treads and the arrow down from its top (a U stair: down, round, back). */
function drawStair(g, st, X, Y, k, sel) {
  const geo = stairGeometry(st);
  const [[x0, y0], [x1, y1]] = st.rect;
  g.append(svg('rect', { x: X(x0), y: Y(y0), width: (x1 - x0) * k, height: (y1 - y0) * k, class: sel ? 'sp-stair is-selected' : 'sp-stair' }));
  const N0 = geo.top[0];
  const N1 = geo.top[1];
  const e = [(N1[0] - N0[0]) / (geo.width || 1), (N1[1] - N0[1]) / (geo.width || 1)];
  const d = geo.down;
  const P = (acr, alg) => [X(N0[0] + e[0] * acr + d[0] * alg), Y(N0[1] + e[1] * acr + d[1] * alg)];
  const line = (a, b, cls) => g.append(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls }));
  const W = geo.width;
  const L = geo.length;
  if (st.kind === 'l') {
    // the whole L in its rectangle: the top flight down one side, the turn in the far corner, the foot flight along the end
    const w = lFlight(st);
    const first = st.side !== 1;
    const [a0, a1] = first ? [0, w] : [W - w, W];
    for (let v = 0.25; v < L - w; v += 0.25) line(P(a0, v), P(a1, v), 'sp-tread');
    const corner = first ? [w, L - w] : [W - w, L - w];
    for (const t of [0.33, 0.66]) line(P(corner[0], corner[1]), P(first ? a0 + (a1 - a0) * (1 - t) : a0 + (a1 - a0) * t, L), 'sp-tread');
    line(P(corner[0], corner[1]), P(first ? 0 : W, L - w + w * 0.5), 'sp-tread');
    const [b0, b1] = first ? [w, W] : [0, W - w];
    for (let x = b0 + 0.25; x < b1; x += 0.25) line(P(x, L - w), P(x, L), 'sp-tread');
    g.append(svg('path', { d: `M${P(a0, 0).join(' ')}L${P(a1, 0).join(' ')}L${P(a1, L - w).join(' ')}L${P(first ? W : 0, L - w).join(' ')}`, class: 'sp-tread' }));
    const m = (a0 + a1) / 2;
    const endX = first ? W - 0.15 : 0.15;
    g.append(svg('path', { d: `M${P(m, 0.12).join(' ')}L${P(m, L - w / 2).join(' ')}L${P(endX, L - w / 2).join(' ')}`, class: 'sp-arrow' }));
    const tip = P(endX, L - w / 2);
    const bk = P(endX + (first ? -0.2 : 0.2), L - w / 2);
    g.append(svg('path', { d: `M${bk[0] - (tip[1] - bk[1]) * 0.6} ${bk[1] + (tip[0] - bk[0]) * 0.6}L${tip[0]} ${tip[1]}L${bk[0] + (tip[1] - bk[1]) * 0.6} ${bk[1] - (tip[0] - bk[0]) * 0.6}`, class: 'sp-arrow' }));
    g.append(svg('circle', { cx: P(m, 0.12)[0], cy: P(m, 0.12)[1], r: 3, class: 'sp-dot' }));
  } else if (st.kind === 'u') {
    const well = Math.min(0.2, Math.max(0.06, W * 0.06));
    const half = (W - well) / 2;
    const sideA = st.side !== 1;
    const [t0, t1] = sideA ? [0, half] : [half + well, W];
    const [f0, f1] = sideA ? [half + well, W] : [0, half];
    for (let v = 0.25; v < L - half; v += 0.25) for (const [a, b] of [[t0, t1], [f0, f1]]) line(P(a, v), P(b, v), 'sp-tread');
    g.append(svg('path', { d: `M${P(half, 0).join(' ')}L${P(half + well, 0).join(' ')}L${P(half + well, L - half).join(' ')}L${P(half, L - half).join(' ')}Z`, class: 'sp-well' }));
    const tm = (t0 + t1) / 2;
    const fm = (f0 + f1) / 2;
    const end = L - half / 2;
    g.append(svg('path', { d: `M${P(tm, 0.12).join(' ')}L${P(tm, end).join(' ')}L${P(fm, end).join(' ')}L${P(fm, 0.2).join(' ')}`, class: 'sp-arrow' }));
    const tip = P(fm, 0.1);
    const bk = P(fm, 0.3);
    g.append(svg('path', { d: `M${bk[0] - (tip[1] - bk[1]) * 0.5} ${bk[1] + (tip[0] - bk[0]) * 0.5}L${tip[0]} ${tip[1]}L${bk[0] + (tip[1] - bk[1]) * 0.5} ${bk[1] - (tip[0] - bk[0]) * 0.5}`, class: 'sp-arrow' }));
  } else {
    // a steep stair: closer treads
    const step = st.kind === 'steep' ? 0.16 : 0.25;
    for (let v = step; v < L; v += step) line(P(0, v), P(W, v), 'sp-tread');
    const a = P(W / 2, 0.12);
    const b = P(W / 2, L - 0.12);
    line(a, b, 'sp-arrow');
    const back = P(W / 2, L - 0.38);
    g.append(svg('path', { d: `M${back[0] - (b[1] - back[1]) * 0.6} ${back[1] + (b[0] - back[0]) * 0.6}L${b[0]} ${b[1]}L${back[0] + (b[1] - back[1]) * 0.6} ${back[1] - (b[0] - back[0]) * 0.6}`, class: 'sp-arrow' }));
    g.append(svg('circle', { cx: a[0], cy: a[1], r: 3, class: 'sp-dot' }));
  }
}
