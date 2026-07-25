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
import type { ObserverCamera } from '../player/ObserverCamera.js';
import type { Input } from '../player/Input.js';
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
  readonly observer: ObserverCamera;
  readonly input: Input;
  readonly hud: Hud;
  readonly boot: BootMetrics;
}
