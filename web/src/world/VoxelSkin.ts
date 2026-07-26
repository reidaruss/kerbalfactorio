// The near voxel mesh's SKIN: which faces belong to it, and what it is shaded
// with. Split out of VoxelMesh.ts so that file stays "geometry and placement"
// and both stay inside the 400-line cap.
//
// WHY A FILTER EXISTS AT ALL. `exposedFaces` answers "every solid-to-air face
// in this box", which is the right question for a mesher that owns the whole
// world and the wrong one for a mesh that SUPPLEMENTS the heightfield. Those
// are two different surfaces: /core's solidity is quantised to the 1 m lattice
// and the terrain chunk draws the smooth `surfaceRadius`, and they legitimately
// disagree by up to half a cell diagonal (DW-26). Every face the near mesh
// draws over ground the chunk already draws therefore pokes through it, and
// what pokes through the ground is the corner of a cube: at two or three metres
// from the eye a 1 m face fills a fifth of the screen, so the artifact reads as
// a field of big dark pyramids rather than as anything voxel-sized.
//
// The near mesh's actual job is the geometry the heightfield CANNOT express.
// That is a property of the derived surface, not of the edit sets, and it has
// to be asked that way. Levelling a pad taught it: `levelArea` flips only the
// cells that are on the wrong side of the target, so on a 1 m staircase the
// edited cells are a SCATTER, and drawing their faces gives isolated cubes
// standing out of a terrace the heightfield had already rendered correctly.
// Filtering to "faces of an edit" therefore fixed the untouched ground and left
// the pad looking exactly as broken.
//
//     keep a face iff the heightfield does not already cover it:
//       the SOLID cell sits above the derived surface  (placed ground the
//         raising cap or a gap under it leaves unrepresented), or
//       the AIR cell sits clearly below it              (a cavity: tunnel,
//         overhang, the wall of a shaft)
//
// A tunnel under intact ground reports `derivedLoweringAt` 0, so its air cells
// are metres below the surface and every face survives. A levelled pad, a dig
// mouth and untouched ground are all ON the derived surface, so they do not,
// and the terrain chunk draws them with the terrain's own colour and light.

import * as THREE from 'three';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { biomeColorArray, terrainAlbedo } from '../render/materials/BiomePalette.js';

/** 5 i32 per face as /core hands them over: [cx, cy, cz, axis, sign]. */
export const FACE_STRIDE = 5;

/**
 * How far below the derived surface an air cell must sit to count as a cavity.
 * A quarter of a cell: enough that the quantisation boundary layer (item 93's
 * 0.87 m staircase, DW-26's half-cell-diagonal bound) never qualifies, and far
 * less than the metres of clearance any real tunnel has.
 */
const CAVITY_MARGIN = 0.25;

export interface FilteredFaces {
  i32: Int32Array;
  count: number;
  /** Faces the heightfield already draws. The size of the artifact removed. */
  dropped: number;
}

/** Surface radius along a body-frame direction. The oracle's, never a copy. */
export type SurfaceRadiusFn = (dx: number, dy: number, dz: number) => number;

/**
 * Keep only the faces the heightfield cannot express. `src` is the raw scratch
 * view; the result is a fresh copy, so standing rule 5 holds for the caller.
 *
 * Two stages, cheap first. The edit test is two `unordered_set::count` calls on
 * a packed cell id with no terrain evaluation behind them and rejects the bulk
 * (measured: 78% of a levelling op's faces), so the surface test, which is a
 * real oracle call, only ever runs on the handful that survive.
 */
export function filterDrawnFaces(
  M: OfCoreModule, editsHandle: number, surfaceRadiusAt: SurfaceRadiusFn,
  cellM: number, src: Int32Array, count: number,
): FilteredFaces {
  const out = new Int32Array(count * FACE_STRIDE);
  let kept = 0;
  const radiusOf = (cx: number, cy: number, cz: number): [number, number] => {
    const x = (cx + 0.5) * cellM, y = (cy + 0.5) * cellM, z = (cz + 0.5) * cellM;
    const r = Math.hypot(x, y, z) || 1;
    return [r, surfaceRadiusAt(x / r, y / r, z / r)];
  };
  for (let f = 0; f < count; ++f) {
    const o = f * FACE_STRIDE;
    const cx = src[o], cy = src[o + 1], cz = src[o + 2];
    const axis = src[o + 3], sign = src[o + 4];
    const nx = cx + (axis === 0 ? sign : 0);
    const ny = cy + (axis === 1 ? sign : 0);
    const nz = cz + (axis === 2 ? sign : 0);
    // Stage 1: does this face belong to an edit at all? Untouched ground is the
    // terrain chunk's, and always was.
    const placed = M._of_edits_is_added_cell(editsHandle, cx, cy, cz) !== 0;
    if (!placed && M._of_edits_is_removed_cell(editsHandle, nx, ny, nz) === 0) continue;
    // Stage 2: does the heightfield already cover it?
    let keep = false;
    if (placed) {
      const [rs, surfS] = radiusOf(cx, cy, cz);
      keep = rs > surfS;                      // placed ground the surface missed
    }
    if (!keep) {
      const [ra, surfA] = radiusOf(nx, ny, nz);
      keep = ra < surfA - CAVITY_MARGIN;      // a genuine cavity
    }
    if (!keep) continue;
    const d = kept * FACE_STRIDE;
    out[d] = cx; out[d + 1] = cy; out[d + 2] = cz; out[d + 3] = axis; out[d + 4] = sign;
    kept++;
  }
  return { i32: out.subarray(0, kept * FACE_STRIDE), count: kept, dropped: count - kept };
}

/**
 * PER-VERTEX ALBEDO for the near voxel mesh, from the SAME palette and the same
 * slope-to-rock rule the terrain chunk beside it uses (BiomePalette).
 *
 * The mesh keeps a `MeshLambertMaterial`, so `Headlamp` stays the one lighting
 * authority and a tunnel still goes dark and still lifts when the lamp comes
 * on. Only the colour is imported. Getting this from anywhere else is how cut
 * rock ends up reading as a different substance from the hillside it is in.
 *
 * `positions` are metres relative to `anchorAbs` (standing rule 6). The normal
 * of every vertex is an axis of the body frame, so `dot(n, up)` varies across
 * the mesh and a face that happens to point up takes the biome's surface colour
 * while a wall takes rock, exactly as the terrain shader does it.
 */
export function faceColours(
  positions: Float32Array, normals: Float32Array,
  anchorAbs: readonly [number, number, number],
  bodyRadiusM: number, maxReliefM: number, biomeId: number,
): Float32Array {
  const palette = biomeColorArray();
  const biome = palette[Math.min(palette.length - 1, Math.max(0, biomeId))];
  const out = new Float32Array(positions.length);
  const c = new THREE.Color();
  const [ax, ay, az] = anchorAbs;
  for (let i = 0; i < positions.length; i += 3) {
    const x = ax + positions[i], y = ay + positions[i + 1], z = az + positions[i + 2];
    const r = Math.hypot(x, y, z) || 1;
    const flat = (normals[i] * x + normals[i + 1] * y + normals[i + 2] * z) / r;
    terrainAlbedo(biome, Math.max(0, flat), (r - bodyRadiusM) / Math.max(1, maxReliefM), c);
    out[i] = c.r; out[i + 1] = c.g; out[i + 2] = c.b;
  }
  return out;
}
