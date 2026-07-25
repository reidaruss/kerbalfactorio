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

  constructor(msg: TerrainChunkMsg, pooled: PooledGeometry, material: THREE.Material) {
    this.key = msg.key;
    this.depth = msg.depth;
    this.anchor = { x: msg.cx, y: msg.cy, z: msg.cz };
    this.chunkRadiusM = msg.chunkRadiusM;
    this.biome = msg.biome;
    this.materialId = msg.materialId;
    this.pooled = pooled;
    this.mesh = new THREE.Mesh(pooled.geometry, material);
    this.mesh.name = `chunk ${msg.key}`;
    this.mesh.matrixAutoUpdate = true;
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
