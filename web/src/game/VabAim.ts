// What the pointer MEANS in the assembly bay: where the ghost goes, what a left
// click commits and what a right click removes.
//
// Free functions over a live `Vab` rather than methods on it, purely to keep
// that file under the 400-line cap. They read the bay's published fields and
// never a copy of them, the same relationship `VabReport.ts` has.
import { ghostOrigin, isSideNode, snapAtRay } from './VesselNodes.js';
import type { Vab } from './Vab.js';

/** How far from a node the cursor may be and still snap, in metres. */
export const SNAP_M = 1.6;

export function vabAim(v: Vab, ndcX: number, ndcY: number): void {
  const hand = v.hand;
  if (hand === null) { v.view.clearGhost(); return; }
  if (v.design.empty) {
    v.active = null;
    v.blocked = null;
    v.view.showGhost(hand, [0, 0, 0], 0, false, true);
    return;
  }
  const ray = v.view.aimRay(v.camera, ndcX, ndcY);
  const snap = snapAtRay(v.nodes, hand, ray.o[0], ray.o[1], ray.o[2],
                         ray.d[0], ray.d[1], ray.d[2], SNAP_M);
  v.active = snap.node;
  v.blocked = snap.node === null && snap.near !== null
    ? { node: snap.near, why: snap.why } : null;
  v.view.showNodes(v.nodes, v.active);
  // GP-115 / GP-8: the near miss is DRAWN, in red, at the place it would have
  // gone. A ghost that simply vanishes is indistinguishable from a snap search
  // that is broken, and that ambiguity is what cost Reid a build session.
  const shown = v.active ?? v.blocked?.node ?? null;
  if (shown === null) { v.view.clearGhost(); return; }
  const o = ghostOrigin(shown, hand);
  v.view.showGhost(hand, o, shown.angleRad, isSideNode(shown),
                      v.active !== null);
}

export function vabClick(v: Vab, ndcX: number, ndcY: number): void {
  if (v.hand !== null) { vabAim(v, ndcX, ndcY); v.commitHere(); return; }
  const hit = v.view.pick(v.camera, ndcX, ndcY);
  v.selected = hit === null ? -1 : hit.handle;
  v.view.highlight(v.selected >= 0 ? [v.selected] : []);
  v.repaint();
}

/** Drive the aim from a debug caller, THROUGH the path a real move takes: the
 *  pointer layer, not this module, so the hit test a probe exercises is the one
 *  a hand exercises. */
export function vabHover(v: Vab, ndcX: number, ndcY: number): void {
  v.pointer.aimAt(ndcX, ndcY);
}
export function vabDropHand(v: Vab): void {
  v.hand = null;
  v.active = null;
  v.blocked = null;
  v.view.clearGhost();
  v.view.clearNodes();
  v.repaint();
}

/**
 * GP-55. THE RIGHT BUTTON, and which of its two meanings you get is decided
 * by WHAT IS IN YOUR HAND, exactly as GP-26 decided the left button on foot.
 * Reid: "i should be able to remove components i have placed in the VAB. I
 * shouldnt have to clear and start over." The feature was finished at every
 * layer (`_of_vs_remove`, and `removeAt` below refunds and re-stages) and
 * NOTHING CALLED IT: no key, no control, and the only delete in the panel is
 * `design-del`, which throws away a saved DESIGN and is what a player hunting
 * for this would find first. Right-click rather than Delete-on-a-selection
 * because `demolish` is ALREADY `Mouse2` on foot (Bindings.ts).
 */
export function vabRightClick(v: Vab): void {
  if (v.hand !== null) { v.dropHand(); return; }
  const hit = v.view.pick(v.camera, v.pointer.ndcX, v.pointer.ndcY);
  // A miss SAYS SO. A right-click on empty space that quietly did nothing is
  // how a feature stays undiscovered, which is the whole reason this exists.
  if (hit === null) { v.say('right-click a part to remove it'); return; }
  v.removeAt(hit.handle);
}
