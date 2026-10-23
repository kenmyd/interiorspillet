import { h, fmtNumber } from './dom.js';

/**
 * Small helpers of the Inspector, shared with its extensions (ui/inspector/gridSection.js, ui/imageInspector.js …;
 * MASTER §2.7):
 *
 *   clone(v)                  deep copy of plain data (null/undefined pass through)
 *   cm(v)                     «45 cm» from metres
 *   throttle(fn, ms?)         at most every ms while dragging; .flush() runs the pending call now, .cancel() drops it
 *   blurSoon(el)              blurs a control after its event (so the panel can refresh again)
 *   seg(options, value, onPick)   segmented control (.ipi-seg, styled by the Inspector)
 */

export const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export const cm = (v) => `${fmtNumber(Math.round(v * 100), 0)} cm`;

/** Calls fn at most every `ms` while dragging; flush() runs the last pending call now. */
export function throttle(fn, ms = 70) {
  let last = 0;
  let timer = 0;
  let args = null;
  const run = () => {
    clearTimeout(timer);
    timer = 0;
    last = performance.now();
    const a = args;
    args = null;
    if (a) fn(...a);
  };
  const t = (...a) => {
    args = a;
    const wait = ms - (performance.now() - last);
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  t.flush = () => args && run();
  t.cancel = () => {
    clearTimeout(timer);
    timer = 0;
    args = null;
  };
  return t;
}

export const blurSoon = (el) => setTimeout(() => {
  if (el && document.activeElement === el) el.blur();
}, 0);

/**
 * Segmented control: options [[value, label]], the active value, onPick(value).
 * @returns {HTMLElement}
 */
export function seg(options, value, onPick) {
  return h('div.ipi-seg', { role: 'radiogroup' }, options.map(([v, label]) => h(`button${v === value ? '.is-active' : ''}`, {
    type: 'button',
    role: 'radio',
    'aria-checked': v === value ? 'true' : 'false',
    title: label,
    text: label,
    on: { click: () => v !== value && onPick(v) },
  })));
}
