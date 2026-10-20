import { ORIGINAL_NAME, DesignState, looksLikeDesign } from './DesignState.js';

/**
 * Saved designs (ARCHITECTURE §7): several named designs in localStorage under `interiorspillet.designs.v1`,
 * autosave of the active design, export to a .json file and import. «Original» (today's room) can always be
 * loaded and is never stored. Every storage access is guarded – private windows / blocked storage just make
 * saving a no-op (methods return false) and the game keeps working.
 *
 * Stored value: { version: 1, active: name|null, designs: { [name]: designJson }, autosave: designJson|null }
 *
 * Switching designs never loses work: opening a design, «Original» or an import first writes a pending autosave of
 * a named design, and keeps unnamed work (the autosave slot) as «Forrige økt (dato)» – at most KEEP_SESSIONS of those
 * are kept (the oldest go first, never the active one); unnamed sessions without real changes (only time of day /
 * lights) are not kept. Undo/redo across an «Åpne»/«Importer» brings the previous name back with the content
 * (DesignState records meta in the load step) and `active` follows it, so autosave never writes one design's content
 * into another design. `pending` / `flush()` let Game save on pagehide instead of asking «Forlate nettstedet?».
 */

export const STORAGE_KEY = 'interiorspillet.designs.v1';
const STORE_VERSION = 1;
/** «Forrige økt (…)» entries kept in the Design list. */
export const KEEP_SESSIONS = 3;
export const SESSION_PREFIX = 'Forrige økt (';
const pad = (n) => String(n).padStart(2, '0');

/** «Forrige økt (18.10. 19:30)». */
export function sessionName(d = new Date()) {
  return `${SESSION_PREFIX}${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())})`;
}

/** Comparable JSON of the parts of a design that count as «work» (furniture, wall, shading, paint – not env/meta). */
function workKey(json) {
  if (!json || typeof json !== 'object') return '';
  const items = (Array.isArray(json.items) ? json.items : []).map((it) => JSON.stringify(it)).sort();
  return JSON.stringify([items, json.wall ?? null, json.windows ?? {}, json.paints ?? {}]);
}

let _originalKey = null;

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function emptyStore() {
  return { version: STORE_VERSION, active: null, designs: {}, autosave: null };
}

export class Saves {
  /**
   * @param {import('./DesignState.js').DesignState} design
   * @param {Object} [opts]
   * @param {Storage|null} [opts.storage]   default: window.localStorage (if accessible)
   * @param {string} [opts.key]             storage key
   * @param {boolean} [opts.autosave=true]  save the active design on every change (debounced)
   * @param {number} [opts.autosaveDelay=1200] ms
   */
  constructor(design, { storage = defaultStorage(), key = STORAGE_KEY, autosave = true, autosaveDelay = 1200 } = {}) {
    this.design = design;
    this.storage = storage;
    this.key = key;
    this.autosaveDelay = autosaveDelay;
    this._timer = null;
    this._off = null;
    this._suspend = 0;
    this._dirty = false; // changes since the last successful write
    this.lastError = null;
    /** Name of the «Forrige økt» the last load/loadOriginal/import kept the unnamed work under (or null). */
    this.lastKept = null;
    /** Called with the error when a write fails (createHome shows a toast). */
    this.onWriteError = null;
    // undo/redo across an «Åpne»/«Importer» restores the design's name: the active slot follows it
    this._offHistory = design?.on?.('change', (e) => {
      if (e?.type === 'undo' || e?.type === 'redo') this._followName();
    }) ?? null;
    if (autosave) this.enableAutosave();
  }

  // ---- storage --------------------------------------------------------------------------------------------------

  _read() {
    if (!this.storage) return emptyStore();
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return emptyStore();
      return {
        version: STORE_VERSION,
        active: typeof data.active === 'string' ? data.active : null,
        designs: data.designs && typeof data.designs === 'object' ? data.designs : {},
        autosave: data.autosave && typeof data.autosave === 'object' ? data.autosave : null,
      };
    } catch (err) {
      this.lastError = err;
      return emptyStore();
    }
  }

  _write(store) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(store));
      this.lastError = null;
      return true;
    } catch (err) {
      // quota exceeded: make room by dropping all but the newest «Forrige økt» (never the active one), then retry once
      if (this._pruneSessions(store, 1)) {
        try {
          this.storage.setItem(this.key, JSON.stringify(store));
          this.lastError = null;
          return true;
        } catch {
          /* still too big – reported below */
        }
      }
      this.lastError = err; // quota exceeded / storage blocked
      console.warn('[saves] could not write to localStorage', err);
      try {
        this.onWriteError?.(err);
      } catch {
        /* the callback is optional */
      }
      return false;
    }
  }

  /**
   * Drops the oldest «Forrige økt (…)» designs so at most `keep` remain (the active design is never dropped).
   * @returns {boolean} whether something was removed
   */
  _pruneSessions(store, keep = KEEP_SESSIONS) {
    const sessions = Object.entries(store.designs)
      .filter(([name]) => name.startsWith(SESSION_PREFIX) && name !== store.active)
      .sort((a, b) => String(b[1]?.meta?.updatedAt || '').localeCompare(String(a[1]?.meta?.updatedAt || '')));
    let removed = false;
    for (const [name] of sessions.slice(keep)) {
      delete store.designs[name];
      removed = true;
    }
    return removed;
  }

  /** True when a design JSON differs from today's room in furniture, wall, shading or paint (not just light/time). */
  isWork(json) {
    if (!json) return false;
    if (_originalKey == null) {
      try {
        _originalKey = workKey(new DesignState({ layout: this.design?.layout }).toJSON());
      } catch {
        _originalKey = '';
      }
    }
    return workKey(json) !== _originalKey;
  }

  /**
   * Keeps unnamed work as «Forrige økt (dato)» in `store` (not written yet). json: the unnamed design (default: the
   * autosave slot). Sessions without real changes are skipped; old sessions beyond KEEP_SESSIONS are pruned.
   * @returns {string|null} the name used
   */
  _archive(store, json = store.autosave) {
    if (!json || !this.isWork(json)) return null;
    const base = sessionName();
    let name = base;
    for (let n = 2; store.designs[name]; n++) name = `${base} (${n})`;
    const now = new Date().toISOString();
    store.designs[name] = { ...JSON.parse(JSON.stringify(json)), meta: { ...(json.meta || {}), name, updatedAt: now } };
    this._pruneSessions(store);
    return name;
  }

  /**
   * Before another design replaces the current one: a named design gets its pending changes written, unnamed work
   * is kept as «Forrige økt». Mutates `store` (the caller writes it).
   * @returns {string|null} name of the kept session, if any
   */
  _beforeSwitch(store) {
    clearTimeout(this._timer);
    this._timer = null;
    const json = this.design.toJSON();
    if (store.active && store.designs[store.active]) {
      if (this._dirty) store.designs[store.active] = json;
      this._dirty = false;
      return null;
    }
    // unnamed: the in-memory design is the newest version of that work (the slot may lag the debounce)
    const kept = this._archive(store, this._dirty || !store.autosave ? json : store.autosave);
    store.autosave = null;
    this._dirty = false;
    return kept;
  }

  /** After undo/redo: the active slot follows the design's (restored) name. */
  _followName() {
    const store = this._read();
    const name = this.design.meta?.name;
    const next = name && name !== ORIGINAL_NAME && store.designs[name] ? name : null;
    if (store.active === next) return;
    store.active = next;
    this._write(store);
  }

  /** True when there are changes that are not written yet (a debounced autosave is waiting). */
  get pending() {
    return !!this._timer || (this._dirty && !!this._off);
  }

  /**
   * Writes a waiting autosave now (pagehide / tab hidden / before unload).
   * @returns {boolean} true when nothing is left unsaved
   */
  flush() {
    if (!this.pending) return true;
    return this.autosaveNow();
  }

  /** True when designs can be stored in this browser. */
  get available() {
    if (!this.storage) return false;
    try {
      const probe = `${this.key}.probe`;
      this.storage.setItem(probe, '1');
      this.storage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  // ---- named designs --------------------------------------------------------------------------------------------

  /**
   * Saved designs, newest first, with «Original» always first.
   * @returns {Array<{ name: string, original?: boolean, active: boolean, createdAt?: string, updatedAt?: string, itemCount?: number, proposalId?: string|null }>}
   */
  list() {
    const store = this._read();
    const rows = Object.entries(store.designs).map(([name, d]) => ({
      name,
      active: store.active === name,
      createdAt: d?.meta?.createdAt,
      updatedAt: d?.meta?.updatedAt,
      itemCount: Array.isArray(d?.items) ? d.items.length : 0,
      proposalId: d?.wall?.proposalId ?? null,
    }));
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return [{ name: ORIGINAL_NAME, original: true, active: store.active === null && this.design.meta.name === ORIGINAL_NAME }, ...rows];
  }

  /** @returns {boolean} */
  has(name) {
    if (name === ORIGINAL_NAME) return true;
    return !!this._read().designs[name];
  }

  /** Name of the active (last saved/opened) design, or null for an unsaved/original one. */
  get activeName() {
    return this._read().active;
  }

  /** A free name based on `base` («Mitt design», «Mitt design (2)» …). */
  uniqueName(base = 'Mitt design') {
    const store = this._read();
    let name = String(base).trim() || 'Mitt design';
    if (name === ORIGINAL_NAME) name = `${ORIGINAL_NAME} (kopi)`;
    if (!store.designs[name]) return name;
    let n = 2;
    while (store.designs[`${name} (${n})`]) n++;
    return `${name} (${n})`;
  }

  /**
   * Saves the current design under a name (default: the design's name; «Original» is saved as «Original (kopi)»).
   * @param {string} [name]
   * @returns {string|null} the name used, or null when storage failed
   */
  save(name = this.design.meta.name) {
    let n = String(name || '').trim() || 'Mitt design';
    if (n === ORIGINAL_NAME) n = this.uniqueName(`${ORIGINAL_NAME} (kopi)`);
    this.design.setMeta({ name: n });
    const store = this._read();
    store.designs[n] = this.design.toJSON();
    store.active = n;
    store.autosave = null;
    const ok = this._write(store);
    if (ok) {
      clearTimeout(this._timer);
      this._timer = null;
      this._dirty = false;
    }
    return ok ? n : null;
  }

  /**
   * Opens a saved design (or «Original»). Undoable.
   * @param {string} name
   * @returns {boolean}
   */
  load(name) {
    if (name === ORIGINAL_NAME) return this.loadOriginal();
    const store = this._read();
    const json = store.designs[name];
    if (!json) return false;
    this.lastKept = this._beforeSwitch(store);
    this._suspend++;
    try {
      this.design.load(json, { keepHistory: true, label: `Åpne «${name}»`, meta: { name } });
    } catch (err) {
      this.lastError = err;
      console.warn('[saves] could not load design', name, err);
      this._write(store); // the kept session / flushed changes are still worth storing
      return false;
    } finally {
      this._suspend--;
    }
    store.active = name;
    store.autosave = null;
    this._write(store);
    return true;
  }

  /** Loads today's room (undoable). */
  loadOriginal() {
    const store = this._read();
    this.lastKept = this._beforeSwitch(store);
    this._suspend++;
    try {
      this.design.load(this.design.originalJSON(), { keepHistory: true, label: 'Tilbake til original', meta: { name: ORIGINAL_NAME } });
    } finally {
      this._suspend--;
    }
    store.active = null;
    store.autosave = null;
    this._write(store);
    return true;
  }

  /** Deletes a saved design. «Original» cannot be deleted. */
  remove(name) {
    if (name === ORIGINAL_NAME) return false;
    const store = this._read();
    if (!store.designs[name]) return false;
    delete store.designs[name];
    if (store.active === name) store.active = null;
    return this._write(store);
  }

  /**
   * Renames a saved design.
   * @returns {string|null} the new name (made unique), or null
   */
  rename(oldName, newName) {
    if (oldName === ORIGINAL_NAME) return null;
    const store = this._read();
    const json = store.designs[oldName];
    if (!json) return null;
    let n = String(newName || '').trim();
    if (!n || n === oldName) return oldName;
    if (n === ORIGINAL_NAME || store.designs[n]) n = this.uniqueName(n);
    delete store.designs[oldName];
    json.meta = { ...(json.meta || {}), name: n };
    store.designs[n] = json;
    if (store.active === oldName) {
      store.active = n;
      this.design.setMeta({ name: n });
    }
    return this._write(store) ? n : null;
  }

  // ---- autosave -------------------------------------------------------------------------------------------------

  /** Saves the active design automatically (debounced) after every change. */
  enableAutosave() {
    if (this._off) return;
    this._off = this.design.on('change', (e) => {
      if (this._suspend || e?.type === 'load') return;
      this._dirty = true;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.autosaveNow(), this.autosaveDelay);
    });
  }

  disableAutosave() {
    this._off?.();
    this._off = null;
    clearTimeout(this._timer);
  }

  /** Writes the autosave now: into the active named design, or the separate autosave slot when unnamed. */
  autosaveNow() {
    clearTimeout(this._timer);
    this._timer = null;
    const store = this._read();
    const json = this.design.toJSON();
    if (store.active && store.designs[store.active]) store.designs[store.active] = json;
    else store.autosave = json;
    const ok = this._write(store);
    if (ok) this._dirty = false;
    return ok;
  }

  /** True when there is an unnamed autosaved design that differs from the original. */
  hasAutosave() {
    return !!this._read().autosave;
  }

  /**
   * Restores the last session (active named design, else the autosave slot). Call once at start-up.
   * @returns {boolean} whether something was restored
   */
  restore() {
    const store = this._read();
    const json = store.active ? store.designs[store.active] : store.autosave;
    if (!json) return false;
    this._suspend++;
    try {
      this.design.load(json);
      return true;
    } catch (err) {
      this.lastError = err;
      console.warn('[saves] could not restore the last design', err);
      return false;
    } finally {
      this._suspend--;
    }
  }

  /**
   * `?design=<name>` (ARCHITECTURE §16): loads that saved design (or «Original»).
   * @param {URLSearchParams} params
   * @returns {boolean}
   */
  loadFromParams(params) {
    const name = params?.get?.('design');
    if (!name) return false;
    return this.load(name);
  }

  // ---- files ----------------------------------------------------------------------------------------------------

  /** File name for an export: «interiorspillet-<navn>-<dato>.json». */
  fileName(name = this.design.meta.name) {
    const slug = String(name || 'design')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'design';
    return `interiorspillet-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  }

  /** The current design (or a saved one) as pretty JSON text. */
  exportText(name) {
    const json = name && name !== ORIGINAL_NAME ? this._read().designs[name] : name === ORIGINAL_NAME ? this.design.originalJSON() : this.design.toJSON();
    return json ? JSON.stringify({ app: 'Interiørspillet', ...json }, null, 2) : null;
  }

  /**
   * Downloads the current design (or a saved one) as a .json file.
   * @returns {boolean}
   */
  exportFile(name) {
    const text = this.exportText(name);
    if (!text || typeof document === 'undefined') return false;
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName(name || this.design.meta.name);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch (err) {
      this.lastError = err;
      console.warn('[saves] export failed', err);
      return false;
    }
  }

  /**
   * Imports a design from text (JSON), loads it (undoable) and stores it under its own name (made unique).
   * @param {string} text
   * @returns {string} the stored name
   * @throws {Error} Norwegian message when the file is not a design
   */
  importText(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Filen er ikke et gyldig design (ugyldig JSON).');
    }
    if (!looksLikeDesign(data)) {
      throw new Error('Filen inneholder ikke et design fra Interiørspillet.');
    }
    const given = typeof data.meta?.name === 'string' ? data.meta.name.trim().slice(0, 80) : '';
    const name = this.uniqueName(given && given !== ORIGINAL_NAME ? given : 'Importert design');
    const store = this._read();
    this.lastKept = this._beforeSwitch(store);
    this._suspend++;
    try {
      this.design.load(data, { keepHistory: true, label: `Importer «${name}»`, meta: { name } });
    } finally {
      this._suspend--;
    }
    store.designs[name] = this.design.toJSON();
    store.active = name;
    store.autosave = null;
    this._write(store);
    return name;
  }

  /**
   * Imports a design from a File (file input / drag and drop).
   * @param {File|Blob} file
   * @returns {Promise<string>} the stored name
   */
  async importFile(file) {
    if (!file) throw new Error('Ingen fil valgt.');
    const text = typeof file.text === 'function' ? await file.text() : await new Response(file).text();
    return this.importText(text);
  }

  /**
   * Opens a file picker and imports the chosen file.
   * @returns {Promise<string|null>} the stored name, or null if cancelled
   */
  pickAndImport() {
    if (typeof document === 'undefined') return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return resolve(null);
        try {
          resolve(await this.importFile(file));
        } catch (err) {
          reject(err);
        }
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Starting fresh («Start med stua slik den er i dag»): keeps an unnamed previous session as «Forrige økt (dato)»
   * (only when it has real changes) and clears the slot and the active name. The in-memory design is not touched.
   * @returns {string|null} the name used
   */
  archiveSession() {
    const store = this._read();
    const name = store.autosave ? this._archive(store) : null;
    store.autosave = null;
    store.active = null;
    this._write(store);
    return name;
  }

  dispose() {
    if (this._timer) this.autosaveNow();
    this.disableAutosave();
    this._offHistory?.();
    this._offHistory = null;
  }
}

export default Saves;
