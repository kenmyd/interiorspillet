#!/usr/bin/env node
/**
 * Catalogue thumbnail check (design/qa.md §4.1; MASTER §4.2 P09, D48): renders every product's thumbnail through the
 * game's own path (src/ui/CatalogPanel.js thumbnail(), the shared offscreen ThumbRenderer) and flags thumbnails a
 * customer could not use – plus contact sheets per category and, with --photos, compare sheets next to the store's
 * own photo («ligner modellen originalen?»).
 *
 *   node tools/thumbcheck.mjs --port=5190 --lock --step=<pkg>
 *       [--cat=a,b] [--ids=x,y] [--new-since=c28070d] [--variants=default|all|last]
 *       [--research=<file|dir|glob>[,…]] [--sheets] [--photos] [--save=flagged|all|none]
 *       [--out=<dir>] [--json=<file>] [--allow=tools/thumbcheck-allow.json] [--browser=msedge|chrome]
 *
 *   --cat / --ids      only these categories / product ids
 *   --new-since=<ref>  only products that are not in `git show <ref>:src/data/catalog/<key>.json` (read-only git;
 *                      falls back to tools/house-tests/fixtures/catalog-baseline.json)
 *   --variants         default (the default variant), all, last (the default and the last)
 *   --research=…       staged research files instead of the catalogue: normalised in a temp folder through
 *                      tools/check-research.mjs (never src/data), then rendered in the page with the game's own
 *                      productToItemSpec – the products need not be in the catalogue yet
 *   --sheets           contact sheets per category: <out>/sheets/<cat>-<n>.png (6 × 8 cells of 240 × 180 + label;
 *                      flagged cells framed red, warnings orange; 1452 px wide, readable with an image viewer)
 *   --photos           compare sheets <out>/sheets/<cat>-compare-<n>.html + .png: our thumbnail | the store photo
 *                      (imageUrl, loaded by the browser like the game's detail view does) | name, store, price, dims,
 *                      verified, flags. Implies --save=all for the selected products. Network.
 *   --save             thumbnails written as <out>/<id>-v<vi>.jpg (default: flagged; all with --photos)
 *   --out              default .shots/<step>/thumbcheck (without --step: .shots/thumbcheck)
 *   --allow            allow-list { "<id>": { "flags": ["BLACK"], "reason": "…", "variants": [3] } } – only products from
 *                      before the round (fixtures/catalog-baseline.json) may be on it; «variants» (optional) limits the
 *                      entry to those variant indices; a stale entry (its variants rendered, nothing flagged) prints
 *                      «fjern fra allow-listen»
 *   --lock --step      the shared GPU lock and the browser pidfile (tools/lib/hus.mjs); a hung run is stopped with
 *                      node tools/stop-browser.mjs --step=<step>. Port default 5190 (this round's test server).
 *
 * Per thumbnail (320 × 240 JPEG decoded in the page): mean/std luminance; cover = share of pixels that differ from the
 * studio backdrop of their row (mean of the 3 leftmost + 3 rightmost pixels); dark = share with L < 16; fgMean = mean L
 * of the covered pixels; fgBox = their pixel bbox; bright = share of covered pixels with L > 235; lensL = max L in the
 * central 40 % of the frame; shadow = share of the covered pixels that are the studio's soft contact shadow (on the
 * line backdrop → #2a2219 at ≤ 50 %; approximate – pale greige products fall in the same band, so it is reported, never
 * a flag on its own); objMean = mean L without them; coreDark = share of pixels with L < 16 in the
 * central 50 % of the product's box without the shadow. The model is built once more (quality low) for the grey-box
 * flag and bbox / dims.
 * Flags (CAPITALS = hard, lower case = warning):
 *   FAILED    no thumbnail (build or render threw)
 *   FALLBACK  the registry's grey box (userData.model.fallback)
 *   BLANK     cover < 0.01 (nothing visible)
 *   BLACK     dark > 0.5, or cover > 0.02 with fgMean < 22 – «dark» (warning) instead when the product itself is dark
 *             (median relative luminance of the variant's part colours < 0.05: PH 5 Black); mirrors (mirror,
 *             mirror-floor, mirror-cabinet) also when coreDark > 0.6 – black glass, whatever the frame's colour
 *   EDGE      cover < 0.03 and the covered box < 10 px high or wide (a flat product seen edge-on)
 *   DIMS      framed family (art, mirrors): model w or h outside 0.9–1.1 × dims (also the canvas archetypes Node
 *             cannot build)
 *   NOGLOW    spotter: no pixel with L ≥ 220 in the central 40 % (the lit lens must read)
 *   CONSOLE   a console.error while this thumbnail rendered
 *   tiny      0.01 ≤ cover < 0.03
 * Writes <out>/report.json (every row + per-category numbers). Exit 0 = nothing hard (after the allow-list), 1 = a
 * hard flag, a console error or a bad allow-list entry, 2 = the tool or page failed (server down …).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// the tool lives in tools/; CR_ROOT points a staged copy at the project (its self-test)
const TOOLS = process.env.CR_ROOT ? pathToFileURL(`${path.resolve(process.env.CR_ROOT, 'tools')}${path.sep}`).href : new URL('./', import.meta.url).href;
const { parseArgs, ROOT, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit } = await import(new URL('lib/hus.mjs', TOOLS).href);

const { opt } = parseArgs();
const KNOWN_OPTS = ['port', 'lock', 'step', 'cat', 'ids', 'new-since', 'variants', 'research', 'sheets', 'photos', 'save', 'out', 'json', 'allow', 'browser', 'pidfile', 'help', 'timeout'];
const bad = Object.keys(opt).filter((k) => !KNOWN_OPTS.includes(k));
if (opt.help || bad.length) {
  if (bad.length) console.error(`thumbcheck: ukjent valg --${bad.join(' --')}`);
  console.log('bruk: node tools/thumbcheck.mjs --port=5190 --lock --step=<pakke> [--cat=] [--ids=] [--new-since=<ref>] [--variants=default|all|last] [--research=<fil|mappe>] [--sheets] [--photos] [--save=flagged|all|none] [--out=] [--json=] [--allow=] [--browser=]');
  process.exit(bad.length ? 2 : 0);
}
const port = Number(opt.port ?? 5190);
const OUT = path.resolve(ROOT, opt.out ?? path.join('.shots', opt.step ?? '', 'thumbcheck'));
const photos = opt.photos === 'true';
const sheets = opt.sheets === 'true' || photos;
const save = opt.save ?? (photos ? 'all' : 'flagged');
const variants = opt.variants ?? 'default';
if (!['default', 'all', 'last'].includes(variants) || !['flagged', 'all', 'none'].includes(save)) {
  console.error(`thumbcheck: --variants=${variants} / --save=${save} er ikke gyldig`);
  process.exit(2);
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const BASE = readJson(path.join(ROOT, 'tools', 'house-tests', 'fixtures', 'catalog-baseline.json'));
const BASE_IDS = new Set(Object.values(BASE.products).flat());

// ---- allow-list
const allowFile = path.resolve(ROOT, opt.allow ?? path.join('tools', 'thumbcheck-allow.json'));
let allow = {};
const allowProblems = [];
if (fs.existsSync(allowFile)) {
  try {
    allow = readJson(allowFile);
  } catch (e) {
    console.error(`thumbcheck: kan ikke lese ${allowFile}: ${e.message}`);
    process.exit(2);
  }
  for (const [id, a] of Object.entries(allow)) {
    if (id.startsWith('$') || id.startsWith('_')) continue; // comments
    if (!BASE_IDS.has(id)) allowProblems.push(`${id}: bare produkter fra før runden kan stå på allow-listen (nye feil skal rettes, ikke skjules)`);
    if (!Array.isArray(a?.flags) || !a.flags.length || typeof a.reason !== 'string' || !a.reason) allowProblems.push(`${id}: trenger «flags» og «reason»`);
    if (a?.variants !== undefined && !(Array.isArray(a.variants) && a.variants.length && a.variants.every((v) => Number.isInteger(v) && v >= 0))) allowProblems.push(`${id}: «variants» skal være en liste med variantnumre (0, 1, …)`);
  }
} else if (opt.allow) {
  console.error(`thumbcheck: --allow=${opt.allow} finnes ikke`);
  process.exit(2);
}

// ---- selection: --new-since (ids that existed at <ref>)
let oldIds = null;
if (opt['new-since']) {
  const ref = opt['new-since'];
  oldIds = new Set();
  let viaGit = true;
  for (const key of BASE.categories.concat(['spotter', 'kunst'])) {
    const r = spawnSync('git', ['show', `${ref}:src/data/catalog/${key}.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      if (BASE.categories.includes(key)) viaGit = false;
      continue;
    }
    try {
      for (const p of JSON.parse(r.stdout)) oldIds.add(p.id);
    } catch {
      viaGit = false;
    }
  }
  if (!viaGit) {
    console.log(`thumbcheck: git show ${ref} virket ikke – bruker fixtures/catalog-baseline.json`);
    oldIds = new Set(BASE_IDS);
  }
}

// ---- research products (normalised in a temp folder through check-research)
let research = null;
if (opt.research) {
  const CR = await import(new URL('check-research.mjs', TOOLS).href);
  const inputs = opt.research.split(',').map((s) => s.trim()).filter(Boolean);
  let res;
  try {
    res = await CR.checkResearch(inputs, { cwd: process.cwd() });
  } catch (e) {
    console.error(`thumbcheck: --research: ${e.message}`);
    process.exit(2);
  }
  research = [];
  for (const f of res.files) {
    for (const p of f.products) {
      if (p.normalisedProduct) research.push({ ...p.normalisedProduct, _file: f.rel, _src: { imageUrl: p.src?.imageUrl, verified: p.src?.verified } });
      else console.log(`  hoppet over ${p.id} (${f.rel}): ikke normalisert – kjør check-research på filen`);
    }
  }
  console.log(`thumbcheck: ${research.length} forskningsprodukter normalisert fra ${res.files.length} fil(er)`);
  if (!research.length) process.exit(2);
}

const filter = {
  cats: opt.cat ? opt.cat.split(',').map((s) => s.trim()) : null,
  ids: opt.ids ? opt.ids.split(',').map((s) => s.trim()) : null,
  old: oldIds ? [...oldIds] : null,
  variants,
  research,
  sheets,
  baseIds: [...BASE_IDS],
};

// ---------------------------------------------------------------------------------------------------------------
// The page side

async function runPage(page, f) {
  return page.evaluate(async (f) => {
    window.__hus.stop(); // the game loop off: the thumbnail renderer gets the GPU (its own rAF keeps running)
    const cat = await import('/src/catalog/index.js');
    const CP = await import('/src/ui/CatalogPanel.js');
    const reg = await import('/src/models/registry.js');
    const THREE = await import(window.__hus.depUrl('three.js'));
    const schema = (await import('/src/data/archetypes.json')).default;
    const old = f.old ? new Set(f.old) : null;
    const baseIds = new Set(f.baseIds);
    let list = f.research || cat.allProducts();
    if (f.cats) list = list.filter((p) => f.cats.includes(p.category));
    if (f.ids) list = list.filter((p) => f.ids.includes(p.id));
    if (old) list = list.filter((p) => !old.has(p.id));
    // console.error while a thumbnail renders (CONSOLE flag)
    const errs = [];
    const oe = console.error;
    console.error = (...a) => {
      errs.push(a.map(String).join(' ').slice(0, 200));
      oe.apply(console, a);
    };
    const onErr = (e) => errs.push(String(e?.message || e?.reason || e).slice(0, 200));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    const lin = (hex) => {
      const c = new THREE.Color(hex);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // THREE.Color holds linear values
    };
    const stats = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const { data, width: w, height: h } = x.getImageData(0, 0, c.width, c.height);
      let sum = 0, sum2 = 0, fg = 0, dark = 0, fgSum = 0, bright = 0, lensL = 0, lensAll = 0;
      let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
      // the product without the studio's soft contact shadow (CatalogPanel: #2a2219 at ≤ 42 % over the backdrop):
      // a covered pixel on the line backdrop → shadow colour within that alpha is shadow, not product
      const SH = [42, 34, 25];
      let obj = 0, objSum = 0, px0 = w, px1 = -1, py0 = h, py1 = -1;
      const cx0 = w * 0.3, cx1 = w * 0.7, cy0 = h * 0.3, cy1 = h * 0.7;
      for (let y = 0; y < h; y++) {
        let br = 0, bg = 0, bb = 0;
        for (const xx of [0, 1, 2, w - 3, w - 2, w - 1]) {
          const i = (y * w + xx) * 4;
          br += data[i];
          bg += data[i + 1];
          bb += data[i + 2];
        }
        br /= 6;
        bg /= 6;
        bb /= 6;
        for (let xx = 0; xx < w; xx++) {
          const i = (y * w + xx) * 4;
          const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += L;
          sum2 += L * L;
          if (L < 16) dark++;
          const central = xx >= cx0 && xx < cx1 && y >= cy0 && y < cy1;
          if (central && L > lensAll) lensAll = L;
          if (Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb) > 30) {
            if (central && L > lensL) lensL = L; // the product's own brightest pixel (the bright studio backdrop does not count)
            fg++;
            fgSum += L;
            if (L > 235) bright++;
            if (xx < bx0) bx0 = xx;
            if (xx > bx1) bx1 = xx;
            if (y < by0) by0 = y;
            if (y > by1) by1 = y;
            const d0 = br - SH[0], d1 = bg - SH[1], d2 = bb - SH[2];
            const a = ((br - data[i]) * d0 + (bg - data[i + 1]) * d1 + (bb - data[i + 2]) * d2) / Math.max(1, d0 * d0 + d1 * d1 + d2 * d2);
            const res = Math.hypot(br - a * d0 - data[i], bg - a * d1 - data[i + 1], bb - a * d2 - data[i + 2]);
            if (!(a >= -0.02 && a <= 0.5 && res < 14)) {
              obj++;
              objSum += L;
              if (xx < px0) px0 = xx;
              if (xx > px1) px1 = xx;
              if (y < py0) py0 = y;
              if (y > py1) py1 = y;
            }
          }
        }
      }
      // coreDark: share of near-black pixels (L < 16) in the middle of the product (central 50 % of its box without
      // the shadow) – a mirror's glass sits there (black glass = the studio has nothing to reflect)
      let core = 0, coreDarkN = 0;
      if (obj) {
        const qx = (px1 - px0 + 1) / 4, qy = (py1 - py0 + 1) / 4;
        for (let y = Math.ceil(py0 + qy); y <= Math.floor(py1 - qy); y++) {
          for (let xx = Math.ceil(px0 + qx); xx <= Math.floor(px1 - qx); xx++) {
            const i = (y * w + xx) * 4;
            core++;
            if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] < 16) coreDarkN++;
          }
        }
      }
      const n = w * h, mean = sum / n;
      return {
        mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), cover: +(fg / n).toFixed(4), dark: +(dark / n).toFixed(4),
        fgMean: fg ? +(fgSum / fg).toFixed(1) : null, fgBox: fg ? [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1] : null, bright: fg ? +(bright / fg).toFixed(4) : 0, lensL: Math.round(lensL), lensAll: Math.round(lensAll),
        objMean: obj ? +(objSum / obj).toFixed(1) : null, shadow: fg ? +((fg - obj) / fg).toFixed(3) : 0, coreDark: core ? +(coreDarkN / core).toFixed(3) : 0,
      };
    };
    const SPOTS = new Set(['downlight', 'downlight-surface', 'spot-ceiling', 'spot-track', 'spot-wall', 'picture-light']);
    const MIRRORS = new Set(['mirror', 'mirror-floor', 'mirror-cabinet']);
    const out = [];
    const urls = new Map();
    for (const p of list) {
      const last = (p.variants?.length || 1) - 1;
      const def = p.defaultVariant ?? 0;
      const vis = f.variants === 'all' ? p.variants.map((_, i) => i) : f.variants === 'last' ? [...new Set([def, last])] : [def];
      for (const vi of vis) {
        const e0 = errs.length;
        const r = { id: p.id, vi, cat: p.category, sub: p.subcategory ?? null, arch: p.archetype, mount: p.mount, name: p.name, store: p.store, isNew: !baseIds.has(p.id) };
        if (p._file) r.file = p._file;
        const shading = p.mount === 'window' || p.category === 'solskjerming';
        let spec = null;
        try {
          spec = shading ? null : cat.productToItemSpec(p, vi);
        } catch (e) {
          errs.push(`productToItemSpec: ${e.message}`);
        }
        // the grey box is invisible in the picture's numbers: build once more and ask (+ bbox / dims for framed art)
        let fallback = false, dimsRatio = null;
        if (spec) {
          const ow = console.warn;
          console.warn = () => {};
          try {
            const g = reg.buildModel({ ...spec, quality: 'low' });
            fallback = !!g.userData.model?.fallback;
            if (schema.archetypes[p.archetype]?.family === 'framed') {
              g.updateMatrixWorld(true);
              const box = new THREE.Box3();
              const part = new THREE.Box3();
              g.traverse((o) => {
                if (!o.isMesh || o.userData?.lightDecal) return;
                if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
                box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
              });
              const s = box.getSize(new THREE.Vector3());
              dimsRatio = { w: +(s.x / spec.dims.w).toFixed(3), h: +(s.y / spec.dims.h).toFixed(3) };
            }
            g.traverse((o) => o.geometry?.dispose?.());
          } catch {
            fallback = true;
          } finally {
            console.warn = ow;
          }
        }
        // a dark product (PH 5 Black): BLACK becomes the warning «dark»
        const cols = Object.values(spec?.colors || {}).filter((h) => typeof h === 'string' && /^#?[0-9a-f]{6}$/i.test(h)).map(lin).sort((a, b) => a - b);
        const darkProduct = cols.length ? cols[Math.floor(cols.length / 2)] < 0.05 : false;
        const t = performance.now();
        let url = null;
        try {
          url = await CP.thumbnail(p, vi, { priority: true });
        } catch (e) {
          errs.push(`thumbnail: ${e.message}`);
        }
        r.ms = Math.round(performance.now() - t);
        r.ok = !!url;
        r.fallback = fallback;
        if (dimsRatio) r.dimsRatio = dimsRatio;
        if (url) Object.assign(r, await stats(url));
        const flags = [];
        if (!url) flags.push('FAILED');
        if (fallback) flags.push('FALLBACK');
        if (url && r.cover < 0.01) flags.push('BLANK');
        // mirror glass is never meant to be black, whatever the frame's colour: the middle of the product decides
        const glassBlack = !!url && MIRRORS.has(p.archetype) && r.coreDark > 0.6;
        if (url && (r.dark > 0.5 || (r.cover > 0.02 && r.fgMean != null && r.fgMean < 22))) flags.push(darkProduct && !glassBlack ? 'dark' : 'BLACK');
        else if (glassBlack) flags.push('BLACK');
        if (url && r.cover < 0.03 && r.fgBox && (r.fgBox[2] < 10 || r.fgBox[3] < 10)) flags.push('EDGE');
        if (dimsRatio && ((dimsRatio.w < 0.9 || dimsRatio.w > 1.1) || (dimsRatio.h < 0.9 || dimsRatio.h > 1.1))) flags.push('DIMS');
        if (url && (p.category === 'spotter' || SPOTS.has(p.archetype)) && r.lensL < 220) flags.push('NOGLOW');
        if (url && r.cover >= 0.01 && r.cover < 0.03) flags.push('tiny');
        r.errors = errs.slice(e0);
        if (r.errors.length) flags.push('CONSOLE');
        r.flags = flags;
        const pr = (() => {
          try {
            return cat.priceOf(p, vi)?.price ?? p.priceNok ?? null;
          } catch {
            return p.priceNok ?? null;
          }
        })();
        r.price = pr;
        r.dims = p.dims;
        r.imageUrl = p.variants?.[vi]?.imageUrl || p.imageUrl || p._src?.imageUrl || null;
        r.verified = p.verified ?? p._src?.verified ?? null;
        r.variantName = p.variants?.[vi]?.name ?? '';
        if (url) urls.set(`${p.id}|${vi}`, url);
        out.push(r);
      }
    }
    console.error = oe;
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onErr);
    window.__thumbUrls = urls;
    return out;
  }, f);
}

/** Contact sheets per category, composed in the page (6 × 8 cells of 240 × 180 + a 34 px label). */
async function makeSheets(page, rows, prefix) {
  return page.evaluate(async ({ rows, prefix }) => {
    const urls = window.__thumbUrls || new Map();
    const COLS = 6, ROWS = 8, CW = 240, CH = 180, LH = 34, GAP = 2;
    const byCat = new Map();
    for (const r of rows) {
      if (!byCat.has(r.cat)) byCat.set(r.cat, []);
      byCat.get(r.cat).push(r);
    }
    const sheets = [];
    for (const [c, list] of byCat) {
      for (let s = 0; s * COLS * ROWS < list.length; s++) {
        const part = list.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
        const nr = Math.ceil(part.length / COLS);
        const cv = document.createElement('canvas');
        cv.width = COLS * (CW + GAP) + GAP;
        cv.height = 22 + nr * (CH + LH + GAP) + GAP;
        const x = cv.getContext('2d');
        x.fillStyle = '#ffffff';
        x.fillRect(0, 0, cv.width, cv.height);
        x.fillStyle = '#222';
        x.font = 'bold 14px sans-serif';
        x.fillText(`${prefix}${c} – ark ${s + 1} (${s * COLS * ROWS + 1}–${s * COLS * ROWS + part.length} av ${list.length})`, 6, 16);
        for (let i = 0; i < part.length; i++) {
          const r = part[i];
          const cx = GAP + (i % COLS) * (CW + GAP), cy = 22 + GAP + Math.floor(i / COLS) * (CH + LH + GAP);
          const url = urls.get(`${r.id}|${r.vi}`);
          if (url) {
            const img = new Image();
            img.src = url;
            await img.decode();
            x.drawImage(img, cx, cy, CW, CH);
          } else {
            x.fillStyle = '#f6d5d5';
            x.fillRect(cx, cy, CW, CH);
          }
          // «(BLACK)» = allow-listed: drawn as a warning
          const hard = r.flags.filter((fl) => fl === fl.toUpperCase() && !fl.startsWith('('));
          const warn = r.flags.filter((fl) => !hard.includes(fl));
          if (hard.length || warn.length) {
            x.strokeStyle = hard.length ? '#d01818' : '#e08a00';
            x.lineWidth = 3;
            x.strokeRect(cx + 1.5, cy + 1.5, CW - 3, CH - 3);
            x.fillStyle = hard.length ? '#d01818' : '#e08a00';
            x.font = 'bold 12px sans-serif';
            x.fillText([...hard, ...warn].join(' '), cx + 6, cy + 16);
          }
          x.fillStyle = '#111';
          x.font = '11px sans-serif';
          const name = String(r.name || r.id);
          x.fillText(name.length > 32 ? `${name.slice(0, 31)}…` : name, cx + 2, cy + CH + 13);
          x.fillStyle = '#555';
          const price = r.price != null ? `${Math.round(r.price).toLocaleString('nb-NO')} kr` : '–';
          x.fillText(`${r.store || ''} · ${price} · v${r.vi}${r.isNew ? ' · ny' : ''}`.slice(0, 44), cx + 2, cy + CH + 28);
        }
        sheets.push({ name: `${prefix}${c}-${s + 1}.png`, data: cv.toDataURL('image/png') });
      }
    }
    return sheets;
  }, { rows, prefix });
}

/** Compare sheets: our thumbnail | the store photo | facts (12 rows per page), as HTML + a full-page PNG. */
function compareHtml(list, title) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cm = (d) => (d ? `${Math.round(d.w * 100)} × ${Math.round(d.d * 100)} × ${Math.round(d.h * 100)} cm` : '–');
  const rows = list.map((r) => `<tr><td><img class="t" src="../${esc(`${r.id}-v${r.vi}.jpg`)}"></td>`
    + `<td>${r.imageUrl ? `<img class="p" src="${esc(r.imageUrl)}" referrerpolicy="no-referrer">` : '<i>ingen butikkfoto</i>'}</td>`
    + `<td><b>${esc(r.name)}</b><br>${esc(r.variantName)}<br>${esc(r.store)} · ${r.price != null ? `${Math.round(r.price)} kr` : '–'}<br>${cm(r.dims)}<br>`
    + `${esc(r.arch)}${r.sub ? ` · ${esc(r.sub)}` : ''}<br>verifisert ${r.verified === true ? '✓' : r.verified === false ? '✗' : '?'}`
    + `${r.flags.length ? `<br><span class="f">${esc(r.flags.join(' '))}</span>` : ''}<br><small>${esc(r.id)} v${r.vi}</small></td></tr>`).join('\n');
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:13px system-ui,sans-serif;margin:8px;background:#fff;color:#111} h1{font-size:15px;margin:4px 0 8px}
table{border-collapse:collapse} td{border:1px solid #ccc;padding:4px;vertical-align:top} td:last-child{width:330px}
img.t{width:320px;height:240px;display:block} img.p{max-width:320px;max-height:240px;display:block;margin:auto} .f{color:#c00;font-weight:bold}
</style></head><body><h1>${esc(title)}</h1><table>${rows}</table></body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------

const t0 = Date.now();
let code = 0;
let release = null;
let browserCtl = null;
try {
  const health = await fetch(pageUrl('/', port)).then((r) => r.status).catch(() => 0);
  if (health !== 200) throw Object.assign(new Error(`server ${port} is down (http ${health || 'ingen svar'})`), { tool: true });
  release = opt.lock === 'true' ? await acquireGpuLock({ label: `thumbcheck ${opt.step ?? ''}` }) : null;
  browserCtl = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'thumbcheck') });
  const page = await browserCtl.browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(PAGE_HELPERS);
  await page.addInitScript(settingsInit({ autoResolution: false, showHelpOnStart: false }));
  const watch = watchPage(page, { quiet: true });
  await page.goto(pageUrl('/?play=1&nowarm=1&nohelp=1', port), { waitUntil: 'domcontentloaded' });
  const err = await waitReady(page, Number(opt.timeout ?? 240000));
  if (err || !(await page.evaluate(() => !!window.__game?.home))) throw Object.assign(new Error(`spillet lastet ikke: ${err ?? 'ingen __game.home'}`), { tool: true });
  const readyMs = Date.now() - t0;
  const loadErrors = watch.errors;
  const rows = await runPage(page, filter);
  fs.mkdirSync(OUT, { recursive: true });
  // allow-list
  const allowFor = (r) => {
    const a = allow[r.id];
    return a && (!Array.isArray(a.variants) || a.variants.includes(r.vi)) ? a : null;
  };
  for (const r of rows) {
    const a = allowFor(r);
    if (!a) continue;
    r.allowed = r.flags.filter((fl) => a.flags.includes(fl));
    r.flags = r.flags.filter((fl) => !a.flags.includes(fl)).concat(r.allowed.map((fl) => fl.toLowerCase() === fl ? fl : `(${fl})`));
  }
  const isHard = (fl) => fl === fl.toUpperCase() && !fl.startsWith('(');
  const stale = Object.keys(allow).filter((id) => !id.startsWith('$') && !id.startsWith('_') && rows.some((r) => r.id === id && allowFor(r)) && !rows.some((r) => r.id === id && r.allowed?.length));
  // thumbnails to disk
  const urls = await page.evaluate(({ save, ids }) => {
    const out = {};
    for (const [k, v] of window.__thumbUrls || []) if (save === 'all' || ids.includes(k)) out[k] = v;
    return out;
  }, { save, ids: rows.filter((r) => r.flags.some(isHard) || r.flags.some((fl) => fl !== fl.toUpperCase())).map((r) => `${r.id}|${r.vi}`) });
  if (save !== 'none') {
    for (const [k, v] of Object.entries(urls)) {
      const [id, vi] = k.split('|');
      fs.writeFileSync(path.join(OUT, `${id}-v${vi}.jpg`), Buffer.from(v.split(',')[1], 'base64'));
    }
  }
  const sheetFiles = [];
  if (sheets) {
    fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
    for (const s of await makeSheets(page, rows, research ? 'research-' : '')) {
      const f = path.join(OUT, 'sheets', s.name);
      fs.writeFileSync(f, Buffer.from(s.data.split(',')[1], 'base64'));
      sheetFiles.push(f);
    }
  }
  if (photos) {
    const byCat = new Map();
    for (const r of rows) {
      if (!byCat.has(r.cat)) byCat.set(r.cat, []);
      byCat.get(r.cat).push(r);
    }
    for (const [c, list] of byCat) {
      for (let s = 0; s * 12 < list.length; s++) {
        const name = `${research ? 'research-' : ''}${c}-compare-${s + 1}`;
        const html = path.join(OUT, 'sheets', `${name}.html`);
        fs.writeFileSync(html, compareHtml(list.slice(s * 12, (s + 1) * 12), `${c} – sammenligning ${s + 1}: vår miniatyr | butikkens bilde`));
        const cmp = await browserCtl.browser.newPage({ viewport: { width: 1060, height: 900 } });
        await cmp.goto(pathToFileURL(html).href, { waitUntil: 'load', timeout: 60000 });
        await cmp.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await cmp.screenshot({ path: path.join(OUT, 'sheets', `${name}.png`), fullPage: true });
        await cmp.close();
        sheetFiles.push(path.join(OUT, 'sheets', `${name}.png`));
      }
    }
  }
  // report
  let flagged = 0;
  for (const r of rows) {
    const hard = r.flags.filter(isHard);
    if (hard.length) flagged++;
    if (r.flags.length) console.log(`${hard.length ? 'FLAG' : 'warn'} ${r.flags.join(',').padEnd(16)} ${r.cat}/${r.id}#${r.vi} (${r.arch}, ${r.mount}) cover ${r.cover} dark ${r.dark} fgMean ${r.fgMean} core ${r.coreDark} lensL ${r.lensL}${r.dimsRatio ? ` dims ${r.dimsRatio.w}/${r.dimsRatio.h}` : ''}${r.errors?.length ? `  errors: ${r.errors.join(' | ')}` : ''}`);
  }
  const perCat = {};
  for (const r of rows) {
    const c = (perCat[r.cat] ||= { n: 0, flagged: 0, warnings: 0, ms: [] });
    c.n++;
    if (r.flags.some(isHard)) c.flagged++;
    else if (r.flags.length) c.warnings++;
    c.ms.push(r.ms);
  }
  for (const c of Object.values(perCat)) {
    c.ms.sort((a, b) => a - b);
    c.medianMs = c.ms[Math.floor(c.ms.length / 2)] ?? 0;
    delete c.ms;
  }
  console.log(`\n${'kategori'.padEnd(14)} ${'antall'.padStart(6)} ${'flagget'.padStart(8)} ${'advarsel'.padStart(9)} ${'median ms'.padStart(10)}`);
  for (const [k, c] of Object.entries(perCat)) console.log(`${k.padEnd(14)} ${String(c.n).padStart(6)} ${String(c.flagged).padStart(8)} ${String(c.warnings).padStart(9)} ${String(c.medianMs).padStart(10)}`);
  for (const id of stale) console.log(`merk ${id}: ikke flagget lenger – fjern fra allow-listen`);
  for (const p of allowProblems) console.log(`FEIL allow-listen: ${p}`);
  if (sheetFiles.length) console.log(`ark: ${sheetFiles.length} i ${path.join(OUT, 'sheets')}`);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const summary = { rows: rows.length, flagged, readyMs, totalMs: Date.now() - t0, medianMs: ms[Math.floor(ms.length / 2)] ?? 0, consoleErrorsAtLoad: loadErrors, consoleErrors: watch.errors, perCat, stale, allowProblems, sheets: sheetFiles.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')) };
  const report = { tool: 'thumbcheck', when: new Date().toISOString(), port, filter: { ...filter, old: filter.old ? `${filter.old.length} ids` : null, research: research ? research.length : null, baseIds: undefined }, summary, rows };
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  if (opt.json) fs.writeFileSync(path.resolve(ROOT, opt.json), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\n${rows.length} miniatyrer, ${flagged} flagget, side klar ${readyMs} ms, median ${summary.medianMs} ms, totalt ${summary.totalMs} ms, konsollfeil ${watch.errors} (${loadErrors} under lasting) → ${path.relative(ROOT, OUT) || OUT}`);
  if (flagged || watch.errors || allowProblems.length) code = 1;
} catch (e) {
  console.error(`[thumbcheck] ${e?.tool ? e.message : e?.stack ?? e}`);
  code = 2;
} finally {
  await browserCtl?.close();
  release?.();
}
process.exit(code);
