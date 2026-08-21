// Pass-1 atmosphere: one full-sky box carrying the analytic scattering model.
//
// The sky camera never translates, so the box is a skybox and the fragment's
// object-space position IS the view ray. That removes every inverse-matrix
// uniform a full-screen-quad reconstruction would need, and the ray is exact
// because rasterization interpolates a planar face perspective-correctly.
//
// Depth test and write are off: pass 1 paints every pixel and everything after
// composites over it by clear order (ARCHITECTURE.md section 3.1).

import * as THREE from 'three';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';
import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';
import { TERRAIN_AMBIENT, TERRAIN_SKY_AMBIENT, TERRAIN_SUN_IRRADIANCE }
  from './TerrainAmbient.js';
import type { QualityTier } from '../../app/Config.js';
import { createCloudUniforms, SKY_CLOUDS_GLSL, type CloudUniforms }
  from './SkyClouds.js';

/** View / light ray-march sample counts per tier. Cost is viewSteps*lightSteps. */
const STEPS: Record<QualityTier, [number, number]> = {
  low: [6, 2],
  med: [8, 3],
  high: [10, 3],
};

/**
 * Sun-transmittance march length. THREE, because TerrainShader passes 3 to the
 * same function on the same ray, and the ground radiance this file computes has
 * to be the number a terrain fragment would have computed at that point rather
 * than an approximation of it.
 */
const GROUND_SUN_STEPS = 3;

export interface SkyAtmosphere {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Camera position in PLANET-CENTRED metres. */
  setCameraPos(x: number, y: number, z: number): void;
  setEnabled(on: boolean): void;
  /**
   * Ground mode only: the albedo of the flat ground under the observer. This is
   * the biome's own palette entry, so it is `vBiomeColor` and not a tint.
   */
  setGroundAlbedo(c: THREE.Color): void;
  /**
   * Ground mode only: a multiplier on the whole ground radiance. It exists to
   * answer a WIRING question rather than a tuning one. A term that measures
   * near zero is equally consistent with "small here" and "not reaching the
   * consumer at all", and the only thing that separates those is whether a
   * changed input changes the output. Sweeping this is that experiment; the
   * shipped value is 1 and any other value is an instrument reading.
   */
  setGroundGain(k: number): void;
  /**
   * Raise the ground half for the duration of ONE synchronous capture. See
   * SkyIbl: it is set, `environmentFrom` renders all six cube faces inside the
   * same call stack, and it is cleared, so no presented frame can observe it.
   */
  setGroundMode(on: boolean): void;
  /** RN-2175. Seconds on the sim clock; drives the cloud drift and nothing else. */
  setTime(s: number): void;
  dispose(): void;
}

/**
 * RN-64 added a GROUND MODE to this one shader rather than a second shader: in
 * that mode a downward ray returns the radiance of the flat ground around the
 * observer instead of the sky model marched through the planet. It is a UNIFORM
 * and not a define, so there is one program either way and the DW-10 ledger
 * does not move. SkyIbl raises it around one synchronous capture.
 */
/**
 * RN-2445 (lane M5, THE NIGHT). `?nightsky=0` restores the pre-lane sky
 * exactly: the scattering integral alone, which is correctly near-zero once
 * the sun goes below the horizon (WORLD AUDIT R3 3.12's own reading: "uniform
 * black, no horizon gradient, no airglow, no moon in frame"). Standing rule
 * 7's control, named here rather than only in `ofNightSky` because this is
 * the one flag that reaches both this file's sky box and nothing else --
 * there is no terrain or aerosol consumer to keep in step with it.
 */
const NIGHT_SKY_ON =
  new URLSearchParams(self.location.search).get('nightsky') !== '0';

export function createSkyAtmosphere(
  atmos: AtmosphereUniforms, tier: QualityTier, seed = 0,
): SkyAtmosphere {
  const [viewSteps, lightSteps] = STEPS[tier];
  const uCamPosM = { value: new THREE.Vector3() };
  const uGroundOn = { value: 0 };
  const uGroundAlbedo = { value: new THREE.Color(0.5, 0.5, 0.5) };
  const uGroundGain = { value: 1 };
  const uNightSkyOn = { value: NIGHT_SKY_ON ? 1 : 0 };
  const clouds: CloudUniforms = createCloudUniforms(seed);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...atmos, ...clouds, uCamPosM, uGroundOn, uGroundAlbedo, uGroundGain,
      uNightSkyOn,
      // SHARED BY REFERENCE with both terrain materials, on the atmosphere
      // record's own precedent (DW-22). These two are the terrain's ambient
      // model, and the ground radiance below is a copy of TerrainShader's
      // `ground` expression: if the numbers were transcribed here instead, the
      // props' idea of the ground would drift from the ground's the first time
      // either was retuned, and the symptom would be a dawn where the boulders
      // disagree with the sand they sit on, which is the defect this exists to
      // remove.
      uGroundAmbient: { value: TERRAIN_AMBIENT },
      uSkyAmbientK: { value: TERRAIN_SKY_AMBIENT },
      uSunIrradiance: { value: TERRAIN_SUN_IRRADIANCE },
    },
    defines: { OF_VIEW_STEPS: viewSteps, OF_LIGHT_STEPS: lightSteps },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      ${ATMOSPHERE_PARS}
      ${SKY_CLOUDS_GLSL}
      uniform vec3  uCamPosM;
      uniform float uGroundOn;
      uniform vec3  uGroundAlbedo;
      uniform float uGroundGain;
      uniform vec3  uGroundAmbient;
      uniform float uSkyAmbientK;
      uniform float uSunIrradiance;
      uniform float uNightSkyOn;
      varying vec3 vDir;

      void main() {
        vec3 rd = normalize(vDir);
        vec3 up = normalize(uCamPosM);
        vec3 trans;

        // THE GROUND HALF OF THE ENVIRONMENT (RN-64).
        //
        // A downward ray does not escape: it lands on the ground a few metres
        // away, and what it carries back is that ground's radiance. The sky
        // model marches such a ray THROUGH the planet, which is nearly black,
        // so an environment captured from this scene gives every stock material
        // a lower hemisphere of nothing. TerrainShader does not have that hole,
        // because it adds ground * (1 - skyView) explicitly, and that is the
        // entire disagreement: at a high sun the direct term dominates and the
        // two models agree to a quarter of a count, while at dawn the direct
        // term collapses and the terrain keeps a bounce the props never had.
        //
        // Ground mode changes the DOWNWARD half only. An upward fragment takes
        // the same branch it has always taken, bit for bit, so the sky the
        // environment is built from is unchanged and only the hole is filled.
        if (uGroundOn > 0.5 && dot(rd, up) < 0.0) {
          // TERM FOR TERM TerrainShader's ground term, and deliberately not an
          // approximation of it:
          //   uGroundAlbedo is vBiomeColor, from the same palette the terrain
          //     material uploads, indexed by the same /core biomeAt classifier.
          //   the bracket is the irradiance a FLAT facet receives here, which is
          //     exactly the bracket the flat terrain case computes.
          // So a prop is lit from below by the field it is standing in, at the
          // biome it is standing in, and every part of it falls to zero together
          // at night and reddens together through the terminator.
          //
          // THE ONE TERM THAT IS NOT CARRIED OVER IS shadow. A cascade lookup
          // needs a position and this has none: it is one radiance for the whole
          // lower hemisphere. So this is the UNSHADOWED flat ground, which is
          // what the open field around a prop mostly is. The error is bounded
          // and it is in the direction of too much bounce inside a shadow, where
          // the direct term is already gone.
          vec3 sd = normalize(uSunDir);
          vec3 skyAmb = ofAtmoSkyAmb(uCamPosM, up,
                                     OF_VIEW_STEPS, OF_LIGHT_STEPS) * uSkyAmbientK;
          vec3 sunT = uAtmosOn > 0.5
            ? ofAtmoSunTransmittance(uCamPosM, sd, ${GROUND_SUN_STEPS})
            : vec3(1.0);
          gl_FragColor = vec4(uGroundAlbedo * uGroundGain
            * (uGroundAmbient + skyAmb + sunT * (uSunIrradiance * max(dot(up, sd), 0.0))), 1.0);
        } else {
          vec3 sky = ofAtmoScatter(uCamPosM, rd, 1.0e9,
                                   OF_VIEW_STEPS, OF_LIGHT_STEPS, trans);
          // RN-2175. THE BOUNDARY LAYER IN THE SKY, and this is its ONLY call
          // site: the terrain's own upward sky-ambient ray issues the same
          // ofAtmoScatter with the same 1.0e9 and cannot reach this line, so
          // the confinement is the call graph exactly as ofAtmoAerial's is.
          // The CPU probe in TerrainAmbient evaluates the same expression, which
          // is why the ambient agrees with the sky it is derived from.
          vec3 skySunT = uAtmosOn > 0.5
            ? ofAtmoSunTransmittance(uCamPosM, normalize(uSunDir), ${GROUND_SUN_STEPS})
            : vec3(1.0);
          // Clouds UNDER the aerosol, deliberately: a deck at 2.6 km is inside
          // the boundary layer's column for a shallow ray, so the haze must sit
          // in front of it and take a distant cell toward the horizon's colour
          // exactly as it takes a distant ridge.
          vec3 withCloud = uGroundOn > 0.5 ? sky
            : ofSkyClouds(sky, uCamPosM, rd, up, skySunT, uAeroRef.x);
          gl_FragColor = vec4(ofAtmoSkyAero(withCloud, uCamPosM, rd, skySunT), 1.0);

          // RN-2445 (lane M5, THE NIGHT). THE SCATTERING INTEGRAL ABOVE HAS NO
          // NIGHT TERM AT ALL: once the sun drops below the horizon almost
          // every light-ray sample above lands inside ofAtmoHit's own
          // occlusion test (p against uSunDir and uPlanetR) and contributes
          // zero, so the sky this branch painted was uniform black with no
          // horizon gradient and no airglow (WORLD AUDIT R3 3.12's own
          // reading, reproduced on this build before this change). This is a
          // SEPARATE, ADDITIVE term rather than a rewrite of the integral
          // above: it changes nothing about the daylight sky (nightK is
          // exactly zero whenever the sun is above the same -0.05/0.03
          // elevation band TerrainAmbient's starlight floor already uses, so
          // the sky and the ground floor cross the terminator on the same
          // hour and neither seams against the other), and it is gated by
          // uAtmosOn so an airless body's sky (already handled by RN-840's own
          // vacuum case) gets no spurious glow it has no air to carry.
          //
          // Dark BLUE-BLACK at the zenith, a little brighter and a little
          // warmer at the horizon (a modest airglow band, real moonless
          // nights read exactly this way): horizonW peaks where the view ray
          // is level with the local horizontal and falls off toward both the
          // zenith and the nadir, on the same "how far off the horizontal"
          // measure the aerial haze uses elsewhere in this file.
          float elevSun = dot(normalize(uSunDir), up);
          float nightK = uAtmosOn * uNightSkyOn
            * (1.0 - smoothstep(-0.05, 0.03, elevSun));
          if (nightK > 0.0) {
            vec3 zenithCol = vec3(0.0035, 0.0060, 0.0135);
            vec3 horizonCol = vec3(0.0180, 0.0260, 0.0300);
            float horizonW = 1.0 - clamp(abs(dot(rd, up)) / 0.5, 0.0, 1.0);
            gl_FragColor.rgb += mix(zenithCol, horizonCol, horizonW) * nightK;
          }
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });
  material.name = 'SkyAtmosphere';

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), material);
  mesh.name = 'skyAtmosphere';
  mesh.frustumCulled = false;
  // Before the stars, so the stars composite additively on top and are washed
  // out by a bright sky exactly as section 7.3 promises.
  mesh.renderOrder = -1;

  return {
    mesh,
    material,
    setCameraPos(x, y, z) { uCamPosM.value.set(x, y, z); },
    setEnabled(on) { mesh.visible = on; },
    setGroundAlbedo(c) { uGroundAlbedo.value.copy(c); },
    setGroundGain(k) { uGroundGain.value = k; },
    setGroundMode(on) { uGroundOn.value = on ? 1 : 0; },
    setTime(t) { clouds.uCloudTime.value = t; },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      clouds.uCloudTex.value?.dispose();
    },
  };
}
