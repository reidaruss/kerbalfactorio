// The terrain.worker message contract. One file so the client and the worker
// cannot drift; importing this costs no runtime code (types plus two consts).

import type { BodyId } from '../world/PlanetBody.js';

export interface TerrainInitMsg {
  type: 'init';
  /** Which body to stream. The worker creates its OWN handle from this rather
   *  than being handed one, because heaps are never shared across workers
   *  (DW-16, and see the same discipline for edits at terrain.worker.ts:33). */
  bodyId: BodyId;
  seedLo: number;
  seedHi: number;
  splitRatio: number;
  mergeHysteresis: number;
  maxDepth: number;
  minResidentDepth: number;
  skirtFraction: number;
  genBudget: number;
}

export interface TerrainInitedMsg {
  type: 'inited';
  verts: number;
  stride: number;
  indexCount: number;
  interiorIndexCount: number;
  index: ArrayBuffer;          // Uint16Array, shared by EVERY chunk geometry
  radiusM: number;
  maxReliefM: number;
  loadMs: number;
  /**
   * CE-19. This worker's OWN WASM handle census, at the moment it finished
   * initialising: `{ body: 1, streamer: 1 }` on a fresh instance.
   *
   * It travels in the init reply because it is the only evidence the main
   * thread can get that a rebuilt terrain scope got a NEW heap rather than a
   * re-used one. Handle ids are per module instance, so a worker that had been
   * re-initialised instead of replaced would report `{ body: 2, streamer: 2 }`
   * and keep climbing. The number is the difference between "we asked it to
   * start again" and "the previous world's objects are gone", and nothing else
   * visible from the main thread distinguishes those two.
   */
  handles: Readonly<Record<string, number>>;
}

// Note: /core exposes no runtime setter for maxDepth or genBudget; both are
// fixed by of_streamer_create. The streamer is therefore created once from the
// config, and the regime tunes the near/far SPLIT rather than the depth budget.
export interface TerrainObserveMsg {
  type: 'observe';
  seq: number;
  x: number; y: number; z: number;
}

/**
 * W5 the mouth reconciliation. The main thread owns the authoritative
 * VoxelEdits (DW-16); this replays ONE dig op into the worker's own instance
 * and re-meshes the chunks it opened. Digging is the only thing that writes
 * terrain height, and it does it through derivedLoweringAt (WG-21), so a
 * sideways tunnel sends this message and correctly changes nothing.
 */
export interface TerrainDigMsg {
  type: 'dig';
  seq: number;
  x: number; y: number; z: number;
  radiusM: number;
}

/**
 * WG-22 the same replay for a LEVEL op. Terraforming writes VOXELS only, exactly
 * as digging does, and the heightfield follows because `buildChunk` reads
 * `SurfaceField::loweringFn` — which since WG-22 is the SIGNED surface offset, so
 * one callback carries both the pit and the pad.
 */
export interface TerrainLevelMsg {
  type: 'level';
  seq: number;
  x: number; y: number; z: number;
  radiusM: number;
  /** Relief height above the datum the disc is flattened to. */
  targetHeightM: number;
  maxCutM: number;
  maxFillM: number;
}

/**
 * Replace the worker's whole edit set from /core's own persistence bytes, and
 * re-mesh what is near the observer. Sent whenever the authoritative set changed
 * by a route that is not an op the worker was told about: a save restore, or the
 * "put the rock back" reset. An op log is a history; this is the state.
 */
export interface TerrainEditsMsg {
  type: 'edits';
  seq: number;
  bytes: ArrayBuffer;
  /** Observer position, so the re-mesh is scoped to what can be seen. */
  x: number; y: number; z: number;
  radiusM: number;
}

export interface TerrainChunkMsg {
  key: string;
  faceId: number;
  depth: number;
  qx: number;
  qy: number;
  materialId: number;
  biome: number;
  /** The chunk's 64-bit anchor: body-frame metres. Vertices are relative to it. */
  cx: number; cy: number; cz: number;
  chunkRadiusM: number;
  maxOffsetM: number;
  blob: ArrayBuffer;
}

export interface TerrainUpdateMsg {
  type: 'update' | 'digged';
  seq: number;
  chunks: TerrainChunkMsg[];
  evicted: string[];
  resident: number;
  generated: number;
  converged: boolean;
  /** Worker-side cost: streamer walk, then pack + de-interleave. */
  updateMs: number;
  packMs: number;
  bytes: number;
}

export interface TerrainErrorMsg { type: 'error'; message: string; }

export type ToTerrain = TerrainInitMsg | TerrainObserveMsg | TerrainDigMsg
  | TerrainLevelMsg | TerrainEditsMsg;
export type FromTerrain = TerrainInitedMsg | TerrainUpdateMsg | TerrainErrorMsg;
