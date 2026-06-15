#pragma once
// =============================================================================
// net_replication.h — Networking Wave-0 headless replication-seam prototype.
//
// Validates the RC-9 de-risk item the execution plan flagged: is the factory
// sim's delta/event stream — keyed by TickIndex (spike3-factory-sim §6.3,
// FFactoryDelta) — a *sufficient* client-sync seam, given that the factory
// chunk is *locally deterministic* (NW-4 / decision NW-4)?
//
// This is the determinism + replication MATH that NW-1..5 depend on. There are
// NO real sockets here. We model the two halves of the hybrid:
//
//   (1) chunk-local determinism (NW-4): same setup + same inputs => bit-identical
//       state. Proven by hashing the sim's observable state and asserting two
//       independently-driven sims agree at every tick.
//
//   (2) delta/local-sim replication (NW-4 hybrid, NW-1 no-lockstep): the server
//       records its *inputs* (structural edits + feeds) into a DeltaLog keyed by
//       TickIndex; a fresh client sim replays the SAME log tick-by-tick and stays
//       in perfect sync — the "replicate inputs, client-sims the chunk" claim.
//       A dropped/altered input diverges the hash (detectable), and a snapshot
//       re-sync (rebuild the client to the server's state) reconciles it.
//
// We CONSUME of::factory::FactorySim strictly READ-ONLY through its public API:
//   - StateHash() reads only public getters (producedCount, machineInput/Output,
//     machineProgress, tickIndex, brownoutRatio, line(), entity/activeCount).
//   - The input ops call only public mutators (feedMachine, line().tryPushTail,
//     setActive, addNetworkBaseDemand) — the same surface a server applies when
//     it drains its authoritative intent queue (spike3 §11.2 C-5).
// We do NOT modify factory_sim.h or any other core (they may be edited in
// parallel). Header-only; depends only on factory_sim.h + the C++17 stdlib.
// =============================================================================
#include <cstdint>
#include <vector>

#include "of/factory_sim.h"

namespace of {
namespace net {

// =============================================================================
// StateHash — a deterministic 64-bit digest over the sim's OBSERVABLE state.
//
// FNV-1a (64-bit) over the public accessors, in a FIXED order so the same state
// always hashes identically and ANY discrete-state difference flips the hash.
// This is the divergence detector: a client whose replay drifts from the server
// produces a different StateHash on the tick the drift first shows up.
//
// What we fold in (all reachable via the public API, no core change needed):
//   - tickIndex()           — the replication key itself (D-004).
//   - entityCount()         — structural integrity (placements/removals).
//   - producedCount()       — the monotonic lifetime craft counter (INT-1).
//   - per machine: machineInput / machineOutput / machineProgress.
//   - per belt line: headGap, tailGap, head_ cursor, fullyCompressed, and the
//     itemGaps[]/itemTypes[] arrays (the §2 transport-line discrete state).
//   - per network: a quantized brownout factor (the one float, taken as the
//     same Q16 fixed-point integer the sim stores, so the hash stays exact).
//
// The caller supplies the machine + belt handles + network ids it cares about
// (the "chunk view"), exactly as a real chunk replicator would enumerate its
// own entities. Order is caller-fixed; we hash in that order.
// =============================================================================

// What a hash should cover for a given chunk/scene. The caller fills this once
// at setup (it knows which handles it created) and reuses it every tick.
struct ChunkView {
  std::vector<of::factory::EntityHandle> machines;
  std::vector<of::factory::EntityHandle> belts;
  std::vector<uint16_t> networks;  // power networks to fold brownout state for
};

namespace detail {
// 64-bit FNV-1a primitives. Folding raw little-endian bytes of each integer.
static constexpr uint64_t kFnvOffset = 1469598103934665603ull;
static constexpr uint64_t kFnvPrime = 1099511628211ull;

inline void fnvByte(uint64_t& h, uint8_t b) {
  h ^= static_cast<uint64_t>(b);
  h *= kFnvPrime;
}

inline void fnvU64(uint64_t& h, uint64_t v) {
  for (int i = 0; i < 8; ++i) fnvByte(h, static_cast<uint8_t>((v >> (8 * i)) & 0xFF));
}
}  // namespace detail

// Compute the deterministic state digest for the chunk described by `view`.
inline uint64_t StateHash(const of::factory::FactorySim& sim, const ChunkView& view) {
  using detail::fnvU64;
  uint64_t h = detail::kFnvOffset;

  // Global scalars first.
  fnvU64(h, sim.tickIndex());
  fnvU64(h, static_cast<uint64_t>(sim.entityCount()));
  fnvU64(h, sim.producedCount());

  // Per-machine discrete state, in caller-fixed order.
  for (const auto& m : view.machines) {
    fnvU64(h, static_cast<uint64_t>(m.index));
    fnvU64(h, static_cast<uint64_t>(sim.machineInput(m)));
    fnvU64(h, static_cast<uint64_t>(sim.machineOutput(m)));
    fnvU64(h, static_cast<uint64_t>(sim.machineProgress(m)));
  }

  // Per-belt transport-line discrete state (§2). All public on TransportLine.
  for (const auto& b : view.belts) {
    const of::factory::TransportLine& l = sim.line(b);
    fnvU64(h, static_cast<uint64_t>(b.index));
    fnvU64(h, static_cast<uint64_t>(l.capacityUnits));
    fnvU64(h, static_cast<uint64_t>(l.speedUnitsPerTick));
    fnvU64(h, static_cast<uint64_t>(l.headGap));
    fnvU64(h, static_cast<uint64_t>(l.tailGap));
    fnvU64(h, static_cast<uint64_t>(l.head_));
    fnvU64(h, static_cast<uint64_t>(l.fullyCompressed ? 1u : 0u));
    fnvU64(h, static_cast<uint64_t>(l.itemGaps.size()));
    for (uint32_t g : l.itemGaps) fnvU64(h, static_cast<uint64_t>(g));
    for (of::factory::ItemId it : l.itemTypes) fnvU64(h, static_cast<uint64_t>(it));
  }

  // Per-network brownout state — taken as the exact Q16 the sim stores so the
  // one float in the hot path never makes the hash non-deterministic.
  for (uint16_t net : view.networks) {
    // brownoutRatio() returns the stored Q16 / 65536. Re-quantize back to the
    // integer Q16 so we fold the *exact* discrete value (no float compare).
    uint32_t q16 =
        static_cast<uint32_t>(sim.brownoutRatio(net) * 65536.0 + 0.5);
    fnvU64(h, static_cast<uint64_t>(net));
    fnvU64(h, static_cast<uint64_t>(q16));
  }

  return h;
}

// =============================================================================
// InputEvent / DeltaLog — the FFactoryDelta-style replication seam (§6.3).
//
// The server records every *input* it applies to its authoritative chunk as an
// InputEvent stamped with the TickIndex it takes effect on. The ordered list of
// these (the DeltaLog) is ALL a client needs to reproduce the chunk: because the
// sim is locally deterministic, replaying the same inputs at the same ticks
// yields the same state (NW-4). This is the factory analogue of Factorio
// lockstep, scoped to one locally-deterministic chunk (NW-1: the *global* game
// is not lockstep).
//
// Op set mirrors the intent->mutation surface a server actually replicates
// (spike3 §11.2 C-5 / §6.3 EFactoryEvent): feed a machine input, push an item
// onto a belt tail, toggle an entity's active flag, add network base demand.
// `target` is the entity index (machine/belt) the op applies to; `a`/`b` are the
// type-specific payload (count / itemId / network / watts).
// =============================================================================

enum class InputOp : uint8_t {
  FeedMachine,        // target=machine index, a=count             (feedMachine)
  PushBeltTail,       // target=belt index,    a=itemId            (line().tryPushTail)
  SetActive,          // target=entity index,  a=0/1               (setActive)
  AddNetworkDemand,   // a=network id,         b=watts (int32 bits)(addNetworkBaseDemand)
};

struct InputEvent {
  uint64_t tick = 0;     // TickIndex this input takes effect on (the order key).
  InputOp op = InputOp::FeedMachine;
  uint32_t target = 0;   // entity index (for entity-scoped ops).
  uint32_t a = 0;        // primary payload.
  uint32_t b = 0;        // secondary payload (e.g. signed watts via bit-cast).
};

// An ordered, tick-keyed list of input events — the FFactoryDelta stream.
// Append in tick order; events for the same tick are applied in append order
// (the deterministic tie-break C-5 relies on).
struct DeltaLog {
  std::vector<InputEvent> events;

  void feedMachine(uint64_t tick, of::factory::EntityHandle m, uint16_t count) {
    events.push_back({tick, InputOp::FeedMachine, m.index, count, 0});
  }
  void pushBeltTail(uint64_t tick, of::factory::EntityHandle belt,
                    of::factory::ItemId item) {
    events.push_back({tick, InputOp::PushBeltTail, belt.index, item, 0});
  }
  void setActive(uint64_t tick, of::factory::EntityHandle h, bool active) {
    events.push_back({tick, InputOp::SetActive, h.index, active ? 1u : 0u, 0});
  }
  void addNetworkDemand(uint64_t tick, uint16_t network, int32_t watts) {
    events.push_back({tick, InputOp::AddNetworkDemand, 0,
                      static_cast<uint32_t>(network),
                      static_cast<uint32_t>(watts)});
  }

  size_t size() const { return events.size(); }
};

// Rebuild an EntityHandle from a bare index. The sim's public mutators only key
// off handle.index (generation is unused for live slots in the Wave-0 core), so
// an index-only handle is sufficient to address an entity for replay.
inline of::factory::EntityHandle handleOf(uint32_t index) {
  of::factory::EntityHandle h;
  h.index = index;
  h.generation = 0;
  return h;
}

// Apply a single recorded input to a sim. Pure dispatch over InputOp using only
// public mutators — this is the "drain the replicated intent" step.
inline void ApplyEvent(of::factory::FactorySim& sim, const InputEvent& e) {
  switch (e.op) {
    case InputOp::FeedMachine:
      sim.feedMachine(handleOf(e.target), static_cast<uint16_t>(e.a));
      break;
    case InputOp::PushBeltTail:
      // tryPushTail may fail (no tail room) — that's fine and deterministic:
      // the server saw the same true/false, so client + server agree.
      sim.line(handleOf(e.target)).tryPushTail(static_cast<of::factory::ItemId>(e.a));
      break;
    case InputOp::SetActive:
      sim.setActive(handleOf(e.target), e.a != 0);
      break;
    case InputOp::AddNetworkDemand:
      sim.addNetworkBaseDemand(static_cast<uint16_t>(e.a),
                               static_cast<int32_t>(e.b));
      break;
  }
}

// Apply every event in `log` scheduled for `tick` (in append order). Returns the
// number applied. This is what both the server (as it records) and a replaying
// client call at the *start* of a tick, before sim.step(), so an input "takes
// effect on tick T" identically on both sides.
inline size_t ApplyInputs(of::factory::FactorySim& sim, const DeltaLog& log,
                          uint64_t tick) {
  size_t n = 0;
  for (const auto& e : log.events) {
    if (e.tick == tick) {
      ApplyEvent(sim, e);
      ++n;
    }
  }
  return n;
}

// Drive a sim forward by replaying its delta log: for each tick in [0, ticks),
// apply that tick's recorded inputs, then step once. This is the client's
// lockstep-free "replay the server's inputs" path — given the same log + the
// same initial scene, it reproduces the server's state exactly (NW-4).
inline void ReplayTo(of::factory::FactorySim& sim, const DeltaLog& log,
                     uint64_t ticks) {
  for (uint64_t t = 0; t < ticks; ++t) {
    ApplyInputs(sim, log, t);
    sim.step();
  }
}

}  // namespace net
}  // namespace of
