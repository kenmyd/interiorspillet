import { h, svg, keycap, PAUSE_EVENT } from './dom.js';
import { ICONS } from './icons.js';
import { buildControlsList } from './controlsHelp.js';
import { COMPASS } from '../config.js';

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
 *   setHeading(yawRadians)          compass heading: bearing = yaw0Bearing − yaw (deg); yaw0Bearing defaults to
 *                                   COMPASS.yaw0Bearing (config.js: yaw 0 looks along −z = east = 90°)
 *   update(dt)
 *   dispose()
 *
 * Extras:
 *   new Hud(uiRoot, settings, { placeName, yaw0Bearing })   placeName: small line above the room name in the
 *                                   room banner (e.g. 'Hjemme'); yaw0Bearing: compass bearing at yaw 0
 *   showRoom(name, { eyebrow })     per-call override of that small line ('' hides it)
 *   setPaused(bool)                 freezes the toast / room-banner / help timers (the HUD sits under the pause
 *                                   overlay, so messages would otherwise expire unseen). Called automatically when
 *                                   PauseMenu dispatches PAUSE_EVENT on the same root.
 *
 * Most setters are called every frame, so they only touch the DOM when the value actually changes.
 */

const COMPASS_STEP = 15; // degrees between ticks
const COMPASS_EM_PER_DEG = 0.19; // strip scale (≈ 140° visible in the 27em window)
const LABELS = { 0: 'N', 45: 'NØ', 90: 'Ø', 135: 'SØ', 180: 'S', 225: 'SV', 270: 'V', 315: 'NV' };
const ROOM_TIME = 2.6; // seconds the room banner stays (incl. fades)
const MAX_TOASTS = 3;

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/Settings.js').Settings} settings
   * @param {object} [o]
   * @param {string} [o.placeName]  shown above the room name in the room banner (e.g. 'Hjemme')
   * @param {number} [o.yaw0Bearing]  compass bearing (deg) when yaw = 0 (default COMPASS.yaw0Bearing)
   */
  constructor(root, settings, { placeName = '', yaw0Bearing = COMPASS.yaw0Bearing } = {}) {
    this.root = root;
    this.settings = settings;
    this.placeName = placeName;
    this.yaw0Bearing = yaw0Bearing;
    this._prompt = { text: null, key: null };
    this._crosshair = null;
    this._cursor = null;
    this._fps = undefined;
    this._bearing = null;
    this._roomT = 0;
    this._helpT = 0;
    this._helpTotal = 0;
    this._toasts = [];
    this.paused = false;

    // compass
    this.compassStrip = h('div.kv-compass__strip');
    for (let d = -360; d <= 720; d += COMPASS_STEP) {
      const deg = ((d % 360) + 360) % 360;
      const label = LABELS[deg];
      const tick = h(`span.kv-compass__tick${label ? '.is-major' : ''}${deg === 0 ? '.is-north' : ''}`, {
        style: { left: `${d * COMPASS_EM_PER_DEG}em` },
      }, label ? h('b', { text: label }) : null);
      this.compassStrip.append(tick);
    }
    this.compassDeg = h('span.kv-compass__deg');
    this.compass = h('div.kv-compass', { 'aria-hidden': 'true' },
      h('div.kv-compass__window', {}, this.compassStrip),
      h('span.kv-compass__needle'),
      this.compassDeg,
    );

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
    this.promptText = h('span.kv-prompt__text');
    this.promptStatus = h('span.kv-prompt__status', { hidden: true });
    this.prompt = h('div.kv-prompt', {}, this.promptKey, this.promptText, this.promptStatus);

    // toasts
    this.toasts = h('div.kv-toasts', { 'aria-live': 'polite' });

    // help panel
    this.helpList = h('div.kv-help__list');
    this.helpBar = h('div.kv-help__timer');
    this.help = h('aside.kv-help', { 'aria-hidden': 'true' },
      h('header.kv-help__head', {}, svg(ICONS.keyboard), h('span', { text: 'Kontroller' })),
      this.helpList,
      h('footer.kv-help__foot', {}, keycap('H'), h('span', { text: 'skjuler hjelpen' })),
      this.helpBar,
    );
    this.helpHint = h('div.kv-helphint', {}, keycap('H'), h('span', { text: 'Hjelp' }));

    this.el = h('div.kv-hud.kv-scale', {},
      this.compass, this.fpsEl, this.room, this.crosshair, this.prompt, this.toasts, this.help, this.helpHint,
    );
    root.append(this.el);

    // the help text depends on mouse / key settings
    this._offSettings = settings.on?.('change', ({ key }) => {
      if (key === 'mouseMode' || key === 'turnWithKeys' || key === 'runToggle') this._renderHelp();
    });
    this._renderHelp();
    this.setHeading(0);

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
    this.roomName.textContent = name;
    this.roomEyebrowText.textContent = eyebrow ?? '';
    this.roomEyebrow.hidden = !eyebrow;
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

  /* ------------------------------------------------------------------ fps / compass */

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

  /** @param {number} yaw radians (camera rotation.y, + = turned left); bearing = yaw0Bearing − yaw */
  setHeading(yaw) {
    let bearing = this.yaw0Bearing - (yaw * 180) / Math.PI;
    bearing = ((bearing % 360) + 360) % 360;
    if (this._bearing !== null && Math.abs(bearing - this._bearing) < 0.05) return;
    this._bearing = bearing;
    this.compassStrip.style.transform = `translateX(${(-bearing * COMPASS_EM_PER_DEG).toFixed(3)}em)`;
    const rounded = Math.round(bearing) % 360;
    if (rounded !== this._degShown) {
      this._degShown = rounded;
      this.compassDeg.textContent = `${rounded}°`;
    }
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
    this.root.removeEventListener(PAUSE_EVENT, this._onPause);
    this.setCursor('default');
    this.el.remove();
  }
}
