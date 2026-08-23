// Scatter tuning constants and the pure helpers that go with them.
//
// Split out of Scatter.ts at the 400-line cap. These are the numbers that
// decide how much foliage exists and how far it reaches, and every one of them
// carries the measurement that set it, so they are worth reading together and
// away from the placement machinery.

import type { PropSpec } from '../assets/Registry.js';

/** 33x33 vertices, so 32 cells a side. /core fixes this (kGridDim). */
export const DIM = 33;
export const CELLS = DIM - 1;
/**
 * Vertex spacing above which a chunk is too coarse to scatter onto. MEASURED,
 * not chosen: the streamer reaches depth 11 under a walking player at maxDepth
 * 12, and a depth-11 chunk is about 900 m across, so its cell is about 28 m.
 * A 14 m limit rejected every chunk in the world and the first run scattered
 * exactly nothing while reporting success. DW-19's finer LOD is what shrinks
 * this, and the prop's own placement error shrinks with it.
 */
export const MAX_CELL_M = 64;
/**
 * THE VEGETATION ORIGIN'S ALTITUDE CEILING, metres, and why a ring that costs
 * nothing to look at still needs one.
 *
 * The harvest ring is `TREE_RADIUS_M` (620 m) of GROUND, wherever the eye is.
 * Carry it up with a rocket and it keeps streaming a 620 m disc of trees on the
 * ground directly below, which is correct all the way up and worth nothing past
 * the altitude at which a tree is smaller than a pixel. At the shipped
 * 1600x900 / 60 degree frame that is 1,086 px per radian, so a 12 m median tree
 * (TreeTuning's own figure) covers one pixel at
 *
 *     d = 12 * 1086 / 1  =  13,032 m
 *
 * and the ring is switched off above it. 12,000 rather than 13,032 because the
 * flyover pose is 1,200 m and the `ascent` scenario is 12,000 m: rounding DOWN
 * to the scenario boundary means the one scenario that straddles the cutoff
 * sits on the cheap side of it rather than a third of a pixel inside the
 * expensive one.
 *
 * It is a STREAMING radius and not an existence rule, which is the same
 * distinction `TREE_RADIUS_M` already lives on: no tree stops being an
 * attribute of the planet up here, the client just stops materialising nodes
 * nobody can see. What DOES draw at altitude is the canopy scatter's impostor
 * tier (RN-2231), which is instanced rather than /core-backed and costs no node
 * array entry.
 */
export const VEG_ORIGIN_MAX_ALT_M = 12000;

/**
 * Chunks sampled per update, whether newly resident or crossing the detail
 * boundary. One chunk is about a thousand cells and up to a few thousand props,
 * and letting several land in one frame put a 57.1 ms worst frame on an
 * otherwise 5.6 ms p50. Amortising is free visually because both triggers fire
 * well inside the scatter radius: a chunk has seconds of walking in hand before
 * its understorey is in view, and the ring refills in about 0.35 s after a
 * teleport. `scatterBacklog` reports the queue so this can never quietly become
 * a scatter that never catches up.
 */
export const BUILDS_PER_UPDATE = 1;
/**
 * Instances per chunk ceiling, and how far from the eye scatter reaches.
 *
 * Both caps used to be silent, which is the DW-28 shape. They are now COUNTED
 * (`cellsCapped` / `chunksCapped` in `stats()`), so a probe can assert that the
 * near field is delivering the density the registry asked for rather than the
 * density a cap allowed. That counter earned itself immediately: at the shipped
 * understorey a depth-14 chunk wholly inside the detail ring wants 3,106 props
 * and the old MAX_PER_CHUNK of 2,600 truncated it, which would have been an
 * invisible 16% shortfall on exactly the chunk the player is standing on.
 */
export const MAX_PER_CHUNK = 14000;

/**
 * WG-304. THE CANOPY-ONLY CHUNK'S CEILING, in instances per SQUARE KILOMETRE
 * of chunk, and the constant that repairs a regression WG-301 caused.
 *
 * WHAT WENT WRONG, and it is worth keeping because the fix looked free.
 * WG-301 replaced `MAX_PER_CHUNK`'s raster-order first-N truncation with a
 * density scale, which is strictly better as a SHAPE: the same budget covers
 * the whole chunk instead of one strip. It shipped, and `rn2550guard` went red
 * at `forestairnoon` with `crowns` rho **0.1890 to 0.1596** against a
 * `BAND_LOW` of 0.18, and coverage `f` **0.6029 to 0.3695**. Separated on this
 * build with the two shipped flags: `?capfair=0` restores BOTH numbers to the
 * pinned values **to four decimals**, and `?canopytail=1` leaves rho at 0.1596
 * unchanged, so the reach half is innocent and this half owns all of it.
 *
 * **THE TRUNCATION HAD BEEN PROPPING THE POSE UP, AND THE PROP WAS LOAD
 * BEARING BY LUCK.** The scan runs `cy` from 0, so a capped chunk spends its
 * whole budget on one edge of itself, and at this pose that edge is the NEAR
 * edge, which is the ground the `crowns` rectangle looks at. Redistributing
 * uniformly therefore took 39 per cent of the card coverage OUT of the one
 * rectangle the guard measures and spread it over 3.7 km of chunk. That is
 * NUMBERS.md's "a defect can be propping up the very number its fix is judged
 * by" (RN-2590) with the accident running the other way for once: the defect
 * was accidentally near-field-favouring, which is accidentally right for a
 * downward-looking aerial pose. **And the frames agree it is a LOOK
 * regression and not an instrument artefact**
 * (`WG304_crowns_capoff_4x.png` against `WG304_crowns_ship_4x.png`): closed
 * woodland with overlapping crowns becomes scattered individual trees on open
 * ground. The guard was right and the number was not the whole of it.
 *
 * **THE REPAIR IS THE CEILING AND NOT THE REDISTRIBUTION.** `MAX_PER_CHUNK` is
 * a per-CHUNK COUNT, and a chunk's area quadruples at every LOD step outward,
 * so as a DENSITY ceiling it tightens fourfold every step: at depth 14 it
 * allows four million instances per km2 and at depth 8 it allows 1,034. That
 * is exactly backwards for a tier whose whole job is the far field, and it is
 * why the honest redistribution of a wrong budget looks worse than the
 * dishonest concentration of it. Expressed per unit AREA the ceiling stops
 * being a function of LOD depth at all.
 *
 * **THE VALUE IS THE MEASURED KNEE OF A LADDER AND NOT A SWEEP TO GREEN**, and
 * the ladder is what says the residual is the world rather than the cap. Run at
 * `forestairnoon`, one build, one page param apart, with `canopyProps` read at
 * `forestair`:
 *
 *   per km2   capScaleMin   canopyProps   f        rho      vs BAND_LOW 0.18
 *   0 (flat)     0.4051       83,443     0.3695   0.1596    -0.0204  FAIL
 *   1,200        0.4212       84,903       --       --        --
 *   2,400        0.8425      117,142     0.5538   0.1830    +0.0030
 *   4,800        0.9482      120,854     0.5843   0.1873    +0.0073
 *   (`?capfair=0`, the truncation)  85,970     0.6029   0.1890    +0.0090
 *
 * Doubling 2,400 to 4,800 adds 3,712 instances (3.2 per cent) and buys
 * +0.0043 of rho; `capScaleMin` 0.9482 says the cap is then barely binding at
 * all, so **rho asymptotes at about 0.188 and the last 0.0017 is the
 * difference between a uniform forest and a concentrated one, not a budget**.
 * 4,800 rather than 2,400 because +0.0030 of headroom is not a state to hand a
 * pose to: RN-2645 already argued about 0.0090 as thin, and the next lane to
 * touch canopy shade would turn main red again.
 *
 * WHAT BINDS WHERE, so the constant is not read as doing more than it does. A
 * depth-9 chunk is 3.39 km2 and gets `4800 * 3.39` = 16,272; a depth-8 chunk is
 * 13.54 km2, asks 65,000 and is held at `CANOPY_CHUNK_MAX`. So the per-km2 rule
 * is the depth-9 governor and the absolute backstop is the depth-8 one, and the
 * `crowns` rectangle at 2.2 to 2.8 km straddles exactly that boundary, which is
 * why both halves had to move together.
 *
 * `CANOPY_CHUNK_MAX` is the POOL and not the frame: the `OF_Canopy` batch holds
 * 131,072 instances (`PropLibrary.CANOPY_MAX_CAPACITY`), and one chunk allowed
 * more than a quarter of the batch could refuse every other chunk in the ring
 * on its own. `poolRefused` is the counter that would say so and it must stay
 * 0. **THE HEADROOM IS NOW THE THING TO WATCH AND IT IS ROUTED RATHER THAN
 * SPENT:** `forestair` reads 120,854 live canopy instances, **92.2 per cent of
 * the batch**, against 77,387 before this campaign. That is not slack this fix
 * created, it is slack the truncation was hiding: the honest full-density
 * Forest aerial needs about that many, and the flat ceiling was refusing them
 * while reporting `canopyDelivered` 1.00. Raising `CANOPY_MAX_CAPACITY` is
 * rendering's constant and an Admin decision, and it is asked for rather than
 * taken.
 *
 * RN-2676 (lane N17, rendering, on world-gen's own named gap). `CANOPY_MAX_
 * CAPACITY` is raised in the same commit (see `PropLibrary.ts`) and THIS
 * ceiling gets its own page param, `?canopychunkmax=`, because the WG-304
 * post-merge verifier named it "the only ceiling still binding at the shipped
 * value and it has no page param, so the one live constraint cannot be
 * swept". The default is UNCHANGED (`?canopychunkmax=` defaults to this
 * constant), so the shipped binary is bit-for-bit what it was before the
 * param existed. See `canopyChunkCap`'s new `maxCap` argument and
 * rendering.md 2.45 for the outcome-readback proof (swept at `forestair`,
 * `?canopychunkmax=0` collapses `canopyProps`; swept up past 32,768 it rises
 * past the shipped 120,854 toward the one still-capped depth-8 chunk's
 * uncapped area-rule ask, which is what sized the new pool ceiling).
 */
export const CANOPY_CHUNK_KM2 = 4800;
export const CANOPY_CHUNK_MAX = 32768;

/**
 * WG-304. The instance ceiling for a chunk the ground tiers have refused.
 *
 * Floored at `MAX_PER_CHUNK` so this can only ever RAISE a coarse chunk's
 * allowance, never lower one: a depth-9 chunk is 3.39 km2 and the area rule
 * alone would give it 16,272 at CANOPY_CHUNK_KM2 4,800 (an earlier draft computed 8,127 from the 2,400 rung; merge-time correction), which at the 2,400 rung would have been tighter than today and would be a second
 * silent thinning introduced by a fix for the first.
 *
 * `maxCap` (RN-2676) defaults to `CANOPY_CHUNK_MAX` and is the injection point
 * for `?canopychunkmax=`: the OUTER ceiling, so `0` degenerates the whole
 * function to 0 regardless of `areaKm2` or `perKm2` (a deliberate, dramatic
 * control -- see the constant's own comment) and a value below `MAX_PER_CHUNK`
 * can make this function return LESS than `MAX_PER_CHUNK`, which is correct
 * for a sweep param even though the shipped default never does it.
 */
export function canopyChunkCap(
  areaKm2: number, perKm2 = CANOPY_CHUNK_KM2, maxCap = CANOPY_CHUNK_MAX,
): number {
  const byArea = Math.ceil(Math.max(0, areaKm2) * Math.max(0, perKm2));
  return Math.min(Math.max(0, maxCap), Math.max(MAX_PER_CHUNK, byArea));
}

export const MAX_PER_CELL = 160;
export const RADIUS_M = 170;
/**
 * cos of the steepest ground a prop will stand on, about 57 degrees. 40 degrees
 * was the first guess and it emptied the Mountains biome: a mountain FLANK is
 * steeper than that almost everywhere, so the one biome whose whole identity is
 * loose rock had no loose rock on it.
 */
export const MIN_SLOPE_COS = 0.55;
/** Screen-space-free LOD: props past this distance draw their LOD2 geometry. */
export const LOD2_M = 45;
/**
 * Standing water over a cell above which nothing is scattered on it (RN-46).
 *
 * WG-35 to WG-42 cut a real pond into `sampleDesignedHeight`, so the pond bed is
 * ORDINARY GROUND as far as this code is concerned: it has a legal slope, it has
 * a biome, and it therefore grew grass cards, pebbles and snow patches four
 * metres under water, plus a rim of cards standing in the shallows at the
 * waterline. Nothing in the scatter was wrong; the scatter simply had no notion
 * that water existed.
 *
 * 0.02 m rather than 0 because the test has to survive the shoreline. Right at
 * the waterline the depth passes through zero continuously, and an exact `> 0`
 * would make the accept/reject decision turn on the last bit of a float. Two
 * centimetres is below anything that could ever be visible on a 0.4 m card and
 * comfortably above the noise in the ground sample.
 *
 * The test is PER CELL, so the shoreline is resolved at the terrain's own cell
 * size, which DW-19 puts at 1.808 m under a walking player. A cell straddling
 * the waterline is accepted or rejected whole. That is the right granularity
 * here: it is finer than the 5.4 m of dry beach the water shell already leaves
 * inside the basin rim, so the scatter boundary lands under the shell rather
 * than outside it.
 */
export const WET_REJECT_M = 0.02;
/**
 * WHY THE PER-CELL WATER QUERY IS GATED ON THE BASIN AND NOT ON THE LEVEL.
 *
 * RN-46's first guard was "is this cell below the water's level radius", on the
 * unexamined assumption that a water level sits near the datum. It does not.
 * The shipped pond is at the Mountains spawn, so its level is 4,667 m and its
 * level radius is 604,667 m, while the Hills test site stands at 600,861 m.
 * Every cell over most of the planet passed that guard and paid a WASM call to
 * be told its column was dry. Measured at the two test sites: the pond's basin
 * is 22 m across and the Hills site is 121,813 m from it.
 *
 * The basin is the honest bound and it comes from the oracle's OWN published
 * disc rather than from a rule restated in the scatter. `Scatter.sample` keeps
 * the level-radius test as the second, per-cell half; the basin gate is what
 * removes the other 99.99% of the planet before either runs.
 *
 * THREE DEFECTS IN ONE FEATURE, all found by ONE probe (`probes/pondscatter.js`)
 * and none by the counter RN-46 shipped. The counter read 0 at two DRY sites
 * and that was reported as evidence. It is not: zero at a dry site is equally
 * consistent with the filter working and with the filter not existing. The
 * three were (a) the flag handed the oracle over only when the rejection was
 * meant to be OFF, so it never ran in any build, (b) `depthAt` takes a
 * normalized DIRECTION and was being handed an absolute 6e5 m position, and
 * (c) this gate. The general rule: a filter is proved by the case it is
 * supposed to CATCH, never by the case it is supposed to ignore.
 */
/**
 * How far the ground-detail card layer reaches. Confining it is what keeps the
 * shared OF_Grass batch inside its ceiling while the ground the player is
 * actually standing on gets a real understorey: at 55 m the ring is 9,503 m2
 * against the full scatter ring's 90,792, so a card costs 10.5% of what a shrub
 * costs. 55 rather than 40 because the measured screen coverage at a -15 degree
 * pitch is dominated by ground BEYOND the ring, and a 0.58 m card still carries
 * several pixels at 55 m.
 */
export const DETAIL_RADIUS_M = 78;
/**
 * Inside this radius the understorey is drawn at FULL density; between here and
 * `DETAIL_RADIUS_M` it thins linearly to `DETAIL_EDGE_W`.
 *
 * The falloff exists because the hard edge was VISIBLE and is the second thing
 * the eye finds in a wide shot after the bare ground itself: at a fixed Hills
 * camera the understorey stopped dead in a line across the hillside, with dense
 * cover on one side of it and untouched olive terrain on the other. A ring that
 * ends is a ring you can see the edge of, whatever radius you put it at, so the
 * fix is not a bigger number, it is a gradient.
 *
 * The edge weight is 0.18 rather than 0 for the same reason: a linear fall to
 * exactly zero puts the last card AT the boundary and re-creates a fainter
 * version of the same line. 0.18 of full density at 78 m is roughly the density
 * the whole ring used to have, so the old look is now the outermost band of the
 * new one.
 */
export const DETAIL_FULL_M = 30;
export const DETAIL_EDGE_W = 0.18;
/**
 * Understorey weight for one cell, from its distance to the eye. A pure
 * function of distance so it can be read next to the density it multiplies.
 */
export function detailWeight(d: number): number {
  if (d <= DETAIL_FULL_M) return 1;
  if (d >= DETAIL_RADIUS_M) return 0;
  const t = (d - DETAIL_FULL_M) / (DETAIL_RADIUS_M - DETAIL_FULL_M);
  return 1 + (DETAIL_EDGE_W - 1) * t;
}
/**
 * How much a card GROWS with distance, at the outer edge of the ring.
 *
 * Coverage is what the eye reads, not instance count (Registry's DENSITY_SCALE
 * note makes the same point), and coverage is density times footprint. The
 * falloff above spends instances where they are cheap to see and saves them
 * where they are not, and this buys some of that coverage back for free: a card
 * at 70 m is a few pixels tall, so making it 45% larger costs nothing in
 * silhouette honesty and holds the ground looking covered rather than moth
 * eaten out at the edge. It is applied to the DETAIL tier only; a boulder that
 * grew with range would be obvious.
 */
export const DETAIL_FAR_GROW = 0.32;

// ===========================================================================
// THE CANOPY TIER (WG-59 to WG-63). A forest at world scale.
//
// Everything above this line is ground cover: the tallest thing it can place
// is a 1.6 m fern, and it all stops at 170 m. That is why there was no forest.
// The only living trees in the world were the 14 harvest nodes on a spiral out
// to 56 m, and the Forest atlas deliberately contained no live tree at all
// (`build_props_forest.py:9-12`), so past about 57 m of spawn there was nothing
// to accumulate into a horizon mass, at any distance, in any biome.
//
// The canopy is a FOURTH tier rather than more entries in the biome list,
// because a tree differs from a fern in every number that matters here: it is
// worth drawing ten times further out, it wants a much cheaper far geometry, it
// grows in stands hundreds of metres across rather than in 14 m patches, and it
// STOPS at an altitude. None of those are expressible as a density.
// ===========================================================================

/**
 * How far trees reach, and the number this whole pass is judged on.
 *
 * WHAT SET IT, and what it does NOT buy. Cost grows as the square of this, and
 * a tree is drawn in the near pass plus every shadow cascade. The measured
 * ladder is in world-gen.md section 6.2; 520 m is the widest ring whose added
 * triangles stay inside the frame budget once the understorey it shades is
 * subtracted. It is enough to put a treeline on the near ridges and to fill the
 * middle distance, which is what was missing.
 *
 * It is NOT enough to reach the true horizon on a body with kilometres of
 * visible ground, and no arithmetic makes it so: at 2 km the same density is
 * fifteen times the instances. A horizon treeline needs a far-field impostor
 * layer, and this client has none (there is no billboard, impostor or card
 * mechanism anywhere in `web/src/render`). That is a rendering-lane ask and it
 * is recorded as one rather than half-built here.
 */
/**
 * How far trees exist around the player, metres, and the number this pass is
 * judged on. Swept from a URL (`?trees=`) because cost goes as its SQUARE and
 * the shipping value has to be the largest ring the frame budget holds.
 *
 * THE RING HAS A HARD EDGE AND THAT IS DELIBERATE. The retired canopy tier
 * thinned its density from 300 m outward (`canopyDistanceWeight`), which made
 * the boundary invisible at the cost of making a tree's EXISTENCE a function of
 * how far away the player was standing when its chunk was built. A harvest node
 * cannot pay that: it is a thing you can chop, so it must be there before you
 * decide to walk to it. Uniform density to the edge is the only honest choice,
 * and the edge is softened by TREE_EDGE_WANDER_M below rather than by a fade.
 */
export const TREE_RADIUS_M = 620;

/**
 * The ring's radius is displaced by a smooth world-space field by up to this
 * many metres, so the boundary is a ragged margin rather than a circle centred
 * on the player. Same argument as `TREELINE_WANDER_M` one tier up: without it
 * the eye finds the shape immediately, and a circle that follows you is worse
 * than a contour line because it is obviously about you.
 *
 * It cannot remove the pop, only the geometry of it. A true horizon treeline
 * needs the far-field impostor layer WG-63 already asked rendering for.
 */
export const TREE_EDGE_WANDER_M = 70;

/**
 * Lattice cell size, metres of ground per side. Larger than the rocks' 24 m
 * because the ring is thirteen times the area and the scan is per cell: at 28 m
 * a 620 m ring is about 1,540 cells against the rock ring's 154.
 */
export const CANOPY_RADIUS_M = 620;
/**
 * Inside this the canopy is at full density; from here to `CANOPY_RADIUS_M` it
 * thins linearly to `CANOPY_EDGE_W`.
 *
 * THE FIRST VERSION HAD NO FADE AND THE EDGE WAS THE FIRST THING IN THE FRAME.
 * `docs/screenshots/WG59_walk_c520_noedge.png` shows it: the forest stops dead
 * in a straight line across the middle distance with open ground beyond, which
 * is precisely the defect `DETAIL_FULL_M` was written to fix one tier down, and
 * its comment says the durable half out loud: "a ring that ends is a ring you
 * can see the edge of, whatever radius you put it at, so the fix is not a
 * bigger number, it is a gradient."
 *
 * No number saw this. Every counter was healthy and the delivery ratio was
 * 1.0021. It took looking at the picture (DW-7).
 *
 * The fade is 320 m long, which is more than half the ring, and it has to be:
 * the understorey fades cards against ground of the same colour, while this
 * fades a 12 m silhouette against sky. A short fade would read as a hedge.
 * 0.16 rather than 0 for the same reason `DETAIL_EDGE_W` is 0.18: a linear fall
 * to exactly zero puts the last tree AT the boundary and re-creates a fainter
 * copy of the line.
 *
 * The fade also PAYS FOR the radius going 520 to 620 m: two thirds of the ring
 * is now thinned, which returns more triangles than the extra 100 m spends.
 */
export const CANOPY_FULL_M = 300;
export const CANOPY_EDGE_W = 0.16;
/**
 * Where a canopy tree drops to its far geometry. Nearly twice `LOD2_M`, because
 * a 12 m tree at 60 m is most of the frame's vertical while a 0.4 m card is
 * four pixels; sharing one distance would either pop the trees or pay LOD0 for
 * every blade of grass.
 *
 * WHY IT IS 78 AND NOT THE 105 THIS SHIPPED WITH FOR ONE MEASUREMENT. A prop
 * batch has `frustumCulled` and `perObjectFrustumCulled` both FALSE and casts
 * into three shadow cascades, so **every tree is drawn four times** and its
 * triangles are counted four times. Measured at the Forest site at 105 m: the
 * canopy cost 186,109 triangles for 1,657 trees, which is 112 per tree against
 * an LOD2 of 26 to 30, and the 69 trees inside the LOD0 radius were 85,600 of
 * it on their own. The near tree is four times its own cost, so the LOD0 radius
 * is the single most expensive number in this file.
 *
 * It is set EQUAL to `DETAIL_RADIUS_M` rather than merely near it. `write`
 * picks LOD once, at build time, so a switch distance that is not a chunk
 * rebuild boundary is quantised to the nearest one anyway; putting it exactly
 * on the understorey boundary means the chunk that changes the tree's geometry
 * is a chunk that was already going to be rebuilt, and the fourth rebuild band
 * a distinct value would need does not have to exist.
 *
 * WHAT WOULD LET IT GO BACK OUT: a third LOD tier. The trees are authored with
 * 296 to 310 triangles at LOD0 and 22 to 30 at LOD2, and the gap between them
 * is where a 90-triangle mid tier belongs. `PropPart` carries exactly two
 * geometry ids and that is rendering's file, so it is an ask and not a change.
 */
export const CANOPY_LOD2_M = DETAIL_RADIUS_M;
/**
 * RN-2202. WHERE THE CONE HANDS OVER TO THE IMPOSTOR CARD, and the paragraph
 * above is the reason this constant exists at all: "what would let it go back
 * out: a third LOD tier ... `PropPart` carries exactly two geometry ids and
 * that is rendering's file, so it is an ask and not a change." It carries four
 * now (`render/instancing/PropLods.ts`), and this is the ask being answered.
 *
 * THE RUNGS, from the shipped bytes: LOD0 is 334 to 784 triangles, LOD2 is a
 * hand-authored cone at 28 to 58, and LOD3 is a trunk stub plus two crossed
 * leaf quads at 12. So the cone is two-and-a-half to five times the card, and
 * the whole question is how far out the cone is still buying an image.
 *
 * DERIVED, NOT PICKED. What the card gives up is the crown's PLAN shape: a
 * crossed pair projects its full width at the cardinal bearings and about 71
 * per cent of it at 45 degrees, against a cone that projects the same width at
 * every bearing. That is a silhouette wobble of roughly 15 per cent of the
 * crown, which stops reading as an error and starts reading as variety once the
 * tree is small on screen. Taking "small" as 20 pixels of height, at the
 * shipped 1600x900 / 60 degree frame (779.4 px per metre per metre of range,
 * NODE_LOD3_M's derivation),
 *
 *     d = H * 779.4 / 20   ->   broadleaf (10.5 m) 409 m
 *                               pine      (12.0 m) 468 m
 *                               fir       (16.5 m) 643 m
 *
 * and the threshold takes the SHORTEST of the three, 409 rounded to 420, so no
 * canopy tree hands over while it is bigger than the bar. One number rather
 * than three because `PropSpec` would need a per-prop field to carry three and
 * the spread is 1.6x, well inside the hysteresis a chunk-rebuild boundary
 * already imposes on this switch.
 */
export const CANOPY_LOD3_M = 420;
/**
 * THE TREELINE, in metres of designed altitude. Full canopy at or below
 * `TREELINE_FULL_M`, nothing at or above `TREELINE_BARE_M`.
 *
 * These are altitudes and not biome ids on purpose. The biome classifier's
 * Forest band ends at normalised relief 0.150 and Mountains begins at 0.330,
 * and if trees simply stopped at a biome edge the treeline would be a hard line
 * at a classifier threshold, which is the one thing a real treeline never is.
 *
 * WHERE THE NUMBERS CAME FROM, and they were WRONG on the first attempt in a
 * way worth keeping. 1,400 and 2,300 were derived from the section 6.1 survey's
 * altitude-to-relief mapping so that the fade spanned the whole Hills band and
 * ended at the Mountains boundary. Measured, that put the ENTIRE fade above
 * every site in the survey that has trees: the Hills candidates at 1,897 m and
 * 2,077 m still scored 13% density instead of bare, and `canopyBareCells` read
 * exactly 0 at all seven sites. The counter is what caught it. The term was
 * running and was reachable only in Mountains, which had no canopy specs at all
 * and therefore never evaluated it, so the ONE place the treeline was supposed
 * to bite was the one place the code never looked. That is INSTRUMENTS.md's
 * "a term measured only where it cannot work reports its own absence", and it
 * had been invisible if the counter had not been there to read 0.
 *
 * 950 and 1,850 put the fade INSIDE the Hills band, where Hills actually is:
 * the RN-15 camera at 861 m is closed woodland, `hills2` at 1,897 m sits on the
 * treeline itself, and `hills` at 2,077 m is above it with stragglers. Note
 * that the altitude and the biome boundary do NOT track each other, because the
 * classifier runs on RAW relief and this runs on DESIGNED height: the survey has
 * Hills at 861 m and at 2,077 m, a range of 1.2 km. That divergence is why an
 * altitude is the right handle and a biome id is not.
 *
 * `TREELINE_WANDER_M` is why it is not a contour line. The threshold is
 * displaced by the same world-space field the stands come from, so the treeline
 * fingers up gullies and retreats off exposed shoulders. Without it the eye
 * finds the altitude immediately and the hillside reads as a topographic map.
 */
export const TREELINE_FULL_M = 950;
export const TREELINE_BARE_M = 1850;
export const TREELINE_WANDER_M = 240;
/**
 * Steepest ground a canopy tree stands on, about 44 degrees, tighter than the
 * 57 degrees everything else gets. A boulder on a 55 degree flank is a boulder
 * that fell there; a 16 m tree on one is a tree growing out of a cliff. Bare
 * crags inside a forest are also most of what makes a forested slope legible.
 */
export const CANOPY_MIN_SLOPE_COS = 0.72;
/**
 * STAND SIZE. Two octaves of world-space value noise, in metres.
 *
 * A forest is not a density, it is stands and clearings, and this is the whole
 * difference between trees-on-the-ground and a forest. `ScatterLook`'s existing
 * `CLUSTER_SHIFT` patch lattice cannot do this job and its own comment says
 * why: it is CHUNK-LOCAL, so its patch size is whatever the LOD depth makes it
 * (14 m at the feet, 460 m at the far edge of this ring) and its pattern
 * restarts at every chunk boundary. At 170 m that restart is another patch
 * edge and nobody notices. At 520 m the chunk boundaries ARE the feature size,
 * so it would tile visibly.
 *
 * So the stand field is sampled in BODY-FRAME METRES and is a pure function of
 * position, exactly like every other thing world-gen publishes (WG-6). It is
 * therefore also LOD-independent: the same ground gives the same stand whatever
 * depth of chunk it arrives on, which a chunk-local lattice cannot promise.
 *
 * SMOOTH noise rather than a tile hash, and that choice is load-bearing for
 * more than looks. A cell's world position is reconstructed as a float64 anchor
 * plus a float32 chunk-local offset, so the SAME ground sampled off two
 * different LOD depths differs in the last bits. Through a smooth field that is
 * a difference of order 1e-9 in the weight; through a hashed tile boundary it
 * would be a coin flip, and stands would visibly reshuffle every time a chunk
 * changed depth. This is the same class of problem as WG-51's shader phase, and
 * the cheap answer here is to make the function continuous.
 */
export const STAND_M = 165;
export const STAND_DETAIL_M = 52;
/** Stand-field values below LO are clearing, above HI are closed canopy. */
export const STAND_LO = 0.36;
export const STAND_HI = 0.63;

/**
 * WG-221. THE GROVE MASK: the scale ABOVE the stand, and the reason the air
 * view reads as a landscape rather than as one evenly-wooded plate.
 *
 * `STAND_M` is 165 m and it is the right size for what it was built for: from
 * a 1.6 m eye inside a 620 m ring, a 165 m stand is the largest structure the
 * frame can hold, and RN-2225's own flyover proved the tier's machinery works.
 * What that frame then showed is that a 165 m feature seen from 1,200 m over a
 * 3.5 km disc is FINE GRAIN. The eye reading an aerial photograph of forest
 * finds wood-and-field structure at HUNDREDS of metres to kilometres -- a wood
 * with a shape, a field beside it, a strip of trees along a watercourse -- and
 * a field whose only feature size is 165 m averages out to uniform speckle at
 * exactly the range this tier exists to fill.
 *
 * So the grove is a SECOND, COARSER field multiplied over the stand field
 * rather than a fourth octave inside it, and the distinction is not cosmetic.
 * Folding another octave into `standAt` would REDUCE the total variance (a
 * weighted sum of independent fields concentrates about its mean), which is the
 * opposite of what patchiness needs. A product of two ramped fields has the
 * variance of neither: a point is closed canopy only when it is inside a grove
 * AND inside a stand, and it is open when either says open. That is what puts
 * hard-edged clearings inside woods and bare ground between them.
 *
 * 760 m rather than a round kilometre because it has to be resolvable at BOTH
 * ends of the tier's own range: at the flyover's 3,500 m reach a 760 m grove is
 * about 4.6 features across the disc, which is a landscape; from a standing eye
 * at the 1,400 m ground reach it is half the visible depth, which reads as
 * "the wood ends over there" rather than as a texture. It is sampled in
 * BODY-FRAME METRES by the same `octave` the stand field uses, so every word of
 * `STAND_M`'s determinism argument applies unchanged: smooth rather than
 * hashed, LOD-independent, and a pure function of position (WG-6).
 *
 * `GROVE_FLOOR_W` is 0.12 and not 0 for `CANOPY_FLOOR_W`'s reason one scale
 * down: open ground with EXACTLY no trees on it is a hole with a rim, and a
 * hole 760 m across has a very visible rim. A tenth leaves hedgerow trees and
 * lone standards in the open ground, which is what open ground actually has.
 */
export const GROVE_M = 760;
export const GROVE_LO = 0.40;
export const GROVE_HI = 0.62;
export const GROVE_FLOOR_W = 0.12;

/**
 * WG-223. THE CROWN FIELD: the scale BELOW the stand, and it exists for the
 * question rendering parked rather than for the trees.
 *
 * rendering.md 2.14.7b measured `CANOPY_SHADE` woken and judged it worse: the
 * term cut the forest floor by 38.5 per cent as a spatially UNIFORM thinning,
 * because at a forest site `shadeW` (which was `canopyWeight`, i.e. stands
 * times treeline) is close to 1 across the whole visible floor. Its verdict
 * named the fix precisely -- "the shape of a fix, if it is wanted, is
 * PATCHINESS rather than magnitude: a `shadeW` that varies over tens of metres
 * (crown-scale) instead of one that saturates over a whole biome. That is a
 * world-gen question about the stand field, not a rendering constant."
 *
 * This is that field, and 34 m is the crown scale MEASURED rather than picked:
 * `tools/blender/contracts.json` gives the broadleaf a 8.4 x 10.5 m crown and
 * the two conifers 3.85 and 2.9 m, so a clump of three or four adjacent crowns
 * with the gap between clumps is a feature about thirty metres across. Dark
 * under the clump, bright in the gap, which is what the eye reads as canopy
 * shadow and what a uniform multiplier can never be.
 *
 * NOTHING IS WIRED HERE. `CANOPY_SHADE` is still default OFF (`Config
 * .canopyShade`, `?canopyshade=1` to arm it) and Admin's ruling is still open.
 * What this lane changes is that the value the term reads is now the crown-
 * scale one, so when the ruling comes the arm being ruled on is the arm 2.14.7b
 * asked for. `crownWeightAt` is exported as the named accessor and the scatter
 * publishes the field's realised mean and spread (`canopyShadeMean` /
 * `canopyShadeP90` in `ScatterStats`), because a patchiness claim that is not
 * measured is exactly the claim 2.14.7b had to catch by eye.
 */
export const CROWN_M = 34;
export const CROWN_LO = 0.38;
export const CROWN_HI = 0.66;
/** Floor under the crown field, so a lit gap is never a hard zero. */
export const CROWN_FLOOR_W = 0.15;
/**
 * Canopy weight in a clearing. Not zero: a clearing with EXACTLY no trees in it
 * is a hole with a rim, and the rim reads as a wall. A tenth of the density
 * leaves a few standing trees in the open ground, which is what a real clearing
 * looks like and is also where the player will want to build.
 */
export const CANOPY_FLOOR_W = 0.10;
/**
 * How much of the understorey a closed canopy takes away, at full stand weight.
 *
 * This is not a saving dressed up as art direction; it is the reason the Forest
 * atlas is a floor of ferns, litter and dead wood in the first place, and its
 * own docstring says so. Ground cover under a closed canopy is sparse because
 * the light is. The saving is real and it is measured separately from the tree
 * cost (`?canopyshade=`) so neither number can be used to flatter the other.
 *
 * RN-2225 remedy, 2026-08-20: this term is DEFAULT OFF pending an Admin
 * ruling. It was dead code from WG-116 until the far tier woke it, and woken
 * it cuts the forestfloor understorey by 38.5 per cent as a spatially UNIFORM
 * thinning rather than as the patchy dark-under-trees pattern that would read
 * as shade. See `Config.canopyShade` and `docs/screenshots/RN2225_shade_*`.
 */
export const CANOPY_SHADE = 0.45;

/**
 * RN-2228. WHERE THE CANOPY TIER BEGINS, and it is the harvest ring's own
 * outer margin rather than a number of its own.
 *
 * Reid's ruling is that every tree a player can reach is minable, and
 * `TreeField` delivers exactly that out to `TREE_RADIUS_M` with a ragged edge
 * `TREE_EDGE_WANDER_M` wide. What it cannot deliver is the horizon: a harvest
 * tree is a /core node with a `Placed` record and a per-frame matrix compose,
 * so the ring is bounded by a per-frame cost that grows as its AREA, and
 * `TREE_RADIUS_M`'s own docstring says the shipping value is the largest ring
 * the frame budget holds. `CANOPY_RADIUS_M`'s docstring says the same thing
 * from the other side and names the answer: "a horizon treeline needs a
 * far-field impostor layer, and this client has none". RN-2202 built one.
 *
 * So the two tiers are ONE forest cut at one radius. Inside `CANOPY_NEAR_M`
 * the canopy is exactly zero and every tree is minable; above
 * `CANOPY_NEAR_FULL_M` it is at full density and no harvest node can reach;
 * between them each fades through the other. The band IS the wander band, so
 * the crossfade is the statistical complement of the harvest ring's own ragged
 * edge: `TreeField`'s membership test displaces its radius by a smooth field
 * over +/-`TREE_EDGE_WANDER_M`, so the expected harvest coverage falls from 1
 * at `TREE_RADIUS_M - wander` to 0 at `TREE_RADIUS_M + wander`, which is the
 * ramp below read backwards. Total tree density across the seam is therefore
 * about constant, which is what stops the seam being the thing the eye finds.
 *
 * It is NOT conditional on a harvest ring existing. Above
 * `VEG_ORIGIN_MAX_ALT_M` there is no harvest ring to complement and the 690 m
 * hole under the eye stays empty; from 12 km that is 3.3 degrees of the frame
 * and it is accepted rather than special-cased, because a canopy whose
 * existence depended on the observer is the one thing `canopyWeight`'s own
 * comment says a forest must never be.
 */
export const CANOPY_NEAR_M = TREE_RADIUS_M - TREE_EDGE_WANDER_M;
export const CANOPY_NEAR_FULL_M = TREE_RADIUS_M + TREE_EDGE_WANDER_M;

/**
 * RN-2229. HOW FAR THE IMPOSTOR TIER REACHES, in metres of GROUND, and the
 * number the aerial view lives or dies on.
 *
 * MEASURED AGAINST THE FLYOVER FRAME, not chosen. At 1,200 m with the shipped
 * 60 degree vertical fov and pitch -14, the frame spans depression angles -16
 * to +44 degrees, so the visible ground runs from 1,200/tan(44) = 1,243 m out
 * to a 37,966 m horizon, and the frame CENTRE is 1,200/tan(14) = 4,813 m. The
 * old 620 m ring is entirely BELOW the bottom edge of that frame, which is why
 * RN-2225's tick fix alone left the flyover at 188,081 triangles to the digit
 * with 683 harvest trees standing in the world: they were placed, and they
 * were off screen.
 *
 * THE CEILING IS THE CHUNK LOD AND NOT THE TRIANGLE BUDGET. A cell only
 * scatters if its chunk's vertex spacing is fine enough (`MAX_CELL_M`, and
 * `CANOPY_MAX_CELL_M` below), and the streamer coarsens with distance, so
 * there is a distance past which no chunk under the eye is admissible at any
 * price. 4,200 m sits inside that limit at `CANOPY_MAX_CELL_M` and covers the
 * frame from its bottom edge through its centre; beyond it the forest is the
 * terrain material's own far tier (RN-2195), which is the right instrument out
 * there because a 12 m tree at 4,200 m is 3.1 pixels tall and an instance
 * carrying three pixels is a colour, not a silhouette.
 *
 * WG-224, 2026-08-20: 4,200 -> 3,500, AND IT IS A TRADE RATHER THAN A
 * RETREAT. The tier's cost is per-instance CPU and is linear in the tree count,
 * so at a fixed frame budget `density x area` is a constant and the two are
 * exchangeable. WG-222 spends six times the density; the annulus from 3,500 to
 * 4,200 m is 31 per cent of the disc's area and is the band where a 12 m tree
 * is 3.1 pixels, seen through the deepest column of haze in the frame. Buying
 * closed-canopy coverage across the visible middle with the thinnest, hazes
 * outer sliver is the trade this lane makes, and the fade re-normalises to the
 * REALISED reach (`canopyDistanceWeight`) so no ring appears where the old
 * radius used to be. **RN-2240 buys it back:** a single-material impostor card
 * divides the per-tree instance cost by four, which at this density puts the
 * radius past 4,200 m again at the same frame.
 */
export const CANOPY_FAR_RADIUS_M = 3500;

/**
 * WG-225. HOW MUCH BIGGER A CANOPY CARD IS DRAWN AT THE FAR EDGE OF THE TIER,
 * and the honest name for what it does: **past the impostor threshold, one
 * instance stops being a tree and becomes a patch of canopy.**
 *
 * WHY THE TERM HAS TO EXIST, as arithmetic rather than as taste. What the eye
 * reads from the air is CROWN COVER, which is density times crown area, and
 * real temperate forest runs 20 to 60 per cent of it. This world's crowns are
 * small: `contracts.json` gives the pine a 3.85 x 2.55 m crown (7.7 m2), the
 * fir 2.9 x 2.2 (5.0 m2) and the broadleaf 8.4 x 10.5 (69.3 m2), so even the
 * broadleaf-led mixes WG-222 authors average about 44 m2 a tree. Closing 40 per
 * cent of the ground with 44 m2 crowns needs `-ln(0.6)/44e-6` = **11,600 trees
 * per square kilometre standing at once**, and over the flyover's 43 km2 of
 * visible canopy that is half a million instances. At the measured 0.23 us a
 * tree that is 115 ms of CPU in a 16.6 ms frame. **There is no density that
 * reaches forest-credible cover one-instance-per-tree at this range, and this
 * constant is where that fact is written down.**
 *
 * WHY IT IS LEGITIMATE AND NOT AN INFLATED TREE. `CANOPY_NEAR_M` (550 m) is
 * already past `CANOPY_LOD3_M` (420 m), so **every tree this tier draws is
 * ALREADY an impostor card** -- a trunk stub and two crossed quads, twelve
 * triangles, no crown geometry at all (rendering.md 2.14.2). A card is a
 * picture of canopy, not a tree, and a picture of canopy standing for nine
 * trees is what every impostor forest ever shipped has been. The term is the
 * same one `DETAIL_FAR_GROW` already applies one tier down for exactly the same
 * stated reason ("coverage is what the eye reads, not instance count ... making
 * it 45% larger costs nothing in silhouette honesty"), and the argument is
 * stronger here because the geometry being scaled carries no silhouette to lose.
 *
 * IT GROWS UNIFORMLY, where `DETAIL_FAR_GROW` is horizontal-only, and the
 * difference is measured rather than inconsistent. That term was made
 * horizontal because growing a 0.60 m card's HEIGHT turned it into a 1.34 m one
 * at the player's feet, a near-field silhouette defect. Nothing here is nearer
 * than 690 m, where the biggest grown card is under seven pixels tall, and a
 * card stretched in width alone reads as a mushroom the moment the eye has
 * enough pixels to see its proportion. Proportionate is the safer failure.
 *
 * THE RAMP IS AGAINST THE FIXED RADIUS, NOT THE REALISED REACH, and that is the
 * one line in this constant that took a second attempt to get right. Tied to
 * the reach, a standing player at the 1,400 m ground reach would see the FULL
 * growth on the trees at their own horizon: 31 m trees on the treeline beside
 * 12 m harvest trees, which is the seam WG-116 and RN-2228 spent two lanes
 * making invisible. Tied to `CANOPY_FAR_RADIUS_M`, the ground pose only ever
 * reaches `(1400-690)/(3500-690)` = 0.25 of the ramp, so its treeline grows by
 * 1.40x (a 17 m tree, an ordinary big tree) while the aerial far field gets the
 * whole 2.6x. **The growth is a function of the GROUND the tree stands on and
 * of nothing about the observer**, which is the same rule `canopyWeight` lives
 * under and the reason a chunk grows the same trees at the same size whoever
 * streamed it in.
 *
 * 1.6, i.e. 1.0x at 690 m rising to 2.6x at 3,500 m. Area-weighted over the
 * density fade that multiplies realised crown area by **3.39** (the integral is
 * in world-gen.md section 6.9.5), and the outer card is then a 31 m tree at
 * 3,500 m: **6.9 pixels tall** at the shipped 1600x900 / 60 degree frame, a
 * blob of canopy standing for roughly nine trees. Both coverage figures are
 * published with and without this term (world-gen.md 6.9.5) so the density claim
 * stands on its own arithmetic and cannot be flattered by this one.
 */
export const CANOPY_FAR_GROW = 1.6;

/** WG-225. A canopy card's size multiplier at ground distance `g`, metres. */
export function canopyFarGrow(g: number): number {
  if (g <= CANOPY_NEAR_FULL_M) return 1;
  const span = CANOPY_FAR_RADIUS_M - CANOPY_NEAR_FULL_M;
  if (span <= 0) return 1;
  const t = Math.min(1, (g - CANOPY_NEAR_FULL_M) / span);
  return 1 + CANOPY_FAR_GROW * t;
}

/**
 * RN-2234. THE REACH IS BOUNDED BY THE EYE'S HEIGHT, and this is the term that
 * lets one radius serve a 1,200 m flyover and a 1.6 m walk without the second
 * paying for the first.
 *
 * MEASURED, one flag apart, fresh process each, on this build:
 *
 *                    canopy trees   triangles   p50      budget (16.6 ms)
 *   forestfloor  0          0       1,272,522   7.3 ms
 *   forestfloor  3000  12,867       1,290,288   9.4 ms   inside
 *   forestfloor  4200  55,297       1,591,457  20.7 ms   OVER
 *   flyover      0          0         188,081   2.0 ms
 *   flyover      3000   4,691         192,958   3.1 ms
 *   flyover      4200  22,945         312,977   7.4 ms   inside
 *
 * The SAME 4,200 m radius is 7.4 ms from the air and 20.7 ms from the ground,
 * and it buys almost nothing on the ground: the forestfloor `box` moved 22.82
 * to 23.05, a quarter of a count, for 13.4 ms. That asymmetry is geometry and
 * not tuning. From an eye at height h, ground at distance g is foreshortened by
 * h/g, so the ground's screen area falls as h/g^3 while a tree standing on it
 * falls as 1/g^2: the number of trees crowded into one pixel of ground grows as
 * g/h. From 1.6 m, the 4 km ring is a sliver at the horizon holding forty
 * thousand trees; from 1,200 m it is most of the frame.
 *
 * So the reach is proportional to the eye's height, which is the same shape and
 * the same justification as `canopyDistanceWeight` -- a property of the VIEW,
 * kept deliberately separate from `canopyWeight`, which is the property of the
 * PLANET. No tree stops existing: what moves is how far the client bothers to
 * materialise instances of one, exactly as `TREE_RADIUS_M` already is for the
 * harvest ring.
 *
 * `CANOPY_REACH_PER_ALT` is 3.5 because 3.5 x 1,200 m is 4,200 m, i.e. it is
 * `CANOPY_FAR_RADIUS_M` AT THE FLYOVER POSE and the ceiling therefore binds
 * exactly where it was derived, rather than the two constants disagreeing about
 * which one is in charge there.
 *
 * `CANOPY_GROUND_REACH_M` is the floor -- how far the tier reaches for an eye
 * at ground level, where the altitude term gives essentially nothing -- and it
 * is set by the SAME 16.6 ms budget, measured at the densest biome this world
 * has. Forestfloor is Forest at 3,840 trees per km2, three times Hills, and it
 * is the hero ground frame:
 *
 *   floor      canopy trees   triangles   p50
 *   (off)               0     1,272,522   7.3 ms
 *   2,000          12,778     1,294,255   9.2 ms   +1.9 ms
 *   3,000          28,420     1,405,023  14.1 ms   +6.8 ms
 *
 * 2,000 is +26 per cent of the frame it is added to and 3,000 is +93 per cent,
 * for a `box` that reads 23.05 in BOTH arms against the tier-off 22.82. From a
 * 1.6 m eye the extra kilometre is a sliver at the horizon and it is not worth
 * five milliseconds, which is the whole content of the altitude rule above,
 * arriving from the cheap end.
 */
/**
 * WG-224, 2026-08-20. BOTH NUMBERS MOVE WITH THE DENSITY, AND THEY MOVE
 * BECAUSE THE PRODUCT IS WHAT THE BUDGET BOUNDS, NOT EITHER FACTOR.
 *
 * The table above is measured at the OLD density. WG-222 multiplies every
 * biome's canopy ask by six, and the tier's cost is linear in the realised tree
 * count, which is `density x (the area the reach admits, weighted by the
 * distance fade)`. Holding the same frame at six times the density therefore
 * means dividing the admitted area, and the two constants are where that lands:
 *
 *   `CANOPY_REACH_PER_ALT`  3.5  -> 2.92, i.e. `3500 / 1200`. It keeps this
 *       constant's own stated property, that the altitude rule binds EXACTLY at
 *       the flyover pose it was derived from rather than two constants
 *       disagreeing about which is in charge there -- the pose is unchanged and
 *       only `CANOPY_FAR_RADIUS_M` moved under it.
 *   `CANOPY_GROUND_REACH_M` 2,000 -> 1,400, and this one costs almost nothing
 *       that was ever visible. The table above is the evidence AGAINST its own
 *       old value: going 0 -> 2,000 m from a standing eye moved the forestfloor
 *       `box` from 22.82 to 23.05, **a quarter of a luma count for 1.9 ms**,
 *       and 2,000 -> 3,000 moved it by nothing at all for 4.9 ms more. What a
 *       standing player actually sees of this tier is the treeline between 690
 *       and roughly 1,400 m; everything past that is a sliver at the horizon,
 *       which is `CANOPY_REACH_PER_ALT`'s whole argument arriving from the
 *       cheap end. The kilometre given up here is what pays for six times the
 *       density inside the band that IS visible.
 *
 * RN-2240's single-material card divides the per-tree cost by four and both of
 * these come straight back out; they are budget numbers at today's card cost
 * and they are labelled as such rather than as findings about the world.
 */
export const CANOPY_REACH_PER_ALT = 2.92;
export const CANOPY_GROUND_REACH_M = 1400;

/** The canopy's realised ground reach at eye height `altM`, metres. */
export function canopyReachM(radiusM: number, altM: number): number {
  if (radiusM <= 0) return 0;
  const byAlt = Math.max(CANOPY_GROUND_REACH_M, CANOPY_REACH_PER_ALT * altM);
  return Math.min(radiusM, byAlt);
}

/**
 * RN-2230. THE COARSEST CHUNK THE CANOPY TIER WILL STAND ON, and why it is a
 * SECOND constant rather than a bigger `MAX_CELL_M`.
 *
 * `MAX_CELL_M` (64) is the ground tiers' limit and it is right for them: it is
 * derived from a depth-11 chunk under a WALKING player, and the ground cover,
 * the understorey and the carpet (`GrassSample`) all read it. Raising it would
 * admit 115 m chunks to three layers that have never been measured on one, for
 * the benefit of a tier that is 3 km away. This constant is read by the canopy
 * branch alone; `MAX_CELL_M` is untouched and every ground tier still refuses
 * exactly the chunks it refused before.
 *
 * 128 admits the depth band one coarser (a depth-8 chunk on Forge is 3,681 m
 * across, so 115.0 m per cell) and nothing beyond it. That band is resident
 * from about 2.3 km of ground out, which is where 64 stops, and it is what
 * takes the reach from roughly 2.3 km to past 4,200 m. The tier BELOW it is
 * 230 m per cell, and it is refused for a reason rather than for tidiness: a
 * prop is placed by bilinear interpolation inside one mesh cell, so the cell
 * size IS the tree's positional quantisation, and 230 m of it puts a stand on
 * the wrong side of a valley.
 */
export const CANOPY_MAX_CELL_M = 128;

/**
 * RN-2230. The hard clamp on `?canopy=`, derived from `CANOPY_MAX_CELL_M`
 * rather than picked. On Forge (R = 6e5 m) a face root quad is pi*R/2 =
 * 942,478 m, a depth-k quad is that over 2^k and its cell is a thirty-second
 * of the quad, so a 128 m cell is depth 8 (3,681 m quad, 115.0 m cell). The
 * streamer splits while `quadEdge / observerDist > splitRatio` (1.4), so
 * depth 8 is the finest band resident out to 3,681 / 1.4 = 2,630 m of eye
 * distance and depth 7 (230 m cells, refused) takes over past 5,259 m. A ring
 * asked for more than that grows nothing beyond it and reports success, which
 * is exactly the ceiling-that-passes failure the clamp exists to refuse.
 */
export const CANOPY_MAX_RADIUS_M = 5200;

/** RN-2229. How many rebuild steps the canopy gradient is quantised into.
 *  See `Scatter.canopyStepOf` for the trade this number is. */
export const CANOPY_BANDS = 8;

// ===========================================================================
// WG-295 to WG-300 of the WG-295..303 used range. THE COARSE TAIL: placed structure past the cover reach,
// at CONSTANT SCREEN DENSITY and CONSTANT SCREEN SIZE.
//
// R5 rank 1 measured the thing this tier exists for and nobody had measured it
// before: at `flyover` the instance tier's own `reachM` readback is 3,500 m
// against a `sqrt(2Rh)` horizon of 37,947 m, so **placed structure occupies
// 9.2 per cent of the visible ground depth** and the centre-column ladder
// finds the edge of it as a -43 count cliff over ten rows. The cliff is at the
// reach, to the row: row 535 inverts to 3,427 m and `reachM` reads 3,500.
//
// THE ATTRIBUTION THIS BLOCK IS BUILT ON, and it separates two findings the
// audit reported together. `MAX_PER_CHUNK` truncation is real (`chunksCapped`
// 4 at `forestair`) and it is NOT what ends the forest: a cap makes a chunk
// sparse, it cannot move the range at which the tier stops offering cells.
// The cliff is 100 per cent the reach ladder. The cap is a separate defect,
// answered by `ScatterCap.ts` in the same lane and measured apart.
// ===========================================================================

/**
 * WG-295. HOW MUCH FURTHER THE COARSE TAIL RUNS THAN THE COVER REACH, as a
 * multiple, and why a multiple rather than a radius of its own.
 *
 * `canopyReachM` is already the budget-derived, altitude-aware answer to "how
 * far is it worth materialising one instance per tree". Everything past it is
 * a DIFFERENT question, because past it one instance stops being able to be a
 * tree at all: at 3,500 m a card grown by `CANOPY_FAR_GROW` is 6.9 pixels
 * tall (WG-225's own arithmetic) and what the eye is reading is a stipple of
 * canopy blobs, not a stand. So the tail is sized in the units the eye is
 * actually using out there, and both of them are SCREEN units:
 *
 *   * **Constant screen SIZE.** A card's angular height is `H g^-1` times its
 *     growth, so holding it constant means growth PROPORTIONAL TO g. That is
 *     `canopyTailGrow` below, and it is continuous with `canopyFarGrow` at the
 *     join by construction rather than by tuning.
 *   * **Constant screen DENSITY.** From an eye at height h, ground at range g
 *     subtends solid angle `dOmega = dA h / g^3`, so instances per steradian
 *     is `density * g^3 / h`. Holding THAT constant means density
 *     proportional to `g^-3`. That is `canopyTailWeight`.
 *
 * Those two together are the whole design, and the cost consequence is the
 * reason it is affordable at all. The instance count in the tail is
 *
 *     N = 2 pi D INTEGRAL(r0..R) g * EDGE_W * (r0/g)^3 dg
 *       = 2 pi D EDGE_W r0^2 (1 - r0/R)
 *
 * which **CONVERGES**: the entire infinite tail costs `EDGE_W * r0^2` against
 * the 690-to-r0 band's own `INTEGRAL g w dg`, i.e. about **68 per cent of the
 * band it is added to, at ANY reach**. Compare the obvious alternative, which
 * this lane priced and refused: simply renormalising `canopyDistanceWeight`'s
 * linear fade onto a longer reach costs **2.11x** at 5,100 m and **1.90x**
 * even with an economy tail spliced onto it, because the linear fade lifts the
 * weight over the WHOLE existing band on its way to the new edge. A cost that
 * grows without bound in R is not a tail, it is a bigger ring.
 *
 * 1.457 is `5100 / 3500`, and 5,100 rather than a rounder number is
 * `CANOPY_MAX_RADIUS_M`'s own ceiling minus a margin: `CANOPY_MAX_CELL_M` 128
 * admits depth 8 and no coarser, depth 7 takes over past 5,259 m of EYE
 * distance, and at the flyover's 1,200 m that is 5,120 m of ground. **The
 * shipped tail therefore admits not one chunk depth that was not already
 * admitted**, which is what makes it a pure economy change rather than a
 * change to what the sampler will stand on. `?canopytail=` sweeps it and
 * `?canopytail=1` is the structural off (the branch is never entered).
 */
export const CANOPY_TAIL_MULT = 1.457;

/**
 * WG-295. The tail's own reach in metres of GROUND, or 0 when there is no
 * tail, and the two bounds are both derived rather than picked.
 *
 * **THE HORIZON IS WHAT SWITCHES IT OFF FOR A STANDING EYE, and that is the
 * whole of the altitude rule.** WG-224 already measured what a ground pose
 * gets for a longer canopy reach and the answer was a quarter of a luma count
 * for 1.9 ms; its explanation is `CANOPY_REACH_PER_ALT`'s, that from a low eye
 * the extra kilometre is a sliver at the horizon. Taken literally that is a
 * BOUND and not an argument: a standing eye at 1.62 m has a horizon of
 * `sqrt(2 R h)` = 1,394 m, which is INSIDE `CANOPY_GROUND_REACH_M` (1,400), so
 * a tail beyond the cover reach would be placed entirely on ground that eye
 * cannot see. Every walking pose is therefore bit-identical **by
 * construction** rather than by measurement, and no second altitude constant
 * has to be invented and later re-derived.
 *
 * The second bound is `CANOPY_BANDS`. A tail shorter than one rebuild step is
 * a population that appears and vanishes on a single chunk rebuild, which is
 * the pop `midTargetWeight`'s whole derivation is about; below that width the
 * tier is refused outright rather than shipped as a flicker.
 *
 * What it gives at the two aerial poses, both of which are in the R5 ladder:
 * `flyover` (1,200 m, cover reach 3,500) gets **5,100 m**, 13.4 per cent of
 * its 37,947 m horizon against 9.2; `forestaircanopy` (60 m, cover reach
 * 1,400, horizon 8,485) gets **2,040 m**, 24.0 per cent against 16.5.
 */
export function canopyTailReachM(
  coverReachM: number, altM: number, bodyRadiusM: number,
  mult: number = CANOPY_TAIL_MULT,
): number {
  if (!(mult > 1) || !(coverReachM > 0) || !(bodyRadiusM > 0)) return 0;
  const horizonM = Math.sqrt(2 * bodyRadiusM * Math.max(0, altM));
  const want = Math.min(coverReachM * mult, horizonM);
  return want - coverReachM >= coverReachM / CANOPY_BANDS ? want : 0;
}

/**
 * WG-295. The tail's density weight at ground range `g`, normalised so it is
 * CONTINUOUS with `canopyDistanceWeight` at the cover reach.
 *
 * `CANOPY_EDGE_W` is the weight the look fade lands on at the reach, and this
 * function starts there and falls as `g^-3`. That is not a second edge value
 * to keep in step with the first: it IS the first, read at the range the fade
 * ends, so the two cannot drift apart.
 *
 * **`canopyDistanceWeight` IS UNTOUCHED AND THAT IS LOAD-BEARING, NOT TIDY.**
 * `TerrainTreeline.assertTreelineMatchesScatter` mirrors that function in
 * GLSL, calls the live one at module load over `reach` in {1400, 2000, 3500,
 * 5200} and THROWS on any disagreement; RN-2233's shadow theorem and the
 * Beer-Lambert complement in `ofTreeCover` both stand on it as well. Splicing
 * the tail into it would have moved the published handover, which is
 * RN-2660's subject in the same week and not this lane's file.
 *
 * **THE HANDOVER ASSUMPTION THIS LANE STATES, so the second lane to merge can
 * re-measure it.** The material's reach stays the COVER reach and its paint
 * past that range is unchanged, so the tail places silhouettes on ground the
 * far paint already colours. That is deliberate and it is priced against R5's
 * own measurement rather than assumed away: over 3.4 to 15.5 km `?treeline=0`
 * moves the centre column by under one count outside a three-row ring, the
 * shipped arm's own iqr never exceeds 3.9 counts across rows 329-509, and at
 * row 539 the paint is locally DESTRUCTIVE of contrast. The paint out there
 * carries colour and no structure; this tier carries structure onto colour.
 * The overlap in COVER terms is `CANOPY_EDGE_W` at the join and decays as
 * `1/g` (density `g^-3` times crown area `g^2`), so it is largest exactly
 * where the handover already absorbs a step of that size. `?canopytail=1`
 * removes the tier if RN-2660 makes the paint carry structure of its own.
 */
export function canopyTailWeight(g: number, coverReachM: number): number {
  if (!(coverReachM > 0) || g < coverReachM) return 0;
  const r = coverReachM / g;
  return CANOPY_EDGE_W * r * r * r;
}

/**
 * WG-295. The tail card's size multiplier: `canopyFarGrow` at the join,
 * proportional to `g` beyond it, so the card's ANGULAR size is constant.
 *
 * At `flyover` that is a 31 m card at 3,500 m and a 45 m card at 5,100 m, both
 * **6.9 pixels tall** at the shipped 1600x900 / 60 degree frame. WG-225's
 * argument for a card standing for nine trees applies unchanged and is only
 * stronger here: every instance in this band is already an impostor with no
 * crown geometry to lose, and it is further away than the range at which that
 * argument was made.
 *
 * It is a function of the GROUND the tree stands on and of the pose's own
 * cover reach, which is `CANOPY_FAR_GROW`'s stated rule with one honest
 * difference: the cover reach IS observer-dependent, so unlike the near ramp
 * this term is not a pure function of position. It cannot be otherwise -- the
 * tail's whole existence is observer-dependent, the same way
 * `canopyDistanceWeight` is and `canopyWeight` is not -- and the tail is
 * confined to ranges at which a chunk is rebuilt long before a card's size
 * change is resolvable.
 */
export function canopyTailGrow(g: number, coverReachM: number): number {
  if (!(coverReachM > 0)) return 1;
  return canopyFarGrow(coverReachM) * (g / coverReachM);
}

/**
 * Canopy weight from a cell's GROUND distance to the eye: the near ramp that
 * hands over from the harvest ring, and the outer gradient that hides the far
 * edge. A pure function of distance so it reads next to `detailWeight`, which
 * is the same shape one tier down and for the same reason.
 *
 * RN-2228. GROUND DISTANCE AND NOT THE DISTANCE TO THE EYE, which is the whole
 * of the aerial defect. The caller used to pass the 3-D eye distance, so a
 * radius R at altitude h covered a ground disc of only sqrt(R^2 - h^2): at the
 * 1,200 m flyover the old 620 m radius covered a disc of sqrt(620^2 - 1200^2),
 * which is not a real number -- the tier was switched off entirely by the
 * altitude, everywhere, silently, and no counter said so because every cell it
 * would have reported on failed the gate before it was counted.
 *
 * The fade now spans `CANOPY_NEAR_FULL_M` to `CANOPY_FAR_RADIUS_M`, which is
 * 3,510 m and five times the old one. It has to be: the old 320 m fade was
 * sized to hide a 620 m edge from a standing eye, and an edge seen from the
 * air is seen along the ground rather than against the sky, so it needs a fade
 * measured in the same units the eye reads it in. `CANOPY_EDGE_W` is unchanged
 * and still 0.16 rather than 0, for its own stated reason: a linear fall to
 * exactly zero puts the last tree AT the boundary and re-creates a fainter
 * copy of the line.
 */
export function canopyDistanceWeight(g: number, reachM: number): number {
  if (g <= CANOPY_NEAR_M) return 0;
  if (g < CANOPY_NEAR_FULL_M) {
    return (g - CANOPY_NEAR_M) / (CANOPY_NEAR_FULL_M - CANOPY_NEAR_M);
  }
  if (g >= reachM) return 0;
  // RN-2234. The fade ends at the REALISED reach, not at the configured
  // radius. Ending it at the radius while the reach is shorter would put the
  // last tree at full weight against the cut, which is the hard ring this
  // whole gradient exists to prevent -- and the reach is the shorter of the
  // two at every eye height below the flyover's.
  const span = Math.max(1, reachM - CANOPY_NEAR_FULL_M);
  const t = Math.min(1, (g - CANOPY_NEAR_FULL_M) / span);
  return 1 + (CANOPY_EDGE_W - 1) * t;
}

/** Smootherstep, Perlin's second-derivative-continuous ramp. */
const sstep = (t: number): number =>
  t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10);
/** Ramp from a to b, clamped. */
const ramp = (x: number, a: number, b: number): number => sstep((x - a) / (b - a));

/**
 * WG-260. THE MID TIER: the 170-to-690 m band, and why it is a WEIGHT rather
 * than a new field, a new asset or a new radius.
 *
 * THE HOLE, measured by lane N4 (rendering.md 2.32.4) and reproduced here.
 * `RADIUS_M` stops the ground props dead at 170 m through a boolean gate with
 * no edge weight, and `CANOPY_NEAR_M` holds the impostor tier out to 550 m.
 * Between them the only thing with HEIGHT is `TreeField`'s harvest ring,
 * which at the Plains table was 420 trees per km2 against this tier's 2,520
 * -- a SIX FOLD density step at 550 m, because WG-222 multiplied the canopy
 * table by six and `TreeTuning.TREE_DENSITY_KM2` (copied from the pre-WG-222
 * canopy asks) was not multiplied with it.
 *
 * WG-310 NARROWED THIS, IT DID NOT CLOSE IT. The ruling was to adopt the
 * canopy table table-wide; the lane measured the node cost at the densest
 * pose FIRST (standing rule 7) and found the full six-fold ask broke the
 * frame budget at `forestair` (world-gen.md 6.17), so the shipped multiplier
 * is `TreeTuning.HARVEST_TABLE_MULT` = 2 of 6, documented there as
 * intentional. The Plains ask is now 840 against this tier's still-2,520 --
 * a THREE FOLD step at 550 m, smaller than the six fold this record first
 * measured but the same WALL in kind, only lower. Re-measuring it is this
 * seam's own owed work and not this lane's (WG-310 did not touch
 * `canopyDistanceWeight` or this file's target curve, per its brief).
 * That step is what the eye reads as a wall: at a 1.62 m
 * eye the whole plain past the prop ring is about four and a half frame rows
 * (2.32.3), so every tree from 550 m to the 1,400 m reach lands in a nine-row
 * strip at roughly uniform apparent height, while the rows ABOVE it -- where a
 * 12 m tree at 200 to 500 m would stand, 47 down to 19 pixels tall -- are empty
 * sky. The band is not short of ground material; it is short of silhouettes.
 *
 * THE TARGET CURVE AND THE DEFICIT. One curve says how much canopy the world
 * carries at range `d`: zero at the prop ring, one at `MID_FULL_M` (550 m),
 * QUADRATIC IN `d` between, for the reason derived four paragraphs down. (An
 * earlier draft of this block said "smootherstep to `CANOPY_NEAR_FULL_M`" and
 * that described the shape this lane BUILT AND REFUSED; the sentence is
 * corrected here rather than left to disagree with the function under it,
 * because a docstring that names a cause outlives the cause.)
 * `canopyDistanceWeight` already
 * delivers part of it (nothing below 550 m, a linear ramp to 1 at 690 m), and
 * this tier places exactly the DIFFERENCE. That is `TerrainTreeline`'s own
 * idiom one band in -- paint the density the other layer is not placing -- and
 * it has three consequences worth having: the sum is `midTargetWeight` by
 * construction so there is no seam at 550 m to tune, `canopyDistanceWeight` is
 * untouched so the far tier, `TerrainTreeline`'s mirror assertion and RN-2233's
 * shadow theorem all keep their proofs, and `?midhole=0` is a structural
 * control rather than a tuning value set to zero.
 *
 * THE RAMP'S SHAPE IS DERIVED FROM THE POP, and it is the one number in this
 * block that had to be solved for rather than picked.
 *
 * This weight is a property of the VIEW (`canopyDistanceWeight`'s own
 * distinction), so a tree in this band thins out as the player walks at it and
 * is gone by 170 m. That is what keeps Reid's ruling that every tree a player
 * can REACH is minable -- the reachable population is `TreeField`'s and this
 * tier hands over to it -- and its cost is that a tree can vanish when its
 * chunk crosses a rebuild boundary. `canopyStepOf` puts those boundaries 175 m
 * apart at the standing reach, so the size of one pop is the weight change
 * over 175 m, and how much of the FRAME it moves is that change times the
 * tree's apparent height, which goes as 1/g. Writing `V(g) = 175 w'(g) h f / g`
 * for a 12 m tree at the shipped 779.4 px per metre per metre of range, the
 * ramp that makes the pop the same size everywhere in the band rather than
 * piling it up where the trees are biggest is the one with `w'(g)` PROPORTIONAL
 * TO g, i.e. a ramp linear in g SQUARED, and it is the only shape with that
 * property. Solved between the two fixed endpoints it is
 *
 *     w(g) = (g^2 - MID_NEAR_M^2) / (MID_FULL_M^2 - MID_NEAR_M^2)
 *
 * and V is then constant at 2 x 175 x 9353 / (550^2 - 170^2) = 12.0 pixels of
 * tree per rebuild. THE COMPARISON THAT MATTERS IS AGAINST THE SEAM THIS
 * REPLACES, not against zero: the shipped near ramp runs 0 to 1 over
 * `CANOPY_NEAR_M` to `CANOPY_NEAR_FULL_M`, 140 m, which is SHORTER than one
 * rebuild band, so its whole weight change lands in a single rebuild at 550 to
 * 690 m where a tree is 13.6 to 17.0 pixels: V is about 17. This ramp is 2.7
 * times longer than one band and lands at 12.0. The band gains a population of
 * trees and the worst silhouette step at this seam gets SMALLER.
 *
 * Two shapes were tried against that number and both are worse. Quote the PEAK
 * of V and not V at a convenient sample, which is what a first draft of this
 * block did twice:
 *
 *   * A LINEAR ramp over the shipped 170-to-550 m span reads
 *     V = 175 x 9353 / (380 g), monotonically falling, so its peak is at the
 *     INNER end: **25.3 px at 170 m** (21.5 at 200 m, 7.8 at 550 m). The pop is
 *     worst exactly where the trees are largest, which is the defect the whole
 *     derivation is about.
 *   * SMOOTHERSTEP is flat at both ends and pays for it with a doubled
 *     derivative in the middle: **14.4 px, peaking at 388 m**. (A first draft
 *     said 13.7 at 430 m, which is V where `w'` peaks; `w'` and `V = 175 w' h f
 *     / g` do not peak at the same range, because the 1/g factor pulls the
 *     maximum inward.) It was BUILT AND MEASURED over 170 to 690 m, not over
 *     the shipped span -- `docs/screenshots/WG260_sstep_band_3x.png` is that
 *     build -- so its row is a like-for-like comparison of SHAPES and not of
 *     spans, and that is stated rather than hidden. Holding the weight near
 *     zero out to 300 m it put about a tenth of full density there and the band
 *     still read as a wall by eye.
 *
 * The quadratic carries 0.223 at 300 m against smootherstep's 0.104, at a LOWER
 * peak pop, and the ranking 12.0 < 14.4 < 25.3 is what decides it.
 *
 * `MID_FULL_M` is `CANOPY_NEAR_M` and that is the same constant doing the
 * opposite job: 550 m used to be the range at which the impostor tier switched
 * on at full density, which is what made it a wall, and it is now the range at
 * which this tier has finished ramping up to meet it.
 *
 * IT ADDS NO REBUILD BAND, on `CANOPY_LOD2_M`'s precedent. `canopyStepOf`
 * already quantises the gradient into `CANOPY_BANDS` steps of 175 m at the
 * standing reach, so this ramp spans two of them where the shipped 550-to-690 m
 * near ramp spans none: today's near ramp is SHORTER than one rebuild band and
 * is therefore effectively frozen per chunk, and this one is not. A fourth band
 * would cost a rebuild of every chunk on the way in to improve a gradient that
 * is already finer than the one it replaces.
 */
export const MID_NEAR_M = RADIUS_M;
export const MID_FULL_M = CANOPY_NEAR_M;
/** WG-260. Precomputed span of the ramp, in metres SQUARED. See above. */
const MID_SPAN2 = MID_FULL_M * MID_FULL_M - MID_NEAR_M * MID_NEAR_M;
/** WG-260. The mid tier's target weight at ground range `g`, in [0,1]. */
export function midTargetWeight(g: number): number {
  if (g <= MID_NEAR_M) return 0;
  if (g >= MID_FULL_M) return 1;
  return (g * g - MID_NEAR_M * MID_NEAR_M) / MID_SPAN2;
}
/**
 * WG-260. What THIS tier places: the target minus what the canopy tier already
 * places, and identically zero at and beyond `CANOPY_NEAR_FULL_M`.
 *
 * ITS ARGUMENT IS THE 3-D EYE DISTANCE, NOT THE GROUND DISTANCE, and that is
 * the one place this tier deliberately parts company with the one above it.
 * `canopyDistanceWeight` is written in ground distance because RN-2228's scar
 * is about the DISC a radius covers, and from 1,200 m up a 3-D radius covers
 * no disc at all. This tier is not about a disc: every number in it is about
 * APPARENT SIZE -- the ramp shape is solved for a constant screen-space pop,
 * the rung split is `CANOPY_LOD3_M`'s twenty-pixel bar -- and apparent size is
 * `h f / d`, in 3-D distance. At the standing eye the two agree to 1.62 m in
 * 550, so the ground poses cannot tell them apart and the deficit identity
 * with the canopy tier holds where it is read.
 *
 * FROM THE AIR THEY DIFFER AND THE DIFFERENCE IS THE POINT: the tier switches
 * itself off, because every cell is at least the eye's altitude away and 1,200
 * is past 690. That is not tidiness. MEASURED at `forestair` with the ground
 * form, the mid tier placed 3,727 instances on ground BELOW THE BOTTOM EDGE OF
 * THE FRAME (the flyover geometry's nearest visible ground is 1,243 m), and
 * because that pose already runs into `MAX_PER_CHUNK` on four chunks
 * (`chunksCapped` 4 in BOTH arms, pre-existing: a depth-8 chunk is 13.5 km2
 * and asks for 312,000 canopy trees against a 14,000 ceiling) those 3,727
 * came straight out of the far canopy: `canopyProps` 77,998 -> 74,271, with
 * the TOTAL pinned to 77,998 to the instance. A tier that reallocates the
 * frame's whole instance budget to place trees nobody can see is worse than a
 * tier that is absent, and one comparison removes it.
 *
 * The hard zero at the top is not a tidy-up. Past 690 m `canopyDistanceWeight`
 * begins its economy fade to `CANOPY_EDGE_W`, and the density it gives up out
 * there is already being painted by `TerrainTreeline`'s Beer-Lambert term
 * (which returns an instance weight of exactly 1 below 690 m and therefore
 * paints nothing inside this band). Letting the difference run past 690 m would
 * place instances the material is simultaneously painting, i.e. would double
 * the far canopy and undo RN-2234's reach economy in the same line.
 */
export function midDistanceWeight(d: number, reachM: number): number {
  if (d >= CANOPY_NEAR_FULL_M) return 0;
  const want = midTargetWeight(d);
  const have = canopyDistanceWeight(d, reachM);
  return want > have ? want - have : 0;
}
/**
 * WG-260. WHERE A MID TREE STOPS BEING A CARD, and it is `CANOPY_LOD3_M`
 * rather than a number of its own.
 *
 * That constant is already derived as the range at which the shortest canopy
 * tree covers twenty pixels, which is exactly the bar a crossed impostor card
 * has to clear, and the same bar applies whichever tier placed the tree. So a
 * mid instance beyond it is emitted through the canopy path unchanged -- one
 * four-triangle card, in the canopy's own non-casting batch -- and a mid
 * instance inside it is emitted through the ORDINARY prop path, which resolves
 * to the authored `_LOD2` cone (Fir 28, Pine 50, Broadleaf 180 triangles;
 * `tools/blender/contracts.json`) because every instance in this band is past
 * `CANOPY_LOD2_M`. No canopy tree is ever drawn at `_LOD0`'s 334 to 784
 * triangles by this tier, at any range it reaches.
 *
 * The near half is what makes RN-2233's shadow theorem survive: the furthest
 * cascade is 300 m (`ShadowRig.SPLITS_3`), so a mid tree inside it draws its
 * cone out of an ordinary casting batch and shadows correctly, while the
 * impostor rung -- which `attachFarShadowSkip` takes out of the shadow pass --
 * is only ever chosen beyond 420 m, comfortably outside every cascade.
 */
export const MID_CARD_M = CANOPY_LOD3_M;

/**
 * WG-260. THE OTHER SEAM: the biome-prop ring's own outer edge, which has been
 * a HARD BOOLEAN since the tier was written and is the one edge in the whole
 * ladder that never got the treatment its neighbours got.
 *
 * `ScatterSample`'s gate is `const near = d2 <= r2`, full density on one side
 * and nothing on the other. `DETAIL_FULL_M`'s docstring one tier down is the
 * argument against that, in this project's own words and about this project's
 * own frames: "the understorey stopped dead in a line across the hillside,
 * with dense cover on one side of it and untouched olive terrain on the other
 * ... a ring that ends is a ring you can see the edge of, whatever radius you
 * put it at, so the fix is not a bigger number, it is a gradient." The canopy
 * tier learned the same lesson at `CANOPY_FULL_M` and paid a 320 m fade for
 * it. The biome props never did, and their ring edge lands at 900-frame row
 * 281.6 at the plains hero pose, five rows under the horizon, where a 1.6 m
 * prop is still seven pixels tall and stands up across the line.
 *
 * The shape is `detailWeight`'s exactly, including the reason the edge weight
 * is not zero: a linear fall to exactly zero puts the last prop AT the
 * boundary and re-creates a fainter copy of the same line. 0.18 is
 * `DETAIL_EDGE_W`'s own value, reused rather than re-derived, because the
 * argument that set it (roughly the density the whole ring used to have, so
 * the old look becomes the outermost band of the new one) transfers unchanged.
 *
 * 120 m rather than a fraction of the radius, and the number is chosen so that
 * NO COMMITTED NEAR RECTANGLE MOVES. On the measured ladder for this pose
 * (see `artframe.js`'s `midband` note) 100 m is 900-frame row 293.9 and the
 * furthest near rectangle at any ground pose, `meadowfield.r100`, spans rows
 * 295 to 300, i.e. 90 to 100 m of ground. Every rectangle this project scores
 * near ground on therefore sits inside the full-density disc, and the thin is
 * confined to the 120-to-170 m annulus that only the horizon-band rectangles
 * can see.
 *
 * IT REMOVES INSTANCES RATHER THAN ADDING THEM, which is worth saying because
 * every other item in this lane costs something: the annulus is 53 per cent of
 * the ring's area and it now carries a mean weight of about 0.59, so the tier
 * gets cheaper. `?midedge=0` restores the boolean.
 */
export const BASE_FULL_M = 120;
export const BASE_EDGE_W = DETAIL_EDGE_W;
/** WG-260. Biome-prop weight for one cell, from its distance to the eye. */
export function baseWeight(d: number): number {
  if (d <= BASE_FULL_M) return 1;
  if (d >= RADIUS_M) return 0;
  const t = (d - BASE_FULL_M) / (RADIUS_M - BASE_FULL_M);
  return 1 + (BASE_EDGE_W - 1) * t;
}

/** Integer lattice hash for the stand field. Three axes, one round. */
function ihash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2f) ^ Math.imul(y | 0, 0x9e3779b1)
    ^ Math.imul(z | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** One octave of trilinear value noise over body-frame metres, in [0,1]. */
function octave(x: number, y: number, z: number, scale: number): number {
  const fx = x / scale, fy = y / scale, fz = z / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = sstep(fx - ix), ty = sstep(fy - iy), tz = sstep(fz - iz);
  const c = (dx: number, dy: number, dz: number): number =>
    ihash3(ix + dx, iy + dy, iz + dz) / 4294967296;
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * tx;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * tx;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * tx;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * The stand field at a body-frame point, in [0,1]. Two octaves: the first is
 * the stand, the second breaks its edge so a clearing has a ragged margin
 * rather than a drawn one.
 */
export function standAt(x: number, y: number, z: number): number {
  return octave(x, y, z, STAND_M) * 0.72 + octave(x, y, z, STAND_DETAIL_M) * 0.28;
}

/**
 * WG-221. The grove field at a body-frame point, in [0,1]. ONE octave, at the
 * landscape scale: a second octave here would only re-create the stand field
 * this multiplies, and the point of the pair is that they are separable.
 */
export function groveAt(x: number, y: number, z: number): number {
  return octave(x, y, z, GROVE_M);
}

/** WG-223. The crown field at a body-frame point, in [0,1]. See `CROWN_M`. */
export function crownAt(x: number, y: number, z: number): number {
  return octave(x, y, z, CROWN_M);
}

/** WG-221. Grove weight from the grove field: wood, edge, or open ground. */
export function groveWeight(grove: number): number {
  return GROVE_FLOOR_W
    + (1 - GROVE_FLOOR_W) * ramp(grove, GROVE_LO, GROVE_HI);
}

/**
 * Canopy density weight for one cell: groves times stands times treeline, in
 * [0,1].
 *
 * `stand` and `grove` are passed in rather than re-sampled because the caller
 * needs them for the understorey shading as well, and sampling a field twice
 * per cell to keep two call sites tidy is how a hot loop doubles.
 *
 * WG-221: THE GROVE IS A THIRD FACTOR AND NOT A WIDER STAND. Three terms, each
 * of which can independently say "no trees here", multiplied: the LANDSCAPE
 * (760 m woods and fields), the STAND (165 m closures and clearings inside a
 * wood) and the TREELINE (altitude). A product is what gives the field its
 * shape -- closed canopy needs every term to agree, open ground needs only one
 * to dissent -- and it is also why the realised mean falls to about 45 per cent
 * of the table's ask while the closed-grove-closed-stand ground gets the ask in
 * full. That is the number `Registry`'s canopy tables are now written against:
 * **the density inside a closed stand of a closed wood**, not the average over
 * a biome. Both figures are published in world-gen.md section 6.9.1, and 6.9.2
 * is why the product is what makes the row mean a closed stand at all.
 */
export function canopyWeight(altM: number, stand: number, grove: number): number {
  const wander = (stand * 2 - 1) * TREELINE_WANDER_M;
  const above = ramp(altM, TREELINE_FULL_M + wander, TREELINE_BARE_M + wander);
  if (above >= 1) return 0;
  const dense = CANOPY_FLOOR_W
    + (1 - CANOPY_FLOOR_W) * ramp(stand, STAND_LO, STAND_HI);
  return dense * groveWeight(grove) * (1 - above);
}

/**
 * WG-223. THE CROWN-SCALE CANOPY WEIGHT at a body-frame point, in [0,1], and
 * the value 2.14.7b asked world-gen for by name.
 *
 * It is `canopyWeight` -- the planet's own answer to "how much forest is here"
 * -- modulated by the 34 m crown field, so a point under a clump of crowns
 * reads near 1 and a point in the gap between clumps reads near
 * `CROWN_FLOOR_W`. That is the difference between a term that reads as canopy
 * shadow and a term that reads as somebody having turned the understorey down,
 * which is the whole of 2.14.7b's verdict.
 *
 * PUBLISHED, NOT WIRED. `CANOPY_SHADE` remains default OFF; this function is
 * what `sampleChunk` hands that term when it IS armed, and it is exported so
 * rendering can read the same field for a floor-shading pass without
 * re-deriving it (`ScatterStats.canopyShadeMean` / `canopyShadeP90` measure
 * what it realises, so the patchiness claim is a number rather than an
 * assertion).
 */
export function crownWeightAt(
  x: number, y: number, z: number, altM: number,
): number {
  const w = canopyWeight(altM, standAt(x, y, z), groveAt(x, y, z));
  if (w <= 0) return 0;
  return w * crownShade(crownAt(x, y, z));
}

/** WG-223. The crown field's own [0,1] modulation, split out for one caller. */
export function crownShade(crown: number): number {
  return CROWN_FLOOR_W + (1 - CROWN_FLOOR_W) * ramp(crown, CROWN_LO, CROWN_HI);
}

/** One weighted draw pool: the specs eligible at a cell, and their total. */
export interface Tier {
  specs: readonly PropSpec[];
  weights: number[];
  total: number;
}

export function tierOf(specs: readonly PropSpec[]): Tier {
  const weights = specs.map((s) => s.density);
  return { specs, weights, total: weights.reduce((a, b) => a + b, 0) };
}


export function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
export function keyHash(key: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < key.length; ++i) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}
/** [0,1) from the n-th draw of a chunk's stream. */
export const frac = (h: number): number => (h >>> 8) / 16777216;

