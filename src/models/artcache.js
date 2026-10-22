/**
 * Texture cache for generated and uploaded art that never disposes what is in use (design/art.md §5.1). Pure: no
 * three.js, no DOM – it works with any entry object and a `dispose(entry, key)` callback, so it is Node-testable.
 *
 * Each entry knows the materials that sample it through WeakRefs (no hooks in kit.disposeModel / SceneSync needed:
 * a material referenced by any live mesh, parked model, ghost or the PRINTS material map stays reachable, so its entry
 * stays in use). Over budget (pixels or entry count) the oldest entries with no live user are disposed; entries in use
 * are skipped, so the budget may be exceeded – visible art always stays.
 *
 *   const MOTIFS = new ArtCache({ budgetPx: ART_BUDGET_PX.medium, dispose: (e) => { e.map.dispose(); e.normalMap?.dispose(); } });
 *   let e = MOTIFS.get(key);
 *   if (!e) e = MOTIFS.set(key, { map, normalMap, edgeHex }, W * H);   // the new entry survives its own sweep
 *   const m = new THREE.MeshStandardMaterial({ map: e.map });
 *   MOTIFS.use(e, m);                                                   // call right away (before the next set)
 *
 * Users are registered per material; registering the same material twice is a no-op. Entries that never got a user are
 * disposed by the next sweep that needs room. Without WeakRef (very old browsers) users are held strongly: nothing is
 * ever disposed while used once, which is safe but unbounded.
 */

/** Pixel budget of the motif and atlas caches by render quality (decor.js keeps the highest quality requested). */
export const ART_BUDGET_PX = Object.freeze({ low: 6e6, medium: 12e6, high: 20e6 });

const Ref = typeof WeakRef === 'function' ? WeakRef : class StrongRef {
  constructor(t) { this.t = t; }
  deref() { return this.t; }
};

export class ArtCache {
  /**
   * @param {{ budgetPx?: number, maxEntries?: number, dispose?: (entry: object, key: string) => void }} [o]
   */
  constructor({ budgetPx = ART_BUDGET_PX.medium, maxEntries = 96, dispose = null } = {}) {
    this.budgetPx = budgetPx;
    this.maxEntries = maxEntries;
    this.dispose = typeof dispose === 'function' ? dispose : () => {};
    /** key → entry, oldest first (a get moves the entry to the newest end). */
    this.map = new Map();
    /** Sum of entry.px over the cached entries. */
    this.px = 0;
    this._orphans = 0;
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  /** The entry of `key` (moved to the newest end), or undefined. */
  get(key) {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }

  /**
   * Stores `entry` under `key` (entry.px = px, entry.users = a Set of WeakRefs) as the newest entry, then sweeps – the
   * new entry itself is never swept by its own set. Replacing a key keeps the old entry tracked under a private key
   * while it is in use (so it is still disposed later), else disposes it.
   * @returns {object} entry
   */
  set(key, entry, px = 0) {
    const old = this.map.get(key);
    if (old !== undefined && old !== entry) {
      this.map.delete(key);
      if (this.inUse(old)) this.map.set(`${key}\u0000${++this._orphans}`, old);
      else this._dispose(key, old);
    } else if (old === entry) {
      this.map.delete(key);
      this.px -= num(entry.px);
    }
    entry.px = Math.max(0, num(px));
    if (!(entry.users instanceof Set)) entry.users = new Set();
    this.map.set(key, entry);
    this.px += entry.px;
    this.sweep(entry);
    return entry;
  }

  /** Registers `material` as a user of `entry` (a WeakRef; once per material). @returns the material */
  use(entry, material) {
    if (!entry || !material || (typeof material !== 'object' && typeof material !== 'function')) return material;
    if (!(entry.users instanceof Set)) entry.users = new Set();
    for (const r of entry.users) if (r.deref() === material) return material;
    entry.users.add(new Ref(material));
    return material;
  }

  /** Prunes dead users; true while any registered material is still alive. */
  inUse(entry) {
    const users = entry?.users;
    if (!(users instanceof Set)) return false;
    for (const r of users) if (r.deref() === undefined) users.delete(r);
    return users.size > 0;
  }

  /**
   * Oldest first: while over budget (px > budgetPx or more than maxEntries), disposes and drops entries that are not in
   * use; `keep` (the entry just set) and entries in use are skipped. @returns the number of disposed entries
   */
  sweep(keep = null) {
    let n = 0;
    for (const [k, e] of [...this.map]) {
      if (!this._over()) break;
      if (e === keep || this.inUse(e)) continue;
      this._dispose(k, e);
      n++;
    }
    return n;
  }

  /** Disposes every entry that is not in use, whatever the budget (debug hook, memory pressure). @returns the count */
  trim() {
    let n = 0;
    for (const [k, e] of [...this.map]) {
      if (this.inUse(e)) continue;
      this._dispose(k, e);
      n++;
    }
    return n;
  }

  /** Keeps the largest budget asked for so far (the highest render quality seen). @returns the budget */
  raiseBudget(px) {
    if (num(px) > this.budgetPx) this.budgetPx = px;
    return this.budgetPx;
  }

  /** { entries, px, inUse, budgetPx, maxEntries } – inUse counts the entries with a live user. */
  stats() {
    let inUse = 0;
    for (const e of this.map.values()) if (this.inUse(e)) inUse++;
    return { entries: this.map.size, px: this.px, inUse, budgetPx: this.budgetPx, maxEntries: this.maxEntries };
  }

  _over() {
    return this.px > this.budgetPx || this.map.size > this.maxEntries;
  }

  /** Drops `e` (when still cached under `key`), takes its pixels off the total and calls dispose. */
  _dispose(key, e) {
    if (this.map.get(key) === e) this.map.delete(key);
    this.px -= num(e.px);
    try {
      this.dispose(e, key);
    } catch (err) {
      console.warn('[art] cache dispose failed', err);
    }
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
