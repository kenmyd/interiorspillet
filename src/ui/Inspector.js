import { BasePanel, section, button, iconButton, slider, select, toggle, colorPicker, paramEditor, badge, emptyState, paletteColors, fmtNok, isFormFocused } from './panelKit.js';
import { h, svg, fmtNumber } from './dom.js';
import { ICONS } from './icons.js';
import { getArchetype } from '../models/registry.js';
import { materialOptions, kindGroup, resolveColor, MATERIAL_LABELS, MATERIAL_KINDS, defaultColor } from '../home/materials.js';
import { itemAbsorption, rt60For, itemRoomId, LIVING_ROOM_ID, finishAbsorption } from '../design/Acoustics.js';
import { itemLevel, levelFloorY } from '../design/SceneSync.js';
import { surfaceInfo } from '../design/Selection.js';
import { SLAT_LOOKS, SLAT_SIZES, SLAT_BACKINGS, defaultFinish, sizeOf, hasFelt, surfaceKind } from '../design/Finishes.js';
import palette from '../data/palette.json';
import {
  thumbnail, cachedThumbnail, priceInfo, priceEl, variantSwatch, variantColors, colorDist, dimsText, storeLink,
} from './CatalogPanel.js';
import { clone, cm, throttle, blurSoon, seg } from './inspectorKit.js';
import { gridExtension } from './inspector/gridSection.js';
import { itemQuantity } from '../design/grid.js';

/**
 * Inspector (ARCHITECTURE §12, §14) – the right-hand panel that opens when something is selected.
 *
 *   new Inspector(editor) – open(target) / close() / toggle() / isOpen / update() / dispose()
 *   target = editor.selected: { kind: 'item', uid } | { kind: 'wall', wallId } | { kind: 'ceiling', ceilingId }
 *
 * Item: ◀ ▶ «Bytt modell» first and sticky at the top of the panel (other products of the same category and mount at
 * the same spot – rotation and wall attachment are kept, the back stays against the wall, the colour closest to the
 * current one is chosen; the row never moves, so ◀ ▶ can be clicked again without aiming; keys , and . do the same),
 * then name/store/price/«Se hos …» (or «Eksisterende møbel» for today's furniture), variant swatches, colour +
 * material per part the MODEL actually has (userData.model.parts; palette swatches, material kinds that suit the
 * part, an inline «egen farge» note below the parts – nothing is inserted above the cursor), lamp controls (på/av,
 * dimmer, fargetemperatur, avstand fra tak for pendler), size sliders within the archetype's dimsRange and the room
 * (wall items: the wall's free span; floor items: the ceiling), archetype params (paramEditor), rotation ±15°,
 * height on the wall, sound absorption, «Dupliser», «Tilbakestill», «Slett». Wall (not the high wall): paint colour
 * and «Spiler» (a slat finish – design.setFinish: look, slat size, backing, the whole wall or a section, height). Ceiling
 * («Tak»): paint colour and «Spilepanel» (the same, with the slats' direction instead of extent); a bulkhead: paint only.
 *
 * Every change goes through DesignState.update (sliders and colour drags coalesce into one undo step). Size and model
 * changes go through Placement.constrain(), so the item never ends up in a wall, a window or the ceiling (the position
 * correction is part of the same undo step). Changes from elsewhere (undo, drag-move, R) refresh the panel – but
 * never while a control inside it is being used.
 *
 * Feature modules extend the item view through addExtension(ext) (MASTER §2.7): a head for non-catalogue items, extra
 * sections (after the head, after «Lys», or in place of «Størrelse»), hidden parts/params/controls, «Bytt modell»
 * candidates and what a swap/reset carries over. The grid of ceiling fittings (ui/inspector/gridSection.js) is one;
 * the helpers extensions use are in ui/inspectorKit.js. Lamp params with `section: 'light'` show in «Lys».
 */

const DIM_LABELS = { w: 'Bredde', d: 'Dybde', h: 'Høyde' };
/** Norwegian names of the canonical parts (ARCHITECTURE §13) for parts the archetype does not label itself. */
const PART_FALLBACK_LABELS = {
  upholstery: 'Trekk', legs: 'Ben', frame: 'Ramme', body: 'Korpus', front: 'Front', top: 'Plate', handle: 'Håndtak',
  shade: 'Skjerm', inner: 'Innside', base: 'Fot', metal: 'Metall', cord: 'Ledning', fabric: 'Stoff', piping: 'Kantebånd',
  accent: 'Mønster', accent2: 'Mønster 2', leaves: 'Blader', pot: 'Potte', print: 'Motiv', panel: 'Panel', slats: 'Spiler',
  backing: 'Bakside', flowers: 'Blomster', trunk: 'Stamme',
};
const PART_ORDER = ['upholstery', 'fabric', 'shade', 'body', 'top', 'front', 'panel', 'slats', 'base', 'print', 'leaves', 'legs', 'frame', 'metal', 'accent', 'accent2', 'inner', 'handle', 'pot', 'trunk', 'piping', 'backing', 'cord', 'flowers'];
const DIRS = ['nord', 'nordøst', 'øst', 'sørøst', 'sør', 'sørvest', 'vest', 'nordvest'];

const K = MATERIAL_KINDS;
/** Material kinds offered per part (the current kind is always added). */
function kindsFor(part, family, current) {
  const fabric = [...K.fabric];
  if (family === 'rug') return ['wool', 'cotton', 'linen', 'woven', 'knit', 'teddy', 'felt', 'velvet', 'boucle'];
  // wooden lamp shades (Secto slat pendants: birch, walnut veneer, laminate): the wood kinds first
  if ((part === 'shade' || part === 'inner') && kindGroup(current) === 'wood') return [...K.wood, 'paper', 'rattan', 'linen', 'cotton', 'felt', ...K.metal];
  switch (part) {
    case 'upholstery':
    case 'fabric':
    case 'piping':
      return fabric;
    case 'legs':
    case 'frame':
    case 'handle':
    case 'metal':
    case 'rail':
      return [...K.wood, ...K.metal];
    case 'body':
      if (family === 'object') return ['ceramic', 'glass-clear', 'glass-smoked', 'glass-opal', ...K.metal, ...K.stone, 'rattan', 'paper', 'plastic', 'candle', ...K.wood];
      return [...K.wood, ...K.metal, ...K.stone, 'rattan', 'ceramic', 'plastic', 'cork'];
    case 'front':
    case 'top':
      return [...K.wood, ...K.stone, ...K.metal, ...K.glass, 'rattan', 'ceramic', 'plastic', 'cork'];
    case 'base':
      return [...K.wood, ...K.metal, ...K.stone, 'ceramic', 'rattan', 'paper', 'plastic', 'glass-opal', 'glass-smoked'];
    case 'shade':
    case 'inner':
      return ['linen', 'cotton', 'felt', 'wool', 'velvet', 'paper', 'rattan', 'ceramic', 'plastic', ...K.glass, ...K.metal];
    case 'cord':
      return ['cotton', 'plastic', 'black-metal', 'brass', 'chrome', 'steel'];
    case 'leaves':
    case 'flowers':
      return ['plant-leaf', 'paper'];
    case 'trunk':
      return [...K.wood];
    case 'pot':
      return ['ceramic', 'plastic', 'rattan', ...K.stone, ...K.metal, 'paper'];
    case 'print':
      return ['paper', 'linen', 'cotton', 'mirror', 'glass-clear'];
    case 'panel':
    case 'backing':
      return ['felt', 'wool', 'woven', 'linen', 'velvet', 'cork', 'moss', ...K.wood];
    case 'slats':
      return [...K.wood, 'black-metal', 'painted'];
    default:
      return Object.values(K).flat();
  }
}

/** Palette swatch groups (palette.json materials[].group) per material group. */
const PALETTE_GROUPS = { fabric: ['Tekstil'], wood: ['Tre', 'Lakk'], metal: ['Metall'], stone: ['Stein'], glass: ['Glass'], other: ['Naturfiber', 'Stein'] };

const CSS = `
.ipi-panel .ip-panel__body { padding-top: 0.8em; }
.ipi-head { margin-bottom: 0.9em; }
.ipi-badges { display: flex; flex-wrap: wrap; gap: 0.3em; margin-bottom: 0.45em; }
.ipi-store { font-size: 0.88em; color: var(--kv-ink-3); margin-bottom: 0.35em; }
.ipi-pricerow { display: flex; align-items: center; justify-content: space-between; gap: 0.6em; flex-wrap: wrap; }
.ipi-pricerow .kv-btn { height: 2.1em; font-size: 0.85em; text-decoration: none; }
.ipi-pricerow .kv-btn .kv-icon { width: 0.95em; height: 0.95em; }
.ipi-note { font-size: 0.8em; color: var(--kv-ink-3); line-height: 1.45; margin: 0.45em 0 0; }
.ipi-clamp { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; cursor: help; }
.ipi-clamp:hover { -webkit-line-clamp: unset; }
.ipi-warn { display: flex; gap: 0.5em; align-items: flex-start; margin: 0.5em 0 0; padding: 0.5em 0.7em; border-radius: var(--kv-r-sm);
  background: rgba(255, 200, 80, 0.08); border: 1px solid rgba(255, 200, 80, 0.25); color: #ffe2a6; font-size: 0.8em; line-height: 1.4; }
.ipi-warn .kv-icon { width: 1.1em; height: 1.1em; flex: none; color: #ffc850; margin-top: 0.05em; }
.ipi-warn button { margin-left: auto; flex: none; border: 0; background: transparent; color: var(--kv-accent-2); font-weight: 650; padding: 0; text-decoration: underline; font-size: 1em; }
.ipi-swapbox { position: sticky; top: -0.8em; z-index: 3; margin: -0.8em -1.1em 0.75em; padding: 0.7em 1.1em 0.65em;
  background: rgb(15, 22, 31); border-bottom: 1px solid var(--kv-line); }
.ipi-swapbox .ip-section__title { display: flex; justify-content: space-between; gap: 0.5em; margin-bottom: 0.45em; }
.ipi-swapbox .ip-section__title small { font-weight: 600; letter-spacing: 0.02em; text-transform: none; color: var(--kv-ink-4); }
.ipi-swap { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.5em; align-items: center; padding: 0.45em; border-radius: var(--kv-r);
  background: var(--kv-surface); border: 1px solid var(--kv-line); height: 4.6em; box-sizing: border-box; }
.ipi-swap__links { margin: 0 0 0.9em; }
.ipi-part__mat em { font-style: normal; color: #ffd98a; margin-right: 0.35em; }
.ipi-note-slot:empty { display: none; }
.ipi-note-slot .ipi-warn { margin-top: 0.45em; }
.ipi-fit { font-size: 0.8em; color: #ffd98a; margin: 0.2em 0 0; line-height: 1.4; }
.ipi-fit:empty { display: none; }
.ipi-swap .kv-iconbtn { width: 2.3em; height: 3.6em; }
.ipi-swap__mid { display: flex; gap: 0.6em; align-items: center; min-width: 0; }
.ipi-swap__thumb { flex: none; width: 4.4em; aspect-ratio: 4 / 3; border-radius: var(--kv-r-sm); background: linear-gradient(180deg, #f4f2ee, #ddd8cf) center / cover; overflow: hidden; }
.ipi-swap__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ipi-swap__text { min-width: 0; display: flex; flex-direction: column; gap: 0.1em; }
.ipi-swap__name { font-weight: 650; font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ipi-swap__sub { font-size: 0.76em; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ipi-swap__links { display: flex; gap: 0.8em; flex-wrap: wrap; }
.ipi-link { border: 0; background: transparent; color: var(--kv-accent-2); font-size: 0.8em; font-weight: 620; padding: 0; text-decoration: underline; text-underline-offset: 0.15em; }
.ipi-link:hover { color: #fff; }
.ipi-variants { display: flex; flex-wrap: wrap; gap: 0.36em; --ip-sw: 1.75em; }
.ipi-vname { font-size: 0.82em; color: var(--kv-ink-2); margin-top: 0.45em; }
.ipi-vname small { color: var(--kv-ink-3); }
.ipi-parts { display: flex; flex-direction: column; gap: 0.3em; }
.ipi-part { border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line); background: var(--kv-surface); }
.ipi-part.is-open { border-color: var(--kv-line-2); background: var(--kv-surface-2); }
.ipi-part__head { width: 100%; display: flex; align-items: center; gap: 0.6em; padding: 0.42em 0.55em; border: 0; background: transparent; color: var(--kv-ink); text-align: left; }
.ipi-dot { width: 1.4em; height: 1.4em; border-radius: 50%; flex: none; border: 2px solid rgba(255, 255, 255, 0.18); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25); }
.ipi-part__label { font-weight: 620; font-size: 0.9em; }
.ipi-part__mat { margin-left: auto; font-size: 0.8em; color: var(--kv-ink-3); }
.ipi-part__chev { width: 0.95em; height: 0.95em; color: var(--kv-ink-3); transition: transform 0.15s; }
.ipi-part.is-open .ipi-part__chev { transform: rotate(180deg); }
.ipi-part__body { padding: 0.15em 0.6em 0.65em; display: flex; flex-direction: column; gap: 0.5em; }
.ipi-part__body .ip-swatches { --ip-sw: 1.45em; gap: 0.3em; }
.ipi-swlabel { font-size: 0.72em; color: var(--kv-ink-4); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: -0.25em; }
.ipi-opts { display: flex; flex-direction: column; gap: 0.25em; }
.ipi-opt { display: flex; align-items: center; gap: 0.55em; padding: 0.3em 0.45em; border-radius: var(--kv-r-sm); border: 1px solid transparent; background: transparent; color: var(--kv-ink); text-align: left; font-size: 0.86em; }
.ipi-opt:hover { background: var(--kv-surface); border-color: var(--kv-line); }
.ipi-opt.is-active { border-color: var(--kv-accent); background: var(--kv-surface); }
.ipi-opt .ipi-dot { width: 1.15em; height: 1.15em; }
.ipi-opt small { margin-left: auto; color: var(--kv-ink-3); font-size: 0.86em; }
.ipi-kelvin .kv-range::-webkit-slider-runnable-track { background: linear-gradient(90deg, #ff9d3c, #ffd2a1 35%, #fff4e6 60%, #e6efff); }
.ipi-kelvin .kv-range::-moz-range-track { background: linear-gradient(90deg, #ff9d3c, #ffd2a1 35%, #fff4e6 60%, #e6efff); }
.ipi-hint { font-size: 0.8em; color: var(--kv-ink-3); margin: 0.2em 0 0; line-height: 1.4; }
.ipi-rot { display: flex; align-items: center; gap: 0.5em; }
.ipi-rot__val { flex: 1; text-align: center; font-size: 0.88em; color: var(--kv-ink-2); }
.ipi-rot__val b { display: block; color: var(--kv-ink); font-size: 1.05em; font-variant-numeric: tabular-nums; }
.ipi-rot .kv-btn { padding: 0 0.7em; }
.ipi-details { border-top: 1px solid var(--kv-line); padding-top: 0.6em; margin-bottom: 1.1em; }
.ipi-details > summary { cursor: pointer; list-style: none; font-size: 0.74em; font-weight: 750; letter-spacing: 0.09em; text-transform: uppercase; color: var(--kv-ink-3); display: flex; align-items: center; gap: 0.4em; }
.ipi-details > summary::-webkit-details-marker { display: none; }
.ipi-details > summary::before { content: '▸'; font-size: 1.2em; transition: transform 0.15s; }
.ipi-details[open] > summary::before { transform: rotate(90deg); }
.ipi-details > summary + * { margin-top: 0.6em; }
.ipi-notes { font-size: 0.8em; color: var(--kv-ink-3); line-height: 1.45; margin: 0; }
.ipi-sound { display: flex; gap: 0.6em; align-items: center; font-size: 0.86em; color: var(--kv-ink-2); }
.ipi-sound .kv-icon { width: 1.2em; height: 1.2em; color: var(--kv-ink-3); flex: none; }
.ipi-panel .ip-panel__foot { justify-content: space-between; }
.ipi-panel .ip-panel__foot .kv-btn { padding: 0 0.8em; }
.ipi-paint-name { font-size: 0.9em; color: var(--kv-ink-2); margin: 0 0 0.6em; }
.ipi-paint-name b { color: var(--kv-ink); }
.ipi-panel .ip-color .ip-swatches { --ip-sw: 1.5em; gap: 0.3em; }
.ipi-seg { display: flex; padding: 0.2em; gap: 0.2em; margin: 0.35em 0 0.6em; border-radius: calc(var(--kv-r) + 0.1em); background: rgba(0,0,0,0.28); border: 1px solid var(--kv-line); }
.ipi-seg button { flex: 1; min-width: 0; padding: 0.42em 0.3em; border: 0; border-radius: var(--kv-r); background: none; color: var(--kv-ink-2);
  font: inherit; font-size: 0.84em; font-weight: 620; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ipi-seg button:hover { color: var(--kv-ink); }
.ipi-seg button.is-active { background: var(--kv-accent); color: var(--kv-accent-ink); }
.ipi-looks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.2em 0.3em; margin: 0.35em 0 0.6em; }
.ipi-looks .ipi-opt { min-width: 0; }
.ipi-looks .ipi-opt span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

const S = (body) => `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  prev: S('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  next: S('<path d="M9.5 5.5 16 12l-6.5 6.5"/>'),
  chev: S('<path d="M6.5 9.5 12 15l5.5-5.5"/>'),
  rotL: S('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>'),
  rotR: S('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'),
  copy: S('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  trash: S('<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Down chevron for the colour/material accordion. */
function chevron() {
  const el = svg(IC.chev);
  el.classList.add('ipi-part__chev');
  return el;
}

/** Compass names of a ceiling's long and short side in plan (+x = sør, +z = vest): ['nord–sør', 'øst–vest']. */
function ceilingAxes(polygon) {
  const xs = (polygon || []).map((p) => p.x ?? p[0]);
  const zs = (polygon || []).map((p) => p.y ?? p[1]);
  const longX = xs.length ? Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs) : true;
  return longX ? ['nord–sør', 'øst–vest'] : ['øst–vest', 'nord–sør'];
}

/** Main part of an item (the colour that «is» the item), e.g. upholstery for a chair. */
function mainPart(colors) {
  const keys = Object.keys(colors || {});
  keys.sort((a, b) => (PART_ORDER.indexOf(a) + 1 || 99) - (PART_ORDER.indexOf(b) + 1 || 99));
  return keys[0] || null;
}

export class Inspector extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'inspector', title: 'Egenskaper', icon: 'sliders', side: 'right', width: 25, className: 'ipi-panel' });
    injectCss('ipi-css', CSS);
    this.target = null;
    this._self = 0;
    this._dirty = false;
    this._pointer = false;
    this._ui = { part: null, params: false };
    this._originals = null;
    /** Feature extensions of the item view (addExtension). */
    this._ext = [];
    // «Antall og rutenett» for rows / grids of ceiling fittings (null while the grid UI is not there)
    const grid = gridExtension();
    if (grid) this.addExtension(grid);
    this.el.addEventListener('pointerdown', () => (this._pointer = true));
    this._onUp = () => (this._pointer = false);
    window.addEventListener('pointerup', this._onUp);
    const d = editor.design;
    this._offs = [
      d.on('item:update', ({ uid }) => {
        if (this.target?.kind === 'item' && uid === this.target.uid && !this._self) this._dirty = true;
      }),
      d.on('paint', ({ wallId }) => {
        if (wallId === this._surfaceId() && !this._self) this._dirty = true;
      }),
      d.on('finish', ({ surfaceId }) => {
        if (surfaceId === this._surfaceId() && !this._self) this._dirty = true;
      }),
      d.on('load', () => (this._originals = null)),
    ];
    // , and . flip «Bytt modell» while an item is shown (the arrow keys move the item – Selection)
    this._onKey = (e) => {
      if (!this.isOpen || this.target?.kind !== 'item' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== 'Comma' && e.code !== 'Period') return;
      if (isFormFocused() || !(this.editor.keysActive?.() ?? true) || this.editor.placement?.isActive) return;
      e.preventDefault();
      this.swap(e.code === 'Period' ? 1 : -1);
    };
    window.addEventListener('keydown', this._onKey);
  }

  /**
   * Adds an extension of the item view (ui/imageInspector.js, ui/inspector/gridSection.js …). Every hook is optional;
   * an exception in one is caught and logged:
   *   head(insp, item, product) → HTMLElement|null              replaces the head of a non-catalogue item (first wins)
   *   sections: { afterHead?, afterLight?, size? }(insp, item, product, def) → HTMLElement|null   extra sections;
   *                                                              size replaces «Størrelse» (first non-null wins)
   *   hide(insp, item, product) → { swap?, size?, reset?, parts?: string[], params?: string[]|true }|null
   *   candidates(insp, item, product, list) → list               «Bytt modell» candidates (filter / replace)
   *   carry(insp, item, spec) → spec                             before a swap/reset replaces the item's look
   * Extensions may call insp._fit(uid, patch), insp._apply(patch, { coalesce, label }), insp._render(), set
   * insp._dirty = true, and read insp.design, insp.editor and insp.catalog.
   * @returns {() => void} removes it
   */
  addExtension(ext) {
    this._ext.push(ext);
    this._dirty = true;
    return () => {
      const i = this._ext.indexOf(ext);
      if (i >= 0) this._ext.splice(i, 1);
      this._dirty = true;
    };
  }

  /** What the extensions hide for an item: { swap, size, reset, parts: Set, params: Set, allParams }. */
  _hideFor(item, product) {
    const out = { swap: false, size: false, reset: false, parts: new Set(), params: new Set(), allParams: false };
    for (const e of this._ext) {
      let r = null;
      try {
        r = e.hide?.(this, item, product);
      } catch (err) {
        console.warn('[inspector] extension failed', err);
      }
      if (!r) continue;
      out.swap ||= !!r.swap;
      out.size ||= !!r.size;
      out.reset ||= !!r.reset;
      for (const p of r.parts || []) out.parts.add(p);
      if (r.params === true) out.allParams = true;
      else for (const p of r.params || []) out.params.add(p);
    }
    return out;
  }

  /** The extensions' sections at `where` ('afterHead' | 'afterLight' | 'size'). */
  _extSections(where, item, product, def) {
    const out = [];
    for (const e of this._ext) {
      try {
        const el = e.sections?.[where]?.(this, item, product, def);
        if (el) out.push(el);
      } catch (err) {
        console.warn('[inspector] extension failed', err);
      }
    }
    return out;
  }

  /** Blocked while «Før» (the original room) is shown – the Toolbar explains why. */
  open(target) {
    if (this.editor.ui?.toolbar?.compareActive) return;
    super.open(target);
  }

  /** @param {{ kind: string, uid?: string, wallId?: string, ceilingId?: string }} target */
  onOpen(target) {
    const t = target || this.editor.selected;
    const changed = !this.target || t?.kind !== this.target.kind || t?.uid !== this.target.uid || t?.wallId !== this.target.wallId || t?.ceilingId !== this.target.ceilingId;
    this.target = t ? { ...t } : null;
    if (changed) {
      this._ui = { part: null, params: false };
      this.body.scrollTop = 0;
    }
    this._render();
  }

  onClose() {
    this.target = null;
  }

  /** Every frame: refresh after outside changes (not while a control is in use). */
  update() {
    if (!this.isOpen) return;
    // the model was rebuilt (param change, swap, undo …): its colourable parts may differ
    if (this.target?.kind === 'item' && this._modelObj && this.editor.sync?.getObject) {
      const obj = this.editor.sync.getObject(this.target.uid);
      if (obj && obj !== this._modelObj) {
        this._modelObj = obj;
        const keys = (this._modelParts(this.design.get(this.target.uid)) || []).join(',');
        if (keys !== this._partKeys) this._dirty = true;
      }
    }
    if (!this._dirty) return;
    const a = document.activeElement;
    const busy = this._pointer || (a && this.el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'));
    if (busy) return;
    this._dirty = false;
    this._render();
  }

  // ---- data helpers --------------------------------------------------------------------------------------------

  get design() {
    return this.editor.design;
  }

  get catalog() {
    return this.editor.catalog;
  }

  _apply(patch, opts) {
    const uid = this.target?.uid;
    if (!uid) return null;
    this._self++;
    try {
      return this.design.update(uid, patch, opts);
    } finally {
      this._self--;
    }
  }

  /** Original (today's) item for an item: same uid, or the original it was copied from. */
  _original(item) {
    if (!this._originals) {
      try {
        this._originals = this.design.originalJSON().items;
      } catch {
        this._originals = [];
      }
    }
    return this._originals.find((o) => o.uid === item.uid) || (item.source !== 'catalog' ? this._originals.find((o) => o.refId === item.refId) : null) || null;
  }

  _product(item) {
    return item?.source === 'catalog' ? this.catalog.getProduct(item.refId) : null;
  }

  /**
   * The item's category: the product's own when it is a catalogue product (a design saved before a product moved category,
   * e.g. the round-1 mirrors Smått → Speil, still has the old one in item.category), else the item's – where an item
   * saved in «Smått» is a picture or a side table, which have their own categories since runde 3 (Kunst og bilder, Bord).
   */
  _category(item, product) {
    if (product?.category) return product.category;
    if (item.category === 'smatt') {
      if (item.archetype === 'art-frame') return 'kunst';
      if (/^side-table-/.test(item.archetype || '')) return 'bord';
    }
    return item.category;
  }

  /**
   * Products the item can be swapped with (same category and mount, same sub-type where that matters). An archetype
   * with several mounts (vitrineskap: floor or wall-hung) swaps across them – swap() moves it onto/off the wall.
   */
  _candidates(item, product) {
    const cat = this._category(item, product);
    if (!cat || cat === 'solskjerming' || !this.catalog.CATEGORIES.some((c) => c.key === cat)) return [];
    const compatible = this.catalog.mountsCompatible || ((a, ma, b, mb) => ma === mb);
    let list = this.catalog.products(cat).filter((p) => compatible(item.archetype, item.mount, p.archetype, p.mount));
    if (product?.subcategory) {
      const sub = list.filter((p) => p.subcategory === product.subcategory);
      if (sub.length >= 2) list = sub;
    } else if (!product && (cat === 'tekstil' || cat === 'smatt' || cat === 'akustikk' || cat === 'kunst' || cat === 'spotter')) {
      const arch = list.filter((p) => p.archetype === item.archetype);
      if (arch.length >= 1) list = arch;
    } else if (!product && (cat === 'bord' || cat === 'sofa' || cat === 'stoler')) {
      // today's tables, sofas and chairs have no product: keep to the sub-type the catalogue gives their archetype, so a
      // coffee table is offered coffee tables (sofabord), not a 1.8 m dining table, and a dining chair dining chairs
      const subs = new Set(list.filter((p) => p.archetype === item.archetype).map((p) => p.subcategory));
      if (subs.size && !subs.has(undefined)) {
        const sub = list.filter((p) => subs.has(p.subcategory));
        if (sub.length >= 2) list = sub;
      }
    }
    for (const e of this._ext) {
      if (!e.candidates) continue;
      try {
        list = e.candidates(this, item, product, list) || list;
      } catch (err) {
        console.warn('[inspector] extension failed', err);
      }
    }
    return list;
  }

  /** Variant of `p` whose main colour is closest to the item's current main colour (or the default). */
  _closestVariant(p, item) {
    const part = mainPart(item.colors);
    const cur = part ? resolveColor(item.colors[part], null) : null;
    if (!cur || !p.variants?.length) return p.defaultVariant ?? 0;
    let best = p.defaultVariant ?? 0;
    let bestD = Infinity;
    p.variants.forEach((v, i) => {
      const c = variantColors(p, v)[0];
      const d = colorDist(c, cur) - (i === (p.defaultVariant ?? 0) ? 12 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < 110 ? best : p.defaultVariant ?? 0;
  }

  /**
   * The ceiling over (x, z), world y like the item's position: the ceiling of the item's level (§1.8 – the living
   * room's for a first-floor item, as before).
   */
  _ceilingAt(x, z, item = null) {
    const home = this.editor.home;
    const base = this._floorOfLevel(item);
    try {
      const c = home.ceilingHeightAt?.(x, z, base + 1) ?? this.editor.layout?.ceilingHeightAt?.(x, z, base + 1);
      return Number.isFinite(c) ? c : base + 2.4;
    } catch {
      return base + 2.4;
    }
  }

  /** World y of the floor of the item's level (0 on the first floor). */
  _floorOfLevel(item) {
    return levelFloorY(this.editor.layout, itemLevel(item, this.editor.layout));
  }

  /** The walls of the item's level (home.walls; the shell's carry no levelId: the main level). */
  _wallsOf(item) {
    const lv = itemLevel(item, this.editor.layout);
    return (this.editor.home?.walls || []).filter((w) => (w.levelId ?? 'hoved') === lv);
  }

  /** Parts the built model really has (userData.model.parts with meshes), or null when the model does not say. */
  _modelParts(item) {
    if (!item) return null;
    let obj = null;
    try {
      obj = this.editor.sync?.getObject?.(item.uid) || null;
    } catch {
      obj = null;
    }
    const parts = obj?.userData?.model?.parts;
    if (!parts || typeof parts !== 'object') return null;
    const keys = Object.keys(parts).filter((k) => (Array.isArray(parts[k]) ? parts[k].length > 0 : !!parts[k]));
    return keys.length ? keys : null;
  }

  /** Colours/materials that differ from the item's store variant. */
  _customLook(item, product) {
    const v = product?.variants?.[item.variantIndex ?? product.defaultVariant ?? 0];
    if (!v) return { color: false, mat: false, parts: new Set() };
    const parts = new Set();
    // bedding, towels and coats that only dress the model are not the store's – any colour is fine there
    const props = new Set(this.catalog.archetypeInfo?.(item.archetype)?.propParts || []);
    let color = false;
    let mat = false;
    for (const [k, c] of Object.entries(item.colors || {})) {
      if (props.has(k)) continue;
      if (v.colors?.[k] && colorDist(resolveColor(c), resolveColor(v.colors[k])) > 6) {
        parts.add(k);
        color = true;
      }
    }
    for (const [k, m] of Object.entries(item.materials || {})) {
      if (props.has(k)) continue;
      if (v.materials?.[k] && v.materials[k] !== m) {
        parts.add(k);
        mat = true;
      }
    }
    return { color, mat, parts };
  }

  // ---- fitting in the room -------------------------------------------------------------------------------------

  /** The wall (home.walls entry) a wall item hangs on. */
  _wallOf(item) {
    const walls = this._wallsOf(item);
    if (item.attach?.wallId) {
      const w = walls.find((x) => x.id === item.attach.wallId);
      if (w) return w;
    }
    const p = item.position || [0, 0, 0];
    let best = null;
    for (const w of walls) {
      const L = w.length || Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
      const u = ((p[0] - w.start.x) * (w.end.x - w.start.x) + (p[2] - w.start.y) * (w.end.y - w.start.y)) / L;
      if (u < -0.1 || u > L + 0.1) continue;
      const dist = Math.abs((p[0] - w.start.x) * w.normal.x + (p[2] - w.start.y) * w.normal.y);
      if (!best || dist < best.dist) best = { w, dist };
    }
    return best?.w ?? null;
  }

  /** Largest width/height a wall item can have where it hangs: the wall's length and the wall top over its span. */
  _wallCaps(item, dims = item.dims || {}) {
    const w = this._wallOf(item);
    if (!w) return null;
    const L = w.length || Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
    const dx = (w.end.x - w.start.x) / L;
    const dz = (w.end.y - w.start.y) / L;
    const p = item.position || [0, 0, 0];
    const maxW = Math.max(0.05, L - 0.02);
    const ww = Math.min(dims.w ?? 0.5, maxW);
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const u = cl((p[0] - w.start.x) * dx + (p[2] - w.start.y) * dz, Math.min(ww / 2, L / 2), Math.max(L - ww / 2, L / 2));
    const hAt = (x) => {
      try {
        const v = w.heightAt?.(cl(x, 0, L));
        return Number.isFinite(v) ? v : 2.4;
      } catch {
        return 2.4;
      }
    };
    const top = Math.min(hAt(u - ww / 2), hAt(u), hAt(u + ww / 2));
    return { maxW, maxH: Math.max(0.05, top - 0.04), wallName: w.name };
  }

  /** Lowest ceiling over a floor item's footprint. */
  _ceilingOver(item, dims) {
    const p = item.position || [0, 0, 0];
    const r = ((item.rotationDeg || 0) * Math.PI) / 180;
    const ax = [Math.cos(r), -Math.sin(r)];
    const az = [Math.sin(r), Math.cos(r)];
    let min = Infinity;
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
      const x = p[0] + ax[0] * sx * (dims.w || 0) + az[0] * sz * (dims.d || 0);
      const z = p[2] + ax[1] * sx * (dims.w || 0) + az[1] * sz * (dims.d || 0);
      min = Math.min(min, this._ceilingAt(x, z, item));
    }
    return Number.isFinite(min) ? min : this._ceilingAt(p[0], p[2], item);
  }

  /** New centre for a floor item whose depth changes, so its back stays against the wall it stood against. */
  _keepBack(old, newD) {
    if (old?.mount !== 'floor' || !(old.dims?.d > 0) || !(newD > 0) || Math.abs(newD - old.dims.d) < 0.002) return null;
    const r = ((old.rotationDeg || 0) * Math.PI) / 180;
    const fx = Math.sin(r);
    const fz = Math.cos(r);
    const p = old.position || [0, 0, 0];
    const bx = p[0] - (fx * old.dims.d) / 2;
    const bz = p[2] - (fz * old.dims.d) / 2;
    for (const w of this._wallsOf(old)) {
      const n = w.normal;
      if (!n || n.x * fx + n.y * fz < 0.94) continue; // the wall must face the item's front
      const dist = (bx - w.start.x) * n.x + (bz - w.start.y) * n.y;
      if (dist < -0.03 || dist > 0.08) continue;
      const L = w.length || Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
      const u = ((bx - w.start.x) * (w.end.x - w.start.x) + (bz - w.start.y) * (w.end.y - w.start.y)) / L;
      if (u < -0.05 || u > L + 0.05) continue;
      const s = (newD - old.dims.d) / 2;
      return [p[0] + fx * s, p[1], p[2] + fz * s];
    }
    return null;
  }

  /**
   * Makes a size/model patch fit the room: wall items are capped to the wall's free span (length, wall top), floor
   * items to the ceiling; then Placement.constrain() keeps the item in the room (out of walls and windows, on its
   * wall). The position/attach correction is merged into the patch, so it is the same undo step.
   * @param {string} uid
   * @param {object} patch
   * @param {{ keepBackFrom?: object }} [o] keepBackFrom: the item before a model swap (keeps its back to the wall)
   * @returns {{ patch: object, capped: string[], status: string }}
   */
  _fit(uid, patch, { keepBackFrom = null } = {}) {
    const cur = this.design.get(uid);
    if (!cur) return { patch, capped: [], status: 'ok' };
    const out = { ...patch };
    const next = { ...cur, ...patch, dims: { ...(cur.dims || {}), ...(patch.dims || {}) } };
    if (next.mount === 'soft') return { patch, capped: [], status: 'ok' };
    const dims = { ...next.dims };
    const capped = [];
    const down = (v) => Math.floor(v * 100) / 100;
    if (next.mount === 'wall') {
      const c = this._wallCaps(next, dims);
      if (c && dims.w > c.maxW + 1e-4) {
        dims.w = down(c.maxW);
        capped.push('w');
      }
      const c2 = this._wallCaps(next, dims);
      if (c2 && dims.h > c2.maxH + 1e-4) {
        dims.h = down(c2.maxH);
        capped.push('h');
      }
    } else if (next.mount === 'floor' || next.mount === 'rug') {
      const maxH = this._ceilingOver(next, dims) - (next.position?.[1] || 0) - 0.02;
      if (maxH > 0.2 && dims.h > maxH + 1e-4) {
        dims.h = down(maxH);
        capped.push('h');
      }
    }
    if (patch.dims || capped.length) out.dims = dims;
    let pos = next.position;
    if (keepBackFrom) {
      const p = this._keepBack(keepBackFrom, dims.d);
      if (p) pos = p;
    }
    let status = 'ok';
    const pl = this.editor.placement;
    if (typeof pl?.constrain === 'function' && next.mount !== 'surface') {
      try {
        const r = pl.constrain({ ...next, dims, position: pos });
        status = r?.status || 'ok';
        if (r?.position) pos = r.position;
        if (next.mount === 'wall') {
          if (r?.attach) out.attach = r.attach;
          if (r?.rotationDeg != null && Math.abs(r.rotationDeg - (next.rotationDeg || 0)) > 0.01) out.rotationDeg = r.rotationDeg;
        }
      } catch (err) {
        console.warn('[inspector] constrain failed', err);
      }
    }
    if (pos && (patch.position || (cur.position || []).some((v, i) => Math.abs(v - pos[i]) > 0.0005))) out.position = pos.map((v) => Math.round(v * 1000) / 1000);
    return { patch: out, capped, status };
  }

  /**
   * A size slider value that fits: when the item no longer fits in the room at that size (e.g. wider than the
   * space between two walls), the largest size that does (bisection between the current size and the value).
   */
  _fitDim(uid, k, x) {
    const cur = this.design.get(uid);
    let res = this._fit(uid, { dims: { [k]: x } });
    const was = cur?.dims?.[k];
    if (res.status === 'blocked' && cur && cur.mount !== 'wall' && Number.isFinite(was) && x > was && this._fit(uid, {}).status !== 'blocked') {
      let a = was;
      let b = x;
      let good = null;
      for (let i = 0; i < 9; i++) {
        const m = Math.floor(((a + b) / 2) * 1000) / 1000;
        const r = this._fit(uid, { dims: { [k]: m } });
        if (r.status === 'blocked') b = m;
        else {
          a = m;
          good = r;
        }
      }
      res = good ? { ...good, capped: [...new Set([...good.capped, k])] } : { patch: {}, capped: [k], status: 'blocked' };
    }
    return res;
  }

  // ---- actions -------------------------------------------------------------------------------------------------

  /**
   * Where an item goes when a model swap changes its mount (a floor vitrineskap ↔ the wall-hung one): floor → wall
   * hangs it on the wall behind its back (else the nearest wall – Placement.constrain picks it) with its bottom at
   * the product's params.mountHeight (1.2 m by default); wall → floor stands it on the floor right under where it
   * hung, its back to the same wall. Returns { position, rotationDeg, attach } (attach null = none) or null.
   */
  _remount(item, spec) {
    if (!spec || item.mount === spec.mount) return null;
    const walls = this._wallsOf(item);
    const p = item.position || [0, 0, 0];
    const r = ((item.rotationDeg || 0) * Math.PI) / 180;
    const fx = Math.sin(r);
    const fz = Math.cos(r);
    const h = spec.dims?.h ?? 0.6;
    if (item.mount === 'floor' && spec.mount === 'wall') {
      const half = (item.dims?.d ?? 0.4) / 2;
      const bx = p[0] - fx * half;
      const bz = p[2] - fz * half;
      let best = null;
      for (const w of walls) {
        const n = w.normal;
        if (!n || n.x * fx + n.y * fz < 0.7) continue; // the wall must face the item's front
        const L = w.length || Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
        const u = ((bx - w.start.x) * (w.end.x - w.start.x) + (bz - w.start.y) * (w.end.y - w.start.y)) / L;
        if (u < -0.05 || u > L + 0.05) continue;
        const dist = (bx - w.start.x) * n.x + (bz - w.start.y) * n.y;
        if (dist < -0.05 || dist > 0.6) continue;
        if (!best || dist < best.dist) best = { w, dist, u, L };
      }
      const bottom = Number.isFinite(spec.params?.mountHeight) ? spec.params.mountHeight : 1.2;
      // over the floor of the wall (world y: the basement's walls stand lower)
      const fy = Number.isFinite(best?.w?.floorY) ? best.w.floorY : this._floorOfLevel(item);
      const y = Math.round((fy + bottom + h / 2) * 1000) / 1000;
      if (!best) return { position: [p[0], y, p[2]], rotationDeg: item.rotationDeg || 0, attach: null };
      const { w, u, L } = best;
      const x = w.start.x + ((w.end.x - w.start.x) / L) * u;
      const z = w.start.y + ((w.end.y - w.start.y) / L) * u;
      const rot = (Math.atan2(w.normal.x, w.normal.y) * 180) / Math.PI;
      return { position: [x, y, z], rotationDeg: Math.round(rot * 100) / 100, attach: { wallId: w.id, normal: [w.normal.x, 0, w.normal.y] } };
    }
    if (item.mount === 'wall' && spec.mount === 'floor') {
      const wall = this._wallOf(item);
      const nn = item.attach?.normal;
      const n = Array.isArray(nn) ? { x: nn[0], y: nn[2] } : wall?.normal ? { x: wall.normal.x, y: wall.normal.y } : { x: fx, y: fz };
      const half = (spec.dims?.d ?? 0.4) / 2 + 0.005;
      const rot = (Math.atan2(n.x, n.y) * 180) / Math.PI;
      return { position: [p[0] + n.x * half, this._floorOfLevel(item), p[2] + n.y * half], rotationDeg: Math.round(rot * 100) / 100, attach: null };
    }
    return null;
  }

  /** Replaces the item's look/size/type with a spec, keeping where it stands (one undo step). */
  _replaceWith(spec, label, { keepPlace = true } = {}) {
    const uid = this.target?.uid;
    const item = this.design.get(uid);
    if (!uid || !item) return;
    // what the extensions carry over to the new look (a grid of downlights stays a grid)
    for (const e of this._ext) {
      if (!e.carry) continue;
      try {
        spec = e.carry(this, item, spec) || spec;
      } catch (err) {
        console.warn('[inspector] extension failed', err);
      }
    }
    const before = clone(item);
    // a swap to another mount (vitrineskap floor ↔ wall): onto / off the wall, then fitted like any swap
    const moved = keepPlace ? this._remount(item, spec) : null;
    this._self++;
    try {
      this.design.transaction(label, () => {
        this.design.update(uid, { params: [], colors: [], materials: [], light: null, acoustic: null, notes: null, attach: keepPlace && !moved ? undefined : null });
        const patch = {
          source: spec.source,
          refId: spec.refId ?? null,
          name: spec.name,
          category: spec.category,
          archetype: spec.archetype,
          mount: spec.mount,
          dims: clone(spec.dims),
          params: clone(spec.params || {}),
          colors: clone(spec.colors || {}),
          materials: clone(spec.materials || {}),
          variantIndex: spec.variantIndex ?? 0,
        };
        if (spec.acoustic) patch.acoustic = clone(spec.acoustic);
        if (spec.light) patch.light = clone(spec.light);
        if (spec.notes) patch.notes = spec.notes;
        if (!keepPlace) {
          patch.position = clone(spec.position);
          patch.rotationDeg = spec.rotationDeg ?? 0;
          if (spec.attach) patch.attach = clone(spec.attach);
          this.design.update(uid, patch);
        } else if (moved) {
          patch.position = moved.position;
          patch.rotationDeg = moved.rotationDeg;
          if (moved.attach) patch.attach = moved.attach;
          this.design.update(uid, this._fit(uid, patch).patch);
        } else {
          // same spot, but inside the room: a bigger model is pushed out of walls/windows, the back stays at the wall
          this.design.update(uid, this._fit(uid, patch, { keepBackFrom: before }).patch);
        }
      });
    } finally {
      this._self--;
    }
    this._ui.part = null;
    this._render();
  }

  /** «Bytt modell»: shows the next/previous product of the same kind at the same spot. */
  swap(step) {
    const item = this.design.get(this.target?.uid);
    if (!item) return;
    const product = this._product(item);
    const list = this._candidates(item, product);
    if (!list.length) return;
    const i = product ? list.findIndex((p) => p.id === product.id) : -1;
    const next = list[(((i < 0 ? (step > 0 ? -1 : 0) : i) + step) % list.length + list.length) % list.length];
    if (!next || next === product) return;
    const vi = this._closestVariant(next, item);
    const spec = this.catalog.productToItemSpec(next, vi);
    this._replaceWith(spec, `Bytt til ${next.name}`);
    // the swap row is the first thing in the panel (sticky), so ◀ ▶ stay where they are; show the new product's
    // name, price and store from the top
    this.body.scrollTop = 0;
    this.editor.events.emit('sfx', { name: 'switch' });
  }

  /** Back to the store's variant (catalogue items) or to the measured original (today's furniture). */
  reset() {
    const item = this.design.get(this.target?.uid);
    if (!item) return;
    const product = this._product(item);
    if (product) {
      const spec = this.catalog.productToItemSpec(product, item.variantIndex);
      this._replaceWith(spec, `Tilbakestill ${item.name}`);
    } else {
      const orig = this._original(item);
      if (!orig) return;
      this._replaceWith({ ...orig, source: item.source, name: item.source === 'custom' ? item.name : orig.name }, `Tilbakestill ${item.name}`);
    }
    this.editor.events.emit('toast', { text: `${item.name} er tilbakestilt`, seconds: 2 });
  }

  /** Puts today's furniture back in place of a swapped product (same uid). */
  restoreOriginal() {
    const item = this.design.get(this.target?.uid);
    const orig = item && this.design.originalJSON().items.find((o) => o.uid === item.uid);
    if (!orig) return;
    this._replaceWith(orig, `Tilbake til ${orig.name}`, { keepPlace: false });
    this.editor.events.emit('toast', { text: `${orig.name} er tilbake`, seconds: 2 });
  }

  duplicate() {
    const uid = this.target?.uid;
    if (!uid) return;
    const item = this.design.get(uid);
    let offset;
    try {
      offset = item ? this.editor.placement?.duplicateOffset?.(item) : undefined;
    } catch {
      offset = undefined;
    }
    const nu = this.design.duplicate(uid, Array.isArray(offset) ? { offset } : undefined);
    if (nu) this.editor.select({ kind: 'item', uid: nu });
  }

  remove() {
    const uid = this.target?.uid;
    const item = this.design.get(uid);
    if (!item || item.locked) return;
    this.design.remove(uid);
    this.editor.select(null);
    this.editor.events.emit('toast', { text: `${item.name} er fjernet (Ctrl+Z angrer)`, seconds: 2.5 });
  }

  rotate(deg) {
    const item = this.design.get(this.target?.uid);
    if (!item || item.locked) return;
    // same 15° grid as R / Shift+R (Selection)
    const cur = item.rotationDeg || 0;
    let r = deg > 0 ? Math.floor(cur / 15 + 1e-6) * 15 + 15 : Math.ceil(cur / 15 - 1e-6) * 15 - 15;
    r = ((r + 180) % 360 + 360) % 360 - 180;
    // turning a long item in a corner must not push it into the wall (same as R / Shift+R)
    this._apply(this._fit(item.uid, { rotationDeg: r }).patch, { label: `Roter ${item.name}` });
    this._render();
  }

  // ---- rendering -----------------------------------------------------------------------------------------------

  _render() {
    const t = this.target;
    const scroll = this.body.scrollTop;
    this.foot.replaceChildren();
    if (t?.kind === 'item') this._renderItem();
    else if (t?.kind === 'wall' || t?.kind === 'ceiling') this._renderSurface();
    else {
      this.panel.setTitle('Egenskaper');
      this.body.replaceChildren(emptyState('Klikk på et møbel, en lampe, en vegg eller taket for å endre det.', 'info'));
    }
    this.foot.hidden = !this.foot.childElementCount;
    this.body.scrollTop = scroll;
  }

  _renderItem() {
    const item = this.design.get(this.target.uid);
    if (!item) {
      this.close();
      return;
    }
    const def = getArchetype(item.archetype);
    const product = this._product(item);
    const family = this.catalog.archetypeInfo?.(item.archetype)?.family || null;
    this.panel.setTitle(item.name);
    this._modelObj = this.editor.sync?.getObject?.(item.uid) || null;
    const hide = this._hideFor(item, product);
    const kids = [
      // «Bytt modell» first and sticky: nothing above it changes when a model is swapped, so ◀ ▶ never move
      ...(hide.swap ? [] : this._swapSection(item, product) || []),
      this._headSection(item, product),
      ...this._extSections('afterHead', item, product, def),
      this._variantSection(item, product),
      this._partsSection(item, product, def, family, hide.parts),
      this._lightSection(item, product, def, family),
      ...this._extSections('afterLight', item, product, def),
      // an extension may replace «Størrelse» (a grid's sliders edit ONE fitting)
      hide.size ? null : this._extSections('size', item, product, def)[0] ?? this._sizeSection(item, product, def),
      hide.allParams ? null : this._paramsSection(item, def, hide.params),
      this._placeSection(item),
      this._soundSection(item),
    ].filter(Boolean);
    this.body.replaceChildren(...kids);

    const dup = button({ label: 'Dupliser', size: 'sm', title: 'Lag en kopi ved siden av (Ctrl+D)', onClick: () => this.duplicate() });
    dup.prepend(svg(IC.copy));
    const reset = button({ label: 'Tilbakestill', icon: 'reset', size: 'sm', variant: 'ghost', title: product ? 'Tilbake til butikkens farger og mål' : 'Tilbake til slik møbelet er i dag', onClick: () => this.reset() });
    const del = button({ label: 'Slett', size: 'sm', variant: 'danger', title: 'Fjern fra rommet (Delete)', disabled: !!item.locked, onClick: () => this.remove() });
    del.prepend(svg(IC.trash));
    this.foot.append(...[dup, hide.reset ? null : reset, del].filter(Boolean));
  }

  _headSection(item, product) {
    const badges = [];
    const catLabel = this.catalog.categoryLabel?.(this._category(item, product));
    if (catLabel) badges.push(badge(catLabel));
    const kids = [];
    if (product) {
      const info = priceInfo(this.catalog, product, item.variantIndex);
      if (product.verified) badges.push(Object.assign(badge('Verifisert', 'ok'), { title: product.verifiedNote || 'Pris og mål er sjekket hos butikken' }));
      if (info.onSale) badges.push(badge(info.discount ? `Tilbud −${info.discount} %` : 'Tilbud', 'danger'));
      kids.push(
        h('div.ipi-badges', {}, badges),
        h('div.ipi-store', { text: [product.brand, product.store].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') }),
        h('div.ipi-pricerow', {}, priceEl(info, { big: true }), storeLink(product, { variant: item.variantIndex })),
      );
      if (product.priceNote) kids.push(h('p.ipi-note.ipi-clamp', { text: product.priceNote, title: product.priceNote }));
      // purchase accuracy («egen farge», «egne mål») is shown inline in «Farger og materialer» and «Størrelse» –
      // a banner here would push the controls down right under the cursor after a colour click
    } else {
      for (const e of this._ext) {
        if (!e.head) continue;
        try {
          const el = e.head(this, item, product);
          if (el) return el;
        } catch (err) {
          console.warn('[inspector] extension failed', err);
        }
      }
      const label = item.source === 'existing' ? 'Eksisterende møbel' : 'Kopi av eksisterende møbel';
      badges.unshift(badge(label, 'info'));
      kids.push(h('div.ipi-badges', {}, badges), h('div.ipi-store', { text: item.source === 'existing' ? 'Står i huset i dag – målt fra bilder og plantegning' : 'En kopi du har lagt til' }));
      if (item.notes) {
        kids.push(h('details.ipi-details', {}, h('summary', { text: 'Notater fra oppmålingen' }), h('p.ipi-notes', { text: item.notes })));
      }
    }
    return h('div.ipi-head', {}, kids);
  }

  /**
   * «Bytt modell»: [sticky box with the title and ◀ product ▶ (fixed height), links]. The thumbnail, name, store and
   * price of the shown product are in the box itself, so they stay in view while flipping.
   * @returns {HTMLElement[]|null}
   */
  _swapSection(item, product) {
    const list = this._candidates(item, product);
    if (!list.length || (product && list.length < 2)) return null;
    const i = product ? list.findIndex((p) => p.id === product.id) : -1;
    const shown = i >= 0 ? product : null;
    const thumbBox = h('div.ipi-swap__thumb');
    let mid;
    if (shown) {
      const info = priceInfo(this.catalog, shown, item.variantIndex);
      const url = cachedThumbnail(shown, item.variantIndex, { w: 160, h: 120 });
      const img = h('img', { alt: '' });
      if (url) img.src = url;
      else thumbnail(shown, item.variantIndex, { w: 160, h: 120, priority: true }).then((u) => u && (img.src = u));
      thumbBox.append(img);
      const who = [shown.brand, shown.store].filter((x, j, a) => x && a.indexOf(x) === j).join(' · ');
      mid = h('div.ipi-swap__mid', {}, thumbBox, h('div.ipi-swap__text', {},
        h('span.ipi-swap__name', { text: shown.name, title: shown.name }),
        h('span.ipi-swap__sub', { text: `${info.price != null ? `${info.from ? 'fra ' : ''}${fmtNok(info.price)} · ` : ''}${who}`, title: who }),
        h('span.ipi-swap__sub', { text: `${i + 1} av ${list.length}` })));
    } else {
      thumbBox.append(svg(ICONS.sofa));
      mid = h('div.ipi-swap__mid', {}, h('div.ipi-swap__text', {},
        h('span.ipi-swap__name', { text: 'Prøv andre modeller her' }),
        h('span.ipi-swap__sub', { text: `${list.length} i katalogen · ◀ ▶ bytter på stedet` }),
        h('span.ipi-swap__sub', { text: 'Tast , og . gjør det samme' })));
    }
    const prev = iconButton({ icon: 'back', title: 'Forrige modell (,)', onClick: () => this.swap(-1) });
    prev.replaceChildren(svg(IC.prev));
    const next = iconButton({ icon: 'back', title: 'Neste modell (.)', onClick: () => this.swap(1) });
    next.replaceChildren(svg(IC.next));
    const links = [];
    const cat = this.catalog.CATEGORIES.find((c) => c.key === this._category(item, product));
    if (cat) {
      links.push(h('button.ipi-link', { type: 'button', text: `Se alle ${cat.label.toLowerCase()} i katalogen`, on: { click: () => this.editor.ui.catalog?.open?.(cat.key) } }));
    }
    const orig = product ? this.design.originalJSON().items.find((o) => o.uid === item.uid) : null;
    if (orig) links.push(h('button.ipi-link', { type: 'button', text: `Tilbake til ${orig.name.toLowerCase()}`, title: 'Sett dagens møbel tilbake der det sto', on: { click: () => this.restoreOriginal() } }));
    const box = h('div.ipi-swapbox', {},
      h('h3.ip-section__title', {}, h('span', { text: 'Bytt modell' }), h('small', { text: '◀ ▶ eller , .' })),
      h('div.ipi-swap', {}, prev, mid, next));
    return [box, links.length ? h('div.ipi-swap__links', {}, links) : null].filter(Boolean);
  }

  /**
   * Model params for variant j: its own params / paramsOverride, and – for keys another variant overrides – the
   * product's value again (BESTÅ: «klart glass» → back to «røykfarget glass» when the first variant is picked).
   * undefined when no variant of the product has params.
   */
  _variantParams(product, j) {
    const own = (v) => ({ ...(v?.params || {}), ...(v?.paramsOverride || {}) });
    const keys = new Set((product.variants || []).flatMap((v) => Object.keys(own(v))));
    if (!keys.size) return undefined;
    const mine = own(product.variants[j]);
    const out = {};
    for (const k of keys) {
      if (k in mine) out[k] = clone(mine[k]);
      else if (product.params && k in product.params) out[k] = clone(product.params[k]);
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Switches the item to store variant j (its colours, materials and variant params). */
  _pickVariant(item, product, j) {
    const nv = product.variants[j];
    if (!nv) return;
    const patch = { colors: clone(nv.colors), materials: clone(nv.materials), params: this._variantParams(product, j), variantIndex: j };
    this._apply(patch.params ? this._fit(item.uid, patch).patch : patch, { label: `Velg ${nv.name || 'variant'}` });
    this._render();
  }

  _variantSection(item, product) {
    if (!product || (product.variants?.length || 0) < 2) return null;
    const vi = item.variantIndex ?? 0;
    const v = product.variants[vi];
    const info = priceInfo(this.catalog, product, vi);
    // with an own colour/material no store variant is «the» one any more
    const custom = this._customLook(item, product);
    const own = custom.color || custom.mat;
    const list = h('div.ipi-variants', { role: 'listbox', 'aria-label': 'Varianter' }, product.variants.map((vv, i) => variantSwatch(product, vv, i, {
      active: i === vi && !own,
      onPick: (j) => this._pickVariant(item, product, j),
    })));
    this._vnameEl = h('div.ipi-vname', {}, own ? 'Egen farge' : v?.name || '', own ? h('small', { text: ` · utgangspunkt: ${v?.name || 'butikkens variant'}` }) : info.price != null ? h('small', { text: ` · ${fmtNok(info.price)}` }) : null);
    this._variantList = list;
    return section(`Varianter fra ${product.store} (${product.variants.length})`, list, this._vnameEl);
  }

  /**
   * After a colour/material change from this panel: the «egen farge» note under the parts, the variant highlight and
   * the per-part markers – updated in place, so nothing moves under the cursor.
   */
  _refreshLook() {
    const item = this.design.get(this.target?.uid);
    const product = this._product(item);
    if (!item || !product) return;
    const custom = this._customLook(item, product);
    const own = custom.color || custom.mat;
    const vi = item.variantIndex ?? 0;
    const v = product.variants?.[vi];
    if (this._variantList) {
      [...this._variantList.children].forEach((b, i) => {
        const on = i === vi && !own;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    if (this._vnameEl) {
      const info = priceInfo(this.catalog, product, vi);
      this._vnameEl.replaceChildren(own ? 'Egen farge' : v?.name || '', own ? h('small', { text: ` · utgangspunkt: ${v?.name || 'butikkens variant'}` }) : info.price != null ? h('small', { text: ` · ${fmtNok(info.price)}` }) : null);
    }
    for (const [part, mark] of Object.entries(this._partMarks || {})) mark.hidden = !custom.parts.has(part);
    this._paintNote(custom, product);
  }

  /** The inline «egen farge» note below the colour rows. */
  _paintNote(custom, product) {
    const slot = this._noteSlot;
    if (!slot) return;
    if (!(custom.color || custom.mat)) {
      slot.replaceChildren();
      return;
    }
    const what = custom.color && custom.mat ? 'egen farge og materiale' : custom.mat ? 'eget materiale' : 'egen farge';
    slot.replaceChildren(h('div.ipi-warn', {}, svg(ICONS.warning), h('span', { text: `Dette møbelet har ${what} (fra et eldre lagret design) – ${product.store} selger bare variantene over.` }),
      h('button', { type: 'button', text: 'Butikkens farger', title: 'Tilbake til fargene og materialene i varianten', on: { click: () => this._storeLook() } })));
  }

  /** Back to the variant's colours and materials (size and shape stay). */
  _storeLook() {
    const item = this.design.get(this.target?.uid);
    const product = this._product(item);
    const v = product?.variants?.[item?.variantIndex ?? 0];
    if (!v) return;
    this._apply({ colors: clone(v.colors), materials: clone(v.materials) }, { label: `Butikkens farger: ${item.name}` });
    this._render();
  }

  _partsSection(item, product, def, family, hidden = new Set()) {
    const info = this.catalog.archetypeInfo?.(item.archetype);
    // the archetype's own part names («Spiler», «Takkopp» on a slat pendant) win over the family names a builder uses
    const labels = { ...PART_FALLBACK_LABELS, ...(info?.partLabels || {}), ...(def?.partLabels || {}), ...(info?.ownPartLabels || {}) };
    let parts = [...(def?.parts || info?.parts || [])];
    for (const k of Object.keys(item.colors || {})) if (!parts.includes(k) && (def?.partLabels?.[k] || info?.partLabels?.[k])) parts.push(k);
    if (!parts.length) parts = Object.keys(item.colors || {});
    // only the parts the built model really has (a melange rug has no pattern, a side table without a drawer no
    // front/handle …) – recolouring a part that is not there would do nothing
    const have = this._modelParts(item);
    this._partKeys = (have || []).join(',');
    if (have) parts = [...parts.filter((p) => have.includes(p)), ...have.filter((p) => !parts.includes(p) && (labels[p] || PART_ORDER.includes(p)))];
    parts = parts.filter((p) => !hidden.has(p));
    if (!parts.length) return null;
    const defaults = def?.defaults || {};
    const custom = this._customLook(item, product);
    this._partMarks = {};
    const rows = parts.map((part) => {
      const kind = item.materials?.[part] ?? defaults.materials?.[part] ?? 'plastic';
      const hex = resolveColor(item.colors?.[part] ?? defaults.colors?.[part] ?? defaultColor(kind));
      const label = labels[part] || part;
      const open = this._ui.part === part;
      const dot = h('span.ipi-dot', { style: { background: hex } });
      const mark = h('em', { text: 'egen', title: `Ikke ${product?.store ? `${product.store} sin` : 'butikkens'} farge/materiale`, hidden: !custom.parts.has(part) });
      this._partMarks[part] = mark;
      const matLabel = h('span.ipi-part__mat', {}, mark, MATERIAL_LABELS[kind] || kind);
      const head = h('button.ipi-part__head', {
        type: 'button',
        'aria-expanded': open ? 'true' : 'false',
        on: { click: () => {
          this._ui.part = open ? null : part;
          this._render();
          // bring the opened swatches into view (the body scrolls; the foot buttons are outside it)
          if (!open) {
            requestAnimationFrame(() => {
              const p = this.body.querySelector(`.ipi-part[data-part="${part}"]`);
              const sticky = this.body.querySelector('.ipi-swapbox');
              if (!p) return;
              p.style.scrollMarginTop = sticky ? `${sticky.offsetHeight + 8}px` : '';
              p.style.scrollMarginBottom = '10px';
              p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
          }
        } },
      }, dot, h('span.ipi-part__label', { text: label }), matLabel, chevron());
      const el = h(`div.ipi-part${open ? '.is-open' : ''}`, { 'data-part': part }, head);
      if (!open) return el;

      // a catalogue product only offers what the store sells (the owner's rule): the options of this part across the
      // variants; a pick switches to the variant with that option whose other parts are closest to how they look now,
      // so every combination on screen is one the store really sells
      const prop = (info?.propParts || []).includes(part);
      if (product && !prop) {
        const opts = [];
        product.variants.forEach((vv, j) => {
          const c = vv.colors?.[part];
          if (!c) return;
          const hx = resolveColor(c), k = vv.materials?.[part] || kind;
          let o = opts.find((x) => x.kind === k && colorDist(x.hex, hx) < 4);
          if (!o) opts.push((o = { hex: hx, kind: k, names: [], idx: [] }));
          o.names.push(vv.name);
          o.idx.push(j);
        });
        const vi = item.variantIndex ?? product.defaultVariant ?? 0;
        const otherDist = (vv) => Object.entries(item.colors || {}).reduce((sum, [k, c]) => (k === part || !vv.colors?.[k] ? sum : sum + colorDist(resolveColor(c), resolveColor(vv.colors[k]))), 0);
        const chips = opts.map((o) => {
          const on = o.idx.includes(vi) && !custom.parts.has(part);
          const shown = o.names.length > 2 ? `${o.names.slice(0, 2).join(', ')} +${o.names.length - 2}` : o.names.join(', ');
          return h(`button.ipi-opt${on ? '.is-active' : ''}`, {
            type: 'button',
            title: `${o.names.join(', ')} · ${MATERIAL_LABELS[o.kind] || o.kind}`,
            'aria-pressed': on ? 'true' : 'false',
            on: { click: () => {
              if (on) return;
              const best = o.idx.slice().sort((a, b) => otherDist(product.variants[a]) - otherDist(product.variants[b]))[0];
              this._pickVariant(item, product, best);
            } },
          }, h('span.ipi-dot', { style: { background: o.hex } }), h('span', { text: shown }), h('small', { text: MATERIAL_LABELS[o.kind] || o.kind }));
        });
        const lbl = opts.length > 1 ? `${label} hos ${product.store} – velger hele varianten` : `Bare dette hos ${product.store}`;
        el.append(h('div.ipi-part__body', {}, h('div.ipi-swlabel', { text: lbl }), h('div.ipi-opts', {}, chips)));
        return el;
      }

      // material
      let kinds = kindsFor(part, family, kind);
      if (!kinds.includes(kind)) kinds = [kind, ...kinds];
      kinds = [...new Set(kinds)];
      const mat = select({
        label: 'Materiale',
        options: materialOptions(kinds),
        value: kind,
        onChange: (k) => {
          blurSoon(mat.select);
          this._apply({ materials: { [part]: k } }, { label: `${label}: ${MATERIAL_LABELS[k] || k}` });
          this._render();
        },
      });

      // colour: the store's colours for this part first, then the palette for the material group
      const store = [];
      for (const v of product?.variants || []) {
        const c = v.colors?.[part];
        if (c && !store.some((s) => colorDist(s.hex, resolveColor(c)) < 4)) store.push({ hex: resolveColor(c), name: v.name });
      }
      const groups = PALETTE_GROUPS[kindGroup(kind)] || ['Tekstil'];
      const pal = (palette.materials || []).filter((m) => groups.includes(m.group)).map((m) => ({ hex: m.hex, name: m.name }));
      const swatchList = [...store, ...pal.filter((p) => !store.some((s) => colorDist(s.hex, p.hex) < 4))];
      const live = throttle((c) => this._apply({ colors: { [part]: c } }, { coalesce: `color:${part}`, label: `Farge: ${label.toLowerCase()}` }), 80);
      const picker = colorPicker(hex, (c, { final }) => {
        dot.style.background = c;
        if (final) {
          live.cancel();
          this._apply({ colors: { [part]: c } }, { coalesce: `color:${part}`, label: `Farge: ${label.toLowerCase()}` });
          this._refreshLook();
        } else live(c);
      }, { palette: swatchList, label: `Farge på ${label.toLowerCase()}` });
      const bodyKids = [mat.el, picker.el];
      if (prop) bodyKids.unshift(h('div.ipi-swlabel', { text: 'Pynt – følger ikke med, velg fritt' }));
      else if (store.length) bodyKids.splice(1, 0, h('div.ipi-swlabel', { text: `Farger: ${store.length > 0 ? `${product.store} først, så paletten` : 'paletten'}` }));
      el.append(h('div.ipi-part__body', {}, bodyKids));
      return el;
    });
    // the «egen farge» note goes BELOW the rows: it never pushes the swatch that was just clicked
    this._noteSlot = h('div.ipi-note-slot');
    if (product) this._paintNote(custom, product);
    return section('Farger og materialer', h('div.ipi-parts', {}, rows), this._noteSlot);
  }

  _lightSection(item, product, def, family) {
    const isLamp = family === 'lamp' || !!item.light;
    if (!isLamp) return null;
    const light = item.light || null;
    const lumens = light?.lumens ?? product?.light?.lumens ?? null;
    const base = () => (light ? {} : { dimmer: 1, colorK: product?.light?.colorK ?? 2700, ...(lumens ? { lumens } : {}) });
    const on = toggle({
      label: 'Lampen er på',
      value: light ? light.on !== false : false,
      onChange: (v) => {
        blurSoon(on.input);
        this._apply({ light: { ...base(), on: v } }, { label: v ? 'Slå på lampen' : 'Slå av lampen' });
        this._render();
      },
    });
    const dimLive = throttle((v) => this._apply({ light: { ...base(), dimmer: v / 100 } }, { coalesce: 'dimmer', label: 'Demp lampen' }), 60);
    const dim = slider({
      label: 'Dimmer',
      min: 5,
      max: 100,
      step: 1,
      value: Math.round((light?.dimmer ?? 1) * 100),
      format: (v) => `${Math.round(v)} %`,
      onInput: (v) => dimLive(v),
      onChange: (v) => {
        dimLive.cancel();
        this._apply({ light: { ...base(), dimmer: v / 100 } }, { coalesce: 'dimmer', label: 'Demp lampen' });
        blurSoon(dim.input);
      },
    });
    const kLive = throttle((v) => this._apply({ light: { ...base(), colorK: v } }, { coalesce: 'colorK', label: 'Fargetemperatur' }), 60);
    const kelvin = slider({
      label: 'Fargetemperatur',
      min: 2200,
      max: 4000,
      step: 100,
      value: light?.colorK ?? product?.light?.colorK ?? 2700,
      format: (v) => `${fmtNumber(v, 0)} K`,
      onInput: (v) => kLive(v),
      onChange: (v) => {
        kLive.cancel();
        this._apply({ light: { ...base(), colorK: v } }, { coalesce: 'colorK', label: 'Fargetemperatur' });
        blurSoon(kelvin.input);
      },
    });
    kelvin.el.classList.add('ipi-kelvin');
    const kids = [on.el, dim.el, kelvin.el];
    // a grid item is n fittings: n × the store's lumens
    const n = itemQuantity(item);
    const from = product?.light?.lumens ? ' (fra butikken)' : '';
    const lmText = !lumens ? '' : n > 1
      ? `${n} × ${fmtNumber(lumens, 0)} = ${fmtNumber(n * lumens, 0)} lumen${from}. `
      : `${fmtNumber(lumens, 0)} lumen${from}. `;
    kids.push(h('p.ipi-hint', { text: `${lmText}2700 K er varmt hvitt – som de fleste stuelamper. 3000 K er nøytralt, 4000 K kaldt.` }));

    // pendants: distance from the ceiling
    if (item.mount === 'ceiling') {
      const schema = def?.params?.drop;
      // the ceiling's height over the floor of the lamp's level
      const ceil = this._ceilingAt(item.position?.[0] ?? 0, item.position?.[2] ?? 0, item) - this._floorOfLevel(item);
      const values = { ...(def?.defaults?.params || {}), ...(item.params || {}) };
      const drop = typeof values.drop === 'number' ? values.drop : null;
      if (drop != null) {
        const min = schema?.min ?? 0.1;
        // never longer than the cable (params.maxDrop) or so low that people walk into it
        const cable = typeof values.maxDrop === 'number' ? values.maxDrop : Infinity;
        const max = Math.max(min + 0.1, Math.min(schema?.max ?? 2, ceil - 0.6, cable));
        const bottom = h('p.ipi-hint');
        const paintBottom = (d) => {
          const b = ceil - d;
          bottom.textContent = `Underkant ca. ${fmtNumber(b, 2)} m over gulvet (taket er ${fmtNumber(ceil, 2)} m her).${b < 1.9 ? ' Over et bord er 60–70 cm mellom bordplate og lampe vanlig – men pass hodet der folk går.' : ''}`;
        };
        paintBottom(drop);
        const dropLive = throttle((v) => this._apply({ params: { drop: v } }, { coalesce: 'drop', label: 'Høyde under tak' }), 90);
        const dropCtl = slider({
          label: 'Avstand fra tak',
          min,
          max: Math.max(max, drop),
          step: 0.01,
          value: drop,
          format: (v) => cm(v),
          onInput: (v) => {
            paintBottom(v);
            dropLive(v);
          },
          onChange: (v) => {
            dropLive.cancel();
            this._apply({ params: { drop: v } }, { coalesce: 'drop', label: 'Høyde under tak' });
            blurSoon(dropCtl.input);
          },
        });
        kids.push(dropCtl.el, bottom);
      }
    }

    // tiltable shades (Oslo Wood): the shade's angle – here, next to the light it aims
    const tiltSchema = def?.params?.tilt;
    const tiltValues = { ...(def?.defaults?.params || {}), ...(item.params || {}) };
    if (tiltSchema && (!tiltSchema.requires || tiltValues[tiltSchema.requires])) {
      const tiltLive = throttle((v) => this._apply({ params: { tilt: v } }, { coalesce: 'tilt', label: 'Vinkle skjermen' }), 90);
      const tiltCtl = slider({
        label: tiltSchema.label || 'Vinkel på skjermen',
        min: tiltSchema.min ?? 0,
        max: tiltSchema.max ?? 80,
        step: tiltSchema.step ?? 1,
        value: typeof tiltValues.tilt === 'number' ? tiltValues.tilt : 0,
        format: (v) => `${Math.round(v)}°`,
        onInput: (v) => tiltLive(v),
        onChange: (v) => {
          tiltLive.cancel();
          this._apply({ params: { tilt: v } }, { coalesce: 'tilt', label: 'Vinkle skjermen' });
          blurSoon(tiltCtl.input);
        },
      });
      kids.push(tiltCtl.el, h('p.ipi-hint', { text: tiltSchema.hint ?? '0° = rett opp. Skjermen vippes mot lampens forside – roter lampen for å rette den mot en annen kant.' }));
    }
    kids.push(...this._lightParams(item, def));
    return section('Lys', ...kids);
  }

  /**
   * The archetype's other light params (`section: 'light'` – a spot's aim, a rail's spread …) as controls in «Lys»:
   * number → slider, enum → select, bool → toggle (honouring `requires`). One undo step per drag.
   * @returns {HTMLElement[]}
   */
  _lightParams(item, def) {
    const values = { ...(def?.defaults?.params || {}), ...(item.params || {}) };
    const out = [];
    for (const [k, s] of Object.entries(def?.params || {})) {
      if (k === 'tilt' || !s || s.section !== 'light' || !s.type || (s.requires && !values[s.requires])) continue;
      const label = s.label || k;
      const apply = (v) => this._apply({ params: { [k]: v } }, { coalesce: `param:${k}`, label });
      if (s.type === 'number') {
        const live = throttle((v) => apply(v), 90);
        const fmt = s.unit === '°' ? (v) => `${Math.round(v)}°` : s.unit === 'm' ? (v) => cm(v) : undefined;
        const ctl = slider({
          label,
          min: s.min ?? 0,
          max: s.max ?? 1,
          step: s.step ?? 0.01,
          unit: s.unit && s.unit !== '°' && s.unit !== 'm' ? s.unit : '',
          value: typeof values[k] === 'number' ? values[k] : s.default ?? s.min ?? 0,
          format: fmt,
          onInput: (v) => live(v),
          onChange: (v) => {
            live.cancel();
            apply(v);
            blurSoon(ctl.input);
          },
        });
        out.push(ctl.el);
      } else if (s.type === 'enum') {
        const ctl = select({
          label,
          options: s.options,
          value: values[k] ?? s.default,
          onChange: (v) => {
            blurSoon(ctl.select);
            apply(v);
            this._render();
          },
        });
        out.push(ctl.el);
      } else if (s.type === 'bool') {
        const ctl = toggle({
          label,
          value: !!(values[k] ?? s.default),
          onChange: (v) => {
            blurSoon(ctl.input);
            apply(v);
            this._render();
          },
        });
        out.push(ctl.el);
      } else continue;
      if (s.hint) out.push(h('p.ipi-hint', { text: s.hint }));
    }
    return out;
  }

  _sizeSection(item, product, def) {
    const ref = product?.dims || this._original(item)?.dims || def?.defaults?.dims || null;
    const range = def?.dimsRange || {};
    const kids = [];
    // the room limits the sliders too: a wall item's width/height by the wall (length, wall top), a floor item's
    // height by the ceiling – so the slider cannot go where the item would stick into the wall or the ceiling
    const caps = {};
    if (item.mount === 'wall') {
      const c = this._wallCaps(item);
      if (c) {
        caps.w = c.maxW;
        caps.h = this._wallCaps(item, { ...item.dims, w: Math.min(item.dims?.w ?? 0.5, c.maxW) })?.maxH ?? c.maxH;
      }
    } else if (item.mount === 'floor' || item.mount === 'rug') {
      const mh = this._ceilingOver(item, item.dims || {}) - (item.position?.[1] || 0) - 0.02;
      if (mh > 0.2) caps.h = mh;
    }
    const fitEl = h('p.ipi-fit');
    const label = `Endre størrelse på ${item.name}`;
    const applyDim = (k, x, final) => {
      const res = this._fitDim(item.uid, k, x);
      if (Object.keys(res.patch).length) this._apply(res.patch, { coalesce: 'dims', label });
      const got = res.patch.dims?.[k];
      const capped = res.capped.includes(k) || (got != null && got + 0.004 < x);
      fitEl.textContent = capped ? `${DIM_LABELS[k]} er begrenset til ${cm(got ?? this.design.get(item.uid)?.dims?.[k] ?? x)} – større får ikke plass her${item.mount === 'wall' ? ' på veggen' : ''}.` : '';
      return { res, got, capped, final };
    };
    for (const k of ['w', 'd', 'h']) {
      const v = item.dims?.[k] ?? ref?.[k] ?? 0.5;
      let [min, max] = Array.isArray(range[k]) ? range[k] : [Math.max(0.02, (ref?.[k] ?? v) * 0.5), (ref?.[k] ?? v) * 1.6];
      if (caps[k] != null) max = Math.min(max, caps[k]);
      min = Math.min(min, v);
      max = Math.max(max, v, min + 0.01);
      const live = throttle((x) => applyDim(k, x, false), 90);
      const ctl = slider({
        label: DIM_LABELS[k],
        min: Math.floor(min * 100) / 100,
        max: Math.max(Math.floor(max * 100) / 100, Math.round(v * 100) / 100),
        step: 0.01,
        value: v,
        format: (x) => cm(x),
        onInput: (x) => live(x),
        onChange: (x) => {
          live.cancel();
          const r = applyDim(k, x, true);
          if (r.capped && r.got != null) ctl.set(Math.floor(r.got * 100) / 100);
          blurSoon(ctl.input);
          this._dirty = true; // refresh the warning when the slider is released
        },
      });
      kids.push(ctl.el);
    }
    kids.push(fitEl);
    if (ref) {
      const differs = ['w', 'd', 'h'].some((k) => Math.abs((item.dims?.[k] ?? 0) - (ref[k] ?? 0)) > 0.005);
      const who = product ? `Mål fra ${product.store}` : item.source === 'existing' || this._original(item) ? 'Målt i huset' : 'Standardmål';
      const hint = h('p.ipi-hint', { text: `${who}: ${dimsText(ref)}` });
      kids.push(hint);
      if (differs) {
        kids.push(h('div.ipi-warn', {}, svg(ICONS.warning), h('span', { text: product ? `Egne mål – størrelsen avviker fra produktet hos ${product.store}.` : 'Størrelsen avviker fra møbelet som står der i dag.' }),
          h('button', { type: 'button', text: 'Bruk målene', on: { click: () => {
            this._apply(this._fit(item.uid, { dims: clone(ref) }).patch, { label: `Tilbakestill størrelse på ${item.name}` });
            this._render();
          } } })));
      }
    }
    return section('Størrelse', ...kids);
  }

  _paramsSection(item, def, hidden = new Set()) {
    const schema = { ...(def?.params || {}) };
    for (const k of hidden) delete schema[k];
    // lamps show «Avstand fra tak» in the light section; other ceiling items (absorbers) keep it here
    const family = this.catalog.archetypeInfo?.(item.archetype)?.family || null;
    if (item.mount === 'ceiling' && (family === 'lamp' || item.light)) delete schema.drop;
    // a lamp's shade angle sits in the light section too
    if (family === 'lamp' || item.light) delete schema.tilt;
    const values = { ...(def?.defaults?.params || {}), ...(item.params || {}) };
    // `defaultFrom`: an unset param shows the value of the param it follows (a frame's matH: unset = matW all round)
    for (const [k, s] of Object.entries(schema)) if (s?.defaultFrom && item.params?.[k] == null && values[s.defaultFrom] != null) values[k] = values[s.defaultFrom];
    // floorOnly params (a cabinet's legs / plinth) mean nothing on a wall-hung item – and «Sokkel» there would make the
    // builder draw it with the floor origin (notes/add-storage.md); moving between floor and wall is the swap's job.
    // `requires`: only for products whose params set that flag (the tilt of a tiltable shade); `section` params have a
    // section of their own («Lys», «Antall og rutenett»)
    for (const [k, s] of Object.entries(schema)) if (!s || !s.type || s.section || (s.floorOnly && item.mount === 'wall') || (s.requires && !values[s.requires])) delete schema[k];
    if (!Object.keys(schema).length) return null;
    const lives = {};
    const ed = paramEditor(schema, values, (key, v, { final }) => {
      const apply = () => this._apply({ params: { [key]: v } }, { coalesce: `param:${key}`, label: `${schema[key]?.label || key}` });
      if (final) {
        lives[key]?.cancel();
        apply();
        const a = document.activeElement;
        if (a && ed.el.contains(a) && a.tagName !== 'INPUT') blurSoon(a);
        if (a && a.type === 'range') blurSoon(a);
      } else {
        (lives[key] ||= throttle((x) => this._apply({ params: { [key]: x } }, { coalesce: `param:${key}`, label: `${schema[key]?.label || key}` }), 90))(v);
      }
    });
    const det = h('details.ipi-details', { open: this._ui.params }, h('summary', { text: `Form og detaljer (${Object.keys(schema).length})` }), ed.el);
    det.addEventListener('toggle', () => (this._ui.params = det.open));
    return det;
  }

  _placeSection(item) {
    const r = item.rotationDeg || 0;
    // front = local +z → world (sin r, cos r) in (x, z); bearing from north (−x) clockwise via east (−z)
    const rad = (r * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = Math.cos(rad);
    const bearing = ((Math.atan2(-fz, -fx) * 180) / Math.PI + 360) % 360;
    const dir = DIRS[Math.round(bearing / 45) % 8];
    const kids = [];
    if (item.mount === 'wall') {
      const wallName = this.editor.home?.walls?.find((w) => w.id === item.attach?.wallId)?.name;
      // heights over the floor of the wall it hangs on (world y − that floor: the basement's, the entrance's)
      const wallInfo = this._wallOf(item);
      const fy = Number.isFinite(wallInfo?.floorY) ? wallInfo.floorY : this._floorOfLevel(item);
      const y = (item.position?.[1] ?? 1.4 + fy) - fy;
      const half = (item.dims?.h ?? 0.5) / 2;
      const ceil = this._ceilingAt(item.position?.[0] ?? 0, item.position?.[2] ?? 0, item) - fy;
      // the wall top over the item's span (sloped ceiling), not just the ceiling at its centre
      const caps = this._wallCaps(item);
      const top = caps ? caps.maxH + 0.04 : ceil;
      // through Placement.constrain: stays on the wall, under the ceiling and off windows/doors
      const setV = (v) => {
        const cur = this.design.get(item.uid)?.position || item.position;
        this._apply(this._fit(item.uid, { position: [cur[0], v + fy, cur[2]] }).patch, { coalesce: 'height', label: `Flytt ${item.name}` });
      };
      const live = throttle((v) => setV(v), 60);
      const hCtl = slider({
        label: 'Høyde (midten)',
        min: Math.max(0.02, Math.round(half * 100) / 100),
        max: Math.max(half + 0.1, Math.floor((top - half - 0.01) * 100) / 100),
        step: 0.01,
        value: y,
        format: (v) => cm(v),
        onInput: (v) => live(v),
        onChange: (v) => {
          live.cancel();
          setV(v);
          blurSoon(hCtl.input);
        },
      });
      const family = this.catalog.archetypeInfo?.(item.archetype)?.family;
      // wall cabinets / shelves: the bottom edge is what people measure (over a sideboard, a worktop …)
      const tip = family === 'storage' || family === 'table'
        ? `Underkant ca. ${cm(Math.max(0, y - half))} over gulvet – over en skjenk er 40–60 cm luft vanlig.`
        : 'Bilder henges ofte med midten ca. 145–155 cm over gulvet.';
      kids.push(hCtl.el, h('p.ipi-hint', { text: `${wallName ? `På ${wallName.toLowerCase()}. ` : ''}Dra møbelet med musa for å flytte det sidelengs. ${tip}` }));
    } else {
      // floor items and ceiling fittings (a rail, a grid of spots, an aimed spot) turn in 15° steps
      const ceiling = item.mount === 'ceiling';
      const rl = button({ label: '15°', size: 'sm', title: 'Roter 15° mot klokka (R)', onClick: () => this.rotate(15) });
      rl.prepend(svg(IC.rotL));
      const rr = button({ label: '15°', size: 'sm', title: 'Roter 15° med klokka (Shift+R)', onClick: () => this.rotate(-15) });
      rr.prepend(svg(IC.rotR));
      kids.push(h('div.ipi-rot', {}, rl, h('div.ipi-rot__val', {}, h('b', { text: `${fmtNumber(Math.round(r), 0)}°` }), ceiling ? `retning ${dir}` : `fronten mot ${dir}`), rr));
      kids.push(h('p.ipi-hint', { text: ceiling
        ? 'Dra lampen med musa for å flytte den langs taket. R / Shift+R roterer.'
        : 'Dra møbelet med musa for å flytte det. R / Shift+R roterer, piltastene flytter litt.' }));
    }
    return section('Plassering', ...kids);
  }

  _soundSection(item) {
    let m2 = 0;
    try {
      m2 = itemAbsorption(item);
    } catch {
      return null;
    }
    if (!(m2 > 0.02)) return null;
    let extra = '';
    try {
      // the item's own room (steg 16, E3): a bed in the bedroom is weighed against the bedroom, not the living room
      const roomId = itemRoomId(item, this.editor.layout) ?? LIVING_ROOM_ID;
      const r = this.editor.acoustics(roomId);
      const without = rt60For(Math.max(0.5, r.absorption - m2), r.volume);
      if (without - r.rt60 >= 0.005) extra = ` Uten den ville etterklangen vært ${fmtNumber(without, 2)} s (nå ${fmtNumber(r.rt60, 2)} s).`;
    } catch {
      /* acoustics optional */
    }
    return section('Lyd', h('div.ipi-sound', {}, svg(ICONS.volume), h('span', { text: `Demper ca. ${fmtNumber(m2, 2)} m² (Sabine).${extra}` })));
  }

  // ---- walls and ceilings (paint, slats) ------------------------------------------------------------------------

  /** Id of the wall / ceiling shown (null for an item). */
  _surfaceId() {
    const t = this.target;
    return t?.kind === 'wall' ? t.wallId : t?.kind === 'ceiling' ? t.ceilingId : null;
  }

  /**
   * The wall / ceiling / bulkhead shown: { id, kind: 'wall'|'ceiling', name, original (the data's paint), bulkhead,
   * slats (may get a slat finish), roomId, length (walls), maxH (walls: the highest point of its top line) }.
   */
  _surface() {
    const t = this.target;
    const L = this.editor.layout;
    const id = this._surfaceId();
    if (t.kind === 'wall') {
      const wall = this.editor.home?.walls?.find((w) => w.id === id);
      const lw = L?.house?.wallsById?.[id] ?? L?.wallsById?.[id] ?? null;
      const maxH = Math.max(0.5, ...(lw?.topProfile || [[0, 2.4]]).map(([, v]) => v));
      return { id, kind: 'wall', name: wall?.name || lw?.name || 'Vegg', original: wall?.paint || lw?.paint || 'sand', bulkhead: false,
        slats: surfaceKind(L, id) === 'wall', roomId: lw?.roomId ?? LIVING_ROOM_ID, length: lw?.length ?? wall?.length ?? 3, maxH };
    }
    const info = surfaceInfo(this.editor, id);
    const c = (L?.house?.ceilings ?? L?.ceilings ?? []).find((x) => x.id === id);
    const b = (L?.house?.bulkheads ?? L?.bulkheads ?? []).find((x) => x.id === id);
    return { id, kind: 'ceiling', name: info?.name || 'Tak', original: (c ?? b)?.paint || 'sand', bulkhead: !!info?.bulkhead,
      slats: surfaceKind(L, id) === 'ceiling', roomId: (c ?? b)?.roomId ?? LIVING_ROOM_ID, polygon: c?.polygon ?? null };
  }

  /** setPaint / setFinish without re-rendering from our own change. */
  _surfaceChange(fn) {
    this._self++;
    try {
      return fn(this.design);
    } finally {
      this._self--;
    }
  }

  _renderSurface() {
    const s = this._surface();
    const design = this.design;
    this.panel.setTitle(s.name);
    const painted = !!design.paints[s.id];
    const finish = s.slats ? design.finishes?.[s.id] ?? null : null;
    const what = s.kind === 'wall' ? 'Vegg' : s.bulkhead ? 'Nedforing' : 'Tak';
    this.body.replaceChildren(...[
      h('div.ipi-head', {}, h('div.ipi-badges', {}, badge(what), painted ? badge('Ny farge', 'accent') : badge('Original farge', 'info'), finish ? badge(s.kind === 'wall' ? 'Spiler' : 'Spilepanel', 'accent') : null)),
      this._paintSection(s, finish),
      s.slats ? this._slatSection(s, finish) : null,
    ].filter(Boolean));
    if (painted) {
      this.foot.append(button({ label: 'Tilbake til original farge', icon: 'reset', size: 'sm', onClick: () => {
        design.setPaint(s.id, null);
        this._render();
      } }));
    }
    if (finish) {
      this.foot.append(button({ label: s.kind === 'wall' ? 'Fjern spilene' : 'Fjern spilepanelet', icon: 'close', size: 'sm', variant: 'ghost', onClick: () => {
        design.setFinish(s.id, null);
        this._render();
      } }));
    }
  }

  /** Paint colour of a wall / ceiling: the walls' palette, the native picker and a hex field. */
  _paintSection(s, finish) {
    const design = this.design;
    const original = s.original;
    const current = design.paints[s.id] || original;
    const hex = this.editor.layout?.resolvePaint?.(current) || resolveColor(current);
    const colors = [];
    for (const c of [...paletteColors('walls'), ...paletteColors('paints')]) {
      if (!colors.some((x) => resolveColor(x.hex) === resolveColor(c.hex))) colors.push(c);
    }
    const nameOf = (c) => {
      const x = resolveColor(c);
      const w = Object.values(palette.walls || {}).find((p) => p.hex === x);
      if (w) return `${w.brand} ${w.code} ${w.name}`;
      const p = (palette.paints || []).find((pp) => pp.hex === x);
      return p ? `${p.brand || ''} ${p.code || ''} ${p.name}`.replace(/\s+/g, ' ').trim() : x;
    };
    const nameEl = h('p.ipi-paint-name', {}, 'Farge: ', h('b', { text: nameOf(current) }));
    const live = throttle((c) => this._surfaceChange((d) => d.setPaint(s.id, c)), 90);
    const label = s.kind === 'wall' ? 'Veggfarge' : s.bulkhead ? 'Farge' : 'Takfarge';
    const picker = colorPicker(hex, (c, { final }) => {
      nameEl.replaceChildren('Farge: ', h('b', { text: nameOf(c) }));
      if (final) {
        live.cancel();
        this._surfaceChange((d) => d.setPaint(s.id, c));
      } else live(c);
    }, { palette: colors, label });
    const origName = nameOf(original);
    let hint = s.kind === 'wall'
      ? `I dag: ${origName}. De to første er fargene i stua i dag (Jotun Sand og Marrakesh). Taket i sonen har samme farge som veggene.`
      : `I dag: ${origName}.${s.bulkhead ? ' Nedforingen er den loddrette kanten der taket skifter høyde.' : ''}`;
    if (finish && (finish.look === 'surface' || finish.backing === 'none')) hint += finish.look === 'surface' ? ' Spilene er malt i samme farge.' : ' Fargen synes mellom spilene.';
    return section(label, nameEl, picker.el, h('p.ipi-hint', { text: hint }));
  }

  /**
   * Slat finish of a wall («Spiler») or a ceiling («Spilepanel»): on/off, look, slat size, backing, the wall's extent
   * and height or the ceiling's direction, and what it does to the reverberation. Discrete choices are one undo step
   * each; a slider drag is one step (coalesced).
   */
  _slatSection(s, finish) {
    const wall = s.kind === 'wall';
    const title = wall ? 'Spiler' : 'Spilepanel';
    const set = (patch, opts) => this._surfaceChange((d) => d.setFinish(s.id, { ...(d.finishes[s.id] || defaultFinish(s.kind)), ...patch }, opts));
    const onOff = toggle({
      label: wall ? 'Spiler på veggen' : 'Spilepanel i taket',
      value: !!finish,
      onChange: (on) => {
        this.design.setFinish(s.id, on ? defaultFinish(s.kind) : null);
        this._render();
      },
    });
    if (!finish) {
      return section(title, onOff.el, h('p.ipi-hint', { text: wall
        ? 'Lameller av eik på sort filt, fra gulv til tak. Spilene går rundt vinduer, dører og stikkontakter, og filten demper etterklangen.'
        : 'Lameller i takflaten – følger skråtaket. Spilene går rundt spotter, lamper og røykvarslere, og filten demper etterklangen.' }));
    }
    const kids = [onOff.el];
    // look: wood, black, white or painted in the surface's colour
    const paintHex = this.editor.layout?.resolvePaint?.(this.design.paints[s.id] || s.original) || resolveColor(this.design.paints[s.id] || s.original);
    kids.push(h('div.ipi-swlabel', { text: 'Utførelse' }), h('div.ipi-looks', {}, SLAT_LOOKS.map((l) => {
      const label = l.id === 'surface' ? (wall ? 'Veggens farge' : 'Takets farge') : l.label;
      const title = l.id === 'surface' ? `Spilene malt i ${wall ? 'veggens' : 'takets'} farge` : l.label;
      return h(`button.ipi-opt${finish.look === l.id ? '.is-active' : ''}`, { type: 'button', title, on: { click: () => {
        set({ look: l.id });
        this._render();
      } } }, h('span.ipi-dot', { style: { background: l.hex ?? paintHex } }), h('span', { text: label }));
    })));
    // slat size: presets + sliders (cm)
    const size = sizeOf(finish);
    kids.push(h('div.ipi-swlabel', { text: 'Spiler' }), seg([...Object.entries(SLAT_SIZES).map(([k, v]) => [k, v.label]), ...(size === 'custom' ? [['custom', 'Egne mål']] : [])], size, (k) => {
      const p = SLAT_SIZES[k];
      if (!p) return;
      set({ slatW: p.slatW, gap: p.gap, depth: p.depth });
      this._render();
    }));
    // a slider drag is one undo step (coalesced per slider)
    const live = throttle((patch) => set(patch, { coalesce: Object.keys(patch).join(',') }), 80);
    const commit = (patch) => {
      live.cancel();
      set(patch, { coalesce: Object.keys(patch).join(',') });
      this._render();
    };
    const cmFmt = (v) => `${fmtNumber(v, 1)} cm`;
    kids.push(
      slider({ label: 'Spilebredde', min: 1, max: 8, step: 0.1, value: Math.round(finish.slatW * 1000) / 10, format: cmFmt, onInput: (v) => live({ slatW: v / 100 }), onChange: (v) => commit({ slatW: v / 100 }) }).el,
      slider({ label: 'Mellomrom', min: 0.5, max: 4, step: 0.1, value: Math.round(finish.gap * 1000) / 10, format: cmFmt, onInput: (v) => live({ gap: v / 100 }), onChange: (v) => commit({ gap: v / 100 }) }).el,
    );
    // backing
    const short = { felt: 'Sort filt', 'felt-match': 'Filt i fargen', none: 'Ingen filt' };
    kids.push(h('div.ipi-swlabel', { text: 'Bakside' }), seg(SLAT_BACKINGS.map(([id, l]) => [id, short[id] ?? l]), finish.backing, (v) => {
      set({ backing: v });
      this._render();
    }));
    if (wall) {
      // extent: the whole wall or a section; height: up to the ceiling or a chosen height
      const L = s.length;
      kids.push(h('div.ipi-swlabel', { text: 'Dekker' }), seg([['full', 'Hele veggen'], ['section', 'Del av veggen']], finish.extent, (v) => {
        const patch = { extent: v };
        if (v === 'section' && finish.extent !== 'section') {
          const w = Math.min(L, Math.max(0.6, Math.round((L / 2) * 20) / 20));
          Object.assign(patch, { w, u: Math.round(((L - w) / 2) * 100) / 100 });
        }
        set(patch);
        this._render();
      }));
      if (finish.extent === 'section') {
        const w = Math.min(finish.w, L);
        const posCtl = slider({ label: 'Fra venstre', min: 0, max: Math.max(0.01, Math.round((L - w) * 100) / 100), step: 0.01, value: Math.min(finish.u, L - w), unit: 'm',
          onInput: (v) => live({ u: v }), onChange: (v) => commit({ u: v }) });
        kids.push(
          slider({ label: 'Bredde', min: 0.2, max: Math.round(L * 100) / 100, step: 0.01, value: w, unit: 'm',
            onInput: (v) => live({ w: v, u: Math.min(finish.u, Math.max(0, L - v)) }), onChange: (v) => commit({ w: v, u: Math.min(finish.u, Math.max(0, L - v)) }) }).el,
          posCtl.el,
        );
      }
      kids.push(h('div.ipi-swlabel', { text: 'Høyde' }), seg([['ceiling', 'Til taket'], ['custom', 'Egen høyde']], finish.h == null ? 'ceiling' : 'custom', (v) => {
        set({ h: v === 'ceiling' ? null : Math.min(s.maxH, finish.h ?? 1.2) });
        this._render();
      }));
      if (finish.h != null) {
        kids.push(slider({ label: 'Høyde fra gulvet', min: 0.3, max: Math.round(s.maxH * 100) / 100, step: 0.01, value: Math.min(finish.h, s.maxH), unit: 'm',
          onInput: (v) => live({ h: v }), onChange: (v) => commit({ h: v }) }).el);
      }
    } else {
      // direction: along the ceiling's long side or across it (named after the compass: +x = south, +z = west)
      const [alongName, acrossName] = ceilingAxes(s.polygon);
      kids.push(h('div.ipi-swlabel', { text: 'Retning' }), seg([['along', `Langs (${alongName})`], ['across', `På tvers (${acrossName})`]], finish.direction, (v) => {
        set({ direction: v });
        this._render();
      }));
    }
    kids.push(this._finishSound(s, finish));
    kids.push(h('p.ipi-hint', { text: wall
      ? 'Spilene stopper ved vinduer, dører, stikkontakter og taket. Møbler som står helt inntil veggen kan gå et par centimeter inn i spilene.'
      : 'Spilepanelet følger takflaten (også skråtaket) og går rundt spotter, lamper og røykvarslere.' }));
    return section(title, ...kids);
  }

  /** What a finish does to the reverberation of its room. */
  _finishSound(s, finish) {
    if (!hasFelt(finish)) {
      return h('div.ipi-sound', {}, svg(ICONS.volume), h('span', { text: 'Uten filt bak demper spilene nesten ikke lyd – velg filt for bedre akustikk.' }));
    }
    try {
      const fa = finishAbsorption(this.design.finishes, this.editor.layout, s.roomId).list.find((x) => x.id === s.id);
      if (!fa) return null;
      let extra = '';
      const r = this.editor.acoustics(s.roomId);
      const without = rt60For(Math.max(0.5, r.absorption - fa.m2), r.volume);
      if (without - r.rt60 >= 0.005) extra = ` Etterklangen går fra ${fmtNumber(without, 2)} til ${fmtNumber(r.rt60, 2)} s.`;
      return h('div.ipi-sound', {}, svg(ICONS.volume), h('span', { text: `${fmtNumber(fa.area, 1)} m² spiler på filt demper ca. ${fmtNumber(fa.m2, 1)} m² (Sabine).${extra}` }));
    } catch {
      return null;
    }
  }

  dispose() {
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('keydown', this._onKey);
    for (const off of this._offs) off?.();
    super.dispose();
  }
}

export default Inspector;
