// The three shapes `createTerrainMaterials` is described by: what the ground
// needs to know about water, what the caller passes in, and what it gets back.
// Split out of TerrainMaterial.ts at RN-2050 so the query parsers, the uniform
// state builder and the program factory can all name them without importing
// each other. TerrainMaterial.ts re-exports all three, so no import site
// outside this directory changed.

import type * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';

/**
 * WHAT THE GROUND NEEDS TO KNOW ABOUT WATER, and it is deliberately the least
 * that will do (RN-57): a direction, two radii and a height. It is NOT a
 * WaterOracle and it is NOT `depthAt`. The ground does not ask where the water
 * is per fragment, because that would be a second consumer of the water
 * authority inside a shader, which is the DW-26 trap by another route. It is
 * handed the pond's published disc once at boot, and it darkens a band.
 */
export interface TerrainWaterBand {
  /** Unit direction of the pond centre, body frame. */
  readonly dirX: number; readonly dirY: number; readonly dirZ: number;
  /** The water surface, METRES ABOVE THE DATUM, i.e. the same frame as aHeight. */
  readonly levelM: number;
  readonly shorelineM: number;
}

export interface TerrainMaterialOptions {
  readonly depth: DepthPolicy;
  readonly maxReliefM: number;
  /** The pond, or null on a dry body. See TerrainWaterBand. */
  readonly water: TerrainWaterBand | null;
  readonly atmosphere: AtmosphereUniforms;
  /** Cascade far planes in metres; the length is the cascade count. */
  readonly cascadeSplits: number[];
  readonly fadeSecs: number;
}

export interface TerrainMaterials {
  readonly near: THREE.ShaderMaterial;
  readonly far: THREE.ShaderMaterial;
  /** Push the per-frame globals. Per-chunk uniform state stays at zero. */
  update(bodyCenterEngine: THREE.Vector3, simTimeSecs: number): void;
  dispose(): void;
}
