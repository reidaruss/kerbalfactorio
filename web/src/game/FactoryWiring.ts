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

/** The least a chain test needs of a tile. Structural, so the build ghost can
 *  be asked the same question a placed tile is. */
interface Tile { pos: { x: number; y: number; z: number }; fwd: THREE.Vector3 }

/** The nearest belt tile AHEAD of `b` along its own flow, or undefined. */
function aheadOf<T extends Tile>(b: T, belts: readonly T[]): T | undefined {
  let best: T | undefined;
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
 * FS-18: would an existing run chain INTO a tile put at `pos`, and so decide
 * its heading for it?
 *
 * CORNERS ARE PURELY GEOMETRIC in this game, and that is the design rather than
 * an oversight: `FactoryCommit.pitchRuns` re-derives every tile's heading from
 * the run's own positions on every commit, which is what makes a dragged run
 * chained BY CONSTRUCTION and what the belt-curve renderer reads to decide which
 * tiles are corners. The consequence is that a tile with a PREDECESSOR has no
 * heading of its own to set: it borrows the one coming into it, and the R key,
 * which turns the ghost through four quarters perfectly well, is overwritten the
 * instant the tile lands. Measured: a tile placed at rotation 1 beside an
 * existing run's head came back with `fwd` identical to its neighbours, and its
 * predecessor's `fwd` was retroactively rewritten too.
 *
 * The behaviour stays. Advertising a key that does nothing does not: this is
 * what the ghost reads to say so BEFORE the button is pressed, which is the same
 * rule the refusals already follow.
 *
 * It is `aheadOf` asked of the neighbours, not a re-implementation of it, so the
 * ghost cannot answer a different question from the one the commit will ask.
 * Only tiles within a chain step of `pos` are candidates, so this is a handful
 * of neighbours times one O(belts) scan and not an O(belts squared) per frame.
 */
export function chainsInto(placed: readonly Placed[],
                           pos: { x: number; y: number; z: number }): boolean {
  const belts = placed.filter((p) => p.kind === 'belt');
  const ghost: Tile = { pos, fwd: new THREE.Vector3() };
  const all: Tile[] = [...belts, ghost];
  for (const b of belts) {
    const d = Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y, b.pos.z - pos.z);
    if (d < 1e-6 || d > CHAIN_MAX_M) continue;
    if (aheadOf<Tile>(b, all) === ghost) return true;
  }
  return false;
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
 *
 * FS-17: A MACHINE IS NEVER WIRED TO THE TAIL OF A RUN WHOSE HEAD ALREADY FEEDS
 * IT, and that one sentence is a deadlock the player could reach in five
 * buildings. A smelter counts as a SOURCE (its ingots can ride a belt away) as
 * well as a SINK, and belt-to-smelter reach is about 2.25 m, so a smelter placed
 * at the end of a SHORT run was within reach of that run's tail as well as its
 * head. It then put its first ingot onto the belt that feeds it. The ingot rode
 * to the head and stuck there for ever, because the head inserter is carrying
 * ore and will not pick up an ingot, and a `TransportLine` accepts exactly one
 * item until its head is popped. Measured on a drill plus FOUR belts plus a
 * smelter: `minerOut` pinned at 13 to 16 while `mined` kept climbing 19 a
 * window, belt items stuck at 1, smelter input 0, output 0, iron 0. Forever.
 *
 * `probes/demolish.js` had been changed to five belts so the short circuit could
 * not form, which was right for that probe and left the defect live. It is back
 * on four belts and asserts the line RUNS.
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
      up: a.up.clone(), fwd: fwd.normalize(), from: a.id, to: b.id,
    });
  };
  const sources = f.placed.filter((p) => p.kind === 'miner' || p.kind === 'smelter');
  const sinks = f.placed.filter((p) => p.kind === 'smelter');
  f.runs.forEach((run, i) => {
    const build = f.runBuilds[i];
    if (build === undefined || run.length === 0) return;
    const head = run[run.length - 1];
    // Decided BEFORE any source is wired, and only used to exclude. Doing the
    // sink links here as well would swap the order the two connect() calls
    // reach /core, which is the order the inserters tick in.
    const fedByHead = sinks.filter((k) => k.build >= 0 && touch(k, head));
    for (const s of sources) {
      if (fedByHead.includes(s)) continue;
      if (s.build >= 0 && touch(s, run[0])) link(s, run[0], f.line.connect(s.build, build));
    }
    for (const k of fedByHead) link(head, k, f.line.connect(build, k.build));
  });
  for (const s of sources) {
    // A SMELTER NEVER HANDS DIRECTLY TO ANOTHER SMELTER. Nothing in the recipe
    // set eats an ingot, so such an inserter can only fill the receiver's ore
    // slot with the wrong item and stall it: the same defect as above without
    // the belt. Two smelters are within `touch` at 2.75 m, which is three cells.
    if (s.kind === 'smelter') continue;
    for (const k of sinks) {
      if (s !== k && s.build >= 0 && k.build >= 0 && touch(s, k)) {
        link(s, k, f.line.connect(s.build, k.build));
      }
    }
  }
}
