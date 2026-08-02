// WHAT YOU WEIGH BESIDE A ROCKET IN ORBIT (PH-109, R54).
//
// Reid's question was "if I did an EVA outside of my rocket you should float
// around like you would in real life". PH-102 answered the half about a
// STRUCTURE and named the other half as owed: leaving a VESSEL was a different
// door, because `takeControlRemote` and `climbIn` only swap the camera and
// leave the body parked, so there was no "get out here".
//
// THE MEASUREMENT THAT SAID THE DOOR WAS ALREADY MOSTLY BUILT, and it is one
// sentence in `FlightMode` that nobody had read in this context:
//
//     "Parked: nothing steps the observer"   (FlightMode.frame)
//     "Nothing steps the observer until somebody is aboard"  (rollOut)
//
// A PROMOTED VESSEL WITH NOBODY ABOARD DOES NOT ADVANCE. Its `/core` FlightSim
// is live, its meshes are drawn, `syncToVessel` keeps the drawn instant equal to
// the sim's, and no tick moves it. It is therefore ALREADY frozen in the body
// frame, on exactly the terms PH-94 had to arrange deliberately for the station.
// The thing that looked like the blocker -- that the walker integrates an
// absolute position with no carrier term, so a body beside a vessel at 7.8 km/s
// separates at 7.8 km/s -- does not arise, because the vessel is not doing
// 7.8 km/s while you are outside it. It is doing nothing.
//
// So what was actually missing is what this file is: a FREEFALL VOLUME THAT
// SITS ON THE VESSEL. Without it a body placed beside a rocket at 200 km reads
// `gravityAccel(r)` = 8.6 m/s^2, which is fifty-seven times `ZEROG.floatG`, so
// the walker believes it has traction, the float gate never fires, and it falls
// out of the sky in the most literal possible sense.
//
// IT IS THE SAME TWO-VOLUME MODEL AS THE STATION'S, MINUS ONE VOLUME. A station
// carries freefall AND a generator, because a station has decks with plating in
// them. A rocket carries freefall alone: there is no artificial gravity aboard
// the Ascender and there is not meant to be. That asymmetry is the reason this
// is a separate file from `StationGravity.ts` rather than a flag on it -- and
// it is why both of them are thin wrappers over `GravityVolumes` rather than
// either of them owning the arithmetic.
//
// WHAT IT GIVES UP, stated rather than hidden, and it is PH-94's concession
// arriving a second time: the volume is BOUNDED, so there is a radius at which
// freefall stops. In reality a body that pushes off a spacecraft keeps its
// orbital velocity and co-orbits forever. This model has no such thing to keep,
// because the vessel it left is not moving either. Drift far enough and you
// fall, which is a real hazard with a real signal, and it is the best that can
// be made of a fiction that has to end somewhere. The honest fix is the same
// one PH-94 named: a carrier frame in the walker.

import * as THREE from 'three';
import type { Vec3n } from '../sim/VesselRegistry.js';
import { volumes, type GravityVolume } from './GravityVolumes.js';

/** Identity, hoisted so installing a volume allocates nothing. A freefall
 *  sphere has no orientation; see `installVesselFreefall`. */
const IDENTITY = new THREE.Quaternion();

/**
 * Half-extent of the freefall region about a vessel, metres.
 *
 * 60 m, and it is sized off two numbers this lane already owns rather than
 * chosen. It must comfortably exceed `BOARD_RANGE_M` (18 m), or a player could
 * drift out of freefall while still inside the range at which the game says
 * they may climb back in, which would be a rocket you can board while falling
 * past it. And it must stay well inside the 200 m at which `stationwalk.js` P3
 * requires a body to FALL, so that negative control keeps meaning what it says.
 * 60 m is 3.3x the first and 0.3x the second.
 */
export const EVA_FREEFALL_HALF_M = 60;

/**
 * How far to the side of the stack an EVA puts the body, metres.
 *
 * 6.0 m clears the widest part in the catalogue (class L is 2.50 m across, so
 * 1.25 m of hull radius) with room for the capsule, and it leaves the player
 * INSIDE the 18 m boarding range measured to the vessel's BASE rather than to
 * its origin (PH-32: the origin is the top of the stack, and measuring to it
 * adds the whole rocket's height). For the reference Ascender that is
 * hypot(6.0, 4.8) = 7.7 m, so getting back in is a key press and not a chase.
 */
export const EVA_STANDOFF_M = 6.0;

const VESSEL_FREEFALL_ID = -201;

let installed: GravityVolume | null = null;

export interface VesselGravityReport {
  /** The vessel's own freefall acceleration at its own position, m/s^2. */
  carrierG: number;
  halfM: number;
  /** Body-frame centre of the volume: the vessel's position. */
  pos: Vec3n;
  volumes: number;
}

let lastReport: VesselGravityReport | null = null;
export function lastVesselGravity(): VesselGravityReport | null { return lastReport; }

/** Is a vessel freefall volume live right now? The EVA's own state, and the one
 *  place it is held, so nothing has to infer it from `aboard`. */
export function evaActive(): boolean { return installed !== null; }

/**
 * Put a freefall region on a vessel.
 *
 * `carrierG` is passed IN from the caller's `PlanetBody.gravityAccel`, exactly
 * as `installStationGravity` takes it and for the identical reason: this file
 * holds no opinion about how hard the planet pulls (standing rule 1), and a
 * second gravity computed here is the transcription failure that once let the
 * walker fall at 0.587 m/s^2 while the propagator used 9.81.
 *
 * AXIS-ALIGNED IN THE BODY FRAME, with an identity rotation, and that is not
 * laziness. The station's volumes are posed because its decks are, and a deck
 * has an up. A sphere of freefall around a rocket has no orientation at all, so
 * giving it the vessel's attitude would mean the region a player floats in
 * changed shape when the rocket rolled, which is a thing no player could ever
 * predict and no probe would ever think to check.
 */
export function installVesselFreefall(pos: Vec3n, carrierG: number):
VesselGravityReport {
  removeVesselFreefall();
  const H = EVA_FREEFALL_HALF_M;
  const v: GravityVolume = {
    id: VESSEL_FREEFALL_ID,
    mode: 'freefall',
    pos: { x: pos[0], y: pos[1], z: pos[2] },
    quat: IDENTITY,
    boxes: [{ min: [-H, -H, -H], max: [H, H, H], leaf: false }],
    cx: pos[0], cy: pos[1], cz: pos[2], cr: Math.hypot(H, H, H),
    carrierG,
    // NO FRINGE, and the station's argument for having one does not apply. A
    // fringe exists so the float gate's hysteresis has a quantity that MOVES
    // through its band rather than stepping across it, which matters where a
    // player STANDS on a boundary. Nobody stands on this boundary: it is 60 m
    // of vacuum from the nearest surface, and a body that reaches it is already
    // travelling. A fringe here would only make the edge of the fiction wider.
    fringeM: 0,
    powered: true,
  };
  volumes.add(v);
  installed = v;
  lastReport = { carrierG, halfM: H, pos, volumes: volumes.count };
  return lastReport;
}

/** Take it away again: the player got back in, or the vessel went away. */
export function removeVesselFreefall(): void {
  if (installed === null) return;
  const gone = installed;
  volumes.remove((w) => w === gone);
  installed = null;
}

/**
 * Where an EVA puts the body, in the body frame.
 *
 * `pos` is the TOP of the stack and `baseOffsetM` is how far the base is below
 * it (PH-28: that offset SUBTRACTS, and getting its sign wrong once made a
 * rocket standing still on the ground read ALT AGL 19.20 m). So half of it down
 * the radial is the middle of the hull, which is where a hatch would be and
 * where the boarding range is measured most kindly from.
 *
 * The lateral direction is the SAME east the walker and the station both use
 * (`Y x up`), copied rather than re-derived. PH-24 is the reason that sentence
 * keeps appearing: `up x Y` makes the triad left-handed, every angle readout
 * survives it unharmed, and only a rotation exposes it.
 */
export function evaStandPoint(pos: Vec3n, baseOffsetM: number): Vec3n {
  const r = Math.hypot(pos[0], pos[1], pos[2]) || 1;
  const ux = pos[0] / r, uy = pos[1] / r, uz = pos[2] / r;
  // east = Y x up, written out: (0,1,0) x (ux,uy,uz) = (uz, 0, -ux).
  let ex = uz, ey = 0, ez = -ux;
  const el = Math.hypot(ex, ey, ez);
  if (el < 1e-9) { ex = 1; ey = 0; ez = 0; } else { ex /= el; ey /= el; ez /= el; }
  const d = baseOffsetM * 0.5;
  return [
    pos[0] - ux * d + ex * EVA_STANDOFF_M,
    pos[1] - uy * d + ey * EVA_STANDOFF_M,
    pos[2] - uz * d + ez * EVA_STANDOFF_M,
  ];
}
