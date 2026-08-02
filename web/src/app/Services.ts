// The explicit typed dependency record. No global singletons, ever: everything
// that needs a collaborator is handed it, so the wiring is visible in one place
// (main.ts) and a test can substitute any part of it.

import type { Config } from './Config.js';
import type { Events } from './Events.js';
import type { QualityKnobs } from '../render/Quality.js';
import type { OFRenderer } from '../render/Renderer.js';
import type { Scenes } from '../render/Scenes.js';
import type { CameraRig } from '../render/CameraRig.js';
import type { Frame } from '../render/Frame.js';
import type { SkyPass } from '../render/SkyPass.js';
import type { ShadowRig } from '../render/ShadowRig.js';
import type { SkyIbl } from '../render/SkyIbl.js';
import type { Headlamp } from '../render/Headlamp.js';
import type { PropLibrary } from '../render/instancing/PropLibrary.js';
import type { VoxelWorld } from '../world/VoxelWorld.js';
import type { VoxelMesh } from '../world/VoxelMesh.js';
import type { DigFx } from '../render/DigFx.js';
import type { DigAction } from '../player/DigAction.js';
import type { LevelAction } from '../player/LevelAction.js';
import type { LevelRing } from '../world/LevelRing.js';
import type { Scatter } from '../world/Scatter.js';
import type { StatsProbe } from '../render/debug/StatsProbe.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { PlanetBody } from '../world/PlanetBody.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { PlanetProxy } from '../world/PlanetProxy.js';
import type { TerrainStream } from '../world/TerrainStream.js';
import type { Regime } from '../world/Regime.js';
import type { TerrainMaterials } from '../render/materials/TerrainMaterial.js';
import type { ViewSource } from '../player/ViewSource.js';
import type { Controller } from '../player/Controller.js';
import type { Avatar } from '../player/Avatar.js';
import type { Input } from '../player/Input.js';
import type { JitterProbe } from '../render/debug/JitterProbe.js';
import type { ZFightProbe } from '../render/debug/ZFightProbe.js';
import type { Hud } from '../ui/Hud.js';
import type { Gameplay } from '../game/Gameplay.js';
import type { Vab } from '../game/Vab.js';
import type { FlightMode } from './FlightMode.js';
import type { MapMode } from './MapMode.js';
import type { ViewRouter } from '../player/ViewRouter.js';
import type { StationView } from '../render/StationView.js';

/** One-off numbers measured at boot, surfaced through window.__of.stats(). */
export interface BootMetrics {
  wasmLoadMs: number;
  oracleUs: Record<string, number>;
  workerLoadMs: number;
  workerProbeMs: number;
  workerAgrees: boolean;
  workerMismatches: number;
  proxyBuildMs: number;
  terrainWorkerLoadMs: number;
  terrainBootMs: number;
  chunkVerts: number;
  chunkBytes: number;
  indexCount: number;
  pooledBytes: number;
  bootMs: number;
}

export interface Services {
  readonly cfg: Config;
  readonly events: Events;
  readonly quality: QualityKnobs;
  readonly renderer: OFRenderer;
  readonly scenes: Scenes;
  readonly rig: CameraRig;
  readonly frame: Frame;
  readonly sky: SkyPass;
  readonly stats: StatsProbe;
  readonly core: OfCoreModule;
  readonly body: PlanetBody;
  readonly oracle: SurfaceOracle;
  readonly origin: FloatingOrigin;
  readonly proxy: PlanetProxy;
  readonly terrain: TerrainStream;
  readonly regime: Regime;
  readonly materials: TerrainMaterials;
  /** Whatever drives the eye this run: the free camera or the walking capsule. */
  readonly observer: ViewSource;
  /** Non-null only when the capsule is driving (?mode=walk). */
  readonly player: Controller | null;
  /** The player's own body mesh. Non-null exactly when `player` is. */
  readonly avatar: Avatar | null;
  readonly input: Input;
  readonly jitter: JitterProbe;
  readonly zfight: ZFightProbe | null;
  readonly hud: Hud;
  readonly sunLights: DirectionalLightLike[];
  readonly shadows: ShadowRig;
  readonly ibl: SkyIbl;
  /** W5. Sky occlusion at the eye, the headlamp, and the ambient it replaces. */
  readonly headlamp: Headlamp;
  readonly props: PropLibrary;
  readonly scatter: Scatter;
  /** W5. Null in scenarios with no character (there is nobody to dig). */
  readonly voxels: VoxelWorld | null;
  readonly voxelMesh: VoxelMesh | null;
  readonly dig: DigAction | null;
  /** WG-22 terraforming. Null wherever `dig` is: no hands, no shovel. */
  readonly level: LevelAction | null;
  /** WG-22. The ground footprint a level press will move. */
  readonly levelRing: LevelRing | null;
  /** W5. Strike debris. Null wherever `dig` is null: no hands, no chips. */
  readonly digFx: DigFx | null;
  /** W5. Null with no character, or with ?gameplay=0. */
  readonly gameplay: Gameplay | null;
  /** W8. The assembly bay. Null without gameplay, or with ?vab=0. */
  readonly vab: Vab | null;
  /** W9. Flight. Null without the bay to build a rocket in, or with ?flight=0. */
  readonly flight: FlightMode | null;
  /** W12. The orbital map and the maneuver node. Null whenever flight is. */
  readonly map: MapMode | null;
  /** W9. THE eye router: which ViewSource is the streaming observer right now. */
  readonly router: ViewRouter;
  /** RN-821. The derelict station's hull and fitout. Null whenever the station
   *  itself is absent: no gameplay, no character, `?station=0`, or an asset
   *  that did not arrive. It is NOT the station's authority about anything;
   *  the record and the collision solid are `SpaceStation.ts`'s. */
  readonly station: StationView | null;
  readonly boot: BootMetrics;
}

/** Just enough of THREE.DirectionalLight for Systems to aim it, no import. */
export interface DirectionalLightLike {
  position: { copy(v: { x: number; y: number; z: number }): { multiplyScalar(s: number): unknown } };
  color: { copy(c: unknown): unknown };
  intensity: number;
  userData: Record<string, unknown>;
}
