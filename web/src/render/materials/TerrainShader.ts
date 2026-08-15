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
    // RN-741. 1 takes the relief's slope over a fixed tile-space support, 0 is
    // the pre-RN-741 screen derivative that printed the etched squiggles.
    uniform float uReliefGrad;
    // RN-843. The SUPPORT the relief slope is differenced over, in tile units.
    // A UNIFORM and no longer the OF_RELIEF_GRAD_UV define, because the shipped
    // value turned out to be the defect and a define cannot be swept inside one
    // page, one camera and one streamed chunk set. ?reliefgraduv= moves it; the
    // boot default is RELIEF_GRAD_UV.
    uniform float uReliefGradUv;
    // RN-961. The ripple direction's swing in RADIANS, peak to peak, across
    // cells. 0 collapses every cell's rotation to the identity, which restores
    // the pre-RN-961 sample coordinate exactly, so ?reliefswing=0 is the
    // negative control for the whole term on one build.
    uniform float uReliefSwing;
    // RN-1005. The direction field's two SCALES, promoted out of
    // OF_REL_CELL / OF_REL_CELL_NOISE for RN-843's reason. uReliefCell is the
    // cell edge in tile units (1 tile = 3.6 m), i.e. how far you walk before
    // the ripple can point somewhere else. uReliefCellNoise is the frequency
    // of the angle noise ON the cell lattice, so 1/uReliefCellNoise is the
    // number of cells over which the direction is CORRELATED: the two
    // together, and not the swing alone, decide how many directions are on
    // screen at once. ?reliefcell= and ?reliefcellnoise= sweep them.
    uniform float uReliefCell;
    uniform float uReliefCellNoise;
    // RN-842. The fraction of a hemisphere the body's own terrain occludes.
    // 0 is the pre-RN-842 flat-tangent-plane model, exactly. See
    // HorizonOcclusion.ts for what it is and why it is measured, not chosen.
    uniform float uHorizonOcc;
    // RN-841. 1 takes the bounce source from the UNSHADOWED flat ground (the
    // expression SkyAtmosphere's ground shell already uses), 0 restores the
    // pre-RN-841 form where a fragment's own shadow extinguished the light
    // bouncing off the sunlit ground beside it. ?bouncelit=0 is the control.
    uniform float uBounceLit;
    // RN-57. x water level (metres above datum), y shoreline radius m, z the
    // height in metres over which the wet band dries out, w amplitude.
    uniform vec4 uWetBand;
    uniform vec3 uWetDir;      // unit direction of the pond centre, body frame
    uniform vec3 uBodyCenter;
    uniform float uMaxRelief;
    uniform vec3 uAmbient;
    // RN-731. Amplitude of the specular lobe, on uGroundTexAmp's pattern
    // exactly: ?terrainspec=0 removes the term with no branch left behind
    // and ?terrainspecamp= sweeps it, so the control is one flag on one
    // build rather than two commits apart.
    // x is the SUN lobe (the GGX highlight), y is the SKY lobe (the grazing
    // reflection). Two components rather than one because they fail
    // differently and therefore have to be isolable separately: the sun half
    // is a local highlight and the sky half is the one that can turn into a
    // broad ambient lift over the whole middle distance, which is named
    // failure mode 1. A single amplitude would only ever have been able to
    // answer "is the specular on", never "which half is doing this".
    uniform vec2 uSpecAmp;
    // RN-1733. The near-field detail layer. x is the BUMP amplitude and y the
    // ALBEDO amplitude, two components rather than one for uSpecAmp's reason
    // exactly: they fail differently (a bump that is too strong reads as
    // gravel, an albedo that is too strong reads as noise) so they have to be
    // isolable separately, and a single amplitude could only ever answer "is
    // the layer on". ?groundfine=0 removes both.
    uniform vec2 uFineAmp;
    // RN-1733. The layer's three repeats per quad (x clod, y crease ridge,
    // z grit) and its three height weights. Uniforms rather than defines for
    // RN-843's measured reason: which frequency band the near ground is
    // missing is settled by looking at matched frames one uniform apart, and a
    // define can only be swept one BUILD per rung, which is not a pair.
    // Only INTEGER frequencies keep the chunk-edge seam closed; see
    // ofArtVnoise2P.
    uniform vec3 uFineFreq;
    uniform vec3 uFineW;
    // RN-1735. 1 applies the per-biome luminance weight (ofArtFineLum), 0 is
    // the flat amplitude this layer shipped with for one afternoon and which
    // measured +134% of near-ground iqr at Beach against 0% at Plains. A hard
    // 0 or 1 and not an amplitude, on uReliefGrad's precedent: what 0 restores
    // is a defect, and an intermediate value would be neither state.
    uniform float uFineLum;
    uniform float uFadeDur;
    uniform float uMetresPerUnit;
    uniform vec3 uCascadeFar;
    uniform float uSkyAmbient;
    varying vec3 vBiomeColor;
    varying vec4 vMatW;
    varying vec4 vRelW;
    // RN-1257. The per-biome MATERIAL record, packed into two vec4 so the
    // whole of it costs two varyings: vGrain is (scaleFine, scaleMid,
    // scaleCoarse, roughBase) and vTint is (tintR, tintG, tintB, roughVar).
    // Interpolated across biome edges exactly as vMatW and vRelW are, which is
    // what makes a biome boundary a material gradient rather than a line.
    varying vec4 vGrain;
    varying vec4 vTint;
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
      // RN-1733. THE NEAR-FIELD DETAIL LAYER's field, evaluated ONCE here and
      // consumed twice: by the albedo a few lines down and by a third
      // ofArtBump call in the bump block below.
      //
      // WHY IT IS HOISTED TO UNIFORM CONTROL FLOW AND NOT GATED ON DISTANCE,
      // which is the obvious thing and is wrong here. The term only does
      // anything within about 12 m, so a distance branch looks free; but the
      // consumer takes SCREEN DERIVATIVES of this height, and a derivative
      // inside non-uniform control flow is undefined by the same rule that
      // makes a texture fetch there undefined-LOD (RN-78 paid a full hunt for
      // the sampled half of that lesson). The branch condition is therefore a
      // BARE UNIFORM, exactly as bumpW and uGroundReliefAmp already are, and
      // the DISTANCE confinement is carried by the footprint fade instead,
      // which is a multiply rather than a jump.
      //
      // footM is the pixel's world footprint, and it is the same quantity
      // ofArtBump computes for itself. It is recomputed rather than plumbed
      // through because the alternative is widening a published signature that
      // three call sites use, to save two derivative instructions.
      vec3 fine3 = vec3(0.0);
      float fineHc = 0.0;      // the clod octave and the crease ridge
      float fineHg = 0.0;      // the grit octave
      float fineA = 0.0;
      float fineFade = 0.0;
      float fineMc = 1.0;
      float fineM = 1.0;
      // The per-biome weight FOLDS INTO THE FADE rather than being applied
      // separately at each of the three consumers. One multiply, one place, and
      // no way for the albedo half and the two bump calls to end up weighted
      // differently, which is the ofArtWetness rule applied to a scalar.
      float fineLum = 1.0;
      #ifndef OF_SCALED
        // DERIVED HERE, from the live frequency, and not a define. The fade's
        // whole job is to retire the term before its FINEST octave folds, so a
        // fade keyed on a stale copy of that frequency is a negative control
        // made of a constant copied from the thing it watches (standing rule
        // 11), and this file carries two shipped instances of exactly that
        // (OF_ART_FINE_M and OF_RELIEF_FINE_M, both derived against a depth-14
        // quad and neither moved when WG-186 halved it). A swept frequency with
        // a frozen fade would be a third.
        fineM = OF_FINE_CHUNK_M / max(uFineFreq.z, 1.0);
        // The COARSE half is protected by the RIDGE's wavelength, not the clod
        // octave's, so the pair retires early rather than late; see
        // ofArtFineHc. Both are derived from the live uniform for the reason
        // above.
        fineMc = OF_FINE_CHUNK_M / max(uFineFreq.y, 1.0);
        if (uFineAmp.x > 0.0 || uFineAmp.y > 0.0) {
          fineLum = mix(1.0, ofArtFineLum(vBiomeColor), uFineLum);
          float footM = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
          // The SAME curve ofArtBump fades on, keyed on the SAME wavelength, so
          // the albedo half and the normal half retire together and a reader
          // never has to hold two bands in their head. Nyquist: a feature is
          // representable while the sample spacing is under half its
          // wavelength, and this is fully out by a third of it.
          // The ALBEDO half fades on the COARSE wavelength, because its own
          // content is the two centred octaves and the coarser of those is what
          // it has to protect; the grit's contribution to it is subordinate and
          // the mip-free field it rides has no other guard.
          fineFade = 1.0 - smoothstep(fineMc * 0.125, fineMc * 0.333, footM);
          // THE CULL THRESHOLD IS 0.5 AND THE FADE IS DONE AT 0.333, AND THE
          // GAP BETWEEN THEM IS THE WHOLE POINT. Culling exactly where the fade
          // reaches zero would put the jump from a live height to a hard 0
          // inside the same 2x2 quad as pixels whose amplitude is still being
          // read, and dFdx is a quad difference, so the ring at that radius
          // would get a derivative of a step function. Past 0.5 both the height
          // and the amplitude are identically zero, so the garbage derivative
          // is multiplied by nothing. It costs one band of ground evaluating a
          // field it will not use, which is cheaper than the ring.
          if (footM < fineMc * 0.5) {
            fine3 = ofArtFine3(vChunkUv, uFineFreq);
            fineHc = ofArtFineHc(fine3, uFineW);
            fineHg = ofArtFineHg(fine3, uFineW);
            fineA = ofArtFineA(fine3, uFineW);
          }
        }
      #endif

      #ifndef OF_SCALED
        float texW = uGroundTexAmp * (1.0 - smoothstep(35.0, 75.0, dist))
                   * (1.0 + 0.6 * (1.0 - smoothstep(10.0, 22.0, dist)));
        // RN-1257. A THIRD, FINE TAP, and the per-biome partition across the
        // three. UNCONDITIONAL like the other two and for RN-78's measured
        // reason (a fetch in non-uniform control flow has UNDEFINED LOD): the
        // scale weights select by BLENDING, never by branching, which is also
        // what lets them interpolate across a biome edge the way vMatW does.
        // The repeat is an integer, so the chunk-edge phase argument holds
        // for it exactly as it does for 16 and 5.
        vec4 gF = texture2D(uGroundTex, vChunkUv * OF_TEX_FINE);
        vec4 g1 = texture2D(uGroundTex, vChunkUv * 16.0);
        vec4 g2 = texture2D(uGroundTex, vChunkUv * 5.0);
        vec4 gB = ofArtTexBlend(gF, g1, g2, vGrain.xyz);
        // Kept as its own named scalar because the roughness below reads the
        // SAME number. Deriving "how grainy is this fragment" twice is the
        // shape of bug where a pebble darkens in the albedo and polishes in
        // the specular half a metre away (RN-731's ofArtWetness argument,
        // applied to the term that came after it).
        float grain = ofArtTexMix(gB, vMatW, coverSel);
        // TINTED, not scalar. vTint.xyz is mean-preserving by construction
        // because the grain scalar is centred on zero, so this moves the SPREAD of each
        // channel and leaves every channel's level alone. That distinction is
        // the macro tint's own scar, forty lines up.
        albedo *= vec3(1.0) + texW * grain * vTint.xyz;
        // RN-1733. THE DETAIL LAYER'S ALBEDO HALF, on the SAME tint axis the
        // grain above rides and for RN-1257's reason: a value-only modulation
        // has one degree of freedom and cannot make the ground warmer where it
        // is dry and cooler where it is damp, which is most of what reads as
        // soil rather than as a brown surface. Mean-preserving by the same
        // construction (the field is centred, so a fixed tint vector moves each
        // channel's SPREAD and leaves its LEVEL alone).
        //
        // IT RIDES THE SAME HEIGHT THE BUMP DOES, deliberately, and that is the
        // one correlation in this material that is physically right rather than
        // merely cheap: a crest sheds and dries and a hollow holds dark damp
        // litter, so height and value genuinely covary on ground. It also means
        // the two halves cannot drift, which is the reason ofArtWetness exists.
        //
        // NOT gated on coverSel. A cliff face wants sub-decimetre break-up at
        // arm's length exactly as much as a forest floor does, and coverSel
        // is the cover/rock selector, not a near/far one.
        albedo *= vec3(1.0) + uFineAmp.y * fineLum * fineFade * fineA * vTint.xyz;
        // RN-148: the relief sample. UNCONDITIONAL like g1/g2 and for the same
        // measured reason (a fetch inside non-uniform control flow has
        // UNDEFINED LOD; RN-78 paid a full hunt for it). One scale, the 16
        // repeats: relief features are authored INSIDE the 3.6 m tile, and a
        // second coarser lookup would re-import the smooth metre-scale
        // undulation this texture exists to avoid.
        // RN-961. THE RIPPLE'S DIRECTION IS A PROPERTY OF THE PLACE, and the
        // rotation that supplies it is RIGID rather than merely small. See
        // ofRelCell in TerrainArt.glsl for why theta must be constant inside a
        // cell and continuous between cells, and why that is not a
        // contradiction. Two offset grids, blended by centrality, because a
        // rigid per-cell rotation buys wavelength preservation with a seam and
        // the second grid is what pays the seam back.
        vec2 relP = vChunkUv * 16.0;
        vec3 cellA = ofRelCell(relP, uReliefCell, uReliefCellNoise, uReliefSwing, vec2(0.0));
        vec3 cellB = ofRelCell(relP, uReliefCell, uReliefCellNoise, uReliefSwing, vec2(0.5));
        float relWsum = max(cellA.z + cellB.z, 1e-4);
        float relWa = cellA.z / relWsum;
        float relWb = cellB.z / relWsum;
        vec4 relA = texture2D(uGroundRelief, cellA.xy);
        vec4 relB = texture2D(uGroundRelief, cellB.xy);
        vec4 rel = relWa * relA + relWb * relB;
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
      //
      // RN-731 takes the SCALAR out separately rather than calling ofArtWet,
      // because the specular below needs the same number and deriving it twice
      // is how a pond edge ends up darkening in one term and glinting in
      // another half a metre away. The tint constant still has one home.
      float wetF = 0.0;
      #ifndef OF_SCALED
        wetF = ofArtWetness(pM, vRelief, uWetDir, uWetBand);
        albedo = ofArtWetTint(albedo, wetF);
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
          // RN-741. THE GRADIENT IS BAND-LIMITED AND THE FIELD IS NOT TOUCHED.
          // See ofArtRelGrad's note in TerrainArt.glsl for the mechanism: a
          // screen derivative of an authored SHARP CREST is a discontinuity,
          // and it printed as etched squiggles on every close frame. The two
          // extra fetches are of a texture already bound and already sampled at
          // this exact coordinate, and they sit inside this branch, whose
          // condition is a bare uniform and therefore uniform control flow.
          //
          // ROUGH FIELD BY EXPLICIT OFFSET, SMOOTH MAPPING BY dFdx. ruv is
          // linear across a triangle, so its screen derivatives are exact and
          // are the right tool; the height is not, and is differenced over a
          // fixed tile-space support instead.
          // RN-961. THE DIFFERENCE IS TAKEN INSIDE EACH GRID'S OWN ROTATED
          // FRAME AND THE TWO GRADIENTS ARE BLENDED WITH THE SAME WEIGHTS THE
          // VALUE USED. Differencing the blended height directly would be
          // wrong in a way that is easy to miss: the blend weights vary across
          // the surface, so a difference of the blend contains a term in
          // grad(w) that belongs to the BLEND and not to the ground, and it
          // would light a ridge along every cell boundary. Blending the two
          // gradients instead keeps every difference inside a frame where the
          // sample coordinate is a rigid function of position.
          //
          // dFdx is taken on the UNROTATED relP, deliberately. It is the
          // screen mapping of the chunk UV and is still exactly linear across
          // a triangle; a rigid rotation does not change the length of
          // anything, so no per-grid correction is owed. RN-955's approximation
          // caveat does not apply here, because nothing curves.
          float gx, gy;
          if (uReliefGrad > 0.5) {
            float e = uReliefGradUv;
            float hAu = ofArtRelMix(texture2D(uGroundRelief, cellA.xy + vec2(e, 0.0)),
                                    vRelW, coverSel);
            float hAv = ofArtRelMix(texture2D(uGroundRelief, cellA.xy + vec2(0.0, e)),
                                    vRelW, coverSel);
            float hBu = ofArtRelMix(texture2D(uGroundRelief, cellB.xy + vec2(e, 0.0)),
                                    vRelW, coverSel);
            float hBv = ofArtRelMix(texture2D(uGroundRelief, cellB.xy + vec2(0.0, e)),
                                    vRelW, coverSel);
            // relA and relB, NOT two more fetches at the same coordinates.
            // The centre samples are already in hand from the value above,
            // and re-reading them cost two of eight taps for nothing.
            float hA = ofArtRelMix(relA, vRelW, coverSel);
            float hB = ofArtRelMix(relB, vRelW, coverSel);
            float dhdu = (relWa * (hAu - hA) + relWb * (hBu - hB)) / e;
            float dhdv = (relWa * (hAv - hA) + relWb * (hBv - hB)) / e;
            vec2 dx = dFdx(relP);
            vec2 dy = dFdy(relP);
            gx = dhdu * dx.x + dhdv * dx.y;
            gy = dhdu * dy.x + dhdv * dy.y;
          } else {
            // ?reliefgrad=0, the exact pre-RN-741 path, so the pair is ONE FLAG
            // apart on ONE build under ONE light rather than two commits apart.
            gx = dFdx(hR);
            gy = dFdy(hR);
          }
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
          n = ofArtBumpG(n, vWorld, gx, gy, relW, OF_RELIEF_FINE_M);
        }
        // RN-1733. THE DETAIL LAYER'S NORMAL HALF, and it is a THIRD separable
        // ofArtBump call rather than another octave added to hB, for the reason
        // TerrainShader already gives forty lines up in the other direction:
        // separable calls are what let ?groundfine=0, ?terrainbump=0 and
        // ?groundrelief=0 each isolate their own term. Folding this into hB
        // would also give the 2.07 m octave this field's much finer fade and
        // retire it at 12 m, which is a change to a shipped term wearing a new
        // term's clothes.
        //
        // The condition is a bare uniform, so the control flow is uniform and
        // the derivatives inside ofArtBump are defined; the field itself was
        // evaluated above under the same condition.
        //
        // ORDER: AFTER both existing bumps, so this perturbs the normal they
        // have already turned. That is correct for a detail layer and it is not
        // arbitrary: surface-gradient perturbation is not commutative, and the
        // physically meaningful reading is fine relief sitting ON the coarse
        // shape rather than the coarse shape sitting on the grit.
        if (uFineAmp.x > 0.0) {
          float fw = uFineAmp.x * fineLum;
          n = ofArtBump(n, vWorld, fineHc, fw, fineMc);
          n = ofArtBump(n, vWorld, fineHg, fw, fineM);
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

      // RN-842. THE LOCAL HORIZON, and it is the term that made an airless body
      // render as a lithograph.
      //
      // skyView above is the sky-view factor of a facet on an INFINITE
      // TANGENT PLANE. A real cratered surface stands its horizon up in every
      // direction, so every facet sees less sky and more ground than that. On a
      // body with air the error is invisible: skyAmb and the ground's own
      // radiance are comparable, so moving weight between the channels barely
      // moves a pixel. IN A VACUUM skyAmb IS EXACTLY ZERO AND THE WHOLE AMBIENT
      // RIDES ON THE GROUND CHANNEL, whose weight the flat-plane assumption had
      // already driven to nearly nothing: measured on Cinder at a 16 degree sun,
      // a 21 degree slope was told it sees 96.7 per cent sky and 3.3 per cent
      // ground, and 3.3 per cent of a bounce is a black hillside.
      //
      // uHorizonOcc is MEASURED FROM THE BODY'S OWN HEIGHT FIELD at boot
      // (HorizonOcclusion.ts), never chosen: it is (2/pi) * atan(median slope)
      // over an 8 m support. Cinder reads 0.149 and Forge 0.034, and that gap
      // is the whole reason this can fix a vacuum without relighting a
      // calibrated planet.
      //
      // THE TWO WEIGHTS SUM TO EXACTLY 1 FOR EVERY NORMAL AND EVERY OCCLUSION,
      // so this cannot brighten a frame on its own. It can only move irradiance
      // out of a channel that is zero in a vacuum into one that is not. At
      // uHorizonOcc = 0 both lines are algebraically the pre-RN-842
      // expressions, which is what makes ?horizonocc=0 an EXACT control.
      float skyViewEff = skyView * (1.0 - uHorizonOcc);
      float groundView = 1.0 - skyViewEff;

      // RN-841. THE BOUNCE SOURCE IS THE GROUND BESIDE THIS FRAGMENT, NOT THIS
      // FRAGMENT, so it is not extinguished by this fragment's own shadow.
      //
      // This term is the radiance of the flat ground AROUND the point, and it
      // carried a multiply by shadow, the cascade sample for the point ITSELF,
      // so a fragment in shadow was told its whole neighbourhood was shadowed
      // and its bounce went to zero. That is wrong wherever a shadow is smaller
      // than the field it sits in, which is every rock shadow, every cut bank
      // and every crater rim: the thing casting the shadow is standing in
      // sunlight, and on an airless body it is the only thing lighting what it
      // shades.
      //
      // THE STRONGEST ARGUMENT FOR THIS IS CONSISTENCY, NOT PHOTOGRAPHY.
      // SkyAtmosphere's ground shell (RN-64) computes this same expression for
      // the environment's lower hemisphere and ALREADY drops the shadow term,
      // and says so in its own comment: "THE ONE TERM THAT IS NOT CARRIED OVER
      // IS shadow ... the error is bounded and it is in the direction of too
      // much bounce inside a shadow, where the direct term is already gone."
      // TerrainAmbient.ts exists precisely so the props' idea of the ground and
      // the ground's idea of the ground cannot drift apart. They had drifted on
      // this term, and this is the side that was wrong.
      //
      // WHAT IT COSTS, NAMED: inside a shadow LARGER than the bounce's own
      // gather distance (a mountain's shadow, a night terminator) there is no
      // sunlit ground nearby and this over-lights. The error is bounded by the
      // ground-view weight, which is at most 0.45 + the facet's own tilt, and
      // it is in the direction of too much fill in a place the direct term has
      // already left. ?bouncelit=0 restores the old expression exactly.
      float bounceShadow = mix(shadow, 1.0, uBounceLit);
      vec3 ground = vBiomeColor * (uAmbient + skyAmb
        + sunT * (${SUN_IRR} * max(dot(up, sd), 0.0) * bounceShadow));
      vec3 lit = albedo * (uAmbient + skyAmb * skyViewEff + ground * groundView
        + sunT * (${SUN_IRR} * ndl * shadow));

      // THE SPECULAR LOBE (RN-731). Until this existed the line above WAS the
      // entire lighting model: albedo times irradiance, pure Lambert, with no
      // specular term and no roughness input anywhere in the material. Ground
      // that cannot glint is a large part of why the world reads as paper, and
      // no amount of grading fixes it because there was nothing to grade.
      //
      // IT RIDES THE BUMPED NORMAL, deliberately, and that is the opposite of
      // the flat_ decision fifty lines up. flat_ asks what the SLOPE is and
      // must not be told by a 4 m ripple; a specular asks which way the SURFACE
      // faces at this pixel, and the ripple is exactly the thing that should
      // break a highlight into glitter. Both bump terms have already run.
      //
      // THE SUN HALF reuses sunT, SUN_IRR and shadow unchanged, so the
      // highlight reddens through the terminator and dies under a cascade for
      // free rather than by a second set of rules that could disagree with the
      // diffuse. THE SKY HALF reuses skyAmb, already computed above.
      //
      // ENERGY, STATED HONESTLY: this is ADDITIVE and the diffuse is not
      // reduced by what the specular takes. At a dielectric F0 of 0.04 the
      // error is bounded by a few per cent except at extreme grazing, where a
      // real surface genuinely does go mirror. The reference luminances in
      // section 2.1 are re-taken against this and the move is reported rather
      // than assumed away.
      #ifndef OF_SCALED
        if (uSpecAmp.x > 0.0 || uSpecAmp.y > 0.0) {
          // RN-1257. vGrain.w is the biome's base roughness and vTint.w its
          // per-pixel swing; the grain scalar is the SAME field the albedo above was
          // modulated by, so a facet that catches the light is the facet that
          // reads bright. Under the old derived rule this argument list was
          // (vMatW, ...) and every fragment of a biome got one number.
          // NORMALISED BY THE BIOME'S OWN WEIGHT SUM, and that is a correction
          // the row-sum rescale forced rather than a refinement. MAT_W's sums
          // now span 0.17 to 0.99 (they are luminance-compensated; see
          // BiomeMaterial), so the raw grain's amplitude varies by a factor of
          // six between biomes. Feeding that straight to a saturating
          // roughness term would make roughVar mean "a gentle sway" on Polar
          // and "a hard square wave" on Forest, i.e. the roughness table would
          // secretly be reading the albedo table's amplitude. Dividing by the
          // sum makes the driver a pure SHAPE in about [-0.25, 0.25] whatever
          // the biome, so roughVar means one thing everywhere.
          float grainN = grain / max(dot(vMatW, vec4(1.0)), 1e-3);
          float rough = ofArtRough(vGrain.w, vTint.w, grainN, coverSel, snow, wetF);
          vec3 vd = -rd;                  // rd runs camera -> fragment
          lit += uSpecAmp.x
               * sunT * (${SUN_IRR} * ofArtSpec(n, vd, sd, rough) * shadow);
          lit += uSpecAmp.y
               * ofArtSkySpec(skyAmb, max(dot(n, vd), 0.0), rough);
        }
      #endif

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
