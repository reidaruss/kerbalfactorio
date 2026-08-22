// RN-2265 to RN-2269. THE FAR TREELINE: the terrain material's answer to
// "where the instance tier stops, the ground must still be a landscape".
//
// THE DEFECT, stated as the crown-asset verifier stated it. The canopy impostor
// tier reaches `canopyReachM(radius, altM)` -- 3,500 m from the 1,200 m aerial
// pose, 1,400 m from a standing eye -- and from 1,200 m the horizon is 37,947 m
// away (sqrt(2 R h) at Forge's R = 6e5). So 91 per cent of the ground in an
// aerial frame is past every tree in the world, and it reads as the bare biome
// palette however dense world-gen's tables get. Instances can never carry that
// and should not: RN-2230 refused depth 7 for placement quantisation and
// RN-2260 had to double one pool to hold 78,000 trees over a 3.5 km disc alone.
//
// THE FIX IS A MATERIAL READ, and it has three parts, each with one owner:
//   1. WHERE. `ChunkCanopy.fillCanopyIndex` evaluates world-gen's OWN
//      `canopyWeight(altM, standAt, groveAt)` at every terrain vertex and hands
//      it over as a per-vertex attribute, scaled by the biome's canopy area
//      index. The material's clearings are therefore the instance tier's
//      clearings by construction. (That file's header has the whole argument,
//      including why a GLSL mirror of the field is not writable at all.)
//   2. HOW MUCH. Beer-Lambert on the viewing angle, in TerrainTreeline.glsl.
//   3. WHEN. The handover below, which is not a fade of its own at all: the
//      instance tier's OWN density weight goes into the same Beer-Lambert law,
//      and the material paints the canopy of the density the instances are
//      missing. Exactly one boundary constant, and it is world-gen's --
//      TerrainCoverFar's C4 argument, arriving as an identity rather than as a
//      second curve that has to be kept inverted by hand.
//
// A COARSER FOURTH IMPOSTOR TIER WAS THE OTHER OPTION AND IS REFUSED, with the
// arithmetic rather than a preference. One card per 165 m stand cell out to
// 10 km is pi * 1e8 / 165^2 = 11,500 cards, which is affordable; out to the
// 38 km horizon it is 166,000, which is more than the canopy pool RN-2260 just
// doubled. Worse, it cannot be PLACED: past 5,259 m of eye distance the
// resident terrain is depth 7, a prop is positioned by bilinear interpolation
// inside one mesh cell, and RN-2230 refused that band by name because 230 m of
// quantisation puts a stand on the wrong side of a valley. A material term has
// no such floor, costs no instance and no draw call, and covers the whole
// horizon rather than the first quarter of it.

import type * as THREE from 'three';
import {
  CANOPY_EDGE_W, CANOPY_NEAR_FULL_M, CROWN_M, canopyDistanceWeight,
} from '../../world/ScatterTuning.js';

/** `CANOPY_NEAR_FULL_M`: the outer edge of the harvest ring's wander band. */
export const TREE_NEAR_M = CANOPY_NEAR_FULL_M;
/** `CANOPY_EDGE_W`: the instance gradient's floor at the realised reach. */
export const TREE_EDGE_W = CANOPY_EDGE_W;

/**
 * WG-223's crown scale, 34 m, reused here as the wavelength of the material's
 * MOTTLE. It is the one number in this file that is about texture rather than
 * placement, and that distinction is why it is allowed to be an approximation:
 * the mottle is a value-noise field in the shader (`ofArtVnoise`, the same one
 * the mid-field layer uses) and it is NOT world-gen's `crownAt`. It does not
 * have to be, because there is nothing for it to line up with -- an individual
 * crown at these ranges is one to three pixels and the instance tier has
 * stopped. What it has to be is the RIGHT SIZE, and 34 m is that size,
 * measured: `contracts.json` gives the broadleaf an 8.4 x 10.5 m crown, so a
 * clump of three or four crowns plus its gap is a feature about thirty metres
 * across (world-gen.md 6.9.9's own derivation).
 */
export const TREE_CROWN_M = CROWN_M;

/**
 * Amplitude of that mottle on the canopy albedo, +/- this fraction.
 *
 * 0.22 is the crown card's own contrast read back at the scale this term
 * replaces it at, not a look number: rendering.md 2.17.1 measures
 * `of_canopy_a.png` box-filtered to 3x3 as a 223 / 178 / 113 ramp with a
 * 127-count spread on a 0..255 axis, i.e. about +/- 0.25 about its own mean.
 * The mottle is a THIRD of that per octave because the ramp is a lit-top to
 * shaded-underside gradient on ONE crown and this field is a clump-scale
 * value noise over many, so matching the single-crown contrast would read as
 * curdling rather than as canopy. Swept with `?treelinemottle=`.
 */
export const TREE_MOTTLE = 0.22;

/**
 * The floor under `sin(depression)` in the Beer-Lambert term.
 *
 * 0.02 rad is 1.15 degrees, and it is derived from the pose rather than
 * picked: at Forge's horizon distance from a 1,200 m eye the ground's
 * depression is atan(1200 / 37947) = 1.81 degrees (sin 0.0316), so a floor at
 * 0.02 never binds anywhere the near scene draws ground, and it exists only to
 * keep `exp(-mu / sinDep)` finite on a ray that is exactly tangent to the
 * datum -- which does happen, on the skirt vertices of a horizon chunk. At the
 * floor the exponent for a closed Forest stand is 51, i.e. cover 1.0, which is
 * also the correct answer there.
 */
export const TREE_SIN_MIN = 0.02;

/** Default amplitude. `?treeline=0` is the exact pre-RN-2265 frame. */
export const TREE_AMP = 1.0;

/**
 * THE HANDOVER, and it is the only shape in this lane that had to be MEASURED
 * rather than chosen.
 *
 * The instance tier does not stop at a line. `ScatterTuning
 * .canopyDistanceWeight` ramps a cell's canopy DENSITY from 1 at
 * `CANOPY_NEAR_FULL_M` down to `CANOPY_EDGE_W` (0.16) at the realised reach and
 * then to zero. So between 690 m and 3,500 m the aerial frame is looking at a
 * forest that is being thinned by a rendering economy, and the thinning is 84
 * per cent of it by the far edge. A material term that switched on only past
 * the reach would leave that whole band under-covered and would put a dark ring
 * around the observer at exactly the radius the gradient exists to hide.
 *
 * So the material does not get a fade of its own AT ALL. It takes
 * `canopyDistanceWeight` itself and feeds it straight into the Beer-Lambert
 * law as the density the instances ARE placing, and paints the canopy of the
 * density they are NOT: `1 - exp(-mu (1 - w) / sin(depression))`. That is
 * exactly complementary rather than approximately so (the derivation is in
 * `ofTreeCover`'s own comment), it is identically zero at 690 m where the
 * harvest ring takes over, and the 0.16 -> 0 step at the reach cancels to the
 * digit because both halves are the same exponential of the same product.
 * There is one boundary constant in the whole handover and it is world-gen's.
 *
 * `g` is GROUND distance, not eye distance, because that is the frame
 * `canopyDistanceWeight` is written in and RN-2228 is the scar that says so.
 *
 * `instanceWeight` below is the mirror the GLSL implements, kept in TypeScript
 * so the assertion underneath can compare it against the live function.
 */
function instanceWeight(g: number, reachM: number): number {
  if (g < TREE_NEAR_M) return 1;
  if (g >= reachM) return 0;
  const t = Math.min(1, (g - TREE_NEAR_M) / Math.max(1, reachM - TREE_NEAR_M));
  return 1 + (TREE_EDGE_W - 1) * t;
}

/**
 * C3's guard, one term over. It runs at module load and it THROWS rather than
 * warning, on `assertHueLuminance` / `assertFarCoverMatchesGrass`'s precedent:
 * a mirror of another module's function that is merely believed to agree is the
 * exact shape NUMBERS.md calls "a constant copied from the thing it watches".
 *
 * The comparison is over the WHOLE band at both the aerial and the standing
 * reach, including both endpoints and both sides of the reach step.
 */
export function assertTreelineMatchesScatter(): void {
  for (const reach of [1400, 2000, 3500, 5200]) {
    for (let g = TREE_NEAR_M; g <= reach + 400; g += 7.5) {
      const want = canopyDistanceWeight(g, reach);
      const got = instanceWeight(g, reach);
      if (Math.abs(want - got) > 1e-9) {
        throw new Error(
          `TerrainTreeline: handover mirror disagrees with ScatterTuning`
          + `.canopyDistanceWeight at g=${g} reach=${reach}: ${got} vs ${want}`,
        );
      }
    }
  }
}
assertTreelineMatchesScatter();

/**
 * `?treeline=0` / `?treelineamp=` / `?treelinemottle=`, on
 * `splatFarAmpFromQuery`'s pattern exactly, including RN-150's dead-default
 * guard (a registered parameter that cannot move the picture is worse than a
 * missing one, so the amp parser refuses a value it cannot act on).
 */
export function treelineAmpFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('treeline') === '0') return 0;
  const raw = p.get('treelineamp');
  if (raw === null) return TREE_AMP;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : TREE_AMP;
}

export function treelineMottleFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  const raw = p.get('treelinemottle');
  if (raw === null) return TREE_MOTTLE;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : TREE_MOTTLE;
}

/**
 * RN-2560. `?treelinefar=1`, THE SCALED SHELL'S ARM.
 *
 * The term shipped inside a `#ifndef OF_SCALED` with no reason recorded beside
 * it, so the band from the ~15 km chunk-depth handover out to the 37,947 m
 * horizon -- which is the far half of this term's own charter -- never ran it.
 * The paint below measured how much of a frame that is (1.46 per cent of the
 * terrain pixels at `forestair`, 0.74 at `flyover`, about 1 at the standing
 * poses), and the guard is now a UNIFORM so the band can be priced one flag
 * apart on one build instead of two commits apart.
 *
 * It DEFAULTS OFF. Turning it on makes a term newly live on ground no probe
 * has ever measured, which is a visual lane with hero pairs and guards rather
 * than something a diagnosis lane flips on the way past. rendering.md 2.36
 * carries the price and the routing.
 */
export function treelineFarFromQuery(): number {
  return new URLSearchParams(self.location.search).get('treelinefar') === '1'
    ? 1 : 0;
}

/**
 * RN-2560. `?treelinepaint=1|2`, THE PAINTED ARM, and it exists because an
 * amplitude sweep of this term cannot answer the only question that was open.
 *
 * The term had been reported measuring exactly 0.00 counts on BOTH sides of
 * its own range -- below 690 m (world-gen.md 6.13.8) and, after the WG-275
 * swell raised the plains ground past 690 m, at `meadow` as well (6.14.5) --
 * and NUMBERS.md's own entry says a term gated off sweeps as WEAK rather than
 * as MISSING, so the branch has to be painted rather than scaled.
 *
 *   `?treelinepaint=1`  the STAGE map. Every terrain fragment is painted with
 *                       a flat categorical colour naming how far into this
 *                       term it got: which PROGRAM drew it, whether the outer
 *                       gate passed, whether the Beer-Lambert term was
 *                       evaluated at all, and whether it returned coverage.
 *                       Five colours, every one under 0.25 so the ACES grade
 *                       does not compress the ladder (RN-2479's rule).
 *   `?treelinepaint=2`  the LEVEL map: `treeK`, the coverage this term
 *                       actually mixes with, scaled to 0.22 for the same
 *                       reason. Black is exactly zero, which is the one value
 *                       a painted scalar can carry through the grade
 *                       unambiguously.
 *   `?treelinepaint=3`  ..`=7`, the ISOLATE arms: stage 0..4 painted 0.20 and
 *                       every other fragment painted exactly black, so a
 *                       committed rectangle's own mean is a direct reading of
 *                       how much of it sat at that stage. Five arms one flag
 *                       apart on one build, and they are what turns the hue
 *                       map above from a picture into a table.
 *
 * 0 is the shipped frame: the paint sits behind a BARE-UNIFORM branch, so the
 * default program takes it never, and the no-pixel-change claim is measured
 * rather than argued (see rendering.md 2.36).
 */
export function treelinePaintFromQuery(): number {
  const raw = new URLSearchParams(self.location.search).get('treelinepaint');
  if (raw === null) return 0;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * THE CANOPY TONE, AND IT IS READ OFF THE LIVE CARD RATHER THAN COPIED.
 *
 * The near cards and the far ground meet at the handover, so if their greens
 * differ the boundary is a colour step at a fixed radius -- the one artefact a
 * handover exists to prevent, and the reason RN-2249 gave the crown card
 * `Leaf`'s palette hex to the digit rather than a hex of its own.
 *
 * There is no constant here at all. `SurfaceBind.apply` finalises the canopy
 * material's colour (the palette base, divided by the family's
 * `albedo_mean_linear`, then `applyFoliageTone`) and publishes it here in the
 * same statement. What this file stores is `color * albedoMean`, i.e. the
 * card's MEAN RENDERED ALBEDO: the divide exists so the texture's own mean puts
 * the product back on the palette, and a terrain fragment has no texture to
 * supply that mean, so it has to be multiplied back in.
 *
 * The fallback is the palette value with the tone applied, used only for the
 * frames between terrain appearing and props finishing their load. The term is
 * a distance term, so no settled frame is ever taken on it.
 */
const tone = { r: 0.205, g: 0.354, b: 0.165, live: false };
let sink: ((r: number, g: number, b: number) => void) | null = null;

/** Called by SurfaceBind when the `canopy` family's material is finalised. */
export function publishCanopyTone(c: THREE.Color, albedoMean: number): void {
  tone.r = c.r * albedoMean;
  tone.g = c.g * albedoMean;
  tone.b = c.b * albedoMean;
  tone.live = true;
  sink?.(tone.r, tone.g, tone.b);
}

/** The terrain material registers here so a late prop load still reaches it. */
export function onCanopyTone(f: (r: number, g: number, b: number) => void): void {
  sink = f;
  f(tone.r, tone.g, tone.b);
}

/** For the probe: what the far ground is currently painting, and from where. */
export function canopyToneNow(): { r: number; g: number; b: number; live: boolean } {
  return { ...tone };
}
