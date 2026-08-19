// THE RELIEF TERM: the `of_ground_relief` texture's tile metrics, the ripple
// direction field's boot defaults, and the GLSL that samples them.
//
// Split out of TerrainArt.glsl.ts at the 400-line cap (2.2 rule 1), on the
// TerrainFine/TerrainMid precedent. A leaf module of GLSL text and tuning
// constants; TerrainArt.glsl.ts imports and RE-EXPORTS all of it, so every
// existing call site keeps working. Nothing here changed in the move.
//
// These constants belong together because they are all fractions or multiples
// of ONE repeat of `of_ground_relief` at the 16-repeat consumer coordinate:
// RELIEF_FINE_M and RELIEF_GRAD_UV cannot be derived without RELIEF_REPEATS
// and RELIEF_FINE_TILES, and REL_CELL / REL_CELL_NOISE are in the same tile
// units. Keeping them in one file is what stops the pair of them agreeing once
// and then drifting, which is the defect RN-1855 was.

import { FINE_CHUNK_M } from './TerrainFine.glsl.js';

/**
 * RN-148. The relief texture's repeats per chunk quad, likewise named rather
 * than written as a literal at its sample site, because RELIEF_FINE_M and
 * RELIEF_GRAD_UV are both fractions of ONE REPEAT and cannot be derived without
 * it. One repeat is 1.808 m at the shipped depth.
 */
export const RELIEF_REPEATS = 16.0;

/**
 * RN-1855. The relief texture's finest authored wavelength as a FRACTION OF ONE
 * REPEAT, which is the depth-invariant statement of the same physical fact the
 * old 0.45 m tried to state.
 *
 * The number is unchanged in substance: RN-148 measured the finest authored
 * crest at 0.45 m against a depth-14 repeat of 3.616 m, and 0.45 / 3.616 =
 * 0.1244. The texture is authored in TEXELS of its own tile, so this fraction
 * is a property of `of_ground_relief.png` and of the 16-repeat consumer
 * coordinate, and it is the same fraction at every LOD, at every maxDepth and
 * on every body. The METRES are the derived quantity, not the input.
 */
export const RELIEF_FINE_TILES = 0.1244;

/**
 * The relief texture's finest authored wavelength IN METRES, feeding
 * ofArtBump's footprint fade for the relief call, DERIVED for ART_FINE_M's
 * reason and by the same arithmetic. RN-78(d)'s lesson made quantitative: a
 * derivative scales a field by its own frequency, so the MIP CHAIN bounds the
 * sampled VALUE but never its gradient, and the throwaway test texture
 * photographed exactly that as moire arcs at range. The fade completing by a
 * third of this wavelength is what retires the term before its gradient can
 * alias.
 *
 * **RN-1855**: this was the literal `0.45`, the depth-14 reading, and WG-186
 * halved the crest it names to 0.23 m without moving it. Same 2.0x, same fix.
 *
 * **28.93 / 16.0 * 0.1244 = 0.2249 m at the shipped depth.**
 */
export const RELIEF_FINE_M = FINE_CHUNK_M / RELIEF_REPEATS * RELIEF_FINE_TILES;

/**
 * RN-741. The support the relief's slope is measured over, in TILE UNITS, where
 * one unit is one repeat of `of_ground_relief` at the 16-repeat consumer
 * coordinate.
 *
 * DERIVED, NOT PICKED. The support is a QUARTER of the finest authored
 * wavelength, which is the widest offset that still resolves the feature it is
 * differencing (half a wavelength is where a central difference starts reading
 * the next crest instead of this one, named failure mode 2) and the narrowest
 * that spans meaningfully more than the ~2 cm crest whose discontinuity is the
 * defect.
 *
 *     RELIEF_FINE_TILES * 0.25 = 0.1244 * 0.25 = 0.0311
 *
 * **RN-1855: THIS CONSTANT IS THE CONTROL THAT PROVES THE UNIT CHOICE IS THE
 * FIX, AND ITS VALUE DOES NOT MOVE.** It was written the long way round
 * (`0.45 / 3.616 * 0.25`, i.e. metres divided by metres) but it is expressed in
 * TILE UNITS, so WG-186 halving the quad left it correct on its own while its
 * two neighbours, which were in metres, silently went 2.0x wrong. Its world
 * support simply tracked the crest it is a quarter of: 0.112 m at depth 14,
 * 0.056 m at the shipped depth 15, still a quarter of a 0.225 m crest. It now
 * reads RELIEF_FINE_TILES instead of restating the arithmetic, so there is one
 * authority and not two, and it emits the identical `0.0311`.
 *
 * The same LOD caveat the rest of this file carries applies and is bounded the
 * same way: the chunk UV's world size doubles at every LOD step, so this is a
 * growing world distance at coarser rings. It does not matter here because the
 * relief term fades out over 30 to 60 m and the streamer is at max depth inside
 * that, so no LOD step is reachable while the term is live.
 */
export const RELIEF_GRAD_UV = RELIEF_FINE_TILES * 0.25;

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
