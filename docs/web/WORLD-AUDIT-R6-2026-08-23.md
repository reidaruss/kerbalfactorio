# THE WORLD LOOK AUDIT, ROUND 6, 2026-08-23

> **Lane** `audit/r6`. **Numbers** RN-2685 and RN-2686 of the RN-2685 to RN-2699 block.
> **Base** `origin/main` at `7e5862cf`. **Owner** rendering-controller. Read-only plus two additive instruments.
>
> The sixth audit, on a baseline that eleven lanes have rebuilt since R5 measured it
> a day ago: the crown arc complete pending Reid (normal rebuilt, backface fold,
> derived environment light, `rho0` spread 8.41x down to about 2.5x, `forestairnoon`
> in band for the first time), the far paint's debt paid out of coverage with a
> stand-scale mottle live, the placed forest reaching 5.1 km behind an area-aware
> cap, beach canopy and a new dry-sea albedo, and the ratio-band guard rebuilt,
> re-pinned four ways and green.
>
> **This round's first job was not to rank.** R5 scored its structure findings on
> the inter-quartile range of a five-row strip, and RN-2664 then proved in the
> catalogue that `iqr` is dominated by whatever varies fastest in a rectangle and
> "falls while the structure improves". Every one of R5's five ranks is therefore
> re-scored here on `rn2664scale.mjs`, the box-filter scale ladder, before a word of
> new ranking is written. Section 3 is that re-score and it changes four of the five
> verdicts. Section 4 is the new ranked five.

---

## 0. THE ONE-PARAGRAPH ANSWER

**The near world is now good and the far world is a photograph of the atmosphere.**
At `flyover` the ground from 1.7 km to 4.5 km carries 6.3 to 18.9 counts of coarse
lateral structure and from 4.5 km to 15.2 km it carries **2.1 to 2.3**, and the
missing structure is not missing: turning the aerosol off on the same rectangle
returns **7.07 against the shipped 2.24 at a 32 px filter**, so the atmosphere is
removing **68 per cent** of what the geometry already draws over two thirds of the
visible depth. That single measurement re-attributes R5's rank 1, which was written
as a paint defect, and it is this round's rank 1 with a measured trade curve behind
it (a quarter off the amplitude buys 26 per cent of the structure back, a half buys
68 per cent, and the frame still reads as having depth at both). R5's rank 2, the
beach's treeless disc, **survives untouched on the new instrument** (0.1 per cent at
every scale, inside this instrument's own noise floor) and stays Reid-blocked. R5's
rank 3 splits: the chroma half is closed (N14 halved the step and put Ocean inside
the frame's own hue family) and the ladder **refutes** the "flat untextured value
dip" that N14's eye blamed for the survivor, because the plate carries 6.88 counts
at 16 px against its neighbour's 6.72, so what still reads as a lagoon is the
boundary's SHAPE and the shape is world-gen's. R5's rank 4 was two findings fused:
its tone cliff has **shrunk from a published 30.19 counts to 20.65** over the same
rows and sits at 690 m, while its six-fold density step sits at 550 m, is **exactly
6.0 and completely unrepaired**, and has changed character since WG-260's mid tier
removed the visible cliff, so it is now a gameplay defect (the wood a player can
harvest is six times thinner than the wood they walked toward) rather than a wall.
R5's rank 5 reproduces **to two decimals**, which means no lane touched it, and the
ladder says the ranked statistic was the wrong one anyway: the carpet is not flat,
it is a veil that adds coarse structure and removes fine, and past **85 metres it is
simply absent**, which the lift ratio scores 1.01 and calls healthy. Beside those,
three things the eye finds on this rebuilt baseline that no audit has ranked: the
mountain snow patch is a faceted hexagonal slab with a `flat` surface role, it is
the highest-contrast object in three of the hero poses, and it needs no blocked
asset decision; the smelter at night is finally beautiful and **lights nothing**,
which five audits inferred from daylit frames and this one photographs; and the
plains hero pose is **structurally unable to measure its own mid field**, which puts
84 metres to the horizon into twelve frame rows and is why "the world ends at the
carpet" has been an eye complaint for four rounds with no number under it.

---

## 1. METHOD, AND WHAT IT IS AND IS NOT EVIDENCE FOR

**Capture.** Thirteen hero poses plus ten control arms, every one through
`probes/artframe.js` and `of.screenshot()`, so every frame is HUD-free by
construction and every frame's own numbers come back with it. All twenty-three
captures are from **one build of one commit** on **one server**, so every pair in
this document is one flag apart and not two builds' worth of drift.

**Server ownership proved on CONTENT.** `vite preview --strictPort --port 5686`
started after `npm run build` (never before: `vite preview` snapshots `dist` at
startup). A random sentinel was written into `dist` and fetched back over the wire
and compared **byte for byte**, not by status code, because `vite preview` answers
200 for every missing path. The server was stopped by resolving the command line to
**exactly one PID whose port is this lane's alone** and killing that PID, never by
filtering a process list on a shared pattern.

**Build is HEAD's.** `npx tsc --noEmit` exit 0 and `npm run build` exit 0 on
`7e5862cf` before the first capture, with `node_modules` installed by `npm ci` in
this worktree.

**The ranking instrument, and why it replaced the last one.**
`tools/smoke/rn2664scale.mjs` box-filters a rectangle at a ladder of scales and
reports the standard deviation of the filtered luma with **the per-row mean removed**,
so a vertical aerial gradient cannot masquerade as lateral structure. `sd(s)` is the
amount of structure at or coarser than `s`. R5 ranked on `iqr` over a five-row strip,
which has no notion of scale and is dominated by the fastest-varying thing present;
RN-2664's catalogue entry is the existence proof that it "falls while the structure
improves". Where this document quotes an `iqr`, it is quoting a shot's own committed
frame-table number for continuity, never as a structure score.

**This instrument's own noise floor, measured rather than assumed.** R5 proved that
`?beachcanopy=0` cannot reach `beachground`'s near field, so that arm pair is a
**de facto null pair** on that rectangle. Over 800 x 200 pixels the two captures
differ by **0.047 counts of sd at 1 px, 0.033 at 16 px and 0.026 at 64 px**. Every
delta in this document larger than about 0.1 counts is therefore outside the floor,
and every delta near it is called noise out loud. This is a weaker claim than a true
repeat pair (the two captures do differ by one query parameter) and it is stated that
way rather than promoted.

**Range claims.** Every row-to-range figure uses R5's correction pass's own
curvature-correct inversion, `depression = s/(2R) + h/s` against
`depression = -pitch - atan(v tan(fovHalf))`, solved at the near root. The pose
fields are **transcribed from `artframe.js`'s manifest with the line cited**, because
the first draft of `rn2686bands.mjs` carried two remembered pitches
(`forestaircanopy` -6, `meadowfield` -8) that the manifest contradicts (-2.5 and -12).
A wrong range column is the single thing four audits have most often been wrong
about. The inversion assumes a smooth datum and relief moves it: at `flyover` it puts
the horizon at row 307 and the **visible skyline is at row 317**, measured on the
aerosol-off arm where the edge is crispest. Every rectangle in this document starts
at row 330 or lower and is therefore on the ground side of that skyline by at least
thirteen rows.

**Props are ON** at every walking pose quoted here. `meadow`, `meadowfield`,
`beachground`, `vista`, `vistadawn`, `mtnslope`, `pondside`, `meadownight` and
`smelternight` declare no `props` field and take the branch default; `midfield`,
which declares `props: false`, is not quoted anywhere in this document.

**Frames illustrate, numbers are evidence.** Where this document says "by eye", it
means a 1x frame or a nearest-neighbour crop was looked at and a judgement was made
against a remembered Space Engineers landscape, which section 8.2 says out loud is
still the unfixed weakness of the whole method.

**Two instruments added, both additive, neither changing a rendered pixel.**
`tools/smoke/rn2685shots.mjs` captures a named set of shots at one arm, parsing the
scenario dispatch out of `artframe.js`'s own manifest and **refusing** any shot whose
dispatch it cannot find, and keeping the probe's JSON beside the PNG.
`tools/smoke/rn2686bands.mjs` sweeps `rn2664scale.mjs` down a column of equal-height
bands and prints one table; it **shells out** to that script rather than
re-implementing the statistic, so the two cannot drift apart.

---

## 2. THE FRAMES

Thirteen poses, shipped arm, `1600x900`, quality `high`, all `valid: true`.

| shot | box luma | box iqr | R5's box | tris | calls |
|---|---|---|---|---|---|
| `meadow` | 84.39 | 54.98 | not in R5's table | 1,879,395 | 79 |
| `meadowfield` | 102.15 | 56.42 | **102.15 / 56.42** | 1,761,585 | 78 |
| `forestair` | 96.25 | 32.70 | 98.60 / 31.77 | 305,485 | 27 |
| `flyover` | 113.39 | 62.41 | 114.80 / 65.04 | 258,869 | 26 |
| `forestaircanopy` | 77.82 | 33.06 | 79.89 / **61.06** | 774,908 | 65 |
| `vista` | 174.53 | 14.48 | (bit-identical in R5) | 632,350 | 50 |
| `vistadawn` | 167.57 | 73.25 | | 738,827 | 50 |
| `mtnslope` | 127.06 | **88.55** | **88.55** | 637,108 | 49 |
| `meadownight` | 8.91 | 5.93 | | 820,552 | 54 |
| `smelternight` | 82.82 | 147.97 | | 689,744 | 60 |
| `pondside` | 108.30 | 45.80 | | 955,933 | 81 |
| `beachground` | 151.17 | 62.83 | **151.17 / 62.83** | 658,125 | 66 |
| `limb` | 68.30 | 134.87 | | 52,913 | 21 |

**Three poses reproduce R5 to the digit** (`meadowfield`, `beachground` and
`mtnslope`'s iqr), which is the cheapest available statement that eleven merged lanes
touched none of them. It is a claim about printed numbers, not about PNG bytes; no
byte comparison was run.

**The loudest movement in the table is `forestaircanopy`'s box iqr, 61.06 to 33.06.**
That rectangle straddles the tier join, and section 3.4 shows the join's own tone
cliff shrinking over exactly the same rows, so the fall is consistent with the crown
arc landing rather than with the frame flattening. It is quoted here for continuity
and it is not used as evidence anywhere, for the reason section 1 gives.

---

## 3. THE RE-SCORE: R5's FIVE ON THE SCALE LADDER

The mandated first pass. For each of R5's five, what the box-filter ladder says on
current main, and whether the rank survives, shrinks, splits or dissolves.

### 3.1 R5 RANK 1, the inert far paint: **SHRINKS BY A THIRD AND IS RE-ATTRIBUTED**

R5 ranked it on "the shipped arm's own row-to-row `iqr` never exceeds 3.9 counts
anywhere across rows 329 to 509", which is the statistic RN-2664 disqualified.

Ladder down the whole visible ground at `flyover`, rect `x560 w900`, bands of 70 rows:

| rows | range | s=1 | s=4 | s=16 | s=32 |
|---|---|---|---|---|---|
| 330 to 400 | 15.2 km to 6.9 km | 2.831 | 2.699 | 2.376 | **2.094** |
| 400 to 470 | 6.9 km to 4.5 km | 3.813 | 3.590 | 2.797 | **2.328** |
| 470 to 540 | 4.5 km to 3.4 km | 14.200 | 12.597 | 8.629 | **6.563** |
| 540 to 610 | 3.4 km to 2.7 km | 12.621 | 11.287 | 8.508 | 6.328 |
| 610 to 680 | 2.7 km to 2.3 km | 13.942 | 12.592 | 10.091 | 8.368 |
| 680 to 750 | 2.3 km to 2.0 km | 18.708 | 16.997 | 13.169 | 10.851 |
| 750 to 820 | 2.0 km to 1.7 km | 24.001 | 22.772 | 20.549 | 18.910 |

**The band R5 called inert is no longer one band.** From 3.4 km to 4.5 km the ladder
reads 6.56 at 32 px, in the same family as the near forest; from 4.5 km outward it
falls by a factor of nearly three and stays flat all the way to 15.2 km. The reach
tail (WG-295, 3,500 m to 5,099.5 m) and the stand mottle (RN-2665) closed the inner
third of R5's own span, which is exactly what they were briefed to do, and the ladder
can see it where the strip `iqr` could not.

**And the cause of what remains is re-attributed, which R5 could not have done
because it never took an aerosol arm.** Three arms on rect `x560 y330 900x140`
(15.2 km to 4.5 km), one build:

| scale px | shipped | `?treeline=0` | `?aerosol=0` |
|---|---|---|---|
| 1 | 3.358 | 2.911 (**-13.3%**) | 8.750 (**+160.6%**) |
| 16 | 2.650 | 2.410 (-9.1%) | 7.581 (+186.0%) |
| 32 | 2.253 | 2.139 (**-5.0%**) | 7.082 (**+214.4%**) |
| 64 | 1.791 | 1.708 (-4.6%) | 6.751 (+276.9%) |

**Correction pass note:** the 32 px `?aerosol=0` cell above originally printed
7.073 (+215.7 per cent), which is section 4.1's sweep-table cell for rect
`x560 y340 900x130`, not this table's own rect `x560 y330 900x140`. This
table's own reading is **7.082 (+214.4 per cent)**; the arithmetic tell is that
`7.073 / 2.253 - 1 = 213.9`, not 215.7, so the printed figure could not have
come from this table's own shipped baseline of 2.253. Section 4.1's sweep
table is unaffected: its own baseline there is 2.240, not 2.253, and
`7.073 / 2.240 - 1 = 215.7` reproduces correctly on that table's own numbers.

The paint is worth **5 per cent** of a small number at the coarse end. The atmosphere
is worth **68 per cent** of a number three times larger. **Rank 1 survives on the
outer two thirds of the depth and it is not a vegetation finding.** It becomes this
round's rank 1 in section 4.1, where the trade is measured rather than deleted.

### 3.2 R5 RANK 2, the beach's treeless disc: **SURVIVES INTACT**

Ladder at `beachground`, near field `x400 y600 800x200`, shipped against
`?beachcanopy=0`:

| scale px | shipped | `?beachcanopy=0` | delta |
|---|---|---|---|
| 1 | 42.285 | 42.332 | +0.047 (0.1%) |
| 16 | 29.787 | 29.820 | +0.033 (0.1%) |
| 32 | 23.060 | 23.049 | -0.011 (0.0%) |
| 64 | 15.864 | 15.837 | -0.026 (-0.2%) |

Every delta is at this instrument's own floor. The finding R5 stated as
"bit-identical" is confirmed on a statistic that can see a coarse field, at every
scale from one pixel to sixty-four: **the biome's own canopy table changes nothing
the player walks in.** By eye at 1x the disc is unmistakable, a bare sand-and-scrub
plain running to a hard hedge of trees standing exactly on the horizon.
`TREE_DENSITY_KM2[Beach] = 0` at `TreeTuning.ts:115` and `CANOPY_BEACH` at
`Registry.ts:425` are still the two tables, and they still say opposite things.
**Unchanged, unranked here, and still Reid's** (section 8.1).

### 3.3 R5 RANK 3, the dry sea: **THE CHROMA HALF IS CLOSED AND THE LADDER REFUTES THE SURVIVOR'S STATED CAUSE**

N14 shipped `BiomePalette.ts` `HEX[0]` `0x14406e` to `0x505564` and halved the true
warm step (25.46 to 12.60 counts, with shipped Ocean's warm landing within 0.78 counts
of the frame's own untouched Forest ground). N14 then reported honestly that the plate
**still reads as water at 1x**, and blamed "the plate's SHAPE and flat, untextured
VALUE DIP".

On this build, at `forestair` rows 365 to 405, 320 px wide, plate against the
same-row ground beside it:

| scale px | the plate `x1100` | its neighbour `x600` |
|---|---|---|
| 1 | 10.492 | 13.656 |
| 4 | 9.954 | 13.098 |
| 16 | **6.880** | **6.718** |

**The plate is not a flat hole.** At the coarse end it carries marginally MORE
structure than the ground beside it, and at the fine end it carries three quarters as
much. The "flat untextured value dip" half of N14's own eye conclusion does not
survive the ladder, and that matters for routing: what is left carrying the lagoon
read is the boundary's **shape**, a smooth closed contour with a pale rim, which is
world-gen's field and not a rendering palette lane's. **The rank dissolves as a
rendering item and consolidates into the lake-shape finding already on Reid's list**
(section 8.1). It still reads as a lagoon at 1x, and this audit takes no palette
position on it.

### 3.4 R5 RANK 4, the tier seam: **IT WAS TWO FINDINGS, AND THEY SPLIT**

**The tone half shrinks.** Centre-column ladder at `forestaircanopy`, `x[795,805)`,
R5's own window and R5's own rows:

| source | base | rows 457 to 462 | delta |
|---|---|---|---|
| R5 | `e670c637` | 65.85 to 35.66 | **-30.19** |
| WG-295 | `58eb1e74` | 67.90 to 50.57 | **-17.33** |
| **R6, this build** | `7e5862cf` | **71.22 to 50.57** | **-20.65** |

Row 462 reproduces WG-295's value **to the digit**; row 457 does not reproduce R5's.
Neither of the two earlier sections reconciled its number against the other, and
this is the reconciliation: **R5's 30.19 does not reproduce on any later base**, and
the cliff on current main is a third smaller than R5 published and three counts
larger than WG-295 measured a base earlier. Ladder over the whole join band
(`x320 y425 960x140`): shipped 9.152 at 32 px, `?treeline=0` 8.220 (the paint carries
**10.2 per cent**), `?canopy=0` 5.512 (the instances carry **39.8 per cent**). R5's
own paint-share figure of 15 per cent, taken on `iqr`, reproduces on the ladder at
the coarse end (14.9 per cent at 64 px), which is a rare case of the old statistic
having been right by accident.

**The density half does not shrink, and it changes character.** Verified line by
line on this commit: `TREE_DENSITY_KM2[Plains] = 420` at `TreeTuning.ts:116` against
`CANOPY_PLAINS` `100 + 30 + 290 = 420` at `Registry.ts:354-356` times
`DENSITY_SCALE = 6` at `Registry.ts:147`, so the ratio is **exactly 6.0** and
**nothing has touched it**. WG-295, WG-301 and WG-304 are all gated on
`groundOk = cell <= MAX_CELL_M` (`Scatter.ts:530`), which is false only on chunks
the ground tiers already refuse, kilometres out; none of them can reach a 550 m seam.
What HAS changed is that WG-260's mid tier ramps the canopy population in from 170 m
across a quadratic, so **the visible cliff is gone and the six-fold gap is intact**,
spread over 380 m.

That is a different defect from the one R5 ranked, and it is a worse one for the
project: the two tiers are no longer a wall, they are a **standing disagreement
between the wood a player can harvest and the wood a player can see**, and gathering
wood is step one of the progression spine. It becomes this round's rank 2.

**A sharpening of R5's own account of the cause, from this pass, not a first
correction of it.** R5 said the `x6` comment beside 420 "refers to an EARLIER
multiply, so a reader concludes it is current". The arithmetic in that comment is in
fact **honest**: `18+5+47 = 70`, times `DENSITY_SCALE` 6, is 420, and that multiply
genuinely was applied to this table. What is stale is the **row it cites**:
`18+5+47` is the pre-WG-222 canopy table and no longer exists anywhere, and today's
row is `100+30+290`. **world-gen.md 6.13.11 item 5(b) already said this**, in the
same words: the `x6` comment "refers to an EARLIER x6, the `DENSITY_SCALE` multiply
that took the pre-WG-222 canopy asks 70 to 420, and NOT to WG-222's table multiply".
This pass sharpens that record's framing (the comment is worse than R5's own first
description, not better, because a reader who checks its arithmetic finds it correct
and stops) rather than discovering it fresh. Two sentences of the same file's header
are now simply false: `TreeTuning.ts:90-91` still claims the table is "the retired
canopy tier's own asks, row for row", and `:105` still claims the harvest field "is
now DENSER than the canopy's".

### 3.5 R5 RANK 5, the carpet's lift: **THE NUMBER SURVIVES UNMOVED AND IT IS THE WRONG NUMBER**

Re-read from `meadowfield`'s own capture, `?grass=0` one flag apart, same build:

| rect | range | shipped luma | bare luma | lift | R5's lift |
|---|---|---|---|---|---|
| `r4` | 4 m | 91.33 | 86.37 | 1.057 | 1.06 |
| `r10` | 10 m | 117.21 | 82.85 | 1.415 | 1.41 |
| `r25` | 25 m | 139.12 | 82.60 | 1.684 | 1.68 |
| `r55` | 55 m | 128.16 | 83.31 | **1.538** | **1.54** |
| `r100` | 100 m | 122.18 | 98.85 | 1.236 | 1.24 |
| `r250` | 250 m | 114.52 | 113.45 | 1.009 | 1.01 |

**Every row reproduces R5 to two decimals**, which is the honest way to say that not
one of the eleven merged lanes went anywhere near this. What the ladder adds is that
the statistic was never the defect. At `meadowfield`, bands of 60 rows, rect
`x560 w900` (the ladder's own default and not separately recorded when this table
was built; stated here rather than left silent, on the correction pass's own finding
below), shipped against `?grass=0`:

| rows | range | s=1 shipped / bare | s=16 shipped / bare |
|---|---|---|---|
| 240 to 300 | above the horizon to 84 m | 33.99 / 34.73 | **20.78 / 20.78** |
| 300 to 360 | 84 m to 17 m | **29.50 / 33.84** | **14.96 / 9.67** |
| 360 to 420 | 17 m to 9 m | 32.61 / 34.38 | 12.28 / 12.26 |
| 660 to 720 | 3 m | 40.81 / 38.29 | 23.90 / 28.40 |

**Correction pass note, on the rect this table never stated.** This is the one table
in the document with no rect printed beside it, and rank 5 in section 4.5 rests on it.
The audit tooling's own default (`rn2686bands.mjs`, `--rect` unset) is `x560 w900`,
which is stated above as the closest reproducible choice rather than left implicit. A
fresh-context reproduction on that default rect reads **34.364 / 35.125** at s=1 and
**20.546 / 20.546** at s=16 over rows 240 to 300, close to but not identical with the
33.99/34.73 and 20.78/20.78 printed above. The two readings agree on both conclusions
that matter (shipped and bare are within a point of each other at s=1, and identical
to three figures at s=16), so this is recorded as **rect-sensitivity evidence**, not
as a correction to the row values themselves: the finding does not depend on which
reasonable rect was used, and the exact rect the first draft used remains unrecorded.

Two readings, both real and not in conflict. Through 17 to 84 m the carpet **adds 55
per cent of coarse structure** (14.96 against 9.67) while **removing 4.34 counts of
fine** (29.50 against 33.84): it is a veil, not a flat wash, and R4's and R5's
"uniform pale-green wash" is half right. And past 84 m it is not a veil at all,
because the two arms read **20.78 and 20.78 at 16 px, identical**, and the lift ratio
there is 1.01, which R5 read as the carpet correctly finishing.

**The rank moves.** The thing worth ranking at the plains hero is not the lift, it is
that the ground past 85 m has nothing on it and nothing measures it: at pitch -12 and
a 1.62 m eye, **the whole band from 84 m to the horizon lives in about twelve frame
rows**, and no committed rectangle and no ladder can score twelve rows. That becomes
this round's rank 5, as an instrument gap with a deliverable.

---

## 4. THE RANKED FIVE

**Correction pass note on the criterion actually used.** The first draft stated this
ranking as "by what the eye loses most against the Space Engineers bar first, then by
exposure". That is not the criterion this document actually applied, and section 5
item 7 already concedes it in the same breath it is stated: the far material (item 7)
and the terrain's missing material layers (item 7/8.4, FIDELITY-GAP item 2) are, "by
eye, larger than three of this round's ranked five," yet neither is in the ranked
five, because both are blocked on a licensing and asset-pipeline decision no lane can
act on today. **The actual criterion is ACTIONABILITY**: what a lane can measure,
scope and fix now, weighted by exposure against `story_line_outline_v1.txt`, with raw
eye-loss magnitude breaking ties among items a lane can actually take. Feasibility
classes as R5: **(a)** art or tuning inside the current stack, **(b)** engine work
inside WebGL2, **(c)** likely WebGPU, **(d)** plausibly native.

### 4.1 RANK 1: TWO THIRDS OF THE AERIAL WORLD IS A PHOTOGRAPH OF THE ATMOSPHERE, AND THE GEOMETRY UNDERNEATH IT IS ALREADY DRAWN. **BLOCKING** · class (a)

**(a) THE EYE.** `R6_flyover.png` at 1x. The near half of the frame, from the bottom
edge up to about row 470, is a forest: stands, clearings, tonal sweeps, a ridge line
you can read. Above row 470 the world stops. From there to the skyline at row 317
there is a smooth cream-to-khaki wash with faint horizontal smears in it and nothing
else, no vegetation, no relief, no colour. The first thing a player sees on the first
launch is a real forest with a desert behind it, and the desert is two thirds of the
picture. `R6a_aero50_flyover.png` is the same camera on the same build with the
aerosol amplitude at one half: green sweeps and ridge shading now run out to eight or
ten kilometres, the sense of depth survives intact (things still go pale and blue
toward the skyline) and nothing in the frame looks broken.

**(b) THE INSTRUMENT.** Section 3.1's three-arm table, plus the amplitude sweep that
turns the deleting control into a graded one. `?aerosol=` is an **amplitude** on
`aerosolSigma`, not an on/off (`Atmosphere.glsl.ts:486-490`), so the trade can be
measured. Rect `x560 y340 900x130`, 12.9 km to 4.5 km, five arms, one build:

| scale px | 1.00 shipped | 0.75 | 0.50 | 0.25 | 0.00 |
|---|---|---|---|---|---|
| 1 | 3.402 | 4.165 (+22.5%) | 5.270 (+54.9%) | 6.803 (+100.0%) | 8.951 (+163.1%) |
| 16 | 2.578 | 3.202 (+24.2%) | 4.170 (+61.7%) | 5.559 (+115.6%) | 7.558 (+193.1%) |
| 32 | 2.240 | 2.825 (+26.1%) | 3.757 (+67.7%) | 5.112 (+128.2%) | 7.073 (+215.7%) |
| 64 | 1.726 | 2.357 (+36.5%) | 3.333 (+93.1%) | 4.731 (+174.1%) | 6.707 (+288.5%) |

Monotone, smooth and with no knee, so every value on it is available and none is
privileged by the data.

**The term is not broken, which is the important half.** Retained coarse structure
over the band is `2.240 / 7.073 = 0.317`, so the implied optical depth is
`ln(1/0.317) = 1.15`, giving `sigma = 1.44e-4` per metre at a chosen effective
mid-range of 8 km, against the authored `aerosolSigma = 1.4e-4`
(`Atmosphere.glsl.ts:154`). **Correction pass note:** the 8 km figure was chosen, not
derived, and row-weighting the same band's actual depth distribution instead gives
`sigma = 1.58e-4`, about 13 per cent from the authored value rather than three. So
the honest statement is that **the measurement brackets the authored constant across
any reasonable effective range**, not that it reproduces it to a stated digit: 1.4e-4
sits inside the spread that 8 km-chosen and row-weighted give (1.44e-4 to 1.58e-4),
and neither reading is off by an order of magnitude or by a sign. Nothing is
mis-scaled, nothing is gated off, and no lane should go looking for a bug; that
conclusion does not depend on which of the two readings is used.

**And the constant's own tuning record was scored on the other axis.** The block
above that constant states its design bar as "a 20 km silhouette desaturated and
still legible" and prices the old `4.5e-4` at "51.6 per cent of the contrast off the
ground of a 1,200 m flight". The silhouette bar **is met**: at `flyover` the visible
skyline is row 317, which the inversion puts at 20.0 km, and the sky-to-ground step
across rows 316 to 322 is **22.86 counts shipped against 20.47 with the aerosol off**,
so the aerosol is not eating the silhouette at all. What was never scored is the
**lateral** field inside the ground band, and that is where the 68 per cent goes. The
audit's own first draft of this section claimed the silhouette bar was missed; the
measurement refuted it and the claim is struck here rather than quietly dropped.

**(c) THE FILE SEAM.** `web/src/render/materials/Atmosphere.glsl.ts`, the pair
`aerosolSigma` (line 154) and `aerosolScaleM` (line 155), and `AEROSOL_AMP` at
486-490. Both are outside M1's locked set. rendering.md 2.44.10 item 1 already routed
this lane and named `aerosolScaleM` "the surgical one, because it is near-irrelevant
to ground-level rays and moves the aerosol column a 1,200 m eye looks through": this
audit supplies the trade curve that section asked for and does not displace its
routing. `SkyProbe.ts:139` reads the same scale height and must be re-checked, not
assumed.

**(d) DRAFT ALLOCATION ROW.**

> `RN-27xx to RN-27yy` | rendering, **THE AERIAL PERSPECTIVE'S LATERAL COST** (opus, look call with a measured curve): at `flyover` over 4.5 to 15.2 km the ground carries 2.24 counts of 32 px lateral structure against 7.07 with `?aerosol=0`, so the atmosphere removes 68 per cent of what the geometry already draws across two thirds of the visible depth, while the same rows carry 6.3 to 18.9 counts inside 4.5 km. **The term is correct and the constant is the decision:** the retained fraction implies `sigma = 1.44e-4` at a chosen 8 km effective range, or 1.58e-4 row-weighted, both bracketing the authored 1.4e-4 rather than landing on it to a stated digit, and `aerosolSigma`'s own comment block prices it as a 28 km Koschmieder visual range. The sweep is committed: 0.75 buys +26.1 per cent of 32 px structure, 0.50 buys +67.7, 0.25 buys +128.2. **The lane's job is to pick a value and prove what it costs, not to find a bug.** `aerosolScaleM` is the surgical handle for the aerial poses (2.44.10 item 1) and must be tried before `aerosolSigma`, which moves ground-level rays too. **Owns:** `render/materials/Atmosphere.glsl.ts`'s aerosol pair and `SkyProbe.ts`'s read of the scale height. **Must not touch:** `TerrainTreeline*` (the paint is worth 5 per cent here and is not the lever), `ScatterTuning`, any palette, the Rayleigh half. **Done when:** the 4.5-to-15.2 km band's 32 px sd reaches a stated multiple of 2.240 with the 20 km silhouette's sky-to-ground step held at or above 20.0 counts; `vista`'s far mountain still reads as distant by eye (that frame's blue haze is doing real work and a global cut will damage it); `limb` re-taken as a regression rather than assumed away, because the vertical column through the layer is exactly `sigma x H`; `meadow` and `mtnslope` inside stated bands; `rn2550guard` exit 0 on all four poses. Opus: the measurement is finished and what remains is a judgement across four poses that pull in different directions.

### 4.2 RANK 2: THE WOOD A PLAYER CAN HARVEST IS SIX TIMES THINNER THAN THE WOOD THEY WALKED TOWARD, EXACTLY, AND AT EVERY VEGETATED BIOME. **BLOCKING** · class (a)

**(a) THE EYE.** `R6_forestaircanopy.png` at 1x is the clearest picture the project
has of it. The near tier is a **savanna**: individual trees standing far apart on
smooth dark ground, each with a hard black shadow, perhaps one tree per sixty pixels
square. Behind them, beginning abruptly around row 470, is a continuous near-black
mass of impostors with no gaps in it at all. They are not one forest at two
distances; they are an orchard in front of a hedge. The same relationship is what
`R6_meadowfield.png` shows from the ground, where two isolated trees stand on a flat
green plane in front of a solid treeline. **Correction pass note:** `forestaircanopy`
is `forestair`'s own site (`artframe.js:1060-1063`, "biome 3 ... the canopy fills the
frame to the horizon line"), and biome 3 is **Forest**, not Plains. The picture above
is a Forest pose; the table below shows the ratio holds there too, at Forest's own
numbers, not at Plains' borrowed ones.

**(b) THE INSTRUMENT, table-wide and not one biome.** `TreeField.ts:264` applies
`TREE_DENSITY_KM2[biome] * this.densityScale` identically for every biome, so the
seam is not a Plains peculiarity. Harvest (`TreeTuning.ts:113-119`) against canopy
(`Registry.ts:347-363`'s per-biome sums, each times `DENSITY_SCALE = 6` at
`Registry.ts:147`), all four vegetated biomes, read on this commit:

| biome | harvest (`TreeTuning.ts`) | canopy sum x 6 (`Registry.ts`) | ratio |
|---|---|---|---|
| Plains | 420 | `(100+30+290) x 6` = 2,520 | 6.0 |
| **Forest** (the pose above) | 3,840 | `(1200+360+2280) x 6` = 23,040 | 6.0 |
| Hills | 1,200 | `(360+120+720) x 6` = 7,200 | 6.0 |
| Mountains | 480 | `(330+150) x 6` = 2,880 | 6.0 |

**The ratio is exactly 6.0 at all four rows, not a Plains coincidence.** Ranges,
all from `ScatterTuning.ts` and biome-independent: the harvest ring is uniform to
`TREE_RADIUS_M` 620 m with a `TREE_EDGE_WANDER_M` of 70 m either side, so it covers
fully to 550 m and is gone by 690 m; the canopy tier is identically zero below
`CANOPY_NEAR_M` 550 m and at full density from `CANOPY_NEAR_FULL_M` 690 m; WG-260's
mid tier ramps the canopy population quadratically from `MID_NEAR_M` 170 m to
`MID_FULL_M` 550 m. So the seam is a 380 m ramp with a factor of six across it at
every vegetated biome, and it is **out of reach of every lane that has touched
scatter since**: WG-295, WG-301 and WG-304 are gated on
`groundOk = cell <= MAX_CELL_M` at `Scatter.ts:530` and bind only on chunks the ground
tiers already refuse.

**The comment is a worse trap than R5 described.** Its arithmetic is correct
(`18+5+47 = 70`, times 6, is 420) so a reader who checks it stops there; what is stale
is that `18+5+47` is the pre-WG-222 canopy row and today's is `100+30+290`. Two
sentences of the same file's header are now false outright: `:90-91` ("the retired
canopy tier's own asks, row for row") and `:105` ("is now DENSER than the canopy's",
which is wrong by a factor of six). `TreeTuning.ts` contains **no mention of the step
at all**, no WG-222 note and no cross-reference; the file that must change is the one
file that does not know.

**A second, independent disagreement across the same seam**, named in the code and
not fixed: `web/src/game/TreeField.ts:291-298` records that the harvest ring passes
`grove = 1` while the canopy tier takes the real grove field, so "the two layers now
disagree about groves across the 550-690 m crossfade".

**(c) THE FILE SEAM.** `web/src/game/TreeTuning.ts` (the whole table, its inline
comments and its two false header sentences), not the Plains row alone.
`web/src/world/ScatterTuning.ts:1126-1130` holds the only written record of the
defect and must be updated in the same commit or it becomes a docstring that outlives
its cause. **The node budget is the constraint and it is world-gen's, and it is a
table-wide question, not a Plains one**: world-gen.md 6.13.11 records that raising
the harvest density means `/core` nodes with a per-frame matrix compose each, which
is the cost RN-2228 exists to avoid, and that an Admin decision on the budget is
owed across all four rows at once, since a per-biome ruling would leave three biomes
still six-fold thin. This is a two-domain item and must not be taken as a one-line
table edit.

**(d) DRAFT ALLOCATION ROW.**

> `RN-27xx to RN-27yy` | world-gen/rendering, **THE SIX-FOLD HARVEST GAP, TABLE-WIDE** (sonnet after Admin rules the node budget, opus if the budget question is taken with it): `TreeField.ts:264` applies `TREE_DENSITY_KM2[biome]` identically for every biome, and the ratio is **exactly 6.0 at all four vegetated rows**: Plains 420 against 2,520, Forest 3,840 against 23,040, Hills 1,200 against 7,200, Mountains 480 against 2,880 (`TreeTuning.ts:113-119` against `Registry.ts:347-363`'s canopy sums times `DENSITY_SCALE` 6 at `Registry.ts:147`). Untouched by WG-295/301/304, all three of which are gated on `groundOk` at `Scatter.ts:530` and cannot reach a 550 m seam. WG-260's mid tier removed the visible CLIFF, so this is no longer a wall: it is a standing disagreement between the wood a player can harvest inside 620 m and the wood they can see beyond 690 m, at every vegetated biome, and gathering wood is step one of the progression spine. **Take the table and its documentation together and nothing else.** The inline `x6` comments' arithmetic is honest and their cited rows are tables that no longer exist; `TreeTuning.ts:90-91` and `:105` are false as written and must be corrected in the same commit as any value change, and `ScatterTuning.ts:1126-1130`'s record of the defect must be updated or struck rather than left to contradict the code. **Blocked on an Admin ruling first, and the ruling is table-wide:** world-gen.md 6.13.11 prices the harvest tier at one `/core` node with a per-frame matrix compose each, so "make 420 into 2,520" (and the same move at the other three rows) is a node-count decision across the whole table and not a look decision, and not a decision that can be made at one biome and left open at the others. **Owns:** `game/TreeTuning.ts`, and `ScatterTuning.ts`'s docstring at 1126-1130. **Must not touch:** `Registry.CANOPY_*` (the canopy table is the reference, not the variable), `MID_*` and `canopyDistanceWeight` (WG-260's ramp is the thing that made this survivable and must not be retuned in the same lane), `TreeField.ts`'s grove disagreement (a separate routed item). **Done when:** the four tables agree at every vegetated biome or the difference is documented as intentional with a number and a reason at each row; the seam's realised density is measured at `meadowfield` and `forestaircanopy` before and after; `meadow` stays under the 2.7e6 triangle ALERT; the full four-pose `rn2550guard` exits 0 (standing rule 7: a density change is judged at the densest pose and a merge runs the whole guard). Sonnet: the arithmetic is settled at all four rows and the only judgement left is Admin's node budget.

### 4.3 RANK 3: THE MOUNTAIN SNOW IS A FACETED PLASTIC SLAB, AND IT IS THE HIGHEST-CONTRAST OBJECT IN THREE HERO POSES. **CLEARLY BEHIND** · class (a)

**(a) THE EYE.** `R6_mtnslope_crop_patch.png` at 4x. The snow patches are hard-edged
convex polyhedra with visible flat facets, sitting on the ground with a razor
silhouette, no feathering at the edge, no accumulation against the rocks beside them
and grass blades passing straight through them. The shaded facets carry a strong blue
cast that nothing else in the frame shares. At 1x in `R6_vistadawn.png` the effect is
worse, not better: in a frame graded entirely warm by a 5.7 degree sun, these are the
only cold objects in it and they read as litter. They are present in `R6_vista.png`,
`R6_vistadawn.png` and `R6_mtnslope.png`, three of the thirteen hero poses. The same
frame carries the wider complaint R5 ranked ninth and never gave to a lane: cream
substrate, near-black glossy rock decals and pale mint grass cards, three hue families
with no relationship, at `mtnslope`'s box iqr of **88.55, unmoved from R5 to the digit**.

**(b) THE INSTRUMENT.** Same rows, `y[188,196)`, 30 px of a shaded snow facet against
100 px of the substrate beside it:

| patch | r | g | b | warm (r-b) |
|---|---|---|---|---|
| shaded snow facet, `x[618,648)` row 191 | 141.77 | 159.97 | 153.17 | **-11.40** |
| substrate, `x[880,980)` row 191 | 189.29 | 182.65 | 154.48 | **+34.81** |

A **46.2-count warm inversion at the same row, the same light and 240 px apart**,
between two surfaces that share a hemisphere. For scale, R5's whole rank 3 was a
25.46-count warm step and was ranked BLOCKING. The lit facet is warm (+21.2) and the
shaded one is cold, which is the signature of a material with no ambient relationship
to its surroundings rather than of a snow that is simply blue in shadow.

**(c) THE FILE SEAM, and it is unusually cheap.** The mesh is
`tools/blender/build_props_mountains.py:83-97`, `Mtn_SnowPatch`, three overlapping
lobes at **`seg=6`** with two rings. Its own docstring already argues the right thing
("A disc has a hard circular edge that reads as a decal; three domes give it a lobed
shoreline") and then builds it at six segments, which is where the facets come from.
The material is `web/src/render/instancing/SurfaceRoles.ts:197`, which reads
`Ice: 'flat'`, putting snow in the same surface family as glass, oil, skin, water and
every status chip in the game. **Neither of those needs a Polyhaven download or a
coastline ruling**, which is why this ranks above several larger gaps that do.

**(d) DRAFT ALLOCATION ROW.**

> `RN-27xx to RN-27yy` | rendering, **THE SNOW PATCH IS A FACETED PLASTIC SLAB** (sonnet): `Mtn_SnowPatch` (`tools/blender/build_props_mountains.py:83-97`) is three `seg=6` lobes with two rings, so it reads as a hexagonal shard rather than a drift, and its role is `Ice: 'flat'` (`SurfaceRoles.ts:197`), the same surface family as glass and status chips. At `mtnslope` a shaded facet reads warm **-11.40** against the substrate beside it at **+34.81** on the same row, a 46.2-count inversion, and the prop is the highest-contrast object in the near field of `vista`, `vistadawn` and `mtnslope`. **Two independent halves, and take the geometry first:** raise `seg` and the ring count until the silhouette stops faceting, and give the edge a thin taper so it meets the ground instead of ending; then decide whether `Ice` deserves a surface role of its own rather than `flat`. **Owns:** `tools/blender/build_props_mountains.py`'s `snow_patch` and `SNOW` box, the regenerated `props_mountains.glb`, and `SurfaceRoles.ts`'s `Ice` row. **Must not touch:** `scree_sheet`, `talus_fan` or `frost_shards` in the same file (out of scope for this lane; **correction pass note:** the "held still" clause in the file's own docstring is attached to `snow_patch` itself, "this is the one prop in the atlas that is not rock ... its bytes are held still so that the atlas diff is entirely the rock work," which licenses a ROCKS lane to leave snow untouched, and this lane's entire job IS the snow prop, so it is precisely the lane licensed to move those bytes rather than the one barred from it; the audit's first draft had this backwards), any terrain material, any palette. **Done when:** the patch's silhouette shows no straight facet longer than a stated pixel count in a 4x crop at `mtnslope`; the shaded-facet warm at `mtnslope` row 191 comes inside a stated distance of the substrate's; `vistadawn` no longer contains the coldest object in a warm-graded frame by eye at 1x; the glb's triangle count is stated and `meadow` stays under the 2.7e6 ALERT; no other prop in the atlas changes byte for byte. Sonnet: two small, separable, fully named changes with a measured target on each.

### 4.4 RANK 4: A REGISTERED, SELECTED, FORTY-METRE-REACH EMITTER DELIVERS EXACTLY ZERO TO THE GROUND THROUGH ITS OWN UNIFORM, AND THE QUESTION IS ONE FILE WIDE. **CLEARLY BEHIND** · class (a)

**Correction pass rewrite, credited to a fresh-context verifier.** The first draft of
this rank asked "is there a light at all" and framed `smelternight` as "the first
frame that can settle the question rather than infer it". Both are refuted by this
audit's own committed evidence: `docs/screenshots/R6_smelternight.json`'s own `emit`
block reads `installed: true, registered: 1, selected: 1, spliced: 103, reach: 40`.
There is a light. It is wired into 103 programs, one emitter is registered and
selected for this frame, and its reach is 40 m, more than enough to cover the grass
either side of the machine. The real question, stated below, is why the ground's own
share of it measures zero.

**(a) THE EYE.** `R6_smelternight.png` at 1x. The machine itself is genuinely good:
the hearth glows, the casting bed glows, bloom sits on it correctly, it reads as hot
metal. The grass to the left and right of it is uniform blue-black, at the same value
it holds at the frame edges, receiving no orange at all. That observation stands; what
changes is the explanation. The frame's box iqr is 147.97, the highest in the set by a
factor of two.

**(b) THE INSTRUMENT, and it already exists and was already run.**
`web/src/render/materials/EmissiveLight.ts` (RN-2385) is a **shipped** emissive
local-irradiance system, not an absent one: `EMIT_MAX = 6` emitters live per frame,
summed with a windowed inverse-square falloff, added to the terrain fragment at
`TerrainFragLight.glsl.ts:158-159` through the `uEmitGround` uniform. Its own header
records that a pool of real `THREE.PointLight`s was considered and **rejected on two
measured numbers**: `TerrainShader` reads no three.js light at all, so a real point
light could not reach the ground either way, and `Headlamp.ts` measured a real point
light costing a **441 ms stall and 30 new shader programs** the first time one
appeared, because the light count is part of the program cache key. The
local-irradiance term was built specifically to avoid both, and `smelternight` was
built by R3 specifically to measure it (`WORLD-AUDIT-R3-2026-08-21.md:158`: "the only
frame in the file where a hot machine is the brightest object in the world" and the
frame that lets "nothing emissive lights anything" become "a measurement instead of
an inference from a daylit frame"). **Two control arms already exist and were not
run by the first draft**: `?firelight=0` zeroes the whole emissive model, and
`?firelightground=0` (`TerrainAmpQuery.ts:320-338`) zeroes only the terrain's share,
holding every machine surface exactly as shipped, for precisely this separation.

Both arms, taken against `smelternight`, one build:

| rectangle | shipped | `?firelight=0` | delta |
|---|---|---|---|
| `hearthL` | 6.60 | 3.99 | -40.5% |
| `hearthR` | 7.37 | 4.76 | -35.4% |
| `bandLit` | 24.67 | 10.74 | -56.5% |
| grass columns at 20 m | (baseline) | (baseline) | 0.05 to 0.12 counts |

The whole-model kill switch moves the machine-adjacent rectangles by 35 to 56 per
cent, so the model is doing real work close in, and it moves grass at 20 m by only
0.05 to 0.12 counts, near this instrument's own noise floor, which is consistent
with a 40 m windowed inverse-square term that is genuinely weak at range. **Then
`?firelightground=0` is bit-identical to shipped at every committed rectangle**, a
0.000-count delta everywhere the twelve rectangles look, including the ones closest
to the machine. A term that is installed, registered, selected, spliced into 103
programs and reaches 40 m returns **exactly zero** through the one uniform whose job
is to carry it to the terrain. That is not "no light exists"; it is "the terrain's
own tap on an existing light is shut all the way off," and it is a one-file question:
why does `uEmitGround` deliver zero.

**(c) THE FILE SEAM.** `web/src/render/materials/TerrainProgram.ts:171` sets
`uniforms.uEmitGround = emitGround`; `TerrainAmpQuery.ts:335-338`'s
`emitGroundFromQuery()` is the only other place that name appears outside the shader
and the pars declaration. The bug is somewhere on the path from whatever supplies
`emitGround` at `TerrainProgram.ts:171` to the value the shader actually multiplies
by at `TerrainFragLight.glsl.ts:159`, and it is contained to that path: not the
`machinemat` family, not the light list, not `PropSkyAmbient`/`TerrainAmbient`, none
of which this correction touches. This is class (a), not (b): it is not a light that
does not exist, and it is not the clustered many-light wall FIDELITY-GAP option C
names. It is a wiring defect in one term that is already live, and it is sonnet-sized.

**(d) DRAFT ALLOCATION ROW.**

> `RN-27xx to RN-27yy` | rendering, **`uEmitGround` DELIVERS ZERO** (sonnet, not opus: the diagnosis is already done): `R6_smelternight.json`'s own `emit` block reads `installed: true, registered: 1, selected: 1, spliced: 103, reach: 40`, so `EmissiveLight.ts` (RN-2385) is live, wired into 103 programs and within reach of the grass either side of the machine. Shipped against `?firelight=0` (the whole-model kill switch) moves `hearthL` 6.60 to 3.99 (-40.5%), `hearthR` 7.37 to 4.76 (-35.4%) and `bandLit` 24.67 to 10.74 (-56.5%), and moves grass columns at 20 m by only 0.05 to 0.12 counts, so the term is real and is weak at range as designed. Shipped against `?firelightground=0` (`TerrainAmpQuery.ts:320-338`, the terrain-only kill switch) is **bit-identical at every committed rectangle**, a 0.000-count delta everywhere, which means the ground's own tap on this light returns exactly zero regardless of distance. **The job is to find why `uEmitGround` (`TerrainProgram.ts:171`, consumed at `TerrainFragLight.glsl.ts:158-159`) is always zero on the shipped path when the emitter feeding it is registered and selected**, not to decide whether a light should be added. **Owns:** the `emitGround` value's path from wherever `TerrainProgram.ts:171` sources it back to its origin, and `TerrainAmpQuery.ts`'s `emitGroundFromQuery()` only if the fault is there. **Must not touch:** `EmissiveLight.ts`'s emitter model, selection or falloff (all proved live and correct by the `?firelight=0` arm above), the `machinemat` family, any light list, `TerrainAmbient`'s daylight ladder, the post stack's bloom constants (audit rank 8's night halo is a separate owed item, 2.31.6 item 4). **Done when:** `?firelightground=0` and shipped diverge by a stated, non-zero amount on at least the rectangles closest to the machine; the divergence is published in counts the same way the two arms above are; **`meadownight` is not used as an unchanged-control without qualification**, because it carries this round's own item 15, an undiagnosed light pool at about (820, 600), so any "unchanged to the digit" claim on that pose must state that the pool is a confound and was checked separately; the daylit `machine` and `smelterhero` frames are inside stated bands, because a fix to the ground path must not brighten the day. Sonnet: the light exists, the two control arms exist, the failing uniform is named, and the remaining work is inside one file's data path.

### 4.5 RANK 5: THE PLAINS HERO POSE CANNOT MEASURE ITS OWN MID FIELD, WHICH IS WHY "THE WORLD ENDS AT THE CARPET" HAS SURVIVED FOUR ROUNDS WITH NO NUMBER UNDER IT. **CLEARLY BEHIND** · class (a), one pose

**(a) THE EYE.** `R6_meadow_crop_midband.png` at 3x and `R6_meadowfield.png` at 1x.
The near sward is dense, reads as grass and is genuinely good. Then it stops, and
above it is a dark stubble band and above that a **flat, smooth, untextured green
plane** running to the treeline, with isolated trees standing on it like counters on a
board. The treeline itself is a row of near-identical blobs on a straight baseline
with a pale band behind it. Against the Space Engineers bar this is FIDELITY-GAP
item 1 relocated rather than closed: the ground is grass for eighty-five metres and a
painted plane after that.

**(b) THE INSTRUMENT, and the finding is that there is not one.** Section 3.5's band
table shows the two arms reading **20.78 and 20.78 at 16 px** over rows 240 to 300,
identical, so the carpet is provably absent there. But rows 240 to 300 are **not a
measurement of the mid field**: at `meadowfield`'s pitch of -12 and a 1.62 m eye, the
geometric horizon is row 286, so about three quarters of that band is sky and the
whole of 84 m to the horizon occupies roughly **twelve frame rows**. A wide-x row
profile across the apparent edge confirms the problem from the other side: over
`x[300,1300)` the largest row-to-row step anywhere in rows 292 to 316 is **3.54
counts**, so the ruler-straight cut the eye reports is not at a fixed row and averaging
along x erases it. **The claim that the carpet ends in a ruler-straight cut is struck
here, on this audit's own measurement, rather than quietly dropped**, matching the
NUMBERS.md record of this pass. The eye is seeing something real that no committed
instrument at this pose can score, and this audit refuses to publish a number for it
rather than publishing one from a rectangle that cannot hold the subject. R5's `r250` rectangle
reads a lift of 1.009 there and calls it healthy, which is the same blindness wearing a
number.

The precedent for the fix is in the shot set already: R5 added `forestaircanopy`
because "the far treeline's 690 m-to-horizon band spans tens of rows instead of the
0.515 px a standing eye sees". **Plains has no such twin.** `midfield` is the nearest
thing and it declares `props: false`, so it cannot judge a carpet.

**(c) THE FILE SEAM.** `web/tools/smoke/probes/artframe.js`, a new shot only, derived
from `meadowfield`'s own site and yaw with the eye raised and the pitch solved so the
84 m-to-horizon band spans tens of rows, plus its `rangeRects` rungs. Nothing under
`web/src/` changes. The cover terms that the pose would then be able to judge are
`render/grass/*` and `render/materials/TerrainCoverFar*`, and they are explicitly
**not** this lane's.

**(d) DRAFT ALLOCATION ROW.**

> `RN-27xx to RN-27yy` | rendering, **A MID-EYE POSE OVER PLAINS, AND NOTHING ELSE** (sonnet): at `meadowfield` (pitch -12, 1.62 m eye) the geometric horizon is row 286 and the whole 84 m-to-horizon band occupies about twelve frame rows, so the eye's four-round complaint that the world ends at the carpet has never had an instrument that could hold it: the scale ladder reads the shipped and `?grass=0` arms as **20.78 and 20.78 at 16 px** over the only band available, and a wide-x row profile flattens the apparent cut to a 3.54-count maximum step. R5's `r250` scores the same band a lift of 1.009 and calls it healthy. **Add the pose and stop.** `forestaircanopy` is the precedent and the model (R5 added it for exactly this reason over Forest); `midfield` cannot substitute because it declares `props: false`. Derive the eye height and pitch from the trigonometry so the 84 m-to-horizon band spans tens of rows, put the site and yaw on `meadowfield`'s own committed values so the two poses are one camera move apart and not one scene apart, and publish the derivation in the manifest row rather than in a shell history. **Owns:** `tools/smoke/probes/artframe.js`, one new shot and its rectangles, additive only. **Must not touch:** `meadowfield`'s or `meadow`'s own fields and rectangles (three audits quote them and two reproduce them to the digit), anything under `web/src/`, any cover or carpet constant. **Done when:** the new pose is `valid: true` with `teleported`/`converged` asserted and its sun inside tolerance; its committed rectangles' `rangeM` are published and span 85 m to at least 800 m over tens of rows each; the scale ladder separates shipped from `?grass=0` on at least one of them by more than this instrument's 0.05-count floor, or reports that it does not and thereby proves the carpet's absence with a number for the first time; every other pose in the file is untouched. Sonnet: it is a pose, it is derived rather than chosen, and it changes no rendered pixel.

---

## 5. THE REST OF THE RANKING

Carried, re-judged by eye on this build, not re-derived.

| # | Gap | Today | Class |
|---|---|---|---|
| 6 | **Water is a regular corrugation that reflects nothing.** `R6_pondside.png`: parallel diagonal stripes at one period and one amplitude across the whole surface, no reflection of the far bank, the sky or the sun, no fresnel, and hard-edged blue polygon flakes lying on the sand at the shore. Unmoved since R4 ranked it. | CLEARLY BEHIND, tied to section 8.1 | (a)/(b) |
| 7 | **The far material is one substance.** `R6_vista.png`: mountains, mid plain and near ground are the same cream at three brightnesses. No rock, no cliff, no scree, no grass, and the mountains have no strata, ridgeline or erosion. This is FIDELITY-GAP item 2 whole, and by eye it is larger than three of this round's ranked five. It is ranked here and not there **only because it is section 8.3's blocked asset decision**, and the moment Polyhaven is ruled on it becomes rank 1 or 2. | CLEARLY BEHIND | (a)/(b) |
| 8 | **The beach substrate is combed.** `R6_beach_crop_ripple.png` against `R6_beach_crop_ripple_relief0.png`: the diagonal corduroy across the whole near field is `?groundrelief=0`'s term, proven by the one-flag pair, and the defect is that its direction field is coherent across the entire visible plain instead of varying. `reliefswing`, `reliefcell` and `reliefcellnoise` are the named registered handles. | CLEARLY BEHIND | (a) |
| 9 | **The orbital terminator is polygonal.** `R6_limb.png`: the shadow boundary is three or four straight chords meeting at hard corners, not a curve. R5 measured `limb.seam` iqr improving 64.27 to 61.02 and called the trend downward; by eye at 1x the straightness is more objectionable than the stepping. | CLEARLY BEHIND | (b) |
| 10 | **The planet has no surface from orbit.** Same frame: uniform pale grey-blue with faint cream smears, no biome colour, no continents, while the same world at 1,200 m is green forest and cream plain. Probably the same family as rank 1 (the vertical column is `sigma x H`) and must be re-taken as that lane's regression. | CLEARLY BEHIND | (a) |
| 11 | **Clouds: flat opacity and a straight hem.** R4 rank 5. `R6_vista.png` and `R6_flyover.png` both show it; the cloud layer is better than R4's description at `vista` and still has no thickness. | CLEARLY BEHIND | (a) |
| 12 | **No dappled canopy light; shadow sides crush toward black.** `R6_forestaircanopy.png`: every tree shadow is hard, pure black and cast on featureless ground. M3's caster-registration diagnosis stands. | CLEARLY BEHIND | (b)/(a) |
| 13 | **The grass card is a leek leaf.** L5's owed item 1, visible at 1x in `R6_meadowfield.png`. Authoring, not shading. | ACCEPTABLE | (a) |
| 14 | **No sun disc.** `R6_vistadawn.png` at a 5.7 degree sun has a bright quarter of sky and no disc in it. Unchanged for six audits. | CLEARLY BEHIND | (a) |
| 15 | **A circular unmotivated light pool in the night meadow.** `R6_meadownight.png` carries a hard-edged bright disc of yellow-green in the grass at about (820, 600) with no visible source. Not diagnosed here; flagged because it is new to this round's frame set and may be a lamp with a wrong falloff. | UNDIAGNOSED | unknown |
| 16 | **The crown residual, deliberately parked.** RN-2605's third degeneracy; the crown is still 40 to 61 per cent specular with a `rho` budget of 0.0090. Admin's order stands and this audit does not re-open it. | CLEARLY BEHIND | (b) |
| 17 | **`?iblground=0` renders a black mid-field.** Pre-existing, selective (the same frame's `hzBand` is untouched), and still owned by nobody. Not a look defect; an arm that cannot be trusted the next time it is used as a control. Named in 2.34.10 item 4 and in R5, and unchanged. | INSTRUMENT | (a), small |
| 18 | **No surface of the Moon has ever been photographed**, and the spine's pre-alpha target ends at scanning it. | UNMEASURED | one pose |
| 19 | **Anything in motion.** Sixth audit running. | UNMEASURED | (b) |

---

## 6. THE CONTROLS

| arm | pose | what it says |
|---|---|---|
| `?treeline=0` | `flyover` | The far paint is worth 13.3 per cent of 1 px and **5.0 per cent of 32 px** structure over 4.5 to 15.2 km. |
| `?aerosol=0` | `flyover` | The geometry under the haze carries **3.2x** the coarse structure the shipped frame shows over the same band. A deleting control and therefore a locator, which is why the amplitude sweep exists beside it. |
| `?aerosol=0.75 / 0.5 / 0.25` | `flyover` | The graded version of the same question: +26.1, +67.7, +128.2 per cent of 32 px structure. Monotone, no knee. |
| `?treeline=0` | `forestaircanopy` | The paint carries 10.2 per cent of the join band's 32 px structure. |
| `?canopy=0` | `forestaircanopy` | The instances carry 39.8 per cent of it. |
| `?beachcanopy=0` | `beachground` | Nothing, at every scale from 1 to 64 px, on the ground the player stands on. Also serves as this round's **de facto null pair** and therefore as the ladder's own noise floor. |
| `?grass=0` | `meadowfield` | The carpet adds 55 per cent of coarse structure at 17 to 84 m, removes 4.34 counts of fine over the same band, and is **identical to the digit at 16 px past 84 m**. |
| `?grass=0` | `meadow` | Captured, used only for the pose-blindness argument in 4.5. |
| `?groundrelief=0` | `beachground` | Owns the diagonal corduroy across the beach: it disappears and an isotropic mottle is left. |

---

## 7. WHAT CLOSED SINCE R5

| item | verdict | evidence |
|---|---|---|
| **The reach tail and the mottle closed the inner third of R5 rank 1's own band.** | **CLOSED, and the headline movement of the fortnight.** | Section 3.1's ladder: 3.4 to 4.5 km now reads **6.563** at 32 px against 2.094 to 2.328 beyond it. Before and after by eye: `docs/screenshots/RN2660_flyover_pre.png` against `R6_flyover.png`, which is the same camera with the placed forest reaching 5,099.5 m instead of 3,500 and world-gen's two density octaves live in the paint. |
| **The crown arc.** `rho0` spread 8.41x to 2.43x; `forestairnoon` `rho` 0.0992 to 0.1890 and in band for the first time in the R4 stage-2 sequence; the crown's specular share 51-71 per cent down to 40-61. | **CLOSED pending Reid's taste calls.** | The record at rendering.md 2.39, 2.41 and 2.43. **Correction pass softening:** section 3.4 itself is non-monotone here and this row is brought into line with it rather than restating the first draft's "shrinking". R5's published 30.19 does not reproduce on any later base and is excluded; between the two trustworthy points, WG-295's 17.33 and this build's 20.65, the tone step is **growing by 3.32 counts**, not shrinking, though it remains well under R5's own unreproducing figure. Before and after: `docs/screenshots/RN2590_crowns_prelane_3x.png` against `RN2645_crowns_shipped_3x.png`. |
| **The far paint's debt.** RN-2605 raised two `flyovernoon` ceilings by 0.0248/0.0251 under the project's first logged guard decision. | **OVERPAID.** | WG-304's re-pin puts `flyovernoon` at 0.9289/0.8671, below RN-2605's pre-raise 0.9343/0.9020 by 0.0054 and 0.0349. |
| **The dry sea's chroma step.** | **CLOSED as chroma; the survivor is re-attributed.** | 25.46 to 12.60 counts, and shipped Ocean's warm within 0.78 counts of the frame's own Forest ground. Section 3.3 then **refutes** the "flat untextured value dip" that was blamed for the survivor, and routes the remainder to shape. Before and after: `RN2635_crop_before_3x.png` against `RN2635_crop_after_3x.png`. |
| **The guard.** Rebuilt as the project's first look assertion, re-pinned five times including two logged Admin decisions, all eight box ceilings lowered with a four-pose control split. | **CLOSED as a rail.** | Section 9. |
| **`CANOPY_CHUNK_MAX` had no page param and `PropLibrary.CANOPY_MAX_CAPACITY` sat at 92.2 per cent live with no gate.** | **CLOSED** by RN-2675. | rendering.md 2.45. |
| **The beach's near-field look was unmeasured** (WG-285's own owed item 5). | **CLOSED as a measurement, and it found a defect.** | `beachground` exists, is valid, reproduces to the digit across two rounds, and section 3.2 is what it measured. |
| R5's own range-label errors (six rows and a span, wrong by up to 3x). | **CLOSED** by R5's correction pass and used here as the standard inversion. | Section 1. |
| **R5's rank-4 tone endpoints never reconciled against WG-295's.** | **CLOSED here.** | Section 3.4's three-base table. R5's 30.19 does not reproduce; row 462 reproduces WG-295 to the digit. |

---

## 8. WHAT NEEDS REID, NOT A LANE

The mature list, carried forward. Nothing on it has moved since R5 and this audit
adds nothing to it.

### 8.1 ONE coastline decision, covering Ocean and Beach together

R5's sections 7.1 and 7.4 were merged into a single ruling by its own correction pass
and the merge is right: separate rulings on "should Ocean be water" and "is a beach a
desert or a shore" can together place a desert on the far side of a coast that did not
exist when either question was asked. **44.43 per cent of Forge is Ocean class and
Forge has no ocean**; `TREE_DENSITY_KM2[Beach] = 0` carries an explicit written ruling
("the desert stays the desert", "no trees ever") and `CANOPY_BEACH` is Plains' canopy
table copied, and both are defensible and they cannot both be true.
`R6_beachground.png` against `R6a_beachcanopy0_beachground.png` is the two answers side
by side, and section 3.2 is the measurement that they differ in nothing the player
walks on. A lane can implement either answer in an afternoon and must not choose.

### 8.2 The lake-shape finding, which this round strengthened

`pondside`'s real water and `forestair`'s dry plate are one question. N14 could not
discharge "no longer reads as water" from inside two palette rows and said so, and
**section 3.3 now removes the reason it gave**: the plate is not a flat untextured
hole, it carries 6.88 counts of 16 px structure against its neighbour's 6.72. What is
left is the shape, a smooth closed contour with a pale rim at aerial range, and shape
is world-gen's. Whether a dry basin should get relief and a broken shoreline is
downstream of 8.1 and is not a rendering lane.

### 8.3 The SE reference board still does not exist, six audits in

FIDELITY-GAP section 3 Option D step 1 asks for three frozen hero frames each beside
two or three Space Engineers landscape frames, and step 2 makes every graphics lane
ship a side-by-side against **the board, not its own before-frame**. It is still not in
the repository. **Every judgement in this document, including every one in section 4,
is one agent's memory of what a Space Engineers landscape looks like**, which is
precisely the anchoring drift the charter's section 2 diagnoses. It remains the
cheapest unspent item in the programme and it needs Reid because it needs source
frames he chooses.

### 8.4 Polyhaven, and the terrain still has no material layers

A3 routed four to six real PBR layers (grass, dirt, rock, cliff, scree, snow) from
Polyhaven through texgen and it was never sourced. Item 7 in section 5 is the whole of
FIDELITY-GAP item 2 and by eye it is bigger than three of this round's ranked five;
it sits outside the ranked list only because it is blocked here. A licensing and
asset-pipeline decision, not a rendering one.

### 8.5 The crownflank trade, parked

`crownflank=12` with `crownshadefloor=0.30` puts both binding poses inside the guard's
band and Admin refused it because it drives the wood brighter than its own clearing
(`forestairnoon` boxShip 1.0287, boxSurf 1.0327), which breaks the standing R2 finding
that the wood must read darker than its clearing at every pose. That finding is an eye
judgement and it is six audits old. This audit did not re-open it and takes no
position.

### 8.6 The crown taste calls

The crown arc is complete pending Reid's eye on what it produced. Not re-opened here.

---

## 9. THE STATE OF THE RAILS

`npx tsc --noEmit` **exit 0**. `npm run build` **exit 0**.
`npm run check` **9 of 9**. `npm run check:full` **exit 0**, run once, at
`7e5862cf` plus this audit's two additive instruments and its documents.

```
==================== check summary ====================
PASS  check:roles    (0.6s, exit 0)
PASS  check:probes   (0.6s, exit 0)
PASS  check:proxies  (0.6s, exit 0)
PASS  check:proplods (0.6s, exit 0)
PASS  check:fieldstamp (0.7s, exit 0)
PASS  typecheck      (4.9s, exit 0)
PASS  check:pose     (0.8s, exit 0)
PASS  check:limits   (0.7s, exit 0)
PASS  check:boot     (20.1s, exit 0)
=========================================================
9 checks: 9 passed, 0 failed
check:guard: vite preview up on http://127.0.0.1:16531/ (pid 33864)
build: served entry chunk matches dist (ab4467cd46c4f480) and dist is newer than src, wasm and index.html

--- RN-2550 WOOD/CLEARING RATIO BAND (linear-light Y) ---
BAND (fail outside) 0.18 .. 0.75    CORE (target) 0.25 .. 0.55    both on crowns rho

pose            boxShip  boxSurf | crShip  crSurf       G       f     rho  airlt   verdict
forestairnoon   0.9359  0.8844 | 0.8307  0.6928  0.5512  0.5843  0.1873  0.4488   IN BAND, -0.0627 from CORE
forestairlow    0.9177  0.6778 | 0.8779  0.5623  0.4241  0.4294  0.2987  0.7211   IN CORE
flyovernoon     0.9190  0.8406 | 0.9261  0.8637  0.5692  0.5120  0.4762  0.4582   IN CORE
flyoverlow      0.9334  0.7050 | 0.9306  0.6988  0.5233  0.4084  0.4016  0.7695   IN CORE

rn2550guard: PASS (4 of 4 poses judged, 1 outside CORE)
```

**The rails are green and the four `rho` values reproduce RN-2675's post-rebase run
to the digit** (0.1873 / 0.2987 / 0.4762 / 0.4016), which is the expected result for a
read-only lane and is the evidence that this audit's two added files cannot move them.
`forestairnoon` is in band with 0.0073 of live margin and is the pose to watch.

Three observations that outlive whatever this particular run printed:

1. **`check:full` is the only thing in the repository that can fail on a look
   regression**, it is twenty-four browser runs, there is no CI, and it is therefore
   only as good as the lanes that remember to run it. Standing rule 7 makes the whole
   guard a merge requirement; nothing enforces it.
2. **`b.rho` is still unreachable.** WG-304's verifier established that it is read only
   inside `else if (side && side === b.rhoOut)`, and with all four poses at
   `rhoOut: null` that branch cannot execute, so the guard asserts `rho` against the
   BAND and never against the pin. The live margin at `forestairnoon` is
   `0.1873 - 0.18 = 0.0073`. The pins remain an evidence trail rather than an
   assertion, which is worth Admin knowing before the next re-pin is argued about.
3. **`?proppaint=1` still does not render the cards black**, so every guard ratio is
   taken under one convention and absolute levels are not comparable across sections.
   Open since N8, and **this run corrects the figure R5 carried**: the under-count is
   **0.1255 to 0.4001** across the four poses on this build (`forestairnoon` 0.4001,
   `flyovernoon` 0.2834, `flyoverlow` 0.1266, `forestairlow` 0.1255), not the
   "0.13 to 0.32" R5's section 8 quoted. The worst pose is worse by a quarter of the
   rectangle than the record says.

---

## 10. WHAT THIS AUDIT DID NOT MEASURE, SAID OUT LOUD

- **Anything in motion.** Sixth round running.
- **Any body but Forge.** Still no surface of the Moon, and the spine's pre-alpha
  target ends at scanning it.
- **Any quality tier but `high`.** Sixth round running.
- **Absolute frame times.** Captured in every report and judged nowhere; no
  millisecond is quoted as a verdict anywhere in this document.
- **The emissive's actual contribution in counts, at the machine.** **Correction pass
  update:** this is now priced (section 4.4, `?firelight=0` moves `hearthL`,
  `hearthR` and `bandLit` by 35 to 56 per cent), and the ground's share of it is
  proved to be exactly zero via `?firelightground=0`. What remains unpriced is the
  contribution the ground WOULD receive once `uEmitGround` is fixed, which the
  reassigned lane's own "Done when" makes its first deliverable.
- **Thirteen poses taken, not twenty-three.** Not photographed: `vistanoon`,
  `dawnsun`, `forestfloor`, `machine`, `smelterhero`, `ruin`, `ruinwall`, `basedusk`,
  `station`, `voxelface`, `midfield` and the `flyover*` / `forestair*` sun variants.
- **A true repeat pair.** The ladder's noise floor here is taken from an arm pair on a
  rectangle that arm provably cannot reach, which is one query parameter short of a
  repeat. Section 1 states it that way.
- **The night light pool at `meadownight`** (item 15). Seen, not diagnosed, not
  attributed.
- **Whether a reduced aerosol damages `vista` and `limb`.** Rank 4.1's sweep is at
  one pose. The two poses most likely to lose by it are named in its "Done when" and
  were not taken.

---

## 11. FILES

- **Frames:** `docs/screenshots/R6_*.png` (thirteen hero poses, each with its
  `.json` report), `docs/screenshots/R6a_*.png` (ten control arms, each with its
  report), and the crops `R6_meadow_crop_midband.png`, `R6_meadow_crop_cut.png`,
  `R6_mtnslope_crop_patch.png`, `R6_forestair_crop_plate.png`,
  `R6_beach_crop_ripple.png`, `R6_beach_crop_ripple_relief0.png`.
- **Poses added:** none. Rank 4.5 asks for one and does not take it.
- **Instruments added:** `web/tools/smoke/rn2685shots.mjs` (a named shot set at one
  arm, dispatch parsed from `artframe.js`'s manifest and refused rather than guessed,
  JSON kept beside the PNG) and `web/tools/smoke/rn2686bands.mjs` (sweeps
  `rn2664scale.mjs` down a column of equal-height bands by shelling out to it, with a
  cited-line range column). Neither changes a rendered pixel.
- **Instruments used unmodified:** `rn2664scale.mjs`, `rn2510rows.mjs`,
  `rn2450crop.mjs`, `run.mjs`, `writeshot.mjs`, `check-guard.mjs`.
- **Domain memory:** rendering.md section 2.46.
- **Numbers row:** NUMBERS.md, RN-2685. **RN-2685 and RN-2686 USED**;
  **RN-2687 to RN-2699 SURRENDERED UNUSED** (abandoned per rule 4, never reuse).

---

## 12. NEXT LANES, ADOPTED BY ADMIN

The fresh-context verifier that produced the correction pass in section 13 also
re-ranked the dispatch order against what this round actually found, and Admin has
adopted that re-ranking rather than the order section 4 shipped with. Stated here so
the next dispatch reads it rather than re-deriving it.

**The re-ranking.**

1. **The snow slab (section 4.3) first.** Blocked on nothing, sonnet-sized, two
   separable and fully named geometry and material-role changes.
2. **The harvest gap, table-wide (section 4.2) second**, and **Admin rules against
   scaling the four-biome table up to close it**: the node budget that RN-2228 exists
   to protect does not clear a table-wide 6x on the harvest tier, so the lane that
   picks this up should expect a documented-difference outcome (each row's gap stated
   and justified with a number) rather than a table-matching one, pending any later
   reversal of that ruling.
3. **The `uEmitGround` sonnet lane (section 4.4) third.** The diagnosis is finished;
   what remains is finding why one uniform delivers zero on a path that is otherwise
   fully wired, registered and selected.
4. **The plains hero pose (section 4.5) fourth.** A derived camera addition only,
   changes no rendered pixel, and gives the mid-field complaint an instrument for the
   first time in four rounds.
5. **The aerosol (section 4.1) is RE-CLASSED, not ranked fifth as a lane dispatch.**
   Correction pass item 5 established that the measurement brackets the authored
   constant rather than reproducing it to a stated digit, and the term itself is not
   broken at any reading. What is left is a **Reid look-and-value decision** (which
   amplitude to ship, traded against `vista` and `limb`'s far-haze depth cue), not a
   bug for a lane to find. It should be **preceded by a small measurement lane**, not
   the full opus dispatch section 4.1's original draft row asked for, covering exactly
   three things the sweep did not: `vista`'s far mountain silhouette under the same
   amplitudes, `limb`'s vertical column (named as a regression risk in section 4.1 and
   never taken), and `aerosolScaleM`, the "surgical" handle 2.44.10 item 1 named and
   this audit never swept at all. That small lane hands Reid a decision with numbers
   attached rather than asking Reid to guess.

**The pre-Reid consolidation wave, needing no Reid to start:**

- **The SE reference board's own first half needs no Reid.** Freeze this round's
  three hero frames (`flyover`, `forestaircanopy`, `mtnslope` are the ones already
  quoted hardest against the bar) and build the side-by-side page itself with empty
  reference slots, so the day Reid supplies Space Engineers frames the board is a
  drop-in rather than a build. Section 8.3's blocker is the source frames, not the
  page.
- **The one-page Reid decision sheet.** Collect the five items already waiting on
  Reid alone into one page with frames beside each: the coastline ruling (8.1), the
  Polyhaven asset decision (8.4), the crownflank trade (8.5), the crown taste calls
  (8.6), and the aerosol amplitude (this round's rank 1, re-classed above). One sheet
  a decision-maker can go through once rather than five scattered document sections.
- **The guard-instruments hygiene lane**, small and unglamorous, bundling four
  standing instrument defects that have each been carried across multiple rounds
  without a lane: `b.rho`'s unreachable branch (section 9 observation 2), the
  `?proppaint=1` card-black leak that keeps every guard ratio on one un-comparable
  convention (section 9 observation 3), the inert `?firelightground=0` control now
  proved to change nothing on the SHIPPED path for a different reason than assumed
  (it is not that the flag is wired wrong; it is that the ground never received the
  light it is supposed to gate, per section 4.4), and `?iblground=0`'s black mid-field
  (section 5 item 17). None of the four needs Reid; all four are instrument
  reliability, not look decisions.

**Other look lanes are held until Reid reads the decision sheet above.**

---

## 13. CORRECTION PASS (2026-08-23, fresh-context verifier, verdict FIX, applied by mini-lane)

A fresh-context verifier that never touched the drafting of this document reproduced
its own tables to the digit and routed ten corrections. Applied here, doc-only, on
`audit/r6`:

1. **Rank 4 (the emissive) rewritten.** The premise ("is there a light at all") is
   refuted by this document's own committed `R6_smelternight.json` and by
   `EmissiveLight.ts` (RN-2385), a shipped local-irradiance system that explicitly
   rejects point lights on measured numbers, consumed by the terrain through
   `uEmitGround`. The real finding, now in section 4.4: the term is live, registered
   and reaches 40 m, and `?firelightground=0` is bit-identical to shipped at every
   rectangle, so the ground's own tap on it returns exactly zero. Reclassed from an
   opus diagnosis (class b) to a one-file sonnet lane (class a).
2. **Rank 2 (the harvest gap) widened to all four vegetated biomes.** The 6.0 ratio
   holds at Plains, Forest, Hills and Mountains alike; the hero picture for this rank,
   `forestaircanopy`, is itself a Forest pose, so section 4.2 now uses Forest's own
   numbers beside the picture instead of Plains' borrowed ones, and the Done-when and
   the Admin node-budget question are re-scoped to the whole table. The "one
   correction to R5's own account" language is softened to a sharpening, since
   world-gen.md 6.13.11 item 5(b) already named the `x6` comment's true referent.
3. **Section 3.1's three-arm table's 32 px `?aerosol=0` cell corrected** from
   7.073 (+215.7%) to **7.082 (+214.4%)**; the printed figure belonged to section
   4.1's sweep table (a different rect) and did not arithmetically match this table's
   own baseline. The matching figure in rendering.md's mirror of this table is
   corrected the same way.
4. **Section 3.5's band table's rectangle, previously unstated, is now given**
   (`x560 w900`, the tooling's own default), with the verifier's own reproduction on
   that rect (34.364/35.125 at s=1, 20.546/20.546 at s=16) recorded beside it as
   rect-sensitivity evidence rather than as a value correction.
5. **The aerosol constant's "reproduces to three per cent" claim softened** to
   "brackets the authored constant across any reasonable effective range": the 8 km
   effective range was chosen, not derived, and row-weighting the same band gives
   1.58e-4 instead of 1.44e-4. The underlying conclusion, that the term is correct and
   no lane should hunt a bug, is unchanged by this softening.
6. **The `build_props_mountains.py` "held still" citation in rank 3 fixed.** The
   docstring's own held-still clause is attached to `snow_patch` itself, licensing a
   ROCKS lane to leave snow untouched; it does not bar the SNOW lane from moving its
   own bytes, which is precisely this rank's job. The first draft had the direction of
   the rule backwards.
7. **The carpet-cut "ruler-straight" claim labelled struck in this document**, in
   section 4.5, matching NUMBERS.md's existing record so all three records (this
   document, rendering.md, NUMBERS.md) agree.
8. **Section 4's ranking criterion restated as actionability**, not raw eye-loss, on
   the document's own section 5 item 7 conceding that FIDELITY-GAP items 1 and 2 are
   larger by eye than three of the ranked five and are excluded only because they are
   blocked on a licensing decision no lane can act on.
9. **Section 7's "tone half of the tier join shrinking" softened** to match section
   3.4's own non-monotone finding: R5's 30.19 is excluded as non-reproducing, and
   between the two trustworthy points the step is growing (17.33 to 20.65), not
   shrinking.
10. **Section 12 added**, carrying the verifier's re-ranking (snow first, harvest
    table-wide second under Admin's ruling against scaling the table, the
    `uEmitGround` lane third, the plains pose fourth, the aerosol re-classed as a
    Reid decision preceded by a small measurement lane) and the pre-Reid
    consolidation wave, both adopted by Admin.

No source file under `web/src/` was touched by this pass. No frame was retaken. No
number outside the ten items above was altered.
