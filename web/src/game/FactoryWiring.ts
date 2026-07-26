// THE ONE JOB A PLACEMENT LAYER HAS THAT /core CANNOT DO FOR IT: deciding which
// buildings are next to which, and turning that into connect() calls.
//
// Split out of Factory when demolition landed, because it is a genuinely
// separate question. Factory owns the PLAN and its lifecycle; this file answers
// two geometry questions about a plan, both pure:
//
//   which belt tiles form one transport line, and in what order
//   which buildings touch, so an inserter belongs between them
//
// A run is ONE line however many tiles the player laid, which is the whole point
// of the factory_sim section 2 model: the head and the tail are what get wired,
// and the tiles in between are a length, not entities to connect.

import * as THREE from 'three';
import { cellKeyOf } from './Grid.js';
import { FOOTPRINT, type Factory, type Placed } from './Factory.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/**
 * Group belts into contiguous runs by following each tile's flow direction.
 * A tile with no belt behind it starts a run; the walk stops on a cycle, which
 * a player CAN lay by putting four tiles in a square.
 */
export function chainRuns(M: OfCoreModule, placed: readonly Placed[]): Placed[][] {
  const belts = placed.filter((p) => p.kind === 'belt');
  const byCell = new Map<string, Placed>();
  for (const b of belts) byCell.set(b.cell, b);
  const next = new Map<number, Placed>();
  const hasPrev = new Set<number>();
  for (const b of belts) {
    const ahead = byCell.get(cellAhead(M, b));
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
function cellAhead(M: OfCoreModule, b: Placed): string {
  return cellKeyOf(M, b.pos.x + b.fwd.x, b.pos.y + b.fwd.y, b.pos.z + b.fwd.z);
}

/**
 * The wiring itself: one connect() per adjacency, and never a hand-fed slot.
 * A source feeds a run whose TAIL it touches; a run's HEAD feeds a sink it
 * touches; and a source touching a sink directly hands off with no belt.
 *
 * REMOVAL IS WHY THIS IS RECOMPUTED WHOLE. Pulling a tile out of the middle of a
 * run splits it in two, and the halves have different heads and tails than
 * anything that existed before, so there is nothing to patch: the plan is asked
 * again from scratch and the answer is correct by construction.
 */
export function wire(f: Factory): void {
  const touch = (a: Placed, b: Placed): boolean => {
    const reach = (FOOTPRINT[a.kind] + FOOTPRINT[b.kind]) * 0.5 + 0.75;
    return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) <= reach;
  };
  f.links = [];
  const link = (a: Placed, b: Placed, ok: boolean): void => {
    if (!ok) return;
    const fwd = new THREE.Vector3(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
    if (fwd.lengthSq() < 1e-9) return;
    f.links.push({
      pos: { x: (a.pos.x + b.pos.x) * 0.5, y: (a.pos.y + b.pos.y) * 0.5,
             z: (a.pos.z + b.pos.z) * 0.5 },
      up: a.up.clone(), fwd: fwd.normalize(),
    });
  };
  const sources = f.placed.filter((p) => p.kind === 'miner' || p.kind === 'smelter');
  const sinks = f.placed.filter((p) => p.kind === 'smelter');
  f.runs.forEach((run, i) => {
    const build = f.runBuilds[i];
    if (build === undefined || run.length === 0) return;
    for (const s of sources) {
      if (s.build >= 0 && touch(s, run[0])) link(s, run[0], f.line.connect(s.build, build));
    }
    const head = run[run.length - 1];
    for (const k of sinks) {
      if (k.build >= 0 && touch(k, head)) link(head, k, f.line.connect(build, k.build));
    }
  });
  for (const s of sources) {
    for (const k of sinks) {
      if (s !== k && s.build >= 0 && k.build >= 0 && touch(s, k)) {
        link(s, k, f.line.connect(s.build, k.build));
      }
    }
  }
}
