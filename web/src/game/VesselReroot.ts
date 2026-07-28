// GP-148. THE ROOT IS THE TOP OF THE STACK, whoever the player placed first.
//
// This file changes what the root MEANS, deliberately and with Admin's ruling,
// so the reason is written here rather than in a commit nobody will read again.
//
// WHAT WAS WRONG. `of_vs_remove` deletes the subtree FURTHER FROM THE ROOT, and
// the root was simply whichever part the player happened to put down first.
// Driven: the same three-part rocket built top-down and bottom-up is identical
// on screen, part for part and height for height, and removing the middle tank
// leaves the Command Pod standing in one and the Main Engine in the other.
// Which half of an identical rocket a delete destroys was decided by build
// order, and nothing on screen said which end was the root, because rootness is
// invisible everywhere else: measured, the same rocket built from either end
// gives identical placeable sets, identical free-node counts and identical
// refusals, so a player had no way to learn which end theirs was on until a
// delete took the wrong half.
//
// WHY THE TOP. This is not a new rule, it is one that was already written down
// and silently untrue. `vessel.h` section 6: "The root of a vessel is its
// command pod, so 'further from the root' is 'further down the stack', which is
// what a player means by staging." `of_vs_autostage` derives stage order from
// DEPTH FROM THE ROOT, so a rocket rooted at its engine has its stages derived
// from the wrong end. And a multi-stage rocket can only be ASSEMBLED downward
// (GP-145: 6 of 6 top-down against 3 of 6 bottom-up, because a bell is not a
// mating face), so the order that actually works is exactly the order that was
// producing the wrong root.
//
// HOW, AND WHY THIS IS NOT THE GENERAL RE-ROOT ADMIN REFUSED. A general
// in-place re-root rewrites `parent` and leaves the old root early in the parts
// array pointing at a later part, and `DesignJson.fromJson` resolves parents by
// index in array order, so every save would silently drop the old root and
// every descendant with it. That objection is about the WRITE PATH, not about
// re-rooting, and it does not apply here: this rebuilds through
// `toJson`/`fromJson` and emits the rows in the NEW topological order, so
// parents precede children by construction. GP-142 made that round trip
// lossless, which is what makes this safe at all.
//
// THE ONE INVERSION THAT WOULD BE ILLEGAL, and why it cannot happen. Reversing
// a `bottom` edge makes the old parent sit ON the old child's top face, which
// needs the old parent's own BOTTOM socket. An engine has none: that face is an
// interstage and takes a decoupler only (GP-32). So the guard refuses to invert
// a bottom edge whose parent has no bottom socket, and leaves the root alone.
// It should never fire, and the argument is worth writing down: an interstage
// edge can only be created downward, from an engine already in the tree, so the
// decoupler is always FURTHER from the old root than the engine. The reversal
// path is the ancestors of the new root, and the new root is the topmost part,
// which is never below a decoupler hanging under a bell. `skipped` is reported
// rather than swallowed so that if the argument is ever wrong, it says so.
import { ATTACH_BOTTOM, ATTACH_RADIAL, ATTACH_TOP } from '../sim/wasm/vesselabi.js';
import type { PartRow } from './VesselCatalogue.js';
import type { DesignJson, VesselDesign } from './VesselDesign.js';

export interface RerootReport {
  /** Did the tree actually change? */
  moved: boolean;
  /** The part id that was the root, and the one that is now. */
  fromPartId: number;
  toPartId: number;
  /** How many stack edges were reversed. */
  reversed: number;
  /** Set when the guard refused an illegal inversion. Should always be false. */
  skipped: boolean;
  why: string;
}

const NONE: RerootReport = {
  moved: false, fromPartId: -1, toPartId: -1, reversed: 0, skipped: false, why: '',
};

/**
 * Put the root on the topmost part of the stack spine. Returns what it did, so
 * a probe asserts against the operation rather than against its side effects.
 */
export function normaliseRoot(design: VesselDesign,
                              byId: (id: number) => PartRow | undefined): RerootReport {
  const parts = design.parts;
  if (parts.length < 2) return NONE;
  const rootIdx = parts.findIndex((p) => p.parent < 0);
  if (rootIdx < 0) return NONE;

  // The SPINE: the root, plus every part reachable from it through stack edges
  // only. A strap-on is never a candidate for the root, and neither is anything
  // hanging off one, or a booster mounted high on a hull could outrank the nose.
  const atHandle = new Map<number, number>();
  parts.forEach((p, i) => atHandle.set(p.handle, i));
  const onSpine = new Array<boolean>(parts.length).fill(false);
  onSpine[rootIdx] = true;
  // Repeat until stable: `parts` is insertion ordered so parents already precede
  // children today, and this does not rely on that.
  for (let pass = 0; pass < parts.length; ++pass) {
    let grew = false;
    for (let i = 0; i < parts.length; ++i) {
      if (onSpine[i]) continue;
      const p = parts[i];
      if (p === undefined || p.attach === ATTACH_RADIAL) continue;
      const pi = atHandle.get(p.parent);
      if (pi !== undefined && onSpine[pi]) { onSpine[i] = true; grew = true; }
    }
    if (!grew) break;
  }

  // The topmost spine part, by its own TOP FACE rather than by its origin: a
  // short part sitting on a tall one has the higher origin only sometimes.
  let bestIdx = rootIdx;
  let bestTop = -Infinity;
  for (let i = 0; i < parts.length; ++i) {
    if (!onSpine[i]) continue;
    const p = parts[i];
    if (p === undefined) continue;
    const def = byId(p.partId);
    const top = p.originM[1] + (def === undefined ? 0 : def.heightM);
    // Ties go to the LOWER handle, so the choice is deterministic rather than
    // dependent on the order /core happened to publish.
    if (top > bestTop + 1e-9
        || (Math.abs(top - bestTop) <= 1e-9 && p.handle < (parts[bestIdx]?.handle ?? 0))) {
      bestTop = top;
      bestIdx = i;
    }
  }
  if (bestIdx === rootIdx) return NONE;

  // The reversal path: the ancestors of the new root, up to the old root.
  const path: number[] = [];
  for (let cur = bestIdx, guard = 0; guard < parts.length + 1; ++guard) {
    path.push(cur);
    const p = parts[cur];
    if (p === undefined || p.parent < 0) break;
    const pi = atHandle.get(p.parent);
    if (pi === undefined) return NONE;
    cur = pi;
  }
  if (path[path.length - 1] !== rootIdx) return NONE;

  const parent = parts.map((p) => (p.parent < 0 ? -1 : (atHandle.get(p.parent) ?? -1)));
  const attach = parts.map((p) => p.attach);
  let reversed = 0;
  for (let k = 0; k + 1 < path.length; ++k) {
    const childI = path[k] as number, parentI = path[k + 1] as number;
    const was = attach[childI] as number;
    if (was === ATTACH_BOTTOM) {
      // the old parent would end up ON the old child, which needs its own
      // bottom socket. An engine has none. See the header.
      const pDef = byId((parts[parentI] as { partId: number }).partId);
      if (pDef === undefined || !pDef.nodeBottom) {
        return { moved: false, fromPartId: -1, toPartId: -1, reversed: 0,
                 skipped: true,
                 why: `cannot invert a bottom edge under ${pDef?.label ?? '?'}` };
      }
    }
    parent[parentI] = childI;
    attach[parentI] = was === ATTACH_TOP ? ATTACH_BOTTOM : ATTACH_TOP;
    reversed += 1;
  }
  parent[bestIdx] = -1;
  attach[bestIdx] = 0;                                   // Attach::Root

  // Emit BFS from the new root, so parents precede children by construction.
  const kids = new Map<number, number[]>();
  for (let i = 0; i < parts.length; ++i) {
    const pi = parent[i] as number;
    if (pi < 0) continue;
    const list = kids.get(pi);
    if (list === undefined) kids.set(pi, [i]); else list.push(i);
  }
  const order: number[] = [bestIdx];
  for (let head = 0; head < order.length; ++head) {
    for (const c of kids.get(order[head] as number) ?? []) order.push(c);
  }
  if (order.length !== parts.length) return NONE;        // never orphan anything
  const pos = new Array<number>(parts.length).fill(-1);
  order.forEach((oldI, newI) => { pos[oldI] = newI; });

  // Take the CURRENT json and permute it, rather than composing a second one.
  // Everything that is not the tree (the radial offset GP-142 re-derives, the
  // stage each part belongs to, the hand-staged latch) then travels for free
  // and cannot drift out of agreement with `toJson`.
  // `hs` is deliberately not carried: `fromJson` does not read it, the latch
  // lives on `Vab.handStaged`, and re-rooting must not clear a stage table the
  // player has edited by hand.
  const j = design.toJson('reroot');
  const rows = j.parts;
  const out: DesignJson = {
    v: 1, name: j.name,
    parts: order.map((oldI) => {
      const r = rows[oldI] as DesignJson['parts'][number];
      const pi = parent[oldI] as number;
      return { p: r.p, parent: pi < 0 ? -1 : (pos[pi] as number),
               a: attach[oldI] as number, ang: r.ang, off: r.off, st: r.st };
    }),
    stages: j.stages.map((s) => ({
      act: s.act.map((i) => (pos[i] ?? -1)).filter((i) => i >= 0),
      dec: s.dec.map((i) => (pos[i] ?? -1)).filter((i) => i >= 0),
    })),
  };
  const fromPartId = (parts[rootIdx] as { partId: number }).partId;
  const toPartId = (parts[bestIdx] as { partId: number }).partId;
  design.fromJson(out);
  return { moved: true, fromPartId, toPartId, reversed, skipped: false, why: '' };
}
