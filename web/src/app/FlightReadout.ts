// THE NAVBALL READOUT: a flight session projected into the struct the
// instrument draws, and nothing else.
//
// Split out of FlightMode.ts because it is a different KIND of code. That file
// is wiring plus exactly one decision of its own (what the `board` key means
// where you are standing); this is a pure function of session state with no
// fields, no side effects and nothing to decide. Fifty lines of it sitting in
// the mode made the mode look like it had a second job it does not have.
//
// IT IS A PROJECTION AND NEVER A SECOND AUTHORITY, which is the rule this file
// exists to keep honest. Every number below is read back out of the session,
// the orbit or the save latch; none of it is recomputed here, cached here or
// quietly defaulted to something that reads better. If a figure on the ball
// disagrees with /core, the ball is wrong and this is where it is wrong.
//
// It takes the mode rather than the session because two of the fields are the
// MODE's: `nodeDir`, which MapMode writes so the ball's marker and the map's
// are one direction from one plan, and `message`, whose transient half the
// mode's own frame loop expires.

import { dot, len } from '../sim/FlightAbi.js';
import type { Vec3 } from '../sim/FlightAbi.js';
import { horizonAngles, rollAngle } from '../sim/FlightAttitude.js';
import { saveInhibit } from '../sim/SaveInhibit.js';
import { launchStep } from '../sim/LaunchSteps.js';
import type { NavballReadout, BallMarker } from '../ui/Navball.js';
import type { FlightMode } from './FlightMode.js';

/** Heading and pitch of a unit direction in THE local horizon frame, which is
 *  `FlightAttitude`'s, so the ball, the ribbon and the keys agree on east. */
function marker(dir: Vec3 | null, up: Vec3): BallMarker | null {
  return dir === null ? null : horizonAngles(dir, up);
}

export function readout(m: FlightMode): NavballReadout {
  const s = m.session;
  const st = s.state;
  const tm = s.telemetry;
  const u = s.up;
  const nose = marker(st.forward, u) ?? { headingDeg: 0, pitchDeg: 90 };
  const v = st.vel;
  const speed = len(v);
  const pro = speed > 0.5 ? marker(v, u) : null;
  const retro = pro === null ? null
    : { headingDeg: (pro.headingDeg + 180) % 360, pitchDeg: -pro.pitchDeg };
  const roll = rollAngle(st.forward, st.right, u);
  const next = s.nextStageIndex();
  return {
    headingDeg: nose.headingDeg, pitchDeg: nose.pitchDeg,
    rollDeg: (roll * 180) / Math.PI,
    prograde: pro, retrograde: retro,
    command: marker(s.sasName === 'CMD' ? s.commandDir : null, u),
    guidance: marker(s.guidanceDir(), u),
    node: marker(m.nodeDir, u),
    altitudeM: s.altitudeAglM, altitudeDatumM: tm.altitudeM,
    surfaceSpeedMS: speed, orbitalSpeedMS: speed, verticalSpeedMS: dot(v, u),
    apoapsisM: s.orbit.apoapsisAltM, periapsisM: s.orbit.periapsisAltM,
    // A vehicle on the ground has zero velocity, a perfectly well defined
    // degenerate conic through the planet's centre, so the pad readout was
    // PE -600.00 km: right, and it reads as a broken instrument.
    bound: s.orbit.bound && s.status !== 'CLAMPED' && s.status !== 'DOWN',
    throttle: s.throttleValue,
    stages: s.stageRows.map((q) => ({
      index: q.index, dvVacMS: q.dvVacMS, twr: q.twr, burnS: q.burnS,
      active: q.index === Math.max(0, next - 1),
    })),
    totalDvMS: s.totalDvMS(), remainingDvMS: s.remainingDvMS(),
    sas: s.sasName, status: s.status,
    qPa: tm.qPa, maxQPa: s.maxQPa, twr: s.currentTwr(), massKg: tm.massKg,
    gForce: tm.accelMS2 / 9.80665, metS: Math.max(0, s.metS),
    // From the LATCH first, never repeated from a constant here: a chip that
    // says saving is off while it is on would be a second authority.
    //
    // PH-67. The flight IS saved now, so the old standing chip is gone and the
    // chip that replaces it says the one thing a reload still does NOT restore:
    // you come back on foot, at your body, with the rocket where you left it.
    // It is deliberately not silence. A player who reloads mid-orbit and finds
    // themselves standing at the pad has to have been told, or the feature reads
    // as the bug it used to be.
    warning: saveInhibit() !== '' ? saveInhibit()
      : (m.aboard ? 'reloading returns you to your body on the ground; '
                  + 'the vessel keeps its orbit' : ''),
    // GP-139. Derived every frame from the session, never cached and never
    // reacted to: the sentence it replaces was only produced when a press was
    // refused, so the players who needed it were exactly the ones who never
    // triggered it.
    nextStep: launchStep(s),
    message: s.message !== '' ? s.message : m.message,
  };
}
