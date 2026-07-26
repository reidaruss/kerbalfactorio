// Builds window.__of: the interface an AI agent programs against, and a
// first-class deliverable rather than a debugging afterthought (WR-11).
// settle() gates every capture, so a screenshot cannot race streaming.

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
    aim: { origin: [number, number, number]; dir: [number, number, number] };
  } | null;
  bodyRadiusM: number;
  surfaceHeightM: number;
  biome: number;
  origin: { x: number; y: number; z: number; rebases: number };
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
    shadow: unknown; sky: { sunT: number; daylight: number; elevationDot: number };
    caps: unknown;
  };
  world(): WorldState;
  scene(): SceneDump;
  chunks(n?: number, nearOnly?: boolean): unknown[];
  settle(n?: number): Promise<void>;
  /** Advance `seconds` of sim on a synthetic clock. See Loop.run. */
  run(seconds: number, renderHz?: number): Promise<void>;
  /** Render + hash the presented frame. See Loop.frameHash. */
  framehash(tilesX?: number, tilesY?: number): FrameHash;
  screenshot(): Promise<Blob>;
  teleport(latDeg: number, lonDeg: number, altM: number): void;
  setTime(t: number): void;
  input: { tape(t: TapeEntry[]): void; press(code: string, frames?: number): void };
  /** FP/TP control. setView returns the aim ray so a toggle can be asserted. */
  setView(mode: CameraMode): AimRay | null;
  aim(): AimRay | null;
  /** Arm or disarm the float32 / fixed-tick jitter measurement. */
  jitter(on?: boolean): JitterStats;
  /** The ?scenario=zfight verdict. null when the probe scene is not built. */
  zprobe(): ZFightResult | null;
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
    version: 'W3',
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
          aim: { origin: ray.origin, dir: ray.dir },
        },
        bodyRadiusM: s.body.radiusM,
        surfaceHeightM: s.oracle.surfaceHeight(p.x / r, p.y / r, p.z / r),
        biome: s.oracle.biomeAt(p.x / r, p.y / r, p.z / r),
        origin: { x: s.origin.origin.x, y: s.origin.origin.y, z: s.origin.origin.z, rebases: s.origin.rebases },
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

    settle: (n = 8) => loop.settle(n),
    run: (seconds, renderHz) => loop.run(seconds, renderHz),
    framehash: (tx, ty) => loop.frameHash(tx, ty),
    screenshot: () => loop.capture(),

    teleport(latDeg, lonDeg, altM) {
      s.observer.teleport(latDeg, lonDeg, altM);
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
  };
  (window as unknown as { __of: OfDebugApi }).__of = api;
  return api;
}
