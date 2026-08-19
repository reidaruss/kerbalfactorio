// The navball HUD's data shapes. Split out of Navball.ts (line-cap batch 2,
// BT-285): pure type/interface declarations, no state and no behaviour, so
// they move as a unit with no effect on the class or the formatting helpers.

import type { NavPublication } from '../app/FlightNav.js';

export interface BallMarker { headingDeg: number; pitchDeg: number }

export interface StageReadout {
  index: number; dvVacMS: number; twr: number; burnS: number; active: boolean;
}

/**
 * GP-610. The hand pilot's numbers, and this instrument does NOT redeclare them.
 *
 * `NavPublication` is physics' published contract (`app/FlightNav.ts`), and
 * `FlightReadout` already spreads it onto the object this file is handed. So
 * the drawing side asks for the intersection and gets thirteen fields it cannot
 * disagree with about shape. Restating them here would have been a second copy
 * of somebody else's interface, which is the thing this project has paid for
 * five times over; and `Partial` is deliberately NOT used, because a field that
 * silently goes missing is exactly the class `mustNum` exists to make loud.
 */
export type NavballFullReadout = NavballReadout & NavPublication;

export interface NavballReadout {
  /** Vessel nose attitude in the LOCAL horizon frame. heading 0 = north,
   *  90 = east. pitch +90 = straight up. */
  headingDeg: number; pitchDeg: number; rollDeg: number;
  /** Markers in the same local horizon frame. null when undefined (e.g. zero
   *  velocity). */
  prograde: BallMarker | null;
  retrograde: BallMarker | null;
  /** The SAS commanded attitude. */
  command: BallMarker | null;
  /** DW-30 item 6: the gravity-turn guidance ribbon. Shown, never flown. */
  guidance: BallMarker | null;
  /** The maneuver node's burn direction. Reid asked for this by name ("then it
   *  should show up on the ball"), and it is the SAME machinery the other four
   *  markers use with a different direction: the node publishes an inertial
   *  unit vector and `FlightMode.marker` turns it into horizon angles through
   *  the one frame everything else uses. */
  node: BallMarker | null;
  /** Metres above the terrain under the vessel. */
  altitudeM: number;
  /** Metres above the 600 km datum, which is what apoapsis and periapsis are
   *  relative to. */
  altitudeDatumM: number;
  surfaceSpeedMS: number;
  orbitalSpeedMS: number;
  verticalSpeedMS: number;
  /** Metres above the datum. Not finite when the trajectory is unbound. */
  apoapsisM: number; periapsisM: number;
  /** True when the conic is closed. */
  bound: boolean;
  throttle: number;
  stages: StageReadout[];
  totalDvMS: number; remainingDvMS: number;
  sas: string;
  status: string;
  qPa: number; maxQPa: number; twr: number; massKg: number; gForce: number;
  metS: number;
  /** A STANDING condition the player is owed, drawn until it goes away. Not the
   *  same thing as `message`, which is a transient flash: a warning that scrolls
   *  past in four seconds is a warning nobody read. '' when there is none. */
  warning: string;
  /** GP-139: WHAT TO DO NEXT, standing, derived from state every frame. A third
   *  kind of thing and not a synonym for either of the other two: `warning` says
   *  something is wrong, `message` is a transient flash, and this says which key
   *  to press. All three can be true at once and each is drawn in its own chip,
   *  because a player who is told the vessel cannot be saved still needs to know
   *  how to light the engine. '' when nothing is owed. */
  nextStep: string;
  message: string;
  /**
   * PH-301. THE RCS, and it is on the ball because the storyline's first
   * docking is hand-flown and a translation key that does nothing has to say
   * WHY. `monopropKg` alone would not: a vehicle with fuel and no blocks and a
   * vehicle with blocks and no fuel are the same dead key and different fixes.
   *
   * Null when the vehicle has no RCS at all, so the row is absent rather than
   * reading 0 N on a rocket that was never going to have any.
   */
  rcs: { deliveredN: number; availableN: number; monopropKg: number } | null;
}
