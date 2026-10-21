import * as THREE from 'three';
import * as catalog from '../catalog/index.js';
import { computeAcoustics } from './Acoustics.js';
import { Selection } from './Selection.js';
import { Placement } from './Placement.js';
import { ViewModes } from './ViewModes.js';
import { MAIN_LEVEL, levelAtFloorY } from './SceneSync.js';
import { Toolbar } from '../ui/Toolbar.js';
import { CatalogPanel } from '../ui/CatalogPanel.js';
import { Inspector } from '../ui/Inspector.js';
import { SavePanel } from '../ui/SavePanel.js';
import { ShoppingPanel } from '../ui/ShoppingPanel.js';
import { AcousticsWidget } from '../ui/AcousticsWidget.js';
import { WallPanel } from '../ui/WallPanel.js';
import { PhotoCompare } from '../ui/PhotoCompare.js';
import { WindowPanel } from '../ui/WindowPanel.js';
import { LightPanel } from '../ui/LightPanel.js';
import { setPanelHost, closeTopPanel, anyModalOpen, isFormFocused } from '../ui/panelKit.js';
import { isTyping } from '../ui/dom.js';

/**
 * The editor hub (ARCHITECTURE §14): owns the tools (Selection, Placement, ViewModes) and every panel, routes clicks
 * and Esc, and tells Game whether the player may move. Game.js creates it after the home is built.
 *
 *   new Editor(game, home)
 *   game, home, design, sync, saves, layout, events (= game.events), input, camera, renderer, scene, hud, uiRoot, catalog
 *   acoustics() → computeAcoustics(design, home) (cached until the next design change)
 *   selection, placement, views
 *   level → levelId               the level the editor works on: the overview's / plan's (views.level), else the
 *                                 player's (playerLevel()); new items are placed on it (item.level, §5.3)
 *   ?view=plan&floor=kjeller      opens the plan (or the overview) of that level (§5.2)
 *   ui: { toolbar, catalog, inspector, wall, window, light, saves, shopping, acoustics, photo }
 *   selected: { kind: 'item'|'wall'|'window'|null, uid?, wallId?, windowId? }
 *   select(target|null)          sets selected, emits 'select' { selected, previous }, opens the matching panel
 *   startPlacing(itemSpec, opts) → placement.start
 *   handleClick(ndc) → bool      canvas click (Game routes Input clicks here first; ViewModes outside walk mode)
 *   handleEscape() → bool        Esc: cancel placement → close the top panel → deselect → back to walk mode
 *   raycast(ndc, { items, walls, windows, floor, ceilings }) → Hit|null   shared picking for the tools
 *   pointerNDC(target) → Vector2|null   cursor in NDC (any view mode)
 *   keysActive() → bool          shortcuts may run (no text field focused, not paused, no modal)
 *   blocksGameInput() → bool     a form field has focus or a modal panel/dialog is open
 *   update(dt), dispose()
 *
 * Hit = { kind: 'item'|'wall'|'window'|'floor'|'ceiling', uid?, wallId?, windowId?, ceilingId?, object, point: Vector3,
 *         normal: Vector3 (world, facing the camera), distance }
 *
 * Every tool/panel is constructed in a try/catch: one broken module logs an error and is replaced by an inert
 * placeholder, the rest of the editor keeps working.
 */

const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _n = new THREE.Vector3();

/** Inert stand-in for a panel/tool whose module failed to construct. */
function inert(name) {
  return { name, isOpen: false, isActive: false, isWalking: true, mode: 'walk', open() {}, close() {}, toggle() {}, update() {}, dispose() {}, set() {}, start() {}, cancel() {}, handleClick: () => false };
}

export class Editor {
  /**
   * @param {import('../core/Game.js').Game} game
   * @param {object} home  createHome result (design, sync, saves, layout, walls, windows, highWall, pickables …)
   */
  constructor(game, home) {
    this.game = game;
    this.home = home;
    this.design = home.design;
    this.sync = home.sync;
    this.saves = home.saves ?? null;
    this.layout = home.layout;
    this.events = game.events;
    this.input = game.input;
    this.camera = game.camera;
    this.renderer = game.renderer;
    this.scene = game.scene;
    this.hud = game.hud;
    this.uiRoot = game.uiRoot;
    this.catalog = catalog;
    this.selected = { kind: null };
    this._acoustics = null;
    this._disposers = [];

    // a panel opening hides the start-up help card (it would show through the panel)
    setPanelHost({ root: this.uiRoot, blockInput: (reason) => game.blockInput(reason), audio: game.audio, onOpen: () => game.hud?.showHelp?.(false) });
    this._disposers.push(this.design.on('change', () => (this._acoustics = null)));
    this._disposers.push(this.design.on('item:remove', ({ uid }) => {
      if (this.selected.kind === 'item' && this.selected.uid === uid) this.select(null);
    }));
    this._disposers.push(this.design.on('load', () => this.select(null)));

    const make = (name, Ctor) => {
      try {
        return new Ctor(this);
      } catch (err) {
        console.error(`[editor] ${name} failed to start`, err);
        return inert(name);
      }
    };
    this.views = make('views', ViewModes);
    this.selection = make('selection', Selection);
    this.placement = make('placement', Placement);
    this.ui = {
      toolbar: make('toolbar', Toolbar),
      catalog: make('catalog', CatalogPanel),
      inspector: make('inspector', Inspector),
      wall: make('wall', WallPanel),
      window: make('window', WindowPanel),
      light: make('light', LightPanel),
      saves: make('saves', SavePanel),
      shopping: make('shopping', ShoppingPanel),
      acoustics: make('acoustics', AcousticsWidget),
      photo: make('photo', PhotoCompare),
    };

    // Esc while Input is disabled (another view mode, a non-modal block): Game cannot see it, so handle it here.
    this._onKey = (e) => {
      if (e.key !== 'Escape' || e.repeat || this.game.paused || this.input.enabled) return;
      if (isFormFocused()) return;
      if (this.handleEscape()) e.preventDefault();
    };
    window.addEventListener('keydown', this._onKey);

    // ?view=orbit|plan, &floor=<level id> (hoved, kjeller – §5.2): that level instead of the player's
    const view = game.dev?.params?.get?.('view');
    const floor = levelParam(game.dev?.params?.get?.('floor'), this.layout);
    if (floor) this.views.setLevel?.(floor, { instant: true });
    if (view && view !== 'walk') this.views.set(view, floor ? { level: floor } : undefined);
  }

  /**
   * The level the editor works on (notes/hele-huset-design.md §5.3): the overview's / plan's level, else the
   * player's (walking, the photo camera's from its height).
   * @returns {string} layout.house.levels id
   */
  get level() {
    const v = this.views;
    if (v && (v.mode === 'orbit' || v.mode === 'plan') && v.level) return v.level;
    if (v?.mode === 'photo') {
      const cam = this.activeCamera;
      cam?.updateMatrixWorld?.();
      return levelAtFloorY(this.layout, (cam?.getWorldPosition?.(new THREE.Vector3()).y ?? 1.6) - 1.6);
    }
    return this.playerLevel();
  }

  /** The player's level: Game's (with the stair's hysteresis), else from the feet. */
  playerLevel() {
    const g = this.game;
    const known = this.layout?.house?.levelsById;
    if (g?._levelId && (!known || known[g._levelId])) return g._levelId;
    const p = g?.player?.position;
    return p ? levelAtFloorY(this.layout, p.y) : MAIN_LEVEL;
  }

  /** Reverberation result for the current design (cached until the next change). */
  acoustics() {
    if (!this._acoustics) this._acoustics = computeAcoustics(this.design, this.home);
    return this._acoustics;
  }

  /**
   * Selects an item/wall/window (or nothing) and opens the matching panel: item → inspector, the high wall → wall
   * panel, another wall → inspector (paint), window → window panel. null closes the inspector.
   * @param {{ kind: 'item'|'wall'|'window', uid?: string, wallId?: string, windowId?: string }|null} target
   */
  select(target) {
    const previous = this.selected;
    const next = target && target.kind ? { ...target } : { kind: null };
    const same = previous.kind === next.kind && previous.uid === next.uid && previous.wallId === next.wallId && previous.windowId === next.windowId;
    this.selected = next;
    if (!same) this.events.emit('select', { selected: next, previous });
    try {
      if (next.kind === 'item') this.ui.inspector.open(next);
      else if (next.kind === 'wall' && next.wallId === this.home.highWall?.wallId) this.ui.wall.open(next);
      else if (next.kind === 'wall') this.ui.inspector.open(next);
      else if (next.kind === 'window') this.ui.window.open(next.windowId);
      else if (previous.kind === 'item' || previous.kind === 'wall') this.ui.inspector.close();
    } catch (err) {
      console.error('[editor] panel failed to open', err);
    }
  }

  /** Starts placing a new item (CatalogPanel «Plasser»). */
  startPlacing(itemSpec, opts) {
    return this.placement.start(itemSpec, opts);
  }

  /**
   * A click on the canvas in NDC. Placement gets it while active, else Selection decides.
   * @returns {boolean} true when used (Game then skips the InteractionSystem)
   */
  handleClick(ndc) {
    try {
      if (this.placement.isActive) return this.placement.handleClick?.(ndc) ?? true;
      return !!this.selection.handleClick?.(ndc);
    } catch (err) {
      console.error('[editor] click failed', err);
      return false;
    }
  }

  /** Esc: cancel placement → close the top panel → deselect → back to walking. @returns {boolean} consumed */
  handleEscape() {
    if (this.placement.isActive) {
      this.placement.cancel();
      return true;
    }
    if (closeTopPanel()) {
      if (this.selected.kind && !this.ui.inspector.isOpen && !this.ui.wall.isOpen && !this.ui.window.isOpen) this.select(null);
      return true;
    }
    if (this.selected.kind) {
      this.select(null);
      return true;
    }
    if (!this.views.isWalking) {
      this.views.set('walk');
      return true;
    }
    return false;
  }

  /** The camera in use (ViewModes may switch to another one). */
  get activeCamera() {
    return this.views?.camera ?? this.camera;
  }

  /** Cursor position in NDC (walk mode: from Input; other modes: from ViewModes). */
  pointerNDC(target = new THREE.Vector2()) {
    if (this.views?.isWalking === false && this.views.pointerNDC) return this.views.pointerNDC(target);
    return this.input.getPointerNDC(target);
  }

  /**
   * Picks the nearest item / wall / window / floor / ceiling under a point in NDC.
   * @param {{ x: number, y: number }} ndc
   * @param {{ items?: boolean, walls?: boolean, windows?: boolean, floor?: boolean, ceilings?: boolean, exclude?: THREE.Object3D[] }} [what]
   * @returns {object|null} Hit (see the class comment)
   */
  raycast(ndc, what = { items: true, walls: true, windows: true }) {
    if (!ndc) return null;
    const targets = [];
    if (what.items) for (const o of this.sync.objects()) if (o.visible) targets.push(o);
    const p = this.home.pickables || {};
    if (what.walls) targets.push(...(p.walls || []));
    if (what.windows) targets.push(...(p.windows || []));
    if (what.floor) targets.push(...(p.floor || []));
    if (what.ceilings) targets.push(...(p.ceilings || []));
    // orbit/plan draw cut copies of the shell instead of the (invisible) originals
    if (what.walls || what.windows) targets.push(...(this.views?.pickRoots?.() || []));
    if (!targets.length) return null;
    const cam = this.activeCamera;
    _ray.setFromCamera(_v2.set(ndc.x, ndc.y), cam);
    _ray.far = 100;
    const hits = _ray.intersectObjects(targets, true);
    for (const h of hits) {
      if (!visibleChain(h.object) || this.views?.isConcealed?.(h.object) || what.exclude?.some((x) => isDescendant(h.object, x))) continue;
      const pick = pickOf(h.object);
      if (!pick) continue;
      const normal = h.face ? _n.copy(h.face.normal).transformDirection(h.object.matrixWorld).clone() : new THREE.Vector3(0, 1, 0);
      if (normal.dot(_ray.ray.direction) > 0) normal.negate();
      return { ...pick, object: h.object, point: h.point.clone(), normal, distance: h.distance };
    }
    return null;
  }

  /** Shortcuts may run: no text field focused, game running and not paused, no modal panel/dialog. */
  keysActive() {
    return !isTyping() && !isFormFocused() && this.game.running !== false && !this.game.paused && !anyModalOpen();
  }

  /** True while the player must not move/look: a form field has focus or a modal panel is open. */
  blocksGameInput() {
    return isFormFocused() || anyModalOpen();
  }

  /** Every frame (Game). */
  update(dt) {
    const step = (name, o) => {
      try {
        o?.update?.(dt);
      } catch (err) {
        if (!this._failed?.has(name)) {
          (this._failed ||= new Set()).add(name);
          console.error(`[editor] ${name}.update failed`, err);
        }
      }
    };
    step('views', this.views);
    step('selection', this.selection);
    step('placement', this.placement);
    for (const [k, p] of Object.entries(this.ui)) step(k, p);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    for (const d of this._disposers) d?.();
    this._disposers = [];
    for (const o of [this.placement, this.selection, ...Object.values(this.ui), this.views]) {
      try {
        o?.dispose?.();
      } catch (err) {
        console.warn('[editor] dispose failed', err);
      }
    }
  }
}

function pickOf(object) {
  for (let o = object; o; o = o.parent) if (o.userData?.pick) return o.userData.pick;
  return null;
}

/** ?floor= → a level id: the id itself, its name («kjeller», «1. etasje»), or 1 / 0 / -1 style numbers. */
function levelParam(v, layout) {
  if (!v) return null;
  const levels = layout?.house?.levels || [];
  const s = String(v).trim().toLowerCase();
  const hit = levels.find((l) => l.id.toLowerCase() === s || String(l.name || '').toLowerCase() === s);
  if (hit) return hit.id;
  if (/^(1|hoved|1etg|1\.etg|main)$/.test(s)) return levels.find((l) => l.id === MAIN_LEVEL)?.id ?? null;
  if (/^(0|-1|u|kjeller|underetasje|basement)$/.test(s)) return levels[levels.length - 1]?.id ?? null;
  return null;
}

function visibleChain(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function isDescendant(object, root) {
  for (let o = object; o; o = o.parent) if (o === root) return true;
  return false;
}

export default Editor;
