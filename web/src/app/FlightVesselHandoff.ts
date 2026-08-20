// The outward-handoff verbs of FlightVessels.ts (see that file's header for
// the promote/demote engine's own rules). Split out at the 400-line cap:
// these three only CALL into FlightVessels.ts's demoteVessel/promoteVessel
// (both already exported) and touch no module state of their own, so the
// import runs one way (this file depends on FlightVessels.ts, never the
// reverse) and there is no cycle.

import { demoteVessel, promoteVessel, syncPromoted } from './FlightVessels.js';
import { mayLeave, whyNotLeave } from './ResumeBoot.js';
import { registry } from '../sim/VesselRegistry.js';
import type { FlightMode } from './FlightMode.js';

/**
 * PH-76. THE HANDOFF, OUTWARD. `leaveVessel` is `demoteVessel` WITH THE PUBLISHED
 * GUARD IN FRONT OF IT, and the guard is the whole difference between the two.
 *
 * `demoteVessel` is the mechanism and it refuses nothing, deliberately: a reload
 * must be able to park a vessel in ANY state, including frozen, because closing a
 * browser tab is not a choice the game gets to refuse (ResumeBoot.ts §5). This is
 * the VOLUNTARY handoff, and a voluntary one may not leave a vessel that no
 * arithmetic can advance. Leaving a frozen one gives you a rocket hanging
 * motionless mid-ascent for as long as you are away.
 *
 * THE SYNC BEFORE THE GUARD IS LOAD-BEARING AND IS NOT A TIDY-UP. `rec.mode` is
 * written by `syncPromoted` and by `makeRecord`, and `makeRecord` stamps
 * `'parked'` at roll-out. So a record carried by a vessel that has since launched
 * still SAYS parked until something syncs it, and `mayLeave` reading that stale
 * word would cheerfully wave a rocket under full thrust at 12 km out of the
 * world. Sync first, then ask. `demoteVessel` syncs again and that second call is
 * free: it is the same read of the same live sim one statement later.
 */
export function leaveVessel(m: FlightMode, tick: number): boolean {
  const rec = registry.promoted;
  if (rec === null || !m.session.live) {
    m.flash('no vessel to leave');
    return false;
  }
  syncPromoted(m, tick);
  if (!mayLeave(rec)) {
    // NOTHING CHANGES on a refusal. Not the session, not `aboard`, not the
    // record. A guard that half-applies is worse than no guard, because the
    // player is then in a state neither branch was written for.
    m.flash(whyNotLeave(rec));
    return false;
  }
  return demoteVessel(m, tick) === rec.id;
}

/**
 * PH-76. THE HANDOFF, INWARD, and the inverse of `releaseControl`.
 *
 * TWO STEPS AND THEY ARE ORDERED. First the record becomes a live FlightSim
 * (`promoteVessel` restores the design, the stagings, the fuel, the state vector
 * and the pose), and ONLY THEN is the player seated in it. If the promote fails
 * the player is not seated at all: a half-seat, somebody strapped into a vessel
 * that does not exist, is the precise failure `releaseControl` was written to
 * close and that `reload.mjs` carries a standing assertion against. There is no
 * branch here where `aboard` becomes true without a live session behind it.
 *
 * IT SEATS THROUGH `takeControlRemote` AND NOT THROUGH `board`. The vessel being
 * resumed is typically a few hundred kilometres up, so the board key's range gate
 * can only refuse, and past its abandon range that same key rolls out a SECOND
 * rocket. FlightMode.ts explains why the gate stays and why this is a separate
 * verb rather than a widened one.
 *
 * IDEMPOTENT on a vessel that is already promoted AND already aboard: both halves
 * return true unchanged, so a double click costs one no-op rather than a demote
 * and a rebuild.
 */
export function resumeControl(m: FlightMode, id: number, tick: number): boolean {
  if (!promoteVessel(m, id, tick)) return false;
  return m.takeControlRemote();
}

/**
 * BOOT: adopt the saved records, and promote AT MOST the parked one.
 *
 * A parked vessel is standing in the same world the player is standing in, so it
 * has to be drawn and boardable, and promoting it costs one FlightSim that does
 * almost nothing (a CLAMPED or DOWN session steps trivially). A vessel on rails
 * is not in the near scene at all, so promoting it would be paying for a
 * simulation nobody is looking at, which is the exact cost on-rails exists to
 * avoid. NOTHING PUTS THE PLAYER BACK INSIDE A VESSEL on a reload: that is the
 * control handoff and it is a later lane's (§5 of the seam).
 */
export function promoteOnBoot(m: FlightMode | null, tick: number): number {
  if (m === null) return 0;
  for (const rec of registry.list()) {
    if (rec.mode !== 'parked') continue;
    return promoteVessel(m, rec.id, tick) ? rec.id : 0;
  }
  return 0;
}
