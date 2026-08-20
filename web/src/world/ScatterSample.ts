// THE SAMPLER: one chunk in, one `Placed` record out. Split out of Scatter.ts
// at RN-2052, where it was a 200-line private method and the single largest
// thing in the file.
//
// It is a free function over an EXPLICIT pair rather than a method, and the
// pair is the seam the code already had: nine construction-time dependencies it
// only ever reads, and the counters object, of which it writes six members that
// nothing else in the class writes. Both are passed by reference, so `d.eye` is
// the same vector `update` copies into and a `++` here is the same number
// `stats` reports.
//
// Nothing about the traversal changed. The cell loop, the gate order (slope,
// then water, then canopy, then ground cover), the hash derivation and the
// early-out on `want` are the lines that left Scatter.ts, rewritten only where
// they said `this.`.

import * as THREE from 'three';
import type { ChunkView } from './ChunkView.js';
import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import type { WaterOracle } from './WaterOracle.js';
import {
  CELLS, DIM, MIN_SLOPE_COS, DETAIL_RADIUS_M, RADIUS_M,
  DETAIL_FAR_GROW, WET_REJECT_M, detailWeight, keyHash, type Tier,
  CANOPY_MIN_SLOPE_COS, CANOPY_SHADE, canopyWeight,
  canopyDistanceWeight, standAt,
} from './ScatterTuning.js';
import { CLUSTER_SHIFT } from '../render/ScatterLook.js';
import { PropEmitter, type Build } from './ScatterEmit.js';
import type { Placed } from './ScatterTypes.js';
import type { ScatterCounters } from './ScatterCounters.js';

/** Everything the sampler reads and never writes. Held by reference. */
export interface ScatterSampleDeps {
  readonly pool: ChunkGeometryPool;
  readonly water: WaterOracle | null;
  readonly editsHandle: () => number;
  readonly densityScale: number;
  /** The live eye vector `update` copies into, not a snapshot of it. */
  readonly eye: THREE.Vector3;
  readonly bodyRadiusM: number;
  readonly canopyShade: boolean;
  readonly em: PropEmitter;
  /** RN-2228. The eye's height above the surface, live. A BOX for `eye`'s
   *  reason: these deps are assembled once and read every build. */
  readonly alt: { m: number };
  /** RN-2234. The realised canopy reach this frame, metres of ground. */
  readonly reach: { m: number };
}

export function sampleChunk(
  d: ScatterSampleDeps, c: ScatterCounters,
  v: ChunkView, base: Tier, card: Tier, canopy: Tier, want: number,
  pos: Float32Array, cell: number, band: number,
): Placed {
  const nrm = d.pool.batch(v.pooled).normals(v.pooled.slot);
  const keyBase = keyHash(v.key);
  // Hoisted: one read of the body's water level per chunk, not per cell. Zero
  // means "this body is dry", which switches the whole test off with one
  // comparison and leaves a dry planet bit-for-bit as it was before this
  // existed.
  let wetR = d.water !== null && d.water.hasWater
    ? d.water.levelRadius() : 0;
  // THE BASIN GATE: one dot per chunk, and what makes the per-cell query
  // affordable. Fails SAFE (see WET_REJECT_M).
  const disc = d.water?.disc ?? null;
  if (wetR > 0 && disc !== null) {
    const an = v.anchor;
    const ar = Math.hypot(an.x, an.y, an.z) || 1;
    const dot = (an.x * disc.dirX + an.y * disc.dirY + an.z * disc.dirZ) / ar;
    const arcM = Math.acos(Math.max(-1, Math.min(1, dot))) * ar;
    // Half the chunk's diagonal, because the anchor is its corner.
    const reach = disc.basinRadiusM + cell * CELLS * 1.5;
    if (arcM > reach) wetR = 0;
  }
  const edits = wetR > 0 ? d.editsHandle() : 0;
  const local = new Float32Array(want * 3);
  const quat = new Float32Array(want * 4);
  const scale = new Float32Array(want * 3);
  const parts: Placed['parts'] = [];
  const owner: number[] = [];
  // The chunk's own outward direction: the anchor IS a point on the sphere.
  const a = v.anchor;
  const ar = Math.hypot(a.x, a.y, a.z) || 1;
  const upx = a.x / ar, upy = a.y / ar, upz = a.z / ar;
  // Walk CELLS, not the whole chunk. A depth-11 chunk is 900 m across and the
  // scatter radius is 190 m, so a uniform draw over the chunk would put nine
  // props in ten outside the radius and the ground under the player would
  // read as empty. Per-cell placement also makes density mean what it says:
  // instances per square kilometre of GROUND, independent of chunk depth.
  const cellArea = cell * cell;
  // The expected count for ONE cell, as a real number. Rounding it to an
  // integer here is the defect: it is 0.389 at the shipped 1.808 m cell, and
  // `Math.round` turns that into zero props per cell forever. A fair draw
  // spends the fraction as a probability, keyed by the SAME per-cell hash
  // everything else uses, so determinism is untouched and the realised
  // density equals the requested density in expectation at any LOD depth.
  const perKm2 = (cellArea / 1e6) * d.densityScale;
  let cells = 0;
  let wanted = 0;
  let canopyCells = 0;
  // BOTH SIDES OF THE CANOPY RATIO INCLUDE THE CONTACT SKIRT, deliberately.
  // `drawTier` counts a skirt card as asked-for (it has to, or the ratio
  // reads 1.5, which RN-15's `deliveredFraction` bug already cost a pass), so
  // the placed side has to count it too. These are therefore "instances the
  // canopy draw produced" and not "trees", and inside the understorey ring
  // the two differ by five cards a tree.
  let canopyWanted = 0;
  let canopyProps = 0;
  const r2 = RADIUS_M * RADIUS_M;
  // The OUTER gate. Equal to `r2` whenever the canopy is off or does not
  // reach further, which is what makes `?canopy=0` take the identical path
  // through this loop that existed before the tier did.
  const treeR = canopy.total > 0 ? d.reach.m : 0;
  const canopyOn = treeR > RADIUS_M;
  const maxR2 = canopyOn ? treeR * treeR : r2;
  // RN-2228. THE EYE HEIGHT, squared, for the ground-distance conversion. Zero
  // whenever the canopy is off, so the branch below is then `d2 > maxR2`
  // exactly as it was. See `Scatter.groundDistM` for the whole argument and
  // for why the GROUND tiers deliberately keep the 3-D distance.
  const h2 = canopyOn ? d.alt.m * d.alt.m : 0;
  // One reusable emit context. Rebuilt per chunk rather than per cell: a
  // chunk is up to fourteen thousand props and allocating a record per prop
  // is the difference between a scatter build that amortises and one that
  // makes the collector the worst frame in the run.
  const b: Build = {
    pos, local, quat, scale, parts, owner, n: 0, want,
    nx: 0, ny: 0, nz: 0, cluster: 0, i00: 0, i10: 0, i01: 0, i11: 0, seed: 0,
  };
  for (let cy = 0; cy < CELLS && b.n < want; ++cy) {
    for (let cx = 0; cx < CELLS && b.n < want; ++cx) {
      const i00 = (cy * DIM + cx) * 3;
      const dx = v.pos.x + pos[i00] - d.eye.x;
      const dy = v.pos.y + pos[i00 + 1] - d.eye.y;
      const dz = v.pos.z + pos[i00 + 2] - d.eye.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      // GROUND distance for the canopy's gates, the 3-D eye distance for the
      // ground tiers' (`near`, `detailWeight`). Identical numbers at a
      // standing eye and the whole difference from the air.
      const g2 = d2 > h2 ? d2 - h2 : 0;
      if (g2 > maxR2) continue;
      const near = d2 <= r2;
      // Slope from /core's own stored vertex normal, decoded from int8.
      const nx = nrm[i00] / 127, ny = nrm[i00 + 1] / 127, nz = nrm[i00 + 2] / 127;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const slopeCos = (nx * upx + ny * upy + nz * upz) / nl;
      // The canopy gate is STRICTER than the ground-cover gate, so a cell
      // that fails the ground gate has already failed the canopy one and
      // there is nothing left to do with it at any distance.
      if (slopeCos < MIN_SLOPE_COS) { c.slopeRejectCells++; continue; }
      // WATER (RN-46, proved at RN-48). Last because it alone reaches
      // WASM, and the two above have thrown most cells away already.
      if (wetR > 0) {
        const wx = a.x + pos[i00];
        const wy = a.y + pos[i00 + 1];
        const wz = a.z + pos[i00 + 2];
        // NORMALIZED: depthAt takes a DIRECTION, not a point (RN-46 bug).
        const wl = Math.hypot(wx, wy, wz);
        if (wl < wetR
          && d.water!.depthAt(wx / wl, wy / wl, wz / wl, edits) > WET_REJECT_M) {
          c.wetCells++;
          continue;
        }
      }
      const i10 = i00 + 3;
      const i01 = i00 + DIM * 3;
      const i11 = i01 + 3;
      b.seed = keyBase ^ Math.imul(cy * CELLS + cx, 0x27d4eb2f);
      // The PATCH this cell belongs to, so a stand spans many cells.
      b.cluster = keyBase ^ Math.imul(
        (cy >> CLUSTER_SHIFT) * CELLS + (cx >> CLUSTER_SHIFT), 0x9e3779b1);
      b.i00 = i00; b.i10 = i10; b.i01 = i01; b.i11 = i11;
      b.nx = nx / nl; b.ny = ny / nl; b.nz = nz / nl;

      // --- THE CANOPY. Sampled first, because it is the only tier that can
      // be non-zero out here and because the understorey below reads its
      // stand weight to decide how much shade it is standing in.
      //
      // `treeW` is a pure function of the cell's world position: the stand
      // field, the treeline, and nothing about the camera. That is what makes
      // a forest an attribute of the planet rather than of the observer, and
      // it is why a chunk that streams out and back in, or that arrives at a
      // different LOD depth, grows the same trees in the same places.
      let treeW = 0;
      // What the UNDERSTOREY is shaded by. The planet's own canopy weight and
      // NOT the view-dependent one: the two are equal inside 78 m today,
      // because that is where the understorey lives and the distance fade
      // starts at 300 m, and keeping one variable would have been correct and
      // silently coupled to that coincidence. Two names cost nothing and stop
      // a later change to either radius from moving the other term.
      let shadeW = 0;
      if (canopy.total > 0) {
        c.canopyOfferedCells++;
        if (slopeCos < CANOPY_MIN_SLOPE_COS) {
          c.canopySlopeCells++;
        } else {
          const wx = a.x + pos[i00], wy = a.y + pos[i00 + 1], wz = a.z + pos[i00 + 2];
          const altM = Math.hypot(wx, wy, wz) - d.bodyRadiusM;
          const stand = standAt(wx, wy, wz);
          // TWO independent weights, multiplied and NOT merged. `canopyWeight`
          // is a property of the PLANET (stands, treeline) and is the same for
          // this cell whoever is looking at it; the distance term is a
          // property of the VIEW and exists only to hide the ring's edge.
          // Keeping them apart is what lets the first be a determinism claim
          // and the second an art-direction one.
          shadeW = canopyWeight(altM, stand);
          treeW = shadeW * canopyDistanceWeight(Math.sqrt(g2), treeR);
          if (treeW <= 0) c.canopyBareCells++;
          else {
            canopyCells++;
            const n0 = b.n;
            // The skirt is withheld past the understorey ring: five contact
            // cards at the foot of a tree 300 m away are five instances that
            // carry no pixels, and the cards are not drawn out there anyway.
            canopyWanted += d.em.drawTier(b, canopy,
              canopy.total * perKm2 * treeW, 8192, 1,
              d2 <= DETAIL_RADIUS_M * DETAIL_RADIUS_M);
            canopyProps += b.n - n0;
          }
        }
      }
      // Everything below is ground cover and stops at the biome ring.
      if (!near) continue;
      cells++;

      // --- the biome props, over the whole ring at a flat density.
      wanted += d.em.drawTier(b, base, base.total * perKm2, 0, 1, true);

      // --- the understorey, GRADED by this cell's own distance to the eye.
      // The weight is applied to the DENSITY and not to a visibility flag,
      // so the thinning is a real change in how many cards exist rather than
      // a fade that still pays for every instance.
      if (card.total > 0) {
        const wt = detailWeight(Math.sqrt(d2));
        if (wt > 0) {
          // SHADE. A closed canopy takes ground cover away, which is the same
          // fact `build_props_forest.py` is built on: the Forest atlas is a
          // floor of ferns and litter precisely because a forest floor is
          // dim. It also happens to pay for a good part of the trees, so the
          // two are reported as separate numbers and `?canopyshade=0` turns
          // this term off without touching the trees.
          const shade = d.canopyShade ? 1 - CANOPY_SHADE * shadeW : 1;
          // Bigger the further out, which buys coverage back per instance.
          // See DETAIL_FAR_GROW.
          const grow = 1 + DETAIL_FAR_GROW * (1 - wt);
          wanted += d.em.drawTier(b, card, card.total * perKm2 * wt * shade,
            4096, grow, false);
        }
      }
    }
  }
  if (b.n >= want) c.chunksCapped++;
  const n = b.n;
  return {
    parts, local: local.subarray(0, n * 3), quat: quat.subarray(0, n * 4),
    scale: scale.subarray(0, n * 3), owner: Uint16Array.from(owner),
    cells, cellArea, wanted, detailBand: band,
    canopyCells, canopyProps, canopyWanted,
    builtPos: v.pos.clone(),
  };
}
