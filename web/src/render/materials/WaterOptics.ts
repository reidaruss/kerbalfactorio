// THE WATER OPTICS AUTHORITY: one extinction spectrum and one equilibrium
// radiance, read by BOTH sides of the water surface.
//
// WHY THIS FILE EXISTS AT ALL, which is standing rule 1 pointed at a colour.
// RN-47 shipped the submerged view as a post pass with `uwSigma` and `uwTint`
// living in PostConfig, and that was right: those are the numbers the post pass
// tunes. RN-53 then needed the SAME two quantities in the water surface's own
// shader, because what you see looking DOWN into a pond is the bed attenuated by
// the water column over it, and what you see looking UP from inside it is the
// scene attenuated by the water column in front of it. They are one integral
// seen from two sides.
//
// Transcribing the triple into a second file would have made the pond one colour
// from the bank and a different colour from underneath, and the two would have
// drifted the first time anyone tuned either. So the constants move HERE and
// PostConfig imports them. That is DW-22's argument (one atmosphere model, held
// by reference) applied to water, and it is the same reason `Atmosphere.glsl.ts`
// hands out uniform OBJECTS rather than numbers.
//
// PROVENANCE, kept with the numbers rather than left in the lane that measured
// them: the shape is the Smith and Baker (1981) pure-water absorption spectrum,
// about 0.24 /m at 620 nm against 0.011 /m at 450 nm, so red is absorbed roughly
// 22x harder than blue, and that RATIO rather than the absolute level is what
// makes water look like water. What ships is that spectrum with a small, roughly
// grey scattering and dissolved-organics term added for a SMALL FRESHWATER POND,
// which is turbid in a way clear ocean water is not.
//
// Sanity check at this pond's own scale, and it is the check that says the
// numbers are pond numbers rather than ocean numbers: the basin is 4.0 m deep,
// so a vertical ray across it keeps exp(-0.35 * 4) = 0.25 of its red, 0.79 of
// its green and 0.84 of its blue. A visible colour cast at pond depth, not a
// wash.

/** Extinction per metre, per channel. Red hardest. */
export const WATER_SIGMA: readonly [number, number, number] = [0.35, 0.06, 0.045];

/**
 * The equilibrium radiance: what a pixel at infinite path becomes. Blue-green
 * and DARK, at roughly a fifth of lit-ground radiance, because it is sunlight
 * that has already been scattered sideways through several metres of the same
 * water the coefficients above describe. A bright value here lifts the frame
 * instead of drowning it, which is the failure the term exists to avoid.
 */
export const WATER_TINT: readonly [number, number, number] = [0.045, 0.135, 0.155];

/**
 * SURFACE tints, used only where the transmitted term is NOT available (i.e.
 * with refraction off, and on the shallow ramp that carries the alpha).
 *
 * Read as "what colour is the water column", so the shallow end is close to the
 * wet ground it stands on and the deep end is the only genuinely blue thing in
 * the pond. Note neither is the 0x14406e the Ocean BIOME paints dry ground with;
 * that value is a terrain palette entry and borrowing it here would tie a water
 * look to a ground look.
 *
 * KEPT AS HEX, and that is not laziness. `new THREE.Color(hex)` converts sRGB to
 * the linear working space on construction, so the numbers the shader receives
 * are 0.159 and not 0.435. Transcribing the decimals WG-42 was passing would
 * have silently brightened both tints by the inverse of the sRGB curve, which is
 * a look change wearing a refactor's clothes.
 */
export const WATER_SHALLOW_HEX = 0x6f8f86;
export const WATER_DEEP_HEX = 0x1b4f63;

/** Alpha at the shoreline, and at full depth, on the no-refraction path. */
export const WATER_ALPHA_SHORE = 0.14;
export const WATER_ALPHA_DEEP = 0.82;
/** Depth, in metres, at which the alpha ramp has fully saturated. */
export const WATER_ALPHA_FULL_M = 2.6;
