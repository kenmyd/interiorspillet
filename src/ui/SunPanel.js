// SunPanel – «Sol» (ARCHITECTURE §10, §12). Owned by «lighting».
// Time of day (05–23), date, presets, light mode, weather, where the sun stands, sunrise/sunset and daylight numbers,
// exposure and latitude. The lamps are in LightPanel («Belysning»), which also holds the shared base (EnvPanel) and
// the CSS of both panels.
// Everything that belongs to the design goes through design.setEnv (saved, undoable); latitude and weather are user
// settings (settings 'sunLatitude', 'lightWeather').
import { section, slider } from './panelKit.js';
import { h, fmtNumber } from './dom.js';
import { EnvPanel } from './LightPanel.js';
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
const DIRECTIONS = ['nord', 'nordøst', 'øst', 'sørøst', 'sør', 'sørvest', 'vest', 'nordvest'];

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

const SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';

export class SunPanel extends EnvPanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'sun', title: 'Sol', icon: 'sun' });
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
      const dir = DIRECTIONS[Math.round(((info.sunAzimuthDeg ?? 180) % 360) / 45) % 8];
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

    // facts (the lumens of the lamps are in «Belysning»)
    const rows = [];
    if (times.polarDay) rows.push(['Sola', 'Midnattssol – går ikke ned']);
    else if (times.polarNight) rows.push(['Sola', 'Mørketid – står ikke opp']);
    else {
      rows.push(['Soloppgang', fmtClock(times.sunrise)], ['Solnedgang', fmtClock(times.sunset)], ['Dagslengde', fmtDuration(times.dayLength)]);
    }
    rows.push(['Høyeste sol', `${fmtNumber(Math.max(0, times.maxAltitudeDeg), 0)}° kl. ${fmtClock(times.noon)}`]);
    if (info.indoorDaylightLux != null) rows.push(['Dagslys inne', info.indoorDaylightLux >= 1 ? `ca. ${fmtLux(info.indoorDaylightLux)} på gulvet` : 'ingen']);
    this.facts.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));

    // mode + weather
    const mode = env.mode ?? 'auto';
    this.modeSeg.set(mode);
    this.modeHint.textContent = MODES.find((m) => m[0] === mode)?.[2] ?? '';
    this.weatherSeg.set(info.weather ?? (this.settings?.get?.('lightWeather') === 'overcast' ? 'overcast' : 'clear'));

    // picture
    if (document.activeElement !== this.exposure.input) this.exposure.set(Math.round(Math.log2(env.exposure || 1) * 10) / 10);
    if (document.activeElement !== this.latitude.input) this.latitude.set(latitude);
    const here = this._roomList().find((r) => r.id === (this.lighting?.cameraRoomId ?? 'stue-kjokken'));
    const south = here ? here.south !== false : true;
    this.placeHint.textContent = `${south ? 'Vinduene står mot sør. ' : ''}Breddegraden og været lagres i innstillingene dine, resten lagres med designet.`;
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

export default SunPanel;
