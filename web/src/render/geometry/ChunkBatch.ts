// THE terrain draw-call collapse (DW-11). One BatchedMesh per scene holds every
// resident chunk, so 100-plus terrain meshes become ONE multi-draw and the three
// shadow cascades cost three draws instead of 58.
//
// This is the only file in the codebase that reaches into three's private
// BatchedMesh state, and it does so deliberately rather than through
// setGeometryAt(), because setGeometryAt copies the index range one element at a
// time (6,912 setX calls per chunk) and re-derives the bounding sphere by
// scanning every vertex. A chunk arrives with a FIXED vertex count and a FIXED
// index topology, so the fast path is a typed-array set() into the slot's
// reserved window plus an explicit update range. Everything private is read once,
// in the constructor, and named here so a three upgrade breaks loudly in one
// place instead of silently everywhere.
//
// Slot i is always geometryId i AND instanceId i: geometries and instances are
// allocated once, in order, and never deleted. That is what lets the pool stay a
// plain free list of integers.

import * as THREE from 'three';
import type { ChunkBlobLayout, ChunkBlobViews } from '../../world/ChunkFormat.js';
import type { SharedIndex } from './SharedIndex.js';

/** three's per-geometry record inside BatchedMesh. Private there, used here. */
interface GeometryInfo {
  vertexStart: number;
  indexStart: number;
  /** First index of the slot's draw range. */
  start: number;
  /** Indices drawn: the interior range, or interior + skirt. */
  count: number;
  boundingSphere: THREE.Sphere | null;
  boundingBox: THREE.Box3 | null;
}

interface BatchedPrivate {
  _geometryInfo: GeometryInfo[];
  _visibilityChanged: boolean;
}

const ATTRS = ['position', 'normal', 'uv', 'aBiome', 'aHeight', 'aFadeT0'] as const;

/** The pooled attribute set, allocated once as the template every slot copies. */
function templateGeometry(verts: number, index: SharedIndex): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(verts * 3), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(verts * 2), 2, true));
  g.setAttribute('aBiome', new THREE.BufferAttribute(new Uint8Array(verts * 4), 4, false));
  g.setAttribute('aHeight', new THREE.BufferAttribute(new Float32Array(verts), 1));
  g.setAttribute('aFadeT0', new THREE.BufferAttribute(new Float32Array(verts), 1));
  // Passing the REAL index means addGeometry's own copy loop writes the correct
  // vertexStart-offset triangles for every slot, so a chunk that does not need
  // the mirrored winding never touches the index buffer again.
  g.setIndex(index.attribute);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
  return g;
}

export class ChunkBatch extends THREE.BatchedMesh {
  readonly capacity: number;
  readonly verts: number;
  private readonly info: GeometryInfo[];
  private readonly priv: BatchedPrivate;
  private readonly index: SharedIndex;
  /** Which winding each slot currently carries, so a re-upload is skipped. */
  private readonly flipped: Uint8Array;
  private readonly m4 = new THREE.Matrix4();

  constructor(
    capacity: number, layout: ChunkBlobLayout, index: SharedIndex,
    material: THREE.Material, name: string,
  ) {
    super(capacity, capacity * layout.verts, capacity * index.indexCount, material);
    this.capacity = capacity;
    this.verts = layout.verts;
    this.index = index;
    this.name = name;
    this.flipped = new Uint8Array(capacity);
    // The batch spans every resident chunk, so an object-level frustum test is
    // meaningless; per-INSTANCE culling (on by default) is the one that matters.
    this.frustumCulled = false;
    this.matrixAutoUpdate = false;
    this.castShadow = true;
    this.receiveShadow = true;
    const tmpl = templateGeometry(layout.verts, index);
    for (let i = 0; i < capacity; ++i) {
      const gid = this.addGeometry(tmpl, layout.verts, index.indexCount);
      const iid = this.addInstance(gid);
      if (gid !== i || iid !== i) throw new Error('ChunkBatch: slot ids diverged');
      this.setVisibleAt(i, false);
    }
    tmpl.dispose();
    this.priv = this as unknown as BatchedPrivate;
    this.info = this.priv._geometryInfo;
  }

  /** Bytes this batch holds on the GPU: vertex sections plus its index buffer. */
  get bytes(): number {
    return this.capacity * (this.verts * 28 + this.index.indexCount * 4);
  }

  /**
   * Copy one chunk's five sections into the slot's reserved window. No
   * allocation, one update range per attribute, and the index is only rewritten
   * when the winding actually changes (three of /core's six cube faces are
   * left-handed; see SharedIndex).
   */
  upload(slot: number, src: ChunkBlobViews, boundingRadiusM: number): void {
    this.write(slot, 'position', src.position);
    this.write(slot, 'normal', src.normal);
    this.write(slot, 'uv', src.uv);
    this.write(slot, 'aBiome', src.biome);
    this.write(slot, 'aHeight', src.height);
    const flip = this.index.needsFlip(src.position, src.normal) ? 1 : 0;
    if (flip !== this.flipped[slot]) { this.flipped[slot] = flip; this.writeIndex(slot, flip === 1); }
    const info = this.info[slot];
    const bs = info.boundingSphere;
    if (bs !== null) { bs.center.set(0, 0, 0); bs.radius = boundingRadiusM * 1.1; }
    info.boundingBox = null;
  }

  /** Stamp the cross-fade start time (sim seconds) across the slot. */
  setFadeStart(slot: number, tSecs: number): void {
    const a = this.geometry.getAttribute('aFadeT0') as THREE.BufferAttribute;
    const start = this.info[slot].vertexStart;
    (a.array as Float32Array).fill(tSecs, start, start + this.verts);
    a.needsUpdate = true;
    a.addUpdateRange(start, this.verts);
  }

  /**
   * Interior indices come first in /core's buffer precisely so the skirt can be
   * a separate draw range. On a coarse chunk the apron is a kilometres-deep
   * vertical wall, so it is drawn only where a crack can actually appear.
   */
  setSkirtVisible(slot: number, skirt: boolean): void {
    const info = this.info[slot];
    const want = skirt ? this.index.indexCount : this.index.interiorIndexCount;
    if (info.count === want) return;
    info.count = want;
    this.priv._visibilityChanged = true;
  }

  /** Place the slot. Translation and uniform scale only (negative scale is UB). */
  place(slot: number, x: number, y: number, z: number, scale: number): void {
    this.m4.makeScale(scale, scale, scale);
    this.m4.elements[12] = x;
    this.m4.elements[13] = y;
    this.m4.elements[14] = z;
    this.setMatrixAt(slot, this.m4);
  }

  /** Live view of the slot's positions, for in-place edge stitching. */
  positions(slot: number): Float32Array {
    const a = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const s = this.info[slot].vertexStart * 3;
    return (a.array as Float32Array).subarray(s, s + this.verts * 3);
  }

  /** Live view of the slot's int8 vertex normals, for the scatter slope test. */
  normals(slot: number): Int8Array {
    const a = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const s = this.info[slot].vertexStart * 3;
    return (a.array as Int8Array).subarray(s, s + this.verts * 3);
  }

  heights(slot: number): Float32Array {
    const a = this.geometry.getAttribute('aHeight') as THREE.BufferAttribute;
    const s = this.info[slot].vertexStart;
    return (a.array as Float32Array).subarray(s, s + this.verts);
  }

  /** Re-flag the two attributes edge stitching writes through the subarrays. */
  stitched(slot: number): void {
    this.write(slot, 'position', null);
    this.write(slot, 'aHeight', null);
  }

  /** Draw-range indices for one slot, for the agent-facing chunk dump. */
  drawCount(slot: number): number { return this.info[slot].count; }
  boundingRadius(slot: number): number { return this.info[slot].boundingSphere?.radius ?? -1; }

  private write(slot: number, name: typeof ATTRS[number], src: ArrayLike<number> | null): void {
    const a = this.geometry.getAttribute(name) as THREE.BufferAttribute;
    const off = this.info[slot].vertexStart * a.itemSize;
    if (src !== null) {
      (a.array as unknown as { set(s: ArrayLike<number>, o: number): void }).set(src, off);
    }
    a.needsUpdate = true;
    a.addUpdateRange(off, this.verts * a.itemSize);
  }

  private writeIndex(slot: number, flip: boolean): void {
    const dst = this.geometry.getIndex() as THREE.BufferAttribute;
    const src = (flip ? this.index.flipped : this.index.attribute).array as Uint16Array;
    const info = this.info[slot];
    const base = info.vertexStart;
    const out = dst.array as Uint32Array;
    const start = info.indexStart;
    for (let i = 0; i < src.length; ++i) out[start + i] = base + src[i];
    dst.needsUpdate = true;
    dst.addUpdateRange(start, src.length);
  }
}
