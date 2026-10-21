// LightPanel – «Belysning» (ARCHITECTURE §10, §12). Owned by «lighting».
// The lamps of the house: the built-in light groups room by room (the room the camera is in first, each room with its
// own switch) and the design's lamps, each with on/off + dimmer and the «auto» badge, «Alle på / Alle av /
// Automatisk», and the lumens that are lit. The sun, the time of day, the light mode, the weather, the exposure and
// the latitude are in SunPanel («Sol»).
// Everything that belongs to the design goes through design.setEnv / design.update (saved, undoable).
//
// Also the shared base of both panels (EnvPanel: design/LightManager wiring, dirty flag, design.setEnv) and their CSS.
import { BasePanel, section, slider, toggle, button } from './panelKit.js';
import { h, fmtNumber } from './dom.js';

/** Level label of a room header on another level than the camera's (two rooms are called «Gang» and «Soverom»). */
const LEVEL_NAMES = { hoved: '1. etasje', kjeller: 'kjeller' };

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
.lp-sum { margin: 0 0 0.6em; }
.lp-empty { font-size: 0.85em; color: var(--kv-ink-3); margin: 0.3em 0; }
.lp-room { display: flex; align-items: center; gap: 0.6em; margin: 0.85em 0 0.15em; padding-top: 0.55em; border-top: 1px solid var(--kv-line-2); }
.lp-room:first-child { margin-top: 0.2em; border-top: 0; padding-top: 0; }
.lp-room__name { flex: 1; min-width: 0; font-size: 0.8em; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--kv-ink-2); }
.lp-room__name small { font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--kv-ink-4); margin-left: 0.4em; }
.lp-room__here { font-size: 0.72em; font-weight: 650; padding: 0.1em 0.5em; border-radius: 1em; background: var(--kv-accent-soft); color: var(--kv-ink); }
.lp-room + .lp-lamp { border-top: 0; }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  document.head.append(h('style', { dataset: { owner: 'LightPanel' }, text: CSS }));
}

/**
 * Shared base of «Belysning» (LightPanel) and «Sol» (SunPanel): a right-hand panel over the design's light settings
 * (design.env) and the LightManager. Subclasses implement _build() (called from the constructor, after design /
 * lighting / settings are set) and _refresh() (called on open and on the next update() after a change while open).
 */
export class EnvPanel extends BasePanel {
  /**
   * @param {import('../design/Editor.js').Editor} editor
   * @param {{ id: string, title: string, icon: string }} opts
   */
  constructor(editor, { id, title, icon }) {
    super(editor, { id, title, icon, side: 'right', width: 25 });
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

  _build() {}

  _refresh() {
    this._dirty = false;
  }

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

  /** Rooms of the house that have light groups (lighting.roomsInfo), or none (an older LightManager). */
  _roomList() {
    try {
      return this.lighting?.roomsInfo?.() ?? [];
    } catch {
      return [];
    }
  }
}

export class LightPanel extends EnvPanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'light', title: 'Belysning', icon: 'bulb' });
  }

  // ---- construction ----------------------------------------------------------------------------------------

  _build() {
    this.sum = h('dl.lp-facts.lp-sum');
    this.lampList = h('div.lp-lamps');
    const allRow = h('div.lp-allrow', {},
      button({ label: 'Alle på', icon: 'bulb', size: 'sm', onClick: () => this._allLamps(true) }),
      button({ label: 'Alle av', size: 'sm', variant: 'ghost', onClick: () => this._allLamps(false) }),
      button({ label: 'Automatisk', size: 'sm', variant: 'ghost', title: 'De faste lysene følger tiden på døgnet igjen', onClick: () => this._autoLamps() }),
    );
    const hint = h('p.lp-hint', { text: 'Lys merket «auto» slår seg av og på etter tiden på døgnet – klokka og lysmodusen stiller du under «Sol» (T).' });
    this.body.append(section('Lamper', this.sum, allRow, this.lampList, hint));
  }

  // ---- writes ----------------------------------------------------------------------------------------------

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

  // ---- refresh ---------------------------------------------------------------------------------------------

  _refresh() {
    this._dirty = false;
    const info = this.lighting?.info?.() ?? {};
    const rows = [];
    if (info.lampLumens != null) rows.push(['Lamper på', info.lampLumens > 0 ? `${fmtNumber(info.lampLumens, 0)} lumen` : 'ingen']);
    this.sum.hidden = !rows.length;
    this.sum.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
    this._refreshLamps();
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

export default LightPanel;
