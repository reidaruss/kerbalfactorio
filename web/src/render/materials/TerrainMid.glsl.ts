// THE MID-FIELD LAYER (RN-1900 to RN-1914): the terrain's ninth surface-art
// term, and the one that answers what RN-1855's fade correction left behind.
//
// Split out of TerrainArt.glsl.ts on TerrainFine.glsl.ts's precedent and for
// the same reason (2.2 rule 1): that file is 1037 lines and 2.6x over the cap,
// `check:limits` is already red on it, and adding a term to the worst offender
// in the repo is not a thing to do quietly. TerrainArt re-exports everything
// here, so it stays the one place to look for "what surface-art terms exist".
//
// No imports: this module is a LEAF, exactly as TerrainFine is, so the pair
// cannot form a cycle with TerrainArt (BiomeMaterial's docstring records a
// cycle of that shape throwing on the first frame).
//
// ---------------------------------------------------------------------------
// WHAT WAS MEASURED FIRST, BECAUSE THE DIAGNOSIS IS THE ARGUMENT (RN-1900)
// ---------------------------------------------------------------------------
// `probes/groundnear.js`, real D3D11, Plains (-7.9675, 116.53189), standing eye
// 1.62 m, pitch -10, sun dot 0.70, scatter hidden, three 5-row strips PLACED BY
// RANGE at 18 / 27 / 35 m. Row std of luma, mean removed per row, which is one
// iso-range slice of ground and is the number RN-1859's verifier published.
// Every term turned off in turn inside ONE settled page:
//
//                   18 m            27 m            35 m
//     ship          17.13           9.90            20.10
//     bump off       5.08 (-12.05)  8.94 (-0.96)    20.10 (-0.00)
//     tex off       16.50 (-0.63)   9.65 (-0.25)    20.04 (-0.06)
//     macro off     17.09 (-0.04)  10.20 (+0.30)    17.59 (-2.51)
//     fine off      17.13 (-0.00)   9.90 (-0.00)    20.10 (-0.00)
//     spec off      16.37 (-0.76)   9.33 (-0.57)    18.01 (-2.09)
//
// THE MID FIELD'S ENTIRE SURFACE-ART CONTENT IS THE vnoise BUMP, AND THE BUMP
// IS GONE BY 35 m. At 18 m it owns 12.05 of 17.13 counts, i.e. 70 per cent; at
// 27 m it owns 0.96; at 35 m turning it off is BIT-IDENTICAL, so the term does
// not exist there at all. What is left past 30 m is the terrain's own macro
// shape and the specular, i.e. lighting over a painted plane. Every other
// detail term is retired before the band by its own gate and correctly so: the
// texture fades on distance 35 to 75 m and its 1.808 m tile is mipped to the
// 0.5-centred mean well before that, the relief fades 30 to 60 m and its bump
// is out at a 0.075 m footprint (about 10 m), and the near-field detail layer
// is out at 12 m by construction.
//
// AND THE MACRO FIELD IS NOT THE ANSWER, WHICH IS ALSO MEASURED. Its finest
// octave is 11.9 m and its weight there is 0.22 of the sum, so at 27 m turning
// the whole term off RAISES row std by 0.30 while dropping luma 12.05 counts:
// out here it is a LEVEL and not a SPREAD, which is the RN-1730 finding about
// the 186 m octave repeating one band down. Raising its amplitude would move
// the level with it, and that is the macro tint's own scar.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A NEW TERM AND NOT A WIDER FADE
// ---------------------------------------------------------------------------
// The obvious fix is to hand the band back by widening the footprint fades, and
// it was named and refused before this lane started, on evidence: the fade acts
// on `max()` of two derivatives, and at 25 m the VERTICAL footprint is 0.49 m
// against a horizontal 0.032 m, a 15x anisotropy, so partial amplitude would
// run right up to the fold with nothing absorbing it. That is confirmed here
// from the other side: at 27 m the pre-RN-1855 fade pair reads row std 18.83
// against the shipped 9.90, but its `band` split (see `rowBands` in
// groundnear.js) puts most of the recovered counts under 0.5 m of world scale,
// which at a 0.57 m footprint is mottle at the fold and not ground features.
//
// AT 27 to 35 m ONE PIXEL COVERS 0.57 to 0.96 m OF GROUND DOWN THE VIEW. So the
// only content that can survive out there is content COARSER THAN ABOUT TWO
// METRES, and nothing in the material occupies the 3 to 15 m band as albedo.
// This term does, and it retires each octave at its OWN Nyquist point rather
// than at a sibling's, which is the whole of RN-1855's lesson applied forward
// instead of backward.
//
// ---------------------------------------------------------------------------
// THE COORDINATE IS pM, AND HERE THAT IS THE RIGHT CHOICE RATHER THAN THE
// FORBIDDEN ONE
// ---------------------------------------------------------------------------
// TerrainFine's header says flatly that pM is unusable and every octave there
// is on the chunk UV. That argument is about DERIVATIVES at DECIMETRE scale and
// it does not carry to this band, which is worth spelling out because the two
// files would otherwise look like they contradict each other:
//
//  1. NOTHING HERE IS DIFFERENTIATED. This term is ALBEDO ONLY. pM's float32
//     quantum at Forge's surface is 0.0625 m, so a 4.7 m octave is a staircase
//     of 75 steps per wavelength and a 12.4 m octave one of 198. As a VALUE
//     that is invisible; as a screen derivative under the player it would be
//     exactly zero across runs of pixels, which is RN-45's arcs, and that is
//     why the normal half of the mid field is NOT here. It is the two-fade
//     split of the existing vnoise bump in TerrainShader, which is on the chunk
//     UV where it has always been.
//  2. THE TERM IS LIVE OUT TO ABOUT 75 m, WHICH IS PAST THE MAX-DEPTH RING. The
//     chunk UV normalises over the quad, so a chunk-UV field doubles its world
//     wavelength at every LOD step, and every existing chunk-UV term says so
//     and bounds itself inside the ring (the relief's own note: "30 to 60 m
//     completes inside the max-depth ring"). A term that has to reach 75 m
//     cannot be on that coordinate without drawing chunk-shaped patches of
//     differently-scaled ground, which is a defect this file's neighbours have
//     already photographed once.
//  3. IT IS SEAMLESS BY CONSTRUCTION. pM is continuous across every chunk edge
//     and every LOD boundary, so this term needs neither RN-78's integer-repeat
//     argument nor `ofArtVnoise2P`'s modulo, and it cannot print the hairline
//     along a same-depth chunk boundary that TerrainFine's header records the
//     existing bump printing.
//  4. IT IS FLOATING-ORIGIN STABLE, which is the reason the macro field is on
//     pM in the first place: a field keyed on `vWorld` swims across the ground
//     every time the origin rebases.
//
// THE WAVELENGTHS ARE THEREFORE GENUINELY IN METRES, AND THAT IS NOT THE TRAP
// WG-192 AND RN-1855 BOTH NAMED. Their finding is that a value written in
// metres is silently a function of the cell WHEN ITS COORDINATE IS THE CELL:
// `ART_FINE_M` was a metre figure for a chunk-UV octave, so halving the quad
// falsified it. Here the coordinate IS world metres, so a metre is a metre at
// every depth, on every body and after any tessellation change, and these two
// constants are the one kind of tuning number in this material that a
// `maxDepth` change genuinely cannot reach. The fades read the SAME uniform the
// octaves are scaled by, so even so they cannot become two numbers.

/**
 * RN-1900. THE FIELD.
 *
 * TWO OCTAVES, EACH WITH ITS OWN FOOTPRINT FADE, and the per-octave fade is the
 * point rather than a nicety. `ofArtBump` fades a whole height sum against ONE
 * wavelength, and TerrainFine already measured what that costs: handing the sum
 * one fade "retires the 0.22 m clod octave at the 0.048 m grit octave's Nyquist
 * point, which is a factor of 4.6 of reach thrown away". Two fades here, and
 * the coarse octave therefore outlives the fine one by the ratio of their
 * wavelengths, which is exactly the smoothness gradient a real landscape has.
 *
 * The curve is `ofArtBumpG`'s to the character (`0.125` to `0.333` of the
 * wavelength, i.e. fully out at a third of it against a fold at a half, a 1.5x
 * margin), because a second fade shape in the same material would be a second
 * opinion about where Nyquist is.
 *
 * THE FINE OCTAVE RIDES THE COARSE ONE, and it is multiplicative on purpose.
 * A plain sum of two centred noises is blobs at two sizes; ground is PATCHY,
 * meaning the small-scale break-up is concentrated where the large-scale field
 * puts cover and thin where it does not. `b * (0.5 + a)` is that, and it stays
 * MEAN-PRESERVING by construction because `a` and `b` are independent lattices
 * and `b` is centred, so `E[b(0.5 + a)] = E[b] E[0.5 + a] = 0`. That matters
 * for the reason TerrainFine's `ofArtFineA` note gives at length: this is a
 * variation layer, and a variation layer that moves the LEVEL is a colour grade
 * wearing a variation layer's clothes (the macro tint's own scar, measured at
 * -5.03 per cent of the mid band's level).
 *
 * `0.5 + a` with `a` in about [-0.5, 0.5] stays non-negative, so the modulation
 * never flips the fine octave's sign, which would read as an edge along every
 * contour where the coarse field crosses -0.5 rather than as patchiness.
 *
 * WHY VALUE NOISE AND NOT A RIDGE. The ridge form (`k - sqrt(v*v + eps)`) is
 * what TerrainFine and RN-1258 use to make a field read as creased dirt rather
 * than as choppy water, and it is deliberately NOT used here. Its mean is not
 * zero (TerrainFine measured the level shift it caused and moved the ridge to
 * the bump, where only the gradient is read), and this term has no bump half to
 * hide a DC term in. The asymmetry argument is also about a HEIGHT fed to a
 * lighting model; an albedo field has no water read to avoid.
 */
export const TERRAIN_ART_MID = /* glsl */`
  // pM, the pixel footprint, and the two wavelengths in metres. Returns a
  // signed, centred, already-faded scalar in about [-1, 1] before weights.
  //
  // The two branches are on the FADE and not on distance, and they are safe in
  // non-uniform control flow for the one reason that matters: nothing inside
  // takes a derivative and nothing inside samples a texture. That is the exact
  // condition RN-78 and RN-1733 had to hoist their own work out of, and it is
  // met here rather than assumed.
  float ofArtMid(vec3 pM, float footM, vec2 lam) {
    float fa = 1.0 - smoothstep(lam.x * 0.125, lam.x * 0.333, footM);
    if (fa <= 0.0) return 0.0;
    float a = ofArtVnoise(pM / lam.x + 137.7) - 0.5;
    float fb = 1.0 - smoothstep(lam.y * 0.125, lam.y * 0.333, footM);
    float o = a * OF_MID_WA * fa;
    if (fb > 0.0) {
      float b = ofArtVnoise(pM / lam.y + 311.2) - 0.5;
      o += b * (0.5 + a) * OF_MID_WB * fb;
    }
    return o * 2.0;
  }
`;

/**
 * RN-1900. THE TWO WAVELENGTHS, IN METRES, and both are bounded from two sides
 * rather than picked.
 *
 * MID_A_M 12.4 m. The LOWER bound is the macro field's own finest octave at
 * 11.9 m: closer than that and the two lattices beat against each other at a
 * period longer than either, which is the faint large-scale grid a stacked
 * octave series shows. The UPPER bound is the band: past about 20 m one
 * wavelength no longer fits across the 32 m of ground a frame row spans at
 * 27 m, so the octave stops being variation within the view and becomes a level
 * again, which is the failure the macro field is already measured to have out
 * here. 12.4 is not a ratio of 11.9 (1.042) for the same non-commensurate
 * reason the macro's own octaves sit at 3.94 rather than 4.
 *
 * MID_B_M 4.7 m. The LOWER bound is Nyquist at the far end of this term's
 * reach, and it is the only hard number here: the fade retires this octave at a
 * 1.565 m footprint, which at a 1.62 m standing eye is about 45 m, and 4.7 m is
 * three times that footprint, i.e. inside the fold with the same 1.5x margin
 * every other fade in this material uses. The UPPER bound is the gap it exists
 * to fill: the vnoise bump's coarse octave is 5.46 m, so anything much above 5
 * would be a second copy of a term the mid field already has (and, since
 * RN-1900's other half, actually keeps out to 45 m).
 *
 * The ratio is 2.638, which is not 2 and not 3 for the macro field's reason:
 * two lattices at an integer ratio share cell boundaries and draw a grid.
 */
export const MID_A_M = 12.4;
export const MID_B_M = 4.7;

/**
 * RN-1900. The two octave weights, peak-to-peak on fields already centred.
 *
 * They are DEFINES rather than a uniform, unlike the near-field layer's three,
 * and the reason is that the balance is not a live question here: the coarse
 * octave has to dominate or the term is mottle at the fold (which is precisely
 * the outcome the refused fade widening produces), and the fine octave is a
 * break-up rider that is multiplied by the coarse one anyway. What IS a live
 * question is the pair of wavelengths and the amplitude, and both of those are
 * uniforms.
 */
export const MID_WA = 0.62;
export const MID_WB = 0.38;

/**
 * RN-1900. The layer's amplitude, and it is an ISOLATOR first: `?groundmid=0`
 * restores the pre-RN-1900 ground exactly and is the BEFORE half of every pair
 * this term is judged by, one flag apart on one build under one light.
 *
 * 0.50 is calibrated against the pair of failure modes named before it was
 * measured. TOO LOW and the mid field is the same painted plane, which is the
 * null this term exists to remove. TOO HIGH and the ground reads as CLOUD
 * SHADOW: a 12 m tonal patch at high contrast on flat ground is exactly what a
 * cumulus shadow looks like, and that is a weather effect arriving in the
 * albedo where nothing can ever move it.
 *
 * THE RUNGS, at Plains yaw 300, standing eye, pitch -10, sun dot 0.70, the 27 m
 * strip (row std, then the low-passed 8 m band, which is the one that says
 * whether the counts arrived as structure or as fold-band mottle):
 *
 *     0     (pre-RN-1900)   9.90   3.29
 *     0.26                 11.04   4.78
 *     0.50  (shipped)      12.00   6.26
 *     0.52  (the 2x arm)   12.12   6.42
 *
 * 0.26 was the first value tried and the frame said it was not enough: the
 * band gained measurable counts and still read as one wash. At 0.50 the patches
 * are legible as ground at 27 to 40 m and the cloud-shadow read has not
 * arrived, which is what the picture is for and the number cannot decide.
 * Note what the pair of columns says and iqr alone could not (RN-1732's trap):
 * every rung puts a LARGER share of its gain in the coarse band than the last,
 * so this is not the same wash at higher contrast.
 *
 * PER BIOME IT IS SMALLER THAN IT LOOKS, because RN-1735's luminance rule
 * divides it: Forest takes 1.000 of this, Plains 0.487, Hills 0.505 and Beach
 * 0.273, so the bright ground that would show a 12 m patch hardest gets the
 * least of it. That is the whole reason the rule is shared with the near-field
 * layer rather than this term carrying a second, flat amplitude.
 */
export const MID_ALB = 0.50;
