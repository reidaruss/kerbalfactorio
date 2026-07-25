import { defineConfig } from 'vite';

// DECISIONS.md DW-4 / ARCHITECTURE.md 2.5: transferables only. There are
// deliberately NO COOP/COEP headers here, so the build runs on any static host
// and no cross-origin subresource is broken.
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    reportCompressedSize: true,
  },
});
