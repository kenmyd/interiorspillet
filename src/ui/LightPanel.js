// LightPanel – «Lys og sol» (ARCHITECTURE §10, §12). Owned by «lighting».
// Time of day (05–23), date, presets, light mode, weather, the built-in light groups and the design's lamps with
// on/off + dimmer, «Alle lamper på/av», sunrise/sunset and daylight numbers, exposure and latitude.
// Everything that belongs to the design goes through design.setEnv / design.update (saved, undoable); latitude and
// weather are user settings (settings 'sunLatitude', 'lightWeather').
import { BasePanel, section, field, slider, toggle, button } from './panelKit.js';
import { h, fmtNumber } from './dom.js';
import { sunTimes, dayOfYear, dateFromDayOfYear, SITE, PHOTO_ENV } from '../home/lighting.js';

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const MODES = [
  ['auto', 'Automatisk', 'Lyset følger klokka og datoen. De faste lysene slår seg på når dagslyset inne blir svakt.'],
  ['day', 'Dagslys', 'Alltid dagslys, og de faste lysene er av. Er det mørkt på valgt klokkeslett, står sola slik den gjør nærmest på dagen når den er kommet over åsene.'],
  ['evening', 'Kveldslys', 'Blå time ute og lampene på – uansett årstid.'],
  ['night', 'Natt', 'Mørkt ute og lampene på.'],
];
const WEATHER = [
  ['clear', 'Sol'],
  ['overcast', 'Overskyet'],
];
const SEASONS = [
  ['Vinter', 12, 21],
  ['Vår', 3, 20],
  ['Sommer', 6, 21],
  ['Høst', 9, 23],
];
const COMPASS = ['nord', 'nordøst', 'øst', 'sørøst', 'sør', 'sørvest', 'vest', 'nordvest'];
/** Level label of a room header on another level than the camera's (two rooms are called «Gang» and «Soverom»). */
const LEVEL_NAMES = { hoved: '1. etasje', kjeller: 'kjeller' };

/** «13:05» from decimal hours. */
export function fmtClock(hours) {
  if (hours == null || !Number.isFinite(hours)) return '–';
  let m = Math.round(hours * 60);
  m = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** «15. juni». */
export function fmtDate(month, day) {
  return `${day}. ${MONTHS[(month - 1 + 12) % 12]}`;
}

function fmtDuration(hours) {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)} t ${m % 60} min`;
}

const CSS = `
.lp .ip-section { margin-bottom: 1.05em; }
.lp-now { display: flex; align-items: baseline; gap: 0.6em; margin: 0 0 0.35em; }
.lp-now__time { font: 760 2em/1 var(--kv-font-display); letter-spacing: 0.01em; font-variant-numeric: tabular-nums; }
.lp-now__date { font-size: 1em; color: var(--kv-ink-2); }
.lp-sunline { display: flex; align-items: center; gap: 0.5em; font-size: 0.88em; color: var(--kv-ink-2); margin-bottom: 0.4em; }
.lp-sunline svg { width: 1.25em; height: 1.25em; flex: none; color: var(--kv-accent); }
.lp-sunline.is-down svg { color: var(--kv-ink-4); }
.lp-chips { display: flex; flex-wrap: wrap; gap: 0.35em; margin: 0.25em 0 0.2em; }
.lp-chip { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 4.6em; padding: 0.38em 0.55em;
  border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line-2); background: rgba(255,255,255,0.04); color: var(--kv-ink);
  font: inherit; font-size: 0.84em; line-height: 1.15; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.lp-chip small { font-size: 0.8em; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.lp-chip:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.26); }
.lp-chip.is-active { border-color: var(--kv-accent); background: var(--kv-accent-soft); }
.lp-seg { display: flex; padding: 0.2em; gap: 0.2em; border-radius: calc(var(--kv-r) + 0.1em); background: rgba(0,0,0,0.28); border: 1px solid var(--kv-line); }
.lp-seg button { flex: 1; min-width: 0; padding: 0.42em 0.3em; border: 0; border-radius: var(--kv-r); background: none; color: var(--kv-ink-2);
  font: inherit; font-size: 0.86em; font-weight: 620; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-seg button:hover { color: var(--kv-ink); }
.lp-seg button.is-active { background: var(--kv-accent); color: var(--kv-accent-ink); }
.lp-hint { margin: 0.45em 0 0; font-size: 0.8em; color: var(--kv-ink-3); line-height: 1.35; }
.lp-facts { display: grid; grid-template-columns: auto 1fr; gap: 0.25em 0.9em; margin: 0.5em 0 0; font-size: 0.85em; }
.lp-facts dt { color: var(--kv-ink-3); }
.lp-facts dd { margin: 0; color: var(--kv-ink); font-variant-numeric: tabular-nums; }
.lp-lamp { padding: 0.45em 0 0.5em; border-top: 1px solid var(--kv-line); }
.lp-lamp:first-of-type { border-top: 0; }
.lp-lamp__head { display: flex; align-items: center; gap: 0.6em; }
.lp-lamp__name { flex: 1; min-width: 0; font-size: 0.9em; }
.lp-lamp__name small { display: block; color: var(--kv-ink-4); font-size: 0.82em; }
.lp-lamp__auto { font-size: 0.72em; font-weight: 650; padding: 0.1em 0.5em; border-radius: 1em; background: var(--kv-surface-3); color: var(--kv-ink-3); }
.lp-lamp .ip-slider { margin-top: 0.3em; }
.lp-lamp.is-off .ip-slider { opacity: 0.45; }
.lp-allrow { display: flex; gap: 0.4em; flex-wrap: wrap; margin-bottom: 0.4em; }
.lp-allrow .kv-btn { flex: 1; }
.lp-empty { font-size: 0.85em; color: var(--kv-ink-3); margin: 0.3em 0; }
.lp-room { display: flex; align-items: center; gap: 0.6em; margin: 0.85em 0 0.15em; padding-top: 0.55em; border-top: 1px solid var(--kv-line-2); }
.lp-room:first-child { margin-top: 0.2em; border-top: 0; padding-top: 0; }
.lp-room__name { flex: 1; min-width: 0; font-size: 0.8em; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--kv-ink-2); }
.lp-room__name small { font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--kv-ink-4); margin-left: 0.4em; }
.lp-room__here { font-size: 0.72em; font-weight: 650; padding: 0.1em 0.5em; border-radius: 1em; background: var(--kv-accent-soft); color: var(--kv-ink); }
.lp-room + .lp-lamp { border-top: 0; }
`;

const SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  document.head.append(h('style', { dataset: { owner: 'LightPanel' }, text: CSS }));
}

export class LightPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'light', title: 'Lys og sol', icon: 'bulb', side: 'right', width: 25 });
    injectCss();
    this.el.classList.add('lp');
    this.design = editor.design;
    this.lighting = editor.home?.lighting ?? null;
    this.settings = editor.game?.settings ?? editor.settings ?? null;
    this._dirty = true;
    this._lampsDirty = true;
    this._offs = [];
    this._build();
    const mark = () => (this._dirty = true);
    const markLamps = () => {
      this._dirty = true;
      this._lampsDirty = true;
    };
    if (this.design?.on) {
      this._offs.push(this.design.on('env', mark), this.design.on('load', markLamps));
      for (const ev of ['item:add', 'item:remove']) this._offs.push(this.design.on(ev, markLamps));
      this._offs.push(this.design.on('item:update', ({ patch }) => {
        if (patch && ('light' in patch || 'name' in patch || 'hidden' in patch)) mark();
      }));
    }
    if (this.lighting?.on) this._offs.push(this.lighting.on('change', mark));
  }

  /** Called by open(arg) before the panel is shown. */
  onOpen() {
    this._dirty = true;
    this._lampsDirty = true;
    this._refresh();
  }

  update() {
    if (!this.isOpen || !this._dirty) return;
    this._refresh();
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs = [];
    super.dispose();
  }

  // ---- construction ----------------------------------------------------------------------------------------

  _build() {
    const env = this.design?.env ?? { hour: 13, month: 6, day: 15, mode: 'auto', exposure: 1 };

    // time + date
    this.timeEl = h('span.lp-now__time');
    this.dateEl = h('span.lp-now__date');
    this.sunIcon = h('span');
    this.sunText = h('span');
    this.sunLine = h('div.lp-sunline', {}, this.sunIcon, this.sunText);
    this.hour = slider({
      label: 'Klokkeslett', min: 5, max: 23, step: 0.25, value: clampHour(env.hour), format: fmtClock,
      onInput: (v) => this._setEnv({ hour: v }),
    });
    const doy = dayOfYear(env.month, env.day);
    this.date = slider({
      label: 'Dato', min: 1, max: 365, step: 1, value: doy,
      format: (v) => {
        const d = dateFromDayOfYear(v);
        return fmtDate(d.month, d.day);
      },
      onInput: (v) => this._setEnv(dateFromDayOfYear(v)),
    });
    this.presetRow = h('div.lp-chips');
    this.seasonRow = h('div.lp-chips', {},
      SEASONS.map(([label, month, day]) => h('button.lp-chip', { type: 'button', dataset: { m: month, d: day }, on: { click: () => this._setEnv({ month, day }) } },
        h('span', { text: label }), h('small', { text: fmtDate(month, day) }))),
      h('button.lp-chip', { type: 'button', dataset: { today: '1' }, on: { click: () => {
        const now = new Date();
        this._setEnv({ month: now.getMonth() + 1, day: now.getDate() });
      } } }, h('span', { text: 'I dag' }), h('small', { text: fmtDate(new Date().getMonth() + 1, new Date().getDate()) })),
    );
    this.facts = h('dl.lp-facts');
    this.body.append(section('Tid og dato',
      h('div.lp-now', {}, this.timeEl, this.dateEl),
      this.sunLine,
      this.hour.el,
      this.presetRow,
      this.date.el,
      this.seasonRow,
      this.facts,
    ));

    // mode + weather
    this.modeSeg = this._segment(MODES.map(([v, l]) => [v, l]), (v) => this._setEnv({ mode: v }));
    this.modeHint = h('p.lp-hint');
    this.weatherSeg = this._segment(WEATHER, (v) => this.settings?.set?.('lightWeather', v));
    this.body.append(section('Lysmodus', this.modeSeg.el, this.modeHint), section('Vær', this.weatherSeg.el));

    // lamps
    this.lampList = h('div.lp-lamps');
    const allRow = h('div.lp-allrow', {},
      button({ label: 'Alle på', icon: 'bulb', size: 'sm', onClick: () => this._allLamps(true) }),
      button({ label: 'Alle av', size: 'sm', variant: 'ghost', onClick: () => this._allLamps(false) }),
      button({ label: 'Automatisk', size: 'sm', variant: 'ghost', title: 'De faste lysene følger tiden på døgnet igjen', onClick: () => this._autoLamps() }),
    );
    this.body.append(section('Lamper', allRow, this.lampList));

    // picture
    const ev = Math.log2(env.exposure || 1);
    this.exposure = slider({
      label: 'Lysstyrke på bildet', min: -2, max: 2, step: 0.1, value: ev,
      format: (v) => (Math.abs(v) < 0.05 ? 'Auto' : `${v > 0 ? '+' : '−'}${fmtNumber(Math.abs(v), 1)} EV`),
      onInput: (v) => this._setEnv({ exposure: Math.pow(2, v) }),
    });
    const lat = Number(this.settings?.get?.('sunLatitude')) || SITE.latitude;
    this.latitude = slider({
      label: 'Breddegrad', min: 54, max: 71, step: 0.1, value: lat,
      format: (v) => `${fmtNumber(v, 1)}° N`,
      onInput: (v) => this.settings?.set?.('sunLatitude', Math.round(v * 10) / 10),
    });
    // «Vinduene står mot sør» only where the room the camera is in has a south window (§4.10)
    this.placeHint = h('p.lp-hint');
    this.body.append(section('Bilde og sted',
      this.exposure.el,
      this.latitude.el,
      this.placeHint,
    ));
  }

  /** Segmented buttons. @returns {{ el: HTMLElement, set: (v: string) => void }} */
  _segment(options, onPick) {
    const btns = new Map();
    const el = h('div.lp-seg', { role: 'radiogroup' }, options.map(([v, label]) => {
      const b = h('button', { type: 'button', role: 'radio', text: label, title: label, on: { click: () => onPick(v) } });
      btns.set(v, b);
      return b;
    }));
    return {
      el,
      set(v) {
        for (const [k, b] of btns) {
          b.classList.toggle('is-active', k === v);
          b.setAttribute('aria-checked', k === v ? 'true' : 'false');
        }
      },
    };
  }

  // ---- writes ----------------------------------------------------------------------------------------------

  _setEnv(patch) {
    if (!this.design?.setEnv) {
      // no design (should not happen in the game): drive the lights directly
      if ('hour' in patch || 'month' in patch) this.lighting?.setTime?.(patch);
      if ('mode' in patch) this.lighting?.setMode?.(patch.mode);
      if ('exposure' in patch) this.lighting?.setExposure?.(patch.exposure);
      this._dirty = true;
      return;
    }
    this.design.setEnv(patch);
  }

  _setGroup(id, state) {
    const cur = this.lighting?.groupState?.(id) ?? { on: true, dimmer: 1 };
    this._setEnv({ builtIn: { [id]: { on: state.on ?? cur.on, dimmer: state.dimmer ?? cur.dimmer } } });
  }

  _setItem(uid, light, coalesce) {
    this.design?.update?.(uid, { light }, coalesce ? { coalesce: 'light', label: 'Dimme lampe' } : { label: light.on === false ? 'Slå av lampe' : 'Slå på lampe' });
  }

  _allLamps(on) {
    const groups = this.lighting?.builtInGroups ?? [];
    const run = () => {
      const builtIn = {};
      for (const g of groups) {
        const cur = this.lighting.groupState(g.id);
        builtIn[g.id] = { on, dimmer: on && cur.dimmer < 0.05 ? 1 : cur.dimmer };
      }
      if (groups.length) this.design.setEnv({ builtIn });
      for (const uid of this._lampUids()) {
        const it = this.design.get(uid);
        if (!it) continue;
        const cur = it.light || {};
        if ((cur.on !== false) !== on) this.design.update(uid, { light: { ...cur, on, dimmer: on && (cur.dimmer ?? 1) < 0.05 ? 1 : cur.dimmer ?? 1 } });
      }
    };
    if (this.design?.transaction) this.design.transaction(on ? 'Alle lamper på' : 'Alle lamper av', run);
    else run();
  }

  _autoLamps() {
    const groups = this.lighting?.builtInGroups ?? [];
    if (!groups.length) return;
    this._setEnv({ builtIn: Object.fromEntries(groups.map((g) => [g.id, null])) });
  }

  _lampUids() {
    const uids = this.lighting?.itemLightUids?.() ?? [];
    return uids.filter((u) => {
      const it = this.design?.get?.(u);
      return it && !it.hidden;
    });
  }

  // ---- refresh ---------------------------------------------------------------------------------------------

  _refresh() {
    this._dirty = false;
    const env = this.design?.env ?? {};
    const info = this.lighting?.info?.() ?? {};
    const hour = env.hour ?? 13;
    const month = env.month ?? 6;
    const day = env.day ?? 15;
    const latitude = info.latitude ?? SITE.latitude;

    this.timeEl.textContent = fmtClock(hour);
    this.dateEl.textContent = fmtDate(month, day);
    if (document.activeElement !== this.hour.input) this.hour.set(clampHour(hour));
    if (document.activeElement !== this.date.input) this.date.set(dayOfYear(month, day));

    // sun line
    const up = (info.sunAltitudeDeg ?? -1) > 0;
    this.sunLine.classList.toggle('is-down', !up);
    this.sunIcon.replaceChildren(svgEl(up ? SUN_SVG : MOON_SVG));
    if (up) {
      const dir = COMPASS[Math.round(((info.sunAzimuthDeg ?? 180) % 360) / 45) % 8];
      let where = '';
      if (info.weather === 'overcast') where = ' – bak skyene';
      else if (info.sunBlocked) where = ' – men bak åsene, så den skinner ikke inn ennå';
      else if (info.sunFiltered) where = info.sunInRoom ? ' og skinner svakt inn gjennom trærne' : ' bak trærne';
      else if (info.sunInRoom) where = ' og skinner inn';
      const moved = env.mode === 'day' && info.effectiveHour != null && Math.abs(info.effectiveHour - hour) > 0.05 ? ` (som kl. ${fmtClock(info.effectiveHour)})` : '';
      this.sunText.textContent = `Sola står ${fmtNumber(info.sunAltitudeDeg, 0)}° over horisonten i ${dir} (${fmtNumber(info.sunAzimuthDeg, 0)}°)${where}${moved}.`;
    } else if ((info.sunAltitudeDeg ?? -10) > -6) {
      this.sunText.textContent = 'Sola er like under horisonten – skumring.';
    } else {
      this.sunText.textContent = 'Sola er under horisonten.';
    }

    // presets (Kveld follows late summer sunsets so it is dusk with the lamps on)
    const times = sunTimes({ month, day, latitude });
    const eveningHour = times.sunset != null ? Math.max(19.5, Math.min(22.5, quarter(times.sunset + 0.5))) : 20;
    const presets = [
      ['Morgen', 7.5],
      ['Formiddag', 10.5],
      ['Ettermiddag', 15],
      ['Kveld', eveningHour],
      ['Natt', 23],
    ];
    const isPhoto = (env.mode ?? 'auto') === PHOTO_ENV.mode && Math.abs(hour - PHOTO_ENV.hour) < 0.01 && month === PHOTO_ENV.month && day === PHOTO_ENV.day;
    this.presetRow.replaceChildren(...presets.map(([label, hh]) => h(`button.lp-chip${!isPhoto && Math.abs(hh - hour) < 0.01 && (env.mode ?? 'auto') === 'auto' ? '.is-active' : ''}`, {
      type: 'button', title: `${label} kl. ${fmtClock(hh)}`,
      on: { click: () => this._setEnv({ hour: hh, mode: 'auto' }) },
    }, h('span', { text: label }), h('small', { text: fmtClock(hh) }))),
    // the light of the photos and the photomontages (18 October, 08:30, the sun still behind the hills, lamps on)
    h(`button.lp-chip${isPhoto ? '.is-active' : ''}`, {
      type: 'button', title: `Lyset da bildene av stua ble tatt: ${fmtDate(PHOTO_ENV.month, PHOTO_ENV.day)} kl. ${fmtClock(PHOTO_ENV.hour)}`,
      on: { click: () => this._setEnv({ ...PHOTO_ENV }) },
    }, h('span', { text: 'Som på bildene' }), h('small', { text: `${PHOTO_ENV.day}. okt. ${fmtClock(PHOTO_ENV.hour)}` })));
    for (const b of this.seasonRow.children) {
      const m = Number(b.dataset.m), d = Number(b.dataset.d);
      const active = b.dataset.today ? month === new Date().getMonth() + 1 && day === new Date().getDate() : m === month && d === day;
      b.classList.toggle('is-active', active);
    }

    // facts
    const rows = [];
    if (times.polarDay) rows.push(['Sola', 'Midnattssol – går ikke ned']);
    else if (times.polarNight) rows.push(['Sola', 'Mørketid – står ikke opp']);
    else {
      rows.push(['Soloppgang', fmtClock(times.sunrise)], ['Solnedgang', fmtClock(times.sunset)], ['Dagslengde', fmtDuration(times.dayLength)]);
    }
    rows.push(['Høyeste sol', `${fmtNumber(Math.max(0, times.maxAltitudeDeg), 0)}° kl. ${fmtClock(times.noon)}`]);
    if (info.indoorDaylightLux != null) rows.push(['Dagslys inne', info.indoorDaylightLux >= 1 ? `ca. ${fmtLux(info.indoorDaylightLux)} på gulvet` : 'ingen']);
    if (info.lampLumens != null) rows.push(['Lamper på', info.lampLumens > 0 ? `${fmtNumber(info.lampLumens, 0)} lumen` : 'ingen']);
    this.facts.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));

    // mode + weather
    const mode = env.mode ?? 'auto';
    this.modeSeg.set(mode);
    this.modeHint.textContent = MODES.find((m) => m[0] === mode)?.[2] ?? '';
    this.weatherSeg.set(info.weather ?? (this.settings?.get?.('lightWeather') === 'overcast' ? 'overcast' : 'clear'));

    // lamps
    this._refreshLamps();

    // picture
    if (document.activeElement !== this.exposure.input) this.exposure.set(Math.round(Math.log2(env.exposure || 1) * 10) / 10);
    if (document.activeElement !== this.latitude.input) this.latitude.set(latitude);
    const here = this._roomList().find((r) => r.id === (this.lighting?.cameraRoomId ?? 'stue-kjokken'));
    const south = here ? here.south !== false : true;
    this.placeHint.textContent = `${south ? 'Vinduene står mot sør. ' : ''}Breddegraden og været lagres i innstillingene dine, resten lagres med designet.`;
  }

  /** Rooms of the house that have light groups (lighting.roomsInfo), or none (an older LightManager). */
  _roomList() {
    try {
      return this.lighting?.roomsInfo?.() ?? [];
    } catch {
      return [];
    }
  }

  /** All groups of a room on or off as one change (§4.10: every room has its own switch). */
  _setRoom(groupIds, on) {
    const L = this.lighting;
    const builtIn = {};
    for (const id of groupIds) {
      const cur = L.groupState(id);
      builtIn[id] = { on, dimmer: on && cur.dimmer < 0.05 ? 1 : cur.dimmer };
    }
    if (groupIds.length) this._setEnv({ builtIn });
  }

  _refreshLamps() {
    const L = this.lighting;
    const specs = [];
    const groupSpec = (g) => {
      const st = L.groupState(g.id);
      return {
        key: `g:${g.id}`,
        name: g.label,
        sub: g.lumens ? `${fmtNumber(g.lumens, 0)} lumen` : '',
        on: st.on,
        dimmer: st.dimmer,
        auto: st.auto,
        dimmable: g.dimmable !== false,
        onToggle: (on) => {
          const cur = L.groupState(g.id);
          this._setGroup(g.id, { on, dimmer: on && cur.dimmer < 0.05 ? 1 : cur.dimmer });
        },
        onDim: (v) => this._setGroup(g.id, { on: v > 0.001, dimmer: v }),
      };
    };
    // grouped by room (§4.10): the room the camera is in first, each room with its own switch; groups of no single
    // room (boder, ute) last
    const groups = L?.builtInGroups ?? [];
    const rooms = this._roomList();
    const here = L?.cameraRoomId ?? 'stue-kjokken';
    const sections = [];
    if (rooms.length) {
      const named = new Map(rooms.map((r) => [r.id, r]));
      const ids = [...new Set(groups.map((g) => g.roomId ?? null))];
      const order = [here, ...rooms.map((r) => r.id).filter((id) => id !== here), ...ids.filter((id) => id && !named.has(id)), null];
      // the basement has a «Gang» and a «Soverom» too: a room on another level than the camera's carries its level
      const camLevel = named.get(here)?.levelId ?? 'hoved';
      for (const id of order) {
        const list = groups.filter((g) => (g.roomId ?? null) === id);
        if (!list.length || sections.some((s) => s.id === id)) continue;
        const lv = named.get(id)?.levelId;
        const level = lv && lv !== camLevel ? LEVEL_NAMES[lv] ?? lv : '';
        sections.push({ id, name: id === null ? 'Andre' : named.get(id)?.name ?? id, level, list, here: id === here });
      }
    } else sections.push({ id: '', name: '', level: '', list: groups, here: false });
    for (const s of sections) {
      if (s.name) {
        const anyOn = s.list.some((g) => L.groupState(g.id).on);
        specs.push({
          key: `r:${s.id}:${s.level}`, header: true, name: s.name, level: s.level, sub: s.here ? 'her' : '', on: anyOn,
          onToggle: (on) => this._setRoom(s.list.map((g) => g.id), on),
        });
      }
      for (const g of s.list) specs.push(groupSpec(g));
    }
    const uids = this._lampUids();
    const firstItem = specs.length;
    for (const uid of uids) {
      const it = this.design.get(uid);
      const light = it.light || {};
      specs.push({
        key: `i:${uid}`,
        name: it.name || 'Lampe',
        sub: light.colorK ? `${fmtNumber(light.colorK, 0)} K` : '',
        on: light.on !== false,
        dimmer: light.dimmer ?? 1,
        auto: false,
        onToggle: (on) => {
          const cur = this.design.get(uid)?.light || {};
          this._setItem(uid, { on, dimmer: on && (cur.dimmer ?? 1) < 0.05 ? 1 : cur.dimmer ?? 1 });
        },
        onDim: (v) => this._setItem(uid, { on: v > 0.001, dimmer: v }, true),
      });
    }
    const keys = specs.map((x) => `${x.key}|${x.name}|${x.sub}`).join(',');
    if (keys === this._lampKeys && this._lampRows && !this._lampsDirty) {
      // same rows: update them in place (a slider being dragged keeps its element)
      specs.forEach((spec, i) => this._lampRows[i].sync(spec));
      return;
    }
    this._lampsDirty = false;
    this._lampKeys = keys;
    this._lampRows = specs.map((spec) => this._lampRow(spec));
    const rows = this._lampRows.map((r) => r.el);
    // replaceChildren() turns null into the text «null» – only real nodes go in
    this.lampList.replaceChildren(...[
      ...rows.slice(0, firstItem),
      rows.length > firstItem ? h('h4.ip-section__title', { text: 'Lamper i designet', style: { marginTop: '0.8em' } }) : null,
      ...rows.slice(firstItem),
      !rows.length ? h('p.lp-empty', { text: 'Ingen lamper i rommet.' }) : null,
    ].filter(Boolean));
  }

  /** One lamp row: name, «auto» badge, on/off switch and a dimmer – or a room's header with its own switch. */
  _lampRow(spec) {
    let cur = spec;
    if (spec.header) {
      const tg = toggle({ label: '', value: spec.on, onChange: (v) => cur.onToggle(v) });
      const hereEl = h('span.lp-room__here', { text: 'Her', title: 'Rommet du står i' });
      const el = h('div.lp-room', {}, h('div.lp-room__name', {}, h('span', { text: spec.name }), spec.level ? h('small', { text: spec.level }) : null), hereEl, tg.el);
      const sync = (s) => {
        cur = s;
        hereEl.hidden = s.sub !== 'her';
        tg.set(s.on);
      };
      sync(spec);
      return { el, sync };
    }
    const tg = toggle({ label: '', value: spec.on, onChange: (v) => cur.onToggle(v) });
    const sl = slider({ min: 0, max: 1, step: 0.01, value: spec.dimmer, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => cur.onDim(v) });
    const badgeEl = h('span.lp-lamp__auto', { text: 'auto', title: 'Følger tiden på døgnet' });
    const el = h('div.lp-lamp', {},
      h('div.lp-lamp__head', {},
        h('div.lp-lamp__name', {}, h('span', { text: spec.name }), spec.sub ? h('small', { text: spec.sub }) : null),
        badgeEl,
        tg.el),
      sl.el);
    const sync = (s) => {
      cur = s;
      el.classList.toggle('is-off', !s.on);
      badgeEl.hidden = !s.auto;
      tg.set(s.on);
      sl.el.hidden = s.dimmable === false;
      if (document.activeElement !== sl.input) sl.set(s.dimmer);
    };
    sync(spec);
    return { el, sync };
  }
}

function clampHour(v) {
  return Math.max(5, Math.min(23, Number(v) || 13));
}

function quarter(v) {
  return Math.round(v * 4) / 4;
}

function fmtLux(v) {
  if (v >= 10000) return `${fmtNumber(Math.round(v / 1000) * 1000, 0)} lux`;
  if (v >= 1000) return `${fmtNumber(Math.round(v / 100) * 100, 0)} lux`;
  if (v >= 100) return `${fmtNumber(Math.round(v / 10) * 10, 0)} lux`;
  return `${fmtNumber(Math.round(v), 0)} lux`;
}

function svgEl(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export default LightPanel;
