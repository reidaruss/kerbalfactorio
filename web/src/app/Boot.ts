// Async construction of every service, in dependency order. main.ts calls this
// and nothing else. Kept out of main.ts so the composition root stays readable.

import * as THREE from 'three';
import type { Config } from './Config.js';
import { Events } from './Events.js';
import type { BootMetrics, Services } from './Services.js';
import { qualityKnobs } from '../render/Quality.js';
import { createRenderer } from '../render/Renderer.js';
import { Scenes } from '../render/Scenes.js';
import { CameraRig } from '../render/CameraRig.js';
import { Frame } from '../render/Frame.js';
import { SkyPass } from '../render/SkyPass.js';
import { StatsProbe } from '../render/debug/StatsProbe.js';
import { createViewModelPlaceholder, createGnomon } from '../render/debug/Placeholders.js';
import { benchOracle, loadOfCore } from '../sim/wasm/OfCore.js';
import { PlanetBody } from '../world/PlanetBody.js';
import { SurfaceOracle } from '../world/SurfaceOracle.js';
import { FloatingOrigin } from '../world/FloatingOrigin.js';
import { PlanetProxy } from '../world/PlanetProxy.js';
import { Regime } from '../world/Regime.js';
import { bootTerrain } from '../world/TerrainBoot.js';
import { ObserverCamera } from '../player/ObserverCamera.js';
import { Input } from '../player/Input.js';
import { Hud } from '../ui/Hud.js';
import { probeWorkerOracle } from './WorkerProbe.js';

function addLighting(scene: THREE.Scene, sunDir: THREE.Vector3, dist: number): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff2df, 3.0);
  sun.position.copy(sunDir).multiplyScalar(dist);
  sun.userData.distance = dist;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0x334466, 0x101008, 0.35));
  return sun;
}

export interface Booted {
  services: Services;
  canvas: HTMLCanvasElement;
}

export async function boot(cfg: Config, host: HTMLElement, hud: Hud): Promise<Booted> {
  const t0 = performance.now();
  const events = new Events();
  const quality = qualityKnobs(cfg.quality);

  hud.banner('loading of-core.wasm ...');
  const tWasm = performance.now();
  const core = await loadOfCore();
  const wasmLoadMs = performance.now() - tWasm;

  const body = PlanetBody.forge(core, cfg.seedLo, cfg.seedHi);
  const oracle = new SurfaceOracle(core, body);
  const oracleTiming = benchOracle(core, body.handle, 3000);

  const canvas = document.createElement('canvas');
  canvas.id = 'of-canvas';
  host.insertBefore(canvas, host.firstChild);
  const renderer = createRenderer(canvas, cfg, quality);

  const scenes = new Scenes();
  const rig = new CameraRig(renderer.depth);
  const frame = new Frame(renderer, scenes, rig);
  const stats = new StatsProbe();
  const sky = new SkyPass(cfg.seedLo, 0);
  scenes.sky.add(sky.group);

  const sunLights = [
    addLighting(scenes.far, sky.sunDirection, 1e4),
    addLighting(scenes.near, sky.sunDirection, 1e5),
  ];

  hud.banner('sampling the surface oracle for the planet proxy ...');
  // detail 16 -> 20 * 17^2 = 5,780 triangles, one draw call for a whole planet.
  const proxy = new PlanetProxy(body, oracle, 16);
  scenes.far.add(proxy.mesh);

  scenes.viewModel.add(createViewModelPlaceholder());
  if (new URLSearchParams(location.search).get('gnomon') === '1') {
    scenes.near.add(createGnomon());
  }

  const origin = new FloatingOrigin(events, 4000);
  const observer = new ObserverCamera(oracle);
  observer.teleport(cfg.scenario.lat, cfg.scenario.lon, cfg.scenario.alt);
  origin.step(observer.position);
  sky.setSunT(cfg.sunTExplicit ?? SkyPass.solveSunT(observer.up, cfg.scenario.sunDot));

  const input = new Input();
  input.attach(canvas);

  hud.banner('starting the worker WASM instance ...');
  const wp = await probeWorkerOracle(core, body, cfg);

  hud.banner('starting terrain.worker and preallocating the chunk pool ...');
  const tTerrain = performance.now();
  const regime = new Regime(renderer.depth.nearDepthCutoff());
  regime.update(observer.altM);
  const t = await bootTerrain(cfg, quality, renderer.depth, events, scenes, origin, body);
  const terrain = t.stream;
  terrain.setNearDepthCutoff(regime.state.nearDepthCutoff);
  const terrainBootMs = performance.now() - tTerrain;
  stats.extraVramBytes = t.pooledBytes + t.indexBytes;

  const boot: BootMetrics = {
    wasmLoadMs,
    oracleUs: {
      baseHeight: oracleTiming.baseHeightUs,
      surfaceHeight: oracleTiming.surfaceHeightUs,
      biomeAt: oracleTiming.biomeAtUs,
      solidAt: oracleTiming.solidAtUs,
    },
    workerLoadMs: wp.loadMs,
    workerProbeMs: wp.probeMs,
    workerAgrees: wp.agrees,
    workerMismatches: wp.mismatches,
    proxyBuildMs: proxy.buildMs,
    terrainWorkerLoadMs: t.workerLoadMs,
    terrainBootMs,
    chunkVerts: t.verts,
    chunkBytes: t.pooledBytes / cfg.chunkPoolSize,
    indexCount: t.indexCount,
    pooledBytes: t.pooledBytes,
    bootMs: performance.now() - t0,
  };

  const services: Services = {
    cfg, events, quality, renderer, scenes, rig, frame, sky, stats,
    core, body, oracle, origin, proxy, terrain, regime,
    materials: terrain.materials, observer, input, hud, sunLights, boot,
  };
  return { services, canvas };
}
