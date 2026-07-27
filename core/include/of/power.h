#pragma once
// =============================================================================
// power.h — the electrical GRID: topology, the supply/demand solve, and the
// per-network satisfaction ratio that browns everything out proportionally.
//
// Factorio's model, because it is simple and legible and it is the reason a
// supply-and-demand panel is readable at all:
//
//     generators PRODUCE, consumers DEMAND, a network is a CONNECTED SET, and
//     when demand exceeds supply EVERYTHING on that network slows by the SAME
//     factor rather than some machines stopping and others not.
//
// Proportional brownout is what makes the fix obvious to a player: the whole
// base gets slower, the panel shows one number under 100%, and adding a
// generator moves that one number. Partial shutdown would instead make the
// factory behave differently depending on iteration order, which is both
// unreadable and a determinism hazard.
//
// ------------------------------------------------------------------ SPLIT ----
// WHAT THIS HEADER OWNS, and what it deliberately does not:
//
//   power.h  owns WHERE things are, WHICH network each is in, and WHAT the
//            satisfaction ratio of that network is this tick.
//   factory_sim.h owns what a machine DOES with that ratio (progress scaling,
//            miner extraction rate) — it already did, and it is untouched here.
//
// There is exactly ONE definition of the brownout arithmetic in the codebase:
// SatisfactionQ16 below. factory_sim.h's internal legacy solve calls it too, so
// the grid and the sim cannot drift into two answers. This is deliberate: this
// project has repeatedly paid for two authorities modelling one thing.
//
// ------------------------------------------------------------- TOPOLOGY ------
// Networks are formed by CONNECTIVITY, not by an integer a caller picks:
//
//   * a POLE has a supply RADIUS (the area it energises) and a wire REACH (how
//     far it can link to another pole). Two poles within wire reach of each
//     other are in the same network. This is a union-find over poles.
//   * a GENERATOR or CONSUMER joins the network of the nearest pole whose
//     SUPPLY RADIUS covers it. Out of every pole's radius means no network,
//     which for a consumer means satisfaction 0 (it is simply unpowered).
//   * removing a pole re-partitions: a chain broken in the middle becomes two
//     networks, and every machine on each side follows its own supply.
//
// WIRES ARE A SPANNING TREE, not every pair within reach. A network of N poles
// publishes EXACTLY N-1 wire segments however densely the poles are packed.
// This matters for a concrete measured reason: auto-created inserters already
// dominate instance count in a dense base (FS-16 measured more than half of all
// drawn instances at 900 plan rows), and a naive "draw a wire for every pole
// pair in reach" would be O(N^2) in exactly the layouts players build. N-1 is
// asserted by a test, not assumed.
//
// -------------------------------------------------------------- DETERMINISM --
// Standing rule 4. Everything here is integer. Distances are compared as
// SQUARED millimetres in int64, never as floats, so the connectivity graph is
// bit-identical across toolchains. Network ids are assigned by ascending
// smallest-member pole id, so the same build sequence always yields the same
// ids. The solve is a single non-iterative pass: there is no fixed point to
// converge to and therefore nothing to converge differently.
//
// Header-only. Depends on the C++17 stdlib and nothing else — no factory_sim,
// no rendering, no UE.
// =============================================================================
#include <cstddef>
#include <cstdint>
#include <vector>

namespace of {
namespace power {

// Item ids are gameplay's opaque handle, same key space as factory_sim's.
using ItemId = uint16_t;
static constexpr ItemId kNoItem = 0;

using NetworkId = uint16_t;
static constexpr NetworkId kNoNetwork = 0xFFFF;  // not covered by any pole

using PoleId = uint32_t;
using NodeId = uint32_t;  // a generator or a consumer
static constexpr uint32_t kInvalidId = 0xFFFFFFFFu;

// Q16.16 one.
static constexpr uint32_t kQ16One = 65536u;

// =============================================================================
// THE ONE ARITHMETIC DEFINITION. Every brownout number in this project comes
// from here — the grid solve, and factory_sim.h's legacy internal solve.
//
//   demand <= supply  ->  1.0 (everything runs at full rate)
//   demand == 0       ->  1.0 (an idle network is not in deficit)
//   otherwise         ->  supply / demand, truncated to Q16.16
//
// Truncation (not rounding) is chosen so the ratio can never exceed the true
// one: a machine may run a hair slower than the exact fraction, never faster,
// so a network can never deliver more work than it has watts for.
// =============================================================================
inline uint32_t SatisfactionQ16(int64_t supplyW, int64_t demandW) {
  if (demandW <= 0) return kQ16One;
  if (supplyW <= 0) return 0;
  if (supplyW >= demandW) return kQ16One;
  return static_cast<uint32_t>((supplyW * static_cast<int64_t>(kQ16One)) /
                               demandW);
}

// Apply a Q16.16 factor to a watt figure (or any integer quantity).
inline int64_t ApplyQ16(int64_t value, uint32_t q16) {
  return (value * static_cast<int64_t>(q16)) >> 16;
}

// =============================================================================
// POLE CLASSES. Data, not code: a new pole tier is a row, never a branch.
// Radii are in metres and are compared as squared millimetres internally.
//
// The tier-0 numbers are Factorio's small electric pole almost exactly (5x5
// supply area, 7.5 wire reach), which lands well on our world because machines
// sit on a metric site grid with tiles 1.002 m apart (FS-17) and belt-to-machine
// reach is 2.25 m. A 2.5 m supply radius therefore covers the machine a pole is
// standing next to and its immediate neighbours, and nothing surprising.
// =============================================================================
struct PoleClassDef {
  const char* name = "pole";
  float supplyRadiusM = 2.5f;
  float wireReachM = 7.5f;
  uint16_t typeId = 0;  // render TypeId (ASSET-SPECS is the authority)
};

enum class PoleClass : uint8_t { Small = 0, Medium = 1, Substation = 2 };

// The ladder is OPEN: append a row, do not edit an existing one.
inline const PoleClassDef& poleClassDef(PoleClass c) {
  static const PoleClassDef kDefs[] = {
      // name            supplyR  wireReach  typeId
      {"Power pole", 2.5f, 7.5f, 0x16},
      {"Medium pole", 3.5f, 9.0f, 0x16},
      {"Substation", 9.0f, 18.0f, 0x16},
  };
  const size_t i = static_cast<size_t>(c);
  return kDefs[i < 3 ? i : 0];
}

// =============================================================================
// GENERATOR. A generator is defined by a rated output plus a solid-fuel model.
//
// THE ONE INTERESTING MECHANIC, and the reason a supply/demand panel is worth
// having: fuel burns in proportion to ACTUAL OUTPUT, not to rated output. A
// generator on a lightly-loaded network throttles down and its coal lasts
// proportionally longer, exactly as Factorio's steam engines do. That is what
// makes "you have too many generators" a visible, non-punishing state and what
// makes the panel's production-versus-capacity distinction meaningful.
//
// A BOILER + STEAM ENGINE chain is the same struct with a different fuel item
// once fluids exist (a steam engine is a generator whose fuel is steam). We do
// not have pipes or fluids yet (they are Phase 4), and faking a fluid chain now
// would be the second-authority mistake this project keeps paying for. So the
// burner generator IS the terminal element of the eventual boiler chain,
// pre-built and pre-tested, and the boiler is deferred to the fluid work.
//
// Energy is tracked in MILLIJOULES as a uint64 so a coal unit (4 MJ) is an
// exact integer (4e9 mJ) and a long-running base cannot drift.
// =============================================================================
struct GeneratorSpec {
  int32_t ratedW = 90000;                 // maximum output, watts
  ItemId fuelItem = kNoItem;              // what it burns (0 = burns nothing)
  uint64_t energyPerFuelUnitMilliJ = 0;   // mJ released per unit of fuel
  uint16_t fuelSlotCap = 50;              // units of fuel it can hold
  uint16_t typeId = 0x15;                 // render TypeId (generator art)
};

// Tier-0 burner generator: 90 kW off coal at 4 MJ per unit.
//
// The 90 kW is chosen against the 30 kW electric smelter so the ratio a player
// meets first is 1 generator : 3 smelters, and the fourth smelter is the moment
// the panel first reads under 100%. That is the whole lesson in one placement.
static constexpr uint64_t kCoalEnergyMilliJ = 4000000000ull;  // 4 MJ
inline GeneratorSpec burnerGeneratorSpec(ItemId coalItem) {
  GeneratorSpec g;
  g.ratedW = 90000;
  g.fuelItem = coalItem;
  g.energyPerFuelUnitMilliJ = kCoalEnergyMilliJ;
  g.fuelSlotCap = 50;
  g.typeId = 0x15;
  return g;
}

// =============================================================================
// PER-NETWORK STATISTICS — this is the payload a supply-and-demand panel draws.
// Every field is a plain integer read straight off the last solve().
// =============================================================================
struct NetworkStats {
  NetworkId id = kNoNetwork;
  int64_t capacityW = 0;      // what the generators COULD make (rated, fuelled)
  int64_t productionW = 0;    // what they actually made this tick (== consumptionW
                              // when in surplus, because generators throttle)
  int64_t demandW = 0;        // what consumers ASKED for
  int64_t consumptionW = 0;   // what they actually got (== min(demand, capacity))
  uint32_t satisfactionQ16 = kQ16One;
  uint32_t poleCount = 0;
  uint32_t generatorCount = 0;
  uint32_t consumerCount = 0;
  uint32_t fuelledGeneratorCount = 0;  // generators with energy left this tick

  double satisfaction() const {
    return static_cast<double>(satisfactionQ16) / 65536.0;
  }
  bool inDeficit() const { return satisfactionQ16 < kQ16One; }
};

// One sample of a network's history — what a panel graphs over time.
struct NetworkSample {
  uint64_t tick = 0;
  int32_t productionW = 0;
  int32_t demandW = 0;
  uint32_t satisfactionQ16 = kQ16One;
};

// A wire the renderer should draw: the two pole ids and their positions. A
// network of N poles emits exactly N-1 of these.
struct WireSegment {
  PoleId a = kInvalidId;
  PoleId b = kInvalidId;
  NetworkId network = kNoNetwork;
  float ax = 0, ay = 0, az = 0;
  float bx = 0, by = 0, bz = 0;
};

// =============================================================================
// PowerGrid — the whole model.
//
//   addPole / removePole / addGenerator / addConsumer   build the topology
//   setDemand(consumer, watts)                          publish this tick's want
//   solve(tick)                                         one pass, one answer
//   stats(network) / history(network) / wireSegments()  what a panel reads
//
// Topology changes mark the partition dirty; solve() rebuilds it lazily, so a
// caller may place a hundred poles and pay for one rebuild.
// =============================================================================
class PowerGrid {
 public:
  explicit PowerGrid(uint32_t historyCapacity = 300)
      : historyCap_(historyCapacity ? historyCapacity : 1) {}

  // ---------------------------------------------------------------- topology --
  PoleId addPole(float x, float y, float z, PoleClass cls = PoleClass::Small) {
    Pole p;
    p.x = x; p.y = y; p.z = z;
    p.cls = cls;
    const PoleClassDef& d = poleClassDef(cls);
    p.supplyR2Mm2 = radiusToSqMm(d.supplyRadiusM);
    p.wireR2Mm2 = radiusToSqMm(d.wireReachM);
    p.alive = true;
    poles_.push_back(p);
    dirty_ = true;
    return static_cast<PoleId>(poles_.size() - 1);
  }

  // Remove a pole. The network it was holding together may SPLIT; the next
  // solve() re-partitions and every machine follows whichever half now feeds it.
  // The slot is tombstoned rather than compacted so existing PoleIds stay valid.
  bool removePole(PoleId id) {
    if (id >= poles_.size() || !poles_[id].alive) return false;
    poles_[id].alive = false;
    dirty_ = true;
    return true;
  }

  bool poleAlive(PoleId id) const {
    return id < poles_.size() && poles_[id].alive;
  }
  uint32_t livePoleCount() const {
    uint32_t n = 0;
    for (const Pole& p : poles_) if (p.alive) ++n;
    return n;
  }

  NodeId addGenerator(float x, float y, float z, const GeneratorSpec& spec) {
    Node n;
    n.x = x; n.y = y; n.z = z;
    n.isGenerator = true;
    n.spec = spec;
    n.alive = true;
    nodes_.push_back(n);
    dirty_ = true;
    return static_cast<NodeId>(nodes_.size() - 1);
  }

  // A consumer's `ratedDrawW` is its nameplate: what it draws when it is doing
  // work. Its per-tick WANT is published separately via setDemand, because a
  // starved machine wants nothing and must not brown out its neighbours.
  NodeId addConsumer(float x, float y, float z, int32_t ratedDrawW) {
    Node n;
    n.x = x; n.y = y; n.z = z;
    n.isGenerator = false;
    n.ratedDrawW = ratedDrawW;
    n.demandW = ratedDrawW;  // default: wants its nameplate until told otherwise
    n.alive = true;
    nodes_.push_back(n);
    dirty_ = true;
    return static_cast<NodeId>(nodes_.size() - 1);
  }

  bool removeNode(NodeId id) {
    if (id >= nodes_.size() || !nodes_[id].alive) return false;
    nodes_[id].alive = false;
    dirty_ = true;
    return true;
  }

  // Move a node (a machine re-placed). Marks the partition dirty.
  void setNodePosition(NodeId id, float x, float y, float z) {
    if (id >= nodes_.size()) return;
    nodes_[id].x = x; nodes_[id].y = y; nodes_[id].z = z;
    dirty_ = true;
  }

  // ------------------------------------------------------------------- fuel --
  // Insert fuel units into a generator. Returns the number actually accepted
  // (bounded by the slot cap). Wrong fuel item is refused outright.
  uint16_t insertFuel(NodeId id, ItemId item, uint16_t count) {
    if (id >= nodes_.size() || !nodes_[id].alive || !nodes_[id].isGenerator)
      return 0;
    Node& n = nodes_[id];
    if (item != n.spec.fuelItem || n.spec.energyPerFuelUnitMilliJ == 0) return 0;
    uint16_t room = n.spec.fuelSlotCap > n.fuelUnits
                        ? static_cast<uint16_t>(n.spec.fuelSlotCap - n.fuelUnits)
                        : 0;
    uint16_t take = count < room ? count : room;
    n.fuelUnits = static_cast<uint16_t>(n.fuelUnits + take);
    return take;
  }

  uint16_t fuelUnits(NodeId id) const {
    return id < nodes_.size() ? nodes_[id].fuelUnits : 0;
  }
  uint64_t fuelEnergyMilliJ(NodeId id) const {
    return id < nodes_.size() ? nodes_[id].burnPoolMilliJ : 0;
  }
  // Total energy a generator still holds: the partly-burnt unit in the pool plus
  // the whole units queued behind it. This is the honest "how long until it
  // stops" figure a panel should show.
  uint64_t storedEnergyMilliJ(NodeId id) const {
    if (id >= nodes_.size()) return 0;
    const Node& n = nodes_[id];
    return n.burnPoolMilliJ +
           static_cast<uint64_t>(n.fuelUnits) * n.spec.energyPerFuelUnitMilliJ;
  }

  // ---------------------------------------------------------------- demand ---
  // The per-tick want. A machine that is starved or output-blocked publishes 0.
  void setDemand(NodeId id, int32_t watts) {
    if (id >= nodes_.size() || nodes_[id].isGenerator) return;
    nodes_[id].demandW = watts < 0 ? 0 : watts;
  }
  int32_t demandOf(NodeId id) const {
    return id < nodes_.size() ? nodes_[id].demandW : 0;
  }
  int32_t ratedDrawOf(NodeId id) const {
    return id < nodes_.size() ? nodes_[id].ratedDrawW : 0;
  }

  // ----------------------------------------------------------------- solve ---
  // ONE pass. Per network: sum the fuelled generators' rated output as capacity,
  // sum the consumers' published want as demand, and divide. Then throttle each
  // generator to the share of capacity actually being used and burn its fuel in
  // proportion to what it actually produced.
  //
  // A GENERATOR'S OUTPUT IS NEVER GATED BY NETWORK SATISFACTION. This is not an
  // oversight, it is the rule that makes the model well-defined: if a generator
  // that also consumes had its output scaled by the satisfaction its own draw
  // helped depress, the solve would have a fixed point instead of an answer, and
  // that fixed point can be bistable (all-on and all-off both self-consistent).
  // The analogous shape in the belt sim shipped as a permanent deadlock (FS-17).
  // Here it is closed by construction: supply is a function of FUEL alone.
  void solve(uint64_t tick = 0) {
    if (dirty_) rebuild();

    const size_t nets = netStats_.size();
    for (size_t n = 0; n < nets; ++n) {
      NetworkStats& s = netStats_[n];
      s.capacityW = 0;
      s.productionW = 0;
      s.demandW = 0;
      s.consumptionW = 0;
      s.fuelledGeneratorCount = 0;
      s.satisfactionQ16 = kQ16One;
    }

    // Pass 1 — capacity and demand.
    //
    // A generator's capacity this tick is bounded by the energy it actually
    // holds, not just by its nameplate: availW = min(rated, what the remaining
    // fuel can fund for one tick). This is what makes the model conserve energy
    // EXACTLY. The naive version (capacity = rated whenever any fuel remains)
    // over-delivers on the final, partly-funded tick, minting a sliver of free
    // energy per fuel unit. A sliver is still a mint, and it also reads worse:
    // fuel-bounded capacity makes a generator running dry visibly FADE in the
    // panel instead of dropping off a cliff, which is the more useful signal.
    for (Node& n : nodes_) {
      if (!n.alive || n.network == kNoNetwork) continue;
      NetworkStats& s = netStats_[n.network];
      if (n.isGenerator) {
        n.availableW = availableWattsThisTick(n);
        if (n.availableW > 0) {
          s.capacityW += n.availableW;
          ++s.fuelledGeneratorCount;
        }
      } else {
        s.demandW += n.demandW;
      }
    }

    // Pass 2 — the one division.
    for (size_t n = 0; n < nets; ++n) {
      NetworkStats& s = netStats_[n];
      s.satisfactionQ16 = SatisfactionQ16(s.capacityW, s.demandW);
      s.consumptionW = s.demandW < s.capacityW ? s.demandW : s.capacityW;
      s.productionW = s.consumptionW;  // generators make exactly what is drawn
    }

    // Pass 3 — throttle each generator to the network's load factor and burn
    // fuel for what it actually produced. Load is capped at 1.0; in deficit
    // every generator runs flat out.
    for (Node& n : nodes_) {
      if (!n.alive || !n.isGenerator || n.network == kNoNetwork) continue;
      const NetworkStats& s = netStats_[n.network];
      if (n.availableW <= 0) {
        n.outputW = 0;
        continue;
      }
      uint32_t loadQ16 = kQ16One;
      if (s.capacityW > 0 && s.demandW < s.capacityW) {
        loadQ16 = static_cast<uint32_t>(
            (s.demandW * static_cast<int64_t>(kQ16One)) / s.capacityW);
      }
      n.outputW = static_cast<int32_t>(ApplyQ16(n.availableW, loadQ16));
      burnFor(n, n.outputW);
    }

    // Pass 4 — history.
    for (size_t n = 0; n < nets; ++n) {
      NetworkSample smp;
      smp.tick = tick;
      smp.productionW = clampToI32(netStats_[n].productionW);
      smp.demandW = clampToI32(netStats_[n].demandW);
      smp.satisfactionQ16 = netStats_[n].satisfactionQ16;
      pushHistory(static_cast<NetworkId>(n), smp);
    }
    lastSolveTick_ = tick;
  }

  // ------------------------------------------------------------------ reads --
  size_t networkCount() {
    if (dirty_) rebuild();
    return netStats_.size();
  }

  NetworkId networkOfNode(NodeId id) {
    if (dirty_) rebuild();
    return id < nodes_.size() ? nodes_[id].network : kNoNetwork;
  }
  NetworkId networkOfPole(PoleId id) {
    if (dirty_) rebuild();
    if (id >= poles_.size() || !poles_[id].alive) return kNoNetwork;
    return poles_[id].network;
  }

  // The panel payload. An out-of-range or unformed network reads as an empty
  // one at full satisfaction rather than throwing, so a UI can query freely.
  //
  // BY VALUE on purpose: network ids are re-derived whenever the topology
  // changes, so a reference into the stats vector is a dangling pointer waiting
  // for the next pole placement. The struct is a handful of integers.
  NetworkStats stats(NetworkId n) {
    if (dirty_) rebuild();
    return n < netStats_.size() ? netStats_[n] : NetworkStats{};
  }

  // A consumer's OWN satisfaction. Unpowered (no pole in range) is 0, which is
  // the honest answer and is distinct from "on a network with no generators",
  // which is also 0 but for a reason the panel can name.
  uint32_t satisfactionOfNode(NodeId id) {
    if (dirty_) rebuild();
    if (id >= nodes_.size() || !nodes_[id].alive) return 0;
    const NetworkId n = nodes_[id].network;
    if (n == kNoNetwork || n >= netStats_.size()) return 0;
    return netStats_[n].satisfactionQ16;
  }

  int32_t generatorOutputW(NodeId id) const {
    return id < nodes_.size() ? nodes_[id].outputW : 0;
  }
  // The fuel-bounded capacity this generator offered on the last solve. Equal to
  // its rated output while it has plenty of fuel, and it FADES over the final
  // partly-funded tick as the last unit runs out.
  int32_t generatorAvailableW(NodeId id) const {
    return id < nodes_.size() ? nodes_[id].availableW : 0;
  }

  // Ring-buffer history, oldest first. A panel graphs this directly.
  std::vector<NetworkSample> history(NetworkId n) {
    if (dirty_) rebuild();
    std::vector<NetworkSample> out;
    if (n >= hist_.size()) return out;
    const Ring& r = hist_[n];
    out.reserve(r.count);
    for (uint32_t k = 0; k < r.count; ++k) {
      const uint32_t idx = (r.head + historyCap_ - r.count + k) % historyCap_;
      out.push_back(r.buf[idx]);
    }
    return out;
  }
  uint32_t historyCapacity() const { return historyCap_; }

  // The wires to draw: exactly (poles in network - 1) per network.
  const std::vector<WireSegment>& wireSegments() {
    if (dirty_) rebuild();
    return wires_;
  }

  uint64_t lastSolveTick() const { return lastSolveTick_; }

  // How many times the partition has been recomputed. A caller that mirrors the
  // network assignment somewhere else (automation.h mirrors it into the sim's
  // per-entity network id) watches this instead of re-assigning every tick.
  uint64_t rebuildCount() const { return rebuilds_; }

  // Force the partition to be recomputed now (tests / a caller that wants the
  // topology settled before it queries). solve() does this automatically.
  void rebuildNow() { rebuild(); }

 private:
  struct Pole {
    float x = 0, y = 0, z = 0;
    PoleClass cls = PoleClass::Small;
    int64_t supplyR2Mm2 = 0;
    int64_t wireR2Mm2 = 0;
    bool alive = false;
    NetworkId network = kNoNetwork;
    uint32_t dsu = 0;  // union-find parent (index into poles_)
  };

  struct Node {
    float x = 0, y = 0, z = 0;
    bool isGenerator = false;
    bool alive = false;
    NetworkId network = kNoNetwork;
    // generator
    GeneratorSpec spec;
    uint16_t fuelUnits = 0;
    uint64_t burnPoolMilliJ = 0;  // energy of the unit currently being burnt
    int32_t availableW = 0;       // fuel-bounded capacity offered this tick
    int32_t outputW = 0;          // what it actually made after the load factor
    // consumer
    int32_t ratedDrawW = 0;
    int32_t demandW = 0;
  };

  struct Ring {
    std::vector<NetworkSample> buf;
    uint32_t head = 0;
    uint32_t count = 0;
  };

  // Distances live in SQUARED MILLIMETRES as int64 so connectivity is an exact
  // integer comparison — no float epsilon decides whether two poles are wired,
  // which is what keeps the partition bit-identical across toolchains.
  static int64_t toMm(float metres) {
    return static_cast<int64_t>(static_cast<double>(metres) * 1000.0 +
                                (metres < 0 ? -0.5 : 0.5));
  }
  static int64_t radiusToSqMm(float metres) {
    const int64_t mm = toMm(metres);
    return mm * mm;
  }
  static int64_t sqDistMm2(float ax, float ay, float az, float bx, float by,
                           float bz) {
    const int64_t dx = toMm(ax) - toMm(bx);
    const int64_t dy = toMm(ay) - toMm(by);
    const int64_t dz = toMm(az) - toMm(bz);
    return dx * dx + dy * dy + dz * dz;
  }
  static int32_t clampToI32(int64_t v) {
    if (v > 2147483647ll) return 2147483647;
    if (v < -2147483648ll) return -2147483648ll;
    return static_cast<int32_t>(v);
  }

  uint32_t find(uint32_t i) {
    while (poles_[i].dsu != i) {
      poles_[i].dsu = poles_[poles_[i].dsu].dsu;  // path halving
      i = poles_[i].dsu;
    }
    return i;
  }
  void unite(uint32_t a, uint32_t b) {
    a = find(a);
    b = find(b);
    if (a == b) return;
    // Union by SMALLER INDEX, not by rank: it makes the root of a component
    // deterministically its lowest-numbered pole, which is what lets network
    // ids be stable and reproducible without a sort.
    if (a < b) poles_[b].dsu = a; else poles_[a].dsu = b;
  }

  // Watts this generator can actually sustain for ONE tick, given the energy it
  // still holds. A generator with no fuel model (energyPerFuelUnitMilliJ == 0)
  // is a free supply and always offers its nameplate — that is the escape hatch
  // for scripted scenes and for future generators that burn nothing, e.g. solar.
  //
  // One tick of W watts at 60 Hz costs W*1000/60 mJ, so the largest W the stored
  // energy can fund is stored*60/1000. Truncation is toward zero, so a generator
  // can never promise watts it cannot deliver.
  int32_t availableWattsThisTick(const Node& n) const {
    if (n.spec.ratedW <= 0) return 0;
    if (n.spec.energyPerFuelUnitMilliJ == 0) return n.spec.ratedW;
    const uint64_t stored =
        n.burnPoolMilliJ +
        static_cast<uint64_t>(n.fuelUnits) * n.spec.energyPerFuelUnitMilliJ;
    if (stored == 0) return 0;
    const uint64_t fundableW = (stored * 60ull) / 1000ull;
    const uint64_t rated = static_cast<uint64_t>(n.spec.ratedW);
    return static_cast<int32_t>(fundableW < rated ? fundableW : rated);
  }

  // Burn fuel for `watts` of output over one tick at 60 Hz. Integer millijoules.
  // Pass 1 already guaranteed the stored energy covers this, so the loop always
  // funds the full amount: energy in == energy out, exactly, per fuel unit.
  void burnFor(Node& n, int32_t watts) {
    if (watts <= 0 || n.spec.energyPerFuelUnitMilliJ == 0) return;
    uint64_t needMilliJ = (static_cast<uint64_t>(watts) * 1000ull) / 60ull;
    while (needMilliJ > 0) {
      if (n.burnPoolMilliJ == 0) {
        if (n.fuelUnits == 0) break;  // cannot happen after pass 1; belt+braces
        --n.fuelUnits;
        n.burnPoolMilliJ = n.spec.energyPerFuelUnitMilliJ;
      }
      const uint64_t take =
          needMilliJ < n.burnPoolMilliJ ? needMilliJ : n.burnPoolMilliJ;
      n.burnPoolMilliJ -= take;
      needMilliJ -= take;
    }
  }

  void pushHistory(NetworkId n, const NetworkSample& s) {
    if (n >= hist_.size()) hist_.resize(n + 1);
    Ring& r = hist_[n];
    if (r.buf.size() != historyCap_) r.buf.assign(historyCap_, NetworkSample{});
    r.buf[r.head] = s;
    r.head = (r.head + 1) % historyCap_;
    if (r.count < historyCap_) ++r.count;
  }

  // -------------------------------------------------------------- rebuild ----
  // Union-find the live poles by mutual wire reach, number the components in
  // ascending lowest-pole order, attach every generator and consumer to the
  // network of the nearest covering pole, and emit the spanning-tree wires.
  void rebuild() {
    dirty_ = false;
    ++rebuilds_;
    const uint32_t np = static_cast<uint32_t>(poles_.size());
    for (uint32_t i = 0; i < np; ++i) {
      poles_[i].dsu = i;
      poles_[i].network = kNoNetwork;
    }

    // Connectivity: two live poles are linked when their separation is within
    // BOTH their wire reaches. Requiring both is the symmetric reading and is
    // what keeps a long-reach substation from silently dragging a short-reach
    // pole into a network the player cannot see the wire for.
    wires_.clear();
    std::vector<std::pair<uint32_t, uint32_t>> treeEdges;
    for (uint32_t i = 0; i < np; ++i) {
      if (!poles_[i].alive) continue;
      for (uint32_t j = i + 1; j < np; ++j) {
        if (!poles_[j].alive) continue;
        const int64_t d2 = sqDistMm2(poles_[i].x, poles_[i].y, poles_[i].z,
                                     poles_[j].x, poles_[j].y, poles_[j].z);
        if (d2 > poles_[i].wireR2Mm2 || d2 > poles_[j].wireR2Mm2) continue;
        // Only keep the edge if it JOINS two components. That is Kruskal with
        // an implicit uniform weight, and it is why the wire count is N-1 per
        // network rather than the number of pairs within reach.
        if (find(i) != find(j)) {
          unite(i, j);
          treeEdges.push_back({i, j});
        }
      }
    }

    // Number components in ascending root-pole order so ids are deterministic.
    std::vector<uint32_t> rootToNet(np, kInvalidId);
    uint32_t nextNet = 0;
    for (uint32_t i = 0; i < np; ++i) {
      if (!poles_[i].alive) continue;
      const uint32_t r = find(i);
      if (rootToNet[r] == kInvalidId) rootToNet[r] = nextNet++;
      poles_[i].network = static_cast<NetworkId>(rootToNet[r]);
    }

    netStats_.assign(nextNet, NetworkStats{});
    for (uint32_t n = 0; n < nextNet; ++n)
      netStats_[n].id = static_cast<NetworkId>(n);
    for (uint32_t i = 0; i < np; ++i)
      if (poles_[i].alive) ++netStats_[poles_[i].network].poleCount;

    // Emit the spanning-tree wires with their endpoints resolved.
    wires_.reserve(treeEdges.size());
    for (const std::pair<uint32_t, uint32_t>& e : treeEdges) {
      WireSegment w;
      w.a = e.first;
      w.b = e.second;
      w.network = poles_[e.first].network;
      w.ax = poles_[e.first].x; w.ay = poles_[e.first].y; w.az = poles_[e.first].z;
      w.bx = poles_[e.second].x; w.by = poles_[e.second].y; w.bz = poles_[e.second].z;
      wires_.push_back(w);
    }

    // Attach generators and consumers to the NEAREST covering pole. Ties break
    // to the lowest pole id, so the same layout always yields the same
    // attachment regardless of iteration order or float comparison luck.
    for (Node& n : nodes_) {
      n.network = kNoNetwork;
      if (!n.alive) continue;
      int64_t best = 0;
      uint32_t bestPole = kInvalidId;
      for (uint32_t i = 0; i < np; ++i) {
        if (!poles_[i].alive) continue;
        const int64_t d2 =
            sqDistMm2(n.x, n.y, n.z, poles_[i].x, poles_[i].y, poles_[i].z);
        if (d2 > poles_[i].supplyR2Mm2) continue;
        if (bestPole == kInvalidId || d2 < best) {
          best = d2;
          bestPole = i;
        }
      }
      if (bestPole != kInvalidId) n.network = poles_[bestPole].network;
    }
    for (const Node& n : nodes_) {
      if (!n.alive || n.network == kNoNetwork) continue;
      if (n.isGenerator) ++netStats_[n.network].generatorCount;
      else ++netStats_[n.network].consumerCount;
    }
  }

  std::vector<Pole> poles_;
  std::vector<Node> nodes_;
  std::vector<NetworkStats> netStats_;
  std::vector<WireSegment> wires_;
  std::vector<Ring> hist_;
  uint32_t historyCap_ = 300;
  uint64_t lastSolveTick_ = 0;
  uint64_t rebuilds_ = 0;
  bool dirty_ = true;
};

}  // namespace power
}  // namespace of
