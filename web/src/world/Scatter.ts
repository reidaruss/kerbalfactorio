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
  CANOPY_FULL_M, CANOPY_MAX_CELL_M, CANOPY_BANDS, canopyReachM,
  CANOPY_TAIL_MULT, canopyTailReachM, CANOPY_CHUNK_KM2, CANOPY_CHUNK_MAX,
  canopyChunkCap,
} from './ScatterTuning.js';
import { CONTACT_CARDS } from '../render/ScatterLook.js';
import { PropEmitter } from './ScatterEmit.js';
import { EMPTY_TIER, STALE_EPS_M, type Placed } from './ScatterTypes.js';
import { ScatterCounters, scatterStats, type ScatterStats }
  from './ScatterCounters.js';
import { sampleChunk, type ScatterSampleDeps } from './ScatterSample.js';

export class Scatter {
  private readonly placed = new Map<string, Placed>();
  /**
   * RN-2229. Resident chunks `build` REFUSED, so they are never offered again
   * while they stay resident.
   *
   * `build` has two early returns that record nothing -- a biome with no prop
   * table, and a mesh cell coarser than this chunk's limit -- so a refused
   * chunk was re-offered every single frame, took the whole
   * `BUILDS_PER_UPDATE` budget of one, and left every chunk behind it in the
   * backlog for ever. It is the identical defect the `placed.set` at the foot
   * of `build` carries a paragraph about ("it used to return early, so the
   * chunk was retried every single frame forever, which with a per-update
   * budget starves every chunk behind it"), in the two paths that comment did
   * not cover.
   *
   * It was INVISIBLE while the reach was 170 m, because a 170 m ring holds two
   * or three chunks and the starved queue drained anyway. At the canopy's
   * 4,200 m it holds eighteen and the queue never emptied at all, which is
   * what the new settle gate turned from a slow fill into a hang. Neither the
   * cell size nor the biome of a given chunk KEY can change, so a refusal is
   * final for as long as the key is resident and this is a cache and not a
   * guess. Counted (`chunksRefused`), because a silent refusal is how the
   * first version of this file scattered nothing and reported success.
   */
  private readonly barren = new Set<string>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  /** RN-2228. The eye's height above the designed surface, metres. Read live
   *  from the observer each frame; see `groundDistM` for what it is for. */
  private eyeAltM = 0;
  /** Places ONE prop. See ScatterEmit for why the two are separate objects. */
  private readonly em: PropEmitter;
  /** Every reported number, shared by reference with the sampler. */
  private readonly c = new ScatterCounters();
  /** The sampler's read-only half, assembled once. See ScatterSample. */
  private readonly deps: ScatterSampleDeps;
  /** A BOX and not a number, for `eye`'s reason: `deps` is assembled once in
   *  the constructor and the sampler reads the live value through it. */
  private readonly alt = { m: 0 };
  /** RN-2234. The realised canopy COVER reach this frame. See `deps.reach`. */
  private readonly reach = { m: 0 };
  /** WG-295. The coarse tail's reach this frame, or 0. See `deps.tail`. */
  private readonly tail = { m: 0 };

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
    /** RN-2225 remedy: DEFAULT OFF pending an Admin ruling, so the
     *  understorey stays at full density under trees and the near ground is
     *  the state it has been in since WG-116. `?canopyshade=1` re-arms it.
     *  Full argument and the judged frames: `Config.ts`, this line. */
    private readonly canopyShade = true,
    /**
     * WG-260. The 170-to-690 m mid tier. `?midhole=0` switches it off, and
     * the switch is read here rather than as a radius of zero because the
     * tier has no radius of its own: its band is `MID_NEAR_M` to
     * `CANOPY_NEAR_FULL_M`, both derived from constants two other tiers
     * already own.
     */
    private readonly mid = true,
    /** WG-260. The biome ring's edge weight. `?midedge=0` restores the
     *  boolean gate the tier shipped with. See `ScatterTuning.BASE_FULL_M`. */
    private readonly midEdge = true,
    /**
     * WG-295. THE COARSE TAIL'S MULTIPLE OF THE COVER REACH. `?canopytail=1`
     * (or anything at or below 1) is the STRUCTURAL off: `canopyTailReachM`
     * returns 0, `deps.tail.m` stays 0, and the sampler's tail branch is never
     * entered, so the build is the pre-WG-295 one rather than a tuning value
     * set to zero (standing rule 7).
     *
     * A multiple and not a radius, so one number serves a 1,200 m flyover and
     * a 60 m ground-adjacent eye without either paying for the other. See
     * `CANOPY_TAIL_MULT`.
     */
    private readonly canopyTailMult = CANOPY_TAIL_MULT,
    /**
     * WG-301. `?capfair=0` restores the raster-order first-N truncation that
     * `MAX_PER_CHUNK` has always been, so the before picture is one binary
     * apart. See `ScatterCap.ts` for what it is truncating and for why the
     * delivery ratio reads 1.0008 while it happens.
     */
    private readonly capFair = true,
    /**
     * RN-2230's coarsest admissible cell for the canopy branch, overridable
     * from `?canopymaxcell=` so the chunk-LOD ceiling on the reach is a
     * MEASURED ladder rather than an assertion. The shipped value admits depth
     * 8 and no coarser; see `CANOPY_MAX_CELL_M` for what depth 7 would cost in
     * positional quantisation.
     */
    private readonly canopyMaxCellM = CANOPY_MAX_CELL_M,
    /**
     * WG-304. Instances per km2 of chunk a CANOPY-ONLY chunk is allowed, from
     * `?canopychunkkm2=`. `0` restores the flat `MAX_PER_CHUNK` at every
     * depth, which is the pre-WG-304 ceiling exactly, so the regression this
     * repairs is one page param away on the shipped binary.
     */
    private readonly canopyChunkKm2 = CANOPY_CHUNK_KM2,
    /**
     * RN-2680. The canopy-only chunk's OUTER ceiling, from `?canopychunkmax=`.
     * Default unchanged: the shipped binary calls `canopyChunkCap` exactly as
     * before this param existed. See `ScatterTuning.canopyChunkCap`'s own
     * comment for what sweeping it proves.
     */
    private readonly canopyChunkMax = CANOPY_CHUNK_MAX,
  ) {
    this.em = new PropEmitter(lib, fair, grassShort);
    this.deps = {
      pool: this.pool, water: this.water, editsHandle: this.editsHandle,
      densityScale: this.densityScale, eye: this.eye,
      bodyRadiusM: this.bodyRadiusM,
      canopyShade: this.canopyShade, mid: this.mid, midEdge: this.midEdge,
      em: this.em, alt: this.alt, tail: this.tail, capFair: this.capFair,
      // RN-2234. A BOX holding the REALISED reach for this frame, refreshed in
      // `update`. The sampler gates and fades on this rather than on the
      // configured radius, so the ring it builds and the ring `reachM` admits
      // chunks for are the same ring.
      reach: this.reach,
    };
  }

  /**
   * The furthest any tier reaches. Residency and rebuild bands ride on it.
   *
   * RN-2234. The canopy's half is now bounded by the eye's height
   * (`canopyReachM`), so the same configured radius serves the flyover and the
   * walk without the walk paying for the flyover. See ScatterTuning for the
   * measured table this is derived from.
   */
  private get reachM(): number {
    const c = this.canopyCoverM;
    const t = this.canopyTailM;
    const far = t > c ? t : c;
    return far > RADIUS_M ? far : RADIUS_M;
  }

  /**
   * RN-2234's reach, unchanged: the range the COVER fade
   * (`canopyDistanceWeight`) is normalised over, and the one the terrain
   * material is told about.
   */
  private get canopyCoverM(): number {
    return canopyReachM(this.canopyRadiusM, this.eyeAltM);
  }

  /**
   * WG-295. The coarse tail's reach, or 0. Zero at every ground pose by
   * construction (`canopyTailReachM` is bounded by the eye's own horizon), so
   * `reachM` there is the number it has always been, to the bit.
   */
  private get canopyTailM(): number {
    const c = this.canopyCoverM;
    if (!(c > RADIUS_M)) return 0;
    return canopyTailReachM(c, this.eyeAltM, this.bodyRadiusM, this.canopyTailMult);
  }

  /** True when the canopy, not the 170 m ground ring, is what `reachM` is. */
  private get canopyGoverns(): boolean {
    return this.canopyCoverM > RADIUS_M;
  }

  /**
   * RN-2265, PUBLISHED FOR RENDERING. The canopy impostor tier's REALISED
   * ground reach this frame, metres, or 0 when the tier is not running.
   *
   * The terrain material's far treeline hands over from this tier exactly where
   * it stops, and the handover is `1 - canopyDistanceWeight(g, reach)`. Reading
   * the reach off the tier itself rather than re-deriving `canopyReachM` on the
   * render side is the whole point: a second copy of this expression is a
   * constant copied from the thing it watches, and the two would silently
   * disagree the first time `?canopy=` or `CANOPY_REACH_PER_ALT` moved. No
   * behaviour changes here; this is an accessor over two existing private
   * getters. See rendering.md 2.18 and TerrainTreeline.ts.
   *
   * **WG-295. IT IS THE COVER REACH AND DELIBERATELY NOT THE OUTER GATE, and
   * that is this lane's stated handover assumption.** The coarse tail places
   * instances beyond this range, so "exactly where it stops" above is no
   * longer literally true and the sentence is corrected here rather than left
   * to rot (a docstring that names a cause outlives the cause). What is
   * published is the range the COVER fade ends at, because that is the
   * quantity `canopyDistanceWeight` is normalised over and the quantity
   * `ofTreeCover`'s Beer-Lambert complement is exact against. The tail is
   * additive silhouette on ground the far paint already colours, priced
   * against R5 rank 1's own finding that the paint moves those rows by under
   * one count; see `canopyTailWeight` for the whole argument and for the
   * `?canopytail=1` switch that removes it if RN-2660 changes that finding.
   */
  get canopyReachOutM(): number {
    return this.canopyGoverns ? this.canopyCoverM : 0;
  }

  /**
   * RN-2228. GROUND distance from the eye to a point on the surface.
   *
   * The eye is `eyeAltM` above the ground and every tier here is a disc ON the
   * ground, so the 3-D distance the reach tests used to compare is the
   * hypotenuse and the radius they compare it against is the base. A radius R
   * at altitude h therefore covered a ground disc of only sqrt(R^2 - h^2), and
   * at the 1,200 m flyover with the shipped 620 m canopy that is not a real
   * number: the tier was OFF, everywhere, from the air, silently.
   *
   * APPLIED TO THE CANOPY GATES ONLY, and that is deliberate rather than
   * partial. The ground tiers live inside 170 m of a standing eye where h is
   * 2 m and the correction is 12 mm at the ring's edge -- big enough to flip a
   * cell that sits exactly on the boundary, and worth nothing. Correcting them
   * too would spend the whole standing-eye bit-identity claim on a
   * millimetre. `?canopy=0` therefore takes the identical arithmetic it took
   * before this method existed (standing rule 7).
   */
  private groundDistM(d: number): number {
    const h = this.eyeAltM;
    return d > h ? Math.sqrt(d * d - h * h) : 0;
  }

  /**
   * Add scatter for chunks that entered the radius, drop it for chunks that
   * left. Only the DELTA is touched, so a stationary player costs one pass over
   * the resident map and no instance writes at all.
   */
  update(views: Iterable<ChunkView>, eye: THREE.Vector3, eyeAltM = 0): void {
    if (!this.enabled) return;
    const t0 = performance.now();
    this.eye.copy(eye);
    this.eyeAltM = eyeAltM;
    this.alt.m = eyeAltM;
    this.reach.m = this.canopyCoverM;
    this.tail.m = this.canopyTailM;
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
      // RN-2228. GROUND distance once the canopy is what `reachM` means, and
      // the shipped 3-D distance when it is not, so `?canopy=0` runs the
      // identical comparison it always did (standing rule 7). Without this the
      // per-cell fix below has nothing to work on: the chunk never becomes
      // resident to be sampled.
      const dEye = v.pos.distanceTo(eye);
      const dReach = this.canopyGoverns ? this.groundDistM(dEye) : dEye;
      if (dReach > this.reachM + v.maxOffsetM) continue;
      seen.add(v.key);
      if (this.barren.has(v.key)) continue;
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
    for (const key of [...this.barren]) if (!seen.has(key)) this.barren.delete(key);
    this.c.chunksRefused = this.barren.size;
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
    // RN-2229. TWO INDEPENDENT BANDS IN ONE INTEGER: the near band in the low
    // three bits, the canopy's fade step above them. They have to be separate
    // numbers now and could be one before, because the canopy's gradient used
    // to end at 620 m -- inside the near band's own last boundary -- and now
    // spans 550 m to 4,200 m of ground, which is most of the world.
    //
    // A chunk is rebuilt when EITHER changes, which is the whole reason a band
    // exists: `sampleChunk` fixes a cell's density at build time, so without a
    // step here a chunk first sampled at 4 km would carry its 16-per-cent
    // edge density all the way in and the ground ahead of a moving observer
    // would be permanently sparser than the ground behind. That is the defect
    // `CANOPY_FULL_M`'s own band was added for, at five times the range.
    return this.nearBandOf(d) | (this.canopyStepOf(d) << 3);
  }

  /** The three near boundaries, exactly as shipped. */
  private nearBandOf(d: number): number {
    if (d <= DETAIL_FULL_M) return 3;
    if (d <= DETAIL_RADIUS_M) return 2;
    return d <= CANOPY_FULL_M ? 1 : 0;
  }

  /**
   * Which step of the canopy gradient a chunk sits in. Zero whenever the tier
   * is off, so `?canopy=0` composes the identical band integer it always did.
   *
   * `CANOPY_BANDS` steps over a fade `CANOPY_FAR_RADIUS_M` long, so the
   * density a chunk carries is never more than one step stale: at 8 steps over
   * 4,200 m that is 525 m of travel, against a ring the observer crosses in
   * tens of seconds on foot and in about five at flying speed. Eight rather
   * than more because each step is a REBUILD of every chunk crossing it, on a
   * budget of one chunk per update (`BUILDS_PER_UPDATE`), and `scatterBacklog`
   * is the counter that says whether the queue is keeping up.
   */
  private canopyStepOf(d: number): number {
    if (!this.canopyGoverns) return 0;
    const reach = this.reachM;
    const g = this.groundDistM(d);
    if (g >= reach) return CANOPY_BANDS;
    return Math.floor((g / reach) * CANOPY_BANDS);
  }

  /** Bands 2 and 3 carry the understorey; 3 carries it at full density. The
   *  mask is `detailBandOf`'s low three bits, see there. */
  private static detailOn(band: number): boolean { return (band & 7) >= 2; }

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
    this.barren.clear();
    this.c.chunksRefused = 0;
    this.c.chunksScattered = 0;
  }

  private drop(key: string): void {
    const pl = this.placed.get(key);
    if (pl === undefined) return;
    for (const part of pl.parts) this.lib.release(part.material, part.slot);
    // WG-260. The mid tier comes OUT of `propsPlaced` on the canopy's terms
    // and for the canopy's reason: that number is the GROUND tiers' density
    // claim (`placedPerM2` against `wantedPerM2`, the property this layer
    // publishes), and a tree standing 400 m away is not part of it. Both
    // subtrahends are matched by the `+=` pair in `build`.
    this.c.propsPlaced -= pl.scale.length / 3 - pl.canopyProps - pl.midProps;
    this.c.wantedProps -= pl.wanted;
    this.c.cellsScattered -= pl.cells;
    this.c.groundM2 -= pl.cells * pl.cellArea;
    this.c.canopyProps -= pl.canopyProps;
    this.c.canopyCells -= pl.canopyCells;
    this.c.canopyWanted -= pl.canopyWanted;
    this.c.canopyM2 -= pl.canopyCells * pl.cellArea;
    this.c.midProps -= pl.midProps;
    this.c.midCards -= pl.midCards;
    this.c.midCells -= pl.midCells;
    this.c.midWanted -= pl.midWanted;
    this.c.midM2 -= pl.midCells * pl.cellArea;
    // WG-301. Matched with the `+=` pair in `build`, so the cap fraction is a
    // property of the RESIDENT set and not of everything ever built.
    this.c.capCells -= pl.capCells;
    this.c.capOfferCells -= pl.capOfferCells;
    this.placed.delete(key);
  }

  private build(v: ChunkView): void {
    const specs = BIOME_PROPS[v.biome];
    if (specs === undefined || specs.length === 0) { this.barren.add(v.key); return; }
    const pos = this.pool.positions(v.pooled);
    // Cell size straight off the mesh: vertex 0 to vertex 1 of the first row.
    const cell = Math.hypot(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]);
    // RN-2230. TWO LIMITS. `MAX_CELL_M` is the GROUND tiers' and is untouched
    // (see `groundOk` below); this outer refusal is the canopy's, which stands
    // on chunks one depth band coarser so the impostor tier can reach past
    // 2.3 km. When the canopy is off the two are the same test and this file
    // refuses exactly the chunks it refused before.
    const maxCell = this.canopyGoverns ? this.canopyMaxCellM : MAX_CELL_M;
    if (!(cell > 0) || cell > maxCell) { this.barren.add(v.key); return; }
    // Whether THIS chunk is fine enough for the ground tiers. A depth-8 chunk
    // admitted for its canopy still places no biome prop, no understorey and
    // no contact skirt: those are measured on a walking player's mesh and have
    // never been measured on a 115 m cell, and at 2 km they carry no pixels.
    const groundOk = cell <= MAX_CELL_M;
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
    const base: Tier = groundOk
      ? tierOf(specs.filter((s) => !s.detail && !s.canopy)) : EMPTY_TIER;
    const card: Tier = groundOk
      ? tierOf(specs.filter((s) => s.detail === true)) : EMPTY_TIER;
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
    // WG-304. THE CEILING IS AREA-AWARE ON A CANOPY-ONLY CHUNK, and nowhere
    // else. See `canopyChunkCap`: `MAX_PER_CHUNK` is a per-CHUNK COUNT applied
    // to chunks whose area spans six orders of magnitude, which makes it a
    // density ceiling four times tighter at every LOD step outward, i.e. the
    // opposite of what a far tier needs. `groundOk` false is exactly the band
    // where the canopy is the only tier drawing, so nothing a walking player
    // stands on can see this line.
    const ceil = groundOk ? MAX_PER_CHUNK
      : canopyChunkCap(areaKm2, this.canopyChunkKm2, this.canopyChunkMax);
    const want = Math.min(ceil,
      Math.max(1, Math.ceil(full.total * areaKm2 * this.densityScale) + 64
        + Math.ceil(base.total * areaKm2 * this.densityScale) * CONTACT_CARDS));
    const pl = sampleChunk(this.deps, this.c, v, base,
      Scatter.detailOn(band) ? card : EMPTY_TIER, canopy, want, pos, cell, band,
      groundOk);
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
    this.c.propsPlaced += pl.scale.length / 3 - pl.canopyProps - pl.midProps;
    this.c.wantedProps += pl.wanted;
    this.c.cellsScattered += pl.cells;
    this.c.groundM2 += pl.cells * pl.cellArea;
    this.c.canopyProps += pl.canopyProps;
    this.c.canopyCells += pl.canopyCells;
    this.c.canopyWanted += pl.canopyWanted;
    this.c.canopyM2 += pl.canopyCells * pl.cellArea;
    this.c.midProps += pl.midProps;
    this.c.midCards += pl.midCards;
    this.c.midCells += pl.midCells;
    this.c.midWanted += pl.midWanted;
    this.c.midM2 += pl.midCells * pl.cellArea;
    // WG-301. Matched with `drop`'s pair. The sampler returns them on the
    // record rather than incrementing, for exactly this reason.
    this.c.capCells += pl.capCells;
    this.c.capOfferCells += pl.capOfferCells;
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
      // RN-2202: three bands, coarsest first, so the impostor rung wins where
      // both thresholds are past. `lod3M === lod2M` for every part that
      // authored no impostor, and then `lod3` IS `lod2`'s id, so this reads
      // exactly as the two-band version did for them.
      const d = this.p.distanceTo(this.eye);
      const geom = d > part.lod3M ? part.lod3
        : d > part.lod2M ? part.lod2 : part.lod0;
      this.lib.place(part.material, part.slot, geom, this.m4);
    }
  }

  /** See ScatterCounters.scatterStats: this is the four non-counter values. */
  stats(): ScatterStats {
    return scatterStats(this.c, {
      cellsCapped: this.em.cellsCapped, fair: this.fair,
      canopyRadiusM: this.canopyRadiusM, canopyShade: this.canopyShade,
      mid: this.mid, midEdge: this.midEdge, capFair: this.capFair,
      canopyTailM: this.canopyTailM,
    });
  }
}
