// THE PER-TICK TRACES, AND THE TWO STEP LADDERS THEY ARE READ AGAINST
// (GP-1075, split out of DebugGameplay.ts under the 400-line cap).
//
// One concern, stated by `stand`'s own docstring: a frame carries one to three
// fixed ticks, so anything that alternates WITHIN a frame is aliased away
// before a per-frame report can see it. `stand` and `dragTrace` are the two
// instruments that record every tick instead, and the two step constants ride
// with them because they are the numbers a trace's rungs are bounded by; a
// probe reciting 0.55 back at itself would agree with itself whatever the
// walker did.
//
// The `stand` docblock leads this file exactly where it led in the original,
// ahead of the two constants rather than ahead of its own method. That is
// verbatim on purpose (BT-276 rule 2): this split moves lines, it does not
// tidy them.
import { STRUCTURE_STEP_UP_M, VOXEL_STEP_UP_M } from '../player/VoxelCollision.js';
import { StandTrace } from '../player/StandTrace.js';
import type { Services } from './Services.js';

export function tracesApi(s: Services) {
  return {
    /**
     * The per-TICK standing trace (player/StandTrace.ts). `stand(true)` arms and
     * clears it, `stand()` dumps it oldest-first, `stand(false)` disarms.
     *
     * It lives on the gameplay surface because the question it answers is a
     * gameplay one: WHICH of the terrain and the base is holding the player up
     * this tick. `world().player` reports the answer once per FRAME, and a frame
     * carries one to three fixed ticks, so anything that alternates is aliased
     * away before a probe can see it.
     */
    /** The structural step ladder, so a probe can assert the rung that gets a
     *  player onto their own foundation still clears the shipped deck rather
     *  than reciting 0.55 back at itself. */
    stepUpM: STRUCTURE_STEP_UP_M,

    /** The VOXEL step ladder, deliberately a second name for a second ladder
     *  (see VoxelCollision.ts). A probe bounding the lift a tunnel floor query
     *  is allowed to apply reads its first rung from here rather than reciting
     *  0.55, so retuning the walker retunes the assertion with it. */
    voxelStepUpM: VOXEL_STEP_UP_M,

    /**
     * FS-99. The per-TICK machine-drag decision trace (game/DragTrace.ts).
     * `dragTrace(true)` arms and clears it, `dragTrace()` dumps it oldest-first
     * as one diffable line per tick, `dragTrace(false)` disarms.
     *
     * It answers the question a tile count cannot: WHICH of a drag's several
     * hundred per-tick choices differed between two same-seed runs. `lines` is
     * what a probe writes to a file and diffs; `samples` is the same data for a
     * probe that wants to assert on a field.
     */
    dragTrace(on?: boolean) {
      const b = s.gameplay?.build;
      if (b === undefined) return null;
      const t = b.dragTrace(on);
      return { armed: t !== null, total: t?.total ?? 0,
        lines: t?.lines() ?? [], samples: t?.dump() ?? [] };
    },

    stand(on?: boolean) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      if (on === false) { b.trace = null; return { armed: false, samples: [] }; }
      if (on === true) {
        if (b.trace === null) b.trace = new StandTrace();
        b.trace.reset();
      }
      const t = b.trace;
      return { armed: t !== null, total: t?.total ?? 0, samples: t?.dump() ?? [] };
    },
  };
}
