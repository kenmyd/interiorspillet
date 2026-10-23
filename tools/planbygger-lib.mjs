/**
 * Shared bits for the planbygger tools and tests (tools/test-planbygger.mjs, tools/planbygger-measure.mjs). Import it
 * FIRST: it registers the JSON loader hook (like tools/house-tests/_lib.mjs) before anything imports a .json file.
 *
 *   import { ROOT, imp, readJson, check, section, done, planPipeline } from './planbygger-lib.mjs';
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    // only the project's own JSON (src/data, research): never a package's package.json (require in node_modules)
    if (url.startsWith('file:') && url.endsWith('.json') && !url.includes('/node_modules/')) {
      const text = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), 'utf8'));
/** The basement plan is gitignored (bilder_hus/): read it from the main tree when the worktree has none. */
export const KJELLER_PLAN = ['bilder_hus/plantegning_kjeller.png', 'C:/Dev/Interiørspillet/bilder_hus/plantegning_kjeller.png']
  .map((p) => (path.isAbsolute(p) ? p : path.join(ROOT, p)))
  .find((p) => fs.existsSync(p)) ?? null;

let passes = 0;
let failures = 0;
export const section = (name) => console.log(`\n— ${name}`);
export function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
  return !!ok;
}
export function done() {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

/**
 * The automatic pipeline on a plan image, as the page runs it before any correction: detect → document.
 * @param {string} file  PNG
 * @param {{ pxPerM: number, north?: number, name?: string, levelId?: string, floorY?: number }} o
 */
export async function planPipeline(file, o) {
  const { readPng } = await import('./planbygger-png.mjs');
  const { detectPlan } = await imp('src/planbygger/detect.js');
  const M = await imp('src/planbygger/model.js');
  const img = readPng(file);
  const det = detectPlan(img, { pxPerM: o.pxPerM });
  const doc = M.createDoc(o.name ?? path.basename(file));
  doc.settings.north = o.north ?? 0;
  const level = M.createLevel(doc, { id: o.levelId ?? 'hoved', floorY: o.floorY ?? 0, image: { name: path.basename(file), width: img.width, height: img.height, pxPerM: o.pxPerM } });
  M.applyDetection(level, det, o.pxPerM, doc.settings);
  return { img, det, doc, level };
}

/** validateHouse on a generated house (its own registry), without the owner-house-only errors. */
export async function validateGenerated(exported) {
  const H = await imp('src/data/scripts/house.mjs');
  const E = await imp('src/planbygger/export.js');
  const spec = H.mergeHouse(E.baseSpec(), null, { files: [{ name: '10-plan.json', data: exported.house }], registry: exported.registry });
  const report = H.validateHouse(spec, { registry: exported.registry, throw: false });
  const errors = report.errors.filter((m) => !E.ownerOnly(m));
  return { spec, report, errors, warnings: report.warnings };
}
