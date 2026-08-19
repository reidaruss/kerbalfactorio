// WHAT THE PLAYER WEIGHS, AND THE TWO KNOBS THAT CHANGE IT (GP-1075, split
// out of DebugGameplay.ts under the 400-line cap).
//
// `weight` is the measurement, `stationGravity` is the deck's generator and
// `gravityScale` is the whole world's. The three are one concern because the
// second two exist only to be read through the first: PH-99's argument is that
// "does the walker degrade into a floating body" must be askable with nothing
// else in the room, and PH-103's is that a derelict deck is the same question
// with the room switched off.
//
// `uniform` MOVED WITH `gravityScale`, which is the state rule (BT-276 rule
// 1): it is a module-level instrument that only that one method tunes, so it
// travels with its single writer and the "one per page" guarantee in its
// docstring still means the page.
import { volumes } from '../game/GravityVolumes.js';
import {
  lastStationGravity, setStationGravityPowered, stationGravityPowered,
} from '../game/StationGravity.js';
import { StackedGravity, UniformGravity } from '../player/GravityPort.js';
import { ZEROG } from '../player/ZeroG.js';
import type { Services } from './Services.js';

/** The instrument behind `gravityScale`. One per page, held here so repeated
 *  calls tune the same field rather than stacking a new one every time. */
const uniform = new UniformGravity();

export function gravityApi(s: Services) {
  return {
    /**
     * PH-98. WHAT THE PLAYER WEIGHS, and why.
     *
     * With no argument it reports the feet. With a body-frame point it asks the
     * field about that point WITHOUT moving anybody, which is what lets a probe
     * map the edge of a volume by bisection the same way `solidBuild` lets it
     * bisect a floor -- and for the same reason: an assertion that has to move
     * the player to make its measurement cannot then measure the player.
     *
     * `trueG` and `apparentG` are both published because their DIFFERENCE is
     * the physically meaningful quantity (it is the carrier's freefall) and
     * because a report carrying only the second could not tell an orbit from a
     * world with gravity switched off.
     */
    weight(x?: number, y?: number, z?: number) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      const at = x === undefined || y === undefined || z === undefined
        ? { x: b.feet.x, y: b.feet.y, z: b.feet.z } : { x, y, z };
      const r = Math.hypot(at.x, at.y, at.z);
      const trueG = s.body.gravityAccel(r);
      const field = b.gravity;
      const apparentG = field === null ? trueG : field.apparentAt(at.x, at.y, at.z, trueG);
      return {
        at: [at.x, at.y, at.z], r,
        trueG, apparentG, freefallG: trueG - apparentG,
        /** EXACT equality, not a tolerance: see GravityVolumes.ts. */
        restoredExactly: apparentG === trueG,
        floatG: ZEROG.floatG, standG: ZEROG.standG,
        thrustAccel: ZEROG.thrustAccel, maxSpeedMps: ZEROG.maxSpeedMps,
        /** The LIVE walker state, only meaningful when no point was given. */
        floating: b.floating,
        weightless: b.weight.weightless,
        grounded: b.grounded, onDeck: b.onDeck,
        volumes: volumes.count,
        inVolumes: volumes.at(at.x, at.y, at.z).map((v) => ({
          id: v.id, mode: v.mode, powered: v.powered, carrierG: v.carrierG,
        })),
        station: lastStationGravity(),
        gravityTests: b.gravityTests,
      };
    },

    /**
     * The station's artificial gravity, on or off. THE INSTRUMENT FOR THE
     * DERELICT CASE, and the seam a real powered generator entity plugs into
     * (PH-103): nothing here decides how much gravity, only whether. See
     * StationGravity.ts for why the generator publishes no magnitude of its own.
     */
    stationGravity(on?: boolean) {
      if (on !== undefined) setStationGravityPowered(on);
      return { powered: stationGravityPowered(), report: lastStationGravity() };
    },

    /**
     * WHOLE-WORLD GRAVITY SCALE, and it exists to be an INSTRUMENT rather than
     * a cheat (PH-99). "Does the walker degrade into a floating body when
     * gravity goes away" is a question about the WALKER, and asking it at the
     * station would fold the volume geometry, the fringe and the station's own
     * pose into the answer. This asks it with nothing else in the room.
     *
     * It stacks UNDER any volumes rather than replacing them, so a run can zero
     * the world and still ask what a powered deck does on top of that.
     */
    gravityScale(k?: number) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      if (k !== undefined) {
        uniform.scale = k;
        // Installed unconditionally rather than only when k !== 1. Multiplying
        // by 1.0 is exact in IEEE754, so the stacked field at scale 1 returns
        // the same bits the bare volume set does, and a hook that rewired
        // itself depending on its own argument would be a second code path
        // reachable only by the value nobody tests with.
        b.gravity = new StackedGravity(uniform, volumes);
      }
      return { scale: uniform.scale, volumes: volumes.count,
        stacked: b.gravity !== volumes };
    },
  };
}
