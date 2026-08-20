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
 * cost (`?canopyshade=0`) so neither number can be used to flatter the other.
 */
export const CANOPY_SHADE = 0.45;

/**
 * Canopy weight from a cell's distance to the eye, the outer-edge gradient.
 * A pure function of distance so it reads next to `detailWeight`, which is the
 * same shape one tier down and for the same reason.
 */
export function canopyDistanceWeight(d: number): number {
  if (d <= CANOPY_FULL_M) return 1;
  if (d >= CANOPY_RADIUS_M) return 0;
  const t = (d - CANOPY_FULL_M) / (CANOPY_RADIUS_M - CANOPY_FULL_M);
  return 1 + (CANOPY_EDGE_W - 1) * t;
}

/** Smootherstep, Perlin's second-derivative-continuous ramp. */
const sstep = (t: number): number =>
  t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10);
/** Ramp from a to b, clamped. */
const ramp = (x: number, a: number, b: number): number => sstep((x - a) / (b - a));

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
 * Canopy density weight for one cell: stands times treeline, in [0,1].
 *
 * `stand` is passed in rather than re-sampled because the caller needs it for
 * the understorey shading as well, and sampling one field twice per cell to
 * keep two call sites tidy is how a hot loop doubles.
 */
export function canopyWeight(altM: number, stand: number): number {
  const wander = (stand * 2 - 1) * TREELINE_WANDER_M;
  const above = ramp(altM, TREELINE_FULL_M + wander, TREELINE_BARE_M + wander);
  if (above >= 1) return 0;
  const dense = CANOPY_FLOOR_W
    + (1 - CANOPY_FLOOR_W) * ramp(stand, STAND_LO, STAND_HI);
  return dense * (1 - above);
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

