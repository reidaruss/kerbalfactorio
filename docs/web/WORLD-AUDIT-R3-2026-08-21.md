# THE WORLD LOOK AUDIT, ROUND 3, 2026-08-21

> **Lane:** `lane/world-audit-r3` · **Numbers:** RN-2365 to RN-2372 of the
> RN-2365 to RN-2384 block · **Base:** `origin/main` at `3881822b` · **Owner:**
> rendering-controller
>
> The third full judgement of the world against the D-020 Space Engineers bar,
> and the second turn of the audit-to-lanes loop. R2's whole top five landed
> between then and now: L1 the far ground, L2 the aerial staircase, L3 the range
> palette, L4 the mid field, L5 the near vegetation assets. This pass re-judges
> everything **from scratch**, including R2's own closures, on R2's method with
> fresh eyes. Section 5 is the ranked list, section 6 the top five lanes,
> section 7 the delta against R2.

---

## 0. THE ONE-PARAGRAPH ANSWER

**The world is a landscape now out to about two kilometres, and past that it is
still paper; the ground is a material everywhere the eye stops on it, and every
remaining large gap is about LIGHT rather than about surface.** Four of R2's
five top lanes did what they said and two of them changed the picture
substantially: from a ridge the middle distance now carries real relief where
R2 photographed a cream blur, and from the air the texel staircase that was
R2's rank 2 is gone. What is left is a different shape of problem from R2's.
**Three things dominate.** (1) At 4.7 km the ground and the air are now the
same brightness to within two counts (`vista.hzBand` luma 184.03 shipped
against 186.09 with the aerosol removed) while the ground's own contrast is cut
to 31 per cent (iqr 2.21 against 7.07), so the far ridge cannot separate from
the sky by value at all, and the hue that should separate it is pointing the
wrong way: the horizon band is **warm +48.36** against a sky at **-12.14**,
where R2 measured +22.46 against -23.45. **The distance goes cream, and it goes
cream because L3 fixed the aerial blue by warming the air.** (2) The aerial
ground carries a **world-locked rectangular lattice** that survives seven
one-flag isolators and is unmissable at 1x with the vegetation off
(`RN2365_forestair_canopy0.png`); it is R2's staircase's successor and it is
undiagnosed. (3) A new pose settles a rank that two audits inferred and neither
measured: with the headlamp off, a running smelter at night puts a whole frame
at **luma 1.81**, *darker than an empty meadow at the same hour* (2.03), with
the plate 0.3 m from the coals at **2.72**. **Emissives light nothing at all,
and the entire night look of this game is one headlamp cone.** Nothing in the
top five needs WebGPU or a native client.

---

## 1. METHOD, AND WHAT IT IS AND IS NOT EVIDENCE FOR

**Capture.** Real Windows D3D11 through ANGLE (Chrome, RTX 4060 Ti), 1600x900,
HUD-free through `of.screenshot()`. Served from a `vite preview` this lane owned
on `127.0.0.1:5865`, `--strictPort`, `--host 127.0.0.1`.

**Server ownership was a claim with a lifetime and it was re-asserted, not
assumed.** `dist/of-sentinel-rn2365.txt` was written into this worktree's own
`dist` before the server started and fetched back over the port before the first
probe; the check also compares the **served bundle name against the one on
disk**, because a sentinel proves provenance and only the hash proves recency
(NUMBERS.md, RN-2305's `sirv` startup-snapshot entry). It was run before batch
one, after batch one, after the control matrix, and the teardown found
`Get-NetTCPConnection -LocalPort 5865` still naming **PID 7380**, the PID this
lane started and wrote down, which closes the window RN-2305's port-theft entry
opens. Every batch is bracketed by an assertion.

**The build is HEAD's, proved rather than self-reported.** `git show
HEAD:web/wasm/dist/of-core.wasm | cmp -` against the served wasm: identical.
`client expects 26` in the bundle against `OF_ABI_VERSION = 26` at HEAD. (A
second `client expects 35` in `VesselCatalogue-*.js` is a `of_vs_part_info`
stride check, not an ABI, and is named here so the next reader does not have to
re-derive that.)

**This is a one-arm audit of current `main`, so almost every number is a LEVEL
and not a delta.** Nineteen cross-arm readings ARE made and every one is a
one-flag negative control in a separate process against the same build, except
one two-flag arm which says so in its own row. Section 4 lists all of them,
including the three that came back null on purpose and the one that refutes a
hypothesis this audit had before it measured.

**Frames illustrate; the numbers beside them are the evidence.**

**Reproduction, and it is stronger than R2's.** The four bare-air control
figures L1 published, re-read blind on today's build through the two-flag
`?aerosol=0 ?horizon=0` arm, reproduce **to the digit**: `vista.hzBand` iqr
**5.49**, `vistanoon.hzBand` **4.28**, `vistanoon.mid` **11.36**, `vista.mid`
**19.13**. Those are R2's own committed values, surviving five lanes on one
binary, and they are what makes `?horizon=0` an honest arm rather than an
assertion. Alongside them: `limb` `ring` **92.43 / 95.87 / sat 0.607** and
52,913 triangles, bit-identical to R2; `station` `world` 18.91 against 18.90;
`forestair` 251,873 triangles and `vista` 633,577, unmoved. `flyovernoon.under`
under `?canopy=0` reads **13.71** against L1's own 13.78.

**Every shot came back `valid: true`, `poolRefused: 0`, `postState.post ===
true`, and `setup.upCheck === 0.000`**, including `meadownight` and
`smelternight`, which is the independent confirmation that L2's RN-2307
stale-sun fix works: R2 measured 0.508 on the only sub-horizon pose it had.

**An instrument failure caught by its own designer, recorded because it cost
nothing only because the runner shouted.** This lane's first control matrix
appended flags to the URL as a query string. `run.mjs` refuses that outright
("`--url` must not carry a query string ... would be silently discarded,
because the runner rebuilds the query from its own flags") and exited 2 on all
sixteen arms in 0.4 s each. Sixteen instant refusals instead of sixteen
plausible nulls: that guard is worth its line count and is named here so it is
not removed as noise.

---

## 2. THE FRAMES

### 2.1 The twenty-five existing poses, re-taken at `3881822b`

`docs/screenshots/RN2365_<shot>.png`.

| shot | tris | calls | box luma / iqr | world luma / iqr / warm | sun dot |
|---|---:|---:|---|---|---:|
| `meadow` | 2,003,313 | 75 | 85.23 / 56.47 | 119.29 / 104.62 / +20.06 | 0.551 |
| `meadowfield` | 1,897,099 | 74 | 101.65 / 60.06 | 116.98 / 85.60 / +19.45 | 0.699 |
| `forestfloor` | 1,286,315 | 75 | 29.63 / 24.08 | 43.19 / 38.08 / +12.87 | 0.701 |
| `midfield` | 705,775 | 49 | 143.24 / 28.50 | 122.84 / 79.64 / +19.85 | 0.699 |
| `voxelface` | 663,774 | 49 | 88.04 / 69.76 | 92.82 / 68.14 / +26.07 | 0.881 |
| `vista` | 633,577 | 50 | 178.29 / 17.20 | 141.63 / 63.96 / +11.57 | 0.699 |
| `vistadawn` | 740,181 | 50 | 168.48 / 75.45 | 132.41 / 129.18 / +36.82 | 0.101 |
| `vistanoon` | 572,027 | 49 | 188.91 / **6.12** | 155.68 / 59.57 / +17.46 | 0.920 |
| `dawnsun` | 749,487 | 51 | 197.78 / 13.27 | 153.39 / 74.76 / +37.56 | 0.101 |
| `mtnslope` | 639,145 | 49 | 127.04 / 89.19 | 115.19 / 89.48 / +24.06 | 0.699 |
| `pondside` | 966,395 | 76 | 104.74 / 45.52 | 107.68 / 88.56 / **-13.61** | 0.553 |
| `meadownight` | 838,680 | 50 | 5.89 / 3.64 | 2.63 / 3.22 / +0.27 | -0.251 |
| `machine` | 1,107,645 | 100 | 22.30 / 17.65 | 43.06 / 41.66 / +6.73 | 0.448 |
| `smelterhero` | 1,206,596 | 100 | 52.26 / 47.64 | 70.17 / 80.91 / +7.55 | 0.448 |
| `ruin` | 1,151,358 | 104 | 90.71 / 151.72 | 98.95 / 121.59 / +4.94 | 0.349 |
| `ruinwall` | 1,176,792 | 105 | 96.90 / 79.80 | 80.82 / 84.57 / +21.18 | 0.349 |
| `basedusk` | 1,360,219 | 112 | 62.53 / 52.34 | 94.10 / 128.94 / +10.97 | 0.203 |
| `station` | 36,257 | 36 | 12.70 / 9.57 | 18.91 / 11.36 / +3.56 | 0.499 |
| `flyover` | 227,637 | 26 | 121.66 / 54.05 | 139.23 / 67.98 / **-0.18** | 0.553 |
| `flyovernoon` | 216,457 | 32 | 141.90 / 61.13 | 152.58 / 52.60 / **+6.62** | 0.897 |
| `flyoverlow` | 239,925 | 26 | 105.52 / 45.76 | 131.62 / 95.69 / +16.86 | 0.203 |
| `forestair` | 251,873 | 27 | 93.57 / 27.77 | 123.73 / 94.54 / **-7.38** | 0.550 |
| `forestairnoon` | 227,297 | 27 | 107.85 / 32.70 | 133.03 / 92.33 / **-0.96** | 0.736 |
| `forestairlow` | 264,161 | 27 | 82.02 / 26.97 | 119.69 / 110.59 / +12.65 | 0.198 |
| `limb` | 52,913 | 21 | 68.10 / 135.51 | 25.70 / 11.67 / -5.08 | 0.303 |

**The `warm` column is R2's rank 3 answered.** R2 read all four daylight aerial
poses negative. Today `flyovernoon` is **+6.62**, `flyoverlow` +16.86,
`forestairlow` +12.65, `flyover` **-0.18** and `forestairnoon` **-0.96** are
inside a count of zero, and only `forestair` at **-7.38** is meaningfully cold.
Every ground pose is warm-positive except `pondside` (the water, R2's stated
exception, reproduced) and `limb` (space). That row is closed as a level. What
it cost is section 3.4 and section 5's rank 1.

**`station` came back INTERIOR for the fifth consecutive audit**, 36,257
triangles, 36 calls, `world` 18.91. Re-flagged, not re-diagnosed.

### 2.2 The one new pose (RN-2366), and the reason for it

`npm run check:probes` re-run and PASSES; the row is in `SHOTS` **and** in the
pose-dispatch chain, which that chain's own comment demands in capital letters.

| shot | scenario | pose | why it had to be added |
|---|---|---|---|
| `smelternight` | `walk` | `smelterhero`'s pose, standoff, bearing and all twelve rectangles TO THE DIGIT, derived by spread, sun dot **-0.25** | **Rank 12 of two audits is "nothing emissive lights anything" and every frame that claim has ever rested on is a DAYLIT one.** A daylit frame cannot separate an emissive that contributes nothing from an emissive the sun is drowning, and that distinction is the entire question a lane would be dispatched to answer. This is the only frame in the file where a hot machine is the brightest object in the world. dot -0.25 is `meadownight`'s own pin, so the two night frames share one sun. |

Derived by spread and not transcribed, for `meadownight`'s own stated reason: a
copied rectangle block is a second authority that drifts. That matters more here
than usual, because the twelve inherited rectangles already split the subject
into the emissive surfaces (`firebox` excludes both emissive parts by its own
manifest note; `peep` and `strip` are the two untextured emissive slabs) and the
clean shell and brick that contain no fire (`plate`, `sunface`, `hearthL`,
`hearthR`). **The instrument for rank 12 already existed inside `smelterhero`'s
manifest; all it was missing was an hour when the sun was not louder than it.**

**`smelternight`:** 691,448 triangles, 55 calls, sun pinned to -0.250. Shipped:
`box` 81.93 / iqr 163.46, `world` **31.96**. Its numbers are in section 4.

---

## 3. THE SCORES, ONE PARAGRAPH EACH

Scored **at bar / acceptable / behind / blocking** against my own knowledge of
what a Space Engineers landscape frame looks like, judged by eye with the
evidence frame named. The instruments are rails; the eye is the verdict
(FIDELITY-GAP section 3, Option D). **R2's own closures are re-judged here, not
inherited.**

### 3.1 The atmosphere's architecture: **AT BAR**
One analytic Rayleigh/Mie integral with the uniform record shared by reference
between the sky material, both terrain materials, the carpet and the props, so
nothing in the frame can disagree with anything else about the air. Three audits
have called this at bar and it has now absorbed a warm aerosol tint (L3) and two
new terrain programs (L1) without a single frame disagreeing with itself. The
architecture is not what is wrong with the distance; what the air is SET to is,
and that is 3.4 and rank 1. *Evidence: every frame in 2.1.*

### 3.2 The limb from orbit: **AT BAR**
`RN2365_limb.png`. `ring` 92.43 / iqr 95.87 / sat 0.607 over a `space` box at
0.09, at 52,913 triangles and 21 calls, **bit-identical to R2 through five
lanes**. And one of R2's two reservations is half paid without anyone aiming at
it: the sunlit disc is no longer a featureless pale ball. L1's massif term is
compiled into the SCALED program, and the disc now carries visible continental
mottling and warm ochre marks. The other reservation is unmoved and creeping the
wrong way: the terminator still carries **stepped LOD ribbons with chromatic
fringes**, `seam` iqr 59.39 at R1, 63.21 at R2, **64.27** today.

### 3.3 Aerial perspective as a system: **AT BAR, and it is now mis-tuned rather than mis-built**
The ramp is monotone and correctly ordered at every rung, the near field is
untouched by the ranged term (`vista.nearG` 26.75 shipped against 27.64 with the
aerosol removed, a 3 per cent move that is the positive check the arm is
ranged), and the distance no longer goes white. What has gone wrong since R2 is
a setting and it is in 3.4. *Evidence: `RN2365_flyover.png`, `RN2365_vista.png`.*

### 3.4 Colour composition at range: **BLOCKING, and it is the new number one**
Three readings of one thing, and the first is new since R2. **(a) The distance
goes CREAM, not blue.** `vista.hzBand` warm is **+48.36** against a `skyHz` at
**-12.14**, a 60.5-count seam of opposite hue where the ground and the sky meet;
R2 measured +22.46 against -23.45, a 45.9-count seam. The wall got brighter, not
thinner. Aerial perspective's defining behaviour is that a distant surface
shifts toward the colour of the sky in front of it; ours shifts away from it, at
every hour. This is L3's `aerosolTint` bias (0.40, 0.31, 0.22) doing exactly what
it was asked to do and exactly what nobody scored. **(b) The dawn anti-solar
bearing went the wrong way.** R2's rank 10 was "`vistadawn.skyR.warm` +15.86
where the anti-solar sky should be blue-violet, and `dawnsun.skyUp` does cross to
-11.81, so the term exists". Today `vistadawn.skyR` is **+25.58** and
`dawnsun.skyUp` is **+7.19**: the one bearing that used to be blue no longer is.
L3's own verifier published this as a disclosed side effect and it is correct to
have published it; it is scored here as the regression it is. **(c) The mountain
understorey is still mint and nothing touched it.** `RN2365_mtnslope.png` puts
pale seafoam spikes that read as frosted glass on a cream dust substrate beside
near-black rock slabs. R2 named this inside rank 3; L3's lane closed rank 3's
aerial half and never went near this one.

### 3.5 The terrain material and relief past 75 m: **BEHIND, down from BLOCKING**
`RN2365_vistanoon.png` against `RN2285_vistanoon.png` is the single largest
improvement in this audit and it should be said plainly first: where R2
photographed a smooth featureless cream blur, the same massif now carries a
crinkled wind-scoured relief with readable ridges and hollows, and
`vistanoon.mid` iqr goes **4.86 -> 8.07** in shipped air. From the air the same
change is `flyovernoon.under` under `?canopy=0`, **6.07 -> 13.71**. That is the
middle distance genuinely built. **Two honest reservations and the second is
rank 1's other half.** The material is one homogeneous crumpled substance at
every scale: no rock against scree against strata, no large-scale occlusion, no
shadowed faces, and at 4x it is a strongly horizontally smeared grain that reads
as brushed metal rather than stone (`vista`'s own massif at 4x). And **the 4.7
km ridge has not moved at all**: `vista.hzBand` iqr 2.21 today against R2's
2.07, and `?horizon=0` reads **2.78**, i.e. in shipped air L1's whole term is
worth *less than nothing* at that range. Section 4 says why, and it is not the
material.

### 3.6 The mid field at a standing eye: **BLOCKING, and the plate MOVED rather than closed**
`RN2365_meadowfield.png`, `RN2365_midfield.png`, and this is a re-judgement of
an R2 closure. L4's number is real and reproduces: `meadowfield.r100` iqr
**55.70**, against a bare-substrate ceiling of 42.57 under `?grass=0`: the
carpet now ADDS contrast at 100 m where before it destroyed it. But the same
control one band nearer says the defect is not gone, it is in a different place:
at **r55 the carpet reads 21.56 against a bare 55.76**, and at **r25 29.48
against 51.84**. The carpet is still destroying 61 per cent of the ground's own
contrast from roughly 25 to 60 m, and it is doubling the brightness there while
it does it (r55 luma 147.73 shipped against 73.91 bare). By eye the plate at
`midfield` is exactly what R2 described, one range band closer to the feet.
L4's `(30, 70)` handover window fixed the far end of its own gap and its near
end is where the gap now lives.

### 3.7 Ground cover in the near field, 0 to 25 m: **ACCEPTABLE**
`RN2365_meadow.png`. Still the largest single change of the whole campaign and
still not a Space Engineers sward, for the reason L5 disclosed rather than hid:
the texture's blades are narrower and more numerous (`box` iqr 55.05 -> 56.47),
and **the card's own physical silhouette is unchanged on purpose**, so at a
standing eye the frame still reads as wide flat leek or iris leaves. L5's owed
item 1 is the whole of the remaining gap and it is honestly stated in its own
record.

### 3.8 Shadows: **ACCEPTABLE, and R2's rank 2 is genuinely closed**
`RN2365_flyovernoon_canopy0.png` against `RN2285_flyovernoon_canopy0.png`. The
hard, regular, square-toothed texel staircase that was R2's rank 2 **is gone**:
the boundary is now a soft irregular edge and `flyovernoon.shadowStep` iqr under
`?canopy=0` reads **39.14** against R2's 47.34 and L1's own 45.98 (the extra 6.8
counts are L3's Forest hex lift narrowing the palette step that L2 proved was
the cause, which is a measured cross-lane composition result and worth stating).
`?shadowcast=0` is a working isolator on a ground pose, reproduced here
independently: `smelterhero` `box` 52.26 / 47.64 -> **73.08 / 57.90**, calls 100
-> 55. At ground level the shadows that exist are good where they land. The
forest floor still has **no dappled canopy light at all** at a dot-0.70 sun
(rank 14), and at a low sun the aerial world still casts nothing.

### 3.9 A world-locked lattice on the aerial ground: **BLOCKING, and it is new**
`RN2365_forestair_canopy0.png` is the frame and it is the ugliest in the set, in
the same way R2's staircase frame was: with the vegetation removed the ground
from the feet to the mid distance is a **regular rectangular grid**, plainly
visible at 1x without any crop. Measured (section 4): a dominant repeat at
**12.19 px with a peak/median of 18.78** and an autocorrelation of **0.514 at
lag 10 after its own first local minimum**, and it is present in the shipped
frame with the canopy on at the same strength. It is world-locked, not a
screen-space artefact: the screen period grows from 9.14 px at the far band to
12.80 px at the mid band on one frame, and the sky control shows no repeat at
all. **It survives seven one-flag isolators.**

### 3.10 Vegetation from the air: **BEHIND**
`RN2365_forestairnoon.png`, `RN2365_flyovernoon.png`. R2 reversed two earlier
lanes' "MET" on this pose and I re-took the same frame with fresh eyes: **R2's
reversal stands.** It still reads as hazy shallow water with dark reefs, the
crowns are still blue-black confetti on a pale desaturated field, and the three
tones (crown, ground, haze) still do not belong together. L3 bought 11.34 counts
of whole-frame warm at `forestair` and 12.48 at `forestairnoon` and the read did
not follow, which is the correct outcome to report for a grade change that could
not reach the crown's own chroma. **One of R2's claims does NOT reproduce and is
withdrawn here:** R2 said "at `forestair` the near stand has a hard vertical edge
where the instance tier stops". At 3x that edge is a ragged organic stand
boundary with no straight segment in it (`RN2365_forestair.png` at 700,600). What
looked like a tier cut at 1x is the stand's own shape.

### 3.11 Vegetation assets, near: **BEHIND, and one third of L5's charter did not reach its own frame**
`RN2365_pondside.png` and `RN2365_basedusk.png` carry the win: the broadleaf
crown that R2 called "a papercraft ball of flat pentagons" is now a card spray
with real clumping and gaps, and by eye it reads as foliage. That is L5's
`Canopy_Broadleaf_LOD2` rebuild and it is a clear pass. The trunk under it is
still a bare untapered cylinder with no branches, so the whole reads as a
lollipop, and the conifers on any horizon are still green triangles. **And the
litter is unchanged where the audit complained about it**: R2's words were "pale
cream and hard-edged and reads as paper scraps strewn on dark ground", and
`RN2285_forestfloor.png` against `RN2365_forestfloor.png` at 3x is nearly the
same picture. L5 curled the paddles and never touched the TINT, and its own
record says the litter in this pose is the fern's rather than the two assets it
changed. The fix is real in the `.glb` and absent from the frame it was
chartered against.

### 3.12 The night: **BEHIND, and now measured rather than described**
`RN2365_meadownight.png`, `RN2365_smelternight.png`,
`RN2365_smelternight_lamp0.png`. The sky is still **luma 0.07 at iqr exactly
0.00**: uniform black, no horizon gradient, no airglow, no moon in frame, a
sparse star field with no magnitude variation. What is new is the size of the
headlamp's share. At the smelter, shipped, the frame is at luma 31.96; with
`?lamp=0` it is at **1.81**. **Ninety-four per cent of every photon a player
sees at night beside a running furnace comes out of the headlamp**, and the
headlamp itself is a hard-edged circular pool with a blown-out interior. There
is no other light in the world at night.

### 3.13 Emissive light: **BLOCKING, and this is the finding the new pose bought**
`RN2365_smelternight_lamp0.png`. A running smelter, at night, with the headlamp
off. The two emissive slabs glow (`strip` **26.54**, `peep` **8.95**). Every
other rectangle in the frame is at the ambient floor: `firebox` (the coaming
above the peep, which excludes both emissive parts by its own manifest note)
**0.41**, `plate` (clean shell, 0.3 m from the coals) **2.72**, `sunface` 1.51,
`placard` 3.94, `bandLit` 5.18, `hearthL` **1.61**, `hearthR` **1.94**. The
whole frame reads **1.81** against a bare `meadownight` at the same hour and the
same flag of **2.03**: **a running furnace makes the world measurably darker
than an empty field, because it occludes the sky and returns nothing.** Two
audits inferred this from daylit frames; it is now a measurement, and it is
worse than "no bloom". The emissive is a self-illuminated albedo constant with
no radiometric range at all: it clips to white under the headlamp and reads at
9 to 27 counts without one.

### 3.14 Water: **BEHIND, unchanged**
`RN2365_pondside.png`. Still the best-composed frame in the project, and as a
surface still not at the bar, in every particular R2 named. The water is a
saturated cyan that belongs to no other object in the frame (`box` warm
**-47.53** against a sky at -10.80 and a bank at +20.96, i.e. the pond is still
bluer than the sky it is supposed to be reflecting). The wave field is a regular
parallel corrugation, unmistakable across the whole surface. Nothing is
reflected in it: not the trees on the far bank, not the bank, not the clouds
directly above it. The foam at the sand bar is hard-edged flat polygons. No lane
has touched water since R2 named it and nothing has moved.

### 3.15 The sky and its clouds: **ACCEPTABLE**
`RN2365_vista.png`, `RN2365_vistadawn.png`. A deep blue zenith and a broken deck
with real convergence toward the horizon. The two reservations are R2's,
unmoved, and one of them got worse. **The clouds are lit as flat opacity, not as
volume**: every cell is a soft blob of one value with no lit side, no shaded
underside and no silver edge, and they cast nothing. **The horizon band is a
cream wall** and it is now a brighter one (3.4a).

### 3.16 Snow, rock and scree as materials: **BEHIND, unchanged**
`RN2365_vista.png`, `RN2365_vistanoon.png`, `RN2365_mtnslope.png` all carry flat
white polygons with hard straight edges where snow should be, unmistakable in the
near ground of both vista poses. A3 gave snow a normal and a roughness and left
the flat white albedo `mix` in place on purpose; the visible half is still the
open half, and L1's new material runs under it rather than through it.

### 3.17 The sun disc: **BEHIND, unchanged to the digit**
`RN2365_dawnsun.png`. `sunCore` **204.52** against `glareIn` 204.50 and
`glareOut` 202.99: the brightest object in the world is **1.53 counts** above the
sky beside it, against R2's 1.63. By eye there is still no disc. The aureole is
real, physical and correctly restrained; the thing it is an aureole of is
missing.

### 3.18 Structures, masonry and machines: **ACCEPTABLE**
`RN2365_smelterhero.png` is still the best asset frame in the game and
`RN2365_ruin.png` still the best-composed ground frame. R2's masonry-repeat
reservation is softer than R2 stated: at `ruinwall` each block carries its own
wear and moss and the grid reads as coursing rather than as a tile. What is real
in both frames is the **crushed shadow side**: the ruin's shaded face and the
left wall at `ruinwall` both go toward flat near-black with no sky fill in them,
which is the same missing term as 3.13 seen in daylight.

### 3.19 The voxel cut face: **ACCEPTABLE, improved**
`RN2365_voxelface.png`. R2's "smooth beige blur" now carries a mottled soil
material with dark grain on it (`box` iqr 69.76 against R2's 71.00 is level, but
the frame is not the same picture). What remains is that the cut is a set of flat
facets with hard edges and the texture visibly stretches on the near-vertical
ones.

### 3.20 Frame cost: **ACCEPTABLE**
`meadow` at 2,003,313 triangles is the most expensive frame in the file and is
under `StatsProbe`'s 2.7e6 ALERT, unmoved from R2 to 87 triangles. The aerials
are 216k to 264k, the vista set 572k to 750k, and L4's own pass measured the
frame time DOWN. **No absolute millisecond is quoted anywhere in this audit.**

---

## 4. THE CONTROLS

Nineteen arms, fresh process each, same build, same server, all one flag except
the one two-flag arm which is labelled.

### 4.1 The far ridge, and it is the decisive block of this audit

`vista` and `vistanoon`, iqr, `hzBand` is the 4.7 km ridge and `mid` the middle
distance.

| arm | `vista.hzBand` | `vista.mid` | `vista.nearG` | `vistanoon.hzBand` | `vistanoon.mid` |
|---|---:|---:|---:|---:|---:|
| shipped | **2.21** | 14.41 | 26.75 | **2.07** | 8.07 |
| `?horizon=0` (today minus L1) | **2.78** | 15.35 | 23.67 | 2.00 | 5.07 |
| `?aerosol=0` | **7.07** | 21.52 | 27.64 | 5.14 | 12.21 |
| `?aerosol=0` **and** `?horizon=0` (TWO flags) | **5.49** | 19.13 | 24.85 | 4.28 | 11.36 |

Four readings out of that table.

**1. The two-flag arm reproduces R2's committed bare-air figures to the digit**
(5.49, 19.13, 4.28, 11.36), which is what makes the other three rows readable.

**2. L1's term is delivering, and the air removes all of it at 4.7 km.** Bare
air, L1 is worth 5.49 -> 7.07, +29 per cent. In shipped air the same comparison
is 2.78 -> 2.21, i.e. **negative**. At the middle distance it is positive in
both (`vistanoon.mid` 5.07 -> 8.07 in air), so this is a statement about one
range band and not about the term.

**3. The ground and the air are the same brightness there.** `vista.hzBand`
luma is **184.03** shipped and **186.09** with the aerosol scaled to zero: two
counts. So at 4.7 km the airlight is not lifting the ridge, it is only
multiplying its contrast, and the multiplier is 2.21/7.07 = **0.313**. A surface
whose mean matches the air in front of it and keeps 31 per cent of its own
contrast cannot separate from that air by value at any material budget. **The
lever at that range is the air, not the ground**, which is L1's own routed
question answered.

**4. THE TONE CURVE IS NOT THE CULPRIT, AND THIS AUDIT WAS WRONG ABOUT IT BEFORE
IT MEASURED.** The hypothesis was that a ridge sitting at display luma 184 to 190
is deep in the ACES shoulder and is being crushed by the curve rather than by the
air. `?curve=0` restores the RN-10 straight line:

| pose | rectangle | shipped | `?curve=0` |
|---|---|---:|---:|
| `vistanoon` | `hzBand` iqr | 2.07 | **2.07** |
| `vistanoon` | `nearG` iqr | 20.36 | **24.14** |
| `vistanoon` | `box` iqr | 6.12 | 8.20 |
| `vista` | `hzBand` iqr | 2.21 | 2.93 |
| `vista` | `nearG` iqr | 26.75 | 28.85 |
| `meadow` | `nearG` iqr | 54.63 | 66.37 |
| `meadow` | `hzBand` iqr | 3.99 | 4.65 |

At `vistanoon` the far ridge moves **0.00 counts** while the near ground moves
+3.78 and a meadow's near ground moves +11.74. If the shoulder were crushing the
distance, the distance is where straightening it would pay most; it pays least,
everywhere. **The far ridge is flat because there is nothing there to survive the
air, not because the curve flattened it.** Published as a null so that nobody
spends a lane on a grading fix for rank 1.

### 4.2 The lattice, and twelve nulls is the pattern this file already names

At `forestair`, a 256 x 128 px patch of mid ground at (900, 620), reported as a
1-D DFT of the column means (DC and the lowest three bins removed) and as the
first local autocorrelation MAXIMUM **after** the first local minimum, because a
decaying autocorrelation's global maximum is always at the smallest lag and is a
smoothness measure (NUMBERS.md).

| arm | dominant period, across | peak / median | autocorr max after first min | patch std |
|---|---:|---:|---:|---:|
| shipped | 12.19 px | 18.78 | **0.514 at lag 10** | 5.99 |
| `?canopy=0` | 12.19 px | 19.69 | **0.622 at lag 10** | 6.21 |
| `?treeline=0` | 12.19 px | 19.69 | 0.622 at lag 10 | 6.21 |
| `?splat=0` | 12.80 px | 19.08 | 0.514 at lag 10 | 5.99 |
| `?splatfar=0` | 12.80 px | 19.08 | 0.514 at lag 10 | 5.99 |
| `?groundtexamp=0` | 12.19 px | 18.78 | 0.514 at lag 10 | 5.99 |
| `?terrainart=0` | 12.80 px | 19.44 | 0.574 at lag 10 | 5.86 |
| `?split=0.7` (finer mesh) | 12.19 px | 20.42 | 0.617 at lag 10 | 6.20 |
| **`?split=2.8`** (coarser mesh) | no peak in band | 4.32 | **none: smooth to lag 176** | **3.19** |

And at `flyovernoon`, `?horizon=0` leaves it at 13.47 px against the shipped
14.22, i.e. **L1's two new rungs are not carrying it either.**

**It is world-locked and the instrument has both controls.** On one frame the
screen period grows with proximity (9.14 px at y540, 12.80 px at y660, no peak
in band at y820), which a screen-space dither cannot do. A sky patch on the same
frame returns **no local maximum at all** (best after the first minimum is
-0.224), which is the negative control.

**What `?split=2.8` actually proves, said carefully.** It removes the lattice AND
every other trace of ground material at that range (`RN2365_forestair_canopy0.png`
against `_split28.png`: the right half is a featureless grey-brown plane). So it
locates the lattice inside the terrain material's own footprint-keyed ladder
rather than convicting one term, and it says something else worth having: **at a
coarse mesh the aerial ground has no material at all**, because every far-field
art term in this build is footprint- or mesh-dependent.

**This is RN-2305's situation exactly**, "twelve controls, twelve nulls, and no
candidate left, because a one-flag control can only ask about a term somebody
already thought to give a flag to", and this audit does not have the slice to
paint a shader intermediate. The finding is published undiagnosed, with the
seven nulls, the world-lock proof and the two controls, and the lane's **first
deliverable is a painted intermediate, not a thirteenth flag.**

### 4.3 The rest

| arm | pose | what it says |
|---|---|---|
| `?canopy=0` | `flyovernoon` | `under` iqr 73.40 -> **13.71** against L1's own 13.78 and R2's 6.07. The audit's decisive aerial number, reproduced. `shadowStep` 39.14 against R2's 47.34: the staircase keeps softening. |
| `?canopy=0` | `forestair` | whole-frame warm -7.38 -> **-4.84**, against L3's verifier's -4.49. So most of `forestair`'s residual cold is still the TREELESS frame and not the self-shadow law, exactly as that correction said. |
| `?prophaze=0` | `forestair` | warm -7.38 -> **-5.37**, +2.01 against L3's measured +2.00. |
| `?prophaze=0` | `forestairnoon` | warm -0.96 -> **+0.41**, +1.37 against L3's measured +1.37. Both reproduce to two decimals; the routed `FoliageTone`/`PropSkyAmbient` residual is real and is what is left. |
| `?grass=0` | `meadowfield` | the substrate ceilings in 3.6: r25 51.84, r55 55.76, r100 42.57 against a shipped 29.48 / 21.56 / 55.70. |
| `?shadowcast=0` | `smelterhero` | `box` 52.26 / 47.64 -> **73.08 / 57.90**, calls 100 -> 55, against L2's 52.07 / 47.57 -> 72.93 / 57.74. L2's repaired isolator verified by a lane that did not build it. |
| `?lamp=0` | `smelternight` | 3.13's whole table. Frame 31.96 -> **1.81**. |
| `?lamp=0` | `meadownight` | frame 2.63 -> **2.03**, `nearG` 5.68 -> 2.35. The night's true floor with no player light in it. |
| `?canopyshade=1` | `forestfloor` | section 4.4. |

### 4.4 Rank 17's owed frame pair, taken, with an answer

`RN2365_forestfloor.png` against `RN2365_forestfloor_canopyshade1.png`. **The arm
is armed and says so**: `scatter.canopyShade` reads `false` and `true` across the
pair, which is the arming proof this catalogue demands. Triangles 1,286,315 ->
**1,240,925** (-45,390), `box` 29.63 -> 30.07, whole frame 43.19 -> 42.25.

**By eye, on this build, the thinned arm is BETTER**, and that reverses
rendering.md 2.14.7b's own judgement. It opens patches of bare dark ground under
a closed canopy, which is what a real closed-canopy floor looks like, and it
removes some of the pale-litter clutter 3.11 complains about. 2.14.7b judged it
worse and 2.14.7b was measuring a different build: since then the carpet landed
(RN-2145), the Forest hex was lifted 26 per cent (L3) and the litter changed
(L5). This is not a defect in that judgement; it is a judgement whose subject
moved. **Admin's ruling now has its frame pair and a recommendation: turn it on,
and take 45,390 triangles back.**

---

## 5. THE RANKED GAP LIST

Ranked by severity first, then by exposure against
[`story_line_outline_v1.txt`](../../story_line_outline_v1.txt). Feasibility:
**(a)** art or tuning inside the current WebGL2/three stack · **(b)** engine
work inside WebGL2 · **(c)** likely needs WebGPU · **(d)** plausibly needs
native. **The residuals the brief named are IN this ranking rather than
re-derived**, and each says where it came from.

| # | Gap | Evidence | Severity | Class |
|---|---|---|---|---|
| **1** | **The distance goes cream instead of blue, and at 4.7 km the ground and the air are the same brightness.** `hzBand` warm +48.36 against `skyHz` -12.14 (R2: +22.46 / -23.45); ground and airlight within 2 counts of each other at that range with 31 per cent of contrast surviving; dawn's anti-solar bearing crossed from -11.81 to +7.19. This is L3's `aerosolTint` warm bias, the vista bare-air shortfall and R2's ranks 9-second-half and 10, and they are ONE item because one constant drives all of them. | 3.4, 4.1; `RN2365_vista.png`, `RN2365_vistadawn.png`, `RN2365_vista_aerosol0.png` | **BLOCKING** | (a) |
| **2** | **A world-locked rectangular lattice on the aerial ground**, autocorrelation 0.51 to 0.62 at its own lag, surviving seven one-flag isolators and both `?split` directions in the way that locates it in the material's footprint ladder. R2's staircase's successor. | 3.9, 4.2; `RN2365_forestair_canopy0.png` | **BLOCKING** | (b) |
| **3** | **Emissives light nothing, at all.** A running furnace at night puts its own frame BELOW an empty meadow at the same hour; the plate 0.3 m from the coals reads 2.72. R2 rank 12, now measured rather than inferred. | 3.13, 4.3; `RN2365_smelternight_lamp0.png` | **BLOCKING** | (b) |
| **4** | **The mid field's plate moved in rather than closing.** The carpet destroys 61 per cent of the ground's contrast from 25 to 60 m (r55 21.56 against a bare 55.76) and doubles its brightness while doing it. L4's own `(30, 70)` window's near end. | 3.6, 4.3; `RN2365_midfield.png`, `RN2365_meadowfield_grass0.png` | **BLOCKING** | (b) |
| **5** | **The night is one headlamp cone.** 94 per cent of the light in a night frame beside a furnace is the lamp; the sky is luma 0.07 at iqr 0.00 with no gradient, no airglow and no moon; the lamp is a hard-edged pool with a blown interior. R2 rank 6, and it now composes with rank 3. | 3.12; `RN2365_smelternight.png`, `RN2365_meadownight.png` | CLEARLY BEHIND | (a) for the sky ladder, (b) for the lamp |
| **6** | **The far material is one substance, horizontally smeared, with no sub-massif form.** The middle distance is built; what it is made of is not rock against scree against strata, it has no large-scale occlusion, and at a grazing angle it is anisotropically under-filtered into brushed grain. R2 rank 1's residue after L1. | 3.5; `RN2365_vistanoon.png`, `RN2365_vista.png` | CLEARLY BEHIND | (a) for the layer set, (b) for occlusion; **(c) only** for real geometric displacement, and that question should still be re-asked after the (b) version |
| **7** | **Water is one pond, over-cyan, corrugated, unreflective, and its foam is polygons**; the Ocean biome is still coloured ground. R1 gap 11, R2 rank 7, untouched. | 3.14; `RN2365_pondside.png`; `box` warm -47.53 against a sky at -10.80 | CLEARLY BEHIND | (a) for the palette and the wave field, (b) for a reflection and for ocean surfaces |
| **8** | **The crowns are still blue-black confetti and the wood still reads as reefs.** The routed `FoliageTone` canopy desaturation and `PropSkyAmbient`'s blue sky fill, twice called ready, are what is left after L3 took the haze's own share (+2.01 / +1.37 measured here). | 3.10, 4.3; `RN2365_forestairnoon.png` | CLEARLY BEHIND | (a) |
| **9** | **The mountain understorey is mint and reads as glass** on a cream dust substrate beside near-black slabs: three palettes that do not belong together. Named inside R2's rank 3 and never touched. | 3.4c; `RN2365_mtnslope.png` | CLEARLY BEHIND | (a) |
| **10** | **Snow, rock and scree read as paint.** Flat white polygons with hard straight edges at three poses. R1 gap 10, half closed by A3, visible half still open. | 3.16; `RN2365_vista.png`, `RN2365_mtnslope.png` | CLEARLY BEHIND | (a) |
| **11** | **Clouds round 2: shape and lighting.** Flat-opacity blobs with no lit side, no shaded underside, no ground shadow. | 3.15; `RN2365_vistadawn.png` | CLEARLY BEHIND | (a) for lighting and shape, (c) for volumetrics |
| **12** | **Litter and trunks: the third of L5's charter that did not reach a frame.** Pale cream hard-edged paper scraps at `forestfloor`, unchanged in tint; the broadleaf trunk is a bare untapered cylinder under a good crown. | 3.11; `RN2365_forestfloor.png`, `RN2365_basedusk.png` | CLEARLY BEHIND | (a), authoring |
| **13** | **The sun disc is 1.53 counts.** R1 gap 16, A4's dark speck, R2 rank 11, still undiagnosed. | 3.17; `sunCore` 204.52 vs `glareOut` 202.99 | CLEARLY BEHIND | (a) once diagnosed |
| **14** | **The forest floor has no dappled canopy light** at a dot-0.70 sun; and shadow sides everywhere crush toward black for want of a sky fill on non-terrain surfaces. | 3.8, 3.18; `RN2365_forestfloor.png`, `RN2365_ruin.png` | CLEARLY BEHIND | (b) |
| **15** | **The station is INTERIOR for the fifth audit and the interior is unlit.** `world` 18.91. | `RN2365_station.png` | BLOCKING for the spine, out of this domain | (b) |
| **16** | **Stars in a blue daylight sky at 1,200 m.** R1 gap 13, unchanged, visible in all six aerial frames. | `RN2365_flyover.png`, `RN2365_forestairnoon.png` | CLEARLY BEHIND | (a), a curve |
| **17** | **Stepped LOD ribbons with chromatic fringes on the orbital terminator.** `seam` iqr 59.39 -> 63.21 -> **64.27** across three audits. | `RN2365_limb.png` | CLEARLY BEHIND | (b) |
| **18** | **The near grass card's physical silhouette.** L5's own owed item 1: the texture is fixed and the card is not, so a standing eye still reads leek leaves. Needs its own capture-and-tune budget against RN-2145's shimmer floor. | 3.7; `RN2365_meadow.png` | ACCEPTABLE | (a), authoring |
| **19** | **The voxel cut face stretches.** Material reaches it now; the facets are hard-edged and the texture smears on near-vertical ones. | 3.19; `RN2365_voxelface.png` | ACCEPTABLE | (b) |
| **20** | **`CANOPY_SHADE` is default OFF and Admin's ruling is open.** **The owed frame pair exists now and recommends ON** (4.4). | 4.4 | ACCEPTABLE (a decision) | (a) |
| **21** | **No large-scale terrain occlusion in valleys.** R1 gap 14, unchanged; folded into rank 6's (b) half. | `RN2365_vista.png` | ACCEPTABLE | (b) via a horizon map |
| **22** | **Foliage aliasing in motion.** UNMEASURED for the third audit running: FXAA only on an alpha-tested scene, and a still frame cannot show shimmer. | -- | UNMEASURED | (b), expensive |

**Nothing in ranks 1 to 14 argues for native.** The one honest (c) is real
geometric displacement at range inside rank 6, and rank 6's own (a) and (b)
halves should be built and re-measured before anyone argues it. That is R1's and
R2's ruling on the same item and it still holds.

---

## 6. THE QUEUE: THE TOP FIVE LANES

Ordered so each one's measurement is available to the next. **File seams are
stated as intra-file partitions, not as a claim of no collision**, which is R2's
own correction: where two lanes must touch one file, the boundary inside the
file is named and one owner is named per side (NUMBERS.md's standing rule that a
shared wiring file is a predictable collision point).

### M1. THE DISTANCE GOES BLUE (rank 1): **sonnet**
Make aerial perspective shift a distant surface TOWARD the sky in front of it
instead of away from it, at every hour, without giving back the aerial warm
crossing L3 bought. The mechanism is one constant doing two jobs: `aerosolTint`
is currently a flat spectral bias applied at every path length, so the same
warmth that correctly reddens a short high-sun path also paints a 4.7 km ridge
and a dawn anti-solar sky cream. **The shape of the fix is a tint that varies
with OPTICAL DEPTH** (Mie-warm at short path, Rayleigh-blue as the path grows),
which is physically the right law and is why one term can serve both ends.
**Owns:** `web/src/render/materials/Atmosphere.glsl.ts` and `Atmosphere.ts`
(the whole file, including `aerosolTint`), and
`web/src/render/materials/BiomePalette.ts`'s hue rows.
**Must not touch:** `Terrain*` geometry, the splat weights or
`TerrainHorizon*` (M2's), `render/grass/*` (M4's), `render/post/*`.
**Done when:** `vista.hzBand` warm falls below `skyHz` warm at both `vista` and
`vistanoon` (today +48.36 against -12.14), `dawnsun.skyUp` returns below zero
(today +7.19) and `vistadawn.skyR` falls (today +25.58), **and** whole-frame
`warm` stays at or above zero at `flyovernoon` (+6.62), `flyover` (-0.18) and
`forestairnoon` (-0.96), with no ground pose crossing sign. Sonnet: the cause is
stated, the frames and the pass table already exist, and L3's own sweeper
(`web/tools/smoke/rn2320sweep.mjs`) is the instrument.

### M2. THE AERIAL LATTICE (rank 2): **opus**
Find what paints a world-locked 12 px repeat on the aerial ground and remove it.
**Its first deliverable is a diagnosis and its first arm is a painted shader
intermediate, not a thirteenth one-flag control**: seven are already null and
NUMBERS.md's RN-2305 entry says exactly why adding an eighth cannot help.
**Owns:** `web/src/render/materials/Terrain*` **excluding** `TerrainCoverFar*`
(M4's) and the cascade half of `TerrainFragLight.glsl.ts`, plus
`web/src/world/ChunkBatch`'s attribute upload.
**Must not touch:** `Atmosphere*` or `BiomePalette` (M1's), `render/grass/*`
(M4's), `ShadowRig`/`ContactPass`.
**Done when:** the patch at `forestair` (900, 620) under `?canopy=0` has no
autocorrelation local maximum above 0.25 after its own first minimum (today
0.622 at lag 10) with the patch std held at or above 5.0, i.e. the repeat goes
and the material does not; the sky negative control still returns none; and
every committed rectangle in this file moves inside a stated band. Opus because
its first job is a diagnosis against an instrument space that has already
returned seven nulls.

### M3. EMISSIVES THAT LIGHT SOMETHING (rank 3, and rank 14 comes with it): **opus**
A hot surface must light what is near it. The measured state is that it lights
nothing: `plate` 2.72 at 0.3 m from coals at `strip` 26.54, and a running
furnace darkens its own frame below an empty field. **Owns:**
`web/src/render/instancing/MachineBatch`'s emissive path,
`web/src/render/materials/PropSkyAmbient.ts`, `web/src/render/Headlamp.ts` and
`web/src/render/post/*`'s bloom stage.
**Must not touch:** terrain materials (M2's), `Atmosphere*`/palettes (M1's),
grass (M4's).
**Done when:** at `smelternight` under `?lamp=0`, `plate`, `sunface` and `band`
rise by a stated factor off today's 2.72 / 1.51 / 4.74 while `hearthL` and
`hearthR` (the far columns) stay inside a stated band of today's 1.61 / 1.94, so
the light is LOCAL and not a global lift; the whole frame clears
`meadownight`'s own 2.03 rather than sitting below it; and every daylit machine
rectangle at `machine` and `smelterhero` moves inside a stated band. Opus: the
cheapest correct mechanism here (a small set of dynamic point lights against
three's per-material light limits, versus a screen-space or baked approximation)
is a design decision with a real WebGL2 constraint behind it, and picking it is
the first half of the work.

### M4. THE MID FIELD, NEAR END (rank 4): **sonnet**
L4 proved the mechanism and fixed the far end of its own window; this is the
near end. From 25 to 60 m the carpet reads 21.56 against a bare substrate at
55.76 and doubles the brightness while doing it, so the same "wall of instances
at a grazing eye" law is still running one band closer to the feet. The lever is
the same one L4 already wired and argued safe: the far rung's `uOut` handover,
plus the near tuft's own `TUFT_OUT_LO_M`/`TUFT_REACH_M` pair, and probably a
value-variance term rather than only a density one, since thinning alone cannot
give a screen row contrast it never had. **Owns:** `web/src/render/grass/*` and
`web/src/render/materials/TerrainCoverFar*`.
**Must not touch:** the splat layers or the terrain material (M2's), palettes
and `Atmosphere*` (M1's).
**Done when:** `meadowfield.r25` and `.r55` clear a stated fraction of their own
`?grass=0` ceilings (51.84 and 55.76) against today's 29.48 and 21.56, `r100`
holds at or above 55.70, `r4` and `r10` stay inside a stated band, `midfield`'s
plate carries visible structure by eye, and `meadow` stays under the 2.7e6
ALERT. Sonnet: the cause is measured, the instrument exists and the mechanism is
one the same file already runs.

### M5. THE NIGHT (rank 5): **sonnet**
Give the night an ambient ladder, a horizon gradient, airglow, a star field with
magnitude and colour, and a headlamp with a falloff instead of an edge. Runs
after M3 because M3 changes what else is in a night frame and M5 must not be
tuned against a world where the only light is the lamp. **Owns:**
`web/src/render/materials/SkyStars.ts` and the sky's night branch,
`web/src/render/TerrainAmbient.ts`'s night rungs, and `Headlamp.ts`'s cone
shaping. **`Headlamp.ts` is shared with M3, partitioned inside the file: M3
owns the emissive/lighting registration, M5 owns the cone and falloff
constants**, and M5 runs after M3 so the two are serialised as well as
partitioned.
**Must not touch:** `Atmosphere*`'s daylight terms (M1's), terrain materials
(M2's).
**Done when:** `meadownight.skyHi` iqr leaves exactly 0.00 and the sky carries a
measurable horizon gradient, `meadownight` under `?lamp=0` clears a stated floor
above today's 2.03 by starlight alone, the lamp's edge is gone by eye, and every
DAYLIT committed rectangle in this file is bit-identical. Sonnet: the cause is
stated and every done-when is a named rectangle.

**Sixth and behind them, in order:** the far material's layer set and occlusion
(rank 6); water (rank 7); the canopy confetti residual (rank 8, and it should be
re-judged AFTER M1 because M1 moves the air the crowns are hazed through);
mountain mint and snow (ranks 9 and 10); clouds round 2 (rank 11); the litter
tint and the broadleaf trunk (rank 12); the sun disc (rank 13). **And three that
are Admin's and not a lane's:** the station's exterior and its unlit interior
(rank 15); the `CANOPY_SHADE` ruling (rank 20), which now has its frame pair and
a recommendation; and foliage aliasing in motion (rank 22), which has been
UNMEASURED for three audits and needs a moving instrument rather than a lane.

---

## 7. THE DELTA REPORT: R2'S ROWS, ONE DAY ON

| R2 rank | gap | today | evidence |
|---|---|---|---|
| **1** | the far ground has no material and no sub-massif relief past ~75 m | **HALF CLOSED, and the half that closed is the half a player looks at.** The middle distance is built: `vistanoon.mid` 4.86 -> **8.07** in air, `flyovernoon.under` under `?canopy=0` 6.07 -> **13.71**, and by eye a smooth cream blur became crinkled relief. The 4.7 km ridge did not move (`hzBand` 2.07 -> **2.21**) and section 4.1 shows the air is why. Sub-massif FORM is still absent: what shipped is grain, not landform. Now rank 6. | `RN2285_vistanoon.png` / `RN2365_vistanoon.png` |
| **2** | a hard texel-staircase shadow region across the aerial mid-field | **CLOSED, and it was never a shadow.** L2 painted the terrain's intermediates and convicted two biome palettes meeting on a coarse vertex grid; L1 broke the boundary and L3 narrowed the palette step. `shadowStep` under `?canopy=0` 47.34 -> **39.14**, and by eye there is not a tooth anywhere. **A different aerial defect is now in that slot (rank 2) and it is not the same one.** | `RN2285_flyovernoon_canopy0.png` / `RN2365_flyovernoon_canopy0.png` |
| **3** | colour composition at range: the world is warm-negative from the air | **CLOSED AS A LEVEL, AND PAID FOR.** Four negative aerial poses became one (`forestair` -7.38); `flyovernoon` -3.26 -> **+6.62**. And the same constant that bought it turned the distance cream and un-blued the dawn anti-solar sky: `hzBand` warm +22.46 -> **+48.36**, `dawnsun.skyUp` -11.81 -> **+7.19**. That is R3's rank 1, and it absorbs R2's ranks 9 and 10 with it. The mint understorey inside R2's rank 3 was never touched and is now rank 9. | `RN2285_vista.png` / `RN2365_vista.png` |
| **4** | the mid field at a standing eye is a uniform plate near the treeline | **MOVED, NOT CLOSED.** `meadowfield.r100` 16.48 -> **55.70** and the carpet now adds contrast at 100 m where it used to remove it. One band nearer, the same law still runs: r55 **21.56 against a bare 55.76**. Still blocking, at 25 to 60 m instead of 70 to 130. | `RN2365_meadowfield_grass0.png` |
| **5** | vegetation assets: brushed-not-bladed blades, chunky near trees, paper litter | **ONE THIRD CLOSED, ONE THIRD DISCLOSED, ONE THIRD DID NOT REACH ITS FRAME.** The broadleaf crown is genuinely fixed and reads as foliage (`RN2365_pondside.png`). The blade card's silhouette is unchanged and L5 said so (rank 18). The litter's TINT was never touched, so the frame R2 complained about is nearly the same picture (rank 12). | `RN2285_forestfloor.png` / `RN2365_forestfloor.png` |
| **6** | the night is unbuilt, plus the stale post-stack sun | **THE INSTRUMENT DEFECT IS CLOSED AND THE DOMAIN IS WORSE THAN R2 KNEW.** `upCheck` reads 0.000 on both night poses now, so L2's RN-2307 fix is confirmed by a lane that did not build it. The night itself: 94 per cent of the light in a night frame is the headlamp (4.3). Now rank 5. | `RN2365_smelternight_lamp0.png` |
| **12** | nothing emissive lights anything | **CONFIRMED, PROMOTED, AND IT IS WORSE THAN THE WORDS.** A running furnace at night makes its own frame darker than an empty field. Now rank 3. | `RN2365_smelternight_lamp0.png` |
| **17** | `CANOPY_SHADE` is default OFF and Admin's ruling is open | **THE OWED FRAME PAIR EXISTS** and recommends turning it on; 2.14.7b's "worse" judgement was made on a build three lanes ago. | 4.4 |
| **7, 8, 11, 13, 14, 15, 16, 18, 19, 20** | water, snow, sun disc, station, stars, orbital ribbons, dapple, voxel face, valley occlusion, motion aliasing | **UNMOVED**, except the voxel face (material reaches it now) and the orbital seam (63.21 -> 64.27, marginally worse for the third audit running). | section 3 |

**Two closed outright, two half closed, one closed and paid for, one moved, one
confirmed and promoted, and ten untouched.** The honest headline is not the
count. It is that **the frontier has moved from SURFACE to LIGHT.** R1 and R2
both found a world whose ground ran out at a stated range; R3 finds a world
whose ground reaches everywhere the eye stops and whose remaining large defects
are all about what lights it and what colour the light is: the air's own hue
(rank 1), a lattice that is a lighting-model artefact by elimination (rank 2),
emissives that emit nothing (rank 3), a carpet that flattens the light on the
ground (rank 4), and a night with one lamp in it (rank 5). **Four of the five
are (a) or (b) and none of them is a new system.**

---

## 8. HONEST GREENS

- **The record reproduces harder than at R2.** Four bare-air control values from
  L1, re-read blind on a build five lanes later, to the digit; `limb`'s ring
  bit-identical for the third audit; `station` to 0.01.
- **The staircase is really gone.** R2's ugliest frame has no successor in the
  same mechanism, and the lane that killed it did so by refusing its own name.
- **The middle distance is a landscape.** `RN2285_vistanoon.png` beside
  `RN2365_vistanoon.png` is the clearest before/after pair this project has
  produced.
- **L2's two instrument repairs both hold under an independent hand.**
  `?shadowcast=0` moves 21 counts on a ground pose and errors nowhere;
  `upCheck` reads 0.000 on both night poses.
- **A null result was published rather than a lane spent.** The ACES-shoulder
  hypothesis for rank 1 was this audit's own and `?curve=0` refuted it at
  `vistanoon` by moving the far ridge 0.00 counts.
- **One pose settled a rank two audits could only infer**, and it cost one
  spread of an existing manifest row.

---

## 9. WHAT THIS AUDIT DID NOT MEASURE, SAID OUT LOUD

- **Anything in motion.** Third audit running. Foliage shimmer, LOD pop,
  streaming hitches and the fade dither are invisible to a settled still frame.
- **Any body but Forge.** The Moon appears as a small cratered disc in two
  aerial frames and no surface of it has ever been photographed; the spine sends
  the player to scan it.
- **Any quality tier but `high`.** Third audit running.
- **Absolute frame times.** No millisecond is quoted anywhere in this document.
- **The station's exterior**, still not reproducible.
- **The lattice's owner.** Located to a family and not to a term, deliberately:
  see 4.2 for why the next step is a paint and not another flag.

---

## 10. FILES

- **Frames:** `docs/screenshots/RN2365_*.png`, 34 files: 25 existing poses, one
  new pose (`smelternight`), and eight control frames
  (`vista_aerosol0`, `vista_aerosol0_horizon0`, `flyovernoon_canopy0`,
  `forestair_canopy0`, `forestair_canopy0_split28`, `forestfloor_canopyshade1`,
  `meadowfield_grass0`, `smelternight_lamp0`). The other eleven arms in section
  4 are published as numbers with their one-line invocations rather than as
  frames, because each is a null whose value is the figure and not the picture.
- **Poses:** `web/tools/smoke/probes/artframe.js`, one new manifest row
  (`smelternight`), derived by spread, with its documented invocation in the
  file header, its reason in its own block, and its name in the pose-dispatch
  chain.
- **Domain memory:** [`docs/controllers/rendering.md`](../controllers/rendering.md)
  section 2.24.
- **Numbers row:** [`NUMBERS.md`](NUMBERS.md), RN-2365 to RN-2384.
