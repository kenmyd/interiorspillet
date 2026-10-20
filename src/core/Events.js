/**
 * Minimal event emitter used to decouple game systems.
 *
 * Event names in use on game.events / ctx.events (keep this list current):
 *  - 'sfx'        { name, position?, volume? }             one-shot sound request → AudioSystem.play
 *  - 'footstep'   { surface, running, crouch }             emitted by PlayerController
 *  - 'jump' / 'land' { surface, impact?, speed? }          emitted by PlayerController
 *  - 'room'       { id, name } | null                       camera entered one of home.rooms (null = none)
 *  - 'interact'   { id }                                    an interactable was used (InteractionSystem)
 *  - 'toast'      { text, seconds? }                        HUD message request
 *  - 'settings'   { key, value }                            a setting changed (also on Settings itself)
 *  - 'input-block' { blocked, reasons }                     game.blockInput() state changed (UI panels open/closed)
 *  - 'focus'      { active }                                (reserved) InteractionSystem clears its target when active
 */
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(name, fn) {
    this._handlers.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this._handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" failed`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}
