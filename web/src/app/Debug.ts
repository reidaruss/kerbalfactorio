// Builds window.__of: the interface an AI agent programs against, and a
// first-class deliverable rather than a debugging afterthought (WR-11).
// settle() gates every capture, so a screenshot cannot race streaming.
//
// BT-295 line-cap batch 3: the type/interface block (WorldState through
// EMPTY_STREAM, 244 lines) moved verbatim to DebugTypes.ts, none of it
// behaviour and none of it used outside this file (only `installDebugApi`
// itself crosses to main.ts). Re-exported below so nothing outside this
// pair notices the move.

import { assetStats } from '../assets/Loaders.js';
import { gameplayApi } from './DebugGameplay.js';
import { terraformApi } from './DebugTerraform.js';
import { sitesApi } from './DebugSites.js';
import { ruinsApi } from './DebugRuins.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';
import { BINDINGS } from '../player/Bindings.js';
import { dayPin, dayReport } from '../sim/DayCycle.js';
// RN-844. The VALUE, not the type: `setSunElev` calls the static solver, and
// calling the same one `Boot.ts` uses for `?sundot=` is what stops the two
// paths drifting into two answers.
import { SkyPass } from '../render/SkyPass.js';
import { meshVertsNear } from '../world/TerrainDebug.js';
import type { WorldState, SceneDump, OfDebugApi, AimRay, StreamReport } from './DebugTypes.js';
import { EMPTY_STREAM } from './DebugTypes.js';

export type { WorldState, SceneDump, OfDebugApi, AimRay, StreamMetricsReport,
  StitchReport, StreamReport } from './DebugTypes.js';

export function installDebugApi(
  s: Services, loop: Loop, ready: Promise<void>,
  streamReport: () => StreamReport = () => EMPTY_STREAM,
  chunkDump: (n: number, nearOnly: boolean) => unknown[] = () => [],
): OfDebugApi {
  const aimRay = (): AimRay | null => {
    const p = s.player;
    if (p === null) return null;
    const r = p.aimRay();
    return {
      origin: [r.origin.x, r.origin.y, r.origin.z],
      dir: [r.dir.x, r.dir.y, r.dir.z],
      yawDeg: (p.view.yaw * 180) / Math.PI,
      pitchDeg: (p.view.pitch * 180) / Math.PI,
      mode: p.view.mode,
    };
  };

  const api: OfDebugApi = {
    ready,
    version: 'W4',
    config: s.cfg,
    boot: s.boot,

    stats() {
      const st = streamReport();
      const rigCam = s.rig.nearCam;
      return {
        ...s.stats.stats(s.renderer, s.frame.timings),
        boot: s.boot,
        gpu: s.renderer.caps.gpu,
        caps: s.renderer.caps,
        terrain: st.metrics,
        pool: { inUse: st.poolInUse, free: st.poolFree, exhausted: st.metrics.poolExhausted },
        stitch: st.stitch,
        shadow: s.shadows.stats(),
        ibl: s.ibl.stats(),
        // W5. Sky occlusion at the eye and what it did to the lights, so a
        // probe can assert the tunnel actually went dark rather than that the
        // lamp object exists.
        lamp: s.headlamp.stats(),
        props: { ...s.props.stats(), ...s.scatter.stats() },
        // RN-2225. The wild rock and tree rings when there is no character to
        // own them. Null in a walk scenario, where `of.game().trees` already
        // reports the identical object through gameplay's own surface, so
        // there is one reading of a field and never two that can disagree.
        wild: s.wild?.stats() ?? null,
        avatar: s.avatar?.report() ?? null,
        // RN-821. The station's DRAW, which is not the station: `__of.station()`
        // is the record, the orbit and the proxies, and this is the mesh.
        stationDraw: s.station?.stats() ?? null,
        // RN-1955. THE CAMERA THAT WAS ACTUALLY RENDERED WITH, and it is NOT
        // what `of.aim()` reports. `aim()` returns `Controller.view.eye`, the
        // f64 body-frame eye; `Loop.drain` then runs `observer.interpolate`,
        // converts through the FLOATING ORIGIN and hands `rig.setView` an
        // ENGINE-space position. Three separate passes of the station shot
        // certified "the camera is reproducible to full float precision" off
        // `aim()` alone, which cannot see either the interpolation or the
        // origin. Published here so that claim can be made against the
        // transform the frame was rasterised from.
        cam: {
          posE: rigCam.position.toArray(),
          quat: rigCam.quaternion.toArray(),
          fovDeg: rigCam.fov, near: rigCam.near, far: rigCam.far,
        },
        assets: { ...assetStats, ms: Math.round(assetStats.ms) },
        sky: {
          sunT: s.sky.sunT,
          daylight: Math.round(s.sky.daylight * 1000) / 1000,
          elevationDot: Math.round(s.sky.elevation(s.observer.up) * 1000) / 1000,
          // PH-86: the day clock's own account. `t` is full precision where
          // `elevationDot` above is rounded; a probe measuring the sweep rate
          // reads this.
          day: dayReport(),
          // RN-840. THE TERMS, NEVER THE VERDICT (RN-823's rule).
          //
          // "The sky is black" is equally consistent with a correct vacuum, a
          // sky box that failed to build, `?atmos=0`, a `?clear=` census run and
          // a night, and those five want opposite fixes. So publish what each of
          // them would set differently: whether the box EXISTS, whether the
          // INTEGRAL runs, and the two /core numbers the choice was made from.
          // A probe can then distinguish "airless, correctly" from "sky
          // missing", which a single boolean cannot.
          // RN-844. WHERE THE BOOT SUN WAS SOLVED, so a probe can see that the
          // `?sundot=` it passed was aimed at a site it has since left. Without
          // this the only observable is `elevationDot`, which is a correct
          // reading of the wrong question and looks exactly like a working flag.
          sunSolve: s.sky.solvedFor,
          air: {
            box: s.sky.hasSkyBox,
            atmosOn: s.sky.atmos.uAtmosOn.value,
            thicknessM: s.sky.params.thicknessM,
            coreSeaLevelDensity: s.body.seaLevelDensityKgM3,
            coreSpaceAltitudeM: s.body.atmosphereTopM,
            hasAtmosphere: s.body.hasAtmosphere,
          },
        },
      };
    },

    world(): WorldState {
      const o = s.observer;
      const p = o.position;
      const r = Math.hypot(p.x, p.y, p.z) || 1;
      const st = streamReport();
      const pl = s.player;
      const ray = aimRay();
      return {
        seed: s.cfg.seedText,
        scenario: s.cfg.scenarioName,
        observer: o.state(),
        player: pl === null || ray === null ? null : {
          mode: pl.view.mode,
          /** Body-frame metres. The one thing a probe cannot derive from the
           *  aim ray, because the eye is 1.62 m up a curved radial. */
          feet: [pl.body.feet.x, pl.body.feet.y, pl.body.feet.z],
          grounded: pl.body.grounded,
          speedMps: pl.body.speedMps,
          slopeCos: pl.body.slopeCos,
          toggles: pl.view.toggles,
          armLengthM: pl.view.armLength,
          underRock: pl.body.underRock,
          blockedByRock: pl.body.blockedByRock,
          voxelPushM: pl.body.voxelPushM,
          // The structural port: standing on what the player built, and being
          // stopped by it. Both are how a walk through a doorway is asserted.
          onDeck: pl.body.onDeck,
          blockedByBuild: pl.body.blockedByBuild,
          structureTests: pl.body.structureTests,
          aim: { origin: ray.origin, dir: ray.dir },
        },
        bodyRadiusM: s.body.radiusM,
        surfaceHeightM: s.oracle.surfaceHeight(p.x / r, p.y / r, p.z / r),
        biome: s.oracle.biomeAt(p.x / r, p.y / r, p.z / r),
        origin: { x: s.origin.origin.x, y: s.origin.origin.y, z: s.origin.origin.z, rebases: s.origin.rebases },
        // The eye in RENDER space, i.e. the same frame chunks() reports meshPos
        // in. Without it a probe that ranks chunks by |meshPos| is measuring
        // distance from the floating ORIGIN, which drifts up to rebaseM from
        // the camera and silently returns the wrong chunk as "under the feet".
        eyeRel: [p.x - s.origin.origin.x, p.y - s.origin.origin.y, p.z - s.origin.origin.z],
        chunks: {
          resident: st.resident, near: st.near, far: st.far,
          pending: st.pending, hidden: st.hidden, fading: st.fading,
          converged: st.converged,
        },
        depthMode: s.renderer.depth.mode,
        regime: s.regime.state.band,
        altM: s.observer.altM,
        tick: loop.tickIndex,
        frames: loop.frames,
        clock: { dtFloors: loop.dtFloors, dtCeils: loop.dtCeils,
                 alphaClamps: loop.alphaClamps, dtMinS: loop.dtMinS },
      };
    },

    scene(): SceneDump {
      const st = streamReport();
      return {
        sky: s.scenes.sky.children.length,
        far: s.scenes.far.children.length,
        near: s.scenes.near.children.length,
        viewModel: s.scenes.viewModel.children.length,
        poolInUse: st.poolInUse,
        poolFree: st.poolFree,
      };
    },

    chunks: (n = 4, nearOnly = false) => chunkDump(n, nearOnly),
    meshVerts: (x, y, z, radiusM) => meshVertsNear(
      s.terrain.residentViews.values(), s.terrain.geometryPool,
      x, y, z, radiusM, s.body.radiusM),
    gravity: (rM: number) => s.body.gravityAccel(rM),

    settle: (n = 8) => loop.settle(n),
    run: (seconds, renderHz) => loop.run(seconds, renderHz),
    clock: () => loop.clock(),
    framehash: (tx, ty) => loop.frameHash(tx, ty),
    screenshot: () => loop.capture(),

    teleport(latDeg, lonDeg, altM) {
      s.observer.teleport(latDeg, lonDeg, altM);
    },

    look(yawDeg, pitchDeg) {
      const st = s.observer.state();
      s.observer.look(
        ((yawDeg - st.yawDeg) * Math.PI) / 180,
        ((pitchDeg - st.pitchDeg) * Math.PI) / 180,
      );
      // Rebuild the tangent frame NOW, so aim() reflects the look that just
      // happened. ViewMode derives the aim ray in update(), which runs on the
      // fixed tick, so without this a probe that turns and immediately reads
      // aim() gets the PREVIOUS orientation and silently measures nothing. That
      // is precisely the DW-20 failure mode, in the verification API itself.
      s.observer.interpolate(1);
    },

    // PH-86: PINS the day clock as well as the sky, or the next fixed tick
    // would overwrite the probe's sun with the running cycle's.
    setTime(t) { dayPin(t); s.sky.setSunT(t); },

    // RN-844. Reuses `SkyPass.solveSunT`, the SAME solver `Boot.ts` runs for
    // `?sundot=`, so this cannot drift from the boot path: the only difference
    // is which `up` it is handed, and that difference is the entire bug.
    setSunElev(elevationDot) {
      const up = s.observer.up;
      const t = SkyPass.solveSunT(up, elevationDot);
      dayPin(t);
      s.sky.setSunT(t);
      const gotDot = s.sky.elevation(up);
      return {
        wantDot: elevationDot,
        gotDot: Math.round(gotDot * 1e4) / 1e4,
        // THE MISS, published rather than swallowed. `solveSunT` scans 720
        // phases and returns the closest, so an unreachable target (a polar
        // site in winter asking for a high sun) returns the site's maximum
        // with no complaint. A caller that asserts on `err` sees that; a
        // caller that trusts a void return does not.
        err: Math.round(Math.abs(gotDot - elevationDot) * 1e4) / 1e4,
        t,
      };
    },

    input: {
      tape: (t) => s.input.playTape(t),
      press: (name, frames = 30) => s.input.playTape(
        [{ hold: frames, actions: [name] }, { hold: 2, keys: [] }]),
      act: (names, frames = 6) => s.input.playTape(
        [{ hold: frames, actions: names }, { hold: 2, keys: [] }]),
      wheel: (n) => s.input.playTape([{ hold: 1, wheel: n }, { hold: 2, keys: [] }]),
      bindings: () => BINDINGS,
    },

    setView(mode) {
      s.player?.setMode(mode);
      return aimRay();
    },

    aim: aimRay,

    jitter(on) {
      if (on === true) { s.jitter.reset(); s.jitter.enabled = true; }
      if (on === false) s.jitter.enabled = false;
      return s.jitter.stats();
    },

    zprobe: () => s.zfight?.result(s.renderer.depth.mode) ?? null,

    ...terraformApi(s),
    ...gameplayApi(s, loop),
    ...sitesApi(s),
    // WG-166. The site TABLE is `sitesApi`; the drawn INSTANCES are this one.
    // See DebugRuins.ts for why the two are separate surfaces.
    ...ruinsApi(s),
  };
  (window as unknown as { __of: OfDebugApi }).__of = api;
  return api;
}
