#!/usr/bin/env node
/**
 * Browser check of spots and downlights in the running game (design/lighting.md §7.3; MASTER §4.2 P01, D30, D31).
 * Needs the dev server (the shared test server: --port=5190). One headless Edge, one page, every step in it:
 *
 *   grid     warm-up fitting, then a 3 × 3 downlight grid under the slope + 8 singles in the spisestue: the number of
 *            shader programs and of lights of each type is unchanged (fixed pools, no recompiles); grid on vs off from
 *            the same camera: the floor under the grid is lit (ratio ≥ 1.25, ΔL ≥ 8 against a control point) and every
 *            lens glows (max ≥ 200, on − off ≥ 60)                                        → grid-on.png, grid-off.png
 *   slope    the grid seen from below on the 9° slope (eyeball: trims flush with the ceiling)          → slope.png
 *   picture  a picture light over the painting ex-f-maleri: the painting's upper third ≥ 1.15 × lit
 *                                                                                  → picture-on.png, picture-off.png
 *   a        a 4-head spot rail (tilt 50°) aimed at w-vest-stue: on − off ≥ 10 in a 1.5 × 1.0 m wall rectangle;
 *            4 lens glows
 *   b        a ceiling spot at 30° and a wall spot: ΔL ≥ 8 where each one aims
 *   c        a surface downlight 2 × 2 grid: every lens glows
 *   d        one downlight in bad, gang, soverom and kjellerstue (a camera in each): floor ΔL ≥ 8, the item's level is
 *            right and the fitting hangs at its own ceiling (a level the game leaves out, e.g. the basement while
 *            config.js HOUSE.basement is false, is skipped)
 *   e        realistic start (D30): the grid again at dimmer 0.4 with the built-ins on «auto» at 22:00 (a real
 *            «innfelt» product when the catalogue has one): lens on − off ≥ 40, under on/off ≥ 1.08     → e-on.png
 *   thumbs   then tools/thumbcheck.mjs --cat=spotter (when that tool exists)
 *
 * Every on / off pair is shot at the exposure of the «on» frame (the eye adaptation would otherwise hide the fitting's
 * own light). While models/spots.js has no model for an archetype (the foundation stub) the steps use synthetic model lights (the
 * light pools, budget and floor light are still checked); lens-glow and slope checks are then reported «pending».
 *
 *   node tools/spotcheck.mjs --port=5190 --lock --step=p01 [--only=grid,picture,a,b,c,d,e,slope,thumbs]
 *        [--out=.shots/<step>/spotcheck] [--browser=msedge|chrome] [--timeout=180000] [--no-thumbs]
 *
 * Exit 0 when every check that ran passed (pending ones do not fail), 1 on a failed check, 2 on a page / console
 * error. report.json and the PNGs go to --out (default .shots/<step>/spotcheck, without --step .shots/spotcheck).
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, ROOT, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = opt.port ?? 5190;
const step = opt.step ?? null;
const OUT = resolve(opt.out ?? join(ROOT, '.shots', ...(step ? [step] : []), 'spotcheck'));
const ALL = ['grid', 'slope', 'picture', 'a', 'b', 'c', 'd', 'e', 'thumbs'];
const only = opt.only ? new Set(opt.only.split(',').map((s) => s.trim())) : new Set(ALL);
if (opt['no-thumbs'] === 'true') only.delete('thumbs');
const timeout = Number(opt.timeout ?? 180000);
mkdirSync(OUT, { recursive: true });

const results = [];
/** One check: ok true/false, or null = pending (not run: the model is not there yet). */
const check = (stepId, name, ok, detail = '') => {
  results.push({ step: stepId, name, ok, detail });
  console.log(`  ${ok === null ? 'pend' : ok ? 'ok  ' : 'FAIL'} [${stepId}] ${name}${detail ? `  → ${detail}` : ''}`);
};
const savePng = (name, dataUrl) => {
  if (!dataUrl) return null;
  const p = join(OUT, name);
  writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  saved ${p}`);
  return p;
};

/** Page-side helpers (window.__sc), installed once the game is ready. */
const PAGE = `(async () => {
  const g = window.__game, sync = g.home.sync, DEG = Math.PI / 180;
  const THREE = await import(window.__hus.depUrl('three.js'));
  const sc = { THREE };
  sc.settle = async (n = 90) => {
    window.__hus.step(n);
    const t0 = performance.now();
    await new Promise((r) => { const t = () => (sync._gates.size && performance.now() - t0 < 30000 ? setTimeout(t, 50) : r()); t(); });
    window.__hus.step(30);
  };
  sc.lights = () => { const c = {}; g.scene.traverse((o) => { if (o.isLight) c[o.type] = (c[o.type] || 0) + 1; }); return c; };
  sc.programs = () => g.renderer.info.programs?.length ?? -1;
  sc.ceil = (x, z, floorY = 0) => g.home.ceilingHeightAt?.(x, z, floorY + 1) ?? floorY + 2.4;
  /** Camera (the player's eye) at feet, looking at a world point. */
  sc.look = (feet, target) => {
    g.player.teleport(new THREE.Vector3(...feet), 0, 0);
    const eye = g.camera.position.clone();
    const d = new THREE.Vector3(...target).sub(eye);
    const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    g.player.teleport(new THREE.Vector3(...feet), yaw, pitch);
    window.__hus.step(2);
  };
  sc.size = () => ({ w: g.renderer.domElement.width, h: g.renderer.domElement.height });
  sc.proj = (p) => {
    const v = (p.isVector3 ? p.clone() : new THREE.Vector3(...p)).project(g.camera);
    const { w, h } = sc.size();
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, vis: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  };
  sc.grab = () => { window.__hus.step(1); return g.renderer.domElement.toDataURL('image/png'); };
  /** The same view with the item switched off, at the exposure of the «on» shot (the eye adaptation would otherwise
   *  brighten the dark frame and hide the fitting's own light); the item stays off. */
  sc.offGrab = async (uid, frames = 60) => {
    const L = g.home.lighting;
    const S = L._S ?? L._Starget;
    sc.setOn(uid, false);
    await sc.settle(frames);
    const e0 = L.exposure;
    if (S > 0 && L._Starget > 0) L.setExposure(e0 * (S / L._Starget));
    await sc.settle(frames);
    const shot = sc.grab();
    L.setExposure(e0);
    await sc.settle(20);
    return shot;
  };
  /** rois: [{ kind: 'mean'|'max', x, y, s }] or { kind: 'rect', x0, y0, x1, y1 } → numbers (8-bit luminance). */
  sc.measure = async (url, rois) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return rois.map((r) => {
      const x0 = Math.max(0, Math.floor(r.kind === 'rect' ? Math.min(r.x0, r.x1) : r.x - r.s / 2));
      const y0 = Math.max(0, Math.floor(r.kind === 'rect' ? Math.min(r.y0, r.y1) : r.y - r.s / 2));
      const x1 = Math.min(img.width, Math.ceil(r.kind === 'rect' ? Math.max(r.x0, r.x1) : r.x + r.s / 2));
      const y1 = Math.min(img.height, Math.ceil(r.kind === 'rect' ? Math.max(r.y0, r.y1) : r.y + r.s / 2));
      if (x1 <= x0 || y1 <= y0) return null;
      const d = cx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let sum = 0, max = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += L; n++;
        if (L > max) max = L;
      }
      return r.kind === 'max' ? max : sum / Math.max(1, n);
    });
  };
  sc.add = (spec) => g.design.add(spec);
  sc.remove = (uids) => { for (const u of uids) g.design.remove(u); };
  sc.setOn = (uid, on, extra = {}) => { const it = g.design.get(uid); g.design.update(uid, { light: { ...(it.light || {}), on, ...extra } }); };
  /** World model lights of an item: [{ p: Vector3, d: Vector3 }]. */
  sc.lightsOf = (uid) => {
    const o = sync.getObject(uid);
    if (!o) return [];
    o.updateMatrixWorld(true);
    return (o.userData.model?.lights || []).map((l) => ({
      p: new THREE.Vector3(...(l.position || [0, 0, 0])).applyMatrix4(o.matrixWorld),
      d: l.direction ? new THREE.Vector3(...l.direction).transformDirection(o.matrixWorld) : new THREE.Vector3(0, -1, 0),
    }));
  };
  /** The model's lights, or synthetic ones (local) when the archetype has no model yet; → true when synthetic. */
  sc.ensure = (uid, synth) => {
    const e = sync._entries.get(uid);
    if (!e) return null;
    if (e.object.userData.model?.lights?.length) return false;
    e.object.userData.model = { ...(e.object.userData.model || {}), lights: synth.map((l) => ({ angle: 0.6, penumbra: 0.5, lumens: 100, colorK: 2700, emissiveMeshes: [], type: 'spot', ...l })) };
    sync._lights(e);
    return true;
  };
  /** Synthetic recessed heads of a rows × cols grid (item local, 5.5 mm under the ceiling). */
  sc.gridHeads = (rows, cols, dx, dz, o = {}) => {
    const out = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      out.push({ position: [(j - (cols - 1) / 2) * dx, -0.0055, (i - (rows - 1) / 2) * dz], direction: [0, -1, 0], cluster: 'downlight', fitting: 'recessed', ...o });
    }
    return out;
  };
  /** First surface hit along a ray (not the item itself, not a light helper). */
  sc.hit = (p, d, exclude) => {
    const rc = new THREE.Raycaster(p.clone().addScaledVector(d, 0.05), d.clone().normalize(), 0, 20);
    const ex = sync.getObject(exclude);
    const shown = (o) => { for (let x = o; x; x = x.parent) { if (!x.visible) return false; if (x === ex) return false; } return true; };
    for (const h of rc.intersectObjects(g.scene.children, true)) {
      if (!h.object.isMesh || !shown(h.object)) continue;
      const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      if (m && m.visible === false) continue;
      if (h.object.userData?.lightDecal || h.object.name === 'ceiling-pool') continue;
      return Object.assign(h.point.clone(), { what: h.object.name || h.object.parent?.name || h.object.type });
    }
    return null;
  };
  sc.wallOf = (id) => (g.home.walls || []).find((w) => w.id === id) || null;
  sc.env = (hour = 22) => g.design.setEnv({ hour, month: 10, day: 18, mode: 'auto' });
  window.__sc = sc;
  return { programs: sc.programs(), size: sc.size() };
})()`;

/** A custom spotter item spec (the test fitting). */
const SPEC = (arch, o = {}) => ({
  source: 'custom', name: `Test ${arch}`, category: 'spotter', archetype: arch, mount: 'ceiling', level: 'hoved',
  params: {}, colors: { shade: '#f2f0ec', inner: '#f2f0ec', base: '#f2f0ec', metal: '#2a2a2a' },
  materials: { shade: 'painted', inner: 'painted', base: 'painted', metal: 'black-metal' },
  light: { on: true, dimmer: 1, colorK: 2700, lumens: 450 }, ...o,
});

// ---- steps (each one page.evaluate; they clean up after themselves) ------------------------------------------------

/** grid (and e with realistic: true): programs / lights invariant, floor under the grid, lens glows. */
async function gridStep(page, { realistic = false } = {}) {
  return page.evaluate(async ({ realistic, SPEC_SRC }) => {
    const sc = window.__sc, g = window.__game;
    const SPEC = eval(SPEC_SRC);
    sc.env(22);
    const added = [];
    // a real «innfelt» product for the realistic start (the store's own defaults), else the test fitting
    let spec = SPEC('downlight', { dims: { w: 0.09, d: 0.09, h: 0.008 }, light: { on: true, dimmer: realistic ? 0.4 : 1, colorK: 2700, lumens: 450 } });
    let product = null;
    if (realistic) {
      product = (g.editor?.catalog ?? null)?.products?.('spotter')?.find((p) => p.archetype === 'downlight' && p.subcategory === 'innfelt') ?? null;
      if (product) {
        const s = g.editor.catalog.productToItemSpec(product, product.defaultVariant ?? 0);
        spec = { ...s, level: 'hoved', light: { ...(s.light || {}), on: true, dimmer: 0.4 } };
      }
    }
    const head = { ...spec.dims };
    const w = sc.add({ ...spec, position: [6.0, 2.4, 4.0] });
    added.push(w);
    await sc.settle();
    let synthetic = sc.ensure(w, sc.gridHeads(1, 1, 1, 1));
    await sc.settle(30);
    const before = { programs: sc.programs(), lights: sc.lights() };
    const uid = sc.add({ ...spec, position: [4.9, 2.6, 9.9], dims: { w: head.w + 2.2, d: head.d + 2.2, h: head.h }, params: { ...(spec.params || {}), gridRows: 3, gridCols: 3, gridDx: 1.1, gridDz: 1.1 } });
    added.push(uid);
    const singles = [];
    for (let i = 0; i < 8; i++) singles.push(sc.add({ ...spec, position: [3.8 + (i % 4) * 0.8, 2.6, 4.6 + Math.floor(i / 4) * 1.2] }));
    added.push(...singles);
    await sc.settle();
    synthetic = sc.ensure(uid, sc.gridHeads(3, 3, 1.1, 1.1)) || synthetic;
    for (const s of singles) sc.ensure(s, sc.gridHeads(1, 1, 1, 1));
    await sc.settle(60);
    const after = { programs: sc.programs(), lights: sc.lights() };
    // from the spisestue's end, looking into the stue: the floor under the grid's west row, and a control point on the
    // TV-stue's far wall (outside the grid's light). The open living room is ONE room for the seat cap (MASTER D5): seen
    // from deep inside the spisestue its own fittings rank first and the stue's grid would light as ambient only
    sc.look([4.3, 0, 7.2], [4.3, 0.3, 9.8]);
    await sc.settle(30);
    const pts = { under: sc.proj([4.3, 0.02, 9.6]), ctrl: sc.proj([0.6, 1.9, 11.9]) };
    const on = sc.grab();
    const off = await sc.offGrab(uid);
    const rois = [{ kind: 'mean', ...pts.under, s: 48 }, { kind: 'mean', ...pts.ctrl, s: 48 }];
    const fOn = await sc.measure(on, rois), fOff = await sc.measure(off, rois);
    // the lenses: from the spisestue's end of the stue, looking up at the grid
    sc.setOn(uid, true);
    sc.look([4.9, 0, 6.6], [4.9, 2.7, 9.9]);
    await sc.settle(60);
    const hp = sc.lightsOf(uid).map((l) => sc.proj(l.p));
    const lensOn = sc.grab();
    const lensOff = await sc.offGrab(uid);
    const hr = hp.map((p) => ({ kind: 'max', ...p, s: 9 }));
    const hOn = await sc.measure(lensOn, hr), hOff = await sc.measure(lensOff, hr);
    const mOn = [...fOn, ...hOn], mOff = [...fOff, ...hOff];
    const pts2 = { heads: hp };
    let slope = null;
    if (!realistic) {
      sc.setOn(uid, true);
      sc.look([4.2, 0, 8.4], [4.6, 2.6, 9.6]);
      await sc.settle(60);
      slope = sc.grab();
    }
    const state = g.home.lighting.itemLightState?.(uid) ?? null;
    sc.remove(added);
    await sc.settle(30);
    return { before, after, on, off, lensOn, slope, mOn, mOff, vis: [pts.under.vis, pts.ctrl.vis], heads: pts2.heads.length, headVis: pts2.heads.map((p) => p.vis), synthetic, product: product?.id ?? null, state };
  }, { realistic, SPEC_SRC: `(${SPEC.toString()})` });
}

/** picture: a picture light over ex-f-maleri, the painting's upper third on vs off. */
async function pictureStep(page) {
  return page.evaluate(async ({ SPEC_SRC }) => {
    const sc = window.__sc, g = window.__game, T = sc.THREE;
    const SPEC = eval(SPEC_SRC);
    sc.env(22);
    const art = g.design.get('ex-f-maleri');
    if (!art) return { error: 'ex-f-maleri finnes ikke i designet' };
    const dims = { w: 0.45, d: 0.2, h: 0.12 };
    const y = art.position[1] + art.dims.h / 2 + 0.03 + dims.h / 2;
    const uid = sc.add(SPEC('picture-light', {
      mount: 'wall', position: [art.position[0], y, art.position[2]], rotationDeg: art.rotationDeg ?? 180, attach: { ...art.attach }, dims,
      params: { washH: +(art.dims.h + 0.06).toFixed(2), washW: +(art.dims.w + 0.06).toFixed(2), artDepth: art.dims.d ?? 0.04 },
      light: { on: true, dimmer: 1, colorK: 2700, lumens: 250 },
    }));
    await sc.settle();
    const t = 40 * Math.PI / 180;
    const synthetic = sc.ensure(uid, [{ position: [0, -dims.h / 2, dims.d], direction: [0, -Math.cos(t), -Math.sin(t)], angle: 0.95, penumbra: 0.8, fitting: 'picture' }]);
    await sc.settle(60);
    // the painting's upper third (its front, toward the room)
    const n = art.attach?.normal ?? [0, 0, -1];
    const c = new T.Vector3(...art.position).addScaledVector(new T.Vector3(...n), (art.dims.d ?? 0.04) + 0.005);
    const right = new T.Vector3(-n[2], 0, n[0]);
    const top = art.dims.h / 2, third = art.dims.h / 3;
    const corners = [[-1, top], [1, top], [-1, top - third], [1, top - third]].map(([s, v]) => c.clone().addScaledVector(right, (s * art.dims.w) / 2 * 0.9).add(new T.Vector3(0, v - (v === top ? 0.02 : 0), 0)));
    const feet = new T.Vector3(...art.position).addScaledVector(new T.Vector3(...n), 2.6);
    sc.look([feet.x, 0, feet.z], [c.x, c.y + art.dims.h * 0.2, c.z]);
    await sc.settle(30);
    const ps = corners.map((p) => sc.proj(p));
    const roi = { kind: 'rect', x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), y1: Math.max(...ps.map((p) => p.y)) };
    const state = g.home.lighting.itemLightState?.(uid) ?? null;
    const on = sc.grab();
    const off = await sc.offGrab(uid);
    const [a] = await sc.measure(on, [roi]), [b] = await sc.measure(off, [roi]);
    // the realistic start: a new lamp comes at 40 % (catalog NEW_LAMP) – for the eye
    sc.setOn(uid, true, { dimmer: 0.4 });
    await sc.settle(90);
    const on40 = sc.grab();
    const [a40] = await sc.measure(on40, [roi]);
    sc.remove([uid]);
    await sc.settle(30);
    return { on, off, on40, a, b, a40, synthetic, visible: ps.every((p) => p.vis), state };
  }, { SPEC_SRC: `(${SPEC.toString()})` });
}

/** a: a 4-head rail aimed at w-vest-stue (wall rectangle ΔL), then its lenses from the wall side. */
async function railStep(page) {
  return page.evaluate(async ({ SPEC_SRC }) => {
    const sc = window.__sc, T = sc.THREE;
    const SPEC = eval(SPEC_SRC);
    sc.env(22);
    const x = 5.35, z = 10.6, tilt = 50;
    const uid = sc.add(SPEC('spot-track', { position: [x, 2.6, z], rotationDeg: 0, dims: { w: 1.2, d: 0.06, h: 0.16 },
      params: { heads: 4, tilt, aim: 'parallel', beamDeg: 30 }, light: { on: true, dimmer: 1, colorK: 2700, lumens: 900 } }));
    await sc.settle();
    const t = tilt * Math.PI / 180;
    const synthetic = sc.ensure(uid, [-0.45, -0.15, 0.15, 0.45].map((u) => ({ position: [u, -0.12, 0.03], direction: [0, -Math.cos(t), Math.sin(t)], angle: 0.35, penumbra: 0.4, cluster: 'fixture', fitting: 'track' })));
    await sc.settle(60);
    const L = sc.lightsOf(uid);
    const mean = L.reduce((v, l) => v.add(l.p), new T.Vector3()).multiplyScalar(1 / Math.max(1, L.length));
    const dir = L.reduce((v, l) => v.add(l.d), new T.Vector3()).normalize();
    // where the mean beam meets the wall plane z = 11.93
    const k = (11.93 - mean.z) / Math.max(1e-6, dir.z);
    const aim = mean.clone().addScaledVector(dir, k);
    aim.y = Math.min(Math.max(aim.y, 0.6), 2.0);
    const corners = [[-0.75, 0.5], [0.75, 0.5], [-0.75, -0.5], [0.75, -0.5]].map(([u, v]) => new T.Vector3(aim.x + u, aim.y + v, 11.92));
    sc.look([x, 0, 8.4], [aim.x, aim.y, 11.9]);
    await sc.settle(30);
    const ps = corners.map((p) => sc.proj(p));
    const roi = { kind: 'rect', x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), y1: Math.max(...ps.map((p) => p.y)) };
    const on = sc.grab();
    const off = await sc.offGrab(uid);
    const [a] = await sc.measure(on, [roi]), [b] = await sc.measure(off, [roi]);
    // lenses: from the wall side, looking up at the heads
    sc.setOn(uid, true);
    sc.look([x, 0, 11.5], [mean.x, mean.y, mean.z]);
    await sc.settle(60);
    const heads = sc.lightsOf(uid).map((l) => sc.proj(l.p));
    const lOn = sc.grab();
    const lOff = await sc.offGrab(uid);
    const rois = heads.map((p) => ({ kind: 'max', ...p, s: 9 }));
    const hOn = await sc.measure(lOn, rois), hOff = await sc.measure(lOff, rois);
    const merged = window.__game.home.lighting._items?.get(uid)?.length ?? null;
    sc.remove([uid]);
    await sc.settle(30);
    return { on, off, lOn, a, b, hOn, hOff, synthetic, heads: heads.length, merged, visible: ps.every((p) => p.vis) };
  }, { SPEC_SRC: `(${SPEC.toString()})` });
}

/** b: a ceiling spot at 30° and a wall spot – ΔL where each one aims. */
async function aimStep(page) {
  return page.evaluate(async ({ SPEC_SRC }) => {
    const sc = window.__sc, T = sc.THREE;
    const SPEC = eval(SPEC_SRC);
    sc.env(22);
    const out = [];
    const cases = [
      { name: 'takspot 30°', spec: SPEC('spot-ceiling', { position: [3.7, 2.6, 4.6], rotationDeg: 0, dims: { w: 0.08, d: 0.08, h: 0.16 }, params: { tilt: 30, beamDeg: 30 }, light: { on: true, dimmer: 1, colorK: 2700, lumens: 350 } }),
        synth: (() => { const t = 30 * Math.PI / 180; return [{ position: [0, -0.14, 0.03], direction: [0, -Math.cos(t), Math.sin(t)], angle: 0.35, penumbra: 0.4, cluster: 'downlight', fitting: 'spot' }]; })(),
        feet: [3.6, 0, 8.4] },
      { name: 'veggspot', spec: (() => {
        const w = sc.wallOf('w-vest-stue');
        const n = w ? [w.normal.x, 0, w.normal.y] : [0, 0, -1];
        return SPEC('spot-wall', { mount: 'wall', position: [6.4, 1.9, 11.93], rotationDeg: 180, attach: { wallId: 'w-vest-stue', normal: n }, dims: { w: 0.08, d: 0.16, h: 0.12 }, params: { heads: 1, tilt: 45, aimYaw: 0, beamDeg: 36 }, light: { on: true, dimmer: 1, colorK: 2700, lumens: 300 } });
      })(), synth: (() => { const t = 45 * Math.PI / 180; return [{ position: [0, 0, 0.14], direction: [0, -Math.cos(t), Math.sin(t)], angle: 0.4, penumbra: 0.4, cluster: 'fixture', fitting: 'wall-spot' }]; })(),
        feet: [4.0, 0, 9.9] },
    ];
    for (const cs of cases) {
      const uid = sc.add(cs.spec);
      await sc.settle();
      const synthetic = sc.ensure(uid, cs.synth);
      await sc.settle(60);
      const L = sc.lightsOf(uid)[0];
      const hit = L ? sc.hit(L.p, L.d, uid) : null;
      if (!hit) {
        out.push({ name: cs.name, error: 'fant ikke treffpunktet', synthetic });
        sc.remove([uid]);
        continue;
      }
      sc.look(cs.feet, [hit.x, hit.y, hit.z]);
      await sc.settle(30);
      const p = sc.proj(hit);
      const on = sc.grab();
      const off = await sc.offGrab(uid);
      const [a] = await sc.measure(on, [{ kind: 'mean', ...p, s: 24 }]), [b] = await sc.measure(off, [{ kind: 'mean', ...p, s: 24 }]);
      out.push({ name: cs.name, a, b, synthetic, vis: p.vis, hit: [hit.x, hit.y, hit.z].map((v) => +v.toFixed(2)), what: hit.what, on });
      sc.remove([uid]);
      await sc.settle(30);
    }
    return out;
  }, { SPEC_SRC: `(${SPEC.toString()})` });
}

/** c: a surface downlight 2 × 2 grid – every lens glows. */
async function surfaceStep(page) {
  return page.evaluate(async ({ SPEC_SRC }) => {
    const sc = window.__sc;
    const SPEC = eval(SPEC_SRC);
    sc.env(22);
    const head = { w: 0.09, d: 0.09, h: 0.1 };
    const uid = sc.add(SPEC('downlight-surface', { position: [3.9, 2.6, 6.4], dims: { w: head.w + 1.0, d: head.d + 1.0, h: head.h }, params: { gridRows: 2, gridCols: 2, gridDx: 1.0, gridDz: 1.0 }, light: { on: true, dimmer: 1, colorK: 2700, lumens: 500 } }));
    await sc.settle();
    const synthetic = sc.ensure(uid, sc.gridHeads(2, 2, 1.0, 1.0, { fitting: 'surface' }).map((l) => ({ ...l, position: [l.position[0], -0.1, l.position[2]] })));
    await sc.settle(60);
    sc.look([3.9, 0, 8.6], [3.9, 2.5, 6.4]);
    await sc.settle(30);
    const heads = sc.lightsOf(uid).map((l) => sc.proj(l.p));
    const on = sc.grab();
    const off = await sc.offGrab(uid);
    const rois = heads.map((p) => ({ kind: 'max', ...p, s: 9 }));
    const hOn = await sc.measure(on, rois), hOff = await sc.measure(off, rois);
    sc.remove([uid]);
    await sc.settle(30);
    return { on, hOn, hOff, synthetic, heads: heads.length, visible: heads.filter((p) => p.vis).length };
  }, { SPEC_SRC: `(${SPEC.toString()})` });
}

/** d: one downlight in each of four rooms on both levels. */
async function roomsStep(page) {
  return page.evaluate(async ({ SPEC_SRC }) => {
    const sc = window.__sc, g = window.__game;
    const SPEC = eval(SPEC_SRC);
    sc.env(22);
    const out = [];
    const rooms = [
      { id: 'bad', level: 'hoved', floorY: 0, at: [1.27, 1.11], feet: [1.27, 0, 1.95] },
      { id: 'gang', level: 'hoved', floorY: 0, at: [2.5, 3.4], feet: [2.5, 0, 2.5] },
      { id: 'soverom', level: 'hoved', floorY: 0, at: [2.6, 5.6], feet: [2.7, 0, 7.4] },
      { id: 'kjellerstue', level: 'kjeller', floorY: -2.55, at: [4.7, 8.3], feet: [4.7, -2.55, 10.3] },
    ];
    // a level the game leaves out (config.js HOUSE.basement false → layout.js withoutBasement) is skipped, not failed
    const removedLevels = new Set(g.home.layout?.spec?.removed?.levels || []);
    for (const r of rooms) {
      if (removedLevels.has(r.level)) {
        out.push({ id: r.id, level: r.level, skipped: true });
        continue;
      }
      const [x, z] = r.at;
      const uid = sc.add(SPEC('downlight', { level: r.level, position: [x, sc.ceil(x, z, r.floorY) - 0.05, z], dims: { w: 0.09, d: 0.09, h: 0.008 } }));
      await sc.settle();
      const synthetic = sc.ensure(uid, sc.gridHeads(1, 1, 1, 1));
      await sc.settle(60);
      const obj = g.home.sync.getObject(uid);
      const ceil = sc.ceil(x, z, r.floorY);
      const hang = obj ? obj.getWorldPosition(new sc.THREE.Vector3()).y : NaN;
      const lv = g.design.get(uid)?.level ?? null;
      const roomOfLight = g.home.lighting._items?.get(uid)?.[0]?.roomId ?? null;
      sc.look(r.feet, [x, r.floorY + 0.02, z]);
      await sc.settle(60);
      const p = sc.proj([x, r.floorY + 0.02, z]);
      const on = sc.grab();
      const off = await sc.offGrab(uid);
      const [a] = await sc.measure(on, [{ kind: 'mean', ...p, s: 48 }]), [b] = await sc.measure(off, [{ kind: 'mean', ...p, s: 48 }]);
      out.push({ id: r.id, level: r.level, lv, ceil, hang, roomOfLight, cam: g.home.lighting.cameraRoomId, a, b, synthetic, vis: p.vis, on });
      sc.remove([uid]);
      await sc.settle(30);
    }
    return out;
  }, { SPEC_SRC: `(${SPEC.toString()})` });
}

// ---- main ---------------------------------------------------------------------------------------------------------

const release = opt.lock === 'true' ? await acquireGpuLock({ label: `spotcheck ${step ?? ''}`.trim() }) : null;
let browserClosed = false;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'spotcheck') });
let pageErrors = 0;
const report = { when: new Date().toISOString(), port, out: OUT, steps: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(PAGE_HELPERS);
  await page.addInitScript(settingsInit({ autoResolution: false }));
  const watch = watchPage(page, { quiet: true });
  const t0 = Date.now();
  const resp = await page.goto(pageUrl('/?play=1&nowarm=1&nohelp=1', port), { waitUntil: 'domcontentloaded' }).catch((e) => {
    console.log(`[spotcheck] server ${port} is down? ${e.message}`);
    return null;
  });
  if (!resp) throw new Error(`server ${port} is down`);
  const err = await waitReady(page, timeout);
  if (err) {
    pageErrors++;
    console.log(`[page __error] ${err}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const ok = await page.evaluate(() => !!window.__game?.home);
  check('start', 'spillet er lastet (__game.home)', ok);
  if (!ok) throw new Error('no __game.home');
  await page.evaluate(() => window.__hus.step(30));
  const setup = await page.evaluate(PAGE);
  console.log(`[spotcheck] ready in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${setup.programs} programs`);
  report.setup = setup;

  if (only.has('grid') || only.has('slope')) {
    console.log('\n— grid: rutenett i stua + 8 enkeltspotter');
    const r = await gridStep(page);
    savePng('grid-on.png', r.on);
    savePng('grid-off.png', r.off);
    savePng('grid-lenses.png', r.lensOn);
    if (r.slope) savePng('slope.png', r.slope);
    const [uOn, cOn, ...hOn] = r.mOn, [uOff, cOff, ...hOff] = r.mOff;
    const tag = r.synthetic ? ' (syntetiske lys – spots.js mangler modellen)' : '';
    report.steps.grid = { before: r.before, after: r.after, under: [uOn, uOff], ctrl: [cOn, cOff], heads: hOn.map((v, i) => [v, hOff[i], r.headVis[i]]), synthetic: r.synthetic, state: r.state };
    if (only.has('grid')) {
      check('grid', `like mange shaderprogrammer (${r.before.programs} → ${r.after.programs})${tag}`, r.after.programs === r.before.programs);
      check('grid', 'like mange lys av hver type', JSON.stringify(r.after.lights) === JSON.stringify(r.before.lights), `${JSON.stringify(r.before.lights)} → ${JSON.stringify(r.after.lights)}`);
      check('grid', `gulv- og kontrollpunktet er i bildet`, r.vis.every(Boolean), JSON.stringify(r.vis));
      check('grid', `gulvet under rutenettet lyses opp: ${uOn?.toFixed(1)} / ${uOff?.toFixed(1)} ≥ 1,25`, uOn / Math.max(1e-6, uOff) >= 1.25);
      check('grid', `mot kontrollpunktet: ΔL ${((uOn - cOn) - (uOff - cOff)).toFixed(1)} ≥ 8`, (uOn - cOn) - (uOff - cOff) >= 8);
      if (r.synthetic) check('grid', 'linsene lyser (krever spots.js)', null);
      else {
        const seen = hOn.map((v, i) => i).filter((i) => r.headVis[i] && hOn[i] != null);
        const bad = seen.map((i) => (hOn[i] >= 200 && hOn[i] - hOff[i] >= 60 ? null : `${i}: ${hOn[i]?.toFixed(0)}/${hOff[i]?.toFixed(0)}`)).filter(Boolean);
        check('grid', `${seen.length} av ${hOn.length} linser i bildet lyser (max ≥ 200, på − av ≥ 60)`, hOn.length === 9 && seen.length >= 7 && !bad.length, bad.join(', '));
      }
      check('grid', `itemLightState for rutenettet: ${r.state}`, r.state === 'slot' || r.state === 'ambient');
    }
    if (only.has('slope')) check('slope', r.synthetic ? 'skråtaket (krever spots.js)' : 'skråtaket: slope.png er lagret – se etter at kantene ligger flatt i taket', r.synthetic ? null : !!r.slope);
  }

  if (only.has('picture')) {
    console.log('\n— picture: bildebelysning over ex-f-maleri');
    const r = await pictureStep(page);
    if (r.error) check('picture', r.error, false);
    else {
      savePng('picture-on.png', r.on);
      savePng('picture-off.png', r.off);
      savePng('picture-40.png', r.on40);
      report.steps.picture = { a: r.a, b: r.b, a40: r.a40, synthetic: r.synthetic, state: r.state };
      console.log(`  ved 40 %: ${r.a40?.toFixed(1)} (picture-40.png, for øyet)`);
      check('picture', `øvre tredel av maleriet: ${r.a?.toFixed(1)} / ${r.b?.toFixed(1)} ≥ 1,15${r.synthetic ? ' (syntetisk lys)' : ''}`, r.visible && r.a / Math.max(1e-6, r.b) >= 1.15);
    }
  }

  if (only.has('a')) {
    console.log('\n— a: spotskinne med 4 hoder mot w-vest-stue');
    const r = await railStep(page);
    savePng('a-wall-on.png', r.on);
    savePng('a-wall-off.png', r.off);
    savePng('a-lenses-on.png', r.lOn);
    report.steps.a = { a: r.a, b: r.b, heads: r.hOn?.map((v, i) => [v, r.hOff[i]]), synthetic: r.synthetic, merged: r.merged };
    check('a', `veggen lyses opp: på − av ${(r.a - r.b).toFixed(1)} ≥ 10${r.synthetic ? ' (syntetiske lys)' : ''}`, r.visible && r.a - r.b >= 10);
    check('a', `hodene slås sammen til ≤ 2 kandidater (${r.merged})`, r.merged != null && r.merged <= 2);
    if (r.synthetic) check('a', '4 linser lyser (krever spots.js)', null);
    else {
      const bad = r.hOn.map((v, i) => (v - r.hOff[i] >= 60 ? null : `${i}: ${v?.toFixed(0)}/${r.hOff[i]?.toFixed(0)}`)).filter(Boolean);
      check('a', `${r.hOn.length} linser lyser (på − av ≥ 60)`, r.hOn.length === 4 && !bad.length, bad.join(', '));
    }
  }

  if (only.has('b')) {
    console.log('\n— b: takspot 30° og veggspot');
    const list = await aimStep(page);
    report.steps.b = list.map(({ on, ...x }) => x);
    for (const r of list) {
      if (r.error) {
        check('b', `${r.name}: ${r.error}`, false);
        continue;
      }
      savePng(`b-${r.name.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '')}.png`, r.on);
      check('b', `${r.name}: ΔL ${(r.a - r.b).toFixed(1)} ≥ 8 der den peker (${r.hit.join(', ')}, ${r.what})${r.synthetic ? ' (syntetisk lys)' : ''}`, r.vis && r.a - r.b >= 8);
    }
  }

  if (only.has('c')) {
    console.log('\n— c: utenpåliggende downlights 2 × 2');
    const r = await surfaceStep(page);
    savePng('c-on.png', r.on);
    report.steps.c = { heads: r.hOn?.map((v, i) => [v, r.hOff[i]]), synthetic: r.synthetic };
    if (r.synthetic) check('c', '4 linser lyser (krever spots.js)', null);
    else {
      const bad = r.hOn.map((v, i) => (v - r.hOff[i] >= 60 ? null : `${i}: ${v?.toFixed(0)}/${r.hOff[i]?.toFixed(0)}`)).filter(Boolean);
      check('c', `${r.hOn.length} linser lyser (på − av ≥ 60, ${r.visible} synlige)`, r.hOn.length === 4 && r.visible === 4 && !bad.length, bad.join(', '));
    }
  }

  if (only.has('d')) {
    console.log('\n— d: én downlight i bad, gang, soverom og kjellerstue');
    const list = await roomsStep(page);
    report.steps.d = list.map(({ on, ...x }) => x);
    for (const r of list) {
      if (r.skipped) {
        console.log(`  –    [d] ${r.id}: hoppet over – nivået «${r.level}» er ikke med i spillet nå (config.js HOUSE.basement)`);
        continue;
      }
      savePng(`d-${r.id}.png`, r.on);
      check('d', `${r.id}: gulvet ΔL ${(r.a - r.b).toFixed(1)} ≥ 8 (kamera i ${r.cam})${r.synthetic ? ' (syntetisk lys)' : ''}`, r.vis && r.a - r.b >= 8);
      check('d', `${r.id}: nivå ${r.lv}, lyset i rommet ${r.roomOfLight}`, r.lv === r.level && r.roomOfLight === r.id);
      check('d', `${r.id}: henger i sitt eget tak (${r.hang?.toFixed(3)} / ${r.ceil?.toFixed(3)})`, Math.abs(r.hang - r.ceil) <= 0.01);
    }
  }

  if (only.has('e')) {
    console.log('\n— e: realistisk start (dimmer 40 %, faste lys «auto», 22:00)');
    const r = await gridStep(page, { realistic: true });
    savePng('e-on.png', r.on);
    savePng('e-off.png', r.off);
    savePng('e-lenses.png', r.lensOn);
    const [uOn, , ...hOn] = r.mOn, [uOff, , ...hOff] = r.mOff;
    report.steps.e = { product: r.product, under: [uOn, uOff], heads: hOn.map((v, i) => [v, hOff[i]]), synthetic: r.synthetic };
    console.log(`  produkt: ${r.product ?? '(ingen «innfelt» i katalogen ennå – testspot)'}`);
    check('e', `gulvet under: ${uOn?.toFixed(1)} / ${uOff?.toFixed(1)} ≥ 1,08${r.synthetic ? ' (syntetiske lys)' : ''}`, uOn / Math.max(1e-6, uOff) >= 1.08);
    if (r.synthetic) check('e', 'linsene lyser ved 40 % (krever spots.js)', null);
    else {
      const seen = hOn.map((v, i) => i).filter((i) => r.headVis[i] && hOn[i] != null);
      const bad = seen.map((i) => (hOn[i] - hOff[i] >= 40 ? null : `${i}: ${hOn[i]?.toFixed(0)}/${hOff[i]?.toFixed(0)}`)).filter(Boolean);
      check('e', `${seen.length} av ${hOn.length} linser i bildet lyser ved 40 % (på − av ≥ 40)`, hOn.length === 9 && seen.length >= 7 && !bad.length, bad.join(', '));
    }
  }
  pageErrors += watch.errors;
  check('slutt', `ingen konsollfeil (${watch.errors})`, watch.errors === 0);
} catch (e) {
  pageErrors++;
  console.error(`[spotcheck] ${e.message}`);
} finally {
  await close();
  browserClosed = true;
  release?.();
}

if (only.has('thumbs')) {
  const tool = join(ROOT, 'tools', 'thumbcheck.mjs');
  if (!existsSync(tool)) check('thumbs', 'thumbcheck --cat=spotter (tools/thumbcheck.mjs finnes ikke ennå)', null);
  else {
    console.log('\n— thumbs: thumbcheck --cat=spotter');
    const args = [tool, '--cat=spotter', `--port=${port}`, ...(opt.lock === 'true' ? ['--lock'] : []), ...(step ? [`--step=${step}`] : [])];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
    check('thumbs', `thumbcheck --cat=spotter (exit ${r.status})`, r.status === 0);
  }
}

report.results = results;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const failed = results.filter((r) => r.ok === false).length, pending = results.filter((r) => r.ok === null).length;
console.log(`\nspotcheck: ${results.filter((r) => r.ok).length} ok, ${failed} failed, ${pending} pending${pageErrors ? `, ${pageErrors} page errors` : ''} – ${join(OUT, 'report.json')}`);
process.exit(pageErrors ? 2 : failed ? 1 : 0);
