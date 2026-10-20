/**
 * Tiny DOM helpers shared by the UI modules (no framework on purpose – the UI is small and mostly static).
 */

/**
 * DOM event dispatched on the UI root by PauseMenu when it opens / closes: CustomEvent, detail { paused: boolean }.
 * The HUD listens for it to freeze its timers while the game is paused.
 */
export const PAUSE_EVENT = 'kv:pause';

/**
 * Creates an element.
 * @param {string} tag      tag name, optionally with classes: 'div.kv-card.is-on'
 * @param {object} [attrs]  attributes / properties. Special keys: class, style (object or string), dataset,
 *                          html (innerHTML), text (textContent), on: { click: fn, ... }
 * @param {...(Node|string|null|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Parses an HTML string (trusted, from icons.js) into a single element. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** Keyboard key cap: <kbd class="kv-key">E</kbd>. `wide` for Shift/Space/Ctrl. */
export function keycap(label, { wide = false, mouse = null } = {}) {
  return h(`kbd.kv-key${wide ? '.kv-key--wide' : ''}${mouse ? '.kv-key--mouse' : ''}`, { text: label });
}

/** Norwegian number formatting (decimal comma). */
export function fmtNumber(v, decimals = 0) {
  return Number(v).toLocaleString('nb-NO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "70 %" (Norwegian puts a space before the percent sign). */
export function fmtPercent(v) {
  return `${Math.round(v * 100)} %`;
}

/**
 * Wires optional UI sounds to buttons inside `root`: 'ui-hover' on pointerenter (throttled), 'ui-click' on click.
 * @returns {() => void} removes the listeners
 */
export function bindUiSounds(root, audio, selector = 'button, [data-sound]') {
  if (!audio?.play) return () => {};
  let last = 0;
  const over = (e) => {
    const t = e.target.closest?.(selector);
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    const now = performance.now();
    if (now - last < 70) return;
    last = now;
    try {
      audio.play('ui-hover');
    } catch {
      /* audio is optional */
    }
  };
  const click = (e) => {
    const t = e.target.closest?.(selector);
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    try {
      audio.play('ui-click');
    } catch {
      /* audio is optional */
    }
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('click', click);
  return () => {
    root.removeEventListener('pointerover', over);
    root.removeEventListener('click', click);
  };
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

/**
 * Keyboard-focusable elements inside `root`, in DOM order: enabled, rendered, not inert, tabIndex >= 0.
 * Of a radio group only the checked radio counts (the browser tabs into the group at the checked one).
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
export function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled || el.tabIndex < 0 || el.closest('[inert]')) return false;
    if (el.type === 'radio' && !el.checked && el.name) {
      const checked = root.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
      if (checked) return false;
    }
    return el.getClientRects().length > 0;
  });
}

/**
 * Keeps Tab / Shift+Tab inside `root` (modal dialogs). Call it from a keydown listener; it only acts on Tab
 * and only intervenes at the ends of the tab order (or when focus is outside / on the container itself).
 * @param {KeyboardEvent} e
 * @param {HTMLElement} root
 * @returns {boolean} true when the event was a Tab press that this function redirected
 */
export function trapTab(e, root) {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return false;
  const list = focusableIn(root);
  if (!list.length) {
    e.preventDefault();
    return true;
  }
  const i = list.indexOf(document.activeElement);
  const wrap = i < 0 || (e.shiftKey ? i === 0 : i === list.length - 1);
  if (!wrap) return false;
  e.preventDefault();
  (e.shiftKey ? list[list.length - 1] : list[0]).focus();
  return true;
}

/** True when keyboard focus is in a text field (so global shortcuts should not fire). */
export function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.isContentEditable) return true;
  const tag = a.tagName;
  return tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(a.type));
}
