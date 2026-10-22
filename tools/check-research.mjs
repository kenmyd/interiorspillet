#!/usr/bin/env node
/**
 * Checks research product files before they are published (MASTER D19, D20, D36, D38, D46, D50; catalogdata §6.2;
 * qa §3.4 A) – without touching src/data:
 *
 *   node tools/check-research.mjs <file|dir|glob> [...more] [--build] [--claims=<dir>] [--quiet] [--strict]
 *                                 [--json=<file>] [--keep-tmp] [--today=yyyy-mm-dd]
 *   node tools/check-research.mjs --rules            (lists the rule ids and what they check)
 *
 *   e.g. node tools/check-research.mjs SP/work/RA/draft --build --claims=SP/work/claims
 *        node tools/check-research.mjs "research/runde3/*.json" --build        (the integrator: every file together)
 *
 *   exit 0 = no FAIL (WARNs allowed) · 1 = at least one FAIL · 2 = tool error (no files, bad option, crash)
 *
 * Inputs are files, directories (their *.json, not recursive) or globs (`*`, `?`, `**`; quote them in PowerShell).
 * Files whose name is in the pre-round list (tools/house-tests/fixtures/catalog-baseline.json `researchNewFiles`, e.g.
 * research/catalog-new/vitrineskap.json) get only what the normaliser and test-design need; every other file gets the
 * runde-3 rules too (--strict forces them on every file).
 *
 * 1. Lint every product as written (tools/lib/research-rules.mjs lintProduct; `--rules` lists the rules).
 * 2. Normalise: a temp catalog-new folder = every research/catalog-new/*.json except the ones under test + the files
 *    under test (other agents' research/runde3 files are left out, so their half-done work cannot fail this run), then
 *    `normalize-data.mjs --only=catalog --catalog-new=<tmp>/catalog-new --out=<tmp>/out`. Products the normaliser cannot
 *    take (unknown category/archetype, broken variants) are left out of the copy and FAIL «normalise».
 * 3. On the normalised result: test-design's per-product loop and its KEEP comparison (fixes.mjs honoured).
 * 4. Duplicates (D36): id, url (incl. variant urls) and store SKU (priceNote «varenr./art.nr.» or the url) against
 *    src/data/catalog, research/catalog-new, research/runde3 and the files under test. A product is never a duplicate
 *    of itself; a research/runde3 file with the same name as a file under test is the older copy of it and is skipped.
 *    Also: the same motif + seed + palette twice in kunst (WARN), and with --claims a missing claim folder (WARN).
 * 5. --build: every product's default and last variant is built in Node through the registry Def
 *    (def.build(mergeSpec(def, productToItemSpec(p, vi)))): a throwing builder FAILs, except canvas-only errors
 *    (art in Node: SKIP); an archetype without a builder yet (stub) is a WARN; bbox vs dims beyond ±20 % (a wall
 *    lamp's visible plug cord, params.plug, is not part of the bbox) and a lamp without lights are WARNs.
 * 6. One line per product (`ok` / `WARN` / `FAIL id` + its findings), totals per category, subcategory and store, the
 *    verified ratio, and the last line «N FAIL, M WARN …». The temp folder is deleted (--keep-tmp keeps it).
 *
 * Programmatic (catalog-round.test, thumbcheck --research): checkResearch(inputs, opts) → result, expandInputs(args),
 * normaliseResearch(entries, tmp) → { ok, catalog: Map<id, product>, … }.
 */
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROOT, SCHEMA, RULES, lintFileName, lintProduct, loopProblems, keepProblems, makeIndex, claimKeys, artKey, isStrictFile, makeContext, today,
} from './lib/research-rules.mjs';

// Vite imports JSON and CSS natively; Node needs these hooks before anything imports src/ (like tools/test-design.mjs)
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
    }
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const NORMALIZER = path.join(ROOT, 'src', 'data', 'scripts', 'normalize-data.mjs');
const CATALOG_NEW = path.join(ROOT, 'research', 'catalog-new');
const RUNDE3 = path.join(ROOT, 'research', 'runde3');
const SRC_CATALOG = path.join(ROOT, 'src', 'data', 'catalog');
const BASELINE = path.join(ROOT, 'tools', 'house-tests', 'fixtures', 'catalog-baseline.json');
/** Builder errors that only mean «needs a canvas / the DOM» (art in Node): skipped, not failed (MASTER §4.2 P09). */
const CANVAS_ONLY = /document is not defined|window is not defined|OffscreenCanvas|getContext|createElement|Image is not defined/i;

/** Short display path: relative to the project, else «…/<last 3 segments>» (scratch folders are long). */
const rel = (f) => {
  const r = path.relative(ROOT, f);
  if (r && !r.startsWith('..') && !path.isAbsolute(r)) return r.replace(/\\/g, '/');
  const segs = path.resolve(f).replace(/\\/g, '/').split('/');
  return segs.length > 4 ? `…/${segs.slice(-3).join('/')}` : segs.join('/');
};
const listJson = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort() : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normId = (id) => String(id ?? '').trim().toLowerCase().replace(/[^a-z0-9æøå-]+/g, '-');
const F = (rule, msg) => ({ level: 'FAIL', rule, msg });
const W = (rule, msg) => ({ level: 'WARN', rule, msg });

// ---------------------------------------------------------------------------------------------------------------
// Inputs

/** Files of the arguments: files, directories (*.json inside) and globs. @returns {{ files: string[], errors: string[] }} */
export function expandInputs(args, cwd = process.cwd()) {
  const files = [];
  const errors = [];
  for (const raw of args) {
    const a = String(raw).replace(/\\/g, '/');
    const abs = path.resolve(cwd, a);
    if (fs.existsSync(abs)) {
      if (fs.statSync(abs).isDirectory()) {
        const inDir = listJson(abs).map((f) => path.join(abs, f));
        if (!inDir.length) errors.push(`${raw}: ingen .json-filer i mappen`);
        files.push(...inDir);
      } else files.push(abs);
    } else if (/[*?[]/.test(a)) {
      const hits = glob(a, cwd);
      if (!hits.length) errors.push(`${raw}: ingen filer passer`);
      files.push(...hits);
    } else errors.push(`${raw}: finnes ikke`);
  }
  const seen = new Set();
  return { files: files.map((f) => path.resolve(f)).filter((f) => !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase())), errors };
}

/** A small glob: `*` and `?` inside one path segment, `**` for any depth, `[…]` classes. Case-insensitive (Windows). */
function glob(pattern, cwd) {
  const abs = /^([a-z]:)?\//i.test(pattern) ? pattern : `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/${pattern}`;
  const segs = abs.split('/');
  let i = 0;
  while (i < segs.length && !/[*?[]/.test(segs[i])) i++;
  let base = segs.slice(0, i).join('/') || '/';
  if (/^[a-z]:$/i.test(base)) base += '/';
  const rest = segs.slice(i).filter(Boolean);
  const toRe = (s) => new RegExp(`^${s.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i');
  const entries = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const out = [];
  const walk = (dir, k) => {
    if (k === rest.length) {
      if (fs.existsSync(dir) && fs.statSync(dir).isFile()) out.push(path.resolve(dir));
      return;
    }
    if (rest[k] === '**') {
      walk(dir, k + 1);
      for (const e of entries(dir)) if (e.isDirectory()) walk(path.join(dir, e.name), k);
      return;
    }
    const re = toRe(rest[k]);
    for (const e of entries(dir)) if (re.test(e.name)) walk(path.join(dir, e.name), k + 1);
  };
  walk(base, 0);
  return [...new Set(out)].sort();
}

/** Parses a research file: { products } or { error } (with line and column when JSON.parse names a position). */
function readResearchFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { error: `kan ikke lese filen: ${err.message}` };
  }
  if (text.charCodeAt(0) === 0xfeff) return { error: 'filen starter med en BOM (UTF-8 med signatur) – normaliseringen kan ikke lese den; lagre som UTF-8 uten BOM' };
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? { products: data } : { error: 'filen er ikke en JSON-liste [ { …produkt… }, … ]' };
  } catch (err) {
    let where = '';
    const m = /position (\d+)/.exec(err.message);
    if (m && !/line \d+/.test(err.message)) {
      const before = text.slice(0, Number(m[1]));
      where = ` (linje ${before.split('\n').length}, kolonne ${Number(m[1]) - before.lastIndexOf('\n')})`;
    }
    return { error: `JSON-feil: ${err.message}${where}` };
  }
}

/** A list from another research file, read leniently (a broken file is just skipped). */
function readLenient(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Normalisation in a temp folder (never src/data)

/**
 * Runs the normaliser over research/catalog-new (minus the files under test) + the given product lists.
 * @param {Array<{ file: string, products: object[] }>} entries  products already filtered to what the normaliser takes
 * @param {string} tmp  an empty temp folder
 * @returns {{ ok: boolean, error?: string, notes: string[], catalog: Map<string, object>, out: string }}
 */
export function normaliseResearch(entries, tmp) {
  const cn = path.join(tmp, 'catalog-new');
  fs.mkdirSync(cn, { recursive: true });
  const tested = new Set(entries.map((e) => path.basename(e.file).toLowerCase()));
  for (const f of listJson(CATALOG_NEW)) if (!tested.has(f.toLowerCase())) fs.copyFileSync(path.join(CATALOG_NEW, f), path.join(cn, f));
  const used = new Set();
  for (const e of entries) {
    let name = path.basename(e.file);
    while (used.has(name.toLowerCase())) name = name.replace(/\.json$/i, '~.json');
    used.add(name.toLowerCase());
    fs.writeFileSync(path.join(cn, name), `${JSON.stringify(e.products, null, 2)}\n`, 'utf8');
  }
  const out = path.join(tmp, 'out');
  const res = spawnSync(process.execPath, [NORMALIZER, '--only=catalog', `--out=${out}`, `--catalog-new=${cn}`, '--verbose'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const lines = String(res.stdout || '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith('catalog:'));
  const notes = at >= 0 ? lines.slice(at + 1).filter(Boolean) : [];
  if (res.status !== 0) {
    const err = String(res.stderr || res.error || '').split(/\r?\n/).find((l) => /error|unknown|cannot|throw/i.test(l)) || String(res.stderr || '').split(/\r?\n/)[0];
    return { ok: false, error: `normalize-data.mjs avsluttet med ${res.status}: ${err || '(ingen melding)'}`, notes, catalog: new Map(), out };
  }
  const catalog = new Map();
  for (const f of listJson(path.join(out, 'catalog'))) {
    for (const p of JSON.parse(fs.readFileSync(path.join(out, 'catalog', f), 'utf8'))) catalog.set(p.id, p);
  }
  return { ok: true, notes, catalog, out };
}

// ---------------------------------------------------------------------------------------------------------------
// The check

/** three.js from the project (the same module file the app's `import 'three'` loads). */
async function importThree() {
  // require.resolve('three') → <three>/build/three.cjs; the ESM entry the app imports sits next to it
  const req = createRequire(path.join(ROOT, 'package.json'));
  return import(pathToFileURL(path.join(path.dirname(req.resolve('three')), 'three.module.js')).href);
}

/**
 * @param {string[]} inputs  files, directories or globs
 * @param {{ build?: boolean, claims?: string|null, strict?: boolean, today?: string, keepTmp?: boolean, cwd?: string }} opts
 * @returns {Promise<object>} { files: [{ file, rel, strict, error?, findings, products: [{ index, id, src, findings, … }] }], counts, notes, tmp? }
 */
export async function checkResearch(inputs, opts = {}) {
  const { files, errors } = expandInputs(inputs, opts.cwd);
  if (errors.length) throw Object.assign(new Error(errors.join('\n')), { tool: true });
  if (!files.length) throw Object.assign(new Error('ingen filer å sjekke'), { tool: true });
  let claimsDir = null;
  if (opts.claims) {
    claimsDir = path.resolve(opts.cwd || process.cwd(), opts.claims);
    if (!fs.existsSync(claimsDir) || !fs.statSync(claimsDir).isDirectory()) throw Object.assign(new Error(`--claims: mappen ${opts.claims} finnes ikke`), { tool: true });
  }
  const notes = [];
  const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const baseFiles = base.researchNewFiles || [];
  const baseArchetypes = new Set(Array.isArray(base.archetypes) ? base.archetypes : Object.keys(base.archetypes || {}));
  const ctx = await makeContext({ imp, today: opts.today });
  for (const m of ctx.missing) notes.push(`merk: kunne ikke laste ${m} (reglene bruker de innebygde tabellene)`);
  const ctxStrict = { ...ctx, strict: true };
  const ctxLenient = { ...ctx, strict: false };
  const { CATEGORY_KEYS } = await imp('src/data/scripts/normalize-data.mjs');
  const { PRODUCTS: FIXES } = await imp('src/data/scripts/fixes.mjs');

  // 1. read + lint
  const report = files.map((file) => {
    const strict = !!opts.strict || isStrictFile(file, baseFiles);
    const r = { file, rel: rel(file), strict, findings: strict ? lintFileName(file) : [], products: [] };
    const read = readResearchFile(file);
    if (read.error) {
      r.error = read.error;
      r.findings.push(F('json', read.error));
      return r;
    }
    read.products.forEach((src, index) => {
      const findings = lintProduct(src, r.strict ? ctxStrict : ctxLenient);
      r.products.push({ index, src, id: isObj(src) && typeof src.id === 'string' ? src.id : `#${index}`, findings });
    });
    return r;
  });

  // display names double as index sources: keep them unique
  const relSeen = new Map();
  for (const r of report) relSeen.set(r.rel, (relSeen.get(r.rel) || 0) + 1);
  for (const r of report) if (relSeen.get(r.rel) > 1) r.rel = r.file.split(path.sep).join('/');

  // 2. normalise what the normaliser can take
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-research-'));
  let norm = { ok: false, catalog: new Map(), notes: [] };
  try {
    const entries = [];
    for (const r of report) {
      if (r.error) continue;
      const fallback = path.basename(r.file).replace(/\.json$/i, '').split('-')[0];
      const keep = [];
      for (const p of r.products) {
        const s = p.src;
        const why = !isObj(s) ? 'ikke et objekt'
          : !CATEGORY_KEYS.includes(String(s.category || fallback).trim()) ? `ukjent kategori «${s.category ?? fallback}»`
            : !(SCHEMA.archetypes[String(s.archetype || '').trim()] || SCHEMA.archetypeAliases[String(s.archetype || '').trim()]) ? `ukjent arketype «${s.archetype}»`
              : p.findings.some((f) => f.rule === 'shape' && /variants/.test(f.msg)) ? 'variants er ødelagt'
                : null;
        if (why) p.findings.push(F('normalise', `ikke normalisert (${why}) – loop/KEEP er ikke sjekket`));
        else {
          p.normalised = true;
          keep.push(s);
        }
      }
      entries.push({ file: r.file, products: keep });
    }
    norm = normaliseResearch(entries, tmp);
    if (!norm.ok) {
      for (const r of report) if (!r.error) r.findings.push(F('normalise', norm.error));
    }

    // 3. loop + KEEP on the normalised products (+ the normaliser's notes on runde-3 products)
    const fixes = FIXES || {};
    for (const r of report) {
      for (const p of r.products) {
        if (!p.normalised || !norm.ok) continue;
        const n = norm.catalog.get(normId(p.src.id));
        p.normalisedProduct = n || null;
        const keep = keepProblems(p.src, n, fixes[p.src.id] || {});
        if (keep.length) p.findings.push(F('keep', `normaliseringen endrer produktet (test-design KEEP): ${keep.slice(0, 6).join(' | ')}${keep.length > 6 ? ` | … (${keep.length})` : ''}`));
        if (n) {
          const loop = loopProblems(n, ctx);
          if (loop.length) p.findings.push(F('loop', `test-design-sjekken feiler: ${loop.slice(0, 6).join(' | ')}`));
        }
        if (r.strict) {
          const re = new RegExp(`(^|[^a-z0-9-])${normId(p.src.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9-])`);
          for (const line of norm.notes) if (re.test(line) && !/replaces the older research product/.test(line)) p.findings.push(W('normalise', `normaliseringen: ${line.trim()}`));
        }
      }
    }
  } finally {
    if (!opts.keepTmp) fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 4. duplicates, art keys, claims
  const testedNames = new Set(report.map((r) => path.basename(r.file).toLowerCase()));
  const testedPaths = new Set(report.map((r) => path.resolve(r.file).toLowerCase()));
  const index = makeIndex();
  const others = [];
  for (const f of listJson(SRC_CATALOG)) others.push([`src/data/catalog/${f}`, readLenient(path.join(SRC_CATALOG, f))]);
  for (const f of listJson(CATALOG_NEW)) if (!testedNames.has(f.toLowerCase())) others.push([`research/catalog-new/${f}`, readLenient(path.join(CATALOG_NEW, f))]);
  for (const f of listJson(RUNDE3)) {
    if (testedNames.has(f.toLowerCase()) || testedPaths.has(path.resolve(RUNDE3, f).toLowerCase())) continue;
    others.push([`research/runde3/${f}`, readLenient(path.join(RUNDE3, f))]);
  }
  for (const [source, list] of others) index.add(list, source);
  for (const r of report) index.add(r.products.map((p) => p.src), r.rel);
  const KIND = { id: 'id-en', url: 'url-en', sku: 'varenummeret' };
  for (const r of report) {
    for (const p of r.products) {
      if (!isObj(p.src)) continue;
      let hits = index.find(p.src, `${r.rel}#${p.index}`);
      // a pre-round file's own products are in the frozen catalogue under the same id; so are a promoted runde-3
      // file's (research/catalog-new) once the integrator has regenerated src/data (MASTER §5 steps 2 and 4)
      const promoted = path.resolve(r.file).toLowerCase().startsWith(path.resolve(CATALOG_NEW).toLowerCase() + path.sep);
      if (!r.strict || promoted) hits = hits.filter((h) => !(h.source.startsWith('src/data/catalog/') && h.id === normId(p.src.id)));
      const byKey = new Map();
      for (const h of hits) {
        const k = `${h.kind}|${h.key}`;
        if (!byKey.has(k)) byKey.set(k, []);
        const list = byKey.get(k);
        if (!list.some((x) => x.id === h.id && x.source === h.source)) list.push(h);
      }
      for (const [k, list] of byKey) {
        const [kind, key] = k.split('|');
        const where = list.slice(0, 3).map((h) => `${h.id} i ${h.source}`).join(', ') + (list.length > 3 ? ` (+${list.length - 3})` : '');
        p.findings.push((r.strict ? F : W)('duplicate', `${KIND[kind]} ${key} finnes allerede: ${where}`));
      }
    }
  }
  // the same motif + seed + palette twice in kunst (WARN)
  const artMap = new Map();
  const addArt = (p, uid, source) => {
    const k = artKey(p);
    if (!k) return;
    if (!artMap.has(k)) artMap.set(k, []);
    artMap.get(k).push({ uid, source, id: p.id });
  };
  for (const p of ctx.products || []) addArt(p, `katalog#${p.id}`, 'katalogen');
  for (const [source, list] of others) if (source.startsWith('research/runde3/')) list.forEach((p, i) => addArt(p, `${source}#${i}`, source));
  for (const r of report) r.products.forEach((p) => addArt(p.src, `${r.rel}#${p.index}`, r.rel));
  for (const r of report) {
    if (!r.strict) continue;
    for (const p of r.products) {
      const k = artKey(p.src);
      const twins = k ? artMap.get(k).filter((e) => e.uid !== `${r.rel}#${p.index}` && !(e.source === 'katalogen' && e.id === p.src.id)) : [];
      if (twins.length) p.findings.push(W('art', `samme motiv + seed + palett som ${twins.slice(0, 2).map((e) => `${e.id} (${e.source})`).join(', ')} – bytt seed eller palett`));
    }
  }
  if (claimsDir) {
    const claims = new Set(fs.readdirSync(claimsDir).map((f) => f.toLowerCase()));
    for (const r of report) {
      if (!r.strict) continue;
      for (const p of r.products) {
        if (!isObj(p.src)) continue;
        const keys = claimKeys(p.src);
        if (!keys.some((k) => claims.has(k.toLowerCase()))) p.findings.push(W('claims', `ingen claim-mappe ${keys.length ? keys.join(' / ') : '(fant ikke varenr. eller url)'} i ${rel(claimsDir)} (mkdir før produktet legges inn)`));
      }
    }
  }

  // 5. build in Node
  const build = { built: 0, skipped: 0, stub: 0, variants: 0 };
  if (opts.build) {
    const reg = ctx.registry;
    if (!reg || !ctx.productToItemSpec) throw Object.assign(new Error(`--build: kunne ikke laste registry/katalog (${ctx.missing.join('; ')})`), { tool: true });
    const mats = await imp('src/home/materials.js');
    mats.configureMaterials?.({ textureRes: 0.125 });
    const THREE = await importThree();
    for (const r of report) {
      for (const p of r.products) {
        const n = p.normalisedProduct;
        if (!n) continue;
        const def = reg.getArchetype(n.archetype);
        if (!def) {
          // pre-round archetypes the registry does not build (curtains: SceneSync's windows) are not ours to judge
          if (baseArchetypes.has(n.archetype)) continue;
          build.stub++;
          p.findings.push(W('build', `ingen bygger for ${n.archetype} ennå (tom stub) – vises som grå boks til den kommer`));
          continue;
        }
        build.built++;
        for (const vi of [...new Set([n.defaultVariant, n.variants.length - 1])]) {
          build.variants++;
          const spec = ctx.productToItemSpec(n, vi);
          const warns = [];
          const ow = console.warn;
          console.warn = (...a) => warns.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
          let g = null;
          let err = null;
          try {
            g = def.build(reg.mergeSpec(def, { ...spec, quality: 'medium' }));
            if (!g?.isObject3D) throw new Error('byggeren returnerte ikke et Object3D');
          } catch (e) {
            err = e;
          } finally {
            console.warn = ow;
          }
          if (err) {
            const msg = String(err?.message || err);
            if (CANVAS_ONLY.test(`${msg}\n${err?.stack || ''}`)) {
              build.skipped++;
              continue;
            }
            p.findings.push(F('build', `${n.archetype} (variant ${vi}) kaster: ${msg.split('\n')[0]}`));
            continue;
          }
          if (warns.length) p.findings.push(W('build', `byggeren advarer (variant ${vi}): ${warns[0].slice(0, 200)}`));
          if (vi !== n.defaultVariant) continue;
          // bbox (light decals and ceiling pools are not the fitting) vs dims; a wall lamp's visible plug cord
          // (params.plug: part 'cord', 45 cm down the wall below the lamp) is not in dims.h either (models.test agrees)
          g.updateMatrixWorld(true);
          const box = new THREE.Box3();
          const part = new THREE.Box3();
          const plugCord = n.mount === 'wall' && !!n.params?.plug;
          g.traverse((o) => {
            if (!o.geometry || o.userData?.lightDecal || o.name === 'ceiling-pool' || o.parent?.userData?.lightDecal) return;
            if (plugCord && o.userData?.part === 'cord') return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            if (o.geometry.boundingBox) box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
          });
          if (!box.isEmpty()) {
            const size = box.getSize(new THREE.Vector3());
            const got = { w: size.x, d: size.z, h: size.y };
            // new products ±20 % (catalogdata §6.2); pre-round products only the regression band of qa §3.3 C
            const [lo, hi, band] = r.strict ? [0.8, 1.2, '±20 %'] : [0.6, 1.9, '0,6–1,9 ×'];
            for (const k of n.mount === 'ceiling' ? ['w', 'd'] : ['w', 'd', 'h']) {
              const ratio = got[k] / n.dims[k];
              if (!(ratio >= lo && ratio <= hi)) p.findings.push(W('build', `modellen er ${k} ${got[k].toFixed(3)} m, dims.${k} ${n.dims[k]} m (utenfor ${band})`));
            }
          }
          if (n.light && g.userData?.model && !(g.userData.model.lights?.length > 0)) p.findings.push(W('build', 'lampen har ingen lys i modellen (userData.model.lights)'));
        }
      }
    }
  }

  // totals
  const counts = { fail: 0, warn: 0, products: 0, ok: 0, byCategory: {}, byStore: {}, verified: 0 };
  for (const r of report) {
    counts.fail += r.findings.filter((f) => f.level === 'FAIL').length;
    counts.warn += r.findings.filter((f) => f.level === 'WARN').length;
    for (const p of r.products) {
      counts.products++;
      const fl = p.findings.filter((f) => f.level === 'FAIL').length;
      counts.fail += fl;
      counts.warn += p.findings.length - fl;
      if (!p.findings.length) counts.ok++;
      if (!isObj(p.src)) continue;
      const cat = `${p.src.category ?? '?'}${p.src.subcategory ? `/${p.src.subcategory}` : ''}`;
      counts.byCategory[cat] = (counts.byCategory[cat] || 0) + 1;
      counts.byStore[p.src.store ?? '?'] = (counts.byStore[p.src.store ?? '?'] || 0) + 1;
      if (p.src.verified === true) counts.verified++;
    }
  }
  return { root: ROOT, today: ctx.today, files: report, counts, build: opts.build ? build : null, notes, tmp: opts.keepTmp ? tmp : null };
}

// ---------------------------------------------------------------------------------------------------------------
// CLI

const USAGE = 'bruk: node tools/check-research.mjs <fil|mappe|glob> [...] [--build] [--claims=<mappe>] [--quiet] [--strict] [--json=<fil>] [--keep-tmp] [--today=yyyy-mm-dd] | --rules';
const FLAGS = ['build', 'quiet', 'strict', 'keep-tmp', 'rules', 'help'];
const OPTIONS = ['claims', 'json', 'today'];

async function main() {
  const argv = process.argv.slice(2);
  const bad = argv.filter((a) => a.startsWith('--') && !FLAGS.includes(a.slice(2)) && !OPTIONS.some((o) => a.startsWith(`--${o}=`)));
  if (bad.length) {
    console.error(`check-research: ukjent valg ${bad.join(' ')}\n${USAGE}`);
    process.exit(2);
  }
  const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
  if (argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  if (argv.includes('--rules')) {
    for (const [id, text] of Object.entries(RULES)) console.log(`${id.padEnd(18)} ${text}`);
    return;
  }
  const today0 = opt('today');
  if (today0 && !/^\d{4}-\d\d-\d\d$/.test(today0)) {
    console.error(`check-research: --today=${today0} er ikke yyyy-mm-dd`);
    process.exit(2);
  }
  const inputs = argv.filter((a) => !a.startsWith('--'));
  if (!inputs.length) {
    console.error(`check-research: ingen filer\n${USAGE}`);
    process.exit(2);
  }
  const quiet = argv.includes('--quiet');
  const t0 = Date.now();
  const res = await checkResearch(inputs, { build: argv.includes('--build'), claims: opt('claims'), strict: argv.includes('--strict'), today: today0 || today(), keepTmp: argv.includes('--keep-tmp') });

  for (const n of res.notes) console.log(n);
  for (const r of res.files) {
    console.log(`\n— ${r.rel} (${r.products.length} produkter${r.strict ? ', runde-3-regler' : ', før-runden-fil: bare normalisering/test-design'})`);
    for (const f of r.findings) if (!quiet || f.level === 'FAIL') console.log(`  ${f.level.padEnd(4)} [${f.rule}] ${f.msg}`);
    for (const p of r.products) {
      const fails = p.findings.filter((f) => f.level === 'FAIL');
      const level = fails.length ? 'FAIL' : p.findings.length ? 'WARN' : 'ok';
      if (quiet && !fails.length) continue;
      console.log(`  ${level.padEnd(4)} ${p.id}`);
      for (const f of quiet ? fails : p.findings) console.log(`         ${f.level.padEnd(4)} [${f.rule}] ${f.msg}`);
    }
  }
  const c = res.counts;
  const fmt = (o) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`\nkategorier: ${fmt(c.byCategory) || '–'}`);
  console.log(`butikker: ${fmt(c.byStore) || '–'}`);
  console.log(`verifisert: ${c.verified} av ${c.products}`);
  if (res.build) console.log(`bygget i Node: ${res.build.built} produkter (${res.build.variants} varianter), ${res.build.skipped} hoppet over (trenger canvas), ${res.build.stub} uten bygger ennå`);
  if (res.tmp) console.log(`temp-mappen er beholdt: ${res.tmp}`);
  const json = opt('json');
  if (json) {
    const out = {
      root: res.root, today: res.today, counts: c, build: res.build,
      files: res.files.map((r) => ({ file: r.rel, path: r.file.split(path.sep).join('/'), strict: r.strict, findings: r.findings, products: r.products.map((p) => ({ index: p.index, id: p.id, category: p.src?.category, subcategory: p.src?.subcategory, store: p.src?.store, verified: p.src?.verified, findings: p.findings })) })),
    };
    fs.mkdirSync(path.dirname(path.resolve(json)), { recursive: true });
    fs.writeFileSync(path.resolve(json), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    console.log(`json: ${path.resolve(json)}`);
  }
  console.log(`${c.fail} FAIL, ${c.warn} WARN – ${c.products} produkter i ${res.files.length} ${res.files.length === 1 ? 'fil' : 'filer'}, ${c.ok} uten funn (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exitCode = c.fail ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`check-research: ${err?.tool ? '' : 'verktøyfeil: '}${err?.tool ? err.message : err?.stack || err}`);
    process.exit(2);
  });
}
