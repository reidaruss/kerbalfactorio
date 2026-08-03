// The dig action: one press of the mine key removes a sphere of ground where
// the player is looking, and puts the removed volume in the inventory.
//
// One responsibility: turn an aim ray plus an edge-detected key into a dig, and
// keep the three views of the result in agreement. Everything it touches is
// already an authority: VoxelWorld owns the edits, TerrainStream owns the
// heightfield reconciliation, VoxelMesh owns the near geometry. This class only
// makes sure all three hear about the same dig, in the same order.

import type { VoxelWorld, DigResult } from '../world/VoxelWorld.js';
import type { VoxelMesh } from '../world/VoxelMesh.js';
import type { TerrainStream } from '../world/TerrainStream.js';
import type { Vec3d } from '../world/PlanetBody.js';
import type { DigFx } from '../render/DigFx.js';

/**
 * Reach and brush, metres.
 *
 * The brush was 1.2 m and the tunnel it cut was NARROWER THAN THE PLAYER: a
 * sphere of radius 1.2 about a point takes cells whose CENTRES are inside it, so
 * off-lattice it clears only two cells on an axis, which is 2 m of bore for a
 * 1.8 m capsule with nothing to spare, and the passage ran on ahead of a player
 * who could not follow it (STATUS.md, W5 remaining).
 *
 * 1.5 m is the value that guarantees a 3x3 cell cross-section at the strike
 * centre whatever the phase against the lattice: offsets of 1 cell on two axes
 * are 1.414 m and land inside, offsets of 2 cells do not. That is 3 m of
 * headroom over a 1.8 m capsule and 3 m of width over a 0.8 m one.
 */
export const DIG = {
  reachM: 4.5,
  radiusM: 1.5,
  /** Ray march step. Finer than the 1 m voxel so a thin wall cannot be missed. */
  stepM: 0.25,
  /**
   * Ticks between digs while the key is held, at 60 Hz. 12 was two thirds of a
   * second per swing and read as a machine with a duty cycle; 9 is 6.7 strikes a
   * second, which is a person hitting a rock, and it matches the impact frame of
   * the mine clips (ASSET-SPECS: frames 16 to 18 of a 24 frame swing).
   */
  cooldownTicks: 9,
};

/**
 * What a dig strike into an ore body pays.
 *
 * A PORT, not an import: `src/player` knows nothing about deposits, and the ore
 * pool has exactly one owner (`OrePatches`, over /core). Without this a pickaxe
 * swing at an outcrop pays and a dig strike into the SAME ground pays nothing,
 * which reads as a bug the first time anybody tries it.
 */
export interface DigOrePort {
  strike(x: number, y: number, z: number, cells: number):
  { item: number; name: string; granted: number } | null;
}

export interface DigStats {
  digs: number;
  misses: number;
  /** Cubic metres of ground removed, which is also the harvested item count. */
  volumeM3: number;
  lastCells: number;
  lastDistM: number;
  lastMs: number;
  /** Ore units the last strike granted, and how many in total. */
  lastOre: number;
  oreUnits: number;
}

export class DigAction {
  readonly stats: DigStats = {
    digs: 0, misses: 0, volumeM3: 0, lastCells: 0, lastDistM: 0, lastMs: 0,
    lastOre: 0, oreUnits: 0,
  };
  /** Set by the gameplay layer once the ore field exists. Null with no deposits. */
  ore: DigOrePort | null = null;
  /** The last strike that actually paid, for the HUD and for a probe. */
  lastGrant: { item: number; name: string; granted: number } | null = null;
  private cooldown = 0;

  constructor(
    private readonly voxels: VoxelWorld,
    private readonly mesh: VoxelMesh,
    /** CE-20. A THUNK, not the stream: a body switch replaces the object,
     *  and a dig posted to the previous scope's worker goes nowhere and
     *  says nothing. Read at the moment of the dig, never cached. */
    private readonly terrain: () => TerrainStream,
    private readonly fx: DigFx | null = null,
  ) {}

  /**
   * Fixed-tick step. `held` is the mine key; the cooldown makes it repeat.
   * The debris integrates every tick whether or not a strike lands, which is
   * why it lives here and not behind the `held` guard: chips already in the air
   * have to keep falling after the player lets go of the key.
   */
  step(held: boolean, origin: Vec3d, dir: Vec3d, dt = 1 / 60): DigResult | null {
    this.fx?.step(dt);
    if (this.cooldown > 0) this.cooldown--;
    if (!held || this.cooldown > 0) return null;
    this.cooldown = DIG.cooldownTicks;
    return this.digOnce(origin, dir);
  }

  /** Dig now, ignoring the cooldown. The probe path, and the API __of uses. */
  digOnce(origin: Vec3d, dir: Vec3d): DigResult {
    const t0 = performance.now();
    const r = this.voxels.dig(origin, dir, DIG.reachM, DIG.radiusM, DIG.stepM);
    if (r.cells <= 0 || r.dirty === null) {
      this.stats.misses++;
      this.stats.lastCells = 0;
      return r;
    }
    // Order matters and is the point of this class. The near mesh must rebuild
    // BEFORE the frame that shows the hole, and the worker must be told in the
    // same tick, or the player walks into a heightfield that still thinks the
    // column is closed while the voxel layer says it is open. That disagreement
    // is the web restaging of the five surfaces (DW-16 names it exactly).
    this.mesh.applyDirty(r.dirty);
    if (r.hit !== null) {
      this.terrain().digAt(r.hit.x, r.hit.y, r.hit.z, DIG.radiusM);
      this.fx?.burst(r.hit, dir);
    }
    this.stats.digs++;
    this.stats.volumeM3 += r.cells;   // 1 m^3 per cell (of_voxel_size)
    this.stats.lastCells = r.cells;
    // DIGGING INTO AN ORE BODY PAYS. The amount is the port's business and the
    // pool is /core's; all this class does is tell it where the strike landed.
    this.stats.lastOre = 0;
    this.lastGrant = null;
    if (r.hit !== null && this.ore !== null) {
      const g = this.ore.strike(r.hit.x, r.hit.y, r.hit.z, r.cells);
      if (g !== null && g.granted > 0) {
        this.lastGrant = g;
        this.stats.lastOre = g.granted;
        this.stats.oreUnits += g.granted;
      }
    }
    this.stats.lastDistM = +r.distM.toFixed(2);
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
    return r;
  }
}
