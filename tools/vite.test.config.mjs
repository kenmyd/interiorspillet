// Test server for the house work (notes/hele-huset-design.md §0, §7.1): the project config without HMR, with its own
// dependency cache inside the working tree the server runs from, so several test servers (one per git worktree, ports
// 5250–5259) can run at once without sharing node_modules/.vite (node_modules is a junction to the main tree in every
// worktree, and the user's own dev server on 5180 keeps using node_modules/.vite).
//
//   npx vite --config tools/vite.test.config.mjs --port 5251 --strictPort
//
// - root = the folder above this file (the worktree), whatever the current directory is;
// - cacheDir = <root>/.shots/.vite (gitignored). The prebundled deps are served as /.shots/.vite/deps/three.js …
//   (tools/walkmap.mjs and tools/tour.mjs find them through the page's resource list, see tools/lib/hus.mjs depUrl);
// - server.hmr = false: no websocket, edits never reload a page in the middle of a screenshot. The file watcher stays
//   on, so an edit in your own worktree is served on the next page load (just reload / rerun the tool);
// - port: --port on the command line wins, then the env HUS_PORT, then 5250 (the integrator's port); strictPort, so a
//   busy port fails instead of silently moving to the next one;
// - every dependency is prebundled up front (optimizeDeps entries + include), so no page triggers a re-optimisation
//   (which would reload the page and could load a second copy of three.js);
// - the watcher ignores the heavy folders (image originals, screenshots, other worktrees under .claude/worktrees).
import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import base from '../vite.config.js';

const root = resolve(import.meta.dirname, '..');
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const port = Number(process.env.HUS_PORT) || 5250;

export default mergeConfig(
  base,
  defineConfig({
    root,
    cacheDir: resolve(root, '.shots/.vite'),
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
      // node_modules is a junction to the main tree: allow its real path as well as the worktree
      fs: { allow: [root, real(resolve(root, 'node_modules'))] },
      watch: {
        ignored: ['**/.shots/**', '**/.claude/**', '**/bilder_hus/**', '**/bilder_stue/**', '**/dist/**', '**/deploy/**', '**/.git/**'],
      },
    },
    optimizeDeps: {
      entries: ['index.html', 'dev/sandbox.html', 'dev/models.html'],
      include: [
        'three',
        'three/addons/controls/OrbitControls.js',
        'three/addons/environments/RoomEnvironment.js',
        'three/addons/geometries/RoundedBoxGeometry.js',
        'three/addons/lights/RectAreaLightUniformsLib.js',
        'three/addons/math/Capsule.js',
        'three/addons/math/Octree.js',
        'three/addons/postprocessing/GTAOPass.js',
        'three/addons/utils/BufferGeometryUtils.js',
      ],
    },
  }),
);
