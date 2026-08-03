// SAS: what the attitude keys mean, and the one place a mode may change.
//
// Split out of FlightSession.ts along a seam that file's own header names. It
// says it does three jobs: hold the /core flight handle, hold the launch clamp,
// and hold "the control state a player's keys move". This is the third one, and
// it is the only one of the three that is a MODE MACHINE: every entry point here
// either sets `sasMode` or aims `command`, and the reason they belong together
// is that each of them can silently undo another.
//
// THE PH-44 BUG IS THE ARGUMENT FOR THE FILE. Roll used to route through
// `commandDirection`, which switches to Command mode as a side effect, so any
// roll input dropped a vessel out of Prograde hold without saying so. That is
// only visible if the four transitions are read together; scattered through a
// 450 line session class they read as four unrelated helpers.
//
// These are free functions over a `FlightSession` rather than a class of their
// own, because the state they move (`sasMode`, `command`, the live state row)
// is read by the report, the navball and the map, and giving it a second owner
// would be a second thing that can disagree about which way the nose is
// pointing.

import { SAS_COMMAND, SAS_PROGRADE, SAS_RETROGRADE, add, guidancePitch, norm,
  rotateAbout, scale } from './FlightAbi.js';
import type { Vec3 } from './FlightAbi.js';
import {
  holdRoll, horizonFrame, rollAngle, rollDefined, slewCommand,
} from './FlightAttitude.js';
import type { FlightSession } from './FlightSession.js';

/** How fast SAS takes roll back out. Slower than the player's own roll rate, so
 *  a deliberate roll wins while the key is held. */
const ROLL_HOLD_DEG_S = 20;

/** Slew in the LOCAL HORIZON FRAME. pitch > 0 lowers the nose, yaw > 0 turns
 *  right, roll > 0 rolls right. */
export function slew(s: FlightSession, pitchRad: number, yawRad: number,
                     rollRad: number): void {
  if (s.handle <= 0) return;
  // ROLL IS NOT A COMMAND (PH-44): through commandDirection it dropped a
  // vessel out of PRO into CMD on any roll input, silently.
  if (pitchRad !== 0 || yawRad !== 0) {
    commandDirection(s, slewCommand(s.command, s.up, pitchRad, yawRad));
  }
  if (rollRad !== 0) {
    const rr = rotateAbout(norm(s.st.right), norm(s.st.forward), rollRad);
    s.V._of_fl_set_attitude(s.handle, s.st.forward[0], s.st.forward[1],
                            s.st.forward[2], rr[0], rr[1], rr[2]);
  }
}

/** Every mode change goes through here, and every one SAYS SO. */
export function setSas(s: FlightSession, mode: number): void {
  if (s.handle <= 0) return;
  s.sasMode = mode;
  s.V._of_fl_set_sas(s.handle, mode);
  if (mode === SAS_COMMAND) commandDirection(s, norm(s.st.forward));
  s.flash(`SAS ${s.sasName}`);
}

/** Point SAS at an inertial direction, switching to Command if needed. This IS
 *  hold-node: a node's burn direction is fixed in inertial space, so /core needs
 *  no Maneuver mode and the caller refreshes it as handles move. */
export function commandDirection(s: FlightSession, dir: Vec3): void {
  if (s.handle <= 0) return;
  s.command = norm(dir);
  if (s.sasMode !== SAS_COMMAND) {
    s.sasMode = SAS_COMMAND;
    s.V._of_fl_set_sas(s.handle, SAS_COMMAND);
  }
  s.V._of_fl_set_sas_command(s.handle, s.command[0], s.command[1], s.command[2]);
}

/** Command / Prograde / Retrograde, in that cycle. DW-30 item 2. The seven mode
 *  KEYS are direct (Bindings' digit row); this is the one-key cycle. */
export function cycleSas(s: FlightSession): void {
  setSas(s, s.sasMode === SAS_COMMAND ? SAS_PROGRADE
    : s.sasMode === SAS_PROGRADE ? SAS_RETROGRADE : SAS_COMMAND);
}

/**
 * Stability assist's third axis (FlightAttitude.holdRoll).
 *
 * R73. IT MEASURES BEFORE IT CORRECTS, and that is the whole of this change.
 *
 * This function rewrites `right` every tick, so for months it was repairing the
 * only signal that could have shown a 41.98 deg/s roll instability in the sim
 * (PH-165 to PH-169). Nobody was hiding anything: the damper was doing its job
 * and its job happens to destroy the evidence. **An instrument that silently
 * repairs its own input cannot report on it**, which is why the reading is
 * taken FIRST and published whether or not a correction follows.
 *
 * `rollBeforeHoldDeg` is what the navball would show with no damper, and
 * `rollHeldDegS` is how hard the damper is working. A vessel whose held rate
 * sits near the `ROLL_HOLD_DEG_S` ceiling is one the damper is losing to, which
 * is a real condition (an asymmetric rocket makes 5.55 deg/s) and one nothing
 * could previously distinguish from a vessel flying straight.
 */
export function levelWings(s: FlightSession, dt: number): void {
  if (s.sasName === 'OFF' || s.handle <= 0) return;
  // FIRST, AND UNCONDITIONALLY. Reading after the correction, or only when a
  // correction happens, reproduces the concealment in a smaller form.
  s.rollBeforeHoldDeg = rollDefined(s.st.forward, s.up)
    ? rollAngle(s.st.forward, s.st.right, s.up) * (180 / Math.PI) : NaN;
  const r = holdRoll(s.st.forward, s.st.right, s.up,
                     ROLL_HOLD_DEG_S * (Math.PI / 180) * dt);
  if (r === s.st.right) { s.rollHeldDegS = 0; return; }
  // How much roll the damper took out this tick, as a RATE, so it is
  // comparable with the ceiling and with physics' own 5.55 deg/s figure rather
  // than being a per-tick angle nobody can size.
  const after = rollDefined(s.st.forward, s.up)
    ? rollAngle(s.st.forward, r, s.up) * (180 / Math.PI) : NaN;
  s.rollHeldDegS = dt > 0 && Number.isFinite(after)
    && Number.isFinite(s.rollBeforeHoldDeg)
    ? Math.abs(s.rollBeforeHoldDeg - after) / dt : 0;
  const f = s.st.forward;
  s.V._of_fl_set_attitude(s.handle, f[0], f[1], f[2], r[0], r[1], r[2]);
  s.st.right = r;
}

/**
 * WHERE THE ASCENT RIBBON SAYS TO POINT, or null with no vessel.
 *
 * Here rather than on the session because it is a STEERING answer and this file
 * is where steering lives: it is the direction `setSas`/`commandDirection` are
 * given when a player follows the ribbon, and reading it beside them is what
 * makes "the marker and the mode agree" checkable. It is fed the altitude ABOVE
 * THE PAD (DW-30 item 6), not the datum altitude, so a pad on a plateau flies
 * the same profile as one at sea level.
 */
export function guidanceDir(s: FlightSession): Vec3 | null {
  if (s.handle <= 0) return null;
  const g = guidancePitch(s.core, Math.max(0, s.altitudeAglM));
  const u = s.up;
  const p = g.pitchFromVerticalRad;
  return norm(add(scale(u, Math.cos(p)), horizonFrame(u).east, Math.sin(p)));
}
