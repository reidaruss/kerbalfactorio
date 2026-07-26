// DW-17, the last hole in the save slot: the tunnels.
//
// Everything else the player changed already survived a reload; a dug passage
// did not, so a player could sink a shaft, come back, and walk on flat ground
// where their tunnel used to be. The serializer has existed since W5
// (`of_edits_serialize`); the only reason it was never called is that the
// `VoxelEdits` handle lives in Services, outside the gameplay module. So this
// file is the PORT: three structural interfaces narrow enough that nothing in
// src/game has to import src/world, and the wiring is one line in Boot.
//
// TWO THINGS ARE SAVED AND THEY ARE NOT THE SAME THING.
//
//   the BYTES are the STATE. `of_edits_serialize` writes the removed-cell set
//   with persistence.h's own SaveWriter, exactly as the pack does, so the format
//   keeps one author. Restoring is `of_edits_deserialize`, and after it /core
//   holds precisely the cells it held when the slot was written.
//
//   the OPS are the HISTORY. VoxelWorld already keeps them as a first-class
//   record because DW-16 makes a worker replay them into its own WASM instance,
//   and the heightfield mouth is reconciled per strike (TerrainStream.digAt).
//   Neither of those consumes cells, so neither can be fed from the bytes. The
//   ops are not a second opinion about what is solid: /core's answer to that is
//   the bytes, and it is the only one anybody asks.
//
// THE RE-MESH GOES THROUGH THE LIVE PATH. One `applyDirty` per restored strike,
// over the same brush AABB the strike itself dirtied, so a restore costs what
// the digging cost and re-meshes exactly the bricks a dig would. Handing the
// whole tunnel's union box to one call would re-mesh every brick between its
// two ends, which is the shape of the 55 ms hitch 15.2 item 59 removed.

import { scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';

/** One recorded strike: where the brush landed and how wide it was. */
export type DigOpRow = [number, number, number, number];

export interface SavedEdits {
  /** persistence.h bytes from of_edits_serialize. */
  cells: number[];
  ops: DigOpRow[];
}

/** Just enough of VoxelWorld. `ops` is pushed to, so it is not readonly here. */
export interface VoxelPort {
  readonly handle: number;
  ops: { x: number; y: number; z: number; radiusM: number }[];
  totalCells: number;
  removedCount(): number;
}

/** Just enough of VoxelMesh: the near geometry rebuild, per dirty box. */
export interface VoxelMeshPort {
  applyDirty(b: { minX: number; minY: number; minZ: number;
                  maxX: number; maxY: number; maxZ: number }): void;
}

/** Just enough of TerrainStream: the heightfield mouth reconciliation. */
export interface TerrainDigPort {
  digAt(x: number, y: number, z: number, radiusM: number): void;
}

export interface VoxelRestore {
  /** Cells /core reports removed after the load. The assertable number. */
  cells: number;
  ops: number;
  /** Brush boxes handed to the near mesher, and what that cost. */
  remeshBoxes: number;
  remeshMs: number;
}

export const NO_VOXELS: SavedEdits = { cells: [], ops: [] };

/** The cell AABB a brush of `r` about (x,y,z) touches, floor-quantized exactly
 * as VoxelEdits::dig builds it, so the mesher is handed the strike's own box. */
function brushBox(x: number, y: number, z: number, r: number) {
  return {
    minX: Math.floor(x - r), minY: Math.floor(y - r), minZ: Math.floor(z - r),
    maxX: Math.floor(x + r), maxY: Math.floor(y + r), maxZ: Math.floor(z + r),
  };
}

/**
 * Put the rock back: the voxel layer's answer to `repopulate()`.
 *
 * A save is a DIFF over a freshly generated world, so the only honest thing to
 * restore ONTO is a world with no digs in it, which is what a reloaded page
 * has. Verifying a restore against a world that still holds the tunnel proves
 * nothing, and that is exactly the trap `probes/persist.js` fell into once.
 *
 * `[0]` is an LEB128 varint zero, i.e. /core's own encoding of an empty removed
 * set, so the reset goes through `deserialize` rather than through a second way
 * of emptying the set that only this file knows about.
 */
export function clearEdits(M: OfCoreModule, v: VoxelPort | null,
                           mesh: VoxelMeshPort | null): number {
  if (v === null || v.handle <= 0) return 0;
  const old = v.ops.slice();
  M._of_edits_alloc_bytes(1);
  scratchU8(M, 1)[0] = 0;
  M._of_edits_deserialize(v.handle);
  v.ops = [];
  v.totalCells = 0;
  // Re-mesh where the tunnel WAS: those bricks now hold no exposed faces, so
  // they drop out of the cache and the near mesh goes empty, which is the state
  // a boot with nothing dug is in.
  for (const o of old) mesh?.applyDirty(brushBox(o.x, o.y, o.z, o.radiusM));
  return v.removedCount();
}

/** Read the edit diff out of /core. Empty when nothing has been dug. */
export function snapshotEdits(M: OfCoreModule, v: VoxelPort | null): SavedEdits {
  if (v === null || v.handle <= 0) return NO_VOXELS;
  const n = M._of_edits_serialize(v.handle);
  // Copied out of the heap IMMEDIATELY (standing rule 5), and before the pack
  // is serialized: both writers share ONE u8 scratch, so the second call
  // overwrites the first one's bytes under a view that still looks valid.
  const cells = n > 0 ? Array.from(scratchU8(M, n)) : [];
  const ops = v.ops.map((o): DigOpRow => [o.x, o.y, o.z, o.radiusM]);
  return { cells, ops };
}

/**
 * Put the tunnels back: /core's cells, then the near mesh, then the mouth.
 *
 * The order is the one DigAction keeps for a live strike and for the same
 * reason. The edit set has to exist before anything meshes against it, and the
 * worker has to hear about the same dig, or the walker gets a heightfield that
 * still thinks the column is closed while the voxel layer says it is open.
 */
export function restoreEdits(M: OfCoreModule, v: VoxelPort | null,
                             mesh: VoxelMeshPort | null,
                             terrain: TerrainDigPort | null,
                             saved: SavedEdits | undefined): VoxelRestore {
  const out: VoxelRestore = { cells: 0, ops: 0, remeshBoxes: 0, remeshMs: 0 };
  if (v === null || saved === undefined || saved.cells.length === 0) return out;

  M._of_edits_alloc_bytes(saved.cells.length);
  // The view is taken AFTER the alloc that sized it and used before anything
  // else re-enters WASM.
  scratchU8(M, saved.cells.length).set(saved.cells);
  const cells = M._of_edits_deserialize(v.handle);
  if (cells < 0) return out;
  // Read the count back from /core rather than trusting the return: the two
  // disagreeing would mean the browser has an edit set the simulation does not.
  out.cells = v.removedCount();
  v.totalCells = out.cells;

  const t0 = performance.now();
  v.ops = [];
  for (const [x, y, z, r] of saved.ops ?? []) {
    v.ops.push({ x, y, z, radiusM: r });
    mesh?.applyDirty(brushBox(x, y, z, r));
    out.remeshBoxes++;
    terrain?.digAt(x, y, z, r);
  }
  out.ops = v.ops.length;
  out.remeshMs = +(performance.now() - t0).toFixed(2);
  return out;
}
