#pragma once
// =============================================================================
// factory_sim.h — Wave-0 headless factory simulation core (Spike 3).
//
// A data-oriented (Structure-of-Arrays) belt/factory simulation that proves the
// scale claim: 100,000 active entities at >= 60 UPS on a single CPU (gate G1).
//
// Design (see docs/spikes/spike3-factory-sim.md):
//   §1  SoA component arrays, dense entity handles, fixed system schedule.
//   §2  Belt compression: transport-LINE + gap-based item offsets. Items carry
//       NO per-entity object; a flowing line moves by ONE subtraction per tick.
//   §3  Update-on-demand: an active index list, not the full entity array.
//   §4  Power graph: per-tick supply/demand -> proportional brownout.
//
// Determinism (NW-4): the hot path is integer / fixed-point. The only float is
// the power brownout ratio, applied as a fixed-point Q16 per-network scalar in a
// fixed order — it never feeds back non-deterministically into discrete state.
//
// Header-only, depends only on of::SimClock (fixed tick) + the C++17 stdlib.
// No UE, no rendering, no physics — this is the isolation harness.
// =============================================================================
#include <cstdint>
#include <vector>
#include <cstddef>

#include "of/sim_clock.h"
// power.h owns the ONE definition of the brownout arithmetic (SatisfactionQ16)
// and, when a caller binds a PowerGrid, the network partition as well. This
// header keeps its self-contained integer-network solve for every existing
// caller; it just no longer spells the division out a second time.
#include "of/power.h"

namespace of {
namespace factory {

// --- Fixed-point belt units (§2.2) -------------------------------------------
// A belt tile is 256 sub-tile positions; a saturated belt spaces items 64 units
// apart (4 items / tile / lane), exactly Factorio's belt physics.
static constexpr uint32_t kUnitsPerTile = 256;
static constexpr uint32_t kItemSpacing = 64;  // saturation gap between items
static constexpr uint32_t kMaxLineTiles = 100;  // line length cap (§2.1)

// --- Dense entity handle (§1.2) ----------------------------------------------
// generation guards stale handles after a slot is freed + reused.
struct EntityHandle {
  uint32_t index = 0xFFFFFFFFu;
  uint32_t generation = 0;
  bool valid() const { return index != 0xFFFFFFFFu; }
};

// Item id is gameplay's opaque C-3 handle; the sim treats it as a key (§11.1).
using ItemId = uint16_t;
static constexpr ItemId kNoItem = 0;

// =============================================================================
// §6 — RENDER/NETWORK STREAM CONTRACT (G7, spike3 §6.2). Pinned here; rendering
// consumes it (RC-8). The sim owns *state*; the stream is a *view* — these are
// plain PODs the StreamSystem fills each tick. Emission is purely ADDITIVE
// (read-only over the SoA): producing the stream never mutates sim state and
// never changes the hot tick, so the 13 prior suites are untouched.
//
// FEntityId is gameplay's opaque entity handle on the stream side. Headless,
// we key it to the dense entity index (the same key rendering instances by).
// =============================================================================
using FEntityId = uint32_t;

// One compact, instancing-friendly record — ~32-34 B, the spike's pinned size.
// SoA on the sim side; rendering reads it as one GPU instance row.
//   sizeof: 4 (Id) +2 (TypeId) +12 (Position f32x3) +6 (Orient i16x3) +4
//   (state bytes) +2 (BoundRadius) = 30 B packed; padded to 32 B — within the
//   "~32 B / ~34 B with BoundRadius" budget pinned in §6.2 (RC-12 append-only).
struct FFactoryEntityState {
  FEntityId Id = 0;           // dense entity index (rendering's instance key)
  uint16_t TypeId = 0;        // which mesh/material set — draw calls bucket by this
  float Position[3] = {0, 0, 0};  // authority position (headless: a plain f32x3)
  int16_t Orientation[3] = {0, 0, 0};  // packed quat-ish (unused headless; 6 B slot)
  uint8_t VisualState = 0;    // idle / working / blocked / no-power
  uint8_t AnimPhase = 0;      // 0..255 normalized craft/swing progress
  uint8_t Lod = 0;            // sim's band *hint* (rendering may override) — 0..3
  uint8_t Flags = 0;          // dirty bits: poweredOff, jammed, selected, ...
  uint16_t BoundRadius = 0;   // RC-12: packed bound-radius (cm) about Position
};

// LOD bands (RN-3, §6.2). 0 = near (instanced meshes + discrete items),
// 1 = mid (instanced machines + scrolling-flow material), 2 = far (impostors),
// 3 = on-rails (not rendered — chunk demoted, §5).
enum class Lod : uint8_t { Near0 = 0, Mid1 = 1, Far2 = 2, OnRails3 = 3 };

// One per VISIBLE transport line (NOT per item) — the belt's render view.
// Belts carry items as offsets (§2), never as entities; at LOD-1+ the whole
// line is just these few scalars (a scrolling-flow material), so render item
// cost collapses to O(lines). Per-item meshes come ONLY from GetLineItems at
// LOD-0 (the lone O(items) call).
struct FFactoryBeltFlowState {
  FEntityId LineId = 0;
  uint16_t ItemTypeDominant = kNoItem;  // most-common item (scrolling material)
  uint8_t FlowSpeedQuant = 0;           // units/tick quantized → scroll rate
  uint8_t Density = 0;                  // 0..255 fill fraction → "fullness"
  uint8_t Compressed = 0;               // latched flag (cheaper render path)
};

// One discrete item on a line — returned ONLY by GetLineItems at LOD-0, where
// rendering places an item mesh along the sim's baked pathUnitToWorld. This is
// the single O(items) pull in the whole contract (§6.2).
struct FLineItem {
  ItemId ItemType = kNoItem;
  uint32_t UnitOffset = 0;  // distance from the line head, in §2 sub-tile units
};

// =============================================================================
// §2 — Transport line: belt compression via terminal gaps + item-offset gaps.
//
// One TransportLine replaces N belt tiles. Items are stored as the *gap before*
// each item (units), never as absolute positions. Moving the whole flowing line
// is a single `headGap -=` — nothing else is touched (the §2 scale win).
//
// Layout per line:
//   headGap          free units before the FIRST (lead) item — the only thing
//                    that moves when flowing.
//   itemGaps[i]      gap (units) before item i, for i >= 1 (gap between item
//                    i-1 and item i). itemGaps[0] is unused (item 0's lead gap
//                    IS headGap). Items themselves store no position.
//   tailGap          free units after the LAST item (where new items enter).
//   capacityUnits    = tiles * 256.
//
// -----------------------------------------------------------------------------
// THE INVARIANT (FS-30). It holds after EVERY operation, with no exceptions and
// no "modulo what enters and leaves at the ends" hedge:
//
//     headGap + Σ(itemGaps[k], k > head_) + itemCount()*kItemSpacing + tailGap
//       ==  capacityUnits
//
// It is not an accounting convention, it is a statement about geometry, and that
// is why every operation must preserve it. Give each item a position: measure
// offsets from the HEAD of the line toward the tail, so
//
//     o(head_)  = headGap                            (the lead item)
//     o(k)      = o(k-1) + kItemSpacing + itemGaps[k]  (k > head_)
//
// and let every item's body occupy kItemSpacing of flow-axis length starting at
// its own offset. Then tailGap is defined as the room left over behind the last
// body, tailGap = capacityUnits - o(last) - kItemSpacing, and substituting the
// recurrence gives exactly the sum above. So the invariant says one thing only:
// THE LAYOUT FITS ON THE BELT. Occupied length plus free length is the length.
//
// Two rules follow, and between them they decide every case in this struct:
//   * An operation that MOVES items must move the free space the other way. The
//     column sliding `d` units toward the head spends `d` of headGap and must
//     credit `d` to tailGap, because the room the column vacated is behind it.
//   * An operation that ADDS or REMOVES an item changes the occupied term by
//     kItemSpacing and must charge that to the end where the change happened —
//     the head side for a head removal, the tail side for a tail insert or
//     removal, the following item's lead gap for an interior removal. Charging
//     it to BOTH ends mints belt out of nothing.
//
// Three operations each broke a different one of those rules for months (see
// invariantHolds() below and the FS-30 tests): popHead credited the tail for a
// removal the head had already absorbed (+kItemSpacing per pop), advance() spent
// headGap and credited nothing (-speedUnitsPerTick per flowing tick), and the
// two partly cancelled, which is why neither showed up as a runaway number. The
// observable was that a belt fed by a drill carried ONE item however fast the
// drill ran, because the room a moving item vacates at the tail was never given
// back and so no second item could ever enter.
//
// Note what is NOT part of the invariant, because it is a real behavioural limit
// and naming it is cheaper than rediscovering it: while the head is BLOCKED
// (headGap == 0) nothing on the line moves at all, so an interior gap left by a
// hand pick (takeAt) does not close up behind a stalled belt the way Factorio's
// would. That is invariant-preserving (the layout still fits) and it is deferred
// as FS-32, pinned by belt_blocked_line_does_not_compress_interior_gaps.
// =============================================================================
struct TransportLine {
  uint32_t capacityUnits = 0;       // tiles * kUnitsPerTile
  uint32_t speedUnitsPerTick = 8;   // belt-tier speed (8 basic .. 32 turbo)
  uint32_t headGap = 0;             // free units before the lead item
  uint32_t tailGap = 0;             // free units after the last item
  std::vector<uint32_t> itemGaps;   // EXTRA free units before item i (slot head_=0)
  std::vector<ItemId> itemTypes;    // item id at slot i (parallel to itemGaps)
  uint32_t head_ = 0;               // cursor: lead item index (O(1) head-pop)
  bool fullyCompressed = false;     // latched once compressed (Factorio invariant)

  // Live items occupy [head_, size). Popping the head just advances head_ — the
  // items themselves are never shifted (Factorio's "do not touch items").
  size_t itemCount() const { return itemTypes.size() - head_; }
  bool empty() const { return head_ >= itemTypes.size(); }

  // --- The invariant, as code (FS-30). ---------------------------------------
  // Published on the struct rather than re-derived in each test file, because a
  // test-local copy of an invariant is a second definition of it: the previous
  // one lived only in test_factory_sim.cpp, was applied to exactly ONE of the
  // five mutating operations, and where it collided with advance() the test was
  // written to absorb the discrepancy rather than to report it. O(items) and
  // therefore a TEST/debug call, never a per-tick one — the hot path preserves
  // the invariant by construction, which is the whole point of writing it down.
  uint64_t invariantSum() const {
    uint64_t sum = static_cast<uint64_t>(headGap) + tailGap;
    for (size_t k = head_ + 1; k < itemGaps.size(); ++k) sum += itemGaps[k];
    sum += static_cast<uint64_t>(itemCount()) * kItemSpacing;
    return sum;
  }
  bool invariantHolds() const { return invariantSum() == capacityUnits; }

  // How many items this line can physically hold, min-spaced: the number a
  // saturated belt actually carries, and the ceiling tryPushTail enforces by
  // arithmetic rather than by a second constant.
  uint32_t maxItems() const { return capacityUnits / kItemSpacing; }

  // --- Tail input (§2.3): try to append an item at the line's tail. ----------
  // Succeeds (returns true) only if there is min-spacing room at the tail.
  // A new item enters at the far (tail) end and must travel the line's length to
  // reach the head. Because items load one-at-a-time at the tail, a second item
  // can only enter after the first has advanced (freeing tail room) — exactly
  // how a real belt fills. Use fillSaturated() to construct an already-full line.
  bool tryPushTail(ItemId item) {
    if (tailGap < kItemSpacing) return false;
    if (empty()) {
      // First item: it enters AT THE TAIL, so it eats the tail room and must
      // travel everything ahead of it to reach the head. DERIVED from the two
      // gaps rather than written as `capacityUnits - kItemSpacing`, so it is
      // the invariant that decides the value and not a second copy of it: on an
      // empty line headGap + tailGap == capacityUnits by the invariant, and the
      // new item converts kItemSpacing of that free span into occupied length.
      //
      // FS-30 note, because the belt lane's escalation named this line as the
      // one-item bug and it is worth being exact about why it was not: leaving
      // tailGap at 0 here is geometrically CORRECT — an item standing on the
      // last 64 units of the belt has nothing behind it. The reason no second
      // item could ever follow it was advance(), which moved the first item off
      // the tail without ever giving the vacated room back. Had this line been
      // "fixed" on its own (say to capacityUnits - kItemSpacing) the belt would
      // have accepted a second item into the space the first one was standing
      // in, which is the different wrong answer rather than the right one.
      head_ = 0;
      itemGaps.assign(1, 0);
      itemTypes.assign(1, item);
      headGap = headGap + tailGap - kItemSpacing;
      tailGap = 0;
    } else {
      // A trailing item packs min-spaced behind the last (no extra gap).
      itemGaps.push_back(0);
      itemTypes.push_back(item);
      tailGap -= kItemSpacing;
    }
    return true;
  }

  // --- Construct an already-saturated line (scene setup, not the hot path). ---
  // Fills the line to capacity with `item`, min-spaced, lead item at the head
  // (compressed + flowing). Models a belt that has been running and is full.
  // Returns the number of items placed. O(items) ONCE at setup — never per tick.
  uint32_t fillSaturated(ItemId item) {
    head_ = 0;
    uint32_t n = capacityUnits / kItemSpacing;  // 4 items / tile / lane
    itemGaps.assign(n, 0);   // all min-spaced (no extra gaps)
    itemTypes.assign(n, item);
    headGap = 0;             // lead item at the head, ready for a consumer
    tailGap = capacityUnits - n * kItemSpacing;
    fullyCompressed = true;  // latched
    return n;
  }

  // --- Head output (§2.3): is the lead item presented at the head? ----------
  bool headReady() const { return !empty() && headGap == 0; }
  ItemId headItem() const { return empty() ? kNoItem : itemTypes[head_]; }

  // Pop the lead item (consumer took it). O(1): advance the head cursor.
  //
  // The freed span (the popped item's kItemSpacing body plus the new lead
  // item's extra gap) is charged to the HEAD side and to the head side ONLY,
  // because that is where the hole is: nothing at the tail moved, so the tail
  // gains nothing. This is the identical rule takeAt's head case follows, and
  // the two are now the same three lines.
  //
  // FS-30: this used to ALSO do `tailGap += kItemSpacing`, minting one item of
  // belt per pop. The invariant sum read capacityUnits + 64 after a single pop
  // and grew without bound on a running line, so a long-lived belt could accept
  // more items than its own length. It partly cancelled advance()'s equal and
  // opposite error, which is how a line whose accounting was wrong in two
  // directions at once still looked plausible for months.
  ItemId popHead() {
    if (empty()) return kNoItem;
    ItemId taken = itemTypes[head_];
    ++head_;
    if (!empty()) {
      // new lead: the freed body + its own extra gap become part of headGap.
      // `+=` rather than `=`: identical when headGap == 0, which is popHead's
      // documented precondition (headReady()), and correct rather than
      // line-snapping if a future caller ever pops mid-flow.
      headGap += itemGaps[head_] + kItemSpacing;
      itemGaps[head_] = 0;
    } else {
      // Line empty: reset to EXACTLY the state addBeltLine leaves behind, which
      // is the one empty state the invariant admits (0 + 0 + 0 + capacity).
      head_ = 0;
      itemGaps.clear();
      itemTypes.clear();
      headGap = 0;
      tailGap = capacityUnits;
    }
    fullyCompressed = false;  // removing from head decompresses
    return taken;
  }

  // --- Manual pick-off (§2.3, the PLAYER's verb): take ONE item at `slot`. ---
  //
  // popHead is the CONSUMER's verb: it only ever removes the item presented at
  // the head, and it is allowed to assume headGap == 0 because nothing is
  // presented until the lead item has travelled the whole line. A player aiming
  // at a belt and pulling an item off it is a different verb: the item can sit
  // anywhere in [head_, size), the line is normally mid-flow (headGap > 0), and
  // the one property a player notices instantly at LOD-0 is that nothing ELSE
  // on the belt may twitch. Items are stored as gaps, never as positions (§2),
  // so the naive "erase the slot" drags every item behind the hole FORWARD by
  // kItemSpacing plus the erased item's own extra gap: 64 units at the absolute
  // minimum, a quarter of a tile, which GetLineItems reports and rendering
  // draws as the whole tail of the belt teleporting on the frame of the pick.
  //
  // So each case donates the freed span (the item's kItemSpacing body plus its
  // extra gap) to whichever neighbouring gap leaves every surviving offset
  // byte-identical. That is the same bookkeeping that keeps the §2 invariant
  //   headGap + Σ(itemGaps[k], k>head_) + itemCount*kItemSpacing + tailGap
  //     == capacityUnits
  // balanced after every take:
  //   head slot : headGap += kItemSpacing + itemGaps[head_+1]; that gap zeroes
  //               (the new lead item's gap IS headGap) and head_ advances.
  //               tailGap is UNTOUCHED, because the head side already absorbed
  //               the freed span. This is precisely where popHead's shortcut
  //               would be wrong: it rebuilds headGap from 0, which on a
  //               mid-flow line throws away the travel the lead item has
  //               already done and snaps the whole line backwards.
  //   last slot : tailGap += kItemSpacing + itemGaps[slot]. The tail is the one
  //               end that legitimately gains room, because the hole really is
  //               at the tail and a new item may now enter there.
  //   interior  : itemGaps[slot+1] += kItemSpacing + itemGaps[slot]; the hole is
  //               absorbed into the FOLLOWING item's lead gap, so both ends of
  //               the line stay exactly where they were.
  // Taking the SOLE item resets the line to the state addBeltLine leaves it in,
  // so a drained line refills byte-identically to a freshly placed one.
  //
  // Cost: O(items) for the two erasing cases, against popHead's O(1). That is
  // deliberate. A hand pick is a cold, human-rate action (one call per player
  // input), never part of the tick that advances 40,000 lines inside 16.67 ms
  // in the G1 benchmark, so clarity here is worth more than an in-place shuffle.
  // Returns kNoItem (and changes nothing) if the line is empty or `slot` is not
  // a live slot.
  ItemId takeAt(size_t slot) {
    if (empty()) return kNoItem;
    if (slot < head_ || slot >= itemTypes.size()) return kNoItem;
    const ItemId taken = itemTypes[slot];
    const size_t last = itemTypes.size() - 1;
    if (itemCount() == 1) {
      // Sole item: reclaim storage and return to the fresh-line state exactly,
      // so "drain a belt by hand then rebuild on it" cannot leave a phantom gap
      // that would make the next tryPushTail behave differently from the first.
      head_ = 0;
      itemGaps.clear();
      itemTypes.clear();
      headGap = 0;
      tailGap = capacityUnits;
    } else if (slot == head_) {
      headGap += kItemSpacing + itemGaps[head_ + 1];
      itemGaps[head_ + 1] = 0;
      ++head_;
    } else if (slot == last) {
      tailGap += kItemSpacing + itemGaps[slot];
      itemGaps.pop_back();
      itemTypes.pop_back();
    } else {
      itemGaps[slot + 1] += kItemSpacing + itemGaps[slot];
      itemGaps.erase(itemGaps.begin() + static_cast<std::ptrdiff_t>(slot));
      itemTypes.erase(itemTypes.begin() + static_cast<std::ptrdiff_t>(slot));
    }
    // Same reasoning as popHead: a line that just lost an item is no longer
    // provably min-spaced, and the latched-compression fast path must not be
    // trusted until advance() re-observes it.
    fullyCompressed = false;
    return taken;
  }

  // --- Advance one tick (§2.2): the O(1) flowing case. -----------------------
  // If the lead item is not yet at the head, move the whole COLUMN forward by
  // speed. If it reaches the head, clamp at 0 (waiting for a consumer).
  // Interior item gaps are NOT touched while flowing: the column moves rigidly,
  // so every gap between two items is preserved and only the two ENDS change.
  //
  // FS-30: the two ends is the point. This used to spend headGap and credit
  // nothing, so the invariant sum fell by speedUnitsPerTick on every flowing
  // tick — the line quietly forgot it was capacityUnits long. That is the
  // one-item belt, and it is worth stating in physical terms because the arrow
  // of the bug is not obvious from the arithmetic: the room a moving item
  // VACATES is behind it, at the tail, and giving it back is what lets a second
  // item follow the first. Without the credit a freshly placed belt sets
  // tailGap to 0 when its first item boards and never raises it again, so
  // tryPushTail refuses forever and the belt carries exactly one ore however
  // hard it is fed. Two operations, one subtraction each, one line apart.
  void advance() {
    if (empty()) return;
    if (headGap == 0) return;  // head blocked, waiting on consumer (see FS-32)
    // The distance the column actually travels this tick: it cannot overrun the
    // head, and whatever it travels is exactly what the tail gains.
    const uint32_t moved =
        headGap < speedUnitsPerTick ? headGap : speedUnitsPerTick;
    headGap -= moved;
    tailGap += moved;
    if (headGap == 0) {
      // Latch compression once, at the transition — O(items) but amortized
      // O(1)/tick since it runs only on the first arrival, not every tick.
      if (!fullyCompressed && isMinSpaced()) fullyCompressed = true;
    }
  }

  bool isMinSpaced() const {
    for (size_t i = head_ + 1; i < itemGaps.size(); ++i)
      if (itemGaps[i] > 0) return false;  // extra gap = 0 means min-spaced
    return true;
  }
};

// =============================================================================
// §1.3 — SoA component arrays + §4 power + §3 sleep, all under one sim object.
//
// Entities are dense: arrays are parallel and indexed by handle.index. A free
// list recycles slots (generation bumped on free). The hot per-tick loops walk
// a compact `active_` index list (§3), not the full arrays.
// =============================================================================

enum class EntityKind : uint8_t {
  None = 0,
  Machine,    // smelter / assembler: timed recipe progress (powered)
  Inserter,   // moves one item per swing between src and dst
  BeltLine,   // a transport line (its own TransportLine record)
  PowerGen,   // generator (supply)
  Miner,      // bound to a deposit: extracts raw ore at a rate into its out-slot
  // FS-66: a STORAGE CONTAINER. Holds ONE item type up to a capacity, and has
  // NO recipe, NO progress and NO system of its own: the inserters do all the
  // work at both ends, so a container never ticks.
  //
  // THE ABSENCE OF A RECIPE IS THE WHOLE DESIGN, and it is why this is an
  // EntityKind rather than the pass-through machine FS-49 refused. A machine
  // whose recipe turns item X into item X in one tick would have worked, and it
  // would have called `recordProduced` on every unit that passed through, so
  // `producedCountOf` (a LIFETIME PRODUCTION tally that the report publishes and
  // the probes read) would count a box passing 500 iron along as having
  // MANUFACTURED 500 iron. Storage would become production in the one ledger
  // that answers "what did the factory make". Here that cannot happen by
  // CONSTRUCTION rather than by anybody remembering the rule: there is no
  // Recipe to record against and no code path from a container to
  // `recordProduced`.
  Container,
};

// Inserter phase: a simple two-phase swing (pick -> drop).
enum class InserterPhase : uint8_t { Idle = 0, Holding = 1 };

// A synthetic recipe: consume N input items, take T ticks, produce M output.
//
// Multi-input (assembler): a SECOND optional input ingredient (input2Item /
// input2Count) is additive — it defaults to kNoItem (count 0), so every existing
// single-input caller is unchanged (the machine ignores a kNoItem second input).
// A smelter is a single-input recipe (ore->ingot); an assembler is a multi-input
// recipe (e.g. iron + copper ingots -> a crafted part). Both run on the SAME
// powered SoA machine path — see the §1.4(3) MachineSystem.
struct Recipe {
  ItemId inputItem = kNoItem;
  uint16_t inputCount = 1;
  ItemId input2Item = kNoItem;   // optional 2nd ingredient (assembler); kNoItem=unused
  uint16_t input2Count = 0;      // units of the 2nd ingredient per craft
  ItemId outputItem = kNoItem;
  uint16_t outputCount = 1;
  uint32_t craftTimeTicks = 60;
  int32_t powerW = 1000;  // demand while crafting (§4)
};

class FactorySim {
 public:
  explicit FactorySim(double fixedDt = 1.0 / 60.0) : clock_(fixedDt) {}

  // --------------------------------------------------------------------------
  // Construction API (build the scene). Not on the hot path.
  // --------------------------------------------------------------------------

  // Add a belt transport line spanning `tiles` belt tiles at `speed` units/tick.
  EntityHandle addBeltLine(uint32_t tiles, uint32_t speed = 8) {
    if (tiles > kMaxLineTiles) tiles = kMaxLineTiles;
    EntityHandle h = alloc(EntityKind::BeltLine);
    TransportLine& line = lines_[h.index];
    line = TransportLine{};
    line.capacityUnits = tiles * kUnitsPerTile;
    line.speedUnitsPerTick = speed;
    line.headGap = 0;
    line.tailGap = line.capacityUnits;
    return h;
  }

  // Add a machine running `recipe`. Starts asleep until fed.
  EntityHandle addMachine(const Recipe& recipe) {
    EntityHandle h = alloc(EntityKind::Machine);
    recipeId_[h.index] = static_cast<uint16_t>(recipes_.size());
    recipes_.push_back(recipe);
    progressTicks_[h.index] = 0;
    inSlotItem_[h.index] = recipe.inputItem;
    inSlotCount_[h.index] = 0;
    in2SlotItem_[h.index] = recipe.input2Item;
    in2SlotCount_[h.index] = 0;
    outSlotItem_[h.index] = recipe.outputItem;
    outSlotCount_[h.index] = 0;
    outCap_[h.index] = 0;  // unbounded by default (legacy behaviour)
    onRails_[h.index] = 0;
    demandW_[h.index] = 0;
    networkId_[h.index] = 0;
    crafting_[h.index] = 0;
    return h;
  }

  // FS-66: add a STORAGE CONTAINER holding up to `capacity` units of ONE item
  // type. `item` may be given to pin the type up front (a filtered chest); left
  // as kNoItem the FIRST item to arrive claims the slot, and everything else is
  // refused from then on with back pressure, which is FS-37's typed-acceptance
  // grammar applied to storage rather than a second acceptance model.
  //
  // ONE TYPE AND NOT A SLOT ARRAY, deliberately and for this version only. A
  // multi-slot chest needs a slot array, a filter model and a stack model, and
  // is a different mechanic; shipping one type with a capacity is a container
  // that is honest about what it is, and it composes with the inserter's
  // existing single-slot drain path with no special case.
  //
  // It occupies the out-slot arrays because a container's INPUT and OUTPUT are
  // the same pool: an inserter drains it exactly as it drains a machine or a
  // miner, which is why the drain branch needed one added kind rather than a
  // new branch.
  EntityHandle addContainer(uint16_t capacity, ItemId item = kNoItem) {
    EntityHandle h = alloc(EntityKind::Container);
    outSlotItem_[h.index] = item;
    outSlotCount_[h.index] = 0;
    outCap_[h.index] = capacity;
    inSlotItem_[h.index] = kNoItem;
    inSlotCount_[h.index] = 0;
    in2SlotItem_[h.index] = kNoItem;
    in2SlotCount_[h.index] = 0;
    demandW_[h.index] = 0;
    networkId_[h.index] = 0;
    crafting_[h.index] = 0;
    onRails_[h.index] = 0;
    return h;
  }

  // Would this container take `item` right now? False when it is full, or when
  // it already holds a different type. The ONE definition of container
  // acceptance, exactly as `machineAcceptsItem` is the one definition for a
  // machine (FS-37): the inserter asks this at pickup AND at drop, so a refused
  // item stays where it is and the line backs up visibly.
  bool containerAcceptsItem(EntityHandle h, ItemId item) const {
    return h.valid() && kind_[h.index] == EntityKind::Container &&
           item != kNoItem && containerAcceptsAt(h.index, item);
  }
  ItemId containerItem(EntityHandle h) const {
    return h.valid() && kind_[h.index] == EntityKind::Container
               ? outSlotItem_[h.index] : kNoItem;
  }
  uint16_t containerCount(EntityHandle h) const {
    return h.valid() && kind_[h.index] == EntityKind::Container
               ? outSlotCount_[h.index] : 0;
  }
  uint16_t containerCapacity(EntityHandle h) const {
    return h.valid() && kind_[h.index] == EntityKind::Container
               ? outCap_[h.index] : 0;
  }
  // Take up to `want` units out by hand. Returns what actually moved. Clearing
  // the last unit RELEASES the type, so an emptied chest can be refilled with
  // something else, which is what makes the one-type rule usable rather than a
  // permanent commitment made by whatever wandered in first.
  uint16_t containerTake(EntityHandle h, uint16_t want) {
    if (!h.valid() || kind_[h.index] != EntityKind::Container) return 0;
    const uint16_t got = want < outSlotCount_[h.index] ? want
                                                       : outSlotCount_[h.index];
    outSlotCount_[h.index] -= got;
    if (outSlotCount_[h.index] == 0) outSlotItem_[h.index] = kNoItem;
    return got;
  }
  // Hand-fill, for restoring a save and for tests. Returns what was ACCEPTED,
  // so a caller stores what the container really holds rather than what it
  // hoped to give it.
  uint16_t containerInsert(EntityHandle h, ItemId item, uint16_t count) {
    if (!containerAcceptsItem(h, item)) return 0;
    const uint16_t room = static_cast<uint16_t>(outCap_[h.index] -
                                                outSlotCount_[h.index]);
    const uint16_t got = count < room ? count : room;
    outSlotItem_[h.index] = item;
    outSlotCount_[h.index] += got;
    return got;
  }

  // Add an inserter that moves `item` from a belt-line head into a machine input
  // (or between two endpoints, generically: src head -> dst input).
  EntityHandle addInserter(EntityHandle src, EntityHandle dst, ItemId item) {
    EntityHandle h = alloc(EntityKind::Inserter);
    insSrc_[h.index] = src;
    insDst_[h.index] = dst;
    insItem_[h.index] = item;
    insPhase_[h.index] = InserterPhase::Idle;
    insHeld_[h.index] = kNoItem;
    return h;
  }

  // Add a power generator (supply) into a network.
  EntityHandle addGenerator(uint16_t network, int32_t supplyW) {
    EntityHandle h = alloc(EntityKind::PowerGen);
    networkId_[h.index] = network;
    supplyW_[h.index] = supplyW;
    ensureNetwork(network);
    return h;
  }

  // Add a MINER bound to a depletable deposit (§Phase-1 mining). The miner holds
  // `depositAmount` units of ore item `item`, and extracts `ratePerSecond` units
  // per second (converted to milli-units/tick at the clock's fixed dt) into its
  // out-slot each powered tick — depleting the deposit and STOPPING when empty.
  // The UE placement layer binds an `FDepositNode` (deposits.h) to this: pass the
  // node's RemainingAmount + Resource id (and, optionally, a grade-scaled rate).
  // Output drains via the SAME inserter path as a machine out-slot, so a miner
  // feeds a belt with no special case. Starts asleep until the active set wakes
  // it (placeMiner in automation.h forces it active).
  EntityHandle addMiner(uint64_t depositAmount, ItemId item,
                        double ratePerSecond = 1.0, uint16_t outCap = 0) {
    EntityHandle h = alloc(EntityKind::Miner);
    minerRemaining_[h.index] = depositAmount;
    minerItem_[h.index] = item;
    // rate (units/s) -> milli-units/tick = ratePerSecond * 1000 * fixedDt.
    double milliPerTick = ratePerSecond * 1000.0 * clock_.fixedDt();
    if (milliPerTick < 0.0) milliPerTick = 0.0;
    minerRateMilliPerTick_[h.index] =
        static_cast<uint32_t>(milliPerTick + 0.5);
    if (minerRateMilliPerTick_[h.index] == 0 && ratePerSecond > 0.0)
      minerRateMilliPerTick_[h.index] = 1;  // floor at 1 milli/tick if any rate
    minerAccum_[h.index] = 0;
    minerOutCap_[h.index] = outCap;
    // The miner's out-slot lives in the shared machine arrays (so inserters drain
    // it identically). Tag the out item; leave count at 0 (filled by mining).
    outSlotItem_[h.index] = item;
    outSlotCount_[h.index] = 0;
    networkId_[h.index] = 0;
    return h;
  }

  // Bind a machine to a power network (so it draws + is throttled by brownout).
  void setMachineNetwork(EntityHandle m, uint16_t network) {
    if (!m.valid()) return;
    networkId_[m.index] = network;
    ensureNetwork(network);
  }

  // ==========================================================================
  // POWER BINDING (power.h). Two additive hooks, both default-off, so every
  // existing caller keeps the self-contained integer-network behaviour.
  // ==========================================================================

  // Give a MINER a real power draw (watts while it is extracting). 0, the
  // default, is the historical free-rider behaviour. A miner's extraction rate
  // has always been scaled by its network's brownout; this makes it also
  // CONTRIBUTE to the demand that causes one.
  void setMinerPower(EntityHandle h, int32_t watts) {
    if (h.valid()) minerPowerW_[h.index] = watts < 0 ? 0 : watts;
  }
  int32_t minerPower(EntityHandle h) const { return minerPowerW_[h.index]; }

  // Hand the satisfaction decision to an external authority (an of::power::
  // PowerGrid). While set, powerSolveSystem() still computes every entity's
  // wanted draw — the grid reads exactly that — but stops writing the per-network
  // factor, so there is only ever ONE answer to "how browned out is this
  // network". The caller writes the grid's answer back with
  // setNetworkSatisfactionQ16 before stepping.
  void setExternalPowerAuthority(bool on) { externalPower_ = on ? 1 : 0; }
  bool externalPowerAuthority() const { return externalPower_ != 0; }

  // Write a network's satisfaction factor (Q16.16). Only meaningful alongside
  // setExternalPowerAuthority(true); otherwise the next step() overwrites it.
  void setNetworkSatisfactionQ16(uint16_t network, uint32_t q16) {
    ensureNetwork(network);
    netBrownoutQ16_[network] = q16;
  }

  // Recompute every active entity's wanted draw WITHOUT advancing anything else
  // — the demand half of the tick, lifted out so an external grid can solve on
  // this tick's demand rather than last tick's. Read demandW_ with entityDemandW.
  void refreshPowerDemand() { powerSolveSystem(); }

  // This entity's wanted draw in watts as of the last power solve. 0 for an
  // entity that is idle, starved, output-blocked, or has no power model.
  int32_t entityDemandW(EntityHandle h) const {
    if (!h.valid() || static_cast<size_t>(h.index) >= demandW_.size()) return 0;
    return demandW_[h.index];
  }
  uint16_t networkOf(EntityHandle h) const {
    if (!h.valid() || static_cast<size_t>(h.index) >= networkId_.size()) return 0;
    return networkId_[h.index];
  }

  // --------------------------------------------------------------------------
  // Active set (§3 update-on-demand). The benchmark forces everything active.
  // --------------------------------------------------------------------------
  void setActive(EntityHandle h, bool active) {
    if (!h.valid()) return;
    if (active) {
      if (sleeping_[h.index]) {
        sleeping_[h.index] = 0;
        active_.push_back(h.index);  // re-enter the iterated set
      }
    } else {
      sleeping_[h.index] = 1;  // lazily skipped during iteration
    }
  }

  // Wake everything (forced-active worst case, §7).
  void forceAllActive() {
    active_.clear();
    for (uint32_t i = 0; i < kind_.size(); ++i) {
      if (kind_[i] == EntityKind::None) continue;
      sleeping_[i] = 0;
      active_.push_back(i);
    }
  }

  size_t activeCount() const {
    size_t n = 0;
    for (uint32_t i : active_)
      if (!sleeping_[i]) ++n;
    return n;
  }
  size_t entityCount() const { return liveCount_; }

  // --------------------------------------------------------------------------
  // §1.4 — THE FIXED TICK. Systems run in a fixed deterministic order over the
  // active set. This is the hot loop the benchmark times.
  // --------------------------------------------------------------------------
  void step() {
    powerSolveSystem();    // 1. per-network supply/demand -> brownout (§4)
    minerSystem();         // 2. extract ore from bound deposits into out-slots
    machineSystem();       // 3. advance recipe progress (x brownout), produce
    inserterSystem();      // 4. pick from src head -> drop into dst input
    beltSystem();          // 5. advance transport lines (the §2 O(1) case)
    // (wake/stream systems are no-ops in the forced-active benchmark)
    clock_.advance(clock_.fixedDt());
  }

  // --------------------------------------------------------------------------
  // Read accessors (for tests / stream — not hot).
  // --------------------------------------------------------------------------
  TransportLine& line(EntityHandle h) { return lines_[h.index]; }
  const TransportLine& line(EntityHandle h) const { return lines_[h.index]; }
  uint16_t machineOutput(EntityHandle h) const { return outSlotCount_[h.index]; }
  uint16_t machineInput(EntityHandle h) const { return inSlotCount_[h.index]; }
  uint16_t machineInput2(EntityHandle h) const { return in2SlotCount_[h.index]; }
  uint32_t machineProgress(EntityHandle h) const { return progressTicks_[h.index]; }
  // Milliticks for ONE craft of this machine's recipe (craftTimeTicks * 1000) —
  // the denominator machineProgress() counts up toward. Lets a facade (automation.h)
  // report normalized craft progress without reaching into the recipe table. 0 for
  // a non-machine handle (no recipe). Additive, read-only.
  uint32_t machineProgressTarget(EntityHandle h) const {
    if (!h.valid() || kind_[h.index] != EntityKind::Machine) return 0;
    return recipes_[recipeId_[h.index]].craftTimeTicks * 1000u;
  }
  // Is this machine mid-craft RIGHT NOW (the §1.4(3) crafting_ flag)? True only
  // between a craft starting (inputs consumed) and completing this tick. Read-only.
  bool machineCrafting(EntityHandle h) const {
    if (!h.valid() || kind_[h.index] != EntityKind::Machine) return false;
    return crafting_[h.index] != 0;
  }

  // Lifetime WORK this entity has actually performed, as a monotonic fixed-point
  // counter (FS-35, the pollution integration's duty meter — also a utilization
  // probe for a HUD). Units are the entity's own hot-loop fixed point, so a
  // window's duty cycle is (delta / full-rate-delta) with no float in the sim:
  //   * Machine: craft-progress MILLITICKS actually advanced. Full power and
  //     continuously crafting is exactly 1000 per tick; a brownout at
  //     satisfaction s advances (1000*s)>>16, so browned-out work reads
  //     proportionally lower BY THE SAME ARITHMETIC that slowed the craft. A
  //     starved or output-blocked machine advances nothing and reads 0.
  //   * Miner: extraction MILLI-UNITS accrued. Full rate is exactly
  //     minerRateMilliPerTick() per tick; a depleted or out-blocked miner
  //     accrues nothing. (Whole units mined would jitter with the accumulator
  //     phase; the accrual is the smooth, exact measure of work done.)
  //   * Everything else: 0.
  // Never reset, never decremented; on-rails advance does NOT accrue (a demoted
  // chunk's pollution is part of the on-rails seam, deliberately out of scope).
  uint64_t workMilli(EntityHandle h) const {
    if (!h.valid() || static_cast<size_t>(h.index) >= workMilli_.size()) return 0;
    return workMilli_[h.index];
  }

  // A miner's extraction rate in milli-units per tick — the workMilli() full-rate
  // denominator, exposed so a facade never re-derives the rounding in addMiner.
  uint32_t minerRateMilliPerTick(EntityHandle h) const {
    if (!h.valid() || kind_[h.index] != EntityKind::Miner) return 0;
    return minerRateMilliPerTick_[h.index];
  }

  // Remove up to `want` units from a machine's / miner's output buffer, and
  // return how many were actually removed. This is the MANUAL-COLLECTION verb:
  // it is exactly what inserterSystem already does internally (§3 drains a
  // source out-slot one unit at a time), lifted to a public call so a player can
  // empty a smelter by hand. Exposing it here rather than letting a UI layer
  // reach into the SoA is what keeps ONE accounting of these units: the buffer
  // that shrinks is the same buffer the belt would have drained, so a collected
  // ingot cannot also flow onwards. Non-hot, additive, no tick side effects.
  uint16_t takeMachineOutput(EntityHandle h, uint16_t want) {
    if (!h.valid() || want == 0) return 0;
    if (static_cast<size_t>(h.index) >= outSlotCount_.size()) return 0;
    const uint16_t have = outSlotCount_[h.index];
    const uint16_t took = have < want ? have : want;
    outSlotCount_[h.index] = static_cast<uint16_t>(have - took);
    return took;
  }

  // Miner read accessors (out-slot count reuses machineOutput()). minerRemaining
  // is the units of ore left in the bound deposit; 0 == depleted (miner stalled).
  uint64_t minerRemaining(EntityHandle h) const { return minerRemaining_[h.index]; }
  uint16_t minerOutput(EntityHandle h) const { return outSlotCount_[h.index]; }
  bool minerDepleted(EntityHandle h) const { return minerRemaining_[h.index] == 0; }

  // Item-id accessors for the buildable-network wiring layer (automation.h):
  // the out item a miner/machine yields, and the slot-1 input item a machine
  // consumes. Cheap reads of the SoA tag fields; used to infer inserter item ids.
  ItemId outputItemOf(EntityHandle h) const { return outSlotItem_[h.index]; }
  ItemId inputItemOf(EntityHandle h) const { return inSlotItem_[h.index]; }
  ItemId input2ItemOf(EntityHandle h) const { return in2SlotItem_[h.index]; }
  // The item currently at a belt line's head (kNoItem if empty) — lets the
  // wiring layer infer what a belt carries when connecting it to a sink.
  ItemId lineHeadItem(EntityHandle h) const { return lines_[h.index].headItem(); }

  // FS-37: would this machine accept `item` from a transfer? True iff the
  // machine's CURRENT recipe consumes it (slot-1 ingredient, or the optional
  // slot-2 ingredient). Data-driven off the recipe tag fields addMachine wrote,
  // never a per-item special case; when machines grow a fuel buffer, "is a
  // valid fuel here" joins this predicate as its third clause. This is the ONE
  // definition of item acceptance — inserterSystem enforces it at pickup and
  // again at drop, so an item a recipe does not consume can never enter an
  // input slot and be transmuted by the count-based craft loop.
  bool machineAcceptsItem(EntityHandle m, ItemId item) const {
    return m.valid() && kind_[m.index] == EntityKind::Machine &&
           machineAcceptsAt(m.index, item);
  }
  // What an inserter currently holds (kNoItem if empty). An identity-conserving
  // ledger (mined == in-flight + buffered + consumed, PER item type) has to be
  // able to see the one unit that can legitimately sit in an inserter's hand.
  ItemId inserterHeldItem(EntityHandle h) const { return insHeld_[h.index]; }
  uint64_t tickIndex() const { return clock_.tickIndex(); }

  // Cumulative count of items ever produced by any machine (monotonic; never
  // decremented when an inserter drains an out-slot). Added for the headless
  // integration harness so it can assert "the factory keeps producing" across a
  // whole flight (the active/on-rails journey). Non-breaking, additive: the hot
  // loop already increments outSlotCount_ on craft completion; this just sums
  // the same events into a separate never-decreasing counter. (INT-1, flagged
  // to Admin — see docs/phase1/M2-integration.md.)
  uint64_t producedCount() const { return totalProduced_; }

  // Cumulative count of items of a SPECIFIC output ItemId ever produced
  // (monotonic; same craft events as producedCount(), partitioned per
  // outputItem). The slice loop's mine→factory→science→research chain needs to
  // ask "how many AutomationScience did the factory make?" — a single monotonic
  // total can't answer that. This accumulates per recipe.outputItem in lockstep
  // with totalProduced_, so Σ producedCountOf(id) over all ids == producedCount()
  // (kNoItem outputs — e.g. the generator's power-only "recipe" — contribute to
  // neither, since outputCount is 0 there). Backward-compatible + additive: the
  // existing total is untouched; this is a parallel per-key breakdown. (GAP-2.)
  uint64_t producedCountOf(ItemId item) const {
    for (const ItemProduced& p : producedByItem_)
      if (p.item == item) return p.count;
    return 0;
  }

  // Manually feed a machine input (for inserter-free correctness tests).
  void feedMachine(EntityHandle h, uint16_t count) { inSlotCount_[h.index] += count; }
  // Feed the 2nd ingredient slot (assembler correctness tests).
  void feedMachine2(EntityHandle h, uint16_t count) { in2SlotCount_[h.index] += count; }

  // Network brownout factor as a ratio (read after a step) — float for tests.
  double brownoutRatio(uint16_t network) const {
    if (network >= netBrownoutQ16_.size()) return 1.0;
    return static_cast<double>(netBrownoutQ16_[network]) / 65536.0;
  }

  // Set per-tick wanted demand floor on a network (extra constant consumers),
  // so a brownout can be exercised without thousands of machines.
  void addNetworkBaseDemand(uint16_t network, int32_t watts) {
    ensureNetwork(network);
    netBaseDemandW_[network] += watts;
  }

  // Set the per-machine output buffer cap (max units the out-slot can hold).
  // 0 (the default) means "no cap" — the legacy live behaviour, kept so the 9
  // existing suites are unchanged. A finite cap is what lets a base STALL when
  // its output backs up, both on-rails (§5.3 storage bound) and, for parity,
  // in the live machineSystem. Additive: existing callers never set it.
  void setMachineOutputCap(EntityHandle h, uint16_t cap) {
    if (h.valid()) outCap_[h.index] = cap;
  }
  uint16_t machineOutputCap(EntityHandle h) const { return outCap_[h.index]; }

  // ==========================================================================
  // §5 — ON-RAILS FACTORY ABSTRACTION (FS-4, D-003, gate G2).
  //
  // When a factory (chunk) leaves the active band, core-engine demotes it: we
  // STOP per-entity stepping and collapse each machine to its steady-state
  // production-rate model (items/tick + buffer levels). While on-rails we
  // advance producedCount by rate x elapsed, consuming inputs and filling
  // outputs, CLAMPED by available input and output storage so a distant base
  // stalls realistically (input empty / output full) and can NEVER duplicate
  // (R2). On promote, we reconstruct the live per-entity buffers from the
  // rail-advanced totals — deterministically in TickIndex.
  //
  // Fidelity (G2): the rail model replays the SAME integer craft accounting the
  // live machineSystem uses (consume inputCount per craft, one craft per
  // craftTimeTicks ticks at the snapshot's power factor, emit outputCount). So
  // advancing M ticks on-rails yields EXACTLY what running active for M ticks
  // would — bounded by storage, never more. No float rate, no drift.
  // ==========================================================================

  // Per-machine steady-state snapshot taken at demotion (§5.2).
  struct FMachineRail {
    uint32_t index = 0;        // dense entity index of the machine
    uint16_t recipeId = 0;     // its recipe (rates derive from this)
    ItemId outputItem = kNoItem;  // recipe.outputItem (for per-item tally, GAP-2)
    uint16_t inputCount = 1;   // units consumed per craft
    uint16_t outputCount = 1;  // units produced per craft
    uint32_t craftTimeTicks = 60;  // ticks per craft at full power
    uint16_t inputLevel = 0;   // current input units (the consumable buffer)
    uint16_t outputLevel = 0;  // current output units (fills toward cap)
    uint16_t outputCap = 0;    // 0 = unbounded; else the storage bound
    uint32_t progressMilliticks = 0;  // in-flight craft progress (carried exactly)
    uint32_t brownoutQ16 = 65536;     // power factor at snapshot (§5.2 brownoutAvg)
  };

  // Whole-chunk rail snapshot: the rate model + buffer levels (§5.2).
  struct FRailState {
    std::vector<FMachineRail> machines;  // one per machine in the chunk
    uint64_t snapshotTick = 0;           // TickIndex() at demotion (exact Δt)
    uint64_t producedAtSnapshot = 0;     // producedCount() at demotion (anchor)
    uint64_t elapsedOnRails = 0;         // total ticks advanced on-rails (§5.3)
    // Per-output-item production accrued WHILE ON-RAILS (GAP-2). advanceRail folds
    // each completed craft's outputItem here in lockstep with producedAtSnapshot;
    // promoteFrom merges it into the live per-item breakdown so producedCountOf()
    // is continuous across demote→advance→promote, exactly like the total.
    std::vector<std::pair<ItemId, uint64_t>> producedByItem;
    bool valid = false;
  };

  // Is this factory currently on-rails (demoted)? While on-rails, step() is a
  // no-op for the demoted machines — they are advanced only by AdvanceOnRails.
  bool onRails() const { return rails_.valid; }

  // --- Demote (§5.2): snapshot steady-state rates + buffer levels, stop sim. --
  // Captures every machine's recipe-derived rate and its current in/out buffer
  // levels + in-flight craft progress, exactly. After this, step() will not
  // advance the snapshotted machines (they're on-rails); call AdvanceOnRails to
  // run them cheaply, then Promote to bring them back.
  FRailState Demote() {
    FRailState s;
    s.snapshotTick = clock_.tickIndex();
    s.producedAtSnapshot = totalProduced_;
    for (uint32_t i = 0; i < kind_.size(); ++i) {
      if (kind_[i] != EntityKind::Machine) continue;
      const Recipe& r = recipes_[recipeId_[i]];
      uint16_t net = networkId_[i];
      uint32_t brown = (net < netBrownoutQ16_.size()) ? netBrownoutQ16_[net]
                                                       : 65536u;
      FMachineRail m;
      m.index = i;
      m.recipeId = recipeId_[i];
      m.outputItem = r.outputItem;  // per-item tally key (GAP-2)
      m.inputCount = r.inputCount;
      m.outputCount = r.outputCount;
      m.craftTimeTicks = r.craftTimeTicks;
      m.inputLevel = inSlotCount_[i];
      m.outputLevel = outSlotCount_[i];
      m.outputCap = outCap_[i];
      m.progressMilliticks = progressTicks_[i];
      m.brownoutQ16 = brown;
      s.machines.push_back(m);
      onRails_[i] = 1;  // step() now skips this machine; rails drive it
    }
    s.valid = true;
    rails_ = s;  // remember it so step() skips these machines while on-rails
    return s;
  }

  // --- Advance on-rails (§5.2 EvalOnRails): rate x elapsed, storage-bounded. --
  // Advances the rail state by `elapsedTicks`, replaying the exact integer craft
  // accounting the live sim uses, but analytically (no per-tick loop over the
  // chunk). Consumes inputs as crafts run, fills outputs toward each machine's
  // cap, and updates producedCount. A machine STALLS the instant its input runs
  // out OR its output buffer fills — so a distant base cannot run forever or
  // dupe (R2). Operates on the FRailState in place; pass the controller's own
  // snapshot (the one returned by Demote, kept in rails_).
  void AdvanceOnRails(uint64_t elapsedTicks) {
    if (!rails_.valid) return;
    advanceRail(rails_, elapsedTicks);
  }

  // Same advance, but on an external FRailState (for time-warp / persistence
  // reconstruction that owns its own snapshot). Deterministic in elapsedTicks.
  void AdvanceOnRails(FRailState& s, uint64_t elapsedTicks) const {
    advanceRail(s, elapsedTicks);
  }

  // --- Promote (§5.3 OnPromote): reconstruct live buffers from the rail totals.
  // Writes the rail-advanced input/output/progress levels back into the live SoA
  // (bounded by each machine's storage — overflow is discarded at the cap, never
  // created), re-syncs producedCount, advances the clock to the rail time, and
  // clears the on-rails flag so step() resumes per-entity simulation. After this,
  // the live state is consistent with continuous active running for the elapsed
  // time, with zero duplication.
  void Promote() {
    if (!rails_.valid) return;
    promoteFrom(rails_);
    rails_ = FRailState{};  // back to active; step() resumes for these machines
  }

  // Reconstruct directly from an external rail snapshot (time-warp / load path).
  void Promote(const FRailState& s) {
    promoteFrom(s);
    rails_ = FRailState{};
  }

  // ==========================================================================
  // §6 — RENDER/NETWORK STREAM EMISSION (G7). Additive, read-only over the SoA.
  //
  // These produce the pinned §6.2 stream rows for rendering (+ networking can
  // reuse the same accessors). NONE of them mutate sim state, so the hot tick
  // and the 13 prior suites are entirely unaffected. The render-cost model
  // (render_cost.h) consumes exactly these outputs to prove RC-8 headlessly.
  // ==========================================================================

  // Optional render metadata the stream surfaces (all default to harmless
  // values so legacy scenes — which never call these — stream as TypeId 0 at
  // the origin with a 1 m bound). Additive: existing callers set nothing.
  void setEntityTypeId(EntityHandle h, uint16_t typeId) {
    if (h.valid()) typeId_[h.index] = typeId;
  }
  void setEntityPosition(EntityHandle h, float x, float y, float z) {
    if (!h.valid()) return;
    posX_[h.index] = x; posY_[h.index] = y; posZ_[h.index] = z;
  }
  // Bound-radius in centimetres (the §6.2 BoundRadius packing). 0 → defaulted
  // to ~1 m on emit so culling/screen-size math never divides by a zero bound.
  void setEntityBoundRadiusCm(EntityHandle h, uint16_t cm) {
    if (h.valid()) boundCm_[h.index] = cm;
  }
  uint16_t entityTypeId(EntityHandle h) const { return typeId_[h.index]; }

  // VisualState hint from the live SoA (§6.2): no-power < blocked < working <
  // idle. Read-only; rendering maps it to anim/emissive. Belt lines report
  // "working" while flowing. (Cheap, derived; not stored.)
  uint8_t entityVisualState(EntityHandle h) const {
    if (!h.valid()) return 0;
    uint32_t i = h.index;
    if (kind_[i] == EntityKind::Machine) {
      uint16_t net = networkId_[i];
      uint32_t brown = (net < netBrownoutQ16_.size()) ? netBrownoutQ16_[net]
                                                       : 65536u;
      if (brown == 0) return 3;             // no-power
      if (crafting_[i]) return 1;           // working
      const Recipe& r = recipes_[recipeId_[i]];
      bool starved = inSlotCount_[i] < r.inputCount;
      bool blocked = (outCap_[i] != 0) &&
                     (outSlotCount_[i] + r.outputCount > outCap_[i]);
      return (starved || blocked) ? 2 : 0;  // blocked : idle
    }
    return 0;
  }

  // --- Per-tick entity-state stream (§6.2). One row per LIVE entity, in dense
  // index order (deterministic). `lodOf` lets the caller stamp the band hint
  // (default: everything Near0); rendering owns the final band decision but the
  // sim provides the hint. Read-only; allocates only the returned vector. ----
  std::vector<FFactoryEntityState> EmitEntityStates() const {
    return EmitEntityStates([](const FactorySim&, EntityHandle) {
      return Lod::Near0;
    });
  }
  template <typename LodFn>
  std::vector<FFactoryEntityState> EmitEntityStates(LodFn lodOf) const {
    std::vector<FFactoryEntityState> out;
    out.reserve(liveCount_);
    for (uint32_t i = 0; i < kind_.size(); ++i) {
      if (kind_[i] == EntityKind::None) continue;
      EntityHandle h{i, generation_[i]};
      FFactoryEntityState s;
      s.Id = i;
      s.TypeId = typeId_[i];
      s.Position[0] = posX_[i];
      s.Position[1] = posY_[i];
      s.Position[2] = posZ_[i];
      s.VisualState = entityVisualState(h);
      s.AnimPhase = animPhaseOf(i);
      s.Lod = static_cast<uint8_t>(lodOf(*this, h));
      s.Flags = 0;
      s.BoundRadius = boundCm_[i] ? boundCm_[i] : 100;  // default ~1 m
      out.push_back(s);
    }
    return out;
  }

  // --- Per-tick belt-flow stream (§6.2). One row per LIVE transport line. This
  // is what a belt looks like at LOD-1+ (a scrolling-flow material) — O(lines),
  // NO per-item data. A steady belt is summarized by these few scalars. ----
  std::vector<FFactoryBeltFlowState> EmitBeltFlowStates() const {
    std::vector<FFactoryBeltFlowState> out;
    for (uint32_t i = 0; i < kind_.size(); ++i) {
      if (kind_[i] != EntityKind::BeltLine) continue;
      const TransportLine& l = lines_[i];
      FFactoryBeltFlowState f;
      f.LineId = i;
      f.ItemTypeDominant = dominantItem(l);
      // quantize speed (units/tick) to a byte scroll-rate.
      f.FlowSpeedQuant = static_cast<uint8_t>(
          l.speedUnitsPerTick > 255 ? 255 : l.speedUnitsPerTick);
      // density = fraction of capacity occupied by item bodies (0..255).
      uint64_t occupied =
          static_cast<uint64_t>(l.itemCount()) * kItemSpacing;
      uint32_t dens = l.capacityUnits
                          ? static_cast<uint32_t>((occupied * 255) /
                                                  l.capacityUnits)
                          : 0;
      f.Density = static_cast<uint8_t>(dens > 255 ? 255 : dens);
      f.Compressed = l.fullyCompressed ? 1 : 0;
      out.push_back(f);
    }
    return out;
  }

  // --- The ONLY O(items) call (§6.2). Pulled ON DEMAND, by LineId, and per the
  // render-wall contract ONLY at LOD-0 for lines the renderer chose to draw
  // discretely. Returns each live item's type + its unit-offset from the head
  // (reconstructed from the §2 gap arrays — read-only, never per-tick-pushed).
  // This is the lone call whose cost is O(items on the line); the whole point
  // of RC-8 is that it is invoked only for the small near-field set. ----
  std::vector<FLineItem> GetLineItems(FEntityId lineId) const {
    std::vector<FLineItem> out;
    if (lineId >= kind_.size() || kind_[lineId] != EntityKind::BeltLine)
      return out;
    const TransportLine& l = lines_[lineId];
    out.reserve(l.itemCount());
    // Walk live items [head_, size). The lead item sits headGap units from the
    // head; each subsequent item is kItemSpacing + its extra gap further back.
    uint32_t offset = l.headGap;
    for (size_t k = l.head_; k < l.itemTypes.size(); ++k) {
      if (k > l.head_) offset += kItemSpacing + l.itemGaps[k];
      out.push_back(FLineItem{l.itemTypes[k], offset});
    }
    return out;
  }

  // --- The player-facing inverse of GetLineItems: take the item NEAREST to a
  // point on the line. Gameplay aims a reticle at a belt, converts the hit to a
  // unit-offset along the baked pathUnitToWorld (the same axis GetLineItems
  // reports), and asks for the item there. `toleranceUnits` is the aim window:
  // a pick that lands more than that far from any item is a MISS, not a grab of
  // whatever happened to be closest, so brushing the cursor past a belt cannot
  // silently strip it. Returns the taken item, or kNoItem if the line id is not
  // a belt, the line is empty, or nothing is inside the window (in which case
  // the line is left byte-identical).
  //
  // Ties (two items exactly equidistant, which is common on a min-spaced belt
  // where every gap is exactly kItemSpacing) resolve toward the HEAD, i.e. the
  // lower UnitOffset: the walk is in increasing-offset order and the comparison
  // is a STRICT <, so the first (head-most) candidate keeps the slot. That makes
  // a hand pick deterministic and therefore replay-safe (NW-4), which a "last
  // one wins" or an offset sort with an unstable tie order would not be.
  //
  // O(items) like GetLineItems, and cold for the same reason: one call per
  // player input, never per tick.
  ItemId TakeLineItemNear(FEntityId lineId, uint32_t unitOffset,
                          uint32_t toleranceUnits) {
    if (lineId >= kind_.size() || kind_[lineId] != EntityKind::BeltLine)
      return kNoItem;
    TransportLine& l = lines_[lineId];
    if (l.empty()) return kNoItem;
    const size_t kNoSlot = l.itemTypes.size();
    size_t bestSlot = kNoSlot;
    uint32_t bestDist = 0;
    // Same offset walk as GetLineItems: lead item at headGap, each subsequent
    // item kItemSpacing + its extra gap further from the head.
    uint32_t offset = l.headGap;
    for (size_t k = l.head_; k < l.itemTypes.size(); ++k) {
      if (k > l.head_) offset += kItemSpacing + l.itemGaps[k];
      const uint32_t d =
          offset >= unitOffset ? offset - unitOffset : unitOffset - offset;
      if (bestSlot == kNoSlot || d < bestDist) {
        bestDist = d;
        bestSlot = k;
      }
    }
    if (bestSlot == kNoSlot || bestDist > toleranceUnits) return kNoItem;
    return l.takeAt(bestSlot);
  }

  // Count of live items on a line — O(1) (the §2 head-cursor count). Lets the
  // render-cost model bound LOD-0 item work without pulling the full list.
  uint32_t lineItemCount(FEntityId lineId) const {
    if (lineId >= kind_.size() || kind_[lineId] != EntityKind::BeltLine)
      return 0;
    return static_cast<uint32_t>(lines_[lineId].itemCount());
  }

 private:
  // ---- SoA tables (parallel, indexed by handle.index) ----------------------
  std::vector<EntityKind> kind_;
  std::vector<uint32_t> generation_;
  std::vector<uint8_t> sleeping_;

  // Machine components (§1.3 MachineProc + Inventory, flattened to 1 in/1 out).
  std::vector<uint16_t> recipeId_;
  std::vector<uint32_t> progressTicks_;
  std::vector<ItemId> inSlotItem_;
  std::vector<uint16_t> inSlotCount_;
  std::vector<ItemId> in2SlotItem_;   // assembler 2nd ingredient slot (kNoItem=unused)
  std::vector<uint16_t> in2SlotCount_;
  std::vector<ItemId> outSlotItem_;
  std::vector<uint16_t> outSlotCount_;
  std::vector<uint8_t> crafting_;   // 1 while a craft is in progress this tick
  std::vector<uint16_t> outCap_;    // out-slot storage cap (0 = unbounded; §5)
  std::vector<uint8_t> onRails_;    // 1 while this machine is demoted (§5)
  std::vector<int32_t> demandW_;    // this tick's wanted draw (§4)
  std::vector<uint16_t> networkId_;
  std::vector<int32_t> supplyW_;    // generators only

  // Inserter components (§1.3 InserterState).
  std::vector<EntityHandle> insSrc_;
  std::vector<EntityHandle> insDst_;
  std::vector<ItemId> insItem_;
  std::vector<InserterPhase> insPhase_;
  std::vector<ItemId> insHeld_;

  // Belt lines (§2) — one TransportLine per BeltLine entity.
  std::vector<TransportLine> lines_;

  // Miner components: a miner is bound to a depletable deposit. It extracts
  // `minerRateMilliPerTick_` thousandths-of-a-unit per powered tick (fixed-point,
  // deterministic — no float in the discrete state), accumulating into
  // minerAccum_ until a whole unit is freed, then granting it from minerRemaining_
  // into the out-slot. When minerRemaining_ hits 0 the miner stalls (deposit
  // depleted). Output goes to the out-slot (outSlotItem_/outSlotCount_, shared
  // with the machine arrays) so the SAME inserter path drains a miner head.
  std::vector<uint64_t> minerRemaining_;     // units of ore left in the bound deposit
  std::vector<ItemId>   minerItem_;          // ore id the deposit yields
  std::vector<uint32_t> minerRateMilliPerTick_;  // extraction rate (milli-units/tick)
  std::vector<uint32_t> minerAccum_;         // sub-unit extraction accumulator (milli)
  std::vector<uint16_t> minerOutCap_;        // out-slot cap (0 = unbounded)
  std::vector<int32_t>  minerPowerW_;        // draw while extracting (0 = unpowered)

  // Lifetime work counters (FS-35): machine milliticks advanced / miner
  // milli-units accrued. One uint64 add on the hot path per entity that is
  // actually WORKING this tick; idle entities never touch it.
  std::vector<uint64_t> workMilli_;

  // §6 render-stream metadata (cold; touched only by stream emission, never by
  // the hot tick). Additive: defaulted so legacy scenes stream sanely. typeId_
  // buckets draw calls (rendering instances per TypeId); pos*_ is the authority
  // position the stream surfaces; boundCm_ is the §6.2 BoundRadius (0 → ~1 m).
  std::vector<uint16_t> typeId_;
  std::vector<float> posX_, posY_, posZ_;
  std::vector<uint16_t> boundCm_;

  // Recipes (cold; indexed by recipeId_).
  std::vector<Recipe> recipes_;

  // Power networks: parallel arrays indexed by networkId.
  std::vector<int32_t> netBaseDemandW_;
  std::vector<uint32_t> netBrownoutQ16_;  // Q16.16 fixed-point brownout factor

  // Active set + free list.
  std::vector<uint32_t> active_;
  std::vector<uint32_t> freeList_;
  size_t liveCount_ = 0;
  uint64_t totalProduced_ = 0;  // lifetime items produced (monotonic; INT-1)

  // Per-output-item lifetime production (GAP-2). A tiny associative list keyed by
  // ItemId — the slice has a handful of distinct outputs, so a linear scan on the
  // (cold) completion event is cheaper than a hash map and stays allocation-light
  // / deterministic. Σ over entries == totalProduced_ (kNoItem outputs excluded).
  struct ItemProduced {
    ItemId item = kNoItem;
    uint64_t count = 0;
  };
  std::vector<ItemProduced> producedByItem_;

  // Record `n` produced units of `item` into BOTH the monotonic total and the
  // per-item breakdown. The single place craft completions are tallied so the two
  // counters never drift. (GAP-2; called from the live machineSystem + the
  // on-rails promote merge.)
  void recordProduced(ItemId item, uint64_t n) {
    totalProduced_ += n;
    if (item == kNoItem || n == 0) return;
    for (ItemProduced& p : producedByItem_) {
      if (p.item == item) { p.count += n; return; }
    }
    producedByItem_.push_back(ItemProduced{item, n});
  }

  // On-rails snapshot (§5). valid == this factory is demoted; step() then skips
  // the snapshotted machines and AdvanceOnRails/Promote drive them instead.
  FRailState rails_;

  // 1 while an external of::power::PowerGrid owns the satisfaction decision.
  uint8_t externalPower_ = 0;

  SimClock clock_;

  // ---- allocation -----------------------------------------------------------
  EntityHandle alloc(EntityKind k) {
    uint32_t idx;
    if (!freeList_.empty()) {
      idx = freeList_.back();
      freeList_.pop_back();
    } else {
      idx = static_cast<uint32_t>(kind_.size());
      growTo(idx + 1);
    }
    kind_[idx] = k;
    sleeping_[idx] = 0;
    active_.push_back(idx);
    ++liveCount_;
    return EntityHandle{idx, generation_[idx]};
  }

  void growTo(size_t n) {
    kind_.resize(n, EntityKind::None);
    generation_.resize(n, 0);
    sleeping_.resize(n, 1);
    recipeId_.resize(n, 0);
    progressTicks_.resize(n, 0);
    inSlotItem_.resize(n, kNoItem);
    inSlotCount_.resize(n, 0);
    in2SlotItem_.resize(n, kNoItem);
    in2SlotCount_.resize(n, 0);
    outSlotItem_.resize(n, kNoItem);
    outSlotCount_.resize(n, 0);
    crafting_.resize(n, 0);
    outCap_.resize(n, 0);
    onRails_.resize(n, 0);
    demandW_.resize(n, 0);
    networkId_.resize(n, 0);
    supplyW_.resize(n, 0);
    insSrc_.resize(n);
    insDst_.resize(n);
    insItem_.resize(n, kNoItem);
    insPhase_.resize(n, InserterPhase::Idle);
    insHeld_.resize(n, kNoItem);
    lines_.resize(n);
    minerRemaining_.resize(n, 0);
    minerItem_.resize(n, kNoItem);
    minerRateMilliPerTick_.resize(n, 0);
    minerAccum_.resize(n, 0);
    minerOutCap_.resize(n, 0);
    minerPowerW_.resize(n, 0);
    workMilli_.resize(n, 0);
    typeId_.resize(n, 0);
    posX_.resize(n, 0.0f);
    posY_.resize(n, 0.0f);
    posZ_.resize(n, 0.0f);
    boundCm_.resize(n, 0);
  }

  // ---- §6 stream helpers (read-only; never on the hot path) -----------------

  // AnimPhase byte (§6.2): a machine's craft progress 0..255; a flowing belt's
  // head travel; 0 otherwise. Purely derived from live state, never stored.
  uint8_t animPhaseOf(uint32_t i) const {
    if (kind_[i] == EntityKind::Machine) {
      const Recipe& r = recipes_[recipeId_[i]];
      uint32_t target = r.craftTimeTicks * 1000u;
      if (target == 0) return 0;
      uint64_t p = static_cast<uint64_t>(progressTicks_[i]) * 255u / target;
      return static_cast<uint8_t>(p > 255 ? 255 : p);
    }
    if (kind_[i] == EntityKind::BeltLine) {
      const TransportLine& l = lines_[i];
      if (l.capacityUnits == 0 || l.empty()) return 0;
      // how far the lead item has travelled toward the head, normalized.
      uint64_t travelled = l.capacityUnits - l.headGap;
      uint64_t p = travelled * 255u / l.capacityUnits;
      return static_cast<uint8_t>(p > 255 ? 255 : p);
    }
    return 0;
  }

  // Dominant item on a line (§6.2 ItemTypeDominant) for the scrolling material.
  // The slice's lines are single-item; we take the head item as representative
  // (O(1)) — a steady belt carries one item type, the realistic case.
  static ItemId dominantItem(const TransportLine& l) {
    return l.empty() ? kNoItem : l.itemTypes[l.head_];
  }

  void ensureNetwork(uint16_t network) {
    if (network >= netBaseDemandW_.size()) {
      netBaseDemandW_.resize(network + 1, 0);
      netBrownoutQ16_.resize(network + 1, 65536);  // 1.0 default
    }
  }

  // ==========================================================================
  // §4 — PowerSolveSystem. Per network: sum supply + demand, derive brownout.
  // Demand is each crafting machine's recipe power (cached as demandW_), summed
  // per network. Brownout = supply/demand clamped to [0,1], stored Q16.16.
  // ==========================================================================
  void powerSolveSystem() {
    const size_t nets = netBrownoutQ16_.size();
    if (nets == 0) return;
    std::vector<int64_t> supply(nets, 0);
    std::vector<int64_t> demand(nets, 0);
    for (size_t n = 0; n < nets; ++n) demand[n] = netBaseDemandW_[n];

    for (uint32_t i : active_) {
      if (sleeping_[i]) continue;
      EntityKind k = kind_[i];
      uint16_t net = networkId_[i];
      if (net >= nets) continue;
      if (k == EntityKind::PowerGen) {
        supply[net] += supplyW_[i];
      } else if (k == EntityKind::Machine) {
        if (onRails_[i]) continue;  // demoted: not in the live power solve (§5)
        // a machine wants power if it can craft this tick (has input or is mid).
        const Recipe& r = recipes_[recipeId_[i]];
        bool wants = (inSlotCount_[i] >= r.inputCount) || progressTicks_[i] > 0;
        demandW_[i] = wants ? r.powerW : 0;
        demand[net] += demandW_[i];
      } else if (k == EntityKind::Miner) {
        // A powered miner must PAY for the brownout it is already subject to.
        // minerSystem has always scaled extraction by the network factor, but
        // the miner contributed nothing to demand, so it was a free rider that
        // got slower when other machines browned out and never caused one
        // itself. minerPowerW_ defaults to 0, so every existing scene keeps its
        // exact behaviour and only a caller that asks for a powered miner pays.
        if (minerPowerW_[i] == 0) { demandW_[i] = 0; continue; }
        const bool outFull =
            minerOutCap_[i] != 0 && outSlotCount_[i] >= minerOutCap_[i];
        const bool wants = minerRemaining_[i] > 0 && !outFull;
        demandW_[i] = wants ? minerPowerW_[i] : 0;
        demand[net] += demandW_[i];
      }
    }
    // When an external PowerGrid owns the partition (power.h), it also owns the
    // satisfaction: we still publish every entity's wanted draw above, because
    // that is what the grid reads, but we do not write a second answer.
    if (externalPower_) return;
    for (size_t n = 0; n < nets; ++n) {
      // ONE definition of the brownout arithmetic, shared with power.h (FS-5).
      netBrownoutQ16_[n] = of::power::SatisfactionQ16(supply[n], demand[n]);
    }
  }

  // ==========================================================================
  // MinerSystem (Phase-1 mining). Each powered miner accumulates milli-units of
  // extraction per tick (scaled by its network's brownout) and, once a whole unit
  // accrues, draws it from the bound deposit into the out-slot — STOPPING when the
  // deposit is empty or the out-slot is at its cap. Fixed-point (milli-units), so
  // the rate is deterministic and a fractional rate still accumulates exactly.
  // Output lands in the shared out-slot, drained by an inserter like any machine.
  // ==========================================================================
  void minerSystem() {
    for (uint32_t i : active_) {
      if (sleeping_[i] || kind_[i] != EntityKind::Miner) continue;
      if (minerRemaining_[i] == 0) continue;            // deposit depleted: stall
      // Out-slot full? (cap 0 = unbounded.) Then don't extract (back-pressure).
      if (minerOutCap_[i] != 0 && outSlotCount_[i] >= minerOutCap_[i]) continue;
      uint16_t net = networkId_[i];
      uint32_t brown = (net < netBrownoutQ16_.size()) ? netBrownoutQ16_[net]
                                                      : 65536u;
      // milli-units mined this tick = rate * brownout (Q16.16).
      uint64_t add = (static_cast<uint64_t>(minerRateMilliPerTick_[i]) * brown)
                     >> 16;
      minerAccum_[i] += static_cast<uint32_t>(add);
      workMilli_[i] += add;  // FS-35: extraction effort actually accrued
      // Free as many whole units as have accrued (bounded by deposit + out cap).
      while (minerAccum_[i] >= 1000) {
        if (minerRemaining_[i] == 0) break;             // deposit emptied mid-tick
        if (minerOutCap_[i] != 0 && outSlotCount_[i] >= minerOutCap_[i]) break;
        minerAccum_[i] -= 1000;
        minerRemaining_[i] -= 1;
        outSlotCount_[i] += 1;
        // a mined unit counts as a produced item (mine->factory chain tally).
        recordProduced(minerItem_[i], 1);
      }
    }
  }

  // ==========================================================================
  // §1.4(3) — MachineSystem. Advance recipe progress scaled by brownout, then
  // consume inputs at craft start and emit outputs at completion.
  // Progress is integer "milliticks" so a fractional brownout still accumulates
  // deterministically (fixed-point, no float in the discrete state).
  // ==========================================================================
  void machineSystem() {
    for (uint32_t i : active_) {
      if (sleeping_[i] || kind_[i] != EntityKind::Machine) continue;
      if (onRails_[i]) continue;  // demoted: advanced by AdvanceOnRails, not here
      const Recipe& r = recipes_[recipeId_[i]];
      uint16_t net = networkId_[i];
      uint32_t brown = (net < netBrownoutQ16_.size()) ? netBrownoutQ16_[net]
                                                       : 65536;

      // Start a craft if idle and inputs are available AND the output buffer has
      // room for the result (cap 0 = unbounded → always room, legacy behaviour).
      // Multi-input (assembler): a recipe with a 2nd ingredient also requires
      // in2SlotCount_ >= input2Count, and consumes both at craft start. A recipe
      // with input2Item==kNoItem (count 0) gates on the first input only — exactly
      // the legacy single-input behaviour, so existing suites are unchanged.
      if (progressTicks_[i] == 0 && crafting_[i] == 0) {
        bool outRoom = (outCap_[i] == 0) ||
                       (outSlotCount_[i] + r.outputCount <= outCap_[i]);
        bool have2 = (r.input2Item == kNoItem) ||
                     (in2SlotCount_[i] >= r.input2Count);
        if (inSlotCount_[i] >= r.inputCount && have2 && outRoom) {
          inSlotCount_[i] -= r.inputCount;
          if (r.input2Item != kNoItem) in2SlotCount_[i] -= r.input2Count;
          crafting_[i] = 1;
        } else {
          continue;  // starved (either input) or blocked (output full): no work
        }
      }

      // Advance progress by brownout-scaled "milliticks". Full power = 1000/tick.
      // craftTimeTicks * 1000 milliticks completes a craft.
      uint32_t advance = static_cast<uint32_t>((1000u * brown) >> 16);
      progressTicks_[i] += advance;
      workMilli_[i] += advance;  // FS-35: craft effort actually applied
      uint32_t target = r.craftTimeTicks * 1000u;
      if (progressTicks_[i] >= target) {
        // complete: emit output, reset, allow immediate restart next tick.
        outSlotCount_[i] += r.outputCount;
        // monotonic lifetime counter (INT-1) + per-item breakdown (GAP-2).
        recordProduced(r.outputItem, r.outputCount);
        progressTicks_[i] = 0;
        crafting_[i] = 0;
      }
    }
  }

  // FS-37: does the machine at dense index `i` accept `item`? True iff the
  // machine's CURRENT recipe consumes it: the slot-1 ingredient, or the
  // optional slot-2 ingredient (in2SlotItem_ is kNoItem when unused). This is
  // a pure read of the recipe tag fields addMachine wrote — data-driven over
  // the recipe table, no per-item case. A machine whose recipe has no input
  // (inSlotItem_ == kNoItem) accepts nothing.
  bool machineAcceptsAt(uint32_t i, ItemId item) const {
    if (item == kNoItem) return false;
    if (inSlotItem_[i] != kNoItem && item == inSlotItem_[i]) return true;
    return in2SlotItem_[i] != kNoItem && item == in2SlotItem_[i];
  }

  // FS-66: does the container at dense index `i` accept `item`? True iff it has
  // room AND either holds nothing yet or already holds this type. The exact
  // analogue of `machineAcceptsAt` and, like it, the ONE definition, asked at
  // both the pickup and the drop so a refused item stays on its belt and backs
  // the line up where the player can see it, rather than being held invisibly.
  bool containerAcceptsAt(uint32_t i, ItemId item) const {
    if (item == kNoItem) return false;
    if (outCap_[i] != 0 && outSlotCount_[i] >= outCap_[i]) return false;
    return outSlotItem_[i] == kNoItem || outSlotItem_[i] == item;
  }

  // Whichever acceptance rule the DESTINATION uses, or "anything" for a belt.
  // One place, because the pickup gate and the drop gate must never be able to
  // disagree: an item accepted at pickup and refused at the drop is an item held
  // forever, conserved but invisible, which is the failure FS-37 avoided by
  // gating at both ends with the same predicate.
  bool destAcceptsAt(EntityHandle dst, ItemId item) const {
    if (!dst.valid()) return false;
    if (kind_[dst.index] == EntityKind::Machine) {
      return machineAcceptsAt(dst.index, item);
    }
    if (kind_[dst.index] == EntityKind::Container) {
      return containerAcceptsAt(dst.index, item);
    }
    return true;  // a belt is transport, not a consumer.
  }

  // ==========================================================================
  // §1.4(4) — InserterSystem. Each inserter: if holding, drop into dst input;
  // else if src head is ready, pick it up. O(1) per inserter — touches only the
  // bound src head slot and dst input slot.
  // ==========================================================================
  void inserterSystem() {
    for (uint32_t i : active_) {
      if (sleeping_[i] || kind_[i] != EntityKind::Inserter) continue;
      EntityHandle src = insSrc_[i];
      EntityHandle dst = insDst_[i];

      if (insPhase_[i] == InserterPhase::Holding) {
        // drop into dst machine input. Route by item type: a held item matching
        // the machine's 2nd ingredient goes to the 2nd input slot (assembler),
        // otherwise to the 1st. Single-input machines only ever take slot 1.
        // FS-37: the drop is GATED by machineAcceptsAt — an item the recipe
        // does not consume never enters an input slot, because the slots are
        // COUNTS and a count cannot remember what it was: one wrong unit in
        // inSlotCount_ is transmuted into the recipe's input the moment the
        // craft loop consumes it. A refused item stays HELD (never destroyed)
        // and the inserter stalls: the same back-pressure a full machine
        // exerts. This branch is unreachable today (the pickup gate below
        // refuses first, and no API rebinds a recipe under a held item) but it
        // is the wall between a future ISetRecipeIntent (C-5) and a mis-typed
        // input buffer.
        if (dst.valid() && kind_[dst.index] == EntityKind::Machine) {
          if (!machineAcceptsAt(dst.index, insHeld_[i])) continue;
          if (in2SlotItem_[dst.index] != kNoItem &&
              insHeld_[i] == in2SlotItem_[dst.index]) {
            in2SlotCount_[dst.index] += 1;
          } else {
            inSlotCount_[dst.index] += 1;
          }
          insHeld_[i] = kNoItem;
          insPhase_[i] = InserterPhase::Idle;
        } else if (dst.valid() && kind_[dst.index] == EntityKind::Container) {
          // FS-66: the ONE new drop branch. Gated by the same predicate the
          // pickup used, so a container that filled up between the pick and the
          // drop stalls the arm instead of overfilling, exactly as a full
          // machine does.
          if (!containerAcceptsAt(dst.index, insHeld_[i])) continue;
          outSlotItem_[dst.index] = insHeld_[i];
          outSlotCount_[dst.index] += 1;
          insHeld_[i] = kNoItem;
          insPhase_[i] = InserterPhase::Idle;
        } else if (dst.valid() && kind_[dst.index] == EntityKind::BeltLine) {
          if (lines_[dst.index].tryPushTail(insHeld_[i])) {
            insHeld_[i] = kNoItem;
            insPhase_[i] = InserterPhase::Idle;
          }
        }
        continue;
      }

      // Idle: try to pick from src head.
      // FS-37: an item the destination machine's recipe does not consume is
      // REFUSED AT PICKUP, so it stays where it is — on its belt, or in the
      // source's out-slot — and the line backs up behind it, visibly, exactly
      // as it does behind a full machine. Refusing here rather than only at
      // the drop is what keeps the item on the belt (a permanently-held item
      // would be conserved but invisible). Belt destinations take anything: a
      // belt is transport, not a consumer.
      // FS-66 replaced `dstIsMachine ? machineAcceptsAt : true` with
      // `destAcceptsAt`, which asks whichever rule the destination actually
      // uses. Behaviour for a machine or a belt destination is unchanged
      // literally: the helper's machine branch IS `machineAcceptsAt` and its
      // fall-through IS the old `true`.
      // FS-66: A CONTAINER DESTINATION CARRIES NO FILTER, and this is the one
      // place a container genuinely differs from a machine rather than reusing
      // its path. An inserter's `insItem_` is decided ONCE, at connect time, by
      // `inferItem`, which is right for a machine because a machine's ingredient
      // is fixed by its recipe before anything is built. A chest's contents are
      // decided by what the player belts into it, so there is nothing to infer
      // at connect time: the first draft inferred the belt's head item, the belt
      // was empty, the filter pinned to kNoItem, and the arm then matched
      // NOTHING for ever. The chest read 0 held while its belt backed up 40
      // items, which is exactly what a correct refusal looks like and was in
      // fact an arm that never tried.
      //
      // `containerAcceptsAt` is the real gate and it is asked below either way,
      // so skipping the filter loses no safety: a full chest or a chest holding
      // another type still refuses at the pickup and the line still backs up
      // visibly. Gated on the DESTINATION KIND rather than on `insItem_` being
      // kNoItem, because "kNoItem means anything" would silently re-point every
      // existing arm whose inference failed, and those should keep doing nothing.
      // FS-66 for a container, FS-67 for a two-ingredient machine: the arm
      // carries WHATEVER THE DESTINATION EATS rather than one pinned type. In
      // both cases the destination has a real acceptance rule of its own
      // (`containerAcceptsAt`, `machineAcceptsAt`) which is asked below either
      // way, so dropping the filter removes a redundant gate and not a real one.
      // A single-input machine keeps its filter, because there the filter and
      // the acceptance rule are the same answer and pinning costs nothing.
      const bool dstUnfiltered =
          dst.valid() && (kind_[dst.index] == EntityKind::Container ||
                          (kind_[dst.index] == EntityKind::Machine &&
                           in2SlotItem_[dst.index] != kNoItem));
      if (src.valid() && kind_[src.index] == EntityKind::BeltLine) {
        TransportLine& sl = lines_[src.index];
        if (sl.headReady() && (dstUnfiltered || sl.headItem() == insItem_[i]) &&
            destAcceptsAt(dst, sl.headItem())) {
          insHeld_[i] = sl.popHead();
          insPhase_[i] = InserterPhase::Holding;
        }
      } else if (src.valid() && (kind_[src.index] == EntityKind::Machine ||
                                 kind_[src.index] == EntityKind::Miner ||
                                 kind_[src.index] == EntityKind::Container)) {
        // Drain a machine, a miner OR a container out-slot: all three live in
        // outSlotCount_, which is why a container needed one added kind here
        // rather than a branch of its own. Emptying a container RELEASES its
        // type, the same rule `containerTake` uses, so one authority decides it.
        if (outSlotCount_[src.index] > 0 &&
            destAcceptsAt(dst, outSlotItem_[src.index])) {
          outSlotCount_[src.index] -= 1;
          insHeld_[i] = outSlotItem_[src.index];
          insPhase_[i] = InserterPhase::Holding;
          if (kind_[src.index] == EntityKind::Container &&
              outSlotCount_[src.index] == 0) {
            outSlotItem_[src.index] = kNoItem;
          }
        }
      }
    }
  }

  // ==========================================================================
  // §1.4(5) — BeltSystem. Advance each active transport line one tick. A flowing
  // line is a single subtraction (§2.2). This is the cheap system by design.
  // ==========================================================================
  void beltSystem() {
    for (uint32_t i : active_) {
      if (sleeping_[i] || kind_[i] != EntityKind::BeltLine) continue;
      lines_[i].advance();
    }
  }

  // ==========================================================================
  // §5.2/§5.3 — ON-RAILS advance + reconstruct (the gate-G2 machinery).
  //
  // advanceRail replays, ANALYTICALLY, the exact integer craft accounting the
  // live machineSystem performs each tick — but in closed form, so a base that
  // sat unobserved for a million ticks costs O(machines), not O(ticks). The
  // fidelity guarantee (G2): for the same elapsedTicks and the same starting
  // state, advanceRail produces EXACTLY the producedCount the live per-tick
  // loop would, never more (so no duplication), bounded by input/output storage
  // (so a starved/backed-up base stalls just as it would live).
  //
  // Per machine, per tick, the live loop does:
  //   - if idle: start a craft iff inputLevel>=inputCount AND output has room;
  //     on start, inputLevel -= inputCount.
  //   - accumulate adv = (1000*brownoutQ16)>>16 milliticks of progress.
  //   - on progress>=craftTimeTicks*1000: outputLevel += outputCount; produced
  //     += outputCount; reset progress.
  // We fold the repeated "start→fill→complete" cycle into arithmetic, stopping
  // the instant the FIRST stall (no input / no output room) would occur — at
  // which point the live loop also freezes, accumulating nothing further.
  // ==========================================================================
  // Accumulate `n` produced units of `item` into an FRailState's per-item rail
  // tally (the on-rails analogue of recordProduced; static so the const-qualified
  // advanceRail can call it). Skips kNoItem so power-only "recipes" don't tally.
  static void railAddProduced(FRailState& s, ItemId item, uint64_t n) {
    if (item == kNoItem || n == 0) return;
    for (std::pair<ItemId, uint64_t>& p : s.producedByItem) {
      if (p.first == item) { p.second += n; return; }
    }
    s.producedByItem.push_back({item, n});
  }

  void advanceRail(FRailState& s, uint64_t elapsedTicks) const {
    if (!s.valid || elapsedTicks == 0) return;
    s.elapsedOnRails += elapsedTicks;  // track total Δt for the clock re-sync
    for (FMachineRail& m : s.machines) {
      const uint32_t target = m.craftTimeTicks * 1000u;  // milliticks per craft
      // Per-tick progress at the snapshot's power factor (matches live exactly).
      const uint32_t adv =
          static_cast<uint32_t>((1000ull * m.brownoutQ16) >> 16);
      if (adv == 0 || target == 0) continue;  // no power / instant: nothing sane

      uint64_t ticksLeft = elapsedTicks;
      uint32_t progress = m.progressMilliticks;
      uint32_t inLvl = m.inputLevel;
      uint32_t outLvl = m.outputLevel;
      const uint32_t cap = m.outputCap;  // 0 = unbounded

      // If a craft is already in flight (progress>0) finish it first; it needs
      // no fresh input/output check at start (it already started), only output
      // room at completion — which the live loop does NOT re-check (it always
      // emits on completion), so neither do we, for exact parity.
      while (ticksLeft > 0) {
        // Are we mid-craft (progress>0 means a craft is running) or idle?
        if (progress == 0) {
          // Idle: the live loop tries to START. Gate on input + output room.
          bool outRoom = (cap == 0) || (outLvl + m.outputCount <= cap);
          if (inLvl < m.inputCount || !outRoom) {
            break;  // stalled — frozen for the rest of the window (no progress)
          }
          inLvl -= m.inputCount;  // consume at craft start (live semantics)
        }
        // Ticks needed to reach the completion target from current progress.
        uint64_t need = (target - progress + adv - 1) / adv;  // ceil
        if (need > ticksLeft) {
          // Window ends mid-craft: advance progress, stop.
          progress += static_cast<uint32_t>(adv * ticksLeft);
          ticksLeft = 0;
          break;
        }
        // Craft completes this many ticks in.
        ticksLeft -= need;
        outLvl += m.outputCount;
        s.producedAtSnapshot += m.outputCount;  // running rail total
        railAddProduced(s, m.outputItem, m.outputCount);  // per-item rail tally
        progress = 0;  // reset; next loop iteration tries to start again
      }
      m.progressMilliticks = progress;
      m.inputLevel = static_cast<uint16_t>(inLvl);
      m.outputLevel = static_cast<uint16_t>(outLvl);
    }
  }

  // §5.3 — write the rail-advanced totals back into the live SoA, bounded by
  // storage (overflow discarded at cap, never created), and re-sync the clock +
  // producedCount. Deterministic in elapsedTicks. Clears each machine's on-rails
  // flag so the live systems resume for it.
  void promoteFrom(const FRailState& s) {
    if (!s.valid) return;
    for (const FMachineRail& m : s.machines) {
      const uint32_t i = m.index;
      if (i >= kind_.size() || kind_[i] != EntityKind::Machine) continue;
      // Reconstruct the live per-entity buffers from the rail levels, clamped to
      // the machine's storage cap (overflow discarded — never minted beyond
      // storage, the §5.3 no-dupe bound).
      uint32_t outLvl = m.outputLevel;
      if (m.outputCap != 0 && outLvl > m.outputCap) outLvl = m.outputCap;
      inSlotCount_[i] = m.inputLevel;
      outSlotCount_[i] = static_cast<uint16_t>(outLvl);
      progressTicks_[i] = m.progressMilliticks;
      crafting_[i] = (m.progressMilliticks > 0) ? 1 : 0;
      onRails_[i] = 0;  // live systems resume for this machine
    }
    // Re-sync the monotonic produced counter to the rail total (it only ever
    // grew while on-rails — the same craft events the live loop would have
    // emitted). totalProduced_ is authoritative; the snapshot carried the delta.
    if (s.producedAtSnapshot > totalProduced_)
      totalProduced_ = s.producedAtSnapshot;
    // Merge the per-item rail tally (the GAP-2 breakdown) the same way: each
    // entry is the on-rails delta for that outputItem, folded into the live map
    // so Σ producedCountOf(id) stays == producedCount() across the cycle.
    for (const std::pair<ItemId, uint64_t>& p : s.producedByItem) {
      bool merged = false;
      for (ItemProduced& q : producedByItem_)
        if (q.item == p.first) { q.count += p.second; merged = true; break; }
      if (!merged && p.first != kNoItem)
        producedByItem_.push_back(ItemProduced{p.first, p.second});
    }
    // Advance the clock to (demote tick + elapsed on-rails) so TickIndex() is
    // continuous across the demote→advance→promote cycle: the same number of
    // ticks pass whether the chunk ran active or on-rails (§5.3 determinism
    // anchor — exact in integer ticks).
    const uint64_t targetTick = s.snapshotTick + s.elapsedOnRails;
    while (clock_.tickIndex() < targetTick) clock_.advance(clock_.fixedDt());
  }
};

}  // namespace factory
}  // namespace of
