// The launch pad's row in the one atomic save slot (DW-17).
//
// A pad is saved with the TRANSFORM it was built with plus the block address it
// was built at, for exactly the reason `StructureSave` gives: a restore must not
// depend on re-deriving a site frame, and the address rides along so a reloaded
// base still refuses a second pad on the same platform.
//
// THE CLAMP STATE IS DELIBERATELY NOT SAVED. A pad is restored HOLDING, always,
// and the reason is that the flight the clamps were released for is itself not
// in the save (PH-30: the world save cannot describe a player who is strapped
// in, so it is refused while aboard). A pad reloaded mid-swing would therefore
// be holding a rocket that does not exist, with its arms open, which is a
// picture of a state the game cannot be in. Restoring shut is the only answer
// consistent with what the rest of the slot is allowed to contain.
//
// `SAVE_VERSION` deliberately does NOT move for this. The field is optional and
// its absence is a legal world with no pad in it, so nothing MISREADS an old
// slot; a bump would refuse every world anybody is currently playing. That is
// the same rule `discovery` and `progress` were added under.

import * as THREE from 'three';
import type { LaunchPads, PadPart } from './LaunchPad.js';

export interface SavePad {
  site: number;
  /** i, j, level: the SW corner cell of the platform block. */
  addr: [number, number, number];
  pos: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
  /** Roll-outs anchored on this pad. Not state the game reads back; it is what
   *  makes "this pad has been used" survive a reload, which is the difference
   *  between a launch site and a monument. */
  rollouts: number;
}

export function savePads(pads: LaunchPads): SavePad[] {
  return pads.list.map((p) => ({
    site: p.siteId,
    addr: [p.i, p.j, p.level],
    pos: [p.pos.x, p.pos.y, p.pos.z],
    up: [p.up.x, p.up.y, p.up.z],
    fwd: [p.fwd.x, p.fwd.y, p.fwd.z],
    rollouts: p.rollouts,
  }));
}

/**
 * Put the saved pads back. Returns how many came back.
 *
 * Nothing is PAID here: the cost was spent when the pad was built and the slot
 * records the world after that, so charging again would bill a player 60 iron
 * for their own launch site every time they opened the page.
 */
export function restorePads(pads: LaunchPads,
                            rows: readonly SavePad[] | undefined): number {
  pads.reset();
  if (rows === undefined) return 0;
  const def = pads.definition;
  if (def === null) return 0;
  let n = 0;
  for (const r of rows) {
    if (r.addr.length !== 3) continue;
    const up = new THREE.Vector3(r.up[0], r.up[1], r.up[2]);
    const fwd = new THREE.Vector3(r.fwd[0], r.fwd[1], r.fwd[2]);
    // The quaternion is rebuilt from up and fwd through the SAME `orient` the
    // placement used, so a restored pad faces exactly where it faced and no
    // rounding creeps in through a saved quaternion.
    const p: PadPart = pads.adopt(def, r.site, r.addr[0], r.addr[1], r.addr[2],
      { x: r.pos[0], y: r.pos[1], z: r.pos[2] }, up, fwd);
    p.rollouts = typeof r.rollouts === 'number' ? r.rollouts : 0;
    n++;
  }
  return n;
}
