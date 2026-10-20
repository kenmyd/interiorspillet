import { h, svg, fmtNumber, fmtPercent } from './dom.js';
import { ICONS } from './icons.js';

/**
 * Settings form bound to core/Settings.js – shared by the main menu dialog and the pause menu.
 * Every change is applied immediately with settings.set(key, value); Settings persists it and emits 'change'
 * (Game listens for fov / quality, AudioSystem for masterVolume / effectsVolume). The panel also follows changes made elsewhere
 * (e.g. "Tilbakestill").
 *
 * All tab pages are stacked in one grid cell (inactive ones are invisible + inert), so the panel always has the
 * height of the tallest page and the tab bar never moves when switching tabs.
 *
 * To add a setting: add the key to DEFAULT_SETTINGS (core/Settings.js) and a row to GROUPS below.
 */

/**
 * @typedef {object} SettingRow
 * @property {string} key                       Settings key
 * @property {'slider'|'toggle'|'segment'|'cards'} type
 * @property {string} label
 * @property {string} [help]                    small description under the label
 * @property {number} [min] [max] [step]        slider range
 * @property {(v:number)=>string} [format]      slider value text
 * @property {Array<{value:any,label:string,desc?:string}>} [options]  segment / cards
 * @property {string} [restartNote]             in-game only: shown under the label once the value differs from the
 *                                              value the panel opened with (setting needs a restart to fully apply)
 */

/** @type {Array<{id:string, label:string, icon:string, rows:SettingRow[]}>} */
export const SETTING_GROUPS = [
  {
    id: 'mouse',
    label: 'Mus og bevegelse',
    icon: 'mouse',
    rows: [
      {
        key: 'mouseMode',
        type: 'cards',
        label: 'Musemodus',
        options: [
          { value: 'wow', label: 'Hold høyre museknapp (WoW-stil)', desc: 'Fri musepeker. Hold høyre knapp og dra for å se deg rundt.' },
          { value: 'fps', label: 'Låst mus (FPS)', desc: 'Musen styrer kameraet hele tiden. Esc frigjør musen.' },
        ],
      },
      {
        key: 'mouseSensitivity',
        type: 'slider',
        label: 'Musefølsomhet',
        min: 0.2,
        max: 3,
        step: 0.05,
        format: (v) => `${fmtNumber(v, 2)}×`,
      },
      { key: 'invertY', type: 'toggle', label: 'Inverter vertikal mus', help: 'Dra musen opp for å se ned.' },
      { key: 'turnWithKeys', type: 'toggle', label: 'A/D svinger', help: 'A og D snur karakteren i stedet for å gå sidelengs.' },
      { key: 'runToggle', type: 'toggle', label: 'Shift veksler gå/løp', help: 'Av: hold Shift inne for å løpe.' },
      { key: 'physicalBody', type: 'toggle', label: 'Fysisk person', help: 'Av: du er en skikkelse som glir gjennom møblene, uten skrittlyd. På: møblene stopper deg, du hører skrittene og kameraet gynger litt.' },
    ],
  },
  {
    id: 'graphics',
    label: 'Grafikk',
    icon: 'monitor',
    rows: [
      {
        key: 'quality',
        type: 'segment',
        label: 'Grafikkvalitet',
        help: 'Lavere kvalitet gir jevnere bilde på svake maskiner.',
        restartNote: 'Skygger og kantutjevning endres først neste gang du starter spillet.',
        options: [
          { value: 'low', label: 'Lav' },
          { value: 'medium', label: 'Middels' },
          { value: 'high', label: 'Høy' },
        ],
      },
      { key: 'autoResolution', type: 'toggle', label: 'Automatisk oppløsning', help: 'Senker oppløsningen litt når bildet blir hakkete (under ca. 50 bilder i sekundet), og øker den igjen når maskinen har krefter til overs.' },
      { key: 'fov', type: 'slider', label: 'Synsfelt (FOV)', min: 60, max: 95, step: 1, format: (v) => `${Math.round(v)}°` },
      { key: 'headBob', type: 'toggle', label: 'Hodebevegelse', help: 'Kameraet gynger litt når du går.' },
      { key: 'showFps', type: 'toggle', label: 'Vis bildefrekvens (FPS)' },
      { key: 'showHelpOnStart', type: 'toggle', label: 'Vis kontroller ved start' },
    ],
  },
  {
    id: 'audio',
    label: 'Lyd',
    icon: 'volume',
    rows: [
      { key: 'masterVolume', type: 'slider', label: 'Hovedvolum', min: 0, max: 1, step: 0.01, format: fmtPercent },
      { key: 'effectsVolume', type: 'slider', label: 'Effekter', help: 'Skritt, dører og menylyder.', min: 0, max: 1, step: 0.01, format: fmtPercent },
    ],
  },
];

let uid = 0;

export class SettingsPanel {
  /**
   * @param {import('../core/Settings.js').Settings} settings
   * @param {object} [o]
   * @param {string} [o.initialTab='mouse']
   * @param {boolean} [o.inGame=false]  opened from the pause menu (enables restart notes)
   */
  constructor(settings, { initialTab = 'mouse', inGame = false } = {}) {
    this.settings = settings;
    this.inGame = inGame;
    this._updaters = new Map();
    this._id = ++uid;

    const tabs = h('div.kv-tabs', { role: 'tablist', 'aria-label': 'Innstillinger' });
    const pages = h('div.kv-settings__pages');
    this._tabs = new Map();
    for (const g of SETTING_GROUPS) {
      const tabId = `kv-set-${this._id}-${g.id}`;
      const tab = h('button.kv-tab', {
        type: 'button',
        role: 'tab',
        id: `${tabId}-tab`,
        'aria-controls': tabId,
        on: { click: () => this.showTab(g.id) },
      }, svg(ICONS[g.icon]), h('span', { text: g.label }));
      const page = h('div.kv-settings__page', { role: 'tabpanel', id: tabId, 'aria-labelledby': `${tabId}-tab` }, g.rows.map((r) => this._row(r)));
      tabs.append(tab);
      pages.append(page);
      this._tabs.set(g.id, { tab, page });
    }

    const reset = h('button.kv-btn.kv-btn--ghost.kv-btn--sm', {
      type: 'button',
      on: { click: () => this._reset(reset) },
    }, svg(ICONS.reset), h('span', { text: 'Tilbakestill' }));
    const foot = h('div.kv-settings__foot', {}, h('span.kv-settings__note', {}, svg(ICONS.check), 'Endringer lagres automatisk'), reset);

    this.el = h('div.kv-settings', {}, tabs, pages, foot);
    this.showTab(initialTab);

    this._off = settings.on('change', ({ key, value }) => this._updaters.get(key)?.(value));
  }

  /** Switches the visible group. */
  showTab(id) {
    for (const [gid, { tab, page }] of this._tabs) {
      const on = gid === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      page.classList.toggle('is-active', on);
      page.inert = !on;
      page.setAttribute('aria-hidden', String(!on));
    }
    this.tab = id;
  }

  _reset(btn) {
    if (btn.dataset.confirm !== '1') {
      // two-step confirm without a modal: first click arms the button for 3 s
      btn.dataset.confirm = '1';
      btn.classList.add('is-armed');
      btn.querySelector('span').textContent = 'Klikk igjen for å tilbakestille';
      clearTimeout(this._resetTimer);
      this._resetTimer = setTimeout(() => this._disarm(btn), 3000);
      return;
    }
    this._disarm(btn);
    this.settings.reset();
  }

  _disarm(btn) {
    clearTimeout(this._resetTimer);
    btn.dataset.confirm = '';
    btn.classList.remove('is-armed');
    btn.querySelector('span').textContent = 'Tilbakestill';
  }

  _row(r) {
    const id = `kv-set-${this._id}-${r.key}`;
    const note = r.restartNote && this.inGame ? h('small.kv-setting__note', { hidden: true }, svg(ICONS.info), h('span', { text: r.restartNote })) : null;
    const label = h('div.kv-setting__label', {}, h('label', { for: id, text: r.label }), r.help ? h('small', { text: r.help }) : null, note);
    let control;
    let update;

    if (r.type === 'slider') {
      const input = h('input.kv-range', { type: 'range', id, min: String(r.min), max: String(r.max), step: String(r.step) });
      const out = h('output.kv-setting__value', { for: id });
      update = (v) => {
        input.value = String(v);
        const p = (Number(v) - r.min) / (r.max - r.min);
        input.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
        out.textContent = r.format ? r.format(Number(v)) : String(v);
      };
      input.addEventListener('input', () => {
        const v = Number(input.value);
        this.settings.set(r.key, v);
        update(v);
      });
      control = h('div.kv-setting__slider', {}, input, out);
    } else if (r.type === 'toggle') {
      const input = h('input.kv-switch__input', { type: 'checkbox', id, role: 'switch' });
      update = (v) => {
        input.checked = !!v;
      };
      input.addEventListener('change', () => this.settings.set(r.key, input.checked));
      control = h('label.kv-switch', { for: id }, input, h('span.kv-switch__track', {}, h('span.kv-switch__thumb')));
    } else {
      // segment / cards: radio group
      const name = id;
      const opts = r.options.map((o) => {
        const input = h('input', { type: 'radio', name, value: String(o.value) });
        input.addEventListener('change', () => input.checked && this.settings.set(r.key, o.value));
        const body = r.type === 'cards'
          ? h('span.kv-choice__body', {}, h('span.kv-choice__title', { text: o.label }), o.desc ? h('span.kv-choice__desc', { text: o.desc }) : null)
          : h('span.kv-choice__body', {}, h('span.kv-choice__title', { text: o.label }));
        const el = h(`label.kv-choice${r.type === 'cards' ? '.kv-choice--card' : ''}`, {}, input, body);
        return { o, input, el };
      });
      update = (v) => {
        for (const { o, input, el } of opts) {
          input.checked = o.value === v;
          el.classList.toggle('is-checked', o.value === v);
        }
      };
      control = h(`div.${r.type === 'cards' ? 'kv-choices' : 'kv-segment'}`, { role: 'radiogroup', 'aria-label': r.label }, opts.map((x) => x.el));
    }

    const initial = this.settings.get(r.key);
    update(initial);
    if (note) {
      const inner = update;
      update = (v) => {
        inner(v);
        note.hidden = v === initial;
      };
    }
    this._updaters.set(r.key, update);
    return h(`div.kv-setting.kv-setting--${r.type}`, {}, label, control);
  }

  /**
   * Stops following the settings (unsubscribes, clears timers). The element stays in the DOM: its owner removes
   * it, so a dialog can fade out with its content still visible.
   */
  dispose() {
    this._off?.();
    this._off = null;
    clearTimeout(this._resetTimer);
  }
}
