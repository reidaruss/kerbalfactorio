// =============================================================================
// Sites.ts - the client's driver for `/core`'s POI/site table (WG-151,
// ABI 24).
//
// WHERE A SITE IS IS WORLD STATE, NOT UI STATE, so the authority is
// `core/include/of/poi.h` and this file is a driver exactly as `Discovery.ts`
// is one for `discovery.h`: it caches the table (a pure function of the seed,
// so it never changes after the body is built) and forwards the two mutable
// bits. It holds no opinion about placement, about what a scan reveals or
// about what investigating a ruin unlocks -- WORLD-GEN'S charter line is "the
// world says WHERE a site is and never what is inside one", and that line
// runs through this driver unbroken: gameplay decides the scan, the reveal,
// the reward and the questline.
//
// THE STATE MACHINE IS unknown -> known -> visited, AND IT IS MONOTONE
// (poi.h's rule, restated in `poiabi.ts`): `markVisited` also sets `known`,
// so a player who walks up to an unscanned ruin still reads as known.
//
// Standing rule 5 is live in every method here: `ALLOW_MEMORY_GROWTH`
// detaches every ArrayBuffer when the heap grows, so no scratch pointer and
// no heap view survives a call into WASM. Every read below re-derives both.
// =============================================================================

import { PoiRow, POI_ROW_WORDS, SITE_KIND_NONE, poiAbi } from '../sim/wasm/poiabi.js';
import type { OfPoiModule } from '../sim/wasm/poiabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchI32, scratchU8 } from '../sim/wasm/heap.js';

export { SITE_KIND_NONE, SITE_KIND_RUIN } from '../sim/wasm/poiabi.js';

export interface Vec3Like { x: number; y: number; z: number; }

/** One `of_poi_row` row, field for field. `idLo`/`idHi` are the halves every
 *  known/visited call takes back -- there is no reconstructed 64-bit id here
 *  on purpose, since JS has no exact 64-bit integer and the halves are all
 *  any caller needs (`poiabi.ts` has the reasoning). */
export interface SiteRow {
  idLo: number;
  idHi: number;
  /** poi.h's `SiteKind`. */
  kind: number;
  ordinal: number;
  dir: Vec3Like;
  /** Body-frame metres, on the BASE surface. */
  pos: Vec3Like;
  latRad: number;
  lonRad: number;
  yawRad: number;
  footprintM: number;
  arcFromAnchorM: number;
  tiltDeg: number;
  residP95M: number;
  /** of/biome.h's `Biome`, or -1. */
  biome: number;
}

export interface SitesStats {
  count: number;
  known: number;
  visited: number;
}

export class Sites {
  private ready = false;
  private rows_: SiteRow[] = [];
  private readonly M: OfPoiModule;
  private readonly body: number;

  /** `bodyHandle` is a §1 BODY HANDLE (`of_body_create_forge` et al.'s return
   *  value), NOT the 0/1 `bodyId` `Discovery`'s constructor takes -- poi.h's
   *  generator needs the live `BodyParams` a handle addresses. */
  constructor(core: OfCoreModule, bodyHandle: number) {
    this.M = poiAbi(core);
    this.body = bodyHandle;
    this.refresh();
  }

  get live(): boolean { return this.ready; }
  get count(): number { return this.rows_.length; }
  rows(): readonly SiteRow[] { return this.rows_; }
  row(i: number): SiteRow | null { return this.rows_[i] ?? null; }

  /**
   * Re-read the whole table from `/core`. THE TABLE ITSELF NEVER CHANGES
   * after the body is built (WG-3: it is a pure function of the seed and the
   * height field), so a driver only needs to call this once at construction;
   * it is exposed so a caller that rebuilds the body handle (a new game, a
   * body switch) can refresh this driver onto the new one without
   * reconstructing it.
   */
  refresh(): void {
    const n = this.M._of_poi_count(this.body);
    this.ready = n >= 0;
    this.rows_ = [];
    if (!this.ready) return;
    const R = PoiRow;
    for (let i = 0; i < n; ++i) {
      const words = this.M._of_poi_row(this.body, i);
      if (words < POI_ROW_WORDS) continue;
      // Pointer AND view re-read after the call, never before and never
      // cached, per standing rule 5.
      const p = this.M._of_scratch_f64();
      const a = this.M.HEAPF64.subarray(p >>> 3, (p >>> 3) + POI_ROW_WORDS);
      this.rows_.push({
        idLo: a[R.idLo], idHi: a[R.idHi],
        kind: a[R.kind], ordinal: a[R.ordinal],
        dir: { x: a[R.dirX], y: a[R.dirY], z: a[R.dirZ] },
        pos: { x: a[R.posX], y: a[R.posY], z: a[R.posZ] },
        latRad: a[R.latRad], lonRad: a[R.lonRad], yawRad: a[R.yawRad],
        footprintM: a[R.footprintM], arcFromAnchorM: a[R.arcFromAnchorM],
        tiltDeg: a[R.tiltDeg], residP95M: a[R.residP95M],
        biome: a[R.biome],
      });
    }
  }

  /** Every site index inside the CONE about `dir` (a scan radius or a camera
   *  frustum, never a projection -- WG-29). Returns row indices for `row()`. */
  near(dir: Vec3Like, cosHalfAngle: number, maxN = 64): number[] {
    if (!this.ready) return [];
    const n = this.M._of_poi_near(this.body, dir.x, dir.y, dir.z, cosHalfAngle, maxN);
    if (n <= 0) return [];
    return Array.from(scratchI32(this.M, n));
  }

  /** The nearest site of `kind` (default: any) to `dir`, as a row index, or
   *  -1 for none. */
  nearest(dir: Vec3Like, kind: number = SITE_KIND_NONE): number {
    if (!this.ready) return -1;
    return this.M._of_poi_nearest(this.body, dir.x, dir.y, dir.z, kind);
  }

  /** THE KEEP-OUT every placement system asks: is `dir` (a unit direction or
   *  a surface position -- `/core` normalises) within `marginM` of any
   *  site's footprint? */
  inside(dir: Vec3Like, marginM = 0): boolean {
    return this.ready
      && this.M._of_poi_inside(this.body, dir.x, dir.y, dir.z, marginM) === 1;
  }

  /** Has the scan revealed this site? */
  known(row: Pick<SiteRow, 'idLo' | 'idHi'>): boolean {
    return this.ready
      && this.M._of_poi_known(this.body, row.idLo, row.idHi) === 1;
  }

  /** Reveal it. TRUE only the first time. */
  markKnown(row: Pick<SiteRow, 'idLo' | 'idHi'>): boolean {
    return this.ready
      && this.M._of_poi_mark_known(this.body, row.idLo, row.idHi) === 1;
  }

  /** Has this site been investigated? */
  visited(row: Pick<SiteRow, 'idLo' | 'idHi'>): boolean {
    return this.ready
      && this.M._of_poi_visited(this.body, row.idLo, row.idHi) === 1;
  }

  /** Record a visit. TRUE only the first time. Also marks `known`. */
  markVisited(row: Pick<SiteRow, 'idLo' | 'idHi'>): boolean {
    return this.ready
      && this.M._of_poi_mark_visited(this.body, row.idLo, row.idHi) === 1;
  }

  /** Counts over the live table, for a HUD or a probe assertion. Costs one
   *  known/visited query per row -- WG-151: the table is tiny (56 bytes a row
   *  natively) and there is no query cost here worth caching against. */
  stats(): SitesStats {
    if (!this.ready) return { count: 0, known: 0, visited: 0 };
    let known = 0, visited = 0;
    for (const r of this.rows_) {
      if (this.known(r)) ++known;
      if (this.visited(r)) ++visited;
    }
    return { count: this.rows_.length, known, visited };
  }

  /** The save's bytes: both bits, delta-varint, from `/core`. */
  serialize(): number[] {
    if (!this.ready) return [];
    const n = this.M._of_poi_save(this.body);
    if (n <= 0) return [];
    return Array.from(scratchU8(this.M, n));
  }

  /** Returns the total ids restored (known + visited), or -1 when `/core`
   *  refused (no field for this body, or an empty stream). A refusal is not
   *  silent: the caller reports it, the same discipline `Discovery.deserialize`
   *  uses for DW-17's rule. */
  deserialize(bytes: readonly number[] | null | undefined): number {
    if (!this.ready || bytes === null || bytes === undefined
        || bytes.length === 0) {
      return 0;
    }
    this.M._of_poi_alloc_bytes(bytes.length);
    const p = this.M._of_scratch_u8();
    this.M.HEAPU8.set(bytes as number[], p);
    return this.M._of_poi_load(this.body);
  }
}
