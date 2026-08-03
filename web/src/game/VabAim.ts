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

/**
 * GP-143. WHAT THE BAY IS ABOUT TO DO, said BEFORE the button goes down.
 *
 * Measured on the shipped build: with a part in hand, the bay's one line read
 * "placed Fuel Tank (large) [S]" through every state a player passes on the way
 * to their next click, including the cursor on empty space and the cursor on a
 * face that would take the part. It never once described the present.
 *
 * GP-115 composed excellent refusals and they were reachable only by clicking
 * and failing, which is the shape the launch pad had at GP-139: four good
 * explanatory sentences that fired only when a keypress was refused, so the help
 * was reachable exactly by players who already knew what to press. `snap.why` is
 * computed HERE, on the hover, and was being carried to the click and thrown
 * away if the player did not make one.
 *
 * The face is NAMED, and that is the half that answers "you can only build
 * bottom-up": pointing at the base of a rocket now says the part goes under the
 * part it would go under, which is a sentence that could not have been produced
 * by a bay in which downward building did not exist.
 *
 * `Vab.takeInHand` re-runs the aim through the pointer's LAST position for the
 * same reason. `vabAim` does not run until the pointer moves, so a part picked
 * off the rail would otherwise sit in hand under a line about the last thing
 * that was placed, which is the state this whole entry exists to end.
 *
 * THE AIM WINS OVER THE EVENT, and the event CLEARS it rather than covering it
 * (`VabPanel.render`). Both halves were forced by measurement rather than
 * chosen. With the event winning for its three seconds, which is the obvious
 * precedence because it is the newer fact, the aim line was invisible in every
 * state a player reaches inside three seconds of a click, which is all of them:
 * the probe read the same seven identical sentences it read before this entry
 * existed, and the entry would have shipped doing nothing. And the event has to
 * CLEAR the aim, not merely outrank it, because the aim described a hover over
 * the model as it was BEFORE the event, so the face it names may no longer be
 * there. Clearing on a non-empty message only means the message's own clock
 * expiring leaves the aim standing instead of blanking a line being read.
 */
function faceWord(kind: string): string {
  if (kind === 'top') return 'on top of';
  if (kind === 'bottom') return 'under';
  if (kind === 'interstage') return 'in the interstage under';
  return 'on the side of';
}

function aimLine(v: Vab): string {
  const hand = v.hand;
  if (hand === null) return '';
  if (v.design.empty) {
    return !hand.nodeBottom && !hand.nodeTop
      ? `${hand.label} cannot start a stack: begin with a pod, a tank or an engine`
      : `click to set down ${hand.label} as the first part`;
  }
  const node = v.active;
  if (node !== null) {
    const parent = v.design.parts.find((p) => p.handle === node.parent);
    const owner = parent === undefined ? 'the stack'
      : (v.catalogue.find((c) => c.id === parent.partId)?.label ?? 'the stack');
    // GP-297. AN INSERT SAYS WHAT MOVES, because that is the whole difference
    // between it and an attach and it is the only difference a player cannot
    // see in the ghost. The arriving part is drawn at the seam either way; what
    // the picture does not show is that everything below is about to shift
    // down, so the sentence carries it.
    //
    // It names BOTH parts, which is the same argument GP-142 made for naming
    // the face: "Autopilot Module INTO the joint under Command Pod, pushing
    // Fuel Tank (small) and everything below it down" is a sentence that could
    // not have been produced by a bay where a seam was not a place, and a
    // player who reads it knows before clicking that their rocket is about to
    // get longer rather than that a part is about to sit somewhere.
    if (node.kind === 'insert') {
      const kid = v.design.parts.find((p) => p.handle === node.child);
      const kidName = kid === undefined ? 'the stack below'
        : (v.catalogue.find((c) => c.id === kid.partId)?.label ?? 'the stack below');
      return `${hand.label} INTO the joint under ${owner}, pushing ${kidName} `
        + 'and everything below it down';
    }
    return `${hand.label} ${faceWord(node.kind)} ${owner}`;
  }
  const b = v.blocked;
  if (b !== null) return b.why === '' ? 'that will not fit there' : b.why;
  return `point at an attachment point to place ${hand.label}`;
}

export function vabAim(v: Vab, ndcX: number, ndcY: number): void {
  const hand = v.hand;
  if (hand === null) { v.view.clearGhost(); v.panel.setAim(''); return; }
  if (v.design.empty) {
    v.active = null;
    v.blocked = null;
    v.view.showGhost(hand, [0, 0, 0], 0, false, true);
    v.panel.setAim(aimLine(v));
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
  v.panel.setAim(aimLine(v));
  if (shown === null) { v.view.clearGhost(); return; }
  const o = ghostOrigin(shown, hand);
  // GP-297. AN INSERT GHOST IS TINTED DIFFERENTLY, because the arriving part is
  // drawn at the seam either way and the picture alone cannot say that the
  // stack is about to grow. Green/red is GP-8's valid/invalid code and this is
  // a third thing rather than a shade of either: the placement is valid AND it
  // is a different operation.
  v.view.showGhost(hand, o, shown.angleRad, isSideNode(shown),
                   v.active !== null, shown.kind === 'insert');
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
  v.panel.setAim('');
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
