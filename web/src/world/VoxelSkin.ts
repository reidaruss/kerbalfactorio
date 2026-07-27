// The near voxel mesh's SKIN: what it is shaded with. Split out of VoxelMesh.ts
// so that file stays "geometry and placement" and both stay inside the 400-line
// cap.
//
// WG-24 removed the other half of this file. `filterDrawnFaces` decided which of
// /core's exposed CUBE FACES the near mesh owned, by asking whether the derived
// surface already covered each one. It existed because the mesher answered "every
// solid-to-air face in this box", which is right for a mesher that owns the world
// and wrong for one that supplements the heightfield, and because the 1 m
// occupancy shell and the smooth surface legitimately disagreed by up to half a
// cell diagonal (DW-26), so every redundant face poked through the ground as the
// corner of a cube: at two or three metres a 1 m face fills a fifth of the screen,
// which is why the artifact read as a field of dark pyramids rather than as
// anything voxel-sized.
//
// Both reasons are gone. The mesher extracts the zero level of the same signed
// field collision reads, so there is no shell standing proud of anything, and the
// ownership question is now asked in /core directly of the edit store ("is this
// cell near a corner the player changed"), which is the honest form of it: it was
// only ever reconstructed from surface heights here because the client was the
// last place that knew which faces were candidates.
//
// What remains is the colour. It comes from the terrain's own biome palette and
// slope-to-rock rule, so a tunnel mouth and the hillside it is cut into read as
// one substance. Four lines of TerrainShader.ts are duplicated in TypeScript
// because GLSL cannot be called from here; the duplication is named in both files.

import * as THREE from 'three';

import { biomeColorArray, terrainAlbedo } from '../render/materials/BiomePalette.js';

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
