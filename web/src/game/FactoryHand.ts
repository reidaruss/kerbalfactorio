// WHAT A PLAYER'S HAND DOES TO A BUILDING THAT IS ALREADY DOWN.
//
// Split out of Factory when FS-27 (turning a placed tile) and FS-28 (taking an
// item off a belt) pushed that file past its 400-line cap, and split along a
// seam that was already there: Factory owns the PLAN and its lifecycle, and
// these three are the small transactions a player runs against a plan that
// already exists. All three end in the same place, which is why they belong
// together: they take something real out of the simulation and put it in the
// pack, and every one of them has to say where it went.
//
// EVERY ONE OF THEM IS LEDGERED. `collected`, `spilled`, `refunded` and
// `takenFromBelts` are four separate counters and none is optional, because
// "took stock out of a smelter", "lifted an ore off a belt", "got parts back
// off something demolished" and "the pack was full and it fell on the floor"
// are four different events, and a conservation claim that cannot tell them
// apart has already rotted.

import { headingIn, siteAt } from './MachinePlacement.js';
import { orient } from './Grid.js';
import type { Factory, Placed } from './Factory.js';

/**
 * Empty a building's output buffer into the pack. Returns what moved.
 *
 * `refund` only chooses which ledger it lands in: taking stock by hand and
 * getting stock back off a demolished machine are different events and a probe
 * that cannot tell them apart cannot check either.
 */
export function collectOutput(f: Factory, p: Placed, refund = false): number {
  if (p.build < 0) return 0;
  const have = f.line.outputBuffer(p.build);
  if (have <= 0) return 0;
  const took = f.line.takeOutput(p.build, have);
  if (took <= 0) return 0;
  const item = f.outputItemOf(p);
  const over = item > 0 ? f.core.add(item, took) : took;
  if (refund) f.refunded += took - over; else f.collected += took - over;
  f.spilled += over;
  return took - over;
}

/**
 * FS-28: TAKE ONE ITEM OFF THE BELT TILE UNDER THE CROSSHAIR.
 *
 * Reid's second clause, verbatim: "i should be able to pick up that stuff off
 * the belts." DW-9 makes inserters sim-internal, so this is deliberately the
 * player's HAND and not a machine: one press, one item, off the tile they were
 * actually looking at.
 *
 * WHICH item is decided by geometry rather than by convenience. The aimed tile
 * is a known whole number of tiles from its run's head, so the request is "the
 * item nearest the middle of THAT tile, within half a tile", and /core resolves
 * it against the real gap positions (`TakeLineItemNear`). Popping the head
 * instead would have been one line shorter and would mean a player aiming at the
 * far end of a run gets something from the near end, which is the kind of small
 * lie that makes a world feel like a menu.
 *
 * CONSERVATION IS EXACT AND IS LEDGERED, not asserted. The belt loses exactly
 * one item; the pack gains one, or `spilled` gains one when the pack is full.
 * That is the same three-way split `collectOutput` uses, and it is why a full
 * pack cannot quietly delete ore.
 */
export function takeFromBelt(f: Factory, p: Placed):
{ item: number; count: number } | null {
  if (p.kind !== 'belt' || p.run < 0) return null;
  f.beltTakeAttempts++;
  const run = f.runs[p.run];
  const build = f.runBuilds[p.run];
  if (run === undefined || build === undefined) return null;
  const at = run.indexOf(p);
  if (at < 0) return null;
  // `lineItems` measures from the HEAD, and a run is stored tail first.
  const fromHead = run.length - 1 - at;
  const item = f.line.takeLineItem(build, fromHead + 0.5, 0.5);
  if (item <= 0) return null;
  f.takenFromBelts++;
  const over = f.core.add(item, 1);
  f.spilled += over;
  f.collected += 1 - over;
  return { item, count: 1 - over };
}

/**
 * FS-27: TURN AN ALREADY-PLACED BUILDING ONE QUARTER TURN, AND MEAN IT.
 *
 * Reid, verbatim: "make it like factorio where i can change the direction after
 * i place it". Before this, the heading of a belt in a run was not data the
 * player owned: `FactoryCommit.pitchRuns` re-derived it from the run's geometry
 * on every commit, so a turn survived exactly until the next commit. FS-18
 * responded by hiding the key; this reverses that and pushes the fix into
 * `pitchRuns`, which now writes PITCH and never YAW.
 *
 * The new heading is one of the site's four tangent axes, never a free yaw: the
 * grid is square, so a belt at 37 degrees has no cell ahead of it to chain to.
 * `up` is RE-PROJECTED rather than reset, because a machine standing on a deck
 * takes the site's up (GP-39) and one standing on soil takes the radial, and
 * throwing that away here would tilt every machine on a base by the difference.
 * The commit that follows re-pitches whatever ended up in a run.
 *
 * Returns false when the turn changed nothing, so a caller does not announce a
 * key press that did not happen.
 */
export function turnPlaced(f: Factory, p: Placed): boolean {
  const s = siteAt(f.host, p.pos);
  const fwd = headingIn(s.site, p.fwd, 1);
  if (fwd.lengthSq() < 1e-9) return false;
  p.fwd = fwd;
  const up = p.up.clone().addScaledVector(fwd, -p.up.dot(fwd));
  if (up.lengthSq() > 1e-9) p.up = up.normalize();
  p.quat = orient(p.up, p.fwd);
  f.commit();
  return true;
}
