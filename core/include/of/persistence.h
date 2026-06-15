#pragma once
// =============================================================================
// persistence.h — Wave-0 headless persistence core (seed+diff save/load).
//
// Implements the PINNED Phase-1 persistence design
// (docs/phase1/persistence-phase1.md). This is the LAST headless slice piece:
// it proves save -> quit -> reload round-trips the slice state WITHOUT ever
// storing the procedural world. The universe is a pure function of a seed
// (PS-1); we serialize the seed + ONLY the player-authored diffs, and on load
// we regenerate-from-seed then apply the diffs.
//
// What this core owns (and only this — persistence.md §2 non-goals):
//   * FSaveWriter / FSaveReader — little-endian byte cursors over a
//     std::vector<uint8_t> (POD put/get + LEB128 varints).             (§2 cursors)
//   * A versioned container header — magic + formatVersion + minReader +
//     worldSeed + savedTick/Time + a per-domain schemaVersion table.   (PS-4 / §5.3)
//   * A per-domain serialize/deserialize ("IPersistable"-style) over each
//     domain's OWN pinned state — persistence never interprets the bytes
//     (the §2 boundary): core-engine, world-gen, physics, factory-sim, gameplay.
//   * SaveGame — bundles the domains in the LOAD ORDER (§4.5) and does
//     save(state) -> bytes and load(bytes) -> state (regenerate-from-seed via
//     world-gen, then apply diffs).
//
// Seed+diff (PS-7): terrain is NOT a diff (node mining only, no voxel deform —
// D-005 / WG-2). The save buffer carries the seed + deposit DEPLETION +
// factory/craft/player diffs ONLY; on load, terrain + deposit PLACEMENT
// regenerate bit-identically from (worldSeed) via of::worldgen.
//
// Header-only. Consumes ONLY the green Wave-0 cores: of::worldgen (regen),
// of::orbital (craft conic), of::factory::FactorySim (factory snapshot),
// of::gameplay (inventory / deposits / objective), of::Vec3 / of::UniverseCoord
// / of::SimClock. No UE, no rendering, no disk I/O (bytes in / bytes out — the
// atomic-file container is a Phase-1 §4.3 concern layered ABOVE this in-memory
// format; the format is what we prove here).
// =============================================================================
#include <cstdint>
#include <cstring>
#include <vector>
#include <string>
#include <stdexcept>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/orbital.h"
#include "of/cubed_sphere.h"
#include "of/factory_sim.h"
#include "of/gameplay.h"

namespace of {
namespace persist {

// =============================================================================
// §0 — Format constants (PS-4 / persistence-phase1.md §5.3).
// =============================================================================

// Container envelope magic "OFSV" (Orbital Foundry SaVe), little-endian u32.
static constexpr uint32_t kSaveMagic = 0x5653464Fu;  // 'O''F''S''V' LE

// Container/layout version. The whole Phase-1 scheme = 1 (PS-4).
static constexpr uint16_t kFormatVersion = 1;

// Refuse-to-load floor: a save can demand a minimum reader build. = 1 here.
static constexpr uint16_t kMinReaderVersion = 1;

// Stable per-domain id enum (persistence-phase1.md §2: DomainId). The on-disk
// load order is CoreEngine -> WorldGen -> Physics -> FactorySim -> Gameplay
// (§4.5), but the id values are stable identifiers, NOT the order.
enum class DomainId : uint8_t {
  CoreEngine = 0,
  WorldGen = 1,
  Physics = 2,
  FactorySim = 3,
  Gameplay = 4,
};
static constexpr int kDomainCount = 5;

// Per-domain payload schema versions (PS-4, two-level versioning). Each domain
// bumps its OWN number independently of the container formatVersion.
static constexpr uint16_t kSchemaCoreEngine = 1;
static constexpr uint16_t kSchemaWorldGen = 1;
static constexpr uint16_t kSchemaPhysics = 1;
static constexpr uint16_t kSchemaFactorySim = 1;
// Gameplay schema = 2 (GAP-4): added the unlocked-tech id list to the gameplay
// record. Phase-1 has no migration (readAndValidate requires an exact match), so
// the bump simply marks the new field's format; in-process round-trips are
// unaffected. (Was 1 before the research-unlock persist field.)
static constexpr uint16_t kSchemaGameplay = 2;

// Thrown by SaveReader / SaveGame::load on a malformed or rejected buffer
// (wrong magic, unsupported version, truncation). Phase-1 policy: refuse to
// load (no migration machinery yet — PS-4 / §5.3).
struct SaveError : std::runtime_error {
  explicit SaveError(const std::string& w) : std::runtime_error(w) {}
};

// =============================================================================
// §1 — FSaveWriter / FSaveReader: little-endian byte cursors (§2).
//
// Compact binary, little-endian, with LEB128 varints for counts/ids. POD put/get
// for the fixed-width primitives. Persistence hands these to each domain; the
// domain decides its own field order/packing (§2 boundary).
// =============================================================================

class SaveWriter {
 public:
  // ---- fixed-width little-endian primitives --------------------------------
  void u8(uint8_t v) { buf_.push_back(v); }

  void u16(uint16_t v) {
    buf_.push_back(static_cast<uint8_t>(v));
    buf_.push_back(static_cast<uint8_t>(v >> 8));
  }

  void u32(uint32_t v) {
    for (int i = 0; i < 4; ++i) buf_.push_back(static_cast<uint8_t>(v >> (8 * i)));
  }

  void u64(uint64_t v) {
    for (int i = 0; i < 8; ++i) buf_.push_back(static_cast<uint8_t>(v >> (8 * i)));
  }

  void i32(int32_t v) { u32(static_cast<uint32_t>(v)); }

  // IEEE-754 double via exact bit reinterpret (no precision loss — matches
  // world-gen's bitsOf determinism substrate).
  void f64(double d) {
    uint64_t bits;
    std::memcpy(&bits, &d, sizeof(bits));
    u64(bits);
  }

  // ---- LEB128 unsigned varint (counts / ids) -------------------------------
  void varint(uint64_t v) {
    while (v >= 0x80) {
      buf_.push_back(static_cast<uint8_t>(v) | 0x80);
      v >>= 7;
    }
    buf_.push_back(static_cast<uint8_t>(v));
  }

  // Length-prefixed opaque blob (a domain payload framed for skip-ahead, §5.1).
  void blob(const std::vector<uint8_t>& bytes) {
    varint(bytes.size());
    buf_.insert(buf_.end(), bytes.begin(), bytes.end());
  }

  // ---- composite helpers for the pinned shared types -----------------------
  void vec3(const Vec3& v) { f64(v.x); f64(v.y); f64(v.z); }
  void coord(const UniverseCoord& c) { vec3(c.pos); u32(c.frame); }

  size_t size() const { return buf_.size(); }
  const std::vector<uint8_t>& bytes() const { return buf_; }
  std::vector<uint8_t> take() { return std::move(buf_); }

 private:
  std::vector<uint8_t> buf_;
};

class SaveReader {
 public:
  explicit SaveReader(const std::vector<uint8_t>& bytes)
      : buf_(bytes.data()), n_(bytes.size()) {}
  SaveReader(const uint8_t* data, size_t n) : buf_(data), n_(n) {}

  // ---- fixed-width little-endian primitives --------------------------------
  uint8_t u8() {
    need(1);
    return buf_[pos_++];
  }

  uint16_t u16() {
    need(2);
    uint16_t v = static_cast<uint16_t>(buf_[pos_]) |
                 (static_cast<uint16_t>(buf_[pos_ + 1]) << 8);
    pos_ += 2;
    return v;
  }

  uint32_t u32() {
    need(4);
    uint32_t v = 0;
    for (int i = 0; i < 4; ++i) v |= static_cast<uint32_t>(buf_[pos_ + i]) << (8 * i);
    pos_ += 4;
    return v;
  }

  uint64_t u64() {
    need(8);
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(buf_[pos_ + i]) << (8 * i);
    pos_ += 8;
    return v;
  }

  int32_t i32() { return static_cast<int32_t>(u32()); }

  double f64() {
    uint64_t bits = u64();
    double d;
    std::memcpy(&d, &bits, sizeof(d));
    return d;
  }

  uint64_t varint() {
    uint64_t v = 0;
    int shift = 0;
    for (;;) {
      uint8_t b = u8();
      v |= static_cast<uint64_t>(b & 0x7F) << shift;
      if ((b & 0x80) == 0) break;
      shift += 7;
      if (shift > 63) throw SaveError("varint too long");
    }
    return v;
  }

  std::vector<uint8_t> blob() {
    uint64_t len = varint();
    need(len);
    std::vector<uint8_t> out(buf_ + pos_, buf_ + pos_ + len);
    pos_ += len;
    return out;
  }

  // Skip exactly `len` bytes (the §5.1 forward-compat lever: skip a record a
  // reader can't interpret). Used by the version-mismatch path.
  void skip(uint64_t len) {
    need(len);
    pos_ += len;
  }

  // ---- composite helpers ---------------------------------------------------
  Vec3 vec3() {
    Vec3 v;
    v.x = f64();
    v.y = f64();
    v.z = f64();
    return v;
  }
  UniverseCoord coord() {
    Vec3 p = vec3();
    FrameId f = u32();
    return UniverseCoord(p, f);
  }

  size_t pos() const { return pos_; }
  size_t remaining() const { return n_ - pos_; }
  bool atEnd() const { return pos_ >= n_; }

 private:
  void need(uint64_t k) {
    if (pos_ + k > n_) throw SaveError("save buffer truncated");
  }
  const uint8_t* buf_;
  size_t n_;
  size_t pos_ = 0;
};

// =============================================================================
// §2 — Per-domain slice state (the pinned types each domain serializes).
//
// Persistence consumes each domain's OWN state through these light value
// structs. They are NOT new game state — they are the exact fields the pinned
// Phase-1 design (§2.1) lists for each IPersistable, expressed in the green
// cores' own types so the two never drift.
// =============================================================================

// --- world-gen diff: deposit depletion ONLY (PS-7 / §2.1). -------------------
// Terrain + deposit PLACEMENT regenerate from seed; only what the player mined
// out is a diff: (depositId, remaining)[]. We reuse gameplay::DepositNode
// (which mirrors world-gen's FDepositNode consumable shape, C-1) verbatim.
struct DepositDepletion {
  gameplay::DepositId depositId = gameplay::kNoDeposit;
  double remaining = 0.0;
};

// --- the whole slice state a save round-trips. -------------------------------
// One value object that bundles every domain's persistable state. SaveGame
// serializes/deserializes THIS. It mirrors what SimWorld holds, but is a plain
// data aggregate so the test (and a future SimWorld adapter) can fill it from
// the live cores without persistence reaching into private sim internals.
struct SliceState {
  // -- core-engine (GLOBAL): regeneration anchors (§2.1). --
  uint64_t worldSeed = 0;
  uint64_t tickIndex = 0;
  double simTime = 0.0;
  UniverseCoord observer;  // active observer position + frame (the vessel)
  FrameId observerFrame = kRootFrame;

  // -- world-gen (CHUNK): deposit depletion only (PS-7). --
  // Keyed per region in the file format (§5.1); for the slice we carry the flat
  // list and the chunk key each belongs to is derived from its position. In the
  // headless harness we store them in one global depletion record (the slice's
  // touched-deposit set is tiny — §1.3).
  std::vector<DepositDepletion> depletions;

  // -- physics (GLOBAL): the craft conic + mode + frame (§2.1). --
  orbital::Elements craftElements;
  uint8_t craftMode = 0;          // 0 = Active, 1 = OnRails (VesselMode)
  FrameId craftDominantFrame = kRootFrame;
  bool craftActiveOnSurface = false;  // if set, also persist live r,v
  orbital::StateVector craftState;    // live (r,v) when active-on-ground (§2.1)

  // -- factory-sim (CHUNK): on-rails snapshot — produced count + tick (§2.1, PS-8). --
  // The on-rails factory persists as its compact rate/snapshot proxy, not per
  // entity (FS-4 / PS-8). At slice scale we capture the monotonic producedCount
  // and the snapshot tick; on load factory-sim resumes from this proxy and its
  // existing promote path reconstructs per-entity buffers on approach (§4.4).
  uint64_t factoryProduced = 0;
  uint64_t factorySnapshotTick = 0;

  // -- gameplay (GLOBAL): inventory + avatar + objective (§2.1). --
  std::vector<gameplay::ItemStack> inventory;  // non-empty slots only
  UniverseCoord avatarPos;
  uint8_t avatarBody = 0;          // body id (0 = Forge, 1 = Cinder)
  FrameId avatarFrame = kRootFrame;
  uint8_t avatarControlMode = 0;   // 0 = on-foot, 1 = in-craft
  uint8_t objectiveStep = 1;       // ObjectiveStep index (1..7)
  bool objectiveDone = false;

  // -- research (GLOBAL): the unlocked-tech set (GAP-4). --
  // The list of unlocked TechId (research.h's gameplay::TechId, an opaque uint16
  // — persistence stores it as a bare id list, the C-3 "cross-ref by opaque id"
  // discipline, without depending on research.h). Research unlocks are monotonic
  // + deterministic, BUT re-deriving them on load means replaying the whole spend
  // sequence; persisting the set lets unlocks be RESTORED directly so they survive
  // save→reload without re-running tryResearch (the §2.1 FGameplayPersistState
  // research-state field the slice deferred). Empty = nothing researched yet.
  std::vector<uint16_t> unlockedTechs;
};

// =============================================================================
// §3 — Versioned container header (PS-4 / §5.3).
//
// The top-level envelope. Written FIRST in the buffer (commit record in the
// file container; here it is the leading record). Carries every number a future
// migrator needs (per-domain versions) without a format redesign.
// =============================================================================
struct SaveHeader {
  uint32_t magic = kSaveMagic;
  uint16_t formatVersion = kFormatVersion;
  uint16_t minReaderVersion = kMinReaderVersion;
  uint64_t worldSeed = 0;
  uint64_t savedTickIndex = 0;
  double savedSimTime = 0.0;
  // per-domain schema versions, indexed by DomainId.
  uint16_t domainSchema[kDomainCount] = {kSchemaCoreEngine, kSchemaWorldGen,
                                         kSchemaPhysics, kSchemaFactorySim,
                                         kSchemaGameplay};

  void write(SaveWriter& w) const {
    w.u32(magic);
    w.u16(formatVersion);
    w.u16(minReaderVersion);
    w.u64(worldSeed);
    w.u64(savedTickIndex);
    w.f64(savedSimTime);
    w.u8(static_cast<uint8_t>(kDomainCount));
    for (int d = 0; d < kDomainCount; ++d) {
      w.u8(static_cast<uint8_t>(d));
      w.u16(domainSchema[d]);
    }
  }

  // Read + VALIDATE (PS-4 / §5.3 Phase-1 policy: must match the running build,
  // else refuse — migration deferred). Throws SaveError on a rejected header.
  static SaveHeader readAndValidate(SaveReader& r) {
    SaveHeader h;
    h.magic = r.u32();
    if (h.magic != kSaveMagic)
      throw SaveError("bad save magic (not an Orbital Foundry save)");
    h.formatVersion = r.u16();
    h.minReaderVersion = r.u16();
    // Refuse a save newer than this build can read (no forward load, §4.5).
    if (h.formatVersion > kFormatVersion)
      throw SaveError("save formatVersion is newer than this build");
    // Refuse a save that demands a newer reader than we are.
    if (h.minReaderVersion > kFormatVersion)
      throw SaveError("save requires a newer reader build");
    // Phase-1: container version must match exactly (migration deferred).
    if (h.formatVersion != kFormatVersion)
      throw SaveError("save formatVersion mismatch (migration not implemented)");
    h.worldSeed = r.u64();
    h.savedTickIndex = r.u64();
    h.savedSimTime = r.f64();
    const uint8_t nDomains = r.u8();
    if (nDomains != kDomainCount)
      throw SaveError("save domain table size mismatch");
    for (int k = 0; k < nDomains; ++k) {
      const uint8_t id = r.u8();
      const uint16_t ver = r.u16();
      if (id >= kDomainCount) throw SaveError("save has unknown domain id");
      h.domainSchema[id] = ver;
      // Phase-1: per-domain schema must match (PS-4 — no migration yet).
      static const uint16_t expected[kDomainCount] = {
          kSchemaCoreEngine, kSchemaWorldGen, kSchemaPhysics, kSchemaFactorySim,
          kSchemaGameplay};
      if (ver != expected[id])
        throw SaveError("save per-domain schemaVersion mismatch");
    }
    return h;
  }
};

// =============================================================================
// §4 — Per-domain serialize / deserialize (the IPersistable bodies, §2).
//
// Each function writes/reads EXACTLY one domain's diffs over its OWN state, into
// a length-prefixed, domain-tagged, version-stamped record (§5.1). Persistence
// frames the record; the domain owns the bytes inside. A reader that can't
// interpret a record skips it by its payloadLen (the §5.1 forward-compat lever).
// =============================================================================

namespace domain {

// ---- core-engine (GLOBAL): seed-anchor + observer + time (§2.1). ------------
inline void saveCoreEngine(const SliceState& s, SaveWriter& out) {
  out.u64(s.worldSeed);
  out.u64(s.tickIndex);
  out.f64(s.simTime);
  out.coord(s.observer);
  out.u32(s.observerFrame);
}
inline void loadCoreEngine(SliceState& s, SaveReader& in) {
  s.worldSeed = in.u64();
  s.tickIndex = in.u64();
  s.simTime = in.f64();
  s.observer = in.coord();
  s.observerFrame = in.u32();
}

// ---- world-gen (CHUNK): deposit depletion ONLY (PS-7 / §2.1). ---------------
inline void saveWorldGen(const SliceState& s, SaveWriter& out) {
  out.varint(s.depletions.size());
  for (const DepositDepletion& d : s.depletions) {
    out.varint(d.depositId);
    out.f64(d.remaining);
  }
}
inline void loadWorldGen(SliceState& s, SaveReader& in) {
  const uint64_t n = in.varint();
  s.depletions.clear();
  s.depletions.reserve(n);
  for (uint64_t i = 0; i < n; ++i) {
    DepositDepletion d;
    d.depositId = static_cast<gameplay::DepositId>(in.varint());
    d.remaining = in.f64();
    s.depletions.push_back(d);
  }
}

// ---- physics (GLOBAL): craft conic + mode + frame (§2.1). -------------------
inline void savePhysics(const SliceState& s, SaveWriter& out) {
  const orbital::Elements& e = s.craftElements;
  out.f64(e.a);
  out.f64(e.e);
  out.f64(e.i);
  out.f64(e.lan);
  out.f64(e.argp);
  out.f64(e.nu);
  out.f64(e.m0);
  out.f64(e.epoch);
  out.f64(e.mu);
  out.u8(s.craftMode);
  out.u32(s.craftDominantFrame);
  out.u8(s.craftActiveOnSurface ? 1 : 0);
  if (s.craftActiveOnSurface) {
    out.vec3(s.craftState.r);
    out.vec3(s.craftState.v);
  }
}
inline void loadPhysics(SliceState& s, SaveReader& in) {
  orbital::Elements e;
  e.a = in.f64();
  e.e = in.f64();
  e.i = in.f64();
  e.lan = in.f64();
  e.argp = in.f64();
  e.nu = in.f64();
  e.m0 = in.f64();
  e.epoch = in.f64();
  e.mu = in.f64();
  s.craftElements = e;
  s.craftMode = in.u8();
  s.craftDominantFrame = in.u32();
  s.craftActiveOnSurface = (in.u8() != 0);
  if (s.craftActiveOnSurface) {
    s.craftState.r = in.vec3();
    s.craftState.v = in.vec3();
  } else {
    s.craftState = orbital::StateVector{};
  }
}

// ---- factory-sim (CHUNK): on-rails snapshot — produced + tick (§2.1, PS-8). -
inline void saveFactorySim(const SliceState& s, SaveWriter& out) {
  out.u64(s.factoryProduced);
  out.u64(s.factorySnapshotTick);
}
inline void loadFactorySim(SliceState& s, SaveReader& in) {
  s.factoryProduced = in.u64();
  s.factorySnapshotTick = in.u64();
}

// ---- gameplay (GLOBAL): inventory + avatar + objective (§2.1). --------------
inline void saveGameplay(const SliceState& s, SaveWriter& out) {
  out.varint(s.inventory.size());
  for (const gameplay::ItemStack& st : s.inventory) {
    out.u16(st.item);
    out.u16(st.count);
  }
  out.coord(s.avatarPos);
  out.u8(s.avatarBody);
  out.u32(s.avatarFrame);
  out.u8(s.avatarControlMode);
  out.u8(s.objectiveStep);
  out.u8(s.objectiveDone ? 1 : 0);
  // research unlock set (GAP-4): a varint count + each unlocked TechId (u16).
  out.varint(s.unlockedTechs.size());
  for (uint16_t t : s.unlockedTechs) out.u16(t);
}
inline void loadGameplay(SliceState& s, SaveReader& in) {
  const uint64_t n = in.varint();
  s.inventory.clear();
  s.inventory.reserve(n);
  for (uint64_t i = 0; i < n; ++i) {
    gameplay::ItemStack st;
    st.item = in.u16();
    st.count = in.u16();
    s.inventory.push_back(st);
  }
  s.avatarPos = in.coord();
  s.avatarBody = in.u8();
  s.avatarFrame = in.u32();
  s.avatarControlMode = in.u8();
  s.objectiveStep = in.u8();
  s.objectiveDone = (in.u8() != 0);
  // research unlock set (GAP-4): restored directly (NOT re-derived from science).
  const uint64_t nTechs = in.varint();
  s.unlockedTechs.clear();
  s.unlockedTechs.reserve(nTechs);
  for (uint64_t i = 0; i < nTechs; ++i) s.unlockedTechs.push_back(in.u16());
}

}  // namespace domain

// =============================================================================
// §5 — SaveGame: bundle the domains in load order; save(state)->bytes,
//      load(bytes)->state (regenerate-from-seed, then apply diffs).  (§4)
//
// The buffer layout (one in-memory container; the on-disk file split into
// header.ofd/meta.ofd/chunks/*.ofc is a §4.1 layering above this format):
//
//   [SaveHeader]                                  envelope (PS-4) — leading record
//   repeat kDomainCount, in LOAD ORDER (§4.5):
//     [u8 domainId][u16 schemaVersion][varint payloadLen][payload bytes]
//
// payloadLen length-prefixes every domain record so an unreadable record is
// SKIPPED, not fatal (the §5.1 forward-compat lever). On save we emit the
// domains in the §4.5 load order: CoreEngine, WorldGen, Physics, FactorySim,
// Gameplay. On load we read header first (validates), then each record in that
// order, dispatching by domainId.
// =============================================================================
class SaveGame {
 public:
  // ---- save(state) -> bytes ------------------------------------------------
  static std::vector<uint8_t> save(const SliceState& state) {
    SaveWriter w;

    // 1) header (envelope, written first — PS-4).
    SaveHeader h;
    h.worldSeed = state.worldSeed;
    h.savedTickIndex = state.tickIndex;
    h.savedSimTime = state.simTime;
    h.write(w);

    // 2) the five domain records, in the §4.5 LOAD ORDER.
    writeRecord(w, DomainId::CoreEngine, kSchemaCoreEngine,
                [&](SaveWriter& o) { domain::saveCoreEngine(state, o); });
    writeRecord(w, DomainId::WorldGen, kSchemaWorldGen,
                [&](SaveWriter& o) { domain::saveWorldGen(state, o); });
    writeRecord(w, DomainId::Physics, kSchemaPhysics,
                [&](SaveWriter& o) { domain::savePhysics(state, o); });
    writeRecord(w, DomainId::FactorySim, kSchemaFactorySim,
                [&](SaveWriter& o) { domain::saveFactorySim(state, o); });
    writeRecord(w, DomainId::Gameplay, kSchemaGameplay,
                [&](SaveWriter& o) { domain::saveGameplay(state, o); });

    return w.take();
  }

  // ---- load(bytes) -> state ------------------------------------------------
  // Regenerate-then-patch (§4.5): the header re-seeds the universe (the test's
  // world-gen baseline is regenerated FROM state.worldSeed — terrain is never in
  // the buffer, PS-7), then each domain record applies its diffs in load order.
  static SliceState load(const std::vector<uint8_t>& bytes) {
    SaveReader r(bytes);

    // 1) read + validate the envelope (PS-4). Throws SaveError on a bad header.
    SaveHeader h = SaveHeader::readAndValidate(r);

    SliceState s;
    s.worldSeed = h.worldSeed;
    s.tickIndex = h.savedTickIndex;
    s.simTime = h.savedSimTime;

    // 2) read every domain record in order, dispatching by id. payloadLen lets
    //    us skip a record this build can't interpret (forward-compat, §5.1).
    while (!r.atEnd()) {
      const uint8_t id = r.u8();
      const uint16_t schemaVersion = r.u16();
      const uint64_t payloadLen = r.varint();
      const size_t startPos = r.pos();

      // A reader that doesn't know this domain/version skips exactly payloadLen.
      if (id >= kDomainCount) {
        r.skip(payloadLen);
        continue;
      }
      (void)schemaVersion;  // validated in the header; per-record echo for skip.

      switch (static_cast<DomainId>(id)) {
        case DomainId::CoreEngine: domain::loadCoreEngine(s, r); break;
        case DomainId::WorldGen:   domain::loadWorldGen(s, r); break;
        case DomainId::Physics:    domain::loadPhysics(s, r); break;
        case DomainId::FactorySim: domain::loadFactorySim(s, r); break;
        case DomainId::Gameplay:   domain::loadGameplay(s, r); break;
      }

      // Defensive: ensure each domain consumed exactly its framed payload, so a
      // field-shape bug surfaces here instead of corrupting the next record.
      const size_t consumed = r.pos() - startPos;
      if (consumed != payloadLen)
        throw SaveError("domain record under/over-read its payload");
    }
    return s;
  }

  // ---- peek the header without decoding the body (for header round-trip
  //      tests + a fast manifest read). Throws SaveError if rejected. --------
  static SaveHeader readHeader(const std::vector<uint8_t>& bytes) {
    SaveReader r(bytes);
    return SaveHeader::readAndValidate(r);
  }

 private:
  template <typename Fn>
  static void writeRecord(SaveWriter& w, DomainId id, uint16_t schemaVersion,
                          Fn&& fillPayload) {
    // Build the payload into a temp writer, then length-prefix it (§5.1).
    SaveWriter payload;
    fillPayload(payload);
    w.u8(static_cast<uint8_t>(id));
    w.u16(schemaVersion);
    w.varint(payload.size());
    const std::vector<uint8_t>& bytes = payload.bytes();
    // append raw payload bytes (already framed by the varint length above).
    for (uint8_t b : bytes) w.u8(b);
  }
};

}  // namespace persist
}  // namespace of
