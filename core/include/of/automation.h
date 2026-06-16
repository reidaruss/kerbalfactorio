#pragma once
// =============================================================================
// automation.h — Phase-1 BUILDABLE AUTO-LINE network over factory_sim.h.
//
// This is the LOGIC layer a future UE placement layer binds to. It composes the
// already-proven SoA sim (factory_sim.h: belts, inserters, powered machines,
// power networks, on-rails) into a Factorio-style auto-flowing production line:
//
//     deposit -> MINER -> belt -> SMELTER -> belt -> ASSEMBLER -> output
//
// with NO manual feeding. Everything advances on step(): the miner extracts ore
// from its bound deposit into its out-slot; an inserter pulls it onto a belt; the
// belt flows it (the §2 O(1) case); an inserter drops it into the smelter input;
// the smelter crafts ingots; another inserter+belt carry ingots to the assembler;
// the assembler crafts a part. Items propagate END-TO-END every tick.
//
// DESIGN DECISIONS (justified):
//   * MINER rate: a deterministic fixed-point milli-units/tick rate (addMiner in
//     factory_sim.h), depleting a bound deposit amount and STOPPING at empty. The
//     UE layer binds an FDepositNode (deposits.h): RemainingAmount -> amount,
//     Resource -> item, Grade -> rate multiplier. No deposits.h include here —
//     the caller passes the amount/id, keeping this header dependency-light and
//     the determinism discipline intact (the deposit is a plain integer pool).
//   * SMELTER & ASSEMBLER are POWERED factory-sim machines (Recipe), NOT the
//     gameplay survival Furnace. Justification: the auto-line is an SoA hot-path,
//     power-integrated, on-rails-capable production chain; factory_sim's machine
//     model already gives timed recipe progress + brownout + demote/promote. The
//     Furnace is a standalone gameplay object with its own solid-fuel pool that
//     lives OUTSIDE the SoA (gameplay.h §S.4 documents exactly this split); using
//     it here would mean a second, un-streamed, un-railed tick path. A smelter is
//     a single-input recipe (ore->ingot); an assembler is a multi-input recipe
//     (two ingots -> a part) via Recipe's additive input2 fields.
//   * CONNECTION model: connect(from,to) is the one wiring primitive. It auto-
//     places the right transfer (an inserter) between any source out (miner /
//     machine / belt head) and any sink in (machine input / belt tail), so the UE
//     layer expresses a line as place* + connect*, never as hand-fed slots.
//
// Deterministic, header-only, additive. Owns ONE FactorySim; query each building
// via the BuildId handles it returns.
// =============================================================================
#include <cstdint>
#include <vector>

#include "of/factory_sim.h"
#include "of/deposits.h"  // worldgen::survival::NodeKind -> ItemId (resourceOf)

namespace of {
namespace automation {

using factory::FactorySim;
using factory::Recipe;
using factory::EntityHandle;
using factory::ItemId;
using factory::kNoItem;

// A stable handle to a placed building in the network (miner / belt / machine).
// The UE layer holds these to query state + connect buildings. It wraps the
// underlying sim EntityHandle plus a building kind so connect() can pick the
// right transfer without the caller spelling out inserters.
enum class BuildKind : uint8_t { None = 0, Miner, Belt, Smelter, Assembler };

struct BuildId {
  EntityHandle entity;          // the sim entity backing this building
  BuildKind kind = BuildKind::None;
  bool valid() const { return kind != BuildKind::None && entity.valid(); }
};

// =============================================================================
// BuildableNetwork — the API the UE placement layer calls.
//
//   placeMinerOnDeposit / placeBelt / placeSmelter / placeAssembler  -> BuildId
//   connect(from, to)                                                -> wires them
//   step() / stepN(n)                                                -> advance
//   query accessors                                                  -> read state
//
// Everything is deterministic given the same placement + connection sequence.
// =============================================================================
class BuildableNetwork {
 public:
  explicit BuildableNetwork(double fixedDt = 1.0 / 60.0) : sim_(fixedDt) {}

  // Direct access to the underlying sim (streams, power generators, on-rails,
  // benchmark hooks) — the network is a thin buildable facade, not a wall.
  FactorySim& sim() { return sim_; }
  const FactorySim& sim() const { return sim_; }

  // --------------------------------------------------------------------------
  // PLACEMENT. Each returns a BuildId the UE layer keeps to connect + query.
  // --------------------------------------------------------------------------

  // Place a MINER on a deposit. `depositAmount` = units of ore in the deposit
  // (FDepositNode::RemainingAmount), `item` = the ore id (FDepositNode::Resource),
  // `ratePerSecond` = extraction rate (scale by FDepositNode::Grade for richness).
  // The miner depletes the deposit and stops when empty. `outCap` bounds the
  // miner's internal buffer (0 = unbounded; a finite cap makes it back-pressure
  // when its belt is full, like a real miner).
  BuildId placeMinerOnDeposit(uint64_t depositAmount, ItemId item,
                              double ratePerSecond = 2.0, uint16_t outCap = 50) {
    EntityHandle e = sim_.addMiner(depositAmount, item, ratePerSecond, outCap);
    sim_.setActive(e, true);
    return BuildId{e, BuildKind::Miner};
  }

  // Place a MINER on a worldgen survival node, inferring the mined ItemId from
  // the node's KIND (deposits.h §S survival::resourceOf). The UE survival/harvest
  // layer holds an `of::worldgen::survival::NodeKind` per harvestable node (Tree,
  // Rock, CoalSeam, IronOre, CopperOre, WaterPool, OilSeep) and previously had to
  // map kind->item by hand before calling placeMinerOnDeposit. This overload owns
  // that mapping inside the facade so the binding is one call: pass the node kind +
  // its RemainingAmount and the miner yields the right raw resource id. Otherwise
  // identical to placeMinerOnDeposit (same rate/cap/depletion semantics).
  BuildId placeMinerForNode(of::worldgen::survival::NodeKind kind,
                            uint64_t depositAmount, double ratePerSecond = 2.0,
                            uint16_t outCap = 50) {
    const ItemId item = of::worldgen::survival::resourceOf(kind);
    return placeMinerOnDeposit(depositAmount, item, ratePerSecond, outCap);
  }

  // Place a BELT line of `tiles` tiles at `speed` units/tick (8 basic..32 turbo).
  BuildId placeBelt(uint32_t tiles, uint32_t speed = 8) {
    EntityHandle e = sim_.addBeltLine(tiles, speed);
    sim_.setActive(e, true);
    return BuildId{e, BuildKind::Belt};
  }

  // Place a SMELTER (single-input powered machine): `ore` -> `ingot`, taking
  // `craftTicks` ticks, drawing `powerW` while crafting. `outCap` bounds its
  // output buffer (so it stalls when backed up, both live + on-rails).
  BuildId placeSmelter(ItemId ore, ItemId ingot, uint32_t craftTicks = 60,
                       int32_t powerW = 0, uint16_t outCap = 0) {
    Recipe r;
    r.inputItem = ore;     r.inputCount = 1;
    r.outputItem = ingot;  r.outputCount = 1;
    r.craftTimeTicks = craftTicks;
    r.powerW = powerW;
    EntityHandle e = sim_.addMachine(r);
    if (outCap) sim_.setMachineOutputCap(e, outCap);
    sim_.setActive(e, true);
    return BuildId{e, BuildKind::Smelter};
  }

  // Place an ASSEMBLER (multi-input powered machine): `inA` + `inB` -> `out`.
  // `countA`/`countB` are units of each ingredient per craft. This is the real
  // Recipe multi-input path (input2 fields) — e.g. iron ingot + copper ingot ->
  // a circuit/part. A single-ingredient assembler is just countB=0 / inB=kNoItem.
  BuildId placeAssembler(ItemId inA, uint16_t countA, ItemId inB, uint16_t countB,
                         ItemId out, uint16_t outCount = 1,
                         uint32_t craftTicks = 90, int32_t powerW = 0,
                         uint16_t outCap = 0) {
    Recipe r;
    r.inputItem = inA;   r.inputCount = countA;
    r.input2Item = inB;  r.input2Count = countB;
    r.outputItem = out;  r.outputCount = outCount;
    r.craftTimeTicks = craftTicks;
    r.powerW = powerW;
    EntityHandle e = sim_.addMachine(r);
    if (outCap) sim_.setMachineOutputCap(e, outCap);
    sim_.setActive(e, true);
    return BuildId{e, BuildKind::Assembler};
  }

  // --------------------------------------------------------------------------
  // CONNECT. The one wiring primitive: route an item flow from `from` to `to`.
  //
  // Valid connections (auto-creates the right transfer):
  //   miner/machine OUT  -> belt        : inserter drains the out-slot onto the
  //                                        belt tail.
  //   belt               -> machine IN  : inserter pulls the belt head into the
  //                                        machine input (routed to slot 1 or 2 by
  //                                        item type for assemblers).
  //   miner/machine OUT  -> machine IN  : inserter directly hand-off (no belt).
  //
  // `item` is the item type the transfer carries; default kNoItem auto-infers it
  // from the source's output item. Returns the inserter's BuildId (or invalid if
  // the pair is not connectable). The UE layer expresses a whole line as a chain
  // of connect() calls — never as manual slot feeds.
  // --------------------------------------------------------------------------
  EntityHandle connect(const BuildId& from, const BuildId& to,
                       ItemId item = kNoItem) {
    if (!from.valid() || !to.valid()) return EntityHandle{};
    if (item == kNoItem) item = inferItem(from, to);
    EntityHandle e = sim_.addInserter(from.entity, to.entity, item);
    sim_.setActive(e, true);
    return e;
  }

  // --------------------------------------------------------------------------
  // ADVANCE. Deterministic fixed-tick stepping.
  // --------------------------------------------------------------------------
  void step() { sim_.step(); }
  void stepN(uint64_t n) { for (uint64_t i = 0; i < n; ++i) sim_.step(); }
  uint64_t tickIndex() const { return sim_.tickIndex(); }

  // --------------------------------------------------------------------------
  // QUERY each building's state (the UE layer reads these for HUD / debug).
  // --------------------------------------------------------------------------

  // Units of ore left in a miner's bound deposit (0 == depleted/stopped).
  uint64_t minerRemaining(const BuildId& b) const {
    return b.valid() ? sim_.minerRemaining(b.entity) : 0;
  }
  bool minerDepleted(const BuildId& b) const {
    return b.valid() ? sim_.minerDepleted(b.entity) : true;
  }
  // Items waiting in a miner's / machine's output buffer.
  uint16_t outputBuffer(const BuildId& b) const {
    return b.valid() ? sim_.machineOutput(b.entity) : 0;
  }
  // Units in a machine's first / second input slot.
  uint16_t inputBuffer(const BuildId& b) const {
    return b.valid() ? sim_.machineInput(b.entity) : 0;
  }
  uint16_t input2Buffer(const BuildId& b) const {
    return b.valid() ? sim_.machineInput2(b.entity) : 0;
  }
  // Live items currently on a belt line.
  uint32_t beltItemCount(const BuildId& b) const {
    return b.valid() ? sim_.lineItemCount(b.entity.index) : 0;
  }
  // Lifetime count of a specific item produced anywhere in the network (miner
  // extraction + machine crafts both tally here) — the chain's throughput probe.
  uint64_t producedCountOf(ItemId item) const { return sim_.producedCountOf(item); }
  uint64_t producedCount() const { return sim_.producedCount(); }

  // --------------------------------------------------------------------------
  // PER-BUILDING CRAFT STATE (the UE HUD/anim probe). These give the UE layer a
  // building-level "is it busy + how far along" WITHOUT it reaching past the
  // facade into sim().entityVisualState(...) / the recipe table by hand.
  // --------------------------------------------------------------------------

  // Is this building actively doing work this tick?
  //   * Smelter / Assembler: mid-craft (the FactorySim crafting_ flag is set —
  //     inputs consumed, a craft in flight).
  //   * Miner: extracting (its bound deposit is not yet depleted).
  //   * Belt: flowing (it currently carries at least one item).
  // false for an invalid handle.
  bool working(const BuildId& b) const {
    if (!b.valid()) return false;
    switch (b.kind) {
      case BuildKind::Smelter:
      case BuildKind::Assembler:
        return sim_.machineCrafting(b.entity);
      case BuildKind::Miner:
        return !sim_.minerDepleted(b.entity);
      case BuildKind::Belt:
        return sim_.lineItemCount(b.entity.index) > 0;
      default:
        return false;
    }
  }

  // Normalized craft progress in [0,1] for this building:
  //   * Smelter / Assembler: the in-flight craft's fraction-complete
  //     (machineProgress / craftTimeTicks*1000), clamped to [0,1]; 0 when idle,
  //     rising as the craft advances, ~1.0 the tick before it completes + emits.
  //   * Miner: 0 (no discrete craft cycle — use minerRemaining() for fill).
  //   * Belt: 0 (a belt has no craft; use beltItemCount() for occupancy).
  // 0 for an invalid handle.
  double progress01(const BuildId& b) const {
    if (!b.valid()) return 0.0;
    if (b.kind == BuildKind::Smelter || b.kind == BuildKind::Assembler) {
      const uint32_t target = sim_.machineProgressTarget(b.entity);
      if (target == 0) return 0.0;
      double p = static_cast<double>(sim_.machineProgress(b.entity)) /
                 static_cast<double>(target);
      if (p < 0.0) p = 0.0;
      if (p > 1.0) p = 1.0;
      return p;
    }
    return 0.0;  // Miner / Belt: no craft cycle (see minerRemaining/beltItemCount).
  }

 private:
  // Infer the carried item for an auto-created inserter:
  //   * a miner/machine SOURCE carries its output item;
  //   * a belt SOURCE carries whichever of the sink machine's input ingredients
  //     the belt actually holds — checked against the belt's head item so a
  //     belt->assembler connect picks copper for the copper arm and ingot for the
  //     ingot arm. If the belt is momentarily empty, fall back to the sink's
  //     slot-1 input (the common single-ingredient case).
  ItemId inferItem(const BuildId& from, const BuildId& to) const {
    if (from.kind == BuildKind::Miner || from.kind == BuildKind::Smelter ||
        from.kind == BuildKind::Assembler) {
      return sim_.outputItemOf(from.entity);
    }
    // from is a belt -> a machine sink: match belt content to an input slot.
    if (to.kind == BuildKind::Smelter || to.kind == BuildKind::Assembler) {
      ItemId belt = sim_.lineHeadItem(from.entity);
      ItemId in1 = sim_.inputItemOf(to.entity);
      ItemId in2 = sim_.input2ItemOf(to.entity);
      if (belt != kNoItem && belt == in2) return in2;  // belt carries the 2nd arm
      if (belt != kNoItem && belt == in1) return in1;  // belt carries the 1st arm
      return in1;  // empty belt: default to the slot-1 ingredient
    }
    return kNoItem;
  }

  FactorySim sim_;
};

}  // namespace automation
}  // namespace of
