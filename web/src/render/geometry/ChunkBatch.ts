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
import type { Vec3d } from '../../world/PlanetBody.js';
import { fillCanopyIndex } from './ChunkCanopy.js';
import { reduceAnchorPhase } from '../../world/ChunkPhase.js';
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

const ATTRS = ['position', 'normal', 'uv', 'aBiome', 'aHeight', 'aFadeT0',
  'aCanopy', 'aPhase', 'aCover'] as const;

/** The pooled attribute set, allocated once as the template every slot copies. */
function templateGeometry(verts: number, index: SharedIndex): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(verts * 3), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(verts * 2), 2, true));
  g.setAttribute('aBiome', new THREE.BufferAttribute(new Uint8Array(verts * 4), 4, false));
  g.setAttribute('aHeight', new THREE.BufferAttribute(new Float32Array(verts), 1));
  g.setAttribute('aFadeT0', new THREE.BufferAttribute(new Float32Array(verts), 1));
  // RN-2265. The canopy area index. A seventh section, written by the CLIENT
  // rather than by /core: the field is world-gen's `canopyWeight` and the
  // client is where world-gen's TypeScript lives, so nothing crosses the wasm
  // boundary and the chunk wire format (ChunkFormat.ts) is untouched.
  g.setAttribute('aCanopy', new THREE.BufferAttribute(new Float32Array(verts), 1));
  // WG-230. THE WORLD-LOCKED PHASE, an eighth section and the second one the
  // CLIENT writes rather than /core. It is `frac(anchor / PHASE_PERIOD_M)`,
  // a PER-CHUNK CONSTANT replicated across the slot's vertices exactly as
  // aFadeT0 is, so the wire format is untouched for the same reason RN-2265's
  // is: the quantity is a pure float64 function of a number the chunk already
  // carries. It is three floats and not six because a tiling TEXTURE fetch
  // consumes only the fractional part; see ChunkPhase.ts's WG-230 note.
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  // RN-2511. The ground-cover field, a NINTH section and the third the client
  // writes rather than /core. It is world-gen's two stand octaves at the
  // vertex's own world position, filled in the same pass and from the same two
  // noise samples as aCanopy, so the cost is one array write per vertex and no
  // extra field evaluation wherever the canopy pass already runs. Unlike
  // aFadeT0/aCanopy/aPhase it is NOT a per-chunk constant: it varies within a
  // chunk at 165 m, which is what it is for.
  g.setAttribute('aCover', new THREE.BufferAttribute(new Float32Array(verts), 1));
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
  /** RN-2265. Each slot's 64-bit body-frame anchor, retained for the refill. */
  private readonly anchors: Float64Array;

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
    this.anchors = new Float64Array(capacity * 3);
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

  /**
   * Bytes this batch holds on the GPU: vertex sections plus its index buffer.
   *
   * 52 and not 32: position 12 + normal 3-padded-to-4 + uv 4 + aBiome 4 +
   * aHeight 4 + aFadeT0 4 + aCanopy 4 is 36, plus aPhase's three floats
   * (WG-230) and aCover's one (RN-2511). NEITHER IS FREE and neither is
   * reported as if it were: aPhase's 12 B is 1,217 verts x 12 B x 128 slots x
   * two batches = 3.74 MB against the pool's own 12.6 MB of retained blobs, a
   * 30 per cent rise for one attribute, and aCover's 4 B is a further 1.25 MB
   * on the same arithmetic, i.e. a tenth of the retained blobs again.
   *
   * OWED, AND NAMED HERE BECAUSE THIS IS WHERE IT IS VISIBLE: aFadeT0 (4 B),
   * aCanopy (4 B) and aPhase (12 B) are all PER-CHUNK CONSTANTS replicated
   * across 1,217 vertices. Twenty bytes a vertex is carrying 2.5 KB of real
   * information in 3.1 MB of buffer. The consolidation is one slot-indexed
   * data texture read with three's own `getIndirectIndex(gl_DrawID)`; it was
   * refused here because it would rewrite two other lanes' shipped attributes
   * to land one new one.
   */
  get bytes(): number {
    return this.capacity * (this.verts * 52 + this.index.indexCount * 4);
  }

  /**
   * Copy one chunk's five sections into the slot's reserved window. No
   * allocation, one update range per attribute, and the index is only rewritten
   * when the winding actually changes (three of /core's six cube faces are
   * left-handed; see SharedIndex).
   */
  upload(slot: number, src: ChunkBlobViews, boundingRadiusM: number,
    anchor: Vec3d): void {
    this.write(slot, 'position', src.position);
    this.write(slot, 'normal', src.normal);
    this.write(slot, 'uv', src.uv);
    this.write(slot, 'aBiome', src.biome);
    this.write(slot, 'aHeight', src.height);
    // RN-2265. The anchor is RETAINED because the canopy index has to be
    // re-derived after `EdgeStitch` moves an edge vertex, and `stitched()` has
    // no anchor of its own. Keeping the anchor beside the slot is also what
    // makes that re-derivation impossible to forget.
    this.anchors[slot * 3] = anchor.x;
    this.anchors[slot * 3 + 1] = anchor.y;
    this.anchors[slot * 3 + 2] = anchor.z;
    this.fillCanopy(slot, src.position, src.height, src.biome);
    this.fillPhase(slot, anchor);
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

  /**
   * Re-flag the two attributes edge stitching writes through the subarrays.
   *
   * RN-2265: and RE-DERIVE the canopy index, because the stitch has just moved
   * edge vertices onto a coarser neighbour's lattice. Skipping this would leave
   * one vertex row carrying the field sampled at its PRE-SNAP position while
   * the coarse neighbour carries it at the post-snap one, i.e. a step in the
   * treeline along every 2:1 depth boundary in the frame -- exactly the seam
   * the "evaluate at world position, filter nothing" rule exists to avoid.
   */
  stitched(slot: number): void {
    this.write(slot, 'position', null);
    this.write(slot, 'aHeight', null);
    this.fillCanopy(slot, this.positions(slot), this.heights(slot),
      this.biomes(slot));
  }

  /** Live view of the slot's per-vertex biome record, for the canopy refill. */
  private biomes(slot: number): Uint8Array {
    const a = this.geometry.getAttribute('aBiome') as THREE.BufferAttribute;
    const s = this.info[slot].vertexStart * 4;
    return (a.array as Uint8Array).subarray(s, s + this.verts * 4);
  }

  /**
   * WG-230. Stamp the chunk's reduced world phase across the slot.
   *
   * IT IS DELIBERATELY ABSENT FROM `stitched()`, which is the one interesting
   * thing about it and the opposite of aCanopy's rule three methods up. The
   * canopy index is a function of each vertex's own position and therefore has
   * to be re-derived when EdgeStitch moves one. The phase is a function of the
   * CHUNK, and the per-vertex half of the coordinate is `position` itself,
   * which the stitch has already rewritten: `aPhase + position / P` follows a
   * snapped vertex for free. Re-filling here would be a no-op that read as a
   * safeguard.
   */
  private fillPhase(slot: number, anchor: Vec3d): void {
    const a = this.geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    const p = reduceAnchorPhase(anchor);
    const arr = a.array as Float32Array;
    const off = this.info[slot].vertexStart * 3;
    for (let i = 0; i < this.verts; ++i) {
      arr[off + i * 3] = p[0];
      arr[off + i * 3 + 1] = p[1];
      arr[off + i * 3 + 2] = p[2];
    }
    a.needsUpdate = true;
    a.addUpdateRange(off, this.verts * 3);
  }

  private fillCanopy(slot: number, position: Float32Array, height: Float32Array,
    biome: Uint8Array): void {
    const a = this.geometry.getAttribute('aCanopy') as THREE.BufferAttribute;
    // RN-2511. The cover field rides the SAME call: two consumers, one pass,
    // one pair of noise samples per vertex. Filling it separately would double
    // the only expensive part of this loop.
    const c = this.geometry.getAttribute('aCover') as THREE.BufferAttribute;
    const off = this.info[slot].vertexStart;
    const dst = (a.array as Float32Array).subarray(off, off + this.verts);
    const cov = (c.array as Float32Array).subarray(off, off + this.verts);
    fillCanopyIndex(dst, cov, position, height, biome, this.verts,
      this.anchors[slot * 3], this.anchors[slot * 3 + 1],
      this.anchors[slot * 3 + 2]);
    a.needsUpdate = true;
    a.addUpdateRange(off, this.verts);
    c.needsUpdate = true;
    c.addUpdateRange(off, this.verts);
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
