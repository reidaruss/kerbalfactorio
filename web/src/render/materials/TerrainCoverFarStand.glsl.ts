// RN-2512. THE MID FIELD'S GROUND COVER, GLSL half. Pairs with
// TerrainCoverFarStand.ts on TerrainTreeline.glsl / TerrainCoverFar.glsl's own
// precedent: the TS file holds the constants, the derivations, the fitted
// scalar and the drift guard; this file holds the shader and nothing else.
// Every number below is interpolated from an exported constant in that file,
// so there is no second copy of any of them.

import {
  COVER_RING_M, COVER_SIN_MIN, COVER_STAND_MEAN,
} from './TerrainCoverFarStand.js';

export const TERRAIN_COVER_STAND_PARS = /* glsl */`
  #define OF_CSTAND_RING_M ${COVER_RING_M.toFixed(1)}
  #define OF_CSTAND_MEAN ${COVER_STAND_MEAN.toFixed(6)}
  #define OF_CSTAND_SIN_MIN ${COVER_SIN_MIN.toFixed(6)}

  // BEER-LAMBERT ON A GROUND-COVER LAYER, and it is TerrainTreeline.ofTreeCover
  // with the canopy's handover term taken out, because this band has no
  // handover to make: inside OF_CSTAND_RING_M the instance ring owns the cover
  // outright and the caller does not enter, and outside it the ring places
  // nothing at all, so the density the instances are missing IS the density.
  //
  // mu is cover PLAN area per unit ground area and sinDep is the depression of
  // the view ray against the LOCAL up. The geometric normal is deliberately not
  // used, for ofTreeCover's own reason one term over: this asks how long the
  // ray's path through a cover layer standing on the datum is, not how the
  // facet under it is tilted.
  float ofCoverStand(float mu, float sinDep) {
    return 1.0 - exp(-mu / max(sinDep, OF_CSTAND_SIN_MIN));
  }
`;

/**
 * The term itself, spliced into TERRAIN_FRAG_ALBEDO between the horizon block
 * and the treeline block.
 *
 * It lives here and not there for the 400-code-line cap (ARCHITECTURE 2.2
 * rule 1, which counts GLSL comment lines inside a template literal as code),
 * on TERRAIN_TREELINE_BLOCK's own precedent.
 *
 * IT IS COMPILED INTO BOTH PROGRAMS AND THAT IS THE WHOLE REASON IT SITS HERE
 * RATHER THAN BESIDE THE FAR-COVER ROTATION IT MODULATES, which is where this
 * lane first put it. THE MEASUREMENT: with the term inside the splat branch --
 * `TerrainFragAlbedo`'s lines 118 to 340, which are one `#ifndef OF_SCALED`
 * region -- an in-block magenta paint left the whole band under the horizon
 * UNPAINTED at the plains pose while the ground nearer than it went magenta.
 * The plains mid field past the near program's reach is drawn by the SCALED
 * terrain program, and every `#ifndef OF_SCALED` term is compiled out of it.
 * That is `MASSIF_FADE_M`'s own scar one term over ("the massif block and its
 * normal half are compiled into BOTH programs, so there is no side of the
 * handover where the term is missing"), and it is why RN-2475's plains macro
 * gain reached this band and a term written beside RN-2195's could not.
 *
 * WHAT THAT COSTS, and it is one line: `splatVeg` is declared inside the splat
 * branch, so it is recomputed here from `vMatW.x` -- the same expression, the
 * same varying, and `ofSplatW`'s own note gives the reason it is `vMatW.x * 3`
 * in both places rather than a seventh per-biome table.
 *
 * Nothing inside samples a texture and nothing takes a derivative, so the
 * non-uniform `if` below is legal here for TERRAIN_TREELINE_BLOCK's stated
 * reason and not merely by assumption (RN-78's scar).
 */
export const TERRAIN_COVER_STAND_BLOCK = /* glsl */`
            // RN-2512. THE MID FIELD'S GROUND COVER. The prop ring is a
            // HARD edge at ScatterTuning.RADIUS_M with no edge weight, the
            // detail cards are gone by 78 m and the canopy impostor tier does
            // not begin until 550 m, so from the ring to the treeline the
            // instance tier places nothing but TreeField's sparse harvest
            // trees. At a standing eye that band is twelve frame rows wide and
            // it is the whole of the receding plain. See
            // TerrainCoverFarStand.ts for the row measurement that says so and
            // for the ?canopy=0 control that clears the tier above it.
            //
            // WHAT IT PAINTS IS THE COVER, not a modulation of the substrate,
            // and that is the second thing this lane got wrong before it got
            // right. A version that only rippled the terrain's own value by the
            // stand field's deviation from its mean was built, swept and
            // rejected on its own numbers and its own frames: midfield.r250
            // iqr fell 43.83 -> 38.98 -> 35.99 monotonically in the amplitude,
            // and at meadowfield -- the pose the player actually gets -- it
            // was invisible at 1x because the near half of the mid field is
            // covered in prop instances and the far half is twelve rows. A
            // mosaic on ground nobody can see is not a fix.
            //
            // So this paints the LAYER: past the ring the terrain carries the
            // cover the instance tier has stopped placing, in the carpet's own
            // hue, at the fraction Beer-Lambert says a layer of that area index
            // occludes at this viewing angle, modulated by world-gen's own
            // stand field so it clumps where the copses are. That is
            // TerrainCoverFar's stated purpose -- "past THIS SAME BOUNDARY the
            // ground must not revert to the bare biome palette" -- carried one
            // boundary further out, and it is TerrainTreeline's mechanism one
            // range band IN.
            if (uCoverStand.x > 0.0 && vCoverStand.x > 0.0) {
              // GROUND distance, the frame RADIUS_M is written in. RN-2228 is
              // the scar: a 3-D eye distance compared against a radius that
              // means ground switched a whole tier off from the air.
              float csG = length(toCam - up * dot(toCam, up));
              if (csG > OF_CSTAND_RING_M) {
                float csS = clamp(abs(dot(rd, up)), 0.0, 1.0);
                // vCoverStand.y is world-gen's own stand and grove octaves at
                // this vertex, in [0,1] (ChunkCanopy.coverField), evaluated at
                // the coordinates ScatterSample places props at. So the ground's
                // mosaic and the copses standing on it are cut from ONE field,
                // by construction rather than by resemblance -- which is
                // ChunkCanopy's own header argument, one consumer over.
                // HOW MUCH COVER IS IN THE WAY, from the biome's own area index
                // and the viewing angle. 0.02 looking straight down from an
                // aerial pose, 0.89 at a standing eye's 0.005 depression across
                // the mid field: the term is self-limiting by the geometry
                // rather than by a range fade, which is why it costs the
                // aerials almost nothing and is the whole of the plains mid
                // field.
                float csVis = ofCoverStand(vCoverStand.x, csS);
                // THE MOSAIC, linear in world-gen's field and referenced to the
                // field's PLANETARY MEAN, so it is zero-mean by construction:
                // more cover than average where the copses are, open ground
                // between. It is linear and not another exponential because the
                // exponential saturates at this angle and the measurement said
                // so before the algebra did.
                float csDev = (vCoverStand.y - OF_CSTAND_MEAN) / OF_CSTAND_MEAN;
                float csVeg = clamp(vMatW.x * 3.0, 0.0, 1.0);
                float csW = clamp(uCoverStand.x * coverSel * csVeg * csVis
                                  * (1.0 + uCoverStand.y * csDev), 0.0, 1.0);
                // THE COVER'S OWN COLOUR: this ground's albedo rotated by the
                // CARPET's own rotation (RN-2195's ofFarCoverRotate, so there
                // is no second hue authority in this material) and dropped in
                // value, because a mat of tussock and scrub is darker than the
                // open substrate it stands on. Both amplitudes are swept, and
                // ?coverstand=0 takes csW to zero, which is the exact frame
                // before this term.
                vec3 csTone = ofFarCoverRotate(albedo, OF_COVER_GREEN * uCoverStand.w
                                               * csVeg * coverSel)
                              * max(1.0 - uCoverStand.z, 0.0);
                albedo = mix(albedo, csTone, csW);
              }
            }
`;
