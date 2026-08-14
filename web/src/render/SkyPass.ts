// Pass 1 contents: the analytic atmosphere, the star field and the sun disc.
// Rotation-only camera, depth test and write off, so this paints every pixel and
// everything after composites over it by clear order (ARCHITECTURE.md 3.1).
//
// Draw order inside the pass is the whole regime story: atmosphere (-1), stars
// (1, additive), sun (2, additive). A lit sky therefore washes the stars out and
// a dark one lets them through, with no switch anywhere.

import * as THREE from 'three';
import type { AtmosphereParams, AtmosphereUniforms } from './materials/Atmosphere.glsl.js';
import { createAtmosphereUniforms, daylightFactor } from './materials/Atmosphere.glsl.js';
import { createSkyAtmosphere, type SkyAtmosphere } from './materials/SkyAtmosphere.js';
import { createStarfield, type Starfield } from './materials/StarfieldMaterial.js';
import type { QualityTier } from '../app/Config.js';
import { IBL_DISC_GAIN } from './IblDiag.js';

// ===========================================================================
// RN-1572. THE SUN DISC: ITS REAL ANGULAR SIZE, AT THE RADIANCE THAT KEEPS ITS
// IRRADIANCE. This is a LOOK change and it is meant to be one.
//
// WHAT WAS WRONG, and it was two things that only make sense together.
// RN-1525 measured the sprite at `scale 0.055` with `sizeAttenuation: false`,
// which is angular-size preserving under any projection (the NDC extent and
// `tan(halfFov)` cancel, checked against the 90-degree cube camera as well as
// the presented one), and found the disc **3.15 degrees across against the real
// sun's 0.53**. Its solid angle is 2.4e-3 sr, i.e. 1.9e-4 of the sphere, and
// for a specular surface the set of normals that reflects it into the eye is
// that same fraction: on the canonical machine pose there are none of them, so
// no surface in the frame ever caught a highlight. Meanwhile RN-1523 found the
// disc's peak radiance is its LDR colour, about 1.0 linear, while
// `AtmosphereParams.sunIntensity` -- documented in `Atmosphere.glsl.ts` as
// "radiance scale for the sun disc" -- is 15.0 and reaches only the scattering
// integral. So the cube had no bright source in it at all: RN-1520 measured
// `brightFrac` = 0.0000 of 393,216 texels and `peakRatio` 7.99, against a real
// sky's sun-to-sky radiance ratio of 1e4 to 1e5.
//
// WHY EITHER HALF ALONE IS THE WRONG FIX, both measured rather than argued.
// RN-1524 raised the radiance alone through `?ibldisc=` and priced it: at k=15
// the canonical machine box moves 20.43 -> 20.44 and a verified MIRROR under a
// 200x sun moves 24.54 -> 24.55, because a 3.15-degree source reflected off
// nothing is still reflected off nothing. And narrowing alone would take an
// already-too-dim disc and remove 97 per cent of its energy.
//
// SO THE TWO MOVE TOGETHER AND THE PRODUCT IS CONSERVED. Radiance times solid
// angle is irradiance; taking the diameter from 3.15 to 0.53 degrees divides
// the solid angle by (3.15/0.53)^2 = 35.3, so the radiance is multiplied by the
// same 35.3. Same total energy arriving at every surface, 35x the peak, and a
// highlight six times narrower -- which is the whole point, because that is
// what a curved plate can actually catch.
//
// WHAT THIS DOES NOT DO. It does not touch `sunIntensity`, which still means
// what its consumers use it for (the scattering integral and the aerial haze),
// and it does not double-count the direct sun: the `ShadowRig` cascade-0
// directional light still carries the direct term with its own GGX lobe, and
// RN-1524 measured that double count at `meanRatio` 1.0051 for a 15x raise. The
// conservation above is what keeps that number near 1.0 here too, and this lane
// measures it rather than assuming it.
//
// THE INSTRUMENT'S OWN LIMIT, WHICH BITES HARDER AFTER THIS CHANGE THAN BEFORE.
// RN-1522's rule: a cube-map capture cannot report a feature narrower than
// about three of its own texels. At `iblSize` 256 a texel is 0.35 degrees, so a
// 0.53-degree disc is 1.5 texels and any peak read there is a LOWER BOUND. The
// peak must therefore be re-taken at a resolution the feature survives, and the
// irradiance claim must be checked at the size the game actually captures at,
// because energy that falls between texel centres is energy the PMREM never
// integrates. Both are measured in RN-1573 rather than reasoned about.
//
// STANDING RULE 7'S NEGATIVE CONTROL: `?sundisc=0` restores the disc exactly as
// it was before RN-1572 -- 0.055 scale, gain 1, the 3.15-degree LDR sprite --
// so the before and after of a LOOK change are one flag apart on ONE binary.
// Two builds would differ by everything and a reader could not tell the disc
// from the weather. The boot default is a fixture and the raw string is
// published beside the resolved value (rendering.md section 2.6).
const SUN_DISC_RAW = new URLSearchParams(self.location.search).get('sundisc');
const SUN_DISC_LEGACY = SUN_DISC_RAW === '0';

const SUN_DISC = (() => {
  /** RN-1525's measurement of what shipped, and the scale that produced it. */
  const legacyAngularDeg = 3.15;
  const legacySpriteScale = 0.055;
  /** The real sun's angular diameter from a 1 AU orbit, degrees. */
  const angularDeg = SUN_DISC_LEGACY ? legacyAngularDeg : 0.53;
  const spriteScale = legacySpriteScale * (angularDeg / legacyAngularDeg);
  /** Solid angle goes as the square of the diameter, so radiance does too. */
  const radianceGain = (legacyAngularDeg / angularDeg) ** 2;
  return { angularDeg, legacyAngularDeg, legacySpriteScale, spriteScale,
    radianceGain, legacy: SUN_DISC_LEGACY, raw: SUN_DISC_RAW };
})();

/** RN-1572. Published so a probe reads the authored numbers rather than
 *  re-deriving them, and so a frame pair can name which disc it was taken on. */
export const SUN_DISC_STATE = SUN_DISC;

export interface SkyOptions {
  readonly seedLo: number;
  readonly sunT: number;
  readonly tier: QualityTier;
  /**
   * Whether the SKY BOX EXISTS AT ALL. `?atmos=0` and `?clear=` set this false,
   * which is the pre-RN-840 meaning of the flag and is left exactly as it was:
   * no box, no ground half, nothing painted, so a crack probe can count void
   * pixels. It is NOT the airless case.
   */
  readonly atmosphere: boolean;
  /**
   * RN-840. Whether the SCATTERING INTEGRAL RUNS, i.e. `uAtmosOn`. False on an
   * airless body, where the box still exists and still paints (black above the
   * horizon, and the RN-64 ground half below it, which is the whole of the
   * airless ambient). Splitting this from `atmosphere` is the entire fix: the
   * two were one boolean, so the only way to stop the aerial perspective
   * veiling Cinder's craters was to delete the object that supplies the props
   * their bounce, and the moon went from a white fog bank to a black
   * lithograph without ever passing through correct.
   */
  readonly scattering: boolean;
  readonly stars: boolean;
  readonly pixelRatio: number;
  /** `?iblground=0` builds no ground shell at all, which is RN-64's control. */
  readonly iblGround: boolean;
  /** `?iblgroundamp=` scales the ground radiance. 1 ships; see setGroundGain. */
  readonly iblGroundAmp: number;
}

export class SkyPass {
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(1, 0.3, 0).normalize();
  /** The one uniform record, shared BY REFERENCE with the terrain materials. */
  readonly atmos: AtmosphereUniforms;
  readonly params: AtmosphereParams;
  sunT = 0;
  /** 0 in space or at night, 1 in lit air. Drives the star fade. */
  daylight = 0;
  /**
   * RN-844. WHAT THE BOOT SUN SOLVE WAS AIMED AT, and where.
   *
   * `?sundot=` is an elevation and `sunT` is a phase, and the map between them
   * is the observer's local up. Boot solves once, at the spawn. Every probe
   * that teleports afterwards keeps the phase and silently loses the elevation:
   * on Cinder, asks of 0.28 / 0.55 / 0.92 delivered 0.286 / 0.551 / 0.920 at the
   * spawn and -0.778 / -0.815 / -0.706 at the crater floor, i.e. three nights
   * inside a 0.109 band. Publishing the site the solve was for is what lets a
   * probe notice that; `elevationDot` alone cannot, because it is a correct
   * answer to a question the caller stopped asking. Null under `?t=`, which is
   * an absolute phase and was never solved for anywhere.
   */
  solvedFor: { wantDot: number; latDeg: number; lonDeg: number } | null = null;
  private readonly sky: SkyAtmosphere | null;
  /** RN-64. False under `?iblground=0` or `?atmos=0`. */
  private readonly iblGroundOn: boolean;
  private readonly stars: Starfield | null;
  private readonly sunSprite: THREE.Sprite;
  /** RN-1524. The shipped disc colour, so `setDiscBoost` is idempotent and
   *  `false` restores the literal rather than an accumulated product. */
  private readonly discBase = new THREE.Color();

  constructor(params: AtmosphereParams, o: SkyOptions) {
    this.params = params;
    this.atmos = createAtmosphereUniforms(params, o.scattering);
    // The aerial-perspective control, and it is a RUNTIME toggle for the same
    // reason `PropLibrary.setVisible` is: the claim being measured is a matched
    // pair, and a page reload cannot guarantee the same camera, the same
    // streamed chunk set or the same sun. Setting sigma to zero makes
    // `ofAtmoAerial` return its input unchanged, so "off" is the identity and
    // not a second code path. Registered here because this class owns the one
    // shared uniform record (DW-22) and is therefore the only place that can
    // reach every consumer of it at once.
    (window as unknown as { __ofAtmos: unknown }).__ofAtmos = {
      setAerial: (on: boolean): number => {
        this.atmos.uAerosol.value.x = on ? params.aerosolSigma : 0;
        return this.atmos.uAerosol.value.x;
      },
      aerosol: (): number[] => [
        this.atmos.uAerosol.value.x, this.atmos.uAerosol.value.y,
        this.atmos.uAerosol.value.z,
      ],
      // RN-840. THE SCATTERING INTEGRAL, at runtime, for the same reason
      // `setAerial` is a runtime toggle and not a page flag: the claim under
      // test is a MATCHED PAIR, and a reload cannot guarantee the same camera,
      // the same streamed chunk set or the same sun. It buys the airless probe
      // something a reload cannot: one mask, built from the frame where sky and
      // ground are unambiguous, reused on the frame where they are not.
      //
      // It is also what makes `?atmos=0`'s meaning safe to leave alone. That
      // flag deletes the sky box; this one only stops the integral.
      setScattering: (on: boolean): number => {
        this.atmos.uAtmosOn.value = on ? 1 : 0;
        return this.atmos.uAtmosOn.value;
      },
      atmosOn: (): number => this.atmos.uAtmosOn.value,
    };

    this.sky = o.atmosphere ? createSkyAtmosphere(this.atmos, o.tier) : null;
    if (this.sky !== null) this.group.add(this.sky.mesh);

    // THE GROUND HALF OF THE ENVIRONMENT (RN-64) IS THE SKY BOX ITSELF, in a
    // mode raised for the duration of one capture.
    //
    // THE FIRST DESIGN WAS A SECOND MESH INTERPOSED INTO THE SKY SCENE, and it
    // was abandoned on a measurement rather than on taste: with the shell
    // rendering correctly in the presented frame (it paints the lower
    // hemisphere, the horizon lands where it should, the discard is right), a
    // FORTY-fold change in its radiance moved the prop band by 0.05 of a count,
    // i.e. by nothing. A changed input that does not change the output is a
    // wiring diagnosis, never a small effect. The one mesh that is certainly in
    // the capture is the one the capture has always worked from, so the ground
    // half goes there and the graph question disappears.
    // RN-840. NO `o.scattering` TERM, and that omission is the load-bearing
    // half of the airless ambient.
    //
    // The ground half is not made of sky. Its fragment shader computes
    // TerrainShader's flat-ground radiance, `albedo * (ambient + skyAmb +
    // sunT * SUN_IRR * dot(up, sd))`, in which the only scattering-dependent
    // term is `skyAmb`, and that term correctly goes to zero in a vacuum while
    // the direct term does not. So on an airless body this shell still paints
    // the lower hemisphere with sunlit regolith, which is exactly the fill that
    // stops a prop's shadowed side being a silhouette. Deleting it there was
    // the difference between the Apollo surface and a black lithograph.
    //
    // `?iblground=0` still removes it: that is RN-64's own control and it is
    // untouched.
    this.iblGroundOn = o.atmosphere && o.iblGround && this.sky !== null;
    this.sky?.setGroundGain(o.iblGroundAmp);

    this.stars = o.stars ? createStarfield(o.seedLo, o.pixelRatio) : null;
    if (this.stars !== null) this.group.add(this.stars.points);

    // RN-1520. THE SUN'S RADIANCE IN THIS SPRITE IS ITS LDR COLOUR, ~1.0
    // LINEAR, WHILE THE SKY AROUND IT IS THE SCATTERING INTEGRAL TIMES
    // `sunIntensity` (15.0 on Forge). `sunIntensity` is documented in
    // Atmosphere.glsl.ts as "radiance scale for the sun disc" and reaches
    // `uSunColor` and nothing else; the disc has never read it. On the presented
    // frame that is invisible, because ACES clips both to white. In the
    // ENVIRONMENT CAPTURE it is the whole story: the brightest feature of the
    // cube is haze, so the cube has no high-frequency content and no PMREM size
    // can resolve structure that is not there. `setDiscBoost` is the arm.
    //
    // RN-1572. THE DISC IS NOW THE REAL SUN'S ANGULAR SIZE AT THE RADIANCE THAT
    // KEEPS ITS IRRADIANCE. See `SUN_DISC` above for the derivation and for why
    // narrowing WITHOUT brightening (or the reverse) is the wrong half.
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SkyPass.discTexture(), color: 0xfff3d6, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: false,
    }));
    (this.sunSprite.material as THREE.SpriteMaterial).color
      .multiplyScalar(SUN_DISC.radianceGain);
    this.discBase.copy((this.sunSprite.material as THREE.SpriteMaterial).color);
    this.sunSprite.scale.set(SUN_DISC.spriteScale, SUN_DISC.spriteScale, 1);
    this.sunSprite.renderOrder = 2;
    this.group.add(this.sunSprite);

    this.group.name = 'skyPass';
    this.setSunT(o.sunT);
  }

  /** Sun angle in turns, [0,1). Deterministic: __of.setTime() drives this. */
  setSunT(t: number): void {
    this.sunT = ((t % 1) + 1) % 1;
    SkyPass.dirForT(this.sunT, this.sunDirection);
    this.sunSprite.position.copy(this.sunDirection).multiplyScalar(7);
    this.atmos.uSunDir.value.copy(this.sunDirection);
  }

  /**
   * Per-frame update. `camBody` is the eye in PLANET-CENTRED metres and `up` is
   * the local radial there; both come straight from the observer, so the sky,
   * the aerial perspective and the star fade are all driven by one position.
   */
  update(camBody: { x: number; y: number; z: number }, up: THREE.Vector3, altM: number): void {
    this.sky?.setCameraPos(camBody.x, camBody.y, camBody.z);
    const elev = this.sunDirection.dot(up);
    this.daylight = daylightFactor(this.params, altM, elev);
    this.stars?.setDaylight(this.daylight);
    // Below the horizon the disc must not hang in the sky: the terminator is the
    // point of the milestone. Terrain occludes it from pass 3 on the ground, but
    // from altitude there is no terrain in the way.
    this.sunSprite.visible = elev > -0.02 || altM > 2.0e4;
  }

  /** Sun elevation as dot(sunDir, localUp). */
  elevation(up: THREE.Vector3): number { return this.sunDirection.dot(up); }

  /** RN-64. Whether a ground half exists to be raised at all. */
  get hasIblGround(): boolean { return this.iblGroundOn; }

  /**
   * RN-840. Whether the sky box was BUILT. Distinct from `uAtmosOn`, and the
   * distinction is the whole point: an airless body has a box and no integral,
   * `?atmos=0` has neither, and both paint a black sky.
   */
  get hasSkyBox(): boolean { return this.sky !== null; }

  /** RN-64. The biome albedo the ground half of the environment is built from. */
  setGroundAlbedo(c: THREE.Color): void { this.sky?.setGroundAlbedo(c); }

  /**
   * RN-64. Raise the ground half. SkyIbl calls this with true, captures, and
   * calls it with false, all inside one synchronous call, so no presented frame
   * can see it raised. `?iblground=0` makes it a no-op rather than a branch at
   * the call site, on the `setAerial` precedent: off is the identity.
   */
  setGroundMode(on: boolean): void {
    if (this.iblGroundOn) this.sky?.setGroundMode(on);
  }

  /**
   * RN-1524. Raise the sun disc's radiance for the duration of ONE environment
   * capture, on `setGroundMode`'s precedent and for the same reason: SkyIbl
   * sets it, `environmentFrom` renders all six cube faces inside the same call
   * stack, and SkyIbl clears it, so no presented frame can observe it.
   *
   * `IBL_DISC_GAIN` is 1 unless `?ibldisc=` says otherwise, so with the flag
   * absent this multiplies by one and the capture is bit-identical to the one
   * before this method existed. Off is the identity, not a second code path.
   */
  setDiscBoost(on: boolean): void {
    const m = this.sunSprite.material as THREE.SpriteMaterial;
    m.color.copy(this.discBase);
    if (on) m.color.multiplyScalar(IBL_DISC_GAIN);
  }

  static dirForT(t: number, out: THREE.Vector3): THREE.Vector3 {
    const a = t * Math.PI * 2;
    return out.set(Math.cos(a), 0.42, Math.sin(a)).normalize();
  }

  /**
   * The sun angle that puts `targetDot` of light on a given local up. Solved
   * rather than hand-tuned, so ANY ?lat=/?lon=/?scenario= combination is lit
   * without someone re-guessing a magic t. ?t= still overrides absolutely.
   */
  static solveSunT(up: THREE.Vector3, targetDot: number): number {
    const d = new THREE.Vector3();
    let bestT = 0;
    let bestErr = Infinity;
    for (let i = 0; i < 720; ++i) {
      const t = i / 720;
      SkyPass.dirForT(t, d);
      const err = Math.abs(d.dot(up) - targetDot);
      if (err < bestErr) { bestErr = err; bestT = t; }
    }
    return bestT;
  }

  dispose(): void {
    this.sky?.dispose();
    this.stars?.dispose();
    (this.sunSprite.material as THREE.Material).dispose();
  }

  private static discTexture(): THREE.Texture {
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; ++y) {
      for (let x = 0; x < N; ++x) {
        const dx = (x + 0.5) / N - 0.5;
        const dy = (y + 0.5) / N - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const a = Math.max(0, 1 - d);
        const v = Math.round(255 * Math.min(1, a * a * 3));
        const i = (y * N + x) * 4;
        data[i] = 255; data[i + 1] = 250; data[i + 2] = 235; data[i + 3] = v;
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
}
