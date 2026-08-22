// EVERY number the scatter reports, in one object, plus the report itself.
// Split out of Scatter.ts at RN-2052.
//
// WHY THIS IS A SEPARATE OBJECT AND NOT JUST FIELDS ON THE CLASS. The class has
// three writers over disjoint subsets and one reader over all of them: `drop`
// and `build` move the residency totals in matched `-=`/`+=` pairs, `sample`
// owns the six per-cell refusal counters and writes nothing else, and `stats`
// reads everything and writes nothing. Making the bundle explicit is what let
// the 200-line sampler leave the class without taking its outputs with it: the
// counters are passed BY REFERENCE, so a `++` inside the sampler and a `-=`
// inside `drop` are still the same number.
//
// `stats` needs four values that are not counters (the emitter's own cap count
// and three constructor flags), so they arrive as a second argument rather than
// being smuggled in as fields nothing else would ever write.

export class ScatterCounters {
  chunksScattered = 0;
  lastBuildMs = 0;
  /** Prop instances (not parts) currently placed, and the ground they sit on. */
  propsPlaced = 0;
  wantedProps = 0;
  cellsScattered = 0;
  groundM2 = 0;
  /** Chunks whose draw was TRUNCATED by MAX_PER_CHUNK. Must stay 0 near. */
  chunksCapped = 0;
  /** Cells refused for water since boot (DW-28). See WET_REJECT_M. */
  wetCells = 0;
  /** Chunks waiting on the per-update sampling budget. Should settle to 0. */
  backlog = 0;
  /** RN-2229. Resident chunks `build` refused and will not re-offer. */
  chunksRefused = 0;
  /** Canopy trees placed, the ground they were drawn over, and the ask. */
  canopyProps = 0;
  canopyCells = 0;
  canopyWanted = 0;
  canopyM2 = 0;
  /**
   * WG-260. The mid tier's four, on the canopy's terms exactly so the two
   * rows can be read against each other: instances placed, cells that carried
   * any, the ask before quantisation, and the ground those cells cover.
   *
   * `midCards` is the split the eye verdict turns on rather than a tally: an
   * instance past `MID_CARD_M` is a four-triangle impostor and one inside it
   * is an authored cone, and a lane that reported only the total could not
   * tell "the band filled with trees" from "the band filled with billboards
   * at fifty pixels", which is the defect this tier exists to avoid.
   */
  midProps = 0;
  midCards = 0;
  midCells = 0;
  midWanted = 0;
  midM2 = 0;
  /**
   * WG-223. THE CROWN-SCALE SHADE FIELD'S OWN DISTRIBUTION, and it exists
   * because rendering.md 2.14.7b's verdict was a claim about a distribution
   * that nothing in this file could measure.
   *
   * That record judged `CANOPY_SHADE` worse and diagnosed it structurally:
   * "at a forest site `shadeW` is close to 1 across the entire visible floor,
   * so the term lands as a spatially UNIFORM cut". That is a statement about
   * the MEAN and the SPREAD of a field, and it had to be reached by putting two
   * screenshots side by side, because the only published number was the
   * resulting prop count. A sum, a sum of squares, a count and a max make the
   * same statement arithmetic: a field that saturates reads mean ~1 with
   * spread ~0, and a patchy one reads a mean near the middle with a real
   * spread. Reported as `canopyShadeMean` / `canopyShadeSd` / `canopyShadeMax`.
   *
   * Over cells where the field is non-zero, i.e. over ground that has any
   * canopy at all, because the mean over a whole planet's worth of bare rock
   * would answer a question nobody asked.
   */
  canopyShadeSum = 0;
  canopyShadeSq = 0;
  canopyShadeN = 0;
  canopyShadeMax = 0;
  /**
   * WG-223. THE SAME FOUR OVER THE PLANET WEIGHT, i.e. over exactly what
   * `shadeW` USED to be before the crown field was multiplied in.
   *
   * Two distributions over the identical cell set, in one run, is what turns
   * "it is patchy now" from an assertion into a measurement: the pair reads
   * `canopyPlanetMean` near 1 with a small spread (2.14.7b's saturation) beside
   * `canopyShadeMean` near the middle with a real one. Measuring the old shape
   * in the new build is also the only honest way to make the comparison, since
   * the before-arm binary has no counter to read.
   */
  canopyPlanetSum = 0;
  canopyPlanetSq = 0;
  /**
   * Cells the canopy was OFFERED, and the two ways it refused them.
   *
   * `canopyOfferedCells` is the denominator and it is not decoration. The first
   * measurement of this pass had both refusal counters reading exactly 0 at all
   * seven survey sites, and a bare 0 cannot be told apart from a term that
   * never ran: the treeline was in fact running and correct, and its refusing
   * case was simply unreachable, because the only biome that sat above the fade
   * had no canopy specs and therefore never entered this branch at all. With a
   * denominator, 0 of 46,000 and 0 of 0 are different rows.
   *
   * `canopySlopeCells` is the 44 degree gate; `canopyBareCells` is at or above
   * the treeline. Both must be non-zero SOMEWHERE in the world, and the site
   * where each becomes non-zero is named in the report, because a filter is
   * proved by the case it CATCHES and never by the case it ignores.
   */
  canopyOfferedCells = 0;
  canopySlopeCells = 0;
  canopyBareCells = 0;
  /**
   * Cells refused by `MIN_SLOPE_COS`, the 57 degree gate that has been in force
   * for every prop since RN-7 and has never been counted.
   *
   * It is here because the canopy's own 44 degree gate refused 0 of 241,053
   * cells across all seven survey sites, and before calling a gate inert it is
   * worth knowing whether the LOOSER gate above it fires either. The comment on
   * `MIN_SLOPE_COS` says 40 degrees "emptied the Mountains biome" because a
   * mountain flank is steeper than that almost everywhere, and that claim
   * predates WG-25's noise rework, which took the designed layer from 985 m
   * vertical walls to a worst grade of 87.54% over 100 m. If this counter is
   * also 0 then the world is gentler at cell scale than either constant
   * assumes, and both comments describe a planet that no longer exists.
   */
  slopeRejectCells = 0;
  /**
   * The worst DISPLACEMENT, in metres, between where a chunk's props were drawn
   * and where that chunk now is, and how many chunks carry any.
   *
   * A number rather than a picture on purpose. The suspected defect (this class
   * is not told about a floating-origin rebase) puts props kilometres from the
   * ground they were placed on, which at 4 km is not a wrong-looking forest but
   * an ABSENT one, and "the props vanished" is consistent with half a dozen
   * causes. This is the subtraction the defect IS, so it can only read non-zero
   * for one reason, and the size of the reading names the rebase delta.
   *
   * Must be 0.0 at all times. It is not a tolerance and it has no threshold: a
   * chunk that has been re-placed is re-placed exactly, in the same f64
   * subtraction `toEngine` does, so the correct value is a hard zero and
   * anything else is the bug.
   */
  staleMaxM = 0;
  staleChunks = 0;
}

/** What `Scatter.stats()` publishes. Consumed by Debug.ts's props panel. */
export interface ScatterStats {
  chunks: number; buildMs: number; propsPlaced: number; cellsScattered: number;
  groundM2: number; placedPerM2: number; wantedPerM2: number;
  deliveredFraction: number; cellsCapped: number; chunksCapped: number;
  scatterBacklog: number; chunksRefused: number;
  fairQuantise: boolean; wetCells: number;
  canopyRadiusM: number; canopyShade: boolean; canopyProps: number;
  canopyCells: number; canopyM2: number; canopyPerM2: number;
  canopyDelivered: number; canopyOfferedCells: number;
  canopySlopeCells: number; canopyBareCells: number; slopeRejectCells: number;
  canopyShadeMean: number; canopyShadeSd: number; canopyShadeMax: number;
  canopyShadeCells: number;
  canopyPlanetMean: number; canopyPlanetSd: number;
  /** WG-260. The mid tier, on the canopy row's own terms. `mid: false` IS
   *  the `?midhole=0` control and says so on the row (standing rule 7). */
  mid: boolean; midEdge: boolean;
  midProps: number; midCards: number; midCells: number;
  midM2: number; midPerM2: number; midDelivered: number;
  staleMaxM: number; staleChunks: number;
}

/** The four non-counter values the report also carries. */
export interface ScatterStatsDeps {
  readonly cellsCapped: number;
  readonly fair: boolean;
  readonly canopyRadiusM: number;
  readonly canopyShade: boolean;
  /** WG-260. `?midhole=0` and `?midedge=0`. */
  readonly mid: boolean;
  readonly midEdge: boolean;
}

  /**
   * `placedPerM2` against `wantedPerM2` is THE property this layer claims: the
   * scatter delivers the density the registry asks for, over the ground it
   * actually drew on, whatever LOD depth that ground came in at. It is a ratio
   * rather than a count so it cannot be satisfied by a terrain change, and it
   * is reported next to the two cap counters so a shortfall always has a named
   * cause instead of being absorbed into a tolerance.
   */
export function scatterStats(c: ScatterCounters, d: ScatterStatsDeps): ScatterStats {
  return {
    chunks: c.chunksScattered,
    buildMs: Math.round(c.lastBuildMs * 100) / 100,
    propsPlaced: c.propsPlaced,
    cellsScattered: c.cellsScattered,
    groundM2: Math.round(c.groundM2),
    placedPerM2: c.groundM2 > 0
      ? Math.round((c.propsPlaced / c.groundM2) * 1e5) / 1e5 : 0,
    wantedPerM2: c.groundM2 > 0
      ? Math.round((c.wantedProps / c.groundM2) * 1e5) / 1e5 : 0,
    deliveredFraction: c.wantedProps > 0
      ? Math.round((c.propsPlaced / c.wantedProps) * 1e4) / 1e4 : 0,
    cellsCapped: d.cellsCapped,
    chunksCapped: c.chunksCapped,
    scatterBacklog: c.backlog,
    chunksRefused: c.chunksRefused,
    fairQuantise: d.fair,
    wetCells: c.wetCells,
    // Standing rule 7: the isolation flags travel with the numbers, so a row
    // can never be attributed to the wrong run. `canopyRadiusM: 0` IS the
    // control and says so on the row.
    canopyRadiusM: d.canopyRadiusM,
    canopyShade: d.canopyShade,
    canopyProps: c.canopyProps,
    canopyCells: c.canopyCells,
    canopyM2: Math.round(c.canopyM2),
    canopyPerM2: c.canopyM2 > 0
      ? Math.round((c.canopyProps / c.canopyM2) * 1e5) / 1e5 : 0,
    canopyDelivered: c.canopyWanted > 0
      ? Math.round((c.canopyProps / c.canopyWanted) * 1e4) / 1e4 : 0,
    // The two refusal counters AND their denominator. Both must be non-zero
    // SOMEWHERE or the term that owns them is not running (DW-28, and the
    // `wetCells: 0` lesson: a zero at a site that cannot exhibit the case is
    // not evidence of anything).
    canopyOfferedCells: c.canopyOfferedCells,
    canopySlopeCells: c.canopySlopeCells,
    canopyBareCells: c.canopyBareCells,
    slopeRejectCells: c.slopeRejectCells,
    // WG-223. See `canopyShadeSum`. Zero cells reports zeros rather than NaN,
    // and `canopyShadeCells` is the denominator that tells the two apart.
    canopyShadeCells: c.canopyShadeN,
    canopyShadeMean: c.canopyShadeN > 0
      ? Math.round((c.canopyShadeSum / c.canopyShadeN) * 1e4) / 1e4 : 0,
    canopyShadeSd: c.canopyShadeN > 0
      ? Math.round(Math.sqrt(Math.max(0,
        c.canopyShadeSq / c.canopyShadeN
        - (c.canopyShadeSum / c.canopyShadeN) ** 2)) * 1e4) / 1e4 : 0,
    canopyShadeMax: Math.round(c.canopyShadeMax * 1e4) / 1e4,
    canopyPlanetMean: c.canopyShadeN > 0
      ? Math.round((c.canopyPlanetSum / c.canopyShadeN) * 1e4) / 1e4 : 0,
    canopyPlanetSd: c.canopyShadeN > 0
      ? Math.round(Math.sqrt(Math.max(0,
        c.canopyPlanetSq / c.canopyShadeN
        - (c.canopyPlanetSum / c.canopyShadeN) ** 2)) * 1e4) / 1e4 : 0,
    // WG-260. The mid tier's row. `midDelivered` is the RN-7 ratio for this
    // tier alone, so a shortfall here can never be absorbed into the ground
    // tiers' own `deliveredFraction`.
    mid: d.mid,
    midEdge: d.midEdge,
    midProps: c.midProps,
    midCards: c.midCards,
    midCells: c.midCells,
    midM2: Math.round(c.midM2),
    midPerM2: c.midM2 > 0
      ? Math.round((c.midProps / c.midM2) * 1e5) / 1e5 : 0,
    midDelivered: c.midWanted > 0
      ? Math.round((c.midProps / c.midWanted) * 1e4) / 1e4 : 0,
    // WG-64. Must be 0.000000. See `staleMaxM`.
    staleMaxM: Math.round(c.staleMaxM * 1e6) / 1e6,
    staleChunks: c.staleChunks,
  };
}
