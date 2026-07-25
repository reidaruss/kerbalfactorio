// W0 handshake proof: a SECOND, independent WASM instance living in a worker.
// Heaps are never shared (DW-4 / DW-16), so this instance answers from its own
// copy of /core. The probe compares its bit patterns against the main thread's,
// which is the cross-instance determinism property multiplayer will need.

import { loadOfCore } from '../sim/wasm/OfCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export interface OracleProbeRequest {
  type: 'probe';
  seedLo: number;
  seedHi: number;
  dirs: Float64Array;
}

export interface OracleProbeReply {
  type: 'probe';
  abi: number;
  radiusM: number;
  maxReliefM: number;
  loadMs: number;
  probeMs: number;
  heights: Float64Array;
  biomes: Int32Array;
}

// lib.dom and lib.webworker cannot both be loaded without global conflicts, so
// the worker scope is narrowed structurally instead of by lib.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<OracleProbeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let M: OfCoreModule | null = null;
let loadMs = 0;

async function core(): Promise<OfCoreModule> {
  if (M === null) {
    const t0 = performance.now();
    M = await loadOfCore();
    loadMs = performance.now() - t0;
  }
  return M;
}

ctx.onmessage = async (e: MessageEvent<OracleProbeRequest>) => {
  const msg = e.data;
  if (msg.type !== 'probe') return;
  const mod = await core();
  const body = mod._of_body_create_forge(msg.seedLo >>> 0, msg.seedHi >>> 0);
  const n = msg.dirs.length / 3;
  const heights = new Float64Array(n);
  const biomes = new Int32Array(n);
  const t0 = performance.now();
  for (let i = 0; i < n; ++i) {
    const x = msg.dirs[i * 3], y = msg.dirs[i * 3 + 1], z = msg.dirs[i * 3 + 2];
    heights[i] = mod._of_base_height(body, x, y, z);
    biomes[i] = mod._of_biome_at(body, x, y, z);
  }
  const probeMs = performance.now() - t0;
  const reply: OracleProbeReply = {
    type: 'probe',
    abi: mod._of_abi_version(),
    radiusM: mod._of_body_radius(body),
    maxReliefM: mod._of_body_max_relief(body),
    loadMs,
    probeMs,
    heights,
    biomes,
  };
  mod._of_body_destroy(body);
  ctx.postMessage(reply, [heights.buffer, biomes.buffer]);
};
