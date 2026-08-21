// RN-2511 to RN-2515. THE MID FIELD'S GROUND COVER: what the biome-prop ring
// stops delivering at 170 m, carried by the material instead.
//
// THE DEFECT, MEASURED RATHER THAN ASSERTED (rendering.md 2.31).
// At the `meadowfield` pose, painting the fragment shader's own `dist` as a
// step ladder and reading a per-row profile (`tools/smoke/rn2510rows.mjs`) puts
// 85 m at frame row 297.5, 170 m at row 291, 340 m at row 278.5 and the horizon
// at about 276. So the whole visible plain from the biome ring to the sky is
// FIFTEEN ROWS, and the twelve of them between 170 m and 340 m are the mid
// field this lane is about.
//
// `ScatterTuning.RADIUS_M` is 170 m and it is a HARD ring with no edge weight,
// `DETAIL_RADIUS_M` is 78 m, and the canopy impostor tier does not start until
// `CANOPY_NEAR_M` (550 m). Between 170 m and 550 m the instance tier places
// NOTHING except `TreeField`'s sparse harvest trees. The negative control says
// the same thing from the far side: `?canopy=0` leaves `meadowfield.r250` at
// **47.43 against a shipped 47.44**, i.e. not one pixel of the mid-field
// rectangle is canopy, so the band cannot be blamed on the tier above it
// either.
//
// THE FIX IS THE TREELINE'S ARGUMENT, ONE RANGE BAND IN, and it is deliberately
// the same three parts with the same three owners:
//   1. WHERE. World-gen's own stand and grove octaves, evaluated per terrain
//      vertex in the SAME loop that already evaluates them for the canopy index
//      (`ChunkCanopy.fillCanopyIndex`), so the two noise fields are sampled once
//      and spent twice. It is the raw pair and NOT `canopyWeight`, and
//      `ChunkCanopy.coverField`'s header carries the measurement that forced
//      that: `canopyWeight` is bimodal by construction and it is SATURATED
//      across the entire mid field at the plains art pose.
//   2. HOW MUCH. Beer-Lambert on the viewing angle, exactly as
//      `TerrainTreeline.ofTreeCover` does it, on a GROUND-COVER area index
//      derived live from the biome's own prop table.
//   3. WHEN. The instance ring's own hard edge at `RADIUS_M`, and nothing else.
//      There is no fade constant in this lane at all: inside the ring the term
//      is identically zero and every rectangle inside 170 m is bit-identical by
//      construction, and outside it the term is full. A hard step against the
//      instance tier's OWN hard step is the case where the two cancel; the
//      residual is measured in 2.31 rather than assumed.
//
// AND THE ONE THING IT IS REFERENCED TO, which is what keeps it from being a
// tint. The term is not "cover" against "no cover", it is the cover this
// ground carries against the cover the BIOME'S OWN MEAN DENSITY would carry at
// the same range and the same angle. Both are computed, both from the same
// exponential, and the difference is what is painted. At the field's mean the
// term is exactly zero, so a term with the wrong amplitude cannot quietly move
// a pose's LEVEL; what it can do is add or remove CONTRAST, which is the axis
// the whole mid field is short of.
//
// WHY THE VALUE MOSAIC IS MOSTLY CLEARINGS OPENING UP AND NOT STANDS GOING
// DARK, said out loud because it surprised this lane. Beer-Lambert SATURATES:
// at a standing eye the depression at 300 m is 1.62/300 = 0.0054, so a Plains
// index of 0.011 already gives 0.87 cover at the mean and 0.98 in a closed
// stand. The headroom is all on the open side. That is also what a plain looks
// like from a metre and a half up -- pale open field punctuated by dark rough
// ground, not the other way round -- so the direction is right, but it is a
// consequence of the law rather than a choice, and a reader should know which.

import { RADIUS_M, groveAt, standAt } from '../../world/ScatterTuning.js';
import { BIOME_COVER_MU, COVER_PLAN_AREA_M2, coverField }
  from '../geometry/ChunkCanopy.js';

/** The biome-prop ring, imported LIVE. This term's only boundary. */
export const COVER_RING_M = RADIUS_M;

/**
 * THE ONE FITTED NUMBER IN THIS LANE, re-exported from where it is spent.
 *
 * `ChunkCanopy.CROWN_AREA_M2` could quote its three crowns from
 * `tools/blender/contracts.json` because `props_canopy` publishes a
 * `dims_xyz_m` per species. `props_plains` does NOT: it publishes ONE
 * `dims_xyz_m` (1.05 x 0.8 x 0.95) for its `lod0_node`, which is
 * `Plains_Shrub`, and nothing for the two grass tufts, the flower cluster or
 * the two pebbles. So a per-species area index is not derivable from any file
 * the client or the build can read, and this lane says so rather than
 * inventing six numbers and calling them a table.
 *
 * What IS derived rather than fitted is the DENSITY half: `BIOME_COVER_MU`
 * reads `BIOME_PROPS` live, so a world-gen density change moves this term with
 * it, which is the failure mode `ChunkCanopy`'s own header calls "a constant
 * copied from the thing it watches". Only the scalar is fitted.
 *
 * 0.10 m^2 is a plan area of about 0.35 m across, and the sanity check it has
 * is the one number the contract does publish: the shrub is 1.05 x 0.95, i.e.
 * 0.78 m^2 of plan area, and it is 700 of Plains' 18,500 pre-scale density,
 * with the other 17,800 being grass tufts and a flower cluster at a few
 * centimetres across. A density-weighted mean of 0.10 is what those two facts
 * give.
 */
export { BIOME_COVER_MU, COVER_PLAN_AREA_M2 };

/** True for any biome the ring places ground cover in at all. */
export const ANY_COVER_MU = BIOME_COVER_MU.some((m) => m > 0);

/**
 * THE COVER FIELD'S OWN MEAN, and the number the whole term is referenced to.
 *
 * `ChunkCanopy.coverField` is `0.65 * standAt + 0.35 * groveAt`, a convex
 * combination of two stationary trilinear value-noise fields on [0,1], so its
 * planetary mean is a property of world-gen's two fields and nothing else.
 * Measured over 64 deterministic sites x a 64x64 lattice at 190 m
 * (GROVE_M / 4), 262,144 samples: the value in the constant below.
 *
 * A 3 km window does NOT converge to it, and that is a real property of a
 * 760 m grove octave rather than a defect: a site with less cover than the
 * planet IS more open ground and this term is supposed to say so. The
 * consequence, stated rather than hidden: the term is exactly zero at the
 * PLANETARY mean, not at each pose's own local mean, so a pose over unusually
 * open ground gets a small net brightening and one over unusually dense ground
 * a small net darkening.
 */
export const COVER_STAND_MEAN = 0.500540;

/** Default amplitude of the whole term. `?coverstand=0` is the exact before. */
export const COVER_STAND_AMP = 1.0;

/**
 * THE MOSAIC AMPLITUDE: how much the cover fraction rises and falls with
 * world-gen's own stand field, as a fraction of the field's planetary mean.
 * Swept with `?coverstandm=`.
 *
 * Zero-mean by construction (`csDev` is centred on `COVER_STAND_MEAN`), so
 * this is the knob that adds STRUCTURE without moving level, and the value
 * below is the one that adds a knob at all.
 */
export const COVER_STAND_MOSAIC = 0.75;

/**
 * THE VALUE DROP: how much darker the cover layer is than the open substrate
 * it stands on, as a fraction. Swept with `?coverstandv=`.
 *
 * This one DOES move the mid field's level, deliberately: a tussock-and-scrub
 * mat is darker than bare ground, and R4's rank 4 records the opposite defect
 * one range band in (the near carpet reads 1.96x the brightness of the ground
 * it stands on). This term must not repeat it in the mid field.
 */
export const COVER_STAND_VALUE = 0.18;

/**
 * THE CHROMA AMPLITUDE: the strength of the carpet's own hue rotation applied
 * to the cover layer, as a multiple of `OF_COVER_GREEN`. Swept with
 * `?coverstandc=`.
 *
 * It rides `ofFarCoverRotate`, the same rotation RN-2195's far-cover
 * convergence already applies at a constant strength past 75 m, so there is no
 * second hue authority in the material. 1.0 means "the cover is the colour the
 * carpet already converges to", which is the only defensible default: the
 * layer this term paints IS the layer the carpet's own fade hands over to.
 */
export const COVER_STAND_CHROMA = 1.0;

/**
 * Numerical floor under sin(depression). NOT a tuning constant and NOT
 * `TerrainTreeline.TREE_SIN_MIN`'s 0.02, and the difference matters: that floor
 * was derived for a 1,200 m eye, where the ground's own depression at the
 * horizon is 1.81 degrees and the floor therefore never binds. THIS term's
 * whole subject is a 1.62 m eye, where the depression at 300 m is 0.0054 and a
 * 0.02 floor would bind across the entire mid field and silently replace the
 * measurement with the constant. So the floor here is numerical only: it exists
 * to keep the exponent finite on a ray exactly tangent to the datum, which does
 * happen on the skirt vertices of a horizon chunk.
 */
export const COVER_SIN_MIN = 1.0e-3;

/**
 * THE DRIFT GUARD, on `assertFarCoverMatchesGrass` / `assertTreelineMatchesScatter`'s
 * precedent: it runs at module load and it THROWS.
 *
 * It does NOT re-estimate `COVER_STAND_MEAN` -- 262,144 samples at every client
 * boot is not free and a small sample is a bad estimator of a field with a
 * 760 m octave in it. It asks the question a guard should ask instead: has
 * world-gen's field MOVED? A fixed 32-site x 8x8 deterministic sample (2,048
 * evaluations, the same two functions the chunk fill already calls) has one
 * expected value, recorded below to six places, and any change to `standAt`,
 * `groveAt`, `canopyWeight` or their constants moves it. The tolerance is tight
 * because the sample is FIXED: there is no sampling error to leave room for.
 */
const GUARD_EXPECT = 0.498837;
const GUARD_TOL = 1.0e-5;

/** The fixed sample. Exported so a probe can print what the guard read. */
export function standFieldGuardMean(): number {
  let k = 1;
  const rnd = (): number => { k = (k * 1103515245 + 12345) >>> 0; return k / 4294967296; };
  let s = 0;
  let n = 0;
  for (let t = 0; t < 32; ++t) {
    const ox = (rnd() - 0.5) * 1.2e6;
    const oy = (rnd() - 0.5) * 1.2e6;
    const oz = (rnd() - 0.5) * 1.2e6;
    for (let i = 0; i < 8; ++i) {
      for (let j = 0; j < 8; ++j) {
        const x = ox + i * 190;
        const z = oz + j * 190;
        s += coverField(standAt(x, oy, z), groveAt(x, oy, z));
        n += 1;
      }
    }
  }
  return s / n;
}

export function assertStandFieldUnmoved(): void {
  const got = standFieldGuardMean();
  if (Math.abs(got - GUARD_EXPECT) > GUARD_TOL) {
    throw new Error(
      `[of] terrain cover-stand: world-gen's stand field has moved. The fixed `
      + `2,048-sample guard reads ${got.toFixed(6)} against ${GUARD_EXPECT}. `
      + `COVER_STAND_MEAN (${COVER_STAND_MEAN}) was measured against the old `
      + `field and this term is referenced to it, so re-measure both rather `
      + `than widening this tolerance.`);
  }
}
assertStandFieldUnmoved();

/**
 * `?coverstand=0` / `?coverstandv=` / `?coverstandc=`, on
 * `treelineAmpFromQuery`'s pattern exactly, including RN-150's dead-default
 * guard (a registered parameter that cannot move the picture is worse than a
 * missing one, so each parser refuses a value it cannot act on).
 */
export function coverStandAmpFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('coverstand') === '0') return 0;
  const raw = p.get('coverstandamp');
  if (raw === null) return COVER_STAND_AMP;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : COVER_STAND_AMP;
}

export function coverStandMosaicFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  const raw = p.get('coverstandm');
  if (raw === null) return COVER_STAND_MOSAIC;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : COVER_STAND_MOSAIC;
}

export function coverStandValueFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  const raw = p.get('coverstandv');
  if (raw === null) return COVER_STAND_VALUE;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : COVER_STAND_VALUE;
}

export function coverStandChromaFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  const raw = p.get('coverstandc');
  if (raw === null) return COVER_STAND_CHROMA;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : COVER_STAND_CHROMA;
}

/**
 * The per-biome ground-cover area index the vertex shader multiplies the
 * `aCover` attribute's field by, as the flat array three uploads to a
 * `float[]` uniform. Derived, not tabulated: see `BIOME_COVER_MU`.
 */
export function biomeCoverMuArray(): Float32Array {
  return new Float32Array(BIOME_COVER_MU);
}

/** For the probe, `farCoverState()`'s own shape. */
export function coverStandState(): {
  ringM: number; mean: number; guard: number; planAreaM2: number;
  mu: readonly number[];
} {
  return {
    ringM: COVER_RING_M, mean: COVER_STAND_MEAN, guard: standFieldGuardMean(),
    planAreaM2: COVER_PLAN_AREA_M2, mu: BIOME_COVER_MU,
  };
}
