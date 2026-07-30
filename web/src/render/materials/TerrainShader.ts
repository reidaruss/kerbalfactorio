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

import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';
import { TERRAIN_ART_PARS } from './TerrainArt.glsl.js';
import { TERRAIN_SUN_IRRADIANCE } from './TerrainAmbient.js';
import { CASCADE_GLSL } from './CascadeShadow.glsl.js';
import { BAYER } from './TerrainDither.glsl.js';

/**
 * The direct-sun irradiance literal, INLINED into the GLSL rather than passed as
 * a uniform. It emits the same characters it always did, so the compiled program
 * is unchanged; what it buys is that SkyAtmosphere's ground shell reads the same
 * exported constant instead of a transcribed 1.45. See TerrainAmbient.ts.
 */
const SUN_IRR = TERRAIN_SUN_IRRADIANCE.toFixed(2);

// The VERTEX shader and BAYER moved to TerrainVertex.glsl.ts and
// TerrainDither.glsl.ts at RN-148 (line-cap room; GLSL unchanged to the
// character), on RN-78's CASCADE_GLSL precedent. Both re-exported or imported
// here so every published import site holds.
export { terrainVertexShader } from './TerrainVertex.glsl.js';

// Moved to CascadeShadow.glsl.ts at RN-78 (line-cap room; GLSL unchanged to
// the character). Re-exported so RN-52's published import site still holds.
export { CASCADE_GLSL } from './CascadeShadow.glsl.js';

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
    uniform sampler2D uGroundTex;   // RN-77's four packed detail fields
    uniform float uGroundTexAmp;
    uniform sampler2D uGroundRelief; // RN-147's four asymmetric height fields
    uniform float uGroundReliefAmp;
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
    varying vec4 vMatW;
    varying vec4 vRelW;
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
      float coverSel = smoothstep(0.55, 0.88, flat_);
      vec3 albedo = mix(rock, vBiomeColor, coverSel);

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

      // GROUND TEXTURE (RN-78): RN-77's tiling fields on the chunk UV at
      // integer repeats per quad, mixed by the per-biome weights (the whole
      // correctness argument: TerrainArt.glsl's ofArtTexMix note). BEFORE the
      // snow lerp so a snowfield stays clean. Three load-bearing choices,
      // each measured (rendering.md RN-78): (1) the samples are UNCONDITIONAL,
      // because inside a non-uniform branch a fetch has UNDEFINED LOD, which
      // photographed as mip-0 speckle at 40 m plus deep-mip mush at 3 m and
      // was immune to every anisotropy setting; (2) ALBEDO ONLY, because fed
      // to the bump these smooth fields read as choppy water at any
      // coefficient (a smooth metre-scale undulation IS liquid's signature;
      // the bump stays RN-50's vnoise exactly); (3) the near boost inside
      // ~20 m, because the feet are where a texture pass is judged and dark
      // biomes photographed nearly flat without it.
      #ifndef OF_SCALED
        float texW = uGroundTexAmp * (1.0 - smoothstep(35.0, 75.0, dist))
                   * (1.0 + 0.6 * (1.0 - smoothstep(10.0, 22.0, dist)));
        vec4 g1 = texture2D(uGroundTex, vChunkUv * 16.0);
        vec4 g2 = texture2D(uGroundTex, vChunkUv * 5.0);
        albedo *= 1.0 + texW * ofArtTexMix(g1, g2, vMatW, coverSel);
        // RN-148: the relief sample. UNCONDITIONAL like g1/g2 and for the same
        // measured reason (a fetch inside non-uniform control flow has
        // UNDEFINED LOD; RN-78 paid a full hunt for it). One scale, the 16
        // repeats: relief features are authored INSIDE the 3.6 m tile, and a
        // second coarser lookup would re-import the smooth metre-scale
        // undulation this texture exists to avoid.
        vec4 rel = texture2D(uGroundRelief, vChunkUv * 16.0);
      #endif

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
        // RN-148: the ASYMMETRIC relief drives the SAME surface-gradient bump
        // as a second, separable call, so ?groundrelief=0 and ?terrainbump=0
        // isolate their terms independently. The branch condition is a bare
        // uniform, i.e. UNIFORM control flow: the derivatives inside ofArtBump
        // are defined, exactly as they are inside the bumpW branch above (the
        // sample itself is unconditional, taken beside g1/g2). The named
        // failure mode of this term is RN-78's choppy water; it is excluded by
        // the ASSET (groundtex.py asserts per-channel asymmetry with symmetric
        // negative controls), not by shader tuning, and the fade story is the
        // texture's own mip chain: a minified sample converges to the
        // 0.5-centred mean, whose derivative is zero, so the term retires
        // itself at range before ofArtBump's footprint fade acts.
        if (uGroundReliefAmp > 0.0) {
          float hR = ofArtRelMix(rel, vRelW, coverSel);
          // OF_RELIEF_FINE_M, not OF_ART_FINE_M: the fade must protect THIS
          // field's finest wavelength. The mip chain bounds the sampled value
          // but never its gradient (RN-78d), measured again here as moire
          // arcs when this call briefly rode the vnoise's 4.2 m constant.
          //
          // The DISTANCE fade is texW's argument, not a bump-aliasing guard:
          // the chunk UV's world size doubles at every LOD step, so a coarser
          // ring draws these ripples at double wavelength, and at grazing sun
          // that photographed as a differently-textured chunk-shaped patch.
          // 30 to 60 m completes inside the max-depth ring, where the UV
          // scale is constant, so no LOD step is ever visible in the term.
          float relW = uGroundReliefAmp * (1.0 - smoothstep(30.0, 60.0, dist));
          n = ofArtBump(n, vWorld, hR, relW, OF_RELIEF_FINE_M);
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
        + sunT * (${SUN_IRR} * max(dot(up, sd), 0.0) * shadow));
      vec3 lit = albedo * (uAmbient + skyAmb * skyView + ground * (1.0 - skyView)
        + sunT * (${SUN_IRR} * ndl * shadow));

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
