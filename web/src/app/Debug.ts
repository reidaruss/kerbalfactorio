// Builds window.__of: the interface an AI agent programs against, and a
// first-class deliverable rather than a debugging afterthought (WR-11).
// settle() gates every capture, so a screenshot cannot race streaming.

import { assetStats } from '../assets/Loaders.js';
import { gameplayApi } from './DebugGameplay.js';
import { terraformApi } from './DebugTerraform.js';
import type { Services } from './Services.js';
import type { FrameHash, Loop } from './Loop.js';
import type { FrameStats } from '../render/debug/StatsProbe.js';
import type { BootMetrics } from './Services.js';
import { BINDINGS } from '../player/Bindings.js';
import { dayPin, dayReport } from '../sim/DayCycle.js';
// RN-844. The VALUE, not the type: `setSunElev` calls the static solver, and
// calling the same one `Boot.ts` uses for `?sundot=` is what stops the two
// paths drifting into two answers.
import { SkyPass } from '../render/SkyPass.js';
import { meshVertsNear } from '../world/TerrainDebug.js';
import type { TapeEntry } from '../player/Input.js';
import type { ObserverState } from '../player/ViewSource.js';
import type { CameraMode } from '../player/ViewMode.js';
import type { JitterStats } from '../render/debug/JitterProbe.js';
import type { ZFightResult } from '../render/debug/ZFightProbe.js';

export interface WorldState {
  seed: string;
  scenario: string;
  observer: ObserverState;
  player: {
    mode: string; feet: number[]; grounded: boolean; speedMps: number;
    slopeCos: number;
    toggles: number; armLengthM: number;
    /** W5. Underground state: on a voxel floor, and refused by rock this tick. */
    underRock: boolean; blockedByRock: boolean; voxelPushM: number;
    onDeck: boolean; blockedByBuild: boolean; structureTests: number;
    aim: { origin: [number, number, number]; dir: [number, number, number] };
  } | null;
  bodyRadiusM: number;
  surfaceHeightM: number;
  biome: number;
  origin: { x: number; y: number; z: number; rebases: number };
  /** Eye position in RENDER space (body-frame eye minus floating origin). */
  eyeRel: [number, number, number];
  chunks: {
    resident: number; near: number; far: number; pending: number;
    hidden: number; fading: number; converged: boolean;
  };
  depthMode: string;
  regime: string;
  altM: number;
  tick: number;
  frames: number;
}

export interface SceneDump {
  sky: number; far: number; near: number; viewModel: number;
  poolInUse: number; poolFree: number;
}

export interface OfDebugApi {
  ready: Promise<void>;
  version: string;
  config: unknown;
  boot: BootMetrics;
  stats(): FrameStats & {
    boot: BootMetrics; gpu: string; terrain: StreamMetricsReport;
    pool: { inUse: number; free: number; exhausted: number }; stitch: StitchReport;
    shadow: unknown; ibl: unknown; lamp: unknown; props: unknown; avatar: unknown;
    assets: unknown;
    sky: {
      sunT: number; daylight: number; elevationDot: number; day: unknown;
      air: unknown;
    };
    caps: unknown;
  };
  world(): WorldState;
  scene(): SceneDump;
  chunks(n?: number, nearOnly?: boolean): unknown[];
  /** Gravity at radius rM, from /core (DW-18). The walker reads the same call. */
  gravity(rM: number): number;
  /** W5. Dig once along the current aim ray. Returns null with no character. */
  dig(): unknown;
  /** W5 voxel state: edits, near mesh, mouth reconciliation, harvest. */
  voxels(): unknown;
  /**
   * WG-22. Level once along the current aim ray, ignoring the cooldown, exactly
   * as the Q key does on the tick. `targetHeightM` defaults to the ground under
   * the player's feet, which is the tool's own rule; passing one is how a probe
   * levels to a height it chose. Null with no character or no ground in reach.
   */
  level(targetHeightM?: number): unknown;
  /** WG-22 terraforming state: the tool's counters and the footprint decal. */
  terraform(): unknown;
  /** W5. Voxel solidity at a body-frame point, through the one oracle. */
  solidAt(x: number, y: number, z: number): boolean;
  /**
   * The DRAWN near-terrain vertices within `radiusM` of a body-frame centre, as
   * `{dM, hM, depth}`. The oracle says what the ground IS; this says what the
   * player is looking at, and a terraforming claim needs both.
   */
  meshVerts(x: number, y: number, z: number, radiusM: number): unknown[];
  /**
   * W5. The pristine base and the edited surface under a body-frame direction.
   * `lowering` is derivedLoweringAt: 0 means this column's top is still solid,
   * which is exactly what a tunnel under intact ground must report.
   */
  surface(dx: number, dy: number, dz: number): { baseM: number; surfaceM: number; loweringM: number };
  settle(n?: number): Promise<void>;
  /** Advance `seconds` of sim on a synthetic clock. See Loop.run. */
  run(seconds: number, renderHz?: number): Promise<void>;
  /** Render + hash the presented frame. See Loop.frameHash. */
  framehash(tilesX?: number, tilesY?: number): FrameHash;
  screenshot(): Promise<Blob>;
  teleport(latDeg: number, lonDeg: number, altM: number): void;
  /** Absolute aim, in degrees. Framing a capture should not need an input tape. */
  look(yawDeg: number, pitchDeg: number): void;
  setTime(t: number): void;
  /**
   * RN-844. Put the sun at a given elevation ABOVE THE OBSERVER'S CURRENT
   * HORIZON, and return what was actually achieved.
   *
   * `setTime` takes a phase and `?sundot=` takes an elevation, and the gap
   * between them is a trap that has now cost two lanes a wrong conclusion.
   * `elevationDot` is `dot(sunDir, localUp)`, so the SAME phase is a different
   * elevation at every site: `?sundot=` is solved once at boot against the
   * SPAWN's up, and a probe that teleports keeps the phase and loses the
   * elevation. Measured on Cinder: asks of 0.28 / 0.55 / 0.92 are delivered at
   * the spawn to three digits (0.286 / 0.551 / 0.920) and at the crater-floor
   * site land at -0.778 / -0.815 / -0.706. All three are NIGHT and the whole
   * 0.64 of requested range has collapsed into 0.109, which is why two very
   * different `?sundot=` values produced frames a lane read as identical and
   * reported the flag as dead. The flag was not dead. It was answering about
   * somewhere else.
   *
   * This solves against `observer.up` AT THE MOMENT OF THE CALL, so it is
   * correct after a teleport by construction. It returns `{ wantDot, gotDot,
   * err, t }` rather than void, because a target above the site's maximum sun
   * is unreachable and silently landing at the nearest achievable elevation is
   * the same failure one layer down: the caller must be able to see the miss.
   *
   * RISING SIDE ONLY, so one elevation names ONE time of day (lookdev.js's
   * rule). Pinning also means `of.run` will drift it, so re-pin before a
   * capture (RN-13).
   */
  setSunElev(elevationDot: number): {
    wantDot: number; gotDot: number; err: number; t: number;
  };
  /**
   * The input tape, and it speaks ACTIONS as well as key codes.
   *
   * `press('use')` keeps working through the next remap; `press('KeyG')` does
   * not, and roughly twenty probes learned that the hard way when placing moved
   * off G (Bindings.ts). Both forms resolve through the one binding table.
   */
  input: {
    tape(t: TapeEntry[]): void;
    press(name: string, frames?: number): void;
    /** Hold a set of actions for `frames`, then release. The probe's click. */
    act(names: string[], frames?: number): void;
    /** Turn the wheel `n` notches. Positive is one slot to the right. */
    wheel(n: number): void;
    bindings(): Record<string, readonly string[]>;
  };
  /** FP/TP control. setView returns the aim ray so a toggle can be asserted. */
  setView(mode: CameraMode): AimRay | null;
  aim(): AimRay | null;
  /** Arm or disarm the float32 / fixed-tick jitter measurement. */
  jitter(on?: boolean): JitterStats;
  /** The ?scenario=zfight verdict. null when the probe scene is not built. */
  zprobe(): ZFightResult | null;
  /** W5 gameplay: pack, clearing, swing counters, pointer state. */
  game(): unknown;
  /** Every harvest node with its world position, nearest first. */
  nodes(): unknown[];
  /** Open or close the Tab panel from a probe, with the real transition. */
  panel(open: boolean): unknown;
  /** Craft by recipe index. Returns true only if /core actually crafted. */
  craft(index: number): boolean;
  /** Harvest node `i` now, ignoring reach. Proves the grant path in isolation. */
  harvest(index: number): unknown;
  /** W5. Headlamp on/off, or read it. Same toggle the L key drives. */
  lamp(on?: boolean): unknown;
  /**
   * W6 build mode. `select(n)` is the number key, `rotate()` is R, and both go
   * through the SAME code a keypress does, so a probe cannot drive a path a
   * player has no access to.
   */
  build(index?: number): unknown;
  /** W6. Take an automated machine's output by its plan id. Returns what moved. */
  collect(id: number): number;
  /**
   * W6. Demolish by plan id, or the hand-placed machine at `machine` index.
   * Goes through the SAME path the X key does, so a probe cannot remove
   * something a player could not.
   */
  demolish(sel: { id?: number; machine?: number }): unknown;
  /** W6 audio: stats, or 'mute' / 'unmute' / 'unlock' / a 0..1 volume. */
  audio(op?: string | number): unknown;
  /**
   * W6 audio acceptance: render every synthesised voice into an
   * OfflineAudioContext and measure the waveform. A counter proves a call was
   * made; this proves a sound exists (DW-20).
   */
  audioRender(): Promise<unknown>;
  /**
   * W7. The same measurement for the three CONTINUOUS beds (wind, underground,
   * Forest), which is where a silent-forever bug would hide.
   */
  bedsRender(): Promise<unknown>;
  /** DW-17. Write the autosave slot now. Returns what was written, or null. */
  save(): Promise<unknown>;
  /** DW-17. Apply the autosave slot over the live world. The reload path. */
  load(): Promise<unknown>;
  /** DW-17. Delete the slot, so the next boot is a fresh world. */
  wipe(): Promise<void>;
  /** DW-17. Regrow the clearing from the seed, exactly as boot does. */
  repopulate(): unknown;
  /** DW-17. Put the rock back: the voxel layer's `repopulate`. */
  forgetTunnels(): unknown;
  /** W7. The first-minute checklist, and the H key that hides it. */
  goals(show?: boolean): unknown;
}

export interface AimRay {
  origin: [number, number, number];
  dir: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  mode: string;
}

export interface StreamMetricsReport {
  updateMs: number; packMs: number; uploadMs: number;
  bytesLastUpdate: number; bytesTotal: number;
  chunksBuilt: number; poolExhausted: number; roundTripMs: number;
}

export interface StitchReport {
  restitched: number; verticesMoved: number; ms: number; totalRestitched: number;
}

export interface StreamReport {
  resident: number; near: number; far: number; pending: number; converged: boolean;
  poolInUse: number; poolFree: number; hidden: number; fading: number;
  metrics: StreamMetricsReport; stitch: StitchReport;
}

const EMPTY_STREAM: StreamReport = {
  resident: 0, near: 0, far: 0, pending: 0, converged: true, poolInUse: 0, poolFree: 0,
  hidden: 0, fading: 0,
  metrics: {
    updateMs: 0, packMs: 0, uploadMs: 0, bytesLastUpdate: 0,
    bytesTotal: 0, chunksBuilt: 0, poolExhausted: 0, roundTripMs: 0,
  },
  stitch: { restitched: 0, verticesMoved: 0, ms: 0, totalRestitched: 0 },
};

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
        avatar: s.avatar?.report() ?? null,
        // RN-821. The station's DRAW, which is not the station: `__of.station()`
        // is the record, the orbit and the proxies, and this is the mesh.
        stationDraw: s.station?.stats() ?? null,
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
  };
  (window as unknown as { __of: OfDebugApi }).__of = api;
  return api;
}
