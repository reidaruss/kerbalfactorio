# Admin Master Controller — Context

> **Domain owner:** Admin (Tier 0) · **Last updated:** 2026-08-10 (fresh orchestrator session: D-016 to D-018 logged, [VISION.md](../VISION.md) written, VM bootstrap dispatched)
> **Plan of record:** [review-2026-06-16/RETHINK.md](../review-2026-06-16/RETHINK.md): Phase **R** (consolidation) → **P** (progression) → **S** (seam), approved by Reid 2026-07-05.
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md)
> This is the live nerve-center. It tracks *who is doing what*, cross-domain decisions, and integration. It does **not** hold domain implementation detail — that lives in each controller file.

---

> ## STOP: THE ORCHESTRATION MODEL CHANGED, 2026-08-03
>
> **Read [../STATE_OF_THE_UNION.md](../STATE_OF_THE_UNION.md) before acting on
> anything below it.** It carries the current state, the todo list ordered by what
> unblocks the most, the lessons from running six concurrent agent lanes for a
> week, and the architecture that replaces how this controller worked.
>
> **The headline change: the top-level session does no implementation.** It reads
> reports, makes rulings, routes findings, allocates decision-number blocks,
> sequences conflicting lanes, and talks to Reid. It does **not** edit code, run
> builds, run probes, drive a browser, or commit anything but decision records. A
> **Release lane** owns the settled rebuild and the freeze to port 4200 and is the
> only lane that commits `web/wasm/dist/*` and `expected.json`.
>
> **Model tiering.** Sonnet for work whose brief can state *what to do*; Opus for
> work whose brief can only state *what to find out*. If a brief contains
> "measure whether", "decide the shape", or "the premise may be wrong", it is Opus.
>
> **The shape is a graph, not a line, and that is the second change.** Reid chose
> graph engineering on 2026-08-03; §7 of the state-of-the-union is the full
> writeup. Four things bind here:
>
> 1. **Apply the "and then" test to every seam in a plan.** Does the next step
>    actually read the previous step's output? If not it was never a dependency,
>    so run them at once. Most of last week's edges were false, and the
>    orchestrator waiting on each one *was* the critical path.
> 2. **A worker never grades its own work.** Every finding is verified by a
>    **separate agent on fresh context** that never touched the work and checks a
>    real signal. Roughly twenty instrument failures in one week came from lanes
>    checking themselves.
> 3. **A verifier never implements.** Say so in the brief.
> 4. **Concurrency is bounded by the box, not by the agent cap.** 16 cores: fine
>    for a dozen readers, **3 to 4 headless-Chrome probes**, 2 to 3 Blender
>    renders. §7.4 has the table.
>
> **Cap at four concurrent *briefed lanes* holding a conversation with this
> session.** Six was past the point where reports arrived faster than they could
> be read. That cap does not apply to a scripted fan-out where the orchestrator
> reads one merged report at the end; there the limit is the hardware table in
> §7.4.
>
> **Project root is `D:\karbalfactorio`**, remote
> `https://github.com/reidaruss/kerbalfactorio.git`. The Nextcloud path is retired
> and deleted; §1 of the state-of-the-union says why.

## 1. Mission
Own the global plan, the cross-domain interfaces, the dependency graph, and integration. Delegate fully-briefed high-level tasks to Domain Master Controllers; arbitrate interface disagreements; keep [MASTER_PLAN](../MASTER_PLAN.md) coherent. **Do not** absorb domain detail — delegate it.

## 2. Current project phase
**Phase R: CONSOLIDATION** (per [RETHINK.md](../review-2026-06-16/RETHINK.md), approved by Reid 2026-07-05). The build is real: **21 green ctest suites** in `core/` (the once-reported "2 failures" were a PATH/DLL environment artifact, root-caused in [core-docs-audit.md](../review-2026-06-16/core-docs-audit.md) Task A) and a playable UE 5.7 game shipped **M2.1 through M5.2**. Both halves of the fantasy exist (walkable streamed planet + running automation + voxel tunneling; orbital flight spine headless + demo-rendered). The crisis was **structural, not substantive**: three audits (in [review-2026-06-16/](../review-2026-06-16/)) found duplication (five surface definitions), god objects, unowned shipped systems, and design docs describing a project two phases behind the code. The fix is **consolidation, not restart**: keep everything of substance, remove duplication, then add the game loop, then close the seam.

**Roadmap of record (R → P → S, RETHINK §4):**
- **Phase R (One Truth, in progress).** No new features. R1 surface oracle (single `/core` `SurfaceField` authority, in flight, world-gen). R2 UE decomposition of `AOFPlanetTerrain`/`OFSurvivalCharacter` (queued). R3 repo LFS surgery + toolchain fix (**DONE**, BT-7/BT-8, see D-012). R4 unified UE save on the atomic PS-6 container (queued next, persistence). R5 docs re-sync (**this pass**).
- **Phase P (A Game, Not a Sandbox).** P1 research wired into UE play (menu tab, science packs, unlock gating). P2 placement costs + real power (miners not free). P3 the objective thread ending at "build a launch pad".
- **Phase S (The Namesake Seam).** S1 RN-1 dual-camera scaled far-field over the 1:1 planet. S2 boardable 1:1 vessel with the near-field→scaled ascent handoff (the KSP moment) + Cinder landing endgame.

**Stop-doing (Reid-approved 2026-07-05):** SurvivalTest feature work (**demoted to a regression-only map**); voxel feature expansion before its polish lands; Cinder gameplay; multiplayer (deferred; voxel edits are already a replication-friendly op-log).

**What shipped (headless Phase 0/1 + UE M2.1–M5.2), for the record:**
- **Four Wave-0 headless cores + integration + gameplay + persistence, all green:** planetary-scale precision (core-engine, 99 rebases/180 km), 100k factory @ ~535 UPS (factory-sim), crack-free terrain proven bitwise (world-gen), no-drift orbits 2.4e-11/30 orbits (physics), the composed Forge→orbit→Cinder flight loop (integration), the player loop (gameplay + research), seed+diff atomic save (persistence). The `slice_e2e` suite proves mine→factory→science→research→fly→off-world Cinderite→save/reload end-to-end.
- **UE 5.7 game (`ue/`), milestones one line each:** M2.1 first in-engine terrain render · M2.2 the full flight spine rendered in scaled space · M2.3 factory rendered live from the FS-14 stream · M2.5–M2.9 survival-crafting shell (inventory/crafting/menus/dropped items/held tools) · M3.0–M3.1b graphics/atmosphere pass + FP view-model · M3.2 Factorio automation in-world · M4.0 walk the real streamed 1:1 planet (floating origin) · M4.1 polished surface + biome deposits · M4.2 level-ground FrameRot fix + Megascans textures · M4.3 solid PMC collision + physical walking · M4.4 grounded stable id-keyed streaming · M4.5 sprint + emergent nodes · M4.6 destructive digging + drilling miners (heightfield) · M5.0 build grid (snap + edge-to-edge connect) · M5.1 biome foliage scatter · M5.2 true 1 m³ voxel tunneling + voxel miners + edit persistence.
- **Not yet built (Phase P/S targets):** the surface↔orbit seam in-engine (RN-1 scaled space over the 1:1 planet), research wired into UE play, placement costs/real power, a unified UE save.

## 3. Controller status dashboard
| # | Controller | Phase | Status | Owner of | In flight / next |
|---|---|---|---|---|---|
| 1 | core-engine | R | **Cores green; oracle work in flight** | coords, floating origin, frames, active/on-rails, tick | Hosts the R1 `SurfaceField` oracle (world-gen authors) |
| 2 | rendering | R→S | **M2.1–M5.2 shipped; seam pending** | scaled space, LOD, instancing, shaders, **voxel mesher** | RN-5 superseded by PMC (D-009); RN-1 scaled space unbuilt → scheduled **Phase S** |
| 3 | physics | R | **Wave-0 core green; near-field collision reversed** | patched conics, rigid bodies, character/collision | PH-5 superseded for the character near-field (cooked PMC, D-010); vessel path still analytic |
| 4 | world-gen | R | **Terrain/biomes/deposits/foliage/voxel shipped** | planet gen, deposits, POIs, **voxel pipeline data, foliage/scatter** | **R1 single surface authority (WG-21) IN FLIGHT** (D-011) |
| 5 | factory-sim | R→P | **Auto-line + on-rails green; in-world** | belts, machines, power, on-rails factory | Research wiring + real power draw = **Phase P1/P2** |
| 6 | networking | deferred | **First netcode proven; deferred** | server authority, AOI, replication | Deferred (RETHINK stop-doing); voxel edits already an op-log |
| 7 | gameplay | R→P | **Survival slice + research core green** | research, quests, loot, UI | Research **not yet wired into UE play** → **Phase P1** |
| 8 | persistence | R | **Atomic core green; 3 save paths shipped** | seed+diff, streaming, serialization, **unified save** | **R4 unified UE save (queued next)**: retire the ad-hoc deform file |
| 9 | build-tooling | R | **Repo LFS surgery DONE (R3)** | git, toolchain, headless harness, CI, assets | LFS history rewrite + static-libstdc++ toolchain fix landed (D-012, BT-7/8) |

## 4. Dependency graph (quick reference)
```
core-engine ─┬─▶ everyone (coords, frames, tick, active/on-rails)
world-gen  ──┼─▶ rendering, physics, factory-sim, gameplay, persistence
physics  ────┼─▶ rendering           (depends on core-engine, world-gen)
factory-sim ─┼─▶ rendering, persistence, gameplay (depends on core-engine, world-gen)
rendering  ──┘   (depends on core-engine, world-gen, physics, factory-sim)
gameplay  ───▶ (depends on factory-sim, world-gen, persistence)
persistence ─▶ (depends on world-gen, factory-sim, gameplay)
networking ──▶ CROSS-CUTTING — wraps all sim; server-authoritative constraint on all
```
Full version: [MASTER_PLAN §5.3](../MASTER_PLAN.md#53-dependency-graph-who-depends-on-whom).

## 5. Cross-domain decisions
Authoritative log is [MASTER_PLAN §11](../MASTER_PLAN.md#11-global-decision-log). Foundational decisions: **D-001** UE5, **D-002** patched conics, **D-003** active/on-rails generalized to factory, **D-004** no lockstep / authoritative server, **D-005** v1 scope cuts, **D-006** single canonical Body Definition. **Real pivots logged 2026-07-05 (R5 re-sync):** **D-007** ground-first direction pivot (Reid-directed) · **D-008** voxel terraforming NOW (supersedes the "no voxel until Phase 4" timing in D-005/Q4) · **D-009** terrain meshes = `UProceduralMeshComponent` in practice (supersedes RN-5's RealtimeMesh) · **D-010** cooked PMC collision for the near-field (supersedes PH-5's analytic-only stance there) · **D-011** single surface authority (WG-21 / R1, in flight) · **D-012** repo LFS surgery done (R3, BT-7/8) · **D-013** R→P→S roadmap approved by Reid. **Logged 2026-08-03 during the autopilot and moon night:** **D-014** an orbiting thing is genuinely in orbit, there is no second static copy of where it is (settles physics R67 station and R70 moon as one ruling; the carrier term in `KinematicBody.step` is the accepted consequence and is deliberately held until landing matters) · **D-015** a docking port is a part instance in a design rather than a special case on the station, and "automatically dock" means full auto-approach shipped in two layers. Admin appends new cross-domain decisions to the MASTER_PLAN log.

## 6. Active delegations / in-flight briefs

### 2026-08-10 session (CURRENT orchestrator, graph engineering per state-of-the-union §7)

Rulings this session: **D-016** (albedo fix approved), **D-017** (orchestrate on desktop, implement on VM `claude-dev` 10.10.10.36), **D-018** (native Steam endgame, web through pre-alpha; Satisfactory art bar). North star: [VISION.md](../VISION.md).

| Task | To | Brief (goal) | Block | Status |
|------|----|--------------|-------|--------|
| VM bootstrap | build-tooling lane | Provision claude-dev: toolchain, clone, build, ctest, serve on :4200 bound to LAN | BT-30 to BT-59 | **DONE ✓** (7f66914, merged 1f60f8d; 41/41 ctest green, serve verified from LAN) |
| Carrier-rider boarding | core-engine Opus lane on VM (`lane/carrier-rider`) | Merge ph357 first, membership predicate with hysteresis, decision after Loop syncAt, arrival via standLocal path, stationboard probe | CE-39 onward | **RUNNING** |
| SwiftShader diagnosis | build-tooling Opus lane on VM (`lane/swiftshader`) | Root-cause the boot.mjs FAIL (PNG decode + CONTEXT_LOST) under SwiftShader on Linux; gates the 4-shard probe sweep | BT-60 to BT-79 | **RUNNING** |
| Blender 5.0.1 install | infra lane (report-only) | Pinned pipeline version onto the VM as `blender501`; apt 4.0.2 must never author assets (BT-14) | none | **DONE ✓** (`~/.local/bin/blender501`, sha-verified) |
| Albedo fix, producer side | rendering Sonnet lane on VM (`lane/albedo`) | D-016: texgen linearisation, manifest v2, hardened fallbacks | RN-1400 to RN-1404 | **DONE ✓, MERGED** (2ea55c2 via 06b6685; fresh-context verifier 7/7 incl. negative control; browser-side verification + retunes gated on SwiftShader lane) |
| Scanning spine scope | gameplay Opus lane (read-only, local) | Work-item graph for antenna/reveal/ruins/enemies/loose-stones/pickaxe per storyline + Reid's rulings | none | **DONE ✓** (5 independent lanes + 3 serial; premise corrections incl. no research station exists, no map-marker system, Research.earn inert) |
| Loose stones + pickaxe gate | gameplay Sonnet lane on VM (`lane/stones-pickaxe`) | One design: stones as small Rock nodes, per-kind requiresTool gate, Stone+Wood pickaxe/axe recipes, anti-deadlock ctest | GP-506 to GP-519 | **RUNNING** |
| Ruin mesh | asset Opus lane on VM (`lane/ruin-mesh`) | build_ruin.py, 18 m enterable derelict, 2.3 m plinth, LOD0-2, col_RuinN, procedural weathering per ART-DIRECTION | RN-1450 to RN-1499 | **RUNNING** |
| SwiftShader fix verification | fresh-context Sonnet on VM | Verify lane/swiftshader (LFS pointer root cause, .gitattributes fix, boot tolerance) before merge | none | **RUNNING** |

**Provisional ruling D-019 (Reid to confirm in the morning):** the research station is a REAL buildable machine and the J-key research panel gates on it, per the storyline's own text ("build a research station (where research will be conducted)"); at HEAD no research station exists in any form. Logged provisional in MASTER_PLAN §11.

Scope reports banked (read-only lanes, done): probe-sweep plan (4 shards, gate design per BT-41), carrier-rider plan (mechanism + merge order settled), albedo plan (producer-side fix in texgen.py, manifest v2, only 7 families affected; terrain/sky immune).

**Deploy key:** registered by Reid 2026-08-11 (repo-scoped, `~/.ssh/of_deploy_key`); lanes push their own branches directly.

### 2026-08-12 midday state (post desktop-reboot recovery)

Everything in the table above is finished and merged except as noted here. Merged into main through this session: albedo (06b6685), SwiftShader/LFS (ae8ef10), ruin mesh (0765a61), carrier boarding + ph357 (cfeffad), R17 reboot re-mount (f0a7da0), markers/milestones (5c2c6b7), D-019 docs (2d90513), map-body identity (2cace22), stones + station arrival (ed24910), Release ABI-23 (205cef6), frame-render stutter fix (d54b003), **research station D-019 (623c81e, verified MERGE)**.

### 2026-08-13 local-dev window (Reid authorized his desktop for a few hours; probes on D3D run in minutes)

**Five merges landed on main this window, every one through a fresh-context verifier:** POI bridge ABI 24 (8f85178, WG-151 block, save conflicts resolved as the union of bodyHandle and stations), rotor instrument fix (a4f396d, CE-53: turnBetween's acos cliff amplified 4 ulps into the 1.7e-6 red; atan2 form, chord comparison, gate tightened to 1e-9), enemy garrison (f6330d2, GP-95..98 + GP-680: the leash was never broken, the guards were killing the probe fixture and the respawn undid the retreat), survival probe progression (d414c91, GP-624/625/670/671: probes follow the pickaxe gate legally; padgate additionally undercounted the station's iron), and earlier research station (623c81e) + probe fixtures (c111acb).

**2026-08-13 afternoon: the scanning spine LANDED END TO END and the ART CAMPAIGN began.** Merged since the morning note, every one through a fresh-context verifier: L6 scanning antenna reveal (442ef0b), ruin placement with collision and garrison (d873dc2), antenna reload probe (6115119), three enemy reds all instrument (774e3ee), L7 ruin investigation gating Electrification (e9adfcf, its research.js/padgate.js ripple paid honestly), two Release content refreezes (fd3894d, 8dc2358). Served build at orbitalfoundry.lan carries the whole loop: pickaxe gate, research station, antenna reveal, ruin standing with garrison, investigation milestone, Electrification unlock. Rulings D-020 recorded: Space Engineers art bar, all four world mechanics selected, ART PASS IS PRIORITY ONE, mechanics deferred (scope banked at docs/scope/SE-MECHANICS-SCOPE-2026-08-13.md; D1 destruction-consequence flagged as a pre-alpha defect eligible anytime). Art campaign plan of record: docs/scope/ART-CAMPAIGN-2026-08-13.md. Lanes dispatched: lane/art-foundation (A0 canonical shots + A1 light foundation, opus, RN-1405..1449) and lane/art-mapslots (A2a KTX2 + map slots, sonnet, RN-1462 low end). Next: smelter proof shot, then A2b texgen families, then the A4 machine wave.

**Open rulings for Reid:** (1) garrison guards keep chasing a dead player's respawn point until the leash fires, unwritten behaviour, needs a yes or no; (2) GP-670: the Chrome-guard pgrep pattern mandated in VM briefs matches the briefs themselves and cannot read zero; tools/lane/probeguard.sh (untracked, probe-toolgate worktree on VM) resolves /proc/pid/exe and should be promoted by build-tooling.

**Reid rulings 2026-08-13 evening (map and navigation):** a COMPASS HUD showing marked locations while on foot; on-foot survey discovery keeps working alongside the antenna reveal; and the FULL map reveals when the player explores the space station for the first time. Both landed same evening: compass (c35a0c8), station reveal (b894f2c, ABI 25, Release ef1f862).

### 2026-08-14 overnight, GRAPHICS EMPHASIS (Reid: full tilt, bar SPACE ENGINEERS)

**Eleven verified merges in one night, main at 6001348, served current.** The scanning spine finished (compass c35a0c8, station full-map reveal b894f2c + ABI-25 Release ef1f862, researchstation probe gate dc8a5e3). The art campaign's foundation, center and first waves all landed: smelter proof shot 0b31891 (verdict NO-GO naming THE LIGHT binding, resolution and UVs cleared), IBL diagnosis e1fce85 (the sky had no bright source; the mirror-arm defect the verifier caught was the instrument, environment is 99.7 percent of a machine's light), A4 wave one 400954c (box/miner/assembler/belt engineered forms, SteelRust collision resolved deliberately at 834F2A), A5 foliage 59cb86e (cards to 1024 with real silhouettes), A3 terrain f8f1172 (five-of-ten-biomes-were-one-material fixed, dug voxel faces textured), A6 owed models 832a403 (real research station and scanning antenna), and THE LIGHT 6001348: **a three r185 defect, the PCF branch does not flip shadow bias sign under reversed depth, made the bias minus 4.8 world metres; every machine stood inside its own misplaced shadow.** Fixed sign-aware, sun disc authored at its real 0.53 degrees at 35.3x irradiance-conserving (peakRatio 8 to 225, off-sun sky bit-identical). Smelterhero 19.52 to 45.65 luma, warm positive: metal reads as metal.

**Open look judgments for Reid:** the sky/dusk pair (deliberate look change); the low/medium tier 64 IBL cube misses the sun disc entirely (fix lane dispatched).

**Queue:** A4 wave two (generator, inserter, power pole, wall/floor/door/pillar/foundation; dispatched on VM), low-tier disc fix (dispatched), terrain 1.8 m LOD is now the limiting ground artifact (world-gen scope owed), GP-725 cross-body discovery lattice, docking R93, D1 destruction consequence, assembler.js red, standAt orbital boarding, miner LOD1 proxy, belt curve/cap sections, antenna dish pick, control-site published numbers, props=0 leaves scatter shadows, smelterhero hiFrac still 0.

### 2026-08-14 dawn: the queue emptied. Main at e51235a, served, ABI 26.

Every item above that named a lane LANDED, all fresh-context verified: A4 wave two (228deb4, all eight assets, 229 coplanar cleared), low-tier sun (46b056d, iblSize floored 256, low-tier peakRatio 5 to 234), cross-body discovery (465aca5, GP-725 closed, byte-exact per-body round trips), DOCKING R93 (f785b91, ABI 26 at d58733e: five of_dk_* exports, envelope from a dwell argument, capture/release/save end to end, a real memo defect fixed), D1 destruction (2d2e9b2, buildings fall, net-zero ledger, one-third scavenge), assembler.js FS-73 fixture (f82adc2, setup green, GP-761/762 recorded), standAt frames (e51235a, refusal + standAboard, RN-1412's mechanism corrected: stale aim 5.3 km + frame mismatch, not 7.67 km/s).

**THE PRE-ALPHA STORYLINE CHAIN IS MECHANICALLY COMPLETE**: wood, stones, pickaxe, smelting, belts, research station, antenna reveal, ruin with garrison, investigation unlocking electricity, launch pad, hand-flown flight, and now docking capture at the station with the full-map reveal on boarding. What remains is playtesting, balance, feel, and the moon-scan rung's autopilot follow-through (R99 auto-approach is deliberately behind the station visit).

**Backlog after the dawn sweep:** PH-366 mintStation still emptyDesign (D-015 not uniform for Anchorage, PS-43 stale), R-BODY-2 eleven body-scoped fields on in-page switch, GP-761 stone haul 43 m short, GP-762 beltcargo drill rotation, demolish.js red (smelter would not go down at the head), persist.js red, zerog Z4 vacuous-pass risk, stationwalk.js stale aim, terrain LOD scope (world-gen), forestfloor re-baseline row, miner LOD1 proxy, belt curve/cap sections, antenna dish pick, rubble_pile.glb + scanning receipts owed by art, smelter 6 coplanar, 10 foliage validate_glb, expected.json Windows reproducibility, R100 docking save via real reload pair, stale-branch-base dispatch note (verifier: dry-merge before verifying web-only branches cut before an ABI bump).

**Prior day's dispatch record (2026-08-12 ~16:30), superseded by the above:**
- Research station (merged at 623c81e, source stands): acceptance cascades ~33 fails at tip because the GP-506 pickaxe gate refuses the probes' bare-hand ore harvests. Instrument, not game. Fix lane `lane/probe-toolgate` (opus): probes follow the legal progression (wood/stones bare-handed, craft pickaxe, then ore); C5 demolish-relock must finally be exercised for real. buildmenu survival's one red is the same gate.
- Garrison 068cb38: determinism, hold (drift 0.000 m), 30 m acquisition, and the sandbox negative control all green; leash UNPROVEN because the scripted retreat stopped 45 m from the post, inside the 60 m leash, and creatures engaged forever. Lane resumed to retreat past 90 m and prove engage-return-hold.
- POI bridge fed5729: substance PROVEN live (ruin at 753.77 m, id round-trip, marks survive page.reload, negative controls green, ABI 24, SaveSlot.poi, SAVE_VERSION 5 untouched) but a REAL numbering collision: code comments cite WG-200..212 (spent 2026-08-03, unledgered) and docs cite WG-219 (ungranted). Lane resumed to renumber to the briefed WG-151..165, guard reload.mjs's restored-factory assertion for probes without a buildings field, and settle two unallowlisted console warnings. Its of.run-hang contention theory is undercut: on the quiet box nothing hung.

Merge order once green: garrison, then POI, then Release settled ABI-24 rebuild + serve refresh (mandatory; committed dist predates gameplay.h research station).

**Sweep + gate (BT-80..83, `lane/sweep-gate` c72cad8, report banked):** gate mechanism DONE and proven both ways (6/6 negative controls) but **UNFLIPPED**. Census failed: 287/291 probes returned no verdict, 191 SIGKILLed at 240 s because the box was never quiet (load ~30 throughout). Real findings: `shadowk.js` cannot parse (genuine defect), `holes.js` asserts nothing (BT-40 class). **Flip prerequisites:** (1) serial quiet-box census, ceiling 2 concurrent probes, ~10 h for 200 probes, needs sole ownership of the box; (2) ~~maneuver.js verification~~ **SATISFIED** (below); (3) owners for the two remaining findings; (4) the SwiftShader-vs-D3D ruling, now well-informed (below).

**2026-08-12 evening: fork absorbed (handoff doc deleted, content lives here).** A forked orchestrator session ran concurrently on the desktop until Reid closed it. What it landed, all since verified by a fresh-context agent and merged as c111acb:
- `maneuver.js` catalogue fixture 24 → 25 (EngineVernier 0x0116) and `carrier.js` C1/C7 rewritten for the stamped moving station. maneuver.js GREEN on real GPU twice independently: **the sweep's RED list is now empty; the sole known-red.json entry delists as an instrument defect.**
- **NEW genuine red, owner core-engine:** carrier.js rotor row C1, perTickM 31.32092 vs r*w 31.320866, relative ~1.7e-6 vs 1e-6 tolerance, deterministic (reproduced to 5 decimals in two independent runs). Rotor seeds `from: 'station'`; the stamped station plausibly perturbed it just past tolerance. Needs a diagnosis lane before anyone widens the tolerance.
- **D3D baselines for the SwiftShader-timeout probes, all GREEN on Windows:** apexec 256 s (miss -26.6 m on an 800 km ask; the historical 50 km shortfall did not reproduce), post 90 s, carrier 120 s. So those probes are healthy and the gap is a platform property: the VM cannot host the gate for the full suite; the D3D-only subset needs a Windows leg or an allowlist carve-out.
- Re-confirmed with mechanism: main's committed wasm dist (205cef6) predates gameplay.h's research station, so researchstation.js/buildmenu.js reds on main-as-committed are ALL the stale dist; **the Release settled rebuild is mandatory** and post.js's placement anomaly (2 of 7 machines) should be rechecked only after it. buildmenu residuals to recheck post-rebuild: station tile icon still text, sandbox greying flags it locked. stationframe.js CONTROL row is display-cadence-sensitive at high fps (instrument note, core-engine).
- Rulings relayed from Reid via the fork: desktop heavy-work window expired ~21:20Z 2026-08-12 (do not assume it); the model bump expired ~11:30 local; no need to ask before restarting the served build while he is not testing.

### Phase R consolidation (the prior live work; plan of record [RETHINK.md](../review-2026-06-16/RETHINK.md) §4)

| R-task | To | Brief (goal) | Status |
|--------|----|--------------|--------|
| **R1** | world-gen (core) + rendering (consumers) | One `/core` `SurfaceField` oracle: `height = designed − voxelLowering`, single bedrock clamp; voxel solidity from the same function; `terrain_deform` demoted to a derived view; every consumer reads it. One-time RAW baseline rewrite (~5 test files). (D-011 / WG-21) | **RUNNING** |
| **R2** | rendering + factory-sim + physics (integration) | Decompose `AOFPlanetTerrain`/`OFSurvivalCharacter`: thin `AOFPlanetBody` (origin/FrameRot + oracle + `OnOriginRebased`) + TerrainStreaming / Destruction / Scatter components; ONE smelting model with real power draw; retire `UOrbitalFoundrySubsystem`. | Queued |
| **R3** | build-tooling | `git lfs migrate` over `ue/Content` history, untrack vendor demo maps, add a remote; `-static-libstdc++ -static-libgcc` + ctest timeouts. (D-012) | **DONE ✓** (BT-7/8) |
| **R4** | persistence | ONE UE WorldSave subsystem on the atomic PS-6 container (inventory, placed buildings/network, research state, voxel edits); drop the ad-hoc `deform_*.bin`. | Queued **next** |
| **R5** | docs | MASTER_PLAN/ADMIN/controller re-sync to reality; real pivots logged; ownership assigned; root CLAUDE.md updated. | **DONE ✓** (this pass) |

**Ownership assignments made this pass (RETHINK §4-R5), closing the "no owner" audit finding:**
- **Voxel near-field pipeline:** DATA (`voxel_terrain.h`, edits, reconciliation) → **world-gen**; the cube **mesher** (near-field mesh + collision) → **rendering**.
- **Foliage / scatter** (M5.1 HISM biome scatter) → **world-gen** (one lattice serving harvest nodes AND foliage, per R2).
- **The save file** (`Saved/OrbitalFoundry/deform_*.bin` today) + the unified UE save → **persistence** (R4).
- **SurvivalTest** demoted to a **regression-only map** (Reid-approved 2026-07-05); no feature work there.

**Spike 1: floating-origin + scaled-space seamless surface↔orbit↔moon (Phase 0, historical).**
Orchestration: Wave 1 (core-engine lead + world-gen) pins API contracts → Wave 2 (rendering) consumes them → Admin synthesizes `docs/spikes/spike1-PLAN.md`.

| Date | To | Brief (goal) | Wave | Status |
|------|----|--------------|------|--------|
| 2026-06-14 | core-engine | Floating-origin + frames + active/on-rails skeleton; pin UniverseCoord/ReferenceFrame/SimProxy/SimClock; buildable UE5 plan → `spike1-core-engine.md` | 1 | **Done ✓** (CE-5/CE-6 added; R1 test designed) |
| 2026-06-14 | world-gen | Minimal cubed-sphere heightfield for 1 planet + 1 moon; pin chunk format + height/collision query; buildable plan → `spike1-worldgen.md` | 1 | **Done ✓** (re-dispatched after a transient socket drop; WG-5…9) |
| 2026-06-14 | rendering | Scaled space + dual cameras + log depth + seamless transition + atmosphere; buildable plan → `spike1-rendering.md` | 2 | **Done ✓** (RN-1/2 accepted, RN-5 added) |
| 2026-06-14 | Admin | Synthesize the three designs → unified build plan + acceptance gate | — | **Done ✓** → [spike1-PLAN.md](../spikes/spike1-PLAN.md) |

| 2026-06-14 | physics | Spike 2 — patched conics + rigid-body craft; resolve RC-4/RC-3 → `spike2-physics.md` | — | **Done ✓** (RC-4→PH-4 hybrid, RC-3→PH-5) |
| 2026-06-14 | factory-sim | Spike 3 — 100k @ 60 UPS isolation; pin factory streams → `spike3-factory-sim.md` | — | **Done ✓** (bandwidth-bound; FS-7/8 added) |
| 2026-06-14 | Admin | Phase-0 roll-up: consolidated contracts + reconciliation register + engine verdict | — | **Done ✓** → [PHASE0-SUMMARY.md](../spikes/PHASE0-SUMMARY.md) |

**Consolidated reconciliation register:** now in [PHASE0-SUMMARY §4](../spikes/PHASE0-SUMMARY.md#4-consolidated-reconciliation-register) (RC-1…RC-11). Resolved: RC-1/3/4. Trivial additive (build start): RC-2, RC-7. Open quick-confirms: **RC-8** (rendering ← factory stream / render wall), **RC-10** (core-engine ← chunk-granular proxies), RC-9 (networking, Phase 3). Deferred: RC-5, RC-6, RC-11.

**All three Phase-0 spikes designed; interface surface CLOSED** (reconciliation round 2026-06-14 — 4 controller agents: rendering confirmed RC-8 render wall; core-engine added CE-7 mixed proxy granularity; world-gen WG-10 Mie + slope/hardness; factory-sim FS-9 adopted CE-7 + RC-12). All build-blocking RCs resolved — see [PHASE0-SUMMARY §4](../spikes/PHASE0-SUMMARY.md#4-consolidated-reconciliation-register). Domain-local decisions added this round: CE-7, WG-10, FS-9 (not global — live in their controller files).

**Phase 1 PLANNED (2026-06-14).** Admin authored [PHASE1-PLAN.md](../phase1/PHASE1-PLAN.md); Wave-1 design dispatched to the two net-new domains:
| Date | To | Brief (goal) | Status |
|------|----|--------------|--------|
| 2026-06-14 | gameplay | Phase-1 player-loop design (avatar, mining/build UX, inventory, HUD, map) → `gameplay-phase1.md` | **Done ✓** (GP-6…12; surfaced C-1/2/3/5) |
| 2026-06-14 | persistence | Phase-1 slice save/load design (seed+diff, `IPersistable`, chunk keys) → `persistence-phase1.md` | **Done ✓** (PS-5…8; defined C-6; needs C-7/C-8) |

**Phase-1 contract surface C-1…C-9 CLOSED** (reconciliation round 2026-06-14 — 4 controller agents: world-gen pinned `FDepositNode` (C-1/WG-11,12); factory-sim pinned `FRecipeDef`/`FEntityDef` (C-2/FS-10); gameplay pinned `ItemId`/`FItemDef` + slice content + intents (C-3/4/5/GP-13,14); core-engine defined the quiesce handle + `RegionDepth` (C-7/8/CE-8,9,10). Admin reconciled C-8 to Forge=9/Cinder=8, and recorded C-5 physics-side + C-9 rendering confirms (build-time validated). See [PHASE1-PLAN §10](../phase1/PHASE1-PLAN.md#10-phase-1-cross-domain-contract-register-surfaced-by-wave-1-design-confirm-in-wave-2).

**Review pass DONE (2026-06-14)** → [REVIEW-2026-06-14.md](../REVIEW-2026-06-14.md). Independent auditor verdict: strong, disciplined design with a sound thesis, but "build-ready" was overstated. Open items it surfaced (tracked as Q7–Q10 below + the C-8/DepositTypeId doc-debt):
1. **BLOCKER — C-8 not propagated:** lock Forge=9/Cinder=8 into core-engine, factory-sim §11.4, persistence §3.1 (currently 11/9, ~10, 5–6). Mechanical; needs a cleanup pass.
2. **SHOULD-FIX — `DepositTypeId` stale** in gameplay-phase1 (§2.2/3.4/7.2/8.A/8.C) after WG-11 collapsed it into `ItemId`.
3. **Unowned execution layer** → Q7–Q10.

**Post-review cleanup + execution plan DONE (2026-06-14):**
| Item | Status |
|------|--------|
| C-8 propagation (9/8) + `DepositTypeId` scrub | **Done ✓** (1 cleanup agent, grep-verified — no stale live refs) |
| Execution plan (Q7–Q10) | **Done ✓** → [EXECUTION-PLAN](../EXECUTION-PLAN.md) |
| build-tooling controller (owns Q7) | **Created ✓** (9th domain) |

**State: design-complete, internally consistent, execution-planned.** Open for Reid: (a) go-ahead to **start building** (Step-0 git + headless Wave-0 cores — no UE5 needed); (b) **Q9 resourcing answer** (solo/team, hobby/full-time) to turn M2.1–M2.5 into a dated roadmap. Deferred owners: Q8 audio/art, Q10 networking paper-spike.

## 7. Integration milestones
- **M0 — Scaffold (DONE 2026-06-14):** plan + agent architecture + controller files created.
- **M1 — Spikes pass:** all three Phase-0 spikes demonstrated in isolation → engine decision D-001 confirmed or revised. *(All 3 DESIGNED 2026-06-14; D-001 holds on paper. Build/benchmark pending — the actual "pass" needs the Wave-0 headless cores + UE gates.)*
- **M2 — SP vertical slice (Phase 1):** PLANNED 2026-06-14 ([PHASE1-PLAN](../phase1/PHASE1-PLAN.md)) — integration spine M2.1 seamless world → M2.2 flight → M2.3 automation (render-wall measured) → M2.4 progression hook → M2.5 persistence. Build pending (UE5 project + toolchain).
- **M3 — Persistence:** save/load via seed+diff (Phase 2).
- **M4 — Co-op:** authoritative server, 2–8 players (Phase 3).

## 8. Open cross-cutting questions (Admin-owned)
- **Q1 — MP time-warp.** The hardest cross-domain design problem (physics×networking×factory-sim). v1 decision: likely no warp / vote-to-warp. Needs a joint networking+physics+factory-sim mini-study before Phase 3. *Owner: Admin, deferred.*
- **Q2 — Engine confirm.** D-001 (UE5) is provisional until Phase-0 spikes. Spike 1 *design* found no engine-overturning blocker; the open question narrowed to **Chaos physics for the active vessel** (Q5), not UE5 as a whole. Full confirm still gated on building Spike 1 + running the V1–V7/RV/WV gates. *Owner: Admin, gated on M1.*
- **Q3 — Perspective (1st vs 3rd person).** Affects rendering + gameplay + physics (collision capsule, camera). Decision deferred to Phase 1. *Owner: gameplay+rendering.*
- **Q4 — Voxel vs node mining commitment.** v1 = node-based (D-005). Voxel deferred to Phase 4; world-gen kept the API seam (`bFromVoxelPatch`) open. *Owner: world-gen.*
- **Q5 — Chaos vs custom integrator for the active vessel.** **RESOLVED (Spike 2 → PH-4 hybrid):** custom fixed-step symplectic integrator owns the active vessel's flight dynamics; Chaos retained only for collision/contact. Contained in-domain; not a D-001 overturn. Build-time confirmation gate = Spike-1 V4 / Spike-2 G8. *Owner: physics.*
- **Q6 — The render wall (NEW, from Spike 3 RC-8).** Sim can hold 100k+ entities; rendering drawing them at framerate is unproven and out of Spike-3 scope. The factory→render stream is designed to collapse item cost to O(lines) above LOD-0, but integrated "100k *rendered*" is a Phase-1 co-validation jointly owned by factory-sim + rendering. **The single biggest remaining technical unknown.** *Owner: factory-sim + rendering, gated on Phase 1.*
- **Q7 — Toolchain / CI / test-harness owner.** **RESOLVED (2026-06-14):** created the **build-tooling controller** (9th domain) to own version control, the UE5 toolchain, the headless test harness, CI, and the asset pipeline. Plan in [EXECUTION-PLAN](../EXECUTION-PLAN.md). *Owner: build-tooling.*
- **Q8 — Unowned production domains (NEW, review).** Audio, art/asset pipeline, and a *global* performance budget + target-hardware spec have no owner. May warrant new controllers (e.g. an audio/tools or tech-art controller). *Owner: Admin to assign.*
- **Q9 — Schedule / scope / headcount realism (NEW, review).** No effort estimate, timeline, or team-size assumption exists anywhere, despite the plan noting each pillar has cost talented teams *years*. The biggest strategic unknown. *Owner: Reid (resourcing call).*
- **Q10 — Networking replication validation (NEW, review).** RC-9 (is `FFactoryDelta`/`TickIndex` a sufficient replication seam?) is deferred to Phase 3 with zero consumer-side validation, so the "replication-friendly" claims across factory-sim/physics are unaudited. *Owner: networking, gated on Phase 3 — but a paper validation could de-risk earlier.*

## 9. Admin working notes
- Keep this file current as briefs are dispatched and reports return. Update §3 status and §6 table on every delegation cycle.
- Resist absorbing domain detail. If asked a domain-deep question, delegate to the controller and record only the *answer + decision*, not the derivation.
