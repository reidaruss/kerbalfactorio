// The POI/SITE half of the /core bridge (ABI 24): poi.h, §22 of the shim.
//
// It lives in its own file for the reason discabi.ts and vesselabi.ts do:
// heap.ts stays at its line cap, the wasm module stays ONE object, and
// `poiAbi(M)` is the single place this wider face is named, so there is
// exactly one cast in the client and every caller downstream is fully typed.
//
// WHAT THIS IS. world-gen.md's "THE POI / SITE SEAM": the world says WHERE a
// site is and NEVER what is inside one. `core/include/of/poi.h`'s
// `SiteCatalog` answers three questions -- where are the sites, has this one
// been REVEALED (the scan), has this one been INVESTIGATED (the walk-up) --
// plus the keep-out every other placement system has to ask. The client
// SHADES and QUESTS off this; it never decides placement or the two bits.
//
// A `body` ARGUMENT HERE IS A BODY HANDLE (§1's `of_body_create_forge` et
// al.'s return value), NOT the 0/1 `bodyId` `discabi.ts`'s calls take. poi.h's
// generator reads `BodyParams` (homeDir, the pad, the pond, the height field)
// to place sites, so it needs the live body object a handle addresses, the
// same as `of_water_*` and `of_surface_*` do and unlike `of_disc_*`, which
// only ever needed the body's RADIUS.
//
// THE ID DOES NOT FIT IN ONE f64. A `SiteId` is a 64-bit hash and a double's
// mantissa is 52 bits, so `of_poi_row` splits it into `idLo`/`idHi` (the low
// and high 32-bit halves) and every call that takes an id back -- visited,
// mark_visited, known, mark_known -- takes both halves and rejoins them
// bridge-side. Both halves fit an f64 exactly (a 32-bit value never exceeds
// 2^32-1 < 2^52), so nothing here needs BigInt; `core/tests/test_poi.cpp`'s
// id-split test pins that the split/join arithmetic itself is lossless.
//
// THE STATE MACHINE IS unknown -> known -> visited, AND IT IS MONOTONE.
// `markVisited` also sets `known` bridge-side (poi.h's own rule, not
// duplicated here): a player who stumbles onto an unscanned ruin still reads
// as known once they have stood on it.
//
// Standing rule 5 applies here as everywhere: call the producing export
// FIRST, then take the scratch view through heap.ts's helpers, and copy out
// before the next call into WASM.
import type { OfCoreModule } from './heap.js';

/** `of_poi_row`'s fixed word count. Named so a reader never indexes the
 *  scratch row by a bare number and a change here fails to compile. */
export const POI_ROW_WORDS = 18;

/** Field offsets within one `of_poi_row` row (world-gen.md's order exactly). */
export const PoiRow = {
  idLo: 0,
  idHi: 1,
  /** poi.h's `SiteKind`: 0 = None, 1 = Ruin. */
  kind: 2,
  /** Ordinal within (body, kind). The id is derived from this, not the index. */
  ordinal: 3,
  dirX: 4, dirY: 5, dirZ: 6,
  /** Body-frame metres, on the BASE surface (never the edited one). */
  posX: 7, posY: 8, posZ: 9,
  latRad: 10,
  lonRad: 11,
  yawRad: 12,
  footprintM: 13,
  /** Arc distance from the body's anchor. 0 for a Global-anchor site. */
  arcFromAnchorM: 14,
  /** The measurement that admitted it, published so nobody re-measures. */
  tiltDeg: 15,
  residP95M: 16,
  /** of/biome.h's `Biome`, or -1. */
  biome: 17,
} as const;

/** `SiteKind` values, matching poi.h exactly. */
export const SITE_KIND_NONE = 0;
export const SITE_KIND_RUIN = 1;

export interface PoiAbi {
  // --- §22.1 where -------------------------------------------------------
  /** How many sites this body carries (0 for a body poi.h refuses, e.g.
   *  Cinder). -1 for a body handle `/core` does not know. */
  _of_poi_count(body: number): number;
  /**
   * f64 scratch, POI_ROW_WORDS, indexed by `PoiRow`. -> 18, or 0 for an
   * unknown body OR an out-of-range index (a bad index is REFUSED rather
   * than clamped: a caller iterating past `_of_poi_count` finds out).
   */
  _of_poi_row(body: number, i: number): number;
  /**
   * Every site index whose direction lies inside the CONE (dx,dy,dz,cosHalf)
   * -- a scan radius and a camera frustum both yield a cone (WG-29); an
   * orthographic map cell does not survive the limb. i32 scratch, one index
   * per row, at most `maxN`. -> the count WRITTEN, or -1 for an unknown body.
   */
  _of_poi_near(body: number, dx: number, dy: number, dz: number,
              cosHalf: number, maxN: number): number;
  /**
   * The nearest site of `kind` (SITE_KIND_NONE matches any) to the direction,
   * as an index for `_of_poi_row`. -1 for no site of that kind AND for an
   * unknown body -- both are "nothing to hand back"; `_of_poi_count` is how a
   * caller tells an empty table from a bad handle.
   */
  _of_poi_nearest(body: number, dx: number, dy: number, dz: number,
                  kind: number): number;
  /**
   * THE KEEP-OUT every placement system asks: is the direction (or a surface
   * position -- this normalises) within `marginM` of any site's footprint?
   * 1/0, or -1 for an unknown body.
   */
  _of_poi_inside(body: number, dx: number, dy: number, dz: number,
                marginM: number): number;

  // --- §22.2 the two mutable bits -----------------------------------------
  /** Has the scan revealed this site? 1/0, or -1 for an unknown body -- a
   *  REFUSAL, never read as "not yet known". */
  _of_poi_known(body: number, idLo: number, idHi: number): number;
  /** Reveal it. 1 the first time, 0 if already known or the id matches no
   *  site, -1 for an unknown body. */
  _of_poi_mark_known(body: number, idLo: number, idHi: number): number;
  /** Has this site been investigated? Same refusal discipline as `_of_poi_known`. */
  _of_poi_visited(body: number, idLo: number, idHi: number): number;
  /** Record a visit. 1 the first time, 0 afterward or for an unmatched id, -1
   *  for an unknown body. ALSO sets known bridge-side. */
  _of_poi_mark_visited(body: number, idLo: number, idHi: number): number;

  // --- §22.3 persistence ---------------------------------------------------
  // The same three-call shape `_of_disc_*` and `_of_edits_*` use. The u8
  // arena is SHARED, so do one at a time.
  /** Write both bits into the u8 scratch (known ids, then visited ids, each
   *  sorted delta-varint). -> byte count, or -1 for an unknown body. */
  _of_poi_save(body: number): number;
  /** Size the u8 scratch to `n` bytes so JS can copy a saved stream in. */
  _of_poi_alloc_bytes(n: number): void;
  /**
   * Load from the u8 scratch into `body`'s catalog. -> the total ids restored
   * (known + visited), or -1 for an unknown body or an empty arena.
   */
  _of_poi_load(body: number): number;
}

export type OfPoiModule = OfCoreModule & PoiAbi;

/** The ONE place the wasm module is widened to the POI/site surface. */
export function poiAbi(M: OfCoreModule): OfPoiModule {
  return M as OfPoiModule;
}
