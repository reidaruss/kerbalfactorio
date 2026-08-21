// RN-2275 to RN-2279. INTER-CROWN SELF-SHADOWING: the one law, held in one
// place, applied to BOTH halves of the canopy.
//
// THE DEFECT, named independently by the crown-asset verifier and the
// far-ground verifier and written down as owed item 1 of rendering.md 2.18.10:
// a canopy's low albedo is mostly crowns shadowing EACH OTHER, and nothing in
// this game models it. The crown card carries a lit-top / shaded-underside ramp
// for ONE crown (2.17.1's measured 223 / 178 / 113) and the far treeline paints
// that card's MEAN albedo with no layer transmittance at all. The result is
// arithmetic rather than taste: the canopy tone the terrain paints is
// (0.089977, 0.155212, 0.072528), Rec.709 luma 0.13537, and the Forest
// substrate under it is `0x41392b` -- RN-347's deliberate leaf litter and
// humus -- at luma 0.04222. The wood is 3.21x its own clearing. Every real
// aerial photograph is the other way round, and box luma RISING when the canopy
// is added is that inversion measured.
//
// THE LAW. A crown surface the eye can see is lit only if the ray from the sun
// to it missed every crown above it. For randomly placed crowns of plan-area
// index `mu` the sun-path transmittance at solar elevation `sunElev` is
// Beer-Lambert on the SUN ray exactly as `ofTreeCover` is Beer-Lambert on the
// VIEW ray, so the fraction of the canopy's own irradiance that survives is
//
//     S = FLOOR + (1 - FLOOR) * exp(-K * mu / sin(sunElev))
//
// and the canopy is painted at `tone * S`. Low sun means a long path through
// the crowns and a dark wood; high sun means the shortest path and the least
// darkening; below the horizon the exponential has saturated and S is the floor.
// Nothing switches, nothing is scaled by hand and there is no time-of-day table.
//
// TWO PROPERTIES THAT ARE NOT TUNED AND ARE THE WHOLE REASON THIS COMPOSES:
//
//  1. IT TAKES THE FULL `mu`, NOT THE `(1 - w)` COMPLEMENT the view term takes.
//     That difference is physical and it is the near/far agreement in one line.
//     `ofTreeCover` paints the canopy the INSTANCES ARE MISSING, so it takes
//     the density they are missing. A crown's SHADOW, though, is cast by every
//     crown above it whether that crown is a card or a painted one -- the sun
//     does not know which tier drew it. So both halves take the same full local
//     index and arrive at the same S.
//  2. IT IS A COMMON MULTIPLIER ON BOTH ARMS OF AN ALREADY-MATCHED HANDOVER,
//     so it CANNOT open a seam. 2.18.4 proved the card cover and the painted
//     cover are exactly complementary at every radius; multiplying both by the
//     same S leaves that identity untouched and simply scales the composite.
//     THERE IS NO SECOND FADE CONSTANT IN THIS LANE EITHER, and this time it is
//     not even an identity that has to be derived -- there is no new boundary
//     at all, because the boundary is the one 2.18 already owns.
//
// WHERE IT IS APPLIED, AND WHY THE SAME PLACE ON BOTH SIDES. On the ALBEDO,
// both times: the terrain scales `uTreelineTone` inside the treeline block, and
// the canopy card's shared batch material has its `color` scaled per frame.
// Applying it to the terrain's `shadow` instead was the first design and is
// better physics -- the material's own ambient would then supply the floor for
// free, at the right colour, at every hour -- but it cannot be mirrored on the
// card: a stock `MeshStandardMaterial` in three r185 exposes no shadow factor
// to a splice at all (PropSkyAmbient.ts's own note, which is why `TRANS` still
// carries a hard-coded 0.35). One law applied in one place on both sides beats
// better physics applied in two different places, because the thing this lane
// must not do is let the near stand and the far treeline disagree.
//
// WHAT THAT COSTS, STATED: a self-shadowed crown keeps its hue instead of
// drifting toward the sky's, and the FLOOR below has to be a constant rather
// than falling out of the light model. Both are owed, both are named in 2.19.

import type * as THREE from 'three';
import { BIOME_CANOPY_MU, residentCanopyMu } from '../geometry/ChunkCanopy.js';

/**
 * `K`: the conversion from the crown PLAN-AREA index this game can compute to
 * the LEAF-AREA optical depth Beer-Lambert actually runs on.
 *
 * THE FIRST VERSION OF THIS CONSTANT WAS 1.5 AND IT WAS UNDER-ARGUED, which is
 * recorded rather than quietly replaced: it was reasoned up from 1 by two
 * geometric corrections (a crown is a spheroid, so its silhouette exceeds its
 * plan area at a slant; the density table lists one tier and has no understorey
 * in it) and then landed by eye. Both corrections are real and neither is the
 * main term.
 *
 * THE MAIN TERM IS THAT `mu` COUNTS A CROWN'S SHADOW ONCE AND A CROWN IS FULL
 * OF LEAVES. Canopy radiative transfer is Beer-Lambert on LEAF area, not on
 * crown footprint: the sun-path optical depth at the zenith is `G * LAI`, where
 * `G` is 0.5 for the spherical leaf-angle distribution that is the standard
 * assumption for a mixed stand. A closed temperate forest carries an LAI of
 * about 5 to 7. `ChunkCanopy.BIOME_CANOPY_MU` gives this game's Forest
 * `mu` = 1.013983, so
 *
 *     K = G * LAI / mu = 0.5 * LAI / 1.013983
 *
 * which is 2.47 at LAI 5, 2.96 at LAI 6 and 3.45 at LAI 7. K IS THEREFORE
 * BETWEEN ABOUT 2.5 AND 3.5 ON THE PHYSICS ALONE, and 1.5 was not merely
 * under-argued, it was below the range.
 *
 * 3.2 IS CHOSEN INSIDE THAT BAND BY EYE AGAINST THE PASS CONDITION, and this
 * is the measurement that picked it (`forestairnoon`, the Forest site at its
 * own local noon, dot 0.736; `box` luma against the same rectangle in the
 * `?canopy=0` arm, which reads 103.22 -- the clearing):
 *
 *   | K   | LAI  | box    | wood - clearing |
 *   |-----|------|--------|-----------------|
 *   | off |  --  | 117.16 |        +13.94   |  the inversion, measured
 *   | 1.5 | 3.04 | 107.32 |         +4.10   |  below the physical band
 *   | 2.5 | 5.07 | 104.28 |         +1.06   |
 *   | 2.7 | 5.47 | 103.85 |         +0.63   |
 *   | 3.0 | 6.08 | 103.27 |         +0.05   |  dead flat
 *   | 3.2 | 6.49 | 102.92 |         -0.30   |  the photo-correct sign
 *   | 4.0 | 8.11 | 101.80 |         -1.42   |  past the band
 *
 * THE MARGIN AT LOCAL NOON IS THIN AND IS REPORTED AS THIN. It is -0.30 counts
 * and not -5, and the reason is worth having rather than hiding: past about
 * K = 3 the closed-stand paint has ALREADY reached `CROWN_SELF_FLOOR` (the
 * exponential is 0.016 at K = 3.2), so raising K further stops darkening a
 * closed wood at all and only reaches into the thin margins. The high-sun end
 * of this term is FLOOR-limited, not K-limited, and the floor is not a knob
 * this lane is willing to drive below its own derivation to win margin. The
 * low-sun end has no such problem: every arm there is saturated and the
 * relation is -6 counts and unambiguous.
 *
 * Swept with `?crownshadek=`.
 */
export const CROWN_SELF_K = 3.2;

/**
 * `FLOOR`: what a fully self-shadowed crown surface keeps.
 *
 * A crown deep inside a closed canopy is not black. It is lit by the sky it can
 * still see and by light scattered off its neighbours, and this is that share.
 * It is an authored constant BECAUSE of the apply-point chosen in the header --
 * on an albedo, the light model cannot supply it -- and it is authored against
 * that model rather than picked:
 *
 *   TerrainAmbient's own noon numbers are `AMBIENT_NOON` (0.048, 0.058, 0.084),
 *   luma 0.0577, plus `TERRAIN_SKY_AMBIENT` 0.88 on a sky irradiance the A4
 *   probe reads at (0.1152, 0.1639, 0.2435) at a dot-0.92 sun, luma 0.140.
 *   Against a direct term of `SUN_IRR` 1.45 x ndl x sunT, about 1.23 at that
 *   hour, the AMBIENT SHARE of a flat fragment's irradiance is 0.195 / 1.42 =
 *   0.137. A canopy interior does not see the whole sky, and half of it is the
 *   honest reduction, so 0.08 is that share times a canopy sky-view factor of
 *   about 0.55.
 *
 * NOT DERIVED IN CODE, and deliberately not: reading it live out of the light
 * model would be a fourth authority over an expression that already has three
 * (the terrain material, SkyAtmosphere's ground shell and the prop splice), and
 * the number it produced would still be multiplied by a guessed sky-view
 * factor. It is one authored constant with its arithmetic written down, and it
 * has a sweep: `?crownshadefloor=`.
 */
export const CROWN_SELF_FLOOR = 0.08;

/**
 * The floor under `sin(sunElev)`.
 *
 * TerrainTreeline.TREE_SIN_MIN's argument, on the other ray: it exists only to
 * keep `exp(-K mu / sinSun)` finite, and its VALUE cannot matter, because at
 * `sinSun` = 0.02 the exponent for even Mountains' 0.0198 index is 1.5 and for
 * Forest's 1.014 it is 76, i.e. the term has saturated to the floor long before
 * the floor binds. It is written here rather than imported from TerrainTreeline
 * so that this module has no cycle back into the term that consumes it; the two
 * are the same number for the same reason and neither reads the other.
 *
 * It is also what makes NIGHT correct with no branch: below the horizon
 * `sinSun` is negative, the max clamps it, and every canopy in the world sits
 * at the floor -- which is what a wood at night is.
 */
export const CROWN_SUN_MIN = 0.02;

/** Default amplitude. `?crownshade=0` is the exact pre-RN-2275 frame. */
export const CROWN_SELF_AMP = 1;

/**
 * `(amp, K, floor)`, the one packing both halves read.
 *
 * THIS IS THE ANSWER TO "IS THERE A SECOND COPY OF K". There is not: the vector
 * built here is uploaded to the terrain as `uCrownShade` AND passed to
 * `crownSelfShade` by the card updater below, so the shader and the CPU are
 * reading the same three floats out of the same object. That is stronger than
 * `assertTreelineMatchesScatter`'s mirror-and-throw, which exists because
 * `canopyDistanceWeight` genuinely could not be shared; these can be, so they
 * are, and no assertion is needed for the part that cannot drift.
 *
 * What CAN still drift is the FORMULA, one written in GLSL and one in
 * TypeScript. That is what `canopySelfNow()`'s read-back is for: it publishes
 * the card's inputs and its applied output, so a probe recomputes the law
 * independently and compares. See rendering.md 2.19.5.
 */
export function crownShadeFromQuery(): [number, number, number] {
  const p = new URLSearchParams(self.location.search);
  const num = (key: string, fallback: number): number => {
    const raw = p.get(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    // RN-150's dead-default guard: a registered parameter that cannot move the
    // picture is worse than a missing one.
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const amp = p.get('crownshade') === '0' ? 0 : num('crownshadeamp', CROWN_SELF_AMP);
  return [amp, num('crownshadek', CROWN_SELF_K), num('crownshadefloor', CROWN_SELF_FLOOR)];
}

/**
 * THE TWO HALVES GET THEIR OWN EXACT CONTROLS AS WELL AS A SHARED ONE, and
 * that is standing rule 7 rather than a convenience. `?crownshade=0` restores
 * the pre-lane frame, which is what the rule literally asks for; but this term
 * is the FIRST in the project applied to two different subsystems by two
 * different mechanisms, so "did the far paint move the number or did the near
 * cards" is a question the shared flag cannot answer. It came up within an hour
 * of the term existing: `forestair`'s handover pair showed a residual and there
 * was no experiment that could say which half owned it.
 *
 * `?crownshadefar=0` leaves the cards darkened and restores the terrain paint;
 * `?crownshadecard=0` does the opposite. Both multiply the SAME amp, so the
 * pair cannot disagree with the shared flag about what "off" means.
 */
const HALF = ((): [number, number] => {
  const p = new URLSearchParams(self.location.search);
  return [p.get('crownshadefar') === '0' ? 0 : 1,
    p.get('crownshadecard') === '0' ? 0 : 1];
})();

/**
 * THE LAW, in TypeScript. `ofCrownSelfShade` below is the same three lines in
 * GLSL, and both take their constants from the vector above rather than from a
 * literal of their own.
 *
 * `mu` is the LOCAL canopy area index (the terrain's per-vertex `vCanopy`; the
 * biome's closed-stand index for a card -- see `updateCanopyCardShade`), and
 * `sinSun` is `dot(sunDir, localUp)`.
 */
export function crownSelfShade(
  mu: number, sinSun: number, p: readonly [number, number, number],
): number {
  const t = Math.exp(-p[1] * mu / Math.max(sinSun, CROWN_SUN_MIN));
  const s = p[2] + (1 - p[2]) * t;
  return 1 + (s - 1) * p[0];
}

/**
 * The GLSL half, spliced into the terrain's treeline pars. Every number in it
 * is interpolated from an export of this file, so there is no second copy of
 * any of them, and the two branch-free lines are `crownSelfShade` above
 * character for character in the other language.
 */
export const CROWN_SELF_GLSL = /* glsl */`
  #define OF_CROWN_SUN_MIN ${CROWN_SUN_MIN.toFixed(5)}

  // RN-2275. INTER-CROWN SELF-SHADOWING. See CanopySelfShadow.ts for the law,
  // for why this takes the FULL mu while ofTreeCover takes the (1 - w)
  // complement, and for why a common multiplier on both arms of 2.18.4's
  // handover cannot open a seam.
  //
  // p is uCrownShade = (amp, K, floor). amp 0 returns exactly 1.0, which is
  // what makes ?crownshade=0 the pre-lane frame rather than an argument that
  // it is.
  float ofCrownSelfShade(float mu, float sinSun, vec3 p) {
    float t = exp(-p.y * mu / max(sinSun, OF_CROWN_SUN_MIN));
    return mix(1.0, p.z + (1.0 - p.z) * t, p.x);
  }
`;

/**
 * THE CARD HALF.
 *
 * The canopy impostor's batch material is ONE shared `MeshStandardMaterial`
 * (`PropLibrary.batchFor` clones one per batch key) and `OF_Canopy` is authored
 * at `_LOD3` ALONE (RN-2247), so scaling that one material's colour reaches
 * every far card and CANNOT reach a near tree. That is the near-forest guard
 * arriving structurally rather than as a distance test somebody has to keep in
 * step with the terrain's: the near forest interior is `OF_Leaf` geometry lit
 * by the real sun and the real cascades, and this module cannot see it.
 *
 * `base` is the material's finalised, self-shadow-free colour, captured by
 * `publishCanopyCardBase` from `SurfaceBind.apply` in the same statement pair
 * that publishes the terrain's tone -- i.e. AFTER the `albedo_mean_linear`
 * divide and after `applyFoliageTone`, and re-captured if SurfaceBind re-runs
 * on a late texture load. The per-frame write is therefore idempotent: it is
 * always `base * S`, never an accumulating multiply.
 */
const card: {
  live: THREE.Color | null; base: { r: number; g: number; b: number };
  mu: number; sinSun: number; shade: number;
} = { live: null, base: { r: 0, g: 0, b: 0 }, mu: 0, sinSun: 0, shade: 1 };

/** The one live `(amp, K, floor)`. The terrain uniform takes it with the FAR
 *  half's isolator folded into the amp; the card updater takes it with the
 *  NEAR half's. Neither halves' isolator can reach the other's numbers. */
const BASE_SHADE = crownShadeFromQuery();
export const SHADE: [number, number, number] =
  [BASE_SHADE[0] * HALF[0], BASE_SHADE[1], BASE_SHADE[2]];
export const SHADE_CARD: [number, number, number] =
  [BASE_SHADE[0] * HALF[1], BASE_SHADE[1], BASE_SHADE[2]];

/** Called by SurfaceBind when the `canopy` family's material is finalised. */
export function publishCanopyCardBase(c: THREE.Color): void {
  card.live = c;
  card.base = { r: c.r, g: c.g, b: c.b };
}

/**
 * Per frame, from `Systems` beside the line that pushes the treeline's reach.
 *
 * `biome` is the /core classifier's answer at the observer's own up vector --
 * the SAME call `SkyIbl` already makes on that line, reused rather than made
 * twice -- and `sinSun` is `sky.elevation(up)`, the SAME number the starlight
 * floor, the tone drive and the IBL all ride. One hour, read once.
 *
 * THE `mu` IS `ChunkCanopy.residentCanopyMu()` AND NOT THE BIOME'S CLOSED-STAND
 * INDEX, and that swap was forced by a measurement rather than chosen. The
 * closed-stand value was the first design, on the argument that a card is by
 * definition inside a stand. It is -- but the PAINT behind that card at the
 * same pixel uses `mu_biome * canopyWeight` at that point, and a Forest frame's
 * `canopyWeight` averages well below 1, so the cards came out about 40 per cent
 * darker than the ground they hand over to and `forestair`'s boundary pair
 * caught it (the step went from 0.42 below the bare gradient to 3.67 above it).
 * `residentCanopyMu` is the canopy-area-weighted mean of the SAME field the
 * paint reads, accumulated in the same loop that uploads it, so the two halves
 * are estimating one world. See that function's note for why the weighting is
 * `sum(mu^2)/sum(mu)` and not a plain mean.
 *
 * The biome index is still read, for one job: a biome that places no canopy at
 * all (Ocean, Beach, Polar, all three lunar) must return exactly 1 whatever the
 * resident field says, because the resident field can still be carrying a
 * forest the camera has just flown off.
 *
 * STATED LIMIT: the card factor is ONE number for the whole frame while the
 * paint's varies per vertex, so a card in an unusually dense pocket is lit by
 * the neighbourhood's average rather than its own. Bounded, signed, measured at
 * the handover, and routed as owed.
 */
export function updateCanopyCardShade(biome: number, sinSun: number): void {
  const mu = (BIOME_CANOPY_MU[biome] ?? 0) > 0 ? residentCanopyMu() : 0;
  const s = crownSelfShade(mu, sinSun, SHADE_CARD);
  card.mu = mu;
  card.sinSun = sinSun;
  card.shade = s;
  if (card.live !== null) {
    card.live.setRGB(card.base.r * s, card.base.g * s, card.base.b * s);
  }
}

/**
 * For the probe, and it exists for 2.18.5's failure mode one term over: a term
 * whose one half is applied by writing into ANOTHER subsystem's material has a
 * failure mode -- the registration never fires -- that is invisible in a frame,
 * because an un-darkened card is still a card. `live` false means the canopy
 * batch has not been bound yet and the near half of this term is absent.
 *
 * It publishes the INPUTS as well as the output so a probe can recompute the
 * law from `amp` / `k` / `floor` / `mu` / `sinSun` and compare against `shade`,
 * which is the check that the GLSL and the TypeScript are still the same three
 * lines.
 */
export function canopySelfNow(): {
  amp: number; k: number; floor: number;
  cardMu: number; sinSun: number; cardShade: number; live: boolean;
} {
  return {
    amp: SHADE_CARD[0], k: SHADE_CARD[1], floor: SHADE_CARD[2],
    cardMu: card.mu, sinSun: card.sinSun, cardShade: card.shade,
    live: card.live !== null,
  };
}
