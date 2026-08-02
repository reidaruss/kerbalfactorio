// THE STATION'S TWO GRAVITY REGIONS (PH-100, PH-102).
//
// `SpaceStation.ts` composes an ORBIT (a VesselRecord on a conic) with an
// INTERIOR (a Solid in StructureBodies). This file adds the third thing those
// two cannot say between them: WHAT YOU WEIGH THERE. It is a separate file for
// the same reason those are two systems and not one -- and it deliberately
// does NOT edit SpaceStation.ts, because the Blender lane is live in that file
// swapping the placeholder interior for the authored mesh.
//
// TWO VOLUMES, AND THE PAIR IS THE DESIGN:
//
//   FREEFALL, ~120 m about the station. Cancels the carrier's acceleration.
//     This is what makes an EVA an EVA: step off the hull and you keep the
//     station's state of motion, which in the frozen-body-frame model of PH-94
//     is "at rest beside it", i.e. you float. Without this volume, leaving the
//     structure would drop you at 3.5 m/s^2, because the frozen station is
//     dynamically a tower and stepping off a tower is a fall.
//
//   GENERATOR, the hull plus a metre. Puts it back, while powered.
//     Inside a powered hull the apparent gravity is EXACTLY the true local
//     value (bit for bit -- see GravityVolumes.ts), so the deck behaves as the
//     tower PH-90 measured and not one figure taken then has to be re-taken.
//
// WHERE THE 120 m COMES FROM, STATED AS A CONCESSION RATHER THAN A DERIVATION.
// In reality a body that leaves a station keeps its orbital velocity and
// co-orbits indefinitely; there is no radius at which freefall stops. This
// model has no such thing to keep, because PH-94 froze the station in the body
// frame and its velocity is therefore zero. A bounded freefall region is the
// SECOND concession of the same family as PH-94's first ("the ground does not
// slide past underneath"), and it is labelled rather than dressed up.
//
// 120 m is three times the station's own 40 m corridor, which is enough room
// for a genuine EVA around the outside of it, and it is comfortably inside the
// 200 m at which `probes/stationwalk.js` P3 requires a player to FALL -- so
// that negative control still holds, and it now proves two things instead of
// one (no deck AND no frame). Straying past it is a real hazard with a real
// signal, which is the best that can be made of a fiction that has to end
// somewhere. The honest fix is a carrier frame in the walker, which is the same
// thing PH-94 named as the prerequisite for the station ever moving.

import * as THREE from 'three';
import type { Vec3n } from '../sim/VesselRegistry.js';
import { stationQuat, stationSolid } from './SpaceStation.js';
import {
  boundOfBoxes, extentOfBoxes, type GravityVolume, type GravityVolumes,
} from './GravityVolumes.js';
import type { LocalBox } from './StructureBody.js';

/** Half-extent of the freefall region about the station, metres. See header. */
export const STATION_FREEFALL_HALF_M = 120;
/**
 * How far outside the hull the generator still holds you, metres.
 *
 * Sized so the FRINGE lies entirely outside the structure: with the box grown
 * by 1.0 m and a 0.5 m fringe beyond that, no point a player can stand on is
 * ever at partial strength, so nobody ever weighs a fraction of themselves
 * while standing still on a deck. The fringe exists for the mode gate's
 * benefit (see `GravityVolume.fringeM`), not to be walked in.
 */
export const GENERATOR_MARGIN_M = 1.0;
export const GENERATOR_FRINGE_M = 0.5;

const FREEFALL_ID = -101;
const GENERATOR_ID = -102;

function box(min: [number, number, number],
             max: [number, number, number]): LocalBox {
  return { min, max, leaf: false };
}

/**
 * Is the station's artificial gravity running?
 *
 * MODULE STATE AND NOT A SAVED FIELD, deliberately, and this is the piece that
 * is owed rather than built (PH-103). A real generator is a placed, powered
 * entity with a draw on the electric budget, whose absence is what makes a
 * derelict a derelict. Today it is one boolean that ships TRUE, so `Anchorage`
 * is a working station and every green probe stays green, and the zero-g case
 * is reachable by turning it off. Nothing persists it, so a reload comes back
 * powered.
 */
let powered = true;

export function stationGravityPowered(): boolean { return powered; }

export function setStationGravityPowered(on: boolean): boolean {
  powered = on;
  for (const v of installed) if (v.mode === 'generator') v.powered = on;
  return powered;
}

let installed: GravityVolume[] = [];

export interface StationGravityReport {
  /** Gravity at the station's own centre: its freefall acceleration. */
  carrierG: number;
  freefallHalfM: number;
  /** Half-extents of the generator box in the station's own frame. */
  generatorHalf: [number, number, number];
  powered: boolean;
  volumes: number;
}

let lastReport: StationGravityReport | null = null;
export function lastStationGravity(): StationGravityReport | null {
  return lastReport;
}

/**
 * Put the station's gravity regions in the world.
 *
 * `carrierG` is passed IN rather than computed here, from the caller's own
 * `PlanetBody.gravityAccel`, so this file holds no opinion about how hard the
 * planet pulls (standing rule 1). It is the gravity at the station's CENTRE,
 * which for a body on a free trajectory is exactly its own acceleration.
 *
 * The generator box is derived from `stationSolid(pos).boxes` and NOT from the
 * `STATION_PROXIES` constant, which matters: SpaceStation.ts says the Blender
 * lane's swap is "a one-line change in `stationSolid`", so reading through that
 * function is what makes this file follow the real asset automatically instead
 * of quietly describing a placeholder that no longer exists.
 */
export function installStationGravity(volumes: GravityVolumes, pos: Vec3n,
                                      carrierG: number):
StationGravityReport | null {
  for (const v of installed) volumes.remove((w) => w === v);
  installed = [];

  const solid = stationSolid(pos);
  const ext = extentOfBoxes(solid.boxes);
  if (ext === null) return null;
  const quat = stationQuat(pos);
  const p = { x: pos[0], y: pos[1], z: pos[2] };
  const m = GENERATOR_MARGIN_M;

  const genBox = box(
    [ext.min[0] - m, ext.min[1] - m, ext.min[2] - m],
    [ext.max[0] + m, ext.max[1] + m, ext.max[2] + m],
  );
  const H = STATION_FREEFALL_HALF_M;
  const freeBox = box([-H, -H, -H], [H, H, H]);

  const mk = (id: number, mode: 'freefall' | 'generator',
              boxes: LocalBox[], fringeM: number, on: boolean): GravityVolume => ({
    id, mode, pos: p, quat, boxes,
    cx: pos[0], cy: pos[1], cz: pos[2], cr: boundOfBoxes(boxes),
    carrierG, fringeM, powered: on,
  });

  const free = mk(FREEFALL_ID, 'freefall', [freeBox], 0, true);
  const gen = mk(GENERATOR_ID, 'generator', [genBox], GENERATOR_FRINGE_M, powered);
  volumes.add(free);
  volumes.add(gen);
  installed = [free, gen];

  lastReport = {
    carrierG,
    freefallHalfM: H,
    generatorHalf: [
      (genBox.max[0] - genBox.min[0]) / 2,
      (genBox.max[1] - genBox.min[1]) / 2,
      (genBox.max[2] - genBox.min[2]) / 2,
    ],
    powered,
    volumes: volumes.count,
  };
  return lastReport;
}

/** Forget the installed volumes without touching the registry. */
export function resetStationGravity(): void { installed = []; }

/** Unused today; kept so a caller can name the axis without importing three. */
export function stationUp(pos: Vec3n): THREE.Vector3 {
  return new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
}
