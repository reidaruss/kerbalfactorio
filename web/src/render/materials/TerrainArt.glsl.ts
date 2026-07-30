// The terrain's SURFACE ART: a macro variation field, a derivative bump, and
// rock strata. GLSL text only, no uniforms declared here; TerrainShader.ts
// declares them and calls these three functions.
//
// Split out of TerrainShader.ts at the 400-line cap (2.2 rule 1), and worth
// reading on its own because all three answer the same complaint: the ground is
// FLAT COLOUR. Every fragment of one biome on one slope is currently the exact
// same RGB, and a hillside made of one RGB reads as a painted backdrop at every
// distance, which is the largest per-pixel gap between this and the reference.
//
// ---------------------------------------------------------------------------
// WHY THIS IS IN THE TERRAIN AND NOT IN NEW ROCK MESHES
// ---------------------------------------------------------------------------
// The brief ranked "rocks and cliffs, ours are smooth low-poly blobs" above
// this. It was reordered, and this is the reason, stated so it can be argued
// with: IN THIS ENGINE A CLIFF IS TERRAIN, NOT A PROP. The rock props are
// boulders, they are metre-scale, and the scatter ring is 170 m. Every actual
// cliff, cut bank, ravine wall, crater rim and mountain flank in the world is
// drawn by THIS material, through the one `rock` constant on the steep branch,
// which was `vec3(0.30, 0.28, 0.26)` and nothing else. So "layered strata and
// real silhouettes on cliffs" is a shader item that reaches every cliff face on
// the planet, and the mesh item reaches a few hundred boulders. The mesh item
// is still real and is specified as an art request; it is second.
//
// ---------------------------------------------------------------------------
// PRECISION, WHICH IS THE ONE HARD CONSTRAINT HERE
// ---------------------------------------------------------------------------
// The noise phase is PLANET-CENTRED METRES (`pM`), not engine space, and that
// is not a style choice. Engine space rebases under the floating origin, so a
// field keyed on `vWorld` would SWIM across the ground every time the origin
// moved. `pM` is stable by construction because both terms of `vWorld -
// uBodyCenter` move together.
//
// The cost of that choice is precision, and it sets a hard floor on the finest
// octave. `pM` is float32 and is about 600e3 on Forge's surface, i.e. 2^19.2,
// so one ULP is 2^(19-23) = 0.0625 m. A 4.2 m octave therefore quantises to
// about 1.5% of its own wavelength, which is invisible; a 0.5 m octave would
// quantise to 12.5% and would render as visible stair-stepping. SUB-METRE
// DETAIL IS NOT REACHABLE FROM pM AND IS NOT ATTEMPTED HERE. Reaching it needs
// a per-chunk phase attribute reduced mod the octave period on the CPU in
// float64, where it is exact, which is a terrain-chunk format change and
// therefore world-gen's to make. That is flagged up rather than faked.
//
// ---------------------------------------------------------------------------
// TWO INDEPENDENT CONFINEMENTS, ON PURPOSE
// ---------------------------------------------------------------------------
// (1) A COMPILE-TIME gate. The whole block is `#ifndef OF_SCALED`, so the far
//     scaled scene, where one unit is 1e5 m and a 12 m octave is far below one
//     pixel, cannot reach this code at all. A viewer in orbit gets the same
//     planet it got before. This is confinement by the call graph, which RN-30
//     established is the only kind that holds.
// (2) A DISTANCE fade, which is what actually prevents a SEAM. The near scene
//     hands terrain to the far scene at about 15 km (`nearDepthCutoff`), so if
//     the fade did not complete well before that, the same ridge would be
//     modulated on one side of the handover and flat on the other. It completes
//     at 4 km, which is a factor of 3.75 of margin, and by 4 km the aerial
//     perspective term is already at an optical depth of 1.8 and dominates.
//
// Neither is a substitute for the other: the define stops orbital aliasing, the
// fade stops the handover seam.

/**
 * Hash and value noise. Dave Hoskins' hash13, which is float-only (no integer
 * ops, no texture) and is stable across the drivers this project targets.
 *
 * Value rather than gradient noise deliberately: gradient noise costs a dot
 * product per corner for a smoothness nothing here needs, and value noise with
 * a smoothstep fade is C1, which is the only property the derivative bump below
 * actually requires of it.
 */
export const TERRAIN_ART_NOISE = /* glsl */`
  float ofArtHash(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  float ofArtVnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = ofArtHash(i + vec3(0.0, 0.0, 0.0));
    float n100 = ofArtHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = ofArtHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = ofArtHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = ofArtHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = ofArtHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = ofArtHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = ofArtHash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
`;

/**
 * THE MACRO FIELD. Three octaves, returned centred on zero in about [-1, 1].
 *
 * The wavelengths are 186 m, 47.5 m and 11.9 m, and they are chosen for what
 * they do at PLAYER RANGE rather than as a tidy series:
 *
 *   186 m  is the scale of "this hillside is drier than that one". It is what
 *          stops a 300 m sweep of ground being one colour, and it is the octave
 *          the eye reads in a wide shot.
 *   47.5 m is patchiness inside one hillside, roughly the scale of the
 *          understorey ring itself, so the ground varies over the same
 *          distance the foliage density does.
 *   11.9 m is the near-field break-up: at a walking pace this is the octave
 *          that keeps the ground under the player from being a flat plate.
 *
 * The ratio is about 3.94 rather than exactly 4 so that the three lattices
 * never share a cell boundary, which is what produces the faint grid a
 * power-of-two octave stack shows on flat ground.
 *
 * `ofArtMacroAt` takes the fade weight and RETURNS EARLY at zero. The weight is
 * a pure function of view distance, so the branch is coherent across large runs
 * of the screen and costs nothing where it is taken.
 */
export const TERRAIN_ART_MACRO = /* glsl */`
  float ofArtMacro(vec3 pM) {
    float a = ofArtVnoise(pM * (1.0 / 186.0));
    float b = ofArtVnoise(pM * (1.0 / 47.5) + 19.7);
    float c = ofArtVnoise(pM * (1.0 / 11.9) + 53.1);
    // 0.42 / 0.36 / 0.22 rather than the 0.55 / 0.30 / 0.15 this shipped with.
    // MEASURED: with the first weights the mid band (ground 30 to 80 m away)
    // gained only 0.906 counts of block-mean spread while 99.99% of its pixels
    // moved, i.e. the term was applying a nearly UNIFORM shift out there rather
    // than a varied one, because a 186 m octave is close to constant across a
    // band that deep. Weight moved from the octave the eye reads as one flat
    // wash onto the two it reads as patchiness.
    return (a * 0.42 + b * 0.36 + c * 0.22) * 2.0 - 1.0;
  }
`;

/**
 * ROCK STRATA, which is the cliff half of the brief's first item.
 *
 * A cliff in the reference reads as rock because it is BEDDED: horizontal
 * layers of slightly different colour and hardness, with a darker parting at
 * each contact. That is a property of altitude, and altitude is already a
 * varying here (`vRelief`, metres above the datum, per vertex), so the entire
 * effect is a handful of ALU on a value this shader already had.
 *
 * Three things make it read as rock rather than as stripes.
 *
 *  1. THE BEDS ARE WARPED, not level. A low-frequency noise offsets the bed
 *     index by up to +/- 4.5 m before it is quantised, so beds tilt and thicken
 *     across a face the way real ones do. Perfectly level bands look like a
 *     contour map, which is the failure mode this avoids.
 *  2. EACH BED GETS ITS OWN TONE, from a hash of its integer index, so the
 *     sequence does not repeat every band. The spread is deliberately wide
 *     (0.78 to 1.24 of base value) because a cliff's whole job is contrast.
 *  3. A DARK PARTING at each contact. Real bedding planes are recessed and
 *     collect shadow and debris, and that thin dark line is most of what says
 *     "layered" at 100 m where the tonal difference has already washed out.
 *
 * The bed thickness is 2.35 m. It is the one number here that is a judgement
 * rather than a derivation: thick enough that the near LOD's 1.8 m vertex
 * spacing samples it without aliasing, thin enough that a 12 m cut bank shows
 * five beds rather than two.
 *
 * SELF-CONFINING: this only ever multiplies the `rock` term, and `rock` is
 * mixed in by the slope smoothstep, so flat ground receives exactly nothing and
 * needs no separate guard. A bug here can only ever appear on steep ground.
 */
export const TERRAIN_ART_STRATA = /* glsl */`
  vec3 ofArtStrata(vec3 rock, float altM, vec3 pM, float amp) {
    if (amp <= 0.0) return rock;
    float warp = (ofArtVnoise(pM * (1.0 / 62.0)) - 0.5) * 9.0;
    float band = (altM + warp) * (1.0 / 2.35);
    float bi = floor(band);
    float f = band - bi;
    float tone = ofArtHash(vec3(bi, 3.7, 11.3));
    float iron = ofArtHash(vec3(bi, 19.1, 7.3));
    // Per-bed value, then a per-bed hue lean between an iron-stained warm bed
    // and a cold grey one. Both are multiplies on the base rock colour, so the
    // palette still owns the rock's identity and this only modulates it.
    vec3 tint = mix(vec3(0.93, 0.97, 1.05), vec3(1.14, 1.00, 0.86), iron);
    vec3 bed = rock * (0.78 + 0.46 * tone) * mix(vec3(1.0), tint, 0.75);
    // The parting: a thin recess at each contact, at BOTH ends of the cell so a
    // bed is dark on its floor and its ceiling.
    float part = min(smoothstep(0.0, 0.085, f), smoothstep(1.0, 0.915, f));
    bed *= mix(0.62, 1.0, part);
    return mix(rock, bed, amp);
  }
`;

/**
 * THE DERIVATIVE BUMP, and the reason there is no normal map anywhere in it.
 *
 * The terrain carries no tangents and its UVs are the box projection the
 * validator checks on props, not a surface parameterisation, so a conventional
 * tangent-space normal map has nothing to sit in. Mikkelsen's surface-gradient
 * formulation needs none of that: given a scalar height field and the screen
 * derivatives of the world position, it recovers the perturbed normal directly.
 * We already have to evaluate the height field for the macro colour, so the
 * bump costs two `dFdx` pairs and a couple of cross products ON TOP OF WORK
 * THAT WAS ALREADY DONE. There is no second sample of the noise anywhere.
 *
 * `pos` MUST be the engine-space world position and not `pM`. A derivative is a
 * difference of two nearby values, and differencing two float32 numbers of
 * magnitude 6e5 leaves about four bits of signal. Engine space is small near
 * the player by construction (that is what the floating origin is for), so its
 * derivatives are clean. The HEIGHT field is still keyed on `pM`; only the
 * geometric derivative is taken in engine space, and that is correct because
 * the two frames differ by a translation, whose derivative is the identity.
 *
 * THE FADE IS ON THE PIXEL FOOTPRINT, NOT ON DISTANCE, and that is a fix at the
 * root rather than a tuning. The first version faded the bump from 40 m to
 * 250 m of range, which is the obvious thing and is wrong, because it is not
 * range that aliases a bump: it is the world-space size of a pixel. At the
 * pinned camera the ground under the player is seen about two degrees off
 * edge-on, so a pixel five metres away covers HALF A METRE of ground along the
 * view direction while sitting comfortably inside the 40 m full-strength band.
 * The result was a field of concentric moire arcs across the near ground, and
 * no number in the probe saw it: the term moved 35% of the near band with a
 * healthy peak either way. A screenshot caught it, which is DW-7's rule and
 * RN-15's again.
 *
 * `dFdx(pos)` IS the footprint, in metres, and it was already being computed
 * one line below for the surface gradient, so the correct fade costs a length
 * and a smoothstep. Nyquist says a feature is representable while the sample
 * spacing is under half its wavelength; the fade therefore runs from an eighth
 * of the finest octave to a third of it, i.e. it is fully out well before the
 * point at which the signal could fold. `OF_ART_FINE_M` is that wavelength and
 * is passed in rather than duplicated, because a fade keyed on a stale copy of
 * the frequency it protects is a negative control made of a constant copied
 * from the thing it watches, which standing rule 11 already has a scar from.
 *
 * This also subsumes the distance guard it replaces: a terrain triangle a few
 * pixels wide at 200 m has a large footprint by construction, so it is faded
 * for the same reason and by the same term.
 */
export const TERRAIN_ART_BUMP = /* glsl */`
  vec3 ofArtBump(vec3 n, vec3 pos, float h, float amp, float fineM) {
    if (amp <= 0.0) return n;
    vec3 sx = dFdx(pos);
    vec3 sy = dFdy(pos);
    float footM = max(length(sx), length(sy));
    amp *= 1.0 - smoothstep(fineM * 0.125, fineM * 0.333, footM);
    if (amp <= 0.0) return n;
    vec3 r1 = cross(sy, n);
    vec3 r2 = cross(n, sx);
    float det = dot(sx, r1);
    if (abs(det) < 1.0e-12) return n;
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    return normalize(abs(det) * n - amp * grad);
  }
`;

/**
 * The finest octave the bump adds, in metres. ONE definition, consumed both by
 * the shader that samples at that wavelength and by the fade that protects it.
 *
 * 4.2 m is the float32 precision floor on planet-centred metres at Forge's
 * radius, not a look choice: see this file's header.
 */
export const ART_FINE_M = 4.2;

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
  vec3 ofArtWet(vec3 albedo, vec3 pM, float reliefM, vec3 dir, vec4 band) {
    if (band.w <= 0.0) return albedo;
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
    wet = clamp(wet * band.w, 0.0, 1.0);
    // Darker and slightly cooler: a water film is a specular layer over the same
    // pigment, so the diffuse it lets back out is reduced and blue-biased, and
    // the red end loses most because the film absorbs it hardest. The triple is
    // the same ordering as WATER_SIGMA and for the same physical reason.
    return albedo * mix(vec3(1.0), vec3(0.44, 0.49, 0.56), wet);
  }
`;

/**
 * THE GROUND TEXTURE MIX (RN-78), the fifth term: RN-77's four packed tiling
 * detail fields (R grass clump, G rock grain, B granular, A clod) combined
 * into ONE signed albedo modulation.
 *
 * THE COORDINATE DECISION, stated because the brief asked for it explicitly.
 * The texture is sampled on `vChunkUv`, RN-50's per-quad chunk UV, and NOT on
 * planet-centred metres, and at the near ring the UV can carry texture
 * lookups outright. Three facts make that true and each was the failure mode
 * of the alternative:
 *
 *  1. PRECISION. pM's float32 quantum at Forge's surface is 0.03125 m against
 *     this texture's 3.5 mm texel, so a pM-keyed lookup would quantise to ~9
 *     texels: stair-blocks wider than the near-field pixel footprint, plus a
 *     dead uv derivative that breaks hardware mip selection (RN-45's arcs,
 *     reached through the sampler instead of dFdx). The chunk UV's step is
 *     0.883 mm on a depth-14 chunk, a quarter of a ground pixel at 2 m.
 *  2. SEAMS. The repeat counts are INTEGERS per quad (16 and 5), so at a
 *     shared edge between same-depth chunks one chunk's fract(k*1.0) meets
 *     the other's fract(k*0.0) and the phase is continuous by arithmetic.
 *     Non-integer frequencies (the bump's 14.0/5.3 octaves get away with it
 *     on sub-metre lighting detail) would put a visible albedo step on every
 *     chunk edge.
 *  3. LOD. The UV normalises over the quad, so the texture's world size
 *     doubles at every LOD step; that is RN-50's honest cost unchanged. It is
 *     tolerable here for the same reason it was there, plus one better: the
 *     term fades over 45 to 90 m, inside which the streamer is at max depth,
 *     AND every channel is authored centred on 0.5, so a minified sample
 *     converges to the modulation identity on its own before either gate acts.
 *
 * THE MIX. `matW` is the per-biome channel amplitude vector (BiomePalette's
 * biomeMatWeights): weights, not a partition, so a biome states how much of
 * each material character it shows and the sum IS its texture amplitude. The
 * rock-grain branch rides `coverSel`, the same slope smoothstep that selects
 * rock albedo, so scree and cliff faces grain up exactly where they stop
 * being cover, with no second gate to disagree with the first. The 0.55 on
 * the second scale keeps the 11.6 m repeat subordinate to the 3.6 m one; the
 * 0.62 on the rock branch is the one number tuned by looking, and it is
 * higher-contrast than any biome's cover because a rock face is all edges.
 */
export const TERRAIN_ART_TEX = /* glsl */`
  float ofArtTexMix(vec4 g1, vec4 g2, vec4 matW, float coverSel) {
    vec4 g = (g1 - vec4(0.5)) + 0.55 * (g2 - vec4(0.5));
    return mix(g.g * 0.34, dot(g, matW), coverSel);
  }
`;

export const TERRAIN_ART_PARS = `#define OF_ART_FINE_M ${ART_FINE_M.toFixed(1)}\n`
  + TERRAIN_ART_NOISE + TERRAIN_ART_MACRO + TERRAIN_ART_STRATA + TERRAIN_ART_BUMP
  + TERRAIN_ART_WET + TERRAIN_ART_TEX;
