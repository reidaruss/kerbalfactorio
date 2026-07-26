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

/** 33x33 vertices, so 32 cells a side. /core fixes this (kGridDim). */
const DIM = 33;
const CELLS = DIM - 1;
/**
 * Vertex spacing above which a chunk is too coarse to scatter onto. MEASURED,
 * not chosen: the streamer reaches depth 11 under a walking player at maxDepth
 * 12, and a depth-11 chunk is about 900 m across, so its cell is about 28 m.
 * A 14 m limit rejected every chunk in the world and the first run scattered
 * exactly nothing while reporting success. DW-19's finer LOD is what shrinks
 * this, and the prop's own placement error shrinks with it.
 */
const MAX_CELL_M = 64;
/** Instances per chunk ceiling, and how far from the eye scatter reaches. */
const MAX_PER_CHUNK = 2600;
const MAX_PER_CELL = 20;
const RADIUS_M = 170;
/**
 * cos of the steepest ground a prop will stand on, about 57 degrees. 40 degrees
 * was the first guess and it emptied the Mountains biome: a mountain FLANK is
 * steeper than that almost everywhere, so the one biome whose whole identity is
 * loose rock had no loose rock on it.
 */
const MIN_SLOPE_COS = 0.55;
/** Screen-space-free LOD: props past this distance draw their LOD2 geometry. */
const LOD2_M = 45;

interface Placed {
  /** Flattened [material, slot] pairs; -1 slot means the batch was full. */
  parts: { material: string; slot: number; lod0: number; lod2: number }[];
  local: Float32Array;
  quat: Float32Array;
  scale: Float32Array;
  /** parts index -> prop index, so one matrix serves a multi-material prop. */
  owner: Uint16Array;
}

function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
function keyHash(key: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < key.length; ++i) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}
/** [0,1) from the n-th draw of a chunk's stream. */
const frac = (h: number): number => (h >>> 8) / 16777216;

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

  constructor(
    private readonly lib: PropLibrary,
    private readonly pool: ChunkGeometryPool,
    private readonly enabled: boolean,
    private readonly densityScale: number,
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
    for (const v of views) {
      if (!v.isNear || !v.visible) continue;
      if (v.pos.distanceTo(eye) > RADIUS_M + v.maxOffsetM) continue;
      seen.add(v.key);
      if (!this.placed.has(v.key)) this.build(v);
    }
    for (const key of [...this.placed.keys()]) {
      if (!seen.has(key)) this.drop(key);
    }
    this.chunksScattered = this.placed.size;
    this.lastBuildMs = performance.now() - t0;
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
    const weights = specs.map((s) => s.density);
    const total = weights.reduce((a, b) => a + b, 0);
    const want = Math.min(MAX_PER_CHUNK,
      Math.max(1, Math.round(total * areaKm2 * this.densityScale)));
    const pl = this.sample(v, specs, weights, total, want, pos, cell);
    if (pl !== null) { this.placed.set(v.key, pl); this.write(v, pl); }
  }

  private sample(
    v: ChunkView, specs: readonly PropSpec[], weights: number[], total: number,
    want: number, pos: Float32Array, cell: number,
  ): Placed | null {
    const nrm = this.pool.batch(v.pooled).normals(v.pooled.slot);
    const base = keyHash(v.key);
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
    const perCell = Math.min(MAX_PER_CELL,
      Math.max(0, Math.round(total * (cellArea / 1e6) * this.densityScale)));
    const r2 = RADIUS_M * RADIUS_M;
    for (let cy = 0; cy < CELLS && n < want; ++cy) {
      for (let cx = 0; cx < CELLS && n < want; ++cx) {
        const i00 = (cy * DIM + cx) * 3;
        const dx = v.pos.x + pos[i00] - this.eye.x;
        const dy = v.pos.y + pos[i00 + 1] - this.eye.y;
        const dz = v.pos.z + pos[i00 + 2] - this.eye.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        // Slope from /core's own stored vertex normal, decoded from int8.
        const nx = nrm[i00] / 127, ny = nrm[i00 + 1] / 127, nz = nrm[i00 + 2] / 127;
        const nl = Math.hypot(nx, ny, nz) || 1;
        if ((nx * upx + ny * upy + nz * upz) / nl < MIN_SLOPE_COS) continue;
        const i10 = i00 + 3;
        const i01 = i00 + DIM * 3;
        const i11 = i01 + 3;
        const seed = base ^ Math.imul(cy * CELLS + cx, 0x27d4eb2f);
        for (let k = 0; k < perCell && n < want; ++k) {
          const u = frac(hash32(seed, k * 4));
          const w = frac(hash32(seed, k * 4 + 1));
          const spec = this.pick(specs, weights, total, hash32(seed, k * 4 + 2));
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
    if (n === 0) { for (const p of parts) this.lib.release(p.material, p.slot); return null; }
    return {
      parts, local: local.subarray(0, n * 3), quat: quat.subarray(0, n * 4),
      scale: scale.subarray(0, n), owner: Uint16Array.from(owner),
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

  private pick(
    specs: readonly PropSpec[], weights: number[], total: number, h: number,
  ): PropSpec {
    let r = frac(h) * total;
    for (let i = 0; i < specs.length; ++i) {
      r -= weights[i];
      if (r <= 0) return specs[i];
    }
    return specs[specs.length - 1];
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

  stats(): { chunks: number; buildMs: number } {
    return { chunks: this.chunksScattered, buildMs: Math.round(this.lastBuildMs * 100) / 100 };
  }
}
