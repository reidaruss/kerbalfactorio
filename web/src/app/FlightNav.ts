// =============================================================================
// FlightNav.ts - THE HAND PILOT'S BLOCK: every number a player flying by the
// navball needs, in one place, published and not drawn.
//
// PH-350. Reid's first station mission is hand flown ON PURPOSE (the storyline
// outline at the repo root, and Admin's ruling beside it), so every number a
// burn is judged by has to reach the instrument the burn is flown by. Four of
// them existed and were drawn ONLY in the map: time to apoapsis, time to
// periapsis, the period and the burn timer. A playability sweep called that the
// biggest KSP-expectation gap it found, and it is right: a pilot flying an
// ascent watches the ball, not the map.
//
// IT PUBLISHES AND IT DOES NOT DRAW, which is the whole shape of this file.
// Every field below is either /core's own answer read back through an export
// that already exists, or a subtraction of two numbers /core produced. Nothing
// here is a second physics and nothing here paints a pixel: `ui/Navball.ts`
// belongs to the gameplay lane and is not touched by this change.
//
// WHY THE FIELDS RIDE ALONGSIDE `NavballReadout` RATHER THAN INSIDE IT.
// `FlightMode.readout()` returns `NavballReadout & NavPublication`. The
// instrument keeps its own published contract unchanged, this lane adds to the
// object without editing a file another lane is live in, and
// `__of.flight('readout')` carries every new number the day it EXISTS rather
// than the day something decides to draw it. A number nothing draws is still
// measurable; a number nothing publishes is not, and that asymmetry is why
// three of the seven gaps this file closes went unnoticed for weeks.
//
// TWO OF THE FIELDS ARE THE MODE'S rather than the session's, on exactly the
// precedent `nodeDir` set: `burn` is written by `MapNode` every frame and
// `target` by `MapMode`, so the ball and the map read ONE burn timer and ONE
// range from one computation instead of two that can disagree.
// =============================================================================
import { len } from '../sim/FlightAbi.js';
import type { Vec3 } from '../sim/FlightAbi.js';
import { EMPTY_META, orbitMeta } from '../sim/ManeuverAbi.js';
import type { FlightMode } from './FlightMode.js';

/**
 * THE MANEUVER NODE AS A CLOCK AND A COUNTDOWN, which is what a hand pilot
 * flies a node by. `MapNode` writes it every frame, map open or not.
 */
export interface NodeBurn {
  /** Seconds until the node itself. `of_mn_plan` word 11. */
  nodeS: number;
  /** Seconds until the engine should be LIT: the node minus half the burn.
   *  Negative means late, which is the honest readout for "you missed it".
   *  `of_mn_plan` word 12. */
  startS: number;
  /** How long the burn is. `of_mn_plan` word 13. */
  durationS: number;
  /**
   * The node's PLANNED delta-v, `of_mn_plan` word 10. It is `|handles|` and it
   * is therefore CONSTANT for a given node, which is not a defect: it is the
   * size of the plan, and the plan does not shrink because you flew some of it.
   */
  plannedDvMS: number;
  /**
   * WHAT IS LEFT OF IT, and this is the field the node did not have.
   *
   * Measured before this existed: `dV` read 200.00 m/s at BOTH ENDS of a
   * 42-sample burn that took apoapsis from 108,562 m to 402,766 m, because the
   * plan is recomputed every frame from the stored handles and nothing
   * subtracted the spend. A hand-flying player had no cut-off cue at all.
   *
   * It is the magnitude of `planned vector - spent vector`, both inertial, and
   * the VECTOR form is the point rather than a nicety: a player pointing 30
   * degrees off spends delta-v and makes the remaining figure go DOWN slower
   * than the tank empties, and one pointing backwards makes it go UP. A scalar
   * subtraction would call all three of those the same burn.
   */
  remainingDvMS: number;
  /** How far the nose is from the burn direction, degrees. The other half of
   *  the cut-off cue: 200 m/s remaining means nothing without it. */
  pointingErrorDeg: number;
  /** `of_mn_plan` word 17: can the vehicle actually pay for this node. */
  feasible: boolean;
}

/**
 * THE SELECTED TARGET, RELATIVE. R90: the only range and closing rate in the
 * game sat inside the autopilot's ARMED block, and the storyline gates the
 * autopilot behind the mission that needs them, so the two numbers a hand pilot
 * needs most arrived only after the flight that needs them.
 */
export interface NavTarget {
  name: string;
  rangeM: number;
  /** POSITIVE IS CLOSING. The sign is the whole information: 100 m out at
   *  +0.2 m/s is arriving and 100 m out at -0.2 m/s is drifting away. */
  closingMS: number;
  /**
   * TRUE WHEN THE TARGET'S CLOCK IS NOT RUNNING, published BESIDE the range
   * rather than folded into it because R92 is ruled and closed.
   *
   * An unstamped record (`stampedTick < 0`) has `clockAt` return its stored
   * clock unchanged, so its position does not advance while its published
   * velocity does: Anchorage finite-differences to exactly 0 m of travel while
   * reporting 1879.255 m/s off the same conic. `rangeM` above is therefore the
   * range to where the target WAS. The record is deliberately not zeroed (that
   * would break the armed rendezvous that works today) and the real fix is
   * sequenced behind core-engine's carrier term: R79, then PH-305.
   *
   * Until then the discrepancy is at least ATTRIBUTABLE, which is the whole
   * difference between a wrong number and a wrong number nobody can see is
   * wrong. See `MapPlanner.closing()` for the full argument.
   */
  frozen: boolean;
}

/** Everything this lane adds to the navball's readout object. */
export interface NavPublication {
  /** Seconds to apoapsis. -1 when there is no such time (an unbound trajectory
   *  has no apoapsis). `of_mn_orbit_meta` word 7. */
  timeToApoapsisS: number;
  /** Seconds to periapsis. -1 when there is none. `of_mn_orbit_meta` word 8. */
  timeToPeriapsisS: number;
  /** Orbital period, seconds. 0 when unbound. `of_fl_orbit` word 4. */
  periodS: number;
  /**
   * THE PERIAPSIS AS A RADIUS FROM THE BODY CENTRE, which is the quantity the
   * `PE -600.00 km` defect is actually about.
   *
   * A vehicle standing still has a perfectly well defined degenerate conic
   * straight through the planet's centre, so its periapsis RADIUS is 0 and its
   * periapsis ALTITUDE is minus the datum radius. `FlightReadout`'s `bound`
   * guard excluded the two status words that produce it on the pad (CLAMPED,
   * DOWN) and could not exclude a near-vertical climb, which produces the same
   * figure with the vehicle very much flying: at 10 m/s of horizontal velocity
   * on Forge the periapsis radius is about 5 m and `PE` still draws -600.00 km.
   *
   * A STATUS WORD WAS THE WRONG INSTRUMENT. This is the physical fact and it
   * needs no list of states to keep up to date.
   */
  periapsisRadiusM: number;
  /**
   * TRUE WHEN `PE` IS A PLACE THE VEHICLE COULD ACTUALLY PASS THROUGH: the
   * conic is closed and its periapsis is above the datum.
   *
   * This is the gate the `PE` cell should draw on, and it subsumes CLAMPED,
   * DOWN, the vertical climb and re-entry without naming any of them. It is
   * published rather than applied to `periapsisM`, because replacing a true
   * number with a blank because it READS badly is the one thing the header of
   * `FlightReadout.ts` forbids. `timeToPeriapsisS` is published beside it so an
   * instrument that would rather say "impact in 4:12" than `---` can.
   */
  periapsisMeaningful: boolean;
  /** The warp the player asked for: the ladder value, `WARP_STEPS[index]`. */
  warpFactor: number;
  /** The warp actually running: sub-steps the LAST tick took. These two differ
   *  by up to 100x and only the first was ever drawn (PH-350, and see
   *  `FlightSession.warpStepsTaken`). */
  warpEffectiveX: number;
  /** '' | 'air' | 'ground'. Why the two differ. */
  warpLimitedBy: string;
  /**
   * HOW FAR THE NOSE IS FROM WHERE SAS IS AIMING, degrees, straight off
   * `of_fl_telemetry` word 9.
   *
   * R89's other half. `SAS HOLD` was drawn while the heading walked HDG 285 to
   * HDG 000 and no reading on the instrument distinguished a HELD nose from a
   * CHASING one, because this number existed in the flight report and was never
   * on the readout the ball is built from. The chip says which MODE is on; this
   * says whether the mode is winning.
   */
  sasErrDeg: number;
  /** True when the control authority is saturated: the nose is being asked for
   *  more torque than the vehicle has, which is the state in which a held mode
   *  never arrives. */
  sasSaturated: boolean;
  /** The maneuver node's clock and countdown, or null when there is no node. */
  burn: NodeBurn | null;
  /** The selected target, relative, or null when nothing is selected. */
  target: NavTarget | null;
}

const DEG = 180 / Math.PI;

/**
 * Compose the block. A pure read: one extra call into /core (`of_mn_orbit_meta`,
 * the SAME export the map's own conic scalars come from, so the ball and the map
 * cannot disagree about when apoapsis is) and otherwise arithmetic on numbers
 * that are already in hand.
 */
export function navPublication(m: FlightMode): NavPublication {
  const s = m.session;
  const st = s.state;
  const tm = s.telemetry;
  const o = s.orbit;
  // THE DATUM RADIUS, DERIVED FROM TWO NUMBERS /core PUBLISHED rather than from
  // a fourth copy of the body's size in this client. `telemetry.altitudeM` is
  // height above the datum and `|pos|` is the radius, so their difference IS
  // the datum radius, for any body, with no per-world constant to go stale.
  const datumRadiusM = len(st.pos) - tm.altitudeM;
  const meta = s.live
    ? orbitMeta(s.V, s.handle, st.pos as Vec3, st.vel as Vec3)
    : EMPTY_META;
  const periapsisRadiusM = o.periapsisAltM + datumRadiusM;
  return {
    timeToApoapsisS: meta.timeToApoapsisS,
    timeToPeriapsisS: meta.timeToPeriapsisS,
    periodS: o.periodS,
    periapsisRadiusM,
    periapsisMeaningful: o.bound && Number.isFinite(o.periapsisAltM)
      && o.periapsisAltM > 0,
    warpFactor: s.warpFactor,
    warpEffectiveX: s.warpStepsTaken,
    warpLimitedBy: s.warpLimitedBy,
    sasErrDeg: tm.sasErrorRad * DEG,
    sasSaturated: tm.sasSaturated,
    burn: m.nodeBurn,
    target: m.navTarget,
  };
}
