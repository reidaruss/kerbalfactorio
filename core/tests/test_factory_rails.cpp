// Wave-1 headless tests for the ON-RAILS factory abstraction (Spike 3 §5, FS-4).
// Proves gate G2: a factory chunk that leaves the active band is demoted to a
// cheap steady-state production-rate model, advanced by rate x elapsed while
// unobserved (bounded by input/output storage so it cannot run forever or
// duplicate), then promoted back with its buffers reconstructed — and the total
// produced equals what continuous active running would give over the same
// elapsed time, NEVER greater (no dupes).
//
//   - G2 fidelity / no-dupe : active(T) == active(Ta)+demote+rails(M)+promote+
//                             active(Tb), with Ta+M+Tb == T, and produced never
//                             exceeds the continuous-active baseline.
//   - Storage bound (input) : an input-starved base stops producing on-rails the
//                             instant its input buffer empties.
//   - Storage bound (output): a base with a full output buffer stops producing
//                             on-rails the instant the buffer fills.
//   - Determinism (NW-4)    : same elapsed ticks -> identical reconstructed state
//                             across repeated runs and across split points.
//   - Long-warp bound       : a year on-rails cannot exceed physical storage.
#include <cstdio>

#include "test_framework.h"
#include "of/factory_sim.h"

using namespace of::factory;

namespace {

// Build a single-machine factory: one machine on a recipe, pre-fed `inputUnits`
// of input, optional output cap. No inserters/belts — the machine alone is the
// cleanest fidelity probe (the rail model is a per-machine rate model). Returns
// the machine handle by out-param.
FactorySim makeOneMachine(EntityHandle& m, uint16_t inputUnits,
                          uint16_t outputCap, uint32_t craftTimeTicks) {
  FactorySim sim;
  Recipe r;
  r.inputItem = 1;
  r.inputCount = 1;
  r.outputItem = 2;
  r.outputCount = 1;
  r.craftTimeTicks = craftTimeTicks;
  r.powerW = 0;  // unpowered -> brownout 1.0, isolate the rate/storage logic
  m = sim.addMachine(r);
  sim.feedMachine(m, inputUnits);
  if (outputCap) sim.setMachineOutputCap(m, outputCap);
  return sim;
}

}  // namespace

// =============================================================================
// G2 — FIDELITY + NO-DUPE.
//
// Continuous-active baseline vs an active->demote->on-rails->promote->active
// run over the SAME total elapsed ticks. The on-rails path must reproduce the
// baseline produced count EXACTLY, and (the no-dupe invariant) never exceed it.
// =============================================================================
TEST(rails_fidelity_matches_continuous_active_no_dupe) {
  const uint32_t craft = 30;
  const uint16_t input = 1000;  // plenty: time, not input, is the limiter here
  const uint64_t Ttotal = 1200;

  // --- Baseline: run the SAME scene active for all Ttotal ticks. ------------
  EntityHandle mb;
  FactorySim base = makeOneMachine(mb, input, /*cap*/ 0, craft);
  for (uint64_t t = 0; t < Ttotal; ++t) base.step();
  const uint64_t pBaseline = base.producedCount();
  std::printf("    [G2] continuous-active produced = %llu over %llu ticks\n",
              static_cast<unsigned long long>(pBaseline),
              static_cast<unsigned long long>(Ttotal));
  CHECK(pBaseline > 0);

  // --- Split: active Ta, demote, on-rails M, promote, active Tb. ------------
  // Sweep several split points to prove the seam is invisible wherever it lands
  // (including a demote MID-CRAFT, which carries in-flight progress exactly).
  const uint64_t splits[][2] = {
      {0, 1200}, {7, 800}, {31, 600}, {123, 900}, {600, 500}, {1199, 1}};
  for (auto& sp : splits) {
    const uint64_t Ta = sp[0];
    const uint64_t M = sp[1];
    const uint64_t Tb = (Ta + M <= Ttotal) ? Ttotal - Ta - M : 0;
    if (Ta + M > Ttotal) continue;

    EntityHandle m;
    FactorySim sim = makeOneMachine(m, input, /*cap*/ 0, craft);
    for (uint64_t t = 0; t < Ta; ++t) sim.step();         // active phase 1
    CHECK(!sim.onRails());
    sim.Demote();                                          // leaves active band
    CHECK(sim.onRails());
    // While on-rails, step() must NOT advance the demoted machine.
    const uint64_t pAtDemote = sim.producedCount();
    sim.step();  // a stray tick while demoted produces nothing extra
    CHECK(sim.producedCount() == pAtDemote);
    sim.AdvanceOnRails(M);                                 // rate x elapsed
    sim.Promote();                                         // reconstruct buffers
    CHECK(!sim.onRails());
    for (uint64_t t = 0; t < Tb; ++t) sim.step();          // active phase 2

    const uint64_t pSplit = sim.producedCount();
    std::printf("    [G2] split Ta=%llu M=%llu Tb=%llu -> produced=%llu\n",
                static_cast<unsigned long long>(Ta),
                static_cast<unsigned long long>(M),
                static_cast<unsigned long long>(Tb),
                static_cast<unsigned long long>(pSplit));
    // FIDELITY: exact match to continuous active over the same total time.
    CHECK(pSplit == pBaseline);
    // NO-DUPE: on-rails never produces MORE than active running would.
    CHECK(pSplit <= pBaseline);
    // TickIndex continuous across the cycle: same ticks elapsed either way.
    CHECK(sim.tickIndex() == Ttotal);
  }
}

// =============================================================================
// STORAGE BOUND (INPUT): an input-starved base stops producing on-rails when its
// input buffer empties — it does NOT keep conjuring output from nothing.
// =============================================================================
TEST(rails_input_bound_stops_when_input_runs_out) {
  const uint32_t craft = 10;
  const uint16_t input = 5;  // exactly 5 crafts' worth, no replenishment
  EntityHandle m;
  FactorySim sim = makeOneMachine(m, input, /*cap*/ 0, craft);

  sim.Demote();
  // Advance for FAR longer than the input could ever sustain (10000 ticks could
  // in principle do 1000 crafts; input caps it at 5).
  sim.AdvanceOnRails(10000);
  sim.Promote();

  const uint64_t produced = sim.producedCount();
  std::printf("    [bound:input] input=%u crafts-possible=%u  produced=%llu\n",
              input, input, static_cast<unsigned long long>(produced));
  // Bounded by input: exactly 5 produced, not 1000. No item from nothing.
  CHECK(produced == 5);
  CHECK(sim.machineInput(m) == 0);  // input fully consumed

  // Cross-check against continuous active for the same elapsed — must agree.
  EntityHandle mb;
  FactorySim base = makeOneMachine(mb, input, /*cap*/ 0, craft);
  for (uint64_t t = 0; t < 10000; ++t) base.step();
  CHECK(base.producedCount() == produced);  // identical stall behaviour
}

// =============================================================================
// STORAGE BOUND (OUTPUT): a base whose output buffer fills stops producing
// on-rails the instant the buffer is full — it cannot overfill beyond storage.
// =============================================================================
TEST(rails_output_bound_stops_when_output_full) {
  const uint32_t craft = 10;
  const uint16_t input = 1000;   // input is NOT the limiter
  const uint16_t outCap = 7;     // only room for 7 outputs
  EntityHandle m;
  FactorySim sim = makeOneMachine(m, input, outCap, craft);

  sim.Demote();
  sim.AdvanceOnRails(100000);  // try to produce ~10000; cap stops it at 7
  sim.Promote();

  const uint64_t produced = sim.producedCount();
  std::printf("    [bound:output] cap=%u  produced=%llu  out-slot=%u\n", outCap,
              static_cast<unsigned long long>(produced), sim.machineOutput(m));
  // Bounded by output storage: exactly outCap produced, never more.
  CHECK(produced == outCap);
  CHECK(sim.machineOutput(m) == outCap);   // buffer exactly full, not over
  CHECK(sim.machineOutput(m) <= outCap);   // never exceeds physical storage

  // Cross-check vs continuous active under the SAME cap — identical stall.
  EntityHandle mb;
  FactorySim base = makeOneMachine(mb, input, outCap, craft);
  for (uint64_t t = 0; t < 100000; ++t) base.step();
  CHECK(base.producedCount() == produced);
  CHECK(base.machineOutput(mb) == outCap);
}

// =============================================================================
// LONG TIME-WARP: a base on-rails for a "year" (huge elapsed) cannot mint items
// beyond its storage; the cap is the hard ceiling (R2 / D-003 no-exploit).
// =============================================================================
TEST(rails_long_warp_cannot_exceed_storage) {
  const uint32_t craft = 60;     // 1 craft/second at 60 UPS
  const uint16_t input = 2000;
  const uint16_t outCap = 500;
  EntityHandle m;
  FactorySim sim = makeOneMachine(m, input, outCap, craft);

  // ~1 in-game year at 60 UPS ~= 1.89e9 ticks. Use a large warp.
  const uint64_t oneYearTicks = 1893456000ull;
  sim.Demote();
  sim.AdvanceOnRails(oneYearTicks);
  sim.Promote();

  const uint64_t produced = sim.producedCount();
  std::printf("    [warp] %llu ticks on-rails -> produced=%llu (cap=%u)\n",
              static_cast<unsigned long long>(oneYearTicks),
              static_cast<unsigned long long>(produced), outCap);
  // The output cap (500) is below the input ceiling (2000) and astronomically
  // below the time ceiling — so storage is the binding bound. Never exceeded.
  CHECK(produced == outCap);
  CHECK(sim.machineOutput(m) == outCap);
  CHECK(sim.tickIndex() == oneYearTicks);  // clock advanced exactly, no overflow
}

// =============================================================================
// DETERMINISM (NW-4): the same elapsed produces identical reconstructed state,
// and splitting the on-rails advance into chunks yields the same result as one
// big advance (rate x elapsed is associative / path-independent).
// =============================================================================
TEST(rails_advance_is_deterministic_and_chunk_invariant) {
  const uint32_t craft = 25;
  const uint16_t input = 400;
  const uint64_t M = 7777;

  // One big advance.
  EntityHandle m1;
  FactorySim a = makeOneMachine(m1, input, /*cap*/ 0, craft);
  a.Demote();
  a.AdvanceOnRails(M);
  a.Promote();

  // Same elapsed, but split into many uneven sub-advances while still on-rails.
  EntityHandle m2;
  FactorySim b = makeOneMachine(m2, input, /*cap*/ 0, craft);
  b.Demote();
  uint64_t done = 0;
  for (uint64_t step : {13ull, 1ull, 500ull, 64ull, 3000ull, 199ull}) {
    if (done + step > M) step = M - done;
    b.AdvanceOnRails(step);
    done += step;
  }
  b.AdvanceOnRails(M - done);  // finish out to exactly M
  b.Promote();

  std::printf("    [determinism] one-shot=%llu  chunked=%llu\n",
              static_cast<unsigned long long>(a.producedCount()),
              static_cast<unsigned long long>(b.producedCount()));
  CHECK(a.producedCount() == b.producedCount());
  CHECK(a.machineInput(m1) == b.machineInput(m2));
  CHECK(a.machineOutput(m1) == b.machineOutput(m2));
  CHECK(a.tickIndex() == b.tickIndex());
  CHECK(a.tickIndex() == M);

  // And it equals the continuous-active baseline (fidelity, again, here under
  // the chunked-advance path).
  EntityHandle mb;
  FactorySim base = makeOneMachine(mb, input, /*cap*/ 0, craft);
  for (uint64_t t = 0; t < M; ++t) base.step();
  CHECK(a.producedCount() == base.producedCount());
}

// =============================================================================
// MULTI-MACHINE CHUNK: a chunk of several machines on different recipes demotes
// and promotes as a unit (FS-7 chunk granularity), and the whole-chunk produced
// total matches continuous active — proving the rate model composes per machine.
// =============================================================================
TEST(rails_multi_machine_chunk_matches_active) {
  auto buildChunk = [](FactorySim& sim) {
    // 4 machines, varied recipes + input levels (some input-bound, some time-).
    struct Spec { uint16_t in; uint32_t craft; uint16_t inputCount;
                  uint16_t outputCount; };
    const Spec specs[] = {
        {1000, 30, 1, 1},   // time-bound
        {12, 10, 2, 3},     // input-bound (only 6 crafts of input)
        {1000, 15, 1, 2},   // time-bound, multi-output
        {1000, 45, 3, 1},   // time-bound, multi-input
    };
    for (const Spec& s : specs) {
      Recipe r;
      r.inputItem = 1; r.outputItem = 2;
      r.inputCount = s.inputCount; r.outputCount = s.outputCount;
      r.craftTimeTicks = s.craft; r.powerW = 0;
      EntityHandle m = sim.addMachine(r);
      sim.feedMachine(m, s.in);
    }
  };

  const uint64_t Ttotal = 1000;
  FactorySim base;
  buildChunk(base);
  for (uint64_t t = 0; t < Ttotal; ++t) base.step();
  const uint64_t pBaseline = base.producedCount();

  FactorySim sim;
  buildChunk(sim);
  for (uint64_t t = 0; t < 250; ++t) sim.step();  // active a while
  sim.Demote();                                    // whole chunk -> on-rails
  sim.AdvanceOnRails(500);
  sim.Promote();                                   // whole chunk -> active
  for (uint64_t t = 0; t < 250; ++t) sim.step();   // active again

  std::printf("    [chunk] baseline=%llu  demote/promote=%llu\n",
              static_cast<unsigned long long>(pBaseline),
              static_cast<unsigned long long>(sim.producedCount()));
  CHECK(sim.producedCount() == pBaseline);   // fidelity across the whole chunk
  CHECK(sim.producedCount() <= pBaseline);   // no dupe
  CHECK(sim.tickIndex() == Ttotal);
}
