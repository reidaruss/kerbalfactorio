import { defineConfig } from 'vite';

// A SECOND dev server for driven probes, with HMR OFF.
//
// The default server hot-reloads on every save, which is correct for a person
// and fatal for a sixty-second driven run: another agent touching a file mid
// probe reloads the page and playwright reports "execution context destroyed"
// with nothing to show for the minute. This server serves the same sources and
// never navigates on its own, so a probe measures the build it started with.
//
//   npx vite --config vite.probe.config.ts
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --evalfile=...
export default defineConfig({
  server: { host: '127.0.0.1', port: 5199, strictPort: true, hmr: false,
            watch: { ignored: ['**/*'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
