# THE WORLD LOOK AUDIT, 2026-08-19

> **Lane:** `lane/world-audit` · **Numbers:** RN-2065 to RN-2075 of the RN-2065 to
> RN-2084 block · **Base:** `origin/main` at `640a343c` · **Owner:**
> rendering-controller
>
> Opened on Reid's direct instruction: "we need to really focus on the graphics,
> especially the world graphics." This judges the WORLD against the D-020 Space
> Engineers fidelity bar and produces the ranked work queue for the graphics
> push. It is the distance-and-sky counterpart to
> [`rendering.md` section 2.8](../controllers/rendering.md), which audited the
> close and mid range on 2026-08-15 and whose R1 to R7 remain live.

---

## 0. THE ONE-PARAGRAPH ANSWER

The world is finished to about forty metres and unfinished past it. Nine of the
project's ten canonical art frames are taken inside that forty metres, so the
audit that mattered had never been taken. Five new vista poses were added and
the picture they return is consistent across every site, every altitude and
every hour: **past roughly seventy-five metres the terrain has no material at
all, past three hundred metres it has no shadow, past six hundred and twenty
metres it has no vegetation, and the atmosphere then removes seventy-eight per
cent of what contrast is left.** From twelve hundred metres, which is the view
the storyline's first rocket launch gives the player, the world is a
featureless white haze with one hard-edged black staircase across it. The good
news is real and worth stating first: the atmosphere model itself is a genuine
analytic Rayleigh/Mie integral shared by the sky, the near terrain and the
scaled shell, the limb from a hundred and twenty kilometres is the best frame
this project has ever produced, and **not one of the top five gaps needs
WebGPU or a native client.** They need engine work inside WebGL2 and they need
it in an order this document fixes.

---

## 1. METHOD, AND WHAT IT IS AND IS NOT EVIDENCE FOR

**Capture.** Real Windows D3D11 through ANGLE (Chrome, `--use-angle=default`),
1600x900, HUD-free through `of.screenshot()`, `postState.post === true`
asserted by the probe on every frame, enemies suppressed and the wind clock
frozen. Served from a `vite preview` this lane owns on `127.0.0.1:4761`,
`--strictPort`, **sentinel-verified before use**: `dist/of-sentinel-rn2065.txt`
was written into this worktree's own `dist` and fetched back over the port
before the first probe ran (NUMBERS.md, "a loopback bind silently shadows a
wildcard bind on the same port"). Server killed by PID.

**Frames are illustrations of a shot; the numbers beside them are the evidence.**
`run.mjs` screenshots after the eval returns, so the saved PNG and the
published rectangles are not the same frame (`artframe.js`'s own header). Every
figure quoted here is the probe's own decode taken at its own capture instant.

**No before/after claim is made anywhere in this document**, so the
same-process pngdiff trap does not apply: this is a one-arm audit of current
`main`, and every number is a level, not a delta. The one comparison that IS
made across builds is `?atmos=0`, which is a **negative control taken in a
separate process against the same source**, and it is reported as a control and
not as a regression.

**What the probe reports and what it asserts.** Only `valid`, `fails` and the
committed rectangles are stable evidence; frame-count and timing accumulators
are not. Frame times are quoted as `p50`/`p99` off `StatsProbe`'s 600-frame
ring at the capture instant on an RTX 4060 Ti, and they are quoted to compare
POSES against each other on one machine, never as an absolute performance
verdict.

---

## 2. THE FRAMES

### 2.1 The nine canonical shots, re-taken at `640a343c`

| shot | triangles | calls | p50 ms | p99 ms | world luma / iqr | sun dot |
|---|---:|---:|---:|---:|---|---:|
| `forestfloor` | 1,429,184 | 72 | 9.4 | 14.8 | 30.95 / 27.77 | 0.701 |
| `midfield` (props off) | 451,257 | 47 | 15.4 | **64.6** | 130.37 / 44.30 | 0.699 |
| `voxelface` | 471,922 | 47 | 8.2 | 18.1 | 96.53 / 35.42 | 0.881 |
| `machine` | 1,112,182 | 98 | 12.2 | 21.1 | 34.43 / 31.14 | 0.448 |
| `smelterhero` | 1,214,854 | 98 | 14.1 | 27.1 | 58.34 / 71.94 | 0.448 |
| `ruin` | 1,156,235 | 103 | 16.9 | 44.0 | 82.93 / 116.03 | 0.349 |
| `ruinwall` | 1,201,766 | 104 | 13.0 | 28.8 | 75.21 / 80.36 | 0.349 |
| `basedusk` | 1,344,115 | 109 | 12.4 | 35.7 | 73.74 / 109.47 | 0.203 |
| `station` | 36,257 | 36 | 6.0 | 16.8 | 18.98 / 11.93 | 0.499 |

Frames in `docs/screenshots/RN2065_<shot>.png`.

**`station` came back as the INTERIOR again.** `captureDiag.drawEyeDistM` 4.316,
`drawnParts` 2, `staleMaxM` 0, `alpha` 0.924 this run (alpha varies per run and
stays inside [0,1], so the RN-2035 clamp defect is ruled out; INTERIOR is the
stable fact). The `yawOff: 105` framing RN-1935 chose does not
hold on this build, so **the storyline's climax destination still has no
judgeable exterior frame**, which is section 2.8 R5 unclosed. It is out of this
audit's scope and is re-flagged rather than re-diagnosed. The `limb` shot below
partly covers the space side instead.

### 2.2 The five new vista poses (RN-2065)

Added to `web/tools/smoke/probes/artframe.js` with documented invocations the
`check:probes` authoring gate accepts (gate re-run: PASS).

| shot | scenario | pose | what it is for |
|---|---|---|---|
| `vista` | `walk` | mtn (2.036, 144.056), yaw 120, pitch -2, sun 0.70 | the horizon vista at eye level on high ground |
| `vistadawn` | `walk` | same pose, sun 0.10 (5.85 deg) | the low-sun half of the day arc |
| `vistanoon` | `walk` | same pose, sun 0.92 (66.89 deg) | the top of the day arc |
| `flyover` | `surface` | HOME, 1,200 m, yaw 300, pitch -14, sun 0.55 | the first-launch view |
| `limb` | `orbit` | HOME, 120 km, yaw 300, pitch -18, sun 0.30 | the orbit-to-surface frame |

Three of them share one pose and differ in exactly one manifest field, so the
day arc is a controlled comparison at a fixed camera. The two fly poses needed
their own `--scenario=`, because **`Controller.teleport` discards its altitude
argument** (`web/src/player/Controller.ts`, and `ConfigTypes.ts` states the
contract out loud), which is why this file had never had one: a walk-mode run
would silently photograph the ground with every field in the report reading
correct. The branch refuses on `observer.mode !== 'FLY'` and asserts the eye
altitude landed within `max(50, 2%)` before it photographs anything.

**One latent defect was found by the first shot that ran outside
`--scenario=walk`.** `artframe.js`'s sandbox gate read `of.game().mode`, and
`of.game()` returns null when there is no gameplay, so `flyover` died with
`TypeError: Cannot read properties of null (reading 'mode')` out of
`page.evaluate` before any shot code ran. Null-safe now; the sandbox rule is
unchanged for every shot that declares `needsSandbox`.

### 2.3 The rejects, kept because each is a reading

Six frames were taken to choose the vista site and five were rejected. The five
rejects are in `docs/screenshots/RN2065_sweep_*.png` and two of them are cited
as primary evidence below; the sixth is the accepted pose and is
`RN2065_vista.png`.

- **plains** (-7.9675, 116.53189), biome 2. The single most damning frame in
  the set and the reason it is kept: the world visibly ENDS at the canopy ring
  and everything past it is one uniform dark band to a dead-flat horizon. It is
  also **2,759,465 triangles, 71 calls**, over the 16.6 ms budget and over the
  2.7M triangle alert on every box measured (absolute milliseconds are
  box-and-run-dependent: this audit's p50 read 32.1 ms), at a standing eye on
  flat ground with nothing built.
- **forest** (-19.85, -72.7853), biome 3, 1,420,222 tris, p50 13.6 ms. Canopy
  fills the frame; also holds two detached prop fragments floating in the sky.
- **hills2** (22.286, 108.84406). Distant snow reads as flat white paper over a
  near-black mid ground.
- **mtn at yaw 300 and at yaw 210.** Both stand the eye on a slope facing
  uphill. Recorded because it is the trap in picking a viewpoint by elevation:
  a high site is not a high view, and the walker lands where the oracle puts him.
- **mtn at yaw 120**, biome 5, 591,906 tris, 47 calls. Shipped, and it is the
  CHEAPEST of the six, at a ratio of about 4.5x against plains (absolute
  milliseconds are box-and-run-dependent: this audit's p50 read 10.1 ms here
  against 32.1 ms on plains, a 4.7x ratio; section 8 gives a second reading of
  this same pose). The frame with the most distance in it is not the expensive
  one.

---

## 3. THE DAY ARC AT ONE POSE, WHICH IS THE CENTRAL TABLE

`vista` / `vistadawn` / `vistanoon`, identical camera, one field apart.
`upCheck` 0.000 on all three (the local-up reconstruction the sun bearing is
built on is exact against `sky.elevationDot`).

| rectangle | noon, 66.89 deg | day, 44.31 deg | dawn, 5.85 deg |
|---|---:|---:|---:|
| `skyL` (sun side at dawn) luma | 66.94 | 73.17 | **110.83** |
| `skyR` (anti-sun at dawn) luma | 66.66 | 73.46 | **60.35** |
| `skyHz` luma / warm | 119.06 / **-101.06** | 146.11 / **-91.87** | 138.31 / **-86.23** |
| `hzBand` far ridge luma / iqr | 205.31 / 3.93 | 198.86 / **3.00** | **231.51** / 4.00 |
| `mid` ridge luma / iqr | 195.22 / 11.00 | 181.43 / 15.21 | 146.78 / 63.06 |
| `nearG` scree luma / iqr | 167.51 / 24.00 | 134.14 / 27.93 | **33.01** / 11.14 |
| `sunYawOffDeg` | -145.33 | -179.55 | **-52.70** |

Three readings come straight off this table and each is a finding below.

1. **The azimuthal term works and the colour term does not.** At a 5.85 degree
   sun the sun-side sky is **1.84x brighter** than the anti-sun side (110.83
   against 60.35), so the scattering integral genuinely resolves the sun's
   direction. Over the same 61 degrees of elevation the horizon sky's `warm`
   moves **14.83 counts and stays at -86**, i.e. deeply blue at every hour of
   the day. The sky brightens toward the sun and never reddens.
2. **The frame inverts at a low sun.** `nearG` falls 167.51 to 33.01 (-80%)
   while `hzBand` RISES 205.31 to 231.51 (+12.8%). The far-to-near luma ratio
   goes 1.23 to 1.48 to **7.01**: at dawn the distant ridge is seven times
   brighter than the ground at the player's feet.
3. **The distance has no contrast at any hour.** `hzBand` iqr is **3.00 to
   4.00** on all three rungs, against 24.0 to 27.9 on the near ground. That is
   not a lighting number, it is a material number, and section 5 separates the
   two with a control.

---

## 4. THE NEGATIVE CONTROL THAT SPLITS TWO FINDINGS APART

`flyover` at 1,200 m, taken twice one page flag apart, `?atmos=0` against the
default, separate processes, same source.

| rectangle | atmosphere ON | atmosphere OFF | iqr change |
|---|---|---|---|
| `hzBand` (the horizon) | luma 208.87, iqr **20.08** | luma 58.00, iqr **89.17** | **-77.5%** |
| `world` (whole frame) | luma 161.87, iqr 49.33 | luma 47.36, iqr 84.61 | -41.7% |
| `box` (the ground field) | luma 158.96, iqr 32.63 | luma 68.57, iqr 58.69 | -44.4% |
| `under` (straight down, 1.2 km) | luma 134.00, iqr **7.79** | luma 83.00, iqr **7.21** | **+8.0%** |

This is the whole reason the control was run. **The haze is destroying 77.5 per
cent of the horizon's contrast, and it is destroying none of the ground
directly below the camera** (7.79 against 7.21 is inside any reasonable noise
band). So the flat white ground in the flyover frame is TWO independent
defects, not one: the far half is the atmosphere, and the near half is terrain
that has no material to lose. Either one alone would have been misdiagnosed as
the other.

The same pair at **400 m** says the near-field half is a ramp and not a cliff:
`under` iqr 6.49 with the atmosphere and 9.28 without, i.e. the haze is already
taking 30 per cent of the contrast off ground four hundred metres below the
camera. And the aerial frames are **188,081 triangles at 1,200 m and 231,089 at
400 m**, against 2,759,465 at a standing eye at the plains site: the props are
not thinned from the air, they are gone.

---

## 5. THE RANKED GAP LIST

Ranked by severity first, then by player exposure against
[`story_line_outline_v1.txt`](../../story_line_outline_v1.txt). The spine puts
the player on the ground in Forest and Hills for the first several hours
(gather wood through build the research station), walking to the ruin, and then
**flying**: launch pad, ship, orbit, station, moon scan. So ground-level near
and mid field is the highest-exposure surface in the game and the 0 to 100 km
climb is the highest-drama one.

Feasibility classes: **(a)** art or tuning inside the current WebGL2/three
stack · **(b)** engine work inside WebGL2 · **(c)** likely needs WebGPU ·
**(d)** plausibly needs native.

| # | Domain | What we render now (evidence) | The Space Engineers bar | The gap, in one sentence | Severity | Class |
|---|---|---|---|---|---|---|
| **1** | **Aerial perspective / haze** | `flyover.hzBand` iqr 20.08 with the atmosphere and 89.17 without; `vista.hzBand` iqr **3.00** from a 4.7 km ridge; `flyover_400` still a total whiteout at 400 m | SE's planetary haze is ranged: a mountain silhouette 20 km out is desaturated and still legible, and altitude thins it | The boundary-layer aerosol is referenced to a fixed 400 m scale above the ray's LOWER end, so a downward or long ray accumulates full sea-level density and removes 77.5% of the horizon's contrast, and climbing makes it worse instead of better | **BLOCKING** | (a)+(b) |
| **2** | **Vegetation at range and from the air** | `flyover` at 1,200 m: **188,081 triangles**. At 400 m: **231,089**. A standing eye on plains: **2,759,465**. Not one tree in any of the four aerial frames over a spawn the world-gen puts 1,296 trees in, and the two `?atmos=0` controls prove they are ABSENT rather than hazed out | SE draws surface detail continuously from the ground to orbit, with no radius at which the world empties | The scatter rings are radii about the OBSERVER (canopy 620 m, understorey 78 m) and there is **no impostor or billboard tier anywhere in `web/src/render`**, so the planet is bare the moment the eye leaves the ground; the exact trigger is NOT diagnosed here and is the lane's first job, because at 400 m the 620 m ring still subtends a 474 m horizontal disc of ground and the frame is empty anyway | **BLOCKING** | (b) |
| **3** | **Terrain material past ~75 m** | `flyover.under` iqr **7.21 with the atmosphere OFF** at a 1.2 km slant; `vista.hzBand` iqr 3.00 to 4.00 at every hour; `midfield` ground smeared from ~30 m | SE's voxel surface carries its material to the horizon; a distant slope reads as rock, sand or ice by its surface, not only by its tint | The terrain has **no albedo, normal or ORM texture at all** (per-biome vertex tint plus procedural modulation), the ground-texture term fades out 35 to 75 m and the relief bump 30 to 60 m, and the macro tint does not start until 600 m, so **75 m to 600 m is a genuine texture hole** and past 4 km the surface is one flat biome hex | **BLOCKING** | (b) |
| **4** | **Frame cost at a standing eye** | plains vista: **2,759,465 triangles, 71 calls**, over the 16.6 ms budget and over the 2.7M triangle alert on every box measured, at a ratio of about 4.5x against the vista pose's cost (absolute milliseconds are box-and-run-dependent: this audit's p50 read 32.1 ms); `midfield` p99 **64.6 ms**; `ruin` p99 44.0 ms | not a look gap, a budget: everything in this table has to fit inside what is left | The frame is already over `StatsProbe`'s ALERT triangle threshold (2.7e6) and over the 16.6 ms frame budget on flat ground, because the understorey is card geometry at LOD0 with only two LOD rungs and no impostor, so every fix above competes for headroom that is not there | **BLOCKING** | (b), (c) if density AND distance are both wanted |
| **5** | **Shadow reach and the cascade edge** | `flyover_noatmos` at 1,200 m: a hard-edged **texel-staircase black region** over the NEAR half; the same control at 400 m: the same staircase with the dark side on the FAR half; the same boundary as a parallelogram in `midfield` at a standing eye; splits `[22, 80, 300]`, 3 cascades, PCF, 2048 | SE shadows terrain to the horizon and the cascade transition is invisible | Shadows stop at **300 m**, and at altitude a large region renders fully occluded with a snapped-texel staircase edge instead of falling back to lit; **the dark side flips between 400 m and 1,200 m, which is what says the region tracks the cascade's own ortho box (centre = eye + forward x far x 0.35, half-extent far x 0.72) and not the terrain** | **BLOCKING** | (b) for reach, (a) for the edge |
| **6** | **The low-sun half of the day arc** | section 3: `nearG` -80% while `hzBand` +12.8%, far-to-near ratio **7.01**; `basedusk` skyHigh warm -87.69 (section 2.8 R7, unchanged) | SE's dawn reddens the sky, warms the terrain and silhouettes the distance | The in-scatter term is not attenuated by the sun's own path, so at 5.85 degrees the ground goes near-black while the haze in front of the distant ridge gets BRIGHTER than it is at noon | **BLOCKING** | (a)+(b) |
| **7** | **The world's edge at 620 m** | `RN2065_sweep_plains`, `RN2065_sweep_forest`: a hard tone ring at the 78 m understorey edge and a hard prop cull at 620 m, then one uniform band to the horizon | SE has no distance at which content stops | Same mechanism as #2 seen from the ground: two LOD rungs (296 to 310 tris, then 22 to 30) and a hard radius, with nothing beyond it | **BLOCKING** | (b), same lane as #2 |
| **8** | **Sky colour** | section 3: horizon `warm` -101.06 / -91.87 / **-86.23** across 61 degrees of sun elevation | SE's sky is warm at the horizon and cools upward, and the shift over the day is unmistakable | The sky brightens toward the sun by 1.84x and never reddens, and the `aerosolTint` (0.38, 0.39, 0.43) is **blue-biased**, so the one term that colours every distant surface pushes the whole world away from warmth at every hour | CLEARLY BEHIND | (a) |
| **9** | **Clouds** | zero cloud code in `web/src`, confirmed by grep; every sky in every frame here is empty | SE has cloud layers you fly through and their shadows on the ground | There is no cloud rendering of any kind, so the top half of every outdoor frame is a gradient | CLEARLY BEHIND | (a) for a dome layer, (c) for volumetrics |
| **10** | **Snow, rock and biome bands** | `vista`, `vistadawn`: snow patches are flat white polygons at 20 m and go lavender at dawn; `RN2065_sweep_hills2`: distant snow is white paper | SE's ice and rock read as materials at every range | The snow band is `smoothstep(0.86, 1.14, band)` applied to the albedo with no material behind it, so it takes the sky ambient straight and reads as paint | CLEARLY BEHIND | (a) |
| **11** | **Water** | one per-body pond disc (24 rings x 64 segments) with a genuine wave, Fresnel, refraction and foam shader; the **Ocean biome (0x14406e) renders as flat blue TERRAIN** | SE has no oceans, so this one is judged against the game we are making rather than the bar | The water shader is good and there is exactly one pond in the world wearing it; every other body of water is coloured ground | CLEARLY BEHIND | (b) |
| **12** | **The scaled shell from orbit** | `limb.seam` luma 100.48, iqr **59.39**: concentric stepped ribbons along the terminator | SE's planet from orbit is clean | The far-scene terrain shell's LOD tiles catch the low sun at the terminator and read as ribbing | CLEARLY BEHIND | (b) |
| **13** | **Star fade** | `flyover` at 1,200 m: stars visible in a blue daylit sky | stars appear when the sky is dark | `daylightFactor` keys off air density at altitude, which has dropped enough at 1.2 km to unmask stars while the sky is still fully blue | CLEARLY BEHIND | (a), a curve |
| **14** | **Large-scale ambient occlusion** | `vista`, `vistanoon`: valleys between ridges at 1 to 5 km have no darkening at all | SE's terrain has visible large-scale occlusion in its valleys | AO and contact shadows are screen-space and deliberately capped (`aoMaxScreen` 0.09, `csMaxScreen` 0.05), so they contribute nothing past a few metres and nothing replaces them | ACCEPTABLE | (b) via a terrain horizon map |
| **15** | **The day arc itself** | `dirForT(t) = normalize(cos a, 0.42, sin a)`: one constant declination | not a bar SE sets either | Every day at every latitude is the same arc, and a site's maximum sun is fixed by its latitude, which is why `vistanoon` can ask for dot 0.92 near the equator and most sites cannot reach it | ACCEPTABLE | (a) |
| **16** | **The sun disc** | **UNMEASURED.** 0.53 degrees, additive sprite, gain 35.32 (`SkyPass.ts`), and **no canonical frame in this project contains it**: the closest is `vistadawn` at 52.7 degrees off axis, just outside the frame | SE's sun is a bright disc with a bloom halo and it is in half the screenshots | Not a gap that can be asserted, and the shot set not being able to see the brightest object in the sky IS a gap in the shot set | UNMEASURED | n/a |
| **17** | **Foliage aliasing in motion** | **UNMEASURED.** FXAA only, no TAA, no MSAA, on a scene dominated by alpha-tested cards | SE ships TAA | A still frame cannot show shimmer; the risk is named and the cost is real, because the stack produces no motion vectors and TAA without them is not a small job | UNMEASURED | (b), expensive |
| **18** | **The limb from orbit** | `limb.ring` luma 93.27, iqr 101.39, sat 0.626, over `space` at 0.10: a real lit halo with a warm terminator gradient and a visible star field | this is the bar | Nothing to fix except #12's ribbing. **This is the best frame the project has.** | **AT BAR** | n/a |
| **19** | **The atmosphere model's architecture** | one analytic Rayleigh/Mie integral, uniform record **shared by reference** between the sky material and both terrain materials, so the horizon cannot disagree with the sky | SE's is simpler than ours | Nothing. Every fix in this table lands in one place because of this, and that is why the top five are all class (a) or (b) | **AT BAR** | n/a |

---

## 6. THE FEASIBILITY ARGUMENT, WITH ITS REASONS

Nothing in the top thirteen needs WebGPU and nothing needs native. The reasons
are specific, so they can be argued with.

**#1 haze and #6 the dawn inversion are shader-local.** Both live in
`Atmosphere.glsl.ts`'s `ofAtmoAerial` and in `TerrainFragLight.glsl.ts`'s two
call sites, which are the only consumers. The aerosol column is already
analytic (no marching), so re-referencing it to the ray's real endpoint
altitudes costs no instructions; attenuating the in-scatter by the sun's own
path costs one extra exponential. The view integral is 4 steps and the light
integral 2 (`AP_VIEW_STEPS`, `AP_LIGHT_STEPS`), which is a raise that fits in
fill rate at 1600x900 if it turns out to be needed. Class (a) for the tint and
the coefficients, (b) for the reference change.

**#2 and #7, vegetation at range, are the one real engine build.** There is no
impostor mechanism to extend: `ScatterTuning.ts` states outright that no
billboard or impostor exists anywhere in `web/src/render`. The shape of the fix
is a third LOD rung that is a camera-facing card baked per prop family, plus a
per-chunk canopy layer whose radius scales with eye altitude instead of being
the constant 620 m. It is `BatchedMesh` work with a bake step, which the asset
pipeline already does for LOD2, so it is class (b) and not (c). It does not
need compute: the placement is already deterministic per chunk and already runs
on the CPU inside the chunk build.

**#3, terrain material at range, is a shader change with a streaming caveat.**
The near-field terms are all `#ifndef OF_SCALED`, i.e. compiled OUT of the far
scene, and the mid-band hole (75 to 600 m) is a fade-range question inside the
near material. Both are class (b). What is NOT class (b) is real geometric
relief at distance: the finest ground sample is 0.899 m at depth 15 and coarser
outward, and adding depth costs chunk builds through **one terrain worker** at
a `genBudget` of 8 to 16 meshes per streaming update. Distant cliffs and
outcrops as GEOMETRY are the one item in this audit with a plausible (c): a
GPU-generated detail displacement or a compute-built far mesh is what a WebGPU
migration would actually buy. As a NORMAL-only detail term it stays (b), and
that is the cheap version to build first.

**#4, the frame cost, is where the honest (c) sits.** 2.76 M triangles at a
standing eye is understorey cards at LOD0 with no impostor, and #2's third rung
is also this item's fix: the same bake buys distance and buys headroom. If the
answer after that is still "we want SE's density AND SE's draw distance", then
GPU-driven culling and an indirect draw path are the next lever and those are
WebGPU features. **Do #2 first and re-measure before anyone argues for (c) on
cost**, because the measurement that would justify it does not exist yet.

**#5, shadows.** A fourth cascade is arithmetic in `ShadowRig.ts` and costs one
more shadow pass over the same casters; the 2048 map at three cascades already
costs 48 MB, so a fourth is 16 MB and one more draw of the terrain batches.
Terrain self-shadowing to the horizon does not need a shadow map at all: a
heightfield horizon-angle lookup is a texture fetch in the terrain fragment
shader and is the standard answer. Both class (b). The staircase edge is a
fade band at the last split, class (a).

**#9 clouds.** A layered analytic or textured cloud dome inside the existing
sky material is class (a) and would change every outdoor frame in this
document. Volumetric clouds a player flies through are class (c) and are not
pre-alpha work.

**No item in this audit argues for native (d).** `core/` being C++ with 21
green suites makes native tempting for the sim, but every gap here is a
renderer gap, and the renderer would be the entirely new part. The paired
ceiling study (RN-2085 to RN-2099) owns that question; this audit's input to it
is: **the world's problems are not the browser's fault yet.**

---

## 7. THE QUEUE: THE TOP FIVE LANES

Ordered so that each one's measurement is available to the next.

### L1. THE HAZE LANE (gaps #1 and #6): smallest change, largest frame
Re-reference the aerosol column to the ray's real endpoint altitudes, attenuate
the aerial in-scatter by the sun's own optical path, and re-baseline the three
`vista` rungs plus `flyover`. **Done when:** `flyover.hzBand` iqr recovers a
stated fraction of the 89.17 the `?atmos=0` control measures while `world` luma
stays inside a stated band; `hzBand` at dawn no longer exceeds `hzBand` at
noon. Class (a)+(b). This is first because it is the cheapest change that moves
the most pixels, and because every later lane is judged through frames it
distorts.

### L2. THE DISTANCE VEGETATION LANE (gaps #2, #7, and half of #4)
A third scatter LOD rung as a baked camera-facing card, and a canopy radius
that scales with eye altitude. **Done when:** `flyover` at 400 m and 1,200 m
contain trees, and the plains vista's 2,759,465 triangles come down with a
published new figure at the same pose. Class (b). This is the largest build in
the queue and it buys both the look and the headroom.

### L3. THE FAR TERRAIN MATERIAL LANE (gap #3)
Close the 75 m to 600 m texture hole and give the scaled shell a detail term.
**Done when:** `flyover.under` iqr moves off 7.2 with the atmosphere OFF, and
`vista.hzBand` iqr moves off 3.00. Class (b). Explicitly NOT geometry: the
normal-only version first, and the geometry question is handed to the ceiling
study with this lane's measurement attached.

### L4. THE SHADOW REACH LANE (gap #5)
A fourth cascade or a heightfield horizon term, a lit fallback outside the last
cascade, and a fade band at the split. **Done when:** the staircase is gone
from `flyover` and `flyover_noatmos`, and the mid ridges in `vista` carry cast
shadow. Class (b) plus (a).

### L5. THE SKY COLOUR LANE (gaps #8, #10, #13, and #9's cheap half)
Warm the low sun in the scattering integral, neutralise or warm the blue-biased
`aerosolTint`, give the snow band a material, fix the `daylightFactor` curve so
stars do not appear at 1.2 km, and add a cloud layer to the sky dome. **Done
when:** `skyHz.warm` at dot 0.10 differs from dot 0.92 by more than the 14.83
counts it does now, by a stated margin. Class (a) throughout, which is why it
is fifth and not because it matters least: it is the lane an art pass can run
while L2 and L3 are being built.

**Owed and not in the five:** gap #11 (the Ocean biome has no water surface)
and gap #12 (the orbital shell's terminator ribbons) are real and are queued
behind these. Gap #16 (no canonical frame contains the sun disc) should be
closed by whichever lane touches the sky, since it costs one manifest row.

---

## 8. HONEST GREENS, WITH NUMBERS RATHER THAN ADJECTIVES

- **The atmosphere is a real model, not a gradient.** Analytic Rayleigh/Mie,
  ray-marched, Earth-like `betaR` (5.8e-6, 13.5e-6, 33.1e-6), and the uniform
  record is shared BY REFERENCE between the sky material and both terrain
  materials, so the horizon cannot disagree with the sky. The 1.84x sun-side
  brightening at dot 0.10 is the measurement that proves the integral resolves
  direction, and it is why gap #8 is a tuning lane and not a rewrite.
- **The limb at 120 km is at the bar.** `ring` luma 93.27, iqr 101.39, sat
  0.626 against a `space` box at 0.10, with a warm terminator and a visible
  star field, at **52,913 triangles, 21 calls, p50 1.1 ms**.
- **The aerial perspective ramp is monotonic and correct in shape.** `nearG` to
  `mid` to `hzBand`: iqr 27.93 / 15.21 / 3.00, sat 0.175 / 0.067 / 0.053. The
  ordering is right at every rung; only the magnitude is wrong.
- **The vista pose is cheap.** 591,906 triangles for the frame with the most
  distance in it, against 2,759,465 triangles for a flat plains frame at a
  standing eye: the plains pose is over the 16.6 ms budget and over the 2.7M
  triangle alert on every box measured, at a ratio of about 4.5x against the
  vista pose (absolute milliseconds are box-and-run-dependent: this audit's p50
  read 6.9 ms for vista here and 10.1 ms in section 2.3 for the identical pose
  and triangle count, against 32.1 ms for plains). Distance is not what costs.
- **The sun disc is the right angular size**, 0.53 degrees, since RN-1520.
- **The water shader is better than the world it is in**: five wave trains,
  Fresnel at F0 0.02, depth-scaled refraction and a noise-broken foam band. Gap
  #11 is about how few surfaces wear it, not about the shader.
- **`upCheck` 0.000 on all three vista rungs**, so the sun-bearing instrument
  this audit added agrees exactly with the engine's own `sky.elevationDot`, and
  the `skyL`/`skyR` readings are attached to a proven side.

---

## 9. WHAT THIS AUDIT DID NOT MEASURE, SAID OUT LOUD

- **Anything in motion.** Foliage shimmer, LOD pop, streaming hitches and the
  fade-in dither are all invisible to a settled still frame. `midfield`'s p99 of
  64.6 ms against a p50 of 15.4 is the only hint any of it left in this data.
- **The sun disc**, for the reason in gap #16.
- **Any other body.** Every frame here is Forge. The Moon, Cinder and the
  airless profile (`airlessAtmosphere()`, every coefficient zero) are unjudged,
  and the storyline sends a player to scan the moon at the end of the pre-alpha
  spine.
- **Quality tiers other than the default.** Everything here is `high`: 3
  cascades, 2048 maps, IBL 256, post on. The `low` tier is 1 cascade at 90 m
  with the post stack OFF, and nobody has looked at what the world looks like
  there.
- **The station's exterior**, which is still not reproducible (section 2.1).

---

## 10. FILES

- Frames: `docs/screenshots/RN2065_*.png`, 22 files: 9 canonical re-takes, 5 new
  poses, 5 site-sweep rejects, 3 negative controls (`flyover_noatmos`,
  `flyover_400`, `flyover_400_noatmos`).
- Poses: `web/tools/smoke/probes/artframe.js`, manifest rows `vista`,
  `vistadawn`, `vistanoon`, `flyover`, `limb`, each with its committed
  rectangles and its rejects.
- Domain memory: [`docs/controllers/rendering.md`](../controllers/rendering.md)
  section 2.10.
- Numbers row: [`docs/web/NUMBERS.md`](NUMBERS.md), RN-2065 to RN-2084.
