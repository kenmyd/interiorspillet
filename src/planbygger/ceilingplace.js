/**
 * Himling – the plan of the top level (the only one under the roof), each room flat or following the roof: click a
 * room to switch it, drag the ridge line (or draw one), and set the roof pitch. What the drawings said («SKRÅ
 * HIMLING 24°», «PLAN HIMLING», the AI's reading, houseread.js) is the start; a choice here is a mark of the user's own
 * in level.ceilingMarks ({ from: 'bruker' }), which wins in its room (houseread.js ceilingSlope, export.js). The changes
 * go into the document with undo; «Ferdig» rebuilds the 3D house.
 *
 *   openCeilings({ getDoc, h, intro, onChange(label, fn), onDone(changed) }) → { el, close }
 */
import { levelRooms } from './regions.js';
import { ceilingSlope } from './houseread.js';
import { pointInPolygon, round } from './geom.js';

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
const snap = (v) => Math.round(v / 0.05) * 0.05;

/** The top level: the one the roof lies over (export.js exportRoofs). */
export function topLevel(doc) {
  return [...doc.levels].sort((a, b) => (b.floorY ?? 0) - (a.floorY ?? 0))[0] ?? null;
}

/** A point inside a polygon: its centroid when that is inside, else the middle of the widest run through it. */
export function interiorPoint(poly) {
  const n = poly.length;
  const c = [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  if (pointInPolygon(c, poly)) return c;
  const ys = poly.map((p) => p[1]);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  let best = null;
  for (let k = 1; k < 20; k++) {
    const y = y0 + ((y1 - y0) * k) / 20;
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best.w) best = { w: xs[i + 1] - xs[i], p: [(xs[i] + xs[i + 1]) / 2, y] };
  }
  return best?.p ?? c;
}

export function openCeilings({ getDoc, h, intro = null, onChange, onDone }) {
  let selected = null; // a room index
  let ridgeSel = null; // the index of a ridge mark in level.ceilingMarks
  let drawing = false; // «Tegn mønelinje»: the next drag draws one
  let drag = null; // { mode: 'new' | 'move' | 'end', … }
  let changed = false;
  let view = null;
  const stage = h('div', { class: 'fc-stage' });
  const panel = h('aside', { class: 'fc-panel' });
  const close = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    el.remove();
    onDone?.(changed);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 120);
  };
  const el = h('div', { class: 'fc' },
    h('header', { class: 'fc-head' },
      h('div', { class: 'fc-title' }, h('h2', {}, 'Himling'), h('p', {}, intro ?? 'Klikk på et rom for å bytte mellom flat og skrå himling. Skrå himling følger taket helt opp til mønet.')),
      h('div', { class: 'fc-tabs' }),
      h('div', { class: 'fc-head-actions' }, h('button', { class: 'pb-btn is-primary', onclick: () => close() }, 'Ferdig – bygg 3D-huset'))),
    h('div', { class: 'fc-body' }, stage, panel));
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.body.append(el);

  const level = () => topLevel(getDoc());
  const edit = (label, fn) => {
    onChange(label, () => {
      const L = level();
      if (L) fn(L);
    });
    changed = true;
    render();
  };
  const roomsOf = (L) => {
    const found = levelRooms(L);
    return found.rooms.map((r) => {
      const label = (L.rooms || []).find((x) => x.seed && found.at(x.seed[0], x.seed[1]) === r.index);
      return { index: r.index, polygon: r.polygon, name: label?.name ?? '', seed: label?.seed ?? interiorPoint(r.polygon) };
    });
  };
  /** The user's choice for a room: the marks of the user in it go, one new one at its seed. */
  const setRoom = (rooms, list, kind) =>
    edit(kind === 'flat' ? 'Flat himling' : 'Skrå himling', (L) => {
      const marks = (L.ceilingMarks ||= []);
      for (const r of list) {
        L.ceilingMarks = marks.filter((m) => !(m.from === 'bruker' && !m.ridge && m.points.some((q) => pointInPolygon(q, r.polygon))));
        L.ceilingMarks.push({ kind, degrees: null, text: null, points: [r.seed.map((v) => round(v, 3))], ridge: null, from: 'bruker' });
      }
    });

  // dragging a ridge line: on the stage, which stays while render() replaces the drawing
  const toPlan = (e) => {
    const p = view.g.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(view.g.getScreenCTM().inverse());
    return [q.x / view.k + view.minX, q.y / view.k + view.minY];
  };
  const ridges = (L) => (L.ceilingMarks ?? []).map((m, i) => ({ m, i })).filter((x) => x.m.ridge);
  stage.addEventListener('pointerdown', (e) => {
    const L = level();
    if (!view || !L || !view.g.contains(e.target)) return;
    const p = toPlan(e);
    const px = (q) => [view.X(q[0]), view.Y(q[1])];
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const P = px(p);
    let hit = null;
    for (const { m, i } of ridges(L)) {
      const [a, b] = m.ridge.map(px);
      if (near(a, P) < 10) hit = { mode: 'end', i, end: 0 };
      else if (near(b, P) < 10) hit = { mode: 'end', i, end: 1 };
      else {
        const d = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((P[0] - a[0]) * d[0] + (P[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1)));
        if (near([a[0] + d[0] * t, a[1] + d[1] * t], P) < 8) hit = { mode: 'move', i };
      }
      if (hit) break;
    }
    if (drawing) drag = { mode: 'new', a: [snap(p[0]), snap(p[1])], line: null };
    else if (hit) {
      ridgeSel = hit.i;
      selected = null;
      drag = { ...hit, orig: L.ceilingMarks[hit.i].ridge.map((q) => [...q]), line: L.ceilingMarks[hit.i].ridge };
    } else {
      // a click on a room selects it (a second click on the chosen one switches it)
      const rooms = roomsOf(L);
      const r = rooms.find((x) => pointInPolygon(p, x.polygon));
      ridgeSel = null;
      if (r && selected === r.index) {
        const s = ceilingSlope(L, (q) => pointInPolygon(q, r.polygon));
        setRoom(rooms, [r], s.slope ? 'flat' : 'sloped');
        return;
      }
      selected = r ? r.index : null;
      render();
      return;
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
    if (drag.mode === 'new') drag.line = [drag.a, [snap(p[0]), snap(p[1])]];
    else if (drag.mode === 'move') {
      const d = [snap(p[0] - drag.from[0]), snap(p[1] - drag.from[1])];
      drag.line = drag.orig.map((q) => [round(q[0] + d[0], 3), round(q[1] + d[1], 3)]);
    } else {
      drag.line = drag.orig.map((q, k) => (k === drag.end ? [snap(p[0]), snap(p[1])] : q));
    }
    // a line nearly along the plan's axes is put on it (ridges run along the walls)
    const [a, b] = drag.line;
    if (Math.abs(b[1] - a[1]) < Math.abs(b[0] - a[0]) * 0.08) drag.line = drag.mode === 'end' && drag.end === 0 ? [[a[0], b[1]], b] : [a, [b[0], a[1]]];
    else if (Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]) * 0.08) drag.line = drag.mode === 'end' && drag.end === 0 ? [[b[0], a[1]], b] : [a, [a[0], b[1]]];
    render();
  });
  const endDrag = () => {
    const d = drag;
    drag = null;
    if (!d) return;
    const long = d.line && Math.hypot(d.line[1][0] - d.line[0][0], d.line[1][1] - d.line[0][1]) >= 0.8;
    if (d.mode === 'new') {
      drawing = false;
      if (long)
        edit('Ny mønelinje', (L) => {
          (L.ceilingMarks ||= []).push({ kind: 'sloped', degrees: null, text: null, points: [], ridge: d.line, from: 'bruker' });
          ridgeSel = L.ceilingMarks.length - 1;
        });
      else render();
    } else if (long && JSON.stringify(d.line) !== JSON.stringify(d.orig)) {
      edit('Flyttet mønelinja', (L) => {
        const m = L.ceilingMarks?.[d.i];
        if (m) m.ridge = d.line;
      });
    } else render();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  function render() {
    const doc = getDoc();
    stage.innerHTML = '';
    const L = level();
    if (!L || !L.walls.length) {
      stage.append(h('p', { class: 'fc-empty' }, 'Huset har ingen vegger ennå.'));
      panel.innerHTML = '';
      return;
    }
    const rooms = roomsOf(L);
    const pts = L.walls.flatMap((w) => [w.a, w.b]);
    const minX = Math.min(...pts.map((p) => p[0])) - 0.6;
    const minY = Math.min(...pts.map((p) => p[1])) - 0.6;
    const maxX = Math.max(...pts.map((p) => p[0])) + 0.6;
    const maxY = Math.max(...pts.map((p) => p[1])) + 0.6;
    const box = stage.getBoundingClientRect();
    const k = Math.min(Math.max(380, box.width - 60) / (maxX - minX), Math.max(300, box.height - 60) / (maxY - minY));
    const X = (x) => (x - minX) * k;
    const Y = (y) => (y - minY) * k;
    const W = (maxX - minX) * k;
    const Hh = (maxY - minY) * k;
    const g = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: 'fc-svg sp-svg' });
    g.append(svg('rect', { x: 0, y: 0, width: W, height: Hh, class: 'sp-paper' }));
    for (const r of rooms) {
      const s = ceilingSlope(L, (q) => pointInPolygon(q, r.polygon));
      g.append(svg('path', { d: `M${r.polygon.map((p) => `${X(p[0])} ${Y(p[1])}`).join('L')}Z`, class: `cp-room${s.slope ? ' is-sloped' : ''}${r.index === selected ? ' is-selected' : ''}` }));
    }
    for (const w of L.walls) g.append(svg('line', { x1: X(w.a[0]), y1: Y(w.a[1]), x2: X(w.b[0]), y2: Y(w.b[1]), class: 'sp-wall', 'stroke-width': Math.max(1.5, (w.t ?? 0.1) * k) }));
    for (const r of rooms) if (r.name) g.append(svg('text', { x: X(r.seed[0]), y: Y(r.seed[1]), class: 'sp-room' }, r.name));
    // the ridge lines (the one being dragged as it is now)
    const lines = ridges(L).map(({ m, i }) => ({ i, line: drag && drag.i === i ? drag.line : m.ridge }));
    if (drag?.mode === 'new' && drag.line) lines.push({ i: -1, line: drag.line });
    for (const { i, line } of lines) {
      const [a, b] = line;
      g.append(svg('line', { x1: X(a[0]), y1: Y(a[1]), x2: X(b[0]), y2: Y(b[1]), class: `cp-ridge${i === ridgeSel || i === -1 ? ' is-selected' : ''}` }));
      if (i === ridgeSel) for (const q of line) g.append(svg('circle', { cx: X(q[0]), cy: Y(q[1]), r: 6, class: 'sp-handle' }));
    }
    view = { g, k, minX, minY, X, Y };
    stage.append(h('div', { class: `fc-sheet${drawing ? ' is-drawing' : ''}` }, g));
    renderPanel(doc, L, rooms);
  }

  function renderPanel(doc, L, rooms) {
    panel.innerHTML = '';
    const r = rooms.find((x) => x.index === selected);
    const WHY = { bruker: 'valgt av deg', tegning: 'fra tegningen', regel: 'gjettet: taket er et pulttak eller vinduene går høyt' };
    if (r) {
      const s = ceilingSlope(L, (q) => pointInPolygon(q, r.polygon));
      panel.append(h('div', { class: 'fc-nav' }, h('div', { class: 'fc-nav-title' }, h('strong', {}, r.name || 'Rom uten navn'), h('span', {}, `${s.slope ? 'Skrå himling' : 'Flat himling'}${s.why ? ` – ${WHY[s.why]}${s.text ? ` («${s.text}»)` : ''}` : ''}`))),
        h('section', { class: 'fc-section' }, h('h4', {}, 'Himlingen i rommet'),
          h('div', { class: 'sp-row' },
            h('button', { class: `pb-btn${s.slope ? ' is-primary' : ''}`, onclick: () => setRoom(rooms, [r], 'sloped') }, 'Skrå – følger taket'),
            h('button', { class: `pb-btn${!s.slope ? ' is-primary' : ''}`, onclick: () => setRoom(rooms, [r], 'flat') }, 'Flat'))));
    } else {
      panel.append(h('div', { class: 'fc-panel-empty' },
        h('h3', {}, L.name),
        h('p', {}, 'Klikk på et rom for å velge det, og klikk en gang til for å bytte. Rommene med skrå himling er farget.'),
        h('p', {}, 'Mønelinja er der taket er høyest: midt i rommet for et saltak, langs en vegg for et pulttak.')));
    }
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Hele etasjen'),
      h('div', { class: 'sp-row' },
        h('button', { class: 'pb-btn', onclick: () => setRoom(rooms, rooms, 'sloped') }, 'Alle skrå'),
        h('button', { class: 'pb-btn', onclick: () => setRoom(rooms, rooms, 'flat') }, 'Alle flate'))));
    // the ridge
    const rs = ridgeSel != null ? L.ceilingMarks?.[ridgeSel] : null;
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Mønelinje'),
      h('p', { class: 'fc-note' }, ridges(L).length ? 'Dra streken for å flytte den, og endene for å gjøre den lengre.' : 'Ingen mønelinje er tegnet. Uten den går mønet langs den lengste siden av hver takdel.'),
      h('div', { class: 'sp-row' },
        h('button', { class: `pb-btn${drawing ? ' is-primary' : ''}`, onclick: () => ((drawing = !drawing), (selected = null), render()) }, drawing ? 'Dra på planen …' : 'Tegn mønelinje'),
        rs ? h('button', { class: 'pb-btn is-danger', onclick: () => edit('Slettet mønelinja', (Lv) => {
          Lv.ceilingMarks.splice(ridgeSel, 1);
          ridgeSel = null;
        }) }, 'Slett mønelinja') : null)));
    // the pitch
    const pitch = doc.roof?.pitchSet ?? doc.roof?.pitch ?? (L.ceilingMarks ?? []).find((m) => m.degrees)?.degrees ?? null;
    const input = h('input', { type: 'number', min: 5, max: 60, step: 1, value: pitch ?? '', placeholder: '–' });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 5 && v <= 60)
        onChange('Takvinkel', (d) => {
          (d ?? getDoc()).roof = { ...(getDoc().roof || {}), pitchSet: Math.round(v) };
        });
      changed = true;
      render();
    });
    panel.append(h('section', { class: 'fc-section' }, h('h4', {}, 'Takvinkel'),
      h('label', { class: 'fc-measure' }, h('span', {}, 'Vinkel'), h('span', { class: 'fc-input' }, input, h('em', {}, 'grader'))),
      h('p', { class: 'fc-note' }, pitch ? 'Fra tegningen eller valgt av deg. Gjelder hele taket.' : 'Ikke oppgitt på tegningene: saltak får 35°, pulttak 10°.')));
  }

  render();
  return { el, close };
}
