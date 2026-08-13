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
- Ruin is the structure high-water mark (Ruin_LOD1 fails check_shadow_lod.py, 1134.94 mm vs 52 mm).
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

## Dispatch order
1. A0+A1 as one opus lane (RN-1405+), Windows D3D for all judged frames. Deliverable: five before/after pairs.
2. A2a as a small parallel sonnet lane.
3. Then the PROOF SHOT: the smelter (largest machine screen area, form-passed RN-551) retextured against the fixed panel band under corrected light. Go/no-go for fanning out A4.
