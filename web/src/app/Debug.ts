// Builds window.__of: the interface an AI agent programs against, and a
// first-class deliverable rather than a debugging afterthought (WR-11).
// settle() gates every capture, so a screenshot cannot race streaming.

import { assetStats } from '../assets/Loaders.js';
import { gameplayApi } from './DebugGameplay.js';
import type { Services } from './Services.js';
import type { FrameHash, Loop } from './Loop.js';
import type { FrameStats } from '../render/debug/StatsProbe.js';
import type { BootMetrics } from './Services.js';
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
    mode: string; grounded: boolean; speedMps: number; slopeCos: number;
    toggles: number; armLengthM: number;
    /** W5. Underground state: on a voxel floor, and refused by rock this tick. */
    underRock: boolean; blockedByRock: boolean; voxelPushM: number;
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
    sky: { sunT: number; daylight: number; elevationDot: number };
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
  /** W5. Voxel solidity at a body-frame point, through the one oracle. */
  solidAt(x: number, y: number, z: number): boolean;
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
  input: { tape(t: TapeEntry[]): void; press(code: string, frames?: number): void };
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
  /** DW-17. Write the autosave slot now. Returns what was written, or null. */
  save(): Promise<unknown>;
  /** DW-17. Apply the autosave slot over the live world. The reload path. */
  load(): Promise<unknown>;
  /** DW-17. Delete the slot, so the next boot is a fresh world. */
  wipe(): Promise<void>;
  /** DW-17. Regrow the clearing from the seed, exactly as boot does. */
  repopulate(): unknown;
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
        assets: { ...assetStats, ms: Math.round(assetStats.ms) },
        sky: {
          sunT: s.sky.sunT,
          daylight: Math.round(s.sky.daylight * 1000) / 1000,
          elevationDot: Math.round(s.sky.elevation(s.observer.up) * 1000) / 1000,
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
          grounded: pl.body.grounded,
          speedMps: pl.body.speedMps,
          slopeCos: pl.body.slopeCos,
          toggles: pl.view.toggles,
          armLengthM: pl.view.armLength,
          underRock: pl.body.underRock,
          blockedByRock: pl.body.blockedByRock,
          voxelPushM: pl.body.voxelPushM,
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
    gravity: (rM: number) => s.body.gravityAccel(rM),

    solidAt: (x: number, y: number, z: number) => s.oracle.solidAt(x, y, z),

    surface(dx: number, dy: number, dz: number) {
      const L = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / L, uy = dy / L, uz = dz / L;
      const baseM = s.oracle.baseHeight(ux, uy, uz);
      const surfaceM = s.oracle.surfaceHeight(ux, uy, uz);
      return { baseM, surfaceM, loweringM: baseM - surfaceM };
    },

    dig() {
      const p = s.player;
      if (p === null || s.dig === null) return null;
      const ray = p.aimRay();
      const r = s.dig.digOnce(ray.origin, ray.dir);
      return { ...r, aim: { origin: ray.origin, dir: ray.dir } };
    },

    voxels() {
      if (s.voxels === null || s.voxelMesh === null || s.dig === null) return null;
      return {
        // removedCount comes from /core, not from a JS tally: if the two ever
        // disagree the browser has an edit set the simulation does not.
        removedCells: s.voxels.removedCount(),
        harvestedM3: s.dig.stats.volumeM3,
        ops: s.voxels.ops.length,
        action: s.dig.stats,
        mesh: s.voxelMesh.stats,
        meshVisible: s.voxelMesh.mesh.visible,
        // Strike debris, so a probe can assert chips were actually thrown
        // rather than that the call to throw them returned.
        fx: s.digFx === null ? null : { ...s.digFx.stats, visible: s.digFx.points.visible },
        // sent != applied means a dig never reached the heightfield, so the
        // voxel layer and the surface would silently disagree.
        mouth: { sent: s.terrain.digsSent, applied: s.terrain.digsApplied },
      };
    },

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

    setTime(t) { s.sky.setSunT(t); },

    input: {
      tape: (t) => s.input.playTape(t),
      press: (code, frames = 30) => s.input.playTape([{ hold: frames, keys: [code] }]),
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

    ...gameplayApi(s, loop),
  };
  (window as unknown as { __of: OfDebugApi }).__of = api;
  return api;
}
