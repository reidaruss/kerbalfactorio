# THE WORLD LOOK AUDIT, ROUND 2, 2026-08-21

> **Lane:** `lane/world-audit-r2` · **Numbers:** RN-2285 to RN-2290 of the
> RN-2285 to RN-2304 block · **Base:** `origin/main` at `326d285d` · **Owner:**
> rendering-controller
>
> Opened by Admin on the week's first loop, with Reid away and continuous
> graphics work ordered. It re-judges the WHOLE world against the D-020 Space
> Engineers bar **from scratch**, as
> [`WORLD-AUDIT-2026-08-19.md`](WORLD-AUDIT-2026-08-19.md) (R1) did, but through
> everything landed since: the five fidelity systems (A1 image, A2 carpet,
> A3 splat, A4 sky, A5 vegetation), the far-field cover convergence, the dawn
> retune, the AO and carpet-shading residuals, the aerial tree source, the
> single-material card, the pool ceiling, the crown asset, the far aerial ground
> and inter-crown self-shadowing. Section 5 is the ranked list, section 6 the
> top five lanes, section 7 the delta against R1.
>
> **Correction note, 2026-08-21:** a fresh-context verifier that never touched
> this lane re-checked its own measurements and found five wording issues
> (stray em dashes, the five-lane "no collision" claim, the pondside warm
> exception, rank 4's uniform-plate scope, and rank 1's relief claim); this
> pass applies all five, plus the verifier's own lane-sequencing reorder in
> section 6, adopted by Admin.

---

## 0. THE ONE-PARAGRAPH ANSWER

**The first hundred metres of this world is now good, the sky is good, and
everything between a hundred metres and the horizon is unbuilt.** R1 found a
world that was finished to forty metres; today it is finished to about a
hundred, and the boundary has moved rather than dissolved. Five of R1's seven
blocking gaps are genuinely closed and one of them (the haze) is now at the
bar. What is left is not a residue of those five, it is one large gap and two
smaller ones that were always behind them: **past roughly seventy-five metres
the terrain still has no material and no sub-massif relief**, and the proof is
no longer an argument about haze: with the aerosol term switched off entirely,
the 4.7 km ridge carries an interquartile range of **5.49 counts** against the
near ground's 25, and from 1,200 m with the vegetation removed the ground
directly below the camera reads **6.07** and `?splat=0` moves it by 0.06.
Beside that sit **a hard texel-staircase shadow region that survives every
isolator this build ships** and **a colour composition that turns the world
blue the moment the eye leaves the ground**: the whole-frame `warm` is negative
on all four aerial poses and positive on eleven of the twelve ground poses,
the stated exception being `pondside` (section 3.11). Nothing in the top five
needs WebGPU or a native client. One thing in the top five needs world-gen.

---

## 1. METHOD, AND WHAT IT IS AND IS NOT EVIDENCE FOR

**Capture.** Real Windows D3D11 through ANGLE (Chrome), 1600x900, HUD-free
through `of.screenshot()`, `postState.post === true` asserted by the probe on
every frame. Served from a `vite preview` this lane owned on `127.0.0.1:5811`,
`--strictPort`, **sentinel-verified before use**: `dist/of-sentinel-rn2285.txt`
was written into this worktree's own `dist` and fetched back over the port
before the first probe (NUMBERS.md, "a loopback bind silently shadows a
wildcard bind on the same port"). Port ownership confirmed by
`Get-NetTCPConnection -LocalPort 5811` (PID 2720) and killed by that PID.

**The build is HEAD's, proved rather than self-reported.** `git show
HEAD:web/wasm/dist/of-core.wasm | cmp -` against the served wasm: identical.
`client expects 26` in the bundle against `OF_ABI_VERSION = 26` at HEAD. Both
checks are the ones NUMBERS.md says a build cannot satisfy by merely agreeing
with itself.

**Frames illustrate; the numbers beside them are the evidence.** `run.mjs`
screenshots after the eval returns, so the saved PNG and the published
rectangles are not the same frame (`artframe.js`'s own header). Every figure
here is the probe's own decode at its own capture instant.

**This is a one-arm audit of current `main`, so almost every number is a
LEVEL and not a delta**, and the same-process pngdiff trap does not apply. The
seven cross-arm readings that ARE made are **one-flag negative controls taken
in a separate process against the same build**, reported as controls: section 4
lists all of them, including the two that came back null and the one that came
back broken.

**Reproduction is the check that this build is the build the record describes.**
Twelve committed rectangles from the last five lanes were re-read blind and
match to the digit: `forestfloor.box` 22.82 / iqr 18.78, `meadow.box` 85.59 /
55.05, `vista.box` 176.67 / iqr 18.71, `forestairnoon.box` 102.92,
`flyovernoon.box` 140.31, `forestairlow.box` 79.60, `flyoverlow.box` 103.92,
`flyover` 225,589 triangles / 26 calls, `forestair` 251,873 / 27, `limb`
52,913 / 21, `vista` 633,577 triangles. Nothing in the record has drifted, and
every judgement below is therefore about the build the last five lanes shipped.

**Every shot came back `valid: true` and `poolRefused: 0`**, so no frame here
is a truncated stand (RN-2260's gate) or an unposed spawn (RN-2169's dispatch
guard).

---

## 2. THE FRAMES

### 2.1 The twenty-three existing poses, re-taken at `326d285d`

`docs/screenshots/RN2285_<shot>.png`.

| shot | tris | calls | box luma / iqr | world luma / iqr / warm | sun dot |
|---|---:|---:|---|---|---:|
| `meadow` | 2,003,313 | 75 | 85.59 / 55.05 | 119.78 / 103.03 / **+16.46** | 0.551 |
| `meadowfield` | 1,897,099 | 74 | 101.35 / 61.27 | 117.35 / 86.49 / +16.44 | 0.699 |
| `forestfloor` | 1,280,910 | 75 | 22.82 / 18.78 | 37.16 / 31.07 / +9.29 | 0.701 |
| `midfield` | 707,823 | 49 | 143.96 / 32.27 | 122.95 / 81.07 / +16.49 | 0.699 |
| `voxelface` | 661,726 | 49 | 87.62 / 71.00 | 92.07 / 68.05 / +24.71 | 0.881 |
| `vista` | 633,577 | 50 | 176.67 / **18.71** | 140.91 / 62.40 / +0.88 | 0.699 |
| `vistadawn` | 740,181 | 50 | 166.97 / 79.21 | 131.66 / 130.19 / +27.97 | 0.101 |
| `vistanoon` | 572,027 | 49 | 187.95 / **5.50** | 155.09 / 59.86 / +6.46 | 0.920 |
| `dawnsun` | 749,487 | 51 | 197.24 / 13.98 | 152.92 / 75.80 / +28.35 | 0.101 |
| `mtnslope` | 639,155 | 49 | 127.39 / 89.62 | 114.94 / 89.61 / +21.61 | 0.699 |
| `machine` | 1,107,877 | 101 | 22.11 / 17.52 | 42.85 / 41.79 / +4.53 | 0.448 |
| `smelterhero` | 1,206,840 | 101 | 52.07 / 47.57 | 70.00 / 81.16 / +3.71 | 0.448 |
| `ruin` | 1,151,822 | 106 | 90.38 / 151.04 | 98.76 / 120.69 / +0.24 | 0.349 |
| `ruinwall` | 1,177,492 | 107 | 96.68 / 80.01 | 80.65 / 84.58 / +18.74 | 0.349 |
| `basedusk` | 1,360,219 | 112 | 62.84 / 53.20 | 94.20 / 127.66 / +7.42 | 0.203 |
| `station` | 36,257 | 36 | 12.69 / 9.57 | 18.90 / 11.36 / +3.53 | 0.499 |
| `flyover` | 225,589 | 26 | 120.25 / 55.35 | 138.64 / 67.20 / **-10.55** | 0.553 |
| `flyovernoon` | 216,457 | 32 | 140.31 / 64.40 | 152.07 / 50.52 / **-3.26** | 0.897 |
| `flyoverlow` | 239,925 | 26 | 103.92 / 45.49 | 130.84 / 96.74 / +6.92 | 0.203 |
| `forestair` | 251,873 | 27 | 89.94 / 27.77 | 121.50 / 98.41 / **-18.72** | 0.550 |
| `forestairnoon` | 227,297 | 27 | 102.92 / 32.57 | 129.96 / 98.89 / **-13.44** | 0.736 |
| `forestairlow` | 264,161 | 27 | 79.60 / 26.43 | 118.23 / 112.46 / +3.28 | 0.198 |
| `limb` | 52,913 | 21 | 67.65 / 133.96 | 25.52 / 11.67 / -6.57 | 0.303 |

**The `warm` column is a finding and not decoration.** Every ground pose in the
file is warm-positive and three of the four daylight aerial poses are
warm-NEGATIVE. That is section 5's rank 3, and it is the first time this
project has had the two halves of it side by side.

**`station` came back INTERIOR for the fourth consecutive audit** (36,257
triangles, 36 calls, `world` luma 18.90). Section 2.8 R5 and R1's own re-flag
stand; it is re-flagged again rather than re-diagnosed, and the interior is
separately noted in section 5 rank 13.

### 2.2 The two new poses (RN-2286), and the reason for each

The authoring gate (`npm run check:probes`) was re-run and PASSES, and both
rows are in `artframe.js`'s pose-dispatch chain as well as in `SHOTS`, which
that chain's own comment demands in capital letters.

| shot | scenario | pose | why it had to be added |
|---|---|---|---|
| `pondside` | `walk` | pond centre + 19 m N (lat -3.4077676, lon 150.277209), yaw 180, pitch -8, sun 0.55 | **Water is ranked (rank 7) and no frame in this project has ever contained any.** Forge has exactly one water surface, `cubed_sphere.h`'s 22 m home pond, 55 m from the spawn pad, i.e. the highest storyline exposure in the game; the site is derived from `pondDir` through `dirToLatLon`, four bearings were taken and 180 is the only one with the water, the far bank, its wood and the sky in one frame. |
| `meadownight` | `walk` | `meadow`'s pose and rectangles TO THE DIGIT, sun dot **-0.25** | **The night is ranked (rank 6) and the darkest frame this project had was `basedusk` at dot 0.20.** One field apart from `meadow` on the `vista`/`vistadawn`/`vistanoon` precedent, so the day arc's bottom third is a controlled comparison rather than a new site judged against itself. |

`pondside` carries a **setup assertion that the water was DRAWN**, not merely
that it exists: `WaterSurface` sets `frustumCulled = true` and increments
`grabs` inside `onBeforeRender`, which three fires only for an object that
survived the cull, so a non-zero `grabs` measures that this camera drew the
pond. It reads **340** with `grab: true`. Without it, a pose two hundred metres
off would photograph dry ground with every other field reading correct, which
is RN-2169's own defect one layer out.

**`pondside`:** 966,627 triangles, 77 calls, biome 4, `box` (open water) luma
104.79 / iqr 44.80 / **warm -50.32** / sat 0.427; `sky` -17.52, `wood` +5.77,
`bank` +23.37, `shore` +17.77, `nearW` -22.85.

**`meadownight`:** 838,680 triangles, 50 calls, sun pinned to **-0.251** with a
miss of 0.001. `skyHi` luma **0.07 iqr 0.00**, `skyHz` **0.08 iqr 0.00**,
`hzBand` **0.10**, `world` **2.85**, `nearG` 6.40, `shade` 3.21.

---

## 3. THE SCORES, ONE PARAGRAPH EACH

Scored **at bar / acceptable / behind / blocking** against my own knowledge of
what a Space Engineers landscape frame looks like, judged by eye with the
evidence frame named. The instruments are rails; the eye is the verdict
(FIDELITY-GAP section 3, Option D).

### 3.1 The atmosphere's architecture: **AT BAR**
One analytic Rayleigh/Mie integral with the uniform record shared BY REFERENCE
between the sky material, both terrain materials, the carpet and now the props,
so nothing in the frame can disagree with anything else about the air. R1 called
this at bar and it has since absorbed a Chapman sun path, a frame-wide boundary
layer, a sky ray that carries the aerosol, and a nine-direction CPU sky probe
driving the ambient, and it is still one authority. Nothing to fix.
*Evidence: every frame in section 2.1.*

### 3.2 The limb from orbit: **AT BAR**
`RN2285_limb.png`. `ring` luma 92.43, iqr 95.87, sat 0.607 over a `space` box
at 0.09, at 52,913 triangles and 21 calls. A blue-white limb, a warm terminator
gradient, a real star field, and the aerosol cut A4 made did not cost it
anything measurable (R1 read 93.27 / 101.39 / 0.626). This is still the best
frame the project has. Two reservations, both small and both R1's: the
terminator carries **stepped LOD ribbons with visible chromatic fringes**
(`seam` iqr 59.39 at R1, **63.21** today, so marginally worse), and the sunlit
disc is a featureless pale ball (no continent, no biome, no colour), which is a
different gap from the ribbons and belongs with rank 1.

### 3.3 Aerial perspective and the haze: **AT BAR**
This is R1's number one gap and it is closed. A4 took sigma from 4.5e-4 to
1.4e-4, a Koschmieder visual range of 8.7 km to 27.9 km, and the flyover's
all-ground `box` from iqr 31.71 to 51.05 against a 56.47 ceiling. Today the
same rectangle reads **55.35** at the same pose. The ramp is monotone and
correctly ordered at every rung and the distance goes blue rather than white.
What the haze is now doing is EXPOSING two things it used to hide, which is
ranks 1 and 2 and is a compliment to this term rather than a complaint about
it. *Evidence: `RN2285_flyover.png`, `RN2285_vista.png`.*

### 3.4 The sky and its clouds: **ACCEPTABLE**
`RN2285_vista.png`, `RN2285_meadow.png`. A deep blue zenith, a broken deck with
real convergence toward the horizon, a day arc that carries 79.96 counts of
`skyHz.warm` where R1 measured 14.83. Against the bar this is now a plausible
sky and it is the second-largest improvement in the audit. Two honest
reservations. **The clouds are lit as flat opacity, not as volume**: every cell
is a soft blob of one value with no lit side, no shaded underside and no silver
edge, so at `vistadawn` a golden-hour deck reads as smoke rather than as cloud,
and they cast nothing on the ground (deliberate, and it shows). And **the
horizon band is still a cream wall** at every hour: `vista.hzBand` warm +22.46
against a `skyHz` at -23.45, i.e. the sky and the ground meet in a seam of
opposite hue rather than converging. Rank 9.

### 3.5 Ground cover in the near field, 0 to 25 m: **ACCEPTABLE**
`RN2285_meadow.png`. This is the largest single change since R1 and the
charter's difference 1 is closed at this range: the ground IS grass, the
"billiard table with tufts on it" read is gone, the colour comes off the
terrain by construction, the blades lean and comb, and `nearG` sat 0.488 with
`loFrac` well down is a field rather than a substrate. It is not yet a Space
Engineers sward and the reason is the ASSET rather than the layer: **the blades
are too wide, too flat, too uniform in width and too uniform in value**, so a
frame at a standing eye reads as a field of leek or iris leaves rather than
grass, and the near two metres reads as legible individual cards. That is rank
5, and it is an authoring change rather than a shader one.

### 3.6 The terrain material in the near field, 0 to 75 m: **ACCEPTABLE**
`RN2285_mtnslope.png`, `RN2285_voxelface.png`. Six splat layers blended by the
shipped slope and altitude selectors, two rungs, a convergence rule that is
asserted rather than argued, and a far-cover term that stops the khaki band.
The ground under the player is a material now. Two reservations: on Mountains
the substrate reads as **pale blurry dust rather than scree** and the coarse
rung's mottle is visibly soft at a grazing eye; and the **voxel cut face has no
material at all** (`RN2285_voxelface.png`: the dug pit is a smooth beige blur),
which is the one surface in the game the terrain material does not reach.

### 3.7 The terrain material and relief past 75 m: **BLOCKING**
`RN2285_vistanoon.png` is the frame. The distant mountains are **flat cream
paper**: one uniform interior, no rock, no scree, no strata, no large-scale
occlusion, and no sub-massif relief (the massif silhouettes themselves read;
nothing finer than that does), and the ridge tops merge into the sky. This is
R1's gap 3 and it has not moved, because A3's two shipped rungs both retire
inside the near field by construction (RN-2166's mip finding) and A3 phase 2
was never run. **It is now the single largest gap in the world and it is the
one the storyline's first rocket launch puts in front of the player.**
*Numbers, and they are the decisive ones in this audit:* `vista.hzBand` iqr
**2.07** and `vistanoon.hzBand` **2.00**, against a near ground at 24 to 25;
with the aerosol term removed entirely (`?aerosol=0`, sky preserved) they reach
only **5.49** and **4.28**, so **the haze is not what is hiding the mountain,
there is nothing to hide**. From the air the same statement is starker: at
`flyovernoon` with the vegetation removed (`?canopy=0`) the ground below the
camera reads iqr **6.07**, and `?splat=0` moves it by 0.06 counts.

### 3.8 The mid field at a standing eye, 25 m to the treeline: **BLOCKING**
`RN2285_midfield.png` and `RN2285_meadowfield.png`. Past the carpet's fade the
ground becomes a **completely uniform green plate in the band nearest the
treeline**, with no texture, no undulation and no shading there. That band is
narrower than the whole middle third: blade structure survives well past 25 m
(range-strip iqr 38.78 / 32.27 / 31.28 at r18/r27/r35), so the featureless
plate is the strip closest to the treeline rather than the whole middle third
of a walking frame. It is 3.7 seen from two metres instead of from a ridge, and
it is listed separately because the fix is a different file: the carpet's own
far rung and `TerrainCoverFar`, not the splat. `meadowfield.r55` iqr 26.15
falling to `meadow.hzBand` 3.86 is the ramp, and there is nothing between them.

### 3.9 Shadows: **BLOCKING**
`RN2285_flyovernoon_canopy0.png` is the frame and it is the ugliest in the set:
a large **hard-edged, regular, square-toothed texel staircase** across the
aerial ground, present at dot 0.20, 0.55 and 0.897, and once the vegetation is
removed it is the ONLY feature in a 38 km view. This is R1's gap 5, unfixed,
and A4's own note that "a correct atmosphere has exposed a broken shadow" is
exactly right. **Section 4 is the new part: it survives every isolator this
build ships.** Separately and at ground level, the shadows that DO exist are
good where they land (`RN2285_basedusk.png`'s tree shadows on the base wall,
`RN2285_smelterhero.png`'s cast across the machine face) and the forest floor
has **no dappled canopy light at all** (`RN2285_forestfloor.png`: a dot-0.70
sun over a closed canopy and a uniformly shaded floor).

### 3.10 Vegetation from the air: **BEHIND**
`RN2285_forestairnoon.png`, `RN2285_flyovernoon.png`. R1's gap 2 was an
ABSENCE and that is closed absolutely: 46,575 canopy trees at `flyover`, 77,998
at `forestair`, a material treeline behind them to the horizon, a fade with no
ring in it, and inter-crown self-shadowing that puts the wood darker than its
clearing in all four sun arms. What it does not yet do is read as forest.
**The crowns are blue-black confetti on a pale acid-green field**: the cards
have lost their chroma to the albedo-side apply that 2.19.7 named and priced,
`forestair.hzBand` sat is **0.056**, and the two tiers plus the ground make
three unrelated colours. At `forestair` the near stand also has a **hard
vertical edge** where the instance tier stops. And at a low sun the whole
aerial world casts no shadow at all (`RN2285_flyoverlow.png`, dot 0.20, and the
canopy-does-not-cast theorem is why), so from the air the world has no light
direction at any hour.

### 3.11 Colour composition at range: **BEHIND, and it is ranked as blocking**
Three independent readings of one thing. **(a) From the air the world is a
sea.** Whole-frame `warm` is negative at `flyover` (-10.55), `flyovernoon`
(-3.26), `forestair` (-18.72) and `forestairnoon` (-13.44) and positive at
eleven of the twelve ground poses. **The stated exception is `pondside`, at
whole-frame warm -18.04**, a ground pose: the frame is mostly water surface,
so its negative reading is the water and not a repeat of the aerial finding.
`forestair`'s distance is at sat 0.056; and by eye `RN2285_forestairnoon.png`
reads as hazy shallow water with dark reefs, not as forested land. **(b) On
the mountain the understorey is mint.** `RN2285_mtnslope.png` puts pale
seafoam-green spikes on a cream substrate beside near-black rock slabs (three
palettes that do not belong together), and the plants read as glass. **(c) The
wood is bluer than its clearing and the clearing is under-canopy litter.**
RN-2275's own owed item 3 names the deeper half of this and it is confirmed
in the frames.

### 3.12 Vegetation assets, near: **BEHIND**
`RN2285_basedusk.png`, `RN2285_forestfloor.png`, `RN2285_meadow.png`. The
charter's difference 5 is partly paid (soft normals shipped at RN-1766, a
translucency term at RN-2205, a segment on the plains tufts at RN-2206) and the
frames still say asset. The broadleaf crown is a papercraft ball of flat
pentagons at full contrast against the sky; the conifers on any horizon are
green triangles; the forest floor's dead-blade litter is **pale cream and
hard-edged and reads as paper scraps strewn on dark ground**; and the blades
are the wide flat ribbons of 3.5. None of this is a lighting problem.

### 3.13 Water: **BEHIND**
`RN2285_pondside.png`, and getting it into the file is half this score. As
composition it is the best frame in the project: water, a wooded bank, a
distant hill and a good sky in one image, and it is 55 m from where the player
starts. As a surface it is not at the bar. **The water is a saturated cyan that
belongs to no other object in the frame** (`box` warm **-50.32** against a sky
at -17.52 and a bank at +23.37, i.e. the pond is bluer than the sky it is
supposed to be reflecting); the wave field is a **regular parallel banding**
that reads as corrugation; **nothing is reflected in it** (not the trees, not
the bank, not the clouds); there is no depth cue from shore to middle; and the
foam at the sand bar renders as **hard-edged flat polygons**. Beyond the pond,
the Ocean biome is still coloured ground and there is no other water anywhere.

### 3.14 The night: **BEHIND**
`RN2285_meadownight.png`, and this is the first night frame the project has.
The sky reads **luma 0.07 with an interquartile range of exactly 0.00**: not
dark, uniform black, with no horizon gradient, no airglow and no moon in
frame, under a sparse star field with no magnitude or colour variation. The
whole
frame is at luma 2.85 and the brightest thing a player can see unaided is at
6.4. The headlamp is a **hard-edged ellipse of lurid yellow-green** dropped on
the grass with no falloff structure and no light on the ground at the player's
own feet. The storyline puts the player outdoors on foot through the first
night and nothing about that hour has ever been looked at.

### 3.15 Snow, rock and scree as materials: **BEHIND**
Unchanged since R1 and confirmed at three poses. `RN2285_vista.png`,
`RN2285_vistanoon.png` and `RN2285_mtnslope.png` all carry **flat white
polygons with hard straight edges** where snow should be; at dawn they simply
become flat pale-blue polygons (`RN2285_vistadawn.png`). A3 gave snow a normal
and a roughness and left the flat white albedo `mix` in place on purpose, so
R1's gap 10 is half closed and the visible half is the half that is open.

### 3.16 The sun disc: **BEHIND**
`RN2285_dawnsun.png`. R1 could not measure this because no frame contained the
sun; A4 added the pose and found a dark speck. Today, looking straight into a
5.85 degree sun, `sunCore` reads luma **204.62** against `glareIn` 204.53 and
`glareOut` 202.99: **the brightest object in the world is 1.6 counts above the
sky beside it**, and by eye there is no disc at all. The aureole is real and
physical and correctly restrained; the thing it is an aureole of is missing.

### 3.17 Structures, masonry and machines: **ACCEPTABLE**
`RN2285_smelterhero.png` is the best asset frame in the game: plated steel, a
hot hearth, stone columns, real cast shadow across the face. `RN2285_ruin.png`
is the best-composed ground frame: a subject, a mid ground, a treeline and a
sky. Two reservations, both cheap. **Nothing emissive lights anything**: the
grass at the foot of a white-hot furnace is lit by the sun alone, with no local
term and no bloom, in both machine frames. And the masonry reads as a visible
repeating tile grid at `RN2285_ruinwall.png` with shadow sides crushed toward
black.

### 3.18 The station interior: **BLOCKING for the storyline, out of scope here**
`RN2285_station.png` is INTERIOR for the fourth audit running and the interior
is **nearly unlit**: `world` luma 18.90, everything read by rim highlights on
black plate. The pre-alpha spine ends here. Re-flagged to Admin, not
re-diagnosed; it is not a world-graphics question.

### 3.19 Frame cost: **ACCEPTABLE**
R1 ranked this blocking on a plains standing eye at 2,759,465 triangles, over
`StatsProbe`'s 2.7e6 ALERT. Today `meadow` at the same site is **2,003,313**
and it is the most expensive frame in the file; the aerials are 216k to 264k
and the vista set 572k to 750k. RN-2204's biome-batch culling, RN-2244's
single-material card and RN-2260's ceiling did that between them. **No absolute
millisecond is quoted anywhere in this audit**, per the record's own repeated
warning that a p50 from one run of `meadow` is not readable to better than
about 3 ms.

---

## 4. THE CONTROLS, INCLUDING THE ONE THAT IS BROKEN

Four one-flag arms at `flyovernoon`, fresh process each, same build, against
the shipped arm's `box` 140.31 / iqr 64.40, `under` 115.16 / 74.53.

| control | what moved | the staircase |
|---|---|---|
| `?shadowcast=0` | **every rectangle identical to the digit** | **still there, unchanged** |
| `?clouds=0` | `skyBand` 156.11 -> 145.72 (iqr 29.83 -> 15.99); every GROUND rectangle identical | still there, unchanged |
| `?splat=0` | nothing beyond 0.3 counts anywhere | still there |
| `?canopy=0` | `under` iqr **74.53 -> 6.07**, `box` 140.31 -> 147.36 | **still there, and now the only feature in the frame** |

Three conclusions and one warning.

**1. The staircase is not the clouds, not the splat and not the vegetation**,
and removing the vegetation does not hide it, it reveals it. `RN2285_flyovernoon_canopy0.png`
is the evidence frame: a bare 38 km view whose sole content is a hard
square-toothed dark region. Its edge is snapped to a texel grid, which is a
shadow-map signature and matches R1's own description of gap 5 to the word.

**2. `?shadowcast=0` DOES NOT REMOVE IT, and that is informative rather than
exculpatory.** RN-1954 documents that flag as "the light simply stops writing
and sampling a depth map". If the region were the map's CONTENTS it would have
gone. It did not move by one count. So the region is painted by a branch that
never reads the map: the cascade-shadow function's out-of-range behaviour at a
range where no cascade covers the ground (the furthest split is 300 m; every
pixel in this frame is past 1,243 m), and the boundary of the last cascade's
snapped ortho box is what makes the teeth.

**3. `?shadowcast=0` IS ITSELF BROKEN, and no lane should trust it until it is
fixed.** Run at `machine`, it drives the build into a GL error storm --
`GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and
sampler type (signed/unsigned/float/shadow)` x256, and `run.mjs` correctly
fails the probe. So the one shipped isolator for the shadow term errors on a
ground pose and returns a byte-identical null on an aerial one, and those two
behaviours cannot both belong to a working flag. **The shadow lane's first job
is an isolator that works**, because without one it cannot state a done-when.
This is NUMBERS.md's own "a control whose arming step silently fails is
indistinguishable from a passing control", found in a flag that has been in
`PAGE_PARAMS` since RN-1954.

**And the far-terrain ceiling, `?aerosol=0`, sky preserved** (the honest control
A4 established, never `?atmos=0`):

| rectangle | shipped | `?aerosol=0` | the ceiling this sets |
|---|---:|---:|---|
| `vista.hzBand` iqr | 2.07 | **5.49** | the 4.7 km ridge, all haze removed |
| `vistanoon.hzBand` iqr | 2.00 | **4.28** | the same ridge at 66.9 degrees |
| `vistanoon.mid` iqr | 4.86 | **11.36** | the middle distance |
| `vista.nearG` iqr | 24.00 | 25.00 | the near ground: the term barely touches it |

That last row is the positive check: the aerosol is a ranged term and the
control leaves the near field alone, so the four numbers above are the far
field's own material budget and not an artefact of the arm.

**One instrument defect found on the way, and it is real.** At a sub-horizon
sun `Systems.ts` computes `lit = elevation > -0.03` and hands `on = false` to
`ShadowRig.update`, whose loop does `if (!this.active) continue` BEFORE
`light.position` is written. `Frame.publishSun` then derives the post stack's
world sun direction from that stale light position. Measured at
`meadownight`: the probe's `upCheck` reads **0.508** where every other shot in
the file reads 0.000, and `sunElevDeg` reads **+14.83 degrees** for a sun the
same report pins at dot **-0.251**. So at night `__ofPost.state().sun` is
yesterday's sun, `ContactPass` marches along it (its only guard is
`sunWorld.lengthSq() < 0.25`, which a stale unit vector passes), and any probe
that reads that vector publishes a mirrored bearing. Recorded and routed, not
fixed: it is outside this audit's slice and it belongs with the night lane.

---

## 5. THE RANKED GAP LIST

Ranked by severity first, then by exposure against
[`story_line_outline_v1.txt`](../../story_line_outline_v1.txt), which puts the
player on the ground in Forest and Hills for the first several hours, walking to
a ruin, and then flying: pad, orbit, station, moon scan. Feasibility classes:
**(a)** art or tuning inside the current WebGL2/three stack · **(b)** engine
work inside WebGL2 · **(c)** likely needs WebGPU · **(d)** plausibly needs
native. **The known open items named in the brief are IN this ranking rather
than re-derived**, and each says where it came from.

| # | Gap | Evidence | Severity | Class |
|---|---|---|---|---|
| **1** | **The far ground has no material and no sub-massif relief past ~75 m** (the massif silhouettes themselves read; nothing finer than that does). Distant mountains are cream paper at every hour; from the air a 38 km view is featureless. R1 gap 3, unmoved, and this is also the vista far-relief question answered: the sub-massif relief is missing as well as the material. | `RN2285_vistanoon.png`, `RN2285_flyovernoon_canopy0.png`. `vista.hzBand` iqr 2.07 with a `?aerosol=0` ceiling of 5.49; `flyovernoon.under` iqr 6.07 with vegetation off; `?splat=0` moves it 0.06 | **BLOCKING** | (b) for a normal/detail term and a far rung; **(c) only** if real geometric displacement is wanted, and that question should be re-asked after the (b) version |
| **2** | **A hard texel-staircase shadow region across the aerial mid-field**, at three sun elevations, which no shipped isolator removes and whose only isolator is broken. R1 gap 5. | section 4; `RN2285_flyovernoon_canopy0.png` | **BLOCKING** | (b) |
| **3** | **Colour composition at range.** The world is warm-negative from the air and warm-positive from the ground; the mountain understorey is mint; the wood is bluer than the clearing and the clearing is under-canopy litter. RN-2275 owed item 3 plus this audit's own `warm` column. | section 3.11; the `warm` column in 2.1; `RN2285_mtnslope.png`, `RN2285_forestairnoon.png` | **BLOCKING** | (a) throughout |
| **4** | **The mid field at a standing eye is a uniform plate in the band nearest the treeline**, narrower than the whole middle third: blade structure survives well past 25 m (range-strip iqr 38.78 / 32.27 / 31.28 at r18/r27/r35). | `RN2285_midfield.png`, `RN2285_meadowfield.png` | **BLOCKING** | (b) |
| **5** | **Vegetation assets: brushed-not-bladed blades, chunky near trees, paper litter.** A3's own owed item and A5's own judgement, both carried forward. | `RN2285_meadow.png`, `RN2285_basedusk.png`, `RN2285_forestfloor.png` | CLEARLY BEHIND | (a), authoring |
| **6** | **The night is unbuilt**, plus the stale post-stack sun below the horizon. | `RN2285_meadownight.png`; section 4's last paragraph | CLEARLY BEHIND | (a) for the sky and the ladder, (b) for the headlamp and the stale sun |
| **7** | **Water is one pond, over-cyan, banded, unreflective, and its foam is polygons**; the Ocean biome is still coloured ground. R1 gap 11. | `RN2285_pondside.png`; `box` warm -50.32 against a sky at -17.52 | CLEARLY BEHIND | (a) for the palette and the wave field, (b) for a reflection and for ocean surfaces |
| **8** | **Snow, rock and scree read as paint.** R1 gap 10, half closed by A3 and the visible half still open. | `RN2285_vista.png`, `RN2285_mtnslope.png` | CLEARLY BEHIND | (a) |
| **9** | **Clouds round 2: shape and lighting.** Flat-opacity blobs with no lit side, no shaded underside and no ground shadow; and the cream horizon band they sit over. | `RN2285_vistadawn.png`, `RN2285_vista.png` | CLEARLY BEHIND | (a) for lighting and shape, (c) for volumetrics |
| **10** | **Dawn anti-solar chroma is thin.** `vistadawn.skyR.warm` **+15.86** where the anti-solar sky should be blue-violet; `dawnsun.skyUp` does cross to -11.81, so the term exists and does not reach this bearing. A4's own owed note. | `RN2285_vistadawn.png` | CLEARLY BEHIND | (a) |
| **11** | **The sun disc is 1.6 counts.** R1 gap 16, A4's dark-speck finding, still undiagnosed. | `RN2285_dawnsun.png`; `sunCore` 204.62 vs `glareOut` 202.99 | CLEARLY BEHIND | (a) once diagnosed |
| **12** | **Nothing emissive lights anything.** A white-hot furnace throws no light and no bloom onto the ground a metre away. | `RN2285_smelterhero.png`, `RN2285_machine.png` | CLEARLY BEHIND | (b) |
| **13** | **The station is INTERIOR for the fourth audit and the interior is unlit.** Section 2.8 R5, R1's re-flag, re-flagged again. | `RN2285_station.png`, `world` luma 18.90 | BLOCKING for the spine, out of this domain | (b) |
| **14** | **Stars in a blue daylight sky at 1,200 m.** R1 gap 13, unchanged, visible in all four aerial frames. | `RN2285_flyover.png` | CLEARLY BEHIND | (a), a curve |
| **15** | **Stepped LOD ribbons with chromatic fringes on the orbital shell's terminator.** R1 gap 12; `seam` iqr 59.39 -> **63.21**, marginally worse. | `RN2285_limb.png` | CLEARLY BEHIND | (b) |
| **16** | **The forest floor has no dappled canopy light** at a dot-0.70 sun. | `RN2285_forestfloor.png` | CLEARLY BEHIND | (b) |
| **17** | **`CANOPY_SHADE` is default OFF and Admin's ruling is open.** WG-223 has since supplied `crownWeightAt` at a 34 m crown scale, which is exactly the patchiness 2.14.7b prescribed, and **nothing is wired**. The `?canopyshade=1` frame pair at `forestfloor` is still owed and is the only instrument that can settle it. | rendering.md 2.14.7b, world-gen.md 6.9.9 | ACCEPTABLE (a decision, not a defect) | (a) |
| **18** | **The voxel cut face has no material.** The one surface the terrain material does not reach. | `RN2285_voxelface.png` | ACCEPTABLE | (b) |
| **19** | **No large-scale terrain occlusion in valleys.** R1 gap 14, unchanged. | `RN2285_vista.png` | ACCEPTABLE | (b) via a horizon map |
| **20** | **Foliage aliasing in motion.** UNMEASURED, as at R1: FXAA only on an alpha-tested scene, and a still frame cannot show shimmer. | -- | UNMEASURED | (b), expensive |

**Nothing in ranks 1 to 12 argues for native.** The one honest (c) is real
geometric displacement at range inside rank 1, and rank 1's own (b) half should
be built and re-measured before anyone argues it, which is R1's own ruling on
the same item and it still holds.

---

## 6. THE QUEUE: THE TOP FIVE LANES

Ordered so each one's measurement is available to the next. **The file seams
are stated as intra-file partitions, not a claim of no collision**: three
files are dual-owned and split by a named boundary within the file itself
(`TerrainFragLight.glsl.ts`: L1 owns the non-cascade albedo/bump/light terms,
L2 owns the cascade half; `TerrainSplat.ts`: L1 owns geometry and weights, L3
owns the layer hue table; `GrassCard.ts`: L4 owns the file, L5 owns its
geometry constants), and L1's `materials/Terrain*` glob explicitly excludes
`TerrainCoverFar*`, which stays L4's (NUMBERS.md standing rule: a shared
wiring file is a predictable collision point, so name one owner or partition
and state the boundary).

**Sequencing, the verifier's reorder, adopted by Admin:** L4 runs after L1
rather than concurrently with it, since L1's far-band material addresses part
of the same 25 m-to-treeline gap; L5 is promoted into the concurrent slot L4
vacates.

### L1. THE FAR GROUND (rank 1): **opus**
Give the terrain a material and a relief term from 75 m to the horizon: a third
splat rung on a world-locked coordinate, a normal-only detail displacement at
range, and a far term for the scaled shell. **Owns:** `web/src/render/materials/Terrain*`, **excluding `TerrainCoverFar*`**
(which stays L4's) (`TerrainSplat`, `TerrainSplatHandle`, `TerrainArt.glsl`,
`TerrainFragAlbedo/Bump/Light.glsl`, `TerrainProgram`; the cascade half of
`TerrainFragLight.glsl.ts` is L2's, and `TerrainSplat.ts`'s layer hue table is
L3's) and `web/src/world/ChunkBatch`'s attribute upload.
**Must not touch:** `render/grass/*` (L4), `render/post/*` and the biome hue
tables (L3), `Atmosphere*` (L3), `ShadowRig`/cascade code (L2).
**Cross-domain:** this needs **world-gen's per-chunk phase attribute reduced
mod the tile period on the CPU in float64**: RN-2160's own phase-2 owed item,
named in `TerrainArt.glsl.ts`'s header and already assigned to world-gen. Flag
it to Admin before dispatch. **Done when:** `vista.hzBand` iqr clears half its
own `?aerosol=0` ceiling (2.07 -> at least 3.8 of 5.49) and `vistanoon.mid`
clears half of 11.36, with `flyovernoon.under` under `?canopy=0` clearing 6.07
by a stated factor, and every walk-pose committed rectangle inside a stated
band. Opus because the mip self-retirement that killed A3's first rung
(RN-2166) will recur at every new rung and the first job is to sweep for it.

### L2. THE AERIAL SHADOW REGION (rank 2): **opus**
Diagnose and remove the texel staircase, and **ship a working isolator with
it**, because `?shadowcast=0` errors on a ground pose and nulls on an aerial one
(section 4). **Owns:** `web/src/render/ShadowRig.ts`, the cascade half of
`TerrainFragLight.glsl.ts`, `web/src/render/post/ContactPass.ts` and the
`shadowcast` page param. **Must not touch:** terrain albedo/splat (L1), grass
(L4), colour tables (L3). **Done when:** the region is absent from
`flyovernoon` under `?canopy=0` at all three sun rungs, the new isolator
reproduces today's frame to the digit as its own positive check, and
`?shadowcast=0` no longer produces a GL error at `machine`. Opus because its
first job is a diagnosis against an instrument that does not currently work.

### L3. THE RANGE PALETTE (rank 3, and ranks 8 and 10 come with it): **sonnet**
Make the world warm-positive from the air, kill the mint understorey on
Mountains, give the snow band a material rather than a flat white `mix`, and
reach the anti-solar bearing at dawn. **Owns:** `web/src/render/materials/BiomeMaterial.ts`
and `BiomePalette`'s hue rows, `TerrainSplat.ts`'s layer hue table,
`Atmosphere*`'s `aerosolTint`, `CanopySelfShadow`'s apply-point, and
`render/post/PostDefaults.ts`. **Must not touch:** terrain geometry or the
splat weights (L1), shadows (L2), grass geometry (L4).
**Done when:** whole-frame `warm` crosses zero at `flyovernoon` (-3.26) and
`forestairnoon` (-13.44), `mtnslope`'s understorey reads as plant rather than
glass by eye, and no ground-pose committed rectangle moves more than a stated
band. Sonnet: the cause is stated, the work is tuning against named frames.

### L4. THE MID FIELD AT A STANDING EYE (rank 4): **sonnet**
Put structure between the carpet's fade and the treeline: a third, coarse
carpet rung or a far-field cover texture, handed over on the same single
boundary constant `TerrainCoverFar` already owns. **Owns:**
`web/src/render/grass/*` and `web/src/render/materials/TerrainCoverFar*`.
**Must not touch:** the splat layers or the terrain material (L1), palettes
(L3). **Done when:** `meadowfield` gains a committed rectangle past r55 whose
iqr clears a stated floor, `RN2285_midfield.png`'s plate carries visible
structure by eye, and the frame cost stays under the 2.7e6 ALERT at `meadow`.
Sonnet: the cause is stated and the mechanism already exists one rung in.

### L5. THE VEGETATION ASSET PASS (rank 5): **sonnet**
Re-author the grass blade (narrower, more value spread, less uniform width),
the broadleaf crown (it is a papercraft ball), and the dead-blade litter tint
(pale cream paper on a dark floor). **Owns:** `tools/blender/build_props_*.py`,
`tools/blender/texgen.py`'s `grass` and `leaf` families, `contracts.json`, and
`web/src/render/grass/GrassCard.ts`'s geometry constants. **Must not touch:**
any shader, `GrassPalette`'s rotation (L3's colour authority), or the carpet's
rungs (L4). **Done when:** the hero judgement on `meadow`, `forestfloor` and
`basedusk` says blade rather than leek, with byte-deterministic rebuilds
(texgen: every pre-existing PNG identical; Blender: two passes, one sha256) and
no `validate_glb` budget row moved. Sonnet: this is authoring against named
frames with a hard determinism rail.

**Sixth and behind them, in order:** the night (rank 6, and it carries the
stale-post-sun defect); water (rank 7); clouds round 2 (rank 9); the sun disc
(rank 11); emissive light (rank 12); the orbital ribbons (rank 15). **And two
that are Admin's and not a lane's:** the station's exterior and its unlit
interior (rank 13), and the `CANOPY_SHADE` ruling (rank 17), which now needs
only the `?canopyshade=1` frame pair WG-223 already owes it.

---

## 7. THE DELTA REPORT: R1'S BLOCKING GAPS, TWO DAYS ON

R1's table carried **seven** rows at BLOCKING, not six; #7 was named as the
same lane as #2 and is scored with it here. Frame pairs are R1's
`RN2065_*` against this audit's `RN2285_*` where both exist.

| R1 | gap | today | evidence |
|---|---|---|---|
| **1** | aerial perspective destroys the distance | **CLOSED, and at bar.** sigma 4.5e-4 -> 1.4e-4, Koschmieder 8.7 -> 27.9 km; `flyover.box` iqr 31.71 -> **55.35**. The distance goes blue instead of white. | `RN2065_flyover.png` / `RN2285_flyover.png` |
| **2** | no vegetation from the air at any radius | **CLOSED as an absence, BEHIND as a picture.** 188,081 triangles and not one tree -> **225,589** with **46,575** canopy trees at `flyover` and 77,998 at `forestair`, plus a material treeline to the horizon and inter-crown self-shadowing. It reads as blue confetti, which is rank 3, not rank 2. | `RN2065_flyover.png` / `RN2285_flyovernoon.png` |
| **3** | no terrain material past ~75 m | **NOT CLOSED. It is now rank 1.** The near field is closed (splat, carpet, far cover); the far field has not moved and the `?aerosol=0` ceiling proves the haze is not what is hiding it. `vista.hzBand` iqr 3.00 -> **2.07**, i.e. very slightly worse. | `RN2065_vista.png` / `RN2285_vista.png`, `RN2285_vistanoon.png` |
| **4** | frame cost at a standing eye, over the ALERT | **CLOSED.** The plains standing eye 2,759,465 -> **2,003,313** triangles, under `StatsProbe`'s 2.7e6, and every one of 25 frames came back `valid` with `poolRefused: 0`. | section 2.1 |
| **5** | shadows stop at 300 m and the last cascade paints a texel staircase | **NOT CLOSED, and more visible than it was**, because the haze that used to hide it is gone. It is now rank 2, and section 4 adds what R1 did not have: it survives four isolators and its own flag is broken. | `RN2285_flyovernoon_canopy0.png` |
| **6** | the low-sun half of the day arc inverts the frame | **LARGELY CLOSED.** `skyHz.warm` at dawn -86.23 -> **+33.03**; the far-to-near ratio 7.01 -> 204.05/46.81 = **4.36**; the frame reads as a dawn. What is left is the anti-solar bearing (rank 10). | `RN2065_vistadawn.png` / `RN2285_vistadawn.png` |
| **7** | the world's edge at 620 m, a hard prop cull ring | **CLOSED.** There is no ring anywhere in any frame at any altitude; the canopy fades on a realised reach and the material treeline carries past twenty kilometres. | `RN2065_sweep_plains.png` / `RN2285_meadowfield.png` |

**Five of seven closed, one at bar, two still blocking, and the two that
remain were always the expensive ones.** That is an honest week's arc and it is
worth stating plainly: the fidelity charter's Option A was the right call, its
sequencing was right, and the lanes did what they said. What the charter
under-weighted is that closing the haze and the vegetation makes the terrain's
own emptiness MORE legible rather than less, which is the same mechanism A1
recorded about its own grade ("a better image made that defect more legible").
Rank 1 is not a new gap; it is the gap that four lanes have now cleared the
view to.

**And one correction to the record, which is what a fresh judgement is for.**
Both RN-2265 and RN-2275 judged `forestair`/`forestairnoon` "MET ... an aerial
photograph: dark closed masses with pale open ground bitten into them". I
re-took that exact frame on the same build and it reproduces
`RN2275_forestairnoon_base.png` to the pixel, and my eyes do not agree with
that sentence: it reads as a hazy shallow sea with dark reefs, the crowns are
blue rather than green, the near stand has a hard vertical edge, and the
structure in the far half is haze modulation rather than woodland. Both lanes
measured correctly and both judged generously against their own predecessor
frame, which is precisely the anchoring drift FIDELITY-GAP section 2 named. The
numbers in those two sections stand; the verdict in them does not.

---

## 8. HONEST GREENS

- **The atmosphere and the limb are at bar** and have survived four lanes of
  change to the terms around them (3.1, 3.2).
- **The haze went from the number one blocking gap to at bar in one lane** and
  the frame it produced is genuinely better at every range (3.3).
- **The near ground is a meadow.** The charter's difference 1, called "roughly
  half the perceived gap", is closed at 0 to 25 m (3.5).
- **The record reproduces exactly.** Twelve committed rectangles across five
  lanes, re-read blind on a fresh build, all to the digit (section 1). That is
  not a small thing after a week of concurrent lanes on one binary.
- **The instruments caught things this audit would have got wrong.** The
  `?aerosol=0` ceiling turned "the distance is hazy" into "the distance is
  empty"; `?canopy=0` turned "there is a dark band" into an unobstructed
  photograph of it; and `?shadowcast=0` failing loudly at `machine` is the only
  reason its null at `flyovernoon` was not written down as a refutation.
- **`pondside` is the best-composed frame this project has produced**, and it
  cost one manifest row (3.13).

---

## 9. WHAT THIS AUDIT DID NOT MEASURE, SAID OUT LOUD

- **Anything in motion.** Foliage shimmer, LOD pop, streaming hitches and the
  fade dither are all invisible to a settled still frame, exactly as at R1.
- **Any body but Forge.** The Moon, Cinder and the airless profile are unjudged
  and the spine sends the player to scan the moon.
- **Any quality tier but `high`.** The `low` tier is one cascade at 90 m with
  the post stack off, and nobody has ever looked at what the world is there.
- **Absolute frame times.** No millisecond is quoted anywhere in this document.
- **The station's exterior**, still not reproducible (3.18).
- **`?canopyshade=1`**, which is Admin's open ruling and needs a frame pair at
  `forestfloor` this lane was not chartered to take (rank 17).

---

## 10. FILES

- **Frames:** `docs/screenshots/RN2285_*.png`, 29 files -- 23 existing poses,
  2 new poses (`pondside`, `meadownight`), and 4 control frames
  (`flyovernoon_shadowcast0`, `flyovernoon_clouds0`, `flyovernoon_canopy0`,
  `vistanoon_aerosol0`).
- **Poses:** `web/tools/smoke/probes/artframe.js`, new manifest rows
  `pondside` and `meadownight`, each with its documented invocation in the file
  header, its reason in its own row, and its entry in the pose-dispatch chain.
- **Domain memory:** [`docs/controllers/rendering.md`](../controllers/rendering.md)
  section 2.20.
- **Numbers row:** [`docs/web/NUMBERS.md`](NUMBERS.md), RN-2285 to RN-2304.
