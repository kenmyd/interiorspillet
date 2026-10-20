import { h, svg, bindUiSounds, isTyping } from './dom.js';
import { ICONS, logoSvg } from './icons.js';
import { SettingsPanel } from './SettingsPanel.js';
import { Dialog } from './Dialog.js';

/**
 * Start screen: logo, title «Interiørspillet», subtitle, «Gå inn i stua» and «Innstillinger» over a photo of the
 * room (same look as Kraftverkspillet's main menu, without plant / character choice).
 *
 * CONTRACT (used by main.js):
 *   new Menu(uiRoot, { settings, audio, image })
 *   show(), hide(), dispose()
 *   onPlay = (mode) => {}        assigned by main.js; called once per press of the start button (or Enter) with
 *                                mode 'continue' (the primary button while a last design exists) or 'original'
 *   setContinue(info|null)       info = { name?: string } when there is a last design to continue: the primary button
 *                                (Enter) becomes «Fortsett: <navn>» (or «Fortsett siste design» for unnamed work) and a
 *                                second button «Start med stua slik den er i dag» starts fresh. null = only «Gå inn i
 *                                stua». main.js calls it before every show() (also after «Avslutt til hovedmeny»).
 * image: background photo URL relative to the page (default 'img/stue.jpg' from public/img/).
 *
 * Keyboard: Enter presses the primary button (unless another button has focus – then that button handles Enter).
 * Sets window.__ready = true once the menu is visible (screenshot tooling, tools/shot.mjs).
 * While starting (audio unlock in main.js) the panels fade and further presses are ignored; if main.js never hides
 * the menu within START_TIMEOUT the button is re-enabled.
 */

const START_TIMEOUT = 5000;

export class Menu {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {import('../core/Settings.js').Settings} o.settings
   * @param {object} [o.audio]  AudioSystem (optional UI sounds)
   * @param {string} [o.image]  background photo
   */
  constructor(root, { settings, audio, image = 'img/stue.jpg' }) {
    this.root = root;
    this.settings = settings;
    this.audio = audio;
    this.onPlay = () => {};
    this.visible = false;
    this.dialog = null;
    this._starting = false;
    this._continue = null;

    this._build(image);

    this._onKey = (e) => this._key(e);
    this._unsounds = bindUiSounds(this.el, audio);
    // browsers only allow audio after a user gesture: unlock on the first press so hover/click sounds work
    this._unlock = () => {
      try {
        Promise.resolve(audio?.unlock?.()).catch(() => {});
      } catch {
        /* audio is optional */
      }
    };
  }

  /* ------------------------------------------------------------------ public */

  show() {
    if (this.visible) return;
    this.visible = true;
    this.el.hidden = false;
    this._resetStart();
    requestAnimationFrame(() => {
      this.el.classList.add('is-visible');
      if (!this.dialog) this.playBtn.focus({ preventScroll: true });
      setTimeout(() => this.visible && (window.__ready = true), 500); // test hook for tools/shot.mjs
    });
    window.addEventListener('keydown', this._onKey);
    this.el.addEventListener('pointerdown', this._unlock, { once: true });
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    clearTimeout(this._startTimer);
    this.dialog?.close();
    window.removeEventListener('keydown', this._onKey);
    this.el.classList.remove('is-visible');
    this.el.hidden = true;
  }

  dispose() {
    this.hide();
    this._unsounds?.();
    this.el.remove();
  }

  /* ------------------------------------------------------------------ build */

  _build(image) {
    // background photo with slow zoom
    this.bg = h('div.kv-menu__bg', { style: image ? { backgroundImage: `url("${image}")` } : {} });
    const shade = h('div.kv-menu__shade');

    this.playLabel = h('span.kv-play__label', { text: 'Gå inn i stua' });
    this.playBtn = h('button.kv-play', { type: 'button', on: { click: () => this._play(this._continue ? 'continue' : 'original') } },
      h('span.kv-play__icon', {}, svg(ICONS.play), h('span.kv-play__spinner')),
      this.playLabel,
      h('kbd.kv-key.kv-key--onaccent', { text: 'Enter' }),
    );
    // «Start med stua slik den er i dag» – only while a last design can be continued (setContinue)
    this.freshBtn = h('button.kv-btn.kv-btn--ghost.kv-btn--lg.kv-start__fresh', { type: 'button', hidden: true, on: { click: () => this._play('original') } },
      svg(ICONS.home),
      h('span', { text: 'Start med stua slik den er i dag' }),
    );
    const settingsBtn = h('button.kv-btn.kv-btn--ghost.kv-btn--lg', { type: 'button', on: { click: () => this._openSettings() } },
      svg(ICONS.sliders),
      h('span', { text: 'Innstillinger' }),
    );

    const start = h('main.kv-start', {},
      h('span.kv-start__logo', { html: logoSvg(84) }),
      h('div.kv-start__eyebrow', {}, svg(ICONS.home), h('span', { text: 'Stue, spisestue og TV-stue' })),
      h('h1.kv-start__title', {}, 'Interiør', h('span', { text: 'spillet' })),
      h('p.kv-start__sub', { text: 'Stua – prøv ut interiør før du kjøper' }),
      h('div.kv-start__actions', {}, this.playBtn, this.freshBtn, settingsBtn),
    );

    const foot = h('footer.kv-menu__foot', {},
      h('span.kv-menu__hint', {}, svg(ICONS.mouse), h('span', { text: 'Hold høyre museknapp for å se deg rundt · H viser kontrollene' })),
      h('span.kv-menu__version', { text: 'Tidlig utviklingsversjon · v0.1' }),
    );

    this.el = h('div.kv-menu.kv-scale', { hidden: true },
      this.bg,
      shade,
      h('div.kv-menu__inner', {}, start, foot),
    );
    this.root.append(this.el);
  }

  /* ------------------------------------------------------------------ actions */

  /**
   * Offers «Fortsett …» as the primary (Enter) action, or only «Gå inn i stua» (null).
   * @param {{ name?: string|null }|null} info
   */
  setContinue(info) {
    this._continue = info ? { name: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : null } : null;
    this.freshBtn.hidden = !this._continue;
    if (!this._starting) this.playLabel.textContent = this._label();
    const full = this._continue?.name ? `Fortsett: ${this._continue.name}` : '';
    if (full) this.playBtn.title = full;
    else this.playBtn.removeAttribute('title');
  }

  /** Label of the primary button. */
  _label() {
    const c = this._continue;
    if (!c) return 'Gå inn i stua';
    if (!c.name) return 'Fortsett siste design';
    const n = c.name.length > 30 ? `${c.name.slice(0, 29)}…` : c.name;
    return `Fortsett: ${n}`;
  }

  /** @param {'continue'|'original'} mode */
  _play(mode = 'original') {
    // main.js awaits audio.unlock() before hiding the menu: ignore further clicks / Enter presses until then
    if (!this.visible || this._starting) return;
    this._starting = true;
    this.el.classList.add('is-starting');
    this.playBtn.setAttribute('aria-busy', 'true');
    this.playLabel.textContent = 'Starter';
    clearTimeout(this._startTimer);
    this._startTimer = setTimeout(() => this.visible && this._resetStart(), START_TIMEOUT);
    this.onPlay(mode);
  }

  /** Back to the idle state (menu shown again, or the start never happened). */
  _resetStart() {
    clearTimeout(this._startTimer);
    this._starting = false;
    this.el.classList.remove('is-starting');
    this.playBtn.removeAttribute('aria-busy');
    this.playLabel.textContent = this._label();
  }

  _openSettings() {
    this.dialog?.close();
    const panel = new SettingsPanel(this.settings);
    const dialog = new Dialog(this.el, {
      title: 'Innstillinger',
      icon: 'sliders',
      size: 'lg',
      content: panel.el,
      onClose: () => {
        panel.dispose();
        if (this.dialog === dialog) this.dialog = null;
      },
    });
    this.dialog = dialog;
  }

  _key(e) {
    if (!this.visible || this.dialog || isTyping() || e.key !== 'Enter' || e.repeat) return;
    const a = document.activeElement;
    // other focused buttons (Innstillinger …) handle their own Enter
    if (a && a !== this.playBtn && a.tagName === 'BUTTON') return;
    e.preventDefault();
    this._play(this._continue ? 'continue' : 'original');
  }
}
