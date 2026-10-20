// The high-wall panel (ARCHITECTURE §9/§12): a proposal browser with live preview, details and «Bruk dette
// forslaget», plus an element editor (paramEditor per element, add/duplicate/remove, wall paint, «Lagre som mitt
// forslag», «Tilbakestill»). Opens on a click on the high wall (editor.select({ kind: 'wall', wallId })) or with V.
import * as THREE from 'three';
import {
  BasePanel, section, button, select, textInput, colorPicker, paramEditor, emptyState, confirmDialog,
  paletteColors, assetUrl, isFormFocused,
} from './panelKit.js';
import { h, svg } from './dom.js';
import { ICONS } from './icons.js';
import wallData from '../data/wall-proposals.json';
import { computeAcoustics } from '../design/Acoustics.js';
import { resolveColor } from '../home/materials.js';
import { PLAYER } from '../config.js';
import {
  applyWallDesign, buildWallDesign, disposeDesign, ELEMENT_TYPES, elementEditor, elementValues, setElementParam,
  createElement, describeElement, elementBounds, elementAbsorption, setWallQuality, placeElement,
} from '../models/walldesigns.js';

/**
 * WallPanel(editor) – open(sel?) / close() / toggle() / isOpen / update(dt) / dispose() (BasePanel).
 *   flip(dir) · previewProposal(id) · useShown() · compare() · frameWall() / returnFromWall() («Se hele veggen»)
 *
 * Browsing is a PREVIEW: flipping through proposals (cards, ◀ ▶, ← →) rebuilds only the 3D wall (and its paint and
 * lights) without touching DesignState; «Bruk dette forslaget» commits it (design.setWallProposal → one undo step).
 * Closing the panel or any design change ends the preview and shows the design again.
 * Editing works on the design: slider drags/colour drags update the scene live, the release commits one step.
 *
 * The status bar (◀ ▶, name, etterklang, actions, tabs) sits between the panel header and the scrolling body, so
 * nothing scrolls under it. Opening the panel from close up (or «Se hele veggen») walks the player to the montage
 * standpoint with the whole wall framed in the part of the view the panel leaves free; closing walks back when the
 * player has not moved since.
 *
 * Performance: the built-in proposals have static thumbnails (img/forslag/thumb/<id>.jpg; montage photos for the
 * round-1 proposals); only «Mine forslag» get a rendered thumbnail – at save time from the scene, or later, one at a
 * time for visible cards after compileAsync. The proposals' materials are compiled once in idle time
 * (renderer.compileAsync, KHR_parallel_shader_compile) so the first preview of a proposal does not stall on shaders.
 *
 * Custom proposals («Mine forslag») live in localStorage (interiorspillet.wallCustom.v1); the active one is also in
 * the design itself (wall.proposalId 'mitt-…' + wall.elements), but its name is only known in this browser.
 * Also extra: collision boxes for wall elements that stick out (curtain, sideboard, plant …) unless SceneSync
 * does it (home.sync.wallColliders).
 */

const STORE_KEY = 'interiorspillet.wallCustom.v1';
const PROPOSALS = wallData.proposals || [];
const GROUPS = [
  { id: 'r1', label: 'Første forslag', match: (g) => /^Runde 1/i.test(g) },
  { id: 'kunst', label: 'Kunst og mønster', match: (g) => /^Kunst/i.test(g) },
  { id: 'sjakk', label: 'Sjakkbrett-farger', match: (g) => /^Sjakk/i.test(g) },
  { id: 'nye-retn', label: 'Nye retninger', match: (g) => /^Nye retninger/i.test(g) },
  { id: 'nye', label: 'Nye forslag', match: (g) => /^Nye forslag/i.test(g) },
];
const ICON_NEXT = ICONS.back.replace('M15 5l-7 7 7 7', 'M9 5l7 7-7 7');
const ICON_COPY = ICONS.back.replace('<path d="M15 5l-7 7 7 7"/>', '<rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V6.5a2 2 0 0 1 2-2h8.5"/>');
const ICON_TRASH = ICONS.back.replace('<path d="M15 5l-7 7 7 7"/>', '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/>');
const ICON_FRAME = ICONS.back.replace('<path d="M15 5l-7 7 7 7"/>', '<path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>');
const fmt = (v, d = 2) => Number(v).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Palette swatches without duplicates (same hex): the longest (most descriptive) name wins, first position kept. */
function dedupePalette(list) {
  const by = new Map();
  for (const c of list) {
    const hex = String(resolveColor(c.hex, c.hex) || '').toLowerCase();
    if (!hex) continue;
    const cur = by.get(hex);
    if (!cur || String(c.name || '').length > String(cur.name || '').length) by.set(hex, { ...c, hex });
  }
  return [...by.values()];
}
const HIGH_PAINT_PALETTE = dedupePalette([...paletteColors('walls'), ...paletteColors('paints')]);

/** Static thumbnails of the built-in proposals that have no montage (null until probed; false = missing). */
const STATIC_THUMB = new Map();

function loadCustom() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.elements)) : [];
  } catch {
    return [];
  }
}

function saveCustom(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function groupLabel(p) {
  if (p.custom) return 'Mine forslag';
  return GROUPS.find((g) => g.match(p.group || ''))?.label || p.group || 'Andre';
}

function rankBadges(p) {
  const out = [];
  if (p.rank) out.push({ text: `Nr. ${p.rank}`, tone: 'accent' });
  if (p.recommended) out.push({ text: 'Anbefalt', tone: 'ok' });
  return out;
}

const pill = (text, tone) => h(`span.ip-badge.ip-badge--${tone}`, { text });

let stylesAdded = false;
function addStyles() {
  if (stylesAdded) return;
  stylesAdded = true;
  const css = `
.wp-panel .ip-panel__body { padding-top: 0.85em; }
.wp-status { flex: none; padding: 0.5em 0.85em 0; border-bottom: 1px solid var(--kv-line); }
.wp-flip { display: flex; align-items: center; gap: 0.45em; }
.wp-flip__name { flex: 1; min-width: 0; text-align: center; }
.wp-flip__code { font-size: 0.7em; font-weight: 750; letter-spacing: 0.07em; text-transform: uppercase; color: var(--kv-ink-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-flip__code .is-preview { color: #ffc850; } .wp-flip__code .is-used { color: #8be6b4; } .wp-flip__code .is-rank { color: var(--kv-accent-2); }
.wp-flip__title { font-weight: 700; font-size: 0.98em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-flip .kv-iconbtn { flex: none; width: 2.1em; height: 2.1em; }
.wp-meta { display: flex; flex-wrap: wrap; gap: 0.15em 0.75em; align-items: center; justify-content: center; margin-top: 0.3em;
  font-size: 0.8em; color: var(--kv-ink-2); font-variant-numeric: tabular-nums; }
.wp-rt { display: inline-flex; align-items: center; gap: 0.4em; font-weight: 700; color: var(--kv-ink); }
.wp-rt i { width: 0.6em; height: 0.6em; border-radius: 50%; background: var(--kv-ink-3); box-shadow: 0 0 0.45em currentColor; }
.wp-rt--green i { background: var(--kv-ok); color: var(--kv-ok); }
.wp-rt--yellow i { background: #ffc850; color: #ffc850; }
.wp-rt--red i { background: var(--kv-danger); color: var(--kv-danger); }
.wp-meta small { color: var(--kv-ink-3); font-size: 1em; }
.wp-actions { display: flex; gap: 0.4em; margin-top: 0.5em; }
.wp-actions .kv-btn { height: 2.15em; font-size: 0.8em; padding: 0 0.62em; gap: 0.35em; white-space: nowrap; }
.wp-actions .wp-use { flex: 1 1 auto; min-width: 0; justify-content: center; }
.wp-actions .wp-use span { overflow: hidden; text-overflow: ellipsis; }
.wp-actions .wp-use[disabled] { opacity: 1; cursor: default; color: #8be6b4; border-color: rgba(139, 230, 180, 0.35); background: rgba(139, 230, 180, 0.07); }
.wp-actions .wp-frame.is-active { color: var(--kv-accent-2); border-color: var(--kv-accent); }
.wp-status .ip-tabs { margin: 0.5em -0.85em 0; border-radius: 0; }
.wp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55em; }
.wp-card { position: relative; display: flex; flex-direction: column; border-radius: var(--kv-r); overflow: hidden; cursor: pointer;
  border: 1px solid var(--kv-line); background: var(--kv-surface); transition: border-color 0.15s, background 0.15s, transform 0.15s var(--kv-ease); }
.wp-card:hover { border-color: var(--kv-line-2); background: var(--kv-surface-2); }
.wp-card:focus-visible { outline: 2px solid var(--kv-accent); outline-offset: 2px; }
.wp-card.is-shown { border-color: var(--kv-accent); box-shadow: 0 0 0 1px var(--kv-accent) inset; }
.wp-card.is-used .wp-card__img::after { content: 'I bruk'; position: absolute; left: 0.4em; bottom: 0.4em; padding: 0.15em 0.5em; border-radius: 1em;
  font-size: 0.68em; font-weight: 750; background: var(--kv-accent); color: var(--kv-accent-ink); }
.wp-card__img { position: relative; aspect-ratio: 5 / 4; background: #1f2934 center 38% / cover no-repeat; }
/* montage thumbnails: show the photo part only (1270 × 952 of 1288 × 1030, the caption strip is cut off) */
.wp-card__img.is-montage { background-size: 108.2% auto; background-position: 41% 0; }
.wp-card__img.is-render { background-position: center; background-size: cover; }
.wp-card__img.is-loading::before { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%) 0 0 / 200% 100%;
  animation: wp-shimmer 1.2s linear infinite; }
@keyframes wp-shimmer { to { background-position: -200% 0; } }
.wp-card__code { position: absolute; top: 0.4em; left: 0.4em; min-width: 1.9em; padding: 0.12em 0.4em; border-radius: 0.4em; text-align: center;
  font-size: 0.72em; font-weight: 800; background: rgba(10, 14, 20, 0.78); color: #fff; }
.wp-card__badges { position: absolute; top: 0.4em; right: 0.4em; display: flex; flex-direction: column; align-items: flex-end; gap: 0.2em; }
.wp-card__badges .ip-badge { background: rgba(10, 14, 20, 0.82); }
.wp-card__badges .ip-badge--ok { color: #8be6b4; } .wp-card__badges .ip-badge--accent { color: var(--kv-accent-2); }
.wp-card__body { padding: 0.45em 0.55em 0.55em; display: flex; flex-direction: column; gap: 0.2em; }
.wp-card__title { font-weight: 650; font-size: 0.84em; line-height: 1.22; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.44em; }
.wp-card__meta { display: flex; flex-direction: column; gap: 0.1em; font-size: 0.74em; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.wp-card__meta b { color: var(--kv-accent-2); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-details { margin-bottom: 1.1em; padding: 0.7em 0.85em 0.75em; border-radius: var(--kv-r); background: var(--kv-surface); border: 1px solid var(--kv-line); }
.wp-details__title { font-weight: 700; font-size: 0.92em; }
.wp-details p { margin: 0.4em 0 0; color: var(--kv-ink-2); font-size: 0.86em; line-height: 1.5; }
.wp-details .wp-price { margin-top: 0.45em; font-weight: 750; color: var(--kv-accent-2); font-size: 0.88em; }
.wp-tip { margin-top: 0.6em; padding: 0.55em 0.65em; border-radius: var(--kv-r); background: rgba(255, 181, 46, 0.07); border: 1px solid rgba(255, 181, 46, 0.25); }
.wp-tip p { margin: 0 0 0.45em; font-size: 0.82em; }
.wp-more { margin-top: 0.55em; }
.wp-more summary { cursor: pointer; font-weight: 650; font-size: 0.84em; color: var(--kv-ink-2); list-style: none; display: flex; align-items: center; gap: 0.45em; }
.wp-more summary::-webkit-details-marker { display: none; }
.wp-more summary::before { content: '▸'; color: var(--kv-ink-3); transition: transform 0.15s; }
.wp-more[open] summary::before { transform: rotate(90deg); }
.wp-more h4 { margin: 0.75em 0 0.3em; font-size: 0.7em; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kv-ink-3); }
.wp-more ul { margin: 0; padding-left: 1.15em; color: var(--kv-ink-2); font-size: 0.84em; line-height: 1.45; }
.wp-more li { margin: 0.12em 0; }
.wp-more .wp-pros li::marker { content: '+  '; color: var(--kv-ok); font-weight: 800; }
.wp-more .wp-cons li::marker { content: '–  '; color: #ffb3aa; font-weight: 800; }
.wp-els { display: flex; flex-direction: column; gap: 0.4em; }
.wp-el { border-radius: var(--kv-r); border: 1px solid var(--kv-line); background: var(--kv-surface); }
.wp-el.is-selected { border-color: var(--kv-accent); background: rgba(255, 181, 46, 0.06); }
.wp-el__head { display: flex; align-items: center; gap: 0.5em; padding: 0.45em 0.45em 0.45em 0.7em; cursor: pointer; }
.wp-el__text { flex: 1; min-width: 0; }
.wp-el__type { font-weight: 650; font-size: 0.9em; }
.wp-el__desc { font-size: 0.76em; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-el__abs { font-size: 0.74em; color: #8be6b4; font-variant-numeric: tabular-nums; white-space: nowrap; }
.wp-el__head .kv-iconbtn { width: 1.9em; height: 1.9em; flex: none; }
.wp-el__head .kv-iconbtn .kv-icon { width: 1.05em; height: 1.05em; }
.wp-el__body { padding: 0.2em 0.75em 0.7em; border-top: 1px solid var(--kv-line); }
.wp-add { display: flex; gap: 0.45em; margin-top: 0.65em; }
.wp-add .ip-select { flex: 1; }
.wp-foot { display: flex; flex-wrap: wrap; gap: 0.45em; }
.wp-note { margin: 0.4em 0 0; font-size: 0.8em; color: var(--kv-ink-3); line-height: 1.45; }
.wp-save { display: flex; gap: 0.45em; margin-top: 0.6em; }
.wp-save .ip-input { flex: 1; }
/* photo comparison: only the switcher stays (see also panels.css #ui-root.pc-active) */
#ui-root.pc-active .wp-panel .ip-panel__body, #ui-root.pc-active .wp-panel .wp-frame { display: none; }
#ui-root.pc-active .wp-panel .wp-status { border-bottom: 0; padding-bottom: 0.7em; }
`;
  document.head.append(h('style', { id: 'wp-styles', text: css }));
}

export class WallPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'wall', title: 'Den høye veggen', icon: 'palette', side: 'right', width: 28, className: 'wp-panel' });
    addStyles();
    const level = editor.game?.settings?.quality?.level;
    if (level) setWallQuality(level);
    this.design = editor.design;
    this.home = editor.home;
    this.hw = editor.home.highWall;
    this.wallId = this.hw?.wallId || 'w-hoy';
    this.custom = loadCustom();
    this.tab = 'forslag';
    this.preview = null; // { id, elements, wallPaint }
    this.live = null; // elements being dragged (scene only)
    this.selIndex = -1;
    this._sceneDirty = false;
    this._thumbs = new Map(); // key → dataURL (rendered thumbnails)
    this._thumbQueue = [];
    this._thumbEls = new Map(); // key → img div
    this._thumbJob = null;
    this._lastThumbAt = 0;
    this._captureFor = null; // custom proposal id whose thumbnail is taken from the scene on the next frame
    this._rtCache = new Map();
    this._highlight = null;
    this._colliders = [];
    this._disposers = [];
    this._frameTw = null; // camera move toward / back from the wall view
    this._frameReturn = null; // where the player stood before «Se hele veggen»
    this._framed = null; // the pose the wall view arrived at
    this._warm = null;

    this._buildDom();

    const d = this.design;
    this._disposers.push(d.on('wall', () => this._onDesignWall()));
    this._disposers.push(d.on('paint', ({ wallId }) => {
      if (wallId === this.wallId) this._onDesignWall();
    }));
    this._disposers.push(d.on('load', () => {
      this.custom = loadCustom();
      this._rtCache.clear();
      this._onDesignWall();
    }));
    this._disposers.push(d.on('change', (e) => {
      const type = e?.type || '';
      if (type !== 'wall' && type !== 'paint' && type !== 'env' && type !== 'history') {
        // furniture/windows changed: the etterklang of every proposal changes with them
        this._rtCache.clear();
        if (this.isOpen && this.tab === 'forslag') this._refreshCardRts();
      }
      if (this.isOpen) this._renderStatus();
    }));

    // ← → flip through the proposals while the panel is open (before the game sees the arrows)
    this._onKey = (e) => {
      if (!this.isOpen || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      if (isFormFocused() || !(this.editor.keysActive?.() ?? true)) return;
      if (this.tab !== 'forslag') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.flip(e.code === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', this._onKey, true);

    // collision for elements that stick out (once the scene has a design)
    queueMicrotask(() => this._syncColliders());
    // compile the proposals' materials: the shader-heavy batch at once, the rest in idle time
    this._startWarm(0);
  }

  // ------------------------------------------------------------------------------------------------- data access

  /** All proposals in flip order (data order, then «Mine forslag»). */
  proposals() {
    return [...PROPOSALS, ...this.custom.map((c) => ({ ...c, custom: true, group: 'Mine forslag' }))];
  }

  proposal(id) {
    if (id == null) return null;
    return this.proposals().find((p) => p.id === String(id)) || null;
  }

  /** The wall the scene shows: the preview, or the design's wall. */
  shown() {
    if (this.preview) return { proposalId: this.preview.id, elements: this.preview.elements, edited: false, paint: this.preview.wallPaint ?? null, preview: true };
    const w = this.design.wall || {};
    return { proposalId: w.proposalId ?? null, elements: w.elements || [], edited: !!w.edited, paint: this.design.paints?.[this.wallId] ?? null, preview: false };
  }

  /** A copy of the elements the editor works on (the preview's while one is shown). */
  _elements() {
    return clone((this.preview ? this.preview.elements : this.design.wall?.elements) || []);
  }

  // ------------------------------------------------------------------------------------------------- DOM

  _buildDom() {
    const status = h('div.wp-status');
    this.statusEl = status;
    this.prevBtn = h('button.kv-iconbtn', { type: 'button', title: 'Forrige forslag (←)', 'aria-label': 'Forrige forslag', on: { click: () => this.flip(-1) } }, svg(ICONS.back));
    this.nextBtn = h('button.kv-iconbtn', { type: 'button', title: 'Neste forslag (→)', 'aria-label': 'Neste forslag', on: { click: () => this.flip(1) } }, svg(ICON_NEXT));
    this.codeEl = h('div.wp-flip__code');
    this.titleEl = h('div.wp-flip__title');
    this.metaEl = h('div.wp-meta');
    this.stateEl = h('div.wp-state', { hidden: true });
    // «Bruk» keeps its place when the proposal is in use (disabled «I bruk i designet»), so nothing jumps
    this.useBtn = button({ label: 'Bruk dette forslaget', icon: 'check', variant: 'primary', onClick: () => this.useShown() });
    this.useBtn.classList.add('wp-use');
    this.compareBtn = button({ label: 'Sammenlign', variant: 'ghost', title: 'Sammenlign med fotomontasjen', onClick: () => this.compare() });
    this.frameBtn = h('button.kv-btn.kv-btn--ghost.wp-frame', { type: 'button', title: 'Gå dit du ser hele veggen', on: { click: () => (this._isFramed() ? this.returnFromWall() : this.frameWall()) } },
      svg(ICON_FRAME), h('span', { text: 'Hele veggen' }));
    status.append(
      h('div.wp-flip', {}, this.prevBtn, h('div.wp-flip__name', {}, this.codeEl, this.titleEl), this.nextBtn),
      this.metaEl,
      this.stateEl,
      h('div.wp-actions', {}, this.useBtn, this.compareBtn, this.frameBtn),
    );
    this.tabsCtl = this._tabs();
    status.append(this.tabsCtl.el);
    // the status bar does not scroll: it sits between the header and the body
    this.el.insertBefore(status, this.body);
    this.content = h('div.wp-content');
    this.body.append(this.content);
  }

  _tabs() {
    const ctl = { el: null, set: null };
    const mk = (id, label) => h('button.kv-tab', { type: 'button', role: 'tab', dataset: { tab: id }, on: { click: () => this.setTab(id) } }, h('span', { text: label }));
    const a = mk('forslag', 'Forslag'), b = mk('rediger', 'Rediger');
    ctl.el = h('div.kv-tabs.ip-tabs', { role: 'tablist' }, a, b);
    ctl.set = (id) => {
      for (const btn of [a, b]) {
        btn.classList.toggle('is-active', btn.dataset.tab === id);
        btn.setAttribute('aria-selected', btn.dataset.tab === id ? 'true' : 'false');
      }
    };
    return ctl;
  }

  setTab(id) {
    const next = id === 'rediger' ? 'rediger' : 'forslag';
    const changed = next !== this.tab;
    this.tab = next;
    this.tabsCtl.set(this.tab);
    this._renderContent();
    if (changed) this.body.scrollTop = 0;
    this._updateHighlight();
  }

  // ------------------------------------------------------------------------------------------------- open/close

  /** @param {{ kind?: string, wallId?: string, point?: THREE.Vector3 }|undefined} sel */
  onOpen(sel) {
    this.custom = loadCustom();
    this._startWarm(400);
    // a click on the wall: pick the element under the cursor in the editor
    const hit = this._wallHit(sel);
    if (hit) {
      const i = this._elementAt(hit.u, hit.v);
      if (i >= 0) {
        this.selIndex = i;
        if (this.isOpen && this.tab === 'rediger') {
          this._renderContent();
          this._updateHighlight();
          return;
        }
      }
    }
    const wasOpen = this.isOpen;
    if (!wasOpen) {
      this.tabsCtl.set(this.tab);
      this._renderStatus();
      this._renderContent();
    }
    queueMicrotask(() => {
      this._updateHighlight();
      // bring the whole wall into view when it was opened from close up (the panel is laid out by now)
      if (!wasOpen && this.isOpen && !this.editor.ui?.photo?.isOpen) requestAnimationFrame(() => this._autoFrame());
    });
  }

  onClose() {
    if (this.preview) {
      this.preview = null;
      this._applyScene();
    }
    if (this.live) {
      this.live = null;
      this._applyScene();
    }
    this._setHighlight(null);
    // back to where the player stood, unless they walked on from the wall view
    if (this._framed && !this._framed.moved) this.returnFromWall();
    else {
      this._framed = null;
      this._frameReturn = null;
    }
    if (this.editor.selected?.kind === 'wall' && this.editor.selected.wallId === this.wallId) {
      // keep the selection state in step with the panel
      queueMicrotask(() => {
        if (!this.isOpen && this.editor.selected?.kind === 'wall') this.editor.select(null);
      });
    }
  }

  /** Wall coordinates of the click that opened the panel (sel.point or the cursor ray). */
  _wallHit(sel) {
    try {
      let p = sel?.point?.isVector3 ? sel.point : null;
      if (!p && sel?.kind === 'wall') {
        const ndc = this.editor.pointerNDC?.();
        const hit = ndc ? this.editor.raycast(ndc, { walls: true }) : null;
        if (hit?.kind === 'wall' && hit.wallId === this.wallId) p = hit.point;
      }
      if (!p || !this.hw?.origin) return null;
      const d = p.clone().sub(this.hw.origin);
      return { u: d.dot(this.hw.uDir), v: p.y };
    } catch {
      return null;
    }
  }

  _elementAt(u, v) {
    const els = this.design.wall?.elements || [];
    let best = -1, area = Infinity;
    els.forEach((el, i) => {
      const b = elementBounds(el);
      if (!b || u < b.u0 || u > b.u1 || v < b.v0 || v > b.v1) return;
      const a = (b.u1 - b.u0) * (b.v1 - b.v0);
      if (a < area) {
        area = a;
        best = i;
      }
    });
    return best;
  }

  // ------------------------------------------------------------------------------------------------- wall view

  /** The part of the canvas the panels leave free, in NDC: { x0, x1, y0, y1 }. */
  _freeArea() {
    const canvas = this.editor.renderer?.domElement;
    const cr = canvas?.getBoundingClientRect();
    if (!cr || !cr.width) return { x0: -0.95, x1: 0.3, y0: -0.7, y1: 0.8 };
    let right = cr.right, left = cr.left;
    const pr = this.el.getBoundingClientRect();
    if (this.isOpen && pr.width) right = Math.min(right, pr.left - 12);
    for (const el of document.querySelectorAll('.ip-panel--left.is-open')) left = Math.max(left, el.getBoundingClientRect().right + 12);
    const bar = document.querySelector('.ip-toolbar');
    const br = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
    const bottom = br && br.height ? Math.min(cr.bottom, br.top - 14) : cr.bottom - 20;
    const top = cr.top + Math.min(70, cr.height * 0.1); // the compass
    const nx = (x) => ((x - cr.left) / cr.width) * 2 - 1;
    const ny = (y) => 1 - ((y - cr.top) / cr.height) * 2;
    return { x0: nx(left + 16), x1: nx(right), y0: ny(bottom), y1: ny(top) };
  }

  /** Wall outline points (world). */
  _wallPoints() {
    const hw = this.hw;
    const W = hw.width ?? 3.91, H = hw.height ?? 3;
    const pts = [];
    for (const u of [0, W / 2, W]) for (const v of [0.05, H / 2, H]) pts.push(hw.origin.clone().addScaledVector(hw.uDir, u).setY(hw.origin.y + v));
    return pts;
  }

  /** Projected extent of the wall through a camera: { x0, x1, y0, y1, behind }. */
  _project(cam) {
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, behind: false };
    cam.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (const w of this._wallPoints()) {
      p.copy(w).applyMatrix4(cam.matrixWorldInverse);
      if (p.z > -0.05) box.behind = true;
      p.copy(w).project(cam);
      box.x0 = Math.min(box.x0, p.x);
      box.x1 = Math.max(box.x1, p.x);
      box.y0 = Math.min(box.y0, p.y);
      box.y1 = Math.max(box.y1, p.y);
    }
    return box;
  }

  /** The montage standpoint with yaw/pitch that centre the whole wall in the free part of the view. */
  _wallViewPose() {
    const game = this.editor.game;
    const player = game?.player, cam = game?.camera;
    const pc = this.editor.layout?.photoCamera?.('0_for');
    if (!player || !cam?.isPerspectiveCamera || !pc?.pos || !this.hw?.origin) return null;
    const feet = new THREE.Vector3(pc.pos.x, this.home.floorY ?? 0, pc.pos.z);
    const eye = feet.clone();
    eye.y += PLAYER?.eyeHeight ?? 1.66;
    const tmp = new THREE.PerspectiveCamera(cam.fov, cam.aspect, 0.05, 100);
    tmp.position.copy(eye);
    tmp.rotation.order = 'YXZ';
    const free = this._freeArea();
    const tx = (free.x0 + free.x1) / 2, ty = (free.y0 + free.y1) / 2;
    const c = this.hw.origin.clone().addScaledVector(this.hw.uDir, (this.hw.width ?? 3.91) / 2).setY(1.5).sub(eye);
    let yaw = Math.atan2(-c.x, -c.z);
    let pitch = Math.atan2(c.y, Math.hypot(c.x, c.z));
    const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
    for (let i = 0; i < 14; i++) {
      tmp.rotation.set(pitch, yaw, 0, 'YXZ');
      const b = this._project(tmp);
      const ex = (b.x0 + b.x1) / 2 - tx, ey = (b.y0 + b.y1) / 2 - ty;
      if (Math.abs(ex) < 0.004 && Math.abs(ey) < 0.004) break;
      yaw -= Math.atan(ex * Math.tan(hHalf)) * 0.9;
      pitch = THREE.MathUtils.clamp(pitch + Math.atan(ey * Math.tan(vHalf)) * 0.9, -0.6, 0.4);
    }
    return { pos: feet, yaw: wrapAngle(yaw), pitch };
  }

  /** At (or on the way to) the wall view. */
  _isFramed() {
    return !!((this._framed && !this._framed.moved) || (this._frameTw && !this._frameTw.back));
  }

  /** The player walks or looks around this frame (keys / mouse look). */
  _userMoves() {
    const inp = this.editor.game?.input;
    return !!inp && (Math.abs(inp.move?.forward || 0) + Math.abs(inp.move?.right || 0) > 0.01 || Math.abs(inp.lookDelta?.x || 0) + Math.abs(inp.lookDelta?.y || 0) > 1e-4);
  }

  /** Opening from close up (or looking past the wall): walk to the wall view by itself. */
  _autoFrame() {
    const v = this.editor.views;
    const cam = this.editor.game?.camera;
    if (!this.isOpen || !cam || (v && (v.mode !== 'walk' || v._tween))) return;
    if (this._frameTw || this._framed) return;
    const b = this._project(cam);
    const f = this._freeArea();
    // the whole width must be clear of the panel; a little of the top/bottom may be cut (ceiling, chairs)
    const framed = !b.behind && b.x0 >= f.x0 - 0.06 && b.x1 <= f.x1 + 0.02 && b.y0 >= f.y0 - 0.25 && b.y1 <= f.y1 + 0.25;
    if (!framed) this.frameWall({ auto: true });
  }

  /**
   * «Se hele veggen»: walks the player (smoothly) to the montage standpoint, the whole wall in the free part of the
   * view. In the dollhouse/plan views the player is put there and the view flies back to walking.
   * @returns {boolean}
   */
  frameWall({ auto = false } = {}) {
    const game = this.editor.game;
    const player = game?.player;
    const v = this.editor.views;
    if (!player?.teleport || (v && v.mode === 'photo')) return false;
    const pose = this._wallViewPose();
    if (!pose) return false;
    if (!this._frameReturn) this._frameReturn = { pos: player.position.clone(), yaw: player.yaw, pitch: player.pitch };
    if (v && v.mode !== 'walk') {
      player.teleport(pose.pos, pose.yaw, pose.pitch);
      this._framed = { moved: false };
      this._frameTw = null;
      v.set?.('walk');
    } else {
      const from = { pos: player.position.clone(), yaw: player.yaw, pitch: player.pitch };
      const dist = from.pos.distanceTo(pose.pos);
      this._framed = null;
      this._frameTw = { t: 0, dur: Math.min(1.2, 0.55 + dist * 0.12) * (auto ? 1.1 : 1), from, to: pose, back: false };
    }
    this._renderStatus();
    return true;
  }

  /** Walks back to where the player stood before «Se hele veggen». */
  returnFromWall() {
    const player = this.editor.game?.player;
    const back = this._frameReturn;
    this._frameReturn = null;
    this._framed = null;
    if (!player?.teleport || !back || this.editor.views?.mode !== 'walk') {
      this._frameTw = null;
      this._renderStatus();
      return;
    }
    const from = { pos: player.position.clone(), yaw: player.yaw, pitch: player.pitch };
    this._frameTw = { t: 0, dur: Math.min(1.1, 0.5 + from.pos.distanceTo(back.pos) * 0.12), from, to: back, back: true };
    this._renderStatus();
  }

  _stepFrame(dt) {
    const tw = this._frameTw;
    if (!tw) return;
    const game = this.editor.game;
    const player = game?.player;
    const v = this.editor.views;
    if (!player || (v && v.mode !== 'walk') || this._userMoves()) {
      // the player took over: stay where they are (no walking back on close)
      this._frameTw = null;
      if (!tw.back) this._framed = null;
      this._renderStatus();
      return;
    }
    tw.t = Math.min(1, tw.t + (dt || 0.016) / tw.dur);
    const k = ease(tw.t);
    const pos = tw.from.pos.clone().lerp(tw.to.pos, k);
    const yaw = tw.from.yaw + wrapAngle(tw.to.yaw - tw.from.yaw) * k;
    const pitch = tw.from.pitch + (tw.to.pitch - tw.from.pitch) * k;
    player.teleport(pos, yaw, pitch);
    if (tw.t >= 1) {
      this._frameTw = null;
      this._framed = tw.back ? null : { moved: false };
      this._renderStatus();
    }
  }

  // ------------------------------------------------------------------------------------------------- proposals

  /** Shows a proposal on the wall (preview, not saved). */
  previewProposal(id) {
    const p = this.proposal(id);
    if (!p) return;
    const w = this.design.wall || {};
    if (String(w.proposalId) === p.id && !w.edited) this.preview = null;
    else this.preview = { id: p.id, elements: clone(p.elements || []), wallPaint: p.wallPaint ?? null };
    this.live = null;
    this._applyScene();
    this._renderStatus();
    this._markCards();
    if (this.tab === 'forslag') this._renderDetails();
    else {
      // the editor lists the elements of what is shown: a stale list would edit/duplicate the wrong elements
      this.selIndex = -1;
      this._renderEditor();
    }
    this._updateHighlight();
    this.editor.ui?.photo?.followProposal?.(p);
  }

  /** ◀ ▶ through every proposal (wraps). */
  flip(dir) {
    const list = this.proposals();
    if (!list.length) return;
    const cur = this.shown().proposalId;
    let i = list.findIndex((p) => p.id === String(cur));
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = list[(i + dir + list.length) % list.length];
    this.previewProposal(next.id);
    this._scrollToCard(next.id);
    this.editor.events?.emit?.('sfx', { name: 'ui-click' });
  }

  /** Commits the shown (previewed) proposal to the design. */
  useShown() {
    const p = this.preview ? this.proposal(this.preview.id) : null;
    if (!p) return;
    this.preview = null;
    this._commitProposal(p);
    this.editor.events?.emit?.('toast', { text: p.custom ? `«${p.name}» er tatt i bruk` : `Veggforslag ${p.code} er tatt i bruk`, seconds: 2.5 });
  }

  _commitProposal(p) {
    const d = this.design;
    if (p.custom) {
      d.transaction(`Veggforslag ${p.name}`, () => {
        d.setWall({ proposalId: p.id, elements: clone(p.elements), edited: false });
        d.setPaint(this.wallId, p.wallPaint || null);
      });
    } else d.setWallProposal(p.id);
  }

  /** Opens the photo comparison through the montage camera (PhotoCompare picks the montage, or «Bare 3D»). */
  compare() {
    const photo = this.editor.ui?.photo;
    const cam = this.editor.layout?.photoCamera?.('0_for');
    if (!photo?.open || !cam) {
      this.editor.events?.emit?.('toast', { text: 'Fotosammenligningen er ikke tilgjengelig' });
      return;
    }
    const p = this.proposal(this.shown().proposalId);
    photo.open(cam, null, { proposal: p, follow: true });
    this._updateHighlight();
  }

  // ------------------------------------------------------------------------------------------------- N14: table to the bench

  /**
   * When the wall has a built-in bench (sideboard-floating use 'bench'): how to move the dining table up to it –
   * { table, shift, moves: [{ uid, position }], hide: [uid] } or null (no bench, no table, or already there).
   */
  _benchPlan(elements) {
    const bench = (elements || []).find((e) => e?.type === 'sideboard-floating' && e.use === 'bench');
    const hw = this.hw;
    if (!bench || !hw?.origin) return null;
    const bb = elementBounds(bench);
    const n = new THREE.Vector2(hw.normal.x, hw.normal.z).normalize();
    const ud = new THREE.Vector2(hw.uDir.x, hw.uDir.z).normalize();
    const o = new THREE.Vector2(hw.origin.x, hw.origin.z);
    const items = [...this.design.items.values()].filter((it) => !it.hidden && Array.isArray(it.position));
    const table = items.find((it) => it.refId === 'f-spisebord') || items.find((it) => /dining-table/.test(it.archetype || ''));
    if (!table) return null;
    const rel = (it) => new THREE.Vector2(it.position[0], it.position[2]).sub(o);
    const r = THREE.MathUtils.degToRad(table.rotationDeg || 0);
    const lx = new THREE.Vector2(Math.cos(r), -Math.sin(r)), lz = new THREE.Vector2(Math.sin(r), Math.cos(r));
    const tw = table.dims?.w ?? 2, td = table.dims?.d ?? 1;
    const halfN = (tw / 2) * Math.abs(lx.dot(n)) + (td / 2) * Math.abs(lz.dot(n));
    const halfU = (tw / 2) * Math.abs(lx.dot(ud)) + (td / 2) * Math.abs(lz.dot(ud));
    const tc = rel(table);
    const tDist = tc.dot(n), tU = tc.dot(ud);
    // the table must stand in front of the bench
    if (tU + halfU < bb.u0 + 0.2 || tU - halfU > bb.u1 - 0.2) return null;
    const shift = tDist - halfN - (bb.depth + 0.05);
    if (shift < 0.1) return null;
    const moves = [], hide = [];
    const by = (it, s) => [+(it.position[0] - n.x * s).toFixed(3), it.position[1], +(it.position[2] - n.y * s).toFixed(3)];
    moves.push({ uid: table.uid, position: by(table, shift) });
    for (const it of items) {
      if (it === table) continue;
      const c = rel(it);
      const du = c.dot(ud) - tU, dn = c.dot(n) - tDist;
      const chair = /dining-chair|chair/.test(it.archetype || '') && it.mount !== 'wall';
      if (chair && Math.abs(du) <= halfU + 0.75 && Math.abs(dn) <= halfN + 0.75) {
        // the chairs on the wall side give way to the bench; the others follow the table
        if (dn < -halfN + 0.05 && Math.abs(du) < halfU) hide.push(it.uid);
        else moves.push({ uid: it.uid, position: by(it, shift) });
      } else if (Math.abs(du) <= halfU && Math.abs(dn) <= halfN && (it.position[1] ?? 0) > 0.4) {
        moves.push({ uid: it.uid, position: by(it, shift) }); // things standing on the table
      }
    }
    return { table, shift, moves, hide };
  }

  _moveTableToBench() {
    const plan = this._benchPlan(this._elements());
    if (!plan) return;
    const d = this.design;
    const p = this.preview ? this.proposal(this.preview.id) : null;
    this.preview = null;
    this._editing = true;
    try {
      d.transaction('Flytt spisebordet inntil benken', () => {
        if (p) this._commitProposal(p);
        for (const m of plan.moves) d.update(m.uid, { position: m.position });
        for (const uid of plan.hide) d.update(uid, { hidden: true });
      });
    } finally {
      this._editing = false;
    }
    this.editor.events?.emit?.('toast', { text: `Spisebordet er flyttet ${fmt(plan.shift)} m inntil benken${plan.hide.length ? ` – ${plan.hide.length} stoler er tatt bort` : ''} (Ctrl+Z angrer)`, seconds: 3.5 });
    this._renderStatus();
    this._renderContent();
  }

  // ------------------------------------------------------------------------------------------------- scene

  /** Rebuilds the 3D wall from the preview / live edit / design (scene only). */
  _applyScene() {
    const hw = this.hw;
    if (!hw?.anchor) return;
    const elements = this.live || (this.preview ? this.preview.elements : this.design.wall?.elements) || null;
    const paint = this.preview ? (this.preview.wallPaint ?? null) : (this.design.paints?.[this.wallId] ?? null);
    let group = null;
    try {
      group = applyWallDesign(hw, elements);
    } catch (err) {
      console.warn('[WallPanel] wall preview failed', err);
    }
    try {
      this.home.setPaint?.(this.wallId, paint);
    } catch (err) {
      console.warn('[WallPanel] paint failed', err);
    }
    this._sendLights(group);
    this.home.lighting?.requestShadowUpdate?.();
    this._syncColliders();
    this._updateHighlight();
  }

  _sendLights(group) {
    const L = this.home.lighting;
    if (!L?.setItemLights) return;
    const lights = group?.userData?.model?.lights || [];
    if (!lights.length) {
      L.setItemLights('__wall', null);
      return;
    }
    this.hw.anchor.updateMatrixWorld(true);
    group.updateMatrixWorld(true);
    L.setItemLights('__wall', lights.map((l) => ({
      type: l.type || 'point',
      position: new THREE.Vector3(...l.position).applyMatrix4(group.matrixWorld),
      direction: l.direction ? new THREE.Vector3(...l.direction).transformDirection(group.matrixWorld) : undefined,
      angle: l.angle,
      penumbra: l.penumbra,
      colorK: l.colorK ?? 2700,
      lumens: l.lumens ?? 400,
      on: l.on !== false,
      dimmer: l.dimmer ?? 1,
      emissiveMeshes: l.emissiveMeshes || [],
    })));
  }

  /** Dynamic collision boxes for wall elements that stick out (curtain, sideboard, plant …). */
  _syncColliders() {
    const col = this.editor.game?.collision;
    if (!col?.addDynamicBox || this.home.sync?.wallColliders) return;
    for (const hnd of this._colliders) col.removeDynamic?.(hnd);
    this._colliders = [];
    const g = this.hw?.anchor?.userData?.wallDesign;
    const list = g?.userData?.model?.colliders || [];
    if (!list.length) return;
    g.updateMatrixWorld(true);
    for (const c of list) {
      const box = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(g.matrixWorld);
      if (box.max.y - box.min.y < 0.05) continue;
      this._colliders.push(col.addDynamicBox(box, { id: 'wall-design' }));
    }
  }

  _onDesignWall() {
    // the design changed (commit, undo, load …): SceneSync rebuilt the wall – drop the preview
    if (this.preview || this.live) {
      this.preview = null;
      this.live = null;
      this._applyScene();
    } else {
      this._syncColliders();
    }
    const n = this.design.wall?.elements?.length || 0;
    if (this.selIndex >= n) this.selIndex = n - 1;
    if (this.isOpen) {
      this._renderStatus();
      if (this.tab === 'rediger' && !this._editing) this._renderContent();
      else if (this.tab === 'forslag') {
        this._markCards();
        this._renderDetails();
      }
      this._updateHighlight();
    }
  }

  // ------------------------------------------------------------------------------------------------- acoustics

  _acoustics() {
    try {
      if (!this.preview && !this.live) return this.editor.acoustics();
      const d = this.design;
      const wall = this.preview ? { proposalId: this.preview.id, elements: this.preview.elements, edited: !!this.proposal(this.preview.id)?.custom } : { ...d.wall, elements: this.live, edited: true };
      return computeAcoustics({ items: [...d.items.values()], windows: d.windows, wall }, this.home);
    } catch (err) {
      console.warn('[WallPanel] acoustics failed', err);
      return null;
    }
  }

  /** Etterklang for a proposal with today's furniture – the same computation as the status bar (cached). */
  _rtFor(p) {
    const key = p.custom ? this._thumbKey(p) : p.id;
    if (this._rtCache.has(key)) return this._rtCache.get(key);
    let rt = null;
    try {
      const d = this.design;
      const w = d.wall || {};
      if (String(w.proposalId) === p.id && !w.edited) rt = this.editor.acoustics()?.rt60 ?? null;
      else rt = computeAcoustics({ items: [...d.items.values()], windows: d.windows, wall: { proposalId: p.id, elements: p.elements || [], edited: !!p.custom } }, this.home)?.rt60 ?? null;
    } catch {
      rt = typeof p.rt60 === 'number' ? p.rt60 : null;
    }
    this._rtCache.set(key, rt);
    return rt;
  }

  _rtBaseline() {
    try {
      const d = this.design;
      return computeAcoustics({ items: [...d.items.values()], windows: d.windows, wall: { proposalId: '0', elements: [], edited: false } }, this.home).rt60;
    } catch {
      return 0.86;
    }
  }

  // ------------------------------------------------------------------------------------------------- render: status

  _renderStatus() {
    const s = this.shown();
    const p = this.proposal(s.proposalId);
    const ac = this._acoustics();
    const custom = p?.custom;
    // code line: «FORSLAG B · I BRUK · NR. 1 · ANBEFALT» / «ENDRET FRA FORSLAG P2 · I BRUK»
    let code = p ? (custom ? 'Mitt forslag' : p.code === '0' ? 'Dagens vegg' : `Forslag ${p.code}`) : 'Egen vegg';
    if (p && s.edited) code = custom ? 'Endret fra mitt forslag' : p.code === '0' ? 'Endret' : `Endret fra forslag ${p.code}`;
    const bits = [h('span', { text: code }), ' · ', s.preview ? h('span.is-preview', { text: 'forhåndsvisning' }) : h('span.is-used', { text: 'i bruk' })];
    for (const b of p ? rankBadges(p) : []) bits.push(' · ', h('span.is-rank', { text: b.text }));
    this.codeEl.replaceChildren(...bits);
    this.titleEl.textContent = p ? p.name : s.elements?.length ? 'Egen sammensetning' : 'Tom vegg';
    this.titleEl.title = this.titleEl.textContent;
    const meta = [];
    if (ac) {
      const base = this._rtBaseline();
      meta.push(h(`span.wp-rt.wp-rt--${ac.level}`, { title: `Beregnet etterklangstid for hele rommet (Sabine). Uten veggtiltak ${fmt(base)} s, målet er ${fmt(ac.target?.[0] ?? 0.4)}–${fmt(ac.target?.[1] ?? 0.6)} s.` }, h('i'), `Etterklang ≈ ${fmt(ac.rt60)} s`));
      meta.push(h('small', { text: `uten veggtiltak ${fmt(base)} · mål ${fmt(ac.target?.[0] ?? 0.4)}–${fmt(ac.target?.[1] ?? 0.6)}` }));
    }
    const els = s.elements || [];
    const m2 = s.edited || custom || !p ? els.reduce((a, el) => a + elementAbsorption(el), 0) : p.sabineAdded ?? 0;
    if (m2 > 0.05) meta.push(h('small', { text: `+${fmt(m2, 1)} m² Sabine` }));
    if (p?.priceText && !s.edited) meta.push(h('small', { text: p.priceText.replace(/\s*\([^)]*\)/g, '') }));
    this.metaEl.replaceChildren(...meta);
    // «Bruk dette forslaget» ↔ «I bruk i designet» (same place, no layout jump)
    this.useBtn.disabled = !s.preview;
    this.useBtn.classList.toggle('ip-btn--primary', !!s.preview);
    this.useBtn.classList.toggle('kv-btn--ghost', !s.preview);
    this.useBtn.querySelector('span').textContent = s.preview ? 'Bruk dette forslaget' : 'I bruk i designet';
    this.useBtn.title = s.preview ? 'Ta forslaget i bruk i designet (kan angres)' : 'Dette er veggen i designet ditt';
    const montage = !!(p?.image || (custom && this.proposal(p.basedOn)?.image));
    this.compareBtn.title = montage ? 'Sammenlign med fotomontasjen (kameraet hopper til montasjevinkelen)' : 'Sammenlign med bildet fra montasjevinkelen';
    const framed = this._isFramed();
    this.frameBtn.classList.toggle('is-active', framed);
    this.frameBtn.querySelector('span').textContent = framed ? 'Gå tilbake' : 'Hele veggen';
    this.frameBtn.title = framed ? 'Gå tilbake dit du sto' : 'Se hele veggen: gå dit du ser hele veggen ved siden av panelet';
  }

  // ------------------------------------------------------------------------------------------------- render: content

  _renderContent() {
    this._thumbEls.clear();
    if (this.tab === 'rediger') this._renderEditor();
    else this._renderBrowser();
  }

  _renderBrowser() {
    this.detailsEl = h('div');
    const groups = new Map();
    for (const p of this.proposals()) {
      const g = groupLabel(p);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    const sections = [];
    for (const [label, list] of groups) {
      sections.push(section(label, h('div.wp-grid', {}, list.map((p) => this._card(p)))));
    }
    this.content.replaceChildren(this.detailsEl, ...sections, h('p.wp-note', { text: 'Bla med ← → eller knappene øverst. Forslagene vises på veggen med en gang, men lagres først når du trykker «Bruk dette forslaget». Etterklangstiden er et estimat (Sabine) for hele rommet med møblene som står der nå.' }));
    this._renderDetails();
    this._markCards();
  }

  _card(p) {
    const img = h('div.wp-card__img');
    const key = this._thumbKey(p);
    if (!p.custom) {
      const montage = p.thumb || (p.image ? p.image.replace('img/forslag/', 'img/forslag/thumb/') : null);
      if (montage) {
        img.style.backgroundImage = `url("${assetUrl(montage)}")`;
        img.classList.add('is-montage');
      } else this._staticThumb(p, img);
    } else {
      const url = p.thumb || this._thumbs.get(key);
      if (url) {
        img.style.backgroundImage = `url("${url}")`;
        img.classList.add('is-render');
      } else {
        img.classList.add('is-loading');
        this._requestThumb(p);
      }
      this._thumbEls.set(key, img);
    }
    img.append(h('span.wp-card__code', { text: p.custom ? '★' : p.code }));
    const badges = rankBadges(p);
    if (badges.length) img.append(h('div.wp-card__badges', {}, badges.map((b) => pill(b.text, b.tone))));
    const rt = this._rtFor(p);
    const price = p.custom ? 'Eget forslag' : p.priceMax === 0 ? '0 kr' : (p.priceText || '').replace(/\s*\([^)]*\)/g, '');
    const el = h('article.wp-card', {
      tabIndex: 0,
      dataset: { id: p.id, key },
      title: p.name,
      on: {
        click: () => this.previewProposal(p.id),
        dblclick: () => {
          this.previewProposal(p.id);
          this.useShown();
        },
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.previewProposal(p.id);
          }
        },
      },
    }, img, h('div.wp-card__body', {}, h('div.wp-card__title', { text: p.custom ? p.name : `${p.code} – ${p.name}` }), h('div.wp-card__meta', {}, h('span.wp-card__rt', { text: rt != null ? `Etterklang ≈ ${fmt(rt)} s` : `${(p.elements || []).length} elementer` }), h('b', { text: price }))));
    return el;
  }

  /** Built-in proposal without a montage: the shipped thumbnail (img/forslag/thumb/<id>.jpg), else a rendered one. */
  _staticThumb(p, img) {
    const url = `img/forslag/thumb/${p.id}.jpg`;
    const state = STATIC_THUMB.get(p.id);
    if (state === false) {
      const r = this._thumbs.get(p.id);
      if (r) img.style.backgroundImage = `url("${r}")`;
      else {
        img.classList.add('is-loading');
        this._requestThumb(p);
      }
      img.classList.add('is-render');
      this._thumbEls.set(p.id, img);
      return;
    }
    img.style.backgroundImage = `url("${assetUrl(url)}")`;
    img.classList.add('is-render');
    if (state === true) return;
    const probe = new Image();
    probe.onload = () => STATIC_THUMB.set(p.id, true);
    probe.onerror = () => {
      STATIC_THUMB.set(p.id, false);
      img.style.backgroundImage = '';
      img.classList.add('is-loading');
      this._thumbEls.set(p.id, img);
      this._requestThumb(p);
    };
    probe.src = assetUrl(url);
  }

  _refreshCardRts() {
    if (this._rtRefresh) return;
    this._rtRefresh = true;
    requestAnimationFrame(() => {
      this._rtRefresh = false;
      if (!this.isOpen || this.tab !== 'forslag') return;
      for (const el of this.content.querySelectorAll('.wp-card')) {
        const p = this.proposal(el.dataset.id);
        const rt = p ? this._rtFor(p) : null;
        const span = el.querySelector('.wp-card__rt');
        if (span && rt != null) span.textContent = `Etterklang ≈ ${fmt(rt)} s`;
      }
    });
  }

  _markCards() {
    const shown = String(this.shown().proposalId ?? '');
    const used = String(this.design.wall?.proposalId ?? '');
    for (const el of this.content.querySelectorAll('.wp-card')) {
      el.classList.toggle('is-shown', el.dataset.id === shown);
      el.classList.toggle('is-used', el.dataset.id === used);
    }
  }

  _scrollToCard(id) {
    const el = [...this.content.querySelectorAll('.wp-card')].find((c) => c.dataset.id === String(id));
    if (!el) return;
    const body = this.body;
    const br = body.getBoundingClientRect(), er = el.getBoundingClientRect();
    const top = er.top - br.top + body.scrollTop;
    if (er.top < br.top + 8 || er.bottom > br.bottom - 8) body.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' });
  }

  _renderDetails() {
    if (!this.detailsEl) return;
    const p = this.proposal(this.shown().proposalId);
    if (!p) {
      this.detailsEl.replaceChildren();
      return;
    }
    const open = this._detailsOpen ?? false;
    const list = (items, cls) => (items?.length ? h(`ul${cls ? `.${cls}` : ''}`, {}, items.map((t) => h('li', { text: t }))) : null);
    const det = h('details.wp-more', { open, on: { toggle: () => (this._detailsOpen = det.open) } },
      h('summary', { text: 'Fordeler, ulemper og produkter' }),
      p.pros?.length ? h('h4', { text: 'Fordeler' }) : null,
      list(p.pros, 'wp-pros'),
      p.cons?.length ? h('h4', { text: 'Ulemper' }) : null,
      list(p.cons, 'wp-cons'),
      p.products?.length ? h('h4', { text: 'Produkter og materialer' }) : null,
      list(p.products),
      p.notes ? h('h4', { text: 'Merknad' }) : null,
      p.notes ? h('p', { text: p.notes }) : null,
    );
    // a built-in bench (N14) only works with the table moved up to it
    const plan = this._benchPlan(this.shown().elements);
    const bench = plan ? h('div.wp-tip', {},
      h('p', { text: `Benken erstatter stolene på veggsiden, men spisebordet står ${fmt(plan.shift + 0.05)} m fra benken. Flytt bordet (og stolene ved endene og på andre siden) inntil benken${plan.hide.length ? `; ${plan.hide.length} stoler på veggsiden tas bort` : ''}.` }),
      button({ label: 'Flytt spisebordet inntil benken', icon: 'check', size: 'sm', onClick: () => this._moveTableToBench() })) : null;
    const box = h('div.wp-details', {},
      h('div.wp-details__title', { text: p.custom ? 'Om mitt forslag' : p.code === '0' ? 'Om dagens vegg' : `Om forslag ${p.code}` }),
      p.description ? h('p', { text: p.description }) : null,
      p.priceText ? h('div.wp-price', { text: `Pris: ${p.priceText}` }) : null,
      bench,
      (p.pros?.length || p.cons?.length || p.products?.length || p.notes) ? det : null,
      p.custom ? h('div.wp-foot', { style: { marginTop: '0.7em' } }, button({ label: 'Slett mitt forslag', icon: 'close', size: 'sm', variant: 'danger', onClick: () => this._deleteCustom(p) })) : null,
    );
    this.detailsEl.replaceChildren(box);
  }

  // ------------------------------------------------------------------------------------------------- render: editor

  _renderEditor() {
    const d = this.design;
    const preview = this.preview;
    const scroll = this.body.scrollTop;
    const parts = [];
    if (preview) {
      const p = this.proposal(preview.id);
      parts.push(h('div.wp-details', {}, h('p', { style: { margin: 0 }, text: `Du forhåndsviser «${p?.name || preview.id}». Endringer du gjør her tar forslaget i bruk først.` })));
    }
    // wall paint
    const curPaint = this.preview ? this.preview.wallPaint : d.paints?.[this.wallId];
    const paintHex = resolveColor(curPaint || this.hw?.paint || 'sand', '#cfc5b4');
    const picker = colorPicker(paintHex, (hex, { final }) => {
      if (final) this._edit('Veggfarge', () => d.setPaint(this.wallId, hex));
      else this.home.setPaint?.(this.wallId, hex);
    }, { palette: HIGH_PAINT_PALETTE, label: 'Veggfarge' });
    parts.push(section('Veggfarge', picker.el, h('div.wp-foot', { style: { marginTop: '0.5em' } },
      button({ label: 'SAND (original)', size: 'sm', variant: 'ghost', onClick: () => this._edit('Veggfarge', () => d.setPaint(this.wallId, null)) }))));

    // elements
    const els = (this.preview ? this.preview.elements : d.wall?.elements) || [];
    const listEl = h('div.wp-els');
    if (!els.length) listEl.append(emptyState('Veggen er tom. Legg til et element under, eller velg et forslag i fanen «Forslag».', 'palette'));
    els.forEach((el, i) => listEl.append(this._elementRow(el, i, els)));
    const types = Object.entries(ELEMENT_TYPES).map(([k, t]) => [k, t.label]);
    const typeSel = select({ options: types, value: this._addType || 'slats', onChange: (v) => (this._addType = v) });
    const add = h('div.wp-add', {}, typeSel.el, button({ label: 'Legg til', icon: null, onClick: () => this._addElement(typeSel.value || 'slats') }));
    const total = els.reduce((a, el) => a + elementAbsorption(el), 0);
    parts.push(section(`Elementer (${els.length})`, listEl, add, h('p.wp-note', { text: `Elementene demper til sammen ca. ${fmt(total, 1)} m² Sabine (500–1000 Hz). Klikk på et element på veggen for å velge det her. Nye elementer legges der veggen er ledig.` })));

    // save / reset
    const nameIn = textInput({ placeholder: 'Navn, f.eks. «Spiler og bilde»', value: '' });
    const saveRow = h('div.wp-save', {}, nameIn.el, button({ label: 'Lagre', icon: 'check', variant: 'primary', onClick: () => this._saveCustom(nameIn.value) }));
    saveRow.hidden = true;
    parts.push(section('Mitt forslag',
      h('div.wp-foot', {},
        button({ label: 'Lagre som mitt forslag', icon: 'pin', onClick: () => {
          saveRow.hidden = !saveRow.hidden;
          if (!saveRow.hidden) {
            nameIn.set(this._suggestName());
            nameIn.input.focus();
            nameIn.input.select();
          }
        } }),
        button({ label: 'Tilbakestill', icon: 'reset', variant: 'ghost', onClick: () => this._reset() }),
        button({ label: 'Tøm veggen', icon: 'close', variant: 'ghost', onClick: () => this._clear() }),
      ),
      saveRow,
      h('p.wp-note', { text: '«Tilbakestill» henter elementene og fargen fra forslaget du startet med. «Mine forslag» lagres bare i denne nettleseren – de følger ikke med når du eksporterer designet til fil. Veggen du har tatt i bruk følger designet, men navnet på et eget forslag vises bare her.' }),
    ));
    this.content.replaceChildren(...parts);
    this.body.scrollTop = scroll;
    nameIn.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveCustom(nameIn.input.value);
    });
  }

  _elementRow(el, i, all) {
    const t = ELEMENT_TYPES[el.type];
    const selected = i === this.selIndex;
    const abs = elementAbsorption(el);
    const iconBtn = (icon, title, fn) => h('button.kv-iconbtn', { type: 'button', title, 'aria-label': title, on: { click: (e) => {
      e.stopPropagation();
      fn();
    } } }, svg(icon));
    const head = h('div.wp-el__head', { on: { click: () => this._selectElement(selected ? -1 : i) } },
      h('div.wp-el__text', {}, h('div.wp-el__type', { text: t?.label || el.type }), h('div.wp-el__desc', { text: describeElement(el) })),
      abs > 0.05 ? h('span.wp-el__abs', { text: `${fmt(abs, 1)} m²` }) : null,
      iconBtn(ICON_COPY, 'Dupliser', () => this._duplicate(i)),
      iconBtn(ICON_TRASH, 'Fjern', () => this._remove(i)),
    );
    const row = h(`div.wp-el${selected ? '.is-selected' : ''}`, { dataset: { index: String(i) } }, head);
    if (selected) row.append(this._paramBody(el, i, all));
    return row;
  }

  _paramBody(el, i, all) {
    const schema = elementEditor(el.type, el);
    const keys = Object.keys(schema).join(',');
    const ed = paramEditor(schema, elementValues(el, all), (key, value, { final }) => this._onParam(i, key, value, final, keys));
    return h('div.wp-el__body', {}, ed.el);
  }

  _selectElement(i) {
    this.selIndex = i;
    this._renderEditor();
    this._updateHighlight();
    if (i >= 0) {
      const row = this.content.querySelector(`.wp-el[data-index="${i}"]`);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /** A design edit: commits a running preview first so the change applies to what the user sees. */
  _edit(label, fn) {
    const d = this.design;
    if (this.preview) {
      const p = this.proposal(this.preview.id);
      this.preview = null;
      this._editing = true;
      try {
        d.transaction(label, () => {
          if (p) this._commitProposal(p);
          fn();
        });
      } finally {
        this._editing = false;
      }
    } else {
      this._editing = true;
      try {
        fn();
      } finally {
        this._editing = false;
      }
    }
    this._renderStatus();
  }

  _onParam(i, key, value, final, schemaKeys) {
    const base = this.live || clone((this.preview ? this.preview.elements : this.design.wall?.elements) || []);
    if (!base[i]) return;
    const before = base[i];
    base[i] = setElementParam(base[i], key, value);
    if (!final) {
      this.live = base;
      this._sceneDirty = true;
      return;
    }
    this.live = null;
    this._edit(`Endre ${ELEMENT_TYPES[base[i].type]?.label?.toLowerCase() || 'element'}`, () => this.design.setWall({ elements: base }));
    // the schema may change (fill, motif, number of colours), or other values may follow the change (a new wood type
    // brings its colour): rebuild the editor then, else just refresh the texts
    const now = Object.keys(elementEditor(base[i].type, base[i])).join(',');
    const vb = elementValues(before, base), va = elementValues(base[i], base);
    const others = Object.keys(va).some((k) => k !== key && JSON.stringify(va[k]) !== JSON.stringify(vb[k]));
    if (now !== schemaKeys || others) this._renderEditor();
    else {
      const row = this.content.querySelector(`.wp-el[data-index="${i}"]`);
      const desc = row?.querySelector('.wp-el__desc');
      if (desc) desc.textContent = describeElement(base[i]);
      const abs = row?.querySelector('.wp-el__abs');
      if (abs) abs.textContent = `${fmt(elementAbsorption(base[i]), 1)} m²`;
    }
    this._updateHighlight();
  }

  _addElement(type) {
    const els = this._elements();
    const center = { u: (this.hw?.width ?? 3.9) / 2, v: 1.5 };
    let el = createElement(type, center);
    if (!el) return;
    // where the wall is free (next to the selected element when there is one)
    const sel = els[this.selIndex] ? elementBounds(els[this.selIndex]) : null;
    try {
      el = placeElement(el, els, sel ? { prefer: { u: (sel.u0 + sel.u1) / 2, v: (sel.v0 + sel.v1) / 2 } } : {});
    } catch (err) {
      console.warn('[WallPanel] placing the element failed', err);
    }
    els.push(el);
    this._edit(`Legg til ${ELEMENT_TYPES[type]?.label?.toLowerCase() || 'element'}`, () => this.design.setWall({ elements: els }));
    this.selIndex = (this.design.wall?.elements?.length || 1) - 1;
    this._renderEditor();
    this._updateHighlight();
    this.content.querySelector(`.wp-el[data-index="${this.selIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  _duplicate(i) {
    const els = this._elements();
    if (!els[i]) return;
    const copy = clone(els[i]);
    const b = elementBounds(copy);
    const du = Math.min(0.3, (b.u1 - b.u0) * 0.25 + 0.1);
    if (Array.isArray(copy.items)) copy.items = copy.items.map((it) => ({ ...it, cu: +(it.cu + du).toFixed(3) }));
    else if (typeof copy.u === 'number') copy.u = +(copy.u + du).toFixed(3);
    else if (typeof copy.cu === 'number') copy.cu = +(copy.cu + du).toFixed(3);
    els.splice(i + 1, 0, copy);
    this._edit('Dupliser element', () => this.design.setWall({ elements: els }));
    this.selIndex = i + 1;
    this._renderEditor();
    this._updateHighlight();
  }

  _remove(i) {
    const els = this._elements();
    if (!els[i]) return;
    els.splice(i, 1);
    this._edit('Fjern element', () => this.design.setWall({ elements: els }));
    this.selIndex = Math.min(this.selIndex, els.length - 1);
    this._renderEditor();
    this._updateHighlight();
  }

  async _reset() {
    const w = this.design.wall || {};
    const p = this.proposal(this.preview?.id ?? w.proposalId);
    if (!p) {
      this.editor.events?.emit?.('toast', { text: 'Det er ikke noe forslag å tilbakestille til' });
      return;
    }
    if (w.edited) {
      const ok = await confirmDialog({ title: 'Tilbakestill veggen?', text: `Endringene dine forsvinner, og veggen blir som forslaget «${p.name}» igjen.`, okLabel: 'Tilbakestill' });
      // cancelled: the preview (if any) stays on the wall
      if (!ok) return;
    }
    if (this.preview) this.preview = null;
    this._commitProposal(p);
    if (!this.preview) this._applyScene();
    this.selIndex = -1;
    this._renderStatus();
    this._renderContent();
  }

  async _clear() {
    const els = this.design.wall?.elements || [];
    if (els.length > 1) {
      const ok = await confirmDialog({ title: 'Tømme veggen?', text: 'Alle elementene på den høye veggen fjernes (du kan angre med Ctrl+Z).', okLabel: 'Tøm veggen', danger: true });
      if (!ok) return;
    }
    this.preview = null;
    this.design.setWallProposal('0');
    this.selIndex = -1;
    this._renderContent();
  }

  /** «Egen 1», «Egen 2» …: the first free number (never reads like a variant of proposal M). */
  _nextCustomCode() {
    const used = new Set(this.custom.map((c) => /^Egen (\d+)$/.exec(c.code || '')?.[1]).filter(Boolean).map(Number));
    let n = 1;
    while (used.has(n)) n++;
    return { code: `Egen ${n}`, n };
  }

  _suggestName() {
    const base = this.proposal(this.design.wall?.proposalId);
    return base && base.id !== '0' && !base.custom ? `${base.code} – min variant` : `Mitt forslag ${this._nextCustomCode().n}`;
  }

  _saveCustom(name) {
    const nm = String(name || '').trim() || this._suggestName();
    const d = this.design;
    if (this.preview) this._edit('Lagre forslag', () => {});
    const els = clone(d.wall?.elements || []);
    if (!els.length) {
      this.editor.events?.emit?.('toast', { text: 'Veggen er tom – legg til noe først' });
      return;
    }
    const from = this.proposal(d.wall?.proposalId);
    const ac = (() => {
      try {
        return computeAcoustics({ items: [...d.items.values()], windows: d.windows, wall: { proposalId: null, elements: els, edited: true } }, this.home);
      } catch {
        return null;
      }
    })();
    const id = `mitt-${Date.now().toString(36)}`;
    const basedOn = from && from.id !== '0' ? (from.custom ? from.basedOn ?? null : from.id) : null;
    const baseP = basedOn ? this.proposal(basedOn) : null;
    const entry = {
      id,
      code: this._nextCustomCode().code,
      name: nm,
      description: baseP ? `Egen variant basert på forslag ${baseP.code} – ${baseP.name}.` : 'Eget forslag laget i spillet.',
      basedOn,
      elements: els,
      wallPaint: d.paints?.[this.wallId] ?? null,
      sabineAdded: +els.reduce((a, el) => a + elementAbsorption(el), 0).toFixed(2),
      rt60: ac ? +ac.rt60.toFixed(2) : null,
      createdAt: new Date().toISOString(),
    };
    this.custom = [...this.custom, entry];
    if (!saveCustom(this.custom)) this.editor.events?.emit?.('toast', { text: 'Klarte ikke å lagre i nettleseren (lagring er blokkert)' });
    d.setWall({ proposalId: id, elements: els, edited: false });
    // the wall in the scene is this proposal now: its thumbnail is taken from the scene on the next frame
    this._captureFor = id;
    this.editor.events?.emit?.('toast', { text: `Lagret som «${nm}» i Mine forslag`, seconds: 2.5 });
    this._renderStatus();
    this._renderContent();
  }

  async _deleteCustom(p) {
    const ok = await confirmDialog({ title: 'Slette forslaget?', text: `«${p.name}» fjernes fra «Mine forslag». Veggen beholder elementene til du velger noe annet.`, okLabel: 'Slett', danger: true });
    if (!ok) return;
    this.custom = this.custom.filter((c) => c.id !== p.id);
    saveCustom(this.custom);
    this._thumbs.delete(this._thumbKey(p));
    if (this.preview?.id === p.id) {
      this.preview = null;
      this._applyScene();
    }
    if (this.design.wall?.proposalId === p.id) this.design.setWall({ proposalId: null, elements: clone(this.design.wall.elements), edited: true });
    this._renderStatus();
    this._renderContent();
  }

  // ------------------------------------------------------------------------------------------------- highlight

  _updateHighlight() {
    // no amber outline in the photo comparison (it would distort what is compared)
    if (!this.isOpen || this.tab !== 'rediger' || this.selIndex < 0 || this.editor.ui?.photo?.isOpen) {
      this._setHighlight(null);
      return;
    }
    const els = this.live || (this.preview ? this.preview.elements : this.design.wall?.elements) || [];
    this._setHighlight(els[this.selIndex] ? elementBounds(els[this.selIndex]) : null);
  }

  _setHighlight(b) {
    const anchor = this.hw?.anchor;
    if (this._highlight) {
      this._highlight.removeFromParent();
      this._highlight.geometry.dispose();
      this._highlight.material.dispose();
      this._highlight = null;
    }
    if (!b || !anchor) return;
    const pad = 0.015;
    const w = b.u1 - b.u0 + 2 * pad, hh = b.v1 - b.v0 + 2 * pad, d = Math.max(0.01, b.depth + pad);
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, hh, d));
    const m = new THREE.LineBasicMaterial({ color: 0xffb52e, transparent: true, opacity: 0.95, depthTest: false });
    const lines = new THREE.LineSegments(geo, m);
    lines.position.set((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, d / 2);
    lines.renderOrder = 999;
    lines.userData.noCollide = true;
    lines.raycast = () => {};
    anchor.add(lines);
    this._highlight = lines;
  }

  // ------------------------------------------------------------------------------------------------- warm-up

  /**
   * Builds every proposal's design once in idle time (fills the texture/material caches) and compiles its materials
   * with renderer.compileAsync against the scene's lights, so the first preview does not stall on shaders. One
   * material per program stays alive (otherwise the program would be released with the throw-away design).
   */
  _startWarm(delay) {
    if (!this.editor.renderer || !this.editor.scene || !this.hw) return;
    if (!this._warm) this._warm = { started: false, at: 0, i: 0, list: null, keep: new Map(), busy: false, done: false, timer: 0 };
    const W = this._warm;
    if (W.started) return;
    const at = performance.now() + delay;
    if (W.at && W.at <= at) return; // already due sooner
    W.at = at;
    clearTimeout(W.timer);
    if (delay <= 0) {
      // right away (the editor is made at the end of loading: the GPU starts on the shaders behind the loading screen)
      W.started = true;
      this._warmStep({ didTimeout: true });
      return;
    }
    W.timer = setTimeout(() => {
      if (W.started || this._disposed) return;
      W.started = true;
      this._idle((d) => this._warmStep(d));
    }, delay);
  }

  _idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1200 });
    else setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 60);
  }

  _warmStep(deadline) {
    const W = this._warm;
    if (this._disposed || !W || W.done || W.busy) return;
    // run when the frame has spare time (or after the timeout)
    if (!deadline?.didTimeout && (deadline?.timeRemaining?.() ?? 10) < 6) {
      this._idle((d) => this._warmStep(d));
      return;
    }
    W.list ||= this._warmList();
    const job = W.list[W.i++];
    if (job == null) {
      W.done = true;
      this._primePending = true; // and upload what the wall view shows (next frame, see update)
      return;
    }
    let g = null;
    try {
      // one job = one proposal, or the first batch: one proposal per element type with its own shader, compiled
      // together so the GPU works on them in parallel right at the start
      const ids = Array.isArray(job) ? job : [job];
      g = new THREE.Group();
      for (const id of ids) {
        const p = this.proposal(id);
        const d = p ? buildWallDesign(clone(p.elements), { wall: this.hw }) : null;
        if (d) g.add(d);
      }
      if (!g.children.length) g = null;
    } catch {
      g = null;
    }
    if (!g) {
      this._idle((d) => this._warmStep(d));
      return;
    }
    W.busy = true;
    const r = this.editor.renderer;
    const cam = this.editor.camera || this.editor.activeCamera;
    const finish = () => {
      try {
        this._keepPrograms(g);
      } catch {
        /* optional */
      }
      disposeDesign(g);
      W.busy = false;
      if (!this._disposed) setTimeout(() => this._idle((d) => this._warmStep(d)), 30);
    };
    try {
      const res = r.compileAsync ? r.compileAsync(g, cam, this.editor.scene) : (r.compile(g, cam, this.editor.scene), Promise.resolve());
      res.then(finish, finish);
    } catch {
      finish();
    }
  }

  /** Warm-up order: first a batch with the element types that need their own shader, then every proposal. */
  _warmList() {
    const list = this.proposals().filter((p) => p.elements?.length);
    const first = [];
    for (const type of ['curtain', 'moss', 'led', 'tapestry']) {
      const p = list.find((x) => x.elements.some((e) => e?.type === type));
      if (p && !first.includes(p.id)) first.push(p.id);
    }
    return [first, ...list.map((p) => p.id).filter((id) => !first.includes(id))];
  }

  _keepPrograms(g) {
    const props = this.editor.renderer?.properties;
    const keep = this._warm?.keep;
    if (!props || !keep) return;
    g.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.userData?.cached || m.userData?.shared) continue;
        const key = props.get(m)?.currentProgram?.cacheKey;
        if (key && !keep.has(key)) {
          keep.set(key, m);
          m.userData = { ...(m.userData || {}), shared: true }; // disposeModel leaves it (and its program) alone
        }
      }
    });
  }

  // ------------------------------------------------------------------------------------------------- thumbnails («Mine forslag»)

  _thumbKey(p) {
    return p.custom ? `${p.id}:${p.createdAt || ''}` : p.id;
  }

  _requestThumb(p) {
    const key = this._thumbKey(p);
    if (this._thumbs.has(key) || this._thumbQueue.some((q) => q.key === key) || this._thumbJob?.key === key) return;
    this._thumbQueue.push({ key, id: p.id, custom: !!p.custom, elements: clone(p.elements || []), paint: p.wallPaint ?? null });
  }

  _thumbCamera() {
    const pc = this.editor.layout?.photoCamera?.('0_for');
    if (!pc) return null;
    if (!this._thumbCam) this._thumbCam = new THREE.PerspectiveCamera(pc.vfovDeg, pc.aspect || 4 / 3, 0.05, 200);
    const cam = this._thumbCam;
    cam.position.copy(pc.pos);
    cam.rotation.set(pc.rotation.x, pc.rotation.y, pc.rotation.z, pc.rotation.order || 'YXZ');
    cam.fov = pc.vfovDeg;
    cam.aspect = pc.aspect || 4 / 3;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return cam;
  }

  /** One rate-limited step: a visible card's design is built, compiled (async), then rendered on a later frame. */
  _pumpThumbs() {
    const job = this._thumbJob;
    if (job) {
      if (!job.ready) return;
      this._thumbJob = null;
      const url = this._renderThumb(job.temp, job.paint);
      job.temp?.removeFromParent();
      disposeDesign(job.temp);
      this._lastThumbAt = performance.now();
      if (url) this._storeThumb(job, url);
      return;
    }
    if (!this._thumbQueue.length || performance.now() - this._lastThumbAt < 450) return;
    const view = this.body.getBoundingClientRect();
    const k = this._thumbQueue.findIndex((q) => {
      const r = this._thumbEls.get(q.key)?.getBoundingClientRect();
      return r && r.height && r.bottom > view.top && r.top < view.bottom;
    });
    if (k < 0) return; // only visible cards
    const [next] = this._thumbQueue.splice(k, 1);
    const r = this.editor.renderer, scene = this.editor.scene;
    const cam = this._thumbCamera();
    let temp = null;
    try {
      temp = buildWallDesign(next.elements, { wall: this.hw });
    } catch {
      temp = null;
    }
    const j = { ...next, temp, ready: false };
    this._thumbJob = j;
    if (!temp || !r?.compileAsync || !cam) {
      j.ready = true;
      return;
    }
    try {
      r.compileAsync(temp, cam, scene).then(() => (j.ready = true), () => (j.ready = true));
    } catch {
      j.ready = true;
    }
  }

  _storeThumb(job, url) {
    this._thumbs.set(job.key, url);
    const el = this._thumbEls.get(job.key);
    if (el) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.remove('is-loading');
    }
    if (job.custom) {
      // keep it with the custom proposal (rendered once)
      const c = this.custom.find((x) => x.id === job.id);
      if (c && c.thumb !== url) {
        c.thumb = url;
        saveCustom(this.custom);
      }
    }
  }

  /**
   * Renders the scene through the montage camera into a corner of the game canvas and copies it (5:4 card crop);
   * temp = a design shown instead of the one on the wall (null = the wall as it is); quality = JPEG quality. Editor.update runs before the
   * game renders, so the frame's render covers the corner again.
   * @returns {string|null} JPEG data URL
   */
  _renderThumb(temp, paint, quality = 0.84) {
    const { renderer, scene } = this.editor;
    const anchor = this.hw?.anchor;
    const cam = this._thumbCamera();
    if (!renderer || !scene || !cam || !anchor) return null;
    const cssSize = renderer.getSize(new THREE.Vector2());
    const W = Math.max(160, Math.min(640, Math.floor(cssSize.x), Math.floor(cssSize.y * cam.aspect)));
    const H = Math.round(W / cam.aspect);
    const current = anchor.userData.wallDesign;
    const ceilings = this.home.pickables?.ceilings || [];
    const ceilVis = ceilings.map((m) => m.visible);
    const sm = renderer.shadowMap;
    const smState = { auto: sm.autoUpdate, needs: sm.needsUpdate };
    const prevPaint = this.preview ? (this.preview.wallPaint ?? null) : (this.design.paints?.[this.wallId] ?? null);
    const swapPaint = temp && paint !== undefined && paint !== prevPaint;
    let url = null;
    try {
      if (temp) {
        if (current) current.visible = false;
        anchor.add(temp);
      }
      if (this._highlight) this._highlight.visible = false;
      if (swapPaint) this.home.setPaint?.(this.wallId, paint);
      for (const m of ceilings) m.visible = true;
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, W, H);
      renderer.setScissor(0, 0, W, H);
      renderer.render(scene, cam);
      const pr = renderer.getPixelRatio();
      const canvas = renderer.domElement;
      const out = document.createElement('canvas');
      out.width = 400;
      out.height = 320;
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // 4:3 render → 5:4 card
      const sw = W * pr, sh = H * pr;
      const cropW = sh * 1.25;
      ctx.drawImage(canvas, (sw - cropW) / 2, canvas.height - sh, cropW, sh, 0, 0, 400, 320);
      url = out.toDataURL('image/jpeg', quality);
    } catch (err) {
      console.warn('[WallPanel] thumbnail failed', err);
    } finally {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cssSize.x, cssSize.y);
      renderer.setScissor(0, 0, cssSize.x, cssSize.y);
      sm.autoUpdate = smState.auto;
      sm.needsUpdate = smState.needs;
      ceilings.forEach((m, i) => (m.visible = ceilVis[i]));
      if (temp) {
        temp.removeFromParent();
        if (current) current.visible = true;
      }
      if (this._highlight) this._highlight.visible = true;
      if (swapPaint) this.home.setPaint?.(this.wallId, prevPaint);
    }
    return url;
  }

  /**
   * One tiny render through the montage camera into a corner of the canvas (before the frame's own render covers it):
   * uploads the textures the wall view shows (kitchen, TV niche, the view outside) in the warm-up's idle time instead
   * of in the frame where «Se hele veggen» first turns the camera there.
   */
  _primeWallView() {
    const { renderer, scene } = this.editor;
    const cam = this._thumbCamera();
    if (!renderer || !scene || !cam) return;
    const size = renderer.getSize(new THREE.Vector2());
    const sm = renderer.shadowMap;
    const st = { auto: sm.autoUpdate, needs: sm.needsUpdate };
    try {
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, 48, 36);
      renderer.setScissor(0, 0, 48, 36);
      renderer.render(scene, cam);
    } catch {
      /* optional */
    } finally {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      renderer.setScissor(0, 0, size.x, size.y);
      sm.autoUpdate = st.auto;
      sm.needsUpdate = st.needs;
    }
  }

  // ------------------------------------------------------------------------------------------------- frame

  update(dt) {
    if (this._sceneDirty) {
      this._sceneDirty = false;
      this._applyScene();
      this._renderStatus();
    }
    this._stepFrame(dt);
    // walking on from the wall view: no walking back when the panel closes
    if (this._framed && !this._framed.moved && !this._frameTw && this._userMoves()) {
      this._framed.moved = true;
      this._frameReturn = null;
      this._renderStatus();
    }
    // thumbnails only while nothing is cut away (the dollhouse/plan views hide walls and ceilings)
    const v = this.editor.views;
    const plainView = !v || v.isWalking !== false || (v.mode === 'photo' && !v._tween);
    if (!plainView || this.editor.game?.paused) return;
    if (this._primePending) {
      this._primePending = false;
      this._primeWallView();
      return;
    }
    if (this._captureFor) {
      const id = this._captureFor;
      this._captureFor = null;
      const c = this.custom.find((x) => x.id === id);
      if (c && String(this.design.wall?.proposalId) === id && !this.preview && !this.live) {
        this.home.sync?.flush?.();
        const url = this._renderThumb(null);
        if (url) this._storeThumb({ key: this._thumbKey({ ...c, custom: true }), id, custom: true }, url);
      }
      return;
    }
    if (this.isOpen && this.tab === 'forslag' && (this._thumbJob || this._thumbQueue.length)) this._pumpThumbs();
  }

  dispose() {
    this._disposed = true;
    clearTimeout(this._warm?.timer);
    window.removeEventListener('keydown', this._onKey, true);
    for (const off of this._disposers) off?.();
    this._disposers = [];
    this._setHighlight(null);
    if (this._thumbJob?.temp) disposeDesign(this._thumbJob.temp);
    this._thumbJob = null;
    for (const m of this._warm?.keep?.values() || []) m.dispose();
    const col = this.editor.game?.collision;
    for (const hnd of this._colliders) col?.removeDynamic?.(hnd);
    this._colliders = [];
    super.dispose();
  }
}

export default WallPanel;
