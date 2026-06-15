# Kerbal × Factorio Crossover — Project Root

**Working title:** *Orbital Foundry* (placeholder — rename freely)
**Genre:** 3D, seamlessly-traversable space + automation game. KSP-style continuous physics & orbital flight fused with Factorio-style factory automation, procedural worlds, power, research, exploration, structures/loot, and multiplayer.

This project is **managed by an agentic development architecture**. Read this file first, then the linked docs, before doing any work.

## Start here (read in this order)
1. [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) — vision, technical architecture, roadmap, scope guardrails. The design source of truth.
2. [docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md) — how development is delegated across agents; the protocol every agent follows.
3. [docs/controllers/ADMIN.md](docs/controllers/ADMIN.md) — the admin controller's live project state, status dashboard & dependency map.
4. Your domain's controller file in [docs/controllers/](docs/controllers/).

## The agentic model in one paragraph
Work is delegated across **three tiers** to keep any single context window focused. The **Admin Master Controller** (top-level Claude session) owns the global plan, cross-domain interfaces, and integration; it delegates high-level, fully-briefed tasks to **Domain Master Controllers** (one per engineering domain). Each Domain Controller owns a context file, makes decisions within its domain, and spawns **Subagents** for specific scoped tasks. **Detail flows down** (briefs), **summaries flow up** (reports). No agent holds more context than its role requires.

## Controller roster
| # | Domain | Context file | Agent type |
|---|---|---|---|
| 1 | Core Engine & Sim Framework | [core-engine.md](docs/controllers/core-engine.md) | `core-engine-controller` |
| 2 | Rendering & Graphics | [rendering.md](docs/controllers/rendering.md) | `rendering-controller` |
| 3 | Physics & Orbital Mechanics | [physics.md](docs/controllers/physics.md) | `physics-controller` |
| 4 | World Generation & Terrain | [world-gen.md](docs/controllers/world-gen.md) | `world-gen-controller` |
| 5 | Factory & Automation Sim | [factory-sim.md](docs/controllers/factory-sim.md) | `factory-sim-controller` |
| 6 | Networking & Multiplayer | [networking.md](docs/controllers/networking.md) | `networking-controller` |
| 7 | Gameplay, Progression & UI | [gameplay.md](docs/controllers/gameplay.md) | `gameplay-controller` |
| 8 | Persistence & Data | [persistence.md](docs/controllers/persistence.md) | `persistence-controller` |
| 9 | Build, Tooling & Test Infra | [build-tooling.md](docs/controllers/build-tooling.md) | `build-tooling-controller` |

## Working rules
- **Keep context files current.** Any agent that makes a decision or completes work updates its controller file (Decisions log, Status, Subagent log) *before* reporting up. A stale context file is a bug.
- **Detail down, summary up.** Briefs to subagents are exhaustive; reports back are concise.
- **Single source of truth.** Cross-domain facts and decisions live in `MASTER_PLAN.md`; domain detail lives in the controller file. **Link, don't duplicate.**
- **Interfaces are contracts.** A controller may not change a published interface (see each controller's §5) without an Admin-logged decision, because other domains depend on it.
- **Planning repo for now.** No engine/code is committed yet. Code spikes begin only when Admin greenlights them in the roadmap. This repo currently holds design + process.
- **Absolute dates** in all docs (today: 2026-06-14).
