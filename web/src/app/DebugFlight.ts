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
import { currentVesselTick, demoteVessel, promoteVessel, syncPromoted,
         vesselEngineReport } from './FlightVessels.js';
import { mayLeave, resumeReport, whyNotLeave } from './ResumeBoot.js';
import { playerAnchorReport } from './PlayerAnchor.js';
import { vesselSaveReport } from '../game/VesselSave.js';
import { registry, stateOf } from '../sim/VesselRegistry.js';
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
      conic: r.where.kind === 'conic'
        ? { a: r.where.el.a, e: r.where.el.e, epoch: r.where.el.epoch } : null,
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
        case 'counters': return counters(s);
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
                   ...stateOf(s.core, registry, rec, t) };
        }
        // The navball's OWN account of what it drew. A navball that is present
        // but never fed has to be distinguishable from one that is live, so this
        // is deliberately the panel's report and not a re-derivation.
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
