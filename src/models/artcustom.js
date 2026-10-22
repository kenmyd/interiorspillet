import { createCanvas, canvasTexture } from '../world/proctex.js';
import { ArtCache } from './artcache.js';
import { getArtImageSource, onArtImageSource, isImageId } from './artImages.js';
import { coverRect, containRect, quantAspect, canvasSize, PAPER_WHITE } from './artlayout.js';

/**
 * Textures of uploaded pictures («egne bilder») for the art builders in models/decor.js (design/art.md §6.2 on the
 * ArtImageSource contract of models/artImages.js, MASTER §2.8; design/upload.md §9).
 *
 *   customPrintTexture(id, { aspect, res, fit, bg, focus }) → entry { key, map, edgeHex, state: 'ready'|'pending'|'missing' }
 *   useCustomTexture(entry, material)   registers a material that samples entry.map (ArtCache WeakRef)
 *   customImageStats()                  ArtCache stats { entries, px, inUse, budgetPx, maxEntries }
 *
 * - The canvas is created at its FINAL size (aspect of the print plane, `res` px on the long side) and never resized:
 *   three r186 allocates immutable texture storage, so later draws are texSubImage2D into the same texture – no
 *   reallocation, no `map.image` swap (an ImageBitmap would also ignore flipY).
 * - Until the picture is decoded the canvas shows a placeholder (#d9d4cc with a faint picture glyph #c4bdb2); a picture
 *   that is not in this browser shows the placeholder hatched (#cfc8bd). When the picture arrives it is drawn into the
 *   same canvas in place (cover = cropped to fill, focus-aware; contain = whole picture on `bg`), PNG alpha flattened
 *   on white, and map.needsUpdate is set – parked models and ghosts built while pending fix themselves.
 * - The material that samples the texture has a map from the start, so the shader program does not change when the
 *   picture arrives.
 * - Entries live in an ArtCache (budget 16 Mpx, 48 entries) that never disposes a texture a live material uses;
 *   disposing an entry unsubscribes it from the source.
 * - setArtImageSource (home/index.js, dev pages) re-attaches every entry that is not ready yet (onArtImageSource).
 */

export const CUSTOM_PLACEHOLDER_HEX = '#d9d4cc';
const GLYPH_HEX = '#c4bdb2';
const HATCH_HEX = '#cfc8bd';
/** Wrapped-canvas side colour while the picture is pending (never the placeholder's grey). */
export const CUSTOM_EDGE_HEX = '#ece9e2';
/** Long side of an uploaded picture's texture (px; the store keeps ≤ 1600 px). */
export const CUSTOM_MAX_RES = 1600;

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const CACHE = new ArtCache({
  budgetPx: 16e6,
  maxEntries: 48,
  dispose: (e) => {
    e.disposed = true;
    detach(e);
    e.map.dispose();
  },
});

/**
 * Texture of one uploaded picture fitted to a print plane of aspect `aspect` (w / h), `res` px on the long side.
 * The same id, (quantised) aspect, size, fit, background and focus share one entry.
 * @param {string} id  'img-' + 28 hex (models/artImages.js)
 * @param {{ aspect?: number, res?: number, fit?: 'cover'|'contain', bg?: string, focus?: number[]|null }} [o]
 * @returns {{ key: string, map: import('three').CanvasTexture, edgeHex: string, state: 'ready'|'pending'|'missing' }}
 */
export function customPrintTexture(id, { aspect = 1, res = 1024, fit = 'cover', bg = PAPER_WHITE, focus = null } = {}) {
  const a = quantAspect(num(aspect, 1) > 0 ? aspect : 1);
  const r = Math.round(clamp(num(res, 1024), 16, CUSTOM_MAX_RES));
  const f = fit === 'contain' ? 'contain' : 'cover';
  const back = typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg) ? bg.toLowerCase() : PAPER_WHITE;
  const hasFocus = Array.isArray(focus) && focus.length >= 2 && Number.isFinite(focus[0]) && Number.isFinite(focus[1]);
  const fx = hasFocus ? clamp(focus[0], 0, 1) : 0.5, fy = hasFocus ? clamp(focus[1], 0, 1) : 0.5;
  const key = `${id}|${a.toFixed(3)}|${r}|${f}|${back}${hasFocus && (fx !== 0.5 || fy !== 0.5) ? `|${fx.toFixed(3)},${fy.toFixed(3)}` : ''}`;
  let e = CACHE.get(key);
  if (e) {
    if (e.state !== 'ready' && e.src !== getArtImageSource()) attach(e);
    return e;
  }
  const { W, H } = canvasSize(a, r);
  const cv = createCanvas(W, H);
  e = { key, id, W, H, fit: f, bg: back, fx, fy, cv, map: canvasTexture(cv, { wrap: false }), edgeHex: CUSTOM_EDGE_HEX, state: 'pending', offs: [], src: undefined, disposed: false };
  e.map.name = `custom ${id}`;
  paintPlaceholder(e, false);
  CACHE.set(key, e, W * H);
  attach(e);
  return e;
}

/** Registers `material` as a user of `entry` (it is never disposed while the material lives). @returns material */
export function useCustomTexture(entry, material) {
  return CACHE.use(entry, material);
}

/** { entries, px, inUse, budgetPx, maxEntries } of the custom picture textures. */
export function customImageStats() {
  return CACHE.stats();
}

// a new source (home/index.js after the store exists, a dev page's stub): retry every picture that is not drawn yet
onArtImageSource(() => {
  for (const e of [...CACHE.map.values()]) if (e.state !== 'ready' && !e.disposed) attach(e);
});

function detach(e) {
  for (const off of e.offs.splice(0)) {
    try {
      off();
    } catch {
      /* ignore */
    }
  }
}

/** Subscribes the entry to the current source: draws now when the picture is decoded, else waits (or shows «missing»). */
function attach(e) {
  detach(e);
  const src = getArtImageSource();
  e.src = src;
  if (!isImageId(e.id)) {
    paintPlaceholder(e, true);
    return;
  }
  if (!src) return; // no store (a dev page before wiring): the placeholder stays until setArtImageSource
  if (tryDraw(e, null)) return;
  const sub = (fn, cb) => {
    try {
      const off = typeof fn === 'function' ? fn.call(src, e.id, cb) : null;
      if (typeof off === 'function') e.offs.push(off);
    } catch (err) {
      console.warn('[art] image source subscription failed', err);
    }
  };
  sub(src.onReady, (img) => {
    if (!e.disposed && e.src === src && e.state !== 'ready') tryDraw(e, img || null);
  });
  sub(src.onMissing, () => {
    if (!e.disposed && e.src === src && e.state !== 'ready') paintPlaceholder(e, true);
  });
  let status = null;
  try {
    status = typeof src.status === 'function' ? src.status(e.id) : null;
  } catch {
    status = null;
  }
  if (status === 'missing') paintPlaceholder(e, true);
  if (typeof src.request === 'function') {
    let p;
    try {
      p = src.request(e.id);
    } catch {
      p = null;
    }
    Promise.resolve(p)
      .then((img) => {
        if (e.disposed || e.src !== src || e.state === 'ready') return;
        if (img) tryDraw(e, img);
        else paintPlaceholder(e, true); // request() resolves null: missing or undecodable in this browser
      })
      .catch(() => {});
  }
}

/** Intrinsic pixel size of a CanvasImageSource (drawImage source coordinates), else the store's info. */
function sizeOf(img, src, id) {
  let w = num(img?.naturalWidth, 0) || num(img?.videoWidth, 0) || num(img?.displayWidth, 0) || num(img?.width, 0);
  let h = num(img?.naturalHeight, 0) || num(img?.videoHeight, 0) || num(img?.displayHeight, 0) || num(img?.height, 0);
  if (!(w > 0 && h > 0)) {
    let info = null;
    try {
      info = src?.info?.(id) ?? null;
    } catch {
      info = null;
    }
    w = num(info?.w, 0);
    h = num(info?.h, 0);
  }
  return { w, h };
}

/** Draws the decoded picture (or src.getSync) into the entry's canvas. @returns true when drawn */
function tryDraw(e, img) {
  const src = e.src;
  let pic = img;
  if (!pic && src && typeof src.getSync === 'function') {
    try {
      pic = src.getSync(e.id);
    } catch {
      pic = null;
    }
  }
  if (!pic) return false;
  const { w: iw, h: ih } = sizeOf(pic, src, e.id);
  if (!(iw > 0 && ih > 0)) return false;
  const { W, H } = e;
  const c = e.cv.getContext('2d');
  c.save();
  try {
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#ffffff'; // flattens PNG alpha
    c.fillRect(0, 0, W, H);
    if (e.fit === 'contain') {
      c.fillStyle = e.bg;
      c.fillRect(0, 0, W, H);
      const r = containRect(iw, ih, W, H);
      c.drawImage(pic, 0, 0, iw, ih, r.dx, r.dy, r.dw, r.dh);
    } else {
      const r = coverRect(iw, ih, W, H, e.fx, e.fy);
      c.drawImage(pic, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
    }
  } catch (err) {
    console.warn('[art] could not draw the picture', e.id, err);
    c.restore();
    return false;
  }
  c.restore();
  e.state = 'ready';
  e.edgeHex = borderColor(e.cv);
  e.map.needsUpdate = true;
  detach(e); // ids are content addressed: a drawn picture never changes
  return true;
}

/** The placeholder (pending) or the hatched placeholder (missing): no text, a faint picture glyph in the middle. */
function paintPlaceholder(e, missing) {
  if (e.state === 'ready') return;
  const { W, H } = e;
  const s = Math.min(W, H);
  const c = e.cv.getContext('2d');
  c.save();
  c.fillStyle = CUSTOM_PLACEHOLDER_HEX;
  c.fillRect(0, 0, W, H);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (missing) {
    c.strokeStyle = HATCH_HEX;
    c.lineWidth = Math.max(1, s * 0.012);
    const step = Math.max(4, s * 0.05);
    c.beginPath();
    for (let k = -H; k < W + H; k += step) {
      c.moveTo(k, 0);
      c.lineTo(k + H, H);
    }
    c.stroke();
  }
  const g = s * 0.3, x0 = (W - g) / 2, y0 = (H - g) / 2;
  c.strokeStyle = GLYPH_HEX;
  c.lineWidth = Math.max(1, s * 0.012);
  const r = g * 0.08;
  c.beginPath();
  c.moveTo(x0 + r, y0);
  c.arcTo(x0 + g, y0, x0 + g, y0 + g, r);
  c.arcTo(x0 + g, y0 + g, x0, y0 + g, r);
  c.arcTo(x0, y0 + g, x0, y0, r);
  c.arcTo(x0, y0, x0 + g, y0, r);
  c.closePath();
  c.stroke();
  c.beginPath(); // mountains
  c.moveTo(x0 + g * 0.12, y0 + g * 0.82);
  c.lineTo(x0 + g * 0.4, y0 + g * 0.48);
  c.lineTo(x0 + g * 0.6, y0 + g * 0.68);
  c.lineTo(x0 + g * 0.72, y0 + g * 0.56);
  c.lineTo(x0 + g * 0.88, y0 + g * 0.82);
  c.stroke();
  c.beginPath(); // sun
  c.arc(x0 + g * 0.7, y0 + g * 0.3, g * 0.08, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  e.state = missing ? 'missing' : 'pending';
  e.map.needsUpdate = true;
}

/** Mean colour of the outer ring of a 32 × 32 copy (as decor.js borderColor; the wrapped-canvas side of a picture). */
function borderColor(cv) {
  const n = 32;
  const s = createCanvas(n, n);
  const sc = s.getContext('2d', { willReadFrequently: true });
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(cv, 0, 0, n, n);
  const d = sc.getImageData(0, 0, n, n).data;
  let r = 0, g = 0, b = 0, k = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (x > 0 && x < n - 1 && y > 0 && y < n - 1) continue;
      const i = (y * n + x) * 4;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      k++;
    }
  }
  const hx = (v) => Math.round(v / k).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
