// THE FAR GROUND, GLSL half. Pairs with TerrainHorizon.ts on TerrainSplat /
// TerrainTreeline's own precedent: the TS file holds the constants, the
// derivations and the module-load asserts, this file holds the shader and
// nothing else. Every number below is interpolated from an exported constant in
// that file, so there is no second copy of any of them -- and the three repeat
// counts are what `assertPhasePeriod` RETURNED, not integers typed here.
//
// RN-2340. Read TerrainHorizon.ts first: the seam rule, the reason nothing here
// calls `ofPhaseWrap`, the one-carrier decision and the footprint ladder are all
// argued there.
//
// WHAT IS DELIBERATELY NOT HERE: no cascade, no palette table, no grass, no
// carpet rung. This term paints the ground's own material past the near field
// and nothing else.

import {
  HORIZON_AN_M, HORIZON_AN_WA, HORIZON_AN_WB,
  HORIZON_CELL_FOOT_FAR, HORIZON_CELL_FOOT_MID,
  HORIZON_ECO_FIELD, HORIZON_ECO_GATE, HORIZON_ECO_PX, HORIZON_FAR_REPEATS, HORIZON_FOOT_FAR,
  HORIZON_FOOT_MID, HORIZON_FOOT_OUT, HORIZON_MID_REPEATS, HORIZON_N_COVER,
  HORIZON_N_ROCK, HORIZON_WARP_FAR_REPEATS, HORIZON_WARP_MID_REPEATS,
  HORIZON_WARP_UV_FAR, HORIZON_WARP_UV_MID,
} from './TerrainHorizon.js';

export const TERRAIN_HORIZON_PARS = /* glsl */`
  #define OF_HZ_MREP ${HORIZON_MID_REPEATS.toFixed(1)}
  #define OF_HZ_FREP ${HORIZON_FAR_REPEATS.toFixed(1)}
  #define OF_HZ_WREP_M ${HORIZON_WARP_MID_REPEATS.toFixed(1)}
  #define OF_HZ_WREP_F ${HORIZON_WARP_FAR_REPEATS.toFixed(1)}
  #define OF_HZ_WARP_M ${HORIZON_WARP_UV_MID.toFixed(6)}
  #define OF_HZ_WARP_F ${HORIZON_WARP_UV_FAR.toFixed(6)}
  #define OF_HZ_FOOT_M0 ${HORIZON_FOOT_MID[0].toFixed(4)}
  #define OF_HZ_FOOT_M1 ${HORIZON_FOOT_MID[1].toFixed(4)}
  #define OF_HZ_FOOT_F0 ${HORIZON_FOOT_FAR[0].toFixed(4)}
  #define OF_HZ_FOOT_F1 ${HORIZON_FOOT_FAR[1].toFixed(4)}
  #define OF_HZ_FOOT_O0 ${HORIZON_FOOT_OUT[0].toFixed(4)}
  #define OF_HZ_FOOT_O1 ${HORIZON_FOOT_OUT[1].toFixed(4)}
  #define OF_HZ_CELL_M0 ${HORIZON_CELL_FOOT_MID[0].toFixed(4)}
  #define OF_HZ_CELL_M1 ${HORIZON_CELL_FOOT_MID[1].toFixed(4)}
  #define OF_HZ_CELL_F0 ${HORIZON_CELL_FOOT_FAR[0].toFixed(4)}
  #define OF_HZ_CELL_F1 ${HORIZON_CELL_FOOT_FAR[1].toFixed(4)}
  #define OF_HZ_AN_M0 ${HORIZON_AN_M[0].toFixed(3)}
  #define OF_HZ_AN_M1 ${HORIZON_AN_M[1].toFixed(3)}
  #define OF_HZ_AN_WA ${HORIZON_AN_WA.toFixed(3)}
  #define OF_HZ_AN_WB ${HORIZON_AN_WB.toFixed(3)}
  #define OF_HZ_NROCK ${HORIZON_N_ROCK.toFixed(4)}
  #define OF_HZ_NCOVER ${HORIZON_N_COVER.toFixed(4)}
  #define OF_HZ_ECO_PX ${HORIZON_ECO_PX.toFixed(3)}
  #define OF_HZ_ECO_FIELD ${HORIZON_ECO_FIELD.toFixed(4)}
  #define OF_HZ_ECO_G0 ${HORIZON_ECO_GATE[0].toFixed(5)}
  #define OF_HZ_ECO_G1 ${HORIZON_ECO_GATE[1].toFixed(5)}

  // THE ANTI-TILING WARP, on the phase and periodic ON the phase, which is what
  // makes it free of seams: it is a continuous periodic function of vPhase, and
  // two chunks over the same ground hold phases differing by an exact integer
  // vector, so both evaluate it to the same value and its derivative is
  // continuous across the edge as well.
  //
  // Three components off three axis PAIRS of one lattice rather than three
  // lattices, on ofSplatWarp's argument exactly: ofArtVnoise2P reduces its
  // lattice index with mod(), so a constant offset shifts where the field is
  // READ and leaves its period alone, and a second lattice would cost four more
  // hashes to buy decorrelation the offsets already give.
  //
  // THE REPEAT COUNT AND THE AMPLITUDE ARE ARGUMENTS AND NOT DEFINES, because
  // each rung is warped at a period COPRIME WITH ITS OWN TILE and the two rungs
  // therefore need two warps. TerrainHorizon.ts's assertIncommensurate is the
  // rule and its comment is the argument; the short version is that a warp
  // sharing a factor with the tile displaces every copy of that tile alike and
  // decorrelates nothing, and at the equal-period limit it paints the lattice
  // itself. The rep argument is what assertPhasePeriod returned and amp is the
  // shared derivative budget divided by it, so a caller cannot pair a period
  // with the wrong strength.
  vec3 ofHzWarp(vec3 ph, float rep, float amp) {
    return vec3(
      ofArtVnoise2P(ph.yz * rep, rep) - 0.5,
      ofArtVnoise2P(ph.zx * rep + 5.71, rep) - 0.5,
      ofArtVnoise2P(ph.xy * rep + 13.37, rep) - 0.5) * amp;
  }

  // THE THREE-PLANE BLEND WEIGHTS, off the GEOMETRIC normal.
  //
  // The 0.30 subtraction is not a taste knob: an unsharpened blend gives the
  // least-aligned plane a weight of about 0.2 on ordinary ground, and that
  // plane's projection there is nearly edge-on, i.e. it contributes a smeared
  // stripe pattern at a fifth of full strength everywhere in the frame. Every
  // component of a unit normal's absolute value cannot be below 1/sqrt(3) at
  // once, so the largest always survives the subtraction and the normalise can
  // never divide by nothing.
  vec3 ofHzBlend(vec3 gn) {
    vec3 b = max(abs(gn) - vec3(0.30), vec3(0.0));
    b *= b;
    return b / max(b.x + b.y + b.z, 1e-4);
  }

  // ONE RUNG: one carrier, three planes, one world scale. See TerrainHorizon.ts
  // for why the carrier is one texture and what that gives up.
  //
  // NO fract() ANYWHERE. The coordinate goes straight to the sampler, whose
  // REPEAT wrap does the wrapping in the fixed-function path with the
  // derivative left intact; a fract() here would put a step in the coordinate
  // once per period and the hardware would read that step as a mip-0 line along
  // every wrap boundary in the frame.
  //
  // THE NORMAL BLEND is the whiteout form: each plane's tangent xy is swizzled
  // into the two world axes that plane spans and the three are summed by the
  // same weights the value used. The sign of the corresponding normal component
  // flips the plane's own u axis, without which the perturbation is mirrored on
  // the far side of the body and a hillside is lit from the wrong side of its
  // own facets.
  void ofHzRung(sampler2D carrier, vec3 c, vec3 bw, vec3 sg,
                out float val, out vec3 nrm, out float det) {
    vec4 tx = texture2D(carrier, c.zy);
    vec4 ty = texture2D(carrier, c.xz);
    vec4 tz = texture2D(carrier, c.xy);
    val = 2.0 * dot(vec3(tx.r, ty.r, tz.r) - vec3(0.5), bw);
    det = 2.0 * dot(vec3(tx.a, ty.a, tz.a) - vec3(0.5), bw);
    vec2 ex = (tx.gb - vec2(0.5)) * 2.0;
    vec2 ey = (ty.gb - vec2(0.5)) * 2.0;
    vec2 ez = (tz.gb - vec2(0.5)) * 2.0;
    nrm = vec3(0.0, ex.y, ex.x * sg.x) * bw.x
        + vec3(ey.x * sg.y, 0.0, ey.y) * bw.y
        + vec3(ez.x * sg.z, ez.y, 0.0) * bw.z;
  }

  // SUB-MASSIF RELIEF, and it is derived from what the shader already receives
  // rather than from anything new: the SCREEN DIVERGENCE OF THE GEOMETRIC
  // NORMAL, which is the surface's mean curvature.
  //
  // WHY THIS AND NOT AN AO TEXTURE OR A HORIZON MAP. The audit's complaint is
  // that a massif has a silhouette and nothing inside it. The mesh DOES carry
  // the shape -- the ridges are real geometry -- and what is missing is any term
  // that reads it. n is a per-vertex varying, so dFdx(n) at range is the
  // difference between the normals of adjacent triangles, i.e. the curvature of
  // the mesh AT EXACTLY THE SCALE THE FRAME CAN CURRENTLY RESOLVE. That is the
  // property that makes this the right mechanism rather than a cheap one: it
  // needs no wavelength, because it always measures the finest structure the
  // pixel can see, and it self-retires when there is none.
  //
  // The two dot products are the component of dn along the world direction each
  // screen step moves in, per metre, so the sum is div(n) in 1/m. Multiplying by
  // the footprint makes it dimensionless -- curvature ACROSS ONE PIXEL -- which
  // is what keeps one amplitude correct from a hillside at 200 m to a ridge at
  // 20 km. On a sphere div(n) = 2/R, so a featureless planet reads
  // 2/6e5 * footM, i.e. 3e-5 at a ten-metre footprint: the term is zero-mean
  // over any landscape and cannot lift or drop a frame's level.
  //
  // CONVEX IS POSITIVE (a ridge stands into more sky and is less occluded),
  // CONCAVE IS NEGATIVE (a gully is shaded by its own walls). The clamp is not
  // defensive: a single degenerate triangle at a chunk seam can hand this an
  // arbitrarily large divergence, and an unclamped one would paint a bright line
  // there.
  float ofHzCurv(vec3 gn, vec3 p) {
    vec3 ndx = dFdx(gn);
    vec3 ndy = dFdy(gn);
    vec3 pdx = dFdx(p);
    vec3 pdy = dFdy(p);
    float d = dot(ndx, pdx) / max(dot(pdx, pdx), 1e-8)
            + dot(ndy, pdy) / max(dot(pdy, pdy), 1e-8);
    return clamp(d * max(length(pdx), length(pdy)), -1.0, 1.0);
  }
`;

/**
 * The term itself, spliced into TERRAIN_FRAG_ALBEDO after the near splat and
 * before the treeline. It lives here and not there for the 400-code-line cap
 * (ARCHITECTURE 2.2 rule 1, which counts GLSL comment lines inside a template
 * literal as code), on TERRAIN_TREELINE_BLOCK's own precedent.
 *
 * It declares `hzNrm`, `hzT` and `hzRough` OUTSIDE its branch because the BUMP
 * and LIGHT chunks read them. `#ifndef` is not a scope and locals already cross
 * these section boundaries; TerrainFragAlbedo's own header says so about `relP`
 * and `grain`, and the splat does the same with `splatNxy`.
 */
export const TERRAIN_HORIZON_BLOCK = /* glsl */`
      // RN-2340. THE FAR GROUND: the world-locked mid and horizon rungs.
      //
      // WHERE IT SITS. AFTER the near splat, whose fade it takes over from, and
      // BEFORE the treeline, the snowline and the relief ramp, so a distant
      // hillside's material is under the wood that stands on it and under the
      // altitude ramp, exactly as the treeline block argues for itself. Inside
      // the albedo block, so the aerial perspective in TERRAIN_FRAG_LIGHT hazes
      // it as it hazes everything else rather than over it.
      //
      // THE BRANCH IS A BARE UNIFORM, which is what makes six texture fetches
      // and four derivatives legal here at all: a fetch or a derivative inside
      // non-uniform control flow is undefined, which is RN-78's own scar and
      // RN-1733's.
      vec3 hzNrm = vec3(0.0);
      float hzT = 0.0;
      float hzRough = 1.0;
      float hzVal = 0.0;
      // RN-2475. THE RELIEF-BAND GATE, COMPUTED ONCE HERE AND READ BY BOTH
      // CONSUMERS: the massif term, which is what it was written for, and the
      // analytic stand-in's plains gain, which is the complement of it.
      //
      // It moved out of TERRAIN_HORIZON_MASSIF for RN-1855's reason and no
      // other: a gate and the term that hands over on it written down twice
      // agree on the day and drift the day one of them moves, and these two now
      // have to sum to a constant across that boundary for the gain to be
      // exactly zero on a mountain. Declared OUTSIDE the OF_SCALED guard because
      // the massif block is compiled into BOTH programs and this is its input.
      float hzMsfBand = smoothstep(OF_MSF_BAND0, OF_MSF_BAND1,
                                   vRelief / max(1.0, uMaxRelief));
      #ifndef OF_SCALED
        if (uHorizonAmp.x > 0.0 || uHorizonAmp.y > 0.0
            || uHorizonAmp.z > 0.0 || uHorizonAmp.w > 0.0) {
          // THE HANDOVER, on the PIXEL FOOTPRINT and not on distance, for
          // TerrainSplat.ts's measured reason: at a grazing pose the dFdy arm
          // binds and grows as the SQUARE of the range, so a distance-keyed
          // handover would swap rungs at one range looking down and a
          // completely different one looking along the ground. OF_HZ_FOOT_M0 is
          // SPLAT_COARSE_FOOT[1] verbatim, so this rung starts exactly where the
          // shipped ladder's last one finished and there is no gap and no
          // overlap to tune.
          hzT = smoothstep(OF_HZ_FOOT_M0, OF_HZ_FOOT_M1, footM);
          // THERE IS NO "if (hzT > 0.0)" HERE AND THAT IS THE POINT. hzT is
          // per-pixel, so a branch on it is NON-UNIFORM control flow, and the
          // six fetches and four derivatives below would then have undefined LOD
          // and undefined derivatives -- RN-78's photographed scar (mip-0
          // speckle at 40 m plus deep-mip mush at 3 m, immune to every
          // anisotropy setting) and RN-1733's. The near field pays six fetches
          // it multiplies by zero, which is the same bargain the splat's own
          // six unconditional taps strike and for the same reason.
          {
            // ONE WARP PER RUNG, at a period coprime with that rung's own
            // tile. Six value-noise evaluations rather than three, which is
            // the cost of the fix and is arithmetic rather than bandwidth: no
            // extra texture fetch, no extra derivative. A single shared warp
            // cannot serve both rungs honestly, because "coprime with 8" and
            // "coprime with 2" pull the period in different directions and the
            // one number that shipped satisfied neither.
            vec3 hzB = ofHzBlend(n);
            vec3 hzSg = sign(n) + step(abs(n), vec3(0.0));
            vec3 hzPhM = vPhase + ofHzWarp(vPhase, OF_HZ_WREP_M, OF_HZ_WARP_M);
            vec3 hzPhF = vPhase + ofHzWarp(vPhase, OF_HZ_WREP_F, OF_HZ_WARP_F);
            float vM, vF, dM, dF;
            vec3 nM, nF;
            ofHzRung(uSplatRock, hzPhM * OF_HZ_MREP, hzB, hzSg, vM, nM, dM);
            ofHzRung(uSplatRock, hzPhF * OF_HZ_FREP, hzB, hzSg, vF, nF, dF);
            // THE SECOND CROSSOVER, the same ladder one rung further out. The
            // two rungs are mixed as RAW decoded values before any combiner
            // runs, which is ofSplatTap's own argument: every channel is linear
            // and centred on 0.5, so mixing first is arithmetically identical to
            // running the combiners twice and mixing their outputs.
            float ft = smoothstep(OF_HZ_FOOT_F0, OF_HZ_FOOT_F1, footM);
            // AND THE TOP RUNG'S RETIREMENT, which the ladder did not have.
            // Every other rung in this material is retired by being handed to
            // a coarser one; the coarsest was handed to nothing and ran to the
            // horizon, where its 128 m tile subtends three to six pixels and
            // stamps a 4 x 4 mip down at Nyquist. That is the diamond mesh, it
            // is the TILE's pitch rather than its content, and no warp inside
            // a mip budget can reach it. See HORIZON_TILE_PX_OUT for the DFT
            // that says so and for why clause C1 does not already cover it.
            //
            // It multiplies the three TEXTURE-DERIVED fields only. The hue
            // rotation and the roughness base are convex combinations of the
            // splat weights, cost no fetch and have no tile, so they keep
            // running to the horizon on hzT and a distant crag still reads as
            // rock rather than as painted biome. hzRough converges to that
            // base as hzDet goes out, which is its own stated behaviour under
            // minification and not a special case.
            float hzOut = 1.0 - smoothstep(OF_HZ_FOOT_O0, OF_HZ_FOOT_O1, footM);
            hzVal = mix(vM, vF, ft) * hzOut;
            hzNrm = mix(nM, nF, ft) * hzOut;
            float hzDet = mix(dM, dF, ft) * hzOut;

            // THE WEIGHTS. The splat's own six, computed from the SAME
            // selectors at the same fragment -- there is no second opinion here
            // about where a cliff starts, and there is no new selector in this
            // whole term. Snow is folded in at 0 and displaced by the snowline
            // block below exactly as the near rung's first call does.
            vec3 hzWA, hzWB;
            float hzVeg = clamp(vMatW.x * 3.0, 0.0, 1.0);
            float hzPatch = ofArtVnoise2P(vChunkUv * OF_SPLAT_PATCHP,
                                          OF_SPLAT_PATCHP);
            ofSplatW(coverSel, flat_, vRelief / max(1.0, uMaxRelief), 0.0,
                     hzVeg, hzPatch, hzWA, hzWB);

            // RN-2421. THE CELL GUARD, and it is the retirement above written in
            // the unit the artefact is actually in. HORIZON_TILE_PX_OUT retires
            // the top rung when its TILE falls under a few pixels; the thing
            // that repeats is the carrier's own eight-cell worley facet field,
            // an eighth of the tile, so the pitch that reaches the screen
            // arrives eight times earlier in footprint than the guard expects
            // and the whole far band is drawn inside it. See
            // TerrainHorizon.ts's HORIZON_CARRIER_CELLS for the generator line
            // and the DFT of the shipped asset that says peak/median 2565.
            //
            // ONE GUARD PER RUNG, applied on the SAME ft the two rungs are
            // mixed on, because the cell is a property of the rung's own tile
            // and the two tiles are 4:1 apart.
            //
            // IT IS APPLIED HERE, AT THE ALBEDO, AND NOT TO hzVal ITSELF. hzVal
            // and hzDet are also read by the roughness and by the
            // biome-boundary break below, where they are a decorrelated
            // displacement channel rather than a picture: a lattice in the
            // DIRECTION a boundary is nudged is not a lattice on the screen, and
            // zeroing them there would take the ragged edge off a term that has
            // nothing to do with this defect.
            float hzCellM = 1.0 - smoothstep(OF_HZ_CELL_M0, OF_HZ_CELL_M1, footM);
            float hzCellF = 1.0 - smoothstep(OF_HZ_CELL_F0, OF_HZ_CELL_F1, footM);
            float hzCell = mix(1.0, mix(hzCellM, hzCellF, ft), uHorizonCell.x);

            // THE VALUE HALF, on the same tint axis every other albedo term in
            // this material rides and MEAN-PRESERVING by the same construction:
            // hzVal is centred on zero, so a fixed tint vector moves each
            // channel's SPREAD and leaves its LEVEL alone. Clause C2, one rung
            // further out.
            albedo *= vec3(1.0) + uHorizonAmp.x * hzT * hzCell * hzVal * vTint.xyz;

            // RN-2421. THE ANALYTIC STAND-IN, faded in by the guard's own
            // COMPLEMENT so the handover has one boundary and no constant of its
            // own -- RN-2195's complementary-fade idiom, one rung further out.
            //
            // Two pM octaves, each retired at its own Nyquist point on the
            // curve every fade in this material uses, and broadband by
            // construction rather than by luck: ofArtVnoise has no spectral
            // line to stamp, which is the measured difference between it and the
            // carrier and the whole reason one is allowed here and the other is
            // not. Mean-preserving on the same tint axis, and NOT gated on
            // coverSel or on the relief band: a flat far plain is exactly the
            // ground this has to carry (HORIZON_TILE_PX_OUT's own stated cost),
            // so a gate that excused it would excuse the case it exists for.
            //
            // RN-2475. AND ITS AMPLITUDE CARRIES THE PLAINS GAIN, which is the
            // fix for world audit R4's rank 1 and is one multiply.
            //
            // On relieved ground the far field is this term PLUS the massif's
            // two kilometre octaves; on a plain the massif is off by its own
            // relief-band gate, correctly, and this term is left carrying the
            // whole of the far ground alone at an amplitude that was fitted at
            // an AERIAL pose over FOREST. Measured at the new midfield.r250
            // rectangle, one flag apart: removing this term takes iqr 32.63 to
            // 17.42 and removing the ENTIRE horizon term takes it to 17.42 as
            // well, to the digit -- so on plains this is not the main term, it
            // is the ONLY term.
            //
            // THE GAIN RIDES hzMsfBand'S OWN COMPLEMENT, so it is exactly 1.0
            // wherever the massif is at full strength and every relieved pose is
            // bit-identical by construction rather than by tuning, and it
            // introduces no fade constant of its own. See
            // HORIZON_AN_PLAINS_GAIN for the sweep the 0.5 is read off and for
            // the coarse-octave design this replaced, which was built, measured
            // at 20x, moved the rectangle by 0.00 and was thrown away.
            float hzAnA = (ofArtVnoise(pM / OF_HZ_AN_M0 + 17.3) - 0.5)
              * (1.0 - smoothstep(OF_HZ_AN_M0 * 0.125, OF_HZ_AN_M0 * 0.333, footM));
            float hzAnB = (ofArtVnoise(pM / OF_HZ_AN_M1 + 63.1) - 0.5)
              * (1.0 - smoothstep(OF_HZ_AN_M1 * 0.125, OF_HZ_AN_M1 * 0.333, footM));
            albedo *= vec3(1.0)
              + uHorizonCell.y * (1.0 + uHorizonPlains * (1.0 - hzMsfBand))
              * hzT * (1.0 - hzCell)
              * (hzAnA * OF_HZ_AN_WA + hzAnB * OF_HZ_AN_WB) * vTint.xyz;

            // THE CHROMA HALF: slope-driven layer tinting, and it is the whole
            // of "a distant mountain should read as rock and not as painted
            // biome". ofSplatHue is the SAME convex combination of unit-
            // luminance vectors the near rung uses, so clause C3 holds here for
            // the same one-line reason: luminance is linear, the weights sum to
            // 1, therefore the result has luminance 1 and this cannot move
            // value. IT COSTS NO FETCHES, which is why material identity
            // survives to the horizon on a single carrier texture.
            //
            // IT IS COMPLEMENTARY TO RN-2195's far cover rotation rather than
            // stacked on it, and that is structural rather than tuned: that term
            // is weighted by splatVeg * coverSel and so does its work on gentle
            // vegetated ground, where these weights are grass and dirt and this
            // rotation is small; on a Mountains crag splatVeg is near zero, that
            // term is off, and this one is carrying rock, cliff and scree.
            albedo = mix(albedo, albedo * ofSplatHue(hzWA, hzWB),
                         uHorizonAmp.y * hzT);

            // THE ROUGHNESS the light block will mix in: the six-way base from
            // the table modulated by the carrier's own centred detail channel,
            // multiplicative so a minified sample converges to the base rather
            // than to grey. ofSplatRough's own rule, with the six taps replaced
            // by the one carrier for the reason TerrainHorizon.ts states.
            float hzBase = dot(OF_SPLAT_RB_A, hzWA) + dot(OF_SPLAT_RB_B, hzWB);
            hzRough = clamp(hzBase * (1.0 + hzDet), 0.15, 1.0);

            // THE NORMAL AMPLITUDE SPLIT. A crag carries more relief than a
            // meadow and both are painted by one carrier here, so the weights
            // -- not a second texture -- are what tell them apart.
            float hzRock = hzWA.z + hzWB.x + hzWB.y;
            hzNrm *= mix(OF_HZ_NCOVER, OF_HZ_NROCK, clamp(hzRock, 0.0, 1.0));

            // RN-2340 / L2's RANK 2 DIAGNOSIS. THE RANGE-AWARE BIOME-BOUNDARY
            // BREAK. The aerial staircase is the biome colour boundary resolved
            // across one coarse-LOD cell, teeth on the vertex grid. See
            // TerrainHorizon.ts's HORIZON_ECO_PX for why the mechanism is a
            // DISPLACEMENT and not a blur: every per-vertex field in this
            // material is C0 on that same grid and a fragment cannot low-pass
            // any of them, while vBiomeColor IS linear in screen space inside a
            // triangle, so vBiomeColor + s*dFdx + t*dFdy is exactly the colour s
            // pixels across and t pixels up.
            //
            // Offsetting (s, t) by two decorrelated channels of the rung already
            // fetched turns the edge into a ragged band OF_HZ_ECO_PX pixels
            // wide. Measured in PIXELS, so its WORLD width is that times footM
            // and the boundary widens with range exactly as the cell shrinks --
            // which is the range-awareness this is for.
            //
            // THE GATE IS THE ARTEFACT'S OWN MAGNITUDE and not a distance: the
            // per-pixel derivative of vBiomeColor is exactly zero inside a
            // biome, so the term cannot fire there, and it saturates near the
            // Forest-to-Hills step. Correction applied through coverSel so a
            // cliff face, whose albedo is the rock branch rather than the biome
            // colour, is not moved by a boundary it does not carry.
            if (uHorizonEco > 0.0) {
              vec3 bdx = dFdx(vBiomeColor);
              vec3 bdy = dFdy(vBiomeColor);
              float bStep = max(length(bdx), length(bdy));
              float bK = smoothstep(OF_HZ_ECO_G0, OF_HZ_ECO_G1, bStep);
              if (bK > 0.0) {
                float jp = uHorizonEco * OF_HZ_ECO_PX * bK * hzT
                         / OF_HZ_ECO_FIELD;
                // CLAMPED INTO GAMUT, AND THE CLAMP IS THE TERM'S OWN LIMIT
                // RATHER THAN A SAFETY NET. The displacement is a FIRST-ORDER
                // EXTRAPOLATION of a linear field: it is exact only inside the
                // triangle it was differentiated on, and several pixels past a
                // boundary it walks the colour straight out of the far side of
                // the neighbouring biome and below zero, which prints as dark
                // speckle along the edge. That was recorded as a 4x-only
                // effect and it is not: it fringes the boundary at 1x too.
                //
                // So the extrapolation is done on the FIELD and clamped there,
                // and only the surviving DIFFERENCE is applied. vBiomeColor is
                // a linear-RGB reflectance, so [0, 1] is its own definition and
                // not a display convention; a displaced sample that leaves it
                // is a colour no biome has, and the honest reading of the term
                // there is "as far as the palette goes and no further".
                vec3 bEco = clamp(vBiomeColor + (bdx * hzVal + bdy * hzDet) * jp,
                                  vec3(0.0), vec3(1.0));
                albedo = max(albedo + (bEco - vBiomeColor) * coverSel, vec3(0.0));
              }
            }
          }
        }
      #endif
`;
