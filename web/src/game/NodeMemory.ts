// CE-70 to CE-74. WHAT A STREAMED NODE INHERITS WHEN IT MATERIALISES AGAIN.
//
// =============================================================================
// THE DEFECT, MEASURED BEFORE A LINE OF THIS FILE EXISTED, AND IT IS NOT THE
// DEFECT THE BRIEF DESCRIBED.
//
// The brief (from persistence's PS-49..52 row) said an IN-PAGE BODY ROUND TRIP
// regrows the world's rocks and trees. The mechanism it named is right and the
// TRIGGER is wrong: a body switch is not required, and neither is a reboot.
// Driven, sandbox, one context, three trees chopped at 19 to 25 m and then a
// 3 km walk out of the ring and back on ONE body with no `reboot` of any kind:
//
//   chopped:            idx 412 9.91/24.91, idx 411 13.89/28.89, idx 394 18.77/39.77
//   3 km away:          all three ABSENT (their cells left the ring)
//   back on that spot:  idx 1840 24.91/24.91, idx 1839 28.89/28.89, idx 1822 39.77/39.77
//
// Full health, at three brand-new /core indices. The body round trip that
// follows in the same run is the same reading one more time (idx 2240, 2239,
// 2222, all full): a switch is just the largest possible stream-out, and
// `TREE_RADIUS_M` is 620 m, so **the case a player actually hits is walking
// away from a tree they chopped.** The negative control is in the same reading
// and needs no second build: the two SPAWN-CLEARING nodes (idx 0 and idx 1) are
// laid by `NodeField.populate`, never stream out, and stay drained through both
// trips.
//
// =============================================================================
// THE CAUSE, IN ONE SENTENCE.
//
// `of_gp_node_add` unconditionally APPENDS a node at full `RemainingAmount`
// (of_core_api.cpp: `n.RemainingAmount = n.InitialAmount`), and `buildRock` /
// `buildTree` call it every time a cell is built. `known` -- the map both
// fields keep from cell key to /core index, which `TreeField.forget` goes out
// of its way to PRESERVE for any node below full ("one below full is kept for
// ever, which is what the save is for") -- was then OVERWRITTEN with the fresh
// index and never read. The one re-drain path that existed, `pending`, is only
// ever filled by `restore()` from a save on disk. So the session remembered the
// harvest in a map it never consulted.
//
// AND IT COST THE SAVE TOO, which is the half a count of live nodes hides:
// `serialize()` walks `known` and emits a row per node below full. After a
// regrow `known[key]` points at the NEW full node, so no row is emitted and the
// next autosave agrees the tree was never chopped.
//
// =============================================================================
// WHY THIS FILE EXISTS RATHER THAN FOUR LINES IN EACH FIELD.
//
// `RockField` and `TreeField` already carry near-identical copies of `known`,
// `pending`, `serialize` and `restore` (TreeField's own header says the pruning
// rule is "owed back to RockField"). A rule about what a re-materialised node
// inherits, written down twice, is PS-13's defect waiting to happen: the next
// lane changes one copy. It is also what keeps both files under the 400-line
// cap -- `RockField.ts` was already 6 lines over it before this lane.

import type { GameCore } from './GameCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** One materialised node: its /core index and the amount it was born with. */
export interface KnownNode { index: number; initial: number }

/** Which memory, if any, drained the fresh node. `null` means it is genuinely
 *  new ground and full health is the right answer. */
export type Inherited = 'live' | 'saved' | null;

/**
 * A cell has just been built and `index` is a BRAND NEW full node standing
 * where an older one may have stood. Give it whatever this session or the last
 * save already knows about that cell, and record it as the cell's node.
 *
 * ORDER OF AUTHORITY: the LIVE reading wins over the saved one, and that is not
 * arbitrary. `restore()` runs at load and drains the standing node in place, so
 * a live entry below full ALREADY carries everything the save said plus every
 * swing since; a saved entry is only reachable for a cell this session has
 * never materialised (`restore` puts a row in `pending` only when `known` lacks
 * the key, and the first materialisation deletes it from `pending`). Preferring
 * the saved value would replay an older number over a newer one.
 *
 * THE DRAIN IS THE SAME ONE CALL A HARVEST USES, deliberately: `_of_gp_node_drain`
 * is the only verb that can lower a node, so there is no second way for an
 * amount to go down and nothing here can invent a state a harvest could not
 * reach. `initial` is not carried across, only `remaining`: `InitialAmount` is
 * `baseAmountOf(kind) * Grade` with `Grade` hashed from the node's DIRECTION and
 * the body seed, and the direction is a pure function of (seed, cell, k), so the
 * fresh node is born with the same `initial` the old one had. Measured rather
 * than assumed: 24.909327030181885 before and 24.909327030181885 after.
 *
 * WHY THE NODE IS RE-ADDED AND RE-DRAINED RATHER THAN THE OLD INDEX RE-PRESENTED.
 * Re-presenting the old /core entry would preserve the depletion for free and
 * would also freeze the node at the surface height it was first snapped to.
 * `of_gp_node_add` seats it through the LIVE edits handle, which is why both
 * fields pass one ("a rock streaming in over a dug pit must seat on the edited
 * surface", RockField's header). Re-adding keeps that and costs no /core growth
 * that today's code does not already pay: every stream-in already appends.
 */
export function inheritDepletion(
  game: GameCore,
  M: OfCoreModule,
  known: Map<string, KnownNode>,
  pending: Map<string, number>,
  key: string,
  index: number,
): Inherited {
  const st = game.node(index);
  const was = known.get(key);
  known.set(key, { index, initial: st?.initial ?? 0 });
  if (st === null) return null;

  // THE LIVE MEMORY. `was.index` is the entry this cell had before it streamed
  // out; /core never removes a node, so it is still readable and still holds
  // the amount the player left in it.
  if (was !== undefined && was.index !== index) {
    const old = game.node(was.index);
    if (old !== null && old.remaining < old.initial && st.remaining > old.remaining) {
      M._of_gp_node_drain(index, st.remaining - old.remaining);
      pending.delete(key);
      return 'live';
    }
  }

  // THE SAVED MEMORY, unchanged in behaviour from the code this replaced.
  const saved = pending.get(key);
  if (saved !== undefined && st.remaining > saved) {
    M._of_gp_node_drain(index, st.remaining - saved);
    pending.delete(key);
    return 'saved';
  }
  return null;
}
