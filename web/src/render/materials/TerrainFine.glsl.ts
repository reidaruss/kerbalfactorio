// THE NEAR-FIELD DETAIL LAYER (RN-1730 to RN-1735): the terrain's eighth
// surface-art term, and the one that answers the look audit's R1 item.
//
// Split out of TerrainArt.glsl.ts on the CascadeShadow / TerrainVertex /
// TerrainDither precedent, purely for the 400-line cap (2.2 rule 1). That file
// was already 923 lines and 2.3x over the cap before this term existed, and
// adding 350 more to the worst offender in the repo is not a thing to do
// quietly; `check:limits` is red on main for that file either way, which is a
// pre-existing debt this lane inherits and does not add to.
//
// GLSL text and the constants that parameterise it. TerrainArt.glsl.ts
// re-exports everything here, so every existing import site holds and the
// assembled TERRAIN_ART_PARS is unchanged in content.

// No imports: this module is a LEAF. TerrainArt.glsl.ts imports from here and
// re-exports, never the other way round, so the pair cannot form a cycle --
// BiomeMaterial's own docstring records a cycle of exactly this shape throwing
// on the first frame and costing a page load to diagnose.

/**
 * RN-1733. THE NEAR-FIELD DETAIL LAYER, the eighth term, and the one that
 * answers the look audit's R1 item: what the ground is made of AT THE PLAYER'S
 * FEET.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MEASURED FIRST (RN-1730), because the diagnosis is the argument
 * ---------------------------------------------------------------------------
 * With the understorey hidden (`probes/groundnear.js`, real D3D11, forest site,
 * standing eye, sun dot 0.70), the section 2.1 `groundNear` rectangle sits on
 * ground 2.19 m away and reads iqr 9.56 against the smelter's own plate at
 * 53.66 in the same campaign. Turning each existing term off in turn, in ONE
 * page, attributes that 9.56 exactly:
 *
 *     ground texture off   9.56 -> 5.07     (the term owns 4.49)
 *     macro variation off  9.56 -> 8.56     (1.00)
 *     relief bump off      9.56 -> 8.49     (1.07)
 *     vnoise bump off      9.56 -> 9.35     (0.21)
 *     specular off         9.56 -> 9.35     (0.21)
 *
 * SO THE ENTIRE NORMAL-DERIVED CONTRIBUTION AT ARM'S LENGTH IS 1.28 COUNTS OF
 * SPREAD OUT OF 9.56. The ground at walking distance is very nearly a painted
 * albedo, and the picture says the same thing: a brown wash with soft dark
 * crack lines and no shading response anywhere in it.
 *
 * AND MORE AMPLITUDE IS NOT THE FIX, which was measured rather than assumed
 * (RN-1732). `?groundtexamp` at 3x takes the same rectangle to iqr 26.26,
 * comfortably past the plate, and the frame reads as dark marbling: it is the
 * SAME soft 0.6 m feature at higher contrast. RN-1257's own docstring predicted
 * it ("6 reads as dark worms"). The gap is FREQUENCY and SHADING, not gain, and
 * an instrument that only watches iqr would have called that arm a win.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FINEST THING ON THE GROUND IS 0.6 m, AND WHY IT IS NOT A BUG UPSTREAM
 * ---------------------------------------------------------------------------
 * Every existing detail term bottoms out well above a decimetre:
 *
 *     of_ground fine tap    47 repeats  -> 0.616 m tile at a depth-15 chunk
 *     of_ground mid tap     16          -> 1.808 m
 *     of_ground_relief      16          -> 1.808 m tile, finest crest ~0.23 m,
 *                                          at RELIEF_DEFAULT 0.08 amplitude
 *     the vnoise bump       14.0 / 5.3  -> 2.07 m and 5.46 m
 *
 * A pixel of ground covers about 4.3 mm at 2 m and 21.5 mm at 5 m, so features
 * from roughly 2 cm to 60 cm are exactly the band the eye has at walking
 * distance and exactly the band nothing occupies.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ANALYTIC AND ON THE CHUNK UV, i.e. why it is allowed at all
 * ---------------------------------------------------------------------------
 * A3 refused a tangent frame for the terrain this campaign and WG-193 measured
 * that no further tessellation helps, so the answer cannot be a normal map and
 * cannot be triangles. It does not need to be either. `ofArtBump` is
 * Mikkelsen's surface-gradient form: given a SCALAR height and the screen
 * derivatives of world position it recovers the perturbed normal with no
 * tangents, no UV parameterisation and no second attribute. That is the same
 * mechanism RN-1258 already ships on the dug voxel face, where analytic value
 * noise reaches 0.075 m features on a surface with no tangents either, and the
 * cut face is visibly the better-made surface of the two. This is that
 * construction moved onto the ground it was cut out of.
 *
 * THE COORDINATE IS `vChunkUv` AND NOT `pM`, which is the whole precision
 * argument and it is already settled in this file's header: pM is float32 at
 * about 6e5 m, one ULP is 0.0625 m, and 0.0625 m is three to fifteen times the
 * pixel footprint under the player, so a screen derivative of ANY pM-keyed
 * field is exactly zero across runs of pixels and steps at surfaces of constant
 * range (RN-45's arcs). The chunk UV is local, its derivative is exact across a
 * triangle, and every octave here is on it. Not one is on pM.
 *
 * THE HONEST COSTS, both of them named rather than discovered later:
 *
 *  1. THE UV NORMALISES OVER THE QUAD, so these wavelengths DOUBLE at every LOD
 *     step outward. That is tolerable for exactly the reason the existing bump
 *     and the relief term give: this term is retired by its own footprint fade
 *     inside about 12 m, and the streamer is at max depth far past that, so no
 *     LOD step is reachable while the term is live.
 *  2. THE FIELD REPEATS PER CHUNK, because `vChunkUv` restarts at every quad. A
 *     depth-15 chunk is 28.93 m, and the term is gone by 12 m, so a full period
 *     is never on screen. `groundnear.js`'s `tile` autocorrelation is the
 *     instrument that has to keep that true if the fade is ever pushed out.
 *
 * THE LATTICE IS PERIODIC ON THE CHUNK, and that is a correction to the
 * existing bump rather than a copy of it. `ofArtVnoise` at `vChunkUv * 14.0`
 * takes the value `vnoise(14)` at a chunk's far edge and `vnoise(0)` at the
 * next chunk's near edge, which are unrelated numbers, so the height jumps at
 * every same-depth chunk boundary and the surface-gradient normal prints a
 * hairline along it. `ofArtVnoise2P` wraps its integer lattice index modulo the
 * repeat count, so for an INTEGER repeat the field is continuous across the
 * seam by construction, which is RN-78's chunk-edge argument for the sampled
 * textures applied to an analytic one. It costs two `mod`s.
 *
 * THE THREE OCTAVES AND THE RIDGE. Repeats are PRIME (so the seam argument's
 * integer requirement holds and no two lattices share a cell boundary, and none
 * is a multiple of the quad's own 32 cells, which is why the existing bump
 * picked 14.0 and 5.3 over powers of two). At a depth-15 chunk of 28.93 m:
 *
 *     131 -> 0.221 m   the clod and litter-clump scale
 *     293 -> 0.099 m   the crease ridge's own scale
 *     601 -> 0.048 m   grit, and a pixel covers 4.3 mm of ground at 2 m
 *
 * AND THE FREQUENCY WAS CHOSEN BY LOOKING, BECAUSE THE NUMBER CANNOT CHOOSE IT.
 * That is the most useful thing this pass measured and it is recorded as a
 * warning about the metric rather than as a preference. A first sweep at a FIXED
 * amplitude read 15.91 / 18.42 / 19.77 / 24.56 of box iqr across four
 * frequency triples and looked like a clean monotone win for the finest. It was
 * not a frequency result at all: a surface-gradient bump's strength is
 * sum(weight / wavelength), so raising the frequencies at a fixed amplitude
 * raises the SLOPE, and the sweep was measuring gain. Re-run with the amplitude
 * scaled to hold that sum at 0.981 in every arm, the same four triples read
 * 15.91 / 15.35 / 14.35 / 13.84, i.e. FLAT to slightly falling. **The
 * interquartile range is very nearly blind to which frequency band the detail
 * sits in; it sees only how hard the normal is turned.** The pictures at those
 * four matched rungs are not close to each other, and 601 is the only one that
 * reads as crumbled soil rather than as the same wash with more contrast.
 *
 * THE RIDGE IS RN-1258's, unchanged in form: `0.52 - sqrt(v*v + 0.012)` turns a
 * signed value noise into creased highs with rounded lows, which is the
 * asymmetry that separates dirt from water. RN-78 measured that symmetric
 * smooth fields fed to a bump read as CHOPPY WATER at every amplitude, and
 * RN-147 answered it in the authored texture; this answers it in the analytic
 * field, by the same shape, so the term cannot arrive as the water read. The
 * 0.012 is the crease softener and keeps the square root differentiable, which
 * matters here in a way it does not on the voxel face: this height is fed to a
 * SCREEN derivative, and RN-741's whole scar is that a slope discontinuity
 * prints a hairline.
 *
 * `OF_FINE_M` is the FINEST wavelength in the sum, in metres, and it is what
 * `ofArtBump`'s footprint fade is given. It is derived from the repeat count
 * and the depth-15 chunk size rather than typed, because a fade keyed on a
 * stale copy of the frequency it protects is standing rule 11's own scar and
 * this file already has one live instance of it (see FINE_CHUNK_M).
 */
export const TERRAIN_ART_FINE = /* glsl */`
  // 2D value noise, PERIODIC on the repeat count. Four hashes rather than the
  // eight a 3D lattice costs, which is the whole reason the coordinate is 2D:
  // the chunk UV is 2D and a third axis would buy a field that varies with
  // nothing.
  float ofArtVnoise2P(vec2 x, float period) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    vec2 i0 = mod(i, period);
    vec2 i1 = mod(i + 1.0, period);
    float n00 = ofArtHash(vec3(i0.x, i0.y, 0.7));
    float n10 = ofArtHash(vec3(i1.x, i0.y, 0.7));
    float n01 = ofArtHash(vec3(i0.x, i1.y, 0.7));
    float n11 = ofArtHash(vec3(i1.x, i1.y, 0.7));
    return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
  }

  // The three noises, evaluated ONCE and returned, because both consumers want
  // them: the bump wants the height and the albedo wants a slice of the same
  // field. Deriving "how broken up is this fragment" twice from the same inputs
  // by separate arithmetic is RN-731's ofArtWetness scar exactly.
  //
  // f IS BOTH THE FREQUENCY AND THE PERIOD, which is what makes the seam
  // argument hold: the lattice index is reduced modulo the same number the
  // coordinate is scaled by, so chunk A's uv = 1 and chunk B's uv = 0 land on
  // the same lattice cell. It is a uniform (RN-843's reason: this is a live
  // question and a define cannot be swept inside one page), and only INTEGER
  // values keep the seam closed.
  vec3 ofArtFine3(vec2 uv, vec3 f) {
    return vec3(
      ofArtVnoise2P(uv * f.x, f.x) - 0.5,
      ofArtVnoise2P(uv * f.y + 4.13, f.y) * 2.0 - 1.0,
      ofArtVnoise2P(uv * f.z + 19.31, f.z) - 0.5);
  }

  // THE HEIGHT. Weights are peak-to-peak on a field already centred, and what
  // decides a surface-gradient bump's strength is the sum of weight OVER
  // WAVELENGTH and not the sum of weights (RN-1258's own note, and it is the
  // number to reason with when this is swept).
  // TWO HEIGHTS, NOT ONE, AND THE SPLIT IS A FADE ARGUMENT RATHER THAN A LOOK
  // ONE. ofArtBump fades on the pixel footprint against ONE wavelength, and
  // that wavelength has to be the FINEST thing in the height it is given or the
  // term aliases. Handing it the whole sum therefore retires the 0.22 m clod
  // octave at the 0.048 m grit octave's Nyquist point, which is a factor of 4.6
  // of reach thrown away: measured, the single-fade form gives the 3.05 m box
  // 2.36 counts of iqr where the coarse octave alone could still be live there.
  // Two calls, two fades, each protecting its own content.
  //
  // THE RIDGE TRAVELS WITH THE COARSE HALF and is protected by ITS OWN, FINER
  // wavelength, so the pair retires early rather than late. That is the safe
  // direction: a term that fades too soon leaves a band of ground to the
  // coarser terms that already cover it, and a term that fades too late folds.
  float ofArtFineHc(vec3 o, vec3 w) {
    float ridge = 0.52 - sqrt(o.y * o.y + 0.012);
    return o.x * w.x + ridge * w.y;
  }
  float ofArtFineHg(vec3 o, vec3 w) { return o.z * w.z; }

  // THE ALBEDO'S OWN COMBINATION, AND IT IS NOT THE HEIGHT, WHICH IS A
  // CORRECTION RATHER THAN A REFINEMENT. The first version modulated the albedo
  // by ofArtFineH directly and it BRIGHTENED the ground by 1.07 counts while
  // buying 0.79 of iqr, measured one flag apart: the ridge term is
  // 0.52 - sqrt(v*v + 0.012), whose mean is not zero, so a "variation layer"
  // was mostly a level change. That is precisely the macro tint's own scar,
  // forty lines away in TerrainShader, and the rule it left behind is that a
  // variation term must move the SPREAD and leave the LEVEL alone.
  //
  // The two value-noise octaves ARE centred by construction, so this pair is
  // mean-preserving whatever the weights are, and the ridge is left to the
  // bump, where an offset in the height is invisible because only its gradient
  // is read. Same field, two consumers, one of which cannot afford a DC term.
  float ofArtFineA(vec3 o, vec3 w) {
    return o.x * w.x + o.z * w.z;
  }

  // RN-1735. THE LUMINANCE RULE, AND IT IS RN-1257's OWN RULE APPLIED TO THE
  // TERM THAT NEEDED IT FOR THE SAME REASON.
  //
  // Both halves of this layer are MULTIPLICATIVE on the lit value (the albedo
  // half literally, the bump half through the irradiance it modulates), so the
  // CONTRAST EITHER ONE PRODUCES IN COUNTS SCALES WITH THE BIOME'S OWN ALBEDO.
  // Forest's linear luminance is 0.042 and Beach's is 0.367, a factor of nine,
  // so one amplitude across the planet gives the brightest ground nine times
  // the visible detail of the darkest -- and the darkest is the forest floor,
  // the exact frame this pass exists for. MEASURED, one flag apart at each
  // site's own local noon, at a flat amplitude of 0.080: the near-ground
  // rectangle's iqr moved +31% at Forest, +14% at Hills, **0% at Plains** and
  // **+134% at Beach**. That is not a term behaving differently on different
  // ground; it is one term being invisible at one site and shouting at another.
  //
  // BiomeMaterial's MAT_W rows already carry sum(b) = k / luminance(b)^0.6 for
  // exactly this, with exactly this argument, and the exponent's justification
  // there holds here unchanged: at 1.0 the compensation is exact and every
  // biome gets identical absolute contrast, which is wrong because bright dry
  // ground genuinely does show more variation than dark wet humus; 0.6 removes
  // most of a nine-fold error and leaves the part of it that is physical.
  //
  // IT IS DERIVED FROM vBiomeColor AND NOT FROM A TABLE, which is the one thing
  // here that improves on the precedent. A tenth row in a hand-written table is
  // a second statement of what the palette already says and can go stale
  // against it; this reads the palette itself, through the varying the biome
  // blend already interpolates, so it costs no table, no uniform, no varying,
  // cannot drift from BiomePalette, and crossfades across a biome edge for free
  // rather than stepping.
  float ofArtFineLum(vec3 biomeColor) {
    float bl = max(dot(biomeColor, vec3(0.2126, 0.7152, 0.0722)), 1.0e-3);
    return clamp(pow(OF_FINE_LUM_REF / bl, 0.6), 0.0, 1.5);
  }
`;

/**
 */
export const FINE_A = 131.0;
export const FINE_R = 293.0;
export const FINE_B = 601.0;

/**
 * RN-1733. The three height weights, peak-to-peak on fields already centred.
 * A uniform for the same reason the frequencies are one: the balance between a
 * clod scale, a crease scale and a grit scale is what decides whether the
 * ground reads as soil or as gravel, and that is settled by looking at matched
 * frames one uniform apart rather than by arithmetic.
 */
export const FINE_W: [number, number, number] = [0.55, 0.35, 0.30];

/**
 * RN-1733. The world size of one quad at the SHIPPED max depth, used only to
 * turn the repeat counts above into the metres `ofArtBump`'s footprint fade
 * needs.
 *
 * 28.93 m is `Config.maxDepth` 15 (WG-186's own measurement is a 0.899 m cell
 * at the feet, and a quad is 32 cells: 28.77 m, which agrees to 0.6%).
 *
 * THIS CONSTANT IS A DEPENDENCY ON A NUMBER THAT LIVES SOMEWHERE ELSE AND IT IS
 * SAID OUT LOUD, because this file already carries two live instances of the
 * same defect and they are not fixed here. `ART_FINE_M` (4.2) and
 * `RELIEF_FINE_M` (0.45) were both derived against a depth-14 quad of 57.856 m
 * and neither moved when WG-186 took the shipped depth to 15. Every chunk-UV
 * wavelength in this file HALVED that day: the vnoise bump's finest octave is
 * 2.07 m and its fade is protecting 4.2 m, and the relief's finest crest is
 * 0.23 m and its fade is protecting 0.45 m, so both terms now run about a
 * factor of two past their own Nyquist point before the fade retires them. That
 * is a real, small, pre-existing aliasing debt; it is measured and reported
 * (RN-1734) rather than silently corrected inside a look pass, because changing
 * either constant moves the shipped picture at range and that is its own paired
 * measurement. What this entry does is refuse to add a THIRD instance.
 */
export const FINE_CHUNK_M = 28.93;

/**
 * RN-1733. The finest wavelength in the detail sum, in metres, DERIVED and
 * derived IN THE SHADER from the live frequency uniform rather than baked as a
 * define. The fade exists to protect the finest octave; if the frequency can be
 * swept and the fade cannot, the sweep is measuring a term that is being
 * retired against the wrong Nyquist point, which is this file's own live
 * ART_FINE_M defect reproduced deliberately. This export is the BOOT value and
 * a cross-check for a probe, not the number the shader reads.
 */
export const FINE_M = FINE_CHUNK_M / FINE_B;

/**
 * RN-1733. The two amplitudes, and both are multipliers on strengths authored
 * inside `ofArtFineH` / the albedo line rather than the strengths themselves,
 * on `uSpecAmp`'s precedent: what they are for is to be ISOLATORS, so
 * `?groundfine=0` restores the pre-RN-1733 ground exactly and is the before
 * half of every pair this term is judged by, one flag apart on one build under
 * one light.
 *
 * FINE_BUMP 0.22 is calibrated, not picked, and the calibration is a sweep
 * inside one page against the pair of failure modes named before it was
 * measured: too low and the ground is the same wash (the null this term exists
 * to remove), too high and a flat forest floor reads as gravel, which is a
 * different material rather than a better-made one. See rendering.md's RN-1733
 * row for the rungs.
 *
 * FINE_ALB 0.45 rides the SAME field with the biome's own grain tint, so the
 * detail carries hue as well as value for the same reason RN-1257's tint does,
 * and it is mean-preserving by the same construction (the field is centred on
 * zero, so a fixed tint vector moves every channel's SPREAD and leaves its
 * LEVEL alone).
 */
export const FINE_BUMP = 0.080;
export const FINE_ALB = 0.45;

/**
 * RN-1735. The luminance the per-biome weight is normalised against: FOREST's
 * own linear luminance, so the biome this pass was briefed on takes exactly
 * 1.0 and the amplitudes above are read directly rather than through a factor.
 *
 * DERIVED FROM THE PALETTE, NOT TRANSCRIBED. `0x41392b` decoded from sRGB and
 * weighted Rec.709 is 0.04217, and RN-1257's docstring independently quotes
 * "Forest's linear luminance is 0.042", which is the cross-check that this
 * derivation and that table are talking about the same number. The weights it
 * produces across the ten biomes are Ocean 0.910, Beach 0.273, Plains 0.487,
 * Forest 1.000, Hills 0.505, Mountains 0.400, Polar 0.166, Regolith 0.354,
 * MoonHighland 0.275, CraterFloor 0.610.
 *
 * It is a CONSTANT here rather than a computation over `HEX` because importing
 * the palette into this module closes an import cycle (BiomeMaterial's own
 * docstring records that exact failure costing a page load), and because the
 * shader needs a literal. The cross-check above is what stands in for the
 * import, and `probes/groundnear.js` re-derives it from the shipped palette.
 */
export const FINE_LUM_REF = 0.04217;
