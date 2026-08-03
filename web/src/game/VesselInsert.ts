// =============================================================================
// VesselInsert.ts - PUTTING A PART INTO THE MIDDLE OF A STACK. (GP-293.)
//
// Reid's oldest open complaint, and it took three passes to find because the
// symptom and the cause do not resemble each other. He said two things,
// "snapping is broken" and "you can only build bottom-up", and GP-290 found
// they are one mechanism: `attachNodes` omits a face the moment something is
// attached to it, so A JOINT BETWEEN TWO PARTS IS NOT A PLACE. Aim at the seam
// and nothing happens because there is nothing there, and every revision means
// deleting back to the joint, which `of_vs_remove` does by taking the whole
// subtree with it.
//
// It is directly in the way of the feature he asked for: the Autopilot Module
// is a class-S STACK part, so fitting one to a rocket that already exists is
// exactly the revision the bay could not represent.
//
// -----------------------------------------------------------------------------
// WHY THIS NEEDS NOTHING FROM PHYSICS, WHICH IS THE WHOLE REASON IT IS HERE.
//
// A design is a FLAT ARRAY whose `parent` is an INDEX into itself, and
// `VesselDesign.fromJson` rebuilds one by walking it in order. GP-148 already
// leaned on that for the re-root rebuild. So inserting is not surgery on a live
// tree, it is a SPLICE of an array followed by the rebuild that already exists:
// no `of_vs_reparent`, no ABI bump, and no waiting on a lane that is live in
// `transfer.h` and `docking.h` tonight.
//
// The whole operation is three edits and an index remap:
//
//   1. the arriving part X takes B's parent and B's attach, so it occupies the
//      face B was on;
//   2. B's parent becomes X, and B KEEPS its attach, because a part hanging
//      under A now hangs under X in the same sense;
//   3. X is spliced in BEFORE B, because `fromJson` looks its parent up in the
//      handles it has already built and a child may never precede its parent.
//
// Then every `parent` at or past the splice shifts by one, and so does every
// index in every stage group. THAT REMAP IS THE PART THAT WILL BITE: the stage
// lists are indices into the same array, they are easy to forget, and forgetting
// them does not throw. It moves a part into the wrong stage, which looks like a
// staging bug three screens away from here.
// -----------------------------------------------------------------------------
import { ATTACH_RADIAL } from '../sim/wasm/vesselabi.js';
import type { DesignJson } from './VesselDesign.js';

export interface InsertResult {
  /** The spliced design, or null when the insert was refused. */
  design: DesignJson | null;
  /** '' on success. Otherwise WHY NOT, as a sentence the bay prints verbatim.
   *  Never a code: the bay has no branch on it, it only shows it. */
  why: string;
  /** Where X landed, so a caller can select it. -1 on refusal. */
  index: number;
}

/**
 * Splice `partId` into the joint that `childIndex` currently occupies.
 *
 * `childIndex` is the part SITTING ON the joint, not the part below it: a
 * player aiming at the seam between a pod and a tank is pointing at the tank's
 * own mating face, and that face is the thing being moved down.
 *
 * REFUSES RATHER THAN GUESSES, in every case it cannot do exactly. Each refusal
 * is a sentence rather than a code because there is no branch anywhere that
 * reads it; the bay draws it and the player acts on it.
 */
export function insertAt(d: DesignJson, childIndex: number,
                         partId: number): InsertResult {
  const no = (why: string): InsertResult => ({ design: null, why, index: -1 });
  const rows = d.parts ?? [];
  const b = rows[childIndex];
  if (b === undefined) return no('there is no part at that joint.');
  if (b.parent < 0) {
    // The root has no joint ABOVE it in this vocabulary: it is the part
    // everything else hangs from, and putting something between it and nothing
    // is not an insert, it is a new root. GP-148 normalised the root to the top
    // of the stack, so this is the nose cone's own face and it is genuinely
    // free: the ordinary attach path already offers it.
    return no('that is the top of the stack, so nothing is between it and '
      + 'anything. Attach to its free face instead.');
  }
  if (b.a === ATTACH_RADIAL) {
    // A RADIAL JOINT IS NOT A STACK JOINT and the two are not one case. A
    // strap-on carries an angle and a height up its parent, and splicing a
    // stack part into that seam would have to decide what those mean for the
    // arriving part. Refused rather than approximated, because a wrong answer
    // here moves a booster and the player would have to find out by looking.
    return no('that is a radial mount. A part can be inserted into a stack '
      + 'joint; a strap-on is attached to its pylon rather than stacked.');
  }
  // A CHILD MAY NEVER PRECEDE ITS PARENT, because `fromJson` resolves a parent
  // out of the handles it has already built. The splice puts X at `childIndex`,
  // so B's parent has to be strictly before that. Asserted rather than assumed:
  // the part order comes from /core and this file does not own it.
  if (b.parent >= childIndex) {
    return no('this design is stored with a part before its own parent, which '
      + 'the rebuild cannot walk. Refusing rather than reordering it here.');
  }

  const shift = (i: number): number => (i >= childIndex ? i + 1 : i);
  const x = { p: partId, parent: b.parent, a: b.a, ang: 0, off: 0, st: b.st };
  const out: DesignJson['parts'] = [];
  for (let i = 0; i < rows.length; ++i) {
    if (i === childIndex) out.push(x);
    const r = rows[i];
    if (r === undefined) continue;
    out.push({
      ...r,
      // B alone changes parent: it now hangs from X. Everything else keeps the
      // parent it had, shifted.
      parent: i === childIndex ? childIndex : (r.parent < 0 ? -1 : shift(r.parent)),
    });
  }
  return {
    design: {
      ...d,
      parts: out,
      // THE STAGE LISTS ARE INDICES INTO THE SAME ARRAY. Forgetting this does
      // not throw; it silently moves parts between stages, and the symptom
      // appears on the pad as a rocket that drops the wrong half.
      stages: (d.stages ?? []).map((s) => ({
        act: (s.act ?? []).map(shift),
        dec: (s.dec ?? []).map(shift),
      })),
    },
    why: '',
    index: childIndex,
  };
}
