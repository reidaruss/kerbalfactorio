// WG-52: assertions on the per-chunk noise phase.
//
// `artphase.ts` shows the defect and the cure in pictures and in one statistic.
// This file is the part that has to keep being true: the seam proofs, the LOD
// cross-dissolve proof, and the headroom bound, written as CHECKS that fail by
// name rather than as numbers printed into a log.
//
// Standing rule 11's corollary: a probe that reports a number without asserting
// anything about it is a log line, not a test. Five belt probes stayed green
// while belt capacity changed by 40x.
//
// Run: node --experimental-strip-types web/tools/precision/phasecheck.ts
// Exit code is non-zero if any check fails.

import {
  packPhases, reduceOctave, reconstructAxis, phaseError, verifyReconstruction,
  F32_EXACT_INT_MAX, PHASE_FLOATS_PER_OCTAVE,
} from '../../src/world/ChunkPhase.ts';

const R_BODY = 600_000;
/** The shipped octave ladder. TerrainArt.glsl.ts:121-123 and :258. */
const WAVELENGTHS = [186.0, 47.5, 11.9, 4.2];
/** DW-19: depth 14 is 1.808 m spacing on a 33x33 grid. */
const CHUNK_D14 = 1.808 * 32;
const CHUNK_D13 = CHUNK_D14 * 2;
/** The pixel footprint of the ground at 2 m, from artphase.ts. Everything below
 *  is compared against this, because it is the only bar that matters: an error
 *  under a pixel cannot become a visible artefact. */
const PIXEL_FOOTPRINT_M = 0.00356;

let failed = 0, checks = 0;
function check(name: string, ok: boolean, detail: string): void {
  checks++;
  if (!ok) { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  ok    ${name}  ${detail}`);
}

// A generic body-frame position: not axis-aligned, so all three components sit
// at 1e5 scale, which is where a player actually stands.
const DIR = (() => {
  const v = [0.5137, 0.6221, 0.5913];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
const P0 = { x: DIR[0] * R_BODY, y: DIR[1] * R_BODY, z: DIR[2] * R_BODY };
const snap = (v: number, g: number) => (Math.floor(v / g) + 0.5) * g;

console.log('WG-52 per-chunk noise phase: assertions');
console.log('');

// ---------------------------------------------------------------------------
console.log(' 1. the reduction is exact where it claims to be');
// ---------------------------------------------------------------------------
for (const L of WAVELENGTHS) {
  const p = reduceOctave(P0, L);
  for (let a = 0; a < 3; ++a) {
    const c = p.cell[a], f = p.frac[a];
    // The float64 identity that the whole scheme rests on.
    const rebuilt = c + f;
    const want = [P0.x, P0.y, P0.z][a] / L;
    check(`L=${L} axis${a} cell+frac reconstructs anchor/L exactly`,
      rebuilt === want, `${rebuilt} vs ${want}`);
    check(`L=${L} axis${a} frac in [0,1)`, f >= 0 && f < 1, `${f}`);
    check(`L=${L} axis${a} cell survives float32 exactly`,
      Math.fround(c) === c && Math.abs(c) < F32_EXACT_INT_MAX,
      `cell ${c}, headroom ${(F32_EXACT_INT_MAX / Math.abs(c)).toFixed(1)}x`);
  }
}
console.log('');

// ---------------------------------------------------------------------------
console.log(' 2. reconstruction error is far below one pixel of ground');
// ---------------------------------------------------------------------------
for (const L of WAVELENGTHS) {
  // Half a chunk diagonal is the worst local offset a vertex can have.
  const rMax = (CHUNK_D14 * Math.SQRT2) / 2;
  const e = phaseError(P0, L, rMax);
  check(`L=${L} max reconstruction error under a pixel footprint`,
    e.maxErrM < PIXEL_FOOTPRINT_M,
    `${(e.maxErrM * 1e6).toFixed(3)} um, i.e. 1/${Math.round(PIXEL_FOOTPRINT_M / e.maxErrM)} of a pixel`);
}
// And the same measurement on what the shader does TODAY, which is the control:
// the number it has to beat, on the same instrument.
{
  const L = 4.2;
  const f32 = Math.fround;
  let worst = 0;
  for (let i = 0; i < 4096; ++i) {
    const x = P0.x - 40 + (80 * i) / 4095;
    const got = f32(f32(x) / f32(L));
    worst = Math.max(worst, Math.abs(got - x / L) * L);
  }
  check('CONTROL: today\'s pM arithmetic is WORSE than a pixel footprint',
    worst > PIXEL_FOOTPRINT_M,
    `${(worst * 1000).toFixed(2)} mm, i.e. ${(worst / PIXEL_FOOTPRINT_M).toFixed(1)} pixels`);
}
console.log('');

// ---------------------------------------------------------------------------
console.log(' 3. neighbouring chunks agree on the shared edge (the seam proof)');
// ---------------------------------------------------------------------------
{
  // Two chunks side by side at depth 14. Sample the shared edge densely.
  const aX = snap(P0.x, CHUNK_D14);
  const bX = aX + CHUNK_D14;
  const edgeX = (aX + bX) / 2;   // the shared boundary plane
  const xs: number[] = [];
  for (let i = 0; i < 2048; ++i) xs.push(edgeX + (i - 1024) * 1e-4);
  for (const L of WAVELENGTHS) {
    const r = verifyReconstruction({ ...P0, x: aX }, { ...P0, x: bX }, xs, L);
    check(`L=${L} neighbour chunks agree to under a pixel`,
      r.maxDisagreeM < PIXEL_FOOTPRINT_M,
      `max ${(r.maxDisagreeM * 1e6).toFixed(3)} um, cell-index splits ` +
      `${r.cellIndexMismatches}/${xs.length}`);
  }
}
console.log('');

// ---------------------------------------------------------------------------
console.log(' 4. an LOD cross-dissolve draws the same ground (DW-23)');
// ---------------------------------------------------------------------------
{
  // DW-23 keeps the outgoing PARENT resident while the children arrive, so both
  // are on screen in the same frame. Different anchors, different depths, same
  // ground. A phase scheme that is merely self-consistent per chunk would turn
  // every dissolve into a shimmer, and no per-chunk test would see it.
  const parentX = snap(P0.x, CHUNK_D13);
  const childX = snap(P0.x, CHUNK_D14);
  check('the parent and child anchors genuinely differ',
    parentX !== childX, `${parentX} vs ${childX} (delta ${(parentX - childX).toFixed(3)} m)`);
  const xs: number[] = [];
  for (let i = 0; i < 2048; ++i) xs.push(P0.x - 20 + (40 * i) / 2047);
  for (const L of WAVELENGTHS) {
    const r = verifyReconstruction({ ...P0, x: parentX }, { ...P0, x: childX }, xs, L);
    check(`L=${L} parent and child agree to under a pixel`,
      r.maxDisagreeM < PIXEL_FOOTPRINT_M,
      `max ${(r.maxDisagreeM * 1e6).toFixed(3)} um, cell-index splits ` +
      `${r.cellIndexMismatches}/${xs.length}`);
  }
}
console.log('');

// ---------------------------------------------------------------------------
console.log(' 4b. a cell-index SPLIT is provoked on purpose and is harmless');
// ---------------------------------------------------------------------------
{
  // Sections 3 and 4 both reported 0 cell-index splits over 8,192 samples, so
  // the claim that a split is harmless was reasoning and not measurement. A
  // control that never encounters the case it excuses is not a control.
  //
  // Land samples exactly on lattice planes, where the two chunks' float32
  // rounding can genuinely disagree about which side they are on, and assert
  // that the reconstructed coordinate still agrees. It has to: the two answers
  // are (i, 1 - eps) and (i + 1, eps'), which a C1 interpolant maps to the same
  // corner value.
  const aX = snap(P0.x, CHUNK_D14);
  const bX = aX + CHUNK_D14;
  let provoked = 0, worstM = 0;
  for (const L of WAVELENGTHS) {
    const xs: number[] = [];
    // Walk lattice planes across both chunks and sit on them to the ULP.
    for (let c = -14; c <= 14; ++c) {
      const plane = (Math.floor(P0.x / L) + c) * L;
      for (let d = -3; d <= 3; ++d) xs.push(plane + d * Number.EPSILON * plane);
    }
    const r = verifyReconstruction({ ...P0, x: aX }, { ...P0, x: bX }, xs, L);
    provoked += r.cellIndexMismatches;
    worstM = Math.max(worstM, r.maxDisagreeM);
  }
  check('lattice-plane samples do provoke cell-index splits',
    provoked > 0, `${provoked} splits provoked across the ladder`);
  check('and the reconstructed coordinate still agrees under a pixel',
    worstM < PIXEL_FOOTPRINT_M, `max ${(worstM * 1e6).toFixed(3)} um`);
}
console.log('');

// ---------------------------------------------------------------------------
console.log(' 5. the packed form is what the GPU will actually receive');
// ---------------------------------------------------------------------------
{
  const packed = packPhases(P0, WAVELENGTHS);
  check('packed length', packed.length === WAVELENGTHS.length * PHASE_FLOATS_PER_OCTAVE,
    `${packed.length} floats for ${WAVELENGTHS.length} octaves`);
  check('packed is float32', packed instanceof Float32Array, 'Float32Array');
  // Reconstructing at rLocal = 0 must land back on the anchor's own cell.
  let worstCell = 0;
  for (let k = 0; k < WAVELENGTHS.length; ++k) {
    const p = reduceOctave(P0, WAVELENGTHS[k]);
    for (let a = 0; a < 3; ++a) {
      const r = reconstructAxis(packed, k, a, 0, WAVELENGTHS[k]);
      if (r.cell !== p.cell[a]) worstCell++;
    }
  }
  check('rLocal = 0 reconstructs the anchor cell on every axis and octave',
    worstCell === 0, `${worstCell} mismatches of ${WAVELENGTHS.length * 3}`);
}
console.log('');

// ---------------------------------------------------------------------------
console.log(' 6. the headroom bound is real and it BITES when it should');
// ---------------------------------------------------------------------------
{
  // A negative control on the guard itself. An octave short enough to overflow
  // float32's exact-integer range must be REFUSED, not silently accepted.
  let threw = false;
  try { packPhases({ x: 1e9, y: 0, z: 0 }, [0.01]); } catch { threw = true; }
  check('an octave that overflows exact-integer float32 is refused',
    threw, 'packPhases threw as designed');
  let ok = true;
  try { packPhases(P0, WAVELENGTHS); } catch { ok = false; }
  check('the shipped ladder at Forge is accepted', ok, 'no throw');
}

console.log('');
console.log(`  ${checks - failed} / ${checks} checks pass`);
if (failed) { console.log(`  ${failed} FAILED`); process.exit(1); }
