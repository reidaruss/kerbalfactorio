// `__of.map`: the driven surface for the map and the maneuver node.
//
// HOUSE RULE, inherited from DebugFlight: every entry goes through the PLAYER'S
// OWN code path. There is no setter here that puts a node somewhere no button
// could put it, no way to read a plan the panel is not also being handed, and
// above all NO EXECUTION: a node is a plan and burning it is the player's job
// (PH-37, DW-29's autopilot gate). `__of.input.act('map')` is how a probe opens
// the map, because that is how a player opens it.
//
// `report()` carries the panel's OWN paint counts (`view.drawn`), taken inside
// drawMap rather than re-derived from the inputs, so a map that is present and
// never fed is distinguishable from a live one. That distinction is not
// hypothetical here: this whole lane exists partly because a published,
// working, clamped `VesselObserver.look()` had no caller for a milestone.
import type { Services } from './Services.js';

export interface MapDebugApi {
  map(op?: string, a?: unknown): unknown;
}

export function mapApi(s: Services): MapDebugApi {
  return {
    map(op?: string, a?: unknown): unknown {
      const m = s.map;
      if (m === null) {
        return { error: 'no map (needs flight, and not ?flight=0)' };
      }
      switch (op) {
        case undefined:
        case 'report':
          return m.report();
        // The buttons, called through the same hooks the DOM calls. A probe
        // that clicks the real <button> is better still and `probes/maneuver.js`
        // does that; these exist so a probe can drive a node without pixel
        // coordinates while still going through one code path.
        case 'place': m.view.hooks.place(); return m.report();
        case 'clear': m.view.hooks.clear(); return m.report();
        case 'hold': m.view.hooks.holdNode(); return m.report();
        case 'adjust': {
          const o = a as { axis?: string; delta?: number } | undefined;
          if (o === undefined || typeof o.delta !== 'number') {
            return { error: 'adjust needs { axis, delta }' };
          }
          m.view.hooks.adjust(o.axis as 'prograde', o.delta);
          return m.report();
        }
        case 'zoom': {
          const o = a as { mult?: number } | undefined;
          m.view.hooks.zoom(typeof o?.mult === 'number' ? o.mult : 1.25);
          return m.report();
        }
        default: return { error: `unknown map op ${op}` };
      }
    },
  };
}
