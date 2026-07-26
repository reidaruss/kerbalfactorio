// The MAIN THREAD's authoritative VoxelEdits handle (DW-16), and the dig action.
//
// One responsibility: own the edit set, apply digs to it, and publish what
// changed. It does not mesh (VoxelMesh), does not draw, does not know about
// chunks, and does not decide what the player receives (the caller harvests the
// returned volume). Workers never share this handle; they replay the op log,
// because each WASM instance has its own heap (DW-4, DW-16).
//
// Standing rule 1: every radius and solidity question here goes through
// SurfaceOracle into surface_field.h. Nothing below re-derives a ground height.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { SurfaceOracle } from './SurfaceOracle.js';
import type { Vec3d } from './PlanetBody.js';

/** One dig, in body-frame metres. The op log a worker replays. */
export interface DigOp {
  x: number; y: number; z: number; radiusM: number;
}

/** Inclusive cell AABB, the re-mesh hint from VoxelEdits::dirtyRegion. */
export interface CellBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface DigResult {
  /** Cells newly carved. 1 m^3 each, so this IS the harvested volume. */
  cells: number;
  /** Where the ray landed, body-frame metres. Null when it hit nothing. */
  hit: Vec3d | null;
  /** Re-mesh hint, or null when the dig removed nothing. */
  dirty: CellBox | null;
  /** Metres from the eye to the hit; the reach check already applied. */
  distM: number;
}

const NO_HIT: DigResult = { cells: 0, hit: null, dirty: null, distM: 0 };

export class VoxelWorld {
  readonly handle: number;
  /** Every dig, in order. Replayed into a worker instance verbatim (DW-16). */
  readonly ops: DigOp[] = [];
  /** Total cells carved, i.e. cubic metres of ground removed. */
  totalCells = 0;
  /** Ray steps taken by the last aim, so a miss can be told from a no-op. */
  lastRaySteps = 0;

  constructor(private readonly M: OfCoreModule, private readonly oracle: SurfaceOracle) {
    this.handle = M._of_edits_create();
    if (this.handle <= 0) throw new Error('of_edits_create failed');
    // Binding it here is what arms voxel collision in KinematicBody and what
    // makes surfaceHeight start subtracting derivedLoweringAt: from this point
    // the walker, the mesher and the heightfield read ONE edited surface.
    oracle.editsHandle = this.handle;
  }

  /** Cells removed so far. Read from /core, not from a JS counter. */
  removedCount(): number {
    return this.M._of_edits_removed_count(this.handle);
  }

  /**
   * March the aim ray in `stepM` increments to the first SOLID cell, then dig a
   * sphere there. Marching against `solidAt` rather than against a heightfield
   * is what makes this work sideways: inside a tunnel the ray passes through
   * removed cells and stops on the wall, not on the surface far overhead.
   */
  dig(origin: Vec3d, dir: Vec3d, reachM: number, radiusM: number, stepM = 0.25): DigResult {
    const hit = this.raycast(origin, dir, reachM, stepM);
    if (hit === null) return NO_HIT;
    const cells = this.M._of_edits_dig(this.handle, this.oracle.body.handle,
      hit.p.x, hit.p.y, hit.p.z, radiusM);
    if (cells <= 0) return { cells: 0, hit: hit.p, dirty: null, distM: hit.distM };
    this.totalCells += cells;
    this.ops.push({ x: hit.p.x, y: hit.p.y, z: hit.p.z, radiusM });
    return { cells, hit: hit.p, dirty: this.readDirty(), distM: hit.distM };
  }

  /** First solid point along a ray, or null. Public so aim UI can preview it. */
  raycast(origin: Vec3d, dir: Vec3d, reachM: number, stepM = 0.25):
  { p: Vec3d; distM: number } | null {
    const n = Math.max(1, Math.ceil(reachM / stepM));
    this.lastRaySteps = 0;
    for (let i = 1; i <= n; ++i) {
      const t = i * stepM;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      this.lastRaySteps++;
      if (this.oracle.solidAt(x, y, z)) return { p: { x, y, z }, distM: t };
    }
    return null;
  }

  /** The dirty AABB from /core, then cleared so the next dig starts fresh. */
  private readDirty(): CellBox | null {
    const n = this.M._of_edits_dirty_region(this.handle);
    if (n <= 0) return null;
    const p = this.M._of_scratch_i32() >> 2;
    // Standing rule 5: re-read the heap view on every call, never cache it.
    const i32 = this.M.HEAP32;
    const box: CellBox = {
      minX: i32[p], minY: i32[p + 1], minZ: i32[p + 2],
      maxX: i32[p + 3], maxY: i32[p + 4], maxZ: i32[p + 5],
    };
    this.M._of_edits_clear_dirty(this.handle);
    return box;
  }

  dispose(): void {
    this.oracle.editsHandle = 0;
    this.M._of_edits_destroy(this.handle);
  }
}
