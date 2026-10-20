import { BasePanel, section, button, iconButton, badge, emptyState, confirmDialog } from './panelKit.js';
import { h, svg, fmtNumber } from './dom.js';
import { ICONS } from './icons.js';

/**
 * «Design» panel (M) – ARCHITECTURE §7 Saves, §12: save the current design under a name, the list of saved designs
 * (open, rename, delete with confirmation), «Original» (today's room, always available), export to a .json file,
 * import from a file and the autosave status.
 *
 *   new SavePanel(editor) – open() / close() / toggle() / isOpen / update() / dispose()
 *
 * Uses editor.saves (design/Saves.js). Opening a design is undoable (Saves keeps it in the history). While «Før» is
 * shown (Toolbar), the panel switches back to the design first so nothing is saved from the original by mistake.
 */

const S = (body) => `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  save: S('<path d="M5 4.5h11l3.5 3.5v10.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 6 4.5z"/><path d="M8 4.5v5h7v-5M8 20v-6h8v6"/>'),
  pen: S('<path d="M15.5 5.5 18.5 8.5 9 18H6v-3z"/><path d="M13.5 7.5l3 3"/>'),
  trash: S('<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  down: S('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  up: S('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 19.5h14"/>'),
  cloud: S('<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5a4.5 4.5 0 0 0 0 9z"/><path d="M9.5 14l2 2 3.5-3.5"/>'),
};

const CSS = `
.ips-panel .ip-panel__body { padding-top: 0.9em; }
.ips-save { display: flex; gap: 0.5em; }
.ips-save .ip-input { flex: 1; min-width: 0; height: 2.4em; }
.ips-save .kv-btn { height: 2.4em; }
.ips-status { display: flex; gap: 0.5em; align-items: flex-start; margin-top: 0.6em; font-size: 0.82em; color: var(--kv-ink-3); line-height: 1.4; }
.ips-status .kv-icon { width: 1.15em; height: 1.15em; flex: none; margin-top: 0.05em; }
.ips-status.is-ok .kv-icon { color: var(--kv-ok); }
.ips-status.is-warn { color: #ffd98a; }
.ips-status.is-warn .kv-icon { color: #ffc850; }
.ips-list { display: flex; flex-direction: column; gap: 0.4em; }
.ips-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.4em 0.6em; padding: 0.55em 0.55em 0.55em 0.75em;
  border-radius: var(--kv-r); border: 1px solid var(--kv-line); background: var(--kv-surface); }
.ips-row.is-active { border-color: rgba(255, 181, 46, 0.45); background: var(--kv-accent-soft); }
.ips-row__main { min-width: 0; }
.ips-row__name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2em 0.45em; font-weight: 650; min-width: 0; }
.ips-row__name > span:not(.ip-badge) { overflow-wrap: anywhere; min-width: 0; line-height: 1.25; }
.ips-row__name .ip-badge { flex: none; }
.ips-row__name .kv-icon { flex: none; }
.ips-row__meta { font-size: 0.78em; color: var(--kv-ink-3); margin-top: 0.15em; line-height: 1.35; overflow-wrap: anywhere; }
.ips-row:not(:has(.ips-row__acts)) { grid-template-columns: minmax(0, 1fr); }
.ips-row--work .ips-row__name > span:not(.ip-badge) { font-style: italic; }
.ips-row__acts { display: flex; gap: 0.3em; align-items: center; }
.ips-row__acts .kv-iconbtn { width: 2.1em; height: 2.1em; }
.ips-row__acts .kv-iconbtn .kv-icon { width: 1.05em; height: 1.05em; }
.ips-row__acts .kv-btn { height: 2.1em; }
.ips-row .ip-input { height: 2.1em; }
.ips-del:hover { color: #ffb3aa; border-color: rgba(255, 106, 92, 0.4); background: var(--kv-danger-soft); }
.ips-files { display: flex; gap: 0.5em; flex-wrap: wrap; }
.ips-files .kv-btn .kv-icon { width: 1.05em; height: 1.05em; }
.ips-hint { font-size: 0.8em; color: var(--kv-ink-3); margin: 0.6em 0 0; line-height: 1.45; }
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

const pad = (n) => String(n).padStart(2, '0');

/** «18.10.2026 kl. 14:32» (today: «i dag kl. 14:32»). */
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = `kl. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `i dag ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `i går ${time}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${time}`;
}

export class SavePanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'saves', title: 'Design', icon: 'home', side: 'right', width: 25, className: 'ips-panel' });
    injectCss('ips-css', CSS);
    this.renaming = null;
    this._lastAuto = null;
    this._pending = false;
    this._timer = 0;

    this.nameInput = h('input.ip-input', { type: 'text', maxLength: 60, placeholder: 'Navn på designet', 'aria-label': 'Navn på designet', spellcheck: false });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveAs(this.nameInput.value);
      }
    });
    const saveBtn = button({ label: 'Lagre', variant: 'primary', title: 'Lagre designet under dette navnet', onClick: () => this.saveAs(this.nameInput.value) });
    saveBtn.prepend(svg(IC.save));
    this.statusEl = h('div.ips-status');
    this.listEl = h('div.ips-list');
    const exp = button({ label: 'Eksporter til fil', size: 'sm', title: 'Last ned designet som en .json-fil (kan åpnes på en annen maskin)', onClick: () => this.exportFile() });
    exp.prepend(svg(IC.down));
    const imp = button({ label: 'Importer fra fil', size: 'sm', title: 'Åpne et design fra en .json-fil', onClick: () => this.importFile() });
    imp.prepend(svg(IC.up));

    this.body.append(
      section('Lagre dette designet', h('div.ips-save', {}, this.nameInput, saveBtn), this.statusEl),
      section('Lagrede design', this.listEl),
      section('Fil', h('div.ips-files', {}, exp, imp),
        h('p.ips-hint', { text: 'Designene lagres i denne nettleseren. Eksporter til fil for å ta vare på et design, dele det eller åpne det på en annen maskin.' })),
    );

    this._offs = [
      editor.design.on('change', (e) => {
        if (e?.type === 'load' || e?.type === 'meta') return;
        if (editor.ui?.toolbar?.compareActive) return;
        this._pending = true;
        clearTimeout(this._timer);
        // Saves autosaves 1.2 s after the last change
        this._timer = setTimeout(() => {
          this._pending = false;
          this._lastAuto = new Date();
          if (this.isOpen) this._renderStatus();
        }, 1400);
        if (this.isOpen) {
          this._renderStatus();
          this._listDirty = true; // «Ulagret design» / «Åpen nå» follow the design
        }
      }),
      editor.design.on('load', () => {
        if (this.isOpen) this._render();
      }),
    ];
  }

  get saves() {
    return this.editor.saves;
  }

  onOpen() {
    this.editor.ui?.toolbar?.exitCompare?.({ quiet: true });
    this.renaming = null;
    this._render();
  }

  _render() {
    const saves = this.saves;
    const d = this.editor.design;
    if (document.activeElement !== this.nameInput) {
      const active = saves?.activeName;
      this.nameInput.value = active || (d.meta?.name && d.meta.name !== 'Original' && d.meta.name !== 'Uten navn' ? d.meta.name : saves?.uniqueName?.('Mitt design') || 'Mitt design');
    }
    this._renderStatus();
    this._renderList();
  }

  _renderStatus() {
    const saves = this.saves;
    const el = this.statusEl;
    if (!saves) {
      el.className = 'ips-status is-warn';
      el.replaceChildren(svg(ICONS.warning), h('span', { text: 'Lagring er ikke tilgjengelig.' }));
      return;
    }
    if (!saves.available) {
      el.className = 'ips-status is-warn';
      el.replaceChildren(svg(ICONS.warning), h('span', { text: 'Nettleseren tillater ikke lagring her (privat vindu?). Bruk «Eksporter til fil» for å ta vare på designet.' }));
      return;
    }
    if (saves.lastError) {
      el.className = 'ips-status is-warn';
      el.replaceChildren(svg(ICONS.warning), h('span', { text: 'Klarte ikke å lagre sist (lagringsplassen kan være full). Eksporter til fil for sikkerhets skyld.' }));
      return;
    }
    const active = saves.activeName;
    let text;
    if (this._pending) text = active ? `Endringer lagres automatisk i «${active}» …` : 'Endringer lagres automatisk …';
    else if (active) text = `Lagres automatisk i «${active}»${this._lastAuto ? ` – sist ${fmtWhen(this._lastAuto.toISOString())}` : ''}.`;
    else text = `Ikke lagret under et navn ennå. Endringene huskes likevel automatisk i denne nettleseren${this._lastAuto ? ` (sist ${fmtWhen(this._lastAuto.toISOString())})` : ''}.`;
    el.className = `ips-status${active && !this._pending ? ' is-ok' : ''}`;
    el.replaceChildren(svg(IC.cloud), h('span', { text }));
  }

  /**
   * How the design on screen differs from today's room (null = it IS the original).
   * @returns {{ added: number, removed: number, changed: number, wall: string|null, shading: number, paints: number }|null}
   */
  _changesFromOriginal() {
    const d = this.editor.design;
    let orig;
    try {
      orig = d.originalJSON();
    } catch {
      return null;
    }
    // DesignState normalises items (hidden: false, locked: false …) – only real values count
    const norm = (v) => {
      if (typeof v === 'number') return Math.round(v * 1000) / 1000;
      if (Array.isArray(v)) return v.map(norm);
      if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v).sort()) {
          const x = norm(v[k]);
          if (x === undefined || x === null || x === false || x === '' || (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length)) continue;
          o[k] = x;
        }
        return o;
      }
      return v;
    };
    const strip = (it) => {
      const { uid, ...rest } = it || {};
      return JSON.stringify(norm(rest));
    };
    const byUid = new Map((orig.items || []).map((o) => [o.uid, o]));
    let added = 0;
    let changed = 0;
    for (const it of d.list()) {
      const o = byUid.get(it.uid);
      if (!o) added++;
      else if (strip(o) !== strip(it)) changed++;
    }
    const removed = (orig.items || []).filter((o) => !d.get(o.uid)).length;
    const pid = d.wall?.proposalId;
    const wallChanged = (pid != null && String(pid) !== '0') || (d.wall?.elements || []).length > 0;
    const wall = wallChanged ? (pid ? d.proposal?.(pid)?.code || (String(pid).startsWith('mitt-') ? 'eget forslag' : String(pid)) : 'egen') : null;
    const shading = Object.values(d.windows || {}).filter(Boolean).length;
    const paints = Object.keys(d.paints || {}).length;
    if (!added && !changed && !removed && !wall && !shading && !paints) return null;
    return { added, removed, changed, wall, shading, paints };
  }

  /** «7 nye ting · 2 endret · vegg P2 · solskjerming på 1 vindu». */
  _changeText(c) {
    if (!c) return '';
    return [
      c.added ? `${c.added} ${c.added === 1 ? 'ny ting' : 'nye ting'}` : null,
      c.changed ? `${c.changed} endret` : null,
      c.removed ? `${c.removed} tatt ut` : null,
      c.wall ? `vegg ${c.wall}` : null,
      c.shading ? `solskjerming på ${c.shading} ${c.shading === 1 ? 'vindu' : 'vinduer'}` : null,
      c.paints ? `${c.paints} ${c.paints === 1 ? 'vegg malt' : 'vegger malt'}` : null,
    ].filter(Boolean).join(' · ');
  }

  _renderList() {
    const saves = this.saves;
    let rows = [];
    try {
      rows = saves?.list?.() || [];
    } catch (err) {
      console.warn('[saves] list failed', err);
    }
    const active = saves?.activeName ?? null;
    const proposals = this.editor.design;
    const d = this.editor.design;
    // nothing saved under a name: is the room on screen still the original, or an unsaved working copy?
    const changes = active ? null : this._changesFromOriginal();
    const els = [];
    if (!active && changes) {
      const when = d.meta?.updatedAt ? ` ${fmtWhen(d.meta.updatedAt)}` : '';
      const meta = `Endret fra Original${when} · ${this._changeText(changes)}`;
      const saveBtn = button({ label: 'Lagre …', size: 'sm', variant: 'primary', title: 'Gi designet et navn og lagre det', onClick: () => {
        this.nameInput.focus();
        this.nameInput.select();
      } });
      els.push(h('div.ips-row.is-active.ips-row--work', {},
        h('div.ips-row__main', {},
          h('div.ips-row__name', {}, h('span', { text: 'Ulagret design', title: 'Designet du jobber med nå – ikke lagret under et navn ennå' }), badge('Åpen nå', 'accent')),
          h('div.ips-row__meta', { text: meta, title: meta })),
        h('div.ips-row__acts', {}, saveBtn)));
    }
    els.push(...rows.map((r) => {
      // the original row is «open» only when the room on screen really is unchanged
      const isActive = r.original ? !active && !changes : r.name === active;
      if (this.renaming === r.name && !r.original) return this._renameRow(r);
      const meta = r.original
        ? 'Stua slik den er i dag – kan alltid åpnes'
        : [r.updatedAt ? `Endret ${fmtWhen(r.updatedAt)}` : null, r.itemCount != null ? `${fmtNumber(r.itemCount, 0)} ting` : null,
          r.proposalId && r.proposalId !== '0' ? `vegg ${proposals.proposal?.(r.proposalId)?.code || (String(r.proposalId).startsWith('mitt-') ? 'eget forslag' : r.proposalId)}` : null].filter(Boolean).join(' · ');
      const acts = [];
      // the open design gets a badge, not a button; the others an «Åpne …» button
      if (!isActive) {
        acts.push(button({
          label: r.original ? 'Åpne original' : 'Åpne',
          size: 'sm',
          title: r.original ? 'Åpne stua slik den er i dag (kan angres med Ctrl+Z)' : `Åpne «${r.name}» (kan angres med Ctrl+Z)`,
          onClick: () => this._open(r, { unsaved: !active && !!changes }),
        }));
      }
      if (!r.original) {
        const ren = iconButton({ icon: 'sliders', title: 'Gi nytt navn', onClick: () => {
          this.renaming = r.name;
          this._renderList();
        } });
        ren.replaceChildren(svg(IC.pen));
        const del = iconButton({ icon: 'close', title: `Slett «${r.name}»`, onClick: () => this.remove(r.name) });
        del.replaceChildren(svg(IC.trash));
        del.classList.add('ips-del');
        acts.push(ren, del);
      }
      return h(`div.ips-row${isActive ? '.is-active' : ''}`, {},
        h('div.ips-row__main', {},
          h('div.ips-row__name', {}, r.original ? svg(ICONS.home) : null, h('span', { text: r.name, title: r.name }), isActive ? badge('Åpen nå', 'accent') : null),
          h('div.ips-row__meta', { text: meta, title: meta })),
        acts.length ? h('div.ips-row__acts', {}, acts) : null);
    }));
    if (rows.length <= 1) els.push(h('p.ips-hint', { text: 'Ingen lagrede design ennå. Gi designet et navn over og trykk «Lagre».' }));
    this.listEl.replaceChildren(...(els.length ? els : [emptyState('Ingen design', 'info')]));
  }

  /** Opens a row; asks first when an unsaved working copy would be replaced (it can still be undone). */
  async _open(r, { unsaved = false } = {}) {
    if (unsaved) {
      const ok = await confirmDialog({
        title: r.original ? 'Åpne originalen?' : `Åpne «${r.name}»?`,
        text: 'Designet du jobber med er ikke lagret under et navn. Det forsvinner fra skjermen (Ctrl+Z henter det tilbake). Vil du lagre det først, trykk Avbryt og gi det et navn over.',
        okLabel: r.original ? 'Åpne original' : 'Åpne',
      });
      if (!ok) return;
    }
    this.load(r);
  }

  _renameRow(r) {
    const input = h('input.ip-input', { type: 'text', value: r.name, maxLength: 60, 'aria-label': 'Nytt navn', spellcheck: false });
    const commit = () => {
      const next = input.value.trim();
      this.renaming = null;
      if (next && next !== r.name) {
        const res = this.saves.rename(r.name, next);
        if (res) this.editor.events.emit('toast', { text: `Nytt navn: «${res}»`, seconds: 2 });
        else this.editor.events.emit('toast', { text: 'Klarte ikke å gi nytt navn.', seconds: 3 });
      }
      this._render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.renaming = null;
        this._renderList();
      }
    });
    const ok = button({ label: 'OK', size: 'sm', variant: 'primary', onClick: commit });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return h('div.ips-row.is-renaming', {}, input, h('div.ips-row__acts', {}, ok));
  }

  /**
   * Saves the current design under a name (asks before overwriting another design).
   * @param {string} name
   */
  async saveAs(name) {
    const saves = this.saves;
    if (!saves) return;
    let n = String(name || '').trim();
    if (!n) {
      this.nameInput.focus();
      this.editor.events.emit('toast', { text: 'Skriv et navn på designet først.', seconds: 2.5 });
      return;
    }
    this.editor.ui?.toolbar?.exitCompare?.({ quiet: true });
    if (n !== saves.activeName && saves.has(n) && n !== 'Original') {
      const ok = await confirmDialog({ title: `Erstatte «${n}»?`, text: 'Det finnes allerede et design med dette navnet. Vil du lagre over det?', okLabel: 'Erstatt', danger: true });
      if (!ok) return;
    }
    const used = saves.save(n);
    this.nameInput.blur();
    if (used) {
      this._pending = false;
      this._lastAuto = new Date();
      this.editor.events.emit('toast', { text: `Lagret som «${used}»`, seconds: 2.5 });
      this.editor.events.emit('sfx', { name: 'place' });
    } else {
      this.editor.events.emit('toast', { text: 'Klarte ikke å lagre – nettleseren tillater ikke lagring. Prøv «Eksporter til fil».', seconds: 4 });
    }
    this._render();
  }

  /** Opens a saved design (or «Original»). */
  load(r) {
    const saves = this.saves;
    if (!saves) return;
    this.editor.ui?.toolbar?.exitCompare?.({ quiet: true });
    this.editor.placement?.isActive && this.editor.placement.cancel();
    const ok = r.original ? saves.loadOriginal() : saves.load(r.name);
    if (ok) this.editor.events.emit('toast', { text: r.original ? 'Åpnet stua slik den er i dag (Ctrl+Z angrer)' : `Åpnet «${r.name}» (Ctrl+Z angrer)`, seconds: 2.5 });
    else this.editor.events.emit('toast', { text: `Klarte ikke å åpne «${r.name}».`, seconds: 3 });
    this._lastAuto = null;
    this._render();
  }

  /** Deletes a saved design after a confirmation. */
  async remove(name) {
    const ok = await confirmDialog({ title: `Slette «${name}»?`, text: 'Designet slettes fra denne nettleseren. Dette kan ikke angres – eksporter det til fil først hvis du vil ta vare på det.', okLabel: 'Slett', danger: true });
    if (!ok) return;
    if (this.saves.remove(name)) this.editor.events.emit('toast', { text: `«${name}» er slettet`, seconds: 2 });
    this._render();
  }

  exportFile() {
    this.editor.ui?.toolbar?.exitCompare?.({ quiet: true });
    const ok = this.saves?.exportFile?.();
    this.editor.events.emit('toast', { text: ok ? `Lastet ned ${this.saves.fileName()}` : 'Klarte ikke å eksportere.', seconds: 3 });
  }

  async importFile() {
    this.editor.ui?.toolbar?.exitCompare?.({ quiet: true });
    try {
      const name = await this.saves?.pickAndImport?.();
      if (name) this.editor.events.emit('toast', { text: `Importerte «${name}» (Ctrl+Z angrer)`, seconds: 3 });
    } catch (err) {
      this.editor.events.emit('toast', { text: err?.message || 'Klarte ikke å importere filen.', seconds: 4 });
    }
    this._render();
  }

  update() {
    if (!this._listDirty || !this.isOpen || this.renaming) return;
    const now = performance.now();
    if (now - (this._listAt || 0) < 400) return;
    this._listAt = now;
    this._listDirty = false;
    this._renderList();
  }

  dispose() {
    clearTimeout(this._timer);
    for (const off of this._offs) off?.();
    super.dispose();
  }
}

export default SavePanel;
