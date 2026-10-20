import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './': every URL in the build is relative, so dist/ works from any folder on a web server
// (e.g. https://kenmyd.no/stue/) without rebuilding.
export default defineConfig({
  base: './',
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
      },
    },
  },
});
