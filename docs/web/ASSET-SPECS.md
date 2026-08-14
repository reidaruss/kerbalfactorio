# Orbital Foundry: 3D Asset Specs and Blender Authoring Pipeline

**Owner:** ART-PIPELINE agent. **Date:** 2026-07-26. **Status:** **THE ART
MANIFEST IS COMPLETE**, and on 2026-07-26 it absorbed two design decisions:
DW-29's vessel catalogue (**BT-12**, two diameter classes, 24 parts) and DW-32's
4 m structural module (**BT-11**, plus the support pillar). 47 of 47 files green
under `validate_glb.py --all`, all joints exact under `check_mating.py`, and a
full rebuild of every `build_*.py` produces a **zero-byte diff**, so the pipeline
is proven deterministic end to end.

| Tier | Files | Meshes | Payload |
|---|---|---|---|
| 0: the playable loop | 27 | 40 base (83 counting depletion variants) | 2.05 MB |
| 0: base building (4 m module, 2026-07-26) | 5 | 8 parts, 17 render meshes | 92 KB |
| 0: armour, four slots (2026-07-27) | 1 | 4 skinned slot meshes | 89 KB |
| 1: biome scatter props | 10 | 41 props, 78 render meshes with LOD2 | 383 KB |
| 2: space and vessels | 5 | 28 parts, 38 render meshes | 529 KB |
| **Total `dist/`** | **48** | **296 render mesh nodes** | **3.10 MB** (3,248,452 B) |

**Updated 2026-07-27 (W11 lane A).** The player, belt cargo, world dressing and
armour all landed the same night, across four parallel build agents working
contract-first. Per-directory, measured: `items` 1 file 60,960 B, `machines` 13
files 441,020 B, `nodes` 9 files 523,732 B, `player` 3 files 1,152,452 B,
`props` 10 files 392,432 B, `rocket` 4 files 529,224 B, `structures` 5 files
93,852 B, `tools` 2 files 22,236 B, `world` 1 file 32,544 B. **The `player`
directory is now a third of the payload**, and it is animation rather than
geometry: 14 clips x 44 bones x 3 paths is 1,848 channels whose accessor
metadata dominates the file. Self-contained clips are deliberate (see 4.1) and
the right lever is the bundle-time meshopt pass in section 6.3, not dropping
channels.

Tier 0 is 13 machines, 9 harvest nodes, the items atlas, 2 tools, the rigged
player body, the first-person arms and the 5-file structural building set.
Tier 1 is one scatter atlas per biome. Tier 2 is the 24-part vessel catalogue,
the launch pad, the landed lander, the far-scene body sphere and the engine
plume shell.

This is the buildable half of the art direction. It says exactly **what** models the
game needs, **how big** each one is, and **how** an agent produces one so that it
loads into three.js correctly the first time.

Content is derived from the shipped headless cores, not invented:

| Where the content comes from | Header |
|---|---|
| Items, recipes, tools, structures, the survival `Furnace` | `core/include/of/gameplay.h` |
| Harvestable `NodeKind` set and resource mapping | `core/include/of/deposits.h` |
| Machine kinds, `VisualState`, `AnimPhase`, LOD bands | `core/include/of/factory_sim.h` |
| Biome set that drives environment props | `core/include/of/biome.h` |
| Tech gates | `core/include/of/research.h` |
| Vessel / flight side (Phase S) | `core/include/of/orbital.h`, `sim_world.h` |
| 1 m voxel grid (`kVoxelSizeM = 1.0`) | `core/include/of/voxel_terrain.h` |

Do not add an asset that has no referent in those headers without logging it as a
decision with Admin first.

---

## 1. Art direction

**Clean, readable, stylized-industrial sci-fi.** Every object states its function in
its silhouette before you can read a label: a miner straddles the ground it eats, a
generator is a boiler with a turning flywheel, a furnace is a stone box with a lit
mouth. Forms are low-poly and hard-edged with grounded hard-sci-fi proportions (KSP
and Satisfactory, not Halo), lit by physically-based materials drawn from one small
palette, with colour carried by the material rather than by texture maps.

**Emissive is reserved for state, never for decoration.** The only glowing surfaces
in the game are the machine-state panels and genuine fire, so a player scanning a
factory at 50 m reads green / amber / red and instantly knows what is running, what
is starved, and what has lost power. That single rule is what buys Factorio's
at-a-glance clarity in 3D.

Practical consequences, all load-bearing:

- **Colour is carried by the palette; SURFACE is carried by two shared maps.**
  Base colour, metallic and roughness are still flat per-role constants and the
  palette is still the one place to retint the game. What changed on 2026-07-27
  (DW-35) is that every role in the industrial and mineral families also wears a
  shared tiling normal map and a shared occlusion/roughness/metalness pack, so
  panel lines, rivets, wear and crevice shadow exist. **There is still no
  per-asset texture and no albedo map at all**, see section 2.8.
- **Palette roles, not per-asset colours.** An asset picks from `of_lib.PALETTE`.
  Retinting the whole game is one file.
- **Silhouette over surface detail.** Poly budget goes into the outline, not into
  bevels nobody sees at 20 m.
- **Everything is a box or a cylinder until it needs not to be.** The scripted
  authoring path (section 6) makes primitive assembly cheap and organic sculpting
  expensive, and the art direction is chosen so that is the right trade.

---

## 2. World conventions every asset obeys

### 2.1 Units, axes, pivot

| Rule | Value |
|---|---|
| Unit | 1 Blender unit = **1 metre**, metric, `scale_length = 1.0` |
| Up (authoring) | Blender **+Z** |
| Up (runtime) | three.js **+Y**, produced by the exporter's `export_yup=True` |
| Forward (authoring) | Blender **-Y** |
| Forward (runtime) | three.js **+Z**, which is what `Object3D.lookAt()` aims for a non-camera object |
| Right | Blender **+X** to three.js **+X** |
| Axis map | Blender `(x, y, z)` becomes glTF `(x, z, -y)` |
| Pivot | footprint **centre** in X/Y, **base at Z = 0** |
| Frame rate | **60 fps**, so one animation frame equals one `of::SimClock` tick |
| Clip start | authored **frame 1** exports at **t = 0 s**, so an `n`-frame clip lasts `(n - 1)/60` s and runtime tick = authored frame - 1 (DW-34, `of_lib.clip_frame`) |

The pivot rule is what makes placement code trivial: a machine's origin is the point
that sits on the terrain, so there is never a per-asset height offset, and grid
snapping is pure arithmetic.

### 2.2 The build grid

The world uses a **1 m building grid** and a **1 m^3 voxel grid**
(`voxel_terrain.h: kVoxelSizeM = 1.0`). Therefore:

- **Every machine footprint is a whole number of metres.** No 1.5 m machines, ever.
- Snap rule for a footprint `w x d` metres, in three.js axes:
  `centre = (floor(x) + w/2, floor(z) + d/2)`.
  Odd sizes land on a cell centre, even sizes on a cell corner. This is the Factorio
  rule and it is why the pivot is the footprint centre rather than a corner.
- **A mesh must never exceed its declared footprint.** An overhanging part z-fights
  the neighbouring tile. The validator enforces this; it caught it on the very first
  asset (belt rollers protruding 10 mm past their cell).

### 2.3 Machine state materials

`FactorySim::entityVisualState()` emits one byte per entity. Each machine carries
exactly one `OF_EmissiveState` material on a small dedicated status surface, and the
renderer recolours its `emissive`:

| `VisualState` | Meaning | Emissive | Intensity |
|---|---|---|---|
| 0 | idle | `#1E5A66` dim cyan | 0.6 |
| 1 | working | `#3BE07A` green | 1.6 |
| 2 | blocked (starved or output full) | `#FFB020` amber | 1.4 |
| 3 | no-power (brownout at zero) | `#FF3B30` red | 1.2 |

Combustion machines (smelter, primitive furnace, survival smelter, generator) override
**working** only, to fire orange `#FF7A1E` at intensity 2.2, because a green-glowing
furnace reads wrong. Idle, blocked and no-power stay standard so the scanning rule
still holds.

For instanced machines a shared material cannot vary per instance. Feed the state
through a per-instance attribute and patch it in with `onBeforeCompile`; the four
colours above become a `vec3[4]` uniform lookup.

### 2.4 LOD bands

The LOD chain maps 1:1 onto `factory_sim.h`'s `enum class Lod`, so the renderer never
invents its own bands:

| Sim band | Mesh | Tri ratio | Distance | Notes |
|---|---|---|---|---|
| `Near0` | `<Name>_LOD0` | 100% | 0 to 25 m | discrete belt items drawn (`GetLineItems`) |
| `Mid1` | `<Name>_LOD1` | ~45% | 25 to 80 m | belts become a scrolling flow, no discrete items |
| `Far2` | `<Name>_LOD2` | ~15% | 80 to 250 m | or a billboard impostor |
| `OnRails3` | not rendered | 0 | > 250 m | chunk demoted |

LOD0 is mandatory. LOD1 and LOD2 are mandatory for anything a player will see a
hundred of (machines, nodes, props) and optional for one-off assets. Hard-surface
LODs are **hand-built**, not decimated: a collapse decimator wrecks a box silhouette
long before it saves anything. `of_lib.add_lod_decimate()` exists for organic assets
(rock, tree, character) where it does work.

### 2.5 Collision

One convex proxy per asset, named `col_<Name>`, at most 64 triangles, never rendered
(the renderer hides any node whose name starts with `col_`). A machine's proxy is a
box matching its footprint. The player capsule is generated in code, not exported.

**Amended 2026-07-25 for Tier 1 (scatter).** "One proxy per asset" is the wrong default
for a biome atlas, where an asset is a file holding several props drawn by the
thousand. A grass tuft with a collider is a player snagging on grass, and a thousand
proxies per chunk is a physics bill nobody wants for decoration. So an atlas authors a
`col_<Prop>` box **only where the prop is a solid obstacle a player must not walk
through** (rocks, boulders, spires, logs, dead trees, ice, timber frames), and
everything soft or ankle-height is deliberately NoCollision. Which is which is a
render-and-physics contract, so it is declared: `contracts.json`'s `collision` key
takes a **list** for these files and the validator checks every name in it. The
per-file split is tabulated in section 3.2.

### 2.6 Sockets

Attachment points are Blender Empties exported as childless glTF nodes and found at
runtime with `root.getObjectByName('socket_...')`. A socket's local **-Y** is its
facing (three.js +Z), matching the asset forward convention. `export_extras=True`
carries a custom `of_role` property through to `object.userData.of_role`.

Canonical socket names:

| Socket | Meaning |
|---|---|
| `socket_item_in`, `socket_item_in_a/b` | where an inserter or belt delivers |
| `socket_item_out` | where product leaves |
| `socket_belt_in`, `socket_belt_out` | belt line endpoints |
| `socket_item` | where a discrete item mesh rides on a belt at LOD0 |
| `socket_power_in`, `socket_power_out`, `socket_wire_a/b` | power network attachment |
| `socket_fuel_in` | solid-fuel loading (survival `Furnace` fuel pool) |
| `socket_status` | the state light |
| `socket_smoke` | particle emitter origin |
| `socket_hand_R`, `socket_hand_L`, `socket_back`, `socket_head_cam` | character attachment |
| `socket_hit` | where tool-impact VFX plays on a harvest node |
| `socket_item_pop` | where a harvested item pops out |
| `socket_muzzle` | rocket engine plume origin |

**Added 2026-07-25 for Tier 2.** The space assets need seven more, and they are
canonical in exactly the same sense as the ones above:

| Socket | Meaning |
|---|---|
| `socket_stack_top`, `socket_stack_bottom` | the 1.25 m stack mating planes, facing away from the part along the stack axis |
| `socket_radial_mount` | a radial part's origin, on its mount plane, facing outward |
| `socket_leg_foot` | a landing leg's ground-contact point. It hangs under `leg_pivot`, so it rides the deploy clip |
| `socket_hatch` | crew hatch / EVA point |
| `socket_vessel` | the launch pad's vessel mating point: where a vessel's `socket_stack_bottom` goes |
| `socket_clamp` | the launch pad's clamp mounting circle |
| `socket_chute` | where a parachute canopy spawns |

**Added 2026-07-27 for belt cargo (W11 lane A).** Four sockets, and between them
they are the whole interface a belt-cargo renderer binds to.

| Socket | Meaning |
|---|---|
| `socket_item_a` | where the item path ENTERS the tile, on the belt carrying surface |
| `socket_item_b` | where it LEAVES. On a straight this is the opposite cell boundary; on a curve it is the side one |
| `socket_item` | unchanged in position, promoted in meaning: it is the path MIDPOINT |
| `socket_rest` | on an ITEM, a child of the item node, at the item's own lowest point on its vertical axis |

**One rule covers both tile shapes: an item's position across a tile is the
circular arc through `socket_item_a`, `socket_item`, `socket_item_b`,
parameterised by ARC LENGTH.** On a straight tile the three are collinear and
the arc degenerates to the chord, so a consumer has no per-shape branch. The
midpoint is not decoration: from the two endpoints alone a quarter turn and a
three-quarter turn are the same two points on the same circle, and only the
middle point tells them apart.

`socket_rest` exists so that "put this item on the belt" is
`item.position = pathPoint - clone.getObjectByName('socket_rest').position`, one
subtraction. Items are `pivot_mode: "centre"` because they tumble when dropped,
so without it every consumer would need each item's half height, which is
exactly the per-asset offset table this pipeline does not have anywhere else.
All fifteen dedupe to the same name, so the runtime rule is the one
`rocket_parts.glb` already publishes: **clone the PART node and query the
clone**, never the file root.

**Added 2026-07-26 for the base-building set.** These are the placement lane's
whole interface to the structural parts: a build system that reads them never
does arithmetic on module constants, so a change to `structure_common.py`
propagates without a code change.

| Socket | Meaning |
|---|---|
| `socket_top` | the plane the NEXT module's origin sits on. On a deck that is its walkable surface (`y = 0.50`); on a wall or door it is the head (`y = 3.50`), which is the base plane of the deck above. On a `PillarFoot` it is where the shaft base goes |
| `socket_edge_n/e/s/w` | a deck's four edge midpoints, **on the deck top**. This is exactly where a wall's origin goes, so "put a wall on this foundation's north edge" is one `getObjectByName` and one assignment. Each faces outward |
| `socket_end_l`, `socket_end_r` | a wall's two end faces, for collinear continuation: a wall run walks `socket_end_r` to the next wall's origin |
| `socket_hinge` | the door's hinge axis, on the left jamb's inner face |
| `socket_deck` | a `PillarHead`'s top: where the underside of the foundation it supports sits |

**Added 2026-07-26 for the DW-29 vessel catalogue.** Three more, and they exist
because two diameter classes and radially carried parts are both things the
1.25 m single-class contract had no way to say.

| Socket | Meaning |
|---|---|
| `socket_radial_out` | on a `RadialDecoupler` only: the far face of the standoff, where a radially carried part's own hull lands. Its X coordinate **is** the published hull-to-hull gap, so nothing re-derives it |
| `socket_radial_attach` | on a part that is CARRIED radially rather than surface-mounted (the solid booster): a point on the part's OWN hull, facing inboard. It mates with `socket_radial_out` under the same anti-parallel rule a stack joint uses |
| `socket_dock` | a docking port's capture plane. Co-located with that part's `socket_stack_top`, because a dock face genuinely is a mating plane, and named separately because docking is a different operation from assembly |

**Stack sockets now carry their diameter class in `of_role`**: `stack_top_s`,
`stack_bottom_s`, `stack_top_l`, `stack_bottom_l`. That is not decoration. With
one class, "does this mate" was answered by the anti-parallel dot product alone;
with two, a 2.50 m decoupler will happily land on a 1.25 m tank and the dot
product will approve it. `StackAdapter` is the part that makes the distinction
unavoidable, since it carries `stack_bottom_l` and `stack_top_s` on the same
part, and it is exactly the case a per-part class lookup would get wrong.

**Socket names are scoped to the PART, not to the file** (Tier 2 only, and only
in `rocket_parts.glb`). Thirteen parts each carry a `socket_stack_top`, so the
runtime rule is: clone the part node and query the clone. Calling
`getObjectByName('socket_stack_top')` on the file root returns whichever part
happens to be first in the scene.

Blender cannot express that on its own, because `bpy.data.objects` names are
unique per **file**: the second part to ask for the name gets
`socket_stack_top.001` and the thirteenth gets `.012`. glTF node names are
non-normative and duplicates are legal, so the fix is an export post-pass,
`of_lib.export_glb(dedupe_socket_names=True)`, which strips the numeric suffix
from **socket** nodes only. It is off by default, so the other 41 files are
untouched, and a mesh or a proxy that ever picks up a suffix still shows it,
because that would be a real bug rather than a scoping artefact.

### 2.7 Depletion variants and the harvest-node node graph

**(Added 2026-07-25 by ART-PRODUCTION during the harvest-node batch. Section 3.1
mandated depletion variants but never said how they compose with the LOD chain
or with animation, and three separate build failures came out of that gap.
This is the resolved contract; the nine shipped nodes obey it.)**

A harvest node ships every depletion variant in one `.glb`:

```
<Root>                              root Empty
  [fell_pivot]                      Tree_Fall drives this  (trees only)
    [sway_pivot]                    Tree_Sway drives this  (tree family only)
      <Root>_<Variant>_LOD0..n      one full LOD chain PER variant
  [<anim>_pivot]                    Water_Ripple / Oil_Bubble drive this
    <Root>_<Variant>_<Part>         the animated part for that variant
  col_<Root>
  socket_*
```

| Rule | Value |
|---|---|
| Variant set | `Full`, `Half`, `Low`, and `Stump` for the two trees |
| Swap thresholds | `RemainingAmount / InitialAmount` at 0.66 and 0.33 |
| Node name | `<Root>_<Variant>_LOD<n>`, every variant carrying the same LOD depth |
| Renderer rule | show every node whose name starts with `<Root>_<Variant>_`, then pick the `_LOD<n>` band by distance |
| Pivot | identical in every variant: base centre, `Z = 0`, no per-variant offset |
| Bounds | no variant exceeds the `_Full` footprint, so a swap never needs a re-snap |
| Contract `lod0_node` | always the `_Full` LOD0; it defines the declared dimensions |

**One clip drives one object, and the pivots are shared across variants.**
`export_animation_mode = ACTIONS` turns one Blender Action into one named
`AnimationClip`, and `validate_glb.py` checks the clip name set **exactly**, so
a second Action called `Tree_Sway` would export as `Tree_Sway.001` and fail the
build. Per-variant animated objects are therefore impossible: every variant's
meshes hang under the *same* pivot, and one `Tree_Sway` sways whichever variant
is currently visible. Where the spec asked for two parts moving out of phase
(the oil seep's mounds) the group is tipped as well as scaled, which produces
the alternation from a single object.

**A clip's frame 1 must be the identity pose.** Assigning an Action makes the
depsgraph evaluate the object at the current frame and the exporter writes
*that* into the node's TRS, so a sway clip starting one degree off axis bakes a
permanent lean into the asset. It surfaced as a 2.483 m wide conifer failing a
2.400 m scale check, which is exactly the class of bug section 7.3 is about.

### 2.8 Texture policy, SHIPPED 2026-07-27 (DW-35)

The old text here said textures were deferred until the payload would cross 1 MB.
That threshold was never the binding constraint; the binding constraint was that
**37 of 48 shipped assets were flat colour on a PBR material with no maps**, which
is a materials ceiling that no amount of extra geometry addresses. This section is
what replaced it.

**Two shared tiling surfaces, no per-asset textures, and no albedo map.**

| family | what it is | size | tile | texel density | roles |
|---|---|---|---|---|---|
| `panel` | plate seams, rivets, bolt heads, a weld bead, rubs, grime | 512 x 512 | 1.50 m | 341 px/m | Steel, SteelDark, SteelLight, Accent, Hazard, Plate, Suit, SuitDark, SuitAccent |
| `coarse` | chipped facets and granular relief | 384 x 384 | 0.75 m | 512 px/m | Rock, RockDark, Regolith, Sand, Soil, Coal, Bark, BarkLight, Rubber, Iron, Copper |

Each family ships `of_<family>_n.png` (tangent-space normal, OpenGL +Y) and
`of_<family>_orm.png` (R = occlusion, G = roughness, B = metalness), plus one
`surfaces.json` manifest, under `assets/textures/dist/`. **Total payload 0.52 MB**,
which is still under the 1 MB KTX2 threshold, so the KTX2 step below is still
deferred and is now the honest next win.

**There is no albedo map, deliberately, and there are three independent reasons.**
It is the map DW-35 ranks last ("roughness variation matters more than albedo
detail"). It is the only map that can silently move the palette, and the ask was a
polish pass and not a restyle. And it would not survive the client anyway:
`MachineBatch` sets `vertexColors: true` and its `onBeforeCompile` writes
`diffuseColor.rgb` *after* `<map_fragment>`, so a base-colour map would be tinted
by the baked vertex colour and then partly overwritten for four of the five roles.
Normal, roughness, metalness and AO all land earlier in the shader and are safe.

**ORM multiplies, it does not replace.** three.js computes
`roughness * roughnessMap.g` and `metalness * metalnessMap.b`, so the palette's
per-role constants survive and the map can only take a surface *down* from them.
That direction is the physically correct one: wear polishes metal and grime buries
it. A map authored as an absolute would flatten thirty roles onto one value.

**UVs are in METRES and every render primitive has them.**

- `of_lib.MeshBuilder.build()` box-projects each face along its dominant axis
  automatically. No build script authors UVs; `col_*` proxies are skipped because
  the client never renders them.
- A UV of 2.5 means 2.5 metres, not 2.5 repeats. The consumer applies
  `texture.repeat = 1 / tile_m` from the manifest. Tuning texel density is then a
  JSON edit rather than a rebuild and rebaseline of 48 binaries.
- **Coverage is uniform and that is a correctness requirement, not tidiness.** The
  client merges an asset's primitives with `mergeGeometries(list, false)`, three
  returns `null` on a mismatched attribute set, and both call sites swallow it with
  `?? list[0]`, so an asset with mixed UV coverage draws its *first* primitive and
  silently discards the rest. Untextured roles still carry UVs. A partial rollout is
  far more dangerous than none.
- Cost, measured: **+744 KB across 48 files, +22.9%**. That is the price of the
  uniformity rule. Skipping `_LOD1`/`_LOD2` would recover most of it and is
  explicitly NOT taken, because which LOD bands enter a `BatchedMesh` is client
  knowledge that is currently changing (RN-7 A-3/A-4).
- The one exception is `vfx_engine_plume.glb`, whose UVs are *authored* (V is a
  distance-down-the-plume shader input, a parameter rather than a surface
  measurement). It declares `uv_mode: "authored"` in `contracts.json`.

**No tangent attribute is exported.** three.js derives a tangent frame from screen-
space derivatives when `TANGENT` is absent, which is correct for flat-shaded
geometry and saves 16 bytes per vertex on top of the 8 the UV already costs.

**Determinism.** The maps are generated by `tools/blender/texgen.py`, which is
stdlib-only, uses no RNG (a 32-bit integer hash), no transcendentals in the field
synthesis (only `+ - * /` and `sqrt`, which is correctly rounded and therefore
bit-portable; `sin`/`cos`/`tan` are not, and DW-14 is this project's scar from
exactly that), and writes PNGs through its own encoder that emits IHDR + IDAT +
IEND and nothing else, no `tIME`, no `tEXt`, no generator string. **Blender is not
in the texture path at all**, so a Blender upgrade (BT-14) cannot rewrite a texture
byte. zlib is pinned to explicit parameters and its version is recorded in the
manifest.

**KTX2 LOADER LANDED (RN-1462, A2a, 2026-08-13); NO TEXTURE CONVERTED YET.**
The payload figures above are stale (0.52 MB was the DW-35 launch state; the
shipped set is 7.4 MB across 25 PNGs today, well past the old 1 MB trigger,
which is exactly why this lane wired the consumer side ahead of any producer
work). `web/src/assets/Loaders.ts` constructs one `KTX2Loader`, points
`setTranscoderPath` at `assets/basis/` (the two Basis Universal transcoder
files ship inside three's own npm package and `scripts/sync-assets.mjs`
copies them into `public/assets/basis/` on every `predev`/`prebuild`, never
from a CDN: the served build is LAN), wires it into the shared `GLTFLoader`
via `setKTX2Loader`, and exposes `initKtx2(renderer)` — called once from
`Boot.ts` right after `createRenderer`, because `KTX2Loader.detectSupport`
needs the concrete GPU context and `OFRenderer` hides it everywhere else
(`Renderer.ts`'s `detectKtx2Support` is the one seam crossing, mirroring
`environmentFrom`'s PMREMGenerator precedent). `Loaders.ts` also exports
`loadTexture(url)`, a single standalone-texture entry point Surfaces.ts's
four `make*Texture` helpers now call instead of each owning a
`THREE.TextureLoader()`: **`.ktx2` is opt-in purely by the file extension on
a family's `file` field in `surfaces.json`**, so a `.png` entry decodes
exactly as it did before this lane and a `.ktx2` entry routes through the
transcoder, with no manifest version bump required (existing `.png` families
are byte-for-byte unaffected; see the RN-1462 entry below for why converting
one is a producer decision this lane did not make). `gltf-transform` /
UASTC conversion of the shipped PNGs themselves remains **owed**, not done:
whichever lane authors the first real `.ktx2` asset is A2b's or a follow-on's
call, and it should re-measure the VRAM win rather than trust the 4.27 MiB
figure this section used to cite, which predates the 7.4 MB payload above.

**Texel density targets, unchanged and now met:** 512 px/m for hand-held and
first-person assets, 256 px/m for machines, 128 px/m for terrain props. `panel` ships at 341 px/m,
above its 256 px/m machine target, and `coarse` at 512 px/m. Maximum 1024 x 1024 per image.

**RN-1462: two new OPTIONAL `surfaces.json` family fields, additive only.**
`Surfaces.ts`'s wiring site (`apply()`/`ready()`) now also understands, per
family:

- `emissive: {file, bytes, sha256}` — a tiling, sRGB, metre-repeated map
  (`material.emissiveMap`), loaded and configured exactly like `normal`/`orm`
  above rather than card-shaped like a leaf's `albedo`. Requires `tile_m` on
  the family; a manifest entry that carries `emissive` without one is refused
  with a thrown error at load, not silently dropped.
- `alpha: {file, bytes, sha256}` — a STANDALONE alpha mask
  (`material.alphaMap`), distinct from a card family's embedded RGBA alpha
  channel. Reuses the EXISTING `alpha_test` field as its required companion
  rather than adding a second one: three.js ignores `alphaMap` entirely on an
  otherwise-opaque material while `alphaTest` sits at its 0 default, so an
  `alpha` map with no valid `alpha_test` is refused the same way a present
  `albedo` with no `albedo_mean_linear` already is (D-016's precedent).
  Requires `tile_m` for the same reason `emissive` does.
- `normal_scale: number` — a per-family multiplier on the decoded
  tangent-space normal's XY (three's `material.normalScale`, both axes
  uniformly). Absent means three's own default of 1.0; every family that
  ships without it reads exactly as it did before this lane.

**No family in the shipped manifest declares any of the three today** (this
lane converts no texture, per its own brief); all three are dead weight on
the current build and exist so a future texgen pass or hand-authored family
has somewhere to land without a second client-side wiring pass. `version`
stays `2`: these are pure additions an old client would silently ignore, not
a changed meaning for an existing field (contrast D-016's
`albedo_mean -> albedo_mean_linear`, which DID need the bump).

### 2.9 What the CLIENT must do to consume the maps

**Until this lands, the maps and the UVs are inert.** The `.glb` files are correct
and complete, they carry the UVs, they validate, and nothing on screen changes.
This is the whole hand-off; it is deliberately small and it is owned by the render
and client lanes, not by the asset pipeline.

**Serving is already done** (`web/scripts/sync-assets.mjs`, 2026-07-27): the maps
are copied to `public/assets/textures/` and are fetched at
`assets/textures/of_panel_n.png` and so on, with the same relative-path scheme
every `.glb` already uses. `surfaces.json` sits beside them.

Three code changes, in order of consequence.

**(1) Carry `uv` through the three `normalize()` functions.** These are the same
25-line function copy-pasted, and each builds a fresh `BufferGeometry` from an
attribute allowlist that does not include `uv`:

- `web/src/game/MachineBatch.ts:71-98`, machines, belts, structures, belt cargo
- `web/src/game/NodeBatch.ts:96-120`, harvest nodes
- `web/src/render/instancing/PropLibrary.ts:63-83`, biome props

Copy `uv` alongside `position` and `normal`. **Copy it unconditionally.** Do NOT
write `if (src.getAttribute('uv')) ...`: a conditional reintroduces exactly the
mixed-attribute merge failure that uniform UV coverage exists to prevent, and it
fails silently at `MachineBatch.ts:256` / `NodeBatch.ts:36`. If a geometry ever
arrives without UVs, synthesise a zero-filled attribute rather than skipping.

**(2) Attach the maps to the batch materials.** Load once, share everywhere; a
per-file texture would multiply VRAM by the asset count.

```
const t = new THREE.TextureLoader();
const tex = await t.loadAsync('assets/textures/of_panel_n.png');
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(1 / tileM, 1 / tileM);      // tileM from surfaces.json
tex.anisotropy = caps.anisotropy;          // Renderer.ts:97 already reports it
// colorSpace: leave as the default NoColorSpace. BOTH maps are data.
```

Then, on each material:

```
mat.normalMap = normalTex;
mat.roughnessMap = ormTex;
mat.metalnessMap = ormTex;                 // one texture, three slots
mat.aoMap = ormTex;
mat.aoMap.channel = 0;                     // REQUIRED: aoMap defaults to uv1
```

Sites: `MachineBatch.ts:163-166` (`makeMaterial`, covers all three
`MachineBatch` instances), `NodeBatch.ts:225-233` (`makeBatch`, two materials),
`PropLibrary.ts:140` (right after `source.clone()`).

The `aoMap.channel = 0` line is the one that will be forgotten. three samples
`aoMap` from `uv1` unless told otherwise, and there is no `uv1`, so AO silently
samples texel (0,0) everywhere, which looks like a slightly wrong constant tint
rather than like a bug.

**(3) Choose the family per material.** `surfaces.json` carries `roles` (role ->
family) and `flat_roles` (role -> the reason it deliberately has no map). The role
name is the material name minus the `OF_` prefix. `MachineBatch` has already
reduced material names to an integer `aRole` by the time it builds its material, so
for the batched paths the practical choice is to use `panel` for the machine and
structure batches and `coarse` for the node batches, and to leave the per-role
distinction to `PropLibrary`, which is the one path that keeps a material per name.
A role absent from both tables is a bug in the asset pipeline, not in the client;
report it rather than defaulting.

**Do not** add a base-colour map. See section 2.8 for why it would not survive
`MachineBatch`'s shader edit.

**The one place this scheme visibly compromises, stated rather than discovered.**
Two of the three batch paths collapse many roles onto one material, so they cannot
express a per-role family:

- `NodeBatch` buckets into exactly two materials by `metalness > 0.5`
  (`NodeBatch.ts:123-126`). Bark and Rock both land in `nodes:matte`, and so do
  **Leaf and Grass, which are in `flat_roles` and must not receive a map at all**. A
  rock normal map on a foliage card is worse than no map. The fix is small: bucket
  by *(family, metalness)* instead of by metalness alone, which turns 2 materials
  into at most 4. Draw calls are 53 of a 150 budget, so this is free.
- `MachineBatch` merges every machine, belt, structure and pillar into **one**
  material. Its roles are mostly `panel`, but `Rubber` (belt decks) and `Rock` (the
  primitive furnace) are `coarse`. Two options, and the choice is the render lane's:
  (a) put `panel` on the whole batch and accept plate seams on the belt rubber and
  the stone furnace, which is wrong but small at those surface areas; or (b) sample
  both families and select with the **`aRole` per-vertex integer that already
  exists** (`MachineBatch.ts:62-68`), inside the `onBeforeCompile` edit that is
  already there. Option (b) costs one extra texture fetch and **no new custom
  shader**, so it does not move against the DW-10 cap of five.

I would take (a) first and measure whether anyone notices, because (b) is easy to
add later and hard to justify before someone has looked at (a).

**Acceptance that would prove it works**, in this project's own style: the same
scene, same camera, same seed, captured with the maps attached and with them
detached behind an isolation flag (`?maps=0`, standing rule 7), differenced. A
"before" that is identical to the "after" means the UVs did not arrive.

---

## 3. Asset manifest

**Totals: 99 distinct meshes across 42 `.glb` files.** Tier 0 is 40 meshes in 27
files, Tier 1 is 41 meshes in 10 files, Tier 2 is 18 parts in 5 files. All 42
are built and green; counting LOD bands and depletion variants, those 42 files
hold **262 render mesh nodes** (measured, excluding `col_*` proxies).

### 3.1 Tier 0: blocks the playable loop (27 files, 40 meshes)

Poly budgets are LOD0 triangles. Dimensions are metres, given as
`X (width) x Y (depth/flow) x Z (height)` in Blender axes.

#### Character and tools (4 files)

| # | Asset | File | Dims (m) | Tris | LODs | Col | Anim | Emissive |
|---|---|---|---|---|---|---|---|---|
| 1 | Player body (rigged) | `player/player_body.glb` | 0.60 x 0.40 x **1.80** | 3500 | 3 | box | 14 clips | yes |
| 2 | First-person arms | `player/player_fp_arms.glb` | 0.90 x 0.70 x 0.55 | 1200 | 1 | none | 8 clips | no |
| 3 | Crude pickaxe | `tools/crude_pickaxe.glb` | 0.34 x 0.10 x 0.95 | 260 | 2 | box | none | no |
| 4 | Crude axe | `tools/crude_axe.glb` | 0.22 x 0.09 x 0.80 | 240 | 2 | box | none | no |

#### Harvest nodes, one per `worldgen::survival::NodeKind` (9 files)

| # | Asset | File | `NodeKind` | Dims (m) | Tris | LODs | Anim |
|---|---|---|---|---|---|---|---|
| 5 | Conifer tree | `nodes/tree_conifer.glb` | `Tree` | 2.4 x 2.4 x 6.5 | 600 | 3 | sway, fall |
| 6 | Broadleaf tree | `nodes/tree_broadleaf.glb` | `Tree` | 4.0 x 4.0 x 5.0 | 700 | 3 | sway, fall |
| 7 | Scrub bush | `nodes/bush_scrub.glb` | `Tree` (low yield) | 1.0 x 1.0 x 0.9 | 200 | 2 | sway |
| 8 | Stone boulder | `nodes/boulder_stone.glb` | `Rock` | 1.4 x 1.2 x 0.9 | 460 | 3 | none |
| 9 | Iron boulder | `nodes/boulder_iron.glb` | `IronOre` | 1.6 x 1.4 x 1.1 | 290 | 3 | none |
| 10 | Copper boulder | `nodes/boulder_copper.glb` | `CopperOre` | 1.5 x 1.3 x 1.0 | 570 | 3 | none |
| 11 | Coal seam boulder | `nodes/boulder_coal.glb` | `CoalSeam` | 1.7 x 1.4 x 1.0 | 420 | 3 | none |
| 11a | Rock spire | `nodes/rock_spire.glb` | `Rock` | 1.3 x 1.15 x 2.6 | 690 | 3 | none |
| 12 | Water pool | `nodes/water_pool.glb` | `WaterPool` | 3.0 x 3.0 x 0.25 | 280 | 2 | ripple |
| 13 | Oil seep | `nodes/oil_seep.glb` | `OilSeep` | 2.2 x 2.2 x 0.35 | 260 | 2 | bubble |

Every node ships three **depletion variants** as sibling meshes in the same file
(`_Full`, `_Half`, `_Low`, plus `_Stump` for trees), swapped by
`RemainingAmount / InitialAmount` at 0.66 and 0.33. Depletion is the one piece of
`FDepositNode` state a player must be able to see from across a clearing. The
`Tris` and `LODs` columns above are the **`_Full` LOD0 budget and the LOD depth
per variant**; every variant carries the full chain, so the nine node files hold
83 meshes between them. See section 2.7 for the node graph, the naming and why
the animation pivots are shared rather than per-variant.

#### Dropped-item props (1 file, 14 meshes)

`items/items_atlas.glb`. Every item fits inside a 0.30 m cube (a log is the one
exception at 0.60 m along its length) so it rides a 1 m belt cleanly and renders
legibly into a 64 px inventory icon. 40 to 120 tris each, 1200 total. No LODs: the
sim stops emitting discrete items above `Lod::Near0`, so they simply vanish.

| Mesh | Item (`gameplay.h`) | Dims (m) | Materials |
|---|---|---|---|
| `Item_OreChunk_Iron` | `RawIron` 0x0033 | 0.26 x 0.22 x 0.20 | Rock, Iron |
| `Item_OreChunk_Copper` | `RawCopper` 0x0034 | 0.26 x 0.22 x 0.20 | Rock, Copper |
| `Item_CoalLump` | `Coal` 0x0032 | 0.24 x 0.20 x 0.18 | Coal |
| `Item_StoneChunk` | `Stone` 0x0031 | 0.24 x 0.22 x 0.18 | Rock |
| `Item_Log` | `Wood` 0x0030 | 0.60 x 0.18 x 0.18 | Bark |
| `Item_IngotIron` | `Iron` 0x0037 | 0.28 x 0.14 x 0.08 | Iron |
| `Item_IngotCopper` | `Copper` 0x0038 | 0.28 x 0.14 x 0.08 | Copper |
| `Item_FerriteOre` | `FerriteOre` 0x0001 | 0.26 x 0.22 x 0.20 | Rock, Accent |
| `Item_FerritePlate` | `FerritePlate` 0x0002 | 0.28 x 0.28 x 0.02 | Iron |
| `Item_FramePart` | `FramePart` 0x0003 | 0.28 x 0.28 x 0.10 | Iron, Steel |
| `Item_Cinderite` | `Cinderite` 0x0004 | 0.24 x 0.22 x 0.20 | RockDark, EmissiveState |
| `Item_Combustite` | `Combustite` 0x0005 | 0.22 x 0.20 x 0.18 | Coal, Accent |
| `Item_WaterCanister` | `Water` 0x0035 | 0.18 x 0.18 x 0.30 | Steel, Glass |
| `Item_OilFlask` | `Oil` 0x0036 | 0.16 x 0.16 x 0.28 | Glass, Oil |

`Item_Cinderite` is the only item allowed an emissive: it is the off-world identity
hook (`WG-4`, Cinder-only) and a faint glow is how the player knows the moon trip
paid off. Tool pickups reuse the tool meshes; they are not separate assets.

#### Machines and structures (13 files)

Footprints are whole metres, as required by section 2.2.

| # | Asset | File | TypeId | Footprint | Height | Tris | Anim |
|---|---|---|---|---|---|---|---|
| 14 | Miner | `machines/miner.glb` | 0x10 | **2 x 2** | 2.4 | 900 | spin, bob |
| 15 | Belt segment | `machines/belt_segment.glb` | 0x11 | **1 x 1** | 0.30 | 148 | scroll |
| 16 | Belt curve left | `machines/belt_curve_l.glb` | 0x11 | **1 x 1** | 0.30 | 200 | scroll |
| 17 | Belt curve right | `machines/belt_curve_r.glb` | 0x11 | **1 x 1** | 0.30 | 200 | scroll |
| 18 | Belt end cap | `machines/belt_end_cap.glb` | 0x11 | **1 x 1** | 0.30 | 120 | none |
| 19 | Smelter | `machines/smelter.glb` | 0x12 | **2 x 2** | 2.6 | 700 | glow |
| 20 | Assembler | `machines/assembler.glb` | 0x13 | **8 x 8** | 4.0 | 1100 | arm cycle |
| 21 | Box | `machines/box.glb` | 0x14 | **4 x 4** | 3.0 | 700 | lid |
| 22 | Generator | `machines/generator.glb` | 0x15 | **3 x 2** | 2.6 | 900 | flywheel |
| 23 | Power pole | `machines/power_pole.glb` | 0x16 | **1 x 1** | 4.0 | 350 | none |
| 24 | Inserter | `machines/inserter.glb` | sim-internal | **1 x 1** | 0.9 | 400 | swing |
| 25 | Primitive furnace | `machines/primitive_furnace.glb` | 0x30 | **1 x 1** | 1.4 | 500 | glow |
| 26 | Survival smelter | `machines/survival_smelter.glb` | 0x31 | **2 x 2** | 2.0 | 700 | bellows, glow |

Note on the inserter: `automation.h`'s `BuildKind` has no inserter, but
`FactorySim::addInserter` exists and the wiring layer places them automatically, so
they appear in the world and need a mesh even though the player never selects one.

Two build-UX meshes are **generated in code, not authored**: the 1 m^3 voxel dig
marker (`BoxGeometry` + `EdgesGeometry`) and the placement ghost (the machine's own
LOD0 with a ghost material). Do not model them.

#### Base building structures (5 files). **Built 2026-07-26, rescaled to a 4 m module the same day (DW-32 / BT-11).**

| # | Asset | File | Anchor | Module (m) | Tris | LODs | Anim |
|---|---|---|---|---|---|---|---|
| 27 | Foundation | `structures/foundation.glb` | cell centre | **4 x 4 x 0.50** | 108 | 3 | none |
| 28 | Floor / ceiling | `structures/floor.glb` | cell centre | **4 x 4 x 0.50** | 132 | 3 | none |
| 29 | Wall | `structures/wall.glb` | cell **edge** | **4 x 0.25 x 3.50** | 108 | 3 | none |
| 30 | Door | `structures/door.glb` | cell **edge** | **4 x 0.25 x 3.50** | 216 | 3 + leaf | swing |
| 31 | Support pillar | `structures/pillar.glb` | assembled | foot 1.20, shaft **1.00 scalable**, collar 0.70, head 1.00 | 100 / 28 / 56 / 52 | 1 | none |

Full spec in sections 4.23 (the module) and 4.24 (the pillar). These are the
first Tier-0 assets with **no referent in the headless headers**:
`automation.h`'s `BuildKind` has no structural kinds and `gameplay.h` has no
structural items, so they were built on Reid's direct request and are logged as
decision **BT-9**. `survival::StructureKind` has since appeared on the `/core`
side, but costs and recipes are still a gameplay call, and the rescale makes
that call urgent: a 4 m foundation covers **sixteen times** the ground a 1 m one
did, so leaving the price alone silently divides the cost of a base by 16.

**There is no `ceiling.glb`, deliberately.** Storey N's ceiling is storey N+1's
floor: the same part, the same origin, placed at `y = 4(N+1)`. Shipping a second
flipped file would double the payload to make the same picture.

### 3.2 Tier 1: richness (10 files, 41 props). **Built 2026-07-25.**

Shipped as **per-biome atlases**, because the scatter system wants one file per biome
and one `InstancedMesh` per prop. Budgets: 60 to 400 tris each, LOD0 and LOD2 only
(props skip the middle band; they are either near enough to matter or gone).

**The binding an engine agent needs.** One atlas per `Biome`, loaded once and
instanced per prop. `Prop` here is the node stem: the file holds `<Prop>_LOD0` and,
except in `detail_cards.glb`, `<Prop>_LOD2`. All 41 props are ground-pivoted and
sit on the file origin, so a scatter placement matrix is pure terrain data.

| File | Biome (`biome.h`) | Props | Tris (LOD0 sum) | Mats | KB |
|---|---|---|---|---|---|
| `props/props_beach.glb` | `Beach` | `Beach_Rock`, `Beach_Driftwood`, `Beach_ShellCluster`, `Beach_DuneGrass` | 411 | 4 | 40 |
| `props/props_plains.glb` | `Plains` | `Plains_GrassTuftA`, `Plains_GrassTuftB`, `Plains_FlowerCluster`, `Plains_PebbleA`, `Plains_PebbleB`, `Plains_Shrub` | 438 | 4 | 45 |
| `props/props_forest.glb` | `Forest` | `Forest_Fern`, `Forest_DeadTree`, `Forest_FallenLog`, `Forest_MushroomCluster`, `Forest_Rock` | 527 | 4 | 53 |
| `props/props_hills.glb` | `Hills` | `Hills_LargeBoulder`, `Hills_ScreePatch`, `Hills_Shrub` | 436 | 4 | 39 |
| `props/props_mountains.glb` | `Mountains` | `Mtn_ScreeSheet`, `Mtn_TalusFan`, `Mtn_FrostShards`, `Mtn_SnowPatch` | 650 | 3 | 62 |
| `props/props_polar.glb` | `Polar` | `Polar_IceShard`, `Polar_SnowDrift`, `Polar_IceBoulder` | 306 | 3 | 29 |
| `props/props_ocean.glb` | `Ocean` | `Ocean_Kelp`, `Ocean_SeabedRock` | 169 | 3 | 18 |
| `props/props_moon.glb` | `Regolith`, `MoonHighland`, `CraterFloor` | `Moon_RockSmall`, `Moon_RockLarge`, `Moon_RegolithRipple`, `Moon_HighlandOutcrop`, `Moon_CraterRimRock`, `Moon_ImpactGlass` | 510 | 4 | 52 |
| `props/props_cave.glb` | voxel tunnels | `Cave_Stalagmite`, `Cave_CrystalCluster`, `Cave_Rubble`, `Cave_SupportFrame`, `Cave_OreVeinPanel` | 548 | 5 | 54 |
| `props/detail_cards.glb` | terrain detail | `Detail_GrassCardA/B/C`, `Detail_PebbleScatter` | 118 | 3 | 11 |

Every LOD0 lands between 18 and 162 triangles against the 400 ceiling. The budget is a
ceiling, not a quota: these are drawn by the thousand, and the real budget is the
**material count**, because the renderer batches by material and an atlas that uses six
roles costs six draws per chunk where one that uses three costs three.

**The moon is one file for three biomes**, which is right rather than lazy. `biome.h`
classifies a moon by elevation band alone (`rel < -0.10` crater floor, `rel > 0.20`
highland, regolith otherwise), the bands abut with no transition zone, and the surface
material is the same dust everywhere. The scatter pass loads one file and picks a
subset: Regolith takes `RockSmall`/`RockLarge`/`RegolithRipple`, MoonHighland takes
`HighlandOutcrop`/`RockLarge`/`RockSmall`, CraterFloor takes
`CraterRimRock`/`ImpactGlass`/`RockSmall`.

**Collision is per-prop and deliberately partial** (see the amendment in section 2.5).
These eighteen carry a `col_<Prop>` box; the other twenty-three are walk-through:

| Collides | Walk-through |
|---|---|
| `Beach_Rock`, `Beach_Driftwood`, `Plains_PebbleB`, `Forest_DeadTree`, `Forest_FallenLog`, `Forest_Rock`, `Hills_LargeBoulder`, `Polar_IceShard`, `Polar_IceBoulder`, `Ocean_SeabedRock`, `Moon_RockLarge`, `Moon_HighlandOutcrop`, `Moon_CraterRimRock`, `Cave_Stalagmite`, `Cave_CrystalCluster`, `Cave_SupportFrame` | all grass, flowers, ferns, kelp, both shrubs, shells, mushrooms, scree, rubble, snow patch, snow drift, regolith ripple, impact glass, small pebbles, the ore vein panel, and every detail card |

`col_Forest_DeadTree` is the **trunk box only** (0.50 x 0.50 x 4.20), the same rule the
conifer follows: a player walks through where the branches were.

**RN-245: `props_mountains.glb` lost `Mtn_RockSpire` and `Mtn_TalusChunk`.**
WG-68 retired both from the world (there are no inert rocks: anything
rock-shaped at or above the interaction threshold is a harvest node and
gives stone), and they lingered in the atlas as art nothing referenced. The
spire is back as `nodes/rock_spire.glb`, a real harvest node. Three new
sub-threshold forms replace the decoration: `Mtn_ScreeSheet`,
`Mtn_TalusFan` and `Mtn_FrostShards`. The atlas now carries NO collision
proxy, because everything in it is ankle-height debris.

**RN-246: the decoration size rule had a factor missing.** WG-68 cleared
surviving decor by comparing AUTHORED height against
`RockTuning.DECOR_ROCK_MAX_H` (0.27 m). A harvest node is placed at a
uniform scale, but `ScatterLook.scaleFor` multiplies a non-foliage prop's
HEIGHT by up to `MINERAL_H_HI` (1.24) on top of `1 +/- jitter`, so an
authored 0.24 m scree patch is DRAWN at up to 0.372 m. The corrected cap is
`0.27 / (1 + jitter) / 1.24`, i.e. 0.174 m for a `P` prop, and it is a
build-time check in `crag_common.check_decor_height` rather than a comment.
`Hills_ScreePatch` is lowered to 0.168 m here. **`Plains_PebbleA` at 0.18 m
is still over it** (drawn at up to 0.279 m) and is owed a pass.

**Two props have a non-standard contract.**

`Cave_OreVeinPanel` is a shallow decal placed flat against a dug voxel face when the
voxel it replaced held ore, so its pivot is its **volumetric centre**, not the ground:
it mates with a 1 m face, not with a floor. It carries exactly two material slots in
pinned order, `OF_RockDark` host then `OF_Iron` vein, and **the renderer overrides slot
1 per ore type** (iron / copper / coal / ferrite). One mesh, four ores, no extra
geometry. Its vein runs corner to corner so a rich seam tiles across several dug faces
as one continuous streak instead of a row of identical stamps.

`Cave_SupportFrame` is 2.40 m tall against a 1.80 m player, and that is its whole job:
a raw voxel tunnel is a corridor of identical cubes with no scale reference at all, and
a frame is what gives it a readable height.

**Cave crystals are `OF_Glass`, never `OF_EmissiveState`.** Section 1 reserves emissive
for machine state and genuine fire, and a glowing decorative crystal would break the
one rule that buys this game its at-a-glance clarity. The player has a helmet lamp for
exactly this reason.

**Corrected 2026-07-25 (foliage is geometry, not alpha-tested cards).** This section
described `detail_cards.glb` as crossed quads drawn with alpha test. There is no
texture pipeline (section 2.8 defers one until the texture payload would cross 1 MB,
and 41 untextured props never get close), and **an untextured crossed quad renders as a
solid rectangle standing in the grass**. Every foliage prop in Tier 1 is therefore
built as real tapered blade geometry: `props_common.blade()` is five triangles for a
shape that reads as grass from any angle, which is cheaper than the alpha-test fragment
cost would have been and needs no UVs, no mask authoring and no KTX2 step.

**Corrected 2026-07-25 (double-sided).** This section called the detail cards "the only
double-sided meshes in the game outside glass and water". `OF_Leaf` and `OF_LeafDry`
have been in `of_lib.DOUBLE_SIDED` since the trees shipped, because a single-sided leaf
disappears from half the angles you look at it from. Tier 1 adds no new double-sided
role; it uses `OF_Leaf`, `OF_LeafDry` and `OF_Glass`, all already exempt.

**Corrected 2026-07-25 (detail-card budget and LODs).** The 60-to-400 band and the
LOD0/LOD2 chain do not apply to `detail_cards.glb`. Those four are the layer *under*
the biome props, stamped by the square metre where a biome prop is placed by the
handful, so their instance count is one to two orders of magnitude higher. They run
18 to 42 triangles and carry **no LOD chain at all**: an 18-triangle card is already at
the floor, and the renderer culls the whole layer at its own detail distance, which is
one test rather than one LOD switch per instance.

**`OF_Oil` on `Moon_ImpactGlass` is a PBR role, not a substance.** Impact melt glass is
dark and *glossy*, and `OF_Oil` is the palette's only dark low-roughness ground surface
(0.25 against every other ground role's 0.9+). `OF_Glass` was the alternative and is
alpha-blended; thousands of alpha-blended instances is a sorting problem bought for
nothing.

### 3.3 Tier 2: Phase S, space (5 files, 18 parts). **Built 2026-07-25.**

| File | Parts | Tris (render) | Mats | KB |
|---|---|---|---|---|
| `rocket/rocket_parts.glb` | **24 parts, 26 meshes** | see 3.3 | 7 | see 3.3 |
| `rocket/launch_pad.glb` | pad + clamp, 6 meshes | 1000 | 6 | 65 |
| `rocket/lander_landed.glb` | 1 assembly, 3 meshes | 2580 | 7 | 119 |
| `rocket/vfx_engine_plume.glb` | 1 mesh | 142 | 1 | 5 |
| `world/body_sphere_lod.glb` | 1 sphere, 3 meshes | 1680 | 1 | 32 |

#### The stack contract, in TWO diameter classes (DW-29 / BT-12)

This is what the assembly UI binds to, and everything else in Tier 2 composes
out of it. It lives in code in `tools/blender/rocket_common.py` and is checked
per part by `contracts.json`'s `part_sockets` block, then measured on the
shipped bytes by `tools/blender/check_mating.py`.

| Class | Diameter | R | Segments | Barrel R |
|---|---|---|---|---|
| **S** | **1.25 m** | 0.625 | 16 | 0.600 |
| **L** | **2.50 m** | 1.250 | 24 | 1.200 |

**Two classes and no more, and L is exactly 2 S.** Two is the smallest number
that lets a vessel have a first stage wider than its payload, which is the
entire reason staging reads as staging rather than as a longer tube. A third
class would double the catalogue to buy a size nobody has asked for. The exact
factor of 2 is not cosmetic either: it keeps every radial attachment sum in
whole millimetres and makes the adapter a single frustum rather than a fudge.

| Rule | Value |
|---|---|
| Stack axis | Blender **+Z**, which is three.js **+Y**: a vessel assembles up the world up axis and needs no rotation to stand on a pad |
| Stack part origin | its **bottom mating plane**, centred on the axis: `pivot_mode: "ground"`, the same rule a machine obeys |
| `socket_stack_bottom` | always local `(0, 0, 0)`, facing three.js **-Y** (down, away from the part) |
| `socket_stack_top` | local `(0, H, 0)` in three.js axes, facing **+Y** (up, away from the part) |
| To stack B **above** A | `B.position = A.position + A.socket_stack_top.position`. No per-part offset table exists anywhere |
| To hang B **below** A | `B.position = A.position - B.socket_stack_top.position`. This is how an engine attaches, and it is the same socket |
| Mating test | two mated sockets are **anti-parallel**, so "do these faces mate" is a dot product. With two classes that is **necessary but no longer sufficient**: the `of_role` class suffix must also agree, or a 2.50 m decoupler will happily land on a 1.25 m tank and every geometric test will approve it |
| Terminators | an **engine** and a **solid booster** have no `socket_stack_bottom`, because nothing may ever be bolted under a bell; a **nose cone** has no `socket_stack_top`. They end a stack. A terminator may still be PLACED on a `socket_stack_top`, with its bell firing away from the joint, and that placement is exactly what an interstage is |
| Class change | **only** `StackAdapter`, which carries `stack_bottom_l` and `stack_top_s`. It is what makes two classes one catalogue instead of two disjoint ones |
| Radial parts | origin on the **mount plane**, body extending three.js **+X**. Attach with `position = (R cos a, y, R sin a)` and `rotateY(-a)`; `pivot_mode: "none"`, because neither `ground` nor `centre` describes a part whose origin is on its own side face |
| Radially CARRIED parts | a solid booster is a stack part held off the hull by a `RadialDecoupler`. Its `socket_radial_attach` (on its own hull, facing inboard) meets the decoupler's `socket_radial_out`. Centre-to-centre distance is `R_host + 0.30 + R_part`, and the 0.30 is read off the socket, never typed |

**Why the segment count is always divisible by 4.** A polygon whose segment
count is divisible by 4 puts vertices exactly on ±X and ±Y, so a 16-gon of
radius 0.625 measures exactly 1.25 x 1.25 and a 24-gon of radius 1.250 measures
exactly 2.50 x 2.50. A 14-gon of radius 0.625 measures 1.250 x 1.244 and misses
the dimension check by 6 mm. The cargo bay proved it on the first build: hinge
rods at 0.585 with a 0.05 radius pushed the box to 1.27.

Barrels are built one class step inside the collars (0.600 against 0.625, 1.200
against 1.250), so the mating diameter is carried by the rings and a stringer
standing proud of the barrel can never touch the bounding box.

**A mating face is built with the segment count of the class it presents.**
This is the second rule the two-class contract needed, and it cost three
defects on the day the catalogue was built. A 16-gon and a 24-gon of the *same
circumradius* do not have the same surface: their inradii are 0.6011 and
0.6146, so between those radii each pokes through the other at alternating
azimuths and the joint renders as a sawtooth ring. It passes every other check
in this document, because the bounding box is set by the circumradius and the
mating PLANE is still exact. `check_mating.py`'s coaxial pass now asserts it
mechanically over every shipped file (section 7.4).

#### The 24 parts

Dimensions are three.js axes (X right, Y up, Z forward), metres. `Cls` is the
diameter class the part's mating faces present. **This table is the assembly
UI's interface**: part name, class, envelope, and every socket with its exact
local position.

**Class S stack parts** (R 0.625, 16 segments). `socket_stack_bottom` is at
`(0,0,0)` on all of them except the two terminators.

| Part | DW-29 role | Dims | Tris | `socket_stack_top` | Other sockets |
|---|---|---|---|---|---|
| `CommandPod` | command pod | 1.25 x 2.50 x 1.25 | 392 | `(0, 2.50, 0)` | `socket_hatch (0.50, 1.15, 0)` |
| `LiquidTankSmall` | liquid tank, small | 1.25 x 2.00 x 1.25 | 288 | `(0, 2.00, 0)` | |
| `LiquidTankSmallLong` | liquid tank, small long | 1.25 x 4.00 x 1.25 | 348 | `(0, 4.00, 0)` | |
| `LiquidEngineSmall` | liquid engine, small | 1.25 x 1.60 x 1.25 | 512 | `(0, 1.60, 0)` | `socket_muzzle (0,0,0)`; **no bottom** |
| `EngineVacuumSmall` | vacuum engine (`vessel.h` 0x0104) | 1.25 x 1.00 x 1.25 | see below | `(0, 1.00, 0)` | `socket_muzzle (0,0,0)`; **no bottom** |
| `StackDecouplerSmall` | stack decoupler | 1.25 x 0.25 x 1.25 | 312 | `(0, 0.25, 0)` | |
| `NoseCone` | nose cone | 1.25 x 1.20 x 1.25 | 360 | **none** | |
| `Parachute` | parachute | 1.25 x 0.75 x 1.25 | 288 | `(0, 0.75, 0)` | `socket_chute (0, 0.75, 0)` |
| `CargoBay` | (extra) | 1.25 x 1.60 x 1.25 | 284 | `(0, 1.60, 0)` | |
| `SolidBooster` | solid booster | 1.25 x 6.00 x 1.25 | 428 | `(0, 6.00, 0)` | `socket_muzzle (0,0,0)`, `socket_radial_attach (-0.625, 3.00, 0)`; **no bottom** |
| `MonopropTank` | monopropellant tank | 1.25 x 1.00 x 1.25 | 280 | `(0, 1.00, 0)` | |
| `ReactionWheel` | reaction wheel | 1.25 x 0.40 x 1.25 | 276 | `(0, 0.40, 0)` | |
| `Battery` | battery | 1.25 x 0.60 x 1.25 | 336 | `(0, 0.60, 0)` | |
| `DockingPort` | docking port | 1.25 x 0.30 x 1.25 | 304 | `(0, 0.30, 0)` | `socket_dock (0, 0.30, 0)` |

**Class L stack parts** (R 1.250, 24 segments).

| Part | DW-29 role | Dims | Tris | `socket_stack_top` | Other sockets |
|---|---|---|---|---|---|
| `LiquidTankLarge` | liquid tank, large | 2.50 x 4.00 x 2.50 | 556 | `(0, 4.00, 0)` | |
| `LiquidEngineLarge` | liquid engine, large | 2.50 x 2.60 x 2.50 | 544 | `(0, 2.60, 0)` | `socket_muzzle (0,0,0)`; **no bottom** |
| `StackDecouplerLarge` | stack decoupler | 2.50 x 0.35 x 2.50 | 488 | `(0, 0.35, 0)` | |
| `StackAdapter` | (added, see below) | 2.50 x 1.00 x 2.50 | 432 | `(0, 1.00, 0)` **class S** | bottom is **class L** |

**Radial parts** (`pivot: none`, origin on the mount plane, body extending +X).

| Part | DW-29 role | Dims | Tris | Sockets |
|---|---|---|---|---|
| `RadialDecoupler` | radial decoupler | 0.30 x 0.60 x 0.36 | 96 | `socket_radial_mount (0,0,0)`, `socket_radial_out (0.30, 0, 0)` |
| `EngineVernier` | (extra) | 0.36 x 0.43 x 0.28 | 96 | radial mount, `socket_muzzle (0.22, -0.30, 0)` |
| `Fin` | (extra, DW-30 aero) | 0.85 x 1.10 x 0.10 | 24 | radial mount |
| `RcsBlock` | RCS thruster block | 0.245 x 0.50 x 0.50 | 136 | radial mount |
| `LandingLeg` | landing legs | 0.20 x 0.42 x 0.34 yoke + 0.43 x 2.56 x 0.48 strut | 24 + 92 | radial mount, `socket_leg_foot (0.26, 2.42, 0)` |
| `SolarPanel` | solar panel | 0.18 x 0.30 x 0.44 mount + 0.065 x 1.26 x 0.56 array | 24 + 84 | radial mount |

**`EngineVacuumSmall` exists to be told apart from `LiquidEngineSmall`, and
that is its entire art brief.** A player choosing between a sea-level and a
vacuum engine is the point of shipping both, and physics measured the choice at
about 970 m/s of upper-stage delta-v, so the difference has to be legible in
silhouette from across the assembly view rather than in a tooltip. The
sea-level engine is a compact shrouded package with a 0.58 exit and a turbopump
box; the vacuum engine is shorter (1.00 m against 1.60), wider at the mouth
(0.615, as wide as class S allows) and has **no aerodynamic shrouding at all**,
so its thrust structure is an exposed open frame. It never flies through
atmosphere, so it has nothing to hide behind, and the real-world contrast is
free silhouette information.

**Part ids belong to `core/include/of/vessel.h`, not to this document.** The
binding between the two is the ASSET NAME: `PartDef::asset` names the glb nodes
in the tables above, and a ctest on the physics side asserts every stack part
measures exactly 1.25 or 2.50 m across, because 1.24 would mate visually and
leave a seam. **A silent dimension change here now breaks a test rather than
only a render**, which is the right way round.

**`StackAdapter` is an addition to the DW-29 list, and it is a consequence of
the list rather than an extension of it.** DW-29 asks for tanks and engines "in
two sizes"; the moment those two sizes are two DIAMETERS, a vessel with a wide
first stage and a narrow payload has no legal joint anywhere in the catalogue,
and the two classes are two separate games. One frustum fixes that, and it is
the only part in the file whose two ends differ. Flagged to Admin for
reconciliation with `core/include/of/vessel.h`.

**Lengths did not double with the class.** `StackDecouplerLarge` is 0.35 m and
not 0.50: a joint gets wider when the vessel does, it does not get taller. Only
diameters carry the class factor; heights are chosen per part. This is the same
rule the structural module follows in section 4.23, where the plan module
scaled x4 and the deck thickness did not move at all.

They land at 24 to 556 triangles against the "300 to 1400 each" this section
used to ask for. The budget is a ceiling, not a quota, and a tank genuinely is
a tube with three rings on it.

**LOD0 only, and that is a decision.** A vessel is either near you (you are
flying it, or standing next to it building it) or it is in the scaled far
scene, where it is an impostor and not a mesh at all. There is no middle band
for a rocket part to be in. `lander_landed.glb`, which IS a distant surface
landmark, carries the full chain.

**Collision is partial, on the Tier-1 precedent.** Ten proxies: every stack
part plus the leg and the fin, which are the parts that form the hull or touch
the ground. The vernier, the RCS block and the solar array carry none, because
a vessel colliding by its RCS nozzle is not a collision anybody wants resolved.

#### The two deploy clips

| Clip | Object | Frames | Motion |
|---|---|---|---|
| `Leg_Deploy` | `leg_pivot` | 1 to 41 | rotate +145 degrees about Y (keyed in two steps), and settle 30 mm in Z |
| `Solar_Deploy` | `solar_pivot` | 1 to 61 | rotate +90 degrees about Y, and lift 60 mm |

Both are **authored stowed**, because the exported static pose is frame 1
(section 2.7) and a vessel flies stowed. Both drive two channels of one object
through `add_clip_multi`, so each stays one Action and therefore one clip.
Stowing is the same clip at a negative `timeScale`.

Two details that are easy to get backwards and impossible to see in a static
render:

- **The solar cells face INBOARD when stowed.** The deploy maps local -X onto
  world +Z, so cells authored on the outboard face present their *back* to the
  star once deployed. Stowing them face-in is also what a real panel does.
- **The foot pad is authored pre-rotated by -145 degrees**, so that after the
  deploy it is exactly horizontal and lands flat. `socket_leg_foot` is
  pre-composed the same way and hangs **under** the pivot, so it rides the
  clip: physics reads the contact point off the animation instead of owning a
  copy of the deploy kinematics.

**The landing leg has to out-reach the engine bell.** The first version folded
1.34 m of strut and dropped its foot 0.98 m below the hinge, and the landed
lander is what proved that useless: a 1.60 m engine hangs below the tank the
legs mount on, so anything under about 2.1 m of drop puts the bell through the
ground before the feet touch. The shipped leg is 2.42 m of strut through 145
degrees: 2.13 m down, 1.18 m out.

#### `rocket/launch_pad.glb`

A **placed structure**, so section 2.2 applies exactly as it does to a smelter:
an **8 x 8 m whole-metre footprint**, pivot at the footprint centre, base on
`y = 0`, nothing overhanging. 8 is even, so it snaps to a cell **corner**.
12.00 m tall at the tower crown. 572 tris LOD0, full LOD chain.

Deck at 0.40 m, built as four concrete slabs around a 2.4 m square flame
opening with a deflector cone entirely below the deck top. Tower at
`(-3.2, +3.2)` in Blender, a four-leg lattice with ties every 2 m, a lift
shaft, an umbilical swing arm at 8 m reaching to 1.35 m from the stack axis,
and a state beacon at the crown on the standard four-colour `OF_EmissiveState`.

`socket_vessel` is at `(0, 1.60, 0)`: the vessel mates **1.20 m above the
deck**, held there by the clamps so the engine bell fires into the flame
opening rather than onto the concrete. Place a vessel by putting its
`socket_stack_bottom` on that point, which is the same rule the parts publish.

`LaunchClamp` is a **separate ground-pivoted part on the file origin**,
following the Tier-1 atlas convention: the renderer clones the one mesh and
places three of them at 120 degree intervals on the circle `socket_clamp`
marks (radius 1.25 m on the deck top), each rotated to face the axis. Its arm
reaches exactly to 0.63 m from the axis, touching a 1.25 m hull.
`Clamp_Release` (frames 1 to 25) swings the arm 70 degrees up and back and is
**authored holding**, because a pad at rest is a pad holding a rocket.

**Thirteen proxies, not one.** Five are the structure: `col_LaunchPad` and
`col_LaunchTrench` are the two deck BANKS either side of the flame trench,
`col_LaunchMount` is the launch table that legitimately spans it,
`col_LaunchTower` is the mast and `col_LaunchClamp` is the clamp template the
client fans out. A single convex box cannot describe a slab with a hole down
the middle and a 28 m mast on one side, and a box spanning the trench would be
a player walking on air over a 1.70 m drop.

The other eight are `col_LaunchStep1` to `col_LaunchStep8`, **one per stair
tread**, and they are the 2026-07-27 fix for Reid's "the stairs on the launch
pad dont work". The notch in the north-east corner was drawn and never proxied,
so the only route onto the deck on foot had nothing under it: a driven walk
(`probes/padstair.js`) gained **0.000 m** and wedged against the 2.00 m south
face of `col_LaunchTrench`. It now gains **2.000 m** onto the deck in 1.2 s.
A tread proxy is a box and not a ramp because the client's structural proxies
are axis-aligned boxes in the part's own frame (`game/StructureBody.ts`), and
there are eight rather than four because they are generated from the same
`stair_treads()` the drawn geometry is, so the surface you stand on is the
surface you can see. 156 collision triangles, budget 160; none reach a pixel.

The declared set in `contracts.json` and the set a `.glb` actually ships are
now checked against each other **in both directions** by
`web/scripts/check-proxies.mjs` (`npm run check:proxies`, and part of
`npm run check`). `validate_glb.py` only ever reported names that were declared
and absent, which is why `col_LaunchMount` shipped undeclared for as long as it
did and why nothing at all noticed the stairs.

#### `rocket/lander_landed.glb`

The Cinder outpost beat (`ObjectiveStep::OutpostComplete`). **6.40 m tall,
4.08 m across the feet**, 2040 tris LOD0 with a full LOD chain, because unlike
a part this is what a player navigates back to from 200 m away.

**It is assembled from the shipped parts, not modelled again.** Every piece
comes out of `rocket_common` through `hc.Parts.rotate/translate`, with the legs
and panels in the pose their deploy clips end in, so the landmark and the
flyable vessel cannot drift apart. That is why `rocket_common` exposes
`LEG_DEPLOY_DEG` and `leg_foot_offset()` rather than hiding them in the clip.

    EngineMain  z 0.30 .. 1.90     bell 0.30 m clear of the ground
    TankSmall   z 1.90 .. 3.90     four legs hinged 0.30 m up its side
    CommandPod  z 3.90 .. 6.40     hatch on +X, ladder to the ground

Every height is derived from the leg: the foot lands 2.13 m below its hinge, so
the hinge is at 2.20 m and the rest follows. Four legs at 0/90/180/270, two
solar panels at 45/225 so the panels tuck inside the leg span. A ladder from
the hatch to the ground is the one piece that is not a rocket part: a 6.4 m
vessel with no way down reads as scenery rather than as the thing the player
climbed out of.

**All three LODs sit on exactly the same ground plane.** The simplified leg
stops 60 mm short of the foot centre so its end-face *corner* cannot dip below
the pad, because a LOD switch that sinks the lander two centimetres is visible
from the hatch. The proxy is the **core stack**, not the leg span: a convex box
over 4 m of mostly air is a wall the player cannot walk under, which is the
opposite of what a lander on legs should feel like. Same rule as the Tier-1
dead tree, whose proxy is its trunk.

#### `rocket/vfx_engine_plume.glb`

**Geometry only; the shader is the rendering domain's.** The whole point of the
file is the handoff, so every assumption behind it is stated:

| Assumption | Value |
|---|---|
| Size | a **unit** plume: 1.00 m across the **mouth**, 1.00 m long, filling the unit box exactly |
| Direction | down three.js **+Z**, which is what a socket's facing is, so `socket_muzzle.add(plume)` at **identity** aims it and no per-engine rotation exists |
| Scaling | `plume.scale.set(exitDiameter, exitDiameter, plumeLength)`. The mouth is the widest ring, so a plume scaled by the nozzle's exit diameter meets the bell lip with no seam |
| Origin | the **mouth**, so `pivot_mode: "none"` and throttle is a scale on Z alone |
| U | wraps 0..1 around the plume, seam on +X, with a duplicated seam column so no shader has to `fract()` around it |
| V | **0 at the mouth, 1 at the tip, linear in LENGTH** rather than in radius, so scrolling noise travels at constant speed and a `mix(hot, cool, v)` gradient is the right shape |
| Material | one slot, `OF_EmissiveState` (near-black base, white emission), expected to be **replaced** by an additive `ShaderMaterial`: `blending: Additive`, `depthWrite: false`, and `side: DoubleSide` if the camera can fly through the plume |
| Culling | authored **backface-culled**, because `of_lib.DOUBLE_SIDED` is palette-wide and adding `EmissiveState` to it would quietly double-side the state chip on all thirteen machines |
| Normals | smooth, so a lit fallback reads as a cone rather than a faceted funnel. An additive shader ignores them |
| Not authored | shock diamonds and the vacuum flare. Both are a function of ambient pressure, which the shader knows and a static mesh does not |

**This is the first and only asset in the game with UVs**, and section 2.8's
texture threshold is still unmet: it has UVs because a plume with no length
parameter cannot be shaded, not because it has a texture. `MeshBuilder` takes
an optional per-vertex `uvs` list and creates a UV layer **only** when one is
supplied, so the other 41 files still export with no `TEXCOORD_0` at all.

**The V axis is authored flipped.** glTF's texture origin is the top left and
Blender's is the bottom left, so the exporter writes `1 - v` for every UV it
touches. The flip is applied in the builder so the **shipped** file reads the
way this table says, and it was confirmed by reading `TEXCOORD_0` back out of
the `.glb` rather than by trusting the exporter.

#### `world/body_sphere_lod.glb`

A **unit icosphere** at three subdivision levels: 1280 / 320 / 80 triangles,
one material, one mesh for every body.

**Radius comes from `BodyParams`, never from the mesh.** The sphere is authored
at radius 1.0 and the renderer scales by `radiusM` (Forge 600 km, Cinder
200 km, `orbital.h`'s `kForgeRadiusM` / `kCinderRadiusM`), so its declared
dimensions are `[2, 2, 2]` by definition. `pivot_mode: "centre"`: a body is
positioned by its centre, not stood on the ground.

**Icosphere, not UV sphere.** A UV sphere puts half its vertices in a pinch at
each pole and stretches its quads to nothing there, which on a planet is
exactly where a polar orbit flies over. A geodesic sphere has no poles.

**The mesh is inscribed, not circumscribed.** Every vertex is exactly on radius
1.0, so every face sags below it: **0.45% at LOD0, 1.78% at LOD1, 6.58% at
LOD2**. On Forge that is 2.7 km at LOD0, at a distance where the body is
already hundreds of kilometres away. A renderer that needs the horizon exact
(a horizon-clipped atmosphere shell, say) scales by `radiusM * (1 + sag)`.

The build prints that sag, and it earned its keep immediately: the first build
read **16%** at LOD0, which is the signature of a face table applied to the
wrong arrangement of the twelve icosahedron vertices. That mistake still builds
twenty triangles, still exports and still passes every check in section 7; it
is a folded tangle, and nothing else in the pipeline would have caught it.

---

## 4. Tier 0 per-asset specs

Everything below is precise enough to build without asking a follow-up question.
Dimensions are Blender axes (`X` width, `Y` depth with **-Y forward**, `Z` up),
metres. All clips are 60 fps, frame 1 inclusive.

### 4.1 Player body, `player/player_body.glb`

**Dimensions.** 1.80 m tall in T-pose. Arm span 1.80 m, shoulder width 0.46 m,
shoulder height 1.45 m, hip height 0.95 m, eye height 1.65 m, head 0.24 m tall,
foot 0.28 m long. Origin at the point between the feet, on the ground.

**Silhouette.** A bulky EVA-lite work suit, not a spacesuit and not a soldier. Broad
squared chest pack, a cylindrical helmet ring with a wide horizontal visor band,
oversized gloves and boots, tapered legs. The read at 50 m is "engineer": wide on top,
narrow at the ankle, one bright accent stripe running shoulder to hip.

**Key shapes.** Helmet as a chamfered cylinder with a `Glass` visor band; chest pack
as a box with two recessed vents; shoulder pads as bevelled wedges; gloves and boots
as chunky boxes with a single chamfer; a hip tool loop on the right that the stowed
pickaxe hangs from.

**Poly budget.** LOD0 3500, LOD1 1600, LOD2 500. LOD1 and LOD2 by decimation
(`add_lod_decimate` at 0.45 and 0.14), which is appropriate here because the form is
organic.

**Materials (6).** `OF_Suit` body, `OF_SuitAccent` stripe and shoulder pads,
`OF_SteelDark` helmet ring, joints, boot soles, `OF_Glass` visor, `OF_Skin` chin and
neck, `OF_EmissiveState` helmet lamp and a chest indicator (drives the player's own
power/oxygen readout, same four-colour scheme).

**Rig.** 44 bones, structurally identical to the Mixamo skeleton (same hierarchy,
same T-pose rest) so any CC0 Mixamo clip retargets with a rename map, but with clean
unprefixed names.

```
Root
`- Hips
   |- Spine -> Spine1 -> Spine2
   |  |- Neck -> Head -> HeadTop_End
   |  |- LeftShoulder  -> LeftArm  -> LeftForeArm  -> LeftHand
   |  |     `- LeftHandThumb1..3, LeftHandIndex1..3, LeftHandMiddle1..3
   |  `- RightShoulder -> RightArm -> RightForeArm -> RightHand
   |        `- RightHandThumb1..3, RightHandIndex1..3, RightHandMiddle1..3
   |- LeftUpLeg  -> LeftLeg  -> LeftFoot  -> LeftToeBase  -> LeftToe_End
   `- RightUpLeg -> RightLeg -> RightFoot -> RightToeBase -> RightToe_End
```

Three finger chains per hand, not five: thumb, index, and one merged middle block.
That is enough to sell a tool grip and saves 12 bones. Maximum 4 weights per vertex.

**Sockets** (bone-parented empties): `socket_hand_R` (right palm, oriented so a tool's
own origin mates with identity transform), `socket_hand_L`, `socket_back` (on `Spine2`,
stowed tool), `socket_hip_R` (tool loop), `socket_head_cam` (eye point at 1.65 m, the
first-person camera anchor), `socket_lamp` (helmet lamp).

**Collision.** `col_Player`, box 0.70 x 0.50 x 1.80. The real character controller uses
a code-generated capsule (radius 0.35, height 1.80); the box is a broadphase fallback.

**Clips (14).**

| Clip | Frames | Loop | Notes |
|---|---|---|---|
| `Idle` | 1 to 121 | yes | 2 s breathing cycle |
| `Walk` | 1 to 33 | yes | 1.4 m/s, 0.747 m per cycle |
| `Run` | 1 to 25 | yes | 4.5 m/s, **1.80 m per cycle** (was written as 1.35, wrong, see below) |
| `Jump_Start` | 1 to 13 | no | crouch and launch |
| `Jump_Loop` | 1 to 21 | yes | airborne |
| `Jump_Land` | 1 to 17 | no | absorb |
| `Fall` | 1 to 21 | yes | long fall, arms out |
| `Swing_Pickaxe` | 1 to 33 | no | impact authored frame 17 = **runtime tick 16**, 0.2667 s |
| `Swing_Axe` | 1 to 35 | no | impact authored frame 18 = **runtime tick 17**, 0.2833 s |
| `Dig` | 1 to 31 | no | voxel mining, impact authored frame 16 = **runtime tick 15**, 0.2500 s |
| `Place` | 1 to 25 | no | build placement |
| `Craft` | 1 to 61 | yes | hand-craft loop |
| `Crouch_Idle` | 1 to 91 | yes | |
| `Crouch_Walk` | 1 to 37 | yes | 0.7 m/s |

Impact frames are contract: gameplay fires `harvestNode()` on those frames, so moving
one desynchronises feel from logic.

**Authored frame vs runtime tick (DW-34, 2026-07-27).** Clips are authored 1-based:
frame 1 is the first frame, and the table above is written that way. Authored frame 1
is exported at **t = 0 s** (`of_lib.clip_frame`), so the tick a client counts from the
start of the clip is `authored - 1`, and an `n`-frame clip has a duration of
`(n - 1)/60` s. Before DW-34 the first key was written at t = 1/60 and the tick index
happened to equal the authored frame; the exported clips no longer do that, and
`validate_glb.py` now asserts that the first animation sampler input of every clip in
every file is exactly `0.0`.

**Corrected 2026-07-27 (the run stride was wrong, and the convention was never
stated).** A cycle keyed from frame 1 to frame `n` has frame `n` EQUAL to frame
1, because `rig_common.keys` samples `fn(i/samples)` and every periodic term
returns the same value at 0 and 1. So the period is `n - 1` intervals, not `n`,
and since DW-34 that is also the duration three.js computes, since it comes from
the track times. (It was not, before DW-34: the first key sat at t = 1/60, so
the duration read `n/60` and every cycle carried one dead frame. `Run` was
0.4167 s of clip over 0.400 s of motion, a 7.5 cm snap per cycle at 4.5 m/s.)
Therefore:

| Clip | Frames | Period | Authored speed | Ground travel per CYCLE | per STEP |
|---|---|---|---|---|---|
| `Walk` | 1 to 33 | 32/60 = 0.5333 s | 1.4 m/s | 0.747 m | 0.373 m |
| `Run` | 1 to 25 | 24/60 = 0.4000 s | 4.5 m/s | 1.800 m | 0.900 m |

The "stride" column above used to read 0.75 and 1.35. The walk figure was right
and was a per-cycle distance; the run figure was not, on either convention.
1.35 is what an 18-frame period gives, so it looks like it was written before
the clip settled at 25 frames and was never re-derived. **The numbers that
matter are per STEP**, because that is what a foot plant has to travel, and they
are 0.373 m and 0.900 m.

**And the clip that matters is `Run`, not `Walk`.** `web/src/player/Controller.ts:33`
is `walkMps = 4.6` and `web/src/player/AnimGraph.ts:44` is
`RUN_THRESHOLD_MPS = 3.0`, so the player is above the run threshold at all times
while moving and `Walk` is only reachable in the 0.15 to 3.0 m/s band that
nothing but deceleration produces. `Run` plays at timeScale 4.6/4.5 = 1.02, i.e.
essentially as authored. Sprint is `walkMps * 2 = 9.2` m/s, timeScale 2.04.

**Corrected 2026-07-25 (dimensions).** The manifest row says 0.60 x 0.40 x 1.80.
That is the standing **footprint**, and it is carried by `col_Player`
(0.70 x 0.50 x 1.80), not by the mesh: a T-pose with a 1.80 m arm span has a
1.80 m wide bounding box by definition. The contract declares the measured
T-pose AABB, `[1.80, 1.80, 0.39]` in three.js axes, with
`pivot_tolerance_m: 0.03`. The feet sit exactly on `y = 0` and the mesh is
exactly centred on X; the 25 mm of forward bias in depth is the chest pack and
the boots, and a character's depth centroid is not its ground pivot.

**How it is skinned (DW-7, answered 2026-07-25).** Blender's bone-heat
automatic weights are attempted first, inside `build_player_body.py`, and they
**fail**: they return without raising and leave 144 of 698 vertices with no
weight at all. That is the worst possible failure mode, because an unweighted
vertex is pinned to joint 0 forever, the file still exports, and it still
passes every geometric check; it shows up only as shards of mesh left behind
when the character moves. Bone heat solves a Laplacian over a closed manifold
surface, and this character, like every asset in this game, is a pile of
intersecting tubes and boxes.

The shipped weights are scripted: `of_lib.solve_weights` takes the distance
from each vertex to each bone SEGMENT, inside a per-part bone whitelist set by
`MeshBuilder.bind`, with a fourth-power falloff and at most 4 influences. The
whitelist is what makes it work, and it is something automatic weights cannot
express: an arm tube considers only that arm's chain, so the elbow gets a real
50/50 blend while the left thigh is structurally incapable of picking up weight
from the right one. Limbs are authored as tubes with a ring exactly on each
joint, which is where that blend lands. **This is not the `.blend` escalation
DW-7 permits**: the pipeline stays fully script-authored, deterministic and
diffable, and `assets/models/src/` stays empty.

**Why the exported pose is the bind pose.** Section 2.7's frame-1 identity rule
cannot apply literally to a rig, because a walk cycle's frame 1 is mid-stride.
The rigged form of the same rule is `export_rest_position_armature`: joints
export at bind and every clip is relative to it. `validate_glb.py`'s
`rest_pose` check proves it by multiplying each joint's world matrix by its own
inverse bind matrix and demanding the identity (measured 2.7e-07).

**Built.** LOD0 1228 tris against the 3500 budget, LOD1 536, LOD2 166,
1912 render tris, 6 materials, 44 joints, 14 clips, 581 KB. The file is
dominated by animation: 14 clips x 44 bones x 3 paths is 1,848 channels, and
their accessor metadata is about 340 KB of JSON against 240 KB of actual
sampled data. Dropping the channels that do not move would cut it by roughly
40%, and it is deliberately **not** done: a clip that omits a bone leaves that
bone wherever the previous clip left it, which is how a character ends up
walking with its arms still in a swing. Self-contained clips are worth the
bytes, and the right lever for the size is the meshopt bundle-time post-pass
already described in section 6.3.

Visual check (`tools/blender/render_check.py`, renders in
`docs/screenshots/T0_player_*.png`): T-pose clean, walk contact and knee bend
correct, no shearing at any joint, no detached geometry, hands read as gloves
with a thumb and two finger blocks.

**Rebuilt 2026-07-27 (W11 lane A). LOD0 1244 -> 2320 tris, 3688 render tris,
694,816 bytes, 8 of 9 materials, envelope `[1.7981, 1.8000, 0.4577]` against
`[1.80, 1.80, 0.46] +/-0.005`, weight sum 1.0000 to 1.0000 over 1298 vertices.**
Bone-heat auto weights are still attempted first and still fail honestly,
now at 360 of 1298 vertices unweighted. What changed and why:

- **Hands**, the same fix as the view model (see 4.2) and it pays twice: an
  elliptical palm, a proud `OF_Plate` knuckle plate, four separate finger tubes
  plus a thumb, and a smaller wrist cuff. The old one was so fat it ate the palm.
- **Boots split** into a heel block on `Foot` and a toe block on `ToeBase` with
  overlapping soles, so the foot can actually roll.
- **A real back pack**, which is what the Z envelope went 0.39 to 0.46 for:
  `OF_Plate` body, `OF_SuitDark` lid, two proud tanks setting the rearmost point
  at exactly y = +0.240, and shoulder straps.
- **Colour separation that survives 20 m**: the chest pack went `OF_Suit` to
  `OF_Plate`, because a white pack on a white torso is invisible; plus an
  `OF_SuitDark` belt, flank panels and shins, and a `OF_Plate` knee band.
- **Thicker upper arms**, 0.078 to 0.088 at the shoulder, with the shoulder pads
  resized to sit on them and the elbow band raised 0.068 to 0.076 to keep its
  inradius clear of the arm (section 7.4).

**One failure worth recording, because it is DW-7 exactly.** The first pass hung
flat `OF_Plate` boxes on the thigh and shin for contrast. They **sheared clean
off the leg in `Walk` and `Run`**: a rigid box whitelisted across a joint gets a
50/50 distance blend down its middle and is torn in half. It validated clean and
only a render in motion showed it. Replaced with coaxial tube segments, which
take the same weights the limb does.

**The gait is now solved from an authored ankle path (`rig_common.leg_ik`), not
sampled from sines**, because a pure sine has no foot plant. Three separate
defects were found by MEASURING the shipped file rather than by looking at it,
and all three had survived every previous render:

1. **The lean was keyed on `Hips`, which `UpLeg` inherits.** An 11 degree run
   lean therefore put the whole leg 11 degrees further back than the IK asked and
   pitched the sole toe-down, **driving the toe 30 mm through the ground**. The
   lean moved to the spine chain, above the legs.
2. **`rig_common.keys` rounds the frame but not the sampled parameter.** At 16
   samples over 25 frames the key for phase 0.0625 was written to frame 3, which
   is phase 0.0833. Contact-phase foot velocity swung between 1.7 and 6.6 m/s
   around a 4.5 target. Gait clips now key one sample per frame.
3. **Pelvis yaw moves the hip socket.** The `UpLeg` head is 0.10 m off the
   midline, so +/-5 degrees of yaw carries it +/-8.7 mm fore and aft: a **2.3%
   skate that survived everything else because the foot path was right and the
   HIP was moving.** Now compensated.

Ankle height during contact is no longer authored, it is **solved** from the
sole roll, so whatever the heel-strike to toe-off angle, the lowest sole point
is exactly on z = 0. Measured on the shipped bytes: contact-phase net world slip
**+0.0005 m** over 0.5250 m of root travel, implied ground speed **4.496 m/s
against 4.50 authored**, worst single-frame slip 0.9 mm, **ground penetration
0.0000 m** (was -0.0296 m). Both legs measure identically. `ToeBase` is keyed in
every locomotion clip; it was keyed in **zero** of them before.

**On the 0.900 m step, stated honestly.** 0.900 m is ROOT travel and it is
exact. The foot only covers 0.576 m of it on the ground; the rest is the flight
phase, and it cannot be otherwise. Hip to ankle is 0.820 m, and with the sole
flat the reach is about 0.28 m forward at heel strike and 0.36 m back at
toe-off, so **about 0.64 m is the geometric ceiling for one ground contact** and
a 0.900 m step at this leg length REQUIRES a flight phase. The no-skate
criterion is not "the foot travels a step", it is "contact-phase foot velocity
equals ground speed", and that is met to 0.06 m/s.

### 4.2 First-person arms, `player/player_fp_arms.glb`

Right and left arm from shoulder to fingertip plus a shallow chest stub, proportioned
to fill the lower third of a 70 degree vertical FOV at 0.35 m from the camera. Bounds
about 0.90 x 0.70 x 0.55 m. Origin at the camera point, so the model attaches to the
camera with an identity transform.

1200 tris, no LOD chain (first-person is always near). Materials: `OF_Suit`,
`OF_SuitAccent`, `OF_SteelDark`, `OF_Skin`. Bones: the arm subset of the body rig with
**identical names** (`LeftShoulder` through `RightHandMiddle3`) plus `Root`, 27 bones,
so body and first-person clips are authored against the same skeleton.

Sockets: `socket_hand_R`, `socket_hand_L`.

Clips (8): `FP_Idle` 1 to 121, `FP_Walk_Bob` 1 to 33, `FP_Run_Bob` 1 to 25,
`FP_Swing_Pickaxe` 1 to 33 (impact authored 17, runtime tick 16), `FP_Swing_Axe` 1 to
35 (authored 18, tick 17), `FP_Dig` 1 to 31 (authored 16, tick 15), `FP_Place` 1 to 25,
`FP_Craft` 1 to 61. Impact frames match the third-person clips exactly.

**Render note (rendering domain, recorded here because it constrains the model):** the
arms draw on their own camera layer with a 0.01 m near plane, so they never clip world
geometry and the model does not need to be artificially shortened.

**Corrected 2026-07-25 (bind pose).** The bone names and the hierarchy are the
body rig's arm subset **exactly**, which is the contract that lets one
animation layer drive both assets. The **bind pose is not shared**: this one is
the view-model rest, arms held forward into the lower third of the view, not
the T-pose. Three reasons. The declared bounds are the posed bounds, and a
T-posed arm subset is 1.80 m wide, not 0.90. A view model is never retargeted
from Mixamo, so a T-pose rest buys nothing here. And weights authored in the
pose the model will actually be seen in are better weights. The FP clip set is
self-contained, so no clip is ever played on both skeletons; the impact frames
still match the third-person clips exactly, because those are a gameplay
contract rather than an animation preference.

**Every part overlaps the joint it crosses.** A part that starts exactly on its
bone's head swings away from its neighbour the moment that bone rotates and
opens a visible crack. On a machine that is invisible; at 0.35 m it is the
first thing the player sees. So the skin band runs past the wrist into the
palm, the glove starts behind the wrist, and every finger starts half a segment
inside the hand. This was found by the visual check, not by the validator.

**The hands must stay in frame.** The camera is bolted to the eye, so the pose
amplitudes that read as powerful on the third-person body render as an empty
screen here: a 54 degree drive at the impact frame put both hands below the
bottom edge. The travel belongs to the tool, which is held at `socket_hand_*`
and sweeps well ahead of the hands. Final values are a 13 degree windup and a
14 degree drive, verified frame by frame through a camera on the asset origin
with a 24 mm lens (`render_check.py`'s `eye` view).

**Built.** 964 tris against the 1200 budget, 4 materials, 27 joints, 8 clips,
220 KB. Measured bounds `[0.900, 0.550, 0.710]` in three.js axes against the
"about 0.90 x 0.70 x 0.55" the section asks for. `pivot_mode: "none"`: the
origin is the camera point and is deliberately outside the mesh.

#### 4.2.1 Rebuilt 2026-07-27: the mitts, and the three causes behind them

Reid, on the shipped build: the on-screen hands "read as large white mitts".
This is the most visible asset in the game, on screen every frame, and it was
the worst one. **1740 tris against a raised 2600 budget, 12 clips, 366,796
bytes, envelope `[0.8552, 0.5762, 0.9268]` against `[0.86, 0.58, 0.92]
+/-0.02`, weight sum 1.0000 to 1.0000 over 924 vertices.**

**The diagnosis came from tiling the eight before-renders into one sheet
(section 7.7), and no single render says it: the model was ONE UNBROKEN WHITE
SHAPE.** Every piece of colour separation the asset already had, the
`OF_SteelDark` elbow band, the `OF_SuitAccent` deltoid, the `OF_Skin` wrist
band, was UP THE SLEEVE and therefore out of frame. From the eye point the
entire model was `OF_Suit` `D8D3C6`. Three independent causes, fixed in this
order:

1. **Colour has to be where the camera can see it**, not up the sleeve: an
   `OF_SuitDark` glove, an `OF_SuitAccent` cuff ring at the wrist where the eye
   lands, a wider bare `OF_Skin` band, an `OF_Plate` knuckle plate and forearm
   brace.
2. **The hand was a round tube with three round prongs on the end.** A circular
   cross section cannot read as a palm from any angle; a real palm is roughly
   2:1 in section. Now an **elliptical** palm (`rig_common.oval_tube`) widening
   to a knuckle line then stepping down, with **five** finger tubes carried on
   the three frozen bone chains (the `Middle` chain carries middle, ring and
   little as three offset tubes, so this costs **zero extra bones**), fingers
   that curl segment by segment, and a thumb springing from the side of the palm
   well back of the knuckles on a genuinely different axis.
3. **Framing.** The hand moved from `(+/-0.156, -0.220, +0.435)` to
   `(+/-0.200, -0.302, +0.620)` and the elbow in from +/-0.388 to +/-0.367, with
   a thinner forearm. Visible frame height at the hand went **0.61 m to 0.87 m**,
   so the same glove is about 30% smaller on screen before any geometry change.

**Four new clips**: `FP_Jump_Start` (13f), `FP_Jump_Loop` (21f), `FP_Jump_Land`
(17f), `FP_Fall` (21f). All twelve clips now state a finger pose, so the
client's 0.15 s crossfade cannot pop a finger.

**The frame-1 rule got a measured form.** The first pass produced two EMPTY
frames (`FP_Jump_Land` frame 5 and a near-empty `FP_Swing_Pickaxe` frame 8),
which is the failure this section already had a scar from. The culprit was not
the raise, it was **`twist`**: an 18 degree Z rotation at the shoulder swings the
hand 0.20 m sideways and off the SIDE of a 60.5 degree horizontal frame. Twists
were cut to 4, 7 and 2 degrees, raises and drives roughly halved, and the travel
moved into `Root`. Then "no empty frame" stopped being a thing you notice and
became a thing you measure: a scratch script rebuilds `render_check.py`'s `eye`
camera and projects every vertex of every frame of every clip. **Worst case
across all twelve clips is `FP_Swing_Axe` frame 8 at 72.5% of the visible
geometry on screen**, against a rest baseline of about 86%.

**`socket_hand_R` moved and the tool was checked, not assumed:**
`(-0.1560, -0.2200, +0.4350)` to `(-0.2000, -0.3340, +0.6300)`, deliberately
32 mm below the hand bone tail and 10 mm forward, INTO the fist, because at the
tail the haft rides across the top of the knuckle plate. Verified by rendering
the real `crude_pickaxe.glb` parented to the socket with the client's
`FP_CARRY_TILT` applied. **The body's six sockets are bit-identical to the
previous build**, including `socket_head_cam` at `(0, 1.650, 0.060)`.

### 4.3 Crude pickaxe, `tools/crude_pickaxe.glb`

Haft 0.85 m along **+Z**, head 0.34 m wide across **X**, pick tip pointing **-Y**
(forward). **Origin at the grip point**, 0.30 m up the haft, so `hand.add(tool)` with
an identity transform puts it in the fist. This grip-point-origin rule applies to every
hand-held asset.

Silhouette: a lashed field tool, not a forged one. A slightly tapered branch haft, an
asymmetric iron head (long pick on one side, short adze on the other), and a visible
rawhide binding at the joint. It must read as *crude* next to the machines.

260 tris. Materials: `OF_Bark` haft, `OF_Iron` head, `OF_Accent` binding.
Sockets: `socket_grip` (at the origin, for validation), `socket_head` (pick tip, the
impact point). No clips: the animation lives on the player.
Collision: `col_CrudePickaxe`, box 0.34 x 0.10 x 0.95, `OF_Iron` role so the
proxy does not drag a fourth material into a three-material file.

The grip-point origin is not merely validated by `socket_grip`, it is validated
*as* `socket_grip`: `pivot_mode: "grip"` (section 7.1) asserts the socket lands
on the origin **and** that the origin is inside the mesh bounds. Those two facts
together are what make `hand.add(tool)` correct rather than coincidental.

**Built.** LOD0 126 tris, LOD1 48, 186 render tris. Exact bounds 0.340 x 0.100 x
0.950 by construction, no `fit()` pass: at this size every vertex is placed by
hand, and exactness is what puts the grip on the origin to the micrometre.

### 4.4 Crude axe, `tools/crude_axe.glb`

Haft 0.72 m along **+Z**, blade 0.22 m across **X** facing **-Y**. Origin at the grip
point 0.24 m up the haft. Same construction language as the pickaxe: branch haft,
single wedge blade, rawhide binding.

240 tris. Materials: `OF_Bark`, `OF_Iron`, `OF_Accent`.
Sockets: `socket_grip`, `socket_head` (blade edge centre).
Collision: `col_CrudeAxe`, box 0.22 x 0.09 x 0.80, `OF_Iron` role.

The head is built as a single flared wedge: a narrow back face in the `+Y`
plane opening out to the full 0.22 m cutting edge at `-Y`, which is the literal
reading of "blade 0.22 across X facing -Y" and costs six quads.

**Built.** LOD0 96 tris, LOD1 24, 132 render tris. Exact bounds 0.220 x 0.090 x
0.800.

### 4.5 Ore boulders, `nodes/boulder_{stone,iron,copper,coal}.glb`

One base form, four material dressings. Pivot at the base centre of the mesh bounds,
`Z = 0`; boulders are world scatter and are not grid-snapped.

**Silhouette.** An angular multi-lobe rock: one dominant mass with two smaller lobes
crowding it, 5 to 7 large flat facets, no small detail. Facets are the whole design,
because flat facets catch directional light and give the rock a readable form at
distance where a noisy sculpt turns to mush.

**Ore read.** The ore is not a texture. Three to five facets are split out as separate
faces assigned the ore material, so raw metal catches specular highlights while the
host rock stays matte. From 30 m an iron boulder reads as a rock with bright chips in
it; a stone boulder reads as uniformly matte. That contrast is the whole gameplay
signal.

| File | Dims (m) | Ore material | Tris |
|---|---|---|---|
| `boulder_stone.glb` | 1.4 x 1.2 x 0.9 | none (Rock + RockDark only) | 460 |
| `boulder_iron.glb` | 1.6 x 1.4 x 1.1 | `OF_IronOre` | 290 |
| `boulder_copper.glb` | 1.5 x 1.3 x 1.0 | `OF_CopperOre` | 570 |
| `boulder_coal.glb` | 1.7 x 1.4 x 1.0 | `OF_CoalSeam` | 420 |
| `rock_spire.glb` | 1.3 x 1.15 x 2.6 | none (Rock + RockDark only) | 690 |

**The budgets above were raised at RN-243 and the ore material names were
already wrong.** They read `OF_Iron` / `OF_Copper` / `OF_Coal`, the refined
ITEM metals; RN-156 split the seams onto the ore-in-rock roles `OF_IronOre`,
`OF_CopperOre` and `OF_CoalSeam` because the item rows are metallic 1.0 and an
iron seam photographed as ice. The old 200 to 240 ceilings were sized for a
low-poly game; see `docs/web/ART-DIRECTION.md` and the argument recorded in
each `contracts.json` row.

LODs: 100% / 45% / 15% by `add_lod_decimate` (organic, so decimation is correct).
Materials (3): `OF_Rock`, `OF_RockDark`, plus the ore role. **Stone carries only
two**, because "no ore" is its identity: its split-out facets are `OF_RockDark`
on an `OF_Rock` body, so it reads uniformly matte next to the specular ores.
Coal inverts the pair (dark host, `OF_Coal` facets).
Sockets: `socket_hit` (the largest facet centre, where impact VFX plays),
`socket_item_pop` (top centre, where harvested chunks spawn).
Collision: `col_Boulder<Kind>`, one box at the mesh bounds.
Depletion variants: `<Name>_Full` / `_Half` / `_Low`, each with its own LOD chain
(section 2.7). **Corrected 2026-07-25:** height alone was not a strong enough
read, so the variants drop lobe *count* as well as volume, at bounding-box
scales of `1.00` / `0.86 x 0.86 x 0.70` / `0.66 x 0.66 x 0.40` with 3 / 2 / 1
lobes. Ore facets stay proportional so the mineral is still identifiable when
the boulder is nearly spent. No clips.

**Built.** LOD0 164 tris (budget 200 to 240), 586 render tris per file.

### 4.6 Conifer tree, `nodes/tree_conifer.glb`

6.5 m tall, canopy 2.4 m across. Trunk: a tapered 8-sided cylinder, radius 0.18 at the
base to 0.10 at 5.0 m. Canopy: three stacked 8-sided cones (radii 1.2, 0.95, 0.6 at
heights 2.2, 3.6, 4.8), each slightly rotated so the silhouette is not radially
symmetric. Origin at the trunk base centre.

600 tris LOD0, 260 LOD1, 70 LOD2 (LOD2 is two crossed quads plus a trunk box).
Materials (3): `OF_Bark`, `OF_Leaf`, `OF_LeafDry`. **Corrected 2026-07-25:** the
spec said two. The third role is what lets depletion read by colour as well as
by silhouette (needles go brown before they go away) and it gives the stump a
pale sapwood cut face; without it a `_Low` tree and a `_Full` tree are the same
green at 40 m.
Sockets: `socket_hit` (1.2 m up the trunk, chest height), `socket_fell_pivot` (base
centre), `socket_item_pop`.
Collision: `col_TreeConifer`, box 0.50 x 0.50 x 6.5 (trunk only; a player walks through
the canopy).

Clips: `Tree_Sway` 1 to 181, loop; `Tree_Fall` 1 to 45, one-shot, whole tree
rotates 88 degrees about `socket_fell_pivot` with a settle. **Corrected
2026-07-25:** the sway is one X cycle at plus or minus 1.5 degrees against two
Y cycles at plus or minus 0.9, not two quarter-phase-offset cycles. Both
channels must be **zero at frame 1** (section 2.7), and a quarter-phase Y curve
is not; the figure eight the double-frequency curve traces also reads better
than an ellipse.

Depletion variants (**corrected 2026-07-25**; this section said `Tree_Full` and
`Tree_Stump`, contradicting the four-variant rule in section 3.1):
`_Full` full skirt and three branch lobes; `_Half` skirt gone, tiers a third
narrower, upper tiers dry; `_Low` bare trunk with branch stubs and one dry crown
tuft; `_Stump` cut at 0.62 m with a sapwood face. Roughly 100 / 55 / 25 / 4
percent of volume.

**Built.** LOD0 308 tris, 1084 render tris across all twelve meshes.

### 4.7 Broadleaf tree, `nodes/tree_broadleaf.glb`

5.0 m tall, canopy 4.0 m across. Trunk splits at 2.0 m into **three** unequal
forks (**corrected 2026-07-25:** two forks made the canopy read as a symmetric
pair of balls; the third, shorter limb is what breaks it), each carrying a
faceted canopy blob squashed to 0.6 vertical. 700 / 300 / 80 tris. Same
materials, sockets, clips and depletion variants as the conifer. The silhouette
is deliberately the conifer's opposite (short, wide, forked) so the two tree
kinds are never confused at distance.

**Built.** LOD0 280 tris, 972 render tris across all twelve meshes.

### 4.8 Scrub bush, `nodes/bush_scrub.glb`

1.0 x 1.0 x 0.9 m. Five faceted lobes on a stub stem. 200 / 80 tris.
Materials (3) `OF_Bark`, `OF_Leaf`, `OF_LeafDry`. `socket_hit`,
`socket_item_pop`. `Tree_Sway` 1 to 181, and **no `Tree_Fall` and no `_Stump`**:
a bush is stripped, never felled, so it also carries no `socket_fell_pivot`.
Depletion 5 lobes / 3 lobes with one dry / 2 small dry lobes.
Collision (**added 2026-07-25**, the section omitted it while section 2.5
requires one per asset): `col_BushScrub`, box 0.90 x 0.90 x 0.90.
Low wood yield: this is the bootstrap harvest before the player has an axe.

**Built.** LOD0 128 tris, 440 render tris.

#### 4.8.1 World dressing pass, 2026-07-27 (W11 lane A): trees, bush, grass

Reid: "Grass, trees, ore deposits". Ore already reads well, so it was the BAR
rather than the target and the boulders were left alone. This pass is the two
trees, the bush, the plains and forest atlases.

**What the client actually draws, which changed the whole shape of the job.**
`web/src/game/NodeBatch.ts:139` matches `_LOD0` and nothing else, and line 42 is
`VARIANTS = ['Full', 'Half', 'Low']`. So for a harvest node **only `_Full_LOD0`,
`_Half_LOD0` and `_Low_LOD0` are ever drawn**, at every distance, and every
`_LOD1`, `_LOD2` and `_Stump` node in the nine node files is dead weight that
the contract still requires. Since `NodeField.ts:161` spawns **14 trees** and
`NodeBatch.ts:67` caps the batch at 128 instances, a conifer at the full
900-triangle budget costs 14 x 900 = 12,600 triangles in the entire scene. The
trees were not triangle-constrained at all, and the effort went into `_LOD0`.

| asset | LOD0 tris | total render tris | bytes |
|---|---|---|---|
| `tree_conifer` | 308 -> **584** | 1072 -> 1384 | 56,836 -> 84,280 |
| `tree_broadleaf` | 280 -> **452** | 960 -> 1132 | 61,896 -> 79,348 |
| `bush_scrub` | 128 -> 128 | 428 -> 428 | 36,548 -> 40,348 |
| `props_plains` | 136 -> 136 | 483 -> 647 | 46,528 -> 58,424 |
| `props_forest` | 124 -> 124 | 539 -> 594 | 54,040 -> 58,776 |
| `detail_cards` | 40 -> 40 | 118 -> 118 | 10,772 (unchanged) |

**Four new nature palette roles** carry most of the improvement at zero
triangle cost: `LeafDeep` `2F4F26`, `LeafLight` `7FA84E`, `Grass` `6F8F42`,
`BarkLight` `6B5238`, all added to `of_lib.DOUBLE_SIDED`. `NodeBatch` bakes
material colour into a **vertex attribute** and batches only by shading family
(metal or matte), so a canopy shaded deep at the base to light at the crown
costs **no extra draw call**. Two new shared helpers in `tree_common.py`,
`taper_bands()` and `canopy_mass()`, do the jittered banding.

**The grass took two passes and the first one was wrong in an instructive way.**
The complaint is that the ground reads as bare, and the obvious reading is
"not enough grass". It is not. Working from `web/src/assets/Registry.ts:76-78`
and `DENSITY_SCALE = 6` at line 67, the plains scatter places **0.096 grass
tufts per m2, one every 10.4 m2**, so there were already hundreds of them across
the visible field. They are invisible because **`Plains_GrassTuftA` was 0.44 m
tall and the visible ground is 20 to 50 m away, where 0.44 m subtends 2 to 6
pixels.**

So the lever is coverage and mass per instance, not count. The first redesign
built loose clumps of individually spaced blades 1 to 2 cm wide, which at
distance is the same defect in a new shape: **a blade has to survive being one
pixel wide before it can add anything.** The shipped version spawns each fan
from a tight radius (0.11 to 0.13 m down to 0.025 to 0.035) with wide blades
(0.04 to 0.05 m up to 0.115 to 0.125), so the bases overlap into a **solid green
core** and only the tips splay, with pale seed heads breaking the top line.
Verified by rendering the same clump at 8 m and 25 m, which is the test that
matters and the one the first pass had not run. Declared sizes went
`GrassTuftA` 0.44 -> **0.95 m** and `GrassTuftB` 0.66 -> **1.30 m**.

**Grass moved onto its own `OF_Grass` role for a render reason as well as a
colour one.** `web/src/render/instancing/PropLibrary.ts:33` allocates
`CAPACITY = 7000` instances **per material batch**, fixed, with no growth path,
and exhaustion is silent (`PropLibrary.ts:152` counts `exhausted++` and simply
does not draw). Over the 170 m scatter radius the placement rate wants about
8,700 grass instances, so sharing `OF_Leaf` with every other biome's foliage was
already binding. Its own role is its own pool, for one extra draw call against a
budget that sits at 45.

`detail_cards.glb` was deliberately left minimal: it is **declared and dead** in
the client (`Registry.ts:18` is the only occurrence of `detailCards` anywhere,
and nothing passes it to `loadGlb`).

### 4.9 Water pool, `nodes/water_pool.glb`

3.0 x 3.0 m, rim 0.25 m above the water. A shallow rock-rimmed basin: an 8-sided
irregular rock rim, an inner basin floor at `Z = 0.02`, and a flat water plane at
`Z = 0.20`, 0.05 m below the rim. Origin at basin centre on the ground.

280 tris. Materials (3): `OF_Rock` rim and rim rocks, `OF_Soil` bed and exposed
mud, `OF_Water` (double-sided, alpha 0.65). **Corrected 2026-07-25:** the spec
said two. Depletion needs a mud role, because the only way a draining pool
reads at distance is a *widening brown ring* where the water used to be; a bed
made of the same rock as the rim shows nothing.
Sockets: `socket_draw` (water plane centre, where the collect prompt anchors).
Collision: `col_WaterPool`, box 3.0 x 3.0 x 0.25.
Depletion is the waterline: `_Full` 0.200 m, `_Half` 0.125 m, `_Low` 0.055 m,
each drop uncovering the mud shelf ring beneath the old shoreline.
Clip: `Water_Ripple` 1 to 121, loop, water plane translates plus or minus 0.01 in Z.
The three variants' water planes are siblings of the LOD meshes, parented to one
shared `ripple_pivot` (section 2.7), and are named `WaterPool_<Variant>_Water`.
**Preferred at runtime:** replace the clip with a vertex-displacement shader; the clip
exists so the asset is complete without shader work.

**Built.** LOD0 192 tris, 948 render tris.

### 4.10 Oil seep, `nodes/oil_seep.glb`

2.2 x 2.2 x 0.35 m. A dark tar pool in a cracked crust: an irregular 10-sided crust
ring, a flat oil surface at `Z = 0.06`, and two low pressure-mound bulges.

260 tris. Materials (3): `OF_Rock`, `OF_Oil`, `OF_Soil`. `OF_Oil` is the only
glossy ground surface in the palette (roughness 0.25 against everything else's
0.9), which is what makes a seep unmistakable at any distance.
Sockets: `socket_draw`, `socket_item_pop`.
Collision (**added 2026-07-25**, omitted here while section 2.5 requires one):
`col_OilSeep`, box 2.2 x 2.2 x 0.35.
Depletion is the tar line: slick radius 0.68 / 0.46 / 0.26 m with a widening
ring of dried crust, and 2 / 1 / 0 pressure mounds. A dead seep is flat, dry
and matte.
Clip: `Oil_Bubble` 1 to 97, loop. **Corrected 2026-07-25:** the spec asked for
two bulges scaling half a cycle apart, which needs two animated objects and
therefore two clips, and the validator checks the clip name set exactly. The
mounds are instead one group on a shared `bubble_pivot` that **scales and tips
about Y** together: the mound at -X rises as the mound at +X sinks, which is
the requested alternation out of one clip on one object. The mound groups are
named `OilSeep_<Variant>_Bulges`.

**Built.** LOD0 152 tris, 870 render tris.

### 4.11 Items atlas, `items/items_atlas.glb`

Fourteen meshes, listed in section 3.1. Each has its **origin at its own volumetric
centre**, not at its base, because items tumble in the air when dropped and ride
centred on a belt. 40 to 120 tris each, 1200 total, no LODs, no collision (the ground
drop uses a code-generated sphere), no clips.

Materials come from the palette only. The ore chunks share the boulder language at
1/6 scale: a few flat facets, ore facets split out to catch specular. Ingots are
chamfered trapezoid bars. The `Item_Log` is an 8-sided cylinder with visible end grain
as a darker `OF_Bark` cap.

Every item must be legible in a 64 px orthographic icon render, which is the real
constraint: if you cannot tell the iron ingot from the copper ingot at 64 px, the
material contrast is wrong, not the mesh.

**All fourteen meshes sit ON the origin and overlap** (**added 2026-07-25**; the
section never said where the meshes live relative to each other). There is no
atlas layout, because a layout offset rides along on the node transform and every
consumer would have to subtract it back out. The renderer picks one item by name
and clones it, and they are never all visible at once, so the overlap costs
nothing. `validate_glb.py`'s `pivot_mode: "centre"` checks the centred-origin rule
per mesh, and the new `parts` block checks all fourteen bounding boxes and tri
budgets: a single `lod0_node` check would prove nothing about the other thirteen.

**Corrected 2026-07-25:** `Item_Log`'s end grain is `OF_LeafDry` (pale sapwood),
not "a darker `OF_Bark`". Dark end grain on dark bark is invisible at 64 px, and
`OF_LeafDry` is already the conifer stump's cut face (section 4.6), so the two
cut-wood surfaces in the game now match. `Item_FerriteOre`'s chips are `OF_Accent`
orange rather than a metal so it is never mistaken for raw iron.

**Built.** 560 render tris against the 1200 budget: 40 tris per ore chunk, 76 for
the oil flask, 72 for the frame part, 52 for the canister, 12 for the plate. The
smaller items land under the "40 to 120 each" guide because a chamfered slab is
genuinely 12 triangles; the budget is a ceiling, not a quota.

### 4.12 Belt segment, `machines/belt_segment.glb` (BUILT, reference asset)

This one is built. See `tools/blender/build_belt_segment.py`, which is the template
every other build script copies.

Footprint **1 x 1 m**, height 0.30 m, flow along **-Y** (three.js +Z). Origin at cell
centre on the ground.

**Key shapes.** Two 0.10 m side rails full height; a dark under-frame that ties it to
the ground; an 0.80 m rubber deck with its top at `Z = 0.25`; two end rollers (radius
0.055, 12 segments) **tangent to the cell edge, not past it**; a flush state chip in
the +X rail top.

**Poly budget (actual).** LOD0 148, LOD1 72, LOD2 12, animated slat strip 108, collision
12. Total render 352.

**Materials (4).** `OF_Steel` rails and rollers, `OF_SteelDark` under-frame,
`OF_Rubber` deck and slats, `OF_EmissiveState` chip.

**Sockets (4).** `socket_belt_in` (0, +0.5, 0.25), `socket_belt_out` (0, -0.5, 0.25),
`socket_item` (0, 0, 0.28), `socket_status` (0.45, 0, 0.30).

**Clip.** `Belt_Scroll`, frames 1 to 61 (1.000 s), the 9-slat strip translates exactly
one slat pitch (0.125 m) in -Y. The strip carries 8 slats on the tile plus a 9th
entering from the inlet, so the loop is seamless; the mid-loop overhang past the front
edge tucks under the next tile's roller. The strip is a **sibling** of `_LOD0`, not a
child, so `_LOD0`'s bounding box stays exactly 1 x 1 x 0.30 and the scale check is
exact. Retiming:

```js
action.timeScale = beltSpeedMetresPerSecond / 0.125;   // tier-1 belt: 1.875 / 0.125 = 15
```

**Alternative at scale (recommended for the shipping renderer):** per-belt
`AnimationMixer` instances do not scale to thousands of lines. Group belts into one
`InstancedMesh` per belt tier and scroll a shared material instead, driven by
`FFactoryBeltFlowState.FlowSpeedQuant`. The baked clip stays for the LOD0 hero path
and for any belt the player is standing on.

### 4.13 Belt curves and end cap

`belt_curve_l.glb` / `belt_curve_r.glb`: same 1 x 1 x 0.30 cell, same rails and deck
language, quarter-turn deck with a wedge-shaped slat fan. Flow enters +Y and exits -X
(left) or +X (right). 200 tris. Same four materials, same four sockets, same
`Belt_Scroll` clip (the fan rotates instead of translating, 1 to 61).

`belt_end_cap.glb`: a closed roller housing that terminates a line head or tail so a
belt never ends in a visible hole. 120 tris, three materials (no chip), sockets
`socket_belt_in` and `socket_item`. No clip.

#### 4.13.1 Belt cargo: the published path, and the day 0.280 turned out not to be a surface

**Built 2026-07-27 (W11 lane A).** Reid: "Belts should show the material being
transported (like factorio or satisfactory), and i should be able to pick up
that stuff off the belts." The placement code is the belt lane's; this is the
geometry and the contract it codes against.

Path sockets on all four tiles, three.js axes, local to the 1 m cell centre,
all at **Y = 0.280**:

| tile | `socket_item_a` | `socket_item` | `socket_item_b` | shape | arc length |
|---|---|---|---|---|---|
| `belt_segment` | (0, .28, -0.5) | (0, .28, 0) | (0, .28, +0.5) | line | **1.000000 m** |
| `belt_curve_l` | (0, .28, -0.5) | (-.1464, .28, -.1464) | (-0.5, .28, 0) | arc r 0.5 about (-0.5, -0.5) | **0.785398 m** |
| `belt_curve_r` | (0, .28, -0.5) | (+.1464, .28, -.1464) | (+0.5, .28, 0) | arc r 0.5 about (+0.5, -0.5) | **0.785398 m** |
| `belt_end_cap` | (0, .28, -0.5) | (0, .28, -0.15) | (0, .28, +0.20) | line (stub) | **0.700000 m** |

**Spacing is not an art choice.** `factory_sim.h` has `kUnitsPerTile = 256` and
`kItemSpacing = 64`, so saturated items sit **0.250 m apart** on a 1 m tile,
four per tile, the Factorio number. Therefore **an item rides with its own local
+Z along the flow tangent, and its local Z extent must be <= 0.250 m**, or
saturated items interpenetrate. Twelve of the fourteen shipped items already
satisfied it; `Item_FerritePlate` and `Item_FramePart` did not, at 0.28, and
nobody had noticed because nothing had ever put an item on a belt. Both are now
0.24. The deepest item is the new `Item_Crate` at 0.240, which is 96% of the
pitch and 10 mm of air at saturation.

**The interesting finding: `socket_item` at Y = 0.280 was not on any surface.**
Measured off the shipped bytes the rubber deck top was 0.250 and the slat top
0.272, so the published carrying point floated 8 mm above the belt. Rather than
move a socket other code would come to depend on, the geometry was made true:
slats went 22 mm to **30 mm** thick, so 0.250 + 0.030 = 0.280 **is** the
carrying surface. A side effect fell out of it: the end rollers top out at 0.275
and had been poking **3 mm above the old ride plane at every tile seam**, which
would have shown as items ticking over a bump at each cell boundary. They now
clear by 5 mm.

**The shader and the art agree, and that was checked rather than assumed.**
`web/src/game/MachineBatch.ts:191-205` draws the belt's motion as a fragment
band on a radius-0.5 centre line about the tile corner, with a phase that IS arc
length from the inlet. Fitting a circle to the three published sockets returns
the same centre and r = 0.500000 to 2.9e-8 m. Two curves that look alike would
have been a bug waiting for a playtest.

**`Item_Crate` is new and it answers a gap nobody had hit yet.** Twelve items in
`gameplay.h` are `ItemCategory::Buildable` (0x10 to 0x16, 0x3B, 0x3C, 0x40 to
0x43) and none of them has a belt-sized mesh. Scaling a machine down was the
alternative, and a 4 m foundation at 0.24 m is a smudge. One generic strapped
crate carries all twelve; the HUD says which thing it is, the mesh says "packed
for transport".

The rule is asserted on the shipped bytes by `tools/blender/check_belt_cargo.py`
(section 7.6).

### 4.14 Miner, `machines/miner.glb` (TypeId 0x10)

Footprint **2 x 2 m**, height 2.4 m. Requires a deposit under the footprint
(`EntityDef.requiresDeposit`), so the design must say "it eats the ground".

**Silhouette.** A squat four-legged gantry straddling the ore with a vertical drill
column down the middle and a chunky output chute on the forward face. From any angle
you can see straight through the legs to the ground it is working, which is what makes
the deposit binding legible.

**Key shapes.** Four corner legs 0.25 x 0.25 x 0.90; body box 1.80 x 1.80 x 0.90 sitting
at `Z = 0.9` to `1.8`; drill column, a 12-sided cylinder radius 0.28, height 1.4,
centred; drill bit, an 8-sided cone radius 0.30 to 0.06 with the tip at `Z = 0.05`; a
hazard-striped collar ring where the column meets the body; output chute 0.50 x 0.70 x
0.50 on the -Y face; status panel 0.30 x 0.05 x 0.20 on the +X face at `Z = 1.5`.

**Poly budget.** LOD0 900, LOD1 400, LOD2 120 (hand-built).
**Materials (5).** `OF_Steel`, `OF_SteelDark`, `OF_Accent`, `OF_Hazard`,
`OF_EmissiveState`.
**Sockets.** `socket_item_out` (0, -1.0, 0.55), `socket_power_in` (0.9, 0.9, 1.8),
`socket_status` (1.0, 0, 1.5), `socket_drill_tip` (0, 0, 0.0).
**Collision.** `col_Miner`, box 2.0 x 2.0 x 2.4.

**Clips.** `Drill_Spin` 1 to 31 (loop; 30 frames = `MineFerrite.timeTicks`; the column
rotates one full turn about Z) and `Drill_Bob` 1 to 61 (loop; the column translates
0 to -0.08 to 0 in Z). Both play together; `Drill_Spin` retimes with
`timeScale = 30 / recipe.craftTimeTicks`.

### 4.15 Smelter, `machines/smelter.glb` (TypeId 0x12)

Footprint **2 x 2 m**, height 2.6 m.

**Silhouette.** A brick-and-steel kiln: a wide base tapering to a short chimney offset
toward the back, with a glowing firebox door on the forward face. The offset chimney is
what stops it reading as a generic box.

**Key shapes.** Base plinth 2.0 x 2.0 x 0.25; body 1.70 x 1.70 x 1.60 from `Z = 0.25` to
`1.85` with a chamfered top collar; chimney, a 10-sided cylinder radius 0.22, height
0.75, at `(0, +0.5)`; firebox door 0.70 x 0.06 x 0.60 on the -Y face at `Z = 0.75`;
input hopper on +Y at `Z = 0.9`; output chute on -Y at `Z = 0.35`; status chip on +X.

**Poly budget.** 700 / 320 / 100.
**Materials (5).** `OF_Steel` jacket, `OF_SteelDark` plinth and bands, `OF_Accent` trim,
`OF_Rock` exposed refractory brick, `OF_EmissiveState` firebox door and vent slot.
**Emissive.** Combustion machine: `working` overrides to fire orange `#FF7A1E` at
intensity 2.2.
**Sockets.** `socket_item_in` (0, +1.0, 0.9), `socket_item_out` (0, -1.0, 0.45),
`socket_power_in` (0.85, 0.85, 1.85), `socket_smoke` (0, 0.5, 2.6), `socket_status`.
**Collision.** `col_Smelter`, box 2.0 x 2.0 x 2.6.
**Clip.** `Furnace_Glow` 1 to 61 (loop; 60 frames = `SmeltFerrite.timeTicks`), a glow
card behind the firebox door scales 1.0 to 1.08 to 1.0. Preferred at runtime: drive
`emissiveIntensity` from `AnimPhase` instead and drop the clip.

### 4.16 Assembler, `machines/assembler.glb` (TypeId 0x13)

Footprint **3 x 3 m**, height 2.8 m.

**Silhouette.** An open-topped work cell with a corner-mounted articulated arm sweeping
over a central platen. The moving arm is the entire read at distance, so it must break
the machine's outline: at full extension the gripper reaches past the frame line.

**Key shapes.** Base 3.0 x 3.0 x 0.30; four corner posts 0.25 square by 2.50; an upper
frame ring tying the posts; central platen 1.40 x 1.40 x 0.15 at `Z = 0.9`; arm base, a
12-sided cylinder radius 0.28, height 0.35, at `(-1.0, -1.0, 1.2)`; upper arm 0.18
square by 1.10; forearm 0.14 square by 0.90; two-finger gripper 0.22 x 0.10 x 0.25; two
input hoppers on +Y and +X; output chute on -Y; a status bar along the front frame rail.

**Poly budget.** 1100 / 480 / 140.
**Materials (5).** `OF_Steel`, `OF_SteelDark`, `OF_Accent`, `OF_Hazard`,
`OF_EmissiveState`.
**Sockets.** `socket_item_in_a` (0, +1.5, 1.0), `socket_item_in_b` (+1.5, 0, 1.0),
`socket_item_out` (0, -1.5, 0.6), `socket_power_in` (1.4, 1.4, 2.5),
`socket_arm_grip` (on the gripper), `socket_status` (0, -1.5, 1.3).
**Collision.** `col_Assembler`, box 3.0 x 3.0 x 2.8.
**Clip.** `Assembler_Arm_Cycle` 1 to 91 (loop; 90 frames = `AssembleFrame.timeTicks`).
One full pick-place-return sweep: reach to input A on frames 1 to 25, to the platen on
26 to 50, press on 51 to 60, return on 61 to 90. Retimes with
`timeScale = 90 / recipe.craftTimeTicks`.

### 4.17 Box, `machines/box.glb` (TypeId 0x14)

Footprint **4 x 4 m**, height 3.0 m, RESIZED AT FS-68 from the 1 x 1 m crate this
section described for months. It was the smallest thing in a machine set whose
largest member is an 8 m assembler, and it became a real placeable at FS-70, so it
took the same treatment: one structural module (DW-32), an EVEN whole-metre
footprint, and item ports at the height every machine here presents them at. Even
is not cosmetic: `FactorySnap.stepsFor` steps `ceil((fpA + fpB) / 2)` cells, so an
odd footprint lands on the other side of the rounding and moves `PORT_MATE_M` for
every machine.

A ribbed steel plinth with a hazard skirt, corner posts, a stepped collar, a rimmed
roof pan with a recessed hatch, an inspection window, and a recessed intake mouth
and output chute so both ports read as physical slots a belt runs into.

516 LOD0 tris against a 700 cap, 744 render total against 1100. Materials (6):
`OF_Steel`, `OF_SteelDark`, `OF_Accent`, `OF_Hazard`, `OF_Glass` (the window,
which needs `"double_sided_ok": ["OF_Glass"]` or the culling check goes red) and
`OF_EmissiveState`.
Sockets, READ BACK OUT OF THE SHIPPED GLB rather than transcribed: `socket_item_in`
(0, 0.90, -2.00), `socket_item_out` (0, 0.45, +2.00), which are the SMELTER's own
port heights, so a belt deck at 0.25 m reaches them identically to every other
machine.
Collision: `col_Box`, box 4.0 x 4.0 x 3.0, 12 tris against a 64 cap.
Clip: `Box_Lid` 1 to 15, one-shot, lid rotates 0 to 72 degrees about its +X hinge;
played in reverse to close.

### 4.18 Generator, `machines/generator.glb` (TypeId 0x15)

Footprint **3 x 2 m**, height 2.6 m. The only machine whose animation must be visible
from across the base, because "is my power on" is the question players ask most.

**Silhouette.** A horizontal cylindrical boiler on a skid with a large flywheel on one
end and a tall offset exhaust stack. The flywheel is deliberately oversized: it is the
power-status indicator you can read at 100 m, before the state chip is even resolvable.

**Key shapes.** Skid 3.0 x 2.0 x 0.30; boiler, a 16-sided cylinder radius 0.65, length
2.20, axis X, at `Z = 1.1`; flywheel, a 16-sided disc radius 0.60, thickness 0.18, axis
X, at `X = +1.35` with six cut-out spokes; exhaust stack, a 10-sided cylinder radius
0.20, height 1.30, at `(-0.9, +0.55)`; fuel hopper 0.70 x 0.60 x 0.70 at `(0.6, -0.7)`;
firebox grate 0.60 x 0.05 x 0.35 on the -Y face.

**Poly budget.** 900 / 400 / 120.
**Materials (5).** `OF_Steel`, `OF_SteelDark`, `OF_Accent`, `OF_Hazard`,
`OF_EmissiveState` (firebox grate; combustion override applies).
**Sockets.** `socket_fuel_in` (0.6, -1.0, 0.9), `socket_power_out` (-1.4, 0, 2.0),
`socket_smoke` (-0.9, 0.55, 2.6), `socket_status` (1.5, 0, 1.8).
**Collision.** `col_Generator`, box 3.0 x 2.0 x 2.6.
**Clip.** `Gen_Flywheel` 1 to 121 (loop; 120 frames = `BurnCombustite.timeTicks`), two
full turns about X per burn.

### 4.19 Power pole, `machines/power_pole.glb` (TypeId 0x16)

Footprint **1 x 1 m**, height 4.0 m. A slim four-leg lattice mast (legs 0.06 square,
splayed from 0.35 m at the base to 0.14 m at the top) with a 1.10 m crossarm at
`Z = 3.75`, two insulator caps, and a small supply lamp at 0.6 m where a player
standing next to it can see it.

350 / 160 / 40 tris. Materials (3): `OF_Steel`, `OF_SteelDark`, `OF_EmissiveState`.
Sockets: `socket_wire_a` (-0.55, 0, 3.75), `socket_wire_b` (+0.55, 0, 3.75),
`socket_status` (0.12, -0.12, 0.6).
Collision: `col_PowerPole`, box 0.40 x 0.40 x 4.0.
No clips. Wires are runtime catenary `THREE.Line` geometry drawn between the
`socket_wire_*` nodes of connected poles.

### 4.20 Inserter, `machines/inserter.glb`

Footprint **1 x 1 m**, height 0.9 m. The classic Factorio read, in 3D: a base disc, a
single swing arm, and a two-finger grip that is clearly holding something.

**Key shapes.** Base disc, a 12-sided cylinder radius 0.35, height 0.12; a rotating
column radius 0.10, height 0.25; swing arm 0.08 x 0.55 x 0.08 pivoting at the column
top; grip 0.14 x 0.10 x 0.16 at the arm tip; a status chip on the base rim.

400 / 180 / 50 tris. Materials (4): `OF_Steel`, `OF_SteelDark`, `OF_Accent`,
`OF_EmissiveState`.
Sockets: `socket_pick` (0, +0.5, 0.35), `socket_drop` (0, -0.5, 0.35), `socket_grip`
(on the grip, where the carried item mesh parents), `socket_status`.
Collision: `col_Inserter`, box 0.6 x 0.6 x 0.9.
Clip: `Inserter_Swing` 1 to 31, one-shot, arm rotates +90 to -90 degrees about Z; play
with negative `timeScale` for the return, matching the sim's two-phase
`InserterPhase::Idle` / `Holding`.

### 4.21 Primitive furnace, `machines/primitive_furnace.glb` (TypeId 0x30)

Footprint **1 x 1 m**, height 1.4 m. This is the player's first structure and it must
read *pre-industrial* standing next to the steel machines, because the visual jump from
furnace to smelter is how progression is felt.

**Silhouette.** Stacked field stone with a rough clay cap, an open fire mouth on the
forward face, and a small fuel shelf. Irregular, hand-piled, no straight lines: every
edge is off-axis by a few degrees.

**Key shapes.** Eight to ten irregular stone blocks (0.25 to 0.45 m) stacked in a rough
ring; a clay cap dome at `Z = 1.15` to `1.40`; a fire mouth opening 0.40 x 0.35 on -Y at
`Z = 0.25`; a fuel shelf 0.45 x 0.20 x 0.06 below it.

500 / 220 / 60 tris. Materials (4): `OF_Rock`, `OF_RockDark`, `OF_Soil` (clay cap),
`OF_EmissiveState` (a fire card recessed in the mouth; combustion override applies).
Sockets: `socket_item_in` (0, +0.5, 0.9), `socket_item_out` (0, -0.5, 0.30),
`socket_fuel_in` (0, -0.5, 0.55), `socket_smoke` (0, 0, 1.4), `socket_status` (the fire
card itself).
Collision: `col_PrimitiveFurnace`, box 1.0 x 1.0 x 1.4.
Clip: `Furnace_Glow` 1 to 181 (loop; 180 frames = `ticksPerSmeltFor(Furnace)`), the fire
card scales 1.0 to 1.10 to 1.0 with an irregular, non-sinusoidal curve so it flickers
rather than pulses.

**Fuel state matters here.** The survival `Furnace` stalls with no fuel, and that is
distinct from blocked. Map `fuelTicks == 0` to `VisualState = 3` (no-power red) and let
the fire card go fully dark; a cold furnace must look cold.

### 4.22 Survival smelter, `machines/survival_smelter.glb` (TypeId 0x31)

Footprint **2 x 2 m**, height 2.0 m. The furnace grown up: the same stone core, now
wrapped in a riveted iron jacket with a proper flue and a bellows box on the side. It
must be visibly the *same lineage* as the primitive furnace (stone still showing through
the jacket seams) while clearly being three times the machine, since it runs the same
recipes at 3x the rate.

**Key shapes.** Base plinth 2.0 x 2.0 x 0.20; a stone core visible through jacket gaps;
riveted iron jacket panels 1.7 x 1.7 x 1.4; flue, a 10-sided cylinder radius 0.18,
height 0.55, at `(0, +0.45)`; bellows box 0.50 x 0.70 x 0.60 on +X with a concertina
face; fire mouth 0.55 x 0.45 on -Y.

700 / 300 / 90 tris. Materials (5): `OF_Steel`, `OF_Rock`, `OF_SteelDark`, `OF_Accent`,
`OF_EmissiveState`.
Sockets: `socket_item_in` (0, +1.0, 1.0), `socket_item_out` (0, -1.0, 0.35),
`socket_fuel_in` (0, -1.0, 0.7), `socket_bellows` (1.0, 0, 0.9), `socket_smoke`
(0, 0.45, 2.0), `socket_status`.
Collision: `col_SurvivalSmelter`, box 2.0 x 2.0 x 2.0.
Clips: `Smelter_Bellows` 1 to 61 (loop; 60 frames = `ticksPerSmeltFor(Smelter)`, the
concertina face scales 1.0 to 0.55 to 1.0 in Y) and `Furnace_Glow` 1 to 61, phase-locked
so the fire brightens on the bellows compression.

### 4.23 Base building set, `structures/*.glb`. **Built 2026-07-26.**

Four parts that tile: `foundation`, `floor` (which is also the ceiling), `wall`
and `door`. Every number below lives once, in `tools/blender/structure_common.py`,
and the four build scripts import it. A tiling set is only correct as a whole:
if the wall height and the deck thickness are typed separately into four files,
the storey pitch is a number nobody owns and it drifts the first time somebody
nudges a wall.

#### The module. **Rescaled 1 m to 4 m on 2026-07-26 (DW-32 / BT-11).**

| Constant | Value | Was | Meaning |
|---|---|---|---|
| `CELL` | **4.00 m** | 1.00 | plan module. Four whole voxel cells (`kVoxelSizeM = 1.0`) and four 1x1 machines across |
| `DECK_H` | **0.50 m** | 0.50 | foundation, floor and ceiling are ONE thickness |
| `WALL_H` | **3.50 m** | 2.50 | wall height, deck top to next deck base; clear head height |
| `WALL_T` | **0.25 m** | 0.25 | wall thickness, centred on the cell edge |
| `STOREY` | **4.00 m** | 3.00 | `DECK_H + WALL_H`, asserted at import time |

**Only the PLAN module scaled, and that is the whole re-derivation.** `DECK_H`
and `WALL_T` are person-and-structure-scale numbers, fixed by what a deck and a
wall physically are rather than by how wide the bay is. Multiplying them by four
would have given a 2 m thick slab and a 1 m thick partition, which is a bunker.
A 4 x 4 x 0.50 deck is an 8:1 slab, which is what a real 4 m span looks like.
`WALL_H` rose to 3.50 because a 4 m wide bay with a 2.5 m ceiling reads squat,
and because it lands the new identity:

> **`STOREY` now EQUALS `CELL` at 4.00 m.** The plan lattice and the vertical
> lattice are one number, so a deck base sits on `y = 4N`, a wall run on
> `x = 4k`, and both are whole multiples of the 1 m voxel grid. Level N's deck
> base is at `y = 4N` for every N, with no accumulated error and no per-level
> offset. `structure_common.py` asserts both `DECK_H + WALL_H == STOREY` and
> `STOREY == CELL` at import; deleting either assert is a design decision, not
> a fix.

That identity is also why the deck is 0.50 and not 0.25: a thinner floor would
put the storey pitch at two different values depending on which one you were
standing on.

Everything a base is built from now costs a sixteenth of the pieces it used to.
A 20 x 20 m platform was 400 foundations; it is 25.

#### The two anchors

Structural parts do not all snap to the same thing, and pretending they do is
where a build system goes wrong:

| Family | Anchor | Snap rule (three.js axes, `C` = `CELL`) |
|---|---|---|
| deck (`foundation`, `floor`) | cell **centre** | `((i + 0.5)C, deckY, (j + 0.5)C)` |
| wall (`wall`, `door`) | cell **edge midpoint**, straddled | X-running: `((i + 0.5)C, deckY + DECK_H, jC)`, yaw 0. Z-running: `(iC, deckY + DECK_H, (j + 0.5)C)`, yaw 90 degrees |

Both still obey section 2.1 exactly: pivot centred in X/Z, base on `y = 0`. A
wall is centred on its own origin across its 0.25 m thickness, so putting that
origin on the edge line is what makes one wall serve **both** cells it divides,
and what makes four walls close exactly around one foundation.

#### The tiling, measured

Measured off the shipped `.glb` files by `tools/blender/check_mating.py`, which
walks the node hierarchy and transforms accessor bounds into world space. Not
asserted, and not read back from `structure_common.py`. All values are exact to
the printed precision.

| Claim | Evidence |
|---|---|
| decks tile in a row | cells 0..3 occupy `x` `[0,4] [4,8] [8,12] [12,16]`; gap between neighbours `+0.000000000 m` |
| walls tile in a row | same spans; gap `+0.000000000 m` |
| four walls enclose one foundation | foundation `x[0,4] z[0,4]`; S wall `z[-0.125, +0.125]`, N wall `z[3.875, 4.125]`, W wall `x[-0.125, +0.125]`, E wall `x[3.875, 4.125]`. Clear interior **3.750 x 3.750 m** |
| a wall reaches the deck it stands on | foundation top `y = 0.500`; wall base `y = 0.500`, wall top `y = 4.000` = next deck base. Storey pitch **4.000 m exact** |
| the floor doubles as the ceiling | `floor` placed at `y = STOREY` meets the wall head at `+0.000000000 m` |
| a door drops into a wall cell | `wall` and `door` LOD0 AABBs are both `[4.0, 3.50, 0.25]`, identical to 1e-9 |

The corner overlap is **unchanged at 0.125 x 0.125 m**, precisely because
`WALL_T` did not scale. A wall on a foundation edge still puts 0.125 m on the
deck and 0.125 m overhanging.

**Collinear parts touch, perpendicular parts interpenetrate.** Two walls in a
row share the plane `x = k` exactly: zero gap, zero overlap, and no z-fighting,
because two opaque faces back to back are one culled and one occluded (this is
the same arrangement two belt tiles have already shipped with). Two walls
meeting at a right-angled corner necessarily share a `WALL_T/2` square,
**0.125 x 0.125 m**, of volume. That is unavoidable for edge-centred walls of
finite thickness and it is invisible, because the shared volume is inside solid
geometry on both parts. Do not "fix" it by shortening the panels: that would
open a real gap between collinear walls, which IS visible.

A wall on a foundation edge puts **0.125 m on the deck and 0.125 m
overhanging**, by construction. With a foundation next door the overhang lands
on it; on an outside edge it reads as a fascia, which is what a wall sitting on
a slab edge looks like.

#### The parts

**`structures/foundation.glb`** - 4 x 4 x 0.50 m, 108 / 24 / 12 tris.
A poured stone pad on a stepped footing, edged with a steel kerb. The kerb is
not decoration: it is what makes the tile boundary legible, so a 20 x 20 m
platform reads as a grid of placed modules rather than one grey sheet. Only the
deck plate and its kerb reach the full 1.00 m; the footing and body are inset,
so two neighbours meet on the kerb line and show a shallow reveal below it.
Materials (3): `OF_Rock`, `OF_RockDark`, `OF_SteelDark`. Collision `col_Foundation`.
Sockets `socket_top`, `socket_edge_n/e/s/w`. No clips.

**`structures/floor.glb`** - 4 x 4 x 0.50 m, 132 / 60 / 12 tris. **Also the ceiling.**
A steel deck plate on a perimeter beam frame with a 3 x 3 waffle of ribs (two
cross ribs at 1 m read as sparse across a 4 m span). The ribs are on
the UNDERSIDE and the plate on top because the part is authored to be seen from
both sides at once: plate from above, structure from below. Distinct from the
foundation on purpose - stone-and-kerb means ground, steel-and-beam means
suspended, and a player should be able to tell from the material alone whether
the thing under their feet is on soil or over a drop.
Materials (2): `OF_Steel`, `OF_SteelDark`. Collision `col_Floor`. Same five sockets.

**`structures/wall.glb`** - 4 x 0.25 x 3.50 m, 108 / 72 / 12 tris.
A framed panel, not a slab: two full-depth corner posts, bottom and top rails,
**three full-depth mullions on the 1 m voxel lines**, and a mid rail, with the
`OF_Steel` field recessed 45 mm behind the `OF_SteelDark` frame on both faces.
All the cost is in that one depth step, and it is what makes a 3.5 m wall read as
built rather than extruded from 1 m away, which is where the player is standing.
The mullions are the part that scaled: one 4 m bay with nothing in it is a
billboard, and putting the divisions on whole metres keeps the panel legible
against the voxel grid behind it.
Materials (2): `OF_Steel`, `OF_SteelDark`. Collision `col_Wall`.
Sockets `socket_top`, `socket_end_l`, `socket_end_r`. No clips.

**`structures/door.glb`** - 4 x 0.25 x 3.50 m, 216 / 60 / 36 tris + an 84-tri leaf.
The wall module with a **1.20 m wide by 2.40 m tall** clear opening, which passes
the 0.60 m player body with 300 mm either side.

*The door stays ONE FULL CELL, and the OPENING did not scale.* This was the one
real decision in the rescale, and both halves of it matter.

It stays a full cell because that is the property that makes the set usable:
every structural part is one module, so a wall run is a list of cells and **any
cell can become a door without re-planning the run**. The alternative, a
sub-cell door placed somewhere within a wall panel, needs a second and finer
lattice for wall furniture that nothing in the placement system has, plus a
rule for what happens when a player puts two of them 0.3 m apart. That is a
whole placement feature bought to solve a problem the second half already
solves.

The opening did not scale because **a 4 m opening is a garage, not a door**.
The module is a plan dimension and the opening is a person dimension, exactly
the same split that keeps `DECK_H` at 0.50 and `WALL_T` at 0.25. So the panel is
4 m and the hole in it is 1.20 m: wide enough to walk equipment through, and
unmistakably a door. A genuine 4 m vehicle opening is a good future part, and it
is a DIFFERENT part (`WallGate`), not this one stretched.

The consequence is 1.40 m of panel either side of the opening, which is a lot,
so the door surround is widened to land ON the wall's mullion at `x = +/-1.00`
rather than beside it. Otherwise it leaves a 0.20 m sliver of field between
surround and mullion that reads as a mistake.

*It has to read as a door from outside,* and at 30 m the opening itself is a dark
smudge that reads exactly like a shadow. So the frame's outward face is built as a
facia layer 50 mm proud of a recessed core, and the top 160 mm of that facia is
the **only `OF_Accent` in the whole structural set**: an orange lintel band over
the opening. That band is the entire reason `wall.glb` is deliberately
monochrome - a wall run is the background a base is read against, and if every
panel carried a stripe the one thing a player needs to find would stop standing
out. Up close, the recessed leaf, its push bar and the `OF_Hazard` threshold
finish the read. At LOD1 and LOD2 the accent takes the whole header, because at
80 m the band IS the door.

Materials (4): `OF_SteelDark`, `OF_Steel`, `OF_Accent`, `OF_Hazard`.
Sockets `socket_top`, `socket_end_l`, `socket_end_r`, `socket_hinge` (-0.60, 0, 0).
Clip `Door_Swing` 1 to 25, one-shot, `door_hinge` rotates 0 to -95 degrees about
up; play with negative `timeScale` to close. `frame1_identity` asserts the
exported static pose is a CLOSED door, which is what a door at rest is. The
accent band now sits directly on the header rather than at the top of the panel:
at 3.5 m the panel top is a metre clear of a 2.4 m opening, and a band up there
stops marking the door and starts being a stripe.

*Collision is three boxes, not one.* One convex proxy per asset (section 2.5) is
the rule for a solid machine; a convex hull of a doorway is a sealed wall.
`col_Door_JambL`, `col_Door_JambR` and `col_Door_Header` leave the opening
genuinely walk-through, which is the only thing the part exists to do. The 40 mm
hazard threshold is a step-over and carries no proxy. The leaf carries none
either: a swinging collider is a physics decision, and until the placement lane
says otherwise the doorway is open.

#### Verification

`tools/blender/render_structures.py` assembles the **shipped** GLBs into a 3 x 3
cell room (now 12 x 12 m) using nothing but the anchors above, and renders it to
`docs/screenshots/structures_*.png`. It exists because every part here passes
`validate_glb.py` in isolation and the interesting failure is *between* parts: a
seam, an overlap, a wall that does not reach its deck. That only exists in an
assembly, so the assembly is what gets rendered. `tools/blender/check_mating.py`
is the arithmetic half of the same idea.

### 4.24 Support pillar, `structures/pillar.glb`. **Built 2026-07-26 (DW-32 / BT-11).**

DW-32 lets a foundation attach to a neighbour's edge and hang over a drop, which
is the answer to sloped ground instead of levelling it. Where the gap to the
ground is large the overhang needs a visible pillar, and **that gap is a
continuous number**: it is whatever the terrain happens to be under a deck the
player chose to extend. No single mesh spans a continuous range, because scaling
one stretches its foot and its bracket along with its shaft.

**So a pillar is not a part, it is a RECIPE over four parts.** All four are
ground-pivoted on the file origin, each with its own group node, and the
renderer clones and places them (the Tier-1 atlas convention).

| Group | Mesh | Dims (m) | Tris | Role |
|---|---|---|---|---|
| `PillarFoot` | `PillarFoot_LOD0` | 1.20 x 0.40 x 1.20 | 100 | splayed base plate on the ground. `socket_top` at `(0, 0.40, 0)` |
| `PillarShaft` | `PillarShaft_LOD0` | 0.50 x **1.00** x 0.50 | 28 | the **only** part ever scaled, and only in Y |
| `PillarCollar` | `PillarCollar_LOD0` | 0.70 x 0.24 x 0.70 | 56 | a band, repeated, **never** scaled |
| `PillarHead` | `PillarHead_LOD0` | 1.00 x 0.30 x 1.00 | 52 | bracket under the deck. `socket_deck` at `(0, 0.30, 0)` |

**The shaft is PRISMATIC, and that is the whole trick.** Its cross section is
constant along the axis and it carries no vertical feature of any kind, so
scaling it in Y is not an approximation, it is exact: nothing can distort
because there is nothing along the axis to distort. It is authored at exactly
1.00 m so `scale.y` **is** the length in metres. The rhythm that stops a long
pillar reading as a stretched tube comes from the collars, which are placed at a
fixed pitch and never scaled.

The assembly, given a gap `H` from the ground to the deck underside. These are
published as named constants in `structure_common.py` (`PILLAR_FOOT_H`,
`PILLAR_SHAFT_LEN`, `PILLAR_COLLAR_H`, `PILLAR_HEAD_H`, `PILLAR_MIN_H`,
`PILLAR_COLLAR_PITCH`, `PILLAR_COLLAR_CLEAR`) plus `pillar_parts(gap)`, so
neither the renderer nor the client types a pillar number of its own:

```
H < 0.70        no pillar at all: the deck is close enough to the ground
PillarFoot      y = 0,          0.40 tall
PillarShaft     y = 0.40,       scale.y = H - 0.70
PillarHead      y = H - 0.30,   0.30 tall
PillarCollar    y = 0.40 + 2.00k for k = 1.., dropped within 0.35 m of either end
```

Measured on the shipped file at gaps of 0.70, 1.37, 4.00 and 9.42 m, the
assembled height residual is `+0.000000000 m` in every case.

**The limits, stated rather than discovered later.** The minimum useful pillar
is 0.70 m, below which there is only a foot and a head and the recipe returns
nothing. There is no geometric maximum, but the shaft does not taper and no
diagonal bracing is authored, so past roughly 10 m a single pillar reads as a
thin unbraced stick; a bounded unsupported run and a maximum pillar height are
gameplay calls, and DW-32 already asks for the first. Collars are placed at a
fixed 2 m pitch measured from the foot, so a pillar whose gap is not a multiple
of 2 m has a longer bare stretch at the top than at the bottom. That is
deliberate: it puts the irregularity where the head bracket is, rather than
distributing it and making every pillar in a row differ from its neighbour.

Materials (3): `OF_SteelDark`, `OF_Steel`, `OF_Hazard`. Collision
`col_PillarShaft` and `col_PillarFoot`; the collar and head carry none, because
they are inside the shaft's own column.

**LOD0 only, and it is a floor rather than an omission.** A 28-triangle shaft
and a 56-triangle collar are already below where a decimator saves anything.
`detail_cards.glb` makes the same call for the same reason.

### 4.25 Armour, `player/armour_set.glb`. **Built 2026-07-27 (W11 lane A).**

Four wearable slots: head, chest, legs, feet. 904 triangles, 90,840 bytes, five
materials (`OF_Plate`, `OF_SteelDark`, `OF_SuitDark`, `OF_Hazard`,
`OF_EmissiveState`). Reid asked for "armor and armor slots for head chest legs
feet"; the slot logic and the stats are a gameplay lane's, this is the geometry
and the attachment contract.

| node | tris | measured dims (m, three.js) | bone whitelist |
|---|---|---|---|
| `Armour_Head_LOD0` | 192 | 0.294 x 0.360 x 0.327 | `Head`, `Neck`; the nape is `Head` alone |
| `Armour_Chest_LOD0` | 216 | 0.605 x 0.540 x 0.435 | `Hips`, `Spine`..`Spine2`; pauldrons on `<side>Shoulder` + `<side>Arm` |
| `Armour_Legs_LOD0` | 328 | 0.500 x 0.880 x 0.266 | `Hips` (+`Spine` belt), `Hips`+`UpLeg`, `UpLeg`+`Leg`, `Leg`+`Foot` |
| `Armour_Feet_LOD0` | 168 | 0.400 x 0.252 x 0.338 | `<side>Foot`, `<side>ToeBase` |

540 vertices, weight sum 1.0000 to 1.0000.

**The node names are SLOT names, not SET names.** A second armour set is a
second `.glb` carrying **the same four node names**, so slot lookup is
set-independent, swapping a set is swapping a file, and nothing ever keys off a
filename. That is why this file is `armour_set.glb` and not `armour_tier1.glb`.

**Each slot is a SKINNED mesh sharing the body's own 44-bone rig**, built from
`rig_common.BODY_BONES` so there is one declaration and the two rigs
structurally cannot drift: same names, same order, same T-pose rest, and the
exporter emits **one shared skin** so all four meshes reference the same joint
array and the same inverse bind matrices. The alternative was rigid parts
bone-parented one per bone, and it was rejected because a leg plate has to bend
at the knee and a rigid part cannot.

**The client's equip, precisely.** Do NOT `scene.add(armourScene)`, which would
carry a second skeleton. Load the file, take each named `THREE.SkinnedMesh`,
call `mesh.bind(bodyRig.skeleton, mesh.bindMatrix)` to rebind to the body's
existing `THREE.Skeleton` (legal because the joint order and the inverse bind
matrices are identical by construction, and `rest_pose` in the contract is the
checked proof at 2.69e-07), parent it under the same node the body's
`Player_LOD0` sits under, set `frustumCulled = false` because a skinned mesh's
bounds are its bind pose, and copy `layers`, `castShadow` and `receiveShadow`
from the body mesh. Unequip is `mesh.removeFromParent()` and nothing else. The
armour has no sockets, no clips and no collision, and needs none: it is driven
by the body's skeleton, and the player capsule is code-generated.

**LOD0 only**, because `web/src/player/Avatar.ts:55-62` loads the body with
`lod: '_LOD0'` and there is exactly one player. Revisit when multiplayer puts
more than one character on screen.

**The acceptance was rendering it ON the body, IN MOTION, and that is the whole
point.** `tools/blender/render_armour.py` imports both shipped files, drives
both armatures with the same clip at the same frame, and renders the dressed
character; it measures **rig drift 0.00e+00** at all nine tested poses. Four
defects were found and every one of them was invisible in a static fit:

1. **The waist opened 57 mm in `Crouch_Idle`.** The cuirass rim was rigid to
   `Spine` and the belt below it rigid to `Hips`, so a 26 degree hip rotation
   swung them apart and bare torso showed through the seam. **The general rule:
   two surfaces that must stay adjacent have to share the bones they straddle.**
2. **The knee cop floated at `Run:19`.** The front of a bending knee is the
   OUTSIDE of the bend, so that surface must get longer, and **no weighting can
   invent material**. The fix is slack, not tuning: the cuisse now ends 50 mm
   below the joint, the cop is 150 mm tall spanning 75 mm either side, and the
   greave rim starts 10 mm below it, so the seams slide instead of opening.
3. **Thin 58 mm plates read as floating rectangles**, showing daylight along
   both long edges the moment a limb swung. Deepening them to 110 to 120 mm and
   burying the back half costs nothing, because those faces are never seen.
4. **The nape lifted off the helmet in `Swing_Pickaxe`**, because its centroid
   gave it a 55/45 `Head`/`Neck` split. Bound to `Head` alone. Tightening a
   whitelist is always available and always beats tuning a falloff.

**A negative clearance minimum is NOT a defect here, and the rule that said it
was is wrong for this asset.** Measured signed distance to the nearest body
surface in the rest pose: chest min -0.0180 mean +0.0291, feet min -0.0030 mean
+0.0355, head min -0.0200 mean +0.0263, legs min -0.0239 mean +0.0216. Every
negative vertex is the **inner** face of a strapped-on plate, deliberately
buried in the limb it is strapped to, and a plate with zero penetration is a
plate floating off the body. The numbers that matter are the mean standoff (22
to 36 mm) and the identity of the deepest vertex, which in all four cases is an
inner face. Nothing negative is an outward-facing surface.

**Silhouette is the test, not colour.** `docs/screenshots/W11_armour_rest_f1_34.png`
against `W11_armour_bare_rest_f1_34.png`: crest, pauldrons, thickened shins and
32 mm longer sabatons. The outline changes, which is what has to be true at
10 m, because colour alone is invisible at distance and is also the first thing
a customization system will override.

**NO REFERENT IN THE HEADLESS HEADERS.** `grep -riE 'armor|armour|equip'
core/include` returns nothing, and `slot` in the client means an inventory slot,
a hotbar slot or a batch instance index. This is the BT-9 situation again: the
meshes ship and validate and nothing can wear one until gameplay adds an
`EquipSlot` enum, an `ItemCategory::Armour`, four `ItemId`s and an equipped
array, and persistence bumps the save schema by 16 bytes. Escalated to Admin.

**Known residue**, stated rather than discovered later: a wedge of bare suit
remains at the inner hip between the fauld's lower edge and the cuisse tops (a
harness genuinely articulates there, and the shoulder gusset that tried to close
the equivalent gap at the armpit protruded past the pauldron rim the moment the
arm swung, so it was removed); the tassets read as small tabs head-on because
the 0.50 m declared width leaves no room to widen them; the chest measures 0.435
against a declared 0.42, inside the 0.02 tolerance but using three quarters of
it, so it is the first number that goes out of contract if the chest pack ever
moves forward; and **the arms are unarmoured by design**, since four slots do
not include hands or arms.

**First person has no armour at all.** `armour_set` carries the third-person
44-bone rig; the view model is a different 27-bone rig with a different bind
pose. An armoured player currently sees unarmoured arms. Either a second armour
file authored against `FP_BONES`, or an explicit decision to accept it.

### 4.26 Research station, `structures/research_station.glb` (TypeId 0x45). **Built 2026-08-14 (A6 / RN-1530..1549).**

Footprint **2.00 x 2.00 m**, height **2.44 m**. A skid-mounted field research
bench: an instrument cabinet with a hooded screen and a canted control fascia,
a work surface with a grating insert and a sample clamp, a sensor mast, an
equipment box and the cabling between them. D-019 minted the TypeId on
2026-08-11 and `ResearchStations.ts` drew `machines/assembler.glb` until this
landed.

**Every dimension is derived from the client and none from the asset it
replaced.** The assembler is 8.00 m square; the class that borrowed it snaps to
`MachinePlacement.MACHINE_TILE_M` = 1.00 m, places 2.20 m ahead of the eye and
picks with a 1.40 m sphere sitting 0.70 m up. **2.00 m is two tiles**, so two
benches on adjacent cells abut exactly. **2.44 m is solved from the pick**:
`ResearchStations.pick` refuses a ray more than `STATION_RADIUS_M + 0.5` =
1.90 m from (0, 0.70, 0), the mast stands 0.721 m out in plan, so the sphere
allows it `sqrt(1.90^2 - 0.721^2)` = 1.757 m of rise, i.e. z <= 2.4578.
**Measured: the worst LOD0 vertex is 1.8894 m from that centre, so every part
of the asset is selectable.** `build_research_station._assert_envelope` checks
it off the accumulated vertices, because `contracts.json` measures a box and
this is a sphere.

**Key shapes.** Skid deck plate 2.00 x 2.00 x 0.06 with tread strips, two
lashing points and four levelling feet (one packed up on a shim); channel
runners and cross members standing clear of the ground so only the feet touch
it; a bolted hazard-yellow corner angle on the +X / -Y corner with the kick
plates dented at the same corner. Cabinet 0.92 x 0.48 x 1.48 in the +Y half,
corner posts straddling the edges, plate courses, a five-blade louvre bank on
the -X end, a bolted maintenance hatch with hinges, latch and placard on +Y, a
junction box and cable tray, drip lips on three faces. **The console**: a
coamed bezel, a `Glass` pane over an inset `EmissiveState` plate, a hood
leaning 0.46 m out over it on two gussets (the lit plate is emitted at every
tier as structure, so LOD2's `bracket` threshold cannot switch the screen off
at the range a lit panel is most of what the asset says), a canted `Accent` control shelf with
four switch bosses and two knobs, a two-dial cluster on the +X end. Work
surface at 0.92 m on two gussets and two legs, end rims, grating, tray and
clamp, a drawer below. Sensor mast at (0.60, 0.40) with a wind vane, a
four-disc radiation-shield stack, a sky dome and a finial. Equipment box, two
conduit runs, an earth spike and a hank of spare cable on a hook.

**2,860 / 1,852 / 1,036 tris** (cap 3,200 / 6,400 total). Materials (8):
`OF_Steel`, `OF_SteelDark`, `OF_SteelLight`, `OF_Accent`, `OF_Hazard`,
`OF_Rubber`, `OF_Glass`, `OF_EmissiveState`. `OF_Glass` is double sided and
declared.
Sockets: `socket_screen` (-0.14, 1.36, -0.04) facing the player, role `ui`;
`socket_status` (0.26, 1.62, -0.04), role `state_light`; `socket_sample`
(-0.12, 0.92, 0.30) facing up, role `item_rest`.
Collision: `col_Skid` 2.00 x 2.00 x 0.24 (steppable), `col_Cabinet`,
`col_Bench` (solid to the ground, R48: the walker is a line with three samples
0.75 m apart, so a 0.09 m slab at 0.92 m is missable), `col_Mast`.
No clips.
**Shadow LOD, measured** by `check_shadow_lod.py`: LOD1 52.80 mm (earns
cascades 1 and 2), LOD2 443.73 mm (earns none, and is a screen-distance tier by
construction: it drops the screen hood, which stands 0.46 m proud). Marginal
multiplier **2.0x**. `check_coplanar.py`: **zero** same-facing pairs.

### 4.27 Scanning antenna, `structures/scanning_antenna.glb` (TypeId 0x46). **Built 2026-08-14 (A6 / RN-1530..1549).**

Footprint **3.00 x 3.00 m**, height **6.00 m**. A guyed four-chord lattice
tower carrying a 2.10 m panelled parabolic reflector on an elevation trunnion,
with a feed horn on a quadripod at the focus. GP-533 minted the TypeId on
2026-08-13 and `Antennas.ts` drew `machines/power_pole.glb` until this landed.

**The four guy anchors own the bounding box, and that is why there are four.**
The `ground` pivot wants a centred AABB and ART-DIRECTION.md wants asymmetry;
four identical anchor blocks at four corners is not a compromise with the
validator, it is what a guyed mast is, and it buys everything else the freedom
to be lopsided. Blocks are 0.44 square at (+-1.28, +-1.28) so their outer faces
land on +-1.50 exactly; nothing else passes KEEP = 1.42. **Height is solved
backwards**: the topmost point is the reflector rim, `(DISH_R + DEPTH) *
sin(45)` above the vertex, so the trunnion sits at 5.0255. Both LOD sector
counts (16 and 8) put a vertex at exactly theta = 90 degrees, which is what
lets all three tiers share one `dims_xyz_m`.

**Key shapes.** Four anchor blocks with a Hazard capping course, a lug, a pin
and four holding-down bolts; a 0.94 m plinth with a kerb, a drain channel and a
Copper bonding stud. Tower from z 0.34 to 4.30, four continuous chords tapering
0.58 -> 0.31 across, ties at five levels, N-braced diagonals alternating up the
mast, a guy collar at 2.90, climbing rungs on one face with a fall-arrest rail,
and a feeder conduit clipped up one chord. Four guys, collar to anchor, each
with a turnbuckle low down. Head: a finned azimuth rotator, a two-arm yoke to
the trunnion, an elevation screw jack to a back rib, an obstruction light and a
Copper waveguide. **The reflector is a closed solid** (front skin, back skin,
outer rim, inner rim, 16 sectors x 3 rings) wound by `machine_form.oriented`
off the signed volume, with eight radial panel straps on the face, four heavy
ribs behind, a hub casting, a quadripod and a Copper feed horn. f/D 0.40, focal
0.840 m, depth 0.3281 m, elevation 45 degrees, aimed at -Y i.e. at whoever
placed it.

`station_form.antenna` exists and was refused: it is a mast box plus a fan of
eight **one-sided** triangles, correct for a 400 km hull silhouette and a hole
in the world from behind, since `OF_SteelLight` is backface culled.

**2,848 / 2,272 / 1,568 tris** (cap 3,200 / 7,400 total). Materials (8):
`OF_Steel`, `OF_SteelDark`, `OF_SteelLight`, `OF_Accent`, `OF_Hazard`,
`OF_Rubber`, `OF_Copper`, `OF_EmissiveState`. Nothing double sided.
Sockets: `socket_scan` (0.0, 5.6195, 0.494) on the boresight at the feed, role
`scan`; `socket_status` (-1.04, 1.00, 0.44), role `state_light`.
Collision: `col_Plinth`, `col_Mast`, `col_Cabinet`, `col_Anchor1..4` (named
without an underscore before the digit on purpose: `check-proxies.mjs`
catalogues the three.js `Name_<digits>` trap).
No clips, and that is a refusal: `Antennas.ts` never touches `AnimationMixer`,
so a rotating dish would be dead bytes plus a contract row that reads like a
feature. The elevation screw jack is the static version of the same statement.
**Shadow LOD, measured**: LOD1 55.73 mm (cascades 1 and 2), LOD2 108.00 mm
(cascade 2 - which is a coincidence and is relied on nowhere, since LOD2 drops
the reflector to 8 sectors and an 8-gon sits `r(1 - cos(180/8))` = 80 mm inside
a 16-gon). Marginal multiplier **2.0x**. `check_coplanar.py`: **zero**
same-facing pairs.

**One measured finding owed to the gameplay lane.** `Antennas.pick` is a 1.40 m
sphere 0.70 m up plus 0.50 m of slack. On a 6 m mast that is not satisfiable:
57.0 per cent of LOD0's vertices lie inside it and selection stops at z = 2.555
on the mast axis, so **the tower is selectable and the dish is not**. A level
crosshair at eye height 1.60 m scores 0.90 m at any range and meets the tower,
so this is invisible in play; the borrowed `power_pole.glb` had the identical
property at 4.0 m and nobody had measured it. Widening `ANTENNA_RADIUS_M` is a
gameplay change and was not taken by an art lane.

---

## 5. Repository layout

```
tools/blender/
  of_lib.py                 shared helpers: units, pivot and orientation convention,
                            the OF_ palette, MeshBuilder primitives, socket empties,
                            LOD helpers, clip authoring, pinned glTF export settings
  build_<asset>.py          one script per asset; build_belt_segment.py is the template
  harvest_common.py         organic geometry: seeded jitter, Parts.fit, lobe/blob/taper
  boulder_common.py         the four ore boulders: four forms, one break language
  tree_common.py            shared tree parts
  tool_common.py            the two hand tools
  rig_common.py             the player skeleton, shared by body and first-person arms
  props_common.py           Tier 1: blade/tuft/rock/chips/prism primitives and the
                            per-biome atlas driver (Prop, build_atlas)
  rocket_common.py          the TWO-CLASS stack contract (S 1.25 m, L 2.50 m),
                            every vessel part builder, and the deploy constants
                            the landed lander re-uses to bake the same pose
                            statically
  structure_common.py       the base-building module (CELL, DECK_H, WALL_H,
                            WALL_T, STOREY), the two placement anchors, the
                            shared deck/wall socket sets and the pillar recipe
  contracts.json            hand-authored per-asset acceptance contract
  validate_glb.py           stdlib-only automated checker
  check_mating.py           stdlib-only ASSEMBLY checker: places shipped parts
                            using only the sockets they publish and measures
                            every joint. A seam and a clash exist between parts,
                            never inside a file, so a per-file validator cannot
                            see either one
  render_check.py           imports a shipped .glb and renders clip frames
  render_structures.py      assembles the shipped structural .glb files into a
                            room and renders it: the tiling check a per-file
                            validator structurally cannot do
  render_vessel.py          the same idea for the vessel catalogue: a real
                            two-stage rocket and a contact sheet, placed off
                            socket_stack_top and socket_radial_out alone

assets/models/
  src/                      .blend files ONLY where a script cannot express the shape
                            (sculpted rock, hand-weighted character). Normally empty.
  dist/                     committed .glb output, the runtime load path
    player/  tools/  nodes/  items/  machines/  props/  rocket/  world/  structures/
```

**Naming.**

| Thing | Convention | Example |
|---|---|---|
| File | `snake_case.glb` under a group dir | `machines/belt_segment.glb` |
| Build script | `build_<file stem>.py` | `build_belt_segment.py` |
| Root node | `PascalCase` | `BeltSegment` |
| Render mesh | `<Root>_LOD0/1/2` | `BeltSegment_LOD1` |
| Tier-2 part group | `PascalCase` Empty holding one part's meshes, sockets and proxy | `TankSmall` |
| Tier-2 animated part | `<Part>_<Piece>` | `LandingLeg_Strut` |
| Harvest-node render mesh | `<Root>_<Variant>_LOD0/1/2` | `BoulderIron_Half_LOD1` |
| Harvest-node animated part | `<Root>_<Variant>_<Part>` | `WaterPool_Full_Water` |
| Tier-1 scatter prop | `<Biome>_<Prop>_LOD0/2` | `Forest_FallenLog_LOD0` |
| Tier-1 prop proxy | `col_<Biome>_<Prop>` | `col_Forest_FallenLog` |
| Animation pivot | `<role>_pivot` | `sway_pivot`, `ripple_pivot` |
| Collision proxy | `col_<Root>` | `col_BeltSegment` |
| Socket | `socket_snake_case` | `socket_belt_out` |
| Material | `OF_<PaletteRole>` | `OF_EmissiveState` |
| Clip | `<Subject>_<Action>` | `Belt_Scroll`, `Assembler_Arm_Cycle` |

---

## 6. The authoring pipeline

### 6.1 Why headless scripts

Blender 5.0.1 is installed at
`C:\Program Files\Blender Foundation\Blender 5.0\blender.exe`.

Assets are authored as **headless Python scripts**, not by hand in the GUI:

- **Deterministic.** The same script produces the same bytes on any machine.
- **Diffable.** A reviewer reads a 60-line script, not a binary `.blend`.
- **Re-runnable.** Change one palette value and rebuild all 42 files.
- **Agent-executable.** An agent can write, run and verify a script in one turn.

A Blender MCP would be an interactive fallback for shapes a script genuinely cannot
express (a sculpted hero rock, hand-weighted character skinning). **One is not
connected today, and it is not the pipeline.** Anything produced that way lands in
`assets/models/src/` as a `.blend` with a build script that imports and exports it, so
the dist path stays uniform.

### 6.2 The command an agent runs

Build one asset:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" --background --python tools/blender/build_belt_segment.py
```

Build everything, then gate it:

```bash
for f in tools/blender/build_*.py; do
  "/c/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --python "$f" || exit 1
done
python tools/blender/validate_glb.py --all
```

`validate_glb.py` exits non-zero on any failure, so it drops straight into CI as a
plain `python3` step with no Blender and no npm.

### 6.3 The three.js-facing export contract

Pinned in `of_lib.GLTF_SETTINGS`. Unknown keys are dropped with a printed warning
rather than crashing, so one script survives a Blender point release.

| Setting | Value | Why |
|---|---|---|
| `export_format` | `GLB` | one self-contained binary per asset |
| `export_yup` | **`True`** | **the flag**: Blender +Z up becomes glTF and three.js +Y up |
| `export_apply` | `True` | bake modifiers (decimate, mirror) so dist matches the script |
| `export_materials` | `EXPORT` | full metallic-roughness PBR |
| `export_extras` | `True` | `of_role` custom props reach `object.userData` |
| `dedupe_socket_names` | `False` (Tier 2 overrides) | a post-pass, not an exporter flag: strips Blender's `.001` uniquing suffix from **socket** nodes so thirteen parts can each publish `socket_stack_top` (section 2.6) |
| `export_animations` | `True` | |
| `export_animation_mode` | `ACTIONS` | one Blender Action becomes one named `AnimationClip` |
| `export_force_sampling` | `True` (override to `False`) | sampling is correct for rigs; plain object transforms override so a 2-key linear curve stays 2 keys |
| `export_cameras` / `export_lights` | `False` | the scene owns lighting, never the asset |
| `export_draco_mesh_compression_enable` | `False` | see below |
| `use_selection` | `False` | export the whole scene; the script controls what is in it |

Materials are backface-culled by default (`use_backface_culling = True`), which
exports as `doubleSided: false`. Only `Glass`, `Leaf`, `LeafDry` and `Water` are
exempt. This is roughly half the fragment work on a scene made of boxes.

**Compression decision: none at author time.** Assets run 150 to 3500 triangles and
about 25 KB each, so the whole Tier-0 payload is under 1.5 MB uncompressed. Draco costs
a roughly 200 KB WASM decoder plus a decode stall per asset, and it makes a `.glb`
opaque to inspection. That trade is clearly negative here. **Revisit at a 4 MB total
dist payload**, and when it flips, prefer meshopt (`gltfpack -cc`,
`EXT_meshopt_compression`) as a **bundle-time post-pass**, not an author-time setting:
it decodes an order of magnitude faster than Draco, and keeping it out of Blender means
`dist/` stays readable and diffable.

**KTX2: not applicable at Tier 0** (no textures). Policy from Tier 1 is in section 2.8.

### 6.4 How the conventions survive into three.js

| Authored as | Arrives as | Accessed by |
|---|---|---|
| Blender +Z up | three.js +Y up | automatic (`export_yup`) |
| Blender -Y forward | three.js +Z forward | `Object3D.lookAt()` directly |
| Metres | metres | scene scale 1.0, no unit conversion anywhere |
| Empty `socket_x` | childless `Object3D` named `socket_x` | `root.getObjectByName('socket_x')` |
| Custom prop `of_role` | `object.userData.of_role` | `export_extras` |
| Action `Belt_Scroll` | `AnimationClip` named `Belt_Scroll` | `AnimationClip.findByName(gltf.animations, 'Belt_Scroll')` |
| 60 fps authoring | clip seconds | `timeScale = referenceTicks / recipe.craftTimeTicks` |
| Material `OF_EmissiveState` | `MeshStandardMaterial.emissive` | recolour per `VisualState` |
| `<Name>_LOD0/1/2` | three sibling meshes | assembled into a `THREE.LOD` in code |
| `col_<Name>` | a mesh node | hidden by the loader, handed to physics |

The `MSFT_lod` extension is deliberately **not** used: three.js has no first-class
support for it, and building a `THREE.LOD` from three named children is five lines with
no extension dependency.

---

## 7. Validation

### 7.1 The contract

`tools/blender/contracts.json` holds one entry per asset. It is **hand-authored to
mirror this document and deliberately not generated from the build scripts**, because a
checker derived from the builder only ever proves the builder agrees with itself.

```json
"belt_segment": {
  "glb": "assets/models/dist/machines/belt_segment.glb",
  "type_id": "0x11",
  "lod0_node": "BeltSegment_LOD0",
  "lod_nodes": ["BeltSegment_LOD0", "BeltSegment_LOD1", "BeltSegment_LOD2"],
  "dims_xyz_m": [1.0, 0.30, 1.0],
  "tolerance_m": 0.005,
  "max_tris_lod0": 200,
  "max_tris_total": 420,
  "max_materials": 4,
  "sockets": ["socket_belt_in", "socket_belt_out", "socket_item", "socket_status"],
  "clips": ["Belt_Scroll"],
  "collision": "col_BeltSegment"
}
```

`dims_xyz_m` is written in **three.js axes** (X right, Y up, Z forward). A Blender
footprint of `X 1.0 by Y 1.0 flow by Z 0.30 tall` is therefore `[1.0, 0.30, 1.0]`.
Checking dimensions in three.js axes is exactly what proves `export_yup` fired: if the
up axis were wrong, the 0.30 would land on Z and the check would fail.

Optional keys: `max_tris_collision` (default 64), `double_sided_ok` (default
empty), and the four added on 2026-07-25 for the items atlas and the hand tools:

| Key | Default | Meaning |
|---|---|---|
| `pivot_mode` | `"ground"` | `ground` base on `y = 0` and centred on `x = z = 0`; `centre` origin at the volumetric centre (dropped items); `grip` origin at the grip point, asserted through `socket_grip` (hand tools); `none` a view model hung off the camera point |
| `pivot_tolerance_m` | `tolerance_m` | separate slack for the pivot check, because an organic character's mesh centroid is not its ground pivot |
| `grip_socket` | `"socket_grip"` | which socket `pivot_mode: "grip"` asserts against |
| `parts` | none | `[{node, dims_xyz_m, max_tris, pivot}]`, one entry per sibling mesh in a multi-mesh file |

Two more were added on 2026-07-25 for the Tier-1 biome atlases, where a file holds
several independent props rather than one asset:

| Key | Default | Meaning |
|---|---|---|
| `parts[].pivot` | `"centre"` | per-part pivot rule: `ground`, `centre` or `none`. **This is the real gate on Tier 1**: all 41 scatter props must be ground-pivoted, because a scatter placement matrix is only pure terrain data if there is no per-prop offset to subtract back out, and a single `lod0_node` check would prove that for one prop out of forty-one. The older boolean `parts[].centred` still means `centre`, so the items atlas is untouched |
| `collision` | none | now accepts a **list** as well as a string. An atlas declares the subset of its props that are genuinely solid (section 2.5), and the checker requires every named proxy. `max_tris_collision` is set per file rather than left at 64, because N boxes cost 12N triangles |

Five more were added the same day for the two rigged assets. A rig can pass
every geometric check above and still be broken in ways that are invisible in a
static render, so each of these exists for a specific failure that has actually
happened:

| Key | Proves |
|---|---|
| `bones` | the declared bone set is present as nodes AND in the skin's joint list, with no undeclared joints. The bone names are as load-bearing as a socket name: a retarget map binds to them |
| (implicit, when the file has a skin) | every vertex of every skinned mesh carries unit weight. An unweighted vertex is pinned to joint 0 forever and renders as a shard left behind when the character moves. This is exactly what bone-heat automatic weights produced |
| `bone_sockets` | `{socket: bone}`; the socket's parent node is that BONE, not the armature. A socket parented to the armature validates, exports and does not ride the hand |
| `rest_pose` | `world(joint) * inverseBindMatrix == identity` for every joint: the exported static pose IS the bind pose |
| `frame1_identity` | the first sample of every non-joint animation channel equals the node's own TRS, which is section 2.7's rule made machine-checkable |
| (implicit, when the file has animations) | `anim_t0`: the first sampler input of every clip is **exactly** `0.0` s. Exact, not a tolerance: the exporter writes `frame/fps` into a float32, so Blender frame 0 is 0.0 with no rounding, and a tolerance would only be somewhere for a one-frame offset to hide (DW-34) |

One more was added on 2026-07-25 for Tier 2, and it is the gate on the stack
contract:

| Key | Default | Meaning |
|---|---|---|
| `part_sockets` | none | `{part_group: {socket_name: [x, y, z]}}` in three.js axes. Each socket must be a **descendant of its own part group** and must land on the declared point. `rocket_parts.glb` holds thirteen nodes called `socket_stack_top`, so the flat `sockets` list proves only that one of them exists; what the engine binds to is "this part's stack top is at this height on the stack axis", and that is what this asserts. It caught the Blender name-uniquing collision described in section 2.6 on its first run |

### 7.2 What the checker proves

`python tools/blender/validate_glb.py --all`. Stdlib only, no Blender, no npm.

| Check | Proves |
|---|---|
| `container` | valid GLB2, header length matches, geometry embedded in a BIN chunk |
| `scale` | world AABB of the LOD0 subtree matches the spec in metres, within tolerance |
| (implicit) | **the up axis**, since the height must land on Y |
| `pivot` | LOD0 base sits on `y = 0` and is centred on `x = z = 0`, so grid snapping works |
| `tris_lod0` | LOD0 triangle budget |
| `tris_total` | whole-file render budget, **excluding** `col_*` proxies |
| `tris_col` | collision proxy stays a proxy |
| `lods` | every declared LOD node exists |
| `materials` | count within budget and every name is an `OF_` palette role |
| `sockets` | every required `socket_*` node is present |
| `clips` | the animation clip name set matches **exactly** (no extras, none missing) |
| `collision` | every declared `col_<Name>` present (a string, or a list for an atlas) |
| `hygiene` | no cameras, no lights, no Draco |
| `culling` | nothing is `doubleSided` except roles that need it |
| `parts` | every sibling mesh of a multi-mesh file, individually: bounds, tri budget **and its own pivot rule**. This is what proves all 41 Tier-1 scatter props sit on their ground contact point |
| `part_sockets` | every Tier-2 part's own sockets: present, under that part, and on the declared point. The stack contract, made machine-checkable |
| `bones` / `skin_weights` / `bone_sockets` / `rest_pose` / `frame1_identity` | the rig, see the table above |

**What the checker still cannot prove: that a rigged asset deforms well.**
Weights are numbers and deformation is a picture. `tools/blender/render_check.py`
closes that gap: it imports a shipped `.glb` and renders named clip frames to
`docs/screenshots/`, so the thing judged is what is actually in `dist/`. It
renders what the RUNTIME renders (one LOD band, the `_Full` variant, no `col_*`
proxy), because a `.glb` holds every band as siblings and drawing LOD0, LOD1
and LOD2 on top of each other z-fights in a way that reads exactly like broken
geometry on a small detail such as a hand.

The bounding box is computed properly: the node hierarchy is walked, each node's TRS or
matrix is composed, and the eight corners of each POSITION accessor's `min`/`max` are
transformed into world space. That is why the scale and pivot checks catch real bugs
instead of just reading numbers back out of the file.

### 7.3 What a per-file validator cannot see: `check_mating.py`

`python tools/blender/check_mating.py [vessel | structure | coaxial]`. Stdlib
only, no Blender, no npm. It reads the **shipped** `.glb` files, places parts
using **only the sockets those files publish**, and measures the result. Nothing
is imported from `rocket_common.py` or `structure_common.py` and no dimension is
retyped from this document, which is the point: a check driven from the source
constants only ever proves the builder agrees with itself.

| Pass | Proves |
|---|---|
| `vessel` | both class chains assemble with `+0.000000000 m` at every joint; exactly two distinct diameters exist; the decoupler mates on BOTH faces in both classes; `StackAdapter` presents class L below and class S above; the radial standoff resolves to the published 0.30 m hull to hull; mated sockets are anti-parallel by dot product |
| `structure` | the module read back off the sockets; decks and walls tile with zero gap; four walls close on the right clear interior; the wall reaches its deck and its head is the next deck base; the floor doubles as the ceiling; door and wall envelopes identical to 1e-9; the pillar recipe closes exactly at four gap heights |
| `coaxial` | see 7.4 |

### 7.4 The scallop check, and why it exists

**The bug class.** Two coaxial round surfaces built with different segment
counts do not have the same surface even at the same radius. A 16-gon and a
24-gon of circumradius 0.625 have inradii 0.6011 and 0.6146, so between those
radii each one pokes through the other at alternating azimuths and the joint
renders as a sawtooth ring.

**It passes every other check in this document**, which is exactly why it needs
its own. The bounding box is set by the circumradius, so `scale` is exact. The
mating plane is unaffected, so `part_sockets` and every gap in 7.3 read
`+0.000000000`. The defect is in the mating SURFACE, and until 2026-07-26 the
only thing that could see it was a person looking at a render. It bit **three
times in one file on the day the two-class catalogue was built** (the stack
adapter's cone against its own class S collar, the monopropellant tank's 12-gon
flanges against its 16-gon bowls, and a class L engine bell left on the module
default 16), and a fourth time in an asset that had shipped a day earlier: the
player body's 8-gon elbow band, whose inradius of 0.0628 let the 10-gon arm
inside it poke through by 0.6 mm.

**How it is detected**, on the shipped bytes and with no help from the builder.
Positions are deduplicated (flat shading splits a vertex per face, so raw
indices do not describe adjacency), triangles are unioned into connected
components, and each component is tested for being a solid of revolution about
one of the three principal axes: every cross section must be a ring of at least
six vertices at one radius with uniform azimuth spacing. Two revolution
components on the SAME axis with DIFFERENT segment counts must then nest, one
entirely inside the other's inradius across their shared span. Radii are
piecewise linear in the axial coordinate, so evaluating the two containment
inequalities at every ring plane inside the overlap decides it exactly.

**It has no false positives by construction.** A slab, a fin, a window frame and
a stringer are not rings, so they are never compared, and a stringer standing
proud of a barrel is intended detail rather than a defect.

**A SKIP IS NOT A PASS, and the check says so out loud.** Some round surfaces
cannot be tested by this method at all: an open shell puts two radii in one
axial plane, and an arc sweep is not uniform over 2 pi, so neither meets the
precondition. Printing only "0 conflicts" would read as full coverage and would
not be, which is exactly the failure mode the pass exists to close. So every
run prints the unexamined set, counted and named by reason, next to the
conflict count. Each plane is classified by a POSITIVE test (is it a ring, an
annulus, an arc?) rather than by inferring a reason from a failed one: the first
version inferred "shell" from the single-ring test failing and labelled every
box that happened to put six corners in one plane as an unexamined round
surface, which reported 203 skips instead of the true 4 and made the coverage
number worthless in the other direction.

Current state: **47 assets, 255 render meshes, 0 conflicts, 4 round components
not examined** (`rocket_parts/DockingPort_LOD0` and
`rocket_parts/EngineVacuumSmall_LOD0` are shells, `player_body/Player_LOD0` and
`vfx_engine_plume/EnginePlume_LOD0` change segment count along their own axis).
Those four are made safe by construction instead: every round surface on them is
built at its own class segment count, which costs a few triangles and removes
the question.

**The check has demonstrated it can fail**, which per DW-20 is the difference
between a green result and a green light. Run against the pre-fix
`player_body.glb` out of git it reports the 10-gon arm against the 8-gon elbow
band over `x -0.475..-0.425`; run against the shipped one it reports nothing.
Since every real defect it found is now fixed, nothing in `dist` can exercise it
any more, so `check_mating.py` also carries a `selftest` that asserts the
nesting arithmetic on the three real bad geometries from 2026-07-26 and on two
legal ones that must not fire.

### 7.5 It already earned its keep

On the very first asset the checker failed the belt segment:

```
[XX] scale   [1.0, 0.3, 1.01] m (want [1.0, 0.30, 1.0], +/-0.005)
```

The end rollers (radius 0.055, centred at `y = +/-0.45`) protruded 10 mm past the 1 m
cell on each end, which would have z-fought the neighbouring belt tile on the grid. The
roller is now positioned at `L/2 - ROLLER_R`, tangent to the cell edge by construction.
That class of bug is invisible in a render and obvious in a factory, which is exactly
the case for automating the check.

### 7.6 `check_belt_cargo.py`, the third checker, and why it exists

**Added 2026-07-27 (W11 lane A).** Stdlib-only, reads the shipped `.glb` bytes,
no Blender. It asserts the section 4.13.1 contract:

1. every `Item_*` node's local **Z extent is <= 0.250 m**, the saturated pitch;
2. every `Item_*` node has exactly one `socket_rest` child and it sits at that
   item's own measured minimum Y;
3. each belt tile's three path sockets exist, share one Y, and are either
   collinear or lie on a common circle, with the fitted radius and centre
   reported and checked against 0.5 and the tile corner;
4. the path stays inside the tile footprint and above the deck;
5. item X extent against the measured deck width, so an item overhanging the
   belt edge is a printed number rather than a surprise.

**Per DW-20 it demonstrates it can fail.** `check_belt_cargo.py selftest` runs
**19 cases, 11 that must fire and 8 that must not**, including an item 0.2501 m
deep, a `socket_rest` left on the pivot, a path bowed 50 mm, an r = 0.31 arc, an
r = 0.5 arc on the wrong centre, and a collinear path whose midpoint falls
outside its own segment.

This is the same principle as 7.4: **when a render catches something twice, the
third time should be a check, and it belongs wherever the information actually
lives**, which for a game that loads `.glb` files is the shipped bytes and not
the builder.

### 7.7 `contact_sheet.py`, because renders that are not looked at are not a check

**Added 2026-07-27.** `render_check.py` writes one 420 x 540 PNG per shot and a
character pass is thirty of them. Nobody opens thirty files, which quietly turns
a visual review into an artefact. This tiles them into one labelled sheet, with
each caption taken from the input FILENAME, because `render_check.py` already
encodes clip and frame there.

**Stdlib only, and that is the point.** Pillow is installed in neither the
system python nor Blender's, and sections 7.1 to 7.6 already establish that a
gate here runs as a plain `python3` step with no environment. So the PNG codec
is written out: `zlib` does the hard part and the rest is the five scanline
filters and a CRC. Scope is stated rather than discovered (8-bit
non-interlaced grey, RGB and RGBA, which is everything Cycles emits) and
anything else **raises rather than guessing**. `contact_sheet.py selftest`
proves the round trip, proves all five scanline filters decode identically, and
proves a 16-bit PNG and a non-PNG are both REFUSED rather than silently
misread.

It earned its keep the day it shipped: tiling the eight first-person "before"
renders side by side is what showed that the on-screen hands were not merely too
big but were **one unbroken white shape**, with every piece of colour separation
the asset already had sitting up the sleeve and out of frame. No single render
says that. It then caught two empty frames in the new first-person jump and
swing clips, which is the failure section 4.2 already had a scar from.

---

## 8. Build order

1. **Belt segment.** Done. It is the template.
2. **Remaining machines** (12 files): miner, smelter, assembler, box, generator, power
   pole, inserter, primitive furnace, survival smelter, belt curves, end cap. These plus
   the belt unblock the whole factory loop. **Done 2026-07-25.**
3. **Harvest nodes** (9 files). **Done 2026-07-25**, all seven `NodeKind`
   values covered. Then the **items atlas**, which unblocks hand-craft.
   **Done 2026-07-25.**
4. **Tools** (2 files). Unblocks tool-assisted harvest. **Done 2026-07-25.**
5. **Player body and first-person arms.** Last of Tier 0 because they are the only
   assets needing a rig, and everything else can be tested with a capsule.
   **Done 2026-07-25. Tier 0 is complete at 27/27 green.**
6. **Tier 1 biome atlases** (10 files, 41 props). **Done 2026-07-25. 37/37
   green, and a full rebuild of all 37 produces a zero-byte diff.**
7. **Tier 2, space** (5 files, 18 parts). **Done 2026-07-25.** Built in
   dependency order, because every other space asset composes from the first:
   `rocket_parts.glb` (the 1.25 m stack contract), then `launch_pad.glb`, then
   `lander_landed.glb` (an assembly of the parts, so it had to come after
   them), then `body_sphere_lod.glb` and `vfx_engine_plume.glb`.
   **The art manifest is complete: 42/42 green, and a full rebuild of all 42
   produces a zero-byte diff.**
8. **Base building** (4 files). **Done 2026-07-26.** Added after the manifest,
   on Reid's direct request, so it is the one Tier-0 group with no header
   referent (decision BT-9). Built as a set rather than four assets, because a
   tiling set is only correct as a whole: `structure_common.py` first, then the
   two decks, then the wall, then the door on the wall's envelope.
   **46/46 green, and a full rebuild of all 46 produces a zero-byte diff.**
9. **DW-29 vessel catalogue and DW-32 rescale** (2 files rewritten, 4 rescaled,
   1 new). **Done 2026-07-26**, decisions BT-11 (the 4 m module and the pillar),
   BT-12 (the two-class catalogue) and BT-13 (the scallop check). The contracts
   in `contracts.json` were written FIRST, before any geometry, precisely
   because section 7.1 says a checker derived from the builder only proves the
   builder agrees with itself; the two build jobs were then run against a spec
   they could not edit. **47/47 green, all joints exact under `check_mating.py`,
   and a full rebuild of all 47 scripts produces a zero-byte diff.**

Steps 2 to 4 are 23 files of pure primitive assembly with no rigging and no organic
sculpting. They parallelise cleanly across agents: one script per asset, one contract
entry per asset, and the validator is the merge gate.

**What Tier 2 does not include, and deliberately so.** Dry mass, thrust,
specific impulse and fuel capacity are physics-domain numbers, not art ones;
this document publishes the geometry each part occupies and the points it mates
on, and nothing about what it weighs. A deployed parachute canopy is cloth,
which is a shader-and-simulation problem rather than a static mesh, so only the
canister is authored. The plume's shader is the rendering domain's, and the
assumptions its geometry makes are tabulated in section 3.3 so that the two
halves can be written independently and still meet.

---

## 9. Open questions for Admin

1. ~~**Rig sourcing.**~~ **Closed 2026-07-25.** Decision DW-7 said to try headless
   automatic weights first and escalate to a `.blend` only if the deformation
   was visibly bad. Automatic weights were tried and **failed** (144 of 698
   vertices came back unweighted, silently), and the escalation was **not**
   needed: `of_lib.solve_weights` skins the character from bone-segment
   distance inside a per-part whitelist, every vertex carries unit weight, and
   the visual check is clean. `assets/models/src/` stays empty and the whole
   pipeline stays script-authored. See section 4.1.
2. **Belt animation strategy at scale.** Section 4.12 specifies both a baked clip and a
   runtime instanced-material scroll. The instanced path is the one that scales, but it
   belongs to the rendering domain. Confirm rendering owns it so this document does not
   over-specify their side.
3. **Inserter as a player-facing buildable.** `FactorySim` has inserters but
   `automation.h`'s `BuildKind` does not, so today they are auto-placed by the wiring
   layer. If gameplay intends inserters to become a selectable buildable, they need an
   item id and a `TypeId`, which is a gameplay decision, not an art one.
4. **The structural set has no header referent (opened 2026-07-26).** The four
   base-building parts were built on Reid's direct request, ahead of any sim
   support: `automation.h`'s `BuildKind` has no `Foundation`/`Wall`/`Floor`/`Door`,
   `gameplay.h` has no structural items and there are no `TypeId`s. The art is the
   easy half. Before a player can place one, **factory-sim** needs the `BuildKind`
   values and `TypeId`s, **gameplay** needs item ids and recipes, and
   **physics/world-gen** needs to say whether a foundation deforms terrain or just
   sits on it. Art has published the geometry and the anchors and nothing about
   cost, health or terrain interaction. Section 4.23 is the contract those lanes
   should code against. **Terrain interaction was since answered by DW-24**: a
   structure rests on terrain and never deforms it. Cost is still open, and the
   4 m rescale makes it urgent: one foundation now covers sixteen times the
   ground it did, so an unchanged price divides the cost of a base by 16.
5. **The 4 m rescale needs a client pass, and one number in it is not cosmetic
   (opened 2026-07-26, BT-11).** `StructureGrid.measureModule` reads the module
   off the shipped sockets, so most of the client follows the rescale for free.
   Four things do not: the pre-load module fallback in `Structures.ts`,
   `FLOAT_TOLERANCE_M`, `SITE_REACH_M` and the placement `REACH_M`. The
   tolerance is the one that matters. It was set at 0.55 m against a **1 m**
   footprint whose worst measured corner spread on a slope was 0.127 m; the same
   slope over a **4 m** footprint spreads roughly four times as far, which alone
   consumes the whole allowance and would make ordinary sloped ground
   unbuildable, closing off DW-24's own teaching loop. It has to be re-measured
   with `probes/buildtol.js` at the new footprint rather than scaled on paper.
   Full list in `docs/controllers/build-tooling.md`. Not an art call and not an
   art file.
6. **`StackAdapter` is not in the DW-29 part list (opened 2026-07-26, BT-12).**
   It is the geometric consequence of DW-29's "two sizes" being two diameters:
   without it a wide first stage and a narrow payload have no legal joint, and
   the two classes are two disjoint catalogues. Needs reconciling with
   `core/include/of/vessel.h`, which is being written against the same list.
