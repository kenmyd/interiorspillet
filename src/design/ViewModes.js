// ViewModes – gå / oversikt (dukkehus) / plan / fotovinkel (ARCHITECTURE §11, §14). Owned by INTERACT.
//
//   new ViewModes(editor)
//   mode: 'walk'|'orbit'|'plan'|'photo' · isWalking (false while flying between views) · camera (render camera)
//   set(mode, { instant }) · toggle() (walk → orbit → plan → walk) · setPhotoCamera(photoCamera, { instant })
//   exitPhoto() (back to the view before the photo) · update(dt) · dispose()
//   pointerNDC(target) / pointerClient   cursor outside walk mode
//   isConcealed(mesh) → bool             hidden by the view (dollhouse walls, ceilings) – pickers skip these
//   hiddenWalls: Set<wallId>             walls cut away by the dollhouse right now
//
// 'walk'  = PlayerController with the game camera (its pose is kept while away, so coming back lands where you left).
// 'orbit' = dollhouse: OrbitControls around the open space (right drag turns, Shift+right / middle drag pans, wheel
//           zooms toward the cursor, left drag on empty floor turns too), the ceilings and every wall between the
//           camera and the room are cut away – a low stub with a dark cap shows where they stand; wall tops get a dark
//           cap; the tall photo backdrop outside is hidden.
// 'plan'  = orthographic view from above, north up / east right (= plantegningen turned a quarter), ceilings hidden,
//           dark wall sections with window and door marks, room names with areas and a scale bar; right / middle drag
//           (or left drag on empty floor) pans, the wheel zooms toward the cursor.
// 'photo' = a fixed camera from layout.photoCameras (PhotoCompare); Esc goes back to walking.
// Every change flies smoothly (≈0.9 s). Outside 'walk' the game input is blocked (game.blockInput('view')) and this
// module turns canvas clicks into editor.handleClick(ndc) and presses into editor.selection.pointerDown(event).
// Hidden walls / ceilings keep casting shadows (their materials are swapped for an invisible one), so the light in
// the room does not change when you look at it from outside.
// The overview and the plan frame the room in the part of the screen the HUD leaves free (between the top and the
// key bar above the toolbar, beside open side panels): opening the catalogue or the inspector slides the view over
// (a view offset in the overview, a shifted camera in the plan) and the selected item is panned into view.
//
// The whole house (notes/hele-huset-design.md §5.2, steg 15 E2 + 28 E4): the overview and the plan show ONE level
// (`level`, a layout.house.levels id) – every room of it: the living room's shell and the rooms' surfaces
// (home.roots.rooms[id].surfaces) are cut the same way, a backOf face goes with the slab it is the back of, the plan
// labels every room (the living room by its zones, as before) and draws each door swing once (on its owner wall).
//   level · levels [{ id, name }] · levelName
//   setLevel(id, { instant }) · stepLevel(+1 up | −1 down)   PageUp / PageDown and the toolbar's «Etasje» button
//   set(mode, { level })      opening the overview / plan from walking shows the player's level (editor.playerLevel)
// The levels above the shown one, the upper parts of the outside (deck, railings) and their furniture, shading and
// wall designs are hidden (invisible shadow casters, so the light does not change); the stair is cut at the
// shown level's ceiling. The plan camera stands over the level's highest ceiling and looks at its floor. Emits
// 'view-level' { level } on editor.events when the level changes.
// The overview's framing is refitted while the HUD settles (toolbar, key bar) until the user moves the view, so
// the same URL always gives the same picture.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { paint } from '../home/materials.js';
import { anyModalOpen, openPanels } from '../ui/panelKit.js';
import { h } from '../ui/dom.js';
import { hintUI, ndcFromClient, cachedRect } from './Selection.js';
import { MAIN_LEVEL, itemLevel } from './SceneSync.js';
import { overUi } from '../core/Input.js';

const MODES = ['walk', 'orbit', 'plan', 'photo'];
const ORDER = ['walk', 'orbit', 'plan'];
const DEG = Math.PI / 180;
const DUR = 0.9;
const ORBIT_FOV = 45;
const PLAN_FOV = 18; // perspective stand-in for the orthographic plan while flying
const PLAN_UP = new THREE.Vector3(-1, 0, 0); // north (−x) up, east (−z) right
const STUB_H = 0.24;
const CAP_LIFT = 0.006;
const CLICK_PX = 5;
/** The plan camera of the top level stands this high over its floor (as before the house: y 6). */
const PLAN_CAM_TOP = 6;
/** How long (s of frames) the overview keeps refitting while the HUD settles, at most. */
const REFIT_SECONDS = 3;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();
const _dummy = new THREE.PerspectiveCamera();

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function lookQuat(eye, target, up = THREE.Object3D.DEFAULT_UP) {
  _dummy.position.copy(eye);
  _dummy.up.copy(up);
  _dummy.lookAt(target);
  return _dummy.quaternion.clone();
}

export class ViewModes {
  /** @param {import('./Editor.js').Editor} editor */
  constructor(editor) {
    this.editor = editor;
    this.mode = 'walk';
    this.hiddenWalls = new Set();
    this.hint = hintUI(editor);
    const canvas = editor.renderer.domElement;
    this.canvas = canvas;
    const aspect = this._aspect();
    this.persp = new THREE.PerspectiveCamera(ORBIT_FOV, aspect, 0.05, 300);
    this.persp.name = 'view-orbit';
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
    this.ortho.name = 'view-plan';
    this.ortho.up.copy(PLAN_UP);
    this._tween = null;
    this._release = null;
    this._photoPose = null;
    this._photoReturn = 'walk';
    this._orbitSaved = null;
    this._concealed = new Map(); // mesh → its own material(s)
    this._concealMats = new Map();
    this._ceilingsHidden = false;
    this._exteriorHidden = false;
    this._wallsState = new Map(); // wallId → hidden
    this._press = null;
    this._pan = null;
    this._pointer = { x: 0, y: 0, inside: false, known: false };
    this._ndc = new THREE.Vector2();
    this._toasted = new Set();
    this._off = { x: 0, y: 0 }; // where the free area's centre is, relative to the canvas centre (px, smoothed)
    this._offTarget = { x: 0, y: 0 };
    this._panelSig = '';
    this._ensureAt = 0; // keep the selection in view (time from which to check, 0 = off)
    this._panAnim = null;
    this._hudKey = '';
    this._cuts = new Map(); // levelId → cut model (see _prepareCut)
    this._cutLevel = null;
    this._overlays = new Map(); // levelId → overlay group
    this._overlayParts = new Map(); // wallId → { cap, stub, side } (every level)
    this._overlayGeos = [];
    this._upper = null; // { level, meshes: Set } what the levels above the shown one hid
    this._upperDirty = false;
    this._overviewOn = false;
    this._fresh = null; // the overview's framing while the user has not moved it: { dir, el, sig, t }

    this.level = MAIN_LEVEL;
    this._plan = { cx: 0, cz: 0, zoom: 1, H0: 4 };
    this._applyLevel(MAIN_LEVEL);
    this._fitPlan();
    this._resetPlanCenter();

    // pointer handling outside walk mode (our listener runs before OrbitControls')
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onLeave = () => (this._pointer.inside = false);
    this._onWheel = (e) => this._wheel(e);
    this._onResize = () => this._resize();
    canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointerleave', this._onLeave);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('resize', this._onResize);

    const oc = new OrbitControls(this.persp, canvas);
    oc.enabled = false;
    oc.enableDamping = true;
    oc.dampingFactor = 0.12;
    oc.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    oc.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    oc.minDistance = 2.2;
    oc.maxDistance = 24;
    oc.minPolarAngle = 4 * DEG;
    oc.maxPolarAngle = 80 * DEG;
    oc.screenSpacePanning = false;
    oc.zoomToCursor = true;
    oc.rotateSpeed = 0.7;
    oc.zoomSpeed = 1.1;
    oc.panSpeed = 0.9;
    this.controls = oc;

    this._offPaint = editor.design.on('paint', ({ wallId }) => this._repaintStub(wallId));
    this._offLoad = editor.design.on('load', () => {
      for (const id of this._wallsState.keys()) this._repaintStub(id);
    });
    // a newly selected item that a panel covers is panned into view (overview / plan)
    this._offSelect = editor.events?.on?.('select', ({ selected }) => {
      if (selected?.kind === 'item') this._ensureAt = performance.now() + 280;
    });
    // furniture of a hidden level that is built or moved again must stay hidden
    const dirty = () => (this._upperDirty = true);
    this._offSync = [editor.sync?.on?.('built', dirty), editor.sync?.on?.('moved', dirty)];
  }

  // ---- levels ------------------------------------------------------------------------------------------------

  /** The levels of the house, top → bottom: [{ id, name }]. */
  get levels() {
    const list = this.editor.layout?.house?.levels;
    return list?.length ? list.map((l) => ({ id: l.id, name: l.name ?? l.id })) : [{ id: MAIN_LEVEL, name: '1. etasje' }];
  }

  /** Name of the shown level («1. etasje», «Kjeller»). */
  get levelName() {
    return this._levelData().name;
  }

  /**
   * Plan data of a level (cached): { id, name, index, floorY, top (highest ceiling, world y), bounds, rooms (the
   * physical rooms), hudRooms, centroid }. The main level keeps the numbers of before: the living room's floor
   * centroid as the overview's pivot, its bounds (= layout.bounds).
   */
  _levelData(id = this.level) {
    this._lvCache ||= new Map();
    let d = this._lvCache.get(id);
    if (d) return d;
    const layout = this.editor.layout;
    const hs = layout?.house;
    const list = hs?.levels?.length ? hs.levels : [{ id: MAIN_LEVEL, name: '1. etasje', floorY: 0 }];
    const index = Math.max(0, list.findIndex((l) => l.id === id));
    const lv = list[index];
    const rooms = (hs?.rooms || []).filter((r) => r.levelId === lv.id && !r.hud && r.polygon?.length >= 3);
    // hud rooms of a level above that reach down into this one (the stair: its meshes are in the hall's level)
    const hudRooms = (hs?.rooms || []).filter((r) => r.hud && r.levelId !== lv.id && r.yRange && r.yRange[0] < (lv.floorY ?? 0) + 2.2 && r.yRange[1] > (lv.floorY ?? 0));
    const main = lv.id === MAIN_LEVEL;
    const lb = hs?.levelBounds?.(lv.id);
    const b = main || !lb ? layout.bounds : lb;
    const floorY = Number.isFinite(lv.floorY) ? lv.floorY : 0;
    const top = rooms.length ? Math.max(...rooms.map((r) => (Number.isFinite(r.ceilingTop) ? r.ceilingTop : floorY + 2.4))) : floorY + 2.4;
    const c = main && layout.floor?.centroid ? layout.floor.centroid : { x: (b.minX + b.maxX) / 2, y: (b.minZ + b.maxZ) / 2 };
    d = {
      id: lv.id,
      name: lv.name ?? lv.id,
      index,
      main,
      floorY,
      top,
      bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
      rooms,
      hudRooms,
      centroid: { x: c.x, y: c.y },
    };
    this._lvCache.set(id, d);
    return d;
  }

  /** Makes `id` the shown level's geometry (bounds, pivot, plan centre) – no rebuild of the cut. */
  _applyLevel(id) {
    const d = this._levelData(id);
    this.level = d.id;
    this._focus = new THREE.Vector3(d.centroid.x, d.floorY + 0.55, d.centroid.y);
    this._bounds = { ...d.bounds };
    this._orbitSaved = null;
    this._resetPlanCenter();
    this._fitPlan();
  }

  /**
   * Shows another level in the overview / plan (in walking only remembered for the next overview).
   * @param {string} id  layout.house.levels id
   * @param {{ instant?: boolean }} [opts]
   */
  setLevel(id, opts = {}) {
    const known = this.levels.some((l) => l.id === id);
    if (!known || id === this.level) return;
    const over = this.mode === 'orbit' || this.mode === 'plan';
    if (!over) {
      this._applyLevel(id);
      this._pinnedLevel = id;
      this.editor.events?.emit?.('view-level', { level: this.level });
      return;
    }
    // a selected piece of furniture on another level would be hidden (its gizmo floating over this one)
    const sel = this.editor.selected;
    if (sel?.kind === 'item') {
      const it = this.editor.design?.get?.(sel.uid);
      if (it && itemLevel(it, this.editor.layout) !== id) this.editor.select(null);
    }
    // the old level's cut, overlay and hidden upper levels go; update() builds the new level's
    const dir = this.mode === 'orbit' ? this._orbitDir() : null;
    this._setDollhouse(false);
    this._setCut(false);
    this._setOverlay(false, false);
    this._setUpper(false);
    this._setExterior(false);
    this._applyLevel(id);
    this._setExterior(true);
    this._hudKey = '';
    if (this._planHud) this._planHud.built = null;
    if (this.mode === 'plan') {
      this._fitPlan();
      this._updateOrtho();
    } else {
      const fit = this._fitOrbit(this._focus.clone(), dir, 52 * DEG);
      const to = { pos: fit.pos, quat: lookQuat(fit.pos, fit.target), fov: ORBIT_FOV, target: fit.target };
      this._fresh = { dir: dir.clone(), el: 52 * DEG, sig: this._fitSig(), t: 0 };
      if (opts.instant || !this.editor.game?.running) {
        this._applyPose(this.persp, to);
        this._arrive('orbit', to);
      } else {
        this.controls.enabled = false;
        this._tween = { t: 0, dur: DUR * 0.8, from: this._currentPose(), to, fromMode: 'orbit', toMode: 'orbit' };
      }
    }
    this.editor.events?.emit?.('view-level', { level: this.level });
    this.editor.events?.emit?.('toast', { text: `Viser ${this.levelName.toLowerCase()} – PgUp / PgDn bytter etasje`, seconds: 2.2 });
  }

  /** One level up (+1) or down (−1); false when there is none. */
  stepLevel(dir) {
    const list = this.levels;
    const i = list.findIndex((l) => l.id === this.level);
    const j = i - Math.sign(dir || 0); // the list is top → bottom
    if (i < 0 || j < 0 || j >= list.length) return false;
    this.setLevel(list[j].id);
    return true;
  }

  /** The overview's horizontal view direction (camera → pivot), snapped to the nearest diagonal of the plan. */
  _orbitDir() {
    const d = new THREE.Vector3().subVectors(this.controls.target, this.persp.position);
    d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(-1, 0, -0.35);
    d.normalize();
    const a = Math.round((Math.atan2(d.z, d.x) - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
    return d.set(Math.cos(a), 0, Math.sin(a));
  }

  // ---- public ------------------------------------------------------------------------------------------------

  get isWalking() {
    return this.mode === 'walk' && !this._tween;
  }

  /** The camera to render with. */
  get camera() {
    if (this._tween) return this.persp;
    if (this.mode === 'walk') return this.editor.game.camera;
    if (this.mode === 'plan') return this.ortho;
    return this.persp;
  }

  /** Cursor in NDC outside walk mode. */
  pointerNDC(target = new THREE.Vector2()) {
    const p = this._pointer;
    if (!p.known || !p.inside) return null;
    return ndcFromClient(this.canvas, p.x, p.y, target);
  }

  /** Cursor in client pixels outside walk mode ({ x, y } | null). */
  get pointerClient() {
    const p = this._pointer;
    return p.known && p.inside ? { x: p.x, y: p.y } : null;
  }

  /** True when the view hides this mesh (dollhouse wall, ceiling, backdrop). */
  isConcealed(object) {
    return this._concealed.has(object);
  }

  /**
   * Changes the view (smooth flight unless { instant: true }).
   * @param {'walk'|'orbit'|'plan'|'photo'} mode
   * @param {{ instant?: boolean }} [opts]
   */
  set(mode, opts = {}) {
    if (!MODES.includes(mode)) return;
    if (mode === 'photo' && !this._photoPose) return;
    if (mode === this.mode && !this._tween && mode !== 'photo') return;
    const from = this.mode;
    const fromPose = this._currentPose();
    if (from === 'orbit' && !this._tween) this._orbitSaved = { pos: this.persp.position.clone(), target: this.controls.target.clone() };
    if (from === 'walk' && mode !== 'walk') this._leaveWalk();
    // the overview / plan opens on the player's level (or the one asked for: ?floor=, setLevel while walking)
    if ((mode === 'orbit' || mode === 'plan') && from !== 'orbit' && from !== 'plan') {
      const want = opts.level ?? this._pinnedLevel ?? this.editor.playerLevel?.() ?? this.level;
      this._pinnedLevel = null;
      if (want && want !== this.level && this.levels.some((l) => l.id === want)) {
        this._applyLevel(want);
        this.editor.events?.emit?.('view-level', { level: this.level });
      }
    } else if ((mode === 'orbit' || mode === 'plan') && opts.level && opts.level !== this.level) {
      this.setLevel(opts.level, { instant: true });
    }
    this.mode = mode;
    this.controls.enabled = false;
    this._pan = null;
    this._press = null;
    this._panAnim = null;
    // frame the room in the part of the screen the HUD leaves free (now, not smoothed)
    this._updateOffsetTarget();
    this._off.x = this._offTarget.x;
    this._off.y = this._offTarget.y;
    if (mode === 'plan') {
      this._fitPlan();
      this._updateOrtho();
    }
    let to;
    if (mode === 'walk') to = this._walkPose();
    else if (mode === 'orbit') to = this._orbitPose(from);
    else if (mode === 'plan') to = this._planPerspPose();
    else to = this._photoPose;
    if (mode === 'orbit' || mode === 'plan') {
      this._setCeilings(true);
      this._setExterior(true);
    }
    const instant = opts.instant || !this.editor.game?.running;
    if (instant) {
      this._tween = null;
      this._applyPose(this.persp, to);
      this._arrive(mode, to);
    } else {
      this._tween = { t: 0, dur: DUR, from: fromPose, to, fromMode: from, toMode: mode };
      this._applyPose(this.persp, fromPose);
    }
    this.editor.events.emit('view', { mode });
    this._modeToast(mode);
  }

  /** walk → orbit → plan → walk (photo → walk). */
  toggle() {
    const i = ORDER.indexOf(this.mode);
    this.set(i < 0 ? 'walk' : ORDER[(i + 1) % ORDER.length]);
  }

  /**
   * Looks through a photo camera (layout.photoCameras entry: pos, rotation {x,y,z,order}, vfovDeg).
   * @param {object} pc
   * @param {{ instant?: boolean }} [opts]
   */
  setPhotoCamera(pc, opts = {}) {
    if (!pc?.pos) return;
    const rot = pc.rotation || { x: (pc.pitchDeg || 0) * DEG, y: ((pc.yawDeg || 0) + 180) * DEG, z: (pc.rollDeg || 0) * DEG, order: 'YXZ' };
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z, rot.order || 'YXZ'));
    this._photoPose = { pos: new THREE.Vector3(pc.pos.x ?? pc.pos[0], pc.pos.y ?? pc.pos[1], pc.pos.z ?? pc.pos[2]), quat, fov: pc.vfovDeg || 60 };
    this.photoCamera = pc;
    if (this.mode !== 'photo') this._photoReturn = this.mode;
    if (this.mode === 'photo' && !this._tween) {
      // already in photo mode: fly from this photo to the next
      const fromPose = this._currentPose();
      this._tween = { t: 0, dur: opts.instant ? 0 : DUR * 0.8, from: fromPose, to: this._photoPose, fromMode: 'photo', toMode: 'photo' };
      return;
    }
    this.set('photo', opts);
  }

  /** Leaves the photo camera (back to the view before it). */
  exitPhoto() {
    if (this.mode === 'photo') this.set(this._photoReturn && this._photoReturn !== 'photo' ? this._photoReturn : 'walk');
  }

  // ---- poses -------------------------------------------------------------------------------------------------

  _aspect() {
    const r = cachedRect(this.canvas);
    const w = r.width || window.innerWidth, hh = r.height || window.innerHeight;
    return w / Math.max(1, hh);
  }

  /** Target of the view offset: the free area's centre relative to the canvas centre (px). */
  _updateOffsetTarget() {
    const c = cachedRect(this.canvas);
    const f = this.hint.freeRect({ sides: true });
    this._offTarget.x = f.cx - (c.left + c.width / 2);
    this._offTarget.y = f.cy - (c.top + c.height / 2);
  }

  _currentPose() {
    if (this._tween || this.mode === 'orbit' || this.mode === 'photo') {
      return { pos: this.persp.position.clone(), quat: this.persp.quaternion.clone(), fov: this.persp.fov };
    }
    if (this.mode === 'plan') return this._planPerspPose();
    return this._walkPose();
  }

  _walkPose() {
    const cam = this.editor.game.camera;
    cam.updateMatrixWorld();
    return { pos: cam.getWorldPosition(new THREE.Vector3()), quat: cam.getWorldQuaternion(new THREE.Quaternion()), fov: cam.fov };
  }

  _orbitPose(from) {
    this._fresh = null;
    if (from !== 'walk' && this._orbitSaved) {
      const s = this._orbitSaved;
      return { pos: s.pos.clone(), quat: lookQuat(s.pos, s.target), fov: ORBIT_FOV, target: s.target.clone() };
    }
    // behind the player's view direction, high above the room
    const target = this._focus.clone();
    let dir;
    if (from === 'walk') {
      const cam = this.editor.game.camera;
      dir = cam.getWorldDirection(new THREE.Vector3());
    } else dir = new THREE.Vector3(-1, 0, -0.35); // from the plan: look north-east from above the windows
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(-1, 0, 0);
    // the nearest diagonal of the room: the L-shaped plan reads best from a corner
    const a = Math.round((Math.atan2(dir.z, dir.x) - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
    dir.set(Math.cos(a), 0, Math.sin(a));
    const el = 52 * DEG;
    const fit = this._fitOrbit(target, dir, el);
    this._fresh = { dir: dir.clone(), el, sig: this._fitSig(), t: 0 };
    return { pos: fit.pos, quat: lookQuat(fit.pos, fit.target), fov: ORBIT_FOV, target: fit.target };
  }

  /** What the overview's framing depends on: the canvas and the part of it the HUD leaves free. */
  _fitSig() {
    const c = cachedRect(this.canvas);
    const f = this.hint.freeRect({ sides: false });
    return `${Math.round(c.width)}x${Math.round(c.height)}|${Math.round(f.width)}x${Math.round(f.height)}|${this.level}`;
  }

  /**
   * While the user has not moved the overview, its framing follows the HUD as it settles (the toolbar and the key
   * bar appear a frame or two after a `?view=orbit` start) – so one URL always frames the same. Ends at the first
   * turn / pan / zoom, after REFIT_SECONDS, or when another view takes over.
   */
  _refitOrbit(dt) {
    const f = this._fresh;
    if (!f || this.mode !== 'orbit' || this._tween) return;
    f.t += dt || 0;
    if (f.t > REFIT_SECONDS) {
      this._fresh = null;
      return;
    }
    this.hint.layout(true);
    const sig = this._fitSig();
    if (sig === f.sig) return;
    f.sig = sig;
    const fit = this._fitOrbit(this._focus.clone(), f.dir, f.el);
    this.persp.position.copy(fit.pos);
    this.controls.target.copy(fit.target);
    this.persp.lookAt(fit.target);
    this.persp.updateMatrixWorld(true);
    this.controls.update();
  }

  /**
   * Frames the whole floor (and the wall tops) for an orbit direction: the smallest distance at which it fits, with
   * the pivot shifted so the room sits in the free part of the screen (between the top and the toolbar).
   */
  _fitOrbit(target, dir, el) {
    const cam = (this._fitCam ||= new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.1, 200));
    cam.fov = ORBIT_FOV;
    cam.aspect = this._aspect();
    cam.updateProjectionMatrix();
    const pts = [];
    // every room of the shown level, from its floor to the wall tops
    const lv = this._levelData();
    const polys = lv.rooms.length ? lv.rooms.map((r) => r.polygon) : [this.editor.layout.floor?.polygon || []];
    for (const poly of polys) for (const p of poly) pts.push(new THREE.Vector3(p.x, lv.floorY, p.y), new THREE.Vector3(p.x, lv.floorY + 2.5, p.y));
    const place = (d, tgt) => {
      cam.position.copy(tgt).addScaledVector(dir, -Math.cos(el) * d);
      cam.position.y += Math.sin(el) * d;
      cam.lookAt(tgt);
      cam.updateMatrixWorld(true);
    };
    const extent = () => {
      const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, behind: false };
      for (const p of pts) {
        _v.copy(p).project(cam);
        if (_v.z > 1) b.behind = true;
        b.x0 = Math.min(b.x0, _v.x); b.x1 = Math.max(b.x1, _v.x);
        b.y0 = Math.min(b.y0, _v.y); b.y1 = Math.max(b.y1, _v.y);
      }
      return b;
    };
    // fit into the free part of the screen (between the top and the key bar above the toolbar); the view offset
    // then puts the room in its middle (and beside open side panels)
    const c = cachedRect(this.canvas);
    const free = this.hint.freeRect({ sides: false });
    const fw = 2 * Math.min(1, free.width / Math.max(1, c.width)) * 0.95;
    const fh = 2 * Math.min(1, free.height / Math.max(1, c.height)) * 0.95;
    const fits = (b) => !b.behind && b.x1 - b.x0 <= fw && b.y1 - b.y0 <= fh;
    const distFor = (tgt) => {
      for (let d = 5; d < 30; d += 0.2) {
        place(d, tgt);
        if (fits(extent())) return d;
      }
      return 30;
    };
    const tgt = target.clone();
    let d = distFor(tgt);
    for (let pass = 0; pass < 2; pass++) {
      place(d, tgt);
      const b = extent();
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const halfH = d * Math.tan((ORBIT_FOV / 2) * DEG), halfW = halfH * cam.aspect;
      const e = cam.matrixWorld.elements;
      tgt.x += e[0] * cx * halfW + e[4] * cy * halfH;
      tgt.y += e[1] * cx * halfW + e[5] * cy * halfH;
      tgt.z += e[2] * cx * halfW + e[6] * cy * halfH;
      d = distFor(tgt);
    }
    place(d, tgt);
    return { pos: cam.position.clone(), target: tgt };
  }

  /** Perspective pose that frames the same as the orthographic plan camera. */
  _planPerspPose() {
    const p = this._plan;
    const half = p.H0 / p.zoom;
    const height = half / Math.tan((PLAN_FOV / 2) * DEG);
    const c = this._planCamXZ();
    const fy = this._levelData().floorY;
    const pos = new THREE.Vector3(c.x, fy + height, c.z);
    return { pos, quat: lookQuat(pos, new THREE.Vector3(c.x, fy, c.z), PLAN_UP), fov: PLAN_FOV };
  }

  _applyPose(cam, pose) {
    if (!pose) return;
    cam.position.copy(pose.pos);
    cam.quaternion.copy(pose.quat);
    if (pose.fov && cam.fov !== pose.fov) {
      cam.fov = pose.fov;
    }
    cam.aspect = this._aspect();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** Arrival in a mode (end of the flight or instant switch). */
  _arrive(mode, pose) {
    this._tween = null;
    if (mode === 'walk' || mode === 'photo') {
      this._setDollhouse(false);
      this._setCut(false);
      this._setOverlay(false, false);
      this._setCeilings(false);
      this._setExterior(false);
      if (mode === 'walk') {
        this._release?.();
        this._release = null;
        this.editor.hud?.setCursor?.('default');
      }
    } else if (mode === 'orbit') {
      this.controls.target.copy(pose?.target ?? this._focus);
      this.controls.enabled = true;
      this.controls.update();
      if (this._fresh) this._fresh.t = 0;
    } else if (mode === 'plan') {
      this._updateOrtho();
    }
  }

  _leaveWalk() {
    const game = this.editor.game;
    if (!this._release) this._release = game.blockInput?.('view') ?? null;
    game.interaction?.clear?.(game.hud);
  }

  // ---- per frame ---------------------------------------------------------------------------------------------

  update(dt) {
    // the free part of the screen (panels opening / closing slide the overview and the plan over)
    if (this.mode !== 'walk' || this._tween) {
      this._updateOffsetTarget();
      const k = 1 - Math.exp(-(dt || 0.016) * 9);
      this._off.x += (this._offTarget.x - this._off.x) * k;
      this._off.y += (this._offTarget.y - this._off.y) * k;
      if (this.mode === 'plan' && !this._tween) {
        this._fitPlan(false);
        const p = this._plan;
        if (Math.abs(p.H0target - p.H0) > 1e-4) p.H0 += (p.H0target - p.H0) * k;
      }
      const sig = openPanels().map((p) => p.id).join(',');
      if (sig !== this._panelSig) {
        this._panelSig = sig;
        if (this.editor.selected?.kind === 'item') this._ensureAt = performance.now() + 280;
      }
    }
    const tw = this._tween;
    let offW = this.mode === 'orbit' ? 1 : 0;
    if (tw) {
      tw.t = tw.dur > 0 ? Math.min(1, tw.t + (dt || 0) / tw.dur) : 1;
      const k = ease(tw.t);
      offW = (tw.fromMode === 'orbit' ? 1 - k : 0) + (tw.toMode === 'orbit' ? k : 0);
      this.persp.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.persp.quaternion.slerpQuaternions(tw.from.quat, tw.to.quat, k);
      this.persp.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * k;
      this.persp.aspect = this._aspect();
      this._applyViewOffset(offW);
      this.persp.updateMatrixWorld(true);
      if (tw.t >= 1) this._arrive(tw.toMode, tw.to);
    } else if (this.mode === 'orbit') {
      this._applyViewOffset(1);
      this._refitOrbit(dt);
      this._clampOrbit();
      this.controls.update(dt);
    } else if (this.mode === 'plan') this._updateOrtho();
    else if (this.mode === 'photo') this._applyViewOffset(0);
    if (!this._tween && (this.mode === 'orbit' || this.mode === 'plan')) this._keepSelectionVisible(dt);

    this._refreshConcealed();
    const tm = this._tween;
    const doll = this.mode === 'orbit' || (tm && (tm.toMode === 'orbit' || tm.fromMode === 'orbit'));
    const over = doll || this.mode === 'plan' || (tm && (tm.toMode === 'plan' || tm.fromMode === 'plan'));
    this._setOverview(!!over);
    this._setCut(!!over);
    this._syncCutMaterials();
    this._setUpper(!!over);
    this._setDollhouse(doll);
    this._setOverlay(over, this.mode === 'plan' && !tm);
    if (doll) this._updateDollhouse();
    this._updatePlanHud(this.mode === 'plan' && !tm);

    // controls help for the view (lowest priority: the selection / placement bars win)
    if (!tm && this.mode === 'orbit') {
      this.hint.keys({ title: 'Oversikt', items: [[['Høyre mus'], 'snu'], [['Shift+høyre'], 'flytt utsnittet'], [['Hjul'], 'zoom'], [['Tab'], 'plan'], [['Esc'], 'gå']] }, 0);
    } else if (!tm && this.mode === 'plan') {
      // left drag on empty floor, right or middle drag: all pan the plan (the toast says the same)
      this.hint.keys({ title: 'Plan', items: [[['Dra'], 'flytt utsnittet'], [['Hjul'], 'zoom'], [['Tab'], 'gå'], [['Esc'], 'gå']] }, 0);
    } else if (!tm && this.mode === 'photo') {
      this.hint.keys({ title: 'Fotovinkel', items: [[['Esc'], 'tilbake']] }, 0);
    }
  }

  /**
   * Shifts the overview's projection so its centre (the orbit pivot) sits in the middle of the free area (weight w:
   * 1 in the overview, blended while flying, 0 elsewhere – the photo camera must match its photo).
   */
  _applyViewOffset(w) {
    const cam = this.persp;
    const r = cachedRect(this.canvas);
    const W = Math.max(1, r.width), H = Math.max(1, r.height);
    const ox = this._off.x * w, oy = this._off.y * w;
    if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) {
      if (cam.view?.enabled) cam.clearViewOffset();
      else cam.updateProjectionMatrix();
    } else cam.setViewOffset(W, H, -ox, -oy, W, H);
  }

  /**
   * After a selection or a panel change: when the selected item lies outside the free part of the screen (under the
   * inspector, the catalogue, the toolbar), pan the overview / plan just enough to bring it in – once, smoothly.
   */
  _keepSelectionVisible(dt) {
    const anim = this._panAnim;
    if (anim) {
      const k = Math.min(1, (anim.t += dt || 0.016) / anim.dur);
      const e = ease(k) - anim.done;
      anim.done += e;
      if (this.mode === 'plan') {
        this._plan.cx += anim.dx * e;
        this._plan.cz += anim.dz * e;
      } else {
        _v.set(anim.dx * e, anim.dy * e, anim.dz * e);
        this.controls.target.add(_v);
        this.persp.position.add(_v);
      }
      if (k >= 1) this._panAnim = null;
      return;
    }
    if (!this._ensureAt || performance.now() < this._ensureAt) return;
    this._ensureAt = 0;
    const ed = this.editor;
    const uid = ed.selected?.kind === 'item' ? ed.selected.uid : null;
    const b = uid ? ed.sync?.objectBounds?.(uid, new THREE.Box3()) : null;
    if (!b || !Number.isFinite(b.min.x)) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const c = cachedRect(this.canvas);
    const f = this.hint.freeRect({ sides: true });
    const p = b.getCenter(new THREE.Vector3());
    _v.copy(p).project(cam);
    if (_v.z > 1) return;
    const sx = c.left + ((_v.x + 1) / 2) * c.width, sy = c.top + ((1 - _v.y) / 2) * c.height;
    const m = 40;
    const tx = clamp(sx, f.left + m, Math.max(f.left + m, f.right - m)), ty = clamp(sy, f.top + m, Math.max(f.top + m, f.bottom - m));
    const mx = tx - sx, my = ty - sy; // how far the item must move on screen
    if (Math.abs(mx) < 2 && Math.abs(my) < 2) return;
    if (this.mode === 'plan') {
      const wpp = this._planWpp();
      // screen right = −z, screen down = +x: moving the view centre by (dcx, dcz) moves the item by (dcz, −dcx) / wpp
      this._panAnim = { dx: -my * wpp, dz: mx * wpp, dy: 0, t: 0, dur: 0.4, done: 0 };
    } else {
      const dist = cam.position.distanceTo(p);
      const wpp = (2 * dist * Math.tan((cam.fov * DEG) / 2)) / Math.max(1, c.height);
      const el = cam.matrixWorld.elements;
      // the camera moves the other way: right by −mx, up by +my
      const dx = (-el[0] * mx + el[4] * my) * wpp, dy = (-el[1] * mx + el[5] * my) * wpp, dz = (-el[2] * mx + el[6] * my) * wpp;
      this._panAnim = { dx, dy, dz, t: 0, dur: 0.4, done: 0 };
      this._fresh = null;
    }
  }

  _clampOrbit() {
    const t = this.controls.target;
    const b = this._bounds;
    const fy = this._levelData().floorY;
    const nx = clamp(t.x, b.minX - 0.5, b.maxX + 0.5);
    const ny = clamp(t.y, fy, fy + 2.2);
    const nz = clamp(t.z, b.minZ - 0.5, b.maxZ + 0.5);
    if (nx !== t.x || ny !== t.y || nz !== t.z) {
      const dx = nx - t.x, dy = ny - t.y, dz = nz - t.z;
      t.set(nx, ny, nz);
      this.persp.position.x += dx;
      this.persp.position.y += dy;
      this.persp.position.z += dz;
    }
  }

  // ---- plan --------------------------------------------------------------------------------------------------

  /**
   * Base half-height of the plan so the whole floor fits the free part of the screen (between the top and the key bar
   * above the toolbar, beside open side panels – see also _planCamXZ). Without `now` it only sets the target the plan
   * eases to (a panel opening zooms out a little instead of covering a room).
   */
  _fitPlan(now = true) {
    const b = this._bounds;
    const xExt = b.maxX - b.minX; // screen vertical (north up)
    const zExt = b.maxZ - b.minZ; // screen horizontal
    const c = cachedRect(this.canvas);
    const hpx = Math.max(1, c.height || window.innerHeight);
    const f = this.hint.freeRect({ sides: true });
    const pxPerM = Math.min((f.height * 0.95) / xExt, (f.width * 0.95) / zExt);
    this._plan.H0target = hpx / (2 * Math.max(1e-3, pxPerM));
    if (now || !this._plan.H0) this._plan.H0 = this._plan.H0target;
  }

  /** Plan centre at its default: the middle of the floor (shown in the middle of the free area). */
  _resetPlanCenter() {
    const b = this._bounds;
    this._plan.cx = (b.minX + b.maxX) / 2;
    this._plan.cz = (b.minZ + b.maxZ) / 2;
    this._plan.zoom = 1;
  }

  /** Where the plan camera looks: the plan centre (p.cx, p.cz) shows in the middle of the free area, not the canvas. */
  _planCamXZ() {
    const wpp = this._planWpp();
    return { x: this._plan.cx - this._off.y * wpp, z: this._plan.cz + this._off.x * wpp };
  }

  _updateOrtho() {
    const p = this._plan;
    const cam = this.ortho;
    const aspect = this._aspect();
    const H = p.H0;
    const c = this._planCamXZ();
    cam.left = -H * aspect;
    cam.right = H * aspect;
    cam.top = H;
    cam.bottom = -H;
    cam.zoom = p.zoom;
    // low above the room: core/Highlight.js sizes its outline by the view distance. The top level as before (6 m
    // over its floor); a lower level from just over its highest ceiling (the level above is hidden)
    const lv = this._levelData();
    const camY = lv.index === 0 ? lv.floorY + PLAN_CAM_TOP : lv.top + 1;
    cam.position.set(c.x, camY, c.z);
    cam.near = 0.1;
    cam.far = Math.max(40, camY - lv.floorY + 30);
    cam.up.copy(PLAN_UP);
    cam.lookAt(c.x, lv.floorY, c.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** World metres per screen pixel in the plan. */
  _planWpp() {
    const hpx = Math.max(1, cachedRect(this.canvas).height || window.innerHeight);
    return (2 * this._plan.H0) / this._plan.zoom / hpx;
  }

  _planPan(dxPx, dyPx) {
    const wpp = this._planWpp();
    // screen right = −z (east), screen down = +x (south)
    const p = this._plan;
    const b = this._bounds;
    p.cz = clamp(p.cz + dxPx * wpp, b.minZ - 1, b.maxZ + 1);
    p.cx = clamp(p.cx - dyPx * wpp, b.minX - 1, b.maxX + 1);
  }

  _planWorldAt(clientX, clientY) {
    const r = cachedRect(this.canvas);
    const wpp = this._planWpp();
    const c = this._planCamXZ();
    const sx = clientX - (r.left + r.width / 2);
    const sy = clientY - (r.top + r.height / 2);
    return { x: c.x + sy * wpp, z: c.z - sx * wpp };
  }

  // ---- pointer -----------------------------------------------------------------------------------------------

  /** This module owns canvas presses when Input does not (other views, or a blocked walk view). */
  _owns() {
    const e = this.editor;
    return !e.input?.enabled && !e.game?.paused && !anyModalOpen();
  }

  _track(e) {
    const r = cachedRect(this.canvas);
    const p = this._pointer;
    p.x = e.clientX;
    p.y = e.clientY;
    p.inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom && !overUi(e, this.canvas);
    p.known = true;
  }

  _pointerDown(e) {
    this._track(e);
    if (this.mode === 'orbit') this._fresh = null; // the user takes over the framing
    if (!this._owns() || this._tween) {
      if (this._tween) this.controls.mouseButtons.LEFT = null;
      return;
    }
    const ed = this.editor;
    if (e.button === 0) {
      if (!ed.placement?.isActive && ed.selection?.pointerDown?.(e)) {
        this._press = null;
        this.controls.mouseButtons.LEFT = null;
        return;
      }
      this._press = { x: e.clientX, y: e.clientY, moved: false };
      // left drag on empty space turns (overview) / pans (plan)
      this.controls.mouseButtons.LEFT = this.mode === 'orbit' && !ed.placement?.isActive ? THREE.MOUSE.ROTATE : null;
      if (this.mode === 'plan' && !ed.placement?.isActive) this._pan = { x: e.clientX, y: e.clientY, button: 0, armed: true };
    } else if ((e.button === 1 || e.button === 2) && this.mode === 'plan') {
      this._pan = { x: e.clientX, y: e.clientY, button: e.button, armed: false };
      e.preventDefault();
    }
  }

  _pointerMove(e) {
    this._track(e);
    const pr = this._press;
    if (pr && !pr.moved && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > CLICK_PX) pr.moved = true;
    const pan = this._pan;
    if (pan && this.mode === 'plan' && !this._tween) {
      if (pan.armed && !pr?.moved) return;
      pan.armed = false;
      this._planPan(e.clientX - pan.x, e.clientY - pan.y);
      pan.x = e.clientX;
      pan.y = e.clientY;
      this.editor.hud?.setCursor?.('grabbing');
    }
  }

  _pointerUp(e) {
    this._track(e);
    if (this._pan && e.button === this._pan.button) {
      this._pan = null;
      this.editor.hud?.setCursor?.('default');
    }
    const pr = this._press;
    if (e.button !== 0 || !pr) return;
    this._press = null;
    if (pr.moved || !this._owns() || this._tween) return;
    const ndc = ndcFromClient(this.canvas, e.clientX, e.clientY, new THREE.Vector2());
    this.editor.handleClick(ndc);
  }

  _wheel(e) {
    if (this.mode === 'orbit') this._fresh = null; // OrbitControls zooms: the user takes over the framing
    if (this.mode !== 'plan' || this._tween || !this._owns()) return;
    e.preventDefault();
    const before = this._planWorldAt(e.clientX, e.clientY);
    const p = this._plan;
    p.zoom = clamp(p.zoom * Math.pow(1.0015, -e.deltaY), 0.6, 7);
    const after = this._planWorldAt(e.clientX, e.clientY);
    const b = this._bounds;
    p.cx = clamp(p.cx + before.x - after.x, b.minX - 1, b.maxX + 1);
    p.cz = clamp(p.cz + before.z - after.z, b.minZ - 1, b.maxZ + 1);
  }

  _resize() {
    this.persp.aspect = this._aspect();
    this.persp.updateProjectionMatrix();
    this._fitPlan();
    if (this.mode === 'plan') this._updateOrtho();
  }

  // ---- hiding: ceilings, exterior, dollhouse walls -------------------------------------------------------------

  /** Invisible stand-in that still casts the same shadow (so the room's light does not change). */
  _concealMaterial(m) {
    if (!m) return m;
    if (m.userData?.ixConceal) return m;
    const alpha = m.alphaTest > 0 && (m.map || m.alphaMap);
    const key = alpha ? m.uuid : `${m.side}|${m.shadowSide}`;
    let c = this._concealMats.get(key);
    if (!c) {
      c = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: m.side });
      c.shadowSide = m.shadowSide ?? null;
      if (alpha) {
        c.map = m.map || null;
        c.alphaMap = m.alphaMap || null;
        c.alphaTest = m.alphaTest;
      }
      c.userData.ixConceal = true;
      this._concealMats.set(key, c);
    }
    return c;
  }

  _isMine(mat) {
    return Array.isArray(mat) ? mat.every((m) => m?.userData?.ixConceal) : !!mat?.userData?.ixConceal;
  }

  _conceal(mesh) {
    if (!mesh?.isMesh || this._concealed.has(mesh)) return;
    const orig = mesh.material;
    this._concealed.set(mesh, orig);
    mesh.material = Array.isArray(orig) ? orig.map((m) => this._concealMaterial(m)) : this._concealMaterial(orig);
  }

  _reveal(mesh) {
    const orig = this._concealed.get(mesh);
    if (orig === undefined) return;
    this._concealed.delete(mesh);
    if (this._isMine(mesh.material)) mesh.material = orig;
  }

  _concealTree(root, on) {
    root?.traverse?.((o) => {
      if (!o.isMesh || o.userData.isHighlight) return;
      if (on) this._conceal(o);
      else this._reveal(o);
    });
  }

  /** Someone swapped a concealed mesh's material (repaint, rebuilt blind): keep theirs as the original, hide again. */
  _refreshConcealed() {
    for (const [mesh] of this._concealed) {
      if (this._isMine(mesh.material)) continue;
      const mat = mesh.material;
      this._concealed.set(mesh, mat);
      mesh.material = Array.isArray(mat) ? mat.map((m) => this._concealMaterial(m)) : this._concealMaterial(mat);
    }
  }

  _setCeilings(hide) {
    if (hide === this._ceilingsHidden) return;
    this._ceilingsHidden = hide;
    for (const m of this.editor.home.pickables?.ceilings || []) {
      if (hide) this._conceal(m);
      else this._reveal(m);
    }
  }

  _setExterior(hide) {
    if (hide === this._exteriorHidden) return;
    this._exteriorHidden = hide;
    const root = this.editor.home.roots?.exterior;
    if (!root) return;
    if (!hide) {
      for (const m of this._exteriorList || []) this._reveal(m);
      this._exteriorList = null;
      return;
    }
    // the tall photo backdrop / sky pieces would wall the dollhouse in; the deck and the lawn stay. Under the top
    // level also everything wholly above head height over its floor (the terrace deck over the entrance, railings)
    const lv = this._levelData();
    const over = lv.index > 0 ? lv.floorY + 1.4 : Infinity;
    // (a railing that runs down the terrace stair reaches high over the level's ceiling: it goes too)
    const top = lv.index > 0 ? lv.top + 0.6 : Infinity;
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      _box.setFromObject(o);
      if (!Number.isFinite(_box.max.y)) return;
      if (_box.max.y > 3.6 || _box.max.x - _box.min.x > 15 || _box.max.z - _box.min.z > 15 || _box.min.y > over || _box.max.y > top) list.push(o);
    });
    for (const m of list) this._conceal(m);
    this._exteriorList = list;
  }

  /** Tells visibility.js (steg 29, Y1) that an overview / plan is shown (every level stays in the scene). */
  _setOverview(on) {
    const key = on ? this.level : null;
    if (key === this._overviewOn) return;
    this._overviewOn = key;
    try {
      this.editor.home?.visibility?.setOverview?.(on, on ? { level: this.level } : undefined);
    } catch (err) {
      console.warn('[views] visibility.setOverview failed', err);
    }
    // the light: one exposure and one shadow box for the shown level (§4.3), not the 1st floor's from the overview
    // camera above the house (sun bands through the slab in the basement). The 1st floor keeps the light it was shown
    // with (camera room = the living room, its shadow box): setOverviewLevel('hoved') turns the light masks on for the
    // whole level and leaves bedroom and bath nearly black in the overview – a question for the light step (L1+L2)
    try {
      this.editor.home?.lighting?.setOverviewLevel?.(on && this.level !== MAIN_LEVEL ? this.level : null);
    } catch (err) {
      console.warn('[views] lighting.setOverviewLevel failed', err);
    }
  }

  /**
   * Hides everything of the levels above the shown one (invisible shadow casters, like the dollhouse walls): their
   * rooms and shell, the furniture standing on them, the shading of their windows and the high wall's design. The
   * hud rooms that reach down into the shown level (the stair) stay – they are part of its cut.
   */
  _setUpper(on) {
    const lv = this._levelData();
    const want = on && lv.index > 0 ? lv.id : null;
    const cur = this._upper?.level ?? null;
    if (want === cur && !(want && this._upperDirty)) {
      // shading / wall designs are rebuilt now and then: keep their new meshes hidden too
      if (want) for (const a of this._upper.anchors) this._concealTree(a, true);
      return;
    }
    this._upperDirty = false;
    if (this._upper && cur !== want) {
      for (const m of this._upper.meshes) this._reveal(m);
      for (const a of this._upper.anchors) this._concealTree(a, false);
      this._upper = null;
    }
    if (!want) return;
    const home = this.editor.home;
    const roots = home.roots || {};
    const above = new Set(this.levels.slice(0, lv.index).map((l) => l.id));
    const keep = new Set(lv.hudRooms.map((r) => roots.rooms?.[r.id]?.group).filter(Boolean));
    const meshes = this._upper?.meshes ?? new Set();
    const hide = (o) => {
      if (!o.isMesh || o.userData.isHighlight || this._concealed.has(o)) return;
      this._conceal(o);
      meshes.add(o);
    };
    const walk = (root) => {
      if (!root) return;
      if (keep.has(root)) return;
      if (root.isMesh) hide(root);
      for (const ch of root.children) walk(ch);
    };
    for (const id of above) walk(roots.levels?.[id]);
    // furniture of the levels above (items carry their level)
    for (const it of this.editor.design.list()) {
      if (!above.has(itemLevel(it, this.editor.layout))) continue;
      this.editor.sync.getObject(it.uid)?.traverse?.(hide);
    }
    // the shading of their windows, the high wall's design (the living room)
    const anchors = [];
    for (const w of home.windows || []) if (w.anchor && above.has(w.levelId ?? MAIN_LEVEL)) anchors.push(w.anchor);
    if (above.has(MAIN_LEVEL) && home.highWall?.anchor) anchors.push(home.highWall.anchor);
    if (above.has(MAIN_LEVEL) && roots.wall) anchors.push(roots.wall);
    for (const a of anchors) a.traverse(hide);
    this._upper = { level: want, meshes, anchors };
  }

  // The shell builder merges wall bodies, cladding, lists and the roof into shared meshes, so «hide this wall» cannot
  // be done per mesh. For the overview and the plan the shell is therefore re-cut once: every triangle is sorted into
  // the wall slab it belongs to (clipped at the wall's top line), into «inside the room» (kept, cut at the ceiling)
  // or dropped (roof, hallway, eaves). The cut copies are drawn instead of the originals; the originals stay in the
  // scene as invisible shadow casters, so the light in the room is the same as when walking.
  // The house's rooms (rooms.js, home.roots.rooms[id].surfaces) are cut the same way, one level at a time (one cut
  // model per level, built on first use): a backOf face has no slab of its own – its triangles go with the slab it is
  // the back of; a hud room of a level above that reaches into the shown one (the stair) is only cut at the shown
  // level's ceiling, never with a wall.

  /** The shown level's walls that have a slab (home.walls; the shell's carry no levelId: the main level). */
  _levelWalls(levelId = this.level) {
    return (this.editor.home.walls || []).filter((w) => (w.levelId ?? MAIN_LEVEL) === levelId && !(w.backOf?.length) && (w.thickness ?? 0.2) > 1e-3);
  }

  /** The layout wall (topProfile, openings, floorY) of a home wall. */
  _layoutWall(id) {
    const layout = this.editor.layout;
    return layout.house?.wallsById?.[id] ?? layout.wallsById?.[id] ?? null;
  }

  /** Plan data of a level's walls for the cut. */
  _cutWalls(levelId = this.level) {
    const fy0 = this._levelData(levelId).floorY;
    return this._levelWalls(levelId).map((w) => {
      const L = w.length ?? Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const lw = this._layoutWall(w.id);
      const profile = lw?.topProfile?.length ? lw.topProfile : [[0, w.heightAt?.(0) ?? 2.4], [L, w.heightAt?.(L) ?? 2.4]];
      const fy = Number.isFinite(w.floorY) ? w.floorY : Number.isFinite(lw?.floorY) ? lw.floorY : fy0;
      return {
        id: w.id, sx: w.start.x, sz: w.start.y, dx: (w.end.x - w.start.x) / L, dz: (w.end.y - w.start.y) / L,
        nx: w.normal.x, nz: w.normal.y, L, t: w.thickness ?? 0.2, profile, fy,
        windows: (this.editor.home.windows || []).filter((x) => x.wallId === w.id),
      };
    });
  }

  /**
   * What a level's cut is made of: [{ root, slabs }] – the living room's shell on its level, every room's surfaces,
   * and (slabs: false: only cut at the ceiling) the hud rooms of a level above that reach down into it.
   */
  _cutSources(levelId = this.level) {
    const roots = this.editor.home.roots || {};
    const lv = this._levelData(levelId);
    const out = [];
    if (lv.main && roots.shell) out.push({ root: roots.shell, slabs: true });
    for (const r of lv.rooms) {
      const s = roots.rooms?.[r.id]?.surfaces;
      if (s && s.children.length) out.push({ root: s, slabs: true });
    }
    for (const r of lv.hudRooms) {
      const s = roots.rooms?.[r.id]?.surfaces;
      if (s && s.children.length) out.push({ root: s, slabs: false });
    }
    return out;
  }

  /** Signature of a level's cut sources (re-cut when another module rebuilt them). */
  _shellSig(levelId = this.level) {
    let n = 0, v = 0;
    for (const { root } of this._cutSources(levelId)) {
      root.traverse((o) => {
        if (o.isMesh && !o.userData.isHighlight) {
          n++;
          v += o.geometry?.attributes?.position?.count || 0;
        }
      });
    }
    return `${n}:${v}`;
  }

  /**
   * The cut model of a level (built on first use, rebuilt when its sources changed):
   * { level, group, whole: Map<wallId, Mesh[]> (originals that belong to one wall), cut: Map<wallId, Mesh[]> (copies),
   *   inside: Mesh[], replaced: Mesh[] (originals drawn by copies), dropped: Mesh[] (roof, outside), walls, sources }
   */
  _prepareCut(levelId = this.level) {
    const old = this._cuts.get(levelId);
    if (old && ((this._cutOn && this._cutLevel === levelId) || old.sig === this._shellSig(levelId))) return old;
    const sig = this._shellSig(levelId);
    if (old) this._disposeCut(levelId);
    const t0 = performance.now();
    const home = this.editor.home;
    const layout = this.editor.layout;
    const lv = this._levelData(levelId);
    const walls = this._cutWalls(levelId);
    const inPoly = lv.rooms.length ? (x, z) => lv.rooms.some((r) => r.contains(x, z)) : (x, z) => layout.isInside?.(x, z) ?? true;
    // the level's own ceiling (in the stairwell: not the one of the level above)
    const ceilAt = (x, z) => Math.min(home.ceilingHeightAt?.(x, z, lv.floorY + 1) ?? lv.floorY + 2.4, lv.top);
    const skip = new Set([...(home.pickables?.floor || []), ...(home.pickables?.ceilings || [])]);
    const whole = new Map(walls.map((w) => [w.id, []]));
    const buckets = new Map();
    const replaced = [];
    const dropped = [];
    const group = new THREE.Group();
    group.name = `ix-shell-cut:${levelId}`;
    group.userData.noCollide = true;
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const C = new THREE.Vector3();
    const nm = new THREE.Matrix3();

    // which slab (wall) a world point belongs to: room face → thickness + cladding outward, a little inward
    const slabOf = (x, z) => {
      let best = null;
      for (const w of walls) {
        const u = (x - w.sx) * w.dx + (z - w.sz) * w.dz;
        if (u < -0.5 || u > w.L + 0.5) continue;
        const n = (x - w.sx) * w.nx + (z - w.sz) * w.nz;
        if (n < -(w.t + 0.45) || n > 0.085) continue;
        const score = Math.abs(n + w.t / 2) - w.t / 2 + (u < 0 ? -u : u > w.L ? u - w.L : 0);
        if (!best || score < best.score) best = { w, score };
      }
      return best?.w ?? null;
    };
    // the top line of a wall at u as a plane (contains the wall normal): [mx, my, mz, d], distance = m·p + d
    const topPlane = (w, u) => {
      const pr = w.profile;
      let k = 0;
      while (k < pr.length - 2 && u > pr[k + 1][0]) k++;
      const [u0, h0] = pr[k];
      const [u1, h1] = pr[Math.min(k + 1, pr.length - 1)];
      const slope = (h1 - h0) / Math.max(1e-4, u1 - u0);
      let mx = -slope * w.dx, my = 1, mz = -slope * w.dz;
      const l = Math.hypot(mx, my, mz);
      mx /= l;
      my /= l;
      mz /= l;
      const px = w.sx + w.dx * u0, pz = w.sz + w.dz * u0;
      return [mx, my, mz, -(mx * px + my * (w.fy + h0 + 0.002) + mz * pz)];
    };
    const interactive = (o) => {
      for (let a = o; a; a = a.parent) if (a.userData?.interactItem) return true;
      return false;
    };
    const pickOfMesh = (o) => {
      for (let a = o; a; a = a.parent) if (a.userData?.pick) return a.userData.pick;
      return null;
    };
    const pickKey = (pick) => (pick ? `${pick.kind}:${pick.wallId || pick.windowId || pick.ceilingId || ''}` : '');

    for (const { root, slabs } of this._cutSources(levelId)) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || o.userData.isHighlight || skip.has(o)) return;
        if (o.isInstancedMesh || o.isSkinnedMesh) return;
        const geo = o.geometry;
        const pos = geo?.attributes?.position;
        if (!pos || !pos.count) return;
        if (!geo.boundingBox) geo.computeBoundingBox();
        _box.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
        // roof / ceiling-level sheets are not part of the cut model
        if (_box.min.y - lv.floorY > 2.25 && (_box.max.x - _box.min.x > 3 || _box.max.z - _box.min.z > 3)) {
          dropped.push(o);
          return;
        }
        const index = geo.index;
        const triCount = Math.floor((index ? index.count : pos.count) / 3);
        const vi = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
        const mats = Array.isArray(o.material) ? o.material : null;
        const groups = mats && geo.groups.length ? geo.groups : null;
        const matOf = (t) => {
          if (!mats) return o.material;
          if (!groups) return mats[0];
          const at = t * 3;
          for (const g of groups) if (at >= g.start && at < g.start + g.count) return mats[g.materialIndex];
          return null;
        };
        // classify the triangles
        const cls = new Array(triCount);
        const planes = new Array(triCount);
        let first;
        let same = true;
        let anyClip = false;
        for (let t = 0; t < triCount; t++) {
          for (let k = 0; k < 3; k++) P[k].fromBufferAttribute(pos, vi(t, k)).applyMatrix4(o.matrixWorld);
          C.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3);
          const w = slabs ? slabOf(C.x, C.z) : null;
          let c = 'drop';
          let pl = null;
          if (w) {
            const u = (C.x - w.sx) * w.dx + (C.z - w.sz) * w.dz;
            pl = topPlane(w, Math.max(0, Math.min(w.L, u)));
            c = w.id;
          } else if (inPoly(C.x, C.z)) {
            pl = [0, 1, 0, -(ceilAt(C.x, C.z) + 0.03)];
            c = 'in';
          }
          if (pl) {
            let above = 0;
            for (let k = 0; k < 3; k++) if (pl[0] * P[k].x + pl[1] * P[k].y + pl[2] * P[k].z + pl[3] > 0) above++;
            if (above === 3) c = 'drop';
            else if (above) {
              planes[t] = pl;
              anyClip = true;
            }
          }
          cls[t] = c;
          if (first === undefined) first = c;
          else if (c !== first) same = false;
        }
        if (first === undefined) return;
        if (same && !anyClip) {
          if (first === 'in') return; // stays as it is
          if (first === 'drop') dropped.push(o);
          else whole.get(first).push(o);
          return;
        }
        if (interactive(o)) {
          // moving parts (door leaves) are never frozen into copies: they go with their main wall
          const count = new Map();
          for (const c of cls) if (c !== 'drop' && c !== 'in') count.set(c, (count.get(c) || 0) + 1);
          const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (main) whole.get(main).push(o);
          return;
        }
        // cut into copies (world space)
        replaced.push(o);
        nm.getNormalMatrix(o.matrixWorld);
        const attrs = Object.entries(geo.attributes).map(([name, a]) => ({ name, a, size: a.itemSize }));
        const sigA = attrs.map((x) => `${x.name}${x.size}`).join(',');
        const pick = pickOfMesh(o);
        const stride = attrs.reduce((s, x) => s + x.size, 0);
        let posOff = 0;
        for (const x of attrs) {
          if (x.name === 'position') break;
          posOff += x.size;
        }
        const vert = (t, k) => {
          const out = new Float32Array(stride);
          const idx = vi(t, k);
          let off = 0;
          for (const x of attrs) {
            if (x.name === 'position' || x.name === 'normal') {
              _v.fromBufferAttribute(x.a, idx);
              if (x.name === 'position') _v.applyMatrix4(o.matrixWorld);
              else _v.applyMatrix3(nm).normalize();
              out[off] = _v.x;
              out[off + 1] = _v.y;
              out[off + 2] = _v.z;
            } else {
              for (let c = 0; c < x.size; c++) out[off + c] = x.a.getComponent(idx, c);
            }
            off += x.size;
          }
          return out;
        };
        const lerpV = (a, b, s) => {
          const out = new Float32Array(stride);
          for (let i = 0; i < stride; i++) out[i] = a[i] + (b[i] - a[i]) * s;
          return out;
        };
        for (let t = 0; t < triCount; t++) {
          const c = cls[t];
          if (c === 'drop') continue;
          const mat = matOf(t);
          if (!mat) continue;
          const key = `${c}|${mat.uuid}|${sigA}|${pickKey(pick)}|${o.receiveShadow ? 1 : 0}`;
          let b = buckets.get(key);
          if (!b) {
            b = { cls: c, material: mat, attrs: attrs.map((x) => ({ name: x.name, size: x.size })), stride, data: [], pick, receive: o.receiveShadow, order: o.renderOrder, sources: new Set() };
            buckets.set(key, b);
          }
          b.sources.add(o);
          let poly = [vert(t, 0), vert(t, 1), vert(t, 2)];
          const pl = planes[t];
          if (pl) {
            const dist = (v) => pl[0] * v[posOff] + pl[1] * v[posOff + 1] + pl[2] * v[posOff + 2] + pl[3];
            const out = [];
            for (let k = 0; k < 3; k++) {
              const a = poly[k], bb = poly[(k + 1) % 3];
              const da = dist(a), db = dist(bb);
              if (da <= 0) out.push(a);
              if ((da <= 0) !== (db <= 0)) out.push(lerpV(a, bb, da / (da - db)));
            }
            poly = out;
          }
          for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) for (let i = 0; i < stride; i++) b.data.push(v[i]);
        }
      });
    }

    // build the copies
    const cut = new Map(walls.map((w) => [w.id, []]));
    const inside = [];
    const sources = new Map(); // original → [{ mesh, material }] (copies follow material swaps)
    for (const b of buckets.values()) {
      const count = b.data.length / b.stride;
      if (!count) continue;
      const g = new THREE.BufferGeometry();
      let off = 0;
      for (const a of b.attrs) {
        const arr = new Float32Array(count * a.size);
        for (let v = 0; v < count; v++) for (let c = 0; c < a.size; c++) arr[v * a.size + c] = b.data[v * b.stride + off + c];
        g.setAttribute(a.name, new THREE.BufferAttribute(arr, a.size));
        off += a.size;
      }
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, b.material);
      m.name = `cut:${b.cls}`;
      m.castShadow = false;
      m.receiveShadow = !!b.receive;
      m.renderOrder = b.order || 0;
      m.matrixAutoUpdate = false;
      m.userData.ixShell = true;
      m.userData.noCollide = true;
      if (b.pick) m.userData.pick = b.pick;
      group.add(m);
      if (b.cls === 'in') inside.push(m);
      else cut.get(b.cls)?.push(m);
      for (const src of b.sources) {
        if (!sources.has(src)) sources.set(src, []);
        sources.get(src).push({ mesh: m, material: b.material, list: Array.isArray(src.material) ? src.material : null });
      }
    }
    const ms = performance.now() - t0;
    if (ms > 80) console.info(`[views] cut of ${levelId} for the overview in ${ms.toFixed(0)} ms`);
    const c = { level: levelId, sig, group, whole, cut, inside, replaced, dropped, walls, sources };
    this._cuts.set(levelId, c);
    return c;
  }

  /** The cut model shown now (null when none). */
  get _cut() {
    return this._cutOn ? this._cuts.get(this._cutLevel) ?? null : null;
  }

  _disposeCut(levelId) {
    const c = this._cuts.get(levelId);
    if (!c) return;
    c.group.removeFromParent();
    for (const m of c.group.children) m.geometry.dispose();
    this._cuts.delete(levelId);
  }

  /** Shows / removes the cut model of the shown level (overview and plan). */
  _setCut(on) {
    const want = on ? this.level : null;
    if (want === (this._cutOn ? this._cutLevel : null)) return;
    if (this._cutOn) {
      this._setDollhouse(false);
      const c = this._cuts.get(this._cutLevel);
      this._cutOn = false;
      this._cutLevel = null;
      if (c) {
        for (const m of c.replaced) this._reveal(m);
        for (const m of c.dropped) this._reveal(m);
        c.group.removeFromParent();
      }
    }
    if (!want) return;
    const c = this._prepareCut(want);
    this._cutOn = true;
    this._cutLevel = want;
    for (const m of c.replaced) this._conceal(m);
    for (const m of c.dropped) this._conceal(m);
    this.editor.scene.add(c.group);
  }

  /** The copies follow material swaps of their originals (a wall repainted while in the overview). */
  _syncCutMaterials() {
    const c = this._cut;
    if (!c) return;
    for (const [src, copies] of c.sources) {
      const cur = this._concealed.get(src);
      if (!cur) continue;
      for (const cp of copies) {
        let next = cp.material;
        if (Array.isArray(cur) && cp.list) {
          const i = cp.list.indexOf(cp.material);
          if (i >= 0 && cur[i]) next = cur[i];
          cp.list = cur;
        } else if (!Array.isArray(cur)) next = cur;
        if (next !== cp.material) {
          cp.material = next;
          cp.mesh.material = next;
        }
      }
    }
  }

  _setDollhouse(on) {
    if (on) return;
    if (!this._wallsState.size) return;
    for (const [id, hidden] of this._wallsState) if (hidden) this._hideWall(id, false);
    this._wallsState.clear();
    this.hiddenWalls.clear();
  }

  /** Cuts away every wall of the shown level the camera looks at from outside. */
  _updateDollhouse() {
    const c = this._cut;
    if (!c) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const cp = _v.setFromMatrixPosition(cam.matrixWorld);
    for (const w of c.walls) {
      const d = (cp.x - w.sx) * w.nx + (cp.z - w.sz) * w.nz;
      const was = this._wallsState.get(w.id) || false;
      const hide = was ? d < 0.05 : d < -0.05;
      if (hide !== was) this._hideWall(w.id, hide);
      if (hide) {
        // shading / wall designs are rebuilt now and then: keep their new meshes hidden too
        for (const win of w.windows) if (win.anchor) this._concealTree(win.anchor, true);
        if (w.id === this.editor.home.highWall?.wallId) this._concealTree(this.editor.home.highWall.anchor, true);
      }
    }
  }

  _hideWall(id, hide) {
    const c = this._cuts.get(this._cutLevel ?? this.level);
    const w = c?.walls.find((x) => x.id === id);
    if (!w) return;
    this._wallsState.set(id, hide);
    if (hide) this.hiddenWalls.add(id);
    else this.hiddenWalls.delete(id);
    for (const m of c.whole.get(id) || []) {
      if (hide) this._conceal(m);
      else this._reveal(m);
    }
    for (const m of c.cut.get(id) || []) m.visible = !hide;
    for (const win of w.windows) if (win.anchor) this._concealTree(win.anchor, hide);
    if (id === this.editor.home.highWall?.wallId && this.editor.home.highWall.anchor) this._concealTree(this.editor.home.highWall.anchor, hide);
    const parts = this._overlayParts?.get(id);
    if (parts) {
      parts.stub.visible = hide;
      parts.cap.visible = !hide;
    }
  }

  /** Extra roots for picking while the cut model is shown (Selection.pickAt). */
  pickRoots() {
    const c = this._cut;
    return c ? [c.group] : [];
  }

  // ---- overlay: wall caps, cut-away stubs, plan marks -----------------------------------------------------------

  _setOverlay(on, plan) {
    const want = on ? this.level : null;
    if (want && !this._overlays.has(want)) this._buildOverlay(want);
    for (const [id, g] of this._overlays) if (g.visible !== (id === want)) g.visible = id === want;
    if (!want) return;
    const g = this._overlays.get(want);
    g.userData.planMarks.visible = plan;
    const capMat = plan ? this._mats.capPlan : this._mats.cap;
    for (const id of g.userData.wallIds) {
      const parts = this._overlayParts.get(id);
      if (!parts) continue;
      parts.cap.material = capMat;
      const hidden = !plan && this._wallsState.get(id);
      parts.stub.visible = !!hidden;
      parts.cap.visible = !hidden;
    }
  }

  /** Overlay of a level: a dark cap on every wall top, a low stub for the cut-away walls, the plan's marks. */
  _buildOverlay(levelId) {
    const home = this.editor.home;
    const g = new THREE.Group();
    g.name = `ix-dollhouse:${levelId}`;
    g.userData.noCollide = true;
    this._mats ||= {
      // section cuts are drawn flat (unlit): a lit dark cap would burn out in the sun from above
      cap: new THREE.MeshBasicMaterial({ color: 0x3a3734, side: THREE.DoubleSide, toneMapped: false }),
      capPlan: new THREE.MeshBasicMaterial({ color: 0x2c2a27, side: THREE.DoubleSide, toneMapped: false }),
      stubTop: new THREE.MeshBasicMaterial({ color: 0x3a3734, toneMapped: false }),
      glass: new THREE.MeshBasicMaterial({ color: 0xa9c3d6, side: THREE.DoubleSide, toneMapped: false }),
      door: new THREE.MeshBasicMaterial({ color: 0x5b5752, side: THREE.DoubleSide, toneMapped: false, transparent: true, opacity: 0.9 }),
    };
    const planMarks = new THREE.Group();
    planMarks.name = 'plan-marks';
    const fy0 = this._levelData(levelId).floorY;
    const walls = this._levelWalls(levelId);
    const info = walls.map((w) => {
      const L = w.length ?? Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const lw = this._layoutWall(w.id);
      const fy = Number.isFinite(w.floorY) ? w.floorY : Number.isFinite(lw?.floorY) ? lw.floorY : fy0;
      return { w, lw, L, fy, dx: (w.end.x - w.start.x) / L, dz: (w.end.y - w.start.y) / L, t: w.thickness ?? 0.2 };
    });
    const byId = new Map(info.map((it) => [it.w.id, it]));
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
    const convex = (a, b) => a.dx * b.dz - a.dz * b.dx > 0;
    // the corner neighbours: the room loop's (prevId / nextId) when they meet, else any wall of the level ending there
    const prevOf = (it) => {
      const own = byId.get(it.lw?.prevId);
      if (own && near(own.w.end, it.w.start)) return own;
      return info.find((o) => o !== it && near(o.w.end, it.w.start) && convex(o, it)) ?? null;
    };
    const nextOf = (it) => {
      const own = byId.get(it.lw?.nextId);
      if (own && near(it.w.end, own.w.start)) return own;
      return info.find((o) => o !== it && near(it.w.end, o.w.start) && convex(it, o)) ?? null;
    };
    const wallIds = [];
    const house = this.editor.layout.house;
    info.forEach((it) => {
      const prev = prevOf(it);
      const next = nextOf(it);
      const ext0 = prev && near(prev.w.end, it.w.start) && convex(prev, it) ? prev.t : 0;
      const ext1 = next && near(it.w.end, next.w.start) && convex(it, next) ? next.t : 0;
      const lw = it.lw;
      const profile = lw?.topProfile?.length ? lw.topProfile : [[0, it.w.heightAt?.(0) ?? 2.4], [it.L, it.w.heightAt?.(it.L) ?? 2.4]];
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(it.dx, 0, it.dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(it.w.normal.x, 0, it.w.normal.y)).setPosition(it.w.start.x, it.fy, it.w.start.y);
      const heightAt = (u) => (lw?.heightAt ? lw.heightAt(clamp(u, 0, it.L)) : it.w.heightAt?.(clamp(u, 0, it.L)) ?? 2.4);
      // cap: strip along the top profile, across the thickness (local z ∈ [−t, 0])
      const us = [-ext0, ...profile.map((p) => p[0]).filter((u) => u > 0 && u < it.L), it.L + ext1];
      const pos = [];
      for (let k = 0; k < us.length - 1; k++) {
        const a = us[k], b = us[k + 1];
        if (b - a < 1e-4) continue;
        const ha = heightAt(a) + CAP_LIFT, hb = heightAt(b) + CAP_LIFT;
        pos.push(a, ha, 0, b, hb, 0, b, hb, -it.t, a, ha, 0, b, hb, -it.t, a, ha, -it.t);
      }
      const capGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      capGeo.computeVertexNormals();
      capGeo.applyMatrix4(basis);
      const cap = new THREE.Mesh(capGeo, this._mats.cap);
      cap.name = `cap:${it.w.id}`;
      cap.receiveShadow = false;
      cap.castShadow = false;
      // stub: low wall pieces between door openings
      const openings = (lw?.openings || []).filter((o) => o.sill < STUB_H).map((o) => [o.u0, o.u1]).sort((x, y) => x[0] - y[0]);
      const spans = [];
      let u = -ext0;
      for (const [o0, o1] of openings) {
        if (o0 > u + 0.01) spans.push([u, o0]);
        u = Math.max(u, o1);
      }
      if (it.L + ext1 > u + 0.01) spans.push([u, it.L + ext1]);
      const stub = new THREE.Group();
      stub.name = `stub:${it.w.id}`;
      stub.visible = false;
      const side = paint(home.paintOf?.(it.w.id) ?? it.w.paint ?? 'sand');
      for (const [a, b] of spans) {
        const geo = new THREE.BoxGeometry(b - a, STUB_H, it.t);
        geo.translate((a + b) / 2, STUB_H / 2, -it.t / 2);
        geo.applyMatrix4(basis);
        const m = new THREE.Mesh(geo, [side, side, this._mats.stubTop, side, side, side]);
        m.castShadow = false;
        m.receiveShadow = true;
        stub.add(m);
        this._overlayGeos.push(geo);
      }
      // plan marks: glass in windows, door swings (each opening is on its owner wall only: drawn once)
      for (const o of lw?.openings || []) {
        if (o.type === 'window' || o.type === 'terrace-door') {
          const geo = new THREE.BoxGeometry(o.u1 - o.u0, 0.002, it.t * 0.36);
          const hy = Math.min(heightAt(o.u0), heightAt(o.u1)) + CAP_LIFT * 2;
          geo.translate((o.u0 + o.u1) / 2, hy, -it.t * 0.5);
          geo.applyMatrix4(basis);
          planMarks.add(new THREE.Mesh(geo, this._mats.glass));
          this._overlayGeos.push(geo);
        }
        if (o.door && o.door.variant !== 'sliding' && o.door.variant !== 'folding' && o.door.variant !== 'garage') {
          const angle = planSwingAngle(o, house);
          const geo = doorSwingGeometry(o, it.t, Math.min(heightAt(o.u0), heightAt(o.u1)) + CAP_LIFT * 2, angle);
          geo.applyMatrix4(basis);
          planMarks.add(new THREE.Mesh(geo, this._mats.door));
          this._overlayGeos.push(geo);
        }
      }
      g.add(cap, stub);
      this._overlayGeos.push(capGeo);
      this._overlayParts.set(it.w.id, { cap, stub, side });
      wallIds.push(it.w.id);
    });
    planMarks.visible = false;
    g.add(planMarks);
    g.userData.planMarks = planMarks;
    g.userData.wallIds = wallIds;
    g.traverse((o) => {
      o.userData.noHighlight = true;
      o.userData.noCollide = true;
      if (o.isMesh) o.raycast = () => {};
    });
    g.visible = false;
    this.editor.scene.add(g);
    this._overlays.set(levelId, g);
    return g;
  }

  _repaintStub(wallId) {
    const parts = this._overlayParts?.get(wallId);
    if (!parts) return;
    const home = this.editor.home;
    const wall = home.walls?.find((w) => w.id === wallId);
    const side = paint(home.paintOf?.(wallId) ?? wall?.paint ?? 'sand');
    parts.side = side;
    for (const m of parts.stub.children) m.material = [side, side, this._mats.stubTop, side, side, side];
  }

  // ---- plan HUD: room names, scale bar ---------------------------------------------------------------------------

  /** The plan's labels for a level: the living room by its zones (as before), every other room by name and area. */
  _planLabels(levelId = this.level) {
    const lv = this._levelData(levelId);
    const fmt = (a) => `${String(Math.round(a * 10) / 10).replace('.', ',')} m²`;
    const out = [];
    if (lv.main) for (const z of this.editor.layout.zones || []) out.push({ name: z.name, area: z.area, x: z.centroid.x, z: z.centroid.y });
    for (const r of lv.rooms) {
      if (r.id === 'stue-kjokken' && lv.main && out.length) continue;
      const c = labelPoint(r, this.editor.layout.house);
      out.push({ name: r.name, area: r.area, x: c.x, z: c.y });
    }
    return out.map((l) => ({ ...l, text: fmt(l.area) }));
  }

  _updatePlanHud(on) {
    if (!on) {
      if (this._planHud && this._planHud.root.style.display !== 'none') {
        this._planHud.root.style.display = 'none';
        this._hudKey = '';
      }
      return;
    }
    if (!this._planHud) {
      const root = h('div.ix-layer.kv-scale', { 'aria-hidden': 'true' });
      const bar = h('div.ix-scalebar__bar');
      const lab = h('span', { text: '1 m' });
      const levelEl = h('span.ix-scalebar__level', { text: '' });
      const scale = h('div.ix-scalebar', {}, levelEl, h('div.ix-scalebar__row', {}, lab, h('span.ix-scalebar__north', { text: 'N ↑' })), bar);
      root.append(scale);
      (this.editor.uiRoot || document.body).append(root);
      this._planHud = { root, labels: [], bar, lab, levelEl, built: null };
    }
    const hud = this._planHud;
    if (hud.built !== this.level) {
      // the labels of the shown level
      for (const l of hud.labels) l.el.remove();
      hud.labels = this._planLabels().map((l) => {
        const el = h('div.ix-roomlabel', {}, l.name, h('small', { text: l.text }));
        hud.root.append(el);
        return { el, x: l.x, z: l.z };
      });
      // the level's name only when the house has more than one
      hud.levelEl.textContent = this.levels.length > 1 ? this.levelName : '';
      hud.levelEl.hidden = this.levels.length <= 1;
      hud.built = this.level;
      this._hudKey = '';
    }
    if (hud.root.style.display) hud.root.style.display = '';
    const cam = this.ortho;
    // rects cached (no forced layout per frame); the labels only move when the plan view does
    const r = cachedRect(this.canvas);
    const rootRect = cachedRect(hud.root);
    const key = `${cam.position.x.toFixed(4)},${cam.position.z.toFixed(4)},${cam.zoom.toFixed(4)},${cam.top.toFixed(4)},${r.width}x${r.height},${rootRect.left},${rootRect.top}`;
    if (key === this._hudKey) return;
    this._hudKey = key;
    const fy = this._levelData().floorY;
    for (const l of hud.labels) {
      _v2.set(l.x, fy, l.z).project(cam);
      const x = (_v2.x * 0.5 + 0.5) * r.width + r.left - rootRect.left;
      const y = (-_v2.y * 0.5 + 0.5) * r.height + r.top - rootRect.top;
      l.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    }
    const pxPerM = 1 / this._planWpp();
    const len = pxPerM >= 70 ? 1 : pxPerM >= 35 ? 2 : 5;
    hud.bar.style.width = `${Math.round(len * pxPerM)}px`;
    hud.lab.textContent = `${len} m`;
  }

  _modeToast(mode) {
    if (this._toasted.has(mode)) return;
    this._toasted.add(mode);
    const text = mode === 'orbit'
      ? 'Oversikt: hold høyre museknapp for å snu, Shift + høyre flytter utsnittet, hjulet zoomer. Tab bytter visning.'
      : mode === 'plan'
        ? 'Plan ovenfra: dra med musa for å flytte utsnittet, hjulet zoomer. Tab går tilbake.'
        : null;
    if (text) this.editor.events.emit('toast', { text, seconds: 4 });
  }

  dispose() {
    this._tween = null;
    this._setDollhouse(false);
    this._setCut(false);
    for (const id of [...this._cuts.keys()]) this._disposeCut(id);
    this._setUpper(false);
    this._setOverview(false);
    this._setCeilings(false);
    this._setExterior(false);
    for (const [mesh] of [...this._concealed]) this._reveal(mesh);
    this._release?.();
    this._release = null;
    this.mode = 'walk';
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    canvas.removeEventListener('pointerleave', this._onLeave);
    canvas.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('resize', this._onResize);
    this._offPaint?.();
    this._offLoad?.();
    this._offSelect?.();
    for (const off of this._offSync || []) off?.();
    this.persp.clearViewOffset();
    this.controls.dispose();
    for (const g of this._overlays.values()) g.removeFromParent();
    for (const g of this._overlayGeos) g.dispose();
    for (const m of Object.values(this._mats || {})) m.dispose();
    for (const m of this._concealMats.values()) m.dispose();
    this._planHud?.root.remove();
  }
}

/**
 * How far a door's swing is drawn in the plan (D6): a layout opening keeps it in `door.openAngleDeg` (door-gang 180°),
 * the layout.house.doors entries carry it at the top level; 90° when neither says.
 * @param {object} o        layout opening (with `door`)
 * @param {object} [house]  layout.house
 * @returns {number} degrees
 */
export function planSwingAngle(o, house) {
  return o?.door?.openAngleDeg ?? o?.openAngleDeg ?? house?.doors?.find?.((d) => d.id === o?.id)?.openAngleDeg ?? 90;
}

/**
 * Plan mark of a door's swing in its owner wall's frame (x along the wall from its start, z into the owner room, y
 * the mark's height): the arc the leaf's edge sweeps (0 … openAngleDeg, 180° for door-gang, D6) and the open leaf.
 * @param {object} o      layout opening with `door` (leaf, hinge 'from'|'to', swing 'in'|'out')
 * @param {number} t      wall thickness
 * @param {number} hy     height of the mark (wall-local)
 * @param {number} angleDeg
 * @returns {THREE.BufferGeometry}
 */
function doorSwingGeometry(o, t, hy, angleDeg = 90) {
  const hingeAtEnd = o.door.hinge === 'to';
  const outward = o.door.swing === 'out' ? -1 : 1; // local z: + = into the room
  const zEdge = outward > 0 ? 0 : -t;
  const A = clamp((Number.isFinite(angleDeg) ? angleDeg : 90) * DEG, 0.2, Math.PI);
  const N = Math.max(12, Math.round((24 * A) / (Math.PI / 2)));
  const ribbon = [];
  const wdt = 0.014;
  /** The arc and the open leaf of one leaf hinged at u = hu, closing toward `towards` (±1 along u). */
  const swing = (hu, towards, leaf) => {
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * A;
      pts.push([hu + towards * leaf * Math.cos(a), zEdge + outward * leaf * Math.sin(a)]);
    }
    for (let k = 0; k < N; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
      const ex = z1 - z0, ez = -(x1 - x0);
      const l = Math.hypot(ex, ez) || 1;
      const ox = (ex / l) * wdt / 2, oz = (ez / l) * wdt / 2;
      ribbon.push(x0 - ox, hy, z0 - oz, x1 - ox, hy, z1 - oz, x1 + ox, hy, z1 + oz, x0 - ox, hy, z0 - oz, x1 + ox, hy, z1 + oz, x0 + ox, hy, z0 + oz);
    }
    // the open leaf: from the hinge along the open direction, 4 cm wide
    const dx = towards * Math.cos(A), dz = outward * Math.sin(A);
    const px = -dz * 0.02, pz = dx * 0.02;
    const x0 = hu, z0 = zEdge, x1 = hu + dx * leaf, z1 = zEdge + dz * leaf;
    ribbon.push(x0 - px, hy, z0 - pz, x0 + px, hy, z0 + pz, x1 + px, hy, z1 + pz, x0 - px, hy, z0 - pz, x1 + px, hy, z1 + pz, x1 - px, hy, z1 - pz);
  };
  if (o.door.variant === 'double') {
    // a double door (doortypes.js): `leaf` on the hinge jamb, `leaf2` on the other, splitting the hole
    const w1 = o.door.leaf?.w ?? o.width / 2;
    const w2 = o.door.leaf2?.w ?? w1;
    const a = (o.width * w1) / (w1 + w2);
    swing(hingeAtEnd ? o.u1 : o.u0, hingeAtEnd ? -1 : 1, a);
    swing(hingeAtEnd ? o.u0 : o.u1, hingeAtEnd ? 1 : -1, o.width - a);
  } else {
    swing(hingeAtEnd ? o.u1 : o.u0, hingeAtEnd ? -1 : 1, o.door.leaf?.w ?? o.width);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
}

/** Distance from a point to a polygon's edges (Vector2 points: x, y = z). */
function edgeDistance(x, z, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b.x - a.x, ez = b.y - a.y;
    const l2 = ex * ex + ez * ez || 1;
    const s = clamp(((x - a.x) * ex + (z - a.y) * ez) / l2, 0, 1);
    best = Math.min(best, Math.hypot(a.x + ex * s - x, a.y + ez * s - z));
  }
  return best;
}

function insidePoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Where a room's plan label goes: the point of its floor farthest from its walls, outside the stairwell and the
 * stair (a grid search – an L-shaped room's centroid can lie outside it). @returns {{ x: number, y: number }}
 */
function labelPoint(room, house) {
  const poly = room.polygon;
  const b = room.bounds;
  const holes = [
    ...(house?.floorOpenings || []).filter((fo) => fo.levelId === room.levelId).map((fo) => fo.polygon),
    ...(house?.stairs || []).map((st) => st.footprint).filter((f) => f?.length >= 3),
  ];
  const c = room.centroid;
  let best = { x: c.x, y: c.y, d: -1 };
  const N = 16;
  for (let i = 0; i <= N; i++) {
    for (let k = 0; k <= N; k++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / N, z = b.minZ + ((b.maxZ - b.minZ) * k) / N;
      if (!insidePoly(x, z, poly) || holes.some((hp) => insidePoly(x, z, hp))) continue;
      const d = Math.min(edgeDistance(x, z, poly), ...holes.map((hp) => edgeDistance(x, z, hp)));
      if (d > best.d + 1e-6) best = { x, y: z, d };
    }
  }
  return { x: best.x, y: best.y };
}

export default ViewModes;
