// terrain.worker client. Owns the resident chunk set and nothing else: it does
// not decide what to stream (of::TerrainStreamer does), it does not shade
// (TerrainMaterial does) and it does not own the origin (FloatingOrigin does).
//
// One observe request is in flight at a time, so the worker is never queued
// behind stale observer positions.

import * as THREE from 'three';
import type { Events } from '../app/Events.js';
import type { Scenes } from '../render/Scenes.js';
import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import type { TerrainMaterials } from '../render/materials/TerrainMaterial.js';
import type { ChunkBlobLayout } from './ChunkFormat.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { Vec3d } from './PlanetBody.js';
import { ChunkView } from './ChunkView.js';
import type { FromTerrain, TerrainObserveMsg, TerrainUpdateMsg } from '../workers/TerrainProtocol.js';

export interface StreamMetrics {
  updateMs: number;
  packMs: number;
  uploadMs: number;
  bytesLastUpdate: number;
  bytesTotal: number;
  chunksBuilt: number;
  poolExhausted: number;
  roundTripMs: number;
}

export class TerrainStream {
  readonly metrics: StreamMetrics = {
    updateMs: 0, packMs: 0, uploadMs: 0, bytesLastUpdate: 0,
    bytesTotal: 0, chunksBuilt: 0, poolExhausted: 0, roundTripMs: 0,
  };
  converged = false;
  residentTarget = 0;
  nearCount = 0;
  farCount = 0;
  hiddenCount = 0;
  private evictedSinceCover = false;

  private readonly views = new Map<string, ChunkView>();
  private readonly inbox: TerrainUpdateMsg[] = [];
  private seq = 0;
  private inFlight = false;
  private sentAtMs = 0;
  private cutoff = 6;
  private cutoffDirty = false;
  private readonly lastObserved: Vec3d = { x: NaN, y: NaN, z: NaN };
  /** Preallocated selection buffers for probeStakes (2.2 rule 6). */
  private readonly nearest: (ChunkView | null)[] = new Array(8).fill(null);
  private readonly nearestD2 = new Float64Array(8);

  constructor(
    private readonly worker: Worker,
    private readonly pool: ChunkGeometryPool,
    private readonly layout: ChunkBlobLayout,
    readonly materials: TerrainMaterials,
    private readonly scenes: Scenes,
    private readonly origin: FloatingOrigin,
    private readonly events: Events,
    private readonly skirts: boolean,
  ) {
    this.worker.addEventListener('message', (e) => this.onMessage(e as MessageEvent<FromTerrain>));
    // Exactly one subscriber to the one broadcast (ARCHITECTURE.md 3.6).
    this.events.on('OriginRebased', () => this.onOriginRebased());
  }

  private onMessage(e: MessageEvent<FromTerrain>): void {
    const msg = e.data;
    if (msg.type === 'error') { console.error('[of] terrain.worker:', msg.message); return; }
    if (msg.type !== 'update') return;
    this.inFlight = false;
    this.metrics.roundTripMs = performance.now() - this.sentAtMs;
    this.inbox.push(msg);
  }

  /** Coarsest depth allowed in the near scene; below it a chunk is scaled. */
  setNearDepthCutoff(c: number): void {
    if (c === this.cutoff) return;
    this.cutoff = c;
    this.cutoffDirty = true;
  }

  /** Post the observer. Skipped while a request is in flight or nothing moved. */
  request(observer: Vec3d): void {
    if (this.inFlight) return;
    const moved = !(Math.abs(observer.x - this.lastObserved.x) < 0.5
      && Math.abs(observer.y - this.lastObserved.y) < 0.5
      && Math.abs(observer.z - this.lastObserved.z) < 0.5);
    if (!moved && this.converged) return;
    this.lastObserved.x = observer.x;
    this.lastObserved.y = observer.y;
    this.lastObserved.z = observer.z;
    const msg: TerrainObserveMsg = {
      type: 'observe', seq: ++this.seq,
      x: observer.x, y: observer.y, z: observer.z,
    };
    this.inFlight = true;
    this.sentAtMs = performance.now();
    this.worker.postMessage(msg);
  }

  /** Apply worker payloads. Called once per rendered frame from Loop.onDrain. */
  drain(): void {
    const t0 = performance.now();
    let uploaded = 0;
    while (this.inbox.length > 0) {
      const msg = this.inbox.shift() as TerrainUpdateMsg;
      this.metrics.updateMs = msg.updateMs;
      this.metrics.packMs = msg.packMs;
      this.metrics.bytesLastUpdate = msg.bytes;
      this.metrics.bytesTotal += msg.bytes;
      this.converged = msg.converged;
      this.residentTarget = msg.resident;
      for (const key of msg.evicted) this.evict(key);
      for (const c of msg.chunks) { this.apply(c); uploaded++; }
      this.events.emit('StreamUpdate', {
        resident: msg.resident, generated: msg.generated, converged: msg.converged,
      });
    }
    if (this.cutoffDirty) { this.resort(); this.cutoffDirty = false; }
    if (uploaded > 0 || this.evictedSinceCover) { this.updateCoverage(); this.evictedSinceCover = false; }
    if (uploaded > 0) this.metrics.uploadMs = performance.now() - t0;
    this.recount();
  }

  /**
   * of::TerrainStreamer keeps minResidentDepth shells resident for the WHOLE
   * body (that is what gives the far scene a complete planet), so a coarse
   * ancestor and its fine descendants are resident SIMULTANEOUSLY and cover the
   * same ground. At depth 2 the vertex spacing is 7.3 km, so an ancestor
   * interpolating across a ridge sits kilometres ABOVE the fine terrain and
   * renders as a grey mesa punched through the landscape.
   *
   * A chunk is hidden exactly when all four of its children are resident, which
   * is precisely when they cover its whole quad. This recurses for free, is
   * O(resident), and leaves no hole during streaming because a partially
   * subdivided parent stays visible.
   */
  private updateCoverage(): void {
    let hidden = 0;
    for (const v of this.views.values()) {
      const [face, depth, qx, qy] = v.key.split(':').map(Number);
      const cd = depth + 1;
      const cx = qx * 2;
      const cy = qy * 2;
      const covered = this.views.has(`${face}:${cd}:${cx}:${cy}`)
        && this.views.has(`${face}:${cd}:${cx + 1}:${cy}`)
        && this.views.has(`${face}:${cd}:${cx}:${cy + 1}`)
        && this.views.has(`${face}:${cd}:${cx + 1}:${cy + 1}`);
      v.mesh.visible = !covered;
      if (covered) hidden++;
    }
    this.hiddenCount = hidden;
  }

  private apply(c: import('../workers/TerrainProtocol.js').TerrainChunkMsg): void {
    let view = this.views.get(c.key);
    if (view !== undefined) {
      // Same key regenerated (a dig or a neighbour-depth restitch): reuse the slot.
      view.refresh(c);
      this.pool.upload(view.pooled, c.blob, this.layout, c.maxOffsetM);
      this.placeInScene(view);
      return;
    }
    const pooled = this.pool.acquire();
    if (pooled === null) {
      this.metrics.poolExhausted = this.pool.exhausted;
      return;
    }
    const near = c.depth >= this.cutoff;
    view = new ChunkView(c, pooled, near ? this.materials.near : this.materials.far);
    this.pool.upload(pooled, c.blob, this.layout, c.maxOffsetM);
    this.views.set(c.key, view);
    this.placeInScene(view);
    this.metrics.chunksBuilt++;
    this.events.emit('ChunkReady', { key: c.key, depth: c.depth, near });
  }

  private placeInScene(view: ChunkView): void {
    const near = view.depth >= this.cutoff;
    const target = near ? this.scenes.near : this.scenes.far;
    const material = near ? this.materials.near : this.materials.far;
    if (view.mesh.parent !== target) {
      view.mesh.removeFromParent();
      target.add(view.mesh);
    }
    // Skirts are NEAR-scene only. The apron depth is proportional to chunk
    // size, so on a depth-3 far chunk it is an 82 km vertical wall that drapes
    // over the entire landscape (measured, and visible in the W1 diagnosis).
    // In the scaled scene the quadtree is a complete partition and any residual
    // T-junction crack is subpixel, so the skirt buys nothing there.
    this.pool.setSkirtVisible(view.pooled, this.skirts && near);
    view.place(this.origin, near, material);
  }

  private evict(key: string): void {
    const view = this.views.get(key);
    if (view === undefined) return;
    view.mesh.removeFromParent();
    this.pool.release(view.pooled);
    this.views.delete(key);
    this.evictedSinceCover = true;
    this.events.emit('ChunkEvicted', { key });
  }

  private resort(): void {
    for (const view of this.views.values()) this.placeInScene(view);
  }

  /** The ONE rebase contract. Re-derive, never patch. */
  onOriginRebased(): void {
    for (const view of this.views.values()) {
      view.place(this.origin, view.isNear, view.mesh.material as THREE.Material);
    }
  }

  private recount(): void {
    let near = 0;
    for (const v of this.views.values()) if (v.isNear) near++;
    this.nearCount = near;
    this.farCount = this.views.size - near;
  }

  report(): {
    resident: number; near: number; far: number; pending: number; converged: boolean;
    poolInUse: number; poolFree: number; hidden: number; metrics: StreamMetrics;
  } {
    return {
      hidden: this.hiddenCount,
      resident: this.views.size,
      near: this.nearCount,
      far: this.farCount,
      pending: Math.max(0, this.residentTarget - this.views.size) + this.inbox.length,
      converged: this.converged && this.inbox.length === 0 && !this.inFlight,
      poolInUse: this.pool.inUse,
      poolFree: this.pool.freeCount,
      // A COPY: window.__of.stats() is used to diff two moments in time, and
      // handing out the live object makes every before/after comparison read
      // as "nothing changed".
      metrics: { ...this.metrics },
    };
  }

  /**
   * Fill JitterProbe stake rows from the chunks nearest the engine origin:
   * [anchor xyz (engine metres), local xyz (the f32 vertex offset)] per stake.
   * Two stakes per chunk, the corner vertex and the centre vertex, because the
   * quantization the GPU sees depends on BOTH the camera-to-anchor distance and
   * the vertex's own offset from that anchor.
   */
  probeStakes(out: Float64Array, maxStakes: number): number {
    const slots = this.nearest;
    const d2s = this.nearestD2;
    slots.fill(null);
    d2s.fill(Infinity);
    for (const v of this.views.values()) {
      if (!v.isNear || !v.mesh.visible) continue;
      const d2 = v.mesh.position.lengthSq();
      if (d2 >= d2s[slots.length - 1]) continue;
      let i = slots.length - 1;
      while (i > 0 && d2s[i - 1] > d2) { d2s[i] = d2s[i - 1]; slots[i] = slots[i - 1]; i--; }
      d2s[i] = d2; slots[i] = v;
    }
    const centre = (33 * 16 + 16) * 3;
    let s = 0;
    for (let k = 0; k < slots.length && s + 1 < maxStakes; ++k) {
      const v = slots[k];
      if (v === null) break;
      const arr = (v.mesh.geometry.getAttribute('position') as THREE.BufferAttribute)
        .array as Float32Array;
      for (const base of [0, centre]) {
        const o = s * 6;
        out[o] = v.mesh.position.x; out[o + 1] = v.mesh.position.y; out[o + 2] = v.mesh.position.z;
        out[o + 3] = arr[base]; out[o + 4] = arr[base + 1]; out[o + 5] = arr[base + 2];
        s++;
      }
    }
    return s;
  }

  /** Agent-facing dump of live chunk state, surfaced as window.__of.chunks(). */
  dump(limit = 4, nearOnly = false): unknown[] {
    const out: unknown[] = [];
    for (const v of this.views.values()) {
      if (out.length >= limit) break;
      if (nearOnly && !v.isNear) continue;
      const attr = v.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let maxLocal = 0;
      for (let i = 0; i < arr.length; i += 3) {
        const r = arr[i] * arr[i] + arr[i + 1] * arr[i + 1] + arr[i + 2] * arr[i + 2];
        if (r > maxLocal) maxLocal = r;
      }
      out.push({
        key: v.key, depth: v.depth, near: v.isNear, biome: v.biome,
        parent: v.mesh.parent?.name ?? null,
        visible: v.mesh.visible,
        material: (v.mesh.material as THREE.Material).name,
        meshPos: v.mesh.position.toArray().map((n) => Math.round(n)),
        scale: v.mesh.scale.x,
        distFromCamOriginM: Math.round(v.mesh.position.length() / (v.isNear ? 1 : 1e-5)),
        maxLocalM: Math.round(Math.sqrt(maxLocal)),
        bsRadius: Math.round(v.mesh.geometry.boundingSphere?.radius ?? -1),
        indexCount: v.mesh.geometry.getIndex()?.count ?? -1,
        v0: [arr[0], arr[1], arr[2]].map((n) => Math.round(n)),
      });
    }
    return out;
  }

  dispose(): void {
    this.worker.terminate();
    for (const v of this.views.values()) v.mesh.removeFromParent();
    this.views.clear();
    this.pool.disposeAll();
    this.materials.dispose();
  }
}
