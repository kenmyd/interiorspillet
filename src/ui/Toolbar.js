import { h, svg } from './dom.js';
import { ICONS } from './icons.js';
import { openPanels } from './panelKit.js';

/**
 * Toolbar along the bottom of the screen (ARCHITECTURE §12, §14) and the global shortcuts.
 *
 *   new Toolbar(editor)
 *   run(id)                    'catalog' | 'wall' | 'window' | 'light' | 'view' | 'compare' | 'saves' | 'shopping' | 'photo' | 'undo' | 'redo'
 *   compareActive              true while «Før» (the original room) is shown
 *   enterCompare() / exitCompare() / toggleCompare()
 *   takePicture() → string|null   renders the current view and downloads «huset-YYYY-MM-DD-HHMM.png»
 *   open() / close() / toggle() / isOpen / update() / dispose()
 *
 * Shortcuts (ignored while a text field has focus, the game is paused or a modal is open – editor.keysActive()):
 * K Katalog · V Veggforslag · B Vinduer · L Lys og sol · Tab Visning · O Før/etter · M Design · I Handleliste ·
 * P Bilde · Ctrl+Z angre · Ctrl+Y / Ctrl+Shift+Z gjør om · Page Up / Page Down etasje opp / ned (oversikt og plan).
 * The «Etasje» button (cycleLevel) is shown in the overview and the plan only, named after the level they show
 * (views.levelName; 'view' / 'view-level' events).
 *
 * Før/etter swaps the DesignState to the original room and back WITHOUT touching the undo history: the current
 * design (JSON) and its undo/redo stacks are kept aside, autosave is paused while the original is shown, and the
 * user's light/time settings (env) are kept on both sides so the comparison is fair. Selecting things is blocked
 * while «Før» is shown (a toast explains how to get back); tools that change the design switch back first.
 * Emits 'compare' { active } on editor.events.
 */

const S = (body) =>
  `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Toolbar icons that ui/icons.js does not have (same 24 × 24 stroke style). */
export const TOOL_ICONS = {
  catalog: ICONS.sofa,
  wall: S('<rect x="4" y="3.5" width="16" height="17" rx="1.4"/><path d="M8 3.5v17M12 3.5v17M16 3.5v17"/>'),
  window: ICONS.blinds,
  sun: S('<circle cx="12" cy="12" r="3.8"/><path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5"/>'),
  view: S('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  compare: S('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M12 2.5v19"/><path d="M8.6 9.8 6.4 12l2.2 2.2M15.4 9.8l2.2 2.2-2.2 2.2"/>'),
  folder: S('<path d="M3.5 7.4a2 2 0 0 1 2-2h3.8l2 2.1h7.2a2 2 0 0 1 2 2v8.1a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 10h17"/>'),
  bag: S('<path d="M5.2 8h13.6l-1.1 11.1a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>'),
  camera: S('<path d="M4 8.6a2 2 0 0 1 2-2h2l1.5-2.1h5L16 6.6h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.4"/>'),
  undo: S('<path d="M8.6 5.6 4.2 10l4.4 4.4"/><path d="M4.6 10H14a5.6 5.6 0 0 1 0 11.2h-3"/>'),
  redo: S('<path d="M15.4 5.6 19.8 10l-4.4 4.4"/><path d="M19.4 10H10a5.6 5.6 0 0 0 0 11.2h3"/>'),
  level: S('<path d="M3 9.2 12 4.6l9 4.6-9 4.6z"/><path d="M3 14.4l9 4.6 9-4.6"/>'),
};

const BUTTONS = [
  { id: 'catalog', label: 'Katalog', icon: 'catalog', key: 'K', code: 'KeyK', panel: 'catalog', title: 'Katalog – lenestoler, skjenker, lamper, tekstiler og akustikk' },
  { id: 'wall', label: 'Veggforslag', icon: 'wall', key: 'V', code: 'KeyV', panel: 'wall', title: 'Forslag til den høye veggen' },
  { id: 'window', label: 'Vinduer', icon: 'window', key: 'B', code: 'KeyB', panel: 'window', title: 'Vinduer og solskjerming' },
  { id: 'light', label: 'Lys og sol', icon: 'sun', key: 'L', code: 'KeyL', panel: 'light', title: 'Lys, sol og tid på døgnet' },
  { sep: true },
  { id: 'view', label: 'Visning', icon: 'view', key: 'Tab', code: 'Tab', title: 'Bytt visning: gå · oversikt · plan' },
  // shown in the overview and the plan only (§5.2): the level they show; PageUp / PageDown (handled in _key)
  { id: 'level', label: 'Etasje', icon: 'level', key: 'PgUp', title: 'Bytt etasje i oversikten og planen (Page Up / Page Down)' },
  { id: 'compare', label: 'Før/etter', icon: 'compare', key: 'O', code: 'KeyO', title: 'Før/etter – vis huset slik det er i dag' },
  { sep: true },
  { id: 'saves', label: 'Design', icon: 'folder', key: 'M', code: 'KeyM', panel: 'saves', title: 'Lagre, åpne og eksportere design' },
  { id: 'shopping', label: 'Handleliste', icon: 'bag', key: 'I', code: 'KeyI', panel: 'shopping', title: 'Handleliste med priser og lenker' },
  { id: 'photo', label: 'Bilde', icon: 'camera', key: 'P', code: 'KeyP', title: 'Ta bilde av det du ser (lastes ned som PNG)' },
];

const VIEW_LABELS = { walk: 'Gå', orbit: 'Oversikt', plan: 'Plan', photo: 'Fotovinkel' };
const VIEW_ORDER = ['walk', 'orbit', 'plan'];

/** Tools that may stay on while «Før» is shown (they do not change the furniture). */
const COMPARE_SAFE = new Set(['view', 'level', 'compare', 'photo', 'light', 'undo', 'redo']);

const CSS = `
.ipt-bar { gap: 0.15em; }
.ipt-bar .ip-toolbtn { min-width: 4.9em; }
.ipt-bar .ip-toolbtn .kv-icon { width: 1.55em; height: 1.55em; }
.ipt-bar .ip-toolbtn__key { top: 0.28em; right: 0.32em; font-size: 0.72em; letter-spacing: 0.02em; }
.ipt-bar .ip-toolbtn.is-active .ip-toolbtn__key { color: var(--kv-accent); opacity: 0.8; }
.ipt-bar .ip-toolbtn.is-on { background: var(--kv-accent); color: var(--kv-accent-ink); }
.ipt-bar .ip-toolbtn.is-on .ip-toolbtn__key { color: var(--kv-accent-ink); opacity: 0.7; }
.ipt-bar .ip-toolbtn:focus-visible { outline: 2px solid var(--kv-accent); outline-offset: -2px; }
.ipt-dots { display: flex; gap: 0.22em; height: 0.3em; margin-top: -0.05em; }
.ipt-dots i { width: 0.3em; height: 0.3em; border-radius: 50%; background: currentColor; opacity: 0.25; }
.ipt-dots i.is-on { opacity: 1; background: var(--kv-accent); }
.ipt-bar .ip-toolbtn--view { gap: 0.18em; }
.ipt-history { display: flex; gap: 0.15em; }
.ipt-history .ip-toolbtn { min-width: 5.3em; padding-top: 0.62em; }
.ipt-history .ip-toolbtn__key { font-size: 0.62em; top: 0.3em; right: 50%; transform: translateX(50%); letter-spacing: 0.04em; }
.ipt-before { position: absolute; left: 50%; top: 5.3em; z-index: 7; transform: translate(-50%, -0.6em); opacity: 0;
  display: flex; align-items: center; gap: 0.75em; padding: 0.42em 0.45em 0.42em 0.5em; pointer-events: auto;
  border-radius: 2em; background: rgba(14, 21, 30, 0.92); border: 1px solid rgba(255, 181, 46, 0.55);
  box-shadow: 0 0.6em 1.8em rgba(0, 0, 0, 0.4), 0 0 0 0.25em rgba(255, 181, 46, 0.12);
  transition: opacity 0.2s, transform 0.3s var(--kv-ease-out); }
.ipt-before.is-open { opacity: 1; transform: translate(-50%, 0); }
.ipt-before__tag { padding: 0.32em 0.8em; border-radius: 2em; background: var(--kv-accent); color: var(--kv-accent-ink);
  font: 800 0.95em/1 var(--kv-font-display); letter-spacing: 0.14em; }
.ipt-before__text { font-weight: 600; color: var(--kv-ink); white-space: nowrap; }
.ipt-before__text small { display: block; font-weight: 500; font-size: 0.8em; color: var(--kv-ink-3); }
.ipt-before .kv-btn { height: 2.2em; border-radius: 2em; }
.ipt-before .kv-key { font-size: 0.72em; margin-left: 0.2em; }
.ipt-flash { position: absolute; inset: 0; z-index: 6; pointer-events: none; background: #fff; opacity: 0; }
.ipt-flash.is-on { animation: ipt-flash 0.45s ease-out; }
@keyframes ipt-flash { 0% { opacity: 0.55; } 100% { opacity: 0; } }
@media (max-width: 1100px) { .ipt-bar .ip-toolbtn { min-width: 4.2em; padding-left: 0.4em; padding-right: 0.4em; } }
/* panelKit raises the z-index of a panel on every open (10, 11, 12 …) without a limit, so after a while panels end up
   above the pause menu (z 20) and dialogs (z 40). Keep every panel under them while they are shown. */
#ui-root:has(.kv-pause:not([hidden])) .ip-panel, #ui-root:has(.kv-dialog) .ip-panel { z-index: 9 !important; }
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

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const pad = (n) => String(n).padStart(2, '0');

/** «huset-2026-10-18-1432.png» (local time). */
export function pictureFileName(date = new Date()) {
  return `huset-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.png`;
}

/**
 * Buttons inside `root` do not take focus from a mouse click (mousedown default prevented), and a button that had
 * focus is blurred after a pointer click (event.detail > 0) – so Enter/Space never repeat the last toolbar action.
 */
function noMouseFocus(root) {
  root.addEventListener('mousedown', (e) => {
    if (e.button === 0 && e.target.closest?.('button')) e.preventDefault();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('button');
    if (b && e.detail > 0 && document.activeElement === b) b.blur();
  });
}

/** Downloads a Blob as a file (anchor + object URL). */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export class Toolbar {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    this.editor = editor;
    this.buttons = new Map();
    this.compareActive = false;
    this._cmp = null;
    this._offs = [];
    injectCss('ipt-css', CSS);

    const items = BUTTONS.map((b) => {
      if (b.sep) return h('span.ip-toolbar__sep');
      const kids = [svg(TOOL_ICONS[b.icon] || ICONS.info), h('span.ip-toolbtn__label', { text: b.label })];
      if (b.id === 'view') {
        this.viewDots = h('span.ipt-dots', { 'aria-hidden': 'true' }, VIEW_ORDER.map(() => h('i')));
        kids.push(this.viewDots);
      }
      kids.push(h('span.ip-toolbtn__key', { text: b.key }));
      const btn = h(`button.ip-toolbtn${b.id === 'view' ? '.ip-toolbtn--view' : ''}`, {
        type: 'button',
        title: b.id === 'level' ? b.title : `${b.title || b.label} (${b.key})`,
        'aria-label': b.label,
        'aria-keyshortcuts': b.key === 'Tab' ? 'Tab' : b.id === 'level' ? 'PageUp PageDown' : b.key,
        on: { click: () => this.run(b.id) },
      }, kids);
      if (b.id === 'level') btn.hidden = true;
      this.buttons.set(b.id, btn);
      return btn;
    });
    this.undoBtn = h('button.ip-toolbtn', { type: 'button', title: 'Angre (Ctrl+Z)', 'aria-keyshortcuts': 'Control+Z', on: { click: () => this.run('undo') } },
      svg(TOOL_ICONS.undo), h('span', { text: 'Angre' }), h('span.ip-toolbtn__key', { text: 'Ctrl+Z' }));
    this.redoBtn = h('button.ip-toolbtn', { type: 'button', title: 'Gjør om (Ctrl+Y)', 'aria-keyshortcuts': 'Control+Y', on: { click: () => this.run('redo') } },
      svg(TOOL_ICONS.redo), h('span', { text: 'Gjør om' }), h('span.ip-toolbtn__key', { text: 'Ctrl+Y' }));
    this.el = h('nav.ip-toolbar.ipt-bar.kv-scale', { 'aria-label': 'Verktøy' }, items, h('span.ip-toolbar__sep'), h('div.ipt-history', {}, this.undoBtn, this.redoBtn));
    editor.uiRoot.append(this.el);
    // A mouse click must not leave keyboard focus on the button: Enter/Space would run it again (an extra undo, a
    // second picture). Keyboard users (Tab) still get focus – and keep it.
    noMouseFocus(this.el);

    // «Før» badge (shown while the original room is displayed)
    this.beforeBtn = h('button.kv-btn.kv-btn--sm.ip-btn--primary', { type: 'button', on: { click: () => this.exitCompare() } },
      h('span', { text: 'Vis designet mitt' }), h('kbd.kv-key', { text: 'O' }));
    this.beforeEl = h('div.ipt-before.kv-scale', { hidden: true, role: 'status' },
      h('span.ipt-before__tag', { text: 'FØR' }),
      h('span.ipt-before__text', {}, 'Slik huset er i dag', h('small', { text: 'Designet ditt er lagt til side – O eller Esc tar deg tilbake' })),
      this.beforeBtn);
    this.flashEl = h('div.ipt-flash');
    editor.uiRoot.append(this.beforeEl, this.flashEl);
    noMouseFocus(this.beforeEl);

    this._offs.push(editor.design.on('history', () => this._history()));
    this._offs.push(editor.events.on('view', () => this._paintView()));
    this._offs.push(editor.events.on('view-level', () => this._paintView()));
    this._offs.push(editor.events.on('select', ({ selected }) => this._guardSelect(selected)));
    this._history();
    this._paintView();
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
    // Esc while «Før» is shown (and nothing else to close) goes back to the design instead of pausing
    this._onEsc = (e) => {
      if (e.key !== 'Escape' || e.repeat || !this.compareActive || !this.editor.keysActive()) return;
      if (openPanels().length || this.editor.placement?.isActive) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.exitCompare();
    };
    window.addEventListener('keydown', this._onEsc, true);
    this.isOpen = true;
  }

  /**
   * Runs a toolbar action by id.
   * @param {string} id
   */
  run(id) {
    const e = this.editor;
    if (this.compareActive && !COMPARE_SAFE.has(id)) this.exitCompare({ quiet: true });
    const b = BUTTONS.find((x) => x.id === id);
    try {
      if (b?.panel) {
        const p = e.ui[b.panel];
        if (p?.isOpen) p.close();
        else p?.open?.();
      } else if (id === 'view') e.views?.toggle?.();
      else if (id === 'level') this.cycleLevel();
      else if (id === 'compare') this.toggleCompare();
      else if (id === 'photo') this.takePicture();
      else if (id === 'undo') this._undo(false);
      else if (id === 'redo') this._undo(true);
    } catch (err) {
      console.error(`[toolbar] ${id} failed`, err);
    }
    e.events.emit('sfx', { name: 'ui-click' });
  }

  // ---- levels --------------------------------------------------------------------------------------------------

  /** «Etasje»: the next level down, from the lowest back to the top (overview / plan only). */
  cycleLevel() {
    const v = this.editor.views;
    if (!v || v.isWalking !== false || !(v.mode === 'orbit' || v.mode === 'plan')) return;
    if (!v.stepLevel?.(-1)) v.setLevel?.(v.levels?.[0]?.id);
  }

  /** PageUp / PageDown: one level up / down in the overview and the plan. @returns {boolean} used */
  _levelKey(e) {
    const v = this.editor.views;
    if (e.code !== 'PageUp' && e.code !== 'PageDown') return false;
    if (!v || !(v.mode === 'orbit' || v.mode === 'plan') || (v.levels?.length ?? 1) < 2) return false;
    e.preventDefault();
    if (!v.stepLevel?.(e.code === 'PageUp' ? 1 : -1)) {
      this.editor.events.emit('toast', { text: e.code === 'PageUp' ? 'Dette er øverste etasje' : 'Dette er nederste etasje', seconds: 1.6 });
    }
    return true;
  }

  // ---- Før/etter ---------------------------------------------------------------------------------------------

  /** Shows «Før» (the original room) or goes back to the design. */
  toggleCompare() {
    if (this.compareActive) this.exitCompare();
    else this.enterCompare();
  }

  /** Shows the original room. The design and its undo history are kept aside untouched. */
  enterCompare() {
    if (this.compareActive) return;
    const e = this.editor;
    const d = e.design;
    if (e.placement?.isActive) e.placement.cancel();
    const saves = e.saves;
    try {
      if (saves?._timer) saves.autosaveNow(); // flush a pending autosave of the real design first
    } catch (err) {
      console.warn('[toolbar] autosave flush failed', err);
    }
    this._cmp = {
      json: d.toJSON(),
      undo: Array.isArray(d._undo) ? d._undo.slice() : null,
      redo: Array.isArray(d._redo) ? d._redo.slice() : null,
      view: e.views?.mode,
    };
    saves?.disableAutosave?.();
    this.compareActive = true; // before select(null)/load so the guards know
    e.select(null);
    for (const k of ['inspector', 'wall', 'window']) if (e.ui[k]?.isOpen) e.ui[k].close();
    const orig = d.originalJSON();
    orig.env = clone(this._cmp.json.env);
    orig.meta = clone(this._cmp.json.meta);
    try {
      d.load(orig);
    } catch (err) {
      console.error('[toolbar] could not show the original', err);
      this._restore();
      return;
    }
    this.beforeEl.hidden = false;
    requestAnimationFrame(() => this.compareActive && this.beforeEl.classList.add('is-open'));
    this._history();
    this._paintCompare();
    e.events.emit('compare', { active: true });
    e.events.emit('toast', { text: 'Før: huset slik det er i dag. Trykk O igjen for å se designet ditt.', seconds: 3.5 });
  }

  /**
   * Goes back from «Før» to the design (with its undo history).
   * @param {{ quiet?: boolean }} [opts]
   */
  exitCompare({ quiet = false } = {}) {
    if (!this.compareActive) return;
    this._restore();
    if (!quiet) this.editor.events.emit('toast', { text: 'Etter: designet ditt', seconds: 2 });
  }

  _restore() {
    const e = this.editor;
    const d = e.design;
    const cmp = this._cmp;
    this._cmp = null;
    this.compareActive = false;
    if (cmp) {
      const envChanged = JSON.stringify(d.env) !== JSON.stringify(cmp.json.env);
      cmp.json.env = clone(d.env); // light/time changes made while comparing are kept
      try {
        d.load(cmp.json);
      } catch (err) {
        console.error('[toolbar] could not restore the design', err);
      }
      if (cmp.undo) d._undo = cmp.undo;
      if (cmp.redo) d._redo = cmp.redo;
      try {
        d._emitHistory?.();
      } catch {
        /* history is optional */
      }
      e.saves?.enableAutosave?.();
      if (envChanged) {
        try {
          e.saves?.autosaveNow?.();
        } catch {
          /* storage is optional */
        }
      }
    }
    this.beforeEl.classList.remove('is-open');
    setTimeout(() => {
      if (!this.compareActive) this.beforeEl.hidden = true;
    }, 250);
    this._history();
    this._paintCompare();
    e.events.emit('compare', { active: false });
  }

  /** While «Før» is shown nothing may be selected (it would edit the original). */
  _guardSelect(selected) {
    if (!this.compareActive || !selected?.kind) return;
    queueMicrotask(() => {
      const e = this.editor;
      if (!this.compareActive) return;
      e.select(null);
      for (const k of ['inspector', 'wall', 'window']) if (e.ui[k]?.isOpen) e.ui[k].close();
      e.events.emit('toast', { text: 'Du ser på huset slik det er i dag. Trykk O for å gå tilbake til designet ditt og endre.', seconds: 3.5 });
    });
  }

  // ---- picture -------------------------------------------------------------------------------------------------

  /**
   * Renders the current view (without highlight outlines) and downloads it as a PNG.
   * @returns {string|null} the file name, or null when it failed
   */
  takePicture() {
    const e = this.editor;
    const renderer = e.renderer;
    const scene = e.scene;
    if (!renderer || !scene) return null;
    const name = pictureFileName();
    const hidden = [];
    scene.traverse((o) => {
      if ((o.userData?.isHighlight || o.userData?.isGhost) && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const ghost = e.placement?.ghost;
    if (ghost?.isObject3D && ghost.visible) {
      ghost.visible = false;
      hidden.push(ghost);
    }
    try {
      const cam = e.activeCamera || e.camera;
      const lighting = e.home?.lighting;
      if (lighting?.render) lighting.render(renderer, scene, cam);
      else renderer.render(scene, cam);
      // toBlob copies the drawing buffer synchronously, so the frame just rendered is what gets saved
      renderer.domElement.toBlob((blob) => {
        if (!blob) {
          e.events.emit('toast', { text: 'Klarte ikke å lage bildet.', seconds: 3 });
          return;
        }
        try {
          downloadBlob(blob, name);
          e.events.emit('toast', { text: `Bildet er lagret: ${name}`, seconds: 3.5 });
        } catch (err) {
          console.warn('[toolbar] download failed', err);
          e.events.emit('toast', { text: 'Klarte ikke å laste ned bildet.', seconds: 3 });
        }
      }, 'image/png');
    } catch (err) {
      console.error('[toolbar] picture failed', err);
      e.events.emit('toast', { text: 'Klarte ikke å lage bildet.', seconds: 3 });
      return null;
    } finally {
      for (const o of hidden) o.visible = true;
    }
    this.flashEl.classList.remove('is-on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('is-on');
    e.events.emit('sfx', { name: 'switch' });
    return name;
  }

  // ---- panel contract ------------------------------------------------------------------------------------------

  open() {
    this.el.hidden = false;
    this.isOpen = true;
  }

  close() {
    this.el.hidden = true;
    this.isOpen = false;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Every frame: active states of the panel buttons. */
  update() {
    for (const b of BUTTONS) {
      if (!b.panel) continue;
      const on = !!this.editor.ui[b.panel]?.isOpen;
      const btn = this.buttons.get(b.id);
      if (btn && btn.classList.contains('is-active') !== on) {
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  _paintView() {
    const mode = this.editor.views?.mode || 'walk';
    const btn = this.buttons.get('view');
    if (btn) {
      btn.title = `Visning: ${VIEW_LABELS[mode] || mode} – Tab bytter (gå · oversikt · plan)`;
      btn.classList.toggle('is-active', mode !== 'walk');
    }
    [...(this.viewDots?.children || [])].forEach((d, i) => d.classList.toggle('is-on', VIEW_ORDER[i] === mode));
    // «Etasje»: only outside walking, and only when the house has more than one level; it names the level shown
    const lb = this.buttons.get('level');
    if (lb) {
      const v = this.editor.views;
      const levels = v?.levels || [];
      const show = (mode === 'orbit' || mode === 'plan') && levels.length > 1;
      if (lb.hidden === show) lb.hidden = !show;
      const name = v?.levelName || 'Etasje';
      const label = lb.querySelector('.ip-toolbtn__label');
      if (label && label.textContent !== name) label.textContent = name;
      lb.title = `Etasje: ${name} – klikk eller Page Up / Page Down for å bytte`;
    }
  }

  _paintCompare() {
    const btn = this.buttons.get('compare');
    if (!btn) return;
    btn.classList.toggle('is-on', this.compareActive);
    btn.setAttribute('aria-pressed', this.compareActive ? 'true' : 'false');
    btn.querySelector('.ip-toolbtn__label').textContent = this.compareActive ? 'Viser før' : 'Før/etter';
  }

  _history() {
    const d = this.editor.design;
    const block = this.compareActive;
    this.undoBtn.disabled = block || !d.canUndo;
    this.redoBtn.disabled = block || !d.canRedo;
    this.undoBtn.title = d.undoLabel && !block ? `Angre: ${d.undoLabel} (Ctrl+Z)` : 'Angre (Ctrl+Z)';
    this.redoBtn.title = d.redoLabel && !block ? `Gjør om: ${d.redoLabel} (Ctrl+Y)` : 'Gjør om (Ctrl+Y)';
  }

  _undo(redo) {
    if (this.compareActive) {
      this.editor.events.emit('toast', { text: 'Gå tilbake til designet ditt (O) for å angre.', seconds: 2.5 });
      return;
    }
    const d = this.editor.design;
    const label = redo ? d.redoLabel : d.undoLabel;
    const ok = redo ? d.redo() : d.undo();
    if (ok && label) this.editor.events.emit('toast', { text: `${redo ? 'Gjort om' : 'Angret'}: ${label}`, seconds: 1.8 });
  }

  _key(e) {
    if (e.repeat || !this.editor.keysActive()) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyZ') {
      e.preventDefault();
      this.run(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyY') {
      e.preventDefault();
      this.run('redo');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Tab' && (e.shiftKey || document.activeElement?.closest?.('.ip-panel, .kv-dialog'))) return; // Tab moves focus inside panels
    if (this._levelKey(e)) return;
    const b = BUTTONS.find((x) => x.code && x.code === e.code);
    if (!b) return;
    e.preventDefault();
    this.run(b.id);
  }

  dispose() {
    if (this.compareActive) this._restore();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keydown', this._onEsc, true);
    for (const off of this._offs) off?.();
    this._offs = [];
    this.el.remove();
    this.beforeEl.remove();
    this.flashEl.remove();
  }
}

export default Toolbar;
