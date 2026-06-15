# Persistence & Data — Master Controller Context

> **Domain owner:** `persistence-controller` · **Reports to:** Admin · **Phase:** 1 · **Status:** Wave-0 headless core built + green (seed+diff save/load round-trip proven) · **Last updated:** 2026-06-14
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md) · [ADMIN](ADMIN.md) · **[persistence-phase1.md](../phase1/persistence-phase1.md)** (the Phase-1 slice save/load design — gates M2.5)

## 1. Mission
Save and restore arbitrarily large worlds cheaply and reliably: regenerate the natural universe from a seed, store only player modifications as diffs, stream chunks on demand, and keep saves forward-compatible as the game evolves.

## 2. Scope & owned subsystems
- **Seed+diff model** — the universe regenerates from a seed; only player changes are stored.
- **Chunked region storage** — world partitioned into streamable, independently loadable/savable chunks.
- **Serialization format** — compact (custom binary) for factory state at scale; structured for player/meta data.
- **World database / save container** — single-player file(s) and server-side store.
- **Streaming** — load/unload chunks tied to core-engine active bands & networking AOI.
- **Versioning & migration** — schema evolution without bricking saves.
- **Non-goals:** generating the world (→ world-gen; we store its *diffs* and seed); deciding what state matters (each domain declares its persistable state).

## 3. Key design decisions
| # | Decision | Rationale | Status | Date |
|---|----------|-----------|--------|------|
| PS-1 | Universe = seed; player changes = diffs (mirrors D-005 model) | Natural world costs ~0 to save; saves stay small | Accepted | 2026-06-14 |
| PS-2 | Chunked region storage, streamed | Worlds exceed memory; must page in/out | Accepted | 2026-06-14 |
| PS-3 | Custom binary (`.ofc`) for factory/world chunks; structured TLV (`.ofd`) for meta/progress | Factorio-scale state needs compactness/speed; meta needs migratability | **Accepted** (settled in Phase-1 design §5) | 2026-06-14 |
| PS-4 | Versioned schema from day one; two-level (container `formatVersion` + per-domain `schemaVersion`); **migration *machinery* deferred** | Saves outlive code; header carries every number a future migrator needs without a format redesign | Accepted | 2026-06-14 |
| PS-5 | **`FChunkKey` = `(BodyId, FaceId, RegionDepth, RegionPath)`**, a coarse **prefix** of world-gen's `FQuadKey`; one save region ≈ one factory-sim chunk proxy | Reuses world-gen's deterministic addressing → no separate spatial index; aligns save residency to core-engine's promote/demote bubble | Accepted (Phase-1 §3) | 2026-06-14 |
| PS-6 | **Single slot = one directory; atomic commit via write-temp-then-rename**, header written last as the commit record, `save0.bak/` retained until swap | Crash mid-save leaves the old *or* new complete slot, never a torn mix (P1-D5) | Accepted (Phase-1 §4.3) | 2026-06-14 |
| PS-7 | **Slice terrain is NOT a diff** — node mining only (D-005/WG-2), so terrain+deposit *placement* regenerate from seed; only **deposit depletion** is a world-gen diff | Headline slice simplification: the whole surface is free to persist | Accepted (Phase-1 §1.2) | 2026-06-14 |
| PS-8 | **On-rails factory chunks persist as `FRailState`**; load restores the proxy state and lets factory-sim's existing `OnPromote` reconstruct (bounded by `bufferCaps`, no dupes) | Reuses factory-sim's demote/promote machinery — persistence adds no new dupe surface (retires R1) | Accepted (Phase-1 §4.4) | 2026-06-14 |
| PS-9 | **Wave-0 headless save/load core BUILT** (`core/include/of/persistence.h` + `core/tests/test_persistence.cpp`): `SaveWriter`/`SaveReader` LE byte cursors (POD + LEB128 varint), versioned envelope `SaveHeader` (PS-4: magic `OFSV` + `formatVersion`=1 + `minReaderVersion` + per-domain `schemaVersion` table), per-domain serialize/deserialize over the 5 domains' OWN pinned types, and a `SaveGame::save(state)->bytes` / `load(bytes)->state` bundling them in the §4.5 load order with length-prefixed skip-capable records (§5.1). Proves M2.5 round-trip in-memory: build a non-trivial slice (deplete deposit, run factory `produced>0`, park craft conic, fill inventory, advance objective), save→load into a fresh state, every field matches; PS-7 verified (buffer **276 B** for the test scene — terrain never stored, regenerates bit-identically from seed); PS-4 header rejects bad magic / too-new version / truncation; save is byte-deterministic. **No additive core hooks needed** — consumes the green cores entirely through existing public APIs. **persistence_tests green; all 7 ctest suites pass.** Atomic single-slot *file* container (§4.3) layers above this in-memory format — deferred to the file-I/O wave. | The format is the gate-critical piece; it round-trips with zero terrain bytes and is forward-compat by construction | Accepted | 2026-06-14 |

## 4. Architecture & approach
- **Seed+diff:** store the world seed + a sparse set of diffs keyed by chunk: terrain edits (voxel patches), deposit depletion, placed/removed factory entities + their state, looted-POI flags, player inventory/progress. On load, regenerate from seed, then apply diffs.
- **Chunking:** the world is partitioned (per body, per region) into chunks that load when entering core-engine's active band / networking AOI and flush when leaving. On-rails factory chunks persist as their rate model + buffers, not per-entity (factory-sim FS-4).
- **Formats:** factory/world chunks → compact binary (versioned headers); player progress, tech, quests, settings → structured (binary or readable) for easier migration. Each domain provides serialize/deserialize for its own state; persistence owns the container, indexing, streaming, and versioning.
- **MP:** server holds the canonical store; clients regenerate from seed and receive diffs via networking (clients don't need the whole save).

## 5. Interfaces & dependencies
**Depends on (inbound):**
- world-gen: the seed + the diff set (terrain edits, depletion, POI flags).
- factory-sim: factory state snapshot (entities, buffers, on-rails rate models).
- gameplay: player progress (tech, quests, inventory, looted flags).
- physics: vessel orbital state (element sets) + active-vessel state.
- core-engine: chunk↔active-band mapping, `UniverseCoord` keys; networking: AOI streaming triggers, server-store role.
**Provides to (outbound) — published contracts (Phase-1 designed — [persistence-phase1.md](../phase1/persistence-phase1.md) §2,§5,§6):**
- **`IPersistable`** — the per-domain serialize/deserialize contract (`DomainId`, `SchemaVersion`, `SaveDiffs(FChunkKey, FSaveWriter&)`, `LoadDiffs(FChunkKey, FSaveReader&, savedVersion)`, `EnumerateDirtyChunks`). Each domain implements it over its OWN pinned state; persistence never interprets the bytes.
- **`FChunkKey`** + `truncate(FQuadKey → region)` mapping rule (PS-5).
- **Save/load orchestration + atomic single-slot container** (`Save(slot)`/`Load(slot)`, PS-6); `FSaveWriter`/`FSaveReader` byte cursors handed to each domain.
- **Versioned header (PS-4)** + the two payload formats (`.ofc` compact binary / `.ofd` structured TLV, PS-3).

**`IPersistable` per-domain state each must serialize (Wave-2 asks — routed by Admin):**
- **core-engine** (`CoreEngine`, GLOBAL): `worldSeed` + observer `FUniverseCoord`/`FFrameId` + `SimTime`/`TickIndex` + floating-origin anchor. Also owes a **save-quiesce tick boundary** (capture all domains at one `TickIndex`).
- **world-gen** (`WorldGen`, CHUNK): **deposit depletion only** — `(depositId, remaining)[]` per region. Terrain NOT saved (regenerates — PS-7).
- **physics** (`Physics`, GLOBAL): craft `FOrbitalElements + Mode + DominantFrame` (~10 doubles) (+`r,v` if active on surface).
- **factory-sim** (`FactorySim`, CHUNK): full per-entity SoA + `TransportLine` contents (active chunk) **or** `FRailState` (on-rails chunk, PS-8); align chunk granule to `FChunkKey.RegionDepth`.
- **gameplay** (`Gameplay`, GLOBAL): inventory + avatar position/body/frame/control-mode + objective progress flags.

**Load order contract (§4.5):** CoreEngine → WorldGen (regen+depletion) → Physics → FactorySim → Gameplay (player placed last into the completed world).

**Open negotiations (flagged to Admin as DEPENDENCIES):** (1) final `RegionDepth` — joint pick with factory-sim + core-engine so 1 save region ≈ 1 factory chunk proxy; (2) the save-quiesce tick handle from core-engine.

## 6. Task backlog / roadmap
- [Phase 0] ✅ Define `Persistable` interface + chunk-key scheme + version header convention (paper design).
- [Phase 1] ✅ **DESIGNED** — concrete seed+diff save/load for the "First Foundry" slice: `IPersistable`, `FChunkKey`, atomic single-slot container, on-rails restore via `FRailState`, versioned header. → [persistence-phase1.md](../phase1/persistence-phase1.md). **Gates M2.5.**
- [Phase 1] ✅ **BUILT (Wave-0 headless core)** — `core/include/of/persistence.h` + `core/tests/test_persistence.cpp` (PS-9): the seed+diff save/load FORMAT round-trips the slice state in memory (round-trip / PS-7 seed+diff / PS-4 versioned-header / determinism — all green; 7/7 ctest suites pass). Next: layer the atomic single-slot *file* container (§4.1/§4.3 write-temp-then-rename) above this in-memory format, and wire chunk-keyed region files (`FChunkKey`) once factory-sim/world-gen expose their per-chunk `IPersistable` payloads at scale (the headless core currently carries the slice's tiny diff set as global+depletion records).
- [Phase 2] Extend slice save/load to research/tech state; chunk streaming at scale; deposit-diff compaction.
- [Phase 3] Server-side canonical store; client seed+diff sync with networking.
- [Phase 4+] Migration *machinery* at the load boundary (header already designed for it — PS-4); voxel-edit diffs (digging); compression tuning (Phase 5).

## 7. Open questions & risks
- **R1 (RETIRED for the slice):** on-rails factory persistence fidelity → solved by storing factory-sim's `FRailState` and reusing its `OnPromote` reconstruction (bounded by `bufferCaps`, deterministic, no dupes — spike3 G2). Persistence adds no new dupe surface (PS-8, Phase-1 §4.4). Residual: deep-recipe rate-model accuracy is factory-sim's Phase-2 refinement, not ours.
- **R2:** migration burden as schemas evolve in parallel — mitigated by **two-level versioning** (container + per-domain `schemaVersion`) so a domain bumps its format independently; machinery deferred but header carries every number it needs (PS-4).
- **R3:** save size/perf for large built-up worlds; slice-scale is trivial (hundreds of entities); compression deferred (Phase-5) with a reserved per-chunk flag so it's a non-breaking add.
- **OPEN (Wave-2 negotiation):** (1) `FChunkKey.RegionDepth` granule — joint pick with factory-sim + core-engine (1 region ≈ 1 chunk proxy); (2) core-engine save-quiesce tick handle (no torn cross-domain snapshot).

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| 2026-06-14 | Phase-1 slice save/load design (this controller, direct — no subagent spawned) | Done | [persistence-phase1.md](../phase1/persistence-phase1.md) — settled PS-3, added PS-5..PS-8, published `IPersistable`/`FChunkKey`/load-order, routed per-domain Wave-2 asks. |
| 2026-06-14 | Web research (1 scoped thread, direct WebSearch — no subagent): "seed+delta world persistence; chunked save streaming; atomic write; versioned header" | Done | Validated the seed+diff + region-chunk files + versioned envelope + write-temp-then-rename pattern (Minecraft level format/seed; indie versioned/atomic save systems). No design change — confirmed PS-1..PS-4. |
| 2026-06-14 | Wave-0 BUILD (this controller, direct — no subagent): implement the headless seed+diff save/load core + tests; build with g++/CMake/Ninja; verify all 7 suites | Done | `persistence.h` (`SaveWriter`/`SaveReader`/`SaveHeader`/`SaveGame` + per-domain serialize over the 5 green cores' pinned types) + `test_persistence.cpp` (4 groups, 88 checks). `persistence_tests` green; **7/7 ctest suites pass** (no regression). Save buffer = 276 B for the built test scene (PS-7: terrain regenerates from seed, never stored). No additive core hooks required. → PS-9. |

## 9. References
MASTER_PLAN §6 (persistence), §9 (seed+diff), D-005. Factorio save format (custom binary); chunked-world streaming; schema versioning/migration patterns.
