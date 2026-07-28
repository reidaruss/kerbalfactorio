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
import type { Services } from './Services.js';

export interface FlightDebugApi {
  flight(op?: string, a?: unknown): unknown;
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
