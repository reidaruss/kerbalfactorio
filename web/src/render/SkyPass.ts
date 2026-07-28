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

export interface SkyOptions {
  readonly seedLo: number;
  readonly sunT: number;
  readonly tier: QualityTier;
  readonly atmosphere: boolean;
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
  private readonly sky: SkyAtmosphere | null;
  /** RN-64. False under `?iblground=0` or `?atmos=0`. */
  private readonly iblGroundOn: boolean;
  private readonly stars: Starfield | null;
  private readonly sunSprite: THREE.Sprite;

  constructor(params: AtmosphereParams, o: SkyOptions) {
    this.params = params;
    this.atmos = createAtmosphereUniforms(params, o.atmosphere);
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
    this.iblGroundOn = o.atmosphere && o.iblGround && this.sky !== null;
    this.sky?.setGroundGain(o.iblGroundAmp);

    this.stars = o.stars ? createStarfield(o.seedLo, o.pixelRatio) : null;
    if (this.stars !== null) this.group.add(this.stars.points);

    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SkyPass.discTexture(), color: 0xfff3d6, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: false,
    }));
    this.sunSprite.scale.set(0.055, 0.055, 1);
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
