// Attachment nodes: where a part may go, and whether the part in hand fits.
//
// The geometry is the art contract's (ASSET-SPECS §3.3), read off the shipped
// sockets and NOT re-derived: a stack part's origin is its bottom mating plane
// at local (0,0,0), its `socket_stack_top` is at local (0, H, 0), and vessel.h
// lays a child out at exactly parent.origin + (0, parentH, 0) or
// child.origin = parent.origin - childH. So a correct placement has a joint gap
// of zero to floating-point, and `probes/vab.js` MEASURES it against the drawn
// scene rather than trusting this comment.
//
// The one rule that is not geometry is the CLASS check. Two mating faces being
// coplanar and anti-parallel is necessary and, with two diameter classes, no
// longer sufficient: a 2.50 m decoupler will sit happily on a 1.25 m tank and
// every geometric test approves it. So the class of the two faces must agree,
// and `StackAdapter` is the single part whose two ends differ.
import { classAtBottom, classAtTop } from './VesselCatalogue.js';
import type { PartRow } from './VesselCatalogue.js';
import { ATTACH_BOTTOM, ATTACH_RADIAL, ATTACH_TOP } from '../sim/wasm/vesselabi.js';
import type { DesignPart } from './VesselDesign.js';

export type NodeKind = 'top' | 'bottom' | 'radial' | 'interstage' | 'pylon';

export interface AttachNode {
  parent: number;          // the handle a new part would attach to
  kind: NodeKind;
  /** Vessel-frame position of the mating plane centre (radial: on the hull). */
  posM: [number, number, number];
  /** The diameter class this face presents, 0 for a radial mount. */
  cls: number;
  /** Radial only: the angle around the parent axis and the height up it. */
  angleRad: number;
  offsetM: number;
  radiusM: number;
}

const RADIAL_RINGS = 6;    // heights sampled up a hull for a radial mount
const RADIAL_SECTORS = 12; // 30 degree steps around it

/**
 * Is one of a part's two stack faces already in use?
 *
 * TWO ways it can be, and missing the second one is a real bug that shows up as
 * a part mating into the joint it is already part of: a face is taken when a
 * CHILD is attached there, and it is equally taken when the part ITSELF is
 * attached to its parent through it. A part hanging BELOW its parent
 * (Attach::StackBottom) has spent its own TOP face on that joint, and a part
 * sitting ON its parent has spent its BOTTOM. Measured before the fix: the stack
 * decoupler in the reference vehicle offered its top face 0.25 m from its
 * bottom one, the snap took the nearer of the two, and the lower stage attached
 * upward into the joint it was hanging from. Length read 7.85 m against 12.10.
 */
function occupied(parts: readonly DesignPart[], self: DesignPart, how: number): boolean {
  if (how === ATTACH_TOP && self.attach === ATTACH_BOTTOM) return true;
  if (how === ATTACH_BOTTOM && self.attach === ATTACH_TOP) return true;
  return parts.some((p) => p.parent === self.handle && p.attach === how);
}

/**
 * Every node a NEW part could attach to, given what is already built.
 *
 * Radial nodes are sampled rather than continuous because the player is aiming
 * with a mouse at a cylinder: a continuous surface would make every hover a
 * different answer and symmetry impossible to hit twice. The sampling is the
 * snap, and 30 degrees times a ring every fifth of the hull is fine enough that
 * no reachable spot is more than a few centimetres from a node.
 */
export function attachNodes(parts: readonly DesignPart[],
                            byId: (id: number) => PartRow | undefined): AttachNode[] {
  const out: AttachNode[] = [];
  for (const p of parts) {
    const def = byId(p.partId);
    if (!def) continue;
    const [x, y, z] = p.originM;

    if (def.nodeTop && !occupied(parts, p, ATTACH_TOP)) {
      out.push({
        parent: p.handle, kind: 'top', posM: [x, y + def.heightM, z],
        cls: classAtTop(def), angleRad: 0, offsetM: 0, radiusM: def.diameterM * 0.5,
      });
    }
    // The bottom face. A TERMINATOR (an engine or a solid booster) publishes no
    // `socket_stack_bottom`, because the art contract says nothing may be bolted
    // under a bell. It is still offered here, to a DECOUPLER only, and that is
    // not a loophole: it is the interstage, it is how KSP stacks are built, and
    // it is how /core's OWN reference vehicle is assembled
    // (test_vessel.cpp hangs a stack decoupler under the vacuum engine). Without
    // it the shipped fixture cannot be built in the shipped assembly view.
    //
    // The cost is one honest gap in the measurement: that joint has a socket on
    // the decoupler's side and none on the engine's, so `VabView.jointGaps`
    // reports it `unmeasurable` rather than pretending it closed. Raised as a
    // cross-lane question: either an engine grows a bottom socket or the
    // reference vehicle stops using one.
    const terminator = def.nodeTop && !def.nodeBottom;
    if ((def.nodeBottom || terminator) && !occupied(parts, p, ATTACH_BOTTOM)) {
      out.push({
        parent: p.handle, kind: terminator ? 'interstage' : 'bottom', posM: [x, y, z],
        cls: def.nodeBottom ? classAtBottom(def) : def.diameterM,
        angleRad: 0, offsetM: 0, radiusM: def.diameterM * 0.5,
      });
    }
    // Radial mounts sit on the hull of any part that has a body to mount on.
    // A radial part is not itself a radial HOST: hanging a fin off a fin is
    // exactly the kind of tower a player builds by accident.
    //
    // GP-116. THE ONE EXCEPTION IS A PYLON, and it is the whole reason a radial
    // decoupler exists. Reid: "Things dont snap to the radial decouplers."
    // Measured before the fix, in the shipped bay: place a radial decoupler on a
    // tank and the node list contains ZERO entries with the decoupler as parent
    // (74 nodes, all of them the tank's 1 top + 1 bottom + 72 radial). So the
    // answer to "no nodes authored or nodes ignored?" is the FIRST one: the part
    // publishes no stack face in vessel.h (nodeTop and nodeBottom both false)
    // and the blanket rule above then denied it a radial face as well, leaving a
    // part with nothing on it at all. A booster strapped to the side is the only
    // thing this part is for, so it gets exactly ONE node, outward, at its own
    // mount angle, and not the 72-node cage a 0.30 m hull would otherwise grow.
    if (p.attach === ATTACH_RADIAL) {
      if (!def.isDecoupler) continue;
      // ONE tenant. A pylon that kept offering its node after a booster was on
      // it would let a second booster occupy the same point in space, which is
      // the radial equivalent of the double-mate `occupied` exists to stop.
      if (parts.some((q) => q.parent === p.handle)) continue;
      const a = p.radialAngleRad;
      const pr = def.diameterM * 0.5;
      // vessel.h `originFrom`: a radial child sits at parent.origin +
      // (parentRadius * cos a, offset, parentRadius * sin a). Offset 0, so where
      // the pylon is is where the booster's base lands, which is the only rule
      // simple enough to aim with.
      out.push({
        parent: p.handle, kind: 'pylon',
        posM: [x + pr * Math.cos(a), y, z + pr * Math.sin(a)],
        cls: 0, angleRad: a, offsetM: 0, radiusM: pr,
      });
      continue;
    }
    const r = def.diameterM * 0.5;
    for (let ring = 1; ring <= RADIAL_RINGS; ++ring) {
      const off = (def.heightM * ring) / (RADIAL_RINGS + 1);
      for (let s = 0; s < RADIAL_SECTORS; ++s) {
        const a = (s * 2 * Math.PI) / RADIAL_SECTORS;
        out.push({
          parent: p.handle, kind: 'radial',
          posM: [x + r * Math.cos(a), y + off, z + r * Math.sin(a)],
          cls: 0, angleRad: a, offsetM: off, radiusM: r,
        });
      }
    }
  }
  return out;
}

/** Does the part in hand fit this node, and if not, why not (for the ghost)? */
export function fitAt(node: AttachNode, hand: PartRow): { ok: boolean; why: string } {
  if (node.kind === 'pylon') {
    // A pylon carries a strap-on, not another pylon: a decoupler on a decoupler
    // is the accidental tower the blanket rule above exists to prevent.
    if (hand.isDecoupler) return { ok: false, why: 'a pylon carries a booster, not another decoupler' };
    if (!hand.radialMount) {
      return { ok: false, why: `${hand.label} does not strap on: it has no radial mount` };
    }
    return { ok: true, why: '' };
  }
  if (node.kind === 'radial') {
    if (!hand.radialMount) return { ok: false, why: `${hand.label} has no radial mount` };
    return { ok: true, why: '' };
  }
  // Under a bell, a decoupler and nothing else. See attachNodes.
  if (node.kind === 'interstage' && !hand.isDecoupler) {
    return { ok: false, why: 'only a decoupler goes under an engine bell' };
  }
  // Going ON a parent's TOP face, the incoming part presents its own BOTTOM.
  const mine = node.kind === 'top' ? classAtBottom(hand) : classAtTop(hand);
  if (mine <= 0) {
    const face = node.kind === 'top' ? 'bottom' : 'top';
    return { ok: false, why: `${hand.label} has no ${face} node` };
  }
  if (Math.abs(mine - node.cls) > 1e-9) {
    // GP-115. THE SENTENCE NAMES THE REMEDY. DW-29a's whole argument for the
    // adapter existing is that two diameter classes without one are two disjoint
    // catalogues, so the refusal that enforces the classes is the one place the
    // player can be told which part reconciles them. Before this it read
    // "1.25 m will not mate with 2.50 m", which is true, unactionable, and (see
    // `snapAtRay`) was never shown to anybody in the first place.
    const wide = Math.max(mine, node.cls), narrow = Math.min(mine, node.cls);
    return {
      ok: false,
      why: `${hand.label} is ${mine.toFixed(2)} m and that face is `
        + `${node.cls.toFixed(2)} m: put a Stack Adapter between them `
        + `(${wide.toFixed(2)} m below, ${narrow.toFixed(2)} m above)`,
    };
  }
  return { ok: true, why: '' };
}

/** The Attach enum value a node implies. */
export function attachModeOf(node: AttachNode): number {
  if (node.kind === 'radial' || node.kind === 'pylon') return ATTACH_RADIAL;
  return node.kind === 'top' ? ATTACH_TOP : ATTACH_BOTTOM;
}

/** Is this a stack face at all (as opposed to a radial mount)? */
export function isStackNode(node: AttachNode): boolean {
  return node.kind === 'top' || node.kind === 'bottom' || node.kind === 'interstage';
}

/** Does this node place its tenant on a parent's SIDE? */
export function isSideNode(node: AttachNode): boolean {
  return node.kind === 'radial' || node.kind === 'pylon';
}

/**
 * Where the part in hand would SIT if attached at this node, in the vessel
 * frame. This is vessel.h's own layout rule restated for the ghost, and the
 * probe asserts the ghost and the committed part land in the same place, so the
 * restatement cannot drift silently.
 */
export function ghostOrigin(node: AttachNode, hand: PartRow): [number, number, number] {
  const [x, y, z] = node.posM;
  if (node.kind === 'top') return [x, y, z];
  if (isSideNode(node)) return [x, y, z];
  return [x, y - hand.heightM, z];   // bottom and interstage both hang below
}

/**
 * GP-115. WHAT THE CURSOR IS POINTING AT, whether or not it fits.
 *
 * The old search filtered by `fitAt` BEFORE ranking, and that one line is
 * complaint 1 in full. A node that exists and does not fit was invisible: the
 * ghost vanished, `Vab.active` stayed null, and the click was refused with
 * "no attachment node there", which is a false statement about a face the
 * player is looking straight at. Worse, it made every sentence `fitAt` composes
 * unreachable, because the only other caller (`Vab.commitHere`) re-tests a node
 * this function had already guaranteed fits. Measured on the shipped build: a
 * 1.25 m tank in hand over a bare 2.50 m tank snapped on 0 of 1681 screen cells
 * and the message named neither diameter.
 *
 * So the search now returns BOTH: the best node that fits, and the best node
 * full stop. The caller draws a red ghost on a near miss and refuses with the
 * near miss's own reason, which is GP-8's colour code (green valid, red
 * hard-invalid, reason label) finally reaching the assembly bay.
 */
export interface SnapResult {
  /** The node a click would commit to, or null. */
  node: AttachNode | null;
  /** The nearest node regardless of fit, so a refusal can name it. */
  near: AttachNode | null;
  /** Why `near` was rejected. Empty when `near === node`. */
  why: string;
}

export function snapAtRay(nodes: readonly AttachNode[], hand: PartRow,
                          ox: number, oy: number, oz: number,
                          dx: number, dy: number, dz: number,
                          maxM: number): SnapResult {
  const at = (accept?: (n: AttachNode) => boolean): AttachNode | null =>
    nearestNodeToRay(nodes, hand, ox, oy, oz, dx, dy, dz, maxM, accept);
  const fit = at();
  if (fit !== null) return { node: fit, near: fit, why: '' };
  // A near miss is only worth reporting if its refusal TEACHES. The 72-node
  // radial cage covers every hull, so a plain nearest-node search over
  // everything would answer "Fuel Tank (small) has no radial mount" while the
  // player is pointing at a mating face two centimetres away, which is a second
  // wrong sentence in place of the first one. Faces that carry a class or a rule
  // are asked first; the cage is the fallback and not the answer.
  const named = at((n) => n.kind !== 'radial');
  const near = named ?? at(() => true);
  return { node: null, near, why: near === null ? '' : fitAt(near, hand).why };
}

/**
 * The node the cursor is POINTING AT: nearest to the aim RAY, not nearest to
 * where the ray happens to hit the hull.
 *
 * The difference is not academic. Ranking by distance to the hull hit means the
 * winner depends on which surface the ray struck first, so aiming exactly at a
 * node can still select a different one a few centimetres away on the far side
 * of the skin. Ranking by perpendicular distance to the ray means the node the
 * player put the cursor on wins, which is what "aim at it" means. Ties are
 * broken by depth so a near node beats a far one behind it.
 */
export function nearestNodeToRay(nodes: readonly AttachNode[], hand: PartRow,
                                 ox: number, oy: number, oz: number,
                                 dx: number, dy: number, dz: number,
                                 maxM: number,
                                 accept?: (n: AttachNode) => boolean): AttachNode | null {
  const ok = accept ?? ((n: AttachNode) => fitAt(n, hand).ok);
  let best: AttachNode | null = null;
  let bestPerp = maxM;
  let bestT = Infinity;
  for (const n of nodes) {
    if (!ok(n)) continue;
    const vx = n.posM[0] - ox, vy = n.posM[1] - oy, vz = n.posM[2] - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if (t <= 0) continue;                       // behind the camera
    const px = vx - dx * t, py = vy - dy * t, pz = vz - dz * t;
    const perp = Math.sqrt(px * px + py * py + pz * pz);
    if (perp > maxM) continue;
    // A clearly nearer-to-the-ray node wins; otherwise the nearer-to-camera one.
    if (perp < bestPerp - 1e-6 || (Math.abs(perp - bestPerp) <= 1e-6 && t < bestT)) {
      bestPerp = perp; bestT = t; best = n;
    }
  }
  return best;
}

/** The symmetry copies of a radial node: `count` evenly spaced angles. */
export function symmetryAngles(node: AttachNode, count: number): number[] {
  if (node.kind !== 'radial' || count <= 1) return [node.angleRad];
  const out: number[] = [];
  for (let i = 0; i < count; ++i) out.push(node.angleRad + (i * 2 * Math.PI) / count);
  return out;
}
