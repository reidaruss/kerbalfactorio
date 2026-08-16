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
import { installIblDiag } from '../render/IblDiag.js';
import { installShadeDiag } from '../render/ShadeDiag.js';
import { installVmLightDiag } from '../render/ViewModelLight.js';
import { Headlamp } from '../render/Headlamp.js';
import { atmosphereForBody } from '../render/materials/Atmosphere.glsl.js';
import { measureHorizonOcclusion, type HorizonOcclusion }
  from '../render/materials/HorizonOcclusion.js';
import { StatsProbe } from '../render/debug/StatsProbe.js';
import { createViewModelPlaceholder, createGnomon } from '../render/debug/Placeholders.js';
import { resumeWorld } from './ResumeBoot.js';
import {
  learnStationProxies, learnStationSockets, STATION_ASSET,
} from '../game/SpaceStation.js';
import { StationView } from '../render/StationView.js';
import { initKtx2, loadGlb } from '../assets/Loaders.js';
import { volumes } from '../game/GravityVolumes.js';
import { benchOracle, loadOfCore } from '../sim/wasm/OfCore.js';
import { PlanetBody, type BodyId } from '../world/PlanetBody.js';
import { SurfaceOracle } from '../world/SurfaceOracle.js';
import { FloatingOrigin } from '../world/FloatingOrigin.js';
import { PlanetProxy } from '../world/PlanetProxy.js';
import { Regime } from '../world/Regime.js';
import { bootTerrain, type TerrainBootResult } from '../world/TerrainBoot.js';
import { Lifetime } from './Lifetime.js';
import { WorldSession, type BuildBodyScope } from '../world/WorldSession.js';
import { reseatDiscovery } from '../world/DiscoveryScope.js';
import { arriveOnBody, captureLeavingWorld } from '../game/WorldScope.js';
import { CarrierRegistry } from '../world/CarrierFrame.js';
import { CarrierRide } from '../world/CarrierRide.js';
import { CarrierMounts } from '../world/CarrierGeometry.js';
import { installAndMountStation } from './StationMount.js';
import type { TerrainStream } from '../world/TerrainStream.js';
import { VoxelWorld } from '../world/VoxelWorld.js';
import { VoxelMesh } from '../world/VoxelMesh.js';
import { DigFx } from '../render/DigFx.js';
import { DigAction } from '../player/DigAction.js';
import { LevelAction } from '../player/LevelAction.js';
import { LevelRing } from '../world/LevelRing.js';
import { Scatter } from '../world/Scatter.js';
import { PropLibrary } from '../render/instancing/PropLibrary.js';
import { BIOME_ATLAS, SHARED_ATLAS, CANOPY_ATLAS, setForestDetail }
  from '../assets/Registry.js';
import { setSpires } from '../game/NodeArt.js';
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
  const quality = qualityKnobs(cfg.quality, {
    iblSize: cfg.iblSizeOverride ?? undefined,
    shadowSoft: cfg.shadowSoftOverride ?? undefined,
  });

  hud.banner('loading of-core.wasm ...');
  const tWasm = performance.now();
  const core = await loadOfCore();
  const wasmLoadMs = performance.now() - tWasm;

  // RN-842. Filled in once the terrain materials exist and the body scope is
  // known; stays null when `?horizonocc=` supplied the value, because "measured
  // 0.149" and "told 0.149" are different facts and only one of them is
  // evidence.
  let horizonOcc: HorizonOcclusion | null = null;

  const body = PlanetBody.create(core, cfg.bodyId, cfg.seedLo, cfg.seedHi);
  const oracle = new SurfaceOracle(core, body);
  const oracleTiming = benchOracle(core, body.handle, 3000);

  const canvas = document.createElement('canvas');
  canvas.id = 'of-canvas';
  host.insertBefore(canvas, host.firstChild);
  const renderer = createRenderer(canvas, cfg, quality);
  // RN-1462. Must run before any KTX2 texture load; see Loaders.ts for why
  // (`detectSupport` needs the GPU context to pick a transcode target).
  // Every other asset load in `boot()` is below this line, and the first is
  // several hundred lines down (`STATION_ASSET`), so this is not tight.
  initKtx2(renderer);

  const scenes = new Scenes();
  const rig = new CameraRig(renderer.depth);
  const frame = new Frame(renderer, scenes, rig);
  const stats = new StatsProbe();
  // RN-840. THE BODY CHOOSES ITS OWN AIR. This was `forgeAtmosphere(...)`
  // unconditionally, which is why the moon had a blue sky: the only body-derived
  // input was the radius, so Cinder got Earth's Rayleigh coefficients over a
  // 200 km ball. `body.hasAtmosphere` is /core's `AtmosphereProfile::present()`
  // read back through `_of_atmo_*`, so nothing on this line knows what a Cinder
  // is and a third body needs no edit here.
  const atmosParams = atmosphereForBody(body.radiusM, body.hasAtmosphere);
  const sky = new SkyPass(atmosParams, {
    seedLo: cfg.seedLo, sunT: 0, tier: cfg.quality,
    // ?clear= exists to count VOID pixels, and a painted sky makes every void
    // pixel opaque, so the census would silently read zero. Disable the sky with
    // the clear colour rather than making every crack probe remember --atmos=0.
    atmosphere: cfg.atmosphere && cfg.clearColor === 0,
    // RN-840. The integral runs only where there is something to scatter in.
    // `cfg.atmosphere` still forces it off, so `?atmos=0` is unchanged.
    scattering: cfg.atmosphere && cfg.clearColor === 0 && body.hasAtmosphere,
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
  // RN-1990. NAMED, because `ViewModelLight` resolves it by name for the same
  // reason `Frame.publishSun` resolves cascade 0 by name: a producer that names
  // and a consumer that reads cannot drift the way a cached handle can.
  sunLights[1].name = 'vmSun';
  // RN-1990. Pass 4's shadow term. Published unconditionally on RN-514's rule,
  // and every default is the shipped frame, so its existence changes no pixel.
  installVmLightDiag(frame.vmLight);
  // W5. THE underground lighting authority: it owns the near and view-model sky
  // ambient AND the headlamp that replaces it, because how dark it is and what
  // lights you are one question. Built here so the SpotLight is present in the
  // first compiled program and turning it on mid-tunnel costs no recompile.
  const headlamp = new Headlamp(scenes.near, scenes.viewModel);
  // RN-1571. The rig needs the DEPTH CONVENTION, because three r185's PCF
  // branch does not flip the shadow bias for reversed depth the way its VSM and
  // BASIC branches do, and the shipped negative bias was therefore pushing
  // every receiver 4.8 m deeper into shadow instead of 4.8 m out of it.
  const shadows = new ShadowRig(scenes.near, quality, cfg.shadows,
    renderer.depth.mode === 'reversed');
  // Stock PBR materials (the player, the tools, the biome props) have no
  // scattering integral of their own, so they need an environment or they
  // render as black silhouettes on a lit hillside. Section 7.1, due at W4.
  // RN-64: and the GROUND half, which is what stops them crushing to black at
  // dawn while the terrain they stand on stays lit.
  const ibl = new SkyIbl(renderer, [scenes.near, scenes.viewModel], sky);
  // RN-1520. The IBL/specular diagnosis handle. It publishes only; nothing on
  // that path runs until a probe calls it, so the frame is unchanged.
  installIblDiag({
    renderer, skyScene: scenes.sky, nearScene: scenes.near,
    sunDirection: sky.sunDirection,
    setGroundMode: (on) => sky.setGroundMode(on),
    hasIblGround: sky.hasIblGround,
    setDiscBoost: (on) => sky.setDiscBoost(on),
  });
  // RN-1570. The shade discriminator's handle, same publish-only discipline:
  // it separates "the sun never reaches this face" from "the machine shadows
  // itself" by removing exactly the machine's own contribution to the cascades.
  // `feet` is resolved lazily through `observer`, which is declared below: the
  // closure is only ever CALLED by a probe, tens of seconds after boot, and the
  // observer's radial is the same tangent frame the walker's feet give to 1e-6
  // (the eye is 1.62 m up that same radial).
  installShadeDiag({
    nearScene: scenes.near,
    sunDirection: sky.sunDirection,
    feet: () => {
      const p = observer.position;
      return new THREE.Vector3(p.x, p.y, p.z);
    },
  });
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
  // RN-844. Record WHAT the solve was for and WHERE, so a probe that teleports
  // can see that its `?sundot=` no longer applies. `?t=` is an absolute phase
  // and was never solved against a site, so it records nothing.
  sky.solvedFor = cfg.sunTExplicit !== null ? null : {
    wantDot: cfg.scenario.sunDot,
    latDeg: cfg.scenario.lat,
    lonDeg: cfg.scenario.lon,
  };

  const avatar = player === null ? null : new Avatar(cfg.anim);
  if (avatar !== null) {
    hud.banner('loading the character rig and the first-person arms ...');
    await avatar.load();
    scenes.near.add(avatar.group);
    scenes.viewModel.add(avatar.viewModel);
    // RN-1876. The probe surface for `Avatar.debugHidden`, published the way
    // `Surfaces.ts` publishes its own (`__ofSurfaces`) and for the same stated
    // reason: Debug.ts is at its line cap and this is one property removable in
    // one line. Reading it back is deliberate, so a probe can assert the
    // control frame actually took rather than assume it did.
    (window as unknown as { __ofViewModel: unknown }).__ofViewModel = {
      hide: (on: boolean): boolean => { avatar.debugHidden = on; return avatar.debugHidden; },
      hidden: (): boolean => avatar.debugHidden,
    };
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

  const regime = new Regime(cfg.nearCutoff > 0 ? cfg.nearCutoff : renderer.depth.nearDepthCutoff());
  regime.update(observer.altM);

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
  // WG-91 / WG-94, both BEFORE anything reads the tables they write: `Scatter`
  // samples a chunk's props once at build time and `NodeField.load` derives its
  // download set from `ART`, so a table written after either has run would be a
  // control that changes nothing and reports success. See `Registry
  // .setForestDetail` and `NodeArt.setSpires` for what each flag restores.
  setForestDetail(cfg.forestDetail);
  setSpires(cfg.spires);
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

  // ---------------------------------------------------------------------------
  // CE-20. THE BODY SCOPE, in ONE function used by boot AND by every rebuild.
  //
  // The props above moved ABOVE the terrain for this: they are an async fetch
  // that depends on nothing the terrain makes, and leaving them below it forced
  // the terrain and the scatter to be built at two different points in `boot`,
  // which would have meant a second construction path for the rebuild. Two paths
  // that must agree is the second-authority failure this project has paid for
  // repeatedly; there is exactly one here, and the boot you get is the reboot
  // you get, by construction rather than by review.
  //
  // Everything constructed inside is registered with the scope's `Lifetime`,
  // which is what `WorldSession.reboot` ends. See world/WorldSession.ts for why
  // the oracle and the origin are RE-SEATED rather than appearing here.
  const built: { v: TerrainBootResult | null } = { v: null };
  // CE-31 / CE-33. Constructed HERE, above the scope builder, because the
  // builder is what registers their teardown and a `const` referenced from a
  // closure that runs before its own declaration is a temporal-dead-zone throw
  // at boot. Both objects are PROCESS-scoped and both hold BODY-scoped state,
  // which is why neither is `lt.own(...)`.
  const carriers = new CarrierRegistry();
  const ride = player === null ? null : new CarrierRide(player.body);
  // CE-80. The consumer half of the same term, constructed beside it and for
  // the same reason: process-scoped object, body-scoped contents.
  const mounts = new CarrierMounts();
  // CE-47. R17. THE ONE THING A REBUILD HAS TO PUT BACK. Full argument in
  // `StationMount.installAndMountStation`; the ordering that forces a holder is
  // that the station block 250 lines below needs `gameplay`, `router.up` and
  // `resumeWorld`, none of which exist when the FIRST scope is built, while
  // `mounts.bindTo(lt)` and `carriers.bindTo(lt)` live INSIDE that scope. Null
  // on the first pass is the correct reading: there is no station yet.
  const stationRebuild: { fn: ((bodyId: BodyId, tick: number) => void) | null } =
    { fn: null };
  // PS-46 / GP-725. THE SECOND THING A REBUILD HAS TO PUT BACK, and it is a
  // holder for exactly the reason the station above is one: the discovery field
  // is cut when the MAP is built, and the map is built 250 lines below because
  // it needs gameplay, the bay and flight. So the scope cannot construct it, and
  // the scope is the only place that knows the body changed. Null on the first
  // pass is the correct reading: `new Discovery(core, bodyId)` cuts the boot
  // body's field a moment later and there is nothing yet to re-seat.
  const discReseat: { fn: ((bodyId: BodyId) => void) | null } = { fn: null };
  // PS-49. THE THIRD, and the one whose half runs on the way OUT rather than on
  // the way in: the fifteen body-scoped populations a save is built from are all
  // constructed once in `Gameplay`, so a switch cannot re-cut them and the save
  // has to take a reading of the outgoing world instead. Same holder shape and
  // the same reason (gameplay is built 180 lines below this).
  const worldCapture: { fn: (() => void) | null } = { fn: null };
  const buildBodyScope: BuildBodyScope = async (bodyId, lt) => {
    // PS-49. THE READING OF THE OUTGOING WORLD, and it is registered FIRST so
    // that it exists even if the terrain build below throws, and runs LAST in
    // teardown, after the mounts, the ride and the frames. Nothing in that list
    // touches a building, a node or an edit set, so last is safe and is the
    // reading closest to the moment the world stopped being played.
    //
    // A TEARDOWN STEP AND NOT A CALL AT THE DOOR, for two reasons that are both
    // load-bearing. It has to run before `WorldSession.reboot` frees the old
    // body handle -- `lt.end()` is the only hook that does -- or `poi` is
    // captured as the same zero the defect writes; and a capture the CALLER
    // performs is a capture the next caller forgets, which is the half-operation
    // PS-41 refuses to make expressible. See game/WorldScope.ts.
    lt.add('world.capture', () => { worldCapture.fn?.(); });
    // CE-31 / CE-34. ONE registration site for every scope, boot's included. A
    // carrier is a position in THIS body's frame, so a carrier that survived a
    // switch would be CE-21's nonsense a second time: Anchorage's 1,000,000 m
    // orbit about Forge is five body-radii outside Cinder.
    //
    // ORDER: the registry's clear is registered first and the ride's release
    // second, so teardown (reverse registration) RELEASES THE RIDER BEFORE IT
    // DROPS THE FRAMES. The other order leaves one instant in which the ride
    // holds a carrier the registry has already forgotten, which is a handle to
    // a dead frame and is precisely the state clause 4 of the teardown contract
    // exists to make impossible.
    carriers.bindTo(lt);
    ride?.bindTo(lt);
    // CE-80. LAST, so reverse-of-registration teardown clears the mounts BEFORE
    // it releases the rider and drops the frames. A mount surviving into the
    // next body would be posing Forge's station against Cinder, one radius-ratio
    // away from being obviously wrong and therefore silent.
    mounts.bindTo(lt);
    // The session re-seats the oracle before calling this, so `oracle.body` is
    // the authority for which body is being built. Asserted rather than assumed:
    // if these two ever disagree the worker generates one planet and the main
    // thread walks on another, silently, which is the exact defect that reading
    // `cfg.bodyId` inside `bootTerrain` used to guarantee.
    if (oracle.body.bodyId !== bodyId) {
      throw new Error(`body scope: asked for ${bodyId}, oracle holds ${oracle.body.bodyId}`);
    }
    // PS-46. THE DISCOVERY FIELD BELONGS TO THIS BODY BEFORE ANYTHING IN THE
    // SCOPE CAN WRITE TO IT. First, and above the terrain, because /core holds
    // ONE field and an observation taken against the outgoing lattice is a cell
    // on the wrong planet that nothing afterwards can tell apart from a real
    // one. Immediately after the oracle assertion, so the body this cuts for is
    // the body the assertion has just agreed on. See world/DiscoveryScope.ts.
    discReseat.fn?.(bodyId);
    // PS-49. AND THE SAVE FINDS OUT WHICH BODY IT IS NOW BEING ASKED ABOUT,
    // beside the discovery re-seat and for its reason: this is the one place
    // that knows the body changed. It needs no holder, because unlike the field
    // and the station there is nothing in the new scope to put back -- the
    // decision it makes is entirely about state this module already owns.
    arriveOnBody(bodyId);
    const t = await bootTerrain({
      cfg, quality, depth: renderer.depth, events, scenes, origin, body: oracle.body,
      atmosphere: sky.atmos, cascadeSplits: shadows.splits,
      // WG-42: the pond's surface is built and anchored inside bootTerrain, so
      // this is the only line the water costs the boot site.
      oracle,
      lifetime: lt,
    });
    t.stream.setNearDepthCutoff(regime.state.nearDepthCutoff);

    // RN-842. MEASURE THIS BODY'S OWN HORIZON OCCLUSION and hand it to the
    // terrain materials, which were built a few lines up holding the flat-plane
    // value. It happens HERE rather than beside the atmosphere because it needs
    // the oracle for THIS body scope (CE-20: `oracle.body`, never the boot
    // body) and because the materials have to exist to receive it.
    //
    // `?horizonocc=` WINS ABSOLUTELY, and the null return is what makes that
    // possible: a caller asking for 0 and nobody asking at all are different
    // states, and collapsing them is how a feature ships with its own negative
    // control permanently engaged.
    {
      const art = (self as unknown as {
        __ofTerrainArt?: {
          horizonOccDefault(): { present: boolean; value: number | null };
          setHorizonOcc(v: number): number;
        };
      }).__ofTerrainArt;
      const asked = art?.horizonOccDefault();
      if (art !== undefined && asked !== undefined && !asked.present) {
        const h = measureHorizonOcclusion(
          oracle, oracle.body, cfg.scenario.lat, cfg.scenario.lon);
        art.setHorizonOcc(h.omega);
        horizonOcc = h;
      }
    }
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
    // CE-20: `oracle.body.radiusM` and not `body.radiusM`, because the second is
    // the boot body forever and the first is whichever body this scope is for.
    const sc = new Scatter(props, t.pool, cfg.props, cfg.density,
      cfg.scatterFair, cfg.grassShort,
      cfg.scatterWet ? null : oracle.water, () => voxels?.handle ?? 0,
      oracle.body.radiusM, cfg.canopyRadiusM, cfg.canopyShade);
    // WG-64: THE REBASE PATH, which had no caller. `Scatter.replace` documents
    // itself as "THE rebase path" and nothing ever called it, so every prop was
    // left behind by the whole rebase delta each time the origin moved. Measured
    // on a driven 4 km sprint before this line existed: 4,000.089191 m of
    // displacement across 43 of 43 scattered chunks. It hangs off the streamer's
    // own hook rather than off a second `OriginRebased` subscription so it cannot
    // run before the views it reads have been re-placed.
    t.stream.afterRebase = () => sc.replace(t.stream.residentViews);
    // The hook holds the scatter, and the scatter holds the pool. Dropping it is
    // already `TerrainStream.dispose`'s job; this registration is what releases
    // the props THIS scope placed, in the scope that placed them.
    lt.add('scatter.placed', () => { sc.clearPlaced(); });
    built.v = t;
    // CE-47. R17. THE STATION COMES BACK WITH THE SCOPE.
    //
    // LAST, after the terrain, because a rebuild that threw halfway must not
    // leave a mounted station in a world with no ground under it. A call and not
    // an `lt.add`, because this is the BUILD half; `lt` already carries the
    // teardown half above. `mounts.lastTick` is the live tick: `Loop` is
    // constructed in `main.ts` AFTER `boot()` resolves, so this file has no
    // `tickIndex`, and re-posing at tick 0 instead would put the deck where the
    // conic was at boot. The body guard is CE-31's rule; see StationMount for
    // both arguments and for the residue it does not fix.
    stationRebuild.fn?.(bodyId, mounts.lastTick);
    return { body: oracle.body, terrain: t.stream, scatter: sc, workerHandles: t.workerHandles };
  };

  hud.banner('starting terrain.worker and preallocating the chunk pool ...');
  const tTerrain = performance.now();
  const bodyLifetime = new Lifetime('body#0');
  const firstScope = await buildBodyScope(body.bodyId, bodyLifetime);
  if (built.v === null) throw new Error('body scope produced no terrain');
  const t = built.v;
  const terrainBootMs = performance.now() - tTerrain;
  stats.extraVramBytes = t.pooledBytes + t.indexBytes + shadows.vramBytes();

  const session = WorldSession.adopt({
    core, events, oracle, origin, build: buildBodyScope,
    observerPos: () => observer.position,
    seedLo: cfg.seedLo, seedHi: cfg.seedHi,
  }, firstScope, bodyLifetime);
  // CE-20. THE LIVE READ. A rebuild replaces the `TerrainStream` object, so
  // anything holding the old one is holding a terminated worker. Everything
  // reached through `Services` follows the session for free (the record's fields
  // are getters below); the three collaborators that used to take a
  // `TerrainStream` BY VALUE in a constructor take this thunk instead. Three,
  // measured, not "about a dozen": `DigAction`, `LevelAction`, and gameplay's
  // `ports.terrain`.
  const terrainOf = (): TerrainStream => session.terrain;

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
    : new DigAction(voxels, voxelMesh, terrainOf, digFx);
  // WG-22 terraforming. The ring is a ground decal, so it goes in the NEAR
  // scene beside the voxel mesh; `?levelring=0` isolates it (standing rule 7).
  const levelRing = voxels === null || !cfg.levelRing ? null
    : new LevelRing(oracle, origin);
  if (levelRing !== null) scenes.near.add(levelRing.mesh);
  const level = voxels === null || voxelMesh === null ? null
    : new LevelAction(voxels, voxelMesh, terrainOf, oracle, levelRing);

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
    // PS-49. The save layer is reached from inside the dynamic block for
    // standing rule 7's reason, exactly as `Gameplay` is: a static import here
    // would pull the whole persistence graph into the main chunk and
    // `?gameplay=0` would stop isolating anything.
    const { snapshotOf } = await import('../game/PersistSlot.js');
    gameplay = await Gameplay.create({
      core, origin, player, avatar, input, host, scene: scenes.near,
      bodyHandle: body.handle, bodyId: body.bodyId, seed: cfg.seedLo,
      // WG-69: the rock lattice's datum and its water gate, both READ from the
      // objects that own them (DW-18: transcribing a body constant is how the
      // walker once fell at the wrong gravity). `?rocks=0` is the control.
      bodyRadiusM: body.radiusM, water: oracle.water,
      rocks: { enabled: cfg.rocks, density: cfg.rockDensity },
      // WG-116: the trees of the world, on the same lattice contract as the
      // rocks and reading the same body datum. `?trees=0` is the control.
      trees: { radiusM: cfg.treeRadiusM, density: cfg.treeDensity },
      nodeArt: { lod: cfg.nodeLod, cull: cfg.nodeCull },
      // DW-31. The mode is decided ONCE, here, and everything downstream asks
      // the ModeRules object rather than re-reading the flag.
      mode: cfg.sandbox ? 'sandbox' : 'survival',
      // DW-17: the voxel handles live here, so the save slot is handed them
      // rather than gameplay reaching for a global.
      // CE-20. A GETTER, so gameplay's port follows a rebuild. It held the
      // TerrainStream object, and a rebuilt scope would have left every dig and
      // every level press posting to a terminated worker with no error anywhere.
      ports: { voxels, voxelMesh, get terrain() { return session.terrain; } },
    });
    // PS-49. THE READING OF THE WORLD BEING LEFT, through the SAME function
    // that writes a save, so the fifteen body-scoped fields are enumerated
    // once and a field added later is frozen without anybody remembering to.
    // Assigned here rather than beside `discReseat` because it is the only
    // place `gameplay` is non-null by construction; a world with no gameplay
    // leaves the holder null, which `captureLeavingWorld` reads as "nothing to
    // freeze" rather than as an empty world.
    {
      const g = gameplay;
      worldCapture.fn = () => { captureLeavingWorld(() => snapshotOf(g)); };
    }
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
      core, bodyHandle: body.handle, bodyId: body.bodyId, host, canvas,
      scene: scenes.vab,
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
      // PH-383. ONE YES/NO QUESTION, not the research tree. R99's auto-approach
      // is gated on `StationBoarded`, which `StationReveal.ts` grants from the
      // hand-flown station mission itself, so Reid's task-39 ordering ("the
      // autopilot moves BEHIND the station visit") holds by construction.
      milestone: (id) => g.progress.research.earned(id),
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
    map = await bootMap({ core, host, g, flight: theFlight, body, input, player, oracle,
      frame, mapCam: rig.mapCam, sky, proxy });
  }
  // PS-46. AND THE SAME CALL ON EVERY REBUILD FROM HERE ON (the station's own
  // shape, 60 lines below). OUTSIDE the flight block on purpose: `?flight=0`
  // has no map and therefore no `Discovery` driver, but it still has a field in
  // /core and still autosaves it, so the field must follow the body there too.
  // `map` is read through the closure rather than captured, so this is the live
  // driver or null, whichever it is at the moment a rebuild happens.
  discReseat.fn = (rebuiltBodyId) => {
    reseatDiscovery(core, rebuiltBodyId, map?.discovery ?? null);
  };
  // PH-64 to PH-69. THE WORLD COMES BACK AS IT WAS LEFT (ResumeBoot argues the
  // order). After the flight block, so a vessel has somewhere to be promoted
  // into; outside it, because the body anchor is owed to `?flight=0` too.
  resumeWorld({ flight, vab, router, origin, core, bodyId: body.bodyId });

  // RN-821. Outside the conditional block below because `Services` needs them
  // and the block is optional: `?station=0`, no gameplay and no character each
  // leave the station out of the world, and null is the honest view for that.
  let stationRoot: THREE.Object3D | null = null;
  let station: StationView | null = null;

  // PH-94. THE STATION, after `resumeWorld` and not before, because the record
  // is the authority: a restored world must adopt its SAVED station and only a
  // genuinely new one may mint a fresh record. Installing first would mint a
  // second station on every load, and the two would sit in the same orbit.
  //
  // The interior is derived from the record on every boot and is never itself
  // saved, so there is exactly one thing on disk (nine numbers and a clock) and
  // the box list cannot drift away from the orbit it hangs on.
  if (gameplay !== null && player !== null && cfg.station) {
    // PH-105. THE INTERIOR IS THE SHIPPED MESH'S, read here because `Boot` is
    // where every other asset in this game is read and because the proxies must
    // be learned BEFORE `installStation`, which now refuses without them rather
    // than falling back to a hand-authored shape (see SpaceStation.ts).
    // `loadGlb` is cached and the failure is caught: a station whose asset did
    // not arrive must not take the whole boot down with it.
    //
    // RN-821: the SAME parsed scene also builds the render view, because the
    // boxes a player stands on and the hull they see have to be two readings of
    // one file. StationView.ts carries the rest of the argument.
    await loadGlb(STATION_ASSET)
      .then((g) => {
        learnStationProxies(g.scene);
        learnStationSockets(g.scene);
        stationRoot = g.scene;
      })
      .catch(() => { learnStationProxies(null); learnStationSockets(null); });
    const u = router.up;
    // RN-821. THE MESH IS BUILT FIRST AND ONLY ONCE, because it is the one part
    // of this block that is NOT idempotent: `scenes.near.add` on a rebuild would
    // put a second hull in the scene. The install below poses it. Building it
    // before the install report exists reverses the old order and is safe:
    // `build(null)` is the no-asset case the `.catch` above already produces,
    // and an unposed view draws nothing because `place` is what gives it a pose.
    station = new StationView(origin);
    station.build(stationRoot);
    scenes.near.add(station.group);
    // CE-47. THE ONE INSTALL PATH, called here exactly as the rebuild calls it:
    // same function, same arguments, only the tick differs (0 here, the live
    // tick there). The lines that used to be inline are in
    // `StationMount.installAndMountStation`, because a copy of them in a reboot
    // handler would be a second authority for where the station is.
    const stationDeps = {
      core, bodies: gameplay.structures.bodies, volumes, carriers, mounts,
      view: station, up: [u.x, u.y, u.z] as [number, number, number],
      bodyRadiusM: body.radiusM, muM3S2: body.muM3S2, bodyId: body.bodyId,
      gravityAccel: (rM: number) => body.gravityAccel(rM),
    };
    const st = installAndMountStation(stationDeps, 0);
    if (st !== null) {
      player.body.gravity = volumes;
      // CE-47. R17. AND THE SAME CALL, ON EVERY REBUILD FROM HERE ON. See the
      // holder's declaration above for why this is a late assignment rather than
      // a line inside `buildBodyScope`.
      stationRebuild.fn = (rebuiltBodyId, tick) => {
        if (rebuiltBodyId !== body.bodyId) return;
        installAndMountStation(stationDeps, tick);
      };
    }
  }

  const boot: BootMetrics = {
    wasmLoadMs,
    horizonOcc,
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

  // CE-20. FOUR FIELDS ARE NOW GETTERS, and the shape of the record is otherwise
  // untouched: `Services` still publishes `body`, `terrain`, `materials` and
  // `scatter` as `readonly`, and a getter satisfies a `readonly` field, so not
  // one of the ~90 call sites that read them changed. That is the point. The
  // alternative was churning every reader to go through `services.session`,
  // which would have been a large diff whose only effect was to move the same
  // staleness somewhere else. What actually mattered was that the VALUE stopped
  // being frozen at boot, and this is the whole of that change.
  const services: Services = {
    cfg, events, quality, renderer, scenes, rig, frame, sky, stats,
    core, oracle, origin, proxy, regime, session, carriers, ride, mounts,
    get body() { return session.body; },
    get terrain() { return session.terrain; },
    get materials() { return session.terrain.materials; },
    get scatter() { return session.scatter; },
    observer, player, avatar, input, jitter, zfight,
    hud, sunLights, shadows, ibl, headlamp, props, voxels, voxelMesh, dig, digFx,
    level, levelRing,
    gameplay, vab, flight, map, router, boot, station,
  };
  return { services, canvas };
}
