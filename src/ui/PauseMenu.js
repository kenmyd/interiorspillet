import { h, svg, bindUiSounds, trapTab, PAUSE_EVENT } from './dom.js';
import { ICONS } from './icons.js';
import { SettingsPanel } from './SettingsPanel.js';
import { buildControlsOverview } from './controlsHelp.js';

/**
 * Pause / settings menu (Esc).
 *
 * CONTRACT (used by Game.js):
 *   new PauseMenu(uiRoot, settings, { onResume, onQuit })
 *   open(), close(), isOpen
 *   dispose()
 * Settings edited here are written with settings.set(key, value); Game listens for changes.
 *
 * Views: main (Fortsett / Innstillinger / Kontroller / Avslutt), settings, controls, confirm-quit.
 * Esc handling: Input ignores keys while the game is paused, so the menu handles Esc itself: in a sub-view it
 * goes back to the main view, on the main view it resumes (onResume). The key press is stopped in the capture
 * phase, so it can never reach Input as a second 'pause' toggle (Input also ignores key presses that started
 * before it was re-enabled).
 * Tab / Shift+Tab stay inside the panel while it is open (the game canvas behind it is focusable).
 * Optional extra: pass `audio` in the third argument for UI sounds.
 *
 * Emits a DOM CustomEvent PAUSE_EVENT ('kv:pause', detail { paused }) on `root` when it opens / closes, so the
 * HUD (same root) can freeze its toast / banner timers while the game is paused without a direct reference.
 */
export class PauseMenu {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/Settings.js').Settings} settings
   * @param {object} o
   * @param {() => void} o.onResume
   * @param {() => void} o.onQuit
   * @param {object} [o.audio]
   */
  constructor(root, settings, { onResume, onQuit, audio } = {}) {
    this.root = root;
    this.settings = settings;
    this.onResume = onResume ?? (() => {});
    this.onQuit = onQuit ?? (() => {});
    this.isOpen = false;
    this.view = 'main';

    this.panel = h('div.kv-pause__panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pause' });
    this.el = h('div.kv-pause.kv-scale', { hidden: true },
      h('div.kv-pause__backdrop'),
      h('div.kv-pause__frame', {}, this.panel),
    );
    root.append(this.el);
    this._unsounds = bindUiSounds(this.el, audio);

    this._onKey = (e) => {
      if (!this.isOpen) return;
      if (trapTab(e, this.panel)) return;
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.view !== 'main') this._show('main');
      else this.onResume();
    };
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this._show('main');
    this.el.hidden = false;
    window.addEventListener('keydown', this._onKey, true);
    requestAnimationFrame(() => this.isOpen && this.el.classList.add('is-open'));
    this._emit(true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener('keydown', this._onKey, true);
    this._settingsPanel?.dispose();
    this._settingsPanel = null;
    this.el.classList.remove('is-open');
    this.el.hidden = true;
    if (document.activeElement && this.el.contains(document.activeElement)) document.activeElement.blur();
    this._emit(false);
  }

  _emit(paused) {
    this.root.dispatchEvent(new CustomEvent(PAUSE_EVENT, { detail: { paused } }));
  }

  dispose() {
    this.close();
    this._unsounds?.();
    this.el.remove();
  }

  /* ------------------------------------------------------------------ views */

  _show(view) {
    this._settingsPanel?.dispose();
    this._settingsPanel = null;
    this.view = view;
    this.panel.dataset.view = view;
    let focus = null;

    if (view === 'main') {
      const resume = this._menuBtn('play', 'Fortsett', 'Tilbake til stua', () => this.onResume(), 'primary');
      this.panel.replaceChildren(
        h('header.kv-pause__head', {},
          h('span.kv-pause__badge', {}, svg(ICONS.pause)),
          h('div', {}, h('h2.kv-pause__title', { text: 'Pause' }), h('p.kv-pause__sub', { text: 'Spillet står stille mens menyen er åpen.' })),
        ),
        h('nav.kv-pause__menu', {},
          resume,
          this._menuBtn('sliders', 'Innstillinger', 'Mus, grafikk og lyd', () => this._show('settings')),
          this._menuBtn('keyboard', 'Kontroller', 'Oversikt over taster og mus', () => this._show('controls')),
          this._menuBtn('exit', 'Avslutt til hovedmeny', 'Tilbake til startsiden', () => this._show('confirm'), 'danger'),
        ),
        h('footer.kv-pause__foot', {}, h('kbd.kv-key.kv-key--wide', { text: 'Esc' }), h('span', { text: 'fortsett spillet' })),
      );
      focus = resume;
    } else if (view === 'settings') {
      this._settingsPanel = new SettingsPanel(this.settings, { inGame: true });
      this.panel.replaceChildren(this._subHead('Innstillinger', 'sliders'), this._settingsPanel.el);
      focus = this.panel.querySelector('.kv-tab.is-active');
    } else if (view === 'controls') {
      this.panel.replaceChildren(this._subHead('Kontroller', 'keyboard'), buildControlsOverview(this.settings));
      focus = this.panel.querySelector('.kv-iconbtn');
    } else if (view === 'confirm') {
      const cancel = h('button.kv-btn', { type: 'button', on: { click: () => this._show('main') } }, h('span', { text: 'Avbryt' }));
      const quit = h('button.kv-btn.kv-btn--danger', { type: 'button', on: { click: () => this.onQuit() } }, svg(ICONS.exit), h('span', { text: 'Avslutt' }));
      this.panel.replaceChildren(
        h('div.kv-confirm', {},
          h('span.kv-confirm__icon', {}, svg(ICONS.warning)),
          h('h2.kv-confirm__title', { text: 'Avslutte til hovedmenyen?' }),
          h('p.kv-confirm__text', { text: 'Du går tilbake til startsiden. Endringer som ikke er lagret, går tapt.' }),
          h('div.kv-confirm__actions', {}, cancel, quit),
        ),
      );
      focus = cancel;
    }
    if (focus) requestAnimationFrame(() => this.isOpen && focus.focus({ preventScroll: true }));
  }

  _menuBtn(icon, title, sub, onClick, variant = '') {
    return h(`button.kv-menubtn${variant ? `.kv-menubtn--${variant}` : ''}`, { type: 'button', on: { click: onClick } },
      h('span.kv-menubtn__icon', {}, svg(ICONS[icon])),
      h('span.kv-menubtn__text', {}, h('span.kv-menubtn__title', { text: title }), h('span.kv-menubtn__sub', { text: sub })),
      h('span.kv-menubtn__chev', {}, svg(ICONS.back)),
    );
  }

  _subHead(title, icon) {
    return h('header.kv-pause__subhead', {},
      h('button.kv-iconbtn', { type: 'button', 'aria-label': 'Tilbake', title: 'Tilbake (Esc)', on: { click: () => this._show('main') } }, svg(ICONS.back)),
      h('span.kv-pause__subicon', {}, svg(ICONS[icon])),
      h('h2.kv-pause__subtitle', { text: title }),
    );
  }
}
