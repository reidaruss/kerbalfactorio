# Agent Architecture — Development Delegation Protocol

> **Status:** Living process document · **Owner:** Admin Master Controller · **Last updated:** 2026-06-14
> Defines *how* this project is built across agents. Every agent reads this before acting.

---

## 1. Why this exists

A KSP×Factorio crossover spans many deep, specialized domains (see [MASTER_PLAN](MASTER_PLAN.md)). No single context window can hold the whole design *and* make progress in one domain without thrashing. So development is **delegated across a tree of agents**, each holding only the context its role requires. The file structure *is* the context-management strategy.

**Prime directive: minimize context per agent.** Detail flows **down** as briefs; results flow **up** as summaries. Persistent knowledge lives in **files**, not in any agent's head.

---

## 2. The three tiers

### Tier 0 — Admin Master Controller (you, the top session)
- Owns: the global plan, cross-domain interfaces, the dependency graph, integration milestones, and the global decision log.
- Does **not** hold domain implementation detail. When a domain question arises, it delegates to that domain's controller.
- Maintains: [MASTER_PLAN.md](MASTER_PLAN.md) and [controllers/ADMIN.md](controllers/ADMIN.md).
- Spawns: Domain Master Controllers.

### Tier 1 — Domain Master Controllers (one per domain)
- Own: all design + decisions within their domain; their context file; the interfaces they publish to other domains.
- Receive: a **Task Brief** from Admin (§4). Return: a **Completion Report** (§4).
- Maintain: their `controllers/<domain>.md` file — kept current *before* reporting up.
- Spawn: Subagents for specific scoped tasks.
- **Never** silently change a published interface — that requires an escalation to Admin (§6).

### Tier 2 — Subagents (ephemeral, task-scoped)
- Own: one concrete task (research a technique, draft a spec section, prototype a function, evaluate a library).
- Receive: a tightly-scoped brief + pointers to the exact files/sections they need.
- Return: a concise result the controller folds into its context file.
- Hold **no** long-term state; they vanish after the task. Anything worth keeping is written to the controller file by the controller.

```
Admin ──brief──▶ Domain Controller ──brief──▶ Subagent
  ▲                    │                          │
  └──report (summary)──┘◀──────report (result)────┘
```

---

## 3. Controller roster & invocation

| Domain | Context file | Agent type (`subagent_type`) |
|---|---|---|
| Core Engine & Sim Framework | [core-engine.md](controllers/core-engine.md) | `core-engine-controller` |
| Rendering & Graphics | [rendering.md](controllers/rendering.md) | `rendering-controller` |
| Physics & Orbital Mechanics | [physics.md](controllers/physics.md) | `physics-controller` |
| World Generation & Terrain | [world-gen.md](controllers/world-gen.md) | `world-gen-controller` |
| Factory & Automation Sim | [factory-sim.md](controllers/factory-sim.md) | `factory-sim-controller` |
| Networking & Multiplayer | [networking.md](controllers/networking.md) | `networking-controller` |
| Gameplay, Progression & UI | [gameplay.md](controllers/gameplay.md) | `gameplay-controller` |
| Persistence & Data | [persistence.md](controllers/persistence.md) | `persistence-controller` |

Agent definitions live in [.claude/agents/](../.claude/agents/). Admin invokes a controller with the **Agent** tool (`subagent_type: "<name>"`). The first line of every controller brief is: *"Read docs/AGENT_ARCHITECTURE.md and docs/controllers/<your-domain>.md, then proceed."* Controllers spawn Subagents the same way (default `general-purpose` or `Explore` type).

---

## 4. The two message formats

### 4.1 Task Brief (downward — Admin→Controller, Controller→Subagent)
Every delegation includes, explicitly:
```
GOAL:        one sentence — the outcome wanted.
CONTEXT:     why now, what changed, what depends on this.
INPUTS:      exact files/sections/decisions to read (links, not prose dumps).
CONSTRAINTS: decisions already locked (cite IDs), scope limits, non-goals.
INTERFACES:  any cross-domain contract this must honor or produce.
DELIVERABLE: the precise artifact expected (a spec section? a decision? a prototype?).
DONE WHEN:   acceptance criteria.
```
A brief should let the receiver work **without** re-reading the whole project. Point them at the *specific* sections they need.

### 4.2 Completion Report (upward — Subagent→Controller, Controller→Admin)
```
RESULT:       what was produced (link to the file/section, don't paste it all).
DECISIONS:    any decisions made + rationale (also logged in the context file).
INTERFACES:   any interface created/changed (flag loudly — Admin tracks these).
DEPENDENCIES: new needs discovered from other domains.
RISKS/OPEN:   unresolved questions, risks, assumptions.
NEXT:         recommended next step.
```
Keep it short. The detail lives in the updated context file; the report is the pointer + the deltas.

---

## 5. Context file discipline

Each controller file follows the **same template** (see any `controllers/<domain>.md`):
1. Header (status, last-updated) · 2. Mission · 3. Scope & owned subsystems (+ non-goals) · 4. Key design decisions (table) · 5. Architecture & approach · 6. **Interfaces & dependencies** (the contracts) · 7. Task backlog / roadmap · 8. Open questions & risks · 9. Subagent delegation log · 10. References.

Rules:
- **Update before reporting up.** The file is the durable memory; the report is transient.
- **Decisions are logged with rationale + date + status** (Proposed / Accepted / Superseded). Never delete a superseded decision — mark it.
- **Link, don't duplicate.** Cross-domain facts live in MASTER_PLAN; reference them by section/decision ID.
- **Keep it skimmable.** A controller file is a working memory, not an essay. Prune resolved noise into terse history.
- **Last-updated date** is bumped on every edit.

---

## 6. Interfaces, contracts & escalation

The dependency graph ([MASTER_PLAN §5.3](MASTER_PLAN.md#53-dependency-graph-who-depends-on-whom)) means domains are coupled through **interfaces** — each controller's §6 publishes what it *provides* and what it *depends on*. Examples of contracts: the coordinate/frame API (core-engine → all), the terrain height/collision query (world-gen → physics/rendering), the factory entity-state stream (factory-sim → rendering/persistence/networking).

- A controller **owns** its published interfaces and may evolve them, but a **breaking change** must be escalated to Admin, who logs it in MASTER_PLAN §11 and notifies affected controllers.
- When two domains disagree on a contract, **Admin arbitrates** — that is Admin's primary job.
- Discovering a *missing* interface is a normal Completion-Report item ("DEPENDENCIES: I need a `SampleTerrainHeight(lat,lon)` from world-gen").

---

## 7. Status vocabulary (use consistently)

- **Not started · Scoping · In progress · Blocked · In review · Done · Deferred.**
- A **Blocked** item must name its blocker (another domain, a decision, a greenlight).
- Phase tags match MASTER_PLAN §8 (Phase 0–5).

---

## 8. Context-window economy — practical rules

1. **Read narrow.** Briefs point to exact sections. Don't read the whole repo to do one task.
2. **Write durable.** Anything learned that matters later goes in a context file immediately.
3. **Summarize up, never paste up.** Reports are pointers + deltas.
4. **One domain per controller session.** Don't let a controller drift into another domain — delegate across instead (via Admin if it crosses an interface).
5. **Subagents are cheap and disposable.** Prefer spawning a fresh scoped subagent over bloating a controller's context with a side quest.
6. **Prune.** Resolved questions and dead options get compressed to a one-line history note.
