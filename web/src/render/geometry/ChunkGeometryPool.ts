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
  private readonly index: SharedIndex;

  constructor(capacity: number, layout: ChunkBlobLayout, index: SharedIndex) {
    this.capacity = capacity;
    this.index = index;
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
      // The sim time this chunk became visible, constant across the chunk.
      //
      // It is a per-VERTEX attribute rather than a uniform on purpose: one
      // ShaderMaterial is shared by every chunk (section 4.4), so a per-chunk
      // uniform would mean either a material clone per chunk or a forced
      // uniform re-upload per draw. Storing the fade START (not the fade value)
      // means it is written ONCE at stream-in and the ramp comes for free from
      // the global uTime, so the steady state costs nothing at all.
      const aFadeT0 = new THREE.BufferAttribute(new Float32Array(v), 1);
      // three docs: "after the initial use of a buffer, its usage cannot be
      // changed", so DynamicDrawUsage is set here, before any render.
      for (const a of [position, normal, uv, aBiome, aHeight, aFadeT0]) {
        a.setUsage(THREE.DynamicDrawUsage);
      }
      g.setAttribute('position', position);
      g.setAttribute('normal', normal);
      g.setAttribute('uv', uv);
      g.setAttribute('aBiome', aBiome);
      g.setAttribute('aHeight', aHeight);
      g.setAttribute('aFadeT0', aFadeT0);
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
    // Three of /core's six cube faces are parametrized left-handed, so they need
    // the mirrored index buffer or FrontSide culls them away entirely. Measured
    // per chunk from the vertex normal, so no face table can go stale.
    const wanted = this.index.needsFlip(src.position, src.normal)
      ? this.index.flipped : this.index.attribute;
    if (g.getIndex() !== wanted) g.setIndex(wanted);
    ChunkGeometryPool.write(g, 'position', src.position);
    ChunkGeometryPool.write(g, 'normal', src.normal);
    ChunkGeometryPool.write(g, 'uv', src.uv);
    ChunkGeometryPool.write(g, 'aBiome', src.biome);
    ChunkGeometryPool.write(g, 'aHeight', src.height);
    const bs = g.boundingSphere;
    if (bs !== null) { bs.center.set(0, 0, 0); bs.radius = boundingRadiusM * 1.1; }
  }

  /** Stamp the cross-fade start time (sim seconds) across the whole chunk. */
  setFadeStart(p: PooledGeometry, tSecs: number): void {
    const a = p.geometry.getAttribute('aFadeT0') as THREE.BufferAttribute;
    (a.array as Float32Array).fill(tSecs);
    a.needsUpdate = true;
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
