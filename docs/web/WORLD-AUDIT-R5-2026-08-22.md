# THE WORLD LOOK AUDIT, ROUND 5, 2026-08-22

> **Lane:** `audit/r5` · **Numbers:** RN-2620 to RN-2626 of the RN-2620 to
> RN-2634 block · **Base:** `origin/main` at `e670c637` · **Owner:**
> rendering-controller
>
> The fifth judgement of the world against the D-020 Space Engineers bar, and
> the first taken on a baseline rebuilt by fourteen merged lanes since R4. R4's
> own top five is re-judged here rather than inherited. Section 3 is the ranked
> five with their evidence, seams and draft rows; section 6 is what the week
> closed; section 7 is what needs Reid rather than a lane.

---

## 0. THE ONE-PARAGRAPH ANSWER

**The week did what it said, the instruments prove it, and the eye says the
frontier has moved off the crown entirely and onto WHERE THE TREES ARE NOT.**
Five lanes spent themselves on the crown's colour and shading normal and every
one of them reproduces: `?crownnormal=0` returns `forestaircanopy.box` to
**82.91**, the exact figure this audit was briefed with, while merged main reads
**79.89**; `?horizonswell=0` returns `meadow.hzBand` iqr from **155.55 to
4.21**, WG-275's own OFF-arm value, which retires R4's rank-1 headline number
(4.06) as an OFF-arm reading rather than a standing defect. (RN-2475 already
retired that same rectangle a day earlier, 2026-08-21, for the stronger reason:
`meadow.hzBand`, rows 270 to 306, contains no terrain at all against a horizon
measured at rows 317 to 325, proven with a painted-arm run; and per WG-277's own
record the 155.83-level reading this section quotes as 155.55 is not WG-275's
swell alone, it is the swell TOGETHER WITH WG-260's mid-distance tree stands
supplying the silhouette that makes the lifted ground read as anything, so both
lanes are co-factors, not one lane and a corroboration; see the correction note.)
`vista` is
**174.53 / 14.48** and `vista.hzBand` **3.28 / −2.07**, bit-identical to R4
through fourteen merges. **And the aerial frames are unchanged to the eye,
because the defect was never the crown.** Measured for the first time here:
`flyover` instances reach **3,427 m** against a **37,947 m** horizon, **9.2 per
cent** of the visible ground depth; `forestaircanopy` reaches **1,400 m** of a
690-to-8,485 m band, which computed the same way as flyover's figure (reach
over the full horizon distance, not reach-beyond-690m over the band-beyond-690m)
is **16.5 per cent**, not the "about nine per cent at both poses" this section
first claimed by comparing two different denominators (section 3.1 states both
numbers honestly now). The far treeline paint that is supposed to carry the rest
of the depth moves the rows this ladder actually sampled, **3.4 to 15.5 km**
(corrected from "4 km to 20 km"; nothing above 15.5 km, out to the 37,947 m
horizon, was ever sampled by this ladder), by under one count outside a
three-row ring, EXCEPT two rows inside that span, 399 and 509, which move 4.28
and 2.33 counts and are not "under one count" (both were dropped from the
original table; both are restored below). Separately, and this is a different
claim, the paint is LIVE by pixel count on 86 to 99 per cent of aerial terrain
pixels (rendering.md 2.36.3): a depth fraction and a pixel fraction are two
different measurements, and the eye reading the treeless wash above the
treeline arc as about a quarter of the whole picture matches the pixel share,
not the depth share. **The second finding is a new pose's, and it is a
contradiction the project built this week without seeing it.** `beachground`
stands on Beach ground for the first time in the project's history, and
`?beachcanopy=0` leaves its near field **bit-identical** (`box` 151.17 / 62.83
/ 54.82 and `ring` 124.78 / 59.75 / 46.37 to the digit, on both arms) while
collapsing `hzTree` iqr **87.50 to 10.20**. Every tree WG-285 gave the beach
stands beyond the eye's own horizon, because `TREE_DENSITY_KM2[Beach]` is still
**0** ("the desert stays the desert ... no trees ever") and owns everything a
standing player can resolve. **The third is that the aerial frame's "shallow
water" read is a terrain-palette effect and not a vegetation one at all:** at
`forestair`, 260 px apart on one row, the dry-Ocean plate and the Beach cream
differ by **14.63 counts of warm at 5.06 counts of luma** (a pure chroma
boundary across 47 per cent of the planet, which no canopy term can reach).
Nothing in the top five needs WebGPU or a native client. `check:guard` exits
**0**.

---

## 1. METHOD, AND WHAT IT IS AND IS NOT EVIDENCE FOR

**Capture.** Real Windows D3D11 through ANGLE (Chrome, RTX 4060 Ti), 1600x900,
HUD-free through `of.screenshot()`, served from a `vite preview` this lane owned
on `127.0.0.1:5946` (and later `:5947`), `--strictPort`, `--host 127.0.0.1`,
from this worktree's own `dist`.

**Server ownership is a claim with a lifetime, and it was proved on CONTENT.**
`tools/smoke/rn2560sentinel.mjs` checks three things at once and this lane ran
it before every batch: a per-build random token fetched back **over the wire**
(never a status code: `vite preview` answers 200 for any missing path,
NUMBERS.md's SPA-fallback entry), the served `index-*.js` name against the file
on disk, and the port's owning PID against the PID this lane started. Both
servers returned `match=true bundleOk=true ownerOk=true`, PIDs **27740** and
**29828**, and both were killed by PID after confirming the port's owner was
mine.

**The build is HEAD's, proved rather than self-reported.** `git show
HEAD:web/wasm/dist/of-core.wasm` against the served wasm: **identical**.
`client expects 27` in the bundle against `OF_ABI_VERSION = 27` at
`src/sim/wasm/OfCore.ts:134`. Built with `npm run build`, so `sync-wasm` and
`sync-assets` both ran.

**THE `+dirty` STAMP WAS MET AND CROSS-CHECKED RATHER THAN IGNORED.** Adding a
pose to `artframe.js` makes it a modified tracked file under `web/`, so the
rebuild after it stamps `+dirty` and the entry chunk's hash changes
(`index-DwCmLVCk.js` to `index-B-tPqCWd.js`) with no rendering source touched:
NUMBERS.md's own entry. Rather than pool two builds silently, `meadowfield` was
re-taken on the second build: **box 102.15 / 56.42, identical to the digit** to
its own reading on the first. The two builds are therefore behaviourally the
same and the stamp is the whole difference. Every arm PAIR in this document is
nonetheless taken **within one build**, and the two rows that come from the
second build (section 3.5) say so.

**This is a one-arm audit of current `main`, so most numbers are a LEVEL.**
Eleven cross-arm readings are made; each is a one-flag negative control in a
fresh process against the same build. Section 5 lists all of them.

**Frames illustrate; the numbers beside them are the evidence. The eye is the
verdict** (FIDELITY-GAP section 3, Option D).

**Every shot came back `valid: true` and `postState.post === true`.** The new
pose publishes `setup.upCheck 0.000`, `converged: true`, `biome: 1` and sun
`err 0.0002` against a 0.05 tolerance, and **three fresh-process repeats of it
returned box 151.17 / 62.83 to the digit**, which is this document's
determinism proof for its one new pose.

**RANGE CLAIMS ARE SOLVED AND THEN PROVEN, NEVER READ OFF `rangeRects`.** Every
range in this document comes from the curvature-correct eye-frame inversion
2.37 derived (depression `s/(2R) + h/s`, horizon dip `sqrt(2h/R)`, rows through
`of.look`'s own `pitch - atan(v tan 30)` convention) and is then read back with
a **centre-column** ladder at `x [795, 805)` through the committed
`tools/smoke/rn2510rows.mjs`. That is 2.32.11's correction applied on purpose: a
wide-x row mean SMEARS a rung and misplaced the 170 m boundary by ten rows the
one time it was used. Where the prediction and the ladder disagree this document
says so; they agree twice to within one row and once to 0.4 of a row.

**ONE POSE ADDED, AND ITS RECTANGLES WERE CHANGED BY THEIR OWN LADDER.** Section
3.2 has `beachground`'s derivation. Its first placement put one rectangle across
both the empty beach and a distant Forest edge; the ladder found the boundary
and the rectangle was split before any number was read from it.

---

## 2. THE FRAMES

`docs/screenshots/R5_<shot>.png`. Fourteen poses, with R4's own figures beside
them where R4 photographed the same pose.

| shot | box luma / iqr | R4's box | tris | calls |
|---|---|---|---:|---:|
| `meadow` | 84.39 / 54.98 | 85.12 / 56.36 | n/a | n/a |
| `meadowfield` | 102.15 / 56.42 | 101.54 / 59.95 | n/a | n/a |
| `midfield` (declares `props: false`) | **141.72 / 41.06** | 134.72 / 44.21 | n/a | n/a |
| `vista` | **174.53 / 14.48** | **174.53 / 14.48** | n/a | n/a |
| `vistadawn` | 167.57 / 73.25 | 167.56 / 73.18 | n/a | n/a |
| `mtnslope` | 127.06 / 88.55 | 126.91 / 89.27 | n/a | n/a |
| `pondside` | 108.28 / 45.65 | 104.60 / 45.46 | n/a | n/a |
| `meadownight` | 8.91 / 5.93 | 8.86 / 6.15 | n/a | n/a |
| `smelternight` | 82.82 / 147.97 | 82.73 / 147.87 | n/a | n/a |
| `flyover` | **114.80 / 65.04** | 121.37 / 54.97 | 248,677 | 26 |
| `forestair` | **98.60 / 31.77** | 93.39 / 28.49 | 250,709 | 27 |
| `forestaircanopy` | **79.89 / 61.06** | (pose is post-R4) | 769,108 | 65 |
| `beachground` | **151.17 / 62.83** | (NEW, this audit) | 658,125 | 66 |
| `limb` | 68.26 / 134.87 | 68.10 / 135.51 | n/a | n/a |

**`vista` is bit-identical to R4 through fourteen merged lanes**, box and
`hzBand` both, which is what makes every moved row above readable as a delta
rather than as drift. The four poses that moved most are the two aerials, the
plains mid field and the pond, and sections 3 and 6 attribute each.

---

## 3. THE RANKED FIVE

Ranked by severity first, then by exposure against
[`story_line_outline_v1.txt`](../../story_line_outline_v1.txt). Feasibility:
**(a)** art or tuning inside the current WebGL2/three stack · **(b)** engine work
inside WebGL2 · **(c)** likely needs WebGPU · **(d)** plausibly needs native.

---

### 3.1 RANK 1: THE AERIAL WORLD IS 9 TO 16 PER CENT FOREST BY DEPTH AND THE PAINT IS INERT OVER MOST OF THE REST. **BLOCKING** · class (b)

R4 ranked "the world from the air reads as shallow water with weed beds" third
and pointed three lanes at the crown. **The crowns moved and the frame did not,
because this is a COVERAGE defect and nobody had measured the coverage.**

**(a) THE EYE.** `R5_flyover.png` at 1x, the first-launch view. The forest ends
in a visible arc across the lower quarter of the frame, and everything above it
(a quarter of the whole picture) is a smooth pale olive-cream wash with no tree
texture of any kind, running unbroken to the horizon. That "about a quarter"
is a PIXEL-AREA impression, not the depth fraction below: the ground depth the
instance tier reaches is 9 to 16 per cent of what the eye can see (b.1, b.2),
while the paint the eye reads as a wash is LIVE on 86 to 99 per cent of aerial
terrain pixels (2.36.3, cited again in (c)). Those are two different fractions
of two different things, screen area against ground distance, and this section
keeps them separate rather than trading one for the other. The crop
`R5_crop_flyover_treeedge_2x.png` is that boundary at 2x: stippled crowns below,
nothing above. `R5_forestair.png` shows the same arc from the same altitude at
the Forest site. This is the pose with the highest storyline exposure in the set
and it has now been BEHIND in five consecutive audits.

**(b) THE INSTRUMENT.** Three things, and the third is the conviction.

**1. The instance tier's reach, measured, against its own readback.** The
centre-column ladder on `R5_flyover.png` puts a **−43.58-count cliff between
rows 529 and 539** (134.21 to 90.63), which is where crowns begin. The
curvature-correct inversion at that pose (h = 1,200 m, pitch −14) makes row 535
**3,427 m**, against the probe's own `treeline.reachM` readback of **3,500**.
The same pose's horizon is `sqrt(2Rh)` = **37,947 m**. So instances occupy
**3,500 of 37,947 m, 9.2 per cent of the visible ground depth.**

**2. The same arithmetic at the ground-adjacent pose, and it does NOT land on
the same fraction.** At `forestaircanopy` the readback is `reachM` **1,400**. A
12 m crown at 1,400 m projects to **row 443.6** by the same inversion; the
ladder's first instance contribution is at **row 444**. That pose's `box` spans
690 m (row 484.2) to its 8,485 m horizon (row 427.0, ladder-measured at 428), so
instances cover 710 m of the 7,795 m band BEYOND 690 m: **9.1 per cent of that
band.** That is not the same measurement as point 1's 9.2 per cent: point 1
divides flyover's total reach by its total horizon (0-to-horizon); this divides
forestaircanopy's reach-beyond-690m by the band-beyond-690m. Computed point 1's
way, reach over the FULL 0-to-horizon depth, `forestaircanopy` is **1,400 of
8,485 m, 16.5 per cent**, not 9.1. Both numbers are real and both are stated;
neither corroborates the other, and an earlier reading of this pair as "the same
fraction twice from different altitudes" was a denominator-switching artifact,
not a finding.

**3. `?treeline=0` says the paint does almost nothing over most of the depth
this ladder actually sampled.** Centre-column, shipped minus arm, at `flyover`.
Ranges are the curvature-correct eye-frame inversion (depression `s/(2R) + h/s`
radians at range `s`, horizon dip `sqrt(2h/R)`, row from depression via
`of.look`'s `pitch - atan(v tan 30)` convention, `v = 1 - 2*row/900`), at this
pose's own h = 1,200 m and pitch = -14; the correction note derives it and shows
it reproducing the pose's own committed horizon (37,947 m) and reach (3,427 m
at row 535) before it is trusted here:

| rows | range | shipped minus `?treeline=0` |
|---|---|---:|
| 329 - 399 | 15.5 km - 6.9 km | 0.00, +0.07, -0.21, +0.03, -0.65, -0.19, -1.57, **-4.28** |
| 409 - 509 | 6.4 km - 3.8 km | -0.21, -0.16, -0.76, -0.06, +0.01, -4.24, -1.23, -0.12, +0.05, +0.68, **-2.33** |
| 519 - 539 | 3.6 km - 3.4 km | **-7.01, -8.22, -14.65** |

**Corrected from a first printing of this table that labelled the top row "38
km" and the middle row "~20 km": those were roughly 2.5x and 3x too far out.**
The true span this ladder sampled is **3.4 to 15.5 km**; nothing between 15.5 km
and the 37,947 m horizon was ever measured this way, and no claim in this
document about that upper band rests on a row reading. **Two rows inside the
"under one count" span are not under one count and were dropped from the first
printing of this table: row 399 moves -4.28 and row 509 moves -2.33**, both
restored above. Outside those two rows and the three-row ring at 519-539, the
term is worth a few tenths of a count across 3.4 to 15.5 km. On the box
rectangles the same reading: `flyover` 114.80 / 65.04 -> 116.65 / 62.06,
`forestair` 98.60 / 31.77 -> 99.43 / 30.06.

**4. And the three-arm separation at the pose built to see the band.** Shipped
79.89 / 61.06, `?treeline=0` 78.99 / 56.61, `?canopy=0` 94.09 / 31.83. So on
`forestaircanopy`'s own band the **instances carry 24.78 counts of contrast and
the paint carries 4.45** (the paint is 15 per cent of the canopy's contribution
to the one band it exists for).

**5. The paint carries neither colour nor structure over the sampled band, and
it is locally destructive at one point in it.** The shipped arm's own row-to-row
iqr never exceeds 3.9 counts anywhere across rows 329-509: the term is not
painting anything the eye could read as texture, it is close to a flat wash, and
`dIQR` (shipped iqr minus `?treeline=0` iqr) stays near zero across that whole
span. At row 539, inside the one ring where the term does move luma, the
shipped arm has **15.47 counts LESS iqr than `?treeline=0`**: turning the paint
OFF there increases local contrast. So `TREELINE_AMP`, the term's own amplitude,
is not the lever a fix should reach for first; the MOTTLE term is, because no
amplitude can manufacture structure that already reads flatter WITH the paint
on than without it.

**6. The truncation is real and it is this lane's own readback, not a citation.**
`chunksCapped` is **4** at `forestair` and **1** at `flyover` (0 at both
ground-adjacent poses). `MAX_PER_CHUNK` is 14,000 (`ScatterTuning.ts:72`) against
a depth-8 chunk asking about 312,000, so the far canopy is truncated before any
of this. That caps how far the instance tier could reach even if its range gate
were opened.

**HONEST LIMIT.** The "under one count" rows are in the size range NUMBERS.md's
once-in-nine correlated capture artifact occupies (~0.01 counts). That artifact
can manufacture a spurious small NON-zero; it cannot manufacture a null, so the
inert reading is safe in the direction it is used. The 8-to-15-count ring is far
outside it.

**(c) THE FILE SEAM.** `web/src/render/materials/TerrainTreeline.glsl.ts` (the
paint's amplitude and its range falloff: the term is LIVE on 86 to 99 per cent
of aerial terrain pixels by 2.36.3 and this audit prices what it does with that
liveness), plus `TREELINE_AMP`/`TREE_SIN_MIN` and the `?treelineamp=` /
`?treelinemottle=` parameters already registered in `run.mjs:248`. The same file
also carries a fourth, already-diagnosed and already-priced candidate: RN-2560's
`#ifndef OF_SCALED` gate and its committed default-off `?treelinefar=1` flag
(`TerrainTreeline.glsl.ts:134-155`), which extends the term's reach past
roughly 15 km; rendering.md 2.36.5 priced flipping it at **0.11 counts** at the
loudest rectangle in any pose (`flyover.hzBand`). It is cheap, not free, and
turning it on makes the term live on a band no probe has measured, which
2.36.11 already routes as a visual decision rather than a diagnosis-lane flip.
The coverage half is `web/src/world/ScatterTuning.ts`'s `MAX_PER_CHUNK` and
`canopyDistanceWeight`/`reachM`. **These are two different owners and the lane
should be told which half it is taking:** the paint's amplitude and the
`OF_SCALED` gate are rendering's and need no world-gen change; `MAX_PER_CHUNK`
is world-gen's and moves instance counts at every pose.

**(d) DRAFT ALLOCATION ROW.**

> `RN-26xx to RN-26yy` | rendering, **THE AERIAL WORLD IS 9 TO 16 PER CENT
> FOREST BY DEPTH** (opus, diagnosis first): tree instances cover 3,500 m of a
> 37,947 m horizon at `flyover` (9.2 per cent of visible ground depth) and
> 1,400 m of a 690-to-8,485 m band at `forestaircanopy`, which is **16.5 per
> cent** computed the same way (reach over full horizon), not the "9.1, same
> fraction twice" this brief first carried; the two poses do not corroborate
> each other and both numbers are stated. Measured by centre-column ladder
> against each pose's own `treeline.reachM` readback, `?treeline=0` moves the
> rows this ladder actually sampled, **3.4 to 15.5 km** (not "4 km to 20 km";
> nothing above 15.5 km out to the 37,947 m horizon was ever sampled), by
> **under one count** outside a three-row ring where it spends -7.01 / -8.22 /
> -14.65, EXCEPT rows 399 and 509 (-4.28, -2.33), which are not under one count
> either. The far treeline paint is LIVE (2.36.3: 86.10 / 99.20 per cent of
> terrain pixels) and effectively INERT over depth, which is why five crown
> lanes moved no aerial frame; it also carries no STRUCTURE where it does move
> luma (shipped iqr never exceeds 3.9 counts across rows 329-509, dIQR ~0
> throughout, and at row 539 the shipped arm has 15.47 counts LESS iqr than
> `?treeline=0`, i.e. it is locally destructive there), which is why this brief
> weighs the MOTTLE term over `TREELINE_AMP` as the likely lever. **First
> deliverable is a diagnosis, not an amplitude bump:** find whether the falloff
> is a range term, the `TREE_SIN_MIN` floor (2.36.11's own owed item says it
> binds from ~27,766 m), or the mottle's own scale, and PAINT it (RN-2479's
> rule, colours under 0.25 for the ACES toe) rather than sweeping it. **A fourth
> candidate is already diagnosed and priced and should be picked up or
> explicitly declined here, not re-discovered:** RN-2560's `#ifndef OF_SCALED`
> gate and its committed default-off `?treelinefar=1` flag
> (`TerrainTreeline.glsl.ts:134-155`) extend the term past ~15 km at a priced
> cost of **0.11 counts** at the loudest rectangle (rendering.md 2.36.5); it is
> cheap but not free, and flipping it makes the term live on a band no probe has
> measured, which this lane should route rather than take unilaterally. **Owns:**
> `render/materials/TerrainTreeline.glsl.ts` and its registered page params.
> **Must not touch:** `ScatterTuning.ts` (`MAX_PER_CHUNK` and the reach ladder
> are world-gen's and are a SEPARATE decision), `CrownNormal.ts`/
> `CanopySelfShadow.ts` (RN-2605's), any palette. **Done when:** a stated
> fraction of the 3.4-to-15.5 km band carries visible structure by eye at 1x in
> a before/after pair at `flyover`; the centre-column `?treeline=0` delta over
> those rows (rows 399 and 509 re-measured, not re-dropped) clears a stated
> multiple of today's <1 count; `forestaircanopy`'s paint share rises off 4.45
> of 29.23; `rn2550guard` exit 0 with no ceiling raised; `vista`/`mtnslope`
> bit-identical. **Briefable only after this pass's table repair lands** (the
> correction note), because a lane briefed against the wrong band would tune
> the wrong rows. Opus: the term is live, the zero is not a wiring fault, and
> the question is which of three constants, or the mottle, owns the falloff.

---

### 3.2 RANK 2: ON A BEACH, A TREELESS DISC FOLLOWS THE PLAYER, AND THE NEAR FIELD IS BIT-IDENTICAL WITH THE BIOME'S OWN CANOPY TABLE ON OR OFF. **BLOCKING** · class (a)

WG-285 gave Beach a canopy table this week and wrote its own owed item in as
many words: *no pose in the shot set stands ON Beach ground, so the near-field
look of these new trees is unmeasured.* **This audit added that pose, and the
trees are not there.**

**(a) THE EYE.** `R5_beachground.png` against
`R5_beachground_beachcanopy0.png`, and the pair is the strongest in this
document. Shipped: pale sand with dry scrub and flat pebbles from the feet to
the horizon, **not one tree anywhere in the near or mid field**, and a
continuous tree wall standing along the horizon line. With `?beachcanopy=0`:
the wall is gone and the world is bare sand to a razor horizon, with the real
Forest surviving as a small green sliver at the far left. The 3x crops
`R5_crop_beach_ring_3x.png` and `R5_crop_beach_ring_canopy0_3x.png` are the
same 500x90 rectangle either side of the flag. So the entire visible effect of
the biome's canopy is a band at the limit of sight, and the ground the player
actually walks on is unchanged by it.

**(b) THE INSTRUMENT.** `?beachcanopy=0`, one flag, fresh process, same build:

| rectangle | what it frames | shipped | `?beachcanopy=0` |
|---|---|---|---|
| `box` | 30 m to 8 m, the near beach substrate | **151.17 / 62.83 / +54.82** | **151.17 / 62.83 / +54.82** |
| `ring` | 170 m to 30 m, the harvest ring's own ground | **124.78 / 59.75 / +46.37** | **124.78 / 59.75 / +46.37** |
| `standHi` | rows 292-332, only a tree ON this beach can reach it | 166.28 / 14.04 / +2.34 | 175.04 / 12.11 / +0.66 |
| `hzTree` | rows 332-348 (16 rows): the far wall above the row-343 measured horizon, plus 5 rows (344-348) of actual ground below that horizon | 113.54 / **87.50** / +24.61 | 152.93 / **10.20** / +23.02 |
| `skyHz` | sky above the horizon | 181.59 / 6.81 | 181.58 / 6.81 |

**`box` and `ring` are bit-identical on both arms, luma, iqr and warm.** That is
not a small delta to be argued about; it is the same number. Meanwhile `hzTree`'s
contrast collapses **87.50 to 10.20** and its luma falls 39.39 counts, so the
wall IS the beach canopy and it is entirely outside 170 m. `standHi` moves 8.76
counts, i.e. a scattering of crowns pokes above the horizon plane and no more.
`skyHz`'s 0.01 is WG-277's documented arm-independent sky dither.

**Props were left ON, disclosed rather than assumed.** `beachground`'s own
manifest entry in `artframe.js` declares no `props` field, so it takes the
branch's own default (`(A.props ?? S.props) === false` gates props off only
when the field is explicitly `false`): props are left ON here, the same as
`meadow`. This is unlike `midfield`, which declares `props: false` explicitly
(see 3.4 and section 6), so a reader comparing this pose against `midfield`
should not assume the two share a props state.

**The cause is two tables that disagree about one biome.**
`web/src/game/TreeTuning.ts:115` sets `TREE_DENSITY_KM2[Beach] = 0` with the
ruling written beside it: *"the desert stays the desert"*, and above it *"bare
pale sand and dry scrub, no trees ever"*. That table owns the harvest ring out
to `RADIUS_M` 170 m. WG-285's `Registry.CANOPY_BEACH` (mu 0.126062) owns the
canopy tier, which reaches full weight at `CANOPY_NEAR_FULL_M` **690 m**. Nothing
fills the gap between them on this biome, and the arm above is what that looks
like from inside the disc.

**The pose is certified rather than asserted.** `setup` publishes
`teleported: true`, `converged: true`, `biome: 1` (Beach), `eyeAltM 1.62`,
`upCheck 0`, sun `err 0.0002` against tol 0.05; **three fresh-process repeats
returned box 151.17 / 62.83 to the digit**. The site is surveyed, not guessed:
`tools/smoke/wg285field.ts` at these coordinates reports designed ground
**12.6 m** and, over a 3 km plan, **73.6 per cent Beach / 26.2 per cent Forest /
0.2 per cent Ocean**; the yaw is solved from transects on the eight principal
bearings (unbroken Beach run **500 m** east, **2,250 m** west, **4,250 m**
south), and 180 was taken because it is the widest, so the Forest boundary sits
past the eye's own 1,394 m horizon and cannot enter a rectangle. The rectangles
are solved from the curvature-correct inversion and then **changed by their own
ladder**: the horizon predicted at row 342.3 measured at **343**, rows 286–331
came back smooth sky, and a hard wall at rows 332–343 (dLuma −10.58, −16.26,
−12.68, **−26.16**, −17.14) forced the original single band to be split into
`standHi` and `hzTree` before any number was read from it.

**(c) THE FILE SEAM.** `web/src/game/TreeTuning.ts`'s `TREE_DENSITY_KM2` Beach
row, and `web/src/world/ScatterTuning.ts`'s `midDistanceWeight` deficit (which
fills 170 to 690 m elsewhere and places nothing here). **This is a design
question before it is a code change**; see section 7.4, because the two tables
encode two different intentions about what a beach IS and a lane cannot pick.

**(d) DRAFT ALLOCATION ROW.**

> `RN-26xx to RN-26yy` | rendering/world-gen, **THE BEACH'S TREELESS DISC**
> (sonnet, after Reid's ruling in section 7.4): `?beachcanopy=0` leaves
> `beachground.box` (151.17 / 62.83 / +54.82) and `.ring` (124.78 / 59.75 /
> +46.37) **bit-identical** while collapsing `.hzTree` iqr 87.50 to 10.20, so
> every tree WG-285 gave the beach stands past the eye's 1,394 m horizon;
> `TREE_DENSITY_KM2[Beach] = 0` (TreeTuning.ts:115, "no trees ever") owns 0 to
> 170 m and `CANOPY_BEACH` owns 690 m out, and the mid tier places nothing
> between. **Whichever way Reid rules, the fix is to make ONE table's intention
> true at every range**, not to tune a density: if the beach is a desert, WG-285's
> canopy comes back off and `forestair`'s stage-1 band is closed another way; if
> it is a shore, `TREE_DENSITY_KM2[Beach]` and the mid tier's deficit follow the
> canopy table. **Owns:** `game/TreeTuning.ts`'s Beach row, `world/ScatterTuning.ts`'s
> `midDistanceWeight` Beach path. **Must not touch:** any other biome's density
> row, `Registry.CANOPY_*` for non-Beach biomes, the terrain palette (rank 3's).
> **Done when:** `beachground.ring` stops being bit-identical under
> `?beachcanopy=0` in the "shore" branch, or `hzTree` stops moving in the
> "desert" branch; the disc is gone by eye at 1x in a before/after pair;
> `forestair`'s stage-1 share does not regress past WG-285's 1.70 per cent;
> `meadow`/`meadowfield`/`vista` bit-identical. Sonnet: the measurement is exact
> and the only judgement in it is Reid's.

---

### 3.3 RANK 3: THE DRY SEA IS A 14.63-COUNT CHROMA BOUNDARY AT CONSTANT LUMA, AND THAT IS WHAT READS AS WATER. **BLOCKING** · class (a)

**This is R4's rank 3 re-diagnosed.** Four audits have written "the world from
the air reads as shallow tropical water with weed beds" and five lanes have been
spent on crown colour. The frame still reads that way, and the reason is in the
TERRAIN palette.

**(a) THE EYE.** `R5_crop_forestair_drysea_2x.png` and the tighter
`R5_crop_forestair_plate_4x.png`. A large mauve-grey plate lies in the middle
distance, ringed by a pale cream shore, on olive-green forested ground. It reads
as a lake with a sand beach photographed from a light aircraft: flat matte,
no specular, no reflection, no shore detail. It is the dry Ocean class painted
the colour of deep water and the dry Beach class painted the colour of sand,
and Forge has no sea at all, so this is a lake that is not there.

**(b) THE INSTRUMENT, AND IT CORRECTS MY OWN FIRST READING.** The plate is **not
literally violet in its pixels.** Sampled at row 372 of `R5_forestair.png`, two
windows 260 px apart on the same row:

| patch | r | b | **warm (r−b)** | luma |
|---|---:|---:|---:|---:|
| dry-Ocean plate, x [1170, 1210) | 164.55 | 151.00 | **+13.55** | 157.81 |
| Beach cream, x [1430, 1480) | 172.00 | 143.82 | **+28.18** | 162.87 |

**A 14.63-count step in warm across 5.06 counts of luma.** So the "violet" is
simultaneous contrast: a low-warm grey patch embedded in a high-warm cream field
is read by the eye as blue, and a desaturated cool patch surrounded by warm sand
is precisely the signature of water seen from the air. **That matters for the
fix**: no single albedo constant is "wrong", the RELATIONSHIP between two
terrain classes is, and a lane sent to change `0x14406e` alone would move the
plate and leave the boundary.

The surround confirms the scale: `forestair.hzBand` warm **+28.78** against
`skyBand` **−49.30**, so the far ground as a whole is strongly warm and the
plate sits less than half as warm inside it. And the class is not a corner case:
WG-285's own planet census is **Ocean 44.43 per cent + Beach 2.54 per cent =
46.97 per cent of Forge**. The constants are
`web/src/render/materials/BiomePalette.ts:106` (Beach `0xb3a184`) and the Ocean
row beside it (`0x14406e`).

**(c) THE FILE SEAM.** `web/src/render/materials/BiomePalette.ts`, the Ocean and
Beach rows only. **This is rendering's**; world-gen routed it explicitly
(6.15.3 item 3: *"the Beach terrain albedo is rendering's, and while the class
stays kilometres wide it carries more of the band's read than any vegetation
term can"*). It is blocked behind section 7.1's water ruling only for the
question of whether Ocean should become water; the warm relationship between the
two DRY classes can be fixed without waiting.

**(d) DRAFT ALLOCATION ROW.**

> `RN-26xx to RN-26yy` | rendering, **THE DRY SEA'S CHROMA BOUNDARY** (sonnet):
> at `forestair` row 372, 260 px apart, the dry-Ocean plate reads warm **+13.55**
> at luma 157.81 and the Beach cream **+28.18** at 162.87 (a 14.63-count hue
> step at constant brightness) across 47 per cent of the planet (Ocean 44.43 +
> Beach 2.54 per cent), and it is what makes the first-launch frame read as
> shallow water. The defect is the RELATIONSHIP, not one constant: bring the two
> dry classes into one hue family so the boundary stops reading as a shoreline,
> WITHOUT flattening them into one colour (the biome must still be legible from
> the air). **Owns:** `render/materials/BiomePalette.ts`, the Ocean and Beach
> rows only. **Must not touch:** any canopy or foliage term (five lanes have
> already proved they cannot reach this), `Atmosphere*`, the horizon rung.
> **Done when:** the plate-to-cream warm step at `forestair` falls to a stated
> fraction of 14.63 with both patches' luma held inside a stated band; the frame
> no longer reads as water by eye at 1x against the SE board (section 7.2);
> `pondside`'s REAL water is untouched and still reads as water;
> `meadow`/`vista`/`mtnslope` inside stated bands. Sonnet: two palette rows and a
> measured target.

---

### 3.4 RANK 4: WHERE THE TWO TREE TIERS MEET THEY DO NOT MATCH, IN TONE OR IN DENSITY. **CLEARLY BEHIND** · class (a) for the density, (b) for the tone

Rank 1 is about how much ground the tiers cover. This is about what happens at
the one place they touch.

**(a) THE EYE.** `R5_forestaircanopy.png` at 1x and
`R5_crop_faircanopy_wall_3x.png` at 3x. The near trees are bright, individually
modelled, warm green, with visible trunks and long shadows, scattered sparsely.
Behind them, beginning abruptly, is a dense near-black slate band of impostors.
They do not read as the same forest at two distances; they read as two different
materials meeting at a line. The same seam is what makes the horizon of every
ground pose (`R5_meadow.png`, `R5_meadowfield.png`, `R5_beachground.png`) a row
of flat cut-outs.

**(b) THE INSTRUMENT.** The centre-column ladder at `forestaircanopy`, three
arms, one build, differenced row by row.

**1. The tiers abut; they do not blend.** Over rows 429-443 the `?treeline=0`
and `?canopy=0` arms are **the same numbers to the digit** (149.08, 145.01,
140.95, 133.58, 127.74, 123.77, 118.63, 115.66, 113.04, 107.70, 106.05, 102.52,
98.36, 97.83, 95.72): zero instance contribution. Over rows **477-491** the
shipped and `?treeline=0` arms are the same to within 0.02: zero paint
contribution, because the instance mass is drawn over it. The two tiers own
disjoint row ranges with a fifteen-row seam between them where both are weak.

**2. The tone step across that seam.** Instances darken rows 460-490 by -18 to
-40 counts against bare ground (row 484: 35.77 shipped against 64.02 under
`?canopy=0`; row 490: 34.10 against 65.51), and the wall's own leading edge
falls **65.85 to 35.66 across five rows** (rows 457-462), a -30.19-count cliff
with no gradient (a prior printing of this section said "four rows,
457-461"; the span the delta is measured over is five rows, and 30.19 is the
number that belongs to five, not to four, over which it would read 29.65).

**3. The density step is a documented arithmetic error nobody has repaired.**
`TREE_DENSITY_KM2` Plains is **420** (`TreeTuning.ts:116`) against the canopy
tier's **2,520** at the same biome (`ScatterTuning.ts:846`), a **six-fold step
at the 550 m seam**, because WG-222 multiplied the canopy table by six and the
harvest table, copied from the pre-WG-222 asks, was not multiplied with it. The
inline comment beside 420 already reads `x6`, referring to an EARLIER multiply,
so a reader checking it concludes it is current. RN-2228's standing claim that
total tree density is about constant across the seam **has been false since
WG-222 landed.** Confirmed in this tree at both sites.

**(c) THE FILE SEAM.** `web/src/game/TreeTuning.ts`'s `TREE_DENSITY_KM2` (the
density step and its misleading comment) and
`web/src/render/materials/CanopySelfShadow.ts` plus `CrownNormal.ts` (the tone).
**The tone half collides with RN-2605**, which owns the crown's shading normal
and is live: this lane must be sequenced AFTER it and take the density half
first, because RN-2605 changes what the right shade is.

**(d) DRAFT ALLOCATION ROW.**

> `RN-26xx to RN-26yy` | world-gen/rendering, **THE TIER SEAM: A SIX-FOLD DENSITY
> STEP AND A 30-COUNT TONE CLIFF** (sonnet for the density, opus if the tone is
> taken with it; **sequence AFTER RN-2605**): at `forestaircanopy` the two tree
> tiers own disjoint row ranges (rows 429-443 have zero instance contribution,
> `?treeline=0` equals `?canopy=0` to the digit, and rows 477-491 have zero paint
> contribution, shipped equals `?treeline=0` to 0.02), with a -30.19-count cliff
> across five rows (457-462) at the join; and the density either side differs
> six-fold (420 per km2 harvest against 2,520 canopy at Plains) because WG-222's
> x6 never reached `TREE_DENSITY_KM2`. **Take the density first and alone**: it
> is one table, its comment is actively misleading (`x6` refers to a
> pre-WG-222 multiply), and RN-2228's constant-density claim depends on it.
> **Owns:** `game/TreeTuning.ts`. **Must not touch:**
> `CrownNormal.ts`/`CanopySelfShadow.ts` (RN-2605's, live); the tone half is a
> SECOND lane after that one lands. **Done when:** the two
> tables' Plains densities agree or the difference is documented as intentional
> with a number; the 550 m seam's step is measured at `meadowfield` before and
> after; `meadow` stays under the 2.7e6 triangle ALERT; `rn2550guard` exit 0.
> Sonnet: one table, and the arithmetic is already written down.

---

### 3.5 RANK 5: THE GRASS CARPET STILL LIFTS THE GROUND IT STANDS ON, THOUGH BY LESS THAN R4 MEASURED. **CLEARLY BEHIND** · class (a) for the tint, (b) for a real substrate sample

R4's rank 4 was *"the carpet is 1.96x the brightness of the ground it stands on
at 55 m"*, and no lane was pointed at it (N4 built a term and refused it).
**It has improved anyway, and this is the honest re-measure.**

**(a) THE EYE.** `R5_meadowfield.png` and `R5_meadow.png`. The near sward is
dense and reads as grass; that part is genuinely good. What is still wrong is
that the carpet is a uniform pale-green wash laid over a darker ground with no
tonal variation, no dead patches and no dirt showing through, and it terminates
at a visible line beyond which the plain is painted and the treeline is
cut-outs. FIDELITY-GAP section 1.1's complaint is the colour disagreement
between cover and ground, and it is still visible.

**(b) THE INSTRUMENT.** `?grass=0` at `meadowfield`. **Both rows of this table
come from the SECOND build** (section 1's `+dirty` note); the shipped arm was
re-taken on that build and returned box 102.15 / 56.42, identical to the digit
to its first-build reading, so the pair is internally valid and comparable.

| rect | shipped luma / iqr | `?grass=0` luma / iqr | lift | shipped iqr as % of bare |
|---|---|---|---:|---:|
| `r4` | 91.33 / 61.78 | 86.37 / 57.57 | 1.06x | 107% |
| `r10` | 117.21 / 43.01 | 82.85 / 50.00 | 1.41x | 86% |
| `r25` | 139.12 / 39.42 | 82.60 / 48.84 | 1.68x | 81% |
| `r55` | 128.16 / 38.64 | 83.31 / 61.03 | **1.54x** | 63% |
| `r100` | 122.18 / 36.43 | 98.85 / 57.00 | 1.24x | 64% |
| `r250` | 114.51 / 43.85 | 113.44 / 44.77 | 1.01x | 98% |

**The 55 m lift is 1.54x against R4's 1.96x** (a real improvement that no lane
claimed, arriving as a side effect of the plains and horizon work). The carpet is
effectively gone by 250 m (1.01x). **Two things are honestly worse**: the
shipped contrast at `r55` is 63 per cent of the bare ceiling against R4's 71,
and at `r100` it is 64 per cent against R4's 145, but **the denominator moved
too** (bare `r100` iqr 41.07 to 57.00), so this is a level comparison across a
merge and NUMBERS.md says not to read it as a delta. What is safe: the lift
fell, and the carpet still lifts the 25-to-55 m band by half again.

**(c) THE FILE SEAM.** `web/src/render/grass/*` and
`web/src/render/materials/TerrainCoverFar*`, with
`TerrainFragAlbedo.glsl.ts`'s near splat blend as a read-only dependency for the
substrate twin M4 owed. Unchanged from R4's N4 partition.

**(d) DRAFT ALLOCATION ROW.**

> `RN-26xx to RN-26yy` | rendering, **THE CARPET'S REMAINING LIFT** (sonnet):
> re-measured on merged main, the carpet's brightness lift over its own bare
> substrate is **1.54x at 55 m** against R4's 1.96x and 1.68x at 25 m, falling to
> 1.01x by 250 m: improved by lanes aimed elsewhere and still half again too
> bright through the band a standing player looks at. M4's owed item 2 names the
> fix: a `terrainAlbedo` twin that samples the noise term the terrain fragment
> shader actually carries, so the cover inherits the ground's real value instead
> of a band-and-slope approximation (FIDELITY-GAP 1.1). **Re-baseline first**: the
> `?grass=0` ceilings have all moved since R4 (r100 41.07 to 57.00) and any target
> stated against R4's numbers is stated against a tree that no longer exists.
> **Owns:** `render/grass/*`, `render/materials/TerrainCoverFar*`. **Must not
> touch:** `TerrainHorizon*`, palettes, `Atmosphere*`. **Done when:** `r55` lift
> falls to a stated fraction of 1.54x with `r55` iqr held at or above 38.0; `r25`
> and `r100` inside stated bands; `meadow`'s near rectangles bit-identical;
> `meadow` under the 2.7e6 ALERT. Sonnet: the lever is measured and the file is
> one M4 already owns.

---

## 4. THE REST OF THE RANKING

Carried, re-judged by eye on this build, not re-derived.

| # | Gap | Today | Class |
|---|---|---|---|
| **6** | **Clouds: flat opacity and a straight hem.** In every frame taken this round the deck is soft single-value blobs with no lit side, no shaded underside and no silver edge, stopping at a dead-straight horizontal line above the horizon. R4 rank 5, unmoved. | CLEARLY BEHIND | (a) |
| **7** | **Water: corrugated, unreflective, polygon foam.** `R5_pondside.png` is still the best-composed frame in the project and its surface is still a regular parallel corrugation reflecting nothing, with hard-edged flat cyan quads for foam on the bar. R4 rank 7, unmoved. Section 7.1. | CLEARLY BEHIND | (a)/(b) |
| **8** | **The far material is one substance.** `vistanoon`/`vista`: no rock against scree against strata, no large-scale occlusion, no shadowed faces. R4 rank 9. | CLEARLY BEHIND | (a)/(b) |
| **9** | **The mountain understorey is mint on cream beside near-black slabs.** `R5_mtnslope.png`, box iqr 88.55. Named in R2, carried by R3 and R4, still untouched. | CLEARLY BEHIND | (a) |
| **10** | **Snow, rock and scree read as paint.** Flat white and, at dawn, flat pale blue polygons with hard straight edges. R4 rank 11. | CLEARLY BEHIND | (a) |
| **11** | **The crown residual, and it is deliberately parked.** `Smeas` 0.0544 crushes the crown's diffuse to a twentieth before it reaches the frame; RN-2605 (the third degeneracy) is live and the shade law is ranked LAST behind it by Admin's own order. Not re-opened here. | CLEARLY BEHIND | (b) |
| **12** | **The grass card's physical silhouette.** L5's owed item 1: at a standing eye the blades still read as wide flat leek or iris leaves rather than a sward. Visible in every ground frame this round. R4 rank 18. | ACCEPTABLE | (a), authoring |
| **13** | **The sun disc.** `sunCore` against `glareOut` unchanged for five audits; no disc by eye. R4 rank 15. | CLEARLY BEHIND | (a) |
| **14** | **No dappled canopy light; shadow sides crush toward black.** M3's caster-registration diagnosis stands. R4 rank 16. | CLEARLY BEHIND | (b)/(a) |
| **15** | **Stepped LOD ribbons on the orbital terminator, and they IMPROVED.** `limb.seam` iqr **61.02** against R4's 64.27, a 3.25-count fall nobody claimed. The defect is still visible; the trend is now downward. | CLEARLY BEHIND | (b) |
| **16** | **`?iblground=0` renders a black mid-field.** Confirmed pre-existing and NOT a look defect: it is an ARM that cannot be trusted the next time somebody uses it as a control. An instrument-integrity item, not a hero-frame item, and it is ranked here rather than in the five for that reason. | INSTRUMENT | (a), small |
| **17** | **No surface of the Moon has ever been photographed**, and the spine's pre-alpha target ends at scanning it. R4 rank 22, unchanged. | UNMEASURED | one pose |
| **18** | **Anything in motion.** Fifth audit running. | UNMEASURED | (b) |

---

## 5. THE CONTROLS

Eleven arms, fresh process each, one flag each, same build as the shipped row
they are read against.

| arm | pose | what it says |
|---|---|---|
| `?crownnormal=0` | `forestaircanopy` | box 79.89 / 61.06 → **82.91** / 54.85. **Exactly the baseline this audit was briefed with**, so the brief's 82.91 is the PRE-N12 value and merged main reads 79.89; the whole 3.02-count difference is N12's crown normal. `ctrl690` **bit-identical** (45.10 / 10.29 both arms), which is the scoping proof: the term moves the far band and not the 250-to-300 m control ring. |
| `?horizonswell=0` | `meadow` | `hzBand` iqr **155.55 → 4.21**, WG-275's own published OFF-arm figure to the digit; `skyHi`/`skyHz`/`nearG`/`shade` all inside 0.8 counts. **This retires R4's rank-1 number**: its 4.06 is what this rectangle reads with the swell OFF, though RN-2475 (2026-08-21) already retired the same rectangle a day earlier for the stronger reason that it frames no terrain at all, and per WG-277's record the 155.55 level is WG-275 together with WG-260's mid-tier stands, not WG-275 alone; see the correction note. |
| `?beachcanopy=0` | `beachground` | section 3.2's whole table. `box` and `ring` bit-identical; `hzTree` iqr 87.50 → 10.20. |
| `?treeline=0` | `flyover` | box 114.80 / 65.04 → 116.65 / 62.06; centre-column deltas in 3.1. |
| `?treeline=0` | `forestair` | box 98.60 / 31.77 → 99.43 / 30.06; `treeOut`, `treeOutA`, `treeOutB` and `hzBand` all identical to the `?canopy=0` arm, i.e. no instance out there either. |
| `?treeline=0` | `forestaircanopy` | box 79.89 / 61.06 → 78.99 / 56.61; `ctrl690` bit-identical (45.10 / 10.29), the by-design zero inside 690 m. |
| `?canopy=0` | `forestaircanopy` | box → 94.09 / 31.83. With the row above, separates instances (24.78 iqr) from paint (4.45). |
| `?canopy=0` | `flyover` | box → 119.83 / 56.62, `under` 59.51 → 72.14, `crowns` 85.25 → 92.08. |
| `?canopy=0` | `forestair` | box → 101.41 / 26.50, `crowns` 73.19 → 81.58, `under` 58.27 → 64.10. |
| `?grass=0` | `meadowfield` | section 3.5's table. Second build, with its shipped arm re-taken beside it. |
| repeats x3 | `beachground` | box 151.17 / 62.83 three times, fresh process each. |

---

## 6. WHAT THE WEEK CLOSED

Fourteen lanes merged between R4's base and this one. Judged here on this
build, by a hand that built none of them.

| item | verdict | evidence |
|---|---|---|
| **The plains horizon swell (WG-275), in the wasm** | **CLOSED, AND IT RETIRES R4'S RANK-1 NUMBER, THOUGH NOT AS THE FIRST OR THE ONLY REASON.** `meadow.hzBand` iqr **4.06 -> 155.55**, and `?horizonswell=0` returns **4.21**, WG-275's own OFF-arm value. R4 ranked the plains far ground first on the strength of that rectangle reading 4.06 "unmoved across three audits"; 4.06 is now what the world looks like with the term off. RN-2475 (2026-08-21, lane N1) had already retired the SAME rectangle for a stronger reason a day before this audit: `meadow.hzBand`, rows 270 to 306, contains no terrain at all against a horizon measured at rows 317 to 325, proven with a painted-arm run, so "unmoved in three audits" was never evidence about the ground it claimed to watch. And per WG-277's own record, the 155.83-level reading this row quotes as 155.55 is credited to WG-275 alone here but is documented as a PRODUCT of WG-275's swell together with WG-260's mid-distance tree stands, which supply the silhouette contrast that makes the newly-risen ground read as anything; see the correction note. By eye the plains horizon carries a gentle swell where it was a razor. | `R5_meadow.png` / `R5_meadow_swell0.png` |
| **The plains far-ground macro gain (N1, RN-2480)** | **LANDED AND VISIBLE IN THE NUMBERS.** `midfield` (declares `props: false`) box **134.72 -> 141.72** with iqr 44.21 -> 41.06, the largest move of any ground pose in the set. By eye the far plain has tone where it had none. **Partial against the bar**: it is still a plane, and the treeline standing on it is still cut-outs (rank 4). | `R5_midfield.png` |
| **The corrected crown normal (N12)** | **CLOSED AND ATTRIBUTED EXACTLY.** `?crownnormal=0` returns `forestaircanopy.box` to **82.91** against merged main's 79.89, and leaves `ctrl690` bit-identical. The guard's four `rho` values on merged main (**0.1019 / 0.3747 / 0.2974 / 0.5130**) reproduce N12's published 0.1016 / 0.3747 / 0.2968 / 0.5126 **within 0.0006**, three of four in CORE. | section 8 |
| **The beach canopy (WG-285)** | **CLOSED AS THE BAND IT WAS AIMED AT, AND IT OPENED RANK 2.** The dry-sea stage-1 hole is closed at `forestair`; `?beachcanopy=0` proves the term is doing real work at range (`beachground.hzTree` iqr 87.50 → 10.20). **And its own owed item 5 is now measured and is a defect**: the near-field look it could not see is bit-identical with the term on or off. | `R5_beachground.png` / `_beachcanopy0.png` |
| **The mid-tier stands, 170–690 m (WG-260)** | **LANDED AND VISIBLE BY EYE.** `R5_meadowfield.png` carries individually-trunked small trees in the 170-to-690 m band on the right of frame where R4's frame had a hole. | `R5_meadowfield.png` |
| **The RN-2275 guard, rebuilt as a linearized band with a real exit code (N8)** | **CLOSED, AND IT IS THE FIRST TIME THIS PROJECT'S LOOK HAS BEEN ASSERTED RATHER THAN PRINTED.** `check:guard` exits **0**, judges 4 of 4 poses and names its one standing violation instead of hiding it. | section 8 |
| **The spectral crown shade (N6) and the aerial cast attribution (N3)** | **REPRODUCE, AND ARE NOT ENOUGH.** `forestair.crowns` reads 73.19 luma against N3's published 73.12. Both lanes did what they said. **The aerial frame is unchanged to the eye**, and rank 1 and rank 3 are why: the defect is coverage and terrain palette, not crown chroma. This is the audit's main re-judgement. | `R5_forestair.png` |
| **The orbital terminator seam** | **IMPROVED, UNCLAIMED.** `limb.seam` iqr **64.27 → 61.02**. R4 retracted R3's "creeping" claim on a fourth flat point; a fifth point moves it the good way by 3.25 counts. | `R5_limb.png` |
| **The carpet's over-brightness (R4 rank 4)** | **PARTIALLY CLOSED, UNCLAIMED.** 55 m lift **1.96x → 1.54x**. No lane was aimed at it. | section 3.5 |
| **R4 rank 1 (plains far ground), rank 2 (the contact dither), rank 6 (the station)** | Rank 1 is superseded above. Rank 2 (N2) and rank 6 (N5) landed and were verified in their own records; this audit did not re-photograph the dither at `vistadawn` and says so in section 9. | n/a |

---

## 7. WHAT NEEDS REID, NOT A LANE

### 7.1 The water ruling (WG-45 to WG-49), and it now blocks a BLOCKING rank

**44.43 per cent of Forge is Ocean class and Forge has no ocean.** That is not a
cosmetic fact any more: rank 3 is the highest-exposure frame in the game reading
as shallow water because a dry sea floor is painted the colour of deep water
next to a dry beach painted the colour of sand. A palette lane can make the
boundary stop shouting; only Reid can say whether Ocean should eventually **be
water**, because that decides whether the palette work is a fix or a stopgap.
The same ruling governs `pondside` (rank 7): the one authored water surface in
the world is a regular corrugation that reflects nothing, and whether that
deserves a lane depends on whether water is going to be a compositional element
of this game or a pond near the spawn.

### 7.2 The SE reference board still does not exist, five audits in

FIDELITY-GAP section 3, Option D, step 1 asks for three frozen hero frames each
beside two or three Space Engineers landscape frames, and step 2 makes every
graphics lane ship a side-by-side against **the board, not its own before-frame**.
2.32.10 recorded that no such board is in the repo. It still is not. **Every
judgement in this document, including mine, is one person's memory of what a
Space Engineers landscape looks like**, which is exactly the anchoring drift
section 2 of the charter diagnoses. This is the cheapest unspent item in the
whole programme and it needs Reid because it needs source frames he chooses.

### 7.3 Polyhaven, and the terrain still has no material layers

A3's plan routed four to six real PBR layers (grass, dirt, rock, cliff, scree,
snow) from Polyhaven through texgen. It was never sourced. Ranks 8, 9 and 10 in
section 4 are all one missing asset set wearing three names, and they will stay
ranked until somebody decides to spend the download. Reid's call because it is a
licensing and asset-pipeline decision, not a rendering one.

### 7.4 Is a beach a desert or a shore? Two tables currently say both

Rank 2's cause is not a bug in the ordinary sense. `TREE_DENSITY_KM2[Beach] = 0`
carries an explicit written ruling (*"the desert stays the desert"*, *"bare pale
sand and dry scrub, no trees ever"*), and WG-285 then gave Beach a copy of
Plains' canopy table to close a hole in a different frame. **Both are defensible
and they cannot both be true**, and the visible result is a 900 m treeless disc
that follows the player. A lane can implement either answer in an afternoon and
must not choose. `R5_beachground.png` against `R5_beachground_beachcanopy0.png`
is the two answers side by side. **This ruling should not be taken alone.**
Section 7.1's water ruling decides whether Ocean becomes water; a beach is the
shoreline of whatever Ocean turns out to be, so a "desert" answer here and a
"water" answer there can together place a desert on the far side of a coast
that did not exist when this section was written. Merge 7.1 and 7.4 into one
coastline decision (see the correction note).

### 7.5 The crownflank trade, parked for Reid's eye

`crownflank=12` with `crownshadefloor=0.30` puts both binding poses inside the
guard's band (the only measured candidate that does), and Admin refused it as a
lane because it **drives the wood brighter than its own clearing**
(`forestairnoon` boxShip 1.0287, boxSurf 1.0327, both above 1.0), which breaks
the standing finding from R2 section 3.10 that the wood must read darker than
its clearing at every pose. That finding is an eye judgement, and it is five
audits old. **If Reid looks at a high-sun aerial and thinks a stand of trees may
legitimately read lighter than the grass around it, the band becomes reachable
today**; if not, the route stays closed and the shade law waits behind RN-2605.
This audit did not re-open it and takes no position.

---

## 8. THE STATE OF THE RAILS

`node tools/smoke/check-guard.mjs`, run once on this build, **exit 0**:

```
rn2550guard: PASS (4 of 4 poses judged, 1 outside CORE)
pose            boxShip  boxSurf | rho     verdict
forestairnoon   0.9736  0.9431   | 0.1019  OUT OF BAND by -0.0781
forestairlow    0.9448  0.7704   | 0.3747  IN CORE
flyovernoon     0.9378  0.9053   | 0.2974  IN CORE
flyoverlow      0.9655  0.8446   | 0.5130  IN CORE
```

Three things worth recording.

1. **It is a real assertion and it went green on merged main.** The wrapper
   echoes its own standing-violation notice rather than letting a PASS read as a
   clean band, which is BT-330 working as designed.
2. **It partially discharges 2.39.12 item 5, the ratchet re-measure on merged
   main that Admin routed to `check:guard`'s owner.** N12's four `rho` values
   reproduce here **within 0.0006** on a tree seven merges later, and Admin's
   own prediction that WG-285 would move `forestairlow` boxSurf to **0.7704** is
   exact. The pins were not adopted and this audit does not adopt them either.
3. **The coverage instrument's known bias is still printed and still open.**
   `?proppaint=1` does not black the cards (under-counts 0.13 to 0.32 across the
   four poses), which 2.35 disclosed; every ratio above is taken under one
   convention and the absolute levels are not quoted across sections.

Other gates: `npx tsc --noEmit` **0**, `npm run build` **0**, `cd web && npm run
check` **9 of 9, 0 failed**, each run as a separate step with no pipe (BT-330's
exit-code trap). `check:pose` passed with the new pose in it.

---

## 9. WHAT THIS AUDIT DID NOT MEASURE, SAID OUT LOUD

- **Anything in motion.** Fifth audit running.
- **Any body but Forge.** Still no surface of the Moon.
- **Any quality tier but `high`.** Fifth audit running.
- **Absolute frame times.** No millisecond is quoted as a verdict; the
  `render.frameMs` figures in section 2's captures are recorded but not judged.
- **The contact dither at `vistadawn`.** N2 landed and was verified in its own
  record; this audit did not re-run `rn2450bayer.mjs`, so R4's rank 2 is
  reported as closed on N2's evidence and not on mine.
- **`vistanoon`, `dawnsun`, `forestfloor`, `machine`, `smelterhero`, `ruin`,
  `ruinwall`, `basedusk`, `station`, `voxelface`, and the `flyover*`/`forestair*`
  sun variants.** Fourteen poses were taken, not twenty-six; the brief named the
  hero set and the ranking rests only on poses actually photographed this round.
- **Whether rank 1's paint is inert because of range, `TREE_SIN_MIN`, or mottle
  scale.** The audit measures that it is inert and does not diagnose which
  constant owns it; that is the lane's first job.
- **The near-field beach ground as a MATERIAL.** `beachground` proves the trees
  are absent and photographs the sand for the first time; whether the sand's own
  corduroy ripple banding and flat pebble decals deserve a rank needs a second
  look now that a pose exists.

---

## 10. FILES

- **Frames:** `docs/screenshots/R5_*.png`: fourteen poses plus nine control
  frames (`beachground_beachcanopy0`, `meadow_swell0`,
  `forestaircanopy_crownnormal0`, `forestaircanopy_canopy0`,
  `forestaircanopy_treeline0`, `flyover_canopy0`, `flyover_treeline0`,
  `forestair_canopy0`, `forestair_treeline0`) and five crops
  (`crop_flyover_treeedge_2x`, `crop_faircanopy_wall_3x`, `crop_beach_ring_3x`,
  `crop_beach_ring_canopy0_3x`, `crop_forestair_drysea_2x`,
  `crop_forestair_plate_4x`), plus `R5b_meadowfield_grass0.png` from the second
  build. **The pair to look at first is `R5_beachground.png` against
  `R5_beachground_beachcanopy0.png`.** The three `beachground` repeat frames and
  the second-build `meadowfield` shipped frame are NOT committed: their claim is
  a set of rectangle numbers, all published above, and the PNGs differ from each
  other only in the HUD digits that `world` carries (NUMBERS.md's own entry on
  that rectangle), so committing three near-identical 1.5 MB frames would add
  repo weight and no evidence.
- **Pose added:** `beachground` in `web/tools/smoke/probes/artframe.js`,
  additive, with its site survey, its solved yaw, its curvature-correct row
  derivation and its ladder-driven rectangle split committed in the manifest
  row, and registered in the pose-dispatch chain that file's own capitalised
  warning demands.
- **Instruments:** none added. Every measurement here uses committed tools:
  `rn2510rows.mjs`, `rn2450crop.mjs`, `rn2560sentinel.mjs`, `wg285field.ts`,
  `check-guard.mjs`.
- **Domain memory:** [`docs/controllers/rendering.md`](../controllers/rendering.md)
  section 2.40.
- **Numbers row:** [`NUMBERS.md`](NUMBERS.md), RN-2620 to RN-2634.

---

## 11. Correction pass (2026-08-22, fresh-context verifier, verdict FIX, applied by mini-lane)

A fresh-context verifier that never touched this audit's own work checked it
against the committed evidence and routed nine corrections plus a scheduling
note. All numbers below reproduce the audit's OWN committed data; nothing here
is a new measurement. Every entry is in was-X, now-Y form.

**1. The rank-1 range table's labels were wrong by up to 3x, and are
recomputed here with the formula shown once.** The audit's own curvature-correct
eye-frame inversion (2.37.2/2.37.3, and `beachground`'s own derivation in
`artframe.js`) is: at eye height `h` and range `s`, depression `= s/(2R) + h/s`
radians (`R` = 6e5 m, Forge); the horizon's own dip is `sqrt(2h/R)`; a screen
row maps to depression via `of.look`'s own convention, depression_deg =
`-pitch_deg - atan(v * tan(30 deg))` where `v = 1 - 2*(row/900)`. Inverting for
range: `s = R*depression - sqrt((R*depression)^2 - 2*R*h)` (the near root; the
far root is beyond the horizon and not physical). This formula, applied at
`beachground`'s own h = 1.62 m, pitch -8, reproduces its own committed ladder
(60.0/30.0/15.0/8.0 m at rows 361.9/383.1/425.4/499.1, and 1,394 m/170 m at
342.3/348.2) to within 0.03 of a row, which is the proof it is right before it
is used on `flyover`. Applied at `flyover`'s own h = 1,200 m, pitch -14, it
reproduces the audit's own committed row 535 = 3,427 m and horizon = 37,947 m
exactly. Recomputed at the table's other rows: **row 329 was labelled "38 km",
is 15.50 km; row 389 was "20 km", is 7.50 km; row 409 was "~20 km", is 6.44 km;
row 499 was "4 km", is 3.95 km (this one was already close); rows 519-539 were
"~3.6-3.4 km", are 3.64/3.50/3.38 km (also already close).** The measured span
is **3.4 to 15.5 km**; the band above 15.5 km, out to the 37,947 m horizon, was
never sampled by this ladder, and no claim in this document about that upper
band rests on a row reading. Corrected in section 3.1's headline, its
(b).3 table, its draft allocation row's "Done when", and in rendering.md 2.40.2
and NUMBERS.md's RN-2620 row.

**2. Two rows were dropped from the range table and are restored.** Row 399
was omitted from the "329-399" group (its delta is **-4.28**) and row 509 was
omitted between the "409-499" and "519-539" groups (its delta is **-2.33**).
Both contradict "under one count outside the ring", the claim the dropped rows
happened to leave uncontradicted; both are now printed beside that claim
rather than silently under it.

**3. The "same fraction twice" corroboration was a denominator-switching
artifact and is removed.** Was: "`flyover` 9.2 per cent... `forestaircanopy`
9.1 per cent... the same fraction twice from different altitudes." `flyover`'s
9.2 per cent is 3,500 m of the FULL 0-to-37,947 m horizon; `forestaircanopy`'s
9.1 per cent is 710 m of the 690-to-8,485 m band BEYOND 690 m, a different
denominator. Computed the same way as flyover (reach over the full horizon),
`forestaircanopy` is 1,400 of 8,485 m, **16.5 per cent**. Now: both numbers
(9.2 and 16.5) are stated; neither corroborates the other.

**4. Depth-fraction and pixel-fraction were conflated in the rank-1 headline
and are now separated.** The "about nine per cent... at both poses" framing
mixed a GROUND-DEPTH fraction (9.2/16.5 per cent, above) with the eye's
impression of the treeless wash as "about a quarter of the whole picture" (a
SCREEN-AREA impression) and with the paint's own pixel-liveness (rendering.md
2.36.3: LIVE on 86.10/99.20 per cent of aerial terrain pixels, cited in 3.1(c)
and (d), still BLOCKING). All three are real and are now stated as three
different measurements rather than one number restated three ways; the
quarter-of-the-picture eye impression matches the pixel share, not the depth
share.

**5. A fourth already-diagnosed candidate is added to rank 1's draft brief.**
RN-2560's `#ifndef OF_SCALED` gate and its committed default-off
`?treelinefar=1` flag (`TerrainTreeline.glsl.ts:134-155`) extend the far
treeline term past roughly 15 km; rendering.md 2.36.5 already priced flipping
it at **0.11 counts** at the loudest rectangle in any pose (`flyover.hzBand`).
Added to section 3.1(c) and (d) as a candidate the lane should pick up or
explicitly decline, not re-discover.

**6. A structure finding is added, and it promotes the mottle term over
`TREELINE_AMP` as the likely lever.** The shipped arm's own row-to-row iqr
never exceeds 3.9 counts across rows 329-509 and `dIQR` stays near zero
throughout; at row 539, inside the one ring where the paint does move luma,
the shipped arm has **15.47 counts LESS iqr than `?treeline=0`**, i.e. the
paint is locally destructive there. The paint carries neither colour nor
structure where it is supposedly working. Added to 3.1(b) as new point 5 and
folded into the draft allocation row (d).

**7. Retirement A (the plains horizon swell retiring R4's rank-1 number) is
given its stronger prior reason and its true co-factor.** Was: credited to
WG-275's `?horizonswell=0` alone. Now: RN-2475 (2026-08-21, lane N1) already
retired the same `meadow.hzBand` rectangle a day earlier for a stronger
reason, it contains no terrain at all (rows 270-306 against a horizon measured
at rows 317-325, proven with a painted-arm run), so "unmoved across three
audits" was never evidence about the ground. And per WG-277's own record
(2026-08-21), the 155.83-level reading (155.55 here) is documented as WG-275's
swell TOGETHER WITH WG-260's mid-distance tree stands, which supply the
silhouette contrast that makes the newly-risen ground read as anything;
running the swell arm against WG-260's own kill switch reproduces WG-277's
isolated 12.29 exactly. Both are co-factors, not one lane and a
corroboration. Added to section 0, section 5's controls table, and section
6's closure row.

**8. Four small corrections.** (a) Rank 4's "-30.19-count cliff in four rows
(457-461)" is a five-row span: **65.85 to 35.66 across rows 457-462 is
30.19**; over four rows (say 457-460) it would read 29.65. The five-row,
30.19 framing is kept because that is the span the printed delta actually
spans. (b) `beachground`'s `hzTree` rectangle (rows 332-348, 16 rows) is
re-captioned: only rows 332-343 are above the row-343 measured horizon and
carry the far wall; rows 344-348 (5 rows) are ground BELOW that horizon, not
wall. (c) `beachground` declares no `props` field in `artframe.js`, so props
are left ON by the branch's own default, the same as `meadow`; disclosed in
3.2(b). `midfield` declares `props: false` explicitly; that is now noted
beside both places this document quotes `midfield` (section 2's frame table
and section 6's macro-gain row) so the two poses are not assumed to share a
props state.

**9. All 61 em dashes in this document are replaced** with comma, colon,
semicolon, period or parentheses, matching R1 through R4, which carry zero.

**Next lanes, ruled.** The first post-R5 lane is **RANK 3**, with the
verifier's headline constraint carried verbatim: prove the subject before
changing the constant, paint the two classes to show the plate is dry-Ocean
and the cream is Beach, and state the target in ALBEDO, not screen counts,
because at 1,200 m additive airlight is **~92 per cent of the pixel** (RN-2540,
its own site), so tuning to the 14.63-count screen step overshoots whatever
albedo change is actually needed. **Rank 1 is briefable only after this
pass's table repair** (item 1, above); a lane briefed against "4 km to 20 km"
would have tuned the wrong rows. **Rank 2 stays Reid-blocked** (section 7.4).
The paint/reach two-lane split for rank 1 (rendering owns the paint and
`OF_SCALED` gate; world-gen owns `MAX_PER_CHUNK` and the reach ladder) is
kept as written in 3.1(c). **Reid-items 7.1 and 7.4 are merged into ONE
coastline decision**: separate rulings on "should Ocean be water" and "is a
beach a desert or a shore" can produce a desert on the far side of new water,
so Reid rules on the coastline once, not twice.
