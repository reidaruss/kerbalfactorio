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
 * over the whole planet, which is a 256 m lattice with nothing to break it.
 */
export const HORIZON_FAR_TILE_M = 128;

/**
 * The two rungs' repeat counts, and they are what `assertPhasePeriod` RETURNS
 * rather than integers typed beside the tiles above. That is
 * TerrainPhase.glsl.ts's stated handoff: "call it at module load with your tile
 * metres and multiply by what it returns". A tile that does not divide the
 * period is a boot failure here instead of a hairline seam along every chunk
 * boundary at range, which is the one artefact this coordinate can produce and
 * the one that is hardest to attribute after the fact.
 */
export const HORIZON_MID_REPEATS =
  assertPhasePeriod(HORIZON_MID_TILE_M, 'TerrainHorizon mid rung');
export const HORIZON_FAR_REPEATS =
  assertPhasePeriod(HORIZON_FAR_TILE_M, 'TerrainHorizon horizon rung');

/**
 * THE INCOMMENSURABILITY RULE, as a throw, and it is the second half of the
 * seam rule rather than a taste check.
 *
 * `assertPhasePeriod` says a period must DIVIDE 256 m, which is what keeps two
 * chunks agreeing. It says nothing about how a warp period relates to the TILE
 * it is supposed to break, and that is the gap this closes. Both fields are
 * periodic on the same 256 m phase, so the composite they draw on the ground
 * repeats every `PHASE_PERIOD_M / gcd(warpRepeats, tileRepeats)` metres. Any
 * shared factor therefore shortens the visible super-period, and the worst case
 * -- equal repeat counts -- shortens it to the tile itself, at which point
 * every copy of the tile is warped IDENTICALLY and the warp is in register with
 * the thing it exists to break.
 *
 * Coprime is the whole condition. It makes the super-period the full 256 m, the
 * coarsest this coordinate can carry, and it is checkable by arithmetic rather
 * than by looking at a frame -- which matters because looking at a frame is how
 * this was caught the first time, one shipped build too late.
 */
function assertIncommensurate(warpRep: number, tileRep: number, who: string):
number {
  let a = warpRep; let b = tileRep;
  while (b > 0) { const t = a % b; a = b; b = t; }
  if (a !== 1) {
    throw new Error(`TerrainHorizon: ${who} warps at ${warpRep} repeats against a `
      + `tile at ${tileRep}, which share a factor of ${a}. The composite repeats every `
      + `${PHASE_PERIOD_M / a} m instead of ${PHASE_PERIOD_M} m, so the warp is partly `
      + 'in register with the tile it exists to break and paints a lattice.');
  }
  return warpRep;
}

/**
 * THE TWO ANTI-TILING WARP PERIODS, one per rung, and the fact that there are
 * TWO of them is the correction this file most needed.
 *
 * IT SHIPPED FOR ONE ARM AT `PHASE_PERIOD_M` ITSELF, i.e. one repeat, which is
 * DEGENERATE: `ofArtVnoise2P` reduces its lattice index with `mod(i, period)`,
 * so at period 1 every cell reduces to cell 0 and the field is a CONSTANT. That
 * was corrected to two repeats and SHIPPED THAT WAY, and two repeats is the
 * defect this comment now exists to explain, because it is worse than the
 * constant was and it is visible:
 *
 *   1. TWO REPEATS IS NOT A NOISE. A value noise with a 2 x 2 lattice per
 *      period is four corner values smoothstepped against each other and then
 *      repeated: a diamond checkerboard, not a field. It has one orientation
 *      and one scale everywhere.
 *   2. AND ITS PERIOD WAS THE HORIZON RUNG'S OWN TILE. 256/2 = 128 m is exactly
 *      HORIZON_FAR_TILE_M, so every copy of that tile was displaced by the same
 *      pattern and the warp decorrelated nothing at all at that rung, while
 *      stamping its own diamonds through the coordinate.
 *
 * Both halves show as ONE artefact: a regular diamond lattice over the far
 * ground, over `vista`'s 4.7 km massif and over the whole of `flyovernoon`'s.
 * Anti-tiling that is in register with its tile is not weak anti-tiling; it is
 * a lattice generator.
 *
 * SO EACH RUNG GETS ITS OWN WARP, at 2.5 times its own tile's frequency:
 *
 *   mid rung     32 m tile   (8 repeats)  warped at 256/19 = 13.47 m
 *   horizon rung 128 m tile  (2 repeats)  warped at 256/5  = 51.20 m
 *
 * 19 and 5 are PRIME, which is TERRAIN_ART_FINE's own rule for its three
 * octaves ("no two lattices share a cell boundary") and here it is what makes
 * `assertIncommensurate` pass against 8 and 2 respectively: gcd is 1 both
 * times, so each composite repeats on the full 256 m period rather than on the
 * tile. They are coprime with each other as well, so the two rungs do not share
 * a cell boundary through the crossover where both are on screen.
 *
 * WHY FINER THAN THE TILE AND NOT COARSER, since coarser is the textbook shape.
 * There is nothing coarser available. The only period above 128 m that divides
 * 256 m is 256 m, which is the degenerate one repeat. A warp built on this
 * attribute cannot be coarser than the horizon rung's tile, which is stated
 * here rather than discovered again; what it CAN be is aperiodic-looking at the
 * tile's own scale, and 5 and 19 cells per period is where that starts.
 *
 * The general rule, worth stating because the next consumer of `vPhase` will
 * meet it: a PERIODIC-NOISE consumer needs at least two repeats to have a field
 * at all, several to have one that does not read as a checkerboard, and a count
 * COPRIME with whatever it modulates. A TEXTURE consumer is happy at one. The
 * seam rule (integer repeats) is necessary for all of that and sufficient for
 * none of it.
 */
export const HORIZON_WARP_MID_TILE_M = PHASE_PERIOD_M / 19;
export const HORIZON_WARP_FAR_TILE_M = PHASE_PERIOD_M / 5;

export const HORIZON_WARP_MID_REPEATS = assertIncommensurate(
  assertPhasePeriod(HORIZON_WARP_MID_TILE_M, 'TerrainHorizon mid warp'),
  HORIZON_MID_REPEATS, 'the mid rung',
);
export const HORIZON_WARP_FAR_REPEATS = assertIncommensurate(
  assertPhasePeriod(HORIZON_WARP_FAR_TILE_M, 'TerrainHorizon horizon warp'),
  HORIZON_FAR_REPEATS, 'the horizon rung',
);

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
 * THE TOP RUNG'S RETIREMENT, IN PIXELS PER TILE, and the ladder had none. This
 * is the second half of the lattice defect and the half the warp could never
 * have answered.
 *
 * WHAT THE MEASUREMENT SAYS. `flyovernoon`, canopy off, a 128 x 64 px patch at
 * (700, 400), one-dimensional DFT along each axis: the dominant repeat is
 * 25.6 px across and about 4 px down. The camera is 1,200 m up at a 14 degree
 * depression, so that patch sees ground at a 20-odd metre pixel footprint,
 * where HORIZON_FAR_TILE_M subtends 22 px laterally and 5 px along the ground.
 * THE PATTERN IS THE TILE, at its own pitch, and the same DFT at (700, 600) --
 * three times nearer in footprint -- is broadband with no such peak. It is not
 * the warp: the arm with the warps at 19 and 5 repeats reads 25.6 px too.
 *
 * WHY C1 DOES NOT ALREADY COVER IT, which is the trap worth recording. Clause
 * C1 makes a FULLY minified layer sample the identity, and RN-2166's working
 * rule is "a rung retires when the footprint passes about a third of its tile".
 * Both are about the CONTENT washing out. Neither is about the PITCH, and the
 * pitch is what is visible: full minification is the 1x1 mip, which needs the
 * tile down to ONE PIXEL, while a tile at three to six pixels is sampling a
 * 4 x 4-ish mip -- sixteen distinct texels with real variance -- and stamping
 * it down at Nyquist. That is not a washed-out layer, it is a grid generator,
 * and it is worst exactly where RN-2166's rule says the rung is safely gone.
 *
 * SO THE GUARD IS IN PIXELS PER TILE AND NOT IN METRES, because the artefact is
 * a screen-space one: at 24 px per tile a repeat is a texture, at 6 px it is a
 * lattice, and the two numbers below are that band read off the frames. The
 * rung fades out across it, and what carries the ground beyond is the massif
 * term, which is analytic, kilometre-scale and has no tile to alias -- i.e.
 * the far band is handed to the term this lane already built for it rather
 * than to a rung that cannot reach.
 *
 * IT COSTS THE FLAT FAR PLAIN ITS MATERIAL, and that is stated rather than
 * hidden: past a 21 m footprint on ground with no relief the audit's rank 1 is
 * unanswered again. A flat far plain is the pre-lane defect; a far plain
 * wearing a regular mesh is a worse one, and it is the one a viewer sees first.
 */
export const HORIZON_TILE_PX_OUT: readonly [number, number] = [12, 5];

/**
 * The retirement band in METRES OF PIXEL FOOTPRINT, derived from the tile and
 * the pixel counts above rather than typed, so it cannot go stale against
 * HORIZON_FAR_TILE_M the way a transcribed fade always eventually does
 * (standing rule 11). 8.0 m to 21.3 m at the shipped 128 m tile.
 */
export const HORIZON_FOOT_OUT: readonly [number, number] = [
  HORIZON_FAR_TILE_M / HORIZON_TILE_PX_OUT[0],
  HORIZON_FAR_TILE_M / HORIZON_TILE_PX_OUT[1],
];

/**
 * RN-2421. THE CARRIER'S OWN CELL COUNT, and it is the unit the retirement above
 * should always have been written in.
 *
 * HORIZON_TILE_PX_OUT is in PIXELS PER TILE and its argument is that a repeating
 * thing at 24 px is a texture and at 6 px is a lattice. That argument is right
 * and the unit is wrong, because the repeating thing is not the tile. The rock
 * carrier is `terraintex._layer_rock`, whose dominant field is
 * `texgen._worley(s, s, 8, sd)` terraced into flat facets at weight 0.48 of the
 * height AND another 0.30 of the value on top of it: EIGHT CELLS ACROSS THE
 * TILE, and everything else in that layer (a 20-cell worley at 0.26, an fbm at
 * 0.14, a 64-cell gravel at 0.12) is finer and washes out first under
 * minification. So the finest surviving structure at range is the tile over
 * eight, and the tile itself is one order coarser than the thing on the screen.
 *
 * MEASURED ON THE SHIPPED ASSET rather than read off the generator alone:
 * `node tools/smoke/latmeter.mjs assets/textures/dist/of_terrain_rock.png
 * --x=0 --y=0 --w=1024 --h=512 --chan=r --drop=2` returns a dominant column
 * period of 170.67 texels -- 1024 / 6 -- at a peak/median of 2565, and the g, b
 * and a channels return 85.33, 170.67 and 170.67 at 176, 88 and 2478. A
 * peak/median in the thousands is not a texture with some structure in it, it is
 * a spectral LINE, and that line is what the frame draws. The authored EIGHT is
 * used below rather than the projected six because it is the SMALLER cell and
 * therefore the more protective guard; the six is what a 1-D projection of a
 * jittered 2-D cell field reports and is corroboration, not a second number.
 */
export const HORIZON_CARRIER_CELLS = 8;

/** The two rungs' cell sizes in metres: the tile over the carrier's cell count. */
export const HORIZON_CELL_MID_M = HORIZON_MID_TILE_M / HORIZON_CARRIER_CELLS;
export const HORIZON_CELL_FAR_M = HORIZON_FAR_TILE_M / HORIZON_CARRIER_CELLS;

/**
 * THE CELL GUARD's band, in PIXELS PER CELL, and it is HORIZON_TILE_PX_OUT's own
 * sentence read back at the right scale: "at 24 px a repeat is a texture, at
 * 6 px it is a lattice". The fade therefore starts where the cell stops reading
 * as ground and is complete before it reaches the pitch that generates a grid.
 *
 * IT IS READ OFF THE FRAME AND NOT ARGUED. World audit R3 section 4.2 measured
 * the lattice at `forestair` on one frame at three heights: 9.14 px at y540,
 * 12.80 px at y660 and NO PEAK IN BAND at y820. The lattice is present where the
 * repeat spans nine to thirteen pixels and absent where it spans twenty or more,
 * and those are the two numbers below.
 */
export const HORIZON_CELL_PX: readonly [number, number] = [24, 12];

/** The two guards in METRES OF PIXEL FOOTPRINT, derived rather than typed. */
export const HORIZON_CELL_FOOT_MID: readonly [number, number] = [
  HORIZON_CELL_MID_M / HORIZON_CELL_PX[0], HORIZON_CELL_MID_M / HORIZON_CELL_PX[1],
];
export const HORIZON_CELL_FOOT_FAR: readonly [number, number] = [
  HORIZON_CELL_FAR_M / HORIZON_CELL_PX[0], HORIZON_CELL_FAR_M / HORIZON_CELL_PX[1],
];

/**
 * RN-2421. THE ANALYTIC STAND-IN's two octave wavelengths, in metres.
 *
 * WHY THE VALUE HALF NEEDS ONE AT ALL. Apply the guard above and the carrier's
 * value half has no legal band left: the mid rung fades IN at a 0.60 m footprint
 * and its 4 m cell is already under twelve pixels by 0.33 m, and the horizon
 * rung fades in at 1.80 m with its 16 m cell under twelve pixels by 1.33 m.
 * Every metre of the far ground's range is inside the regime where this carrier
 * paints a grid. `?horizonval=0` measures what that half is worth
 * (`forestair`'s patch std 6.24 -> 3.39), so retiring it without a replacement
 * hands rank 1 back its "the far ground has no material" in exchange for
 * closing rank 2, which is a trade and not a fix.
 *
 * WHY AN ANALYTIC FIELD IS ALLOWED WHERE THE CARRIER IS NOT, and this is the
 * whole of the argument: the carrier's spectrum has a LINE at its cell frequency
 * (peak/median 2565, measured above), so undersampling it stamps that one
 * frequency across the frame; `ofArtVnoise` is broadband with no line to stamp,
 * which is why the same two octaves the massif term already runs on `pM` have
 * never produced a lattice at any range. It is therefore faded on this
 * material's OWN Nyquist curve (0.125 to 0.333 of the wavelength) rather than on
 * the pixels-per-cell band, and the difference between the two rules is a
 * measured property of the two fields rather than a preference.
 *
 * THE PAIR: 40 m is 2.5 times the horizon rung's own cell, so it holds at least
 * twenty-four pixels per cycle exactly where the cell falls under twelve; 160 m
 * is four times that, which is the ladder's step with no gap between the two.
 * They are `pM` octaves for the massif term's reason and under the massif term's
 * gate: past a 1.8 m footprint `pM`'s 62.5 mm quantum is a thirtieth of a pixel
 * and falling, which is what makes the coordinate legal out here (RN-45).
 */
export const HORIZON_AN_M: readonly [number, number] = [40, 160];

/**
 * The stand-in's two octave weights and its amplitude. The weights are the
 * massif's own split (a coarse octave carrying most of the field with a finer
 * one on top of it) because the shape of the claim is the same; the AMPLITUDE is
 * this lane's ONE FITTED NUMBER and it is fitted against an instrument rather
 * than an eye: it is the value that holds `forestair`'s 256 x 128 patch std at
 * the shipped 6.24 once the carrier's value half has retired out of it.
 */
export const HORIZON_AN_WA = 0.62;
export const HORIZON_AN_WB = 0.38;
export const HORIZON_A_ANALYTIC = 1.65;

/**
 * RN-2475. THE PLAINS MACRO GAIN, and it is the whole of the fix for world audit
 * R4's rank 1.
 *
 * WHAT IS ACTUALLY WRONG, and it is neither a missing term nor a broken gate.
 * At the plains site, one flag apart on one build, on the new `midfield.r250`
 * rectangle (the first rectangle in this project that frames the plains far
 * ground -- see artframe.js for why `meadow.hzBand` never could):
 *
 *   shipped                iqr 32.63
 *   ?horizoncellan=0       iqr 17.42   the stand-in removed
 *   ?horizon=0             iqr 17.42   EVERYTHING removed, to the digit
 *   ?horizonmassif=0       iqr 32.63   the massif is a NULL there
 *   ?aerosol=0             iqr 32.62   the AIR is a null there, 0.01 counts
 *   ?grass=0               iqr 32.63   the rectangle is pure terrain
 *   ?horizoncellan=6       iqr 133.05  and the term responds to amplitude
 *
 * Read those seven rows together and there is only one conclusion available.
 * **RN-2421's analytic stand-in is the ONLY thing drawing the plains far ground
 * -- it is 15.2 of the rectangle's 32.6 counts and removing it lands exactly on
 * removing the whole term -- and its amplitude was fitted somewhere else.**
 * HORIZON_A_ANALYTIC was chosen to hold `forestair`'s patch std at 6.24, i.e. at
 * an AERIAL pose over FOREST, and the plains far ground inherited that number
 * without anybody ever measuring it there, because there was no rectangle there
 * to measure with.
 *
 * WHY A PLAIN NEEDS MORE OF IT THAN A MOUNTAIN DOES, which is the argument this
 * constant rests on. On relieved ground the far field is the stand-in PLUS the
 * massif's 390 m and 1240 m octaves at MASSIF_A_VALUE = 1.5. On a plain the
 * massif is off by its own relief-band gate -- painted, `msfBand` reads luma
 * 0.17 with p95 0.00 at `midfield`'s far band against 215.76 saturated at
 * `vista.mid` on the same build -- and that gate is RIGHT: putting 390 m
 * mountain octaves and their NORMAL half on flat ground lights a meadow like a
 * dune field, and MASSIF_BAND's own note promises the plains are untouched. So a
 * plain gets one macro term where a hill gets three, and nothing in the material
 * ever noticed.
 *
 * SO THE GAIN RIDES THE MASSIF GATE'S OWN COMPLEMENT. `1 + gain * (1 - msfBand)`
 * is exactly 1 wherever the massif is at full strength, which makes every
 * relieved pose BIT-IDENTICAL by construction rather than by tuning, and it
 * introduces no fade constant of its own: the boundary is the one MASSIF_BAND
 * already draws. That is RN-2195's complementary-fade idiom, which this file
 * already spends twice (the stand-in against the cell guard, the cell guard
 * against the carrier), applied to the one seam that had nothing on the far side
 * of it.
 *
 * THE VALUE IS 0.5 AND IT IS READ OFF THE LADDER RATHER THAN LIKED. The
 * amplitude sweep at `midfield.r250`, one flag apart on one build, is 17.42 at
 * 0x, 32.63 at 1x, 43.83 at 1.5x, 53.56 at 2x and 133.05 at 6x. The mid field's
 * own committed rectangles at this pose read 41.78 at r35, 41.41 at r60 and
 * 47.33 at r120, so "the far ground carries what the mid field carries" is the
 * 41-to-47 band, and 1.5x lands at 43.83, inside it. 2x is refused for the same
 * shape of reason MASSIF_A_VALUE refuses 2.50: past the mid field's own contrast
 * the distance stops reading as ground and starts reading as a watercolour, and
 * there is nothing else drawing out there to argue with it.
 *
 * WHAT THIS IS NOT, recorded because it was BUILT AND MEASURED AND THROWN AWAY
 * rather than reasoned past. The first design was two coarser octaves (640 m and
 * 2560 m) handed over on the 160 m octave's own Nyquist complement, on the
 * reading that the footprint at the plains far band is tens of metres and every
 * existing octave has retired there. That reading came from the SHOT MANIFEST's
 * `footM`, which inverts a FLAT PLANE and reports 48.6 m at r250. The shader's
 * own `footM` is `max(length(dFdx(vWorld)), length(dFdy(vWorld)))` and, painted
 * as a step ladder at that same rectangle, it lands between **1.8 and 8.0 m**.
 * The two disagree by an order of magnitude because the ground at this site is
 * not a plane: it swells, so the visible horizon is a crest a few hundred metres
 * out rather than the 1,549 m geometric one, and the incidence is nothing like
 * grazing. The far pair therefore never faded in at all -- `?horizonfar=20`
 * moved the rectangle by **0.00 counts**, which is what a term outside its own
 * gate looks like, and is the same shape as HORIZON_ECO_GATE's own scar one
 * range band out. See NUMBERS.md.
 */
export const HORIZON_AN_PLAINS_GAIN = 0.5;

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
 * THE WARP's DERIVATIVE BUDGET, and the two amplitudes are DERIVED from it
 * rather than typed beside it, because the budget is the thing that must hold
 * and the amplitude is only how it is spent at a given repeat count.
 *
 * IT IS A DERIVATIVE BUDGET AND NOT A LOOK, on SPLAT_WARP_UV's argument
 * verbatim. The warp perturbs the sample coordinate's derivative by roughly
 * amplitude x 2 pi x repeats, and 12.3 per cent moves the hardware mip choice
 * by log2(1.123) = 0.17 of a level -- the same budget the shipped near-field
 * warp spends (11 per cent, 0.15 of a level) and for the same reason: past
 * about a fifth of a mip level a term is paying for its anti-tiling in
 * filtering. 0.123 is the number the one-warp version spent (0.0098 x 2 pi x 2)
 * and it is carried over UNCHANGED, so the two-warp fix costs no extra
 * filtering and this is a decorrelation change and not a strength change.
 *
 * WHAT THAT BUDGET BUYS IN WORLD METRES, and it is the honest half. A warp of
 * period L displacing by d perturbs the derivative by 2 pi d / L, so holding
 * the budget fixed makes the displacement PROPORTIONAL TO THE WARP PERIOD:
 * 0.264 m at the mid rung and 1.00 m at the horizon rung. Because both periods
 * are the same fraction (0.4) of their own rung's tile, both come out at 0.8
 * per cent of a tile, which is far less RAW displacement than the 7.8 per cent
 * the one-warp version claimed at the mid rung.
 *
 * THE DECORRELATION IS NOT THE DISPLACEMENT'S SIZE, WHICH IS WHY THAT IS NOT A
 * REGRESSION. A displacement in register with the tile decorrelates NOTHING at
 * any amplitude (it moves every copy identically), and that is exactly what
 * 7.8 per cent bought at the horizon rung: a lattice. What breaks a repeat is
 * neighbouring copies being displaced DIFFERENTLY, which is set by the warp's
 * period against the tile's, not by its amplitude. 19 and 5 cells per period,
 * coprime with 8 and 2, is that condition; the amplitude only has to be enough
 * to be seen, and a metre of ground at the horizon rung is.
 *
 * IT IS STILL NOT A FULL ANSWER AND IS NOT CLAIMED AS ONE, for SPLAT_WARP_UV's
 * reason: a domain warp bounded by a mip budget cannot hide a tiling texture,
 * it can only stop it reading as a grid. The two-carrier item beside it is the
 * other half.
 */
export const HORIZON_WARP_DERIV = 0.123;

export const HORIZON_WARP_UV_MID =
  HORIZON_WARP_DERIV / (2 * Math.PI * HORIZON_WARP_MID_REPEATS);
export const HORIZON_WARP_UV_FAR =
  HORIZON_WARP_DERIV / (2 * Math.PI * HORIZON_WARP_FAR_REPEATS);

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
