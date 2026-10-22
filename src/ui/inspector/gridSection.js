/**
 * «Antall og rutenett» – rows and grids of ceiling fittings in the Inspector (design/lighting.md §5.1; MASTER §2.7,
 * D3, D44):
 *
 *   gridExtension() → Inspector extension (Inspector.addExtension)
 *     sections.afterLight  «Antall og rutenett» for GRIDABLE ceiling items: Én / Rekke / Rutenett, the counts, the
 *                          spacing (rows apart on request), a summary («9 stk · 3 × 3 · 1,20 m mellom · …»),
 *                          «Fordel jevnt i rommet», «Roter 90°», «Del opp i enkeltspotter»
 *     sections.size        the head-size sliders (dims hold the whole grid; the sliders edit ONE fitting)
 *     carry                a swap / reset between gridable products keeps the grid
 *   gridCatalogAction(editor) → (({ panel, product, vi }) → HTMLElement|null)
 *     a catalogue detail button «Legg inn flere (rekke/rutenett) …» on gridable products: places a 2 × 3 grid
 *   carryGrid(item, spec) → { params, dims } | null
 *
 * Every change is one undo step per gesture (sliders coalesce) and goes through insp._fit (Placement.constrain keeps
 * the extent inside the room); «Fordel jevnt» and «Del opp» are the pure design/gridOps.js functions.
 */
import { section, button, slider, toggle, row, fmtNok } from '../panelKit.js';
import { h, fmtNumber } from '../dom.js';
import { cm, throttle, blurSoon, seg } from '../inspectorKit.js';
import { GRIDABLE, GRID_LIMITS, GRID_HEAD_RANGE, GRID_DEFAULT_SPACING, gridOf, gridSpec } from '../../design/grid.js';
import { distributeGrid, splitGrid } from '../../design/gridOps.js';
import { priceInfo, dimsText } from '../CatalogPanel.js';
import { normDeg } from '../../design/Selection.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const meters = (v) => `${fmtNumber(v, 2)} m`;
/** The last «får ikke plass» message per Inspector (survives the re-render after a slider is released). */
const lastFit = new WeakMap();
/** The item whose «Ulik avstand mellom radene» is switched on before its rows were moved apart (per Inspector). */
const unequalOn = new WeakMap();

const HINT_ONE = 'Tips: Velg rader og kolonner for å lage en rekke eller et rutenett – eller «Fordel jevnt i rommet».';

/** Whether an item is a gridable ceiling fitting. */
const gridable = (item) => !!item && GRIDABLE.has(item.archetype) && item.mount === 'ceiling';

/**
 * The grid carried over a swap / reset between gridable archetypes: the new product's fitting in the old grid.
 * @returns {{ params: { gridRows: number, gridCols: number, gridDx: number, gridDz: number }, dims: object } | null}
 */
export function carryGrid(item, spec) {
  if (!item || !spec || !GRIDABLE.has(item.archetype) || !GRIDABLE.has(spec.archetype)) return null;
  const g = gridOf(item);
  if (g.count <= 1 || !spec.dims) return null;
  return gridSpec(spec.dims, g);
}

/** Mode of a grid: 'one' (1 × 1), 'row' (one row or one column), 'grid'. */
function modeOf(g) {
  if (g.count <= 1) return 'one';
  return g.rows === 1 || g.cols === 1 ? 'row' : 'grid';
}

/** A toast in the game HUD. */
function toast(ins, text, seconds = 2.5) {
  ins.editor?.events?.emit?.('toast', { text, seconds });
}

/** «Antall og rutenett». */
function gridSection(ins, item, product) {
  if (!gridable(item)) return null;
  const uid = item.uid;
  const cur = () => ins.design.get(uid) || item;
  const g0 = gridOf(item);
  const mode = modeOf(g0);
  const fitEl = h('p.ipi-fit');
  const fitMsg = (text) => {
    fitEl.textContent = text || '';
    if (text) lastFit.set(ins, { uid, text });
    else lastFit.delete(ins);
  };
  const last = lastFit.get(ins);
  if (last?.uid === uid) fitEl.textContent = last.text;

  const lumens = item.light?.lumens ?? product?.light?.lumens ?? null;
  const summaryEl = h('p.ipi-hint');
  const summary = (g) => {
    if (g.count <= 1) {
      summaryEl.textContent = HINT_ONE;
      return;
    }
    const parts = [`${g.count} stk`, `${g.rows} × ${g.cols}`];
    parts.push(g.rows > 1 && g.cols > 1 && Math.abs(g.dx - g.dz) > 0.004 ? `${fmtNumber(g.dx, 2)} × ${fmtNumber(g.dz, 2)} m mellom` : `${meters(g.rows === 1 || g.cols > 1 ? g.dx : g.dz)} mellom`);
    if (lumens) parts.push(`${g.count} × ${fmtNumber(lumens, 0)} = ${fmtNumber(g.count * lumens, 0)} lumen`);
    if (product) {
      const vi = cur().variantIndex;
      const pur = ins.catalog.purchaseOf?.(product, vi, g.count);
      const total = pur?.total ?? (priceInfo(ins.catalog, product, vi).price != null ? priceInfo(ins.catalog, product, vi).price * g.count : null);
      if (total != null) parts.push(fmtNok(total));
    }
    summaryEl.textContent = parts.join(' · ');
  };
  summary(g0);

  /** The largest spacing (≤ the asked one, ≥ the minimum) at which the grid fits; null when not even that does. */
  const shrinkSpacing = (head, grid) => {
    const at = (f) => ({ ...grid, dx: Math.max(GRID_LIMITS.spacing[0], r3(grid.dx * f)), dz: Math.max(GRID_LIMITS.spacing[0], r3(grid.dz * f)) });
    const r0 = ins._fit(uid, gridSpec(head, at(0)));
    if (r0.status === 'blocked') return null;
    let a = 0, b = 1, good = { res: r0, grid: at(0) };
    for (let i = 0; i < 9; i++) {
      const m = (a + b) / 2;
      const r = ins._fit(uid, gridSpec(head, at(m)));
      if (r.status === 'blocked') b = m;
      else {
        a = m;
        good = { res: r, grid: at(m) };
      }
    }
    return good;
  };

  /** Applies a grid (one undo step per gesture: sliders coalesce); final re-renders the panel. */
  const apply = (grid, { final = false, label = 'Endre rutenett' } = {}) => {
    const it = cur();
    const head = gridOf(it).head;
    const want = gridSpec(head, grid);
    let res = ins._fit(uid, want);
    let note = '';
    if (res.status === 'blocked') {
      const s = shrinkSpacing(head, grid);
      if (!s) {
        fitMsg('Så mange spotter får ikke plass her.');
        return false;
      }
      res = s.res;
      const sp = Math.max(s.grid.dx, s.grid.dz);
      note = `Rutenettet er satt ned til ${meters(sp)} avstand – større får ikke plass i rommet her.`;
    } else if (want.params.gridDx + 0.004 < (grid.dx ?? want.params.gridDx) || want.params.gridDz + 0.004 < (grid.dz ?? want.params.gridDz)) {
      note = `Rutenettet er satt ned til ${meters(Math.max(want.params.gridDx, want.params.gridDz))} avstand – det kan være høyst ${fmtNumber(GRID_LIMITS.maxExtent, 0)} m langt.`;
    }
    ins._apply(res.patch, { coalesce: 'grid', label });
    fitMsg(note);
    summary(gridOf(cur()));
    if (final) ins._render();
    return true;
  };

  const kids = [];
  // 1. mode
  kids.push(seg([['one', 'Én'], ['row', 'Rekke'], ['grid', 'Rutenett']], mode, (m) => {
    const g = gridOf(cur());
    const dx = g.dx, dz = g.dz;
    if (m === 'one') apply({ rows: 1, cols: 1, dx, dz }, { final: true, label: 'Én spot' });
    else if (m === 'row') apply({ rows: 1, cols: clamp(Math.max(3, g.count), 2, GRID_LIMITS.cols[1]), dx, dz: dx }, { final: true, label: 'Spotter på rekke' });
    else apply({ rows: Math.max(2, g.rows), cols: Math.max(2, g.cols), dx, dz }, { final: true, label: 'Spotter i rutenett' });
  }));

  // 2. counts
  const countSlider = (label, key, min, max, value) => {
    const set = (v) => {
      const g = gridOf(cur());
      const grid = { rows: g.rows, cols: g.cols, dx: g.dx, dz: g.dz, [key]: Math.round(v) };
      return grid;
    };
    const live = throttle((v) => apply(set(v)), 90);
    const ctl = slider({
      label, min, max, step: 1, value,
      format: (v) => `${Math.round(v)} stk`,
      onInput: (v) => live(v),
      onChange: (v) => {
        live.cancel();
        blurSoon(ctl.input);
        apply(set(v), { final: true });
      },
    });
    return ctl.el;
  };
  if (mode === 'row') {
    // a column (rows × 1, e.g. after «Fordel jevnt» in a narrow room) counts its rows
    const vertical = g0.cols === 1 && g0.rows > 1;
    kids.push(vertical
      ? countSlider('Antall', 'rows', 2, GRID_LIMITS.rows[1], g0.rows)
      : countSlider('Antall', 'cols', 2, GRID_LIMITS.cols[1], g0.cols));
  } else if (mode === 'grid') {
    kids.push(countSlider('Rader', 'rows', 2, GRID_LIMITS.rows[1], g0.rows), countSlider('Per rad', 'cols', 2, GRID_LIMITS.cols[1], g0.cols));
  }

  // 3. spacing
  if (mode !== 'one') {
    const unequal = mode === 'grid' && Math.abs(g0.dx - g0.dz) > 0.004;
    const [s0, s1] = GRID_LIMITS.spacing;
    const spacing = (label, which, value) => {
      const set = (v) => {
        const g = gridOf(cur());
        const x = r3(v);
        if (which === 'dz') return { rows: g.rows, cols: g.cols, dx: g.dx, dz: x };
        // «Avstand» sets the rows' spacing too while it is equal (a row: the one that counts)
        return { rows: g.rows, cols: g.cols, dx: x, dz: unequal ? g.dz : x };
      };
      const live = throttle((v) => apply(set(v), { label: 'Endre avstand' }), 90);
      const ctl = slider({
        label, min: s0, max: s1, step: 0.05, value: clamp(value, s0, s1),
        format: (v) => cm(v),
        onInput: (v) => live(v),
        onChange: (v) => {
          live.cancel();
          blurSoon(ctl.input);
          apply(set(v), { final: true, label: 'Endre avstand' });
        },
      });
      return ctl.el;
    };
    const vertical = mode === 'row' && g0.cols === 1;
    kids.push(spacing('Avstand', 'dx', vertical ? g0.dz : g0.dx));
    if (mode === 'grid') {
      const tg = toggle({
        label: 'Ulik avstand mellom radene',
        value: unequal,
        onChange: (v) => {
          blurSoon(tg.input);
          const g = gridOf(cur());
          if (v) {
            // show the second slider; the grid itself is unchanged until it is moved
            unequalOn.set(ins, uid);
            ins._render();
          } else {
            unequalOn.delete(ins);
            apply({ rows: g.rows, cols: g.cols, dx: g.dx, dz: g.dx }, { final: true, label: 'Lik avstand' });
          }
        },
      });
      kids.push(tg.el);
      if (unequal || unequalOn.get(ins) === uid) {
        tg.set(true);
        kids.push(spacing('Avstand mellom radene', 'dz', g0.dz));
      }
    }
  }

  // 4. summary + fit message
  kids.push(summaryEl, fitEl);

  // 5. buttons
  const spread = button({
    label: 'Fordel jevnt i rommet', variant: 'primary', size: 'sm',
    title: 'Sprer spottene jevnt over rommet (eller sonen i stua) – halv avstand inn til veggene',
    onClick: () => {
      const it = cur();
      for (const scale of [1, 0.85, 0.7]) {
        const d = distributeGrid(it, ins.editor.layout, { scale });
        if (d.error) {
          fitMsg(d.error);
          return;
        }
        const res = ins._fit(uid, d.patch);
        if (res.status === 'blocked') continue;
        ins._apply(res.patch, { label: 'Fordel spotter jevnt' });
        fitMsg('');
        const g = gridOf(cur());
        toast(ins, `${g.count} ${g.count === 1 ? 'spot' : 'spotter'} fordelt jevnt i ${String(d.area.name || 'rommet').toLowerCase()}`);
        ins._render();
        return;
      }
      fitMsg('Rommet har en form rutenettet ikke passer i – juster antall eller avstand selv.');
    },
  });
  const buttons = [spread];
  if (g0.count > 1) {
    buttons.push(button({
      label: 'Roter 90°', size: 'sm', title: 'Snur rutenettet en kvart runde',
      onClick: () => {
        const it = cur();
        ins._apply(ins._fit(uid, { rotationDeg: normDeg((it.rotationDeg || 0) + 90) }).patch, { label: 'Roter rutenettet' });
        ins._render();
      },
    }));
    buttons.push(button({
      label: 'Del opp i enkeltspotter', size: 'sm', variant: 'ghost',
      title: 'Gjør rutenettet om til enkeltspotter du kan flytte hver for seg',
      onClick: () => {
        const it = cur();
        const res = splitGrid(it, { itemCount: ins.design.list().length });
        if (res.error) {
          toast(ins, res.error, 3.5);
          return;
        }
        const uids = ins.design.transaction(`Del opp ${it.name}`, (d) => {
          d.remove(it.uid);
          return res.specs.map((s) => d.add(s));
        });
        if (uids?.length) ins.editor.select({ kind: 'item', uid: uids[0] });
        toast(ins, `Delt opp i ${uids?.length ?? 0} spotter – Ctrl+Z angrer`, 3);
      },
    }));
  }
  kids.push(row(...buttons));
  return section('Antall og rutenett', ...kids);
}

/** Head-size sliders of a grid item (dims = the grid's extent; the sliders edit ONE fitting). */
function gridSizeSection(ins, item, product, def) {
  if (!gridable(item)) return null;
  const uid = item.uid;
  const cur = () => ins.design.get(uid) || item;
  const range = GRID_HEAD_RANGE[item.archetype];
  if (!range) return null;
  const g0 = gridOf(item);
  const head0 = g0.head;
  const values = { ...(def?.defaults?.params || {}), ...(item.params || {}) };
  // spot-ceiling: w = d = the canopy Ø; downlights by their shape
  const round = item.archetype === 'spot-ceiling' || (values.shape ?? 'round') === 'round';
  const ref = product?.dims || def?.defaults?.dims || null;
  const fitEl = h('p.ipi-fit');
  const label = `Endre størrelse på ${item.name}`;
  const applyHead = (patch, final) => {
    const g = gridOf(cur());
    const head = { ...g.head, ...patch };
    const spec = gridSpec(head, g);
    const res = ins._fit(uid, { dims: spec.dims });
    if (res.status === 'blocked') {
      fitEl.textContent = 'Så store spotter får ikke plass her.';
      return;
    }
    fitEl.textContent = '';
    ins._apply(res.patch, { coalesce: 'dims', label });
    if (final) ins._dirty = true; // refresh the «Egne mål» warning when the slider is released
  };
  const small = (k) => range[k][1] <= 0.05;
  const fmt = (k) => (small(k) ? (v) => `${fmtNumber(Math.round(v * 1000), 0)} mm` : (v) => cm(v));
  const make = (lbl, keys, k) => {
    const [lo, hi] = range[k];
    const v = head0[k];
    // the range always holds the current head AND the product's own size (Anillo Ø30 is wider than the archetype's
    // 25 cm), so dragging smaller and back never clamps the real product away
    const rv = Number.isFinite(ref?.[k]) && ref[k] > 0 ? ref[k] : v;
    const step = small(k) ? 0.001 : 0.005;
    const live = throttle((x) => applyHead(Object.fromEntries(keys.map((kk) => [kk, r3(x)])), false), 90);
    const ctl = slider({
      label: lbl,
      min: Math.min(lo, v, rv),
      max: Math.max(hi, v, rv),
      step,
      value: v,
      format: fmt(k),
      onInput: (x) => live(x),
      onChange: (x) => {
        live.cancel();
        applyHead(Object.fromEntries(keys.map((kk) => [kk, r3(x)])), true);
        blurSoon(ctl.input);
      },
    });
    return ctl.el;
  };
  const kids = [];
  if (round) kids.push(make('Diameter', ['w', 'd'], 'w'));
  else kids.push(make('Bredde', ['w'], 'w'), make('Dybde', ['d'], 'd'));
  if (range.h[1] - range.h[0] > 0.01) kids.push(make(item.archetype === 'spot-ceiling' ? 'Høyde (fra taket)' : 'Høyde', ['h'], 'h'));
  kids.push(fitEl);
  if (g0.count > 1) kids.push(h('p.ipi-hint', { text: `Målene gjelder én spot – rutenettet er ${cm(g0.extent.w)} × ${cm(g0.extent.d)}.` }));
  if (ref) {
    const who = product ? `Mål fra ${product.store}` : 'Standardmål';
    const text = round ? `${who}: Ø ${cm(ref.w)}${range.h[1] - range.h[0] > 0.01 ? `, høyde ${cm(ref.h)}` : ''}` : `${who}: ${dimsText(ref)}`;
    kids.push(h('p.ipi-hint', { text }));
    const differs = ['w', 'd', 'h'].some((k) => Math.abs((head0[k] ?? 0) - (ref[k] ?? 0)) > 0.005);
    if (differs && product) {
      kids.push(h('div.ipi-warn', {}, h('span', { text: `Egne mål – størrelsen avviker fra produktet hos ${product.store}.` }),
        h('button', { type: 'button', text: 'Bruk målene', on: { click: () => {
          const g = gridOf(cur());
          const res = ins._fit(uid, { dims: gridSpec({ w: ref.w, d: ref.d, h: ref.h }, g).dims });
          if (res.status !== 'blocked') ins._apply(res.patch, { label: `Tilbakestill størrelse på ${item.name}` });
          ins._render();
        } } })));
    }
  }
  return section('Størrelse', ...kids);
}

/**
 * The Inspector extension for rows and grids of ceiling fittings.
 * @returns {object}
 */
export function gridExtension() {
  return {
    sections: {
      afterLight: (ins, item, product) => gridSection(ins, item, product),
      size: (ins, item, product, def) => gridSizeSection(ins, item, product, def),
    },
    carry: (ins, item, spec) => {
      const c = carryGrid(item, spec);
      return c ? { ...spec, params: { ...(spec.params || {}), ...c.params }, dims: c.dims } : spec;
    },
  };
}

/**
 * Catalogue detail button «Legg inn flere (rekke/rutenett) …» on gridable products: starts placing a 2 × 3 grid at the
 * archetype's default spacing (rows, count and spacing are changed afterwards in «Antall og rutenett»).
 * @param {import('../../design/Editor.js').Editor} editor
 */
export function gridCatalogAction(editor) {
  return ({ panel, product, vi }) => {
    if (!product || !GRIDABLE.has(product.archetype) || product.mount !== 'ceiling') return null;
    return button({
      label: 'Legg inn flere (rekke/rutenett) …',
      variant: 'ghost',
      title: 'Plasser 2 × 3 spotter som ett rutenett – antall, rader og avstand endrer du etterpå',
      onClick: () => {
        const cat = panel?.cat ?? editor.catalog;
        const spec = cat?.productToItemSpec?.(product, vi);
        if (!spec?.dims) return;
        const s = GRID_DEFAULT_SPACING[spec.archetype] ?? 1.2;
        const g = gridSpec({ ...spec.dims }, { rows: 2, cols: 3, dx: s, dz: s });
        const grid = { ...spec, params: { ...(spec.params || {}), ...g.params }, dims: g.dims };
        editor.ui?.toolbar?.exitCompare?.({ quiet: true });
        panel?.close?.();
        editor.startPlacing(grid);
      },
    });
  };
}
