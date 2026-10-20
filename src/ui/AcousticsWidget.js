import { h, svg, fmtNumber, PAUSE_EVENT } from './dom.js';
import { ICONS } from './icons.js';
import { createPanel, section } from './panelKit.js';

/**
 * Reverberation badge (ARCHITECTURE §12): «Etterklang ≈ 0,72 s» in the bottom-left corner – green ≤ 0,60 s,
 * yellow ≤ 0,70 s, red above (target 0,4–0,6 s). It follows every design change (editor.acoustics(), cached by the
 * Editor) and briefly shows how much the last change helped («−0,04 s»). A click opens a popover with a scale, what
 * the room needs to reach the target, what changed compared with today, what absorbs sound in the room, and a short
 * Norwegian explanation of RT60.
 *
 *   new AcousticsWidget(editor) – open() / close() / toggle() / isOpen (the badge) · openDetails() / closeDetails() ·
 *   update() · dispose()
 */

const SCALE = [0.3, 1.0];
const TARGET_HI = 0.6;

const LEVEL_TEXT = {
  green: 'God etterklang for en stue',
  yellow: 'Litt rungende',
  red: 'Rungende – lyden henger igjen',
};

const CSS = `
/* above the HUD's «H Hjelp» hint (.kv-helphint, bottom-left at bottom 1.3em) – it is the only pointer back to the
   controls once the start-up help card has closed */
.ipa-corner { position: absolute; left: 1em; bottom: 3.3em; z-index: 7; pointer-events: auto; }
.ipa-corner .ip-rt { height: 2.7em; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.ipa-corner .ip-rt:hover { border-color: rgba(255, 255, 255, 0.3); background: rgba(20, 29, 40, 0.94); }
.ipa-corner .ip-rt.is-open { border-color: var(--kv-accent); }
.ipa-corner .ip-rt .kv-icon { width: 1.1em; height: 1.1em; color: var(--kv-ink-3); }
.ipa-delta { position: absolute; left: 0.6em; bottom: calc(100% + 0.45em); pointer-events: none; font-size: 0.78em; font-weight: 750; padding: 0.25em 0.6em; border-radius: 2em; opacity: 0; transform: translateY(0.4em);
  transition: opacity 0.25s, transform 0.3s var(--kv-ease-out); background: rgba(14, 21, 30, 0.9); border: 1px solid var(--kv-line-2); white-space: nowrap; }
.ipa-delta.is-on { opacity: 1; transform: none; }
.ipa-delta.is-good { color: #8be6b4; border-color: rgba(79, 214, 143, 0.4); }
.ipa-delta.is-bad { color: #ffb3aa; border-color: rgba(255, 106, 92, 0.4); }
.ip-panel.ipa-pop { top: auto; bottom: 6.7em; left: 1em; max-height: calc(100% - 7.7em); transform: translateY(0.8em); }
.ip-panel.ipa-pop.is-open { transform: none; }
.ipa-big { display: flex; align-items: baseline; gap: 0.5em; margin-bottom: 0.15em; }
.ipa-big b { font: 760 2.3em/1 var(--kv-font-display); font-variant-numeric: tabular-nums; }
.ipa-big span { color: var(--kv-ink-3); }
.ipa-level { display: inline-flex; align-items: center; gap: 0.45em; font-weight: 650; margin-bottom: 0.9em; }
.ipa-level i { width: 0.65em; height: 0.65em; border-radius: 50%; }
.ipa-level--green i { background: var(--kv-ok); } .ipa-level--yellow i { background: #ffc850; } .ipa-level--red i { background: var(--kv-danger); }
.ipa-scalebox { position: relative; padding: 1.55em 0.2em 1.5em; margin-bottom: 0.6em; }
.ipa-scale { position: relative; height: 0.7em; border-radius: 1em; background: linear-gradient(90deg,
  rgba(79, 214, 143, 0.75) 0%, rgba(79, 214, 143, 0.75) var(--g), rgba(255, 200, 80, 0.8) var(--g), rgba(255, 200, 80, 0.8) var(--y), rgba(255, 106, 92, 0.8) var(--y), rgba(255, 106, 92, 0.8) 100%); }
.ipa-scale__band { position: absolute; top: -0.3em; bottom: -0.3em; border: 2px solid rgba(255, 255, 255, 0.85); border-radius: 0.4em; }
.ipa-scale__band span { position: absolute; bottom: calc(100% + 0.2em); left: 50%; transform: translateX(-50%); font-size: 0.72em; color: var(--kv-ink-2); white-space: nowrap; }
.ipa-mark { position: absolute; top: 50%; width: 1.05em; height: 1.05em; margin: -0.525em 0 0 -0.525em; border-radius: 50%; background: #fff; box-shadow: 0 0 0 0.2em rgba(14, 21, 30, 0.9), 0 0.2em 0.6em rgba(0, 0, 0, 0.5); transition: left 0.4s var(--kv-ease-out); }
.ipa-mark span { position: absolute; bottom: calc(100% + 0.35em); left: 50%; transform: translateX(-50%); font-size: 0.72em; font-weight: 700; white-space: nowrap; }
.ipa-mark--today { width: 0.18em; height: 1.3em; margin: -0.65em 0 0 -0.09em; border-radius: 0.1em; background: var(--kv-ink-2); box-shadow: none; }
.ipa-mark--today span { color: var(--kv-ink-3); font-weight: 600; }
.ipa-ticks { position: absolute; left: 0.2em; right: 0.2em; bottom: 0; height: 1.1em; font-size: 0.7em; color: var(--kv-ink-4); font-variant-numeric: tabular-nums; }
.ipa-ticks span { position: absolute; top: 0; transform: translateX(-50%); }
.ipa-need { padding: 0.7em 0.85em; border-radius: var(--kv-r); background: var(--kv-surface); border: 1px solid var(--kv-line); font-size: 0.9em; color: var(--kv-ink-2); line-height: 1.45; margin-bottom: 1.1em; }
.ipa-need b { color: var(--kv-ink); }
.ipa-need--ok { background: rgba(79, 214, 143, 0.08); border-color: rgba(79, 214, 143, 0.25); }
.ipa-rows { display: flex; flex-direction: column; gap: 0.35em; }
.ipa-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.2em 0.8em; align-items: center; font-size: 0.88em; }
.ipa-row__label { color: var(--kv-ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ipa-row__val { font-variant-numeric: tabular-nums; font-weight: 650; }
.ipa-row__val.is-plus { color: #8be6b4; } .ipa-row__val.is-minus { color: #ffb3aa; }
.ipa-row__bar { grid-column: 1 / -1; height: 0.32em; border-radius: 1em; background: rgba(255, 255, 255, 0.07); overflow: hidden; }
.ipa-row__bar i { display: block; height: 100%; border-radius: 1em; background: var(--kv-accent); opacity: 0.75; }
.ipa-row__bar i.is-room { background: var(--kv-ink-3); }
.ipa-text { margin: 0 0 0.6em; font-size: 0.88em; line-height: 1.5; color: var(--kv-ink-2); }
.ipa-formula { font-size: 0.8em; color: var(--kv-ink-3); line-height: 1.45; margin: 0; }
.ipa-empty { font-size: 0.88em; color: var(--kv-ink-3); margin: 0; }
@media (max-width: 980px) { .ipa-corner { bottom: auto; top: 1em; } .ipa-delta { bottom: auto; top: calc(100% + 0.45em); } .ip-panel.ipa-pop { top: 4.4em; bottom: auto; } }
`;

function injectCss(id, css) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

const sec = (v) => `${fmtNumber(v, 2)} s`;
const m2 = (v, d = 1) => `${fmtNumber(v, d)} m²`;
const pct = (v) => `${((v - SCALE[0]) / (SCALE[1] - SCALE[0])) * 100}%`;
const clampScale = (v) => Math.max(SCALE[0], Math.min(SCALE[1], v));

export class AcousticsWidget {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    this.editor = editor;
    injectCss('ipa-css', CSS);
    this.dot = h('span.ip-rt__dot');
    this.text = h('span', { text: 'Etterklang …' });
    this.badge = h('button.ip-rt', {
      type: 'button',
      title: 'Etterklangstid i stua (klikk for detaljer)',
      'aria-haspopup': 'dialog',
      on: {
        // a mouse click must not leave focus on the badge (Enter/Space would toggle the popover again)
        mousedown: (e) => e.button === 0 && e.preventDefault(),
        click: (e) => {
          this.toggleDetails();
          if (e.detail > 0 && document.activeElement === this.badge) this.badge.blur();
        },
      },
    }, this.dot, this.text, svg(ICONS.info));
    this.delta = h('span.ipa-delta', { 'aria-live': 'polite' });
    this.el = h('div.ipa-corner.kv-scale', {}, this.badge, this.delta);
    editor.uiRoot.append(this.el);

    this.pop = createPanel({ id: 'acoustics', title: 'Etterklang i stua', icon: 'volume', side: 'left', width: 24, exclusive: false, className: 'ipa-pop', parent: editor.uiRoot });
    this.pop.onClose = () => this.badge.classList.remove('is-open');

    this._offs = [
      editor.design.on('change', (e) => {
        if (e?.type === 'meta') return;
        this._dirty = true;
        this._fromLoad = e?.type === 'load';
      }),
      editor.events.on('panel', ({ id, open }) => {
        if (open && id !== 'acoustics' && this.pop.isOpen) this.closeDetails();
      }),
    ];
    // the pause menu must cover everything: close the popover while paused
    this._onPause = (e) => {
      if (e?.detail?.paused && this.pop.isOpen) this.closeDetails();
    };
    editor.uiRoot.addEventListener(PAUSE_EVENT, this._onPause);
    this._dirty = true;
    this._last = null;
    this._deltaTimer = 0;
    this.isOpen = true;
  }

  /** Every frame: refreshes the badge after a design change. */
  update() {
    if (!this._dirty) return;
    this._dirty = false;
    let r;
    try {
      r = this.editor.acoustics();
    } catch (err) {
      console.warn('[acoustics] failed', err);
      return;
    }
    this.text.textContent = r.label;
    this.badge.className = `ip-rt ip-rt--${r.level}${this.pop.isOpen ? ' is-open' : ''}`;
    this.badge.title = `${r.label} – mål 0,4–0,6 s (klikk for detaljer)`;
    const prev = this._last;
    this._last = r.rt60;
    if (prev != null && !this._fromLoad && Math.abs(r.rt60 - prev) >= 0.005) this._showDelta(r.rt60 - prev);
    this._fromLoad = false;
    if (this.pop.isOpen) this._renderDetails(r);
  }

  _showDelta(d) {
    const good = d < 0;
    this.delta.textContent = `${d > 0 ? '+' : '−'}${fmtNumber(Math.abs(d), 2)} s`;
    this.delta.className = `ipa-delta is-on ${good ? 'is-good' : 'is-bad'}`;
    clearTimeout(this._deltaTimer);
    this._deltaTimer = setTimeout(() => this.delta.classList.remove('is-on'), 2800);
  }

  toggleDetails() {
    if (this.pop.isOpen) this.closeDetails();
    else this.openDetails();
  }

  openDetails() {
    let r;
    try {
      r = this.editor.acoustics();
    } catch (err) {
      console.warn('[acoustics] failed', err);
      return;
    }
    this._renderDetails(r);
    this.pop.open();
    this.badge.classList.add('is-open');
  }

  closeDetails() {
    this.pop.close();
    this.badge.classList.remove('is-open');
  }

  _renderDetails(r) {
    const body = this.pop.body;
    const scroll = body.scrollTop;
    const lo = r.target?.[0] ?? 0.4;
    const hi = r.target?.[1] ?? TARGET_HI;
    const scale = h('div.ipa-scale', { '--g': pct(TARGET_HI), '--y': pct(0.7) },
      h('div.ipa-scale__band', { style: { left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` } }, h('span', { text: `Mål ${fmtNumber(lo, 1)}–${fmtNumber(hi, 1)} s` })),
      h('div.ipa-mark.ipa-mark--today', { style: { left: pct(clampScale(r.baseline)) } }, h('span', { text: `I dag ${sec(r.baseline)}` })),
      h('div.ipa-mark', { style: { left: pct(clampScale(r.rt60)) }, title: `Nå: ${sec(r.rt60)}` }),
    );
    const ticks = h('div.ipa-ticks', { 'aria-hidden': 'true' }, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((t) => h('span', { text: fmtNumber(t, 1), style: { left: pct(t) } })));

    // how much more absorption the room needs to reach the upper target
    const k = 0.161 * r.volume;
    const need = k / hi - r.absorption;
    const needEl = need > 0.05
      ? h('div.ipa-need', {}, 'For å komme ned i ', h('b', { text: sec(hi) }), ' trenger stua ca. ', h('b', { text: m2(need) }),
        ' mer demping. Til sammenligning: et stort ullteppe ≈ 1–1,5 m², fire puter ≈ 0,5 m², gardiner foran et stort vindu ≈ 1–2 m², spilevegg på den høye veggen ≈ 5–7 m².')
      : h('div.ipa-need.ipa-need--ok', {}, 'Stua er innenfor målet. ',
        r.rt60 < lo ? 'Den er faktisk litt «død» – litt mindre demping gjør ingenting.' : 'Samtaler blir klare og rommet føles lunt.');

    const changes = (r.changes || []).slice(0, 8);
    const changeRows = changes.length
      ? h('div.ipa-rows', {}, changes.map((c) => h('div.ipa-row', {},
        h('span.ipa-row__label', { text: c.label, title: c.label }),
        h(`span.ipa-row__val${c.m2 >= 0 ? '.is-plus' : '.is-minus'}`, { text: `${c.m2 >= 0 ? '+' : '−'}${m2(Math.abs(c.m2), 2)}` }))))
      : h('p.ipa-empty', { text: 'Ingen endringer ennå – dette er stua slik den er i dag.' });

    const max = Math.max(...(r.breakdown || []).map((b) => b.m2), 1);
    const breakdown = h('div.ipa-rows', {}, (r.breakdown || []).map((b, i) => h('div.ipa-row', {},
      h('span.ipa-row__label', { text: b.label, title: b.label }),
      h('span.ipa-row__val', { text: m2(b.m2) }),
      h('span.ipa-row__bar', {}, h(`i${i === 0 ? '.is-room' : ''}`, { style: { width: `${Math.max(2, (b.m2 / max) * 100)}%` } })))));

    body.replaceChildren(
      h('div.ipa-big', {}, h('b', { text: sec(r.rt60) }), h('span', { text: `(i dag ${sec(r.baseline)})` })),
      h(`div.ipa-level.ipa-level--${r.level}`, {}, h('i'), h('span', { text: LEVEL_TEXT[r.level] || '' })),
      h('div.ipa-scalebox', {}, scale, ticks),
      needEl,
      section(changes.length ? 'Endringer fra i dag' : 'Endringer', changeRows),
      section('Dette demper lyden nå', breakdown),
      section('Hva betyr tallet?',
        h('p.ipa-text', { text: 'Etterklangstiden (RT60) er hvor lenge en lyd henger igjen i rommet før den har dødd ut. I en stue bør den ligge på 0,4–0,6 sekunder – da blir samtaler klare og rommet føles lunt. Over ca. 0,7 s oppleves rommet rungende og slitsomt, særlig med flere som snakker samtidig.' }),
        h('p.ipa-text', { text: 'Glass, gulv, gipsvegger og det høye taket kaster lyden tilbake. Myke og porøse ting tar den opp: tepper, puter og pledd, stoppede møbler, gardiner, akustikkpaneler og spilevegger med filt bak.' }),
        h('p.ipa-formula', { text: `Beregnet med Sabines formel RT60 = 0,161 · V / A, med V = ${fmtNumber(r.volume, 0)} m³ (romvolumet) og A = ${m2(r.absorption)} absorpsjon ved 500–1000 Hz. Tallet er et anslag, kalibrert slik at stua i dag gir ${sec(r.baseline)}.` }),
      ),
    );
    body.scrollTop = scroll;
  }

  open() {
    this.el.hidden = false;
    this.isOpen = true;
  }

  close() {
    this.el.hidden = true;
    this.isOpen = false;
    this.closeDetails();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  dispose() {
    this.editor.uiRoot.removeEventListener(PAUSE_EVENT, this._onPause);
    for (const off of this._offs) off?.();
    clearTimeout(this._deltaTimer);
    this.pop.dispose();
    this.el.remove();
  }
}

export default AcousticsWidget;
