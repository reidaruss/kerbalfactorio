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
import { lastLuma } from '../ui/MapContrast.js';

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
        // GP-208/GP-210. The 3D map's own surface, and the selection/handoff
        // hooks, through the SAME functions the panel's rows call: a probe that
        // seated the player any other way would be testing a door no player
        // has. The DOM buttons remain the better probe; these exist for runs
        // that cannot afford pixel coordinates.
        case 'three':
          return m.report();
        case 'look': {
          const o = a as { dx?: number; dy?: number } | undefined;
          m.view.hooks.look(o?.dx ?? 0, o?.dy ?? 0);
          return m.report();
        }
        case 'select': {
          const o = a as { id?: number } | undefined;
          m.view.hooks.select(o?.id ?? 0);
          return m.report();
        }
        case 'control': {
          const o = a as { id?: number } | undefined;
          m.view.hooks.takeControl(o?.id ?? 0);
          return m.report();
        }
        // The flat canvas as the picture: the pre-GP-208 map, exactly, for
        // fallback and for any instrument that wants the painted pixels seen.
        case 'flat': {
          const o = a as { on?: boolean } | undefined;
          m.setFlat(o?.on !== false);
          return m.report();
        }
        // DW-36. Focus goes through the panel's own hook, the same one the
        // buttons call, because switching focus IS re-centring and a probe that
        // wrote `centreM` directly would be testing a path no player can take.
        case 'focus': {
          const o = a as { name?: string } | undefined;
          if (typeof o?.name !== 'string') return { error: 'focus needs {name}' };
          m.view.hooks.focus(o.name);
          return m.report();
        }
        // GP-650. THE VESSEL ROWS THE PANEL IS HANDED, and the body the map is
        // OF, both already in `report()` and named here so a probe reads them
        // without wading through the whole report. NOT a second computation:
        // `MapMode.report` calls the same `vesselRows` the panel is built from,
        // so a probe cannot go green against numbers no player ever sees, which
        // is the failure this file's own header is about.
        case 'vessels': {
          const r = m.report() as { body?: unknown; vessels?: unknown };
          return { body: r.body, vessels: r.vessels };
        }
        // The discovery field, straight off /core.
        case 'disc': return m.world?.report() ?? { error: 'no world layer' };
        // THE GROUND THE PAINTER WAS HANDED, sample for sample (WG-33). The
        // identical grid object, copied out as plain arrays, so a probe that
        // digs a hole and asks twice is comparing what the map DREW across the
        // dig rather than two fresh samples that would agree by construction.
        case 'grid': {
          const g = m.world?.terrainGrid() ?? null;
          if (g === null) return { error: 'no terrain grid' };
          // AND THE TONE THE PAINTER GAVE EACH ONE (WG-34), aligned sample for
          // sample with the arrays beside it, because "is my pad visible" is a
          // question about a handful of samples and every number in `contrast`
          // is a statistic over all 2,784 of them. Copied out here rather than
          // in the painter: this hook is the only caller.
          const L = lastLuma();
          const ok = L.n === g.cols * g.rows;
          return {
            cols: g.cols, rows: g.rows, sampleSizeM: g.sampleSizeM,
            onBody: g.onBody, minH: g.minH, maxH: g.maxH, stepM: g.stepM,
            heightM: Array.from(g.heightM), biome: Array.from(g.biome),
            luma: ok ? Array.from(L.luma.subarray(0, L.n)) : null,
            lumaMask: ok ? Array.from(L.mask.subarray(0, L.n)) : null,
          };
        }
        // FORGET WHAT HAS BEEN SEEN. The one entry here that no key drives, and
        // it is deliberate: it is the discovery twin of `of.forgetTunnels()`
        // and `of.repopulate()`, which exist for the same reason and neither of
        // which a player can press either. DW-17's rule is THE DESTRUCTION IS
        // THE POINT: a save/load round trip over a field that was never thrown
        // away is reading a number that never left memory, so without this the
        // one field DW-36 added is the one field DW-17 cannot verify. It is
        // also what lets a probe construct a PARTIALLY explored world, which
        // the shipped one is not: `Gameplay.populate` pins the ore cluster to
        // the spawn direction and the player starts standing on it, so every
        // patch is explored one second after boot and `MapWorld.hidden` is
        // otherwise permanently 0.
        case 'forget': {
          const w = m.world;
          if (w === null) return { error: 'no world layer' };
          w.forget();
          return w.report();
        }
        // THE ORE ROWS THE PAINTER IS HANDED, as raw numbers. Not the panel's
        // text and not a second query of the patch field: this is the same array
        // the map draws from, already gated by discovery, so a probe comparing
        // it against `of_gp_patch_state` is comparing the two ends of the one
        // path rather than two independent reads that happen to agree.
        case 'ore': {
          const w = m.world;
          if (w === null) return { error: 'no world layer' };
          const rows = w.ore();
          return { drawn: rows.length, hidden: w.hidden, rows };
        }
        default: return { error: `unknown map op ${op}` };
      }
    },
  };
}
