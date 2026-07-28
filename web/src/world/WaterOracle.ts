// THE WATER ANSWER, and deliberately NOT a method on SurfaceOracle (WG-39).
//
// SurfaceOracle's first line is "THE surface answer", and standing rule 1 says
// no module re-derives terrain height. Water is a THIRD answer to "where is the
// surface here", after the smooth ground and the voxel shell, and DW-26 is
// explicit about what happens when a third answer is bolted onto the authority
// for the first two: it stops being a named interface and becomes the sixth
// definition of the surface. This project has lost days to that twice, on the
// sinking deck and the sinking tunnel.
//
// So the split is enforced by the type system rather than by discipline. There
// is no `waterHeight` on SurfaceOracle, and there is no `surfaceRadius` here. A
// caller that wants the ground holds a SurfaceOracle; a caller that wants the
// water holds a WaterOracle; a caller that needs both, holds both and has to
// write down which one it meant on every line. That is the entire design.
//
// Same performance contract as SurfaceOracle: synchronous, allocation free,
// single-digit microseconds, safe to call in the frame.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64 } from '../sim/wasm/heap.js';
import type { PlanetBody } from './PlanetBody.js';

/** The pond's geometry, read once at boot. Null on a body with no water. */
export interface WaterDisc {
  /** Unit direction of the pond centre, body frame. */
  dirX: number; dirY: number; dirZ: number;
  /** Radius, in metres from the centre, where the water meets the ground. */
  shorelineM: number;
  /**
   * Radius where the BASIN meets the surrounding ground. Larger than
   * shorelineM, and the gap between them is dry beach INSIDE the bowl. Drawing
   * water out to this radius would put a disc of water up the bank, which is
   * the "sitting on the surface" read this whole change exists to remove.
   */
  basinRadiusM: number;
  /** The water surface height above the datum, metres. */
  levelM: number;
  /** Deepest water, at the centre, metres. */
  maxDepthM: number;
}

export class WaterOracle {
  /**
   * The sentinel a dry column returns, read from `/core` rather than
   * transcribed. A transcribed constant that drifts by one digit is a
   * comparison that silently always takes the same branch forever.
   */
  readonly noValue: number;

  /** The pond, or null if this body has none. Constant for the body's life. */
  readonly disc: WaterDisc | null;

  constructor(private readonly M: OfCoreModule, readonly body: PlanetBody) {
    this.noValue = M._of_water_no_value();
    const n = M._of_water_disc(body.handle);
    if (n !== 7) {
      this.disc = null;
    } else {
      // Standing rule 5: the heap view is taken AFTER the call that filled it,
      // and copied out before the next call into WASM.
      const s = scratchF64(M, 7);
      this.disc = {
        dirX: s[0], dirY: s[1], dirZ: s[2],
        shorelineM: s[3], basinRadiusM: s[4], levelM: s[5], maxDepthM: s[6],
      };
    }
  }

  /** Does this body have water at all? */
  get hasWater(): boolean { return this.disc !== null; }

  /** The body's ONE water level, metres above the datum. `noValue` if dry. */
  levelM(): number {
    return this.M._of_water_level(this.body.handle);
  }

  /** Absolute radius from the body centre to the water surface. */
  levelRadius(): number {
    const d = this.disc;
    return d === null ? this.noValue : this.body.radiusM + d.levelM;
  }

  /** The water surface under a direction, or `noValue` for a dry column. */
  levelAt(dx: number, dy: number, dz: number): number {
    return this.M._of_water_level_at(this.body.handle, dx, dy, dz);
  }

  /**
   * Metres of water standing over the ground under a direction; 0 if dry.
   * The one call here that reads a ground authority, and it reads the EDITED
   * ground, so digging the bed deeper genuinely makes the water deeper.
   */
  depthAt(dx: number, dy: number, dz: number, editsHandle: number): number {
    return this.M._of_water_depth_at(this.body.handle, editsHandle, dx, dy, dz);
  }

  /**
   * HOW FAR A POINT IS BELOW THE WATER SURFACE, in metres. Negative above it,
   * a large negative where there is no water.
   *
   * THIS IS THE ONE PLACE "am I in water" IS ANSWERED. It takes a point and
   * nothing else: no ground query, no capsule, no grounded flag. A body below
   * the water surface is in water whether it is floating, standing on the bed,
   * or buried in it, and mixing the ground in here is exactly how the answer
   * would come to depend on which of three surfaces replied first.
   */
  submersionM(x: number, y: number, z: number): number {
    return this.M._of_water_submersion(this.body.handle, x, y, z);
  }

  /** `submersionM(p) > 0`, spelled out. */
  submerged(x: number, y: number, z: number): boolean {
    return this.submersionM(x, y, z) > 0;
  }
}
