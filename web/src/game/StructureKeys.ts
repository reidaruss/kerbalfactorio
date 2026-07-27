// WHAT A CELL IS CALLED, and why the name has to carry the frame it is in.
//
// Split out of StructureGrid.ts because it is a different KIND of thing from
// the geometry around it: everything else in that file answers "where is this
// part", in metres, and this answers "which slot does it occupy", as a string
// that goes into one map and into the save. Keeping them together is what let
// GP-60 happen, because a key looks like a formatting detail right up until two
// sites exist.

import { isDeck, type Addr } from './StructureGrid.js';

/**
 * The occupancy key. A wall and a door share one, so an edge takes one part.
 *
 * GP-60. THE SITE ID IS PART OF THE KEY AND USED NOT TO BE, AND THAT WAS A BUG.
 * Every site numbers its own cells from (0,0), so a base founded 100 m away had
 * a cell (0,0) too, and the occupancy map is ONE map: `s.has(key)` therefore
 * answered "already built here" for a cell in a site nothing had ever been built
 * in. The support checks were already site-aware (`hasDeck` compares `siteId`),
 * so this was the one question in the set asked in the wrong space, which is why
 * it survived: every positive test builds one base.
 *
 * Found by `probes/clickonce.js` teleporting 60 m between measured clicks to get
 * fresh ground, and being told the fresh ground was already built on.
 */
export function addrKey(siteId: number, a: Addr): string {
  return isDeck(a.kind) ? deckKey(siteId, a.i, a.j, a.level)
    : `w${a.axis}:${siteId}:${a.i},${a.j},${a.level}`;
}

/** The deck half of `addrKey`, for the several callers that ask about a cell
 *  they have coordinates for rather than an `Addr` they hold. */
export function deckKey(siteId: number, i: number, j: number,
                        level: number): string {
  return `d:${siteId}:${i},${j},${level}`;
}

/** The wall half, likewise. */
export function wallKey(siteId: number, axis: 0 | 1, i: number, j: number,
                        level: number): string {
  return `w${axis}:${siteId}:${i},${j},${level}`;
}
