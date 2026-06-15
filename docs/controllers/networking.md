# Networking & Multiplayer — Master Controller Context

> **Domain owner:** `networking-controller` · **Reports to:** Admin · **Phase:** 0 · **Status:** Scoping · **Last updated:** 2026-06-14
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md) · [ADMIN](ADMIN.md)

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
| NW-4 | Factory: replicate config once + exceptions; clients locally sim deterministic chunks | Avoids per-entity bandwidth blowup | Proposed | 2026-06-14 |
| NW-5 | v1: co-op 2–8, no MP time-warp (D-005, Q1) | Sidesteps the hardest design problem for v1 | Accepted | 2026-06-14 |

## 4. Architecture & approach
- **Why not Factorio lockstep:** lockstep needs bit-identical sim; our vessel physics use non-deterministic floats. So inputs-only replication is off the table for the *whole* game. (It may still work *locally* per factory chunk — see NW-4.)
- **Server authority + AOI:** the server holds canonical state; each client gets a replicated bubble around its players. Entities far from all players are on-rails (core-engine) and need little/no replication.
- **Player control:** client predicts its own avatar/vessel and reconciles against server corrections; remote entities are interpolated between snapshots.
- **Factory bandwidth:** the expensive part. Replicate the *blueprint/configuration* of a base once; thereafter sync only *exceptions* (jams, inventory queries, placements/removals via the factory-sim delta stream). Steady-state belts are simulated **client-side** from factory-sim's locally-deterministic chunk rules, reconciled periodically. This is the hybrid that recovers most of lockstep's efficiency without global determinism.
- **Time-warp (Q1):** real-time physics can't be warped while another player flies. v1: disable warp in MP or require vote/consensus; distant factories can be *computed forward* analytically on rejoin instead of warped live.

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
- **R2:** factory chunk local determinism in practice (float creep) — may need fixed-point in the factory sim specifically even if physics stays float.
- **R3:** bandwidth for active multi-part vessel physics under AOI when several players fly near each other.

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| — | *(none yet)* | — | — |

## 9. References
MASTER_PLAN §6 (networking), D-004/D-005, Admin Q1. Factorio deterministic lockstep (why it works / why we can't); standard authoritative-server + client-prediction + snapshot-interpolation literature.
