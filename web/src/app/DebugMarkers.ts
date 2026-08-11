// `__of.markers`: the driven surface for the marker substrate (GP-520).
//
// TONIGHT'S ONLY PRODUCER. There is no real one yet: a scan result is L6's
// job (the reveal lane). Until it lands, a probe injects a marker through
// `add`, going through the exact same `MarkerRegistry.add` the real producer
// will, so the substrate (registry -> both maps) is exercised end to end
// before anything calls it for a real reason. Same house rule as
// `DebugFlight`/`DebugMap`: this is a way IN to one function, not a second
// mechanism beside it.
import { markerRegistry } from '../game/MarkerRegistry.js';
import type { MapMarker } from '../ui/MapTypes.js';

export interface MarkersDebugApi {
  markers(op?: string, a?: unknown): unknown;
}

function isKind(k: unknown): k is MapMarker['kind'] {
  return k === 'ruin' || k === 'signal' || k === 'deposit';
}

function isV3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');
}

export function markersApi(): MarkersDebugApi {
  return {
    markers(op?: string, a?: unknown): unknown {
      switch (op) {
        case undefined:
        case 'report':
        case 'list':
          return markerRegistry.report();
        case 'add': {
          const o = a as Partial<MapMarker> | undefined;
          if (typeof o?.key !== 'string' || o.key === '' || !isKind(o.kind)
              || !isV3(o.dirBody)) {
            return { error: 'add needs { key, kind, dirBody:[x,y,z], label?, known? }' };
          }
          const m = markerRegistry.add({
            key: o.key,
            kind: o.kind,
            dirBody: o.dirBody,
            label: typeof o.label === 'string' ? o.label : o.key,
            known: o.known !== false,
          });
          return { added: m };
        }
        case 'remove': {
          const o = a as { key?: string } | undefined;
          if (typeof o?.key !== 'string') return { error: 'remove needs {key}' };
          return { removed: markerRegistry.remove(o.key) };
        }
        case 'clear':
          markerRegistry.clear();
          return markerRegistry.report();
        default:
          return { error: `unknown markers op ${op}` };
      }
    },
  };
}
