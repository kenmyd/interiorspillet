import * as THREE from 'three';
import { BasePanel, button, badge, emptyState, select, fmtNok, fmtCm } from './panelKit.js';
import { h, svg, fmtNumber } from './dom.js';
import { ICONS } from './icons.js';
import { buildModel } from '../models/registry.js';
import { applyShading } from '../models/shading.js';
import { disposeModel } from '../models/kit.js';
import { resolveColor, prepareMaterials } from '../home/materials.js';
import { rt60For, acousticsFor, LIVING_ROOM_ID } from '../design/Acoustics.js';
import * as catalogModule from '../catalog/index.js';

/**
 * Product catalogue (ARCHITECTURE §12): category chips (Solskjerming opens the WindowPanel), free-text search over
 * the whole catalogue, sub-category filter and sorting, product cards with a live-rendered 3D thumbnail in the
 * chosen variant's colours, name, store, price (sale price highlighted), colour swatches and a «verifisert» badge,
 * «Plasser» → editor.startPlacing(productToItemSpec(product, variant)), and a detail view (description, «Hvorfor den
 * passer», dimensions, sound absorption, light, «Se hos <butikk>»).
 *
 *   new CatalogPanel(editor) – open(arg?) / close() / toggle() / isOpen / update() / dispose()
 *     open('lenestol')                 opens on a category
 *     open({ category, productId })    opens a product's detail view
 *
 * Thumbnails: one shared offscreen WebGLRenderer (created in idle time after the game has started, or on the first
 * request – never during loading) renders the real procedural model under a neutral studio light rig (no environment
 * map: its PMREM cost seconds of blocking shader compiles in this second context); window shading is built by
 * models/shading.js on a small studio window. The result is cached as a data URL per product/variant/size and shared
 * with the Inspector and the shopping list (see `thumbnail()` / `cachedThumbnail()` below); renderer and cache outlive
 * the game session (Avslutt → «Gå inn i stua»). At most one model is built per animation frame, only for cards that
 * are (nearly) visible.
 *
 * Shading products: «Velg vindu» shows the product's window list in the detail view and keeps the product + variant
 * pending – a click on a window in the room (or a button in the list) puts it on that window (chooseWindow /
 * applyToWindow), and the window panel opens on it for colour, mount and how far it is lowered.
 */

// ---------------------------------------------------------------------------------------------------------------
// Shared thumbnail renderer

const THUMB_W = 320;
const THUMB_H = 240;

class ThumbRenderer {
  constructor() {
    this.cache = new Map(); // key → dataURL | null (failed)
    this.pending = new Map(); // key → { job, promises }
    this.queue = []; // keys, most recent request first
    this.renderer = null;
    this._raf = 0;
    this._disposed = false;
  }

  key(product, vi, w, hgt) {
    return `${product.id}|${vi}|${w}x${hgt}`;
  }

  /** Cached data URL or undefined (null = failed before). */
  peek(product, vi = product.defaultVariant ?? 0, w = THUMB_W, hgt = THUMB_H) {
    return this.cache.get(this.key(product, vi, w, hgt));
  }

  /**
   * @returns {Promise<string|null>} data URL (JPEG) of the product variant, null when rendering failed
   */
  request(product, vi = product.defaultVariant ?? 0, { w = THUMB_W, h: hgt = THUMB_H, priority = false } = {}) {
    const key = this.key(product, vi, w, hgt);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    let p = this.pending.get(key);
    if (!p) {
      p = { job: { product, vi, w, h: hgt }, resolvers: [] };
      this.pending.set(key, p);
      this.queue.push(key);
    }
    if (priority) {
      const i = this.queue.indexOf(key);
      if (i > 0) {
        this.queue.splice(i, 1);
        this.queue.unshift(key);
      }
    }
    const promise = new Promise((resolve) => p.resolvers.push(resolve));
    this._schedule();
    return promise;
  }

  /**
   * Creates the offscreen renderer now (cheap: no environment map any more – see _setup). Not called during loading;
   * the renderer is created on the first thumbnail request.
   */
  warmUp() {
    if (this._disposed || this.renderer) return;
    try {
      this._setup();
    } catch (err) {
      console.warn('[catalog] thumbnail renderer could not start', err);
    }
  }

  /** Forget queued jobs nobody waits for any more (e.g. the panel switched category). */
  cancelPending(filter) {
    this.queue = this.queue.filter((k) => {
      if (filter && !filter(k)) return true;
      const p = this.pending.get(k);
      this.pending.delete(k);
      for (const r of p?.resolvers || []) r(undefined);
      return false;
    });
  }

  _schedule() {
    if (this._raf || this._busy || this._disposed || !this.queue.length) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._pump();
    });
  }

  /** One job per frame; shaders compile asynchronously (KHR_parallel_shader_compile) so the game never stalls. */
  async _pump() {
    const key = this.queue.shift();
    if (!key) return;
    const p = this.pending.get(key);
    this.pending.delete(key);
    if (!p) {
      this._schedule();
      return;
    }
    this._busy = true;
    let url = null;
    const t0 = performance.now();
    try {
      url = await this._render(p.job);
    } catch (err) {
      console.warn('[catalog] thumbnail failed', p.job.product?.id, err);
      url = null;
    }
    const cost = performance.now() - t0;
    if (this._disposed) {
      this._busy = false;
      for (const r of p.resolvers) r(undefined);
      return;
    }
    this.cache.set(key, url);
    for (const r of p.resolvers) r(url);
    // leave the game at least one clean frame between two models (more after an expensive one)
    setTimeout(() => {
      this._busy = false;
      this._schedule();
    }, Math.min(120, Math.max(12, cost)));
  }

  _setup() {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral keeps product colours true (a face lit at ~1.0 shows its hex), unlike ACES which darkens
    // and desaturates – the thumbnails are «product photos» for purchase decisions
    renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = false;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    // No environment map: a PMREM of three's RoomEnvironment in this second WebGL context cost 0.6–5 s of blocking
    // shader compiles (review-perf-r1: 5.4 s inside Game.load). The studio look comes from the light rig below
    // (calibrated so a lit face still shows the product hex, .shots/fix-ui-r1/s3b-sample.mjs).
    // studio gradient backdrop (drawn as the background, so no horizon line)
    const bg = document.createElement('canvas');
    bg.width = 4;
    bg.height = 256;
    const g = bg.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#f4f2ee');
    grad.addColorStop(0.62, '#e7e3dc');
    grad.addColorStop(1, '#d9d4cb');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const bgTex = new THREE.CanvasTexture(bg);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = bgTex;

    // neutral white light so the product colours stay true (hemisphere + ambient replace the old environment's
    // diffuse share; the extra low «bounce» light gives metal and glass a second highlight instead of reflections)
    const T = { hemi: 1.85, amb: 0.42, key: 1.15, fill: 0.32, rim: 0.3, bounce: 0.3, cam: 0.42 };
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cfc4, T.hemi));
    if (T.amb) scene.add(new THREE.AmbientLight(0xffffff, T.amb));
    const key = new THREE.DirectionalLight(0xffffff, T.key);
    key.position.set(-1.6, 2.6, 2.4);
    const fill = new THREE.DirectionalLight(0xf1f4ff, T.fill);
    fill.position.set(2.5, 1.2, 1.4);
    const rim = new THREE.DirectionalLight(0xffffff, T.rim);
    rim.position.set(0.5, 2.0, -2.6);
    this.lights = new THREE.Group();
    this.lights.add(key, key.target, fill, fill.target, rim, rim.target);
    if (T.bounce) {
      const bounce = new THREE.DirectionalLight(0xfff6ea, T.bounce);
      bounce.position.set(1.2, -0.6, 2.2);
      this.lights.add(bounce, bounce.target);
    }
    // a soft light from the camera: without reflections, metal (brass handles, chrome) only shows what a light
    // mirrors toward the camera
    this.camLight = new THREE.DirectionalLight(0xffffff, T.cam);
    this.lights.add(this.camLight, this.camLight.target);
    scene.add(this.lights);

    // soft contact shadow (blob) under floor objects, behind wall objects
    const sh = document.createElement('canvas');
    sh.width = sh.height = 128;
    const sg = sh.getContext('2d');
    const rg = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(0,0,0,0.42)');
    rg.addColorStop(0.45, 'rgba(0,0,0,0.22)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = rg;
    sg.fillRect(0, 0, 128, 128);
    const shTex = new THREE.CanvasTexture(sh);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, toneMapped: false, color: 0x2a2219 }));
    this.shadow.renderOrder = -1;
    scene.add(this.shadow);

    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, THUMB_W / THUMB_H, 0.01, 100);
  }

  async _render({ product, vi, w, h: hgt }) {
    if (this._disposed) return null;
    if (!this.renderer) this._setup();
    const shading = isShadingProduct(product);
    const spec = shading ? shadingThumbSpec(product, vi) : catalogSpec(product, vi);
    if (!spec) return null;
    // textures of material kinds not used yet are generated in their own tasks (≈ 50–200 ms each, once)
    try {
      await prepareMaterials(Object.values(spec.materials || {}));
    } catch {
      /* built on demand by mat() instead */
    }
    if (this._disposed || !this.renderer) return null;
    // window shading has no registry archetype: it is built by models/shading.js on a small studio window
    const win = shading ? this._shadingWindow(product) : null;
    let model = null;
    if (win) {
      try {
        model = applyShading(win.info, spec).group;
      } catch (err) {
        console.warn('[catalog] shading thumbnail failed', product.id, err);
        model = null;
      }
      if (!model) {
        applyShading(win.info, null);
        win.root.removeFromParent();
        return null;
      }
    } else model = buildModel({ ...spec, quality: 'medium' });
    const mount = shading ? 'window' : product.mount || spec.mount || 'floor';
    const holder = new THREE.Group();
    if (win) holder.add(win.root);
    else holder.add(model);
    this.scene.add(holder);
    try {
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      if (win) box.union(win.frameBox);
      if (box.isEmpty()) return null;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // view direction per mount (from the object toward the camera)
      let dir;
      if (mount === 'rug') dir = new THREE.Vector3(0.32, 1.35, 1);
      else if (mount === 'soft') dir = new THREE.Vector3(0.5, 0.7, 1);
      else if (mount === 'window') dir = new THREE.Vector3(0.42, 0.08, 1);
      else if (mount === 'wall') dir = new THREE.Vector3(0.38, 0.14, 1);
      else if (mount === 'ceiling') dir = new THREE.Vector3(0.55, 0.12, 1);
      else dir = new THREE.Vector3(0.62, 0.4, 1);
      dir.normalize();

      const cam = this.camera;
      cam.aspect = w / hgt;
      cam.fov = 28;
      cam.updateProjectionMatrix();
      // fit the 8 box corners into ~84 % of the frame (two refinement passes)
      const corners = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      let dist = size.length() * 1.8 + 0.2;
      const p = new THREE.Vector3();
      for (let pass = 0; pass < 3; pass++) {
        cam.position.copy(center).addScaledVector(dir, dist);
        cam.lookAt(center);
        cam.updateMatrixWorld(true);
        let m = 0;
        for (const c of corners) {
          p.copy(c).project(cam);
          m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
        }
        if (m <= 0) break;
        dist *= m / 0.84;
      }
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.lookAt(center);
      cam.near = Math.max(0.01, dist - size.length() * 2);
      cam.far = dist + size.length() * 3 + 1;
      cam.updateProjectionMatrix();

      // lights follow the framing (key from the front-left, like daylight from a window)
      this.lights.position.copy(center);
      this.lights.scale.setScalar(Math.max(0.4, size.length()));
      this.camLight.position.copy(dir).multiplyScalar(3).add(new THREE.Vector3(-0.4, 0.5, 0));
      for (const l of this.lights.children) if (l.isDirectionalLight) l.target.position.set(0, 0, 0);

      // contact shadow
      const sh = this.shadow;
      if (mount === 'ceiling' || mount === 'window') sh.visible = false;
      else if (mount === 'wall') {
        sh.visible = true;
        sh.rotation.set(0, 0, 0);
        sh.scale.set(size.x * 1.35 + 0.08, size.y * 1.35 + 0.08, 1);
        sh.position.set(center.x + size.x * 0.04, center.y - size.y * 0.04, box.min.z - 0.002);
        sh.material.opacity = 0.55;
      } else {
        sh.visible = true;
        sh.rotation.set(-Math.PI / 2, 0, 0);
        const s = mount === 'rug' ? 1.12 : 1.5;
        sh.scale.set(size.x * s + 0.06, size.z * s + 0.06, 1);
        sh.position.set(center.x, box.min.y + 0.001, center.z);
        sh.material.opacity = mount === 'rug' ? 0.45 : 0.85;
      }

      const r = this.renderer;
      // compile new shader programs without blocking the main thread (KHR_parallel_shader_compile when available)
      if (r.compileAsync) {
        try {
          await r.compileAsync(this.scene, cam);
        } catch {
          /* falls back to compiling in render() */
        }
      }
      if (this._disposed || !this.renderer) return null;
      r.setSize(w, hgt, false);
      r.render(this.scene, cam);
      // toBlob encodes off the main thread (toDataURL would block ≈ 5–10 ms per thumbnail)
      const blob = await new Promise((res) => {
        try {
          r.domElement.toBlob(res, 'image/jpeg', 0.9);
        } catch {
          res(null);
        }
      });
      if (!blob) return r.domElement.toDataURL('image/jpeg', 0.9);
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => res(null);
        fr.readAsDataURL(blob);
      });
    } finally {
      holder.removeFromParent();
      if (win) {
        applyShading(win.info, null); // disposes the shading rig's own geometry/materials
        win.root.removeFromParent();
      } else disposeModel(model);
    }
  }

  /**
   * A studio window for a shading thumbnail: wall around the opening with a reveal, a black frame and pale «sky»
   * glass. Size from the product (ready-made: one piece fills it), so the shading looks like the store's product.
   * The anchor follows WindowInfo: origin top middle of the opening on the room side, +x right, −y down, +z room.
   */
  _shadingWindow(product) {
    const clampV = (v, a, b) => Math.max(a, Math.min(b, v));
    const W = clampV(Number(product.dims?.w) || 1.4, 0.7, 2.2);
    const H = clampV(Math.min(Number(product.dims?.h) || 1.6, product.archetype === 'curtain' ? 1.7 : 2.0), 0.7, 2.0);
    const sill = product.archetype === 'curtain' ? 0.6 : 0.8;
    const reveal = 0.16;
    const fw = 0.06;
    if (!this._win) {
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0.5, 0.5, 0.5); // unit box from (0,0,0) to (1,1,1)
      this._win = {
        box,
        wall: new THREE.MeshStandardMaterial({ color: resolveColor('sand'), roughness: 0.92, metalness: 0 }),
        frame: new THREE.MeshStandardMaterial({ color: 0x1f1f20, roughness: 0.55, metalness: 0 }),
        glass: new THREE.MeshBasicMaterial({ color: 0xe9eef2 }),
        plane: new THREE.PlaneGeometry(1, 1),
      };
    }
    const R = this._win;
    const root = new THREE.Group();
    const part = (mat, x0, y0, z0, x1, y1, z1) => {
      const m = new THREE.Mesh(R.box, mat);
      m.position.set(x0, y0, z0);
      m.scale.set(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0));
      root.add(m);
      return m;
    };
    // wall (room-side face at z = 0) with the opening: x ∈ [−W/2, W/2], y ∈ [−H, 0] relative to the anchor
    const top = sill + H;
    const M = 0.9;
    const t = 0.3;
    part(R.wall, -W / 2 - M, -top, -t, -W / 2, 0.7, 0); // left
    part(R.wall, W / 2, -top, -t, W / 2 + M, 0.7, 0); // right
    part(R.wall, -W / 2, 0, -t, W / 2, 0.7, 0); // above
    part(R.wall, -W / 2, -top, -t, W / 2, -H, 0); // below (sill)
    // frame at the back of the reveal
    const zf = -reveal;
    part(R.frame, -W / 2, -H, zf - 0.06, -W / 2 + fw, 0, zf);
    part(R.frame, W / 2 - fw, -H, zf - 0.06, W / 2, 0, zf);
    part(R.frame, -W / 2, -fw, zf - 0.06, W / 2, 0, zf);
    part(R.frame, -W / 2, -H, zf - 0.06, W / 2, -H + fw, zf);
    // pale «sky» behind the glass (left out for an exterior screen, which hangs outside the glass)
    if (product.archetype !== 'exterior-screen') {
      const glass = new THREE.Mesh(R.plane, R.glass);
      glass.scale.set(W - 2 * fw, H - 2 * fw, 1);
      glass.position.set(0, -H / 2, zf - 0.03);
      root.add(glass);
    }
    const anchor = new THREE.Group();
    root.add(anchor);
    root.position.set(0, top, 0);
    root.updateMatrixWorld(true);
    const info = {
      id: 'katalog-miniatyr', name: 'Vindu', wallId: null, type: 'window', width: W, height: H, sill,
      center: new THREE.Vector3(0, top - H / 2, 0), normal: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0),
      revealDepth: reveal, frameWidth: fw, anchor,
    };
    // the opening (with a bit of wall) is always in the frame, also for a small blind
    const frameBox = new THREE.Box3(new THREE.Vector3(-W / 2 - 0.08, sill - 0.06, -reveal), new THREE.Vector3(W / 2 + 0.08, top + 0.08, 0.05));
    return { root, anchor, info, frameBox };
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this.cancelPending();
    if (this._win) {
      this._win.box.dispose();
      this._win.plane.dispose();
      this._win.wall.dispose();
      this._win.frame.dispose();
      this._win.glass.dispose();
      this._win = null;
    }
    if (this.renderer) {
      this.scene?.environment?.dispose?.();
      this.scene?.background?.dispose?.();
      this.shadow?.geometry.dispose();
      this.shadow?.material.map?.dispose();
      this.shadow?.material.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
    }
    this.renderer = null;
  }
}

let _thumbs = null;
let _users = 0;

function thumbs() {
  if (!_thumbs || _thumbs._disposed) _thumbs = new ThumbRenderer();
  return _thumbs;
}

/**
 * Rendered thumbnail of a product variant (shared cache; also used by the Inspector and the shopping list).
 * @param {object} product  catalogue product
 * @param {number} [variantIndex]
 * @param {{ w?: number, h?: number, priority?: boolean }} [size]  pixels (default 320 × 240)
 * @returns {Promise<string|null|undefined>} JPEG data URL; null if it could not be rendered, undefined if cancelled
 */
export function thumbnail(product, variantIndex, size) {
  if (!product) return Promise.resolve(null);
  return thumbs().request(product, clampVariant(product, variantIndex), size);
}

/** Cached thumbnail data URL (or undefined when not rendered yet). */
export function cachedThumbnail(product, variantIndex, { w = THUMB_W, h: hgt = THUMB_H } = {}) {
  if (!product || !_thumbs) return undefined;
  return _thumbs.peek(product, clampVariant(product, variantIndex), w, hgt);
}

// ---------------------------------------------------------------------------------------------------------------
// Product helpers (also used by the Inspector / shopping list)

/** Item spec for a thumbnail: the product variant, pendants on a short cord so the lamp itself fills the frame. */
function catalogSpec(product, vi) {
  const spec = catalogModule.productToItemSpec(product, vi);
  if (!spec) return null;
  if (product.mount === 'ceiling' && typeof spec.params?.drop === 'number') {
    spec.params.drop = Math.min(spec.params.drop, (spec.dims?.h || 0.3) + 0.3);
  }
  return spec;
}

/** Window shading (built by models/shading.js, not by the registry). */
function isShadingProduct(p) {
  return p?.category === 'solskjerming' || p?.mount === 'window';
}

/** ShadingSpec for a thumbnail: the product variant, mostly lowered so the fabric/slats show (curtains drawn). */
function shadingThumbSpec(product, vi) {
  const spec = catalogModule.productToShadingSpec?.(product, vi);
  if (!spec) return null;
  if (product.archetype === 'curtain') spec.open = 0;
  else if (product.archetype === 'exterior-screen') spec.open = 0.15;
  else spec.open = Math.min(spec.open ?? 0.2, 0.12);
  if (spec.archetype === 'venetian' || spec.archetype === 'vertical') spec.tilt = spec.tilt || 25;
  spec.quality = 'medium';
  return spec;
}

function clampVariant(p, vi) {
  const n = p?.variants?.length || 1;
  const v = Number.isInteger(vi) ? vi : p?.defaultVariant ?? 0;
  return Math.max(0, Math.min(n - 1, v));
}

/**
 * Price display parts for a product variant.
 * @returns {{ price: number|null, listPrice: number|null, onSale: boolean, from: boolean, discount: number }}
 */
export function priceInfo(catalog, product, vi) {
  const p = catalog.priceOf ? catalog.priceOf(product, clampVariant(product, vi)) : { price: product.priceNok, listPrice: product.priceNok, onSale: false, from: false };
  const discount = p.onSale && p.listPrice ? Math.round((1 - p.price / p.listPrice) * 100) : 0;
  return { ...p, discount };
}

/** Element showing a price (sale price highlighted, list price struck through). */
export function priceEl(info, { big = false } = {}) {
  if (info.price == null) return h('span.ipc-price.is-none', { text: 'Pris ukjent' });
  return h(`span.ipc-price${info.onSale ? '.is-sale' : ''}${big ? '.is-big' : ''}`, {},
    h('b', { text: `${info.from ? 'fra ' : ''}${fmtNok(info.price)}` }),
    info.onSale && info.listPrice ? h('s', { text: fmtNok(info.listPrice) }) : null,
  );
}

const PART_ORDER = ['upholstery', 'fabric', 'shade', 'body', 'top', 'front', 'panel', 'slats', 'base', 'print', 'leaves', 'legs', 'frame', 'metal', 'accent', 'inner', 'handle', 'pot', 'piping', 'backing', 'cord', 'accent2'];
const _swatchParts = new WeakMap();

/**
 * The parts whose colour tells a product's variants apart (max 2), e.g. ['upholstery'] for a chair that only comes
 * in different fabrics, ['upholstery', 'legs'] when the legs vary too.
 */
function swatchParts(product) {
  let parts = _swatchParts.get(product);
  if (parts) return parts;
  const vs = product?.variants || [];
  const all = [...new Set(vs.flatMap((v) => Object.keys(v.colors || {})))];
  all.sort((a, b) => (PART_ORDER.indexOf(a) + 1 || 99) - (PART_ORDER.indexOf(b) + 1 || 99));
  const varies = all.filter((k) => {
    const cs = vs.map((v) => resolveColor(v.colors?.[k] || '#999999'));
    return cs.some((c) => colorDist(c, cs[0]) > 18);
  });
  parts = varies.length ? varies.slice(0, 2) : all.slice(0, 1);
  _swatchParts.set(product, parts);
  return parts;
}

/** The 1–2 colours that identify a variant (for split swatches). */
export function variantColors(product, v) {
  const parts = swatchParts(product);
  const cs = parts.map((k) => resolveColor(v?.colors?.[k] || '#999999'));
  if (cs.length > 1 && colorDist(cs[0], cs[1]) < 30) cs.length = 1;
  return cs.length ? cs : ['#999999'];
}

/** Euclidean RGB distance of two '#rrggbb' colours (0…441). */
export function colorDist(a, b) {
  const pa = parseInt(String(a).slice(1), 16);
  const pb = parseInt(String(b).slice(1), 16);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return 999;
  const dr = ((pa >> 16) & 255) - ((pb >> 16) & 255);
  const dg = ((pa >> 8) & 255) - ((pb >> 8) & 255);
  const db = (pa & 255) - (pb & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Round swatch button for a variant (split diagonally when it has two main colours). */
export function variantSwatch(product, v, i, { active = false, onPick, size } = {}) {
  const [a, b] = variantColors(product, v);
  const bg = b ? `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` : a;
  return h(`button.ip-swatch.ipc-vsw${active ? '.is-active' : ''}`, {
    type: 'button',
    title: v.name || `Variant ${i + 1}`,
    'aria-label': v.name || `Variant ${i + 1}`,
    'aria-pressed': active ? 'true' : 'false',
    style: { background: bg, ...(size ? { width: size, height: size } : {}) },
    on: { click: (e) => {
      e.stopPropagation();
      onPick?.(i);
    } },
  });
}

/**
 * Extra «Fakta» rows for product types whose build matters when buying: vitrineskap (doors, shelves, light, how it
 * stands or hangs) and hvilestoler (footstool / built-in footrest, swivel, headrest).
 * @returns {Array<[string, string]>}
 */
export function typeFacts(p, catalog, vi = p?.defaultVariant ?? 0) {
  const v = p?.variants?.[vi];
  const P = { ...(p?.params || {}), ...(v?.params || {}), ...(v?.paramsOverride || {}) };
  const out = [];
  const family = catalog?.archetypeInfo?.(p?.archetype)?.family;
  if (family === 'storage') {
    const glass = String(P.doorStyle || '').startsWith('glass');
    const n = Number(P.doors) || 0;
    if (n) out.push(['Dører', glass ? `${n} ${n === 1 ? 'glassdør' : 'glassdører'}${P.doorStyle === 'glass-smoked' ? ' i røykfarget glass' : ''}` : `${n}`]);
    if (P.shelves) out.push(['Hyller', `${P.shelves}${P.shelfMaterial === 'glass' ? ' i glass' : ''}`]);
    // (params.drawers is the builder's closed lower part – drawers or doors – so it is shown as a height, not a count)
    if (P.bottomHeight > 0) out.push(['Lukket del nederst', `ca. ${fmtCm(P.bottomHeight)}`]);
    if (P.led != null) out.push(['Innebygd lys', P.led ? 'Ja' : 'Nei']);
    if (p.mount === 'wall' || P.base === 'wall') {
      out.push(['Montering', `Henges på veggen${Number.isFinite(P.mountHeight) ? ` (forslag: underkant ${fmtCm(P.mountHeight)} over gulvet)` : ''}`]);
    } else if (P.base === 'plinth') out.push(['Understell', `Sokkel${P.legH ? ` ${fmtCm(P.legH)}` : ''}`]);
    else if (P.base === 'legs' && P.legH) out.push(['Understell', `${P.legStyle === 'metal-frame' ? 'Metallunderstell' : 'Ben'} ${fmtCm(P.legH)}`]);
  }
  if (p?.archetype === 'recliner') {
    if (P.footstool === true) out.push(['Fotskammel', 'Følger med']);
    else if (P.footstool === false) out.push(['Fothviler', 'Innebygd (felles ut)']);
    if (P.legStyle === 'swivel-star') out.push(['Fot', 'Stjernefot']);
    if (P.headrest) out.push(['Nakkepute', 'Ja']);
  }
  return out;
}

/** «B 74 × D 74 × H 77 cm». */
export function dimsText(d) {
  if (!d) return '';
  const cm = (v) => fmtNumber(Math.round(v * 100), 0);
  return `B ${cm(d.w)} × D ${cm(d.d)} × H ${cm(d.h)} cm`;
}

/** Opens a URL in a new tab (no opener). */
export function openExternal(url) {
  if (!url) return;
  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (w) w.opener = null;
  } catch (err) {
    console.warn('[catalog] could not open', url, err);
  }
}

const LINK_ICON = '<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>';
const SEARCH_ICON = '<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5 20 20"/></svg>';
const PLUS_ICON = '<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>';
export const EXTRA_ICONS = { link: LINK_ICON, search: SEARCH_ICON, plus: PLUS_ICON };

/** «Se hos Bohus» link button (opens the product page in a new tab). */
export function storeLink(product, { size = 'sm', variant } = {}) {
  const url = product?.variants?.[variant]?.url || product?.url;
  if (!url) return null;
  return h(`a.kv-btn${size ? `.kv-btn--${size}` : ''}.ipc-storelink`, {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: `Åpne produktsiden hos ${product.store} i en ny fane`,
  }, h('span', { text: `Se hos ${product.store}` }), svg(LINK_ICON));
}

// ---------------------------------------------------------------------------------------------------------------
// Styles

const CSS = `
.ipc-panel .ip-panel__body { padding-top: 0.75em; }
.ipc-search { position: relative; margin-bottom: 0.7em; }
.ipc-search .kv-icon { position: absolute; left: 0.65em; top: 50%; width: 1.05em; height: 1.05em; transform: translateY(-50%); color: var(--kv-ink-3); pointer-events: none; }
.ipc-search .ip-input { padding-left: 2.2em; height: 2.4em; }
.ipc-search__clear { position: absolute; right: 0.3em; top: 50%; transform: translateY(-50%); width: 1.8em; height: 1.8em; border: 0; border-radius: 50%; background: transparent; color: var(--kv-ink-3); display: grid; place-items: center; }
.ipc-search__clear:hover { background: var(--kv-surface-3); color: var(--kv-ink); }
.ipc-search__clear .kv-icon { position: static; transform: none; width: 0.95em; height: 0.95em; }
.ipc-cats { display: flex; flex-wrap: wrap; gap: 0.3em; margin-bottom: 0.7em; }
.ipc-chip { display: inline-flex; align-items: center; gap: 0.35em; height: 2em; padding: 0 0.62em; border-radius: 2em; border: 1px solid var(--kv-line-2);
  background: var(--kv-surface); color: var(--kv-ink-2); font-size: 0.8em; font-weight: 620; white-space: nowrap; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.ipc-chip .kv-icon { width: 1.05em; height: 1.05em; opacity: 0.8; }
.ipc-subs { display: flex; gap: 0.3em; flex-wrap: wrap; margin: -0.2em 0 0.7em; }
.ipc-subs:empty { display: none; }
.ipc-subs .ipc-chip { height: 1.8em; font-size: 0.76em; }
.ipc-chip:hover { background: var(--kv-surface-3); color: var(--kv-ink); }
.ipc-chip.is-active { background: var(--kv-accent-soft); border-color: rgba(255, 181, 46, 0.55); color: var(--kv-accent-2); }
.ipc-chip.is-active .kv-icon { color: var(--kv-accent); opacity: 1; }
.ipc-chip small { font-size: 0.85em; color: var(--kv-ink-4); font-weight: 600; }
.ipc-chip.is-active small { color: rgba(255, 210, 122, 0.7); }
.ipc-chip--ext::after { content: '↗'; font-size: 0.85em; opacity: 0.6; }
.ipc-tools { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; margin-bottom: 0.6em; }
.ipc-sort { flex: none; width: 9.4em; }
.ipc-sort .ip-select { height: 2em; font-size: 0.8em; }
.ipc-count { font-size: 0.8em; color: var(--kv-ink-3); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ipc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12.4em, 1fr)); gap: 0.6em; }
.ipc-card { position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: var(--kv-r); border: 1px solid var(--kv-line);
  background: var(--kv-surface); overflow: hidden; cursor: pointer; transition: border-color 0.15s, background 0.15s, transform 0.15s var(--kv-ease); }
.ipc-card:hover { border-color: var(--kv-line-2); background: var(--kv-surface-2); }
.ipc-card:focus-visible { outline: 2px solid var(--kv-accent); outline-offset: 2px; }
.ipc-thumb { position: relative; aspect-ratio: 4 / 3; background: linear-gradient(180deg, #f4f2ee, #ddd8cf) center / cover no-repeat; overflow: hidden; }
.ipc-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.25s; }
.ipc-thumb img.is-ready { opacity: 1; }
.ipc-thumb__ph { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(40, 34, 28, 0.25); }
.ipc-thumb__ph .kv-icon { width: 2.6em; height: 2.6em; }
.ipc-thumb.is-loading .ipc-thumb__ph::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%);
  background-size: 200% 100%; animation: ipc-shimmer 1.3s linear infinite; }
@keyframes ipc-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
.ipc-flags { position: absolute; left: 0.45em; top: 0.45em; display: flex; gap: 0.3em; }
.ipc-flag { padding: 0.18em 0.5em; border-radius: 1em; font-size: 0.7em; font-weight: 800; letter-spacing: 0.02em; background: #d8432f; color: #fff; box-shadow: 0 0.15em 0.4em rgba(0,0,0,0.25); }
.ipc-flag--ok { background: rgba(255, 255, 255, 0.92); color: #1b7a49; display: inline-flex; align-items: center; gap: 0.2em; }
.ipc-flag--ok .kv-icon { width: 1.05em; height: 1.05em; }
.ipc-verified { position: absolute; right: 0.45em; top: 0.45em; width: 1.6em; height: 1.6em; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255, 255, 255, 0.92); color: #1b7a49; box-shadow: 0 0.15em 0.4em rgba(0,0,0,0.2); }
.ipc-verified .kv-icon { width: 1.05em; height: 1.05em; stroke-width: 2.6; }
.ipc-body { display: flex; flex-direction: column; gap: 0.25em; padding: 0.55em 0.65em 0.6em; flex: 1; min-width: 0; }
.ipc-name { font-weight: 650; font-size: 0.92em; line-height: 1.22; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 2.44em; }
.ipc-store { font-size: 0.76em; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ipc-swatches { display: flex; flex-wrap: wrap; gap: 0.28em; margin: 0.15em 0 0.1em; --ip-sw: 1.3em; min-height: 1.3em; }
.ipc-swatches .ip-swatch { border-width: 1.5px; }
.ipc-more { font-size: 0.72em; color: var(--kv-ink-3); align-self: center; }
.ipc-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.4em; margin-top: auto; padding-top: 0.25em; }
.ipc-foot .kv-btn { height: 2em; padding: 0 0.7em; font-size: 0.82em; }
.ipc-foot .kv-btn .kv-icon { width: 1em; height: 1em; }
.ipc-price { display: flex; flex-direction: column; line-height: 1.12; font-variant-numeric: tabular-nums; min-width: 0; }
.ipc-price b { font-weight: 760; color: var(--kv-ink); white-space: nowrap; }
.ipc-price s { font-size: 0.75em; color: var(--kv-ink-4); white-space: nowrap; }
.ipc-price.is-sale b { color: #ff8a73; }
.ipc-price.is-none b, .ipc-price.is-none { color: var(--kv-ink-3); font-size: 0.85em; }
.ipc-price.is-big { flex-direction: row; align-items: baseline; gap: 0.55em; }
.ipc-price.is-big b { font-size: 1.45em; }
.ipc-price.is-big s { font-size: 0.9em; }
.ipc-detail__back { margin: -0.15em 0 0.7em -0.3em; }
.ipc-detail__thumb { position: relative; border-radius: var(--kv-r); overflow: hidden; aspect-ratio: 4 / 3; background: linear-gradient(180deg, #f4f2ee, #ddd8cf); }
.ipc-detail__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ipc-detail__photo { margin-top: 0.5em; display: flex; gap: 0.6em; align-items: center; font-size: 0.78em; color: var(--kv-ink-3); }
.ipc-detail__photo img { width: 4.6em; height: 4.6em; object-fit: cover; border-radius: var(--kv-r-sm); background: #fff; flex: none; }
.ipc-detail h3 { margin: 0.75em 0 0.15em; font: 720 1.25em/1.2 var(--kv-font-display); }
.ipc-detail__sub { color: var(--kv-ink-3); font-size: 0.88em; margin-bottom: 0.55em; display: flex; flex-wrap: wrap; gap: 0.35em 0.6em; align-items: center; }
.ipc-detail__price { display: flex; align-items: center; gap: 0.6em; margin: 0.3em 0 0.35em; flex-wrap: wrap; }
.ipc-note { font-size: 0.78em; color: var(--kv-ink-4); line-height: 1.4; margin: 0 0 0.9em; }
.ipc-variants { display: flex; flex-direction: column; gap: 0.25em; }
.ipc-variant { display: flex; align-items: center; gap: 0.6em; padding: 0.3em 0.45em; border-radius: var(--kv-r-sm); border: 1px solid transparent; background: transparent; text-align: left; color: var(--kv-ink-2); font-size: 0.88em; }
.ipc-variant:hover { background: var(--kv-surface-2); color: var(--kv-ink); }
.ipc-variant.is-active { border-color: rgba(255, 181, 46, 0.45); background: var(--kv-accent-soft); color: var(--kv-ink); }
.ipc-variant .ip-swatch { --ip-sw: 1.45em; flex: none; pointer-events: none; }
.ipc-variant span { flex: 1; min-width: 0; }
.ipc-variant small { color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.ipc-text { margin: 0; line-height: 1.5; font-size: 0.92em; color: var(--kv-ink-2); }
.ipc-why { padding: 0.75em 0.9em; border-radius: var(--kv-r); background: rgba(255, 181, 46, 0.07); border: 1px solid rgba(255, 181, 46, 0.22); }
.ipc-facts { display: grid; grid-template-columns: auto 1fr; gap: 0.35em 0.9em; font-size: 0.9em; margin: 0; }
.ipc-facts dt { color: var(--kv-ink-3); }
.ipc-facts dd { margin: 0; color: var(--kv-ink); font-variant-numeric: tabular-nums; }
.ipc-panel .ip-panel__foot { justify-content: space-between; }
.ipc-storelink { text-decoration: none; }
.ipc-storelink .kv-icon { width: 0.95em; height: 0.95em; }
.ipc-empty { grid-column: 1 / -1; }
.ipc-wins__hint { margin: -0.15em 0 0.5em; font-size: 0.82em; color: var(--kv-ink-3); }
.ipc-wins__hint.is-pending { color: var(--kv-accent-2); font-weight: 650; }
.ipc-wins__list { display: flex; flex-direction: column; gap: 0.3em; }
.ipc-win { display: flex; align-items: center; gap: 0.6em; padding: 0.4em 0.55em; border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line); background: var(--kv-surface); color: var(--kv-ink); text-align: left; }
.ipc-win:hover { background: var(--kv-surface-3); border-color: var(--kv-line-2); }
.ipc-win.is-active { border-color: rgba(255, 181, 46, 0.55); background: var(--kv-accent-soft); }
.ipc-win .kv-icon { width: 1.2em; height: 1.2em; flex: none; color: var(--kv-ink-3); }
.ipc-win__text { display: flex; flex-direction: column; min-width: 0; }
.ipc-win__text b { font-size: 0.88em; font-weight: 650; }
.ipc-win__text small { font-size: 0.76em; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

// ---------------------------------------------------------------------------------------------------------------
// Panel

const SORTS = [
  ['anbefalt', 'Anbefalt'],
  ['pris-lav', 'Pris: lav–høy'],
  ['pris-hoy', 'Pris: høy–lav'],
  ['tilbud', 'Tilbud først'],
];

export class CatalogPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'catalog', title: 'Katalog', icon: 'sofa', side: 'left', width: 29, className: 'ipc-panel' });
    injectCss('ipc-css', CSS);
    _users++;
    // No warm-up during loading (review-perf-r1: 5.4 s inside Game.load). The small offscreen renderer is created
    // in idle time once the game runs (or on the first thumbnail request, whichever comes first).
    this._scheduleWarmUp();
    this.cat = editor.catalog;
    this.category = this.cat.CATEGORIES.find((c) => c.key !== 'solskjerming')?.key || 'lenestol';
    this.sub = null;
    this.sort = 'anbefalt';
    this.query = '';
    this.detail = null; // { product, vi }
    this.cardVariant = new Map(); // productId → variant index shown on the card
    this._listScroll = 0;
    this._pending = null; // { productId, vi, until } – shading waiting for a window click («Velg vindu»)
    this._offSel = editor.events.on?.('select', ({ selected }) => {
      const pend = this._pending;
      if (!pend || selected?.kind !== 'window' || !selected.windowId) return;
      if (performance.now() > pend.until) {
        this._pending = null;
        return;
      }
      const prod = this.cat.getProduct(pend.productId);
      // after Editor.select has opened the window panel on that window
      const vi = this.detail?.product?.id === pend.productId ? this.detail.vi : pend.vi;
      queueMicrotask(() => prod && this.applyToWindow(prod, vi, selected.windowId));
    });

    // search
    this.searchInput = h('input.ip-input', { type: 'text', placeholder: 'Søk i hele katalogen …', 'aria-label': 'Søk i katalogen', spellcheck: false, autocomplete: 'off' });
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.clearBtn.hidden = !this.query;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._renderList(), 120);
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.searchInput.blur();
    });
    this.clearBtn = h('button.ipc-search__clear', { type: 'button', hidden: true, title: 'Tøm søket', 'aria-label': 'Tøm søket', on: { click: () => {
      this.searchInput.value = '';
      this.query = '';
      this.clearBtn.hidden = true;
      this._renderList();
    } } }, svg(ICONS.close));
    this.searchEl = h('div.ipc-search', {}, svg(SEARCH_ICON), this.searchInput, this.clearBtn);

    // categories
    this.catEls = new Map();
    this.catsEl = h('div.ipc-cats', { role: 'tablist', 'aria-label': 'Kategorier' }, this.cat.CATEGORIES.map((c) => {
      const n = this.cat.products(c.key).length;
      const b = h(`button.ipc-chip${c.key === 'solskjerming' ? '.ipc-chip--ext' : ''}`, {
        type: 'button',
        role: 'tab',
        title: c.key === 'solskjerming' ? 'Solskjerming velges per vindu – åpner Vinduer' : `${c.label} (${n})`,
        on: { click: () => this.setCategory(c.key) },
      }, ICONS[c.icon] ? svg(ICONS[c.icon]) : null, h('span', { text: c.label }), c.key === 'solskjerming' ? null : h('small', { text: String(n) }));
      this.catEls.set(c.key, b);
      return b;
    }));

    this.subsEl = h('div.ipc-subs');
    this.sortCtl = select({ options: SORTS, value: this.sort, onChange: (v) => {
      this.sort = v;
      this.sortCtl.select.blur();
      this._renderList();
    } });
    this.sortCtl.select.setAttribute('aria-label', 'Sorter');
    this.countEl = h('div.ipc-count');
    this.toolsEl = h('div.ipc-tools', {}, this.countEl, h('div.ipc-sort', {}, this.sortCtl.select));
    this.grid = h('div.ipc-grid');
    this.listView = h('div.ipc-list', {}, this.searchEl, this.catsEl, this.subsEl, this.toolsEl, this.grid);
    this.detailView = h('div.ipc-detail', { hidden: true });
    this.body.append(this.listView, this.detailView);

    this.observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          this.observer.unobserve(en.target);
          en.target._loadThumb?.();
        }
      }, { root: this.body, rootMargin: '220px 0px' })
      : null;

    this._paintCats();
    this._renderList();
  }

  /** Creates the thumbnail renderer in idle time after the game has started (cheap now: no environment map). */
  _scheduleWarmUp() {
    if (_thumbs?.renderer || typeof window === 'undefined') return;
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 4000 }) : (fn) => setTimeout(fn, 200);
    const check = () => {
      this._warmTimer = 0;
      if (this._disposed || _thumbs?.renderer) return;
      const g = this.editor.game;
      if (g && (g.running === false || g.paused)) {
        this._warmTimer = setTimeout(check, 2000);
        return;
      }
      idle(() => {
        if (!this._disposed) thumbs().warmUp();
      });
    };
    this._warmTimer = setTimeout(check, 3000);
  }

  /**
   * @param {string|{ category?: string, productId?: string, query?: string }} [arg]
   */
  onOpen(arg) {
    if (typeof arg === 'string') this.setCategory(arg, { silent: true });
    else if (arg && typeof arg === 'object') {
      if (arg.category) this.setCategory(arg.category, { silent: true });
      if (arg.query != null) {
        this.query = String(arg.query);
        this.searchInput.value = this.query;
        this._renderList();
      }
      if (arg.productId) {
        const p = this.cat.getProduct(arg.productId);
        if (p) this.showDetail(p, arg.variantIndex);
      }
    }
  }

  onClose() {
    thumbs().cancelPending((k) => k.endsWith(`|${THUMB_W}x${THUMB_H}`));
  }

  /**
   * Switches category (Solskjerming opens the WindowPanel instead).
   * @param {string} key
   */
  setCategory(key, { silent = false } = {}) {
    if (key === 'solskjerming') {
      if (silent) return;
      this.close();
      this.editor.ui.toolbar?.exitCompare?.({ quiet: true });
      this.editor.ui.window?.open?.();
      return;
    }
    if (!this.cat.CATEGORIES.some((c) => c.key === key)) return;
    const changed = key !== this.category || this.query;
    this.category = key;
    this.sub = null;
    if (this.query) {
      this.query = '';
      this.searchInput.value = '';
      this.clearBtn.hidden = true;
    }
    this._paintCats();
    if (this.detail) this._hideDetail();
    if (changed) {
      thumbs().cancelPending((k) => k.endsWith(`|${THUMB_W}x${THUMB_H}`));
      this.body.scrollTop = 0;
    }
    this._renderList();
  }

  _paintCats() {
    for (const [k, b] of this.catEls) {
      const on = !this.query && k === this.category;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  /** Products to show: search (all categories) or the current category, filtered and sorted. */
  _products() {
    let list = this.query.trim() ? this.cat.search(this.query) : this.cat.products(this.category);
    if (!this.query.trim() && this.sub) list = list.filter((p) => p.subcategory === this.sub);
    const price = (p) => priceInfo(this.cat, p, this.cardVariant.get(p.id) ?? p.defaultVariant).price ?? Infinity;
    if (this.sort === 'pris-lav') list = [...list].sort((a, b) => price(a) - price(b));
    else if (this.sort === 'pris-hoy') list = [...list].sort((a, b) => (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a)));
    else if (this.sort === 'tilbud') list = [...list].sort((a, b) => priceInfo(this.cat, b, b.defaultVariant).discount - priceInfo(this.cat, a, a.defaultVariant).discount);
    return list;
  }

  _renderSubs() {
    const searching = !!this.query.trim();
    const all = searching ? [] : this.cat.products(this.category);
    const subs = [...new Set(all.map((p) => p.subcategory).filter(Boolean))];
    if (subs.length < 2) {
      this.subsEl.replaceChildren();
      return;
    }
    const chip = (value, label, n) => h(`button.ipc-chip${this.sub === value ? '.is-active' : ''}`, { type: 'button', on: { click: () => {
      this.sub = value;
      this._renderList();
    } } }, h('span', { text: label }), n != null ? h('small', { text: String(n) }) : null);
    this.subsEl.replaceChildren(
      chip(null, 'Alle'),
      ...subs.map((s) => chip(s, this.cat.SUBCATEGORY_LABELS?.[s] || s, all.filter((p) => p.subcategory === s).length)),
    );
  }

  _renderList() {
    this._paintCats();
    this._renderSubs();
    const list = this._products();
    const searching = !!this.query.trim();
    const label = searching ? `${list.length} treff på «${this.query.trim()}»` : `${list.length} produkter${this.sub ? ` · ${this.cat.SUBCATEGORY_LABELS?.[this.sub] || this.sub}` : ''}`;
    this.countEl.textContent = label;
    this.observer?.disconnect();
    if (!list.length) {
      this.grid.replaceChildren(h('div.ipc-empty', {}, emptyState(searching ? 'Ingen produkter passer søket. Prøv et annet ord, for eksempel «bouclé», «eik» eller «IKEA».' : 'Ingen produkter her ennå.', 'info')));
      return;
    }
    this.grid.replaceChildren(...list.map((p) => this._card(p)));
  }

  _card(p) {
    const vi = this.cardVariant.get(p.id) ?? p.defaultVariant ?? 0;
    const info = priceInfo(this.cat, p, vi);
    const img = h('img', { alt: '', decoding: 'async', draggable: false });
    const thumbEl = h('div.ipc-thumb.is-loading', {}, h('div.ipc-thumb__ph', {}, svg(ICONS[this.cat.CATEGORIES.find((c) => c.key === p.category)?.icon] || ICONS.sofa)), img,
      h('div.ipc-flags', {}, info.onSale && info.discount >= 5 ? h('span.ipc-flag', { text: `−${info.discount} %` }) : null),
      p.verified ? h('span.ipc-verified', { title: `Verifisert: ${p.verifiedNote || 'pris og mål er sjekket hos butikken'}` }, svg(ICONS.check)) : null,
    );
    let card = null;
    const setThumb = (variant) => {
      const cached = cachedThumbnail(p, variant);
      if (cached) {
        img.src = cached;
        img.classList.add('is-ready');
        thumbEl.classList.remove('is-loading');
        return;
      }
      thumbEl.classList.add('is-loading');
      thumbnail(p, variant).then((url) => {
        if (url === undefined) {
          // cancelled (category switched / panel closed): load again when the card is seen next time
          if (card?.isConnected) this.observer?.observe(card);
          return;
        }
        if ((this.cardVariant.get(p.id) ?? p.defaultVariant ?? 0) !== variant) return;
        thumbEl.classList.remove('is-loading');
        if (url) {
          img.src = url;
          img.classList.add('is-ready');
        }
      });
    };
    const priceSlot = h('div.ipc-priceslot', {}, priceEl(info));
    const max = 7;
    const sw = h('div.ipc-swatches', { 'aria-label': 'Farger' });
    const paintSwatches = (cur) => {
      sw.replaceChildren(...p.variants.slice(0, max).map((v, i) => variantSwatch(p, v, i, { active: i === cur, onPick: (j) => {
        this.cardVariant.set(p.id, j);
        paintSwatches(j);
        priceSlot.replaceChildren(priceEl(priceInfo(this.cat, p, j)));
        setThumb(j);
      } })), ...(p.variants.length > max ? [h('span.ipc-more', { text: `+${p.variants.length - max}` })] : []));
    };
    paintSwatches(vi);
    const isShading = p.category === 'solskjerming';
    const placeBtn = button({
      label: isShading ? 'Velg vindu' : 'Plasser',
      icon: isShading ? 'blinds' : null,
      variant: 'primary',
      size: 'sm',
      title: isShading ? 'Solskjerming henges på et vindu – velg vinduet etterpå' : `Plasser ${p.name} i stua`,
      onClick: (e) => {
        e.stopPropagation();
        this.place(p, this.cardVariant.get(p.id) ?? p.defaultVariant ?? 0);
      },
    });
    if (!isShading) placeBtn.prepend(svg(PLUS_ICON));
    const variantName = p.variants?.[vi]?.name;
    card = h('article.ipc-card', {
      tabIndex: 0,
      role: 'button',
      'aria-label': `${p.name}, ${p.store}${info.price != null ? `, ${fmtNok(info.price)}` : ''}`,
      title: variantName ? `${p.name} – ${variantName}` : p.name,
      on: {
        click: (e) => {
          if (e.target.closest('button')) return;
          this.showDetail(p, this.cardVariant.get(p.id) ?? p.defaultVariant ?? 0);
        },
        keydown: (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
            e.preventDefault();
            this.showDetail(p, this.cardVariant.get(p.id) ?? p.defaultVariant ?? 0);
          }
        },
      },
    },
    thumbEl,
    h('div.ipc-body', {},
      h('div.ipc-name', { text: p.name }),
      h('div.ipc-store', { text: [p.store, p.brand && p.brand !== p.store ? p.brand : null].filter(Boolean).join(' · ') }),
      sw,
      h('div.ipc-foot', {}, priceSlot, placeBtn),
    ));
    card._loadThumb = () => setThumb(this.cardVariant.get(p.id) ?? p.defaultVariant ?? 0);
    const cached = cachedThumbnail(p, vi);
    if (cached) card._loadThumb();
    else if (this.observer) this.observer.observe(card);
    else card._loadThumb();
    return card;
  }

  /**
   * Shows the detail view of a product.
   * @param {object} p  product
   * @param {number} [vi] variant index
   */
  showDetail(p, vi = p.defaultVariant ?? 0) {
    if (!this.detail) this._listScroll = this.body.scrollTop;
    if (this._pending && this._pending.productId !== p.id) this._pending = null;
    this.detail = { product: p, vi: clampVariant(p, vi) };
    this.listView.hidden = true;
    this.detailView.hidden = false;
    this.panel.setTitle(this.cat.categoryLabel(p.category) || 'Katalog');
    this._renderDetail();
    this.body.scrollTop = 0;
  }

  _hideDetail() {
    this.detail = null;
    this._pending = null;
    this.detailView.hidden = true;
    this.detailView.replaceChildren();
    this.listView.hidden = false;
    this.foot.replaceChildren();
    this.foot.hidden = true;
    this.panel.setTitle('Katalog');
    this.body.scrollTop = this._listScroll || 0;
  }

  _renderDetail() {
    const { product: p, vi } = this.detail;
    const v = p.variants?.[vi];
    const info = priceInfo(this.cat, p, vi);
    const big = { w: 640, h: 480, priority: true };
    const img = h('img', { alt: `${p.name} – ${v?.name || ''}` });
    const thumbBox = h('div.ipc-detail__thumb.ipc-thumb.is-loading', {}, h('div.ipc-thumb__ph', {}, svg(ICONS.sofa)), img,
      h('div.ipc-flags', {}, info.onSale && info.discount >= 5 ? h('span.ipc-flag', { text: `−${info.discount} %` }) : null));
    const small = cachedThumbnail(p, vi);
    if (small) {
      img.src = small;
      img.classList.add('is-ready');
    }
    thumbnail(p, vi, big).then((url) => {
      if (!this.detail || this.detail.product !== p || this.detail.vi !== vi) return;
      thumbBox.classList.remove('is-loading');
      if (url) {
        img.src = url;
        img.classList.add('is-ready');
      }
    });

    // the store's own product photo (hot-linked; hidden when it cannot be loaded)
    let photo = null;
    if (p.imageUrl) {
      const ph = h('img', { alt: `Produktbilde fra ${p.store}`, loading: 'lazy', referrerPolicy: 'no-referrer', src: p.imageUrl });
      photo = h('div.ipc-detail__photo', {}, ph, h('span', { text: `Produktbilde fra ${p.store}. 3D-modellen over er laget etter målene og fargen du har valgt.` }));
      ph.addEventListener('error', () => photo.remove());
    }

    const variants = (p.variants || []).length > 1
      ? h('div.ip-section', {}, h('h3.ip-section__title', { text: `Farger og varianter (${p.variants.length})` }),
        h('div.ipc-variants', { role: 'listbox' }, p.variants.map((vv, i) => {
          const pi = priceInfo(this.cat, p, i);
          const [a, b] = variantColors(p, vv);
          return h(`button.ipc-variant${i === vi ? '.is-active' : ''}`, {
            type: 'button',
            role: 'option',
            'aria-selected': i === vi ? 'true' : 'false',
            on: { click: () => {
              this.detail.vi = i;
              this.cardVariant.set(p.id, i);
              const st = this.body.scrollTop;
              this._renderDetail();
              this.body.scrollTop = st;
            } },
          }, h('span.ip-swatch', { style: { background: b ? `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` : a } }), h('span', { text: vv.name || `Variant ${i + 1}` }),
          pi.price != null && pi.price !== info.price ? h('small', { text: fmtNok(pi.price) }) : null);
        })))
      : null;

    const facts = [];
    facts.push(['Mål', dimsText(p.dims)]);
    if (p.params?.seatH) facts.push(['Setehøyde', fmtCm(p.params.seatH)]);
    if (p.params?.drop && p.mount === 'ceiling') facts.push(['Høyde (oppheng)', fmtCm(p.params.drop)]);
    else if (p.mount === 'ceiling' && typeof p.params?.dropDefault === 'number') facts.push(['Ledning', `henger ${fmtCm(p.params.dropDefault)} under taket${typeof p.params.maxDrop === 'number' ? ` (maks ${fmtCm(p.params.maxDrop)})` : ''}`]);
    if (p.light) facts.push(['Lys', [p.light.lumens ? `${fmtNumber(p.light.lumens, 0)} lm` : null, p.light.colorK ? `${fmtNumber(p.light.colorK, 0)} K` : null, p.light.bulb || null, p.light.dimmable ? 'dimbar' : null].filter(Boolean).join(' · ') || 'Ja']);
    facts.push(...typeFacts(p, this.cat, vi));
    if (p.absorption) {
      let txt = `ca. ${fmtNumber(p.absorption, 2)} m² Sabine`;
      try {
        // the room the piece would be placed in: the one the reverberation badge shows (hele-huset §5.4)
        const roomId = this.editor.ui?.acoustics?.roomId ?? LIVING_ROOM_ID;
        const r = roomId === LIVING_ROOM_ID ? this.editor.acoustics() : acousticsFor(this.editor.design, this.editor.home, roomId);
        const next = rt60For(r.absorption + p.absorption, r.volume);
        const where = r.roomId && r.roomId !== LIVING_ROOM_ID ? ` i rommet (${r.roomName})` : '';
        txt += ` – etterklangen${where} går fra ${fmtNumber(r.rt60, 2)} til ${fmtNumber(next, 2)} s`;
      } catch {
        /* acoustics optional */
      }
      facts.push(['Demper lyd', txt]);
    }
    if (v?.name) facts.push(['Valgt variant', v.name]);

    const badges = [];
    if (p.verified) badges.push(Object.assign(badge('Verifisert', 'ok'), { title: p.verifiedNote || 'Pris og mål er sjekket hos butikken' }));
    if (info.onSale) badges.push(badge(info.discount >= 1 ? `Tilbud −${info.discount} %` : 'Tilbud', 'danger'));
    if (p.subcategory) badges.push(badge(this.cat.SUBCATEGORY_LABELS?.[p.subcategory] || p.subcategory));

    this.detailView.replaceChildren(...[
      button({ label: 'Tilbake', icon: 'back', variant: 'ghost', size: 'sm', onClick: () => this._hideDetail() }),
      thumbBox,
      photo,
      h('h3', { text: p.name }),
      h('div.ipc-detail__sub', {}, h('span', { text: [p.brand, p.store].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') }), ...badges),
      h('div.ipc-detail__price', {}, priceEl(info, { big: true })),
      p.priceNote ? h('p.ipc-note', { text: p.priceNote }) : null,
      variants,
      isShadingProduct(p) ? this._windowsSection(p, vi) : null,
      p.description ? h('div.ip-section', {}, h('h3.ip-section__title', { text: 'Beskrivelse' }), h('p.ipc-text', { text: p.description })) : null,
      p.why ? h('div.ip-section', {}, h('h3.ip-section__title', { text: 'Hvorfor den passer' }), h('p.ipc-text.ipc-why', { text: p.why })) : null,
      h('div.ip-section', {}, h('h3.ip-section__title', { text: 'Fakta' }), h('dl.ipc-facts', {}, facts.flatMap(([k, val]) => [h('dt', { text: k }), h('dd', { text: val })])),
        p.absorptionNote ? h('p.ipc-note', { text: p.absorptionNote, style: { margin: '0.6em 0 0' } }) : null),
    ].filter(Boolean));
    this.detailView.firstChild.classList.add('ipc-detail__back');

    const isShading = isShadingProduct(p);
    const place = button({ label: isShading ? 'Velg vindu' : 'Plasser i stua', icon: isShading ? 'blinds' : null, variant: 'primary', title: isShading ? 'Klikk deretter på et vindu i stua (eller velg i lista)' : undefined, onClick: () => this.place(p, this.detail?.vi ?? vi) });
    if (!isShading) place.prepend(svg(PLUS_ICON));
    this.foot.replaceChildren(storeLink(p, { variant: vi }) || h('span'), place);
    this.foot.hidden = false;
  }

  /**
   * Starts placing a product variant (closes the panel). Shading goes on a window instead: see chooseWindow().
   * @param {object} p
   * @param {number} vi
   */
  place(p, vi) {
    const e = this.editor;
    e.ui.toolbar?.exitCompare?.({ quiet: true });
    if (isShadingProduct(p)) {
      this.chooseWindow(p, vi);
      return;
    }
    const spec = this.cat.productToItemSpec(p, vi);
    if (!spec) return;
    this.close();
    e.startPlacing(spec);
  }

  /**
   * «Velg vindu» for a shading product: shows the product's window list (detail view) and keeps the product and
   * variant as pending – a click on a window in the room (or a button in the list) puts it on that window.
   * @param {object} p
   * @param {number} vi
   */
  chooseWindow(p, vi = p.defaultVariant ?? 0) {
    vi = clampVariant(p, vi);
    if (!this.detail || this.detail.product !== p || this.detail.vi !== vi) this.showDetail(p, vi);
    this._pending = { productId: p.id, vi, until: performance.now() + 60000 };
    this._renderDetail();
    requestAnimationFrame(() => this.detailView.querySelector('.ipc-wins')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
    this.editor.events.emit('toast', { text: `Klikk på et vindu i stua – eller velg i lista – for å sette på ${p.name}${p.variants?.[vi]?.name ? ` (${p.variants[vi].name})` : ''}.`, seconds: 4 });
  }

  /**
   * Puts a shading product variant on a window (one undo step) and opens the window panel on it, where colour,
   * mount and how far it is lowered are adjusted.
   * @param {object} p
   * @param {number} vi
   * @param {string} windowId
   * @returns {boolean}
   */
  applyToWindow(p, vi, windowId) {
    const e = this.editor;
    const win = (e.home?.windows || []).find((w) => w.id === windowId);
    if (!p || !win) return false;
    this._pending = null;
    e.ui.toolbar?.exitCompare?.({ quiet: true });
    const wp = e.ui.window;
    // the window panel builds the spec (mount per type, curtain span/length for this window) – open it on the window first
    if (e.selected?.kind !== 'window' || e.selected.windowId !== windowId) e.select({ kind: 'window', windowId });
    else if (!wp?.isOpen) wp?.open?.(windowId);
    let spec = null;
    try {
      spec = typeof wp?._specFor === 'function' ? wp._specFor(p, vi, e.design.windows?.[windowId] || null) : null;
    } catch (err) {
      console.warn('[catalog] window panel spec failed', err);
      spec = null;
    }
    spec ||= this.cat.productToShadingSpec?.(p, vi) || null;
    if (!spec) return false;
    const d = e.design;
    if (typeof d.transaction === 'function') d.transaction(`Solskjerming: ${p.name}`, () => d.setWindow(windowId, spec));
    else d.setWindow(windowId, spec);
    const vName = p.variants?.[vi]?.name;
    e.events.emit('toast', { text: `${p.name}${vName ? ` (${vName})` : ''} er satt på ${win.name.toLowerCase()}. Juster farge og hvor langt den er nede i panelet til høyre.`, seconds: 4 });
    e.events.emit('sfx', { name: 'place' });
    if (this.detail?.product === p) {
      const st = this.body.scrollTop;
      this._renderDetail();
      this.body.scrollTop = st;
    }
    return true;
  }

  /** The window list in a shading product's detail view. */
  _windowsSection(p, vi) {
    const e = this.editor;
    const wins = e.home?.windows || [];
    if (!wins.length) return null;
    const pending = this._pending && this._pending.productId === p.id;
    const cm = (v) => fmtNumber(Math.round(v * 100), 0);
    const rows = wins.map((w) => {
      const cur = e.design.windows?.[w.id] || null;
      const curP = cur?.productId ? this.cat.getProduct(cur.productId) : null;
      const here = cur?.productId === p.id && (cur.variantIndex ?? p.defaultVariant ?? 0) === vi;
      const status = here ? 'har denne nå' : curP ? `har ${curP.name.split(/[,(]/)[0].trim()}` : cur ? 'har egen solskjerming' : 'ingen solskjerming';
      return h(`button.ipc-win${here ? '.is-active' : ''}`, {
        type: 'button',
        title: `Sett ${p.name} på ${w.name.toLowerCase()}`,
        on: { click: () => this.applyToWindow(p, this.detail?.vi ?? vi, w.id) },
      }, svg(ICONS.blinds), h('span.ipc-win__text', {}, h('b', { text: w.name }), h('small', { text: `${cm(w.width)} × ${cm(w.height)} cm · ${status}` })));
    });
    return h('div.ip-section.ipc-wins', {}, h('h3.ip-section__title', { text: 'Sett på et vindu' }),
      h(`p.ipc-wins__hint${pending ? '.is-pending' : ''}`, { text: pending ? 'Klikk på et vindu i stua, eller velg her:' : 'Velg vinduet – prisen regnes ut for akkurat det vinduet:' }),
      h('div.ipc-wins__list', {}, rows));
  }

  dispose() {
    clearTimeout(this._searchTimer);
    clearTimeout(this._warmTimer);
    this._disposed = true;
    this._offSel?.();
    this.observer?.disconnect();
    _users = Math.max(0, _users - 1);
    // The thumbnail renderer and its cache outlive the game session (Avslutt → «Gå inn i stua» builds a new Editor):
    // the catalogue is static, so the rendered thumbnails stay valid and the second WebGL context is not rebuilt.
    if (!_users && _thumbs) _thumbs.cancelPending();
    super.dispose();
  }
}

export default CatalogPanel;
