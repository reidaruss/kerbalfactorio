// Fixed-size chunk slot pooling with ZERO reallocation (ARCHITECTURE.md 4.3,
// WR-6), now over two BatchedMeshes instead of 384 THREE.Mesh objects (DW-11).
//
// This is only possible because /core fixed kGridDim at 33, so every chunk that
// will ever stream in is exactly 1,217 vertices. Both batches allocate all of
// their attribute storage once; stream-in is a typed-array set into the slot's
// window, and eviction is a push onto a free list. Nothing is disposed during
// play, so renderer.info.memory.geometries is FLAT (2) and a leak is visible at
// a glance.
//
// There are TWO free lists because there are two batches: the near 1:1 scene and
// the scaled far scene use different materials AND different cameras, and one
// BatchedMesh has one material and one parent. A chunk that crosses the
// nearDepthCutoff therefore swaps slots and is re-uploaded from its retained
// pristine payload, which happens only on a regime change.

import type * as THREE from 'three';
import type { SharedIndex } from './SharedIndex.js';
import type { ChunkBlobLayout } from '../../world/ChunkFormat.js';
import { chunkBlobViews } from '../../world/ChunkFormat.js';
import { ChunkBatch } from './ChunkBatch.js';

/** A slot is (which batch, which index in it). Nothing else identifies a chunk. */
export interface PooledSlot {
  readonly slot: number;
  readonly near: boolean;
}

export class ChunkGeometryPool {
  readonly nearBatch: ChunkBatch;
  readonly farBatch: ChunkBatch;
  private readonly freeNear: number[] = [];
  private readonly freeFar: number[] = [];
  private readonly slotsNear: PooledSlot[] = [];
  private readonly slotsFar: PooledSlot[] = [];
  private exhaustedCount = 0;
  readonly layout: ChunkBlobLayout;

  constructor(
    capacity: number, layout: ChunkBlobLayout, index: SharedIndex,
    materials: { near: THREE.Material; far: THREE.Material },
  ) {
    this.layout = layout;
    // Measured at W4a on the surface: 106 near / 146 far of 252 resident, and 96
    // all-far in orbit. 60% of the old single pool on each side leaves headroom
    // on both without paying for a full pool twice.
    const per = Math.max(128, Math.round(capacity * 0.6));
    this.nearBatch = new ChunkBatch(per, layout, index, materials.near, 'terrainNear');
    this.farBatch = new ChunkBatch(per, layout, index, materials.far, 'terrainFar');
    for (let i = per - 1; i >= 0; --i) {
      this.slotsNear[i] = { slot: i, near: true };
      this.slotsFar[i] = { slot: i, near: false };
      this.freeNear.push(i);
      this.freeFar.push(i);
    }
  }

  get capacity(): number { return this.nearBatch.capacity + this.farBatch.capacity; }
  get inUse(): number { return this.capacity - this.freeCount; }
  get freeCount(): number { return this.freeNear.length + this.freeFar.length; }
  get exhausted(): number { return this.exhaustedCount; }
  get bytes(): number { return this.nearBatch.bytes + this.farBatch.bytes; }
  /** Vertex sections plus the slot's OWN index range: a batch cannot share one. */
  get bytesPerChunk(): number { return this.bytes / this.capacity; }

  batch(p: PooledSlot): ChunkBatch { return p.near ? this.nearBatch : this.farBatch; }

  acquire(near: boolean): PooledSlot | null {
    const free = near ? this.freeNear : this.freeFar;
    const i = free.pop();
    if (i === undefined) { this.exhaustedCount++; return null; }
    return near ? this.slotsNear[i] : this.slotsFar[i];
  }

  release(p: PooledSlot): void {
    this.batch(p).setVisibleAt(p.slot, false);
    (p.near ? this.freeNear : this.freeFar).push(p.slot);
  }

  setSkirtVisible(p: PooledSlot, skirt: boolean): void {
    this.batch(p).setSkirtVisible(p.slot, skirt);
  }

  /** Copy one chunk's five sections into the slot. No allocation. */
  upload(p: PooledSlot, blob: ArrayBuffer, layout: ChunkBlobLayout, boundingRadiusM: number): void {
    this.batch(p).upload(p.slot, chunkBlobViews(blob, layout), boundingRadiusM);
  }

  setFadeStart(p: PooledSlot, tSecs: number): void {
    this.batch(p).setFadeStart(p.slot, tSecs);
  }

  setVisible(p: PooledSlot, v: boolean): void { this.batch(p).setVisibleAt(p.slot, v); }

  place(p: PooledSlot, x: number, y: number, z: number, scale: number): void {
    this.batch(p).place(p.slot, x, y, z, scale);
  }

  positions(p: PooledSlot): Float32Array { return this.batch(p).positions(p.slot); }
  heights(p: PooledSlot): Float32Array { return this.batch(p).heights(p.slot); }
  stitched(p: PooledSlot): void { this.batch(p).stitched(p.slot); }

  disposeAll(): void {
    this.nearBatch.dispose();
    this.farBatch.dispose();
  }
}
