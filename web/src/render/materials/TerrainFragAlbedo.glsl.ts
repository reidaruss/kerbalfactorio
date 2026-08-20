// The terrain fragment shader's ALBEDO block: everything that decides what
// colour the ground IS before anything decides how it is lit. The ground
// texture and its three-tap per-biome blend, the near-field detail layer's
// albedo half, the mid-field layer, the two relief fetches, the snowline and
// relief ramp, and the wet film.
//
// The two relief samples (`relP`, `cellA/B`, `relWa/b`, `relA/B`, `rel`) and
// `grain` are declared here and read by the BUMP and LIGHT chunks. That is not
// a leak introduced by the split: `#ifndef` is not a scope, and those locals
// crossed the same section boundaries inside the one function before it.
//
// Split out of TerrainShader.ts at RN-2051, GLSL unchanged to the character.
// The cut below it lands on the line after region 4's `#endif`, never inside a
// preprocessor region.

import { TERRAIN_TREELINE_BLOCK } from './TerrainTreeline.glsl.js';

export const TERRAIN_FRAG_ALBEDO = /* glsl */`
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
        // 11). This file carried two shipped instances of exactly that
        // (OF_ART_FINE_M and OF_RELIEF_FINE_M, both derived against a depth-14
        // quad and neither moved when WG-186 halved it); RN-1855 measured them
        // at range and derived both, so this term is no longer the only one in
        // the material that gets its own Nyquist point right.
        fineM = OF_FINE_CHUNK_M / max(uFineFreq.z, 1.0);
        // The COARSE half is protected by the RIDGE's wavelength, not the clod
        // octave's, so the pair retires early rather than late; see
        // ofArtFineHc. Both are derived from the live uniform for the reason
        // above.
        fineMc = OF_FINE_CHUNK_M / max(uFineFreq.y, 1.0);
        if (uFineAmp.x > 0.0 || uFineAmp.y > 0.0) {
          fineLum = mix(1.0, ofArtFineLum(vBiomeColor), uFineLum);
          // RN-1900: footM is the hoisted one now, computed in uniform
          // control flow at the top of the function. Identical expression,
          // identical value, one authority.
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
        // RN-1900. THE MID-FIELD LAYER, the ninth term, and the band it fills
        // is the one every other detail term has already left by 27 m. See
        // TerrainMid.glsl.ts for the measurement that says so (at 35 m turning
        // the vnoise bump off is BIT-IDENTICAL, so the mid field's entire
        // surface-art content out there is nothing at all) and for why this one
        // is on pM when the near-field layer's header says pM is unusable.
        //
        // ALBEDO ONLY, and that is the pM argument in one line: nothing here is
        // differentiated, so the 0.0625 m float32 quantum is a staircase in a
        // VALUE (75 steps across the finer octave, invisible) rather than a
        // dead screen derivative (RN-45's arcs). The mid field's NORMAL half is
        // the two-fade split of the vnoise bump above, on the chunk UV where it
        // has always been.
        //
        // ON THE SAME TINT AXIS the grain and the detail layer ride, for
        // RN-1257's reason: a value-only modulation has one degree of freedom
        // and cannot make ground drier here and damper there, which is most of
        // what tonal patchiness at the several-metre scale reads as. Mean-
        // preserving by the same construction, and ofArtMid is centred by its
        // own (see its note on why the fine octave rides the coarse one
        // multiplicatively and why that stays centred).
        //
        // THE LUMINANCE RULE IS THE DETAIL LAYER'S, SHARED RATHER THAN COPIED.
        // RN-1735 measured that one flat amplitude over a nine-fold spread of
        // biome luminance is +134% of contrast at Beach and 0% at Plains, and
        // this term is multiplicative on the lit value in exactly the same way.
        // ofArtFineLum already reads the palette through vBiomeColor, so it
        // costs nothing here and cannot drift from the near-field layer's copy
        // of the same rule, because there is only one.
        //
        // NOT gated on coverSel, for the detail layer's reason: a hillside of
        // scree wants several-metre tonal patchiness as much as a meadow does,
        // and coverSel is the cover/rock selector, not a near/far one.
        if (uMidAmp.x > 0.0) {
          float midLum = mix(1.0, ofArtFineLum(vBiomeColor), uMidAmp.y);
          float mid = ofArtMid(pM, footM, uMidM);
          albedo *= vec3(1.0) + uMidAmp.x * midLum * mid * vTint.xyz;
        }
        // RN-2160. THE SPLAT: the near-field MATERIAL layer, and the first
        // term in this material that answers "what is this ground made of"
        // rather than "how does it vary". Six authored layers blended by
        // slope, altitude and biome. The weight rules are in
        // TerrainSplat.glsl.ts; the convergence rule that keeps this in
        // harmony with the palette is stated in full in TerrainSplat.ts.
        //
        // THE BRANCH IS A BARE UNIFORM, which is what makes six texture
        // fetches free when the term is off (?splat=0, the low quality tier)
        // instead of costing six fetches multiplied by zero, AND what makes
        // the fetches inside it legal at all: a fetch in non-uniform control
        // flow has UNDEFINED LOD, which is RN-78's own scar.
        //
        // The locals are declared OUTSIDE the branch because the bump chunk
        // and the light chunk both read them. #ifndef is not a scope and
        // locals already cross these section boundaries (this file's header
        // says so about relP and grain); this is the same pattern.
        vec3 splatWA = vec3(0.0);
        vec3 splatWB = vec3(0.0);
        vec2 splatNxy = vec2(0.0);
        float splatRough = 1.0;
        float splatFadeA = 0.0;
        float splatFadeN = 0.0;
        if (uSplatAmp.x > 0.0 || uSplatAmp.y > 0.0 || uSplatAmp.z > 0.0) {
          splatFadeA = 1.0 - smoothstep(uSplatFade.x, uSplatFade.y, dist);
          splatFadeN = 1.0 - smoothstep(uSplatFade.z, uSplatFade.w, dist);
          // THE WARP IS APPLIED TO THE SAMPLE COORDINATE ONLY. The bump chunk
          // differentiates the UNWARPED vChunkUv to build its tangent frame,
          // because folding the warp's own gradient into the frame is RN-961's
          // finding in a third place: a difference of a perturbed quantity
          // carries a term belonging to the perturbation, not to the ground.
          vec2 wuv = vChunkUv + ofSplatWarp(vChunkUv);
          // vMatW.x is BiomeMaterial's grass-clump weight and is already the
          // game's answer to "how vegetated is this biome". Reused rather than
          // duplicated as a seventh per-biome table, which would have cost a
          // varying and been a second answer to a settled question.
          float splatVeg = clamp(vMatW.x * 3.0, 0.0, 1.0);
          float splatPatch = ofArtVnoise2P(vChunkUv * OF_SPLAT_PATCHP,
                                           OF_SPLAT_PATCHP);
          // The snow scalar is not computed until the snowline block below,
          // weights take 0 for it here and the snow layer is folded in by a
          // second ofSplatW call after it. Hoisting the snowline instead would
          // reorder float ops inside a shipped term to suit a new one.
          ofSplatW(coverSel, flat_, vRelief / max(1.0, uMaxRelief), 0.0,
                   splatVeg, splatPatch, splatWA, splatWB);
          // TWO RUNGS PER LAYER, blended on the PIXEL FOOTPRINT, and the
          // second rung is here because a one-variable control proved the fade
          // bands were not what retires this term. See TerrainSplat.ts's
          // SPLAT_COARSE_RATIO for the three measured arms; the short version
          // is that the fine rung's 2 mm texel is fully minified by about 30 m
          // and clause C1 then guarantees it contributes exactly nothing, so
          // without a coarser rung the material would stop at a third of the
          // near field. The blend factor is computed ONCE here rather than six
          // times, because it depends on nothing per-layer.
          float ct = smoothstep(OF_SPLAT_CFOOT0, OF_SPLAT_CFOOT1, footM);
          vec4 sG = ofSplatTap(texture2D(uSplatGrass, wuv * OF_SPLAT_REP0),
                               texture2D(uSplatGrass, wuv * OF_SPLAT_CREP0), ct);
          vec4 sD = ofSplatTap(texture2D(uSplatDirt,  wuv * OF_SPLAT_REP1),
                               texture2D(uSplatDirt,  wuv * OF_SPLAT_CREP1), ct);
          vec4 sR = ofSplatTap(texture2D(uSplatRock,  wuv * OF_SPLAT_REP2),
                               texture2D(uSplatRock,  wuv * OF_SPLAT_CREP2), ct);
          vec4 sC = ofSplatTap(texture2D(uSplatCliff, wuv * OF_SPLAT_REP3),
                               texture2D(uSplatCliff, wuv * OF_SPLAT_CREP3), ct);
          vec4 sS = ofSplatTap(texture2D(uSplatScree, wuv * OF_SPLAT_REP4),
                               texture2D(uSplatScree, wuv * OF_SPLAT_CREP4), ct);
          vec4 sW = ofSplatTap(texture2D(uSplatSnow,  wuv * OF_SPLAT_REP5),
                               texture2D(uSplatSnow,  wuv * OF_SPLAT_CREP5), ct);
          float sval = ofSplatVal(sG, sD, sR, sC, sS, sW, splatWA, splatWB);
          splatNxy = ofSplatNrm(sG, sD, sR, sC, sS, sW, splatWA, splatWB);
          splatRough = ofSplatRough(sG, sD, sR, sC, sS, sW, splatWA, splatWB);
          // THE VALUE HALF, on the same tint axis every other albedo term in
          // this material rides and MEAN-PRESERVING by the same construction:
          // sval is centred on zero, so a fixed tint vector moves each
          // channel's SPREAD and leaves its LEVEL alone. That distinction is
          // the macro tint's own scar, and it is clause C2 of the convergence
          // rule.
          albedo *= vec3(1.0) + uSplatAmp.x * splatFadeA * sval * vTint.xyz;
          // THE CHROMA HALF, and it is the only term in this material that is
          // allowed to move HUE. It is safe for exactly one reason, clause C3:
          // ofSplatHue is a convex combination of vectors whose Rec.709
          // luminance is 1 (asserted in TypeScript at module load, and it
          // THROWS rather than warns), luminance is linear, therefore the
          // result has luminance 1 and this cannot move value. It is also
          // faded to nothing by 75 m, so the far field and the minimap read
          // exactly the palette they read today.
          albedo = mix(albedo, albedo * ofSplatHue(splatWA, splatWB),
                       uSplatAmp.y * splatFadeA);
          // RN-2195. THE FAR-FIELD COVER CONVERGENCE, fidelity lane A3 phase
          // 1.5: past THIS SAME BOUNDARY the ground must not revert to the
          // bare biome palette, or a carpet that fades out around 90 m hands
          // off to khaki and the meadow goes bald at the horizon (A2's own
          // "THE FINDING THIS LANE OWES ANOTHER", GrassPalette.ts's header).
          //
          // FADED IN BY (1 - splatFadeA): the near hue term's own curve,
          // inverted, so the two are complementary on ONE boundary and there
          // is no third fade constant to keep in step with clause C4. THE
          // ROTATION is GrassPalette.coverAlbedo's own formula, baked as GLSL
          // constants and PROVEN to agree with it by
          // TerrainCoverFar.ts's assertFarCoverMatchesGrass at module load
          // (throws, on assertHueLuminance's precedent, rather than drifting
          // quietly). THE WEIGHT is splatVeg * coverSel: the SAME
          // vegetation selector this block's own grass/dirt split already
          // uses, times the SAME slope selector every term in this material
          // shares, so a scree slope or a cliff face is never rotated green
          // regardless of biome (the vista negative control: Mountains' own
          // veg is already near zero, and coverSel is what would carry the
          // rest even if it were not).
          if (uSplatFarAmp > 0.0) {
            float farK = OF_COVER_GREEN * splatVeg * coverSel;
            if (farK > 0.0) {
              albedo = mix(albedo, ofFarCoverRotate(albedo, farK),
                           uSplatFarAmp * (1.0 - splatFadeA));
            }
          }
        }
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
        // RN-1855: OF_RELIEF_REPEATS, not a literal 16.0. RELIEF_FINE_M and
        // RELIEF_GRAD_UV are both fractions of ONE REPEAT, so the repeat count
        // has to be one number that all three read.
        vec2 relP = vChunkUv * OF_RELIEF_REPEATS;
        vec3 cellA = ofRelCell(relP, uReliefCell, uReliefCellNoise, uReliefSwing, vec2(0.0));
        vec3 cellB = ofRelCell(relP, uReliefCell, uReliefCellNoise, uReliefSwing, vec2(0.5));
        float relWsum = max(cellA.z + cellB.z, 1e-4);
        float relWa = cellA.z / relWsum;
        float relWb = cellB.z / relWsum;
        vec4 relA = texture2D(uGroundRelief, cellA.xy);
        vec4 relB = texture2D(uGroundRelief, cellB.xy);
        vec4 rel = relWa * relA + relWb * relB;
      #endif

${TERRAIN_TREELINE_BLOCK}
      // /core's maxRelief is a nominal 6,000 m on Forge but baseHeight peaks
      // above it (6,520 m measured), so the snowline is expressed past 1.0
      // rather than clamped, and it never reaches pure white.
      float band = vRelief / max(1.0, uMaxRelief);
      float snow = smoothstep(0.86, 1.14, band) * smoothstep(0.45, 0.85, flat_) * 0.9;
      albedo = mix(albedo, vec3(0.88, 0.92, 0.98), snow);
      albedo *= 0.82 + 0.26 * smoothstep(0.0, 0.7, band);

      // RN-2160. THE SPLAT'S SNOW LAYER, folded in now that the snowline
      // scalar exists. The world audit's gap 10 is that the snow band is "a
      // smoothstep applied to the albedo with no material behind it, so it
      // takes the sky ambient straight and reads as paint". The flat white
      // lerp above IS that band; this is the material behind it.
      //
      // ONLY THE WEIGHTS AND THE NORMAL/ROUGHNESS CHANGE, and the albedo is
      // deliberately NOT re-blended. The white lerp is a shipped term with
      // shipped reference luminances, and re-running the value and chroma
      // halves against the new weights would move it; snow's value channel is
      // authored at a third of the other layers' contrast precisely because
      // snow's albedo is not where its material lives. Its normal and its
      // roughness are.
      //
      // The six fetches are repeated rather than hoisted, and that is the one
      // honest cost in this term: hoisting would mean computing the snowline
      // before the albedo block, which reorders a shipped term. The branch is
      // snow > 0.0, which is NOT a bare uniform, so these fetches are in
      // non-uniform control flow and their LOD is undefined by RN-78's rule --
      // which is exactly why they feed the NORMAL and the ROUGHNESS and not
      // the albedo: a wrong mip on a roughness detail is a slightly wrong
      // sheen on a snowfield, while a wrong mip on an albedo is RN-78's
      // photographed speckle. Snow is also the one layer whose content is
      // almost all low-frequency, so its mip chain is nearly flat.
      #ifndef OF_SCALED
        if (uSplatAmp.z > 0.0 && snow > 0.0) {
          float sVeg = clamp(vMatW.x * 3.0, 0.0, 1.0);
          float sPatch = ofArtVnoise2P(vChunkUv * OF_SPLAT_PATCHP,
                                       OF_SPLAT_PATCHP);
          vec2 swuv = vChunkUv + ofSplatWarp(vChunkUv);
          ofSplatW(coverSel, flat_, band, snow, sVeg, sPatch,
                   splatWA, splatWB);
          float sct = smoothstep(OF_SPLAT_CFOOT0, OF_SPLAT_CFOOT1, footM);
          vec4 tG = ofSplatTap(texture2D(uSplatGrass, swuv * OF_SPLAT_REP0),
                               texture2D(uSplatGrass, swuv * OF_SPLAT_CREP0), sct);
          vec4 tD = ofSplatTap(texture2D(uSplatDirt,  swuv * OF_SPLAT_REP1),
                               texture2D(uSplatDirt,  swuv * OF_SPLAT_CREP1), sct);
          vec4 tR = ofSplatTap(texture2D(uSplatRock,  swuv * OF_SPLAT_REP2),
                               texture2D(uSplatRock,  swuv * OF_SPLAT_CREP2), sct);
          vec4 tC = ofSplatTap(texture2D(uSplatCliff, swuv * OF_SPLAT_REP3),
                               texture2D(uSplatCliff, swuv * OF_SPLAT_CREP3), sct);
          vec4 tS = ofSplatTap(texture2D(uSplatScree, swuv * OF_SPLAT_REP4),
                               texture2D(uSplatScree, swuv * OF_SPLAT_CREP4), sct);
          vec4 tW = ofSplatTap(texture2D(uSplatSnow,  swuv * OF_SPLAT_REP5),
                               texture2D(uSplatSnow,  swuv * OF_SPLAT_CREP5), sct);
          splatNxy = ofSplatNrm(tG, tD, tR, tC, tS, tW, splatWA, splatWB);
          splatRough = ofSplatRough(tG, tD, tR, tC, tS, tW, splatWA, splatWB);
        }
      #endif

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
      #endif`;
