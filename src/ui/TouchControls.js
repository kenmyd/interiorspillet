import { h, svg } from './dom.js';
import { ICONS } from './icons.js';
import { device, inputMode } from '../core/Device.js';

/**
 * On-screen touch controls (phones, tablets, a PC's touch screen). Shown while Device.js inputMode.touch is on (Input
 * keeps it current); they feed Input through input.setVirtual / input.trigger / input.toggleRun.
 *
 * CONTRACT (used by Game.js):
 *   new TouchControls(uiRoot, { input, settings, game })
 *   update(dt)        once per frame (after input.update): shows / hides the parts, follows the toolbar's height
 *   dispose()
 *
 * Layouts (settings.touchLayout):
 *   'joystick'  a joystick bottom left walks (a short push walks slowly, the outer ring runs); a finger dragged anywhere
 *               else on the picture looks around (Input)
 *   'dual'      the same joystick + a second one bottom right that looks around (the further, the faster)
 *   'tapwalk'   no joystick: a tap on the floor walks there (Game → AutoWalk), dragging looks around
 * Always: «Bruk» (= E: the door, the chair … the crosshair points at; lit when there is something), «Hopp», «Løp»
 * (walk / run latch), top right «Hjelp» (= H) and «Meny» (pauses). While a new piece of furniture is being placed or a
 * placed one dragged: «Plasser» (at the crosshair), «Roter» (= R) and «Avbryt» (= Esc).
 * The sticks are hidden outside walking (overview / plan) and while a panel blocks the input; the buttons stay. They
 * stay above the toolbar and move aside for an open side panel (the inspector, the catalogue).
 * A phone held upright gets a hint to turn it (once per page load, «Fortsett likevel» closes it).
 */

const S = (body) =>
  `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Icons of the touch buttons (same 24 × 24 stroke style as ui/icons.js). */
export const TOUCH_ICONS = {
  hand: S('<path d="M8.5 11.5V5.2a1.6 1.6 0 0 1 3.2 0v5.6"/><path d="M11.7 10.5V4.1a1.6 1.6 0 0 1 3.2 0v6.6"/><path d="M14.9 10.9V6a1.6 1.6 0 0 1 3.2 0v7.4a7 7 0 0 1-7 7h-.6a6.4 6.4 0 0 1-5.2-2.7L3.2 14a1.6 1.6 0 0 1 2.5-2l2.8 3"/>'),
  jump: S('<path d="M12 19V6"/><path d="M6.5 11.2 12 5.6l5.5 5.6"/><path d="M5 20.5h14"/>'),
  run: S('<circle cx="14.5" cy="4.6" r="1.9"/><path d="M8.6 9.3 12 7.4l3 1.9 1.4 3 2.8 1"/><path d="m12 7.4-1.7 5.7 3.4 2.8-1.2 5"/><path d="m10.3 13.1-1.6 3.6-4.3.6"/>'),
  menu: S('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17.2h.01"/>'),
  rotate: ICONS.rotate,
  place: ICONS.check,
  cancel: ICONS.close,
  phone: S('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  finger: S('<path d="M9.5 13V5.6a1.7 1.7 0 0 1 3.4 0V12"/><path d="M12.9 11.4V10a1.7 1.7 0 0 1 3.4 0v1.6"/><path d="M16.3 11.6a1.7 1.7 0 0 1 3.4 0V15a6.5 6.5 0 0 1-6.5 6.5h-1a6 6 0 0 1-4.9-2.5l-2.6-3.7a1.7 1.7 0 0 1 2.7-2l2.1 2.4"/>'),
};

/** Look speed of the right joystick at full deflection (rad/s): sideways, up / down. */
const LOOK_RATE_X = 2.6;
const LOOK_RATE_Y = 1.7;
/** Joystick dead zone (share of the radius) and the outer ring that runs. */
const DEAD = 0.14;
const RUN_AT = 0.92;

const CSS = `
.ptc { position: absolute; inset: 0; z-index: 6; pointer-events: none; --ptc-size: clamp(92px, 23vmin, 150px);
  --ptc-bottom: 6em; --ptc-gap: max(14px, env(safe-area-inset-left)); --ptc-rgap: max(14px, env(safe-area-inset-right));
  --ptc-left: 0px; --ptc-right: 0px; }
.ptc[hidden] { display: none; }
.ptc button { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; }
.ptc-stick { position: absolute; bottom: var(--ptc-bottom); width: calc(var(--ptc-size) * 1.35); height: calc(var(--ptc-size) * 1.35);
  display: grid; place-items: center; pointer-events: auto; touch-action: none; }
.ptc-stick--move { left: calc(var(--ptc-left) + var(--ptc-gap) - var(--ptc-size) * 0.12); }
.ptc-stick--look { right: calc(var(--ptc-right) + var(--ptc-rgap) - var(--ptc-size) * 0.12); }
.ptc-stick__base { position: relative; width: var(--ptc-size); height: var(--ptc-size); border-radius: 50%;
  background: radial-gradient(circle, rgba(10, 16, 23, 0.18) 0 55%, rgba(10, 16, 23, 0.42) 56% 100%);
  border: 2px solid rgba(255, 255, 255, 0.28); box-shadow: 0 0.4em 1.4em rgba(0, 0, 0, 0.25); }
.ptc-stick__base::after { content: ''; position: absolute; inset: 8%; border-radius: 50%; border: 1px dashed rgba(255, 181, 46, 0.45); }
.ptc-stick__knob { position: absolute; left: 50%; top: 50%; width: 42%; height: 42%; margin: -21% 0 0 -21%; border-radius: 50%;
  background: rgba(233, 238, 243, 0.82); box-shadow: 0 0.2em 0.7em rgba(0, 0, 0, 0.45); transition: transform 0.12s ease-out; }
.ptc-stick.is-held .ptc-stick__knob { transition: none; background: #fff; }
.ptc-stick.is-run .ptc-stick__knob { background: var(--kv-accent, #ffb52e); }
.ptc-stick__label { position: absolute; left: 50%; bottom: -1.5em; transform: translateX(-50%); white-space: nowrap;
  font-size: 0.8em; font-weight: 600; color: rgba(255, 255, 255, 0.75); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.ptc-btn { position: absolute; display: grid; place-items: center; width: 3.6em; height: 3.6em; border-radius: 50%; padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(10, 16, 23, 0.62); color: #fff;
  box-shadow: 0 0.35em 1em rgba(0, 0, 0, 0.3); }
.ptc-btn .kv-icon { width: 1.6em; height: 1.6em; }
.ptc-btn:active, .ptc-btn.is-on { background: var(--kv-accent, #ffb52e); color: var(--kv-accent-ink, #1a1206); border-color: transparent; }
.ptc-btn__label { position: absolute; top: 100%; margin-top: 0.25em; font-size: 0.72em; font-weight: 600; white-space: nowrap;
  color: rgba(255, 255, 255, 0.85); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
.ptc-use { right: calc(var(--ptc-right) + var(--ptc-rgap)); bottom: calc(var(--ptc-bottom) + var(--ptc-size) * 0.3); width: 5em; height: 5em; }
.ptc-use .kv-icon { width: 2.1em; height: 2.1em; }
.ptc-use.is-ready { background: rgba(255, 181, 46, 0.9); color: #1a1206; border-color: transparent;
  box-shadow: 0 0 0 0.35em rgba(255, 181, 46, 0.25), 0 0.35em 1em rgba(0, 0, 0, 0.3); }
.ptc-jump { right: calc(var(--ptc-right) + var(--ptc-rgap) + 5.8em); bottom: calc(var(--ptc-bottom) + var(--ptc-size) * 0.12); }
.ptc-run { left: calc(var(--ptc-left) + var(--ptc-gap) + var(--ptc-size) * 1.12); bottom: calc(var(--ptc-bottom) + var(--ptc-size) * 0.95); width: 3em; height: 3em; }
.ptc.is-dual .ptc-use { bottom: calc(var(--ptc-bottom) + var(--ptc-size) * 1.45); width: 4em; height: 4em; }
.ptc.is-dual .ptc-jump { right: calc(var(--ptc-right) + var(--ptc-rgap) + var(--ptc-size) * 1.25); bottom: calc(var(--ptc-bottom) + var(--ptc-size) * 0.95); }
.ptc.is-tapwalk .ptc-run { left: calc(var(--ptc-left) + var(--ptc-gap)); bottom: var(--ptc-bottom); }
.ptc-top { position: absolute; top: max(0.8em, env(safe-area-inset-top)); right: calc(var(--ptc-right) + max(0.9em, env(safe-area-inset-right)));
  display: flex; gap: 0.6em; }
.ptc-top .ptc-btn { position: relative; width: 3em; height: 3em; }
.ptc-place { position: absolute; left: 50%; top: max(0.8em, env(safe-area-inset-top)); transform: translateX(-50%); display: flex; gap: 0.5em; }
.ptc-place[hidden] { display: none; }
.ptc-pill { display: inline-flex; align-items: center; gap: 0.45em; height: 2.7em; padding: 0 1em 0 0.8em; border-radius: 2em;
  border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(10, 16, 23, 0.82); color: #fff; font: inherit; font-weight: 600;
  box-shadow: 0 0.35em 1em rgba(0, 0, 0, 0.3); }
.ptc-pill .kv-icon { width: 1.3em; height: 1.3em; }
.ptc-pill--primary { background: var(--kv-accent, #ffb52e); color: var(--kv-accent-ink, #1a1206); border-color: transparent; }
.ptc-pill:active { filter: brightness(1.15); }
.ptc-tapwalk-hint { position: absolute; left: 50%; top: max(0.9em, env(safe-area-inset-top)); transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 0.5em; padding: 0.4em 0.9em 0.4em 0.6em; border-radius: 2em;
  background: rgba(10, 16, 23, 0.7); color: rgba(255, 255, 255, 0.9); font-size: 0.86em; font-weight: 600; white-space: nowrap;
  transition: opacity 0.4s; }
.ptc-tapwalk-hint .kv-icon { width: 1.4em; height: 1.4em; }
.ptc-tapwalk-hint.is-gone { opacity: 0; }
.ptc-rotate { position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 2em; pointer-events: auto;
  background: rgba(8, 12, 18, 0.9); text-align: center; touch-action: none; }
.ptc-rotate[hidden] { display: none; }
.ptc-rotate__card { display: grid; justify-items: center; gap: 0.8em; max-width: 22em; }
.ptc-rotate__icon { width: 4.5em; height: 4.5em; color: var(--kv-accent, #ffb52e); animation: ptc-turn 2.4s ease-in-out infinite; }
.ptc-rotate__icon .kv-icon { width: 100%; height: 100%; }
.ptc-rotate h2 { margin: 0; font-size: 1.4em; }
.ptc-rotate p { margin: 0; color: rgba(255, 255, 255, 0.78); line-height: 1.45; }
@keyframes ptc-turn { 0%, 25% { transform: rotate(0); } 55%, 80% { transform: rotate(-90deg); } 100% { transform: rotate(0); } }

/* the rest of the HUD while the touch controls are on */
.kv-touch .kv-helphint { display: none; }
.kv-touch .kv-prompt.is-visible { pointer-events: auto; cursor: pointer; }
.kv-touch .ipt-bar .ip-toolbtn__key { display: none; }
/* the editor's key bar (R roter, Ctrl+D …) means nothing to a finger: the touch buttons and the panels do that here
   (visibility, not display: the overview frames the room above the bar's rect) */
.kv-touch .ix-keys { visibility: hidden; }
@media (max-height: 540px), (max-width: 600px) {
  /* phones: an icon-only toolbar, so every tool fits */
  .kv-touch .ipt-bar .ip-toolbtn { min-width: 2.9em; padding: 0.55em 0.45em; }
  .kv-touch .ipt-bar .ip-toolbtn__label, .kv-touch .ipt-history .ip-toolbtn > span:not(.ip-toolbtn__key) {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .kv-touch .ipt-bar .ip-toolbtn .kv-icon { width: 1.7em; height: 1.7em; }
  .kv-touch .kv-help { top: 0.8em; transform: none; max-height: calc(100% - 1.6em); overflow: auto; }
}
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('ptc-css');
  if (!el) {
    el = document.createElement('style');
    el.id = 'ptc-css';
    document.head.append(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

/** Dead zone, then 0..1 again (keeps fine control near the centre). */
function shape(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
}

/** One joystick: a fixed base, the knob follows the finger (held with pointer capture). */
class Stick {
  /**
   * @param {string} cls   'move' | 'look'
   * @param {string} label
   * @param {(x: number, y: number, held: boolean) => void} onChange  x right +, y down +, both -1..1 (unit circle)
   */
  constructor(cls, label, onChange) {
    this.onChange = onChange;
    this.knob = h('div.ptc-stick__knob');
    this.base = h('div.ptc-stick__base', {}, this.knob);
    this.el = h(`div.ptc-stick.ptc-stick--${cls}`, { 'aria-hidden': 'true' }, this.base, h('span.ptc-stick__label', { text: label }));
    this.id = null;
    this.x = 0;
    this.y = 0;
    this._down = (e) => {
      if (this.id !== null) return;
      e.preventDefault();
      this.id = e.pointerId;
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* the moves still arrive while the finger stays on the element */
      }
      this.el.classList.add('is-held');
      this._move(e);
    };
    this._move = (e) => {
      if (e.pointerId !== this.id) return;
      const r = this.base.getBoundingClientRect();
      const rad = r.width / 2 || 1;
      let x = (e.clientX - (r.left + rad)) / rad;
      let y = (e.clientY - (r.top + rad)) / rad;
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      this._set(x, y, true);
    };
    this._up = (e) => {
      if (e.pointerId !== this.id) return;
      this.release();
    };
    this.el.addEventListener('pointerdown', this._down);
    this.el.addEventListener('pointermove', this._move);
    this.el.addEventListener('pointerup', this._up);
    this.el.addEventListener('pointercancel', this._up);
    this.el.addEventListener('lostpointercapture', this._up);
  }

  release() {
    this.id = null;
    this.el.classList.remove('is-held');
    this._set(0, 0, false);
  }

  _set(x, y, held) {
    this.x = x;
    this.y = y;
    this.knob.style.transform = `translate(${(x * 62).toFixed(1)}%, ${(y * 62).toFixed(1)}%)`;
    this.onChange(x, y, held);
  }
}

export class TouchControls {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {import('../core/Input.js').Input} o.input
   * @param {import('../core/Settings.js').Settings} o.settings
   * @param {import('../core/Game.js').Game} [o.game]   for the editor's state (placing, view), the HUD prompt, pause
   */
  constructor(root, { input, settings, game = null }) {
    injectCss();
    this.root = root;
    this.input = input;
    this.settings = settings;
    this.game = game;
    this._measureT = 0;

    this.move = new Stick('move', 'Gå', (x, y) => {
      const m = Math.hypot(x, y);
      input.setVirtual({ forward: -shape(y), right: shape(x), run: m > RUN_AT });
      this.move.el.classList.toggle('is-run', m > RUN_AT);
    });
    this.look = new Stick('look', 'Se', (x, y) => {
      // squared response: small pushes turn slowly, a full push quickly
      const sx = shape(x), sy = shape(y);
      input.setVirtual({ lookX: sx * Math.abs(sx) * LOOK_RATE_X, lookY: sy * Math.abs(sy) * LOOK_RATE_Y });
    });

    const btn = (cls, icon, label, onPress, { title = label, showLabel = true } = {}) => {
      const b = h(`button.ptc-btn.${cls}`, { type: 'button', 'aria-label': title, title }, svg(TOUCH_ICONS[icon]), showLabel ? h('span.ptc-btn__label', { text: label }) : null);
      // pointerdown, not click: a button must react while another finger holds the joystick
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress();
      });
      return b;
    };
    this.useBtn = btn('ptc-use', 'hand', 'Bruk', () => input.trigger('interact'), { title: 'Bruk (åpne døra, sett deg … det midt i bildet)' });
    this.jumpBtn = btn('ptc-jump', 'jump', 'Hopp', () => input.trigger('jump'));
    this.runBtn = btn('ptc-run', 'run', 'Løp', () => this.runBtn.classList.toggle('is-on', input.toggleRun()), { title: 'Løp av/på' });
    this.helpBtn = btn('ptc-help', 'help', 'Hjelp', () => input.trigger('help'), { showLabel: false });
    this.menuBtn = btn('ptc-menu', 'menu', 'Meny', () => input.trigger('menu'), { showLabel: false });

    const pill = (icon, label, onPress, primary = false) => {
      const b = h(`button.ptc-pill${primary ? '.ptc-pill--primary' : ''}`, { type: 'button' }, svg(TOUCH_ICONS[icon]), h('span', { text: label }));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress();
      });
      return b;
    };
    this.placeBar = h('div.ptc-place', { hidden: true },
      pill('place', 'Plasser', () => input.trigger('select'), true),
      pill('rotate', 'Roter', () => this._key('KeyR', 'r')),
      pill('cancel', 'Avbryt', () => input.trigger('pause')),
    );

    this.tapHint = h('div.ptc-tapwalk-hint', {}, svg(TOUCH_ICONS.finger), h('span', { text: 'Trykk på gulvet for å gå dit' }));

    this.el = h('div.ptc.kv-scale', { hidden: true },
      this.move.el, this.look.el, this.runBtn, this.jumpBtn, this.useBtn, this.tapHint,
      h('div.ptc-top', {}, this.helpBtn, this.menuBtn),
      this.placeBar,
    );

    // a phone held upright: a hint to turn it (once per page load)
    this.rotateEl = h('div.ptc-rotate.kv-scale', { hidden: true, role: 'dialog', 'aria-label': 'Snu telefonen' },
      h('div.ptc-rotate__card', {},
        h('span.ptc-rotate__icon', {}, svg(TOUCH_ICONS.phone)),
        h('h2', { text: 'Snu telefonen' }),
        h('p', { text: 'Spillet er laget for å holdes liggende. Da ser du mer av rommet, og kontrollene får plass.' }),
        h('button.kv-btn.kv-btn--ghost', { type: 'button', on: { click: () => this._dismissRotate() } }, h('span', { text: 'Fortsett likevel' })),
      ),
    );
    root.append(this.el, this.rotateEl);

    this._portrait = typeof matchMedia === 'function' ? matchMedia('(orientation: portrait)') : null;
    this._layout = null;
    this._offMode = inputMode.on('change', ({ touch }) => {
      if (!touch) this._releaseAll();
    });
  }

  update(dt = 0) {
    const touch = inputMode.touch;
    const g = this.game;
    const on = touch && (!g || g.running);
    if (this.el.hidden === on) this.el.hidden = !on;
    this._updateRotateHint(on);
    if (!on) return;

    const layout = this.settings.get('touchLayout') || 'joystick';
    if (layout !== this._layout) {
      this._layout = layout;
      this.el.classList.toggle('is-dual', layout === 'dual');
      this.el.classList.toggle('is-tapwalk', layout === 'tapwalk');
      this._releaseAll();
      this.tapHint.classList.remove('is-gone');
      this._tapHintT = 6;
    }

    const editor = g?.editor;
    const walking = !g || (!g.paused && !g.inputBlocked && (editor?.views?.isWalking ?? true) && !editor?.blocksGameInput?.());
    const placing = !!(editor?.placement?.isActive);
    show(this.move.el, walking && layout !== 'tapwalk');
    show(this.look.el, walking && layout === 'dual');
    show(this.runBtn, walking);
    show(this.jumpBtn, walking && !placing);
    show(this.useBtn, walking && !placing);
    show(this.placeBar, placing && !g?.paused);
    if (!walking) {
      if (this.move.id !== null) this.move.release();
      if (this.look.id !== null) this.look.release();
    }
    if (this.runBtn.classList.contains('is-on') !== !!this.input.runLatched) this.runBtn.classList.toggle('is-on', !!this.input.runLatched);
    this.useBtn.classList.toggle('is-ready', !!g?.hud?.promptShown);

    // «Trykk på gulvet …» fades after a few seconds of the tap-to-walk layout
    const tapHint = walking && layout === 'tapwalk' && this._tapHintT > 0;
    show(this.tapHint, walking && layout === 'tapwalk' && !placing);
    if (this._tapHintT > 0) this._tapHintT -= dt;
    this.tapHint.classList.toggle('is-gone', !tapHint);

    // keep the sticks above the toolbar (its height depends on the screen and the font size) and the buttons beside
    // an open side panel (on a phone the inspector would cover «Meny» and «Bruk»)
    this._measureT -= dt;
    if (this._measureT <= 0) {
      this._measureT = 0.3;
      const bar = this.root.querySelector('.ipt-bar, .ip-toolbar');
      const r = bar && bar.offsetParent !== null ? bar.getBoundingClientRect() : null;
      this._setVar('--ptc-bottom', r && r.height > 0 ? Math.max(12, window.innerHeight - r.top + 14) : 16);
      this._setVar('--ptc-left', this._panelSide('left'));
      this._setVar('--ptc-right', this._panelSide('right'));
    }
  }

  /** Width (px) an open side panel takes from the left / right edge – 0 when none, or when it covers most of it. */
  _panelSide(side) {
    const W = window.innerWidth;
    let used = 0;
    for (const p of this.root.querySelectorAll('.ip-panel.is-open')) {
      const r = p.getBoundingClientRect();
      if (r.width <= 0 || r.width > W * 0.6) continue;
      if (side === 'right' && r.right > W - 40) used = Math.max(used, W - r.left);
      if (side === 'left' && r.left < 40) used = Math.max(used, r.right);
    }
    return used;
  }

  _setVar(name, px) {
    px = Math.round(px);
    if (this._vars?.[name] === px) return;
    (this._vars ||= {})[name] = px;
    this.el.style.setProperty(name, `${px}px`);
  }

  _updateRotateHint(on) {
    const want = on && device.kind === 'phone' && !!this._portrait?.matches && !TouchControls.rotateDismissed;
    if (this.rotateEl.hidden === want) this.rotateEl.hidden = !want;
  }

  _dismissRotate() {
    TouchControls.rotateDismissed = true;
    this.rotateEl.hidden = true;
  }

  /** A key press for the editor's own shortcuts (R rotates while placing). */
  _key(code, key) {
    for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));
  }

  _releaseAll() {
    if (this.move.id !== null) this.move.release();
    if (this.look.id !== null) this.look.release();
    this.input.setVirtual({ forward: 0, right: 0, run: false, lookX: 0, lookY: 0 });
  }

  dispose() {
    this._offMode?.();
    this._releaseAll();
    this.el.remove();
    this.rotateEl.remove();
  }
}

/** Once per page load: «Fortsett likevel» on the turn-the-phone hint. */
TouchControls.rotateDismissed = false;

function show(el, visible) {
  if (el.hidden === visible) el.hidden = !visible;
}
