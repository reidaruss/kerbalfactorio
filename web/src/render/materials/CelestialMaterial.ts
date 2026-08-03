// RN-845. THE SHADING OF A BODY YOU ARE NOT STANDING ON.
//
// Nothing in this client has ever drawn a second celestial body, so there is no
// prior art to follow and no material to reuse: `PlanetProxy` is a
// `MeshLambertMaterial` on the body you ARE on, seen from six units away, and
// every terrain material in the project shades a surface under the camera.
// A moon at 1.2e7 m is a different problem, and three of its properties decide
// the whole shader:
//
// 1. IT IS SMALL. At `FAR_SCALE` Cinder is a 2-unit sphere 120 units away and
//    subtends 1.91 degrees, which on a 60-degree vertical FOV at 1080 lines is
//    34 pixels. Everything here is therefore sized for a 34-pixel disc FIRST
//    and for the approach shot second, and the two want different things: the
//    disc wants a correct LIMB and a correct TERMINATOR, and the approach wants
//    relief. Both are here; only the first is cheap.
//
// 2. IT IS AIRLESS, OR IT IS NOT, AND /core ALREADY KNOWS. `uAirless` is
//    `PlanetBody.hasAtmosphere` inverted, i.e. `AtmosphereProfile::present()`
//    read back through `_of_atmo_*`. That is the same authority RN-840 used to
//    stop the moon being rendered with Earth's air, and re-using it here means
//    a third body authored in `atmosphere.h` gets the right disc with no edit.
//
// 3. A LAMBERT SPHERE DOES NOT LOOK LIKE A MOON, AND THAT IS PHYSICS RATHER
//    THAN TASTE. Lambert falls off as cos(incidence) and drives the limb of a
//    full moon to black; the real Moon is very nearly UNIFORM across its disc
//    at full phase, because regolith backscatters. The single-scattering law
//    for a dark, rough, airless regolith is LOMMEL-SEELIGER,
//
//        I  =  (w/4pi) * mu0 / (mu0 + mu)
//
//    with mu0 = cos(incidence) and mu = cos(emission), and it is flat across
//    the disc for exactly that reason. It costs one divide. Using Lambert here
//    would have produced the grey ball ART-DIRECTION.md calls a failure, and no
//    amount of texture would have fixed it, because the defect is in the falloff
//    and not in the albedo.
//
// A body WITH air keeps Lambert, because a Lambert-ish falloff plus a limb of
// forward-scattered air is what a planet with an atmosphere actually looks like
// from outside, and Lommel-Seeliger is a regolith law with no business there.
// The branch is a uniform and not two programs (DW-10: one more shader slot for
// a case that differs by four lines is not a trade worth making).

import * as THREE from 'three';
import { CELESTIAL_VERT, CELESTIAL_FRAG } from './Celestial.glsl.js';

/** What the disc needs to know about the body it is drawing. */
export interface CelestialLook {
  /** Body radius, metres. The relief gradient needs a real length scale. */
  readonly radiusM: number;
  /** Peak-to-datum relief the height texture encodes, metres. */
  readonly reliefM: number;
  /** 1 when /core says the profile is absent. Chooses the photometric law. */
  readonly airless: boolean;
  /**
   * The SINE of the angle past the terminator at which the top of the
   * atmosphere is still in sunlight: sqrt(1 - (R/(R+T))^2), with T taken from
   * `_of_atmo_space_altitude`. Exactly 0 on an airless body, which is what
   * makes "no twilight, no limb" structural rather than a branch. Forge:
   * T/R = 60/600 km gives 0.4167, i.e. a 24.6 degree wedge, which is what a
   * 10-per-cent-of-radius air column geometrically buys.
   */
  readonly atmoSin: number;
  /** The air's scale height in metres, MEASURED from /core's density profile.
   *  It is what stops the twilight wedge being a 24.6-degree wash: the wedge is
   *  where sunlit air EXISTS, this is where there is enough of it to see. */
  readonly atmoScaleHM: number;
  /** Equirect height map, R channel, [0,1] over [-reliefM, +reliefM]. */
  readonly relief: THREE.Texture;
  /** Equirect albedo. */
  readonly albedo: THREE.Texture;
  readonly texW: number;
  readonly texH: number;
}

export interface CelestialUniforms {
  uSunDir: { value: THREE.Vector3 };
  uEyeObj: { value: THREE.Vector3 };
  uReliefM: { value: number };
  uRadiusM: { value: number };
  uTexel: { value: THREE.Vector2 };
  uAirless: { value: number };
  /** sqrt(1 - (R/(R+T))^2) from /core's own atmosphere ceiling. 0 = airless. */
  uAtmoSin: { value: number };
  uAtmoH: { value: number };
  uShine: { value: THREE.Color };
  uShineDir: { value: THREE.Vector3 };
  uSunIrr: { value: number };
  uReliefGain: { value: number };
  uDetailGain: { value: number };
  uAmbient: { value: THREE.Color };
  uRelief: { value: THREE.Texture };
  uAlbedo: { value: THREE.Texture };
  uDebug: { value: number };
  [k: string]: { value: unknown };
}

/** JS twin of `dirForUv`. The bake and the shader share this parameterisation
 *  and nothing else; `CelestialBodies.uvResidual` measures the pair. */
export function dirForUv(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (1 - v) * Math.PI;
  const theta = u * 2 * Math.PI;
  const sp = Math.sin(phi);
  return out.set(-Math.cos(theta) * sp, Math.cos(phi), Math.sin(theta) * sp);
}

export function createCelestialMaterial(look: CelestialLook): {
  material: THREE.ShaderMaterial; uniforms: CelestialUniforms;
} {
  const uniforms: CelestialUniforms = {
    uRelief: { value: look.relief },
    uAlbedo: { value: look.albedo },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uEyeObj: { value: new THREE.Vector3() },
    uReliefM: { value: look.reliefM },
    uRadiusM: { value: look.radiusM },
    uTexel: { value: new THREE.Vector2(1 / look.texW, 1 / look.texH) },
    uAirless: { value: look.airless ? 1 : 0 },
    uAtmoSin: { value: look.atmoSin },
    uAtmoH: { value: Math.max(1, look.atmoScaleHM) },
    uShine: { value: new THREE.Color(0, 0, 0) },
    uShineDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunIrr: { value: 1.0 },
    uReliefGain: { value: 1.0 },
    uDetailGain: { value: 0.0 },
    uAmbient: { value: new THREE.Color(0, 0, 0) },
    uDebug: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: CELESTIAL_VERT,
    fragmentShader: CELESTIAL_FRAG,
    // The far scene is depth-tested against the observer's own planet proxy, so
    // this writes depth like anything else in the pass. It is opaque: a moon is.
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
  material.name = 'celestialBody';
  return { material, uniforms };
}
