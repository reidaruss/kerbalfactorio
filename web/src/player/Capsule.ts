// THE CAPSULE'S TUNABLES, and nothing else (WG-41).
//
// Split out of KinematicBody.ts, which had grown past the 400-line cap with the
// water work. The split is the right one regardless of the cap: a table of
// numbers that six modules read is not part of the solver that reads them, and
// every constant here carries the measurement that chose it, so the file is
// mostly the reasoning rather than the values.
//
// KinematicBody.ts re-exports CAPSULE, so every existing importer is unchanged.

/** Human-scale capsule. Heights are metres from the feet. */
export const CAPSULE = {
  radiusM: 0.4,
  heightM: 1.8,
  eyeHeightM: 1.62,
  /** Below this gap the feet re-attach to the ground instead of free-falling. */
  groundSnapM: 0.35,
  /**
   * THE STEP UP, and therefore THE WALL. The tallest the ground may be above
   * where the feet started a tick and still be walked onto. A lip under this is
   * a step; anything over it is a cliff and the horizontal move into it is
   * refused (`climbGate`).
   *
   * Before this existed the heightfield had no walls at all: `gap <= 0` read
   * "below the ground, therefore landing", so ONE tick's 7.7 cm of travel into
   * the foot of a cliff snapped the capsule to the top of it. Measured: the
   * walker climbed 12 m straight up out of a 10.4 m shaft it had just dug,
   * with rock 1.75 m ahead at eye height (walkfeel.js negative control). The
   * slope limit below did not catch it and cannot: it is sampled AFTER the
   * snap, so it reads the flat ground at the top of the cliff.
   *
   * 0.6 m is knee height on a 1.8 m capsule. It is over an order of magnitude
   * more than the 3.4 cm of real relief a walk across this terrain presents in
   * one tick, so it never fires on ordinary ground, and it is well under the
   * 1 m quantum the derived lowering moves in, so a hole you dig still needs a
   * jump or a ramp to get out of.
   */
  stepUpM: 1.1,
  /** cos(50 deg): steeper than this is a slide, not a walk (section 8.1). */
  slopeLimitCos: 0.6428,
  /**
   * Sized for FEEL, now that DW-18 has given Forge 9.81 m/s^2. 4.0 m/s gives a
   * 0.82 m apex and 0.82 s of airtime: a jump that clears a knee-high ledge and
   * lands, instead of the 4.8 second float the 0.587 m/s^2 density model
   * produced. Apex = v^2/2g, airtime = 2v/g; both are read back by the jump
   * probe rather than asserted here.
   */
  jumpSpeedMps: 4.0,
  groundAccel: 34.0,
  airAccel: 6.0,
  groundDrag: 11.0,
};
