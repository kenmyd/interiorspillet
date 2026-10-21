/**
 * Planbygger – the page (planbygger.html): upload a floor plan, set the scale, get the walls, doors and windows
 * proposed automatically (classical image processing, no AI – detect.js), correct them in the 2D editor (editor.js),
 * walk around the 3D house (viewer.js, the game's own builders) and download the house data (export.js, the
 * research/house format the game validates with validateHouse).
 *
 * Everything runs in the browser: the plan never leaves the machine. The document is saved in localStorage (without
 * the images) and the plan images in IndexedDB, so a reload continues where you left off.
 */
import './style.css';
import demoPlanUrl from '../../plantegning.png?url';
import { createDoc, createLevel, applyDetection, history, rescaleLevel, ROOM_KINDS, DEFAULT_SETTINGS, wallLength, splitWall, checkLevel, stairGeometry } from './model.js';
import { Editor, TOOL_HINT } from './editor.js';
import { exportHouse, summary, ownerOnly, baseSpec, alignLevel } from './export.js';
import { luma } from './image.js';
import { traceLine } from './scale.js';
import { detectPlan } from './detect.js';
import { suggestScale } from './scale.js';
import { round, slug, add, sub } from './geom.js';

const STORE_KEY = 'planbygger.v1.doc';
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
function runWorker(kind, img, opts) {
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
  if (!worker) {
    // no module workers: on the main thread
    return Promise.resolve().then(() => (kind === 'detect' ? detectPlan(img, opts) : suggestScale(img)));
  }
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, kind, img: { width: img.width, height: img.height, data: img.data }, opts });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// the page

class App {
  constructor(root) {
    this.root = root;
    this.doc = null;
    this.li = 0;
    this.images = new Map(); // level id → { bitmap, imageData, grey }
    this.hist = history(120);
    this.sel = null;
    this.viewer = null;
    this.thickness = 0.1;
    this._build();
    this._restore();
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

    this.toolEls = {};
    const tools = h('aside', { class: 'pb-tools' },
      TOOLS.map(([id, label, key]) => (this.toolEls[id] = h('button', { class: 'pb-tool', title: `${label} (${key})`, html: `${ICONS[id]}<kbd>${key}</kbd>`, onclick: () => this.setTool(id) }))),
      h('hr'),
      h('button', { class: 'pb-tool', title: 'Hele planen (0)', html: `${ICONS.fit}<kbd>0</kbd>`, onclick: () => this.editor?.fit() }));

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
    this.fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf', style: 'display:none', onchange: (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this._onFile(f, this._pendingLevel);
    } });
    this.projectInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this._openProject(f);
    } });
    r.append(this.fileInput, this.projectInput);

    window.addEventListener('keydown', (e) => this._key(e));
    window.addEventListener('keyup', (e) => this.editor?.key(e));
    // drop anywhere
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) this._onFile(f, this.doc && this.level?.image ? null : undefined);
    });
  }

  _renderStart(saved) {
    const s = this.startEl;
    s.innerHTML = '';
    const drop = h('div', { class: 'pb-drop', onclick: () => this._pickFile() },
      h('strong', {}, 'Slipp plantegningen her, eller klikk for å velge fil'),
      'PNG, JPG eller PDF (første side). Planer med tykke, mørke vegger fungerer best.');
    drop.addEventListener('dragenter', () => drop.classList.add('is-over'));
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    const card = h('div', { class: 'pb-start-card' },
      h('h1', {}, 'Fra plantegning til 3D-hus'),
      h('p', {}, 'Last opp plantegningen. Sett skalaen med én målelinje, så foreslår planbyggeren vegger, dører og vinduer. Rett opp det som er feil, gi rommene navn, og gå rundt i huset ditt i 3D.'),
      drop,
      h('div', { class: 'pb-start-foot' },
        h('button', { class: 'pb-btn', onclick: () => this._demo() }, 'Prøv med eksempelplanen'),
        saved ? h('button', { class: 'pb-btn is-primary', onclick: () => this._continueSaved(saved) }, `Fortsett med «${saved.name}»`) : null,
        h('button', { class: 'pb-btn', onclick: () => this.projectInput.click() }, 'Åpne prosjekt …'),
        h('span', { class: 'pb-note' }, 'Ingenting lastes opp: alt skjer i nettleseren.')));
    s.append(card);
    s.hidden = false;
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
    } catch (err) {
      console.error(err);
      this.toast(`Klarte ikke å lese fila: ${err.message}`);
    } finally {
      this._busy(null);
    }
  }

  async _loadImageBlob(lv, blob, { name, store = true } = {}) {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bitmap, 0, 0);
    const imageData = g.getImageData(0, 0, c.width, c.height);
    const grey = luma(imageData);
    if (name || !lv.image) lv.image = { ...(lv.image || {}), name: name ?? lv.image?.name ?? 'plan', width: bitmap.width, height: bitmap.height, pxPerM: name ? null : lv.image?.pxPerM ?? null };
    this.images.set(lv.id, { bitmap, imageData, grey });
    if (store) await idbPut(lv.id + ':' + lv.image.name, blob);
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
    if (!L.image.pxPerM) return 'Steg 2: Klikk på en målelinje i planen (f.eks. «2.53 m»), eller klikk to punkter med kjent avstand. Skriv inn lengden under.';
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
  async detect() {
    const L = this.level;
    const im = this.images.get(L.id);
    if (!im || !L.image?.pxPerM) return;
    this._busy('Gjenkjenner vegger, dører og vinduer …');
    try {
      const t0 = performance.now();
      const det = await runWorker('detect', im.imageData, { pxPerM: L.image.pxPerM, ...(L.detect || {}) });
      this.snapshot();
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
  }
  redo() {
    const d = this.hist.redo(this.doc);
    if (!d) return;
    this.doc = d;
    this.editor.refresh();
    this._refreshAll();
    this._saveSoon();
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
      const typeSel = h('select', { onchange: (e) => set(() => {
        o.type = e.target.value;
        if (o.type === 'door') {
          o.hinge ??= 'start';
          o.side ??= 1;
        }
        if (o.type === 'window') {
          o.sill ??= this.doc.settings.windowSill;
          o.height ??= this.doc.settings.windowHeight;
        }
      }, 'Type') },
      ['door', 'window', 'opening'].map((t) => h('option', { value: t, selected: o.type === t }, { door: 'Dør', window: 'Vindu', opening: 'Åpning uten dør' }[t])));
      box.append(h('h3', {}, { door: 'Dør', window: 'Vindu', opening: 'Åpning' }[o.type] ?? 'Åpning'),
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
      if (o.type === 'door') {
        box.append(h('div', { class: 'pb-row' },
          h('button', { class: 'pb-btn is-small', onclick: () => set(() => (o.hinge = o.hinge === 'end' ? 'start' : 'end'), 'Snudde hengsel') }, 'Snu hengselen (H)'),
          h('button', { class: 'pb-btn is-small', onclick: () => set(() => (o.side = -(o.side || 1)), 'Snudde slagretning') }, 'Snu slagretningen (G)')));
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
      const going = risers ? g.length / (risers - 1) : null;
      const set = (fn, label) => {
        this.snapshot();
        fn();
        this.changed(label);
      };
      box.append(h('h3', {}, 'Trapp'),
        h('p', {}, `${fmt(g.width)} × ${fmt(g.length)} m`),
        below
          ? h('p', { class: 'pb-note' }, `Ned til ${below.name}: ${risers} opptrinn à ${fmt(rise / risers, 3)} m, inntrinn ${fmt(going, 3)} m${going < 0.22 ? ' – for bratt for en rett trapp (minst 0,22): gjør hullet lengre' : ''}.`)
          : h('p', { class: 'pb-note' }, 'Det er ingen etasje under denne. Legg til en etasje (+ Etasje) med lavere gulvhøyde.'),
        h('div', { class: 'pb-row' },
          h('button', { class: 'pb-btn is-small', onclick: () => set(() => (st.down = -st.down), 'Snudde trappa') }, 'Snu retningen'),
          h('button', { class: 'pb-btn is-small', title: 'Løpet på tvers: for en trapp der løpet er kortere enn bredden', onclick: () => set(() => (st.axis = st.axis === 'x' ? 'y' : 'x'), 'Dreide trappa') }, 'Drei 90°'),
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
    let warnings = [...ex.report.warnings, ...local];
    try {
      const H = await import('../data/scripts/house.mjs');
      const spec = H.mergeHouse(baseSpec(this.doc.name), null, { files: [{ name: '10-plan.json', data: ex.house }], registry: ex.registry });
      // no furniture in a generated house: no archetypes needed (the validator would read archetypes.json from disk)
      const rep = H.validateHouse(spec, { registry: ex.registry, archetypes: { archetypes: {}, archetypeAliases: {} }, throw: false });
      errors = rep.errors.filter((m) => !ownerOnly(m));
      warnings = [...warnings, ...rep.warnings];
    } catch (err) {
      console.warn('[planbygger] validatoren kunne ikke kjøres', err);
      warnings.push(`Spillets validator kunne ikke kjøres: ${err.message}`);
    }
    return { ex, errors, warnings, sum: summary(ex.house) };
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

  // ---- dialogs
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
          else input = h('input', { type: 'text', value: f.value ?? '', placeholder: f.placeholder ?? '' });
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
      { key: 'name', label: 'Navn', value: r.name },
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
      const c = document.createElement('canvas');
      c.width = im.bitmap.width;
      c.height = im.bitmap.height;
      c.getContext('2d').drawImage(im.bitmap, 0, 0);
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
        const bar = h('div', { class: 'pb-view3d-bar' },
          h('button', { class: 'pb-btn', onclick: () => this.close3d() }, '← Tilbake til planen'), this.modeBtn, this.levelSel, info);
        this.helpEl = h('div', { class: 'pb-view3d-help' });
        this.crosshair = h('div', { class: 'pb-crosshair', hidden: true });
        this.view3d.append(bar, this.helpEl, this.crosshair);
        this.view3d.hidden = false;
        this.viewer = createViewer(this.view3d, { onInfo: (t) => (info.textContent = t) });
      }
      this.view3d.hidden = false;
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
      : 'Dra for å snu huset · hjulet zoomer · høyre knapp flytter · «Gå inn i huset» for å gå rundt';
    this.levelSel.disabled = walk;
  }
  close3d() {
    if (this.viewer?.mode === 'walk') this.viewer.setMode('orbit');
    this.view3d.hidden = true;
    this._stepState();
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
 * The first page of a PDF as a PNG blob (pdf.js from a CDN, loaded only when a PDF is opened – no build dependency).
 * Rendered at 150 dpi-ish (the page's long side ≈ 2400 px).
 */
async function pdfToPng(file) {
  const V = '4.10.38';
  const pdfjs = await import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/pdfjs-dist@${V}/build/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${V}/build/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const scale = 2400 / Math.max(v1.width, v1.height);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

const app = new App(document.getElementById('planbygger'));
window.__planbygger = app;
