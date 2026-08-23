# Reid Decisions, 2026-08-27

Seven items are waiting on your eye and your taste, nothing else: six are decisions, one
(item 7) is an action you can just go do. Each decision section has the question, the frames
to look at, the options with their measured prices, and a recommendation: read the frames,
pick an option (or override the recommendation), and say so back to Admin. Screenshot frame
paths are relative to this file, under `screenshots/`; item 7's one document link is under
`reference/`.

## 1. The coastline decision (Ocean plus Beach identity)

**Question: should Ocean become real water and should Beach grow trees near a real shore, decided together as one ruling, instead of leaving Ocean dry and Beach a fixed treeless desert ring?**

**Frames**
- [screenshots/R6_beachground.png](screenshots/R6_beachground.png) (shipped: standing on Beach, the ground bare from the feet to the horizon, but a continuous canopy treeline stands along the horizon itself, the visible evidence of the density-row vs canopy-table contradiction)
- [screenshots/R6a_beachcanopy0_beachground.png](screenshots/R6a_beachcanopy0_beachground.png) (same pose with Beach canopy forced off; the horizon treeline is gone and the world is bare sand to a razor horizon, proving the wall was the beach canopy fix and nothing nearer)
- [screenshots/WG285_hero_before.png](screenshots/WG285_hero_before.png) / [screenshots/WG285_hero_after.png](screenshots/WG285_hero_after.png) (the dry-sea hole before and after the 2026-08-22 partial canopy fix, WG-285)
- [screenshots/RN2635_crop_before_3x.png](screenshots/RN2635_crop_before_3x.png) / [screenshots/RN2635_crop_after_3x.png](screenshots/RN2635_crop_after_3x.png) (the dry sea's colour step, fixed 2026-08-22; the shape underneath is item 2 below)

**Options and prices**

| Option | What it means | Measured cost |
|---|---|---|
| A. Ocean stays dry, Beach stays desert (current) | `TREE_DENSITY_KM2[Beach] = 0` ("no trees ever") and no water system | 44.43% of the planet is Ocean class. Its colour was already fixed (`web/src/render/materials/BiomePalette.ts:211`, `0x505564` since RN-2635, replacing the old saturated "deep water" `0x14406e`), but the class identity was not: the ground is still a dry sea by class, and it still reads as a lagoon at 1x (item 2 below) |
| B. Ocean becomes water (WG-45 to WG-49) and Beach becomes a shore | Beach's canopy table (already shipped, copied from Plains) stops being contradicted by its own density row | Removes the "desert on the far side of a coast" contradiction the record names explicitly; unlocks the far tail rungs and the beach classifier redesign that are blocked on this |
| C. Mix, half A half B | Not a lane's call to make | Refuted in the record: "both are defensible and they cannot both be true" (WORLD-AUDIT-R6 section 8.1). A lane can implement either full answer in an afternoon, but the ruling belongs to Reid alone and a lane must not choose |

**Blocked on this:** the far reach-tail work in world-gen (6.16), the beach classifier redesign (`kBeachBandRel` in `core/include/of/biome.h` moves every biome on the planet, which world-gen's own record calls too large for a diagnosis lane to touch before this ruling lands), and item 2 below.

**Recommendation:** rule B (Ocean water, Beach shore). It resolves the contradiction the record itself flags, the shipped canopy table already leans that way, and it clears both blocked lanes with one ruling instead of two.

## 2. The lake-shape finding

**Question: does the dry lake bed need real relief and a broken shoreline now that "it just needs texture" has been measured false, or does the current smooth round basin ship as-is?**

**Frames**
- [screenshots/R6_pondside.png](screenshots/R6_pondside.png) (the one authored real pond, for comparison)
- [screenshots/R5_pondside.png](screenshots/R5_pondside.png) (the same authored pond one audit earlier, before this round's dry-sea chroma fix, for a baseline)
- [screenshots/RN2635_crop_before_3x.png](screenshots/RN2635_crop_before_3x.png) / [screenshots/RN2635_crop_after_3x.png](screenshots/RN2635_crop_after_3x.png)

**The finding:** an earlier lane could not close "no longer reads as water" from inside the colour palette alone. WORLD-AUDIT-R6 section 3.3 then removed the reason it gave: the dry plate is not flat and untextured, it carries 6.88 counts of structure at 16px against its neighbour's 6.72. What is left is the shape itself: a smooth closed contour with a pale rim at aerial range. It still reads as a lagoon at 1x, and shape is world-gen's to fix, not rendering's.

**Options and prices**

| Option | Cost |
|---|---|
| Ship the current smooth contour | Nothing to spend now; still reads as a lagoon at aerial range per the finding |
| Give the dry basin relief and a broken shoreline | A world-gen lane; the record states this is downstream of item 1 and should not be spent before that ruling lands |

**Recommendation:** decide item 1 first. This finding is explicitly downstream of the coastline ruling (WORLD-AUDIT-R6 section 8.2); do not spend a lane on lake shape until Ocean's water status is settled.

## 3. Polyhaven authorization

**Question: may an agent download real, reportedly-CC0 photoreal textures from Polyhaven onto your machine, for the terrain material layers the record has been carrying as owed?**

**Frames**
- [screenshots/R6_forestair.png](screenshots/R6_forestair.png) / [screenshots/R6_flyover.png](screenshots/R6_flyover.png) (terrain as of 2026-08-23, hand-authored / procedural, no scanned PBR layers)

**Separate, and NOT part of this decision:** rendering.md 2.48.13 also names an owed "snow" texture family (three PNGs, wind ripple and sastrugi in the normal, near-flat albedo, a tile around 1.5m, plus a `FAMILY_SIZE` row) for the `Mtn_SnowPatch` prop. That one routes through a `texgen.py build` on a clean tree and explicitly needs neither a Polyhaven download nor this ruling (rendering.md:17443 and :16756; WORLD-AUDIT-R6-2026-08-23.md:553).

**Options and prices**

| Option | What it gets |
|---|---|
| A. Keep refusing external downloads; stay procedural/texgen only | An agent already refused this once on authorization grounds and shipped a synthesized substrate instead (ADMIN.md), judged "a competent procedural substrate that clears phase 1 but not photoreal" |
| B. Authorize a one-time Polyhaven pull on your machine | Covers the **4 to 6 terrain layers** FIDELITY-GAP named (grass, dirt, rock, cliff, scree, snow), routed through texgen afterward for byte-determinism. Polyhaven is reported CC0, no attribution required, redistributable; no license URL is checked into this repo, so treat that status as unverified in-repo rather than confirmed |

**Recommendation:** authorize option B, run narrowly for the named terrain layers. The reported licensing looks low-risk but is unverified in-repo; authorization was the real blocker, and one agent already did the right thing by stopping and asking rather than assuming.

## 4. The crownflank trade

**Question: should the `crownflank=12` plus `crownshadefloor=0.30` fix ship, even though it makes the wood read brighter than its own clearing?**

**Frames**
- [screenshots/RN2540_forestair_shipped.png](screenshots/RN2540_forestair_shipped.png) / [screenshots/RN2540_forestair_crownshadefloor030.png](screenshots/RN2540_forestair_crownshadefloor030.png) (closest available pair; no frame in the repo isolates `crownflank=12` alone)

**Options and prices**

| Option | Measured effect |
|---|---|
| Ship the combo | Both binding guard poses land inside the ratio band, but at `forestairnoon` it drives the wood to `boxShip 1.0287` / `boxSurf 1.0327`, both above 1.0, meaning the wood reads lighter than its own clearing. This breaks the standing finding in WORLD-AUDIT-R2 section 3.10 that wood must read darker than its clearing at every pose |
| Keep it refused (current) | Admin refused this route as the next lane, 2026-08-22, keeping it only as evidence the band is reachable in principle. The alternative Admin ranked first instead, a backface/degeneracy fix, has since SHIPPED (rendering.md 2.41, RN-2605 to RN-2607, 2026-08-22, `lane/n13-backface`): `forestairnoon` `rho` moved 0.1019 to 0.1906, into the band, without inverting the wood/clearing relationship. Its own premise that it "does not spend the box ratchet" did not hold: 2.41 is on record as the project's first logged raise of a `box` ceiling |

**Recommendation:** no action needed here now. The shipped alternative (2.41) already reached the band without the wood/clearing inversion, at the disclosed price of a box-ceiling raise. Revisit only if you look at the frames and decide the darker-than-clearing rule itself should stop binding.

## 5. The crown taste calls

**Question: does the tree canopy still look wrong now that its sky reflection (specular) share has fallen to 40 to 61 percent, and is the bigger diffuse-occlusion refactor worth a lane?**

**Frames**
- [screenshots/RN2645_crowns_flyovernoon_shipped_3x.png](screenshots/RN2645_crowns_flyovernoon_shipped_3x.png) (shipped build, current crown specular level)
- [screenshots/RN2645_crowns_flyovernoon_env0_3x.png](screenshots/RN2645_crowns_flyovernoon_env0_3x.png) (crown's own environment map installed, driven to zero intensity: no reflection)
- [screenshots/RN2645_crowns_flyovernoon_env1_3x.png](screenshots/RN2645_crowns_flyovernoon_env1_3x.png) (same own environment map at full intensity: reflection restored)
- [screenshots/RN2645_crowns_flyovernoon_envoff_3x.png](screenshots/RN2645_crowns_flyovernoon_envoff_3x.png) (own environment map not installed at all; measured identical to env0)
- [screenshots/RN2590_crowns_shipped_3x.png](screenshots/RN2590_crowns_shipped_3x.png) (the crown-normal baseline from the lane that first raised the diffuse share, RN-2590 to RN-2593)

**Context, not a decision to make yourself:** `forestairnoon`'s guard ratio (`rho`) sits at 0.1873, inside the accepted band (0.18 to 0.75) but 0.0627 below the tighter target core (0.25 to 0.55), with only 0.0073 of margin above the hard floor.

**Options and prices**

| Option | What it means |
|---|---|
| A. Ship as-is, crown thread stays paused | Specular is down to under half at three of four poses (was the original R2 complaint); the remaining defect is that the environment's diffuse light is measured occluded twice, 10 to 28 percent of the crown's unshaded diffuse |
| B. Take the diffuse-occlusion refactor | Splices occlusion onto the direct light term instead of riding the albedo; bigger than any of the last five lanes, but the one option identified that could still close the double-occlusion and use the already-derived shade floor |

**Recommendation:** this is the one the record says only your eye can settle: "whether 40 to 61 percent specular is still wrong, and whether the refactor is worth a lane, are questions the instruments in this file cannot answer and a person looking at the frame can." Look at the frames above and call it either way.

## 6. Aerosol amplitude

**Question: should the distance haze (aerosol) stay at full strength, which erases most of the far terrain's visible structure past 4.5km, or ship weaker?**

**Frames**
- [screenshots/R6_flyover.png](screenshots/R6_flyover.png) (shipped, full strength)
- [screenshots/R6a_aerosol0_flyover.png](screenshots/R6a_aerosol0_flyover.png) (haze off, terrain detail visible to 15km)
- [screenshots/R6a_aero75_flyover.png](screenshots/R6a_aero75_flyover.png) / [screenshots/R6a_aero50_flyover.png](screenshots/R6a_aero50_flyover.png) / [screenshots/R6a_aero25_flyover.png](screenshots/R6a_aero25_flyover.png) (the amplitude ladder)

**Options and prices**

| Amplitude | Measured effect at 32px, 4.5 to 15.2km band |
|---|---|
| 1.00 (shipped) | Baseline; retains 2.253 counts of structure against 7.082 with haze off, a 214% swing. Matches the authored physical constant most closely |
| 0.75 | +26.1% of structure recovered |
| 0.50 | +67.7% recovered; the record's own eye-check calls this safe: green sweeps and ridge shading run out to 8 to 10km, depth cues (paling, blue shift toward the horizon) still survive, nothing looks broken |
| 0.25 | +128.2% recovered |
| 0.00 (off) | Not viable; removes the atmosphere entirely |

The term itself is not broken: the retained fraction implies an optical depth that brackets the authored `aerosolSigma` constant within about 3 to 13 percent depending on how the effective range is weighted, and the 20km skyline silhouette reads the same either way (22.86 vs 20.47 count step).

**Status of the deeper measurement, and the caveat applies to the whole table:** every non-1.00 amplitude above (0.75, 0.50, 0.25) was swept at `flyover` only. `vista`'s mountain silhouette and `limb`'s vertical column were never swept at any amplitude, so "unswept against vista/limb" is not a 0.25-only caveat, it applies to 0.50 and 0.75 exactly as much. A small follow-up lane was planned to check those two poses plus the more surgical `aerosolScaleM` handle (which barely touches ground-level rays) before any value below 1.00 is finalized. That lane's numbers were not found in any record as of this writing; if it has landed since 2026-08-23, put its results in this slot before committing to a value.

**Recommendation:** set the amplitude to 0.50, provisionally. It is the value the record's own eye-check already looked at and called safe at `flyover`, but `vista` and `limb` have not been checked at any amplitude; treat this as pending the measurement lane above rather than final.

## 7. The Space Engineers reference board (action item, not a decision)

**What it is, in one sentence: [reference/SE/BOARD.md](reference/SE/BOARD.md) is a side-by-side board pairing our existing hero frames with named, empty slots for Space Engineers reference shots that only you can capture.**

There is nothing to weigh here, it is an action: each empty slot in the board names its target file path and its exact capture spec (which SE scene, what angle, what it should match). Capture the named shots into the named slots and the fidelity gap this project has been judging against memory (FIDELITY-GAP-2026-08-19.md) gets a real anchor instead.

**Status:** built on `lane/se-board`, pending merge into `main`. The link above goes live once that lane merges; if it does not resolve yet, the merge has not landed.
