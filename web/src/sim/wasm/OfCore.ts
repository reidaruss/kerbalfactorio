// THE ONLY module that constructs the Emscripten Module object.
//
// Loads web/wasm/dist/of-core.{mjs,wasm} (synced into public/wasm by
// scripts/sync-wasm.mjs). Works unchanged on the main thread and inside a module
// worker, which is the point: DECISIONS.md DW-4 gives every JS thread its own
// single-threaded instance, with no SharedArrayBuffer and no COOP/COEP.

import type { OfCoreModule } from './heap.js';

export const OF_ABI_VERSION = 1;

type Factory = (opts?: Record<string, unknown>) => Promise<OfCoreModule>;

function glueUrl(): string {
  // BASE_URL keeps this correct when the site is served from a subpath.
  const base = import.meta.env.BASE_URL || '/';
  return new URL(`${base}wasm/of-core.mjs`, self.location.href).href;
}

/**
 * Construct one WASM instance. Handle id spaces are per instance, and heaps are
 * never shared, so callers must not pass handles between threads
 * (WASM-BRIDGE.md section 3.1).
 */
export async function loadOfCore(): Promise<OfCoreModule> {
  const mod = (await import(/* @vite-ignore */ glueUrl())) as { default: Factory };
  const M = await mod.default();
  const abi = M._of_abi_version();
  if (abi !== OF_ABI_VERSION) {
    throw new Error(`of-core ABI mismatch: wasm reports ${abi}, client expects ${OF_ABI_VERSION}`);
  }
  return M;
}

export interface OracleTiming {
  baseHeightUs: number;
  surfaceHeightUs: number;
  biomeAtUs: number;
  solidAtUs: number;
}

/**
 * Measure the synchronous main-thread oracle cost. WASM-BRIDGE.md section 7.2
 * puts these at 1.4 to 3.8 microseconds under node; this is the browser number,
 * and the frame budget depends on it staying there.
 */
export function benchOracle(M: OfCoreModule, body: number, iters = 4000): OracleTiming {
  // Sweep directions so the noise stack cannot be cached by branch luck.
  const dirs = new Float64Array(iters * 3);
  for (let i = 0; i < iters; ++i) {
    const a = (i * 0.61803398875) % 1;
    const lat = (a - 0.5) * 3.0;
    const lon = ((i * 0.7548776662) % 1) * 6.2831853;
    const cl = Math.cos(lat);
    dirs[i * 3] = cl * Math.cos(lon);
    dirs[i * 3 + 1] = Math.sin(lat);
    dirs[i * 3 + 2] = cl * Math.sin(lon);
  }
  const time = (fn: (i: number) => number): number => {
    let sink = 0;
    const t0 = performance.now();
    for (let i = 0; i < iters; ++i) sink += fn(i);
    const dt = performance.now() - t0;
    if (!Number.isFinite(sink)) throw new Error('oracle produced NaN');
    return (dt * 1000) / iters;
  };
  const R = M._of_body_radius(body);
  return {
    baseHeightUs: time((i) => M._of_base_height(body, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])),
    surfaceHeightUs: time((i) => M._of_surface_height(body, 0, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])),
    biomeAtUs: time((i) => M._of_biome_at(body, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])),
    solidAtUs: time((i) => M._of_solid_at(body, 0, dirs[i * 3] * R, dirs[i * 3 + 1] * R, dirs[i * 3 + 2] * R)),
  };
}
