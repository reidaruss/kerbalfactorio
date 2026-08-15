# THE MAJOR ART PASS: campaign plan (banked 2026-08-13, read-only rendering scope lane)

Priority one per Reid 2026-08-13 ("i want it looking close to done"). Bar: Space Engineers fidelity (D-020).
Full audit and reasoning in the scoping lane's report; this file is the banked plan of record for the campaign.
Early decisions taken on the lane's recommendations under Reid's standing "go with the strong recommendation" rule; Reid may override any of them.

## Standing docs under D-020
ART-DIRECTION.md survives almost intact. Two amendments D-020 forces: (a) references become functional industrial realism, so engineered form (plate breaks, fasteners, guards, hazard striping, service access) outranks organic asymmetry on machines and structures; (b) the "honest ceiling" paragraph becomes the binding constraint: SE ships 2k sets per block, this project ships 7.9 MB of 256 to 512 px shared tiling maps for the whole game.

## Audit headlines (full table in the lane report)
- Terrain: procedural, derivative bump, no normal map; no material identity per biome beyond palette hex. Far from bar.
- Voxel dug walls: vertexColors, zero maps. Furthest from bar, and under the player's nose whenever they dig.
- panel family (all machines, plates, suit): roughness p05..p95 spread 0.032 = the plastic read on everything. THE headline defect.
- bark, coarse, ore missing albedo maps in places; ore is the closest family to the bar.
- ~~Ruin is the structure high-water mark (Ruin_LOD1 fails check_shadow_lod.py, 1134.94 mm vs 52 mm).~~ **STRUCK 2026-08-15 (RN-1718): re-measured off the shipped bytes, `Ruin_LOD1` is 50.76 mm, inside cascade 1's 56.25 mm. The ruin form pass fixed it. The ruin is still the structure high-water mark.**
- Placeholders owed: research_station.glb (borrows assembler), scanning_antenna.glb (borrows power_pole), plus their ASSET-SPECS §4 and contracts.json rows.
- Sky/atmosphere genuinely good; IBL PMREM at 64² (Renderer.ts:197) mushes all specular. Shadows PCFShadowMap (Renderer.ts:136).
- Post has GTAO, contact shadows, bloom, ACES+grade, FXAA; lacks LUT, TAA, auto-exposure, sharpening. QualityKnobs.postfx is dead.
- Pipeline: texgen.py deterministic, byte-identical gate, already authors seams/rivets/bolts/welds/grime. Missing: rust family, paint-and-chip, curvature/edge-wear mask, decals (deferred at texgen.py:671), AO baking, per-asset UVs (box projection only). Only build_ruin/render_ruin pin blender501; 79 other invocations call bare blender (hazard).
- Renderer map slots wired: albedo, normal, roughness, metalness, AO (Surfaces.ts:514-560). Missing: emissiveMap, alphaMap, KTX2, TANGENT export.
- PUBLISHED INTERFACE WARNING: MachineBatch.makeMaterial metalness 0.45 / roughness 0.55 is regex-read by tools/blender/render_machines.py:326; changing it needs an Admin-logged decision.
- Probe trap: post is off whenever a probe reads raw pixels (post/PostConfig.ts:197); screenshots taken carelessly are silently un-graded.

## The passes and edges
```
A0 look-dev target frames -> A1 light/post foundation -> A2a render map capability --+
                                      |                 A2b texgen material families +--> A3 terrain
                                      |                                              +--> A4 machines/structures
                                      +----------------------------------------------> A5 foliage/rocks
                                                                    A4 -> A6 owed models (station, antenna)
                                                                    A7 player -> FEEL workstream, out of campaign
```
- A0: five canonical shots + written target grade each: (1) forest floor at the RN-352 site; (2) machine close-up at the RN-1200 box; (3) the ruin at approach; (4) base at dusk; (5) the station. Shot manifest in rendering.md idiom.
- A1: the pass that must not be skipped. Owed D-016 consumer retune (producer merged 06b6685), PMREM off 64², shadow softening, re-take §2.1/§2b luminance tables under corrected albedo.
- A2a (small, parallel): KTX2/basis loader behind Loaders.ts's one function; emissiveMap/alphaMap slots and per-family normalScale at Surfaces.ts:554.
- A2b (campaign centre): fix panel roughness band to >= 0.15 (copy ore's construction), missing albedos, rust family, paint-and-chip variant, curvature/edge-wear mask, resolution raise once KTX2 lands, resolve RN-1203 (six roles wrongly pinned to panel).
- A3: per-biome material identity + the dug voxel face. Tangent-frame terrain refused this campaign (needs world-gen RN-45 per-chunk noise phase; float32 ULP 0.0625 m at Forge radius).
- A4: machine/structure wave by screen time: smelter, miner, belt, box, assembler, generator, inserter, power pole, then wall/floor/door/pillar/foundation, then pad. contracts.json budget raises are normal acts.
- A5: foliage/rocks; re-test RN-101 under the new bar; leaf/grass off 256 px; RN-311 Forest/Plains GROUND_DETAIL split.
- A6: research_station.glb + scanning_antenna.glb at the new bar, after A4 so they inherit the vocabulary.
- A7: player model OUT of this campaign (feel workstream); campaign owes only the suitfab/suitplate retune inside A2b.

## Verification design
- Gate: matched before/after screenshot pairs at identical camera and sun, one variable apart, judged by Reid. Numeric assertions are guardrails, not certification.
- Existing infrastructure: run.mjs --out, writeshot.mjs, the *shot.js probe family; artshot.js props:false is the isolation precedent.
- BINDING PLATFORM RULE: every frame Reid judges is taken on the Windows D3D path. SwiftShader cannot judge look; the VM is for authoring, Blender renders, numeric probes.
- Guardrails per pass: §2.1 four-site groundNear luma/RGB table, hiFrac non-zero, loFrac stable under exposure, ground iqr up and sat down, dusk groundNear.warm positive ~1 deg, skyLow.warm -29..-56. Control sites (Mountains, Polar, Regolith, MoonHighland, CraterFloor) must not move.
- Concurrency: 2-3 concurrent Cycles renders, 3-4 headless probes on the VM; Reid-judged frames on Windows.

## Number allocations (recorded in NUMBERS.md at dispatch, rule 5)
- A0+A1: RN-1405..1449 (continuation of D-016's block).
- A2a+A2b: RN-1462..1499.
- A3: RN-1255..1299.
- A4..A6: fresh blocks RN-1500+ allocated by Admin at each dispatch.

## Early decisions (taken on recommendation, Reid may override)
1. Grade: HOLD the current grade through the campaign; add a 3D LUT as the final unifying pass. No mid-wave grade changes.
2. Terrain: material identity + dug voxel face; NO tangent-frame terrain this campaign.
3. Player model: out; feel workstream.
4. Texture budget: KTX2 + 1024 raise (~15-20 MB compressed), 2048 for panel alone.
5. Tiling families + a decal layer; per-asset UV unwrap and AO baking REFUSED for now (preserves the byte-identical determinism gate); revisit only if the smelter proof shot says tiling is the binding constraint.

## THE LOOK AUDIT, 2026-08-15 (RN-1710 to RN-1726, `lane/look-audit`). THE POST-A6 QUEUE

A0 to A6 have all landed. All seven canonical shots were re-captured at current
`main` on real Windows D3D11 (1600x900, HUD-free, post asserted on) and judged
against the SE bar. **The full ranked list, with the measurement, the frame
share and the costed fix for each item, is §2.8 of
[rendering.md](../controllers/rendering.md); it is the source of truth and this
is the index into it.** Ranked by impression-per-unit-work, not by severity:

| # | What still reads unfinished | The measurement | Cost |
|---|---|---|---|
| R1 | Ground material at walking distance | terrain `iqr` 22.13 / 16.06 vs the smelter plate's 53.66 in the same light; largest element in 5 of 7 shots | LARGE, and A3 already refused tangent-frame terrain with a reason |
| R2 | The understorey is flat cards, and the near-shadow budget is spent on them | 46 subtrees at the full 4.0x multiplier; `tree_conifer` LOD1 1250.89 mm vs a 56.25 mm cascade texel | MEDIUM-LARGE; geometry, not resolution (A5 already did 1024 px) |
| R3 | Masonry tiles at 0.6 m on a 35.2 m ruin | ~59 repeats across the cella; `?tile=stone:1.8` fixes it with bit-identical `panel` controls | MEDIUM: a `masonry` family split. **The global knob is REFUSED**, see below |
| R4 | The first-person view model | in 5 of 5 ground frames, ~7.8 per cent of the frame as an upper bound | MEDIUM, and **A7 put it out of scope**, so it needs Reid's ruling first |
| R5 | The station shot is not reproducible | box luma 21.78 / 3.73 / 5.69 at an identical pin, a 5.8x spread | SMALL-MEDIUM, and it is a harness item: needs an orbital-position pin |
| R6 | The two brightest surfaces on the hero machine are untextured | peep `iqr` 0.93, sight strip 4.15, against 40.54 and 72.68 beside them | SMALL-MEDIUM: one `ember` emissive tile; the client slot already exists |
| R7 | The dusk frame reads as midday | sky `warm` -87.69 high, -20.09 low; **§2b's own target sanctions this** | SMALL, but frozen by Early Decision 1 (hold the grade) |

**This lane landed no art change, and that is the finding rather than a
shortfall.** Two items looked cheap enough to land inside the block and each was
measured false. The `stone` `tile_m` raise fixes the ruin but the family's
consumers span 0.18 m to 35.2 m, a factor of 195, and at 1.8 a 1.4 m boulder
carries 0.78 repeats — RN-953's own "spattered concrete" failure, so the family
has to be split rather than retuned. The station's `timeOfDay` constant looked
like a one-character fix until the confirming re-take came back 5.8x darker,
which exposed a real non-determinism: `setTime` moves the sun and not the
7.67 km/s station. Both changes were reverted and `web/` is byte-identical to
`HEAD`.

**Honest greens, so the next wave does not re-audit them:** `validate_glb --all`
56/56, `check_coplanar` 0 over allowance, `forestfloor` on §2.1's own number to
the digit, and **the machines' plate work is at the bar** (`sunface` iqr 53.66 /
p95 127.73 / sat 0.175) — A2b and A4 stood up under a hostile look and nothing
on the queue is about them.

**One process debt.** A0 was to deliver five canonical shots **and a written
target grade each**. The shots exist; the target grades were never written
anywhere. Write them before the next wave, or the next audit has no baseline
either.

## Dispatch order
1. A0+A1 as one opus lane (RN-1405+), Windows D3D for all judged frames. Deliverable: five before/after pairs.
2. A2a as a small parallel sonnet lane.
3. Then the PROOF SHOT: the smelter (largest machine screen area, form-passed RN-551) retextured against the fixed panel band under corrected light. Go/no-go for fanning out A4.
