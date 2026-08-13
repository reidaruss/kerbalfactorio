# Master Plan — Orbital Foundry (working title)

> **Status:** Living design document · **Owner:** Admin Master Controller · **Last updated:** 2026-07-05 (R5 docs re-sync)
> **Plan of record for current work:** [review-2026-06-16/RETHINK.md](review-2026-06-16/RETHINK.md) (Phase R consolidation, then P, then S; approved by Reid 2026-07-05). §8 below records the roadmap status; the vision sections (§1 to §7, §9, §10) stand unchanged.
> This is the cross-domain source of truth. Domain detail lives in [controllers/](controllers/). Process lives in [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md).

---

## 1. Vision & pillars

A 3D game that fuses the two hardest-to-engineer indie games ever shipped:

- **KSP** — continuous, seamless, physics-driven flight from a planet's surface to orbit to another world, with no loading screens or "zone gates."
- **Factorio** — deep resource extraction, belts/automation, power management, research trees, all at scale.

Plus **procedural worlds, exploration/loot, a questline, and multiplayer.**

**Design pillars (in priority order):**
1. **Seamless traversal.** Surface → orbit → interplanetary → another surface, continuous. No loading screens.
2. **Real automation depth.** Mining → refining → assembly → power → logistics, Factorio-grade, in 3D.
3. **Physical credibility.** Orbits, thrust, and structures obey believable physics (KSP-grade, not necessarily NASA-grade).
4. **Progression & exploration.** Research trees, procedural POIs/loot, a guiding questline that pushes you off-world.
5. **Co-op multiplayer.** Shared persistent worlds for a small group of players.

**Perspective:** First- or third-person on-foot/in-vehicle (decision deferred to [gameplay](controllers/gameplay.md) + [rendering](controllers/rendering.md); leaning first-person on foot, third-person/IVA in vehicles).

---

## 2. The core technical tension (read this before anything else)

KSP and Factorio are optimized for **opposite** things. This conflict drives nearly every architectural decision.

| | KSP | Factorio |
|---|---|---|
| Precision | 64-bit doubles, planetary scale | 32-bit / fixed-point, small grid |
| Entity count | A handful of vessels matter at once | 1,000,000+ active entities |
| Sim model | Continuous floating-point physics | Deterministic integer lockstep |
| Time | Time-warp / analytic on-rails propagation | Fixed 60 UPS |
| Networking | Barely multiplayer (*because* float physics) | Flawless MP (*because* deterministic) |

**Key consequence:** Factorio's multiplayer works via **deterministic lockstep** — every client runs an identical sim, only *inputs* cross the wire, and floating-point is banned from the sim. KSP's continuous flight is **non-deterministic float physics**. **You cannot have both at full scale in one simulation.** We therefore do **not** attempt a million-entity deterministic factory *and* continuous float physics in lockstep. See §3 for how we sidestep this, and [networking](controllers/networking.md) for the netcode consequences.

---

## 3. The unifying principle: "Active" vs. "On-Rails"

KSP's real trick is not physics — it is that **only the active vessel gets full physics**; everything else is "on rails," propagated analytically. **We generalize this to the entire game, including the factory.**

- **Active zone** (near a player): full per-entity simulation — rigid-body vehicle physics, per-item belt sim, per-machine crafting ticks.
- **On-rails zone** (far / unloaded / time-warped): abstracted models. A vessel becomes an orbit equation. A distant factory becomes a **production-rate model** ("consumes X iron/s, produces Y gears/s"), not a million simulated items.

This single principle is what makes the whole concept tractable: Factorio-scale *bases* without Factorio-scale *active simulation everywhere at once*. It is owned jointly by [core-engine](controllers/core-engine.md) (the framework) and applied by [physics](controllers/physics.md) and [factory-sim](controllers/factory-sim.md).

---

## 4. Engine & tech stack decision

**Recommended starting point: Unreal Engine 5.** Decisive factor: UE5 has **native Large World Coordinates (double-precision world positions)**, which solves KSP's single hardest problem out of the box. Plus Nanite/Lumen for dense factory rendering and **Mass Entity** (ECS) for factory-scale simulation.

Alternatives considered:
- **Unity + DOTS/ECS** — what KSP used; strongest "Factorio-in-an-engine" ECS path; but double precision is bolt-on and fights planetary scale.
- **Custom engine** — what Factorio & Dyson Sphere Program did; maximum control over the sim/render split (the reason they scale); multi-year prerequisite before there's a game.

> **DECISION D-001 (provisional):** Prototype in UE5. The factory simulation is treated as a *semi-custom data-oriented subsystem* running inside Mass Entity, not vanilla Actors. Revisit after the Phase-0 spikes. Owner: [core-engine](controllers/core-engine.md). See decision log §11.

---

## 5. System architecture

### 5.1 Layered model
```
┌──────────────────────────────────────────────────────────────┐
│  Gameplay / Progression / UI   (research, quests, loot, HUD)  │
├──────────────────────────────────────────────────────────────┤
│  Factory & Automation Sim      (belts, machines, power)       │
│  Physics & Orbital Mechanics   (patched conics, rigid bodies) │
│  World Generation & Terrain    (cubed-sphere LOD, deposits)   │
├──────────────────────────────────────────────────────────────┤
│  Rendering & Graphics          (scaled space, LOD, shaders)   │
├──────────────────────────────────────────────────────────────┤
│  Core Engine & Sim Framework   (coords, floating origin,      │
│                                 active/on-rails, tick, frames)│
├──────────────────────────────────────────────────────────────┤
│  Persistence & Data            (seed+diff, streaming, saves)  │
├──────────────────────────────────────────────────────────────┤
│  Networking & Multiplayer      (cross-cutting: wraps all sim) │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Domain ownership → controller files
| Domain | Owns | Controller |
|---|---|---|
| Core Engine & Sim Framework | 64-bit coords, floating origin, reference frames, active/on-rails framework, tick loop, time-warp, ECS foundation | [core-engine.md](controllers/core-engine.md) |
| Rendering & Graphics | scaled space, dual cameras, log depth, LOD, terrain render, GPU instancing, atmospheric scattering, materials/VFX | [rendering.md](controllers/rendering.md) |
| Physics & Orbital Mechanics | patched conics, orbital propagation, rigid-body vessels, surface/character physics, collision, SOI transitions | [physics.md](controllers/physics.md) |
| World Generation & Terrain | procedural planet gen, biomes, noise, deposit placement, voxel deformation patches, POI placement | [world-gen.md](controllers/world-gen.md) |
| Factory & Automation Sim | data-oriented factory sim, belts/inserters/machines, recipes, power network, on-rails factory abstraction | [factory-sim.md](controllers/factory-sim.md) |
| Networking & Multiplayer | authoritative server, interest management, replication, prediction/reconciliation, factory delta compression, MP time-warp | [networking.md](controllers/networking.md) |
| Gameplay, Progression & UI | research tree, quests, loot, exploration/science, structures, inventory, build UX, HUD, map view | [gameplay.md](controllers/gameplay.md) |
| Persistence & Data | seed+diff save model, chunked streaming, serialization, world DB, versioning/migration | [persistence.md](controllers/persistence.md) |
| Build, Tooling & Test Infra *(added 2026-06-14)* | version control, UE5 toolchain, the headless test harness, CI, asset pipeline | [build-tooling.md](controllers/build-tooling.md) |

### 5.3 Dependency graph (who depends on whom)
- **core-engine** → foundational; *everyone* depends on it (coords, frames, tick, active/on-rails).
- **world-gen** → feeds rendering (meshes), physics (collision), factory-sim (build surfaces, deposits), gameplay (POIs), persistence (seed).
- **physics** → depends on core-engine (frames) + world-gen (terrain collision); feeds rendering (transforms).
- **factory-sim** → depends on core-engine (active/on-rails, tick) + world-gen (placement, deposits); feeds rendering, persistence, gameplay.
- **rendering** → depends on core-engine (origin/frames), world-gen, physics, factory-sim.
- **gameplay** → depends on factory-sim (research/recipes), world-gen (content), persistence (progress).
- **persistence** → depends on world-gen (seed), factory-sim (state), gameplay (progress).
- **networking** → **cross-cutting**; wraps all sim; requires server-authoritative design from every domain. Treated as a first-class constraint from day one even though it is *implemented* late (§8).

---

## 6. Subsystem summaries

> Brief here; full technical detail in each controller file. Link, don't duplicate.

- **Coordinate system & seamless "magic"** — 64-bit universe coords in a reference-frame hierarchy; **floating origin** (move the universe, not the player) so GPU/physics only see near-origin floats; **scaled space** dual-camera trick for distant bodies; **log/cascaded depth buffer**; quadtree streaming LOD; **atmospheric scattering** for the surface→space visual sell. → [core-engine](controllers/core-engine.md) + [rendering](controllers/rendering.md).
- **Orbital mechanics** — **patched conics, not n-body** (analytically propagatable → time-warp works, orbits stable, cheap, deterministic). Full rigid-body physics only for the active vessel + nearby; everything else on rails. → [physics](controllers/physics.md).
- **Terrain** — cubed-sphere quadtree (KSP PQS-style) heightmap for the bulk planet; **voxel/SDF patches only where players dig** to keep the cheap heightmap for the untouched 99.9%. v1 may ship node-based mining with no deformation. → [world-gen](controllers/world-gen.md).
- **Factory** — data-oriented ECS (not Actors), **update-on-demand / sleeping entities**, **belt compression**, GPU instancing + LOD for the *render* wall (every 3D item is a mesh — naive = GPU death), and on-rails abstraction for distant bases. → [factory-sim](controllers/factory-sim.md).
- **Power** — Factorio's graph model: per-network sum generation vs consumption, brownout (proportional scale-down) on deficit. **Solar output = f(day/night, distance from star, atmosphere)** — ties power to the orbital sim. → [factory-sim](controllers/factory-sim.md).
- **Persistence** — **universe = seed** (regenerates identically); **player changes = diffs** vs the procedural baseline; chunked + streamed; custom binary for factory state at scale. → [persistence](controllers/persistence.md).
- **Networking** — Factorio lockstep is impossible here (non-deterministic float physics). Use **authoritative server + area-of-interest replication + client prediction/reconciliation + snapshot interpolation + factory delta compression**. **MP time-warp is a known-hard, unsolved-ish design problem** — flagged early. → [networking](controllers/networking.md).
- **Progression** — Factorio-style research (factory produces science → unlocks); KSP-style science from biomes/anomalies; loot from procedural ruins; a lightweight questline threading planets together. → [gameplay](controllers/gameplay.md).

---

## 7. Reference games — what to steal

| Game | Steal this | Limitation they accepted |
|---|---|---|
| **KSP** | Patched conics, floating origin, scaled space, active-vessel physics, science system | MP barely exists — float physics is why |
| **Factorio** | ECS data layout, update-on-demand, belt compression, power-graph, deterministic sim | 2D, fixed grid — that's how it hits 1M entities |
| **Dyson Sphere Program** | "Factorio in space" proof; interplanetary logistics; distance-based factory abstraction | Planets fixed; travel is a short scripted flight, **not** KSP physics — a deliberate, instructive scope cut |
| **Astroneer** | Deformable voxel terrain + seamless planet↔space + co-op together | Small factories, low entity counts |
| **Space Engineers** | Voxel planets + grid-built physics ships + MP | Heavy; struggles with scale/netcode |
| **No Man's Sky** | Seamless planet↔space at galaxy scale, MP, procedural gen | Shallow automation |
| **Satisfactory** | First-person 3D factory in UE at real scale | Single planet, no orbit |

**Lesson:** DSP and Astroneer both made the cut we should consider — none of them attempted continuous KSP-grade traversal **and** million-entity factories **and** deformable terrain **and** MP at once. Each picked a subset. So do we (§9).

---

## 8. Development roadmap

Build **vertical slices that retire the riskiest tech first.** No content before the hard tech is proven.

**Phase 0 — Tech spikes (prove the scary stuff in isolation):**
1. Floating-origin + scaled-space: walk a planet, fly to orbit, land on a moon — seamless, single-player, placeholder art. *If this fails, nothing else matters.* → core-engine + rendering.
2. Patched-conics propagation + one rigid-body craft. → physics.
3. 100k-entity belt/factory sim at 60 UPS in isolation. → factory-sim.

**Phase 1 — Single-player vertical slice:** one planet + one moon, node-based mining (no voxel), basic belts/assemblers/power, manual flight between bodies. Integrate the spikes. Proves the *fusion feels good*.

**Phase 2 — Depth:** research tree, more recipes, automated mining, the active/on-rails factory abstraction, persistence (seed + diffs).

**Phase 3 — Networking:** co-op (2–8 players), authoritative-server model. *Architecturally present since Phase 0; implemented here.*

**Phase 4 — Content & systems:** voxel digging (if pursued), POIs/loot, questline, more planets, atmospheric/visual polish.

**Phase 5 — Scale & optimization:** push factory entity counts, interest-management tuning, MP time-warp resolution.

### 8.1 Roadmap status (re-synced to reality, 2026-07-05)

The original phase ladder above is kept for the record, but development did not follow it linearly. What actually happened:

- **Phase 0 + the headless Phase-1 logic: DONE.** All four Wave-0 cores plus integration, gameplay, persistence, research, networking seam, automation, deform, and voxel logic are built and green: **21 ctest suites** (the once-reported "2 failures" were a PATH/DLL environment artifact, root-caused in [review-2026-06-16/core-docs-audit.md](review-2026-06-16/core-docs-audit.md) Task A).
- **The UE game shipped a ground-first survival/automation slice** (direction pivot, see D-007). Milestones, one line each:
  - **M2.1** first in-engine terrain render (Forge + Cinder from `generateQuadMesh`, scaled preview).
  - **M2.2** the full flight spine (Forge → orbit → SOI transfer → Cinder landing) rendered in-engine in scaled space.
  - **M2.3** factory rendered live from the FS-14 emission stream (render-wall collapse proven).
  - **M2.5–M2.9** survival-crafting shell: inventory, crafting, menus, dropped items, tools in hand.
  - **M3.0–M3.1b** graphics/atmosphere pass (Lumen re-enabled, textured PBR) + first-person view-model; Fab/Megascans import found to be UI-only.
  - **M3.2** Factorio automation in-world: running auto-line + player build-and-place.
  - **M4.0** player walks the real streamed 1:1 procedural planet (floating origin, 99 rebases / 180 km, no jitter).
  - **M4.1** polished planet surface + harvestable biome deposits.
  - **M4.2** level-ground FrameRot fix + real Megascans textures wired in.
  - **M4.3** solid PMC collision ground + physical smooth walking (see D-010).
  - **M4.4** harvest nodes grounded + stable id-keyed streaming.
  - **M4.5** sprint + nodes perpendicular to / emerging from the ground.
  - **M4.6** Valheim-style destructive digging + drilling miners (heightfield deform).
  - **M5.0** world building grid: snap placement + visible grid + edge-to-edge connection.
  - **M5.1** biome foliage scatter (the planet is alive with Fab trees/shrubs/grass/boulders).
  - **M5.2** true 1 m³ voxel tunneling (dig down then sideways, walk in) + voxel miners + edit persistence.
- **Not yet built:** the seamless surface↔orbit seam in-engine (RN-1 scaled space over the 1:1 planet), research wired into UE play, placement costs/real power, a unified UE save.

> **Current phase: Phase R, Consolidation** (per [RETHINK.md](review-2026-06-16/RETHINK.md) §4, approved 2026-07-05), then **Phase P** (a game, not a sandbox: research wiring, costs/power, the launch-pad objective), then **Phase S** (the namesake surface↔orbit seam). See [ADMIN.md](controllers/ADMIN.md) for live status.

---

## 9. Scope guardrails (v1 cuts — loosen later)

Each pillar has individually consumed *years* from talented teams. To stay shippable rather than a forever-prototype, v1 adopts these cuts:
- **Node-based mining, not voxel deformation** (add digging in Phase 4 if at all).
- **Co-op (2–8), not massive MP.**
- **Thousands of active entities per loaded area, not a million** — lean on on-rails abstraction for the rest.
- **One planet + one moon**, not a full solar system.
- **Patched conics, never n-body.**
- **No time-warp in MP for v1** (or vote-to-warp), pending the hard design problem.

The through-line that makes all of it tractable is the **active vs. on-rails principle (§3)** generalized from vessels to factories. The floating-origin/scaled-space spike must work first — highest risk, and it proves the premise is even possible.

---

## 10. Glossary

- **Active / on-rails** — fully-simulated vs analytically-propagated entities. The core scalability lever (§3).
- **Floating origin** — keep the player near (0,0,0) and move the universe; avoids float precision loss at planetary scale.
- **Scaled space** — distant bodies rendered small by a second camera at huge scale, swapped for real terrain on approach (KSP technique).
- **Patched conics** — two-body orbital model that switches dominant body at sphere-of-influence (SOI) boundaries.
- **SOI** — sphere of influence; the region where one body dominates gravity.
- **PQS** — Procedural Quad Sphere; KSP's cubed-sphere quadtree terrain LOD.
- **Brownout** — proportional power scale-down when demand exceeds supply (Factorio model).
- **Seed+diff** — persistence model: regenerate the world from a seed, store only player modifications.
- **Interest management / AOI** — replicating only entities near each player.
- **UPS / FPS** — updates (sim) per second / frames (render) per second; decoupled.

---

## 11. Global decision log

| ID | Date | Decision | Rationale | Status | Owner |
|----|------|----------|-----------|--------|-------|
| D-001 | 2026-06-14 | Prototype in **Unreal Engine 5** | Native double-precision world coords solves KSP-scale; Nanite + Mass Entity help factory render/sim | Provisional (revisit post-Phase-0) | core-engine |
| D-002 | 2026-06-14 | **Patched conics**, not n-body | Time-warp + stable orbits + cheap + deterministic | Accepted | physics |
| D-003 | 2026-06-14 | Generalize **active/on-rails** to the factory, not just vessels | Only tractable path to Factorio-scale bases without Factorio-scale active sim | Accepted | core-engine |
| D-004 | 2026-06-14 | **No deterministic lockstep**; authoritative server + AOI replication | Float physics is non-deterministic across machines | Accepted | networking |
| D-005 | 2026-06-14 | v1 = **node-based mining, 1 planet + 1 moon, co-op 2–8** | Scope control; ship a vertical slice before scaling | Accepted | gameplay/admin |
| D-006 | 2026-06-14 | **Single canonical Body Definition** for all physical body constants (radius, μ, surface g, SOI radius, rotation, atmosphere profile). One shared data asset: core-engine owns schema + load and exposes via `FReferenceFrame`; world-gen `FBodyParams`, physics, and rendering all *consume* it — no domain hardcodes its own copy. v1 adopts world-gen's proposed values: **Forge** (planet, R=600 km, g≈9.81 m/s², atmo scale-height ≈5.6 km) · **Cinder** (moon, R=200 km, g≈1.63 m/s², airless). | Resolves Spike-1 R4: world-gen and core-engine both carried body constants; duplication risks divergence (g = μ/r² must stay consistent) | Accepted | core-engine (loader) + world-gen (terrain/atmo) |
| D-007 | 2026-06-15 to 2026-06-16 | **Ground-first direction pivot** (user-directed): build the walkable-planet survival/automation game first (M4.x/M5.x); the orbital half stays headless + demo-rendered until Phase S | Reid steered the slice toward the on-foot ground game; it proved the floating-origin spine and the fusion feel | Accepted | admin/gameplay |
| D-008 | 2026-06-16, logged 2026-07-05 | **Voxel terraforming NOW**: 1 m³ voxel tunneling shipped in Phase 1 (M5.2, WG-20). Supersedes the "no voxel until Phase 4" timing in D-005 and Q4 (the D-005 scope line is otherwise intact) | Digging proved core to the ground-game fantasy; the seam world-gen kept open (Q4) absorbed it | Accepted (retro-logged; was an unlogged inversion) | world-gen + rendering |
| D-009 | logged 2026-07-05 | **Terrain meshes = `UProceduralMeshComponent` in practice.** RN-5's RealtimeMesh was never adopted; every shipped mesh path (chunks, voxel near-field, factory visuals) is PMC | Engineering reality, not a design choice; PMC was sufficient to ship M2.1 through M5.2. Revisit for perf (RealtimeMesh or equivalent) if PMC becomes the bottleneck | Accepted (supersedes RN-5's mesh-library clause) | rendering |
| D-010 | 2026-06-16, logged 2026-07-05 | **Cooked PMC collision for the near-field**: chunk + voxel meshes cook complex-as-simple collision and the character physically stands on it (M4.3/M5.2). Supersedes PH-5's analytic-only stance for the character near-field; the vessel path stays analytic | The float/teleport bugs died the day the capsule got real geometry to stand on | Accepted (retro-logged; was an unlogged reversal) | physics + rendering |
| D-011 | 2026-07-05 | **Single surface authority** (WG-21 / RETHINK R1): one `/core` `SurfaceField` oracle, `height = designed − voxelLowering` with one bedrock clamp; voxel solidity derived from the same function; `terrain_deform` demoted to a derived view; every consumer reads the oracle | The audits proved five surface definitions caused every floating/air-gap bug; one truth removes the whole hack family | Accepted, **in flight (R1)** | world-gen (core) + rendering (consumers) |
| D-012 | 2026-07-05 | **Repo LFS surgery DONE** (RETHINK R3, BT-7/BT-8): `git lfs migrate` over `ue/Content` history, vendor demo maps untracked, done before any remote existed | 2.55 GB of binary history was a one-way door closing; cheapest possible day to fix it | Accepted, executed | build-tooling |
| D-013 | 2026-07-05 | **R → P → S roadmap approved by Reid**: Phase R consolidation (no new features) → Phase P progression (research/costs/objective) → Phase S seam (RN-1 scaled space, boardable vessel). SurvivalTest demoted to a regression-only map; repo surgery greenlit | Reid approved all three decisions requested in [RETHINK.md](review-2026-06-16/RETHINK.md) §6 | Accepted | admin |
| D-014 | 2026-08-03 | **An orbiting thing is genuinely in orbit. There is no second, static copy of where it is.** Settles physics R67 (Anchorage held frozen in the body frame) and R70 (`sim_world.h` holding Cinder as a static frame offset) as one ruling, because they are one question. The near-scene pose is driven by the record; the static offset is the copy that goes. **Consequence, accepted deliberately: `KinematicBody.step` integrates an absolute position with no notion of the frame it rides in, so standing on a moving surface needs a carrier term.** Not opened yet: Reid's near-term tests are to *orbit* the moon and *dock* at the station, and neither requires standing on a moving surface. Landing does, and landing is his stated "later" | Both instances existed twice and the two copies disagreed. Nothing noticed while only one consumer touched each; the first thing to touch both was the autopilot, which saw a stationary station being passed at orbital speed. **Correction logged 2026-08-03 (core-engine R12): the speed stated in this entry's original wording, and in `SpaceStation.ts` and physics R67, was 7.6 km/s. Anchorage's real orbital speed is 1879.26 m/s, 31.32 m per tick. Forge's mu is 3.5316e12; 7.5 km/s is Earth's low orbit. The figure was 4.05x out and survived because it is plausible by size, which is `NUMBERS.md`'s own rule pointed at a number nobody thought to check. Every conclusion in this decision is unchanged.** Two authorities for one quantity is the failure this project paid for three times in one night (the station existing twice, `circularAbout` and `circular80km` running in opposite senses, `MapBoot` running a second body-id convention). PH-90's freeze was correct for the problem it faced and documented itself out loud, which is why it was found in minutes. Physics made this settleable rather than urgent by phasing `cinderStateAt` so `t = 0` is bit-exactly the old static offset, so no number was invented on either side | Accepted | admin (ruling) · physics + core-engine (carrier term, held) |
| D-015 | 2026-08-03 | **A docking port is a part instance in a design, not a special case attached to the station.** `mintStation` gives Anchorage a real design containing a `DockingPort` rather than `emptyDesign()`. The rule is uniform: a vessel can dock if its design contains a port. **"Automatically dock" means full auto-approach, not capture-on-contact**, and ships in two layers: capture is the mechanism and is needed for manual docking too, auto-approach is the autopilot program that drives to it. Ownership: physics owns the capture test, the join and the approach program; gameplay owns part availability, the research gate and the UI; persistence must be told the save shape changes when two vessels become one | Reid drew the distinction himself: *"For destinations with a docking mechanism it should automatically dock. Otherwise it should just rendezvous."* If dock meant latching on contact, the autopilot would stop at rendezvous and the player would fly the last hundred metres, which is what he contrasted it with. Reid has also signalled he wants player-built stations; under a special-cased station every player station is a new exception, and under a part instance they dock for free. It also makes `transfer.h`'s `dockingRadiusM > 0` read off the design rather than a hardcoded table, which is what that field's own comment already assumed | Accepted | admin (ruling) · physics + gameplay |
| D-016 | 2026-08-10 | **Albedo colour-space fix approved.** The sRGB/linear compensation defect (state-of-the-union §4d: `surfaces.json` publishes `albedo_mean` in sRGB, `Surfaces.apply` divides it out in linear, under-compensating 2.13x on machine panel and 2.36x on rock) is fixed at the root. Every textured surface gets brighter; assets are then retuned under the corrected factor, never before it. Standing rule from Reid: when a defect is a physics-correctness question, prefer correct physics. | Reid ruled 2026-08-10. Every hour of art iteration under the wrong factor is wasted, and retuning first would bake the bug into the assets permanently (the exact failure ART-DIRECTION.md's sequencing rule exists to prevent) | Accepted | rendering |
| D-017 | 2026-08-10 | **Development topology settled.** The orchestrator session runs on Reid's desktop at `D:\karbalfactorio`; implementation lanes run on the Proxmox VM `claude-dev` (`ssh reid@10.10.10.36`, 16 cores / 48 GB / 300 GB, Ubuntu 24.04, Claude Code v2.1.227 installed and authenticated). Lanes may be local agents that do all heavy work over SSH, or headless `claude -p` sessions launched on the VM itself; either way nothing heavy runs on the desktop. The served build binds the LAN (never `127.0.0.1`) so Reid plays at the VM's address on his own GPU. | Reid's answer 2026-08-10: orchestrate from the desktop, implement on the VM, and never disturb his machine while he is gaming | Accepted | admin + build-tooling |
| D-018 | 2026-08-10 | **Platform and art bar.** The endgame ship target is a native Steam build. Web/Three.js remains the development platform through the pre-alpha line, because its iteration speed is what produced the mechanics progress and the failed UE attempt showed what re-platforming mid-mechanics costs. The native-engine decision is deliberately deferred to the pre-alpha gate, and UE is not the default answer when it comes. Continuous de-risk: `/core` stays engine-agnostic C++ behind the flat C ABI, and all art is authored as portable glTF + PBR texture sets so the art overhaul survives any future engine. Art bar recalibrated: **Satisfactory is the envisioned target**; Skyrim/Elden Ring stay as aim-high references per ART-DIRECTION.md, deliberately set above the goal because current art is far below the playable bar. | Reid 2026-08-10: "the platform is always meant to be endgame native installed from steam", "satisfactory is much more what i envision, but i want to set the bar high" | Accepted | admin |

| D-019 | 2026-08-11 | **The research station is a real buildable machine**, and the research panel (today a free-floating `J`-key UI) gates on having built or being at one. At HEAD no research-station machine, entity, recipe or item exists despite the storyline listing "build a research station" as a progression rung before the scanning antenna. | The storyline's own text reads as a build step; a free research panel skips a rung of Reid's progression spine. **Confirmed by Reid 2026-08-11 morning** | Accepted | gameplay |
| D-020 | 2026-08-13 | **Art style refined: Space Engineers is the primary fidelity and style target** (functional industrial realism, PBR metal and machined surfaces, engineered forms), amending D-018's Satisfactory bar; Skyrim/Elden Ring stay the aim-high references. Reid also wants "a lot of the mechanics behind the world" from Space Engineers. Deformable voxel terrain is already core; **which further world mechanics (structural physics, damage states, grid construction, pressurization) are in scope is an OPEN scoping question owing its own pass**, not a commitment made here. | Reid 2026-08-13: "I think the artstyle of space engineers is what i want to go for. like that level of fidelity and allot of the mechanics behind the world as well" | Accepted (art); Open (mechanics scope) | admin + rendering, scope pass owed |

> Append-only. Superseded decisions are marked, not deleted. New cross-domain decisions are added here by Admin; domain-local decisions live in the controller file's own decision log.
