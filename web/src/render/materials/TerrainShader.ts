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
import { TERRAIN_ART_PARS } from './TerrainArt.glsl.js';

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
    varying vec2 vChunkUv;

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
      // The chunk-LOCAL surface coordinate, normalized over the quad, uploaded
      // as uint16 by /core since W2 and read by this shader ZERO times until
      // RN-50 (WG-56 found it). It is the well-conditioned coordinate pM is
      // not: one uint16 step is 0.883 mm on a depth-14 chunk, which is a
      // quarter of a ground pixel at 2 m, against pM's quantum of nearly nine
      // pixels there. No new attribute, no upload, no CPU work.
      vChunkUv = uv;
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

/**
 * The cascade lookup, EXPORTED at RN-52 so the water surface shades itself from
 * the same three cascades the ground under it does. A second copy of this
 * selection would be a second authority on which cascade a range belongs to,
 * and the visible failure would be a pond whose glint stays lit inside a shadow
 * the shoreline is already in. It reads `uCascadeFar` and three's own shadow
 * uniforms, so any material using it needs `lights: true` and the shadowmap
 * chunks, exactly as this one does.
 */
export const CASCADE_GLSL = /* glsl */`
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
    ${TERRAIN_ART_PARS}
    uniform vec3 uArtAmp;      // x macro colour, y detail bump, z rock strata
    // RN-57. x water level (metres above datum), y shoreline radius m, z the
    // height in metres over which the wet band dries out, w amplitude.
    uniform vec4 uWetBand;
    uniform vec3 uWetDir;      // unit direction of the pond centre, body frame
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
    varying vec2 vChunkUv;
    ${BAYER}
    ${CASCADE_GLSL}

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

      // Everything below is in PLANET-CENTRED METRES, which is the one frame the
      // shared atmosphere model speaks. uMetresPerUnit is 1 in the near scene
      // and 1e5 in the scaled far scene, and that is the ONLY difference.
      //
      // Hoisted above the albedo block at RN-45: the surface-art field is keyed
      // on pM because pM is the only position here that survives a floating
      // origin rebase, so the albedo now needs it. See TerrainArt.glsl.
      vec3 pM = (vWorld - uBodyCenter) * uMetresPerUnit;
      vec3 camM = (cameraPosition - uBodyCenter) * uMetresPerUnit;
      vec3 toCam = pM - camM;
      float dist = max(length(toCam), 1.0);
      vec3 rd = toCam / dist;

      vec3 n = normalize(vNormalW);
      vec3 up = normalize(vWorld - uBodyCenter);
      // The GEOMETRIC normal, deliberately. flat_ selects rock against surface
      // cover and gates the snow band, and both are questions about the actual
      // slope of the ground. Feeding them the bumped normal below would let a
      // 4 m ripple decide whether a hillside is rock, which is a feedback loop
      // and reads as noise in the biome blend rather than as relief.
      float flat_ = clamp(dot(n, up), 0.0, 1.0);

      // SURFACE ART (RN-45). Compiled out of the scaled far scene entirely, and
      // faded to nothing well inside the near scene's own reach; both reasons
      // are in TerrainArt.glsl's header and they are not the same reason.
      float macroW = 0.0, bumpW = 0.0, strataW = 0.0;
      float hArt = 0.0;
      #ifndef OF_SCALED
        // 600 m to 4 km: complete by 4 km against a ~15 km handover to the far
        // scene, so the same ridge cannot be modulated on one side of the
        // handover and flat on the other.
        macroW = uArtAmp.x * (1.0 - smoothstep(600.0, 4000.0, dist));
        // NO DISTANCE FADE ON THE BUMP. It is faded on the PIXEL FOOTPRINT
        // inside ofArtBump instead, because range is not what aliases a bump
        // and a distance fade let a field of moire arcs through at five metres.
        // See TerrainArt.glsl's note on that function.
        bumpW = uArtAmp.y;
        // 500 m to 2.5 km. A 2.35 m bed subtends about 3 px at 1 km on this
        // viewport and field of view, which is where a band starts to alias.
        strataW = uArtAmp.z * (1.0 - smoothstep(500.0, 2500.0, dist));
        if (macroW > 0.0) hArt = ofArtMacro(pM);
      #endif

      // Steep ground shows rock rather than the biome's surface cover. This is
      // the cheap stand-in for the triplanar slope blend arriving at W4.
      //
      // The rock term was a flat vec3 and it is what every cliff, ravine
      // wall and crater rim on the planet is drawn with, so it is where the
      // bedding goes. vRelief is metres above the datum, which is exactly the
      // altitude a bed is a function of.
      vec3 rock = ofArtStrata(vec3(0.30, 0.28, 0.26), vRelief, pM, strataW);
      vec3 albedo = mix(rock, vBiomeColor, smoothstep(0.55, 0.88, flat_));

      // MACRO VARIATION. Two effects off one field, because they answer two
      // different halves of "flat colour": the tint moves the ground between a
      // lush and a dry reading, which is what varies between hillsides, and the
      // value moves it light to dark, which is what varies within one. Applied
      // AFTER the rock blend so a cliff face is varied too, and BEFORE snow so
      // a snowfield stays clean.
      // THE TWO TINTS ARE RECIPROCAL ABOUT 1.0 PER CHANNEL, and that is a
      // correction rather than a preference. The first pair shipped as
      // (0.86, 1.00, 0.90) and (1.12, 1.03, 0.84), whose per-channel MEAN is
      // (0.99, 1.015, 0.87). A mean blue of 0.87 is a 13% net blue reduction
      // applied to the whole planet, i.e. a colour grade wearing a variation
      // layer's clothes, and the probe caught it as a 5.03% drop in the mid
      // band's LEVEL while its spread rose. A variation term must move the
      // spread and leave the level alone; these two now average (1.00, 1.01,
      // 1.00) and it reads as -1.1%, which is the macro field's own asymmetry.
      if (macroW > 0.0) {
        vec3 tint = mix(vec3(0.90, 1.00, 1.10), vec3(1.10, 1.02, 0.90),
                        hArt * 0.5 + 0.5);
        albedo *= mix(vec3(1.0), tint, macroW);
        albedo *= 1.0 + macroW * 0.40 * hArt;
      }

      // /core's maxRelief is a nominal 6,000 m on Forge but baseHeight peaks
      // above it (6,520 m measured), so the snowline is expressed past 1.0
      // rather than clamped, and it never reaches pure white.
      float band = vRelief / max(1.0, uMaxRelief);
      float snow = smoothstep(0.86, 1.14, band) * smoothstep(0.45, 0.85, flat_) * 0.9;
      albedo = mix(albedo, vec3(0.88, 0.92, 0.98), snow);
      albedo *= 0.82 + 0.26 * smoothstep(0.0, 0.7, band);

      // WET GROUND (RN-57), after snow and the relief ramp because it is a film
      // ON the finished ground rather than another kind of ground. Compiled out
      // of the scaled scene, where the whole 22 m pond is under one pixel; that
      // is RN-45's confinement by the call graph, and it is free.
      #ifndef OF_SCALED
        albedo = ofArtWet(albedo, pM, vRelief, uWetDir, uWetBand);
      #endif

      // The bump perturbs the LIGHTING normal only, and it does so after every
      // decision that depends on the true slope has already been taken. vWorld
      // and not pM: a derivative of a float32 at 6e5 metres is four bits of
      // signal, and the two frames differ by a translation whose derivative is
      // the identity, so engine space is both cleaner and equivalent.
      //
      // THE BUMP'S HEIGHT FIELD IS KEYED ON THE CHUNK UV, NOT ON pM (RN-50).
      // RN-45 measured that a screen-derivative bump keyed on planet-centred
      // metres cannot work here: the float32 quantum is 3 to 15 times the
      // pixel footprint under the player, so dFdx is exactly zero across runs
      // of pixels and steps at the quantisation boundaries, which are surfaces
      // of constant range and therefore draw arcs centred on the eye. World-gen
      // reproduced that headlessly at 32.49% of quads with a dead derivative.
      // The chunk UV has no such quantum because it is LOCAL, so the derivative
      // is clean by construction rather than by tuning.
      //
      // THE HONEST COST, and it is why this is not the general fix: the UV
      // normalises over the QUAD, so the detail's world size doubles at every
      // LOD step. That is tolerable for THIS term only because the term is only
      // well conditioned within about 20 to 45 m of the eye, and inside that
      // band the streamer is at max depth, so the step falls outside the band.
      // Any future field that needs a derivative at range still wants world-gen's
      // per-chunk phase; this does not replace it.
      // EVERY OCTAVE FEEDING THE DERIVATIVE IS ON THE UV. NOT ONE IS ON pM, and
      // that is the whole correctness argument rather than a detail.
      //
      // The obvious version of this change keeps the macro field in the bump's
      // height and merely adds a UV octave to it. World-gen measured that exact
      // shape headlessly and it is a TRAP: a finest-octave-only fix scores
      // 0.00% dead quads, identical to a correct one, because the live octave
      // keeps the sum off zero everywhere, and it is still visibly wrong with
      // the arcs and the lattice intact and its field 1,224x further from the
      // truth. A quantised octave anywhere in the sum poisons the derivative of
      // the whole sum. So hArt feeds the COLOUR and never the bump.
      #ifndef OF_SCALED
        if (bumpW > 0.0) {
          // Two octaves, both local. 14.0 and 5.3 rather than powers of two: a
          // lattice that lined up with the 32-cell quad grid would put every
          // noise cell boundary on a vertex and draw the grid. At a depth-14
          // chunk of 57.856 m these are 4.1 m and 10.9 m, which is the scale
          // RN-45 wanted and could not reach from planet-centred metres.
          float hB = (ofArtVnoise(vec3(vChunkUv * 14.0, 0.5)) - 0.5) * 0.9
                   + (ofArtVnoise(vec3(vChunkUv * 5.3, 7.1)) - 0.5) * 0.5;
          n = ofArtBump(n, vWorld, hB, bumpW * 1.6, OF_ART_FINE_M);
        }
      #endif

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

      // BOUNDARY-LAYER AEROSOL, and this is the ONLY call site of it in the
      // project. It is what gives the ground aerial perspective over the 200 m
      // to 3 km a player looks across, where Rayleigh moves a ridge by about 1%.
      // Reaching it requires a finite distance to geometry, and that IS the
      // confinement: the sky quad and the skyAmb ray twenty lines above both
      // pass 1.0e9 into a different function, so neither can pick this up. See
      // Atmosphere.glsl's note for the sky control that the first attempt failed.
      lit = ofAtmoAerial(lit, camM, rd, dist, sunT);

      gl_FragColor = vec4(lit, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}
