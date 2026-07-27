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
import { ShadowRig } from '../render/ShadowRig.js';
import { SkyIbl } from '../render/SkyIbl.js';
import { Headlamp } from '../render/Headlamp.js';
import { forgeAtmosphere } from '../render/materials/Atmosphere.glsl.js';
import { StatsProbe } from '../render/debug/StatsProbe.js';
import { createViewModelPlaceholder, createGnomon } from '../render/debug/Placeholders.js';
import { benchOracle, loadOfCore } from '../sim/wasm/OfCore.js';
import { PlanetBody } from '../world/PlanetBody.js';
import { SurfaceOracle } from '../world/SurfaceOracle.js';
import { FloatingOrigin } from '../world/FloatingOrigin.js';
import { PlanetProxy } from '../world/PlanetProxy.js';
import { Regime } from '../world/Regime.js';
import { bootTerrain } from '../world/TerrainBoot.js';
import { VoxelWorld } from '../world/VoxelWorld.js';
import { VoxelMesh } from '../world/VoxelMesh.js';
import { DigFx } from '../render/DigFx.js';
import { DigAction } from '../player/DigAction.js';
import { LevelAction } from '../player/LevelAction.js';
import { LevelRing } from '../world/LevelRing.js';
import { Scatter } from '../world/Scatter.js';
import { PropLibrary } from '../render/instancing/PropLibrary.js';
import { BIOME_ATLAS } from '../assets/Registry.js';
import { ObserverCamera } from '../player/ObserverCamera.js';
import { Controller } from '../player/Controller.js';
import { Avatar } from '../player/Avatar.js';
import type { ViewSource } from '../player/ViewSource.js';
import { Input } from '../player/Input.js';
import { JitterProbe } from '../render/debug/JitterProbe.js';
import { ZFightProbe } from '../render/debug/ZFightProbe.js';
import { Hud } from '../ui/Hud.js';
import type { Gameplay } from '../game/Gameplay.js';
import { probeWorkerOracle } from './WorkerProbe.js';

/**
 * The stock-material lighting: PlanetProxy (Lambert) and the Avatar (Standard)
 * are lit by this, TerrainMaterial is not (it lights itself from uSunDir so the
 * sky and the ground cannot disagree). castShadow stays FALSE here: cascades are
 * ShadowRig's job and a second casting light would render a second shadow map.
 */
function addLighting(scene: THREE.Scene, sunDir: THREE.Vector3, dist: number,
  hemi = true): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff2df, 3.0);
  sun.position.copy(sunDir).multiplyScalar(dist);
  sun.userData.distance = dist;
  scene.add(sun);
  scene.add(sun.target);
  // `hemi` is false wherever Headlamp owns the ambient: a constant hemisphere
  // left behind would floor the darkness at 0.35 and the lamp would stop
  // mattering the moment the player went underground.
  if (hemi) scene.add(new THREE.HemisphereLight(0x334466, 0x101008, 0.35));
  return sun;
}

export interface Booted {
  services: Services;
  canvas: HTMLCanvasElement;
}

/** Camera basis from the orientation quaternion: -Z is forward, +X is right. */
function forwardOf(v: ViewSource): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(v.orientation).normalize();
}
function rightOf(v: ViewSource): THREE.Vector3 {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(v.orientation).normalize();
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
  const atmosParams = forgeAtmosphere(body.radiusM);
  const sky = new SkyPass(atmosParams, {
    seedLo: cfg.seedLo, sunT: 0, tier: cfg.quality,
    // ?clear= exists to count VOID pixels, and a painted sky makes every void
    // pixel opaque, so the census would silently read zero. Disable the sky with
    // the clear colour rather than making every crack probe remember --atmos=0.
    atmosphere: cfg.atmosphere && cfg.clearColor === 0,
    stars: cfg.stars,
    pixelRatio: renderer.pixelRatio,
  });
  scenes.sky.add(sky.group);

  // The FAR scene gets its own directional; nothing in it casts. The NEAR scene
  // gets NO directional here: ShadowRig's cascade 0 is the near sun from W4, so
  // the one light that lights the player is the one that shadows him. Two lights
  // is exactly why the character was never shadowed by the ground (section 17.4).
  const sunLights = [
    addLighting(scenes.far, sky.sunDirection, 1e4),
    addLighting(scenes.viewModel, sky.sunDirection, 3, false),
  ];
  // W5. THE underground lighting authority: it owns the near and view-model sky
  // ambient AND the headlamp that replaces it, because how dark it is and what
  // lights you are one question. Built here so the SpotLight is present in the
  // first compiled program and turning it on mid-tunnel costs no recompile.
  const headlamp = new Headlamp(scenes.near, scenes.viewModel);
  const shadows = new ShadowRig(scenes.near, quality, cfg.shadows);
  // Stock PBR materials (the player, the tools, the biome props) have no
  // scattering integral of their own, so they need an environment or they
  // render as black silhouettes on a lit hillside. Section 7.1, due at W4.
  const ibl = new SkyIbl(renderer, [scenes.near, scenes.viewModel]);
  // The view-model pass has NO lights of its own beyond the sun and Headlamp's
  // hemisphere: the arms are 0.35 m from the eye, always front-lit, and a
  // cascade fitted to a 22 m box would be wasted on them.
  const nearSun = shadows.sunLight;
  // distance 0 means "colour and intensity only": ShadowRig owns its position.
  if (nearSun !== null) { nearSun.userData.distance = 0; sunLights.push(nearSun); }

  hud.banner('sampling the surface oracle for the planet proxy ...');
  // detail 16 -> 20 * 17^2 = 5,780 triangles, one draw call for a whole planet.
  const proxy = new PlanetProxy(body, oracle, 16);
  proxy.setVisible(cfg.proxy);
  scenes.far.add(proxy.mesh);

  if (new URLSearchParams(location.search).get('gnomon') === '1') {
    scenes.near.add(createGnomon());
  }

  const origin = new FloatingOrigin(events, cfg.rebaseM);
  // Two ViewSource implementations, one contract. The capsule and the free
  // camera are BOTH the streaming observer when active, so what is drawn and
  // what is resident can never drift apart (the W1 rule, carried forward).
  const player = cfg.mode === 'walk'
    ? new Controller(oracle, cfg.view, cfg.walkSpeedMps, cfg.interpolate) : null;
  const observer: ViewSource = player ?? new ObserverCamera(oracle);
  observer.teleport(cfg.scenario.lat, cfg.scenario.lon, cfg.scenario.alt);
  if (cfg.scenario.pitchDeg !== undefined) {
    observer.look(0, THREE.MathUtils.degToRad(cfg.scenario.pitchDeg - observer.state().pitchDeg));
  }
  origin.step(observer.position);
  sky.setSunT(cfg.sunTExplicit ?? SkyPass.solveSunT(observer.up, cfg.scenario.sunDot));

  const avatar = player === null ? null : new Avatar();
  if (avatar !== null) {
    hud.banner('loading the character rig and the first-person arms ...');
    await avatar.load();
    scenes.near.add(avatar.group);
    scenes.viewModel.add(avatar.viewModel);
  } else {
    scenes.viewModel.add(createViewModelPlaceholder());
  }

  const input = new Input();
  input.attach(canvas);
  const jitter = new JitterProbe();
  const zfight = cfg.scenarioName === 'zfight'
    ? new ZFightProbe(scenes, origin, observer.position,
      forwardOf(observer), rightOf(observer), observer.up, cfg.zSepRatio)
    : null;
  // Both probes are world-anchored, so both subscribe to the ONE broadcast.
  if (zfight !== null) events.on('OriginRebased', () => zfight.place(origin));

  hud.banner('starting the worker WASM instance ...');
  const wp = await probeWorkerOracle(core, body, cfg);

  hud.banner('starting terrain.worker and preallocating the chunk pool ...');
  const tTerrain = performance.now();
  const regime = new Regime(cfg.nearCutoff > 0 ? cfg.nearCutoff : renderer.depth.nearDepthCutoff());
  regime.update(observer.altM);
  const t = await bootTerrain({
    cfg, quality, depth: renderer.depth, events, scenes, origin, body,
    atmosphere: sky.atmos, cascadeSplits: shadows.splits,
  });
  const terrain = t.stream;
  terrain.setNearDepthCutoff(regime.state.nearDepthCutoff);
  const terrainBootMs = performance.now() - tTerrain;
  stats.extraVramBytes = t.pooledBytes + t.indexBytes + shadows.vramBytes();

  hud.banner('loading the biome prop atlases ...');
  // Every atlas, not just the biome under the observer: a walk crosses biome
  // boundaries continuously and a mid-walk fetch would hitch. Ten files, 392 kB.
  const props = await PropLibrary.load(cfg.props ? BIOME_ATLAS : [], scenes.near);
  const scatter = new Scatter(props, t.pool, cfg.props, cfg.density);

  // W5. Created only when there is a character: with no player nobody digs, and
  // an unbound edits handle would arm voxel collision for a flying camera. The
  // handle is bound to the oracle in the VoxelWorld constructor, which is the
  // moment surfaceHeight starts subtracting derivedLoweringAt.
  const voxels = player === null ? null : new VoxelWorld(core, oracle);
  if (voxels !== null) voxels.aimAgainstShell = cfg.aimShell;
  const voxelMesh = voxels === null ? null
    : new VoxelMesh(core, body.handle, voxels.handle, origin, {
      bodyRadiusM: body.radiusM,
      maxReliefM: body.maxReliefM,
      surfaceRadiusAt: (dx, dy, dz) => oracle.surfaceRadius(dx, dy, dz),
      editFacesOnly: cfg.voxelSkinEditsOnly,
    });
  if (voxelMesh !== null && cfg.voxelNear) scenes.near.add(voxelMesh.mesh);
  // Debris. Reads gravity from the body, never from a constant (DW-18), and
  // costs one draw call that is skipped while nothing is in the air.
  const digFx = voxels === null ? null : new DigFx(origin, (r) => body.gravityAccel(r));
  if (digFx !== null) scenes.near.add(digFx.points);
  const dig = voxels === null || voxelMesh === null ? null
    : new DigAction(voxels, voxelMesh, terrain, digFx);
  // WG-22 terraforming. The ring is a ground decal, so it goes in the NEAR
  // scene beside the voxel mesh; `?levelring=0` isolates it (standing rule 7).
  const levelRing = voxels === null || !cfg.levelRing ? null
    : new LevelRing(oracle, origin);
  if (levelRing !== null) scenes.near.add(levelRing.mesh);
  const level = voxels === null || voxelMesh === null ? null
    : new LevelAction(voxels, voxelMesh, terrain, oracle, levelRing);

  // W5 gameplay. Also player-gated: the pack, the clearing and the swing all
  // hang off a character, and a free camera has no hands. It is built LAST
  // because it scatters its nodes around wherever the player already stands.
  let gameplay: Gameplay | null = null;
  if (player !== null && cfg.gameplay) {
    hud.banner('growing the harvest clearing ...');
    // Imported dynamically so `?gameplay=0` isolates the slice for real
    // (standing rule 7): with a static import the whole module graph is loaded,
    // parsed and bundled whether or not a single node is placed, so a probe
    // that means to measure the renderer alone cannot actually get there.
    const { Gameplay } = await import('../game/Gameplay.js');
    const { digOrePort } = await import('../game/DigOre.js');
    gameplay = await Gameplay.create({
      core, origin, player, avatar, input, host, scene: scenes.near,
      bodyHandle: body.handle, seed: cfg.seedLo,
      // DW-31. The mode is decided ONCE, here, and everything downstream asks
      // the ModeRules object rather than re-reading the flag.
      mode: cfg.sandbox ? 'sandbox' : 'survival',
      // DW-17: the voxel handles live here, so the save slot is handed them
      // rather than gameplay reaching for a global.
      ports: { voxels, voxelMesh, terrain },
    });
    // DIGGING INTO AN ORE BODY PAYS. The dig action lives in Services and the
    // ore pool lives in the gameplay layer, so this line is the seam between
    // them; without it a pickaxe swing at an outcrop grants ore and a dig strike
    // into the same ground grants nothing.
    // WG-23. The levelling tool announces every press through the same HUD line
    // every other action uses. A tool whose whole honest output is a number has
    // to have somewhere to say it, and a press that says nothing on ground a
    // 1 m lattice cannot flatten further is indistinguishable from a dead key.
    if (level !== null) level.flash = (t, secs) => gameplay?.hud.flash(t, secs);
    if (dig !== null) {
      const g = gameplay;
      dig.ore = digOrePort(g.oreField.patches, g.game, (n, name, at) => {
        const r = Math.hypot(at.x, at.y, at.z) || 1;
        g.fx.ingot(n, at, { x: at.x / r, y: at.y / r, z: at.z / r }, name);
        g.panel.invalidate();
      });
    }
  }

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
    materials: terrain.materials, observer, player, avatar, input, jitter, zfight,
    hud, sunLights, shadows, ibl, headlamp, props, scatter, voxels, voxelMesh, dig, digFx,
    level, levelRing,
    gameplay, boot,
  };
  return { services, canvas };
}
