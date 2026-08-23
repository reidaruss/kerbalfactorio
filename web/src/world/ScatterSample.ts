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
  canopyDistanceWeight, standAt, groveAt, crownAt, crownShade, canopyFarGrow,
  midDistanceWeight, MID_CARD_M, baseWeight,
  canopyTailWeight, canopyTailGrow,
} from './ScatterTuning.js';
import { canopyCapScale } from './ScatterCap.js';
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
  /** WG-260. `?midhole=0` switches the 170-to-690 m tier off structurally. */
  readonly mid: boolean;
  /** WG-260. `?midedge=0` restores the biome ring's hard boolean edge. */
  readonly midEdge: boolean;
  readonly em: PropEmitter;
  /** RN-2228. The eye's height above the surface, live. A BOX for `eye`'s
   *  reason: these deps are assembled once and read every build. */
  readonly alt: { m: number };
  /** RN-2234. The realised canopy reach this frame, metres of ground. This is
   *  the COVER reach: what `canopyDistanceWeight` fades over and what
   *  `Scatter.canopyReachOutM` publishes to the terrain material. */
  readonly reach: { m: number };
  /** WG-295. The coarse tail's reach this frame, metres of ground, or 0 when
   *  there is no tail. Always either 0 or greater than `reach`. */
  readonly tail: { m: number };
  /** WG-301. `?capfair=0` restores the raster-order first-N truncation. */
  readonly capFair: boolean;
}

export function sampleChunk(
  d: ScatterSampleDeps, c: ScatterCounters,
  v: ChunkView, base: Tier, card: Tier, canopy: Tier, want: number,
  pos: Float32Array, cell: number, band: number, groundOk: boolean,
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
  // WG-260. The mid tier's own three, kept apart from the canopy's for the
  // reason `shadeW` and `planetShadeW` are kept apart one block down: the two
  // tiers share a spec pool and a slope gate and nothing else, and folding
  // them into one counter would make `canopyPerM2` -- a number the far tier's
  // whole density argument is written against -- silently a different
  // quantity from the one WG-220 measured.
  let midCells = 0;
  let midWanted = 0;
  let midProps = 0;
  let midCards = 0;
  const r2 = RADIUS_M * RADIUS_M;
  // WG-295. TWO REACHES NOW, AND THEY ARE DIFFERENT QUANTITIES.
  //
  // `coverR` is what `canopyDistanceWeight` fades over and what the terrain
  // material is told (`Scatter.canopyReachOutM`), so the published handover is
  // exactly the one it has always been. `tailR` is how far the coarse tail
  // places beyond it, or 0 when there is no tail -- which is every ground pose
  // by construction, because `canopyTailReachM` is bounded by the eye's own
  // horizon. `outerR` is the residency and cell gate, and it is `coverR`
  // whenever the tail is absent, so every pre-WG-295 pose runs the identical
  // comparison.
  const coverR = canopy.total > 0 ? d.reach.m : 0;
  const tailR = canopy.total > 0 && d.tail.m > coverR ? d.tail.m : 0;
  const treeR = tailR > coverR ? tailR : coverR;
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
  // WG-301. THE DENSITY-AWARE CAP. One estimate per chunk, before the loop,
  // and only on a chunk the ground tiers already refuse (`base` and `card` are
  // both empty there, so the whole of `want` is the canopy's budget). See
  // ScatterCap.ts for why a scale beats a bigger ceiling and why the delivery
  // ratio cannot see the defect this fixes.
  // WG-304. `groundOk` IS PASSED IN RATHER THAN INFERRED FROM EMPTY TIERS, and
  // the WG-295 verifier is why. The first version read
  // `base.total <= 0 && card.total <= 0`, which is true for a coarse chunk
  // TODAY only because all ten biome tables happen to carry a base prop; a
  // canopy-only biome would make it true on a FINE chunk and quietly extend the
  // density scale to ground the player walks on. It is also the same predicate
  // `Scatter.build` now gates the area-aware ceiling on, and the two would be a
  // latent disagreement about which chunks are coarse if either re-derived it.
  // One boolean, decided once, at the place that owns the mesh cell size.
  const capScale = d.capFair && canopyOn && !groundOk
    ? canopyCapScale({
      pos, ax: a.x, ay: a.y, az: a.z, nrm,
      upx, upy, upz,
      ex: d.eye.x, ey: d.eye.y, ez: d.eye.z,
      px: v.pos.x, py: v.pos.y, pz: v.pos.z,
      h2, bodyRadiusM: d.bodyRadiusM, canopyTotal: canopy.total, perKm2,
      coverReachM: coverR, tailReachM: tailR, want,
    })
    : 1;
  // WG-301. Cells the loop never reached, i.e. the ground the cap took away.
  // Counted rather than inferred, because `canopyWanted` structurally cannot
  // report it: the ask is accumulated inside the loop the cap exits.
  let visited = 0;
  for (let cy = 0; cy < CELLS && b.n < want; ++cy) {
    for (let cx = 0; cx < CELLS && b.n < want; ++cx) {
      ++visited;
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
      // WG-223. What `shadeW` WOULD have been before the crown field, kept for
      // the counter pair alone. See `ScatterCounters.canopyPlanetSum`.
      let planetShadeW = 0;
      if (canopy.total > 0) {
        c.canopyOfferedCells++;
        if (slopeCos < CANOPY_MIN_SLOPE_COS) {
          c.canopySlopeCells++;
        } else {
          const wx = a.x + pos[i00], wy = a.y + pos[i00 + 1], wz = a.z + pos[i00 + 2];
          const altM = Math.hypot(wx, wy, wz) - d.bodyRadiusM;
          const stand = standAt(wx, wy, wz);
          // WG-221. The grove field, sampled beside the stand field and for
          // the same reason: both are pure functions of this cell's world
          // position, so a chunk grows the same forest whatever depth it
          // arrives at and whoever streamed it in.
          const grove = groveAt(wx, wy, wz);
          // TWO independent weights, multiplied and NOT merged. `canopyWeight`
          // is a property of the PLANET (groves, stands, treeline) and is the
          // same for this cell whoever is looking at it; the distance term is
          // a property of the VIEW and exists only to hide the ring's edge.
          // Keeping them apart is what lets the first be a determinism claim
          // and the second an art-direction one.
          const planetW = canopyWeight(altM, stand, grove);
          // WG-223. THE UNDERSTOREY'S SHADE TERM IS NOW CROWN-SCALE, which is
          // the fix rendering.md 2.14.7b named and the only reason the crown
          // field exists. Still default OFF (`Config.canopyShade`): what
          // changes is the SHAPE of the arm Admin is being asked to rule on,
          // from a term that saturates across a whole forest floor to one
          // that is dark under a clump of crowns and bright in the gap.
          shadeW = planetW <= 0 ? 0 : planetW * crownShade(crownAt(wx, wy, wz));
          // WG-223. THE COMPARATOR IS THE PRE-WG-221 FIELD EXACTLY, which is
          // this function with the grove forced to 1 (`groveWeight(1) === 1`),
          // and not `planetW`. `planetW` already carries the grove mask, so
          // quoting it as "what 2.14.7b measured" would credit this lane's own
          // grove field to the field it is being compared against and make the
          // crown term look like it did less than it did.
          planetShadeW = canopyWeight(altM, stand, 1);
          const gM = Math.sqrt(g2);
          // WG-295. THE TWO SEGMENTS. Inside the cover reach this is exactly
          // the expression that has always been here, called with the COVER
          // reach rather than the outer gate, so a pose with no tail is
          // bit-identical. Outside it the coarse tail takes over, continuous
          // in both weight and card size at the join by construction.
          const tailOn = tailR > coverR && gM >= coverR && gM < tailR;
          const distW = tailOn
            ? canopyTailWeight(gM, coverR) : canopyDistanceWeight(gM, coverR);
          const grow = tailOn
            ? canopyTailGrow(gM, coverR) : canopyFarGrow(gM);
          treeW = planetW * distW * capScale;
          if (treeW <= 0) c.canopyBareCells++;
          else {
            canopyCells++;
            const n0 = b.n;
            // The skirt is withheld past the understorey ring: five contact
            // cards at the foot of a tree 300 m away are five instances that
            // carry no pixels, and the cards are not drawn out there anyway.
            //
            // WG-225. `grow` is no longer 1. Every tree out here is already an
            // impostor card (`CANOPY_NEAR_M` 550 m is past `CANOPY_LOD3_M`
            // 420 m), and past the near seam a card stands for a patch of
            // canopy rather than for one tree. See `CANOPY_FAR_GROW` for the
            // arithmetic that says no density reaches forest-credible crown
            // cover one-instance-per-tree at this range.
            canopyWanted += d.em.drawTier(b, canopy,
              canopy.total * perKm2 * treeW, 8192, grow,
              d2 <= DETAIL_RADIUS_M * DETAIL_RADIUS_M);
            canopyProps += b.n - n0;
          }
          // --- WG-260. THE MID TIER, the 170-to-690 m band.
          //
          // It rides the SAME `planetW` the canopy tier rides, deliberately
          // and not for convenience: the whole point is that a stand
          // CONTINUES across 550 m rather than restarting, and the only way
          // to promise that is for both tiers to read one field. What differs
          // is the distance weight, and `midDistanceWeight` is defined as the
          // deficit against the line above's own weight, so the two sum to
          // `midTargetWeight` -- ONE QUADRATIC-IN-RANGE ramp to full density at
          // `MID_FULL_M` 550 m, not the smootherstep an earlier draft of this
          // comment named, which is the shape this lane built and refused --
          // and neither tier can open a seam at the handover.
          //
          // A SEPARATE SALT (12288) rather than a second use of 8192. The two
          // draws run on the same cell hash and the same spec pool, and a
          // shared stream would put every mid tree at the exact position the
          // canopy draw would have used, i.e. would correlate the two tiers'
          // placements across the seam where they overlap. That is the same
          // argument `drawTier`'s own note makes about the base and detail
          // tiers, one tier over.
          //
          // NO SKIRT, for the canopy draw's stated reason at four times the
          // range: five contact cards under a tree 300 m away are five
          // instances carrying no pixels, and the understorey they are drawn
          // from stops at 78 m anyway.
          if (d.mid) {
            // 3-D eye distance, not `gM`. See `midDistanceWeight`: this
            // tier's every number is about apparent size, and from the air
            // the difference is what switches it off over ground the frame
            // does not contain.
            const dM = Math.sqrt(d2);
            // WG-295. THE COVER REACH, not the outer gate. This tier is
            // defined as the DEFICIT against `canopyDistanceWeight`, so it has
            // to be handed the same reach that function is handed or the two
            // would stop summing to `midTargetWeight` -- and the tail, which
            // starts at `coverR` and this tier ends at 690 m, cannot reach it.
            const midW = planetW * midDistanceWeight(dM, coverR);
            if (midW > 0) {
              midCells++;
              const m0 = b.n;
              // The rung is picked per CELL from the cell's own ground range,
              // so a tree's geometry is a function of where it STANDS and not
              // of which tier drew it. `canopyFarGrow` is 1 everywhere in this
              // band by construction (it ramps from `CANOPY_NEAR_FULL_M`) and
              // is called rather than written as a literal so the two stay
              // tied if that boundary ever moves.
              const near2 = dM <= MID_CARD_M;
              d.em.nearRung = near2;
              midWanted += d.em.drawTier(b, canopy,
                canopy.total * perKm2 * midW, 12288, canopyFarGrow(dM), false);
              d.em.nearRung = false;
              midProps += b.n - m0;
              if (!near2) midCards += b.n - m0;
            }
          }
        }
      }
      // Everything below is ground cover and stops at the biome ring.
      if (!near) continue;
      cells++;

      // --- the biome props, over the whole ring.
      //
      // WG-260. NO LONGER AT A FLAT DENSITY, and the weight is applied to the
      // DENSITY rather than to a visibility flag for `detailWeight`'s stated
      // reason one tier down: the thinning has to be a real change in how
      // many props exist, not a fade that still pays for every instance. See
      // `BASE_FULL_M` for why 120 m is the number and why no committed near
      // rectangle can see it. `?midedge=0` restores the flat ring exactly.
      //
      // No `grow` term to buy the coverage back, unlike `DETAIL_FAR_GROW` one
      // tier down, and that is deliberate rather than an omission: that term
      // is confined to CARDS by its own docstring ("a boulder that grew with
      // range would be obvious"), and this tier is where the boulders are.
      const bw = d.midEdge ? baseWeight(Math.sqrt(d2)) : 1;
      if (bw > 0) {
        wanted += d.em.drawTier(b, base, base.total * perKm2 * bw, 0, 1, true);
      }

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
          // WG-223. THE SHADE FIELD'S DISTRIBUTION, SAMPLED EXACTLY WHERE THE
          // TERM ACTS and nowhere else. The first version of this counter
          // accumulated at every canopy-offered cell out to the whole reach,
          // which answers a question nobody asked: rendering.md 2.14.7b's
          // claim is about THE FLOOR THE PLAYER IS LOOKING AT ("close to 1
          // across the entire visible floor"), and the understorey exists only
          // inside `DETAIL_RADIUS_M`. Measured over the disc it read 0.32
          // against 0.16, which would have been quoted as evidence about a
          // region the shade term never multiplies. Both terms are recorded
          // over the identical cell set, so the pair is a comparison.
          c.canopyShadeSum += shadeW;
          c.canopyShadeSq += shadeW * shadeW;
          c.canopyPlanetSum += planetShadeW;
          c.canopyPlanetSq += planetShadeW * planetShadeW;
          c.canopyShadeN++;
          if (shadeW > c.canopyShadeMax) c.canopyShadeMax = shadeW;
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
  // WG-301. The cells the cap took away, and the cells this chunk offered, as
  // a PAIR. A count on its own cannot be read (a chunk that legitimately ran
  // out of ground is not a chunk that was truncated), and the fraction is what
  // `chunksCapped` has never been able to say: HOW MUCH of a capped chunk is
  // empty. Both are zero on every chunk that finished its grid.
  // They are returned on the `Placed` record and accumulated by `Scatter
  // .build` rather than incremented here, so `drop` can undo them in the
  // matched pair every other residency total in this class uses.
  // `capScaleMin` is the one that cannot be paired (see its own note) and is
  // therefore the one this function writes directly.
  const unvisited = CELLS * CELLS - visited;
  if (capScale < c.capScaleMin) c.capScaleMin = capScale;
  const n = b.n;
  return {
    parts, local: local.subarray(0, n * 3), quat: quat.subarray(0, n * 4),
    scale: scale.subarray(0, n * 3), owner: Uint16Array.from(owner),
    cells, cellArea, wanted, detailBand: band,
    canopyCells, canopyProps, canopyWanted,
    midCells, midProps, midWanted, midCards,
    capCells: unvisited, capOfferCells: CELLS * CELLS,
    builtPos: v.pos.clone(),
  };
}
