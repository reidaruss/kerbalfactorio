// RN-2665. THE STAND MOTTLE: the far treeline paint's structure at the scale a
// receding forest actually has structure at, which is the STAND and not the
// crown.
//
// THE DEFECT, and it is geometric rather than a taste call. World Audit R5's
// corrected rank 1 measured the paint carrying NO structure across 3.4 to
// 15.5 km: shipped row iqr never above 3.9 counts across rows 329-509 with
// dIQR about zero, and at the instance ring the paint REMOVES 15.47 counts of
// iqr (this lane reproduces that at 16.12). The reason is one number. The
// term's only structure field is TREE_CROWN_M, 34 m, and it retires at its own
// Nyquist point, a third of its wavelength, i.e. at a ground footprint of
// 11.3 m per pixel. At `flyover`'s 1,200 m eye the footprint across the
// audited band runs from 12.0 m at row 540 to 288 m at row 330. So the crown
// mottle is identically ZERO everywhere the audit sampled, and TREELINE_AMP
// could not have fixed it: there was no field to scale.
//
// AND THE VERTEX ATTRIBUTE CANNOT CARRY IT EITHER, which is what makes a
// shader-side field a first copy rather than a second one. `vCanopy` already
// contains world-gen's stand factor, evaluated per terrain VERTEX in
// ChunkCanopy. But the terrain mesh is a quadtree: a depth-8 chunk's cell is
// 115 m and depth 8 is resident only to about 2,630 m of eye distance
// (ScatterTuning's own ladder), so from 2,630 m outward the cell is 230 m and
// then 460 m. A 165 m stand has a dominant period of about 330 m and needs
// cells under 82 m to survive sampling. The whole audited band starts at
// 3,378 m. **Across every metre of it the vertex route has already averaged
// the stand field away, so the shader field is not duplicating a visible
// field; it is restoring one the mesh destroyed.** Where the two DO overlap
// (a ground-adjacent pose looking at its own 690 m ring, where the mesh is
// depth 8 or finer) the shader field adds variance to a field that still has
// some, which is a contrast change and not an artefact; it is measured at
// `forestaircanopy` rather than argued.
//
// IT IS WORLD-GEN'S OWN LAW AND NOT A NEW ONE. `ScatterTuning.canopyWeight`
// multiplies the biome's area index by
//   dense = CANOPY_FLOOR_W + (1 - CANOPY_FLOOR_W) * ramp(stand, STAND_LO, STAND_HI)
// and this file evaluates THAT EXPRESSION, with THOSE FOUR CONSTANTS imported
// rather than retyped, on the GLSL value noise the material already has. The
// only thing it cannot share is the hash: `standAt` is trilinear value noise
// over an integer lattice hash, and ChunkCanopy's header proves an exact GLSL
// mirror is not writable at all (ESSL 1.00 has no integer type and no bitwise
// operators, and a highp float's 24 mantissa bits cannot emulate a 32-bit
// wrapping multiply). So the phase is the material's own and the LAW, the
// SCALE and the CONTRAST are world-gen's.
//
// WHAT IT MODULATES IS THE DENSITY, NOT THE ALBEDO, and that is the whole
// difference between this and TREE_MOTTLE. A stand-scale feature in a wood is
// not crowns of a different colour, it is more crowns and fewer crowns. Fed
// into the Beer-Lambert cover, a low cell shows more ground (and, since
// RN-2661, more SHADED ground) and a high cell shows closed canopy, which is
// what a receding forest is made of. Fed into the albedo instead it would have
// repainted a flat wash a mottled shade of the same wash, which is the R5
// verifier's own reason for demoting TREELINE_AMP.

import {
  CANOPY_FLOOR_W, GROVE_FLOOR_W, GROVE_HI, GROVE_LO, GROVE_M,
  STAND_HI, STAND_LO, STAND_M, groveAt, standAt,
} from '../../world/ScatterTuning.js';

/** `STAND_M`, world-gen's stand cell in body-frame metres. */
export const TREE_STAND_M = STAND_M;
/** `GROVE_M`, world-gen's LANDSCAPE cell: 760 m of wood against field. */
export const TREE_GROVE_M = GROVE_M;

/**
 * THE NORMALISER, AND IT IS THE ONE MEASURED NUMBER IN THIS FILE.
 *
 * The modulation has to be MEAN-PRESERVING in the density, because RN-2661
 * re-pinned the paint's mean level in the commit before this one and a
 * structure term that also moved the mean would be spending that pinning
 * without saying so. `dense` has a mean of its own (it is a ramp, not a
 * centred noise), so the shader divides by it.
 *
 * 0.55827 is the mean of world-gen's own `dense` law evaluated on the GLSL
 * value noise, over 9,000,000 samples on the lattice band the shipped term
 * actually reaches (|pM| about 6e5 divided by 165, so indices near 3,600,
 * where float32's own resolution is what it is).
 *
 * FOUR INDEPENDENT MEASUREMENTS AGREE WITH IT TO UNDER ONE PER CENT, taken
 * over a 21 km square at each audited site, which is the band World Audit R5
 * actually sampled:
 *
 *   site     world-gen dense(standAt)   the shader's dense(vnoise)
 *   Hills    0.5594  (+0.20 per cent)   0.5543  (-0.71 per cent)
 *   Forest   0.5561  (-0.38 per cent)   0.5590  (+0.13 per cent)
 *
 * and `assertStandMottleMatchesScatter` below re-runs that comparison at
 * module load and THROWS rather than warns, on
 * `assertTreelineMatchesScatter`'s own precedent.
 *
 * The two fields' CONTRAST is close but NOT equal, and it is recorded because
 * it is the property that decides how the term reads: relative RMS 0.6580 and
 * 0.6508 for the shader field against 0.6161 and 0.6181 for world-gen's, i.e.
 * 5 to 7 per cent hotter. The raw noises differ by far more than that
 * (`standAt` is 0.72 at 165 m plus 0.28 at 52 m and has sd 0.156, one octave
 * of `ofArtVnoise` has 0.184, an 18 per cent gap) and the ramp's own
 * saturation at both ends compresses it to a fifth of that. That is not luck,
 * it is what a clamped ramp does, and it is why matching the LAW was worth
 * more than matching the noise.
 */
export const TREE_STAND_MEAN = 0.55827;

/**
 * THE GROVE OCTAVE, AND IT IS HERE BECAUSE THE STAND OCTAVE ALONE WAS MEASURED
 * TO REACH ONLY 4.3 KM OF A 15.5 KM BAND.
 *
 * `canopyWeight` is a PRODUCT of three factors, and WG-221's own header says
 * why: the LANDSCAPE (760 m woods and fields), the STAND (165 m closures and
 * clearings inside a wood) and the TREELINE. The mesh averages the first two
 * away at range just as surely as each other, so re-imposing only the stand
 * was half the fix. Measured on the `?treelinepaint=2` coverage arm at
 * `flyover`, the stand octave moves `treeK` by 2.9 to 13.9 counts inside
 * 4.3 km and by 0.00 to 0.23 counts (noise) beyond it.
 *
 * AND THE 4.3 KM IS NOT WHERE THE ARITHMETIC PUT IT, which is worth recording
 * because it is the second time this lane has been caught by the same
 * quantity. The stand octave retires between a 20.6 m and a 55.0 m ground
 * footprint per pixel, and on a SMOOTH DATUM that is 4.3 km to 7.0 km at this
 * pose. The measurement says it is gone by 4.5. The datum arithmetic is a
 * LOWER BOUND on `footM`: real relief tilts a hillside away from the eye and
 * stretches its per-pixel footprint well past the sphere's own, so a term
 * faded on `footM` retires EARLIER than a smooth-datum ladder predicts. The
 * grove octave is chosen against the measurement rather than against the
 * arithmetic: 760 m retires between 95 m and 253 m, which is 3.5 to 7 times
 * further out on the same curve.
 */
export const TREE_GROVE_MEAN = 0.54384;

/** World-gen's `ramp` and its two density factors, in one place. */
const ramp = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const denseOf = (s: number) => CANOPY_FLOOR_W + (1 - CANOPY_FLOOR_W) * ramp(s, STAND_LO, STAND_HI);
const groveOf = (s: number) => GROVE_FLOOR_W + (1 - GROVE_FLOOR_W) * ramp(s, GROVE_LO, GROVE_HI);

/**
 * The GLSL value noise's own JS mirror. STATISTICAL, NOT BIT-EXACT, and the
 * difference is stated rather than glossed: the shader runs this in float32
 * and this runs in float64, so individual samples differ in the last places.
 * The assert below compares DISTRIBUTIONS (a mean over thousands of samples),
 * which is the only property the constant above is derived from, and float32
 * rounding cannot move a mean of a bounded field by anything measurable.
 */
const fract = (x: number): number => x - Math.floor(x);
function artHash(px: number, py: number, pz: number): number {
  let x = fract(px * 0.1031); let y = fract(py * 0.1031); let z = fract(pz * 0.1031);
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}
function artVnoise(X: number, Y: number, Z: number): number {
  const ix = Math.floor(X); const iy = Math.floor(Y); const iz = Math.floor(Z);
  let fx = X - ix; let fy = Y - iy; let fz = Z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number): number => artHash(ix + a, iy + b, iz + c);
  const m = (a: number, b: number, t: number): number => a + (b - a) * t;
  return m(
    m(m(h(0, 0, 0), h(1, 0, 0), fx), m(h(0, 1, 0), h(1, 1, 0), fx), fy),
    m(m(h(0, 0, 1), h(1, 0, 1), fx), m(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}

/**
 * THE ASSERT, and it watches the thing that can actually break.
 *
 * The four constants are imported, so a lane that retunes `STAND_LO` moves
 * both sides at once and nothing here can catch it, nor should it. What CAN
 * silently break is the DISTRIBUTION: `standAt` is a two-octave mix and a lane
 * that changed the mix, or `STAND_DETAIL_M`, or the octave interpolant, would
 * move world-gen's `dense` mean out from under `TREE_STAND_MEAN` and the
 * shader's modulation would stop being mean-preserving without any file this
 * lane owns changing a character. So the comparison is run live, against the
 * live `standAt`, and it THROWS.
 *
 * THE SAMPLING IS THE INSTRUMENT AND THE FIRST VERSION OF IT WAS THE DEFECT.
 * It walked a 2.9 km square on a quarter-cell lattice, which is 4,900 samples
 * but only about 300 INDEPENDENT stand cells, so the standard error on each
 * mean was 0.021 and the Forest site returned 0.6051 against the constant's
 * 0.5583 -- 2.2 standard errors, i.e. perfectly ordinary noise, arriving as a
 * hard throw at boot. Widening the tolerance would have been the wrong repair:
 * the estimator was too noisy, not the constant wrong. It now strides 1.618
 * stand cells (an irrational multiple, so consecutive samples never land on
 * the same lattice phase) over a 21 km square, which is also the RIGHT DOMAIN
 * -- World Audit R5's band is 3.4 to 15.5 km, not 3 km. 6,400 samples at
 * better than one cell apart is roughly 6,400 independent draws, standard
 * error 0.0046, and the two tolerances below are read off that rather than
 * picked. Costs about 15 ms once, at module load.
 *
 * TWO CLAIMS, TWO TOLERANCES, because they are not the same claim.
 *   SHADER, 2 per cent (4 standard errors): the modulation divides by
 *     TREE_STAND_MEAN and must therefore have mean 1. This is the
 *     mean-preservation promise RN-2661's re-pinned level depends on.
 *   WORLD-GEN, 6 per cent: that the LAW still describes the same field. It is
 *     looser on purpose -- `standAt` is two octaves against the mirror's one,
 *     so the two distributions are near but not equal, and the measured gap is
 *     under one per cent in the mean and 3 to 4 per cent in the contrast.
 */
export function assertStandMottleMatchesScatter(): void {
  const R = 6e5;
  const STEP = STAND_M * 1.618;
  const N = 80;
  for (const [name, latDeg, lonDeg] of [
    ['Hills (flyover)', -3.41413, 150.27984],
    ['Forest (forestair)', -19.85, -72.7853]] as [string, number, number][]) {
    const la = (latDeg * Math.PI) / 180; const lo = (lonDeg * Math.PI) / 180;
    const up = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
    const e = [-Math.sin(lo), 0, Math.cos(lo)];
    const nn = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2],
      up[0] * e[1] - up[1] * e[0]];
    let wgS = 0; let shS = 0; let wgG = 0; let shG = 0;
    for (let i = 0; i < N; i += 1) {
      for (let j = 0; j < N; j += 1) {
        const a = (i - N / 2) * STEP; const b = (j - N / 2) * STEP;
        const x = up[0] * R + e[0] * a + nn[0] * b;
        const y = up[1] * R + e[1] * a + nn[1] * b;
        const z = up[2] * R + e[2] * a + nn[2] * b;
        wgS += denseOf(standAt(x, y, z));
        shS += denseOf(artVnoise(x / STAND_M + 57.9, y / STAND_M + 57.9,
          z / STAND_M + 57.9));
        wgG += groveOf(groveAt(x, y, z));
        shG += groveOf(artVnoise(x / GROVE_M + 23.1, y / GROVE_M + 23.1,
          z / GROVE_M + 23.1));
      }
    }
    const n = N * N;
    // The GROVE pair is judged loosely on purpose and the reason is the same
    // sampling arithmetic as above, one scale up: a 21 km square holds only
    // about 780 grove cells against 16,000 stand cells, so the grove mean's
    // own standard error over this sample is near 0.013 rather than 0.0046.
    // 12 per cent is roughly five of those. A tighter number here would be a
    // flaky boot, not a stronger guarantee.
    for (const [who, got, want, tol] of [
      ['the GLSL mirror of dense(stand)', shS / n, TREE_STAND_MEAN, 0.02],
      ["world-gen's live dense(standAt)", wgS / n, TREE_STAND_MEAN, 0.06],
      ['the GLSL mirror of groveWeight', shG / n, TREE_GROVE_MEAN, 0.06],
      ["world-gen's live groveWeight(groveAt)", wgG / n, TREE_GROVE_MEAN, 0.12],
    ] as [string, number, number, number][]) {
      if (Math.abs(got - want) / want > tol) {
        throw new Error(`TerrainStandMottle: at ${name}, ${who} has a mean of`
          + ` ${got.toFixed(4)} against ${want}, past the ${tol * 100} per cent`
          + ` tolerance. The mottle would no longer be mean-preserving, so it`
          + ` would move the paint's LEVEL as well as its structure, and RN-2661`
          + ` re-pinned that level. Re-derive the constant`
          + ` (tools/build/densemean.mjs's method, 9e6 samples) rather than`
          + ` widening this tolerance.`);
      }
    }
  }
}
assertStandMottleMatchesScatter();

/**
 * The GLSL half, on `CanopySelfShadow`'s and `CrownSkyView`'s precedent: the
 * authority is TypeScript and it emits its own shader. Interpolated into
 * TERRAIN_TREELINE_PARS, so it sits above `main` and declares only a function.
 *
 * `ofArtVnoise` is `TERRAIN_ART_NOISE`'s, already in the terrain program.
 * The `+ 57.9` is a DECORRELATION offset against the crown mottle's own
 * `+ 91.3` and nothing else; the world-lock is `pM`, which is planet-centred
 * metres with a 31.25 mm quantum at Forge, exactly as the crown mottle and
 * `ofArtMassif` are already keyed.
 *
 * `fade` is the caller's Nyquist retirement times the arm, so at `fade` 0 this
 * returns exactly 1.0 and the pre-RN-2665 density is restored to the bit.
 */
export const TREE_STAND_GLSL = /* glsl */`
  #define OF_TREE_STAND_M ${TREE_STAND_M.toFixed(2)}
  #define OF_TREE_STAND_LO ${STAND_LO.toFixed(5)}
  #define OF_TREE_STAND_HI ${STAND_HI.toFixed(5)}
  #define OF_TREE_STAND_FL ${CANOPY_FLOOR_W.toFixed(5)}
  #define OF_TREE_STAND_MEAN ${TREE_STAND_MEAN.toFixed(5)}
  #define OF_TREE_GROVE_M ${TREE_GROVE_M.toFixed(2)}
  #define OF_TREE_GROVE_LO ${GROVE_LO.toFixed(5)}
  #define OF_TREE_GROVE_HI ${GROVE_HI.toFixed(5)}
  #define OF_TREE_GROVE_FL ${GROVE_FLOOR_W.toFixed(5)}
  #define OF_TREE_GROVE_MEAN ${TREE_GROVE_MEAN.toFixed(5)}
  // world-gen's own clamped ramp, once, for both factors.
  float ofTreeRamp(float v, float lo, float hi) {
    return clamp((v - lo) / (hi - lo), 0.0, 1.0);
  }
  // THE PRODUCT, and it is a product because canopyWeight is
  // (dense x groveWeight x treeline) and not a sum. Each factor is divided by
  // its OWN mean, so each is independently mean-preserving and either can be
  // faded out on its own Nyquist point without moving the level.
  float ofTreeStandMod(vec3 pM, float standFade, float groveFade) {
    float d = OF_TREE_STAND_FL + (1.0 - OF_TREE_STAND_FL)
      * ofTreeRamp(ofArtVnoise(pM / OF_TREE_STAND_M + 57.9),
                   OF_TREE_STAND_LO, OF_TREE_STAND_HI);
    float g = OF_TREE_GROVE_FL + (1.0 - OF_TREE_GROVE_FL)
      * ofTreeRamp(ofArtVnoise(pM / OF_TREE_GROVE_M + 23.1),
                   OF_TREE_GROVE_LO, OF_TREE_GROVE_HI);
    return mix(1.0, d / OF_TREE_STAND_MEAN, standFade)
         * mix(1.0, g / OF_TREE_GROVE_MEAN, groveFade);
  }
`;
