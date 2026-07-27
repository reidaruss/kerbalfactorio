// The terrain GLSL. Split out of TerrainMaterial.ts so that file stays a
// material factory and both stay inside the 400-line cap (2.2 rule 1).
//
// Three things happen here that are load-bearing for W3:
//
//  1. AERIAL PERSPECTIVE is computed IN THIS MATERIAL from the shared
//     Atmosphere.glsl model, not as a post pass. The scaled far scene runs the
//     SAME code with uMetresPerUnit = 1e5, so the horizon of the near scene and
//     the limb of the far scene are the same integral and cannot seam.
//  2. SHADOWS come from three's own shadow chunks. Cascade selection is by view
//     depth with constant sampler indices, because GLSL ES 3.00 forbids dynamic
//     indexing of a sampler array.
//  3. The STREAM-IN CROSS-FADE is an ordered 4x4 dither driven by a per-chunk
//     start time in an attribute plus one global uTime, so nothing per-chunk has
//     to be pushed per frame.

import type { DepthPolicy } from '../DepthPolicy.js';
import { BIOME_COUNT } from './BiomePalette.js';
import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';

export function terrainVertexShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.vertexPars}
    // BatchedMesh (DW-11): three declares the matrix textures and the multi-draw
    // index lookup here, and sets USE_BATCHING itself from object.isBatchedMesh.
    // A ShaderMaterial does its own vertex transform, so applying batchingMatrix
    // is OUR job; the stock <project_vertex> path is not in play.
    #include <batching_pars_vertex>
    #include <shadowmap_pars_vertex>
    attribute vec4 aBiome;
    attribute float aHeight;
    attribute float aFadeT0;
    uniform vec3 uBiomeColor[${BIOME_COUNT}];
    uniform float uTime;
    uniform float uFadeDur;
    varying vec3 vBiomeColor;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying float vRelief;
    varying float vFade;
    varying float vViewZ;

    void main() {
      #include <batching_vertex>
      // The per-chunk placement now lives in the batch's matrix texture rather
      // than in an object matrix, so the model matrix is the product of the two.
      // Both are translation plus uniform scale, so the upper 3x3 still
      // preserves direction after a normalize.
      mat4 ofModel = modelMatrix;
      mat3 ofNormalRot = mat3(modelMatrix);
      #ifdef USE_BATCHING
        ofModel = modelMatrix * batchingMatrix;
        ofNormalRot = mat3(ofModel);
      #endif
      // aBiome.x is the /core Biome enum as an unnormalized uint8.
      int bi = int(aBiome.x + 0.5);
      vBiomeColor = uBiomeColor[bi];
      vNormalW = normalize(ofNormalRot * normal);
      vec4 worldPosition = ofModel * vec4(position, 1.0);
      vWorld = worldPosition.xyz;
      vRelief = aHeight;
      // The SIGN of aFadeT0 selects the half of the dissolve: positive is the
      // incoming chunk fading in, negative is the outgoing one fading out. One
      // attribute, written once, carries both.
      //
      // The outgoing ramp is offset to [-2,-1] rather than negated into [-1,0]
      // because a negated zero is -0.0, and in GLSL -0.0 >= 0.0 is TRUE. That
      // put the outgoing chunk on the INCOMING branch for exactly the first
      // frame of every dissolve, both halves discarded everything, and the
      // bright far-scene terrain showed through the ground for one frame.
      // Measured as a 191-unit tile impulse on a driven walk.
      float fadeT = uFadeDur <= 0.0 ? 1.0
        : clamp((uTime - abs(aFadeT0)) / uFadeDur, 0.0, 1.0);
      vFade = aFadeT0 < 0.0 ? -1.0 - fadeT : fadeT;
      vec4 mv = viewMatrix * worldPosition;
      vViewZ = -mv.z;
      // Only <shadowmap_vertex>'s normal-bias offset reads this, and the bias is
      // in world units, so the batch rotation has to be in it or a chunk's
      // contact shadow detaches from its caster.
      vec3 transformedNormal = normalize(normalMatrix * normal);
      #include <shadowmap_vertex>
      gl_Position = projectionMatrix * mv;
      ${depth.vertexBody}
    }
  `;
}

/** Ordered 4x4 Bayer threshold, in [0,1). */
const BAYER = /* glsl */`
  float ofBayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    const float M[16] = float[16](
      0.0,  8.0,  2.0, 10.0,
     12.0,  4.0, 14.0,  6.0,
      3.0, 11.0,  1.0,  9.0,
     15.0,  7.0, 13.0,  5.0);
    return (M[y * 4 + x] + 0.5) * 0.0625;
  }
`;

const CASCADE = /* glsl */`
  float ofCascadeShadow(float vz) {
    #if defined(USE_SHADOWMAP) && !defined(OF_SCALED) && OF_CASCADES > 0
      float s = 1.0;
      if (vz < uCascadeFar.x) {
        s = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize,
          directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias,
          directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
      }
      #if OF_CASCADES > 1
      else if (vz < uCascadeFar.y) {
        s = getShadow(directionalShadowMap[1], directionalLightShadows[1].shadowMapSize,
          directionalLightShadows[1].shadowIntensity, directionalLightShadows[1].shadowBias,
          directionalLightShadows[1].shadowRadius, vDirectionalShadowCoord[1]);
      }
      #endif
      #if OF_CASCADES > 2
      else if (vz < uCascadeFar.z) {
        s = getShadow(directionalShadowMap[2], directionalLightShadows[2].shadowMapSize,
          directionalLightShadows[2].shadowIntensity, directionalLightShadows[2].shadowBias,
          directionalLightShadows[2].shadowRadius, vDirectionalShadowCoord[2]);
      }
      #endif
      // Fade the last cascade out rather than ending it, or the shadow set
      // terminates on a hard arc that the eye reads instantly while walking.
      float last = uCascadeFar[OF_CASCADES - 1];
      return mix(s, 1.0, smoothstep(last * 0.82, last, vz));
    #else
      return 1.0;
    #endif
  }
`;

export function terrainFragmentShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.fragmentPars}
    // NOTE: do NOT include <tonemapping_pars_fragment> or
    // <colorspace_pars_fragment> here. WebGLProgram already injects both into
    // every ShaderMaterial's fragment prefix whenever toneMapping and
    // outputColorSpace are set, and including them again is a hard compile
    // failure ("function already has a body"). Only the BODY chunks belong here.
    #include <shadowmap_pars_fragment>
    ${ATMOSPHERE_PARS}
    uniform vec3 uBodyCenter;
    uniform float uMaxRelief;
    uniform vec3 uAmbient;
    uniform float uFadeDur;
    uniform float uMetresPerUnit;
    uniform vec3 uCascadeFar;
    uniform float uSkyAmbient;
    varying vec3 vBiomeColor;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying float vRelief;
    varying float vFade;
    varying float vViewZ;
    ${BAYER}
    ${CASCADE}

    void main() {
      ${depth.fragmentBody}
      // Stream-in cross-fade. Dithered rather than blended: it stays opaque, it
      // needs no sorting, and the two halves use COMPLEMENTARY thresholds, so
      // every pixel is covered by exactly one of the outgoing and incoming
      // chunks and they never z-fight against each other mid-dissolve.
      if (vFade < 1.0) {
        float b = ofBayer4(gl_FragCoord.xy);
        if (vFade < 0.0) { if (-vFade - 1.0 >= b) discard; }
        else if (vFade < b) discard;
      }

      vec3 n = normalize(vNormalW);
      vec3 up = normalize(vWorld - uBodyCenter);
      float flat_ = clamp(dot(n, up), 0.0, 1.0);

      // Steep ground shows rock rather than the biome's surface cover. This is
      // the cheap stand-in for the triplanar slope blend arriving at W4.
      vec3 rock = vec3(0.30, 0.28, 0.26);
      vec3 albedo = mix(rock, vBiomeColor, smoothstep(0.55, 0.88, flat_));

      // /core's maxRelief is a nominal 6,000 m on Forge but baseHeight peaks
      // above it (6,520 m measured), so the snowline is expressed past 1.0
      // rather than clamped, and it never reaches pure white.
      float band = vRelief / max(1.0, uMaxRelief);
      float snow = smoothstep(0.86, 1.14, band) * smoothstep(0.45, 0.85, flat_) * 0.9;
      albedo = mix(albedo, vec3(0.88, 0.92, 0.98), snow);
      albedo *= 0.82 + 0.26 * smoothstep(0.0, 0.7, band);

      // Everything below is in PLANET-CENTRED METRES, which is the one frame the
      // shared atmosphere model speaks. uMetresPerUnit is 1 in the near scene
      // and 1e5 in the scaled far scene, and that is the ONLY difference.
      vec3 pM = (vWorld - uBodyCenter) * uMetresPerUnit;
      vec3 camM = (cameraPosition - uBodyCenter) * uMetresPerUnit;
      vec3 toCam = pM - camM;
      float dist = max(length(toCam), 1.0);
      vec3 rd = toCam / dist;

      vec3 sd = normalize(uSunDir);
      float ndl = max(dot(n, sd), 0.0);
      float shadow = ofCascadeShadow(vViewZ);
      // Transmittance along the SUN ray from this point: the terminator reddens
      // and then extinguishes the direct term for free, from the same integral
      // the sky uses.
      vec3 sunT = uAtmosOn > 0.5 ? ofAtmoSunTransmittance(pM, sd, 3) : vec3(1.0);

      vec3 skyTrans;
      vec3 skyAmb = ofAtmoScatter(pM, up, 1.0e9, 2, 2, skyTrans) * uSkyAmbient;

      // INDIRECT, and it is what a cut bank is lit BY. With only uAmbient and
      // skyAmb, a face that turns away from the sun receives those two and
      // nothing else, because this material lights itself from uSunDir and
      // never reads three's light list. Measured on the wall of a 6 m levelled
      // pit, sun 69 degrees up, cascades OFF so no shadow is in play: the wall
      // received 0.0446 against the flat floor's 1.0446, and photographed at
      // 20.9 against 154.8 in 8-bit luma IN THE SAME FRAME. Around that pit's
      // rim, where depth, range, albedo, relief band and facet steepness are all
      // equal by construction, luminance swung 155 counts on bearing alone. That
      // swing is dot(N, sunDir) and nothing else, and at the far end of it the
      // face reads as a hole in the world rather than as shaded ground.
      //
      // NEITHER TERM IS A TUNED CONSTANT.
      //   skyView is the share of the sky dome a face with this normal sees:
      //   1 lying flat, 1/2 stood on edge. A flat fragment therefore gets
      //   EXACTLY what it got before this existed, so daylight terrain is
      //   unchanged and only slopes move.
      //   ground is the radiance of the FLAT ground at this same point.
      //   vBiomeColor is precisely that ground's albedo here, and the bracket is
      //   precisely the irradiance the flat case computes below. So a bank is
      //   lit by the field it was cut out of, at no extra sampling, and every
      //   part of it falls to zero together at night, under a shadow, and in
      //   the terminator's transmittance.
      float skyView = 0.5 + 0.5 * dot(n, up);
      vec3 ground = vBiomeColor * (uAmbient + skyAmb
        + sunT * (1.45 * max(dot(up, sd), 0.0) * shadow));
      vec3 lit = albedo * (uAmbient + skyAmb * skyView + ground * (1.0 - skyView)
        + sunT * (1.45 * ndl * shadow));

      // Aerial perspective. Same function, same parameters as the sky quad, so a
      // mountain at 40 km goes blue and MATCHES the horizon behind it exactly.
      vec3 apTrans;
      vec3 apIn = ofAtmoScatter(camM, rd, dist, OF_AP_VIEW, OF_AP_LIGHT, apTrans);
      lit = lit * apTrans + apIn;

      gl_FragColor = vec4(lit, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}
