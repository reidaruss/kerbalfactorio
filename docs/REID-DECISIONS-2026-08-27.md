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

**Status of the deeper measurement: THE FOLLOW-UP LANE HAS LANDED (RN-2730 to RN-2734, `lane/aerosol-measure`, 2026-08-23, corrected the same day after a fresh-context verifier's review).** The caveat at the end of this item was written when the only sweep was at `flyover`. `vista` and `limb` are now swept at the same five amplitudes, one build and one session, every frame in its own browser process, with each arm's arming read back off the photographed page and repeat-capture noise floors printed per pose. The full record is [rendering.md section 2.51](controllers/rendering.md); frames are `screenshots/RN2730_*`. Read the paragraphs under the table before picking a value, because one of them changes what the trade is.

**A note on the table above, so two records of one measurement do not disagree silently:** its figures are World Audit R6's, taken in a different session. This lane's own build reads the same measurement as 2.233 counts shipped and **+26.0 / +67.5 / +127.8** per cent at 0.75 / 0.50 / 0.25, against R6's 2.253 and +26.1 / +67.7 / +128.2. The roughly one per cent difference is inside the reproduction tolerance and neither record is wrong; the newer figures are the traceable ones and are in rendering.md 2.51.4.

**The two poses that were missing**

| Amplitude | `flyover`, far-band structure at 32 px | `vista`, far-skyline LUMINANCE step | `vista`, far-skyline CHROMA step | `vista`, far-ground structure at 32 px | `limb`, atmosphere ring | `limb`, sunlit disc red channel |
|---|---|---|---|---|---|---|
| 1.00 (shipped) | 2.233 counts (baseline) | **-29.89**, inverted polarity | **-26.53, the weakest of the five** | 0.529 counts | 91.693 | 122.97 |
| 0.75 | +26.0% | -27.46 | -53.97 | +14.2% | 91.696 | 116.62 |
| 0.50 | +67.5% | -19.09 | **-68.33, the strongest** | +70.1% | 91.730 | 109.58 |
| 0.25 | +127.8% | **-1.77, polarity crossing** | -39.09 | +143.7% | 91.710 | 101.59 |
| 0.00 (off) | +215.2% | +9.99, natural polarity | -29.44 | +239.4% | **91.693, identical to shipped** | 92.64 |
| cross-session noise floor | 0.000 counts | **0.20** counts | 0.20 counts | 0.001 counts | **0.006** | **0.015** |

**`vista`: the haze inverts the far skyline rather than erasing it, and the value that makes the skyline clearest is 0.50.** At shipped strength the far ground reads about 30 counts BRIGHTER than the sky above it, which is upside down for a horizon: the haze darkens the low sky by 52 counts and the ground under it by only 12. As the amplitude comes down that inversion unwinds and the brightness difference passes through zero near 0.25. **That crossing is a polarity change, not a disappearance**, and the distinction matters because the skyline is carried by colour, not brightness: measured on the same rectangles, the hue difference across the skyline never approaches zero, is **weakest at the shipped value** and **strongest at 0.50**, and is still half again the shipped value at 0.25. The 3x crops say the same thing by eye: `RN2730_sil_vista_a0.50_3x.png` is the clearest far skyline of the four and `RN2730_sil_vista_a1.00_3x.png` the softest. An earlier version of this paragraph read only the brightness column, called 0.25 "all but invisible" and advised ruling it out; that reading is withdrawn. **`vista` therefore does not veto anything on the ladder, and it actively favours 0.50.** Its far-ground structure recovers on the same curve as `flyover`'s, so the depth-versus-detail trade is unchanged.

**`limb`: the named regression risk is real but it is not where it was thought to be.** The atmosphere ring itself cannot respond to this decision at any amplitude. Switching the term completely off reproduces the shipped rectangle to 0.000 counts, and the reason is arithmetic: the haze layer has a 400 m scale height and the `limb` eye is 120 km up, so the term as the code parameterises it is exactly zero there. (That is a statement about the model's parameterisation, which anchors on the air density at the eye. A real grazing ray does clip the layer near the horizon; at 399 km it would be worth about one pixel, so nothing here changes.) What DOES move at `limb` is the colour of the planet: across the sweep the sunlit disc's brightness falls 8 counts while its **red channel falls 30 and its blue rises 14**. The aerosol is what makes Forge look like a warm planet from orbit, and at 0.50 it has already given up 13 counts of red. The `seam` rectangle, which tracks a known stepped-ribbon LOD artefact along the terminator, also gets about **10 per cent more visible at 0.50** because the haze that was veiling it is thinner. Neither is a blocker; both are things worth seeing before choosing, and neither was on this sheet before.

**`aerosolScaleM`: it has no switch, so it could not be swept, and it is a different decision rather than a finer one.** The constant is built into a uniform once at start-up and no URL parameter reaches it, so the lane refused to touch shipped source and derived its ladder from the shader's own integral instead. Two results. **Within any one pose it is not a distinct handle**: a single amplitude reproduces a scale-height change to within 3.2 per cent of the optical depth across the whole of `flyover`'s band. **Across poses it is selective, but only in the far GROUND**: at a standing eye it does exactly nothing to the ground band (the whole ray is already in the densest air), while at `flyover` and `limb` it is worth H/400. So `aerosolScaleM = 200` would buy the aerial poses the same 47 per cent that `?aerosol=0.5` buys them and cost `vista`'s far ground nothing. **It would not leave a standing player's view alone, and an earlier version of this paragraph wrongly said it would.** The same cut brightens `vista`'s low sky, by enough to remove roughly two thirds of the far skyline's brightness step, and it also shifts the ambient light on every surface in the frame through a third consumer of the constant on the CPU side. If what you dislike is specifically the view from the aeroplane and you are willing to accept a brighter low sky and a shifted ambient at ground level, that is the constant. It needs a one-line flag added first, in two places rather than one, before anyone can photograph it, and that is routed.

**The trade, stated plainly.** The haze buys a depth cue and it erases distant terrain structure, and those two run together on one curve at both surface poses: every per cent of structure recovered is a per cent of paling and blue-shift given up. What the new measurement adds is that at `vista` a third thing moves independently, the far skyline's own contrast, and it does not follow the other two: in brightness it inverts and crosses zero, and in colour, which is what the eye actually reads there, it is worst at the shipped value and best at 0.50.

**Frames for the eye, 1x unless marked**
- `screenshots/RN2730_vista_a1.00.png` / `_a0.75` / `_a0.50` / `_a0.25` / `_a0.00.png`, the pose that was never swept
- `screenshots/RN2730_sil_vista_a1.00_3x.png` / `_a0.50_3x` / `_a0.25_3x` / `_a0.00_3x.png`, the far skyline at 3x, which is where the polarity change and the hue contrast are visible by eye
- `screenshots/RN2730_limb_a1.00.png` / `_a0.50` / `_a0.00.png`, the orbital disc's warmth
- `screenshots/RN2730_flyover_a1.00.png` / `_a0.50.png`, this lane's own capture of the pose the first table was built on

**Recommendation: unchanged, 0.50, and the new numbers support it more strongly than before.** The measurement lane the caveat below asked for has now run and it does not overturn the recommendation, it reinforces it: 0.50 recovers 67.5 per cent of `flyover`'s far structure, 70.1 per cent of `vista`'s, and it is the value at which `vista`'s far skyline has the most colour contrast of any rung on the ladder, including shipped. **Nothing on the ladder is newly ruled out** by these measurements; 0.25 remains aggressive rather than unusable. Two consequences of any cut below 1.00 are newly on the record and are yours to weigh: Forge gets **visibly cooler from orbit** (13 counts of red at 0.50), and the terminator's LOD ribbon gets about a tenth more visible.

**The original caveat, kept for the record:** every non-1.00 amplitude in the first table (0.75, 0.50, 0.25) was swept at `flyover` only, and "unswept against vista/limb" applied to 0.50 and 0.75 exactly as much as to 0.25. That gap is now closed by the tables above.

## 7. The Space Engineers reference board (action item, not a decision)

**What it is, in one sentence: [reference/SE/BOARD.md](reference/SE/BOARD.md) is a side-by-side board pairing our existing hero frames with named, empty slots for Space Engineers reference shots that only you can capture.**

There is nothing to weigh here, it is an action: each empty slot in the board names its target file path and its exact capture spec (which SE scene, what angle, what it should match). Capture the named shots into the named slots and the fidelity gap this project has been judging against memory (FIDELITY-GAP-2026-08-19.md) gets a real anchor instead.

**Status:** built on `lane/se-board`, pending merge into `main`. The link above goes live once that lane merges; if it does not resolve yet, the merge has not landed.
