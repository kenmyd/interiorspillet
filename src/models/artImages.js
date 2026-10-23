/**
 * Where model builders get uploaded pictures from (design/ImageStore.js – models/ never import design/).
 * home/index.js calls setArtImageSource(home.images) before the first item is built; models/decor.js reads it with
 * getArtImageSource() when it builds an art-frame / acoustic-art with params.motif 'custom' and params.imageId.
 * onArtImageSource(cb) tells a listener (models/artcustom.js retries pending pictures) whenever the source is set.
 *
 * ArtImageSource – the part of ImageStore the builders may use:
 *   getSync(id) → CanvasImageSource|null        decoded and ready to draw (ImageBitmap, canvas or <img>), else null
 *   request(id) → Promise<CanvasImageSource|null>  loads + decodes; never rejects; null = missing / undecodable
 *   onReady(id, cb(source)) → off()             each later time the picture becomes ready – never synchronously and
 *                                               not for a picture that is ready already (call getSync first)
 *   onMissing(id, cb()) → off()                 the picture is not in this browser (draw the «mangler» look)
 *   status(id) → 'ready'|'loaded'|'loading'|'missing'|'unknown'
 *   info(id) → { id, mime, w, h, aspect, name, … }|null
 */
let source = null;
const listeners = new Set();

/** Well-formed picture id: 'img-' + 28 lowercase hex (design/ImageStore.js hashBytes). */
export const IMAGE_ID = /^img-[0-9a-f]{28}$/;
export const isImageId = (id) => typeof id === 'string' && IMAGE_ID.test(id);

/** @param {object|null} src  an ArtImageSource (home.images), or null (no uploaded pictures: placeholders only) */
export function setArtImageSource(src) {
  source = src || null;
  for (const cb of [...listeners]) { try { cb(source); } catch (err) { console.warn('[art] image source listener failed', err); } }
}

/** cb(source) whenever setArtImageSource runs (models/artcustom.js retries pending pictures). @returns {() => void} off */
export function onArtImageSource(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** @returns {object|null} the ArtImageSource, or null */
export function getArtImageSource() {
  return source;
}
