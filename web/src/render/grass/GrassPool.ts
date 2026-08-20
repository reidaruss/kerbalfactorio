// ONE RUNG'S INSTANCE BUFFERS: a packed pool of per-chunk blocks behind one
// InstancedMesh, i.e. one draw call for the whole rung however many chunks are
// resident. RN-2145.
//
// WHY PACKED BLOCKS AND NOT ONE MESH PER CHUNK. A carpet is resident over about
// ten chunks; a mesh each would be ten draw calls per rung, twenty for the
// layer, against a whole-frame budget of 150 that is currently spending 76.
// Packing costs one `copyWithin` when a chunk leaves and buys the layer back
// down to two draws.
//
// WHY CHUNK-LOCAL POSITIONS ARE KEPT. The floating origin rebases every 4 km and
// every engine-space position in the buffer is stale the instant it does.
// Scatter learned this the expensive way (WG-64: 4,000.089191 m of displacement
// across 43 of 43 scattered chunks, because `Scatter.replace` documented itself
// as THE rebase path and nothing called it). The block keeps the positions it
// was built with, chunk-local, and `rebase` recomposes them against the chunk's
// current `pos`. Same subtraction, same fix, one layer out.
//
// THE CAP REFUSES, IT DOES NOT TRUNCATE. WG-193's `meshVertsNear` scar is the
// reason: a cap that silently drops the tail biases every statistic computed
// over what is left (occupancy 1.004 at depth 13 against 0.516 at depth 16,
// half the disc missing, and every percentile taken over whichever chunks the
// iteration happened to reach first). A chunk that will not fit is REFUSED
// whole and counted, and the count is published.

import * as THREE from 'three';

interface Block {
  key: string;
  start: number;
  count: number;
  /** Chunk-local instance offsets, 3 per instance. The rebase input. */
  local: Float32Array;
}

export class GrassPool {
  readonly mesh: THREE.Mesh;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aParam: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly blocks = new Map<string, Block>();
  /** Buffer order. `blocks` is keyed lookup; this is the packing. */
  private readonly order: string[] = [];
  private used = 0;
  /** Instances refused because the pool was full. Published, never swallowed. */
  refused = 0;
  private dirtyLo = Infinity;
  private dirtyHi = -Infinity;

  constructor(
    base: THREE.InstancedBufferGeometry, material: THREE.Material,
    readonly cap: number, readonly trisPerInstance: number, name: string,
  ) {
    this.geom = base;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aParam = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aCol = new THREE.InstancedBufferAttribute(new Uint8Array(cap * 4), 4, true);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aParam.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    base.setAttribute('iPos', this.aPos);
    base.setAttribute('iParam', this.aParam);
    base.setAttribute('iCol', this.aCol);
    base.instanceCount = 0;
    this.mesh = new THREE.Mesh(base, material);
    this.mesh.name = name;
    // NO SHADOW CASTING. The ceiling study priced the alternative: 58.8 per
    // cent of every triangle in the frame is already shadow-map geometry
    // because 45 prop subtrees redraw at LOD0 into three cascades. Feeding
    // tens of thousands more alpha-tested cards into the same three cascades is
    // the one mistake that study exists to stop, and a blade's own cast shadow
    // at 2 cm is below the 2048-map texel at every cascade anyway: it would
    // cost three extra passes to render nothing resolvable. The carpet still
    // RECEIVES, through its own `ofCascadeShadow` call, so it goes dark under a
    // tree exactly as the ground does.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Culled per frame as a whole would be wrong (the base geometry is one
    // card at the origin) and per instance is not available on a plain
    // InstancedMesh; the pool is a 95 m disc about the eye, so there is nothing
    // to cull. PropLibrary sets the same flag on its batches for the same
    // reason.
    this.mesh.frustumCulled = false;
  }

  get liveInstances(): number { return this.used; }
  get liveTriangles(): number { return this.used * this.trisPerInstance; }
  get chunks(): number { return this.blocks.size; }
  has(key: string): boolean { return this.blocks.has(key); }

  /**
   * Append one chunk's instances. `local` is chunk-local (3 per instance),
   * `param` is (yaw, widthM, heightM, wantPerM2), `col` is sRGB bytes plus the
   * value jitter. Returns false if the pool refused, which the caller reports
   * rather than retries.
   */
  add(
    key: string, chunkPos: THREE.Vector3, n: number,
    local: Float32Array, param: Float32Array, col: Uint8Array,
  ): boolean {
    if (this.blocks.has(key)) this.remove(key);
    if (n === 0) {
      this.blocks.set(key, { key, start: this.used, count: 0, local });
      this.order.push(key);
      return true;
    }
    if (this.used + n > this.cap) { this.refused += n; return false; }
    const start = this.used;
    const p = this.aPos.array as Float32Array;
    for (let i = 0; i < n; ++i) {
      p[(start + i) * 3] = chunkPos.x + local[i * 3];
      p[(start + i) * 3 + 1] = chunkPos.y + local[i * 3 + 1];
      p[(start + i) * 3 + 2] = chunkPos.z + local[i * 3 + 2];
    }
    (this.aParam.array as Float32Array).set(param.subarray(0, n * 4), start * 4);
    (this.aCol.array as Uint8Array).set(col.subarray(0, n * 4), start * 4);
    this.blocks.set(key, { key, start, count: n, local });
    this.order.push(key);
    this.used += n;
    this.touch(start, n);
    return true;
  }

  /** Drop one chunk, compacting the tail down over the hole. */
  remove(key: string): void {
    const b = this.blocks.get(key);
    if (b === undefined) return;
    const oi = this.order.indexOf(key);
    if (oi >= 0) this.order.splice(oi, 1);
    this.blocks.delete(key);
    if (b.count > 0) {
      const tail = this.used - (b.start + b.count);
      if (tail > 0) {
        (this.aPos.array as Float32Array)
          .copyWithin(b.start * 3, (b.start + b.count) * 3, this.used * 3);
        (this.aParam.array as Float32Array)
          .copyWithin(b.start * 4, (b.start + b.count) * 4, this.used * 4);
        (this.aCol.array as Uint8Array)
          .copyWithin(b.start * 4, (b.start + b.count) * 4, this.used * 4);
        for (const k of this.order) {
          const o = this.blocks.get(k);
          if (o !== undefined && o.start > b.start) o.start -= b.count;
        }
        this.touch(b.start, tail);
      }
      this.used -= b.count;
    }
  }

  /** THE REBASE PATH. Recompose every engine-space position from its chunk's
   *  CURRENT position. See the header for what happens when nobody calls it. */
  rebase(posOf: (key: string) => THREE.Vector3 | undefined): void {
    const p = this.aPos.array as Float32Array;
    for (const b of this.blocks.values()) {
      if (b.count === 0) continue;
      const cp = posOf(b.key);
      if (cp === undefined) continue;
      for (let i = 0; i < b.count; ++i) {
        const o = (b.start + i) * 3;
        p[o] = cp.x + b.local[i * 3];
        p[o + 1] = cp.y + b.local[i * 3 + 1];
        p[o + 2] = cp.z + b.local[i * 3 + 2];
      }
      this.touch(b.start, b.count);
    }
  }

  clear(): void {
    this.blocks.clear();
    this.order.length = 0;
    this.used = 0;
    this.geom.instanceCount = 0;
  }

  /** Publish this frame's edits and the live count. Once per update. */
  flush(): void {
    this.geom.instanceCount = this.used;
    if (this.dirtyHi < this.dirtyLo) return;
    const lo = this.dirtyLo, n = this.dirtyHi - this.dirtyLo + 1;
    this.aPos.addUpdateRange(lo * 3, n * 3); this.aPos.needsUpdate = true;
    this.aParam.addUpdateRange(lo * 4, n * 4); this.aParam.needsUpdate = true;
    this.aCol.addUpdateRange(lo * 4, n * 4); this.aCol.needsUpdate = true;
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;
  }

  /**
   * FNV-1a over the LIVE instance data, for the determinism claim.
   *
   * It hashes `local` (chunk-local offsets), `param` and `col` PER BLOCK IN KEY
   * ORDER rather than the packed buffers in buffer order, and that distinction
   * is the whole point: the packing order is a function of the order chunks
   * happened to stream in, which is a property of the run, while the CONTENT of
   * a chunk's block is a pure function of the seed and the chunk key and is the
   * thing a determinism claim is actually about. Hashing the buffer would fail
   * on a re-run that streamed the same chunks in a different order and would
   * have said "non-deterministic" about something that is not.
   *
   * Engine-space `iPos` is deliberately NOT hashed: it is chunk-local plus a
   * floating-origin-dependent translation, so it is expected to move and its
   * correctness is `rebase`'s claim, not this one.
   */
  digest(): string {
    let h = 0x811c9dc5 >>> 0;
    const mix = (x: number): void => {
      h = Math.imul(h ^ (x & 0xff), 0x01000193) >>> 0;
      h = Math.imul(h ^ ((x >>> 8) & 0xff), 0x01000193) >>> 0;
      h = Math.imul(h ^ ((x >>> 16) & 0xff), 0x01000193) >>> 0;
      h = Math.imul(h ^ ((x >>> 24) & 0xff), 0x01000193) >>> 0;
    };
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    const mixF = (x: number): void => { f32[0] = x; mix(u32[0]); };
    const param = this.aParam.array as Float32Array;
    const col = this.aCol.array as Uint8Array;
    for (const key of [...this.blocks.keys()].sort()) {
      const b = this.blocks.get(key) as Block;
      for (let i = 0; i < key.length; ++i) mix(key.charCodeAt(i));
      mix(b.count);
      for (let i = 0; i < b.count * 3; ++i) mixF(b.local[i]);
      for (let i = 0; i < b.count * 4; ++i) mixF(param[b.start * 4 + i]);
      for (let i = 0; i < b.count * 4; ++i) mix(col[b.start * 4 + i]);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geom.dispose();
  }

  private touch(start: number, n: number): void {
    if (start < this.dirtyLo) this.dirtyLo = start;
    if (start + n - 1 > this.dirtyHi) this.dirtyHi = start + n - 1;
  }
}
