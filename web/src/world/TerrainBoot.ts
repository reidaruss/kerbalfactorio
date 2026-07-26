// Brings the terrain worker up and wires the pool, the shared index and the
// shared material to it. Separated from TerrainStream so the stream class holds
// only steady-state responsibilities.

import type { Config } from '../app/Config.js';
import type { Events } from '../app/Events.js';
import type { QualityKnobs } from '../render/Quality.js';
import type { DepthPolicy } from '../render/DepthPolicy.js';
import type { Scenes } from '../render/Scenes.js';
import type { AtmosphereUniforms } from '../render/materials/Atmosphere.glsl.js';
import { SharedIndex } from '../render/geometry/SharedIndex.js';
import { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import { createTerrainMaterials } from '../render/materials/TerrainMaterial.js';
import { chunkBlobLayout } from './ChunkFormat.js';
import { TerrainStream } from './TerrainStream.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { PlanetBody } from './PlanetBody.js';
import type { FromTerrain, TerrainInitMsg, TerrainInitedMsg } from '../workers/TerrainProtocol.js';

/** minResidentDepth 2 keeps 6 * 4^2 = 96 coarse shells resident for the WHOLE
 *  body, so the far scaled scene always has a complete planet, not just the
 *  quadtree under the observer. */
const MIN_RESIDENT_DEPTH = 2;
/**
 * ARCHITECTURE.md 4.5 carried 0.9 over from UE M4.1. Measured here: /core sizes
 * the skirt apron proportionally to the chunk, so 0.9 gives an 82 km drop on a
 * depth-3 chunk. Combined with near-only skirt draw ranges, a small fraction is
 * enough to plug LOD T-junctions at walking scale without building walls.
 */
const SKIRT_FRACTION_DEFAULT = 0.15;

export interface TerrainBootResult {
  stream: TerrainStream;
  pooledBytes: number;
  indexBytes: number;
  workerLoadMs: number;
  verts: number;
  indexCount: number;
}

export interface TerrainBootDeps {
  cfg: Config;
  quality: QualityKnobs;
  depth: DepthPolicy;
  events: Events;
  scenes: Scenes;
  origin: FloatingOrigin;
  body: PlanetBody;
  atmosphere: AtmosphereUniforms;
  cascadeSplits: number[];
}

export async function bootTerrain(d: TerrainBootDeps): Promise<TerrainBootResult> {
  const { cfg, quality, depth, events, scenes, origin, body } = d;
  const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), {
    type: 'module', name: 'of-terrain',
  });

  const inited = await new Promise<TerrainInitedMsg>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('terrain.worker init timed out')), 30000);
    const onMsg = (e: MessageEvent<FromTerrain>) => {
      if (e.data.type === 'error') { clearTimeout(timer); reject(new Error(e.data.message)); return; }
      if (e.data.type !== 'inited') return;
      clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      resolve(e.data);
    };
    worker.addEventListener('message', onMsg);
    worker.onerror = (e) => { clearTimeout(timer); reject(new Error(`terrain.worker: ${e.message}`)); };
    const init: TerrainInitMsg = {
      type: 'init',
      seedLo: cfg.seedLo, seedHi: cfg.seedHi,
      splitRatio: 1.0, mergeHysteresis: 0.6,
      maxDepth: cfg.maxDepth,
      minResidentDepth: MIN_RESIDENT_DEPTH,
      skirtFraction: cfg.skirtFraction > 0 ? cfg.skirtFraction : SKIRT_FRACTION_DEFAULT,
      genBudget: quality.genBudget,
    };
    worker.postMessage(init);
  });

  const layout = chunkBlobLayout(inited.verts);
  const index = new SharedIndex(new Uint16Array(inited.index), inited.interiorIndexCount);
  const pool = new ChunkGeometryPool(cfg.chunkPoolSize, layout, index);
  const materials = createTerrainMaterials({
    depth,
    maxReliefM: body.maxReliefM,
    atmosphere: d.atmosphere,
    cascadeSplits: d.cascadeSplits,
    fadeSecs: cfg.fadeSecs,
  });
  const stream = new TerrainStream(worker, pool, layout, materials, scenes, origin, events, {
    skirts: cfg.skirts, stitching: cfg.stitch, fadeSecs: cfg.fadeSecs, shell: cfg.shell,
  });
  stream.setNearDepthCutoff(depth.nearDepthCutoff());

  return {
    stream,
    pooledBytes: pool.bytes,
    indexBytes: index.bytes,
    workerLoadMs: inited.loadMs,
    verts: inited.verts,
    indexCount: inited.indexCount,
  };
}
