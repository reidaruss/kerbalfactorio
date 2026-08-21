// WG-50: the world-gen side of the terrain surface-art precision contract.
//
// WHAT IS BROKEN. A shader field keyed on planet-centred metres is destroyed at
// Forge's radius. `pM` is float32 and about 6e5 m, so one ULP is 2^(19-23) =
// 0.0625 m, while one screen pixel covers single-digit millimetres of ground
// under the player. Whole runs of adjacent pixels therefore sample the SAME
// quantised position, `dFdx` of the field is exactly zero across them, and it
// steps only where the quantisation steps. Those step boundaries are surfaces
// of constant range from the eye, which is why the artefact is concentric arcs
// centred on the player rather than a general mush. Measured and photographed
// by the rendering lane at RN-45 (`docs/screenshots/RN45_iso_bump.png`), and
// reproduced here from arithmetic alone by `web/tools/precision/artphase.ts`.
//
// The field's VALUE survives (0.0625 m against a 4.2 m finest octave is 1.5% of
// a wavelength). Only the DERIVATIVE is destroyed, which is why the macro
// colour term ships and the bump does not.
//
// WHAT FIXES IT. Standing rule 6 applied to the noise PHASE rather than to the
// position. Rule 6 already says positions cross the boundary as float32
// relative to a per-chunk 64-bit anchor, never as absolute planet-scale floats.
// The art field broke rule 6 by reconstructing an absolute planet-scale float
// inside the shader. Nothing new is needed: the chunk already carries a float64
// anchor (`ChunkView.anchor`, sourced from `/core`'s `centerUniverse.pos`,
// which is C++ `double`), and the vertex already carries its float32 offset
// from that anchor.
//
// So this module does the ONE thing the shader cannot: it reduces the anchor,
// once per chunk, on the CPU, in float64, into a per-octave
// (integer lattice cell, fractional phase) pair. The shader then evaluates the
// octave on a small local coordinate and never forms a 6e5 intermediate.
//
// WHAT THIS IS NOT. It is not a chunk-format change. It touches no byte of the
// 28 B/vertex packed layout, no `of_packed_*` export, no ABI, and no parity
// fixture. It is a pure function of a number the chunk already has. Putting it
// in the wire format is the one version of this that WOULD move the parity
// bytes and force a 108/108 cross-toolchain re-baseline, which is why that
// shape was refused. See `docs/controllers/world-gen.md` WG-50.
//
// It also takes no part in world generation. Terrain height, biome, solidity,
// deposits and the save are untouched by construction: this reads an anchor
// that generation has already produced and produces a shading phase that
// generation never reads back. Standing rule 4 is not at risk here, and that is
// a property of WHERE the quantity lives rather than of how carefully it was
// written.

import type { Vec3d } from './PlanetBody';

/**
 * Per-axis reduction of one chunk anchor against one octave wavelength.
 *
 * `cell` is `floor(anchor / L)`: an exact integer. At Forge (anchor about
 * 6e5 m) and the finest shipped octave (4.2 m) it is about 1.43e5, comfortably
 * inside float32's exact-integer range of 2^24 = 16,777,216, so it survives the
 * narrowing to a GPU float with zero error.
 *
 * `frac` is `anchor / L - cell`, in [0, 1). Narrowing that to float32 costs at
 * most half an ULP at 1.0, i.e. 2.98e-8 lattice cells, i.e. 1.25e-7 m at the
 * 4.2 m octave. That is 0.125 micrometres against a pixel footprint of
 * millimetres.
 */
export interface OctavePhase {
  readonly wavelengthM: number;
  /** floor(anchor / L). Exact integer, |value| < 2^24. */
  readonly cell: readonly [number, number, number];
  /** anchor / L - cell, in [0, 1). */
  readonly frac: readonly [number, number, number];
}

/** Floats per octave in the packed form: cell.xyz then frac.xyz. */
export const PHASE_FLOATS_PER_OCTAVE = 6;

/**
 * The exact-integer ceiling for `cell`. Above this a float32 cannot step by one
 * and the reduction silently stops being exact, so it is asserted rather than
 * assumed.
 */
export const F32_EXACT_INT_MAX = 16777216; // 2^24

/**
 * Reduce one axis. Split out because the exactness argument is per axis and is
 * easier to test that way.
 *
 * The division and the floor happen in float64 here and nowhere else. This is
 * the whole point of the module: a float32 cannot hold `anchor / L` with
 * sub-cell resolution at Forge's radius, because the integer part alone eats 18
 * of its 24 mantissa bits and leaves 6, which is one part in 64 of a cell,
 * which is the 0.0625 m quantum.
 */
function reduceAxis(anchorM: number, wavelengthM: number): [number, number] {
  const q = anchorM / wavelengthM;
  const cell = Math.floor(q);
  // `q - cell` is exact in float64 whenever |q| < 2^52, by Sterbenz: cell is
  // within a factor of two of q for all q outside [-1, 1), and for q in [-1, 1)
  // the subtraction is trivially exact. The float32 narrowing below is the only
  // error in the whole reduction.
  const frac = q - cell;
  return [cell, frac];
}

/** Reduce one anchor against one wavelength. */
export function reduceOctave(anchor: Vec3d, wavelengthM: number): OctavePhase {
  if (!(wavelengthM > 0) || !Number.isFinite(wavelengthM)) {
    throw new Error(`ChunkPhase: wavelength must be finite and positive, got ${wavelengthM}`);
  }
  const [cx, fx] = reduceAxis(anchor.x, wavelengthM);
  const [cy, fy] = reduceAxis(anchor.y, wavelengthM);
  const [cz, fz] = reduceAxis(anchor.z, wavelengthM);
  return { wavelengthM, cell: [cx, cy, cz], frac: [fx, fy, fz] };
}

/**
 * Reduce one anchor against every octave, into the flat float32 form the GPU
 * takes. Layout is `[cell.xyz, frac.xyz]` per octave, in the order given.
 *
 * The narrowing to Float32Array is deliberate and is where the ONLY error in
 * this module is incurred. Doing it here rather than leaving it to the upload
 * means `phaseError` below can quote the number that will actually be on the
 * GPU rather than the number we hoped for.
 */
export function packPhases(anchor: Vec3d, wavelengthsM: readonly number[]): Float32Array {
  const out = new Float32Array(wavelengthsM.length * PHASE_FLOATS_PER_OCTAVE);
  for (let k = 0; k < wavelengthsM.length; ++k) {
    const p = reduceOctave(anchor, wavelengthsM[k]);
    const o = k * PHASE_FLOATS_PER_OCTAVE;
    for (let a = 0; a < 3; ++a) {
      const c = p.cell[a];
      if (Math.abs(c) >= F32_EXACT_INT_MAX) {
        throw new Error(
          `ChunkPhase: lattice cell ${c} at wavelength ${p.wavelengthM} m exceeds float32's ` +
          `exact-integer range; the reduction would stop being exact. Use a longer octave.`,
        );
      }
      out[o + a] = c;
      out[o + 3 + a] = p.frac[a];
    }
  }
  return out;
}

/**
 * THE SHADER-SIDE CONTRACT, in one place, because a phase computed one way on
 * the CPU and consumed another way in a shader is exactly where a bit-exactness
 * guarantee gets quietly lost.
 *
 * Given the packed phase for an octave and a vertex's chunk-local offset
 * `rLocal` in metres (that is the `position` attribute, which is already
 * float32 relative to the anchor), the shader must form, per axis:
 *
 *   t = frac + rLocal / L          // small: |t| stays under about 12
 *   i = cell + floor(t)            // EXACT integer arithmetic in float32
 *   f = fract(t)                   // full float32 resolution
 *
 * and hash `i` (plus the unit corner offsets) exactly as it hashes
 * `floor(pM / L)` today, interpolating on `f`. `i` is what makes the field
 * global rather than tiled per chunk; `f` is what makes it resolvable.
 *
 * Two things follow that are worth stating because both are seam risks and
 * neither is obvious:
 *
 * 1. NEIGHBOURING CHUNKS AGREE. Two chunks reaching the same world point have
 *    different `cell`/`frac`/`rLocal` but the same `cell + t`, to within the
 *    float32 narrowing above. A disagreement of one ULP does not become a seam,
 *    because the value noise's smoothstep interpolant is C1: if the rounding
 *    puts `floor(t)` on opposite sides of a lattice plane, one chunk gets
 *    (i, f = 1 - eps) and the other (i + 1, f = eps'), and those interpolate to
 *    the same corner value. The discontinuity a naive scheme would produce is
 *    the one where the two chunks hash DIFFERENT cells for the same ground,
 *    which is what `cell` exists to prevent.
 *
 * 2. THE TWO SIDES OF AN LOD CROSS-DISSOLVE AGREE. DW-23 draws the outgoing
 *    parent and the incoming children in the same frame. Those are different
 *    anchors at different depths over the same ground, so a phase scheme that
 *    is merely self-consistent per chunk would turn every dissolve into a
 *    shimmer. This one agrees for the same reason (1) does: both reconstruct
 *    the same absolute lattice coordinate.
 *
 * `verifyReconstruction` below is the executable form of both claims.
 */
export const SHADER_CONTRACT_VERSION = 1;

/** Float32 rounding, i.e. exactly what the GPU will see. */
const f32 = Math.fround;

/**
 * Reconstruct the absolute lattice coordinate the shader will compute, using
 * float32 throughout, for one vertex of one chunk.
 *
 * This is the CPU mirror of the contract above and exists so the claims can be
 * measured rather than asserted. It deliberately rounds at every step, because
 * a mirror that keeps float64 intermediates would prove nothing.
 */
export function reconstructAxis(
  packed: Float32Array,
  octave: number,
  axis: number,
  rLocalM: number,
  wavelengthM: number,
): { cell: number; frac: number; q: number } {
  const o = octave * PHASE_FLOATS_PER_OCTAVE;
  const cell0 = packed[o + axis];
  const frac0 = packed[o + 3 + axis];
  const t = f32(frac0 + f32(f32(rLocalM) / f32(wavelengthM)));
  const cell = f32(cell0 + Math.floor(t));
  const frac = f32(t - Math.floor(t));
  return { cell, frac, q: cell + frac };
}

/**
 * The absolute lattice coordinate the shader computes TODAY, from planet-centred
 * metres in float32. Kept here so the two arithmetics can be compared in one
 * place and the improvement quoted as a ratio rather than as an adjective.
 */
export function reconstructAxisFromPm(absoluteM: number, wavelengthM: number): number {
  return f32(f32(absoluteM) / f32(wavelengthM));
}

/**
 * Worst-case error, in metres of ground, between the true absolute lattice
 * coordinate and what the shader will reconstruct, over a chunk of the given
 * local radius.
 *
 * Returned in METRES rather than in cells so it can be compared directly with a
 * pixel footprint, which is the only comparison that decides whether a screen
 * derivative survives.
 */
export function phaseError(
  anchor: Vec3d,
  wavelengthM: number,
  localRadiusM: number,
  samples = 4096,
): { maxErrM: number; maxErrCells: number } {
  const packed = packPhases(anchor, [wavelengthM]);
  let maxErrCells = 0;
  for (let i = 0; i < samples; ++i) {
    // Sweep the local offset across the whole chunk, both signs.
    const r = -localRadiusM + (2 * localRadiusM * i) / (samples - 1);
    const truth = (anchor.x + r) / wavelengthM;
    const got = reconstructAxis(packed, 0, 0, r, wavelengthM).q;
    const e = Math.abs(got - truth);
    if (e > maxErrCells) maxErrCells = e;
  }
  return { maxErrCells, maxErrM: maxErrCells * wavelengthM };
}

// ---------------------------------------------------------------------------
// WG-230. THE SHIPPED FORM: ONE PERIOD, ONE vec3, AND WHY IT IS NOT THE
// (cell, frac) PAIR ABOVE
// ---------------------------------------------------------------------------
// Everything above this line is WG-50's reduction and its shader contract,
// written in 2026-07-28 for a LATTICE consumer: a value-noise octave hashes an
// integer cell, so it needs `cell` to be globally correct or the field repeats.
// It has been correct and unconsumed ever since, because nothing shipped a
// path from it to the GPU.
//
// The consumer that finally needs it is not a lattice. It is the far-field
// SPLAT rung (TerrainSplat.ts's own note: "the real fix is not a shader change
// ... a per-chunk phase attribute reduced mod the tile period on the CPU in
// float64"), and a tiling texture fetch consumes only the FRACTIONAL part: a
// wrapping sampler never sees an integer cell index. So the shipped attribute
// is `frac` alone, one vec3, and `cell` stays available above for the day a
// lattice consumer wants it. Halving the attribute from six floats to three is
// not a micro-optimisation here: it is 3.74 MB of pooled vertex memory against
// a pool that retains 12.6 MB of blobs.
//
// THE ONE THING `frac` ALONE GIVES UP is that the reconstructed coordinate has
// a SUPER-PERIOD of PHASE_PERIOD_M. That is exactly why the period is a
// published constant with a divisibility rule rather than a free parameter:
// a consumer whose own period divides it sees no super-period at all, because
// its own tiling is a whole number of tiles inside the phase's.

/**
 * THE PHASE PERIOD, in metres. The reduction modulus, and the coarsest
 * world-locked wavelength any consumer of `aPhase` may use.
 *
 * IT IS A PRECISION BUDGET AND NOT A ROUND NUMBER. The shader forms
 * `t = aPhase + position / PHASE_PERIOD_M` in float32, so the quantum of the
 * reconstructed coordinate is `ulp(t) * PHASE_PERIOD_M`, i.e. the period
 * divided by about 2^23. Doubling the period doubles the quantum everywhere.
 * 256 m puts the quantum at 30.5 um for every chunk whose own half-extent is
 * under the period, which is every chunk resident inside about 600 m -- the
 * whole of the band phase 2 exists for -- against `pM`'s 31.25 mm there.
 *
 * THE OTHER END OF THE TRADE is that 256 m is the coarsest world-locked field
 * a consumer can build on this attribute. An anti-tiling term wanting a
 * kilometre-scale wavelength needs a SECOND reduction at that period, not a
 * larger value here, because enlarging this one costs near-field precision
 * linearly and the near field is where the quantum is already tightest against
 * a 3.56 mm pixel footprint.
 */
export const PHASE_PERIOD_M = 256;

/**
 * True when `periodM` divides PHASE_PERIOD_M a whole number of times.
 *
 * THIS IS THE SEAM RULE AND IT IS THE ONLY ONE. Two chunks reaching the same
 * ground reconstruct coordinates that differ by an exact INTEGER (each is the
 * true coordinate in period units minus that chunk's own whole-period count),
 * so `fract(t * n)` agrees between them for integer `n` and disagrees for any
 * other. A consumer that picks 3.0 m out of a 256 m period draws a visible
 * line along every chunk boundary in the frame, and it draws it only at range,
 * where the boundaries are far apart and the cause is least obvious.
 */
export function phasePeriodDivides(periodM: number): boolean {
  if (!(periodM > 0) || !Number.isFinite(periodM)) return false;
  return Number.isInteger(PHASE_PERIOD_M / periodM);
}

/**
 * The seam rule as a throw. Consumers call this at module load with their own
 * tile metres, so a bad period is a boot failure and not a hairline seam
 * someone notices in a screenshot three lanes later.
 */
export function assertPhasePeriod(periodM: number, who: string): number {
  if (!phasePeriodDivides(periodM)) {
    throw new Error(`ChunkPhase: ${who} wants a ${periodM} m world period, which does not `
      + `divide PHASE_PERIOD_M (${PHASE_PERIOD_M} m) a whole number of times. `
      + 'Chunk edges would disagree and the term would draw a line along every one.');
  }
  return PHASE_PERIOD_M / periodM;
}

/**
 * Reduce one chunk anchor into the shipped attribute: `frac(anchor / P)` per
 * axis, in [0, 1), narrowed to float32.
 *
 * The division, the floor and the subtraction all happen in float64, which is
 * the entire point of the module and the one thing a shader cannot do. The
 * float32 narrowing at the end is the ONLY error introduced, and it is at most
 * half an ULP at 1.0, i.e. 2.98e-8 periods, i.e. 7.6 micrometres of ground at
 * a 256 m period -- a quarter of the 30.5 um quantum the shader's own
 * arithmetic then costs, so it is not the binding term.
 */
export function reduceAnchorPhase(anchor: Vec3d): [number, number, number] {
  return [
    f32(reduceAxis(anchor.x, PHASE_PERIOD_M)[1]),
    f32(reduceAxis(anchor.y, PHASE_PERIOD_M)[1]),
    f32(reduceAxis(anchor.z, PHASE_PERIOD_M)[1]),
  ];
}

/**
 * The quantum, in METRES of ground, of the coordinate the shader reconstructs
 * from this attribute over a chunk of the given local radius. Published as a
 * function rather than as a table because it is the number that decides
 * whether a screen derivative survives, and a table would be a second
 * authority on it.
 *
 * `t = frac + localRadius / P` and float32 carries 24 mantissa bits, so the
 * quantum is `2^(floor(log2 |t|) - 23) * P`. Compare it against a pixel
 * footprint, never against a wavelength: WG-51 measured that the VALUE of a
 * field survives quantisation that destroys its DERIVATIVE.
 */
export function phaseQuantumM(localRadiusM: number): number {
  const t = 1 + Math.abs(localRadiusM) / PHASE_PERIOD_M;
  return 2 ** (Math.floor(Math.log2(t)) - 23) * PHASE_PERIOD_M;
}

/**
 * The two seam claims, executable.
 *
 * Takes two anchors and, for a set of world points reachable from both,
 * compares the lattice coordinate each chunk reconstructs. Use it for
 * neighbouring chunks at one depth AND for a parent/child pair across an LOD
 * step, which are the two cases DW-23 puts on screen at the same time.
 */
export function verifyReconstruction(
  anchorA: Vec3d,
  anchorB: Vec3d,
  worldXs: readonly number[],
  wavelengthM: number,
): { maxDisagreeCells: number; maxDisagreeM: number; cellIndexMismatches: number } {
  const pa = packPhases(anchorA, [wavelengthM]);
  const pb = packPhases(anchorB, [wavelengthM]);
  let maxDisagreeCells = 0;
  let cellIndexMismatches = 0;
  for (const x of worldXs) {
    const ra = f32(x - anchorA.x);
    const rb = f32(x - anchorB.x);
    const a = reconstructAxis(pa, 0, 0, ra, wavelengthM);
    const b = reconstructAxis(pb, 0, 0, rb, wavelengthM);
    const d = Math.abs(a.q - b.q);
    if (d > maxDisagreeCells) maxDisagreeCells = d;
    if (a.cell !== b.cell) cellIndexMismatches++;
  }
  return {
    maxDisagreeCells,
    maxDisagreeM: maxDisagreeCells * wavelengthM,
    cellIndexMismatches,
  };
}
