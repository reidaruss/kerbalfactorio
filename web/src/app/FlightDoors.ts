// THE DOORS: how a vessel arrives, how you get in, and the two ways out.
//
// Free functions over the mode rather than a second class, which is the shape
// FlightPad.ts, FlightDock.ts, FlightAuto.ts and FlightRecover.ts already use in
// this directory. FlightMode keeps a one-line delegate for each of these under
// its own name, because that name is what DebugFlight.ts and the probe corpus
// call; nothing here is reachable except through it.
//
// `climbIn` is NOT exported and is not on the class either: it was private, and
// its only two callers, `board` and `takeControlRemote`, are both in this file.

import type { Vec3 } from '../sim/FlightAbi.js';
import { len, norm } from '../sim/FlightAbi.js';
import { horizonFrame } from '../sim/FlightAttitude.js';
import { allowSave } from '../sim/SaveInhibit.js';
import { choosePad, rollOutOnPad } from './FlightPad.js';
import { labelOf } from '../player/Bindings.js';
import { registry } from '../sim/VesselRegistry.js';
import { mayLeave, whyNotLeave } from './ResumeBoot.js';
import { releaseControl, syncPromoted } from './FlightVessels.js';
import {
  evaStandPoint, installVesselFreefall, removeVesselFreefall,
} from '../game/VesselGravity.js';
import type { FlightMode } from './FlightMode.js';

/** How close the player must stand to a vessel to climb aboard, metres. */
export const BOARD_RANGE_M = 18;
/** Beyond this the live vessel counts as abandoned and G rolls out a new one. */
const ABANDON_RANGE_M = 200;
/** How far in front of the player a rolled-out vessel is planted, metres. It is
 *  deliberately outside BOARD_RANGE_M: you WALK to your rocket. */
const PAD_AHEAD_M = 26;
/**
 * THE TWO THINGS THE PLAYER IS OWED, said in words rather than left to be
 * discovered (physics R11 and R12): a stand-in that ANNOUNCES itself is a
 * stand-in, and a flight that is not in the save says so for as long as it is
 * true. `FlightPad.PAD_NOTE` makes the same argument from the pad's side.
 */
const ROLLOUT_NOTE =
  'ROLL-OUT (stand-in for DW-29\'s launch pad): rocket 26 m ahead, walk to it and press G';

/**
 * ONE key, three meanings, decided by where you are standing. DW-29's actual
 * entrance is a launch pad gated behind ground progression and that does not
 * exist at any layer (gameplay R9, an Admin sequencing call), so roll-out is
 * the honest stand-in: it puts the vessel you designed on the ground in front
 * of you and says so.
 */
export function board(m: FlightMode): void {
  if (m.aboard) {
    // PH-110. TWO DOORS OUT, AND THE VESSEL CHOOSES, NOT THE KEY.
    //
    // `disembark` is climbing out onto the ground and its guard is right for
    // that: it refuses above 2 m/s because a walker cannot survive stepping
    // out at 2.3 km/s. In orbit that guard reads the state vector, sees
    // 7.8 km/s, and refuses -- which is the correct answer to the question it
    // is asking and the wrong answer to the one the player is asking.
    //
    // So this is a door BESIDE it, exactly as `takeControlRemote` was added
    // beside `board()` rather than by loosening the 18 m range check.
    // `disembark`'s guard is not touched, does not move, and still owns every
    // ground case. `evaOut` has a guard of its own and it is a STRICTER one:
    // `mayLeave`, which is `/core`'s own on-rails predicate, so the only
    // vessel you may push off from is one that is coasting in vacuum on a
    // conic that arithmetic can describe. A vessel under thrust or in
    // atmosphere is `frozen` and both doors refuse it.
    if (m.canEva()) { m.evaOut(); return; }
    m.disembark(); return;
  }
  if (!m.session.live) { m.rollOut(); return; }
  const d = m.distanceToVessel();
  if (d <= BOARD_RANGE_M) { climbIn(m); return; }
  // Between "in reach" and "clearly abandoned" the key must NOT quietly build
  // a second rocket on top of the first. It says how far away the one you
  // already have is, which is the only answer that is never surprising.
  if (d <= ABANDON_RANGE_M) { m.refuse(`vessel is ${d.toFixed(0)} m away`); return; }
  m.rollOut();
}

/** GP-54. The bay's launch control, shared by its button and by the launch
 *  key pressed inside it so the two cannot drift apart. Here because the only
 *  question it asks is `aboard`. The refusal does NOT close the bay: shutting
 *  a screen to deliver a message puts the player somewhere they did not ask
 *  to be, and the bay opens mid-flight (probes/flightabuse.js). */
export function fromBay(m: FlightMode, leaveBay: () => void): void {
  if (m.aboard) { m.refuse('already flying: land and get out first'); return; }
  leaveBay();
  m.board();
}

export function rollOut(m: FlightMode): void {
  const design = m.d.designHandle();
  if (design <= 0) { m.refuse('nothing built: press C and build a rocket'); return; }
  // GP-57 / R12. THE PAD IS PREFERRED AND THE STAND-IN IS KEPT, which is a
  // decision rather than a hedge. The argument is in `FlightPad.ts` beside
  // `choosePad`, which is the code it is about.
  const pad = choosePad(m);
  if (pad !== null && rollOutOnPad(m, design, pad)) return;
  const feet = m.d.player.body.feet;
  const r = Math.hypot(feet.x, feet.y, feet.z) || 1;
  const up: Vec3 = [feet.x / r, feet.y / r, feet.z / r];
  // A pad in front of the player, projected back onto the sphere. The offset
  // is an ARC on the ground rather than a straight line, so the pad sits at
  // the same altitude the surface does under it.
  const { east, north } = horizonFrame(up);
  const a = m.d.player.view.yaw;
  const ahead: Vec3 = [
    north[0] * Math.cos(a) + east[0] * Math.sin(a),
    north[1] * Math.cos(a) + east[1] * Math.sin(a),
    north[2] * Math.cos(a) + east[2] * Math.sin(a),
  ];
  const t = PAD_AHEAD_M / m.d.bodyRadiusM;
  const dir = norm([up[0] + ahead[0] * t, up[1] + ahead[1] * t, up[2] + ahead[2] * t]);
  if (!m.session.rollOut(design, dir)) { m.refusals += 1; return; }
  // A stand-in roll-out CLEARS the pad state, or the report would still be
  // describing the launch before this one.
  m.padInUse = null;
  m.padSocketGapM = -1;
  m.rollouts += 1;
  m.drawnRevision = -1;
  m.rebuild();
  // PH-31: seed the interpolator NOW. Nothing steps the observer until
  // somebody is aboard, so without this the rocket is drawn at the body
  // centre for the whole walk over to it.
  m.observer.syncToVessel();
  m.flash(ROLLOUT_NOTE);
}

/**
 * PH-76. TAKE CONTROL OF THE PROMOTED VESSEL FROM ANY DISTANCE.
 *
 * `board()` gates on `distanceToVessel() <= BOARD_RANGE_M` and that gate is
 * CORRECT and stays: walking up to a rocket standing on the ground is a thing
 * you do with your legs, and a key that seats you into a vehicle two hundred
 * metres away would be a key that lies about where your body is. Nothing here
 * loosens it.
 *
 * It is also the reason a vessel in orbit could never be re-entered. The one
 * you left is 100 to 700 km up, so the range test can only ever refuse, and
 * past ABANDON_RANGE_M the same key quietly ROLLS OUT A SECOND ROCKET on top
 * of the first. That is not a handoff, it is a duplicate.
 *
 * So the remote path is a SEPARATE VERB rather than a widened gate. It is not
 * reachable from the board key at all: it is reached from `resumeControl`,
 * which has already established that the record exists and has already been
 * promoted into a live session. Everything else it does is `climbIn` verbatim,
 * because "the player is flying this vessel" must mean exactly one thing
 * whichever door it was entered by.
 *
 * The BODY IS NOT MOVED, which is the same decision `releaseControl` makes in
 * the other direction (FlightVessels.ts): the walker stayed where it parked
 * (PH-68) and the camera simply goes to the rocket.
 */
export function takeControlRemote(m: FlightMode): boolean {
  if (m.aboard) return true;
  // A seat in a vessel that does not exist is the exact state `reload.mjs`
  // carries a standing assertion against. Refusing is the only safe answer.
  if (!m.session.live) { m.refuse('no vessel to take control of'); return false; }
  climbIn(m);
  return true;
}

function climbIn(m: FlightMode): void {
  // PH-110. The spacewalk is over the moment the hatch shuts, and the volume
  // goes with it. Left behind it would be a 60 m bubble of freefall parked at
  // wherever the rocket happened to be, which would silently switch gravity
  // off for anyone who later walked through that patch of sky. Idempotent, so
  // the ordinary ground boarding pays nothing for this line.
  removeVesselFreefall();
  m.aboard = true;
  m.boardings += 1;
  m.observer.yaw = 0;
  m.observer.pitch = 0.22;
  // Before `setSource`, which pulls the eye immediately: a stale
  // `observer.position` puts the camera at the planet's centre for one frame.
  m.observer.syncToVessel();
  m.d.router.setSource(m.observer);
  m.navball.setVisible(true);
  m.d.setWorldUi(false);
  // PH-30's save refusal is RETIRED here (PH-67). It existed because the slot
  // had no field for a vessel, so a save written in orbit was a valid GROUND
  // state that silently deleted the flight. The slot has that field now and
  // `saveVessels` syncs the live sim into it before every write, so the honest
  // move is to let the save happen. `FlightReadout` says what a reload still
  // does NOT restore, which is the player being strapped in.
  m.flash('aboard: Space stages, Shift throttles up, WASD flies, '
    + `${labelOf('recover')} clears the pad`);
}

/**
 * PH-110, R54. May the player push off from this vessel and float beside it?
 *
 * The predicate is `/core`'s, through `mayLeave`, and it is asked of a record
 * that has just been SYNCED. `makeRecord` stamps `mode: 'parked'` at roll-out
 * and `modeOf` only rewrites it from the live sim, so an unsynced guard would
 * wave a rocket away under full thrust: PH-69 pays for that lesson already and
 * `leaveVessel` calls `syncPromoted` before consulting it for exactly this
 * reason. The sync happens in `evaOut`, and this predicate is deliberately
 * cheap and read-only so `board()` can ask it without side effects.
 *
 * Also refused on the ground, which `mayLeave` alone would NOT catch: a vessel
 * standing on the pad is `parked`, which `mayLeave` permits, and turning a pad
 * disembark into a spacewalk would be absurd. `CLAMPED`/`DOWN` is the same
 * discriminator `disembark` uses for its own airborne test, read the same way.
 */
export function canEva(m: FlightMode): boolean {
  if (!m.aboard || !m.session.live) return false;
  const rec = registry.promoted;
  if (rec === null) return false;
  const onGround = m.session.status === 'CLAMPED' || m.session.status === 'DOWN';
  return !onGround && m.session.onRails();
}

/**
 * PH-110, R54. GET OUT HERE, and keep the rocket.
 *
 * Three things happen and the ORDER is the whole of it.
 *
 *   1. SYNC, then guard. See `canEva`.
 *   2. Place the body BEFORE releasing the seat. `releaseControl` sets
 *      `aboard = false`, which re-arms the on-foot HUD, the build ghost and
 *      the walker's own step; a body still parked at the launch pad for even
 *      one tick of that is a player standing on the ground with a navball
 *      shutting behind them.
 *   3. Install the freefall volume BEFORE the first tick the walker owns, or
 *      that tick reads `gravityAccel(r)` at 8.6 m/s^2 and starts a 200 km
 *      fall. `installVesselFreefall` is called from here rather than from
 *      `KinematicBody`, because the walker reaches gravity through a PORT and
 *      must never learn what a vessel is.
 *
 * The vessel is NOT demoted. `demoteVessel` destroys the `/core` FlightSim and
 * disposes the design, and a rocket you cannot see is not a rocket you can
 * EVA around. It stays promoted, live and drawn, and it does not move, because
 * nothing steps a promoted vessel while nobody is aboard (VesselGravity.ts
 * header). Climbing back in is the ordinary `board()` at 18 m.
 */
export function evaOut(m: FlightMode): boolean {
  if (!m.aboard || !m.session.live) return false;
  const rec = registry.promoted;
  if (rec === null) { m.refuse('no vessel to leave'); return false; }
  syncPromoted(m, m.session.fixedTick);
  if (!mayLeave(rec)) { m.refuse(whyNotLeave(rec)); return false; }
  if (!m.canEva()) { m.refuse('cannot spacewalk from here'); return false; }

  // UN-STAMP THE RECORD, AND THIS LINE IS THE WHOLE OF PH-111.
  //
  // The first driven run of `probes/eva.js` failed E4 with the vessel 6829.55
  // m away after three seconds, against 6867.76 m of "what it would be at
  // orbital speed". That looked like the blocker everyone expected and it was
  // not: `VesselObserver.step` is where `flight.step(dt)` is called, the
  // observer is only stepped while it is the router's source, so THE LIVE SIM
  // GENUINELY DOES NOT ADVANCE while nobody is aboard. What advanced was the
  // RECORD. `syncPromoted` stamps it, and a stamped record's `clockAt` runs
  // with the world clock, so `stateOf` kept solving the conic forward while
  // the thing it describes sat still. (The 0.6% between the two figures is the
  // conic's arc against a straight-line chord, which is the tell.)
  //
  // Two authorities for one rocket, and they had drifted 6.8 km apart in three
  // seconds: the map would draw the marker somewhere the player is not, and
  // the next demote/promote would teleport the hull there.
  //
  // `stampedTick = -1` is exactly what `mintStation` does and for exactly the
  // same reason (SpaceStation.ts: "NEVER STAMPED, WHICH IS WHAT MAKES THE
  // FREEZE HONEST rather than a second authority"). An unstamped record does
  // not advance, so the frozen sim and the derived conic position are THE SAME
  // NUMBER BY CONSTRUCTION and cannot come apart. The next `syncPromoted`
  // after the player climbs back in re-stamps it and the vessel resumes.
  rec.stampedTick = -1;

  const p = m.session.state.pos;
  const stand = evaStandPoint([p[0], p[1], p[2]], m.session.baseOffsetM);
  const r = Math.hypot(p[0], p[1], p[2]);
  // The ONE gravity authority, at the vessel's own radius. A body on a free
  // trajectory accelerates at exactly the local g, which is the entire reason
  // its occupants have no weight (GravityPort.ts).
  // `oracle.body.gravityAccel` is the SAME call `KinematicBody` makes for the
  // walker's own weight, reached the same way. Not a second gravity, and not
  // a new port on `FlightDeps`: standing rule 1.
  installVesselFreefall(stand, m.d.oracle.body.gravityAccel(r));
  m.d.player.standAt(stand[0], stand[1], stand[2]);
  releaseControl(m);
  m.evas += 1;
  m.flash('EVA: WASD thrusts, Space and Shift for up and down, '
    + `${labelOf('board')} to get back in`);
  return true;
}

/** The reverse MUST work or a player who lands is stuck. It is refused only
 *  while actually moving, which is the one case a walker cannot survive. */
export function disembark(m: FlightMode): void {
  if (!m.aboard) return;
  // The STATE's velocity, not the telemetry's: telemetry is only written by
  // `of_fl_step`, so after an arrest it still reports the impact speed and
  // the hatch would stay locked on a vessel standing perfectly still.
  const moving = len(m.session.state.vel) > 2.0;
  const airborne = m.session.status !== 'CLAMPED' && m.session.status !== 'DOWN';
  if (moving || (airborne && m.session.altitudeAglM > 5)) {
    m.refuse('cannot get out in flight');
    return;
  }
  const p = m.session.state.pos;
  const r = len(p) || 1;
  const ll = m.d.oracle.latLonFromDir(p[0] / r, p[1] / r, p[2] / r);
  // A few metres to the side, so the player is not standing inside the hull.
  const off = 8 / m.d.bodyRadiusM;
  m.d.player.teleport(((ll.lat + off) * 180) / Math.PI,
                         (ll.lon * 180) / Math.PI, 0);
  m.aboard = false;
  m.disembarks += 1;
  m.d.router.setSource(null);
  m.navball.setVisible(false);
  m.d.setWorldUi(true);
  // The world is describable again, so the next autosave writes the state the
  // player is actually standing in. A vessel PARKED here is still not in the
  // slot, and that is a key press to put back rather than a lost world.
  allowSave();
  m.flash('back on the ground (the parked rocket is not saved; press G to roll out a new one)');
}

/**
 * TO THE VESSEL'S BASE, NOT ITS ORIGIN (PH-32). The origin is the TOP of the
 * stack (`FlightSession.rollOut`), so measuring to it adds the whole rocket's
 * height to the distance of a player standing at its feet. With an 18 m
 * boarding range that means ANY vehicle taller than 18 m can never be
 * boarded: G answers "vessel is 24 m away" from the base, walking closer
 * cannot help, and past 200 m it rolls out a second one. The reference
 * fixture is 9.6 m of offset so every probe passes; the first player to add a
 * tank hits a wall with no diagnostic. `frameFor`/`midOffsetM` already knew
 * about this offset in the camera and the range check did not.
 */
export function distanceToVessel(m: FlightMode): number {
  const feet = m.d.player.body.feet;
  const p = m.session.state.pos;
  const r = Math.hypot(p[0], p[1], p[2]) || 1;
  const b = m.session.baseOffsetM;
  return Math.hypot(feet.x - (p[0] - (p[0] / r) * b),
                    feet.y - (p[1] - (p[1] / r) * b),
                    feet.z - (p[2] - (p[2] / r) * b));
}
