import { h, svg, trapTab } from './dom.js';
import { ICONS } from './icons.js';

/**
 * Modal dialog used on the main menu (settings, controls). Esc, the close button and a click on the backdrop
 * close it. Only one is open at a time per owner.
 *
 * Keyboard: Tab / Shift+Tab stay inside the panel; on close, focus returns to the element that had it when the
 * dialog opened (usually the button that opened it).
 */
export class Dialog {
  /**
   * @param {HTMLElement} parent
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.icon]           key in ICONS
   * @param {HTMLElement} o.content
   * @param {string} [o.size]           'md' | 'lg'
   * @param {() => void} [o.onClose]
   */
  constructor(parent, { title, icon, content, size = 'md', onClose }) {
    this.onClose = onClose;
    this.close = this.close.bind(this);
    this._opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeBtn = h('button.kv-iconbtn', { type: 'button', 'aria-label': 'Lukk', on: { click: this.close } }, svg(ICONS.close));
    this.panel = h(`div.kv-dialog__panel.kv-dialog__panel--${size}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1 },
      h('header.kv-dialog__head', {}, icon ? h('span.kv-dialog__icon', {}, svg(ICONS[icon])) : null, h('h2.kv-dialog__title', { text: title }), closeBtn),
      h('div.kv-dialog__body', {}, content),
    );
    this.el = h('div.kv-dialog', {}, h('div.kv-dialog__backdrop', { on: { click: this.close } }), this.panel);
    this._onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      } else {
        trapTab(e, this.panel);
      }
    };
    window.addEventListener('keydown', this._onKey, true);
    parent.append(this.el);
    requestAnimationFrame(() => {
      if (this.closed) return;
      this.el.classList.add('is-open');
      this.panel.focus({ preventScroll: true });
    });
  }

  /**
   * Fades the dialog out and removes it. onClose runs right away (the owner can open the next dialog at once);
   * the content stays in place until the fade has finished.
   */
  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this._onKey, true);
    this.el.classList.remove('is-open');
    this.el.classList.add('is-closing');
    this.el.inert = true; // no clicks / focus inside while it fades
    setTimeout(() => this.el.remove(), 180);
    // give focus back to the opener (if it is still on screen) so keyboard users keep their place
    const opener = this._opener;
    const a = document.activeElement;
    if (opener?.isConnected && (this.el.contains(a) || a === document.body)) opener.focus({ preventScroll: true });
    this.onClose?.();
  }
}
