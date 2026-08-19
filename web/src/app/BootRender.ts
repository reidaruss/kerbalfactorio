// CE-140. PHASE 2: the canvas, the renderer, the scene graph, the sky, the
// lights, the shadow cascades, the IBL, the three publish-only diagnosis
// handles and the planet proxy. Lifted verbatim out of `Boot.ts` when `boot()`
// was cut into ordered phases; see `BootStage.ts` for the protocol and for why
// `observerRef` is a holder rather than a captured `const`.

import * as THREE from 'three';
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
import { StatsProbe } from '../render/debug/StatsProbe.js';
import { createGnomon } from '../render/debug/Placeholders.js';
import { initKtx2 } from '../assets/Loaders.js';
import { PlanetProxy } from '../world/PlanetProxy.js';
import type { ViewSource } from '../player/ViewSource.js';
import { need, type BootCtx, type Holder } from './BootStage.js';

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

export type RenderIn = Pick<BootCtx,
  'cfg' | 'host' | 'hud' | 'quality' | 'body' | 'oracle'>;
export type RenderOut = Pick<BootCtx,
  'canvas' | 'renderer' | 'scenes' | 'rig' | 'frame' | 'stats' | 'sky'
  | 'sunLights' | 'headlamp' | 'shadows' | 'ibl' | 'proxy'>;

export function phaseRender(s: RenderIn, observerRef: Holder<ViewSource>): RenderOut {
  const { cfg, host, hud, quality, body, oracle } = s;
  const canvas = document.createElement('canvas');
  canvas.id = 'of-canvas';
  host.insertBefore(canvas, host.firstChild);
  const renderer = createRenderer(canvas, cfg, quality);
  // RN-1462. Must run before any KTX2 texture load; see Loaders.ts for why
  // (`detectSupport` needs the GPU context to pick a transcode target).
  // Every other asset load in `boot()` is after this line, and the first is
  // two phases later (the avatar rig in `phaseObserver`), so this is not tight.
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
      const p = need(observerRef, 'the observer').position;
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
  return {
    canvas, renderer, scenes, rig, frame, stats, sky, sunLights, headlamp,
    shadows, ibl, proxy,
  };
}
