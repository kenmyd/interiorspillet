import { h, svg, keycap, PAUSE_EVENT } from './dom.js';
import { ICONS } from './icons.js';
import { buildControlsList } from './controlsHelp.js';
import { TOUCH_ICONS } from './TouchControls.js';
import { inputMode } from '../core/Device.js';

/**
 * In-game HUD (DOM overlay). Never captures the mouse: everything is pointer-events: none.
 *
 * CONTRACT (used by Game.js / Interaction.js):
 *   new Hud(uiRoot, settings)
 *   setPrompt(text|null, key='E', status?)   interaction prompt near screen centre-bottom, e.g. "[E] Velg vegg";
 *                                   status = short state text after it ("Forslag 3 av 12")
 *   setCursor('default'|'pointer'|'none')  cursor style over the game canvas (WoW-mode hover feedback)
 *   setCrosshair(visible)           small centre dot (shown while the mouse is captured)
 *   showRoom(name)                  large fading room title when entering a room
 *   toast(text, seconds=3)          short message
 *   showHelp(visible, autoHideSeconds?) / toggleHelp()   controls overview panel
 *   setFps(number|null)
 *   update(dt)
 *   dispose()
 *
 * Extras:
 *   new Hud(uiRoot, settings, { placeName })   placeName: small line above the room name in the room banner
 *                                   (e.g. 'Hjemme')
 *   showRoom(name, { eyebrow })     per-call override of that small line ('' hides it). Game passes the level of the
 *                                   place: «1. etasje», «Kjeller» or «Ute» (notes/hele-huset-design.md §5.1)
 *   roomShown                       { name, eyebrow } of the last banner (null before the first), for tests / tools
 *   setPaused(bool)                 freezes the toast / room-banner / help timers (the HUD sits under the pause
 *                                   overlay, so messages would otherwise expire unseen). Called automatically when
 *                                   PauseMenu dispatches PAUSE_EVENT on the same root.
 *   promptShown                     the text of the visible prompt (null when none) – TouchControls lights «Bruk»
 *   onPromptTap = () => {}          assigned by Game: a tap on the prompt while the touch controls are on (= E)
 *   onOpenControls = () => {}       assigned by Game: «Bytt styring» in the help panel (opens «Slik styrer du»)
 * The help text follows the control scheme / touch layout and switches when the touch controls come and go
 * (Device.js inputMode); with the touch controls the prompt shows a finger instead of the E key cap.
 *
 * Most setters are called every frame, so they only touch the DOM when the value actually changes.
 */

const ROOM_TIME = 2.6; // seconds the room banner stays (incl. fades)
const MAX_TOASTS = 3;
/** Settings the help text depends on. */
const HELP_KEYS = new Set(['mouseMode', 'turnWithKeys', 'runToggle', 'controlScheme', 'touchLayout']);

const CSS = `
.kv-prompt__tap { display: none; width: 1.6em; height: 1.6em; place-items: center; border-radius: 50%;
  background: var(--kv-accent); color: var(--kv-accent-ink); }
.kv-prompt__tap .kv-icon { width: 1.1em; height: 1.1em; }
.kv-touch .kv-prompt .kv-key { display: none; }
.kv-touch .kv-prompt__tap { display: grid; }
.kv-help__foot { justify-content: space-between; }
.kv-help__footkey { display: inline-flex; align-items: center; gap: 0.5em; }
.kv-touch .kv-help__footkey { display: none; }
.kv-help__switch { pointer-events: auto; display: inline-flex; align-items: center; gap: 0.4em; height: 2.1em; padding: 0 0.75em;
  border-radius: 2em; border: 1px solid var(--kv-line-2); background: rgba(255, 255, 255, 0.06); color: var(--kv-ink);
  font: inherit; font-weight: 600; text-shadow: none; }
.kv-help__switch:hover { background: rgba(255, 255, 255, 0.12); }
.kv-help__switch .kv-icon { width: 1.1em; height: 1.1em; color: var(--kv-accent); }
.kv-help:not(.is-visible) .kv-help__switch { pointer-events: none; }
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('kv-hud-css');
  if (!el) {
    el = document.createElement('style');
    el.id = 'kv-hud-css';
    document.head.append(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/Settings.js').Settings} settings
   * @param {object} [o]
   * @param {string} [o.placeName]  shown above the room name in the room banner (e.g. 'Hjemme')
   */
  constructor(root, settings, { placeName = '' } = {}) {
    injectCss();
    this.root = root;
    this.settings = settings;
    this.placeName = placeName;
    this._prompt = { text: null, key: null };
    this._crosshair = null;
    this._cursor = null;
    this._fps = undefined;
    this._roomT = 0;
    this.roomShown = null;
    this._helpT = 0;
    this._helpTotal = 0;
    this._toasts = [];
    this.paused = false;

    // fps
    this.fpsEl = h('div.kv-fps', { hidden: true });

    // room banner
    this.roomName = h('div.kv-room__name');
    this.roomEyebrowText = h('span');
    this.roomEyebrow = h('div.kv-room__eyebrow', { hidden: true }, svg(ICONS.pin), this.roomEyebrowText);
    this.room = h('div.kv-room', { 'aria-live': 'polite' }, this.roomEyebrow, this.roomName, h('div.kv-room__rule'));

    // crosshair + prompt
    this.crosshair = h('div.kv-crosshair', { hidden: true });
    this.promptKey = keycap('E');
    this.promptTap = h('span.kv-prompt__tap', { 'aria-hidden': 'true' }, svg(TOUCH_ICONS.hand));
    this.promptText = h('span.kv-prompt__text');
    this.promptStatus = h('span.kv-prompt__status', { hidden: true });
    this.prompt = h('div.kv-prompt', {}, this.promptKey, this.promptTap, this.promptText, this.promptStatus);
    this.onPromptTap = () => {};
    this.onOpenControls = () => {};
    this.prompt.addEventListener('pointerdown', (e) => {
      if (!inputMode.touch || !this._prompt.text) return;
      e.preventDefault();
      this.onPromptTap();
    });

    // toasts
    this.toasts = h('div.kv-toasts', { 'aria-live': 'polite' });

    // help panel
    this.helpList = h('div.kv-help__list');
    this.helpBar = h('div.kv-help__timer');
    this.helpSwitch = h('button.kv-help__switch', { type: 'button', on: { click: () => this.onOpenControls() } },
      svg(ICONS.sliders), h('span', { text: 'Bytt styring' }));
    this.helpFootKey = h('span.kv-help__footkey', {}, keycap('H'), h('span', { text: 'skjuler hjelpen' }));
    this.help = h('aside.kv-help', { 'aria-hidden': 'true' },
      h('header.kv-help__head', {}, svg(ICONS.keyboard), h('span', { text: 'Kontroller' })),
      this.helpList,
      h('footer.kv-help__foot', {}, this.helpFootKey, this.helpSwitch),
      this.helpBar,
    );
    this.helpHint = h('div.kv-helphint', {}, keycap('H'), h('span', { text: 'Hjelp' }));

    this.el = h('div.kv-hud.kv-scale', {},
      this.fpsEl, this.room, this.crosshair, this.prompt, this.toasts, this.help, this.helpHint,
    );
    root.append(this.el);

    // the help text depends on the mouse / key / touch settings and on whether the touch controls are in use
    this._offSettings = settings.on?.('change', ({ key }) => {
      if (HELP_KEYS.has(key)) this._renderHelp();
    });
    this._offMode = inputMode.on('change', () => this._renderHelp());
    this._renderHelp();

    this._onPause = (e) => this.setPaused(!!e.detail?.paused);
    root.addEventListener(PAUSE_EVENT, this._onPause);
  }

  /** While paused, update(dt) does not advance any timers. */
  setPaused(paused) {
    this.paused = !!paused;
  }

  /* ------------------------------------------------------------------ prompt / cursor / crosshair */

  /** @param {string|null} text  @param {string} [key='E']  @param {string|null} [status] */
  setPrompt(text, key = 'E', status = null) {
    status = text ? status || null : null;
    if (text === this._prompt.text && key === this._prompt.key && status === this._prompt.status) return;
    this._prompt = { text, key, status };
    if (text) {
      this.promptText.textContent = text;
      this.promptKey.textContent = key;
      this.promptStatus.textContent = status ?? '';
      this.promptStatus.hidden = !status;
      this.prompt.classList.add('is-visible');
    } else {
      this.prompt.classList.remove('is-visible');
    }
    this.crosshair.classList.toggle('has-target', !!text);
  }

  /** Text of the visible prompt, or null. */
  get promptShown() {
    return this._prompt.text ?? null;
  }

  /** @param {'default'|'pointer'|'none'|string} type */
  setCursor(type) {
    if (type === this._cursor) return;
    this._cursor = type;
    const c = document.querySelector('canvas.game-canvas');
    if (c) c.style.cursor = type || 'default';
  }

  /** @param {boolean} visible */
  setCrosshair(visible) {
    visible = !!visible;
    if (visible === this._crosshair) return;
    this._crosshair = visible;
    this.crosshair.hidden = !visible;
  }

  /* ------------------------------------------------------------------ room / toast */

  /**
   * Big room title that fades in and out.
   * @param {string} name
   * @param {object} [o]
   * @param {string} [o.eyebrow]  small line above the name; default: placeName from the constructor
   */
  showRoom(name, { eyebrow = this.placeName } = {}) {
    if (!name) return;
    eyebrow = eyebrow ?? '';
    this.roomShown = { name, eyebrow };
    this.roomName.textContent = name;
    this.roomEyebrowText.textContent = eyebrow;
    this.roomEyebrow.hidden = !eyebrow;
    // one announcement for screen readers: «Gang, 1. etasje»
    this.room.setAttribute('aria-label', eyebrow ? `${name}, ${eyebrow}` : name);
    this.room.classList.remove('is-visible');
    void this.room.offsetWidth; // restart the transition
    this.room.classList.add('is-visible');
    this._roomT = ROOM_TIME;
  }

  /**
   * Short message (bottom centre). Identical messages in a row refresh the existing toast.
   * @param {string} text
   * @param {number} [seconds=3]
   */
  toast(text, seconds = 3) {
    if (!text) return;
    const same = this._toasts.find((t) => t.text === text && !t.leaving);
    if (same) {
      same.t = seconds;
      same.el.classList.remove('is-bump');
      void same.el.offsetWidth;
      same.el.classList.add('is-bump');
      return;
    }
    const el = h('div.kv-toast', {}, svg(ICONS.info), h('span', { text }));
    this.toasts.append(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    this._toasts.push({ text, el, t: seconds, leaving: false });
    while (this._toasts.filter((t) => !t.leaving).length > MAX_TOASTS) this._dropToast(this._toasts.find((t) => !t.leaving));
  }

  _dropToast(t) {
    if (!t || t.leaving) return;
    t.leaving = true;
    t.el.classList.remove('is-visible');
    t.el.classList.add('is-leaving');
    setTimeout(() => {
      t.el.remove();
      this._toasts = this._toasts.filter((x) => x !== t);
    }, 300);
  }

  /* ------------------------------------------------------------------ help */

  /**
   * @param {boolean} visible
   * @param {number} [autoHideSeconds]  hide automatically after this many seconds
   */
  showHelp(visible, autoHideSeconds) {
    this.helpVisible = !!visible;
    this.help.classList.toggle('is-visible', this.helpVisible);
    this.help.setAttribute('aria-hidden', String(!this.helpVisible));
    this.helpHint.classList.toggle('is-hidden', this.helpVisible);
    this._helpT = visible && autoHideSeconds > 0 ? autoHideSeconds : 0;
    this._helpTotal = this._helpT;
    this.helpBar.style.transform = 'scaleX(1)';
    this.help.classList.toggle('has-timer', this._helpT > 0);
  }

  toggleHelp() {
    this.showHelp(!this.helpVisible);
  }

  _renderHelp() {
    this.helpList.replaceChildren(buildControlsList(this.settings));
  }

  /* ------------------------------------------------------------------ fps */

  /** @param {number|null} fps */
  setFps(fps) {
    if (fps === null || fps === undefined || !Number.isFinite(fps)) {
      if (this._fps !== null) {
        this._fps = null;
        this.fpsEl.hidden = true;
      }
      return;
    }
    const v = Math.round(fps);
    if (v === this._fps) return;
    this._fps = v;
    this.fpsEl.hidden = false;
    this.fpsEl.textContent = `${v} FPS`;
    this.fpsEl.dataset.level = v >= 55 ? 'good' : v >= 30 ? 'ok' : 'bad';
  }

  /* ------------------------------------------------------------------ frame */

  /** @param {number} dt seconds */
  update(dt) {
    if (this.paused) return;
    if (this._roomT > 0) {
      this._roomT -= dt;
      if (this._roomT <= 0) this.room.classList.remove('is-visible');
    }
    if (this._helpT > 0) {
      this._helpT -= dt;
      this.helpBar.style.transform = `scaleX(${Math.max(0, this._helpT / this._helpTotal).toFixed(3)})`;
      if (this._helpT <= 0) this.showHelp(false);
    }
    for (const t of this._toasts) {
      if (t.leaving) continue;
      t.t -= dt;
      if (t.t <= 0) this._dropToast(t);
    }
  }

  dispose() {
    this._offSettings?.();
    this._offMode?.();
    this.root.removeEventListener(PAUSE_EVENT, this._onPause);
    this.setCursor('default');
    this.el.remove();
  }
}
