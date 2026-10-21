// Window panel (ARCHITECTURE §8, §12): pick a window (list with a 3D hover highlight) → type of sun shading →
// product (catalogue cards with the price for THIS window) → colour (variants + own colour) → open/tilt sliders,
// mount and the type's settings; «Bruk på alle vinduene i denne veggen», «Fjern». Writes design.setWindow().
// Opened by editor.select({ kind: 'window', windowId }) (a click on a window) or the toolbar (B).
//
// The chosen window is outlined in 3D while the panel is open. Picking a window in the list (or «Vis vinduet»)
// turns the walk camera toward it – or, when it cannot be seen from where you stand, moves you in front of it (a
// short blink) – and flies the dollhouse camera to it. The colour the user picked for a window is remembered across
// types and products: a product gets its nearest variant when that is close, else the own colour (marked as such).
import * as THREE from 'three';
import { BasePanel, section, field, card, swatches, colorPicker, slider, select, button, paramEditor, fmtNok } from './panelKit.js';
import { h, fmtNumber } from './dom.js';
import { Highlighter } from '../core/Highlight.js';
import {
  SHADING_TYPES, FABRICS, MOUNT_LABELS, defaultShadingSpec, shadingTransmission, shadingSize, productSizing,
  updateShading, shadingHooks, setShadingDaylightHint, shadingMounts, defaultShadingMount, shadingMountLabel,
  shadingDoorNote, releaseShading,
} from '../models/shading.js';
import { PLAYER } from '../config.js';
import { products, getProduct, priceOf, productToShadingSpec } from '../catalog/index.js';
import { shadingAbsorption } from '../design/Acoustics.js';
import * as ACOUSTICS from '../design/Acoustics.js';

const TYPE = Object.fromEntries(SHADING_TYPES.map((t) => [t.archetype, t]));
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const cm = (m) => `${Math.round(m * 100)}`;
const pct = (v) => `${Math.round(v * 100)} %`;

/** Rail / fitting colours offered for every product. */
const RAIL_COLORS = [
  { hex: '#f2f2f0', name: 'Hvit' },
  { hex: '#c4c6c7', name: 'Aluminium' },
  { hex: '#3a3c3f', name: 'Antrasitt' },
  { hex: '#1e1e1e', name: 'Sort' },
  { hex: '#6b5a45', name: 'Bronse' },
  { hex: '#a8885a', name: 'Messing' },
];
const RAIL_KIND = { '#f2f2f0': 'painted', '#c4c6c7': 'steel', '#3a3c3f': 'painted', '#1e1e1e': 'black-metal', '#6b5a45': 'bronze', '#a8885a': 'brass' };

/** Typical blind/curtain colours for the own-colour picker. */
const FABRIC_PALETTE = [
  { hex: '#f4f3ef', name: 'Hvit' },
  { hex: '#ebe5d9', name: 'Offwhite' },
  { hex: '#d9cfbf', name: 'Natur' },
  { hex: '#cfc5b4', name: 'Som veggen (SAND)' },
  { hex: '#b4a998', name: 'Grå-beige' },
  { hex: '#9c9a96', name: 'Lys grå' },
  { hex: '#6f6c68', name: 'Grå' },
  { hex: '#3e3d3b', name: 'Antrasitt' },
  { hex: '#1f1f1f', name: 'Sort' },
  { hex: '#4a3a2f', name: 'Mørk brun' },
  { hex: '#3e5857', name: 'Gråturkis' },
  { hex: '#2b3545', name: 'Mørk blå' },
];

/** A variant whose colour is within this CIE76 ΔE of the user's colour counts as «the same colour». */
const CLOSE_DE = 10;

/** sRGB hex → CIE L*a*b* (D65). */
function lab(hex) {
  const n = parseInt(String(hex || '#000000').replace('#', '').slice(0, 6), 16) || 0;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Colour difference (CIE76 ΔE) of two hex colours. */
function deltaE(a, b) {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const sameHex = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** True when `object` is `root` or below it. */
function isUnder(object, root) {
  for (let o = object; o; o = o.parent) if (o === root) return true;
  return false;
}

/** The main colour of a spec (fabric or slats). */
function mainHex(spec) {
  if (!spec) return null;
  const main = TYPE[spec.archetype]?.main || 'fabric';
  return spec.colors?.[main] || spec.colors?.fabric || spec.colors?.slat || null;
}

/** The main colour of a product variant. */
function variantHex(v, main) {
  return v?.colors?.[main] || v?.colors?.fabric || v?.colors?.slat || null;
}

/** The product variant nearest to a colour: { index, dE, name } (null without variants). */
function nearestVariant(product, hex, main) {
  let best = null;
  (product?.variants || []).forEach((v, index) => {
    const vh = variantHex(v, main);
    if (!vh) return;
    const dE = deltaE(vh, hex);
    if (!best || dE < best.dE) best = { index, dE, name: v.name };
  });
  return best;
}

/** Sets the main colour of a spec (and the mirrored fabric/slat key the builders also read). */
function setMain(spec, hex) {
  const main = TYPE[spec.archetype]?.main || 'fabric';
  spec.colors = { ...(spec.colors || {}), [main]: hex };
  if (main === 'fabric' && spec.colors.slat) spec.colors.slat = hex;
  if (main === 'slat' && spec.colors.fabric) spec.colors.fabric = hex;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Same wrap as PlayerController (so a yaw we set is not seen as the user turning). */
function wrapAngle(a) {
  const TAU = Math.PI * 2;
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}
const _ray = new THREE.Ray();
const _v = new THREE.Vector3();
const _box = new THREE.Box3();

export class WindowPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'window', title: 'Vinduer og solskjerming', icon: 'blinds', side: 'right', width: 27.5 });
    injectStyles();
    this.el.classList.add('ip-win');
    this.design = editor.design;
    this.windowId = null;
    this._writing = 0;
    this._dirty = false;
    this._tx = false;
    this._flash = 0;
    this.highlighter = new Highlighter(); // hover in the list + the flash when a window is picked
    this.selHL = new Highlighter({ glow: 0.3 }); // the chosen window, while the panel is open
    this._hover = null;
    /** windowId → { main?: '#hex', rail?: { hex, kind } }: colours the user picked (kept across types/products). */
    this._colors = new Map();
    this._turn = null; // walk camera turning toward a window
    this._orbitTw = null; // dollhouse camera flying to a window
    this._blinkT = null;

    this.applyAllBtn = button({ label: 'Bruk på alle vinduene i denne veggen', icon: 'check', size: 'sm', title: 'Samme solskjerming på alle vinduene (og glassdørene) i denne veggen', onClick: () => this._applyToWall() });
    this.removeBtn = button({ label: 'Fjern', icon: 'close', size: 'sm', variant: 'danger', title: 'Fjern solskjermingen på dette vinduet', onClick: () => this._remove() });
    this.foot.append(this.applyAllBtn, this.removeBtn);

    this._pickGroups = [];
    this._offs = [
      this.design.on('window', ({ windowId }) => {
        this._syncPickables();
        // changed from outside the panel (undo/redo, a loaded design): the window's own spec says the colour now
        if (!this._writing) this._colors.delete(windowId);
        if (!this._writing && this.isOpen && this._targets().includes(windowId)) this._dirty = true;
        if (this.isOpen) {
          this._listDirty = true;
          this._syncSelection(); // the shading was rebuilt: outline the new model
        }
      }),
      this.design.on('load', () => {
        this._syncPickables();
        this._colors.clear();
        if (this.isOpen) {
          this._dirty = true;
          this._syncSelection();
        }
      }),
    ];
    this._syncPickables();
    // an animated shading tells THIS session's LightManager to refresh its shadow maps (always re-bound: a hook
    // from an earlier session would point at a disposed LightManager and keep that whole session alive)
    this._shadowHook = () => editor.home?.lighting?.requestShadowUpdate?.();
    shadingHooks.requestShadowUpdate = this._shadowHook;
    this._onUp = () => setTimeout(() => this._endDrag(), 0);
    window.addEventListener('pointerup', this._onUp);
  }

  // ---- panel lifecycle

  /** @param {string|{ windowId?: string }} [arg] window id (from editor.select) */
  onOpen(arg) {
    const id = typeof arg === 'string' ? arg : arg?.windowId;
    const wins = this._windows();
    if (id && wins.some((w) => w.id === id)) this.windowId = id;
    else if (!this.windowId || !wins.some((w) => w.id === this.windowId)) {
      const sel = this.editor.selected?.kind === 'window' ? this.editor.selected.windowId : null;
      this.windowId = sel || wins.find((w) => w.id === 'win-s1')?.id || wins[0]?.id || null;
    }
    this.render();
    this._syncSelection(true);
  }

  onClose() {
    this._endDrag();
    this.highlighter.set(null);
    this.selHL.set(null);
    this._setMarker(null);
    this._hover = null;
    this._showHint('');
  }

  update(dt) {
    updateShading(dt);
    this._hintT = (this._hintT ?? 0) - dt;
    if (this._hintT <= 0) {
      this._hintT = 0.5;
      this._daylightHint();
    }
    this._updateView(dt);
    if (!this.isOpen) return;
    if (this._flash > 0) {
      this._flash -= dt;
      if (this._flash <= 0 && !this._hover) this.highlighter.set(null);
    }
    this.highlighter.update();
    this.selHL.update();
    if (this._marker && this._markerMat) {
      const t = (performance.now() - this._marker.t0) / 1000;
      this._markerMat.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.cos(t * 3.2));
    }
    if (this._dirty && !this._tx && !this._focusInside()) {
      this._dirty = false;
      this.render();
    } else if (this._listDirty) {
      this._listDirty = false;
      this._renderList();
    }
  }

  /**
   * Makes the shading clickable like the glass: a click on a curtain or blind selects its window (the shading groups
   * carry userData.pick = { kind: 'window', windowId }). Runs after SceneSync has rebuilt the shading.
   */
  _syncPickables() {
    const list = this.editor.home?.pickables?.windows;
    if (!Array.isArray(list)) return;
    for (const g of this._pickGroups) {
      const i = list.indexOf(g);
      if (i >= 0) list.splice(i, 1);
    }
    this._pickGroups = [];
    for (const w of this._windows()) {
      const g = w.anchor?.userData?.shading;
      if (g && g.userData?.pick) {
        list.push(g);
        this._pickGroups.push(g);
      }
    }
  }

  dispose() {
    this._endDrag();
    window.removeEventListener('pointerup', this._onUp);
    for (const off of this._offs) off?.();
    this._offs = [];
    const list = this.editor.home?.pickables?.windows;
    if (Array.isArray(list)) for (const g of this._pickGroups) list.includes(g) && list.splice(list.indexOf(g), 1);
    this._pickGroups = [];
    this.highlighter.dispose();
    this.selHL.dispose();
    this._setMarker(null);
    this._markerMat?.dispose();
    this._markerMat = null;
    this._turn = this._orbitTw = null;
    clearTimeout(this._blinkT);
    this._blinkEl?.remove();
    this._blinkEl = null;
    // let go of everything module-level in models/shading.js that points into this session: the shadow hook, the
    // built shading (its rigs reference the windows → the home → the session), the renderer and the daylight hint
    if (shadingHooks.requestShadowUpdate === this._shadowHook) shadingHooks.requestShadowUpdate = null;
    this._shadowHook = null;
    try {
      releaseShading(this._windows());
    } catch (err) {
      console.warn('[window] shading release failed', err);
    }
    setShadingDaylightHint(null);
    this._colors.clear();
    super.dispose();
  }

  /** Fallback daylight behind the fabrics: outdoor illuminance × scene scale (when a window has no sky light slot). */
  _daylightHint() {
    const L = this.editor.home?.lighting;
    try {
      const info = L?.info?.();
      const S = L?.stats?.S;
      if (info && Number.isFinite(S)) setShadingDaylightHint(0.085 * (info.outdoorLux || 0) * S);
    } catch {
      /* optional */
    }
  }

  // ---- data

  _windows() {
    return this.editor.home?.windows || [];
  }

  _info(id = this.windowId) {
    return this._windows().find((w) => w.id === id) || null;
  }

  _layoutWin(id = this.windowId) {
    const L = this.editor.layout || this.editor.home?.layout;
    return L?.house?.opening?.(id) || L?.opening?.(id) || null;
  }

  /**
   * The windows grouped per level and room (§5.6): [{ levelId, levelName, rooms: [{ roomId, name, windows }] }] in
   * the order of layout.house.levels (top first) and of home.windows inside a level.
   */
  _groups() {
    const H = this.editor.layout?.house;
    const levels = H?.levels?.length ? H.levels : [{ id: 'hoved', name: '1. etasje' }];
    const out = levels.map((l) => ({ levelId: l.id, levelName: l.name ?? l.id, rooms: [] }));
    const byLevel = new Map(out.map((g) => [g.levelId, g]));
    for (const w of this._windows()) {
      const lw = this._layoutWin(w.id);
      const levelId = w.levelId ?? lw?.levelId ?? 'hoved';
      const roomId = w.roomId ?? lw?.roomId ?? 'stue-kjokken';
      let g = byLevel.get(levelId);
      if (!g) {
        g = { levelId, levelName: levelId, rooms: [] };
        byLevel.set(levelId, g);
        out.push(g);
      }
      let r = g.rooms.find((x) => x.roomId === roomId);
      if (!r) {
        r = { roomId, name: H?.room?.(roomId)?.name ?? (roomId === 'stue-kjokken' ? 'Stue/kjøkken' : roomId), windows: [] };
        g.rooms.push(r);
      }
      r.windows.push(w);
    }
    return out.filter((g) => g.rooms.length);
  }

  _spec(id = this.windowId) {
    return this.design.windows?.[id] ?? null;
  }

  /** Openings on the same wall (the terrace door counts). */
  _wallWindows(id = this.windowId) {
    const info = this._info(id);
    if (!info) return [];
    return this._windows().filter((w) => w.wallId === info.wallId);
  }

  /** Windows a write goes to: a curtain across the whole wall is one curtain on every opening of the wall. */
  _targets(spec = this._spec()) {
    if (spec?.archetype === 'curtain' && spec.params?.span === 'wall') return this._wallWindows().map((w) => w.id);
    return this.windowId ? [this.windowId] : [];
  }

  _focusInside() {
    const a = document.activeElement;
    return !!a && this.el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
  }

  // ---- writing

  /**
   * Writes a new spec for the current window (and the rest of the wall for a wall-wide curtain).
   * @param {object|null} spec
   * @param {{ drag?: boolean, label?: string, targets?: string[] }} [o]
   */
  _write(spec, { drag = false, label = 'Endre solskjerming', targets } = {}) {
    const ids = targets || this._targets(spec);
    if (!ids.length) return;
    if (drag && !this._tx) {
      this.design.begin(label);
      this._tx = true;
    }
    this._writing++;
    try {
      if (ids.length > 1 && !this._tx) this.design.transaction(label, () => ids.forEach((id) => this.design.setWindow(id, clone(spec))));
      else for (const id of ids) this.design.setWindow(id, clone(spec));
    } finally {
      this._writing--;
    }
    this._refreshInfo();
    this._renderList();
  }

  _endDrag() {
    if (!this._tx) return;
    this._tx = false;
    this.design.end();
  }

  _patch(fn, opts) {
    const cur = this._spec();
    if (!cur) return;
    const next = clone(cur);
    fn(next);
    this._write(next, opts);
  }

  // ---- rendering

  render() {
    const scroll = this.body.scrollTop;
    this.body.replaceChildren();
    const info = this._info();
    if (!info) {
      this.body.append(h('p.ip-win-note', { text: 'Fant ingen vinduer i huset.' }));
      return;
    }
    const spec = this._spec();
    this.listEl = h('div.ip-win-list', { role: 'radiogroup', 'aria-label': 'Vinduer' });
    const show = button({
      label: 'Vis vinduet',
      icon: 'pin',
      size: 'sm',
      variant: 'ghost',
      title: 'Snu deg mot vinduet – eller gå dit hvis det ikke synes herfra',
      onClick: () => this._showWindow(this.windowId),
    });
    this.showHintEl = h('span.ip-win-showhint', { 'aria-live': 'polite' });
    this.body.append(section('Vindu', this.listEl, h('div.ip-win-showrow', {}, show, this.showHintEl)));
    this._renderList();
    this.body.append(this._typeSection(spec));
    if (spec && TYPE[spec.archetype]) {
      this.body.append(this._productSection(info, spec));
      this.body.append(this._colorSection(spec));
      this.body.append(this._adjustSection(info, spec));
      this.infoEl = h('div.ip-win-info');
      this.body.append(this.infoEl);
      this._refreshInfo();
    } else {
      this.infoEl = null;
      this.body.append(h('p.ip-win-note', { text: 'Velg en type solskjerming over for å se produkter, farger og pris for dette vinduet.' }));
    }
    const wallCount = this._wallWindows().length;
    this.applyAllBtn.disabled = !spec || wallCount < 2 || (spec.archetype === 'curtain' && spec.params?.span === 'wall');
    this.applyAllBtn.title = wallCount < 2 ? 'Det er bare ett vindu i denne veggen' : 'Samme solskjerming på alle vinduene (og glassdørene) i denne veggen';
    this.removeBtn.disabled = !spec;
    this.panel.setTitle(info.name || 'Vinduer og solskjerming');
    requestAnimationFrame(() => (this.body.scrollTop = scroll));
  }

  _renderList() {
    if (!this.listEl) return;
    const groups = this._groups();
    const rooms = groups.reduce((n, g) => n + g.rooms.length, 0);
    const row = (w) => {
      const s = this._spec(w.id);
      const t = s ? TYPE[s.archetype] : null;
      const prod = s?.productId ? getProduct(s.productId) : null;
      const status = t ? `${t.label}${prod ? ` · ${prod.brand}` : ''}` : '';
      const active = w.id === this.windowId;
      const size = `${cm(w.width)} × ${cm(w.height)} cm`;
      const el = h(`button.ip-win-row${active ? '.is-active' : ''}`, {
        type: 'button',
        role: 'radio',
        'aria-checked': active ? 'true' : 'false',
        title: `${w.name || w.id} – ${size}${t ? ` – har solskjerming: ${status}` : ' – ingen solskjerming'}`,
        on: {
          click: () => this._pickWindow(w.id),
          mouseenter: () => this._hoverWindow(w.id),
          mouseleave: () => this._hoverWindow(null),
          focus: () => this._hoverWindow(w.id),
          blur: () => this._hoverWindow(null),
        },
      },
      // the radio says which window the panel edits; the badge says whether it has shading (and which colour)
      h('span.ip-win-row__radio', { 'aria-hidden': 'true' }),
      h('span.ip-win-row__main', {},
        h('span.ip-win-row__name', { text: w.name || w.id }),
        h('span.ip-win-row__sub', { text: size }),
        t
          ? h('span.ip-win-row__badge', {}, h('span.ip-win-row__swatch', { style: { background: mainHex(s) || '#cccccc' } }), h('span.ip-win-row__badgetext', { text: status }))
          : h('span.ip-win-row__none', { text: 'Ingen solskjerming' }),
      ));
      return el;
    };
    // one heading per room (with the level when the house has more than one) once there is more than one room
    const kids = [];
    for (const g of groups) {
      for (const r of g.rooms) {
        if (rooms > 1) kids.push(h('div.ip-win-group', { role: 'presentation' }, h('span.ip-win-group__room', { text: r.name }), groups.length > 1 ? h('span.ip-win-group__level', { text: g.levelName }) : null));
        for (const w of r.windows) kids.push(row(w));
      }
    }
    this.listEl.replaceChildren(...kids);
  }

  _pickWindow(id) {
    if (id !== this.windowId) {
      this._endDrag();
      this.windowId = id;
      if (this.editor.selected?.kind !== 'window' || this.editor.selected.windowId !== id) this.editor.select({ kind: 'window', windowId: id });
      else this.render();
    }
    this._syncSelection();
    this._flashWindow(id);
    this._showWindow(id);
  }

  _hoverWindow(id) {
    this._hover = id;
    if (this._flash > 0 && !id) return; // let the flash of a picked window run out
    this.highlighter.set(id && id !== this.windowId ? this._roots(id) : null);
  }

  _flashWindow(id) {
    this._flash = 1.4;
    this.highlighter.set(this._roots(id));
  }

  /** Outlines the chosen window while the panel is open (re-run when its shading is rebuilt). */
  _syncSelection(flash = false) {
    const show = this.isOpen || flash;
    const roots = show ? this._roots(this.windowId) : null;
    this.selHL.set(roots);
    this._setMarker(show ? this._info(this.windowId) : null);
    if (flash && roots) this._flashWindow(this.windowId);
  }

  /**
   * A glowing frame around the chosen opening, on the wall face (the window's own frame and glass are thin or
   * see-through, so their outline alone is easy to miss). Hidden in screenshots like every highlight.
   */
  _setMarker(info) {
    if (this._marker?.info === info) return;
    if (this._marker) {
      this._marker.group.removeFromParent();
      this._marker.geo.dispose();
      this._marker = null;
    }
    if (!info?.anchor) return;
    this._markerMat ||= new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, fog: false });
    const t = 0.022;
    const z = 0.016;
    const W = info.width;
    const H = info.height;
    const geo = new THREE.BoxGeometry(1, 1, 0.006);
    const group = new THREE.Group();
    group.name = `window-marker:${info.id}`;
    group.userData.isHighlight = true;
    group.userData.noCollide = true;
    const bars = [
      [W + 2 * t, t, 0, t / 2],
      [t, H + t, -W / 2 - t / 2, -H / 2 + t / 2],
      [t, H + t, W / 2 + t / 2, -H / 2 + t / 2],
    ];
    if ((info.sill ?? 0) > 0.05) bars.push([W + 2 * t, t, 0, -H - t / 2]);
    for (const [w, hgt, x, y] of bars) {
      const m = new THREE.Mesh(geo, this._markerMat);
      m.scale.set(w, hgt, 1);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = false;
      m.renderOrder = 3;
      m.userData.isHighlight = true;
      m.userData.noCollide = true;
      m.raycast = () => {};
      group.add(m);
    }
    info.anchor.add(group);
    group.updateMatrixWorld(true);
    this._marker = { info, group, geo, t0: performance.now() };
  }

  /** 3D objects of a window for the highlight: frame/glass/sill group, the door leaf + its shading. */
  _roots(id) {
    const info = this._info(id);
    if (!info) return null;
    const roots = [];
    if (info.group) roots.push(info.group);
    else for (const g of info.glass || []) if (g.parent) roots.push(g.parent);
    for (const leaf of info.door?.leaves || []) if (leaf.pivot) roots.push(leaf.pivot);
    const sh = info.anchor?.userData?.shading;
    if (sh && !roots.some((r) => isUnder(sh, r))) roots.push(sh);
    return roots.length ? roots : null;
  }

  // ---- showing the window (camera)

  _showHint(text) {
    if (this.showHintEl) this.showHintEl.textContent = text || '';
  }

  /**
   * Brings the window into view: walk mode turns toward it (or moves you in front of it when walls are in the way),
   * the dollhouse flies to it; the plan view only outlines it.
   */
  _showWindow(id) {
    const info = this._info(id);
    const ed = this.editor;
    const game = ed?.game;
    if (!info || !game?.camera) return;
    const views = ed.views;
    const mode = views?.mode ?? 'walk';
    if (mode === 'walk') {
      if (views && views.isWalking === false) return; // flying between views
      this._walkTo(info);
    } else if (mode === 'orbit') {
      this._orbitTo(info);
      this._showHint('');
    } else {
      // the plan shows one level: the window's
      const level = info.levelId ?? this._layoutWin(info.id)?.levelId;
      if (mode === 'plan' && level && views?.level && level !== views.level) views.setLevel?.(level);
      this._showHint(mode === 'plan' ? 'Vinduet er markert i planen.' : '');
    }
  }

  /** Point to look at: the middle of the glass, just in front of the opening. */
  _aim(info, out = new THREE.Vector3()) {
    return out.copy(info.center).addScaledVector(info.normal, 0.04);
  }

  /** Share of sample points of the opening that can be seen from `eye` (walls/kitchen only, furniture ignored). */
  _visibleShare(eye, info) {
    const col = this.editor.game?.collision;
    if (!col?.raycast) return 1;
    const n = info.normal;
    const toEye = _v.subVectors(eye, info.center);
    const dist = toEye.length();
    if (dist < 0.3) return 1;
    // seen almost edge-on (standing along the window wall) does not count as seeing it
    if (toEye.dot(n) / dist < 0.26) return 0;
    let seen = 0;
    const pts = [[0, 0], [-0.36, -0.32], [0.36, -0.32], [-0.36, 0.32], [0.36, 0.32]];
    const p = new THREE.Vector3();
    // sample just in front of the glass at the back of the reveal: seen at a steep angle the reveal hides it
    const back = -Math.max(0, (info.revealDepth ?? 0.2) - 0.05);
    for (const [sx, sy] of pts) {
      p.copy(info.center).addScaledVector(info.right, sx * info.width).addScaledVector(new THREE.Vector3(0, 1, 0), sy * info.height).addScaledVector(n, back);
      const d = p.clone().sub(eye);
      const len = d.length();
      _ray.set(eye, d.multiplyScalar(1 / len));
      const hit = col.raycast(_ray, len, { includeDynamic: false });
      if (!hit || hit.distance >= len - 0.04) seen++;
    }
    return seen / pts.length;
  }

  /** Yaw/pitch for looking at a point from `eye`, with the point centred in the part of the view the panel leaves free. */
  _lookAngles(eye, target) {
    const game = this.editor.game;
    const cam = game.camera;
    const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
    let yaw = Math.atan2(-dx, -dz);
    const pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.2, 1.2);
    try {
      const canvas = game.renderer.domElement.getBoundingClientRect();
      const panel = this.el.getBoundingClientRect();
      if (this.isOpen && panel.width > 0 && panel.left > canvas.left + canvas.width * 0.4 && panel.left < canvas.right) {
        const freeMid = (canvas.left + panel.left) / 2;
        const ndcX = ((freeMid - canvas.left) / canvas.width) * 2 - 1;
        const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (cam.aspect || canvas.width / Math.max(1, canvas.height));
        yaw -= Math.atan(-ndcX * tanH);
      }
    } catch {
      /* centred */
    }
    return { yaw: wrapAngle(yaw), pitch };
  }

  _walkTo(info) {
    const game = this.editor.game;
    const player = game.player;
    if (!player) return;
    const eye = game.camera.getWorldPosition(new THREE.Vector3());
    const target = this._aim(info);
    const dist = eye.distanceTo(target);
    // far away or tiny on screen (the door from the TV corner) counts as not seen: walk up to it instead
    const far = dist > 8.5 || Math.sqrt(info.width * info.height) / dist < 0.24;
    if (!far && this._visibleShare(eye, info) >= 0.4) {
      const { yaw, pitch } = this._lookAngles(eye, target);
      this._turnTo(yaw, pitch);
      this._showHint('');
      return;
    }
    const spot = this._viewpoint(info);
    if (!spot) {
      const { yaw, pitch } = this._lookAngles(eye, target);
      this._turnTo(yaw, pitch);
      this._showHint('Vinduet synes ikke godt herfra – gå nærmere.');
      return;
    }
    this._blinkTo(spot);
    this._showHint('');
  }

  /** A free spot on the floor in front of the window, inside the room, from where the whole window can be seen. */
  _viewpoint(info) {
    const game = this.editor.game;
    const col = game.collision;
    const n = new THREE.Vector3(info.normal.x, 0, info.normal.z).normalize();
    const r = new THREE.Vector3(info.right.x, 0, info.right.z).normalize();
    // on the floor of the window's room (the basement's, the entrance's: floorY of the window, §5.6)
    const fy = Number.isFinite(info.floorY) ? info.floorY : 0;
    const base = new THREE.Vector3(info.center.x, fy, info.center.z);
    const d0 = THREE.MathUtils.clamp(0.9 + 1.1 * Math.max(info.width, info.height), 1.8, 3.4);
    const eyeH = PLAYER.eyeHeight;
    const target = this._aim(info);
    const feet = new THREE.Vector3();
    const eye = new THREE.Vector3();
    for (const d of [d0, d0 - 0.4, d0 + 0.4, d0 - 0.8, d0 + 0.8, 1.4]) {
      for (const s of [0, 0.45, -0.45, 0.9, -0.9]) {
        feet.copy(base).addScaledVector(n, d).addScaledVector(r, s);
        if (col?.isWalkable && !col.isWalkable(feet.x, feet.z, feet.y)) continue;
        if (this.editor.home?.rooms?.length && !this.editor.home.rooms.some((rm) => !rm.hud && rm.box?.containsPoint?.(_v.set(feet.x, feet.y + 0.5, feet.z)))) continue;
        eye.copy(feet).setY(feet.y + eyeH);
        if (this._visibleShare(eye, info) < 0.8) continue;
        if (!this._freeSpot(feet)) continue;
        return { feet: feet.clone(), ...this._lookAngles(eye, target) };
      }
    }
    return null;
  }

  /** Room for the player's capsule here: no furniture box and no wall/counter within its radius. */
  _freeSpot(feet) {
    const col = this.editor.game?.collision;
    if (!col) return true;
    const R = PLAYER.radius + 0.05;
    _box.min.set(feet.x - R, feet.y + 0.08, feet.z - R);
    _box.max.set(feet.x + R, feet.y + PLAYER.height - 0.05, feet.z + R);
    for (const d of col.dynamic || []) if (d?.enabled !== false && d.box && _box.intersectsBox(d.box)) return false;
    if (!col.raycast) return true;
    const o = new THREE.Vector3();
    for (const y of [0.35, 1.0, 1.6]) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        o.set(feet.x, feet.y + y, feet.z);
        _ray.set(o, _v.set(Math.cos(ang), 0, Math.sin(ang)));
        if (col.raycast(_ray, R, { includeDynamic: false })) return false;
      }
    }
    return true;
  }

  _turnTo(yaw, pitch) {
    const p = this.editor.game?.player;
    if (!p) return;
    const dy = wrapAngle(yaw - p.yaw);
    const dur = THREE.MathUtils.clamp(0.25 + Math.max(Math.abs(dy), Math.abs(pitch - p.pitch)) * 0.32, 0.3, 0.85);
    this._turn = { t: 0, dur, y0: p.yaw, dy, p0: p.pitch, p1: pitch, lastYaw: null, lastPitch: null };
  }

  /** Moves the player in front of the window behind a short dark blink (no flying through walls). */
  _blinkTo(spot) {
    const game = this.editor.game;
    const root = this.editor.uiRoot;
    if (!game?.player) return;
    this._turn = null;
    const jump = () => {
      game.player.teleport(spot.feet, spot.yaw, spot.pitch);
      game.camera.updateMatrixWorld?.();
    };
    if (!root) {
      jump();
      return;
    }
    if (!this._blinkEl) {
      this._blinkEl = h('div.ip-win-blink', { 'aria-hidden': 'true' });
      root.append(this._blinkEl);
    }
    const el = this._blinkEl;
    el.classList.add('is-on');
    clearTimeout(this._blinkT);
    this._blinkT = setTimeout(() => {
      jump();
      this._blinkT = setTimeout(() => el.classList.remove('is-on'), 40);
    }, 170);
  }

  _orbitTo(info) {
    const views = this.editor.views;
    const cam = views?.persp;
    const oc = views?.controls;
    if (!cam || !oc) return;
    // the overview shows one level: the window's (§5.2)
    const level = info.levelId ?? this._layoutWin(info.id)?.levelId;
    if (level && views.level && level !== views.level) views.setLevel?.(level, { instant: true });
    views._fresh = null; // the user's own framing from now on
    const fy = Number.isFinite(info.floorY) ? info.floorY : 0;
    const target = info.center.clone();
    target.y = THREE.MathUtils.clamp(info.center.y, fy + 0.7, fy + 1.7);
    const n = new THREE.Vector3(info.normal.x, 0, info.normal.z).normalize();
    const dist = THREE.MathUtils.clamp(3.6 + 1.2 * Math.max(info.width, info.height), 4.5, 7);
    const el = THREE.MathUtils.degToRad(36);
    const pos = target.clone().addScaledVector(n, Math.cos(el) * dist).setY(target.y + Math.sin(el) * dist);
    // fly in spherical coordinates around the moving pivot: a straight line between two poses can pass right
    // above the pivot, where OrbitControls clamps the polar angle (and the flight would be cut short)
    const s0 = new THREE.Spherical().setFromVector3(_v.subVectors(cam.position, oc.target));
    const s1 = new THREE.Spherical().setFromVector3(_v.subVectors(pos, target));
    const lim = [THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(78)];
    s0.phi = THREE.MathUtils.clamp(s0.phi, lim[0], lim[1]);
    s1.phi = THREE.MathUtils.clamp(s1.phi, lim[0], lim[1]);
    const dTheta = wrapAngle(s1.theta - s0.theta);
    this._orbitTw = { t: 0, dur: 0.9, s0, s1, dTheta, t0: oc.target.clone(), t1: target, last: null };
  }

  /** Per frame: the walk-camera turn and the dollhouse flight (both give way as soon as the user takes over). */
  _updateView(dt) {
    const game = this.editor.game;
    const tw = this._turn;
    if (tw) {
      const p = game?.player;
      const walking = this.editor.views?.isWalking !== false;
      if (!p || !walking || (tw.lastYaw != null && (Math.abs(p.yaw - tw.lastYaw) > 1e-6 || Math.abs(p.pitch - tw.lastPitch) > 1e-6))) {
        this._turn = null;
      } else {
        tw.t = Math.min(1, tw.t + (dt || 0) / tw.dur);
        const k = ease(tw.t);
        p.yaw = wrapAngle(tw.y0 + tw.dy * k);
        p.pitch = THREE.MathUtils.clamp(tw.p0 + (tw.p1 - tw.p0) * k, PLAYER.minPitch, PLAYER.maxPitch);
        game.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
        tw.lastYaw = p.yaw;
        tw.lastPitch = p.pitch;
        if (tw.t >= 1) this._turn = null;
      }
    }
    const ot = this._orbitTw;
    if (ot) {
      const views = this.editor.views;
      const cam = views?.persp;
      const oc = views?.controls;
      if (!cam || !oc || views.mode !== 'orbit' || views.isWalking || (ot.last && cam.position.distanceTo(ot.last) > 0.02)) {
        this._orbitTw = null;
      } else {
        ot.t = Math.min(1, ot.t + (dt || 0) / ot.dur);
        const k = ease(ot.t);
        oc.target.lerpVectors(ot.t0, ot.t1, k);
        const s = (ot.s ||= new THREE.Spherical());
        s.set(ot.s0.radius + (ot.s1.radius - ot.s0.radius) * k, ot.s0.phi + (ot.s1.phi - ot.s0.phi) * k, ot.s0.theta + ot.dTheta * k);
        cam.position.setFromSpherical(s).add(oc.target);
        cam.lookAt(oc.target);
        cam.updateMatrixWorld(true);
        ot.last = cam.position.clone();
        if (ot.t >= 1) this._orbitTw = null;
      }
    }
  }

  _typeSection(spec) {
    const cur = spec?.archetype || null;
    const chips = [{ id: null, label: 'Ingen' }, ...SHADING_TYPES.map((t) => ({ id: t.archetype, label: t.label }))].map((t) =>
      h(`button.ip-win-chip${t.id === cur ? '.is-active' : ''}`, {
        type: 'button',
        'aria-pressed': t.id === cur ? 'true' : 'false',
        text: t.label,
        on: { click: () => this._setType(t.id) },
      }));
    return section('Type', h('div.ip-win-chips', {}, chips));
  }

  _setType(archetype) {
    const cur = this._spec();
    if ((cur?.archetype || null) === archetype) return;
    if (!archetype) {
      this._remove();
      return;
    }
    const info = this._info();
    const next = defaultShadingSpec(archetype, info);
    // the colour the user chose for this window (swatch, variant or own colour) follows to the new type
    this._applyWanted(next, this._wanted(cur), { custom: true });
    const old = this._targets(cur);
    this._write(next, { label: `Solskjerming: ${TYPE[archetype].label}`, targets: [this.windowId] });
    // a wall-wide curtain replaced by something else: the other openings lose it too
    if (old.length > 1) this._write(null, { targets: old.filter((id) => id !== this.windowId) });
    this.render();
  }

  _productSection(info, spec) {
    const list = products('solskjerming').filter((p) => p.archetype === spec.archetype);
    const cards = [];
    const custom = !spec.productId;
    cards.push(card({
      swatch: spec.colors?.fabric || spec.colors?.slat || '#cccccc',
      title: `Egendefinert ${TYPE[spec.archetype].label.toLowerCase()}`,
      subtitle: 'Fritt valg av farge og mål, uten pris',
      selected: custom,
      onClick: () => {
        if (custom) return;
        const next = clone(spec);
        delete next.productId;
        delete next.variantIndex;
        if (next.params) delete next.params.pieces;
        this._write(next);
        this.render();
      },
    }));
    for (const p of list) {
      const vi = spec.productId === p.id ? spec.variantIndex ?? p.defaultVariant ?? 0 : p.defaultVariant ?? 0;
      const est = this._estimate(p, vi, this._specFor(p, vi, spec));
      const sz = productSizing(p);
      const badges = [];
      badges.push(sz?.custom ? { text: 'Måltilpasset', tone: 'info' } : { text: 'Ferdigmål', tone: 'neutral' });
      if (est.onSale) badges.push({ text: 'Tilbud', tone: 'accent' });
      if (est.warns.length) badges.push({ text: est.warns[0].short, tone: 'warn' });
      if (!p.verified) badges.push({ text: 'Ikke verifisert', tone: 'warn' });
      const el = card({
        image: p.imageUrl,
        icon: 'blinds',
        title: p.name,
        subtitle: `${p.brand}${p.store && p.store !== p.brand ? ` · ${p.store}` : ''}`,
        price: est.total != null ? est.total : '',
        priceOld: est.totalList != null && est.totalList > est.total + 1 ? est.totalList : undefined,
        badges,
        selected: spec.productId === p.id,
        onClick: () => this._pickProduct(p),
      });
      if (p.why) el.title = p.why;
      cards.push(el);
    }
    return section(`Produkter (${list.length})`, h('div.ip-win-cards', {}, cards));
  }

  /**
   * The spec a product would give on this window (keeps the current open/tilt, and the mount the user chose, when
   * the type is the same).
   */
  _specFor(product, vi, cur) {
    const s = productToShadingSpec(product, vi);
    if (!s) return null;
    const info = this._info();
    const mounts = shadingMounts(s.archetype, info);
    if (!mounts.includes(s.mount)) s.mount = defaultShadingMount(s.archetype, info);
    if (s.archetype === 'curtain') {
      s.mount = s.params.track === 'wall' ? 'wall' : 'ceiling';
      s.params.span = cur?.archetype === 'curtain' ? cur.params?.span || 'window' : 'window';
      if (info && info.sill > 0.55 && !s.params.length) s.params.length = 'sill';
    }
    if (cur && cur.archetype === s.archetype) {
      s.open = cur.open;
      s.tilt = cur.tilt;
      // curtains: the rod/track belongs to the product; blinds: keep where the user mounted it (e.g. the door leaf)
      if (cur.mount && mounts.includes(cur.mount) && (cur.productId === product.id || s.archetype !== 'curtain')) s.mount = cur.mount;
    }
    return s;
  }

  _pickProduct(p) {
    const cur = this._spec();
    if (cur?.productId === p.id) return;
    const main = TYPE[p.archetype]?.main || 'fabric';
    const want = this._wanted(cur);
    // the user's colour: the product's nearest variant – a catalogue product only comes in the colours the store sells
    let vi = p.defaultVariant ?? 0;
    let near = null;
    if (want?.main && p.variants?.length) {
      near = nearestVariant(p, want.main, main);
      if (near) vi = near.index;
    }
    const next = this._specFor(p, vi, cur);
    if (!next) return;
    this._write(next, { label: `Velg ${p.name}` });
    this.render();
    const store = p.store || p.brand || 'butikken';
    if (near && near.dE > 2.5) {
      this.editor.events?.emit?.('toast', { text: `Nærmeste farge hos ${store}: ${near.name}.`, seconds: near.dE > CLOSE_DE ? 4 : 3 });
    }
  }

  // ---- the user's colour per window

  /** Remembers a colour choice for the current window. */
  _remember(patch) {
    if (!this.windowId) return;
    const cur = { ...(this._colors.get(this.windowId) || {}), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k];
    this._colors.set(this.windowId, cur);
  }

  /**
   * The colour to carry over to a new type or product: what the user picked for this window, else the current
   * spec's colour when it is not just the type's default.
   */
  _wanted(cur) {
    const mem = this._colors.get(this.windowId);
    if (mem?.main || mem?.rail) return mem;
    if (!cur || !TYPE[cur.archetype]) return null;
    const hex = mainHex(cur);
    const def = mainHex(defaultShadingSpec(cur.archetype, this._info()));
    return hex && !sameHex(hex, def) ? { main: hex } : null;
  }

  /** Puts a wanted colour on a spec. custom: a spec without a product (venetian head rails follow the slats). */
  _applyWanted(spec, want, { custom = false } = {}) {
    if (!spec || !want) return;
    if (want.main) {
      setMain(spec, want.main);
      if (custom && spec.archetype === 'venetian' && !want.rail) spec.colors.rail = want.main;
    }
    if (want.rail?.hex) {
      spec.colors = { ...(spec.colors || {}), rail: want.rail.hex };
      spec.materials = { ...(spec.materials || {}), rail: want.rail.kind || 'painted' };
    }
  }

  _colorSection(spec) {
    const t = TYPE[spec.archetype];
    const main = t.main;
    const product = spec.productId ? getProduct(spec.productId) : null;
    const nodes = [];
    if (product && product.variants?.length > 1) {
      const sw = swatches(product.variants.map((v) => ({ hex: v.colors?.[main] || v.colors?.fabric || v.colors?.slat || '#cccccc', name: v.name })), (hex, c) => {
        const vi = product.variants.findIndex((v) => v.name === c.name);
        if (vi < 0) return;
        const v = product.variants[vi];
        this._patch((s) => {
          s.variantIndex = vi;
          s.colors = clone(v.colors);
          s.materials = clone(v.materials);
        }, { label: `Farge: ${v.name}` });
        // the variant's own rail comes with it; its colour is what the user wants on the next type/product too
        this._remember({ main: variantHex(v, main), rail: null });
        this.render();
      }, { value: spec.colors?.[main], size: '2em' });
      const vName = product.variants[spec.variantIndex ?? product.defaultVariant ?? 0]?.name;
      nodes.push(field('Varianter', sw, { hint: vName || '' }));
    }
    const hexNow = mainHex(spec) || '#cccccc';
    // an own colour on a product: none of its variants has it (only from an older saved design now)
    const ownOnProduct = !!product && !(product.variants || []).some((v) => sameHex(variantHex(v, main), hexNow));
    if (product) {
      // the owner's rule: catalogue products only in the colours and fabrics the store sells – no own colour
      if (ownOnProduct) nodes.push(h('p', { style: { fontSize: '0.8em', color: 'var(--kv-ink-3)', margin: '0.3em 0 0', lineHeight: 1.4 }, text: `Egen farge fra et eldre lagret design – ${product.store || 'butikken'} selger bare variantene over.` }));
      else if (!(product.variants?.length > 1)) nodes.push(h('p', { style: { fontSize: '0.8em', color: 'var(--kv-ink-3)', margin: '0.3em 0 0', lineHeight: 1.4 }, text: `Finnes bare i denne fargen hos ${product.store || 'butikken'}.` }));
      return section('Farge', ...nodes);
    }
    const pal = [...FABRIC_PALETTE];
    const picker = colorPicker(hexNow, (hex, { final }) => {
      this._patch((s) => setMain(s, hex), { drag: !final, label: 'Egen farge' });
      if (final) {
        this._endDrag();
        this._remember({ main: hex });
        this._renderList();
        if (product) this.render();
      }
    }, { palette: pal, label: main === 'slat' ? 'Lamellfarge' : 'Stoffarge' });
    nodes.push(field(main === 'slat' ? 'Egen lamellfarge' : 'Egen stoffarge', picker.el, {
      hint: ownOnProduct ? 'Egen farge – finnes kanskje ikke hos butikken' : product ? 'Andre farger finnes kanskje ikke hos butikken' : '',
    }));
    const railHex = spec.colors?.rail || '#e6e6e3';
    const rail = swatches(RAIL_COLORS, (hex) => {
      this._patch((s) => {
        s.colors = { ...(s.colors || {}), rail: hex };
        s.materials = { ...(s.materials || {}), rail: RAIL_KIND[hex] || 'painted' };
      }, { label: 'Farge på skinne' });
      this._remember({ rail: { hex, kind: RAIL_KIND[hex] || 'painted' } });
    }, { value: railHex, size: '1.6em' });
    nodes.push(field(spec.archetype === 'curtain' ? 'Skinne / stang' : 'Skinne og beslag', rail));
    return section('Farge', ...nodes);
  }

  _adjustSection(info, spec) {
    const t = TYPE[spec.archetype];
    const nodes = [];
    const isCurtain = spec.archetype === 'curtain' || spec.archetype === 'vertical';
    nodes.push(slider({
      label: isCurtain ? 'Trukket fra' : 'Trukket opp',
      min: 0,
      max: 1,
      step: 0.01,
      value: spec.open ?? 1,
      format: (v) => (v <= 0.005 ? (isCurtain ? 'Lukket' : 'Helt nede') : v >= 0.995 ? (isCurtain ? 'Helt åpen' : 'Helt oppe') : pct(v)),
      onInput: (v) => this._patch((s) => (s.open = v), { drag: true, label: 'Trekk solskjermingen' }),
      onChange: (v) => {
        this._patch((s) => (s.open = v), { drag: true });
        this._endDrag();
      },
    }).el);
    if (spec.archetype === 'venetian' || spec.archetype === 'vertical') {
      const ven = spec.archetype === 'venetian';
      const tilt = slider({
        label: 'Lamellvinkel',
        min: ven ? -80 : 0,
        max: ven ? 80 : 85,
        step: 1,
        value: spec.tilt ?? 0,
        format: (v) => `${Math.round(v)}°`,
        onInput: (v) => this._patch((s) => (s.tilt = v), { drag: true, label: 'Vri lamellene' }),
        onChange: (v) => {
          this._patch((s) => (s.tilt = v), { drag: true });
          this._endDrag();
        },
      });
      nodes.push(tilt.el);
      nodes.push(h('p.ip-win-hint', {
        text: ven
          ? '0° = vannrett (mest utsyn). Pluss: innerkanten ned – lyset slipper inn i striper. Minus: innerkanten opp – stenger den lave sola, og du ser ned mot elva.'
          : '0° = lamellene på tvers (åpent), 85° = lukket.',
      }));
    }
    if (t.band) {
      nodes.push(slider({
        label: 'Stripene',
        min: 0,
        max: 1,
        step: 0.01,
        value: spec.params?.band ?? 0,
        format: (v) => (v <= 0.02 ? 'Åpne' : v >= 0.98 ? 'Lukket' : pct(v)),
        onInput: (v) => this._patch((s) => ((s.params ||= {}).band = v), { drag: true, label: 'Juster stripene' }),
        onChange: (v) => {
          this._patch((s) => ((s.params ||= {}).band = v), { drag: true });
          this._endDrag();
        },
      }).el);
    }
    if (spec.archetype === 'pleated' && spec.params?.mode === 'topdown-bottomup') {
      nodes.push(slider({
        label: 'Toppen senket',
        min: 0,
        max: 1,
        step: 0.01,
        value: spec.params?.top ?? 0,
        format: pct,
        onInput: (v) => this._patch((s) => ((s.params ||= {}).top = v), { drag: true, label: 'Senk toppen' }),
        onChange: (v) => {
          this._patch((s) => ((s.params ||= {}).top = v), { drag: true });
          this._endDrag();
        },
      }).el);
    }
    // mount (the terrace door adds «on the door leaf» for blinds)
    const mounts = shadingMounts(spec.archetype, info);
    const mountName = (m) => (m === 'wall' && spec.archetype === 'curtain' ? 'Stang/skinne på veggen' : m === 'ceiling' && spec.archetype === 'curtain' ? 'Skinne i taket' : shadingMountLabel(m, spec.archetype, info));
    if (mounts.length > 1) {
      const curMount = spec.archetype === 'curtain' ? (spec.mount === 'wall' || spec.params?.track === 'wall' ? 'wall' : 'ceiling') : mounts.includes(spec.mount) ? spec.mount : defaultShadingMount(spec.archetype, info);
      nodes.push(select({
        label: 'Montering',
        options: mounts.map((m) => [m, mountName(m)]),
        value: curMount,
        onChange: (v) => {
          this._patch((s) => {
            s.mount = v;
            if (s.archetype === 'curtain') (s.params ||= {}).track = v;
          }, { label: 'Endre montering' });
          this.render();
        },
      }).el);
    } else {
      nodes.push(field('Montering', h('span.ip-win-static', { text: mountName(mounts[0]) || MOUNT_LABELS[t.mounts[0]] })));
    }
    const doorNote = shadingDoorNote(info, spec);
    if (doorNote) nodes.push(h('p.ip-win-hint', { text: doorNote }));
    // type-specific settings
    const schema = { ...t.params };
    if (spec.archetype === 'curtain' && Number(spec.params?.panels ?? 2) === 2) delete schema.side;
    const product = spec.productId ? getProduct(spec.productId) : null;
    const sz = productSizing(product);
    if (spec.archetype === 'curtain' && sz && !sz.custom) {
      delete schema.fullness;
      schema.pieces = { type: 'number', label: sz.pair ? 'Antall par' : 'Antall lengder', min: 1, max: 12, step: 1 };
    }
    if (Object.keys(schema).length) {
      const size = shadingSize(info, spec);
      const values = { ...(spec.params || {}) };
      for (const [k, s] of Object.entries(schema)) {
        if (values[k] == null) {
          if (k === 'pieces') values[k] = size?.pieces || 1;
          else if (k === 'fullness') values[k] = Number((size?.fullness || 2).toFixed(1));
          else if (k === 'length') values[k] = (info.sill ?? 0) > 0.55 ? 'sill' : 'floor';
          else if (s.type === 'enum') values[k] = s.options[0][0];
        }
        if (s.type === 'enum' && values[k] != null) {
          const opt = s.options.find((o) => String(o[0]) === String(values[k]));
          if (opt) values[k] = opt[0];
        }
      }
      const ed = paramEditor(schema, values, (key, value, { final }) => {
        const enumNum = schema[key]?.type === 'enum' && typeof schema[key].options[0][0] === 'number';
        const v = enumNum ? Number(value) : value;
        if (key === 'span') {
          this._setSpan(v);
          return;
        }
        this._patch((s) => {
          s.params = { ...(s.params || {}), [key]: v };
          if (key === 'fabric' && FABRICS[v]) {
            delete s.params.transmission;
            s.materials = { ...(s.materials || {}), fabric: FABRICS[v].kind };
          }
          if (key === 'material' && s.archetype === 'venetian') {
            const k = v === 'alu' ? 'painted' : 'ash';
            s.materials = { ...(s.materials || {}), slat: k };
            if (v !== 'alu' && Number(s.params.slatMm) < 35) s.params.slatMm = 50;
          }
        }, { drag: !final, label: `Endre ${schema[key]?.label?.toLowerCase() || key}` });
        if (final) {
          this._endDrag();
          if (schema[key]?.type !== 'number') this.render();
          else this._refreshInfo();
        }
      });
      nodes.push(ed.el);
    }
    return section('Justering', ...nodes);
  }

  /** Curtain width: only this window, or one curtain across the whole window wall. */
  _setSpan(span) {
    const cur = this._spec();
    if (!cur) return;
    const next = clone(cur);
    next.params = { ...(next.params || {}), span };
    const wall = this._wallWindows().map((w) => w.id);
    if (span === 'wall') {
      this._write(next, { label: 'Gardin over hele veggen', targets: wall });
      this.editor.events?.emit?.('toast', { text: `Gardinen dekker nå hele vindusveggen (${wall.length} åpninger).` });
    } else {
      const others = wall.filter((id) => id !== this.windowId && this.design.windows?.[id]?.archetype === 'curtain' && this.design.windows[id].params?.span === 'wall');
      this.design.transaction('Gardin bare på dette vinduet', () => {
        this._write(next, { targets: [this.windowId] });
        if (others.length) this._write(null, { targets: others });
      });
    }
    this.render();
  }

  // ---- price, light and acoustics

  _refreshInfo() {
    if (!this.infoEl) return;
    const spec = this._spec();
    const info = this._info();
    if (!spec || !info) {
      this.infoEl.replaceChildren();
      return;
    }
    const nodes = [];
    const product = spec.productId ? getProduct(spec.productId) : null;
    const ids = this._targets(spec);
    if (product) {
      let total = 0;
      let totalList = 0;
      let est = null;
      for (const id of ids) {
        const e = this._estimate(product, spec.variantIndex ?? product.defaultVariant ?? 0, this._spec(id) || spec, this._info(id));
        if (id === this.windowId || !est) est = e;
        total += e.total || 0;
        totalList += e.totalList || e.total || 0;
      }
      const priceEl = h('div.ip-win-price', {},
        h('span.ip-win-price__big', { text: est.total != null ? `ca. ${fmtNok(total)}` : 'Ingen pris' }),
        totalList > total + 1 ? h('s', { text: fmtNok(totalList) }) : null,
        h('span.ip-win-price__for', { text: ids.length > 1 ? `for hele veggen (${ids.length} åpninger)` : 'for dette vinduet' }),
      );
      const lines = h('ul.ip-win-lines', {}, est.lines.map((l) => h('li', { text: l })));
      const warns = est.warns.length ? h('div.ip-win-warns', {}, est.warns.map((w) => h('p.ip-win-warn', { text: w.text }))) : null;
      const url = (product.variants?.[spec.variantIndex ?? 0]?.url) || product.url;
      const link = url ? button({ label: `Åpne hos ${product.store || product.brand}`, icon: 'exit', size: 'sm', variant: 'ghost', onClick: () => window.open(url, '_blank', 'noopener') }) : null;
      const details = product.priceNote ? h('details.ip-win-details', {}, h('summary', { text: 'Om prisen' }), h('p', { text: product.priceNote })) : null;
      nodes.push(section('Pris', priceEl, lines, warns, details, link ? h('div.ip-win-linkrow', {}, link) : null));
    } else {
      nodes.push(section('Pris', h('p.ip-win-note', { text: 'Egendefinert solskjerming har ingen pris. Velg et produkt over for å se hva det koster for dette vinduet.' })));
    }
    // effect on light and sound
    const T = shadingTransmission(spec);
    let m2 = 0;
    for (const id of ids) {
      try {
        m2 += shadingAbsorption(this._layoutWin(id), this._spec(id) || spec, this.editor.layout) || 0;
      } catch {
        /* acoustics optional */
      }
    }
    // «etterklang nå» of the window's own room (§5.6): only when the acoustics speak for that room
    let rt = null;
    try {
      const room = this._info()?.roomId ?? 'stue-kjokken';
      // the living room through the editor's cache, another room through Acoustics.acousticsFor (steg 16, E3)
      const ac = room === 'stue-kjokken' ? this.editor.acoustics?.() : ACOUSTICS.acousticsFor?.(this.design, this.editor.home, room) ?? null;
      rt = ac && (ac.roomId ?? 'stue-kjokken') === room ? ac.rt60 ?? null : null;
    } catch {
      rt = null;
    }
    const uv = spec.params?.uvBlock;
    const effect = h('div.ip-win-effect', {},
      stat('Dagslys inn', `ca. ${pct(T)}`, 'med denne innstillingen'),
      stat('Lyddemping', `+${fmtNumber(m2, 1)} m²`, rt != null ? `etterklang nå ${fmtNumber(rt, 2)} s` : 'Sabine-absorpsjon'),
      uv != null ? stat('UV-filter', pct(uv), 'når den er nede') : null,
    );
    nodes.push(section('Effekt', effect));
    this.infoEl.replaceChildren(...nodes);
  }

  /**
   * Price estimate of a product for a window: ready-made pieces × price, or made to measure scaled from the reference
   * size in the catalogue (price notes say «for 220x180»).
   * @returns {{ total: number|null, totalList: number|null, onSale: boolean, lines: string[], warns: { text: string, short: string }[] }}
   */
  _estimate(product, vi, spec, info = this._info()) {
    const out = { total: null, totalList: null, onSale: false, lines: [], warns: [] };
    if (!product || !spec || !info) return out;
    const pr = priceOf(product, vi);
    const sz = productSizing(product);
    const size = shadingSize(info, spec);
    if (!size || !sz) return out;
    const unit = pr.price;
    const list = pr.listPrice;
    out.onSale = pr.onSale;
    const note = product.priceNote || '';
    const fromM = note.match(/fra-pris\s*([\d\s ]+)\s*kr/i);
    const from = fromM ? Number(fromM[1].replace(/\D/g, '')) : 0;
    const curtain = product.archetype === 'curtain';
    if (unit == null) {
      out.lines.push('Butikken oppgir ingen pris.');
      return out;
    }
    if (sz.custom) {
      let f;
      if (curtain) {
        f = (size.track / sz.w) * Math.max(1, size.drop / sz.h);
        out.lines.push(`Sydd på mål for ${cm(size.track)} cm skinne og ${cm(size.drop)} cm høyde (regnet om fra ${fmtNok(unit)} for ${cm(sz.w)} × ${cm(sz.h)} cm).`);
      } else {
        f = (size.width * size.drop) / (sz.w * sz.h);
        out.lines.push(`Måltilpasset til ${cm(size.width)} × ${cm(size.drop)} cm (regnet om fra ${fmtNok(unit)} for ${cm(sz.w)} × ${cm(sz.h)} cm).`);
      }
      let n = 1;
      if (sz.maxSize && (size.width > sz.maxSize[0] + 0.005 || size.drop > sz.maxSize[1] + 0.005)) {
        n = Math.ceil(size.width / sz.maxSize[0]);
        out.warns.push({ text: `Større enn maksmålet ${cm(sz.maxSize[0])} × ${cm(sz.maxSize[1])} cm – må deles i ${n} stk.`, short: 'Over maksmål' });
      }
      out.total = Math.max(from * n, unit * f);
      if (list != null && list > unit) out.totalList = Math.max(from * n, list * f);
    } else {
      const n = size.pieces || 1;
      out.total = unit * n;
      if (list != null && list > unit) out.totalList = list * n;
      if (curtain) {
        const what = sz.pair
          ? `${n} par (${n * 2} lengder à ${cm(sz.w / 2)} × ${cm(sz.h)} cm)`
          : `${n} ${n === 1 ? 'lengde' : 'lengder'} à ${cm(sz.w)} × ${cm(sz.h)} cm`;
        out.lines.push(`${what} gir ${fmtNumber(size.fullness, 1)} × fylde på ${cm(size.track)} cm skinne.`);
        if (size.fullness < 1.4) out.warns.push({ text: 'Lite fylde: gardinen blir nesten flat når den er trukket for. Vurder flere lengder.', short: 'Lite fylde' });
        if (size.drop < size.needDrop - 0.01) out.warns.push({ text: `${cm(size.needDrop - size.drop)} cm for kort – når ikke ned (trenger ${cm(size.needDrop)} cm).`, short: 'For kort' });
        else if (sz.h > size.needDrop + 0.03) out.lines.push(`Legges opp til ca. ${cm(size.needDrop)} cm.`);
      } else {
        out.lines.push(n > 1
          ? `Ferdigmål ${cm(sz.w)} × ${cm(sz.h)} cm: ${n} stk. side om side (hver ca. ${cm(size.pieceWidth)} cm).`
          : `Ferdigmål ${cm(sz.w)} × ${cm(sz.h)} cm.`);
        if (size.short > 0.005) out.warns.push({ text: `${cm(size.short)} cm for kort – vinduet trenger ${cm(size.drop)} cm.`, short: 'For kort' });
        if (!sz.cuttable && size.mount === 'recess' && n === 1 && sz.w > size.width + 0.005) out.warns.push({ text: `${cm(sz.w)} cm er bredere enn lysningen (${cm(size.width)} cm). Velg en smalere størrelse.`, short: 'For bred' });
        if (n > 1 && !sz.cuttable) out.lines.push('Kan ikke kappes: velg bredder som til sammen passer.');
      }
    }
    const ship = note.match(/(?:fast frakt|frakt)\s*([\d\s ]+)\s*kr/i);
    if (ship) out.lines.push(`Frakt ca. ${fmtNok(Number(ship[1].replace(/\D/g, '')))} kommer i tillegg.`);
    if (/montering og elektriker/i.test(note)) out.lines.push('Montering og elektriker kommer i tillegg.');
    out.lines.push(`Mål: ${cm(size.width)} × ${cm(size.drop)} cm, ${shadingMountLabel(size.mount, spec.archetype, info).toLowerCase()}. Mål ${info.type === 'terrace-door' ? 'døra' : 'vinduet'} før du bestiller.`);
    return out;
  }

  // ---- whole wall / remove

  _applyToWall() {
    const spec = this._spec();
    if (!spec) return;
    const wall = this._wallWindows();
    if (wall.length < 2) return;
    const ids = wall.map((w) => w.id);
    const mem = this._colors.get(this.windowId);
    if (mem) for (const id of ids) this._colors.set(id, { ...mem });
    this._write(spec, { label: 'Solskjerming på hele veggen', targets: ids });
    this.editor.events?.emit?.('toast', { text: `Brukt på ${ids.length} vinduer i veggen.` });
    this.render();
  }

  _remove() {
    const spec = this._spec();
    if (!spec) return;
    const ids = this._targets(spec);
    this._write(null, { label: 'Fjern solskjerming', targets: ids });
    this.render();
  }
}

function stat(label, value, sub) {
  return h('div.ip-win-stat', {}, h('span.ip-win-stat__label', { text: label }), h('span.ip-win-stat__value', { text: value }), sub ? h('span.ip-win-stat__sub', { text: sub }) : null);
}

let _styled = false;
/** Panel-specific styles (built on the ui.css variables; panels.css belongs to another module). */
function injectStyles() {
  if (_styled || typeof document === 'undefined') return;
  _styled = true;
  const css = `
.ip-win .ip-panel__body { padding-top: 0.75em; }
.ip-win-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.3em; }
.ip-win-group { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 0.5em; margin: 0.45em 0 0.05em; font-size: 0.82em; font-weight: 700; color: var(--kv-ink-2); }
.ip-win-group:first-child { margin-top: 0; }
.ip-win-group__level { font-weight: 500; color: var(--kv-ink-3); }
.ip-win-row { display: flex; align-items: center; gap: 0.5em; width: 100%; min-width: 0; padding: 0.38em 0.5em; text-align: left;
  border: 1px solid var(--kv-line); border-radius: var(--kv-r-sm); background: var(--kv-surface); color: var(--kv-ink);
  font: inherit; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.ip-win-row:hover, .ip-win-row:focus-visible { background: var(--kv-surface-2); border-color: var(--kv-line-2); outline: none; }
.ip-win-row.is-active { border-color: var(--kv-accent); background: var(--kv-accent-soft); }
.ip-win-row { align-items: flex-start; }
.ip-win-row__radio { flex: none; width: 0.95em; height: 0.95em; margin-top: 0.12em; border-radius: 50%; box-sizing: border-box;
  border: 1.5px solid var(--kv-ink-4, rgba(255,255,255,0.4)); background: transparent; transition: border-color 0.15s, background 0.15s; }
.ip-win-row.is-active .ip-win-row__radio { border-color: var(--kv-accent);
  background: radial-gradient(circle, var(--kv-accent) 0 42%, transparent 47%); }
.ip-win-row__main { display: flex; flex-direction: column; min-width: 0; gap: 0.08em; }
.ip-win-row__name { font-size: 0.84em; font-weight: 650; line-height: 1.2; overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ip-win-row__sub { font-size: 0.76em; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ip-win-row__badge { display: inline-flex; align-items: center; gap: 0.35em; align-self: flex-start; max-width: 100%; margin-top: 0.12em;
  padding: 0.08em 0.5em 0.08em 0.3em; border-radius: 1em; background: var(--kv-surface-2); border: 1px solid var(--kv-line-2);
  font-size: 0.72em; font-weight: 650; color: var(--kv-ink-2); }
.ip-win-row__swatch { flex: none; width: 0.85em; height: 0.85em; border-radius: 50%; border: 1px solid rgba(255,255,255,0.4); }
.ip-win-row__badgetext { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ip-win-row__none { margin-top: 0.12em; font-size: 0.72em; color: var(--kv-ink-4); }
.ip-win-showrow { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3em 0.6em; margin-top: 0.45em; }
.ip-win-showhint { font-size: 0.76em; color: var(--kv-ink-3); }
.ip-win-blink { position: absolute; inset: 0; z-index: 6; pointer-events: none; background: #0d0f12; opacity: 0;
  transition: opacity 0.16s ease; }
.ip-win-blink.is-on { opacity: 1; transition: opacity 0.15s ease; }
.ip-win-chips { display: flex; flex-wrap: wrap; gap: 0.35em; }
.ip-win-chip { padding: 0.38em 0.7em; border-radius: 2em; border: 1px solid var(--kv-line-2); background: var(--kv-surface);
  color: var(--kv-ink-2); font: inherit; font-size: 0.84em; font-weight: 600; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.ip-win-chip:hover { background: var(--kv-surface-2); color: var(--kv-ink); }
.ip-win-chip.is-active { background: var(--kv-accent); border-color: transparent; color: var(--kv-accent-ink); }
.ip-win-cards { display: flex; flex-direction: column; gap: 0.45em; }
.ip-win-cards .ip-card__img { width: 4.6em; height: 4.6em; background-color: #e9e7e2; }
.ip-win-note { margin: 0.2em 0 0; font-size: 0.86em; line-height: 1.45; color: var(--kv-ink-3); }
.ip-win-hint { margin: -0.1em 0 0.4em; font-size: 0.76em; line-height: 1.4; color: var(--kv-ink-4); }
.ip-win-static { font-size: 0.88em; color: var(--kv-ink-2); }
.ip-win-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2em 0.6em; margin-bottom: 0.45em; }
.ip-win-price__big { font-size: 1.45em; font-weight: 780; color: var(--kv-accent-2); font-variant-numeric: tabular-nums; }
.ip-win-price s { color: var(--kv-ink-4); font-size: 0.9em; }
.ip-win-price__for { flex-basis: 100%; font-size: 0.78em; color: var(--kv-ink-3); }
.ip-win-lines { margin: 0 0 0.5em; padding-left: 1.1em; font-size: 0.8em; line-height: 1.45; color: var(--kv-ink-2); }
.ip-win-lines li { margin: 0.12em 0; }
.ip-win-warns { margin: 0 0 0.5em; }
.ip-win-warn { margin: 0.2em 0; padding: 0.4em 0.6em; border-radius: var(--kv-r-sm); background: rgba(255, 200, 80, 0.12);
  color: #ffd98a; font-size: 0.8em; line-height: 1.4; }
.ip-win-details { margin: 0 0 0.5em; font-size: 0.78em; color: var(--kv-ink-3); }
.ip-win-details summary { cursor: pointer; color: var(--kv-ink-2); }
.ip-win-details p { margin: 0.35em 0 0; line-height: 1.45; }
.ip-win-linkrow { display: flex; justify-content: flex-start; }
.ip-win-effect { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.2em, 1fr)); gap: 0.45em; }
.ip-win-stat { display: flex; flex-direction: column; gap: 0.1em; padding: 0.5em 0.6em; border-radius: var(--kv-r-sm);
  background: var(--kv-surface); border: 1px solid var(--kv-line); }
.ip-win-stat__label { font-size: 0.72em; color: var(--kv-ink-3); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
.ip-win-stat__value { font-size: 1.05em; font-weight: 750; font-variant-numeric: tabular-nums; }
.ip-win-stat__sub { font-size: 0.72em; color: var(--kv-ink-4); }
.ip-win .ip-panel__foot { flex-wrap: wrap; }
.ip-win .ip-panel__foot .kv-btn { flex: 1 1 auto; justify-content: center; white-space: nowrap; }
`;
  document.head.append(h('style', { id: 'ip-win-style', text: css }));
}

export default WindowPanel;
