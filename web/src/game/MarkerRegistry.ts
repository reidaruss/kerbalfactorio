// GP-520..GP-524. THE MARKER SUBSTRATE: one registry, either map reads it.
//
// Before tonight there was no marker/pin concept at all: Map3D.ts's
// `MarkerKind` was closed to four flight-registry sources (player/pad/vessel/
// flying) and the 2D map's `MapDrawReport.markers` only ever carried probe
// receipts, never a position. A "you have found a ruin" scan (the reveal
// lane, L6, coming later) needs one place to put that fact where BOTH maps
// can read it, and it needs to be ONE place: two registries fed by two
// producers is the "second authority" defect this project keeps paying for
// (VesselRegistry's own header names the same shape of bug).
//
// KEYED, like VesselRegistry: `add` overwrites the same key, so a producer
// that reruns (a rescan finding the same ruin again) is idempotent rather
// than piling up duplicate sprites.
//
// TONIGHT HAS NO REAL PRODUCER. `app/DebugMarkers.ts` is the only one, a
// deterministic stand-in a probe drives through `of.markers('add', ...)`; L6
// adds the real one (a scan result) against this same `add`, so nothing here
// changes shape when it lands.
import type { MapMarker } from '../ui/MapTypes.js';

export class MarkerRegistry {
  private readonly records = new Map<string, MapMarker>();

  add(m: MapMarker): MapMarker {
    this.records.set(m.key, m);
    return m;
  }

  remove(key: string): boolean {
    return this.records.delete(key);
  }

  clear(): void {
    this.records.clear();
  }

  find(key: string): MapMarker | null {
    return this.records.get(key) ?? null;
  }

  list(): readonly MapMarker[] {
    return [...this.records.values()];
  }

  report(): unknown {
    return { count: this.records.size, rows: this.list() };
  }
}

/** Module-level, exactly like `VesselRegistry`'s own `registry`: the map
 *  reads it, a producer writes it, and neither owns the other. */
export const markerRegistry = new MarkerRegistry();
