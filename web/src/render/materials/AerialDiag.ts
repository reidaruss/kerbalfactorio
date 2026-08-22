// RN-2540 (lane N7, THE ADDITIVE BLUE FLOOR OVER THE CANOPY). THE FOUR KNOBS
// THAT MAKE AERIAL PERSPECTIVE ATTRIBUTABLE, on both surfaces that draw a
// crown.
//
// WHY THIS FILE EXISTS AT ALL, and it is RN-952's lesson verbatim: a term with
// no switch is the one candidate no experiment can eliminate. Going into this
// lane the props' aerial perspective had `?prophaze=`, and the TERRAIN's -- the
// same two calls, the same arguments, `TerrainFragLight.glsl.ts`'s own copy of
// the model -- had NOTHING except the global `?atmos=0`, which deletes the sky
// as well and is the contaminated control the A4 verifier already threw out
// (rendering.md 2.12.2). So half of every crown rectangle in this project (the
// far treeline PAINT rides the terrain fragment, the cards ride the prop one)
// could not be isolated at all, and the aerial term could not be charged or
// exonerated for the blue that four audits photographed.
//
// AND WHY A `PAINT` AND NOT ONLY AN AMPLITUDE. Aerial perspective is
// `col * T + Lin`: an amplitude control moves BOTH halves at once, so
// `haze=0 -> haze=1` prices the extinction and the in-scatter together and
// cannot say which one carries a channel. The paint arm sets the SOURCE
// RADIANCE to zero and leaves the identical two calls in place, so the
// fragment renders exactly `Lin` -- the additive floor alone, on the real
// geometry, at the real range, through the real phase function. Two arms and
// one subtraction then split the term without a model.
//
//   ?terrainhaze=0   the terrain's aerial perspective off (value control)
//   ?terrainhaze=N   the same, scaled
//   ?terrainpaint=1  the terrain renders its aerial in-scatter ALONE
//   ?proppaint=1     the props render their aerial in-scatter ALONE
//
// (`?prophaze=` already exists and lives with its own GLSL in
// `PropSkyAmbient.ts`; this file owns the other three and the parser all four
// share.)
//
// RN-150-safe in all cases: a MISSING parameter is missing, never
// `Number(null) === 0`.

import * as THREE from 'three';

/**
 * The shared parser. `dflt` is what an ABSENT parameter means, `'0'` is always
 * exactly zero, and anything else finite is taken literally so an arm can be a
 * sweep rather than a toggle.
 */
export function aerialDiagAmp(name: string, dflt: number): number {
  const raw = new URLSearchParams(self.location.search).get(name);
  if (raw === null) return dflt;
  if (raw === '0') return 0;
  const f = Number(raw);
  return Number.isFinite(f) ? f : dflt;
}

/**
 * The terrain's aerial-perspective scale. 1 is the shipped frame EXACTLY: the
 * GLSL below mixes from the un-hazed radiance to the hazed one by this value,
 * and at 1 that `mix` is the algebraic identity, so the pair is one uniform
 * apart on one program rather than two shader variants that could disagree.
 */
export const uApAmp: THREE.IUniform<number> = { value: aerialDiagAmp('terrainhaze', 1) };

/**
 * The terrain's paint arm. 0 is the shipped frame EXACTLY (`mix(lit, 0, 0)` is
 * `lit`); 1 zeroes the surface radiance BEFORE the two aerial calls, so the
 * fragment is the in-scatter plus the boundary-layer haze and nothing else.
 */
export const uApPaint: THREE.IUniform<number> = { value: aerialDiagAmp('terrainpaint', 0) };

/** The props' paint arm, the same knob on `PropSkyAmbient.ts`'s copy. */
export const uPropPaint: THREE.IUniform<number> = { value: aerialDiagAmp('proppaint', 0) };

/**
 * `?propspec=0`. THE PROPS' SPECULAR, which is the OTHER term on a canopy card
 * that is not multiplied by the albedo and had no switch of any kind. Its
 * uniform and its splice live in `PropSkyAmbient.ts` beside the line they
 * replace; only the parsed value is read here, so this module stays the one
 * place an arm's value can be read back from.
 */
export const propSpecAmp = (): number => aerialDiagAmp('propspec', 1);

/**
 * The probe surface. Published so an arm can be proved NON-VACUOUS from the
 * page's own state rather than from the flag having been typed, which is
 * RN-2268's scar: a flag that never reached a uniform reports the default and
 * the report describes it as the request.
 */
export function aerialDiagState(): {
  terrainHaze: number; terrainPaint: number; propPaint: number; propSpec: number;
  flags: { terrainhaze: boolean; terrainpaint: boolean; proppaint: boolean;
    propspec: boolean };
} {
  const q = new URLSearchParams(self.location.search);
  return {
    terrainHaze: uApAmp.value,
    terrainPaint: uApPaint.value,
    propPaint: uPropPaint.value,
    propSpec: propSpecAmp(),
    flags: {
      propspec: q.get('propspec') !== null,
      terrainhaze: q.get('terrainhaze') !== null,
      terrainpaint: q.get('terrainpaint') !== null,
      proppaint: q.get('proppaint') !== null,
    },
  };
}

(window as unknown as { __ofAerialDiag: unknown }).__ofAerialDiag = {
  report: aerialDiagState,
};
