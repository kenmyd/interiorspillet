import { h, keycap, svg } from './dom.js';
import { ICONS } from './icons.js';

/**
 * Controls overview – one source for the in-game help panel (H), the "Kontroller" dialog on the main menu and
 * the pause menu. Texts adapt to the mouse / keyboard settings.
 *
 * Groups: Bevegelse · Mus og handlinger · Valgt møbel · Verktøy (the toolbar shortcuts, ARCHITECTURE §14).
 * The HUD help (buildControlsList) shows a compact version: the rows of the groups marked `hud` plus the tool keys
 * as a two-column key grid, so it fits a 720 px high window.
 */

/**
 * @param {import('../core/Settings.js').Settings} [settings]
 * @returns {Array<{ group: string, id: string, hud?: boolean, grid?: boolean,
 *   rows: Array<{ keys: Array<string|{mouse?:'left'|'right'|'move'|'wheel', wide?: boolean, label:string}>, sep?: string, text: string, short?: string, hud?: boolean }> }>}
 */
export function getControls(settings) {
  const fps = settings?.get?.('mouseMode') === 'fps';
  const turn = settings?.get?.('turnWithKeys');
  const runToggle = settings?.get?.('runToggle');
  return [
    {
      group: 'Bevegelse',
      id: 'move',
      hud: true,
      rows: [
        { keys: ['W', 'A', 'S', 'D'], text: turn ? 'Gå (A/D svinger)' : 'Gå', hud: true },
        { keys: [{ wide: true, label: 'Shift' }], text: runToggle ? 'Løp av/på' : 'Løp', hud: true },
        { keys: [{ wide: true, label: 'Space' }], text: 'Hopp' },
        { keys: ['C'], text: 'Huk' },
      ],
    },
    {
      group: 'Mus og handlinger',
      id: 'mouse',
      hud: true,
      rows: [
        fps
          ? { keys: [{ mouse: 'move', label: 'Mus' }], text: 'Se deg rundt', hud: true }
          : { keys: [{ mouse: 'right', label: 'Hold høyre museknapp' }], text: 'Se deg rundt', hud: true },
        { keys: [{ mouse: 'left', label: 'Venstreklikk' }], text: 'Velg møbel, vegg eller vindu (åpner egenskapene)', short: 'Velg møbel, vegg eller vindu', hud: true },
        { keys: [{ mouse: 'left', label: 'Dra valgt møbel' }], text: 'Flytt møbelet langs gulvet, veggen eller bordet', short: 'Flytt det', hud: true },
        { keys: [{ mouse: 'wheel', label: 'Musehjul' }], text: 'Zoom i oversikt og plan (høyre dra snur, Shift + høyre dra flytter)' },
        { keys: ['E'], text: 'Åpne og lukk dører' },
        { keys: ['H'], text: 'Vis/skjul hjelp' },
        { keys: [{ wide: true, label: 'Esc' }], text: 'Avbryt, lukk panelet, velg bort – ellers pause' },
      ],
    },
    {
      group: 'Valgt møbel',
      id: 'selected',
      hud: true,
      rows: [
        { keys: ['R', { wide: true, label: 'Shift+R' }], sep: '/', text: 'Roter 15° (også mens du plasserer)', short: 'Roter 15°', hud: true },
        { keys: [{ wide: true, label: 'Ctrl+D' }], text: 'Dupliser (D i oversikt og plan)' },
        { keys: [{ wide: true, label: 'Delete' }], text: 'Slett', hud: true },
        { keys: ['←', '→', '↑', '↓'], text: 'Flytt 2 cm (med Shift: 10 cm)' },
        { keys: [',', '.'], sep: '/', text: 'Bytt modell: forrige / neste i samme kategori, på samme sted' },
        { keys: [{ wide: true, label: 'Esc' }], text: 'Velg bort' },
      ],
    },
    {
      group: 'Plassere nytt',
      id: 'placing',
      rows: [
        { keys: [{ mouse: 'left', label: 'Venstreklikk' }], text: 'Plasser (Shift + klikk plasserer flere)' },
        { keys: [{ mouse: 'right', label: 'Høyreklikk' }, { wide: true, label: 'Esc' }], sep: '/', text: 'Avbryt plassering' },
        { keys: [{ mouse: 'wheel', label: 'Musehjul' }], text: 'Høyde på vegg for bilder, speil og paneler' },
        { keys: ['G'], text: 'Rutenett på 10 cm av/på' },
        { keys: [{ wide: true, label: 'Alt' }], text: 'Hold for å flytte fritt (uten å feste mot vegger og hjørner)' },
      ],
    },
    {
      group: 'Verktøy',
      id: 'tools',
      grid: true,
      rows: [
        { keys: ['K'], text: 'Katalog – møbler, lamper, tekstiler' , short: 'Katalog' },
        { keys: ['V'], text: 'Veggforslag for den høye veggen', short: 'Veggforslag' },
        { keys: ['B'], text: 'Vinduer og solskjerming', short: 'Vinduer' },
        { keys: ['L'], text: 'Lys, sol og tid på døgnet', short: 'Lys og sol' },
        { keys: [{ wide: true, label: 'Tab' }], text: 'Bytt visning: gå · oversikt · plan', short: 'Visning' },
        { keys: ['O'], text: 'Før/etter – vis stua slik den er i dag', short: 'Før/etter' },
        { keys: ['M'], text: 'Design – lagre, åpne, eksporter', short: 'Design' },
        { keys: ['I'], text: 'Handleliste med priser og lenker', short: 'Handleliste' },
        { keys: ['P'], text: 'Ta bilde (lastes ned som PNG)', short: 'Ta bilde' },
        { keys: [{ wide: true, label: 'Ctrl+Z' }, { wide: true, label: 'Ctrl+Y' }], sep: '/', text: 'Angre / gjør om', short: 'Angre / gjør om' },
        { keys: ['←', '→'], text: 'Bla i veggforslagene (når veggpanelet er åpent)', noGrid: true },
      ],
    },
  ];
}

/** Small mouse pictogram with the relevant button highlighted. */
function mouseGlyph(which) {
  const l = which === 'left' ? ' class="on"' : '';
  const r = which === 'right' ? ' class="on"' : '';
  const move = which === 'move' ? '<path class="on-stroke" d="M2 12h3M19 12h3M12 1.5v1.8"/>' : '';
  const wheel = which === 'wheel' ? '<path class="on-stroke" d="M12 5.6v2.6" stroke-width="2.6"/>' : '';
  return svg(`<svg class="kv-mouse" viewBox="0 0 24 24" aria-hidden="true">
    <path${l} d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5v1.2H12z"/>
    <path${r} d="M12 3.5a5.5 5.5 0 0 1 5.5 5.5v1.2H12z"/>
    <rect x="6.5" y="3.5" width="11" height="17" rx="5.5" fill="none"/>
    <path d="M12 3.5v6.7M6.5 10.2h11" fill="none"/>${move}${wheel}
  </svg>`);
}

function keyEl(k) {
  if (typeof k === 'string') return keycap(k);
  if (k.mouse) {
    return h('span.kv-mousekey', {}, mouseGlyph(k.mouse), h('span.kv-mousekey__label', { text: k.label }));
  }
  return keycap(k.label, { wide: k.wide });
}

function rowEl(row, { short = false } = {}) {
  const keys = h('span.kv-ctl__keys');
  row.keys.forEach((k, i) => {
    if (i > 0 && row.sep) keys.append(h('span.kv-ctl__sep', { text: row.sep }));
    keys.append(keyEl(k));
  });
  return h('li.kv-ctl', {}, keys, h('span.kv-ctl__text', { text: short && row.short ? row.short : row.text }));
}

const CSS = `
.ipk-grid { list-style: none; margin: 0.7em 0 0; padding: 0.65em 0 0; border-top: 1px solid var(--kv-line);
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.42em 0.8em; }
.ipk-grid .kv-ctl { gap: 0.5em; min-width: 0; }
.ipk-grid .kv-ctl__text { font-size: 0.84em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ipk-grid .kv-key { font-size: 0.7em; min-width: 2.1em; }
.ipk-grid .kv-key--wide { min-width: 3.1em; }
.ipk-grid .kv-ctl--wide { grid-column: 1 / -1; }
.kv-mouse .on-stroke { stroke: var(--kv-accent); }
.kv-ctl-overview .kv-ctl-overview__lists { align-content: start; gap: 1.1em 2em; }
.kv-ctl-overview .kv-ctl-list { gap: 0.45em; }
.kv-ctl-overview .kv-ctl { flex-direction: row; align-items: center; gap: 0.7em; }
.kv-ctl-overview .kv-ctl__keys { min-width: 5.6em; flex-wrap: wrap; }
.kv-ctl-overview .kv-ctl__text { font-size: 0.9em; line-height: 1.3; }
.kv-ctl-overview .kv-key, .kv-ctl-overview .kv-mousekey { font-size: 0.78em; }
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('ipk-css');
  if (!el) {
    el = document.createElement('style');
    el.id = 'ipk-css';
    document.head.append(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

/**
 * Compact list for the HUD help panel: the essential rows of movement, mouse and the selected item, then the
 * toolbar shortcuts as a key grid.
 * @param {import('../core/Settings.js').Settings} [settings]
 * @returns {HTMLElement}
 */
export function buildControlsList(settings) {
  injectCss();
  const groups = getControls(settings);
  const list = h('ul.kv-ctl-list');
  for (const g of groups) {
    if (!g.hud) continue;
    for (const r of g.rows) if (r.hud) list.append(rowEl(r, { short: true }));
  }
  const tools = groups.find((g) => g.grid);
  const grid = h('ul.ipk-grid', { 'aria-label': 'Verktøy' });
  if (tools) {
    for (const r of tools.rows) {
      if (r.noGrid) continue;
      const el = rowEl(r, { short: true });
      if (r.keys.length > 1) el.classList.add('kv-ctl--wide');
      grid.append(el);
    }
  }
  return h('div.ipk-help', {}, list, grid);
}

/** WASD cluster illustration (used in the full overview). */
function wasdCluster() {
  const k = (l, cls = '') => h(`kbd.kv-key.kv-key--big${cls}`, { text: l });
  return h('div.kv-wasd', { 'aria-hidden': 'true' },
    h('div.kv-wasd__row', {}, k('W')),
    h('div.kv-wasd__row', {}, k('A'), k('S'), k('D')),
    h('div.kv-wasd__row', {}, k('Shift', '.kv-key--wide'), k('Space', '.kv-key--space')),
  );
}

/**
 * Full controls overview (menu / pause dialog): illustration + grouped lists.
 * @param {import('../core/Settings.js').Settings} [settings]
 * @returns {HTMLElement}
 */
export function buildControlsOverview(settings) {
  injectCss();
  const fps = settings?.get?.('mouseMode') === 'fps';
  const groups = getControls(settings).map((g) =>
    h('section.kv-ctl-group', {}, h('h3.kv-ctl-group__title', { text: g.group }), h('ul.kv-ctl-list', {}, g.rows.map((r) => rowEl(r)))),
  );
  const tip = h('p.kv-ctl-tip', {},
    svg(ICONS.info),
    h('span', {
      text: fps
        ? 'Musen er låst til spillet og styrer kameraet. Trykk Esc for å frigjøre musen og åpne pausemenyen. Verktøylinja nederst har de samme verktøyene som tastene.'
        : 'Musepekeren er fri som i World of Warcraft: hold inne høyre museknapp og dra for å se deg rundt. Pek på ting og venstreklikk for å velge dem – verktøylinja nederst har alle verktøyene.',
    }),
  );
  return h('div.kv-ctl-overview', {},
    h('div.kv-ctl-overview__art', {}, wasdCluster(), h('div.kv-ctl-overview__mouse', {}, mouseGlyph(fps ? 'move' : 'right'))),
    h('div.kv-ctl-overview__lists', {}, groups),
    tip,
  );
}
