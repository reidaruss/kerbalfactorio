// `__of.flight`: the driven surface for the flight lane.
//
// HOUSE RULE, inherited from DebugVab and DebugGameplay: every entry goes
// through the PLAYER'S OWN code path. There is no setter here that puts a vessel
// in an orbit it did not fly to, no way to release the clamp a TWR below 1 would
// refuse, and no pilot. `__of.input.act('stage')` is how a probe stages, because
// that is how a player stages.
//
// The one thing here that is NOT reachable by a key is `counters`, and it is a
// READ: the factory totals a probe compares before and after a flight. DW-20
// asks a harness to prove it advanced the sim, and for this milestone that means
// proving the OTHER sim advanced too, which is a different number from any of
// the ones flight itself produces.
import { currentVesselTick, demoteVessel, leaveVessel, promoteVessel,
         resumeControl, syncPromoted, vesselEngineReport } from './FlightVessels.js';
import { flightParts } from '../sim/FlightAbi.js';
import { mayLeave, resumeReport, whyNotLeave } from './ResumeBoot.js';
import { playerAnchorReport } from './PlayerAnchor.js';
import { vesselSaveReport } from '../game/VesselSave.js';
import { registry } from '../sim/VesselRegistry.js';
import { stateOfDocked } from '../game/SpaceStation.js';
import { vesselAbi } from '../sim/wasm/vesselabi.js';
import { evaActive, lastVesselGravity } from '../game/VesselGravity.js';
import type { Services } from './Services.js';

export interface FlightDebugApi {
  flight(op?: string, a?: unknown): unknown;
}

/** THE REGISTRY'S OWN ACCOUNT OF ITSELF. Positions are DERIVED here, at the tick
 *  asked for, and no cached position is reported anywhere: a cached one would be
 *  the second authority the registry exists to remove (DW-26). */
function vesselReport(tick: number): Record<string, unknown> {
  return {
    ...vesselSaveReport(), ...vesselEngineReport(),
    resume: resumeReport(), anchor: playerAnchorReport(), tick,
    list: registry.list().map((r) => ({
      id: r.id, name: r.name, mode: r.mode, fired: r.fired,
      parts: r.design.parts.length,
      fuelKg: r.fuel.reduce((a, b) => a + b[1], 0),
      clockS: registry.clockAt(r, tick), status: r.status,
      onPad: r.onPad, promoted: r.id === registry.promotedId,
      mayLeave: mayLeave(r), whyNot: whyNotLeave(r),
      // PH-76. THE POSE, published because the handoff is the first thing that
      // can get it wrong in a way nothing else notices. Fuel and orbit are
      // already asserted across a reload; which way the nose points was not, and
      // a vessel resumed pointing the wrong way flies a different mission while
      // every other number reads healthy. It is a READ of the record, so no
      // second authority is created (DW-26).
      pose: { fwd: r.pose.fwd, right: r.pose.right, angVel: r.pose.angVel,
              throttle: r.pose.throttle, sasMode: r.pose.sasMode },
      conic: r.where.kind === 'conic'
        ? { a: r.where.el.a, e: r.where.el.e, epoch: r.where.el.epoch } : null,
      // PH-366. THE LATCH, published on the census rather than only on the
      // flight report, because "is this vessel docked" has to be answerable
      // about a record NOBODY IS FLYING -- which is exactly the state a
      // save/reload leaves it in, and therefore the only state in which the
      // save shape can be measured at all. `null` is not docked.
      docked: r.docked === undefined ? null
        : { hostId: r.docked.hostId, hostPort: r.docked.hostPort,
            localPos: r.docked.localPos, localFwd: r.docked.localFwd },
    })),
  };
}

interface FactoryCounters {
  minedFromNodes: number; coreTicks: number; ticks: number;
  ingots: number; machines: number; buildings: number;
}

/** The factory's own monotonic totals, read straight off the live objects. */
function counters(s: Services): FactoryCounters | { error: string } {
  const g = s.gameplay;
  if (g === null) return { error: 'no gameplay' };
  const f = g.factory;
  return {
    minedFromNodes: f.minedFromNodes,
    coreTicks: f.line.coreTicks,
    ticks: f.line.ticks,
    ingots: g.fx.ingots,
    machines: g.machines.list.length,
    buildings: f.placed.length,
  };
}

export function flightApi(s: Services): FlightDebugApi {
  return {
    flight(op?: string, a?: unknown): unknown {
      const f = s.flight;
      if (f === null) {
        return { error: 'no flight (needs gameplay and the bay, and not ?flight=0)' };
      }
      switch (op) {
        case undefined:
        case 'report':
          return f.report();
        // The context-sensitive key, driven through the same method the key
        // calls. A probe that wants a specific meaning asks for it by name.
        case 'board': f.board(); return f.report();
        case 'rollout': f.rollOut(); return f.report();
        case 'disembark': f.disembark(); return f.report();
        // GP-74. The same method the `recover` key calls. It is here as well as
        // on a key because a probe must be able to assert the REFUSALS too, and
        // a refusal is invisible from outside unless the call returns.
        case 'recover': return { ok: f.recover(), report: f.report() };
        // PH-360. The same method the `dock` key calls, and like `recover` it
        // returns `ok` because a REFUSAL is invisible from outside unless the
        // call returns: `probes/docking.js` has to prove the out-of-range
        // refusal fired rather than infer it from nothing having happened.
        case 'dock': return { ok: f.dock(), report: f.report() };
        case 'counters': return counters(s);
        // PH-84. PER-TANK PROPELLANT, RE-READ FROM /core ON EVERY CALL.
        //
        // ADDITIVE, and it exists because there was no way to ask "which tank
        // is draining". `report().propellantKg` used to sum
        // `FlightSession.partRows`, and those rows are refreshed only by
        // `refreshParts`, which runs on a roll-out and on a staging and at NO
        // OTHER TIME, so the reported total did not move while an engine burned
        // and a probe watching it measured a constant. R44 made that method a
        // live re-read, so the totals now agree; `cachedTotalKg` is still
        // published below because the CACHED rows are still what `FlightMode`
        // draws the craft from, and a probe must be able to see the two apart.
        //
        // It is a READ of `of_fl_parts` / `of_fl_transforms` and writes
        // nothing, so no second authority is created (DW-26).
        case 'tanks': {
          const ses = f.session;
          if (!ses.live) return { live: false, handle: 0, parts: [] };
          const rows = flightParts(ses.core, ses.handle);
          return {
            live: true, handle: ses.handle, stagings: ses.stagings,
            // The session's own CACHED sum, published beside the live one so a
            // probe can see the two disagree rather than trust either blindly.
            cachedTotalKg: ses.partRows.reduce((a, p) => a + p.propellantKg, 0),
            liveTotalKg: rows.reduce((a, p) => a + p.propellantKg, 0),
            parts: rows.map((p) => ({
              handle: p.handle, partId: p.partId, parent: p.parent,
              attach: p.attach, stage: p.stage,
              propellantKg: p.propellantKg,
              radialOffsetM: p.radialOffsetM, originM: p.originM,
            })),
          };
        }
        // PH-64 to PH-69. THE REGISTRY, and it is deliberately the whole of it:
        // "where is this vessel" has ONE answer and a probe must be able to read
        // that answer rather than infer it from a live session that may not
        // exist. Every position below is DERIVED at the tick asked for, so a
        // rails vessel reports where its conic says it is and nowhere else.
        case 'vessels': return vesselReport(currentVesselTick());
        // The same sync every save performs, on demand. Exposed so a probe can
        // read the record without writing a slot, which is what lets the rails
        // prediction be taken BEFORE the vessel flies the interval it predicts.
        case 'sync':
          syncPromoted(f, currentVesselTick());
          return vesselReport(currentVesselTick());
        // Demote and promote by NAME, through the same two functions the future
        // control handoff will call. They are here so the on-rails property can
        // be driven and asserted before any UI reaches them, which is the whole
        // difference between a foundation and a hope (R15's reachability rule
        // read the other way: publish the seam, then prove it moves).
        case 'demote': return { id: demoteVessel(f, currentVesselTick()),
                                vessels: vesselReport(currentVesselTick()) };
        case 'promote': {
          const id = typeof a === 'number' ? a : Number(a ?? 0);
          const ok = promoteVessel(f, id, currentVesselTick());
          return { ok, id, vessels: vesselReport(currentVesselTick()),
                   report: f.report() };
        }
        // PH-76. THE CONTROL HANDOFF, both directions, through the same two
        // functions any UI will call. They are ops on `flight` rather than a new
        // top-level entry because that is what `demote` and `promote` already
        // are, and the handoff is the guarded verb on top of those two, not a
        // second surface.
        //
        // BOTH RETURN `ok`, and for `leave` that boolean is the REFUSAL: a
        // frozen vessel is turned away by `mayLeave`, nothing changes, and the
        // reason lands in `report.message`. A refusal that is invisible from
        // outside is a guard no probe can prove ever fired, which is the same
        // argument `recover` makes four cases above.
        case 'leave': {
          const ok = leaveVessel(f, currentVesselTick());
          return { ok, vessels: vesselReport(currentVesselTick()),
                   report: f.report() };
        }
        // PH-110, R54. THE SPACEWALK, and it is a THIRD verb rather than a flag
        // on `leave`, because the two do opposite things to the vessel: `leave`
        // DEMOTES it (the /core FlightSim is destroyed and the meshes go), and
        // an EVA must keep it promoted, live and drawn, or the player floats
        // beside nothing. `canEva` is published alongside so a probe can assert
        // that the refusal fired rather than inferring it from a false.
        case 'eva': {
          const may = f.canEva();
          const ok = f.evaOut();
          return { ok, may, eva: evaActive(), gravity: lastVesselGravity(),
                   vessels: vesselReport(currentVesselTick()),
                   report: f.report() };
        }
        case 'resume': {
          const id = typeof a === 'number' ? a : Number(a ?? 0);
          const ok = resumeControl(f, id, currentVesselTick());
          return { ok, id, vessels: vesselReport(currentVesselTick()),
                   report: f.report() };
        }
        // WHERE A RECORD IS AT AN ARBITRARY TICK, without promoting it and
        // without advancing anything. This is the call that makes the on-rails
        // determinism claim testable: ask the same record for tick N and tick
        // N+M and compare against the conic.
        case 'railsAt': {
          const o = a as { id?: number; tick?: number } | undefined;
          const rec = registry.find(o?.id ?? registry.promotedId);
          if (rec === null) return { error: 'no such vessel' };
          const t = typeof o?.tick === 'number' ? o.tick : currentVesselTick();
          return { id: rec.id, mode: rec.mode, tick: t,
                   clockS: registry.clockAt(rec, t),
                   // PH-381, GP-866. Docked-aware: see `stateOfDocked`'s own
                   // header (SpaceStation.ts). A no-op for an undocked record.
                   ...stateOfDocked(s.core, registry, rec, t) };
        }
        // The navball's OWN account of what it drew. A navball that is present
        // but never fed has to be distinguishable from one that is live, so this
        // is deliberately the panel's report and not a re-derivation.
        // PH-368. THE DOCK TARGET'S LIVE PORT POSE, published so a probe can
        // put a vessel ON the port without a second copy of the socket
        // composition. It is the exact object the capture test is armed with,
        // so a probe that places against it and then reads a refusal has found
        // a real disagreement rather than its own arithmetic.
        case 'dockTarget': return f.dockTarget ?? { error: 'no dock target' };
        // PH-368. DEBUG-PLACE: put the flown vessel at a state, exactly.
        //
        // A hand-flown rendezvous takes minutes of wall clock and a probe that
        // flew one would be measuring the pilot, not the latch. This writes
        // /core's state directly and RE-SAMPLES, because a cheat that left the
        // instrument rows stale would have every readout describing a vessel
        // that is not there (GP-105, which is why `sample` is public).
        case 'place': {
          const o = a as { pos?: number[]; vel?: number[];
                           fwd?: number[]; right?: number[] } | undefined;
          const h = f.session.handle;
          if (h <= 0 || o === undefined) return { error: 'no live flight' };
          const V = vesselAbi(s.core);
          if (Array.isArray(o.pos) && Array.isArray(o.vel)) {
            V._of_fl_set_pos_vel(h, o.pos[0] ?? 0, o.pos[1] ?? 0, o.pos[2] ?? 0,
                                 o.vel[0] ?? 0, o.vel[1] ?? 0, o.vel[2] ?? 0);
          }
          if (Array.isArray(o.fwd) && Array.isArray(o.right)) {
            V._of_fl_set_attitude(h, o.fwd[0] ?? 0, o.fwd[1] ?? 1, o.fwd[2] ?? 0,
                                  o.right[0] ?? 1, o.right[1] ?? 0, o.right[2] ?? 0);
          }
          V._of_fl_set_ang_vel(h, 0, 0, 0);
          f.session.sample();
          return { ok: true, state: f.session.state };
        }
        case 'navball': return f.navball.report();
        case 'readout': return f.readout();
        // Camera framing for a screenshot. It moves the EYE and nothing else:
        // the vessel does not know the camera exists.
        case 'camera': {
          const o = a as { yaw?: number; pitch?: number; distanceM?: number } | undefined;
          if (o !== undefined) {
            if (typeof o.yaw === 'number') f.observer.yaw = o.yaw;
            if (typeof o.pitch === 'number') f.observer.pitch = o.pitch;
            if (typeof o.distanceM === 'number') f.observer.distanceM = o.distanceM;
            f.observer.interpolate(1);
          }
          return f.observer.report();
        }
        default: return { error: `unknown flight op ${op}` };
      }
    },
  };
}
