# THE WORLD LOOK AUDIT, ROUND 4, 2026-08-22

> **Lane:** `lane/world-audit-r4` · **Numbers:** RN-2450 to RN-2456 of the
> RN-2450 to RN-2469 block · **Base:** `origin/main` at `4cb0aff4` · **Owner:**
> rendering-controller
>
> The fourth full judgement of the world against the D-020 Space Engineers bar,
> and the third turn of the audit-to-lanes loop. R3's whole top five landed
> between then and now: M1 the depth-varying aerosol, M2 the aerial lattice, M3
> emissive light, M4 the mid field's near end, M5 the night. This pass re-judges
> everything **from scratch**, including R3's own closures and the five lanes'
> own claims, on R3's method with fresh eyes. Section 5 is the ranked list,
> section 6 the top five lanes, section 7 the delta against R3.

---

## 0. THE ONE-PARAGRAPH ANSWER

**Four of R3's five lanes did what they said, one of them by a margin no
instrument in this project had ever measured before, and the frontier has moved
again: from LIGHT to the SURFACE THE LIGHT LANDS ON, and to one screen-space
artefact that is now the ugliest thing in a hero frame.** The distance goes
blue: `vista.hzBand` warm **+48.36 -> -2.07** against a sky at -19.36, so a
60.5-count seam of OPPOSITE hue became a 17.29-count seam of the SAME hue, and
`?aerodepth=0` returns three of R3's four rank-1 figures **to the digit**, which
attributes the whole move to M1 and nothing else. The night exists: an empty
field's sky goes from luma 0.07 at iqr exactly 0.00 to a graded 9.33 to 16.88
with a real star field, and beside a running furnace the headlamp's share falls
from **94 per cent to 69.7 per cent** while the frame beside the fire goes from
*darker* than an empty meadow (1.81 against 2.03) to **1.31x brighter** (10.88
against 8.28). R3's world-locked 12 px lattice is gone and its own isolator
proves it: at R3's patch the autocorrelation local maximum is **absent** where
`?horizoncell=0` puts R3's 0.622 at lag 10 straight back. **Three things now
dominate.** (1) A **new** repeat, and it is not R3's: a **screen-locked 4-pixel
cross-hatch** that lies over the bare ground of the vista site like graph paper
at any sun below about 45 degrees. It is the CONTACT-SHADOW pass's own ordered
dither; six one-flag terrain arms are null and `?contact=0` collapses it while
the patch's own std RISES. (2) **The plains far ground is a flat painted plane.**
R3 called the far material half closed on vista-site evidence; at the three
poses the player actually starts in, past about 130 m there is no material at
all, and `meadow.hzBand` iqr **4.06** has not moved in three audits. (3) **The
world from the air still reads as shallow water with weed beds**, unmoved for
four audits, and it is the first-launch view the storyline spine sends every
player through. Nothing in the top five needs WebGPU or a native client.

---

## 1. METHOD, AND WHAT IT IS AND IS NOT EVIDENCE FOR

**Capture.** Real Windows D3D11 through ANGLE (Chrome, RTX 4060 Ti), 1600x900,
HUD-free through `of.screenshot()`. Served from a `vite preview` this lane owned
on `127.0.0.1:5921`, `--strictPort`, `--host 127.0.0.1`, started from this
worktree's own `dist`.

**Server ownership is a claim with a lifetime and it was re-asserted around
every batch.** One script checks three things at once and refuses if any fails:
the sentinel `dist/of-sentinel-rn2450.txt` fetched back over the port
(provenance), the served `index-*.js` name against the same file on disk
(recency, because a sentinel written before boot keeps passing across any number
of rebuilds -- NUMBERS.md, RN-2305's `sirv` startup-snapshot entry), and
`Get-NetTCPConnection -LocalPort 5921` still naming **PID 7940**, the PID this
lane started and wrote down (ownership, RN-2305's port-theft entry). It ran
before batch one and between all five batches, and every run printed
`match=True ownerOk=True` with `servedJs=diskJs=index-N0u3FIKY.js`.

**The build is HEAD's, proved rather than self-reported.** `git show
HEAD:web/wasm/dist/of-core.wasm | cmp -` against the served wasm: identical.
`client expects 26` in the bundle against `OF_ABI_VERSION = 26` at HEAD. (The
second `client expects 35` is `of_vs_part_info`'s stride check, not an ABI; R3
named it so nobody re-derives it and it is named again here for the same
reason.) The build was made with `npm run build`, not `npx vite build`, so
`sync-wasm` and `sync-assets` both ran.

**This is a one-arm audit of current `main`, so most numbers are a LEVEL.**
Thirty-one cross-arm readings ARE made; every one is a one-flag negative control
in a separate process against the same build, except two two-flag arms which say
so in their own rows. Section 4 lists all of them, including the nulls, the one
that convicted a defect nobody had named, and the one whose result contradicts a
landed lane's published post-lane figure.

**Frames illustrate; the numbers beside them are the evidence. The eye is the
verdict** (FIDELITY-GAP section 3, Option D).

**Reproduction, and it is the strongest this campaign has produced.**

* The four bare-air control figures L1 published, re-read blind through the
  two-flag `?aerosol=0 ?horizon=0` arm on a build **seven lanes later**:
  `vista.hzBand` iqr **5.49**, `vista.mid` **19.13**, `vista.nearG` **24.85** --
  R2's own committed values, to the digit, for the third audit running.
* `?aerodepth=0`, which restores RN-2320's flat blend, returns R3's rank-1
  headline: `vista.skyHz` warm **-12.14** (R3: -12.14), `vistadawn.skyR`
  **+25.58** (R3: +25.58), `dawnsun.skyUp` **+7.19** (R3: +7.19), all three to
  the digit, and `vista.hzBand` **+48.43** against R3's +48.36.
* `?horizoncell=0` returns R3's lattice: **0.622 -> 0.623 at lag 10** with patch
  std 6.21 -> 6.21, at R3's own patch, measured with M2's own committed
  `latmeter.mjs`.
* `?nightsky=0` returns R3's night sky: `meadownight.skyHi` luma **0.07 at iqr
  exactly 0.00**.
* `?grasspatch=0` returns R3's mid field: `meadowfield.r25` **29.51** (R3:
  29.48) and `.r55` **21.42** (R3: 21.56).
* `limb` `ring` **92.43 / 95.87 / sat 0.607** and 52,913 triangles, bit-identical
  to R2 and R3; `station` `world` **18.91**, identical to R3; `vista` 633,577
  triangles and `forestair` 251,873, unmoved.

**Five landed lanes, five one-flag arms, and every one of them puts the world
back exactly where R3 photographed it.** That is what makes every "after" figure
in this document readable as a delta rather than as a level.

**Every shot came back `valid: true`, `poolRefused: 0` and `postState.post ===
true`.** `setup.upCheck` reads **0.000** on all nine poses that publish it,
including both night poses. **A correction to R3's own rails paragraph while we
are here:** R3 says "every one of the 26 poses came back ... `setup.upCheck ===
0.000`". Seventeen of the twenty-six do not publish that field at all -- their
pose branches do not compute it. The claim is true where it is measurable and
over-stated as written.

**One new instrument, and it exists because an old one is structurally blind to
the new defect.** `latmeter.mjs` walks its autocorrelation from `minLag = 4`, so
a repeat whose period IS 4 px sits at or below its floor and returns "no local
maximum" on a frame where the grid is unmissable by eye. Rather than lower that
floor and silently change the meaning of every latmeter reading in the project,
this lane added `web/tools/smoke/rn2450bayer.mjs`, which asks the question a
screen-space ordered dither actually poses: bin every pixel by
`(x mod p, y mod p)` -- the same index a `mod(gl_FragCoord.xy, 4.0)` dither uses
-- and report the spread over the p*p phase means. **Its negative control is
free and is run on the same pixels: at `--p=5` a genuine 4-px dither has nothing
to show**, and section 4.2 publishes that control beside every reading.

**No new poses.** The gates bind and no judged gap in this document lacks a
frame. Two shot-set holes are named in section 9 and RANKED in section 5 rather
than opened at the end of a long lane: a night pose with a fire over open
ground, and any surface of the Moon.

---

## 2. THE FRAMES

`docs/screenshots/RN2450_<shot>.png`. The twenty-six poses of R3's set, re-taken
at `4cb0aff4`.

| shot | tris | calls | box luma / iqr | world luma / iqr / warm | sun dot |
|---|---:|---:|---|---|---:|
| `meadow` | 2,003,313 | 75 | 85.12 / 56.36 | 118.60 / 104.58 / +17.15 | 0.551 |
| `meadowfield` | 1,897,099 | 74 | 101.54 / 59.95 | 116.29 / 85.63 / +16.88 | 0.699 |
| `forestfloor` | 1,286,315 | 75 | 29.59 / 23.99 | 42.93 / 37.35 / +12.15 | 0.701 |
| `midfield` | 705,775 | 49 | 134.72 / **44.21** | 122.05 / 79.91 / +16.54 | 0.699 |
| `voxelface` | 661,726 | 49 | 87.91 / 69.73 | 92.72 / 68.13 / +25.39 | 0.881 |
| `vista` | 633,577 | 50 | 174.53 / 14.48 | 139.78 / 63.58 / **+2.66** | 0.699 |
| `vistadawn` | 740,181 | 50 | 167.56 / 73.18 | 131.55 / 129.49 / +30.52 | 0.101 |
| `vistanoon` | 572,027 | 49 | 185.65 / 6.28 | 154.05 / 58.38 / +8.40 | 0.920 |
| `dawnsun` | 749,487 | 51 | 197.24 / 14.41 | 152.67 / 75.61 / +31.18 | 0.101 |
| `mtnslope` | 639,145 | 49 | 126.91 / 89.27 | 114.98 / 89.55 / +22.60 | 0.699 |
| `pondside` | 966,395 | 76 | 104.60 / 45.46 | 107.34 / 88.28 / **-16.46** | 0.553 |
| `meadownight` | 838,680 | 50 | **8.86** / 6.15 | **8.86** / 8.15 / -3.95 | -0.251 |
| `machine` | 1,107,645 | 100 | 22.05 / 17.58 | 42.90 / 41.42 / +5.47 | 0.448 |
| `smelterhero` | 1,206,596 | 100 | **63.51** / 51.73 | 75.16 / 83.58 / +21.13 | 0.448 |
| `smelternight` | 691,448 | 55 | 82.73 / 147.87 | **35.93** / 15.71 / +26.01 | -0.250 |
| `ruin` | 1,151,358 | 104 | 89.92 / 151.01 | 98.57 / 120.96 / +1.69 | 0.349 |
| `ruinwall` | 1,176,792 | 105 | 96.60 / 79.81 | 80.55 / 84.64 / +19.26 | 0.349 |
| `basedusk` | 1,360,219 | 112 | 62.27 / 52.76 | 93.67 / 128.36 / +8.39 | 0.203 |
| `station` | 36,257 | 36 | 12.69 / 9.57 | **18.91** / 11.36 / +3.54 | 0.499 |
| `flyover` | 225,589 | 26 | 121.37 / 54.97 | 139.45 / 65.84 / -1.77 | 0.553 |
| `flyovernoon` | 216,449 | 32 | 141.58 / 61.98 | 152.80 / 52.43 / +4.91 | 0.897 |
| `flyoverlow` | 239,925 | 26 | 105.37 / 46.63 | 131.64 / 92.53 / +15.46 | 0.203 |
| `forestair` | 251,873 | 27 | 93.39 / 28.49 | 123.53 / 94.12 / **-8.07** | 0.550 |
| `forestairnoon` | 227,297 | 27 | 107.65 / 32.70 | 132.82 / 91.42 / -1.67 | 0.736 |
| `forestairlow` | 264,161 | 27 | 81.94 / 27.06 | 119.58 / 110.30 / +12.17 | 0.198 |
| `limb` | 52,913 | 21 | 68.10 / 135.51 | 25.70 / 11.67 / -5.08 | 0.303 |

**`station` came back INTERIOR for the SIXTH consecutive audit**, 36,257
triangles, 36 calls, `world` 18.91 to the digit. Section 3.21 has the first new
thing anybody has said about it in four rounds, and it is a retraction.

---

## 3. THE SCORES, ONE PARAGRAPH EACH

Scored **at bar / acceptable / behind / blocking** against my own knowledge of
what a Space Engineers landscape frame looks like, judged by eye with the
evidence frame named. **R3's closures and the five landed lanes' own claims are
re-judged here, not inherited**, and where one was generous this says so.

### 3.1 The atmosphere's architecture: **AT BAR**
One analytic Rayleigh/Mie integral with the uniform record shared by reference
between the sky material, both terrain materials, the carpet and the props. Four
audits have called this at bar and it has now absorbed a depth-varying aerosol
tint with an asymmetric sky floor (M1), an additive night branch (M5) and a new
far-field stand-in (M2) without a single frame disagreeing with itself. The
architecture is not what is wrong with anything. *Evidence: every frame in 2.*

### 3.2 The limb from orbit: **AT BAR**
`RN2450_limb.png`. `ring` 92.43 / iqr 95.87 / sat 0.607 over a `space` box at
0.09, at 52,913 triangles and 21 calls, **bit-identical to R2 and R3 through
seven lanes**, and the sunlit disc carries real continental mottling. **And one
of R3's own worries is retracted here: the terminator seam has STOPPED creeping.**
R3 reported `seam` iqr 59.39 -> 63.21 -> 64.27 across three audits and called it
"creeping the wrong way"; today it reads **64.27**, level to the digit. The
defect is unchanged and the trend was two points of noise.

### 3.3 Aerial perspective as a system: **AT BAR**
The ramp is monotone and correctly ordered at every rung, the near field is
untouched by the ranged term, and the distance now shifts TOWARD the sky instead
of away from it. This is the domain R3 called "at bar but mis-tuned"; the tuning
landed. *Evidence: `RN2450_vista.png`, `RN2450_vistanoon.png`.*

### 3.4 Colour composition at range: **ACCEPTABLE, up from BLOCKING, and this is the largest single win of the campaign**
`RN2450_vistanoon.png` against `RN2365_vistanoon.png`. R3's rank 1 was three
readings of one thing and all three moved. **(a)** `vista.hzBand` warm **+48.36
-> -2.07** against a `skyHz` at **-19.36**: R3's 60.5-count seam of OPPOSITE hue
is a 17.29-count seam of the SAME hue, and at `vistanoon` it is 12.09 (+0.91
against -11.18). By eye the far ridge is a blue-grey aerial silhouette where R3
photographed a cream wall. **(b)** `dawnsun.skyUp` warm **+7.19 -> -4.87**: the
anti-solar bearing is blue again, and `vistadawn.skyR` fell +25.58 -> **+19.40**.
**(c)** The mountain understorey is still mint and nothing touched it (3.9).
**Two honest reservations.** M1's own acceptance wording asked for `hzBand` warm
to fall BELOW `skyHz` warm and it does not; the ground is still the warmer of the
two at every hour, and 17.29 counts is a seam a good eye can still see at
`vista`. And the seam is closed at high sun and NOT at mid sun on the aerial
poses: `forestair.hzBand` warm reads **+29.97** against its own `skyBand` at
**-49.28**, which is a 79-count opposite-hue gap at dot 0.55 and is the largest
in the file.

### 3.5 A screen-locked 4-pixel cross-hatch on bare ground: **BLOCKING, and it is new**
`RN2450_vistadawn.png` against `RN2450_vistadawn_contact0.png` is the frame pair
and it is the ugliest picture in the set, in the way R2's staircase and R3's
lattice were before it. With the sun low, the bare substrate of the vista site
from the feet to the middle distance carries a **regular rectangular grid at a
period of exactly four screen pixels**, plainly visible at 1x and unmissable at
4x. Measured (4.2): the 4-px phase spread is **1.791** at dot 0.101, **0.978** at
dot 0.699 and **0.830** at dot 0.920 on one site at one patch, i.e. monotone in
sun elevation; a sky patch on the same frame reads **0.053**, which is the
negative control. **It is the contact-shadow pass's own ordered dither.** Six
one-flag terrain-material arms leave it between 1.772 and 1.838 and `?contact=0`
collapses it to **0.602 while the patch's own std RISES 30.215 -> 33.193**, which
is the shape a conviction needs: the defect goes and the neighbourhood stays. The
mechanism is in the source and it argues for itself: `ContactGlsl.ts`'s
`dither()` is documented as "Period exactly 4 px in both axes, so the 4-tap cross
in the apply resolves it", and **the 5-tap cross does not resolve it.**

### 3.6 The terrain material and relief past 75 m, at the VISTA site: **BEHIND**
`RN2450_vistanoon.png`. The middle distance is a landscape and stayed one:
`vistanoon.mid` iqr **10.07** against R3's 8.07 and R2's 4.86, and from the air
`flyovernoon.under` under `?canopy=0` is **23.49** against R3's 13.71 and R2's
6.07 -- a fourfold rise across three audits and the cleanest monotone trend in
the campaign. What is left is R3's own reservation, unchanged: the material is
one homogeneous crumpled substance at every scale, with no rock against scree
against strata, no large-scale occlusion and no shadowed faces. **And the 4.7 km
ridge has still not moved:** `vista.hzBand` iqr **3.28** against R3's 2.21, with
`?horizon=0` at 2.72, so in shipped air the whole horizon rung is now worth
**+0.56 counts** at that range. That is a sign flip from R3 (where it was
negative) and it is still nothing.

### 3.7 The terrain material at the PLAINS site: **BLOCKING, and this is a re-judgement of an R3 closure**
`RN2450_midfield.png`, `RN2450_meadowfield.png`, `RN2450_ruin.png`. R3 called
R2's rank 1 "half closed, and the half that closed is the half a player looks
at", on evidence taken entirely at the vista site. **At the three poses the
player actually starts in it is not closed at all.** Past roughly 130 m the
ground becomes a flat, uniform, untextured green plane that meets the sky at a
razor-straight horizon with cut-out trees standing on it, and the transition from
"carpet with contrast" to "painted plane" happens at a visible line. The number
agrees and has not moved in three audits: `meadow.hzBand` iqr **4.06** against
R3's 3.99 and R2's own figure. This is the single largest surface gap in the game
and R3 scored it half closed because its evidence came from a mountain.

### 3.8 The mid field at a standing eye: **ACCEPTABLE, up from BLOCKING, with the residue restated**
`RN2450_midfield.png`, `RN2450_meadowfield_grass0.png`. M4 did what it said and
M2's stand-in recovered the regression M4 disclosed. Against the bare-substrate
ceilings under `?grass=0` the carpet now keeps **83 per cent** of the ground's
contrast at r25 (42.92 of 51.67, R3: 57 per cent), **71 per cent** at r55 (38.99
of 54.66, R3: 39 per cent) and **ADDS 45 per cent** at r100 (59.62 of 41.07). By
eye the plate is gone and `midfield`'s box iqr is **44.21** against R3's 28.50.
**The residue is no longer contrast, it is LEVEL, and it is unchanged:** at r55
the carpet reads luma **142.67** against a bare substrate at **72.69**, a 1.96x
lift, against R3's 2.0x. The mid field is a pale-green wash laid over a darker
ground, which is FIDELITY-GAP section 1.1's complaint exactly ("colour SAMPLED
FROM the terrain beneath each instance so ground and cover cannot disagree") in
the one axis nobody has yet spent a lane on.

### 3.9 The mountain understorey: **BEHIND, unchanged, and now three audits old**
`RN2450_mtnslope.png` puts pale seafoam spikes that read as frosted glass on a
cream dust substrate beside near-black rock slabs: three palettes that do not
belong together, in exactly the words R2 first used. Named inside R2's rank 3,
carried by R3 as rank 9, still untouched.

### 3.10 Ground cover in the near field, 0 to 25 m: **ACCEPTABLE**
`RN2450_meadow.png`. A dense sward that reads as grass; still not a Space
Engineers sward, for the reason L5 disclosed rather than hid -- the card's own
physical silhouette is unchanged, so at a standing eye the frame reads as wide
flat leek or iris leaves rather than blades. `box` iqr 56.36. L5's owed item 1
is the whole of the remaining gap.

### 3.11 Shadows: **ACCEPTABLE**
`RN2450_flyovernoon_canopy0.png`. R2's texel staircase stays closed and keeps
softening: `flyovernoon.shadowStep` iqr under `?canopy=0` reads **37.42** against
R3's 39.14, R2's 47.34 and L1's 45.98. `?shadowcast=0` is a working isolator on a
ground pose for the third independent hand: `smelterhero` `box` 63.51 / 51.73 ->
**83.72 / 61.61**, calls 100 -> 55, a +20.21-count move against R3's +20.82. The
forest floor still has **no dappled canopy light at all** at a dot-0.70 sun, and
M3's record already established why: it is a shadow-CASTER registration problem
in `CanopySelfShadow` and the `ShadowLod` tier rule, not a term in the cascade.

### 3.12 The night: **ACCEPTABLE, up from BEHIND, and the change is the largest in the file after 3.4**
`RN2450_meadownight.png`, `RN2450_smelternight.png`. Night reads as night. The
sky is a graded blue-black -- `skyHi` luma **9.33 at iqr 1.79**, `skyHz` 14.46,
`hzBand` **16.88**, in the right order -- against R3's flat **0.07 at iqr exactly
0.00**, and `?nightsky=0` puts R3's number back to the digit, which is both the
arming proof and the reproduction. There is a real star field with magnitude
variation and a treeline silhouette against it. The ground holds legible blade
form past the lamp's pool (`nearG` 5.68 -> **8.29**), and the lamp is a cone with
a falloff rather than a disc with a rim. **The headlamp is no longer the night:**
at an empty field it is now **6.5 per cent** of the light (8.86 shipped against
8.28 under `?lamp=0`, R3: 23 per cent) and beside a furnace **69.7 per cent**
(35.93 against 10.88, R3: 94 per cent). What is left is that the sky has no
airglow variation, no Milky Way and no moon in frame, and the star colours are
uniform.

### 3.13 Emissive light: **ACCEPTABLE, up from BLOCKING, and one claim inside it is generous**
`RN2450_smelternight_lamp0.png`. **The inversion is the whole story: a running
furnace at night used to make its own frame DARKER than an empty field (1.81
against 2.03) and now makes it 1.31x BRIGHTER (10.88 against 8.28).** Under
`?lamp=0`, off R3's own numbers: `firebox` **0.41 -> 21.66** (53x), `plate`, the
clean shell 0.3 m from the coals, **2.72 -> 13.75**, `placard` 3.94 -> 27.19,
`bandLit` 5.18 -> 24.15, `sunface` 1.51 -> 10.08. The light is LOCAL and the
isolator proves it rather than asserting it: `?firelight=0` takes `firebox` to
**1.26**, i.e. 94 per cent of that rectangle is M3's term, while the far
`hearthL`/`hearthR` columns keep 4.00 / 4.65 of their 6.62 / 7.38 without it, so
their rise is M5's ambient and not M3's leak. **Two things are not at bar.**
There is still **no bloom**: a fire that is the brightest object in a night world
bleeds no light into the air around it, and M3 handed Admin that diagnosis
(`bloomStrength` and the Karis bound, both global grade constants) rather than
spend it. And **M5's own judgement that "panel and coal detail hold under the
headlamp rather than blowing to a white card" is generous**: with the lamp on,
`peep` hiFrac is **0.220** and `strip` **0.288**, i.e. between a fifth and a
third of the fire's own pixels are in the top bucket and read as flat paper
white, against 0.016 and 0.113 with the lamp off. The lamp, not the emissive, is
what clips them.

### 3.14 Water: **BEHIND, and one third of it closed without a water lane**
`RN2450_pondside.png`. Still the best-composed frame in the project. **R3's first
complaint is closed as a side effect of M1**: the pond was "a saturated cyan that
belongs to no other object in the frame", `box` warm **-47.53**; today it reads
**-16.46** against a sky at -15.10, i.e. the water and the sky are now the same
hue to within 1.4 counts. What is unchanged in every particular: the wave field
is a regular parallel corrugation across the whole surface, unmistakable at 1x;
nothing is reflected in it, not the trees on the far bank, not the bank, not the
clouds directly above it; and the foam at the sand bar is hard-edged flat
polygons. The Ocean biome is still coloured ground.

### 3.15 Vegetation from the air: **BEHIND, unmoved for four audits, and it is the first-launch view**
`RN2450_flyover.png`, `RN2450_forestair.png`, `RN2450_forestairnoon.png`. R2
reversed two earlier lanes' "MET" here, R3 upheld the reversal, and I re-took the
frames with fresh eyes: **it stands, and nothing has moved.** The whole frame
reads as a satellite photograph of shallow tropical water with weed beds: the
crowns are blue-black confetti, the cloud shadows read as depth variation in
water, and the three tones (crown, ground, haze) do not belong together. M1 took
`forestair`'s whole-frame warm from -7.38 to **-8.07**, i.e. slightly the wrong
way, which is the honest cost of a fix aimed elsewhere. **This is the pose with
the highest storyline exposure in the whole set** and it has been BEHIND in four
consecutive audits without a lane.

### 3.16 Vegetation assets, near: **BEHIND, unchanged**
`RN2450_basedusk.png`, `RN2450_forestfloor.png`. The broadleaf crown L5 rebuilt
still reads as foliage and is a clear pass. Under it the trunk is still a bare
untapered cylinder with no branches, so the whole reads as a lollipop; the
conifers on any horizon are still green triangles; and the forest-floor litter is
still hard-edged pale flat wedges strewn on dark ground, in the tint R3 said L5
never touched.

### 3.17 The sky and its clouds: **BEHIND, down from ACCEPTABLE**
`RN2450_vistanoon.png`, `RN2450_flyover.png`. The zenith is a deep blue and the
horizon wall is gone, which is 3.4's win. What is left is worse than R3 scored it
because the wall was hiding it. **The clouds are lit as flat opacity, not as
volume**: every cell is a soft blob of one value with no lit side, no shaded
underside, no silver edge, and they cast nothing. **And the deck has a straight
hem**: at every vista pose the cloud layer stops at a dead-straight horizontal
line well above the horizon, leaving a clean empty blue band between the deck and
the ridge, where a real deck converges and thins into the distance. That line is
in the frame at 1x and it is the second-most visible geometric artefact in the
set after 3.5.

### 3.18 Snow, rock and scree as materials: **BEHIND, unchanged**
`RN2450_vistanoon.png`, `RN2450_vistadawn.png`, `RN2450_mtnslope.png` all carry
flat white (and at dawn, flat pale blue) polygons with hard straight edges where
snow should be, unmistakable in the near ground of all three. A3 gave snow a
normal and a roughness and left the flat albedo `mix` in place on purpose; the
visible half is still the open half.

### 3.19 The sun disc: **BEHIND, unchanged to the digit for a fourth audit**
`RN2450_dawnsun.png`. `sunCore` **204.68** against `glareIn` 204.69 and
`glareOut` **203.05**: the brightest object in the world is **1.63 counts** above
the sky beside it, against R3's 1.53, R2's 1.63. By eye there is still no disc.
The aureole is real, physical and correctly restrained; the thing it is an
aureole of is missing.

### 3.20 Structures, masonry and machines: **ACCEPTABLE**
`RN2450_smelterhero.png` is still the best asset frame in the game and it is
better than R3's, because the fire now lights its own masonry (`box` 52.26 ->
**63.51**). `RN2450_ruin.png` is still the best-composed ground frame. What is
real in both is the **crushed shadow side**: the ruin's shaded face and the base
wall at `basedusk` go toward flat near-black with no sky fill, which M3 measured
as `PropSkyAmbient`'s weight at +0.10 to +0.25 counts and correctly refused to
spend inside a lighting lane.

### 3.21 The station: **BLOCKING for the spine, and its five-audit diagnosis is RETRACTED here**
`RN2450_station.png` is the interior for the sixth time, `world` 18.91. **The new
thing, and it is a retraction rather than a finding.** The manifest row's own
leading suspect -- two authorities on the hull's pose with two different roll
conventions, `stationQuat` at install against `OrbitCarrier.poseAt` per tick --
**is false on current `main` and has been since CE-116**: `StationMount.ts:173`
registers the only writer and `:193`'s `syncWatchersAt` fires that same watcher
at install, so there is one convention, not two. Two stale docstrings
(`StationMount.ts:16-34`, pre-CE-116, and `StationView.ts:144-156`, which still
claims the quaternion is `stationQuat`'s) are what sent three audits at the wrong
suspect. And the evidence for "same camera, two scenes" does not survive reading:
`artframe.js:2635` says `captureDiag` is built BEFORE the capture call and
`:2611` says its `originF`/`dirF` are body-frame and cannot see the floating
origin, so the camera certificate was read on a frame that is not the photographed
one. **This is an invocation problem until something measures otherwise, and one
derived probe field settles it in one capture** -- see rank 6.

### 3.22 The voxel cut face: **ACCEPTABLE**
`RN2450_voxelface.png`. Unchanged from R3: a mottled soil material on a set of
flat facets with hard edges, and the texture visibly stretches on the
near-vertical ones.

### 3.23 Frame cost: **ACCEPTABLE**
`meadow` at 2,003,313 triangles is the most expensive frame in the file and is
under `StatsProbe`'s 2.7e6 ALERT, unmoved from R3 to the triangle. The aerials
are 216k to 264k, the vista set 572k to 750k. `vista` runs 50 calls, 45 programs
and 114.8 MB of VRAM, all level with R3. **No absolute millisecond is quoted
anywhere in this audit.**

---

## 4. THE CONTROLS

Thirty-one arms, fresh process each, same build, same server, all one flag except
the four labelled.

### 4.1 M1, and the attribution is exact

`?aerodepth=0` restores RN-2320's flat blend, i.e. today minus M1.

| pose / rectangle | `?aerodepth=0` | shipped | R3's own figure |
|---|---:|---:|---:|
| `vista.hzBand` warm | **+48.43** | **-2.07** | +48.36 |
| `vista.skyHz` warm | **-12.14** | -19.36 | -12.14 |
| `vistadawn.skyR` warm | **+25.58** | +19.40 | +25.58 |
| `vistadawn.hzBand` warm | +59.77 | +34.04 | -- |
| `dawnsun.skyUp` warm | **+7.19** | **-4.87** | +7.19 |
| `flyovernoon.hzBand` warm | +38.98 | **+3.80** | -- |

**Three of R3's four rank-1 headline figures come back to the digit through one
flag on a build five commits later**, which is what makes the shipped column a
delta rather than a level, and it attributes the entire seam closure to M1 with
nothing left over.

Two further readings, both published because they qualify the win. `?aerosol=0`
at `vistanoon` leaves `hzBand` warm at **+19.42** against a `skyHz` at -54.19, so
the ground's own albedo is warm at that range and the shipped air is CANCELLING
it rather than the ground having become blue. And the bare-air two-flag arm
(`?aerosol=0 ?horizon=0`) reproduces R2's committed 5.49 / 19.13 / 24.85 to the
digit, while the ONE-flag `?aerosol=0` arm has legitimately moved (`hzBand` iqr
7.07 -> **8.93**) because M2's analytic stand-in lives in the rung that arm
keeps. Both halves of that pair are what a correct reproduction looks like.

### 4.2 The 4-pixel cross-hatch, and it is convicted

At `vistadawn`, a 256 x 96 px patch of mid ground at (1240, 596), through
`rn2450bayer.mjs`. `phaseStd` is the standard deviation over the 16 phase means
of `(x mod 4, y mod 4)`; `patchStd` is over every pixel.

| arm | phaseSpread | **phaseStd** | patchStd |
|---|---:|---:|---:|
| shipped | 5.744 | **1.791** | 30.215 |
| `?horizonnrm=0` | 5.796 | 1.785 | 30.283 |
| `?horizon=0` | 5.983 | 1.838 | 31.653 |
| `?horizoncell=0` | 5.825 | 1.824 | 31.960 |
| `?splatnrm=0` | 5.729 | 1.785 | 30.329 |
| `?terrainbump=0` | 5.712 | 1.772 | 30.014 |
| `?horizonval=0` | 5.744 | 1.791 | 30.215 |
| **`?contact=0`** | **1.909** | **0.602** | **33.193** |

Five readings out of that table and its companions.

**1. Six terrain-material arms are null and the seventh removes it.** Every arm
that could plausibly own a ground repeat leaves it between 1.772 and 1.838;
`?contact=0` takes it to 0.602, a 66 per cent removal, **while the patch's own
std RISES 30.215 -> 33.193.** An arm that removes the defect and leaves more
material than it found is a conviction, not the locator R3 had to settle for.

**2. The period is 4 and nothing else.** On the same pixels at `--p=5`, the
shipped frame reads phaseStd **1.198** and the `?contact=0` arm reads **1.403**:
turning contact off does not reduce the period-5 spread at all, it slightly
raises it. At `--p=3` the shipped frame reads 0.478. So the component `?contact=0`
removes sits at period 4 exactly, which is `ContactGlsl.ts`'s
`floor(mod(p, 4.0))`.

**3. It is monotone in sun elevation, on one site at one patch.**

| pose | sun dot | phaseStd |
|---|---:|---:|
| `vistadawn` | 0.101 | **1.791** |
| `vista` | 0.699 | 0.978 |
| `vistanoon` | 0.920 | 0.830 |

A contact-shadow march along the sun vector is long and shallow at a low sun and
short at a high one, which is the dependence a terrain texture cannot have.

**4. The negative control on the same frame.** A sky patch at (400, 200) returns
phaseStd **0.053**, so the instrument can say "no dither" on a real image rather
than only on a synthetic. A second ground patch on the other side of the frame at
(400, 640) reads **1.663**, so it is not one tile in one place.

**5. It is a BARE-GROUND defect and the grassed poses are nearly clean.** At a
mid-ground patch, `mtnslope` 0.425, `basedusk` 0.441, `pondside` 0.458, `meadow`
0.410, `flyoverlow` 0.413, `ruin` 0.201, `forestairlow` 0.185. The vista site is
where it shows because the vista site is where the ground is not covered.

**And the arming proof this catalogue demands** is in 4.5.

### 4.3 M2, verified by a hand that did not build it, with its own negative control

At `forestair` under `?canopy=0`, R3's own patch (900, 620) 256 x 128, through
M2's own committed `latmeter.mjs`.

| arm | dominant period | peak / median | autocorr max after first min | patch std |
|---|---:|---:|---|---:|
| shipped | 64.00 px | 33.80 | **none** (best 0.314) | **6.08** |
| `?horizoncell=0` | **9.85 px** | 16.14 | **0.623 at lag 10** | 6.21 |
| R3's shipped reading | 12.19 px | 18.78 | 0.622 at lag 10 | 5.99 |

**M2's done-when is MET on merged main and its isolator restores R3's frame to
the digit.** The 4-px phase meter reads 0.082 at that same patch, so R3's
world-locked repeat and R4's screen-locked one are genuinely two different
defects and neither is the other's residue.

### 4.4 The rest

| arm | pose | what it says |
|---|---|---|
| `?canopy=0` | `flyovernoon` | `under` iqr 76.47 -> **23.49** against R3's 13.71 and R2's 6.07. The aerial ground's own contrast has nearly quadrupled across three audits. `shadowStep` 45.85 -> **37.42** against R3's 39.14. |
| `?grass=0` | `meadowfield` | the bare-substrate ceilings in 3.8: r4 68.87, r10 54.64, r25 51.67, r55 54.66, r100 41.07, against a shipped 65.07 / 48.21 / 42.92 / 38.99 / 59.62. Luma 80.33 / 84.70 / 81.26 / 72.69 / 80.97 against 85.11 / 113.81 / 133.05 / **142.67** / 106.96. |
| `?grasspatch=0` | `meadowfield` | M4 removed: r25 **29.51**, r55 **21.42** against R3's own 29.48 and 21.56. M4's patch multiplier is the whole move. r100 goes UP to **64.50**, so M4's disclosed r100 cost is real and still 4.88 counts. |
| `?lamp=0` | `smelternight` | 3.13's whole table. Frame 35.93 -> **10.88**, against an empty field's 8.28. |
| `?lamp=0 ?firelight=0` | `smelternight` | TWO flags, labelled. Frame **5.52**, `firebox` **1.26**, `plate` 6.43, `hearthL` 4.00. So of `plate`'s 13.75, M3's emissive is 7.32 counts and M5's night ambient 3.71 over R3's 2.72; of `firebox`'s 21.66, M3 is 20.40. |
| `?lamp=0 ?firelightground=0` | `smelternight` | frame 10.88 -> **10.86**. NOT a null about the term: this pose is a machine filling the viewport and its manifest has no ground rectangle, so the whole-frame figure cannot see M2's routed seam. Published as a shot-set gap (rank 8), not as a result. |
| `?lamp=0` | `meadownight` | frame 8.86 -> **8.28**, `nearG` 8.29 -> 5.44. The night's true floor with no player light in it, against R3's 2.03. |
| `?nightsky=0` | `meadownight` | M5 removed: `skyHi` **0.07 at iqr 0.00**, `skyHz` 0.08, `hzBand` 0.11 -- R3's flat black to the digit -- while `nearG` holds at 8.18. Arming proof and reproduction in one arm. |
| `?lamp=0 ?bloom=0` | `smelternight` | TWO flags, labelled. M3's handed-up bloom diagnosis, re-measured on a build where the fire is now the dominant light in the frame: the whole frame moves **0.01 counts** (10.88 -> 10.87), `strip` 0.94 (78.99 -> 78.05, exactly M3's own +0.94), `peep` 0.48, and `firebox`, `plate` and `band` are **bit-identical**. The bloom reaches nothing beyond the emitter's own pixels. Independent confirmation, by a hand that did not build it, that rank 8 is a grade-constant problem and not a pyramid problem. |
| `?shadowcast=0` | `smelterhero` | `box` 63.51 / 51.73 -> **83.72 / 61.61**, calls 100 -> 55. L2's repaired isolator, +20.21 counts against R3's +20.82, for a third independent hand. |
| `?horizon=0` | `vista` | `hzBand` iqr 3.28 -> **2.72**, `mid` 13.96 -> 12.69. In shipped air the horizon rung is worth +0.56 at 4.7 km, a sign flip from R3's -0.57 and still nothing. |

### 4.5 The contact isolator's arming proof, and the plains far ground

Run after the matrix above, because a control's arming must be proved on a pose
where its term is unmistakable before its result is read anywhere else
(NUMBERS.md, RN-2287: "run a control's ARMING PROOF on a pose where the term is
unmistakable before you read its result on the pose you care about").

**`?contact=0` at `meadow`, where blade roots are the term's whole reason to
exist:** `box` **85.12 / 56.36 -> 96.98 / 49.57**, `shade` 84.22 -> **91.57**,
`nearG` 79.93 -> **91.49**. The arm removes 11.9 counts of contact darkening on a
pose where it is unmistakable and errors nowhere. It is armed, so 4.2's collapse
is a term going away and not a flag that never reached the pipeline.

**And the same arm, on the same build, in the same run, is a NULL on the phase
meter at that pose:** `meadow` (600, 520) reads phaseStd **0.410 shipped and
0.465 under `?contact=0`**, i.e. no removal at all, while the frame around it
moves 11.9 counts. That pair is worth more than the arming proof on its own. **An
armed flag that removes 66 per cent of the signal at one pose and none of it at
another is telling you about the SUBJECT, not about itself:** the dither needs
bare ground to sit on, and at a meadow the carpet is over it. It also rules out
the reading that `?contact=0` is simply a brightness change the phase meter
happens to like.

**The plains far ground, and the lever is the GROUND and not the air.**
`?aerosol=0` at `meadow` takes `hzBand` iqr **4.06 -> 4.85** and luma 207.58 ->
206.15. Removing the entire atmosphere from a 4-count rectangle buys **0.79
counts**. R3 asked and answered this question at the vista site and concluded
"the lever at that range is the air, not the ground"; **at the plains site the
answer is the opposite, and it is why rank 1 is a material lane and not a tuning
one.** There is nothing out there for the air to be hiding.

**And the shot set cannot see its own worst surface gap, which is a cheap fix.**
`?horizon=0` at `midfield` leaves `r18`, `r27` and `r35` **bit-identical to the
digit** (35.51 / 44.21 / 41.78 both sides). That is not a result about the
horizon rung: `midfield`'s furthest committed rectangle is at 35 m and the flat
plane this audit is complaining about starts past 130 m, so the arm is being read
on rectangles the term cannot reach by construction (NUMBERS.md, "a rectangle
that straddles the horizon cannot measure a term confined to one side of it", the
same shape one range band out). **`meadow.hzBand` is the ONLY committed rectangle
anywhere in the shot set that frames the plains far ground.** Rank 1 therefore
needs a RECTANGLE, not a pose -- one row on `midfield` and one on `meadowfield`,
which is an afternoon and not a lane.

### 4.6 M2's deltas reproduce on merged main; its LEVELS do not

`?horizoncell=0` at `vista` restores the pre-M2 frame.

| rectangle | `?horizoncell=0` | shipped | M2's published before -> after |
|---|---:|---:|---|
| `vista.hzBand` iqr | 2.61 | **3.28** | 2.21 -> 3.07 |
| `vista.mid` iqr | 11.33 | **13.96** | 14.36 -> 17.08 |
| `vista.nearG` iqr | 26.78 | **25.00** | 19.22 -> 17.14 |

**Every DELTA reproduces and no LEVEL does.** M2 published +0.86 / +2.72 / -2.08
and this audit measures **+0.67 / +2.63 / -1.78** on the same three rectangles,
all three the same sign and within 0.3 counts. The absolute levels are 0.2 to 7.9
counts away because M2's base was `4a8ac1bf`, which carries M1 and M4 and **not
M5**, and all three rectangles compose with terms those lanes own. This is worth
recording rather than filing as a discrepancy: a lane measuring on its own base
is measuring its own delta correctly and is publishing a level that its own merge
will move.

**It also settles a residual this audit was briefed to carry.** M2's disclosed
`vista.nearG` regression is **11 per cent on M2's base and 6.6 per cent on merged
main** (26.78 -> 25.00). It is real, it is smaller than the record says, and it is
still open.

---

## 5. THE RANKED GAP LIST

Ranked by severity first, then by exposure against
[`story_line_outline_v1.txt`](../../story_line_outline_v1.txt). Feasibility:
**(a)** art or tuning inside the current WebGL2/three stack · **(b)** engine work
inside WebGL2 · **(c)** likely needs WebGPU · **(d)** plausibly needs native.
**The residuals the brief named are IN this ranking rather than re-derived**, and
each says where it came from.

| # | Gap | Evidence | Severity | Class |
|---|---|---|---|---|
| **1** | **The plains far ground is a flat painted plane past ~130 m.** No material, no relief, a razor-straight horizon with cut-out trees on it, at the three poses the player starts in. `meadow.hzBand` iqr **4.06**, unmoved across three audits, and `?aerosol=0` buys only **0.79 counts** there, so unlike the vista site the lever is the GROUND and not the air. R3 scored R2's rank 1 half closed on vista-site evidence; at the plains site it is not closed. **And `meadow.hzBand` is the only committed rectangle in the whole shot set that frames it** (4.5). | 3.7, 4.5; `RN2450_midfield.png`, `RN2450_meadowfield.png`, `RN2450_ruin.png` | **BLOCKING** | (b) |
| **2** | **A screen-locked 4-pixel cross-hatch over bare ground at any low sun.** The contact-shadow pass's own ordered dither, whose 5-tap resolve does not resolve it. Six terrain arms null, `?contact=0` collapses phaseStd 1.791 -> 0.602 while patch std RISES, period-5 control flat, monotone in sun elevation. | 3.5, 4.2; `RN2450_vistadawn.png` / `RN2450_vistadawn_contact0.png` | **BLOCKING** | (b) |
| **3** | **The world from the air reads as shallow water with weed beds.** Blue-black confetti crowns on a pale desaturated field, three tones that do not belong together, cloud shadows that read as water depth. Unmoved through four audits; the highest-exposure pose in the set (first launch). The routed `FoliageTone`/`PropSkyAmbient` confetti residual is the named lever and M1 moved `forestair` warm the wrong way (-7.38 -> -8.07). | 3.15; `RN2450_flyover.png`, `RN2450_forestairnoon.png` | **BLOCKING** | (a) |
| **4** | **The carpet is 1.96x the brightness of the ground it stands on at 55 m.** M4 fixed the contrast (39 -> 71 per cent of the bare ceiling) and did not touch the LEVEL (142.67 against 72.69, R3's ratio to two decimals). The mid field is a pale wash over a darker ground; FIDELITY-GAP 1.1's "colour sampled FROM the terrain beneath" in the one axis nobody has spent a lane on. | 3.8, 4.4; `RN2450_meadowfield_grass0.png` | CLEARLY BEHIND | (a) for the tint, (b) for a real substrate sample |
| **5** | **Clouds round 2: flat opacity, and a straight hem.** No lit side, no shaded underside, no silver edge, no ground shadow; and the deck stops at a dead-straight horizontal line above the horizon at every vista pose, where a real deck converges and thins. R3 rank 11, plus the hem, which the horizon wall was hiding. | 3.17; `RN2450_vistanoon.png`, `RN2450_flyover.png` | CLEARLY BEHIND | (a) for lighting, shape and the hem; (c) for volumetrics |
| **6** | **The station is INTERIOR for the sixth audit, and its standing diagnosis is wrong.** One writer, not two, since CE-116; two stale docstrings sent three audits at a falsified suspect; the "same camera, two scenes" certificate was read on the wrong frame. One derived probe field (the eye in the hull's own local frame, against `boundM`) ends the argument in one capture. | 3.21; `RN2450_station.png` | **BLOCKING for the spine** | (a), an afternoon |
| **7** | **Water: corrugated, unreflective, and its foam is polygons.** One third of R3's rank 7 closed as a side effect of M1 (`box` warm -47.53 -> **-16.46** against a sky at -15.10). The wave field, the total absence of reflection and the hard-edged foam are untouched, and the Ocean biome is still coloured ground. | 3.14; `RN2450_pondside.png` | CLEARLY BEHIND | (a) for the wave field, (b) for a reflection and ocean surfaces |
| **8** | **The emissive has no bloom, and the headlamp clips a third of the fire to white.** M3's Karis diagnosis, handed up rather than spent: `bloomStrength` and the first level's Karis bound are both global grade constants. And `peep`/`strip` hiFrac **0.220 / 0.288** with the lamp on against 0.016 / 0.113 without, which is M5's "detail holds under the headlamp" judged generous. **Comes with the shot-set gap M2 owed: a night pose with a fire over OPEN GROUND**, without which `?firelightground=0` has nothing to measure. | 3.13, 4.4; `RN2450_smelternight.png` | CLEARLY BEHIND | (a) for the grade, one manifest row for the pose |
| **9** | **The far material is one substance with no sub-massif form.** The middle distance is built and keeps improving (`flyovernoon.under` 6.07 -> 13.71 -> **23.49**); what it is made of is not rock against scree against strata, it has no large-scale occlusion and no shadowed faces. R3 rank 6, vista-site half. | 3.6; `RN2450_vistanoon.png` | CLEARLY BEHIND | (a) for the layer set, (b) for occlusion; **(c) only** for real geometric displacement, re-ask after the (b) version |
| **10** | **The mountain understorey is mint and reads as glass** on a cream dust substrate beside near-black slabs. Named inside R2's rank 3, carried as R3's rank 9, never touched. | 3.9; `RN2450_mtnslope.png` | CLEARLY BEHIND | (a) |
| **11** | **Snow, rock and scree read as paint.** Flat white (and at dawn flat pale blue) polygons with hard straight edges at three poses. R1 gap 10, half closed by A3, visible half still open. | 3.18; `RN2450_vistanoon.png`, `RN2450_vistadawn.png` | CLEARLY BEHIND | (a) |
| **12** | **`vista.hzBand` is still flat, the seam is not fully closed, and M2's `nearG` cost is still owed.** iqr **3.28** with the whole horizon rung worth +0.56 at 4.7 km; M1's own acceptance wording ("`hzBand` warm falls below `skyHz` warm") is NOT met -- the ground is still 17.29 counts the warmer at `vista` and **79 counts** the warmer at `forestair` (+29.97 against -49.28); and M2's disclosed `vista.nearG` regression is **6.6 per cent on merged main**, 26.78 -> 25.00, not the 11 per cent its own record states (4.6). | 3.4, 3.6, 4.1, 4.6 | CLEARLY BEHIND | (a) for the residual tint, (b) for the ridge's material |
| **13** | **The rock carrier's worley line, carried from M2's verifier.** `_layer_rock` in `tools/blender/terraintex.py:518` terraces `_worley(s, s, 8, sd)` and spends it three times over (height 0.48, value +0.30, the whole roughness base), which is the spectral LINE `latmeter` reads at peak/median 2565. **It is a family, not one layer** (grass 6 at 0.52, dirt 8 twice at 0.50, scree 8 and 16). Regeneration is one command that rewrites all six layer PNGs and the manifest; the client samples it in the near splat (albedo fade 35-75 m, normal 30-60 m) and in the horizon rung, so a fix moves every near-field splat rectangle AND obliges a re-derivation of M2's own guard band and stand-in amplitude, both sized against `HORIZON_CARRIER_CELLS = 8`. | M2 owed 2; scoped this round | CLEARLY BEHIND | (a), two to four days with a re-baseline |
| **14** | **Litter and trunks.** Hard-edged pale flat wedges on the forest floor, unchanged in tint; the broadleaf trunk is a bare untapered cylinder under a good crown; conifers on any horizon are green triangles. R3 rank 12. | 3.16; `RN2450_forestfloor.png`, `RN2450_basedusk.png` | CLEARLY BEHIND | (a), authoring |
| **15** | **The sun disc is 1.63 counts.** `sunCore` 204.68 against `glareOut` 203.05. R1 gap 16, A4's dark speck, R2 rank 11, R3 rank 13, still undiagnosed and now level for four audits. | 3.19; `RN2450_dawnsun.png` | CLEARLY BEHIND | (a) once diagnosed |
| **16** | **No dappled canopy light, and shadow sides crush toward black.** M3 established the cause and declined it with the reason: the dapple is a shadow-CASTER registration problem in `CanopySelfShadow`/the `ShadowLod` tier rule, and the crushed sides are `PropSkyAmbient`'s weight, measured at +0.10 to +0.25 counts and a global look change to move. | 3.11, 3.20; `RN2450_forestfloor.png`, `RN2450_ruin.png` | CLEARLY BEHIND | (b) for the caster, (a) for the fill |
| **17** | **Stepped LOD ribbons with chromatic fringes on the orbital terminator.** `seam` iqr **64.27**, level with R3 to the digit. R3's "creeping for a third audit" is retracted: the trend was noise, the defect is not. | 3.2; `RN2450_limb.png` | CLEARLY BEHIND | (b) |
| **18** | **The near grass card's physical silhouette.** L5's own owed item 1: the texture is fixed and the card is not, so a standing eye still reads leek leaves. Needs its own capture-and-tune budget against RN-2145's shimmer floor. | 3.10; `RN2450_meadow.png` | ACCEPTABLE | (a), authoring |
| **19** | **The night sky has no airglow, no Milky Way, no moon and one star colour.** What M5 built is right and it is the first rung. | 3.12; `RN2450_meadownight.png` | ACCEPTABLE | (a) |
| **20** | **The voxel cut face stretches** on near-vertical facets, and the facets are hard-edged. | 3.22; `RN2450_voxelface.png` | ACCEPTABLE | (b) |
| **21** | **No large-scale terrain occlusion in valleys.** R1 gap 14, unchanged; folded into rank 9's (b) half. | `RN2450_vistanoon.png` | ACCEPTABLE | (b) via a horizon map |
| **22** | **No surface of the Moon has ever been photographed**, and the spine's pre-alpha target ends at scanning it. A domain nothing can photograph accumulates no findings (NUMBERS.md). | 3, section 9 | UNMEASURED | one pose, needs a scenario that lands off Forge |
| **23** | **Foliage aliasing in motion.** UNMEASURED for the fourth audit running: FXAA only on an alpha-tested scene, and a still frame cannot show shimmer. | -- | UNMEASURED | (b), expensive |

**Nothing in ranks 1 to 16 argues for native.** The one honest (c) is real
geometric displacement at range inside rank 9, and rank 9's own (a) and (b)
halves should be built and re-measured before anyone argues it. That is R1's,
R2's and R3's ruling on the same item and it still holds.

---

## 6. THE QUEUE: THE TOP FIVE LANES

Ordered by rank. **File seams are stated as intra-file partitions, not as a claim
of no collision**: where two lanes must touch one file, the boundary inside the
file is named and one owner is named per side (NUMBERS.md's standing rule that a
shared wiring file is a predictable collision point). **Every path below was
checked against the tree before it was written down**, which is the correction R3's
own verifier had to make five times.

### N1. THE PLAINS FAR GROUND (rank 1): **opus**
Make the ground past 130 m at the plains site a surface rather than a painted
plane. R3 closed half of R2's rank 1 and the half it closed was measured at a
mountain; at the spawn biome there is no material out there at all, and
`meadow.hzBand` iqr has read 3.99 / 4.06 across two audits while the same
rectangle at the vista site quadrupled. **The first deliverable is a diagnosis,
not a fix**: find out whether the plains far band is running the horizon rung at
all, or whether it is falling into a biome/slope branch that retires every art
term (M2's `?split=2.8` result -- "at a coarse mesh the aerial ground has no
material" -- is the standing hypothesis and it was published as a LOCATOR, not a
conviction). **Its first arm is a painted intermediate**, per RN-2305, not another
flag.
**Owns:** `web/src/render/materials/TerrainHorizon.glsl.ts`,
`web/src/render/materials/TerrainHorizon.ts`,
`web/src/render/materials/TerrainHorizonHandle.ts`,
`web/src/render/materials/TerrainAmpQuery.ts`, and
`web/src/render/materials/TerrainFragAlbedo.glsl.ts`'s FAR rungs only.
**Plus two new RECTANGLES, not poses** (4.5): a far-band row on `midfield` and one
on `meadowfield` in `web/tools/smoke/probes/artframe.js`, because
`meadow.hzBand` is currently the only committed rectangle in the project that
frames the subject of this lane and a lane cannot state a done-when against a
rectangle that does not exist. **`artframe.js` is shared with N5 and partitioned
inside the file: N1 owns the `midfield` and `meadowfield` manifest rows, N5 owns
the `station` row and the `atCapture` block, and neither touches the pose-dispatch
chain, because no pose is being added by either.**
**Must not touch:** `TerrainFragAlbedo.glsl.ts`'s near splat blend (N4's, see the
partition in N4), `Atmosphere*`/`SkyProbe.ts`, `render/post/*` (N2's and N3's),
`render/grass/*` (N4's).
**Done when:** the two new far-band rectangles exist, are named in the report with
the reason each is where it is, and their `?horizon=0` and `?aerosol=0` floors are
published beside their shipped values in the same run; `meadow.hzBand` iqr clears
a stated multiple of today's 4.06 against its own `?aerosol=0` ceiling of 4.85;
`midfield`'s far band carries visible structure by eye at 1x in a before/after
pair; `vista`, `vistanoon` and `flyovernoon.under` move inside stated bands;
`meadow` stays under the 2.7e6 ALERT. Opus: the first job is a diagnosis against a
hypothesis space that has already returned a locator rather than a cause.

### N2. THE CONTACT DITHER (rank 2): **sonnet**
Remove a 4-pixel screen-locked cross-hatch from every low-sun ground frame. The
cause is diagnosed and the mechanism is in one file's own header:
`ContactGlsl.ts`'s `dither()` has "Period exactly 4 px in both axes" and the
apply pass's 5-tap 1-px cross is claimed to resolve it and does not -- five taps
sample five of sixteen phases. **The shape of the fix is one of three and the
lane picks by measurement**: widen the resolve to a separable kernel that covers
the full 4x4 support; keep the 4-px period but rotate the sequence so the cross
already covers it; or reduce the march's own contrast so the residual falls under
the eye. **Temporal jitter is forbidden outright** (a settled frame must equal
the previous one -- `FrameDiff`'s second difference, `wires.js` requiring five
identical draw-call reads) and that constraint is what makes this a real design
choice rather than a one-line blur.
**Owns:** `web/src/render/post/ContactGlsl.ts` and
`web/src/render/post/ContactPass.ts`.
**Must not touch:** any terrain material (N1's and N4's), and nothing else under
`web/src/render/post/` -- **that directory is shared and partitioned BY FILE with
N3: N2 owns `ContactGlsl.ts` and `ContactPass.ts`, N3 owns `BloomGlsl.ts` and
`PostDefaults.ts`'s bloom rows, and `PostStack.ts`, `CompositeGlsl.ts` and
`ToneDrive.ts` are neither lane's without an Admin-logged decision.** The two are
otherwise independent and need no serialisation.
**Done when:** at `vistadawn` (1240, 596) 256x96 the `--p=4` phaseStd falls below
**0.70** (today 1.791, `?contact=0` floor 0.602) with patch std held at or above
30.0; the `--p=5` control on the same pixels stays inside its own band (today
1.198); the sky negative control still reads under 0.10; `?contact=0` still
reproduces its own arm; and every committed rectangle in this file moves inside a
stated band. Sonnet: the cause is convicted, the instrument is committed
(`rn2450bayer.mjs`) and the done-when is a number.

### N3. THE WORLD FROM THE AIR (rank 3, and rank 8's bloom comes with it): **opus**
Stop the world reading as shallow water from 1,200 m. This is the highest-exposure
pose in the game and it has been BEHIND in four consecutive audits without a lane
ever being pointed at it. The named levers are the routed `FoliageTone` canopy
desaturation and `PropSkyAmbient`'s blue sky fill, both twice called ready and
never spent, plus `forestair`'s own residual cold (whole-frame warm -8.07 against
a `skyBand` at -49.28 and an `hzBand` at +29.97, the largest opposite-hue gap in
the file). **Its first deliverable is a side-by-side against the SE reference
board**, not a rectangle: this is the one item where FIDELITY-GAP's Option D
process matters more than any instrument, because every number here has been
inside its band for four audits while the frame was wrong.
**Owns:** `web/src/render/materials/PropSkyAmbient.ts`,
`web/src/render/instancing/FoliageTone.ts` (corrected path: the term is in
`instancing`, not `materials`, and its own header says "Nothing else may call
`applyFoliageTone`", so it has exactly one call site to reason about),
`web/src/render/materials/BiomePalette.ts`'s canopy/forest hue rows, and
`web/src/render/post/BloomGlsl.ts` (corrected from "the bloom stage": that is the
file, and the two constants rank 8 names -- `bloomStrength` and the first level's
Karis bound -- live in it and in `web/src/render/post/PostDefaults.ts`, both of
which this lane owns).
**Must not touch:** `web/src/render/post/ContactGlsl.ts` and `ContactPass.ts`
(N2's) -- **`web/src/render/post/` is shared and partitioned BY FILE: N2 owns
`Contact*` and nothing else there, N3 owns `BloomGlsl.ts` and `PostDefaults.ts`'s
bloom rows and nothing else there, and neither may touch `PostStack.ts`,
`CompositeGlsl.ts` or `ToneDrive.ts` without an Admin-logged decision, because a
tone or composite change moves every rectangle both lanes are judged on.** Also
terrain materials (N1's, N4's), `Atmosphere*`'s daylight aerosol terms.
**Done when:** the crowns' own chroma separates from the ground by a stated
amount at `forestair` and `forestairnoon`; `forestair` whole-frame warm closes
toward zero off today's -8.07 with a stated target and `flyovernoon` does not
regress below +4.91; at `smelternight` under `?lamp=0` a visible halo exists by
eye with `firebox` rising a stated factor off 21.66 while `hearthL`/`hearthR` stay
inside a band of 6.62 / 7.38; `peep`/`strip` hiFrac with the lamp ON falls below
0.10 off today's 0.220 / 0.288; and no daylit machine rectangle at `machine` or
`smelterhero` moves outside a stated band. Opus: two global grade constants and a
palette are in play at once and the trade between them is a judgement, not a
sweep.

### N4. THE CARPET'S LEVEL (rank 4): **sonnet**
The mid field's contrast is fixed and its BRIGHTNESS is not: at 55 m the carpet
reads luma 142.67 against a bare substrate at 72.69, a 1.96x lift that is
unchanged from R3's 2.0x, so the ground lightens toward the horizon instead of
staying its own colour. M4 proved the patch multiplier is the right lever for
contrast; this is the same file's tint and the substrate sample behind it. M4's
own owed item 2 names the deeper fix: a `terrainAlbedo` twin that also samples the
noise term the terrain fragment shader carries, so the carpet inherits the
ground's REAL value rather than a band-and-slope approximation. **M4's disclosed
`r100` cost is this lane's too** and is now measured at 4.88 counts (59.62 shipped
against 64.50 under `?grasspatch=0`).
**Owns:** `web/src/render/grass/*` and
`web/src/render/materials/TerrainCoverFar*`, plus
`web/src/render/materials/TerrainFragAlbedo.glsl.ts`'s NEAR splat blend as a
READ-ONLY dependency for the substrate twin -- **if the twin needs a write there,
that file is shared with N1 and the partition is: N1 owns the far rungs, N4 owns
the near blend, and the two must be serialised, N1 first.**
**Must not touch:** `TerrainHorizon*` (N1's), palettes and `Atmosphere*` (N5's and
N3's).
**Done when:** `meadowfield.r55` luma falls to within a stated fraction of its own
`?grass=0` ceiling of 72.69 (today 142.67) with `r55` iqr held at or above 38.0;
`r25` and `r100` move inside stated bands; `r100` recovers a stated share of the
4.88 counts M4 owes; `meadow`'s committed near-field rectangles stay
bit-identical; `meadow` stays under the 2.7e6 ALERT. Sonnet: the cause is
measured, the file is one M4 already owns and the mechanism is one it already
runs.

### N5. THE STATION, AND THE THREE DOCSTRINGS THAT MISDIRECTED FOUR AUDITS (rank 6): **sonnet, one afternoon**
Photograph the station exterior reproducibly, or prove in one capture that the
camera is inside the hull. **Everything this needs already ships.** `atCapture()`
already reads `cam` and `drawPosE` on the PHOTOGRAPHED frame; `Debug.ts` publishes
`cam.posE`; `StationView.ts` publishes `quat`, `posE` and `boundM`. The edit is
one derived field on `photo`: the eye expressed in the hull's own local frame,
`eyeLocal = quat^-1 * (cam.posE - stationDraw.posE)`, and its magnitude against
`boundM`. If it reads INSIDE on the interior captures and OUTSIDE on the exterior
one, the shot is a framing/settle problem and `yawOff` is the wrong knob; if it
reads identical on both, then and only then is it rendering's, and it goes back to
Admin with a measurement instead of a suspicion. **Second, and cost-free: correct
the two stale docstrings.** `StationMount.ts:16-34` is pre-CE-116 and
`StationView.ts:144-156` still says the quaternion is `stationQuat`'s; those two
paragraphs are what sent R1, R2, R3 and this audit at a suspect CE-116 removed,
and leaving them is a guaranteed fifth wasted round trip.
**Owns:** `web/tools/smoke/probes/artframe.js`'s `station` row and its
`atCapture` block (**shared with N1 and partitioned inside the file: N1 owns the
`midfield` and `meadowfield` rows, N5 owns the `station` row and `atCapture`**;
serialise only if both land in the same window, since `atCapture` is a single
function body and N1 may want to publish its own far-band floor through it),
`web/src/render/StationView.ts` (docstring only, lines 144-156) and
`web/src/app/StationMount.ts` (docstring only, lines 16-34).
**Must not touch:** any renderer behaviour. **If the field says the camera is
inside the hull, this lane STOPS and reports** rather than re-framing on the same
pass, because a reframe that lands by luck is the fifth audit's problem again.
**Done when:** `photo.eyeLocal` and `photo.eyeLocalOverBound` are published on
every `station` capture; five consecutive captures publish it; the verdict
(inside/outside, and whether it is constant) is stated in the report; both
docstrings match CE-116's code. Sonnet: no design decision, one derived vector,
two prose corrections.

**Sixth and behind them, in order:** clouds round 2 and the deck's straight hem
(rank 5); water's wave field and reflection (rank 7); the far material's layer set
and occlusion (rank 9); mountain mint and snow paint (ranks 10 and 11); the
horizon rung's residual flatness and M1's unmet acceptance wording (rank 12); the
rock carrier's worley line (rank 13, scoped this round at two to four days with a
full re-baseline, and it should be sequenced AFTER N1 and N4 because it moves
every near-field splat rectangle they are judged on); litter and trunks (rank 14);
the sun disc (rank 15). **And three that are Admin's and not a lane's:** one
manifest row for a night pose with a fire over OPEN GROUND (rank 8's second half,
which M2 owed and which `?firelightground=0` cannot be read without); a pose on
any surface of the Moon (rank 22), which needs a scenario that lands off Forge and
is the storyline's own pre-alpha destination; and foliage aliasing in motion (rank
23), UNMEASURED for four audits and needing a moving instrument rather than a
lane.

---

## 7. THE DELTA REPORT: R3'S ROWS, ONE DAY ON

| R3 rank | gap | today | evidence |
|---|---|---|---|
| **1** | the distance goes cream, and at 4.7 km the ground and the air are the same brightness | **CLOSED AS THE ITEM IT WAS, AND CLOSED CLEANLY.** `vista.hzBand` warm **+48.36 -> -2.07** against a sky at -19.36: a 60.5-count seam of opposite hue became a 17.29-count seam of the same hue. `dawnsun.skyUp` **+7.19 -> -4.87**, `vistadawn.skyR` +25.58 -> +19.40. `?aerodepth=0` returns all three of R3's figures to the digit, so the attribution is exact. Two residues survive as rank 12: M1's own acceptance wording is not met, and `forestair` is still 79 counts opposite-hue at dot 0.55. | `RN2365_vista.png` / `RN2450_vista.png` |
| **2** | a world-locked rectangular lattice on the aerial ground | **CLOSED, VERIFIED BY A HAND THAT DID NOT BUILD IT, WITH ITS OWN CONTROL.** At R3's own patch through M2's own `latmeter.mjs`: **no autocorrelation local maximum** where R3 read 0.622 at lag 10, patch std held at 6.08 against 5.99, and `?horizoncell=0` puts R3's 0.623 at lag 10 straight back. **A DIFFERENT repeat is now in that slot (rank 2) and it is not the same one**: R3's was world-locked at 12 px in the horizon rung; this one is screen-locked at 4 px in the contact pass, and the 4-px phase meter reads 0.082 at R3's patch. | `RN2365_forestair_canopy0.png` / `RN2450_forestair_canopy0.png` |
| **3** | emissives light nothing, at all | **CLOSED, AND THE INVERSION IS THE PROOF.** A running furnace used to make its own frame DARKER than an empty field (1.81 against 2.03); it now makes it **1.31x brighter** (10.88 against 8.28). `firebox` 0.41 -> **21.66**, `plate` 2.72 -> **13.75**, and `?firelight=0` attributes 94 per cent of `firebox` to M3's term while the far columns keep theirs. What is left is bloom and the lamp's clipping, now rank 8. | `RN2365_smelternight_lamp0.png` / `RN2450_smelternight_lamp0.png` |
| **4** | the mid field's plate moved in rather than closing | **CLOSED ON CONTRAST, MOVED TO LEVEL.** r55 21.56 -> **38.99** against a bare 54.66, i.e. 39 -> 71 per cent of its own ceiling; r25 29.48 -> 42.92; `midfield` box iqr 28.50 -> **44.21**; the plate is gone by eye. `?grasspatch=0` reproduces R3's own r25/r55 to 0.15. **The same band is still 1.96x too BRIGHT**, unchanged, which is rank 4. | `RN2450_meadowfield_grass0.png` |
| **5** | the night is one headlamp cone | **CLOSED.** The sky went from iqr exactly 0.00 to a graded 9.33/14.46/16.88 with a real star field; the ground holds form (`nearG` 5.68 -> 8.29); the lamp's share fell 94 -> **69.7 per cent** beside a furnace and 23 -> **6.5 per cent** in a field; the edge is gone by eye. `?nightsky=0` reproduces R3's flat black to the digit. Rank 19 is what is left and it is a polish item. | `RN2365_meadownight.png` / `RN2450_meadownight.png` |
| **6** | the far material is one substance with no sub-massif form | **UNMOVED AS A MATERIAL, IMPROVED AS A FIELD, AND SPLIT IN TWO.** `flyovernoon.under` under `?canopy=0` 13.71 -> **23.49** and `vistanoon.mid` 8.07 -> 10.07, so the vista site keeps getting better; the material itself is unchanged (now rank 9). **And the plains half was never measured and is not closed at all** -- that is R4's rank 1. | `RN2450_midfield.png` |
| **7** | water | **ONE THIRD CLOSED WITHOUT A LANE.** `box` warm -47.53 -> **-16.46** against a sky at -15.10: M1 fixed the palette complaint as a side effect. The corrugation, the absent reflection and the polygon foam are untouched. | `RN2450_pondside.png` |
| **8** | the crowns are blue-black confetti and the wood reads as reefs | **UNMOVED, AND PROMOTED TO RANK 3** because four audits have now said it and no lane has ever been pointed at it. M1 took `forestair` warm -7.38 -> **-8.07**, marginally the wrong way. | `RN2450_forestairnoon.png` |
| **16** | stars in a blue daylight sky at 1,200 m | **CLOSED**, by M5's `spaceMaskAt` -- confirmed on a frame by a hand that did not build it: no star anywhere in `flyover`'s sky at 3x. | `RN2450_flyover.png` |
| **17** | stepped LOD ribbons on the orbital terminator | **LEVEL, AND R3'S TREND CLAIM IS RETRACTED.** `seam` iqr 64.27 against R3's 64.27. R3 called 59.39 -> 63.21 -> 64.27 "creeping the wrong way for a third audit running"; a fourth point at the same value says the last two were noise. | `RN2450_limb.png` |
| **9, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22** | mountain mint, snow, clouds, litter and trunks, the sun disc, dapple and crushed shade, the station, grass silhouette, the voxel face, `CANOPY_SHADE`, valley occlusion, motion aliasing | **UNMOVED**, except the clouds, which score WORSE now that the horizon wall is no longer hiding the deck's straight hem, and the station, whose diagnosis is retracted rather than advanced. | section 3 |

**Five closed, one closed and split in two, one third-closed as a side effect, two
retractions, one promotion, and twelve untouched.** The honest headline is not the
count. **R3 found a world whose ground reached everywhere the eye stops and whose
remaining defects were all about light; R4 finds that the light is now largely
right and the frontier has gone back to the SURFACE -- but at a different site.**
Every "the ground has no material" finding in this campaign was measured at a
mountain, closed at a mountain, and never once measured at the plains biome the
player spawns in, where it is wide open. The second thing R4 finds is that the two
worst-looking artefacts in the file are now both in SCREEN space and neither is a
material: a 4-pixel dither the eye reads as graph paper, and a cloud deck that
stops in a straight line.

---

## 8. HONEST GREENS

- **Every one of the five landed lanes reproduces through its own isolator.**
  `?aerodepth=0`, `?horizoncell=0`, `?nightsky=0`, `?grasspatch=0` and
  `?firelight=0` each put the world back where R3 photographed it, four of them to
  the digit. No campaign turn before this one could say that of its whole top
  five.
- **R2's four bare-air figures survive seven lanes.** 5.49 / 19.13 / 24.85, blind,
  through the two-flag arm.
- **Three inversions in one round.** The distance goes toward the sky instead of
  away from it; a furnace makes its frame brighter than an empty field instead of
  darker; the horizon rung's contribution at 4.7 km changed sign from negative to
  positive.
- **A defect that had never been named was convicted in one afternoon**, with six
  null arms, a period control, a sun-elevation series, a sky negative control and
  a mechanism quoted from its own file's header.
- **Two retractions, both against this project's own prior findings**, published
  where the finding is rather than quietly dropped: the orbital seam is not
  creeping, and the station's roll-convention suspect was removed by CE-116.
- **One instrument was added rather than one bent.** `latmeter`'s `minLag = 4`
  floor was left alone and a purpose-built phase meter with its own free negative
  control was written beside it.

---

## 9. WHAT THIS AUDIT DID NOT MEASURE, SAID OUT LOUD

- **Anything in motion.** Fourth audit running. Foliage shimmer, LOD pop,
  streaming hitches and the stream-in cross-fade are invisible to a settled still
  frame.
- **Any body but Forge.** The Moon appears as a small cratered disc in two aerial
  frames and no surface of it has ever been photographed. Ranked (22) rather than
  merely noted, because the spine sends the player there.
- **Any quality tier but `high`.** Fourth audit running.
- **Absolute frame times.** No millisecond is quoted anywhere in this document.
- **The station's exterior**, still not reproducible; but for the first time the
  next step is a measurement rather than a suspicion (rank 6).
- **M2's routed ground seam.** `?firelightground=0` moves the whole `smelternight`
  frame by 0.02 counts and that is a property of the POSE, not of the term: the
  machine fills the viewport and the manifest has no ground rectangle. Reported as
  a shot-set gap, not as a null.
- **Whether the contact dither is visible in motion**, where a 4-px screen-locked
  pattern under a moving camera is a different and possibly worse artefact than
  the still frame shows.

---

## 10. FILES

- **Frames:** `docs/screenshots/RN2450_*.png`, **42 files**: the 26 poses plus
  sixteen control frames (`vista_aerodepth0`; `vistadawn_` `horizonnrm0`,
  `horizoncell0`, `horizon0`, `horizonval0`, `splatnrm0`, `terrainbump0`,
  `contact0`; `forestair_canopy0`, `forestair_canopy0_horizoncell0`,
  `flyovernoon_canopy0`, `meadowfield_grass0`, `smelternight_lamp0`,
  `meadownight_lamp0`, `meadow_contact0`, `midfield_horizon0`). The other fifteen arms
  in section 4 are published as numbers with their one-line invocations, because
  each is a figure rather than a picture. **The pair to look at first is
  `RN2450_vistadawn.png` against `RN2450_vistadawn_contact0.png`**, at (1180, 580)
  400x90, magnified.
- **Instrument:** `web/tools/smoke/rn2450bayer.mjs`, new, with its own reason and
  its own free negative control in its header.
- **Poses:** unchanged. No manifest row was added this round and section 1 says
  why.
- **Domain memory:** [`docs/controllers/rendering.md`](../controllers/rendering.md)
  section 2.27.
- **Numbers row:** [`NUMBERS.md`](NUMBERS.md), RN-2450 to RN-2469.
