// BodyParams + handle lifetime. The one body-constant reader (D-006).
// Everything else asks this object for radius / relief / kind rather than
// hard-coding 600 km anywhere.

import type { OfCoreModule } from '../sim/wasm/heap.js';

/** A double-precision body-frame position or direction, in metres. */
export interface Vec3d { x: number; y: number; z: number; }

export type BodyKind = 'planet' | 'moon';

/**
 * Which body the client boots on. 0 = Forge, 1 = Cinder.
 *
 * These are NOT numbers this file invented: they are /core's own numbering,
 * `BodyParams::bodyId`, set by the two factories in
 * `core/include/of/cubed_sphere.h` (Forge writes `b.bodyId = 0` at :323,
 * Cinder writes `b.bodyId = 1` at :375). Nothing is transcribed, so a body
 * added in /core gets a widened union here and a `createBodyHandle` arm, and
 * no constant anywhere else has to agree.
 */
export type BodyId = 0 | 1;

/**
 * THE body-choice rule (D-006's companion): the single place that maps a
 * BodyId onto an `_of_body_create_*` export. Every heap that needs its own
 * handle (the main thread, terrain.worker, oracle.worker) calls this, so the
 * choice cannot drift between them the way a hard-coded `_forge` per worker
 * did. Returns a raw handle; `PlanetBody.create` wraps it.
 */
export function createBodyHandle(
  M: OfCoreModule, bodyId: BodyId, seedLo: number, seedHi: number,
  swellScale?: number,
): number {
  const h = bodyId === 1
    ? M._of_body_create_cinder(seedLo >>> 0, seedHi >>> 0)
    : M._of_body_create_forge(seedLo >>> 0, seedHi >>> 0);
  // WG-275. `swellScale` UNDEFINED MEANS "leave /core's own default alone", and
  // that asymmetry is deliberate. /core defaults `BodyParams::lowlandSwellCoef`
  // to the shipped 0.050, so a heap that never learned about the flag streams
  // the SHIPPED planet rather than a silently flattened one. The failure mode
  // of a forgotten plumb is therefore a contaminated OFF arm, which the arm's
  // own fixture catches (it must reproduce the pre-swell rectangles exactly),
  // and not RN-150's "the feature shipped off and every probe was green".
  //
  // It also has to be undefined-by-default because THREE heaps build their own
  // handle here (main thread, terrain.worker, oracle.worker) and each learns
  // the flag through a different message.
  if (h > 0 && swellScale !== undefined) M._of_body_set_swell_scale(h, swellScale);
  return h;
}

export class PlanetBody {
  readonly handle: number;
  readonly radiusM: number;
  readonly maxReliefM: number;
  /** Gravitational parameter mu = G*M, m^3/s^2 (DW-18). */
  readonly muM3S2: number;
  readonly kind: BodyKind;
  readonly name: string;
  /** GP-268. /core's own `BodyParams::bodyId` (0 Forge, 1 Cinder), CARRIED
   *  rather than re-derived from `kind`. Two moons would both be kind 1 and a
   *  consumer keyed on kind would confuse them; `of_atmo_*` is indexed by this
   *  same id (atmosphere.h section 2), so passing it on is passing /core's own
   *  key rather than a second one. There is no `of_body_id` export to read it
   *  back from a handle, which is why it travels with the object. */
  readonly bodyId: BodyId;

  /**
   * RN-840. THE BODY'S AIR, and the reason it lives here rather than in the
   * renderer is the reason this class exists at all.
   *
   * `forgeAtmosphere()` was called unconditionally at `Boot.ts:120`, so Cinder,
   * which /core declares AIRLESS (D-006: `makeCinderAtmosphere()` returns an
   * empty profile and `present()` is false), was rendered with Earth's Rayleigh
   * coefficients scaled to a 200 km radius. That gave the moon a blue sky, an
   * aerial perspective that veiled every crater in a white sheet, and a
   * `daylightFactor` reading a full column of air that is not there.
   *
   * The fix is deliberately NOT a boolean somebody has to remember to set when
   * a body is added. These are the same two /core queries `app/MapBoot.ts`
   * already draws the map's air line from, indexed by the same `bodyId`, so a
   * third body authored in `atmosphere.h` renders correctly with no change on
   * this side at all.
   */
  readonly seaLevelDensityKgM3: number;
  /** The ceiling: at or above it /core's density is exactly 0. */
  readonly atmosphereTopM: number;

  private constructor(private readonly M: OfCoreModule, handle: number, name: string,
                      bodyId: BodyId) {
    if (handle <= 0) throw new Error(`of_body_create failed for ${name}`);
    this.handle = handle;
    this.name = name;
    this.bodyId = bodyId;
    this.radiusM = M._of_body_radius(handle);
    this.maxReliefM = M._of_body_max_relief(handle);
    this.muM3S2 = M._of_body_mu(handle);
    this.kind = M._of_body_kind(handle) === 1 ? 'moon' : 'planet';
    // A DENSITY AT ALTITUDE 0 rather than a stored "sea level" constant:
    // `_of_atmo_density` clamps below the datum, so this IS the profile's rho0
    // by construction and there is no second number to keep in step.
    this.seaLevelDensityKgM3 = M._of_atmo_density(bodyId, 0);
    this.atmosphereTopM = M._of_atmo_space_altitude(bodyId);
  }

  /**
   * `AtmosphereProfile::present()`, term for term and in the same order. Both
   * halves are required: a profile with a density and no ceiling, or a ceiling
   * and no density, is not an atmosphere, and /core makes exactly that call.
   */
  get hasAtmosphere(): boolean {
    return this.seaLevelDensityKgM3 > 0 && this.atmosphereTopM > 0;
  }

  /** Build whichever body the config chose. The two named factories below are
   *  now shorthands for this, so there is one construction path, not three. */
  static create(M: OfCoreModule, bodyId: BodyId, seedLo: number, seedHi: number,
                swellScale?: number): PlanetBody {
    return new PlanetBody(
      M, createBodyHandle(M, bodyId, seedLo, seedHi, swellScale),
      bodyId === 1 ? 'Cinder' : 'Forge', bodyId,
    );
  }

  static forge(M: OfCoreModule, seedLo: number, seedHi: number): PlanetBody {
    return PlanetBody.create(M, 0, seedLo, seedHi);
  }

  static cinder(M: OfCoreModule, seedLo: number, seedHi: number): PlanetBody {
    return PlanetBody.create(M, 1, seedLo, seedHi);
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
