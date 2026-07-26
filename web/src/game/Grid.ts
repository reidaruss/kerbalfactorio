// THE BUILD GRID, and it is /core's, not ours.
//
// `of_cell_for_pos` and `of_cell_center` are the same 1 m voxel lattice the
// digging layer edits, so a belt and a tunnel agree about where a metre starts.
// A grid invented in JS would put the two half a cell apart everywhere, which is
// the class of bug that only shows up once belts have to line up with something.
//
// THE GROUND IS THE ORACLE's. The cell centre fixes the two tangent axes; the
// RADIUS then comes from `of_surface_radius`, so a machine cannot hover or sink
// even on a slope. Standing rule 1, one more time. Machines.ts has done exactly
// this since the furnace shipped; this module is that logic lifted out so the
// automation layer cannot grow a second, subtly different copy of it.
//
// AND THE EDIT SET IS A REQUIRED ARGUMENT, not a defaulted one. It used to be a
// literal 0 here, in Machines and in the build ghost's aim march, while
// OrePatches and Structures passed the live handle: half the build system read
// the world as it was BEFORE the player dug it. Measured (`probes/beltfloat.js`)
// the surface under the feet had moved 4.00 m after eight strikes. A default
// would let the next caller make the same mistake silently, so there is none.

import * as THREE from 'three';
import { scratchF64, scratchI32, type OfCoreModule } from '../sim/wasm/heap.js';

export interface Snapped {
  pos: { x: number; y: number; z: number };
  /** The ground normal at the snapped point. */
  up: THREE.Vector3;
  /** "cx,cy,cz": the lattice cell, and the identity a placement is keyed by. */
  cell: string;
}

/** The lattice cell containing a body-frame point, as a map key. */
export function cellKeyOf(M: OfCoreModule, x: number, y: number, z: number): string {
  M._of_cell_for_pos(x, y, z);
  const c = scratchI32(M, 3);
  return `${c[0]},${c[1]},${c[2]}`;
}

/** Snap to the lattice, then put the result back on the LIVE oracle surface. */
export function snapToGround(M: OfCoreModule, body: number, edits: number,
                             x: number, y: number, z: number): Snapped {
  M._of_cell_for_pos(x, y, z);
  const c = scratchI32(M, 3);
  const cx = c[0], cy = c[1], cz = c[2];
  M._of_cell_center(cx, cy, cz);
  const p = scratchF64(M, 3);
  const px = p[0], py = p[1], pz = p[2];
  const r = Math.hypot(px, py, pz) || 1;
  const dx = px / r, dy = py / r, dz = pz / r;
  const ground = M._of_surface_radius(body, edits, dx, dy, dz);
  return {
    pos: { x: dx * ground, y: dy * ground, z: dz * ground },
    up: new THREE.Vector3(dx, dy, dz),
    cell: `${cx},${cy},${cz}`,
  };
}

/**
 * Snap a direction to the nearest of four tangent quarter turns about `up`,
 * starting from `ref`. Rotation is 90 degrees because the grid is square: a
 * belt at 37 degrees cannot chain to the cell ahead of it.
 */
export function quarterTurn(up: THREE.Vector3, ref: THREE.Vector3,
                            quarters: number): THREE.Vector3 {
  const flat = ref.clone().addScaledVector(up, -ref.dot(up));
  if (flat.lengthSq() < 1e-9) flat.set(up.y, -up.x, 0);
  flat.normalize();
  return flat.applyAxisAngle(up, (quarters % 4) * Math.PI * 0.5).normalize();
}

/** The four tangent axes, so a snapped direction is one of exactly four. */
export function snapToAxes(up: THREE.Vector3, ref: THREE.Vector3,
                           basis: THREE.Vector3): THREE.Vector3 {
  const a = basis.clone().addScaledVector(up, -basis.dot(up));
  if (a.lengthSq() < 1e-9) a.set(up.y, -up.x, 0);
  a.normalize();
  const b = new THREE.Vector3().crossVectors(up, a).normalize();
  const f = ref.clone().addScaledVector(up, -ref.dot(up));
  if (f.lengthSq() < 1e-9) return a;
  f.normalize();
  const da = f.dot(a), db = f.dot(b);
  if (Math.abs(da) >= Math.abs(db)) return da >= 0 ? a : a.clone().negate();
  return db >= 0 ? b : b.clone().negate();
}

/**
 * A full orthonormal frame: local +Y on `up` and local +Z on `fwd`, PITCH
 * included.
 *
 * `orient` below only yaws, which is right for a machine standing on the
 * ground: it should be upright whatever the slope. It is wrong for a belt,
 * because a run of upright 1 m tiles on a hillside is a STAIRCASE, stepping by
 * the slope's rise every tile. A conveyor is inclined, so its tiles take the
 * run's own direction and a normal perpendicular to it. `fwd` must already be
 * perpendicular to `up`.
 */
export function frameOf(up: THREE.Vector3, fwd: THREE.Vector3): THREE.Quaternion {
  const z = fwd.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z));
  if (y.lengthSq() < 1e-9) return orient(up, fwd);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, z));
}

/** Stand local +Y on the ground normal, then yaw local +Z onto `fwd`. */
export function orient(up: THREE.Vector3, fwd: THREE.Vector3): THREE.Quaternion {
  const stand = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  const face = new THREE.Vector3(0, 0, 1).applyQuaternion(stand);
  face.addScaledVector(up, -face.dot(up));
  const want = fwd.clone().addScaledVector(up, -fwd.dot(up));
  if (face.lengthSq() < 1e-9 || want.lengthSq() < 1e-9) return stand;
  face.normalize(); want.normalize();
  const cross = new THREE.Vector3().crossVectors(face, want);
  const angle = Math.atan2(cross.dot(up), face.dot(want));
  return new THREE.Quaternion().setFromAxisAngle(up, angle).multiply(stand);
}
