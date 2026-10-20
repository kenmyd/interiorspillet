/**
 * Calm generative background music, synthesised with WebAudio (no files, no vocals): a slow chord loop in F major
 * played by a soft pad and a low bass, and a sparse piano-like melody on the F major pentatonic, all through one
 * generated reverb. Every pass through the loop picks new melody notes, so it never repeats exactly.
 *
 * CONTRACT (owned by AudioSystem – see core/Audio.js; settings 'music' / 'musicVolume' are applied there):
 *   new AmbientMusic(ctx, destination)
 *   start()          fades in over ~4 s and starts the scheduler (no-op while playing)
 *   stop()           fades out over ~2 s; the notes already scheduled are cut off with their bus, the reverb rings out
 *   playing: boolean
 *   dispose()
 * The scheduler looks LOOK_AHEAD seconds ahead on ctx.currentTime, so a suspended context (hidden page) simply
 * pauses the music, and a busy main thread (loading the room) does not leave gaps.
 *
 * Signal graph per run:  voices → run.dry ──────────────────────────────→ destination
 *                               → run.send → pre-delay → convolver → wet ─┘
 */

const BEAT = 0.8; // s (75 bpm)
const CHORD_BEATS = 12; // 9.6 s per chord, the loop is ~77 s
const LOOK_AHEAD = 6; // s
const TICK_MS = 250;

/** Mix levels (linear). Tune here. */
const LEVEL = { pad: 0.032, bass: 0.1, melody: 0.13, wet: 0.6 };

/** The chord loop: bass note and pad voicing (MIDI). Fmaj9 Am7 Dm9 B♭maj9 | Fadd9 Gm7 B♭maj9 Csus2 */
const CHORDS = [
  { bass: 41, pad: [53, 57, 60, 64] },
  { bass: 45, pad: [52, 55, 57, 60] },
  { bass: 38, pad: [53, 57, 60, 64] },
  { bass: 46, pad: [53, 57, 60, 62] },
  { bass: 41, pad: [55, 57, 60, 64] },
  { bass: 43, pad: [50, 53, 58, 62] },
  { bass: 46, pad: [53, 57, 60, 62] },
  { bass: 36, pad: [55, 60, 62, 67] },
].map((c) => ({ ...c, tones: new Set([c.bass, ...c.pad].map((m) => m % 12)) }));

/** F major pentatonic, F4 … C6 – fits every chord above. */
const SCALE = [65, 67, 69, 72, 74, 77, 79, 81, 84];

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class AmbientMusic {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.playing = false;
    this._run = null;
    this._timer = null;
    this._idx = 2; // melody position in SCALE

    // one reverb for every run: the tail of a stopped run rings out naturally
    this.reverbIn = ctx.createDelay(0.1);
    this.reverbIn.delayTime.value = 0.03;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 4.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = LEVEL.wet;
    this.reverbIn.connect(conv).connect(wet).connect(destination);
    this._reverbNodes = [this.reverbIn, conv, wet];
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dry = ctx.createGain();
    const send = ctx.createGain();
    for (const g of [dry, send]) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 4);
    }
    dry.connect(this.dest);
    send.connect(this.reverbIn);
    this._run = { dry, send };
    this._t = t + 0.1;
    this._chord = 0;
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
    const run = this._run;
    this._run = null;
    const t = this.ctx.currentTime;
    for (const g of [run.dry, run.send]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 2);
    }
    // the scheduled notes end on their own; cutting the run's bus silences the ones not played yet
    setTimeout(() => {
      run.dry.disconnect();
      run.send.disconnect();
    }, 2600);
  }

  dispose() {
    this.stop();
    for (const n of this._reverbNodes) n.disconnect();
  }

  /* ------------------------------------------------------------------ scheduling */

  _tick() {
    const ctx = this.ctx;
    if (!this._run || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // fell far behind (the page was frozen without suspending the context): skip ahead instead of catching up
    if (this._t < now - 0.5) this._t = now + 0.1;
    while (this._t < now + LOOK_AHEAD) {
      const chord = CHORDS[this._chord % CHORDS.length];
      const dur = CHORD_BEATS * BEAT;
      this._pad(chord, this._t, dur);
      this._bass(chord, this._t, dur);
      this._melody(chord, this._t, dur);
      this._t += dur;
      this._chord++;
    }
  }

  /** Sends a voice's output to the current run: dry plus a reverb send. */
  _connect(node, send) {
    node.connect(this._run.dry);
    const s = this.ctx.createGain();
    s.gain.value = send;
    node.connect(s).connect(this._run.send);
  }

  /** Soft pad: two detuned triangles per note under a slowly opening low-pass, crossfading into the next chord. */
  _pad(chord, t0, dur) {
    const ctx = this.ctx;
    const attack = 3;
    const release = 4;
    const end = t0 + dur + release;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(LEVEL.pad, t0 + attack);
    env.gain.setValueAtTime(LEVEL.pad, t0 + dur);
    env.gain.linearRampToValueAtTime(0, end);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(650, t0);
    lp.frequency.linearRampToValueAtTime(rand(1000, 1300), t0 + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(700, end);
    lp.connect(env);
    this._connect(env, 0.9);
    for (const m of chord.pad) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midiHz(m);
        o.detune.value = detune + rand(-2, 2);
        o.connect(lp);
        o.start(t0);
        o.stop(end + 0.05);
      }
    }
  }

  /** Low sine on the chord root, with a quiet octave so small speakers hear it too. */
  _bass(chord, t0, dur) {
    const ctx = this.ctx;
    const end = t0 + dur + 2.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(LEVEL.bass, t0 + 2);
    env.gain.setValueAtTime(LEVEL.bass, t0 + dur - 0.5);
    env.gain.linearRampToValueAtTime(0, end);
    this._connect(env, 0.2);
    for (const [k, gain] of [[1, 1], [2, 0.25]]) {
      const o = ctx.createOscillator();
      o.frequency.value = midiHz(chord.bass) * k;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(env);
      o.start(t0);
      o.stop(end + 0.05);
    }
  }

  /** A sparse random walk on the pentatonic scale, leaning on chord tones; some chords are pad only. */
  _melody(chord, t0, dur) {
    if (Math.random() < 0.2) return;
    let t = t0 + BEAT * pick([1, 2, 3]);
    const end = t0 + dur - BEAT;
    let first = true;
    while (t < end) {
      if (!first && Math.random() < 0.22) {
        t += BEAT * pick([1, 2]);
        continue;
      }
      this._idx = Math.max(0, Math.min(SCALE.length - 1, this._idx + pick([-2, -1, -1, 0, 1, 1, 2])));
      if (!chord.tones.has(SCALE[this._idx] % 12) && (first || Math.random() < 0.6)) {
        const near = [this._idx - 1, this._idx + 1].filter((i) => i >= 0 && i < SCALE.length && chord.tones.has(SCALE[i] % 12));
        if (near.length) this._idx = pick(near);
      }
      const vel = rand(0.55, 1);
      this._note(SCALE[this._idx], t, vel);
      // now and then a quiet harmony note a step or two below
      if (Math.random() < 0.12 && this._idx >= 2) this._note(SCALE[this._idx - 2], t + 0.02, vel * 0.45);
      first = false;
      t += BEAT * pick([1.5, 2, 2, 3, 4]);
    }
  }

  /** Piano-like note: three sine partials, the higher ones dying faster, softened and slightly panned. */
  _note(m, t, vel) {
    const ctx = this.ctx;
    const f = midiHz(m);
    const length = 3.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    let tail = lp;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.35, 0.35);
      lp.connect(pan);
      tail = pan;
    }
    this._connect(tail, 1.1);
    for (const [k, gain] of [[1, 1], [2, 0.22], [3, 0.06]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * k;
      const g = ctx.createGain();
      const peak = Math.max(0.0002, LEVEL.melody * vel * gain);
      const decay = length / k ** 0.8;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }
}

/** Stereo reverb impulse: darkened noise with a smooth decay (each channel its own noise for width). */
function makeImpulse(ctx, seconds, curve) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.3;
      d[i] = lp * (1 - i / len) ** curve;
    }
  }
  return buf;
}
