// Is an autopilot module fitted to this vehicle, and the sentence a screen
// prints while the solver is still absent. Split out of Autopilot.ts
// (line-cap batch 2, BT-285): the one group here with no dependency on the
// of_ap_* bridge at all, since it reads the vehicle's own parts.

import type { AutopilotTarget } from './AutopilotTargets.js';
import type { DesignPart } from './VesselDesign.js';
import { AUTOPILOT_PART_ID, AUTOPILOT_ITEM_ID, type Reach }
  from './AutopilotBridge.js';

/**
 * IS AN AUTOPILOT MODULE ON THIS VEHICLE. The brief's rule, verbatim: no
 * module, no planner.
 *
 * Returns a reason rather than a bare false, and the reason distinguishes the
 * two states that look identical from the player's chair: the part is not on
 * the rocket, or the part does not exist in this build's catalogue at all. The
 * second is a broken build and must never read as "you forgot to fit one".
 */
export interface ModuleFit {
  fitted: boolean;
  /** '' when fitted. */
  reason: string;
  /** True when /core publishes no such part, i.e. the catalogue row is not in
   *  yet. A DIFFERENT condition from "not fitted" and it says so. */
  partMissingFromCatalogue: boolean;
  /** GP-267. The part exists but this world has not researched it. A THIRD
   *  state, and the one Reid's survival world is actually in: `GameMode`
   *  gates on `!sandbox`, so a probe that only ran in sandbox would see this
   *  branch never taken and call the feature done. */
  lockedByTech: string;
  count: number;
}

/**
 * @param lockOf '' when the item is available or ungated, otherwise the NAME of
 *   the tech that would unlock it. Same shape as `Buildables.lockOf`, so the
 *   bay and the build menu answer this question the same way. Undefined means
 *   no research authority is wired, which reads as UNGATED (the sandbox and
 *   `?research=0` case), never as locked.
 */
export function moduleFitted(parts: readonly DesignPart[],
                             catalogueIds: readonly number[],
                             lockOf?: (itemId: number) => string): ModuleFit {
  const known = catalogueIds.includes(AUTOPILOT_PART_ID);
  const count = parts.filter((p) => p.partId === AUTOPILOT_PART_ID).length;
  const base = { fitted: false, count: 0, partMissingFromCatalogue: false,
                 lockedByTech: '' };
  if (!known) {
    return {
      ...base, partMissingFromCatalogue: true,
      reason: `this build has no part 0x${AUTOPILOT_PART_ID.toString(16)} in `
        + 'the catalogue, so no vehicle can carry an autopilot yet. The '
        + 'catalogue row belongs to /core (vessel.h) and is not in.',
    };
  }
  // THE ORDER MATTERS. A locked part that IS somehow on the vehicle still
  // reports fitted, because the vehicle is the fact and the lock is about what
  // the shop will sell you; but a locked part that is NOT fitted must say
  // "research it" rather than "go and fit one", which is advice a player
  // cannot follow.
  const lock = count === 0 && lockOf !== undefined
    ? lockOf(AUTOPILOT_ITEM_ID) : '';
  if (lock !== '') {
    return {
      ...base, lockedByTech: lock,
      reason: `no Autopilot Module on this vehicle, and it is not researched `
        + `yet: ${lock} unlocks it. Reaching orbit by hand is what earns the `
        + 'right to research it.',
    };
  }
  if (count === 0) {
    return {
      ...base,
      reason: 'no Autopilot Module on this vehicle: fit one from the Ctrl tab '
        + 'and the destination planner turns on.',
    };
  }
  return { fitted: true, count, partMissingFromCatalogue: false,
           lockedByTech: '', reason: '' };
}

/** The one sentence a screen prints when the solver is not on the bridge. It
 *  lives here so the bay and the map cannot word it differently. */
export function waitingSentence(waitingOn: string): string {
  return `the transfer solver is not on this bridge yet: waiting for `
    + `${waitingOn}. The vehicle figures beside this are /core's own and are `
    + `live; only the mission cost is missing.`;
}

/** Everything a screen needs about one destination, in one object, so the bay
 *  and the map ask the same question of the same shape. */
export interface DestinationView {
  target: AutopilotTarget | null;
  fit: ModuleFit;
  reach: Reach;
}
