// WHICH BELT TILES ARE CORNERS, AND HOW A CORNER TILE STANDS.
//
// Split out of FactoryView when FS-40 landed and that file crossed the 400-line
// cap, and split along a seam FactoryWiring already established: `chainRuns`
// answers "which tiles form one line, in what order" and this answers "where
// does that line turn, which way, and what frame does the turning tile take".
// Both are pure geometry over the plan; neither draws anything.

import * as THREE from 'three';
import type { Factory } from './Factory.js';

/** Cosine below which two flow directions count as the same heading. */
const TURN_COS = 0.9;

/**
 * Which belt tiles are corners, which way they turn, and how to orient them.
 *
 * A run is already ORDERED (FactoryWiring.chainRuns walks each tile's flow
 * direction), so a tile turns exactly when the heading it inherits from the tile
 * behind it is not the heading it sends on. Handedness comes out of the tangent
 * frame and nothing else: local +X is `up x in`, and the mesh's outlet is on -X
 * for a left turn and +X for a right one. Sign of (up x in) . out is therefore
 * the whole test, and it is unchanged.
 *
 * FS-40: THE CORNER TILE'S DECK IS THE PLANE THROUGH THE FLOW IN AND THE FLOW
 * OUT, and that is what fixes Reid's "I turned this belt ... visually it didnt
 * turn to line up."
 *
 * This used to hand back `orient(tile.up, prev.fwd)`, and `orient` cannot
 * express a pitched heading: it stands local +Y exactly on `up` and puts local
 * +Z on the part of `fwd` lying in the tangent plane, dropping the radial
 * component entirely. Every other belt tile is placed with `Placed.quat`, which
 * `FactoryCommit.pitchRuns` writes as `frameOf(up, fwd)` and which KEEPS that
 * component, because a run on a hillside is a ramp and not a flight of steps.
 * So on any slope the corner tile alone stood LEVEL between two ramping
 * neighbours. Measured on a 14.8 degree hillside with the run's tiles pitched
 * 10.3 degrees, by `probes/beltturn.js` against the asset's own published body
 * endpoints and the matrix the batch was about to draw: the corner's inlet
 * missed the tile behind it by 0.1011 m where every straight seam on the same
 * run was 0.0161 to 0.0251 m. 0.085 m of that is exactly r sin(pitch) at
 * r = 0.5 m, the closed form for half a tile of dropped pitch.
 *
 * The replacement is built from BOTH headings rather than from `up`:
 *
 *   local +Z  the flow coming IN, pitch and all, so the tile's inlet lands on
 *             the predecessor's outlet by construction.
 *   local +-X the flow going OUT, projected perpendicular to +Z because a rigid
 *             quarter turn has its two ends at exactly 90 degrees and two
 *             headings each pitched down a hillside are not quite. The sign is
 *             the handedness the mesh already publishes.
 *   local +Y  z x x, which comes out on the up side for both hands and is the
 *             normal of the plane the two flows span, i.e. the ground.
 *
 * `up` is therefore DERIVED here instead of imposed, which is the whole change.
 * The residual is the projection, asin(in . out) = about 2 degrees on that
 * slope, worth 0.018 m at the outlet, which is the same order as the ramp kink
 * `pitchRuns` already accepts between two rigid straight tiles.
 *
 * ON FLAT GROUND THIS IS THE OLD ANSWER EXACTLY, and that is not a hope: with
 * `in` and `out` both in the tangent plane, `out` is already perpendicular to
 * `in`, so +-X is `up x in` unchanged and `z x x` is `up` unchanged. The flat
 * corner seams measured 1e-6 m before this change and 1e-6 m after it.
 */
export function cornersOf(f: Factory): Map<number, { turn: 'l' | 'r'; quat: THREE.Quaternion }> {
  const out = new Map<number, { turn: 'l' | 'r'; quat: THREE.Quaternion }>();
  const side = new THREE.Vector3();
  const zAx = new THREE.Vector3();
  const xAx = new THREE.Vector3();
  const yAx = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  for (const run of f.runs) {
    for (let i = 1; i < run.length; ++i) {
      const prev = run[i - 1];
      const tile = run[i];
      if (prev.fwd.dot(tile.fwd) > TURN_COS) continue;      // straight on
      side.crossVectors(tile.up, prev.fwd);
      const s = side.dot(tile.fwd);
      if (Math.abs(s) < 0.3) continue;   // a reversal, which no mesh describes
      zAx.copy(prev.fwd).normalize();
      xAx.copy(tile.fwd).addScaledVector(zAx, -tile.fwd.dot(zAx));
      if (xAx.lengthSq() < 1e-9) continue;
      xAx.normalize();
      if (s < 0) xAx.negate();      // a left turn leaves by -X, so +X is -out
      yAx.crossVectors(zAx, xAx).normalize();
      out.set(tile.id, { turn: s < 0 ? 'l' : 'r',
        quat: new THREE.Quaternion().setFromRotationMatrix(
          basis.makeBasis(xAx, yAx, zAx)) });
    }
  }
  return out;
}
