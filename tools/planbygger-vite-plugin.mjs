/**
 * Vite plugin for the planbygger page:
 * 1. src/data/scripts/house.mjs (mergeHouse / validateHouse, written for Node) gets browser stand-ins for node:fs,
 *    node:path and node:url – and ONLY that file, so nothing else in the game changes. The page passes the house file,
 *    the registry and the archetypes itself, so the stand-ins never do any I/O.
 * 2. The dev server answers /api/planbygger/ai and /api/planbygger/ai/status with the AI layer
 *    (server/planbygger-ai/index.mjs). It is imported lazily on the first such request, so Vite starts and the page
 *    works without the SDK and without a key: the status then says available: false. The page may pick the model
 *    (aiRead(..., { model: 'sonnet' })) only with PLANBYGGER_AI_ALLOW_MODEL=1 in the environment (a dev flag).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const SHIMS = {
  'node:fs': 'src/planbygger/shims/node-fs.js',
  'node:path': 'src/planbygger/shims/node-path.js',
  'node:url': 'src/planbygger/shims/node-url.js',
  fs: 'src/planbygger/shims/node-fs.js',
  path: 'src/planbygger/shims/node-path.js',
  url: 'src/planbygger/shims/node-url.js',
};
const AI_ROUTE = '/api/planbygger/ai';
const AI_MODULE = resolve(ROOT, 'server/planbygger-ai/index.mjs');

/** The AI middleware, or a stand-in that says «not available» when the module cannot be loaded. */
let aiHandler = null;
function loadAiHandler() {
  aiHandler ??= import(pathToFileURL(AI_MODULE).href)
    .then((mod) => mod.createAiHandler({ limits: { allowModelOverride: process.env.PLANBYGGER_AI_ALLOW_MODEL === '1' } }))
    .catch((err) => {
      console.warn(`[planbygger] KI-laget er ikke tilgjengelig: ${err?.message ?? err}`);
      return (req, res) => {
        const status = (req.url ?? '').split('?')[0].replace(/\/+$/, '').endsWith('/status');
        res.statusCode = status ? 200 : 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(status ? { available: false, model: null, remaining: 0, reason: 'no_module' } : { ok: false, error: 'no_module', message: 'KI er ikke satt opp på denne serveren.' }));
      };
    });
  return aiHandler;
}

export default function planbyggerNodeShims() {
  return {
    name: 'planbygger-node-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !SHIMS[source]) return null;
      if (!/[\/]src[\/]data[\/]scripts[\/]house\.mjs$/.test(importer.split('?')[0])) return null;
      return resolve(ROOT, SHIMS[source]);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== AI_ROUTE && !path.startsWith(`${AI_ROUTE}/`)) return next();
        loadAiHandler().then((handler) => handler(req, res, next), next);
      });
    },
  };
}
