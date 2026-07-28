// GP-57. EVERYTHING FLIGHT KNOWS ABOUT DW-29'S LAUNCH PAD, in one file.
//
// Split out of FlightMode.ts, and the line the split follows is worth stating
// because it is not "the file was long". FlightMode is the wiring between the
// session, the observer, the view and the navball; the pad is a second system
// entirely, owned by the gameplay layer, that flight happens to hand a rocket
// to. Every question in here is asked of `LaunchPads` and answered in the pad's
// own terms: is there one near your feet, where does its socket say the vessel
// stands, and have its clamps let go yet. None of it is flight wiring.
//
// THE PAD IS OPTIONAL AND THAT IS LOAD-BEARING, which is why these are free
// functions over the mode rather than a class. `FlightDeps.pads` is a thunk
// that may be absent (a boot with no gameplay) or return null, so every entry
// point below starts by asking and returns without complaint when the answer is
// nothing. `?gameplay=0` still flies, on FlightMode's stand-in.
//
// A few of FlightMode's members are public purely so this file can drive them
// (`d`, `flash`, `rebuild`, `drawnRevision`); each is commented as such there.

import { watchVessels } from './FlightVessels.js';
import type { Vec3 } from '../sim/FlightAbi.js';
import type { PadPart } from '../game/LaunchPad.js';
import type { FlightMode } from './FlightMode.js';

/**
 * GP-57. What a roll-out says once there IS a pad.
 *
 * The two notes are different sentences on purpose. A stand-in that announces
 * itself is a stand-in and one that does not is a broken feature (PH-36), and
 * the corollary nobody had needed yet is that the REAL thing has to announce
 * itself too: a player who has just spent 1,440 Stone and 60 Iron on a launch
 * site would otherwise get the identical message they got before they built it,
 * with no way to tell whether any of it did anything.
 */
const PAD_NOTE =
  'ROLL-OUT: on the launch pad, held by the clamps. Walk over and press G to board';
/** How far from a pad's centre a roll-out will still choose that pad, metres.
 *  A pad is 24 m across, so half a span plus a cell is "standing on or beside
 *  the thing", and a player who has walked off to the far side of their base is
 *  asking for the stand-in rather than being denied their pad. */
const PAD_CHOOSE_M = 28;

/**
 * GP-57 / R12. THE PAD IS PREFERRED AND THE STAND-IN IS KEPT, and that is a
 * decision rather than a hedge.
 *
 * DW-29's own sequencing is "reaching orbit is a MANUAL skill first ... the
 * first flights are hand-flown", and the pad is gated behind Electrification
 * plus 1,440 Stone of platform. Making flight IMPOSSIBLE until all of that is
 * paid would mean a player cannot test a rocket at all until they have
 * finished the ground game, which inverts the arc DW-29 asks for: you would
 * be automating in order to earn the right to learn to fly. So the stand-in
 * stays as the entry ramp and the pad is what you graduate to.
 *
 * WHAT STOPS THAT MAKING THE PAD COSMETIC is that the two paths do not look
 * or read alike. A pad launch is anchored on a saved, chosen, permanent
 * `socket_vessel` over a flame trench with four clamps that hold and let go;
 * the stand-in plants the rocket 26 m in front of wherever you happen to be
 * looking and SAYS IN THOSE WORDS that it is standing in for a launch pad.
 * A player who builds one sees the difference in the first sentence.
 */
export function choosePad(m: FlightMode): PadPart | null {
  const pads = m.d.pads?.() ?? null;
  if (pads === null || pads.list.length === 0) return null;
  const feet = m.d.player.body.feet;
  return pads.nearest({ x: feet.x, y: feet.y, z: feet.z }, PAD_CHOOSE_M);
}

/**
 * Roll out ONTO the pad, at its published `socket_vessel`.
 *
 * THE ANCHOR IS THE SOCKET AND NOTHING IS RE-DERIVED FROM IT. The pad hands
 * back a body-frame point (its own origin plus its own up times the socket's
 * own height, all measured off the shipped .glb), this turns it into a
 * direction and a radius, and `FlightSession.rollOut` puts the vessel's BASE
 * at exactly that radius along exactly that direction. There is no "pad height
 * constant" anywhere in the flight path, which is the whole reason the offset
 * below can be MEASURED rather than assumed: the two systems compute the same
 * point by different routes and the gap between them is a real number.
 *
 * `socket_vessel`'s quaternion is byte-identical to
 * `LiquidTankSmall/socket_stack_top`, so a rocket meeting this pad is meeting
 * the same contract it meets when a tank is stacked on a tank.
 */
export function rollOutOnPad(m: FlightMode, design: number, pad: PadPart): boolean {
  const pads = m.d.pads?.() ?? null;
  if (pads === null) return false;
  const a = pads.vesselAnchor(pad, { x: 0, y: 0, z: 0 });
  const r = Math.hypot(a.x, a.y, a.z);
  if (!(r > 0)) return false;
  const dir: Vec3 = [a.x / r, a.y / r, a.z / r];
  if (!m.session.rollOut(design, dir, r)) { m.refusals += 1; return false; }
  // The clamps go back ON. A fresh roll-out onto a pad whose arms were left
  // swung open from the last launch would show a rocket standing in an open
  // gantry, which is a picture of a state the game is not in.
  pads.reclamp(pad);
  pad.rollouts += 1;
  m.padInUse = pad;
  m.padRollouts += 1;
  m.rollouts += 1;
  m.drawnRevision = -1;
  m.rebuild();
  m.observer.syncToVessel();
  // MEASURED, not asserted. The vessel's base is derived back out of the sim's
  // own reported position (the origin is the TOP of the stack, so the base is
  // `baseOffsetM` below it along the radial) and differenced against the pad's
  // socket. Anything but a floating-point residue here means the two systems
  // disagree about where the rocket is standing, and that is exactly the class
  // of thing that is invisible until somebody looks at a screenshot.
  const p = m.session.state.pos;
  const pr = Math.hypot(p[0], p[1], p[2]) || 1;
  const b = m.session.baseOffsetM;
  m.padSocketGapM = Math.hypot(
    p[0] - (p[0] / pr) * b - a.x,
    p[1] - (p[1] / pr) * b - a.y,
    p[2] - (p[2] / pr) * b - a.z);
  m.flash(PAD_NOTE);
  return true;
}

/**
 * GP-57. THE PAD'S CLAMPS LET GO AT THE INSTANT THE LAUNCH CLAMP DOES.
 *
 * Called once per FIXED tick, from the same place the rest of the fixed step
 * runs, and given that tick's index. It watches `FlightSession.releases`, a
 * counter the sim bumps inside `tryRelease` when TWR crosses 1, rather than
 * being called by `tryRelease` directly: a direct call would make the two
 * fire together BY CONSTRUCTION and there would be nothing left to assert.
 * This way the pad records its own release tick from its own caller and the
 * two numbers can genuinely disagree, which is what makes comparing them a
 * test rather than a tautology.
 *
 * Per TICK and not per FRAME, and that is the load-bearing half. A frame
 * carries one to three fixed ticks, so a per-frame watcher would fire the
 * clamps up to two ticks late and every instrument would still read "they
 * both happened", because 33 ms is invisible. The tick index is the only
 * clock fine enough to state the claim.
 */
export function stepPadClamps(m: FlightMode, tick: number): void {
  // PH-64. The vessel registry rides this call, which is the ONE flight call the
  // loop already makes whether or not anybody is aboard (`Systems.ts`), and is
  // therefore the only per-tick seam the flight lane owns outright. It is one
  // integer compare on the common path. Placed ABOVE the early returns below,
  // because a roll-out with no pad is still a vessel that must be registered.
  watchVessels(m, tick);
  const pads = m.d.pads?.() ?? null;
  const pad = m.padInUse;
  if (pads === null || pad === null) return;
  if (m.session.releases > 0 && !m.session.clamped) {
    pads.release(pad, tick);
  }
}

/**
 * GP-57. THE NUMBERS THE PAD IS JUDGED ON, published rather than inferred:
 * whether this roll-out used a pad at all, how far the vessel's base landed
 * from the pad's own published socket, and the two ticks that are supposed to
 * be the same one.
 *
 * Spread into `FlightMode.report()` so the probe-visible shape is unchanged.
 * It lives here for the same reason the rest of the file does: a reader asking
 * what the pad claims should find the claim next to the code that makes it,
 * not in a report block eighty lines away from it.
 */
export function padReport(m: FlightMode): Record<string, unknown> {
  return {
    onPad: m.session.onPad,
    padRollouts: m.padRollouts,
    padSocketGapM: m.padSocketGapM,
    // The radius the vessel's BASE was put at. On a pad launch it is the
    // pad's own socket; on a stand-in launch it is the ground. Published
    // because that difference is the whole feature and is otherwise invisible.
    padRadiusM: m.session.padRadiusM,
    padId: m.padInUse?.id ?? -1,
    clampReleases: m.session.releases,
    clampReleasedAtTick: m.session.releasedAtTick,
    padReleasedAtTick: m.padInUse?.releasedAtTick ?? -1,
    padClampT: m.padInUse?.clampT ?? -1,
  };
}
