/**
 * Planbygger – the page (planbygger.html). Two ways in:
 *
 *   «Generer» (round 1, notes/planbygger-runde1-design.md): the start page «Slipp alle tegningene her» takes every
 *   drawing at once (plans, facades, a sheet with several, a phone photo, PDF pages) → the drawing stack (stack.js:
 *   floors top first, a chip per drawing, drag to reorder) → «Generer» (generate.js; its heavy steps in the worker via
 *   opts.exec, the AI through ai.js when the server has it) with its progress → the guide (guide.js: only the questions
 *   it could not answer) → straight into 3D. «Finjuster» opens the editor below on the generated document.
 *
 *   The v1 editor: upload one floor plan, set the scale, get the walls, doors and windows proposed automatically
 *   (classical image processing – detect.js), correct them in the 2D editor (editor.js), walk around the 3D house
 *   (viewer.js, the game's own builders) and download the house data (export.js, the research/house format the game
 *   validates with validateHouse).
 *
 * The detection runs in the browser. The AI (when the server offers it) gets a scaled-down copy of a drawing to read
 * text and symbols; without it everything still works, with more questions. The document is saved in localStorage
 * (without the images) and the plan images in IndexedDB, so a reload continues where you left off.
 */
import './style.css';
import demoPlanUrl from '../../plantegning.png?url';
import { createDoc, createLevel, applyDetection, history, rescaleLevel, ROOM_KINDS, DEFAULT_SETTINGS, wallLength, splitWall, checkLevel, stairGeometry, OPENING_KINDS, openingKind, setOpeningKind } from './model.js';
import { Editor, TOOL_HINT } from './editor.js';
import { exportHouse, summary, ownerOnly, baseSpec, alignLevel } from './export.js';
import { luma, rotateImage } from './image.js';
import { traceLine } from './scale.js';
import { detectPlan, estimateSkew } from './detect.js';
import { suggestScale } from './scale.js';
import { round, slug, add, sub } from './geom.js';
import { generate, applyAnswers } from './generate.js';
import { DrawingStack, FILE_ACCEPT, renderPdf } from './stack.js';
import { Guide } from './guide.js';
import { aiStatus, aiRead } from './ai.js';

const STORE_KEY = 'planbygger.v1.doc';
/** «Meld feil» reports the dev server did not take yet (IndexedDB key; sent on the next start or report). */
const REPORT_QUEUE = 'planbygger.report-queue';
const DB_NAME = 'planbygger';

// ---------------------------------------------------------------------------------------------------------------
// tiny DOM helpers

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');
/** An estimated skew in degrees; below 0.1° the image is left as it is (no resampling for nothing). */
const skewOf = (deg) => (Number.isFinite(deg) && Math.abs(deg) >= 0.1 ? deg : 0);
const num = (s) => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

const ICONS = {
  select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3l13 8-6 1.5L9 19z"/></svg>',
  wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="9" width="18" height="6" fill="currentColor" opacity=".35"/><path d="M3 9h18M3 15h18"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20h4M17 20h4M7 20V6"/><path d="M7 6a14 14 0 0 1 10 14" stroke-dasharray="2.5 2"/></svg>',
  window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="9" width="18" height="6"/><path d="M3 12h18"/></svg>',
  opening: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h5M17 12h5"/><path d="M7 9v6M17 9v6" /><path d="M9 12h6" stroke-dasharray="2 2"/></svg>',
  room: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 12h8M12 8v8"/></svg>',
  stair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="3" width="12" height="18"/><path d="M6 7h12M6 11h12M6 15h12M12 5v14M9.5 16.5L12 19l2.5-2.5"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};
const TOOLS = [
  ['select', 'Velg og flytt', 'V'],
  ['wall', 'Ny vegg', 'W'],
  ['door', 'Dør', 'D'],
  ['window', 'Vindu', 'F'],
  ['opening', 'Åpning uten dør', 'O'],
  ['room', 'Navngi rom', 'R'],
  ['stair', 'Trapp ned til etasjen under', 'T'],
  ['scale', 'Skala', 'S'],
  ['pan', 'Flytt visningen', 'H'],
];
const STEPS = [
  ['upload', 'Last opp'],
  ['scale', 'Skala'],
  ['edit', 'Rett opp'],
  ['3d', 'Gå rundt'],
];

// ---------------------------------------------------------------------------------------------------------------
// storage: the document in localStorage, the images in IndexedDB

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key, blob) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put(blob, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn('[planbygger] kunne ikke lagre bildet', err);
  }
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('images', 'readonly');
      const q = tx.objectStore('images').get(key);
      q.onsuccess = () => res(q.result ?? null);
      q.onerror = () => rej(q.error);
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the worker

let worker = null;
let workerSeq = 0;
const pending = new Map();
function ensureWorker() {
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        for (const p of pending.values()) p.reject(new Error(e.message || 'arbeideren feilet'));
        pending.clear();
        worker = null;
      };
    }
  } catch {
    worker = null;
  }
  return worker;
}
function runWorker(kind, img, opts) {
  if (!ensureWorker()) {
    // no module workers: on the main thread
    return Promise.resolve().then(async () => {
      if (kind === 'detect') return detectPlan(img, opts);
      if (kind === 'skew') return estimateSkew(img);
      if (kind === 'rotate') return rotateImage(img, opts.deg);
      if (kind === 'analyse') {
        const [{ splitSheet }, { isPhoto }] = await Promise.all([import('./sheet.js'), import('./photo.js')]);
        return { blocks: splitSheet(img).blocks, photo: isPhoto(img) };
      }
      return suggestScale(img);
    });
  }
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, kind, img: { width: img.width, height: img.height, data: img.data }, opts });
  });
}
/**
 * generate.js's executor (opts.exec) in the worker: one heavy step with generate's own arguments (worker.js EXEC).
 * Without a worker – or when an argument cannot be posted – generate runs the step itself (null: no executor).
 */
function workerExecutor() {
  if (!ensureWorker()) return null;
  return (name, ...args) => {
    const id = ++workerSeq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, kind: 'exec', name, args });
      } catch (err) {
        // (an argument that cannot be cloned): the same step here
        pending.delete(id);
        console.warn(`[planbygger] ${name} kjøres uten arbeideren: ${err?.message ?? err}`);
        import('./worker.js').then((m) => resolve(m.runExec(name, args)), reject);
      }
    });
  };
}

// ---------------------------------------------------------------------------------------------------------------
// the page

class App {
  constructor(root) {
    this.root = root;
    this.doc = null;
    this.li = 0;
    this.images = new Map(); // level id → { bitmap, imageData, grey, rotation, original: { bitmap, imageData } }
    this.hist = history(120);
    this.sel = null;
    this.viewer = null;
    this.thickness = 0.1;
    this._build();
    this._restore();
    this._sendReports();
  }

  get level() {
    return this.doc?.levels[this.li] ?? null;
  }
  get image() {
    return this.level ? this.images.get(this.level.id)?.bitmap ?? null : null;
  }

  // ---- layout
  _build() {
    const r = this.root;
    this.stepEls = {};
    const steps = h('nav', { class: 'pb-steps' },
      STEPS.map(([id, label], i) => (this.stepEls[id] = h('button', { class: 'pb-step', onclick: () => this._goStep(id) }, h('b', {}, i + 1), label))));
    this.nameInput = h('input', { class: 'pb-name-input', type: 'text', placeholder: 'Navn på huset', onchange: (e) => {
      if (!this.doc) return;
      this.snapshot();
      this.doc.name = e.target.value || 'Mitt hus';
      this.changed('Navn');
    } });
    this.undoBtn = h('button', { class: 'pb-btn', title: 'Angre (Ctrl+Z)', onclick: () => this.undo() }, 'Angre');
    this.redoBtn = h('button', { class: 'pb-btn', title: 'Gjør om (Ctrl+Y)', onclick: () => this.redo() }, 'Gjør om');
    this.walkBtn = h('button', { class: 'pb-btn is-primary', onclick: () => this.open3d() }, 'Gå rundt i 3D');
    // the game's validator after every change (debounced): a pill with the number of errors
    this.checkPill = h('button', { class: 'pb-pill', hidden: true, title: 'Spillets kontroll av huset – klikk for detaljer', onclick: () => this._showCheck() }, '');
    this.menuBtn = h('select', { class: 'pb-btn', title: 'Fil', onchange: (e) => {
      const v = e.target.value;
      e.target.value = '';
      this._menu(v);
    } },
    h('option', { value: '' }, 'Fil …'),
    h('option', { value: 'house' }, 'Last ned husfil (JSON)'),
    h('option', { value: 'project' }, 'Last ned prosjektet'),
    h('option', { value: 'open' }, 'Åpne prosjekt …'),
    h('option', { value: 'new' }, 'Ny plan'));
    const top = h('header', { class: 'pb-top' },
      h('div', { class: 'pb-brand' }, 'Planbygger', h('small', {}, 'Interiørspillet')),
      this.nameInput, steps,
      h('div', { class: 'pb-actions' }, this.checkPill, this.undoBtn, this.redoBtn, this.menuBtn, this.walkBtn));
    // «Meld feil» floats above the start page, the stack, the guide and 3D (they cover the top bar)
    document.body.append(h('button', { class: 'pb-report-fab', title: 'Meld en feil eller en idé: skjermbilde og én setning, lagret lokalt', onclick: () => this._report() }, 'Meld feil'));

    this.toolEls = {};
    const tools = h('aside', { class: 'pb-tools' },
      TOOLS.map(([id, label, key]) => (this.toolEls[id] = h('button', { class: 'pb-tool', title: `${label} (${key})`, html: `${ICONS[id]}<kbd>${key}</kbd>`, onclick: () => this.setTool(id) }))),
      h('hr'),
      h('button', { class: 'pb-tool', title: 'Hele planen (0)', html: `${ICONS.fit}<kbd>0</kbd>`, onclick: () => this.editor?.fit() }),
      h('button', { class: 'pb-tool', title: 'Hurtigtaster (?)', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/></svg>', onclick: () => this._help() }));

    this.canvas = h('canvas', { class: 'pb-canvas2d' });
    this.hintEl = h('div', { class: 'pb-hint' });
    this.scaleBox = h('div', { class: 'pb-scalebox', hidden: true });
    this.busyEl = h('div', { class: 'pb-busy', hidden: true });
    this.view3d = h('div', { class: 'pb-view3d', hidden: true });
    this.startEl = h('div', { class: 'pb-start' });
    this.stage = h('section', { class: 'pb-stage' }, this.canvas, this.hintEl, this.scaleBox, this.busyEl, this.view3d, this.startEl);
    this.side = h('aside', { class: 'pb-side' });
    this.statusPos = h('span', {}, '');
    this.statusMsg = h('span', {}, '');
    this.statusInfo = h('span', {}, 'Alt kjøres i nettleseren – planen sendes ingen steder.');
    const status = h('footer', { class: 'pb-status' }, this.statusPos, this.statusMsg, this.statusInfo);
    r.append(top, h('main', { class: 'pb-main' }, tools, this.stage, this.side), status);

    this.editor = new Editor(this.canvas, this);
    this.fileInput = h('input', { type: 'file', class: 'pb-file-one', accept: 'image/png,image/jpeg,image/webp,image/avif,application/pdf', style: 'display:none', onchange: (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this._onFile(f, this._pendingLevel);
    } });
    this.projectInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this._openProject(f);
    } });
    // «Generer»: every drawing at once (the accept list names no image type, so the one-plan field above stays the
    // only image/png field)
    this.filesInput = h('input', { type: 'file', class: 'pb-files', multiple: true, accept: FILE_ACCEPT, style: 'display:none', onchange: (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      const pick = this._pendingPick;
      this._pendingPick = null;
      if (pick) pick(files);
      else if (files.length) this._addDrawings(files);
    } });
    r.append(this.fileInput, this.projectInput, this.filesInput);
    // common room names for the Rom dialog
    r.append(h('datalist', { id: 'pb-room-names' }, ['Stue', 'Kjøkken', 'Stue/kjøkken', 'Spisestue', 'Soverom', 'Hovedsoverom', 'Barnerom', 'Gjesterom', 'Bad', 'Toalett', 'Vaskerom', 'Gang', 'Entré', 'Bod', 'Kontor', 'Kjellerstue', 'Garderobe', 'Trapperom'].map((n) => h('option', { value: n }))));

    window.addEventListener('keydown', (e) => this._key(e));
    window.addEventListener('keyup', (e) => this.editor?.key(e));
    // drop anywhere
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      // on the start page and the drawing stack: all of them into the stack; in the editor: the level's plan (v1)
      if (!this.startEl.hidden && !this.guide) this._addDrawings(files);
      else if (this.startEl.hidden) this._onFile(files[0], this.doc && this.level?.image ? null : undefined);
    });
  }

  _renderStart(saved) {
    const s = this.startEl;
    this.guide?.dispose();
    this.guide = null;
    this.stack = null;
    s.innerHTML = '';
    s.classList.remove('is-wide');
    const drop = h('div', { class: 'pb-drop', role: 'button', tabindex: '0', onclick: () => this._pickDrawings(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && this._pickDrawings() },
      h('strong', {}, 'Slipp alle tegningene her'),
      h('span', {}, 'eller klikk for å velge filer'),
      h('small', {}, 'Plantegninger og fasader, gjerne alle på en gang: PNG, JPG, WebP, AVIF eller PDF. Et mobilfoto av en utskrift går også.'));
    drop.addEventListener('dragenter', () => drop.classList.add('is-over'));
    // leaving for one of its own texts is no leave: the outline went out when the pointer came over the text (F32)
    drop.addEventListener('dragleave', (e) => !drop.contains(e.relatedTarget) && drop.classList.remove('is-over'));
    drop.addEventListener('drop', () => drop.classList.remove('is-over'));
    const card = h('div', { class: 'pb-start-card' },
      h('h1', {}, 'Fra tegninger til 3D-hus'),
      h('p', {}, 'Slipp plantegningene og fasadene dine, og trykk «Generer». Planbyggeren ordner etasjene, finner målestokken og rommene, spør bare om det den ikke finner selv, og åpner huset i 3D. Etterpå kan du finjustere alt i editoren.'),
      drop,
      h('div', { class: 'pb-start-foot' },
        h('button', { class: 'pb-btn', onclick: () => this._demo() }, 'Prøv med eksempelplanen'),
        saved ? h('button', { class: 'pb-btn is-primary', onclick: () => this._continueSaved(saved) }, `Fortsett med «${saved.name}»`) : null,
        h('button', { class: 'pb-btn', onclick: () => this.projectInput.click() }, 'Åpne prosjekt …'),
        h('button', { class: 'pb-btn', title: 'Én plantegning, med skala og retting for hånd', onclick: () => this._pickFile() }, 'Bare én plan …'),
        h('span', { class: 'pb-note' }, 'Gjenkjenningen skjer i nettleseren.')));
    s.append(card);
    s.hidden = false;
  }

  // ---- «Generer»: the drawing stack, the progress, the guide, 3D

  _pickDrawings(onFiles = null) {
    this._pendingPick = onFiles;
    this.filesInput.click();
  }
  /** Files dropped or picked on the start page: into the drawing stack (made on the first files). */
  _addDrawings(files) {
    if (!this.stack) this._openStack();
    else if (!this.stack.el.isConnected) this._openStackView();
    return this.stack.addFiles(files);
  }
  _openStack() {
    const s = this.startEl;
    this.guide?.dispose();
    this.guide = null;
    s.innerHTML = '';
    s.hidden = false;
    s.classList.add('is-wide');
    const el = h('div', { class: 'pb-start-stack' });
    s.append(el);
    this._aiPromise = this._aiStatus(); // asked again for every new stack (the server may have changed)
    this.stack = new DrawingStack(el, {
      analyse: (img) => runWorker('analyse', img),
      onGenerate: (inputs) => this.generateHouse(inputs),
      onBack: () => this._renderStart(this._savedDoc()),
      onPick: () => this._pickDrawings(),
      aiStatus: this._aiPromise,
    });
    return this.stack;
  }
  /** Back to the stack as it was (its element is kept). */
  _openStackView() {
    const s = this.startEl;
    if (!this.stack) return this._openStack();
    this.guide?.dispose();
    this.guide = null;
    s.innerHTML = '';
    s.hidden = false;
    s.classList.add('is-wide');
    s.append(this.stack.el);
    this.stack.render();
    return this.stack;
  }
  _savedDoc() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return d?.levels?.length ? d : null;
    } catch {
      return null;
    }
  }
  /** The AI: { available, model, remaining } (ai.js aiStatus against the page's server), or the test override. */
  async _aiStatus() {
    if (typeof window.__planbyggerAiOverride === 'function') return { available: true, model: 'opptak', remaining: 0, override: true };
    return aiStatus();
  }
  /** generate()'s AI: ai.js aiRead, or a test's override (the replayed recordings; it gets no pixels). */
  _ai(status) {
    const o = window.__planbyggerAiOverride;
    if (typeof o === 'function') return { read: (task, p) => o(task, { marks: p.marks ?? [], unmarked: p.unmarked ?? [], hints: p.hints ?? {}, source: p.source ?? null, width: p.image?.width, height: p.image?.height }) };
    return status?.available ? { read: (task, p) => aiRead(task, p) } : null;
  }

  /** «Generer» on the stack's inputs → the guide (or straight into 3D when there is nothing to ask). */
  async generateHouse(inputs, { answers = null } = {}) {
    const stack = this.stack;
    stack?.progress({ done: 0, total: 1, text: 'Starter …' });
    window.__planbyggerLastGenerate = undefined;
    const t0 = performance.now();
    try {
      const status = await (this._aiPromise ??= this._aiStatus());
      const ai = this._ai(status);
      const res = await generate(inputs, {
        ai,
        exec: workerExecutor() ?? undefined,
        answers: answers ?? undefined,
        onProgress: (p) => stack?.progress(p),
      });
      this.gen = { inputs, res, ms: Math.round(performance.now() - t0), ai: !!ai, answers: answers ?? {} };
      window.__planbyggerLastGenerate = { ms: this.gen.ms, ai: this.gen.ai, questions: res.questions.map((q) => ({ id: q.id, kind: q.kind, input: q.input })), notes: res.report.notes, aiCalls: res.report.ai };
      stack?.progress(null);
      if (answers) return res;
      if (res.questions.length) this._openGuide(res);
      else await this._finishGenerate({ answers: {}, skipped: false });
      return res;
    } catch (err) {
      console.error(err);
      window.__planbyggerLastGenerate = { error: String(err?.message ?? err) };
      stack?.progress(null);
      this.toast(`«Generer» feilet: ${err.message}`, 8);
      return null;
    }
  }

  /**
   * The image a guide card's crop is cut from: the level's image, else the drawing generate got (its px are the crop
   * box's), else the stack card's picture stretched to the drawing's size.
   */
  _cropImage(crop) {
    const res = this.gen?.res;
    this._cropCache ??= new Map();
    const key = crop.level ? `level:${crop.level}` : `file:${crop.file}`;
    if (this._cropCache.has(key)) return this._cropCache.get(key);
    let out = null;
    const im = (crop.level ? res?.images?.[crop.level]?.img : null) ?? this.gen?.inputs?.find((x) => x.name === crop.file)?.img;
    if (im) {
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0);
      out = { source: c, width: im.width, height: im.height };
    } else {
      const it = this.stack?.items.find((x) => x.name === crop.file);
      if (it?.bitmap) out = { source: it.bitmap, width: it.size?.width ?? it.bitmap.width, height: it.size?.height ?? it.bitmap.height };
    }
    this._cropCache.set(key, out);
    return out;
  }

  _openGuide(res) {
    const s = this.startEl;
    this._cropCache = new Map();
    s.innerHTML = '';
    s.hidden = false;
    s.classList.add('is-wide');
    const el = h('div', { class: 'pb-start-guide' });
    s.append(el);
    this.guide = new Guide(el, {
      questions: res.questions,
      imageFor: (crop) => this._cropImage(crop),
      onDone: (out) => this._finishGenerate(out),
      onNewFile: (q) => this._replaceDrawing(q),
    });
  }

  /** A photo the guide asked for again: the stack's file is replaced, and «Generer» runs anew. */
  _replaceDrawing(q) {
    this._pickDrawings(async (files) => {
      if (!files.length || !this.stack) return;
      for (const it of this.stack.items.filter((x) => x.name === q.file)) this.stack.remove(it);
      this._openStackView();
      await this.stack.addFiles(files.slice(0, 1));
      await this.stack.generate();
    });
  }

  /**
   * The guide is done: an answer that needs another run (the other alternative drawing) runs generate again with the
   * answers; the answers go onto the document (applyAnswers); the document becomes the page's, and 3D opens.
   */
  async _finishGenerate({ answers = {}, skipped = false } = {}) {
    const g = this.gen;
    if (!g) return;
    this.guide?.dispose();
    this.guide = null;
    let { doc, questions, images } = g.res;
    const rerun = questions.some((q) => q.rerun && q.kind === 'alternative' && answers[q.id] != null && answers[q.id] !== q.default);
    if (rerun) {
      this._openStackView();
      const res2 = await this.generateHouse(g.inputs, { answers });
      if (res2) ({ doc, questions, images } = res2);
    }
    doc = applyAnswers(doc, questions, answers);
    doc.generated = { ...(doc.generated || {}), guide: { answered: Object.keys(answers).length, asked: questions.length, skipped } };
    this.gen.answers = answers;
    await this._loadGenerated(doc, images);
    // the drawings generate got (a PDF's full pages among them), its level images (the editor has its own copies now)
    // and the guide's crops are not needed any more: «Generer» again starts from the stack
    this.gen.inputs = null;
    if (this.gen.res) this.gen.res.images = null;
    this._cropCache = null;
    await this.open3d();
    if (!this.doc?.generated || this.view3d.hidden) return;
    // no facade drawings: the windows all got one sill and height – the facade check lets the customer set each one;
    // several levels and no stair between them: the stair placer (one after the other)
    const noStair = this.doc.levels.length > 1 && !this.doc.levels.some((l) => (l.stairs || []).length);
    const stairs = () => noStair && this.openStairs('Vi fant ingen trapp mellom etasjene. Dra trappa på plass på planen – fra toppen og nedover.');
    if (!this.doc.facades?.length) this.openFacades('Vi fant ingen fasadetegninger, så alle vinduene har fått samme høyde. Klikk på vinduer og dører for å rette høyde, bredde og type – «Ferdig» bygger 3D-huset på nytt.', stairs);
    else stairs();
  }

  /** The stair placer (stairplace.js) over the page; its changes go into the document with undo, «Ferdig» rebuilds 3D. */
  async openStairs(intro = null, then = null) {
    if (!this.doc || this.doc.levels.length < 2) {
      this.toast('Huset har bare én etasje.');
      return;
    }
    const { openStairPlacer } = await import('./stairplace.js');
    this._facades?.close();
    this._facades = openStairPlacer({
      getDoc: () => this.doc,
      h,
      intro,
      onChange: (label, fn) => {
        this.snapshot();
        fn();
        this.changed(label);
      },
      onDone: async (changed) => {
        this._facades = null;
        if (changed && !this.view3d.hidden) await this.open3d();
        then?.();
      },
    });
  }

  /** The facade check (facadecheck.js) over the page; its changes go into the document with undo, «Ferdig» rebuilds 3D. */
  async openFacades(intro = null, then = null) {
    if (!this.doc?.levels.some((l) => l.walls.some((w) => w.exterior))) {
      this.toast('Huset har ingen yttervegger å vise. Merk ytterveggene i «Finjuster».');
      return;
    }
    const { openFacadeCheck } = await import('./facadecheck.js');
    this._facades?.close();
    this._facades = openFacadeCheck({
      getDoc: () => this.doc,
      h,
      intro,
      onChange: (label, fn) => {
        this.snapshot();
        fn();
        this.changed(label);
      },
      onDone: async (changed) => {
        this._facades = null;
        if (changed && !this.view3d.hidden) await this.open3d();
        then?.();
      },
    });
  }

  /** A generated document as the page's: the level images for the editor (and IndexedDB), then the editor state. */
  async _loadGenerated(doc, images) {
    this.doc = doc;
    this.li = 0;
    this.images.clear();
    this.hist.clear();
    this.sel = null;
    this._lastCheck = null;
    for (const lv of doc.levels) {
      const im = images?.[lv.id]?.img;
      if (!im) continue;
      const imageData = new ImageData(new Uint8ClampedArray(im.data), im.width, im.height);
      const bitmap = await createImageBitmap(imageData);
      lv.image = { ...(lv.image || {}), width: im.width, height: im.height, rotation: 0 };
      this.images.set(lv.id, { bitmap, imageData, grey: luma(imageData), rotation: 0, original: { bitmap, imageData } });
      // for «Fortsett med …» after a reload (a PNG: the level's image may be a crop or a straightened photo)
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      c.getContext('2d').putImageData(imageData, 0, 0);
      c.toBlob((blob) => blob && idbPut(lv.id + ':' + (lv.image.name ?? ''), blob), 'image/png');
    }
    this.startEl.hidden = true;
    this.startEl.classList.remove('is-wide');
    this.statusInfo.textContent = this.gen?.ai ? 'KI-en fikk nedskalerte kopier av tegningene for å lese tekst og symboler. Målene er regnet ut i nettleseren.' : 'Huset er laget i nettleseren – tegningene er ikke sendt noen steder.';
    this._afterLevelChange();
    this._saveSoon();
    this._checkSoon();
  }

  // ---- start / restore
  async _restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch {
      saved = null;
    }
    this._renderStart(saved?.levels?.length ? saved : null);
    this._refreshAll();
  }
  async _continueSaved(saved) {
    this.doc = saved;
    this.li = 0;
    this.hist.clear();
    for (const lv of this.doc.levels) {
      const blob = await idbGet(lv.id + ':' + (lv.image?.name ?? ''));
      if (blob) await this._loadImageBlob(lv, blob, { store: false });
    }
    this.startEl.hidden = true;
    this._afterLevelChange();
  }
  _pickFile(levelTarget) {
    this._pendingLevel = levelTarget;
    this.fileInput.click();
  }
  async _demo() {
    const res = await fetch(demoPlanUrl);
    const blob = await res.blob();
    const file = new File([blob], 'plantegning.png', { type: 'image/png' });
    await this._onFile(file);
  }

  /** A new plan file: a new document, or a new image for a level (levelTarget). */
  async _onFile(file, levelTarget) {
    this._busy('Leser planen …');
    try {
      let blob = file;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) blob = await pdfToPng(file);
      this.startEl.classList.remove('is-wide');
      if (!this.doc || levelTarget === undefined) {
        this.doc = createDoc(file.name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ') || 'Mitt hus');
        this.li = 0;
        this.images.clear();
        this.hist.clear();
        createLevel(this.doc, { id: 'hoved', name: '1. etasje', floorY: 0 });
      }
      const lv = levelTarget ?? this.level;
      await this._loadImageBlob(lv, blob, { name: file.name });
      lv.walls = [];
      lv.openings = [];
      this.startEl.hidden = true;
      this._afterLevelChange();
      this.setTool('scale');
      this._saveSoon();
      if (lv.image.rotation) this.toast(`Planen står ${fmt(Math.abs(lv.image.rotation), 1)}° skjevt – den er rettet opp. Vinkelen kan endres under Etasje.`, 7);
    } catch (err) {
      console.error(err);
      this.toast(`Klarte ikke å lese fila: ${err.message}`);
    } finally {
      this._busy(null);
    }
  }

  async _loadImageBlob(lv, blob, { name, store = true } = {}) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bitmap, 0, 0);
    const imageData = g.getImageData(0, 0, c.width, c.height);
    if (name || !lv.image) lv.image = { ...(lv.image || {}), name: name ?? lv.image?.name ?? 'plan', width: bitmap.width, height: bitmap.height, pxPerM: name ? null : lv.image?.pxPerM ?? null };
    // a crooked scan or photo is straightened once (estimateSkew); a stored level keeps its rotation
    if (name) lv.image.rotation = skewOf(await runWorker('skew', imageData).catch(() => 0));
    this.images.set(lv.id, await this._working({ bitmap, imageData }, lv.image.rotation ?? 0));
    if (store) await idbPut(lv.id + ':' + lv.image.name, blob);
  }
  /**
   * The working image of a level: the original turned back by the level's rotation. The editor, the scale line, the
   * wall tone and the detection all use it, so the plan frame is the straightened image (same size, same centre).
   */
  async _working(original, deg) {
    if (!deg) return { bitmap: original.bitmap, imageData: original.imageData, grey: luma(original.imageData), rotation: 0, original };
    const r = await runWorker('rotate', original.imageData, { deg: -deg });
    const imageData = new ImageData(r.data, r.width, r.height);
    return { bitmap: await createImageBitmap(imageData), imageData, grey: luma(imageData), rotation: deg, original };
  }
  /** A new rotation for a level's image. The walls were found in the old frame, so they are found anew. */
  async _setRotation(L, deg) {
    const im = this.images.get(L.id);
    if (!im || Math.abs((L.image.rotation ?? 0) - deg) < 0.005) return;
    if (L.walls.length && !(await this._confirm('Rette opp planen på nytt?', 'Veggene, dørene og vinduene ble funnet i den gamle vinkelen og erstattes med et nytt automatisk forslag. Romnavnene beholdes. Du kan angre.'))) {
      this._renderSide();
      return;
    }
    this._busy('Retter opp planen …');
    try {
      this.snapshot();
      L.image.rotation = deg;
      this.images.set(L.id, await this._working(im.original, deg));
      this.changed('Rotasjon');
      if (L.image.pxPerM) await this.detect({ snapshot: false });
      this.editor.render();
    } finally {
      this._busy(null);
    }
  }
  /** After undo / redo: the working images follow the levels' rotations. */
  async _syncImages() {
    for (const lv of this.doc.levels) {
      const im = this.images.get(lv.id);
      const deg = lv.image?.rotation ?? 0;
      if (im && Math.abs(im.rotation - deg) > 0.005) this.images.set(lv.id, await this._working(im.original, deg));
    }
    this.editor.render();
  }

  // ---- tools, steps
  setTool(t) {
    this.tool = t;
    for (const [id, el] of Object.entries(this.toolEls)) el.classList.toggle('is-active', id === t);
    this.editor.setTool(t);
    this._renderScaleBox();
    this.hintEl.textContent = this._hint();
  }
  _hint() {
    const L = this.level;
    if (!L?.image) return '';
    if (!L.image.pxPerM) return 'Steg 2: Klikk på den lengste målelinja i planen (f.eks. «12.21 m»), eller klikk to punkter med kjent avstand. Skriv inn lengden under. En lang linje gir den sikreste skalaen.';
    return this.tool === 'select' && !this.sel ? '' : TOOL_HINT[this.tool] ?? '';
  }
  _goStep(id) {
    if (id === 'upload') {
      this._renderStart(this.doc);
      return;
    }
    if (!this.level?.image) return;
    if (id === 'scale') this.setTool('scale');
    else if (id === 'edit') this.setTool('select');
    else if (id === '3d') this.open3d();
  }
  _stepState() {
    const L = this.level;
    const st = !L?.image ? 'upload' : !L.image.pxPerM ? 'scale' : this.view3d.hidden ? 'edit' : '3d';
    const order = STEPS.map((s) => s[0]);
    const cur = order.indexOf(st);
    for (const [id, el] of Object.entries(this.stepEls)) {
      const i = order.indexOf(id);
      el.classList.toggle('is-active', i === cur);
      el.classList.toggle('is-done', i < cur);
      el.disabled = i > cur + (cur >= 2 ? 1 : 0);
    }
    this.walkBtn.disabled = !L?.walls?.length;
  }

  // ---- the scale step
  _renderScaleBox() {
    const L = this.level;
    const box = this.scaleBox;
    box.innerHTML = '';
    if (!L?.image || this.tool !== 'scale') {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const line = this.editor.scaleLine;
    const px = line?.b ? Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]) : null;
    this.scaleMetres = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'f.eks. 2,53', onkeydown: (e) => e.key === 'Enter' && this._applyScale() });
    const apply = h('button', { class: 'pb-btn is-primary', onclick: () => this._applyScale(), disabled: !px }, L.image.pxPerM ? 'Bruk ny skala' : 'Bruk skala og gjenkjenn');
    const suggest = h('button', { class: 'pb-btn', onclick: () => this._suggestScale() }, 'Foreslå automatisk');
    box.append(
      h('span', {}, px ? `Linja er ${fmt(px, 0)} px. Lengde:` : 'Klikk på en målelinje eller to punkter …'),
      this.scaleMetres, h('span', { class: 'pb-unit' }, 'm'), apply, suggest);
    if (L.image.pxPerM) box.append(h('button', { class: 'pb-btn', onclick: () => this.setTool('select') }, 'Avbryt'));
    if (px) setTimeout(() => this.scaleMetres.focus(), 0);
  }
  scaleLineChanged() {
    this._renderScaleBox();
  }
  traceLine(imgP) {
    const im = this.images.get(this.level?.id);
    return im ? traceLine(im.grey, imgP[0], imgP[1]) : null;
  }
  async _suggestScale() {
    const im = this.images.get(this.level.id);
    if (!im) return;
    this._busy('Leter etter vegger og dører for å foreslå en skala …');
    try {
      const s = await runWorker('scale', im.imageData);
      if (!s) {
        this.toast('Fant ingen vegger å foreslå skala fra. Mål en lengde i planen i stedet.');
        return;
      }
      const L = this.level;
      // a ready measuring line: 1 m at the suggested scale, in the middle of the image
      this.editor.scaleLine = { a: [L.image.width * 0.4, L.image.height * 0.5], b: [L.image.width * 0.4 + s.pxPerM * 2, L.image.height * 0.5], suggested: s };
      this._renderScaleBox();
      this.scaleMetres.value = '2';
      this.toast(`Forslag: ${fmt(s.pxPerM, 1)} px per meter (fra ${s.from}${s.doors ? `, ${s.doors} dører` : ''}; sikkerhet ${s.confidence}). Linja er 2 m med forslaget – sjekk den mot en målelinje i planen før du bruker den.`, 9);
    } catch (err) {
      this.toast(`Klarte ikke å foreslå skala: ${err.message}`);
    } finally {
      this._busy(null);
    }
  }
  async _applyScale() {
    const L = this.level;
    const line = this.editor.scaleLine;
    const m = num(this.scaleMetres?.value);
    if (!line?.b || !m || m <= 0) {
      this.toast('Klikk en linje og skriv inn lengden i meter.');
      return;
    }
    const px = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
    const ppm = px / m;
    this.snapshot();
    if (L.image.pxPerM && L.walls.length) rescaleLevel(L, ppm);
    L.image.pxPerM = ppm;
    L.image.scaleRef = { a: line.a, b: line.b, metres: m };
    this.editor.scaleLine = null;
    this.changed('Skala');
    if (!L.walls.length) await this.detect();
    this.setTool('select');
    this.editor.fit();
  }

  /** Runs the detection on the level's plan (replaces its walls and openings, keeps the room names). */
  async detect({ snapshot = true } = {}) {
    const L = this.level;
    const im = this.images.get(L.id);
    if (!im || !L.image?.pxPerM) return;
    this._busy('Gjenkjenner vegger, dører og vinduer …');
    try {
      const t0 = performance.now();
      const det = await runWorker('detect', im.imageData, { pxPerM: L.image.pxPerM, ...(L.detect || {}) });
      if (snapshot) this.snapshot();
      applyDetection(L, det, L.image.pxPerM, this.doc.settings);
      const ms = performance.now() - t0;
      this.changed('Gjenkjenning');
      const c = (t) => det.openings.filter((o) => o.type === t).length;
      if (det.stats?.autoWallTone && !L.detect?.wallTone) L.detectInfo = `grå vegger funnet automatisk (${det.stats.autoWallTone.join('–')})`;
      else L.detectInfo = null;
      this.toast(`Fant ${det.walls.length} vegger, ${c('door')} dører, ${c('window')} vinduer og ${c('opening')} åpninger på ${(ms / 1000).toFixed(1)} s. Rett opp det som er feil, og gi rommene navn.`, 8);
    } catch (err) {
      console.error(err);
      this.toast(`Gjenkjenningen feilet: ${err.message}`);
    } finally {
      this._busy(null);
    }
  }

  /** The wall tone tool: the median grey of 5 × 5 pixels under the click; black walls stay automatic. */
  async sampleTone(p) {
    const L = this.level;
    const im = this.images.get(L?.id);
    if (!im) return;
    const ppm = L.image.pxPerM || 100;
    const x = Math.round(p[0] * ppm);
    const y = Math.round(p[1] * ppm);
    const vals = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < im.grey.w && yy < im.grey.h) vals.push(im.grey.data[yy * im.grey.w + xx]);
    }
    if (!vals.length) return;
    vals.sort((a, b) => a - b);
    const T = vals[vals.length >> 1];
    if (T > 215) {
      this.toast('Det der ser ut som papir, ikke en vegg. Klikk midt på en vegg.');
      return;
    }
    this.snapshot();
    L.detect = T < 45 ? {} : { wallTone: [Math.max(0, T - 25), Math.min(235, T + 20)] };
    this.changed('Veggfarge');
    this.setTool('select');
    this.toast(T < 45 ? 'Veggene er svarte: automatisk terskel.' : `Veggfarge ${T}: veggene er gråtonene ${L.detect.wallTone.join('–')}.`);
    if (L.image?.pxPerM) {
      if (!L.walls.length || (await this._confirm('Gjenkjenne på nytt med veggfargen?', 'Veggene, dørene og vinduene erstattes med et nytt forslag. Romnavnene beholdes. Du kan angre.'))) await this.detect();
    }
  }

  // ---- model changes (the editor calls these)
  snapshot() {
    if (this.doc) this.hist.push(this.doc);
  }
  changed(label) {
    this.editor.refresh();
    this._refreshAll();
    this._saveSoon();
    this._checkSoon();
    if (label) this.statusMsg.textContent = label;
  }
  /** Export + validateHouse in the background, 700 ms after the last change. */
  _checkSoon() {
    clearTimeout(this._checkT);
    if (!this.doc?.levels.some((l) => l.walls.length)) {
      this.checkPill.hidden = true;
      return;
    }
    this._checkT = setTimeout(async () => {
      const token = (this._checkToken = (this._checkToken || 0) + 1);
      const out = await this._validate();
      if (token !== this._checkToken) return;
      this._lastCheck = out;
      const n = out.fatal ? 1 : out.errors.length;
      this.checkPill.hidden = false;
      this.checkPill.className = `pb-pill ${n ? 'is-error' : out.warnings.length ? 'is-warn' : 'is-ok'}`;
      this.checkPill.textContent = n ? `${n} feil` : out.warnings.length ? `0 feil · ${out.warnings.length} adv.` : '0 feil';
      if (this._checkMsgs?.isConnected) this._fillMsgs(this._checkMsgs, out);
      if (this.sel?.kind === 'stair') this._renderSide(); // the validator's stair numbers
    }, 700);
  }
  _showCheck() {
    if (!this.view3d.hidden) this.close3d();
    this.select(null);
    this.editor.select(null);
    setTimeout(() => this._checkMsgs?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }
  undo() {
    const d = this.hist.undo(this.doc);
    if (!d) return;
    this.doc = d;
    this.li = Math.min(this.li, d.levels.length - 1);
    this.editor.refresh();
    this._refreshAll();
    this._saveSoon();
    this._syncImages();
  }
  redo() {
    const d = this.hist.redo(this.doc);
    if (!d) return;
    this.doc = d;
    this.editor.refresh();
    this._refreshAll();
    this._saveSoon();
    this._syncImages();
  }
  select(sel) {
    this.sel = sel;
    this._renderSide();
    this.hintEl.textContent = this._hint();
  }
  selectionChanged() {
    this._renderSide();
  }
  status(text, slot) {
    if (slot === 'pos') this.statusPos.textContent = text;
    else this.statusMsg.textContent = text;
  }
  wallThickness() {
    return this.thickness;
  }
  toast(text, seconds = 5) {
    this._toast?.remove();
    const t = h('div', { class: 'pb-toast' }, text);
    document.body.append(t);
    this._toast = t;
    setTimeout(() => t.remove(), seconds * 1000);
  }
  _busy(text) {
    this.busyEl.hidden = !text;
    this.busyEl.textContent = text || '';
  }
  _saveSoon() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try {
        if (this.doc) localStorage.setItem(STORE_KEY, JSON.stringify(this.doc));
      } catch (err) {
        console.warn('[planbygger] lagring feilet', err);
      }
    }, 400);
  }

  _afterLevelChange() {
    this.sel = null;
    this.editor.sel = null;
    this.editor.scaleLine = null;
    this._updateGhost();
    this.editor.refresh();
    this.editor.fit();
    this.nameInput.value = this.doc?.name ?? '';
    this._refreshAll();
    this.setTool(this.level?.image && !this.level.image.pxPerM ? 'scale' : 'select');
  }
  _refreshAll() {
    this.undoBtn.disabled = !this.hist.canUndo;
    this.redoBtn.disabled = !this.hist.canRedo;
    this._stepState();
    this._renderSide();
    this.hintEl.textContent = this._hint();
  }
  _updateGhost() {
    const L = this.level;
    const main = this.doc?.levels[0];
    this.editor.ghostStairs = null;
    if (L) {
      // the stairs that come down here from the level above
      const above = this.doc.levels.filter((l) => (l.floorY ?? 0) > (L.floorY ?? 0) + 0.5).sort((a, b) => a.floorY - b.floorY)[0];
      if (above?.stairs?.length) {
        const d = sub(above.offset || [0, 0], L.offset || [0, 0]);
        this.editor.ghostStairs = above.stairs.map((st) => ({ ...st, rect: st.rect.map((p) => add(p, d)) }));
      }
    }
    if (!L || !main || L === main || !main.walls.length) {
      this.editor.ghost = null;
      return;
    }
    const d = sub(main.offset || [0, 0], L.offset || [0, 0]);
    this.editor.ghost = main.walls.map((w) => ({ ...w, a: add(w.a, d), b: add(w.b, d) }));
  }

  // ---- keyboard
  _key(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    // the start page, the drawing stack, the guide and the facade check have their own keys
    if (this._facades) return;
    if (!this.startEl.hidden) return;
    if (!this.view3d.hidden) {
      if (e.key === 'Escape' && this.viewer?.mode === 'orbit') this.close3d();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (this.editor.key(e)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOLS.find((t) => t[2].toLowerCase() === e.key.toLowerCase());
    if (tool && this.level?.image?.pxPerM) {
      this.setTool(tool[0]);
      e.preventDefault();
    } else if (e.key === '0') this.editor.fit();
    else if (e.key === '?') this._help();
  }

  // ---- the side panel
  _renderSide() {
    const s = this.side;
    s.innerHTML = '';
    if (!this.doc) {
      s.append(h('p', { class: 'pb-note' }, 'Last opp en plantegning for å begynne.'));
      return;
    }
    const L = this.level;
    // levels
    s.append(h('h3', {}, 'Etasjer'),
      h('div', { class: 'pb-tabs' },
        this.doc.levels.map((lv, i) => h('button', { class: i === this.li ? 'is-active' : '', onclick: () => {
          this.li = i;
          this._afterLevelChange();
        } }, lv.name)),
        h('button', { onclick: () => this._newLevel(), title: 'Legg til en etasje med sin egen plantegning' }, '+ Etasje')));
    // the selection
    const selBox = this._selectionPanel();
    if (selBox) s.append(selBox);
    if (L) s.append(this._levelPanel(L));
    s.append(this._housePanel());
    if (L?.image?.pxPerM) s.append(this._roomsPanel(), this._checkPanel());
  }

  _selectionPanel() {
    const L = this.level;
    const sel = this.sel;
    if (!L || !sel) return null;
    const box = h('div');
    const field = (label, value, onchange, unit = 'm', attrs = {}) => h('div', { class: 'pb-field' }, h('label', {}, label),
      h('span', {}, h('input', { type: 'text', inputmode: 'decimal', value: value == null ? '' : String(value).replace('.', ','), onchange: (e) => onchange(e.target.value), ...attrs }), unit ? h('span', { class: 'pb-unit' }, unit) : null));
    if (sel.kind === 'wall') {
      const w = L.walls.find((x) => x.id === sel.id);
      if (!w) return null;
      const set = (fn, label) => {
        this.snapshot();
        fn();
        this.changed(label);
      };
      box.append(h('h3', {}, 'Vegg'),
        field('Lengde', round(wallLength(w), 3), (v) => {
          const m = num(v);
          if (!m || m < 0.05) return;
          set(() => {
            const u = [(w.b[0] - w.a[0]) / wallLength(w), (w.b[1] - w.a[1]) / wallLength(w)];
            w.b = [round(w.a[0] + u[0] * m, 4), round(w.a[1] + u[1] * m, 4)];
          }, 'Veggens lengde');
        }),
        field('Tykkelse', round(w.t * 100, 1), (v) => {
          const c = num(v);
          if (!c || c < 2 || c > 100) return;
          set(() => (w.t = round(c / 100, 4)), 'Veggens tykkelse');
        }, 'cm'),
        h('p', { class: 'pb-note' }, w.auto ? 'Funnet automatisk.' : 'Lagt inn for hånd.', ' Dra veggen for å flytte den, dra endene for å forlenge den. Piltastene flytter 1 cm (Shift: 10 cm).'),
        h('div', { class: 'pb-row' },
          h('button', { class: 'pb-btn is-small', onclick: () => set(() => splitWall(L, w.id, wallLength(w) / 2), 'Delte veggen') }, 'Del i to'),
          h('button', { class: 'pb-btn is-small is-danger', onclick: () => this.editor.deleteSelection() }, 'Slett vegg')));
      return box;
    }
    if (sel.kind === 'opening') {
      const o = L.openings.find((x) => x.id === sel.id);
      if (!o) return null;
      const w = L.walls.find((x) => x.id === o.wall);
      const set = (fn, label) => {
        this.snapshot();
        fn();
        this.changed(label);
      };
      // the kind: type and door variant together (model.js setOpeningKind)
      const kind = openingKind(o);
      const typeSel = h('select', { onchange: (e) => set(() => setOpeningKind(o, e.target.value, this.doc.settings), 'Type') },
        OPENING_KINDS.map(([k, label]) => h('option', { value: k, selected: kind === k }, label)));
      box.append(h('h3', {}, OPENING_KINDS.find((x) => x[0] === kind)?.[1] ?? 'Åpning'),
        h('div', { class: 'pb-field' }, h('label', {}, 'Type'), typeSel),
        field('Bredde', round(o.width, 3), (v) => {
          const m = num(v);
          if (!m || m < 0.2 || (w && m > wallLength(w))) return;
          set(() => {
            o.width = m;
            if (w) o.at = Math.max(m / 2, Math.min(wallLength(w) - m / 2, o.at));
          }, 'Bredde');
        }),
        field('Fra veggens start', round(o.at - o.width / 2, 3), (v) => {
          const m = num(v);
          if (m == null || !w) return;
          set(() => (o.at = Math.max(o.width / 2, Math.min(wallLength(w) - o.width / 2, m + o.width / 2))), 'Plassering');
        }));
      if (o.type === 'window') {
        box.append(field('Brystningshøyde', o.sill ?? this.doc.settings.windowSill, (v) => {
          const m = num(v);
          if (m == null || m < 0) return;
          set(() => (o.sill = m), 'Brystning');
        }), field('Høyde', o.height ?? this.doc.settings.windowHeight, (v) => {
          const m = num(v);
          if (!m || m < 0.1) return;
          set(() => (o.height = m), 'Vindushøyde');
        }));
      } else {
        box.append(field('Høyde', o.height ?? this.doc.settings.doorHeight, (v) => {
          const m = num(v);
          if (!m || m < 1) return;
          set(() => (o.height = m), 'Høyde');
        }));
      }
      if (o.type === 'door' && kind !== 'sliding') {
        box.append(field('Åpningsvinkel', o.openAngle ?? 90, (v) => {
          const m = num(v);
          if (!m || m < 30 || m > 180) return;
          set(() => (o.openAngle = m), 'Åpningsvinkel');
        }, '°'));
        box.append(h('div', { class: 'pb-row' },
          h('button', { class: 'pb-btn is-small', title: kind === 'double' ? 'Bytt hvilket blad som er hvilket' : null, onclick: () => set(() => (o.hinge = o.hinge === 'end' ? 'start' : 'end'), 'Snudde hengsel') }, 'Snu hengselen (H)'),
          h('button', { class: 'pb-btn is-small', onclick: () => set(() => (o.side = -(o.side || 1)), 'Snudde slagretning') }, 'Snu slagretningen (G)')));
      } else if (kind === 'sliding') {
        box.append(h('p', { class: 'pb-note' }, 'Skyvedøra har ingen slagradius. I 3D blir den foreløpig en åpning uten dørblad.'),
          h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn is-small', onclick: () => set(() => (o.side = -(o.side || 1)), 'Byttet side') }, 'Bytt side (G)')));
      }
      box.append(h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn is-small is-danger', onclick: () => this.editor.deleteSelection() }, 'Slett')));
      return box;
    }
    if (sel.kind === 'stair') {
      const st = (L.stairs || []).find((x) => x.id === sel.id);
      if (!st) return null;
      const g = stairGeometry(st);
      const below = this.doc.levels.filter((l) => (l.floorY ?? 0) < (L.floorY ?? 0) - 0.5).sort((a, b) => b.floorY - a.floorY)[0];
      const rise = below ? (L.floorY ?? 0) - below.floorY : null;
      const risers = rise ? Math.max(2, Math.round(rise / 0.18)) : null;
      // the validator's numbers (its walk line) when the background check has run, else the rectangle's length
      const exId = this._lastCheck?.ex?.house?.stairs?.find((x) => x.planbyggerId === st.id)?.id;
      const vs = exId ? this._lastCheck.report?.stairs?.find((x) => x.id === exId) : null;
      const going = vs?.going ?? (risers ? g.length / (risers - 1) : null);
      const set = (fn, label) => {
        this.snapshot();
        fn();
        this.changed(label);
      };
      const kindSel = h('select', { onchange: (ev) => set(() => (st.kind = ev.target.value), 'Trappetype') },
        h('option', { value: 'straight', selected: st.kind !== 'u' }, 'Rett trapp'),
        h('option', { value: 'u', selected: st.kind === 'u' }, 'U-trapp (halvsving)'));
      box.append(h('h3', {}, 'Trapp'),
        h('div', { class: 'pb-field' }, h('label', {}, 'Type'), kindSel),
        h('p', {}, `${fmt(g.width)} × ${fmt(g.length)} m`),
        st.kind === 'u' ? h('p', { class: 'pb-note' }, 'U-trappa går ned langs den ene halvdelen, svinger rundt et smalt øye i enden og kommer tilbake langs den andre. Pila viser veien ned.') : null,
        below
          ? h('p', { class: 'pb-note' }, `Ned til ${below.name}: ${risers} opptrinn à ${fmt(rise / risers, 3)} m, inntrinn ${fmt(going, 3)} m på ganglinja${vs ? `, 2r + g = ${fmt(vs.twoRG, 3)}` : ''}${going < 0.22 ? ' – for bratt (minst 0,22): gjør hullet lengre' : vs && (vs.twoRG < 0.6 || vs.twoRG > 0.64) ? ' (normalt 0,60–0,64)' : ''}.`)
          : h('p', { class: 'pb-note' }, 'Det er ingen etasje under denne. Legg til en etasje (+ Etasje) med lavere gulvhøyde.'),
        h('div', { class: 'pb-row' },
          h('button', { class: 'pb-btn is-small', onclick: () => set(() => (st.down = -st.down), 'Snudde trappa') }, 'Snu retningen'),
          h('button', { class: 'pb-btn is-small', title: 'Løpet på tvers: for en trapp der løpet er kortere enn bredden', onclick: () => set(() => (st.axis = st.axis === 'x' ? 'y' : 'x'), 'Dreide trappa') }, 'Drei 90°'),
          st.kind === 'u' ? h('button', { class: 'pb-btn is-small', title: 'Det øverste løpet på den andre halvdelen', onclick: () => set(() => (st.side = st.side === 1 ? 0 : 1), 'Byttet side') }, 'Bytt side') : null,
          h('button', { class: 'pb-btn is-small is-danger', onclick: () => this.editor.deleteSelection() }, 'Slett trappa')));
      return box;
    }
    if (sel.kind === 'room') {
      const r = this.editor.rooms?.rooms[sel.index];
      if (!r) return null;
      box.append(h('h3', {}, 'Rom'),
        h('p', {}, h('b', {}, r.name), r.auto ? h('span', { class: 'pb-note' }, ' (foreslått navn)') : null),
        h('p', { class: 'pb-note' }, `${fmt(r.region.area)} m² · ${ROOM_KINDS.find((k) => k[0] === r.kind)?.[1] ?? r.kind} · takhøyde ${fmt(r.label?.ceiling ?? L.ceiling ?? this.doc.settings.ceiling)} m`),
        h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn is-small', onclick: () => this.editor._nameRoom(sel.index) }, 'Endre navn og type')));
      return box;
    }
    return null;
  }

  _levelPanel(L) {
    const box = h('div');
    const set = (fn, label) => {
      this.snapshot();
      fn();
      this.changed(label);
    };
    const field = (label, value, onchange, unit = 'm') => h('div', { class: 'pb-field' }, h('label', {}, label),
      h('span', {}, h('input', { type: 'text', inputmode: 'decimal', value: value == null ? '' : String(value).replace('.', ','), onchange: (e) => onchange(e.target.value) }), unit ? h('span', { class: 'pb-unit' }, unit) : null));
    const opacity = h('input', { type: 'range', min: 0, max: 100, value: Math.round(this.editor.imageOpacity * 100), oninput: (e) => {
      this.editor.imageOpacity = e.target.value / 100;
      this.editor.render();
    } });
    box.append(h('h3', {}, 'Etasjen'),
      h('div', { class: 'pb-field' }, h('label', {}, 'Navn'), h('input', { type: 'text', value: L.name, onchange: (e) => set(() => (L.name = e.target.value || L.name), 'Etasjenavn') })),
      L.id === 'hoved' ? h('p', { class: 'pb-note' }, 'Hovedetasjen ligger på høyde 0.') : field('Gulvhøyde', L.floorY, (v) => {
        const m = num(v);
        if (m == null) return;
        set(() => (L.floorY = m), 'Gulvhøyde');
      }),
      field('Takhøyde', L.ceiling ?? this.doc.settings.ceiling, (v) => {
        const m = num(v);
        if (!m || m < 1.8 || m > 6) return;
        set(() => (L.ceiling = m), 'Takhøyde');
      }),
      h('div', { class: 'pb-field' }, h('label', {}, 'Plantegningen'), opacity),
      h('div', { class: 'pb-field' }, h('label', {}, 'Vis rom'), h('input', { type: 'checkbox', checked: this.editor.showRooms, onchange: (e) => {
        this.editor.showRooms = e.target.checked;
        this.editor.render();
      } })),
      field('Ny vegg: tykkelse', round(this.thickness * 100, 1), (v) => {
        const c = num(v);
        if (c && c >= 2 && c <= 100) this.thickness = c / 100;
      }, 'cm'),
      h('p', { class: 'pb-note' }, L.image?.pxPerM ? `Skala: ${fmt(L.image.pxPerM, 1)} px per meter${L.image.scaleRef ? ` (målt på ${fmt(L.image.scaleRef.metres)} m)` : ''}.` : 'Skalaen er ikke satt.'),
      L.image ? h('div', { class: 'pb-field' }, h('label', { title: 'Hvor skjevt planen står i bildet (skannet eller fotografert). Den rettes opp før gjenkjenningen.' }, 'Rotasjon'),
        h('span', { class: 'pb-row', style: 'margin:0' },
          h('input', { type: 'text', inputmode: 'decimal', value: fmt(L.image.rotation ?? 0, 2), style: 'width:64px', onchange: (e) => {
            const d = num(e.target.value);
            if (d == null || Math.abs(d) > 45) return;
            this._setRotation(L, d);
          } }), h('span', { class: 'pb-unit' }, '°'),
          h('button', { class: 'pb-btn is-small', title: 'Finn skjevheten automatisk', onclick: async () => {
            const im = this.images.get(L.id);
            if (im) this._setRotation(L, skewOf(await runWorker('skew', im.original.imageData)));
          } }, 'Rett opp'))) : null,
      L.image ? h('div', { class: 'pb-field' }, h('label', {}, `Veggfarge: ${L.detect?.wallTone ? `grå ${L.detect.wallTone.join('–')}` : L.detectInfo ?? 'automatisk'}`),
        h('span', { class: 'pb-row', style: 'margin:0' },
          h('button', { class: 'pb-btn is-small', title: 'For planer med grå vegger: klikk på en vegg i planen', onclick: () => this.setTool('tone') }, 'Velg'),
          L.detect?.wallTone ? h('button', { class: 'pb-btn is-small', onclick: () => {
            this.snapshot();
            L.detect = {};
            this.changed('Veggfarge');
          } }, 'Auto') : null)) : null,
      L.image ? h('div', { class: 'pb-row' },
        h('button', { class: 'pb-btn is-small', onclick: () => this.setTool('scale') }, 'Mål skala på nytt'),
        L.image.pxPerM ? h('button', { class: 'pb-btn is-small', onclick: async () => {
          if (L.walls.length && !(await this._confirm('Gjenkjenne på nytt?', 'Veggene, dørene og vinduene erstattes med et nytt automatisk forslag. Romnavnene beholdes. Du kan angre.'))) return;
          await this.detect();
        } }, 'Gjenkjenn på nytt') : null) : null);
    if (L.id !== 'hoved') {
      box.append(field('Forskyvning x', round(L.offset?.[0] ?? 0, 3), (v) => {
        const m = num(v);
        if (m == null) return;
        set(() => (L.offset = [m, L.offset?.[1] ?? 0]), 'Forskyvning');
        this._updateGhost();
      }), field('Forskyvning y', round(L.offset?.[1] ?? 0, 3), (v) => {
        const m = num(v);
        if (m == null) return;
        set(() => (L.offset = [L.offset?.[0] ?? 0, m]), 'Forskyvning');
        this._updateGhost();
      }), h('p', { class: 'pb-note' }, 'Den blå stiplede omrisset er hovedetasjen. Forskyv planen til veggene som står over hverandre, ligger likt.'),
      h('div', { class: 'pb-field' }, h('label', {}, 'Juster ytterhjørnet mot hovedetasjen'),
        h('span', { class: 'pb-row', style: 'margin:0' }, [['ne', 'NØ'], ['nw', 'NV'], ['se', 'SØ'], ['sw', 'SV']].map(([c, t]) => h('button', { class: 'pb-btn is-small', title: `Legg ${t}-hjørnet av ytterveggene oppå hovedetasjens`, onclick: () => this._alignLevel(L, c) }, t)))),
      h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn is-small is-danger', onclick: () => this._deleteLevel(L) }, 'Slett etasjen')));
    }
    return box;
  }

  _housePanel() {
    const S = this.doc.settings;
    const set = (fn, label) => {
      this.snapshot();
      fn();
      this.changed(label);
    };
    const field = (label, key, unit = 'm', min = 0, max = 10) => h('div', { class: 'pb-field' }, h('label', {}, label),
      h('span', {}, h('input', { type: 'text', inputmode: 'decimal', value: String(S[key] ?? DEFAULT_SETTINGS[key]).replace('.', ','), onchange: (e) => {
        const m = num(e.target.value);
        if (m == null || m < min || m > max) return;
        set(() => (S[key] = m), label);
      } }), h('span', { class: 'pb-unit' }, unit)));
    const dirs = [[0, 'N', 'opp'], [90, 'N', 'høyre'], [180, 'N', 'ned'], [270, 'N', 'venstre']];
    const btn = (deg, txt) => h('button', { class: S.north === deg ? 'is-active' : '', title: `Nord er ${dirs.find((d) => d[0] === deg)[2]} i planen`, onclick: () => set(() => (S.north = deg), 'Nordretning') }, txt);
    const compass = h('div', { class: 'pb-compass' },
      h('span'), btn(0, '↑'), h('span'),
      btn(270, '←'), h('span', {}, 'N'), btn(90, '→'),
      h('span'), btn(180, '↓'), h('span'));
    return h('div', {},
      h('h3', {}, 'Huset'),
      h('div', { class: 'pb-field' }, h('label', {}, 'Hvor er nord i planen?'), compass),
      h('p', { class: 'pb-note' }, 'Nordretningen bestemmer hvor sola står i 3D.'),
      field('Takhøyde', 'ceiling', 'm', 1.8, 6),
      field('Dørhøyde', 'doorHeight', 'm', 1.8, 3),
      field('Vindu: brystning', 'windowSill', 'm', 0, 2.5),
      field('Vindu: høyde', 'windowHeight', 'm', 0.2, 3),
      field('Yttervegg minst', 'exteriorMin', 'm', 0.05, 0.6));
  }

  _roomsPanel() {
    const rooms = this.editor.rooms?.rooms ?? [];
    const total = rooms.reduce((s, r) => s + r.region.area, 0);
    const list = h('ul', { class: 'pb-list' }, rooms.map((r) => h('li', { class: this.sel?.kind === 'room' && this.sel.index === r.region.index ? 'is-sel' : '', onclick: () => this.editor.select({ kind: 'room', index: r.region.index }), ondblclick: () => this.editor._nameRoom(r.region.index) },
      h('span', {}, r.name + (r.auto ? ' ?' : '')), h('span', {}, `${fmt(r.region.area)} m²`))));
    const autos = rooms.filter((r) => r.auto).length;
    return h('div', {}, h('h3', {}, `Rom (${rooms.length}, ${fmt(total, 1)} m²)`), list,
      autos ? h('p', { class: 'pb-note' }, `${autos} rom har foreslått navn (?). Dobbeltklikk et rom for å gi det navn og type.`) : null);
  }

  _checkPanel() {
    const box = h('div', {}, h('h3', {}, 'Kontroll'));
    const msgs = h('ul', { class: 'pb-msgs' });
    this._checkMsgs = msgs;
    box.append(h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn is-small', onclick: () => this.check(msgs) }, 'Kontroller huset')), msgs);
    if (this._lastCheck) this._fillMsgs(msgs, this._lastCheck);
    return box;
  }

  /** Export + the game's validator: the messages in the panel. */
  async check(msgsEl) {
    const out = await this._validate();
    this._lastCheck = out;
    if (msgsEl) this._fillMsgs(msgsEl, out);
    return out;
  }
  _fillMsgs(el, out) {
    el.innerHTML = '';
    if (out.fatal) {
      el.append(h('li', { class: 'is-error' }, out.fatal));
      return;
    }
    for (const m of out.errors) el.append(h('li', { class: 'is-error' }, m));
    for (const m of out.warnings.slice(0, 12)) el.append(h('li', { class: 'is-warn' }, m));
    if (!out.errors.length) el.append(h('li', { class: 'is-ok' }, `Ingen feil: ${out.sum.rooms.length} rom, ${out.sum.doors} dører, ${out.sum.windows} vinduer, ${fmt(out.sum.area, 1)} m². Huset kan bygges i 3D.`));
  }
  async _validate() {
    let ex;
    try {
      ex = exportHouse(this.doc);
    } catch (err) {
      console.error(err);
      return { fatal: `Eksporten feilet: ${err.message}`, errors: [], warnings: [] };
    }
    const local = this.doc.levels.flatMap((lv) => checkLevel(lv).map((m) => `${lv.name}: ${m}`));
    let errors = [];
    let report = null;
    let warnings = [...ex.report.warnings, ...local];
    try {
      const H = await import('../data/scripts/house.mjs');
      const spec = H.mergeHouse(baseSpec(this.doc.name), null, { files: [{ name: '10-plan.json', data: ex.house }], registry: ex.registry });
      // no furniture in a generated house: no archetypes needed (the validator would read archetypes.json from disk)
      const rep = H.validateHouse(spec, { registry: ex.registry, archetypes: { archetypes: {}, archetypeAliases: {} }, throw: false });
      errors = rep.errors.filter((m) => !ownerOnly(m));
      report = rep;
      warnings = [...warnings, ...rep.warnings];
    } catch (err) {
      console.warn('[planbygger] validatoren kunne ikke kjøres', err);
      warnings.push(`Spillets validator kunne ikke kjøres: ${err.message}`);
    }
    return { ex, errors, warnings, report, sum: summary(ex.house) };
  }

  // ---- levels
  async _newLevel() {
    const res = await this._dialog('Ny etasje', [
      { key: 'name', label: 'Navn', value: this.doc.levels.some((l) => l.floorY < 0) ? '2. etasje' : 'Kjeller' },
      { key: 'floorY', label: 'Gulvhøyde (m, 1. etasje = 0)', value: this.doc.levels.some((l) => l.floorY < 0) ? '2,7' : '-2,7' },
    ], 'Velg plantegning …');
    if (!res) return;
    this.snapshot();
    const lv = createLevel(this.doc, { name: res.name || 'Etasje', floorY: num(res.floorY) ?? -2.7 });
    lv.id = slug(res.name, 'etasje');
    if (this.doc.levels.filter((l) => l.id === lv.id).length > 1 || lv.id === 'hoved') lv.id = `${lv.id}-${this.doc.levels.length}`;
    this.li = this.doc.levels.length - 1;
    this._afterLevelChange();
    this._pickFile(lv);
  }
  async _deleteLevel(L) {
    if (!(await this._confirm('Slette etasjen?', `«${L.name}» med alle veggene fjernes. Du kan angre.`))) return;
    this.snapshot();
    this.doc.levels = this.doc.levels.filter((l) => l !== L);
    this.li = 0;
    this._afterLevelChange();
    this._saveSoon();
  }
  _alignLevel(L, corner = 'ne') {
    const main = this.doc.levels[0];
    if (!main.walls.length || !L.walls.length) {
      this.toast('Begge etasjene må ha vegger før de kan justeres mot hverandre.');
      return;
    }
    this.snapshot();
    alignLevel(this.doc, L, main, corner);
    this._updateGhost();
    this.changed('Justerte etasjen');
  }

  /** The keyboard shortcuts and the mouse. */
  _help() {
    const rows = [
      ['V', 'Velg og flytt: dra en vegg på tvers (Shift: fritt), dra endene, dra dører og vinduer langs veggen'],
      ['W', 'Ny vegg: klikk, klikk … (Esc eller dobbeltklikk avslutter, Alt: uten festing)'],
      ['D / F / O', 'Dør / vindu / åpning: klikk på en vegg'],
      ['R', 'Navngi rom: klikk i et rom'],
      ['T', 'Trapp ned til etasjen under: dra fra toppen mot foten'],
      ['S', 'Skala: klikk på en målelinje, eller to punkter'],
      ['H / mellomrom', 'Flytt visningen (også midtre eller høyre museknapp), hjulet zoomer, 0 viser hele planen'],
      ['Delete', 'Slett det valgte'],
      ['Piltaster', 'Flytt den valgte veggen 1 cm (Shift: 10 cm)'],
      ['H / G', 'Valgt dør: snu hengselen / slagretningen'],
      ['Ctrl+Z / Ctrl+Y', 'Angre / gjør om'],
    ];
    const wrap = h('div', { class: 'pb-dialog', onclick: (e) => e.target === wrap && wrap.remove() }, h('div', { class: 'pb-dialog-card', style: 'width:min(620px,94vw)' },
      h('h2', {}, 'Hurtigtaster'),
      h('table', { class: 'pb-keys' }, rows.map(([k, t]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, t)))),
      h('p', { class: 'pb-note' }, 'I 3D: W A S D går, hold høyre museknapp og dra for å se rundt, Shift løper, E eller et klikk åpner dører.'),
      h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn is-primary', onclick: () => wrap.remove() }, 'Lukk'))));
    document.body.append(wrap);
  }

  // ---- dialogs
  /** What is on screen now: the 3D view (rendered once more, so the buffer is filled), else the visible plan canvas. */
  _screenshot() {
    try {
      // the facade check covers the page: its drawing is not a canvas (the text tells what is wrong)
      if (this._facades) return null;
      const v = this.viewer;
      if (!this.view3d.hidden && v?.renderer) {
        v.renderer.render(v.scene, v.camera);
        return v.renderer.domElement.toDataURL('image/jpeg', 0.85);
      }
      const crop = this.guide ? document.querySelector('.pb-guide-canvas') : null;
      if (crop?.getBoundingClientRect().width > 0) return crop.toDataURL('image/jpeg', 0.85);
      // the start page and the stack cover the editor: its canvas behind them is not what the owner sees
      if (this.guide || (this.startEl && !this.startEl.hidden)) return null;
      if (this.canvas?.getBoundingClientRect().width > 0) return this.canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      console.warn('[planbygger] skjermbildet feilet', err);
    }
    return null;
  }
  /** «Meld feil»: a screenshot, one sentence and the state go to the dev server (server/planbygger-feedback.mjs). */
  async _report() {
    const image = this._screenshot();
    const where = this._facades ? 'fasadesjekk' : !this.view3d.hidden ? `3D (${this.viewer?.mode === 'walk' ? 'går rundt' : 'dukkehus'})` : this.guide ? 'veiviser' : this.stack?.el?.isConnected ? 'stabel' : this.startEl && !this.startEl.hidden ? 'startside' : this.doc ? '2D-editor' : 'startside';
    const res = await this._dialog('Meld feil eller idé', [
      { key: 'kind', label: 'Hva', value: 'feil', options: [['feil', 'Feil'], ['ide', 'Idé / forbedring']] },
      { key: 'text', label: 'Hva skjedde (én setning holder)', value: '', placeholder: 'f.eks. svarte rundinger i gulvet i 2. etasje' },
    ], 'Lagre');
    if (!res?.text?.trim()) return;
    const stack = this.stack?.items?.map((it) => ({ name: it.name, kind: it.kind, kindFrom: it.kindFrom, note: it.note, level: it.level ?? null }));
    const files = this.gen?.inputs?.map((f) => f.name) ?? stack?.map((it) => it.name) ?? this.doc?.levels.map((l) => l.image?.name).filter(Boolean) ?? [];
    // where the camera stood in 3D (game metres), so a report can be found again without asking
    const cam = !this.view3d.hidden && this.viewer?.camera ? { position: this.viewer.camera.position.toArray().map((v) => Math.round(v * 100) / 100), direction: this.viewer.camera.getWorldDirection(this.viewer.camera.position.clone()).toArray().map((v) => Math.round(v * 100) / 100), mode: this.viewer.mode } : null;
    let state = { files, stack, camera: cam, doc: this.doc, questions: this.gen?.res?.questions, answers: this.gen?.answers, report: this.gen?.res?.report, check: this._lastCheck ? { errors: this._lastCheck.errors, warnings: this._lastCheck.warnings } : null };
    if (JSON.stringify(state).length > 8e6) state = { ...state, report: null };
    const report = { kind: res.kind, text: res.text.trim(), where: `${where}${files.length ? ` – ${files.join(', ')}` : ''}`, image, state };
    const sent = await this._sendReports([report]);
    if (sent.length) this.toast(`Lagret som ${sent[0]}${image ? ' med skjermbilde' : ''}. Takk!`);
    else this.toast('Testserveren svarer ikke. Meldingen er lagret i nettleseren og sendes når serveren kjører igjen.', 8);
  }
  /**
   * Sends reports to the dev server, queued ones first. A report that cannot be sent stays queued in IndexedDB, so a
   * stopped server never loses one; the queue is flushed on start and before every new report. Returns the new ids.
   */
  async _sendReports(fresh = []) {
    const queued = (await idbGet(REPORT_QUEUE)) ?? [];
    const left = [];
    const sentQueued = [];
    const sentFresh = [];
    for (const [i, rep] of [...queued, ...fresh].entries()) {
      try {
        if (left.length) throw new Error('kø'); // keep the order: nothing after a failure
        const r = await fetch('/api/planbygger/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rep) });
        const out = await r.json();
        if (!out.ok) throw new Error(out.error);
        (i < queued.length ? sentQueued : sentFresh).push(out.id);
      } catch {
        left.push(rep);
      }
    }
    if (queued.length || left.length) await idbPut(REPORT_QUEUE, left);
    if (sentQueued.length) this.toast(`${sentQueued.length} meldinger som ventet i nettleseren, er sendt (${sentQueued.join(', ')}).`, 8);
    return sentFresh;
  }

  _dialog(title, fields, okText = 'OK') {
    return new Promise((resolve) => {
      const inputs = {};
      const close = (v) => {
        wrap.remove();
        resolve(v);
      };
      const card = h('div', { class: 'pb-dialog-card' }, h('h2', {}, title),
        fields.map((f) => {
          let input;
          if (f.options) input = h('select', {}, f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
          else input = h('input', { type: 'text', value: f.value ?? '', placeholder: f.placeholder ?? '', list: f.list ?? null });
          inputs[f.key] = input;
          return h('div', { class: 'pb-field' }, h('label', {}, f.label), input);
        }),
        h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn', onclick: () => close(null) }, 'Avbryt'),
          h('button', { class: 'pb-btn is-primary', onclick: () => close(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]))) }, okText)));
      // the backdrop closes only on a press that started on it (the press that opened the dialog ends here too)
      let downOnWrap = false;
      const wrap = h('div', { class: 'pb-dialog', onpointerdown: (e) => (downOnWrap = e.target === wrap), onclick: (e) => e.target === wrap && downOnWrap && close(null) }, card);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
        if (e.key === 'Escape') close(null);
      });
      document.body.append(wrap);
      setTimeout(() => Object.values(inputs)[0]?.focus(), 0);
    });
  }
  async _confirm(title, text) {
    return new Promise((resolve) => {
      const close = (v) => {
        wrap.remove();
        resolve(v);
      };
      const wrap = h('div', { class: 'pb-dialog' }, h('div', { class: 'pb-dialog-card' }, h('h2', {}, title), h('p', { class: 'pb-note' }, text),
        h('div', { class: 'pb-row' }, h('button', { class: 'pb-btn', onclick: () => close(false) }, 'Avbryt'), h('button', { class: 'pb-btn is-primary', onclick: () => close(true) }, 'Ja'))));
      document.body.append(wrap);
    });
  }
  async askRoom(r) {
    const res = await this._dialog('Rom', [
      { key: 'name', label: 'Navn', value: r.name, list: 'pb-room-names' },
      { key: 'kind', label: 'Type', value: r.kind, options: ROOM_KINDS },
      { key: 'ceiling', label: 'Takhøyde (tom = etasjens)', value: r.label?.ceiling != null ? String(r.label.ceiling).replace('.', ',') : '' },
    ]);
    if (!res) return null;
    return { name: res.name.trim() || r.name, kind: res.kind, ceiling: num(res.ceiling) };
  }

  // ---- files
  async _menu(v) {
    if (v === 'house') await this.downloadHouse();
    else if (v === 'project') await this.downloadProject();
    else if (v === 'open') this.projectInput.click();
    else if (v === 'new') {
      if (this.doc && !(await this._confirm('Ny plan?', 'Den nåværende planen lukkes (den er lagret i nettleseren til du starter en ny).'))) return;
      this._renderStart(null);
    }
  }
  async downloadHouse() {
    const out = await this._validate();
    if (out.fatal) {
      this.toast(out.fatal);
      return;
    }
    const name = `${slug(this.doc.name, 'hus')}-hus.json`;
    download(name, JSON.stringify(out.ex.house, null, 2));
    if (out.errors.length) this.toast(`Husfila er lastet ned, men har ${out.errors.length} feil – se Kontroll.`);
  }
  async downloadProject() {
    const images = {};
    for (const lv of this.doc.levels) {
      const im = this.images.get(lv.id);
      if (!im) continue;
      const bm = im.original?.bitmap ?? im.bitmap;
      const c = document.createElement('canvas');
      c.width = bm.width;
      c.height = bm.height;
      c.getContext('2d').drawImage(bm, 0, 0);
      images[lv.id] = c.toDataURL('image/png');
    }
    download(`${slug(this.doc.name, 'plan')}-planbygger.json`, JSON.stringify({ format: 'planbygger/1', doc: this.doc, images }));
  }
  async _openProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'planbygger/1' || !data.doc?.levels) throw new Error('ikke et planbygger-prosjekt');
      this.doc = data.doc;
      this.li = 0;
      this.images.clear();
      this.hist.clear();
      for (const lv of this.doc.levels) {
        const url = data.images?.[lv.id];
        if (!url) continue;
        const blob = await (await fetch(url)).blob();
        await this._loadImageBlob(lv, blob);
      }
      this.startEl.hidden = true;
      this._afterLevelChange();
      this._saveSoon();
    } catch (err) {
      this.toast(`Klarte ikke å åpne prosjektet: ${err.message}`);
    }
  }

  // ---- 3D
  async open3d() {
    if (!this.doc?.levels.some((l) => l.walls.length)) return;
    this._busy('Bygger 3D-huset …');
    try {
      const out = await this._validate();
      if (out.fatal) {
        this.toast(out.fatal);
        return;
      }
      this._lastCheck = out;
      if (!this.viewer) {
        const { createViewer } = await import('./viewer.js');
        this.view3d.innerHTML = '';
        const info = h('span', { class: 'pb-note' });
        this.modeBtn = h('button', { class: 'pb-btn is-primary', onclick: () => this._toggleWalk() }, 'Gå inn i huset');
        this.levelSel = h('select', { class: 'pb-btn', onchange: (e) => this.viewer.showLevel(e.target.value || null) });
        // a generated house: «Finjuster» opens the editor on it; «Tegningene» goes back to the drawing stack
        this.backBtn = h('button', { class: 'pb-btn pb-finetune', onclick: () => this.close3d() }, '← Tilbake til planen');
        this.stackBtn = h('button', { class: 'pb-btn', title: 'Tilbake til tegningene: endre dem og generer på nytt', onclick: () => this._backToStack() }, 'Tegningene');
        // the facade check: the house seen from outside, side by side, to set the windows and doors (facadecheck.js)
        this.facadeBtn = h('button', { class: 'pb-btn', title: 'Se huset utenfra side for side og rett vinduer og dører', onclick: () => this.openFacades() }, 'Fasader');
        // the stair placer: drag the stair into place on the plan (stairplace.js)
        this.stairBtn = h('button', { class: 'pb-btn', title: 'Plasser trappa mellom etasjene på planen', onclick: () => this.openStairs() }, 'Trapp');
        // the dollhouse with the roof on: the house seen from outside
        this.roofBtn = h('button', { class: 'pb-btn', title: 'Se huset utenfra med tak (dukkehuset uten tak viser rommene)', onclick: () => {
          this.viewer.setRoof(!this.viewer.roofShown);
          this.roofBtn.textContent = this.viewer.roofShown ? 'Skjul taket' : 'Vis taket';
        } }, 'Vis taket');
        const bar = h('div', { class: 'pb-view3d-bar' }, this.backBtn, this.stackBtn, this.facadeBtn, this.stairBtn, this.modeBtn, this.roofBtn, this.levelSel, info);
        this.helpEl = h('div', { class: 'pb-view3d-help' });
        this.crosshair = h('div', { class: 'pb-crosshair', hidden: true });
        this.view3d.append(bar, this.helpEl, this.crosshair);
        this.view3d.hidden = false;
        this.viewer = createViewer(this.view3d, { onInfo: (t) => (info.textContent = t) });
      }
      this.view3d.hidden = false;
      const generated = !!this.doc.generated;
      this.backBtn.textContent = generated ? 'Finjuster' : '← Tilbake til planen';
      this.backBtn.title = generated ? 'Rett vegger, dører, vinduer og rom i 2D-editoren' : '';
      this.stackBtn.hidden = !(generated && this.stack && this.gen);
      this.stairBtn.hidden = this.doc.levels.length < 2;
      await this.viewer.load(out.ex.house);
      this.levelSel.innerHTML = '';
      this.levelSel.append(h('option', { value: '' }, 'Alle etasjer'), ...out.ex.house.levels.map((l) => h('option', { value: l.id }, l.name)));
      this.levelSel.hidden = out.ex.house.levels.length < 2;
      this.viewer.setMode('orbit');
      this._modeUi();
      this._stepState();
      if (out.errors.length) this.toast(`Huset har ${out.errors.length} feil i kontrollen – det kan se rart ut. Se Kontroll i panelet.`, 7);
    } catch (err) {
      console.error(err);
      this.toast(`Klarte ikke å bygge 3D-huset: ${err.message}`);
    } finally {
      this._busy(null);
    }
  }
  _toggleWalk() {
    this.viewer.setMode(this.viewer.mode === 'walk' ? 'orbit' : 'walk');
    this._modeUi();
  }
  _modeUi() {
    const walk = this.viewer.mode === 'walk';
    this.modeBtn.textContent = walk ? 'Se huset ovenfra' : 'Gå inn i huset';
    this.helpEl.innerHTML = walk
      ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> gå · hold høyre museknapp og dra for å se rundt · <kbd>Shift</kbd> løp · <kbd>E</kbd> eller klikk åpner dører'
      : 'Dra for å snu huset · hjulet zoomer · høyre knapp eller WASD flytter · «Gå inn i huset» for å gå rundt';
    this.levelSel.disabled = walk;
    this.roofBtn.hidden = walk;
  }
  close3d() {
    if (this.viewer?.mode === 'walk') this.viewer.setMode('orbit');
    this.view3d.hidden = true;
    this._stepState();
  }
  /** From 3D back to the drawing stack (the same files; «Generer» again). */
  _backToStack() {
    this.close3d();
    this._openStackView();
  }
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/**
 * The first page of a PDF as a PNG blob (stack.js renderPdf: at the embedded scan's resolution, or 200 dpi) – only that
 * page is rendered; the toast says when the PDF has more.
 */
async function pdfToPng(file) {
  const pages = await renderPdf(file, { pages: [1] });
  const [first] = pages;
  if (!first) throw new Error('PDF-en har ingen sider');
  first.bitmap?.close?.();
  if (pages.numPages > 1) window.__planbygger?.toast(`PDF-en har ${pages.numPages} sider – bare den første er brukt. «Slipp alle tegningene her» tar alle sidene.`, 6);
  const c = document.createElement('canvas');
  c.width = first.img.width;
  c.height = first.img.height;
  c.getContext('2d').putImageData(first.img, 0, 0);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

const app = new App(document.getElementById('planbygger'));
window.__planbygger = app;
