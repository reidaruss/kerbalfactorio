// The trees of the world, as real harvestable objects (WG-116 to WG-121).
//
// Reid: "there should be no scenery trees. all trees should be minable." It is
// the SAME ruling the rocks got in WG-67, finished: THERE ARE NO INERT TREES.
// This module streams wood harvest nodes in around the player wherever the
// planet says a tree stands; the scenery tier it replaces is retired in
// `Config.canopyRadiusM`.
//
// A tree is an attribute of the PLANET, not of the visit: existence, position,
// species and size are pure functions of (seed, lattice cell), so the same
// ground grows the same trees on every approach, at any LOD, in any session.
// That purity is also the persistence key: a chopped tree is saved as (cell,
// remaining), never as an array index, because the /core node array is filled in
// visit order and a walk does not reproduce one.
//
// The shape is `RockField`'s deliberately and almost line for line: that module
// shipped and was proven bit-identical over a 5 km round trip. Four things
// differ, each for a stated reason: the ring is thirteen times the area, the
// density is thinned by the EXISTING stand field and treeline rather than by a
// second cluster table, the ring edge wanders, and the clearing is kept out.

import { NODE_KIND, type GameCore } from './GameCore.js';
import type { NodeField } from './NodeField.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { WaterOracle } from '../world/WaterOracle.js';
import { canopyWeight, standAt } from '../world/ScatterTuning.js';
import {
  MAX_PER_CELL, TREE_CELL_M, TREE_CLEARING_KEEPOUT_M,
  TREE_DENSITY_KM2, TREE_EDGE_WANDER_M, TREE_MIN_SLOPE_COS, TREE_WET_REJECT_M,
  edgeWander, frac, oracleSlopeCos, treeHash, treeScaleFor,
} from './TreeTuning.js';
import type { TreeStats } from './TreeTuning.js';

/** Re-scan when the feet move this far: half a cell, so the ring's edge error
 *  stays under one cell and a stationary player costs zero scans. */
const RESCAN_MOVE_M = TREE_CELL_M / 2;

/** Cells built per update. Lower than the rocks' 24: a tree cell adds altitude
 *  and stand samples to the biome call and pays a three-tap slope per candidate,
 *  over ten times as many cells. `backlog` reports the queue so this cannot
 *  become a ring that never catches up. */
const CELL_BUILDS_PER_UPDATE = 12;

interface CellRec { expected: number; placed: number[] }
interface Known { index: number; initial: number }

interface PendingCell {
  key: string; i: number; jw: number; latC: number; lonC: number;
  dLat: number; dLon: number; cosL: number; wetNear: boolean;
}

export class TreeField {
  private readonly live = new Map<string, CellRec>();
  private readonly queue: PendingCell[] = [];
  private readonly queued = new Set<string>();
  /** treeKey -> /core index, for trees STANDING or HARVESTED. A full tree is
   *  dropped when its cell streams out (see `forget`). */
  private readonly known = new Map<string, Known>();
  /** treeKey -> saved remaining, restored but not yet materialised. */
  private readonly pending = new Map<string, number>();
  /** The spawn clearing's own trees as UNIT DIRECTIONS, snapshotted at reset.
   *  14 and fixed. Directions and not positions, see `buildTree`. */
  private clearing: { x: number; y: number; z: number }[] = [];
  private lastScan: { x: number; y: number; z: number } | null = null;

  // Counters. Cumulative unless noted; the delivery pair is over the live ring.
  offeredCells = 0;
  biomeZeroCells = 0;
  /** Cells the TREELINE emptied. The reachable refusing case of this pass and
   *  the one WG-61 had to invent a Mountains density to make reachable at all:
   *  the current spawn is at 4,668 m, far above TREELINE_BARE_M. */
  treelineCells = 0;
  refusedSlope = 0;
  wetCells = 0;
  refusedWater = 0;
  refusedClearing = 0;
  cellsCapped = 0;
  drainedOnRestore = 0;
  forgotten = 0;
  scans = 0;
  lastScanMs = 0;
  private wantedE = 0;
  private placedN = 0;

  constructor(
    private readonly M: OfCoreModule,
    private readonly game: GameCore,
    private readonly field: NodeField,
    private readonly body: number,
    private readonly seed: number,
    private readonly radiusM: number,
    private readonly densityScale: number,
    private readonly bodyRadiusM: number,
    private readonly water: WaterOracle | null,
    private readonly editsHandle: () => number = () => 0,
  ) {}

  get enabled(): boolean { return this.radiusM > 0; }

  /** Per-frame. Cheap while stationary; a re-scan every half cell moved, and
   *  cell builds amortised over frames (CELL_BUILDS_PER_UPDATE). */
  update(feet: { x: number; y: number; z: number }): void {
    if (!this.enabled) return;
    if (this.queue.length > 0) {
      const t0 = performance.now();
      let n = CELL_BUILDS_PER_UPDATE;
      while (n-- > 0) {
        const c = this.queue.shift();
        if (c === undefined) break;
        this.queued.delete(c.key);
        if (!this.live.has(c.key)) this.buildCell(c);
      }
      this.lastScanMs = performance.now() - t0;
    }
    if (this.lastScan !== null) {
      const dx = feet.x - this.lastScan.x, dy = feet.y - this.lastScan.y,
        dz = feet.z - this.lastScan.z;
      if (dx * dx + dy * dy + dz * dz < RESCAN_MOVE_M * RESCAN_MOVE_M) return;
    }
    this.lastScan = { x: feet.x, y: feet.y, z: feet.z };
    this.scan(feet);
  }

  /** After Gameplay.populate: /core cleared the node array, so every index here
   *  is stale and everything regenerates from seed. The clearing snapshot is
   *  taken HERE, when `field.placed` holds the spiral and none of ours. */
  reset(): void {
    for (const rec of this.live.values())
      for (const idx of rec.placed) this.field.remove(idx);
    this.live.clear();
    this.known.clear();
    this.pending.clear();
    this.queue.length = 0;
    this.queued.clear();
    this.lastScan = null;
    this.wantedE = 0;
    this.placedN = 0;
    // NORMALISED, and the first version was NOT, which is why this gate has a
    // counter. A placed node's `pos` is on the SURFACE (bodyRadius + height); a
    // candidate is a unit direction times bodyRadius. At Forest those differ by
    // 27 m radially before the two are even in the same place, so every test
    // beat a 6 m keep-out and `refusedClearing` read 0 where arithmetic said it
    // must fire. A zero from a gate that cannot fire reads exactly like a zero
    // from a gate with nothing to catch, and only the expected count told them
    // apart (RN-46). It now fires 14 times at a Forest spawn.
    this.clearing = this.field.placed
      .filter((p) => p.kind === NODE_KIND.Tree)
      .map((p) => {
        const l = Math.hypot(p.pos.x, p.pos.y, p.pos.z) || 1;
        return { x: p.pos.x / l, y: p.pos.y / l, z: p.pos.z / l };
      });
  }

  private scan(feet: { x: number; y: number; z: number }): void {
    const R = this.bodyRadiusM;
    const fr = Math.hypot(feet.x, feet.y, feet.z) || 1;
    const fLat = Math.asin(Math.max(-1, Math.min(1, feet.y / fr)));
    const fLon = Math.atan2(feet.z, feet.x);
    const dLat = TREE_CELL_M / R;
    const outer = this.radiusM + TREE_EDGE_WANDER_M;
    const rows = Math.ceil(outer / TREE_CELL_M);
    const iC = Math.floor(fLat / dLat);
    const seen = new Set<string>();
    // The basin gate, once per scan (Scatter.sample's hoist): the per-cell water
    // query only runs when the scanned ring can reach the pond.
    const disc = this.water !== null && this.water.hasWater ? this.water.disc : null;
    let wetNear = false;
    if (disc !== null) {
      const dot = (feet.x * disc.dirX + feet.y * disc.dirY + feet.z * disc.dirZ) / fr;
      const arcM = Math.acos(Math.max(-1, Math.min(1, dot))) * fr;
      wetNear = arcM < disc.basinRadiusM + outer + TREE_CELL_M;
    }
    for (let i = iC - rows; i <= iC + rows; ++i) {
      const latC = (i + 0.5) * dLat;
      const cosL = Math.cos(latC);
      if (cosL <= 0) continue;
      const dLon = dLat / Math.max(0.2, cosL);
      const wrap = Math.max(1, Math.ceil((2 * Math.PI) / dLon));
      const cols = Math.ceil(outer / (R * dLon * cosL)) + 1;
      const jC = Math.floor(fLon / dLon);
      for (let j = jC - cols; j <= jC + cols; ++j) {
        const jw = ((j % wrap) + wrap) % wrap;
        const key = `${i}:${jw}`;
        if (seen.has(key)) continue;
        const lonC = (jw + 0.5) * dLon;
        const cl = Math.cos(latC);
        const cx = cl * Math.cos(lonC), cy = Math.sin(latC), cz = cl * Math.sin(lonC);
        const px = cx * fr, py = cy * fr, pz = cz * fr;
        const ddx = px - feet.x, ddy = py - feet.y, ddz = pz - feet.z;
        // THE RAGGED EDGE. The membership radius is displaced by a smooth
        // world-space field sampled at the CELL, so the boundary is a property
        // of the ground and two players at the same spot see the same margin.
        const rEdge = this.radiusM
          + edgeWander(this.seed, cx * R, cy * R, cz * R) * TREE_EDGE_WANDER_M;
        if (ddx * ddx + ddy * ddy + ddz * ddz > rEdge * rEdge) continue;
        seen.add(key);
        if (!this.live.has(key) && !this.queued.has(key)) {
          this.queued.add(key);
          this.queue.push({ key, i, jw, latC, lonC, dLat, dLon, cosL, wetNear });
        }
      }
    }
    for (const [key, rec] of this.live) {
      if (seen.has(key)) continue;
      for (const idx of rec.placed) this.field.remove(idx);
      this.wantedE -= rec.expected;
      this.placedN -= rec.placed.length;
      this.live.delete(key);
      this.forget(key);
    }
    for (let q = this.queue.length - 1; q >= 0; --q) {
      if (!seen.has(this.queue[q].key)) {
        this.queued.delete(this.queue[q].key);
        this.queue.splice(q, 1);
      }
    }
    this.scans++;
  }

  /**
   * Drop a streamed-out cell's UNTOUCHED trees from `known`.
   *
   * `RockField` keeps every rock it materialised for the session, right at 49
   * rocks over a 5 km walk and NOT right here: a forest ring holds two thousand
   * trees and a kilometre of walking retires most of them, so an unpruned map
   * grows without bound and `serialize` pays a WASM read per entry on every
   * autosave. A full tree carries no diff and regenerates identically, so
   * forgetting it loses nothing; one below full is kept for ever, which is what
   * the save is for. (Owed back to RockField.)
   */
  private forget(cellKey: string): void {
    for (let k = 0; k < MAX_PER_CELL; ++k) {
      const key = `${cellKey}:${k}`;
      const hit = this.known.get(key);
      if (hit === undefined) continue;
      const st = this.game.node(hit.index);
      if (st !== null && st.remaining < st.initial) continue;
      this.known.delete(key);
      this.forgotten++;
    }
  }

  private buildCell(c: PendingCell): void {
    const rec: CellRec = { expected: 0, placed: [] };
    this.live.set(c.key, rec);
    this.offeredCells++;
    const R = this.bodyRadiusM;
    const cl = Math.cos(c.latC);
    const cx = cl * Math.cos(c.lonC), cy = Math.sin(c.latC), cz = cl * Math.sin(c.lonC);
    const biome = this.M._of_biome_at(this.body, cx, cy, cz);
    const density = (TREE_DENSITY_KM2[biome] ?? 0) * this.densityScale;
    if (density <= 0) { this.biomeZeroCells++; return; }
    if (c.wetNear && this.water !== null
      && this.water.depthAt(cx, cy, cz, this.editsHandle()) > TREE_WET_REJECT_M) {
      this.wetCells++;
      return;
    }
    // THE FOREST'S OWN SHAPE, imported and not restated: the stand field makes
    // stands and clearings, the treeline says where wood stops. Both sampled in
    // BODY-FRAME METRES (WG-62), so the same ground gives the same forest.
    const altM = this.M._of_surface_height(this.body, this.editsHandle(), cx, cy, cz);
    const stand = standAt(cx * R, cy * R, cz * R);
    const w = canopyWeight(altM, stand);
    if (w <= 0) { this.treelineCells++; return; }
    const areaKm2 = (R * c.dLat) * (R * c.dLon * c.cosL) / 1e6;
    const e = density * w * areaKm2;
    rec.expected = e;
    this.wantedE += e;
    // Fair quantisation: the fraction is spent as a probability keyed by the
    // cell hash, never by the visit.
    const h0 = treeHash(this.seed, c.i, c.jw, 0x7a11);
    let n = Math.floor(e) + (frac(treeHash(h0, 1, 2, 3)) < e - Math.floor(e) ? 1 : 0);
    if (n > MAX_PER_CELL) { n = MAX_PER_CELL; this.cellsCapped++; }
    for (let k = 0; k < n; ++k) this.buildTree(rec, c, k);
  }

  private buildTree(rec: CellRec, c: PendingCell, k: number): void {
    const hk = treeHash(this.seed, c.i, c.jw, 0x2f83 + k);
    const lat = c.latC + (frac(treeHash(hk, 5, k, 1)) - 0.5) * c.dLat;
    const lon = c.lonC + (frac(treeHash(hk, 7, k, 2)) - 0.5) * c.dLon;
    const cl = Math.cos(lat);
    const dx = cl * Math.cos(lon), dy = Math.sin(lat), dz = cl * Math.sin(lon);
    if (oracleSlopeCos(this.M, this.body, this.editsHandle(), this.bodyRadiusM,
      dx, dy, dz) < TREE_MIN_SLOPE_COS) { this.refusedSlope++; return; }
    if (c.wetNear && this.water !== null
      && this.water.depthAt(dx, dy, dz, this.editsHandle()) > TREE_WET_REJECT_M) {
      this.refusedWater++;
      return;
    }
    // THE CLEARING KEEP-OUT, spawn spiral only, on the CHORD BETWEEN UNIT
    // DIRECTIONS times the body radius: ground distance, and the only
    // comparison that does not accidentally measure altitude (see `reset`).
    if (this.clearing.length > 0) {
      const r = this.bodyRadiusM;
      const keep = (TREE_CLEARING_KEEPOUT_M / r) ** 2;
      for (const q of this.clearing) {
        const ax = dx - q.x, ay = dy - q.y, az = dz - q.z;
        if (ax * ax + ay * ay + az * az < keep) {
          this.refusedClearing++;
          return;
        }
      }
    }
    const index = this.game.addNode(this.body, this.editsHandle(),
      NODE_KIND.Tree, dx, dy, dz);
    if (index < 0) return;
    const treeKey = `${c.key}:${k}`;
    const st = this.game.node(index);
    this.known.set(treeKey, { index, initial: st?.initial ?? 0 });
    const saved = this.pending.get(treeKey);
    if (saved !== undefined && st !== null && st.remaining > saved) {
      this.M._of_gp_node_drain(index, st.remaining - saved);
      this.pending.delete(treeKey);
      this.drainedOnRestore++;
    }
    // SIZE IS YIELD (TreeTuning.treeScaleFor): the scale is /core's own grade,
    // the same number `InitialAmount` is multiplied by, so a tree that looks
    // twice the size holds twice the wood. Nothing here invents a size.
    this.field.addOutcrop(index, treeScaleFor(st?.grade ?? 0.5), 0);
    rec.placed.push(index);
    this.placedN++;
  }

  /** Every /core index this module owns, so Persist can exclude them from its
   *  index-keyed diff (an index is stable only for nodes laid at boot). */
  coreIndices(): Set<number> {
    const out = new Set<number>();
    for (const r of this.known.values()) out.add(r.index);
    return out;
  }

  /** The depletion diff, keyed by cell: [i, jw, k, remaining] per chopped tree.
   *  Trees harvested in an earlier session that never materialised in this one
   *  carry through unchanged, or an autosave would refill every distant tree. */
  serialize(): [number, number, number, number][] {
    const rows: [number, number, number, number][] = [];
    for (const [key, r] of this.known) {
      const st = this.game.node(r.index);
      if (st === null || st.remaining >= st.initial) continue;
      const [i, jw, k] = key.split(':').map(Number);
      rows.push([i, jw, k, st.remaining]);
    }
    for (const [key, r] of this.pending) {
      if (this.known.has(key)) continue;
      const [i, jw, k] = key.split(':').map(Number);
      rows.push([i, jw, k, r]);
    }
    return rows;
  }

  /** Apply a saved diff: now for standing trees, pending for the rest. */
  restore(rows: readonly (readonly number[])[] | undefined): number {
    if (rows === undefined) return 0;
    let applied = 0;
    for (const row of rows) {
      if (row.length < 4) continue;
      const key = `${row[0]}:${row[1]}:${row[2]}`;
      const remaining = row[3];
      const hit = this.known.get(key);
      if (hit === undefined) { this.pending.set(key, remaining); continue; }
      const st = this.game.node(hit.index);
      if (st !== null && st.remaining > remaining) {
        this.M._of_gp_node_drain(hit.index, st.remaining - remaining);
        applied++;
        this.drainedOnRestore++;
      }
    }
    return applied;
  }
  stats(): TreeStats {
    return {
      enabled: this.enabled,
      radiusM: this.radiusM,
      live: this.placedN,
      cells: this.live.size,
      known: this.known.size,
      pending: this.pending.size,
      wanted: Math.round(this.wantedE * 1e4) / 1e4,
      delivered: this.placedN,
      // Placed over expected, both sides over the SAME live cells (RN-15).
      deliveredFraction: this.wantedE > 0
        ? Math.round((this.placedN / this.wantedE) * 1e4) / 1e4 : 0,
      offeredCells: this.offeredCells,
      biomeZeroCells: this.biomeZeroCells,
      treelineCells: this.treelineCells,
      refusedSlope: this.refusedSlope,
      wetCells: this.wetCells,
      refusedWater: this.refusedWater,
      refusedClearing: this.refusedClearing,
      cellsCapped: this.cellsCapped,
      drainedOnRestore: this.drainedOnRestore,
      forgotten: this.forgotten,
      scans: this.scans,
      lastScanMs: Math.round(this.lastScanMs * 100) / 100,
      backlog: this.queue.length,
    };
  }
}
