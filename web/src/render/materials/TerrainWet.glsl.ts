// WET GROUND AT THE WATERLINE, the fourth surface-art term (RN-57).
//
// Split out of TerrainArt.glsl.ts at the 400-line cap (2.2 rule 1), on the
// TerrainFine/TerrainMid precedent. A leaf module of GLSL text that imports
// nothing; TerrainArt.glsl.ts imports and RE-EXPORTS it, so every existing
// call site keeps working. Nothing here changed in the move.

/**
 * WET GROUND AT THE WATERLINE (RN-57). The fourth term, and it is here for
 * exactly the reason the strata are: IN THIS ENGINE THE BEACH IS TERRAIN, NOT
 * WATER. A darkened ring around a pond drawn as its own geometry would be a
 * second surface to keep in step with the ground, a second draw call, and a
 * decal that would float or bury itself the moment the bed was dug. One term in
 * the material every square metre of ground already goes through reaches the
 * shoreline, the bed under the water, and any future body, for no draw call, no
 * triangle, no texture and no byte of VRAM.
 *
 * TWO COORDINATES, AND THE CHOICE OF THE FIRST IS THE WHOLE CORRECTNESS
 * ARGUMENT. Height above the water is taken from `vRelief`, the per-vertex
 * metres-above-datum attribute, and NOT from `length(pM) - levelRadius`. Both
 * are algebraically the same number. Only one of them is computable: `pM` is
 * float32 at about 6e5 m, so its quantum is 0.03125 m, and a difference of two
 * such radii resolves the 0.55 m fade band into about eighteen steps, which
 * draws contour bands parallel to the shoreline. `vRelief` is a few thousand at
 * most, so its quantum is a quarter of a millimetre and the same fade is
 * smooth. This is RN-45's lesson applied BEFORE the artefact rather than after.
 *
 * The lateral gate is allowed to use `pM`, because it is a smoothstep 5 m wide
 * and 0.05 m of jitter on a 5 m ramp is not visible. Knowing which of two
 * coordinates a term can afford is the skill; using the good one everywhere
 * would have cost a varying nobody needed.
 *
 * `band.w` is the amplitude, so `?wetsand=0` removes the term with no branch
 * left behind, and `?wetsandamp=` sweeps it.
 */
export const TERRAIN_ART_WET = /* glsl */`
  // RN-731: the wetness SCALAR, split out of ofArtWet unchanged to the
  // character so the albedo darkening and the specular roughness drop read the
  // identical number. Two call sites deriving "how wet is this fragment" from
  // the same inputs by separate arithmetic is the shape of bug where a pond
  // edge darkens in one term and glints in another half a metre away.
  float ofArtWetness(vec3 pM, float reliefM, vec3 dir, vec4 band) {
    if (band.w <= 0.0) return 0.0;
    // Perpendicular distance from the pond's axis. At pond scale on a 600 km
    // body this is the great-circle arc to four decimal places.
    float lat = length(pM - dir * dot(pM, dir));
    // Out to 1.55x the shoreline, which is past the basin rim, so the darkening
    // ends on ordinary ground rather than on the lip and cannot draw an edge
    // exactly where the bowl already has one.
    float inBasin = 1.0 - smoothstep(band.y, band.y * 1.55, lat);
    // Below the waterline is fully wet: that is the bed, and it is seen THROUGH
    // the water, where a bright dry-looking bottom is the single thing that most
    // makes a pond read as a blue sheet laid over a lawn.
    float wet = inBasin * (1.0 - smoothstep(-0.04, band.z, reliefM - band.x));
    return clamp(wet * band.w, 0.0, 1.0);
  }

  // The tint, as its own function so the constant has ONE home. The caller
  // that also needs the scalar takes ofArtWetness + this pair and pays for the
  // basin arithmetic once; ofArtWet below is the unchanged one-call form.
  //
  // Darker and slightly cooler: a water film is a specular layer over the same
  // pigment, so the diffuse it lets back out is reduced and blue-biased, and
  // the red end loses most because the film absorbs it hardest. The triple is
  // the same ordering as WATER_SIGMA and for the same physical reason.
  vec3 ofArtWetTint(vec3 albedo, float wet) {
    return albedo * mix(vec3(1.0), vec3(0.44, 0.49, 0.56), wet);
  }

  // Unchanged in behaviour and kept as the published entry point. With wet 0
  // the mix returns exactly vec3(1.0) and the multiply is bit-exact, so the
  // dry-ground frame is untouched by the split.
  vec3 ofArtWet(vec3 albedo, vec3 pM, float reliefM, vec3 dir, vec4 band) {
    return ofArtWetTint(albedo, ofArtWetness(pM, reliefM, dir, band));
  }
`;
