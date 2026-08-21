// THE FAR GROUND: the world-locked mid-field and horizon rungs of the terrain
// material, and the range-aware biome-boundary treatment that rides with them.
// Constants, derivations and the module-load asserts; no GLSL
// (TerrainHorizon.glsl.ts) and no uniforms (TerrainUniformState).
//
// RN-2340, world audit R2 lane L1. The audit's rank 1: "past roughly seventy-
// five metres the terrain still has no material and no sub-massif relief", with
// the aerosol term switched off entirely so the haze cannot be blamed
// (`vista.hzBand` iqr 5.49 against a near ground at 25, and `flyovernoon.under`
// 6.07 with the vegetation removed, which `?splat=0` moves by 0.06 counts).
// A3 phase 2, chartered by TerrainSplat.ts's own SPLAT_COARSE_RATIO note.
//
// ---------------------------------------------------------------------------
// WHY THE SHIPPED SPLAT STOPS, AND WHY A THIRD RUNG ON vChunkUv COULD NOT FIX IT
// ---------------------------------------------------------------------------
// Two independent walls, and only one of them is the one everybody names.
//
//   1. THE MIP CHAIN. Clause C1 makes a fully minified layer sample the exact
//      identity, so a rung retires itself when the pixel footprint passes about
//      a third of its tile. The fine rung (2.07 m) is gone by a 0.6 m footprint
//      and the coarse rung (7.2 to 14.5 m) by about 2.4 m. That is RN-2166, and
//      SPLAT_COARSE_RATIO is the answer to it one rung in.
//   2. THE COORDINATE. Both shipped rungs ride `vChunkUv`, which normalises over
//      the quad, so a coarser LOD ring draws them at DOUBLE the world scale.
//      Inside the near field that is invisible because the streamer is at max
//      depth there. Past it, it is a visible scale step on every LOD ring, and
//      the ring radii are exactly the range band this lane exists to fill. A
//      third rung on `vChunkUv` would put a scale step in the middle of it.
//
// So this lane's rungs ride `vPhase`, WG-230's world-locked coordinate:
// `frac(anchor / 256)` reduced on the CPU in float64 and stamped per chunk, plus
// the vertex's own chunk-local `position / 256`. Its quantum is set by the
// CHUNK's extent rather than by the BODY's radius (30.5 um for any chunk under
// 256 m of half-extent, 0.24 mm for a 3.7 km one), so unlike `pM` it survives at
// range, and unlike `vChunkUv` its world scale is the same on every LOD ring.
//
// ---------------------------------------------------------------------------
// THE SEAM RULE, AND THE ONE PLACE IT IS EASY TO BREAK TWICE
// ---------------------------------------------------------------------------
// Two chunks reaching the same ground hold `vPhase` values that differ by an
// exact INTEGER vector, so any INTEGER multiple of it agrees across a chunk
// edge and no other multiple does. `assertPhasePeriod` is the throw that stops a
// non-dividing tile reaching a screenshot, and it is called below, at module
// load, for every period this file introduces. The repeat counts are what it
// RETURNS rather than numbers typed beside it, which is the handoff
// TerrainPhase.glsl.ts asks for in capitals.
//
// THE SECOND WAY TO BREAK IT is subtler and is why nothing here calls
// `ofPhaseWrap`. That helper takes `fract()`, which is right for an analytic
// consumer and WRONG for a texture fetch: `fract` puts a step in the coordinate
// once per period, the hardware differentiates the coordinate to pick a mip, and
// a step in the derivative is a one-pixel line of mip-0 speckle along every
// wrap boundary in the frame. A repeat-wrapped sampler already does the
// wrapping, exactly, in the fixed-function path, with the derivative left
// intact. So these rungs pass `vPhase * repeats` STRAIGHT to `texture2D` and
// take no fract at all.
//
// ---------------------------------------------------------------------------
// THE PROJECTION: TRIPLANAR, AND WHY THERE IS NO CHEAPER HONEST OPTION
// ---------------------------------------------------------------------------
// `vPhase` is a 3-D world coordinate and a texture fetch needs two axes. On a
// 600 km sphere there is no fixed pair of world axes that is non-degenerate
// everywhere: whichever two are chosen, the ground somewhere on the body is
// parallel to the projection direction and the texture smears into stripes
// there. The cubed-sphere quad UV IS a non-degenerate surface parameterisation,
// which is exactly why the near rungs use it, and it is unusable here for wall 2
// above. So the projection is the standard three-plane blend on the geometric
// normal, and the three planes are the honest cost of a world-locked read.
//
// It buys one thing back for free, and it is worth naming because it is half of
// this term's anti-tiling story: the three planes are axis pairs of a
// PLANET-CENTRED coordinate, so as the ground curves away the blend rotates
// continuously with latitude and longitude. The lattice therefore has no single
// orientation anywhere in a wide frame, which a chunk-UV lattice does.
//
// ---------------------------------------------------------------------------
// ONE CARRIER TEXTURE, AND WHAT THAT COSTS
// ---------------------------------------------------------------------------
// Six layers times three planes times two rungs is thirty-six fetches and is
// not affordable. What is affordable is SIX: one carrier, three planes, two
// rungs. The carrier is `uSplatRock`, which the table calls "very nearly
// neutral, a hair warm" and whose job is stated there as "the FACETS" -- i.e.
// it is the layer authored to be a value/normal field rather than a colour.
//
// The per-material information does NOT come from the texture at this range,
// and that is the design rather than a concession:
//
//   HUE comes from `ofSplatHue`, the six-way convex combination of unit-
//   luminance vectors. It is exact, it costs zero fetches, and clause C3 holds
//   at every range for the same one-line reason it holds at two metres.
//   ROUGHNESS comes from the same weights against `OF_SPLAT_RB_*`.
//   NORMAL AMPLITUDE is split rock-against-cover from the weights themselves
//   (HORIZON_N_ROCK / HORIZON_N_COVER below), because the one thing a viewer
//   reads at four kilometres is that a crag has more relief than a meadow.
//
// WHAT IS GIVEN UP is the per-layer CHARACTER of the value and normal fields:
// at range every material is modulated by rock's detail rather than by its own.
// The two-carrier version (grass for the cover group, rock for the rock group,
// twelve fetches) is recorded as owed rather than pretended away.
//
// ---------------------------------------------------------------------------
// THE FOOTPRINT LADDER, WHICH INTRODUCES ONE RATIO AND NO NEW BOUNDARY
// ---------------------------------------------------------------------------
// Every rung in this material now hands over on the PIXEL FOOTPRINT and not on
// distance, for TerrainSplat.ts's own measured reason (at a grazing pose the
// dFdy arm binds and grows as the SQUARE of the range, so a distance-keyed
// handover swaps rungs at one range looking down and a different one looking
// along the ground). The shipped ladder ends at SPLAT_COARSE_FOOT[1] = 0.60 m,
// and this lane starts there rather than at a number of its own:
//
//   fine (2.07 m tile)      -> coarse   over footM 0.15 to 0.60   [shipped]
//   coarse (7.2-14.5 m)     -> mid      over footM 0.60 to 1.80   [this lane]
//   mid (32 m)              -> horizon  over footM 1.80 to 5.40   [this lane]
//
// One inherited boundary and one ratio (three), and the ratio is checked against
// content rather than chosen: a 32 m tile off a 1024 px asset is 32 px/m and
// retires at about a 10.7 m footprint, so it is alive across the whole of its
// own band with a factor of six of margin; a 128 m tile is 8 px/m and retires at
// about 43 m, which covers the `vista` ridge at 4.7 km (footprint 3 to 30 m
// depending on the incidence) and gives out in the haze beyond it.

import { PHASE_PERIOD_M, assertPhasePeriod } from '../../world/ChunkPhase.js';
import { SPLAT_COARSE_FOOT } from './TerrainSplat.js';

/**
 * THE MID RUNG's world tile, in metres. 32 m divides the 256 m phase period
 * eight times, which is what makes it seam-safe; see the header.
 *
 * It is chosen from the ladder above and then checked against the asset: 1024 px
 * over 32 m is 32 px/m, so the rung carries content until the footprint passes
 * about a third of its tile (10.7 m), i.e. across the whole of the 75-to-600 m
 * band and well past it.
 */
export const HORIZON_MID_TILE_M = 32;

/**
 * THE HORIZON RUNG's world tile, in metres. 128 m divides the period twice.
 *
 * The ladder's own ratio would put this nearer 100 m. It is rounded UP to the
 * next divisor rather than down, and the reason is the thing this rung exists
 * for: at 4.7 km a grazing ray has a pixel footprint of tens of metres, and a
 * 64 m tile (8 px/m over 1024 px) would already be inside its own mip tail
 * there. 128 m retires at about a 43 m footprint, which is past the `vista`
 * ridge and inside the range where the aerial term dominates anyway.
 *
 * IT IS NOT 256 m, i.e. not the period itself, and that is deliberate: at
 * repeats = 1 the same image would tile in exact register with the phase period
 * over the whole planet, which is a 256 m lattice with nothing to break it,
 * because the anti-tiling warp below cannot be coarser than the period it lives
 * in. At repeats = 2 the warp is one period across two tiles and does bend them.
 */
export const HORIZON_FAR_TILE_M = 128;

/**
 * THE ANTI-TILING WARP's period. 128 m, i.e. TWO repeats of the phase, and the
 * two is load-bearing rather than a choice of scale.
 *
 * IT SHIPPED FOR ONE ARM AT `PHASE_PERIOD_M` ITSELF, on the reasoning that the
 * period is the coarsest world-locked field this attribute can carry
 * (`PHASE_PERIOD_M`'s own note, which is correct). That is one repeat, and one
 * repeat is DEGENERATE: `ofArtVnoise2P` reduces its lattice index with
 * `mod(i, period)`, so at period 1 every cell reduces to cell 0 and the field
 * is a CONSTANT. The warp was multiplying the coordinate by a fixed offset and
 * doing nothing at all, and nothing in a frame or a rectangle would ever have
 * said so -- a constant offset to a tiling coordinate is invisible by
 * construction. Caught by reading the runtime fixture back (`horizonDefault()`
 * publishes the repeat counts) rather than by looking at a picture, which is
 * the whole reason that fixture publishes the arithmetic and not just the
 * amplitudes.
 *
 * The general rule, worth stating because the next consumer of `vPhase` will
 * meet it: a PERIODIC-NOISE consumer needs at least TWO repeats to have a field
 * at all, while a TEXTURE consumer is happy at one. The seam rule (integer
 * repeats) is necessary for both and sufficient for neither.
 */
export const HORIZON_WARP_TILE_M = PHASE_PERIOD_M / 2;

/**
 * The three repeat counts, and they are what `assertPhasePeriod` RETURNS rather
 * than integers typed beside the tiles above. That is TerrainPhase.glsl.ts's
 * stated handoff: "call it at module load with your tile metres and multiply by
 * what it returns". A tile that does not divide the period is a boot failure
 * here instead of a hairline seam along every chunk boundary at range, which is
 * the one artefact this coordinate can produce and the one that is hardest to
 * attribute after the fact.
 */
export const HORIZON_MID_REPEATS =
  assertPhasePeriod(HORIZON_MID_TILE_M, 'TerrainHorizon mid rung');
export const HORIZON_FAR_REPEATS =
  assertPhasePeriod(HORIZON_FAR_TILE_M, 'TerrainHorizon horizon rung');
export const HORIZON_WARP_REPEATS =
  assertPhasePeriod(HORIZON_WARP_TILE_M, 'TerrainHorizon anti-tiling warp');

/**
 * The ladder's one ratio. See the header: the coarse rung's handover ENDS at
 * SPLAT_COARSE_FOOT[1] and each subsequent rung takes over across a band three
 * times wider in footprint than the last one's end.
 */
export const HORIZON_FOOT_RATIO = 3;

/**
 * The mid rung's fade-in band, in METRES OF PIXEL FOOTPRINT. Its lower edge is
 * SPLAT_COARSE_FOOT[1] verbatim -- the shipped ladder's own last boundary,
 * imported rather than transcribed -- so this lane introduces no fade constant
 * of its own and there is no way for the two ends of the handover to drift.
 */
export const HORIZON_FOOT_MID: readonly [number, number] = [
  SPLAT_COARSE_FOOT[1], SPLAT_COARSE_FOOT[1] * HORIZON_FOOT_RATIO,
];

/** The horizon rung's crossover, continuing the same ladder by the same ratio. */
export const HORIZON_FOOT_FAR: readonly [number, number] = [
  HORIZON_FOOT_MID[1], HORIZON_FOOT_MID[1] * HORIZON_FOOT_RATIO,
];

/**
 * The four amplitudes, and they are four rather than one for uSplatAmp's own
 * reason: they FAIL DIFFERENTLY, so a single switch could only ever answer "is
 * the far ground on" and never "which half of it is doing this".
 *
 *   VALUE   too high and the distance reads as noise rather than as rock.
 *   CHROMA  too high and this is a restyle of a twice-corrected palette at the
 *           one range where the palette is the whole of the colour.
 *   NORMAL  too high and a hillside is lit like corrugated iron.
 *   AO      too high and every ridge line in the frame is outlined.
 *
 * VALUE and CHROMA are SPLAT_A_VALUE and SPLAT_A_CHROMA's numbers, deliberately
 * and not coincidentally: this is the same term one rung further out, applied
 * through the same tint axis and the same convex hue combination, and giving it
 * a different strength would put a visible step in the middle of a handover
 * whose entire purpose is not to have one.
 */
export const HORIZON_A_VALUE = 0.85;
export const HORIZON_A_CHROMA = 0.55;
export const HORIZON_A_NORMAL = 1.0;

/**
 * The curvature term's amplitude. Lower than the other three because it is the
 * only one that is not bounded by a centred texture channel: it is a derivative
 * of an interpolated normal, so its tail is set by the mesh rather than by an
 * asset, and 0.35 is where a ridge reads as a ridge before the triangle edges
 * behind it start to read as facets.
 */
export const HORIZON_A_AO = 0.35;

/**
 * THE NORMAL AMPLITUDE SPLIT, rock against cover, and it is the whole of what
 * makes a crag read as a crag at four kilometres when both are painted by the
 * same carrier texture. The weights are the splat's own six (rock + cliff +
 * scree against grass + dirt), so this introduces no new selector: it is the
 * material table answering a question the material table already answers.
 */
export const HORIZON_N_ROCK = 1.0;
export const HORIZON_N_COVER = 0.35;

/**
 * The anti-tiling warp's amplitude, in PHASE UNITS (one unit is 256 m).
 *
 * IT IS A DERIVATIVE BUDGET AND NOT A LOOK, on SPLAT_WARP_UV's argument
 * verbatim. The warp perturbs the sample coordinate's derivative by roughly
 * amplitude x 2 pi x repeats, i.e. 0.0098 x 6.28 x 2 = 12.3 per cent, which
 * moves the hardware mip choice by log2(1.123) = 0.17 of a level -- the same
 * budget the shipped near-field warp spends (11 per cent, 0.15 of a level) and
 * for the same reason: past about a fifth of a mip level a term is paying for
 * its anti-tiling in filtering.
 *
 * In WORLD terms 0.0098 periods is 2.51 m, which displaces the mid rung's 32 m
 * lattice by 7.8 per cent of a tile and bends it visibly.
 *
 * IT IS NOT A FULL ANSWER AND IS NOT CLAIMED AS ONE, for SPLAT_WARP_UV's reason
 * and one more of its own: the warp cannot be coarser than the period it is
 * built from, so the HORIZON rung's own 128 m tile shares the warp's 128 m
 * period and is barely bent by it. Residual regularity at that rung's scale is
 * recorded as owed beside the two-carrier item, and it is visible in
 * RN2340_flyovernoon_canopy0_after.png as a fine regular lattice across the
 * aerial ground.
 */
export const HORIZON_WARP_UV = 0.0098;

/**
 * THE RANGE-AWARE BIOME-BOUNDARY BREAK, and it is here rather than in a file of
 * its own because it is the same term: it is paid for entirely by a field the
 * horizon rung has already fetched.
 *
 * WHAT IT IS FOR. Lane L2 diagnosed the aerial "texel staircase" (world audit
 * R2 rank 2) and it is not a shadow: it is the Forest-to-Hills biome colour
 * boundary, a 2.7x value step, resolved across ONE coarse-LOD cell of 57.8 to
 * 115 m, with the teeth being the vertex grid itself
 * (`RN2305_term_biomecolor.png`). L3's branch narrows the step by lifting the
 * Forest hex. The structural half is range-awareness: a boundary should cross
 * many pixels at range, not one cell.
 *
 * WHAT IS AND IS NOT AVAILABLE, said plainly because it decided the mechanism.
 * EVERY per-vertex field in this material -- `vBiomeColor`, `vMatW`, `vRelW`,
 * `vGrain`, `vTint`, `vCanopy`, the geometric normal -- is C0 on the same
 * coarse-LOD grid, because they are all linearly interpolated across the same
 * triangles. A fragment cannot low-pass any of them: it sees its own triangle's
 * linear piece and nothing of the neighbour's, so a true geometric widening of
 * the biome blend is a VERTEX-SIDE or CPU-SIDE change and is flagged up as one.
 * The only field in the frame that is smooth at range is a mip-filtered
 * world-locked texture read, which is precisely what the horizon rung is.
 *
 * SO THE MECHANISM IS DISPLACEMENT, NOT BLUR. `vBiomeColor` is linear in SCREEN
 * space inside a triangle, so `vBiomeColor + s * dFdx + t * dFdy` is exactly the
 * colour s pixels right and t pixels up. Offsetting (s, t) by the horizon rung's
 * own centred, mip-filtered value field turns the boundary into a ragged band
 * this many pixels wide instead of a straight edge one cell wide. It is
 * range-aware by construction because the offset is measured in PIXELS: the
 * world width of the band is HORIZON_ECO_PX * footM, which grows exactly as the
 * cell shrinks on screen. And it retires itself correctly at both ends -- the
 * gate below is zero inside a biome, and once the boundary is genuinely
 * sub-pixel the noise driving it has minified to the identity and the term is
 * zero again, which is the right answer because a sub-pixel boundary needs no
 * widening.
 */
export const HORIZON_ECO_PX = 6;

/**
 * The rung field's NOMINAL MAGNITUDE, and it is what makes HORIZON_ECO_PX mean
 * pixels rather than mean nothing in particular.
 *
 * The displacement above is (dFdx * v) where v is the rung's decoded, centred
 * value: a fixed multiplier on v is a displacement in pixels only if v is order
 * one, and it is not -- a 0.5-centred channel decoded to [-1, 1] and then
 * three-plane blended reads about +/-0.3 in practice. The first version left
 * that out and the whole term displaced the boundary by under ONE PIXEL, which
 * is why an eight-times amplitude sweep moved `shadowStep` by 0.14 counts: an
 * amplitude cannot rescue a term whose units are wrong. Dividing by the nominal
 * magnitude here makes HORIZON_ECO_PX the half-width of the band in pixels, to
 * within the field's own spread, which is a number a reader can check against a
 * frame.
 */
export const HORIZON_ECO_FIELD = 0.30;

/**
 * The gate, in LINEAR RGB PER PIXEL of `vBiomeColor`'s own screen derivative.
 *
 * Not a distance and not a biome-index compare: it is the artefact's own
 * magnitude, measured where it happens. Inside a biome the derivative is
 * exactly zero and the term cannot fire.
 *
 * THE FIRST BAND WAS [0.004, 0.045] AND IT WAS AN ORDER OF MAGNITUDE TOO HIGH,
 * which is worth recording because the arithmetic that produced it is the
 * plausible-looking kind. The Forest-to-Hills step is 0.22 to 0.40 in luma
 * across one cell, and the reasoning was "at the aerial poses that cell is a
 * pixel or two, so the per-pixel derivative is a large fraction of the step".
 * The frame says otherwise: at `flyovernoon` the coarse cell subtends tens of
 * pixels, so the same step arrives as roughly 0.007 per pixel, the gate read
 * 0.03 of full weight, and the term was inert. Measured, not guessed: at
 * `?horizonecoamp=8` -- eight times the shipped strength -- `shadowStep` iqr
 * moved from 45.06 to 45.20, i.e. nothing, which is what an amplitude sweep
 * looks like when the GATE and not the amplitude is what is off.
 *
 * The band below starts where a cell-crossing boundary actually reads and
 * saturates near where one would have to be a pixel wide.
 */
export const HORIZON_ECO_GATE: readonly [number, number] = [0.0006, 0.006];

// ---------------------------------------------------------------------------
// THE MASSIF TERM, AND THE MEASUREMENT THAT FORCED IT
// ---------------------------------------------------------------------------
// The two texture rungs above fix the band they were built for and stop dead
// where the audit's decisive frame is. Measured at `vista`, four arms one flag
// apart on one build, `?aerosol=0` so the haze is not the variable:
//
//   arm                       hzBand iqr (the 4.7 km ridge)   mid iqr
//   ?horizon=0 (pre-lane)                 5.49                 19.13
//   value only off                        5.93                 19.42
//   chroma only off                       7.34                 26.37
//   normal only off                       7.34                 26.92
//   curvature only off                    7.20                 26.93
//   all on                                7.28                 26.44
//
// The middle distance moved 38 per cent and the RIDGE moved 33 per cent, of
// which the VALUE rung is 1.35 counts and the other three are inside the
// arm-to-arm noise. Two independent reasons, and both are about the ridge and
// not about the terms:
//
//   1. THE TEXTURE HAS MINIFIED. At 4.7 km a grazing ray's footprint is tens of
//      metres, past the 128 m tile's own mip tail, and clause C1 then guarantees
//      the sample IS the identity. No rung built on a 256 m period can reach
//      further; PHASE_PERIOD_M's own note says a kilometre-scale field needs a
//      SECOND float64 reduction rather than a larger period.
//   2. THE RELIEF IS NOT IN THE MESH ANY MORE. At that range the streamer is
//      several LOD steps up and the sub-massif shape has been decimated out of
//      the geometry. `ofHzCurv` reads the mesh honestly and correctly reports
//      that there is nothing there: it moved the ridge by 0.08 counts. A
//      shading term cannot recover geometry that was thrown away, which is
//      exactly why the charter asks for relief "derived from the terrain's own
//      height content at low frequency" rather than from the normal.
//
// SO THE MASSIF TERM IS ON `pM`, AND THAT IS NOT A REGRESSION TO WHAT RN-45
// BANNED. It is the same coordinate with the ban's own condition inverted, and
// the inversion is arithmetic. RN-45's finding is that pM's 62.5 mm quantum
// destroys a SCREEN DERIVATIVE wherever the pixel footprint is comparable to
// it: at 2 m a pixel covers 4.3 mm of ground, the quantum is fifteen pixels
// wide, dFdx is zero across runs of them and the artefact is a field of arcs.
// This term is gated to a footprint of HORIZON_FOOT_FAR[0] = 1.8 m and up,
// where the quantum is 1/29th of a pixel and falling. The regime RN-45
// photographed is excluded BY THE GATE rather than by tuning, and pM is then
// the only coordinate in the material that can carry a kilometre-scale field at
// all. (`vPhase` is better everywhere it reaches; it simply does not reach.)
//
// WHAT MAKES IT THE TERRAIN'S OWN HEIGHT CONTENT rather than a noise dropped on
// a mountain: its amplitude is driven by the fragment's own relief band
// (`vRelief / uMaxRelief`, the same altitude coordinate the snowline and the
// scree apron are expressed in) and by 1 - coverSel, so it is at full strength
// on high steep ground and nearly absent on a plain. A massif gets massif
// relief and a meadow does not, from the selectors the material already has.

/**
 * The two octave wavelengths, in METRES of ground. Deliberately NOT round
 * numbers and deliberately incommensurate: 1240 and 390 are a ratio of 3.18, so
 * the pair does not beat into a visible super-lattice the way 1200/400 would.
 *
 * The coarse octave is the massif itself (a Forge range is a few kilometres
 * across, so a 1.24 km feature is its flanks and shoulders) and the fine one is
 * sub-massif: spurs and corries at about four hundred metres, which is the scale
 * the audit says is missing by name.
 */
export const MASSIF_A_M = 1240;
export const MASSIF_B_M = 390;

/**
 * The two octaves' weights. DEFINES rather than uniforms, on MID_WA's own
 * argument: the balance between them is not a live question, while the two
 * WAVELENGTHS and the amplitudes are, and those are uniforms.
 */
export const MASSIF_WA = 0.62;
export const MASSIF_WB = 0.38;

/**
 * THE DISTANCE FADE-OUT, in metres. IT IS AN ORBIT GUARD AND NOTHING ELSE, and
 * that is a correction: it shipped for one afternoon as a HANDOVER guard at
 * 7-to-11 km and the measurement said that was wrong twice over.
 *
 * WHAT WAS MEASURED. At `vista`, `?aerosol=0`, the massif value term at 20x
 * with the texture rungs off, the ONLY variable being this pair:
 *
 *   fade 7,11 km      hzBand iqr 7.28   (i.e. the term never reached the ridge)
 *   fade 200,400 km   hzBand iqr 74.59
 *
 * So the massif in `vista.hzBand` is well past eleven kilometres, and the fade
 * -- not the amplitude, not the octaves, not the relief band -- was the whole
 * of why four earlier arms could not move that rectangle by more than the noise
 * they were taken against. It is recorded rather than quietly retuned because
 * it is a general lesson about this frame: a rectangle named for one range can
 * be measuring ground at five times it, and the only way to find out is to
 * sweep the gate and watch which feature stops moving. The fade being a UNIFORM
 * is what made that a one-flag experiment rather than a rebuild.
 *
 * WHY THE HANDOVER ARGUMENT NO LONGER APPLIES. It was written when this term
 * lived inside `#ifndef OF_SCALED`. It does not: the massif block and its
 * normal half are compiled into BOTH programs, so there is no side of the
 * handover where the term is missing and nothing to be seamed against.
 *
 * WHAT ACTUALLY RETIRES IT. The two per-octave footprint fades in
 * TERRAIN_HORIZON_BUMP, which is the correct guard and the only one that is
 * scale-aware: a 390 m octave is gone by a 130 m footprint and a 1240 m one by
 * 413 m, so a horizon at 38 km retires itself and a massif at 20 km does not.
 * This pair sits far outside any surface frame (the horizon from 1,200 m is
 * 37.9 km) and exists so that an ORBITAL frame, where dist is hundreds of
 * kilometres, is bit-identical to the one before this lane by a gate rather
 * than by an argument about footprints.
 */
export const MASSIF_FADE_M: readonly [number, number] = [40000, 80000];

/**
 * The massif term's two amplitudes. TWO and not one for uSplatAmp's reason:
 * they fail differently. Too much VALUE and a mountain is blotchy; too much
 * BUMP and it is corrugated, which is the failure mode the relief bump's own
 * note names one wavelength down.
 *
 * THE VALUE IS THE LARGER OF THE TWO, AND THAT IS THE OPPOSITE OF WHAT THIS
 * COMMENT FIRST SAID. It shipped as bump 1.25 against value 0.55 on the
 * argument that "only a normal perturbation makes a face take the sun
 * differently from the face beside it", which is true near and false far, and
 * the measurement says so in one line: at `vista`, bare air, `?horizonmassifbump`
 * 0 against 0.6 moved EVERY committed rectangle by 0.00. The reason is the
 * per-octave footprint fades below it -- at the range where the massif is the
 * whole of the picture, the octaves that could perturb a normal have already
 * been retired to stop them aliasing, and what is left that can legitimately
 * paint is the coarse VALUE. So the bump keeps its amplitude for the band where
 * it can be seen to do something (a hillside at one to five kilometres) and the
 * value carries the horizon.
 *
 * The value sweep, `vista`, `?aerosol=0`, one flag apart, against a
 * `?horizon=0` control of 5.49:
 *
 *   0.55  hzBand iqr 7.72   box 18.94   mid 24.50
 *   1.50  hzBand iqr 8.72   box 17.15   mid 21.87
 *   2.50  hzBand iqr 10.00  box 16.22   mid 19.01
 *
 * 1.50 is taken and 2.50 is refused, and the refusal is the interesting half:
 * `box` and `mid` FALL as this rises, because a large-scale multiplicative
 * value term brightens as much ground as it darkens and the bright half runs
 * into the top of the range on an already-pale snowfield. The horizon is worth
 * buying at 18 per cent of the middle distance's contrast and it is not worth
 * buying at 26.
 */
export const MASSIF_A_VALUE = 1.5;
export const MASSIF_A_BUMP = 1.25;

/**
 * The relief-band gate, as [start, end] of a smoothstep on `vRelief /
 * uMaxRelief`. Below the start the term is off, so the plains a player walks
 * for the first several hours are bit-identical; by the end it is at full
 * strength, which is the mountain band the snowline and the scree apron are
 * already expressed in (0.30 to 1.14 between them).
 */
export const MASSIF_BAND: readonly [number, number] = [0.10, 0.45];
