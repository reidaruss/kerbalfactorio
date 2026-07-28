// FS-89: IS THE FACTORY DRAWN WHERE IT ACTUALLY IS?
//
// One measurement, in its own file, and the reason it is not a method on
// `FactoryView` is not the line cap that forced the move. `FactoryView` decides
// WHERE to draw things; this asks whether that decision survived contact with a
// floating-origin rebase. A check that lives inside the thing it checks tends to
// be written out of the same assumptions, and this one specifically must not be:
// it reads the matrix the `BatchedMesh` will really draw with rather than
// anything this codebase recomputed on the way there.

import type * as THREE from 'three';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Factory } from './Factory.js';

/** Just enough of `MachineBatch` to read back a drawn transform. Narrow on
 *  purpose: a wider parameter would let this file start drawing. */
export interface DrawnMatrices { matrixAt(slot: number): number[] | null }

/**
 * FS-89: HOW FAR IS EACH BUILDING FROM WHERE IT IS ACTUALLY DRAWN, in metres.
   *
 * THE INSTRUMENT IS A SUBTRACTION, NOT A PICTURE, and that is the whole reason
 * it can be trusted. The world-gen lane proved that every scattered prop was
 * left behind by the full rebase delta on a floating-origin rebase: measured
 * at 4,000.089191 m across 43 of 43 chunks, decaying over about ten seconds
 * rather than snapping back, because a chunk was only re-placed when it
 * happened to be rebuilt. At four kilometres a detached building is not a
 * wrong-looking building, it is an ABSENT one, and "the base vanished" is
 * equally consistent with a pool refusal, a streaming stall and a culling bug.
 * A distance between two positions reads non-zero for exactly one reason, and
 * its magnitude names the delta.
   *
 * THE CORRECT VALUE IS A HARD ZERO, NOT A TOLERANCE. The drawn matrix was
 * written by `sync` through `origin.toEngine`, and this recomputes it through
 * that same f64 `toEngine` from the same body-frame `pos`, so a building in
 * step is bit-identical and anything else is a real defect. There is no band
 * to tune and therefore nothing to quietly tune it to.
   *
 * IT READS THE MATRIX THE BatchedMesh WILL ACTUALLY DRAW WITH, through
 * `MachineBatch.matrixAt`, rather than a mirror of this file's own decision.
 * A check that recomputed what `sync` computes would agree with `sync` by
 * construction and could never fail, which is standing rule 11's whole point
 * and the reason FS-40's probes read the same surface.
   *
 * IT COSTS NOTHING PER FRAME because nothing calls it per frame: it is a
 * report surface, read by `probes/factoryrebase.js`, and reading a report
 * advances no frames. That matters more than it sounds: any frame a probe
 * runs lets a stale state heal before it can be measured, which is why the
 * scatter lane had to solve local noon with calls that advance zero frames.
 */
export function stalenessOf(f: Factory | null,
                            slots: ReadonlyMap<number, number>,
                            batch: DrawnMatrices,
                            origin: FloatingOrigin,
                            scratch: THREE.Vector3):
{ maxM: number; stale: number; drawn: number; worst: number } {
  const out = { maxM: 0, stale: 0, drawn: 0, worst: -1 };
  if (f === null) return out;
  for (const p of f.placed) {
    const slot = slots.get(p.id);
    if (slot === undefined) continue;
    const m = batch.matrixAt(slot);
    if (m === null) continue;
    out.drawn++;
    origin.toEngine(p.pos, scratch);
    // FS-91: ROUND THE EXPECTATION THE WAY THE GPU ROUNDED THE REALITY.
    //
    // `matrixAt` reads back out of a `BatchedMesh`, which stores instance
    // matrices as FLOAT32 because they are on their way to the GPU, and
    // `toEngine` composes in f64. Differencing the two directly measures the
    // narrowing as well as the staleness, and FS-89 accommodated that with a
    // bound derived from four float32 ULP at the engine magnitude.
    //
    // THE ACCOMMODATION WAS PRINCIPLED AND THIS IS BETTER, and it came from the
    // physics lane hitting the identical thing on a launch pad: 1e-6 m at 137 m,
    // 4e-6 at 244 m and 6e-6 at 367 m, which is 2^-23 times the distance and is
    // therefore not a leak. `Math.fround` narrows the expectation through the
    // same single-precision step the stored matrix already went through, so the
    // two agree BIT FOR BIT and the correct answer is a hard 0 again.
    //
    // A HARD ZERO THAT STAYS HARD AT ANY DISTANCE IS WORTH MORE THAN A DERIVED
    // TOLERANCE, and the reason is not tidiness. The ULP floor grew with the
    // rebase threshold, so at the shipped 4 km it was 1.9e-3 m: still seven
    // orders below a detachment, and still a number that has to be recomputed
    // and re-argued every time the threshold moves. This one never moves.
    const d = Math.hypot(m[12] - Math.fround(scratch.x),
      m[13] - Math.fround(scratch.y), m[14] - Math.fround(scratch.z));
    if (d > 0) out.stale++;
    if (d > out.maxM) { out.maxM = d; out.worst = p.id; }
  }
  return out;
}
