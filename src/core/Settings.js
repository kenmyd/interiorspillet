import { Emitter } from './Events.js';

const STORAGE_KEY = 'interiorspillet.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  /** Mouse look sensitivity multiplier (1 = default). */
  mouseSensitivity: 1.0,
  invertY: false,
  /** Vertical field of view in degrees. */
  fov: 72,
  /** 'low' | 'medium' | 'high' – see QUALITY. */
  quality: 'medium',
  /**
   * 'wow': cursor is free; hold right (or drag left) mouse button to look around (World of Warcraft style).
   * 'fps': mouse is captured permanently, crosshair targeting.
   */
  mouseMode: 'wow',
  /** When true (and not mouse-looking) A/D turn the character instead of strafing, like WoW. */
  turnWithKeys: false,
  /** Hold shift to run (false) or shift toggles walk/run (true). */
  runToggle: false,
  headBob: true,
  /**
   * false (default): you are a figure that glides through the furniture, without footstep sounds or head bob.
   * true: a physical person – furniture blocks you, footsteps and head bob as set.
   */
  physicalBody: false,
  masterVolume: 0.7,
  /** Footsteps, doors and UI sounds. */
  effectsVolume: 0.9,
  /** Calm background music (core/Music.js) on/off. */
  music: true,
  musicVolume: 0.5,
  showFps: false,
  /** Dynamic resolution: lower the render resolution while the frame rate is below ~50 fps (Game). */
  autoResolution: true,
  showHelpOnStart: true,
  /** Latitude for the sun (degrees north) – «Sol» → «Breddegrad». */
  sunLatitude: 58.1,
  /** 'clear' | 'overcast' – «Sol» → «Vær». */
  lightWeather: 'clear',
});

/**
 * Graphics presets. Read by the renderer setup and by home builders through ctx.quality.
 *   pixelRatio      max device pixel ratio used by the renderer
 *   antialias       MSAA on the WebGL context (needs a restart)
 *   shadows         shadow maps on/off (needs a restart)
 *   shadowMapSize   suggested shadow map size for the home's lights
 *   textureRes      suggested `res` for world/surfaces.js generators (0.5 / 1 / 1.5)
 *   drawDistance    camera far plane (m)
 */
export const QUALITY = Object.freeze({
  low: {
    level: 'low',
    pixelRatio: 1,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    textureRes: 0.5,
    drawDistance: 300,
  },
  medium: {
    level: 'medium',
    pixelRatio: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    textureRes: 1,
    drawDistance: 500,
  },
  high: {
    level: 'high',
    pixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 4096,
    textureRes: 1.5,
    drawDistance: 800,
  },
});

/**
 * Persistent user settings (localStorage, guarded – the game must work without storage).
 *
 * CONTRACT:
 *   new Settings()
 *   get(key) / set(key, value)      set() persists and emits 'change' { key, value } (only when the value changed)
 *   reset()                         back to DEFAULT_SETTINGS, 'change' for every key that changed
 *   quality                         the QUALITY preset for the current 'quality' value
 *   on('change', fn) / off(...)     (Emitter)
 * Unknown keys from older saves are kept but ignored; missing keys get their default.
 */
export class Settings extends Emitter {
  constructor() {
    super();
    this.values = { ...DEFAULT_SETTINGS, ...this._load() };
    if (!QUALITY[this.values.quality]) this.values.quality = DEFAULT_SETTINGS.quality;
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this._save();
    this.emit('change', { key, value });
  }

  reset() {
    const prev = this.values;
    this.values = { ...DEFAULT_SETTINGS };
    this._save();
    for (const key of Object.keys(this.values)) {
      if (prev[key] !== this.values[key]) this.emit('change', { key, value: this.values[key] });
    }
  }

  get quality() {
    return QUALITY[this.values.quality] ?? QUALITY.medium;
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* storage unavailable – settings live for this session only */
    }
  }
}
