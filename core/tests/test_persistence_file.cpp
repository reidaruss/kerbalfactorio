// =============================================================================
// test_persistence_file.cpp — Wave-1 headless tests for the atomic single-slot
// save FILE container (PS-6 / persistence-phase1.md §4.1, §4.3).
//
// persistence.h proves the seed+diff format round-trips in MEMORY. THIS suite
// proves the FILE container layered on top of it writes that buffer to a single
// slot directory SAFELY and reads it back, surviving a torn write:
//
//   1. Round-trip       — build a real save buffer (via SaveGame over a
//                         non-trivial SliceState), SaveToSlot to a fresh temp
//                         dir, LoadFromSlot, assert byte-identical (and that it
//                         re-parses through SaveGame::load to the same state).
//   2. Atomicity        — a SECOND save of DIFFERENT bytes: the new bytes load,
//      (.bak rotation)    AND the previous slot is preserved as save.bak
//                         (write-temp-then-rename keeps the last good slot).
//   3. Torn-write       — simulate a crash mid-write by leaving a stray/garbage
//      survival           save.tmp AND truncating save.ofc: LoadFromSlot still
//                         returns the last good save from save.bak, never the
//                         half-written tmp.
//   4. Guard + fallback — a truncated/short save.ofc is REJECTED by the magic/
//                         length/footer guard (not read as garbage); if a valid
//                         save.bak is present it is used instead.
//
// Uses a UNIQUE temp dir under std::filesystem::temp_directory_path(), cleaned
// up at the end of each test.
// =============================================================================
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "test_framework.h"
#include "of/persistence.h"
#include "of/persistence_file.h"
#include "of/gameplay.h"
#include "of/orbital.h"
#include "of/vec3.h"
#include "of/universe_coord.h"

using namespace of;
using namespace of::persist;
namespace fs = std::filesystem;

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

// A unique temp slot directory per test, derived from a counter so two tests
// never collide even on the same clock tick.
static fs::path makeUniqueSlotDir(const char* tag) {
  static int counter = 0;
  ++counter;
  fs::path base = fs::temp_directory_path() /
                  ("of_persist_file_test_" + std::string(tag) + "_" +
                   std::to_string(counter));
  std::error_code ec;
  fs::remove_all(base, ec);  // clean any stale leftover from a previous run
  return base;
}

static void cleanup(const fs::path& dir) {
  std::error_code ec;
  fs::remove_all(dir, ec);  // best-effort; never throws
}

// Build a non-trivial save buffer through the REAL in-memory format, so the
// container is exercised on a realistic payload (header + 5 domain records),
// not a toy blob. Returns the bytes AND the SliceState they encode.
static std::vector<uint8_t> buildSaveBuffer(persist::SliceState& outState) {
  persist::SliceState s;
  s.worldSeed = 0x0123456789ABCDEFull;
  s.tickIndex = 4242;
  s.simTime = 70.7;
  s.observer = UniverseCoord(Vec3{12.0, -34.0, 56.0}, /*frame*/ 1);
  s.observerFrame = 1;
  s.depletions.push_back(persist::DepositDepletion{0xC0FFEE, 321.0});
  s.depletions.push_back(persist::DepositDepletion{0xBEEF, 7.5});
  s.factoryProduced = 99;
  s.factorySnapshotTick = 4200;
  s.craftElements = orbital::Elements{};
  s.craftElements.a = orbital::kForgeRadiusM + 100.0e3;
  s.craftElements.e = 0.001;
  s.craftElements.mu = orbital::kForgeMu;
  s.craftMode = 1;  // OnRails
  s.craftDominantFrame = 1;
  s.inventory.push_back(gameplay::ItemStack{gameplay::items::FerriteOre, 64});
  s.inventory.push_back(gameplay::ItemStack{gameplay::items::FerritePlate, 12});
  s.avatarPos = UniverseCoord(Vec3{7.0, 8.0, 9.0}, /*frame*/ 1);
  s.avatarBody = 0;
  s.avatarFrame = 1;
  s.avatarControlMode = 0;
  s.objectiveStep = 3;
  s.objectiveDone = false;
  outState = s;
  return persist::SaveGame::save(s);
}

// =============================================================================
// 1. ROUND-TRIP — SaveToSlot a real buffer, LoadFromSlot, assert byte-identical
//    (and that the recovered bytes re-parse to the same SliceState).
// =============================================================================
TEST(file_save_then_load_roundtrips_bytes) {
  const fs::path dir = makeUniqueSlotDir("roundtrip");
  const std::string slot = dir.string();

  persist::SliceState orig;
  std::vector<uint8_t> bytes = buildSaveBuffer(orig);
  CHECK(bytes.size() > 32);  // a real multi-record save, not a toy

  // The dir does NOT exist yet -> SaveToSlot must create it.
  CHECK(!fs::exists(dir));
  CHECK(file::SaveToSlot(slot, bytes));
  CHECK(fs::exists(dir / file::kSaveName()));  // save.ofc was committed

  std::vector<uint8_t> loaded;
  CHECK(file::LoadFromSlot(slot, loaded));
  CHECK(loaded.size() == bytes.size());
  CHECK(loaded == bytes);  // byte-for-byte identical

  // ...and the recovered bytes really are a valid save: re-parse them.
  persist::SliceState back = persist::SaveGame::load(loaded);
  CHECK(back.worldSeed == orig.worldSeed);
  CHECK(back.tickIndex == orig.tickIndex);
  CHECK(back.factoryProduced == orig.factoryProduced);
  CHECK(back.depletions.size() == 2);
  CHECK(back.inventory.size() == 2);
  CHECK(back.objectiveStep == 3);

  cleanup(dir);
}

// =============================================================================
// 2. ATOMICITY (.bak rotation) — a SECOND save of DIFFERENT bytes loads the new
//    bytes AND preserves the previous slot as save.bak.
// =============================================================================
TEST(second_save_swaps_in_new_and_keeps_previous_as_bak) {
  const fs::path dir = makeUniqueSlotDir("atomic");
  const std::string slot = dir.string();

  // First save (state A).
  persist::SliceState stA;
  std::vector<uint8_t> bytesA = buildSaveBuffer(stA);
  CHECK(file::SaveToSlot(slot, bytesA));

  // Second save (state B — different bytes: bump a few fields).
  persist::SliceState stB = stA;
  stB.tickIndex = 999999;
  stB.factoryProduced = 7777;
  stB.inventory.push_back(gameplay::ItemStack{gameplay::items::FerriteOre, 5});
  std::vector<uint8_t> bytesB = persist::SaveGame::save(stB);
  CHECK(bytesB != bytesA);  // genuinely different
  CHECK(file::SaveToSlot(slot, bytesB));

  // LoadFromSlot now returns the NEW bytes (B).
  std::vector<uint8_t> loaded;
  CHECK(file::LoadFromSlot(slot, loaded));
  CHECK(loaded == bytesB);
  CHECK(loaded != bytesA);

  // The PREVIOUS slot (A) is preserved as save.bak (write-temp-then-rename
  // rotation). Read it raw, strip the container, and confirm it's A.
  const fs::path bak = dir / file::kBakName();
  CHECK(fs::exists(bak));
  std::vector<uint8_t> bakRaw, bakPayload;
  CHECK(file::detail::readFile(bak, bakRaw));
  CHECK(file::detail::decode(bakRaw, bakPayload));
  CHECK(bakPayload == bytesA);  // the .bak holds the prior good save

  cleanup(dir);
}

// =============================================================================
// 3. TORN-WRITE SURVIVAL — simulate a crash mid-write: a stray/garbage save.tmp
//    AND a truncated save.ofc. LoadFromSlot must still return the last good
//    save from save.bak — never the half-written tmp.
// =============================================================================
TEST(torn_write_recovers_last_good_from_bak) {
  const fs::path dir = makeUniqueSlotDir("torn");
  const std::string slot = dir.string();

  // Two clean saves so a good save.bak (state A) exists alongside save.ofc (B).
  persist::SliceState stA;
  std::vector<uint8_t> bytesA = buildSaveBuffer(stA);
  CHECK(file::SaveToSlot(slot, bytesA));
  persist::SliceState stB = stA;
  stB.tickIndex = 555;
  std::vector<uint8_t> bytesB = persist::SaveGame::save(stB);
  CHECK(file::SaveToSlot(slot, bytesB));

  const fs::path live = dir / file::kSaveName();
  const fs::path tmp  = dir / file::kTempName();
  const fs::path bak  = dir / file::kBakName();
  CHECK(fs::exists(bak));  // save.bak holds A

  // Simulate a crash MID-WRITE of a third save:
  //   (a) a stray, partially-written save.tmp left behind (garbage), and
  //   (b) the live save.ofc truncated to a torn fragment (header only).
  {
    std::ofstream t(tmp, std::ios::binary | std::ios::trunc);
    const char junk[] = "half-written staging garbage that never committed";
    t.write(junk, sizeof(junk));
  }
  // Truncate the live save.ofc to fewer bytes than its declared payload (a torn
  // file). Read it, lop off the tail (including the footer commit marker), and
  // rewrite the fragment.
  {
    std::vector<uint8_t> liveRaw;
    CHECK(file::detail::readFile(live, liveRaw));
    CHECK(liveRaw.size() > file::kMinContainerBytes);
    std::vector<uint8_t> torn(liveRaw.begin(),
                              liveRaw.begin() + file::kMinContainerBytes + 2);
    std::ofstream out(live, std::ios::binary | std::ios::trunc);
    out.write(reinterpret_cast<const char*>(torn.data()),
              static_cast<std::streamsize>(torn.size()));
  }

  // LoadFromSlot must reject the torn save.ofc (and ignore the stray .tmp) and
  // recover the last good save from save.bak (state A).
  std::vector<uint8_t> loaded;
  CHECK(file::LoadFromSlot(slot, loaded));
  CHECK(loaded == bytesA);          // recovered the last good save
  CHECK(loaded != bytesB);          // NOT the torn live file
  // The stray tmp was never mistaken for a save (LoadFromSlot never reads it).
  persist::SliceState recovered = persist::SaveGame::load(loaded);
  CHECK(recovered.worldSeed == stA.worldSeed);

  cleanup(dir);
}

// =============================================================================
// 4. GUARD + FALLBACK — a truncated/short save.ofc is REJECTED by the magic/
//    length/footer guard; with NO usable backup LoadFromSlot returns false,
//    and with a valid save.bak present it falls back to it.
// =============================================================================
TEST(short_save_ofc_is_rejected_and_bak_used_when_present) {
  // --- (a) a too-short / garbage save.ofc with NO backup -> load fails. -------
  {
    const fs::path dir = makeUniqueSlotDir("guard_nobak");
    const std::string slot = dir.string();
    std::error_code ec;
    fs::create_directories(dir, ec);
    // Write a save.ofc that is shorter than even the container header.
    {
      std::ofstream out(dir / file::kSaveName(), std::ios::binary | std::ios::trunc);
      const char tiny[] = {0x4F, 0x46, 0x43, 0x53};  // just "OFCS", no len/footer
      out.write(tiny, sizeof(tiny));
    }
    std::vector<uint8_t> loaded;
    CHECK(!file::LoadFromSlot(slot, loaded));  // guard fires, no .bak -> false
    cleanup(dir);
  }

  // --- (b) a truncated save.ofc WITH a valid save.bak -> falls back to .bak. --
  {
    const fs::path dir = makeUniqueSlotDir("guard_withbak");
    const std::string slot = dir.string();

    // Lay down a good save (becomes the eventual .bak) then a second good save.
    persist::SliceState stA;
    std::vector<uint8_t> bytesA = buildSaveBuffer(stA);
    CHECK(file::SaveToSlot(slot, bytesA));
    persist::SliceState stB = stA;
    stB.factoryProduced = 12321;
    std::vector<uint8_t> bytesB = persist::SaveGame::save(stB);
    CHECK(file::SaveToSlot(slot, bytesB));  // save.ofc=B, save.bak=A

    // Corrupt the LIVE save.ofc: flip the container magic so the guard rejects
    // it (a corrupt header, distinct from a length truncation).
    const fs::path live = dir / file::kSaveName();
    {
      std::vector<uint8_t> raw;
      CHECK(file::detail::readFile(live, raw));
      raw[0] ^= 0xFF;  // break the "OFCS" magic
      std::ofstream out(live, std::ios::binary | std::ios::trunc);
      out.write(reinterpret_cast<const char*>(raw.data()),
                static_cast<std::streamsize>(raw.size()));
    }

    // The guard rejects save.ofc and LoadFromSlot recovers from save.bak (=A).
    std::vector<uint8_t> loaded;
    CHECK(file::LoadFromSlot(slot, loaded));
    CHECK(loaded == bytesA);
    CHECK(loaded != bytesB);
    cleanup(dir);
  }

  // --- (c) the decode guard directly: assorted malformed buffers rejected. ---
  {
    std::vector<uint8_t> good = file::detail::encode({1, 2, 3, 4, 5});
    std::vector<uint8_t> out;
    CHECK(file::detail::decode(good, out));         // a well-formed container decodes
    CHECK(out == std::vector<uint8_t>({1, 2, 3, 4, 5}));

    std::vector<uint8_t> badMagic = good;
    badMagic[0] ^= 0xFF;
    CHECK(!file::detail::decode(badMagic, out));     // wrong magic -> rejected

    std::vector<uint8_t> truncated(good.begin(), good.end() - 1);
    CHECK(!file::detail::decode(truncated, out));    // missing a tail byte -> length guard fires

    std::vector<uint8_t> noFooter = good;
    noFooter[noFooter.size() - 1] ^= 0xFF;
    CHECK(!file::detail::decode(noFooter, out));      // footer commit marker broken -> rejected

    std::vector<uint8_t> empty;
    CHECK(!file::detail::decode(empty, out));         // empty -> rejected
  }
}
