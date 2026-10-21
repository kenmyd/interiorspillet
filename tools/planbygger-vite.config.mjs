// Dev / test server for the planbygger (ports 5270–5279; 5180 is the owner's own dev server, 5250–5260 the house
// work): the project config without HMR and with its own dependency cache inside this working tree, like
// tools/vite.test.config.mjs.
//
//   npx vite --config tools/planbygger-vite.config.mjs            → http://127.0.0.1:5270/planbygger.html
//   PLANBYGGER_PORT=5271 npx vite --config tools/planbygger-vite.config.mjs
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
const port = Number(process.env.PLANBYGGER_PORT) || 5270;

export default mergeConfig(
  base,
  defineConfig({
    root,
    cacheDir: resolve(root, '.shots/.vite-planbygger'),
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
      fs: { allow: [root, real(resolve(root, 'node_modules'))] },
      watch: {
        ignored: ['**/.shots/**', `${root.replaceAll(String.fromCharCode(92), '/')}/.claude/**`, '**/bilder_hus/**', '**/bilder_stue/**', '**/dist/**', '**/deploy/**', '**/.git/**'],
      },
    },
    optimizeDeps: {
      entries: ['planbygger.html'],
      include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/math/Capsule.js', 'three/addons/math/Octree.js', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/lights/RectAreaLightUniformsLib.js', 'three/addons/geometries/RoundedBoxGeometry.js'],
    },
  }),
);
