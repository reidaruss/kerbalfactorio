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

export type NodeKind = 'top' | 'bottom' | 'radial' | 'interstage';

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
    if (p.attach === ATTACH_RADIAL) continue;
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
    return {
      ok: false,
      why: `${mine.toFixed(2)} m will not mate with ${node.cls.toFixed(2)} m`,
    };
  }
  return { ok: true, why: '' };
}

/** The Attach enum value a node implies. */
export function attachModeOf(node: AttachNode): number {
  if (node.kind === 'radial') return ATTACH_RADIAL;
  return node.kind === 'top' ? ATTACH_TOP : ATTACH_BOTTOM;
}

/** Is this a stack face at all (as opposed to a radial mount)? */
export function isStackNode(node: AttachNode): boolean {
  return node.kind === 'top' || node.kind === 'bottom' || node.kind === 'interstage';
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
  if (node.kind === 'radial') return [x, y, z];
  return [x, y - hand.heightM, z];   // bottom and interstage both hang below
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
                                 maxM: number): AttachNode | null {
  let best: AttachNode | null = null;
  let bestPerp = maxM;
  let bestT = Infinity;
  for (const n of nodes) {
    if (!fitAt(n, hand).ok) continue;
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
