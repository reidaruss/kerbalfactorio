// The POI/site half of window.__of (WG-151, ABI 24), split out for
// the same reason `DebugGameplay.ts` and `DebugTerraform.ts` are their own
// files rather than more of `Debug.ts`.
//
// `Sites` (world/Sites.ts) is a STATELESS VIEW over `/core`'s per-body
// catalog: the two mutable bits live in the wasm module's cache, keyed on the
// body handle, not in any JS object. So a fresh `Sites` per call is correct
// and cheap (WG-210: the table is tiny) rather than a shortcut -- there is no
// staleness to manage between calls.
import { Sites } from '../world/Sites.js';
import type { SiteRow } from '../world/Sites.js';
import type { Services } from './Services.js';

function sitesOf(s: Services): Sites | null {
  const g = s.gameplay;
  return g === null ? null : new Sites(s.core, g.bodyHandle);
}

function rowReport(sites: Sites, i: number, r: SiteRow) {
  return {
    index: i, idLo: r.idLo, idHi: r.idHi, kind: r.kind, ordinal: r.ordinal,
    dir: r.dir, pos: r.pos, latDeg: r.latRad * 180 / Math.PI,
    lonDeg: r.lonRad * 180 / Math.PI, footprintM: r.footprintM,
    arcFromAnchorM: r.arcFromAnchorM, tiltDeg: r.tiltDeg,
    residP95M: r.residP95M, biome: r.biome,
    known: sites.known(r), visited: sites.visited(r),
  };
}

export function sitesApi(s: Services) {
  return {
    /** Every site this body carries, with both mutable bits, plus the table
     *  counts. Null with no character. */
    sites: () => {
      const sites = sitesOf(s);
      if (sites === null) return null;
      return {
        count: sites.count,
        rows: sites.rows().map((r, i) => rowReport(sites, i, r)),
        stats: sites.stats(),
      };
    },
    /** Reveal site `index` (the scan). TRUE only the first time, null with no
     *  character or a bad index. */
    siteMarkKnown: (index: number): boolean | null => {
      const sites = sitesOf(s);
      const row = sites?.row(index) ?? null;
      return row === null ? null : sites!.markKnown(row);
    },
    /** Record a visit to site `index` (the walk-up). TRUE only the first
     *  time, null with no character or a bad index. Also marks it known. */
    siteMarkVisited: (index: number): boolean | null => {
      const sites = sitesOf(s);
      const row = sites?.row(index) ?? null;
      return row === null ? null : sites!.markVisited(row);
    },
  };
}
