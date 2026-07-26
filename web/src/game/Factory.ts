// THE PLAN, and the one job a placement layer has that /core cannot do for it:
// deciding which buildings are next to which, and turning that into connect()
// calls. Every rule downstream of that is automation.h's.
//
// WHY A REBUILD RATHER THAN AN EDIT. FactorySim is append-only by design: the
// dense entity index IS the render key, so there is no removeEntity and there
// should not be one. A belt run therefore cannot grow a tile in place. So the
// PLAN lives here as plain records, and any topology change re-creates the
// network from it. That is cheap (a handful of entities, only ever on a
// placement) and it makes one property free: the network is always exactly what
// the plan says, so a wiring bug cannot survive one rebuild and hide.
//
// State is carried across a rebuild, not reset: a miner is re-placed with the
// ore it had LEFT, machine inputs are re-fed, and finished output goes to the
// pack. Items physically on a belt are lost, and that count is REPORTED rather
// than swallowed, because a silent loss is how a conservation claim rots.
//
// THE DEPOSIT IS ONE POOL. A miner is seeded from its node's remaining amount,
// and every tick the node is drained by exactly what the miner extracted
// (of_gp_node_drain). Two counters for the same ore is the five-surfaces
// failure in miniature, and it would show as a node standing full for ever
// while its ore rides away on a belt.

import * as THREE from 'three';
import { AutoLine } from './AutoLine.js';
import { cellKeyOf, orient, snapToGround, type Snapped } from './Grid.js';
import type { GameCore } from './GameCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export type BuildKind = 'miner' | 'belt' | 'smelter';

/** TypeIds are ASSET-SPECS section 4's, so the stream keys the right mesh. */
export const TYPE_ID: Record<BuildKind, number> = {
  miner: 0x10, belt: 0x11, smelter: 0x12,
};
/** Footprint in whole metres (ASSET-SPECS), and the interaction bound. */
export const FOOTPRINT: Record<BuildKind, number> = { miner: 2, belt: 1, smelter: 2 };

/** Extraction rate, belt tier and craft time all come from one place. */
// 3 ore a second against a smelter that eats 1: the belt fills, which is both
// the honest Factorio lesson (one smelter is never enough) and the only way the
// flow material has anything to show. A miner that exactly matched its smelter
// would run a permanently empty belt.
const MINER_UNITS_PER_SEC = 3.0;
const BELT_SPEED_UNITS_PER_TICK = 8;      // tier 1: 1.875 m/s (ASSET-SPECS 4.12)
const SMELT_TICKS = 60;                    // the survival smelter's own rate
/** How far from a miner a harvest node may be and still be its deposit. */
const MINER_BIND_M = 3.2;

export interface Placed {
  id: number;
  kind: BuildKind;
  /** Body-frame metres, snapped to the 1 m lattice and put on the ground. */
  pos: { x: number; y: number; z: number };
  cell: string;
  up: THREE.Vector3;
  /** Flow direction, in the tangent plane. Belts flow along it. */
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Miner only: the harvest node it eats, and the ore it had last tick. */
  nodeIndex: number;
  lastRemaining: number;
  /** Filled by commit(): the /core build index, and the stream entity id. */
  build: number;
  entity: number;
  /** Belt only: which run it joined, so the flow row can find its tiles. */
  run: number;
}

export class Factory {
  readonly line: AutoLine;
  readonly placed: Placed[] = [];
  /** Belt runs, tail first, as they were committed. Index === run field. */
  runs: Placed[][] = [];
  /** Per-run /core build index, parallel to `runs`. */
  runBuilds: number[] = [];
  /**
   * Where connect() actually wired something, so an inserter can be drawn there
   * (DW-9: the player never places one, but a connection has to be legible).
   */
  links: { pos: { x: number; y: number; z: number };
           up: THREE.Vector3; fwd: THREE.Vector3 }[] = [];
  private nextId = 1;
  /** Ore drained out of world nodes by miners. The conservation counter. */
  minedFromNodes = 0;
  /** Ingots collected by hand into the pack, and what would not fit. */
  collected = 0;
  spilled = 0;

  constructor(private readonly M: OfCoreModule, private readonly core: GameCore,
              private readonly bodyHandle: number, fixedDt: number) {
    this.line = new AutoLine(M, fixedDt);
  }

  /** Snap a body-frame point to the 1 m lattice and put it on the ground. */
  snap(x: number, y: number, z: number): Snapped {
    return snapToGround(this.M, this.bodyHandle, x, y, z);
  }

  /** Is this cell already taken? Placement refuses to stack. */
  occupied(cell: string): boolean {
    return this.placed.some((p) => p.cell === cell);
  }

  /**
   * The nearest ore node within binding range of `pos`, or -1. A miner without
   * one is refused: "it eats the ground" is the whole idea of the machine, and
   * a miner standing on nothing would need a deposit invented for it here.
   */
  nodeUnder(pos: { x: number; y: number; z: number }): number {
    let best = -1;
    let bestD = MINER_BIND_M;
    for (let i = 0; i < this.core.nodeCount; ++i) {
      const n = this.core.node(i);
      if (n === null || n.remaining <= 0) continue;
      // Trees are not a deposit. Rock, coal, iron and copper are.
      if (n.kind === 0) continue;
      const d = Math.hypot(n.x - pos.x, n.y - pos.y, n.z - pos.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Add one building to the PLAN and re-commit. Returns it, or null. */
  add(kind: BuildKind, s: Snapped, fwd: THREE.Vector3): Placed | null {
    if (this.occupied(s.cell)) return null;
    let nodeIndex = -1;
    if (kind === 'miner') {
      nodeIndex = this.nodeUnder(s.pos);
      if (nodeIndex < 0) return null;
      if (this.placed.some((p) => p.nodeIndex === nodeIndex)) return null;
    }
    const p: Placed = {
      id: this.nextId++, kind, pos: s.pos, cell: s.cell, up: s.up.clone(),
      fwd: fwd.clone(), quat: orient(s.up, fwd), nodeIndex, lastRemaining: 0,
      build: -1, entity: -1, run: -1,
    };
    this.placed.push(p);
    this.commit();
    return p;
  }

  /**
   * Rebuild the /core network from the plan.
   *
   * Order matters exactly once: belts are grouped into RUNS first, because a run
   * is ONE transport line however many tiles the player laid, which is the whole
   * point of the section 2 model. Then sources and sinks are wired to the runs'
   * ends: a run's FIRST tile is its tail (where items enter) and its LAST tile
   * is its head (where they leave), matching addInserter's direction.
   */
  commit(): void {
    const carry = this.placed.map((p) => ({
      remaining: p.build < 0 ? 0 : this.line.minerRemaining(p.build),
      input: p.build < 0 || p.kind === 'belt' ? 0 : this.line.inputBuffer(p.build),
    }));
    // Empty every output into the pack BEFORE the network goes away: those are
    // finished ingots, and a rebuild is not allowed to eat them.
    for (const p of this.placed) if (p.kind === 'smelter' && p.build >= 0) this.collect(p);
    let inFlight = 0;
    for (const b of this.runBuilds) inFlight += this.line.beltItems(b);
    this.line.recreate(inFlight);

    this.runs = this.chainRuns();
    this.runBuilds = this.runs.map((r) =>
      this.line.placeBelt(r.length, BELT_SPEED_UNITS_PER_TICK));
    this.runs.forEach((r, i) => r.forEach((t) => { t.run = i; }));

    const ids = this.core.ids;
    this.placed.forEach((p, i) => {
      if (p.kind === 'miner') {
        const node = this.core.node(p.nodeIndex);
        // The deposit is the NODE's remaining ore on the first build, and the
        // miner's own remaining on every rebuild after it, so re-laying a belt
        // does not refill the mountain.
        const amount = carry[i].remaining > 0 ? carry[i].remaining
          : Math.floor(node?.remaining ?? 0);
        p.build = this.line.placeMinerForNode(
          node?.kind ?? 3, amount, MINER_UNITS_PER_SEC);
        p.lastRemaining = this.line.minerRemaining(p.build);
      } else if (p.kind === 'smelter') {
        // The ORE the smelter takes is whatever a miner in this plan produces,
        // and what it becomes is gameplay.h's smeltOutputFor, never a JS table.
        const ore = this.oreFedTo(p) || ids.rawIron;
        const ingot = this.M._of_gp_smelt_output_for(ore) || ids.iron;
        p.build = this.line.placeSmelter(ore, ingot, SMELT_TICKS);
        if (carry[i].input > 0) this.line.feed(p.build, carry[i].input);
      } else {
        p.build = this.runBuilds[p.run] ?? -1;
      }
      p.entity = p.build < 0 ? -1 : this.line.entityIndex(p.build);
    });

    this.stampPlacements();
    this.wire();
  }

  /** Group belts into contiguous runs by following each tile's flow direction. */
  private chainRuns(): Placed[][] {
    const belts = this.placed.filter((p) => p.kind === 'belt');
    const byCell = new Map<string, Placed>();
    for (const b of belts) byCell.set(b.cell, b);
    const next = new Map<number, Placed>();
    const hasPrev = new Set<number>();
    for (const b of belts) {
      const ahead = byCell.get(this.cellAhead(b));
      if (ahead === undefined || ahead === b) continue;
      next.set(b.id, ahead);
      hasPrev.add(ahead.id);
    }
    const out: Placed[][] = [];
    for (const b of belts) {
      if (hasPrev.has(b.id)) continue;
      const run: Placed[] = [];
      const seen = new Set<number>();
      let cur: Placed | undefined = b;
      while (cur !== undefined && !seen.has(cur.id)) {
        seen.add(cur.id);
        run.push(cur);
        cur = next.get(cur.id);
      }
      out.push(run);
    }
    return out;
  }

  /** The lattice cell one metre along a tile's flow direction. */
  private cellAhead(b: Placed): string {
    return cellKeyOf(this.M, b.pos.x + b.fwd.x, b.pos.y + b.fwd.y, b.pos.z + b.fwd.z);
  }

  /** What ore reaches this smelter: the kind of the nearest miner's node. */
  private oreFedTo(s: Placed): number {
    let best = 0;
    let bestD = Infinity;
    for (const p of this.placed) {
      if (p.kind !== 'miner') continue;
      const n = this.core.node(p.nodeIndex);
      if (n === null) continue;
      const d = Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y, p.pos.z - s.pos.z);
      if (d < bestD) { bestD = d; best = n.resource; }
    }
    return best;
  }

  private stampPlacements(): void {
    for (const p of this.placed) {
      if (p.build < 0) continue;
      // The stream carries LOCAL metres about the plan's first building, not
      // planet-scale absolutes: the field is float32 (standing rule 6).
      const a = this.anchor();
      this.line.setPlacement(p.build, TYPE_ID[p.kind],
        p.pos.x - a.x, p.pos.y - a.y, p.pos.z - a.z,
        Math.round(FOOTPRINT[p.kind] * 70));
    }
  }

  anchor(): { x: number; y: number; z: number } {
    return this.placed.length > 0 ? this.placed[0].pos : { x: 0, y: 0, z: 0 };
  }

  /**
   * The wiring itself: one connect() per adjacency, and never a hand-fed slot.
   * A source feeds a run whose TAIL it touches; a run's HEAD feeds a sink it
   * touches; and a source touching a sink directly hands off with no belt.
   */
  private wire(): void {
    const touch = (a: Placed, b: Placed): boolean => {
      const reach = (FOOTPRINT[a.kind] + FOOTPRINT[b.kind]) * 0.5 + 0.75;
      return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) <= reach;
    };
    this.links = [];
    const link = (a: Placed, b: Placed, ok: boolean): void => {
      if (!ok) return;
      const fwd = new THREE.Vector3(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
      if (fwd.lengthSq() < 1e-9) return;
      this.links.push({
        pos: { x: (a.pos.x + b.pos.x) * 0.5, y: (a.pos.y + b.pos.y) * 0.5,
               z: (a.pos.z + b.pos.z) * 0.5 },
        up: a.up.clone(), fwd: fwd.normalize(),
      });
    };
    const sources = this.placed.filter((p) => p.kind === 'miner' || p.kind === 'smelter');
    const sinks = this.placed.filter((p) => p.kind === 'smelter');
    this.runs.forEach((run, i) => {
      const build = this.runBuilds[i];
      if (build === undefined || run.length === 0) return;
      for (const s of sources) {
        if (s.build >= 0 && touch(s, run[0])) link(s, run[0], this.line.connect(s.build, build));
      }
      const head = run[run.length - 1];
      for (const k of sinks) {
        if (k.build >= 0 && touch(k, head)) link(head, k, this.line.connect(build, k.build));
      }
    });
    for (const s of sources) {
      for (const k of sinks) {
        if (s !== k && s.build >= 0 && k.build >= 0 && touch(s, k)) {
          link(s, k, this.line.connect(s.build, k.build));
        }
      }
    }
  }

  /**
   * Advance the network and keep the world nodes honest.
   *
   * The drain is the delta of the MINER's own remaining, so the node loses
   * exactly what the sim extracted, no more and no less, whatever the rate is.
   */
  tick(ticks: number): void {
    this.line.step(ticks);
    for (const p of this.placed) {
      if (p.kind !== 'miner' || p.build < 0) continue;
      const now = this.line.minerRemaining(p.build);
      const took = p.lastRemaining - now;
      if (took > 0) {
        this.minedFromNodes += this.M._of_gp_node_drain(p.nodeIndex, took);
        p.lastRemaining = now;
      }
    }
  }

  /** Empty a building's output buffer into the pack. Returns what moved. */
  collect(p: Placed): number {
    if (p.build < 0) return 0;
    const have = this.line.outputBuffer(p.build);
    if (have <= 0) return 0;
    const took = this.line.takeOutput(p.build, have);
    if (took <= 0) return 0;
    const item = this.outputItemOf(p);
    const over = item > 0 ? this.core.add(item, took) : took;
    this.collected += took - over;
    this.spilled += over;
    return took - over;
  }

  outputItemOf(p: Placed): number {
    if (p.kind === 'smelter') {
      return this.M._of_gp_smelt_output_for(this.oreFedTo(p) || this.core.ids.rawIron)
        || this.core.ids.iron;
    }
    const n = p.nodeIndex >= 0 ? this.core.node(p.nodeIndex) : null;
    return n?.resource ?? 0;
  }

  /** Nearest building the aim ray enters, within `reachM`. */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number): Placed | null {
    let best: Placed | null = null;
    let bestT = reachM;
    for (const p of this.placed) {
      // Belts are not interactive: there is nothing to take out of one, and a
      // 1 m tile under the crosshair otherwise steals the prompt from the
      // machine behind it every time the player looks down the line.
      if (p.kind === 'belt') continue;
      const r = FOOTPRINT[p.kind] * 0.6 + 0.4;
      const ox = p.pos.x + p.up.x * 0.7 - eye.x;
      const oy = p.pos.y + p.up.y * 0.7 - eye.y;
      const oz = p.pos.z + p.up.z * 0.7 - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -r || t > bestT) continue;
      if (Math.hypot(ox - dir.x * t, oy - dir.y * t, oz - dir.z * t) > r) continue;
      best = p; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown {
    return {
      buildings: this.placed.length,
      runs: this.runs.map((r, i) => ({
        tiles: r.length, items: this.line.beltItems(this.runBuilds[i] ?? -1),
      })),
      ticks: this.line.ticks,
      coreTicks: this.line.coreTicks,
      rebuilds: this.line.rebuilds,
      itemsLostToRebuild: this.line.itemsLostToRebuild,
      minedFromNodes: this.minedFromNodes,
      collected: this.collected,
      spilled: this.spilled,
      list: this.placed.map((p) => {
        const live = p.build >= 0;
        const machine = live && p.kind !== 'belt';
        return {
          id: p.id, kind: p.kind, build: p.build, entity: p.entity, run: p.run,
          node: p.nodeIndex, outputItem: this.outputItemOf(p),
          remaining: p.kind === 'miner' && live ? this.line.minerRemaining(p.build) : null,
          input: p.kind === 'smelter' && live ? this.line.inputBuffer(p.build) : null,
          output: machine ? this.line.outputBuffer(p.build) : null,
          working: live ? this.line.working(p.build) : false,
        };
      }),
      flows: this.line.beltFlows(),
    };
  }
}
