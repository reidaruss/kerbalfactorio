// Brings the terrain worker up and wires the pool, the shared index and the
// shared material to it. Separated from TerrainStream so the stream class holds
// only steady-state responsibilities.

import type { Config } from '../app/Config.js';
import type { Events } from '../app/Events.js';
import type { Lifetime } from '../app/Lifetime.js';
import type { QualityKnobs } from '../render/Quality.js';
import type { DepthPolicy } from '../render/DepthPolicy.js';
import type { Scenes } from '../render/Scenes.js';
import type { AtmosphereUniforms } from '../render/materials/Atmosphere.glsl.js';
import { SharedIndex } from '../render/geometry/SharedIndex.js';
import { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import { createTerrainMaterials } from '../render/materials/TerrainMaterial.js';
import type { TerrainMaterials } from '../render/materials/TerrainMaterial.js';
import { chunkBlobLayout } from './ChunkFormat.js';
import { TerrainStream } from './TerrainStream.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { PlanetBody } from './PlanetBody.js';
import type { SurfaceOracle } from './SurfaceOracle.js';
// RN-51: water's LOOK is the rendering lane's, so the surface moved to
// `render/`. World-gen keeps the level and the basin (WaterOracle, water_field).
import { WaterSurface } from '../render/WaterSurface.js';
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
  pool: ChunkGeometryPool;
  /** The near/far terrain materials. Exposed so a caller can reach the one
   *  program the ground is drawn with rather than growing a second. */
  materials: TerrainMaterials;
  pooledBytes: number;
  indexBytes: number;
  workerLoadMs: number;
  verts: number;
  indexCount: number;
  /** CE-19. The terrain worker's own handle census at init. See TerrainProtocol. */
  workerHandles: Readonly<Record<string, number>>;
  /** The pond's surface. `mesh` is null on a body with no water. */
  water: WaterSurface;
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
  /** The surface oracle, whose `water` sibling this boot reads (WG-42). */
  oracle: SurfaceOracle;
  /**
   * CE-19. The scope everything built here belongs to. REQUIRED, not optional:
   * a boot function that mints a Worker, two `BatchedMesh`es, three WASM handles
   * on another thread and an event subscription, and does not say who releases
   * them, is the exact shape that left `TerrainStream.dispose()` uncalled for a
   * year. The general rule this instance is standing in for: a function that
   * constructs disposable things takes the lifetime they belong to, so
   * "released by whom" is answered at the call site rather than deferred.
   */
  lifetime: Lifetime;
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
      // CE-22. FROM THE BODY, NOT FROM THE CONFIG. `cfg.bodyId` is frozen at
      // boot and `PlanetBody` is the object that owns the handle these ids
      // index, so the two agree only for as long as nothing ever changes body.
      // Reading the config here meant the worker would keep generating Forge
      // while the main thread had moved to Cinder: the same seed, two different
      // planets, with the terrain the player walks on coming from the wrong one
      // and no error anywhere. `cfg.bodyId` is now read at exactly one site in
      // the client, `PlanetBody.create`, which is what makes it a config value
      // rather than a second authority.
      bodyId: body.bodyId,
      seedLo: cfg.seedLo, seedHi: cfg.seedHi,
      splitRatio: cfg.splitRatio, mergeHysteresis: 0.6,
      maxDepth: cfg.maxDepth,
      minResidentDepth: MIN_RESIDENT_DEPTH,
      skirtFraction: cfg.skirtFraction > 0 ? cfg.skirtFraction : SKIRT_FRACTION_DEFAULT,
      genBudget: quality.genBudget,
    };
    worker.postMessage(init);
  });

  const layout = chunkBlobLayout(inited.verts);
  const index = new SharedIndex(new Uint16Array(inited.index), inited.interiorIndexCount);
  const materials = createTerrainMaterials({
    depth,
    maxReliefM: body.maxReliefM,
    // RN-57: the ground darkens at the waterline, because in this engine the
    // BEACH IS TERRAIN. The disc is world-gen's published answer and it is read
    // ONCE here, not per fragment: the ground is told where the pond is, it
    // never asks. WaterDisc is structurally a TerrainWaterBand, so no shape is
    // transcribed and a field that moves is a compile error rather than a look.
    water: d.oracle.water.disc,
    atmosphere: d.atmosphere,
    cascadeSplits: d.cascadeSplits,
    fadeSecs: cfg.fadeSecs,
  });
  // The pool now OWNS the two BatchedMeshes, so it needs the two materials at
  // construction: a BatchedMesh binds one material for its whole lifetime.
  const pool = new ChunkGeometryPool(cfg.chunkPoolSize, layout, index, materials);
  const stream = new TerrainStream(worker, pool, layout, materials, scenes, origin, events, {
    skirts: cfg.skirts, stitching: cfg.stitch, fadeSecs: cfg.fadeSecs, shell: cfg.shell,
  });
  stream.setNearDepthCutoff(depth.nearDepthCutoff());
  // CE-19. REGISTERED HERE, IMMEDIATELY AFTER CONSTRUCTION, and that placement
  // is the whole mechanism rather than a style. Registration order IS
  // construction order only if every step is registered where its subject is
  // built; collect them at the end of the function instead and you are writing
  // the dependency order out by hand a second time, which is the thing reverse
  // teardown exists to avoid needing. Concretely: the water below borrows this
  // stream's near material, so the water must be released FIRST, and it is,
  // because it is registered LAST.
  d.lifetime.add('terrain.stream', () => { stream.dispose(); });

  // THE POND'S SURFACE (WG-42). Built here, and not at the boot site, because
  // it is world data with the terrain's own anchoring problem: it lives at a
  // fixed body-frame place on a 600 km sphere and has to be re-derived from its
  // f64 anchor on every rebase, which is the one thing this module already
  // arranges for everything else it makes.
  //
  // RN-53 gives it a look, and everything the look needs is handed over by
  // REFERENCE from what this function already built: the near terrain material
  // (for the planet centre, the sim clock, the cascade splits and the ambient),
  // the shared atmosphere record, and the depth policy. Nothing new is pushed
  // per frame anywhere. `refractAllowed` is a capability, not a preference: see
  // WaterSurfaceOptions for the two hard conditions behind it.
  const water = new WaterSurface(origin, d.oracle, d.oracle.water, {
    depth,
    terrain: materials.near,
    atmosphere: d.atmosphere,
    cascades: d.cascadeSplits.length,
    refractAllowed: cfg.post.flags.post && cfg.post.tune.samples === 0,
  });
  if (water.mesh !== null) {
    const mesh = water.mesh;
    scenes.near.add(mesh);
    // CE-19. Two teardown steps, registered where the thing is created, which is
    // the only place that knows both what was made and who made it.
    d.lifetime.addUnsubscribe('water.reanchor', events.on('OriginRebased', () => water.reanchor()));
    d.lifetime.add('water.mesh', () => { mesh.removeFromParent(); water.dispose(); });
  }

  return {
    stream,
    pool,
    water,
    materials,
    pooledBytes: pool.bytes,
    indexBytes: index.bytes,
    workerLoadMs: inited.loadMs,
    verts: inited.verts,
    indexCount: inited.indexCount,
    workerHandles: inited.handles,
  };
}
