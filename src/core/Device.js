import { Emitter } from './Events.js';

/**
 * Device detection + which input family is in use right now (touch or mouse / keyboard).
 *
 * CONTRACT (used by main.js, Settings, Input, TouchControls, Hud, ControlsIntro, SettingsPanel):
 *   detectDevice(win?) → DeviceInfo     once at start-up (main.js) – see below
 *   device                              the DeviceInfo of this page (detected on first use, ?device= overrides it)
 *   deviceDefaults(info) → object       setting defaults for the device (a phone starts with quality 'low')
 *   inputMode                           Emitter: inputMode.touch (boolean) – the touch controls are shown;
 *                                       inputMode.set(bool) emits 'change' { touch } when it changes.
 *                                       Input keeps it current (see Input.js «Touch»).
 *
 * DeviceInfo { kind, touch, primaryTouch, label, coarse, hoverNone, maxTouchPoints, shortSide }
 *   kind          'phone' | 'tablet' | 'touch-pc' | 'pc'
 *   touch         the device has a touch screen at all
 *   primaryTouch  the finger is the main pointer (phone / tablet): the touch controls are on from the start
 *   label         Norwegian name for the popup («Mobil», «Nettbrett», «PC med berøringsskjerm», «PC»)
 *
 * How it decides: (pointer: coarse) + (hover: none) = the primary pointer is a finger → a phone when the short side of
 * the screen is under 600 CSS px, else a tablet. iPadOS reports itself as a Mac – a «Macintosh» with touch points is a
 * tablet. Touch points (navigator.maxTouchPoints / any-pointer: coarse) with a mouse-like primary pointer = a PC with
 * a touch screen. A laptop without a mouse cannot be told apart from one with a mouse (a touchpad is a fine pointer
 * that hovers), so the popup «Slik styrer du» asks.
 * Dev/test: ?device=phone|tablet|touch-pc|pc forces the kind (e.g. to try the touch controls in a desktop browser
 * with the device toolbar of the developer tools).
 */

const LABELS = { phone: 'Mobil', tablet: 'Nettbrett', 'touch-pc': 'PC med berøringsskjerm', pc: 'PC' };

/**
 * @param {Window} [win]
 * @returns {{ kind: 'phone'|'tablet'|'touch-pc'|'pc', touch: boolean, primaryTouch: boolean, label: string,
 *   coarse: boolean, hoverNone: boolean, maxTouchPoints: number, shortSide: number }}
 */
export function detectDevice(win = typeof window !== 'undefined' ? window : undefined) {
  const mm = (q) => {
    try {
      return !!win?.matchMedia?.(q).matches;
    } catch {
      return false;
    }
  };
  const nav = win?.navigator ?? {};
  const coarse = mm('(pointer: coarse)');
  const hoverNone = mm('(hover: none)');
  const anyCoarse = mm('(any-pointer: coarse)');
  const maxTouchPoints = Number(nav.maxTouchPoints) || 0;
  const ua = String(nav.userAgent || '');
  const iPadOS = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const touch = maxTouchPoints > 0 || anyCoarse || (!!win && 'ontouchstart' in win);
  const scr = win?.screen ?? {};
  const shortSide = Math.min(scr.width || win?.innerWidth || 0, scr.height || win?.innerHeight || 0);

  let kind;
  if (touch && ((coarse && hoverNone) || iPadOS)) kind = shortSide > 0 && shortSide < 600 && !iPadOS ? 'phone' : 'tablet';
  else if (touch) kind = 'touch-pc';
  else kind = 'pc';

  const forced = forcedKind(win);
  if (forced) kind = forced;
  const forcedTouch = forced ? forced !== 'pc' : touch;
  return {
    kind,
    touch: forcedTouch,
    primaryTouch: kind === 'phone' || kind === 'tablet',
    label: LABELS[kind],
    coarse,
    hoverNone,
    maxTouchPoints,
    shortSide,
  };
}

/** ?device=phone|tablet|touch-pc|pc (also mobil, nettbrett, touch, pc). */
function forcedKind(win) {
  try {
    const v = new URLSearchParams(win?.location?.search || '').get('device');
    if (!v) return null;
    const k = { phone: 'phone', mobil: 'phone', tablet: 'tablet', nettbrett: 'tablet', 'touch-pc': 'touch-pc', touch: 'touch-pc', pc: 'pc' }[v.trim().toLowerCase()];
    if (!k) console.warn(`[device] ?device=${v} ignored – expected phone, tablet, touch-pc or pc`);
    return k ?? null;
  } catch {
    return null;
  }
}

/** Setting defaults that depend on the device (only used when the setting was never saved). */
export function deviceDefaults(info) {
  if (info?.kind === 'phone') return { quality: 'low' };
  return {};
}

let _device = null;

/** The DeviceInfo of this page (detected once). */
export const device = new Proxy({}, {
  get(_, key) {
    _device ??= detectDevice();
    return _device[key];
  },
});

/** Replaces the detected device (tests). */
export function setDevice(info) {
  _device = info;
}

class InputMode extends Emitter {
  constructor() {
    super();
    /** The touch controls are shown (the last input was a finger, or the setting asks for touch). */
    this.touch = false;
  }

  set(touch) {
    touch = !!touch;
    if (touch === this.touch) return;
    this.touch = touch;
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('kv-touch', touch);
    this.emit('change', { touch });
  }
}

/** Which input family is in use: inputMode.touch, 'change' { touch }. */
export const inputMode = new InputMode();
