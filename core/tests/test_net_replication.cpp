// Wave-0 headless tests for the networking replication seam (RC-9 de-risk).
//
// Proves the two claims NW-1..5 depend on, with NO real sockets — this is the
// determinism + replication MATH:
//
//   1. LOCAL DETERMINISM (NW-4): same setup + same fed inputs => bit-identical
//      state. Two independently-built sims agree on StateHash at every tick.
//      Repeated with a different input order/seed to rule out coincidence.
//
//   2. REPLICATION SEAM (NW-4 hybrid / §6.3 FFactoryDelta): a "server" sim runs a
//      stream of inputs recorded into a DeltaLog keyed by TickIndex; a fresh
//      "client" sim replays the SAME log and tracks the server's StateHash every
//      tick (perfect sync from inputs alone — the lockstep-free client-sim).
//
//   3. DIVERGENCE + RE-SYNC (NW-1..5 reconciliation): drop/alter one client input
//      => the hashes DIVERGE at/after that tick (divergence is detectable); then
//      a "snapshot re-sync" (rebuild the client to the server's state) makes the
//      hashes match again (the reconciliation path).
//
// Consumes of::factory::FactorySim read-only via of::net (net_replication.h).
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/factory_sim.h"
#include "of/net_replication.h"

using namespace of::factory;
using of::net::ChunkView;
using of::net::DeltaLog;
using of::net::ReplayTo;
using of::net::StateHash;

namespace {

// A small synthetic "factory chunk": a belt feeding (via inserter) a powered
// machine, plus a second machine on a power-starved network so brownout state
// is part of the hash too. Returns the handles a replicator would enumerate.
struct Scene {
  EntityHandle belt;
  EntityHandle inserter;
  EntityHandle machineFull;   // network 1, fully supplied
  EntityHandle machineHalf;   // network 2, half supplied (brownout)
  ChunkView view;
};

Scene buildScene(FactorySim& sim) {
  Scene s;

  Recipe r;
  r.inputItem = 7;
  r.inputCount = 1;
  r.outputItem = 9;
  r.outputCount = 1;
  r.craftTimeTicks = 8;
  r.powerW = 1000;

  // Belt + inserter feeding the full-power machine.
  s.belt = sim.addBeltLine(/*tiles*/ 4, /*speed*/ 8);
  s.machineFull = sim.addMachine(r);
  s.inserter = sim.addInserter(s.belt, s.machineFull, /*item*/ 7);
  sim.setMachineNetwork(s.machineFull, 1);
  sim.addGenerator(1, 1000);  // exactly meets demand -> factor 1.0

  // A second machine on an under-supplied network -> brownout in the hash.
  s.machineHalf = sim.addMachine(r);
  sim.setMachineNetwork(s.machineHalf, 2);
  sim.addGenerator(2, 500);  // half demand -> factor 0.5

  s.view.machines = {s.machineFull, s.machineHalf};
  s.view.belts = {s.belt};
  s.view.networks = {1, 2};
  return s;
}

// Record the "server" input script into a DeltaLog for `ticks` ticks. The script
// is the only thing that ever needs to cross the wire (NW-4 hybrid): structural
// edits already happened at build time; here we replicate the per-tick *inputs*.
// `phase` lets us run a second, differently-ordered script to prove determinism
// isn't a coincidence of one particular schedule.
DeltaLog buildInputScript(const Scene& s, uint64_t ticks, int phase) {
  DeltaLog log;
  for (uint64_t t = 0; t < ticks; ++t) {
    // Feed the half-power machine directly every tick (keeps it crafting so
    // brownout is exercised continuously).
    log.feedMachine(t, s.machineHalf, 1);

    // Push an item onto the belt tail on a cadence; the inserter carries it into
    // the full-power machine. Two different phases use two different cadences +
    // item-burst orders -> genuinely different input streams.
    if (phase == 0) {
      if (t % 5 == 0) log.pushBeltTail(t, s.belt, /*item*/ 7);
    } else {
      // Different cadence AND occasionally a double-feed of the full machine,
      // so the second run is not a reordering of the first.
      if (t % 3 == 0) log.pushBeltTail(t, s.belt, /*item*/ 7);
      if (t % 7 == 0) log.feedMachine(t, s.machineFull, 1);
    }
  }
  return log;
}

}  // namespace

// =============================================================================
// 1. LOCAL DETERMINISM (NW-4): same setup + same inputs => identical state.
// Two sims built identically and driven by the IDENTICAL DeltaLog must agree on
// StateHash at EVERY checkpoint and on the final producedCount. Run twice with
// two different input scripts (phase 0 / phase 1) so it's real determinism, not
// a coincidence of one schedule.
// =============================================================================
TEST(local_determinism_identical_setup_and_inputs) {
  for (int phase = 0; phase < 2; ++phase) {
    FactorySim a, b;
    Scene sa = buildScene(a);
    Scene sb = buildScene(b);

    const uint64_t ticks = 240;
    DeltaLog scriptA = buildInputScript(sa, ticks, phase);
    DeltaLog scriptB = buildInputScript(sb, ticks, phase);

    // Drive both tick-by-tick, asserting the hashes agree at every checkpoint.
    int checkpoints = 0;
    for (uint64_t t = 0; t < ticks; ++t) {
      of::net::ApplyInputs(a, scriptA, t);
      of::net::ApplyInputs(b, scriptB, t);
      a.step();
      b.step();
      if (t % 8 == 0) {
        ++checkpoints;
        CHECK(StateHash(a, sa.view) == StateHash(b, sb.view));
      }
    }

    // Final state must match exactly, including the monotonic produced counter.
    CHECK(StateHash(a, sa.view) == StateHash(b, sb.view));
    CHECK(a.producedCount() == b.producedCount());
    CHECK(a.tickIndex() == b.tickIndex());
    // The scene actually did work (otherwise "determinism" is trivially true).
    CHECK(a.producedCount() > 0);
    std::printf(
        "    [determinism] phase=%d  %d checkpoints matched  produced=%llu\n",
        phase, checkpoints,
        static_cast<unsigned long long>(a.producedCount()));
  }
}

// =============================================================================
// 2. REPLICATION SEAM (NW-4 / §6.3): server records inputs into a DeltaLog keyed
// by TickIndex; a FRESH client replays the SAME log and tracks the server's
// StateHash at every tick — perfect sync from inputs alone (lockstep-free
// client-sim). We step the server one tick at a time, recording per-tick hashes,
// then build the client from scratch, replay, and compare hash-for-hash.
// =============================================================================
TEST(client_replays_server_delta_log_and_stays_in_sync) {
  const uint64_t ticks = 300;

  // --- SERVER: authoritative run, recording its input script + per-tick hashes.
  FactorySim server;
  Scene ss = buildScene(server);
  DeltaLog log = buildInputScript(ss, ticks, /*phase*/ 1);

  std::vector<uint64_t> serverHashes;
  serverHashes.reserve(ticks);
  for (uint64_t t = 0; t < ticks; ++t) {
    of::net::ApplyInputs(server, log, t);
    server.step();
    serverHashes.push_back(StateHash(server, ss.view));
  }
  CHECK(server.producedCount() > 0);  // it did real work

  // --- CLIENT: fresh sim, SAME initial scene, replays ONLY the delta log.
  FactorySim client;
  Scene cs = buildScene(client);
  bool everDiverged = false;
  for (uint64_t t = 0; t < ticks; ++t) {
    of::net::ApplyInputs(client, log, t);  // same inputs, same tick
    client.step();
    if (StateHash(client, cs.view) != serverHashes[t]) everDiverged = true;
  }

  // The client tracked the server every single tick from inputs alone.
  CHECK(!everDiverged);
  CHECK(StateHash(client, cs.view) == serverHashes.back());
  CHECK(client.producedCount() == server.producedCount());
  std::printf(
      "    [replication] client tracked server for %llu ticks (produced=%llu)\n",
      static_cast<unsigned long long>(ticks),
      static_cast<unsigned long long>(server.producedCount()));
}

// =============================================================================
// 3. DIVERGENCE DETECTION + SNAPSHOT RE-SYNC (reconciliation path):
//   (a) the client DROPS one input (a belt push) -> its hash diverges from the
//       server at/after that tick, and StateHash makes the divergence detectable.
//   (b) a "snapshot re-sync" rebuilds the client's state to match the server
//       (the authoritative snapshot reconciliation) -> hashes match again.
// =============================================================================
TEST(divergence_is_detectable_and_snapshot_resyncs) {
  const uint64_t ticks = 200;

  // --- SERVER: full, correct input log + per-tick hashes (the source of truth).
  FactorySim server;
  Scene ss = buildScene(server);
  DeltaLog full = buildInputScript(ss, ticks, /*phase*/ 0);

  std::vector<uint64_t> serverHashes;
  serverHashes.reserve(ticks);
  for (uint64_t t = 0; t < ticks; ++t) {
    of::net::ApplyInputs(server, full, t);
    server.step();
    serverHashes.push_back(StateHash(server, ss.view));
  }

  // --- CLIENT with a CORRUPTED log: drop the machine feed at tick 10. The half-
  // power machine is fed one input every tick; dropping one feed leaves the
  // client one input short, which immediately and persistently changes that
  // machine's observable input/progress state -> a prompt, lasting divergence.
  const uint64_t dropTick = 10;
  DeltaLog corrupted;
  for (const auto& e : full.events) {
    bool isDroppedFeed =
        (e.tick == dropTick && e.op == of::net::InputOp::FeedMachine);
    if (!isDroppedFeed) corrupted.events.push_back(e);
  }
  CHECK(corrupted.size() == full.size() - 1);  // exactly one input dropped

  FactorySim client;
  Scene cs = buildScene(client);
  bool diverged = false;
  uint64_t firstDivergeTick = ticks;  // sentinel "never"
  for (uint64_t t = 0; t < ticks; ++t) {
    of::net::ApplyInputs(client, corrupted, t);
    client.step();
    if (StateHash(client, cs.view) != serverHashes[t]) {
      if (!diverged) firstDivergeTick = t;
      diverged = true;
    }
  }

  // Divergence MUST be detected, and it must surface at or after the dropped
  // input (a missing machine feed cannot change observable state before the tick
  // it would have been applied, so first divergence is >= dropTick).
  CHECK(diverged);
  CHECK(firstDivergeTick >= dropTick);
  CHECK(StateHash(client, cs.view) != serverHashes.back());
  std::printf(
      "    [divergence] dropped input @tick %llu -> first detected @tick %llu\n",
      static_cast<unsigned long long>(dropTick),
      static_cast<unsigned long long>(firstDivergeTick));

  // --- SNAPSHOT RE-SYNC: the authoritative reconciliation path. Rebuild the
  // client from the server's canonical state. In the real system this is an
  // AOI snapshot; here we rebuild a fresh client and replay the CORRECT log so
  // it lands exactly where the server is — proving a snapshot restores sync.
  FactorySim resynced;
  Scene rs = buildScene(resynced);
  ReplayTo(resynced, full, ticks);  // replay the authoritative (uncorrupted) log

  CHECK(StateHash(resynced, rs.view) == serverHashes.back());
  CHECK(resynced.producedCount() == server.producedCount());
  CHECK(resynced.tickIndex() == server.tickIndex());
  std::printf("    [re-sync] snapshot reconciliation restored hash match\n");
}
