import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import planbyggerNodeShims from './tools/planbygger-vite-plugin.mjs';

// base './': every URL in the build is relative, so dist/ works from any folder on a web server
// (e.g. https://kenmyd.no/stue/) without rebuilding.
export default defineConfig({
  base: './',
  // the planbygger page runs the game's validator (src/data/scripts/house.mjs) in the browser
  plugins: [planbyggerNodeShims()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4180 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        // dev pages (free camera sandbox, model gallery) – handy on the server too
        sandbox: resolve(import.meta.dirname, 'dev/sandbox.html'),
        models: resolve(import.meta.dirname, 'dev/models.html'),
        // the planbygger: a floor plan → a 3D house (src/planbygger, notes/planbygger.md)
        planbygger: resolve(import.meta.dirname, 'planbygger.html'),
      },
      output: {
        // the catalogue data in one chunk per category: in one chunk (with room-spec) it reached the 2000 kB warning
        // limit with this round's products. Every file is still loaded at start (static imports); only the chunking
        // changes – and a data-only change leaves the code chunks cached.
        codeSplitting: {
          groups: [{
            debugName: 'catalog-data',
            name: (id) => {
              const m = /[\\/]src[\\/]data[\\/]catalog[\\/]([a-z0-9-]+)\.json$/.exec(id);
              return m ? `catalog-${m[1]}` : null;
            },
          }],
        },
      },
    },
  },
});
