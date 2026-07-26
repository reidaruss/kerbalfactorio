// BodyParams + handle lifetime. The one body-constant reader (D-006).
// Everything else asks this object for radius / relief / kind rather than
// hard-coding 600 km anywhere.

import type { OfCoreModule } from '../sim/wasm/heap.js';

/** A double-precision body-frame position or direction, in metres. */
export interface Vec3d { x: number; y: number; z: number; }

export type BodyKind = 'planet' | 'moon';

export class PlanetBody {
  readonly handle: number;
  readonly radiusM: number;
  readonly maxReliefM: number;
  /** Gravitational parameter mu = G*M, m^3/s^2 (DW-18). */
  readonly muM3S2: number;
  readonly kind: BodyKind;
  readonly name: string;

  private constructor(private readonly M: OfCoreModule, handle: number, name: string) {
    if (handle <= 0) throw new Error(`of_body_create failed for ${name}`);
    this.handle = handle;
    this.name = name;
    this.radiusM = M._of_body_radius(handle);
    this.maxReliefM = M._of_body_max_relief(handle);
    this.muM3S2 = M._of_body_mu(handle);
    this.kind = M._of_body_kind(handle) === 1 ? 'moon' : 'planet';
  }

  static forge(M: OfCoreModule, seedLo: number, seedHi: number): PlanetBody {
    return new PlanetBody(M, M._of_body_create_forge(seedLo >>> 0, seedHi >>> 0), 'Forge');
  }

  static cinder(M: OfCoreModule, seedLo: number, seedHi: number): PlanetBody {
    return new PlanetBody(M, M._of_body_create_cinder(seedLo >>> 0, seedHi >>> 0), 'Cinder');
  }

  /**
   * Gravitational acceleration at radius rM, straight from /core (DW-18).
   * THE gravity authority for the browser: standing rule 1 applied to the
   * one force the player feels. A transcribed copy is what let the walker
   * fall at 0.587 m/s^2 while the orbit propagator used 9.81.
   */
  gravityAccel(rM: number): number {
    return this.M._of_gravity_accel(this.handle, rM);
  }

  dispose(): void {
    this.M._of_body_destroy(this.handle);
  }
}
