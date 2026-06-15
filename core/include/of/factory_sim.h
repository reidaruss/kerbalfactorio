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
//   capacityUnits    = tiles * 256; headGap + Σ(itemGaps) + tailGap is invariant
//                    only modulo what enters/leaves at the ends.
// =============================================================================
// Invariant (units): headGap + Σ(itemGaps[i], i>=1) + itemCount*kItemSpacing
//                     + tailGap  ==  capacityUnits.
// Each item occupies kItemSpacing of "body" length (its minimum footprint);
// the gaps track only the FREE space. headGap is the free units the lead item
// must still travel to reach the head; tailGap is the free room at the tail
// where new items enter. itemGaps[i] (i>=1) is the EXTRA free space between
// item i-1 and item i beyond the minimum spacing (0 when compressed).
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

  // --- Tail input (§2.3): try to append an item at the line's tail. ----------
  // Succeeds (returns true) only if there is min-spacing room at the tail.
  // A new item enters at the far (tail) end and must travel the line's length to
  // reach the head. Because items load one-at-a-time at the tail, a second item
  // can only enter after the first has advanced (freeing tail room) — exactly
  // how a real belt fills. Use fillSaturated() to construct an already-full line.
  bool tryPushTail(ItemId item) {
    if (tailGap < kItemSpacing) return false;
    if (empty()) {
      // First item: lead gap = everything ahead of its tail-most footprint.
      head_ = 0;
      itemGaps.assign(1, 0);
      itemTypes.assign(1, item);
      headGap = capacityUnits - kItemSpacing;
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

  // Pop the lead item (consumer took it). O(1): advance the head cursor. The new
  // lead item's extra gap rolls into headGap; the popped footprint + the head
  // gap open up, and capacity returns to the tail.
  ItemId popHead() {
    if (empty()) return kNoItem;
    ItemId taken = itemTypes[head_];
    ++head_;
    if (!empty()) {
      // new lead: its extra gap becomes part of the (now larger) headGap.
      headGap = itemGaps[head_] + kItemSpacing;
      itemGaps[head_] = 0;
    } else {
      headGap = 0;
      head_ = 0;          // line empty: reset cursor + reclaim storage.
      itemGaps.clear();
      itemTypes.clear();
    }
    tailGap += kItemSpacing;
    fullyCompressed = false;  // removing from head decompresses
    return taken;
  }

  // --- Advance one tick (§2.2): the O(1) flowing case. -----------------------
  // If the lead item is not yet at the head, move the whole line forward by
  // speed (one subtraction). If it reaches the head, clamp at 0 (waiting for a
  // consumer). Interior item gaps are NOT touched while flowing.
  void advance() {
    if (empty()) return;
    if (headGap == 0) return;  // head blocked, waiting on consumer
    if (headGap <= speedUnitsPerTick) {
      headGap = 0;
      // Latch compression once, at the transition — O(items) but amortized
      // O(1)/tick since it runs only on the first arrival, not every tick.
      if (!fullyCompressed && isMinSpaced()) fullyCompressed = true;
    } else {
      headGap -= speedUnitsPerTick;
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
  Machine,    // miner / smelter / assembler: recipe progress
  Inserter,   // moves one item per swing between src and dst
  BeltLine,   // a transport line (its own TransportLine record)
  PowerGen,   // generator (supply)
};

// Inserter phase: a simple two-phase swing (pick -> drop).
enum class InserterPhase : uint8_t { Idle = 0, Holding = 1 };

// A synthetic recipe: consume N input items, take T ticks, produce M output.
struct Recipe {
  ItemId inputItem = kNoItem;
  uint16_t inputCount = 1;
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
    outSlotItem_[h.index] = recipe.outputItem;
    outSlotCount_[h.index] = 0;
    demandW_[h.index] = 0;
    networkId_[h.index] = 0;
    crafting_[h.index] = 0;
    return h;
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

  // Bind a machine to a power network (so it draws + is throttled by brownout).
  void setMachineNetwork(EntityHandle m, uint16_t network) {
    if (!m.valid()) return;
    networkId_[m.index] = network;
    ensureNetwork(network);
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
    machineSystem();       // 2. advance recipe progress (x brownout), produce
    inserterSystem();      // 3. pick from src head -> drop into dst input
    beltSystem();          // 4. advance transport lines (the §2 O(1) case)
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
  uint32_t machineProgress(EntityHandle h) const { return progressTicks_[h.index]; }
  uint64_t tickIndex() const { return clock_.tickIndex(); }

  // Manually feed a machine input (for inserter-free correctness tests).
  void feedMachine(EntityHandle h, uint16_t count) { inSlotCount_[h.index] += count; }

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
  std::vector<ItemId> outSlotItem_;
  std::vector<uint16_t> outSlotCount_;
  std::vector<uint8_t> crafting_;   // 1 while a craft is in progress this tick
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

  // Recipes (cold; indexed by recipeId_).
  std::vector<Recipe> recipes_;

  // Power networks: parallel arrays indexed by networkId.
  std::vector<int32_t> netBaseDemandW_;
  std::vector<uint32_t> netBrownoutQ16_;  // Q16.16 fixed-point brownout factor

  // Active set + free list.
  std::vector<uint32_t> active_;
  std::vector<uint32_t> freeList_;
  size_t liveCount_ = 0;

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
    outSlotItem_.resize(n, kNoItem);
    outSlotCount_.resize(n, 0);
    crafting_.resize(n, 0);
    demandW_.resize(n, 0);
    networkId_.resize(n, 0);
    supplyW_.resize(n, 0);
    insSrc_.resize(n);
    insDst_.resize(n);
    insItem_.resize(n, kNoItem);
    insPhase_.resize(n, InserterPhase::Idle);
    insHeld_.resize(n, kNoItem);
    lines_.resize(n);
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
        // a machine wants power if it can craft this tick (has input or is mid).
        const Recipe& r = recipes_[recipeId_[i]];
        bool wants = (inSlotCount_[i] >= r.inputCount) || progressTicks_[i] > 0;
        demandW_[i] = wants ? r.powerW : 0;
        demand[net] += demandW_[i];
      }
    }
    for (size_t n = 0; n < nets; ++n) {
      if (demand[n] <= supply[n] || demand[n] == 0) {
        netBrownoutQ16_[n] = 65536;  // 1.0
      } else {
        // proportional brownout (FS-5): supply/demand as Q16.16.
        netBrownoutQ16_[n] =
            static_cast<uint32_t>((supply[n] << 16) / demand[n]);
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
      const Recipe& r = recipes_[recipeId_[i]];
      uint16_t net = networkId_[i];
      uint32_t brown = (net < netBrownoutQ16_.size()) ? netBrownoutQ16_[net]
                                                       : 65536;

      // Start a craft if idle and inputs are available.
      if (progressTicks_[i] == 0 && crafting_[i] == 0) {
        if (inSlotCount_[i] >= r.inputCount) {
          inSlotCount_[i] -= r.inputCount;
          crafting_[i] = 1;
        } else {
          continue;  // starved: no work
        }
      }

      // Advance progress by brownout-scaled "milliticks". Full power = 1000/tick.
      // craftTimeTicks * 1000 milliticks completes a craft.
      uint32_t advance = static_cast<uint32_t>((1000u * brown) >> 16);
      progressTicks_[i] += advance;
      uint32_t target = r.craftTimeTicks * 1000u;
      if (progressTicks_[i] >= target) {
        // complete: emit output, reset, allow immediate restart next tick.
        outSlotCount_[i] += r.outputCount;
        progressTicks_[i] = 0;
        crafting_[i] = 0;
      }
    }
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
        // drop into dst machine input.
        if (dst.valid() && kind_[dst.index] == EntityKind::Machine) {
          inSlotCount_[dst.index] += 1;
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
      if (src.valid() && kind_[src.index] == EntityKind::BeltLine) {
        TransportLine& sl = lines_[src.index];
        if (sl.headReady() && sl.headItem() == insItem_[i]) {
          insHeld_[i] = sl.popHead();
          insPhase_[i] = InserterPhase::Holding;
        }
      } else if (src.valid() && kind_[src.index] == EntityKind::Machine) {
        if (outSlotCount_[src.index] > 0) {
          outSlotCount_[src.index] -= 1;
          insHeld_[i] = outSlotItem_[src.index];
          insPhase_[i] = InserterPhase::Holding;
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
};

}  // namespace factory
}  // namespace of
