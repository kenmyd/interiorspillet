/**
 * LAST POSITION – where the player last stood, kept per viewer (this browser's localStorage), so the next visit starts
 * there instead of outside (notes/hele-huset-design.md §3.6, steg 26 U2). Without a saved position (the first visit,
 * a private window, blocked storage) Game starts outside on the forecourt by the front door.
 *
 *   key 'interiorspillet.player.v1' → { v: 1, pos: [x, y, z] (feet, world m), yawDeg, pitchDeg, levelId, roomId,
 *                                       t (ms since 1970) }
 *   yaw / pitch in degrees with the game's convention (yaw 0 looks along −z = east, + turns left; the URL's &yaw=).
 *
 *   new LastPosition({ storage?, key?, interval?, readOnly? })
 *   load() → { pos, yawDeg, pitchDeg, levelId, roomId, t } | null    validated (parseLastPosition); never throws
 *   record(feet, yaw (rad), pitch (rad), { levelId, roomId }, time (s))
 *                                remembers a spot the player stands on (Game: on the ground, not seated, not in water)
 *                                and writes it at most every `interval` s of `time` – and only when it moved at least
 *                                0.25 m or turned 10° since the last write
 *   flush() → boolean            writes the remembered spot now (pagehide, tab hidden, quit); true when nothing is left
 *   clear()                      forgets the saved position
 *   pending                      a remembered spot that is not written yet
 * Every storage access is wrapped in try/catch: blocked or full storage only means the next visit starts outside.
 * readOnly (or no storage at all): load() still reads, nothing is ever written.
 */

export const LAST_POSITION_KEY = 'interiorspillet.player.v1';
const VERSION = 1;
/** Seconds of game time between two writes while walking. */
const DEFAULT_INTERVAL = 2;
/** A spot is written again only after moving this far (m) … */
const MIN_MOVE = 0.25;
/** … or turning this much (deg). */
const MIN_TURN = 10;
/** Anything farther from the house than this (m) is not a position of this game. */
const MAX_COORD = 500;

const RAD = 180 / Math.PI;
const round = (v, k) => Math.round(v * k) / k;

/**
 * Validates a stored value (string or parsed object). Bad or foreign data → null.
 * @param {string|object|null} raw
 * @returns {{ pos: number[], yawDeg: number, pitchDeg: number, levelId: string|null, roomId: string|null, t: number }|null}
 */
export function parseLastPosition(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object' || o.v !== VERSION) return null;
  const pos = o.pos;
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < MAX_COORD)) return null;
  const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return {
    pos: [...pos],
    yawDeg: num(o.yawDeg),
    pitchDeg: Math.max(-89, Math.min(89, num(o.pitchDeg))),
    levelId: str(o.levelId),
    roomId: str(o.roomId),
    t: num(o.t),
  };
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // a sandboxed frame / blocked storage throws on the mere access
  }
}

export class LastPosition {
  /**
   * @param {object} [o]
   * @param {Storage|null} [o.storage]   default: localStorage (null when blocked)
   * @param {string} [o.key]
   * @param {number} [o.interval]        seconds of game time between writes
   * @param {boolean} [o.readOnly]
   */
  constructor({ storage, key = LAST_POSITION_KEY, interval = DEFAULT_INTERVAL, readOnly = false } = {}) {
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.key = key;
    this.interval = interval;
    this.readOnly = !!readOnly || !this.storage;
    this.pending = null;
    this._written = null; // the last spot written (or loaded): { pos, yawDeg }
    this._writtenAt = -Infinity;
  }

  /** The saved position, or null (nothing saved, bad data, blocked storage). */
  load() {
    let raw = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      return null;
    }
    const saved = raw == null ? null : parseLastPosition(raw);
    if (saved) this._written = { pos: saved.pos, yawDeg: saved.yawDeg };
    return saved;
  }

  /**
   * Remembers a spot (feet, world) the player stands on and writes it when due.
   * @param {{ x: number, y: number, z: number }} feet
   * @param {number} yaw    radians
   * @param {number} pitch  radians
   * @param {{ levelId?: string|null, roomId?: string|null }} [where]
   * @param {number} [time] seconds (game time); without it every call may write
   * @returns {boolean} true when it was written now
   */
  record(feet, yaw, pitch, { levelId = null, roomId = null } = {}, time = Infinity) {
    if (this.readOnly || !feet || !Number.isFinite(feet.x + feet.y + feet.z)) return false;
    const entry = {
      v: VERSION,
      pos: [round(feet.x, 1000), round(feet.y, 1000), round(feet.z, 1000)],
      yawDeg: round(Number.isFinite(yaw) ? yaw * RAD : 0, 10),
      pitchDeg: round(Number.isFinite(pitch) ? pitch * RAD : 0, 10),
      levelId: levelId ?? null,
      roomId: roomId ?? null,
    };
    const w = this._written;
    if (w) {
      const moved = Math.hypot(entry.pos[0] - w.pos[0], entry.pos[1] - w.pos[1], entry.pos[2] - w.pos[2]);
      const turned = Math.abs(((entry.yawDeg - w.yawDeg + 540) % 360) - 180);
      if (moved < MIN_MOVE && turned < MIN_TURN) {
        this.pending = null; // nothing new since the last write
        return false;
      }
    }
    this.pending = entry;
    if (Number.isFinite(time) && time - this._writtenAt < this.interval) return false;
    this._writtenAt = Number.isFinite(time) ? time : this._writtenAt;
    return this._write();
  }

  /** Writes a remembered spot now. @returns {boolean} true when nothing is left unwritten */
  flush() {
    if (!this.pending) return true;
    return this._write();
  }

  /** Forgets the saved position (and a remembered one). */
  clear() {
    this.pending = null;
    this._written = null;
    if (this.readOnly) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* blocked storage: nothing to clear */
    }
  }

  _write() {
    const entry = this.pending;
    if (!entry || this.readOnly) return !entry;
    try {
      this.storage.setItem(this.key, JSON.stringify({ ...entry, t: Date.now() }));
      this._written = { pos: entry.pos, yawDeg: entry.yawDeg };
      this.pending = null;
      return true;
    } catch {
      return false; // full or blocked: the next visit starts outside (or at an older spot)
    }
  }
}
