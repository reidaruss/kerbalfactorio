// terrain.worker client. Owns the resident chunk set and nothing else: it does
// not decide what to stream (of::TerrainStreamer does), it does not shade
// (TerrainMaterial does) and it does not own the origin (FloatingOrigin does).
//
// One observe request is in flight at a time, so the worker is never queued
// behind stale observer positions.

import type * as THREE from 'three';
import type { Events } from '../app/Events.js';
import type { Scenes } from '../render/Scenes.js';
import type { ChunkGeometryPool, PooledSlot } from '../render/geometry/ChunkGeometryPool.js';
import type { TerrainMaterials } from '../render/materials/TerrainMaterial.js';
import type { ChunkBlobLayout } from './ChunkFormat.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { Vec3d } from './PlanetBody.js';
import { ChunkView } from './ChunkView.js';
import { anyStitch, neighbourStrides, stitchEdges, stridesEqual, NO_STITCH, type EdgeStrides } from './EdgeStitch.js';
import { dumpChunks, probeStakes } from './TerrainDebug.js';
import { ChunkRetire } from './ChunkRetire.js';
import { updateCoverage as coverage } from './ChunkCoverage.js';
import type { FromTerrain, TerrainObserveMsg, TerrainUpdateMsg } from '../workers/TerrainProtocol.js';

export interface TerrainStreamOptions {
  readonly skirts: boolean;
  readonly stitching: boolean;
  /** Cross-fade duration in sim seconds. 0 reproduces the W2 hard pop. */
  readonly fadeSecs: number;
  /** Draw far-scene chunks at all. ?shell=0 isolates the PlanetProxy. */
  readonly shell: boolean;
}

export interface StitchMetrics {
  /** Chunks whose seam mask changed on the last resident-set change. */
  restitched: number;
  /** Edge vertices snapped onto a coarser neighbour on that pass. */
  verticesMoved: number;
  ms: number;
  totalRestitched: number;
}

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
  /** Chunks still dithering in. settle() gates on this, so no capture is mid-fade. */
  fadingCount = 0;
  /** Sim seconds, pushed by Loop. The cross-fade ramp is derived from it. */
  nowSecs = 0;
  private evictedSinceCover = false;

  private readonly views = new Map<string, ChunkView>();
  /** The outgoing half of the cross-dissolve. See ChunkRetire. */
  private readonly retiring: ChunkRetire;
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
  readonly stitchMetrics: StitchMetrics = {
    restitched: 0, verticesMoved: 0, ms: 0, totalRestitched: 0,
  };

  constructor(
    private readonly worker: Worker,
    private readonly pool: ChunkGeometryPool,
    private readonly layout: ChunkBlobLayout,
    readonly materials: TerrainMaterials,
    private readonly scenes: Scenes,
    private readonly origin: FloatingOrigin,
    private readonly events: Events,
    private readonly opts: TerrainStreamOptions,
  ) {
    // The two batches ARE the terrain scene graph: two Object3Ds for the whole
    // resident set, added once and never re-parented (DW-11).
    this.scenes.near.add(pool.nearBatch);
    this.scenes.far.add(pool.farBatch);
    this.retiring = new ChunkRetire(pool, opts.fadeSecs);
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
    if (uploaded > 0 || this.evictedSinceCover) {
      this.updateCoverage();
      // Coverage first: a chunk hidden by its four children must not be found
      // as anyone's coarse neighbour (EdgeStitch.neighbourStrides).
      this.stitchAll();
      this.evictedSinceCover = false;
    }
    if (uploaded > 0) this.metrics.uploadMs = performance.now() - t0;
    this.retiring.reap(this.nowSecs);
    this.tickFade();
    this.recount();
  }

  /**
   * Recompute every resident chunk's LOD seam. Runs only when the resident set
   * changed, which is what makes it affordable: about 250 views x 4 edges x 3
   * probes of a Map.
   *
   * The neighbour depths come from the LIVE resident set rather than from
   * of_chunk_neighbour_depths, deliberately. /core annotates neighbours only on
   * freshly-ready chunks, so an already-resident chunk whose neighbour later
   * merges keeps a stale answer and its crack reopens with nothing to trigger a
   * rebuild. The resident set is always current, needs no bridge call, and lets
   * a stride go back DOWN as well as up.
   */
  private stitchAll(): void {
    if (!this.opts.stitching) return;
    const t0 = performance.now();
    const visible = (key: string): boolean => this.views.get(key)?.visible === true;
    let restitched = 0;
    let moved = 0;
    for (const v of this.views.values()) {
      const want = neighbourStrides(v.faceId, v.depth, v.qx, v.qy, visible);
      if (stridesEqual(want, v.strides)) continue;
      v.strides = want;
      restitched++;
      // Re-upload the pristine payload first: snapping is destructive and a
      // stride can shrink as well as grow.
      this.pool.upload(v.pooled, v.blob, this.layout, v.maxOffsetM);
      if (!anyStitch(want)) continue;
      // These are LIVE windows into the batch's attribute buffers, so the snap
      // happens in place exactly as it did against a per-chunk pooled geometry.
      moved += stitchEdges(this.pool.positions(v.pooled), this.pool.heights(v.pooled), want);
      this.pool.stitched(v.pooled);
    }
    this.stitchMetrics.restitched = restitched;
    this.stitchMetrics.verticesMoved = moved;
    this.stitchMetrics.ms = performance.now() - t0;
    if (restitched > 0) this.stitchMetrics.totalRestitched += restitched;
  }

  /** See ChunkCoverage: hide a parent whose four children have finished fading. */
  private updateCoverage(): void {
    const r = coverage(this.views, this.pool, this.nowSecs, this.opts.fadeSecs, this.opts.shell);
    this.hiddenCount = r.hidden;
    this.fadingCount = r.fading;
  }

  /**
   * Coverage depends on elapsed time, not only on the resident set, so it has to
   * be re-evaluated while anything is still fading even when nothing arrived.
   */
  private tickFade(): void {
    if (this.fadingCount > 0) this.updateCoverage();
  }

  private apply(c: import('../workers/TerrainProtocol.js').TerrainChunkMsg): void {
    const near = c.depth >= this.cutoff;
    let view = this.views.get(c.key);
    if (view !== undefined) {
      // Same key regenerated (a dig or a neighbour-depth restitch): reuse the slot.
      view.refresh(c);
      this.pool.upload(view.pooled, c.blob, this.layout, c.maxOffsetM);
      this.placeInScene(view);
      return;
    }
    const pooled = this.take(near);
    if (pooled === null) {
      this.metrics.poolExhausted = this.pool.exhausted;
      return;
    }
    view = new ChunkView(c, pooled);
    // A recycled slot still carries the previous tenant's fade stamp, so this is
    // written for every NEW view and never for a refresh (same terrain, no fade).
    view.fadeT0 = this.nowSecs;
    this.pool.setFadeStart(pooled, view.fadeT0);
    this.pool.upload(pooled, c.blob, this.layout, c.maxOffsetM);
    this.views.set(c.key, view);
    this.placeInScene(view);
    this.metrics.chunksBuilt++;
    this.events.emit('ChunkReady', { key: c.key, depth: c.depth, near });
  }

  /** Free-list pop, with the retiring set as the only slack worth reclaiming. */
  private take(near: boolean): PooledSlot | null {
    const p = this.pool.acquire(near);
    if (p !== null) return p;
    // Retiring chunks are the only slack the pool has; give them up before
    // dropping a chunk that is actually needed.
    this.retiring.reap(this.nowSecs, true);
    return this.pool.acquire(near);
  }

  private placeInScene(view: ChunkView): void {
    const near = view.depth >= this.cutoff;
    if (near !== view.pooled.near) {
      // The chunk crossed the nearDepthCutoff, so it moves to the other BATCH:
      // one BatchedMesh has one material and one parent. It is re-uploaded from
      // the retained pristine payload, which is one of the reasons that payload
      // is retained. Only a regime change does this.
      const next = this.take(near);
      if (next !== null) {
        this.pool.release(view.pooled);
        view.pooled = next;
        this.pool.setFadeStart(next, view.fadeT0);
        this.pool.upload(next, view.blob, this.layout, view.maxOffsetM);
        view.visible = false;
        view.strides = [...NO_STITCH] as EdgeStrides;
      }
    }
    // Skirts are NEAR-scene only. The apron depth is proportional to chunk
    // size, so on a depth-3 far chunk it is an 82 km vertical wall that drapes
    // over the entire landscape (measured, and visible in the W1 diagnosis).
    // In the scaled scene the quadtree is a complete partition and any residual
    // T-junction crack is subpixel, so the skirt buys nothing there.
    this.pool.setSkirtVisible(view.pooled, this.opts.skirts && view.pooled.near);
    view.place(this.origin, this.pool);
    view.setVisible(this.pool, view.pooled.near || this.opts.shell);
  }

  private evict(key: string): void {
    const view = this.views.get(key);
    if (view === undefined) return;
    this.views.delete(key);
    this.evictedSinceCover = true;
    this.events.emit('ChunkEvicted', { key });
    if (this.opts.fadeSecs > 0 && view.visible) {
      this.retiring.push(view, this.nowSecs);
      return;
    }
    this.pool.release(view.pooled);
  }

  private resort(): void {
    for (const view of this.views.values()) this.placeInScene(view);
  }

  /** The ONE rebase contract. Re-derive, never patch. Retiring chunks are still
   *  on screen for a quarter of a second, so they re-derive too. */
  onOriginRebased(): void {
    for (const view of this.views.values()) view.place(this.origin, this.pool);
    this.retiring.onOriginRebased(this.origin);
  }

  private recount(): void {
    let near = 0;
    for (const v of this.views.values()) if (v.isNear) near++;
    this.nearCount = near;
    this.farCount = this.views.size - near;
  }

  report(): {
    resident: number; near: number; far: number; pending: number; converged: boolean;
    poolInUse: number; poolFree: number; hidden: number; fading: number;
    metrics: StreamMetrics; stitch: StitchMetrics;
  } {
    return {
      hidden: this.hiddenCount,
      fading: this.fadingCount + this.retiring.length,
      stitch: { ...this.stitchMetrics },
      resident: this.views.size,
      near: this.nearCount,
      far: this.farCount,
      pending: Math.max(0, this.residentTarget - this.views.size) + this.inbox.length,
      // A capture must not land mid-dissolve, so a still-fading chunk counts as
      // "not settled" exactly the way a pending chunk does.
      converged: this.converged && this.inbox.length === 0 && !this.inFlight
        && this.fadingCount === 0 && this.retiring.length === 0,
      poolInUse: this.pool.inUse,
      poolFree: this.pool.freeCount,
      // A COPY: window.__of.stats() is used to diff two moments in time, and
      // handing out the live object makes every before/after comparison read
      // as "nothing changed".
      metrics: { ...this.metrics },
    };
  }

  /** JitterProbe stake rows from the chunks nearest the camera. See TerrainDebug. */
  probeStakes(out: Float64Array, maxStakes: number, cam: THREE.Vector3): number {
    return probeStakes(this.views.values(), out, maxStakes, cam, this.nearest, this.nearestD2, this.pool);
  }

  /** Agent-facing dump of live chunk state, surfaced as window.__of.chunks(). */
  dump(limit = 4, nearOnly = false): unknown[] {
    return dumpChunks(this.views.values(), limit, nearOnly, this.nowSecs, this.pool);
  }

  dispose(): void {
    this.worker.terminate();
    this.pool.nearBatch.removeFromParent();
    this.pool.farBatch.removeFromParent();
    this.views.clear();
    this.pool.disposeAll();
    this.materials.dispose();
  }
}
