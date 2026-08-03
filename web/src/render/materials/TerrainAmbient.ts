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
 *
 * RN-952: IT HAD NO CONTROL, AND THAT IS WHY IT WENT UNFOUND FOR A NIGHT.
 * `?starlight=0` removes the term BELOW this one and leaves this one standing,
 * so the previous lane's search for the constant on Cinder's night ground
 * turned off the lamp, the ground IBL, the bounce and the horizon occlusion,
 * found it unmoved, and correctly concluded that no mechanism they knew about
 * accounted for it. All four of those are mechanisms this domain BUILT and can
 * name; this literal is a mechanism this domain built and could not switch
 * off, which made it the one candidate no experiment could reach. Standing
 * rule 7 says every term gets a control that restores the state immediately
 * before it, and a term that predates the rule is exactly the term that ends
 * up unfalsifiable.
 *
 * `?terrainfloor=0` removes it; `?terrainfloor=` sweeps it. Applied at
 * construction so it reaches BOTH holders of this object by reference (the two
 * terrain materials and SkyAtmosphere's ground shell), including on any frame
 * before `terrainNightAmbient` has run.
 */
const FLOOR_AMP = ((): number => {
  const p = new URLSearchParams(self.location.search);
  const v = p.get('terrainfloor');
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : 1;
})();

/** The authored daylight floor, kept as a literal so the number in this file
 *  stays the number that is being discussed. */
const AMBIENT_DAY = new THREE.Color(0.030, 0.034, 0.045);

export const TERRAIN_AMBIENT = AMBIENT_DAY.clone().multiplyScalar(FLOOR_AMP);

/** The daylight value of the floor, kept so the night writer below is
 *  idempotent: it always writes base + starlight * k, never accumulates. */
const AMBIENT_BASE = TERRAIN_AMBIENT.clone();

/**
 * RN-152: THE STARLIGHT FLOOR. PH-86 landed the first real night and measured
 * it honestly: mid-field terrain at 0/255 through the post chain (the raw
 * shader night was ~2/255 and the grade's dark end crushes that to nothing),
 * i.e. unnavigable at range. This is the modest ambient that comes up as the
 * sun goes down: a clear moonless night, not a dim day.
 *
 * IT IS WRITTEN INTO THE SHARED TERRAIN_AMBIENT OBJECT, and that is the whole
 * design: both terrain materials AND SkyAtmosphere's ground shell hold this
 * Color BY REFERENCE (the RN-64 consistency this file exists for), so one
 * CPU-side write per frame reaches every consumer with zero shader changes,
 * zero new uniforms and zero programs. Blue-shifted, because starlight and
 * airglow read cold and a warm night floor reads as light pollution.
 *
 * The gate is the sun's own elevation: zero contribution above elevation
 * 0.03 (where the direct term still stands), full by -0.05 (the terminator's
 * transmittance has extinguished direct sun well before that). Day frames are
 * therefore IDENTICAL to the digit with the floor on or off, which is the
 * fork-proof a shared-object edit owes.
 *
 * `?starlight=0` removes it (standing rule 7); `?starlightamp=` sweeps it.
 * Both parse with the RN-150-safe pattern: a missing param is MISSING, not 0.
 */
const STARLIGHT = new THREE.Color(0.055, 0.065, 0.095);

const STARLIGHT_AMP = ((): number => {
  const p = new URLSearchParams(self.location.search);
  if (p.get('starlight') === '0') return 0;
  const v = p.get('starlightamp');
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : 1;
})();

/**
 * Drive the shared ambient from the sun's elevation. Called once per frame by
 * Systems beside the sky update; idempotent by construction.
 */
let lastK = 0;

export function terrainNightAmbient(elevationDot: number): number {
  const t = Math.min(1, Math.max(0, (0.03 - elevationDot) / 0.08));
  const k = t * t * (3 - 2 * t) * STARLIGHT_AMP;
  TERRAIN_AMBIENT.copy(AMBIENT_BASE);
  TERRAIN_AMBIENT.r += STARLIGHT.r * k;
  TERRAIN_AMBIENT.g += STARLIGHT.g * k;
  TERRAIN_AMBIENT.b += STARLIGHT.b * k;
  lastK = k;
  return k;
}

/**
 * RN-952. What the floor ACTUALLY IS this frame, published so a probe can read
 * the linear number instead of inferring it from pixels through an exposure, a
 * tone curve and a grade.
 *
 * The previous lane's whole difficulty was that a constant in the frame could
 * not be attributed to a constant in the code, because every quantity between
 * them is nonlinear. Two halves and the elevation that drove them, read
 * directly, turns that into arithmetic.
 *
 * Not routed through `window.__of` for Surfaces.ts's reason: Debug.ts belongs
 * to another lane and is over the line cap. One property, removable in one
 * line.
 */
export function terrainAmbientState(): {
  floorAmp: number; starlightAmp: number;
  day: [number, number, number]; starlight: [number, number, number];
  current: [number, number, number]; nightK: number;
} {
  return {
    floorAmp: FLOOR_AMP, starlightAmp: STARLIGHT_AMP,
    day: [AMBIENT_BASE.r, AMBIENT_BASE.g, AMBIENT_BASE.b],
    starlight: [STARLIGHT.r, STARLIGHT.g, STARLIGHT.b],
    current: [TERRAIN_AMBIENT.r, TERRAIN_AMBIENT.g, TERRAIN_AMBIENT.b],
    nightK: lastK,
  };
}

(window as unknown as { __ofAmbient: unknown }).__ofAmbient = {
  report: terrainAmbientState,
};

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
