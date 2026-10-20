import * as THREE from 'three';

/**
 * Input – keyboard + mouse, World-of-Warcraft style mouse handling.
 *
 * CONTRACT (used by Game.js, PlayerController.js, Interaction.js):
 *   new Input(domElement, settings)
 *   setEnabled(bool)        false: release pointer lock, clear all held keys/buttons, ignore events
 *   update(dt)              call once per frame BEFORE reading state; computes this frame's values
 *   move: { forward, right }   each -1..1 (forward = W/S, right = strafe)
 *   turn: number            -1..1 keyboard turning (A/D when settings.turnWithKeys && !isMouseLook), + = right
 *   lookDelta: { x, y }     radians to add to yaw (x, + = turn right) and pitch (y, + = look up) this frame
 *   running: boolean        run modifier active
 *   jumpPressed: boolean    true for the one frame Space went down
 *   isMouseLook: boolean    mouse currently controls the camera (RMB/LMB drag in WoW mode, always in FPS mode)
 *   isCaptured: boolean     pointer is locked (centre-screen targeting, crosshair visible)
 *   getPointerNDC(target: Vector2) → Vector2|null   cursor position in NDC when the cursor is free and over the canvas
 *   consumeClick() → {x,y}|null   a left click that was NOT a drag, since last consume (NDC)
 *   consumeAction(name) → bool    edge-triggered actions: 'interact' (E/F), 'pause' (Esc or lost pointer lock),
 *                                 'help' (H/F1)
 *   dispose()
 *
 * Extras (optional, read by PlayerController):
 *   crouch: boolean         C held (not Ctrl: Ctrl + W/S/D/F/E would trigger browser shortcuts – Ctrl+W
 *                           even closes the tab, which a page cannot prevent)
 *   keys: Set<string>       KeyboardEvent.code of every key held right now (read-only for others)
 *   setPointerClaim(fn|null) a tool may claim left presses on the canvas (fn(event) → true), e.g. to drag furniture
 *   setKeyClaim(fn|null)     a tool may claim key presses (fn(keyboardEvent) → true): the key then neither moves
 *                            the player nor triggers an action (arrow keys nudging a selected piece of furniture)
 *   pointerClient: { x, y, inside, known }   last free cursor position in client pixels (read-only)
 *
 * Mouse modes (settings.mouseMode):
 *   'wow' – the cursor is free and is the targeting ray. Hold the RIGHT button to look around (pointer lock
 *           hides the cursor while held; on release the browser puts the cursor back where it was). Dragging
 *           with the LEFT button (> DRAG_THRESHOLD px) also looks; a left click without drag is an interact
 *           click. Both buttons held = walk forward. If pointer lock is refused we fall back to a plain drag
 *           using movementX/Y (the cursor stays visible).
 *   'fps' – clicking the canvas captures the pointer until Esc. Mouse always looks, crosshair targeting, a left
 *           click while captured is an interact click at the screen centre.
 *
 * Keys use KeyboardEvent.code, so the bindings are layout independent (Norwegian keyboards included).
 */

/**
 * Base mouse-look sensitivity (multiplied by settings.mouseSensitivity). Two scales because the browser reports
 * two kinds of movement: OS-adjusted pixels (pointer speed + acceleration – drag fallback, browsers without raw
 * input such as Firefox) and raw device counts (pointer lock with unadjustedMovement). Raw counts at 1×:
 * ≈ 0.08°/count → a full turn takes ~14 cm of mouse travel at 800 DPI, ~7 cm at 1600 DPI. OS pixels are
 * usually a bit smaller than counts for slow, precise movement (Windows "enhance pointer precision"), so that
 * scale is slightly higher to feel about the same.
 */
const RAD_PER_PIXEL = 0.0017;
const RAD_PER_RAW_COUNT = 0.0014;
/** Left-button movement (px) before a press turns from a click into a mouse-look drag. */
const DRAG_THRESHOLD = 4;
/**
 * Glitch filter for mouse movement (Chrome sometimes reports one huge movementX/Y right after a pointer lock
 * change or randomly while locked). An event is dropped only when it is both large in absolute terms and far
 * above the recent movement – a real fast flick ramps up over a few frames and passes.
 */
const SPIKE_MIN_PX = 250;
const SPIKE_RATIO = 6;
/** ms – how fast the recent-movement average forgets once the mouse stops. */
const SPIKE_AVG_TAU = 150;
/** Two pause requests closer than this (ms) are merged (Esc keydown + pointer lock loss of the same press). */
const PAUSE_DEDUPE_MS = 400;

/**
 * Key bindings by KeyboardEvent.code. Ctrl is deliberately NOT a game key: Ctrl+S/D/F/E/A would open browser
 * dialogs and Ctrl+W closes the tab (pages cannot block that one).
 */
const BINDINGS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['KeyC'],
  interact: ['KeyE', 'KeyF'],
  help: ['KeyH', 'F1'],
  pause: ['Escape'],
});

/** Keys whose browser default (scrolling, help page) must be suppressed while playing. */
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Tab']);

/** Events on which browsers act on the mouse side buttons (Chrome navigates on mouseup, others on mousedown). */
const SIDE_BUTTON_EVENTS = ['mousedown', 'mouseup', 'auxclick'];

const CODE_TO_ACTION = new Map();
for (const [action, codes] of Object.entries(BINDINGS)) for (const c of codes) CODE_TO_ACTION.set(c, action);

/** True if any of the codes is in the held set (plain loop – runs several times per frame). */
function anyHeld(keys, codes) {
  for (let i = 0; i < codes.length; i++) if (keys.has(codes[i])) return true;
  return false;
}

export class Input {
  /**
   * @param {HTMLElement} domElement  the game canvas (pointer lock target, mouse button target)
   * @param {import('./Settings.js').Settings} settings
   */
  constructor(domElement, settings) {
    this.el = domElement;
    this.settings = settings;
    this.enabled = false;

    /** Codes of keys currently held. */
    this.keys = new Set();
    this.move = { forward: 0, right: 0 };
    this.turn = 0;
    this.lookDelta = { x: 0, y: 0 };
    this.running = false;
    this.crouch = false;
    this.jumpPressed = false;
    this.isMouseLook = false;
    this.isCaptured = false;

    this._actions = new Set();
    this._click = null;
    this._pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, inside: false, known: false };
    this._acc = { x: 0, y: 0 };
    this._jump = false;
    this._runLatched = false;
    this._lastPause = -Infinity;
    this._pointerClaim = null;
    this._keyClaim = null;
    this._enabledAt = 0;

    // mouse button state
    this._lmb = false;
    this._rmb = false;
    this._lmbDrag = false;
    this._lmbTravel = 0;
    this._lmbDown = { x: 0, y: 0 };
    this._lmbChord = false; // another button was involved → the left press can no longer be a click
    this._fpsLook = false;

    // pointer lock bookkeeping
    this._expectUnlock = false; // we asked for the unlock (button released / disabled) → not a pause
    this._lockPending = false;
    this._lockRefused = false; // pointer lock unsupported or refused → plain drag fallback
    this._skipNextMove = false; // first movement after a lock change can be garbage
    this._promiseLock = false; // requestPointerLock returns a promise → it (not the error event) reports failures
    this._rawSupported = null; // unadjustedMovement (raw mouse input) support: null unknown, true, false
    this._lockRaw = false; // the current pointer lock delivers raw counts
    this._moveAvg = 0; // recent per-event mouse movement (px) for the glitch filter
    this._lastMoveT = 0;

    this._bind();
  }

  /* ------------------------------------------------------------------ public API */

  /** Enable/disable all input. Disabling releases the pointer and forgets everything held. */
  setEnabled(v) {
    v = !!v;
    if (v === this.enabled) return;
    this.enabled = v;
    this._enabledAt = performance.now();
    this._clearHeld();
    this._actions.clear();
    this._click = null;
    if (!v) {
      this._releaseLock();
    } else if (this._mode() === 'fps' && navigator.userActivation?.isActive) {
      // Resuming from a menu click in FPS mode: grab the pointer again within the same user gesture.
      this._requestLock();
    }
  }

  /** Compute this frame's movement/look values. Call once per frame before anything reads the state. */
  update(/* dt */) {
    const k = this.keys;
    const B = BINDINGS;

    this.isCaptured = this._lockedToUs();
    this.isMouseLook = this._computeMouseLook();

    let forward = (anyHeld(k, B.forward) ? 1 : 0) - (anyHeld(k, B.back) ? 1 : 0);
    // WoW: both mouse buttons held = walk forward
    if (this._mode() === 'wow' && this._lmb && this._rmb) forward = 1;
    const side = (anyHeld(k, B.right) ? 1 : 0) - (anyHeld(k, B.left) ? 1 : 0);

    if (this.settings.get('turnWithKeys') && !this.isMouseLook) {
      this.move.right = 0;
      this.turn = side;
    } else {
      this.move.right = side;
      this.turn = 0;
    }
    this.move.forward = forward;

    this.running = this.settings.get('runToggle') ? this._runLatched : anyHeld(k, B.run);
    this.crouch = anyHeld(k, B.crouch);
    this.jumpPressed = this._jump;
    this._jump = false;

    const sens = this.settings.get('mouseSensitivity') ?? 1; // _acc is already in radians at 1×
    const inv = this.settings.get('invertY') ? -1 : 1;
    this.lookDelta.x = this._acc.x * sens;
    this.lookDelta.y = -this._acc.y * sens * inv;
    this._acc.x = 0;
    this._acc.y = 0;
  }

  /**
   * Cursor position in normalized device coordinates, or null when the cursor is hidden/captured,
   * outside the canvas or unknown.
   * @param {THREE.Vector2} [target]
   * @returns {THREE.Vector2|null}
   */
  getPointerNDC(target = new THREE.Vector2()) {
    const p = this._pointer;
    if (this.isCaptured || !p.inside || !p.known) return null;
    return target.set(p.ndcX, p.ndcY);
  }

  /** A left click (not a drag) since the last call, in NDC; null if none. */
  consumeClick() {
    const c = this._click;
    this._click = null;
    return c;
  }

  /**
   * Let a tool take over left-button presses on the canvas. `fn(mouseEvent) → true` claims the press: Input then
   * ignores it (no click, no mouse-look drag); the tool listens for mousemove / mouseup itself. Only one claimer;
   * pass null to remove it. Not consulted while the pointer is locked (mouse-look / FPS capture).
   * @param {((e: MouseEvent) => boolean) | null} fn
   */
  setPointerClaim(fn) {
    this._pointerClaim = typeof fn === 'function' ? fn : null;
  }

  /**
   * Let a tool take over key presses. `fn(keyboardEvent) → true` claims the press: Input then does not count the key
   * as held (no walking) and fires no action for it; the tool handles the key in its own listener. Releasing the key
   * is always seen. Only one claimer; pass null to remove it. Never consulted for Esc.
   * @param {((e: KeyboardEvent) => boolean) | null} fn
   */
  setKeyClaim(fn) {
    this._keyClaim = typeof fn === 'function' ? fn : null;
  }

  /** Last free cursor position in client pixels ({ x, y, inside, known }); read-only. */
  get pointerClient() {
    return this._pointer;
  }

  /** Edge-triggered actions: 'interact', 'pause', 'help'. Returns true once per trigger. */
  consumeAction(name) {
    const had = this._actions.has(name);
    this._actions.delete(name);
    return had;
  }

  dispose() {
    this.setEnabled(false);
    this._unbind();
  }

  /* ------------------------------------------------------------------ state helpers */

  _mode() {
    return this.settings.get('mouseMode') === 'fps' ? 'fps' : 'wow';
  }

  _lockedToUs() {
    return document.pointerLockElement === this.el;
  }

  _computeMouseLook() {
    if (!this.enabled) return false;
    if (this._mode() === 'fps') return this._lockedToUs() || this._fpsLook;
    return this._rmb || (this._lmb && this._lmbDrag);
  }

  /** WoW mode: does any held button currently want the pointer locked? */
  _wantsLock() {
    if (this._mode() === 'fps') return true;
    return this._rmb || (this._lmb && this._lmbDrag);
  }

  _clearHeld() {
    this.keys.clear();
    this._lmb = this._rmb = false;
    this._lmbDrag = false;
    this._lmbChord = false;
    this._fpsLook = false;
    this._jump = false;
    this._acc.x = this._acc.y = 0;
    this.move.forward = this.move.right = 0;
    this.turn = 0;
    this.crouch = false;
    this.jumpPressed = false;
    this.isMouseLook = false;
    this.lookDelta.x = this.lookDelta.y = 0;
  }

  _addPause() {
    const now = performance.now();
    if (now - this._lastPause < PAUSE_DEDUPE_MS) return;
    this._lastPause = now;
    this._actions.add('pause');
  }

  /**
   * Browser glitch filter: true for a single mouse event that is huge AND far above the recent movement.
   * Real motion (including fast flicks, which ramp up over a few frames) feeds the running average.
   */
  _isSpike(mx, my, time) {
    const dt = Math.max(0, (time || 0) - this._lastMoveT);
    this._lastMoveT = time || 0;
    this._moveAvg *= Math.exp(-dt / SPIKE_AVG_TAU);
    const mag = Math.max(Math.abs(mx), Math.abs(my));
    if (mag > SPIKE_MIN_PX && mag > SPIKE_RATIO * (this._moveAvg + 15)) return true;
    this._moveAvg += (mag - this._moveAvg) * 0.5;
    return false;
  }

  /* ------------------------------------------------------------------ pointer lock */

  _requestLock() {
    if (this._lockedToUs() || this._lockPending || this._lockRefused) return;
    if (!this.el.requestPointerLock) {
      this._lockRefused = true;
      return;
    }
    this._lockPending = true;
    this._tryLock(this._rawSupported !== false);
  }

  /**
   * One pointer lock request. `raw` asks for unadjusted movement (no OS mouse acceleration – consistent look
   * speed, and it avoids Chrome's movement spikes); where that is not supported (e.g. Chrome on Linux:
   * NotSupportedError) we retry once without it and remember the answer.
   */
  _tryLock(raw) {
    this._lockRaw = false; // until a raw request is confirmed
    let p;
    try {
      p = raw ? this.el.requestPointerLock({ unadjustedMovement: true }) : this.el.requestPointerLock();
    } catch {
      if (raw) {
        this._rawSupported = false;
        this._tryLock(false);
      } else {
        this._onLockError();
      }
      return;
    }
    // Modern browsers return a promise (it reports every failure); older ones only fire 'pointerlockerror'
    // and ignore the options argument.
    if (!p || typeof p.then !== 'function') return;
    this._promiseLock = true;
    p.then(
      () => {
        if (raw) this._rawSupported = this._lockRaw = true;
      },
      (err) => {
        if (raw && err?.name === 'NotSupportedError' && this._lockPending) {
          this._rawSupported = false;
          this._tryLock(false);
        } else {
          this._onLockError();
        }
      },
    );
  }

  _releaseLock() {
    this._lockPending = false;
    if (this._lockedToUs()) {
      this._expectUnlock = true;
      document.exitPointerLock?.();
    }
  }

  _onLockError() {
    this._lockPending = false;
    // In WoW mode keep working with a visible-cursor drag. A refused request right after the user left the
    // lock with Esc is temporary (browser cooldown), so only remember refusals while a button is held.
    if (this._mode() === 'wow') {
      this._lockRefused = this._rmb || this._lmb;
      if (this._lockRefused) setTimeout(() => (this._lockRefused = false), 1500);
    }
  }

  /* ------------------------------------------------------------------ DOM events */

  _bind() {
    this._onKeyDown = (e) => {
      if (!this.enabled || isTypingTarget(e.target)) return;
      // A key press that started before we were (re-)enabled belongs to the menu that resumed the game
      // (e.g. Esc closing the pause menu) – don't let it pause again.
      if (e.timeStamp && e.timeStamp <= this._enabledAt) return;
      const action = CODE_TO_ACTION.get(e.code);
      // Ctrl/Cmd + a game key (habit, or Ctrl held for something else) must not open Save/Find/Bookmark.
      if (PREVENT_DEFAULT.has(e.code) || (action && (e.ctrlKey || e.metaKey))) e.preventDefault();
      // a tool may own this key right now (arrow keys nudging the selected item …): not held, no action
      if (this._keyClaim && action !== 'pause') {
        let claimed = false;
        try {
          claimed = !!this._keyClaim(e);
        } catch (err) {
          console.error('[input] key claim failed', err);
        }
        if (claimed) {
          this.keys.delete(e.code);
          return;
        }
      }
      if (!e.repeat) {
        if (action === 'pause') this._addPause();
        else if (action === 'interact') this._actions.add('interact');
        else if (action === 'help') this._actions.add('help');
        else if (action === 'jump') this._jump = true;
        else if (action === 'run' && this.settings.get('runToggle')) this._runLatched = !this._runLatched;
      }
      this.keys.add(e.code);
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (this.enabled && PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    };

    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      this._updatePointer(e);
      // a tool (e.g. dragging a selected piece of furniture) may claim a left press: then it is neither a click nor
      // a mouse-look drag, and the tool handles the following moves / mouseup itself
      if (e.button === 0 && this._pointerClaim && !this._lockedToUs()) {
        let claimed = false;
        try {
          claimed = !!this._pointerClaim(e);
        } catch (err) {
          console.error('[input] pointer claim failed', err);
        }
        if (claimed) {
          e.preventDefault();
          this.el.focus?.({ preventScroll: true });
          return;
        }
      }
      if (this._mode() === 'fps') {
        if (e.button !== 0) return;
        if (this._lockedToUs()) {
          this._click = { x: 0, y: 0 };
        } else {
          this._requestLock();
          // without pointer lock support, holding the left button looks around instead
          if (this._lockRefused) this._fpsLook = true;
        }
        e.preventDefault();
        return;
      }

      // ---- WoW mode
      if (e.button === 0) {
        this._lmb = true;
        this._lmbDrag = false;
        this._lmbTravel = 0;
        this._lmbChord = this._rmb;
        this._lmbDown.x = this._pointer.ndcX;
        this._lmbDown.y = this._pointer.ndcY;
      } else if (e.button === 2) {
        this._rmb = true;
        if (this._lmb) this._lmbChord = true;
        this._requestLock();
      }
      if (this._lmb && this._rmb) this._requestLock();
      e.preventDefault();
      this.el.focus?.({ preventScroll: true });
    };

    this._onMouseUp = (e) => {
      if (this._mode() === 'fps') {
        if (e.button === 0) this._fpsLook = false;
        return;
      }
      if (e.button === 0 && this._lmb) {
        if (this.enabled && !this._lmbDrag && !this._lmbChord && !this._rmb) {
          this._click = { x: this._lmbDown.x, y: this._lmbDown.y };
        }
        this._lmb = false;
        this._lmbDrag = false;
      } else if (e.button === 2 && this._rmb) {
        this._rmb = false;
      } else {
        return;
      }
      if (!this._wantsLock()) this._releaseLock();
    };

    this._onMouseMove = (e) => {
      this._updatePointer(e);
      if (!this.enabled) return;

      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (this._skipNextMove) {
        this._skipNextMove = false;
        return;
      }
      if (this._isSpike(mx, my, e.timeStamp)) return;

      if (this._mode() === 'wow' && this._lmb && !this._lmbDrag) {
        this._lmbTravel += Math.hypot(mx, my);
        if (this._lmbTravel > DRAG_THRESHOLD) {
          this._lmbDrag = true;
          this._requestLock();
        } else {
          return; // still a potential click: don't rotate yet
        }
      }

      if (this._computeMouseLook()) {
        const scale = this._lockedToUs() && this._lockRaw ? RAD_PER_RAW_COUNT : RAD_PER_PIXEL;
        this._acc.x += mx * scale;
        this._acc.y += my * scale;
      }
    };

    this._onLockChange = () => {
      this._lockPending = false;
      this._skipNextMove = true;
      const locked = this._lockedToUs();
      this.isCaptured = locked;
      if (locked) {
        this._expectUnlock = false;
        // The button may have been released before the lock arrived (fast click) – give it back.
        if (!this.enabled || !this._wantsLock()) this._releaseLock();
        return;
      }
      const expected = this._expectUnlock;
      this._expectUnlock = false;
      if (!expected && this.enabled) {
        // Lost unexpectedly: Esc pressed while captured, alt-tab, ... → pause (once).
        this._lmb = this._rmb = this._lmbDrag = false;
        this._fpsLook = false;
        this._addPause();
      } else if (expected && this.enabled && this._wantsLock()) {
        // A button went down again while our own unlock was still in flight (quick second right-click):
        // the request made then was skipped because we were still locked – lock again now.
        this._requestLock();
      }
    };

    this._onLockError = this._onLockError.bind(this);
    // With the promise API the rejected promise reports the failure (and may trigger a retry without raw
    // input), so the event would only report the same failure twice.
    this._onLockErrorEvent = () => {
      if (!this._promiseLock) this._onLockError();
    };

    this._onContextMenu = (e) => e.preventDefault();

    // The back/forward side buttons of many mice (3/4) navigate the page history – never mid-game.
    this._onSideButton = (e) => {
      if (this.enabled && (e.button === 3 || e.button === 4)) e.preventDefault();
    };

    this._onBlur = () => {
      const wasEnabled = this.enabled;
      this._clearHeld();
      if (wasEnabled && this._mode() === 'wow') this._releaseLock();
    };

    this._onMouseOut = (e) => {
      if (!e.relatedTarget) this._pointer.inside = false;
    };

    this._onSettings = ({ key }) => {
      if (key === 'mouseMode') {
        this._clearHeld();
        if (this._mode() === 'wow') this._releaseLock();
      } else if (key === 'runToggle') {
        this._runLatched = false;
      }
    };

    this._onResize = () => (this._rectDirty = true);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('scroll', this._onResize, true);
    if (typeof ResizeObserver !== 'undefined') {
      try {
        this._resizeObs = new ResizeObserver(this._onResize);
        this._resizeObs.observe(this.el);
      } catch {
        this._resizeObs = null;
      }
    }
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.el.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseout', this._onMouseOut);
    window.addEventListener('blur', this._onBlur);
    this.el.addEventListener('contextmenu', this._onContextMenu);
    for (const type of SIDE_BUTTON_EVENTS) window.addEventListener(type, this._onSideButton, true);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockErrorEvent);
    this.settings.on?.('change', this._onSettings);
  }

  _unbind() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onResize, true);
    this._resizeObs?.disconnect();
    this._resizeObs = null;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.el.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseout', this._onMouseOut);
    window.removeEventListener('blur', this._onBlur);
    this.el.removeEventListener('contextmenu', this._onContextMenu);
    for (const type of SIDE_BUTTON_EVENTS) window.removeEventListener(type, this._onSideButton, true);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockErrorEvent);
    this.settings.off?.('change', this._onSettings);
  }

  /**
   * The canvas rect, cached until the window / canvas is resized: reading it on every mouse move after the frame's
   * DOM writes (HUD pills, panels) forced a layout each time.
   */
  _rect() {
    if (!this._rectCache || this._rectDirty) {
      this._rectCache = this.el.getBoundingClientRect();
      this._rectDirty = false;
    }
    return this._rectCache;
  }

  _updatePointer(e) {
    // While locked the browser freezes clientX/Y at the lock position – keep the last free position.
    if (this._lockedToUs()) return;
    const r = this._rect();
    const p = this._pointer;
    p.x = e.clientX;
    p.y = e.clientY;
    // over a UI panel (not while a button is held, so a drag that crosses a panel keeps going) = not over the 3D view
    p.inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom && !overUi(e, this.el);
    p.ndcX = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    p.ndcY = -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
    p.known = true;
  }
}

/**
 * True when a mouse/pointer event without held buttons is over an interactive overlay (panel, toolbar …) rather than
 * the 3D canvas. #ui-root has pointer-events: none, so only interactive overlay elements can be the target.
 * @param {MouseEvent} e
 * @param {HTMLElement} canvas
 */
export function overUi(e, canvas) {
  if (e.buttons) return false;
  const t = e.target;
  return !!t && t !== canvas && typeof t.closest === 'function' && !!t.closest('#ui-root');
}

/** True when a keyboard event belongs to a text field (settings inputs etc.), not to the game. */
function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
