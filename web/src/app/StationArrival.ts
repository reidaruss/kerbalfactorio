// Where an arriving player's feet go: the deck-plane clearance scan. Split
// out of StationMount.ts (line-cap batch 2, BT-285): self-contained given
// only the live solid's pose and a collision query, called into by the seat
// group below but calling into nothing else in this file.

import { apply, newPose, type FramePose, type V3 } from '../world/FramePose.js';
import { lastStationSolid, stationStandLocal } from '../game/SpaceStation.js';
import { CAPSULE_SAMPLES_M } from '../player/VoxelCollision.js';
import { CAPSULE } from '../player/Capsule.js';

// ===========================================================================
// CE-49. WHERE THE FEET GO, AND WHY THE HUB CENTRE WAS NEVER IT.
// ===========================================================================
//
// REID'S BUG, ON A REAL GPU: the `visit:station` press seated him INSIDE A WALL.
// Grounded, 0.00 m/s, 398.11 km, carried correctly, and the left half of the
// frame solid black because the camera was inside interior geometry. Measured
// here at the seat point the press used: `solidBuild` reads TRUE at the feet AND
// at all three walker sample heights (0.15 / 0.9 / 1.65 m).
//
// THE CAUSE IS ONE WORD IN GP-234. It said "the station's local origin is both
// the hub centre and the deck's top face, so `pos` IS the spot to stand on".
// That was true of the PLACEHOLDER station, a 12 x 12 m hub with nothing in the
// middle. `SpaceStation.ts` says in as many words what the shipped asset did to
// it: "THE STATION'S ORIGIN IS NO LONGER EMPTY ... `col_HallCore` is a solid
// column from y = 0.000 to 5.400 spanning +/- 1.548 m in both horizontal axes,
// and the origin is inside it." The press kept aiming at the origin.
//
// AND THE RIGHT ANSWER WAS ALREADY PUBLISHED, TWICE, WHICH IS THE REAL LESSON.
// `stationStandLocal()` reads the asset's own `socket_hall` empty, 4 m off the
// core, and `StationReport.standPos` carries it in the body frame with the
// comment "Body-frame point a player arriving at the station should be placed
// at". The press had a correct point and a wrong point on the same object and
// took the wrong one. Nothing caught it because `probes/stationvisit.js`
// asserted `grounded`, `onDeck` and the distance from the hub CENTRE, and being
// inside the core satisfies all three: it is grounded, it is on the deck, and it
// is zero metres off centre. **A point can be exactly where you asked and still
// be inside a pillar.**
//
// SO THIS IS NOT A NEW AUTHORITY, IT IS THE EXISTING ONE MADE LIVE AND CHECKED.
// The socket is still the asset's; what this adds is that the offset is applied
// to the LIVE solid's pose rather than to the boot pose (PH-357's staleness, one
// layer up: `standPos` is computed at install and the station has moved 4,888 m
// by the time anybody presses the row), and that the result is VERIFIED against
// the walker's own collision predicate before the feet are put there.
//
// THE SCAN IS THE GUARD AND IT IS DETERMINISTIC. If the socket is clear, the
// socket is used and the scan never runs; that is the shipping case, measured.
// If a re-authored asset ever puts furniture on the spawn, this walks outward
// along the DECK PLANE in fixed rings and takes the first clear spot, with the
// ring order fixed so two runs of the same world produce the same metre. It
// invents no geometry: every test is `StructureBodies.blocks`, the exact call
// `KinematicBody` resolves the walker against, at the exact heights
// `CAPSULE_SAMPLES_M` gives it.


/** The walker's own collision query, structurally. `StructureBodies` satisfies
 *  it and is not imported: this file must not learn what a structure registry
 *  is, only what "is this point solid" means. */
export interface SolidQuery {
  blocks(x: number, y: number, z: number): boolean;
}

/** Directions tried per ring, and the ring spacing. 8 and 0.5 m give a 0.38 m
 *  arc at the first ring, well under the capsule's 0.4 m radius, so a clear
 *  pocket cannot be stepped over. */
const SCAN_DIRS = 8;
const SCAN_STEP_M = 0.5;
/** Past this the search has left the hall, and a spawn 12 m from the socket is
 *  not the room the button promised. Refusing is better than wandering. */
const SCAN_MAX_M = 12;

export interface StationArrival {
  /** Body-frame feet position. */
  pos: [number, number, number];
  /** How far along the deck the scan had to walk. 0 is the shipping case. */
  scannedM: number;
  /** False when nothing within `SCAN_MAX_M` was clear. The caller still seats
   *  the player (a menu press that silently does nothing is worse), and the
   *  probe asserts this is true so a re-authored asset fails loudly. */
  clear: boolean;
}

/**
 * CE-49. Is a whole capsule clear of every structure box at this LOCAL point?
 *
 * FIVE COLUMNS AND NOT ONE, because the capsule is 0.4 m in radius and its axis
 * being clear says nothing about its shoulders: the centre plus four offsets at
 * exactly `CAPSULE.radiusM` in the deck plane. Three heights each, and they are
 * `CAPSULE_SAMPLES_M` imported rather than retyped, because a probe or a helper
 * that wrote its own 0.15 / 0.9 / 1.65 would agree with itself and not with the
 * walker.
 */
export function capsuleClearAt(q: SolidQuery, pose: FramePose,
                        lx: number, ly: number, lz: number): boolean {
  const p: V3 = { x: 0, y: 0, z: 0 };
  const R = CAPSULE.radiusM;
  const cols: readonly [number, number][] =
    [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]];
  for (const [dx, dz] of cols) {
    for (const h of CAPSULE_SAMPLES_M) {
      apply(pose, lx + dx, ly + h, lz + dz, p);
      if (q.blocks(p.x, p.y, p.z)) return false;
    }
  }
  return true;
}

/**
 * CE-49. WHERE AN ARRIVING PLAYER'S FEET GO, in the body frame, right now.
 *
 * The asset's own spawn socket, carried by the LIVE solid's pose, verified
 * against the walker's own collision query, and scanned outward along the deck
 * only if that point is occupied. Returns null when there is no station.
 */
/**
 * CE-54. THE LIVE POSE OF THE STATION'S COLLISION SOLID, or null with no
 * station. The one local -> body transform for the ASSET'S OWN authored frame,
 * which is the frame `stationStandLocal` and every socket in the glb are
 * written in.
 *
 * Extracted from `stationArrivalBody` rather than written a second time,
 * because CE-54 gave it a second caller (`seatOnStationDeck`'s `localAt`) and
 * two spellings of "where is the station right now" is the two-authority shape
 * this file already argues against twice.
 *
 * NOT the carrier frame's pose. The frame's basis is LVLH from the record's own
 * r x v; the asset's is nadir-pointing from +Y, and the constant between them is
 * MEASURED at install (see this file's header). A caller that wants the spine
 * wants this one.
 */
export function stationSolidPose(out: FramePose): FramePose | null {
  const solid = lastStationSolid();
  if (solid === null) return null;
  // Not a second derivation of where the station is: it IS the collision body,
  // re-posed every fixed tick by `CarrierMount.syncAt`.
  out.px = solid.pos.x; out.py = solid.pos.y; out.pz = solid.pos.z;
  out.qx = solid.quat.x; out.qy = solid.quat.y;
  out.qz = solid.quat.z; out.qw = solid.quat.w;
  return out;
}

export function stationArrivalBody(q: SolidQuery): StationArrival | null {
  const pose = stationSolidPose(newPose());
  if (pose === null) return null;
  const [lx, ly, lz] = stationStandLocal();
  const out: V3 = { x: 0, y: 0, z: 0 };

  if (capsuleClearAt(q, pose, lx, ly, lz)) {
    apply(pose, lx, ly, lz, out);
    return { pos: [out.x, out.y, out.z], scannedM: 0, clear: true };
  }
  // RINGS OUTWARD IN THE DECK PLANE (station-local XZ; local +Y is up, which is
  // the whole reason the offset is applied in LOCAL space and transformed once).
  // Fixed order, so the same world seats at the same metre every time.
  for (let r = SCAN_STEP_M; r <= SCAN_MAX_M + 1e-9; r += SCAN_STEP_M) {
    for (let i = 0; i < SCAN_DIRS; i++) {
      const a = (2 * Math.PI * i) / SCAN_DIRS;
      const cx = lx + Math.cos(a) * r;
      const cz = lz + Math.sin(a) * r;
      if (!capsuleClearAt(q, pose, cx, ly, cz)) continue;
      apply(pose, cx, ly, cz, out);
      return { pos: [out.x, out.y, out.z], scannedM: r, clear: true };
    }
  }
  // Nothing clear. Seat at the socket anyway and say so: a press that refuses
  // leaves the player with no way to reach the station at all, and `clear:
  // false` is the loud reading a probe fails on.
  apply(pose, lx, ly, lz, out);
  return { pos: [out.x, out.y, out.z], scannedM: SCAN_MAX_M, clear: false };
}
