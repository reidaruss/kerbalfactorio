// THE ONE JOB A PLACEMENT LAYER HAS THAT /core CANNOT DO FOR IT: deciding which
// buildings are next to which, and turning that into connect() calls.
//
// Split out of Factory when demolition landed, because it is a genuinely
// separate question. Factory owns the PLAN and its lifecycle; this file answers
// two geometry questions about a plan, both pure:
//
//   which belt tiles form one transport line, and in what order
//   which PORTS meet, so a hand-off exists between them
//
// FS-44 REWROTE THE SECOND LINE, and the old wording is worth keeping visible
// because it names what changed: it read "which buildings TOUCH, so an inserter
// belongs between them". Touching was a distance between two centres, and the
// inserter was a machine the player never placed, drawn over the gap to make the
// invisible rule legible. Neither survives. A connection is now an OUTLET socket
// meeting an INLET socket, and it is legible because the belt visibly ends at the
// hopper. `FactoryPorts` owns the geometry and `FactoryRefusal` owns the
// sentence; what is left here is the plan-shaped question of which ends of which
// runs to ask about.
//
// A run is ONE line however many tiles the player laid, which is the whole point
// of the factory_sim section 2 model: the head and the tail are what get wired,
// and the tiles in between are a length, not entities to connect.

import * as THREE from 'three';
import { type Factory, type Placed } from './Factory.js';
import { linksBetween, machinePorts, portOf, portsLoaded, PORT_MATE_M,
  type PortLink, type PortWorld } from './FactoryPorts.js';
import { aimedAt, refusalFor } from './FactoryRefusal.js';

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
 *
 * FS-27: AND A PURE CYCLE STILL PRODUCES A RUN, which it did not before, and the
 * failure that fixed was silent in the worst way. The first pass only starts a
 * run at a tile with NO predecessor, so a closed loop, in which every tile has
 * one, emitted nothing at all: the tiles kept existing in the plan, kept being
 * drawn, and were never placed in /core, so `Placed.build` stayed -1, nothing was
 * wired to them, and a drill beside them mined into a buffer for ever. The whole
 * report of it was `runs: []` next to four live belt tiles.
 *
 * It became reachable because FS-27 stopped `pitchRuns` rewriting headings from
 * run geometry: two tiles facing each other used to be straightened out on the
 * next commit and now they stay as the player left them. Measured
 * (`probes/shortline.js`): two belts one cell apart with opposite headings, a
 * drill feeding neither, 48 ore mined and 0 iron over 1,200 ticks, with `links`
 * empty and no error anywhere.
 *
 * The second pass starts a run at the lowest-id tile not yet visited, which
 * breaks the cycle at a defined point rather than an arbitrary one, so the
 * grouping stays deterministic (standing rule 4). The walk's own `seen` guard
 * already stops it going round twice.
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
  const used = new Set<number>();
  const walk = (b: Placed): void => {
    const run: Placed[] = [];
    let cur: Placed | undefined = b;
    while (cur !== undefined && !used.has(cur.id)) {
      used.add(cur.id);
      run.push(cur);
      cur = next.get(cur.id);
    }
    if (run.length > 0) out.push(run);
  };
  for (const b of belts) if (!hasPrev.has(b.id)) walk(b);
  for (const b of belts) if (!used.has(b.id)) walk(b);
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
 * FS-44: THE CONNECTION IS TO A PORT, NOT TO A MACHINE.
 *
 * WHAT THIS FUNCTION USED TO BE, because the diff is the whole decision. It
 * measured the distance between two buildings' CENTRES against a reach derived
 * from their footprints plus 0.75 m, and wired whatever came out under the bar.
 * That is Factorio's model and it worked, and it produced three of this lane's
 * five worst defects, all of the same shape: a connection nobody asked for.
 * FS-17 was a smelter wired onto the tail of the run whose head fed it, which
 * deadlocked the line on ingot number one, permanently, in five buildings. The
 * fix for it was an exclusion list computed before any link was made. FS-41 was
 * a smelter authored with a coal-to-iron recipe because the nearest drill's ore
 * was taken as its input. Both were fixed and both fixes were epicycles on a
 * model whose defining property is that the player cannot see it.
 *
 * WHAT IT IS NOW. A run's tail presents `socket_belt_in` and its head presents
 * `socket_belt_out`; a smelter presents `socket_item_in` on one face and
 * `socket_item_out` on the other. A connection exists exactly where an OUTLET
 * meets an INLET: within `PORT_MATE_M` in the tangent plane, facing each other
 * within `PORT_FACE_DOT`, and running the right way. `FactoryPorts` owns those
 * three rules and the numbers behind them.
 *
 * FS-17's EXCLUSION LIST IS GONE, AND THAT IS THE PROOF THE MODEL IS BETTER
 * RATHER THAN DIFFERENT. The deadlock it guarded against cannot be expressed in
 * this model: a smelter's outlet is on the opposite face from its inlet, so for
 * it to feed the tail of the run that feeds its inlet, the run would have to
 * wrap around the housing and arrive back at the far face pointing inward, which
 * is a loop the player has visibly and deliberately built. The special case is
 * not deleted and hoped about; `probes/machineports.js` lays FS-17's exact
 * geometry, a drill and two belts and a smelter, and asserts `linksToTail === 0`
 * on the same scene the old probe did.
 *
 * THE SMELTER-TO-SMELTER GUARD IS GONE TOO, for a different reason: FS-37 landed
 * typed acceptance in `/core`, so a machine handed an item its recipe does not
 * eat refuses it AT PICKUP and the line backs up where the player can see it.
 * That is a better answer than a wiring layer quietly declining to make a
 * connection the player built on purpose, and it is the composition the whole
 * change is for. The belt physically connects, and the machine refuses the wrong
 * item with visible back pressure.
 *
 * REMOVAL IS STILL WHY THIS IS RECOMPUTED WHOLE. Pulling a tile out of the
 * middle of a run splits it in two, and the halves have different heads and
 * tails than anything that existed before, so there is nothing to patch.
 */
export function wire(f: Factory): void {
  const ports = machinePorts();
  f.links = [];
  f.refusals = [];
  f.portsLoaded = portsLoaded();
  // A WIRING LAYER WITH NO PORT TABLE CONNECTS NOTHING, and that would look
  // exactly like a base whose belts are all misaligned. It is reported as its
  // own fact rather than left to be inferred from an empty link list, because a
  // subsystem that silently does nothing when its data is missing is the ceiling
  // that reports success (DW-28). `FactoryView.load` publishes the table before
  // `Gameplay.load` restores a save, so in the shipping client this is true.
  if (!f.portsLoaded) return;

  const link = (a: Placed, b: Placed, l: PortLink, ok: boolean): void => {
    if (!ok) return;
    const fwd = new THREE.Vector3(l.to.world.x - l.from.world.x,
      l.to.world.y - l.from.world.y, l.to.world.z - l.from.world.z);
    if (fwd.lengthSq() < 1e-9) fwd.copy(l.from.face);
    f.links.push({
      // The hand-off happens BETWEEN THE TWO PORTS now, not between the two
      // centres. Nothing is drawn there any more (FS-47), but the point is what
      // a probe measures and what a future port decal would sit on, and a
      // midpoint of centres would be inside the housing on a 2 m machine.
      pos: { x: (l.from.world.x + l.to.world.x) * 0.5,
             y: (l.from.world.y + l.to.world.y) * 0.5,
             z: (l.from.world.z + l.to.world.z) * 0.5 },
      up: a.up.clone(), fwd: fwd.normalize(), from: a.id, to: b.id,
      fromPort: l.from.name, toPort: l.to.name,
      gapM: +l.fit.gapM.toFixed(4), riseM: +l.fit.riseM.toFixed(4),
      facing: +l.fit.facing.toFixed(4),
    });
  };

  // Anything that is not a belt and is live in /core. Poles and generators fall
  // out here for free rather than by name, because `machinePorts` has no row for
  // a part with no item IO.
  const parts = f.placed.filter((p) => p.kind !== 'belt' && p.build >= 0);

  f.runs.forEach((run, i) => {
    const build = f.runBuilds[i];
    if (build === undefined || run.length === 0) return;
    const head = run[run.length - 1];
    const tail = run[0];
    // THE RUN'S TWO ENDS, AS PORTS OF THEIR OWN TILES. A corner tile at the head
    // is drawn as a curve whose outlet is on its local -X or +X face, and this
    // deliberately reads the STRAIGHT tile's +Z outlet against the tile's own
    // `fwd`. That is not an approximation: FS-40 builds a corner's draw frame
    // from BOTH headings precisely so the drawn outlet lands where the tile's
    // own heading says the flow leaves, and `probes/beltslope.js` measures that
    // it does. The plan holds straight tiles; the curve is a render decision.
    const out = portOf(head, 'socket_belt_out', ports);
    const into = portOf(tail, 'socket_belt_in', ports);
    // Sinks first? No: SOURCES first, and the order is load bearing. It is the
    // order the two connect() calls reach /core and therefore the order the
    // inserters tick in, which FS-17 established and this change must not move.
    if (into !== null) {
      for (const s of parts) {
        for (const l of linksBetween(s, tail, ports)) {
          link(s, tail, l, f.line.connect(s.build, build));
        }
      }
    }
    if (out !== null) {
      let mated = false;
      for (const k of parts) {
        for (const l of linksBetween(head, k, ports)) {
          mated = true;
          link(head, k, l, f.line.connect(build, k.build));
        }
      }
      // FS-45: A RUN THAT ENDS AT A HOUSING SAYS SO.
      if (!mated) noteRefusal(f, out, ports);
    }
  });

  // Machine to machine, with no belt between them. Two 2 m machines two cells
  // apart put their facing ports at exactly the same point (gap 0.000 m), which
  // is the tightest mate in the game and the one a player discovers by shoving
  // a drill against a smelter.
  //
  // THE COARSE REJECT IS NOT PREMATURE. This pair loop is O(parts squared) and
  // it runs on every COMMIT, which is every placement, every removal and every
  // tile of a drag; FS-16's sweep put the next real ceiling at about 1,180
  // machines, and 1,180 squared is 1.4 M pairs each doing four port
  // resolutions with a quaternion apply. `NEAR_M` is the widest a mate can
  // possibly be: no socket of any machine asset sits further than 1.6 m from
  // its own origin (FactorySnap's coarse reject measured the same set), so two
  // centres further apart than twice that plus the mate bound cannot own a
  // link, whatever their yaw.
  const NEAR_M = 1.6 * 2 + PORT_MATE_M;
  for (const s of parts) {
    for (const k of parts) {
      if (s === k) continue;
      if (Math.hypot(s.pos.x - k.pos.x, s.pos.y - k.pos.y,
        s.pos.z - k.pos.z) > NEAR_M) continue;
      for (const l of linksBetween(s, k, ports)) {
        link(s, k, l, f.line.connect(s.build, k.build));
      }
    }
  }
}

/** Record why a run's head did not connect to what it was plainly aimed at. */
function noteRefusal(f: Factory, out: PortWorld,
                     ports: ReturnType<typeof machinePorts>): void {
  const aim = aimedAt(out, f.placed, ports);
  if (aim === null) return;
  const r = refusalFor(out, aim, out.build.up);
  if (r !== null) f.refusals.push(r);
}
