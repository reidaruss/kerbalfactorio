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
   *  a pad by looking across it, not by standing on top of every metre of it.
   *
   *  THE AIM IS A REFINEMENT, NOT A PRECONDITION (WG-23). When the ray finds no
   *  ground the disc falls back to the player's own feet, because "stand where
   *  you want the floor" is already the tool's rule: the target HEIGHT has
   *  always come from the feet, and only the centre came from the ray. Measured
   *  before that fallback existed, on the 29 degree slope this tool is for: the
   *  ray found no ground at all at pitch 0, -10, -20 or -30 and the key did
   *  nothing, silently, at every angle a player looks while walking. Ground was
   *  first found at -45 degrees, which is craning your neck at your own boots. */
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
  /**
   * Radius fraction the "flat to X m" number is measured over. A pad cut into a
   * hill HAS a bank at its rim and every game in the genre draws one, so quoting
   * the bank as the pad's flatness would be a lie in the pessimistic direction.
   * 0.7 is the floor a base would stand on.
   */
  flatnessFrac: 0.7,
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
  /**
   * Height spread across the pad after the last application, metres, read back
   * through the oracle. THIS IS THE NUMBER THE PLAYER IS TOLD, so a probe can
   * assert that what the HUD says and what the ground is are the same thing.
   */
  lastFlatnessM: number;
  /** Presses that fell back to the feet because the aim ray found no ground. */
  underfoot: number;
  /** The last message shown, so the honesty itself is assertable. */
  lastMessage: string;
}

export class LevelAction {
  readonly stats: LevelStats = {
    levels: 0, misses: 0, noops: 0, cellsDug: 0, cellsFilled: 0,
    lastDug: 0, lastFilled: 0, lastScanned: 0, lastMs: 0,
    targetHeightM: NaN, latched: false,
    lastFlatnessM: NaN, underfoot: 0, lastMessage: '',
  };
  /**
   * Where a press is announced. Set by the composition root once the game HUD
   * exists; null in a probe scene with no HUD, which must not make the tool
   * behave differently, so nothing here branches on it beyond the call.
   *
   * A press that changes the ground by less than a voxel and says NOTHING is
   * indistinguishable from a dead key, and that is most of what "it didnt really
   * work at all" was: on a slope the tool is not silent because it failed, it is
   * silent because a 1 m lattice cannot do better and never said so.
   */
  flash: ((text: string, secs?: number) => void) | null = null;
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
      this.aimPreview(origin, dir, feet, LEVEL.idleAlpha);
      return null;
    }
    if (Number.isNaN(this.target)) {
      this.target = this.heightUnder(feet);
      this.stats.targetHeightM = +this.target.toFixed(3);
      this.stats.latched = true;
      // Show the footprint on the press even if the cooldown swallows this tick,
      // so the player sees what is about to move rather than only its aftermath.
      this.aimPreview(origin, dir, feet, LEVEL.activeAlpha);
      return null;
    }
    this.aimPreview(origin, dir, feet, LEVEL.activeAlpha);
    if (this.cooldown > 0) return null;
    this.cooldown = LEVEL.cooldownTicks;
    return this.levelOnce(origin, dir, this.target, feet);
  }

  /**
   * Level now, ignoring the cooldown. The probe path, and the API __of uses.
   * `targetHeightM` defaults to the latched value, or to the ground under the
   * aim point when nothing is latched.
   */
  levelOnce(origin: Vec3d, dir: Vec3d, targetHeightM?: number,
            feet?: Vec3d): LevelResult | null {
    const t0 = performance.now();
    const hit = this.discCentre(origin, dir, feet);
    if (hit === null) { this.stats.misses++; this.say('nothing to level here'); return null; }
    const target = targetHeightM ?? this.heightUnder(hit);
    const r = this.voxels.level(hit, LEVEL.radiusM, target,
      LEVEL.maxCutM, LEVEL.maxFillM);

    this.stats.lastDug = r.dug;
    this.stats.lastFilled = r.filled;
    this.stats.lastScanned = r.scanned;
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
    if (r.dirty === null) {
      // A no-op still quotes the flatness, and that is the point rather than a
      // detail: a player holding the key watches the number stop improving,
      // which is how the tool says "this is as flat as a 1 m lattice gets"
      // without a lecture and without lying.
      this.stats.noops++;
      const flat = this.flatnessOver(hit);
      this.stats.lastFlatnessM = +flat.toFixed(2);
      this.say(`already level here  flat to ${flat.toFixed(1)} m`);
      return r;
    }

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
    // Measured AFTER the edit and after the heightfield heard about it, through
    // the same oracle everything else reads. This is the honesty: the tool
    // quotes the flatness it actually achieved rather than the flatness it was
    // asked for, so a 1 m lattice on a steep slope says so in metres instead of
    // leaving the player to conclude the key is broken.
    const flat = this.flatnessOver(hit);
    this.stats.lastFlatnessM = +flat.toFixed(2);
    this.say(`levelled ${(LEVEL.radiusM * 2).toFixed(0)} m pad  `
      + `flat to ${flat.toFixed(1)} m`);
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
    return r;
  }

  /**
   * Where the disc goes: the aim point when the ray finds ground, the player's
   * own feet when it does not. See LEVEL.reachM for why the second half exists.
   */
  discCentre(origin: Vec3d, dir: Vec3d, feet?: Vec3d): Vec3d | null {
    const h = this.voxels.raycast(origin, dir, LEVEL.reachM, LEVEL.stepM);
    if (h !== null) return h.p;
    if (feet === undefined) return null;
    this.stats.underfoot++;
    return feet;
  }

  /** The disc centre for an aim ray alone, or null when nothing is in reach. */
  groundHit(origin: Vec3d, dir: Vec3d): Vec3d | null {
    const h = this.voxels.raycast(origin, dir, LEVEL.reachM, LEVEL.stepM);
    return h === null ? null : h.p;
  }

  /**
   * Height spread across the pad, metres, from the ONE oracle. Centre plus two
   * rings inside `flatnessFrac` of the radius: 17 calls, about 40 us, once per
   * application rather than per frame.
   */
  private flatnessOver(centre: Vec3d): number {
    const cr = Math.hypot(centre.x, centre.y, centre.z) || 1;
    const u = { x: centre.x / cr, y: centre.y / cr, z: centre.z / cr };
    const s = Math.abs(u.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    let e1 = { x: u.y * s.z - u.z * s.y, y: u.z * s.x - u.x * s.z, z: u.x * s.y - u.y * s.x };
    const L = Math.hypot(e1.x, e1.y, e1.z) || 1;
    e1 = { x: e1.x / L, y: e1.y / L, z: e1.z / L };
    const e2 = { x: u.y * e1.z - u.z * e1.y, y: u.z * e1.x - u.x * e1.z, z: u.x * e1.y - u.y * e1.x };
    let lo = Infinity, hi = -Infinity;
    const take = (px: number, py: number, pz: number): void => {
      const r = Math.hypot(px, py, pz) || 1;
      const h = this.oracle.surfaceHeight(px / r, py / r, pz / r);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    };
    take(centre.x, centre.y, centre.z);
    for (let k = 1; k <= 2; ++k) {
      const rad = LEVEL.radiusM * LEVEL.flatnessFrac * (k / 2);
      for (let i = 0; i < 8; ++i) {
        const a = (Math.PI * i) / 4;
        const cx = Math.cos(a) * rad, sy = Math.sin(a) * rad;
        take(centre.x + e1.x * cx + e2.x * sy,
          centre.y + e1.y * cx + e2.y * sy,
          centre.z + e1.z * cx + e2.z * sy);
      }
    }
    return hi - lo;
  }

  private say(text: string): void {
    this.stats.lastMessage = text;
    this.flash?.(text, 1.8);
  }

  /** The ONE surface under a body-frame point. Nothing here re-derives it. */
  private heightUnder(p: Vec3d): number {
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    return this.oracle.surfaceHeight(p.x / r, p.y / r, p.z / r);
  }

  /**
   * Draw the footprint. It follows `discCentre`, so it is showing the ground a
   * press would ACTUALLY move, including when that is the ground underfoot.
   *
   * The ring used to hide whenever the ray missed, which is the same condition
   * under which the key did nothing: the one moment the player most needed to be
   * told where the tool would act was the one moment it drew nothing at all.
   */
  private aimPreview(origin: Vec3d, dir: Vec3d, feet: Vec3d, alpha: number): void {
    if (this.ring === null) return;
    const h = this.voxels.raycast(origin, dir, LEVEL.reachM, LEVEL.stepM);
    this.ring.show(h === null ? feet : h.p, LEVEL.radiusM, alpha);
  }
}
