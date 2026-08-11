# Kerbal × Factorio Crossover — Project Root

**Working title:** *Orbital Foundry* (placeholder — rename freely)
**Genre:** 3D, seamlessly-traversable space + automation game. KSP-style continuous physics & orbital flight fused with Factorio-style factory automation, procedural worlds, power, research, exploration, structures/loot, and multiplayer.

This project is **managed by an agentic development architecture**. Read this file first, then the linked docs, before doing any work.

> ## PROJECT ROOT IS `D:\karbalfactorio`
>
> Moved 2026-08-03 from `C:\Users\reida\Nextcloud\Kerbal Factorio`, which is
> **retired and must not be used**. A sync client was watching `.git` while up to
> six agent lanes wrote to it concurrently, which is a corruption risk; directory
> scans timed out at three minutes, and the drive filled and truncated a source
> file to zero bytes mid-write. **Nothing in this project goes in a sync folder.**
>
> **Remote:** `https://github.com/reidaruss/kerbalfactorio.git`, branch `main`.
> Git plus the remote is the backup now. A pre-rewrite copy of the old `.git`
> sits at `D:\_backup_kerbalfactorio_git_2026-08-03`.
>
> The same move **rewrote history**: `ue/` (the abandoned Unreal attempt) and 132
> pre-fortnight screenshots are stripped from all commits, 743 remain, and the
> blanket `*.png filter=lfs` rule is retired. See §1 of the state-of-the-union.
>
> `node_modules` was not copied. Run `npm ci` in `web/` once.

## Start here (read in this order)
1. **[docs/STATE_OF_THE_UNION.md](docs/STATE_OF_THE_UNION.md) — READ THIS FIRST.** Where everything is, what works, what is blocked and exactly how, the todo list, the lessons from running six parallel agent lanes, and **the orchestration architecture this project now follows**: the top-level session does no implementation, Sonnet lanes take work with a stated cause, Opus lanes take work whose first job is to diagnose.
2. [story_line_outline_v1.txt](story_line_outline_v1.txt) — Reid's progression spine and the answer to "why would a player go anywhere".
3. [docs/web/NUMBERS.md](docs/web/NUMBERS.md) — the process and instrument trap catalogue. Roughly twenty harness defects were found in one week against effectively none in the systems being measured; this file is why that ratio is known. **Binding, not advisory.**
4. [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) — vision, technical architecture, roadmap, scope guardrails, and the D-00x global decision log.
5. [docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md) — the original delegation protocol. **Superseded on orchestration by §6 and §7 of the state-of-the-union where they differ.**
6. [docs/controllers/ADMIN.md](docs/controllers/ADMIN.md) — the admin controller's live project state and dependency map.
7. Your domain's controller file in [docs/controllers/](docs/controllers/).

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
- **This is a working codebase.** The headless engine cores live in `core/` (21 green ctest suites) and the playable UE 5.7 project lives in `ue/` (milestones M2.1 through M5.2 shipped). Design docs and code evolve together; a doc that contradicts the code is a bug.
- **Plan of record:** [docs/review-2026-06-16/RETHINK.md](docs/review-2026-06-16/RETHINK.md) is the current plan (Phase R consolidation, then P progression, then S seam), approved 2026-07-05. It supersedes the MASTER_PLAN roadmap phasing where they differ.
- **PROGRESSION SPINE, written by Reid 2026-08-03:** [story_line_outline_v1.txt](story_line_outline_v1.txt) at the repo root is the storyline and tech-progression order, and it is the answer to "why would a player go anywhere". **Read it before building any player-facing feature.** It names the pre-alpha target: the chain from gathering wood through to docking with the space station and scanning the moon. Four rulings Reid gave alongside it, recorded in Admin's task 39: **the first station mission is hand flown and difficult on purpose** (so burn planning and fine orbital movement get built, and the autopilot moves BEHIND the station visit rather than being research-gated before it); **enemies enter at or on the way to the ruins**; **ruins are a placeable type**, one near spawn now and more scattered later, with exploration incentivised; and **a scan reveals every location but renders nothing**, since the world already streams on approach.
- **Absolute dates** in all docs (today: 2026-07-05).
