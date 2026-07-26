// One resident terrain chunk: a pooled BATCH SLOT and its 64-bit anchor. There
// is no THREE.Mesh here any more (DW-11); the whole resident set is two
// BatchedMeshes and a chunk is an instance id inside one of them.
//
// The anchor is the ONLY absolute position anywhere in the chunk path. Vertices
// are float32 relative to it (standing rule 6), and the instance matrix is always
// RE-DERIVED from the anchor rather than patched by a delta, which is why an
// origin rebase cannot accumulate error here.

import * as THREE from 'three';
import { FAR_SCALE } from '../render/Scenes.js';
import type { ChunkGeometryPool, PooledSlot } from '../render/geometry/ChunkGeometryPool.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { Vec3d } from './PlanetBody.js';
import { NO_STITCH, type EdgeStrides } from './EdgeStitch.js';
import type { TerrainChunkMsg } from '../workers/TerrainProtocol.js';

export class ChunkView {
  readonly key: string;
  readonly depth: number;
  readonly anchor: Vec3d;
  chunkRadiusM: number;
  biome: number;
  materialId: number;
  pooled: PooledSlot;
  /** True when this chunk lives in the near 1:1 scene. */
  isNear: boolean;
  /**
   * Drawn this frame. Coverage hides a parent whose four children are in.
   *
   * It starts FALSE to match the slot it was just handed: ChunkBatch allocates
   * every instance invisible, and a view that claimed to be visible already
   * would make the first setVisible(true) a no-op and leave the chunk undrawn.
   * That is exactly what happened, and the symptom was a 3-draw-call frame with
   * no terrain in it, which reads like a triumph until you look at the picture.
   */
  visible = false;
  /** Engine-space instance translation, kept for the jitter probe and the dump. */
  readonly pos = new THREE.Vector3();
  scale = 1;
  readonly faceId: number;
  readonly qx: number;
  readonly qy: number;
  maxOffsetM: number;
  /**
   * The PRISTINE payload, retained so an edge stitch can be recomputed from
   * source when a neighbour subdivides or merges, and so a chunk crossing the
   * near/far cutoff can be re-uploaded into the other batch. Snapping is
   * destructive and a stride can go back down, so the un-snapped vertices have
   * to survive. One already-transferred ArrayBuffer per resident chunk
   * (32,859 B), 12.6 MB of JS heap at a 384 pool against a 384 MB budget.
   */
  blob: ArrayBuffer;
  /** Current edge stitch strides, in neighbourDepth order [-X, +X, -Y, +Y]. */
  strides: EdgeStrides = [...NO_STITCH] as EdgeStrides;
  /**
   * Sim time (seconds) this chunk started dithering in. The fragment shader
   * derives the ramp from it and the global uTime, so the CPU writes it once.
   */
  fadeT0 = 0;

  constructor(msg: TerrainChunkMsg, pooled: PooledSlot) {
    this.key = msg.key;
    this.depth = msg.depth;
    this.faceId = msg.faceId;
    this.qx = msg.qx;
    this.qy = msg.qy;
    this.maxOffsetM = msg.maxOffsetM;
    this.blob = msg.blob;
    this.anchor = { x: msg.cx, y: msg.cy, z: msg.cz };
    this.chunkRadiusM = msg.chunkRadiusM;
    this.biome = msg.biome;
    this.materialId = msg.materialId;
    this.pooled = pooled;
    this.isNear = pooled.near;
  }

  /**
   * A regenerated chunk (dig, restitch) reuses this view and its pooled slot, so
   * the anchor has to be refreshed with the geometry. Keeping a stale anchor
   * next to fresh vertices is how terrain ends up drawn in the wrong place.
   */
  refresh(msg: TerrainChunkMsg): void {
    this.anchor.x = msg.cx;
    this.anchor.y = msg.cy;
    this.anchor.z = msg.cz;
    this.chunkRadiusM = msg.chunkRadiusM;
    this.biome = msg.biome;
    this.materialId = msg.materialId;
    this.maxOffsetM = msg.maxOffsetM;
    this.blob = msg.blob;
    // Fresh vertices are un-snapped, so the stitch has to be recomputed.
    this.strides = [...NO_STITCH] as EdgeStrides;
  }

  /** Re-derive the instance matrix from the anchor. Also the rebase handler. */
  place(origin: FloatingOrigin, pool: ChunkGeometryPool): void {
    if (this.pooled.near) {
      origin.toEngine(this.anchor, this.pos);
      this.scale = 1;
    } else {
      this.pos.set(
        this.anchor.x * FAR_SCALE, this.anchor.y * FAR_SCALE, this.anchor.z * FAR_SCALE,
      );
      this.scale = FAR_SCALE;
    }
    this.isNear = this.pooled.near;
    pool.place(this.pooled, this.pos.x, this.pos.y, this.pos.z, this.scale);
  }

  setVisible(pool: ChunkGeometryPool, v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    pool.setVisible(this.pooled, v);
  }
}
