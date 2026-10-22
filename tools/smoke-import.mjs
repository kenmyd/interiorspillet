#!/usr/bin/env node
/**
 * Import smoke test: loads the app's main module graph in Node (no browser, no DOM work at import), so a half-written
 * or broken module shows up in seconds – run it after every edit of a src/ file other agents' pages and tests load.
 *
 *   node tools/smoke-import.mjs        (from the project root; prints «smoke-import OK» or the first error, exit 1)
 *
 * Through tools/house-tests/_lib.mjs `imp` (its JSON loader hook) plus a CSS hook (stylesheets load as empty
 * modules): models/registry, catalog/index, design/SceneSync, design/Saves, home/index, ui/Inspector,
 * ui/CatalogPanel, ui/ShoppingPanel, design/Editor – which pull in every model file, the panels and the hooks.
 */
import { registerHooks } from 'node:module';
import { imp } from './house-tests/_lib.mjs';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const MODULES = [
  'src/models/registry.js',
  'src/catalog/index.js',
  'src/design/SceneSync.js',
  'src/design/Saves.js',
  'src/home/index.js',
  'src/ui/Inspector.js',
  'src/ui/CatalogPanel.js',
  'src/ui/ShoppingPanel.js',
  'src/design/Editor.js',
];

const t0 = Date.now();
for (const rel of MODULES) {
  try {
    await imp(rel);
  } catch (err) {
    console.error(`smoke-import FAILED: ${rel}\n${err?.stack || err}`);
    process.exit(1);
  }
}
console.log(`smoke-import OK (${MODULES.length} modules, ${Date.now() - t0} ms)`);
