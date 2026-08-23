# Reid Decisions, 2026-08-27

Six items are waiting on your eye and your taste, nothing else. Each section below has the
question, the frames to look at, the options with their measured prices, and a recommendation:
read the frames, pick an option (or override the recommendation), and say so back to Admin.
Frame paths are relative to this file, under `screenshots/`.

## 1. The coastline decision (Ocean plus Beach identity)

**Question: should Ocean become real water and should Beach grow trees near a real shore, decided together as one ruling, instead of leaving Ocean dry and Beach a fixed treeless desert ring?**

**Frames**
- [screenshots/R6_beachground.png](screenshots/R6_beachground.png) (shipped: standing on Beach, treeless to the horizon)
- [screenshots/R6a_beachcanopy0_beachground.png](screenshots/R6a_beachcanopy0_beachground.png) (Beach canopy forced off; the two answers side by side and section 3.2 of WORLD-AUDIT-R6 measured them identical on the ground the player stands on)
- [screenshots/WG285_hero_before.png](screenshots/WG285_hero_before.png) / [screenshots/WG285_hero_after.png](screenshots/WG285_hero_after.png) (the dry-sea hole before and after this week's partial canopy fix)
- [screenshots/RN2635_crop_before_3x.png](screenshots/RN2635_crop_before_3x.png) / [screenshots/RN2635_crop_after_3x.png](screenshots/RN2635_crop_after_3x.png) (the dry sea's colour step, fixed; the shape underneath is item 2 below)

**Options and prices**

| Option | What it means | Measured cost |
|---|---|---|
| A. Ocean stays dry, Beach stays desert (current) | `TREE_DENSITY_KM2[Beach] = 0` ("no trees ever") and no water system | 44.43% of the planet is Ocean class, painted as dry ground the colour of deep water (world-gen.md 6.15.1); reads as a lilac dry lake sitting in the middle of the hero frame |
| B. Ocean becomes water (WG-45 to WG-49) and Beach becomes a shore | Beach's canopy table (already shipped, copied from Plains) stops being contradicted by its own density row | Removes the "desert on the far side of new water" contradiction the record names explicitly; unlocks the far tail rungs and the beach classifier redesign that are blocked on this |
| C. Mix, half A half B | Pick one axis without the other | Refuted in the record: "both are defensible and they cannot both be true" (WORLD-AUDIT-R6 section 8.1). A lane can build either full answer in an afternoon and must not choose a mix |

**Blocked on this:** the far reach-tail work in world-gen (6.16), the beach classifier redesign (`kBeachBandRel` in `core/include/of/biome.h` moves every biome on the planet, so it needs a ruling before anyone touches it), and item 2 below.

**Recommendation:** rule B (Ocean water, Beach shore). It resolves the contradiction the record itself flags, the shipped canopy table already leans that way, and it clears both blocked lanes with one ruling instead of two.

## 2. The lake-shape finding

**Question: does the dry lake bed need real relief and a broken shoreline now that "it just needs texture" has been measured false, or does the current smooth round basin ship as-is?**

**Frames**
- [screenshots/R6_pondside.png](screenshots/R6_pondside.png) (the one authored real pond, for comparison)
- [screenshots/R5_pondside.png](screenshots/R5_pondside.png)
- [screenshots/RN2635_crop_before_3x.png](screenshots/RN2635_crop_before_3x.png) / [screenshots/RN2635_crop_after_3x.png](screenshots/RN2635_crop_after_3x.png)

**The finding:** an earlier lane could not close "no longer reads as water" from inside the colour palette alone. WORLD-AUDIT-R6 section 3.3 then removed the reason it gave: the dry plate is not flat and untextured, it carries 6.88 counts of structure at 16px against its neighbour's 6.72. What is left is the shape itself: a smooth closed contour with a pale rim at aerial range, and shape is world-gen's to fix, not rendering's.

**Options and prices**

| Option | Cost |
|---|---|
| Ship the current smooth contour | Nothing to spend now; still reads as too round and too clean at aerial range per the finding |
| Give the dry basin relief and a broken shoreline | A world-gen lane; the record states this is downstream of item 1 and should not be spent before that ruling lands |

**Recommendation:** decide item 1 first. This finding is explicitly downstream of the coastline ruling (WORLD-AUDIT-R6 section 8.2); do not spend a lane on lake shape until Ocean's water status is settled.

## 3. Polyhaven authorization

**Question: may an agent download real CC0 photoreal textures from Polyhaven onto your machine, for the snow family and the terrain material layers the record has been carrying as owed?**

**Frames**
- [screenshots/RN2700_mtnslope_crop_base.png](screenshots/RN2700_mtnslope_crop_base.png) / [screenshots/RN2700_mtnslope_crop_geom.png](screenshots/RN2700_mtnslope_crop_geom.png) / [screenshots/RN2700_mtnslope_crop_head.png](screenshots/RN2700_mtnslope_crop_head.png) (this week's snow-patch geometry and material fix; the texture family it still lacks is what this decision is about)
- [screenshots/R6_forestair.png](screenshots/R6_forestair.png) / [screenshots/R6_flyover.png](screenshots/R6_flyover.png) (today's terrain, hand-authored / procedural, no scanned PBR layers)

**Options and prices**

| Option | What it gets |
|---|---|
| A. Keep refusing external downloads; stay procedural/texgen only | An agent already refused this once on authorization grounds and shipped a synthesized substrate instead (ADMIN.md), judged "a competent procedural substrate that clears phase 1 but not photoreal" |
| B. Authorize a one-time Polyhaven pull on your machine | Covers the owed **snow family** (three PNGs, wind ripple and sastrugi in the normal, near-flat albedo, ~1.5m tile, rendering.md 2.48.13) and the **4 to 6 terrain layers** FIDELITY-GAP named (grass, dirt, rock, cliff, scree, snow), routed through texgen afterward for byte-determinism. Polyhaven is CC0, no attribution required, redistributable |

**Recommendation:** authorize option B, run narrowly for the named families above. Licensing is not the blocker (CC0), authorization was, and one agent already did the right thing by stopping and asking.

## 4. The crownflank trade

**Question: should the `crownflank=12` plus `crownshadefloor=0.30` fix ship, even though it makes the forest floor read brighter than its own clearing?**

**Frames**
- [screenshots/RN2540_forestair_shipped.png](screenshots/RN2540_forestair_shipped.png) / [screenshots/RN2540_forestair_crownshadefloor030.png](screenshots/RN2540_forestair_crownshadefloor030.png) (closest available pair; no frame in the repo isolates `crownflank=12` alone)

**Options and prices**

| Option | Measured effect |
|---|---|
| Ship the combo | Both binding guard poses land inside the ratio band, but at `forestairnoon` it drives the wood to `boxShip 1.0287` / `boxSurf 1.0327`, both above 1.0, meaning the wood reads lighter than its own clearing. This breaks the standing finding in WORLD-AUDIT-R2 section 3.10 that wood must read darker than its clearing at every pose |
| Keep it refused (current) | Admin already refused this route as the next lane, 2026-08-22, keeping it only as evidence the band is reachable in principle. The standing alternative plan (a backface/degeneracy fix, already ranked first) reaches the band without inverting the wood/clearing relationship |

**Recommendation:** keep the refusal. The ranked alternative already gets to the band without the inversion, so there is no reason to spend this trade unless you look at the frames and decide the darker-than-clearing rule itself no longer matters.

## 5. The crown taste calls

**Question: does the tree canopy still look wrong now that its sky reflection (specular) share has fallen to 40 to 61 percent, and is the bigger diffuse-occlusion refactor worth a lane?**

**Frames**
- [screenshots/RN2645_crowns_flyovernoon_shipped_3x.png](screenshots/RN2645_crowns_flyovernoon_shipped_3x.png)
- [screenshots/RN2645_crowns_flyovernoon_env0_3x.png](screenshots/RN2645_crowns_flyovernoon_env0_3x.png) / [screenshots/RN2645_crowns_flyovernoon_env1_3x.png](screenshots/RN2645_crowns_flyovernoon_env1_3x.png) / [screenshots/RN2645_crowns_flyovernoon_envoff_3x.png](screenshots/RN2645_crowns_flyovernoon_envoff_3x.png)
- [screenshots/RN2590_crowns_shipped_3x.png](screenshots/RN2590_crowns_shipped_3x.png)

**Context, not a decision to make yourself:** `forestairnoon`'s guard ratio (`rho`) sits at 0.1873, inside the accepted band (0.18 to 0.75) but 0.0627 below the tighter target core (0.25 to 0.55), with only 0.0073 of margin above the hard floor.

**Options and prices**

| Option | What it means |
|---|---|
| A. Ship as-is, crown thread stays paused | Specular is down to under half at three of four poses (was the original R2 complaint); the remaining defect is that the environment's diffuse light is measured occluded twice, 10 to 28 percent of the crown's unshaded diffuse |
| B. Take the diffuse-occlusion refactor | Splices occlusion onto the direct light term instead of riding the albedo; bigger than any of the last five crown lanes, but the one option identified that could still close the double-occlusion and use the already-derived shade floor |

**Recommendation:** this is the one the record says only your eye can settle: "whether 40 to 61 percent specular is still wrong, and whether the refactor is worth a lane, are questions the instruments cannot answer and a person looking at the frame can." Look at the frames above and call it either way.

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
| 0.50 | +67.7% recovered; the record's own eye-check calls this safe: ground sweeps and ridge shading run out to 8 to 10km, depth cues (paling, blue shift toward the horizon) still survive, nothing looks broken |
| 0.25 | +128.2% recovered, but unswept against the mountain silhouette (`vista`) or the vertical column (`limb`) |
| 0.00 (off) | Not viable; removes the atmosphere entirely |

The term itself is not broken: the retained fraction implies an optical depth that brackets the authored `aerosolSigma` constant within about 3 to 13 percent depending on how the effective range is weighted, and the 20km skyline silhouette reads the same either way (22.86 vs 20.47 count step).

**Status of the deeper measurement:** a small follow-up lane was planned to sweep `vista`'s silhouette, `limb`'s column, and the more surgical `aerosolScaleM` handle (which barely touches ground-level rays) before finalizing a value below 0.50. That lane's numbers were not found in any record as of this writing; if it has landed since 2026-08-23, put its results in this slot before deciding below 0.50.

**Recommendation:** set the amplitude to 0.50. It is the value the record's own eye-check already looked at and called safe; treat anything lower as pending the `vista`/`limb`/`aerosolScaleM` measurement lane above.
