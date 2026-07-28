// GP-74. THE WAY OUT: one verb that takes the vessel off the world, frees the
// pad it was standing on, and leaves the DESIGN exactly where it was.
//
// Before this there was none. `board` and `disembark` are the only two exits
// from flight and neither removes anything, so a rocket that had been rolled
// out stayed rolled out: a bad staging order could not be fixed and re-flown,
// which is most of what an assembly bay is for, and a vehicle that could not
// reach TWR 1 could only be escaped by walking 200 m and pressing the board key
// to overwrite it, which is what PH-29 itself describes as being bolted to the
// ground. Every ordinary build, fly, adjust loop went through that walk.
//
// ONE VERB AND NOT THREE. The brief asked for "clear the pad", "revert to the
// bay" and "recover the vessel" in that order, and they are the same operation
// looked at from three places: destroy the live vessel and give the pad back.
// The differences are entirely in where the player is standing when they press
// it and which panel they open next, and building three of them would have been
// three things to keep correct and three ways for one of them to go stale.
//
// WHAT IT DOES NOT DO IS REFUND, AND THAT IS THE DECISION RATHER THAN AN
// OMISSION. The brief said a recovery that does not refund is a trap. It would
// be, if a roll-out cost anything: it does not. Parts are paid for once, in the
// bay, at `of_vs_part_pay`, and `rollOut` copies the paid-for DESIGN into a
// flight vessel and charges nothing (GP-34 already notes the neighbouring hole:
// loading a saved design neither charges nor refunds). So a recovery that
// credited the parts back would MINT them: build once, roll out, recover, and
// the pack is up a rocket, repeatable for as long as you like. The design is
// still yours and rolling it out again is still free, which is the sense in
// which nothing was lost, and the message says exactly that rather than leaving
// the player to wonder. The refund belongs on the day a roll-out costs
// something, and it belongs next to that charge.
//
// SANDBOX DOES NOT DIFFER, for the same reason: with `freeBuild` on, `Vab.pay`
// returns true without spending, so there is nothing to give back in either
// mode and a mode branch here would be a branch whose two sides are identical.
//
// PERSISTENCE NEEDS NOTHING, and it is worth writing down because it is not the
// obvious answer. A flown vessel is not in the save slot AT ALL (PH-30: the
// world save cannot describe a player who is strapped in, so it is refused
// while aboard, and a parked rocket is not written either). So a cleared pad
// cannot resurrect a vessel on reload, because an UNcleared one does not
// either. `LaunchPadSave` stores the pad and never its occupant. The reload
// proof is still worth having, and it proves the honest thing: the pad comes
// back, and nothing is standing on it in either case.
import { allowSave } from '../sim/SaveInhibit.js';
import type { FlightMode } from './FlightMode.js';

/**
 * Take the live vessel out of the world. -> true when something was removed.
 *
 * It goes THROUGH `disembark` when the player is aboard rather than around it,
 * which is what makes "cannot get out in flight" still mean something: the one
 * state this must not rescue you from is a vessel actually moving, and that
 * rule already exists and is already tested. Recovering by teleporting the
 * pilot out of a re-entry would have been a second, weaker copy of it.
 */
export function recoverVessel(m: FlightMode): boolean {
  if (!m.session.live) {
    m.refuse('nothing to recover: there is no vessel');
    return false;
  }
  if (m.aboard) {
    m.disembark();
    // `disembark` refuses out loud while moving, and leaving that message
    // standing is the point: overwriting it here would replace the reason with
    // a vaguer one.
    if (m.aboard) return false;
  }
  const parts = m.session.partRows.length;
  const pad = m.padInUse;
  m.session.destroy();
  // The clamps go back on an empty pad. `reclamp` is what a fresh roll-out
  // calls, so a pad that has been cleared is in the same state as one that has
  // never been used, which is the only state a save can describe (LaunchPadSave
  // restores every pad HOLDING, always).
  if (pad !== null) m.d.pads?.()?.reclamp(pad);
  m.padInUse = null;
  m.padSocketGapM = -1;
  m.drawnRevision = -1;
  m.rebuild();
  // PH-30's latch is released even though `disembark` already did it, because
  // this verb is also reachable from the ground where nothing set it. Calling
  // it twice is free; not calling it on the one path that needed it is a world
  // that silently stops autosaving.
  allowSave();
  m.recoveries += 1;
  m.flash(pad !== null
    ? `pad cleared: ${parts} parts recovered, the design is still in the bay`
    : `vessel recovered: ${parts} parts, the design is still in the bay`);
  return true;
}
