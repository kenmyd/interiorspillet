import { GRAPHIC } from './art/graphic.js';
import { PAINTED } from './art/painted.js';

/**
 * Registry of the procedural art motifs (design/art.md §2). Painters live in models/art/graphic.js (posters, graphic,
 * line art, kids, maps) and models/art/painted.js (paintings, photo prints, botanical); models/decor.js paints them
 * into the art-frame / art-set / acoustic-art textures. The six legacy motifs (misty-trees, abstract, landscape,
 * botanical, line-art, photo) stay in decor.js and never change.
 *
 * MotifDef = {
 *   label:     Norwegian label (Inspector «Motiv»)
 *   group:     key of MOTIF_GROUPS
 *   palette:   five '#rrggbb' – [0] paper/background, [1] main (= colors.print), [2] secondary, [3] dark/ink, [4] accent
 *   cost:      'S' ≤ 4 ms | 'M' ≤ 10 ms | 'L' ≤ 16 ms painting 1024 × 1024 (tools/artcheck.mjs measures)
 *   variants?: [[key, label], …] – params.motifOpts.variant; without one the painter picks with R
 *   opts?:     extra motifOpts keys it reads ('text', 'subtext')
 *   relief?:   true when paint() draws heights on o.hc (texture 'relief')
 *   paint(c, W, H, R, p, o)
 * }
 *
 * Painter contract:
 *  - pixel space W × H, origin top-left, y down (canvasTexture flips: the canvas top is the picture top)
 *  - fill the whole canvas opaquely first; never read c.canvas, never getImageData, never setTransform/resetTransform
 *    (art-set atlases paint every print into a translated, clipped cell of one canvas)
 *  - randomness only from R (K.rng('motif:<key>:<seed>')); draw every random value BEFORE branching on o.hc or p.mono,
 *    so colour and relief builds (and every palette) share the composition; never Math.random
 *  - lengths relative to S = min(W, H) (or W, H) – the same look at 256…2048 px and aspects 0.2…5; keep the subject in
 *    the central S × S
 *  - ≤ 2 blurOnto composites, no c.filter per stroke, no per-pixel loops over the full canvas
 *  - o = { hc: CanvasRenderingContext2D|null, variant?: string, text?: string, subtext?: string }
 */
export const MOTIF_GROUPS = Object.freeze([
  ['grafisk', 'Grafisk og plakat'], ['maleri', 'Maleri'], ['foto', 'Foto'], ['botanisk', 'Botanisk'],
  ['strek', 'Strektegning'], ['barn', 'Barn og dyr'], ['kart', 'Kart'],
]);

/** Motif keys painted by decor.js itself (their pictures must never change; the TV uses 'photo'). */
export const LEGACY_MOTIFS = Object.freeze(['misty-trees', 'abstract', 'landscape', 'botanical', 'line-art', 'photo']);

export const ART_MOTIFS = Object.freeze({ ...GRAPHIC, ...PAINTED });

/** [key, label] of the new motifs, grouped. */
export const ART_MOTIF_OPTIONS = Object.freeze(
  MOTIF_GROUPS.flatMap(([g]) => Object.entries(ART_MOTIFS).filter(([, m]) => m.group === g).map(([k, m]) => [k, m.label])),
);

const TEXT_MAX = { text: 24, subtext: 40 };

/** motifOpts reduced to what the motif reads: a variant from its list, short trimmed strings. */
export function cleanMotifOpts(key, o) {
  const m = ART_MOTIFS[key];
  const out = {};
  if (!m || !o || typeof o !== 'object') return out;
  if (typeof o.variant === 'string' && m.variants?.some(([k]) => k === o.variant)) out.variant = o.variant;
  for (const k of m.opts || []) if (typeof o[k] === 'string' && o[k].trim()) out[k] = o[k].trim().slice(0, TEXT_MAX[k] ?? 24);
  return out;
}

/** Stable cache-key fragment of the cleaned opts ('' when there are none). */
export function motifOptsKey(key, o) {
  const c = cleanMotifOpts(key, o);
  return Object.keys(c).sort().map((k) => `${k}=${c[k]}`).join(';');
}

/**
 * Paints motif `key` into c (W × H) with its state isolated. Returns false for an unknown key (the caller falls back).
 * @param {CanvasRenderingContext2D} c
 */
export function paintArt(c, W, H, key, R, p, { hc = null, opts = null } = {}) {
  const m = ART_MOTIFS[key];
  if (!m) return false;
  const o = { hc: m.relief ? hc : null, ...cleanMotifOpts(key, opts) };
  c.save();
  if (o.hc) o.hc.save();
  try {
    m.paint(c, W, H, R, p, o);
  } finally {
    c.restore();
    if (o.hc) o.hc.restore();
  }
  return true;
}
