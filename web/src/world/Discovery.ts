// =============================================================================
// Discovery.ts - the client's driver for `/core`'s discovery field (DW-36).
//
// WHAT IS DISCOVERED IS WORLD STATE, NOT UI STATE, so the authority is
// `core/include/of/discovery.h` and this file is a driver: it decides WHEN to
// take an observation and it caches the one query the map repaints from. It
// holds no opinion about what counts as seen. Read that header for the rule and
// the geometry; the short version is that a cell is discovered when it was above
// the observer's horizon, that height buys EXTENT and costs RESOLUTION, and that
// there are therefore two grids - SURVEY (coarse, what the map shades) and
// EXPLORE (fine, what gates an ore patch).
//
// ONE OBSERVER, BOTH REGIMES. It is fed from the app's current `ViewSource`,
// which is the walker on the ground and the vessel in flight, so climbing to
// orbit fills the map in continuously rather than at a mode change. That is the
// same argument DW-36 makes about the map itself and it would be strange to make
// it there and not here.
//
// THE SAMPLE INTERVAL IS 1 Hz, and it is DERIVED rather than copied. A pass is
// O(the disc), which is a few thousand cells from orbit, so it does not belong
// in a frame; enemies.h reached exactly the same conclusion for its pollution
// tick and for the same reason. The interval is only sound while the observer
// cannot move further between samples than one sample sweeps, or discovery would
// leave gaps along a fast ground track. That is a checkable property rather than
// a hope, so `gapRatio` publishes distance-moved over radius-swept and a probe
// asserts it stays under 1. On foot it is 5 m against 1,428 m; in an 80 km orbit
// it is 2.4 km against 10,000 m.
//
// Standing rule 5 is live in every method here: `ALLOW_MEMORY_GROWTH` detaches
// every ArrayBuffer when the heap grows, so no scratch pointer and no heap view
// survives a call into WASM. Every read below re-derives both.
// =============================================================================

// The ABI's own declarations, and NOT a second copy of them: `discabi.ts` is
// the one place the module is widened to the discovery surface, and it also
// publishes the scratch field offsets, so a reader that indexed the arena by a
// bare number here would be a second definition of the layout waiting to drift.
import { DISC_EXPLORE, DISC_SURVEY, DISC_REPORT_WORDS, DiscReport, discAbi }
  from '../sim/wasm/discabi.js';
import type { OfDiscoveryModule } from '../sim/wasm/discabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export { DISC_SURVEY, DISC_EXPLORE };

/** `of_disc_report`'s 16 doubles, named. The layout is pinned in the §18 block
 *  comment in `of_core_api.cpp` and restated here field for field, because a
 *  reader that indexes an arena by a bare number is a second definition of the
 *  layout waiting to drift. */
export interface DiscoveryStats {
  surveyCells: number;
  exploreCells: number;
  surveyFraction: number;
  exploreFraction: number;
  surveyCellSizeM: number;
  exploreCellSizeM: number;
  lastSurveyRadiusM: number;
  lastExploreRadiusM: number;
  lastSurveyAdded: number;
  lastExploreAdded: number;
  lastVisited: number;
  budgetHit: boolean;
  observations: number;
  lastWindowRows: number;
  lastWindowTruncated: boolean;
  bodyRadiusM: number;
}

/** One cached window of discovered cells, ready for the map to project. */
export interface DiscoveryWindow {
  corners: Float64Array;
  count: number;
  truncated: boolean;
  cellSizeM: number;
}

/** Seconds between observations. See the header: 1 Hz is sound while the
 *  observer cannot outrun one sweep, and `gapRatio` is the check on that. */
const SAMPLE_S = 1.0;
/** Rows one window may carry. A fully surveyed Forge is 98,304 cells, so this
 *  is not a limit that hides the world; it is a limit on how much crosses the
 *  bridge for ONE repaint, and `truncated` says when it bound. */
const WINDOW_ROWS = 8192;

export class Discovery {
  private ready = false;
  private sinceS = 0;
  /** Bumped whenever the field changes, so a cached window knows it is stale
   *  without comparing 8,192 rows. */
  private generation = 0;
  private lastObsX = 0;
  private lastObsY = 0;
  private lastObsZ = 0;
  private haveLast = false;
  /** Distance moved between the last two observations over the radius the last
   *  one swept. Below 1 means the samples overlap and discovery has no gaps. */
  gapRatio = 0;
  observeMsTotal = 0;
  observePasses = 0;
  windowMsTotal = 0;
  windowCalls = 0;
  private win: DiscoveryWindow | null = null;
  private winKey = '';

  private readonly M: OfDiscoveryModule;

  /**
   * `_of_disc_ensure`, NOT `_of_disc_reset`, and the reason is BOOT ORDER.
   *
   * The save is applied while the world is still coming up; this driver is
   * constructed later, when the map is built. An unconditional reset here
   * therefore wiped the field the load had just restored, and the 20 s autosave
   * then wrote the empty set back over the save — so a page reload lost
   * everything the player had explored, permanently. `ensure` resets only when
   * there is no field or the one there is cut for a different body, so a
   * restored world survives being constructed over.
   *
   * The other half of the same fix is in `/core`: the discovery stream carries
   * its own body radius, so the load no longer needs this constructor to have
   * run first. Either half alone still loses the world.
   */
  constructor(core: OfCoreModule, bodyId: number) {
    this.M = discAbi(core);
    this.ready = this.M._of_disc_ensure(bodyId) === 1;
  }

  get live(): boolean { return this.ready; }

  /**
   * FORGET EVERYTHING SEEN, keeping the body and the tuning.
   *
   * This is the discovery twin of `of.forgetTunnels()` and `of.repopulate()`,
   * and it exists for the reason those two do: DW-17's rule is that THE
   * DESTRUCTION IS THE POINT. A save/load round trip that never destroyed the
   * live field would be reading a number that never left memory, so without
   * this the one field DW-36 added is the one field DW-17 cannot actually
   * verify. `/core` has published `of_disc_clear` since ABI 12 for exactly
   * this; it simply had no caller.
   *
   * It resets the DERIVED state too. `gapRatio` and the last-observation point
   * describe a pass whose cells are no longer held, and `/core` drops its own
   * last-pass figures here for the same reason; a driver that kept them would
   * be reporting a live number about a field that no longer exists.
   */
  forget(): void {
    if (!this.ready) return;
    this.M._of_disc_clear();
    this.generation += 1;
    this.win = null;
    this.haveLast = false;
    this.gapRatio = 0;
    // The next observation lands on the NEXT step rather than up to a second
    // later, so a caller that forgets and then takes one pass gets exactly one.
    this.sinceS = SAMPLE_S;
  }

  /** Move the rule's dials. Everything is data (GP-12); a non-positive field
   *  keeps `/core`'s default for that field. Clears the field, so it is a
   *  new-world call and not a mid-game one. */
  configure(surveyCellM = 0, exploreCellM = 0, horizonFraction = 0,
            exploreMaxRadiusM = 0, maxCellsPerPass = 0): void {
    if (!this.ready) return;
    this.M._of_disc_configure(surveyCellM, exploreCellM, horizonFraction,
                              exploreMaxRadiusM, maxCellsPerPass);
    this.generation += 1;
    this.win = null;
  }

  /** Feed it. `pos` is body-frame metres (the eye or the feet, either is within
   *  a metre of the other at this grid's resolution); `altM` is height above the
   *  local surface, which the caller already has from the oracle. */
  step(dtS: number, pos: { x: number; y: number; z: number },
       altM: number): void {
    if (!this.ready) return;
    this.sinceS += dtS;
    if (this.sinceS < SAMPLE_S) return;
    this.sinceS = 0;
    const r = Math.hypot(pos.x, pos.y, pos.z);
    if (!(r > 0)) return;
    const dx = pos.x / r, dy = pos.y / r, dz = pos.z / r;
    const t0 = performance.now();
    const added = this.M._of_disc_observe(dx, dy, dz, altM);
    this.observeMsTotal += performance.now() - t0;
    this.observePasses += 1;
    // The interval's own check. Measured against the radius the pass ACTUALLY
    // swept, read back out of /core, rather than against a radius recomputed
    // here: a driver that re-derives the rule it is driving is the second
    // authority this project keeps paying for.
    if (this.haveLast) {
      const moved = Math.hypot(pos.x - this.lastObsX, pos.y - this.lastObsY,
                               pos.z - this.lastObsZ);
      const swept = this.stats().lastExploreRadiusM;
      this.gapRatio = swept > 0 ? moved / swept : 0;
    }
    this.lastObsX = pos.x; this.lastObsY = pos.y; this.lastObsZ = pos.z;
    this.haveLast = true;
    if (added > 0) { this.generation += 1; this.win = null; }
  }

  /** Has the SHAPE of the world at this direction been seen? */
  surveyed(dx: number, dy: number, dz: number): boolean {
    return this.ready && this.M._of_disc_has(DISC_SURVEY, dx, dy, dz) === 1;
  }

  /** Has the DETAIL been seen? This is the one that gates an ore patch. */
  explored(dx: number, dy: number, dz: number): boolean {
    return this.ready && this.M._of_disc_has(DISC_EXPLORE, dx, dy, dz) === 1;
  }

  stats(): DiscoveryStats {
    const z: DiscoveryStats = {
      surveyCells: 0, exploreCells: 0, surveyFraction: 0, exploreFraction: 0,
      surveyCellSizeM: 0, exploreCellSizeM: 0, lastSurveyRadiusM: 0,
      lastExploreRadiusM: 0, lastSurveyAdded: 0, lastExploreAdded: 0,
      lastVisited: 0, budgetHit: false, observations: 0, lastWindowRows: 0,
      lastWindowTruncated: false, bodyRadiusM: 0,
    };
    if (!this.ready) return z;
    const n = this.M._of_disc_report();
    if (n < DISC_REPORT_WORDS) return z;
    // Pointer AND view re-read after the call, never before and never cached.
    const p = this.M._of_scratch_f64();
    const a = this.M.HEAPF64.subarray(p >>> 3, (p >>> 3) + DISC_REPORT_WORDS);
    const R = DiscReport;
    return {
      surveyCells: a[R.surveyCells], exploreCells: a[R.exploreCells],
      surveyFraction: a[R.surveyFraction],
      exploreFraction: a[R.exploreFraction],
      surveyCellSizeM: a[R.surveyCellSizeM],
      exploreCellSizeM: a[R.exploreCellSizeM],
      lastSurveyRadiusM: a[R.lastSurveyRadiusM],
      lastExploreRadiusM: a[R.lastExploreRadiusM],
      lastSurveyAdded: a[R.lastSurveyAdded],
      lastExploreAdded: a[R.lastExploreAdded],
      lastVisited: a[R.lastVisited], budgetHit: a[R.budgetHit] !== 0,
      observations: a[R.observations], lastWindowRows: a[R.lastWindowRows],
      lastWindowTruncated: a[R.lastWindowTruncated] !== 0,
      bodyRadiusM: a[R.bodyRadiusM],
    };
  }

  /**
   * The discovered cells around a direction, for the map to shade.
   *
   * CACHED on (direction, cosMin, generation). The map repaints every frame and
   * a window is up to 8,192 rows of twelve doubles crossing the bridge; doing
   * that at 60 Hz for a picture that only changes when the view or the field
   * does would be a self-inflicted frame cost. The generation counter is what
   * makes the cache honest: it moves whenever `/core` accepted a new cell, so a
   * stale window is impossible rather than unlikely.
   */
  window(dx: number, dy: number, dz: number, cosMin: number,
         layer = DISC_SURVEY): DiscoveryWindow | null {
    if (!this.ready) return null;
    const key = `${layer}|${this.generation}|${dx.toFixed(6)},${dy.toFixed(6)},`
      + `${dz.toFixed(6)}|${cosMin.toFixed(9)}`;
    if (key === this.winKey && this.win !== null) return this.win;
    const t0 = performance.now();
    const rows = this.M._of_disc_window(layer, dx, dy, dz, cosMin, WINDOW_ROWS);
    this.windowMsTotal += performance.now() - t0;
    this.windowCalls += 1;
    if (rows <= 0) {
      this.win = { corners: new Float64Array(0), count: 0, truncated: false,
        cellSizeM: this.cellSizeM(layer) };
      this.winKey = key;
      return this.win;
    }
    const p = this.M._of_scratch_f64();
    const n = rows * 12;
    // COPIED out, not a subarray: the next call into WASM may grow the heap and
    // detach this buffer, and the map holds it across frames.
    const corners = new Float64Array(this.M.HEAPF64.subarray(p >>> 3,
                                                             (p >>> 3) + n));
    const st = this.stats();
    this.win = { corners, count: rows, truncated: st.lastWindowTruncated,
      cellSizeM: this.cellSizeM(layer) };
    this.winKey = key;
    return this.win;
  }

  private cellSizeM(layer: number): number {
    const s = this.stats();
    return layer === DISC_EXPLORE ? s.exploreCellSizeM : s.surveyCellSizeM;
  }

  /** The save's bytes. Delta-varint over a sorted key set in `/core`, so this is
   *  small; DW-17 puts it in the one atomic slot with everything else. */
  serialize(): number[] {
    if (!this.ready) return [];
    const n = this.M._of_disc_serialize();
    if (n <= 0) return [];
    const p = this.M._of_scratch_u8();
    return Array.from(this.M.HEAPU8.subarray(p, p + n));
  }

  /** Returns the cell count restored, or -1 when `/core` refused the stream
   *  (a different lattice, or not ours). A refusal is NOT silent: the caller
   *  reports it, because a world that quietly forgets what you explored is
   *  exactly the failure DW-17 exists to prevent. */
  deserialize(bytes: readonly number[] | null | undefined): number {
    if (!this.ready || bytes === null || bytes === undefined
        || bytes.length === 0) {
      return 0;
    }
    this.M._of_disc_alloc_bytes(bytes.length);
    const p = this.M._of_scratch_u8();
    this.M.HEAPU8.set(bytes as number[], p);
    const cells = this.M._of_disc_deserialize();
    this.generation += 1;
    this.win = null;
    return cells;
  }

  report(): unknown {
    const s = this.stats();
    return {
      ...s,
      gapRatio: Number(this.gapRatio.toFixed(4)),
      generation: this.generation,
      observeUsPerPass: this.observePasses === 0 ? 0
        : Math.round((this.observeMsTotal / this.observePasses) * 1000),
      windowUsPerCall: this.windowCalls === 0 ? 0
        : Math.round((this.windowMsTotal / this.windowCalls) * 1000),
      passes: this.observePasses, windows: this.windowCalls,
      saveBytes: this.ready ? Math.max(0, this.M._of_disc_serialize()) : 0,
    };
  }
}
