// The three shapes the scatter's residency map is built out of: what one
// placed chunk holds, the null-object tier a biome with no understorey draws
// from, and the staleness epsilon. Split out of Scatter.ts at RN-2052 so the
// sampler and the class can both name `Placed` without importing each other.

import type * as THREE from 'three';
import type { Tier } from './ScatterTuning.js';

export interface Placed {
  /**
   * Flattened [material, slot] pairs; -1 slot means the batch was full.
   * `lod2M` is the distance at which THIS part switches to its far geometry,
   * carried per part rather than read from one constant because a 12 m tree and
   * a 0.4 m grass card do not stop being legible at the same range.
   *
   * RN-2202 adds the IMPOSTOR rung beside it. `lod3` is resolved through
   * `PropLods.geomAtTier`, so for the forty-odd props that author no `_LOD3` it
   * IS `lod2`'s id and `lod3M` is set equal to `lod2M`: the third band exists
   * for every part and changes nothing for the parts with nothing behind it.
   * That is deliberate -- a per-part "has an impostor" flag would be a second
   * authority on a question the geometry ids already answer.
   */
  parts: {
    material: string; slot: number;
    lod0: number; lod2: number; lod3: number;
    lod2M: number; lod3M: number;
  }[];
  local: Float32Array;
  quat: Float32Array;
  /** Three components per prop now: width, HEIGHT, width. See ScatterLook. */
  scale: Float32Array;
  /** parts index -> prop index, so one matrix serves a multi-material prop. */
  owner: Uint16Array;
  /** Cells this chunk actually drew from, and one cell's ground area. */
  cells: number;
  cellArea: number;
  /** What the registry ASKED for over those cells, before any quantisation. */
  wanted: number;
  /** Rebuild band this chunk was built in. See `detailBandOf`. */
  detailBand: number;
  /**
   * The chunk's ENGINE position at the moment its instance matrices were last
   * written. Every matrix in the batch is `builtPos + local`, so this is the
   * other half of the staleness subtraction and it is the only new state the
   * measurement needs.
   */
  builtPos: THREE.Vector3;
  /** The canopy's own accounting, over the canopy's own ground. */
  canopyCells: number;
  canopyProps: number;
  canopyWanted: number;
  /** WG-260. The mid tier's, over its own 170-to-690 m ground. */
  midCells: number;
  midProps: number;
  midWanted: number;
  midCards: number;
}

/** A biome with no understorey draws from this rather than from a null check. */
export const EMPTY_TIER: Tier = { specs: [], weights: [], total: 0 };

/**
 * Below this a chunk counts as NOT stale (WG-64). One millimetre, which is not
 * a tolerance on the answer: a re-placed chunk is exact, because `write` and
 * `ChunkView.place` both go through the same f64 `toEngine` subtraction, so the
 * correct reading is a hard 0.000000. The epsilon exists only so the counter
 * cannot be tripped by a float32 round trip through an instance matrix, and the
 * failure it is looking for is measured in kilometres.
 */
export const STALE_EPS_M = 1e-3;
