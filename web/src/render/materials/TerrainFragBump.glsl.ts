// The terrain fragment shader's BUMP block: the whole of `#ifndef OF_SCALED`
// region 5, which is the single largest indivisible unit in main() and the
// reason this file could not be cut anywhere in the middle of it. Three
// separable normal perturbations, in the order they must run: the two-octave
// vnoise bump, the asymmetric relief bump (with the RN-741 tile-space slope and
// its pre-RN-741 screen-derivative `else`), and the RN-1733 detail layer's
// normal half.
//
// It perturbs the LIGHTING normal `n` only, and only after every decision that
// depends on the true geometric normal has been made, which is why it sits
// between the albedo block and the light block rather than anywhere else.
//
// Split out of TerrainShader.ts at RN-2051, GLSL unchanged to the character.

export const TERRAIN_FRAG_BUMP = /* glsl */`

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
          // chunk of 57.856 m these were 4.1 m and 10.9 m, which is the scale
          // RN-45 wanted and could not reach from planet-centred metres; at the
          // shipped depth-15 quad of 28.93 m they are 2.07 m and 5.46 m.
          //
          // RN-1855: THE COUNTS ARE DEFINES AND THE FADE IS DERIVED FROM THE
          // FINE ONE. They used to be literals here and a hand-computed 4.2 m
          // over in TerrainArt, which is two numbers for one fact; WG-186
          // halved the quad, the literals meant something new and the 4.2 did
          // not follow, and the fade spent a fortnight protecting a wavelength
          // that no longer existed.
          // RN-1900. ONE OCTAVE, ONE FADE, AND THE FADE IS ON THE GRADIENT.
          //
          // This was one ofArtBump call over the SUM of the two octaves with
          // ONE fade, uArtFineM, the finer of the two. So the 5.458 m octave
          // was retired at the 2.066 m octave's Nyquist point: gone at a
          // 0.688 m footprint (about 30 m at a standing eye) where its own
          // limit at the identical 1.5x margin is 1.818 m (about 49 m). A
          // factor of 2.64 in footprint and 1.63 in range, on precisely the
          // mid-field wavelength RN-1900 exists to restore, and it is the same
          // correction TerrainFine's ofArtFineHc note already made for the
          // near-field layer ("a factor of 4.6 of reach thrown away ... Two
          // calls, two fades, each protecting its own content").
          //
          // TWO GRADIENTS BLENDED, NOT TWO CALLS AND NOT TWO PRE-FADED HEIGHTS,
          // and both rejects are recorded because each is wrong in its own way.
          // Two ofArtBump calls would perturb the normal twice, and
          // surface-gradient perturbation does not commute, so the pre-RN-1900
          // frame would be unreachable by any setting of the new uniform and
          // this change would have no exact negative control. Pre-fading the
          // two HEIGHTS and differentiating the sum is worse: the fade varies
          // per pixel, so dFdx(w * h) carries a grad(w) * h term that
          // belongs to the fade and not to the ground, which is RN-961's own
          // finding and it lit a ridge along every cell boundary there.
          // Weighting each octave's GRADIENT by its own fade is the form
          // RN-961 settled on, and it collapses to the old expression exactly
          // when the two fades are equal: (gf + gc) * f is dFdx(hB) * f, which
          // is what the single call computed. ?artcoarsem=2.0664 is therefore
          // the pre-RN-1900 bump to within floating-point op ordering.
          float hBf = (ofArtVnoise(vec3(vChunkUv * OF_ART_OCT_FINE, 0.5)) - 0.5) * 0.9;
          float hBc = (ofArtVnoise(vec3(vChunkUv * OF_ART_OCT_COARSE, 7.1)) - 0.5) * 0.5;
          float fadeBf = 1.0 - smoothstep(uArtFineM * 0.125, uArtFineM * 0.333, footM);
          float fadeBc = 1.0 - smoothstep(uArtCoarseM * 0.125, uArtCoarseM * 0.333, footM);
          n = ofArtBumpG(n, vWorld,
            dFdx(hBf) * fadeBf + dFdx(hBc) * fadeBc,
            dFdy(hBf) * fadeBf + dFdy(hBc) * fadeBc,
            bumpW * 1.6, 0.0);
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
          // uReliefFineM, not uArtFineM: the fade must protect THIS
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
          n = ofArtBumpG(n, vWorld, gx, gy, relW, uReliefFineM);
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
        // RN-2160. THE SPLAT'S NORMAL HALF, and it is the ONE normal term in
        // this material that is not a surface-gradient bump.
        //
        // WHY IT IS DIFFERENT IN KIND. The three calls above all perturb the
        // normal by the screen gradient of a HEIGHT, which needs no tangent
        // frame and is why this material has never had one. A splat layer
        // ships an authored TANGENT-SPACE NORMAL instead, because a normal map
        // is what a real material's relief is stored as and because deriving
        // it from a height channel would have cost a fifth channel the four-
        // channel packing does not have. Orienting one needs a frame, so
        // ofSplatFrame derives Mikkelsen's cotangent frame from the screen
        // derivatives of vWorld and the chunk UV. Four extra derivatives, in
        // uniform control flow, inside a bare-uniform branch.
        //
        // ORDER: LAST, after all three bumps, for the detail layer's own
        // stated reason one comment up. Surface-gradient perturbation is not
        // commutative and the physically meaningful reading is a material's
        // own relief sitting ON the shape the coarser terms have made, not the
        // shape sitting on the material.
        //
        // THE FADE IS THE NORMAL BAND (uSplatFade.zw, 30 to 60 m), not the
        // albedo band, and the difference is the relief bump's argument
        // verbatim: the chunk UV's world size doubles at every LOD step, so a
        // coarser ring would draw this layer's relief at double wavelength and
        // that photographs at a grazing sun as a differently-textured
        // chunk-shaped patch. 30 to 60 completes inside the max-depth ring.
        if (uSplatAmp.z > 0.0 && splatFadeN > 0.0) {
          n = ofSplatFrame(n, vWorld, vChunkUv, splatNxy,
                           uSplatAmp.z * splatFadeN);
        }
      #endif`;
