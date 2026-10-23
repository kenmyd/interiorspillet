/**
 * Planbygger: the drawing stack – the start of «Generer» (notes/planbygger-runde1-design.md, «Brukerflaten»). The
 * customer drops all the drawings at once; the stack shows the floors with thumbnails, the top floor on top, and the
 * facades and other drawings beside them. Every drawing has a chip (Etasje, Fasade, Annet) and the reason for its
 * place; a card is dragged to another place. «Generer» hands the files to generate.js.
 *
 *   decodeFile(file) → Promise<[{ name, img: ImageData | null, bitmap, size: { width, height }, pdfPage?, focal?,
 *                                 page?, render?, lazy? }]>   (the array's skipped: PDF pages left out, numPages)
 *       PNG, JPG, WebP, AVIF (createImageBitmap with the EXIF orientation), PDF: a scanned page at its scan's own
 *       resolution (at most IMAGE_MAX_SIDE, like the same scan uploaded as an image), a vector page at 200 dpi (at most
 *       PDF_MAX_SIDE); pdfPage { widthPt, heightPt, widthPx, heightPx } with the full page's px. A PDF of one page is
 *       rendered at once. A PDF of several pages is not: each page gets a thumbnail (bitmap) and lazy = { preview(),
 *       load(), close() }, where preview() renders it at PDF_PREVIEW_SIDE (for the analysis), load() at full size (only
 *       for the pages kept at «Generer») – img stays null until then. At most PDF_MAX_PAGES pages; the rest are left
 *       out and counted in skipped. bitmap: the card's picture, at most 1600 px (the full drawing is img).
 *       focal: a JPEG's EXIF FocalLengthIn35mmFilm / 43.27 (photo.js rectifyPhoto: the share of the diagonal)
 *   renderPdf(file, { pages }) → [{ name, img, bitmap, size, page, pdfPage, render }]   those pages (default: the
 *       first PDF_MAX_PAGES), each at full size – the one-plan page («Bare én plan») takes page 1 only
 *   pdfPageScale(pdfjs, page) → { scale, widthPt, heightPt, widthPx, heightPx, render: 'scan'|'vector' }
 *   exifFocal35(arrayBuffer) → the EXIF FocalLengthIn35mmFilm of a JPEG, or null
 *   pdfRenderScale(pdfjs, page) → px per pt: the largest embedded image's own resolution when it covers most of the
 *       page (a scan), else null (a vector page)
 *
 *   const s = new DrawingStack(el, { analyse, onGenerate, onBack, onPick, aiStatus })
 *     analyse(img, item) → Promise<{ blocks, photo }>   splitSheet's blocks and isPhoto (the page's worker); img is the
 *                          drawing, or a lazy PDF page's preview (let go again after the analysis)
 *     onGenerate(inputs) → Promise   inputs for generate(): [{ name, img, pdfPage?, focal?, kind?, level? }] – kind only
 *                          where the customer changed the chip of a single drawing, level only when the floors were
 *                          reordered. The full PDF pages rendered for it are let go when it resolves (s.release()).
 *     onPick()             «Legg til flere»: the page opens its file picker and calls s.addFiles(files)
 *   s.addFiles(files) → Promise   s.items   s.notices   s.progress({ done, total, text }) / s.progress(null)
 *   s.inputs() → Promise<inputs> (renders the kept lazy pages)   s.release()   s.generate() → Promise   s.remove(item)
 *
 * Text on the page is Norwegian; the stack keeps no state outside the page (the files stay in the browser).
 */
import { levelWords } from './generate.js';

export const FILE_ACCEPT = '.png,.jpg,.jpeg,.webp,.avif,.pdf,image/*,application/pdf';
const IMAGE_TYPES = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const PDF_JS = '4.10.38';
/** a vector PDF page is rendered at this resolution */
export const PDF_DPI = 200;
/** the long side of a rendered vector PDF page, at most */
export const PDF_MAX_SIDE = 4000;
/**
 * a raster upload larger than this (long side) is scaled down on reading – and a scanned PDF page is rendered at its
 * scan's own resolution up to this, so the PDF gives the same image as the scan itself (hus7: 4771 × 3332 px, the size
 * the Node tests read from plantegninger/_png/hus7)
 */
export const IMAGE_MAX_SIDE = 6000;
/** a PDF with more pages than this: the rest are left out, and the stack says so */
export const PDF_MAX_PAGES = 40;
/** a page of a PDF with several pages is analysed at this size (splitSheet works on ~1000 px, hus7 holds from 1500) */
export const PDF_PREVIEW_SIDE = 2000;
/** the thumbnail render of a lazy PDF page (2 × the card's 132 × 100 CSS px) */
const PDF_THUMB_SIDE = 280;
/** an embedded image covering at least this share of the page makes it a scan */
const SCAN_COVER = 0.5;
const KINDS = [
  ['plan', 'Etasje'],
  ['facade', 'Fasade'],
  ['other', 'Annet'],
];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the files

/** The EXIF FocalLengthIn35mmFilm (tag 0xA405) of a JPEG, or null. Never throws. */
export function exifFocal35(buf) {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const marker = v.getUint8(p + 1);
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan: no more metadata
      const len = v.getUint16(p + 2);
      if (marker === 0xe1 && len >= 16 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) return tiffFocal(v, p + 10);
      p += 2 + len;
    }
  } catch {
    /* a cut or odd file: no focal length */
  }
  return null;
}
function tiffFocal(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  if (u16(2) !== 42) return null;
  const entry = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
    return null;
  };
  const e0 = entry(u32(4), 0x8769); // the Exif sub-IFD
  if (e0 == null) return null;
  const e1 = entry(u32(e0 + 8), 0xa405);
  if (e1 == null) return null;
  const type = u16(e1 + 2);
  const val = type === 3 ? u16(e1 + 8) : type === 4 ? u32(e1 + 8) : 0;
  return val > 0 ? val : null;
}

/**
 * The picture a card keeps besides the drawing's ImageData (its thumbnail, and a guide crop when generate's own image
 * is gone): at most this long side, so a large drawing is not held twice at full size.
 */
const CARD_BITMAP_SIDE = 1600;
function cardBitmap(source) {
  const k = Math.min(1, CARD_BITMAP_SIDE / Math.max(source.width, source.height));
  if (k >= 1) return createImageBitmap(source);
  return createImageBitmap(source, { resizeWidth: Math.max(1, Math.round(source.width * k)), resizeHeight: Math.max(1, Math.round(source.height * k)), resizeQuality: 'high' });
}

/** An ImageBitmap (or canvas) as RGBA ImageData on white, scaled to fit maxSide. → { img, bitmap (cardBitmap) } */
async function rasterOf(source, maxSide = IMAGE_MAX_SIDE) {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k));
  const hh = Math.max(1, Math.round(source.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, hh);
  g.drawImage(source, 0, 0, w, hh);
  const img = g.getImageData(0, 0, w, hh);
  const bitmap = await cardBitmap(c);
  dropCanvas(c);
  if (source instanceof ImageBitmap) source.close();
  return { img, bitmap };
}

let pdfjsPromise = null;
/** pdf.js from a CDN, loaded only when a PDF is opened (no build dependency). */
export function loadPdfJs() {
  pdfjsPromise ??= import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_JS}/build/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_JS}/build/pdf.worker.min.mjs`;
    return pdfjs;
  });
  pdfjsPromise.catch(() => (pdfjsPromise = null));
  return pdfjsPromise;
}

const mulCtm = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/**
 * px per pt of a scanned page: the largest image painted on it, at its own resolution, when it covers at least half
 * the page; null for a vector page (or when the operator list cannot be read).
 */
export async function pdfRenderScale(pdfjs, page) {
  try {
    const OPS = pdfjs.OPS;
    const ops = await page.getOperatorList();
    const view = page.view; // [x0, y0, x1, y1] in pt, before /Rotate
    const pageArea = Math.abs((view[2] - view[0]) * (view[3] - view[1])) || 1;
    const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject].filter((x) => x != null));
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let best = null;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mulCtm(ctm, args);
      else if (paint.has(fn)) {
        const w = fn === OPS.paintInlineImageXObject ? args?.[0]?.width : args?.[1];
        const hh = fn === OPS.paintInlineImageXObject ? args?.[0]?.height : args?.[2];
        const wPt = Math.hypot(ctm[0], ctm[1]);
        const hPt = Math.hypot(ctm[2], ctm[3]);
        if (!(w > 0 && hh > 0 && wPt > 0 && hPt > 0)) continue;
        const area = wPt * hPt;
        if (!best || area > best.area) best = { area, ppt: Math.max(w, hh) / Math.max(wPt, hPt) };
      }
    }
    return best && best.area >= SCAN_COVER * pageArea && best.ppt > 0.2 ? best.ppt : null;
  } catch {
    return null;
  }
}

/**
 * How one PDF page is rendered (see the top of the file): px per pt, the page in pt and the full render's px. A scan
 * at its own resolution up to IMAGE_MAX_SIDE, a vector page at PDF_DPI up to PDF_MAX_SIDE.
 */
export async function pdfPageScale(pdfjs, page) {
  const v1 = page.getViewport({ scale: 1 });
  const native = await pdfRenderScale(pdfjs, page);
  let scale = native ?? PDF_DPI / 72;
  const cap = native ? IMAGE_MAX_SIDE : PDF_MAX_SIDE;
  const long = Math.max(v1.width, v1.height) * scale;
  if (long > cap) scale *= cap / long;
  const vp = page.getViewport({ scale });
  return { scale, widthPt: v1.width, heightPt: v1.height, widthPx: Math.max(1, Math.round(vp.width)), heightPx: Math.max(1, Math.round(vp.height)), render: native ? 'scan' : 'vector' };
}

/** One page on a white canvas at this scale. → the canvas */
async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return c;
}
const canvasImage = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
/** Lets a canvas's pixels go now, not at the next garbage collection. */
function dropCanvas(c) {
  c.width = 0;
  c.height = 0;
}

async function openPdf(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return { pdfjs, pdf };
}
const pageName = (file, p, n) => (n === 1 ? file.name : file.name.replace(/(\.pdf)?$/i, `-side${p}.pdf`));

/** Those pages of a PDF, each at full size (see the top of the file). */
export async function renderPdf(file, { pages = null } = {}) {
  const opened = await openPdf(file);
  try {
    return await renderPages(file, opened, pages);
  } finally {
    await opened.pdf.destroy?.();
  }
}
async function renderPages(file, { pdfjs, pdf }, pages = null) {
  const n = pdf.numPages;
  const want = (pages ?? Array.from({ length: Math.min(n, PDF_MAX_PAGES) }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= n);
  const out = [];
  for (const p of want) {
    const page = await pdf.getPage(p);
    const plan = await pdfPageScale(pdfjs, page);
    const c = await renderPage(page, plan.scale);
    const img = canvasImage(c);
    out.push({ name: pageName(file, p, n), img, bitmap: await cardBitmap(c), size: { width: c.width, height: c.height }, page: p, pdfPage: { widthPt: plan.widthPt, heightPt: plan.heightPt, widthPx: c.width, heightPx: c.height }, render: plan.render });
    dropCanvas(c);
    page.cleanup?.();
  }
  return Object.assign(out, { numPages: n, skipped: n - want.length });
}

/**
 * A PDF of several pages, lazily (see the top of the file): per page a thumbnail and the plan of its full render. The
 * document stays open while one of its pages is in the stack (lazy.close() on each; the last one closes it).
 */
async function lazyPdf(file, { pdfjs, pdf }) {
  const n = pdf.numPages;
  const take = Math.min(n, PDF_MAX_PAGES);
  const doc = { open: take };
  const out = [];
  for (let p = 1; p <= take; p++) {
    const page = await pdf.getPage(p);
    const plan = await pdfPageScale(pdfjs, page);
    const k = Math.min(1, PDF_THUMB_SIDE / Math.max(plan.widthPx, plan.heightPx));
    const thumb = await renderPage(page, plan.scale * k);
    const bitmap = await createImageBitmap(thumb);
    dropCanvas(thumb);
    page.cleanup?.();
    let closed = false;
    const at = async (scale) => {
      if (closed) throw new Error('PDF-en er lukket');
      const pg = await pdf.getPage(p);
      const c = await renderPage(pg, scale);
      const img = canvasImage(c);
      dropCanvas(c);
      pg.cleanup?.();
      return img;
    };
    const lazy = {
      preview: () => at(plan.scale * Math.min(1, PDF_PREVIEW_SIDE / Math.max(plan.widthPx, plan.heightPx))),
      // the full page: exactly the size pdfPage says
      load: async () => {
        const img = await at(plan.scale);
        if (img.width !== plan.widthPx || img.height !== plan.heightPx) throw new Error(`siden ble ${img.width} × ${img.height} px, ikke ${plan.widthPx} × ${plan.heightPx}`);
        return img;
      },
      close: () => {
        if (closed) return;
        closed = true;
        if (--doc.open <= 0) pdf.destroy?.();
      },
    };
    out.push({ name: pageName(file, p, n), img: null, bitmap, size: { width: plan.widthPx, height: plan.heightPx }, page: p, pdfPage: { widthPt: plan.widthPt, heightPt: plan.heightPt, widthPx: plan.widthPx, heightPx: plan.heightPx }, render: plan.render, lazy });
  }
  return Object.assign(out, { numPages: n, skipped: n - take });
}

/** One uploaded file → its drawings (a PDF gives one per page). */
export async function decodeFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const opened = await openPdf(file);
    if (opened.pdf.numPages > 1) {
      try {
        return await lazyPdf(file, opened);
      } catch (err) {
        await opened.pdf.destroy?.();
        throw err;
      }
    }
    try {
      const one = await renderPages(file, opened, [1]);
      if (!one.length) throw new Error(`«${file.name}» har ingen sider`);
      return one;
    } finally {
      await opened.pdf.destroy?.();
    }
  }
  if (!(file.type?.startsWith('image/') || IMAGE_TYPES.test(file.name))) throw new Error(`«${file.name}» er ikke et bilde eller en PDF`);
  // the EXIF orientation (a phone photo taken on its side) is applied while decoding
  const bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { img, bitmap } = await rasterOf(bm);
  let focal = null;
  if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name)) {
    const f35 = exifFocal35(await file.slice(0, 256 * 1024).arrayBuffer());
    if (f35) focal = Math.round((f35 / 43.27) * 1000) / 1000;
  }
  return [{ name: file.name, img, bitmap, size: { width: img.width, height: img.height }, ...(focal ? { focal } : {}) }];
}

// ---------------------------------------------------------------------------------------------------------------
// Floors: names and the first order

/**
 * The level a name says: a sortable key (null: the name says nothing), the level number when it is sure, a short
 * label for the card's badge and the reason (Norwegian).
 */
export function nameLevel(name) {
  const w = levelWords(name);
  if (w.level != null) return { key: w.level, level: w.level, label: levelLabel(w.level), why: 'fra filnavnet' };
  if (w.tag === 'basement') return { key: -1, level: -1, label: 'Kjeller', why: 'kjeller eller underetasje, fra filnavnet' };
  if (w.tag === 'loft') return { key: 50, level: null, label: 'Loft', why: 'fra filnavnet' };
  if (w.tag === 'upper') return { key: 0.5, level: null, label: 'Over kjelleren', why: 'fra filnavnet' };
  return { key: null, level: null, label: '?', why: 'plasseres etter tittelen og innholdet når du trykker «Generer»' };
}
export function levelLabel(n) {
  if (n == null) return 'Etasje';
  if (n < 0) return n === -1 ? 'Kjeller' : `${-n}. kjeller`;
  return `${n + 1}. etasje`;
}

/** The first kind of a drawing from its analysis and name. → { kind, multi, note } */
function kindFromAnalysis(name, a) {
  const facadeName = /fasade|facade|snitt|section/i.test(name);
  const blocks = (a?.blocks ?? []).filter((b) => b.kind === 'plan' || b.kind === 'facade' || b.kind === 'section');
  const plans = blocks.filter((b) => b.kind === 'plan').length;
  const facades = blocks.length - plans;
  const multi = blocks.length >= 2;
  const parts = [plans ? `${plans} plan${plans > 1 ? 'er' : ''}` : null, facades ? `${facades} fasade${facades > 1 ? 'r' : ''} eller snitt` : null].filter(Boolean).join(' og ');
  const note = multi ? `Arket har ${blocks.length} tegninger (${parts}) – de deles opp` : a?.photo?.photo ? 'Ser ut som et foto – det rettes opp' : null;
  if (a?.photo?.photo) return { kind: facadeName ? 'facade' : 'plan', multi: false, note };
  if (plans) return { kind: 'plan', multi, note };
  if (facades) return { kind: 'facade', multi, note };
  return { kind: facadeName ? 'facade' : 'plan', multi: false, note: a ? 'Fant ingen tydelig tegning – sjekk merkelappen' : null };
}

// ---------------------------------------------------------------------------------------------------------------
// The stack

let seq = 0;

export class DrawingStack {
  constructor(el, { analyse = null, onGenerate = () => {}, onBack = null, onPick = null, aiStatus = null } = {}) {
    this.el = el;
    this.analyse = analyse;
    this.onGenerate = onGenerate;
    this.onBack = onBack;
    this.onPick = onPick;
    this.items = [];
    /** messages about the files as a whole (a PDF with too many pages), Norwegian */
    this.notices = [];
    this.userOrdered = false;
    this.ai = null;
    this.busy = false;
    this._build();
    if (aiStatus) {
      Promise.resolve(aiStatus)
        .then((s) => {
          this.ai = s;
          this._renderFoot();
        })
        .catch(() => {});
    }
  }

  /** The floors, top first. */
  get floors() {
    return this.items.filter((x) => x.kind === 'plan');
  }

  _build() {
    this.listFloors = h('ol', { class: 'pb-stack-list is-floors' });
    this.listFacades = h('ul', { class: 'pb-stack-list' });
    this.listOther = h('ul', { class: 'pb-stack-list is-other' });
    this.aiEl = h('span', { class: 'pb-stack-ai' }, 'KI: sjekker …');
    this.summaryEl = h('span', { class: 'pb-note' });
    this.genBtn = h('button', { class: 'pb-btn is-primary pb-generate', onclick: () => this._generate() }, 'Generer');
    this.progressEl = h('div', { class: 'pb-progress', hidden: true });
    this.noticeEl = h('ul', { class: 'pb-stack-notices', hidden: true });
    const drop = h('div', { class: 'pb-stack-drop', onclick: () => this.onPick?.() }, h('strong', {}, '+ Legg til flere tegninger'), h('span', {}, 'Slipp dem her, eller klikk for å velge'));
    drop.addEventListener('dragenter', () => drop.classList.add('is-over'));
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', () => drop.classList.remove('is-over'));
    this.root = h('div', { class: 'pb-stack' },
      h('header', { class: 'pb-stack-head' },
        h('div', {}, h('h1', {}, 'Tegningene dine'), h('p', {}, 'Øverste etasje står øverst. Dra et kort for å flytte det, og sjekk hva hver tegning er.')),
        this.aiEl),
      this.noticeEl,
      h('div', { class: 'pb-stack-cols' },
        h('section', { class: 'pb-stack-col' }, h('h3', {}, 'Etasjer', h('small', {}, 'øverst er øverst')), this.listFloors),
        h('section', { class: 'pb-stack-col' }, h('h3', {}, 'Fasader'), this.listFacades, h('h3', {}, 'Annet', h('small', {}, 'brukes ikke')), this.listOther, drop)),
      h('footer', { class: 'pb-stack-foot' },
        this.onBack ? h('button', { class: 'pb-btn', onclick: () => this.onBack() }, 'Tilbake') : null,
        this.summaryEl, this.genBtn),
      this.progressEl);
    this.el.innerHTML = '';
    this.el.append(this.root);
    this.render();
  }

  /** Reads and adds files (several at once); every drawing gets a card at once, its analysis follows. */
  async addFiles(files) {
    const list = [...(files || [])];
    const pending = list.map((file) => {
      const it = { id: `t${++seq}`, name: file.name, file, loading: true, kind: 'plan', kindFrom: 'auto', note: 'Leser fila …' };
      this.items.push(it);
      return it;
    });
    this.render();
    await Promise.all(pending.map(async (it) => {
      let drawings;
      try {
        drawings = await decodeFile(it.file);
      } catch (err) {
        it.loading = false;
        it.error = err?.message ?? String(err);
        it.kind = 'other';
        it.note = `Kunne ikke leses: ${it.error}`;
        this.render();
        return;
      }
      const at = this.items.indexOf(it);
      if (at < 0) {
        // removed while it was read
        for (const d of drawings) d.lazy?.close();
        return;
      }
      if (drawings.skipped > 0) this.notices.push(`«${it.file.name}» har ${drawings.numPages} sider. Bare de ${drawings.length} første er tatt med – del opp PDF-en om tegningene står lenger bak.`);
      const made = drawings.map((d, k) => ({ ...it, id: k ? `t${++seq}` : it.id, name: this._uniqueName(d.name, it), img: d.img, bitmap: d.bitmap, size: d.size ?? (d.img ? { width: d.img.width, height: d.img.height } : null), lazy: d.lazy ?? null, pdfPage: d.pdfPage ?? null, focal: d.focal ?? null, page: d.page ?? null, render: d.render ?? null, loading: false, analysing: !!this.analyse, note: this.analyse ? 'Ser på tegningen …' : null }));
      this.items.splice(at, 1, ...made);
      for (const m of made) {
        Object.assign(m, nameLevel(m.name), { thumb: thumbCanvas(m.bitmap) });
        // a lazy page keeps only its thumbnail (its bitmap is no larger), the rest renders when it is needed
      }
      this._sortFloors();
      this.render();
      const analyseOne = async (m) => {
        if (!this.analyse) return;
        let a = null;
        try {
          // a lazy PDF page: its preview, one page at a time, let go after the analysis
          const img = m.img ?? (m.lazy && this.items.includes(m) ? await m.lazy.preview() : null);
          a = img ? await this.analyse(img, m) : null;
        } catch {
          a = null;
        }
        m.analysing = false;
        m.analysis = a;
        const k = kindFromAnalysis(m.name, a);
        m.autoKind = k.kind;
        m.multi = k.multi;
        m.note = k.note;
        if (m.kindFrom !== 'user') m.kind = k.kind;
        this._sortFloors();
        this.render();
      };
      if (made.some((m) => m.lazy)) for (const m of made) await analyseOne(m);
      else await Promise.all(made.map(analyseOne));
    }));
    this.render();
  }

  _uniqueName(name, it) {
    let n = name;
    let i = 2;
    while (this.items.some((x) => x !== it && x.name === n && !x.loading)) n = name.replace(/(\.[a-z0-9]+)?$/i, ` (${i++})$1`);
    return n;
  }

  /** The floors in the order of their names (top first) – until the customer has moved one. */
  _sortFloors() {
    if (this.userOrdered) return;
    const floors = this.items.filter((x) => x.kind === 'plan');
    const rest = this.items.filter((x) => x.kind !== 'plan');
    // known levels by their number, top first; the unknown ones on top in upload order (generate places them)
    const known = floors.filter((x) => x.key != null).sort((a, b) => b.key - a.key);
    const unknown = floors.filter((x) => x.key == null);
    this.items = [...unknown, ...known, ...rest];
  }

  /**
   * The level numbers of the customer's order: bottom up, the lowest floor whose name does not say basement is the main
   * level (0). Two floors swapped thus means «the names are the wrong way round», not a new basement.
   */
  levels() {
    const bottomUp = [...this.floors].reverse();
    let main = bottomUp.findIndex((x) => !(x.key < 0));
    if (main < 0) main = 0;
    return new Map(bottomUp.map((x, i) => [x.id, i - main]));
  }

  /** The drawings «Generer» uses: read, not Annet. */
  get used() {
    return this.items.filter((x) => (x.img || x.lazy) && !x.loading && x.kind !== 'other');
  }

  /**
   * generate()'s inputs (see the top of the file). The kept pages of a PDF of several pages are rendered in full now,
   * one at a time (the progress says which); s.release() lets them go again.
   */
  async inputs() {
    const levels = this.userOrdered ? this.levels() : null;
    const used = this.used;
    const toLoad = used.filter((x) => !x.img && x.lazy);
    for (let i = 0; i < toLoad.length; i++) {
      const x = toLoad[i];
      if (this.busy) this.progress({ done: i, total: toLoad.length + 1, text: `Leser ${x.page ? `side ${x.page} av «${x.file?.name ?? x.name}»` : `«${x.name}»`} i full størrelse …` });
      x.img = await x.lazy.load();
      x.loadedNow = true;
    }
    return used.map((x) => ({
      name: x.name,
      img: x.img,
      ...(x.pdfPage ? { pdfPage: x.pdfPage } : {}),
      ...(x.focal ? { focal: x.focal } : {}),
      ...(x.kindFrom === 'user' && !x.multi ? { kind: x.kind } : {}),
      ...(levels && x.kind === 'plan' && !x.multi ? { level: levels.get(x.id) } : {}),
    }));
  }

  /** Lets the full renders of the lazy PDF pages go (they are rendered again at the next «Generer»). */
  release() {
    for (const x of this.items) {
      if (!x.lazy || !x.img) continue;
      x.img = null;
      x.loadedNow = false;
    }
  }

  /** «Generer»: the inputs, onGenerate, then the full PDF pages let go. → onGenerate's result (null when busy) */
  async generate() {
    if (this.busy) return null;
    this.busy = true;
    this._renderFoot();
    let inputs;
    try {
      inputs = await this.inputs();
    } catch (err) {
      this.release();
      this.busy = false;
      this.progress(null);
      this.notices.push(`En side kunne ikke leses: ${err?.message ?? err}`);
      this.render();
      return null;
    }
    this.busy = false;
    try {
      return await this.onGenerate(inputs);
    } finally {
      this.release();
    }
  }

  setKind(it, kind) {
    if (it.kind === kind) return;
    const wasPlan = it.kind === 'plan';
    it.kind = kind;
    it.kindFrom = 'user';
    if (kind === 'plan' && !wasPlan) {
      // a new floor: by its name, or on top when the customer has ordered the floors
      this.items = [it, ...this.items.filter((x) => x !== it)];
      this._sortFloors();
    }
    this.render();
  }

  remove(it) {
    this.items = this.items.filter((x) => x !== it);
    it.lazy?.close();
    it.img = null;
    this.render();
  }

  /** Moves a floor to index i among the floors (top first). */
  moveFloor(it, i) {
    const floors = this.floors.filter((x) => x !== it);
    i = Math.max(0, Math.min(floors.length, i));
    floors.splice(i, 0, it);
    const rest = this.items.filter((x) => x.kind !== 'plan');
    const before = this.floors.map((x) => x.id).join();
    this.items = [...floors, ...rest];
    if (this.floors.map((x) => x.id).join() !== before) this.userOrdered = true;
  }

  render() {
    if (!this.root) return;
    const floors = this.floors;
    const levels = this.userOrdered ? this.levels() : null;
    this.listFloors.innerHTML = '';
    floors.forEach((it, i) => this.listFloors.append(this._card(it, { index: i, level: levels?.get(it.id) })));
    if (!floors.length) this.listFloors.append(h('li', { class: 'pb-stack-empty' }, 'Ingen plantegninger ennå. Slipp tegningene dine her.'));
    this.listFacades.innerHTML = '';
    const facades = this.items.filter((x) => x.kind === 'facade');
    for (const it of facades) this.listFacades.append(this._card(it));
    if (!facades.length) this.listFacades.append(h('li', { class: 'pb-stack-empty' }, 'Ingen fasader. Med fasader blir vindushøydene og taket riktige.'));
    this.listOther.innerHTML = '';
    for (const it of this.items.filter((x) => x.kind === 'other')) this.listOther.append(this._card(it));
    this._renderFoot();
  }

  _renderFoot() {
    if (!this.genBtn) return;
    const floors = this.floors.filter((x) => x.img || x.lazy).length;
    const facades = this.items.filter((x) => x.kind === 'facade' && (x.img || x.lazy)).length;
    this.noticeEl.hidden = !this.notices.length;
    this.noticeEl.replaceChildren(...this.notices.map((t) => h('li', {}, t)));
    const loading = this.items.some((x) => x.loading);
    const ai = this.ai;
    // without the AI no house is made for a customer (app.js _noAiAllowed): «Generer» waits for it
    const noAi = ai && !ai.available && window.__planbyggerAllowNoAi !== true;
    this.genBtn.disabled = this.busy || loading || !floors || noAi;
    this.aiEl.textContent = !ai ? 'KI: sjekker …' : ai.available ? 'KI er på: romnavn og mål leses fra tegningen' : noAi ? 'KI-tjenesten svarer ikke akkurat nå – prøv igjen om litt' : 'KI er av: du får noen flere spørsmål';
    this.aiEl.className = `pb-stack-ai ${ai?.available ? 'is-on' : ai ? 'is-off' : ''}`;
    this.aiEl.title = ai?.available ? 'En nedskalert kopi av hver tegning sendes til KI-tjenesten, som leser tekst og symboler. Alle mål regnes ut i nettleseren.' : 'Uten KI leses ikke romnavn og tekst på tegningen. Alt regnes ut i nettleseren.';
    this.summaryEl.textContent = loading
      ? 'Leser filene …'
      : floors
        ? `${floors} ${floors === 1 ? 'plantegning' : 'plantegninger'}${facades ? ` og ${facades} ${facades === 1 ? 'fasadetegning' : 'fasadetegninger'}` : ''}. «Generer» lager 3D-huset og spør bare om det den ikke finner selv.${ai?.available ? ' En nedskalert kopi av tegningene sendes til KI-tjenesten.' : ''}`
        : 'Legg til minst én plantegning.';
  }

  _card(it, { index = null, level } = {}) {
    const floor = it.kind === 'plan';
    const why = it.error ? it.note : floor ? (this.userOrdered ? 'plassert av deg' : it.why) : null;
    const chips = h('div', { class: 'pb-chips', role: 'radiogroup', 'aria-label': 'Hva er tegningen?' },
      // a sheet with several drawings is split by generate: each drawing gets its own kind, so the sheet is only used
      // (its own kind) or left out (Annet)
      KINDS.map(([k, label]) => h('button', { class: `pb-chip${it.kind === k ? ' is-on' : ''}`, role: 'radio', 'aria-checked': String(it.kind === k), 'data-kind': k, disabled: it.loading || !!it.error || (it.multi && k !== 'other' && k !== it.autoKind), title: it.multi && k !== 'other' && k !== it.autoKind ? 'Arket deles opp, og hver tegning får sin egen type' : null, onclick: (e) => {
        e.stopPropagation();
        this.setKind(it, k);
      } }, label)));
    const grip = floor ? h('span', { class: 'pb-card-grip', title: 'Dra for å flytte etasjen', 'aria-hidden': 'true' }, '⠿') : null;
    const card = h('li', { class: `pb-card${floor ? ' is-floor' : ''}${it.loading || it.analysing ? ' is-loading' : ''}${it.kind === 'other' ? ' is-other' : ''}`, 'data-id': it.id, 'data-name': it.name },
      grip,
      it.thumb ? it.thumb : h('span', { class: 'pb-card-thumb is-empty' }),
      h('div', { class: 'pb-card-body' },
        h('div', { class: 'pb-card-name' }, h('b', {}, it.name), it.size ? h('small', {}, `${it.size.width} × ${it.size.height} px${it.render === 'scan' ? ' · skannet PDF' : it.render === 'vector' ? ' · PDF' : ''}`) : null),
        chips,
        why ? h('div', { class: 'pb-card-why' }, floor && index != null && !it.error ? h('span', { class: 'pb-card-level' }, this.userOrdered ? levelLabel(level) : it.label ?? '?') : null, why) : null,
        it.note && !it.error ? h('div', { class: 'pb-card-note' }, it.note) : null),
      h('button', { class: 'pb-card-x', title: 'Fjern tegningen', 'aria-label': `Fjern ${it.name}`, onclick: (e) => {
        e.stopPropagation();
        this.remove(it);
      } }, '×'));
    if (it.thumb) it.thumb.classList.add('pb-card-thumb');
    if (floor) this._dragFloor(card, it);
    return card;
  }

  /** A floor card is dragged by its grip or its picture: the others make room, the order is the drop place. */
  _dragFloor(card, it) {
    const start = (e) => {
      if (e.button !== 0 || this.busy) return;
      e.preventDefault();
      const list = this.listFloors;
      const y0 = e.clientY;
      let moved = false;
      card.classList.add('is-dragging');
      const move = (ev) => {
        const dy = ev.clientY - y0;
        if (!moved && Math.abs(dy) < 4) return;
        moved = true;
        // the card goes where the pointer is among the other cards' middles
        const others = [...list.children].filter((c) => c !== card && c.classList.contains('pb-card'));
        let at = others.length;
        for (let i = 0; i < others.length; i++) {
          const r = others[i].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            at = i;
            break;
          }
        }
        const ref = others[at] ?? null;
        if (card.nextSibling !== ref || (ref == null && list.lastChild !== card)) list.insertBefore(card, ref);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        card.classList.remove('is-dragging');
        if (!moved) return;
        const ids = [...list.children].map((c) => c.dataset.id).filter(Boolean);
        this.moveFloor(it, ids.indexOf(it.id));
        this.render();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    };
    card.querySelector('.pb-card-grip')?.addEventListener('pointerdown', start);
    card.querySelector('.pb-card-thumb')?.addEventListener('pointerdown', start);
  }

  _generate() {
    if (this.genBtn.disabled) return;
    this.generate();
  }

  /** The progress of «Generer» over the stack ({ done, total, text }), or null to hide it. */
  progress(p) {
    this.busy = !!p;
    this._renderFoot();
    const el = this.progressEl;
    if (!p) {
      el.hidden = true;
      el.innerHTML = '';
      this._log = null;
      return;
    }
    if (!this._log) {
      this._log = [];
      el.innerHTML = '';
      this._bar = h('div', { class: 'pb-progress-bar' }, h('span'));
      this._text = h('div', { class: 'pb-progress-text' });
      this._list = h('ol', { class: 'pb-progress-log' });
      el.append(h('div', { class: 'pb-progress-card' }, h('h2', {}, 'Lager huset …'), this._bar, this._text, this._list, h('p', { class: 'pb-note' }, 'Planen leses i nettleseren. Store tegninger tar litt tid.')));
    }
    el.hidden = false;
    const share = p.total > 0 ? Math.max(0.02, Math.min(1, p.done / p.total)) : 0.05;
    this._bar.firstChild.style.width = `${Math.round(share * 100)}%`;
    this._bar.setAttribute('role', 'progressbar');
    this._bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    if (p.text && p.text !== this._log[this._log.length - 1]) {
      this._log.push(p.text);
      this._text.textContent = p.text;
      this._list.innerHTML = '';
      for (const t of this._log.slice(-6, -1)) this._list.append(h('li', {}, t.replace(/ …$/, '')));
    }
  }
}

/** A thumbnail canvas (at most 132 × 100 CSS px). */
function thumbCanvas(bitmap) {
  if (!bitmap) return null;
  const W = 132;
  const H = 100;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const k = Math.min(W / bitmap.width, H / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * k));
  const hh = Math.max(1, Math.round(bitmap.height * k));
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(hh * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${hh}px`;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}
