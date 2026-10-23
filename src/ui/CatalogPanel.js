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
import { extraFacts } from '../catalog/facts.js';

/**
 * Product catalogue (ARCHITECTURE §12): categories (Solskjerming opens the WindowPanel), free-text search over
 * the whole catalogue, sub-category filter and sorting, product cards with a live-rendered 3D thumbnail in the
 * chosen variant's colours, name, store, price (sale price highlighted), one row of colour swatches and a «verifisert»
 * badge, «Plasser» → editor.startPlacing(productToItemSpec(product, variant)), and a detail view (description,
 * «Hvorfor den passer», dimensions, sound absorption, light, «Se hos <butikk>»).
 *
 * Two sizes (the button next to × in the header, remembered per browser in localStorage):
 *   compact  the side panel: search, a «Kategori» picker (drop-down grid) + sort, one row of sub filters, 2 columns
 *   large    most of the screen (the toolbar stays visible): categories as a sidebar, a 4+ column grid and a
 *            two-column detail view. «Plasser» closes the panel as before; «Velg vindu» and another panel opening
 *            on the right switch back to the compact panel for the moment, so the room can be clicked.
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
 *
 * Feature modules add cards shown first in the grid (addPinned – «Last opp eget bilde») and buttons in a product's
 * detail footer (addDetailAction – «Legg inn flere (rekke/rutenett) …»). A category with a CATEGORY_HINTS entry shows
 * one muted line under the sub filters that opens the category it names. Ceiling fittings with
 * userData.model.thumbView 'below' (downlights) are shot from below against a ceiling plate; light decals (a picture
 * light's wash, ceiling pools) are left out of every thumbnail.
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

    // a ceiling behind flush ceiling fittings (downlights): seen from below, so the trim and the lit lens read
    this.ceilingPlate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#eeebe5', roughness: 0.95 }));
    this.ceilingPlate.visible = false;
    scene.add(this.ceilingPlate);

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
    // models/spots.js: 'below' (a downlight seen from under the ceiling) | 'under' (a spot seen from below the front)
    const view = model.userData?.model?.thumbView || null;
    // light decals (a picture light's wash, ceiling pools) are light on a surface the studio does not have
    model.traverse((o) => {
      if (o.userData?.lightDecal || o.name === 'ceiling-pool') o.visible = false;
    });
    const holder = new THREE.Group();
    if (win) holder.add(win.root);
    else holder.add(model);
    this.scene.add(holder);
    const studio = this._studioMaterials(model);
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
      else if (mount === 'wall') dir = view === 'under' ? new THREE.Vector3(0.38, -0.3, 1) : new THREE.Vector3(0.38, 0.14, 1);
      else if (mount === 'ceiling') dir = view === 'below' ? new THREE.Vector3(0.42, -0.95, 0.8) : view === 'under' ? new THREE.Vector3(0.55, -0.32, 1) : new THREE.Vector3(0.55, 0.12, 1);
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
      // the ceiling plate fills the frame behind a downlight (not part of `model`: the framing is the fitting's own)
      const plate = this.ceilingPlate;
      plate.visible = mount === 'ceiling' && view === 'below';
      if (plate.visible) {
        const ps = Math.max(size.x, size.z) * 8 + 0.4;
        plate.scale.set(ps, 1, ps);
        plate.position.set(center.x, box.max.y + 0.0015, center.z);
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
      // the model gets its own materials back before it is disposed (the stand-ins are the studio's)
      for (const [o, m] of studio.swaps) o.material = m;
      for (const m of studio.temp) m.dispose();
      holder.removeFromParent();
      if (this.ceilingPlate) this.ceilingPlate.visible = false;
      if (win) {
        applyShading(win.info, null); // disposes the shading rig's own geometry/materials
        win.root.removeFromParent();
      } else disposeModel(model);
    }
  }

  /**
   * Thumbnail-only stand-ins for metal and mirror. The studio has no environment map (see _setup), so a metalness-1
   * material (chrome, steel, brass, bronze, mirror glass) has nothing to reflect and reads near-black – a «krom» or
   * «messing» variant looked like «svart». For the shot each such mesh gets a mostly diffuse copy with the same colour
   * and maps (metalness 0.3, roughness ≥ 0.35), so the variant's hex shows; mirror glass becomes a pale grey-blue. The
   * room keeps the real materials (its PMREM environment covers them). Copies of the shared, cached materials are kept
   * (no new shader program per thumbnail); copies of a model's own materials are disposed after the shot.
   * @returns {{ swaps: Array<[THREE.Mesh, THREE.Material|THREE.Material[]]>, temp: THREE.Material[] }}
   */
  _studioMaterials(root) {
    const swaps = [];
    const temp = [];
    if (!root) return { swaps, temp };
    const cache = (this._metalStandIns ||= new Map());
    const standIn = (m) => {
      if (!m || !m.isMeshStandardMaterial || !(m.metalness >= 0.5)) return m;
      const shared = !!(m.userData?.cached || m.userData?.shared);
      let s = shared ? cache.get(m.uuid) : null;
      if (s) return s;
      s = m.clone();
      if (m.userData?.kind === 'mirror') {
        s.color.set('#cdd6dc');
        s.metalness = 0.12;
        s.roughness = 0.2;
      } else {
        s.metalness = 0.3;
        s.roughness = Math.max(Number.isFinite(m.roughness) ? m.roughness : 0.5, 0.35);
      }
      s.userData = { ...(m.userData || {}), cached: false, shared: false, thumbStandIn: true };
      if (shared) cache.set(m.uuid, s);
      else temp.push(s);
      return s;
    };
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const orig = o.material;
      if (Array.isArray(orig)) {
        const next = orig.map(standIn);
        if (next.some((m, i) => m !== orig[i])) {
          swaps.push([o, orig]);
          o.material = next;
        }
      } else {
        const next = standIn(orig);
        if (next !== orig) {
          swaps.push([o, orig]);
          o.material = next;
        }
      }
    });
    return { swaps, temp };
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
    for (const m of this._metalStandIns?.values() || []) m.dispose();
    this._metalStandIns = null;
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
 * stands or hangs), hvilestoler (footstool / built-in footrest, swivel, headrest), and the rows of catalog/facts.js
 * (spots and downlights, art).
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
  // spots and downlights, art (catalog/facts.js)
  out.push(...extraFacts(p, P, { catalog, vi }));
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
const CHEVRON_ICON = '<svg class="kv-icon ipc-chev" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const EXPAND_ICON = '<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/></svg>';
const SHRINK_ICON = '<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.5V10h5.5M20 4l-6 6M10 19.5V14H4.5M4 20l6-6"/></svg>';
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
.ipc-panel .ip-panel__body { padding-top: 0; }
.ipc-expand { width: 2.1em; height: 2.1em; }
.ipc-expand .kv-icon { width: 1.1em; height: 1.1em; }
/* list header (search, category picker, sort, sub filters): stays at the top while the products scroll */
.ipc-filters { position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'search search' 'pick sort' 'subs subs';
  gap: 0.5em; padding: 0.75em 0 0.7em; background: var(--ip-panel-bg); }
.ipc-filters::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 0.65em; background: linear-gradient(var(--ip-panel-bg), rgba(14, 21, 30, 0)); pointer-events: none; }
.ipc-search { grid-area: search; position: relative; min-width: 0; }
.ipc-search .kv-icon { position: absolute; left: 0.65em; top: 50%; width: 1.05em; height: 1.05em; transform: translateY(-50%); color: var(--kv-ink-3); pointer-events: none; }
.ipc-search .ip-input { padding-left: 2.2em; height: 2.4em; }
.ipc-search__clear { position: absolute; right: 0.3em; top: 50%; transform: translateY(-50%); width: 1.8em; height: 1.8em; border: 0; border-radius: 50%; background: transparent; color: var(--kv-ink-3); display: grid; place-items: center; }
.ipc-search__clear:hover { background: var(--kv-surface-3); color: var(--kv-ink); }
.ipc-search__clear .kv-icon { position: static; transform: none; width: 0.95em; height: 0.95em; }
.ipc-title { grid-area: title; display: none; }
.ipc-pick { grid-area: pick; display: flex; align-items: center; gap: 0.5em; min-width: 0; height: 2.45em; padding: 0 0.55em 0 0.65em; border-radius: var(--kv-r-sm);
  border: 1px solid var(--kv-line-2); background: var(--kv-surface); color: var(--kv-ink); font-size: 0.86em; font-weight: 650; text-align: left; transition: background 0.15s, border-color 0.15s; }
.ipc-pick:hover, .ipc-pick[aria-expanded='true'] { background: var(--kv-surface-3); border-color: rgba(255, 255, 255, 0.26); }
.ipc-pick > .kv-icon:first-child { width: 1.2em; height: 1.2em; color: var(--kv-accent); }
.ipc-pick span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ipc-pick small { color: var(--kv-ink-3); font-weight: 600; font-variant-numeric: tabular-nums; }
.ipc-pick .ipc-chev { width: 1em; height: 1em; color: var(--kv-ink-3); transition: transform 0.15s; }
.ipc-pick[aria-expanded='true'] .ipc-chev { transform: rotate(180deg); }
.ipc-sort { grid-area: sort; width: 8.6em; }
.ipc-sort .ip-select { height: 2.45em; font-size: 0.86em; }
/* categories: a drop-down grid under the picker (compact), the sidebar list (large) */
.ipc-cats { position: absolute; left: 0; right: 0; z-index: 4; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 0.15em 0.3em;
  padding: 0.4em; border-radius: var(--kv-r); border: 1px solid var(--kv-line-2); background: #18222e; box-shadow: var(--kv-shadow); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.ipc-cat { display: flex; align-items: center; gap: 0.55em; min-width: 0; height: 2.35em; padding: 0 0.6em; border-radius: var(--kv-r-sm); border: 1px solid transparent;
  background: transparent; color: var(--kv-ink-2); font-size: 0.84em; font-weight: 620; text-align: left; transition: background 0.12s, color 0.12s; }
.ipc-cat .kv-icon { width: 1.25em; height: 1.25em; color: var(--kv-ink-3); }
.ipc-cat span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ipc-cat small { color: var(--kv-ink-4); font-size: 0.88em; font-weight: 600; font-variant-numeric: tabular-nums; }
.ipc-cat:hover { background: var(--kv-surface-2); color: var(--kv-ink); }
.ipc-cat:hover .kv-icon { color: var(--kv-ink-2); }
.ipc-cat.is-active { background: var(--kv-accent-soft); border-color: rgba(255, 181, 46, 0.32); color: var(--kv-accent-2); }
.ipc-cat.is-active .kv-icon { color: var(--kv-accent); }
.ipc-cat.is-active small { color: rgba(255, 210, 122, 0.7); }
.ipc-subs { grid-area: subs; display: flex; gap: 0.3em; overflow-x: auto; scrollbar-width: none; margin: -0.2em -0.2em; padding: 0.2em; }
.ipc-subs::-webkit-scrollbar { display: none; }
.ipc-subs:empty { display: none; }
/* the category's hint line (CATEGORY_HINTS): muted, a link on hover (.ipc-filters wins over .kv-scale button) */
.ipc-filters .ipc-hint { grid-column: 1 / -1; justify-self: start; max-width: 100%; margin: -0.1em 0 0; padding: 0; border: 0; background: none;
  color: var(--kv-ink-3); font-size: 0.78em; font-weight: 500; line-height: 1.4; text-align: left; cursor: pointer; }
.ipc-filters .ipc-hint:hover { color: var(--kv-accent-2); text-decoration: underline; text-underline-offset: 0.15em; }
.ipc-filters .ipc-hint[hidden] { display: none; }
.ipc-subs.is-more-right { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 2.2em), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 2.2em), transparent); }
.ipc-subs.is-more-left { -webkit-mask-image: linear-gradient(90deg, transparent, #000 2.2em); mask-image: linear-gradient(90deg, transparent, #000 2.2em); }
.ipc-subs.is-more-left.is-more-right { -webkit-mask-image: linear-gradient(90deg, transparent, #000 2.2em, #000 calc(100% - 2.2em), transparent); mask-image: linear-gradient(90deg, transparent, #000 2.2em, #000 calc(100% - 2.2em), transparent); }
.ipc-chip { flex: none; display: inline-flex; align-items: center; gap: 0.35em; height: 1.85em; padding: 0 0.65em; border-radius: 2em; border: 1px solid var(--kv-line-2);
  background: var(--kv-surface); color: var(--kv-ink-2); font-size: 0.76em; font-weight: 620; white-space: nowrap; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.ipc-chip:hover { background: var(--kv-surface-3); color: var(--kv-ink); }
.ipc-chip.is-active { background: var(--kv-accent-soft); border-color: rgba(255, 181, 46, 0.55); color: var(--kv-accent-2); }
.ipc-chip small { font-size: 0.85em; color: var(--kv-ink-4); font-weight: 600; }
.ipc-chip.is-active small { color: rgba(255, 210, 122, 0.7); }
.ipc-side, .ipc-main { min-width: 0; }
.ipc-side { display: none; }
.ipc-side__title { margin: 0 0 0.5em 0.75em; }
.ipc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5em, 1fr)); gap: 0.65em; padding-top: 0.15em; }
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
.ipc-flag { padding: 0.16em 0.48em; border-radius: 1em; font-size: 0.68em; font-weight: 800; letter-spacing: 0.02em; background: #d8432f; color: #fff; box-shadow: 0 0.15em 0.4em rgba(0,0,0,0.25); }
.ipc-flag--ok { background: rgba(255, 255, 255, 0.92); color: #1b7a49; display: inline-flex; align-items: center; gap: 0.2em; }
.ipc-flag--ok .kv-icon { width: 1.05em; height: 1.05em; }
.ipc-verified { position: absolute; right: 0.45em; top: 0.45em; width: 1.35em; height: 1.35em; border-radius: 50%; display: grid; place-items: center;
  background: rgba(255, 255, 255, 0.85); color: #1b7a49; box-shadow: 0 0.1em 0.3em rgba(0,0,0,0.18); }
.ipc-verified .kv-icon { width: 0.9em; height: 0.9em; stroke-width: 2.8; }
.ipc-body { display: flex; flex-direction: column; gap: 0.3em; padding: 0.5em 0.6em 0.55em; flex: 1; min-width: 0; }
.ipc-titles { display: flex; flex-direction: column; gap: 0.12em; min-height: 3.3em; min-width: 0; }
.ipc-name { font-weight: 650; font-size: 0.86em; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.ipc-store { font-size: 0.72em; line-height: 1.3; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ipc-swatches { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.3em; height: 1.5em; --ip-sw: 1.15em; padding: 0 0.12em; }
.ipc-swatches .ip-swatch { flex: none; border-width: 1.5px; }
.ipc-more { flex: none; display: inline-grid; place-items: center; height: 1.75em; padding: 0 0.45em; border-radius: 1em; background: var(--kv-surface-2); font-size: 0.68em; font-weight: 650; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.ipc-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.4em; margin-top: auto; min-height: 2.15em; }
.ipc-foot .kv-btn { flex: none; height: 2em; padding: 0 0.7em; font-size: 0.8em; gap: 0.4em; }
.ipc-foot .kv-btn .kv-icon { width: 1em; height: 1em; }
/* large catalogue: wide panel, categories as a sidebar, a wider product grid and a two-column detail view */
.ipc-panel.is-large { width: min(80em, calc(100% - 2 * var(--ip-gap))); height: calc(100% - var(--ip-gap) - var(--ip-bottom) - 0.4em); }
/* a panel already open on the right (Egenskaper, Handleliste …) stays uncovered */
#ui-root:has(.ip-panel--right.is-open) .ipc-panel.is-large { width: min(80em, calc(100% - 3 * var(--ip-gap) - 28em)); }
.ipc-panel.is-large .ip-panel__body { display: grid; grid-template-columns: 12.5em minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); padding: 0; overflow: hidden; }
.is-large .ipc-side, .is-large .ipc-main { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.18) transparent; }
.is-large .ipc-side { display: block; padding: 1em 0.6em 1em; border-right: 1px solid var(--kv-line); background: rgba(255, 255, 255, 0.015); }
.is-large .ipc-main { padding: 0 1.3em 1.3em; }
.is-large .ipc-cats { position: static; display: flex; flex-direction: column; gap: 0.08em; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; overflow: visible; max-height: none; }
.is-large .ipc-cat { flex: none; height: 1.95em; font-size: 0.86em; }
.is-large .ipc-filters { grid-template-columns: minmax(0, 1fr) minmax(12em, 19em) auto; grid-template-areas: 'title search sort' 'subs subs subs'; align-items: center; gap: 0.6em 0.7em; padding: 1em 0 0.8em; }
.is-large .ipc-title { display: flex; align-items: baseline; gap: 0.65em; min-width: 0; }
.ipc-title b { font: 720 1.3em/1.2 var(--kv-font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ipc-title small { flex: none; color: var(--kv-ink-3); font-size: 0.86em; font-variant-numeric: tabular-nums; }
.is-large .ipc-pick { display: none; }
.is-large .ipc-subs { flex-wrap: wrap; overflow: visible; -webkit-mask-image: none; mask-image: none; }
.is-large .ipc-grid { grid-template-columns: repeat(auto-fill, minmax(14em, 1fr)); gap: 0.9em; }
.is-large .ipc-body { padding: 0.6em 0.75em 0.7em; }
.is-large .ipc-name { font-size: 0.9em; }
.is-large .ipc-titles { min-height: 3.4em; }
.is-large .ipc-swatches { --ip-sw: 1.25em; height: 1.6em; }
.is-large .ipc-detail { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 0 1.8em; align-items: start; padding-top: 1em; }
.is-large .ipc-detail__back { grid-column: 1 / -1; justify-self: start; }
.is-large .ipc-detail__media { position: sticky; top: 1em; }
.is-large .ipc-detail__name { margin-top: 0; }
.ipc-detail { padding-top: 0.75em; }
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
.ipc-detail__name { margin: 0.75em 0 0.15em; font: 720 1.25em/1.2 var(--kv-font-display); }
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
.ipc-panel .ip-panel__foot { justify-content: space-between; flex-wrap: wrap; row-gap: 0.45em; }
.ipc-panel .ip-panel__foot > .ip-btn--primary { margin-left: auto; }
.ipc-foot-extra { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 0.4em; min-width: 0; }
.ipc-foot-extra > * { max-width: 100%; }
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

/** «Stor katalog» on/off, remembered per browser (the game must work without storage). */
const LARGE_KEY = 'interiorspillet.catalogLarge.v1';

function readLargePref() {
  try {
    return localStorage.getItem(LARGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLargePref(on) {
  try {
    localStorage.setItem(LARGE_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts for this session only */
  }
}

/** «1 produkt» / «24 produkter». */
const productsText = (n) => `${n} ${n === 1 ? 'produkt' : 'produkter'}`;

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
    /** Cards and detail buttons of feature modules (addPinned / addDetailAction). */
    this._pinned = [];
    this._detailActions = [];
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

    // categories: one list – a drop-down grid under the «Kategori» picker in the compact panel, the sidebar in the
    // large catalogue (moved between the two by _applyLayout)
    this.catEls = new Map();
    this.catsEl = h('div.ipc-cats', { id: 'ipc-cats', role: 'tablist', 'aria-label': 'Kategorier', on: { keydown: (e) => this._catsKey(e) } }, this.cat.CATEGORIES.map((c) => {
      const ext = c.key === 'solskjerming';
      const n = ext ? 0 : this.cat.products(c.key).length;
      const b = h(`button.ipc-cat${ext ? '.ipc-cat--ext' : ''}`, {
        type: 'button',
        role: 'tab',
        tabIndex: -1,
        title: ext ? 'Solskjerming velges per vindu – åpner Vinduer' : undefined,
        on: { click: () => this._pickCategory(c.key) },
      }, svg(c.iconSvg || ICONS[c.icon] || ICONS.sofa), h('span', { text: c.label }), h('small', { text: ext ? '↗' : String(n) }));
      this.catEls.set(c.key, b);
      return b;
    }));
    this.pickBtn = h('button.ipc-pick', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'ipc-cats', on: { click: () => (this._catsOpen ? this._closeCats() : this._openCats()) } });
    this.titleEl = h('div.ipc-title', { 'aria-live': 'polite' });

    this.subsEl = h('div.ipc-subs', { role: 'group', 'aria-label': 'Type', on: { scroll: () => this._subsFade() } });
    // a mouse wheel scrolls the one-line sub filter row sideways (compact panel)
    this.subsEl.addEventListener('wheel', (e) => {
      const el = this.subsEl;
      if (this.large || el.scrollWidth <= el.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }, { passive: false });
    this.sortCtl = select({ options: SORTS, value: this.sort, onChange: (v) => {
      this.sort = v;
      this.sortCtl.select.blur();
      this._renderList();
    } });
    this.sortCtl.select.setAttribute('aria-label', 'Sorter');
    // CATEGORY_HINTS: where something the category does not have lives instead (a click goes there)
    this.hintEl = h('button.ipc-hint', { type: 'button', hidden: true, on: { click: () => this._followHint() } });
    this.filtersEl = h('div.ipc-filters', {}, this.titleEl, this.searchEl, this.pickBtn, h('div.ipc-sort', {}, this.sortCtl.select), this.subsEl, this.hintEl, this.catsEl);
    this.filtersEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._catsOpen) return;
      // Esc closes the drop-down first (not the panel)
      e.preventDefault();
      e.stopPropagation();
      this._closeCats({ focus: true });
    });
    this.filtersEl.addEventListener('focusout', (e) => {
      if (this._catsOpen && !this.catsEl.contains(e.relatedTarget) && e.relatedTarget !== this.pickBtn) this._closeCats();
    });
    this._onDocDown = (e) => {
      if (!this.catsEl.contains(e.target) && !this.pickBtn.contains(e.target)) this._closeCats();
    };
    this.grid = h('div.ipc-grid');
    this.listView = h('div.ipc-list', {}, this.filtersEl, this.grid);
    this.detailView = h('div.ipc-detail', { hidden: true });
    this.sideEl = h('nav.ipc-side', { 'aria-label': 'Kategorier' }, h('h3.ip-section__title.ipc-side__title', { text: 'Kategorier' }));
    this.mainEl = h('div.ipc-main', {}, this.listView, this.detailView);
    this.body.append(this.sideEl, this.mainEl);

    // «Utvid katalogen» / «Mindre katalog» next to × in the header
    this.expandBtn = h('button.kv-iconbtn.ipc-expand', { type: 'button', on: { click: () => this.setLarge(!this.large) } });
    this.panel.head.insertBefore(this.expandBtn, this.panel.head.querySelector('.ip-panel__close'));
    // another panel opening on the right or at the bottom: back to the compact panel so both can be used (the
    // remembered choice stays – the next open is large again)
    this._offPanel = editor.events.on?.('panel', ({ id, open } = {}) => {
      if (!open || id === 'catalog' || !this.large || !this.isOpen) return;
      const side = this.editor.ui?.[id]?.panel?.side;
      if (side === 'right' || side === 'bottom') this.setLarge(false, { remember: false });
    });

    this.large = readLargePref();
    this._applyLayout();
  }

  /**
   * Adds a card shown first in the product grid (also when the list is empty).
   * fn({ panel, category, query, sub }) → HTMLElement|null (null = not in this view).
   * @returns {() => void} removes it
   */
  addPinned(fn) {
    this._pinned.push(fn);
    if (this.isOpen && !this.detail) this._renderList();
    return () => {
      const i = this._pinned.indexOf(fn);
      if (i >= 0) this._pinned.splice(i, 1);
    };
  }

  /**
   * Adds a button to a product's detail footer: fn({ panel, product, vi }) → HTMLElement|null.
   * @returns {() => void} removes it
   */
  addDetailAction(fn) {
    this._detailActions.push(fn);
    return () => {
      const i = this._detailActions.indexOf(fn);
      if (i >= 0) this._detailActions.splice(i, 1);
    };
  }

  /** Runs the feature hooks of a list (a failing one is left out and logged). */
  _extra(list, ctx) {
    return list.map((fn) => {
      try {
        return fn(ctx);
      } catch (err) {
        console.warn('[catalog] extension failed', err);
        return null;
      }
    }).filter(Boolean);
  }

  /** The category's hint line (CATEGORY_HINTS), hidden while searching. */
  _renderHint() {
    const hint = !this.query.trim() ? this.cat.CATEGORY_HINTS?.[this.category] : null;
    this.hintEl.hidden = !hint;
    this.hintEl.textContent = hint?.text || '';
    this.hintEl.title = hint ? `Gå til ${this.cat.categoryLabel?.(hint.goto) || hint.goto}` : '';
  }

  /** Opens the category (and sub filter) the hint line names. */
  _followHint() {
    const hint = this.cat.CATEGORY_HINTS?.[this.category];
    if (!hint?.goto) return;
    this.setCategory(hint.goto);
    if (hint.sub && this.cat.products(hint.goto).some((p) => p.subcategory === hint.sub)) {
      this.sub = hint.sub;
      this._renderList();
    }
  }

  /** The element that scrolls the product list and the detail view (the body; the main column when large). */
  get _scroller() {
    return this.large ? this.mainEl : this.body;
  }

  /** Thumbnails load when a card comes near the visible part of the scroller. */
  _makeObserver() {
    this.observer?.disconnect();
    this.observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          this.observer.unobserve(en.target);
          en.target._loadThumb?.();
        }
      }, { root: this._scroller, rootMargin: '220px 0px' })
      : null;
  }

  /**
   * Large catalogue on/off: the panel grows to most of the screen with the categories as a sidebar and a wider
   * product grid. The choice is remembered in this browser unless `remember` is false (a temporary switch back,
   * e.g. to click a window in the room).
   * @param {boolean} on
   */
  setLarge(on, { remember = true } = {}) {
    on = !!on;
    if (remember) writeLargePref(on);
    if (on === this.large) return;
    this.large = on;
    this._applyLayout();
  }

  _applyLayout() {
    const on = this.large;
    this._closeCats();
    this.el.classList.toggle('is-large', on);
    const label = on ? 'Mindre katalog' : 'Utvid katalogen';
    this.expandBtn.replaceChildren(svg(on ? SHRINK_ICON : EXPAND_ICON));
    this.expandBtn.title = label;
    this.expandBtn.setAttribute('aria-label', label);
    this.expandBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.catsEl.setAttribute('aria-orientation', on ? 'vertical' : 'horizontal');
    if (on) {
      this.catsEl.hidden = false;
      this.sideEl.append(this.catsEl);
    } else {
      this.catsEl.hidden = true;
      this.filtersEl.append(this.catsEl);
    }
    // the scroll container changed: thumbnails observe the new one, cards are rebuilt for the new size
    this._listScroll = 0;
    this.body.scrollTop = 0;
    this.mainEl.scrollTop = 0;
    this._makeObserver();
    this._renderList();
    if (on) this.catEls.get(this.category)?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Opens the category drop-down (compact panel) and focuses the current category. */
  _openCats() {
    if (this.large || this._catsOpen) return;
    this._catsOpen = true;
    const top = this.pickBtn.offsetTop + this.pickBtn.offsetHeight + 4;
    this.catsEl.style.top = `${top}px`;
    this.catsEl.style.maxHeight = `${Math.max(160, this.body.clientHeight - top - 10)}px`;
    this.catsEl.hidden = false;
    this.pickBtn.setAttribute('aria-expanded', 'true');
    const cur = (!this.query.trim() && this.catEls.get(this.category)) || this.catsEl.querySelector('button');
    cur?.focus({ preventScroll: true });
    cur?.scrollIntoView?.({ block: 'nearest' });
    document.addEventListener('pointerdown', this._onDocDown, true);
  }

  _closeCats({ focus = false } = {}) {
    if (!this._catsOpen) return;
    this._catsOpen = false;
    document.removeEventListener('pointerdown', this._onDocDown, true);
    this.pickBtn.setAttribute('aria-expanded', 'false');
    const had = this.catsEl.contains(document.activeElement);
    this.catsEl.hidden = true;
    if (focus || had) this.pickBtn.focus({ preventScroll: true });
  }

  _pickCategory(key) {
    this._closeCats({ focus: !this.large && this.catsEl.contains(document.activeElement) });
    this.setCategory(key);
  }

  /** Arrow keys / Home / End move between the categories (drop-down grid or sidebar list). */
  _catsKey(e) {
    const btns = [...this.catEls.values()];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    // columns of the drop-down grid: the buttons on the first row
    const cols = this.large ? 1 : Math.max(1, btns.filter((b) => b.offsetTop === btns[0].offsetTop).length);
    const step = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    let j;
    if (step) j = i + step;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = btns.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    btns[Math.max(0, Math.min(btns.length - 1, j))].focus();
  }

  /** Fades the edge of the one-line sub filter row where more chips are hidden. */
  _subsFade() {
    const el = this.subsEl;
    const more = !this.large && el.scrollWidth > el.clientWidth + 1;
    el.classList.toggle('is-more-left', more && el.scrollLeft > 2);
    el.classList.toggle('is-more-right', more && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
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
    // the remembered size (a temporary switch back to the compact panel ends when the panel closes)
    const large = readLargePref();
    if (large !== this.large) {
      this.large = large;
      this._applyLayout();
    }
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
    this._closeCats();
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
      this._scroller.scrollTop = 0;
    }
    this._renderList();
  }

  _paintCats() {
    const cur = this.query.trim() ? null : this.category;
    const tabbable = cur ?? this.catEls.keys().next().value;
    for (const [k, b] of this.catEls) {
      const on = k === cur;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      // one tab stop for the whole list (arrow keys move inside it)
      b.tabIndex = k === tabbable ? 0 : -1;
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
    const chip = (value, label, n) => h(`button.ipc-chip${this.sub === value ? '.is-active' : ''}`, { type: 'button', 'aria-pressed': this.sub === value ? 'true' : 'false', on: { click: () => {
      this.sub = value;
      this._renderList();
    } } }, h('span', { text: label }), n != null ? h('small', { text: String(n) }) : null);
    const scroll = this._subsFor === this.category ? this.subsEl.scrollLeft : 0;
    this._subsFor = this.category;
    this.subsEl.replaceChildren(
      chip(null, 'Alle'),
      ...subs.map((s) => chip(s, this.cat.SUBCATEGORY_LABELS?.[s] || s, all.filter((p) => p.subcategory === s).length)),
    );
    this.subsEl.scrollLeft = scroll;
  }

  /** What the list shows: the «Kategori» picker (compact) and the heading over the grid (large). */
  _renderHeading(list) {
    const q = this.query.trim();
    const c = this.cat.CATEGORIES.find((x) => x.key === this.category);
    const subLabel = this.sub ? this.cat.SUBCATEGORY_LABELS?.[this.sub] || this.sub : null;
    if (q) {
      this.pickBtn.replaceChildren(svg(SEARCH_ICON), h('span', { text: `Treff på «${q}»` }), h('small', { text: String(list.length) }), svg(CHEVRON_ICON));
      this.pickBtn.title = `${list.length} treff i hele katalogen – klikk for å velge en kategori`;
      this.pickBtn.setAttribute('aria-label', `${list.length} treff på «${q}». Velg kategori`);
      this.titleEl.replaceChildren(h('b', { text: `Søk: «${q}»` }), h('small', { text: `${list.length} treff i hele katalogen` }));
      return;
    }
    const n = this.cat.products(this.category).length;
    this.pickBtn.replaceChildren(svg(c?.iconSvg || ICONS[c?.icon] || ICONS.sofa), h('span', { text: c?.label || 'Kategori' }), h('small', { text: String(n) }), svg(CHEVRON_ICON));
    this.pickBtn.title = 'Velg kategori';
    this.pickBtn.setAttribute('aria-label', `Kategori: ${c?.label || ''} (${productsText(n)}). Velg kategori`);
    this.titleEl.replaceChildren(h('b', { text: subLabel ? `${c?.label} · ${subLabel}` : c?.label || 'Katalog' }), h('small', { text: productsText(list.length) }));
  }

  _renderList() {
    this._paintCats();
    this._renderSubs();
    this._renderHint();
    const list = this._products();
    const searching = !!this.query.trim();
    this._renderHeading(list);
    requestAnimationFrame(() => this._subsFade());
    this.observer?.disconnect();
    // feature cards first («Last opp eget bilde» …)
    const pinned = this._extra(this._pinned, { panel: this, category: this.category, query: this.query.trim(), sub: this.sub });
    if (!list.length) {
      this.grid.replaceChildren(...pinned, h('div.ipc-empty', {}, emptyState(searching ? 'Ingen produkter passer søket. Prøv et annet ord, for eksempel «bouclé», «eik» eller «IKEA».' : 'Ingen produkter her ennå.', 'info')));
      return;
    }
    this.grid.replaceChildren(...pinned, ...list.map((p) => this._card(p)));
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
    // one row of swatches: the first few (and the chosen one, if it is further down the list) + «+N»
    const max = this.large ? 8 : 6;
    const sw = h('div.ipc-swatches', { role: 'group', 'aria-label': 'Farger' });
    const paintSwatches = (cur) => {
      const vs = p.variants || [];
      const n = vs.length > max ? max - 1 : max;
      const shown = vs.map((v, i) => i).slice(0, n);
      if (cur >= n && cur < vs.length) shown[n - 1] = cur;
      const rest = vs.length - shown.length;
      sw.replaceChildren(...shown.map((i) => variantSwatch(p, vs[i], i, { active: i === cur, onPick: (j) => {
        this.cardVariant.set(p.id, j);
        paintSwatches(j);
        priceSlot.replaceChildren(priceEl(priceInfo(this.cat, p, j)));
        setThumb(j);
      } })), ...(rest > 0 ? [h('span.ipc-more', { text: `+${rest}`, title: `${rest} ${rest === 1 ? 'farge' : 'farger'} til – åpne produktet for å se alle` })] : []));
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
      h('div.ipc-titles', {},
        h('div.ipc-name', { text: p.name }),
        // the store (and the brand / collection in the large catalogue)
        h('div.ipc-store', { text: [p.store, this.large && p.brand && p.brand !== p.store ? p.brand : null].filter(Boolean).join(' · ') })),
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
    this._closeCats();
    if (!this.detail) this._listScroll = this._scroller.scrollTop;
    if (this._pending && this._pending.productId !== p.id) this._pending = null;
    this.detail = { product: p, vi: clampVariant(p, vi) };
    this.listView.hidden = true;
    this.detailView.hidden = false;
    this.panel.setTitle(this.cat.categoryLabel(p.category) || 'Katalog');
    this._renderDetail();
    this._scroller.scrollTop = 0;
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
    this._scroller.scrollTop = this._listScroll || 0;
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
              const st = this._scroller.scrollTop;
              this._renderDetail();
              this._scroller.scrollTop = st;
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
        const where = r.roomId && r.roomId !== LIVING_ROOM_ID ? ` i rommet (${r.roomName.replace(/ \((.+)\)$/, ', $1')})` : '';
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

    // picture | text: stacked in the compact panel, side by side in the large catalogue
    this.detailView.replaceChildren(
      button({ label: 'Tilbake', icon: 'back', variant: 'ghost', size: 'sm', onClick: () => this._hideDetail() }),
      h('div.ipc-detail__media', {}, thumbBox, photo),
      h('div.ipc-detail__info', {}, ...[
        h('h3.ipc-detail__name', { text: p.name }),
        h('div.ipc-detail__sub', {}, h('span', { text: [p.brand, p.store].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') }), ...badges),
        h('div.ipc-detail__price', {}, priceEl(info, { big: true })),
        p.priceNote ? h('p.ipc-note', { text: p.priceNote }) : null,
        variants,
        isShadingProduct(p) ? this._windowsSection(p, vi) : null,
        p.description ? h('div.ip-section', {}, h('h3.ip-section__title', { text: 'Beskrivelse' }), h('p.ipc-text', { text: p.description })) : null,
        p.why ? h('div.ip-section', {}, h('h3.ip-section__title', { text: 'Hvorfor den passer' }), h('p.ipc-text.ipc-why', { text: p.why })) : null,
        h('div.ip-section', {}, h('h3.ip-section__title', { text: 'Fakta' }), h('dl.ipc-facts', {}, facts.flatMap(([k, val]) => [h('dt', { text: k }), h('dd', { text: val })])),
          p.absorptionNote ? h('p.ipc-note', { text: p.absorptionNote, style: { margin: '0.6em 0 0' } }) : null),
      ].filter(Boolean)),
    );
    this.detailView.firstChild.classList.add('ipc-detail__back');

    const isShading = isShadingProduct(p);
    const place = button({ label: isShading ? 'Velg vindu' : 'Plasser i stua', icon: isShading ? 'blinds' : null, variant: 'primary', title: isShading ? 'Klikk deretter på et vindu i stua (eller velg i lista)' : undefined, onClick: () => this.place(p, this.detail?.vi ?? vi) });
    if (!isShading) place.prepend(svg(PLUS_ICON));
    // feature buttons («Legg inn flere …», «Med eget bilde …») get a row of their own above «Se hos …» and the
    // primary button, so the footer never runs out of the panel
    const extra = this._extra(this._detailActions, { panel: this, product: p, vi });
    this.foot.replaceChildren(...(extra.length ? [h('div.ipc-foot-extra', {}, extra)] : []), storeLink(p, { variant: vi }) || h('span'), place);
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
    // the windows must be visible to click on: back to the compact panel (the large one returns on the next open)
    if (this.large) this.setLarge(false, { remember: false });
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
      const st = this._scroller.scrollTop;
      this._renderDetail();
      this._scroller.scrollTop = st;
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
    this._offPanel?.();
    document.removeEventListener('pointerdown', this._onDocDown, true);
    this.observer?.disconnect();
    _users = Math.max(0, _users - 1);
    // The thumbnail renderer and its cache outlive the game session (Avslutt → «Gå inn i stua» builds a new Editor):
    // the catalogue is static, so the rendered thumbnails stay valid and the second WebGL context is not rebuilt.
    if (!_users && _thumbs) _thumbs.cancelPending();
    super.dispose();
  }
}

export default CatalogPanel;
