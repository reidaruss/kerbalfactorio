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
import type { MapDiscovered, MapDiscoveryReadout, MapOre, V3 }
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
  ore: OrePatchSource | null;
  bodyRadiusM: number;
  /** `ModeRules`' answer, asked by name. */
  revealAll(): boolean;
  /** The gameplay item registry's display name for an opaque ItemId. World-gen
   *  never interprets the id (WG-11); the caller supplies the word. */
  itemName(id: number): string;
}

/** How many short-axis spans of ground the shading window reaches for. See the
 *  derivation in `shading`: half the diagonal of a 2.9:1 canvas is 1.53 spans. */
const WINDOW_SPANS = 1.6;

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
   * The discovered ground to shade, for a view of `spanM` metres centred on
   * `centreM`.
   *
   * THE WINDOW IS A HEMISPHERE AT MOST. The projection is orthographic, so
   * without that cap the far side of the body would project onto the same disc
   * as the near side and paint discovered ground over undiscovered from twelve
   * thousand kilometres away. `cosMin >= 0` is not a tuned limit, it is the
   * horizon of the projection itself.
   *
   * The angular radius comes from the span through the chord identity
   * `dot >= 1 - (c/R)^2 / 2`, the same transcendental-free form `discovery.h`
   * uses for its own cap, so the two agree by construction rather than by
   * coincidence.
   */
  shading(centreM: V3, spanM: number): MapDiscovered | null {
    const r = Math.hypot(centreM[0], centreM[1], centreM[2]);
    if (!(r > 0) || !Number.isFinite(spanM) || !(spanM > 0)) return null;
    const R = this.d.bodyRadiusM;
    if (!(R > 0)) return null;
    // THE RADIUS IS DERIVED, and the first draft of it was WRONG, which is worth
    // recording because it is standing rule 11's exact shape: 0.75 * spanM
    // "looked like plenty" and would have left the CORNERS of a wide panel
    // unshaded, reading as undiscovered ground the player had walked over.
    //
    // `spanM` is measured across the SHORT screen axis, so the farthest visible
    // point is the corner, at spanM/2 * sqrt(1 + aspect^2). WINDOW_SPANS covers
    // an aspect up to 2.9:1 with a cell of margin left over, which is wider than
    // any panel the map is ever given; a canvas wider still would under-fetch
    // rather than mis-draw, and `MapDiscovered.truncated` is the other end of
    // the same honesty.
    //
    // AND THE MARGIN IS MEASURED IN CELLS AS WELL AS IN SPANS (WG-29 probe).
    // `_of_disc_window` selects on the cell's CENTRE, so a margin proportional
    // only to the view misses a cell WIDER than the view ENTIRELY: a survey cell
    // is 9,375 m across and the map opens on foot at a 600 m span, so the cell
    // under the player's own feet has its centre up to 6.6 km away and was
    // dropped. Measured before this line existed: `alphas.discovered` stepped
    // 0 -> 1 in ONE zoom notch somewhere between a 1,207 m and a 1,388 m span,
    // and WHERE it stepped depended on where in the cell the player happened to
    // be standing. A 1 -> 0 step in that number is the exact signature DW-36
    // forbids and `MapTypes`' header promises a probe will catch, so the fix is
    // the half-diagonal of the cell itself rather than a larger multiple of the
    // span, which would have moved the step rather than removed it.
    const half = this.d.disc.stats().surveyCellSizeM * Math.SQRT1_2;
    const u = (spanM * WINDOW_SPANS + half) / R;
    let cosMin = 1.0 - 0.5 * u * u;
    if (cosMin < 0) cosMin = 0;
    if (cosMin > 1) cosMin = 1;
    const w = this.d.disc.window(centreM[0] / r, centreM[1] / r, centreM[2] / r,
                                 cosMin);
    if (w === null || w.count === 0) return null;
    return { corners: w.corners, count: w.count, truncated: w.truncated,
      cellSizeM: w.cellSizeM };
  }

  /** Throw away what has been seen. The discovery half of `of.repopulate()`,
   *  and it is here rather than only on `Discovery` because a probe reaches
   *  this layer and not that one. DW-17's rule is that the destruction is the
   *  point: a save/load round trip over a field that was never destroyed reads
   *  a number that never left memory. */
  forget(): void { this.d.disc.forget(); }

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
    };
  }
}
