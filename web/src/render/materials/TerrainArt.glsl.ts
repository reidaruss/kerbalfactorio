// The terrain's SURFACE ART: a macro variation field, a derivative bump, and
// rock strata. GLSL text only, no uniforms declared here; TerrainShader.ts
// declares them and calls these three functions.
//
// The EIGHTH term, the near-field detail layer (RN-1730 to RN-1735), lives in
// TerrainFine.glsl.ts and is imported and re-exported here, so this file stays
// the one place to look for "what surface-art terms exist" while none of them
// has to live in a file that is already 2.3x over the line cap.
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

import { TERRAIN_ART_FINE, FINE_CHUNK_M, FINE_LUM_REF }
  from './TerrainFine.glsl.js';

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
 * rather than a derivation: thick enough that the near LOD's vertex spacing
 * samples it without aliasing, thin enough that a 12 m cut bank shows five beds
 * rather than two. That spacing was 1.8 m when the number was chosen and is
 * 0.899 m since WG-186, so the aliasing half of the argument has more margin
 * than it was given, not less.
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
  // RN-741. The body of ofArtBump, taking the height's screen derivatives as
  // ARGUMENTS rather than computing them, so a caller whose field is too rough
  // to differentiate at pixel scale can supply a band-limited pair instead.
  // Everything else, the footprint fade and the surface-gradient algebra, is
  // unchanged to the character and is shared by both entry points.
  vec3 ofArtBumpG(vec3 n, vec3 pos, float hx, float hy, float amp, float fineM) {
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
    vec3 grad = sign(det) * (hx * r1 + hy * r2);
    return normalize(abs(det) * n - amp * grad);
  }

  // The original entry point, behaviour unchanged: it differentiates the height
  // in screen space, which is correct for the vnoise octaves because they are
  // ANALYTIC and smooth at pixel scale. It is NOT correct for a sampled field
  // with authored crests; see ofArtRelGrad.
  vec3 ofArtBump(vec3 n, vec3 pos, float h, float amp, float fineM) {
    return ofArtBumpG(n, pos, dFdx(h), dFdy(h), amp, fineM);
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
 * The relief texture's finest authored wavelength in metres at the 16-repeat
 * consumer tile (RN-148), feeding ofArtBump's footprint fade for the relief
 * call. RN-78(d)'s lesson made quantitative: a derivative scales a field by
 * its own frequency, so the MIP CHAIN bounds the sampled VALUE but never its
 * gradient, and the throwaway test texture photographed exactly that as moire
 * arcs at range. The fade completing by a third of this wavelength is what
 * retires the term before its gradient can alias.
 */
export const RELIEF_FINE_M = 0.45;

/**
 * RN-741. The support the relief's slope is measured over, in TILE UNITS, where
 * one unit is one repeat of `of_ground_relief` at the 16-repeat consumer
 * coordinate.
 *
 * DERIVED, NOT PICKED. A depth-14 chunk is 57.856 m and carries 16 repeats, so
 * one repeat is 3.616 m and the finest authored wavelength RELIEF_FINE_M of
 * 0.45 m is 0.1244 of a repeat. The support is a QUARTER of that finest
 * wavelength, which is the widest offset that still resolves the feature it is
 * differencing (half a wavelength is where a central difference starts reading
 * the next crest instead of this one, named failure mode 2) and the narrowest
 * that spans meaningfully more than the ~2 cm crest whose discontinuity is the
 * defect.
 *
 *     0.45 / 3.616 * 0.25 = 0.0311
 *
 * In metres at depth 14 that is 0.112 m, so the slope is averaged over about a
 * hand's width of ground rather than over one pixel.
 *
 * The same LOD caveat the rest of this file carries applies and is bounded the
 * same way: the chunk UV's world size doubles at every LOD step, so this is a
 * growing world distance at coarser rings. It does not matter here because the
 * relief term fades out over 30 to 60 m and the streamer is at max depth inside
 * that, so no LOD step is reachable while the term is live.
 */
export const RELIEF_GRAD_UV = 0.0311;

/**
 * RN-961. The ripple direction cell, in TILE UNITS (one unit is one repeat of
 * `of_ground_relief`, which is 3.6 m). **1.0 is 3.6 m.**
 *
 * Chosen against two bounds rather than picked. TOO LARGE and the beach is
 * back to one direction over everything a player can see, since the relief
 * term is fully faded by 60 m. TOO SMALL and the seam density rises without
 * the direction field gaining anything, because the ANGLE's own scale is set
 * by REL_CELL_NOISE and not by the cell.
 *
 * 16 tile units is exactly one chunk UV, so an integer cell count per chunk
 * (16 at 1.0) keeps whole cells inside a chunk and no cell straddles a chunk
 * edge, where the UV derivative changes at an LOD step.
 *
 * RN-1005: this is the BOOT DEFAULT of the `uReliefCell` uniform rather than a
 * compile-time constant. The prose above was written when the value was 2.0
 * and still said "2.0 is 7.2 m" and "8 cells per chunk" after 92a4fb0 lowered
 * it to 1.0; a docstring whose arithmetic is a version behind is the same
 * defect class as a stale table, and it is corrected rather than deleted so
 * the reason for the bound survives.
 */
export const REL_CELL = 1.0;

/**
 * RN-961. Cells per period of the angle noise. 0.25 means the direction field
 * repeats every 4 cells, which at the shipped REL_CELL of 1.0 is 4 tile units
 * or **14.4 m**.
 *
 * RN-1005 corrects the arithmetic and it matters more than a typo would. The
 * prose said "8 tile units or 28.8 m", which was right when REL_CELL was 2.0
 * and became wrong in 92a4fb0. The two constants MULTIPLY, so neither can be
 * documented without the other, and the number that decides how many
 * directions are on screen at once is their PRODUCT and not either alone. At
 * 14.4 m a walking frame covering about 30 m of usable ground holds roughly
 * two correlation lengths, which is why RN-1001's walking pair still reads as
 * one direction: the swing was doing less work than the frame needed AND the
 * field it swings was correlated across most of the frame.
 *
 * RN-1005: this is now the BOOT DEFAULT of the `uReliefCellNoise` uniform.
 *
 * THE PER-CHUNK REPEAT IS REAL AND IS BOUNDED BY THE TERM'S OWN FADE. The cell
 * grid is built on `vChunkUv`, which resets at every chunk, so the whole
 * direction pattern repeats every 57.6 m. That would be a visible tiling if
 * the relief were visible at that range; it is not. The bump fades over 30 to
 * 60 m and is gone before one full period is on screen, so the repeat cannot
 * be observed at the only distance the term exists. Stated rather than hidden,
 * because if the fade is ever pushed out this becomes a defect the same day.
 *
 * RN-1005 RAISES THIS FROM 0.25 TO 0.5, and the UPPER bound turns out to be
 * structural rather than a matter of taste. `ofRelVnoise` is sampled at
 * `c * noise` for an INTEGER cell index c, so at noise = 1.0 the argument is
 * always an integer, `fract` is always 0, and the interpolation returns
 * `ofRelHash(c)` exactly. **At 1.0 the value noise degenerates into the
 * per-cell hash the whole construction exists to avoid**, and every seam
 * becomes a maximal jump. That is certain from the arithmetic, and the 1.0
 * frame confirms it by eye: the ripples stop being coherent and read as
 * mottle. So the field is 1/noise samples per period and noise must stay
 * comfortably below 1: 0.5 gives two samples per period (a hash value and the
 * midpoint of its two neighbours), which is the coarsest non-degenerate
 * setting and halves the correlation length from 14.4 m to 7.2 m.
 *
 * Why halve it at all: a walking frame at eye height covers about 30 m of
 * ground on which this term is visible, so at 14.4 m the whole visible patch
 * held about two independent directions and read as one. At 7.2 m it holds
 * about four, which is where the frame stops reading as a single corduroy.
 * That is the measurement in RN-1006 and it was settled by looking at
 * matched frames one uniform apart, not by this arithmetic.
 *
 * 16 cells per chunk divided by the 2-cell period is 8 whole periods, so the
 * angle field still closes on the chunk boundary exactly as it did at 0.25.
 */
export const REL_CELL_NOISE = 0.5;

/**
 * RN-961. The ripple direction's peak-to-peak swing across cells, in RADIANS.
 *
 * Bounded from both sides and neither bound is taste. TOO SMALL and the beach
 * still reads as one direction, which is Reid's complaint verbatim. TOO LARGE
 * and the SEAM is what grows: the rotation stays rigid at any swing (that is
 * the point of the construction), so wavelength is safe, but the discontinuity
 * where two cells meet scales with the angle DIFFERENCE between them, and past
 * some swing the blend can no longer hide it and the ground reads as tiles.
 *
 * So the failure mode this value guards is NOT the RN-955 mush; it is a
 * quilt. Different failure, different bound, and the instrument's side C is
 * blind to it (a quilt of rigid patches has a perfectly stable wavelength), so
 * this one is settled by looking.
 *
 * RN-1006 RAISES THIS FROM 1.05 TO PI, and pi is DERIVED rather than tuned.
 *
 * A ripple field is 180-degree periodic in appearance: rotating a set of
 * parallel crests by pi maps it onto itself. So the set of DISTINGUISHABLE
 * orientations has measure pi, and a peak-to-peak swing of pi is exactly the
 * amount that covers all of them. Every radian past pi re-covers directions
 * the field could already reach WHILE increasing the largest possible angle
 * difference between two neighbouring cells, which is precisely what a seam
 * costs. Pi is therefore the unique point of full orientation coverage at
 * minimum seam, and it is not a number anyone has to defend as taste.
 *
 * The picture agrees with the derivation, which is the part that matters:
 * 4.5 rad was photographed at close range and the crests visibly CURL (the
 * failure side D of `winaniso.py` exists to name), while pi does not, at
 * either the walking pose or a 0.35-to-5.5 m one. See RN-1006.
 *
 * WHY 1.05 WAS NOT ENOUGH, stated so the mistake is not repeated: +/- 30
 * degrees leaves every crest within 30 degrees of one mean direction, and a
 * frame full of lines within 30 degrees of each other IS a frame of lines
 * running one way. The value was settled on a diagnostic pose that covers
 * three metres of ground, where the question does not arise.
 */
export const REL_SWING_DEFAULT = Math.PI;

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
  // RN-1257. THE THREE-TAP BLEND. Split out of ofArtTexMix so the per-biome
  // FREQUENCY partition and the per-biome CHANNEL amplitude stay two separate
  // questions with two separate tables, which is the whole reorganisation:
  // MAT_W says how much, SCALE_W says at what size.
  //
  // OF_TEX_SCALE_GAIN carries the total gain the shipped two-tap blend had
  // (1 + 0.55), so a scale row of (0, 1/1.55, 0.55/1.55) reproduces it to the
  // last bit and ?biomescale=0 is an EXACT control rather than a near one.
  vec4 ofArtTexBlend(vec4 gF, vec4 gM, vec4 gC, vec3 sw) {
    return OF_TEX_SCALE_GAIN * (sw.x * (gF - vec4(0.5))
                              + sw.y * (gM - vec4(0.5))
                              + sw.z * (gC - vec4(0.5)));
  }

  // Unchanged in meaning; it now takes the BLENDED signed field rather than
  // two raw samples, so the published shape of the mix (rock grain on the
  // steep branch, the biome dot on cover, one shared coverSel gate) is
  // untouched by RN-1257 and only its input widened.
  float ofArtTexMix(vec4 g, vec4 matW, float coverSel) {
    return mix(g.g * 0.34, dot(g, matW), coverSel);
  }
`;

/**
 * THE RELIEF MIX (RN-148), the sixth term: RN-147's four packed ASYMMETRIC
 * height fields (R sand ripple, G clod, B scree step, A leaf litter) combined
 * into ONE height that feeds ofArtBump, exactly as the vnoise octaves do.
 *
 * WHY A SECOND TEXTURE AND NOT THE FIRST ONE'S CHANNELS: RN-78 measured that
 * the of_ground VALUE fields fed to the bump read as CHOPPY WATER at 2.4, at
 * 0.8, and coarse-only at 2.0, because a smooth metre-scale undulation is
 * liquid's signature whatever its height. The difference between water and
 * dirt is ASYMMETRY: sharp crests over rounded bases, flat facets with sharp
 * steps, skewed histograms. of_ground_relief's channels are AUTHORED
 * asymmetric and groundtex.py asserts the asymmetry per channel with symmetric
 * negative controls, so the named failure mode of this term (the RN-78 water
 * read) is excluded at the asset, not tuned around in the shader.
 *
 * The mix mirrors ofArtTexMix deliberately: relW is the per-biome channel
 * amplitude vector (BiomePalette's biomeReliefWeights), interpolated across
 * biome edges as vMatW is, and steep ground rides the SAME coverSel that
 * selects rock albedo, showing the scree-step channel where cover ends. One
 * gate, shared with the albedo, so grain and relief cannot disagree about
 * where a cliff starts.
 */
export const TERRAIN_ART_RELIEF = /* glsl */`
  float ofArtRelMix(vec4 r, vec4 relW, float coverSel) {
    vec4 h = r - vec4(0.5);
    return mix(h.b * 0.34, dot(h, relW), coverSel);
  }

  // RN-741. THE ETCHED SQUIGGLES, AND WHY THE AMPLITUDE COULD NEVER HAVE FIXED
  // THEM.
  //
  // The relief bump took dFdx/dFdy OF THE SAMPLED HEIGHT. A screen derivative
  // is a finite difference over one pixel, and this field is authored with
  // SHARP CRESTS: groundtex.py asserts per-channel asymmetry precisely because
  // RN-78's symmetric attempt photographed as choppy water. A sharp crest is a
  // SLOPE DISCONTINUITY, so its derivative jumps, so the normal flips hard
  // along every crest line and prints a hairline exactly there. Rendered, that
  // is a field of etched squiggles tracing the crest contours, which is what
  // Reid has been looking at.
  //
  // THE IRONY IS THE PART WORTH KEEPING: the asymmetry is authored ON PURPOSE
  // and is the whole reason this field is not the RN-78 water read, and that
  // same asymmetry is what breaks the derivative. So the fix must not touch the
  // field.
  //
  // AND IT IS WHY THE AMPLITUDE SWEEP NEVER HELPED. RELIEF_DEFAULT came down
  // 0.30 to 0.12 to 0.08 chasing this, and 0.30 to 0.08 SCALES a discontinuity;
  // it does not remove one. A term whose defect is structural does not have a
  // magnitude that makes it correct.
  //
  // THE FIX IS TO SMOOTH THE GRADIENT, NOT THE FIELD. The height keeps every
  // authored crest, so the asymmetry that earns this texture its place survives
  // untouched. What changes is the SUPPORT the slope is measured over: instead
  // of one pixel, a fixed offset in TILE units, which is a fixed world distance
  // inside the band where this term is live. Differencing over a support wider
  // than the crest spreads the slope change across that distance instead of
  // across one pixel, so the normal turns over the crest rather than snapping
  // at it.
  //
  // WHICH DERIVATIVE IS TAKEN WHERE IS THE WHOLE POINT, and both halves are
  // deliberate: the ROUGH field is differenced by explicit offsets, and the
  // SMOOTH mapping from tile UV to screen is still dFdx, because uv and
  // position are LINEAR across a triangle and their screen derivatives are
  // exact. Nothing rough is differentiated in screen space any more and nothing
  // smooth is sampled twice.
  //
  // COST: two extra fetches of a texture already bound and already sampled at
  // this exact coordinate, both inside the amplitude branch, whose condition is
  // a BARE UNIFORM and therefore uniform control flow with defined LOD (the
  // same argument the unconditional g1/g2 samples rest on, applied in the other
  // direction). At amplitude 0 they cost nothing at all.
  //
  // NAMED FAILURE MODES, BEFORE MEASURING:
  //   1. THE BUMP GOES LIMP. Averaging the slope over a wider support lowers it
  //      wherever the field is sharp, so the term gets weaker as well as
  //      smoother, and "the squiggles are gone" would then be indistinguishable
  //      from "the relief is gone". The pair therefore has to show the relief
  //      still present, not merely the artefact absent.
  //   2. THE OFFSET BECOMES A SECOND FREQUENCY. Too wide and the difference
  //      starts sampling the NEXT crest rather than this one, which reads as a
  //      lower-frequency ripple that no channel authored.
  //   3. IT IS A FORWARD DIFFERENCE, so the gradient is biased half an offset
  //      along +u and +v. That is acceptable ONLY because nothing else keys on
  //      this field: the albedo uses of_ground, not of_ground_relief, so there
  //      is no second term for the relief to slide against.
  float ofArtRelGradStep() { return OF_RELIEF_GRAD_UV; }

  // RN-961. SHEAR-FREE DIRECTIONAL VARIATION FOR THE RIPPLE FIELD.
  //
  // RN-955 rotated the sample coordinate by a CONTINUOUS angle field and got
  // fingerprints. The diagnosis was that rotating about the UV origin is not a
  // rotation of the pattern, and the sharper statement is this: the shear came
  // from theta VARYING, not from where the rotation was centred. A map
  // p -> R(theta(p)) * p has Jacobian R + (dR/dtheta)(grad theta)p^T, and that
  // second term is the whole disease. It scales with |p|, which at
  // vChunkUv * 16.0 reaches 16 tile units, so the local wavelength collapsed
  // from 41.3 px to 5.2 px (RN-958 measured it).
  //
  // HOLD THETA CONSTANT INSIDE A CELL AND THE SECOND TERM IS IDENTICALLY ZERO.
  // The map becomes p -> R*(p - a) + a with R and a both constant: a rotation
  // about a point, which is a rigid motion. Not a bounded shear, not a small
  // shear. An isometry, exactly, so the ripple's wavelength is preserved to the
  // last bit and side C of the instrument cannot fire on it by construction.
  //
  // WHAT IT COSTS INSTEAD IS A SEAM, and that is the honest trade: the pattern
  // is discontinuous where two cells meet. Two things pay it down.
  //
  //   THE ANGLE IS A VALUE NOISE ON THE CELL INDEX, not a per-cell hash. A
  //   hash makes neighbouring cells independent and every seam a maximal jump.
  //   Sampling a smooth noise AT the integer cell index keeps theta constant
  //   inside the cell (so the isometry holds) while making adjacent cells
  //   nearly agree (so the jump is small). Those two requirements sound
  //   opposed and are not: constant WITHIN, continuous BETWEEN.
  //
  //   TWO OFFSET GRIDS, blended by centrality. Where one grid is at a seam the
  //   other is at a cell centre, so the weights are complementary by
  //   construction and no point is served only by a discontinuity.
  //
  // NO TEXTURE FETCH. The angle is ALU. RN-955 took its angle from g2, which
  // was free only because g2 was already in hand for the albedo; here the
  // angle must be evaluated at the CELL INDEX rather than at the fragment, and
  // a dependent fetch at a computed coordinate is neither free nor cheap.
  float ofRelHash(vec2 c) {
    return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
  }
  float ofRelVnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(ofRelHash(i), ofRelHash(i + vec2(1.0, 0.0)), f.x),
               mix(ofRelHash(i + vec2(0.0, 1.0)), ofRelHash(i + vec2(1.0, 1.0)), f.x),
               f.y);
  }
  // xy is the rotated sample coordinate, z is this grid's blend weight.
  // The off argument selects the grid: vec2(0.0) and vec2(0.5) are the two used.
  // RN-1005. The noise argument was OF_REL_CELL_NOISE and the cell argument
  // came from OF_REL_CELL.
  // Both are arguments now, for RN-843's reason exactly: they were compile-time
  // constants because they were believed settled, and the walking-distance
  // frame says the direction field's SCALE is a live question. A define cannot
  // be swept inside one page, one camera and one streamed chunk set, and two
  // page loads is what made the first swing value look sufficient.
  vec3 ofRelCell(vec2 p, float cell, float noise, float swing, vec2 off) {
    vec2 q = p / cell + off;
    vec2 c = floor(q);
    float t = (ofRelVnoise(c * noise) - 0.5) * swing;
    float cs = cos(t);
    float sn = sin(t);
    vec2 a = (c + 0.5 - off) * cell;      // the cell centre, in tile units
    vec2 d = p - a;
    vec2 f = fract(q) - 0.5;
    // Centrality, Chebyshev so the falloff matches the square cell it belongs
    // to. 1 at the centre, 0 at the edge, and the two grids are half a cell
    // apart so wA + wB is never 0.
    float w = 1.0 - smoothstep(0.24, 0.5, max(abs(f.x), abs(f.y)));
    return vec3(a + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y), w);
  }

`;


/**
 * THE SPECULAR LOBE (RN-731), the seventh term, and the one that reaches every
 * frame rather than a band of ground.
 *
 * WHAT WAS ACTUALLY WRONG. Until this landed the terrain's entire lighting was
 *
 *     lit = albedo * irradiance
 *
 * i.e. pure Lambert with NO specular lobe of any kind and no roughness input at
 * all. Ground that cannot glint is a large part of why the world reads as
 * paper, and it is not a tuning problem: there was no term to tune. Wet sand,
 * wet rock inside the pond basin, mineral sparkle in scree and a sun raking
 * along a slope were all unreachable by construction.
 *
 * WHY THE ROUGHNESS NEEDS NO MAP, NO UNIFORM AND NO VARYING, which is what
 * makes this cheap enough to argue for. Every signal it needs has ALREADY been
 * computed by the fragment that calls it:
 *
 *   `matW`     the per-biome material weights (BiomePalette's MAT_W), whose
 *              channels are literally x grass clump, y rock grain, z granular,
 *              w clod. That is a material identity, interpolated across biome
 *              edges by the same vertex path the albedo uses, and it is free.
 *   `coverSel` the slope smoothstep that already decides rock against cover.
 *              ONE gate shared with the albedo, the grain and the relief, so
 *              roughness cannot disagree with them about where a cliff starts.
 *   `snow`     already computed for the albedo lerp.
 *   `wet`      RN-57's wet band, which until now only DARKENED the albedo. A
 *              water film is physically a smooth dielectric layer over the same
 *              pigment; the darkening was half of that and this is the other
 *              half. `ofArtWetness` is split out of `ofArtWet` so both halves
 *              read the identical scalar and cannot drift apart.
 *
 * THE WEIGHTS ARE NOT A PARTITION (BiomePalette says so: they are amplitudes
 * summing near 0.3), so they are normalised here rather than assumed. A biome
 * whose weights are all zero would divide by zero, so the sum is floored and
 * the fallback is the cover roughness rather than an accidental mirror.
 *
 * THE FLOOR IS SECTION 2.1's 0.15 AND IT IS LOAD-BEARING, not a safety rail: a
 * GGX denominator at roughness 0 is a delta function, and one texel of it under
 * a moving sun is a firefly that no amount of temporal smoothing removes.
 *
 * NAMED FAILURE MODES, BEFORE ANY MEASUREMENT (INSTRUMENTS.md):
 *   1. THE WHOLE GROUND GOES SATIN. If the roughness band lands too low the
 *      term stops being a highlight and becomes a uniform sheen, which reads as
 *      wet plastic and is worse than Lambert. The band is therefore authored
 *      HIGH (0.62 to 0.97 dry) and only the wet film and snow reach under it.
 *   2. IT ONLY SHOWS AT NOON, i.e. it is measured at one sun elevation and is
 *      invisible at the one that matters. A specular is a GRAZING phenomenon,
 *      so the calibration frame is a low sun, exactly as RELIEF_DEFAULT was
 *      calibrated at grazing rather than at noon.
 *   3. IT MOVES SECTION 2.1's REFERENCE LUMINANCES. It adds energy, so the four
 *      site luminances must be re-taken and any move over a few counts owed an
 *      explanation. That is what the amplitude uniform and `?terrainspec=0`
 *      exist for: the control is one flag on one build.
 *
 * COMPILED OUT OF THE SCALED SCENE. At 1e5 metres per unit the whole near
 * world is under a pixel, so the term would cost arithmetic to modulate
 * nothing. That is RN-45's confinement by the call graph and it is free.
 */
export const TERRAIN_ART_SPEC = /* glsl */`
  // RN-1257. THE ROUGHNESS IS AUTHORED PER BIOME AND VARIES PER PIXEL.
  //
  // What this replaces, and why replacing it was not a preference: the old
  // body derived roughness as dot(normalise(matW), (0.95, 0.72, 0.86, 0.97)),
  // a weighted average of four constants spanning 0.25 taken over weight
  // vectors that were themselves clustered. Evaluated over the shipped table
  // it produced a band 0.131 wide across EVERY BIOME IN THE GAME and 0.027
  // wide across the five rock and airless ones (the numbers are in
  // BiomePalette's ROUGH_W note). Section 2.1 item 4 requires 0.15 of a mesh
  // family; the terrain is more screen area than every mesh family combined
  // and it was under half of that.
  //
  // AND IT WAS CONSTANT WITHIN A BIOME, which is the half that no widening of
  // the old expression could have fixed. A specular lobe over a constant
  // roughness produces one highlight shape across a whole hillside; what makes
  // scree read as scree is that SOME facets catch the sun and most do not. So
  // the second term here is per-pixel and rides the biome's own grain field,
  // which the caller has already computed for the albedo and passes in free.
  //
  // ROUGH_W.x is the base and ROUGH_W.y is var, which and is the PEAK swing in roughness
  // units: the grain is clamped to [-1, 1] before it is scaled, so a hot texel
  // cannot drive roughness to the floor. That clamp is load-bearing rather than
  // defensive: named failure mode of the specular is a firefly at low
  // roughness under a moving sun, and an unclamped multiply of a field with a
  // sparse hard-edged pebble population (RN-1256) is exactly how one arrives.
  //
  // The grain ARRIVES NORMALISED by the biome's own MAT_W sum, so it is a pure
  // shape in about [-0.25, 0.25] whatever the biome's texture amplitude is.
  // That division is the caller's and it is load-bearing: MAT_W's sums are
  // luminance-compensated and span 0.17 to 0.99, so without it this table
  // would be reading the albedo table's amplitude by the back door.
  // OF_ROUGH_GRAIN (3.2) then puts the ordinary range just inside saturation
  // and leaves the pebbles to clip.
  //
  // The rock, snow and wet mixes below are UNCHANGED to the character. Only
  // the number they start from moved.
  float ofArtRough(float base, float var, float grain,
                   float coverSel, float snow, float wet) {
    float r = base + var * clamp(grain * OF_ROUGH_GRAIN, -1.0, 1.0);
    // Steep ground is bare rock: smoother than the cover that would otherwise
    // sit on it, because what makes a cliff a cliff is that nothing soft stays
    // on it. Same gate as the albedo, so the two cannot disagree.
    r = mix(0.62, r, coverSel);
    // Snow is smoother than dirt and nowhere near a mirror.
    r = mix(r, 0.50, snow);
    // The water film. This is the term the wet band always implied and never
    // had, and it is the largest single move in the function.
    r = mix(r, 0.10, wet);
    return clamp(r, 0.15, 1.0);
  }

  // GGX/Trowbridge-Reitz with a Smith-Schlick height-correlated visibility and
  // a Schlick Fresnel at the dielectric F0 every natural ground surface has.
  // Returns the specular WEIGHT for the sun; the caller multiplies it by the
  // same sun radiance, transmittance and shadow the diffuse term uses, so the
  // highlight extinguishes in the terminator and under a cascade for free
  // rather than by a second set of rules.
  float ofArtSpec(vec3 n, vec3 v, vec3 l, float rough) {
    vec3 hv = normalize(l + v);
    float NoH = max(dot(n, hv), 0.0);
    float NoV = max(dot(n, v), 1e-4);
    float NoL = max(dot(n, l), 0.0);
    float VoH = max(dot(v, hv), 0.0);
    float a = rough * rough;
    float a2 = a * a;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    float D = a2 / max(PI * d * d, 1e-8);
    float Vs = 0.5 / max(mix(2.0 * NoL * NoV, NoL + NoV, a), 1e-5);
    float F = 0.04 + 0.96 * pow(1.0 - VoH, 5.0);
    return D * Vs * F * NoL;
  }

  // The SKY half, and it is what stops wet ground from being dead whenever the
  // sun is not in the mirror direction. A smooth surface seen at a grazing
  // VIEW angle returns the sky rather than its own pigment; that is the sheen
  // on a wet road looking away from the sun, and the sky radiance it needs is
  // already computed one line above the call site for the diffuse ambient.
  //
  // THE ROUGHNESS WEIGHT IS SQUARED, and that is a correction rather than a
  // preference. Schlick's Fresnel goes to 1 at grazing, and a walking camera
  // sees ground at about 8 degrees of grazing by 12 m, so nearly ALL the
  // ground in an ordinary frame is at high F. With a linear (1 - rough) weight
  // dry ground at roughness 0.86 would still return 14 per cent of the sky,
  // and section 2.1 measures masked sky at p50 191 against masked ground at 33
  // to 55: 14 per cent of the sky is a quarter of the ground's own value,
  // applied to the whole middle distance. That is named failure mode 1 (the
  // whole ground goes satin) arriving through the ambient rather than through
  // the sun. Squared, dry ground returns 2.0 per cent and wet ground 81 per
  // cent, which is the shape the term is actually claiming: this is a WET
  // effect that dry ground is merely not exempt from.
  vec3 ofArtSkySpec(vec3 skyAmb, float NoV, float rough) {
    float F = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    float g = 1.0 - rough;
    return skyAmb * F * g * g;
  }
`;

/**
 * RN-1257. The total gain the shipped two-tap ground-texture blend carried
 * (1.0 on the 16-repeat tap plus 0.55 on the 5-repeat one). It is a CONSTANT
 * here, not a tuning knob, and its whole job is to let `SCALE_W`'s rows sum to
 * 1: with it, a row of (0, 1/1.55, 0.55/1.55) reproduces the pre-RN-1257 blend
 * exactly, which is what makes `?biomescale=0` an exact negative control and
 * not an approximate one. Change this and every biome's texture amplitude
 * moves, which is `MAT_W`'s job and not this constant's.
 */
export const TEX_SCALE_GAIN = 1.55;

/**
 * RN-1257. Maps the NORMALISED grain field onto the [-1, 1] that the per-biome
 * roughness variation saturates over.
 *
 * The caller divides the biome-dotted grain by that biome's own MAT_W sum
 * before it arrives here, so what this scales is a pure shape running about
 * +/-0.25 for every biome in the game rather than a number six times larger on
 * Forest than on Polar. 3.2 therefore puts ordinary ground just inside
 * saturation and leaves RN-1256's sparse pebbles to clip, which is what keeps
 * a hot texel from driving roughness to the floor and firing a firefly under a
 * moving sun.
 */
export const ROUGH_GRAIN = 3.2;

/**
 * RN-1257. The FINE ground-texture tap, in repeats per quad. INTEGER, for
 * RN-78's seam argument (a shared chunk edge must meet at fract == 0), and 47
 * rather than 48 so the fine lattice shares no cell boundary with the
 * 16-repeat one. At a depth-14 chunk of 57.856 m this is a 1.231 m tile and a
 * 1.2 mm texel, which is what finally puts RN-1256's authored hard edges under
 * a ground pixel instead of inside a mip average.
 */
export const TEX_FINE_REPEATS = 47.0;

// RN-1733. The near-field detail layer lives in TerrainFine.glsl.ts (2.2 rule
// 1; this file was already 2.3x over the 400-line cap before it existed).
// Everything it exports is RE-EXPORTED here so every import site that reaches
// for a terrain-art constant keeps working and there is still one place to
// look for "what surface-art terms exist".
export { TERRAIN_ART_FINE, FINE_A, FINE_R, FINE_B, FINE_W, FINE_CHUNK_M,
  FINE_M, FINE_BUMP, FINE_ALB, FINE_LUM_REF } from './TerrainFine.glsl.js';

export const TERRAIN_ART_PARS = `#define OF_ART_FINE_M ${ART_FINE_M.toFixed(1)}\n`
  + `#define OF_FINE_CHUNK_M ${FINE_CHUNK_M.toFixed(2)}\n`
  + `#define OF_FINE_LUM_REF ${FINE_LUM_REF.toFixed(5)}\n`
  + `#define OF_RELIEF_FINE_M ${RELIEF_FINE_M.toFixed(2)}\n`
  + `#define OF_RELIEF_GRAD_UV ${RELIEF_GRAD_UV.toFixed(4)}\n`
  + `#define OF_TEX_SCALE_GAIN ${TEX_SCALE_GAIN.toFixed(2)}\n`
  + `#define OF_TEX_FINE ${TEX_FINE_REPEATS.toFixed(1)}\n`
  + `#define OF_ROUGH_GRAIN ${ROUGH_GRAIN.toFixed(1)}\n`
  // RN-1005. OF_REL_CELL and OF_REL_CELL_NOISE are GONE rather than left
  // behind: they are uniforms now (uReliefCell, uReliefCellNoise), and a dead
  // define that still compiles is exactly how a lane ends up sweeping one
  // authority while the shader reads the other. REL_CELL and REL_CELL_NOISE
  // remain the boot defaults, in TypeScript, with one home each.
  + TERRAIN_ART_NOISE + TERRAIN_ART_MACRO + TERRAIN_ART_STRATA + TERRAIN_ART_BUMP
  + TERRAIN_ART_WET + TERRAIN_ART_TEX + TERRAIN_ART_RELIEF + TERRAIN_ART_FINE
  + TERRAIN_ART_SPEC;
