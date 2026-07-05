# RETHINK — 2026-06-16 · Admin synthesis and reconciliation plan

**Trigger:** Reid: "This project is not in a good state and needs a rethink."
**Inputs:** three independent, evidence-required audits in this directory:
[ue-architecture-audit.md](ue-architecture-audit.md) · [core-docs-audit.md](core-docs-audit.md) · [goal-gap-audit.md](goal-gap-audit.md).
This file is the Admin's synthesis and the plan of record until superseded.

## 1. Verdict

The project is **not off-course on substance** — both halves of the fantasy exist and work:
the ground game (walkable streamed planet, biomes, foliage, harvest→craft→smelt, grid building,
running automation lines, 1 m³ voxel tunneling with persistence) and the space game (orbital
mechanics, SOI transfer, the full flight spine — headless, plus a demo render). The headless
`/core` is definitively healthy: **21/21 suites green** (the reported "2 failures" were a
PATH/DLL environment artifact, now root-caused).

The crisis is **structural**: three days of high-velocity feature passes accreted onto an
integration layer nobody owned, on top of one unsettled foundational question ("what IS the
surface?"), while the design docs stopped describing the actual project. The fix is
**consolidation, not restart**. Nothing of substance gets thrown away; duplication does.

## 2. What is sound (keep, build on)

- **`/core`** — 22 engine-agnostic, deterministic, tested headers. The last two days' bugs were
  almost never core-logic bugs; they were seams between core definitions and UE consumers.
- **The floating-origin / frame-aligned spine** — 99 rebases over 180 km, no jitter. This is the
  technical heart of the seamless promise, already proven on the ground half.
- **The ground-game direction** (Reid's evolved vision) — healthy, mostly integrated on one map.
- **Process wins** — the anti-stall agent protocol, incremental commits, verify-in-motion.

## 3. Root causes

**RC-A · Five definitions of "the surface."** RAW (`sampleHeightField`) · DESIGNED
(`sampleDesignedHeight`) · DEFORMED (designed − edits) · the MESH (raw − the *same* edits — two
different bases for one edit map!) · VOXEL-SOLID (raw again). The bedrock clamp exists on only
one path, and two `/core` comments assert consistencies that are false. Direct cause of: the
floating player (M4.0/M4.3), floating nodes (M4.4), and the dig-in-air + 18 m surface-snap hack
(M5.2). Every future surface feature pays this tax until there is one oracle.

**RC-B · Accretion without integration ownership.** `AOFPlanetTerrain`: 2,511 lines, 10
responsibilities added across 10 commits, four hand-rolled re-anchor paths — 25.6% of the whole
UE layer. `OFSurvivalCharacter` is a second god object forming (1,330 lines incl. factory
wiring). Two smelting simulations; two dig systems synchronized by hand at call sites; a dead
demo subsystem; per-frame world scans in the HUD. Meanwhile the controller docs drifted to
describing a different project (root CLAUDE.md: "planning repo, no code committed"; RN-5 says
RealtimeMesh, actual is ProceduralMeshComponent; D-005 "no voxel until Phase 4" silently
inverted; PH-5 analytic-collision reversed by cooked PMC collision) and the shipped voxel
pipeline, foliage system, and save file have **no owning controller**.

**RC-C · Two games at two scales with no bridge.** Ground at 1 m = 100 UE; orbital demos at
0.001; zero shared UE code; RN-1 (dual-camera scaled space) accepted but never built. The
project's namesake — seamless surface↔orbit — currently has **no playable path**. Similarly
stranded: the research tree has zero references anywhere in the UE plugin (the factory
dead-ends), and only terrain edits persist (via a non-atomic ad-hoc file while the tested atomic
PS-6 save container has zero UE consumers).

**RC-D · Operational one-way door.** 2.55 GB of binary content in git history, vendor demo maps
committed, no LFS — and **no remote yet**. History surgery is cheap today and near-impossible
after a remote/collaborators exist.

## 4. The reconciliation plan

### Phase R — One Truth (consolidate; no new features)
- **R1 · Surface oracle.** One `/core` `SurfaceField` authority: `height = designed − voxelLowering`
  (single bedrock clamp); voxel solidity derived from the *same* function; `terrain_deform`
  demoted from edit-authority to a derived view (top-removed-voxel column → far-field lowering,
  the UE `OpenColumn` logic promoted into core). Every consumer — chunk mesh, collision, nodes,
  walker, deposits, foliage, voxels — reads the oracle. One-time re-baseline of the RAW bit-pins
  (≈5 test files). *Visible consequence (intended): the planet's relief becomes the DESIGNED
  terrain everywhere — mountains actually mountainous.*
- **R2 · UE decomposition.** Thin `AOFPlanetBody` (origin/FrameRot authority + oracle access +
  one `OnOriginRebased` broadcast) + three components: TerrainStreaming (chunks/mesh/collision),
  Destruction (voxel-first), Scatter (ONE lattice system serving harvest nodes AND foliage).
  Belts get real transforms; build/auto-connect moves character → automation manager; ONE
  smelting model (furnace = fuel tier, smelter = powered tier, shared recipe data, real power
  draw incl. miners); retire `UOrbitalFoundrySubsystem`; extract the journey autopilot to one
  home and quarantine the scaled demos pending Phase S.
- **R3 · Repo surgery (now, before any remote).** `git lfs migrate` over `ue/Content` history;
  untrack vendor demo maps; resolve the ~850 MB untracked packs (wire or delete); then add a
  remote. Tooling: `-static-libstdc++ -static-libgcc` + ctest timeouts (kills the
  environment-dependent test flake); record in build-tooling.md.
- **R4 · Unified save.** One WorldSave subsystem on the atomic PS-6 container: inventory, placed
  buildings/network, research state, voxel edits. Drop the ad-hoc file.
- **R5 · Docs re-sync.** MASTER_PLAN status/roadmap rewritten to reality; the real pivots logged
  as Admin decisions (voxel-now, PMC-not-RealtimeMesh, ground-first, designed-surface authority);
  ownership assigned (voxel pipeline → world-gen+rendering, foliage → world-gen, save →
  persistence); root CLAUDE.md updated.

### Phase P — A Game, Not a Sandbox
- **P1** Research wired into play: menu tab, science packs from the factory chain, unlocks gating
  machines/recipes/build costs.
- **P2** Placement costs (consume crafted items) + real power (miners not free).
- **P3** The objective thread ending at **"build a launch pad"**, with the experience continuum
  riding along (tunnel lighting/headlamp, ocean water, voxel-seam polish, biome ground surfaces).

### Phase S — The Namesake Seam
- **S1** RN-1 dual-camera scaled far-field over the 1:1 planet (Cinder + stars in the sky).
- **S2** Boardable 1:1 vessel; launch with near-field→scaled handoff on ascent (the KSP moment);
  Cinder landing as the endgame resource loop.

### Stop-doing
SurvivalTest feature work (demote to regression map) · voxel feature expansion before its polish
lands · Cinder gameplay · multiplayer (deferred; constraint honored — voxel edits are already an
op-log, replication-friendly).

## 5. Process changes (so this doesn't recur)

1. **No new surface math.** Every consumer reads the oracle — a review gate on every pass.
2. **Integration pass after every ~3 feature passes.** God-object growth is a blocker, not a smell.
3. **Controllers own what ships** — the owning controller doc updates in the same commit (the
   existing working rule, now Admin-enforced at merge).
4. **Experience acceptance = input-driven PIE run**, never a static capture.
5. Keep: anti-stall rules, incremental commits, evidence-based verification.

## 6. Decisions requested from Reid

1. Approve the R → P → S ordering (vs. seam-first or more features first).
2. Repo surgery now (LFS + history rewrite while there is no remote) — yes/no.
3. SurvivalTest demoted to a regression-only map — yes/no.
