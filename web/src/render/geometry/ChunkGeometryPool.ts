// Fixed-size geometry pooling with ZERO reallocation (ARCHITECTURE.md 4.3, WR-6).
//
// This is only possible because /core fixed kGridDim at 33, so every chunk that
// will ever stream in is exactly 1,217 vertices. The pool allocates all of its
// attribute storage once at construction; stream-in is attr.array.set(view) plus
// needsUpdate, and eviction is a push onto a free list. Nothing is disposed
// during play, so renderer.info.memory.geometries is FLAT and a leak is visible
// at a glance.

import * as THREE from 'three';
import type { SharedIndex } from './SharedIndex.js';
import type { ChunkBlobLayout, ChunkBlobViews } from '../../world/ChunkFormat.js';
import { chunkBlobViews } from '../../world/ChunkFormat.js';

export interface PooledGeometry {
  readonly slot: number;
  readonly geometry: THREE.BufferGeometry;
}

export class ChunkGeometryPool {
  readonly capacity: number;
  readonly bytesPerChunk: number;
  private readonly slots: PooledGeometry[] = [];
  private readonly free: number[] = [];
  private exhaustedCount = 0;

  private readonly indexCount: number;
  private readonly interiorIndexCount: number;

  constructor(capacity: number, layout: ChunkBlobLayout, index: SharedIndex) {
    this.capacity = capacity;
    this.bytesPerChunk = layout.byteLength;
    this.indexCount = index.indexCount;
    this.interiorIndexCount = index.interiorIndexCount;
    const v = layout.verts;
    for (let i = 0; i < capacity; ++i) {
      const g = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(new Float32Array(v * 3), 3);
      const normal = new THREE.BufferAttribute(new Int8Array(v * 3), 3, true);
      const uv = new THREE.BufferAttribute(new Uint16Array(v * 2), 2, true);
      const aBiome = new THREE.BufferAttribute(new Uint8Array(v * 4), 4, false);
      const aHeight = new THREE.BufferAttribute(new Float32Array(v), 1);
      // three docs: "after the initial use of a buffer, its usage cannot be
      // changed", so DynamicDrawUsage is set here, before any render.
      for (const a of [position, normal, uv, aBiome, aHeight]) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', position);
      g.setAttribute('normal', normal);
      g.setAttribute('uv', uv);
      g.setAttribute('aBiome', aBiome);
      g.setAttribute('aHeight', aHeight);
      g.setIndex(index.attribute);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
      this.slots.push({ slot: i, geometry: g });
      this.free.push(i);
    }
  }

  get inUse(): number { return this.capacity - this.free.length; }
  get freeCount(): number { return this.free.length; }
  get exhausted(): number { return this.exhaustedCount; }
  get bytes(): number { return this.capacity * this.bytesPerChunk; }

  acquire(): PooledGeometry | null {
    const i = this.free.pop();
    if (i === undefined) { this.exhaustedCount++; return null; }
    return this.slots[i];
  }

  release(p: PooledGeometry): void {
    this.free.push(p.slot);
  }

  /**
   * Interior indices come first in /core's buffer precisely so the skirt can be
   * a separate draw range. Skirts hide LOD cracks, but on a coarse chunk the
   * apron is a kilometres-deep vertical wall, so they are drawn only where a
   * crack can actually appear.
   */
  setSkirtVisible(p: PooledGeometry, skirt: boolean): void {
    p.geometry.setDrawRange(0, skirt ? this.indexCount : this.interiorIndexCount);
  }

  /** Copy one chunk's five sections into the pooled attributes. No allocation. */
  upload(p: PooledGeometry, blob: ArrayBuffer, layout: ChunkBlobLayout, boundingRadiusM: number): void {
    const src: ChunkBlobViews = chunkBlobViews(blob, layout);
    const g = p.geometry;
    ChunkGeometryPool.write(g, 'position', src.position);
    ChunkGeometryPool.write(g, 'normal', src.normal);
    ChunkGeometryPool.write(g, 'uv', src.uv);
    ChunkGeometryPool.write(g, 'aBiome', src.biome);
    ChunkGeometryPool.write(g, 'aHeight', src.height);
    const bs = g.boundingSphere;
    if (bs !== null) { bs.center.set(0, 0, 0); bs.radius = boundingRadiusM * 1.1; }
  }

  private static write(g: THREE.BufferGeometry, name: string, src: ArrayLike<number>): void {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    (a.array as unknown as { set(s: ArrayLike<number>): void }).set(src);
    a.needsUpdate = true;
  }

  disposeAll(): void {
    for (const s of this.slots) s.geometry.dispose();
  }
}
