#pragma once
// =============================================================================
// persistence_file.h — atomic single-slot save FILE container (PS-6).
//
// This is the deferred FILE-I/O layer that sits ABOVE the in-memory seed+diff
// format in persistence.h. persistence.h proves the format round-trips in
// MEMORY (bytes in / bytes out, no disk). THIS file is the thin, disk-aware
// container that writes that save buffer to a single slot DIRECTORY safely and
// reads it back — the realization of decision PS-6 / persistence-phase1.md
// §4.1 / §4.3:
//
//   * Single slot = one directory (P1-D5). One canonical file: slotDir/save.ofc.
//   * ATOMIC COMMIT via write-temp-then-rename: stage into slotDir/save.tmp,
//     flush + close, then std::filesystem::rename it OVER slotDir/save.ofc.
//     rename(2) is atomic on the same volume, so a crash leaves either the OLD
//     complete file or the NEW complete file — never a torn mix (§4.3).
//   * The previous good slot is rotated to slotDir/save.bak BEFORE the swap, so
//     a crash mid-commit still leaves the last good save recoverable (§4.3).
//   * Header (a fixed container envelope) is written so the COMMIT is the
//     rename; a magic + length + footer guard rejects a truncated/torn file
//     (returns false) rather than handing garbage to the in-memory reader.
//
// Container file layout (slotDir/save.ofc) — distinct from the inner OFSV
// envelope persistence.h writes INSIDE the payload (this layer never parses it):
//
//   [u32  containerMagic = "OFCS"]   header — identifies the slot container
//   [u16  containerVersion = 1   ]
//   [u16  reserved (0)           ]
//   [u64  payloadLen             ]   exact byte length of the save buffer
//   [u8   payload[payloadLen]    ]   the persistence.h save bytes (opaque here)
//   [u32  footerMagic = "OFCE"   ]   written LAST — the on-file commit marker
//
// The footer is the in-file commit record: a file missing its trailing footer
// magic (a torn write that died mid-stream) is rejected by the length/footer
// guard. The directory rename is the atomic commit on top of that.
//
// Header-only. Depends only on the C++17 standard library (<fstream> +
// <filesystem>). No game-domain headers — it moves an opaque byte buffer to and
// from disk. (Pair it with persistence.h: SaveGame::save(state) -> bytes ->
// SaveToSlot(dir, bytes); LoadFromSlot(dir, bytes) -> SaveGame::load(bytes).)
// =============================================================================
#include <cstdint>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

namespace of {
namespace persist {
namespace file {

// =============================================================================
// §0 — Container constants + canonical slot filenames.
// =============================================================================

// Container header magic "OFCS" (Orbital Foundry Container Slot), LE u32.
static constexpr uint32_t kContainerMagic = 0x5343464Fu;  // 'O''F''C''S' LE
// Container footer magic "OFCE" (…Container End) — written LAST, the in-file
// commit marker that proves the stream wasn't truncated mid-write.
static constexpr uint32_t kContainerFooterMagic = 0x4543464Fu;  // 'O''F''C''E' LE
// Container layout version (the file envelope, independent of the inner OFSV
// formatVersion the payload carries).
static constexpr uint16_t kContainerVersion = 1;

// Fixed header: magic(4) + version(2) + reserved(2) + payloadLen(8) = 16 bytes.
static constexpr uint64_t kHeaderBytes = 16;
// Fixed footer: footerMagic(4).
static constexpr uint64_t kFooterBytes = 4;
// Smallest possible valid container (header + footer, zero-length payload).
static constexpr uint64_t kMinContainerBytes = kHeaderBytes + kFooterBytes;

// Canonical filenames within a slot directory.
inline const char* kSaveName() { return "save.ofc"; }   // the live, committed save
inline const char* kTempName() { return "save.tmp"; }   // atomic staging file
inline const char* kBakName()  { return "save.bak"; }   // last good save, kept until swap

// =============================================================================
// §1 — Low-level container encode / decode (the magic + length guard).
// =============================================================================

namespace detail {

inline void putU16(std::vector<uint8_t>& b, uint16_t v) {
  b.push_back(static_cast<uint8_t>(v));
  b.push_back(static_cast<uint8_t>(v >> 8));
}
inline void putU32(std::vector<uint8_t>& b, uint32_t v) {
  for (int i = 0; i < 4; ++i) b.push_back(static_cast<uint8_t>(v >> (8 * i)));
}
inline void putU64(std::vector<uint8_t>& b, uint64_t v) {
  for (int i = 0; i < 8; ++i) b.push_back(static_cast<uint8_t>(v >> (8 * i)));
}
inline uint16_t getU16(const uint8_t* p) {
  return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}
inline uint32_t getU32(const uint8_t* p) {
  uint32_t v = 0;
  for (int i = 0; i < 4; ++i) v |= static_cast<uint32_t>(p[i]) << (8 * i);
  return v;
}
inline uint64_t getU64(const uint8_t* p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(p[i]) << (8 * i);
  return v;
}

// Wrap an opaque save payload in the container envelope (header + payload +
// footer). The footer magic is the in-file commit marker (written last).
inline std::vector<uint8_t> encode(const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> out;
  out.reserve(payload.size() + kHeaderBytes + kFooterBytes);
  putU32(out, kContainerMagic);
  putU16(out, kContainerVersion);
  putU16(out, 0);  // reserved
  putU64(out, static_cast<uint64_t>(payload.size()));
  out.insert(out.end(), payload.begin(), payload.end());
  putU32(out, kContainerFooterMagic);  // commit marker, written LAST
  return out;
}

// Validate a container file's bytes and extract the payload. Returns false (the
// guard fires) if the magic is wrong, the version is unsupported, the declared
// payload length doesn't fit the file (truncated/torn), or the footer commit
// marker is missing/wrong. A torn write that died mid-stream lacks its footer
// and is rejected here rather than read as garbage.
inline bool decode(const std::vector<uint8_t>& raw, std::vector<uint8_t>& outPayload) {
  if (raw.size() < kMinContainerBytes) return false;            // too short for header+footer
  const uint8_t* p = raw.data();
  if (detail::getU32(p) != kContainerMagic) return false;       // not our container
  if (detail::getU16(p + 4) != kContainerVersion) return false; // unsupported envelope
  // p+6: reserved (ignored)
  const uint64_t payloadLen = detail::getU64(p + 8);
  // Length guard: header + declared payload + footer must EXACTLY fit the file.
  // A truncated file makes this fail (declared length runs past the bytes we
  // actually have); a too-long/garbage length fails the same way.
  if (payloadLen > raw.size()) return false;                    // overflow-safe: len can't exceed file
  if (kHeaderBytes + payloadLen + kFooterBytes != raw.size()) return false;
  // Footer commit marker must be present at the tail (proves no mid-write tear).
  const uint8_t* footer = p + kHeaderBytes + payloadLen;
  if (detail::getU32(footer) != kContainerFooterMagic) return false;
  outPayload.assign(p + kHeaderBytes, p + kHeaderBytes + payloadLen);
  return true;
}

// Read an entire file into a byte vector. Returns false if it can't be opened.
inline bool readFile(const std::filesystem::path& path, std::vector<uint8_t>& out) {
  std::error_code ec;
  if (!std::filesystem::exists(path, ec) || ec) return false;
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  in.seekg(0, std::ios::end);
  const std::streamoff len = in.tellg();
  if (len < 0) return false;
  in.seekg(0, std::ios::beg);
  out.resize(static_cast<size_t>(len));
  if (len > 0) in.read(reinterpret_cast<char*>(out.data()), len);
  return static_cast<bool>(in) || in.eof();
}

}  // namespace detail

// =============================================================================
// §2 — SaveToSlot / LoadFromSlot: the public file-container API (PS-6).
// =============================================================================

// Atomically write `bytes` (a persistence.h save buffer) into `slotDir` as the
// committed save.ofc. PS-6 / §4.3 write-temp-then-rename:
//   1. Create slotDir if missing.
//   2. Wrap bytes in the container envelope; write to slotDir/save.tmp; flush +
//      close (the OS buffers are committed before we rename).
//   3. Rotate the existing save.ofc -> save.bak (keep the last good slot until
//      the swap completes).
//   4. rename save.tmp -> save.ofc (ATOMIC on the same volume — the commit).
// A crash at any point leaves either the OLD save.ofc (+ its save.bak) or the
// NEW save.ofc — never a half-written live file. Returns false on any I/O error.
inline bool SaveToSlot(const std::string& slotDir, const std::vector<uint8_t>& bytes) {
  namespace fs = std::filesystem;
  std::error_code ec;

  // 1) Ensure the slot directory exists.
  const fs::path dir(slotDir);
  fs::create_directories(dir, ec);  // no error if it already exists
  if (ec) return false;
  if (!fs::is_directory(dir, ec) || ec) return false;

  const fs::path live = dir / kSaveName();
  const fs::path tmp  = dir / kTempName();
  const fs::path bak  = dir / kBakName();

  // 2) Stage the framed container into the temp file, then flush + close.
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    const std::vector<uint8_t> framed = detail::encode(bytes);
    if (!framed.empty())
      out.write(reinterpret_cast<const char*>(framed.data()),
                static_cast<std::streamsize>(framed.size()));
    out.flush();
    if (!out) return false;     // a write/flush error invalidates the staging
  }  // ofstream destructor closes the handle here

  // 3) Rotate the current live save to .bak (only if a live save exists).
  if (fs::exists(live, ec) && !ec) {
    // Replace any stale .bak so the rename can't fail on an existing target.
    fs::remove(bak, ec);  // ignore "not found"
    fs::rename(live, bak, ec);
    if (ec) return false;
  }

  // 4) ATOMIC COMMIT: rename the staged temp over the live name.
  fs::rename(tmp, live, ec);
  if (ec) {
    // Commit failed: try to restore the previous live save from .bak so the
    // slot is left in its prior good state rather than empty.
    std::error_code ec2;
    if (fs::exists(bak, ec2) && !ec2) fs::rename(bak, live, ec2);
    return false;
  }
  return true;
}

// Read the committed save back from `slotDir` into `outBytes` (the original
// persistence.h save buffer, with the container envelope stripped). PS-6 /
// §4.3 recovery: read save.ofc; if it's missing OR fails the magic/length/
// footer guard (truncated/torn), fall back to save.bak. Returns false only if
// neither a valid save.ofc nor a valid save.bak is present.
inline bool LoadFromSlot(const std::string& slotDir, std::vector<uint8_t>& outBytes) {
  namespace fs = std::filesystem;
  const fs::path dir(slotDir);
  const fs::path live = dir / kSaveName();
  const fs::path bak  = dir / kBakName();

  // Try the live save first; the guard rejects a truncated/torn file.
  std::vector<uint8_t> raw;
  if (detail::readFile(live, raw)) {
    std::vector<uint8_t> payload;
    if (detail::decode(raw, payload)) {
      outBytes = std::move(payload);
      return true;
    }
    // live exists but failed the guard -> fall through to the backup.
  }

  // Fall back to the last good backup.
  raw.clear();
  if (detail::readFile(bak, raw)) {
    std::vector<uint8_t> payload;
    if (detail::decode(raw, payload)) {
      outBytes = std::move(payload);
      return true;
    }
  }
  return false;  // no recoverable save in this slot
}

}  // namespace file
}  // namespace persist
}  // namespace of
