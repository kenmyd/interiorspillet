import { h, keycap, svg } from './dom.js';
import { ICONS } from './icons.js';
import { TOUCH_ICONS } from './TouchControls.js';
import { inputMode } from '../core/Device.js';

/**
 * Controls overview – one source for the in-game help panel (H), the "Kontroller" dialog on the main menu, the pause
 * menu and the popup «Slik styrer du» (ControlsIntro.js). Texts adapt to the settings: the control scheme (mouse /
 * keyboard / touchpad – settings.controlScheme), the touch layout while the touch controls are in use
 * (settings.touchLayout, Device.js inputMode.touch), the mouse mode and the key options.
 *
 * Groups: Bevegelse · Mus og handlinger (Velge og bruke / Touchpad og handlinger) · Valgt møbel · Verktøy (the toolbar
 * shortcuts, ARCHITECTURE §14); with the touch controls: Bevegelse · Fingeren og knappene · Plassere nytt.
 * The HUD help (buildControlsList) shows a compact version: the rows of the groups marked `hud` plus the tool keys
 * as a two-column key grid, so it fits a 720 px high window.
 *   buildRows(rows) → <ul>        a list of rows (key caps / mouse / touch pictograms + text), e.g. for ControlsIntro
 *   schemeArt(value) → SVGElement  the card picture of a scheme / touch layout (DESKTOP_SCHEMES, TOUCH_LAYOUTS)
 */

/**
 * The ways to play, for the popup «Slik styrer du» (ControlsIntro.js) and the settings (SettingsPanel.js).
 * DESKTOP_SCHEMES → settings.controlScheme, TOUCH_LAYOUTS → settings.touchLayout (see Settings.js / Input.js).
 */
export const DESKTOP_SCHEMES = Object.freeze([
  { value: 'mouse', label: 'Mus', desc: 'Hold høyre museknapp og dra for å se deg rundt. Klikk for å velge møbler.' },
  { value: 'keyboard', label: 'Tastatur (A/D snur)', desc: 'Uten mus: W/S går, A/D snur, Q/Z ser opp og ned, Enter velger det midt i bildet.' },
  { value: 'touchpad', label: 'Touchpad', desc: 'Uten mus: sveip med to fingre for å se deg rundt, trykk for å velge.' },
]);

export const TOUCH_LAYOUTS = Object.freeze([
  { value: 'joystick', label: 'Joystick + dra for å se', desc: 'Joysticken nede til venstre går. Dra med en finger for å se deg rundt.' },
  { value: 'dual', label: 'To joysticker', desc: 'Venstre joystick går, høyre ser deg rundt – som i mange mobilspill.' },
  { value: 'tapwalk', label: 'Trykk for å gå dit', desc: 'Trykk på gulvet, så går du dit av deg selv. Dra for å se deg rundt.' },
]);

/** The PC-side profile of the settings: 'mouse' | 'keyboard' | 'touchpad' ('auto' / 'touch' play like the mouse). */
export function desktopScheme(settings) {
  const s = settings?.get?.('controlScheme');
  return s === 'keyboard' || s === 'touchpad' ? s : 'mouse';
}

/**
 * @param {import('../core/Settings.js').Settings} [settings]
 * @param {object} [o]
 * @param {boolean} [o.touch]   the touch controls' texts (default: whether they are in use now – Device.js inputMode)
 * @returns {Array<{ group: string, id: string, hud?: boolean, grid?: boolean,
 *   rows: Array<{ keys: Array<string|{mouse?:'left'|'right'|'move'|'wheel', touch?: 'stick'|'drag'|'tap'|'two'|'button',
 *     icon?: string, wide?: boolean, label:string}>, sep?: string, text: string, short?: string, hud?: boolean }> }>}
 */
export function getControls(settings, { touch = inputMode.touch } = {}) {
  if (touch) return touchControls(settings);
  const scheme = desktopScheme(settings);
  const fps = settings?.get?.('mouseMode') === 'fps';
  const turn = settings?.get?.('turnWithKeys');
  const runToggle = settings?.get?.('runToggle');
  const keyboard = scheme === 'keyboard';
  const touchpad = scheme === 'touchpad';
  let move;
  if (keyboard) {
    move = [
      { keys: ['W', 'S'], sep: '/', text: 'Gå fram / tilbake', hud: true },
      { keys: ['A', 'D'], sep: '/', text: 'Snu deg', hud: true },
      { keys: ['Q', 'Z'], sep: '/', text: 'Se opp / ned (også Page Up / Page Down)', short: 'Se opp / ned', hud: true },
      { keys: ['←', '→'], sep: '/', text: 'Gå sidelengs (flytter valgt møbel når et møbel er valgt)', short: 'Gå sidelengs', hud: true },
      { keys: [{ wide: true, label: 'Shift' }], text: runToggle ? 'Løp av/på' : 'Løp', hud: true },
      { keys: [{ wide: true, label: 'Space' }], text: 'Hopp' },
      { keys: ['C'], text: 'Huk' },
    ];
  } else {
    move = [
      { keys: ['W', 'A', 'S', 'D'], text: turn ? 'Gå (A/D svinger)' : 'Gå', hud: true },
      { keys: [{ wide: true, label: 'Shift' }], text: runToggle ? 'Løp av/på' : 'Løp', hud: true },
      { keys: [{ wide: true, label: 'Space' }], text: 'Hopp' },
      { keys: ['C'], text: 'Huk' },
    ];
  }
  let look;
  if (keyboard) {
    look = [
      { keys: [{ wide: true, label: 'Enter' }], text: 'Velg møbelet, veggen eller vinduet midt i bildet (krysset)', short: 'Velg det midt i bildet', hud: true },
      { keys: [{ mouse: 'left', label: 'Klikk / trykk' }], text: 'Velg med musepekeren (touchpad-trykk virker også)', short: 'Velg med pekeren' },
      { keys: [{ mouse: 'left', label: 'Dra valgt møbel' }], text: 'Flytt møbelet langs gulvet, veggen eller bordet', short: 'Flytt det', hud: true },
    ];
  } else if (touchpad) {
    look = [
      { keys: [{ touch: 'two', label: 'Sveip med to fingre' }], text: 'Se deg rundt', hud: true },
      { keys: [{ mouse: 'left', label: 'Trykk' }], text: 'Velg møbel, vegg eller vindu (åpner egenskapene)', short: 'Velg møbel, vegg eller vindu', hud: true },
      { keys: [{ mouse: 'left', label: 'Klikk og dra valgt møbel' }], text: 'Flytt møbelet langs gulvet, veggen eller bordet', short: 'Flytt det', hud: true },
      { keys: [{ mouse: 'left', label: 'Klikk og dra' }], text: 'Se deg rundt (som med musa)' },
    ];
  } else {
    look = [
      fps
        ? { keys: [{ mouse: 'move', label: 'Mus' }], text: 'Se deg rundt', hud: true }
        : { keys: [{ mouse: 'right', label: 'Hold høyre museknapp' }], text: 'Se deg rundt', hud: true },
      { keys: [{ mouse: 'left', label: 'Venstreklikk' }], text: 'Velg møbel, vegg eller vindu (åpner egenskapene)', short: 'Velg møbel, vegg eller vindu', hud: true },
      { keys: [{ mouse: 'left', label: 'Dra valgt møbel' }], text: 'Flytt møbelet langs gulvet, veggen eller bordet', short: 'Flytt det', hud: true },
    ];
  }
  return [
    {
      group: 'Bevegelse',
      id: 'move',
      hud: true,
      rows: move,
    },
    {
      group: keyboard ? 'Velge og bruke' : touchpad ? 'Touchpad og handlinger' : 'Mus og handlinger',
      id: 'mouse',
      hud: true,
      rows: [
        ...look,
        { keys: [{ mouse: 'wheel', label: touchpad ? 'To fingre' : 'Musehjul' }], text: 'Zoom i oversikt og plan (høyre dra snur, Shift + høyre dra flytter)' },
        { keys: ['E'], text: 'Åpne og lukk dører, sett deg i stoler og sofaer (E eller WASD: reis deg)' },
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
        { keys: ['L'], text: 'Belysning – lampene i rommene', short: 'Belysning' },
        { keys: ['T'], text: 'Sol – tid på døgnet, dato og vær', short: 'Sol' },
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


/** The touch controls' groups (TouchControls.js, the layout in settings.touchLayout). */
function touchControls(settings) {
  const layout = settings?.get?.('touchLayout') || 'joystick';
  const move = [];
  if (layout === 'tapwalk') move.push({ keys: [{ touch: 'tap', label: 'Trykk på gulvet' }], text: 'Gå dit (går av seg selv, ringen viser hvor)', short: 'Gå dit', hud: true });
  else move.push({ keys: [{ touch: 'stick', label: 'Joystick' }], text: 'Gå – skyv helt ut for å løpe', short: 'Gå (helt ut: løp)', hud: true });
  if (layout === 'dual') move.push({ keys: [{ touch: 'stick', label: 'Høyre joystick' }], text: 'Se deg rundt (jo lenger ut, jo fortere)', short: 'Se deg rundt', hud: true });
  move.push(
    { keys: [{ touch: 'drag', label: 'Dra en finger' }], text: 'Se deg rundt', hud: layout !== 'dual' },
    { keys: [{ touch: 'button', icon: 'run', label: 'Løp' }], text: 'Løp av/på', hud: true },
    { keys: [{ touch: 'button', icon: 'jump', label: 'Hopp' }], text: 'Hopp' },
  );
  return [
    { group: 'Bevegelse', id: 'move', hud: true, rows: move },
    {
      group: 'Fingeren og knappene',
      id: 'touch',
      hud: true,
      rows: [
        { keys: [{ touch: 'tap', label: 'Trykk' }], text: 'Velg møbel, vegg eller vindu (åpner egenskapene)', short: 'Velg møbel, vegg eller vindu', hud: true },
        { keys: [{ touch: 'drag', label: 'Dra valgt møbel' }], text: 'Flytt møbelet langs gulvet, veggen eller bordet', short: 'Flytt det', hud: true },
        { keys: [{ touch: 'button', icon: 'hand', label: 'Bruk' }], text: 'Åpne dører, sett deg – det som er midt i bildet (eller trykk på teksten under krysset)', short: 'Åpne dør, sett deg', hud: true },
        { keys: [{ touch: 'button', icon: 'menu', label: 'Meny' }], text: 'Pause, innstillinger og styring', hud: true },
        { keys: [{ touch: 'button', icon: 'help', label: 'Hjelp' }], text: 'Vis/skjul hjelp' },
      ],
    },
    {
      group: 'Plassere nytt',
      id: 'placing',
      rows: [
        { keys: [{ touch: 'tap', label: 'Trykk' }], text: 'Plasser der du trykker' },
        { keys: [{ touch: 'button', icon: 'place', label: 'Plasser' }], text: 'Plasser midt i bildet' },
        { keys: [{ touch: 'button', icon: 'rotate', label: 'Roter' }], text: 'Roter 15°' },
        { keys: [{ touch: 'button', icon: 'cancel', label: 'Avbryt' }], text: 'Avbryt plassering' },
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

/** Small touch pictogram: a joystick, a finger dragging / tapping, two fingers, or one of the touch buttons. */
function touchGlyph(which, icon) {
  if (which === 'button') {
    const el = svg(TOUCH_ICONS[icon] || ICONS.info);
    el.classList.add('kv-touchbtn');
    return el;
  }
  const body = {
    stick: '<circle cx="12" cy="12" r="8.6"/><circle class="on" cx="14.6" cy="9.4" r="3.3"/>',
    drag: '<circle class="on" cx="7.5" cy="16.5" r="2.7"/><path class="on-stroke" d="M11 13l7.5-7.5M13.8 5.3h4.9v4.9"/>',
    tap: '<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="9.8" opacity="0.45"/><circle class="on" cx="12" cy="12" r="2.9"/>',
    two: '<circle class="on" cx="8.6" cy="15" r="2.4"/><circle class="on" cx="15.4" cy="15" r="2.4"/><path class="on-stroke" d="M12 10V3.2M9.6 5.4 12 3l2.4 2.4"/>',
  }[which] || '';
  return svg(`<svg class="kv-mouse kv-touchglyph" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`);
}

function keyEl(k) {
  if (typeof k === 'string') return keycap(k);
  if (k.mouse) {
    return h('span.kv-mousekey', {}, mouseGlyph(k.mouse), h('span.kv-mousekey__label', { text: k.label }));
  }
  if (k.touch) {
    return h('span.kv-mousekey.kv-mousekey--touch', {}, touchGlyph(k.touch, k.icon), h('span.kv-mousekey__label', { text: k.label }));
  }
  return keycap(k.label, { wide: k.wide });
}

/**
 * A plain list of rows (getControls' row format).
 * @param {Array<object>} rows
 * @param {{ short?: boolean }} [o]
 * @returns {HTMLElement}
 */
export function buildRows(rows, { short = false } = {}) {
  injectCss();
  return h('ul.kv-ctl-list', {}, rows.map((r) => rowEl(r, { short })));
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
.kv-touchglyph circle { fill: none; }
.kv-touchglyph circle.on { fill: var(--kv-accent); stroke: var(--kv-accent); }
.kv-mousekey .kv-touchbtn { width: 1.35em; height: 1.35em; flex: none; padding: 0.12em; border-radius: 50%;
  background: rgba(255, 181, 46, 0.18); color: var(--kv-accent); }
.ipk-touchnote { margin: 0.7em 0 0; padding-top: 0.6em; border-top: 1px solid var(--kv-line); font-size: 0.82em; color: var(--kv-ink-3); }
.kv-ctl-overview__art .kv-scheme-art { width: 9.5em; height: auto; }
.kv-scheme-art { color: var(--kv-ink-2); }
.kv-scheme-art .acc { stroke: var(--kv-accent); }
.kv-scheme-art .accfill { fill: var(--kv-accent); stroke: none; }
.kv-scheme-art text { fill: currentColor; stroke: none; font: 700 9px var(--kv-font); text-anchor: middle; }
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
  if (!tools) {
    // touch: the toolbar's buttons are tapped directly, no keys to learn
    return h('div.ipk-help', {}, list, h('p.ipk-touchnote', { text: 'Verktøyene (katalog, vegger, lys, visning …) ligger i verktøylinja nederst.' }));
  }
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
export function buildControlsOverview(settings, { touch = inputMode.touch } = {}) {
  injectCss();
  const fps = settings?.get?.('mouseMode') === 'fps';
  const scheme = desktopScheme(settings);
  const groups = getControls(settings, { touch }).map((g) =>
    h('section.kv-ctl-group', {}, h('h3.kv-ctl-group__title', { text: g.group }), h('ul.kv-ctl-list', {}, g.rows.map((r) => rowEl(r)))),
  );
  let text;
  if (touch) text = 'Bruk fingeren: joysticken (eller et trykk på gulvet) flytter deg, dra for å se deg rundt, trykk på ting for å velge dem. Styringen byttes under Meny → Styring.';
  else if (scheme === 'keyboard') text = 'Tastaturstyring: krysset midt i bildet er sikte – Enter velger det du ser på, E åpner dører. Musepekeren og touchpaden virker fortsatt.';
  else if (scheme === 'touchpad') text = 'Touchpad-styring: sveip med to fingre for å se deg rundt, trykk for å velge. W/A/S/D flytter deg som vanlig.';
  else if (fps) text = 'Musen er låst til spillet og styrer kameraet. Trykk Esc for å frigjøre musen og åpne pausemenyen. Verktøylinja nederst har de samme verktøyene som tastene.';
  else text = 'Musepekeren er fri som i World of Warcraft: hold inne høyre museknapp og dra for å se deg rundt. Pek på ting og venstreklikk for å velge dem – verktøylinja nederst har alle verktøyene.';
  const tip = h('p.kv-ctl-tip', {}, svg(ICONS.info), h('span', { text }));
  let art;
  if (touch) art = [schemeArt(settings?.get?.('touchLayout') || 'joystick')];
  else if (scheme === 'keyboard') art = [schemeArt('keyboard')];
  else if (scheme === 'touchpad') art = [wasdCluster(), schemeArt('touchpad')];
  else art = [wasdCluster(), h('div.kv-ctl-overview__mouse', {}, mouseGlyph(fps ? 'move' : 'right'))];
  return h('div.kv-ctl-overview', {},
    h('div.kv-ctl-overview__art', {}, art),
    h('div.kv-ctl-overview__lists', {}, groups),
    tip,
  );
}

/**
 * Card picture of a way to play (120 × 72, line drawing in the UI's colours).
 * @param {'mouse'|'keyboard'|'touchpad'|'joystick'|'dual'|'tapwalk'} value
 * @returns {SVGElement}
 */
export function schemeArt(value) {
  injectCss();
  const phone = '<rect x="6" y="9" width="108" height="54" rx="9"/><path d="M106 31v10" opacity="0.5"/>';
  const stick = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="12"/><circle class="accfill" cx="${cx + 4}" cy="${cy - 4}" r="5"/>`;
  const finger = (x, y) => `<circle class="accfill" cx="${x}" cy="${y}" r="4.2"/>`;
  const key = (x, y, t, acc = false) => `<rect x="${x}" y="${y}" width="16" height="16" rx="3"${acc ? ' class="acc"' : ''}/><text x="${x + 8}" y="${y + 11.5}">${t}</text>`;
  const body = {
    mouse: `<rect x="44" y="8" width="32" height="54" rx="16"/><path d="M60 8v20M44 28h32"/><path class="accfill" d="M60 9a15 15 0 0 1 15 15v3H60z"/>
      <path class="acc" d="M20 40a40 40 0 0 1 10-20M26 18l4 2-1 5M100 40a40 40 0 0 0-10-20M94 18l-4 2 1 5"/>`,
    keyboard: `${key(22, 10, 'Q', true)}${key(40, 10, 'W')}${key(26, 28, 'A', true)}${key(44, 28, 'S')}${key(62, 28, 'D', true)}${key(30, 46, 'Z', true)}
      ${key(86, 46, '←')}${key(102, 46, '→')}
      <path class="acc" d="M84 22a14 14 0 0 1 26 0M106 16l4 6-7 1"/>`,
    touchpad: `<rect x="22" y="10" width="76" height="50" rx="7"/><path d="M22 52h76" opacity="0.4"/>${finger(52, 36)}${finger(66, 36)}
      <path class="acc" d="M59 27V15M55 19l4-4 4 4M40 36H30M34 32l-4 4 4 4M80 36h10M86 32l4 4-4 4"/>`,
    joystick: `${phone}${stick(30, 44)}${finger(84, 30)}<path class="acc" d="M72 36l-14 6M88 24l12-8M95 15l5 1-1 5"/>`,
    dual: `${phone}${stick(30, 44)}${stick(90, 44)}`,
    tapwalk: `${phone}<ellipse class="acc" cx="74" cy="46" rx="11" ry="4"/>${finger(74, 44)}<path class="acc" d="M34 56c8-6 18-9 28-10" stroke-dasharray="3 3"/>`,
  }[value] || '';
  return svg(`<svg class="kv-scheme-art" viewBox="0 0 120 72" width="120" height="72" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
}
