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
  readonly boot: BootMetrics;
}

/** Just enough of THREE.DirectionalLight for Systems to aim it, no import. */
export interface DirectionalLightLike {
  position: { copy(v: { x: number; y: number; z: number }): { multiplyScalar(s: number): unknown } };
  userData: Record<string, unknown>;
}
