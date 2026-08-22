// WG-301 to WG-303 (WG-304+ surrendered, never shipped; merge-time correction). THE PER-CHUNK CAP, MADE DENSITY-AWARE INSTEAD OF FIRST-N.
//
// THE DEFECT, and it is R5 rank 1's second half. `sampleChunk` walks its cell
// grid in RASTER ORDER and every one of its three loops carries `&& b.n <
// want`, so a chunk whose ask exceeds `MAX_PER_CHUNK` is not thinned: it is
// TRUNCATED. The first rows of cells get their full requested density and
// every row after the ceiling is reached gets nothing at all. On a depth-8
// chunk that is 3,681 m of ground with a straight, cell-aligned edge across
// it, and `chunksCapped` reads 4 at `forestair`.
//
// **THE COUNTER THAT SHOULD HAVE CAUGHT IT CANNOT, AND THIS IS THE TRAP WORTH
// KEEPING.** `canopyWanted` is accumulated INSIDE the same loop it bounds, so
// the cells the cap never reaches are absent from the ask as well as from the
// placement. Measured on the shipped build at `flyover`: `canopyDelivered`
// reads **1.0008** in the same report that prints `chunksCapped: 1`. A ratio
// whose numerator and denominator are truncated together is not a delivery
// ratio, it is a tautology, and it reads perfect on a chunk that is nine
// tenths empty. `capCells` below is the second instrument that fixes it (an
// instrument's own floor is a class of defect it can never report, and the fix
// is a second instrument -- RN-2452).
//
// THE FIX IS A DENSITY SCALE AND NOT A BIGGER CEILING. Raising the ceiling
// spends pool slots and frame time; scaling the density spends neither and is
// strictly better looking, because the SAME instance budget covers the whole
// chunk instead of one strip of it. The chunk's realised ask is estimated
// once, before the cell loop, from a stride subsample of the same fields the
// loop itself reads, and the canopy draw is multiplied by
// `min(1, budget / estimate)`.
//
// **IT IS CONFINED TO COARSE CHUNKS**, i.e. those the ground tiers already
// refuse (`cell > MAX_CELL_M`, `groundOk` false in `Scatter.build`). Two
// reasons, and the second is the one that matters: on such a chunk the canopy
// is the ONLY tier drawing, so the whole of `want` is its budget and no
// reserve has to be guessed for the biome props and the understorey; and every
// chunk fine enough to carry ground cover therefore takes the byte-identical
// path it took before this file existed. The four capped chunks at `forestair`
// are all in the coarse band by construction, because that is the only band in
// which a chunk is big enough to ask for 312,000 instances.

import {
  CELLS, DIM, MAX_PER_CELL, MIN_SLOPE_COS, CANOPY_MIN_SLOPE_COS,
  canopyDistanceWeight, canopyTailWeight, canopyWeight, groveAt, standAt,
} from './ScatterTuning.js';

/**
 * Stride of the pre-pass, in cells. 4 gives an 8x8 = 64-sample grid over the
 * 32x32 cell grid, i.e. **1/16 of the work the main loop does on the same
 * fields**, and it runs only on a chunk the geometric bound already says can
 * be capped.
 *
 * A stride and not a random subsample. The stand and grove fields are smooth
 * value noise at 165 m and 760 m, and a depth-8 cell is 115 m, so a stride-4
 * grid samples the grove field 2.6 times per period at worst and the stand
 * field under it; the quantity being estimated is a MEAN over 1,024 cells and
 * a regular grid is the lower-variance estimator of a mean of a smooth field.
 * It is also deterministic in the chunk alone, which a hashed subsample would
 * also be but less obviously.
 */
const CAP_STRIDE = 4;

/**
 * How much of `want` the estimate is allowed to claim. The estimate is an
 * OVER-estimate by construction (it skips the water gate, which only ever
 * removes cells, and it applies `MAX_PER_CELL` to an expectation rather than
 * to a draw), so the scale it produces already errs low; this is the margin
 * for the Bernoulli variance the fair quantisation adds on top, which
 * `Scatter.build`'s own `want` headroom note prices at four standard
 * deviations over a full chunk.
 *
 * The consequence to state rather than hide: on a capped chunk the tier
 * delivers slightly UNDER its budget, and `capScale` is published so the
 * shortfall is a number instead of an assumption.
 */
const CAP_HEADROOM = 0.97;

/** Everything `canopyCapScale` needs, and it reads all of it and writes none. */
export interface CapInput {
  /** The chunk's vertex positions, chunk-local, as `Scatter.build` reads them. */
  readonly pos: Float32Array;
  /** The chunk's body-frame anchor: x, y, z. */
  readonly ax: number; readonly ay: number; readonly az: number;
  /** Vertex normals, int8, for the canopy slope gate. */
  readonly nrm: Int8Array;
  /** The chunk's own outward unit direction (the anchor, normalised). */
  readonly upx: number; readonly upy: number; readonly upz: number;
  /** Eye position, engine frame, and the chunk's engine-frame position. */
  readonly ex: number; readonly ey: number; readonly ez: number;
  readonly px: number; readonly py: number; readonly pz: number;
  /** Eye height above the surface SQUARED, for the ground-distance conversion. */
  readonly h2: number;
  readonly bodyRadiusM: number;
  /** Instances per square kilometre the canopy tier asks for at weight 1. */
  readonly canopyTotal: number;
  /** `(cellArea / 1e6) * densityScale`, the sampler's own per-cell factor. */
  readonly perKm2: number;
  /** The cover reach and the tail reach, metres of ground. */
  readonly coverReachM: number;
  readonly tailReachM: number;
  /** The chunk's instance ceiling, i.e. `Scatter.build`'s `want`. */
  readonly want: number;
}

/**
 * The density multiplier this chunk's canopy draw should carry, in (0, 1].
 *
 * Returns exactly 1 when the chunk cannot be capped, and the caller then takes
 * the arithmetic it took before this function existed. The early bound is
 * GEOMETRIC (`canopyTotal * perKm2 * CELLS^2`, the ask at weight 1 everywhere)
 * and is therefore an upper bound on any realised ask, so a chunk it clears
 * genuinely cannot hit the ceiling through the canopy tier and pays nothing
 * for this file at all.
 */
export function canopyCapScale(c: CapInput): number {
  const cells = CELLS * CELLS;
  const askAtOne = c.canopyTotal * c.perKm2 * cells;
  if (!(askAtOne > c.want) || !(c.want > 0)) return 1;
  let est = 0;
  let n = 0;
  for (let cy = 0; cy < CELLS; cy += CAP_STRIDE) {
    for (let cx = 0; cx < CELLS; cx += CAP_STRIDE) {
      ++n;
      const i00 = (cy * DIM + cx) * 3;
      const dx = c.px + c.pos[i00] - c.ex;
      const dy = c.py + c.pos[i00 + 1] - c.ey;
      const dz = c.pz + c.pos[i00 + 2] - c.ez;
      const d2 = dx * dx + dy * dy + dz * dz;
      const g2 = d2 > c.h2 ? d2 - c.h2 : 0;
      const nx = c.nrm[i00] / 127, ny = c.nrm[i00 + 1] / 127, nz = c.nrm[i00 + 2] / 127;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const slopeCos = (nx * c.upx + ny * c.upy + nz * c.upz) / nl;
      // Both gates, in the sampler's own order. The ground gate is the looser
      // of the two and a cell that fails it has already failed the canopy one.
      if (slopeCos < MIN_SLOPE_COS || slopeCos < CANOPY_MIN_SLOPE_COS) continue;
      const wx = c.ax + c.pos[i00], wy = c.ay + c.pos[i00 + 1], wz = c.az + c.pos[i00 + 2];
      const altM = Math.hypot(wx, wy, wz) - c.bodyRadiusM;
      const planetW = canopyWeight(altM, standAt(wx, wy, wz), groveAt(wx, wy, wz));
      if (planetW <= 0) continue;
      const gM = Math.sqrt(g2);
      const dw = gM < c.coverReachM
        ? canopyDistanceWeight(gM, c.coverReachM)
        : (c.tailReachM > c.coverReachM && gM < c.tailReachM
          ? canopyTailWeight(gM, c.coverReachM) : 0);
      if (dw <= 0) continue;
      // `MAX_PER_CELL` applied to the EXPECTATION, which is what the draw
      // applies it to (`drawTier` clips the drawn integer, and the drawn
      // integer is the expectation plus a Bernoulli bit).
      const per = c.canopyTotal * c.perKm2 * planetW * dw;
      est += per > MAX_PER_CELL ? MAX_PER_CELL : per;
    }
  }
  if (n === 0 || !(est > 0)) return 1;
  // Scale the sample mean back up to the whole grid.
  const total = (est / n) * cells;
  if (!(total > c.want * CAP_HEADROOM)) return 1;
  return (c.want * CAP_HEADROOM) / total;
}
