import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

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
// GP-115. It MERGES the real config rather than restating a subset of it, and
// that is a fix rather than tidiness: BT-27 added `define.__OF_BUILD__` to
// vite.config.ts only, so this server served a bundle in which `__OF_BUILD__`
// was an undeclared identifier, HudLines threw on its first line, and EVERY
// driven probe on this port failed with 21 page errors before it could measure
// anything. A probe server that is a hand-maintained copy of the real one is a
// second authority, which is the failure this project has paid for repeatedly.
export default mergeConfig(base, defineConfig({
  server: { host: '127.0.0.1', port: 5199, strictPort: true, hmr: false,
            watch: { ignored: ['**/*'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
}));
