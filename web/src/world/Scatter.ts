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
  RADIUS_M, MIN_SLOPE_COS, LOD2_M, DETAIL_RADIUS_M, DETAIL_FULL_M,
  DETAIL_FAR_GROW, WET_REJECT_M, detailWeight, tierOf, keyHash, type Tier,
} from './ScatterTuning.js';
import { CLUSTER_SHIFT, CONTACT_CARDS } from './ScatterLook.js';
import { PropEmitter, type Build } from './ScatterEmit.js';

interface Placed {
  /** Flattened [material, slot] pairs; -1 slot means the batch was full. */
  parts: { material: string; slot: number; lod0: number; lod2: number }[];
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
  /** Understorey band this chunk was built in. 0 none, 1 thinned, 2 full. */
  detailBand: number;
}

/** A biome with no understorey draws from this rather than from a null check. */
const EMPTY_TIER: Tier = { specs: [], weights: [], total: 0 };

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
  /** Cells refused for standing water since boot (DW-28). See WET_REJECT_M. */
  wetCells = 0;
  /** Chunks waiting on the per-update sampling budget. Should settle to 0. */
  backlog = 0;

  constructor(
    private readonly lib: PropLibrary,
    private readonly pool: ChunkGeometryPool,
    private readonly enabled: boolean,
    private readonly densityScale: number,
    /**
     * Fair (stochastic) per-cell quantisation. `?scatterfair=0` restores the
     * `Math.round` this shipped with, which is the whole defect: the count is
     * per CELL, DW-19 took the near cell from 7.2 m to 1.808 m, and
     * `round(118920 * 1.808^2 / 1e6)` is `round(0.389)` = **0**. Every chunk
     * under the player scattered NOTHING while `want` for the chunk read 399
     * and every other number looked healthy.
     */
    private readonly fair = true,
    /**
     * `?grassshort=0` restores the RN-15 understorey height band and the
     * height-compounding distance upscale. See `ScatterLook.DETAIL_H_LO`.
     */
    grassShort = true,
    /**
     * The water authority, or null on a dry body. A WaterOracle rather than a
     * height, because it is the ONE place "is there water here" is answered and
     * a second copy of that rule here is the DW-26 failure exactly.
     */
    private readonly water: WaterOracle | null = null,
    /**
     * The live edits handle, read at BUILD time. `depthAt` reads the EDITED
     * ground, so digging a bed deeper deepens the water and a rebuilt chunk
     * has to see it. Boot creates the edits after this, hence a thunk.
     */
    private readonly editsHandle: () => number = () => 0,
  ) {
    this.em = new PropEmitter(lib, fair, grassShort);
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
    for (const v of views) {
      if (!v.isNear || !v.visible) continue;
      if (v.pos.distanceTo(eye) > RADIUS_M + v.maxOffsetM) continue;
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
      if (pl.detailBand === this.detailBandOf(v)) continue;
      if (budget <= 0) { backlog++; continue; }
      budget--;
      this.drop(v.key);
      this.build(v);
    }
    this.backlog = backlog;
    for (const key of [...this.placed.keys()]) {
      if (!seen.has(key)) this.drop(key);
    }
    this.chunksScattered = this.placed.size;
    this.lastBuildMs = performance.now() - t0;
  }

  private detailBandOf(v: ChunkView): number {
    const d = v.pos.distanceTo(this.eye) - v.maxOffsetM;
    if (d <= DETAIL_FULL_M) return 2;
    return d <= DETAIL_RADIUS_M ? 1 : 0;
  }

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
    this.propsPlaced -= pl.scale.length / 3;
    this.wantedProps -= pl.wanted;
    this.cellsScattered -= pl.cells;
    this.groundM2 -= pl.cells * pl.cellArea;
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
    const base: Tier = tierOf(specs.filter((s) => !s.detail));
    const card: Tier = tierOf(specs.filter((s) => s.detail === true));
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
    const pl = this.sample(v, base, band > 0 ? card : EMPTY_TIER, want, pos,
      cell, band);
    // A chunk that legitimately places NOTHING is still recorded, and that is
    // load-bearing twice over. It used to return early, so the chunk was retried
    // every single frame forever, which with a per-update budget starves every
    // chunk behind it: the shipped-behaviour A/B measured 22 chunks queued and
    // ZERO props placed. And its cells belong in `wanted`, because a delivery
    // ratio that only counts the chunks that delivered something is blind in
    // exactly the case the ratio exists to catch.
    this.placed.set(v.key, pl);
    this.propsPlaced += pl.scale.length / 3;
    this.wantedProps += pl.wanted;
    this.cellsScattered += pl.cells;
    this.groundM2 += pl.cells * pl.cellArea;
    this.write(v, pl);
  }

  private sample(
    v: ChunkView, base: Tier, card: Tier, want: number,
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
    // THE BASIN GATE. One dot product per chunk, and it is what makes the
    // per-cell query affordable; the level-radius test alone is not (see
    // WET_REJECT_M). Fails SAFE: a future non-disc water model leaves `disc`
    // null, the gate is skipped, and every cell is queried again.
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
    const r2 = RADIUS_M * RADIUS_M;
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
        if (d2 > r2) continue;
        // Slope from /core's own stored vertex normal, decoded from int8.
        const nx = nrm[i00] / 127, ny = nrm[i00 + 1] / 127, nz = nrm[i00 + 2] / 127;
        const nl = Math.hypot(nx, ny, nz) || 1;
        if ((nx * upx + ny * upy + nz * upz) / nl < MIN_SLOPE_COS) continue;
        // WATER (RN-46, fixed and first proved at RN-48). Last of the three
        // cell tests because it is the only one that can reach WASM.
        // See WET_REJECT_M for the basin gate and the three defects here.
        if (wetR > 0) {
          const wx = a.x + pos[i00];
          const wy = a.y + pos[i00 + 1];
          const wz = a.z + pos[i00 + 2];
          // NORMALIZED: `depthAt` takes a DIRECTION, not a point. RN-46 handed
          // it an absolute 6e5 m position. The length is free, the guard needs it.
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
        // The PATCH this cell belongs to, so a stand of one species spans
        // many cells rather than each cell drawing independently.
        b.cluster = keyBase ^ Math.imul(
          (cy >> CLUSTER_SHIFT) * CELLS + (cx >> CLUSTER_SHIFT), 0x9e3779b1);
        b.i00 = i00; b.i10 = i10; b.i01 = i01; b.i11 = i11;
        b.nx = nx / nl; b.ny = ny / nl; b.nz = nz / nl;
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
            // Bigger the further out, which buys coverage back per instance.
            // See DETAIL_FAR_GROW.
            const grow = 1 + DETAIL_FAR_GROW * (1 - wt);
            wanted += this.em.drawTier(b, card, card.total * perKm2 * wt,
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
    };
  }

  /** Compose every instance matrix from the chunk's CURRENT engine position. */
  private write(v: ChunkView, pl: Placed): void {
    for (let i = 0; i < pl.parts.length; ++i) {
      const o = pl.owner[i];
      this.p.set(
        v.pos.x + pl.local[o * 3], v.pos.y + pl.local[o * 3 + 1], v.pos.z + pl.local[o * 3 + 2],
      );
      this.q.set(pl.quat[o * 4], pl.quat[o * 4 + 1], pl.quat[o * 4 + 2], pl.quat[o * 4 + 3]);
      this.s.set(pl.scale[o * 3], pl.scale[o * 3 + 1], pl.scale[o * 3 + 2]);
      this.m4.compose(this.p, this.q, this.s);
      const part = pl.parts[i];
      const far = this.p.distanceTo(this.eye) > LOD2_M;
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
    };
  }
}
