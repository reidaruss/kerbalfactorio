// Deterministic biome prop placement (ARCHITECTURE.md 6.2, "Scatter lattice").
//
// Placement is PURE TERRAIN DATA and reads the same surface everything else
// reads (standing rule 1), but it does not call the oracle even once: it samples
// the chunk's OWN vertex buffer. A prop's position is a bilinear interpolation
// inside one 33x33 grid cell of the mesh that is on screen, so a prop cannot
// float above the ground or sink into it, in the same structural way the walker
// cannot disagree with the mesh. It is also free: the vertices are already in
// memory and already carry the biome id and the normal.
//
// Determinism: every random number comes from hash(chunk key, instance index),
// so the same seed grows the same forest, a chunk that streams out and back in
// gets the identical placement, and a golden screenshot is reproducible.

import * as THREE from 'three';
import type { ChunkView } from './ChunkView.js';
import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import type { PropLibrary } from '../render/instancing/PropLibrary.js';
import { BIOME_PROPS } from '../assets/Registry.js';

import type { WaterOracle } from './WaterOracle.js';
import {
  CELLS, DIM, MAX_CELL_M, BUILDS_PER_UPDATE, MAX_PER_CHUNK,
  RADIUS_M, MIN_SLOPE_COS, DETAIL_RADIUS_M, DETAIL_FULL_M,
  DETAIL_FAR_GROW, WET_REJECT_M, detailWeight, tierOf, keyHash, type Tier,
  CANOPY_MIN_SLOPE_COS, CANOPY_SHADE, CANOPY_FULL_M, canopyWeight,
  canopyDistanceWeight, standAt,
} from './ScatterTuning.js';
import { CLUSTER_SHIFT, CONTACT_CARDS } from './ScatterLook.js';
import { PropEmitter, type Build } from './ScatterEmit.js';

interface Placed {
  /**
   * Flattened [material, slot] pairs; -1 slot means the batch was full.
   * `lod2M` is the distance at which THIS part switches to its far geometry,
   * carried per part rather than read from one constant because a 12 m tree and
   * a 0.4 m grass card do not stop being legible at the same range.
   */
  parts: { material: string; slot: number; lod0: number; lod2: number; lod2M: number }[];
  local: Float32Array;
  quat: Float32Array;
  /** Three components per prop now: width, HEIGHT, width. See ScatterLook. */
  scale: Float32Array;
  /** parts index -> prop index, so one matrix serves a multi-material prop. */
  owner: Uint16Array;
  /** Cells this chunk actually drew from, and one cell's ground area. */
  cells: number;
  cellArea: number;
  /** What the registry ASKED for over those cells, before any quantisation. */
  wanted: number;
  /** Rebuild band this chunk was built in. See `detailBandOf`. */
  detailBand: number;
  /**
   * The chunk's ENGINE position at the moment its instance matrices were last
   * written. Every matrix in the batch is `builtPos + local`, so this is the
   * other half of the staleness subtraction and it is the only new state the
   * measurement needs.
   */
  builtPos: THREE.Vector3;
  /** The canopy's own accounting, over the canopy's own ground. */
  canopyCells: number;
  canopyProps: number;
  canopyWanted: number;
}

/** A biome with no understorey draws from this rather than from a null check. */
const EMPTY_TIER: Tier = { specs: [], weights: [], total: 0 };

/**
 * Below this a chunk counts as NOT stale (WG-64). One millimetre, which is not
 * a tolerance on the answer: a re-placed chunk is exact, because `write` and
 * `ChunkView.place` both go through the same f64 `toEngine` subtraction, so the
 * correct reading is a hard 0.000000. The epsilon exists only so the counter
 * cannot be tripped by a float32 round trip through an instance matrix, and the
 * failure it is looking for is measured in kilometres.
 */
const STALE_EPS_M = 1e-3;

export class Scatter {
  private readonly placed = new Map<string, Placed>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  /** Places ONE prop. See ScatterEmit for why the two are separate objects. */
  private readonly em: PropEmitter;
  chunksScattered = 0;
  lastBuildMs = 0;
  /** Prop instances (not parts) currently placed, and the ground they sit on. */
  propsPlaced = 0;
  wantedProps = 0;
  cellsScattered = 0;
  groundM2 = 0;
  /** Chunks whose draw was TRUNCATED by MAX_PER_CHUNK. Must stay 0 near. */
  chunksCapped = 0;
  /** Cells refused for water since boot (DW-28). See WET_REJECT_M. */
  wetCells = 0;
  /** Chunks waiting on the per-update sampling budget. Should settle to 0. */
  backlog = 0;
  /** Canopy trees placed, the ground they were drawn over, and the ask. */
  canopyProps = 0;
  canopyCells = 0;
  canopyWanted = 0;
  canopyM2 = 0;
  /**
   * Cells the canopy was OFFERED, and the two ways it refused them.
   *
   * `canopyOfferedCells` is the denominator and it is not decoration. The first
   * measurement of this pass had both refusal counters reading exactly 0 at all
   * seven survey sites, and a bare 0 cannot be told apart from a term that
   * never ran: the treeline was in fact running and correct, and its refusing
   * case was simply unreachable, because the only biome that sat above the fade
   * had no canopy specs and therefore never entered this branch at all. With a
   * denominator, 0 of 46,000 and 0 of 0 are different rows.
   *
   * `canopySlopeCells` is the 44 degree gate; `canopyBareCells` is at or above
   * the treeline. Both must be non-zero SOMEWHERE in the world, and the site
   * where each becomes non-zero is named in the report, because a filter is
   * proved by the case it CATCHES and never by the case it ignores.
   */
  canopyOfferedCells = 0;
  canopySlopeCells = 0;
  canopyBareCells = 0;
  /**
   * Cells refused by `MIN_SLOPE_COS`, the 57 degree gate that has been in force
   * for every prop since RN-7 and has never been counted.
   *
   * It is here because the canopy's own 44 degree gate refused 0 of 241,053
   * cells across all seven survey sites, and before calling a gate inert it is
   * worth knowing whether the LOOSER gate above it fires either. The comment on
   * `MIN_SLOPE_COS` says 40 degrees "emptied the Mountains biome" because a
   * mountain flank is steeper than that almost everywhere, and that claim
   * predates WG-25's noise rework, which took the designed layer from 985 m
   * vertical walls to a worst grade of 87.54% over 100 m. If this counter is
   * also 0 then the world is gentler at cell scale than either constant
   * assumes, and both comments describe a planet that no longer exists.
   */
  slopeRejectCells = 0;
  /**
   * The worst DISPLACEMENT, in metres, between where a chunk's props were drawn
   * and where that chunk now is, and how many chunks carry any.
   *
   * A number rather than a picture on purpose. The suspected defect (this class
   * is not told about a floating-origin rebase) puts props kilometres from the
   * ground they were placed on, which at 4 km is not a wrong-looking forest but
   * an ABSENT one, and "the props vanished" is consistent with half a dozen
   * causes. This is the subtraction the defect IS, so it can only read non-zero
   * for one reason, and the size of the reading names the rebase delta.
   *
   * Must be 0.0 at all times. It is not a tolerance and it has no threshold: a
   * chunk that has been re-placed is re-placed exactly, in the same f64
   * subtraction `toEngine` does, so the correct value is a hard zero and
   * anything else is the bug.
   */
  staleMaxM = 0;
  staleChunks = 0;

  constructor(
    private readonly lib: PropLibrary,
    private readonly pool: ChunkGeometryPool,
    private readonly enabled: boolean,
    private readonly densityScale: number,
    /**
     * Fair (stochastic) per-cell quantisation. `?scatterfair=0` restores the
     * `Math.round` this shipped with, which is the whole defect: the count is
     * per CELL, DW-19 took the near cell to 1.808 m, and `round(0.389)` is
     * **0**, so every chunk under the player scattered NOTHING while `want`
     * read 399 and every other number looked healthy.
     */
    private readonly fair = true,
    /** `?grassshort=0` restores the RN-15 band. See ScatterLook.DETAIL_H_LO. */
    grassShort = true,
    /**
     * The water authority, or null on a dry body. A WaterOracle and not a
     * height: it is the ONE place "is there water here" is answered, and a
     * second copy of that rule here is the DW-26 failure exactly.
     */
    private readonly water: WaterOracle | null = null,
    /** Live edits handle, read at BUILD time so a dug bed deepens the water. */
    private readonly editsHandle: () => number = () => 0,
    /**
     * Body radius in metres, the datum the TREELINE is measured from. Read from
     * `PlanetBody` and never transcribed: a treeline that disagreed with the
     * body about where zero is would be wrong by kilometres and would look
     * exactly like a tuning problem.
     */
    private readonly bodyRadiusM = 0,
    /**
     * How far canopy trees reach, in metres. ZERO SWITCHES THE WHOLE TIER OFF
     * and is the negative control (`?canopy=0`): with it the sampler takes the
     * identical branch it took before this tier existed, so the before picture
     * and the after picture are one binary apart (standing rule 7).
     */
    private readonly canopyRadiusM = 0,
    /** `?canopyshade=0` keeps the understorey at full density under trees. */
    private readonly canopyShade = true,
  ) {
    this.em = new PropEmitter(lib, fair, grassShort);
  }

  /** The furthest any tier reaches. Residency and rebuild bands ride on it. */
  private get reachM(): number {
    return this.canopyRadiusM > RADIUS_M ? this.canopyRadiusM : RADIUS_M;
  }

  /**
   * Add scatter for chunks that entered the radius, drop it for chunks that
   * left. Only the DELTA is touched, so a stationary player costs one pass over
   * the resident map and no instance writes at all.
   */
  update(views: Iterable<ChunkView>, eye: THREE.Vector3): void {
    if (!this.enabled) return;
    const t0 = performance.now();
    this.eye.copy(eye);
    const seen = new Set<string>();
    let budget = BUILDS_PER_UPDATE;
    let backlog = 0;
    // STALENESS, measured rather than inferred (WG-64). Every instance matrix
    // this class writes is composed as `v.pos + local`, and `v.pos` is engine
    // space, which the floating origin re-derives on every rebase. So the exact
    // error in a placed prop's position is the distance the chunk's OWN engine
    // position has moved since the matrices were last written, and that is a
    // number this class already holds both halves of.
    //
    // It is here rather than in a probe because a probe would have to read the
    // matrices back out of a `BatchedMesh` and compare them against a surface it
    // would have to re-derive, which is three chances to measure the wrong
    // thing. This is the same subtraction the bug is.
    let stale = 0;
    let staleChunks = 0;
    for (const v of views) {
      if (!v.isNear || !v.visible) continue;
      if (v.pos.distanceTo(eye) > this.reachM + v.maxOffsetM) continue;
      seen.add(v.key);
      const pl = this.placed.get(v.key);
      if (pl === undefined) {
        if (budget <= 0) { backlog++; continue; }
        budget--;
        this.build(v);
        continue;
      }
      // A chunk built at 150 m carries no understorey, and walking onto it
      // would put the player back on bare ground. Rebuild it when it crosses a
      // BAND boundary rather than paying for cards out to 170 m.
      //
      // Two bands rather than the one boolean this shipped with, because the
      // understorey is now graded by distance instead of switched on and off:
      // a chunk sampled at 70 m carries the thin outer density for every cell
      // in it, and with a single boolean it would keep that thin density
      // forever once inside, so walking forwards would leave the ground ahead
      // permanently sparser than the ground behind. One extra rebuild per
      // chunk buys the near band its real density.
      const d = v.pos.distanceTo(pl.builtPos);
      if (d > STALE_EPS_M) { staleChunks++; if (d > stale) stale = d; }
      if (pl.detailBand === this.detailBandOf(v)) continue;
      if (budget <= 0) { backlog++; continue; }
      budget--;
      this.drop(v.key);
      this.build(v);
    }
    this.staleMaxM = stale;
    this.staleChunks = staleChunks;
    this.backlog = backlog;
    for (const key of [...this.placed.keys()]) {
      if (!seen.has(key)) this.drop(key);
    }
    this.chunksScattered = this.placed.size;
    this.lastBuildMs = performance.now() - t0;
  }

  /**
   * Which rebuild band a chunk is in. A chunk is re-sampled when it crosses a
   * boundary, and the bands are the distances at which something about the
   * build would come out different.
   *
   * The canopy did NOT add a band, and that is why `CANOPY_LOD2_M` is set to
   * `DETAIL_RADIUS_M` exactly. `write` decides LOD0 against LOD2 once, at build
   * time, so a tree's LOD only actually changes when its chunk is rebuilt.
   * A switch distance that is not a band boundary is therefore quantised to one
   * regardless, and choosing a distinct value would have bought a fourth
   * rebuild of every chunk on the way in for a switch that still happens at a
   * band. Aligning them makes the quantisation exact instead of approximate.
   *
   * The consequence to know: a tree's LOD is correct to within one band and
   * never staler than that, and a chunk built at 300 m carries far geometry
   * until it crosses 78 m, which is where the far geometry stops being right.
   */
  private detailBandOf(v: ChunkView): number {
    const d = v.pos.distanceTo(this.eye) - v.maxOffsetM;
    if (d <= DETAIL_FULL_M) return 3;
    if (d <= DETAIL_RADIUS_M) return 2;
    // The canopy's OWN density boundary, and it earns a band for exactly the
    // reason the understorey's second band exists: the outer canopy is thinned
    // by `canopyDistanceWeight`, and without a rebuild here a chunk first
    // sampled at 500 m would keep its thinned density all the way in, so the
    // ground ahead of a walking player would be permanently sparser than the
    // ground behind. One extra rebuild per chunk, on a per-update budget of
    // one, reported by `scatterBacklog`.
    return d <= CANOPY_FULL_M ? 1 : 0;
  }
  /** Bands 2 and 3 carry the understorey; 3 carries it at full density. */
  private static detailOn(band: number): boolean { return band >= 2; }

  /** Re-derive every instance matrix from its chunk's anchor. THE rebase path. */
  replace(views: Map<string, ChunkView>): void {
    for (const [key, pl] of this.placed) {
      const v = views.get(key);
      if (v === undefined) continue;
      this.write(v, pl);
    }
  }

  private drop(key: string): void {
    const pl = this.placed.get(key);
    if (pl === undefined) return;
    for (const part of pl.parts) this.lib.release(part.material, part.slot);
    this.propsPlaced -= pl.scale.length / 3 - pl.canopyProps;
    this.wantedProps -= pl.wanted;
    this.cellsScattered -= pl.cells;
    this.groundM2 -= pl.cells * pl.cellArea;
    this.canopyProps -= pl.canopyProps;
    this.canopyCells -= pl.canopyCells;
    this.canopyWanted -= pl.canopyWanted;
    this.canopyM2 -= pl.canopyCells * pl.cellArea;
    this.placed.delete(key);
  }

  private build(v: ChunkView): void {
    const specs = BIOME_PROPS[v.biome];
    if (specs === undefined || specs.length === 0) return;
    const pos = this.pool.positions(v.pooled);
    // Cell size straight off the mesh: vertex 0 to vertex 1 of the first row.
    const cell = Math.hypot(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]);
    if (!(cell > 0) || cell > MAX_CELL_M) return;
    const areaKm2 = (cell * CELLS) ** 2 / 1e6;
    // TWO tiers. The ground-detail cards are 0.36 to 0.58 m tall and stop being
    // legible within a few tens of metres, so paying an instance for one at
    // 150 m buys nothing and would push the shared OF_Grass batch past its
    // ceiling. They are drawn only inside DETAIL_RADIUS_M; everything else is
    // drawn over the whole RADIUS_M ring, exactly as before.
    // THREE tiers now, not two. `base` is the biome props, which cover the
    // whole 170 m ring at a flat density; `detail` is the understorey, which is
    // graded by distance; and `card` is the understorey again, used on its own
    // as the pool the contact skirt draws from.
    const full: Tier = tierOf(specs);
    const base: Tier = tierOf(specs.filter((s) => !s.detail && !s.canopy));
    const card: Tier = tierOf(specs.filter((s) => s.detail === true));
    // The canopy is empty on seven of the ten biomes and empty everywhere when
    // `?canopy=0`, and an empty tier costs one `total > 0` test per cell.
    const canopy: Tier = this.canopyRadiusM > 0
      ? tierOf(specs.filter((s) => s.canopy === true)) : EMPTY_TIER;
    const band = this.detailBandOf(v);
    // The skirt draws from the understorey WHATEVER band the chunk is in: a
    // rock at 90 m still has a silhouette meeting the ground, and five cards
    // at its foot cost less than one more metre of ring.
    this.em.skirt = card.total > 0 ? card : null;
    // HEADROOM, not a target. Fair quantisation means the realised count is a
    // sum of Bernoulli draws about the expectation, so an allocation sized to
    // the expectation exactly would truncate about half the chunks. The 64 is
    // four standard deviations at a full 1,024-cell chunk; the contact term is
    // the skirt, which the tier densities know nothing about. `chunksCapped`
    // counts any truncation that happens anyway rather than swallowing it.
    const want = Math.min(MAX_PER_CHUNK,
      Math.max(1, Math.ceil(full.total * areaKm2 * this.densityScale) + 64
        + Math.ceil(base.total * areaKm2 * this.densityScale) * CONTACT_CARDS));
    const pl = this.sample(v, base, Scatter.detailOn(band) ? card : EMPTY_TIER,
      canopy, want, pos, cell, band);
    // A chunk that legitimately places NOTHING is still recorded, and that is
    // load-bearing twice over. It used to return early, so the chunk was retried
    // every single frame forever, which with a per-update budget starves every
    // chunk behind it: the shipped-behaviour A/B measured 22 chunks queued and
    // ZERO props placed. And its cells belong in `wanted`, because a delivery
    // ratio that only counts the chunks that delivered something is blind in
    // exactly the case the ratio exists to catch.
    this.placed.set(v.key, pl);
    // GROUND COVER ONLY. The canopy is subtracted here and accounted for on its
    // own three counters, because `deliveredFraction` is `propsPlaced` over
    // `wantedProps` and mixing a tier into ONE side of a ratio is exactly the
    // defect that made it read 1.5146 at RN-15. Measured before the fix: 1.0637
    // at the Forest site, which would have failed `probes/grass.js` outright,
    // and which is the flattering direction (a layer that produces instances it
    // never requested cannot be trusted to report a genuine shortfall).
    //
    // Two ratios rather than one, and both are then meaningful over their own
    // ground: the understorey's ring is 78 m and the canopy's is 520 m, so a
    // single per-m2 figure over a single denominator could not be right for
    // either of them.
    this.propsPlaced += pl.scale.length / 3 - pl.canopyProps;
    this.wantedProps += pl.wanted;
    this.cellsScattered += pl.cells;
    this.groundM2 += pl.cells * pl.cellArea;
    this.canopyProps += pl.canopyProps;
    this.canopyCells += pl.canopyCells;
    this.canopyWanted += pl.canopyWanted;
    this.canopyM2 += pl.canopyCells * pl.cellArea;
    this.write(v, pl);
  }

  private sample(
    v: ChunkView, base: Tier, card: Tier, canopy: Tier, want: number,
    pos: Float32Array, cell: number, band: number,
  ): Placed {
    const nrm = this.pool.batch(v.pooled).normals(v.pooled.slot);
    const keyBase = keyHash(v.key);
    // Hoisted: one read of the body's water level per chunk, not per cell. Zero
    // means "this body is dry", which switches the whole test off with one
    // comparison and leaves a dry planet bit-for-bit as it was before this
    // existed.
    let wetR = this.water !== null && this.water.hasWater
      ? this.water.levelRadius() : 0;
    // THE BASIN GATE: one dot per chunk, and what makes the per-cell query
    // affordable. Fails SAFE (see WET_REJECT_M).
    const disc = this.water?.disc ?? null;
    if (wetR > 0 && disc !== null) {
      const an = v.anchor;
      const ar = Math.hypot(an.x, an.y, an.z) || 1;
      const dot = (an.x * disc.dirX + an.y * disc.dirY + an.z * disc.dirZ) / ar;
      const arcM = Math.acos(Math.max(-1, Math.min(1, dot))) * ar;
      // Half the chunk's diagonal, because the anchor is its corner.
      const reach = disc.basinRadiusM + cell * CELLS * 1.5;
      if (arcM > reach) wetR = 0;
    }
    const edits = wetR > 0 ? this.editsHandle() : 0;
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
    const perKm2 = (cellArea / 1e6) * this.densityScale;
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
    const treeR = canopy.total > 0 ? this.canopyRadiusM : 0;
    const maxR2 = treeR > RADIUS_M ? treeR * treeR : r2;
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
        const dx = v.pos.x + pos[i00] - this.eye.x;
        const dy = v.pos.y + pos[i00 + 1] - this.eye.y;
        const dz = v.pos.z + pos[i00 + 2] - this.eye.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxR2) continue;
        const near = d2 <= r2;
        // Slope from /core's own stored vertex normal, decoded from int8.
        const nx = nrm[i00] / 127, ny = nrm[i00 + 1] / 127, nz = nrm[i00 + 2] / 127;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const slopeCos = (nx * upx + ny * upy + nz * upz) / nl;
        // The canopy gate is STRICTER than the ground-cover gate, so a cell
        // that fails the ground gate has already failed the canopy one and
        // there is nothing left to do with it at any distance.
        if (slopeCos < MIN_SLOPE_COS) { this.slopeRejectCells++; continue; }
        // WATER (RN-46, proved at RN-48). Last because it alone reaches
        // WASM, and the two above have thrown most cells away already.
        if (wetR > 0) {
          const wx = a.x + pos[i00];
          const wy = a.y + pos[i00 + 1];
          const wz = a.z + pos[i00 + 2];
          // NORMALIZED: depthAt takes a DIRECTION, not a point (RN-46 bug).
          const wl = Math.hypot(wx, wy, wz);
          if (wl < wetR
            && this.water!.depthAt(wx / wl, wy / wl, wz / wl, edits) > WET_REJECT_M) {
            this.wetCells++;
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
          this.canopyOfferedCells++;
          if (slopeCos < CANOPY_MIN_SLOPE_COS) {
            this.canopySlopeCells++;
          } else {
            const wx = a.x + pos[i00], wy = a.y + pos[i00 + 1], wz = a.z + pos[i00 + 2];
            const altM = Math.hypot(wx, wy, wz) - this.bodyRadiusM;
            const stand = standAt(wx, wy, wz);
            // TWO independent weights, multiplied and NOT merged. `canopyWeight`
            // is a property of the PLANET (stands, treeline) and is the same for
            // this cell whoever is looking at it; the distance term is a
            // property of the VIEW and exists only to hide the ring's edge.
            // Keeping them apart is what lets the first be a determinism claim
            // and the second an art-direction one.
            shadeW = canopyWeight(altM, stand);
            treeW = shadeW * canopyDistanceWeight(Math.sqrt(d2));
            if (treeW <= 0) this.canopyBareCells++;
            else {
              canopyCells++;
              const n0 = b.n;
              // The skirt is withheld past the understorey ring: five contact
              // cards at the foot of a tree 300 m away are five instances that
              // carry no pixels, and the cards are not drawn out there anyway.
              canopyWanted += this.em.drawTier(b, canopy,
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
        wanted += this.em.drawTier(b, base, base.total * perKm2, 0, 1, true);

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
            const shade = this.canopyShade ? 1 - CANOPY_SHADE * shadeW : 1;
            // Bigger the further out, which buys coverage back per instance.
            // See DETAIL_FAR_GROW.
            const grow = 1 + DETAIL_FAR_GROW * (1 - wt);
            wanted += this.em.drawTier(b, card, card.total * perKm2 * wt * shade,
              4096, grow, false);
          }
        }
      }
    }
    if (b.n >= want) this.chunksCapped++;
    const n = b.n;
    return {
      parts, local: local.subarray(0, n * 3), quat: quat.subarray(0, n * 4),
      scale: scale.subarray(0, n * 3), owner: Uint16Array.from(owner),
      cells, cellArea, wanted, detailBand: band,
      canopyCells, canopyProps, canopyWanted,
      builtPos: v.pos.clone(),
    };
  }

  /** Compose every instance matrix from the chunk's CURRENT engine position. */
  private write(v: ChunkView, pl: Placed): void {
    // `write` IS the re-placement, so this is where staleness is cleared. It is
    // set here and not in `build` so that `replace` clears it too, which makes
    // the counter a test of the rebase path rather than of the build path.
    pl.builtPos.copy(v.pos);
    for (let i = 0; i < pl.parts.length; ++i) {
      const o = pl.owner[i];
      this.p.set(
        v.pos.x + pl.local[o * 3], v.pos.y + pl.local[o * 3 + 1], v.pos.z + pl.local[o * 3 + 2],
      );
      this.q.set(pl.quat[o * 4], pl.quat[o * 4 + 1], pl.quat[o * 4 + 2], pl.quat[o * 4 + 3]);
      this.s.set(pl.scale[o * 3], pl.scale[o * 3 + 1], pl.scale[o * 3 + 2]);
      this.m4.compose(this.p, this.q, this.s);
      const part = pl.parts[i];
      const far = this.p.distanceTo(this.eye) > part.lod2M;
      this.lib.place(part.material, part.slot, far ? part.lod2 : part.lod0, this.m4);
    }
  }

  /**
   * `placedPerM2` against `wantedPerM2` is THE property this layer claims: the
   * scatter delivers the density the registry asks for, over the ground it
   * actually drew on, whatever LOD depth that ground came in at. It is a ratio
   * rather than a count so it cannot be satisfied by a terrain change, and it
   * is reported next to the two cap counters so a shortfall always has a named
   * cause instead of being absorbed into a tolerance.
   */
  stats(): {
    chunks: number; buildMs: number; propsPlaced: number; cellsScattered: number;
    groundM2: number; placedPerM2: number; wantedPerM2: number;
    deliveredFraction: number; cellsCapped: number; chunksCapped: number;
    scatterBacklog: number; fairQuantise: boolean; wetCells: number;
    canopyRadiusM: number; canopyShade: boolean; canopyProps: number;
    canopyCells: number; canopyM2: number; canopyPerM2: number;
    canopyDelivered: number; canopyOfferedCells: number;
    canopySlopeCells: number; canopyBareCells: number; slopeRejectCells: number;
    staleMaxM: number; staleChunks: number;
  } {
    return {
      chunks: this.chunksScattered,
      buildMs: Math.round(this.lastBuildMs * 100) / 100,
      propsPlaced: this.propsPlaced,
      cellsScattered: this.cellsScattered,
      groundM2: Math.round(this.groundM2),
      placedPerM2: this.groundM2 > 0
        ? Math.round((this.propsPlaced / this.groundM2) * 1e5) / 1e5 : 0,
      wantedPerM2: this.groundM2 > 0
        ? Math.round((this.wantedProps / this.groundM2) * 1e5) / 1e5 : 0,
      deliveredFraction: this.wantedProps > 0
        ? Math.round((this.propsPlaced / this.wantedProps) * 1e4) / 1e4 : 0,
      cellsCapped: this.em.cellsCapped,
      chunksCapped: this.chunksCapped,
      scatterBacklog: this.backlog,
      fairQuantise: this.fair,
      wetCells: this.wetCells,
      // Standing rule 7: the isolation flags travel with the numbers, so a row
      // can never be attributed to the wrong run. `canopyRadiusM: 0` IS the
      // control and says so on the row.
      canopyRadiusM: this.canopyRadiusM,
      canopyShade: this.canopyShade,
      canopyProps: this.canopyProps,
      canopyCells: this.canopyCells,
      canopyM2: Math.round(this.canopyM2),
      canopyPerM2: this.canopyM2 > 0
        ? Math.round((this.canopyProps / this.canopyM2) * 1e5) / 1e5 : 0,
      canopyDelivered: this.canopyWanted > 0
        ? Math.round((this.canopyProps / this.canopyWanted) * 1e4) / 1e4 : 0,
      // The two refusal counters AND their denominator. Both must be non-zero
      // SOMEWHERE or the term that owns them is not running (DW-28, and the
      // `wetCells: 0` lesson: a zero at a site that cannot exhibit the case is
      // not evidence of anything).
      canopyOfferedCells: this.canopyOfferedCells,
      canopySlopeCells: this.canopySlopeCells,
      canopyBareCells: this.canopyBareCells,
      slopeRejectCells: this.slopeRejectCells,
      // WG-64. Must be 0.000000. See `staleMaxM`.
      staleMaxM: Math.round(this.staleMaxM * 1e6) / 1e6,
      staleChunks: this.staleChunks,
    };
  }
}
