# Decision-number allocation ledger

**Admin owns this file.** A lane does not pick its own numbers.

## Why this exists

Six numbering collisions happened before this file did. Every one had the same
shape: two lanes appending to the same numbered list at the same time, each
reading a table that was correct when it read it. GP-25 twice, ARCHITECTURE
items 108/109, FS-33/FS-34, GP-57 to GP-60 four ways, and finally a case where
one lane claimed GP-65 to GP-72, committed first, was renumbered around by a
second lane, and the second lane then landed on the renumbered range anyway.

Conventions did not fix it, because the failure is a race and a convention is
not a lock. Reviewing harder did not fix it either. The only thing that works
is that the numbers are handed out by one writer before the work starts.

## The rule

1. Admin allocates a **disjoint block** to each lane **in its brief**, before
   the lane begins.
2. A lane uses only its own block. It never reads the table to decide what is
   free, because that read is the race.
3. A lane that runs out asks Admin for another block rather than taking the
   next number it can see.
4. Unused numbers in a block are **abandoned, not reclaimed**. A gap in the
   sequence costs nothing. Reusing a number costs a day of confusion, and has.
5. Admin updates this file when it allocates, not when the lane lands. An
   allocation that exists only in a brief is invisible to the next allocation.

## Allocated

| Block | Lane | Status |
|---|---|---|
| GP-57 to GP-60 | launch pad placement | landed |
| GP-61 to GP-64 | machine interaction panel | landed |
| GP-65 | combat, health on every buildable | landed |
| GP-66 to GP-72 | combat, claimed then abandoned in a collision | **burned, never reuse** |
| GP-73 to GP-76 | launch pad, clamp and recover and stairs | landed |
| GP-77 to GP-78 | unused remainder of the pad block | burned |
| GP-79, GP-82 | combat, player health and sandbox danger rule | landed |
| GP-80, GP-81, GP-83, GP-84 | combat, claimed and unstarted | held |
| GP-85 to GP-99 | combat continuation: the gun, enemies in the world | allocated |
| GP-100 to GP-114 | Escape menu and cheat panel | allocated, not started |
| GP-115 to GP-129 | VAB overhaul | GP-115 to GP-122 USED (snap near misses, the radial pylon, the probe vite config, the pre-flight verdict, the roll-out confirm, the tabbed rail, recover in the bay, the bay camera); GP-123 onward free |
| WG-29 to WG-30 | the map draws the world | landed |
| WG-31 to WG-32 | tunnel floor, tunnel mouth | landed |
| WG-33 to WG-34 | close-in map contrast, ABI 14 | landed |
| WG-35 to WG-44 | water: the pond basin, the water level authority, ABI 16, swimming | landed (WG-35 blob diagnosis, WG-36 basin + water_field.h, WG-37 water_field_tests, WG-38 ABI 16, WG-39 WaterOracle, WG-40 Swim.ts, WG-41 Capsule/slopeGate split, WG-42 WaterSurface, WG-43 pondwade probe, WG-44 pondshot probe) |
| WG-45 to WG-49 | water remainder: the pump and pipes are NOT in this block, they need an Admin decision first | held |
| PH-45 to PH-46 | tunnel sinking does not reproduce under a mountain | landed |
| PH-47 to PH-59 | tunnel sinking, structural lead | allocated |
| FS-33, FS-35 to FS-42 | corner cargo, pollution, typed items, belt corners | landed |
| FS-43 to FS-57 | Satisfactory-style machine ports | allocated, not started |
| GP-85, GP-86 | combat: enemy loop at ABI 15, the gun | landed |
| GP-87 to GP-99 | combat remainder, enemies in the world | GP-87 to GP-94 landed (nest seeding, derived emitters/targets, the march, the instance pool, both-ways combat, sandbox-safe, rubble named not fixed); GP-95 to GP-98 USED (the garrison spawner and its `provenance` field, the hold/aggro/leash state machine, deterministic seed-owned composition, the one named debug-spawn exception); GP-99 abandoned, never used |
| RN-1 to RN-14 | rendering, historic | landed |
| RN-15 to RN-29 | ground vegetation, contact blending, aerial perspective | allocated |
| FS-56 to FS-75 | assemblers, storage container, machine scale | allocated |
| PH-64 to PH-84 | vessel persistence and on-rails propagation | PH-64 to PH-70 USED (the registry as the one answer to "where is this vessel", the three record modes, ABI 18, the saved form, the player's body parks coherently, the handoff seam, the verified design snapshot); PH-71 onward free |
| RN-45 to RN-69 | graphics pass three: rocks, LOD2 cards, terrain material | allocated |
| GP-100 to GP-114 | Escape menu, cheats, hotbar editing, BUILD MENU on B | allocated |
| RN-30 to RN-44 | rendering: shadow contact, grass height, aerial perspective take two | allocated |
| PH-47 | tunnel sinking, structural lead, not reproduced | landed |
| PH-60 to PH-74 | physics: R18 fall through rock, R18b stuck in a wall | landed at PH-60 to PH-63. **THE TAIL OF THIS ROW OVERLAPS `PH-64 to PH-84` ABOVE AND IS SURRENDERED**: the later allocation is the live one, PH-64 to PH-70 are the vessel lane's, and nothing from the R18 lane may take a number above PH-63. Recorded rather than silently renumbered, because two lanes reading the same row differently is how a number gets used twice |
| BT-27 | the build stamp | landed |
| PS-13 to PS-16 | persistence: R46, named saves through the writeSlot choke point | PS-13 to PS-15 landed; PS-16 burned. Block taken per the Admin brief's own instruction (the PS series lived only in the controller file, ended at PS-12); recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible |
| RN-241 to RN-270 | rendering, the rock geometry pass under ART-DIRECTION.md | RN-241 to RN-247 landed (the fracture vocabulary, four fracture behaviours, the budget raises, the harvestable spire, Mountains and Hills scree, the decoration size-rule correction); RN-248 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| RN-331 to RN-370 | rendering, the look-development pass under ART-DIRECTION.md | RN-331 to RN-337, RN-345 to RN-347 and RN-352 landed (the findings, the adopted response curve, the fourth site that disagreed, the ground/sky mask and the night answer, the foliage tone, the instance variation, the biome substrate table, and the written target at rendering.md 2.1); RN-338 to RN-340 are FINDINGS ONLY and are named as not-done in the entry; RN-353 onward free (Admin correction 2026-08-10: this row said RN-348 free while its own parenthetical lists RN-352 as landed). Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| PH-140 to PH-199 | physics, the autopilot: R43's dv lie, Lambert, transfers, hold-orbit, rendezvous | PH-141 to PH-155 USED (the stage performance fix, ABI 22, `orbital::lambert`, `transfer.h`, the departure sweep, the four `of_ap_*` exports, the allocated plane-change leg, hold-this-orbit, the SAS 180 degree singularity, rendezvous); PH-156 onward free |
| WG-140 to WG-199 | world-gen, Cinder the moon and the lifecycle boundary | WG-141 to WG-150 USED (the moon reachable from the client, the crater ladder, the neighbourhood defect, the rim step, the biome-gain bug one body over, the curvature instrument, the noise counter's blind spot, the atmosphere routing, and the seam analysis); WG-151 onward free |
| GP-261 to GP-271 | gameplay, the autopilot part, VAB reach panel and map planner | landed (the published `of_ap_*` contract, the pending state, the part 0x010D, the reach gate, the NO ANSWER band, the departure chart, the drawn arc, the airless-body plant invariant) |
| GP-272 to GP-299 | gameplay, autopilot execution: arm, cancel, per-frame status | allocated 2026-08-03 |
| GP-300 to GP-349 | gameplay, the end-to-end playthrough of everything landed 2026-08-03 | allocated 2026-08-03 |
| PH-200 to PH-249 | physics, the airless ascent program and R63's calibration | allocated 2026-08-03 |
| PS-40 to PS-89 | persistence, the save has no notion of a second body, and an armed programme does not survive a reload | allocated 2026-08-03 |
| CE-30 to CE-79 | core-engine, the carrier frame term | allocated 2026-08-03. **CE-30 to CE-38 USED** (the term itself); **CE-80 to CE-86 USED** out of block, by the consumer lane; **CE-39 to CE-44 USED** 2026-08-11 by the carrier-rider lane (the membership predicate and its two radii with the gravity volumes excluded; the per-tick decision and its one site in `Loop.fixedTick`; the `visit:station` arrival that seats at rest IN THE FRAME; the census that publishes what the predicate would say right now; `probes/stationboard.js`; and the findings block: `ph357-station-stamp` exists on no reachable ref or remote, three doc SHAs died in the history rewrite, `FloatingOrigin` has no CE-6 Krakensbane trigger at all, and R97's warp guard is unreachable in this build so it was recorded rather than built). **CE-45 and CE-46 USED** 2026-08-11 by the same lane's second pass, after Admin pushed `ph357-station-stamp` (the branch it had reported as unreachable): the merge, the instrument frame retired from `stationboard.js` and kept in `stationride.js` for a different reason, the two fixture rewrites the stamp made necessary, and CE-46, a new class of defect in this suite (**a probe's own snapshot ages now**: a 60-tick-old station reading was exact while the conic was frozen and is 1,879 m wrong now, so anything holding a station-derived value across an `await` is suspect). **CE-47 and CE-48 USED** 2026-08-11 by the r17-reboot lane (R17 closed: the station's install wiring becomes one function called by boot and by every rebuild, `CarrierMounts.lastTick` published so the composition root can pass the live tick, `probes/stationreboot.js`, and the named gap that `of.reboot()` 400 km up does not return). **CE-49 and CE-50 USED** 2026-08-11 by the station-arrival lane, off a player bug report (the press seated Reid inside `col_HallCore`; the arrival is the asset's own spawn socket on the live pose, verified against the walker's own collision query, plus the occupancy assertion and negative control that would have caught it, plus CE-50's generalisation that a position check needs an occupancy check beside it). **CE-51 and CE-52 USED** 2026-08-11 by the frame-render lane, off a second player bug report (the deck stuttered under a motionless player: the camera was interpolated and the hull was not, 27.04 m of sawtooth per tick, fixed by giving the drawn geometry the fractional render tick while the collider keeps the integer one; plus `FrameTrace`, the first per-rendered-frame instrument here, and CE-52's rule that an instrument sampling at the correction rate cannot see the error). **CE-53 USED** 2026-08-13 by the rotor-tolerance lane: `probes/carrier.js` C1's deterministic 1.7240873e-6 rotor failure is `2*acos(|dot|)` conditioning inside the DEBUG INSTRUMENT (`turnBetween`), not the sim, which is right to 4e-11; the angle now comes from `2*atan2(|vec|, |w|)` of the relative quaternion and the probe compares the CHORD `2r sin(w/2)` the discrete pose actually sweeps, at 1e-9. **This one belongs in this file as much as in the controller's:** it is a harness defect that read as a sim defect, it survived a cross-machine reproduction because its error lives on a quantised ulp lattice rather than jittering, and the same instrument was silently reporting 4.21e-8 rad of turn for frames that did not turn. **The transferable rule: `acos` near 1 and `asin` near 1 are not measurements, they are amplifiers , `2/sin(t/2)` here, i.e. 1.2772e5 , so any angle extracted from a dot product of near-parallel unit vectors is suspect at the 1e-6 level and must be read with `atan2` against the perpendicular component instead.** **CE-54 onward free.** Recorded by the lane per rule 5 |
| RN-950 to RN-999 | rendering, the untextured role, the tile scale, the ambient floor | allocated 2026-08-03 |
| RN-845 to RN-899 | rendering, drawing a second body in the sky | allocated 2026-08-03 |
| RN-851, RN-856 to RN-859 | asset lane, docking port and first-person arms | **LANDED INSIDE THE ROW ABOVE. Admin's failure, see note.** Those five are **burned**; the rendering lane must not reuse them |
| RN-900 to RN-949 | asset lane, third-person body and armour set | allocated 2026-08-03 |
| GP-500 to GP-549 | gameplay, the teleport to the moon, loose stones and the pickaxe gate, the autopilot behind the station | GP-500 to GP-505 USED (the Another-world group and the reload route, the already-here refusal, the seven Forge sites blocked off-Forge, the driven runner and its negative control, and the two SCOPING entries for the pickaxe gate and the autopilot milestone); GP-506 USED 2026-08-11 (the whole loose-stones/pickaxe-gate landing: the `requiresToolFor` data gate + named `HarvestRefusal`, the pickaxe/axe recipe move to Stone+Wood, ABI 23, the ObjectiveList `stone` card, and the anti-deadlock bootstrap test — one coherent commit, one number); GP-507 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible |
| GP-450, GP-452, GP-455 | gameplay, an unallocated pass that wrote the moon teleport and never landed | **BURNED, NEVER REUSE.** A gameplay pass on 2026-08-03 wrote the moon-teleport work into the working tree carrying these three numbers, which **this file has never allocated to anybody**, and ended without committing or logging. The next gameplay lane found the files uncommitted, verified them, **renumbered them into its own allocated block** (GP-500, GP-502, GP-505) and landed them. The originals are burned per rule 4. **The lesson is rule 1's, not rule 4's: the pass took numbers it was not given, and nothing but a later reader noticed** |
| RN-1200 to RN-1249 | rendering, the per-part material channel on the machine batch | RN-1200 to RN-1206 USED (the channel itself, the flat-mode positive control, the spreading-distribution property, the `flat`-family bare rule and the measured size of the rest of the family defect, the two literals becoming an interface a Blender instrument parses, the studio rig's self-correction, and `--sundot` not being dead); RN-1207 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| RN-1250 to RN-1299 | rendering, the light on a machine: is the fill missing, and if not what is | RN-1250 to RN-1254 USED (the bounce DOES reach machines and is 29 per cent of the face, the stock ambient floor that was 16.6x to 52.9x too small on its downward half and never moved at night, the 2.1 per cent it buys and the arithmetic that says the residual is albedo times metalness, the `stockfloor=legacy` identity control, and the one-way night half); RN-1255 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| GP-350 to GP-399 | gameplay, the thread past the launch pad, the length of a transfer, and the two charts' refusal vocabulary | GP-350 to GP-353 USED (the three flight rows and the `VoyagePort`, the trip duration off curve word 3, the drawn refusal columns and the pinned affordability rule, the `mapplanner.js` premise that GP-291/GP-295 retired); GP-354 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| BT-30 to BT-59 | build-tooling, VM bootstrap: toolchain on claude-dev (10.10.10.36), clone, build, ctest, LAN-bound serve on :4200 | **BT-30 to BT-39 USED** 2026-08-10 (toolchain provisioned; P1 repo-is-public correction and the still-unresolved deploy-key/push-access gap; the `build.ps1`→`build.sh` Linux port; the Windows-only Chrome-path defect in both `run.mjs` and `boot.mjs`, fixed in both; the stale "21 suites" figure corrected to the actual 41, all green; a toolchain-dependent hash mismatch in the wasm parity fixture, flagged not fixed; the apt-Blender-4.0.2-vs-pinned-5.0.1 mismatch that would have silently corrupted the asset pipeline; the systemd LAN-bound serve; the one smoke-probe stack proof; the Claude-Code-on-the-VM PATH finding); BT-40 to BT-44 already used by the same domain for the separate gate-audit line above this row (allocated in an earlier brief, recorded per rule 5); BT-45 onward free |
| BT-60 to BT-79 | build-tooling, the SwiftShader diagnosis: why `boot.mjs` fails on the VM, and make it green honestly | **BT-60 to BT-66 USED** 2026-08-11 (BT-38's decode failure root-caused to **Git LFS pointer files**, not SwiftShader, and the `.gitattributes` smudge rule that went missing when the blanket `*.png` rule was retired; the `sync-assets` pointer guard, whose own `0.00 MB` had been printing the answer unread; the `GPU stall due to ReadPixels` allowlist entry, the deterministic gate blocker; the GL context-loss episode rule with its measured 0.49%-vs-0.31% pixel evidence, narrow rather than blanket; `boot.mjs --selftest` 4 cases to 7, 7/7; the end-to-end negative control that reproduces BT-38 on demand; and `boot.mjs` GREEN 4 of 4 on the VM); BT-67 onward free |
| BT-80 to BT-119 | build-tooling, the harness gate + the full 4-shard probe sweep (todo #2): verdict exit codes, known-red.json, screenshot-step hardening, sweep + merged triage | allocated 2026-08-11 |
| GP-600 to GP-625 | gameplay, the research station machine (D-019 confirmed): entity, recipe, build tile, panel gate, objective rung | **THE HEAD OF THIS ROW WAS ALREADY SPENT WHEN IT WAS ALLOCATED, AND IS SURRENDERED.** GP-600 to GP-612 were used and committed by the QOL sweep on 2026-08-03 and their entries are in `docs/controllers/gameplay.md`'s decision table; the ledger row covering that lane says only "allocated 2026-08-03" against a wide band, so the used/free split was invisible to this allocation (the rule-5 failure is recorded as GP-620). **GP-613 to GP-620 USED** 2026-08-11 by the research-station lane (the station as the SIXTH `survival::StructureKind` with NO ABI CHANGE, items 0x0045 / TypeId 0x45, placed client-side on the hand-furnace pattern; the 20 Iron + 30 Stone + 10 Copper price and the ruling that there is NO WOOD in it because an airless body has none and a wood cost would make the research screen unreachable there; `ModeRules.researchStationGated` as the sixth named mode question with an existence-gated, named, price-quoting refusal and a `stationGate` report that tells the truth in sandbox too; no hotbar slot and the build menu as the route; the `station` objective rung between the belt card and the pad card; the ripple into `research.js` / `padgate.js` / `survivalrun.js` and its repair; the placeholder assembler mesh with `structures/research_station.glb` OWED BY THE ART LANE; and this collision). **GP-621 to GP-623 USED** 2026-08-12 (the green acceptance and what it measures; the three harness defects that cost five runs, all of them a probe assuming where it could have measured; and the pick-order finding that a station inside a machine's bound cannot be opened with the interact key). **GP-624 and GP-625 USED** 2026-08-12 by the probe-toolgate lane (the two-sweep legal-progression harvest that reconciles this row's own probes with the GP-506 pickaxe gate, and the GP-114 claim restated so it is narrower and better witnessed rather than weakened). **This row is now fully spent.** Recorded by the lane per rule 5 |
| RN-1300 to RN-1310 | UNRECORDED CLAIM: `tools/blender/of_lib.py:50` carries this range live in code, and this ledger never allocated it to anybody (found by the albedo scope lane 2026-08-10) | **burned for new allocation, treated as used by that code; Admin 2026-08-10** |
| WG-151 to WG-165 | world-gen, the POI bridge (of_poi_api.inc per world-gen.md:167, known/visited bits, client Sites.ts); ABI 24 or current+1 at dispatch | **WG-151 USED, 2026-08-12** (the whole bridge: `of_poi_api.inc` at ABI 24, the `known_` bit and its unknown -> known -> visited state machine, `poiabi.ts` + `Sites.ts` + `DebugSites.ts`, `SaveSlot.poi`, the Linux `CHROME_CANDIDATES` fix to `reload.mjs`, and `probes/poisites.js` proven live by real `page.reload()`). One number covers the whole lane rather than splitting sub-decisions across the block, matching how WG-70/WG-116/WG-119 are each cited singly across many files. **WG-152 to WG-165 free.** A first commit (`fed5729`) cited WG-200 to WG-212 and WG-219 by mistake, colliding with the pre-existing unledgered WG-200..218 usage; every code comment and doc citation was renumbered to WG-151 in a follow-up commit, but the first commit's MESSAGE was not rewritten and still names the wrong numbers -- see world-gen.md's WG-151 row |
| WG-166 to WG-185 | world-gen, the ruin-placement lane: draw the SiteCatalog's ruin, make it solid, garrison it, delete the debug spawn hook | **WG-166, WG-168, WG-169, WG-170 and WG-171 USED, 2026-08-13.** The split, exactly: **WG-166** the draw itself and the rule that the placement READS the asset (`socket_grade` out of the .glb bytes as the grade datum, poi.h's own `yawRad` as the orientation, and a hard refusal with a published sentence if the socket ever goes missing rather than a silent 2.3 m burial); **WG-168** the collider joining the ONE `Structures.bodies` set, and the ordering rule `Structures.reset()` forced (place before `g.load()`, reseat in `Persist.apply` right after `restoreStructures`, `RestoreLedger.ruinsReseated` as the number that proves it, and the deliberate choice of the order that runs on EVERY boot rather than only on a load); **WG-169** the garrison wired to the real site (seed = the site id's low half) and `spawnGarrisonDebug` deleted with `EnemyDebug.ts`'s named exception, GP-98's own stated condition met, replaced by `of.ruins('garrison', seed?)` which drives the shipped path; **WG-170** the LOD ladder re-derived from `NodeBatch`'s measured 55/165 into 14.70 and 44.10 BOUNDING RADII against the conifer's measured 3.741 m, with the ruin's own 25.5345 m bound read off the loaded geometry; **WG-171** `probes/ruinplace.js`, its `--body=cinder` negative control, and the three traps logged below. **WG-167 IS DELIBERATELY SKIPPED AND NOT SPENT BY THIS LANE.** The grep this lane was told to run before claiming found `WG-167` live in three places -- `docs/controllers/world-gen.md:117`, `web/wasm/of_poi_api.inc:10` and `core/tests/test_poi.cpp:715` -- all of them citing it as the SPEC that described the poi bridge, and there is no `| WG-167 |` decision row anywhere for them to point at. Every other number in the grant (WG-166, and WG-168 to WG-185) came back with **zero hits** across `docs/`, `web/`, `core/` and `tools/`. Rather than mint a row for a number three files already use to mean something else, WG-167 is left alone: **treat it as spent by the poi spec.** **WG-172 to WG-185 free.** Recorded by the lane per rule 5. |
| GP-520 to GP-532 | gameplay, map marker substrate + milestone bus (grantMilestone; wires the inert Research.earn, ReachedOrbit grant) | GP-520 to GP-523 USED 2026-08-11 (the shared `MapMarker` type + `MarkerRegistry` singleton, `MapPaint.markerPosM` as the one dirBody-to-world conversion both maps call, `MapLayers.drawMarkers` for the 2D canvas with its own `known`-only gate, `Map3D.syncMarkers`'s generic registry source, and the `of.markers` debug source) — **verified green**, `tools/smoke/probes/markers.js`, `valid: true`. GP-530 to GP-532 USED (`grantMilestone` in `Research.ts`, the ReachedOrbit/LandedOffWorld rising-edge wiring in `Systems.ts`, and the `of.research()` debug op). **The mechanism is verified** (`research_tests`: two new ctest cases plus a pre-existing one that already proved `FlightAutopilot` becomes researchable on grant, 17 tests/288 checks green); **the live browser wiring is NOT verified** — `tools/smoke/probes/milestones.js` twice failed to complete in over 90 minutes each against this session's shared VM running at load average 33 to 38 the whole time (measured, not assumed: `uptime`/`ps` showed sibling lanes' own Chrome instances each at 350 to 630% CPU), against a ~29-minute quiet-VM baseline for one build-to-orbit cycle (`map3d.js`). Both attempts confirmed still actively computing when killed for time, not stalled. See `docs/controllers/gameplay.md`'s GP-520 log entry for the full account. GP-524 to GP-529 free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible |
| GP-533 to GP-545 | gameplay, the reveal + scanning antenna content (item, recipe, tech row, one-shot mark_known at build) | **GP-533 to GP-539 USED** 2026-08-13 (the antenna as the seventh `survival::StructureKind`, NO ABI CHANGE — confirmed `abi=24` on every driven run rather than assumed; the price, Iron 25 / Copper 20 / Stone 15, with copper deliberately matching the pad's own; the tech, no prereq and no milestone, on the electricity-cycle ruling; the one-shot reveal itself, `GameplayActions.revealNearbySites` calling the already-shipped ABI-24 `of_poi_near`/`of_poi_mark_known`, with `PoiMarkers.ts` as the one SiteRow-to-MapMarker function both the live reveal and the load-time rebuild share; the marker-registry-is-rebuilt-not-reloaded persistence design plus the `SaveWorlds.ts` compile-time gate catching `antennas` as body-scoped on the first build; the checklist row's `sites.knownCount() > 0` predicate; and `SiteCatalog::insideAnySite` recorded OWED rather than wired, the brief's own permitted fallback once the actual cost of the headline feature was known). GP-540 to GP-545 free. Recorded by the lane per rule 5. **`probes/antenna.js`, survival, 640x360: `valid: true, pass: true, fails: []`.** Sites known 0 -> 1, one `ruin` marker (`known: true`, real unit `dirBody`), the `antenna` checklist row `satisfied: false -> true`, the antenna's own bill (`25 Iron + 20 Copper + 15 Stone`) billed exactly, and a same-run idempotence check (`siteMarkKnown` on an already-known site returns `false`, marker count unchanged). **One harness defect found and fixed in the same lane, not left for the next one**: the first run of the probe under-budgeted its own harvest by measuring science SPENT (8, the tech's cost) rather than science MADE (up to 12, since the crafting loop clicked a fixed count) — Iron for science is 2 per pack, so the gap was 8 Iron, and the antenna's build-menu tile read `affordable: false` with the pack 4 Iron short. Fixed by capping the crafting loop at "stop once nine are held" instead of a fixed twelve clicks, and by raising the smelt targets with real margin; green on the very next run. **GP-540 USED** 2026-08-13 by `lane/rsprobe-gate`: `probes/researchstation.js` §6 was the THIRD file caught by the Electrification/`RuinInvestigated` ripple (GP-549's addendum already fixed `research.js` and `padgate.js` by earning the milestone for real), missed by that sweep's name-grep because this file selects its tech differently. Retargeted to the Scanning Antenna instead of earning the milestone — the opposite fix from `research.js`/`padgate.js`, and deliberately so: §6's claim is that the STATION works as research furniture, not that Electrification specifically unlocks, so a milestone-free tech is the honest purchase. Read from `of.research()`'s tree report before spending anything (asserting the antenna is ungated and Electrification is still milestone-blocked) rather than merely retyped, so the fixture cannot rot the same way twice; kept Electrification as a negative control, clicked for real and shown refused. Full account in `docs/controllers/gameplay.md`'s GP-549 row (second addendum). GP-541 to GP-545 still free. |
| RN-1590 to RN-1609 | rendering/art, A4 wave two on the VM (generator, inserter, power pole, wall/floor/door/pillar/foundation at the SE bar; sockets and colliders immutable) | allocated by Admin 2026-08-14 overnight at dispatch |
| RN-1610 to RN-1619 | rendering, the low-tier sun disc loss (the 64 IBL cube misses the 0.53 deg disc entirely; low and medium tiers get no specular sun) | allocated by Admin 2026-08-14 overnight at dispatch |
| RN-1570 to RN-1589 | rendering, THE LIGHT LANE (sun disc 0.53 deg at 35x irradiance-conserving per RN-1524's recommendation; the smelter shade discriminator, shot geometry vs machine self-shadowing; the sunlit-face machine box RN-1527 and RN-1479 both demand; frame re-takes) | allocated by Admin 2026-08-13 night at dispatch |
| GP-533 to GP-545 | gameplay, the reveal + scanning antenna content (item, recipe, tech row, one-shot mark_known at build) | **GP-533 to GP-539 USED** 2026-08-13 (the antenna as the seventh `survival::StructureKind`, NO ABI CHANGE — confirmed `abi=24` on every driven run rather than assumed; the price, Iron 25 / Copper 20 / Stone 15, with copper deliberately matching the pad's own; the tech, no prereq and no milestone, on the electricity-cycle ruling; the one-shot reveal itself, `GameplayActions.revealNearbySites` calling the already-shipped ABI-24 `of_poi_near`/`of_poi_mark_known`, with `PoiMarkers.ts` as the one SiteRow-to-MapMarker function both the live reveal and the load-time rebuild share; the marker-registry-is-rebuilt-not-reloaded persistence design plus the `SaveWorlds.ts` compile-time gate catching `antennas` as body-scoped on the first build; the checklist row's `sites.knownCount() > 0` predicate; and `SiteCatalog::insideAnySite` recorded OWED rather than wired, the brief's own permitted fallback once the actual cost of the headline feature was known). GP-540 to GP-545 free. Recorded by the lane per rule 5. **`probes/antenna.js`, survival, 640x360: `valid: true, pass: true, fails: []`.** Sites known 0 -> 1, one `ruin` marker (`known: true`, real unit `dirBody`), the `antenna` checklist row `satisfied: false -> true`, the antenna's own bill (`25 Iron + 20 Copper + 15 Stone`) billed exactly, and a same-run idempotence check (`siteMarkKnown` on an already-known site returns `false`, marker count unchanged). **One harness defect found and fixed in the same lane, not left for the next one**: the first run of the probe under-budgeted its own harvest by measuring science SPENT (8, the tech's cost) rather than science MADE (up to 12, since the crafting loop clicked a fixed count) — Iron for science is 2 per pack, so the gap was 8 Iron, and the antenna's build-menu tile read `affordable: false` with the pack 4 Iron short. Fixed by capping the crafting loop at "stop once nine are held" instead of a fixed twelve clicks, and by raising the smelt targets with real margin; green on the very next run. |
| RN-1570 to RN-1589 | rendering, THE LIGHT LANE (sun disc 0.53 deg at 35x irradiance-conserving per RN-1524's recommendation; the smelter shade discriminator, shot geometry vs machine self-shadowing; the sunlit-face machine box RN-1527 and RN-1479 both demand; frame re-takes) | allocated by Admin 2026-08-13 night at dispatch. **RN-1570 to RN-1575 LANDED** on `lane/light` (the discriminator and its named no-op arm; the reversed-depth PCF bias sign defect and its world-metre fix; the 0.53-degree disc at 35.3x; `brightTexels` because `brightFrac` cannot represent a real sun; the sunlit-face box on `smelterhero` with the measurement proving `machine` cannot carry one; `probes/sunshot.js`). **RN-1576 to RN-1589 FREE.** |
| RN-1500 to RN-1519 | rendering, ART CAMPAIGN pass A5 (foliage/rocks: leaf and grass cards off 256 px, RN-311 Forest/Plains GROUND_DETAIL split, RN-101 cards-vs-geometry retest at the SE bar) | allocated by Admin 2026-08-13 night at dispatch; lane records the split |
| RN-1520 to RN-1529 | rendering, IBL/specular null diagnosis (why the PMREM raise bought nothing when panel's band is 0.4 wide; A2b withdrew the stated cause) | **RN-1520 to RN-1525 USED, 2026-08-13, by `lane/ibl-diag`; RN-1526 to RN-1529 surrendered unused.** Grep confirmed the whole block free before it was opened. **THE ANSWER: the environment map contains no bright source, so a PMREM raise had nothing to resolve at any size.** RN-1415's observation stands and now has a cause to replace the one RN-1470 withdrew. The measurement needed a quantity this repo had never read: every prior reading of the sky is downstream of ACES and an 8-bit framebuffer, both of which destroy angular-frequency content. `OFRenderer.cubeRadiance` reads the RGBA16F cube with `NoToneMapping` and linear output for the duration, exactly as `PMREMGenerator` does, so it measures what the PMREM sees. **At a 256 cube on real Windows D3D with RN-64's ground half raised: mean 0.1399, p99 0.5366, max 1.1178, `peakRatio` 7.99, `brightFrac` (above 10x mean) 0.0000 of 393,216 texels.** A real sky runs 1e4 to 1e5. The disc was already 2.25 texels wide at `iblSize` 64, so 256 resolved a feature that was never unresolved. **`sunIntensity` = 15.0 is documented in `Atmosphere.glsl.ts:30` as "Radiance scale for the sun disc" and reaches `uSunColor` and nothing else; the disc is an LDR sprite measuring 0.8859 by difference across the `?ibldisc=` arm, i.e. 1/16.9 of its own declared value.** **TWO ENTRIES THIS FILE IS FOR.** (1) **A CUBE-MAP INSTRUMENT CANNOT REPORT A FEATURE NARROWER THAN ABOUT THREE OF ITS OWN TEXELS, AND THE FIRST READING WAS WRONG BY 2.6x BECAUSE OF IT.** At a 32 cube (2.8 degrees per texel) the same capture read `atSun` 0.4305 against a max of 0.7314 and would have been reported as "the sun is dimmer than the horizon haze" -- a more dramatic claim, and false. The disc is 3.15 degrees, so the texel straddles its falloff and box-filters the peak away; at 256 it reads 1.1158 and IS the maximum. Any peak read off a low-resolution capture is a LOWER BOUND. (2) **A BOX AGGREGATE CANNOT SEE A SMALL BRIGHT HIGHLIGHT, AND THREE NULLS IN A ROW WERE NEARLY READ AS "THE CHAIN IS BROKEN".** A verified mirror arm (`?ibldiag=mirror`, `overrides: 14`, every row reading metalness 1 / roughness 0.02 live) moved the canonical box hugely against the shipped material (luma 20.43 -> 24.54, iqr 15.30 -> 31.32) yet did not move at all between disc gains of 1, 15 and 200 (24.54 / 24.54 / 24.55, `hiFrac` 0 throughout). The right reading is not "the specular chain is dead": a 3.15-degree disc is 1.9e-4 of the sphere, so the reflecting normal set is that fraction and this pose contains none of it. **The discriminator that made the null readable was sweeping the gain 13x further (200) rather than re-measuring at 15**, because a term that is present but dim moves under a 200x sweep and a term that is geometrically absent does not. **The shipped default was NOT changed and that is the deliverable's other half**: at k=15 the shipped machine box moves 20.43 -> 20.44 and the sphere-averaged diffuse rises 0.51 per cent (a genuine double count, since the directional light already carries the sun's GGX lobe), so raising it would have made a real defect look addressed while moving nothing. Identity proven rather than asserted: with the flag absent the machine box reads 20.43 / 5.79 / 19.23 / 39.12 / 15.30 / 0.704 and forestfloor 27.32 / 75.35, both bit-identical to RN-1479's recorded rows. Two new page flags, both TRI-STATE and both registered in `run.mjs` in the same commit that introduced them: `ibldiag`, `ibldisc`. New probe `tools/smoke/probes/ibldiag.js`, `pass: true, fails: []`. **RN-1526 AND RN-1527 USED IN A SECOND PASS, AFTER A FRESH-CONTEXT VERIFIER REFUSED THE FIRST COMMIT, AND THE VERIFIER WAS RIGHT.** It ran `?ibldiag=mirror` and got the canonical box at luma 20.44 to 20.61 against the lane's reported 24.54, and asked whether the environment reached machine materials at all. **Reproduced: `?ibldiag=mirror` ALONE is BIT-IDENTICAL to the shipped frame (20.43 / 39.12 / 15.30) while `overrides` reported 14 and every material row read `metalness 1, roughness 0.02` live.** `PartMaterial`'s injected GLSL **assigns** `roughnessFactor`/`metalnessFactor` from the per-vertex channel rather than scaling the material's own, so with the channel on those uniforms are dead and the override writes numbers nothing reads. The lane never saw it because every one of its runs carried `?machinemat=0` beside the mirror; the requirement was written in the file header, which is exactly the placement that gets skipped. **THREE ENTRIES FOR THIS FILE, all of them about the instrument and none about the game.** (3) **AN ARM THAT NEEDS A SECOND FLAG BESIDE IT TO MEAN ANYTHING WILL BE RUN WITHOUT IT.** The precondition belongs in the code, not the comment: `machineMatEnabled()` now folds in `iblDiagMirrorOn()`, so the arm cannot be half-armed, and `machineMatState().mirrorForcedOff` publishes why. After the fix the verifier's exact command reproduces 24.54 / 65.78 / 31.32. (4) **A COUNTER THAT COUNTS AN ASSIGNMENT IS NOT EVIDENCE THAT ANYTHING READS IT.** `overrides: 14` was a true statement about a CPU-side write and a false one about the frame, which is MachineMat's own failure mode (a) wearing the green light this lane built to prevent it. The honest instrument is a differential on the pixels, and it is now what the arm is judged by. (5) **A TWO-VARIABLE PAIR REPORTED AS ONE.** The first commit compared mirror+`machinemat=0` against the shipped frame and attributed all of 20.43 -> 24.54 to the mirror; `machinemat=0` alone is worth -0.67 luma and +1.66 iqr of that, and the corrected one-variable pair is 19.76 -> 24.54 / 16.96 -> 31.32. The conclusion survived, which is luck rather than method. **AND THE FINDING THE RECONCILIATION PRODUCED, which is the most useful thing in the lane: `?ibldiag=noenv` (SkyIbl assigns null, everything else identical) takes the canonical machine box from 20.43 to 0.06 luma while the same frame's world box only falls 32.41 to 22.08 — the machine is a black silhouette in a fully lit world. The box is 99.7 per cent IBL-lit and receives essentially no direct sun, so RN-1200's rectangle CANNOT register a change to the sun, its specular, or any direct-light term, by construction.** That is a second, independent reason A0 owes the machine shot another box beyond RN-1479's. Third page flag from this pass: `ibldiag` gains comma-separated words (`mirror`, `noenv`), registered already. Recorded by the lane per rule 5 |
| RN-1500 to RN-1519 | rendering, ART CAMPAIGN pass A5 (foliage/rocks: leaf and grass cards off 256 px, RN-311 Forest/Plains GROUND_DETAIL split, RN-101 cards-vs-geometry retest at the SE bar) | **RN-1500 to RN-1504 USED** 2026-08-13 by `lane/art-foliage` (grass card's zero-transparent-column defect fixed by narrowing root half-width 0.058..0.082 -> 0.026..0.040, root-row opacity 100% -> 68.6%; leaf card's 22.7%-opaque root fixed with a root flare; both raised 256 -> 1024 px per D-020 decision 4, coverage bands re-measured honestly rather than carried over; `ALBEDO_EDGE` bug found and fixed, a fixed UV-fraction ramp that quietly became 4x wider at 1024px and broke `_halo_worst`'s own negative control; bark's albedo (RN-1472) given more contrast after a render showed it reading airbrushed beside its own fissures; `render_flora.py`/`surface_preview.py` fixed so a scene can show card families AND tiling families together, which is what let the bark verdict be taken from an actual tree render; RN-311's Forest/Plains split turned out to be ALREADY CLOSED by WG-91 twelve days earlier, this lane found the two places that still said otherwise and corrected them; RN-101 retested for ground-level understorey specifically and re-affirmed, full write-up in `docs/controllers/rendering.md` section 3). RN-1505 to RN-1519 FREE. No new page flags. Frames: `docs/screenshots/RN1500_forestfloor_{before,after}.png` (D3D, matched camera/sun, `artframe.js` forestfloor shot), `docs/screenshots/RN1500_bark_{before,after}_{a,b}.png` (Blender studio render, `Canopy_Pine_LOD0`), `docs/screenshots/RN1500_understorey_retest.png` (Blender `floor:forest`, corrected density table) |
| RN-1520 to RN-1529 | rendering, IBL/specular null diagnosis (why the PMREM raise bought nothing when panel's band is 0.4 wide; A2b withdrew the stated cause) | allocated by Admin 2026-08-13 night at dispatch |
| RN-1530 to RN-1549 | rendering/art, A6 owed models at the SE bar on the VM (research_station.glb, scanning_antenna.glb, their ASSET-SPECS and contracts rows) | allocated by Admin 2026-08-13 night at dispatch |
| RN-1550 to RN-1569 | rendering/art, A4 machine form wave one on the VM (miner, belt, box, assembler at the SE bar; sockets and colliders immutable) | allocated by Admin 2026-08-13 night at dispatch. **RN-1550 to RN-1566 USED 2026-08-14 by the A4 wave-one lane (`lane/art-forms`); RN-1567 to RN-1569 free, surrendered unused.** **RN-1550, `paintchip` AND `rust` ACQUIRE THEIR FIRST CONSUMERS.** Both families have shipped as pixels since RN-1474/RN-1475 with `NO ROLE WEARS THIS YET` in their own `FAMILIES` rows, and until RN-1478 no role could have worn them on a machine, because `MachineBatch` pinned `panel` unconditionally. Two roles added in one commit across all four tables the gate compares: `of_lib.PALETTE` (`SteelWorn` 8A9199 / 0.75 / 0.55 and `SteelRust` 834F2A / 0.35 / 0.92, both constants dictated by the family's own stated pairing rather than chosen, and 834F2A is the per-channel midpoint of the 7A4526..8C5A2E range texgen names), `texgen.ROLE_FAMILY`, `Surfaces.ts` `ROLE_FAMILY` **and its `Family` union**, which had never listed either family and was a compile error the moment a role pointed at one. Full clean `texgen.py build` regeneration: **all 33 shipped PNGs byte-identical**, `surfaces.json` moves by exactly the two role rows (plus this VM's `zlib` runtime string 1.3.1 -> 1.3, which is recorded, gates nothing, and is a fact about the machine that built it). `check:roles` 41 -> 43 roles, all four tables agreeing including the served manifest. **RN-1551**, `machine_form.py`'s importer list corrected to include `build_box.py` in the same commit as the import (RN-1103's rule), and the BELT deliberately excluded with the reason stated there: the LAYER table is in absolute metres derived against 4-8 m machines, so a 74 mm cable tray on a 100 mm rail is a pipe. **RN-1552**, three greebles added: `guard_cage` (the vocabulary had nothing for a guard over a moving part, which is what D-020's bar is actually about), `bolted_plate` (the commonest hand-written two-line idiom, with the bolt positions DERIVED from the plate so they cannot be retuned apart) and `hose` (a flexible run: no elbow fittings, a clamp band at each fixed end). **RN-1553 to RN-1556, THE BOX**, the last 4 m machine that had never had a form pass: lod0 564 -> 1,384 against miner 1,384 and smelter 2,276 on the same 4 x 4 cell, and a boulder at 556. **RN-1556 is where `check_shadow_lod` changed a decision rather than confirmed one**: the step tread's two risers sit on the 0.232 `bracket` layer in open air, and that ONE detail took LOD1 from 126.49 mm to 232.00 mm, past cascade 2's 210.94 mm texel, taking the asset's marginal multiplier 3.0x -> 4.0x. Twelve triangles of stand-in on LOD1 bought it back (200.00 mm, c2 earned, 3.0x restored, LOD1 192 -> 204). **RN-1557 to RN-1559, THE MINER**: a guard cage over the rotating column (240 of the 648 added triangles, and it does NOT close the gantry - the deposit shows between the bars, which is the whole reason this machine has no plinth), a vent bank, foot-pad anchor bolts, a bolted cap flange, a dust hose, and **RN-1558 the first `rust` in the game** on the three wet-ore faces only. **THE ROLE CHANGE REVEALED A LATENT DEFECT RATHER THAN CREATING ONE**: the throat plate's back and bottom faces sat on exactly the two planes the chute shelf occupies, invisible for as long as both were `SteelDark` because `check_coplanar` deliberately does not count a same-material overlap. Painting one of them made 7 same-facing pairs appear; fixed at the cause (the throat is now buried in the sill and the housing) rather than at the paint. **RN-1560 to RN-1562, THE ASSEMBLER**: a guard over the turret the 2.6 m arm sweeps from, its rigid power conduit replaced by a hose (a rigid duct cannot serve a rotating joint), jacket-band bolts, and `SteelWorn` on the two front buttress corners and the step tread. The Hazard kick plates are deliberately NOT converted: a keep-out marking is meant to stay legible. **RN-1563 to RN-1565, THE BELT, and the number that decided its whole shape.** Each rail was one extruded box and the two rail faces ARE the belt (everything else is buried in a neighbour, the ground or the deck); they are now a fabricated section with flanges on the cell edge, a lightening pocket, a mid-span stiffener, solid full-section ends and a splice plate with bolts. **THE POCKET IS 15.0 mm BECAUSE CASCADE 0 IS 15.47 mm PER TEXEL**: measured, LOD1 went 1.87 -> 15.00 mm and still earns c0/c1/c2, so the marginal multiplier stays at 1.0x and all three cascades keep drawing the 108-triangle proxy rather than promoting the 340-triangle mesh. The tile ENDS stay solid full-section so the straight-to-curve seam `belt_curve_common.py` shares dimensions to preserve is unchanged. **RN-1566, AN INSTRUMENT FIX FOUND BY USING IT**: every machine render in the repo was failing with "MachineBatch's material declares no roughness" because RN-1478 added a comment to `makeMaterial` quoting the string `new THREE.MeshStandardMaterial({...})`, which is the FIRST literal occurrence of that text in the file, so `render_machines.client_machine_material` matched the sentence describing the parser instead of the constructor four lines below. The instrument was right to stop rather than guess and was reading the wrong thing; whole-line `//` comments are now stripped before the search. **HONEST NEGATIVE RESULTS.** (a) The miner's LOD1 deviation got WORSE, 449.23 -> 623.57 mm, with no change in what it earns (none, before and after) because the pre-existing 449 already denied it every cascade; recorded rather than hidden, and the proxy is owed. (b) `belt_curve_l/r` and `belt_end_cap` now owe the same rail section and the same `SteelWorn` flange for family coherence; the change was deliberately shaped so the geometric seam is identical today, but the roughness will differ at a corner until they get it. (c) `structures/ruin` (632 coplanar) and `rocket_parts/NoseCone_LOD0` (check_mating) fail on this branch and are PRE-EXISTING in assets this lane never touched. Recorded by the lane per rule 5 |
| RN-1530 to RN-1549 | rendering/art, A6 owed models at the SE bar on the VM (research_station.glb, scanning_antenna.glb, their ASSET-SPECS and contracts rows) | allocated by Admin 2026-08-13 night at dispatch. **USED 2026-08-14, NINE OF TWENTY; the remaining eleven are ABANDONED under rule 4, not reclaimed.** RN-1530 the block itself; RN-1531 to RN-1537 the seven Cycles receipt frames (`RN1531_station_hero`, `RN1532_station_console`, `RN1533_station_service`, `RN1534_antenna_hero`, `RN1535_antenna_sky`, `RN1536_antenna_base`, and `RN1537_{station,antenna}_lods`, which share RN-1537 because they are ONE shot definition rendered over two assets rather than two passes); RN-1543 the two rows added to `machine_form.LAYER` (`grime`, `stain`) so a two-part wear mark stops putting both halves on one plane in two roles. **RN-1538 to RN-1542 and RN-1544 to RN-1549 were never used and are abandoned.** Nothing here was a measurement pass, so no number carries a before/after pair; the four numbers this lane actually produced (52.80 mm, 55.73 mm, 108.00 mm, 443.73 mm of shadow-LOD deviation) are properties of the shipped bytes read by `check_shadow_lod.py` and are recorded in `contracts.json` and ASSET-SPECS section 4.26/4.27 rather than against an RN |
| RN-1550 to RN-1569 | rendering/art, A4 machine form wave one on the VM (miner, belt, box, assembler at the SE bar; sockets and colliders immutable) | allocated by Admin 2026-08-13 night at dispatch |
| RN-1405 to RN-1449 | rendering, ART CAMPAIGN pass A0+A1 (look-dev target frames + light/post foundation: owed D-016 consumer retune, PMREM off 64sq, shadow softening, canonical shot manifest) | allocated by Admin 2026-08-13 at dispatch; lane records the used/free split when it lands |
| RN-1462 to RN-1499 | rendering, ART CAMPAIGN passes A2a+A2b (KTX2 + map slots; texgen material families: panel roughness band, rust, paint-and-chip, edge-wear mask, RN-1203 role fix) | allocated by Admin 2026-08-13 at dispatch (A2a takes the low end); lane records the split. **RN-1462 USED, 2026-08-13, by the A2a lane (`lane/art-mapslots`), one number for the whole coherent delivery rather than one per file, matching the WG-151/GP-680 precedent.** The KTX2/basis loader wired into `Loaders.ts` (`initKtx2`/`loadTexture`, transcoder shipped locally via `sync-assets.mjs` out of three's own npm package, never a CDN) and into `Renderer.ts` (`detectKtx2Support`, the one seam crossing, mirroring `environmentFrom`); `emissiveMap`/`alphaMap`/`normalScale` wired at `Surfaces.ts`'s one site following the five shipped slots' pattern exactly, including D-016's hard-error discipline (an `alpha` map with no valid `alpha_test`, or either new tiling map with no `tile_m`, throws rather than silently loading wrong); and the bare-`blender`-vs-`blender501` sweep of `tools/blender`, counted not fixed (79 occurrences across 67 files, all documentation/usage-comment header lines, zero actual subprocess invocations anywhere in the repo, confirming the campaign plan's own figure exactly). **No texture converted; no manifest version bump; `surfaces.json` v2 unchanged and every shipped family reads identically before and after** (verified live: `?tile=` aside, `__ofSurfaces.report()` on a real Windows D3D boot shows `emissive`/`alpha` false and `normalScale: 1` on every family, `mismatches: []`). RN-1463 to RN-1469 (A2a's ceiling) free, surrendered unused. |
| RN-1405 to RN-1449 | rendering, ART CAMPAIGN pass A0+A1 (look-dev target frames + light/post foundation: owed D-016 consumer retune, PMREM off 64sq, shadow softening, canonical shot manifest) | **RN-1405 to RN-1421 USED** 2026-08-13. **RN-1405 to RN-1414**, the A0 shot manifest: `web/tools/smoke/probes/artframe.js`, five named shots in one `SHOTS` table, captured through `of.screenshot()` (HUD-free by construction; `run.mjs --out` is a PAGE screenshot and photographed the objectives panel and an interaction tooltip over the subject), refusing any frame with `__ofPost.state().post` false so a judged frame cannot be silently ungraded, publishing its own `postState`/`shadow`/`ibl`/`render` block per frame; three rejected framings recorded with their reason (ruin bearing 35 occluded, bearing 200 fully backlit; base bearing 210 occluded; base at dot 0.12 unreadable at world luma 15.6, moved to `lookdev.js`'s own 0.20 dusk rung). **RN-1411**, the station shot is the EXTERIOR after three frames came back at world luma 2.1-2.8 with every field reading correct; the pair is not camera-matched because the carrier's position is a function of tick count, and that is stated. **RN-1412 OPEN and cross-domain**: `of.standAt` zeroes absolute velocity so it cannot board a deck orbiting at 7.67 km/s, `stationdraw.js` fails unmodified on the shipped build with the eye 11,653.895 m out (= 7.67 km/s x its own 1.52 s settle); `artframe.js` boards through the pause-menu `visit:station` row instead, as `stationframe.js` does. **RN-1415**, PMREM cube size 64 for every tier becomes 64/128/256 by tier behind a tri-state `?iblsize=`; rebuild 0.6-1.0 ms at 256 against the 10.5 ms SkyIbl records at 64, and it moves the most IBL-dominated subject in the game by under half a count (20.52 to 20.43), which FALSIFIES the scope audit's 'PMREM at 64 mushes all specular' as the binding cause: `panel`'s roughness band is 0.032 wide and a 256 cube cannot show a variation the material does not have. Shipped as free and as an A2b prerequisite. **RN-1420**, shadow softening REFUSED with a price: three r185 has deprecated `PCFSoftShadowMap` (no-op plus a console warning the runner fails on) and VSM, measured one flag apart on one binary at one pose and one pinned sun, costs 2.18x the near pass and 2.04x the frame (p50 9.4 to 19.2 ms, over the 16.6 ms budget) while lifting the shadowed subject 24.4 per cent through light bleed; default false on every tier, `?shadowsoft=` kept so the next lane re-prices rather than re-discovers; `shadow.texel0M` and `shadow.soft` now published, and texel0M reads 0.01547, confirming §2.1.5's 15.47 mm off the runtime. **RN-1421**, D-016's owed consumer verification, measured against a second dist whose `surfaces.json` carries the seven pre-fix sRGB means with `version` still 2 (arms one file's contents apart, per-family ratios reproducing rendering.md's recorded factors to four figures): machine box +90.2 per cent (10.79 to 20.52), forest groundNear +10.3 per cent (24.79 to 27.34) with p95 +31.9, `hiFrac` 0 in both boxes in both arms so nothing clips and the owed retune is NIL as a measurement rather than as a skip; the same arm found the ruin box moves 0.3 per cent because `RuinSites.ts` draws via `loadGlb`+`selectLod` and never `attachSurface`, so the structure high-water mark has no maps wired at all (wave A4/A6). §2.1 unmoved, `lookdev.js` at the forest site on both binaries agreeing to <= 0.2 counts on every box. **RN-1422 to RN-1449 FREE.** Two new registered page flags, both TRI-STATE and both registered in `run.mjs` in the same commit that introduced them: `iblsize`, `shadowsoft`. **RN-1422 USED, 2026-08-13, by the ruin-maps fix lane (`lane/ruin-maps`), closing exactly the gap RN-1421 named above** ("the ruin box moves 0.3 per cent because `RuinSites.ts` draws via `loadGlb`+`selectLod` and never `attachSurface`"). `RuinSites.ts`'s `spawn()` now traverses the cloned template once per placement and calls `attachSurface(mat, familyForMaterial(mat), 'ruin:'+mat.name)` for each unique material, deduped through a `surfaced` `Set<THREE.Material>` field (`clone(true)` SHARES the material across every ruin instance, so `PlayerRig.ts`'s own dedup shape is copied rather than re-derived). This is the SAME per-object gap `PlayerRig.ts`'s header already named ("every batched path and no per-object one") for a different file; the ruin is the second per-object consumer and took the same fix. The ruin's 8 shipped roles (`OF_RockDark`, `OF_Rock`, `OF_Sand`, `OF_LeafDry`, `OF_LeafDeep`, `OF_Soil`, `OF_Copper`, `OF_Coal`) were ALREADY three-way agreed in `ROLE_FAMILY`/`surfaces.json`/`check-roles.mjs` (`check:roles`: 53 .glb, 41 shipped roles, 41 in surfaces.json, 41 in ROLE_FAMILY, all three agree), so no new role row was needed; this is wiring only, no asset or manifest change. Measured on a real Windows D3D boot (`tools/smoke/probes/artframe.js`, shot `ruin`, box `[0.28,0.30,0.74,0.61]`), before (pre-fix dist) vs after (this fix), both `postState.post: true`: box luma 73.28 -> 70.48, mean RGB [62.09,75.9,80.3] -> [59.88,73.01,76.52], warm -18.21 -> -16.64, p50 21.09 (from 26.16), loFrac 0.459 -> 0.558, shader program count 53 -> 55 (new material variants for the newly-mapped roles). `tools/smoke/probes/ruinplace.js`: `fails: []` on Forge and on the `--body=cinder` negative control, no functional regression. `npx tsc --noEmit`, `npm run build`, `check:roles` and `check:proxies` all clean. **RN-1423 to RN-1449 free.** Recorded by the lane per rule 5 |
| RN-1462 to RN-1499 | rendering, ART CAMPAIGN passes A2a+A2b (KTX2 + map slots; texgen material families: panel roughness band, rust, paint-and-chip, edge-wear mask, RN-1203 role fix) | allocated by Admin 2026-08-13 at dispatch (A2a takes the low end); lane records the split |
| RN-1405 to RN-1449 | rendering, ART CAMPAIGN pass A0+A1 (look-dev target frames + light/post foundation: owed D-016 consumer retune, PMREM off 64sq, shadow softening, canonical shot manifest) | **RN-1405 to RN-1421 USED** 2026-08-13. **RN-1405 to RN-1414**, the A0 shot manifest: `web/tools/smoke/probes/artframe.js`, five named shots in one `SHOTS` table, captured through `of.screenshot()` (HUD-free by construction; `run.mjs --out` is a PAGE screenshot and photographed the objectives panel and an interaction tooltip over the subject), refusing any frame with `__ofPost.state().post` false so a judged frame cannot be silently ungraded, publishing its own `postState`/`shadow`/`ibl`/`render` block per frame; three rejected framings recorded with their reason (ruin bearing 35 occluded, bearing 200 fully backlit; base bearing 210 occluded; base at dot 0.12 unreadable at world luma 15.6, moved to `lookdev.js`'s own 0.20 dusk rung). **RN-1411**, the station shot is the EXTERIOR after three frames came back at world luma 2.1-2.8 with every field reading correct; the pair is not camera-matched because the carrier's position is a function of tick count, and that is stated. **RN-1412 OPEN and cross-domain**: `of.standAt` zeroes absolute velocity so it cannot board a deck orbiting at 7.67 km/s, `stationdraw.js` fails unmodified on the shipped build with the eye 11,653.895 m out (= 7.67 km/s x its own 1.52 s settle); `artframe.js` boards through the pause-menu `visit:station` row instead, as `stationframe.js` does. **RN-1415**, PMREM cube size 64 for every tier becomes 64/128/256 by tier behind a tri-state `?iblsize=`; rebuild 0.6-1.0 ms at 256 against the 10.5 ms SkyIbl records at 64, and it moves the most IBL-dominated subject in the game by under half a count (20.52 to 20.43), which FALSIFIES the scope audit's 'PMREM at 64 mushes all specular' as the binding cause: `panel`'s roughness band is 0.032 wide and a 256 cube cannot show a variation the material does not have. Shipped as free and as an A2b prerequisite. **RN-1420**, shadow softening REFUSED with a price: three r185 has deprecated `PCFSoftShadowMap` (no-op plus a console warning the runner fails on) and VSM, measured one flag apart on one binary at one pose and one pinned sun, costs 2.18x the near pass and 2.04x the frame (p50 9.4 to 19.2 ms, over the 16.6 ms budget) while lifting the shadowed subject 24.4 per cent through light bleed; default false on every tier, `?shadowsoft=` kept so the next lane re-prices rather than re-discovers; `shadow.texel0M` and `shadow.soft` now published, and texel0M reads 0.01547, confirming §2.1.5's 15.47 mm off the runtime. **RN-1421**, D-016's owed consumer verification, measured against a second dist whose `surfaces.json` carries the seven pre-fix sRGB means with `version` still 2 (arms one file's contents apart, per-family ratios reproducing rendering.md's recorded factors to four figures): machine box +90.2 per cent (10.79 to 20.52), forest groundNear +10.3 per cent (24.79 to 27.34) with p95 +31.9, `hiFrac` 0 in both boxes in both arms so nothing clips and the owed retune is NIL as a measurement rather than as a skip; the same arm found the ruin box moves 0.3 per cent because `RuinSites.ts` draws via `loadGlb`+`selectLod` and never `attachSurface`, so the structure high-water mark has no maps wired at all (wave A4/A6). §2.1 unmoved, `lookdev.js` at the forest site on both binaries agreeing to <= 0.2 counts on every box. **RN-1422 to RN-1449 FREE.** Two new registered page flags, both TRI-STATE and both registered in `run.mjs` in the same commit that introduced them: `iblsize`, `shadowsoft` |
| RN-1462 to RN-1499 | rendering, ART CAMPAIGN passes A2a+A2b (KTX2 + map slots; texgen material families: panel roughness band, rust, paint-and-chip, edge-wear mask, RN-1203 role fix) | **RN-1470 to RN-1477 USED** 2026-08-13 by A2b (`lane/art-materials`); RN-1462 was A2a's and RN-1463 to RN-1469 were surrendered unused by it, confirmed by grep before this block was opened. **RN-1470, THE PASS'S OWN HEADLINE WAS FALSE AND THE MEASUREMENT IS THE DELIVERABLE**: `panel`'s effective roughness p05..p95 band is **0.184 on Steel and 0.143 to 0.245 across its six roles**, not the 0.032 section 2.1 item 4 has carried since 2026-08-01, because RN-553 re-authored `_panel_masks` *the same day, four commits later*, and nobody edited the bullet back; the same bullet's "`ore` measures 0.28 to 0.37, the family to copy" was never true under any palette this repo has shipped (ore measures 0.175/0.226/0.319) and panel now beats ore on five of six roles. Verified by a fresh-context agent that wrote its own PNG decoder and regenerated `of_panel_orm.png` byte-identically from source before measuring. The stale sentence had propagated into the scope audit, into two lines of `ART-CAMPAIGN-2026-08-13.md`, and into **RN-1415's stated CAUSE**, which is therefore withdrawn: the PMREM observation stands, its explanation does not. **RN-1471**, `_coarse_masks` widened where the measurement actually pointed: coarse held the two worst bands in the game (Copper 0.075, Iron 0.086) and its ormG span goes 0.2157 to 0.3255, taking Soil/Sand/Regolith/Coal/Rubber to 0.277..0.325; the root cause was a `_smoothstep(0.15, 0.85, height)` on a raw field whose mass sits between 0.3 and 0.7, so the coefficient was never spending what it declared, which is `_panel_masks`'s own "the thresholds are where the band lives, not the coefficients" a second time. Iron and Copper reach only 0.130/0.114 and are **palette-side, not map-side** (0.40 constant), as is `SteelLight` at 0.143; all three are recorded and refused rather than chased, because widening a shared map to rescue one role over-polishes the six that wear it. **RN-1472**, the two missing tiling albedos the audit named: `bark` (vertically stretched weathering zones, bimodal lichen leaning COOL, the file's first cool stain) and `coarse` (almost purely VALUE, because seven roles spanning Sand to Coal share no hue and a warm stain that reads as damp soil reads as rust on the iron chunk); both read neither `height` nor `aux`, following `_stone_albedo`. **RN-1473**, `_edge_wear`, the curvature/edge-wear mask, honestly named: it is NOT curvature and cannot be, because box projection means a tiling map cannot know where a mesh's edges are, so it is local convexity of the MAP, and it is the `_ao` signal with its sign flipped so occlusion and exposure cannot disagree about where a crevice is. **RN-1474 `paintchip`** and **RN-1475 `rust`**, the two D-020 vocabulary families, 512 px at panel's 1.5 m tile: paintchip is a coating failing on sound steel with metalness going UP as paint leaves (span 0.722, the widest in the game), rust is the steel itself failing with metalness going DOWN because oxide is a dielectric, and the two moving one channel in opposite directions is the evidence they are two facts rather than one family with a slider. Both ship UNREFERENCED, following the `leaf`/`grass` precedent. **RN-1476**, the client stops eagerly loading a manifest family no role wears, derived from `ROLE_FAMILY`'s own values rather than listed so it cannot drift, which is what makes shipping vocabulary ahead of wiring cost nothing (it would otherwise have been ~3 MB of transfer and ~8 MB of VRAM to draw nothing, against a 7.9 MB whole-game budget). **RN-1477**, the KTX2 encoder question ANSWERED AS A DECISION AND NOT AS BYTES: the obvious choice, the native `basisu` CLI, is **not byte-reproducible across Windows and Linux** for ETC1S or UASTC+RDO (different bytes even single-threaded, so it is codegen and not thread count) and UASTC+RDO is non-deterministic run-to-run on one machine; the pure-wasm `ktx2-encoder@0.6.0` is byte-identical on both hosts for both codecs at a ~3% size penalty. A pipeline built on the native CLI would have silently ended DW-5's byte-identical gate, which is the entire reason `texgen.py` owns its own PNG encoder. No encoder installed and no `.ktx2` produced: this needs an Admin-logged devDependency decision, and it is the one job in the brief this lane did not land. **RN-1478 to RN-1499 FREE.** No new page flags. |
| RN-1478 to RN-1489 | rendering, MACHINE MATERIAL UNPIN (`lane/machine-unpin`), the A4 gateway: route machine materials through the authored-role path and close what RN-1203 left open | **RN-1478 and RN-1479 USED** 2026-08-13; grep confirmed the block free before it was opened, and **RN-1480 to RN-1489 are surrendered unused**, as are RN-1490 to RN-1499 which were never this lane's (smelter shot lane). **RN-1478**: `MachineBatch` pinned `panel` onto every machine part, and it now builds ONE `BatchedMesh` per authored family, each taking the ordinary `attachSurface(mat, familyForMaterial(mat))` that `RuinSites` and `PlayerRig` already make, so D-016's mean-neutral divide, the `setMaps` isolation toggles and `surfaceReport`'s per-material row all come free instead of being reimplemented. The pool stays ONE pool: a slot is added to every layer in the same order so slot n means the same machine everywhere, and a layer with nothing to draw for a template points at three degenerate vertices and stays invisible. Measured off the shipped `.glb`, the five machine pools author FOUR tiling families between them and no pool authors more than three, so 5 meshes become 14 and the machine shot goes **77 to 85 draw calls, exactly `factoryMachines`'s two extra layers times the eye plus three cascades**. **THE SAMPLER BUDGET IS THE MEASUREMENT THAT CHOSE THE DESIGN and it refused the one `rendering.md` section 7 proposed**: `MAX_TEXTURE_IMAGE_UNITS` is **16** on the real D3D11 path (not the 32 a desktop GPU is assumed to give), one machine program binds 5 surface samplers + 1 PMREM env + 3 cascade shadow maps = **9 of 16, unchanged by this pass**, and each extra family on one material costs albedo+normal+ORM = 3, putting `factoryMachines` at 15 and `beltCargo` at **18, over the limit**, with A4's `rust`/`paintchip` unwireable on any machine that also carries stone. `render_machines.py`'s regex-read `metalness: 0.45 / roughness: 0.55` did not move. `leaf` stays folded into `panel` structurally (a unit-UV card cannot be sampled by a metre-UV path; `isTilingFamily` is verified against the manifest's own `uv_space` the way `ROLE_FAMILY` already is). **RN-1479, AND IT IS THE HALF THE BRIEF DID NOT EXPECT: the canonical machine box is BIT-IDENTICAL before and after, and that is a true reading rather than a null result.** RN-1200's rectangle 505,20,1160,430 reads luma 20.43 / rgb 17.23,20.74,26.78 / p50 19.23 / p95 39.12 / iqr 15.30 / loFrac 0.704 in BOTH arms to the digit, because it frames the smelter's plate BODY, whose roles are all `panel`; the `Rock` hearth columns are in frame and OUTSIDE it. Instrument check first, because the frame is not deterministic: two AFTER runs differ on 3.32 per cent of pixels (max delta 211, foreground foliage) while the SAME control moves the column rectangles by 0.01 luma and **0.00 iqr**, so the columns are deterministic and the move there is the change: left column iqr **8.25 to 11.50 (+39.4 per cent)**, right column **6.94 to 10.00 (+44.1 per cent)**. Positive control, because "the columns changed" is still an inference: `?tile=stone:0.12` moves the left column's iqr 11.50 to 10.11 and leaves RN-1200's box bit-identical again, localising `stone` to the columns and to nothing inside the box. **A0 owes the machine shot a second named box on the hearth columns, or the campaign's gateway measurement is a rectangle that cannot see a material change by construction.** Guardrails green and re-measured, not quoted: forestfloor groundNear luma 27.32 / p95 75.35 against A0's 27.34 / 75.64; `lookdev.js` at the forest site `fails: []`; `factoryshot.js` valid with 4 buildings and a drill at 0.71 ore/s; `shadowlod.js` valid with its `?shadowlod=0` control real. New probe `tools/smoke/probes/machinefam.js`. No new page flags. **REPORTED RED AND NOT MINE: `assembler.js` fails "no belt off the smelter outlet" identically, same log line for line, on origin/main and on this branch.** |
| RN-1490 to RN-1499 | rendering, THE SMELTER PROOF SHOT (`lane/smelter-proof`), the art campaign's go/no-go for fanning out A4 | **RN-1490 to RN-1494 USED** 2026-08-13; grep confirmed the block free before it was opened (RN-1478's lane had already surrendered it in writing), and **RN-1495 to RN-1499 are surrendered unused**. **RN-1490**, the second named box A0 owed: `artframe.js` shots gained an `extra` map of further named rectangles decoded from the SAME capture, and `machine` carries RN-1479's own two hearth-column rectangles; `box` keeps its name, its rectangle and its place in the report so every earlier number stays comparable. **RN-1491**, a sixth shot `smelterhero`, running `machine`'s placement block verbatim and differing in two published fields plus a standoff bearing, with five `extra` rectangles of which three are negative controls. **RN-1492, THE BEARING SWEEP, AND THE FINDING IS BIGGER THAN THE FRAMING IT CHOSE: six bearings, two sun elevations and a full day-phase change all put the smelter's camera-facing vertical faces in SHADE while the ground in the same frame is lit** (world p95 155 to 197) and the roof deck is lit, with `warm` on the subject running -4 to -26 counts throughout. The machine is read by the sky IBL and never by the sun, so every A0 and RN-1200 machine frame ever taken is a photograph of ambient. Two candidate causes, neither claimed: shot geometry (a 4 m box 3.4 degrees off the equator has no vertical face the sun squares up to) or a machine-side shadow defect (roof lit, four walls dark, ground lit is also the signature of whole-object self-shadowing). One probe separates them; it is A1's. Also recorded: `__ofPost.state().sun` is `light.position - light.target.position` and reads as TOWARD the sun, yet neither it nor its negation lands the eye on a lit side, so it did not survive as a camera-placement instrument. **Bearing 0 is the instructive reject and ships as a frame**: the prettiest arm in the sweep, the +X SERVICE side, carrying neither role this pass moved, and photographed BIT-IDENTICAL either side of a real change (box 24.23 -> 24.22, plate 24.30 -> 24.30, both columns to the digit) - RN-1479's defect a second time, one shot later. **RN-1493 `SteelRust` -> `rust`** and **RN-1494 `Accent` -> `paintchip`**, the first two consumers of the D-020 vocabulary RN-1474/RN-1475 shipped unreferenced. `SteelRust` is a NEW role rather than a re-pointing because every existing steel role is worn by the rockets and the station too; it is painted on the smelter by one rule with no exceptions for looks (whatever the fire, the flue gas or the melt touches) while everything a HAND touches stays bright, and LOD1/LOD2 deliberately do not get it because RN-561 made LOD1 a shadow proxy. `contracts.json` max_materials 5 -> 6. **THE MEASUREMENT, matched pair at the pour face, the before arm taken with the glb, the manifest and `Surfaces.ts` stashed and the client rebuilt rather than with a remembered number: `firebox` luma 21.83 -> 4.12 and warm -20.17 -> +2.12 (the sign flip IS the claim), `band` warm 47.60 -> 53.85, and all three negative controls bit-identical to the digit** (`plate` 30.24 / -26.12 / iqr 16.23, `hearthL` 21.55 / -7.75 / 7.64, `hearthR` 22.58 / -14.59 / 14.00). The canonical `machine` box finally moves: luma 20.43 -> 18.87, warm -9.55 -> -5.73, sat 0.551 -> 0.623, iqr 15.30 -> 18.09, p05 5.79 -> 2.35; draw calls 86 -> 94, exactly two new family layers times the eye plus three cascades. **VERDICT: NO-GO on the Space Engineers bar, and the diagnosis unblocks rather than blocks A4.** Cleared as NOT binding, measured rather than argued: **tiling and box projection** (no stretch, mismatch or seam on any face across nine frames at 3.6 to 4.9 m, so **decision 5's refusal of per-asset UVs STANDS**) and **texture resolution** (`panel` at 341 px/m resolves individual rivets, seams and weld beads with clean edges at 3.6 m; decision 4's raise drops behind everything else, and no KTX2 encoder was needed so no devDependency was added). Binding, in order: the light; role coverage per asset rather than family quality; and the role TINT fighting the family (`Accent` at FF8A1E through `paintchip` came out MORE saturated with iqr FALLING 8.27 -> 6.04, because the mean-neutral divide preserves chroma while the map varies only value, so the lever is the palette hex on painted roles). **This lane's own miss, with its number: `SteelRust`'s 5C4238 through `rust`'s 0.1986 mean albedo puts the casting at luma 4.12 / loFrac 0.997 in an ambient-only frame**, which still reads in the picture but is numerically a hole; lift the hex 30 to 40 per cent before A4 copies the role. Determinism gate: two consecutive full `texgen.py build` runs left all 30 shipped PNGs byte-identical to the committed bytes. No new page flags. |
| RN-1255 to RN-1299 | rendering, ART CAMPAIGN pass A3 (terrain material identity + dug voxel face) | allocated by Admin 2026-08-13, NOT yet dispatched; A3 waits on A2b |
| RN-1255 to RN-1299 | rendering, ART CAMPAIGN pass A3 (terrain material identity + dug voxel face) | **RN-1255 to RN-1258 USED** 2026-08-13 by `lane/art-terrain`; grep confirmed 1255..1299 clean before the block was opened, and **RN-1259 to RN-1299 are surrendered unused**. One number per coherent decision rather than one per file. **RN-1255, THE MEASUREMENT IS THE DELIVERABLE AND IT IS ONE LINE OF ARITHMETIC NOBODY HAD RUN:** a biome's entire material description was two 4-vectors, and nearest-neighbour distances over the concatenated 8-vector put MoonHighland/CraterFloor **0.052** apart, Plains/Hills 0.054 and Regolith/MoonHighland 0.055, against a typical component of 0.1. Five of the ten biomes were within one component's width of another one, so the three airless biomes were one material wearing three palette entries. No shader change can separate two biomes whose whole description is the same numbers, which is why every previous pass tuning the shader could not have fixed "no material identity beyond palette hex". Retuned to 0.222 worst. **RN-1256**, `of_ground.png`'s four channels carried no hard edge anywhere, which is the ALBEDO's version of the water read the relief map has guarded against since RN-147; terraced facets, a stamped pebble population and a crack network sharing `_relief_clod`'s seeds, with six new selftest claims whose negative control is the same construction minus the new term. A sharp edge is safe in this map and not in the relief map because nothing differentiates this one, and that asymmetry is why the relief constants could not simply be copied. `of_ground_relief.png` regenerated byte-identical, which is the determinism contract proving itself in the same run. **RN-1257, AND THIS IS THE ONE FOR THE RATIO:** `ofArtRough` derived roughness from those clustered vectors and produced a band **0.131 wide across every biome in the game and 0.027 across the five rock and airless ones**, constant within a biome, against section 2.1 item 4's 0.15 requirement for a MESH family. The terrain is more screen area than all the mesh families together and **nobody had ever evaluated the expression**. Now authored, band 0.420, with a per-pixel swing. The correction that followed is the transferable part: **a multiplicative albedo modulation's contrast in COUNTS scales with the biome's own albedo**, so with one shared weight scale Forest (linear luminance 0.042) got a ninth of Beach's (0.367) texture, and Forest is the frame Reid calls plato-y. The first A3 pair moved the section 2.1 Forest box by **0.07 counts** while visibly re-texturing another site, which is exactly the shape of a null that means "the instrument is pointed at the wrong thing". `sum(b) = k/lum(b)^0.6`, anchored by photograph. **RN-1258**, the dug voxel face, which shipped `vertexColors` and no map of any kind on the one surface a player puts their face against; now triplanar `of_ground` plus an analytic sub-metre bump on an anchor-rebase-proof coordinate. **Its first frame read as wet oil and took FOUR negative controls to attribute** (`?terrainspec=0`, `?groundrelief=0`, `?terrainbump=0`, `?groundtex=0` all left it untouched, which is what named the voxel mesh rather than the ground): RN-78's lesson arriving at a new surface. **Then a second trap on the fix: a derivative bump's strength is the sum of weight/wavelength, not of weights**, so moving energy to a finer octave nearly DOUBLED it while every weight fell, and the corrected version printed a leopard pattern before the amplitude came down. Two harness findings recorded in rendering.md section 7 rather than here: `of.propsVisible(false)` leaves the scatter's SHADOWS on the ground (and `--props=0` changes nothing), and the section 2.1 `groundNear` box lands past `texW`'s fade at three of its four sites, so it is structurally blind to a ground-material pass. New page flags, all registered in `run.mjs`'s whitelist in the same commit that introduced them: `biomescale`, `biometint`, `voxelgrain`, `voxelbump`, `voxelspec`. New named `artframe.js` shot: `voxelface`. Recorded by the lane per rule 5. |
| RN-1400 to RN-1449 | rendering, D-016 the albedo colour-space fix and retune | RN-1400 to RN-1404 USED 2026-08-11 (the two `_albedo_mean_*` functions in `texgen.py` linearised via the sRGB EOTF and unified onto one Rec.709 weighting; the manifest key renamed `albedo_mean` -> `albedo_mean_linear` and `version` bumped 1 -> 2; the `Surfaces.ts` k=1 fallback and the `surface_preview.py` `or 1.0` fallback both retired for a hard error, and `Surfaces.ts` now checks the `manifest.version` it already read; `check_maps` observed RED against the old v1 manifest then GREEN against the regenerated v2 one; full clean regeneration measured byte-identical against the shipped PNGs, and the brief's premise that this needs `blender501` was found wrong, texgen.py is stdlib-only by design). RN-1405 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| RN-1450 to RN-1499 | rendering, the ruin mesh: the storyline's first destination | **RN-1450 to RN-1461 USED** 2026-08-11 (the asset itself, `build_ruin.py` and `ruin.glb`, every dimension derived from `poi.h`'s `SiteSpec` rather than chosen; `socket_grade`, which resolves the contradiction between the `ground` pivot and a 2.2587 m buried course by publishing the asset's own grade datum in the bytes instead of in prose; **the shadow ladder measured at 1134.94 mm on the first build and taken to 50.76 through SEVEN separately attributed causes, not one of which was a shadow bug before it was an invisible-geometry bug**, marginal 4.0x to 2.0x; two of those causes being `station_form.Shell`'s own, mounting at the vertex radius rather than the facet radius and splitting on a grid that ignores the hull's `phase_deg`, worked around at every call site and REPORTED rather than patched because they move geometry on a shipped asset this lane does not own; `Ruin_LOD2` stated in advance as a screen-distance tier that cannot be a shadow one and measured at 634.29 mm confirming it; the wear marks failing an art test no gate asks and being re-authored from single rectangles into two-box ragged marks with `Grass` pulled for `LeafDry`; the stair refused because a walkable flight leaves the 18 m `footprintM` the site gate measured the ground over; four Cycles receipts including one that BUILDS the worst admissible surface and photographs the rim against it; and the negative control, `col_Ruin_1` refused by `check-proxies.mjs` and reverted byte-identical by sha256). RN-1462 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| GP-670 to GP-679 | gameplay, the probe-toolgate lane: reconcile the D-019 survival probes with the GP-506 pickaxe gate, and whatever harness defects that measurement turns up | **GP-670 and GP-671 USED** 2026-08-12. **GP-670: THE CHROME GUARD EVERY LANE ON THIS BOX WAS HANDED CANNOT READ ZERO, AND IT REPORTED 8 ON A MACHINE RUNNING NONE.** `pgrep -f -c "headless_shell\|chrome.*--headless"` matches whole COMMAND LINES, and that pattern is quoted verbatim inside every agent brief that mandates the guard and inside every sibling lane's guard loop, so it matches the bash processes running the guards, the `claude` processes carrying the briefs, and **the process carrying the asking lane's own brief** -- which is why no amount of waiting can clear it. Measured 2026-08-12 22:48: raw count 8, real browsers 0, every match resolving through `/proc/<pid>/exe` to `bash` or `node`. A guard that can only ever say "contended" makes every run either a 60-minute abort or an unguarded run, which is the instrument-reports-the-opposite-of-the-truth class this whole file is about. `tools/lane/probeguard.sh` keeps the mandated pattern as the CANDIDATE set and resolves each candidate through `/proc/<pid>/exe`, counting only `headless_shell`/`chrome`/`chromium`; same intent, an instrument that can read zero. **GP-671: `probes/padgate.js` HAD NO DOCUMENTED INVOCATION, SO THE GATE AUDIT HAD NEVER RUN IT.** `probeall.mjs` derives each probe's flags by parsing the first `run.mjs` line out of its header comment and skips a file that has none, so padgate has never appeared in any census, red or green -- a probe invisible to the instrument that exists to count probes. One header block fixes it. GP-672 to GP-679 free. Allocated and recorded by the lane per rule 5 |
| GP-650 to GP-669 | gameplay, the map's body: Reid's cfeffad report that the station orbits the moon and the map stays lunar after coming home | **GP-650 to GP-654 USED** 2026-08-11 by the map-body lane (`VesselRecord.bodyId`, the field a GLOBAL `vessels` save key needed and never had, stamped at every mint and RECOVERED for a legacy row from its conic's own mu; `world/VesselBody.ts` as the one "which body is this record at" reader, backed by `readFacts` so no fifth bodyId-to-word table was written; the map's three captured body numbers and its `'Forge'` string literal replaced by ONE thunk onto `SurfaceOracle.body`, which `WorldSession.reboot` already re-seats; `Map3D` borrowing the world's planet geometry when it IS the live body and building its own when it is not; and the orbit lines, markers, panel rows and both autopilot target lists filtered or measured against the record's own body). Measured at HEAD before the fix through `of.reboot(1)`: `globeRadiusUnits` **5.937 before and 5.937 after**, `focus.options` still `["you","Forge"]` on Cinder, and one 1,000,000.0000000008 m conic reading 400 km at home and 800 km on the moon. Green after: `tools/smoke/probes/mapbody.js`, `valid: true`, `fails: []`, globe 5.937 -> 1.9475 -> 5.937; `stationboard.js` and `markers.js` green, `check:pose` 14 checks, typecheck and build clean. **Two RED probes were found and attributed to `f0a7da0` rather than inherited silently**, by building the parent commit into a second worktree and isolating the failing claims: `map3d.js` section 4 targets the first rails record, which is now always Anchorage rather than the rocket it built, and its closed-cost invariant reads an unsettled scene (73 and 74 on two runs of one build). Both reproduce identically on HEAD. See gameplay.md. GP-655 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible |
| GP-680 to GP-689 | gameplay, the garrison-leash fix lane (dispatched 2026-08-13 against the verifier report that `probes/garrison.js --combat=1` never fires the leash) | **GP-680 USED** 2026-08-13. The rest of the block is ABANDONED, not held: one number covered the whole lane. **The finding is an instrument defect, and it belongs in this file for the ratio rather than in the controller file alone.** The leash and every position in `EnemyGarrison.ts` were correct and unchanged. The probe stood its player fixture 15 m from a post held by four guards, the guards killed it (150 hp against 24 to 120 dps), and `PlayerVitals.respawn` teleported the body to the landing site 45.06 m from the post, five seconds later, silently undoing the probe's own 90 m retreat and parking the player inside the 60 m leash so it could never fire. The probe asserted the retreat from the value `standAt` returned at the instant of the call and never re-measured. **Two new traps for the catalogue. (1) A probe that teleports the player must assert the player STAYED: this game has a rule (death, respawn) that moves the player without being asked, so a one-shot position assertion is not a position invariant. (2) An aggregate re-picked each sample is not a time series: this trace followed `whichever guard is nearest`, and a roster spanning 3.4 to 6 m/s made the nearest body change identity mid-chase, printing a physically impossible return-to-engage flip and leaving the engage-to-return assertion satisfiable by two different creatures.** Both are now assertions in the probe. |
| GP-700 to GP-714 | gameplay, the compass lane (`lane/compass`, dispatched 2026-08-13 against Reid's ruling: "we need to add a compass, a hud showing marked locations while you are running around") | **GP-700 USED** 2026-08-13. One number for the whole coherent delivery (the WG-151/GP-680 precedent), not one per file. `game/Compass.ts` computes bearings to every KNOWN `MarkerRegistry` marker (GP-520) and the player's own pad(s) (`LaunchPad.ts`) off the walker's own heading, using `Controller.ts`'s own convention (0=north, 90=east) rather than a new one; `ui/CompassHud.ts` draws the strip (split out of `ui/GameHud.ts` along the GameplayChrome precedent -- inline, the addition pushed GameHud from 301 to 431 lines against `check-limits.mjs`'s 400 cap, so this is that rule applied to a new feature rather than an exception carved for one); `GameplayReport.ts` publishes the drawn block as `compass`, the `progress`/`stations` precedent, so a probe reads it rather than pixels. Gated on-foot-only by reusing `GameHud.setVisible`, the SAME boolean `setWorldUi` already drives off `FlightMode`'s `aboard` and `MapMode`'s `open` -- no third mode check was invented. Distance labels and the pad ("player's own base") chip were scoped down in the report below this row; the marker/pad bearing math and both mode gates were driven and measured. **`probes/compass.js` verdict: `pass: true, fails: []`**, driven live against a served build (port 4367): a marker rotated to an independently-computed east tangent reads bearingDeg 90.00, a north one reads 0 (360 mod), turning the player +40 degrees leaves both markers' PUBLISHED bearings unchanged (`90.00 -> 90.00`) while the RELATIVE bearing that places the chip on the strip moves the opposite way (`90.00 -> 50.00`, exactly -40), a `known: false` site draws no chip, and the block reads `null` (not merely empty) both with the map open and with the player boarded into a real rolled-out vessel, returning on close/disembark. `check:limits` was ALREADY FAILING on unmodified `origin/main` before this lane touched anything (45 pre-existing files over the 400-line cap, none of them this lane's); measured identically before and after this change (45 both times, via `git stash`/`stash pop` on the same tree) to confirm zero new violations rather than assumed. GP-701 to GP-714 free, surrendered unused. |
| GP-690 to GP-699 | gameplay, the enemy-reds diagnosis lane (`lane/enemy-reds`, dispatched 2026-08-13 against the three reds the ruin-place lane found once it fixed the apostrophe that had stopped `probes/enemies.js` parsing since fb0723b) | **GP-690, GP-691 and GP-692 USED** 2026-08-13; GP-693 to GP-699 free. **Three reds, three instrument defects, zero game defects.** Every one was the fixture measuring a game that had moved, and all three fixes are STRONGER assertions than the ones they replace. **GP-690: A FIXED PRESS COUNT IS A FIXTURE WITH AN ASSET SIZE BAKED INTO IT.** Ten presses of `use` landed three smelters and took seven refusals, all reading `too close to #N smelter` with a named reason, successes at ring cells (1,2), (5,5) and (9,2). The sweep was authored 2026-07-27 against a 2.00 m smelter, where a 21-degree step around a 3.7 m aim ring cleared the housing; FS-73 took `smelter.glb` and `FOOTPRINT.smelter` to 4.00 m on 2026-07-28 (aea0d2c) and `footprintsOverlap` refuses anything inside a 4-cell box. **The refusal was correct and the fixture was one day stale.** This is INSTRUMENTS.md's "the asset is part of the measurement" one layer out: not a constant that encodes a size, a LOOP COUNT that encodes one. The fix is a `placeUntil` sweep that presses until it has the count and widens the ring when one fills, so the next mesh change costs presses rather than a red, plus a new assertion that every refusal on the way carried a sentence (an occupancy rule working and a placement defect must not read alike). **GP-691: THE DETAIL STRING WAS READ AS THE MEASUREMENT.** `AND KILLED THEM ...: 0 -> 11 over 14 aimed rounds` was reported up and triaged as "0 kills over 14 aimed rounds". The 0 is `k0.killed`, the counter BEFORE the volley. **Fourteen rounds, fourteen hits, zero ground hits, eleven kills**, and the three that killed nothing are one body: a 75 hp Ravager standing 0.25 m off the aim line at 4.12 m, which is 0.02 m nearer along the ray than the 15 hp Skitterer at 4.14 m the loop aimed at. `Weapon.fire` takes the nearest sphere the ray enters, so rounds 5, 6 and 7 all went into it (75, 53, 31, 9) and round 8 finished it. The trap for the catalogue: **a probe that watches only the body it aimed at cannot tell a round that killed something else from a round that killed nothing**, and `hits === kills` was a claim about the ROSTER, which stopped being uniform the moment evolution started mixing types. Replaced by a full live-list diff per round: every round lands in a body, each round puts its 22 points into exactly one body, a survivor loses exactly 22, and the kill count equals the rounds that emptied a body. **GP-692: A `>=` ON A QUANTITY THAT HAS AN EXACT VALUE.** `pool.instances` read four below `live + nests` and the counters were suspected of double-counting garrison creatures. Measured: instances 36, live 40, nests 4, **claimed 8**. RN-123 (c96af0a, 2026-07-29, two days after the probe was written) promotes the nearest `MAX_RIGS` creatures into skinned rigs which release their batch slot, so the identity is `live + STANDING nests - claimed`. The pool report was truthful and nothing was double counted. The earlier sibling check was `pool.instances >= live`, which would have stayed green with the batch leaking a slot per corpse, i.e. green through the exact DW-28 ceiling the section exists to watch; both are now equalities. `enemies.nests` also counts dead nests and only a standing one is drawn, so that term is now `standing nests`. **No game code changed in this lane.** Verdicts: `enemies.js --combat=1` `fails: []`, `enemies.js` no-combat control `fails: []`, `garrison.js --combat=1` `fails: []`. |
| GP-715 to GP-729 | gameplay, the station-reveal lane (`lane/station-reveal`, dispatched 2026-08-13 against Reid's two-part ruling: "you should still be able to discover the map as you run around" and "the full map should reveal whenever you explore the space station"). Block confirmed unspent before use: no GP-7xx existed anywhere in this file or `gameplay.md`, GP-690 to GP-699 being the previous ceiling | **GP-715 to GP-721 USED in `gameplay.md`'s decision log; GP-725 to GP-728 USED HERE for the instrument findings; GP-722 to GP-724 and GP-729 free, surrendered unused.** Four findings, and the ratio holds again: **zero of them are defects in the feature this lane built, three are harness traps and one is a pre-existing game defect in another domain's file.** **GP-725: THE DISCOVERY FIELD IS NOT RE-CUT WHEN THE WORLD CHANGES BODY, AND A FULL REVEAL IS WHAT MADE IT VISIBLE.** `Boot.ts:583` calls `bootMap` OUTSIDE `buildBodyScope` (declared :318, first run :427), so the `Discovery` driver is constructed once with the BOOT body's id and `WorldSession.reboot` never rebuilds it — R17's station-mount shape, one domain over. Measured through `of.reboot(1)` with the save slot wiped first so nothing could be re-applied behind the reading: the world moves to Cinder correctly (`of.world().bodyRadiusM` 200,000, `of.map('report').body` = `{bodyId:1, name:'Cinder', radiusM:200000}`) while the field still reports `bodyRadiusM` 600,000, a 9,375 m cell and Forge's 98,304 cells, **and it keeps taking observations, so a player walking on Cinder writes Cinder positions into Forge's lattice.** Left MEASURED and not asserted in `probes/stationreveal.js` §8, deliberately: turning another lane's defect into this sweep's red makes the verdict about somebody else's file. Needs a persistence change too — the save holds ONE discovery blob. **GP-726: `of.run(seconds, renderHz)` DOES NOT DELIVER `seconds` OF SIM TIME, AND EVERY PROBE THAT TIMES ANYTHING AT A LOW RENDER RATE HAS BEEN LYING TO ITSELF.** `Loop.frame` runs at most `MAX_CATCHUP = 5` fixed ticks per rendered frame and then DISCARDS the backlog (`if (ticks === MAX_CATCHUP) this.acc = 0`), so a render rate of R delivers min(1, R*5/60) of the sim time requested. At the 10 Hz this probe first used that is 83.3%, measured exactly: **83 discovery passes over a requested 100 s, and a walk that read 3.831 m/s for a walker that does 4.573.** The wrong reading is the plausible one — a slightly slow walker — which is what makes it dangerous. Even 12 Hz (60/12 = 5, exactly on the clamp) lost 6.7% to frame jitter in practice. **The fix is the general one: assert against `of.world().tick`, never against the number handed to `of.run`.** This is GP-680's "a probe that teleports must assert the player STAYED" in the time domain: the harness has a rule that consumes your request without saying so. **GP-727: `of.save()` FOLLOWED LATER BY `of.load()` IS NOT A ROUND TRIP.** The 20 s autosave writes the same slot, so a load taken more than a few seconds after the save restores the AUTOSAVE. Measured: a section that threw the map away on purpose and then called `of.load()` to tidy up got 19,943 cells back instead of 98,304, because the autosave had already captured the thrown-away state. Any DW-17 destruction-is-the-point round trip must keep save → destroy → load TIGHT, or wipe first. **GP-728: the "1 Hz" discovery sampler is really [1.0, 1.0 + one frame] Hz**, because `Discovery.step` sets `sinceS = 0` after firing rather than subtracting `SAMPLE_S`, discarding the remainder — about four passes fewer per 93 s at 12 Hz render. Harmless (1 Hz is a target, not a contract) but it is what made a `floor(simS) - 2` bound fail at 90 against 91, and a two-sided band derived from the driver's own code replaced it. **The lane's own verdicts, verbatim: `probes/stationreveal.js` `valid: true, fails: []`; `stationboard.js` `valid: true, fails: []` 29 checks; `milestones.js` `fails: []`; `markers.js` `fails: []`; `posecheck: PASS (14 checks)`; `boot: PASS tick 81, 1806 frames, gpu ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti ... Direct3D11)`; 42/42 ctest suites passed.** `probes/discovery.js` is RED with 2 fails and **it was attributed rather than inherited silently**, by stashing the lane, rebuilding pristine `origin/main` into `dist-baseline` on port 4370 and re-running: byte-identical fails on both ("the out fill flip is the LIMB entering the frame, in /core's count as well as in the painter's projection: on-body 3600 -> 3600", and its `back` twin). `check:limits` fails with 45 over-cap files on main and **45 after this lane** — `Systems.ts` sits at 399 against the 400 cap and the feature took it to 462, so it was extracted to `web/src/app/StationReveal.ts` rather than becoming the 47th violation. Recorded by the lane per rule 5. |
| GP-546 to GP-549 | gameplay, L7 ruin interior: walking into the ruin and interacting at `socket_investigate` grants a milestone that unlocks Electrification research, per the storyline. Allocated in the Admin brief (which also freed GP-540 to GP-545 from the antenna block above, if needed; not needed) | **GP-546 to GP-549 ALL USED** 2026-08-13, one number per coherent decision thread rather than one per file: **GP-546** the milestone itself (`milestones::RuinInvestigated = 0x0003`, `research.h`) and `Electrification.requiresMilestone` set to it, closing the cycle GP-535 left open; the storyline's "antenna upgrade" tech deliberately SCOPED, NOT BUILT, because a no-unlock stub would trip GP-267's "every survival tech grants something" invariant on invented content this lane does not own; **GP-547** the pick/interact mechanism, a new `RuinInteract.ts` (gameplay's own file, not an addition to world-gen's `RuinSites.ts` beyond one geometry accessor, `investigateLocal()`), wired into `GameplayAim.ts`'s `pickAim` cascade after every player-placed thing and into a new `GameplayInput.ts` `doInteract` branch, with an honest HUD prompt (`investigatePrompt`) for both "investigate" and "already investigated"; **GP-548** the persistence design, per-ruin "already investigated" reusing poi.h's existing `Sites.visited` bit (WG-151) rather than a new store, the milestone staying a single global fact, and "load never grants" verified by watching `grantMilestone`'s own `console.info` line across a reload rather than assumed from the unchanged `PersistProgress.ts`; **GP-549** the probe (`probes/ruininvest.js`, sandbox, `valid: true, pass: true, fails: []`) and its own two harness defects, found and fixed rather than shipped: `aimAtPoint`'s ±96° capture range (copied from `ruinplace.js`, correct there, insufficient here since this file's own negative control leaves an unpredictable residual yaw) widened to a guaranteed 360° first pass; and a wrong assumption that the investigate socket is standable ground, corrected once `of.solidBuild` showed it reads solid at all three capsule heights — it is the centre of an object, picked at range like a machine, not floor. `core/tests`: `test_research_survival.cpp` gained a dedicated milestone test (D8) and D1/D2/D3/D4/D7 were updated for the new gate (42/42 ctest suites green, baseline held). `npx tsc --noEmit` clean, `npm run build` clean, `check:limits` clean on every touched file (`RuinSites.ts` crossed 400 by one line and was trimmed back under). `probes/ruinplace.js` re-run on the same build, unmodified: `valid: true, fails: []`, no regression. Recorded by the lane per rule 5. **ADDENDUM (no new numbers spent, same block): a verifier caught the ripple `fc48f51` shipped with**, GP-618's own class restated — gating a tech is a gate on every probe that BUYS it, and `probes/research.js` (0 -> 15 fails) proved it. A sweep of the whole probes dir (not just the one report) found `probes/padgate.js` identically broken and unverified. Both fixed by earning the milestone for real (walk to the ruin, interact) rather than retargeting either file's purchase, because Electrification is each file's actual subject and not an incidental prereq. `research.js` also carried an unrelated pre-existing staleness (`seven techs` stale since GP-533's eighth tech, GP-611's own class recurring) fixed in the same pass. `probes/research.js` and `probes/padgate.js`: `valid: true, fails: []`; `probes/ruininvest.js` re-verified unregressed. Commit `fd58a57`.


**The RN collision above was Admin's, and rule 5 is exactly what would have caught
it.** I allocated RN-845 to RN-899 to a rendering lane in its brief, and at the
same time ran an asset lane with **no block at all**, having told it to continue
the RN series. It took RN-851 and RN-856 to RN-859, inside the other lane's
range. Nothing broke, because the rendering lane had not reached those numbers
yet; **that is luck, not process.**

The cause is one line above in this file: I had already written that not
allocating blocks to those lanes was "a judgement call, not an oversight",
justified by there being **one lane per domain**. That justification was wrong
within the hour, because an asset lane and a rendering lane are **two lanes in
one number series** even when they are different domains by charter. **The unit
that collides is the number prefix, not the org chart.**

**Blocks NOT allocated tonight, deliberately and with the reason recorded**, since
rule 5 says an unrecorded decision is invisible: the rendering and core-engine
lanes were told to continue their own series rather than being handed a block.
That is a violation of rule 2 and it was a judgement call, not an oversight.
**Exactly one lane per domain is live**, and every collision in the history above
was two lanes inside one domain, so the race this ledger exists to prevent cannot
currently occur. **The moment a second lane opens in either domain, both need
blocks before either starts.**

FS-34 is deliberately unused: the pollution lane renumbered its own FS-33/FS-34
to FS-35/FS-36 when corner cargo reached main first.

## Related

Standing rule 10 (path-limited commits) is the other half of this. Two lanes in
one checkout collide on files as well as on numbers, and a broad `git add` has
already swept one lane's work into another lane's commit.

## FIRST: `git commit -- <paths>` DISCARDS YOUR INDEX

Read this before the technique below, because it is the trap the technique
exists to escape, and standing rule 10 as originally written walked straight
into it.

**`git commit -- <paths>` does not commit what you staged.** It ignores the
index and commits the CURRENT WORKING TREE contents of those paths. So a lane
that hunk-stages carefully, verifies with `git diff --cached --numstat`, and
then commits "path-limited" has its hunk selection **silently thrown away** and
ships whole files including other lanes' in-flight edits.

That is the mechanism behind all three incidents this session where one lane's
work landed inside another lane's commit. It was never carelessness. Three
lanes followed the rule as written and the rule was wrong.

- `git add <paths>` then a bare `git commit` (no pathspec) is safe: it commits
  the index.
- `git commit -- <paths>` is NOT safe and must not be used when any file you
  touch also carries someone else's uncommitted work.

## Committing from a shared checkout without disturbing other lanes

Standing rule 10 says commit path-limited. That is necessary and it is not
sufficient: `git add <paths>` still writes the SHARED index, so a lane that
stages 32 files and a lane that stages 3 fight over one file, and three times
this project a broad `git add` swept another lane's work into the wrong commit.

The Escape-menu lane solved it properly on 2026-07-28 and it is now the
recommended technique when other lanes have staged work:

1. Point `GIT_INDEX_FILE` at a private index file.
2. Stage only your paths into it.
3. `git commit-tree` and `git update-ref` to land the commit.

The shared index is never touched, so a lane with a large staged set keeps it.

When a file you own carries ANOTHER lane's uncommitted hunks in the working
tree, do not commit the file wholesale. Build a **filtered blob** from `HEAD`
plus your own hunks and stage that. Their work stays in the working tree for
them to commit themselves.

This is the difference between "I tried not to touch their work" and "I could
not have touched their work". Prefer the second.

One wrinkle the private-index technique does not remove: after landing a commit
that way, the SHARED index still holds pre-commit entries for your paths and
will read as staged modifications or deletions. Follow with
`git reset -q HEAD -- <your paths>` (scoped to your paths, never `.`).

### Freezing a build: archive `web`, never the whole tree

`git archive HEAD | tar -x` extracts **`ue/` as well**, which is 6.8 GB of dead
Unreal assets superseded by the Three.js pivot. Two lanes doing that at once
filled a 931 GB disk to zero on 2026-07-28 and briefly stopped every lane.

Always scope it:

```
git archive HEAD web | tar -x --strip-components=1 -C <dir>
```

Then `cp -r web/public <dir>/public` (generated, not tracked) and build with
`OF_BUILD_STAMP=<sha>` so the frozen bundle states the commit it came from
rather than interrogating the checkout around it.

Delete the scratch directory when done. A 24 MB build left behind is nothing;
thirteen of them plus their Chrome profiles is not.

### `abi=N` IN THE BOOT LOG IS A CONSISTENCY CHECK, NOT A FRESHNESS CHECK

**A freeze of `b30d161` reported `abi=19` with smoke PASS and zero console
errors, on a tree whose source says 20. Both halves were true and neither was a
bug.** Resolved 2026-07-28 (PH-82).

The client throws unless the wasm agrees with it:

```
// OfCore.ts
const abi = M._of_abi_version();
if (abi !== OF_ABI_VERSION) throw new Error(...)
```

So `abi=19` printing successfully proves the bundle ALSO expected 19. **A stale
build is internally consistent**: old JS expects 19, old wasm returns 19, the
check passes, the page boots, smoke is green. The handshake line can only ever
catch a MISMATCHED build, and a mismatched build does not boot at all, so in
practice the line can never fail. **It says client and wasm agree with each
other. It says nothing about whether either is HEAD.**

Verified rather than argued: HEAD's committed binary was loaded in node and asked
directly, `_of_abi_version()` returns **20**; a correct `git archive HEAD web`
freeze bundles `client expects 20`, serves the 411607-byte wasm and reports
**`abi=20`** with smoke PASS.

**CORRECTION, and the correction is the interesting part.** I concluded from that
"so the build that printed 19 was not built from HEAD". **That was wrong.** Admin
ran the two commands below against the live demo and the freeze WAS building
HEAD: bundle `client expects 20`, HEAD `OF_ABI_VERSION = 20`, served wasm byte
identical to HEAD's. The real cause was a **stale server on a reused port** (see
the entry above this one): the measurement never reached the new build at all.

The lesson survives the wrong diagnosis and is arguably strengthened by it.
**Neither of us could tell the difference from the inside.** A self-consistent
report is compatible with a stale build, a stale server, and a correct build, and
the boot line reads the same in all three. That is the whole argument for
comparing against HEAD rather than trusting a self-report, and it is why the two
commands below are worth running even when nothing looks wrong.

**`OF_BUILD_STAMP` has the same shape and is worth naming beside it.**
`vite.config.ts:20` takes the stamp from the environment and only falls back to
`git rev-parse` (then to `'nogit'` inside an archive, which has no `.git`). A
freeze therefore states the sha the operator TOLD it to state. Stamp a stale
directory `b30d161` and it will say `b30d161` in good faith. **The stamp restates
the intent; it does not measure the content.**

Two things that look like verification and are not, both reporting exactly what a
correctly-labelled stale build would report.

**THE CHECK THAT ACTUALLY MEASURES IT** compares the served artifact against
HEAD, which the build cannot self-report:

```bash
# 1. the served wasm IS HEAD's
git show HEAD:web/wasm/dist/of-core.wasm | cmp - <servedroot>/wasm/of-core.wasm   && echo "wasm matches HEAD"
# 2. the bundle's expectation IS HEAD's constant
grep -oh "client expects [0-9]*" <servedroot>/assets/*.js | sort -u
git show HEAD:web/src/sim/wasm/OfCore.ts | grep "OF_ABI_VERSION = "
```

Both are cheap and neither can be satisfied by a build that merely agrees with
itself. Run them on every handover build; `abi=N` is worth printing but is not
evidence of freshness.

### `npx vite build` SKIPS sync-wasm, so a frozen build can carry a stale wasm

`npm run build` runs `prebuild` (`sync-wasm` then `sync-assets`). **`npx vite
build` does not.** So a scratch build made the fast way keeps whatever
`web/public/wasm` happened to hold.

It bit a lane on 2026-07-28: another lane bumped the client to ABI 19 mid
session, the lane's builds kept a wasm at 18, **a binary silently failed to
boot, a `--out` screenshot never wrote, and it compared two images that were the
same file**. Identical output from a changed input is the tell, and it paid off
three times that night.

This applies to Admin's frozen handover builds too. After archiving, copy the
ARCHIVED `web/wasm/dist` into the build's `public/wasm` rather than copying the
live checkout's `public/`, or run `sync-wasm` inside the scratch tree. Then
confirm the handshake ABI in the boot log matches the source's
`OF_ABI_VERSION`.

### Scratch build directories: one per lane, named, and yours alone

The disk reached **7.2 MB free of 931 GB** on 2026-07-28 from `dist-*`
directories accumulating across every lane, and one lane deleted another lane's
mid-run, which corrupts a measurement in a way that looks like a code defect.

- One scratch directory per lane, named for the lane (`dist-<lane>`).
- Delete it when the pass ends. Not "eventually".
- **Never delete a directory you did not create.** If the disk is tight, say so
  and let Admin arbitrate.

### `update-ref` must be compare-and-swap, and staging must be path-explicit

Four times this session a lane's commit has carried a file belonging to another
lane. Twice the content happened to be correct, once it cost a commit outright.
Two independent causes, and the protocol needs both halves:

**1. Stage by explicit path, never by directory or `-A`.** A directory add
sweeps whatever another lane left modified in that directory.

**2. Use the three-argument `update-ref` so a concurrent commit fails loudly:**

```
git update-ref HEAD <new-sha> <expected-old-sha>
```

where `<expected-old-sha>` is the HEAD you passed to `commit-tree -p`. The
two-argument form **silently orphans any commit another lane landed** between
your `read-tree` and your `update-ref`, because your new commit's parent is the
HEAD you read, not the HEAD that exists. The three-argument form refuses and
you re-read and retry, which is the correct behaviour under concurrency.

Related: a private-index commit chain can fail mid-way and leave HEAD untouched
(seen once with exit 66 under disk pressure). **`git log` is the check, not the
exit code of the chain.**

### A probe file has no registry, so creating one can silently destroy another

`web/tools/smoke/probes/*.js` are loose files with no index. **Writing a probe
onto a name that already exists is indistinguishable from creating a new one**,
and the Write tool will not warn you. It happened on 2026-07-28: a lane's new
screenshot probe landed on GP-61's `machineshot.js` and destroyed it. It was
caught only because the lane ran

```
git diff-index --cached --name-status HEAD
```

and saw `M` where it expected `A`.

**Before writing a new probe, check the name is free.** After staging, check the
status letter is `A` for every file you believe you created. An `M` on a path
you have never edited means you have just overwritten someone's work, and the
content will commit cleanly and look correct.

This is the same family as the four commit sweeps: **the tooling cannot tell
"new" from "replacing something I never read".** Explicit-path staging and
compare-and-swap `update-ref` close the commit half; this check closes the
authoring half.

### Freezing a build: `sync-assets` too, not just `sync-wasm`

`git archive HEAD web` archives **only `web/`**. The models live in `assets/`
at the repo root and reach the client via `web/public/assets`, which is
generated and **not** regenerated by `npx vite build` (only `npm run build`'s
`prebuild` does it, and only in the tree it runs in).

So a freeze that copies the live `web/public` into an archived tree ships
whatever models the shared checkout last synced. On 2026-07-28 that was four
boulders and a broadleaf behind HEAD: Admin's demo builds served **old rocks
and an old tree** while reporting the correct commit stamp.

Before every freeze, from the repo root:

```
cd web && npm run sync-assets
```

then copy `web/public` into the scratch tree as usual, and copy the archived
`web/wasm/dist` over `public/wasm` per the `sync-wasm` note above.

This is the same family as the wasm trap and the stale `web/dist` bundle: **the
served artefact and the committed source are separate things, and only one of
them is what the stamp names.** A build stamp proves which source was archived.
It proves nothing about the models, the wasm, or anything else generated.

### `--strictPort` fails the NEW server, so a reused port measures the OLD build

`--strictPort` is the right flag, but understand what it does on a port you
already used: **the new preview refuses to start, the old server keeps serving,
and anything you point at that port measures the previous build.** No error
reaches you if you background the server and only check the URL afterwards,
because the URL answers 200 the whole time.

This cost Admin a false alarm on 2026-07-28: a freeze of HEAD appeared to report
`abi=19` against a source that says 20, which looked like a stale-build defect
serious enough to raise with a lane. **The build was correct. The measurement
was pointed at a server from six freezes earlier**, and seven stale preview
servers were found still listening.

Before serving on a port, kill whatever holds it and confirm it is gone, or use
a port no run has used. After serving, confirm the server you just started is
the one answering, not merely that something answers.

This is the same family as everything else in this file: **the instrument was
aimed at the wrong thing, and the wrong thing answered plausibly.**

### What actually proves a frozen build is HEAD

The boot line `abi=N` proves the client and the wasm **agree with each other**.
A stale build is internally consistent, so it prints a number and boots and goes
green. It cannot prove freshness, and a genuinely mismatched build does not boot
at all, so in practice that line can never fail.

`OF_BUILD_STAMP` has the same shape: `vite.config.ts` states the sha the
operator passed it, in good faith, whatever directory it is stamping.

Compare the served artifact against HEAD instead, which is the one thing a build
cannot self-report:

```
git show HEAD:web/wasm/dist/of-core.wasm | cmp - <servedroot>/wasm/of-core.wasm
grep -oh "client expects [0-9]*" <servedroot>/assets/*.js | sort -u
git show HEAD:web/src/sim/wasm/OfCore.ts | grep "OF_ABI_VERSION = "
```

Keep printing `abi=N`. It is worth having during development, where a broken
pairing is possible. Just never read it as freshness on a handover build.

### The shared index accumulates STALE blobs, and a bare commit ships them

Private-index commits leave the shared index untouched, so entries staged hours
earlier survive there indefinitely. They are not merely redundant: measured on
2026-07-28, three probe paths held blobs that differed from **both** HEAD and the
working tree.

```
cheats.js:      staged 0570417f   head c1b8f588   worktree c1b8f588
launchguide.js: staged 027f9179   head 519d47f5   worktree 519d47f5
savenamed.js:   staged cc795cf2   head 0c9d5089   worktree 0c9d5089
```

A bare `git commit` in that state would have **reverted three probe fixes**,
including the vacuous-antecedent repair, under whatever message the committing
lane happened to write. The same hazard appears as staged deletions: a lane
found two screenshots marked `D ` while present on disk and in HEAD.

**Check `git diff --cached --name-status` before and after every pass.** It
should be empty. If it is not, `git reset -q HEAD -- <paths>` clears it without
touching the working tree.

This is the fourth member of the sweep family. The others move a file into the
wrong commit; this one moves a file **backwards in time** while every surface a
lane normally checks (`git status`, the working tree, `cat-file -e HEAD:`) looks
correct, because the stale content is only in the index.

### A filtered blob is not enough when the artifact is GENERATED from a shared source

The filtered-blob technique (commit only your own hunks of a file another lane
has uncommitted work in) protects a file you EDIT. It does not protect a file
you REGENERATE.

On 2026-07-30 a lane regenerated `surfaces.json` from the shared surface-family
source while a sibling lane had an uncommitted table move in that source. The
generator read the sibling's working-tree state, and the regenerated artifact
laundered their unlanded work into HEAD under an unrelated commit message. The
blob was filtered; the INPUT was not.

**Before committing any generated artifact, check whether its generator reads a
file another lane is mid-edit in.** If it does, either regenerate from a clean
`git archive HEAD` tree, or confirm the generator's inputs are all committed.
`git status` on the GENERATOR'S INPUTS is the check, not `git status` on the
artifact.

This is the fifth member of the sweep family, and the sneakiest: every surface a
lane normally inspects looks correct, because the artifact genuinely is the
correct output of the tree as it stood.

### Boot defaults: `Number(null)` is 0, so a feature can ship OFF

`RN-150`: the ground texture and the wet-sand shoreline both had boot defaults
that evaluated through `Number(null)` and landed on 0. Both features were fully
built, measured, committed, and **invisible to the player**: the probes that
proved them all passed an explicit flag, so nothing ever exercised the default.

**A flag's DEFAULT is a fixture and must be asserted as one.** If a probe only
ever runs the feature with `?feature=1`, it proves the feature works and proves
nothing about whether anyone sees it. Assert the boot default in its own check,
red-by-name when the default is wrong.

### A filtered blob built from a STALE BASE is a revert, not an omission

The filtered-blob technique (commit HEAD's content plus only your own hunks, so
a sibling lane's in-flight work in the same file is not swept) was adopted to
fix the sweep family. **It carries the same defect it was adopted to fix, for
the same reason: it is built FROM A BASE, and a base is a point in time.**

Measured on 2026-08-01. A lane committed ten files and fourteen screenshots. The
very next commit **reverted all of them**, not carelessly, but because it built
its blob as "HEAD plus only my hunks" against **the HEAD that existed when its
pass started**, which was the first commit's parent. The blob faithfully
preserved every row that existed when the lane began and silently deleted every
row that arrived afterwards.

This is the `git checkout --` entry generalised. That one says a checkout is
unsafe when HEAD moves under you mid-pass. **A filtered blob has exactly the
same property, and it is the technique we adopted BECAUSE of that entry.**

**Two rules, both required:**

1. **Pin the base SHA once**, at the moment you decide to commit, and build
   every blob from that exact SHA (`git show <sha>:<path>`), never from the
   moving `HEAD:` ref.
2. **Verify HEAD is still that SHA in the same breath as the commit**, and
   refuse if it moved. Re-read, rebuild the blob, retry.

That is "the check has to be adjacent to the write", applied to the thing that
actually moves.

### `git commit` refreshes the index and can discard a `--cacheinfo` blob

`git commit` runs `refresh_index()` and re-reads stat-dirty paths from the
working tree, **which can silently replace a blob you staged with
`--cacheinfo` by whatever the shared tree currently holds.** A carefully
filtered blob does not survive it.

Use `git write-tree` plus `git commit-tree`, which do not refresh, and
**assert the tree BEFORE it is written rather than inspecting the commit
afterwards.** Inspecting afterwards tells you what happened; asserting before
tells you whether to proceed.

### A filtered commit protects the files you NAME, not the inputs your BUILD READ

Two laundering hazards were already recorded: staging a file another lane is
mid-edit in, and regenerating a shared artifact whose generator source is
uncommitted. **This is a third and it defeats both defences.**

On 2026-08-02 a lane staged four paths by name and deliberately did NOT stage a
dirty `of_lib.py`. **The staging was correct. The artifact was not.**
`build_smelter.py` READS `of_lib.py` at build time, so the `smelter.glb` it
committed carried a sibling lane's unreleased palette edit, baked into the
bytes.

**Explicit-path staging gives ZERO protection here**, because the contamination
is inside the artifact before staging begins. Every gate passes on it: the
validator, the coplanar check, the byte-identical rebuild control (it rebuilds
from the same dirty input), and `git diff --cached` all read clean.

**The only check that catches it is a `git archive HEAD` rebuild and a hash
compare.** Measured: a clean rebuild produced `0848bc10` against the committed
`9226b56f`.

**Before committing any built artifact, ask what its build script READS, not
just what you are staging.** If any input is dirty, rebuild from a clean
`git archive HEAD` tree and compare hashes.

### Read a gate's VERDICT TOKEN, never its last lines

A lane ran `check_coplanar.py | tail -2` and shipped a red gate. On success the
last line **is** the verdict. On failure the verdict is followed by a six-line
explanatory footer, **so the same `tail` showed prose and hid `FAIL` six lines
above it.**

**A truncation that is safe on the happy path and lossy on the failure path
fails in exactly the direction nobody checks.** Grep the verdict token
(`FAIL`, `OVER`, `over allowance`) rather than slicing the tail.

### An implausible magnitude is an instrument bug until proven otherwise

`check_shadow_lod.py` treated a whole file's LOD nodes as one ladder, so on
`launch_pad` (which declares `LaunchPad_LOD0/1/2` **and** `LaunchClamp_LOD0/2`)
it measured a pad against a clamp standing 14 m away and reported a deviation of
**14,090 mm**.

Two lanes and Admin propagated that number as an asset defect within an hour,
and it became a task. **Fourteen metres is not a plausible LOD deviation for a
2,564-triangle asset.** The tell was there and nobody looked.

**When a measurement is implausible in magnitude, suspect the instrument before
writing it down as a finding.**

### The marginal multiplier prices the NEXT triangle; it is not a saving

The shadow-cascade work gave asset lanes a lever: an asset's marginal multiplier
is `1 + (cascades still drawing tier 0)`, so making a lower tier shadow-safe
takes an asset from 4x to 3x to 2x to 1x, and every triangle after that costs
proportionally less frame.

**It is a price on future growth, not a recovery on present cost, and treating
it as the latter produces work that measures well and saves nothing.**

Measured on 2026-08-02. `floor` missed cascade 0 by 20.00 mm, exactly like
`belt_segment`, and looked like the same cheap win. It is not. The 20.00 mm is
the ribs' tops penetrating 0.020 into the plate, and **`Floor_LOD1`'s entire
saving IS the omission of those ribs**, 132 triangles down to 60. Adding them
back to clear the gate returns LOD1 to 132, **identical to LOD0**. Cascade 0
would draw the same triangles either way, the multiplier would read a triumphant
1.0x, and nothing whatsoever would have been saved.

**Where making a tier shadow-safe costs that tier its entire reason to exist,
the multiplier becomes a false proxy for the thing it stands for.** Check what
the lower tier actually omits before spending anything to make it admissible.
An asset that is not about to grow does not benefit from a cheaper next
triangle.

`belt_segment` is the honest opposite case and shows what a real one looks like:
its 20.00 mm was a **dropped state chip**, so restoring it cost twelve triangles,
took the asset to 1.87 mm and 1.0x, **and fixed a correctness defect on its own
terms** (a belt at LOD1 range had no state readout at all, while every other
machine's LOD1 keeps its chip).

### A completed attribution with no owner ships forever

The near ground on Forge has carried a pattern of dark etched contour lines in
every close frame for months. Reid reported it directly. It was then attributed
**definitively, by elimination**: it survives `?groundtexamp=0` and vanishes
under `?groundreliefamp=0`, so it is the ground relief bump. A second lane
independently flagged the identical artefact from in-world frames without
knowing that attribution already existed.

**Two lanes measured it, both were mid-pass on something else, both correctly
declined to reach outside their slice, and nobody fixed it.** Every individual
decision was right and the outcome was a known defect shipping in every build.

The gap is Admin's, not the lanes'. **A lane that finds a defect outside its
slice has discharged its duty by reporting it. Converting that report into an
owned task in the same turn is the controller's job**, and a report that lands
only in a controller file is a report that has been filed rather than routed.

When two independent lanes report the same symptom, that is not corroboration
to be noted. **It is evidence that the routing failed once already.**

### An unowned load-bearing file is a bug in the agent architecture

`web/src/world/FloatingOrigin.ts` has **zero decision tags and is named in no
controller doc**, and a runtime body switch turns on it. `Services.body` is a
`readonly` scalar on a 45-field all-`readonly` record **with no teardown of any
kind**, and it is likewise unclaimed.

Floating origin is listed in core-engine's charter in `CLAUDE.md` in those exact
words. **It has been theirs the entire time and their context file never said
so.** Nothing was contested; the file simply fell between the charter and the
context file, which is where rot accumulates without anyone deciding to allow
it.

**Ownership recorded only in the charter is not ownership.** When a domain
touches a file that its own context file does not name, adding it there is part
of the work, not paperwork after it.

### A registered parameter that does not move the picture is worse than a missing one

> **SUPERSEDED IN PART, 2026-08-03 (RN-1206).** `--sundot` is NOT dead. It moves
> the ground box 66.98 to 105.29 at `--sundot=0.85`. RN-844 fixed the `up`-vector
> bug this entry was really about. **The rule below stands; this instance was
> retired and nobody came back to say so**, which is exactly what the
> forward-pointer rule in this file exists to prevent. Admin owns this file and
> let it sit for a day.

`--sundot` is registered in `PAGE_PARAMS`. `--sundot=0.28` and `--sundot=0.92`
produce **visually identical frames** in the walk scenario.

A lane reached for it to reproduce a grazing-light condition and got a confident
null result: the artefact under investigation appeared unchanged across the
whole range, which is exactly what "this is not lighting dependent" looks like.
**A missing flag fails loudly. A dead one returns a clean answer to a question
it never asked.**

Being in the params list is a claim that the control works. **Either make it do
what its name says or delete it**, and treat any registered control that has
never been proven to move its own output as unverified rather than available.

### An unmergeable binary cannot be owned by more than one lane at a time

On 2026-08-02 three lanes were concurrently rebuilding `web/wasm/dist/of-core.wasm`:
physics adding transfer exports, gameplay adding a catalogue row, world-gen
adding a body. **A `.wasm` is one opaque blob and git cannot merge it. Whoever
commits second silently reverts the others, and it looks green, because the
binary still parses and only the missing exports are wrong.**

The world-gen lane caught this unprompted and refused to commit, because two
physics commits touching `orbital.h` and `transfer.h` had landed after its
build. That refusal is the correct instinct and it should not have to be
rediscovered per lane.

**Standing rule.** Lanes commit headers, `.inc` files, TS and probes freely,
because text merges. **No lane commits `web/wasm/dist/of-core.wasm` or
`web/wasm/test/expected.json`.** They are built, used, and left dirty. Admin
does one settled rebuild from a tree holding every lane's sources, regenerates
the fixture, verifies the exports, and commits the binary alone. Every lane
states the exact export names and word counts it added, so the rebuild verifies
them without reading diffs.

Related and separately load-bearing: **an ABI bump and its wasm must land in one
commit that boots.** A half-bridge window reached `main` earlier the same night,
client at ABI 22 while the wasm was still 21, before the following commit closed
it.

### The shared git index is a second collision surface, and it fails silently

On 2026-08-02 a lane **landed a commit containing zero files.** `fe1268a` has a
full message, reads perfectly normally in `git log`, and is empty. **A
concurrent lane reset the shared index between its `git add` and its
`git write-tree`, two bash calls apart.**

Compare the two failure modes. A `.wasm` clobber at least leaves a wrong binary
that a probe can catch. **An eaten index leaves a commit that looks correct in
every log and history view and contains nothing**, and the work stays in the
working tree looking exactly like work that was committed.

**The check that was already in place did not catch it.** Confirming
`git diff --cached` is empty at both ends passes trivially when the index was
already empty when it was read. **A check that passes for the wrong reason is
worse than no check**, because it converts an unexamined risk into a recorded
assurance.

**Standing rule while lanes share a tree:**

1. **Private index.** `GIT_INDEX_FILE` under your own scratchpad,
   `git read-tree HEAD` into it, stage explicit paths into it. Never the shared
   index.
2. **The whole sequence in ONE shell invocation.** Between two calls another
   lane can and will run.
3. **Verify the written tree actually differs from the base tree** before
   `commit-tree`. Equality with base is the failure signature.
4. **Three-argument `update-ref refs/heads/main <new> <base>`**, so a moved HEAD
   fails loudly rather than clobbering.
5. **`git show --stat` afterwards** and confirm the file list is what you meant.
6. **Then `git reset -- <your paths>` on the SHARED index.** See below: this
   step is not tidiness, it is the fix for a worse bug than the one above.

**The second failure mode, which is worse: a private index does not clean up
after itself.** Once you commit from one, your files are still sitting in the
shared index in their **pre-commit** state, and relative to the new HEAD that
state is a **revert**.

Measured on this tree the same night, after two lanes had correctly adopted
private indexes: the shared index held **seven stale entries and would have
deleted 137 lines across two lanes** on the next commit anyone made from it. It
included a screenshot staged as a **deletion** moments after it had been
committed, and 35 lines of this file, **the entry documenting the first half of
this very bug.**

Repair is a path-limited `git reset -- <paths>`, which resets index entries to
HEAD and does not touch the working tree.

**A stale index entry is a silent revert wearing a normal-looking commit.** It is
one level worse than the empty commit: an empty commit merely loses your work,
while a stale entry actively removes somebody else's, and the diff of the
offending commit looks like ordinary work.

The general form, which is the part worth carrying elsewhere: **when several
writers share one mutable staging area, correctness cannot be established at the
ends of the operation. It has to be established inside it.** And **a writer that
opts out of the shared area still owes it a write**, because everyone else is
still reading it.

### The shared WORKING TREE is a collision surface too, so measure in an isolated one

A lane hit `ReferenceError: Lifetime is not defined` in `Boot.ts`, reasonably
concluded that `main` was broken, and reported it as such.

**`main` was fine.** `Lifetime` appears nowhere in HEAD. `web/src/app/Lifetime.ts`
was an **untracked file** belonging to another lane that had **22 modified and 5
new files in flight** for a mid-refactor that did not boot yet and was never
meant to.

Nobody was at fault. A refactor is unbootable in the middle by nature, and the
lane that found it drew the only conclusion its evidence supported.

**The rule: measure in `git archive HEAD` plus your own files, on your own
port.** Never against the shared working tree.

Two distinct things go wrong without it, and the second is worse:

- **You measure somebody else's half-finished work** and attribute it to yours,
  or to `main`.
- **A green result is not yours either.** Passing in a tree that contains another
  lane's uncommitted fixes proves nothing about what you are about to commit.

Corollary for the lane doing the refactoring: **commit in bootable slices where
you can**, because to everyone else an unbootable working copy is
indistinguishable from a broken `main`. Where a seam genuinely cannot boot until
all of it lands, say so out loud, so the other lanes stop trusting the tree
deliberately rather than discovering it one error at a time.

That makes five shared surfaces in this checkout: **the wasm blob, the git index,
the working tree, numbered decisions, and controller files.** All five failed at
least once. Only the wasm blob fails loudly.

### Path-limited commits cannot separate two lanes editing the SAME file

Every rule above protects against sweeping in **unrelated** files. None of them
helps when the collision is **inside one file**, because path-limiting operates
at file granularity and interleaved edits are finer than that.

On 2026-08-03 the rendering lane needed `web/src/app/Boot.ts` in order to commit
a shader change, since `Boot.ts` was that shader's only caller. The core-engine
lane's world-lifecycle refactor was **interleaved in the same file**, along with
`Services.ts`. The rendering lane could not exclude those hunks and still leave a
tree that compiled, **so it committed both under its own message and said so
plainly in its report.**

**Its reasoning was sound and its outcome was inverted.** It committed the
*callers* without the *new modules*, believing that was the option that kept
HEAD compiling. HEAD then imported `Lifetime.ts`, `WorldSession.ts` and
`HandleLedger.ts`, **none of which were in HEAD**. Main did not compile for
exactly one commit, until the core-engine lane landed those files.

**Nothing was lost. Two files are attributed to the wrong lane forever.**

**The failure is Admin's to prevent, not the lane's to solve.** A lane that
discovers this at commit time has only bad options: commit both and misattribute,
or decline and block. By then it is too late.

**The rule.** Wiring files that nearly every feature must touch (`Boot.ts`,
`Services.ts`, `main.ts`, and the equivalent in any codebase) are **predictable
collision points**. Before briefing two lanes, ask which files both will have to
edit. Where the answer is a shared wiring file, either **serialise the lanes**,
exactly as binary assets are serialised, or **name one lane the sole writer** of
that file and have the other publish what it needs wired.

The general form: **the granularity of your isolation mechanism sets the
granularity of the conflicts it can prevent.** File paths cannot protect a file.

**And the corollary, learned the same way:** committing half of an interleaved
change produces the broken state you were trying to avoid. If the two halves
cannot be separated, they cannot be committed separately either. Stop and
escalate rather than choosing which half to ship.

### A sentence in a comment is not an invariant

An asset file asserted, in prose, that a cuff's first ring inradius swallows the
skin band's circumradius. **It was true when it was written.** Months later a
change to a neighbouring proportion broke it, and **the bare wrist burst out of
the cuff as an orange collar.** One line below, knuckle plates sat at a typed
`z` tuned against the old palm thickness; against the new palm they would have
**floated 15 mm above it**.

**Two latent traps, both armed by a change that had nothing to do with either,
both documented in prose, neither checked by anything.** The render caught the
first immediately. Nothing would have caught the second.

The same file had already produced a second instance of the same thing that
morning: a docstring justifying two LOD thresholds with the numbers 52 mm and
163 mm, where the measured values are **139.87 mm and 278.37 mm**. **A comment
that justifies a number is a number nobody is checking**, and the next person
reasons from it.

**The rule.** When you write down a relationship between two authored values,
either **derive one from the other** or **assert it in the build**. Prose is for
the reason, never for the constraint. A relationship that matters enough to
explain matters enough to fail.

The tell that you are about to do this: any comment containing "so that",
"which means", "hence", or a number that appears nowhere in the code beneath it.

### Measure the authored table, not the picture

The same pass found that a hand's five finger tubes were **one fused solid**.
Two circles are separate only when their centres are further apart than the
**sum** of their radii, and every adjacent pair overlapped: 12.0 mm, 18.5 mm,
16.0 mm. **The hand could not show a gap between two fingers at any pose, from
any camera, under any lighting.**

An earlier pass had looked at the same complaint and fixed the colour, the
distance and the finger *count*. All three were real defects. **The section was
the mitten**: a palm authored 130 x 86 mm at 1.5:1 against a real hand's roughly
90 x 28 at 3.2:1, with 43 mm fingers against a real 18 to 20.

**A frame shows you a symptom and every plausible cause for that symptom is
wrong.** The webbing looked like missing detail and was tube intersection. The
mitten looked like a modelling style and was two numbers in a table.

**When an art complaint survives a pass that addressed it, stop looking at the
render and go read the numbers the asset was built from.**

### Put the re-apply of a negative control in a `finally`

A negative control means deliberately reverting your fix, rebuilding, proving the
defect returns, and then putting the fix back. **The middle of that procedure is
a tree containing a known defect on purpose.**

If the process dies there, is interrupted, or the lane runs out of context, **the
deliberate defect is what is left in the working tree**, and it looks exactly
like ordinary in-progress work to whoever finds it.

**Make revert and re-apply one process with the re-apply in a `finally`**, so no
interruption can leave the reverted state behind. An asset lane did this
unprompted tonight while proving a palette change, and it is the right shape for
every negative control anyone runs here.

The general form: **any procedure whose intermediate state is a lie must not
have an exit that stops in the middle.**

### A build and a test in one shell line will report the PREVIOUS build's verdict

Twice in one night a build failed, **the stale binary from the previous build ran,
and the suite reported green.** Once it nearly recorded a false negative control,
which is the worst possible place for it: the whole point of that procedure is
that the reverted code must fail, and a stale binary makes it pass.

`INSTRUMENTS.md` already says **a tool that reports nothing may not be running.**
This is the sharper form: **a tool that reports something may be reporting on
code that no longer exists.**

`make && ./tests` is safe. `make; ./tests` is not, and neither is any pipeline
where the test output is what gets read and the compiler output scrolls past.
**Grep the compiler output separately from the test output**, or fail the whole
line on a non-zero build status. It costs one line.

The general form, and it is the same shape as the empty commit and the stale
index: **when two steps share a workspace, the second one cannot tell you whether
the first one happened.** Ask the first step directly.

### A control that fails to go red is a finding, not a nuisance

A lane wrote a gate asserting a rig's humerus-to-forearm ratio, then tried to
prove it by setting the constant back to the shipped, defective value.

**The build went green.**

The elbow position is **derived** from that ratio, so moving the ratio moves both
sides of the equality. **The gate structurally could not see the case it was
written for.** It was only ever guarding a *typed* elbow, and the elbow had
stopped being typed in the same commit that added the gate.

**And the case it could not see was the exact one it existed to prevent.** Admin
had predicted in writing that a future lane would set that target to the view
model's 1.06 by mistake. The equality would have waved it through.

**The gap was found by a control failing, not by a gate passing.** Every green in
that build was truthful and the check was worthless.

The fix was to give the target its own **plausibility band** (1.15 to 1.40, with
1.06 deliberately outside it and named in the message), which is a claim about
the value rather than a relationship between two values that move together.

**Two rules.**

**When a negative control does not go red, do not adjust the control until it
does. Ask first whether the gate can see that class of change at all.** A control
that has to be tuned to fail is telling you something about the gate.

**And beware asserting a relationship between quantities that are derived from
each other.** `assert(a == f(b))` proves nothing when `b` was computed from `a`.
The identity holds by construction, at every value, including every wrong one.

### Gate the complaint, not a proxy for it

The same pass had to protect a first-person rig from a "correction" that would
reopen a closed complaint. The obvious gate is the hand's distance from the eye,
which is the number two previous passes fought over.

**The lane gated the complaint instead**: one glove's share of the visible frame
height at the shipped 60 degree FOV, which is what the user actually objected to.

| state | visible frame | one glove |
|---|---|---|
| shipped | 0.7159 m | **13.4%** |
| old distance restored | 0.5023 m | **19.1%** |
| old distance **and** the old section | 0.5023 m | **25.9%** |

A band at one sixth sits between 13.4 and 19.1, **so it refuses the regression
without needing the old section restored as well.** A distance gate would have
passed anything that kept the distance while making the hand huge; this one
cannot.

**Where a complaint can be expressed as a measurement, gate that measurement.**
A proxy is only as good as the assumption connecting it to the thing anyone
cares about, and that assumption is rarely written down.

### A finding that a later entry fixes must say so where the finding is

Admin briefed a lane on GP-146, a recorded defect marked "RECORDED, NOT FIXED":
`of_vs_remove` takes the subtree further from the root, so which half of an
identical rocket a delete destroys depends on which part was placed first.

**It had been fixed two entries later by GP-148**, which normalised the root to
the top of the stack. Nothing in GP-146 pointed forward. The lane discovered it
by **re-running the probe at HEAD rather than trusting the record**, and found
green.

**The decision log is now over 300 entries deep.** A reader who lands on a
finding has no way to know the story continued, and the cost falls on whoever
routes work from it. **That is one wasted round trip and it will not be the
last.**

**The rule: when an entry closes an earlier finding, edit the earlier finding to
point forward.** Backward references are free and useless; a later entry naming
an earlier one is only visible to somebody already reading the later one.

**And the corollary the same lane supplied:** those delete assertions were
**inverted in place** when GP-148 landed. **A probe edited to expect the opposite
result is exactly the artefact you cannot take on trust**, because a claim
inverted once can be inverted wrongly. Re-run, do not read.

### The fixture that must differ from the default will never test the default

An end-to-end playthrough found that **the very first autopilot press a player
ever makes did nothing and reported success.**

The requested-orbit field defaults to 100 km. The teleport-to-orbit cheat puts a
player at 100 km. **So the default destination is the orbit you are already in.**
The solver correctly returned a valid programme of **zero burns**, the executor
correctly completed it instantly, and the screen correctly said the programme was
complete.

**Nothing was wrong anywhere.** Every component behaved to specification. **The
identity element was standing in the player's path and each part was right while
it did.**

**No test caught it, and the reason is the rule.** Every autopilot probe written
that night **moves the altitude first, on purpose, so that there is something to
measure.** A zero-burn programme is useless as a fixture: you cannot assert a
delta-v, a burn count or an arrival against it. So every test author,
independently and for a good reason, **excluded the exact case a player meets
first.**

**The rule: a fixture that must differ from the default in order to measure
anything will never test the default.** And defaults are what a new player, a
new caller and a fresh install all encounter before anything else.

The general form: **identity cases are invisible to differential testing.** Zero
burns, an empty list, a no-op edit, a destination equal to the origin, a rename to
the same name. Each is a case where the correct behaviour is *nothing*, which is
also what a broken implementation does.

**Test them explicitly and assert on the report rather than on the change.** Here
the fix was measured on both sides: 0 burns at 100 km, 2 burns and 207.31 m/s at
250 km. The first half of that pair is the one nobody writes.

Related and distinct from **a fixture that never performs the action cannot
exhibit a defect in the action**: that one is about the fixture not doing enough,
this one is about the fixture being unable to do nothing.

### A metric that is flat in its own independent variable is not measuring that variable

A lane swept a rotation strength and watched two numbers. Local anisotropy fell
monotonically, as expected. **The between-window orientation spread saturated at
37 to 38 degrees from the very smallest swing onward and never moved again.**

They read that as "0.4 is the efficient point". **The correct reading is that the
spread was not responding to the thing being swept at all**, and a quantity that
does not respond to its own independent variable is not measuring it.

**Only looking at the picture caught it.** The image was a field of concentric
fingerprint whorls, visibly far worse than the artefact it was meant to fix.

**When a sweep produces a number that is flat across the range, do not read off an
optimum. Ask what that number is actually a function of.** Saturation from the
first step is the signature.

### A second side removes one class of false pass and guarantees nothing else

The same instrument was **deliberately built two-sided** to dodge a trap already
recorded here: a single whole-frame anisotropy number would fall both when the
artefact was fixed and when the signal was destroyed. So the claim became **each
local window is still a corduroy, AND the windows disagree with each other**, and
it was validated first on synthetics through the identical code (0.9894 for a pure
corduroy with orientation exact, 0.0462 for white noise, 0.1743 for isotropic
blobs).

**It passed the fingerprint at every setting.** Local coherence went *up*, 0.5214
to 0.7147. Spread went up, 16.97 to 37.76 degrees. **Both halves were true
statements about the image, and the image was wrong.**

**Concentric contours are locally near-parallel and turn with position, so a
fingerprint satisfies both sides by construction.** The missing property was
**local wavelength**, and nothing in the claim mentioned frequency.

**The rule: adding a side removes one class of false pass. It says nothing about
the classes you have not enumerated.** Two-sided is better than one-sided and is
not a proof. **Name what a passing image could still be** before trusting a green,
and write that list in the instrument's own header so the next reader cannot
trust it naively.

### A gate that constrains the thing it measures has become a design

`_relief_ripple` caps how far it warps its wave vector, specifically so the vector
**never flips sign**, because a sign flip would break the skew asymmetry that the
generator's own selftest measures.

**The test is not wrong and the cap is not careless.** Together they are the
reason the ground ripple has **no orientation freedom anywhere on the planet**,
which is the artefact Reid has complained about repeatedly.

**A gate is supposed to observe the work. When the work is shaped to keep the gate
green, the gate has quietly become a specification** and nobody decided that it
should be one. The tell is a constraint in the generator whose stated purpose is
to protect a measurement rather than to serve the output.

### In an `&&`-chained aggregate, where you put a gate decides whether it IS a gate

A lane added a new check to `npm run check`. **`check` is an `&&` chain, and one
of its existing links has been red for everybody for some time** (29 files over a
line-count cap, nobody's fault, nobody's tonight).

**A gate appended to the end of that chain would never have executed a single
line**, while its own commit message truthfully said it had been added to the
aggregate check. It would have read as covered and been dead from the day it
landed.

They placed it **before** the failing link and **verified rather than reasoned**:
`npm run check` prints `posecheck: PASS (9 checks)` and *then* goes red further
down, in that order.

**The rule: adding a gate to a chain is not the same as running it.** Check what
is upstream of your link and whether any of it is currently failing. **A
long-broken link converts everything after it into decoration**, and the decay is
silent because each new gate's author verifies their gate in isolation.

Corollary, and it is why the situation persists: **a permanently red aggregate
trains everyone to stop reading it**, which is what makes the next dead gate
invisible. Fix the red link or split the chain; do not add to a chain nobody
runs.

### A wrong number that changes nothing is the one no process catches

Admin wrote an orbital speed of 7.6 km/s into the authoritative decision log. It
came from a domain report, it was repeated in a source file and in two risk
entries, and **it is 4.05x out**: the real figure is 1879.26 m/s. 7.5 km/s is
Earth's low orbit, and this planet's mu is 3.5316e12.

**Every conclusion drawn from it was correct.** The argument it supported (that
two representations of one object disagreed, and that the disagreement was large)
holds at either value. **So no reader ever had a reason to check it**, and it
survived three independent transcriptions.

`NUMBERS.md` already says **an implausible magnitude is an instrument bug until
proven otherwise**. This is the complement: **a plausible magnitude in a
load-bearing document is checked by nobody, precisely because nothing it touches
comes out wrong.**

**Quantities that decorate an argument rather than drive it are the ones to
verify**, because the argument will never do it for you. When a number is quoted
to justify a decision, ask whether the decision would change if the number were
half or double. **If the answer is no, that number has no defender.**

### A count that happens to equal a total reads as success

A render rig imported twelve `.glb` files into one scene. Blender's ID namespace
is per file, so the second import's `OF_Steel` arrives as `OF_Steel.001`, which
resolves to the role name `"Steel.001"`, which is not a role. **Eleven of twelve
assets rendered with no material mapping at all.**

The rig reported it honestly. It printed *"44 material(s) not in the palette"*
and, on the same line, **"10 mapped"**.

**Ten is exactly how many roles exist.** So the number that meant "ten roles were
matched at least once" read as "ten of the twelve things you asked for worked",
and nobody opened the skip list. **Every production-line comparison this project
made was one asset's real surface against eleven assets' flat constants, in both
halves of every pair.**

**Print the denominator you mean.** "10 mapped" and "10 of 12 assets mapped" and
"10 of 54 materials mapped" are three different claims and only one of them is
what a reader assumes. A bare count next to a plausible total is a coincidence
waiting to be misread.

### A control whose arming step silently fails is indistinguishable from a passing control

A lane armed three negative controls by writing a modified instrument through a
Python heredoc using an absolute `/tmp` path. **Git Bash translates `/tmp`; the
Windows Python it invoked does not.** The write raised, **the file was never
modified, and all three controls ran the unmodified instrument and passed.**

The closing claim, **"revert byte-identical", was vacuously true**, because
nothing had been changed to revert.

It was caught only because **all three printed the same success line** instead of
three different refusals. Three distinct sabotages producing one identical
message is the tell.

**A control must assert that its own arming took effect** before it draws any
conclusion from the run: read the file back, diff it, or check the exit status of
the step that wrote it. Otherwise a broken setup and a genuinely passing subject
produce the same output.

This is a cousin of **when two steps share a workspace the second cannot tell you
whether the first happened**, and of **a guard whose verdict nothing acts on is
not a guard**. The family is the same: **a step that can fail quietly, upstream
of the thing you are reading.**

### A probe that prints and never asserts passes forever

A building survey ran **thirteen stages** and reported `smoke: PASS` every time.
**Not one of the thirteen contained an assertion.** They gathered text, printed
it, and exited zero. Thirteen green runs supporting **zero claims**.

Worse, the gathering itself was wrong. `txt()` was `innerText || textContent`,
and **`innerText` falls back to `textContent` on an unrendered element**, so a
hidden prompt returned a **stale string naming the previous item** and the probe
reported it as drawn. Jammed-together words were the only tell.

**So every reading in that survey's reports is tainted, and the PASS beside them
never meant anything.** The two failures compound: an instrument that reads the
wrong thing, inside a harness with nothing to catch it.

**A probe's exit status must depend on a claim.** If a stage only observes, say
so in its own output and do not let it contribute a PASS. **A suite whose green
is unconditional is a suite that cannot go red**, which is the same family as
*a control that will not go red is a finding* and *a guard whose verdict nothing
acts on is not a guard*.

### A NUL byte makes git call your source file binary, and every diff since is unreadable

`web/src/ui/GameHud.ts` contained a **literal NUL byte**. Git therefore treated
it as binary, so **every diff of that file for months rendered as "Binary files
differ"** rather than as lines.

Nobody noticed, because a diff that shows nothing looks like a file that changed
in a way you did not need to read.

Found by `git diff --numstat` printing **`-` for both the added and removed
columns**, which is git's own signal for "I am not counting lines here".

**If a text file's diff has ever been unreadable, check for a control character
before assuming the tooling is at fault.** And `--numstat`'s dashes are worth
knowing as a tell: a file that never reports line counts is a file git has
stopped reading as text.

### A fix applied to one script in a family is not applied to the family

BT-30 fixed the Windows-only Chrome-path defect in `run.mjs` and `boot.mjs`: a
hardcoded `chrome.exe`/`msedge.exe` list meant neither could launch a browser on
the Proxmox Linux VM this project moved development to. **Six siblings were not
checked**: `reload.mjs`, `dayreload.mjs`, `stationreload.mjs`, `mtnreload.mjs`,
`powerreload.mjs` and `vesselreload.mjs` all copy the identical Windows-only
`CHROME` array (each runner is deliberately standalone rather than sharing a
module, per their own comments), so every one of them still returned `no Chrome
or Edge found` and exited 2 on this VM, silently, seven weeks after the family's
first member was fixed.

Found while proving the POI/site bridge's save round trip (WG-151): the setup
probe (`probes/poisites.js`) needed a real `page.reload()`, which only
`reload.mjs` provides, and `reload.mjs` would not launch at all.

Fixed in `reload.mjs` only (this lane's actual dependency), mirroring `run.mjs`'s
`CHROME_PATH` override plus the four Linux paths verbatim. **The other five
siblings are UNFIXED and this is a known gap, not a silent one**: `dayreload.mjs`,
`stationreload.mjs`, `mtnreload.mjs`, `powerreload.mjs` and `vesselreload.mjs`
still cannot launch on Linux until the same four lines land in each.

**A fix that lands in one file of a "deliberately standalone" family is a fix
that has to be re-applied by hand in every other file, and nothing enforces
that it was.** The standalone-ness that keeps each runner simple to read is
exactly what lets a fix silently fail to propagate; grep the family for the
defect's signature before declaring the class closed.

### `of.run()` looked hung under load and was not; a quiet box finished it, which is the correction as much as the finding

Proving the POI/site bridge's save round trip needed a REAL `page.reload()`
(`probes/poisites.js`), which needs `of.run()` to advance simulated time. In
the session that wrote this entry it never completed: **180 s, 400 s, 550 s
and 590 s all timed out**, always the same way -- `page.evaluate` killed
mid-call when the wrapping `timeout` closed the browser. That was written up
here AS a probable defect in `of.run()`. **IT WAS NOT ONE.** A later, quieter
run of the exact same probe through the exact same runner completed cleanly:
the ruin at 753.77 m, the id round trip, both bits surviving the reload, every
negative control green. **The word "hung" in the first draft of this entry
was wrong and is corrected here rather than quietly edited away**, because a
finding that turns out to have the wrong verb is still worth keeping on
record -- this file's own rule about a later entry fixing an earlier one.

**THE CONTROL THAT MATTERS: this is NOT the poi bridge's setup script.** The
already-shipped, unrelated `probes/trees.js`, run through the ALREADY-FIXED
`run.mjs` (BT-30) with no `page.reload()` in it at all, hung at the exact same
call -- `of.run()` -- for the exact same reason, on the same VM, in the same
session. Two independent probes, two independent runners, one shared failure
point. That rules out a defect in `poisites.js` or in `reload.mjs`'s new
Linux Chrome path (the entry above): the code that hangs is the SAME code
`run.mjs` has been calling since BT-30 supposedly proved it out.

**MEASURED, staged, rather than guessed at.** A hand-rolled diagnostic logged
every step with a wall-clock stamp: `page.goto` returns in 0.3 s; `window.__of`
exists at 25 to 30 s; `/core`'s own boot log prints "boot 22 to 28 s" (close to
the number that log names); but `window.__of.ready` itself does not resolve
until **127 to 156 s** -- a 100-second-plus gap between the engine's own claim
that it finished booting and the promise a caller actually awaits resolving.
`of.run(1.0)` was then called and never returned inside any budget tried, up to
432 s alone. `boot.mjs`'s own harness (a DIFFERENT measurement path that never
calls `of.run()`) reported a clean **101 s total boot** in the same session,
which is the fact that pins the first gap to variance rather than to a second
defect: it is slow, not broken, up to the point `of.run()` is called, and then
it stops progressing entirely within any budget this session could afford.

**THE LIKELY CAUSE, and it is a fact about THIS run, not a fact about the
game:** `ps aux` at the time showed FOUR OTHER PROJECTS' `vite preview` servers
and their own Chrome instances alive concurrently (`sweep-shards/shard0..3`,
plus `research-station`, plus `enemies`), all on the same box, all software
rendering under SwiftShader, which the project's own boot log measured at
`gpu ANGLE ... SwiftShader Device`. CLAUDE.md's own §7.4 names exactly this
risk for exactly this VM ("do not fan out sixteen browser probes") and this
session did not cause the fan-out, it walked into one already running. A
simulated second driven by real animation frames, competing for the same cores
against several other lanes' full 3D boots, can plausibly take minutes rather
than the fraction of a second a quiet box would need.

**WHAT STAYS TRUE FROM THE FIRST DRAFT: the diagnosis, not the diagnosis's
verb.** `ps aux` at the time showed FOUR OTHER PROJECTS' `vite preview`
servers and their own Chrome instances alive concurrently (`sweep-shards/
shard0..3`, plus `research-station`, plus `enemies`), all software rendering
under SwiftShader on the same box. CLAUDE.md's own §7.4 names exactly this
risk for exactly this VM ("do not fan out sixteen browser probes"). A
simulated second driven by real animation frames, competing for the same
cores against several other lanes' full 3D boots, took minutes instead of
the fraction of a second a quiet box needed -- SLOW, not BROKEN, and the two
look identical from inside a process with zero error output and a fixed
timeout, which is the actual lesson: **a probe that stops progressing with no
error and no crash is not evidence of a hang until a quiet box has been tried
and also failed.** This session's first attempt skipped that last step and
wrote "hang" from three timeouts alone.

**If `of.run()` (or any real-time-driven probe) ever again fails to progress
past boot with no error and no crash, check `ps aux` for concurrent Chrome/vite
processes from OTHER lanes, and if the box is busy, GET A QUIET ONE AND RETRY
before writing the code under test up as broken.**


### The CE-50 capsule and the walker's own predicate are not the same test

`ruinplace.js` proved a ruin wall solid the way CE-50 taught: five columns at
`CAPSULE_SAMPLES_M` (`[0.15, 0.9, 1.65]`) offset by `CAP_RADIUS_M` = 0.4 m,
every sample through `of.solidBuild`, with a 100 m-away control proving the
instrument can read clear. Then it reused the same helper to ask a DIFFERENT
question -- "after walking into that wall, is the player wedged in stone?" --
and the check went red on a sim that was behaving perfectly.

`KinematicBody` calls `StructureBodies.free`, which samples **one column** at
those three heights and nothing off-axis. The five-column form is therefore
strictly MORE conservative than the walker's own rule, so a player who has been
**correctly** stopped flush against a wall has a 0.4 m side column inside the
stone and reads as embedded.

**The conservative capsule is the right instrument for "would a body FIT here"
-- a doorway, an arrival point, which is exactly what CE-50 built it for -- and
the wrong instrument for "is this body inside something", which has to use the
consumer's own predicate at the consumer's own dimensions.** Both live in the
probe now, under two names (`capsuleHits`, `walkerHits`), with the distinction
written beside them. The generalisation is CE-50's own sentence pointed the
other way: an occupancy check has to match the consumer, and "stricter" is not
the same as "safer" when the answer is used as a failure condition.

### `probes/enemies.js` has never parsed, so it has never run, since the day it was written

An unescaped apostrophe in

    check('and every rate is /core's own table, not a copy', ...)

closes the JS string early. `run.mjs` wraps every probe in
`((OF_ARGS) => ( ... ))`, so the file dies with `SyntaxError: missing ) after
argument list` before a single assertion executes, and the runner surfaces it
as a page-evaluate failure rather than as a broken probe file. It was written
in `fb0723b` with the enemy lane, it has never been green once, and no census
has ever noticed.

**This is GP-671's class with the volume turned up.** That finding was a probe
with no documented invocation, so `probeall.mjs` skipped it; this one could not
have run even if invoked. Found by the ruin-placement lane running it as a
spawn-path regression check, which is the only reason anybody looked.

Fixed (one character). It then showed **three reds**, and every one of them was
reproduced identically on a HEAD-baseline build with the ruin lane's own sources
stashed out, so attribution is settled and they belong to gameplay: 3 of 5
smelter placements refused, 0 kills over 14 aimed rounds, and `pool.instances`
exactly 4 below `live + nests` both before and after (`SpiderFlock` claiming
creatures out of the batch). **Reported, not chased.**

The lesson for the harness is narrow and cheap: **a probe file that cannot be
parsed is indistinguishable, in the runner's output, from a page that failed to
boot.** `run.mjs` already reads every probe off disk; parsing it with `new
Function` before launching a browser would separate the two in one line and
would have caught this on the day.

### `swarm.live` changed subject the day something other than a wave produced a creature

`probes/enemies.js` asserted `swarm.live === 0` on a fresh world as its "nothing
has attacked yet" control, and `swarm.spawned === lastWave.totalCount` as its
"it fielded the roster /core costed" check. Both were exactly right for as long
as the wave loop was the only thing that made a creature. The ruin lane posts a
garrison at world build, 753 m from spawn, holding station and attacking
nobody -- and both numbers silently started meaning something else.

**A total that quietly changes subject is worse than a missing one**: nothing
fails, the control just stops controlling. `EnemySwarm.report` now publishes
`waveLive`/`garrisonLive` and `waveSpawned`/`garrisonSpawned` beside the totals,
derived from `provenance` rather than counted separately so the pair can never
disagree, and the probe reads the wave ones where it always meant the wave ones.
The rule worth carrying: when a second producer joins a counter that only ever
had one, **split the counter in the same commit** -- every consumer of it was
written against the old meaning, and none of them will fail loudly.

### The committed wasm binary is a whole ABI behind the client, so a clean checkout cannot boot the browser

`web/wasm/dist/of-core.wasm` is tracked, and at `d414c91` it reports
`of_abi_version` **23** while `web/wasm/of_core_api.cpp` says **24**. The client
refuses the mismatch, so every browser probe on a fresh worktree dies as:

    console.error: [of] boot failed Error: of-core ABI mismatch:
                   wasm reports 23, client expects 24
    runner: page.waitForFunction: Timeout 60000ms exceeded.

The visible symptom is a 60-second runner timeout, which names nothing. This is
a known consequence of two earlier, deliberate decisions -- WG-141 regenerated
the binary in the working tree and explicitly did not commit it, and BT-39 found
this artefact is toolchain-dependent, so a hash from one machine is not
authoritative for another -- and the fix is therefore not simply "commit one".

**It is logged here because the cost is real and is paid silently by every lane
that starts from a clean tree.** The workaround is two commands before any
probe: `web/wasm/build.ps1` (emsdk at `C:\Users\reida\emsdk`), then
`npm run sync-wasm` in `web/`.

### A restore that names a value goes stale; read the shipped value instead

RN-1570's bias-sweep arm in `artframe.js` ended with `SH.bias(-0.0006)`, the
literal that was shipped when the arm was written. RN-1571 then changed the
shipped bias, and the "restore" silently became a **re-introduction of the
defect**: every `shade` run -- including runs that asked for no bias arms at
all, because the restore sat after the loop rather than inside it -- put the old
value back before the shot's own capture and returned a frame from the build
being replaced.

It was caught only because the headline number disagreed with itself: the
`smelterhero` box read **19.55 under `--shade` against 45.65 on the identical
binary without it**. Nothing failed, no assertion fired, and the frame looked
plausible.

**The rule: an arm restores by READING the live value before it perturbs it,
never by naming a constant.** Here that is one line, `of.stats().shadow.biasUnits`
captured before the loop, and it is published in the report beside the value it
restored so a reader can see the round trip closed. The same shape as RN-1526:
an instrument that records an intention rather than an observation will report
success while doing nothing.

### A rounded FRACTION cannot represent a rare event; publish the COUNT beside it

`probes/ibldiag.js` reports `brightFrac`, the fraction of the environment cube
brighter than 10x its own mean, rounded to four decimals like every other field.
RN-1572 gave the sky a physically correct sun, and `brightFrac` **stayed
0.0000** -- because the real sun subtends 6.7e-5 sr, i.e. **5.3e-6 of the
sphere**, about 2 texels of 393,216. Four decimals cannot hold it.

The trap is worse than a lost digit, because the acceptance criterion written
against that field ("brightFrac must become nonzero") **is only satisfiable by a
sun several times too wide** -- which was the defect being removed. The metric
rewarded the bug.

**The rule: when a quantity is a fraction of a large denominator and the
interesting case is rare, publish the integer numerator too.** `brightTexels`
now reads 0 -> 1 at a 256 cube and 0 -> 14 at 1024, and "no bright source" and
"a sun" stop printing as the same number. Check any acceptance phrased against a
rounded fraction for the same failure before relying on it.

### Rebuilding a "before" directory from current source destroys the pair

The before/after discipline in this project is usually two build directories.
RN-1575 added a probe file, and probes are read off disk by `run.mjs` rather
than bundled -- so no rebuild was needed -- but the reflex `npx vite build
--outDir dist-light-before` ran anyway and **overwrote the before build with
current source**. The directory kept its name and every number taken from it
afterwards would have been an after number wearing a before label.

**The fix is not more care, it is fewer builds.** Standing rule 7 already
requires a negative control for every behaviour change; honouring it turns a
two-directory comparison into a one-flag pair on one binary, which cannot be
clobbered by a stray build and is a stronger control anyway because the two arms
share the binary, the assets and the boot. `?shadowbias=0` and `?sundisc=0`
together reproduce the pre-lane build to the digit on all seven `smelterhero`
rectangles -- and that reproduction is itself the check that the control works,
which a second directory never gives you.
