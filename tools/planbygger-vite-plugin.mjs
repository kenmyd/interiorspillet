/**
 * Vite plugin for the planbygger page: src/data/scripts/house.mjs (mergeHouse / validateHouse, written for Node) gets
 * browser stand-ins for node:fs, node:path and node:url – and ONLY that file, so nothing else in the game changes.
 * The page passes the house file, the registry and the archetypes itself, so the stand-ins never do any I/O.
 */
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SHIMS = {
  'node:fs': 'src/planbygger/shims/node-fs.js',
  'node:path': 'src/planbygger/shims/node-path.js',
  'node:url': 'src/planbygger/shims/node-url.js',
  fs: 'src/planbygger/shims/node-fs.js',
  path: 'src/planbygger/shims/node-path.js',
  url: 'src/planbygger/shims/node-url.js',
};

export default function planbyggerNodeShims() {
  return {
    name: 'planbygger-node-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !SHIMS[source]) return null;
      if (!/[\/]src[\/]data[\/]scripts[\/]house\.mjs$/.test(importer.split('?')[0])) return null;
      return resolve(ROOT, SHIMS[source]);
    },
  };
}
