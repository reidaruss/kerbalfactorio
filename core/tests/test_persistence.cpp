// =============================================================================
// test_persistence.cpp — Wave-0 headless tests for the persistence core.
//
// Proves the PINNED Phase-1 seed+diff save/load (docs/phase1/persistence-phase1.md)
// against the green Wave-0 cores. This is the last headless slice piece: it
// shows save -> quit -> reload round-trips the slice state WITHOUT storing the
// procedural world.
//
//   1. Round-trip      — build a NON-TRIVIAL slice state from the live cores
//                        (deplete a deposit, run a factory so produced>0, put a
//                        craft on an orbit, fill an inventory, advance the
//                        objective a few steps), save -> bytes, load into a FRESH
//                        state, assert EVERY persisted field matches.
//   2. Seed+diff (PS-7)— the save buffer does NOT contain terrain: its size is
//                        small + bounded (scales with #diffs, not world size),
//                        and the reloaded terrain regenerates bit-identically
//                        from the seed (sample a height before/after == equal).
//   3. Versioned header— the header round-trips; a wrong magic / bad version is
//      (PS-4)            REJECTED on load.
//   4. Determinism     — the same state saves to BYTE-IDENTICAL buffers.
// =============================================================================
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/persistence.h"
#include "of/gameplay.h"
#include "of/factory_sim.h"
#include "of/cubed_sphere.h"
#include "of/orbital.h"
#include "of/vec3.h"
#include "of/universe_coord.h"

using namespace of;
using namespace of::persist;

// World seed for the test scene. Drives world-gen regeneration (PS-1).
static constexpr uint64_t kTestSeed = 0xABCDEF0123456789ull;

// =============================================================================
// Scene builder — drive the GREEN cores to author a non-trivial slice state,
// exactly the loop the brief asks for. Returns the SliceState a save captures,
// plus the post-mining deposit so a test can compare remaining amounts.
// =============================================================================
struct BuiltScene {
  SliceState state;
  double depletedRemaining = 0.0;   // the deposit's remaining after mining
  gameplay::DepositId depositId = 0;
  uint16_t oreMined = 0;            // ore granted into inventory
  uint64_t factoryProduced = 0;     // factory producedCount after running
  orbital::Elements craftConic;     // the parked craft conic
};

static BuiltScene buildScene() {
  BuiltScene scene;
  SliceState& s = scene.state;

  // -- core-engine anchors: seed + a non-zero tick/time + an observer. --------
  // Run a real SimClock forward so tick/time are non-trivial.
  SimClock clock(1.0 / 60.0);
  clock.advance(5.0);  // 300 ticks of sim time
  s.worldSeed = kTestSeed;
  s.tickIndex = clock.tickIndex();
  s.simTime = clock.simTime();
  s.observer = UniverseCoord(Vec3{1234.5, -678.9, 42.0}, /*frame*/ 1);
  s.observerFrame = 1;

  // -- world-gen DIFF: deplete a deposit by actually mining it (PS-7). --------
  // A deposit regenerates its PLACEMENT from seed; only the depletion is a diff.
  gameplay::SliceRegistry reg;
  gameplay::Inventory inv(reg);
  gameplay::DepositNode node;
  node.id = 0xC0FFEE;
  node.position = UniverseCoord(Vec3{100, 200, 300}, /*Forge*/ 1);
  node.resource = gameplay::items::FerriteOre;
  node.grade = 1.0f;
  node.remainingAmount = 500.0;
  scene.depositId = node.id;
  // Mine several pulls -> grants ore into inventory + decrements remaining.
  uint16_t mined = 0;
  for (int i = 0; i < 37; ++i) {
    gameplay::MineResult mr = gameplay::mineDeposit(node, inv, /*baseRate*/ 3);
    mined = static_cast<uint16_t>(mined + mr.granted);
    if (mr.depositEmpty) break;
  }
  scene.oreMined = mined;
  scene.depletedRemaining = node.remainingAmount;
  CHECK(node.remainingAmount < 500.0);  // it really depleted
  s.depletions.push_back(DepositDepletion{node.id, node.remainingAmount});

  // -- factory-sim DIFF: run a factory so producedCount > 0. ------------------
  factory::FactorySim sim(1.0 / 60.0);
  factory::Recipe smelt;
  smelt.inputItem = gameplay::items::FerriteOre;
  smelt.inputCount = 1;
  smelt.outputItem = gameplay::items::FerritePlate;
  smelt.outputCount = 1;
  smelt.craftTimeTicks = 2;  // short so it completes within the run
  smelt.powerW = 0;          // no brownout — full speed
  factory::EntityHandle m = sim.addMachine(smelt);
  sim.feedMachine(m, 50);    // plenty of input
  for (int t = 0; t < 200; ++t) sim.step();
  CHECK(sim.producedCount() > 0);  // the factory really produced
  scene.factoryProduced = sim.producedCount();
  s.factoryProduced = sim.producedCount();
  s.factorySnapshotTick = sim.tickIndex();

  // -- physics DIFF: put the craft on an orbit, park it to a conic. -----------
  // A circular low orbit about Forge -> state -> Kepler elements (the ~10 doubles).
  const double mu = orbital::kForgeMu;
  const double r0 = orbital::kForgeRadiusM + 100.0e3;  // 100 km orbit
  const double vc = std::sqrt(mu / r0);
  orbital::StateVector st{Vec3{r0, 0, 0}, Vec3{0, vc, 0}};
  orbital::Elements el = orbital::park(st, mu, s.simTime);
  scene.craftConic = el;
  s.craftElements = el;
  s.craftMode = 1;  // OnRails
  s.craftDominantFrame = 1;  // Forge frame
  s.craftActiveOnSurface = false;

  // -- gameplay DIFF: inventory (the mined ore) + avatar + objective. ---------
  // Persist the inventory's non-empty slots.
  for (int i = 0; i < inv.slotCount(); ++i) {
    const gameplay::ItemStack& slot = inv.slot(i);
    if (!slot.empty()) s.inventory.push_back(slot);
  }
  CHECK(!s.inventory.empty());  // we mined ore into it
  s.avatarPos = UniverseCoord(Vec3{4321.0, 8765.0, -1111.0}, /*Forge*/ 1);
  s.avatarBody = 0;       // Forge
  s.avatarFrame = 1;
  s.avatarControlMode = 0;  // on-foot

  // Advance the objective FSM a few steps (mine -> smelt -> assemble facts).
  gameplay::ObjectiveTracker tracker;
  gameplay::ObjectiveContext ctx;
  ctx.hasFerriteOre = true;     // step 1 predicate
  tracker.tick(ctx);            // -> SmeltPlate
  ctx.hasFerritePlate = true;   // step 2 predicate
  tracker.tick(ctx);            // -> AssembleFrame
  CHECK(tracker.stepIndex() == 3);  // advanced two steps
  s.objectiveStep = tracker.stepIndex();
  s.objectiveDone = tracker.complete();

  return scene;
}

// =============================================================================
// 1. ROUND-TRIP — save a non-trivial state, load into a FRESH state, assert
//    every persisted field matches (the M2.5 save->reload guarantee).
// =============================================================================
TEST(roundtrip_restores_every_persisted_field) {
  BuiltScene scene = buildScene();
  const SliceState& orig = scene.state;

  std::vector<uint8_t> bytes = SaveGame::save(orig);
  SliceState loaded = SaveGame::load(bytes);

  // -- core-engine anchors --
  CHECK(loaded.worldSeed == orig.worldSeed);
  CHECK(loaded.tickIndex == orig.tickIndex);
  CHECK_NEAR(loaded.simTime, orig.simTime, 0.0);
  CHECK_NEAR(loaded.observer.pos.x, orig.observer.pos.x, 0.0);
  CHECK_NEAR(loaded.observer.pos.y, orig.observer.pos.y, 0.0);
  CHECK_NEAR(loaded.observer.pos.z, orig.observer.pos.z, 0.0);
  CHECK(loaded.observer.frame == orig.observer.frame);
  CHECK(loaded.observerFrame == orig.observerFrame);

  // -- world-gen deposit depletion (the only world-gen diff, PS-7) --
  CHECK(loaded.depletions.size() == orig.depletions.size());
  CHECK(loaded.depletions.size() == 1);
  CHECK(loaded.depletions[0].depositId == scene.depositId);
  CHECK_NEAR(loaded.depletions[0].remaining, scene.depletedRemaining, 0.0);

  // -- physics craft conic (the ~10 doubles) + mode + frame --
  CHECK_NEAR(loaded.craftElements.a, orig.craftElements.a, 0.0);
  CHECK_NEAR(loaded.craftElements.e, orig.craftElements.e, 0.0);
  CHECK_NEAR(loaded.craftElements.i, orig.craftElements.i, 0.0);
  CHECK_NEAR(loaded.craftElements.lan, orig.craftElements.lan, 0.0);
  CHECK_NEAR(loaded.craftElements.argp, orig.craftElements.argp, 0.0);
  CHECK_NEAR(loaded.craftElements.nu, orig.craftElements.nu, 0.0);
  CHECK_NEAR(loaded.craftElements.m0, orig.craftElements.m0, 0.0);
  CHECK_NEAR(loaded.craftElements.epoch, orig.craftElements.epoch, 0.0);
  CHECK_NEAR(loaded.craftElements.mu, orig.craftElements.mu, 0.0);
  CHECK(loaded.craftMode == orig.craftMode);
  CHECK(loaded.craftDominantFrame == orig.craftDominantFrame);

  // -- factory-sim produced count + snapshot tick (PS-8 on-rails snapshot) --
  CHECK(loaded.factoryProduced == orig.factoryProduced);
  CHECK(loaded.factoryProduced == scene.factoryProduced);
  CHECK(loaded.factorySnapshotTick == orig.factorySnapshotTick);

  // -- gameplay inventory contents (exact, slot-for-slot) --
  CHECK(loaded.inventory.size() == orig.inventory.size());
  uint32_t loadedOre = 0, origOre = 0;
  for (const gameplay::ItemStack& st : loaded.inventory)
    if (st.item == gameplay::items::FerriteOre) loadedOre += st.count;
  for (const gameplay::ItemStack& st : orig.inventory)
    if (st.item == gameplay::items::FerriteOre) origOre += st.count;
  CHECK(loadedOre == origOre);
  CHECK(loadedOre == scene.oreMined);

  // -- gameplay avatar position / body / frame / mode --
  CHECK_NEAR(loaded.avatarPos.pos.x, orig.avatarPos.pos.x, 0.0);
  CHECK_NEAR(loaded.avatarPos.pos.y, orig.avatarPos.pos.y, 0.0);
  CHECK_NEAR(loaded.avatarPos.pos.z, orig.avatarPos.pos.z, 0.0);
  CHECK(loaded.avatarPos.frame == orig.avatarPos.frame);
  CHECK(loaded.avatarBody == orig.avatarBody);
  CHECK(loaded.avatarFrame == orig.avatarFrame);
  CHECK(loaded.avatarControlMode == orig.avatarControlMode);

  // -- gameplay objective step --
  CHECK(loaded.objectiveStep == orig.objectiveStep);
  CHECK(loaded.objectiveStep == 3);
  CHECK(loaded.objectiveDone == orig.objectiveDone);
}

// =============================================================================
// 2. SEED+DIFF (PS-7) — the buffer does NOT store terrain; terrain regenerates
//    from the seed on reload (sample a height before vs after == identical).
// =============================================================================
TEST(seed_plus_diff_does_not_store_terrain) {
  BuiltScene scene = buildScene();
  std::vector<uint8_t> bytes = SaveGame::save(scene.state);

  // (a) The save buffer is SMALL and BOUNDED — it scales with #diffs, not world
  // size. A whole planet+moon heightfield is megabytes; a slice save is a few
  // hundred bytes. We assert a tight upper bound that NO terrain could fit in.
  std::printf("    [PS-7] save buffer = %zu bytes for the test scene\n",
              bytes.size());
  CHECK(bytes.size() < 512);  // far smaller than any stored terrain

  // (b) The buffer size scales with the number of diffs, NOT the world. Add a
  // second deposit-depletion diff and the buffer grows by only a few bytes;
  // the (megabyte-scale) terrain is never present either way.
  SliceState more = scene.state;
  more.depletions.push_back(DepositDepletion{0xBEEF, 123.0});
  std::vector<uint8_t> bytes2 = SaveGame::save(more);
  CHECK(bytes2.size() > bytes.size());          // one more diff -> a bit bigger
  CHECK(bytes2.size() - bytes.size() < 32);     // ...by only a varint+double, not a chunk

  // (c) Terrain REGENERATES from the seed (PS-1). The save stored ONLY the seed
  // (in the header), never heightfield bytes. Reload the seed and regenerate the
  // same body -> sampling a height is bit-identical to the pre-save world.
  SliceState loaded = SaveGame::load(bytes);
  CHECK(loaded.worldSeed == kTestSeed);

  worldgen::BodyParams forgeBefore = worldgen::makeForge(kTestSeed);
  worldgen::BodyParams forgeAfter = worldgen::makeForge(loaded.worldSeed);
  // Sample several geo coords; each must match to the BIT (determinism, WV1).
  const double coords[][2] = {{0.3, 0.7}, {-1.1, 2.4}, {0.9, -2.9}, {0.0, 0.0}};
  for (auto& c : coords) {
    const double hBefore = worldgen::SampleTerrainHeight(forgeBefore, c[0], c[1]);
    const double hAfter = worldgen::SampleTerrainHeight(forgeAfter, c[0], c[1]);
    CHECK_NEAR(hBefore, hAfter, 0.0);  // bit-identical regen from the seed
  }
  // And the moon regenerates too.
  worldgen::BodyParams cinderAfter = worldgen::makeCinder(loaded.worldSeed);
  worldgen::BodyParams cinderBefore = worldgen::makeCinder(kTestSeed);
  CHECK_NEAR(worldgen::SampleTerrainHeight(cinderBefore, 0.5, 0.5),
             worldgen::SampleTerrainHeight(cinderAfter, 0.5, 0.5), 0.0);
}

// =============================================================================
// 3. VERSIONED HEADER (PS-4) — the header round-trips; a wrong magic / bad
//    version is rejected on load (refuse-to-load, migration deferred).
// =============================================================================
TEST(versioned_header_roundtrips_and_rejects_bad_saves) {
  BuiltScene scene = buildScene();
  std::vector<uint8_t> bytes = SaveGame::save(scene.state);

  // (a) The header round-trips: magic, formatVersion, seed, tick, time, and the
  // full per-domain schema table.
  SaveHeader h = SaveGame::readHeader(bytes);
  CHECK(h.magic == kSaveMagic);
  CHECK(h.formatVersion == kFormatVersion);
  CHECK(h.minReaderVersion == kMinReaderVersion);
  CHECK(h.worldSeed == kTestSeed);
  CHECK(h.savedTickIndex == scene.state.tickIndex);
  CHECK_NEAR(h.savedSimTime, scene.state.simTime, 0.0);
  CHECK(h.domainSchema[static_cast<int>(DomainId::CoreEngine)] == kSchemaCoreEngine);
  CHECK(h.domainSchema[static_cast<int>(DomainId::WorldGen)] == kSchemaWorldGen);
  CHECK(h.domainSchema[static_cast<int>(DomainId::Physics)] == kSchemaPhysics);
  CHECK(h.domainSchema[static_cast<int>(DomainId::FactorySim)] == kSchemaFactorySim);
  CHECK(h.domainSchema[static_cast<int>(DomainId::Gameplay)] == kSchemaGameplay);

  // (b) A WRONG MAGIC is rejected (corrupt the first byte of "OFSV").
  {
    std::vector<uint8_t> bad = bytes;
    bad[0] ^= 0xFF;
    bool threw = false;
    try {
      SaveGame::load(bad);
    } catch (const SaveError&) {
      threw = true;
    }
    CHECK(threw);  // not an Orbital Foundry save -> refuse
  }

  // (c) A BAD (too-new) formatVersion is rejected. formatVersion is the u16 at
  // byte offset 4 (after the u32 magic). Bump it past the build's version.
  {
    std::vector<uint8_t> bad = bytes;
    bad[4] = 0xFF;  // formatVersion low byte -> 255, > kFormatVersion
    bad[5] = 0xFF;
    bool threw = false;
    try {
      SaveGame::load(bad);
    } catch (const SaveError&) {
      threw = true;
    }
    CHECK(threw);  // newer formatVersion -> no forward load
  }

  // (d) A TRUNCATED buffer is rejected (header demands more bytes than exist).
  {
    std::vector<uint8_t> bad(bytes.begin(), bytes.begin() + 6);  // cut mid-header
    bool threw = false;
    try {
      SaveGame::load(bad);
    } catch (const SaveError&) {
      threw = true;
    }
    CHECK(threw);
  }

  // (e) A VALID save still loads cleanly (no false-positive rejection).
  {
    bool threw = false;
    try {
      SliceState ok = SaveGame::load(bytes);
      CHECK(ok.worldSeed == kTestSeed);
    } catch (const SaveError&) {
      threw = true;
    }
    CHECK(!threw);
  }
}

// =============================================================================
// 4. DETERMINISM — the SAME state saves to BYTE-IDENTICAL buffers (a save is a
//    pure function of the state; no field order / padding nondeterminism).
// =============================================================================
TEST(save_is_byte_deterministic) {
  BuiltScene a = buildScene();
  BuiltScene b = buildScene();  // independently rebuilt -> must be identical

  std::vector<uint8_t> bytesA = SaveGame::save(a.state);
  std::vector<uint8_t> bytesB = SaveGame::save(b.state);

  CHECK(bytesA.size() == bytesB.size());
  CHECK(bytesA == bytesB);  // byte-for-byte identical

  // Saving the SAME state object twice is also identical.
  std::vector<uint8_t> again = SaveGame::save(a.state);
  CHECK(again == bytesA);

  // And a save->load->save is a fixed point (re-serializing the loaded state
  // reproduces the exact bytes — no lossy round-trip).
  SliceState loaded = SaveGame::load(bytesA);
  std::vector<uint8_t> reSaved = SaveGame::save(loaded);
  CHECK(reSaved == bytesA);
}
