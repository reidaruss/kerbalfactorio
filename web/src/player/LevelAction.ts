// The levelling tool: stand where you want the floor, aim, hold the key, and the
// ground inside a radius moves to meet you.
//
// One responsibility: turn an aim ray plus a held key into a level op, and keep
// the three views of the result in agreement. Everything it touches is already
// an authority: /core's `levelArea` decides what the surface becomes, VoxelWorld
// owns the edits, TerrainStream owns the heightfield reconciliation, VoxelMesh
// owns the near geometry. This class only makes sure all three hear about the
// same edit, in the same order — the same contract DigAction keeps, for the same
// reason (DW-16 names the failure it prevents).

import type { VoxelWorld, LevelResult } from '../world/VoxelWorld.js';
import type { VoxelMesh } from '../world/VoxelMesh.js';
import type { TerrainStream } from '../world/TerrainStream.js';
import type { LevelRing } from '../world/LevelRing.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';

export const LEVEL = {
  /** How far the aim ray looks for ground. Longer than the dig reach: you place
   *  a pad by looking across it, not by standing on top of every metre of it. */
  reachM: 9.0,
  /** The disc the tool flattens. 3 m is a hut, 6 m is a workshop floor. */
  radiusM: 6.0,
  /** Ray march step, finer than the 1 m voxel so a thin lip cannot be missed. */
  stepM: 0.25,
  /**
   * Ticks between applications while the key is held, at 60 Hz. A level touches
   * thousands of cells against a dig's dozens, so it repeats at about a third of
   * the rate: 20 ticks is three passes a second, which still feels continuous
   * and leaves the near mesher room between them.
   */
  cooldownTicks: 20,
  /** Metres of cut and of fill one press may reach. See kSurfaceMaxFillM. */
  maxCutM: 12.0,
  maxFillM: 12.0,
  /** Ring alpha while merely aimed, and while the key is held. */
  idleAlpha: 0.16,
  activeAlpha: 0.5,
};

export interface LevelStats {
  /** Applications that changed at least one cell. */
  levels: number;
  /** Presses that found no ground in reach. */
  misses: number;
  /** Applications that found the ground already flat: the idempotent no-op. */
  noops: number;
  cellsDug: number;
  cellsFilled: number;
  lastDug: number;
  lastFilled: number;
  lastScanned: number;
  lastMs: number;
  /** The latched floor height, metres of relief. NaN while the key is up. */
  targetHeightM: number;
  /** Where the target came from, so a probe can tell latched from re-read. */
  latched: boolean;
}

export class LevelAction {
  readonly stats: LevelStats = {
    levels: 0, misses: 0, noops: 0, cellsDug: 0, cellsFilled: 0,
    lastDug: 0, lastFilled: 0, lastScanned: 0, lastMs: 0,
    targetHeightM: NaN, latched: false,
  };
  private cooldown = 0;
  /** The floor height latched on the press. NaN means the key is up. */
  private target = NaN;

  constructor(
    private readonly voxels: VoxelWorld,
    private readonly mesh: VoxelMesh,
    private readonly terrain: TerrainStream,
    private readonly oracle: SurfaceOracle,
    private readonly ring: LevelRing | null = null,
  ) {}

  /**
   * Fixed-tick step. `held` is the level key; `feet` is the player's own
   * body-frame position, which is where the floor height comes from.
   *
   * THE TARGET IS LATCHED ON THE PRESS, not re-read every application. Reading
   * it live would chase the player: levelling raises the ground under their
   * feet, which raises the target, which raises the ground, and a pad would
   * climb for as long as the key was held. Latching makes "stand where you want
   * the floor, then level around you" mean exactly what it says.
   */
  step(held: boolean, origin: Vec3d, dir: Vec3d, feet: Vec3d): LevelResult | null {
    if (this.cooldown > 0) this.cooldown--;
    if (!held) {
      this.target = NaN;
      this.stats.targetHeightM = NaN;
      this.stats.latched = false;
      this.aimPreview(origin, dir, LEVEL.idleAlpha);
      return null;
    }
    if (Number.isNaN(this.target)) {
      this.target = this.heightUnder(feet);
      this.stats.targetHeightM = +this.target.toFixed(3);
      this.stats.latched = true;
      // Show the footprint on the press even if the cooldown swallows this tick,
      // so the player sees what is about to move rather than only its aftermath.
      this.aimPreview(origin, dir, LEVEL.activeAlpha);
      return null;
    }
    this.aimPreview(origin, dir, LEVEL.activeAlpha);
    if (this.cooldown > 0) return null;
    this.cooldown = LEVEL.cooldownTicks;
    return this.levelOnce(origin, dir, this.target);
  }

  /**
   * Level now, ignoring the cooldown. The probe path, and the API __of uses.
   * `targetHeightM` defaults to the latched value, or to the ground under the
   * aim point when nothing is latched.
   */
  levelOnce(origin: Vec3d, dir: Vec3d, targetHeightM?: number): LevelResult | null {
    const t0 = performance.now();
    const hit = this.groundHit(origin, dir);
    if (hit === null) { this.stats.misses++; return null; }
    const target = targetHeightM ?? this.heightUnder(hit);
    const r = this.voxels.level(hit, LEVEL.radiusM, target,
      LEVEL.maxCutM, LEVEL.maxFillM);

    this.stats.lastDug = r.dug;
    this.stats.lastFilled = r.filled;
    this.stats.lastScanned = r.scanned;
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
    if (r.dirty === null) { this.stats.noops++; return r; }

    // Order matters and is the point of this class. The near mesh rebuilds
    // BEFORE the frame that shows the pad, and the worker hears about it in the
    // same tick, or the player walks on a heightfield that still believes in the
    // hill while the voxel layer has already flattened it.
    this.mesh.applyDirty(r.dirty);
    this.terrain.levelAt(hit.x, hit.y, hit.z, LEVEL.radiusM, target,
      LEVEL.maxCutM, LEVEL.maxFillM);
    this.stats.levels++;
    this.stats.cellsDug += r.dug;
    this.stats.cellsFilled += r.filled;
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
    return r;
  }

  /** The disc centre for an aim ray, or null when nothing is in reach. */
  groundHit(origin: Vec3d, dir: Vec3d): Vec3d | null {
    const h = this.voxels.raycast(origin, dir, LEVEL.reachM, LEVEL.stepM);
    return h === null ? null : h.p;
  }

  /** The ONE surface under a body-frame point. Nothing here re-derives it. */
  private heightUnder(p: Vec3d): number {
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    return this.oracle.surfaceHeight(p.x / r, p.y / r, p.z / r);
  }

  private aimPreview(origin: Vec3d, dir: Vec3d, alpha: number): void {
    if (this.ring === null) return;
    const hit = this.groundHit(origin, dir);
    if (hit === null) { this.ring.hide(); return; }
    this.ring.show(hit, LEVEL.radiusM, alpha);
  }
}
