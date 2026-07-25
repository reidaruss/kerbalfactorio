// SURFACE / ASCENT / ORBIT band and the continuous blend factors
// (ARCHITECTURE.md section 3.5). Consumers read the factors; the band itself is
// only for logging and gameplay gating, never for rendering.
//
// The one discrete event is a chunk moving between the near and far scenes,
// which happens at 15 km or further, where the two representations are
// subpixel-identical because they come from the same oracle at the same anchor.

export type RegimeBand = 'SURFACE' | 'ASCENT' | 'ORBIT';

export interface RegimeState {
  band: RegimeBand;
  /**
   * The FINEST depth still allowed in the far scaled scene, plus one. A chunk
   * goes to the near 1:1 scene when `depth >= nearDepthCutoff`, so ALL_FAR
   * (above any reachable depth) puts the entire planet in the scaled scene.
   */
  nearDepthCutoff: number;
  altM: number;
}

const ASCENT_START = 2.0e3;
const ORBIT_START = 1.0e5;
/** Above every reachable quadtree depth, so nothing qualifies for the near scene. */
export const ALL_FAR = 99;

export class Regime {
  readonly state: RegimeState;

  constructor(private readonly baseCutoff: number) {
    this.state = { band: 'SURFACE', nearDepthCutoff: baseCutoff, altM: 0 };
  }

  /** Returns true when the discrete output changed and consumers must re-sort. */
  update(altM: number): boolean {
    const s = this.state;
    s.altM = altM;
    const band: RegimeBand = altM < ASCENT_START ? 'SURFACE'
      : altM < ORBIT_START ? 'ASCENT' : 'ORBIT';
    let cutoff: number;
    if (band === 'SURFACE') {
      cutoff = this.baseCutoff;
    } else if (band === 'ASCENT') {
      const t = (altM - ASCENT_START) / (ORBIT_START - ASCENT_START);
      cutoff = Math.round(this.baseCutoff - 2 * t);
    } else {
      // Above 100 km ALL terrain is scaled: nothing is close enough to need 1:1,
      // and the near camera's 100 km far plane would frustum-cull it anyway.
      cutoff = ALL_FAR;
    }
    const changed = band !== s.band || cutoff !== s.nearDepthCutoff;
    s.band = band;
    s.nearDepthCutoff = cutoff;
    return changed;
  }
}
