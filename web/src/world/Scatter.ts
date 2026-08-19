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
//
// RN-2052. The class is the RESIDENCY and REBASE layer and nothing else now.
// Three things left it, each to the module named for what it owns:
//   ScatterTypes.ts     the `Placed` record, the empty tier, the stale epsilon
//   ScatterCounters.ts  every reported number, and the report built from them
//   ScatterSample.ts    the per-cell sampler, over an explicit (deps, counters)
// What stays is the delta pass over resident chunks, the rebuild bands, the
// build/drop bookkeeping and `write`, which is the one place an instance matrix
// is composed. `Scatter` is still this file's only export, so no import site
// changed.

import * as THREE from 'three';
import type { ChunkView } from './ChunkView.js';
import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import type { PropLibrary } from '../render/instancing/PropLibrary.js';
import { BIOME_PROPS } from '../assets/Registry.js';

import type { WaterOracle } from './WaterOracle.js';
import {
  CELLS, MAX_CELL_M, BUILDS_PER_UPDATE, MAX_PER_CHUNK,
  RADIUS_M, DETAIL_RADIUS_M, DETAIL_FULL_M, tierOf, type Tier,
  CANOPY_FULL_M,
} from './ScatterTuning.js';
import { CONTACT_CARDS } from '../render/ScatterLook.js';
import { PropEmitter } from './ScatterEmit.js';
import { EMPTY_TIER, STALE_EPS_M, type Placed } from './ScatterTypes.js';
import { ScatterCounters, scatterStats, type ScatterStats }
  from './ScatterCounters.js';
import { sampleChunk, type ScatterSampleDeps } from './ScatterSample.js';

export class Scatter {
  private readonly placed = new Map<string, Placed>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  /** Places ONE prop. See ScatterEmit for why the two are separate objects. */
  private readonly em: PropEmitter;
  /** Every reported number, shared by reference with the sampler. */
  private readonly c = new ScatterCounters();
  /** The sampler's read-only half, assembled once. See ScatterSample. */
  private readonly deps: ScatterSampleDeps;

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
    this.deps = {
      pool: this.pool, water: this.water, editsHandle: this.editsHandle,
      densityScale: this.densityScale, eye: this.eye,
      bodyRadiusM: this.bodyRadiusM, canopyRadiusM: this.canopyRadiusM,
      canopyShade: this.canopyShade, em: this.em,
    };
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
    this.c.staleMaxM = stale;
    this.c.staleChunks = staleChunks;
    this.c.backlog = backlog;
    for (const key of [...this.placed.keys()]) {
      if (!seen.has(key)) this.drop(key);
    }
    this.c.chunksScattered = this.placed.size;
    this.c.lastBuildMs = performance.now() - t0;
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

  /**
   * CE-20. The body radius THIS scatter was built against.
   *
   * Published only so the stale-holder census can compare it with the live body
   * and prove this object followed a rebuild. It is a POSITIVE CONTROL for that
   * census: a switch rebuilds the scatter, so this row must always read clean,
   * and a census in which every row is stale is a census that is measuring
   * itself rather than the client.
   */
  get bodyRadiusForAudit(): number { return this.bodyRadiusM; }

  /**
   * CE-19. Release every prop instance this scatter placed, and forget the keys.
   *
   * The body scope's teardown step. It goes through `drop`, one key at a time,
   * rather than clearing the map, because every placed chunk owns slots in the
   * shared `PropLibrary` batches and those batches SURVIVE a body switch: they
   * are process-scoped (one atlas load for the run) while the props standing on
   * a chunk are not. Clearing `placed` without releasing would leak the slots
   * into a pool that reports itself full, which DW-28 names as the worst failure
   * class this project can have, a ceiling that reports success.
   *
   * It also matters that this is keyed teardown and not "drop what is no longer
   * resident": after `TerrainStream.dispose` the resident set is already empty,
   * so the ordinary per-frame reclaim in `update` would never run again and
   * every prop on screen at the moment of the switch would be orphaned.
   */
  clearPlaced(): void {
    for (const key of [...this.placed.keys()]) this.drop(key);
    this.c.chunksScattered = 0;
  }

  private drop(key: string): void {
    const pl = this.placed.get(key);
    if (pl === undefined) return;
    for (const part of pl.parts) this.lib.release(part.material, part.slot);
    this.c.propsPlaced -= pl.scale.length / 3 - pl.canopyProps;
    this.c.wantedProps -= pl.wanted;
    this.c.cellsScattered -= pl.cells;
    this.c.groundM2 -= pl.cells * pl.cellArea;
    this.c.canopyProps -= pl.canopyProps;
    this.c.canopyCells -= pl.canopyCells;
    this.c.canopyWanted -= pl.canopyWanted;
    this.c.canopyM2 -= pl.canopyCells * pl.cellArea;
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
    const pl = sampleChunk(this.deps, this.c, v, base,
      Scatter.detailOn(band) ? card : EMPTY_TIER, canopy, want, pos, cell, band);
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
    this.c.propsPlaced += pl.scale.length / 3 - pl.canopyProps;
    this.c.wantedProps += pl.wanted;
    this.c.cellsScattered += pl.cells;
    this.c.groundM2 += pl.cells * pl.cellArea;
    this.c.canopyProps += pl.canopyProps;
    this.c.canopyCells += pl.canopyCells;
    this.c.canopyWanted += pl.canopyWanted;
    this.c.canopyM2 += pl.canopyCells * pl.cellArea;
    this.write(v, pl);
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

  /** See ScatterCounters.scatterStats: this is the four non-counter values. */
  stats(): ScatterStats {
    return scatterStats(this.c, {
      cellsCapped: this.em.cellsCapped, fair: this.fair,
      canopyRadiusM: this.canopyRadiusM, canopyShade: this.canopyShade,
    });
  }
}
