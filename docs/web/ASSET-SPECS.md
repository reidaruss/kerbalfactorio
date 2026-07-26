# Orbital Foundry: 3D Asset Specs and Blender Authoring Pipeline

**Owner:** ART-PIPELINE agent. **Date:** 2026-07-25. **Status:** **THE ART
MANIFEST IS COMPLETE.** Tiers 0, 1 and 2 are all built: 42 of 42 files green
under `validate_glb.py --all`, and a full rebuild of every `build_*.py`
produces a **zero-byte diff**, so the pipeline is proven deterministic end to
end.

| Tier | Files | Meshes | Payload |
|---|---|---|---|
| 0: the playable loop | 27 | 40 base (83 counting depletion variants) | 1.8 MB |
| 1: biome scatter props | 10 | 41 props, 78 render meshes with LOD2 | 367 KB |
| 2: space | 5 | 18 parts, 28 render meshes | 372 KB |
| **Total `dist/`** | **42** | | **2.43 MB** |

Tier 0 is 13 machines, 9 harvest nodes, the items atlas, 2 tools, the rigged
player body and the first-person arms. Tier 1 is one scatter atlas per biome.
Tier 2 is the 13 rocket parts, the launch pad, the landed lander, the far-scene
body sphere and the engine plume shell.

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

- **No image textures in Tier 0.** Flat base colour plus metallic/roughness
  constants. Files stay tiny, there is no UV work, no KTX2 step, and no texture
  memory budget to police.
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

### 2.8 Texture policy (Tier 1 onward)

Tier 0 ships without UVs at all. **Tier 1 shipped the same way**: 41 scatter props,
zero textures, 367 KB. The one place a texture looked mandatory was alpha-tested
foliage cards, and that turned out to be cheaper as geometry (section 3.2). So the
threshold below is still unmet and the KTX2 step is still deferred.

**Tier 2 adds UVs to exactly one asset and still no textures.**
`vfx_engine_plume.glb` carries a UV set because a plume with no length
parameter cannot be shaded at all, not because it has an image: V is the
shader's distance-down-the-plume input. `MeshBuilder` takes an optional
per-vertex `uvs` list and writes a UV layer **only** when one is supplied, so
the other 41 files still export with no `TEXCOORD_0` accessor. Total texture
payload is still zero bytes.

When a texture is genuinely needed:

- **Texel density:** 512 px/m for hand-held and first-person assets, 256 px/m for
  machines, 128 px/m for terrain props. Maximum 1024 x 1024 per asset.
- **Channels:** albedo, and an ORM pack (occlusion / roughness / metallic) only if
  the flat constant is not enough. Normal maps are a last resort at this poly count.
- **Encoding:** KTX2 via `gltf-transform`, ETC1S for albedo and UASTC for ORM/normal,
  loaded with three.js `KTX2Loader`. Do **not** add this step until the total
  texture payload crosses 1 MB, because the transcoder itself costs more than that.

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
| 8 | Stone boulder | `nodes/boulder_stone.glb` | `Rock` | 1.4 x 1.2 x 0.9 | 200 | 3 | none |
| 9 | Iron boulder | `nodes/boulder_iron.glb` | `IronOre` | 1.6 x 1.4 x 1.1 | 220 | 3 | none |
| 10 | Copper boulder | `nodes/boulder_copper.glb` | `CopperOre` | 1.5 x 1.3 x 1.0 | 220 | 3 | none |
| 11 | Coal seam boulder | `nodes/boulder_coal.glb` | `CoalSeam` | 1.7 x 1.4 x 1.0 | 240 | 3 | none |
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
| 20 | Assembler | `machines/assembler.glb` | 0x13 | **3 x 3** | 2.8 | 1100 | arm cycle |
| 21 | Box | `machines/box.glb` | 0x14 | **1 x 1** | 1.0 | 300 | lid |
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
| `props/props_hills.glb` | `Hills` | `Hills_LargeBoulder`, `Hills_ScreePatch`, `Hills_Shrub` | 430 | 4 | 39 |
| `props/props_mountains.glb` | `Mountains` | `Mtn_RockSpire`, `Mtn_TalusChunk`, `Mtn_SnowPatch` | 254 | 3 | 26 |
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
| `Beach_Rock`, `Beach_Driftwood`, `Plains_PebbleB`, `Forest_DeadTree`, `Forest_FallenLog`, `Forest_Rock`, `Hills_LargeBoulder`, `Mtn_RockSpire`, `Mtn_TalusChunk`, `Polar_IceShard`, `Polar_IceBoulder`, `Ocean_SeabedRock`, `Moon_RockLarge`, `Moon_HighlandOutcrop`, `Moon_CraterRimRock`, `Cave_Stalagmite`, `Cave_CrystalCluster`, `Cave_SupportFrame` | all grass, flowers, ferns, kelp, both shrubs, shells, mushrooms, scree, rubble, snow patch, snow drift, regolith ripple, impact glass, small pebbles, the ore vein panel, and every detail card |

`col_Forest_DeadTree` is the **trunk box only** (0.50 x 0.50 x 4.20), the same rule the
conifer follows: a player walks through where the branches were.

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
| `rocket/rocket_parts.glb` | 13 parts, 15 meshes | 3264 | 7 | 151 |
| `rocket/launch_pad.glb` | pad + clamp, 6 meshes | 1000 | 6 | 65 |
| `rocket/lander_landed.glb` | 1 assembly, 3 meshes | 2580 | 7 | 119 |
| `rocket/vfx_engine_plume.glb` | 1 mesh | 142 | 1 | 5 |
| `world/body_sphere_lod.glb` | 1 sphere, 3 meshes | 1680 | 1 | 32 |

#### The stack contract

This is what the engine binds to, and everything else in Tier 2 composes out of
it. It lives in code in `tools/blender/rocket_common.py` and is checked per
part by `contracts.json`'s `part_sockets` block.

| Rule | Value |
|---|---|
| Stack diameter | **1.25 m exactly** (R = 0.625), on every stack part |
| Stack axis | Blender **+Z**, which is three.js **+Y**: a vessel assembles up the world up axis and needs no rotation to stand on a pad |
| Stack part origin | its **bottom mating plane**, centred on the axis: `pivot_mode: "ground"`, the same rule a machine obeys |
| `socket_stack_bottom` | always local `(0, 0, 0)`, facing three.js **-Y** (down, away from the part) |
| `socket_stack_top` | local `(0, H, 0)` in three.js axes, facing **+Y** (up, away from the part) |
| To stack B on A | `B.position = A.position + A.socket_stack_top.position`. No per-part offset table exists anywhere |
| Mating test | two mated sockets are **anti-parallel**, so "do these faces mate" is a dot product rather than a naming convention |
| Terminators | an **engine** has no `socket_stack_bottom` and a **nose cone** has no `socket_stack_top`: they end a stack |
| Radial parts | origin on the **mount plane**, body extending three.js **+X**. Attach with `position = (R cos a, y, R sin a)` and `rotateY(-a)`; `pivot_mode: "none"`, because neither `ground` nor `centre` describes a part whose origin is on its own side face |

**Why 16 segments.** A polygon whose segment count is divisible by 4 puts
vertices exactly on ±X and ±Y, so a 16-gon of radius 0.625 measures exactly
1.25 x 1.25. A 14-gon of the same radius measures 1.250 x 1.244 and misses the
dimension check by 6 mm. The cargo bay proved it on the first build: hinge rods
at 0.585 with a 0.05 radius pushed the box to 1.27.

Barrels are built at **0.600** and the collars at **0.625**, so the mating
diameter is carried by the rings and a stringer standing proud of the barrel
can never touch the bounding box.

#### The 13 parts

Dimensions are three.js axes (X right, Y up, Z forward), metres.

| Part | Dims | Tris | Pivot | Sockets |
|---|---|---|---|---|
| `CommandPod` | 1.25 x 2.50 x 1.25 | 392 | ground | stack top/bottom, `socket_hatch` |
| `TankSmall` | 1.25 x 2.00 x 1.25 | 288 | ground | stack top/bottom |
| `TankLarge` | 1.25 x 4.00 x 1.25 | 348 | ground | stack top/bottom |
| `EngineMain` | 1.25 x 1.60 x 1.25 | 512 | ground | stack top, `socket_muzzle` |
| `Decoupler` | 1.25 x 0.25 x 1.25 | 312 | ground | stack top/bottom |
| `NoseCone` | 1.25 x 1.20 x 1.25 | 360 | ground | stack bottom |
| `Parachute` | 1.25 x 0.75 x 1.25 | 288 | ground | stack top/bottom, `socket_chute` |
| `CargoBay` | 1.25 x 1.60 x 1.25 | 284 | ground | stack top/bottom |
| `EngineVernier` | 0.36 x 0.43 x 0.28 | 96 | none | radial mount, `socket_muzzle` |
| `Fin` | 0.85 x 1.10 x 0.10 | 24 | none | radial mount |
| `RcsBlock` | 0.245 x 0.50 x 0.50 | 136 | none | radial mount |
| `LandingLeg` | 0.20 x 0.42 x 0.34 yoke + 0.43 x 2.56 x 0.48 strut | 24 + 92 | none | radial mount, `socket_leg_foot` |
| `SolarPanel` | 0.18 x 0.30 x 0.44 mount + 0.065 x 1.26 x 0.56 array | 24 + 84 | none | radial mount |

They land at 24 to 512 triangles against the "300 to 1400 each" this section
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

Three proxies, not one: `col_LaunchPad` (the deck), `col_LaunchTower` and
`col_LaunchClamp`. A single convex box cannot describe a slab with a 12 m mast
on one corner.

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
| `Walk` | 1 to 33 | yes | 1.4 m/s, stride 0.75 m |
| `Run` | 1 to 25 | yes | 4.5 m/s, stride 1.35 m |
| `Jump_Start` | 1 to 13 | no | crouch and launch |
| `Jump_Loop` | 1 to 21 | yes | airborne |
| `Jump_Land` | 1 to 17 | no | absorb |
| `Fall` | 1 to 21 | yes | long fall, arms out |
| `Swing_Pickaxe` | 1 to 33 | no | impact on frame 17 |
| `Swing_Axe` | 1 to 35 | no | impact on frame 18 |
| `Dig` | 1 to 31 | no | voxel mining, impact on frame 16 |
| `Place` | 1 to 25 | no | build placement |
| `Craft` | 1 to 61 | yes | hand-craft loop |
| `Crouch_Idle` | 1 to 91 | yes | |
| `Crouch_Walk` | 1 to 37 | yes | 0.7 m/s |

Impact frames are contract: gameplay fires `harvestNode()` on those frames, so moving
one desynchronises feel from logic.

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
`FP_Swing_Pickaxe` 1 to 33 (impact 17), `FP_Swing_Axe` 1 to 35 (impact 18), `FP_Dig`
1 to 31 (impact 16), `FP_Place` 1 to 25, `FP_Craft` 1 to 61. Impact frames match the
third-person clips exactly.

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
| `boulder_stone.glb` | 1.4 x 1.2 x 0.9 | none (Rock + RockDark only) | 200 |
| `boulder_iron.glb` | 1.6 x 1.4 x 1.1 | `OF_Iron` | 220 |
| `boulder_copper.glb` | 1.5 x 1.3 x 1.0 | `OF_Copper` | 220 |
| `boulder_coal.glb` | 1.7 x 1.4 x 1.0 | `OF_Coal` | 240 |

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

Footprint **1 x 1 m**, height 1.0 m. A ribbed steel crate with a hinged lid, corner
posts, and a narrow fill-level bar on the front face.

300 / 140 / 40 tris. Materials (4): `OF_Steel`, `OF_SteelDark`, `OF_Accent`,
`OF_EmissiveState` (the fill bar; it uses the standard four state colours, and its
*length* is driven from the buffer level).
Sockets: `socket_item_in` (0, +0.5, 0.6), `socket_item_out` (0, -0.5, 0.6),
`socket_status` (0, -0.5, 0.8).
Collision: `col_Box`, box 1.0 x 1.0 x 1.0.
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

---

## 5. Repository layout

```
tools/blender/
  of_lib.py                 shared helpers: units, pivot and orientation convention,
                            the OF_ palette, MeshBuilder primitives, socket empties,
                            LOD helpers, clip authoring, pinned glTF export settings
  build_<asset>.py          one script per asset; build_belt_segment.py is the template
  harvest_common.py         organic geometry: seeded jitter, Parts.fit, lobe/blob/taper
  boulder_common.py         the four ore boulders: one form, four dressings
  tree_common.py            shared tree parts
  tool_common.py            the two hand tools
  rig_common.py             the player skeleton, shared by body and first-person arms
  props_common.py           Tier 1: blade/tuft/rock/chips/prism primitives and the
                            per-biome atlas driver (Prop, build_atlas)
  rocket_common.py          Tier 2: the 1.25 m stack contract, the 13 part
                            builders, and the deploy constants the landed
                            lander re-uses to bake the same pose statically
  contracts.json            hand-authored per-asset acceptance contract
  validate_glb.py           stdlib-only automated checker
  render_check.py           imports a shipped .glb and renders clip frames

assets/models/
  src/                      .blend files ONLY where a script cannot express the shape
                            (sculpted rock, hand-weighted character). Normally empty.
  dist/                     committed .glb output, the runtime load path
    player/  tools/  nodes/  items/  machines/  props/  rocket/  world/
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

### 7.3 It already earned its keep

On the very first asset the checker failed the belt segment:

```
[XX] scale   [1.0, 0.3, 1.01] m (want [1.0, 0.30, 1.0], +/-0.005)
```

The end rollers (radius 0.055, centred at `y = +/-0.45`) protruded 10 mm past the 1 m
cell on each end, which would have z-fought the neighbouring belt tile on the grid. The
roller is now positioned at `L/2 - ROLLER_R`, tangent to the cell edge by construction.
That class of bug is invisible in a render and obvious in a factory, which is exactly
the case for automating the check.

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
