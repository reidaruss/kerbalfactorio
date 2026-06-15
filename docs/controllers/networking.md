# Networking & Multiplayer — Master Controller Context

> **Domain owner:** `networking-controller` · **Reports to:** Admin · **Phase:** 0 · **Status:** Scoping (RC-9 seam validated headlessly) · **Last updated:** 2026-06-15
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md) · [ADMIN](ADMIN.md)
> **Code:** [`core/include/of/net_replication.h`](../../core/include/of/net_replication.h) · [`core/tests/test_net_replication.cpp`](../../core/tests/test_net_replication.cpp) (ctest suite `net_replication_tests`)

## 1. Mission
Make the shared world work for a small co-op group over the internet, given that the physics half is non-deterministic float math. Own server authority, interest management, replication, prediction, and the cross-domain server-authoritative constraint — **even though implementation is late (Phase 3), the constraint binds every domain from day one.**

## 2. Scope & owned subsystems
- **Authoritative server** (or host) — owns canonical world state.
- **Interest management / Area-of-Interest (AOI)** — replicate only what's near each player.
- **Replication** — snapshot interpolation for remote entities; delta compression for factory state.
- **Client prediction & reconciliation** — for the player's own avatar/vessel.
- **Factory delta + local-sim hybrid** — replicate blueprint/config once, sync exceptions; let clients locally simulate deterministic factory chunks.
- **Session/transport, connection, ownership/authority handoff.**
- **MP time-warp policy** (Admin Q1) — likely no-warp / vote-to-warp for v1.
- **Non-goals:** the sims themselves (owned by each domain) — networking *wraps* and *constrains* them.

## 3. Key design decisions
| # | Decision | Rationale | Status | Date |
|---|----------|-----------|--------|------|
| NW-1 | **No deterministic lockstep** (mirrors D-004) | Float physics is non-deterministic across machines | Accepted | 2026-06-14 |
| NW-2 | Authoritative server + AOI replication | Standard for non-deterministic action games; never ship 1M entities to anyone | Accepted | 2026-06-14 |
| NW-3 | Prediction+reconciliation (own avatar/vessel); snapshot interpolation (remote) | Hides latency for the controlled entity | Proposed | 2026-06-14 |
| NW-4 | Factory: replicate config once + exceptions; clients locally sim deterministic chunks | Avoids per-entity bandwidth blowup | **Accepted** (RC-9 validated headlessly — see below) | 2026-06-15 |
| NW-5 | v1: co-op 2–8, no MP time-warp (D-005, Q1) | Sidesteps the hardest design problem for v1 | Accepted | 2026-06-14 |
| NW-6 | **RC-9 confirmed: the `FFactoryDelta` stream keyed by `TickIndex()` (spike3 §6.3) IS a sufficient client-sync seam.** | Proven headless: replicating *inputs* keyed by tick (not per-entity state) reproduces the chunk bit-identically; divergence is hash-detectable; a snapshot re-syncs. Retires R2's "does it work in practice?" for the discrete factory state. | Accepted | 2026-06-15 |

## 4. Architecture & approach
- **Why not Factorio lockstep:** lockstep needs bit-identical sim; our vessel physics use non-deterministic floats. So inputs-only replication is off the table for the *whole* game. (It may still work *locally* per factory chunk — see NW-4.)
- **Server authority + AOI:** the server holds canonical state; each client gets a replicated bubble around its players. Entities far from all players are on-rails (core-engine) and need little/no replication.
- **Player control:** client predicts its own avatar/vessel and reconciles against server corrections; remote entities are interpolated between snapshots.
- **Factory bandwidth:** the expensive part. Replicate the *blueprint/configuration* of a base once; thereafter sync only *exceptions* (jams, inventory queries, placements/removals via the factory-sim delta stream). Steady-state belts are simulated **client-side** from factory-sim's locally-deterministic chunk rules, reconciled periodically. This is the hybrid that recovers most of lockstep's efficiency without global determinism.
- **Time-warp (Q1):** real-time physics can't be warped while another player flies. v1: disable warp in MP or require vote/consensus; distant factories can be *computed forward* analytically on rejoin instead of warped live.

### 4.1 RC-9 replication seam — validated headlessly (2026-06-15)
The factory-delta seam factory-sim pinned (spike3 §6.3: `FFactoryDelta`/`EFactoryEvent` keyed by `ISimClock::TickIndex()`) is networking's **first code**: a headless prototype + tests that prove the two properties the NW-4 hybrid stands on, with **no real sockets** — pure determinism/replication math. Files: `core/include/of/net_replication.h` + `core/tests/test_net_replication.cpp` (consume `factory_sim.h` **read-only**).
- **`StateHash(sim, ChunkView)`** — a deterministic FNV-1a digest over the sim's *observable* discrete state (tickIndex, entityCount, producedCount, per-machine input/output/progress, per-belt transport-line gaps/items/compression, per-network brownout taken as the exact stored Q16). This is the **divergence detector**. Computed purely from existing public getters — **no core change**.
- **`InputEvent` + `DeltaLog`** — the `FFactoryDelta`-style seam: an ordered list of input events stamped with the `TickIndex` they take effect on (ops: `FeedMachine`, `PushBeltTail`, `SetActive`, `AddNetworkDemand` — the intent→mutation surface, spike3 §11.2 C-5). `ApplyInputs(sim, log, tick)` drains a tick's events; `ReplayTo(sim, log, ticks)` is the **client-sims-the-chunk** path.
- **What the 3 tests prove (all green):**
  1. **Local determinism (NW-4):** two independently-built sims + identical inputs hash-match at every checkpoint and on final `producedCount` — confirmed across two different input scripts (not a one-schedule coincidence).
  2. **Replication seam:** a fresh client replaying only the server's `DeltaLog` tracks the server's `StateHash` for **every** tick (300-tick run) — perfect sync from inputs alone, the lockstep-free client-sim (NW-1/NW-4).
  3. **Divergence + re-sync:** drop one input on the client → hashes **diverge at the exact tick** the input was due (detectable); a snapshot re-sync (rebuild client to the authoritative state) → hashes match again (reconciliation path).
- **Verdict (RC-9):** **the delta/`TickIndex` seam is sufficient.** Replicating *inputs* keyed by tick — not per-entity state — reproduces the chunk bit-identically, makes drift cheaply detectable via a state hash, and a snapshot reconciles. This is exactly what NW-4 needs and retires R2's "does chunk-local determinism actually hold in practice" for the **discrete** factory state. **Caveat:** this is the *discrete integer/fixed-point* sim only (the part the spike keeps float-free); the float-physics half of the game stays non-deterministic (NW-1) and is out of scope for this seam. R2's residual is therefore narrowed, not eliminated — see §7.

## 5. Interfaces & dependencies
**Depends on (inbound) — a constraint on every domain:**
- core-engine: server-authoritative `SimClock`, `SimProxy` (what's active vs on-rails per player), deterministic-friendly coord choice (R2 there).
- physics: replicable vessel state (orbital elements cheap to sync; active rigid bodies need snapshots).
- factory-sim: **locally-deterministic chunks** + delta/event stream (NW-4 depends on this).
- world-gen/persistence: seed (clients regenerate the world locally; only diffs sync).
**Provides to (outbound):** the replication layer + ownership/authority API; AOI hints back to rendering/sim for what to load.
**Cross-cutting mandate:** every domain must keep its sim **server-authoritative and replication-friendly** from the start. Retrofitting MP is the most expensive mistake in gamedev — this is why networking has a seat from day one.

## 6. Task backlog / roadmap
- [Phase 0] **Architectural review only:** publish the server-authoritative + locally-deterministic-chunk constraints to all controllers; verify each domain's design honors them. *No netcode yet.*
- [Phase 3] Authoritative server + AOI + prediction; co-op 2–8 vertical slice.
- [Phase 3] Factory config+exception replication using factory-sim's delta stream.
- [Phase 5] Time-warp-in-MP resolution; scale/AOI tuning.

## 7. Open questions & risks
- **R1 (Admin Q1):** MP time-warp — genuinely unsolved-ish (KSP never fully solved it). v1 sidesteps; long-term needs per-player time bubbles or consensus warp.
- **R2 (NARROWED — RC-9, 2026-06-15):** factory chunk local determinism in practice (float creep) — **validated headlessly for the discrete sim** (`net_replication_tests`, §4.1): the factory sim's integer/fixed-point hot path is bit-identical across runs and a delta-replay client stays perfectly in sync, so no fixed-point retrofit of the *factory* sim is needed for the discrete state. Residual: this is the spike's synthetic, fully-deterministic chunk; the property must be re-checked when (a) chunk-sharding/parallelism lands (factory-sim §1.4 — order must stay shard-fixed) and (b) on a real recipe graph. The float-physics half stays non-deterministic by design (NW-1).
- **R3:** bandwidth for active multi-part vessel physics under AOI when several players fly near each other.

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| 2026-06-15 | RC-9 replication-seam prototype + tests (headless, no sockets): `net_replication.h` + `test_net_replication.cpp` validating chunk-local determinism + delta-replay client sync + divergence/re-sync. | Done | `net_replication_tests` green; 9/9 ctest suites pass. Verdict: the `FFactoryDelta`/`TickIndex` seam is sufficient (NW-4/NW-6 accepted, R2 narrowed). |

## 9. References
MASTER_PLAN §6 (networking), D-004/D-005, Admin Q1. Factorio deterministic lockstep (why it works / why we can't); standard authoritative-server + client-prediction + snapshot-interpolation literature. **RC-9 seam:** [spike3-factory-sim §6.3](../spikes/spike3-factory-sim.md#sec-stream) (`FFactoryDelta`/`EFactoryEvent` keyed by `TickIndex`) + §11.2 (C-5 intent→mutation map) — implemented/validated in `core/include/of/net_replication.h` + `core/tests/test_net_replication.cpp`.
