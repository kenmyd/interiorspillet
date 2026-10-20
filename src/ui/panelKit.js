import { h, svg, fmtNumber } from './dom.js';
import { ICONS } from './icons.js';
import { Dialog } from './Dialog.js';
import palette from '../data/palette.json';
import { resolveColor, assetUrl } from '../home/materials.js';
import './panels.css';

/**
 * Panel kit (ARCHITECTURE §12) – the building blocks of every editor panel, in the look of ui/ui.css (dark glass,
 * amber accent). All sizes are in em inside a `.kv-scale` root; every panel root is `pointer-events: auto`.
 *
 * Panels:   createPanel(opts) → Panel, BasePanel (class to extend), setPanelHost({ root, blockInput, audio }),
 *           openPanels(), closeTopPanel(), anyModalOpen(), isFormFocused(), captureKeys(el)
 * Controls: tabs, card, swatches, colorPicker, slider, select, toggle, textInput, button, iconButton,
 *           paramEditor(schema, values, onChange), field, section, row, emptyState, comingSoon, badge
 * Dialogs:  confirmDialog({ title, text, okLabel, cancelLabel, danger }) → Promise<boolean>, infoDialog
 * Format:   fmtNok(12990) → «12 990 kr», fmtMeters(1.2) → «1,20 m», fmtCm(0.45) → «45 cm», assetUrl (re-export)
 *
 * Keyboard: panels stop key events from reaching the game while a form field inside them has focus
 * (captureKeys); Esc in a text field blurs it. The Editor's Esc handling closes the most recently opened panel
 * (closeTopPanel) before it deselects / pauses.
 */

export { assetUrl };

// ---------------------------------------------------------------------------------------------------------------
// Host + panel registry

const host = { root: null, blockInput: null, audio: null, onOpen: null };
/** @type {Panel[]} open panels, most recent last */
const openStack = [];
const allPanels = new Set();

/**
 * Where panels live and how modal panels block the game. The Editor calls it once.
 * @param {{ root?: HTMLElement, blockInput?: (reason: string) => () => void, audio?: object }} o
 */
export function setPanelHost({ root, blockInput, audio, onOpen } = {}) {
  if (onOpen) host.onOpen = onOpen; // called with the panel whenever one opens (Editor: hide the HUD help)
  if (root) host.root = root;
  if (blockInput) host.blockInput = blockInput;
  if (audio) host.audio = audio;
}

/** Open panels, most recently opened last. */
export function openPanels() {
  return [...openStack];
}

/** Closes the most recently opened closable panel. @returns {boolean} whether one was closed */
export function closeTopPanel() {
  for (let i = openStack.length - 1; i >= 0; i--) {
    const p = openStack[i];
    if (p.closable) {
      p.close();
      return true;
    }
  }
  return false;
}

/** True while a modal panel is open. */
export function anyModalOpen() {
  return openStack.some((p) => p.modal) || !!document.querySelector('.kv-dialog:not(.is-closing)');
}

/** True when keyboard focus is in a form field (text, number, range, select, checkbox …) or contenteditable. */
export function isFormFocused() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  if (a.isContentEditable) return true;
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT';
}

const isField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/**
 * Stops keydown events from leaving `el` while a form field inside it has focus, so game/editor shortcuts on window
 * (walking, R, Delete, K …) do not fire while the user types or drags a slider with the arrow keys. Esc in a field
 * blurs it. Key-ups are let through (the game must see releases).
 * @param {HTMLElement} el
 * @returns {() => void} removes the listener
 */
export function captureKeys(el) {
  const onKey = (e) => {
    if (!isField(e.target)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.target.blur();
    }
    e.stopPropagation();
  };
  el.addEventListener('keydown', onKey);
  return () => el.removeEventListener('keydown', onKey);
}

/**
 * z-index from the panel's place in the open stack (10–19 docked, 25–34 centre/modal), so it never grows past the
 * pause menu (20) or the dialogs (40) however often panels are opened.
 */
function restack() {
  openStack.forEach((p, i) => {
    p.el.style.zIndex = String((p.side === 'center' || p.modal ? 25 : 10) + Math.min(i, 9));
  });
}

/**
 * @typedef {Object} Panel
 * @property {HTMLElement} el      the panel root (.ip-panel.kv-scale)
 * @property {HTMLElement} head    header row (title, extra buttons via head.append, close button)
 * @property {HTMLElement} body    scrollable content
 * @property {HTMLElement} foot    footer (hidden until it has children)
 * @property {() => void} open
 * @property {() => void} close
 * @property {() => void} toggle
 * @property {boolean} isOpen
 * @property {(() => void)|null} onClose   called after the panel closed
 * @property {(() => void)|null} onOpen    called after the panel opened
 * @property {(text: string) => void} setTitle
 * @property {() => void} dispose
 */

/**
 * Creates a docked panel (hidden until open()).
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.title
 * @param {string} [o.icon]            key of ui/icons.js ICONS
 * @param {'left'|'right'|'bottom'|'center'} [o.side='right']
 * @param {string|number} [o.width]    css width (number = em), default 24em (left/right), 40em (bottom/center)
 * @param {boolean} [o.modal=false]    modal: backdrop, the game input is blocked while open (setPanelHost)
 * @param {boolean} [o.closable=true]  show × and allow Esc/closeTopPanel
 * @param {boolean} [o.exclusive=true] opening it closes the other exclusive panels on the same side
 * @param {HTMLElement} [o.parent]     default: setPanelHost root, else #ui-root, else body
 * @param {string} [o.className]
 * @param {() => void} [o.onClose]
 * @returns {Panel}
 */
export function createPanel({ id, title, icon, side = 'right', width, modal = false, closable = true, exclusive = true, parent, className = '', onClose = null } = {}) {
  const titleEl = h('h2.ip-panel__title', { text: title || '' });
  const closeBtn = closable ? h('button.kv-iconbtn.ip-panel__close', { type: 'button', 'aria-label': 'Lukk', title: 'Lukk (Esc)' }, svg(ICONS.close)) : null;
  const head = h('header.ip-panel__head', {}, icon && ICONS[icon] ? h('span.ip-panel__icon', {}, svg(ICONS[icon])) : null, titleEl, closeBtn);
  const body = h('div.ip-panel__body');
  const foot = h('footer.ip-panel__foot');
  const w = width ?? (side === 'bottom' || side === 'center' ? 40 : 24);
  const el = h(`section.ip-panel.ip-panel--${side}.kv-scale${className ? `.${className.split(' ').join('.')}` : ''}`, {
    hidden: true,
    role: modal ? 'dialog' : 'region',
    'aria-label': title || id,
    dataset: { panel: id || '' },
    '--ip-w': typeof w === 'number' ? `${w}em` : w,
  }, head, body, foot);
  let backdrop = null;
  if (modal) backdrop = h('div.ip-backdrop.kv-scale', { hidden: true });
  const root = parent || host.root || document.getElementById('ui-root') || document.body;
  if (backdrop) root.append(backdrop);
  root.append(el);
  const offKeys = captureKeys(el);
  let release = null;
  let hideTimer = 0;

  const onModalKey = (e) => {
    if (e.key === 'Escape' && panel.isOpen && openStack[openStack.length - 1] === panel) {
      e.preventDefault();
      e.stopImmediatePropagation();
      panel.close();
    }
  };

  const panel = {
    id,
    el,
    head,
    body,
    foot,
    side,
    modal,
    closable,
    exclusive,
    isOpen: false,
    onClose,
    onOpen: null,
    setTitle(text) {
      titleEl.textContent = text;
      el.setAttribute('aria-label', text);
    },
    open() {
      if (panel.isOpen) {
        // bring to front
        const at = openStack.indexOf(panel);
        if (at >= 0) openStack.splice(at, 1);
        openStack.push(panel);
        restack();
        return;
      }
      if (exclusive) for (const p of [...openStack]) if (p !== panel && p.exclusive && p.side === side) p.close();
      clearTimeout(hideTimer);
      panel.isOpen = true;
      openStack.push(panel);
      el.hidden = false;
      restack();
      foot.hidden = !foot.childElementCount;
      if (backdrop) backdrop.hidden = false;
      requestAnimationFrame(() => {
        if (!panel.isOpen) return;
        el.classList.add('is-open');
        backdrop?.classList.add('is-open');
      });
      if (modal) {
        release = host.blockInput?.(`panel:${id}`) ?? null;
        window.addEventListener('keydown', onModalKey, true);
      }
      panel.onOpen?.();
      host.onOpen?.(panel);
    },
    close() {
      if (!panel.isOpen) return;
      panel.isOpen = false;
      const i = openStack.indexOf(panel);
      if (i >= 0) openStack.splice(i, 1);
      restack();
      el.classList.remove('is-open');
      backdrop?.classList.remove('is-open');
      if (el.contains(document.activeElement)) document.activeElement.blur();
      hideTimer = setTimeout(() => {
        if (panel.isOpen) return;
        el.hidden = true;
        if (backdrop) backdrop.hidden = true;
      }, 200);
      if (modal) {
        window.removeEventListener('keydown', onModalKey, true);
        release?.();
        release = null;
      }
      panel.onClose?.();
    },
    toggle() {
      if (panel.isOpen) panel.close();
      else panel.open();
    },
    dispose() {
      if (panel.isOpen) panel.close();
      clearTimeout(hideTimer);
      offKeys();
      el.remove();
      backdrop?.remove();
      allPanels.delete(panel);
    },
  };
  closeBtn?.addEventListener('click', () => panel.close());
  backdrop?.addEventListener('click', () => closable && panel.close());
  allPanels.add(panel);
  return panel;
}

/**
 * Base class for editor panels: `class XPanel extends BasePanel { constructor(editor) { super(editor, { id, title,
 * icon, side }); … } }`. Gives open(arg)/close()/toggle()/isOpen/dispose() and this.panel/this.body/this.foot.
 * Override onOpen(arg) / onClose() / update(dt) as needed.
 */
export class BasePanel {
  /**
   * @param {object} editor
   * @param {Parameters<typeof createPanel>[0]} opts
   */
  constructor(editor, opts) {
    this.editor = editor;
    this.panel = createPanel({ parent: editor?.uiRoot, ...opts });
    this.el = this.panel.el;
    this.body = this.panel.body;
    this.foot = this.panel.foot;
    this.panel.onClose = () => {
      this.onClose?.();
      editor?.events?.emit?.('panel', { id: opts.id, open: false });
    };
  }

  get isOpen() {
    return this.panel.isOpen;
  }

  /** Opens the panel (arg is passed to onOpen). */
  open(arg) {
    this.onOpen?.(arg);
    this.panel.open();
    this.editor?.events?.emit?.('panel', { id: this.panel.id, open: true });
  }

  close() {
    this.panel.close();
  }

  toggle(arg) {
    if (this.isOpen) this.close();
    else this.open(arg);
  }

  dispose() {
    this.panel.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Layout helpers

/** Titled section. */
export function section(title, ...children) {
  return h('div.ip-section', {}, title ? h('h3.ip-section__title', { text: title }) : null, ...children);
}

/** Label + control row. `hint` = small grey text under the label. */
export function field(label, control, { hint } = {}) {
  return h('div.ip-field', {},
    h('div.ip-field__label', {}, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
    h('div.ip-field__control', {}, control?.el ?? control),
  );
}

/** Horizontal row of controls/buttons. */
export function row(...children) {
  return h('div.ip-row', {}, ...children);
}

/** Muted centred message with an icon. */
export function emptyState(text, icon = 'info') {
  return h('div.ip-empty', {}, ICONS[icon] ? svg(ICONS[icon]) : null, h('p', { text }));
}

/** The «Kommer snart» placeholder used by stub panels. */
export function comingSoon(text = 'Kommer snart') {
  return emptyState(text, 'info');
}

/** Small pill. tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'. */
export function badge(text, tone = 'neutral') {
  return h(`span.ip-badge.ip-badge--${tone}`, { text });
}

// ---------------------------------------------------------------------------------------------------------------
// Controls

/**
 * Button. variant: 'primary' (amber) | 'ghost' | 'danger' | undefined; size 'sm' | 'lg'.
 * @returns {HTMLButtonElement}
 */
export function button({ label, icon, onClick, variant, size, title, disabled = false } = {}) {
  const cls = ['kv-btn', variant === 'primary' ? 'ip-btn--primary' : variant ? `kv-btn--${variant}` : '', size ? `kv-btn--${size}` : ''].filter(Boolean).join('.');
  const b = h(`button.${cls}`, { type: 'button', title, disabled, on: { click: (e) => onClick?.(e) } },
    icon && ICONS[icon] ? svg(ICONS[icon]) : null,
    label ? h('span', { text: label }) : null,
  );
  return b;
}

/** Square icon button (title = tooltip, also the accessible name). */
export function iconButton({ icon, title, onClick, active = false } = {}) {
  return h(`button.kv-iconbtn${active ? '.is-active' : ''}`, { type: 'button', title, 'aria-label': title, on: { click: (e) => onClick?.(e) } }, ICONS[icon] ? svg(ICONS[icon]) : h('span', { text: '?' }));
}

/**
 * Tab bar. items: [{ id, label, icon? }].
 * @returns {{ el: HTMLElement, value: string, set: (id: string, silent?: boolean) => void }}
 */
export function tabs(items, { value = items[0]?.id, onChange } = {}) {
  const ctl = { el: null, value, set: null };
  const btns = new Map();
  ctl.el = h('div.kv-tabs.ip-tabs', { role: 'tablist' },
    items.map((it) => {
      const b = h('button.kv-tab', { type: 'button', role: 'tab', on: { click: () => ctl.set(it.id) } },
        it.icon && ICONS[it.icon] ? svg(ICONS[it.icon]) : null,
        h('span', { text: it.label }),
      );
      btns.set(it.id, b);
      return b;
    }),
  );
  ctl.set = (id, silent = false) => {
    ctl.value = id;
    for (const [k, b] of btns) {
      b.classList.toggle('is-active', k === id);
      b.setAttribute('aria-selected', k === id ? 'true' : 'false');
    }
    if (!silent) onChange?.(id);
  };
  ctl.set(value, true);
  return ctl;
}

/**
 * Product / proposal card.
 * @param {object} o
 * @param {string} [o.image]    image URL (relative 'img/…' paths go through assetUrl)
 * @param {string} [o.icon]     fallback icon when there is no image
 * @param {string} [o.swatch]   colour shown when there is no image ('#hex')
 * @param {string} o.title
 * @param {string} [o.subtitle]
 * @param {number|string} [o.price]   number → fmtNok
 * @param {number|string} [o.priceOld] struck-through list price
 * @param {Array<string|{text: string, tone?: string}>} [o.badges]
 * @param {boolean} [o.selected]
 * @param {(e: MouseEvent) => void} [o.onClick]
 * @param {HTMLElement[]} [o.actions]  buttons at the bottom right
 * @returns {HTMLElement & { setSelected: (on: boolean) => void }}
 */
export function card({ image, icon = 'sofa', swatch, title, subtitle, price, priceOld, badges = [], selected = false, onClick, actions = [] } = {}) {
  const src = image && !/^(https?:|data:|blob:)/.test(image) ? assetUrl(image) : image;
  const img = h('div.ip-card__img', { style: src ? { backgroundImage: `url("${src}")` } : swatch ? { background: swatch } : {} }, !src && !swatch && ICONS[icon] ? svg(ICONS[icon]) : null);
  const priceEl = price != null && price !== ''
    ? h('div.ip-card__price', {}, typeof price === 'number' ? fmtNok(price) : String(price), priceOld != null ? h('s', { text: typeof priceOld === 'number' ? fmtNok(priceOld) : String(priceOld) }) : null)
    : null;
  const el = h(`article.ip-card${selected ? '.is-selected' : ''}${onClick ? '.is-clickable' : ''}`, {
    tabIndex: onClick ? 0 : -1,
    on: onClick ? {
      click: (e) => {
        if (e.target.closest('button')) return;
        onClick(e);
      },
      keydown: (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
          e.preventDefault();
          onClick(e);
        }
      },
    } : {},
  },
  img,
  h('div.ip-card__body', {},
    h('div.ip-card__title', { text: title || '', title: title || '' }),
    subtitle ? h('div.ip-card__sub', { text: subtitle }) : null,
    badges.length ? h('div.ip-badges', {}, badges.map((b) => (typeof b === 'string' ? badge(b) : badge(b.text, b.tone)))) : null,
    h('div.ip-card__foot', {}, priceEl, actions.length ? h('div.ip-card__actions', {}, actions) : null),
  ));
  el.setSelected = (on) => el.classList.toggle('is-selected', !!on);
  return el;
}

/**
 * Round colour swatches. colors: ['#hex' | { hex, name }].
 * @returns {HTMLElement & { set: (hex: string) => void }}
 */
export function swatches(colors, onPick, { value, size } = {}) {
  const list = colors.map((c) => (typeof c === 'string' ? { hex: resolveColor(c), name: c } : { hex: resolveColor(c.hex), name: c.name || c.hex }));
  const el = h('div.ip-swatches', { role: 'listbox', '--ip-sw': size });
  const items = list.map((c) => {
    const b = h('button.ip-swatch', {
      type: 'button',
      title: c.name ? `${c.name} (${c.hex})` : c.hex,
      'aria-label': c.name || c.hex,
      style: { background: c.hex },
      on: { click: () => {
        el.set(c.hex);
        onPick?.(c.hex, c);
      } },
    });
    b.dataset.hex = c.hex;
    el.append(b);
    return b;
  });
  el.set = (hex) => {
    const v = hex ? resolveColor(hex) : null;
    for (const b of items) b.classList.toggle('is-active', b.dataset.hex === v);
  };
  el.set(value);
  return el;
}

/** Palette colour lists for swatch rows: 'walls' (Sand, Marrakesh), 'paints' (all Jotun paints), 'materials'. */
export function paletteColors(which = 'paints') {
  if (which === 'walls') return Object.values(palette.walls || {}).map((p) => ({ hex: p.hex, name: p.name }));
  if (which === 'materials') return (palette.materials || []).map((m) => ({ hex: m.hex, name: m.name }));
  return (palette.paints || []).map((p) => ({ hex: p.hex, name: `${p.name}${p.code ? ` (${p.brand || ''} ${p.code})`.replace('( ', '(') : ''}` }));
}

/**
 * Colour picker: native <input type=color>, a hex field and a swatch row.
 * onChange(hex, { final }) – final = false while dragging in the native picker, true on commit (use it for undo).
 * @param {string} hex
 * @param {(hex: string, info: { final: boolean }) => void} onChange
 * @param {{ palette?: 'paints'|'walls'|'materials'|Array, label?: string, swatchRow?: boolean }} [o]
 * @returns {{ el: HTMLElement, value: string, set: (hex: string) => void }}
 */
export function colorPicker(hex, onChange, { palette: pal = 'paints', label, swatchRow = true } = {}) {
  const ctl = { el: null, value: resolveColor(hex, '#cccccc'), set: null };
  const native = h('input.ip-color__native', { type: 'color', value: ctl.value, 'aria-label': label || 'Farge' });
  const text = h('input.ip-input.ip-color__hex', { type: 'text', value: ctl.value, maxLength: 7, spellcheck: false, 'aria-label': 'Fargekode' });
  const colors = Array.isArray(pal) ? pal : paletteColors(pal);
  const sw = swatchRow ? swatches(colors, (c) => commit(c, true), { value: ctl.value }) : null;
  const commit = (v, final) => {
    const c = resolveColor(v, null);
    if (!c) {
      text.value = ctl.value;
      return;
    }
    ctl.set(c);
    onChange?.(c, { final });
  };
  native.addEventListener('input', () => commit(native.value, false));
  native.addEventListener('change', () => commit(native.value, true));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(text.value.startsWith('#') ? text.value : `#${text.value}`, true);
    }
  });
  text.addEventListener('blur', () => {
    if (text.value !== ctl.value) commit(text.value.startsWith('#') ? text.value : `#${text.value}`, true);
  });
  ctl.set = (v) => {
    const c = resolveColor(v, ctl.value);
    ctl.value = c;
    native.value = c;
    if (document.activeElement !== text) text.value = c;
    sw?.set(c);
  };
  ctl.el = h('div.ip-color', {}, h('div.ip-color__row', {}, native, text), sw);
  return ctl;
}

/**
 * Range slider with label and value. onInput while dragging, onChange on release (commit / undo step).
 * @param {{ label?: string, min?: number, max?: number, step?: number, value?: number, unit?: string, decimals?: number,
 *   format?: (v: number) => string, onInput?: (v: number) => void, onChange?: (v: number) => void }} o
 * @returns {{ el: HTMLElement, input: HTMLInputElement, value: number, set: (v: number) => void }}
 */
export function slider({ label, min = 0, max = 1, step = 0.01, value = min, unit = '', decimals, format, onInput, onChange } = {}) {
  const dec = decimals ?? Math.max(0, Math.min(3, (String(step).split('.')[1] || '').length));
  const fmt = format ?? ((v) => `${fmtNumber(v, dec)}${unit ? ` ${unit}` : ''}`);
  const input = h('input.kv-range', { type: 'range', min, max, step, value, 'aria-label': label || '' });
  const out = h('output.ip-slider__value');
  const ctl = { el: null, input, value: Number(value), set: null };
  const paint = () => {
    const p = max > min ? ((ctl.value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--p', `${Math.max(0, Math.min(100, p))}%`);
    out.textContent = fmt(ctl.value);
  };
  input.addEventListener('input', () => {
    ctl.value = Number(input.value);
    paint();
    onInput?.(ctl.value);
  });
  input.addEventListener('change', () => {
    ctl.value = Number(input.value);
    paint();
    onChange?.(ctl.value);
  });
  ctl.set = (v) => {
    ctl.value = Number(v);
    input.value = String(v);
    paint();
  };
  paint();
  const s = h('div.ip-slider', {}, input, out);
  ctl.el = label ? field(label, s) : s;
  return ctl;
}

function normOptions(options) {
  return (options || []).map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] ?? String(o[0]) } : typeof o === 'object' ? o : { value: o, label: String(o) }));
}

/**
 * Drop-down. options: [[value, 'Etikett']] | [{ value, label }] | ['a', 'b'].
 * @returns {{ el: HTMLElement, select: HTMLSelectElement, value: any, set: (v: any) => void, setOptions: (options: any[]) => void }}
 */
export function select({ label, options, value, onChange } = {}) {
  const sel = h('select.ip-select', { 'aria-label': label || '' });
  const ctl = { el: null, select: sel, value, set: null, setOptions: null };
  let opts = [];
  ctl.setOptions = (list) => {
    opts = normOptions(list);
    sel.replaceChildren(...opts.map((o, i) => h('option', { value: String(i), text: o.label })));
    ctl.set(ctl.value);
  };
  ctl.set = (v) => {
    ctl.value = v;
    const i = opts.findIndex((o) => o.value === v || String(o.value) === String(v));
    sel.value = String(i >= 0 ? i : 0);
  };
  sel.addEventListener('change', () => {
    const o = opts[Number(sel.value)];
    ctl.value = o?.value;
    onChange?.(ctl.value);
  });
  ctl.setOptions(options);
  if (value === undefined && opts[0]) ctl.value = opts[0].value;
  ctl.el = label ? field(label, sel) : sel;
  return ctl;
}

/**
 * On/off switch (styled .kv-switch).
 * @returns {{ el: HTMLElement, input: HTMLInputElement, value: boolean, set: (v: boolean) => void }}
 */
export function toggle({ label, value = false, onChange } = {}) {
  const input = h('input.kv-switch__input', { type: 'checkbox', checked: !!value, 'aria-label': label || '' });
  const sw = h('label.kv-switch', {}, input, h('span.kv-switch__track', {}, h('span.kv-switch__thumb')));
  const ctl = { el: null, input, value: !!value, set: null };
  input.addEventListener('change', () => {
    ctl.value = input.checked;
    onChange?.(ctl.value);
  });
  ctl.set = (v) => {
    ctl.value = !!v;
    input.checked = !!v;
  };
  ctl.el = label ? h('div.ip-field.ip-field--toggle', {}, h('div.ip-field__label', {}, h('span', { text: label })), sw) : sw;
  return ctl;
}

/**
 * Text (or search) field. onInput on every keystroke, onChange on Enter/blur.
 * @returns {{ el: HTMLElement, input: HTMLInputElement, value: string, set: (v: string) => void }}
 */
export function textInput({ label, value = '', placeholder = '', type = 'text', onInput, onChange } = {}) {
  const input = h('input.ip-input', { type, value, placeholder, 'aria-label': label || placeholder, spellcheck: false });
  const ctl = { el: null, input, value, set: null };
  input.addEventListener('input', () => {
    ctl.value = input.value;
    onInput?.(ctl.value);
  });
  input.addEventListener('change', () => onChange?.(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  ctl.set = (v) => {
    ctl.value = v;
    input.value = v;
  };
  ctl.el = label ? field(label, input) : input;
  return ctl;
}

/**
 * Form for a parameter schema (Def.params / elementEditor format):
 *   { key: { type: 'number', min, max, step, label, unit? } | { type: 'enum', options: [[v, 'Etikett']], label }
 *          | { type: 'bool', label } | { type: 'color', label } | { type: 'text', label } }
 * onChange(key, value, { final, values }) – final = false while a slider/colour is being dragged.
 * @returns {{ el: HTMLElement, set: (values: object) => void, values: object }}
 */
export function paramEditor(schema, values = {}, onChange) {
  const ctls = {};
  const state = { ...values };
  const el = h('div.ip-params');
  const emit = (key, v, final) => {
    state[key] = v;
    onChange?.(key, v, { final, values: { ...state } });
  };
  for (const [key, s] of Object.entries(schema || {})) {
    const label = s.label || key;
    let ctl;
    if (s.type === 'number') {
      ctl = slider({ label, min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? 0.01, unit: s.unit ?? '', value: values[key] ?? s.default ?? s.min ?? 0, onInput: (v) => emit(key, v, false), onChange: (v) => emit(key, v, true) });
    } else if (s.type === 'enum') {
      ctl = select({ label, options: s.options, value: values[key] ?? s.default, onChange: (v) => emit(key, v, true) });
    } else if (s.type === 'bool') {
      ctl = toggle({ label, value: values[key] ?? s.default ?? false, onChange: (v) => emit(key, v, true) });
    } else if (s.type === 'color') {
      ctl = colorPicker(values[key] ?? s.default ?? '#cccccc', (v, { final }) => emit(key, v, final), { label, palette: s.palette || 'materials' });
      ctl.el = field(label, ctl.el);
    } else {
      ctl = textInput({ label, value: values[key] ?? s.default ?? '', onChange: (v) => emit(key, v, true) });
    }
    ctls[key] = ctl;
    el.append(ctl.el);
  }
  return {
    el,
    get values() {
      return { ...state };
    },
    set(next = {}) {
      for (const [k, v] of Object.entries(next)) {
        state[k] = v;
        ctls[k]?.set(v);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Dialogs

/**
 * Yes/no question in a modal dialog (ui/Dialog.js). Resolves true on OK, false on cancel/Esc/backdrop.
 * @param {{ title: string, text?: string, okLabel?: string, cancelLabel?: string, danger?: boolean, icon?: string, parent?: HTMLElement }} o
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, text = '', okLabel = 'OK', cancelLabel = 'Avbryt', danger = false, icon = 'warning', parent } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const release = host.blockInput?.('dialog') ?? null;
    const ok = button({ label: okLabel, variant: danger ? 'danger' : 'primary', onClick: () => {
      result = true;
      dialog.close();
    } });
    const cancel = button({ label: cancelLabel, variant: 'ghost', onClick: () => dialog.close() });
    const content = h('div.ip-confirm', {}, text ? h('p.ip-confirm__text', { text }) : null, h('div.ip-confirm__buttons', {}, cancel, ok));
    const root = parent || host.root || document.getElementById('ui-root') || document.body;
    const wrap = h('div.kv-scale.ip-dialog-host');
    root.append(wrap);
    const dialog = new Dialog(wrap, {
      title,
      icon,
      content,
      onClose: () => {
        release?.();
        setTimeout(() => wrap.remove(), 250);
        resolve(result);
      },
    });
    requestAnimationFrame(() => ok.focus({ preventScroll: true }));
  });
}

/** Message with an OK button. @returns {Promise<void>} */
export function infoDialog({ title, text = '', okLabel = 'OK', icon = 'info', parent } = {}) {
  return confirmDialog({ title, text, okLabel, cancelLabel: 'Lukk', icon, parent }).then(() => {});
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting

/** «12 990 kr» (nb-NO thousands separator). */
export function fmtNok(v) {
  if (v == null || !Number.isFinite(Number(v))) return '';
  return `${Math.round(Number(v)).toLocaleString('nb-NO')} kr`;
}

/** «1,20 m». */
export function fmtMeters(v, decimals = 2) {
  return `${fmtNumber(v, decimals)} m`;
}

/** «45 cm». */
export function fmtCm(v) {
  return `${fmtNumber(Math.round(v * 100), 0)} cm`;
}
