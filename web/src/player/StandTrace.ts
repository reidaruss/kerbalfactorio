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

  // --- THE SECOND OSCILLATION, IN A TUNNEL (WG-31) -------------------------
  // GP-53 fixed the structural half of this and the same shape survived in the
  // voxel half, where the columns above cannot see it: `terrainR` is one number
  // whether it came from `surfaceRadius` or from `VoxelCollider.floorBelow`,
  // and only the second one was clamped to the querier. So the three fields
  // below say WHICH floor answered and WHAT corrected it afterwards.
  //
  // A floor query that ratifies is invisible in `groundR` alone, because a
  // ratified answer and a correct answer are both "the ground the snap used".
  // It becomes visible the moment `preSnapR` is beside it: a floor equal to the
  // radius the walker arrived at IS the walker's own position handed back.

  /** True while the feet rest on a VOXEL floor below the heightfield surface,
   *  i.e. `terrainR` came from `floorBelow` and not from `surfaceRadius`. */
  underRock: boolean;
  /**
   * The radius the walker ARRIVED at this tick, after gravity, the step
   * resolution and the structural resolution, and before the ground snap.
   *
   * `terrainR - preSnapR` is the ratification test, and it needs no threshold:
   * a floor that is a property of the world does not move when the querier
   * does, so this difference is a constant only when the query is honest.
   */
  preSnapR: number;
  /** Metres `resolveEmbedded` pushed the capsule out of solid rock, AFTER the
   *  snap. This is the correcting authority, and the snap-up the player sees. */
  pushM: number;
  /** The RADIAL component of that push, signed. Positive is the lift. */
  pushUpM: number;
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
