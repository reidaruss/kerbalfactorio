// THE TWO LATTICES AND THE COLLIDER OVER THEM (GP-1075, split out of
// DebugGameplay.ts under the 400-line cap).
//
// `snapCell` is where a machine actually lands, `latticeCell` is /core's own
// 1 m voxel grid that machines used to use, and the pair exists so the claim
// behind that change stays measurable rather than remembered. `door` and
// `solidBuild` sit with them because they are the same question one level up:
// having snapped a part onto the grid, is the point in front of the player
// solid, and does the doorway open. All four speak body-frame metres and none
// of them moves the player.
import { snapToGround } from '../game/Grid.js';
import type { Services } from './Services.js';

export function gridApi(s: Services) {
  return {
    /**
     * Snap a body-frame point exactly as a MACHINE placement does: the metric
     * site grid, then back onto the ground (GP-27). This is the number a belt
     * run is laid on, so measuring it is measuring the alignment itself.
     *
     * READ THIS BEFORE MEASURING WITH IT. Until a site has been ADOPTED, every
     * call founds a prospective one on the lattice cell it was handed, so two
     * calls a metre apart land in two different frames and it reproduces the
     * voxel lattice's own uneven steps. Place something first, or use
     * `latticeCell` if the lattice is what you actually wanted.
     */
    snapCell(x: number, y: number, z: number) {
      const f = s.gameplay?.factory;
      if (f === undefined) return null;
      const p = f.snap(x, y, z);
      return [p.pos.x, p.pos.y, p.pos.z];
    },

    /**
     * Snap to /core's own 1 m VOXEL lattice, which is what machines used to use.
     *
     * Kept precisely so the claim behind the change stays measurable: one unit
     * step of a cell key covers 0.59 to 1.02 m of ground depending on the axis,
     * because a body-frame cube grid is cut obliquely by the ground sphere. The
     * acceptance measures both and reports the difference.
     */
    latticeCell(x: number, y: number, z: number) {
      const f = s.gameplay?.factory;
      if (f === undefined) return null;
      const p = snapToGround(s.core, f.bodyHandle,
        s.voxels?.handle ?? 0, x, y, z);
      return [p.pos.x, p.pos.y, p.pos.z];
    },

    /**
     * Open or shut a placed door by part id, through the SAME toggle the E key
     * reaches. A probe that set `wantOpen` directly would be proving a path no
     * player can take.
     */
    door(id: number, open?: boolean) {
      const st = s.gameplay?.structures;
      const p = st?.parts.find((q) => q.id === id);
      if (st === undefined || p === undefined) return null;
      if (open === undefined || open !== p.wantOpen) st.toggle(p);
      return { id, kind: p.kind, wantOpen: p.wantOpen, swing: p.swing,
        shut: p.solid.shut };
    },

    /**
     * Is this body-frame point inside a structural collider? This is the exact
     * predicate the walker uses, so a probe asserting that a doorway is open is
     * asserting about the collision the player will actually meet, not about a
     * parallel test written in the probe.
     */
    solidBuild(x: number, y: number, z: number) {
      return s.gameplay?.structures.bodies.blocks(x, y, z) ?? false;
    },
  };
}
