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
#include <memory>
#include <vector>

#include "of/factory_sim.h"
#include "of/deposits.h"  // worldgen::survival::NodeKind -> ItemId (resourceOf)
#include "of/power.h"     // the electrical grid: poles, generators, brownout
#include "of/enemies.h"   // pollution / evolution / nests / waves (FS-35)

namespace of {
namespace automation {

using factory::FactorySim;
using factory::Recipe;
using factory::EntityHandle;
using factory::ItemId;
using factory::kNoItem;

// Poles and generators are grid citizens, not factory entities, and they get
// their own handle types rather than a BuildKind. This is the same call
// gameplay.h §S.6 made for structural parts: a pole never ticks, has no input
// or output ports, holds no inventory and runs no recipe, so putting it in the
// hot SoA arrays would add a permanently inert row and make "does this entity
// do anything" a runtime question instead of a type-level one.
using power::PoleId;
using power::PoleClass;
using power::NetworkId;
using power::NetworkStats;
using power::NetworkSample;
using power::WireSegment;
using power::GeneratorSpec;
using power::kNoNetwork;
using GeneratorId = power::NodeId;

// A stable handle to a placed building in the network (miner / belt / machine).
// The UE layer holds these to query state + connect buildings. It wraps the
// underlying sim EntityHandle plus a building kind so connect() can pick the
// right transfer without the caller spelling out inserters.
// FS-66 appends Container. Appended and never inserted, so no existing value
// moves and no persisted or transmitted BuildKind is re-pointed.
enum class BuildKind : uint8_t { None = 0, Miner, Belt, Smelter, Assembler,
                                Container };

struct BuildId {
  EntityHandle entity;          // the sim entity backing this building
  BuildKind kind = BuildKind::None;
  bool valid() const { return kind != BuildKind::None && entity.valid(); }
};

// =============================================================================
// HOW WIDE A BUILDING IS, in metres. Data, not code: a new kind is a row.
//
// FS-159 needs this because the power grid's supply radius reaches a machine's
// nearest FACE and not its centre (see poleClassDef in power.h for why), and a
// face is a thing only a machine with a WIDTH has. Nothing else in /core asks.
//
// THE AUTHORITY IS `web/src/game/FactoryKinds.ts::FOOTPRINT`, mirrored here the
// same way and for the same reason `GeneratorSpec::typeId` mirrors ASSET-SPECS:
// the caller that knows the number cannot reach this call without a new wasm
// export, and a new export is a client/wasm ABI handshake the release lane owns.
//
// THE MIRROR IS CHECKED RATHER THAN TRUSTED, which is the part that matters: an
// unchecked copy of this table is exactly how FS-73 stranded the smelter. The
// check is `probes/power.js`'s COVERAGE section — it derives the mating cells
// from FOOTPRINT read live out of the running client, stands a smelter on each
// one, and asserts /core's own network id for it. If these two tables ever
// disagree by enough to matter, that probe goes red instead of a machine going
// quietly dead.
//
// The map is total over BuildKind and agrees with FOOTPRINT on every row. Note
// an ELECTRIC smelter is a `Smelter` here, and both smelter rungs are 4 m, so
// the missing distinction cannot cost anything.
inline float buildKindFootprintM(BuildKind k) {
  switch (k) {
    case BuildKind::Belt:      return 1.0f;   // FOOTPRINT.belt
    case BuildKind::Miner:     return 4.0f;   // FOOTPRINT.miner
    case BuildKind::Smelter:   return 4.0f;   // FOOTPRINT.smelter / .esmelter
    case BuildKind::Container: return 4.0f;   // FOOTPRINT.chest
    case BuildKind::Assembler: return 8.0f;   // FOOTPRINT.assembler
    case BuildKind::None:      break;
  }
  return 0.0f;  // unknown kind: a point, i.e. the pre-FS-159 rule
}

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

  // FS-66: place a STORAGE CONTAINER holding up to `capacity` units of ONE item
  // type. `item` kNoItem lets the first arrival claim the type; passing one pins
  // it, which is a filtered chest and costs nothing extra.
  //
  // A CONTAINER IS NOT A MACHINE AND DOES NOT APPEAR IN producedCount(). It has
  // no recipe, so nothing can record production against it; see the EntityKind
  // comment in factory_sim.h for why that is structural rather than a rule.
  BuildId placeContainer(uint16_t capacity = 300, ItemId item = kNoItem) {
    EntityHandle e = sim_.addContainer(capacity, item);
    sim_.setActive(e, true);
    return BuildId{e, BuildKind::Container};
  }
  ItemId containerItem(const BuildId& b) const {
    return b.valid() ? sim_.containerItem(b.entity) : kNoItem;
  }
  uint16_t containerCount(const BuildId& b) const {
    return b.valid() ? sim_.containerCount(b.entity) : 0;
  }
  uint16_t containerCapacity(const BuildId& b) const {
    return b.valid() ? sim_.containerCapacity(b.entity) : 0;
  }
  uint16_t containerTake(const BuildId& b, uint16_t want) {
    return b.valid() ? sim_.containerTake(b.entity, want) : 0;
  }
  uint16_t containerInsert(const BuildId& b, ItemId item, uint16_t count) {
    return b.valid() ? sim_.containerInsert(b.entity, item, count) : 0;
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

  // ==========================================================================
  // ELECTRICITY (power.h). A network that never calls enableGrid() behaves
  // EXACTLY as it always has: factory_sim's self-contained integer networks,
  // every machine at powerW 0 unless the caller said otherwise. Turning the
  // grid on hands the satisfaction decision to the PowerGrid, and from then on
  // there is one authority for it.
  //
  // The three placeables are the Factorio triad: a POLE distributes, a
  // GENERATOR produces, and any machine registered with connectToGrid consumes.
  // ==========================================================================

  power::PowerGrid& grid() { return grid_; }
  const power::PowerGrid& grid() const { return grid_; }

  // Hand power over to the grid. Idempotent.
  void enableGrid(bool on = true) {
    gridOn_ = on;
    sim_.setExternalPowerAuthority(on);
    if (on) {
      // Sim network 1 is reserved for OFF-GRID: anything the grid says is
      // covered by no pole is pinned to satisfaction 0, which is the honest
      // answer and is visibly different from "on a network with no generator".
      sim_.setNetworkSatisfactionQ16(kOffGridSimNet, 0);
      gridEpoch_ = 0;  // force a re-map on the next step
    }
  }
  bool gridEnabled() const { return gridOn_; }

  // Place a POWER POLE. Poles form networks by connectivity: two poles within
  // each other's wire reach are the same network, and everything inside a
  // pole's supply radius is on that network.
  PoleId placePole(float x, float y, float z,
                   PoleClass cls = PoleClass::Small) {
    return grid_.addPole(x, y, z, cls);
  }
  // Remove a pole. If it was the only link between two halves of a network, the
  // network SPLITS and each half then follows its own generators.
  bool removePole(PoleId p) { return grid_.removePole(p); }

  // Place a BURNER GENERATOR: rated watts off a solid fuel, burning in
  // proportion to what it actually produces (see power.h). Feed it with
  // insertFuel().
  GeneratorId placeBurnerGenerator(float x, float y, float z, ItemId fuelItem) {
    return placeGenerator(x, y, z, power::burnerGeneratorSpec(fuelItem));
  }
  GeneratorId placeGenerator(float x, float y, float z,
                             const GeneratorSpec& spec) {
    const GeneratorId g = grid_.addGenerator(x, y, z, spec);
    // Pollution bookkeeping (FS-35): a generator is a grid citizen, not a
    // factory entity, so its emission row is kept here rather than minted
    // through setPlacement. A generator that burns NOTHING (no fuel model:
    // future solar) emits nothing — combustion is what pollutes — so it never
    // gets an emitter at all and solar lands clean automatically.
    GenEmit ge;
    ge.gen = g;
    ge.spec = spec;
    ge.x = x; ge.y = y; ge.z = z;
    genEmits_.push_back(ge);
    if (enemySim_) bindGenerator(genEmits_.back());
    return g;
  }
  uint16_t insertFuel(GeneratorId g, ItemId item, uint16_t count) {
    const uint16_t took = grid_.insertFuel(g, item, count);
    // Lifetime fuel ENERGY inserted, tracked so burned = inserted - stored is
    // an exact integer identity over power.h's published surfaces alone.
    if (took > 0) {
      for (GenEmit& ge : genEmits_) {
        if (ge.gen != g) continue;
        ge.insertedMilliJ +=
            static_cast<uint64_t>(took) * ge.spec.energyPerFuelUnitMilliJ;
        break;
      }
    }
    return took;
  }
  uint16_t generatorFuel(GeneratorId g) const { return grid_.fuelUnits(g); }
  int32_t generatorOutputW(GeneratorId g) const {
    return grid_.generatorOutputW(g);
  }

  // Register a placed building as a grid CONSUMER at (x,y,z) drawing
  // `ratedDrawW` while it works. For a miner this also gives it a real draw, so
  // it stops being a free rider that suffers brownouts without causing them.
  //
  // A building that is never registered stays off-grid at full speed, which is
  // exactly right for anything whose recipe draws 0 W (belts, the tier-0
  // fuel-driven chain). A machine with a real draw MUST be registered, which is
  // why placeElectricSmelter does it in the same call rather than trusting a
  // caller to remember.
  void connectToGrid(const BuildId& b, float x, float y, float z,
                     int32_t ratedDrawW) {
    if (!b.valid()) return;
    // The machine's own width goes with it: the supply radius is measured to a
    // FACE (FS-159), and a consumer registered without one is a point that a
    // pole it is physically touching can fail to reach.
    const power::NodeId node =
        grid_.addConsumer(x, y, z, ratedDrawW, buildKindFootprintM(b.kind));
    consumers_.push_back(Consumer{b.entity, node});
    if (b.kind == BuildKind::Miner) sim_.setMinerPower(b.entity, ratedDrawW);
    gridEpoch_ = 0;  // topology changed: re-map on the next step
    // A machine on the grid emits at the ELECTRIC factor (its combustion moved
    // to the generator), so re-derive its base rate if it is already bound.
    for (MachineEmit& m : machineEmits_) {
      if (m.entity.index != b.entity.index) continue;
      m.basePerSecond = baseRateFor(m.entity, m.typeId);
      break;
    }
  }

  // Place an ELECTRIC SMELTER: the powered rung of the smelting ladder. Same
  // ore -> ingot conversion as the fuel-driven tiers, faster, and it eats watts
  // instead of coal. Registered on the grid in the same call.
  BuildId placeElectricSmelter(ItemId ore, ItemId ingot, float x, float y,
                               float z, uint32_t craftTicks = 30,
                               int32_t powerW = 30000, uint16_t outCap = 0) {
    BuildId b = placeSmelter(ore, ingot, craftTicks, powerW, outCap);
    connectToGrid(b, x, y, z, powerW);
    return b;
  }

  // ---- what a supply-and-demand panel reads --------------------------------
  size_t networkCount() { return grid_.networkCount(); }
  NetworkStats networkStats(NetworkId n) { return grid_.stats(n); }
  std::vector<NetworkSample> networkHistory(NetworkId n) {
    return grid_.history(n);
  }
  const std::vector<WireSegment>& wires() { return grid_.wireSegments(); }

  // Which network is this building on? kNoNetwork means no pole covers it.
  NetworkId networkOfBuild(const BuildId& b) {
    const power::NodeId* n = consumerNodeOf(b);
    return n ? grid_.networkOfNode(*n) : kNoNetwork;
  }
  // This building's own satisfaction, Q16.16. Off-grid but registered reads 0;
  // never registered reads 1.0, because a 0 W machine is not short of anything.
  uint32_t satisfactionQ16Of(const BuildId& b) {
    const power::NodeId* n = consumerNodeOf(b);
    return n ? grid_.satisfactionOfNode(*n) : power::kQ16One;
  }
  double satisfactionOf(const BuildId& b) {
    return static_cast<double>(satisfactionQ16Of(b)) / 65536.0;
  }

  // --------------------------------------------------------------------------
  // ADVANCE. Deterministic fixed-tick stepping.
  //
  // With the grid on, the order within one tick is: publish this tick's wanted
  // draws, solve the grid on them, write the answer back, then run the sim.
  // Solving on THIS tick's demand rather than last tick's is what keeps a
  // machine that just became able to craft from getting a free full-power tick.
  // --------------------------------------------------------------------------
  void step() {
    if (gridOn_) pumpPower();
    sim_.step();
    if (enemySim_) pumpPollution();
  }
  void stepN(uint64_t n) { for (uint64_t i = 0; i < n; ++i) step(); }
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
  // Take up to `want` units out of a building's output buffer BY HAND, and
  // return how many were actually taken. The placement layer needs this because
  // the last machine in a line has nothing downstream to drain it: without a
  // collection verb the ingots pile up in a buffer no player can reach, and the
  // whole point of automating a smelter is that the output goes somewhere. It
  // drains the SAME out-slot an inserter would, so a unit cannot be collected
  // and also flow onwards.
  uint16_t takeOutput(const BuildId& b, uint16_t want) {
    return b.valid() ? sim_.takeMachineOutput(b.entity, want) : 0;
  }

  // Stamp the §6 render metadata for a building: which mesh set it draws
  // (TypeId), where it stands, and its bound radius. The sim does not care, but
  // EmitEntityStates is the ONE stream the renderer reads, so a building whose
  // position is never set streams at the origin and every machine in the world
  // draws in the same place. Position is metres in whatever local frame the
  // caller anchors to (standing rule 6: never planet-scale absolutes in f32).
  void setPlacement(const BuildId& b, uint16_t typeId, float x, float y, float z,
                    uint16_t boundCm = 100) {
    if (!b.valid()) return;
    sim_.setEntityTypeId(b.entity, typeId);
    sim_.setEntityPosition(b.entity, x, y, z);
    sim_.setEntityBoundRadiusCm(b.entity, boundCm);
    // Pollution bookkeeping (FS-35): the placement is where a building gains a
    // POSITION, and an emitter is a rate at a position, so this is where the
    // binding happens — the bridge needs no extra call. Rows are kept even
    // while enemies are off so enableEnemies() can backfill.
    MachineEmit* row = nullptr;
    for (MachineEmit& m : machineEmits_) {
      if (m.entity.index == b.entity.index) { row = &m; break; }
    }
    if (row == nullptr) {
      machineEmits_.push_back(MachineEmit{});
      row = &machineEmits_.back();
    }
    row->entity = b.entity;
    row->kind = b.kind;
    row->typeId = typeId;
    row->x = x; row->y = y; row->z = z;
    if (enemySim_) bindMachine(*row);
  }

  // The dense entity index behind a building: the key EmitEntityStates stamps
  // into FFactoryEntityState::Id and EmitBeltFlowStates into LineId. The render
  // layer holds BuildIds and receives stream rows, so it needs the join.
  uint32_t entityIndex(const BuildId& b) const {
    return b.valid() ? b.entity.index : 0xFFFFFFFFu;
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

  // ==========================================================================
  // POLLUTION / ENEMIES (enemies.h, composed the way the power grid is: FS-35).
  //
  // A network that never calls enableEnemies() behaves EXACTLY as before. With
  // it on, every placed building whose type has a nonzero row in enemies.h §11
  // carries an emitter at ITS OWN surface direction, and once per pollution
  // window (EnemyTuning::pollutionTickInterval sim ticks, default 60 = 1 Hz)
  // each emitter's rate is set to
  //
  //     baseRate(type) * dutyCycle(window)
  //
  // where dutyCycle is WORK ACTUALLY DONE over full-rate work, measured from
  // the sim's own fixed-point counters (FactorySim::workMilli for machines and
  // miners; fuel energy actually burned for generators). That single rule is
  // the whole design:
  //   * an idle or starved machine did no work -> emits nothing;
  //   * a browned-out machine emits less BY THE SAME Q16 factor that slowed it;
  //   * a generator emits in proportion to the energy it actually delivered,
  //     so moving a smelter to electricity MOVES its pollution to the power
  //     plant rather than removing it (Factorio's cleverest balance idea);
  //   * a machine registered on the grid emits electricEmissionFactor of its
  //     base rate at the machine — the combustion happens elsewhere.
  //
  // The emission window and the field's deposit window are the SAME window, so
  // emission is exactly work-proportional with no sampling alias: the rate
  // refreshed at window w covers precisely the factory ticks window w deposits.
  // ==========================================================================

  // The one pollution-policy knob this layer adds on top of the enemies.h §11
  // rate table. Data, not code, like everything else in the table.
  struct PollutionPolicy {
    // Fraction of the type's base rate a GRID-REGISTERED machine emits at the
    // machine itself. 0.3 puts the tier-0 electric smelter at 0.6/s against
    // the fuel smelter's 2.0/s, with its 30 kW share of a 90 kW generator
    // adding ~2.0/s AT THE GENERATOR — slightly more in total, concentrated
    // where the player can site it away from nests.
    double electricEmissionFactor = 0.3;
  };

  // Turn the loop on. `anchorDir` is the surface direction (unit vector from
  // the body centre) of the LOCAL FRAME ORIGIN that placement coordinates are
  // expressed in; the local frame is read as x -> east, z -> north, y -> up
  // (height is irrelevant to a surface field and is ignored). The tangent
  // basis is derived exactly the way enemies.h derives expansion bearings, so
  // the mapping is transcendental-free and toolchain-stable. Buildings placed
  // BEFORE this call are backfilled; call it once at world creation.
  // (Overloads rather than default arguments: an in-class default argument of
  //  PollutionPolicy{} would need the NSDMI complete before the class ends.)
  void enableEnemies(const worldgen::BodyParams& body, uint64_t worldSeed,
                     const Vec3& anchorDir) {
    enableEnemies(body, worldSeed, anchorDir, enemies::EnemyTuning());
  }
  void enableEnemies(const worldgen::BodyParams& body, uint64_t worldSeed,
                     const Vec3& anchorDir,
                     const enemies::EnemyTuning& tuning) {
    enableEnemies(body, worldSeed, anchorDir, tuning, PollutionPolicy());
  }
  void enableEnemies(const worldgen::BodyParams& body, uint64_t worldSeed,
                     const Vec3& anchorDir,
                     const enemies::EnemyTuning& tuning,
                     const PollutionPolicy& policy) {
    enemySim_.reset(new enemies::EnemySim(body, worldSeed, tuning));
    pollutionPolicy_ = policy;
    radiusM_ = body.radiusM;
    anchorDir_ = enemies::unitOf(anchorDir);
    Vec3 axis(0, 1, 0);
    if (anchorDir_.y > 0.999 || anchorDir_.y < -0.999) axis = Vec3(1, 0, 0);
    east_ = enemies::unitOf(enemies::crossOf(axis, anchorDir_));
    north_ = enemies::crossOf(anchorDir_, east_);
    for (MachineEmit& m : machineEmits_) bindMachine(m);
    for (GenEmit& g : genEmits_) bindGenerator(g);
  }
  bool enemiesEnabled() const { return enemySim_ != nullptr; }

  // Full access to the model (nests, damage/destroy, reports, catalogue). The
  // facade owns the EMISSION side; everything else is the model's own surface.
  enemies::EnemySim& enemySim() { return *enemySim_; }
  const enemies::EnemySim& enemySim() const { return *enemySim_; }

  // Local placement coordinates -> the surface direction an emitter lives at.
  // Chord step (normalise(anchor*R + east*x + north*z)): at base scale it is
  // millimetres off a great-circle step and needs no transcendental.
  Vec3 surfaceDirOfLocal(float x, float y, float z) const {
    (void)y;  // height above the surface does not move a surface field cell
    const double dx = static_cast<double>(x), dz = static_cast<double>(z);
    return enemies::unitOf(
        Vec3(anchorDir_.x * radiusM_ + east_.x * dx + north_.x * dz,
             anchorDir_.y * radiusM_ + east_.y * dx + north_.y * dz,
             anchorDir_.z * radiusM_ + east_.z * dx + north_.z * dz));
  }

  // ---- what a HUD line / map overlay reads ---------------------------------
  // (Thin passthroughs, mirroring the §5.1 power-panel reads. Safe when off.)
  enemies::PollutionReport pollutionReport() const {
    return enemySim_ ? enemySim_->pollutionReport() : enemies::PollutionReport{};
  }
  std::vector<enemies::NestThreat> threatReport() const {
    return enemySim_ ? enemySim_->threatReport()
                     : std::vector<enemies::NestThreat>{};
  }
  const enemies::EvolutionState& evolutionState() const {
    static const enemies::EvolutionState kOff{};
    return enemySim_ ? enemySim_->evolution() : kOff;
  }
  std::vector<enemies::AttackWave> drainWaves() {
    return enemySim_ ? enemySim_->drainWaves()
                     : std::vector<enemies::AttackWave>{};
  }

  // The emitter bound to a building / generator (kNoEmitter if none: zero-rate
  // type, no placement yet, or enemies off). A UI uses this to join a nest's
  // `angriestAt` back to the machine the wave is coming for.
  enemies::EmitterId pollutionEmitterOf(const BuildId& b) const {
    if (!b.valid()) return enemies::kNoEmitter;
    for (const MachineEmit& m : machineEmits_)
      if (m.entity.index == b.entity.index) return m.emitter;
    return enemies::kNoEmitter;
  }
  enemies::EmitterId generatorEmitterOf(GeneratorId g) const {
    for (const GenEmit& ge : genEmits_)
      if (ge.gen == g) return ge.emitter;
    return enemies::kNoEmitter;
  }

  // Saved binding rows that found no live building at load (0 in the normal
  // replay flow; nonzero means the caller rebuilt a DIFFERENT factory).
  uint32_t pollutionRebindMisses() const { return rebindMisses_; }

  // ---- persistence (FS-35; enemies.h §10 cursor idiom) ---------------------
  // Serialises the WHOLE joined pollution state: the model (field, nests,
  // waves, evolution, emitters WITH their ids) plus the machine->emitter and
  // generator->emitter joins, keyed by replay-stable ids (dense entity index /
  // grid NodeId). Load contract: rebuild the factory by replaying the same
  // construction sequence, call enableEnemies with the same parameters, THEN
  // deserializePollution — it discards the emitters the replay minted, adopts
  // the saved ones, and re-joins them to the rebuilt buildings, so nest source
  // credits keep pointing at the same machines. Duty baselines are SNAPPED to
  // the rebuilt sim's counters at load (they meter counters that restart), so
  // at most one pollution window of emission is lost across a save/load.
  template <typename Writer>
  void serializePollution(Writer& w) const {
    w.varint(kPollutionMagic);
    w.varint(kPollutionVersion);
    w.u8(enemySim_ ? 1 : 0);
    if (!enemySim_) return;
    enemySim_->serialize(w);
    uint64_t bound = 0;
    for (const MachineEmit& m : machineEmits_)
      if (m.emitter != enemies::kNoEmitter) ++bound;
    w.varint(bound);
    for (const MachineEmit& m : machineEmits_) {
      if (m.emitter == enemies::kNoEmitter) continue;
      w.varint(m.entity.index);
      w.varint(m.emitter);
    }
    bound = 0;
    for (const GenEmit& g : genEmits_)
      if (g.emitter != enemies::kNoEmitter) ++bound;
    w.varint(bound);
    for (const GenEmit& g : genEmits_) {
      if (g.emitter == enemies::kNoEmitter) continue;
      w.varint(g.gen);
      w.varint(g.emitter);
    }
  }
  template <typename Reader>
  bool deserializePollution(Reader& r) {
    const uint64_t magic = r.varint();
    const uint64_t version = r.varint();
    if (magic != kPollutionMagic || version != kPollutionVersion) return false;
    const bool wasEnabled = r.u8() != 0;
    if (!wasEnabled) return true;       // saved with enemies off: nothing more
    if (!enemySim_) return false;       // caller must enableEnemies first
    enemySim_->deserialize(r);
    // The replay-minted emitters were just discarded wholesale by the model's
    // deserialize; drop every live join before adopting the saved ones.
    for (MachineEmit& m : machineEmits_) m.emitter = enemies::kNoEmitter;
    for (GenEmit& g : genEmits_) g.emitter = enemies::kNoEmitter;
    rebindMisses_ = 0;
    uint64_t n = r.varint();
    for (uint64_t i = 0; i < n; ++i) {
      const uint32_t idx = static_cast<uint32_t>(r.varint());
      const enemies::EmitterId em = static_cast<enemies::EmitterId>(r.varint());
      bool found = false;
      for (MachineEmit& m : machineEmits_) {
        if (m.entity.index != idx) continue;
        m.emitter = em;
        m.basePerSecond = baseRateFor(m.entity, m.typeId);
        m.denomPerWindow = machineDenom(m);
        m.workBaseline = sim_.workMilli(m.entity);  // snap: counters restarted
        found = true;
        break;
      }
      if (!found) ++rebindMisses_;
    }
    n = r.varint();
    for (uint64_t i = 0; i < n; ++i) {
      const GeneratorId gid = static_cast<GeneratorId>(r.varint());
      const enemies::EmitterId em = static_cast<enemies::EmitterId>(r.varint());
      bool found = false;
      for (GenEmit& g : genEmits_) {
        if (g.gen != gid) continue;
        g.emitter = em;
        g.denomPerWindow = generatorDenom(g);
        g.burnedBaseline = burnedLifetimeMilliJ(g);  // snap, same reason
        found = true;
        break;
      }
      if (!found) ++rebindMisses_;
    }
    // A building placed after the save has a live row and no saved join: give
    // it a fresh emitter (nextEmitterId_ was restored, so no id collision).
    for (MachineEmit& m : machineEmits_)
      if (m.emitter == enemies::kNoEmitter) bindMachine(m);
    for (GenEmit& g : genEmits_)
      if (g.emitter == enemies::kNoEmitter) bindGenerator(g);
    return true;
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
    // FS-66: A CONTAINER'S OUTPUT IS WHATEVER IT CURRENTLY HOLDS, which is the
    // one place a container differs from every other source: a machine's output
    // item is fixed by its recipe at placement time, and a chest's is decided by
    // what the player belted into it. An empty chest infers kNoItem, and the
    // arm then carries nothing until something arrives, which is correct: an
    // inserter drawn off an empty chest has nothing to be filtered to yet.
    if (from.kind == BuildKind::Container) {
      return sim_.containerItem(from.entity);
    }
    // A container SINK gets NO FILTER, and kNoItem here means exactly that.
    // The first draft returned the belt's current head item, which is a snapshot
    // taken at CONNECT time of a belt that has not started running: it pinned
    // every chest arm to kNoItem and they matched nothing for ever. A chest's
    // contents are the player's choice rather than a recipe's, so there is
    // nothing to infer, and `inserterSystem` skips the filter for a container
    // destination and lets `containerAcceptsAt` decide.
    if (to.kind == BuildKind::Container) return kNoItem;
    // from is a belt -> a machine sink: match belt content to an input slot.
    //
    // FS-67: A MULTI-INPUT MACHINE GETS NO FILTER, and the old `return in1`
    // fallback is why an assembler's SECOND ingredient could never be belted.
    //
    // The inference reads the belt's CURRENT head item, which is a snapshot
    // taken at CONNECT time. For a single-input machine that is harmless,
    // because there is only one answer. For a two-input machine it is fatal, and
    // it is fatal ALWAYS rather than sometimes: the client rebuilds the whole
    // network from the plan on every placement (`Factory.commit` calls
    // `recreate`, since FactorySim has no entity removal by design), and a
    // rebuild discards everything riding every belt, so EVERY belt is empty at
    // the moment it is connected. The fallback then bound every belt-to-
    // assembler arm to ingredient A, and the line carrying ingredient B waited
    // for ingredient A for ever. Measured by `probes/assembler.js`: a 73-tile
    // stone line saturated to 292 items with its outlet mated to
    // `socket_item_in_b` at 0.5000 m and facing -1.0000, and delivered ZERO
    // units across 5,988 ticks, while the iron line beside it worked perfectly
    // because ingredient A happened to be what IT carried.
    //
    // kNoItem means NO FILTER here, and it is safe because it removes a
    // redundant gate rather than a real one: `inserterSystem` still asks
    // `machineAcceptsAt`, which is FS-37's typed-acceptance rule and accepts
    // EITHER ingredient and nothing else. An explicit `connect(from, to, item)`
    // still pins the arm, because this function is only consulted when the
    // caller passed kNoItem.
    //
    // HONEST NOTE ON WHICH HALF OF THE FIX IS LOAD-BEARING, because reverting
    // each half separately is the only way to know. The fix has two parts, this
    // one and the `dstUnfiltered` gate in `inserterSystem`, and ONLY THE GATE
    // MATTERS: with the old `return in1` restored here and the gate in place,
    // the suite stays green (slot1 111, slot2 56, 54 crafts), and with this line
    // in place and the gate reverted it fails by name (slot1 221, slot2 0, 0
    // crafts). This change is kept because a filter that says "iron" on an arm
    // that carries coal is a lie the next reader has to discover, not because it
    // is doing work.
    if (to.kind == BuildKind::Smelter || to.kind == BuildKind::Assembler) {
      ItemId in1 = sim_.inputItemOf(to.entity);
      ItemId in2 = sim_.input2ItemOf(to.entity);
      if (in2 != kNoItem) return kNoItem;  // two ingredients: let acceptance decide
      return in1;  // single-input: one answer, and pinning it costs nothing
    }
    return kNoItem;
  }

  // ---- pollution plumbing (FS-35) ------------------------------------------
  static constexpr uint64_t kPollutionMagic = 0x4F465031ull;  // 'OFP1'
  static constexpr uint64_t kPollutionVersion = 1;

  // One row per PLACED building (recorded whether or not enemies are on, so
  // enableEnemies can backfill). Cold data, touched once per pollution window.
  struct MachineEmit {
    EntityHandle entity;
    BuildKind kind = BuildKind::None;
    uint16_t typeId = 0;
    float x = 0, y = 0, z = 0;
    enemies::EmitterId emitter = enemies::kNoEmitter;
    double basePerSecond = 0.0;   // full-duty rate (electric factor applied)
    uint64_t workBaseline = 0;    // FactorySim::workMilli at the last refresh
    uint64_t denomPerWindow = 0;  // full-duty work per pollution window
  };
  // One row per placed generator. Duty is metered on ENERGY ACTUALLY BURNED,
  // through power.h's published surfaces only: burned = inserted - stored.
  struct GenEmit {
    GeneratorId gen = 0;
    GeneratorSpec spec;
    float x = 0, y = 0, z = 0;
    uint64_t insertedMilliJ = 0;  // lifetime fuel energy accepted by insertFuel
    enemies::EmitterId emitter = enemies::kNoEmitter;
    uint64_t burnedBaseline = 0;  // lifetime burned at the last refresh
    uint64_t denomPerWindow = 0;  // rated energy per pollution window (mJ)
  };

  bool isGridConsumer(EntityHandle e) const {
    for (const Consumer& c : consumers_)
      if (c.entity.index == e.index) return true;
    return false;
  }

  // The §11 table row for this type, at the electric factor if the building
  // draws its watts from the grid (its combustion happens at the generator).
  double baseRateFor(EntityHandle e, uint16_t typeId) const {
    double r = enemies::pollutionRateForMachine(typeId);
    if (r > 0.0 && isGridConsumer(e)) r *= pollutionPolicy_.electricEmissionFactor;
    return r;
  }

  // Full-duty work per pollution window, in the entity's own fixed point.
  uint64_t machineDenom(const MachineEmit& m) const {
    const uint32_t interval = enemySim_->tuning().pollutionTickInterval;
    if (m.kind == BuildKind::Smelter || m.kind == BuildKind::Assembler)
      return 1000ull * interval;  // machineSystem: 1000 milliticks/tick at full
    if (m.kind == BuildKind::Miner)
      return static_cast<uint64_t>(sim_.minerRateMilliPerTick(m.entity)) *
             interval;
    return 0;  // belts and everything else do no meterable work
  }
  uint64_t generatorDenom(const GenEmit& g) const {
    const uint32_t interval = enemySim_->tuning().pollutionTickInterval;
    if (g.spec.ratedW <= 0) return 0;
    // burnFor charges (watts*1000)/60 mJ per tick; the denominator uses the
    // SAME truncation so a flat-out generator reads duty exactly 1.
    return (static_cast<uint64_t>(g.spec.ratedW) * 1000ull / 60ull) * interval;
  }

  // Lifetime energy burned, an exact monotone integer identity over published
  // surfaces: everything ever inserted minus what is still stored.
  uint64_t burnedLifetimeMilliJ(const GenEmit& g) const {
    const uint64_t stored = grid_.storedEnergyMilliJ(g.gen);
    return g.insertedMilliJ > stored ? g.insertedMilliJ - stored : 0;
  }

  // (Re)bind a building's emitter: mint one at the building's own surface
  // direction, rate 0 until its first window of witnessed work. A zero-rate
  // type gets NO emitter at all — a thousand belts must not lengthen the
  // emitter scan. Re-placement (a moved building) re-mints at the new spot.
  void bindMachine(MachineEmit& m) {
    if (!enemySim_) return;
    if (m.emitter != enemies::kNoEmitter) {
      enemySim_->removeEmitter(m.emitter);
      m.emitter = enemies::kNoEmitter;
    }
    m.basePerSecond = baseRateFor(m.entity, m.typeId);
    m.denomPerWindow = machineDenom(m);
    if (m.basePerSecond <= 0.0 || m.denomPerWindow == 0) return;
    m.emitter = enemySim_->addEmitter(surfaceDirOfLocal(m.x, m.y, m.z), 0.0);
    m.workBaseline = sim_.workMilli(m.entity);
  }
  void bindGenerator(GenEmit& g) {
    if (!enemySim_) return;
    if (g.emitter != enemies::kNoEmitter) {
      enemySim_->removeEmitter(g.emitter);
      g.emitter = enemies::kNoEmitter;
    }
    g.denomPerWindow = generatorDenom(g);
    const double base = enemies::pollutionRateForMachine(g.spec.typeId);
    if (base <= 0.0 || g.denomPerWindow == 0) return;
    if (g.spec.energyPerFuelUnitMilliJ == 0) return;  // burns nothing: clean
    g.emitter = enemySim_->addEmitter(surfaceDirOfLocal(g.x, g.y, g.z), 0.0);
    g.burnedBaseline = burnedLifetimeMilliJ(g);
  }

  // Once per pollution window, right before the field's deposit for that same
  // window: rate = base * (work actually done / full-rate work). The windows
  // align EXACTLY (refresh fires on the tick whose enemy step runs the slow
  // tick), so emission is work-proportional with no sampling alias.
  void refreshEmitterRates() {
    for (MachineEmit& m : machineEmits_) {
      if (m.emitter == enemies::kNoEmitter || m.denomPerWindow == 0) continue;
      const uint64_t now = sim_.workMilli(m.entity);
      const uint64_t d = now - m.workBaseline;
      m.workBaseline = now;
      double duty = static_cast<double>(d) /
                    static_cast<double>(m.denomPerWindow);
      if (duty > 1.0) duty = 1.0;
      enemySim_->setEmitterRate(m.emitter, m.basePerSecond * duty);
    }
    for (GenEmit& g : genEmits_) {
      if (g.emitter == enemies::kNoEmitter || g.denomPerWindow == 0) continue;
      const uint64_t burned = burnedLifetimeMilliJ(g);
      const uint64_t d = burned - g.burnedBaseline;
      g.burnedBaseline = burned;
      double duty =
          static_cast<double>(d) / static_cast<double>(g.denomPerWindow);
      if (duty > 1.0) duty = 1.0;
      enemySim_->setEmitterRate(
          g.emitter,
          enemies::pollutionRateForMachine(g.spec.typeId) * duty);
    }
  }

  void pumpPollution() {
    const uint32_t interval = enemySim_->tuning().pollutionTickInterval;
    if ((enemySim_->tickIndex() + 1) % interval == 0) refreshEmitterRates();
    enemySim_->step();
  }

  // ---- grid plumbing --------------------------------------------------------
  // Sim network 0 is OFF-GRID-BY-DEFAULT (satisfaction 1.0): a belt or a 0 W
  // machine that was never registered. Sim network 1 is OFF-GRID-REGISTERED
  // (pinned to 0): a machine that wants watts and no pole reaches it. Grid
  // network n maps to sim network n + 2.
  static constexpr uint16_t kOffGridSimNet = 1;
  static constexpr uint16_t kSimNetBase = 2;

  struct Consumer {
    EntityHandle entity;
    power::NodeId node = 0;
  };

  const power::NodeId* consumerNodeOf(const BuildId& b) const {
    if (!b.valid()) return nullptr;
    for (const Consumer& c : consumers_)
      if (c.entity.index == b.entity.index) return &c.node;
    return nullptr;
  }

  void pumpPower() {
    // 1. Publish what every powered entity wants THIS tick. A starved or
    //    output-blocked machine publishes 0 and does not brown out its
    //    neighbours for work it was never going to do.
    sim_.refreshPowerDemand();
    for (const Consumer& c : consumers_)
      grid_.setDemand(c.node, sim_.entityDemandW(c.entity));

    // 2. One solve, one answer.
    grid_.solve(sim_.tickIndex());

    // 3. Mirror the partition into the sim's per-entity network id, but only
    //    when the topology actually changed. A pole placed or removed is rare;
    //    a tick is not.
    const uint64_t epoch = grid_.rebuildCount();
    if (epoch != gridEpoch_) {
      gridEpoch_ = epoch;
      for (const Consumer& c : consumers_) {
        const NetworkId n = grid_.networkOfNode(c.node);
        sim_.setMachineNetwork(c.entity,
                               n == kNoNetwork
                                   ? kOffGridSimNet
                                   : static_cast<uint16_t>(n + kSimNetBase));
      }
      sim_.setNetworkSatisfactionQ16(kOffGridSimNet, 0);
    }

    // 4. Write the grid's satisfaction into the sim's per-network factor. This
    //    is the ONLY place the sim's brownout factor is written while the grid
    //    is on (factory_sim's own solve returns early under external authority).
    const size_t nets = grid_.networkCount();
    for (size_t n = 0; n < nets; ++n) {
      sim_.setNetworkSatisfactionQ16(
          static_cast<uint16_t>(n + kSimNetBase),
          grid_.stats(static_cast<NetworkId>(n)).satisfactionQ16);
    }
  }

  FactorySim sim_;
  power::PowerGrid grid_;
  std::vector<Consumer> consumers_;
  uint64_t gridEpoch_ = 0;
  bool gridOn_ = false;

  // ---- pollution state (FS-35) ---------------------------------------------
  std::unique_ptr<enemies::EnemySim> enemySim_;
  PollutionPolicy pollutionPolicy_;
  std::vector<MachineEmit> machineEmits_;
  std::vector<GenEmit> genEmits_;
  Vec3 anchorDir_ = Vec3(0, 0, 1);
  Vec3 east_ = Vec3(1, 0, 0);
  Vec3 north_ = Vec3(0, 1, 0);
  double radiusM_ = 600000.0;
  uint32_t rebindMisses_ = 0;
};

}  // namespace automation
}  // namespace of
