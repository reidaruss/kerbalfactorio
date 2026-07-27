// HOW MANY SIM STEPS ONE TICK MAY TAKE. Split out of FlightSession because it
// is a policy with a rationale rather than a line of arithmetic, and because
// the session was at the 400-line cap.
//
// PHYSICS warp, and the distinction matters (PH-26). `of_fl_step_n(f, dt, n)`
// takes n steps of the SAME dt, so warping costs the integrator nothing and
// flies exactly the trajectory a real-time flight would fly. What it costs is
// CONTROL LATENCY: the stick is sampled once per BLOCK, not once per step.
// That is why the in-air cap is the LOWER one. This is not KSP's on-rails
// warp, which teleports along a conic and cannot be used under thrust, so it
// does not touch DW-30's concession list.

/** The warp ladder the player steps up and down. Index, not multiplier. */
export const WARP_STEPS = [1, 2, 4, 10, 50, 200, 1000] as const;

/** Inside the atmosphere the stick has to be sampled often enough to fly. */
const IN_AIR_MAX = 10;

/**
 * The fraction of the height a vehicle has left that one blind block may
 * consume when it is closing on the ground.
 *
 * PH-34, and the reason it exists is a staleness bug rather than a taste.
 * `inSpace` is written by the PREVIOUS tick's telemetry, so on the way down
 * the block that crosses the atmosphere ceiling still runs at up to 1000x on
 * the strength of a sample taken in space. At 60 km and 2 km/s that is 16.7
 * seconds and about 33 km of re-entry taken in one step, with no telemetry
 * read and no control sample inside it: the vehicle jumps from space to deep
 * atmosphere (or straight through the ground, which the arrest then snaps it
 * back up out of), and `maxQPa` misses the actual peak entirely because it is
 * sampled once per block rather than once per step.
 *
 * Bounding the block by the height REMAINING fixes it without keeping a second
 * copy of the ceiling altitude in the client, which would be one more place
 * for the air the vehicle flies through to disagree with the air it is drawn
 * in. A tenth is 6 km of a 60 km block, and it costs nothing on the way up
 * because a climbing vehicle is not closing on anything.
 */
const CLOSING_FRACTION = 0.1;

/**
 * `factor` is the ladder value the player selected; the rest is where the
 * vehicle actually is. Returns at least 1, so a tick always advances.
 */
export function warpSteps(factor: number, inSpace: boolean,
                          altitudeAglM: number, closingMS: number,
                          dt: number): number {
  let n = factor > 1 ? Math.floor(factor) : 1;
  if (!inSpace && n > IN_AIR_MAX) n = IN_AIR_MAX;
  if (n > 1 && closingMS > 0 && dt > 0) {
    const room = Math.max(0, altitudeAglM) * CLOSING_FRACTION;
    const maxN = Math.floor(room / (closingMS * dt));
    if (n > maxN) n = maxN < 1 ? 1 : maxN;
  }
  return n;
}

export { IN_AIR_MAX as WARP_IN_AIR_MAX, CLOSING_FRACTION as WARP_CLOSING_FRACTION };
