/**
 * Small procedural WebAudio sound system (replaces Kraftverkspillet's large AudioSystem; same API surface, so
 * Game.js / Door.js / ui/dom.js bindUiSounds work unchanged). Everything is synthesised from oscillators and one
 * shared noise buffer – the game ships no audio files. The calm background music (core/Music.js) is synthesised too.
 *
 * CONTRACT (used by main.js / Game.js / world builders through ctx.audio):
 *   new AudioSystem(settings)      reads masterVolume / effectsVolume / music / musicVolume and follows their changes
 *   async unlock() → boolean       create / resume the AudioContext (call from a user gesture); true when running.
 *                                  Never throws and never waits more than ~0.3 s (resume() hangs without a gesture).
 *   play(name, opts) → { stop() } | null
 *       names: 'footstep' { surface, running, crouch }   surface 'wood' (default) | 'rug' | 'tile' | other → wood
 *              'jump' { surface }, 'land' { surface, impact 0..1 }
 *              'door-open', 'door-close', 'door-locked'
 *              'ui-hover', 'ui-click'          (UI bus: audible while paused)
 *              'place' (soft thud – something put down), 'pick' (soft lift click), 'switch' (light switch)
 *       opts: volume (0..1+, default 1), position (THREE.Vector3 → positional, needs update(dt, camera)),
 *             delay (s). Unknown names are ignored (returns null).
 *   setPaused(bool)                mutes the world bus (UI sounds stay) while the pause menu is open
 *   setEnvironment(obj)            accepted and ignored (kept for API compatibility)
 *   update(dt, camera)             moves the listener to the camera (positional one-shots)
 *   stopAll()                      stops every playing voice (quit to menu); the music keeps playing
 *   dispose()                      stops the music and closes the context
 *   music: AmbientMusic | null     created with the context; plays while the setting 'music' is on – also on the
 *                                  start screen and while paused
 *   available: boolean             WebAudio exists in this browser;  state: AudioContext state or 'none'
 *
 * Everything before unlock() (or without WebAudio) is a silent no-op. Pointer / key presses anywhere on the page
 * also create / resume the context (until it runs). While the page is hidden the context is suspended.
 *
 * Signal graph:  world voices → worldBus (pause) ─┐
 *                ui voices ─────────────→ uiBus ──┴→ effects (effectsVolume) ─┐
 *                music (core/Music.js) ──────────→ musicBus (musicVolume) ────┴→ master (masterVolume) → compressor → out
 */

import { AmbientMusic } from './Music.js';

const MAX_VOICES = 24;

/** Mix levels per sound (linear). Tune here, not in the recipes. */
export const LEVELS = {
  footstep: 0.55,
  jump: 0.35,
  land: 0.45,
  'door-open': 0.5,
  'door-close': 0.55,
  'door-locked': 0.5,
  'ui-hover': 0.18,
  'ui-click': 0.35,
  place: 0.5,
  pick: 0.35,
  switch: 0.4,
};

const UI_SOUNDS = new Set(['ui-hover', 'ui-click']);

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioSystem {
  /** @param {import('./Settings.js').Settings} [settings] */
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.music = null;
    this.available = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.paused = false;
    this._voices = new Set();
    this._listenerPlaced = false;

    this._onSettings = ({ key }) => {
      if (key === 'masterVolume' || key === 'effectsVolume' || key === 'musicVolume') this._applyVolumes();
      else if (key === 'music') this._applyMusic();
    };
    settings?.on?.('change', this._onSettings);

    // gestures anywhere unlock (menu hover / click sounds work after the first click); the listeners stay until the
    // context actually runs (some key presses, e.g. Esc, do not count as user activation)
    this._onGesture = () => {
      this.unlock().then(() => {
        if (this.ctx?.state === 'running') this._removeGestureListeners();
      });
    };
    if (this.available) {
      window.addEventListener('pointerdown', this._onGesture, { capture: true });
      window.addEventListener('keydown', this._onGesture, { capture: true });
    }
    this._onVisibility = () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend?.().catch(() => {});
      else this.ctx.resume?.().catch(() => {});
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  _removeGestureListeners() {
    window.removeEventListener('pointerdown', this._onGesture, { capture: true });
    window.removeEventListener('keydown', this._onGesture, { capture: true });
  }

  get state() {
    return this.ctx ? this.ctx.state : 'none';
  }

  /* ------------------------------------------------------------------ lifecycle */

  async unlock() {
    if (!this.available) return false;
    try {
      if (!this.ctx) this._create();
      // Without a user gesture (e.g. ?play=1) browsers keep resume() pending until the first click – never let the
      // caller wait for that; the gesture listeners resume the context later.
      if (this.ctx.state === 'suspended' && !document.hidden) {
        await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      }
      return this.ctx.state === 'running';
    } catch (err) {
      console.warn('[audio] unlock failed', err);
      return false;
    }
  }

  _create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.2;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(this.compressor);
    this.effects = ctx.createGain();
    this.effects.connect(this.master);
    this.worldBus = ctx.createGain();
    this.worldBus.gain.value = this.paused ? 0 : 1;
    this.worldBus.connect(this.effects);
    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.effects);
    // the music has its own volume and skips the effects bus (and the pause mute)
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.music = new AmbientMusic(ctx, this.musicBus);

    // 1 s of white noise, shared by every voice
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._applyVolumes();
    this._applyMusic();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mv = this.settings?.get?.('masterVolume') ?? 0.7;
    const ev = this.settings?.get?.('effectsVolume') ?? 0.9;
    const muv = this.settings?.get?.('musicVolume') ?? 0.5;
    this.master.gain.setTargetAtTime(mv, t, 0.03);
    this.effects.gain.setTargetAtTime(ev, t, 0.03);
    this.musicBus.gain.setTargetAtTime(muv, t, 0.03);
  }

  /** Starts / stops the background music to follow the setting 'music' (on by default). */
  _applyMusic() {
    if (!this.music) return;
    if (this.settings?.get?.('music') !== false) this.music.start();
    else this.music.stop();
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (!this.ctx) return;
    this.worldBus.gain.setTargetAtTime(this.paused ? 0 : 1, this.ctx.currentTime, 0.06);
  }

  setEnvironment() {
    /* no environments in this game – kept for API compatibility */
  }

  update(dt, camera) {
    if (!this.ctx || !camera) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    // camera looks along its local −z; up is local +y
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(px, t);
      l.positionY.setValueAtTime(py, t);
      l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(ux, t);
      l.upY.setValueAtTime(uy, t);
      l.upZ.setValueAtTime(uz, t);
    } else {
      l.setPosition?.(px, py, pz);
      l.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
    this._listenerPlaced = true;
  }

  stopAll() {
    for (const v of [...this._voices]) v.stop();
    this._voices.clear();
  }

  dispose() {
    this.stopAll();
    this.music?.dispose();
    this.music = null;
    this.settings?.off?.('change', this._onSettings);
    this._removeGestureListeners();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.ctx?.close?.().catch(() => {});
    this.ctx = null;
  }

  /* ------------------------------------------------------------------ one-shots */

  /**
   * @param {string} name
   * @param {object} [opts]
   * @returns {{stop: () => void} | null}
   */
  play(name, opts = {}) {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return null;
      const recipe = RECIPES[name];
      if (!recipe) return null;
      const isUi = UI_SOUNDS.has(name);
      if (!isUi && this.paused) return null;
      if (this._voices.size >= MAX_VOICES) return null;

      const out = ctx.createGain();
      out.gain.value = (LEVELS[name] ?? 0.5) * (opts.volume ?? 1);
      let tail = out;
      if (opts.position && !isUi && this._listenerPlaced) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        p.refDistance = opts.refDistance ?? 1.5;
        p.maxDistance = opts.maxDistance ?? 40;
        p.rolloffFactor = opts.rolloff ?? 1;
        const { x, y, z } = opts.position;
        if (p.positionX) {
          p.positionX.value = x;
          p.positionY.value = y;
          p.positionZ.value = z;
        } else {
          p.setPosition(x, y, z);
        }
        out.connect(p);
        tail = p;
      }
      tail.connect(isUi ? this.uiBus : this.worldBus);

      const t0 = ctx.currentTime + 0.005 + Math.max(0, opts.delay ?? 0);
      const sources = [];
      recipe(this, out, t0, opts, sources);
      const voice = {
        stop: () => {
          if (!this._voices.has(voice)) return;
          this._voices.delete(voice);
          for (const s of sources) {
            try {
              s.stop();
            } catch {
              /* already stopped */
            }
          }
          try {
            tail.disconnect();
          } catch {
            /* already disconnected */
          }
        },
      };
      this._voices.add(voice);
      // the voice ends with its longest source (each source carries its stop time in _end)
      let last = null;
      for (const s of sources) if (!last || s._end > last._end) last = s;
      if (last) last.onended = () => voice.stop();
      else voice.stop();
      return voice;
    } catch (err) {
      console.warn('[audio] play failed', name, err);
      return null;
    }
  }

  /* ------------------------------------------------------------------ building blocks (used by RECIPES) */

  /** Filtered noise burst: attack a, exponential decay to silence over `decay` seconds. */
  _noise(dest, t0, { type = 'bandpass', freq = 800, q = 1, gain = 1, attack = 0.002, decay = 0.08, sources }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    src.connect(f).connect(g).connect(dest);
    const offset = Math.random() * 0.8;
    src.start(t0, offset);
    src.stop((src._end = t0 + attack + decay + 0.02));
    sources.push(src);
    return attack + decay;
  }

  /** Short pitched tone with a pitch glide f0 → f1 and exponential decay. */
  _tone(dest, t0, { type = 'sine', f0 = 120, f1 = f0, gain = 1, attack = 0.003, decay = 0.1, sources }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop((o._end = t0 + attack + decay + 0.02));
    sources.push(o);
    return attack + decay;
  }
}

/* ------------------------------------------------------------------ recipes */

/**
 * Footstep on a wooden floor: a low heel thump (body of the floor), a mid "board" knock and a faint high tick.
 * Rugs muffle it (no tick, lower knock); tiles make it harder and brighter. Each step varies a little.
 */
function step(a, dest, t0, opts, sources, scale = 1) {
  const surface = opts.surface ?? 'wood';
  const run = opts.running ? 1 : 0;
  const crouch = opts.crouch ? 1 : 0;
  const v = rand(0.85, 1.12) * scale * (run ? 1.35 : 1) * (crouch ? 0.45 : 1);
  const p = rand(0.92, 1.08);
  if (surface === 'rug') {
    a._tone(dest, t0, { f0: 95 * p, f1: 60 * p, gain: 0.55 * v, decay: 0.07, sources });
    return a._noise(dest, t0, { type: 'lowpass', freq: 520 * p, q: 0.6, gain: 0.35 * v, decay: 0.06, sources });
  }
  if (surface === 'tile') {
    a._tone(dest, t0, { f0: 140 * p, f1: 90 * p, gain: 0.45 * v, decay: 0.05, sources });
    a._noise(dest, t0, { freq: 2600 * p, q: 1.4, gain: 0.32 * v, decay: 0.03, sources });
    return a._noise(dest, t0 + 0.004, { freq: 900 * p, q: 1, gain: 0.4 * v, decay: 0.05, sources });
  }
  // wood
  a._tone(dest, t0, { f0: 125 * p, f1: 70 * p, gain: 0.75 * v, decay: run ? 0.07 : 0.09, sources });
  a._noise(dest, t0 + 0.003, { freq: 420 * p, q: 1.6, gain: 0.55 * v, decay: run ? 0.06 : 0.08, sources });
  return a._noise(dest, t0 + 0.006, { type: 'highpass', freq: 2400 * p, q: 0.7, gain: 0.08 * v, decay: 0.025, sources });
}

const RECIPES = {
  footstep: (a, dest, t0, opts, sources) => step(a, dest, t0, opts, sources),
  jump: (a, dest, t0, opts, sources) => step(a, dest, t0, opts, sources, 0.7),
  land: (a, dest, t0, opts, sources) => {
    const k = 0.6 + (opts.impact ?? 0.3) * 0.9;
    step(a, dest, t0, opts, sources, k);
    return a._tone(dest, t0, { f0: 80, f1: 45, gain: 0.6 * k, decay: 0.16, sources });
  },
  'door-open': (a, dest, t0, opts, sources) => {
    a._noise(dest, t0, { freq: 3200, q: 3, gain: 0.25, decay: 0.03, sources }); // latch
    return a._noise(dest, t0 + 0.06, { type: 'lowpass', freq: 700, q: 0.7, gain: 0.12, attack: 0.08, decay: 0.35, sources }); // air / swing
  },
  'door-close': (a, dest, t0, opts, sources) => {
    a._tone(dest, t0, { f0: 110, f1: 60, gain: 0.8, decay: 0.14, sources });
    a._noise(dest, t0, { freq: 380, q: 1.2, gain: 0.6, decay: 0.12, sources });
    return a._noise(dest, t0 + 0.02, { freq: 3000, q: 3, gain: 0.25, decay: 0.03, sources }); // latch
  },
  'door-locked': (a, dest, t0, opts, sources) => {
    for (let i = 0; i < 3; i++) a._noise(dest, t0 + i * 0.07, { freq: 2200, q: 2.5, gain: 0.35, decay: 0.035, sources });
    return a._tone(dest, t0 + 0.14, { f0: 160, f1: 120, gain: 0.3, decay: 0.06, sources });
  },
  'ui-hover': (a, dest, t0, opts, sources) => a._tone(dest, t0, { f0: 1500, f1: 1650, gain: 0.5, attack: 0.004, decay: 0.035, sources }),
  'ui-click': (a, dest, t0, opts, sources) => {
    a._tone(dest, t0, { f0: 880, f1: 900, gain: 0.6, decay: 0.05, sources });
    return a._tone(dest, t0 + 0.035, { f0: 1320, f1: 1340, gain: 0.45, decay: 0.07, sources });
  },
  place: (a, dest, t0, opts, sources) => {
    a._tone(dest, t0, { f0: 140, f1: 80, gain: 0.7, decay: 0.1, sources });
    return a._noise(dest, t0, { freq: 600, q: 1, gain: 0.4, decay: 0.08, sources });
  },
  pick: (a, dest, t0, opts, sources) => a._noise(dest, t0, { freq: 1800, q: 2, gain: 0.4, decay: 0.04, sources }),
  switch: (a, dest, t0, opts, sources) => {
    a._noise(dest, t0, { freq: 4000, q: 2, gain: 0.45, decay: 0.02, sources });
    return a._tone(dest, t0, { f0: 600, f1: 400, gain: 0.15, decay: 0.03, sources });
  },
};
