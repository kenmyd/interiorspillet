import { h, svg } from './dom.js';
import { ICONS } from './icons.js';
import { Dialog } from './Dialog.js';
import { DESKTOP_SCHEMES, TOUCH_LAYOUTS, desktopScheme, getControls, buildRows, schemeArt } from './controlsHelp.js';
import { device, inputMode } from '../core/Device.js';
import { TOUCH_ICONS } from './TouchControls.js';

/**
 * «Slik styrer du» – how to play on this device, and the choice between the ways to play.
 *
 * CONTRACT:
 *   buildSchemeChooser(settings, { intro }) → { el, dispose() }   the chooser, also the pause menu's «Styring» view
 *   new ControlsIntro(uiRoot, { settings, onClose })               the popup (a Dialog) – opens at once
 *   close() · closed
 *
 * Game opens the popup when the game starts from the start screen (settings.showHelpOnStart – «Ikke vis igjen» turns
 * it off), from «Bytt styring» in the help panel (H) and the pause menu has the same chooser as a view.
 * What it shows depends on the device (Device.js): a PC offers «Mus», «Tastatur (A/D snur)» and «Touchpad»
 * (settings.controlScheme – a laptop without a mouse cannot be detected, so it asks), a phone / tablet the touch
 * layouts «Joystick + dra for å se», «To joysticker» and «Trykk for å gå dit» (settings.touchLayout), a PC with a
 * touch screen both. Below the cards: how the chosen way works (the HUD help's rows, controlsHelp.js) – for the mouse
 * also «Hold høyre knapp» / «Låst mus» (settings.mouseMode). Every choice is saved at once.
 */

const CSS = `
.kci { display: grid; gap: 1em; }
.kci-wrap { display: grid; gap: 1.1em; }
.kci-device { display: flex; align-items: center; gap: 0.7em; margin: 0; color: var(--kv-ink-2); font-size: 0.92em; line-height: 1.4; }
.kci-device__chip { display: inline-flex; align-items: center; gap: 0.4em; flex: none; padding: 0.3em 0.75em 0.3em 0.5em;
  border-radius: 2em; background: rgba(255, 181, 46, 0.14); color: var(--kv-accent); font-weight: 700; }
.kci-device__chip .kv-icon { width: 1.15em; height: 1.15em; }
.kci-group h3 { margin: 0 0 0.55em; font-size: 0.74em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; color: var(--kv-accent); }
.kci-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6em; }
.kci-card { position: relative; display: grid; grid-template-rows: auto auto 1fr; gap: 0.3em; padding: 0.7em 0.8em 0.8em;
  border-radius: var(--kv-r); border: 1px solid var(--kv-line-2); background: var(--kv-surface); cursor: pointer;
  transition: border-color 0.15s, background 0.15s; }
.kci-card:hover { border-color: rgba(255, 255, 255, 0.3); }
.kci-card input { position: absolute; opacity: 0; pointer-events: none; }
.kci-card.is-checked { border-color: var(--kv-accent); background: rgba(255, 181, 46, 0.09); box-shadow: inset 0 0 0 1px var(--kv-accent); }
.kci-card input:focus-visible ~ .kci-card__title { outline: 2px solid var(--kv-accent); outline-offset: 2px; }
.kci-card .kv-scheme-art { width: 100%; height: 4.6em; }
.kci-card.is-checked .kv-scheme-art { color: var(--kv-ink); }
.kci-card__title { font-weight: 700; display: flex; align-items: center; gap: 0.4em; }
.kci-card__title .kv-icon { width: 1.05em; height: 1.05em; color: var(--kv-accent); visibility: hidden; }
.kci-card.is-checked .kci-card__title .kv-icon { visibility: visible; }
.kci-card__desc { font-size: 0.82em; color: var(--kv-ink-3); line-height: 1.35; }
.kci-how { padding: 0.85em 1em; border-radius: var(--kv-r); background: rgba(0, 0, 0, 0.22); border: 1px solid var(--kv-line); }
.kci-how h3 { margin: 0 0 0.65em; font-size: 0.9em; }
.kci-how .kv-ctl-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5em 1.4em; }
.kci-how .kv-ctl { gap: 0.6em; }
.kci-how .kv-key, .kci-how .kv-mousekey { font-size: 0.78em; }
.kci-how .kv-ctl__text { font-size: 0.88em; }
.kci-mode { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em; margin-top: 0.8em; font-size: 0.86em; color: var(--kv-ink-3); }
.kci-mode button { height: 2.1em; padding: 0 0.8em; border-radius: 2em; border: 1px solid var(--kv-line-2); background: transparent; color: var(--kv-ink-2); font-weight: 600; }
.kci-mode button.is-on { background: var(--kv-accent); border-color: transparent; color: var(--kv-accent-ink); }
.kci-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.8em 1.2em; }
.kci-foot__where { flex: 1 1 18em; margin: 0; font-size: 0.82em; color: var(--kv-ink-3); }
.kci-foot__actions { display: flex; align-items: center; gap: 1em; margin-left: auto; }
.kci-start { background: var(--kv-accent); border-color: transparent; color: var(--kv-accent-ink); padding: 0 1.4em; }
.kci-start:hover { background: var(--kv-accent); filter: brightness(1.08); border-color: transparent; }
.kci-check { display: inline-flex; align-items: center; gap: 0.5em; cursor: pointer; font-size: 0.9em; color: var(--kv-ink-2); }
.kci-check input { width: 1.15em; height: 1.15em; accent-color: var(--kv-accent); margin: 0; }
.kci-host { position: absolute; inset: 0; z-index: 45; pointer-events: none; }
.kci-host .kv-dialog__panel { width: min(54em, 100%); }
@media (max-width: 640px) {
  .kci-cards, .kci-how .kv-ctl-list { grid-template-columns: 1fr; }
}
@media (max-height: 540px) {
  /* phones held sideways: less text on the cards so the choice and the buttons fit */
  .kci-card__desc { display: none; }
  .kci-card .kv-scheme-art { height: 3.2em; }
  .kci-host .kv-dialog { padding: 0.6em; }
  .kci-host .kv-dialog__head { padding: 0.6em 1em; }
  .kci-host .kv-dialog__body { padding: 0.8em 1em 1em; }
}
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('kci-css');
  if (!el) {
    el = document.createElement('style');
    el.id = 'kci-css';
    document.head.append(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

const DEVICE_HINTS = {
  pc: 'En bærbar uten mus kan ikke oppdages automatisk – har du ikke mus, velg «Tastatur» eller «Touchpad».',
  'touch-pc': 'Du kan bruke fingeren på skjermen og musa om hverandre – kontrollene bytter av seg selv.',
  phone: 'Hold telefonen liggende. Med tilkoblet mus eller tastatur bytter spillet selv.',
  tablet: 'Bruk fingeren – eller koble til mus og tastatur, så bytter spillet selv.',
};

/**
 * @param {import('../core/Settings.js').Settings} settings
 * @param {object} [o]
 * @param {boolean} [o.intro=false]  the popup's version: with «Ikke vis igjen» (the footer is added by ControlsIntro)
 * @returns {{ el: HTMLElement, dispose: () => void }}
 */
export function buildSchemeChooser(settings, { intro = false } = {}) {
  injectCss();
  const kind = device.kind;
  const groups = [];
  if (kind !== 'phone' && kind !== 'tablet') groups.push({ family: 'desktop', key: 'controlScheme', title: kind === 'touch-pc' ? 'Med mus, tastatur eller touchpad' : 'Velg hvordan du vil styre', options: DESKTOP_SCHEMES });
  if (device.touch) groups.push({ family: 'touch', key: 'touchLayout', title: kind === 'touch-pc' ? 'Med fingeren på skjermen' : 'Velg hvordan du vil styre', options: TOUCH_LAYOUTS });
  // which group the «Slik gjør du» box explains: the one in use now, then the last one picked
  let family = groups.length === 1 ? groups[0].family : inputMode.touch ? 'touch' : 'desktop';

  const deviceIcon = kind === 'phone' || kind === 'tablet' ? TOUCH_ICONS.phone : ICONS.monitor;
  const deviceLine = h('p.kci-device', {},
    h('span.kci-device__chip', {}, svg(deviceIcon), h('span', { text: device.label })),
    h('span', { text: DEVICE_HINTS[kind] }),
  );

  const cards = [];
  const groupEls = groups.map((g) => {
    const name = `kci-${g.key}-${Math.random().toString(36).slice(2, 7)}`;
    const els = g.options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        family = g.family;
        settings.set(g.key, o.value);
        refresh();
      });
      const el = h('label.kci-card', {}, input, schemeArt(o.value),
        h('span.kci-card__title', {}, svg(ICONS.check), h('span', { text: o.label })),
        h('span.kci-card__desc', { text: o.desc }));
      el.addEventListener('click', () => {
        // the card that is already chosen fires no 'change': still move the explanation to its group
        if (current(g) !== o.value || family === g.family) return;
        family = g.family;
        refresh();
      });
      cards.push({ g, o, input, el });
      return el;
    });
    return h('section.kci-group', {}, h('h3', { text: g.title }), h('div.kci-cards', { role: 'radiogroup', 'aria-label': g.title }, els));
  });

  const howTitle = h('h3');
  const howRows = h('div');
  const modeBtns = [
    { value: 'wow', label: 'Hold høyre knapp for å se' },
    { value: 'fps', label: 'Låst mus (FPS)' },
  ].map((m) => {
    const b = h('button', { type: 'button', text: m.label, on: { click: () => settings.set('mouseMode', m.value) } });
    return { m, b };
  });
  const mode = h('div.kci-mode', {}, h('span', { text: 'Musa:' }), modeBtns.map((x) => x.b));
  const how = h('section.kci-how', { 'aria-live': 'polite' }, howTitle, howRows, mode);

  function current(g) {
    return g.key === 'controlScheme' ? desktopScheme(settings) : settings.get('touchLayout') || 'joystick';
  }

  function refresh() {
    for (const { g, o, input, el } of cards) {
      const on = current(g) === o.value;
      input.checked = on;
      el.classList.toggle('is-checked', on);
    }
    const g = groups.find((x) => x.family === family) ?? groups[0];
    const opt = g.options.find((o) => o.value === current(g));
    howTitle.textContent = `Slik gjør du – ${opt?.label ?? ''}`;
    const touch = g.family === 'touch';
    const rows = getControls(settings, { touch }).filter((x) => x.hud).flatMap((x) => x.rows.filter((r) => r.hud));
    howRows.replaceChildren(buildRows(rows, { short: true }));
    mode.hidden = touch || desktopScheme(settings) !== 'mouse';
    for (const { m, b } of modeBtns) b.classList.toggle('is-on', (settings.get('mouseMode') === 'fps' ? 'fps' : 'wow') === m.value);
  }

  const off = settings.on('change', ({ key }) => {
    if (key === 'controlScheme' || key === 'touchLayout' || key === 'mouseMode' || key === 'turnWithKeys' || key === 'runToggle') refresh();
  });
  refresh();

  const el = h(`div.kci${intro ? '.kci--intro' : ''}`, {}, deviceLine, groupEls, how);
  return { el, dispose: () => off?.() };
}

export class ControlsIntro {
  /**
   * @param {HTMLElement} root   the UI root
   * @param {object} o
   * @param {import('../core/Settings.js').Settings} o.settings
   * @param {() => void} [o.onClose]
   */
  constructor(root, { settings, onClose }) {
    injectCss();
    this.settings = settings;
    this.onClose = onClose;
    this.closed = false;
    this.chooser = buildSchemeChooser(settings, { intro: true });

    const touch = device.primaryTouch || inputMode.touch;
    const dontShow = h('input', { type: 'checkbox', checked: !settings.get('showHelpOnStart') });
    dontShow.addEventListener('change', () => settings.set('showHelpOnStart', !dontShow.checked));
    const start = h('button.kv-btn.kci-start', { type: 'button', on: { click: () => this.close() } }, svg(ICONS.play), h('span', { text: 'Start' }));
    const foot = h('div.kci-foot', {},
      h('p.kci-foot__where', {
        text: touch
          ? 'Du finner dette igjen under Meny → Styring, og du kan bytte når som helst.'
          : 'Du finner dette igjen i hjelpen (H) og i menyen (Esc) → Styring – du kan bytte når som helst.',
      }),
      h('div.kci-foot__actions', {}, h('label.kci-check', {}, dontShow, h('span', { text: 'Ikke vis igjen' })), start),
    );

    this.host = h('div.kci-host.kv-scale');
    root.append(this.host);
    this.dialog = new Dialog(this.host, {
      title: 'Slik styrer du',
      icon: 'keyboard',
      size: 'lg',
      content: h('div.kci-wrap', {}, this.chooser.el, foot),
      onClose: () => this._closed(),
    });
    requestAnimationFrame(() => !this.closed && start.focus({ preventScroll: true }));
  }

  close() {
    this.dialog.close();
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.chooser.dispose();
    setTimeout(() => this.host.remove(), 220);
    this.onClose?.();
  }
}
