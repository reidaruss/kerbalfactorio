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

