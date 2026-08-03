// PH-301. TRANSLATIONAL RCS: what the six new keys mean.
//
// Free functions over a `FlightSession`, on the seam `FlightSas.ts` already
// cut, and for the same reason: the state they move is `/core`'s and giving it
// a second owner would be a second thing that can disagree about where the
// vehicle is pushing. `FlightSession.ts` is also already over the 400 line cap
// (R53), so this is the file that does not make that worse.
//
// -----------------------------------------------------------------------------
// WHY TRANSLATION IS A SEPARATE CONTROL FROM THE THROTTLE, WHICH IS THE WHOLE
// DESIGN AND IS NOT OBVIOUS UNTIL YOU TRY TO DOCK.
//
// A rocket accelerates along its nose. An approach has to hold the PORT pointed
// at the other port while correcting sideways, and those are the same direction
// only if you never need to correct. Correcting is the entire job of the last
// hundred metres, so without translation a vehicle can point OR move, never
// both, and every correction spends the pointing that the capture cone needs.
//
// -----------------------------------------------------------------------------
// THE COMMAND IS BUILT IN THE VESSEL FRAME AND SENT IN THE INERTIAL ONE.
//
// A pilot presses "left"; the bridge takes an inertial vector (see
// `_of_fl_rcs_translate`'s own note on why). The conversion happens exactly
// once, HERE, out of the same `forward`/`right` row the navball draws from, so
// there is one derivation of the vessel basis in the client.
//
// The third axis is `cross(forward, right)`, matching `docking::portAt`'s
// `U = F x R`, so "up" here and "up" in a port's local frame are the same axis.
// Getting that wrong would be invisible in flight and would place a docking
// port a quarter turn out.
//
// NOTHING HERE WRITES `right`. PH-44 made attitude a single authority and R80
// records that there is deliberately no roll command in `flight.h`; a
// translation that quietly rotated the vehicle would be a second one.
import { cross, flightRcs, norm } from './FlightAbi.js';
import type { RcsRow, Vec3 } from './FlightAbi.js';
import type { FlightSession } from './FlightSession.js';

/**
 * What the RCS is doing, RE-READ FROM /core on every call and never cached.
 *
 * `deliveredN` is written by the step and by nothing else, so a client mirror
 * of it would read as a working thruster on an empty tank, which is R44a's
 * shape exactly. It is a free function rather than a `FlightSession` getter
 * because that file is already over the 400 line cap (R53) and this lane is
 * not the one that gets to make that worse.
 */
export function rcsOf(s: FlightSession): RcsRow {
  return flightRcs(s.core, s.handle);
}

/** Which way a key pushes, in the vessel frame: +Y is the nose, +X is right,
 *  +Z is `cross(forward, right)`. */
export interface RcsIntent {
  /** +1 toward the nose, -1 toward the tail. */
  fore: number;
  /** +1 to the vessel's right. */
  right: number;
  /** +1 along `cross(forward, right)`. */
  up: number;
}

export const RCS_NONE: RcsIntent = { fore: 0, right: 0, up: 0 };

/**
 * Turn a vessel-frame intent into `/core`'s inertial command, and write it.
 *
 * CALLED EVERY TICK, ZERO INCLUDED. `rcsTranslate` is STATE on the far side,
 * exactly like the throttle, so a client that only writes it while a key is
 * held would leave the thrusters on for ever the moment the key came up. The
 * caller does not get to decide that; this function is the only writer, and it
 * writes on every call.
 *
 * THE MAGNITUDE IS NORMALISED, so pressing two keys at once is a diagonal at
 * FULL throttle and not at 1.414 of it. `flight.h` would clamp a longer vector
 * anyway, and letting it do so would make the diagonal 41% weaker per axis
 * than the straight push, which is a control that behaves differently
 * depending on how many keys are down.
 */
export function applyRcs(s: FlightSession, i: RcsIntent): void {
  if (s.handle <= 0) return;
  if (i.fore === 0 && i.right === 0 && i.up === 0) {
    s.V._of_fl_rcs_translate(s.handle, 0, 0, 0);
    return;
  }
  const f = norm(s.state.forward);
  const r = norm(s.state.right);
  const u = cross(f, r);
  const v: Vec3 = [
    f[0] * i.fore + r[0] * i.right + u[0] * i.up,
    f[1] * i.fore + r[1] * i.right + u[1] * i.up,
    f[2] * i.fore + r[2] * i.right + u[2] * i.up,
  ];
  const n = norm(v);
  s.V._of_fl_rcs_translate(s.handle, n[0], n[1], n[2]);
}

/**
 * The sentence for a press that will do nothing, or '' when it will work.
 *
 * IT IS A REFUSAL WITH A REASON AND NOT A DEAD KEY. Three different states
 * make an RCS key do nothing and they need three different sentences: no
 * blocks fitted, no monopropellant, and not flying. A control that is silently
 * inert is the shape this project keeps paying for (R15), and the player's own
 * fix is different in each case: go back to the bay, refuel, or board.
 */
export function rcsRefusal(s: FlightSession): string {
  if (s.handle <= 0) return 'no vessel';
  const r = rcsOf(s);
  if (r.availableN > 0) return '';
  if (r.monopropKg > 0) return 'no RCS blocks fitted: add one in the bay';
  return 'out of monopropellant';
}
