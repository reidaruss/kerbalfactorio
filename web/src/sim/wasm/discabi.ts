// The DISCOVERY half of the /core bridge (ABI 12): discovery.h, §18 of the shim.
//
// It lives in its own file rather than in heap.ts for the reason vesselabi.ts
// does, and it is not tidiness: heap.ts is at 347 of its 400-line cap and this
// surface plus the two scratch layouts it publishes would eat most of what is
// left. The wasm module is still ONE object; `discAbi(M)` is the single place
// the wider face is named, so there is exactly one cast in the client and every
// caller downstream of it is fully typed.
//
// WHAT THIS IS. DW-36: you cannot see what you have never been to. A cell is
// discovered when the observer has been somewhere it was above their horizon,
// and that one rule is read at TWO resolutions — a coarse SURVEY layer (~9.4 km
// cells, uncapped, the shape of the world, what the map shades) and a fine
// EXPLORE layer (~293 m cells, capped at 10 km of ground chord, the detail,
// what gates an ore patch). One 80 km lap therefore gives you the continents
// and a 20 km thread of detail under the ground track.
//
// THE CLIENT SHADES; IT DOES NOT DECIDE. Every geometric question here is
// /core's. A TypeScript horizon test would be a second authority over what the
// player has seen, and the saved set would then disagree with the drawn one.
//
// Standing rule 5 applies here as everywhere: call the producing export FIRST,
// then take the scratch view through heap.ts's helpers, and copy out before the
// next call into WASM.
import type { OfCoreModule } from './heap.js';

/** `layer` arguments, matching discovery.h's `Layer` enum exactly. */
export const DISC_SURVEY = 0;
export const DISC_EXPLORE = 1;

/** Fixed strides of the scratch this ABI writes. Named so a caller never types
 *  a magic number and a change here fails to compile rather than to run. */
export const DISC_REPORT_WORDS = 16;
/** Four corner directions, x,y,z each, per window row. */
export const DISC_WINDOW_ROW_WORDS = 12;
/** `of_map_sample` writes three doubles per sample. Indexed by `MapSample`. */
export const MAP_SAMPLE_WORDS = 3;

/** Field offsets within one `of_map_sample` sample. A reader that indexed by a
 *  bare number would be a second definition of the layout waiting to drift. */
export const MapSample = {
  /** /core's `Biome` enum, 0..9. **-1 means OFF THE LIMB**: the sample's line
   *  of sight misses the body entirely, so there is no ground under it. */
  biomeId: 0,
  /** `sampleDesignedHeight` — the surface oracle's designed base, metres. */
  heightM: 1,
  /** `of_disc_has(SURVEY, dir)`, 1 or 0. The painter's whole gate. */
  surveyed: 2,
} as const;

/** Field offsets into the f64 scratch `_of_disc_report` fills. */
export const DiscReport = {
  surveyCells: 0,
  exploreCells: 1,
  surveyFraction: 2,
  exploreFraction: 3,
  surveyCellSizeM: 4,
  exploreCellSizeM: 5,
  lastSurveyRadiusM: 6,
  lastExploreRadiusM: 7,
  lastSurveyAdded: 8,
  lastExploreAdded: 9,
  lastVisited: 10,
  budgetHit: 11,
  observations: 12,
  lastWindowRows: 13,
  lastWindowTruncated: 14,
  bodyRadiusM: 15,
} as const;

export interface DiscoveryAbi {
  // --- §18.1 the field -------------------------------------------------------
  /**
   * Build a fresh, EMPTY field at `bodyId`'s radius with the default tuning.
   * `bodyId` is §1's: 0 = Forge, 1 = Cinder. 1 on success, 0 for an unknown
   * body. Every other of_disc_* call refuses until this has succeeded.
   */
  _of_disc_reset(bodyId: number): number;
  /**
   * THE BOOT-SAFE FORM, and the one a construction path should call. Makes sure
   * a field for `bodyId` exists, resetting ONLY when there is none or the one
   * there is cut for a different body. 1 ok, 0 for an unknown body.
   *
   * USE THIS RATHER THAN `_of_disc_reset` ANYWHERE THAT RUNS DURING BOOT. The
   * save is applied EARLY and the map is built LATE, so a construction that
   * resets unconditionally wipes the field the load just restored — and then the
   * 20 s autosave writes the empty set back over the save and the player's
   * explored world is gone for good. `_of_disc_reset` stays unconditional
   * because a probe and a new world both want exactly that.
   */
  _of_disc_ensure(bodyId: number): number;
  /**
   * Re-tune and CLEAR (the cell targets change the LATTICE, and a key cut at one
   * cell size addresses different ground at another). 1 ok, 0 if not reset.
   *
   * TUNING IS DATA (GP-12), so balance moves from here without a code path
   * changing anywhere. A NON-POSITIVE field means "take /core's DEFAULT for that
   * field" — the default, not the value currently in force — so
   * `_of_disc_configure(0, 0, 0, 0, 0)` is exactly "back to stock".
   */
  _of_disc_configure(surveyCellM: number, exploreCellM: number,
                     horizonFraction: number, exploreMaxRadiusM: number,
                     maxCellsPerPass: number): number;
  /** Forget everything seen; keep the body and the tuning. */
  _of_disc_clear(): void;

  // --- §18.2 seeing ----------------------------------------------------------
  /**
   * One observation from a direction on the body (need not be unit) and a height
   * above the LOCAL SURFACE in metres. ONE call feeds BOTH layers, because there
   * is one rule. The walker's eye height is added inside /core, so no caller has
   * to remember it.
   *
   * -> cells ADDED across both layers (0 is the normal answer for standing
   * still, and it costs one dot product), or -1 if `_of_disc_reset` was never
   * called. Cost is O(area swept), never O(entities).
   */
  _of_disc_observe(dx: number, dy: number, dz: number, altM: number): number;
  /**
   * GP-716, ABI 25. REVEAL A WHOLE LAYER AT ONCE: `DISC_SURVEY` (the shape of
   * the world, what the map shades) or `DISC_EXPLORE` (the detail, what gates an
   * ore patch). -> cells ADDED, or -1 for a bad layer or no field, which is a
   * REFUSAL and not an answer on `_of_disc_has`'s precedent.
   *
   * NOT AN OBSERVATION. `_of_disc_observe` is the rule about SEEING and this is
   * a survey handed over, so it does not move `observations`. It DOES write real
   * cells, so it persists through `_of_disc_serialize` with every other
   * discovered cell and needs no save field of its own — which is exactly what
   * makes it different from `MapMode`'s sandbox `fullMapRevealed`, a mode
   * override that paints everything and saves nothing.
   */
  _of_disc_reveal(layer: number): number;
  /** f64 scratch, DISC_REPORT_WORDS, indexed by `DiscReport`. -> 16, or 0 if
   *  there is no field. Every figure was counted inside the call that made it. */
  _of_disc_report(): number;

  // --- §18.3 asking ----------------------------------------------------------
  /**
   * THE GATE. 1 / 0, or -1 for a bad layer or no field. -1 is a REFUSAL and not
   * an answer: never read "undiscovered" out of "I have no field".
   */
  _of_disc_has(layer: number, dx: number, dy: number, dz: number): number;
  /**
   * Discovered cells of `layer` whose CENTRE is within `cosMin` of the
   * direction, i.e. dot(centre, dir) >= cosMin.
   *
   * NO LONGER THE MAP'S DRAW CALL (DW-37, ABI 13) and currently uncalled by the
   * client. `of_map_sample` shades the map now, because a per-sample survey bit
   * is a finer and simpler mask than a 9,375 m quad AND it carries the terrain
   * the quads never could. This stays declared and exported: it is still the
   * right call for a CELL overlay (the pollution layer the enemies branch will
   * want), and it is not wrong, it is just not the shading source.
   *
   * -> the ROW count; f64 scratch holds DISC_WINDOW_ROW_WORDS per row: the
   * cell's FOUR corner directions, x,y,z each. Unit directions, so multiply by
   * the surface oracle's radius for positions.
   *
   * CORNERS AND NOT A CENTRE PLUS A SIZE, because the map projection is
   * orthographic: a cell near the limb foreshortens to a sliver, and a square
   * stamped at its centre would paint discovered ground over undiscovered.
   *
   * If more cells match than `maxRows`, exactly `maxRows` are emitted and
   * `DiscReport.lastWindowTruncated` goes to 1. The ceiling reports (DW-28).
   */
  _of_disc_window(layer: number, dx: number, dy: number, dz: number,
                  cosMin: number, maxRows: number): number;

  // --- §18.4 persistence (DW-17) ---------------------------------------------
  // The same three-call sequence `_of_edits_*` uses, deliberately, so a save
  // routine has one shape to learn. The u8 arena is SHARED with the edit diff
  // and the pack, so do one at a time.
  /** Write the discovered set into the u8 scratch. -> byte count, or -1. */
  _of_disc_serialize(): number;
  /** Size the u8 scratch to `n` bytes so JS can copy a saved set in. */
  _of_disc_alloc_bytes(n: number): void;
  /**
   * Load from the u8 scratch. -> total cells restored (survey + explore), or -1
   * on refusal: /core refuses a stream cut at a different cell size rather than
   * placing the discovered world somewhere it has never been.
   *
   * IT NEEDS NO FIELD FIRST. The stream carries the body radius, so this may be
   * called before anything has said which body the player is on — which is
   * exactly the browser's boot order, and used to make it return -1 every time.
   * The lattices are cut from the BYTES, so nothing here is a guess.
   *
   * A REFUSAL LEAVES THE FIELD AS IT WAS: `/core` is all-or-nothing across both
   * layers and across the lattice. (This comment used to say the opposite; that
   * was stale.) If there was no field, a -1 leaves there still being none.
   */
  _of_disc_deserialize(): number;

  // --- §19 the map samples the WORLD (ABI 14, DW-37 + WG-33) ------------------
  /**
   * THE GROUND, over a view region, at the resolution the view needs.
   *
   * DW-37: "cant see the terrain from the map, even in sandbox." Discovery
   * REVEALS terrain, so a map with no terrain has nothing to reveal. This is
   * what the map paints instead of an empty plane.
   *
   * `body` is a §1 body HANDLE (the height and the biome belong to the body, so
   * this is not the 0/1 bodyId the discovery calls take). `edits` is a §2
   * DensityField handle, or 0 for the pristine procedural world. `cx,cy,cz` is
   * the view centre in body-frame metres; `ux..`/`vx..` are the two in-plane
   * axes (right and up on screen, need not be unit); `spanM` is the metres the
   * `n` axis covers; `aspect` is width/height; `n` is the sample rows.
   *
   * THE HEIGHT IS `surfaceHeight`, THE ORACLE ITSELF (ABI 14, WG-33). It was
   * `sampleDesignedHeight` for one day, which is the world BEFORE the player
   * touched it: a dug hole, a levelled pad and a tunnel mouth could not reach
   * the map at all, however the painter shaded them. Passing `edits = 0` gives
   * bit-identically what ABI 13 returned.
   *
   * -> the SAMPLE COUNT written (n * round(n*aspect)), or 0 on refusal. The f64
   * scratch then holds MAP_SAMPLE_WORDS per sample, indexed by `MapSample`,
   * ROW-MAJOR AND TOP ROW FIRST, which is the order an ImageData wants.
   *
   * SPECIFIED IN VIEW-REGION TERMS RATHER THAN IN PIXELS, deliberately: DW-37
   * turns the map into a rotatable 3D camera next, and a centre plus two axes
   * plus a span plus a density is a question a camera asks too. The PAINTER on
   * the other side of this call is the half expected to be replaced.
   *
   * The ray solve is EXACT and transcendental-free: the projection is
   * orthographic, so the ground under a sample is a line meeting a sphere, which
   * is dot products and one sqrt (CE-11 / DW-15).
   */
  _of_map_sample(body: number, edits: number, cx: number, cy: number, cz: number,
                 ux: number, uy: number, uz: number,
                 vx: number, vy: number, vz: number,
                 spanM: number, aspect: number, n: number): number;
}

export type OfDiscoveryModule = OfCoreModule & DiscoveryAbi;

/** The ONE place the wasm module is widened to the discovery surface. */
export function discAbi(M: OfCoreModule): OfDiscoveryModule {
  return M as OfDiscoveryModule;
}
