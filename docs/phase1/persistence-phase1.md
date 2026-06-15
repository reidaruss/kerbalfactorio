# Persistence — Phase-1 Slice Save/Load Design ("First Foundry")

> **Domain:** Persistence & Data · **Phase:** 1 · **Status:** Designed, ready to build · **Last updated:** 2026-06-14
> **Owner:** `persistence-controller` · Read alongside: [persistence.md](../controllers/persistence.md) · [PHASE1-PLAN](PHASE1-PLAN.md) §2/§5/§6 · [MASTER_PLAN](../MASTER_PLAN.md) §9 · pinned domain contracts: [worldgen](../spikes/spike1-worldgen.md) §4–5 · [factory-sim](../spikes/spike3-factory-sim.md) §5–6 · [physics](../spikes/spike2-physics.md) §8 · [core-engine](../spikes/spike1-core-engine.md) §5
> **Gates:** milestone **M2.5** (PHASE1-PLAN §5) — full-loop save→quit→reload→continue with no loss/dupe.

---

## 0. Purpose & scope fence

The slice has a single objective: *land a working automated outpost on the moon* (PHASE1-PLAN §2). This doc designs the **concrete seed+diff save/load** that lets a player do that whole loop, save, quit, reload, and continue **byte-for-byte where they left off** — single save slot (P1-D5).

**What persistence owns here (and only here):** the **save container, chunk indexing, streaming hookup, atomic write, version header, and load orchestration.** Persistence does **not** serialize any domain's state itself — each domain implements a `Persistable` (§2) for its own bytes. We own the envelope; they own the payload (AGENT_ARCHITECTURE §6; persistence.md §2 non-goals).

**Honored constraints:** PS-1 (seed+diff), PS-2 (chunked), PS-3 (compact binary for factory/world, structured for meta), PS-4 (versioned header), P1-D5 (single slot).

**Out of scope (deferred, do not build):** migration *tooling* (we design the header that *enables* it — PS-4 — but defer the migrate-on-load machinery to Phase 4+); server-side store (Phase 3); compression tuning (Phase 5); voxel-terrain-edit diffs (no digging in the slice — D-005 / WG-2; see §1.2).

---

## 1. Seed+diff model for the slice

### 1.1 The principle (PS-1, MASTER_PLAN §9)

**The universe is a pure function of a seed.** Both bodies' terrain (Forge + Cinder), their orbits, and their deposit *placement* regenerate **bit-identically** from `(worldSeed, FQuadKey)` — world-gen guarantees this (spike1-worldgen WV1: deterministic regen, position-hashed noise). Therefore the natural world costs **~0 bytes** to save: we store the seed, and on load we *regenerate* it. We persist **only what the player changed** — a sparse diff set against the procedural baseline.

```
saved_state  =  worldSeed  +  Σ player-authored diffs
loaded_state =  regenerate(worldSeed)  THEN  apply(diffs)
```

### 1.2 The exact diff set for the slice

Walking the §2 loop, here is **every** piece of mutable state the player can author, and whether it is a diff or regenerates from seed:

| State | Source domain | Diff or seed? | Why |
|---|---|---|---|
| **Terrain (heightfield)** | world-gen | **SEED — not a diff** | The slice is **node-based mining, no voxel deformation** (D-005, WG-2). The player never deforms terrain, so every quad regenerates from `(worldSeed, FQuadKey)` (spike1-worldgen §1.3, WV1). **This is the headline simplification of the slice:** the entire planet + moon surface is free to persist. The voxel-patch seam (`bFromVoxelPatch`, spike1-worldgen §4.4) stays empty. |
| **Deposit depletion** | world-gen | **DIFF** | Deposit *placement & richness* regenerate from seed; what the player *removed* by mining does not. We store **remaining amount per touched deposit** (the only world-gen mutation in the slice). Untouched deposits emit no diff. |
| **Placed/removed factory entities** | factory-sim | **DIFF** | Miners, belts, smelters, assemblers, boxes, power source — none exist in the procedural world; **every one is a player edit.** Stored as the entity set + per-entity state (recipe, inventory buffers, belt line contents, power-network membership). |
| **Factory buffers & power** | factory-sim | **DIFF** (part of the above) | Machine inventories, belt item-gap lists, chest contents, power-network brownout state. Captured via factory-sim's snapshot / `FRailState` (§4.4). |
| **Craft orbital state** | physics | **DIFF** | The lander is player-controlled; its position/orbit is authored by flying. Stored as `FOrbitalElements + Mode + DominantFrame` (~10 doubles — spike2-physics §8.2). |
| **Player inventory** | gameplay | **DIFF** | Hand inventory (items carried). Empty at world-gen, filled by play. |
| **Player position + body/frame** | gameplay | **DIFF** | Where the avatar is standing/sitting, which body, which `FFrameId`, on-foot vs in-craft. |
| **Player progress** | gameplay | **DIFF** | Slice-objective progress flags (e.g. "mined Cinder resource", "outpost online"). No tech tree in the slice (P1-D4) — this is a tiny flag set. |

**That's the whole slice.** No POIs/loot (Phase 4), no quests beyond the one objective, no research (Phase 2). The diff set is deliberately small: **deposit depletion + factory + one craft + player meta.**

### 1.3 What this buys us

- A fresh, unbuilt world saves in **a few hundred bytes** (seed + header + empty diff sets).
- A built-up slice saves only the **factory chunks the player touched** + the deposits they dented + 4 small structured records (craft, inventory, position, progress).
- Reload is **regenerate-then-patch**, never "load every voxel."

---

## 2. The `Persistable` interface (the per-domain contract)

Each domain implements `IPersistable` for **its own** slice state. Persistence calls these; it never reaches inside a domain's data. This is the contract Admin routes into Wave 2 (one ask per domain — see §6 / persistence.md §5).

```cpp
// Persistence OWNS this interface; each domain IMPLEMENTS it for its state.
// The serializer is a thin cursor over the chunk/record byte buffer persistence supplies;
// the domain reads/writes its own fields through it. Persistence never interprets the bytes.
class IPersistable {
public:
    // --- Identity / versioning ---
    virtual FPersistDomainId DomainId() const = 0;   // stable enum: CoreEngine, WorldGen, Physics, FactorySim, Gameplay
    virtual uint16           SchemaVersion() const = 0; // this domain's payload schema version (PS-4); bumped by the domain on a format change

    // --- Diff capture (save) ---
    // Write THIS domain's diffs for ONE chunk (factory/world) or the global meta record (player/craft).
    // `key` identifies which chunk; INVALID_CHUNK for the per-domain global record.
    // Returns false + writes nothing if the domain has NO diff for this key (so empty chunks cost 0 bytes).
    virtual bool SaveDiffs(FChunkKey key, FSaveWriter& out) const = 0;

    // --- Diff application (load) ---
    // Called AFTER the domain has regenerated its seed baseline for `key`.
    // Reads back exactly what SaveDiffs wrote (same schema version, checked by persistence).
    virtual void LoadDiffs(FChunkKey key, FSaveReader& in, uint16 savedVersion) = 0;

    // --- Enumeration (save) ---
    // Persistence asks the domain which chunks it has dirty diffs for, so it only writes touched chunks.
    virtual void EnumerateDirtyChunks(TArray<FChunkKey>& out) const = 0;
};
```

`FSaveWriter`/`FSaveReader` are persistence-owned byte cursors (compact binary; little-endian; varint helpers for counts/ids). They give the domain primitive put/get (u8/u16/u32/u64/double/blob/varint) — the domain decides its own field order/packing; persistence only frames the buffer, length-prefixes it, and version-stamps it.

### 2.1 Per-domain state each `IPersistable` must serialize

This is the **precise list** Admin routes to each domain in Wave 2. Each is "implement `IPersistable` over exactly this state, consuming the already-pinned types":

| Domain | `DomainId` | Chunk-scoped or global? | State it serializes (consumes its OWN pinned types) |
|---|---|---|---|
| **world-gen** | `WorldGen` | **Chunk** (per region) | **Deposit depletion only.** Per touched deposit in the chunk: `depositId` (stable, hashed from `(bodySeed, FQuadKey, localIndex)`) + `remainingAmount`. Terrain is NOT serialized (regenerates — §1.2). Voxel-patch seam stays empty (WG-2). |
| **factory-sim** | `FactorySim` | **Chunk** (per region) | **All placed entities in the chunk** + their state. For an **active** chunk: the SoA entity records (type, grid transform `gx,gy,gz,dir`, `recipeId`, `progressTicks`, `Inventory` slots, `InserterState`, power-network membership) + per-`TransportLine` contents (`headGap/tailGap/itemGaps[]/itemTypes[]/compressed`). For an **on-rails** chunk: the compact **`FRailState`** (`inputRates/outputRates/bufferLevels/bufferCaps/snapshotTick/brownoutAvg` — spike3 §5.2). See §4.4 for which form is written. |
| **physics** | `Physics` | **Global** (one craft in the slice) | The lander's **`FOrbitalElements` + `Mode` + `DominantFrame`** (spike2-physics §8.2: "persistence saves Elements + Mode + DominantFrame — ~10 doubles"). If active on the surface (landed/parked), also its `FUniverseCoord` position + `FVector3d` velocity so an active-on-ground craft restores without a fitted-conic round-trip. |
| **gameplay** | `Gameplay` | **Global** (player record) | **Player inventory** (item id + count list), **avatar position** (`FUniverseCoord` + facing) + **current body/`FFrameId`** + **control mode** (on-foot / in-craft), and **objective progress flags** (small bitset — no tech tree, P1-D4). |
| **core-engine** | `CoreEngine` | **Global** (universe header) | **Not user diffs — the regeneration anchors:** `worldSeed`, the active observer's authoritative `FUniverseCoord` + `FFrameId`, current `SimTime`/`TickIndex` at save, and the floating-origin `UniverseOrigin`+`Frame` so load re-establishes the exact frame/time context before any diff is applied. Core-engine is the **first** `IPersistable` read and the **last** baseline established (§4.5). |

**Boundary restated:** persistence does **not** know what a `recipeId` or an `FOrbitalElements` *means*. It hands each domain a framed buffer and a version; the domain fills/reads it. This keeps the §5.3 dependency-graph contract clean — each domain owns "what state matters" (persistence.md §2 non-goals).

---

## 3. Chunk-key scheme (2 bodies, per-body / per-region)

### 3.1 `FChunkKey`

The slice has **2 bodies** (Forge, Cinder — D-006). We partition each body's surface into **regions** and key every chunk by `(body, region)`. The region grid reuses world-gen's deterministic cube-sphere addressing so a chunk key maps directly onto terrain quads and onto factory placement, with **no separate spatial index to keep in sync**.

```cpp
struct FChunkKey {
    uint8   BodyId;     // 0 = Forge, 1 = Cinder (== world-gen FBodyId == core-engine FFrameId mapping)
    uint8   FaceId;     // 0..5 — the cube face (spike1-worldgen §1.1)
    uint8   RegionDepth;// quadtree depth at which we cut "save regions" (FIXED per body, NOT the render LOD depth)
    uint64  RegionPath; // base-4 quad path to the region root (spike1-worldgen §1.2 packing)
};                      // INVALID_CHUNK (BodyId=0xFF) denotes the per-domain GLOBAL record (player/craft/header)
```

**Design choices:**
- **`RegionDepth` is fixed and coarse**, independent of render LOD. Render LOD subdivides to depth ~12–14 (1 m cells); **save regions cut at a coarse depth** — the locked values are **Forge depth 9 (≈1841 m region), Cinder depth 8 (≈1227 m region)** (locked per PHASE1-PLAN §10, 2026-06-14; this corrects the earlier "depth 5–6" placeholder), aligned 1:1 to factory-sim's confirmed ~1 km chunk proxy so a slice-scale factory of hundreds of entities lands in **one or a few** chunk files, not thousands of tiny ones. This decouples "how finely we draw" from "how finely we persist."
- A `FChunkKey` is a **prefix** of a render `FQuadKey` — so "which save region does this entity/deposit belong to" is `truncate(FQuadKey, RegionDepth)`: a closed-form path-prefix, no lookup. World-gen deposits, factory entities, and terrain quads all fall into a region by the **same rule**.
- **Two bodies, both small-scale in the slice:** Forge gets the bulk of regions (the home factory), Cinder gets a handful (the outpost). Most regions are **untouched → no chunk file written** (the seed regenerates them).

### 3.2 Mapping chunks ↔ core-engine active bands (load/unload)

Persistence does **not** invent its own residency logic — it rides core-engine's existing promote/demote bubble (spike1-core-engine §3.2, §5.3) and world-gen's streaming (spike1-worldgen §3.2):

- **Save-region residency = factory-chunk `ISimProxy` residency.** Factory-sim already registers **one `ISimProxy` per factory chunk** (spike3 §5.4, FS-7), promoted/demoted by core-engine's bubble (2 km activate / 3 km deactivate / 2 s dwell). We align `FChunkKey.RegionDepth` so **one save region ≈ one factory chunk proxy.** When core-engine **demotes** a factory chunk to on-rails, that is persistence's cue the chunk is a candidate to **flush** (write its dirty diff and drop resident bytes); when it **promotes**, persistence **loads** that chunk's diff (if any) before factory-sim reconstructs (§4.4).
- **Load trigger:** on `OnSOIChange` (entering a body's frame — spike1-worldgen §3.2) persistence makes that body's chunk index resident; on the per-chunk promote, it streams the chunk's diff. We never hold both bodies' full factory state if only one is active.
- **In the slice specifically:** both bodies are always in view (spike1-worldgen §3.2), and the factory is small, so in practice **all touched chunks are resident during play**; streaming-by-band matters for *correctness of the seam* (the design is band-driven) but the slice's working set fits memory. We build the band hookup now so Phase-2 scale doesn't need a persistence rewrite (PS-2).

---

## 4. Save / load flow

### 4.1 Container layout (single slot, P1-D5)

One save = **one directory** (single slot — overwritten in place), atomically swapped:

```
save0/                         (the single slot; a sibling save0.tmp/ is the atomic staging dir)
  header.ofd                   versioned envelope + manifest (structured) — PS-4, §5.2
  meta.ofd                     global records: core-engine header, physics craft, gameplay player (structured) — §5.2
  chunks/
    f00_d05_<path>.ofc         one compact-binary chunk file per DIRTY region (factory + world-gen diffs) — §5.1
    f01_d05_<path>.ofc         ...
```

`.ofd` = Orbital-Foundry-Data (structured); `.ofc` = Orbital-Foundry-Chunk (compact binary). Only **dirty** chunks get a file; untouched regions have **no file** (regenerate from seed). The `header.ofd` manifest lists which chunk files exist + their `FChunkKey` + payload schema versions, so load knows what to stream without scanning the directory.

### 4.2 Save flow

```
SAVE(slot):
 1. Quiesce the sim to a tick boundary: capture at a known TickIndex() so every domain's
    snapshot is from the SAME tick (no torn read across domains).  [core-engine ISimClock]
 2. Stage into save0.tmp/  (NEVER write the live slot directly — atomicity, §4.3).
 3. Write header.ofd:  magic, formatVersion, worldSeed, savedTickIndex, savedSimTime,
    per-domain SchemaVersion table, chunk manifest (filled as chunks are written).
 4. Write meta.ofd (structured) by calling, in order:
       CoreEngine.SaveDiffs(GLOBAL)   → seed-anchor/observer/time/origin
       Physics.SaveDiffs(GLOBAL)      → craft FOrbitalElements+Mode+DominantFrame(+r,v if active)
       Gameplay.SaveDiffs(GLOBAL)     → inventory + position + body/frame + progress flags
 5. For each domain D in {WorldGen, FactorySim}:
       D.EnumerateDirtyChunks(keys)
       for key in keys:  open/append chunks/<key>.ofc; D.SaveDiffs(key, writer)
         (a chunk file may carry BOTH world-gen and factory-sim payloads, each length-prefixed
          + domain-tagged + version-stamped, §5.1 — one file per region, multiple domain records.)
       record each written chunk in the header manifest.
 6. fsync staged files; write header LAST (header is the commit record).
 7. ATOMIC SWAP (§4.3): rename save0/ → save0.bak/ , save0.tmp/ → save0/ , drop save0.bak/.
```

Save is **O(dirty chunks + 3 global records)** — a small built slice writes a handful of files in milliseconds.

### 4.3 Atomic write (no half-saved slot)

Single slot must never be left torn by a crash mid-save:

- All writes go to **`save0.tmp/`**; the live `save0/` is untouched until everything is staged and fsync'd.
- The **header is written last** and is the **commit point** — a `save0.tmp/` without a complete header is ignored on load.
- Commit is a **directory rename** (atomic on the platform): keep the previous slot as `save0.bak/` until the new `save0/` is in place, then delete the backup. A crash at any instant leaves either the **old** complete slot or the **new** complete slot — never a mix. (Standard write-temp-then-rename; confirmed by indie-save best practice — §7 refs.)

### 4.4 Restoring on-rails factory chunks from `FRailState`

A factory chunk can be saved in **two states** depending on whether it was active or on-rails at save time (factory-sim already distinguishes these — spike3 §5):

- **Saved ACTIVE** → the `.ofc` carries full per-entity SoA + transport-line contents. On load, factory-sim's `LoadDiffs` rebuilds entities directly. (Exact restore.)
- **Saved ON-RAILS** → the `.ofc` carries the compact **`FRailState`** (rates + buffer levels + `snapshotTick`). On load, the chunk stays on-rails: factory-sim seeds the proxy with the saved `FRailState` and core-engine resumes it. **Crucially, `snapshotTick` is rebased to the loaded `TickIndex`** so no phantom elapsed-time is reconstructed at load (load is *not* a time-warp). If the player then approaches, core-engine promotes it and factory-sim's `OnPromote` reconstructs per-entity buffers from `FRailState` — **bounded by `bufferCaps`, deterministic, no dupes** (spike3 §5.3, gate G2). 

This means persistence **reuses factory-sim's existing demote/promote machinery for free**: a save is just a "demote to disk," a load is "restore the proxy state, let the existing promote path reconstruct on approach." Persistence never reconstructs factory entities itself — it restores the `FRailState`/snapshot bytes and hands them back to factory-sim.

> **R1 (persistence.md) note:** on-rails save fidelity is exactly factory-sim's R2 (no-dupe on promote), already retired by spike3 G2. Persistence inherits the guarantee by storing the same `FRailState` the live demote produces — we add no new dupe surface.

### 4.5 Load flow + load order across domains

Order matters: a domain can only apply diffs **after** the context it depends on exists (mirrors the §5.3 dependency graph: core-engine → world-gen → factory-sim; physics/gameplay ride on top).

```
LOAD(slot):
 1. Read & validate header.ofd: check magic + formatVersion (PS-4). If formatVersion is
    newer than the build → refuse (no forward load). If older → (Phase-1: must match;
    migration deferred — §5.3). Read worldSeed, savedTickIndex, savedSimTime, schema table, manifest.
 2. CORE-ENGINE FIRST: LoadDiffs(GLOBAL) → re-seed the universe with worldSeed, set SimClock to
    savedSimTime/savedTickIndex, install the saved floating-origin + active observer frame.
    => Now the deterministic baseline exists: regenerate(worldSeed) is well-defined.  [PS-1]
 3. WORLD-GEN baseline + diffs: world-gen regenerates terrain/deposit PLACEMENT from seed (free).
    Then for each chunk in the manifest with a WorldGen record: LoadDiffs(key) applies
    deposit-depletion (sets remainingAmount on the regenerated deposits).
 4. PHYSICS: LoadDiffs(GLOBAL) → restore craft FOrbitalElements+Mode+DominantFrame (+r,v if active).
    Register its ISimProxy; core-engine places it on-rails or active per saved Mode.
 5. FACTORY-SIM: for each chunk with a FactorySim record: LoadDiffs(key). Active-saved chunks
    rebuild entities; on-rails-saved chunks restore FRailState (snapshotTick rebased, §4.4).
    Factory chunks register their ISimProxy; core-engine's bubble decides active vs on-rails
    by the loaded observer position — so a chunk near the player auto-promotes and reconstructs.
 6. GAMEPLAY LAST: LoadDiffs(GLOBAL) → restore inventory, avatar position+body/frame+control mode,
    objective progress. Avatar/craft are now placed in a fully-restored world.
 7. Resume the tick loop. The player is exactly where they saved, with no loading seam.
```

**Why this order:** seed/time/frame must exist before terrain regenerates; terrain+deposits before factory entities sit on them; the craft and player are placed last into the completed world. This is the §5.3 dependency graph applied to load.

---

## 5. Serialization format

Two payload families (PS-3), each with a version header (PS-4).

### 5.1 Compact binary — factory & world chunks (`.ofc`)

For factory state at slice scale and deposit depletion: **little-endian packed binary, varint-coded counts/ids**, no reflection, no field names. This is the format that has to scale to Phase-5 (PS-3 rationale: Factorio-scale needs compactness/speed). One `.ofc` per dirty region; inside, a sequence of **domain records**:

```
.ofc file:
  [ChunkFileHeader]
     magic            u32   "OFC1"
     chunkKey         {u8 body, u8 face, u8 depth, u64 path}
     recordCount      varint
  repeat recordCount:
     [DomainRecord]
        domainId      u8     (WorldGen | FactorySim)
        schemaVersion u16    (that domain's IPersistable.SchemaVersion at save time)
        payloadLen    varint (bytes — lets a reader SKIP a record whose domain/version it can't read)
        payload       bytes  (the domain wrote these via FSaveWriter; opaque to persistence)
```

- **`payloadLen` is the forward-compat lever:** a loader that doesn't recognize a record (wrong domain build, or a future migration boundary) can **skip exactly `payloadLen` bytes** and keep going. Persistence never parses the payload.
- Factory payloads use factory-sim's natural packing (SoA arrays / `FRailState` / varint `itemGaps[]`) — already compact by design (spike3 §1.3, §2.2). Deposit depletion is a tiny `(varint depositId, varint remaining)[]`.
- **Compression is NOT applied in Phase 1** (deferred — PS-3 scope, MASTER_PLAN §9 / persistence.md backlog). The format leaves room for a per-chunk compression flag in the header so Phase-5 can add it without a format break.

### 5.2 Structured — player & meta (`.ofd`)

For the global records (core-engine header, craft, player) and the manifest: a **structured, field-tagged** binary (tag-length-value), easier to migrate and inspect than raw packed binary (PS-3: "structured for meta/progress… easier migration"). These records are tiny (a few dozen fields total across the whole slice), so we trade a few bytes of tags for migratability.

```
.ofd record:  [u16 tagId][u8 type][varint len][bytes value] ...
  // tagId is stable per field; unknown tags are skipped (len-prefixed) → additive schema evolution
  // matches the "additive, append-only field" discipline the spikes already use (RC-2/RC-7/RC-12)
```

This mirrors how the domain spikes evolve their own structs (append-only trailing fields, never renumber) — so the meta format evolves the same way the contracts do.

### 5.3 Version header (PS-4) — design now, defer migration machinery

Every save carries versioning at **two levels**, so we can evolve formats without bricking saves — but Phase 1 only *reads its own version* (migration is deferred):

```
header.ofd top-level envelope:
  magic            u32   "OFSV"   (Orbital Foundry SaVe)
  formatVersion    u16   container/layout version (this whole scheme = 1)
  minReaderVersion u16   refuse-to-load floor (a save can demand a minimum build)
  worldSeed        u64
  savedTickIndex   u64
  savedSimTime     f64
  domainSchema[]   { u8 domainId, u16 schemaVersion }   // per-domain payload versions (PS-4)
  chunkManifest[]  { FChunkKey, u8 domainsPresentMask, ... }  // which .ofc files exist + what's in them
  headerCRC        u32   // integrity: a truncated/corrupt header is rejected → falls back to save0.bak
```

- **Phase-1 policy (P1-D5, migration deferred):** on load, `formatVersion` and each `domainSchema.schemaVersion` **must match the running build**, else **refuse to load** with a clear message. We do **not** build migrators yet (out of scope) — but the header *carries every number a future migrator needs* (per-domain versions + a skip-capable record format §5.1). When schemas churn in later phases, the migration machinery slots in at the load boundary (step 1/§4.5) **without a format redesign** — that is the entire point of versioning from day one (PS-4).
- **Two-level versioning** (container `formatVersion` + per-domain `schemaVersion`) means a single domain can bump its payload format **independently** without forcing a container-version bump — the migration burden stays per-domain-owned (persistence.md R2 mitigation).

---

## 6. Interfaces — what persistence consumes + order of operations

### 6.1 Consumed from each domain (the pinned types — no new asks of their *contracts*)

Persistence **consumes existing pinned types**; the only *new* thing each domain must do is **implement `IPersistable`** over them (§2). Nothing about a domain's published Phase-0 contract changes.

| Domain | Consumed (already pinned) | New persistence ask (Wave 2) |
|---|---|---|
| core-engine | `FUniverseCoord`/`FFrameId` (§5.1), `ISimClock` `SimTime/TickIndex` (§5.4), `FFloatingOrigin`, `IFrameGraph`, `ISimProxy` promote/demote (§5.3) | Implement `IPersistable` (CoreEngine, GLOBAL): write/read seed-anchor + observer + time + origin (§2.1). Provide a **save-quiesce tick boundary** (capture all domains at one `TickIndex`). |
| world-gen | `worldSeed` → deterministic regen (WV1), `FQuadKey`, deposit placement (regenerates), `bFromVoxelPatch` seam (empty) | Implement `IPersistable` (WorldGen, CHUNK): **deposit depletion only** — `(depositId, remaining)[]` per region; terrain is NOT saved (§1.2). |
| physics | `FOrbitalElements`, `FVesselOrbitalState` `Mode/DominantFrame` (spike2 §8.2), `FUniverseCoord`+`FVector3d` | Implement `IPersistable` (Physics, GLOBAL): the ~10-double craft conic + Mode + frame (+r,v if active). |
| factory-sim | per-entity SoA records + `TransportLine` contents (spike3 §1–2), **`FRailState`** (§5.2), per-chunk `ISimProxy` (§5.4) | Implement `IPersistable` (FactorySim, CHUNK): full per-entity state (active) **or** `FRailState` (on-rails) per chunk; align chunk granule to `FChunkKey.RegionDepth` (§3). |
| gameplay | inventory/position/progress (gameplay.md §6 — persistence specifies the shape, §2.1) | Implement `IPersistable` (Gameplay, GLOBAL): inventory + avatar position/body/frame/control-mode + objective flags. |

### 6.2 Provided by persistence (outbound)

- **`IPersistable`** — the per-domain serialize/deserialize contract (§2). *(Published here; domains implement in Wave 2.)*
- **`FChunkKey`** + the `truncate(FQuadKey → region)` rule (§3) — how anything maps to a save region.
- **Save/load orchestration + atomic single-slot container** (§4) — `Save(slot)` / `Load(slot)`.
- **Versioned header + the two payload formats** (§5) — `FSaveWriter`/`FSaveReader` cursors handed to each domain.

### 6.3 Order of operations (the load contract, restated tightly)

```
SAVE:  quiesce@tick → header → [CoreEngine, Physics, Gameplay].Save(GLOBAL)
                     → foreach dirty chunk: [WorldGen, FactorySim].Save(chunk) → atomic swap
LOAD:  validate header → CoreEngine.Load(GLOBAL)  [seed+time+frame baseline]
                       → WorldGen regen + Load(chunk)  [terrain free, deposits patched]
                       → Physics.Load(GLOBAL)          [craft]
                       → FactorySim.Load(chunk)        [entities / FRailState]
                       → Gameplay.Load(GLOBAL)         [player placed last]
                       → resume tick
```

---

## 7. Open questions, risks, research

- **R1 (on-rails save fidelity):** retired by reusing factory-sim's `FRailState` + `OnPromote` reconstruction (spike3 G2, bounded by `bufferCaps`, deterministic). Persistence adds no new dupe surface (§4.4).
- **R3 (save size/perf):** slice-scale (hundreds of entities) is trivially small; compression deferred (PS-3/Phase-5). The format reserves a per-chunk compression flag so it's a non-breaking add later.
- **Resolved — chunk granule tuning:** `FChunkKey.RegionDepth` aligns 1:1 with factory-sim's chunk-proxy granule (§3.2). The joint pick with factory-sim + core-engine is now **LOCKED at Forge depth 9 / Cinder depth 8** (factory-sim's confirmed ~1 km chunk extent via CE-9's `floor(log2(R·(π/2)/E))`; locked per PHASE1-PLAN §10, 2026-06-14 — supersedes our earlier ~depth 5–6 proposal).
- **Open — save-quiesce boundary:** persistence needs core-engine to expose a "capture at this tick" handle so all domains snapshot the **same** `TickIndex` (no torn cross-domain read, §4.2 step 1). Flagged to core-engine.
- **Deferred (by scope):** migration machinery (header designed for it — §5.3), server store (Phase 3), compression tuning (Phase 5), voxel-edit diffs (no digging in slice — D-005).

### Research method
One scoped WebSearch thread — *"seed + delta world persistence; chunked save streaming; atomic write; versioned header"*. Confirmed the standard pattern this design follows: a top-level **envelope/header that tells you how to interpret the payload** (PS-4), **store the seed + diffs to reproduce deterministically** (PS-1), **per-chunk region files for streaming** (PS-2), **compact/RLE binary chunk payloads** vs structured meta (PS-3), and **write-temp-then-rename atomic commit** (§4.3). Sources: [Versioned indie save system (migrations, atomic writes)](https://arcadeonstudios.co.uk/blog/a-practical-save-system-for-indie-games-versioned-portable-testable), [Minecraft Java level format (region/chunk files)](https://minecraft.wiki/w/Java_Edition_level_format), [Minecraft world seed (deterministic regen)](https://minecraft.wiki/w/World_seed). No design change resulted — it validated the seed+diff + chunked + versioned-envelope + atomic-rename approach already mandated by PS-1..PS-4.

## 8. References
MASTER_PLAN §9 (seed+diff), D-005 (node mining, no voxel). persistence.md §3 (PS-1..PS-4), §5 (interfaces). Pinned contracts: spike1-core-engine §5 (`FUniverseCoord`/`ISimClock`/`ISimProxy`), spike1-worldgen §1.2–1.3/§4–5 (`FQuadKey`/determinism/deposits/`FBodyParams`), spike2-physics §8.2 (`FVesselOrbitalState`/`FOrbitalElements`), spike3-factory-sim §5 (`FRailState`/`ISimProxy`)/§6 (entity-state). PHASE1-PLAN §2/§5/§6. Web: indie versioned/atomic save systems; Minecraft region-chunk + seed model.
