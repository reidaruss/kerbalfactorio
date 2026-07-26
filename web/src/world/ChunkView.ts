// One resident terrain chunk: a pooled geometry, a Mesh, and its 64-bit anchor.
//
// The anchor is the ONLY absolute position anywhere in the chunk path. Vertices
// are float32 relative to it (standing rule 6), and the engine-space transform
// is always RE-DERIVED from the anchor rather than patched by a delta, which is
// why an origin rebase cannot accumulate error here.

import * as THREE from 'three';
import type { PooledGeometry } from '../render/geometry/ChunkGeometryPool.js';
import { FAR_SCALE } from '../render/Scenes.js';
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
  readonly mesh: THREE.Mesh;
  readonly pooled: PooledGeometry;
  /** True when this chunk lives in the near 1:1 scene. */
  isNear = false;
  readonly faceId: number;
  readonly qx: number;
  readonly qy: number;
  maxOffsetM: number;
  /**
   * The PRISTINE payload, retained so an edge stitch can be recomputed from
   * source when a neighbour subdivides or merges. Snapping is destructive and a
   * stride can go back down, so the un-snapped vertices have to survive. It is
   * one already-transferred ArrayBuffer per resident chunk (32,859 B), which is
   * 12.6 MB of JS heap at a 384 pool against a 384 MB budget.
   */
  blob: ArrayBuffer;
  /** Current edge stitch strides, in neighbourDepth order [-X, +X, -Y, +Y]. */
  strides: EdgeStrides = [...NO_STITCH] as EdgeStrides;
  /**
   * Sim time (seconds) this chunk started dithering in. The fragment shader
   * derives the ramp from it and the global uTime, so the CPU writes it once.
   * -Infinity means "already fully faded in", which is what an evicted-then-
   * recycled slot must NOT inherit.
   */
  fadeT0 = 0;

  constructor(msg: TerrainChunkMsg, pooled: PooledGeometry, material: THREE.Material) {
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
    this.mesh = new THREE.Mesh(pooled.geometry, material);
    this.mesh.name = `chunk ${msg.key}`;
    this.mesh.matrixAutoUpdate = true;
    // Terrain self-shadowing (a ridge onto the valley below it) is the visible
    // half of the shadow milestone; the player casting onto it is the other.
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
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

  /** Re-derive the engine transform from the anchor. Also the rebase handler. */
  place(origin: FloatingOrigin, near: boolean, material: THREE.Material): void {
    this.isNear = near;
    if (this.mesh.material !== material) this.mesh.material = material;
    if (near) {
      origin.toEngine(this.anchor, this.mesh.position);
      this.mesh.scale.setScalar(1);
    } else {
      this.mesh.position.set(
        this.anchor.x * FAR_SCALE, this.anchor.y * FAR_SCALE, this.anchor.z * FAR_SCALE,
      );
      this.mesh.scale.setScalar(FAR_SCALE);
    }
    this.mesh.updateMatrix();
  }
}
