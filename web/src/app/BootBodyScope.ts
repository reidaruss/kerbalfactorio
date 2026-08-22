// CE-140. PHASE 5: THE BODY SCOPE, and the first world built from it.
//
// The largest phase, and deliberately one phase: `buildBodyScope` is the single
// construction path boot AND every rebuild run, and cutting the builder apart
// from its first invocation is exactly the second-authority failure the
// original's own comment says it exists to prevent. Lifted verbatim out of
// `Boot.ts`; see `BootStage.ts` for the protocol and for why `voxelsRef` is a
// holder rather than a captured `const`.

import { measureHorizonOcclusion, type HorizonOcclusion }
  from '../render/materials/HorizonOcclusion.js';
import { publishPropSkyAmbient } from '../render/materials/PropSkyAmbient.js';
import { bootTerrain } from '../world/TerrainBoot.js';
import { GrassCover } from '../render/grass/GrassCover.js';
import { surfacesReady } from '../render/instancing/Surfaces.js';
import { Scatter } from '../world/Scatter.js';
import { CANOPY_NEAR_M } from '../world/ScatterTuning.js';
import { Lifetime } from './Lifetime.js';
import { WorldSession, type BuildBodyScope } from '../world/WorldSession.js';
import { arriveOnBody } from '../game/WorldScope.js';
import { CarrierRegistry } from '../world/CarrierFrame.js';
import { CarrierRide } from '../world/CarrierRide.js';
import { CarrierMounts } from '../world/CarrierGeometry.js';
import type { TerrainBootResult } from '../world/TerrainBoot.js';
import type { TerrainStream } from '../world/TerrainStream.js';
import type { BodyId } from '../world/PlanetBody.js';
import type { VoxelWorld } from '../world/VoxelWorld.js';
import type { VegetationScope } from '../game/VegetationScope.js';
import { read, type BootCtx, type Holder } from './BootStage.js';

export type BodyScopeIn = Pick<BootCtx,
  'cfg' | 'quality' | 'hud' | 'core' | 'events' | 'body' | 'oracle' | 'origin'
  | 'renderer' | 'scenes' | 'sky' | 'shadows' | 'stats' | 'regime' | 'props'
  | 'player' | 'observer'>;
export type BodyScopeOut = Pick<BootCtx,
  'horizonOcc' | 'carriers' | 'ride' | 'mounts' | 'stationRebuild' | 'discReseat'
  | 'worldCapture' | 't' | 'terrainBootMs' | 'session' | 'terrainOf'>;

export async function phaseBodyScope(
  s: BodyScopeIn, voxelsRef: Holder<VoxelWorld>,
): Promise<BodyScopeOut> {
  const {
    cfg, quality, hud, core, events, body, oracle, origin, renderer, scenes,
    sky, shadows, stats, regime, props, player, observer,
  } = s;
  // RN-842. Filled in once the terrain materials exist and the body scope is
  // known; stays null when `?horizonocc=` supplied the value, because "measured
  // 0.149" and "told 0.149" are different facts and only one of them is
  // evidence.
  let horizonOcc: HorizonOcclusion | null = null;

  // ---------------------------------------------------------------------------
  // CE-20. THE BODY SCOPE, in ONE function used by boot AND by every rebuild.
  //
  // The props above moved ABOVE the terrain for this: they are an async fetch
  // that depends on nothing the terrain makes, and leaving them below it forced
  // the terrain and the scatter to be built at two different points in `boot`,
  // which would have meant a second construction path for the rebuild. Two paths
  // that must agree is the second-authority failure this project has paid for
  // repeatedly; there is exactly one here, and the boot you get is the reboot
  // you get, by construction rather than by review.
  //
  // Everything constructed inside is registered with the scope's `Lifetime`,
  // which is what `WorldSession.reboot` ends. See world/WorldSession.ts for why
  // the oracle and the origin are RE-SEATED rather than appearing here.
  const built: { v: TerrainBootResult | null } = { v: null };
  // CE-31 / CE-33. Constructed HERE, above the scope builder, because the
  // builder is what registers their teardown and a `const` referenced from a
  // closure that runs before its own declaration is a temporal-dead-zone throw
  // at boot. Both objects are PROCESS-scoped and both hold BODY-scoped state,
  // which is why neither is `lt.own(...)`.
  const carriers = new CarrierRegistry();
  const ride = player === null ? null : new CarrierRide(player.body);
  // CE-80. The consumer half of the same term, constructed beside it and for
  // the same reason: process-scoped object, body-scoped contents.
  const mounts = new CarrierMounts();
  // CE-47. R17. THE ONE THING A REBUILD HAS TO PUT BACK. Full argument in
  // `StationMount.installAndMountStation`; the ordering that forces a holder is
  // that `phaseStation`, four phases later, needs `gameplay`, `router.up` and
  // `resumeWorld`, none of which exist when the FIRST scope is built, while
  // `mounts.bindTo(lt)` and `carriers.bindTo(lt)` live INSIDE that scope. Null
  // on the first pass is the correct reading: there is no station yet.
  const stationRebuild: { fn: ((bodyId: BodyId, tick: number) => void) | null } =
    { fn: null };
  // PS-46 / GP-725. THE SECOND THING A REBUILD HAS TO PUT BACK, and it is a
  // holder for exactly the reason the station above is one: the discovery field
  // is cut when the MAP is built, and the map is built in `phaseGameplay` because
  // it needs gameplay, the bay and flight. So the scope cannot construct it, and
  // the scope is the only place that knows the body changed. Null on the first
  // pass is the correct reading: `new Discovery(core, bodyId)` cuts the boot
  // body's field a moment later and there is nothing yet to re-seat.
  const discReseat: { fn: ((bodyId: BodyId) => void) | null } = { fn: null };
  // PS-49. THE THIRD, and the one whose half runs on the way OUT rather than on
  // the way in: the fifteen body-scoped populations a save is built from are all
  // constructed once in `Gameplay`, so a switch cannot re-cut them and the save
  // has to take a reading of the outgoing world instead. Same holder shape and
  // the same reason (gameplay is built two phases later).
  const worldCapture: { fn: (() => void) | null } = { fn: null };
  const buildBodyScope: BuildBodyScope = async (bodyId, lt) => {
    // PS-49. THE READING OF THE OUTGOING WORLD, and it is registered FIRST so
    // that it exists even if the terrain build below throws, and runs LAST in
    // teardown, after the mounts, the ride and the frames. Nothing in that list
    // touches a building, a node or an edit set, so last is safe and is the
    // reading closest to the moment the world stopped being played.
    //
    // A TEARDOWN STEP AND NOT A CALL AT THE DOOR, for two reasons that are both
    // load-bearing. It has to run before `WorldSession.reboot` frees the old
    // body handle -- `lt.end()` is the only hook that does -- or `poi` is
    // captured as the same zero the defect writes; and a capture the CALLER
    // performs is a capture the next caller forgets, which is the half-operation
    // PS-41 refuses to make expressible. See game/WorldScope.ts.
    lt.add('world.capture', () => { worldCapture.fn?.(); });
    // CE-31 / CE-34. ONE registration site for every scope, boot's included. A
    // carrier is a position in THIS body's frame, so a carrier that survived a
    // switch would be CE-21's nonsense a second time: Anchorage's 1,000,000 m
    // orbit about Forge is five body-radii outside Cinder.
    //
    // ORDER: the registry's clear is registered first and the ride's release
    // second, so teardown (reverse registration) RELEASES THE RIDER BEFORE IT
    // DROPS THE FRAMES. The other order leaves one instant in which the ride
    // holds a carrier the registry has already forgotten, which is a handle to
    // a dead frame and is precisely the state clause 4 of the teardown contract
    // exists to make impossible.
    carriers.bindTo(lt);
    ride?.bindTo(lt);
    // CE-80. LAST, so reverse-of-registration teardown clears the mounts BEFORE
    // it releases the rider and drops the frames. A mount surviving into the
    // next body would be posing Forge's station against Cinder, one radius-ratio
    // away from being obviously wrong and therefore silent.
    mounts.bindTo(lt);
    // The session re-seats the oracle before calling this, so `oracle.body` is
    // the authority for which body is being built. Asserted rather than assumed:
    // if these two ever disagree the worker generates one planet and the main
    // thread walks on another, silently, which is the exact defect that reading
    // `cfg.bodyId` inside `bootTerrain` used to guarantee.
    if (oracle.body.bodyId !== bodyId) {
      throw new Error(`body scope: asked for ${bodyId}, oracle holds ${oracle.body.bodyId}`);
    }
    // PS-46. THE DISCOVERY FIELD BELONGS TO THIS BODY BEFORE ANYTHING IN THE
    // SCOPE CAN WRITE TO IT. First, and above the terrain, because /core holds
    // ONE field and an observation taken against the outgoing lattice is a cell
    // on the wrong planet that nothing afterwards can tell apart from a real
    // one. Immediately after the oracle assertion, so the body this cuts for is
    // the body the assertion has just agreed on. See world/DiscoveryScope.ts.
    discReseat.fn?.(bodyId);
    // PS-49. AND THE SAVE FINDS OUT WHICH BODY IT IS NOW BEING ASKED ABOUT,
    // beside the discovery re-seat and for its reason: this is the one place
    // that knows the body changed. It needs no holder, because unlike the field
    // and the station there is nothing in the new scope to put back -- the
    // decision it makes is entirely about state this module already owns.
    arriveOnBody(bodyId);
    const t = await bootTerrain({
      cfg, quality, depth: renderer.depth, events, scenes, origin, body: oracle.body,
      atmosphere: sky.atmos, cascadeSplits: shadows.splits,
      // WG-42: the pond's surface is built and anchored inside bootTerrain, so
      // this is the only line the water costs the boot site.
      oracle,
      lifetime: lt,
    });
    t.stream.setNearDepthCutoff(regime.state.nearDepthCutoff);

    // RN-842. MEASURE THIS BODY'S OWN HORIZON OCCLUSION and hand it to the
    // terrain materials, which were built a few lines up holding the flat-plane
    // value. It happens HERE rather than beside the atmosphere because it needs
    // the oracle for THIS body scope (CE-20: `oracle.body`, never the boot
    // body) and because the materials have to exist to receive it.
    //
    // `?horizonocc=` WINS ABSOLUTELY, and the null return is what makes that
    // possible: a caller asking for 0 and nobody asking at all are different
    // states, and collapsing them is how a feature ships with its own negative
    // control permanently engaged.
    {
      const art = (self as unknown as {
        __ofTerrainArt?: {
          horizonOccDefault(): { present: boolean; value: number | null };
          setHorizonOcc(v: number): number;
        };
      }).__ofTerrainArt;
      const asked = art?.horizonOccDefault();
      if (art !== undefined && asked !== undefined && !asked.present) {
        const h = measureHorizonOcclusion(
          oracle, oracle.body, cfg.scenario.lat, cfg.scenario.lon);
        art.setHorizonOcc(h.omega);
        horizonOcc = h;
      }
    }
    // RN-46: the scatter consults the water authority so nothing grows on the
    // pond bed. The edits handle is a thunk because `voxels` is created below.
    //
    // MIND THE SENSE. `?scatterwet=1` means wet scattering is ALLOWED, i.e. the
    // rejection is OFF, so the oracle goes in when the flag is FALSE. RN-46 had
    // it inverted, which handed the oracle over only in the one configuration
    // that then refuses to use it, so the feature never ran in ANY build while
    // every reading looked healthy. See WET_REJECT_M.
    // WG-59: the body radius is the datum the TREELINE is measured from, and it
    // is READ from the body rather than written down here, on the DW-18 rule that
    // cost a walker a wrong gravity constant. `canopyRadiusM` 0 is the control.
    // CE-20: `oracle.body.radiusM` and not `body.radiusM`, because the second is
    // the boot body forever and the first is whichever body this scope is for.
    const sc = new Scatter(props, t.pool, cfg.props, cfg.density,
      cfg.scatterFair, cfg.grassShort,
      cfg.scatterWet ? null : oracle.water,
      () => read(voxelsRef, 'the voxel world')?.handle ?? 0,
      oracle.body.radiusM, cfg.canopyRadiusM, cfg.canopyShade, cfg.midHole, cfg.midEdge);
    // WG-64: THE REBASE PATH, which had no caller. `Scatter.replace` documents
    // itself as "THE rebase path" and nothing ever called it, so every prop was
    // left behind by the whole rebase delta each time the origin moved. Measured
    // on a driven 4 km sprint before this line existed: 4,000.089191 m of
    // displacement across 43 of 43 scattered chunks. It hangs off the streamer's
    // own hook rather than off a second `OriginRebased` subscription so it cannot
    // run before the views it reads have been re-placed.
    t.stream.afterRebase = () => sc.replace(t.stream.residentViews);
    // The hook holds the scatter, and the scatter holds the pool. Dropping it is
    // already `TerrainStream.dispose`'s job; this registration is what releases
    // the props THIS scope placed, in the scope that placed them.
    lt.add('scatter.placed', () => { sc.clearPlaced(); });

    // RN-2145. THE GROUND-COVER CARPET, built here beside the scatter and for
    // the same reason: it is keyed on this scope's chunk keys and it holds GPU
    // buffers, so it is scope state.
    //
    // It takes the NEAR TERRAIN MATERIAL, and that is the load-bearing argument
    // rather than a convenience: the carpet lights itself from the same shared
    // uniform objects the ground lights itself from (see GrassMaterial), which
    // is what makes cover and substrate unable to disagree about light the way
    // GrassPalette makes them unable to disagree about colour.
    // RN-2201. The props and the harvest nodes take the SAME two shared uniform
    // objects the carpet takes on the next line, for the same reason and from
    // the same two owners. Published here rather than plumbed through
    // `PropLibrary.load` because this is the one scope that already holds both,
    // and it runs during boot, before the first render compiles a program.
    publishPropSkyAmbient(
      sky.atmos as unknown as Parameters<typeof publishPropSkyAmbient>[0],
      t.materials.near.uniforms);

    const gc = new GrassCover({
      pool: t.pool, depth: renderer.depth, terrain: t.materials.near,
      atmosphere: sky.atmos, cascades: shadows.splits.length,
      maxReliefM: oracle.body.maxReliefM,
      water: cfg.scatterWet ? null : oracle.water,
      editsHandle: () => read(voxelsRef, 'the voxel world')?.handle ?? 0,
    });
    for (const m of gc.meshes) scenes.near.add(m);
    // CHAINED, not replaced. `afterRebase` is ONE slot and the scatter already
    // holds it; assigning over it is how the props get left 4 km behind
    // (WG-64's measurement, four lines up). The order is scatter first because
    // that is the order the two were registered in, and neither reads the
    // other.
    const afterScatter = t.stream.afterRebase;
    t.stream.afterRebase = () => {
      afterScatter?.();
      gc.replace(t.stream.residentViews);
    };
    void surfacesReady().then(() => { gc.bindCard(); });
    lt.add('grass.cover', () => { gc.dispose(); });
    (window as unknown as { __ofGrass: unknown }).__ofGrass = {
      report: () => gc.report(),
    };
    // RN-2233. THE THEOREM THE CANOPY'S `castShadow = false` RESTS ON, checked
    // rather than trusted, and checked HERE because this is the one place that
    // holds the shadow rig and can reach the world-layer constant.
    //
    // `PropLibrary` gives the far canopy its own batches and takes them out of
    // the shadow pass entirely, worth a measured 13.8 ms of the flyover's
    // 21.4 ms near pass for pixels that were identical to the digit. That is
    // only correct while EVERY canopy instance is outside EVERY cascade, which
    // is `CANOPY_NEAR_M` (the radius inside which the tier is exactly zero)
    // being greater than the furthest split. Two numbers in two files; either
    // could move, and if the near cut-off ever came inside a cascade the
    // failure would be a missing tree shadow, which is invisible in every
    // aggregate and exactly the class this project keeps paying for. It shouts
    // rather than throws, because a wrong shadow is worse than a wrong frame
    // and neither is worth refusing to boot over.
    {
      const far = shadows.splits.length > 0
        ? shadows.splits[shadows.splits.length - 1] : 0;
      if (cfg.canopyRadiusM > 0 && far >= CANOPY_NEAR_M) {
        console.error('[of] RN-2233 BROKEN: the furthest shadow cascade reaches'
          + ` ${far} m and the canopy starts at ${CANOPY_NEAR_M} m, so canopy`
          + ' trees are inside a cascade and their batches do not cast.'
          + ' Re-enable castShadow on the :canopy batches or move CANOPY_NEAR_M.');
      }
    }

    // RN-2225. THE WILD VEGETATION SOURCE FOR A WORLD WITH NO CHARACTER.
    //
    // The gate is the EXACT COMPLEMENT of `BootGameplay`'s (`player !== null &&
    // cfg.gameplay`), written as its negation rather than as a fresh condition,
    // so the two can never both build a tree field or both skip one. With a
    // character, `Gameplay` owns these objects and ticks them off the feet;
    // without one -- every `--scenario=surface|ascent|orbit|space` run and
    // every aerial probe pose -- nothing did, which is the whole of section
    // 2.12.6. `?gameplay=0` still isolates the slice: it takes the same branch
    // a fly scenario does but `cfg.gameplay` is false in it, so no node field
    // is built either way and the control still means what it says.
    //
    // Body-scoped for the scatter's reason: it holds instance slots and /core
    // node indices keyed to THIS body, so it dies with the scope.
    let wild: VegetationScope | null = null;
    if (player === null && cfg.gameplay && (cfg.treeRadiusM > 0 || cfg.rocks)) {
      const { VegetationScope: VS } = await import('../game/VegetationScope.js');
      wild = await VS.create({
        core, origin, bodyHandle: oracle.body.handle, seed: cfg.seedLo,
        // CE-20: `oracle.body.radiusM`, the body THIS scope is for, on the
        // same line of argument the scatter three constructors up gives.
        bodyRadiusM: oracle.body.radiusM, water: oracle.water,
        rocks: { enabled: cfg.rocks, density: cfg.rockDensity },
        trees: { radiusM: cfg.treeRadiusM, density: cfg.treeDensity },
        nodeArt: { lod: cfg.nodeLod, cull: cfg.nodeCull },
        // No voxels without a character (`phaseTools` is player-gated too), so
        // there is no dug ground for a node to seat into. A thunk anyway, so
        // the shape matches `composeGround`'s and cannot drift from it.
        editsHandle: () => 0,
      }, scenes.near);
      const w = wild;
      lt.add('vegetation.wild', () => { w.dispose(); });
    }
    built.v = t;
    // CE-47. R17. THE STATION COMES BACK WITH THE SCOPE.
    //
    // LAST, after the terrain, because a rebuild that threw halfway must not
    // leave a mounted station in a world with no ground under it. A call and not
    // an `lt.add`, because this is the BUILD half; `lt` already carries the
    // teardown half above. `mounts.lastTick` is the live tick: `Loop` is
    // constructed in `main.ts` AFTER `boot()` resolves, so this file has no
    // `tickIndex`, and re-posing at tick 0 instead would put the deck where the
    // conic was at boot. The body guard is CE-31's rule; see StationMount for
    // both arguments and for the residue it does not fix.
    stationRebuild.fn?.(bodyId, mounts.lastTick);
    return {
      body: oracle.body, terrain: t.stream, scatter: sc, grass: gc,
      wild, workerHandles: t.workerHandles,
    };
  };

  hud.banner('starting terrain.worker and preallocating the chunk pool ...');
  const tTerrain = performance.now();
  const bodyLifetime = new Lifetime('body#0');
  const firstScope = await buildBodyScope(body.bodyId, bodyLifetime);
  if (built.v === null) throw new Error('body scope produced no terrain');
  const t = built.v;
  const terrainBootMs = performance.now() - tTerrain;
  stats.extraVramBytes = t.pooledBytes + t.indexBytes + shadows.vramBytes();

  const session = WorldSession.adopt({
    core, events, oracle, origin, build: buildBodyScope,
    observerPos: () => observer.position,
    seedLo: cfg.seedLo, seedHi: cfg.seedHi, swellScale: cfg.swellScale,
  }, firstScope, bodyLifetime);
  // CE-20. THE LIVE READ. A rebuild replaces the `TerrainStream` object, so
  // anything holding the old one is holding a terminated worker. Everything
  // reached through `Services` follows the session for free (the record's fields
  // are getters below); the three collaborators that used to take a
  // `TerrainStream` BY VALUE in a constructor take this thunk instead. Three,
  // measured, not "about a dozen": `DigAction`, `LevelAction`, and gameplay's
  // `ports.terrain`.
  const terrainOf = (): TerrainStream => session.terrain;
  return {
    horizonOcc, carriers, ride, mounts, stationRebuild, discReseat,
    worldCapture, t, terrainBootMs, session, terrainOf,
  };
}
