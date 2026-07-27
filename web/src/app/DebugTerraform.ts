// The voxel and terraforming half of window.__of, split out when the levelling
// tool landed and Debug.ts crossed the 400-line cap.
//
// EVERY ENTRY HERE GOES THROUGH THE PLAYER'S OWN PATH. `dig()` and `level()` are
// the same handlers the E and Q keys reach on the fixed tick, only with the
// cooldown skipped, so a probe cannot drive a path a player has no access to.
//
// Standing rule 1 shows up in what these REPORT as much as in what they do:
// every count comes from /core (`removedCount`, `addedCount`), never from a JS
// tally, because a browser holding an edit set the simulation does not is the
// exact disagreement the whole surface-authority discipline exists to prevent.

import type { Services } from './Services.js';
import { LEVEL } from '../player/LevelAction.js';

export function terraformApi(s: Services) {
  return {
    dig() {
      const p = s.player;
      if (p === null || s.dig === null) return null;
      const ray = p.aimRay();
      const r = s.dig.digOnce(ray.origin, ray.dir);
      return { ...r, aim: { origin: ray.origin, dir: ray.dir } };
    },

    /**
     * Level once along the current aim ray, ignoring the cooldown. The target
     * defaults to the ground under the player's FEET, which is the tool's own
     * rule ("stand where you want the floor"); passing one is how a probe levels
     * to a height it chose.
     */
    level(targetHeightM?: number) {
      const p = s.player;
      if (p === null || s.level === null) return null;
      const feet = p.body.feet;
      const r = Math.hypot(feet.x, feet.y, feet.z) || 1;
      const under = s.oracle.surfaceHeight(feet.x / r, feet.y / r, feet.z / r);
      const ray = p.aimRay();
      // `feet` is passed for the same reason the tick path passes it: the disc
      // falls back to the ground underfoot when the aim ray finds none, and a
      // probe that skipped that argument would be driving a path the Q key
      // cannot reach (WG-23).
      const res = s.level.levelOnce(ray.origin, ray.dir, targetHeightM ?? under, feet);
      return res === null ? null : {
        ...res, feetHeightM: under, aim: { origin: ray.origin, dir: ray.dir },
      };
    },

    /** WG-22 terraforming state: the tool's counters and the footprint decal. */
    terraform() {
      if (s.voxels === null || s.level === null) return null;
      return {
        removedCells: s.voxels.removedCount(),
        addedCells: s.voxels.addedCount(),
        ops: s.voxels.ops.length,
        action: s.level.stats,
        ring: s.levelRing?.stats ?? null,
        // The tool's own geometry, so a probe stops keeping a COPY of it. A
        // negative control sized from a remembered radius silently stops being
        // a control the moment the tool is retuned, which is exactly what
        // WG-27's widening did to probes/level.js. The furthest a press can
        // reach from the player is reachM + radiusM, and a control ring has to
        // be outside that or it is measuring its own subject.
        limits: {
          reachM: LEVEL.reachM, radiusM: LEVEL.radiusM,
          maxCutM: LEVEL.maxCutM, maxFillM: LEVEL.maxFillM,
          maxReachFromPlayerM: LEVEL.reachM + LEVEL.radiusM,
        },
        // sent != applied means an edit never reached the heightfield, so the
        // voxel layer and the surface would silently disagree.
        mouth: { sent: s.terrain.digsSent, applied: s.terrain.digsApplied },
      };
    },

    voxels() {
      if (s.voxels === null || s.voxelMesh === null || s.dig === null) return null;
      return {
        removedCells: s.voxels.removedCount(),
        addedCells: s.voxels.addedCount(),
        harvestedM3: s.dig.stats.volumeM3,
        ops: s.voxels.ops.length,
        action: s.dig.stats,
        mesh: s.voxelMesh.stats,
        meshVisible: s.voxelMesh.mesh.visible,
        // Strike debris, so a probe can assert chips were actually thrown
        // rather than that the call to throw them returned.
        fx: s.digFx === null ? null : { ...s.digFx.stats, visible: s.digFx.points.visible },
        mouth: { sent: s.terrain.digsSent, applied: s.terrain.digsApplied },
      };
    },

    /** Voxel solidity at a body-frame point, through the one oracle. */
    solidAt: (x: number, y: number, z: number) => s.oracle.solidAt(x, y, z),

    /**
     * The pristine base and the edited surface under a body-frame direction.
     * `loweringM` is base minus surface, so it goes NEGATIVE over ground the
     * player has FILLED (WG-22) and reads 0 over a tunnel whose column is still
     * closed. Those three cases are the whole terraforming contract in one call.
     */
    surface(dx: number, dy: number, dz: number) {
      const L = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / L, uy = dy / L, uz = dz / L;
      const baseM = s.oracle.baseHeight(ux, uy, uz);
      const surfaceM = s.oracle.surfaceHeight(ux, uy, uz);
      return { baseM, surfaceM, loweringM: baseM - surfaceM };
    },
  };
}
