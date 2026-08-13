// GP-533. THE ONE PLACE A `SiteRow` (world/Sites.ts, WG-151) BECOMES A
// `MapMarker` (ui/MapTypes.ts, GP-520). Two call sites need this: the
// one-shot reveal itself (`GameplayActions.revealNearbySites`, the moment a
// site goes known -> known) and the load path (`Persist.apply`, which rebuilds
// the WHOLE marker set from every already-known site on a reload). Both used
// to carry their own copy of this mapping; one function is what stops them
// drifting the day poi.h grows a second `SiteKind`.

import { SITE_KIND_RUIN } from '../world/Sites.js';
import type { SiteRow } from '../world/Sites.js';
import type { MapMarker } from '../ui/MapTypes.js';

/** poi.h's `SiteKind` has exactly one member today (Ruin). Widen this one
 *  function, not every call site, the day a second kind ships. */
export function markerKindFor(siteKind: number): MapMarker['kind'] {
  return siteKind === SITE_KIND_RUIN ? 'ruin' : 'ruin';
}

function labelFor(kind: MapMarker['kind']): string {
  return kind === 'ruin' ? 'Ruins' : 'Site';
}

/** A KNOWN site's row, as the marker both maps draw. `known: true` always:
 *  nothing calls this for a site that is not (`revealNearbySites` gates on
 *  `Sites.markKnown` returning true, and `Persist.apply`'s rebuild loop gates
 *  on `Sites.known` reading true first). */
export function markerFor(row: SiteRow): MapMarker {
  const kind = markerKindFor(row.kind);
  return {
    key: `poi:${row.idLo}:${row.idHi}`,
    kind,
    dirBody: [row.dir.x, row.dir.y, row.dir.z],
    label: labelFor(kind),
    known: true,
  };
}
