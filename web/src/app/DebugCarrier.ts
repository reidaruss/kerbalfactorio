// `__of.carrier`: the driven surface for the carrier frame (CE-37).
//
// NO LONGER THE ONLY WAY IN (CE-39 to CE-41), and PH-357 retired the rest of the
// paragraph that stood here: `Loop.fixedTick` decides membership every tick, the
// `visit:station` row seats the player on the station's frame, and Anchorage's
// conic is stamped so the shipped station really moves. What remains debug-only
// is the INSTRUMENT half: the four fixture frames, `remount`, `unmount`,
// `standLocal`, and CE-51's per-frame `frames` trace.
//
// HOUSE RULE, inherited from DebugFlight and DebugVab: every read is derived at
// the tick it is asked for and nothing here caches a pose, which is D-014's
// defect. IT DRIVES THE SHIPPING PATH: `board` puts a frame on the SAME
// `CarrierRide` the fixed tick calls.

import { FixedCarrier, LinearCarrier, type CarrierFrame } from '../world/CarrierFrame.js';
import { EphemerisCarrier, OrbitCarrier, RotorCarrier } from '../world/CarrierSources.js';
import { newPose, type FramePose, type V3 } from '../world/FramePose.js';
import { findStation, lastStationSolid } from '../game/SpaceStation.js';
import { lastStationVolumes } from '../game/StationGravity.js';
import { mountStationOn, seatOnStationDeck } from './StationMount.js';
import {
  BOARD_MARGIN_M, RELEASE_HYSTERESIS_M,
} from '../world/CarrierBoarding.js';
import type { EphemerisModule } from '../render/CelestialEphemeris.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';
import { carrierFrameTrace } from './FrameTrace.js';

export interface CarrierDebugApi {
  carrier(op?: string, a?: unknown): unknown;
}

const v: V3 = { x: 0, y: 0, z: 0 };

function num(o: unknown, k: string, fallback: number): number {
  const r = (o as Record<string, unknown> | null)?.[k];
  return typeof r === 'number' && Number.isFinite(r) ? r : fallback;
}

function str(o: unknown, k: string, fallback: string): string {
  const r = (o as Record<string, unknown> | null)?.[k];
  return typeof r === 'string' ? r : fallback;
}

export function carrierApi(s: Services, loop: Loop): CarrierDebugApi {
  // CE-51. The per-frame trace and its one pre-render hook; see FrameTrace.ts.
  const framesOp = carrierFrameTrace(loop, () => {
    const solid = lastStationSolid();
    return { origin: s.origin, eye: s.observer.position, collider: solid,
      drawn: s.mounts.mountCarrying(solid)?.drawnPos ?? null };
  });
  /**
   * The angle between two poses' rotations, in radians.
   *
   * THE UNSIGNED FORM IS MANDATORY: q and -q are the same rotation, so taking
   * the sign of whichever representative a source happened to hand back would
   * answer 2*pi minus the turn about half the time. `Math.abs` on the SCALAR
   * part of the relative quaternion is that, here.
   *
   * CE-53. IT IS `2*atan2(|vec|, |w|)` AND NOT `2*acos(|dot|)`, AND THE
   * DIFFERENCE IS THE WHOLE OF A DETERMINISTIC PROBE FAILURE.
   *
   * `acos` near 1 is the worst-conditioned call in the standard library:
   * d(acos)/dx = -1/sqrt(1-x^2), which at x = cos(t/2) is -1/sin(t/2). For the
   * one turn this project actually measures per tick, Anchorage's conic at
   * t = 3.132092e-5 rad, that factor is 63,857, so the returned ANGLE carries
   * 2/sin(t/2) = 1.2772e5 times whatever absolute error the dot has. The dot is
   * four products and three sums of unit-quaternion components, so its error is
   * a few ulps of 1.0; 4.228e-16 of it (under four ulps) is 5.4e-11 rad, which
   * against t itself is 1.72e-6 RELATIVE. Measured over 20,000 LVLH bases round
   * a 1e6 m circular conic: the acos form spans -2.350e-6 to +1.724e-6 and
   * breaches a 1e-6 gate on 1.6% of them. `probes/carrier.js` row C1 read
   * +1.7240873e-6, i.e. the top of that range to five significant figures.
   *
   * Two consequences worth naming, because both were live:
   *  - the error lands on a QUANTISED LATTICE (1,055 distinct values over
   *    20,000 samples), which is why the failure reproduced bit-stably on two
   *    machines instead of jittering like the rounding noise it is;
   *  - the acos form invents a turn for a frame that did not turn at all. Two
   *    poses with IDENTICAL quaternions read 4.21e-8 rad, because |q|^2 comes
   *    back a hair under 1 and `min(1, .)` only clamps the other side. The
   *    `turnPerTickRad === 0` assertions passed only because every translating
   *    carrier here happens to hold the exact identity quaternion.
   *
   * `atan2(|vec|, |w|)` is conditioned on sin near 0 instead of cos near 1, so
   * it is accurate at both ends of the range. Same 20,000 bases: residual
   * -5.28e-11 to -2.65e-11, which is no longer error at all but the arc-versus-
   * chord term the caller is comparing against (see `probes/carrier.js` C1).
   * Identical quaternions give exactly 0, because each vector component is a
   * sum of two exactly-equal-and-opposite products.
   */
  const turnBetween = (a: FramePose, b: FramePose): number => {
    // r = b (x) conj(a), the rotation that takes a's basis to b's.
    const rw = b.qw * a.qw + b.qx * a.qx + b.qy * a.qy + b.qz * a.qz;
    const rx = -b.qw * a.qx + b.qx * a.qw - b.qy * a.qz + b.qz * a.qy;
    const ry = -b.qw * a.qy + b.qy * a.qw - b.qz * a.qx + b.qx * a.qz;
    const rz = -b.qw * a.qz + b.qz * a.qw - b.qx * a.qy + b.qy * a.qx;
    return 2 * Math.atan2(Math.hypot(rx, ry, rz), Math.abs(rw));
  };

  /** WHAT A FRAME IS DOING ON ITS OWN, with no rider near it: THE FIXTURE
   *  ASSERTION, and the first thing a probe must read. A carrier that is not
   *  moving is the identity element of everything below (GP-142), and Anchorage
   *  ships exactly that way, so `perTickM` is published before anything boards. */
  const survey = (f: CarrierFrame, ticks: number): Record<string, unknown> => {
    const t0 = loop.tickIndex;
    const a = newPose(); const b = newPose(); const c = newPose();
    f.poseAt(t0, a);
    f.poseAt(t0 + 1, b);
    f.poseAt(t0 + ticks, c);
    const perTick = Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz);
    const overRun = Math.hypot(c.px - a.px, c.py - a.py, c.pz - a.pz);
    // A rotation is invisible in a translation, and the station's is the whole
    // of its motion, so the frame's own turn is reported beside its travel.
    // PER TICK as well as over the run: the per-tick turn is what the transport
    // actually applies, and a frame can be turning steadily while the ends of a
    // long run happen to land near each other.
    return {
      id: f.id, what: f.what, tick: t0, ticks,
      perTickM: perTick, perTickMS: perTick / loop.fixedDt,
      overRunM: overRun,
      turnPerTickRad: turnBetween(a, b),
      turnRad: turnBetween(a, c),
      originM: [a.px, a.py, a.pz],
      qA: [a.qx, a.qy, a.qz, a.qw], qEnd: [c.qx, c.qy, c.qz, c.qw],
    };
  };

  /** CE-42. THE MEMBERSHIP PREDICATE'S OWN READING, beside the ride. `boards: 1`
   *  says a decision fired at some point; this says what it WOULD say right now,
   *  which is the only way to tell "declined, the player is 40 m out" from "the
   *  decision is not running". `depthM` is signed, negative inside, so a walk-off
   *  can be watched crossing the two radii instead of only seen afterwards. */
  const aboard = (): Record<string, unknown> | null => {
    const p = s.player;
    if (p === null) return null;
    const f = p.body.feet;
    const on = s.mounts.mountOf(s.ride?.carrier ?? null);
    const m = on ?? s.mounts.mountCarrying(lastStationSolid());
    if (m === null) return { mount: null, ridingMounted: false };
    return {
      mount: m.frame.id,
      // True when the frame the rider holds is the one this reading is of.
      ridingMounted: on !== null,
      depthM: m.depthAt(f.x, f.y, f.z),
      insideBoard: m.containsPoint(f.x, f.y, f.z, BOARD_MARGIN_M),
      insideRelease: m.containsPoint(f.x, f.y, f.z,
        BOARD_MARGIN_M + RELEASE_HYSTERESIS_M),
    };
  };

  const census = (): Record<string, unknown> => {
    const t = loop.tickIndex;
    return {
      tick: t, fixedDt: loop.fixedDt,
      registry: s.carriers.census(),
      ride: s.ride === null ? null : s.ride.report(t),
      // CE-42. The decision's own counters beside the ride's, because they
      // differ exactly by the boards a caller performed by hand.
      mounts: s.mounts.census(),
      aboard: aboard(),
      /** Body-frame feet, so a probe can difference it itself. */
      feet: s.player === null ? null
        : [s.player.body.feet.x, s.player.body.feet.y, s.player.body.feet.z],
      vel: s.player === null ? null
        : [s.player.body.vel.x, s.player.body.vel.y, s.player.body.vel.z],
      /** CE-43. A boarded rider at 1879.26 m/s crosses the 4 km rebase
       *  threshold every 128 ticks, forever. This is the count. */
      rebases: s.origin.rebases,
    };
  };

  return {
    carrier(op?: string, a?: unknown): unknown {
      const tick = loop.tickIndex;
      switch (op ?? 'census') {
        case 'census':
          return census();

        /**
         * Register a frame. `kind` picks the SOURCE, and the point of having
         * four is that they fail differently: `fixed` cannot move, `linear`
         * translates with no rotation and exact f64 arithmetic, `body` reads
         * /core's ephemeris, and `station` reads a conic through a Kepler solve
         * and carries a rotating LVLH basis.
         */
        case 'register': {
          const kind = str(a, 'kind', 'fixed');
          const id = str(a, 'id', kind);
          let f: CarrierFrame;
          if (kind === 'station') {
            const rec = findStation();
            if (rec === null) return { error: 'no station record (?station=0?)' };
            f = new OrbitCarrier(id, s.core, rec);
          } else if (kind === 'body') {
            const e = new EphemerisCarrier(id, s.core as EphemerisModule,
              num(a, 'bodyId', 1), loop.fixedDt);
            // A wasm predating PH-161 has no `of_body_state`, and a carrier
            // that silently never moves is worse than none: it is a fixture
            // that cannot exhibit the defect, wearing the name of one that can.
            if (!e.available) return { error: 'wasm has no of_body_state (pre PH-161)' };
            f = e;
          } else if (kind === 'rotor') {
            // Derived from an already-registered orbit carrier, never from
            // numbers a caller supplies: the point of the rotor is to exercise
            // the quaternion path with the REAL conic's axis and rate.
            const from = s.carriers.get(str(a, 'from', ''));
            if (!(from instanceof OrbitCarrier)) {
              return { error: `rotor needs from=<an orbit carrier id>` };
            }
            const rot = RotorCarrier.fromOrbit(id, from, tick, loop.fixedDt);
            if (rot === null) return { error: 'degenerate conic state, no orbit normal' };
            f = rot;
          } else if (kind === 'linear') {
            // `from` seeds the origin and the velocity from an existing
            // carrier's own pose, so a straight-line instrument is THE SAME
            // MOTION MINUS THE CURVATURE rather than a made-up speed. That is
            // exactly the isolation the measurement needs: a freely falling
            // frame accelerates, and a rider that is not also accelerating
            // drifts in it by 1/2 a t^2 no matter how exact the transport is.
            let ox = num(a, 'ox', 0), oy = num(a, 'oy', 0), oz = num(a, 'oz', 0);
            let vx = num(a, 'vx', 0), vy = num(a, 'vy', 0), vz = num(a, 'vz', 0);
            const src = s.carriers.get(str(a, 'from', ''));
            if (src !== null) {
              const p0 = newPose(); const p1 = newPose();
              src.poseAt(tick, p0);
              src.poseAt(tick + 1, p1);
              ox = p0.px; oy = p0.py; oz = p0.pz;
              vx = (p1.px - p0.px) / loop.fixedDt;
              vy = (p1.py - p0.py) / loop.fixedDt;
              vz = (p1.pz - p0.pz) / loop.fixedDt;
            }
            f = new LinearCarrier(id, ox, oy, oz, vx, vy, vz, loop.fixedDt, tick);
          } else {
            f = new FixedCarrier(id);
          }
          try {
            s.carriers.add(f);
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
          return { ...survey(f, num(a, 'ticks', 600)), registry: s.carriers.census() };
        }

        case 'survey': {
          const f = s.carriers.get(str(a, 'id', ''));
          if (f === null) return { error: `no carrier '${str(a, 'id', '')}'` };
          return survey(f, num(a, 'ticks', 600));
        }

        case 'remove':
          return { removed: s.carriers.remove(str(a, 'id', '')),
                   registry: s.carriers.census() };

        /**
         * CE-80. WHAT GEOMETRY IS RIDING WHAT, plus the station's live pose read
         * straight off the collision solid.
         *
         * `solid` is the object `StructureBodies` queries, not a copy of it, so
         * a probe asserting that the deck moved is asserting about the thing the
         * walker resolves against.
         *
         * -------------------------------------------------------------------
         * CE-102. `boarding` IS THE RULE'S CENSUS AND NOT THE BOARDING CENSUS,
         * AND ONE PASS HAS ALREADY BEEN MISLED BY THE DIFFERENCE.
         *
         * `mounts.census().boarding` counts what `BoardingRule.decide` did.
         * GP-805 read `tested: 137, boarded: 0` off it and concluded, quite
         * correctly for what it was looking at, that `standAt(..., { frame:
         * 'body' })` boards nobody. The trap is that the SAME READING comes
         * back when a rider is perfectly aboard: `standAboard` boards through
         * `seat.board(frame)` directly, so `decide` finds `seat.carrier`
         * already set and returns null without ever incrementing `boarded`.
         * Measured on the fixed world: `tested: 294, boarded: 0` with the
         * walker riding Anchorage at exactly 0 m of local drift over 3 s.
         *
         * So `boarded: 0` cannot distinguish "nobody is aboard" from "the rule
         * was not the one who put them there", and that is the one question a
         * reader of this op asks. `rider` is `CarrierRide`'s OWN report, which
         * can: `carrier` is the frame actually held, `boards`/`releases` count
         * every boarding however it happened, and `applied` counts the ticks a
         * transport was really applied.
         *
         * The rule's counters are NOT widened to cover the explicit verb.
         * Their whole value is separating "running and declining" from "not
         * running at all" (`BoardingRule`'s own header), and a counter that
         * also ticked for seats the rule never made would lose exactly that.
         * Two numbers answering two questions, published side by side.
         */
        case 'mounts': {
          const solid = lastStationSolid();
          return {
            tick, mounts: s.mounts.census(),
            rider: s.ride?.report(tick) ?? null,
            solid: solid === null ? null : {
              pos: [solid.pos.x, solid.pos.y, solid.pos.z],
              quat: [solid.quat.x, solid.quat.y, solid.quat.z, solid.quat.w],
              c: [solid.cx, solid.cy, solid.cz], cr: solid.cr,
            },
            volumes: lastStationVolumes().map((v) => ({
              mode: v.mode, pos: [v.pos.x, v.pos.y, v.pos.z],
              c: [v.cx, v.cy, v.cz], cr: v.cr,
            })),
          };
        }

        /**
         * CE-86. PUT THE STATION ON A DIFFERENT FRAME, keeping it exactly where
         * it is at this tick.
         *
         * IT EXISTS BECAUSE THE STATION USED TO SHIP FROZEN, and re-mounting
         * onto a `rotor` or `linear` instrument was then the only moving
         * fixture. PH-357 stamped the record, so its job now is to show the
         * mount is GENERAL: the geometry follows ANY frame, through
         * `mountStationOn`, the SAME function boot calls.
         */
        case 'remount': {
          const f = s.carriers.get(str(a, 'id', ''));
          if (f === null) return { error: `no carrier '${str(a, 'id', '')}'` };
          s.mounts.clear();
          const m = mountStationOn(s.mounts, f, s.station, tick);
          if (m === null) return { error: 'no station solid to mount' };
          return { mounted: m.report(), at: tick, mounts: s.mounts.census() };
        }

        /** CE-80's negative control, reachable from the same loop: drop every
         *  mount and leave the geometry where it last was. A frame that then
         *  moves is HEAD's own defect, measured rather than argued. */
        case 'unmount':
          s.mounts.clear();
          return { mounts: s.mounts.census() };

        /**
         * Board. Returns the state on BOTH sides of the verb, so continuity is
         * something the probe reads rather than something this file claims.
         */
        case 'board': {
          if (s.ride === null || s.player === null) return { error: 'no walker' };
          const f = s.carriers.get(str(a, 'id', ''));
          if (f === null) return { error: `no carrier '${str(a, 'id', '')}'` };
          const p = s.player.body;
          const before = { feet: [p.feet.x, p.feet.y, p.feet.z],
                           vel: [p.vel.x, p.vel.y, p.vel.z] };
          s.ride.board(f);
          return {
            before,
            after: { feet: [p.feet.x, p.feet.y, p.feet.z],
                     vel: [p.vel.x, p.vel.y, p.vel.z] },
            ride: s.ride.report(tick),
          };
        }

        case 'release': {
          if (s.ride === null || s.player === null) return { error: 'no walker' };
          const p = s.player.body;
          const before = { feet: [p.feet.x, p.feet.y, p.feet.z],
                           vel: [p.vel.x, p.vel.y, p.vel.z],
                           ride: s.ride.report(tick) };
          const was = s.ride.release();
          return {
            was: was?.id ?? null, before,
            after: { feet: [p.feet.x, p.feet.y, p.feet.z],
                     vel: [p.vel.x, p.vel.y, p.vel.z] },
            ride: s.ride.report(tick),
          };
        }

        /**
         * Seat the rider AT REST IN THE CARRIER'S FRAME, at a local point.
         *
         * An INSTRUMENT, on the same terms as `Controller.standAt` (PH-90), and
         * it exists because the state it produces is one the client cannot
         * otherwise reach: `standAt` zeroes the ABSOLUTE velocity, which on a
         * moving carrier is the defect rather than the rest state. Both are
         * needed in one run, because they are the two readings the whole claim
         * is a comparison between.
         *
         * It goes through `Controller.standAt` for the position rather than
         * writing `feet`, so the render interpolation's `prevFeet` is re-seated
         * the one way that is already correct, and only then overwrites the
         * velocity `standAt` zeroed.
         */
        case 'standLocal': {
          if (s.ride === null || s.player === null) return { error: 'no walker' };
          if (!s.ride.riding) return { error: 'not riding: board first' };
          const pos: V3 = { x: 0, y: 0, z: 0 };
          const vel: V3 = { x: 0, y: 0, z: 0 };
          if (!s.ride.restAt(tick, loop.fixedDt,
            num(a, 'x', 0), num(a, 'y', 0), num(a, 'z', 0), pos, vel)) {
            return { error: 'not riding' };
          }
          s.player.standAt(pos.x, pos.y, pos.z);
          const b = s.player.body;
          b.vel.x = vel.x; b.vel.y = vel.y; b.vel.z = vel.z;
          return { feet: [pos.x, pos.y, pos.z], vel: [vel.x, vel.y, vel.z],
                   speedMS: Math.hypot(vel.x, vel.y, vel.z), tick };
        }

        /** CE-51. THE PER-RENDERED-FRAME TRACE. `arm` starts a bounded ring;
         *  a bare call returns the verdict. The ONLY instrument here that
         *  samples BETWEEN fixed ticks, which is where the stutter lives:
         *  every other carrier number is taken at the one instant per tick at
         *  which the camera and the hull are corrected into agreement. */
        case 'frames':
          return framesOp(a);

        /**
         * CE-131. FORCE AN ALPHA THROUGH THE DRAWN PATH AND SAY WHERE THE HULL
         * LANDS, so the clamp's failure semantics are pinned by measurement.
         *
         * The whole of RN-2030's visible defect was an alpha the loop cannot
         * normally produce reaching `mounts.syncWatchersAt`, so the only honest
         * test of what now happens when it DOES is to hand it one. This writes
         * `loop.alpha`, reads `loop.renderTick` (the clamp under test), drives
         * the SHIPPING `syncWatchersAt` with it, and restores both, so nothing
         * here reimplements the path it is measuring.
         *
         * `rawPos` is the SAME watcher path driven at the unclamped instant,
         * i.e. what the pre-CE-131 loop drew. Without it the check is vacuous:
         * at a tick where the frame happens not to move, clamped and unclamped
         * agree and an equality would pass on a broken build. Both readings are
         * taken inside ONE call because `tickIndex` advances between calls.
         */
        case 'drawAt': {
          const solid = lastStationSolid();
          const mount = solid === null ? null : s.mounts.mountCarrying(solid);
          if (mount === null) return { error: 'the station solid is on no mount' };
          const want = num(a, 'alpha', 0.5);
          const held = loop.alpha;
          const rawTick = loop.tickIndex - 1 + want;
          const d = mount.drawnPos;
          loop.alpha = want;
          const drawnTick = loop.renderTick;
          s.mounts.syncWatchersAt(drawnTick);
          const pos = [d.x, d.y, d.z];
          s.mounts.syncWatchersAt(rawTick);
          const rawPos = [d.x, d.y, d.z];
          loop.alpha = held;
          s.mounts.syncWatchersAt(loop.renderTick);
          return {
            alpha: want, tick: loop.tickIndex, rawTick, drawnTick,
            clamped: drawnTick !== rawTick, pos, rawPos,
            gapM: Math.hypot(pos[0] - rawPos[0], pos[1] - rawPos[1],
                             pos[2] - rawPos[2]),
            alphaClamps: loop.alphaClamps,
          };
        }

        /** CE-41. THE SHIPPED ARRIVAL, driven directly: the SAME
         *  `seatOnStationDeck` the `visit:station` row now presses, so a probe
         *  can measure it without the pause menu and still be measuring what
         *  ships (`remount`'s argument about `mountStationOn`, again). */
        case 'seat': {
          const r = seatOnStationDeck(s.mounts, s.ride, s.player,
            tick, loop.fixedDt);
          if (r === null) {
            return { error: 'nothing to seat on: no walker, no ride, or the '
              + 'station solid is on no mount' };
          }
          return { ...r, ride: s.ride?.report(tick) ?? null };
        }

        /**
         * The rider's position in a carrier's local frame at a tick.
         *
         * `id` is optional and defaults to whatever is boarded. Supplying it
         * while NOT boarded is the whole negative control: the walker's
         * absolute position is read against the frame it would have been riding,
         * which is exactly what the client does today, so the drift it reports
         * is HEAD's own defect measured rather than a break somebody made.
         */
        case 'local': {
          if (s.player === null) return { error: 'no walker' };
          const id = str(a, 'id', '');
          const f = id === '' ? s.ride?.carrier ?? null : s.carriers.get(id);
          if (f === null) return { error: id === '' ? 'not riding' : `no carrier '${id}'` };
          const at = num(a, 'tick', tick);
          const pose = newPose();
          f.poseAt(at, pose);
          const p = s.player.body.feet;
          // parent -> local, longhand rather than through the ride, because the
          // ride refuses when nothing is boarded and the refusing case is the
          // measurement.
          const dx = p.x - pose.px, dy = p.y - pose.py, dz = p.z - pose.pz;
          const qx = -pose.qx, qy = -pose.qy, qz = -pose.qz, qw = pose.qw;
          const tx = 2 * (qy * dz - qz * dy);
          const ty = 2 * (qz * dx - qx * dz);
          const tz = 2 * (qx * dy - qy * dx);
          v.x = dx + qw * tx + qy * tz - qz * ty;
          v.y = dy + qw * ty + qz * tx - qx * tz;
          v.z = dz + qw * tz + qx * ty - qy * tx;
          return { id: f.id, tick: at, local: [v.x, v.y, v.z],
                   feet: [p.x, p.y, p.z], riding: s.ride?.carrier?.id ?? null };
        }

        default:
          return { error: `unknown op '${op}'. ops: census register survey remove `
            + `board release local standLocal seat frames drawAt mounts remount `
            + `unmount` };
      }
    },
  };
}
