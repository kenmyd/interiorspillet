#!/usr/bin/env node
/**
 * artcheck.mjs – browser checks of the art builders (design/art.md §8.3, MASTER §4.2 P04): the round-1 art must look
 * exactly as before, the new motifs, frame profiles, gallery walls (art-set) and uploaded pictures must work.
 *
 *   node tools/artcheck.mjs --port=5190 --lock --step=p04 [--mode=legacy,motifs,profiles,sets,custom,catalog]
 *        [--save-golden[=<file>]] [--golden=<file>] [--out=<dir>] [--browser=msedge|chrome]
 *
 *   --mode          comma list (default legacy,motifs,profiles,sets,custom)
 *     legacy        builds 14 fixed round-1 art specs (the 4 Bohus pictures as they were at c28070d, the living-room
 *                   painting ex-f-maleri, the Def default, the legacy motifs, a mat print, a floater, two acoustic
 *                   pictures) and the TV with its screen on, at medium quality, on /dev/models.html; reads the print
 *                   texture (and the relief/brush normal map) at 64 × 64 RGB plus a geometry signature (meshes,
 *                   vertices, bounding box per part) and the print material numbers. With --save-golden it writes
 *                   the golden (default tools/fixtures/art-legacy-golden.json; never overwrites an existing file,
 *                   prints its sha256); otherwise it compares with it: per pixel |Δ| ≤ 3 and mean |Δ| ≤ 0.5 per
 *                   texture, the same mesh/vertex counts, bounding boxes within 0.01 mm.
 *     motifs        every new motif (models/artmotifs.js) × seeds {1, 2} × aspects {0.7, 1, 1.43} at 384 px: opaque,
 *                   not blank (luminance std ≥ 6), not black/white (mean 8…247; dark motifs ≥ 6), deterministic, seed
 *                   sensitive, every variant paints and differs; timing at 1024² (warn only); a contact sheet PNG.
 *     profiles      one art-frame per frame profile and FRAME_PRESETS entry: no fallback, a frame part (not for
 *                   none/hanger), the hanger has no side bars; a screenshot sheet.
 *     sets          every art-set layout: no fallback, one print mesh with uv1, atlas ≤ 2048 px, ≤ 6 meshes (+1 per
 *                   fixed finish), the triptych's motif runs across the panels; a screenshot sheet.
 *     custom        on the game page: a stub image source, a custom frame next to ex-f-maleri – placeholder, the same
 *                   texture redrawn with the picture, no new shader program, swap + undo, a missing picture.
 *     catalog       every kunst product and variant builds without fallback with a print part; build time; the art
 *                   cache stays within budget.
 *     research      staged kunst research (--research=<file|dir|comma list>, default research/runde3/kunst-*.json): every
 *                   product and variant builds without fallback, with a print part, inside its dims (the hanger's cord
 *                   and battens excepted); a screenshot sheet in file order (research-index.json maps the cells)
 *   --out           output folder (default .shots/<step>/artcheck, without --step .shots/artcheck)
 *   --lock --step   the shared GPU lock and the browser pidfile (tools/lib/hus.mjs); a hung run is stopped with
 *                   node tools/stop-browser.mjs --step=<step>
 *
 * Exit code: 0 = ok, 1 = flags (a check failed), 2 = tool error (server down, page error, missing golden).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, ROOT, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = opt.port ?? 5190;
const modes = (opt.mode ?? 'legacy,motifs,profiles,sets,custom').split(',').map((s) => s.trim()).filter(Boolean);
const KNOWN = ['legacy', 'motifs', 'profiles', 'sets', 'custom', 'catalog', 'research'];
const OUT = path.resolve(ROOT, opt.out ?? path.join('.shots', opt.step ?? '', 'artcheck'));
const GOLDEN = path.resolve(ROOT, typeof opt['save-golden'] === 'string' && opt['save-golden'] !== 'true' ? opt['save-golden'] : opt.golden ?? path.join('tools', 'fixtures', 'art-legacy-golden.json'));
const SAVE = opt['save-golden'] != null;

for (const m of modes) {
  if (!KNOWN.includes(m)) {
    console.error(`[artcheck] unknown mode «${m}» (known: ${KNOWN.join(', ')})`);
    process.exit(2);
  }
}
if (SAVE && fs.existsSync(GOLDEN)) {
  console.error(`[artcheck] ${path.relative(ROOT, GOLDEN)} exists – --save-golden never overwrites a golden (delete it by hand only with a reason)`);
  process.exit(2);
}
if (SAVE && !modes.includes('legacy')) {
  console.error('[artcheck] --save-golden needs --mode=legacy');
  process.exit(2);
}

let flags = 0;
const flag = (mode, msg) => {
  flags++;
  console.log(`[artcheck] FLAG ${mode}: ${msg}`);
};
const ok = (mode, msg) => console.log(`[artcheck] ok   ${mode}: ${msg}`);
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

// ---------------------------------------------------------------------------------------------------------------------
// legacy: the round-1 specs (c28070d data, explicit depth so the removed Def default depth does not matter)

const LEGACY_SPECS = [
  ['gustin', { archetype: 'art-frame', dims: { w: 0.8, d: 0.045, h: 1 }, params: { motif: 'abstract', frame: 'white', w: 0.8, h: 1, depth: 0.045, frameW: 0.02, texture: 'relief', accentColor: '#1f1f1f' }, colors: { print: '#8a8a8b', frame: '#e0dfdd' }, materials: { print: 'linen', frame: 'painted' } }],
  ['labyrint', { archetype: 'art-frame', dims: { w: 0.8, d: 0.04, h: 1.2 }, params: { motif: 'abstract', frame: 'oak', w: 0.8, h: 1.2, depth: 0.04, frameW: 0.02, texture: 'relief', orientation: 'portrait', accentColor: '#cfbead' }, colors: { print: '#e9e7e4', frame: '#ab937a' }, materials: { print: 'paper', frame: 'oak' } }],
  ['ramor', { archetype: 'art-frame', dims: { w: 0.9, d: 0.05, h: 1.2 }, params: { motif: 'abstract', frame: 'black', w: 0.9, h: 1.2, depth: 0.05, frameW: 0.025, texture: 'painted', accentColor: '#c2a283' }, colors: { print: '#786354', frame: '#1f1f1e' }, materials: { print: 'linen', frame: 'painted' } }],
  ['mara', { archetype: 'art-frame', dims: { w: 1.2, d: 0.045, h: 0.6 }, params: { motif: 'abstract', frame: 'oak', w: 1.2, h: 0.6, depth: 0.045, frameW: 0.02, texture: 'painted', orientation: 'landscape', accentColor: '#b4a8a0' }, colors: { print: '#e0dddb', frame: '#c3b7aa' }, materials: { print: 'linen', frame: 'ash' } }],
  ['f-maleri', 'ex-f-maleri'],
  ['default', { archetype: 'art-frame' }],
  ['landscape', { archetype: 'art-frame', dims: { w: 0.6, d: 0.04, h: 0.8 }, params: { motif: 'landscape', depth: 0.04 } }],
  ['botanical', { archetype: 'art-frame', dims: { w: 0.6, d: 0.04, h: 0.8 }, params: { motif: 'botanical', depth: 0.04 } }],
  ['line-art', { archetype: 'art-frame', dims: { w: 0.6, d: 0.04, h: 0.8 }, params: { motif: 'line-art', depth: 0.04 } }],
  ['photo', { archetype: 'art-frame', dims: { w: 0.6, d: 0.04, h: 0.8 }, params: { motif: 'photo', depth: 0.04 } }],
  ['mat-print', { archetype: 'art-frame', dims: { w: 0.5, d: 0.025, h: 0.7 }, params: { motif: 'misty-trees', frame: 'black', mat: true, texture: 'canvas', depth: 0.025, seed: 2 } }],
  ['floater', { archetype: 'art-frame', dims: { w: 0.6, d: 0.04, h: 0.8 }, params: { motif: 'abstract', frame: 'floater', depth: 0.04, seed: 5 }, colors: { print: '#a07d62', frame: '#2b2623' }, materials: { print: 'cotton', frame: 'oak' } }],
  ['acoustic-custom', { archetype: 'acoustic-art', dims: { w: 1.8, d: 0.04, h: 1.2 }, params: { thickness: 0.04, motif: 'custom' } }],
  ['acoustic-abstract', { archetype: 'acoustic-art', dims: { w: 1.2, d: 0.035, h: 1.8 }, params: { thickness: 0.035, motif: 'abstract' } }],
  ['tv-on', { archetype: 'tv', params: { screen: 'on' } }],
];

/** Page side of legacy: build every spec, read its textures (64 × 64 RGB, base64), geometry and material numbers. */
async function legacyPage({ specs, size }) {
  const R = await import('/src/models/registry.js');
  const resolve = async (s) => {
    if (typeof s !== 'string') return s;
    const E = await import('/src/home/existing.js');
    const { layout } = await import('/src/home/layout.js');
    const it = E.originalItems(layout).find((i) => i.uid === s);
    if (!it) throw new Error(`no original item ${s}`);
    return { archetype: it.archetype, dims: it.dims, params: it.params, colors: it.colors, materials: it.materials };
  };
  const enc = (img) => {
    if (!img || !img.width) return null;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, size, size);
    const d = x.getImageData(0, 0, size, size).data;
    let s = '';
    for (let i = 0; i < d.length; i += 4) s += String.fromCharCode(d[i], d[i + 1], d[i + 2]);
    return { w: img.width, h: img.height, rgb: btoa(s) };
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const geom = (g) => {
    g.updateMatrixWorld(true);
    let meshes = 0, verts = 0;
    const parts = {};
    g.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const n = o.geometry.attributes.position.count;
      verts += n;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const e = (parts[o.userData.part || '-'] ||= { n: 0, verts: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      e.n++;
      e.verts += n;
      ['x', 'y', 'z'].forEach((k, i) => {
        e.min[i] = Math.min(e.min[i], b.min[k]);
        e.max[i] = Math.max(e.max[i], b.max[k]);
      });
    });
    for (const e of Object.values(parts)) {
      e.min = e.min.map(r6);
      e.max = e.max.map(r6);
    }
    return { meshes, verts, parts };
  };
  const out = {};
  for (const [name, s0] of specs) {
    const spec = await resolve(s0);
    const g = R.buildModel({ ...spec, quality: 'medium' });
    const fallback = !!g.userData.model?.fallback;
    let m = null;
    if (spec.archetype === 'tv') {
      g.traverse((o) => {
        if (o.isMesh && o.material?.emissiveMap) m = o.material;
      });
    } else {
      const part = spec.archetype === 'acoustic-art' ? 'panel' : 'print';
      m = g.userData.model?.parts?.[part]?.find((o) => o.material?.map)?.material ?? null;
    }
    const map = m ? m.map || m.emissiveMap : null;
    out[name] = {
      fallback,
      map: enc(map?.image),
      normal: enc(m?.normalMap && m.normalMap.image && m.normalMap.channel !== 1 ? m.normalMap.image : null),
      mat: m ? { type: m.type, roughness: r6(m.roughness), metalness: r6(m.metalness), normalScale: m.normalScale ? r6(m.normalScale.x) : null, normalChannel: m.normalMap ? m.normalMap.channel : null, emissiveIntensity: r6(m.emissiveIntensity ?? 0) } : null,
      geom: geom(g),
    };
  }
  return out;
}

function decode(b64) {
  return Buffer.from(b64, 'base64');
}

/** Per-channel |Δ| statistics of two encoded textures. */
function texDiff(a, b) {
  if (!a && !b) return { max: 0, mean: 0 };
  if (!a || !b) return { max: 255, mean: 255, why: a ? 'texture gone' : 'new texture' };
  if (a.w !== b.w || a.h !== b.h) return { max: 255, mean: 255, why: `size ${b.w}×${b.h} ≠ ${a.w}×${a.h}` };
  const x = decode(a.rgb), y = decode(b.rgb);
  let max = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - y[i]);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / x.length };
}

function geomDiff(a, b) {
  const probs = [];
  if (a.meshes !== b.meshes) probs.push(`meshes ${b.meshes} ≠ ${a.meshes}`);
  if (a.verts !== b.verts) probs.push(`vertices ${b.verts} ≠ ${a.verts}`);
  const keys = new Set([...Object.keys(a.parts), ...Object.keys(b.parts)]);
  for (const k of keys) {
    const p = a.parts[k], q = b.parts[k];
    if (!p || !q) {
      probs.push(`part ${k} ${p ? 'gone' : 'new'}`);
      continue;
    }
    if (p.n !== q.n || p.verts !== q.verts) probs.push(`part ${k}: ${q.n} meshes/${q.verts} verts ≠ ${p.n}/${p.verts}`);
    const dm = Math.max(...p.min.map((v, i) => Math.abs(v - q.min[i])), ...p.max.map((v, i) => Math.abs(v - q.max[i])));
    if (dm > 1e-5) probs.push(`part ${k}: bbox moved ${(dm * 1000).toFixed(3)} mm`);
  }
  return probs;
}

async function runLegacy(page) {
  const data = await page.evaluate(legacyPage, { specs: LEGACY_SPECS, size: 64 });
  write(path.join(OUT, 'legacy.json'), JSON.stringify(data));
  for (const [name, d] of Object.entries(data)) {
    if (d.fallback) flag('legacy', `${name}: fallback model`);
    if (!d.map) flag('legacy', `${name}: no print texture`);
  }
  if (SAVE) {
    const golden = { tool: 'artcheck', version: 1, size: 64, quality: 'medium', note: 'Round-1 art textures (64 × 64 RGB, base64), geometry and print material numbers from the untouched decor.js (MASTER §4.2 P04 step 1). Never regenerate without a written reason.', items: data };
    const text = `{\n${Object.entries(golden).map(([k, v]) => k === 'items'
      ? `  "items": {\n${Object.entries(v).map(([n, it]) => `    ${JSON.stringify(n)}: ${JSON.stringify(it)}`).join(',\n')}\n  }`
      : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;
    write(GOLDEN, text);
    const sha = createHash('sha256').update(text).digest('hex');
    console.log(`[artcheck] golden saved: ${path.relative(ROOT, GOLDEN)} (${Object.keys(data).length} items, ${text.length} bytes) sha256 ${sha}`);
    return;
  }
  if (!fs.existsSync(GOLDEN)) {
    console.error(`[artcheck] no golden at ${path.relative(ROOT, GOLDEN)} – run --mode=legacy --save-golden on the untouched decor.js first`);
    process.exitCode = 2;
    flags++;
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const [name, want] of Object.entries(golden.items)) {
    const got = data[name];
    if (!got) {
      flag('legacy', `${name}: not built`);
      continue;
    }
    const probs = [];
    for (const k of ['map', 'normal']) {
      const t = texDiff(want[k], got[k]);
      if (t.why) probs.push(`${k}: ${t.why}`);
      else if (t.max > 3 || t.mean > 0.5) probs.push(`${k}: max |Δ| ${t.max}, mean ${t.mean.toFixed(3)}`);
    }
    probs.push(...geomDiff(want.geom, got.geom));
    if (JSON.stringify(want.mat) !== JSON.stringify(got.mat)) probs.push(`material ${JSON.stringify(got.mat)} ≠ ${JSON.stringify(want.mat)}`);
    if (probs.length) flag('legacy', `${name}: ${probs.join('; ')}`);
    else ok('legacy', `${name}: unchanged`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// motifs: the painters of models/artmotifs.js (design/art.md §2.1 contract, §8.3)

/** Motifs allowed a dark mean luminance (≥ 6 instead of ≥ 8). */
const DARK_MOTIFS = ['stag', 'moon-phases', 'city-night', 'northern-lights', 'kids-animals'];

/** Page side of motifs: paints every motif × seed × aspect, checks the contract, builds a contact sheet. */
async function motifsPage({ size, seeds, aspects, dark }) {
  const AM = await import('/src/models/artmotifs.js');
  const K = await import('/src/models/kit.js');
  const keys = Object.keys(AM.ART_MOTIFS);
  const COST = { S: 6, M: 15, L: 24 };
  const OTHER = ['#20304a', '#e0c070', '#a03030', '#f2f0ea', '#308060'];
  const res = { keys: keys.length, motifs: [], sheet: null };
  const fnv = (d) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i += 3) h = Math.imul(h ^ d[i], 0x01000193) >>> 0;
    return h.toString(16);
  };
  /** Paints with the contract guards: forbidden context API, c.filter blur count, Math.random. */
  const paint = (key, W, H, seed, pal, opts = null) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const real = cv.getContext('2d');
    const guard = { forbidden: new Set(), blurs: 0, random: 0 };
    const c = new Proxy(real, {
      get(t, k) {
        if (k === 'canvas' || k === 'getImageData' || k === 'putImageData' || k === 'setTransform' || k === 'resetTransform') guard.forbidden.add(String(k));
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (k === 'filter' && typeof v === 'string' && v !== 'none') guard.blurs++;
        t[k] = v;
        return true;
      },
    });
    const mr = Math.random;
    Math.random = () => {
      guard.random++;
      return mr();
    };
    const t0 = performance.now();
    let ok = false, error = null;
    try {
      const p = [...pal];
      p.mono = false;
      ok = AM.paintArt(c, W, H, key, K.rng(`motif:${key}:${seed}`), p, { hc: null, opts });
    } catch (e) {
      error = String(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e);
    } finally {
      Math.random = mr;
    }
    return { cv, ms: performance.now() - t0, ok, error, guard };
  };
  const stats = (cv) => {
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
    let minA = 255, sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < minA) minA = d[i + 3];
      if ((i >> 2) % 3) continue;
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sum2 += l * l;
      n++;
    }
    const mean = sum / n;
    return { minA, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), hash: fnv(d) };
  };
  /** Edge map (Sobel on luminance, 96 px) for the palette-independence IoU. */
  const edges = (cv) => {
    const N = 96;
    const k = document.createElement('canvas');
    k.width = k.height = N;
    const q = k.getContext('2d', { willReadFrequently: true });
    q.drawImage(cv, 0, 0, N, N);
    const d = q.getImageData(0, 0, N, N).data;
    const L = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    const M = new Float32Array(N * N);
    let s = 0, s2 = 0;
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const at = (dx, dy) => L[(y + dy) * N + x + dx];
        const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
        const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
        const m = Math.hypot(gx, gy);
        M[y * N + x] = m;
        s += m;
        s2 += m * m;
      }
    }
    const n = (N - 2) * (N - 2), mean = s / n, thr = mean + Math.sqrt(Math.max(0, s2 / n - mean * mean));
    return M.map((m) => (m > thr ? 1 : 0));
  };
  const iou = (a, b) => {
    let i = 0, u = 0;
    for (let k = 0; k < a.length; k++) {
      if (a[k] || b[k]) u++;
      if (a[k] && b[k]) i++;
    }
    return u ? i / u : 1;
  };
  const dims = (a) => (a >= 1 ? [size, Math.round(size / a)] : [Math.round(size * a), size]);
  const sheetCells = [];
  for (const key of keys) {
    const def = AM.ART_MOTIFS[key];
    const pal = Array.isArray(def.palette) ? def.palette : ['#f2f0ea', '#8a9a8c', '#c9b8a0', '#33393a', '#c97d4e'];
    const m = { key, label: def.label, cost: def.cost, problems: [], warnings: [], ms: null, iou: null };
    const isDark = dark.includes(key);
    for (const seed of seeds) {
      for (const a of aspects) {
        const [W, H] = dims(a);
        const r1 = paint(key, W, H, seed, pal);
        if (r1.error || !r1.ok) {
          m.problems.push(`seed ${seed} aspect ${a}: ${r1.error || 'paintArt returned false'}`);
          continue;
        }
        if (r1.guard.forbidden.size) m.problems.push(`uses ${[...r1.guard.forbidden].join(', ')} on the context`);
        if (r1.guard.random) m.problems.push('calls Math.random');
        if (r1.guard.blurs > 2) m.problems.push(`${r1.guard.blurs} blur filters (≤ 2)`);
        const s1 = stats(r1.cv);
        if (s1.minA < 255) m.problems.push(`not opaque (alpha ${s1.minA}) at seed ${seed}, aspect ${a}`);
        if (s1.std < 6) m.problems.push(`BLANK (luminance std ${s1.std.toFixed(1)}) at seed ${seed}, aspect ${a}`);
        if (s1.mean > 247 || s1.mean < (isDark ? 6 : 8)) m.problems.push(`${s1.mean > 247 ? 'WHITE' : 'BLACK'} (mean ${s1.mean.toFixed(1)}) at seed ${seed}, aspect ${a}`);
        const r2 = paint(key, W, H, seed, pal);
        if (stats(r2.cv).hash !== s1.hash) m.problems.push(`not deterministic (seed ${seed}, aspect ${a})`);
        (m.hashes ||= {})[`${seed}|${a}`] = s1.hash;
        if (seed === seeds[0] && a === aspects[0]) {
          sheetCells.push({ key, label: def.label, cv: r1.cv });
          const r3 = paint(key, W, H, seed, OTHER);
          if (r3.ok && !r3.error) m.iou = iou(edges(r1.cv), edges(r3.cv));
        }
      }
    }
    if (m.hashes && seeds.length > 1 && aspects.every((a) => m.hashes[`${seeds[0]}|${a}`] && m.hashes[`${seeds[0]}|${a}`] === m.hashes[`${seeds[1]}|${a}`])) m.problems.push('the seed changes nothing');
    if (Array.isArray(def.variants) && def.variants.length) {
      const [W, H] = dims(1);
      const seen = new Map();
      for (const [v] of def.variants) {
        const r = paint(key, W, H, seeds[0], pal, { variant: v });
        if (r.error || !r.ok) {
          m.problems.push(`variant ${v}: ${r.error || 'failed'}`);
          continue;
        }
        const h = stats(r.cv).hash;
        if (seen.has(h)) m.problems.push(`variants ${seen.get(h)} and ${v} paint the same picture`);
        seen.set(h, v);
      }
    }
    // timing at 1024² (warn only): the median of 3
    const t = [0, 1, 2].map(() => paint(key, 1024, 1024, seeds[0], pal).ms).sort((x, y) => x - y)[1];
    m.ms = t;
    if (COST[def.cost] && t > COST[def.cost] * 1.5) m.warnings.push(`${t.toFixed(1)} ms at 1024² (cost ${def.cost} ≤ ${COST[def.cost]} ms × 1.5)`);
    if (m.iou != null && m.iou < 0.6) m.warnings.push(`another palette changes the composition (edge IoU ${m.iou.toFixed(2)} < 0.6)`);
    delete m.hashes;
    res.motifs.push(m);
  }
  if (sheetCells.length) {
    const cols = 8, cw = 160, ch = 200, rows = Math.ceil(sheetCells.length / cols);
    const sh = document.createElement('canvas');
    sh.width = cols * cw;
    sh.height = rows * ch;
    const x = sh.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, sh.width, sh.height);
    x.font = '11px system-ui, sans-serif';
    x.textBaseline = 'top';
    sheetCells.forEach((c, i) => {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
      const s = Math.min((cw - 10) / c.cv.width, (ch - 26) / c.cv.height);
      const w = c.cv.width * s, h = c.cv.height * s;
      x.drawImage(c.cv, cx + (cw - w) / 2, cy + 4, w, h);
      x.fillStyle = '#222';
      x.fillText(`${c.key}`.slice(0, 26), cx + 5, cy + ch - 20);
    });
    res.sheet = sh.toDataURL('image/png');
  }
  return res;
}

async function runMotifs(page) {
  const data = await page.evaluate(motifsPage, { size: 384, seeds: [1, 2], aspects: [0.7, 1, 1.43], dark: DARK_MOTIFS });
  if (data.sheet) {
    write(path.join(OUT, 'motifs.png'), Buffer.from(data.sheet.split(',')[1], 'base64'));
    console.log(`[artcheck] motifs sheet ${path.relative(ROOT, path.join(OUT, 'motifs.png'))}`);
  }
  delete data.sheet;
  write(path.join(OUT, 'motifs.json'), JSON.stringify(data, null, 1));
  if (!data.keys) {
    console.log('[artcheck] PENDING motifs: no new motifs are registered yet (models/art/graphic.js and painted.js are stubs)');
    return;
  }
  for (const m of data.motifs) {
    for (const w of m.warnings) console.log(`[artcheck] warn motifs: ${m.key}: ${w}`);
    if (m.problems.length) flag('motifs', `${m.key}: ${[...new Set(m.problems)].join('; ')}`);
    else ok('motifs', `${m.key} (${m.cost}, ${m.ms.toFixed(1)} ms at 1024²${m.iou != null ? `, edge IoU ${m.iou.toFixed(2)}` : ''})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// profiles and sets: built on /dev/models.html, laid out in a grid for a screenshot sheet

/** Page side: builds specs, checks them, lays them out in a grid (cols × cell) instead of the gallery's models. */
async function gridPage({ kind, cols, cellW, cellH }) {
  const THREE = await import(window.__hus.depUrl('three.js'));
  const R = await import('/src/models/registry.js');
  const AL = await import('/src/models/artlayout.js');
  const G = window.__gallery;
  for (const m of G.models) m.object.visible = false;
  const list = [];
  if (kind === 'profiles') {
    for (const [frame] of AL.FRAME_OPTIONS) {
      for (const texture of ['canvas', 'paper']) {
        list.push({ name: `${frame} / ${texture}`, frame, spec: { archetype: 'art-frame', dims: { w: 0.5, d: 0.03, h: 0.7 }, params: { motif: 'landscape', seed: 3, frame, texture, mat: texture === 'paper', matW: 0.04 } } });
      }
    }
    for (const p of AL.FRAME_PRESETS) {
      list.push({
        name: `preset ${p.key}`, frame: p.frame,
        spec: { archetype: 'art-frame', dims: { w: 0.5, d: 0.03, h: 0.7 }, params: { motif: 'botanical', seed: 2, frame: p.frame, texture: 'paper', mat: true, matW: 0.04, glass: true }, ...(p.kind ? { materials: { print: 'paper', frame: p.kind }, colors: { print: '#c9cfcd', frame: p.hex } } : {}) },
      });
    }
  } else {
    for (const [layout] of AL.LAYOUT_OPTIONS) {
      const lay = AL.galleryLayout(layout);
      const b = AL.setBounds(lay.frames, lay.ledge);
      list.push({ name: layout, layout, frames: lay.frames.length, span: lay.span, spec: { archetype: 'art-set', dims: { w: b.w, d: lay.ledge ? 0.11 : 0.025, h: b.h }, params: { layout } } });
    }
  }
  const out = [];
  list.forEach((it, i) => {
    const g = R.buildModel({ ...it.spec, quality: 'medium' });
    const r = { name: it.name, problems: [] };
    const M = g.userData.model || {};
    if (M.fallback) r.problems.push('fallback model');
    const parts = M.parts || {};
    if (!parts.print?.length) r.problems.push('no print part');
    let meshes = 0;
    g.traverse((o) => o.isMesh && meshes++);
    r.meshes = meshes;
    if (kind === 'profiles') {
      const framed = it.frame !== 'none';
      if (framed && it.frame !== 'hanger' && !parts.frame?.length) r.problems.push('no frame part');
      if (it.frame === 'hanger') {
        // no side bars: every frame vertex lies in the top or bottom batten band
        g.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        let mid = 0;
        for (const m of parts.frame || []) {
          const pos = m.geometry.attributes.position;
          for (let k = 0; k < pos.count; k++) {
            v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
            if (Math.abs(v.y) < 0.35 - 0.016 - 0.002) mid++;
          }
        }
        if (mid) r.problems.push(`${mid} frame vertices between the battens (side bars?)`);
      }
    } else {
      const pm = parts.print || [];
      if (pm.length !== 1) r.problems.push(`${pm.length} print meshes (want 1)`);
      const p0 = pm[0];
      if (p0 && !p0.geometry.attributes.uv1) r.problems.push('the print mesh has no uv1');
      const img = p0?.material?.map?.image;
      if (img && (img.width > 2048 || img.height > 2048)) r.problems.push(`print texture ${img.width}×${img.height} > 2048`);
      r.tex = img ? `${img.width}×${img.height}` : null;
      if (meshes > 6) r.problems.push(`${meshes} meshes (≤ 6)`);
      if (it.span && p0) {
        // one motif across the panels: the panels' u ranges are ordered, disjoint and cover 0…1
        const uv = p0.geometry.attributes.uv;
        const ranges = [];
        for (let k = 0; k < uv.count; k += 4) {
          const us = [0, 1, 2, 3].map((j) => uv.getX(k + j));
          ranges.push([Math.min(...us), Math.max(...us)]);
        }
        ranges.sort((a, b) => a[0] - b[0]);
        const okSpan = ranges.length === it.frames && Math.abs(ranges[0][0]) < 1e-3 && Math.abs(ranges[ranges.length - 1][1] - 1) < 1e-3 && ranges.every((r2, k) => k === 0 || r2[0] > ranges[k - 1][1]);
        if (!okSpan) r.problems.push(`span uv ranges ${JSON.stringify(ranges.map((x) => x.map((u) => +u.toFixed(3))))}`);
        if (/print set/.test(p0.material.name)) r.problems.push('the span uses the atlas');
      }
    }
    const col = i % cols, row = Math.floor(i / cols);
    g.position.set((col - (cols - 1) / 2) * cellW, -row * cellH, 0);
    G.scene.add(g);
    out.push(r);
  });
  const rows = Math.ceil(list.length / cols);
  const w = cols * cellW, h = rows * cellH;
  const cy = -((rows - 1) * cellH) / 2;
  const dist = (Math.max(w / 1.6, h) / 2 / Math.tan((40 * Math.PI) / 360)) * 1.08;
  window.__setView({ pos: [0, cy, dist], look: [0, cy, 0], fov: 40 });
  return out;
}

function gridRunner(kind, opts) {
  return async (page) => {
    const data = await page.evaluate(gridPage, { kind, ...opts });
    await page.waitForTimeout(400);
    const shot = path.join(OUT, `${kind}.png`);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: shot });
    console.log(`[artcheck] ${kind} sheet ${path.relative(ROOT, shot)}`);
    for (const r of data) {
      if (r.problems.length) flag(kind, `${r.name}: ${r.problems.join('; ')}`);
      else ok(kind, `${r.name} (${r.meshes} meshes${r.tex ? `, texture ${r.tex}` : ''})`);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// custom: an uploaded picture on the game page through a stub image source (art.md §8.3, MASTER §2.8)

async function customPage() {
  const g = window.__game, H = g.home;
  window.__hus.stop();
  const res = { steps: [], problems: [] };
  const okv = (name, pass, detail = '') => {
    res.steps.push([name, !!pass, detail]);
    if (!pass) res.problems.push(`${name}${detail ? ` (${detail})` : ''}`);
  };
  const A = await import('/src/models/artImages.js');
  const imgs = new Map(), gone = new Set(), readyCbs = new Map(), missCbs = new Map(), reqs = new Map();
  const sub = (map, id, cb) => {
    const s = map.get(id) || new Set();
    map.set(id, s);
    s.add(cb);
    return () => s.delete(cb);
  };
  A.setArtImageSource({
    getSync: (id) => imgs.get(id) ?? null,
    request: (id) => (imgs.has(id) ? Promise.resolve(imgs.get(id)) : gone.has(id) ? Promise.resolve(null) : new Promise((r) => sub(reqs, id, r))),
    onReady: (id, cb) => sub(readyCbs, id, cb),
    onMissing: (id, cb) => sub(missCbs, id, cb),
    status: (id) => (imgs.has(id) ? 'ready' : gone.has(id) ? 'missing' : 'loading'),
    info: (id) => (imgs.has(id) ? { id, w: imgs.get(id).width, h: imgs.get(id).height, aspect: imgs.get(id).width / imgs.get(id).height } : null),
  });
  const resolve = (id, cv) => {
    imgs.set(id, cv);
    setTimeout(() => {
      for (const cb of [...(readyCbs.get(id) || [])]) cb(cv);
      for (const r of [...(reqs.get(id) || [])]) r(cv);
    }, 0);
  };
  const pic = (cols) => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const x = c.getContext('2d');
    cols.forEach((col, i) => {
      x.fillStyle = col;
      x.fillRect((i * 600) / cols.length, 0, 600 / cols.length, 400);
    });
    return c;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => {
    H.sync.flush();
    for (let i = 0; i < 400 && H.sync._gates.size; i++) await sleep(25);
    window.__hus.step(2);
  };
  const printOf = (uid) => {
    let m = null;
    H.sync.getObject(uid)?.traverse((o) => {
      if (o.isMesh && o.userData.part === 'print') m = o.material;
    });
    return m;
  };
  const px = (cv, fx, fy) => {
    const k = document.createElement('canvas');
    k.width = cv.width;
    k.height = cv.height;
    const q = k.getContext('2d', { willReadFrequently: true });
    q.drawImage(cv, 0, 0);
    return Array.from(q.getImageData(Math.min(cv.width - 1, Math.floor(cv.width * fx)), Math.min(cv.height - 1, Math.floor(cv.height * fy)), 1, 1).data).slice(0, 3);
  };
  const near = (a, hex, tol) => {
    const n = parseInt(hex.slice(1), 16);
    return Math.abs(a[0] - ((n >> 16) & 255)) <= tol && Math.abs(a[1] - ((n >> 8) & 255)) <= tol && Math.abs(a[2] - (n & 255)) <= tol;
  };
  const programs = () => g.renderer.info.programs?.length ?? -1;
  const ID1 = `img-${'a1'.repeat(14)}`, ID2 = `img-${'b2'.repeat(14)}`, ID3 = `img-${'c3'.repeat(14)}`;
  const base = {
    source: 'custom', refId: 'custom-image', category: 'kunst', archetype: 'art-frame', mount: 'wall', rotationDeg: 180,
    dims: { w: 0.6, d: 0.025, h: 0.45 }, colors: { print: '#e6e2da', frame: '#151515' }, materials: { print: 'paper', frame: 'black-metal' },
    attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] },
  };
  const P = { fit: 'cover', frame: 'thin', frameW: 0.012, mat: true, matW: 0.04, texture: 'photo', glass: true, depth: 0.025, edge: 'white' };
  // the two uploaded-picture frames hang right of ex-f-maleri (x 4.85–5.85, y 1.27–1.97) in the free wall to the corner
  // (x 5.95–6.92), clear of the palm (ex-f-palme at x 4.15, its leaves reach x ≈ 4.75) and above the sofa back (0.75 m)
  // warm-up: a generated photo print with the same layout – the uploaded picture must reuse its shader program (behind
  // the palm, out of the view)
  const warm = g.design.add({ ...base, name: 'artcheck oppvarming', position: [4.3, 1.55, 11.93], params: { ...P, motif: 'photo', seed: 2 } });
  await settle();
  await settle();
  const p0 = programs();
  const uid = g.design.add({ ...base, name: 'Eget bilde – artcheck', position: [6.4, 1.4, 11.93], params: { ...P, motif: 'custom', imageId: ID1, imageAspect: 1.5 } });
  await settle();
  const m1 = printOf(uid);
  const cv = m1?.map?.image;
  okv('the custom frame is built with a print', !!(m1 && cv));
  if (!cv) return res;
  const uuid = m1.map.uuid;
  okv('placeholder while the picture loads', near(px(cv, 0.1, 0.1), '#d9d4cc', 4), JSON.stringify(px(cv, 0.1, 0.1)));
  okv('no new shader program for the custom frame', programs() === p0, `${p0} → ${programs()}`);
  resolve(ID1, pic(['#d23c2c', '#2c5fd2']));
  await sleep(50);
  await settle();
  const m2 = printOf(uid);
  okv('the same material and texture after the picture arrives', m2 === m1 && m2.map.uuid === uuid && m2.map.image === cv);
  okv('the picture is drawn in place (red left, blue right)', near(px(cv, 0.25, 0.5), '#d23c2c', 6) && near(px(cv, 0.75, 0.5), '#2c5fd2', 6), `${JSON.stringify(px(cv, 0.25, 0.5))} ${JSON.stringify(px(cv, 0.75, 0.5))}`);
  okv('still no new shader program', programs() === p0, `${p0} → ${programs()}`);
  // straight on from in front of the sofa: both uploaded-picture frames and the painting, the palm at the edge
  window.__setView({ pos: [5.85, 1.6, 9.9], look: [5.85, 1.6, 11.93], fov: 50 });
  window.__hus.step(30);
  res.view = true;
  // «Bytt bilde» and undo
  imgs.set(ID2, pic(['#2ca04c']));
  g.design.update(uid, { params: { imageId: ID2 } });
  await settle();
  const m3 = printOf(uid);
  okv('a new picture after imageId changes', m3 && near(px(m3.map.image, 0.5, 0.5), '#2ca04c', 6), m3 ? JSON.stringify(px(m3.map.image, 0.5, 0.5)) : 'no print');
  g.design.undo();
  await settle();
  const m4 = printOf(uid);
  okv('undo brings the old picture back', m4 && near(px(m4.map.image, 0.25, 0.5), '#d23c2c', 6), m4 ? JSON.stringify(px(m4.map.image, 0.25, 0.5)) : 'no print');
  // a picture that is not in this browser
  gone.add(ID3);
  const uid3 = g.design.add({ ...base, name: 'Eget bilde – mangler', position: [6.4, 1.95, 11.93], params: { ...P, motif: 'custom', imageId: ID3, imageAspect: 1 } });
  await settle();
  const m5 = printOf(uid3);
  let hatch = 0;
  if (m5?.map?.image) for (let k = 0; k < 64; k++) if (near(px(m5.map.image, k / 64, 0.37), '#cfc8bd', 3)) hatch++;
  okv('a missing picture shows the hatched placeholder', hatch >= 2, `${hatch} hatch samples`);
  okv('programs unchanged through the whole sequence', programs() === p0, `${p0} → ${programs()}`);
  res.uids = [warm, uid, uid3];
  return res;
}

async function runCustom(page) {
  const data = await page.evaluate(customPage);
  for (const [name, pass, detail] of data.steps) {
    if (pass) ok('custom', `${name}${detail ? ` (${detail})` : ''}`);
    else flag('custom', `${name}${detail ? ` (${detail})` : ''}`);
  }
  if (data.view) {
    const shot = path.join(OUT, 'custom.png');
    fs.mkdirSync(OUT, { recursive: true });
    // the room title (it never fades: the loop is stopped) would sit over the pictures – hidden for the shot only
    await page.addStyleTag({ content: '.kv-room, .kv-room * { visibility: hidden !important; }' });
    await page.screenshot({ path: shot });
    console.log(`[artcheck] custom view ${path.relative(ROOT, shot)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// catalog: every kunst product and variant builds (twice: the second time from the caches)

async function catalogPage() {
  const R = await import('/src/models/registry.js');
  const C = await import('/src/catalog/index.js');
  const D = await import('/src/models/decor.js');
  const list = C.products('kunst');
  const out = { products: list.length, specs: 0, problems: [], ms: 0, ms2: 0, stats: null };
  for (const pass of [0, 1]) {
    const t0 = performance.now();
    for (const p of list) {
      for (let vi = 0; vi < Math.max(1, p.variants?.length || 0); vi++) {
        const spec = C.productToItemSpec(p, vi);
        const g = R.buildModel({ ...spec, quality: 'medium' });
        if (pass) continue;
        out.specs++;
        if (g.userData.model?.fallback) out.problems.push(`${p.id} v${vi}: fallback model`);
        else if (!g.userData.model?.parts?.print?.length) out.problems.push(`${p.id} v${vi}: no print part`);
      }
    }
    out[pass ? 'ms2' : 'ms'] = performance.now() - t0;
  }
  out.stats = D._artDebug.stats();
  return out;
}

async function runCatalog(page) {
  const d = await page.evaluate(catalogPage);
  for (const p of d.problems) flag('catalog', p);
  if (!d.problems.length) ok('catalog', `${d.products} products, ${d.specs} variants build with a print part`);
  if (d.ms > 2500) flag('catalog', `cold build ${Math.round(d.ms)} ms > 2500 ms`);
  else ok('catalog', `cold build ${Math.round(d.ms)} ms, warm ${Math.round(d.ms2)} ms`);
  for (const k of ['motifs', 'atlas', 'custom']) {
    const s = d.stats[k];
    if (s.px > s.budgetPx && s.inUse < s.entries) flag('catalog', `${k} cache over budget with unused entries: ${JSON.stringify(s)}`);
    else ok('catalog', `${k} cache ${s.entries} entries, ${(s.px / 1e6).toFixed(1)} of ${(s.budgetPx / 1e6).toFixed(0)} Mpx (${s.inUse} in use)`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// research: staged kunst products (research/runde3) built and laid out before the integrator merges them (MASTER D48)

function researchProducts() {
  const arg = typeof opt.research === 'string' && opt.research !== 'true' ? opt.research : null;
  const files = [];
  const add = (p) => {
    const abs = path.resolve(ROOT, p);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) for (const n of fs.readdirSync(abs).sort()) if (/^kunst.*\.json$/.test(n)) files.push(path.join(abs, n));
    if (fs.statSync(abs).isFile()) files.push(abs);
  };
  if (arg) arg.split(',').forEach((p) => add(p.trim()));
  else add(path.join('research', 'runde3'));
  const list = [];
  for (const file of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      flag('research', `${path.relative(ROOT, file)}: not valid JSON (${e.message})`);
      continue;
    }
    for (const p of Array.isArray(j) ? j : j.products || []) if (p && (p.archetype === 'art-frame' || p.archetype === 'art-set')) list.push({ ...p, _file: path.basename(file) });
  }
  return list;
}

async function researchPage({ list, cols }) {
  const THREE = await import(window.__hus.depUrl('three.js'));
  const R = await import('/src/models/registry.js');
  const G = window.__gallery;
  for (const m of G.models) m.object.visible = false;
  const out = [];
  let cellW = 0.5, cellH = 0.5;
  for (const p of list) {
    cellW = Math.max(cellW, p.dims.w + 0.35);
    cellH = Math.max(cellH, p.dims.h + 0.35);
  }
  list.forEach((p, i) => {
    const r = { id: p.id, file: p._file, problems: [] };
    const nv = Math.max(1, p.variants?.length || 0);
    for (let vi = 0; vi < nv; vi++) {
      const v = p.variants?.[vi] || {};
      const spec = { archetype: p.archetype, dims: p.dims, params: { ...(p.params || {}), ...(v.params || {}), ...(v.paramsOverride || {}) }, colors: v.colors || {}, materials: v.materials || {}, quality: 'medium' };
      let g;
      try {
        g = R.buildModel(spec);
      } catch (e) {
        r.problems.push(`v${vi}: ${e.message}`);
        continue;
      }
      const M = g.userData.model || {};
      if (M.fallback) r.problems.push(`v${vi}: fallback model`);
      else if (!M.parts?.print?.length) r.problems.push(`v${vi}: no print part`);
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      const hanger = spec.params.frame === 'hanger';
      const tx = hanger ? 0.0055 : 0.003, ty = hanger ? 0.125 : 0.003;
      if (bb.min.x < -p.dims.w / 2 - tx || bb.max.x > p.dims.w / 2 + tx || bb.min.y < -p.dims.h / 2 - 0.003 || bb.max.y > p.dims.h / 2 + ty || bb.min.z < -0.003 || bb.max.z > p.dims.d + 0.003) {
        r.problems.push(`v${vi}: outside dims (${[bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z].map((x) => x.toFixed(3)).join(' ')})`);
      }
      if (vi === 0) {
        const col = i % cols, row = Math.floor(i / cols);
        g.position.set((col - (cols - 1) / 2) * cellW, -row * cellH, 0);
        G.scene.add(g);
      }
    }
    out.push(r);
  });
  const rows = Math.ceil(list.length / cols);
  const w = cols * cellW, h = rows * cellH, cy = -((rows - 1) * cellH) / 2;
  const dist = (Math.max(w / 1.6, h) / 2 / Math.tan((40 * Math.PI) / 360)) * 1.06;
  window.__setView({ pos: [0, cy, dist], look: [0, cy, 0], fov: 40 });
  return out;
}

async function runResearch(page) {
  const list = researchProducts();
  if (!list.length) {
    console.log('[artcheck] PENDING research: no staged kunst research found');
    return;
  }
  const cols = Math.max(4, Math.ceil(Math.sqrt(list.length * 1.6)));
  const data = await page.evaluate(researchPage, { list, cols });
  await page.waitForTimeout(400);
  const shot = path.join(OUT, 'research.png');
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: shot });
  write(path.join(OUT, 'research-index.json'), JSON.stringify({ cols, cells: data.map((d, i) => ({ cell: i, row: Math.floor(i / cols), col: i % cols, id: d.id, file: d.file })) }, null, 1));
  console.log(`[artcheck] research sheet ${path.relative(ROOT, shot)} (${list.length} products, ${cols} columns, file order)`);
  for (const d of data) {
    if (d.problems.length) flag('research', `${d.id}: ${d.problems.join('; ')}`);
    else ok('research', d.id);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const MODE_PAGES = {
  legacy: '/dev/models.html?arch=art-frame&labels=0',
  motifs: '/dev/models.html?arch=art-frame&labels=0',
  profiles: '/dev/models.html?arch=art-frame&labels=0&bg=%23eeeeee',
  sets: '/dev/models.html?arch=art-set&labels=0&bg=%23eeeeee',
  custom: '/?play=1&nowarm=1&nohelp=1',
  catalog: '/dev/models.html?arch=art-frame&labels=0',
  research: '/dev/models.html?arch=art-frame&labels=0&bg=%23eeeeee',
};
const RUNNERS = {
  legacy: runLegacy,
  motifs: runMotifs,
  profiles: gridRunner('profiles', { cols: 7, cellW: 0.75, cellH: 1.0 }),
  sets: gridRunner('sets', { cols: 5, cellW: 2.3, cellH: 1.75 }),
  custom: runCustom,
  catalog: runCatalog,
  research: runResearch,
};

const release = opt.lock === 'true' ? await acquireGpuLock({ label: `artcheck ${modes.join(',')}` }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'artcheck') });
let toolError = false;
const t0 = Date.now();
try {
  for (const mode of modes) {
    const runner = RUNNERS[mode];
    if (!runner) {
      flag(mode, 'not implemented in this version of artcheck');
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(PAGE_HELPERS);
    const watch = watchPage(page, { quiet: true });
    try {
      await page.goto(pageUrl(MODE_PAGES[mode], port), { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.error(`[artcheck] server ${port} is down? ${e.message}`);
      toolError = true;
      break;
    }
    const err = await waitReady(page, 180000);
    if (err) {
      console.error(`[artcheck] page error (${mode}): ${err}`);
      toolError = true;
      break;
    }
    const t1 = Date.now();
    await runner(page);
    if (watch.errors) flag(mode, `${watch.errors} console error(s)`);
    console.log(`[artcheck] ${mode} done in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    await page.close();
  }
} catch (e) {
  console.error(`[artcheck] ${e.stack ?? e.message}`);
  toolError = true;
} finally {
  await close();
  release?.();
}
console.log(`[artcheck] ${toolError ? 'TOOL ERROR' : flags ? `${flags} flag(s)` : 'OK'} (${((Date.now() - t0) / 1000).toFixed(1)} s, out ${path.relative(ROOT, OUT)})`);
process.exit(toolError || process.exitCode === 2 ? 2 : flags ? 1 : 0);
