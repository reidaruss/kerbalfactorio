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

/**
 * One terrain edit, in body-frame metres. The op log a worker replays.
 *
 * A LEVEL carries its target height and disc radius; a DIG carries its brush
 * radius and leaves `targetHeightM` undefined. The two are one row type on
 * purpose: `radiusM` is the touched extent either way, which is all the near
 * mesher and the save's restore path ever ask of it, and splitting them would
 * fork `VoxelSave`'s DigOpRow for no gain (that file is another agent's).
 */
export interface DigOp {
  x: number; y: number; z: number; radiusM: number;
  /** Present only on a LEVEL op: the relief height the disc was flattened to. */
  targetHeightM?: number;
}

/** What one levelling application moved. */
export interface LevelResult {
  /** Cells cut away (the high ground). */
  dug: number;
  /** Cells placed (the hollows). */
  filled: number;
  /** Cells inside the cylinder that were considered, for cost diagnosis. */
  scanned: number;
  /** Corners whose stored distance moved: the honest size of the diff. */
  corners: number;
  dirty: CellBox | null;
  /** The relief height the disc was levelled to, metres above the datum. */
  targetHeightM: number;
  /** Where the disc was centred, body-frame metres. */
  centre: Vec3d;
  radiusM: number;
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
  /** Cell counts this object has accounted for. See driftedFromCore(). */
  private knownRemoved = 0;
  private knownAdded = 0;

  /** `?aimshell=1`: march the raw shell, as W5 did. Isolation only (rule 7). */
  aimAgainstShell = false;

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
    this.noteCounts();
    return { cells, hit: hit.p, dirty: this.readDirty(), distM: hit.distM };
  }

  /**
   * WG-22. Level a disc of ground toward `targetHeightM` (a relief height above
   * the datum, the same units the oracle speaks).
   *
   * `centre` is the aim point on the ground; the cylinder is aligned with the
   * local up through it, so the caller does not pass an orientation and cannot
   * get one wrong. /core owns the rule (`levelArea`): every cell above the
   * target becomes air and every cell below it becomes solid. Nothing here
   * decides what the surface IS, which is standing rule 1 applied to an edit
   * rather than to a query.
   */
  level(centre: Vec3d, radiusM: number, targetHeightM: number,
        maxCutM = 0, maxFillM = 0): LevelResult {
    const changed = this.M._of_level_area(this.handle, this.oracle.body.handle,
      centre.x, centre.y, centre.z, radiusM, targetHeightM, maxCutM, maxFillM);
    const out: LevelResult = {
      dug: 0, filled: 0, scanned: 0, corners: 0, dirty: null,
      targetHeightM, centre: { ...centre }, radiusM,
    };
    if (changed < 0) return out;
    // Standing rule 5: the view is taken after the call that filled it, and read
    // before anything else re-enters WASM.
    const p = this.M._of_scratch_i32() >> 2;
    const i32 = this.M.HEAP32;
    out.dug = i32[p]; out.filled = i32[p + 1];
    out.scanned = i32[p + 2]; out.corners = i32[p + 3];
    // `changed` is CORNERS written (ABI 8), and it has to be, because on a signed
    // field an op that shaves 40 cm off a slope moves the surface under the whole
    // disc without carrying one cell CENTRE across the zero level. Gating on
    // cells meant a working tool returned no dirty box, the near mesh never
    // rebuilt, and the key read as dead: WG-23's complaint with a new cause.
    if (changed === 0) return out;
    this.totalCells += changed;
    // Recorded with a radius that BOUNDS the touched cylinder, not the disc: the
    // near mesher rebuilds the brush box of every op, and a 6 m box around a cut
    // that reached 12 m down would leave a ring of stale geometry.
    const reach = Math.hypot(radiusM, Math.max(maxCutM, maxFillM) || radiusM);
    this.ops.push({ x: centre.x, y: centre.y, z: centre.z, radiusM: reach, targetHeightM });
    this.noteCounts();
    out.dirty = this.readDirty();
    return out;
  }

  /** Cells placed so far. From /core, like removedCount, never a JS tally. */
  addedCount(): number {
    return this.M._of_edits_added_count(this.handle);
  }

  /**
   * Has the edit set changed by a route that did NOT go through this object?
   *
   * The worker keeps its own copy by replaying an op log (DW-16), which works
   * only while every mutation is an op it was told about. A SAVE RESTORE is not:
   * `VoxelSave` deserializes straight into `handle`, and so does the "put the
   * rock back" reset. Replaying the stored op log on top of that is redundant for
   * a dig and WRONG for a level, which the log records with a bounding radius:
   * replayed as a dig it would carve a 13 m sphere out of the pad it describes.
   *
   * So the worker is reconciled against the AUTHORITY instead of against a
   * history of how the authority got there. This is the detector: two integer
   * reads from /core per tick, against the counts this object last accounted
   * for. Polling beats asking every future mutation site to remember.
   */
  driftedFromCore(): boolean {
    const removed = this.M._of_edits_removed_count(this.handle);
    const added = this.M._of_edits_added_count(this.handle);
    if (removed === this.knownRemoved && added === this.knownAdded) return false;
    this.knownRemoved = removed;
    this.knownAdded = added;
    return true;
  }

  /** Serialize the authoritative diff. The bytes are COPIED out of the heap
   *  immediately (standing rule 5), so the caller may hold them. */
  snapshotBytes(): Uint8Array | null {
    const n = this.M._of_edits_serialize(this.handle);
    if (n <= 0) return null;
    const p = this.M._of_scratch_u8();
    return this.M.HEAPU8.slice(p, p + n);
  }

  /** Bring the accounting up to date after a local op. */
  private noteCounts(): void {
    this.knownRemoved = this.M._of_edits_removed_count(this.handle);
    this.knownAdded = this.M._of_edits_added_count(this.handle);
  }

  /**
   * First solid point along a ray, or null. Public so aim UI can preview it.
   *
   * It marches `solidForAim`, NOT `solidAt`. `solidAt` is the 1 m lattice
   * shell, which disagrees with the surface that is drawn and walked on by up
   * to half a cell diagonal, so a shallow aim stopped on invisible rock short
   * of the ground the player was pointing at: measured on this world, 17 of 40
   * aims stopped early and the worst was 3.8 m. `solidForAim` is the oracle's
   * own answer for "inside the world as drawn", not a fudge invented here
   * (standing rule 1).
   */
  raycast(origin: Vec3d, dir: Vec3d, reachM: number, stepM = 0.25):
  { p: Vec3d; distM: number } | null {
    const n = Math.max(1, Math.ceil(reachM / stepM));
    this.lastRaySteps = 0;
    for (let i = 1; i <= n; ++i) {
      const t = i * stepM;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      this.lastRaySteps++;
      const hit = this.aimAgainstShell
        ? this.oracle.solidAt(x, y, z) : this.oracle.solidForAim(x, y, z);
      if (hit) return { p: { x, y, z }, distM: t };
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
