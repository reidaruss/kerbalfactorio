// The rocks of the world, as real harvestable objects (WG-67 to WG-70).
//
// Reid: "The rocks should be actual object, that if i destroy they give me
// stone." Admin's ruling makes it structural: THERE ARE NO INERT ROCKS. This
// module streams stone harvest nodes in around the player wherever the planet
// says a rock stands; the decor rocks that lied are retired in Registry.ts
// against RockTuning.DECOR_ROCK_MAX_H.
//
// A rock is an attribute of the PLANET, not of the visit: existence, position
// and size are pure functions of (seed, lattice cell), so the same ground
// grows the same rocks on every approach, at any LOD, in any session. That
// purity is also the persistence key: a harvested rock is saved as (cell,
// remaining) rather than as an array index, because the /core node array is
// filled in visit order, which a walk does not reproduce.
//
// The lattice is rows of latitude cut into near-square cells (longitude step
// widened by 1/cos(lat); the clamp engages only past 78 degrees, above every
// survey site). Sim state lives in /core exactly as a tree's does: the same
// of_gp_node_add / harvest / drain calls. This module owns only which cells
// are streamed in and how the depletion diff is keyed.

import { NODE_KIND, type GameCore } from './GameCore.js';
import type { NodeField } from './NodeField.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { WaterOracle } from '../world/WaterOracle.js';
import {
  MAX_PER_CELL, ROCK_CELL_M, ROCK_CLUSTER_C, ROCK_DENSITY_KM2,
  ROCK_MIN_SLOPE_COS, ROCK_RADIUS_M, ROCK_SCALE_MAX, ROCK_SCALE_MIN,
  ROCK_SINK_FRAC, ROCK_WET_REJECT_M, SLOPE_ARM_M, frac, rockClusterW, rockHash,
} from './RockTuning.js';

/** Re-scan when the feet move this far: half a cell, so the ring's edge error
 *  stays under one cell and a stationary player costs zero scans. */
const RESCAN_MOVE_M = ROCK_CELL_M / 2;

/** One streamed-in cell's accounting: the delivery ratio is over the CURRENT
 *  ring, so streaming out subtracts what streaming in added. */
interface CellRec {
  expected: number;
  placed: number[];   // /core node indices presented from this cell
}

/** A rock this session materialised, kept after it streams out: its /core
 *  node entry (and so its depletion) lives for the whole session. */
interface Known {
  index: number;
  initial: number;
}

/** Cells built per update. A cell BUILD enters WASM, and building a whole
 *  154-cell ring in one frame measured 0.8 to 3.3 ms: a hitch every 12 m of
 *  sprint. 24 cells is ~0.5 ms worst and fills a teleported ring in 7 frames;
 *  `backlog` in stats reports the queue so this can never quietly become a
 *  ring that never catches up (the scatter's BUILDS_PER_UPDATE argument). */
const CELL_BUILDS_PER_UPDATE = 24;

interface PendingCell {
  key: string; i: number; jw: number; latC: number; lonC: number;
  dLat: number; dLon: number; cosL: number; wetNear: boolean;
}

export class RockField {
  /** cellKey -> live accounting for cells inside the ring right now. */
  private readonly live = new Map<string, CellRec>();
  /** Cells inside the ring not yet built, drained on a per-update budget. */
  private readonly queue: PendingCell[] = [];
  private readonly queued = new Set<string>();
  /** rockKey -> /core index, for every rock ever materialised this session. */
  private readonly known = new Map<string, Known>();
  /** rockKey -> saved remaining, restored but not yet materialised. */
  private readonly pending = new Map<string, number>();
  private lastScan: { x: number; y: number; z: number } | null = null;

  // Counters. Cumulative unless noted; the delivery pair is over the live ring.
  offeredCells = 0;
  biomeZeroCells = 0;
  refusedSlope = 0;
  /** Cells refused whole for standing water, the scatter's granularity
   *  (WET_REJECT_M). CELLS, not rocks: the pond's disc holds 0.24 EXPECTED
   *  rocks, so a per-rock counter reads 0 on almost every seed and a zero
   *  that cannot fire is not a gate (the treeline lesson). The cell counter
   *  fires on every pond visit; probes/rocks.js asserts it at the spawn. */
  wetCells = 0;
  refusedWater = 0;
  drainedOnRestore = 0;
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
    private readonly enabled: boolean,
    private readonly densityScale: number,
    private readonly bodyRadiusM: number,
    /** The water authority, or null on a dry body (same seam as Scatter). */
    private readonly water: WaterOracle | null,
    /** Live edits handle: a rock streaming in over a dug pit seats on the
     *  EDITED surface, because of_gp_node_add snaps through the oracle. */
    private readonly editsHandle: () => number = () => 0,
  ) {}

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
        if (!this.live.has(c.key)) this.buildCell(c.key, c.i, c.jw, c.latC,
          c.lonC, c.dLat, c.dLon, c.cosL, c.wetNear);
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

  /** After Gameplay.populate: /core cleared the node array, so every index this
   *  module holds is stale. Everything regenerates from seed on the next update. */
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
  }

  private scan(feet: { x: number; y: number; z: number }): void {
    const R = this.bodyRadiusM;
    const fr = Math.hypot(feet.x, feet.y, feet.z) || 1;
    const fLat = Math.asin(Math.max(-1, Math.min(1, feet.y / fr)));
    const fLon = Math.atan2(feet.z, feet.x);
    const dLat = ROCK_CELL_M / R;
    const rows = Math.ceil(ROCK_RADIUS_M / ROCK_CELL_M);
    const iC = Math.floor(fLat / dLat);
    const seen = new Set<string>();
    // The basin gate, once per scan (the same hoist Scatter.sample does): the
    // per-rock water query only runs when the scanned ring can reach the pond.
    const disc = this.water !== null && this.water.hasWater ? this.water.disc : null;
    let wetNear = false;
    if (disc !== null) {
      const dot = (feet.x * disc.dirX + feet.y * disc.dirY + feet.z * disc.dirZ) / fr;
      const arcM = Math.acos(Math.max(-1, Math.min(1, dot))) * fr;
      wetNear = arcM < disc.basinRadiusM + ROCK_RADIUS_M + ROCK_CELL_M;
    }
    for (let i = iC - rows; i <= iC + rows; ++i) {
      const latC = (i + 0.5) * dLat;
      const cosL = Math.cos(latC);
      if (cosL <= 0) continue;
      // Longitude step widened so the cell stays ~ROCK_CELL_M wide; the clamp
      // engages only beyond 78 degrees of latitude.
      const dLon = dLat / Math.max(0.2, cosL);
      const wrap = Math.max(1, Math.ceil((2 * Math.PI) / dLon));
      const cols = Math.ceil(ROCK_RADIUS_M / (R * dLon * cosL)) + 1;
      const jC = Math.floor(fLon / dLon);
      for (let j = jC - cols; j <= jC + cols; ++j) {
        const jw = ((j % wrap) + wrap) % wrap;
        const key = `${i}:${jw}`;
        if (seen.has(key)) continue;
        // Chord distance of the cell centre to the feet decides membership, so
        // the ring is round rather than square.
        const lonC = (jw + 0.5) * dLon;
        const cx = Math.cos(latC) * Math.cos(lonC);
        const cy = Math.sin(latC);
        const cz = Math.cos(latC) * Math.sin(lonC);
        const px = cx * fr, py = cy * fr, pz = cz * fr;
        const ddx = px - feet.x, ddy = py - feet.y, ddz = pz - feet.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz > ROCK_RADIUS_M * ROCK_RADIUS_M) continue;
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
    }
    // Queued cells that left the ring before being built are dropped, or a
    // sprint would build a trail of cells behind the player for ever.
    for (let q = this.queue.length - 1; q >= 0; --q) {
      if (!seen.has(this.queue[q].key)) {
        this.queued.delete(this.queue[q].key);
        this.queue.splice(q, 1);
      }
    }
    this.scans++;
  }

  private buildCell(key: string, i: number, jw: number, latC: number,
                    lonC: number, dLat: number, dLon: number, cosL: number,
                    wetNear: boolean): void {
    const rec: CellRec = { expected: 0, placed: [] };
    this.live.set(key, rec);
    this.offeredCells++;
    const R = this.bodyRadiusM;
    const cx = Math.cos(latC) * Math.cos(lonC);
    const cy = Math.sin(latC);
    const cz = Math.cos(latC) * Math.sin(lonC);
    const biome = this.M._of_biome_at(this.body, cx, cy, cz);
    const density = (ROCK_DENSITY_KM2[biome] ?? 0) * this.densityScale;
    if (density <= 0) { this.biomeZeroCells++; return; }
    // THE WATER GATE, cell-whole (see wetCells): a wet cell contributes no
    // expectation either, so the delivery ratio stays over deliverable ground.
    if (wetNear && this.water !== null
      && this.water.depthAt(cx, cy, cz, this.editsHandle()) > ROCK_WET_REJECT_M) {
      this.wetCells++;
      return;
    }
    const areaKm2 = (R * dLat) * (R * dLon * cosL) / 1e6;
    const cluster = rockClusterW(this.seed, cx * R, cy * R, cz * R,
      ROCK_CLUSTER_C[biome] ?? 0);
    const e = density * cluster * areaKm2;
    rec.expected = e;
    this.wantedE += e;
    // Fair quantisation, per cell and deterministic: the fraction is spent as a
    // probability keyed by the cell hash, never by the visit (the `Math.round`
    // version of this is the defect that scattered nothing at RN-15's LOD).
    const h0 = rockHash(this.seed, i, jw, 0x520c);
    let n = Math.floor(e) + (frac(rockHash(h0, 1, 2, 3)) < e - Math.floor(e) ? 1 : 0);
    if (n > MAX_PER_CELL) n = MAX_PER_CELL;
    for (let k = 0; k < n; ++k) this.buildRock(rec, key, k, i, jw, latC, lonC,
      dLat, dLon, wetNear, biome);
  }

  private buildRock(rec: CellRec, cellKey: string, k: number, i: number,
                    jw: number, latC: number, lonC: number, dLat: number,
                    dLon: number, wetNear: boolean, biome: number): void {
    const hk = rockHash(this.seed, i, jw, 0x9d2c + k);
    const lat = latC + (frac(rockHash(hk, 5, k, 1)) - 0.5) * dLat;
    const lon = lonC + (frac(rockHash(hk, 7, k, 2)) - 0.5) * dLon;
    const cl = Math.cos(lat);
    const dx = cl * Math.cos(lon), dy = Math.sin(lat), dz = cl * Math.sin(lon);
    // THE SLOPE GATE, from the oracle itself over the rock's own footprint.
    // WG-63 measured both scatter slope gates refusing zero cells at all seven
    // survey sites, so the counter is the point: whichever way it reads, the
    // next reader inherits a measurement instead of this comment.
    if (this.slopeCos(dx, dy, dz) < ROCK_MIN_SLOPE_COS) {
      this.refusedSlope++;
      return;
    }
    // THE WATER GATE, the reachable refusing case of this pass: the pond at
    // the current Mountains spawn refuses rocks on its bed, measured by
    // probes/rocks.js. A filter is proved by the case it catches (RN-46).
    if (wetNear && this.water !== null
      && this.water.depthAt(dx, dy, dz, this.editsHandle()) > ROCK_WET_REJECT_M) {
      this.refusedWater++;
      return;
    }
    const index = this.game.addNode(this.body, this.editsHandle(),
      NODE_KIND.Rock, dx, dy, dz);
    if (index < 0) return;
    const rockKey = `${cellKey}:${k}`;
    const st = this.game.node(index);
    this.known.set(rockKey, { index, initial: st?.initial ?? 0 });
    // A rock harvested in a saved session comes back harvested, through the
    // one call that can deplete a node, at the moment it materialises.
    const saved = this.pending.get(rockKey);
    if (saved !== undefined && st !== null && st.remaining > saved) {
      this.M._of_gp_node_drain(index, st.remaining - saved);
      this.pending.delete(rockKey);
      this.drainedOnRestore++;
    }
    const scale = ROCK_SCALE_MIN
      + frac(rockHash(hk, 11, k, 3)) * (ROCK_SCALE_MAX - ROCK_SCALE_MIN);
    // THE BIOME IS CARRIED INTO THE ART (WG-94). The cell already knows it (it
    // is what set the density), and it is what lets one Rock kind wear two
    // forms: a Mountains rock may be a frost-shattered spire, a beach rock may
    // not. Passing it here rather than re-querying keeps the art a pure function
    // of the same (seed, cell) the position is, so a spire is as deterministic
    // as the rock it replaces and the round-trip test still holds bit-exactly.
    this.field.addOutcrop(index, scale, ROCK_SINK_FRAC * scale, biome);
    rec.placed.push(index);
    this.placedN++;
  }

  /** cos of the ground's angle to the local up, finite-differenced from the
   *  oracle over SLOPE_ARM_M, which is about the boulder's own footprint. */
  private slopeCos(dx: number, dy: number, dz: number): number {
    const M = this.M, b = this.body, e = this.editsHandle();
    const R = this.bodyRadiusM;
    const arm = SLOPE_ARM_M / R;
    // Tangent basis at dir.
    let tx = 0, ty = 1, tz = 0;
    if (Math.abs(dy) > 0.99) { tx = 1; ty = 0; }
    let ux = ty * dz - tz * dy, uy = tz * dx - tx * dz, uz = tx * dy - ty * dx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const h = (ax: number, ay: number, az: number): number => {
      const l = Math.hypot(ax, ay, az) || 1;
      return M._of_surface_height(b, e, ax / l, ay / l, az / l);
    };
    const h0 = h(dx, dy, dz);
    const gu = (h(dx + ux * arm, dy + uy * arm, dz + uz * arm) - h0) / SLOPE_ARM_M;
    const gv = (h(dx + vx * arm, dy + vy * arm, dz + vz * arm) - h0) / SLOPE_ARM_M;
    return 1 / Math.sqrt(1 + gu * gu + gv * gv);
  }

  /** Every /core index this module owns, so Persist can exclude them from the
   *  index-keyed tree diff (an index is only stable for nodes laid at boot). */
  coreIndices(): Set<number> {
    const out = new Set<number>();
    for (const r of this.known.values()) out.add(r.index);
    return out;
  }

  /**
   * The depletion diff, keyed by cell: [i, jw, k, remaining] per touched rock.
   * Rocks materialised this session are read LIVE off /core (the node entry
   * outlives its presentation); rocks harvested in an earlier session that
   * never materialised in this one carry through unchanged, or an autosave
   * would silently refill every rock more than a ring from the player.
   */
  serialize(): [number, number, number, number][] {
    const rows: [number, number, number, number][] = [];
    for (const [key, r] of this.known) {
      const st = this.game.node(r.index);
      if (st === null || st.remaining >= st.initial) continue;
      const [i, jw, k] = key.split(':').map(Number);
      rows.push([i, jw, k, st.remaining]);
    }
    for (const [key, remaining] of this.pending) {
      if (this.known.has(key)) continue;
      const [i, jw, k] = key.split(':').map(Number);
      rows.push([i, jw, k, remaining]);
    }
    return rows;
  }

  /** Apply a saved diff: immediate for rocks already standing, pending for the
   *  rest. Returns how many were drained right now. */
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

  stats(): {
    enabled: boolean; live: number; cells: number; known: number;
    pending: number; wanted: number; delivered: number;
    deliveredFraction: number; offeredCells: number; biomeZeroCells: number;
    refusedSlope: number; wetCells: number; refusedWater: number;
    drainedOnRestore: number; scans: number; lastScanMs: number;
    backlog: number;
  } {
    return {
      enabled: this.enabled,
      live: this.placedN,
      cells: this.live.size,
      known: this.known.size,
      pending: this.pending.size,
      wanted: Math.round(this.wantedE * 1e4) / 1e4,
      delivered: this.placedN,
      // Placed over expected, both sides over the SAME live cells (RN-15:
      // one tier, one denominator); refusals counted beside it.
      deliveredFraction: this.wantedE > 0
        ? Math.round((this.placedN / this.wantedE) * 1e4) / 1e4 : 0,
      offeredCells: this.offeredCells,
      biomeZeroCells: this.biomeZeroCells,
      refusedSlope: this.refusedSlope,
      wetCells: this.wetCells,
      refusedWater: this.refusedWater,
      drainedOnRestore: this.drainedOnRestore,
      scans: this.scans,
      lastScanMs: Math.round(this.lastScanMs * 100) / 100,
      backlog: this.queue.length,
    };
  }
}
