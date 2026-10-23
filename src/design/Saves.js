import { ORIGINAL_NAME, DESIGN_VERSION, DesignState, looksLikeDesign } from './DesignState.js';
import { imageRefs } from './ImageStore.js';

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
 *
 * Design version 2 (hele-huset §5.5, steg 16): the store key and format stay; the designs inside become version 2 as
 * they are written. Before the FIRST write that would replace stored version 1 designs, the whole stored text is
 * copied once to `interiorspillet.designs.v1.backup` (BACKUP_KEY; never overwritten). Version 1 designs still load.
 *
 * Uploaded pictures («egne bilder») are never stored here – items keep `params.imageId`; the bytes are in
 * design/ImageStore.js (IndexedDB) and travel inside exported files (a last top-level `images` block, only when the
 * design uses pictures – an export without pictures is exactly as before). importText registers that block in the
 * picture store; the stored design never holds it. imageRoots() gives the store's clean-up the ids still in use.
 */

export const STORAGE_KEY = 'interiorspillet.designs.v1';
/** A copy of the stored designs as they were before the first version 2 write (written once, never overwritten). */
export const BACKUP_KEY = 'interiorspillet.designs.v1.backup';
const STORE_VERSION = 1;
/** «Forrige økt (…)» entries kept in the Design list. */
export const KEEP_SESSIONS = 3;
export const SESSION_PREFIX = 'Forrige økt (';
/** A design file larger than this is refused before it is read (pictures included). */
export const MAX_DESIGN_FILE_BYTES = 150 * 1024 * 1024;
const pad = (n) => String(n).padStart(2, '0');

/** «Forrige økt (18.10. 19:30)». */
export function sessionName(d = new Date()) {
  return `${SESSION_PREFIX}${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())})`;
}

/**
 * Comparable JSON of the parts of a design that count as «work» (furniture, wall, shading, paint, slat finishes – not
 * env/meta). A design without `finishes` (saved before them) compares like one with none.
 */
function workKey(json) {
  if (!json || typeof json !== 'object') return '';
  const items = (Array.isArray(json.items) ? json.items : []).map((it) => JSON.stringify(it)).sort();
  return JSON.stringify([items, json.wall ?? null, json.windows ?? {}, json.paints ?? {}, json.finishes ?? {}]);
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

/** True when a stored text holds a design older than DESIGN_VERSION (a saved design or the autosave slot). */
function hasOldDesigns(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;
    const old = (d) => !!d && typeof d === 'object' && !(Number(d.version) >= DESIGN_VERSION);
    return Object.values(data.designs && typeof data.designs === 'object' ? data.designs : {}).some(old) || old(data.autosave);
  } catch {
    return false; // unreadable: _read() treats it as empty anyway
  }
}

export class Saves {
  /**
   * @param {import('./DesignState.js').DesignState} design
   * @param {Object} [opts]
   * @param {Storage|null} [opts.storage]   default: window.localStorage (if accessible)
   * @param {string} [opts.key]             storage key
   * @param {boolean} [opts.autosave=true]  save the active design on every change (debounced)
   * @param {number} [opts.autosaveDelay=1200] ms
   * @param {import('./ImageStore.js').ImageStore|null} [opts.images] uploaded pictures (exports embed them, imports
   *   register them); null: exports carry no pictures, imports ignore them
   */
  constructor(design, { storage = defaultStorage(), key = STORAGE_KEY, autosave = true, autosaveDelay = 1200, images = null } = {}) {
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
    /** True once this Saves copied the stored version 1 designs to BACKUP_KEY. */
    this.backupWritten = false;
    this._backupChecked = false;
    /** Uploaded pictures (design/ImageStore.js) or null: exports then carry no pictures, imports ignore them. */
    this.images = images;
    /**
     * Result of the last importText: { added, existing, rejected, unsaved } (picture ids); importFile adds
     * unsavedReason 'memory' (this browser keeps no pictures) | 'quota' (a write failed) when `unsaved` is not empty.
     */
    this.lastImport = null;
    /** Picture ids the last export could not include (not in this browser). */
    this.lastExportMissing = [];
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

  /**
   * Once per Saves: before the first write, copies stored version 1 designs to BACKUP_KEY (only when there are any and
   * no backup exists yet). Best effort – a full storage only logs a warning; the version 1 designs stay loadable.
   */
  _backupOnce() {
    if (this._backupChecked || !this.storage) return;
    this._backupChecked = true;
    try {
      if (this.storage.getItem(BACKUP_KEY) != null) return;
      const raw = this.storage.getItem(this.key);
      if (!raw || !hasOldDesigns(raw)) return;
      this.storage.setItem(BACKUP_KEY, raw);
      this.backupWritten = true;
    } catch (err) {
      console.warn('[saves] could not back up the version 1 designs', err);
    }
  }

  _write(store) {
    if (!this.storage) return false;
    this._backupOnce();
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

  /** True when a design JSON differs from today's room in furniture, wall, shading, paint or slats (not just light/time). */
  isWork(json) {
    if (!json) return false;
    if (_originalKey == null) {
      try {
        _originalKey = workKey(new DesignState({ layout: this.design?.layout }).toJSON());
      } catch {
        _originalKey = '';
      }
    }
    // compared in today's form, as it would load: a version 1 design (no level, world y), and today's pieces the user
    // never changed follow the current room data (meta.specRevision – e.g. the painting's category 'smatt' → 'kunst')
    let cur = json;
    try {
      const d = new DesignState({ layout: this.design?.layout, original: false });
      d.load(json);
      cur = d.toJSON();
    } catch {
      cur = json;
    }
    return workKey(cur) !== _originalKey;
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
   * @returns {Array<{ name: string, original?: boolean, active: boolean, createdAt?: string, updatedAt?: string, itemCount?: number, proposalId?: string|null, imageCount?: number }>}
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
      imageCount: imageRefs(d).size,
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
    this._preloadImages(json);
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
    this._preloadImages(json);
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

  /** The design JSON an export of `name` writes (a saved design, «Original», or the current design). */
  _jsonFor(name) {
    return name && name !== ORIGINAL_NAME ? this._read().designs[name] : name === ORIGINAL_NAME ? this.design.originalJSON() : this.design.toJSON();
  }

  /** Fire-and-forget: loads the pictures of a design about to open (fewer placeholder frames on the first build). */
  _preloadImages(json) {
    if (!this.images?.load) return;
    try {
      const ids = imageRefs(json);
      if (ids.size) this.images.load(ids).catch?.(() => {});
    } catch {
      /* pictures are optional */
    }
  }

  /**
   * The current design (or a saved one) as pretty JSON text. Stays synchronous: the pictures the design uses are
   * embedded from memory as a last `images` key (absent when there are none – the text is then exactly as without a
   * picture store); ids not in memory end up in `lastExportMissing` (exportFile loads them first).
   * @param {string} [name]
   * @param {{ images?: boolean }} [o]  images: false leaves the pictures out
   * @returns {string|null}
   */
  exportText(name, { images: embed = true } = {}) {
    const json = this._jsonFor(name);
    if (!json) return null;
    const out = { app: 'Interiørspillet', ...json };
    this.lastExportMissing = [];
    if (embed && this.images) {
      const ids = imageRefs(json);
      if (ids.size) {
        const { images, missing } = this.images.exportSync(ids);
        if (Object.keys(images).length) out.images = images; // last key
        this.lastExportMissing = missing;
      }
    }
    return JSON.stringify(out, null, 2);
  }

  /**
   * Downloads the current design (or a saved one) as a .json file, with the pictures it uses (loaded first).
   * @returns {Promise<boolean>}
   */
  async exportFile(name) {
    if (typeof document === 'undefined') return false;
    if (this.images) {
      try {
        const json = this._jsonFor(name);
        const ids = json ? imageRefs(json) : new Set();
        if (ids.size) await this.images.load(ids, { decode: false });
      } catch {
        /* exportText reports what is missing */
      }
    }
    const text = this.exportText(name);
    if (!text) return false;
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
   * Imports a design from text (JSON), loads it (undoable) and stores it under its own name (made unique). Pictures in
   * the file (`images`) go to the picture store (lastImport); a picture that is refused never blocks the design.
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
    const emb = data.images && typeof data.images === 'object' && !Array.isArray(data.images) ? data.images : null;
    delete data.images; // never part of the design (load ignores it anyway)
    this.lastImport = { added: [], existing: [], rejected: [], unsaved: [] };
    if (emb && this.images) {
      try {
        Object.assign(this.lastImport, this.images.import(emb));
      } catch (err) {
        console.warn('[saves] could not read the pictures of the file', err);
      }
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
    if (file.size > MAX_DESIGN_FILE_BYTES) throw new Error('Filen er for stor til å være et design fra Interiørspillet.');
    const text = typeof file.text === 'function' ? await file.text() : await new Response(file).text();
    const name = this.importText(text);
    if (this.images && this.lastImport?.added?.length) {
      const res = await this.images.flush();
      const failed = new Set(res?.failed || []);
      this.lastImport.unsaved = this.lastImport.added.filter((id) => failed.has(id) || this.images.info(id)?.persisted === false);
      // why: the browser keeps no pictures at all (private window, blocked storage) or a write failed (storage full)
      if (this.lastImport.unsaved.length) this.lastImport.unsavedReason = this.images.persistent === false ? 'memory' : 'quota';
    }
    return name;
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
   * Picture ids used by every stored design (named, «Forrige økt», the autosave slot) and the version 1 backup – the
   * roots of the picture store's clean-up. null when the stored designs cannot be read: then nothing may be deleted.
   * @returns {Set<string>|null}
   */
  imageRoots() {
    const out = new Set();
    if (!this.storage) return out;
    let raws;
    try {
      raws = [this.storage.getItem(this.key), this.storage.getItem(BACKUP_KEY)];
    } catch {
      return null;
    }
    for (const raw of raws) {
      if (!raw) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return null;
      }
      const designs = data?.designs && typeof data.designs === 'object' ? Object.values(data.designs) : [];
      for (const d of [...designs, data?.autosave]) for (const id of imageRefs(d)) out.add(id);
    }
    return out;
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
