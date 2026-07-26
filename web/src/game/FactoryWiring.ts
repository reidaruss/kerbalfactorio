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
import { FOOTPRINT, type Factory, type Placed } from './Factory.js';

/**
 * How far apart two tiles of one run can be, and how well aligned with the flow.
 *
 * A LATTICE STEP IS NOT A METRE, and that is the whole reason this is a distance
 * test and not a cell-key test. The grid is a 1 m body-frame cube lattice and the
 * ground sphere cuts through it obliquely, so the ground distance between two
 * cells whose keys differ by one is whatever the local geometry says: measured on
 * Forge at the spawn, one body axis steps 0.59 m of ground, another 0.81 m and
 * the third 1.02 m, and a straight run walks a staircase of all three. Asking for
 * "the cell one metre along the flow" therefore overshoots its own neighbour on
 * two axes out of three, the chain breaks, and /core correctly reports two or
 * three transport lines where the player laid one. Nothing about that is visible:
 * the tiles look like a straight line and the ore simply never arrives.
 *
 * The alignment gate is what keeps a DIAGONAL out. A diagonal neighbour can be
 * closer than a face neighbour here (0.59 and 0.81 make a 1.00 m diagonal), so
 * distance alone cannot separate them; 45 degrees off the flow scores 0.707,
 * comfortably under the gate.
 */
const CHAIN_MAX_M = 1.35;
const CHAIN_ALIGN = 0.85;

/**
 * Group belts into contiguous runs by following each tile's flow direction.
 * A tile with no belt behind it starts a run; the walk stops on a cycle, which
 * a player CAN lay by putting four tiles in a square.
 */
export function chainRuns(placed: readonly Placed[]): Placed[][] {
  const belts = placed.filter((p) => p.kind === 'belt');
  const next = new Map<number, Placed>();
  const hasPrev = new Set<number>();
  for (const b of belts) {
    const ahead = aheadOf(b, belts);
    if (ahead === undefined || ahead === b || hasPrev.has(ahead.id)) continue;
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

/** The nearest belt tile AHEAD of `b` along its own flow, or undefined. */
function aheadOf(b: Placed, belts: readonly Placed[]): Placed | undefined {
  let best: Placed | undefined;
  let bestD = Infinity;
  for (const o of belts) {
    if (o === b) continue;
    const dx = o.pos.x - b.pos.x, dy = o.pos.y - b.pos.y, dz = o.pos.z - b.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6 || d > CHAIN_MAX_M || d >= bestD) continue;
    if ((dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z) / d < CHAIN_ALIGN) continue;
    bestD = d; best = o;
  }
  return best;
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
