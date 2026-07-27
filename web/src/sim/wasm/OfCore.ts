// THE ONLY module that constructs the Emscripten Module object.
//
// Loads web/wasm/dist/of-core.{mjs,wasm} (synced into public/wasm by
// scripts/sync-wasm.mjs). Works unchanged on the main thread and inside a module
// worker, which is the point: DECISIONS.md DW-4 gives every JS thread its own
// single-threaded instance, with no SharedArrayBuffer and no COOP/COEP.

import type { OfCoreModule } from './heap.js';

// ABI 2 (2026-07-25, the surface-authority audit): of_observer_latlon_alt gained
// an `edits` parameter and now reads the oracle, of_quadmesh_generate's last
// parameter became `rawBase` so 0 is the safe value, and of_chunk_max_offset
// became a true Euclidean bound including the skirt (WASM-BRIDGE.md section 4.1).
// ABI 3 (2026-07-26): the of_gp_patch_* ore-body surface over deposits.h.
// ABI 4 (2026-07-26): TERRAFORMING (WG-22). VoxelEdits gained a second sparse
// set so fill is representable; of_edits_fill, of_level_area, of_derived_raising
// and of_surface_offset are new, and of_edits_serialize writes a new
// self-describing format that carries BOTH sets (old slots still load).
// ABI 5 (2026-07-26): the STRUCTURAL BUILDING SET (gameplay.h section S.6).
// of_gp_structure_count / _info / _can_afford / _pay expose the four base
// building parts and their authored build costs. Additive: no existing
// signature or struct layout changed, so every ABI 4 caller is unaffected.
// ABI 6 (2026-07-26): the VESSEL SURFACE (vessel.h / atmosphere.h / flight.h).
// of_vs_* is the part catalogue as data, the item form of a part and its build
// cost, the vessel TREE, staging (autostage plus a reorder that renumbers the
// parts with the rows) and the derived delta-v / mass / TWR figures DW-30 item 4
// makes non-negotiable. of_atmo_* and of_fl_* are the atmosphere and a FlightSim
// pass-through, landed in the SAME bump because a second one costs more than one
// file. Declared in sim/wasm/vesselabi.ts, not here: heap.ts is at the line cap.
//
// This constant is the only thing standing between a browser and a wasm that
// answers a different question than the one the client is asking. It was left at
// 2 while the shim already returned 3, which is the failure it exists to catch,
// and it happened again at 4 against a shim reporting 5. AN ABI BUMP IS ATOMIC
// ACROSS THE BRIDGE: the shim's version, the rebuilt and SYNCED wasm, this
// constant and its callers land in one commit, and that commit boots.
export const OF_ABI_VERSION = 6;

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
