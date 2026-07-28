// THE surface lighting constants, in one file because two materials now need
// the same three numbers and a transcribed copy is a second authority.
//
// TerrainShader lights itself. It never reads three's light list, so its
// ambient, its sky-ambient weight and its direct-sun irradiance are literals in
// its own uniform block rather than anything three knows about. That was fine
// while it was the only consumer.
//
// RN-64 gave the environment capture a GROUND half (SkyAtmosphere in ground
// mode), whose whole correctness argument is that it computes the SAME
// expression a terrain fragment computes for the flat ground at that point. If
// these three numbers were written twice, the first retune of either copy would
// put the props' idea of the ground out of step with the ground, and the
// symptom would be precisely the defect RN-64 exists to remove: props that
// disagree with the terrain about how much light there is at dawn.
//
// They are exported as the live objects, not as numbers to copy, so both
// materials hold the same instances and there is nothing to synchronise. See
// Atmosphere.glsl's `createAtmosphereUniforms` note, which is the same argument
// about the same problem one layer up.

import * as THREE from 'three';

/**
 * The floor under everything: what a face receives with no sky and no sun. It
 * is what stops a fully shadowed slope reading as a hole in the world rather
 * than as shaded ground.
 */
export const TERRAIN_AMBIENT = new THREE.Color(0.030, 0.034, 0.045);

/**
 * How much of the sky-scattering integral reaches a fully open facet. Not 1:
 * `ofAtmoScatter` along the zenith is the radiance of one direction, and this
 * is the weight that turns it into the irradiance of a whole hemisphere at the
 * level the ACES curve is exposed for.
 */
export const TERRAIN_SKY_AMBIENT = 0.32;

/**
 * Direct-sun irradiance on a facing surface, before transmittance and shadow.
 * The literal that appears twice in TerrainShader as `1.45 * ndl * shadow` and
 * `1.45 * max(dot(up, sd), 0.0) * shadow`.
 */
export const TERRAIN_SUN_IRRADIANCE = 1.45;
