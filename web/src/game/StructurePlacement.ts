// THE RULES: where a structural part would go, and whether it would be allowed.
//
// Split out of Structures.ts because they are a different kind of thing. That
// file owns what exists in the world; this one owns the questions asked before
// anything is allowed to exist, in the order a player needs the answers:
//
//   0. GP-37: is there a published SOCKET near the aim to snap to? A part
//      prefers an existing part's socket to the bare grid (StructureSnap.ts).
//   1. is the cell already built on?
//   2. is there anything to build ON (a deck under a wall, a storey under a
//      floor)?
//   3. DW-24: is the ground under the footprint flat enough to rest on, given
//      that GP-38 lets a NEIGHBOUR carry the float side of that question?
//   4. is the cost in the pack?
//
// Every one of them produces a SENTENCE, and the sentence is on the ghost before
// the key is pressed rather than in a toast after it. Refusal 3 names the
// levelling tool, because being refused is how a player discovers it exists.

//
// Split (line-cap batch 2, BT-285) into StructureAim.ts (the raycast) and
// StructureResolve.ts (resolution + commit); this file stays the barrel,
// holding the shared StructureTarget type and the HUD prompt, and
// re-exporting every symbol a consumer imported from here before the split.

import * as THREE from 'three';
import { labelOf } from '../player/Bindings.js';
import type { Addr, Site, StructureKind } from './StructureGrid.js';
import type { HudTarget } from '../ui/GameHud.js';
import type { Vec3d } from '../world/PlanetBody.js';

export { aimHit, aimPoint } from './StructureAim.js';
export { resolveTarget, cantileverFloatM, commitTarget } from './StructureResolve.js';

export interface StructureTarget {
  /** GP-289. FALSE when the aim ray reached its full reach without touching
   *  ground or a solid, i.e. the player is looking at the sky. `pos` is then a
   *  fallback point in mid-air and NOTHING MAY BE DRAWN AT IT: the preview
   *  material is DoubleSide, so a slab six metres up a ray pointing at the sky
   *  is a slab the player is standing inside, and its inner faces are the whole
   *  viewport. That was Reid's report. */
  aimed: boolean;
  /** GP-289. TRUE inside the narrow cone straight up or down where the aim has
   *  no heading at all. Nothing may be drawn: every position is a guess and the
   *  nearest guess puts the player inside the preview. */
  overhead: boolean;
  kind: StructureKind;
  site: Site | null;
  addr: Addr | null;
  key: string;
  pos: Vec3d;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  ok: boolean;
  reason: string;
  /** DW-24: the worst signed deviation of the ground from the base plane.
   *  Positive buries a corner, negative leaves it hanging. */
  unevennessM: number;
  freePlaced: boolean;
  /** GP-37: the socket this address came from, `"#12 socket_edge_e"`, or null
   *  when the address is the bare grid's. On the ghost, so a player can see
   *  WHAT it caught rather than inferring it from where the preview jumped. */
  snapped: string | null;
  /** GP-38: cells from the nearest deck that rests on the ground. 0 is a deck
   *  standing on its own ground, n >= 1 is carried by a neighbour, and -1 is a
   *  run that has reached past `MAX_CANTILEVER_CELLS`. */
  carryRun: number;
}

/**
 * What the crosshair SAYS while a structural part is in hand.
 *
 * The reason is on screen while the player is still aiming, not flashed after a
 * refused press, because DW-24's whole argument is that being refused is how the
 * levelling tool gets discovered. A message that only appears once you have
 * already pressed the key teaches nothing.
 */
export function ghostPrompt(t: StructureTarget | null): HudTarget | null {
  if (t === null) return null;
  const held = t.snapped === null ? '' : `  [snapped to ${t.snapped}]`;
  return {
    name: `${t.kind}${t.freePlaced ? '  (free)' : ''}${held}  ${t.reason}`,
    fraction: 0, empty: !t.ok, distanceM: 0,
    action: `${labelOf('use')} place  (hold to drag)`
      + `    ${labelOf('rotate')} turn    ${labelOf('freeSnap')} snap`,
  };
}
