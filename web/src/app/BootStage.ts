// CE-140. THE BOOT CONTEXT AND THE PHASE PROTOCOL.
//
// `boot()` was 713 lines of one straight-line async sequence, and the only
// property that made it correct was its ORDER: `initKtx2` before any KTX2
// texture load, the prop atlases above the body scope so boot and every rebuild
// share ONE construction path, `resumeWorld` before the station install so a
// restored world adopts its saved record instead of minting a second one in the
// same orbit. Cutting it into phases is only safe if that order stays visible in
// ONE place, so every phase is a named function that takes the accumulated
// context it needs and returns exactly what it built, and `Boot.ts` calls them
// in the sequence the original lines ran in. The phase boundaries were not
// invented: each one is a blank line and a section comment the file already had.
//
// `BootCtx` is that context. Phases are typed as `Pick<BootCtx, ...>` in and
// `Pick<BootCtx, ...>` out, which is the whole of "explicit state": a phase
// cannot read something an earlier phase did not produce, and the compiler is
// what says so rather than a reviewer counting lines.
//
// TWO FORWARD REFERENCES SURVIVE THE CUT, and both were forward references in
// the original too. A closure may capture a `const` declared below it, as long
// as nothing CALLS the closure before that declaration runs, and the file used
// exactly that twice: `installShadeDiag`'s `feet` reads the observer built the
// phase after the renderer, and the body scope's `Scatter` reads the voxel
// handle built four phases later. A closure cannot capture across a module
// boundary, so each becomes an explicit `Holder` filled at the composition root
// the moment its phase returns. `read`/`need` THROW on an unfilled holder, which
// is the temporal-dead-zone error the original would have raised, kept rather
// than quietly replaced by a default. The file already used this shape four
// times for the same reason (`built`, `stationRebuild`, `discReseat`,
// `worldCapture`); this is that idiom, named.

import type * as THREE from 'three';
import type { Config } from './Config.js';
import type { Events } from './Events.js';
import type { Hud } from '../ui/Hud.js';
import type { QualityKnobs } from '../render/Quality.js';
import type { OFRenderer } from '../render/Renderer.js';
import type { Scenes } from '../render/Scenes.js';
import type { CameraRig } from '../render/CameraRig.js';
import type { Frame } from '../render/Frame.js';
import type { SkyPass } from '../render/SkyPass.js';
import type { ShadowRig } from '../render/ShadowRig.js';
import type { SkyIbl } from '../render/SkyIbl.js';
import type { Headlamp } from '../render/Headlamp.js';
import type { StatsProbe } from '../render/debug/StatsProbe.js';
import type { StationView } from '../render/StationView.js';
import type { PropLibrary } from '../render/instancing/PropLibrary.js';
import type { DigFx } from '../render/DigFx.js';
import type { HorizonOcclusion } from '../render/materials/HorizonOcclusion.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { OracleTiming } from '../sim/wasm/OfCore.js';
import type { BodyId, PlanetBody } from '../world/PlanetBody.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { PlanetProxy } from '../world/PlanetProxy.js';
import type { Regime } from '../world/Regime.js';
import type { TerrainBootResult } from '../world/TerrainBoot.js';
import type { TerrainStream } from '../world/TerrainStream.js';
import type { WorldSession } from '../world/WorldSession.js';
import type { CarrierRegistry } from '../world/CarrierFrame.js';
import type { CarrierRide } from '../world/CarrierRide.js';
import type { CarrierMounts } from '../world/CarrierGeometry.js';
import type { VoxelWorld } from '../world/VoxelWorld.js';
import type { VoxelMesh } from '../world/VoxelMesh.js';
import type { LevelRing } from '../world/LevelRing.js';
import type { Controller } from '../player/Controller.js';
import type { ViewRouter } from '../player/ViewRouter.js';
import type { ViewSource } from '../player/ViewSource.js';
import type { Avatar } from '../player/Avatar.js';
import type { Input } from '../player/Input.js';
import type { DigAction } from '../player/DigAction.js';
import type { LevelAction } from '../player/LevelAction.js';
import type { JitterProbe } from '../render/debug/JitterProbe.js';
import type { ZFightProbe } from '../render/debug/ZFightProbe.js';
import type { WorkerProbeResult } from './WorkerProbe.js';
import type { FlightMode } from './FlightMode.js';
import type { MapMode } from './MapBoot.js';
import type { Gameplay } from '../game/Gameplay.js';
import type { Vab } from '../game/Vab.js';

/** Everything `boot()` builds, in the order the phases build it. */
export interface BootCtx {
  // Handed in by main.ts.
  cfg: Config;
  host: HTMLElement;
  hud: Hud;
  // phaseEngine
  t0: number;
  events: Events;
  quality: QualityKnobs;
  core: OfCoreModule;
  wasmLoadMs: number;
  body: PlanetBody;
  oracle: SurfaceOracle;
  oracleTiming: OracleTiming;
  // phaseRender
  canvas: HTMLCanvasElement;
  renderer: OFRenderer;
  scenes: Scenes;
  rig: CameraRig;
  frame: Frame;
  stats: StatsProbe;
  sky: SkyPass;
  sunLights: THREE.DirectionalLight[];
  headlamp: Headlamp;
  shadows: ShadowRig;
  ibl: SkyIbl;
  proxy: PlanetProxy;
  // phaseObserver
  origin: FloatingOrigin;
  player: Controller | null;
  router: ViewRouter;
  observer: ViewSource;
  avatar: Avatar | null;
  input: Input;
  jitter: JitterProbe;
  zfight: ZFightProbe | null;
  // phaseWorldPrep
  wp: WorkerProbeResult;
  regime: Regime;
  props: PropLibrary;
  // phaseBodyScope
  horizonOcc: HorizonOcclusion | null;
  carriers: CarrierRegistry;
  ride: CarrierRide | null;
  mounts: CarrierMounts;
  stationRebuild: { fn: ((bodyId: BodyId, tick: number) => void) | null };
  discReseat: { fn: ((bodyId: BodyId) => void) | null };
  worldCapture: { fn: (() => void) | null };
  t: TerrainBootResult;
  terrainBootMs: number;
  session: WorldSession;
  terrainOf: () => TerrainStream;
  // phaseTools
  voxels: VoxelWorld | null;
  voxelMesh: VoxelMesh | null;
  digFx: DigFx | null;
  dig: DigAction | null;
  levelRing: LevelRing | null;
  level: LevelAction | null;
  // phaseGameplay
  gameplay: Gameplay | null;
  vab: Vab | null;
  flight: FlightMode | null;
  map: MapMode | null;
  // phaseStation
  station: StationView | null;
}

/** A value one phase produces and an EARLIER phase's closure reads. */
export interface Holder<T> { v: T | null; set: boolean }

export function holder<T>(): Holder<T> { return { v: null, set: false }; }

/** Fill it once, at the composition root, the moment its phase returns. */
export function fill<T>(h: Holder<T>, v: T | null): void { h.v = v; h.set = true; }

/** Read a holder that may legitimately hold null (an absent subsystem). */
export function read<T>(h: Holder<T>, what: string): T | null {
  if (!h.set) throw new Error(`boot: ${what} read before the phase that builds it`);
  return h.v;
}

/** Read a holder whose value is never null once its phase has run. */
export function need<T>(h: Holder<T>, what: string): T {
  const v = read(h, what);
  if (v === null) throw new Error(`boot: ${what} is null`);
  return v;
}
