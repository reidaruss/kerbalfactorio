// THE STATION AS A RECORD: where it is, and what instant it is being asked
// about (GP-1075, split out of DebugGameplay.ts under the 400-line cap).
//
// Both entries read the SAME `stateOf(core, registry, rec, tick)`, and the
// pair is the concern: `station` reports the derived pose at the live tick and
// `stationClock` pins the orbital clock that pose is derived FROM. GP-805 and
// RN-1800, whose full accounts are in the two docstrings below, are the same
// defect seen from the two ends of that one call, which is why splitting them
// apart would be splitting a bug report in half.
//
// SEATING A WALKER ON THE DECK IS `DebugSeat.ts`, deliberately next door: this
// module never moves anybody, so a probe can read the station's own answer
// without the reading having disturbed it.
import {
  findStation, lastStationInstall, stationSockets,
  STATION_ALT_M, STATION_TAG, stationAxes, stationProxies,
} from '../game/SpaceStation.js';
import { airlockPlaneM } from '../game/StationGravity.js';
import { registry, stateOf } from '../sim/VesselRegistry.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function stationApi(s: Services, loop: Loop) {
  return {
    /**
     * PH-94. THE STATION, read from the RECORD rather than from the installed
     * solid, so a probe comparing across a reload is comparing the thing that
     * is actually on disk. `pos` is `stateOf`, one Kepler solve, derived on
     * demand and cached nowhere.
     *
     * `deckR` is the radius the interior's floor sits at, which is `|pos|`
     * because the station is nadir pointing and the deck top face is its own
     * local y = 0. A probe wanting the floor the walker will stand on should
     * bisect `solidBuild` instead, which is the walker's own predicate; this is
     * the ORBIT's answer and the two agreeing is a real assertion (PH-96).
     *
     * GP-805 FIX: `stateOf`'s FOURTH ARGUMENT IS A TICK, NOT A CONSTANT, AND
     * EVERY OTHER CALLER PASSES THE LIVE ONE. This one passed a literal `0`.
     * `VesselRegistry.clockAt` returns `rec.clockS` UNCHANGED whenever the
     * given tick is less than `rec.stampedTick` -- true of `0` on any run past
     * its first fixed tick -- so this op has been reporting the station FROZEN
     * at its last STAMP rather than at the live tick, silently, since nothing
     * about the return shape says so. Measured on a running station (1000 km,
     * 1879.2552 m/s): `of.standAboard()`'s live arrival point (which boards
     * through `StationMount.ts`'s own `mount.frame.poseAt(tick, ...)`, a
     * different and live-ticked path) read 4,667 m from what this op reported
     * as the station's position AT THE SAME INSTANT, non-decreasing on a
     * second immediate call -- not lag, a FIXED WRONG ANSWER. This is the
     * "frame mismatch" half of RN-1412's diagnosis (ADMIN.md), still live in
     * this debug surface after the "stale aim" half (`install.standPos`) was
     * fixed elsewhere: every probe that builds a local frame off `of.station
     * ().pos`/`.axes` (`stationwalk.js` among them) was measuring against a
     * stale snapshot no matter how fresh its own aim was.
     */
    station() {
      const rec = findStation();
      if (rec === null) return null;
      const st = stateOf(s.core, registry, rec, loop.tickIndex);
      const r = Math.hypot(st.pos[0], st.pos[1], st.pos[2]);
      const el = rec.where.kind === 'conic' ? rec.where.el : null;
      return {
        id: rec.id, name: rec.name, mode: rec.mode, tag: rec.status,
        expectTag: STATION_TAG,
        pos: st.pos, vel: st.vel, deckR: r,
        speedMps: Math.hypot(st.vel[0], st.vel[1], st.vel[2]),
        designParts: rec.design.parts.length,
        clockS: rec.clockS, stampedTick: rec.stampedTick,
        proxies: stationProxies().length,
        proxyNames: stationProxies().map((b) => b.name),
        /** Every proxy's own box, so a probe can aim at a named deck rather
         *  than at a coordinate it transcribed out of the Blender source.
         *  Standing rule 11: a probe that re-derived the layout would agree
         *  with itself whatever the asset did. */
        proxyBoxes: stationProxies().map((b) => ({
          name: b.name, min: b.min, max: b.max,
        })),
        airlockX: airlockPlaneM(stationProxies()),
        /** GP-284. EVERY SOCKET AS A FRAME, so a probe can assert the AXIS the
         *  asset ships rather than only the position. Physics needs `face` and
         *  `roll` to aim a docking capture, and until this pass the client read
         *  the rotation out of the glb and dropped it on the floor: two hulls
         *  meeting nose to nose and nose to tail have identical socket
         *  positions, so a point cannot express the difference. The names are
         *  the asset's own and nothing here renames them. */
        sockets: [...stationSockets()].map(([name, f]) => ({
          name, pos: f.pos, face: f.face, roll: f.roll,
        })),
        nominalAltM: STATION_ALT_M,
        el: el === null ? null : { ...el },
        axes: stationAxes(st.pos),
        install: lastStationInstall(),
        records: registry.count,
      };
    },

    /**
     * RN-1800. PIN THE STATION'S OWN ORBITAL CLOCK -- the quantity that
     * actually decides which side of the hull the sun is on, and the one the
     * look audit found nothing else pins.
     *
     * `setTime`/`setSunElev` move the SUN. The station is a conic 400 km up
     * doing 7.67 km/s, and `stateOf` (`VesselRegistry.ts`) derives its
     * position from `clockAt(rec, tick)`, which is `rec.clockS` folded
     * forward by `(tick - rec.stampedTick) * RAILS_DT` -- a function of how
     * many FIXED TICKS have elapsed since the record was last stamped, not of
     * the day-night phase at all. `artframe.js`'s `station` shot boards
     * through the pause menu, settles, looks and re-pins the sun before
     * capture, and every one of those steps runs a different number of ticks
     * from run to run (menu settle timing, `standAt` convergence and the
     * carrier-boarding wait are none of them frame-counted), so two captures
     * with an IDENTICAL sun phase still land the station at two different
     * points on its own orbit. That is what RN-1800's non-reproducible box
     * luma (21.78, then 3.73, then 5.69 at "the same" pin) was actually
     * measuring: not the sun moving, the hull.
     *
     * Overwrites `clockS`/`stampedTick` directly -- the same two fields
     * `FlightMode.ts`'s `mintStation` and `VesselRegistry.stamp` already
     * write outside this file, so nothing about the record's shape changes,
     * only which instant it reports. Undefined leaves the clock untouched and
     * only reads it, so a probe can check the live value before deciding
     * whether to pin. Returns the resulting position and speed so a probe can
     * verify the pin actually landed rather than assume it did.
     */
    stationClock(clockS?: number) {
      const rec = findStation();
      if (rec === null) return null;
      if (clockS !== undefined) {
        rec.clockS = clockS;
        rec.stampedTick = loop.tickIndex;
      }
      const st = stateOf(s.core, registry, rec, loop.tickIndex);
      // RN-1810 DIAGNOSTIC. `renderTick` (`Loop.ts`, CE-51) is `tickIndex - 1 +
      // alpha`, the FRACTIONAL tick the drawn hull is actually posed at
      // (`CarrierMounts.syncWatchersAt`), which can differ from the INTEGER
      // tick this method's own `stateOf` reads above. Both published so a
      // capture-time comparison can show whether that gap is where the
      // station shot's variance actually lives.
      const rst = stateOf(s.core, registry, rec, loop.renderTick);
      return {
        clockS: rec.clockS, stampedTick: rec.stampedTick, tick: loop.tickIndex,
        pos: st.pos, vel: st.vel,
        speedMps: Math.hypot(st.vel[0], st.vel[1], st.vel[2]),
        alpha: loop.alpha, renderTick: loop.renderTick,
        renderPos: rst.pos, renderPosVsIntegerM: Math.hypot(
          rst.pos[0] - st.pos[0], rst.pos[1] - st.pos[1], rst.pos[2] - st.pos[2]),
      };
    },
  };
}
