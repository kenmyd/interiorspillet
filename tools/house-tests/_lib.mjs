/**
 * Shared bits for tools/house-tests/*.test.mjs (not a test itself: tools/test-house.mjs only runs *.test.mjs).
 * Import it FIRST – it registers the JSON loader hook (like tools/test-design.mjs:16-31) before anything imports
 * src/data/*.json:
 *
 *   import { ROOT, imp, readJson, check, section, near, done } from './_lib.mjs';
 *   const { layout } = await imp('src/home/layout.js');
 *   section('Stua');
 *   check('volume', near(layout.volume, 138.57, 0.01), `got ${layout.volume}`);
 *   done();                       // prints "N passed, M failed" and exits 1 when something failed
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      const text = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
export const near = (a, b, tol) => Math.abs(a - b) <= tol;

let passes = 0;
let failures = 0;
export const section = (name) => console.log(`\n— ${name}`);
export function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
  return !!ok;
}
/** Prints the summary and exits (1 when a check failed). */
export function done() {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
