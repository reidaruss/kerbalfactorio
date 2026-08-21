// THE MASSIF TERM, GLSL half: two kilometre-scale octaves on `pM` that carry the
// far ground past the range where a 256 m-period texture rung can reach, plus
// the curvature read that carries sub-massif relief where the mesh still has
// any. Constants, derivations and the measurements that forced it live in
// TerrainHorizon.ts beside the rungs they hand over from; only the shader is
// here.
//
// RN-2340. Split out of TerrainHorizon.glsl.ts at the 400-CODE-LINE cap (2.2
// rule 1, which counts GLSL comment lines inside a template literal as code) on
// TerrainFine/TerrainMid's own precedent. The split is also the honest seam:
// the rungs are world-locked TEXTURE reads on `vPhase` confined to the near
// program, and this is an ANALYTIC field on `pM` compiled into both.

import { MASSIF_BAND, MASSIF_WA, MASSIF_WB } from './TerrainHorizon.js';

/**
 * The massif's own defines, GENERATED from TerrainHorizon.ts and concatenated
 * beside their consumer, on TERRAIN_SPLAT_PARS's stated reason.
 */
export const TERRAIN_MASSIF_PARS = /* glsl */`
  #define OF_MSF_WA ${MASSIF_WA.toFixed(3)}
  #define OF_MSF_WB ${MASSIF_WB.toFixed(3)}
  #define OF_MSF_BAND0 ${MASSIF_BAND[0].toFixed(4)}
  #define OF_MSF_BAND1 ${MASSIF_BAND[1].toFixed(4)}
`;

/**
 * THE MASSIF TERM, spliced into TERRAIN_FRAG_ALBEDO AFTER the snowline and the
 * altitude ramp, which is the one placement decision in this lane that was made
 * by a measurement rather than by symmetry.
 *
 * Every other albedo term in this material runs BEFORE the snow lerp, on the
 * stated rule that "snow displaces" and a snowfield should be snow rather than
 * snow over a ghost of the rock underneath. That rule is right about MATERIAL
 * and wrong about SHAPE. `RN2340_vista_after.png` is the evidence: the 4.7 km
 * massif in `hzBand` is inside the snow band, so a term applied before
 * `mix(albedo, vec3(0.88, 0.92, 0.98), snow)` is erased on exactly the pixels
 * the audit's rank 1 is about, and the frame the whole lane is judged on could
 * not move. A snowfield genuinely does carry macro tone -- scour, shadowed
 * cornices, rock breaking through -- and it certainly carries the shape of the
 * mountain under it, so this runs after.
 *
 * It declares `msfA`, `msfB` and `msfW` outside its branch because the BUMP
 * chunk reads them, on the splat's own `splatNxy` pattern.
 */
export const TERRAIN_HORIZON_MASSIF = /* glsl */`
      // RN-2340. THE MASSIF TERM: two kilometre-scale octaves on pM, gated to a
      // footprint where pM's derivative is sound and to the relief band where a
      // mountain is. TerrainHorizon.ts holds the four-arm measurement that
      // forced it, the reason it is not a regression to RN-45's banned
      // coordinate, and the handover argument for its distance fade.
      float msfA = 0.0;
      float msfB = 0.0;
      float msfW = 0.0;
      // THE TWO PER-OCTAVE FOOTPRINT FADES, computed ONCE here and read by both
      // consumers: the value half three lines down and the normal half in
      // TERRAIN_HORIZON_BUMP. One authority, because the alternative is the
      // exact shape of RN-1855's scar -- a fade and the wavelength it protects
      // written down twice, agreeing on the day and drifting the day one of them
      // moves.
      //
      // THE VALUE HALF NEEDS THEM TOO, and that is a correction this lane paid
      // for in a frame. It shipped for one arm with a fade on the bump only, on
      // the reasoning that a VALUE survives quantisation and minification where
      // a derivative does not (TerrainMid's own pM argument). That reasoning is
      // about PRECISION and says nothing about SAMPLING: an analytic noise has
      // no mip chain, so at the far massif, where a 200 m footprint puts two
      // samples across the 390 m octave, the value term aliased into a fine
      // regular hatch across the whole mountain. A texture rung cannot do
      // that (the hardware minifies it); an analytic one always can, and the
      // guard therefore has to be per octave rather than per term.
      float msfFa = 0.0;
      float msfFb = 0.0;
      // THE METRIC PIXEL FOOTPRINT, and it is the one line that lets this term
      // exist in BOTH materials. footM is derived from dFdx(vWorld), and vWorld
      // is SCENE units: one unit is one metre in the near scene and 1e5 metres
      // in the scaled one. dist and pM are already in metres in both (the setup
      // chunk multiplies them by uMetresPerUnit), so the footprint was the only
      // quantity in this term that was not.
      float msfFootM = footM * uMetresPerUnit;
      {
        if (uMassifAmp.x > 0.0 || uMassifAmp.y > 0.0) {
          // THE THREE GATES, and each excludes a different failure rather than
          // being three tries at one.
          //   footprint: below OF_HZ_FOOT_F0 pM's quantum is a visible fraction
          //     of a pixel and RN-45's arcs are reachable. This is the gate that
          //     makes the coordinate legal.
          //   distance:  complete before the near/far handover so no ridge is
          //     modulated on one side of it and flat on the other.
          //   relief:    the terrain's own height content, which is what makes
          //     this a MASSIF term and not a noise laid over the whole planet.
          //     Times (1 - coverSel * 0.7) so a gentle vegetated shoulder keeps
          //     most of the meadow it has and a crag gets all of it.
          float msfFoot = smoothstep(OF_HZ_FOOT_F0, OF_HZ_FOOT_F1, msfFootM);
          float msfFar = 1.0 - smoothstep(uMassifFade.x, uMassifFade.y, dist);
          // RN-2475. THE RELIEF BAND IS hzMsfBand, COMPUTED ONCE IN
          // TERRAIN_HORIZON_BLOCK and read here rather than recomputed. The
          // analytic stand-in's plains gain is this gate's exact COMPLEMENT, so
          // the two have to sum to a constant across the boundary or a shoulder
          // gets both terms and a crest gets neither; two copies of one
          // smoothstep is RN-1855's scar and this is the seam it would show on.
          msfW = msfFoot * msfFar * hzMsfBand * (1.0 - coverSel * 0.7);
          // THE HEIGHT IS EVALUATED UNCONDITIONALLY INSIDE THIS BARE-UNIFORM
          // BRANCH, and the three gates above are applied as a MULTIPLY on the
          // amplitude rather than as a branch around the field. That is not
          // tidiness: the bump chunk takes dFdx of these two scalars, and a
          // field that is live in some pixels of a 2x2 quad and hard zero in
          // others hands that derivative a step function. It is the gap the
          // near-field layer's cull threshold exists to keep (TerrainFragAlbedo:
          // "the jump from a live height to a hard 0 inside the same 2x2 quad
          // ... the ring at that radius would get a derivative of a step
          // function"), obtained here for free by not branching at all.
          //
          // Weighted HERE and not at the consumers, so the value half and the
          // two gradient halves cannot end up weighted differently, which is
          // ofArtWetness's rule applied to a pair of scalars.
          msfA = (ofArtVnoise(pM / uMassifM.x) - 0.5) * OF_MSF_WA;
          msfB = (ofArtVnoise(pM / uMassifM.y + 31.7) - 0.5) * OF_MSF_WB;
          // Each octave retired at its OWN Nyquist point, on the curve every
          // fade in this material uses: 0.125 to 0.333 of the wavelength, fully
          // out at a third against a fold at a half.
          msfFa = 1.0 - smoothstep(uMassifM.x * 0.125, uMassifM.x * 0.333,
                                   msfFootM);
          msfFb = 1.0 - smoothstep(uMassifM.y * 0.125, uMassifM.y * 0.333,
                                   msfFootM);
          // THE VALUE HALF, on the same tint axis every other albedo term in
          // this material rides and mean-preserving by the same construction.
          // The two octaves are faded SEPARATELY here and their GRADIENTS are
          // faded separately in the bump chunk, which is RN-1900's settled
          // shape: pre-fading a height and then differentiating it carries a
          // grad(fade) term that belongs to the fade.
          albedo *= vec3(1.0)
            + uMassifAmp.x * msfW * (msfA * msfFa + msfB * msfFb) * vTint.xyz;
        }
        // SUB-MASSIF RELIEF FROM THE MESH, where the mesh still has any. See
        // ofHzCurv: the geometric normal's own screen divergence, i.e. the
        // curvature at whatever scale this pixel can resolve, convex bright and
        // concave dark. It sits HERE, after the snow lerp, for this block's own
        // reason: an occlusion statement is about the shape and the shape does
        // not stop at the snowline.
        //
        // It is applied to the ALBEDO and not to the normal, deliberately: the
        // slope is already correct and it is the shading of the shape that is
        // missing, and a normal perturbation derived from the normal's own
        // derivative is a feedback loop.
        //
        // IT IS HONESTLY SMALL AT RANGE AND THAT IS THE RIGHT BEHAVIOUR. It
        // moved the 4.7 km ridge by 0.08 counts, because several LOD steps up
        // the sub-massif shape is not in the geometry to be read. That null is
        // what the massif octaves above exist to answer; this term is what
        // carries the mid field, where the mesh is still detailed.
      }
      // THE BRANCH IS A BARE UNIFORM and hzT rides the MULTIPLY, because
      // ofHzCurv takes four derivatives and hzT is per-pixel. Near scene only:
      // hzT is identically zero in the scaled material (the rungs that set it
      // are compiled out there), so this is a no-op rather than a decision.
      #ifndef OF_SCALED
        if (uHorizonAmp.w > 0.0) {
          albedo *= 1.0 + uHorizonAmp.w * hzT * ofHzCurv(n, vWorld);
        }
      #endif
`;

/**
 * THE MASSIF TERM'S NORMAL HALF, spliced between the bump chunk and the light
 * chunk, and it is the ONLY normal perturbation in this material that is
 * compiled into BOTH programs.
 *
 * WHY IT IS NOT IN TERRAIN_FRAG_BUMP: that whole chunk is one
 * `#ifndef OF_SCALED` region, and this term has to reach the scaled shell. See
 * the massif block above for why. Putting it there and adding an `#endif`/
 * `#ifndef` pair around a shipped region would have edited a chunk whose split
 * contract is "GLSL unchanged to the character".
 *
 * ORDER: after every near-scene bump, which in the scaled program means after
 * nothing at all. That is correct in both: a massif is the coarsest shape in
 * the stack and everything else is detail sitting ON it, and surface-gradient
 * perturbation is not commutative.
 */
export const TERRAIN_HORIZON_BUMP = /* glsl */`

      // RN-2340. THE MASSIF TERM'S NORMAL HALF, and it is the term that makes a
      // distant mountain take the sun as a shape instead of as a plate.
      //
      // TWO GRADIENTS BLENDED, NOT TWO CALLS AND NOT TWO PRE-FADED HEIGHTS.
      // That is RN-1900's settled form, adopted rather than rediscovered: two
      // ofArtBump calls would perturb the normal twice and surface-gradient
      // perturbation does not commute, so the pre-lane frame would be
      // unreachable by any setting of the amplitude and this change would have
      // no exact negative control; and pre-fading the two HEIGHTS and
      // differentiating the sum carries a grad(fade) term belonging to the fade
      // and not to the ground, which is RN-961's finding and it lit a ridge
      // along every cell boundary there.
      //
      // EACH OCTAVE IS FADED AT ITS OWN NYQUIST POINT. msfFa and msfFb are the
      // SAME two fades the value half used, computed once in the albedo chunk
      // against the METRIC footprint so the two programs agree and so the fade
      // and the wavelength it protects cannot become two numbers (RN-1855).
      // fineM is 0 at the call because the guard has already been applied per
      // octave, which is the one supported shape ofArtBumpG's header names.
      //
      // THE BRANCH IS A BARE UNIFORM and the three range gates ride the
      // AMPLITUDE instead, which is what keeps these four derivatives in
      // uniform control flow. msfA and msfB were evaluated unconditionally in
      // the albedo chunk for the same reason; ofArtBumpG returns n untouched on
      // a zero amplitude, so a fragment outside the band costs a compare.
      if (uMassifAmp.y > 0.0) {
        n = ofArtBumpG(n, vWorld,
          dFdx(msfA) * msfFa + dFdx(msfB) * msfFb,
          dFdy(msfA) * msfFa + dFdy(msfB) * msfFb,
          uMassifAmp.y * msfW, 0.0);
      }`;
