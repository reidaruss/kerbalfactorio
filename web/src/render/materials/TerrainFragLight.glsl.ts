// The terrain fragment shader's LIGHT block: everything from the sun direction
// to `gl_FragColor`. The shadow lookup and sun transmittance, the sky-view
// factor, RN-842's local horizon, RN-841's bounce source, the Lambert term,
// RN-731's specular lobe, aerial perspective and the boundary-layer aerosol.
//
// `SUN_IRR` travels with this chunk because this is its only consumer: it is
// interpolated three times below and nowhere else in the file.
//
// Split out of TerrainShader.ts at RN-2051, GLSL unchanged to the character.

import { TERRAIN_SUN_IRRADIANCE } from './TerrainAmbient.js';
import { EMIT_INSTALLED } from './EmissiveLight.js';

/**
 * The direct-sun irradiance literal, INLINED into the GLSL rather than passed as
 * a uniform. It emits the same characters it always did, so the compiled program
 * is unchanged; what it buys is that SkyAtmosphere's ground shell reads the same
 * exported constant instead of a transcribed 1.45. See TerrainAmbient.ts.
 */
const SUN_IRR = TERRAIN_SUN_IRRADIANCE.toFixed(2);

export const TERRAIN_FRAG_LIGHT = /* glsl */`

      vec3 sd = normalize(uSunDir);
      float ndl = max(dot(n, sd), 0.0);
      float shadow = ofCascadeShadow(vViewZ);
      // Transmittance along the SUN ray from this point: the terminator reddens
      // and then extinguishes the direct term for free, from the same integral
      // the sky uses.
      vec3 sunT = uAtmosOn > 0.5 ? ofAtmoSunTransmittance(pM, sd, 3) : vec3(1.0);

      // RN-2175. The hemisphere, not the zenith. See ofAtmoSkyAmb.
      vec3 skyAmb = ofAtmoSkyAmb(pM, up, 2, 2) * uSkyAmbient;

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

      // RN-2422. THE FIRE LIGHTS THE GROUND IT STANDS ON, and this one line is
      // the half of RN-2385 its own verifier routed here.
      //
      // M3 built the emissive irradiance model and spliced it into the machine
      // and prop programs, and it could not reach the ground: injectEmissiveLight
      // anchors on #include <lights_fragment_begin>, which this material does not
      // have, because it lights itself from uSunDir and reads no three.js light
      // at all. That was recorded there as luck rather than method
      // (Headlamp.ts's header) and as the FIRST reason a pool of real point
      // lights was rejected. The declaration and the four uniform holders are
      // imported from EmissiveLight.ts, so there is exactly one copy of the
      // model and the ground and the furnace cannot drift apart.
      //
      // NO DIVISION BY PI HERE, and that is not an omission. The stock splice
      // writes irradiance += E * PI because three multiplies irradiance by
      // BRDF_Lambert = albedo / PI afterwards; this material's whole lighting
      // model is lit = albedo * irradiance with no such convention, so the
      // same physical contribution is albedo * E written plainly.
      //
      // ENGINE SPACE: uEmitPos is written in engine units by EmissiveLight's
      // own selector, pM is planet-centred METRES, and the two agree exactly
      // when uMetresPerUnit is 1, which is the near scene. This block is
      // compiled out of the scaled program for that reason (TerrainFragPars),
      // so the addition below is only ever evaluated where the frames agree.
      //
      // It rides the BUMPED normal n, like the specular below and unlike
      // skyView above: a firebox 1.2 m away is a local source and the ripple
      // is exactly what should break its falloff into relief.
      //
      // ?firelight=0 multiplies uEmitAmp by zero and leaves the program
      // untouched, so this term inherits M3's own exact control rather than
      // needing one of its own.
      // Under ?firelight=off the declaration is not spliced at all, so the USE
      // has to disappear with it or the program stops compiling; that is what
      // the interpolation below is, and it is the same three-state flag rather
      // than a second one.
      ${EMIT_INSTALLED ? `#ifndef OF_SCALED
        lit += albedo * ofEmitIrradiance(pM + uBodyCenter, n) * uEmitGround;
      #endif` : ''}

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
          // RN-2160. THE SPLAT'S ROUGHNESS, blended in over the biome's own.
          //
          // A MIX AND NOT A MULTIPLY, and the direction matters. ofArtRough
          // above answers "how rough is this BIOME's ground here"; the splat
          // answers "how rough is the MATERIAL this fragment is made of", and
          // where the splat is at full weight the second is the better answer:
          // a cliff face and a talus apron in the same biome have genuinely
          // different roughness and the biome table has one row for both.
          // Multiplying would have made the two claims compound into a floor
          // neither of them states, which is TerrainTex's named failure mode 1
          // (the whole ground goes satin) arriving by arithmetic.
          //
          // It rides the NORMAL fade rather than the albedo one, because
          // roughness and normal are one claim: a facet that catches the sun
          // has to be both tilted and smooth, and a surface that kept its
          // sheen after its relief faded would glint off flat ground.
          //
          // The wet film survives this on purpose: ofArtRough's last mix takes
          // roughness to 0.10 under water, and mixing back toward a dry
          // material would undrown a pond edge. wetF is therefore applied
          // once more here, at the same constant, so the film is the last word
          // about the surface exactly as it is above.
          #ifndef OF_SCALED
            rough = mix(rough, splatRough, uSplatAmp.z * splatFadeN);
            // RN-2340. The far ground's roughness, on the splat's own argument
            // one rung further out: past the near fade the biome table is again
            // the only answer to "how rough is this", and it has one row for a
            // meadow and the crag above it. A MIX and not a multiply, for the
            // splat's reason (multiplying compounds two claims into a floor
            // neither states), and on the SAME weight the normal rides, because
            // roughness and normal are one claim about a facet.
            rough = mix(rough, hzRough, uHorizonAmp.z * hzT);
            rough = clamp(mix(rough, 0.10, wetF), 0.15, 1.0);
          #endif
          vec3 vd = -rd;                  // rd runs camera -> fragment
          lit += uSpecAmp.x
               * sunT * (${SUN_IRR} * ofArtSpec(n, vd, sd, rough) * shadow);
          lit += uSpecAmp.y
               * ofArtSkySpec(skyAmb, max(dot(n, vd), 0.0), rough);
        }
      #endif

      // Aerial perspective. Same function, same parameters as the sky quad, so a
      // mountain at 40 km goes blue and MATCHES the horizon behind it exactly.
      //
      // RN-2540. THE TWO DIAGNOSTIC KNOBS, and both are algebraic identities at
      // their shipped values, so this is the same one program it always was.
      // uApPaint zeroes the SOURCE radiance before the two calls, leaving the
      // fragment as the additive floor alone; uApAmp mixes back to that source
      // afterwards, which is ?prophaze= 's own form on the terrain side (the
      // terrain had no isolator at all before this lane; see AerialDiag.ts).
      vec3 apSrc = mix(lit, vec3(0.0), uApPaint);
      vec3 apTrans;
      vec3 apIn = ofAtmoScatter(camM, rd, dist, OF_AP_VIEW, OF_AP_LIGHT, apTrans);
      lit = apSrc * apTrans + apIn;

      // BOUNDARY-LAYER AEROSOL, and this is the ONLY call site of it in the
      // project. It is what gives the ground aerial perspective over the 200 m
      // to 3 km a player looks across, where Rayleigh moves a ridge by about 1%.
      // Reaching it requires a finite distance to geometry, and that IS the
      // confinement: the sky quad and the skyAmb ray twenty lines above both
      // pass 1.0e9 into a different function, so neither can pick this up. See
      // Atmosphere.glsl's note for the sky control that the first attempt failed.
      lit = ofAtmoAerial(lit, camM, rd, dist, sunT);
      // RN-2540. uApAmp at 1 makes this lit, exactly.
      lit = mix(apSrc, lit, uApAmp);

      // RN-2635. THE BIOME-ID PAINT ARM. Replaces lit OUTRIGHT, after both
      // aerial-perspective calls, so the debug colour is immune to the
      // ~92 per cent additive floor RN-2540 measured at range (see
      // BiomeIdPaint.ts for why that ordering is load-bearing). A fixed,
      // maximally-saturated palette keyed on the raw classifier index --
      // deliberately NOT vBiomeColor/uBiomeColor, which is the table under
      // suspicion and would beg rank 3's own question. 0 (shipped) skips the
      // branch entirely, so this arm cannot move a single existing pixel.
      if (uBiomeIdPaint > 0.5) {
        int bid = int(vBiomeIdx + 0.5);
        if (bid == 0) lit = vec3(1.0, 0.0, 0.0);      // Ocean
        else if (bid == 1) lit = vec3(0.0, 1.0, 0.0); // Beach
        else if (bid == 2) lit = vec3(0.0, 0.0, 1.0); // Plains
        else if (bid == 3) lit = vec3(1.0, 1.0, 0.0); // Forest
        else if (bid == 4) lit = vec3(1.0, 0.0, 1.0); // Hills
        else if (bid == 5) lit = vec3(0.0, 1.0, 1.0); // Mountains
        else if (bid == 6) lit = vec3(1.0, 0.5, 0.0); // Polar
        else if (bid == 7) lit = vec3(0.5, 0.0, 1.0); // Regolith
        else if (bid == 8) lit = vec3(0.0, 0.5, 1.0); // MoonHighland
        else lit = vec3(0.6, 0.6, 0.6);               // CraterFloor
      }

      gl_FragColor = vec4(lit, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>`;
