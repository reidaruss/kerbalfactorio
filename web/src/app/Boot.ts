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
import { resumeWorld } from './ResumeBoot.js';
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
import { BIOME_ATLAS, SHARED_ATLAS, CANOPY_ATLAS } from '../assets/Registry.js';
import { registerPool } from '../game/InstancePools.js';
import { ObserverCamera } from '../player/ObserverCamera.js';
import { ViewRouter } from '../player/ViewRouter.js';
import { Controller } from '../player/Controller.js';
import type { FlightMode } from './FlightMode.js';
import { bootMap, type MapMode } from './MapBoot.js';
import { Avatar } from '../player/Avatar.js';
import type { ViewSource } from '../player/ViewSource.js';
import { Input } from '../player/Input.js';
import { JitterProbe } from '../render/debug/JitterProbe.js';
import { ZFightProbe } from '../render/debug/ZFightProbe.js';
import { Hud } from '../ui/Hud.js';
import type { Gameplay } from '../game/Gameplay.js';
import type { Vab } from '../game/Vab.js';
import { bootVab, type VabExits } from './VabBoot.js';
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
    iblGround: cfg.iblGround,
    iblGroundAmp: cfg.iblGroundAmp,
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
  // RN-64: and the GROUND half, which is what stops them crushing to black at
  // dawn while the terrain they stand on stays lit.
  const ibl = new SkyIbl(renderer, [scenes.near, scenes.viewModel], sky);
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
  // W9. The eye goes through a ROUTER so that boarding a rocket is a swap of the
  // one object the loop already talks to, rather than a branch inside the loop.
  // Everything downstream (the origin, the terrain request, the regime band, the
  // sky, the shadow fit) then follows the vessel with no further wiring, which
  // is what makes the surface-to-orbit handoff need no flight-specific code.
  const router = new ViewRouter(player ?? new ObserverCamera(oracle));
  const observer: ViewSource = router;
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
    // WG-42: the pond's surface is built and anchored inside bootTerrain, so
    // this is the only line the water costs the boot site.
    oracle,
  });
  const terrain = t.stream;
  terrain.setNearDepthCutoff(regime.state.nearDepthCutoff);
  const terrainBootMs = performance.now() - tTerrain;
  stats.extraVramBytes = t.pooledBytes + t.indexBytes + shadows.vramBytes();

  hud.banner('loading the biome prop atlases ...');
  // Every atlas, not just the biome under the observer: a walk crosses biome
  // boundaries continuously and a mid-walk fetch would hitch. Ten files, 392 kB.
  // `detail_cards.glb` is the ground-detail layer that sits UNDER the biome
  // props. It shipped, validated, and was declared in Registry.ts and never
  // passed to a loader, so it had never been drawn (blocker A-2).
  // The canopy atlas rides with the biome atlases and NOT with SHARED_ATLAS,
  // because `PropLibrary.load` reads SHARED_ATLAS to decide which batches get
  // the `:detail` suffix and that suffix sets `castShadow = false`. See
  // `Registry.CANOPY_ATLAS`. It is dropped entirely at `?canopy=0`, so the
  // control does not merely place no trees, it does not load them either.
  const canopy = cfg.canopyRadiusM > 0 ? [...CANOPY_ATLAS] : [];
  const atlases = cfg.props
    ? (cfg.detailCards ? [...BIOME_ATLAS, ...canopy, ...SHARED_ATLAS]
      : [...BIOME_ATLAS, ...canopy])
    : [];
  const props = await PropLibrary.load(atlases, scenes.near, cfg.propGrow,
    cfg.propCull, cfg.propLod2);
  // DW-28: the foliage pools report through the SAME registry the machine pools
  // do, so a refusal reaches the HUD as `POOL FULL: n NOT DRAWN` rather than
  // being counted into a field nothing prints.
  registerPool(props);
  // RN-46: the scatter consults the water authority so nothing grows on the
  // pond bed. The edits handle is a thunk because `voxels` is created below.
  //
  // MIND THE SENSE. `?scatterwet=1` means wet scattering is ALLOWED, i.e. the
  // rejection is OFF, so the oracle goes in when the flag is FALSE. RN-46 had
  // it inverted, which handed the oracle over only in the one configuration
  // that then refuses to use it, so the feature never ran in ANY build while
  // every reading looked healthy. See WET_REJECT_M.
  // WG-59: the body radius is the datum the TREELINE is measured from, and it
  // is READ from the body rather than written down here, on the DW-18 rule that
  // cost a walker a wrong gravity constant. `canopyRadiusM` 0 is the control.
  const scatter = new Scatter(props, t.pool, cfg.props, cfg.density,
    cfg.scatterFair, cfg.grassShort,
    cfg.scatterWet ? null : oracle.water, () => voxels?.handle ?? 0,
    body.radiusM, cfg.canopyRadiusM, cfg.canopyShade);

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

  // W8 THE ASSEMBLY BAY, wired in VabBoot.ts (Boot is at its line cap). Built
  // after gameplay because it spends the same pack, and before flight because
  // flight flies its design handle, which is why its two exits are late-bound.
  const vabExits: VabExits = { rollOut: null, recover: null };
  let vab: Vab | null = null;
  if (gameplay !== null && cfg.vab) {
    vab = await bootVab({
      core, bodyHandle: body.handle, host, canvas, scene: scenes.vab,
      camera: rig.vabCam, input, gameplay,
      setRenderMode: (on) => { frame.vabActive = on; },
    }, vabExits);
  }

  // W9 FLIGHT. Needs the bay (it flies the bay's design handle) and gameplay
  // (it hides the on-foot HUD while strapped in), so it is built last. Dynamic
  // import for standing rule 7: `?flight=0` has to isolate it for real.
  let flight: FlightMode | null = null;
  let map: MapMode | null = null;
  if (gameplay !== null && vab !== null && player !== null && cfg.flight) {
    hud.banner('loading the rocket meshes for flight ...');
    const { FlightMode: Mode } = await import('./FlightMode.js');
    const g = gameplay;
    const theVab = vab;
    flight = new Mode({
      M: core, bodyHandle: body.handle, bodyRadiusM: body.radiusM, oracle, origin,
      router, input, player, scene: scenes.near, host,
      designHandle: () => theVab.design.handle,
      // GP-57. THE PAD, as a thunk. A value would have worked here, but the
      // thunk keeps the pad's LIFETIME out of flight's hands, so a world
      // reloaded from a save hands back the RESTORED pads and not a stale list.
      pads: () => g.pads,
      setWorldUi: (on) => {
        g.hud.setVisible(on);
        g.hotbarBar.setVisible(on);
        g.goalPanel.setVisible(on && g.goals.visible);
      },
    });
    await flight.load();
    // Both entrances now run the SAME two calls in the same order, so the
    // button and the key cannot drift into meaning different things.
    const theFlight = flight;
    vabExits.rollOut = () => theFlight.fromBay(() => theVab.leave());
    // GP-121 / R11. The SAME method the Delete key reaches through Systems.ts,
    // so the button and the key cannot drift into meaning different things.
    vabExits.recover = () => theFlight.recover();
    // GP-53. The checklist learns about the rocket. It is a PORT rather than a
    // field on Gameplay because Gameplay is at its line cap and because the
    // checklist is the only thing that wants to know.
    g.goals.rocket = {
      parts: () => theVab.design.parts.length,
      rollouts: () => theFlight.rollouts,
      boardings: () => theFlight.boardings,
    };
    // THE MAP, on M. Ports in MapBoot (Boot is at cap); DW-36 adds the walker.
    map = await bootMap({ core, host, g, flight: theFlight, body, input, player, oracle });
  }
  // PH-64 to PH-69. THE WORLD COMES BACK AS IT WAS LEFT (ResumeBoot argues the
  // order). After the flight block, so a vessel has somewhere to be promoted
  // into; outside it, because the body anchor is owed to `?flight=0` too.
  resumeWorld({ flight, vab, router, origin });

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
    gameplay, vab, flight, map, router, boot,
  };
  return { services, canvas };
}
