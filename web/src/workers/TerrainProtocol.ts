// The terrain.worker message contract. One file so the client and the worker
// cannot drift; importing this costs no runtime code (types plus two consts).

export interface TerrainInitMsg {
  type: 'init';
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
  | TerrainLevelMsg;
export type FromTerrain = TerrainInitedMsg | TerrainUpdateMsg | TerrainErrorMsg;
