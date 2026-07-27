// WHICH AUTHORITY THE WALKER STOOD ON, PER TICK.
//
// Reid: "constantly snapping back up to the surface then sinking". Two stills
// moments apart on the same platform read alt 2.2 m and alt 2.1 m, both
// GROUNDED, both 0.00 m/s. That is an OSCILLATION with the player stationary,
// and a per-frame reading cannot see it: `__of.world()` samples once per frame
// and a frame carries one to three fixed ticks, so a cycle whose period is a
// second is aliased into a number that looks merely noisy.
//
// So the trace is per TICK and it records the CANDIDATES separately, not just
// the answer. `terrainR` is what the terrain half of KinematicBody.step decided
// (surfaceRadius, or a voxel floor underground), `deckR` is what the structural
// port answered, and `groundR` is the one that won. Two systems taking turns is
// visible in the first two columns and invisible in the third.
//
// OFF BY DEFAULT and null-checked at the call site, so a world with no probe
// attached pays one null test per tick.

export interface StandSample {
  tick: number;
  /** Feet radius at the END of the tick, after every resolution and the snap. */
  feetR: number;
  /** What the terrain answered: surfaceRadius, or a voxel floor underground. */
  terrainR: number;
  /** What the structural port answered, or NaN when it answered nothing. */
  deckR: number;
  /** The one the ground snap actually used. */
  groundR: number;
  /** Radial displacement the integration asked for, before any resolution. */
  fallM: number;
  onDeck: boolean;
  grounded: boolean;
  blockedByBuild: boolean;
}

/**
 * A fixed-size ring of per-tick standing decisions.
 *
 * A ring rather than a growing array because a probe that runs the world for
 * ten seconds and forgets to stop would otherwise allocate for ever, and
 * because what a sinking bug needs is the LAST few hundred ticks, never the
 * first.
 */
export class StandTrace {
  private readonly buf: StandSample[] = [];
  private w = 0;
  /** Ticks seen since `reset`, which may exceed `cap`. */
  total = 0;

  constructor(readonly cap = 600) {}

  reset(): void { this.buf.length = 0; this.w = 0; this.total = 0; }

  push(s: StandSample): void {
    this.total++;
    if (this.buf.length < this.cap) { this.buf.push(s); return; }
    this.buf[this.w] = s;
    this.w = (this.w + 1) % this.cap;
  }

  /** Oldest first, so a consecutive-tick difference is a forward difference. */
  dump(): StandSample[] {
    if (this.buf.length < this.cap) return this.buf.slice();
    return this.buf.slice(this.w).concat(this.buf.slice(0, this.w));
  }
}
