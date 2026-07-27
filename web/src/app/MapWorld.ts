// =============================================================================
// MapWorld.ts - the world half of a MapScene: what is on the ground, and how
// much of it you are allowed to see.
//
// Lifted out of MapMode because they are different jobs. MapMode owns the node,
// the view and the focus; this owns the two questions DW-36 added, which are
// "what has been discovered" and "which ore patches may therefore be drawn".
//
// THE DISCOVERY GATE IS HERE AND NOWHERE ELSE. An undiscovered patch is ABSENT
// from the array the painter receives, rather than present and skipped at paint
// time. That is deliberate and it is the difference between a rule and a habit:
// with one gate, a drawing bug cannot leak a patch, because the painter never
// held one. The negative control for this lane is exactly that assertion, so it
// wants a single place to be true.
//
// THE MODE IS ASKED BY NAME (DW-31, DW-36). `revealAll` arrives as a port fed
// from `ModeRules`, never from a raw `sandbox` boolean and never from a URL
// read a second time. GameMode.ts's own comment is the argument: that object
// exists so a branch written months later gets the right answer without anybody
// remembering to add an or-clause, and this is that branch.
// =============================================================================
import type { Discovery } from '../world/Discovery.js';
import type { MapTerrain } from '../world/MapTerrain.js';
import type { MapTerrainGrid, MapDiscoveryReadout, MapOre, V3 }
  from '../ui/MapTypes.js';

/** The slice of the ore field this needs, named structurally so the map depends
 *  on no gameplay module: a count and a per-index read of `/core`'s own patch
 *  record. `remaining` here IS `OrePatch::RemainingAmount`, carried across
 *  unrounded and unformatted. */
export interface OrePatchSource {
  readonly count: number;
  patch(i: number): {
    centre: { x: number; y: number; z: number };
    dir: { x: number; y: number; z: number };
    radiusM: number;
    resource: number;
    grade: number;
    initial: number;
    remaining: number;
  } | null;
}

export interface MapWorldDeps {
  disc: Discovery;
  /** The ground itself (DW-37), or null when there is no body to sample. */
  terrain: MapTerrain | null;
  ore: OrePatchSource | null;
  bodyRadiusM: number;
  /** `ModeRules`' answer, asked by name. */
  revealAll(): boolean;
  /** The gameplay item registry's display name for an opaque ItemId. World-gen
   *  never interprets the id (WG-11); the caller supplies the word. */
  itemName(id: number): string;
}

export class MapWorld {
  /** Patches skipped because the ground they sit on has never been explored.
   *  Published rather than discarded: "you have found 3 of 11" is the sentence
   *  that makes discovery feel like progress instead of like an empty map, and a
   *  probe reads it to prove the gate did something. */
  hidden = 0;

  constructor(private readonly d: MapWorldDeps) {}

  /**
   * The ore bodies the map may draw, in `/core`'s own numbers.
   *
   * Nothing here rounds, scales or re-derives an amount. `remaining` is the
   * patch's one mutable field read straight through the bridge, which is the
   * point of Factorio's model and of DW-25's ONE POOL: a second counter for one
   * ore body shows up as a mountain that stands full for ever while its ore
   * rides away on a belt.
   */
  ore(): MapOre[] {
    this.hidden = 0;
    const src = this.d.ore;
    if (src === null) return [];
    const out: MapOre[] = [];
    const reveal = this.d.revealAll();
    for (let i = 0; i < src.count; i++) {
      const p = src.patch(i);
      if (p === null) continue;
      if (!reveal && !this.d.disc.explored(p.dir.x, p.dir.y, p.dir.z)) {
        this.hidden += 1;
        continue;
      }
      out.push({
        centre: [p.centre.x, p.centre.y, p.centre.z] as V3,
        radiusM: p.radiusM,
        remaining: p.remaining,
        initial: p.initial,
        grade: p.grade,
        resource: p.resource,
        name: this.d.itemName(p.resource),
      });
    }
    return out;
  }

  /**
   * THE GROUND UNDER THE VIEW (DW-37), sampled through `/core`.
   *
   * This replaced a window of discovered CELLS painted as flat quads. The quads
   * answered "what have you seen" and said nothing at all about "what is there",
   * so the map was every instrument correct over an empty plane — and since
   * discovery REVEALS terrain, a map with no terrain has nothing to reveal.
   *
   * NO MARGIN AND NO WINDOW RADIUS IS DERIVED HERE ANY MORE, and that whole
   * class of bug goes with them. The old path selected discovery cells by their
   * CENTRE, so it had to reason about how far a cell wider than the view could
   * reach, and getting that wrong put a 0 -> 1 step in `alphas.discovered`
   * inside one zoom notch. A sample has no extent, the grid is cut to the
   * canvas, and every sample is inside the view by construction.
   *
   * IT IS NOT GATED HERE. The mask rides on each sample and the painter applies
   * it against the mode, which is the finer place to ask: `MapWorld.ore()`
   * remains the ONE gate for PATCHES, and the survey bit is the one gate for
   * GROUND. Both come from the same field.
   */
  terrain(centreM: V3, u: V3, v: V3, spanM: number,
          view: { w: number; h: number }): MapTerrainGrid | null {
    const t = this.d.terrain;
    if (t === null) return null;
    return t.sample(centreM, u, v, spanM, view.w, view.h);
  }

  /** Throw away what has been seen. The discovery half of `of.repopulate()`,
   *  and it is here rather than only on `Discovery` because a probe reaches
   *  this layer and not that one. DW-17's rule is that the destruction is the
   *  point: a save/load round trip over a field that was never destroyed reads
   *  a number that never left memory. */
  forget(): void {
    this.d.disc.forget();
    // The picture goes with the field it was cut from. Without this the cached
    // grid would out-live its own survey mask for one repaint, which is exactly
    // the stale-cache failure the generation counter exists to make impossible.
    if (this.d.terrain !== null) this.d.terrain.forget();
  }

  readout(): MapDiscoveryReadout {
    const s = this.d.disc.stats();
    return {
      surveyCells: s.surveyCells,
      exploreCells: s.exploreCells,
      surveyFraction: s.surveyFraction,
      exploreFraction: s.exploreFraction,
      lastSurveyRadiusM: s.lastSurveyRadiusM,
      lastExploreRadiusM: s.lastExploreRadiusM,
      cellSizeM: s.surveyCellSizeM,
      revealAll: this.d.revealAll(),
    };
  }

  report(): unknown {
    return {
      hiddenPatches: this.hidden,
      revealAll: this.d.revealAll(),
      discovery: this.d.disc.report(),
      terrain: this.d.terrain === null ? null : this.d.terrain.report(),
    };
  }
}
