// The W0 WASM handshake gate: a second, independent /core instance in a Web
// Worker must agree with the main-thread instance BIT-FOR-BIT. Every double is
// compared as its raw IEEE-754 pattern, exactly as web/wasm/test/parity.mjs does,
// so "agrees" means identical and not "close".

import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { PlanetBody } from '../world/PlanetBody.js';
import type { Config } from './Config.js';
import type { OracleProbeReply, OracleProbeRequest } from '../workers/oracle.worker.js';

const SAMPLES = 512;
const dv = new DataView(new ArrayBuffer(8));
function bits(x: number): string {
  dv.setFloat64(0, x, false);
  return dv.getBigUint64(0, false).toString(16).padStart(16, '0');
}

export interface WorkerProbeResult {
  loadMs: number;
  probeMs: number;
  agrees: boolean;
  mismatches: number;
  abi: number;
}

function sampleDirs(n: number): Float64Array {
  const d = new Float64Array(n * 3);
  for (let i = 0; i < n; ++i) {
    const u = ((i * 0.61803398875) % 1) * 2 - 1;
    const th = ((i * 0.7548776662) % 1) * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    d[i * 3] = r * Math.cos(th);
    d[i * 3 + 1] = u;
    d[i * 3 + 2] = r * Math.sin(th);
  }
  return d;
}

export async function probeWorkerOracle(
  M: OfCoreModule, body: PlanetBody, cfg: Config,
): Promise<WorkerProbeResult> {
  const dirs = sampleDirs(SAMPLES);
  const mine = new Float64Array(SAMPLES);
  const mineBiome = new Int32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; ++i) {
    mine[i] = M._of_base_height(body.handle, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    mineBiome[i] = M._of_biome_at(body.handle, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
  }

  const worker = new Worker(new URL('../workers/oracle.worker.ts', import.meta.url), {
    type: 'module', name: 'of-oracle-probe',
  });
  const reply = await new Promise<OracleProbeReply>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker oracle probe timed out')), 20000);
    worker.onmessage = (e: MessageEvent<OracleProbeReply>) => { clearTimeout(timer); resolve(e.data); };
    worker.onerror = (e) => { clearTimeout(timer); reject(new Error(`worker error: ${e.message}`)); };
    const req: OracleProbeRequest = {
      // CE-22. FROM THE BODY, not the config. This probe exists to prove the
      // worker's instance agrees with the main thread's; asking the CONFIG which
      // body to build over there while comparing the answer against THIS body's
      // radius is a comparison whose two sides have different authorities.
      type: 'probe', bodyId: body.bodyId,
      seedLo: cfg.seedLo, seedHi: cfg.seedHi, dirs: dirs.slice(),
    };
    worker.postMessage(req, [req.dirs.buffer]);
  });
  worker.terminate();

  let mismatches = 0;
  for (let i = 0; i < SAMPLES; ++i) {
    if (bits(mine[i]) !== bits(reply.heights[i])) mismatches++;
    else if (mineBiome[i] !== reply.biomes[i]) mismatches++;
  }
  if (reply.radiusM !== body.radiusM) mismatches++;

  return {
    loadMs: reply.loadMs,
    probeMs: reply.probeMs,
    agrees: mismatches === 0,
    mismatches,
    abi: reply.abi,
  };
}
