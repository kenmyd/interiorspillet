import { Emitter } from '../core/Events.js';
import { IMAGE_ID, isImageId } from '../models/artImages.js';

export { IMAGE_ID, isImageId };

/**
 * Uploaded pictures («egne bilder», design/upload.md §5): content-addressed records in IndexedDB (idbBackend), cached
 * in memory, decoded on demand for the model builders. The store IS the ArtImageSource of models/artImages.js
 * (getSync, request, onReady, onMissing, status, info) – home/index.js hands it to setArtImageSource.
 *
 * A design never holds pixels: items reference a picture by params.imageId ('img-' + 28 hex, hashBytes of the stored
 * bytes) plus params.imageAspect. localStorage, autosave and the undo history only see ids; the bytes live here and
 * travel inside exported design files (Saves.exportText, `images` block).
 *
 * No IndexedDB / window / document access at module top level: Saves.js (main.js, Node tests) imports this file.
 * Never throws on storage problems: without IndexedDB (private window, blocked storage, Node) pictures are kept in
 * memory for the session (persistent = false).
 *
 *   exports: IMAGE_ID, isImageId, IMAGE_DB, IMAGE_STORE, MIMES, size limits, MSG, ImageError,
 *            hashBytes, sniffKind, sniffMime, imageSize, bytesToDataUrl, dataUrlToBytes, cleanName, imageRefs,
 *            itemImageId, memBackend, idbBackend, ImageStore, getImageStore
 *
 * ImageRecord (IndexedDB 'interiorspillet-images' v1, store 'images', keyPath 'id'):
 *   { id, mime, data: ArrayBuffer, w, h, bytes, name, origW, origH, createdAt, lastUsedAt }
 * ImageBackend (all async): { get(id), put(rec), delete(id), keys(), all(), persistent, name }
 */

export const IMAGE_DB = 'interiorspillet-images';
export const IMAGE_STORE = 'images';
export const MIMES = Object.freeze(['image/webp', 'image/jpeg', 'image/png']);
/** Long edge of the stored picture (px). */
export const MAX_SIDE = 1600;
/** A chosen file. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
/** Original pixels (header check before decoding). */
export const MAX_PIXELS = 80e6;
/** A smaller side is refused. */
export const MIN_SIDE = 32;
/** A smaller long edge gives a warning. */
export const LOW_RES_SIDE = 600;
/** Re-encode at a lower quality above this. */
export const MAX_STORED_BYTES = 4 * 1024 * 1024;
/** One picture in an imported file. */
export const MAX_IMPORT_IMAGE_BYTES = 8 * 1024 * 1024;
/** Pixels (one side) of one picture in an imported file. */
export const MAX_IMPORT_SIDE = 4096;
export const MAX_IMPORT_IMAGES = 200;
/** Unreferenced pictures are kept this long after their last use. */
export const GRACE_DAYS = 14;
/** Decoded pictures kept in memory (pixel sum, ≈ 12 × 1600 × 1200). */
export const DECODE_BUDGET_PX = 24e6;

const DAY = 86400000;

/** '52' / '4,5' (one decimal under 10, Norwegian comma). */
const mb = (n) => {
  const v = n / (1024 * 1024);
  return v < 10 ? (Math.round(v * 10) / 10).toString().replace('.', ',') : String(Math.round(v));
};
/** Megapixels: '110'. */
const mp = ({ w, h }) => String(Math.round((w * h) / 1e6));

/** Norwegian messages (thrown / returned by the store; the UI shows err.message as is). */
export const MSG = {
  empty: 'Filen er tom.',
  type: 'Denne filtypen støttes ikke. Velg et bilde i JPG-, PNG- eller WebP-format.',
  heic: 'Bilder i HEIC-format (vanlig fra iPhone) kan ikke leses her. Lagre eller del bildet som JPG, og prøv igjen.',
  size: (n) => `Bildefilen er for stor (${n} MB). Velg en fil under 40 MB.`,
  pixels: (n) => `Bildet har for mange piksler (${n} megapiksler). Lagre en mindre kopi (under 80 megapiksler) og prøv igjen.`,
  small: (w, h) => `Bildet er for lite (${w} × ${h} piksler).`,
  decode: 'Klarte ikke å lese bildet – filen kan være skadet.',
  lowRes: (w, h) => `Bildet er lite (${w} × ${h} piksler) og kan se uskarpt ut på veggen.`,
  quota: 'Klarte ikke å lagre bildet – lagringsplassen i nettleseren er full. Bildet vises til du lukker fanen; eksporter designet til fil for å ta vare på det.',
  memory: 'Nettleseren lar ikke spillet lagre bilder (privat vindu?). Bildet vises til du lukker fanen – eksporter designet til fil for å ta vare på det.',
  stored: 'Et lagret bilde kunne ikke leses og vises som en tom ramme.',
  importUnsaved: 'Bildene i filen kunne ikke lagres i nettleseren (lagringsplassen er full). De vises til du lukker fanen.',
  importMemory: 'Nettleseren lar ikke spillet lagre bildene i filen (privat vindu?). De vises til du lukker fanen – eksporter designet til fil for å ta vare på dem.',
};

/** A refused upload: code ('empty' | 'size' | 'heic' | 'type' | 'pixels' | 'small' | 'decode'), Norwegian message. */
export class ImageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure helpers (Node-safe)

function cyrb64(u8, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * The id of stored bytes: 'img-' + 28 lowercase hex (two 64-bit cyrb lanes; deterministic in Node and every browser,
 * no crypto.subtle – works on plain-http LAN too).
 * @param {Uint8Array} u8
 */
export function hashBytes(u8) {
  return `img-${cyrb64(u8, 0x2c1b3c6d)}${cyrb64(u8, 0x297a2d39).slice(0, 12)}`;
}

const asU8 = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b instanceof ArrayBuffer ? new Uint8Array(b) : null);
const ascii = (u8, at, n) => {
  let s = '';
  for (let i = 0; i < n && at + i < u8.length; i++) s += String.fromCharCode(u8[at + i]);
  return s;
};
const u16be = (u8, i) => (u8[i] << 8) | u8[i + 1];
const u32be = (u8, i) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];

/**
 * File kind from the first bytes.
 * @returns {'jpeg'|'png'|'webp'|'gif'|'heic'|'avif'|'bmp'|'tiff'|'svg'|null}
 */
export function sniffKind(bytes) {
  const u8 = asU8(bytes);
  if (!u8 || u8.length < 2) return null;
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpeg';
  if (u8.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => u8[i] === b)) return 'png';
  if (ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 4) === 'WEBP') return 'webp';
  if (ascii(u8, 0, 4) === 'GIF8') return 'gif';
  if (ascii(u8, 4, 4) === 'ftyp') {
    const brand = ascii(u8, 8, 4);
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return 'heic';
    if (/^(avif|avis)$/.test(brand)) return 'avif';
  }
  if (u8[0] === 0x42 && u8[1] === 0x4d) return 'bmp';
  if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2a && u8[3] === 0) || (u8[0] === 0x4d && u8[1] === 0x4d && u8[2] === 0 && u8[3] === 0x2a)) return 'tiff';
  const head = ascii(u8, 0, 256).replace(/^[\s﻿]+/, '');
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return null;
}

/** 'image/jpeg' | 'image/png' | 'image/webp' (the kinds the store keeps), else null. */
export function sniffMime(bytes) {
  const k = sniffKind(bytes);
  return k === 'jpeg' ? 'image/jpeg' : k === 'png' ? 'image/png' : k === 'webp' ? 'image/webp' : null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Pixel size from the file header (no decoder; before EXIF orientation).
 * @returns {{ w: number, h: number }|null}
 */
export function imageSize(bytes, mime = sniffMime(bytes)) {
  const u8 = asU8(bytes);
  if (!u8) return null;
  const ok = (w, h) => (w > 0 && h > 0 ? { w, h } : null);
  if (mime === 'image/png') {
    if (u8.length < 24 || ascii(u8, 12, 4) !== 'IHDR') return null;
    return ok(u32be(u8, 16), u32be(u8, 20));
  }
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 8 < u8.length) {
      if (u8[i] !== 0xff) return null;
      const m = u8[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (SOF.has(m)) return ok(u16be(u8, i + 7), u16be(u8, i + 5));
      if (m === 0xd9 || m === 0xda) return null;
      const len = u16be(u8, i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (mime === 'image/webp') {
    if (u8.length < 30) return null;
    const chunk = ascii(u8, 12, 4);
    if (chunk === 'VP8 ') return ok((u8[26] | (u8[27] << 8)) & 0x3fff, (u8[28] | (u8[29] << 8)) & 0x3fff);
    if (chunk === 'VP8L') {
      if (u8[20] !== 0x2f) return null;
      const w = 1 + (u8[21] | ((u8[22] & 0x3f) << 8));
      const h = 1 + ((u8[22] >> 6) | (u8[23] << 2) | ((u8[24] & 0x0f) << 10));
      return ok(w, h);
    }
    if (chunk === 'VP8X') return ok(1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)), 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16)));
    return null;
  }
  return null;
}

/** 'data:<mime>;base64,…' of bytes (chunked btoa). */
export function bytesToDataUrl(bytes, mime) {
  const u8 = asU8(bytes) || new Uint8Array(0);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Bytes of a base64 data URL.
 * @returns {{ mime: string, bytes: Uint8Array }|null}  null when malformed
 */
export function dataUrlToBytes(str) {
  if (typeof str !== 'string' || !str.startsWith('data:')) return null;
  const comma = str.indexOf(',');
  if (comma < 0) return null;
  const head = str.slice(5, comma);
  const parts = head.split(';');
  if (!parts.includes('base64')) return null;
  const mime = (parts[0] || '').trim().toLowerCase();
  if (!mime) return null;
  try {
    const bin = atob(str.slice(comma + 1).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** A file name to show: the base name, no control characters, collapsed spaces, at most 80 characters. */
export function cleanName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Picture ids a design uses: params.imageId of every item (any source – catalogue acoustic panels with «eget motiv»
 * have one too) and, for later gallery sets, params.frames[].imageId. src: a design JSON ({ items: [] | { uid: item } }),
 * an item array, or null. Only well-formed ids; insertion order.
 * @returns {Set<string>}
 */
export function imageRefs(src) {
  const out = new Set();
  const items = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items
    : src?.items && typeof src.items === 'object' ? Object.values(src.items) : [];
  for (const it of items) {
    const p = it?.params;
    if (isImageId(p?.imageId)) out.add(p.imageId);
    if (Array.isArray(p?.frames)) for (const f of p.frames) if (isImageId(f?.imageId)) out.add(f.imageId);
  }
  return out;
}

/** params.imageId of an item when well-formed, else null. */
export const itemImageId = (item) => (isImageId(item?.params?.imageId) ? item.params.imageId : null);

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : v);

/**
 * In-memory backend over a Map (tests: two stores on one Map = a page reload in the same browser; the app: the
 * fallback without IndexedDB). put stores a structured clone.
 * @param {Map<string, object>} [map]
 * @param {{ persistent?: boolean }} [o]
 */
export function memBackend(map = new Map(), { persistent = false } = {}) {
  return {
    name: 'memory',
    persistent,
    get: async (id) => (map.has(id) ? clone(map.get(id)) : undefined),
    put: async (rec) => {
      map.set(rec.id, clone(rec));
    },
    delete: async (id) => {
      map.delete(id);
    },
    keys: async () => [...map.keys()],
    all: async () => [...map.values()].map((r) => clone(r)),
  };
}

/**
 * IndexedDB backend (the robust pattern of home/materials.js): resolves null when IndexedDB is missing, blocked or
 * does not answer within `timeout` (some browsers never answer open() in private mode). Writes resolve on transaction
 * COMPLETE (durable) and reject with the transaction's error (QuotaExceededError …).
 * @returns {Promise<object|null>}
 */
export function idbBackend({ name = IMAGE_DB, store = IMAGE_STORE, timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (db) => {
      if (done) {
        db?.close?.();
        return;
      }
      done = true;
      resolve(db ? wrap(db) : null);
    };
    setTimeout(() => finish(null), timeout);
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        finish(null);
        return;
      }
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(store, { keyPath: 'id' });
        } catch {
          /* exists */
        }
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  function wrap(db) {
    db.onversionchange = () => db.close();
    const tx = (mode, fn) => new Promise((res, rej) => {
      let out;
      let t;
      try {
        t = db.transaction(store, mode);
      } catch (err) {
        rej(err);
        return;
      }
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('IndexedDB transaction aborted'));
      const r = fn(t.objectStore(store));
      if (r) {
        r.onsuccess = () => {
          out = r.result;
        };
      }
    });
    return {
      name: 'indexeddb',
      persistent: true,
      get: (id) => tx('readonly', (s) => s.get(id)),
      put: (rec) => tx('readwrite', (s) => s.put(rec)).then(() => {}),
      delete: (id) => tx('readwrite', (s) => s.delete(id)).then(() => {}),
      keys: () => tx('readonly', (s) => s.getAllKeys()).then((k) => k || []),
      all: () => tx('readonly', (s) => s.getAll()).then((a) => a || []),
    };
  }
}

/** A stored record that can be used (its bytes as an ArrayBuffer), or null. */
function usableRecord(rec, id = rec?.id) {
  if (!rec || typeof rec !== 'object' || rec.id !== id || !MIMES.includes(rec.mime)) return null;
  let data = rec.data;
  if (ArrayBuffer.isView(data)) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (!(data instanceof ArrayBuffer) || !data.byteLength) return null;
  return { ...rec, data };
}

/** The record as it is written to the backend (no in-memory flags). */
function plain(rec) {
  const { _unsaved, ...out } = rec;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Browser-only helpers (called inside functions only)

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const toBlob = (c, type, q) => new Promise((res) => {
  try {
    c.toBlob((b) => res(b || null), type, q);
  } catch {
    res(null);
  }
});

/** Decodes a picture file with its EXIF orientation applied (ImageBitmap, else an <img>). */
async function decodeOriented(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* option unknown or undecodable → <img> */
    }
  }
  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') throw new ImageError('decode', MSG.decode);
  // <img> applies EXIF orientation by default (CSS image-orientation: from-image), and so does drawImage of it
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageError('decode', MSG.decode);
  }
  img._url = url;
  return img;
}

/** Stepwise halving (≈ box filter), then one high-quality draw, flattened on white (prints have no transparency). */
function downscale(src, maxSide) {
  const W = src.width;
  const H = src.height;
  const s = Math.min(1, maxSide / Math.max(W, H));
  const tw = Math.max(1, Math.round(W * s));
  const th = Math.max(1, Math.round(H * s));
  let cur = src;
  let cw = W;
  let ch = H;
  while (cw > tw * 2 && ch > th * 2) {
    const nw = Math.round(cw / 2);
    const nh = Math.round(ch / 2);
    const c = makeCanvas(nw, nh);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, nw, nh);
    cur = c;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(tw, th);
  const o = out.getContext('2d');
  o.fillStyle = '#ffffff';
  o.fillRect(0, 0, tw, th);
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.drawImage(cur, 0, 0, tw, th);
  return { canvas: out, w: tw, h: th };
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Uploaded pictures: content-addressed records in IndexedDB (idbBackend), cached in memory, decoded on demand for the
 * model builders (models/artImages.js ArtImageSource). Never throws on storage problems: without IndexedDB it keeps
 * pictures in memory for the session (persistent = false).
 *
 * Events: 'added' { id } · 'ready' { id } · 'missing' { id } · 'deleted' { ids } ·
 *         'error' { code, message, id? }   (background failures only: import writes, a stored picture that cannot
 *                                           be decoded – addFile/putBytes report through their result)
 *
 *   new ImageStore({ backend: 'auto'|'memory'|ImageBackend|Promise<ImageBackend|null>, readOnly, now, decodeBudgetPx })
 *   readOnly (settable: no backend writes, gc() is a no-op), ready() → { persistent }, persistent, pending
 *   has(id), status(id), info(id), bytesOf(id), getSync(id), request(id), onReady(id, cb), onMissing(id, cb),
 *   releaseDecoded(), objectUrl(id), addFile(file, { name }), putBytes(u8, meta), load(ids, { decode }), list({ limit }),
 *   exportSync(ids), export(ids), import(map), flush(), gc(roots, graceDays, { now }), dispose()
 */
export class ImageStore extends Emitter {
  constructor({ backend = 'auto', readOnly = false, now = () => Date.now(), decodeBudgetPx = DECODE_BUDGET_PX } = {}) {
    super();
    this.readOnly = !!readOnly;
    this._now = now;
    this._budget = decodeBudgetPx;
    this._beSpec = backend;
    this._be = null;
    this._persistent = false;
    this._recs = new Map();
    this._status = new Map();
    this._decoded = new Map();
    this._decoding = new Map();
    this._ready = new Map();
    this._missing = new Map();
    this._writes = new Set();
    this._failed = new Set();
    this._urls = new Map();
  }

  /** The backend (resolved once): IndexedDB, else memory. */
  _backend() {
    if (!this._be) {
      const spec = this._beSpec;
      let p;
      if (spec === 'memory') p = Promise.resolve(memBackend());
      else if (spec === 'auto' || spec == null) p = idbBackend().catch(() => null);
      else if (typeof spec?.then === 'function') p = spec.catch(() => null);
      else p = Promise.resolve(spec);
      this._be = p.then((be) => {
        const b = be && typeof be.get === 'function' ? be : memBackend();
        this._persistent = !!b.persistent;
        return b;
      });
    }
    return this._be;
  }

  /** Resolves the backend (idempotent). @returns {Promise<{ persistent: boolean }>} */
  async ready() {
    await this._backend();
    return { persistent: this._persistent };
  }

  /** True once the backend is IndexedDB (or a test backend with persistent: true). */
  get persistent() {
    return this._persistent;
  }

  /** Number of queued backend writes. */
  get pending() {
    return this._writes.size;
  }

  // ---- reading (ArtImageSource) ---------------------------------------------------------------------------------

  /** Bytes in memory. */
  has(id) {
    return this._recs.has(id);
  }

  /** 'ready' (decoded) | 'loaded' (bytes only) | 'loading' | 'missing' | 'unknown'. */
  status(id) {
    if (this._decoded.has(id)) return 'ready';
    if (this._recs.has(id)) return 'loaded';
    return this._status.get(id) || 'unknown';
  }

  /** { id, mime, w, h, aspect, name, bytes, origW, origH, createdAt, lastUsedAt, persisted } or null. */
  info(id) {
    const r = this._recs.get(id);
    if (!r) return null;
    return {
      id: r.id, mime: r.mime, w: r.w, h: r.h, aspect: r.w / r.h, name: r.name || '', bytes: r.bytes ?? r.data.byteLength,
      origW: r.origW ?? r.w, origH: r.origH ?? r.h, createdAt: r.createdAt ?? null, lastUsedAt: r.lastUsedAt ?? null,
      // written to a backend that survives the tab (IndexedDB); false without one, in readOnly and after a failed write
      persisted: !r._unsaved && this._persistent,
    };
  }

  /** A view of the stored bytes (tests, export), or null. */
  bytesOf(id) {
    const r = this._recs.get(id);
    return r ? new Uint8Array(r.data) : null;
  }

  /** The decoded picture, ready to draw – never triggers work. */
  getSync(id) {
    const d = this._decoded.get(id);
    if (!d) return null;
    // most recently used last (LRU)
    this._decoded.delete(id);
    this._decoded.set(id, d);
    return d.src;
  }

  /**
   * Loads (backend → memory) and decodes a picture; concurrent calls share one promise. Never rejects: null when the
   * picture is missing or cannot be decoded (always null in Node – no decoder).
   * @returns {Promise<CanvasImageSource|null>}
   */
  request(id) {
    if (!isImageId(id)) return Promise.resolve(null);
    const d = this._decoded.get(id);
    if (d) return Promise.resolve(d.src);
    const running = this._decoding.get(id);
    if (running) return running;
    const p = (async () => {
      if (!this._recs.has(id)) await this.load([id], { decode: false });
      const rec = this._recs.get(id);
      if (!rec) return null;
      return this._decode(id, rec);
    })().catch(() => null).finally(() => this._decoding.delete(id));
    this._decoding.set(id, p);
    return p;
  }

  /** cb(source) each later time the picture becomes ready (never synchronously). @returns {() => void} off */
  onReady(id, cb) {
    return this._sub(this._ready, id, cb);
  }

  /** cb() when the picture turns out to be missing in this browser. @returns {() => void} off */
  onMissing(id, cb) {
    return this._sub(this._missing, id, cb);
  }

  _sub(map, id, cb) {
    if (!isImageId(id) || typeof cb !== 'function') return () => {};
    let set = map.get(id);
    if (!set) map.set(id, (set = new Set()));
    set.add(cb);
    return () => {
      const s = map.get(id);
      if (!s) return;
      s.delete(cb);
      if (!s.size) map.delete(id);
    };
  }

  _call(map, id, arg) {
    for (const cb of [...(map.get(id) || [])]) {
      try {
        cb(arg);
      } catch (err) {
        console.warn('[images] listener failed', err);
      }
    }
  }

  async _decode(id, rec) {
    if (this._decoded.has(id)) return this._decoded.get(id).src;
    if (typeof Blob === 'undefined' || (typeof createImageBitmap !== 'function' && typeof Image === 'undefined')) return null;
    let src = null;
    try {
      const blob = new Blob([rec.data], { type: rec.mime });
      if (typeof createImageBitmap === 'function') {
        try {
          src = await createImageBitmap(blob);
        } catch {
          src = null;
        }
      }
      if (!src && typeof Image !== 'undefined') {
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
          await img.decode();
          // draw into a canvas so the object URL can go
          const c = makeCanvas(img.naturalWidth || rec.w, img.naturalHeight || rec.h);
          c.getContext('2d').drawImage(img, 0, 0);
          src = c;
        } catch {
          src = null;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch {
      src = null;
    }
    if (!src) {
      this.emit('error', { code: 'decode', message: MSG.stored, id });
      return null;
    }
    // forgotten meanwhile (gc) – do not resurrect it
    if (!this._recs.has(id)) {
      src.close?.();
      return null;
    }
    this._setDecoded(id, src, (src.width || rec.w) * (src.height || rec.h));
    return src;
  }

  /** Stores a decoded picture, tells the waiting models, then evicts the oldest ones beyond the pixel budget. */
  _setDecoded(id, src, px) {
    const old = this._decoded.get(id);
    if (old && old.src !== src) old.src.close?.();
    this._decoded.delete(id);
    this._decoded.set(id, { src, px: px || 0 });
    this._status.delete(id);
    this.emit('ready', { id });
    this._call(this._ready, id, src);
    let sum = 0;
    for (const d of this._decoded.values()) sum += d.px;
    for (const [k, d] of this._decoded) {
      if (sum <= this._budget) break;
      if (k === id) continue;
      this._decoded.delete(k);
      sum -= d.px;
      d.src.close?.();
    }
  }

  /** Closes every decoded source (createHome after the first build: the art canvases hold the pixels now). */
  releaseDecoded() {
    for (const d of this._decoded.values()) d.src.close?.();
    this._decoded.clear();
  }

  /** A cached blob: URL of the stored file (UI thumbnails); null when the bytes are not in memory. */
  objectUrl(id) {
    const u = this._urls.get(id);
    if (u) return u;
    const r = this._recs.get(id);
    if (!r || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
    try {
      const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
      this._urls.set(id, url);
      return url;
    } catch {
      return null;
    }
  }

  // ---- writing --------------------------------------------------------------------------------------------------

  /**
   * Upload pipeline (browser only): checks, decodes with EXIF orientation, downscales to MAX_SIDE, flattens on white,
   * re-encodes WebP q0.86 (JPEG q0.88 where WebP encoding is missing; EXIF/GPS are dropped), stores (awaited) and keeps
   * the decoded canvas (getSync works at once).
   * @param {File|Blob} file
   * @param {{ name?: string }} [o]
   * @returns {Promise<{ id, w, h, aspect, name, origW, origH, mime, bytes, persisted: boolean, warning: string|null }>}
   * @throws {ImageError}
   */
  async addFile(file, { name } = {}) {
    if (!file || !(file.size > 0)) throw new ImageError('empty', MSG.empty);
    if (file.size > MAX_UPLOAD_BYTES) throw new ImageError('size', MSG.size(mb(file.size)));
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    const kind = sniffKind(head);
    if (kind === 'heic' || kind === 'avif') throw new ImageError('heic', MSG.heic);
    if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') throw new ImageError('type', MSG.type);
    const hdr = imageSize(head);
    if (hdr && hdr.w * hdr.h > MAX_PIXELS) throw new ImageError('pixels', MSG.pixels(mp(hdr)));
    if (hdr && Math.min(hdr.w, hdr.h) < MIN_SIDE) throw new ImageError('small', MSG.small(hdr.w, hdr.h));
    const src = await decodeOriented(file);
    try {
      const origW = src.width || src.naturalWidth;
      const origH = src.height || src.naturalHeight;
      if (Math.min(origW, origH) < MIN_SIDE) throw new ImageError('small', MSG.small(origW, origH));
      const { canvas, w, h } = downscale(src, MAX_SIDE);
      let blob = await toBlob(canvas, 'image/webp', 0.86);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
      if (blob && blob.size > MAX_STORED_BYTES) blob = (await toBlob(canvas, blob.type, 0.72)) || blob;
      if (!blob) throw new ImageError('decode', MSG.decode);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const nm = cleanName(name ?? file.name ?? '');
      const id = await this.putBytes(bytes, { mime: blob.type, w, h, name: nm, origW, origH });
      this._setDecoded(id, canvas, w * h);
      const persisted = !!this.info(id)?.persisted;
      const warning = !persisted ? (this.persistent ? MSG.quota : MSG.memory)
        : Math.max(origW, origH) < LOW_RES_SIDE ? MSG.lowRes(origW, origH) : null;
      const rec = this._recs.get(id);
      return { id, w: rec?.w ?? w, h: rec?.h ?? h, aspect: (rec?.w ?? w) / (rec?.h ?? h), name: rec?.name || nm, origW: rec?.origW ?? origW, origH: rec?.origH ?? origH, mime: rec?.mime ?? blob.type, bytes: rec?.bytes ?? bytes.length, persisted, warning };
    } finally {
      src.close?.();
      if (src._url) URL.revokeObjectURL(src._url);
    }
  }

  /**
   * Stores bytes (hash → id; the same bytes again → the same id, no second record). Awaits the backend write unless
   * readOnly; a write that fails (QuotaExceededError …) does not throw: the record stays in memory with
   * info(id).persisted === false. Emits 'added' either way. Bytes that are stored already count as uploaded now
   * (_reupload: createdAt, lastUsedAt and the new name – «Nylig lastet opp» and the 14-day clean-up start again).
   * @param {Uint8Array} u8
   * @param {{ mime?: string, w?: number, h?: number, name?: string, origW?: number, origH?: number }} [meta]
   * @returns {Promise<string>} id
   */
  async putBytes(u8, { mime, w, h, name, origW, origH } = {}) {
    const bytes = asU8(u8);
    if (!bytes || !bytes.length) throw new ImageError('empty', MSG.empty);
    const id = hashBytes(bytes);
    const be = await this._backend();
    if (this._recs.has(id)) {
      await this._reupload(this._recs.get(id), name, be);
      return id;
    }
    let stored;
    try {
      stored = usableRecord(await be.get(id), id);
    } catch {
      stored = null;
    }
    if (this._recs.has(id)) {
      await this._reupload(this._recs.get(id), name, be);
      return id;
    }
    if (stored) {
      this._recs.set(id, stored);
      this._status.delete(id);
      await this._reupload(stored, name, be);
      this.emit('added', { id });
      return id;
    }
    const m = MIMES.includes(mime) ? mime : sniffMime(bytes) || 'image/png';
    const size = w > 0 && h > 0 ? { w, h } : imageSize(bytes, m) || { w: 1, h: 1 };
    const now = this._now();
    const rec = {
      id, mime: m, data: bytes.slice().buffer, w: size.w, h: size.h, bytes: bytes.length, name: cleanName(name),
      origW: origW > 0 ? origW : size.w, origH: origH > 0 ? origH : size.h, createdAt: now, lastUsedAt: now,
    };
    this._recs.set(id, rec);
    this._status.delete(id);
    if (this.readOnly) rec._unsaved = true;
    else {
      try {
        await be.put(plain(rec));
      } catch (err) {
        rec._unsaved = true;
        console.warn('[images] could not store the picture', err);
      }
    }
    this.emit('added', { id });
    return id;
  }

  /**
   * The same picture uploaded again: it counts as new (createdAt, lastUsedAt, the new file name) and is written again
   * (awaited; not in readOnly). A failed write keeps the stored record as it was – only a record that never reached the
   * backend stays unsaved.
   */
  async _reupload(rec, name, be) {
    const now = this._now();
    rec.createdAt = now;
    rec.lastUsedAt = now;
    const nm = cleanName(name);
    if (nm) rec.name = nm;
    this._status.delete(rec.id);
    if (this.readOnly) return;
    try {
      await be.put(plain(rec));
      delete rec._unsaved;
    } catch (err) {
      console.warn('[images] could not store the picture', err);
    }
  }

  /** Queues a background write; a failure marks the id in _failed (flush reports it). */
  _queue(promise, id, { report = false } = {}) {
    const p = promise.then(() => {
      const r = this._recs.get(id);
      if (r && report) delete r._unsaved;
    }, (err) => {
      this._failed.add(id);
      const r = this._recs.get(id);
      if (r && report) r._unsaved = true;
      if (report) this.emit('error', { code: 'write', message: MSG.importUnsaved, id });
      else console.warn('[images] background write failed', err);
    });
    this._writes.add(p);
    p.finally(() => this._writes.delete(p));
    return p;
  }

  /** lastUsedAt older than a day → bumped (queued write, not in readOnly). be: the backend or its promise. */
  _touch(rec, be) {
    const now = this._now();
    if (this.readOnly || rec._unsaved || now - (rec.lastUsedAt ?? 0) < DAY) return;
    rec.lastUsedAt = now;
    this._queue(Promise.resolve(be).then((b) => b.put(plain(rec))), rec.id);
  }

  /** True while the picture in memory was used within `graceDays` (gc: its snapshot may be older). */
  _fresh(id, now, graceDays) {
    const m = this._recs.get(id);
    return !!m && now - (m.lastUsedAt ?? m.createdAt ?? 0) <= graceDays * DAY;
  }

  _markMissing(id) {
    if (this._status.get(id) === 'missing') return;
    this._status.set(id, 'missing');
    this.emit('missing', { id });
    this._call(this._missing, id);
  }

  /**
   * Loads pictures into memory (and decodes them while their pixels fit the budget). Unknown ids become 'missing'.
   * @param {Iterable<string>} ids
   * @param {{ decode?: boolean }} [o]
   * @returns {Promise<{ ready: string[], missing: string[] }>}  ready = in memory now
   */
  async load(ids, { decode = true } = {}) {
    const list = [...new Set([...(ids || [])].filter(isImageId))];
    const be = await this._backend();
    const need = list.filter((id) => !this._recs.has(id));
    const wasMissing = new Set(need.filter((id) => this._status.get(id) === 'missing'));
    if (need.length) {
      for (const id of need) if (this._status.get(id) !== 'missing') this._status.set(id, 'loading');
      const got = await Promise.all(need.map((id) => Promise.resolve().then(() => be.get(id)).catch(() => undefined)));
      need.forEach((id, i) => {
        if (this._recs.has(id)) return; // imported meanwhile
        const rec = usableRecord(got[i], id);
        if (rec) {
          this._recs.set(id, rec);
          this._status.delete(id);
        } else {
          if (this._status.get(id) === 'loading') this._status.delete(id);
          this._markMissing(id);
        }
      });
    }
    const ready = [];
    const missing = [];
    for (const id of list) {
      const rec = this._recs.get(id);
      if (!rec) {
        missing.push(id);
        continue;
      }
      ready.push(id);
      this._touch(rec, be);
    }
    if (decode) {
      let px = 0;
      for (const d of this._decoded.values()) px += d.px;
      for (const id of ready) {
        if (this._decoded.has(id)) continue;
        const rec = this._recs.get(id);
        const p = (rec.w || 0) * (rec.h || 0);
        if (px + p > this._budget) break;
        // eslint-disable-next-line no-await-in-loop
        const src = await this.request(id);
        if (src) px += p;
      }
    } else {
      // a picture that was missing and turned up: the models waiting for it fill in
      for (const id of ready) if (wasMissing.has(id) && this._ready.get(id)?.size) this.request(id);
    }
    return { ready, missing };
  }

  /**
   * Every stored picture, newest first (loads their records; the first `limit` stay in memory).
   * @returns {Promise<object[]>} ImageInfo[]
   */
  async list({ limit = Infinity } = {}) {
    const be = await this._backend();
    let all = [];
    try {
      all = await be.all();
    } catch (err) {
      console.warn('[images] could not list the pictures', err);
    }
    const recs = new Map();
    for (const r of all) {
      const rec = usableRecord(r);
      if (rec && isImageId(rec.id)) recs.set(rec.id, rec);
    }
    for (const [id, r] of this._recs) recs.set(id, r);
    const sorted = [...recs.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, limit);
    for (const r of sorted) if (!this._recs.has(r.id)) this._recs.set(r.id, r);
    return sorted.map((r) => this.info(r.id)).filter(Boolean);
  }

  /**
   * The export block of pictures in memory (Saves.exportText – sync).
   * @param {Iterable<string>} ids
   * @returns {{ images: Object<string, { mime, w, h, name, origW, origH, data }>, missing: string[] }}
   */
  exportSync(ids) {
    const images = {};
    const missing = [];
    for (const id of new Set([...(ids || [])].filter(isImageId))) {
      const r = this._recs.get(id);
      if (!r) {
        missing.push(id);
        continue;
      }
      images[id] = { mime: r.mime, w: r.w, h: r.h, name: r.name || '', origW: r.origW ?? r.w, origH: r.origH ?? r.h, data: bytesToDataUrl(new Uint8Array(r.data), r.mime) };
    }
    return { images, missing };
  }

  /** exportSync after loading the pictures from the backend. */
  async export(ids) {
    const list = [...(ids || [])];
    await this.load(list, { decode: false });
    return this.exportSync(list);
  }

  /**
   * Registers the pictures of an imported design file (synchronous – Saves.importText is). Each entry is checked
   * (count, id, data, mime, size, pixels, hash – the first failing reason is reported); accepted pictures are kept in
   * memory at once and written to the backend in the background (flush() waits for that).
   * @param {Object<string, object|string>} map  id → { mime, w, h, name, origW, origH, data } or a bare dataURL
   * @returns {{ added: string[], existing: string[], rejected: Array<{ id: string, reason: string }> }}
   */
  import(map) {
    const added = [];
    const existing = [];
    const rejected = [];
    if (!map || typeof map !== 'object' || Array.isArray(map)) return { added, existing, rejected };
    let be = null;
    let n = 0;
    for (const [id, entry] of Object.entries(map)) {
      if (n++ >= MAX_IMPORT_IMAGES) {
        rejected.push({ id, reason: 'count' });
        continue;
      }
      if (!isImageId(id)) {
        rejected.push({ id, reason: 'id' });
        continue;
      }
      const data = typeof entry === 'string' ? entry : entry?.data;
      const parsed = typeof data === 'string' ? dataUrlToBytes(data) : null;
      if (!parsed || !parsed.bytes.length) {
        rejected.push({ id, reason: 'data' });
        continue;
      }
      const { mime, bytes } = parsed;
      const declared = typeof entry === 'object' && entry ? entry.mime : undefined;
      if (!MIMES.includes(mime) || sniffMime(bytes) !== mime || (declared != null && declared !== mime)) {
        rejected.push({ id, reason: 'mime' });
        continue;
      }
      if (bytes.length > MAX_IMPORT_IMAGE_BYTES) {
        rejected.push({ id, reason: 'size' });
        continue;
      }
      const size = imageSize(bytes, mime);
      if (!size || size.w > MAX_IMPORT_SIDE || size.h > MAX_IMPORT_SIDE) {
        rejected.push({ id, reason: 'pixels' });
        continue;
      }
      if (hashBytes(bytes) !== id) {
        rejected.push({ id, reason: 'hash' });
        continue;
      }
      const known = this._recs.get(id);
      if (known) {
        existing.push(id);
        // used again: the clean-up must not take it (a record listed under «Nylig lastet opp» can be weeks old)
        be ??= this._backend();
        this._touch(known, be);
        continue;
      }
      const wasMissing = this._status.get(id) === 'missing';
      const now = this._now();
      const e = typeof entry === 'object' && entry ? entry : {};
      const rec = {
        id, mime, data: bytes.slice().buffer, w: size.w, h: size.h, bytes: bytes.length, name: cleanName(e.name),
        origW: e.origW > 0 ? e.origW : size.w, origH: e.origH > 0 ? e.origH : size.h, createdAt: now, lastUsedAt: now,
      };
      this._recs.set(id, rec);
      this._status.delete(id);
      added.push(id);
      this.emit('added', { id });
      if (this.readOnly) rec._unsaved = true;
      else {
        be ??= this._backend();
        this._queue(be.then((b) => b.put(plain(rec))), id, { report: true });
      }
      if (wasMissing || this._ready.get(id)?.size) this.request(id);
    }
    return { added, existing, rejected };
  }

  /**
   * Waits for the queued backend writes (import, touch).
   * @returns {Promise<{ ok: boolean, failed: string[] }>}  failed is cleared after reporting
   */
  async flush() {
    await Promise.allSettled([...this._writes]);
    const failed = [...this._failed];
    this._failed.clear();
    return { ok: !failed.length, failed };
  }

  /**
   * Deletes stored pictures that no root uses and that were not used for `graceDays` (protects undo, «Før/etter»,
   * other tabs). Roots get their lastUsedAt bumped (at most once a day). A picture used again while it runs (an import,
   * an upload or a load since its snapshot – in memory or in the backend) is kept. A no-op in readOnly or without a
   * root set.
   * @param {Set<string>} roots
   * @param {number} [graceDays]
   * @param {{ now?: number }} [o]
   * @returns {Promise<string[]>} deleted ids
   */
  async gc(roots, graceDays = GRACE_DAYS, { now = this._now() } = {}) {
    if (this.readOnly || !(roots instanceof Set)) return [];
    const be = await this._backend();
    let all;
    try {
      all = await be.all();
    } catch (err) {
      console.warn('[images] clean-up could not read the pictures', err);
      return [];
    }
    const deleted = [];
    for (const r of all || []) {
      if (!r || !isImageId(r.id)) continue;
      if (roots.has(r.id)) {
        if (now - (r.lastUsedAt ?? 0) > DAY) {
          const rec = { ...r, lastUsedAt: now };
          const mem = this._recs.get(r.id);
          if (mem) mem.lastUsedAt = now;
          try {
            // eslint-disable-next-line no-await-in-loop
            await be.put(plain(rec));
          } catch (err) {
            console.warn('[images] could not mark a picture as used', err);
          }
        }
        continue;
      }
      const used = r.lastUsedAt ?? r.createdAt ?? 0;
      if (now - used <= graceDays * DAY) continue;
      // the snapshot is from before the loop's awaits: an import, an upload or a load since then (in memory) or another
      // tab (in the backend) may have used the picture again
      if (this._fresh(r.id, now, graceDays)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const cur = await be.get(r.id);
        if (cur && now - (cur.lastUsedAt ?? cur.createdAt ?? 0) <= graceDays * DAY) continue;
        if (this._fresh(r.id, now, graceDays)) continue;
        // eslint-disable-next-line no-await-in-loop
        await be.delete(r.id);
        if (this._fresh(r.id, now, graceDays)) {
          // used again while the delete ran: it stays (written back)
          this._queue(be.put(plain(this._recs.get(r.id))), r.id);
          continue;
        }
        deleted.push(r.id);
        this._forget(r.id);
      } catch (err) {
        console.warn('[images] could not delete a picture', err);
      }
    }
    if (deleted.length) this.emit('deleted', { ids: deleted });
    return deleted;
  }

  /** Drops a picture from memory (after a delete). */
  _forget(id) {
    this._recs.delete(id);
    this._status.delete(id);
    const u = this._urls.get(id);
    if (u) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* nothing to revoke */
      }
      this._urls.delete(id);
    }
    const d = this._decoded.get(id);
    if (d) {
      d.src.close?.();
      this._decoded.delete(id);
    }
  }

  /** Revokes object URLs, closes decoded sources, drops listeners. */
  dispose() {
    for (const u of this._urls.values()) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* nothing to revoke */
      }
    }
    this._urls.clear();
    this.releaseDecoded();
    this._ready.clear();
    this._missing.clear();
    this.clear();
  }
}

let _app = null;

/**
 * The app's store (createHome, the UI, tests via window.__game.home.images). Page-lifetime: «Avslutt» → «Gå inn i
 * stua» reuses it. readOnly sticks once set (dev pages).
 * @param {{ readOnly?: boolean }} [o]
 * @returns {ImageStore}
 */
export function getImageStore({ readOnly = false } = {}) {
  if (!_app) _app = new ImageStore({ backend: 'auto', readOnly });
  else if (readOnly) _app.readOnly = true;
  return _app;
}

export default ImageStore;
