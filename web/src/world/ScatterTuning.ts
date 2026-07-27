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
export const MAX_PER_CHUNK = 4600;
export const MAX_PER_CELL = 64;
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
 * How far the ground-detail card layer reaches. Confining it is what keeps the
 * shared OF_Grass batch inside its ceiling while the ground the player is
 * actually standing on gets a real understorey: at 55 m the ring is 9,503 m2
 * against the full scatter ring's 90,792, so a card costs 10.5% of what a shrub
 * costs. 55 rather than 40 because the measured screen coverage at a -15 degree
 * pitch is dominated by ground BEYOND the ring, and a 0.58 m card still carries
 * several pixels at 55 m.
 */
export const DETAIL_RADIUS_M = 55;

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

