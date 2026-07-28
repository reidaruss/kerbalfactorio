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
    const d = Math.hypot(m[12] - scratch.x, m[13] - scratch.y, m[14] - scratch.z);
    if (d > 0) out.stale++;
    if (d > out.maxM) { out.maxM = d; out.worst = p.id; }
  }
  return out;
}
