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
import { BIOME_PROPS, type PropSpec } from '../assets/Registry.js';

import {
  CELLS, DIM, MAX_CELL_M, BUILDS_PER_UPDATE, MAX_PER_CHUNK, MAX_PER_CELL,
  RADIUS_M, MIN_SLOPE_COS, LOD2_M, DETAIL_RADIUS_M,
  tierOf, hash32, keyHash, frac, type Tier,
} from './ScatterTuning.js';

interface Placed {
  /** Flattened [material, slot] pairs; -1 slot means the batch was full. */
  parts: { material: string; slot: number; lod0: number; lod2: number }[];
  local: Float32Array;
  quat: Float32Array;
  scale: Float32Array;
  /** parts index -> prop index, so one matrix serves a multi-material prop. */
  owner: Uint16Array;
  /** Cells this chunk actually drew from, and one cell's ground area. */
  cells: number;
  cellArea: number;
  /** What the registry ASKED for over those cells, before any quantisation. */
  wanted: number;
  /** Was this chunk inside the detail ring when it was built? */
  detailBuilt: boolean;
}

export class Scatter {
  private readonly placed = new Map<string, Placed>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly n = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly spin = new THREE.Quaternion();
  private readonly eye = new THREE.Vector3();
  chunksScattered = 0;
  lastBuildMs = 0;
  /** Prop instances (not parts) currently placed, and the ground they sit on. */
  propsPlaced = 0;
  wantedProps = 0;
  cellsScattered = 0;
  groundM2 = 0;
  /** Cells and chunks whose draw was TRUNCATED by a cap. Must stay 0 near. */
  cellsCapped = 0;
  chunksCapped = 0;
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
  ) {}

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
      // would put the player back on bare ground. Rebuild it the once, when it
      // crosses the detail boundary, rather than paying for cards out to 170 m.
      if (pl.detailBuilt === this.detailEligible(v)) continue;
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

  private detailEligible(v: ChunkView): boolean {
    return v.pos.distanceTo(this.eye) <= DETAIL_RADIUS_M + v.maxOffsetM;
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
    this.propsPlaced -= pl.scale.length;
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
    const full: Tier = tierOf(specs);
    const base: Tier = tierOf(specs.filter((s) => !s.detail));
    // HEADROOM, not a target. Fair quantisation means the realised count is a
    // sum of Bernoulli draws about the expectation, so an allocation sized to
    // the expectation exactly would truncate about half the chunks. 64 is four
    // standard deviations at a full 1,024-cell chunk, and `chunksCapped` counts
    // any truncation that happens anyway rather than swallowing it.
    const want = Math.min(MAX_PER_CHUNK,
      Math.max(1, Math.ceil(full.total * areaKm2 * this.densityScale) + 64));
    const detailBuilt = this.detailEligible(v);
    const pl = this.sample(v, detailBuilt ? full : base, base, want, pos, cell,
      detailBuilt);
    // A chunk that legitimately places NOTHING is still recorded, and that is
    // load-bearing twice over. It used to return early, so the chunk was retried
    // every single frame forever, which with a per-update budget starves every
    // chunk behind it: the shipped-behaviour A/B measured 22 chunks queued and
    // ZERO props placed. And its cells belong in `wanted`, because a delivery
    // ratio that only counts the chunks that delivered something is blind in
    // exactly the case the ratio exists to catch.
    this.placed.set(v.key, pl);
    this.propsPlaced += pl.scale.length;
    this.wantedProps += pl.wanted;
    this.cellsScattered += pl.cells;
    this.groundM2 += pl.cells * pl.cellArea;
    this.write(v, pl);
  }

  private sample(
    v: ChunkView, full: Tier, base: Tier, want: number,
    pos: Float32Array, cell: number, detailBuilt: boolean,
  ): Placed {
    const nrm = this.pool.batch(v.pooled).normals(v.pooled.slot);
    const keyBase = keyHash(v.key);
    const local = new Float32Array(want * 3);
    const quat = new Float32Array(want * 4);
    const scale = new Float32Array(want);
    const parts: Placed['parts'] = [];
    const owner: number[] = [];
    // The chunk's own outward direction: the anchor IS a point on the sphere.
    const a = v.anchor;
    const ar = Math.hypot(a.x, a.y, a.z) || 1;
    const upx = a.x / ar, upy = a.y / ar, upz = a.z / ar;
    let n = 0;
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
    const detailR2 = DETAIL_RADIUS_M * DETAIL_RADIUS_M;
    for (let cy = 0; cy < CELLS && n < want; ++cy) {
      for (let cx = 0; cx < CELLS && n < want; ++cx) {
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
        const i10 = i00 + 3;
        const i01 = i00 + DIM * 3;
        const i11 = i01 + 3;
        const seed = keyBase ^ Math.imul(cy * CELLS + cx, 0x27d4eb2f);
        cells++;
        const tier = d2 <= detailR2 ? full : base;
        const expect = tier.total * perKm2;
        wanted += expect;
        const whole = Math.floor(expect);
        const drawn = this.fair
          ? whole + (frac(hash32(seed, 0x9e3779b1)) < expect - whole ? 1 : 0)
          : Math.round(expect);
        if (drawn > MAX_PER_CELL) this.cellsCapped++;
        const perCell = Math.min(MAX_PER_CELL, drawn);
        for (let k = 0; k < perCell && n < want; ++k) {
          const u = frac(hash32(seed, k * 4));
          const w = frac(hash32(seed, k * 4 + 1));
          const spec = this.pick(tier, hash32(seed, k * 4 + 2));
          const list = this.lib.partsOf(spec.stem);
          if (list === null) continue;
          local[n * 3] = this.bilerp(pos, i00, i10, i01, i11, 0, u, w);
          local[n * 3 + 1] = this.bilerp(pos, i00, i10, i01, i11, 1, u, w);
          local[n * 3 + 2] = this.bilerp(pos, i00, i10, i01, i11, 2, u, w);
          // Stand it on the SURFACE normal, then spin it about that normal.
          this.n.set(nx / nl, ny / nl, nz / nl);
          this.q.setFromUnitVectors(this.up, this.n);
          this.spin.setFromAxisAngle(this.up, frac(hash32(seed, k * 4 + 3)) * Math.PI * 2);
          this.q.multiply(this.spin);
          quat[n * 4] = this.q.x; quat[n * 4 + 1] = this.q.y;
          quat[n * 4 + 2] = this.q.z; quat[n * 4 + 3] = this.q.w;
          scale[n] = 1 + (frac(hash32(seed, k * 4 + 5)) * 2 - 1) * spec.jitter;
          for (const part of list) {
            const slot = this.lib.acquire(part.material);
            if (slot < 0) continue;
            parts.push({ material: part.material, slot, lod0: part.lod0, lod2: part.lod2 });
            owner.push(n);
          }
          n++;
        }
      }
    }
    if (n >= want) this.chunksCapped++;
    return {
      parts, local: local.subarray(0, n * 3), quat: quat.subarray(0, n * 4),
      scale: scale.subarray(0, n), owner: Uint16Array.from(owner),
      cells, cellArea, wanted, detailBuilt,
    };
  }

  private bilerp(
    a: Float32Array, i00: number, i10: number, i01: number, i11: number,
    c: number, u: number, w: number,
  ): number {
    const top = a[i00 + c] + (a[i10 + c] - a[i00 + c]) * u;
    const bot = a[i01 + c] + (a[i11 + c] - a[i01 + c]) * u;
    return top + (bot - top) * w;
  }

  private pick(t: Tier, h: number): PropSpec {
    let r = frac(h) * t.total;
    for (let i = 0; i < t.specs.length; ++i) {
      r -= t.weights[i];
      if (r <= 0) return t.specs[i];
    }
    return t.specs[t.specs.length - 1];
  }

  /** Compose every instance matrix from the chunk's CURRENT engine position. */
  private write(v: ChunkView, pl: Placed): void {
    for (let i = 0; i < pl.parts.length; ++i) {
      const o = pl.owner[i];
      this.p.set(
        v.pos.x + pl.local[o * 3], v.pos.y + pl.local[o * 3 + 1], v.pos.z + pl.local[o * 3 + 2],
      );
      this.q.set(pl.quat[o * 4], pl.quat[o * 4 + 1], pl.quat[o * 4 + 2], pl.quat[o * 4 + 3]);
      this.s.setScalar(pl.scale[o]);
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
    scatterBacklog: number; fairQuantise: boolean;
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
      cellsCapped: this.cellsCapped,
      chunksCapped: this.chunksCapped,
      scatterBacklog: this.backlog,
      fairQuantise: this.fair,
    };
  }
}
