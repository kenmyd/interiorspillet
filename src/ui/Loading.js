import { h, svg } from './dom.js';
import { ICONS, logoSvg } from './icons.js';
import { Settings } from '../core/Settings.js';

/**
 * Loading screen shown while the home is built.
 *
 * CONTRACT (used by main.js):
 *   new LoadingScreen(uiRoot, { settings })
 *   show({ title, subtitle, image, tips, align })   image: URL relative to the page (e.g. 'img/stue.jpg' –
 *                                     relative, so the build works from any sub-folder)
 *   setProgress(fraction 0..1, text)
 *   setError(text)
 *   hide()                             fades out and removes itself
 *
 * Extras (optional):
 *   new LoadingScreen(uiRoot, { settings })   the game's Settings (mouse mode etc. pick the right control tips).
 *                                             Without it a fresh Settings instance reads the persisted values.
 *   show({ ..., tips })                       home-specific tips mixed in between the general ones;
 *                                             default: HOME_TIPS below.
 *   show({ ..., align })                      'right' (default) | 'left': side of the text column. The photo stays
 *                                             visible on the other side.
 *
 * The screen is opaque from its very first frame (no fade-in): main.js builds the Game right after creating it,
 * which blocks the main thread, and a fade-in would show the bare page background in between. It sits on top of
 * the menu, whose background is the same photo, so the switch reads as the menu panels being replaced.
 * The bar eases towards the reported value (world building blocks the main thread in bursts, so raw values
 * arrive in jumps). Tips rotate every few seconds.
 */

/** Facts about the room shown between the control tips (default for show({ tips })). */
export const HOME_TIPS = [
  'Stua er bygget etter plantegningen og bildene du har tatt av rommet.',
  'Den høye veggen er ca. 390 × 300 cm. Målet er en etterklangstid på 0,4–0,6 s.',
  'Puter, tepper, gardiner og akustikkpaneler demper etterklangen i rommet.',
  'De store vinduene mot elva vender mot sør.',
];

/**
 * General tips; the control tips follow the player's mouse / keyboard settings.
 * @param {{ get: (key: string) => any }} [settings]
 * @returns {string[]}
 */
export function generalTips(settings) {
  const fps = settings?.get?.('mouseMode') === 'fps';
  return [
    fps
      ? 'Musen styrer kameraet. Trykk Esc for å frigjøre musen og åpne pausemenyen.'
      : 'Hold høyre museknapp inne og dra for å se deg rundt.',
    // E only opens doors – selecting is always a left click (on what the crosshair/cursor points at)
    fps ? 'Sikt på en vegg eller et møbel og venstreklikk for å velge det.' : 'Pek på en vegg eller et møbel og venstreklikk for å velge det.',
    'Trykk E (eller klikk) for å åpne og lukke dørene.',
    'Trykk H for å vise kontrollene.',
    fps ? 'Musemodus kan byttes til «Hold høyre museknapp» under Innstillinger.' : 'Esc åpner pausemenyen.',
    settings?.get?.('runToggle') ? 'Trykk Shift for å veksle mellom å gå og løpe.' : 'Hold Shift inne for å løpe.',
    'Trykk C for å huke deg ned.',
    'Synsfelt og musefølsomhet kan justeres under Innstillinger.',
  ];
}

export class LoadingScreen {
  /**
   * @param {HTMLElement} root
   * @param {object} [o]
   * @param {import('../core/Settings.js').Settings} [o.settings]
   */
  constructor(root, { settings } = {}) {
    this.root = root;
    this.settings = settings ?? readSettings();
    this.target = 0;
    this.shown = 0;
    this.text = '';
    this.failed = false;

    this.bg = h('div.kv-loading__bg');
    this.title = h('h1.kv-loading__title');
    this.subtitle = h('p.kv-loading__sub');
    this.bar = h('div.kv-progress__bar');
    this.step = h('span.kv-loading__step', { text: 'Starter' });
    this.pct = h('span.kv-loading__pct', { text: '0 %' });
    this.tipText = h('span.kv-tip__text');
    this.error = h('div.kv-loading__error', { hidden: true, role: 'alert' });

    this.el = h('div.kv-loading.kv-scale.is-visible', { 'aria-live': 'polite', 'aria-busy': 'true' },
      this.bg,
      h('div.kv-loading__shade'),
      h('div.kv-loading__brand', {}, h('span.kv-brand__logo', { html: logoSvg(40) }), h('span', { text: 'INTERIØRSPILLET' })),
      h('div.kv-loading__content', {},
        (this.eyebrow = h('div.kv-loading__eyebrow', {}, h('span.kv-spinner'), h('span', { text: 'Laster stua' }))),
        this.title,
        this.subtitle,
        h('div.kv-progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, this.bar),
        h('div.kv-loading__status', {}, this.step, this.pct),
        this.error,
      ),
      h('div.kv-loading__tip', {}, h('span.kv-tip__label', {}, svg(ICONS.bulb), h('span', { text: 'Tips' })), this.tipText),
    );
    this.progressEl = this.el.querySelector('.kv-progress');
    root.append(this.el);

    this._setTips();
    this._tipTimer = setInterval(() => this._showTip(true), 4800);
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  /**
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.subtitle]
   * @param {string} [o.image]
   * @param {string[]} [o.tips]  home-specific tips (mixed in between the general ones), default HOME_TIPS
   * @param {'left'|'right'} [o.align='right']  side of the text column
   */
  show({ title, subtitle, image, tips, align = 'right' } = {}) {
    this.el.classList.toggle('kv-loading--left', align === 'left');
    this.title.textContent = title ?? '';
    this.subtitle.textContent = subtitle ?? '';
    this.subtitle.hidden = !subtitle;
    if (image) this.bg.style.backgroundImage = `url("${image}")`;
    if (tips) this._setTips(tips);
  }

  /** @param {number} p 0..1  @param {string} [text] current step */
  setProgress(p, text) {
    if (this.failed) return;
    this.target = Math.max(this.target, Math.min(1, Math.max(0, Number(p) || 0)));
    if (text && text !== this.text) {
      this.text = text;
      this.step.textContent = text;
    }
    // render immediately as well – the next animation frame may be far away while the world builds
    this._render(Math.max(this.shown, this.target - 0.12));
  }

  /** Shows a readable error instead of the progress (and stops the tip rotation). */
  setError(text) {
    this.failed = true;
    clearInterval(this._tipTimer);
    this.el.classList.add('is-error');
    this.el.setAttribute('aria-busy', 'false');
    this.error.hidden = false;
    this.error.replaceChildren(
      svg(ICONS.warning),
      h('div', {},
        h('strong', { text: 'Noe gikk galt' }),
        h('p', { text: text || 'Ukjent feil.' }),
        h('small', { text: 'Du sendes tilbake til hovedmenyen …' }),
      ),
    );
    this.step.textContent = 'Lasting avbrutt';
    this.eyebrow.lastChild.textContent = 'Lasting feilet';
  }

  /** Fades out, then removes the element. */
  hide() {
    if (this._hiding) return;
    this._hiding = true;
    this.target = this.failed ? this.target : 1;
    this._render(this.target);
    clearInterval(this._tipTimer);
    this.el.classList.add('is-hiding');
    this.el.setAttribute('aria-busy', 'false');
    setTimeout(() => {
      cancelAnimationFrame(this._raf);
      this.el.remove();
    }, 650);
  }

  /** Builds the tip rotation: general tips with the home tips spread in between; starts with a control tip. */
  _setTips(homeTips) {
    const extra = [...(homeTips ?? HOME_TIPS)];
    const general = generalTips(this.settings);
    const list = [];
    general.forEach((t, i) => {
      list.push(t);
      if (i % 2 === 1 && extra.length) list.push(extra.shift());
    });
    list.push(...extra);
    this.tips = list;
    this._tipIndex = Math.random() < 0.5 ? 0 : 1; // first tip: one of the two mouse / select tips
    this._showTip(false);
  }

  _showTip(animate) {
    const tip = this.tips[this._tipIndex % this.tips.length];
    this._tipIndex++;
    if (!animate) {
      this.tipText.textContent = tip;
      return;
    }
    this.tipText.classList.add('is-out');
    setTimeout(() => {
      this.tipText.textContent = tip;
      this.tipText.classList.remove('is-out');
    }, 260);
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    const next = this.shown + (this.target - this.shown) * 0.12;
    this._render(Math.abs(this.target - next) < 0.001 ? this.target : next);
  }

  _render(v) {
    if (v === this.shown && this._rendered) return;
    this._rendered = true;
    this.shown = v;
    this.bar.style.transform = `scaleX(${v.toFixed(4)})`;
    const pct = Math.round(v * 100);
    if (pct !== this._pct) {
      this._pct = pct;
      this.pct.textContent = `${pct} %`;
      this.progressEl.setAttribute('aria-valuenow', String(pct));
    }
  }
}

/** Read-only snapshot of the persisted settings (used when the caller does not pass its Settings instance). */
function readSettings() {
  try {
    return new Settings();
  } catch {
    return null;
  }
}
