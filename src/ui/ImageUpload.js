import { h, svg } from './dom.js';
import { button, slider, toggle } from './panelKit.js';
import { ICONS } from './icons.js';
import { Dialog } from './Dialog.js';
import { seg } from './inspectorKit.js';
import { getImageStore, MSG, ImageError } from '../design/ImageStore.js';
import {
  ART_CATEGORY, CUSTOM_REF, IMAGE_SIZES, LONG_EDGE_RANGE, FRAME_STYLES, MAT_COLOR, defaultChoice, frameSizesFor, choiceToSpec,
  specToChoice, imagePatch, choicePatch, uploadedName, describe, sharpness, hasImage, isUploadedImage, acceptsImage, canHoldImage,
  orientationOf, cm,
} from '../design/imageArt.js';
import { artLayout, PAPER_WHITE } from '../models/artlayout.js';
import { ndcFromClient, pickAt } from '../design/Selection.js';
import { imageInspectorExtension, fitEvenly } from './imageInspector.js';
import { customArtShoppingSection } from './customArtShopping.js';

/**
 * Own pictures («egne bilder», design/upload.md §11): the controller of the upload UI – one instance,
 * editor.ui.imageUpload (Editor creates it after the panels exist). It plugs into the panels through their hooks
 * (MASTER §2.7):
 *   catalogue   a pinned card «Last opp eget bilde» first in «Kunst og bilder» (and for searches like «eget bilde»),
 *               with «Nylig lastet opp»; «Med eget bilde …» in the detail view of a frame that takes a picture
 *   inspector   «Bilde» (ui/imageInspector.js): swap, adjust, size, frame
 *   shopping    «Egne bilder» (ui/customArtShopping.js) – never in the total
 *   window      a picture file dragged into the game: dropped on a wall → the dialog; on a picture → swap it
 *
 *   new ImageUpload(editor)
 *   images                      the picture store (editor.home.images, else design/ImageStore.js getImageStore())
 *   artCategory                 'kunst' (falls back to 'smatt' when the catalogue has no 'kunst')
 *   pickFile() → Promise<File|null>                     a file chooser (JPG, PNG, WebP)
 *   upload(file) → Promise<UploadResult|null>          images.addFile; a refused file → toast with the store's message
 *   open({ file, imageId, uid, productSpec }) → Promise<'placed'|'applied'|'cancelled'>   the dialog «Eget bilde»
 *                                (uid: edit «Tilpass bildet»; productSpec: a catalogue frame that takes a picture)
 *   place(image, choice, productSpec?) → spec           startPlacing the picture (closes the catalogue)
 *   swapImage(uid, file?) → Promise<boolean>           «Bytt bilde»: choose, upload, imageArt.imagePatch (one undo step)
 *   apply(uid, patch, label, { coalesce }) → boolean    through Inspector._fit (wall caps, constrain); keeps the aspect
 *   catalogCard({ category, query }) → HTMLElement|null
 *   update(), dispose()
 *
 * The picture is stored (IndexedDB write awaited) before the dialog shows its options, so a placed or applied item
 * never references a picture that is not saved. No network: pictures never leave the browser.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const S = (body) => `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  upload: S('<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9"/><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>'),
  picture: S('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="m3.5 16 5-5 4 4 3-3 5 5"/><circle cx="15.5" cy="9.5" r="1.5"/>'),
  flip: S('<path d="M7 7h9.5a3 3 0 0 1 3 3v1M17 17H7.5a3 3 0 0 1-3-3v-1"/><path d="m14 4 3 3-3 3M10 20l-3-3 3-3"/>'),
};

const CSS = `
.ipu-dlg { display: flex; flex-direction: column; gap: 1em; }
.ipu-grid { display: grid; grid-template-columns: minmax(0, 20em) minmax(0, 1fr); gap: 1.2em 1.6em; align-items: start; }
@media (max-width: 760px) { .ipu-grid { grid-template-columns: minmax(0, 1fr); } }
.ipu-stage { display: grid; place-items: center; height: 19em; border-radius: var(--kv-r); background:
  radial-gradient(ellipse at 50% 40%, #e9e5de 0%, #d6d0c6 70%, #c9c2b6 100%); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); overflow: hidden; }
.ipu-frame { box-sizing: border-box; display: grid; box-shadow: 0 0.35em 0.9em rgba(30, 22, 12, 0.35), 0 0.05em 0.15em rgba(30, 22, 12, 0.4); transition: all 0.18s var(--kv-ease); }
.ipu-frame.is-canvas { box-shadow: 0.25em 0.45em 0.9em rgba(30, 22, 12, 0.35), inset -0.15em -0.15em 0 rgba(0,0,0,0.12); }
.ipu-mat { display: grid; place-items: center; width: 100%; height: 100%; min-width: 0; min-height: 0; box-shadow: inset 0 0 0.25em rgba(0,0,0,0.18); }
.ipu-frame.is-canvas .ipu-mat { box-shadow: none; }
.ipu-pic { background-repeat: no-repeat; background-position: center; transition: all 0.18s var(--kv-ease); }
.ipu-file { margin-top: 0.7em; font-weight: 650; overflow-wrap: anywhere; line-height: 1.3; }
.ipu-meta { font-size: 0.8em; color: var(--kv-ink-3); line-height: 1.45; margin-top: 0.2em; }
.ipu-meta.is-strong { color: var(--kv-ink-2); font-weight: 600; font-size: 0.86em; }
.ipu-meta.is-warn { color: #ffd98a; }
.ipu-meta.is-ok { color: #9fe3bd; }
.ipu-note { font-size: 0.76em; color: var(--kv-ink-4); line-height: 1.45; margin: 0.7em 0 0; }
.ipu-right { display: flex; flex-direction: column; gap: 0.15em; min-width: 0; }
.ipu-h { margin: 0.6em 0 0.35em; font-size: 0.72em; font-weight: 750; letter-spacing: 0.09em; text-transform: uppercase; color: var(--kv-ink-3); }
.ipu-h:first-child { margin-top: 0; }
.ipu-chips { display: flex; flex-wrap: wrap; gap: 0.35em; align-items: center; }
.ipu-chip { flex: none; display: inline-flex; align-items: baseline; gap: 0.35em; height: 2.1em; padding: 0 0.75em; border-radius: 1.2em; border: 1px solid var(--kv-line);
  background: var(--kv-surface); color: var(--kv-ink-2); font: inherit; font-size: 0.84em; font-weight: 600; cursor: pointer; align-items: center; }
.ipu-chip small { font-size: 0.85em; color: var(--kv-ink-4); font-weight: 600; }
.ipu-chip:hover { background: var(--kv-surface-3); color: var(--kv-ink); }
.ipu-chip.is-active { background: var(--kv-accent-soft); border-color: rgba(255, 181, 46, 0.55); color: var(--kv-accent-2); }
.ipu-chip.is-active small { color: rgba(255, 210, 122, 0.75); }
.ipu-chip .kv-icon { width: 1.05em; height: 1.05em; align-self: center; }
.ipu-styles { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.6em, 1fr)); gap: 0.35em; }
.ipu-style { display: flex; align-items: center; gap: 0.5em; min-width: 0; padding: 0.4em 0.55em; border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line);
  background: var(--kv-surface); color: var(--kv-ink-2); font: inherit; font-size: 0.78em; font-weight: 600; text-align: left; cursor: pointer; line-height: 1.2; }
.ipu-style:hover { background: var(--kv-surface-3); color: var(--kv-ink); }
.ipu-style.is-active { border-color: rgba(255, 181, 46, 0.6); background: var(--kv-accent-soft); color: var(--kv-accent-2); }
.ipu-style__sw { flex: none; width: 1.6em; height: 1.6em; border-radius: 0.25em; box-sizing: border-box; display: grid; place-items: center; }
.ipu-style__sw i { display: block; width: 62%; height: 62%; background: #f3f0e9; border-radius: 0.06em; }
.ipu-style__sw.is-canvas { background: linear-gradient(135deg, #d9cbb4, #a99474); box-shadow: 0.08em 0.12em 0 rgba(0,0,0,0.35); }
.ipu-style__sw.is-poster { background: #f4f2ee; border: 1px solid rgba(255,255,255,0.4); }
.ipu-style span { min-width: 0; overflow-wrap: break-word; hyphens: auto; }
.ipu-row2 { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em 1em; margin-top: 0.35em; }
.ipu-row2 .ip-field { flex: 1 1 12em; padding: 0; }
.ipu-row2 .ipi-seg { margin: 0; flex: 1 1 12em; }
.ipu-right .ipi-seg { margin: 0.1em 0 0.3em; }
.ipu-right .ip-slider { margin-top: 0.25em; }
.ipu-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em; padding-top: 0.9em; border-top: 1px solid var(--kv-line); }
.ipu-foot .ipu-spacer { flex: 1; }
.ipu-busy { display: flex; align-items: center; justify-content: center; gap: 0.7em; min-height: 12em; color: var(--kv-ink-2); }
.ipu-busy .kv-spinner { width: 1.5em; height: 1.5em; }
.ipu-err { min-height: 6em; }
.ipu-card { cursor: default; border-style: dashed; border-color: rgba(255, 181, 46, 0.45); background: rgba(255, 181, 46, 0.05); }
.ipu-card:hover { border-color: rgba(255, 181, 46, 0.7); background: rgba(255, 181, 46, 0.08); }
.ipu-card__top { display: grid; place-items: center; gap: 0.3em; padding: 0.9em 0.7em 0.2em; text-align: center; color: var(--kv-accent-2); }
.ipu-card__top .kv-icon { width: 2.1em; height: 2.1em; }
.ipu-card__title { font-weight: 720; font-size: 0.95em; color: var(--kv-ink); }
.ipu-card__text { font-size: 0.76em; color: var(--kv-ink-3); line-height: 1.35; }
.ipu-card .ipc-body { align-items: stretch; text-align: center; gap: 0.45em; }
.ipu-card .kv-btn { justify-content: center; }
.ipu-card__small { font-size: 0.68em; color: var(--kv-ink-4); line-height: 1.35; }
.ipu-recent { display: flex; flex-wrap: wrap; gap: 0.3em; justify-content: center; }
.ipu-recent:empty { display: none; }
.ipu-recent button { width: 2.3em; height: 2.3em; padding: 0; border-radius: 0.3em; border: 1px solid var(--kv-line-2); overflow: hidden; cursor: pointer; background: #ddd8cf; }
.ipu-recent button:hover { border-color: var(--kv-accent); }
.ipu-recent img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ipu-recent-title { font-size: 0.68em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--kv-ink-3); }
.ipu-recent-title:empty { display: none; }
.ipu-card .ipi-warn { font-size: 0.7em; text-align: left; margin: 0; }
.ipu-drop { position: fixed; inset: 0; z-index: 60; pointer-events: none; display: grid; place-items: center; background: rgba(10, 16, 23, 0.35);
  box-shadow: inset 0 0 0 0.35em rgba(255, 181, 46, 0.65); opacity: 0; transition: opacity 0.15s; }
.ipu-drop.is-on { opacity: 1; }
.ipu-drop span { padding: 0.8em 1.3em; border-radius: var(--kv-r); background: var(--kv-glass-2); color: var(--kv-ink); font-weight: 650; box-shadow: var(--kv-shadow); }
.ipu-irow { display: grid; grid-template-columns: 4.6em minmax(0, 1fr); gap: 0.7em; align-items: center; }
.ipu-ithumb { width: 4.6em; aspect-ratio: 1; border-radius: 0.4em; overflow: hidden; display: grid; place-items: center; background: #ddd8cf; color: rgba(40,34,28,0.4); }
.ipu-ithumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ipu-ithumb .kv-icon { width: 1.8em; height: 1.8em; }
.ipu-iname { font-weight: 650; font-size: 0.88em; overflow-wrap: anywhere; line-height: 1.3; }
.ipu-isub { font-size: 0.78em; color: var(--kv-ink-3); line-height: 1.4; }
.ipu-ibtns { display: flex; flex-wrap: wrap; gap: 0.4em; margin: 0.65em 0 0.3em; }
.ipu-field-label { margin-top: 0.55em; font-size: 0.9em; color: var(--kv-ink-2); }
`;

function injectCss(id, css) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
/** Lowercase, single spaces – for matching search words. */
const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const SEARCH_WORDS = /(eget|egne) bild|last(e)? opp|opplast/;
const isFileDrag = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
/** A control's kind and text – finds «the same» control again after the dialog content is drawn anew. */
const controlKey = (el) => `${el.tagName}|${el.getAttribute?.('aria-label') || ''}|${(el.textContent || '').trim()}`;
/** The Toolbar's message while «Før» (today's house) is shown. */
const BEFORE_MSG = 'Du ser på huset slik det er i dag. Trykk O for å gå tilbake til designet ditt og endre.';
const READ_FAILED = 'Klarte ikke å lese filen – velg den på nytt.';

/** What to tell the user about a failed upload: the store's own messages, never a browser's (English) error text. */
export function uploadErrorText(err) {
  if (err instanceof ImageError || err?.name === 'ImageError') return err.message || MSG.decode;
  // the file was moved or deleted after it was chosen, or an online-only file could not be fetched
  if (err?.name === 'NotReadableError' || err?.name === 'NotFoundError') return READ_FAILED;
  return MSG.decode;
}

/** The first file of a drop that is (or claims to be) a picture. */
function pictureFileOf(dt) {
  const files = [...(dt?.files || [])];
  return files.find((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(f.name || '')) || null;
}

export class ImageUpload {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    this.editor = editor;
    this._offs = [];
    this._dialog = null;
    this._dialogApi = null;
    injectCss('ipu-css', CSS);
    const ui = editor.ui || {};
    try {
      const off = ui.catalog?.addPinned?.((ctx) => this.catalogCard(ctx));
      if (off) this._offs.push(off);
      const off2 = ui.catalog?.addDetailAction?.((ctx) => this._productAction(ctx));
      if (off2) this._offs.push(off2);
    } catch (err) {
      console.warn('[images] catalogue hooks failed', err);
    }
    try {
      this._ext = imageInspectorExtension(editor, this);
      const off = ui.inspector?.addExtension?.(this._ext);
      if (off) this._offs.push(off);
    } catch (err) {
      console.warn('[images] inspector hook failed', err);
    }
    try {
      const off = ui.shopping?.addSection?.(customArtShoppingSection({ editor }));
      if (off) this._offs.push(off);
    } catch (err) {
      console.warn('[images] shopping hook failed', err);
    }
    // «Nylig lastet opp» is read again after a new or deleted picture
    try {
      const images = this.images;
      for (const ev of ['added', 'deleted']) {
        const off = images?.on?.(ev, () => (this._recent = null));
        if (off) this._offs.push(off);
      }
    } catch (err) {
      console.warn('[images] store listener failed', err);
    }
    this._initDrop();
  }

  /** The newest stored pictures (at most 6), cached for a few seconds (every list render asks). */
  _recentList() {
    const now = performance.now();
    if (this._recent && now - this._recent.at < 4000) return this._recent.p;
    const images = this.images;
    const p = Promise.resolve()
      .then(() => images.ready?.())
      .then(() => images.list?.({ limit: 6 }) || []);
    this._recent = { at: now, p };
    return p;
  }

  /** The picture store. */
  get images() {
    return this.editor.home?.images ?? getImageStore();
  }

  /** Where uploaded pictures go in the catalogue: 'kunst', else 'smatt'. */
  get artCategory() {
    const cats = this.editor.catalog?.CATEGORIES || [];
    return cats.some((c) => c.key === ART_CATEGORY) ? ART_CATEGORY : 'smatt';
  }

  _toast(text, seconds = 3) {
    this.editor.events?.emit?.('toast', { text, seconds });
  }

  // ---- files ----------------------------------------------------------------------------------------------------

  /** A file chooser for pictures. @returns {Promise<File|null>} null when cancelled */
  pickFile() {
    if (typeof document === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: ACCEPT, style: { display: 'none' } });
      let done = false;
      const finish = (f) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(f || null);
      };
      input.addEventListener('change', () => finish(input.files?.[0] || null));
      input.addEventListener('cancel', () => finish(null));
      document.body.append(input);
      input.click();
    });
  }

  /**
   * Stores a picture (downscaled, re-encoded; the IndexedDB write is awaited).
   * @returns {Promise<object|null>} UploadResult, or null (the reason was shown as a toast)
   */
  async upload(file) {
    try {
      return await this.images.addFile(file);
    } catch (err) {
      this._toast(uploadErrorText(err), 6);
      return null;
    }
  }

  // ---- placing and changing -------------------------------------------------------------------------------------

  /**
   * Starts placing a picture: an own picture (choice) or a catalogue frame with it (productSpec).
   * @returns {object} the item spec
   */
  place(image, choice, productSpec = null) {
    const spec = productSpec
      ? { ...productSpec, params: { ...(productSpec.params || {}), motif: 'custom', imageId: image.id, imageAspect: r4(Math.max(0.2, Math.min(5, image.aspect || 1))), fit: choice?.fit === 'contain' ? 'contain' : 'cover' } }
      : choiceToSpec(choice, image, { category: this.artCategory });
    const e = this.editor;
    e.ui?.catalog?.close?.();
    e.ui?.toolbar?.exitCompare?.({ quiet: true });
    if (e.placement?.isActive) e.placement.cancel?.();
    e.startPlacing(spec);
    this._toast('Klikk på en vegg for å henge opp bildet. Shift + klikk henger opp flere.', 4);
    return spec;
  }

  /** True while «Før» (today's house) is shown: the design on screen is the original, not the user's (a toast says so). */
  _inCompare() {
    if (!this.editor.ui?.toolbar?.compareActive) return false;
    this._toast(BEFORE_MSG, 3.5);
    return true;
  }

  /**
   * Changes an item through the Inspector's fitting (wall caps, Placement.constrain): a picture too big for the wall
   * is shrunk evenly (imageInspector.fitEvenly – the shape stays). One undo step. Refused while «Før» is shown (the
   * item would be the original's, and the change would be thrown away with it).
   * @returns {boolean}
   */
  apply(uid, patch, label, { coalesce } = {}) {
    if (this._inCompare()) return false;
    const insp = this.editor.ui?.inspector;
    const fit = (p) => (insp?._fit ? insp._fit(uid, p) : { patch: p, capped: [], status: 'ok' });
    const res = fitEvenly(fit, this.editor.design.get(uid), patch);
    if (res.status === 'blocked') {
      this._toast('Bildet får ikke plass på veggen her i den størrelsen – prøv en mindre størrelse.', 4);
      return false;
    }
    this.editor.design.update(uid, res.patch, { label, ...(coalesce ? { coalesce } : {}) });
    return true;
  }

  /**
   * «Bytt bilde»: chooses (unless a file is given) and stores a picture, then puts it into the item (imagePatch).
   * @returns {Promise<boolean>}
   */
  async swapImage(uid, file = null) {
    if (!this.editor.design.get(uid) || this._inCompare()) return false;
    const f = file || (await this.pickFile());
    if (!f) return false;
    const image = await this.upload(f);
    if (!image) return false;
    const item = this.editor.design.get(uid);
    if (!item) return false;
    const ok = this.apply(uid, imagePatch(item, image), 'Bytt bilde');
    if (ok) {
      const tail = isUploadedImage(this.editor.design.get(uid)) ? ' «Tilpass …» endrer størrelse og ramme.' : '';
      this._toast(`Byttet bilde i «${item.name}» (Ctrl+Z angrer).${tail}`, 4);
      if (image.warning) setTimeout(() => this._toast(image.warning, 6), 1200);
    }
    return ok;
  }

  // ---- the dialog -----------------------------------------------------------------------------------------------

  /**
   * The dialog «Eget bilde» (new) / «Tilpass bildet» (uid): size, frame, mat and fit with a live preview.
   * @param {{ file?: File|Blob, imageId?: string, uid?: string, productSpec?: object }} [o]
   * @returns {Promise<'placed'|'applied'|'cancelled'>}
   */
  open({ file = null, imageId = null, uid = null, productSpec = null } = {}) {
    if (typeof document === 'undefined') return Promise.resolve('cancelled');
    // «Før»: an item on screen is the original's – editing it would be lost (a new picture is fine: place() leaves «Før»)
    if (uid && this._inCompare()) return Promise.resolve('cancelled');
    this._dialog?.close();
    const e = this.editor;
    const item0 = uid ? e.design.get(uid) : null;
    if (uid && !item0) return Promise.resolve('cancelled');
    if (item0 && !canHoldImage(item0)) return Promise.resolve('cancelled');
    // a catalogue frame / acoustic panel keeps its own size and look: only the picture and the fit change
    const fixed = !!productSpec || (item0 && ((item0.source === 'catalog' && acceptsImage(item0)) || item0.archetype !== 'art-frame'));
    const productOf = (spec) => (spec?.source === 'catalog' ? e.catalog?.getProduct?.(spec.refId) ?? null : null);
    const product = productOf(productSpec || item0);
    return new Promise((resolve) => {
      const st = {
        image: null,
        warning: null,
        error: null,
        loading: false,
        choice: null,
        flip: false,
        touched: false,
        result: 'cancelled',
      };
      const body = h('div.ipu-dlg', { lang: 'nb' });
      const images = this.images;
      let preview = null;
      let infoBox = null;
      let sizeChips = [];

      const finish = (result) => {
        st.result = result;
        dialog.close();
      };

      const objectUrl = () => (st.image?.id ? images.objectUrl(st.image.id) : null);

      /** The item spec the dialog shows (and places). */
      const currentSpec = () => {
        if (!st.image) return null;
        if (fixed) {
          const base = productSpec || item0;
          const fit = st.choice?.fit === 'contain' ? 'contain' : 'cover';
          return { ...base, params: { ...(base.params || {}), motif: 'custom', imageId: st.image.id, imageAspect: r4(Math.max(0.2, Math.min(5, st.image.aspect || 1))), fit } };
        }
        return choiceToSpec(st.choice, st.image, { category: item0?.category || this.artCategory });
      };

      const renderPreview = (spec) => {
        const url = objectUrl();
        const L = artLayout(spec.dims, spec.params);
        const W = spec.dims.w;
        const H = spec.dims.h;
        // em, so the preview fits the stage (19em high) at every UI scale
        const s = Math.min(16.5 / W, 16.5 / H);
        const px = (m) => `${Math.max(0, m * s).toFixed(3)}em`;
        const P = spec.params || {};
        const border = L.framed && L.frame !== 'hanger' ? L.fw + (L.lipW || 0) : 0;
        const frameCol = L.framed ? spec.colors?.frame || '#151515' : 'transparent';
        const frame = h(`div.ipu-frame${L.framed ? '' : '.is-canvas'}`, { style: { width: px(W), height: px(H), padding: px(border), background: frameCol } });
        const matBg = L.matW > 0 ? P.matColor || MAT_COLOR : L.gap > 0 ? '#0e0e0e' : PAPER_WHITE;
        const mat = h('div.ipu-mat', { style: { background: matBg } });
        const contain = L.draw === 'contain';
        const pic = h('div.ipu-pic', {
          style: {
            width: px(L.picW),
            height: px(L.picH),
            backgroundImage: url ? `url("${url}")` : 'none',
            backgroundSize: contain ? 'contain' : 'cover',
            backgroundColor: contain ? PAPER_WHITE : '#d9d4cc',
          },
        });
        mat.append(pic);
        frame.append(mat);
        return frame;
      };

      const renderInfo = (spec) => {
        const img = st.image;
        const d = describe(spec);
        const kids = [h('div.ipu-file', { text: img.name || 'Bilde' })];
        if (img.w && img.h) {
          const stored = `${img.w} × ${img.h} px`;
          kids.push(h('div.ipu-meta', { text: img.origW > img.w || img.origH > img.h ? `${img.origW} × ${img.origH} px → lagres som ${stored}` : stored }));
        }
        kids.push(h('div.ipu-meta.is-strong', { text: `${d.picText} · ${d.outerText}` }));
        if (d.fitText) kids.push(h('div.ipu-meta', { text: d.fitText === 'beskåret' ? 'Kantene av bildet skjæres bort' : 'Hele bildet vises' }));
        const longPx = Math.max(img.origW || img.w || 0, img.origH || img.h || 0);
        if (longPx > 0) {
          const sh = sharpness(longPx, Math.max(d.picW, d.picH));
          kids.push(h(`div.ipu-meta${sh.warn ? '.is-warn' : sh.ppi >= 150 ? '.is-ok' : ''}`, { text: sh.text }));
        }
        if (st.warning) kids.push(h('p.ipi-warn', {}, svg(ICONS.warning), h('span', { text: st.warning })));
        if (fixed && product) kids.push(h('p.ipu-note', { text: `Rammen fra ${product.store} står i handlelisten.` }));
        kids.push(h('p.ipu-note', { text: 'Bildet lagres i denne nettleseren, ikke på nett. Posisjonsdata fra kameraet fjernes. Eksporter designet til fil for å ta det med til en annen maskin.' }));
        return kids;
      };

      /** Preview, info and chip highlights only (keeps a slider that is being dragged). */
      const renderLive = () => {
        const spec = currentSpec();
        if (!spec || !preview) return;
        preview.replaceChildren(renderPreview(spec));
        infoBox.replaceChildren(...renderInfo(spec));
        for (const [chip, long] of sizeChips) chip.classList.toggle('is-active', st.choice.mode === 'image' && Math.abs((st.choice.long ?? 0) - long) < 0.005);
      };

      const setChoice = (patch, { full = true } = {}) => {
        st.choice = { ...st.choice, ...patch };
        st.touched = true;
        if (full) render();
        else renderLive();
      };

      const aspectsDiffer = (spec) => {
        const L = artLayout(spec.dims, { ...spec.params, fit: 'cover' });
        return Math.abs(Math.log((st.image.aspect || 1) / (L.openW / L.openH))) > 0.01;
      };

      const controls = () => {
        const kids = [];
        const c = st.choice;
        const spec = currentSpec();
        if (!fixed) {
          kids.push(h('div.ipu-h', { text: 'Størrelse' }));
          kids.push(seg([['image', 'Etter bildet'], ['frame', 'Standard rammestørrelse']], c.mode, (v) => {
            const patch = { mode: v };
            if (v === 'frame' && !c.frameSize) patch.frameSize = defaultChoice(st.image).frameSize;
            setChoice(patch);
          }));
          sizeChips = [];
          if (c.mode === 'image') {
            const chips = IMAGE_SIZES.map((sz) => {
              const b = h('button.ipu-chip', { type: 'button', on: { click: () => {
                setChoice({ long: sz.long }, { full: false });
                sl.set(sz.long);
              } } }, h('span', { text: sz.label }), h('small', { text: `${cm(sz.long)} cm` }));
              sizeChips.push([b, sz.long]);
              return b;
            });
            const sl = slider({
              label: 'Lengste side',
              min: LONG_EDGE_RANGE[0],
              max: LONG_EDGE_RANGE[1],
              step: 0.01,
              value: c.long ?? 0.5,
              format: (v) => `${cm(v)} cm`,
              onInput: (v) => setChoice({ long: v }, { full: false }),
              onChange: (v) => setChoice({ long: v }, { full: false }),
            });
            kids.push(h('div.ipu-chips', {}, chips), sl.el);
          } else {
            const list = frameSizesFor(st.image.aspect, { flip: st.flip });
            const cur = c.frameSize;
            const chips = list.map((fs) => h(`button.ipu-chip${cur && Math.abs(cur.w - fs.w) < 1e-6 && Math.abs(cur.h - fs.h) < 1e-6 ? '.is-active' : ''}`, {
              type: 'button',
              on: { click: () => setChoice({ frameSize: fs }) },
            }, h('span', { text: fs.label.replace(' cm', '') })));
            const flip = h('button.ipu-chip', { type: 'button', title: 'Snu rammen (stående / liggende)', on: { click: () => {
              st.flip = !st.flip;
              const next = frameSizesFor(st.image.aspect, { flip: st.flip });
              const same = next.find((fs) => cur && Math.abs(fs.w - cur.h) < 1e-6 && Math.abs(fs.h - cur.w) < 1e-6) || next.find((fs) => Math.abs(Math.max(fs.w, fs.h) - 0.7) < 1e-6) || next[0];
              setChoice({ frameSize: same });
            } } }, svg(IC.flip), h('span', { text: 'Snu' }));
            if (cur && !list.some((fs) => Math.abs(cur.w - fs.w) < 1e-6 && Math.abs(cur.h - fs.h) < 1e-6)) {
              chips.unshift(h('button.ipu-chip.is-active', { type: 'button' }, h('span', { text: cur.label.replace(' cm', '') })));
            }
            kids.push(h('div.ipu-chips', {}, chips, flip));
          }
        }
        // crop or show the whole picture: a frame opening of another shape than the picture
        const style = FRAME_STYLES[c.style] || FRAME_STYLES.svart;
        const canFit = fixed ? spec && aspectsDiffer(spec) : c.mode === 'frame' && !style.canvas && !(style.frame === 'none' && !c.mat) && spec && aspectsDiffer(spec);
        if (canFit) {
          kids.push(h('div.ipu-h', { text: 'Tilpasning' }));
          const sg = seg([['cover', 'Beskjær'], ['contain', 'Hele bildet']], c.fit === 'contain' ? 'contain' : 'cover', (v) => setChoice({ fit: v }));
          sg.children[0].title = 'Bildet fyller rammen – kantene skjæres bort';
          sg.children[1].title = 'Hele bildet vises – med passepartout eller hvit kant';
          kids.push(sg);
        }
        if (!fixed) {
          kids.push(h('div.ipu-h', { text: 'Ramme' }));
          kids.push(h('div.ipu-styles', {}, Object.entries(FRAME_STYLES).map(([k, s]) => {
            const sw = s.canvas ? h('span.ipu-style__sw.is-canvas') : s.frame === 'none' ? h('span.ipu-style__sw.is-poster')
              : h('span.ipu-style__sw', { style: { background: s.color || '#151515' } }, h('i'));
            return h(`button.ipu-style${k === c.style ? '.is-active' : ''}`, {
              type: 'button',
              title: s.label,
              on: { click: () => k !== c.style && setChoice({ style: k, mat: s.mat === true, texture: s.texture }) },
              // a soft hyphen lets the long compound break as «skyggefuge-/ramme» in the narrow card
            }, sw, h('span', { text: s.label.replace('skyggefugeramme', 'skyggefuge­ramme') }));
          })));
          if (style.mat !== null) {
            const row = h('div.ipu-row2');
            row.append(toggle({ label: 'Passepartout', value: !!c.mat, onChange: (v) => setChoice({ mat: v }) }).el);
            if (!style.canvas) {
              const tex = c.texture === 'paper' || c.texture === 'photo' ? c.texture : style.texture;
              row.append(seg([['photo', 'Fotopapir'], ['paper', 'Matt papir']], tex, (v) => setChoice({ texture: v })));
            }
            kids.push(h('div.ipu-h', { text: 'Passepartout og overflate' }), row);
          }
        }
        if (fixed && !canFit) {
          kids.push(h('p.ipu-note', { text: product ? `Størrelse og ramme er ${product.name} sine. Bildet fyller åpningen i rammen.` : 'Bildet fyller flaten.' }));
        }
        return kids;
      };

      const footer = () => {
        const other = button({ label: 'Velg et annet bilde …', variant: 'ghost', onClick: async () => {
          const f = await this.pickFile();
          if (f) setFile(f);
        } });
        const cancel = button({ label: 'Avbryt', variant: 'ghost', onClick: () => finish('cancelled') });
        const kids = [other, h('span.ipu-spacer'), cancel];
        if (st.image && !st.error && !st.loading) {
          const primary = button({ label: uid ? 'Bruk' : 'Plasser på veggen', variant: 'primary', onClick: () => commit() });
          primary.dataset.primary = '1';
          kids.push(primary);
        }
        return h('div.ipu-foot', {}, kids);
      };

      /** The focused control of the content (its kind and text survive a full render), and whether a key put it there. */
      const focusOf = () => {
        const a = document.activeElement;
        if (!a || !body.contains(a)) return null;
        let kb = false;
        try {
          kb = a.matches(':focus-visible');
        } catch {
          kb = false;
        }
        return { kb, key: controlKey(a) };
      };
      /** After a full render: the same control again after a keyboard choice, else the dialog (Enter and Esc work). */
      const restoreFocus = (f) => {
        if (!f || dialog.closed || body.contains(document.activeElement)) return;
        const el = f.kb ? [...body.querySelectorAll('button, input, select, a[href]')].find((x) => controlKey(x) === f.key) : null;
        (el || dialog.panel).focus({ preventScroll: true });
      };

      const render = () => {
        if (dialog?.closed) return;
        const f = focusOf();
        draw();
        restoreFocus(f);
      };

      const draw = () => {
        preview = null;
        infoBox = null;
        sizeChips = [];
        if (st.loading) {
          body.replaceChildren(h('div.ipu-busy', {}, h('span.kv-spinner'), h('span', { text: 'Leser bildet …' })));
          return;
        }
        if (st.error || !st.image) {
          body.replaceChildren(h('div.ipu-err', {}, h('p.ipi-warn', {}, svg(ICONS.warning), h('span', { text: st.error || 'Velg et bilde.' }))), footer());
          return;
        }
        const spec = currentSpec();
        preview = h('div.ipu-stage', {}, renderPreview(spec));
        infoBox = h('div');
        infoBox.append(...renderInfo(spec));
        body.replaceChildren(h('div.ipu-grid', {}, h('div.ipu-left', {}, preview, infoBox), h('div.ipu-right', {}, controls())), footer());
        renderLive();
      };

      const setFile = async (f) => {
        st.loading = true;
        st.error = null;
        render();
        let res = null;
        try {
          res = await images.addFile(f);
        } catch (err) {
          st.error = uploadErrorText(err);
        }
        st.loading = false;
        if (res) {
          const changed = st.image?.id !== res.id;
          st.image = res;
          st.warning = res.warning || null;
          if (!st.choice) st.choice = item0 ? (fixed ? { fit: item0.params?.fit === 'contain' ? 'contain' : 'cover' } : specToChoice(item0)) : defaultChoice(res);
          else if (changed && !fixed && st.choice.mode === 'frame' && orientationOf(res.aspect) !== orientationOf(st.choice.frameSize.w / st.choice.frameSize.h) && !item0) {
            // a new picture of the other orientation: the same frame size, turned
            const fs = st.choice.frameSize;
            st.choice = { ...st.choice, frameSize: frameSizesFor(res.aspect).find((x) => Math.abs(x.w - fs.h) < 1e-6 && Math.abs(x.h - fs.w) < 1e-6) || defaultChoice(res).frameSize };
            st.flip = false;
          }
          if (changed && item0) st.touched = true;
        }
        render();
      };

      const setImageId = async (id) => {
        st.loading = true;
        render();
        try {
          await images.load([id], { decode: false });
        } catch {
          /* missing → below */
        }
        st.loading = false;
        const info = images.info(id);
        const P = item0?.params || {};
        if (info) st.image = { ...info };
        else if (item0 && P.imageId === id) st.image = { id, aspect: P.imageAspect || 1, name: '', w: 0, h: 0, origW: 0, origH: 0 };
        else st.error = 'Bildet finnes ikke lenger i denne nettleseren. Velg det på nytt.';
        if (st.image && !st.choice) st.choice = item0 ? (fixed ? { fit: P.fit === 'contain' ? 'contain' : 'cover' } : specToChoice(item0)) : defaultChoice(st.image);
        render();
      };

      const commit = () => {
        const spec = currentSpec();
        if (!spec) return;
        if (!uid) {
          st.result = 'placed';
          dialog.close();
          this.place(st.image, st.choice, fixed ? productSpec : null);
          return;
        }
        const item = e.design.get(uid);
        if (!item) {
          finish('cancelled');
          return;
        }
        let patch;
        let label = 'Endre bilde';
        if (fixed) {
          patch = { params: { motif: 'custom', imageId: st.image.id, imageAspect: spec.params.imageAspect, fit: spec.params.fit } };
          // a panel that does not take a picture as a product becomes an own picture
          if (!(item.source === 'catalog' && acceptsImage(item)) && !isUploadedImage(item)) {
            const conv = imagePatch(item, st.image);
            patch = { ...conv, params: { ...conv.params, fit: spec.params.fit } };
            label = 'Bytt til eget bilde';
          }
        } else if (isUploadedImage(item)) {
          patch = choicePatch(item, st.image, st.choice);
          if (st.image.id !== item.params.imageId) patch.name = uploadedName(st.image.name);
        } else if (!st.touched) {
          patch = imagePatch(item, st.image);
          label = 'Bytt til eget bilde';
        } else {
          // a painting / poster turned into an own picture with the chosen size and frame
          patch = { source: 'custom', refId: CUSTOM_REF, name: uploadedName(st.image.name), category: item.category || this.artCategory, ...choicePatch(item, st.image, st.choice) };
          patch.name = uploadedName(st.image.name);
          label = 'Bytt til eget bilde';
        }
        if (this.apply(uid, patch, label)) {
          st.result = 'applied';
          dialog.close();
          this._toast(`${label === 'Endre bilde' ? 'Endret' : 'Byttet til eget bilde i'} «${item.name}» (Ctrl+Z angrer)`, 3);
        }
      };

      // a picture file dropped on the dialog replaces the picture
      body.addEventListener('dragover', (ev) => {
        if (!isFileDrag(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'copy';
      });
      body.addEventListener('drop', (ev) => {
        if (!isFileDrag(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
        // the window's drop handler does not see this drop: take the overlay away here (a drop sends no dragleave)
        this._hideDrop();
        const f = pictureFileOf(ev.dataTransfer);
        if (f) setFile(f);
        else this._toast(MSG.type, 4);
      });

      const release = e.game?.blockInput?.('dialog') ?? null;
      const root = e.uiRoot || document.getElementById('ui-root') || document.body;
      const wrap = h('div.kv-scale.ip-dialog-host');
      root.append(wrap);
      const title = item0 ? (fixed ? 'Eget bilde i rammen' : 'Tilpass bildet') : 'Eget bilde';
      const dialog = new Dialog(wrap, {
        title,
        icon: 'palette',
        size: 'lg',
        content: body,
        onClose: () => {
          release?.();
          this._hideDrop();
          setTimeout(() => wrap.remove(), 250);
          if (this._dialog === dialog) {
            this._dialog = null;
            this._dialogApi = null;
          }
          resolve(st.result);
        },
      });
      // Enter = the primary button (not in a text field, select or on another button). On the panel, not the content:
      // the dialog focuses its panel when it opens (and after a full render that replaced the focused control)
      dialog.panel.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || ev.repeat) return;
        const t = ev.target;
        if (t?.tagName === 'BUTTON' || t?.tagName === 'SELECT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'A' || (t?.tagName === 'INPUT' && t.type !== 'range')) return;
        const p = body.querySelector('[data-primary]');
        if (p) {
          ev.preventDefault();
          p.click();
        }
      });
      this._dialog = dialog;
      this._dialogApi = { setFile };
      if (file) setFile(file);
      else if (imageId) setImageId(imageId);
      else if (item0 && hasImage(item0)) setImageId(item0.params.imageId);
      else {
        st.error = null;
        render();
        this.pickFile().then((f) => {
          if (f) setFile(f);
          else if (!st.image) finish('cancelled');
        });
      }
    });
  }

  // ---- catalogue -------------------------------------------------------------------------------------------------

  /** The pinned card «Last opp eget bilde» (art category without a search, or a search for own pictures). */
  catalogCard({ category, query } = {}) {
    const q = fold(query);
    if (q ? !SEARCH_WORDS.test(q) : category !== this.artCategory) return null;
    const images = this.images;
    const choose = button({ label: 'Velg bilde …', variant: 'primary', size: 'sm', title: 'Velg et bilde fra maskinen din', onClick: async (ev) => {
      ev.stopPropagation();
      const f = await this.pickFile();
      if (f) this.open({ file: f });
    } });
    const recentTitle = h('div.ipu-recent-title');
    const recent = h('div.ipu-recent');
    const warnSlot = h('div');
    const card = h('article.ipc-card.ipu-card', { 'aria-label': 'Last opp eget bilde', on: { click: (ev) => {
      // the whole card is the target: a click outside its buttons chooses a picture too
      if (!ev.target.closest('button')) choose.click();
    } } },
      h('div.ipu-card__top', {}, svg(IC.upload), h('div.ipu-card__title', { text: 'Last opp eget bilde' }),
        h('div.ipu-card__text', { text: 'Heng opp dine egne bilder. Du velger størrelse og ramme.' })),
      h('div.ipc-body', {}, choose, h('div.ipu-card__small', { text: 'JPG, PNG eller WebP · du kan også dra en bildefil inn i vinduet' }), recentTitle, recent, warnSlot));
    // recent uploads and the storage warning come in when the store has answered
    this._recentList()
      .then((list) => {
        if (!card.isConnected && !card.parentNode) return;
        if (list?.length) {
          recentTitle.textContent = 'Nylig lastet opp';
          recent.replaceChildren(...list.map((info) => {
            const url = images.objectUrl(info.id);
            return h('button', { type: 'button', title: info.name || 'Bilde', 'aria-label': `Bruk ${info.name || 'bildet'}`, on: { click: (ev) => {
              ev.stopPropagation();
              this.open({ imageId: info.id });
            } } }, url ? h('img', { src: url, alt: '', draggable: false }) : svg(IC.picture));
          }));
        }
        if (!images.persistent) warnSlot.replaceChildren(h('p.ipi-warn', {}, svg(ICONS.warning), h('span', { text: 'Bilder lagres bare til fanen lukkes (nettleseren tillater ikke lagring).' })));
      })
      .catch((err) => console.warn('[images] recent pictures failed', err));
    return card;
  }

  /** «Med eget bilde …» in the detail view of a catalogue frame that takes a picture. */
  _productAction({ product, vi } = {}) {
    if (!product || !acceptsImage(product)) return null;
    return button({ label: 'Med eget bilde …', title: 'Heng opp rammen med ditt eget bilde i', onClick: async () => {
      const f = await this.pickFile();
      if (!f) return;
      const spec = this.editor.catalog?.productToItemSpec?.(product, vi);
      if (spec) this.open({ file: f, productSpec: spec });
    } });
  }

  // ---- drag and drop --------------------------------------------------------------------------------------------

  _initDrop() {
    if (typeof window === 'undefined') return;
    this._overlay = null;
    this._dropAt = 0;
    this._dropItem = null;
    this._onDragOver = (ev) => {
      if (!isFileDrag(ev)) return;
      // never let the browser open the file instead of the game
      ev.preventDefault();
      if (!this._canDrop()) {
        ev.dataTransfer.dropEffect = 'none';
        return;
      }
      ev.dataTransfer.dropEffect = 'copy';
      this._showDrop(ev.clientX, ev.clientY, ev.target);
    };
    this._onDragLeave = (ev) => {
      if (ev.relatedTarget == null || ev.clientX <= 0 || ev.clientY <= 0 || ev.clientX >= window.innerWidth || ev.clientY >= window.innerHeight) this._hideDrop();
    };
    this._onDrop = (ev) => {
      if (!isFileDrag(ev)) return;
      ev.preventDefault();
      this._hideDrop();
      const f = pictureFileOf(ev.dataTransfer);
      if (this._dialog && this._dialogApi) {
        if (f) this._dialogApi.setFile(f);
        return;
      }
      if (!this._canDrop()) return;
      if (!f) {
        this._toast(MSG.type, 4);
        return;
      }
      const item = this._itemAt(ev.clientX, ev.clientY, { force: true, target: ev.target });
      if (item) this.open({ file: f, uid: item.uid });
      else this.open({ file: f });
    };
    window.addEventListener('dragover', this._onDragOver);
    window.addEventListener('dragleave', this._onDragLeave);
    window.addEventListener('drop', this._onDrop);
  }

  _canDrop() {
    const g = this.editor.game;
    return !!g && g.running !== false && !g.paused;
  }

  /**
   * The picture-holding item under a screen point that a dropped file swaps the picture of (picked at most 10 times a
   * second). Only what the player sees: walls and other items hide what is behind them (Selection.pickAt), a point
   * over a panel (target not the 3D view) is no item, and while «Før» is shown nothing is (those are the original's).
   * @param {number} x
   * @param {number} y
   * @param {{ force?: boolean, target?: EventTarget|null }} [o]
   */
  _itemAt(x, y, { force = false, target = null } = {}) {
    const canvas = this.editor.renderer?.domElement;
    if (!canvas || this.editor.ui?.toolbar?.compareActive || (target && target !== canvas)) {
      this._dropItem = null;
      return null;
    }
    const now = performance.now();
    if (!force && now - this._dropAt < 100) return this._dropItem;
    this._dropAt = now;
    let item = null;
    try {
      const hit = pickAt(this.editor, ndcFromClient(canvas, x, y));
      const it = hit?.kind === 'item' && hit.uid ? this.editor.design.get(hit.uid) : null;
      item = it && canHoldImage(it) ? it : null;
    } catch {
      item = null;
    }
    this._dropItem = item;
    return item;
  }

  _showDrop(x, y, target = null) {
    if (!this._overlay) {
      this._overlay = h('div.ipu-drop', {}, h('span'));
      (this.editor.uiRoot || document.body).append(this._overlay);
    }
    const item = this._dialog ? null : this._itemAt(x, y, { target });
    const text = this._dialog ? 'Slipp bildet for å bruke det' : item ? `Slipp for å bytte bildet i «${item.name}»` : 'Slipp bildet for å henge det opp';
    const span = this._overlay.firstChild;
    if (span.textContent !== text) span.textContent = text;
    this._overlay.classList.add('is-on');
  }

  _hideDrop() {
    this._overlay?.classList.remove('is-on');
    this._dropItem = null;
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------

  update() {}

  dispose() {
    for (const off of this._offs.splice(0)) {
      try {
        off?.();
      } catch {
        /* already gone */
      }
    }
    this._ext?.dispose?.();
    this._dialog?.close();
    if (typeof window !== 'undefined' && this._onDrop) {
      window.removeEventListener('dragover', this._onDragOver);
      window.removeEventListener('dragleave', this._onDragLeave);
      window.removeEventListener('drop', this._onDrop);
    }
    this._overlay?.remove();
    this._overlay = null;
  }
}

export default ImageUpload;
