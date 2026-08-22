// The type/data half of Debug.ts (see that file's header: it builds
// window.__of, the interface an AI agent programs against). Split out at the
// 400-line cap: every declaration here is a type, an interface, or a plain
// data constant (EMPTY_STREAM), none of it behaviour, so the move is
// verbatim with zero export-prefix changes (all seven were already
// exported) and none of these names are used outside Debug.ts itself
// (confirmed by grep before splitting: only `installDebugApi` crosses the
// file boundary to main.ts).

import type { BootMetrics } from './Services.js';
import type { FrameHash } from './Loop.js';
import type { FrameStats } from '../render/debug/StatsProbe.js';
import type { TapeEntry } from '../player/Input.js';
import type { ObserverState } from '../player/ViewSource.js';
import type { CameraMode } from '../player/ViewMode.js';
import type { JitterStats } from '../render/debug/JitterProbe.js';
import type { ZFightResult } from '../render/debug/ZFightProbe.js';
import type { SaveSlot } from '../game/SaveGame.js';
import type { RescueRestoreReport } from '../game/FactoryRescue.js';

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
  /**
   * CE-130. THE CLOCK GUARDS' ACTIVATION COUNTS, on every run's standard dump.
   *
   * `run.mjs` prints `__of.world()` for every probe in the suite, so putting the
   * counters here makes "no live frame in this run had a negative delta" a fact
   * about EVERY probe run rather than a fact about the one probe that thought
   * to ask. The defect it watches for was found in a shot nobody suspected.
   */
  clock: { dtFloors: number; dtCeils: number; alphaClamps: number; dtMinS: number };
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
  /**
   * CE-130 / CE-131. The loop clock census: tick, frames, alpha, renderTick and
   * the THREE GUARD COUNTERS (`dtFloors`, `dtCeils`, `alphaClamps`).
   *
   * It exists so "the RN-2035 floor is dead code now" is a reading rather than
   * an argument. The counters only ever move on live rAF frames, so a probe
   * that drives with `of.run` and then lets the page render for a while can
   * state the activation count for a real session. See Loop.clock.
   */
  clock(): unknown;
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
  /**
   * BT-320 (R-RECOVER-1). The `of-rescue` store's reader: rescale copies
   * (FS-79) and fieldgen copies of a cleared player world (PS-53). `list`/
   * `read` are side-effect-free; `restore` writes the copy's bytes back into
   * the slot its own key names and does so ONLY on this explicit call, never
   * automatically. See `DebugRescue.ts`/`FactoryRescue.ts` for the full
   * safety argument and persistence.md's R-RECOVER-1 for the record.
   */
  rescue: {
    list(): Promise<string[]>;
    read(key: string): Promise<SaveSlot | null>;
    restore(key: string): Promise<RescueRestoreReport>;
  };
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

export const EMPTY_STREAM: StreamReport = {
  resident: 0, near: 0, far: 0, pending: 0, converged: true, poolInUse: 0, poolFree: 0,
  hidden: 0, fading: 0,
  metrics: {
    updateMs: 0, packMs: 0, uploadMs: 0, bytesLastUpdate: 0,
    bytesTotal: 0, chunksBuilt: 0, poolExhausted: 0, roundTripMs: 0,
  },
  stitch: { restitched: 0, verticesMoved: 0, ms: 0, totalRestitched: 0 },
};
