// Keys -> flight intents. The ONLY place a flight input is interpreted.
//
// Every read goes through `Input.act(action)` and never through a key code, for
// the reason Bindings.ts states: a probe that presses `stage` survives the next
// remap and one that presses Space has to be found. That matters more here than
// anywhere else in the client, because the whole milestone is verified by a
// scripted pilot and a probe that silently stopped pressing anything would
// report a beautiful flat trajectory from a rocket that never left the pad.
//
// The player commands an ATTITUDE, not a torque. Pitch and yaw slew a commanded
// direction at a bounded rate and stability assist holds it (DW-30 item 2, on by
// default from the first flight). Two reasons, both design: a keyboard cannot
// meter a torque, and an attitude command is what makes the guidance ribbon
// flyable, because "put the nose on the marker" is then one held key rather than
// a damped chase.

import type { Input } from './Input.js';
import type { Action } from './Bindings.js';
import { FLIGHT_ROLL_DEG_S, FLIGHT_SLEW_DEG_S } from '../sim/FlightSession.js';
import type { FlightSession } from '../sim/FlightSession.js';
import {
  SAS_ANTINORMAL, SAS_COMMAND, SAS_HOLD, SAS_NORMAL, SAS_OFF, SAS_PROGRADE,
  SAS_RADIAL_IN, SAS_RADIAL_OUT, SAS_RETROGRADE,
} from '../sim/FlightAbi.js';

const DEG = Math.PI / 180;

/**
 * The SAS mode buttons, as keys. Reid asked for buttons; a pilot wants keys;
 * both exist and they go through the same one call, `FlightSession.setSas`, so
 * a button and a key cannot come to mean different things.
 *
 * `sasNode` is not in this table because it is not a MODE: hold-node is
 * SAS_COMMAND pointed at the node's published burn direction, and only the map
 * knows where that is. Its key is routed by MapMode.
 */
const SAS_KEYS: readonly (readonly [Action, number])[] = [
  ['sasStability', SAS_HOLD],
  ['sasPrograde', SAS_PROGRADE],
  ['sasRetrograde', SAS_RETROGRADE],
  ['sasNormal', SAS_NORMAL],
  ['sasAntinormal', SAS_ANTINORMAL],
  ['sasRadialIn', SAS_RADIAL_IN],
  ['sasRadialOut', SAS_RADIAL_OUT],
];
/** Throttle travel per second while the key is held. Full swing in 2 seconds,
 *  which is fast enough to abort and slow enough to set 60% by ear. */
const THROTTLE_RATE = 0.5;

const EDGE: readonly Action[] = [
  'stage', 'sasToggle', 'sasMode', 'warpUp', 'warpDown',
  'throttleFull', 'throttleCut',
  ...SAS_KEYS.map(([a]) => a),
];

export class FlightControls {
  /** Per-action counts of PRESSES this session. The probe's proof that a key it
   *  sent actually arrived, which twenty green probes once failed to show. */
  readonly presses = new Map<Action, number>();

  private readonly held = new Map<Action, boolean>();

  constructor(private readonly input: Input) {
    for (const a of EDGE) this.held.set(a, false);
  }

  /** One fixed tick of control. Call BEFORE stepping the session. */
  step(f: FlightSession, dt: number): void {
    const held = (a: Action): boolean => this.input.act(a);
    const pressed = (a: Action): boolean => {
      const on = this.input.act(a);
      const was = this.held.get(a) ?? false;
      this.held.set(a, on);
      if (on && !was) {
        this.presses.set(a, (this.presses.get(a) ?? 0) + 1);
        return true;
      }
      return false;
    };

    // Throttle. Held keys ramp, the two absolutes snap.
    if (held('throttleUp')) f.nudgeThrottle(THROTTLE_RATE * dt);
    if (held('throttleDown')) f.nudgeThrottle(-THROTTLE_RATE * dt);
    if (pressed('throttleFull')) f.setThrottle(1);
    if (pressed('throttleCut')) f.setThrottle(0);

    // Attitude. A commanded direction slewed at a bounded rate, held by SAS.
    // `slew` takes pitch POSITIVE-DOWN (toward the horizon), because that is the
    // direction a gravity turn goes and the direction the ribbon leads.
    let pitch = 0, yaw = 0, roll = 0;
    if (held('pitchDown')) pitch += 1;
    if (held('pitchUp')) pitch -= 1;
    if (held('yawRight')) yaw += 1;
    if (held('yawLeft')) yaw -= 1;
    if (held('rollRight')) roll += 1;
    if (held('rollLeft')) roll -= 1;
    if (pitch !== 0 || yaw !== 0 || roll !== 0) {
      f.slew(pitch * FLIGHT_SLEW_DEG_S * DEG * dt,
             yaw * FLIGHT_SLEW_DEG_S * DEG * dt,
             roll * FLIGHT_ROLL_DEG_S * DEG * dt);
    }

    // The seven mode keys. `setSas` is the one call a button and a key both
    // go through, and it flashes the name, so a mode change is never silent.
    for (const [a, mode] of SAS_KEYS) if (pressed(a)) f.setSas(mode);

    if (pressed('stage')) f.fireStage();
    if (pressed('sasMode')) f.cycleSas();
    if (pressed('sasToggle')) f.setSas(f.sasName === 'OFF' ? SAS_COMMAND : SAS_OFF);
    if (pressed('warpUp')) f.setWarp(f.warpIndex + 1);
    if (pressed('warpDown')) f.setWarp(f.warpIndex - 1);
  }

  report(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [a, n] of this.presses) out[a] = n;
    return out;
  }
}
