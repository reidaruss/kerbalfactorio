// Async construction of every service, in dependency order. main.ts calls this
// and nothing else. Kept out of main.ts so the composition root stays readable.
//
// CE-140. THIS FILE IS THE ORDER, AND NOTHING ELSE. `boot()` was 713 lines; it
// is now the first phase, the last phase and the sequence between them, and the
// eight phases in the middle live in `BootRender.ts`, `BootObserver.ts`,
// `BootBodyScope.ts`, `BootGameplay.ts` and `BootStation.ts`. Every moved line
// is verbatim: the phases take and return `Pick<BootCtx, ...>` and re-bind the
// same local names at their head, so not one statement inside them changed.
// `BootStage.ts` carries the protocol, `BootCtx`, and the two holders that
// replace the two forward references a single function scope allowed and a
// module boundary does not.
//
// THE PUBLIC SURFACE IS UNCHANGED. This file exported exactly `boot` and
// `Booted` before the cut and exports exactly `boot` and `Booted` after it, so
// `main.ts` -- the only importer in the tree -- did not move.

import type { Config } from './Config.js';
import { Events } from './Events.js';
import type { BootMetrics, Services } from './Services.js';
import { qualityKnobs } from '../render/Quality.js';
import { benchOracle, loadOfCore } from '../sim/wasm/OfCore.js';
import { PlanetBody } from '../world/PlanetBody.js';
import { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { VoxelWorld } from '../world/VoxelWorld.js';
import type { ViewSource } from '../player/ViewSource.js';
import type { Hud } from '../ui/Hud.js';
import { fill, holder, type BootCtx } from './BootStage.js';
import { phaseRender } from './BootRender.js';
import { phaseObserver, phaseWorldPrep } from './BootObserver.js';
import { phaseBodyScope } from './BootBodyScope.js';
import { phaseGameplay, phaseTools } from './BootGameplay.js';
import { phaseStation } from './BootStation.js';

export interface Booted {
  services: Services;
  canvas: HTMLCanvasElement;
}

type EngineIn = Pick<BootCtx, 'cfg' | 'hud'>;
type EngineOut = Pick<BootCtx,
  't0' | 'events' | 'quality' | 'core' | 'wasmLoadMs' | 'body' | 'oracle' | 'oracleTiming'>;

/** CE-140. PHASE 1: the WASM core and the body it is asked about. */
async function phaseEngine(s: EngineIn): Promise<EngineOut> {
  const { cfg, hud } = s;
  const t0 = performance.now();
  const events = new Events();
  const quality = qualityKnobs(cfg.quality, {
    iblSize: cfg.iblSizeOverride ?? undefined,
    shadowSoft: cfg.shadowSoftOverride ?? undefined,
  });

  hud.banner('loading of-core.wasm ...');
  const tWasm = performance.now();
  const core = await loadOfCore();
  const wasmLoadMs = performance.now() - tWasm;

  const body = PlanetBody.create(core, cfg.bodyId, cfg.seedLo, cfg.seedHi);
  const oracle = new SurfaceOracle(core, body);
  const oracleTiming = benchOracle(core, body.handle, 3000);
  return { t0, events, quality, core, wasmLoadMs, body, oracle, oracleTiming };
}

/** CE-140. PHASE 9: the boot metrics and the typed dependency record. */
function phaseServices(s: BootCtx): Booted {
  const {
    cfg, hud, t0, events, quality, core, wasmLoadMs, oracle, oracleTiming,
    canvas, renderer, scenes, rig, frame, stats, sky, sunLights, headlamp,
    shadows, ibl, proxy, origin, player, router, observer, avatar, input,
    jitter, zfight, wp, regime, props, horizonOcc, carriers, ride, mounts,
    t, terrainBootMs, session, voxels, voxelMesh, digFx, dig, levelRing,
    level, gameplay, vab, flight, map, station,
  } = s;
  const boot: BootMetrics = {
    wasmLoadMs,
    horizonOcc,
    oracleUs: {
      baseHeight: oracleTiming.baseHeightUs,
      surfaceHeight: oracleTiming.surfaceHeightUs,
      biomeAt: oracleTiming.biomeAtUs,
      solidAt: oracleTiming.solidAtUs,
    },
    workerLoadMs: wp.loadMs,
    workerProbeMs: wp.probeMs,
    workerAgrees: wp.agrees,
    workerMismatches: wp.mismatches,
    proxyBuildMs: proxy.buildMs,
    terrainWorkerLoadMs: t.workerLoadMs,
    terrainBootMs,
    chunkVerts: t.verts,
    chunkBytes: t.pooledBytes / cfg.chunkPoolSize,
    indexCount: t.indexCount,
    pooledBytes: t.pooledBytes,
    bootMs: performance.now() - t0,
  };

  // CE-20. FOUR FIELDS ARE NOW GETTERS, and the shape of the record is otherwise
  // untouched: `Services` still publishes `body`, `terrain`, `materials` and
  // `scatter` as `readonly`, and a getter satisfies a `readonly` field, so not
  // one of the ~90 call sites that read them changed. That is the point. The
  // alternative was churning every reader to go through `services.session`,
  // which would have been a large diff whose only effect was to move the same
  // staleness somewhere else. What actually mattered was that the VALUE stopped
  // being frozen at boot, and this is the whole of that change.
  const services: Services = {
    cfg, events, quality, renderer, scenes, rig, frame, sky, stats,
    core, oracle, origin, proxy, regime, session, carriers, ride, mounts,
    get body() { return session.body; },
    get terrain() { return session.terrain; },
    get materials() { return session.terrain.materials; },
    get scatter() { return session.scatter; },
    get grass() { return session.grass; },
    observer, player, avatar, input, jitter, zfight,
    hud, sunLights, shadows, ibl, headlamp, props, voxels, voxelMesh, dig, digFx,
    level, levelRing,
    gameplay, vab, flight, map, router, boot, station,
  };
  return { services, canvas };
}

/**
 * CE-140. THE ORDER. Each line is one phase of the original straight-line
 * sequence, in the sequence it ran in, and the two `fill` calls are the two
 * forward references made explicit: the shade diagnosis handle installed in
 * `phaseRender` reads the observer `phaseObserver` builds, and the body scope's
 * `Scatter` reads the voxel handle `phaseTools` builds. Both were already
 * forward references; both were already only ever CALLED long after boot.
 */
export async function boot(cfg: Config, host: HTMLElement, hud: Hud): Promise<Booted> {
  const observerRef = holder<ViewSource>();
  const voxelsRef = holder<VoxelWorld>();
  const s0 = { cfg, host, hud };
  const s1 = { ...s0, ...await phaseEngine(s0) };
  const s2 = { ...s1, ...phaseRender(s1, observerRef) };
  const s3 = { ...s2, ...await phaseObserver(s2) };
  fill(observerRef, s3.observer);
  const s4 = { ...s3, ...await phaseWorldPrep(s3) };
  const s5 = { ...s4, ...await phaseBodyScope(s4, voxelsRef) };
  const s6 = { ...s5, ...phaseTools(s5) };
  fill(voxelsRef, s6.voxels);
  const s7 = { ...s6, ...await phaseGameplay(s6) };
  const s8 = { ...s7, ...await phaseStation(s7) };
  return phaseServices(s8);
}
