// RN-2275 to RN-2279. INTER-CROWN SELF-SHADOWING: the one law, held in one
// place, applied to BOTH halves of the canopy.
//
// RN-2525 to RN-2539 (2026-08-21, lane N6, `lane/n6-crownshade`). THE LAW
// ABOVE STAYS AN ACHROMATIC SCALAR, and that is deliberate: rendering.md
// 2.31.5 found that scalar multiplied onto the finalised, already-coloured
// canopy tone, which is the defect. A crown deep in its own shadow does not
// dim toward black; chlorophyll absorbs red and blue far more strongly than
// green, so a shaded crown reddens toward NOTHING and greens toward its own
// saturated hue. `crownSpectralSplit` below takes the scalar `S` this law
// already produces and splits it into a per-channel triple derived from the
// SAME leaf optics FoliageTone.ts's `canopy` row documents, with the
// Rec.709-weighted mean of that triple PINNED at `S` by construction -- see
// that function's own header for the algebra. `?crownspectral=0` restores
// today's achromatic shade exactly (three channels, one scalar), registered
// in the commit that introduces it (RN-152's scar).
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
 * `?canopy=0` arm, which reads 103.22 -- the clearing).
 *
 * **THE PASS CONDITION THIS TABLE WAS JUDGED AGAINST NO LONGER EXISTS, AND THE
 * TABLE IS KEPT AS THE HISTORY OF A DECISION RATHER THAN AS A LIVE GUARD**
 * (RN-2570, discharging rendering.md 2.35.9 item 5, which routed this
 * correction to the lane that owns this file). Two things changed under it.
 * FIRST, the "wood - clearing" column is a SIGN TEST on 8-bit `box` luma, and
 * RN-2550 replaced that with a two-sided, LINEARIZED, coverage-corrected ratio
 * band -- and found, while doing so, that the sign test **was never asserted
 * anywhere in the project**: `rn2275sweep.mjs` prints and exits 0 whatever it
 * reads, and no link in `npm run check` renders these poses. The live
 * instrument is `web/tools/smoke/rn2550guard.mjs`, which is the first one here
 * that can fail. SECOND, the numbers themselves are pre-`lane/wg-ship`: that
 * merge moved the planet height field and took this pose's `box` clearing up
 * 16.2 per cent, so 103.22 describes a planet that no longer exists. Nothing
 * about K's PHYSICAL bracket (2.5 to 3.5, the paragraph above) depends on
 * either change, and K is unmoved. The table below reads:
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
 *
 * ---------------------------------------------------------------------------
 * RN-2570. THE ARITHMETIC ABOVE COUNTS ONLY THE SKY, AND THE CANOPY'S OWN
 * SCATTERED LIGHT IS THE TERM IT OMITS. THE VALUE IS NOT MOVED, AND THE REASON
 * IT IS NOT MOVED IS MEASURED RATHER THAN CAUTIOUS.
 *
 * WHAT IS WRONG WITH 0.08. Every source in the derivation above is the SKY:
 * `AMBIENT_NOON`, `TERRAIN_SKY_AMBIENT`, a sky irradiance and a sky-view
 * factor. A crown surface deep in a closed stand is also lit by the light
 * that has already bounced off the crowns around it, and leaves are not
 * black -- `LEAF_ALBEDO_RGB` below is (0.08, 0.27, 0.06), so better than a
 * quarter of every green photon that hits a leaf leaves it again. Omitting
 * that is single-scattering-only, which is the same class of error an
 * atmosphere makes when it drops multiple scattering.
 *
 * WHAT THE FLOOR WOULD BE IF THE MODEL WERE CLOSED, using only quantities
 * this repository already holds and no new one. At high sun in a closed stand
 * the exponential has saturated (0.016 at K = 3.2, the K table above), so
 * `S -> FLOOR` and the crown's rendered reflectance is `tone * FLOOR`. The
 * physically correct reflectance of a closed stand is the two-stream
 * semi-infinite canopy albedo `rInf(w) = (1 - sqrt(1 - w)) / (1 + sqrt(1 - w))`
 * -- the SAME function, on the SAME `w` triple, that `FoliageTone.ts`'s
 * `canopy` row already uses to set the crown's HUE, so this is not a new model
 * being introduced, it is the existing one being asked for a level as well as
 * a colour. On `LEAF_ALBEDO_RGB` that is (0.020843, 0.078517, 0.015468),
 * Rec.709 luma **0.061703**; the card's finalised mean rendered albedo, read
 * live off `treeline().tone`, is (0.056296, 0.169931, 0.025901), luma
 * **0.135373**. Equating the two:
 *
 *     FLOOR_derived = luma(rInf(w)) / luma(tone) = 0.061703 / 0.135373
 *                   = 0.4558
 *
 * i.e. the shipped floor is **5.7x too small**, which is the same order as
 * N7's independent "the crown's diffuse sits an order of magnitude below the
 * ground's" (rendering.md 2.34.6) arrived at from a completely different
 * direction.
 *
 * AND IT IS NOT SHIPPED, BECAUSE THE FRAME CANNOT ABSORB IT AND THE PROOF IS
 * FOUR MEASURED NUMBERS. The RN-2550 guard bands the coverage-corrected crown
 * reflectance `rho` at 0.18 to 0.75. Measured with the self-shadow removed
 * entirely and the specular removed with it -- which is the LIMIT any floor
 * raise can approach, since `S` cannot exceed 1 -- `rho` reads
 *
 *     0.3925 / 1.9161 / 0.3995 / 3.2474
 *
 * at `forestairnoon` / `forestairlow` / `flyovernoon` / `flyoverlow`. Both
 * LOW-sun poses are already ABOVE the band's 0.75 ceiling before any light is
 * added. So raising this floor walks `forestairnoon` up toward 0.39 and walks
 * `flyoverlow` up toward 3.25 at the same time, and the second leaves the band
 * long before the first enters it. **The band is 4.2x wide and the spread this
 * floor would have to fit inside it is 8.3x.** Measured at a real candidate
 * rather than modelled: at `?crownshadefloor=0.2`, `forestairnoon` is still
 * 0.0335 SHORT of the band's bottom while `flyoverlow` is already 0.3358 OVER
 * its top, and both `box` ratchets fail with it. (An earlier draft also quoted
 * a modelled intermediate, "holding `flyoverlow` at 0.75 caps `forestairnoon`
 * at 0.117"; it is dropped rather than defended. A fresh-context verifier got
 * ~0.105 by two obvious routes, the derivation was never written down, and it
 * UNDERSTATES the infeasibility, so nothing rests on it.)
 *
 * THE 8.3x IS NOT THIS CONSTANT'S FAULT AND CANNOT BE FIXED HERE. It is the
 * crown impostor's SHADING NORMAL: the crown responds to solar elevation quite
 * differently from the horizontal clearing it is divided by, so as the sun
 * drops the denominator collapses further than the numerator does. That is why
 * `rho` reads LIGHTER at low sun than at noon, which is backwards for a canopy.
 *
 * **WHICH NORMAL, CORRECTED 2026-08-22 AFTER A FRESH-CONTEXT VERIFIER.** An
 * earlier draft of this paragraph said the impostor is "drawn as two VERTICAL
 * planes" and so "has a wall's cosine response". The ASSET half is true --
 * `build_props_canopy.py` authors exactly that -- but **those authored normals
 * never reach a draw call**: `PropGeometry.ts:291` runs every `foliage`-bake
 * rung, `OF_Canopy` included, through RN-1766's `bendNormals`, which
 * spherifies the normal attribute in place at registration. The SHIPPED mean
 * `|up|`, recomputed off the `glb` bytes, is **0.4557 to 0.4985, not 0.0000**,
 * and `?foliagenormal=0` (RN-1766's own control, which restores the authored
 * bytes) takes the pose spread from 8.3x to **63.5x**. So the wall-versus-floor
 * picture describes THAT arm and not the shipped frame.
 *
 * The shipped defect is that `bendNormals` DEGENERATES on crossed quads: the
 * base centre it bends away from lies ON both card planes, so the bent normal
 * ends up inside its own card's plane, and the hemisphere sign term then
 * resolves on floating-point residue. Both degeneracies are in rendering.md
 * 2.37.1a and the route is 2.37.7 item 1. Until they are repaired this floor
 * cannot be given its derived value without failing the guard at two poses,
 * and moving it part of the way is tuning rather than physics. **The number
 * stays at 0.08 and the derivation above is the standing statement of what it
 * should be.**
 */
export const CROWN_SELF_FLOOR = 0.08;

/* `CROWN_SELF_FLOOR_DERIVED` computes the 0.4558 above from the leaf optics.
 * It is declared further down, immediately after `LEAF_ALBEDO_RGB`, because it
 * reads that triple and a module-level `const` cannot be read before it is
 * initialised. */

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
 * RN-2570. THE CROWN IMPOSTOR'S ROUGHNESS: A TERM BUILT, MEASURED AT BOTH ENDS
 * AND REFUSED, AND THE REFUSAL IS THE FINDING.
 *
 * READ THIS FIRST, BECAUSE THE SHIPPED BEHAVIOUR IS THE OPPOSITE OF WHAT THIS
 * LANE WAS SENT TO DO. Stage 2's accepted shape (the Admin decision in NUMBERS'
 * RN-2540 row, rendering.md 2.34.10 item 2) was that the crown's radiance raise
 * would travel WITH a canopy roughness fix, because N7 had shown the impostor
 * is a specular reflector it should not be and deleting that specular outright
 * makes the crown darker -- so a roughness correction would PAY for headroom
 * the raise then spends. **Measured, it pays nothing.** Driving this material
 * from its authored 0.800 to the fully-rough limit 1.0 moves the crown card's
 * own specular by **-1.6 per cent at `forestairnoon` and +2.0 per cent at
 * `flyoverlow`** -- the wrong way at the second -- and leaves its diffuse
 * unmoved to four digits (rendering.md 2.37.4). So this file ships **no change
 * to the value** and ships **the switch that was missing**, which is RN-952's
 * rule: a term with no switch is the one candidate no experiment can eliminate.
 *
 * WHY ROUGHNESS CANNOT REACH IT, now that the measurement says so. Roughness
 * moves three's DIRECT lobe hard (the GGX `D` term peaks as `1/alpha^2`) and
 * its INDIRECT one barely at all: the split-sum environment BRDF for a
 * dielectric at `F0 = 0.04` is nearly flat in roughness. In three 0.185.1 that
 * term is a SAMPLED table, `texture2D(dfgLUT, vec2(roughness, dotNV))` in
 * `lights_physical_pars_fragment.glsl.js` (lines 377 and 396), not the
 * analytic `DFGApprox` an earlier draft of this comment named; the reference
 * is corrected and the conclusion is unchanged, since it rests on the measured
 * arms below rather than on which implementation supplies the term. The crown card's
 * specular is therefore almost entirely the sky PMREM lobe, not the sun lobe,
 * which is also why N7 found it 99.7 per cent of the card's own BLUE -- a sun
 * lobe would not be blue. Worse, broadening the lobe at a GRAZING sun smears
 * more sky into the view than a narrow one did, which is exactly the `+2.0 per
 * cent at flyoverlow` above. **The handle that reaches this term is
 * `envMapIntensity`, which has no page parameter anywhere in the project
 * (N7's own note), and it is routed in rendering.md 2.37.7 rather than
 * guessed at here.**
 *
 * WHAT WAS RIGHT ABOUT THE HYPOTHESIS, KEPT, because the geometry argument
 * stands even though the handle does not. `tools/blender/build_props_canopy.py`
 * authors `OF_Canopy` as **two crossed quads over the crown and nothing else**
 * -- its own docstring says exactly that -- yawed per instance, and a GGX lobe
 * on a whole-crown billboard is reflecting the sky off a plane that is a
 * DRAWING CONVENTION for a leaf mass rather than a microfacet distribution.
 *
 * **BUT THE AUTHORED NORMAL IS NOT THE SHIPPED ONE, CORRECTED 2026-08-22 AFTER
 * A FRESH-CONTEXT VERIFIER.** An earlier draft of this paragraph said each quad
 * "carries one flat HORIZONTAL shading normal" and that this makes the crown
 * respond to solar elevation "like a WALL". That is true of the `glb` and false
 * of the frame: `PropGeometry.ts:291` runs every `foliage`-bake rung through
 * RN-1766's `bendNormals`, which spherifies the normal attribute in place at
 * registration, so the SHIPPED mean `|up|` is **0.4557 to 0.4985, not
 * 0.0000**, and `?foliagenormal=0` (which restores the authored bytes) takes
 * the pose spread from 8.3x to **63.5x**. The lane's own best frame,
 * `RN2570_crowns_noshade_3x.png`, shows bright crown tops over dark bottoms --
 * a vertical gradient a flat horizontal normal cannot produce.
 *
 * The 8.3x spread is still the impostor's shading normal and still the reason
 * stage 2's target is unreachable; what is wrong with that normal is TWO
 * DEGENERACIES in `bendNormals` on crossed quads (the base centre lies in both
 * card planes, so the bent normal is in-plane and the hemisphere sign resolves
 * on floating-point residue). Both are named in rendering.md 2.37.1a and
 * routed in 2.37.7 item 1, and the fix belongs in `FoliageNormal.ts` rather
 * than in the asset or in a new shader term. Its roughness, meanwhile, is a
 * closed question.
 *
 * ---------------------------------------------------------------------------
 * The historical derivation that motivated the fully-rough arm, kept because
 * the arm is still reachable and someone will want to know what it meant:
 *
 * WHAT THE MEASUREMENT FOUND. N7 built `?propspec=` because three's
 * `totalSpecular` is the ONE radiance on a stock physical program that is not
 * multiplied by the albedo, and rendering.md 2.34.10 item 2 measured it at
 * **99.7 per cent of the crown card's own BLUE and 76 per cent of its own
 * green**. Re-taken in the guard's own units -- linear-light Rec.709 luminance
 * on the committed `crowns` rectangle, un-hazed, coverage-corrected -- the
 * specular is **78.5 / 85.9 / 58.0 / 86.6 per cent of the crown card's WHOLE
 * radiance** at `forestairnoon` / `forestairlow` / `flyovernoon` / `flyoverlow`
 * (rendering.md 2.37.2). A crown that is four fifths a mirror of the sun and
 * the sky is not a crown, it is a wet leaf the size of a tree.
 *
 * A leaf mass has no coherent plane: its microfacets are ten thousand leaves
 * at every orientation, and "no preferred microfacet direction" is the
 * definition of the fully-rough limit, so 1.0 was the arm to try. The material
 * arrives from the glTF at roughness **0.800** (read live off
 * `Surfaces.surfaceReport()`, never assumed from the asset), which is a
 * defensible number for a LEAF -- a waxy cuticle does have a lobe -- and the
 * wrong number for the assembly of ten thousand of them that one quad stands
 * in for. The argument was sound and the instrument it reaches for is not
 * connected to the term; both halves of that are worth keeping.
 *
 * SCOPE, STRUCTURAL RATHER THAN A DISTANCE TEST, and it is the same argument
 * `updateCanopyCardShade` already makes for the colour write: `OF_Canopy` is
 * authored at `_LOD3` ALONE (RN-2247) and `PropLibrary.batchFor` clones one
 * shared `MeshStandardMaterial` per batch key, so this reaches every far crown
 * card and CANNOT reach a near tree. The near forest interior is `OF_Leaf`
 * geometry wearing the `leaf` family and is untouched.
 *
 * `?canopyrough=1.0` is the refused fully-rough arm; `?canopyrough=` with no
 * flag is the asset's own value and is the shipped frame, unchanged.
 */
export const CANOPY_ROUGHNESS_FULLY_ROUGH = 1.0;

/**
 * The roughness OVERRIDE, or `null` for "leave the asset's own value alone".
 *
 * NULL RATHER THAN A DEFAULT CONSTANT, AND THAT IS THE WHOLE DESIGN. Writing a
 * shipped default here would put a SECOND copy of the glTF's 0.800 in
 * TypeScript, and two copies of one constant is the exact shape RN-2249's
 * palette-hex precedent and MachineMat.ts's scar exist to prevent: the day
 * texgen re-authors the crown material, the asset moves and this file silently
 * overrides it back. Returning `null` means the shipped path writes nothing at
 * all, so this lane is a NO-OP ON THE FRAME BY CONSTRUCTION rather than by a
 * value that happens to match, and the sweep is still reachable.
 *
 * RN-150's dead-default guard still applies to the OVERRIDE: `Number(null)` is
 * 0 and a roughness of 0 is a MIRROR, so an unparseable or out-of-range ask
 * returns `null` (no override) rather than 0, and rather than a silent clamp --
 * a clamped out-of-range ask reports the clamp and the table then describes the
 * clamp as the request, which is RN-2268's scar.
 */
export function canopyRoughnessOverride(): number | null {
  const raw = new URLSearchParams(self.location.search).get('canopyrough');
  if (raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

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
 * RN-2525. THE SPECTRAL SPLIT.
 *
 * `crownSelfShade` above returns one scalar `S`, and both halves multiplied
 * their finalised, ALREADY-COLOURED canopy tone by it. That is the defect
 * rendering.md 2.31.5 measured: `cardShade` 0.1025 at the Forest site, so a
 * crown was painted at a tenth of whatever colour was authored upstream, and
 * a tenth of any colour is dark blue-violet on this engine's own tonemap
 * before it is anything else. An achromatic Beer-Lambert multiply is the
 * wrong spectral model for a leaf mass in the first place: chlorophyll
 * absorbs red and blue light far more strongly than green, so a photon
 * surviving several leaf layers is disproportionately a green one, and a
 * self-shadowed crown should read as a SATURATED DARK GREEN, never a neutral
 * dark grey.
 *
 * THE EXPONENTS ARE A DELIBERATE STYLISATION FOR VISIBLE EFFECT, NOT A
 * PHYSICAL DERIVATION, AND AN EARLIER DRAFT OF THIS COMMENT CLAIMED
 * OTHERWISE. A fresh-context verifier caught it: this file's own leaf optics
 * (FoliageTone.ts's `canopy` row header gives, in LINEAR units, the leaf's
 * REFLECTANCE triple `r` (0.05 red, 0.12 green, 0.04 blue) and single-
 * scattering ALBEDO triple `w` (0.08 red, 0.27 green, 0.06 blue); transmittance
 * `t = w - r` = 0.03 red / 0.15 green / 0.02 blue) were carried through the
 * WRONG relation. Beer-Lambert optical depth is `tau = -ln(T)`, not `1/T`,
 * and this term's shipped exponents are proportional to `1/t_c` rather than
 * to `tau_c`. Carried through the correct relation and normalised to their
 * own geometric mean the same way (`k_c = tau_c / cbrt(tau_r tau_g tau_b)`),
 * the honest Beer-Lambert exponents are **1.183283 red, 0.640180 green,
 * 1.320107 blue** -- and the two-stream extinction FoliageTone.ts's own
 * `rInf(w)` model implies (`k(w) = 2*sqrt(1-w)`, same geometric-mean
 * normalisation) gives **1.035589 red, 0.922476 green, 1.046785 blue**. The
 * DIRECTION both references agree on (green's exponent below one, red and
 * blue's above it) is what the leaf optics support; the MAGNITUDE shipped
 * here is 2.71x more aggressive than Beer-Lambert and about 15x more than
 * two-stream, and that magnitude is an ART CHOICE wearing a physics costume.
 *
 * THE SHIPPED (1/t-proportional) EXPONENTS ARE KEPT ON PURPOSE, MEASURED
 * RATHER THAN ASSUMED. The verifier built, measured and reverted the honest
 * Beer-Lambert alternative: it closes only 40.9 per cent of the `crowns`
 * rectangle's gx shortfall to the clearing (against this file's shipped
 * 65.8 per cent) and buys back only 0.47 counts of RN-2275's tightest guard
 * margin (`forestairnoon`, -1.76 shipped -> -2.23 Beer-Lambert). The eye
 * verdict is already PARTIAL at the STRONGER setting (rendering.md 2.32.7),
 * so weakening it to the physically honest exponents would not flip
 * anything and would only shrink the one number this lane can show for
 * itself. The fix this correction makes is to the LABEL, not the constant:
 *
 *   k_c = cbrt(t_red * t_green * t_blue) / t_c
 *       = 1.493802 red,  0.298760 green,  2.240702 blue   (WAS chosen, not derived)
 *
 * Green's exponent is BELOW one -- a shaded crown's green channel decays
 * SLOWER than the achromatic law it replaces -- and red and blue's are
 * above one and decay faster, which is the whole shape: a crown reddens and
 * blues toward nothing while its green holds, in the DIRECTION the leaf
 * optics support and at a MAGNITUDE this file chose rather than computed.
 *
 * WHAT THE GEOMETRIC-MEAN NORMALISATION ACTUALLY DOES, since "the three
 * exponents' product is 1.000000" is not the check an earlier draft called
 * it -- dividing any three positive numbers by their own geometric mean
 * ALWAYS gives a product of exactly one, by definition, so that identity
 * validates nothing about `t_c` or the physics; it only confirms the
 * division was performed. The non-trivial property is different: `shade_c`
 * below is EXACTLY invariant under an ADDITIVE shift of all three `k_c` by
 * the same constant (`S^{k+d}` factors as `S^d * S^k` in both the numerator
 * and `M`, so the `S^d` cancels), which means WHERE the triple is centred is
 * a free gauge and the geometric-mean choice buys no correctness at all. The
 * SPREAD between the three `k_c` (their differences, not their centre) is
 * the only thing that changes the rendered result, and that spread is set
 * by which underlying quantity (`1/t_c` here, `tau_c` for Beer-Lambert,
 * `2*sqrt(1-w_c)` for two-stream) the exponents are proportional to before
 * any normalisation is applied. The geometric mean is therefore the
 * AGGRESSIVENESS KNOB in one specific, narrower sense: dividing by it fixes
 * the absolute SCALE the spread sits at (order one rather than order ten),
 * and a smaller divisor would have scaled every `k_c` up together and
 * crushed red and blue harder at every `S`. It does not enforce the pin --
 * the pin is enforced unconditionally by the `/ M` in `crownSpectralSplit`
 * below, for ANY three exponents, including ones nobody chose for a reason.
 *
 * THE PIN, STATED PRECISELY, BECAUSE THE IMPRECISE VERSION IS A CLAIM THIS
 * FILE DOES NOT MAKE. Raising `S` to three different powers and averaging the
 * results does NOT reproduce `S`; the fix is the same divide-and-recombine
 * FoliageTone.ts's saturation term uses, generalised from a sum of weights
 * that total one to a RATIO that cancels exactly:
 *
 *   u_c = S ^ k_c
 *   M   = LUMA_R * u_red + LUMA_G * u_green + LUMA_B * u_blue
 *   shade_c = S * u_c / M
 *
 * `LUMA_*` is the same Rec.709 triple `applyFoliageTone` reads (0.2126,
 * 0.7152, 0.0722), so `LUMA_R*shade_red + LUMA_G*shade_green +
 * LUMA_B*shade_blue` collapses algebraically to `S * M / M = S` FOR EVERY
 * VALUE OF S -- not measured, not swept, an identity, and CONFIRMED live at
 * the Forest site (`forestairnoon`): `cardShadeRGB` (0.014397, 0.171380,
 * 0.003062) against `cardShade` 0.125853, and 0.2126*0.014397 +
 * 0.7152*0.171380 + 0.0722*0.003062 = 0.125853 to the digit.
 *
 * WHAT THIS DOES NOT CLAIM, and an earlier draft of this comment did: it is
 * NOT true that the rendered PIXEL's luma is unchanged, because the pin is on
 * the SHADE TRIPLE's own weighted mean, not on `base_c * shade_c`'s. A crown's
 * base colour is not neutral (green is its largest channel), and green is the
 * channel this term attenuates LEAST, so the rendered luma runs slightly
 * BRIGHTER than the achromatic law's own prediction: measured at the same
 * site, `base . shadeRGB` luma is 0.02101 against `base_luma * S` = 0.01704,
 * about +0.004 linear. What the pin actually buys is that this drift is
 * SMALL and bounded (the achromatic law's own calibration is never lost
 * wholesale), not that it is zero. RN-2275's four clearing/wood pairs were
 * RE-MEASURED on this build rather than assumed protected by algebra alone,
 * and they hold with margin (rendering.md 2.32): the shipped-versus-
 * `?crownspectral=0` shift is +0.2 to +1.0 luma counts at each of the four
 * sites, always in the direction that makes the wood LIGHTER, and none of the
 * four margins (which run 1.76 to 7.31 counts) comes remotely close to
 * closing. **THOSE FOUR MARGINS ARE THE RETIRED SIGN TEST'S AND ARE QUOTED
 * HERE AS THE EVIDENCE THAT SATISFIED IT, NOT AS A LIVE GUARD** (RN-2570, the
 * same correction as the K table above, discharging rendering.md 2.35.9 item
 * 5). The relation is now a two-sided ratio band on coverage-corrected
 * `crowns` rho with a separate ratchet on `box`, and the live pins are
 * `rn2550guard.mjs`'s `BASE` table, not any number in this file.
 *
 * `S` is bounded below by `CROWN_SELF_FLOOR` (0.08), so `S` is never
 * zero and `M` cannot vanish; at `S = 1` (no shading at all) every `u_c` is
 * 1, `M` is 1, and `shade_c` is 1 for all three channels, i.e. the identity
 * multiply an unshaded crown always had.
 *
 * `?crownspectral=0` sets every `k_c` to 1: `u_c = S` for all three
 * channels, `M = S * (LUMA_R + LUMA_G + LUMA_B) = S` (the weights sum to
 * one), and `shade_c = S * S / S = S` -- the exact pre-lane achromatic
 * frame, algebraically and not by a second code path.
 *
 * OWED: THE LEAF OPTICS ARE DUPLICATED, NOT SHARED. `r` and `w` below are
 * hand-typed literals; FoliageTone.ts carries the SAME two triples only in
 * PROSE (its `canopy` row's own docstring), not as an exported constant a
 * second file could import. Two files independently typing the same four
 * numbers is exactly the shape RN-2249's palette-hex precedent exists to
 * avoid ("an identical hex makes the frame's mean green provably unmoved"),
 * and it did not bite this lane only because nobody has yet changed one
 * copy without the other. Routed rather than fixed here: exporting
 * `LEAF_REFLECT_RGB`/`LEAF_ALBEDO_RGB` (or their FoliageTone.ts source) from
 * one file and importing it in the other is a consolidation, not a colour
 * change, and this lane's own scope was the shade, not the optics table.
 */
const LEAF_REFLECT_RGB: readonly [number, number, number] = [0.05, 0.12, 0.04];
const LEAF_ALBEDO_RGB: readonly [number, number, number] = [0.08, 0.27, 0.06];
const LEAF_TRANS_RGB: readonly [number, number, number] = [
  LEAF_ALBEDO_RGB[0] - LEAF_REFLECT_RGB[0],
  LEAF_ALBEDO_RGB[1] - LEAF_REFLECT_RGB[1],
  LEAF_ALBEDO_RGB[2] - LEAF_REFLECT_RGB[2],
];
const CROWN_SPECTRAL_K_PHYSICAL: readonly [number, number, number] = ((): [number, number, number] => {
  const t = LEAF_TRANS_RGB;
  const geo = Math.cbrt(t[0] * t[1] * t[2]);
  return [geo / t[0], geo / t[1], geo / t[2]];
})();

/** Rec.709 luma weights, the same triple `FoliageTone.applyFoliageTone` reads. */
const CROWN_LUMA_W: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/**
 * RN-2570. The card's finalised MEAN RENDERED albedo, Rec.709 luma.
 *
 * PINNED HERE RATHER THAN READ, and the reason is a cycle rather than a
 * preference: the live value is `publishCanopyTone`'s, written by
 * `SurfaceBind.apply` when the `canopy` family's material is finalised, and
 * `SurfaceBind` already imports THIS module. Reading it back at module scope
 * would be a cycle and reading it at call time would make a DERIVATION depend
 * on load order. It is therefore a pinned reading with its provenance:
 * `treeline().tone` = (0.056296, 0.169931, 0.025901) on the RN-2570 build,
 * which is 0.2126*0.056296 + 0.7152*0.169931 + 0.0722*0.025901 = 0.135373 --
 * and that is the same 0.13537 this file's own header quotes from RN-2275,
 * unmoved across RN-2495 because `FoliageTone`'s saturation term is EXACTLY
 * luma-preserving (its weights sum to one). Only `val`, which no lane has
 * touched since RN-345, can move it.
 */
const CANOPY_TONE_LUMA = 0.135373;

/**
 * RN-2570. The floor the leaf optics ask for, exported so the claim in
 * `CROWN_SELF_FLOOR`'s header is a value a probe can READ rather than a number
 * in a comment. That distinction is not pedantry here: rendering.md 2.35.2
 * records that RN-2275's whole guard lived for four lanes as prose in this
 * file's own K table, and four lanes budgeted against it.
 *
 * DERIVED, not authored: the two-stream semi-infinite canopy albedo `rInf` on
 * `LEAF_ALBEDO_RGB`, Rec.709-weighted, over the card's own tone luma. Every
 * input is already in this repository and none of them is new.
 *
 * DELIBERATELY NOT WIRED INTO `crownShadeFromQuery`. `CROWN_SELF_FLOOR`'s
 * header measures why: at this value the RN-2550 band fails at `flyoverlow`
 * (rho -> 0.95) while `forestairnoon` is still short of 0.18, because the
 * crossed-quad impostor's wall-shaped cosine response spreads the four poses
 * 8.3x across a band that is 4.2x wide. `?crownshadefloor=0.4558` reaches it
 * for anyone who wants to look at the frame it makes.
 */
export const CROWN_SELF_FLOOR_DERIVED: number = ((): number => {
  const rInf = (x: number): number => {
    const s = Math.sqrt(1 - x);
    return (1 - s) / (1 + s);
  };
  const y = CROWN_LUMA_W[0] * rInf(LEAF_ALBEDO_RGB[0])
    + CROWN_LUMA_W[1] * rInf(LEAF_ALBEDO_RGB[1])
    + CROWN_LUMA_W[2] * rInf(LEAF_ALBEDO_RGB[2]);
  return y / CANOPY_TONE_LUMA;
})();

/** `?crownspectral=0` is the exact pre-lane achromatic frame; see the header
 *  above for why `k_c = 1` degenerates to it algebraically. */
const SPECTRAL_ON = new URLSearchParams(self.location.search).get('crownspectral') !== '0';
export const CROWN_SPECTRAL_K: readonly [number, number, number] =
  SPECTRAL_ON ? CROWN_SPECTRAL_K_PHYSICAL : [1, 1, 1];

/**
 * Splits the achromatic law's own `S` into the per-channel triple. Called by
 * `updateCanopyCardShade` for the near half and interpolated as GLSL
 * (`CROWN_SPECTRAL_GLSL` below) for the far paint -- ONE derivation, taken
 * through both halves via the same seam `crownSelfShade` already used.
 */
export function crownSpectralSplit(s: number): readonly [number, number, number] {
  const k = CROWN_SPECTRAL_K;
  const uR = s ** k[0];
  const uG = s ** k[1];
  const uB = s ** k[2];
  const m = CROWN_LUMA_W[0] * uR + CROWN_LUMA_W[1] * uG + CROWN_LUMA_W[2] * uB;
  return [s * uR / m, s * uG / m, s * uB / m];
}

/**
 * The GLSL half of `crownSpectralSplit`, spliced beside `CROWN_SELF_GLSL`
 * (`TerrainTreeline.glsl.ts` splices both). Every constant is interpolated
 * from this module's own exports, so there is no second copy of any of them,
 * and the body is `crownSpectralSplit` above character for character in the
 * other language.
 */
export const CROWN_SPECTRAL_GLSL = /* glsl */`
  #define OF_CROWN_KR ${CROWN_SPECTRAL_K[0].toFixed(6)}
  #define OF_CROWN_KG ${CROWN_SPECTRAL_K[1].toFixed(6)}
  #define OF_CROWN_KB ${CROWN_SPECTRAL_K[2].toFixed(6)}
  #define OF_CROWN_LUMA_R ${CROWN_LUMA_W[0].toFixed(4)}
  #define OF_CROWN_LUMA_G ${CROWN_LUMA_W[1].toFixed(4)}
  #define OF_CROWN_LUMA_B ${CROWN_LUMA_W[2].toFixed(4)}

  // RN-2525. THE SPECTRAL SPLIT. See CanopySelfShadow.ts for the derivation
  // of OF_CROWN_K* from FoliageTone.ts's leaf optics and for why the
  // Rec.709-weighted mean of the return value is s for every s, which is
  // what keeps RN-2275's four clearing/wood pairs judged on an unchanged luma.
  vec3 ofCrownSpectralSplit(float s) {
    float uR = pow(s, OF_CROWN_KR);
    float uG = pow(s, OF_CROWN_KG);
    float uB = pow(s, OF_CROWN_KB);
    float m = OF_CROWN_LUMA_R * uR + OF_CROWN_LUMA_G * uG + OF_CROWN_LUMA_B * uB;
    return vec3(s * uR, s * uG, s * uB) / m;
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
  shadeRGB: readonly [number, number, number];
} = {
  live: null, base: { r: 0, g: 0, b: 0 }, mu: 0, sinSun: 0, shade: 1,
  shadeRGB: [1, 1, 1],
};

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
 *
 * RN-2525. `s` -- the achromatic law's own scalar -- is still computed and
 * still published as `card.shade` UNCHANGED, so a probe recomputing the law
 * from `amp`/`k`/`floor`/`mu`/`sinSun` still finds the same number it always
 * did: nothing about `crownSelfShade` moved. What changed is what gets
 * MULTIPLIED onto the card's colour -- `crownSpectralSplit(s)`'s per-channel
 * triple in place of `s` three times over -- which is the near half of the
 * one seam this lane took through (the far half is `TerrainTreeline.glsl.ts`,
 * spliced with the same `ofCrownSpectralSplit`).
 */
export function updateCanopyCardShade(biome: number, sinSun: number): void {
  const mu = (BIOME_CANOPY_MU[biome] ?? 0) > 0 ? residentCanopyMu() : 0;
  const s = crownSelfShade(mu, sinSun, SHADE_CARD);
  const rgb = crownSpectralSplit(s);
  card.mu = mu;
  card.sinSun = sinSun;
  card.shade = s;
  card.shadeRGB = rgb;
  if (card.live !== null) {
    card.live.setRGB(card.base.r * rgb[0], card.base.g * rgb[1], card.base.b * rgb[2]);
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
 * lines. RN-2525 adds `cardShadeRGB` (the triple actually multiplied onto the
 * card) and `spectral` (whether `?crownspectral=0` degenerated it back to
 * `[cardShade, cardShade, cardShade]`), so a probe can check the split as well
 * as the law: `LUMA . cardShadeRGB` must equal `cardShade` to within float
 * error for EVERY frame, spectral on or off, which is the pin's own identity.
 */
export function canopySelfNow(): {
  amp: number; k: number; floor: number;
  cardMu: number; sinSun: number; cardShade: number; live: boolean;
  cardShadeRGB: readonly [number, number, number]; spectral: boolean;
  /** RN-2570. The roughness OVERRIDE this module asked `SurfaceBind` to write
   *  (`null` on the shipped path, where the asset's own value stands), and the
   *  floor the leaf optics ask for and this lane declined to write.
   *  `roughOverride` beside `surfaceReport()`'s own `roughness` is the
   *  non-vacuity pair RN-2268 requires: this is the REQUEST, that is the
   *  OUTCOME, and a probe seeing them agree knows the flag reached the
   *  material instead of reporting the default back at itself. A `null` here
   *  with `roughness` at the asset's 0.800 is the shipped frame proving it is
   *  the shipped frame. `floorDerived` is published for the same reason
   *  `CROWN_SELF_FLOOR_DERIVED` is exported at all -- so the claim that the
   *  shipped floor is 5.7x too small is a reading rather than a sentence. */
  roughOverride: number | null; floorDerived: number;
} {
  return {
    amp: SHADE_CARD[0], k: SHADE_CARD[1], floor: SHADE_CARD[2],
    cardMu: card.mu, sinSun: card.sinSun, cardShade: card.shade,
    live: card.live !== null,
    cardShadeRGB: card.shadeRGB, spectral: SPECTRAL_ON,
    roughOverride: canopyRoughnessOverride(),
    floorDerived: CROWN_SELF_FLOOR_DERIVED,
  };
}
