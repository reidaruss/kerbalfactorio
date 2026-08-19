// The terrain's VALUE-NOISE SURFACE ART: the hash-and-vnoise primitive, the
// macro colour variation field, the rock strata, and the derivative bump that
// rides on all three, together with the octave counts and the derived
// wavelengths their footprint fades are keyed on.
//
// Split out of TerrainArt.glsl.ts at the 400-line cap (2.2 rule 1), on the
// TerrainFine/TerrainMid precedent this project already set: a leaf module of
// GLSL text and tuning constants that imports nothing but TerrainFine, and is
// imported and RE-EXPORTED by TerrainArt.glsl.ts so every existing call site
// keeps working and TerrainArt stays the one place to look for "what
// surface-art terms exist". Nothing here changed in the move; the blocks are
// byte-identical to the ones that left, and the concatenation order in
// TERRAIN_ART_PARS is unchanged.
//
// The long-form rationale for the whole surface-art pass, the precision floor
// on planet-centred metres, and the two independent confinements that keep it
// out of the scaled scene are at the top of TerrainArt.glsl.ts and are not
// restated here.

import { FINE_CHUNK_M } from './TerrainFine.glsl.js';

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
 * of the wavelength it is given to a third of it, i.e. it is fully out well
 * before the point at which the signal could fold. That wavelength is the
 * `fineM` ARGUMENT and is passed in rather than duplicated, because a fade
 * keyed on a stale copy of the frequency it protects is a negative control made
 * of a constant copied from the thing it watches, which standing rule 11
 * already has a scar from.
 *
 * RN-1900 CORRECTS THIS PARAGRAPH ON TWO WORDS. It said `OF_ART_FINE_M`, which
 * RN-1855 deleted in the same commit that made the fade derived: there is no
 * such define any more, the value arrives as `uArtFineM` through the argument,
 * and a docstring naming a dead define is how the next lane greps for an
 * authority that does not exist. And it said "the finest octave", which is what
 * the ONE call site happened to pass and is not what this function requires:
 * `ofArtBumpG` fades whatever height it is handed against whatever wavelength
 * it is handed, and RN-1900's split relies on that, calling it twice with one
 * octave and one wavelength each. What the CALLER must guarantee is that
 * `fineM` is the finest wavelength IN THE HEIGHT IT PASSES.
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
  // RN-1900. fineM <= 0 means THE CALLER HAS ALREADY FADED, and it is not a
  // way to switch the guard off. A caller with a height made of octaves at
  // different wavelengths cannot be served by one fade (that is the defect this
  // lane found in hB), and it cannot pre-fade the HEIGHT either, because a
  // per-pixel weight inside a screen derivative contributes a grad(w) term that
  // belongs to the weight and not to the ground -- RN-961's own finding, which
  // lit a ridge along every cell boundary until the two GRADIENTS were blended
  // instead of the two heights. So the supported shape is: weight each octave's
  // GRADIENT by that octave's own fade, sum, and pass the sum here with fineM 0.
  // Passing 0 with an unfaded gradient would alias, and the only thing stopping
  // that is that the two call sites which do it are three lines away from their
  // own smoothsteps.
  vec3 ofArtBumpG(vec3 n, vec3 pos, float hx, float hy, float amp, float fineM) {
    if (amp <= 0.0) return n;
    vec3 sx = dFdx(pos);
    vec3 sy = dFdy(pos);
    float footM = max(length(sx), length(sy));
    if (fineM > 0.0) {
      amp *= 1.0 - smoothstep(fineM * 0.125, fineM * 0.333, footM);
    }
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
 * RN-1855. THE BUMP'S TWO OCTAVES, IN REPEATS PER CHUNK QUAD, which is the unit
 * they are actually written in at the call site (`vChunkUv * 14.0` and
 * `vChunkUv * 5.3` in TerrainShader) and the unit in which they are INVARIANT
 * under a tessellation change.
 *
 * 14.0 and 5.3 rather than powers of two: a lattice that lined up with the
 * 32-cell quad grid would put every noise cell boundary on a vertex and draw
 * the grid. That argument is about the LATTICE and not about metres, which is
 * why it survived WG-186 untouched while every metre in this file did not.
 *
 * They are named here, emitted as defines, and consumed by the noise call AND
 * by ART_FINE_M below, so the octave and the fade that protects it read ONE
 * number rather than two that agreed once. See ART_FINE_M for what happened the
 * last time they were two.
 */
export const ART_OCT_FINE = 14.0;
export const ART_OCT_COARSE = 5.3;

/**
 * The finest octave the bump adds, IN METRES, and DERIVED rather than written.
 * ONE definition, consumed both by the shader that samples at that wavelength
 * and by the fade that protects it.
 *
 * **RN-1855 FIXED THE DEFECT RN-1734 MEASURED AND ROUTED.** This was the literal
 * `4.2`, justified as "the float32 precision floor on planet-centred metres at
 * Forge's radius". Both halves of that had gone stale:
 *
 *  - The bump's height field has not been keyed on planet-centred metres since
 *    RN-50 (see TerrainShader's "EVERY OCTAVE FEEDING THE DERIVATIVE IS ON THE
 *    UV"), so the precision floor stopped being the binding constraint. What
 *    4.2 actually approximated from then on was the finest octave's world size,
 *    57.856 / 14 = 4.13 m at a depth-14 quad.
 *  - WG-186 took the shipped `maxDepth` to 15 and HALVED every chunk-UV
 *    wavelength in this file. The finest octave became 2.07 m; the fade went on
 *    protecting 4.2 m, i.e. a wavelength that had stopped existing, and the
 *    fade constant was therefore 2.0x too large. `ofArtBumpG` is fully faded at
 *    `fineM * 0.333`, so the term stayed live out to a 1.40 m footprint against
 *    a real Nyquist limit of 1.033 m: 1.354x PAST the fold point, where the
 *    intended design is 1.5x inside it. (RN-1900 corrects the figure, which
 *    read 1.33x: 1.33 is the RELIEF term's overshoot, 0.45 * 0.333 = 0.1499
 *    against a 0.1125 m fold, and the art term's own is 4.2 * 0.333 = 1.3986
 *    against 1.0332, i.e. 1.354x. The two are close enough that one was
 *    transcribed for the other, which is why both are now written with their
 *    arithmetic beside them.)
 *
 * Derived from the octave count, so a tessellation change or a swept octave
 * cannot leave the fade behind again. This is the mirror image of WG-192's own
 * finding (`ScatterLook.CLUSTER_SHIFT`: a tuning value expressed in CELLS is
 * silently a function of `maxDepth`) -- here a tuning value expressed in METRES
 * was silently a function of the cell, and the fix in both directions is the
 * same: express it in the unit its argument is actually about.
 *
 * **28.93 / 14.0 = 2.0664 m at the shipped depth.**
 */
export const ART_FINE_M = FINE_CHUNK_M / ART_OCT_FINE;

/**
 * RN-1900. THE BUMP'S COARSE OCTAVE, IN METRES, DERIVED THE SAME WAY, AND IT
 * EXISTS BECAUSE THE COARSE OCTAVE WAS BEING RETIRED AT ITS SIBLING'S NYQUIST
 * POINT.
 *
 * `hB` is a SUM of two octaves, 2.066 m at weight 0.9 and 5.458 m at weight
 * 0.5, and until this lane it went into ONE `ofArtBump` call with ONE fade,
 * `uArtFineM`, which is the FINER of the two. So the 5.458 m octave was fully
 * gone at a 0.688 m footprint (about 30 m at a standing eye) when its own
 * Nyquist point, at the identical 1.5x margin every fade in this material uses,
 * is a 1.818 m footprint (about 49 m). A factor of 2.64 in footprint and 1.63
 * in range, thrown away.
 *
 * THIS IS NOT A NEW OBSERVATION, IT IS ONE THIS MATERIAL ALREADY MADE AND ONLY
 * APPLIED TO THE OTHER TERM. TerrainFine's `ofArtFineHc` note: "Handing it the
 * whole sum therefore retires the 0.22 m clod octave at the 0.048 m grit
 * octave's Nyquist point, which is a factor of 4.6 of reach thrown away ... Two
 * calls, two fades, each protecting its own content." The near-field layer was
 * built with two calls from the start; the vnoise bump it sits on never got the
 * same treatment, and the 5.458 m octave is exactly the mid-field wavelength
 * RN-1900 is about, so the first half of this lane's fix is a term the ground
 * already had and could not show.
 *
 * DERIVED, not written, for ART_FINE_M's reason exactly: the octave count is a
 * define the noise call site reads too, so the wavelength and the fade that
 * protects it cannot be two numbers that agreed once.
 *
 * **28.93 / 5.3 = 5.4585 m at the shipped depth.**
 */
export const ART_COARSE_M = FINE_CHUNK_M / ART_OCT_COARSE;
