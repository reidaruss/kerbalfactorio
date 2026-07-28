// FS-87: DO THESE TWO PORTS MEET, AND BY HOW MUCH DO THEY MISS.
//
// Split out of `FactoryPorts.ts` when FS-76's signed measurement pushed that file
// past its 400-line cap. The seam was already there and naming it is worth the
// move: `FactoryPorts` answers WHERE a building's ports are, which is a question
// about assets and poses, and this answers WHETHER two of them mate, which is a
// question about three bounds and a bit of vector arithmetic. The first needs the
// shipped files and a plan; the second needs four numbers.
//
// All three bounds live here together on purpose. They are not independent: the
// separation argument for `PORT_MATE_M` is what makes `PORT_BEHIND_M` a fraction
// of it rather than a fresh guess, and `PORT_FACE_DOT` is the reason neither has
// to worry about a belt running PAST a machine. Splitting them across files is
// how the next lane retunes one and silently invalidates another's reasoning.
//
// Re-exported from `FactoryPorts` so that no existing importer moved.

import * as THREE from 'three';
import type { PortWorld } from './FactoryPorts.js';

/**
 * HOW FAR APART TWO MATING PORTS MAY BE, in the tangent plane, in metres.
 *
 * 0.65, and it is DERIVED rather than picked. Machines stand on a 1.000 m site
 * grid (`MACHINE_TILE_M`) and a smelter is 2.000 m across, so FS-26's snap puts
 * a smelter exactly two cells from the belt head that feeds it. Work the
 * geometry through with the socket positions in the header: the belt's outlet is
 * 0.500 m ahead of the tile's centre, the smelter's inlet is 1.000 m behind its
 * own, the centres are 2.000 m apart, and the two port points therefore stand
 * exactly 0.500 m apart. That 0.500 m is not slack. It is the even-footprint
 * residual that `FactorySnap.stepsFor` already names and explains: a 2 m machine
 * on a 1 m grid cannot have its face meet a 1 m tile's face, and closing it
 * needs a half-cell placement rule that is a placement decision and not a
 * wiring one.
 *
 * The rest is the ground. The site grid measures 1.002 m per cell on the shipped
 * world rather than 1.000, which adds 0.002 m over two cells, and on a slope the
 * two parts pitch by different amounts so their sockets swing a few centimetres
 * out of the shared tangent plane. 0.65 covers both with room and is still
 * nowhere near the distances the refusals have to stay clear of: a belt arriving
 * at a smelter's SIDE puts its outlet 1.80 m from the nearest inlet, and a belt
 * stopping one cell short puts it 1.50 m away. The bound separates the cases by
 * a factor of well over two, which is the property that matters, and
 * `probes/machineports.js` measures all three rather than trusting this
 * paragraph.
 */
export const PORT_MATE_M = 0.65;

/**
 * FS-76: HOW FAR BEHIND AN OUTLET'S OWN FACE THE INLET IT FEEDS MAY SIT.
 *
 * `PORT_MATE_M` bounds a magnitude and therefore accepts a port that has passed
 * THROUGH the face it was supposed to meet. This bounds the sign, and it is a
 * separate number because the two populations it separates are not symmetric.
 *
 * DERIVED, AND DELIBERATELY NOT ZERO, because standing rule 8 forbids
 * discriminating on the sign of a computed float. Two belt tiles mate socket to
 * socket at 9.245e-7 m (FS-26), so their `alongM` is zero to within float noise
 * and a `> 0` test would put half of every straight run on the wrong branch,
 * intermittently, which is exactly the -0.0 defect rule 8 was written for. The
 * two populations have to be pushed into DISJOINT ranges instead:
 *
 *   legitimate   belt to belt about 0.000, belt to machine about +0.506, less a
 *                few centimetres of slope wobble where two parts pitch by
 *                different amounts. Worst case a small negative, order -0.05.
 *   illegitimate one whole grid cell too close, which is the coarsest error the
 *                lattice can produce and the one a rescale creates: the mating
 *                gap less one cell, about -0.496.
 *
 * Half of `PORT_MATE_M` sits between them at -0.325, about 6x clear of the worst
 * legitimate reading and about 1.5x clear of the best illegitimate one, and it is
 * expressed as a fraction of the mating envelope rather than picked so that
 * widening that envelope widens this with it. `probes/rescale.js` measures both
 * populations rather than trusting this paragraph.
 */
export const PORT_BEHIND_M = PORT_MATE_M * 0.5;

/**
 * How nearly two mating ports must face each other, as a dot product.
 *
 * -0.85 is about 31 degrees. Two parts on flat ground that face each other score
 * exactly -1; a belt running PAST a machine scores 0 or +1; a belt arriving at a
 * machine's side scores 0. On a hillside the two pitch differently and the score
 * drifts off -1 by a few hundredths, which is the only reason this is not -0.99.
 */
export const PORT_FACE_DOT = -0.85;

/** What two ports measure against each other. Reported whether they mate or not,
 *  because "why did this not connect" is answered by the numbers. */
export interface PortFit {
  /** Distance between the two port points, projected into the tangent plane. */
  gapM: number;
  /**
   * FS-76: THE SAME SEPARATION, SIGNED, ALONG THE OFFERING PORT'S OWN FACE.
   *
   * `gapM` is a `Math.hypot`, which is a MAGNITUDE, and a magnitude cannot tell
   * "the inlet is 0.50 m ahead of my outlet" from "the inlet is 0.50 m BEHIND
   * my outlet, i.e. my belt's last half metre is inside that housing". Those two
   * arrangements are a working line and a belt buried in a machine, and until
   * this field existed they produced the identical number and the identical
   * green indicator everywhere: the ghost, the crosshair, the report and every
   * probe.
   *
   * That is not hypothetical and it is the reason this pass exists. A
   * `SaveBuilding` records `pos` and carries no footprint, so taking the smelter
   * from 2 m to 4 m moves its inlet 1.0 m outward while every saved belt stays
   * put. On a world saved at the old size the inlet lands 0.5 m PAST the belt's
   * end, `gapM` reads 0.500 exactly as it always did, `mated` stays true, and the
   * base is connected and geometrically wrong at the same time. INSTRUMENTS.md
   * calls that a control that cannot report the defect it exists to catch.
   *
   * Positive is ahead of the face, which is the only arrangement that is real.
   */
  alongM: number;
  /** How far apart they are along `up`. Measured and reported, never gated: a
   *  hopper mouth is deliberately higher than a belt deck. */
  riseM: number;
  /** Dot of the two faces. -1 is head on. */
  facing: number;
  /** All three rules passed. */
  mated: boolean;
}

/**
 * Does an OUT port hand off to an IN port, and by how much does it miss?
 *
 * The gap is measured in the TANGENT PLANE and the rise is measured separately,
 * which is the one piece of this that is not obvious. A smelter's inlet is
 * authored at 0.90 m up its housing and a belt's deck at 0.25 m, so the two port
 * points are 0.65 m apart vertically BY DESIGN: the ore falls into the hopper.
 * Gating on the straight-line distance would therefore have refused the one
 * arrangement the assets were built for, and tuning the bound up to 0.90 to
 * absorb it would have let a belt at a machine's side back in through the side
 * door. Separating the two measurements keeps the bound honest and makes the
 * vertical drop a number the report carries rather than a constant nobody knows
 * about.
 */
export function fitOf(from: PortWorld, to: PortWorld,
                      up: THREE.Vector3): PortFit {
  const dx = to.world.x - from.world.x;
  const dy = to.world.y - from.world.y;
  const dz = to.world.z - from.world.z;
  const rise = dx * up.x + dy * up.y + dz * up.z;
  const gap = Math.hypot(dx - up.x * rise, dy - up.y * rise, dz - up.z * rise);
  const facing = from.face.dot(to.face);
  const along = dx * from.face.x + dy * from.face.y + dz * from.face.z;
  return {
    gapM: gap, alongM: along, riseM: rise, facing,
    mated: from.dir === 'out' && to.dir === 'in'
      && gap <= PORT_MATE_M && along > -PORT_BEHIND_M && facing <= PORT_FACE_DOT,
  };
}
