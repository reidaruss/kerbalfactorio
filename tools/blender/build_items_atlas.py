"""build_items_atlas.py - the fifteen dropped-item props, one file.

    blender --background --python tools/blender/build_items_atlas.py

Produces assets/models/dist/items/items_atlas.glb (ASSET-SPECS 3.1 / 4.11).

FOUR THINGS MAKE THIS FILE DIFFERENT FROM EVERY OTHER ASSET.

1. ORIGIN AT THE VOLUMETRIC CENTRE, not at the base. An item tumbles when it is
   dropped and rides centred on a belt, so its pivot is its middle. Parts.fit()
   with base_z = -h/2 centres all three axes exactly, which is also what makes
   the dimension check in contracts.json exact to the millimetre.

2. EVERY MESH SITS AT THE ORIGIN, overlapping. There is no atlas layout, because
   a layout offset would ride along on the node transform and every consumer
   would have to subtract it back out. The renderer picks one item by name
   (root.getObjectByName('Item_Log')) and clones it; the meshes are never all
   visible at once, so overlap costs nothing.

3. NO LODs, no collision, no clips. The sim stops emitting discrete items above
   Lod::Near0 (factory_sim.h), so items simply vanish rather than degrade, and
   the ground drop uses a code-generated sphere.

4. EVERY ITEM CARRIES A CHILD socket_rest, at its own lowest point on its
   vertical axis, i.e. local (0, -halfY, 0) in three.js axes. Rule 1 is what
   makes this necessary: an item riding a belt RESTS on it, but its origin is
   its middle, so without socket_rest every consumer would need a per-item half
   height table. Placing an item on a belt is instead one subtraction:

       item.position = beltPathPoint - clone.getObjectByName('socket_rest').position

   Note CLONE. Blender object names are unique per FILE, so fifteen sockets
   called socket_rest become socket_rest .. socket_rest.014 and the contract
   evaporates; of_lib.export_glb(dedupe_socket_names=True) strips the suffix at
   export time, exactly as rocket_parts.glb does for its thirteen
   socket_stack_top nodes. Duplicate glTF node names are legal, so the lookup
   MUST be scoped to the cloned item node and never done at the file root.

TWO CONSTRAINTS SET THE SHAPES.

The old one is legibility at 64 px in an inventory icon: if the iron ingot and
the copper ingot are not instantly distinguishable, the material contrast is
wrong, not the mesh.

The new one is legibility at 3 to 5 m on a MOVING BELT, which is a different
job, and it is why the four raw chunks were rebuilt. They were four copies of
one faceted lobe separated by tint alone, and tint is the first thing you lose
on a small object crossing a lit deck at 1.9 m/s. Note that proportion cannot
carry the difference either: every item is fitted to an exact spec AABB, so a
"flat" shard and a "tall" chunk end up the same box. Only STRUCTURE survives
that fit, so each raw chunk now has one:

    iron ore     a lobe with cubic crystals breaking out of it   SPIKY
    copper ore   four yawed slabs, alternating rock and metal    LAYERED
    coal         three separate small lumps, not one rock        CLUSTERED
    stone        one truncated block with a knocked corner       BLOCKY
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import harvest_common as hc  # noqa: E402

NAME = "ItemsAtlas"
OUT = of.dist_path("items", "items_atlas.glb")


# ---------------------------------------------------------------------------
# Shared item primitives. Everything is poured into a harvest_common.Parts pile
# so a single group can carry per-face roles (the ore facets), then fitted to
# the spec box exactly.
# ---------------------------------------------------------------------------

def _stack(rings, role):
    """A closed rectangular prism through N rings of (z, half_x, half_y).

    Two rings give a chamfered slab, three give the ingot's chamfered
    trapezoid bar. Winding matches of_lib._box_data so backface culling is
    correct without a normals pass."""
    verts = []
    for z, hx, hy in rings:
        verts += [(-hx, -hy, z), (hx, -hy, z), (hx, hy, z), (-hx, hy, z)]
    faces = [(0, 3, 2, 1)]
    for b in range(len(rings) - 1):
        lo, hi = b * 4, (b + 1) * 4
        for i in range(4):
            j = (i + 1) % 4
            faces.append((lo + i, lo + j, hi + j, hi + i))
    top = (len(rings) - 1) * 4
    faces.append((top, top + 1, top + 2, top + 3))
    return verts, faces, [False] * len(faces), [role] * len(faces)


def _prism_x(length, radius, seg=8, side_role="Bark", cap_role="LeafDry"):
    """An n-sided prism lying along X with its caps on their own role. That is
    the whole design of the log: end grain is a different colour from bark, and
    at 64 px that colour break is the only thing that says 'cut timber'."""
    verts = []
    for s in (-1, 1):
        for i in range(seg):
            a = 2.0 * math.pi * i / seg
            verts.append((s * length * 0.5,
                          radius * math.cos(a), radius * math.sin(a)))
    faces = [tuple(range(seg - 1, -1, -1)), tuple(range(seg, 2 * seg))]
    roles = [cap_role, cap_role]
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((i, j, seg + j, seg + i))
        roles.append(side_role)
    return verts, faces, [False] * len(faces), roles


def _chunk(seed, host, ore=None, ore_faces=(), seg=7, jit=0.20):
    """The boulder language at 1/6 scale: one faceted lobe with three to five
    facets split onto the ore role so raw metal catches a specular highlight
    while the host rock stays matte (ASSET-SPECS 4.5, 4.11)."""
    v, f, sm, roles = hc.lobe(0.50, 0.45, 1.0, seg=seg, seed=seed, jit=jit,
                              role=host, ore_role=ore, ore_faces=ore_faces)
    return hc.Parts().add(v, f, sm, roles)


# ---------------------------------------------------------------------------
# The fourteen items. Each returns (Parts, role_order, size_xyz_m).
# Sizes are ASSET-SPECS 3.1, Blender axes, metres.
# ---------------------------------------------------------------------------

def item_ore_chunk_iron():
    """SPIKY. Host rock with three cubic crystals breaking out of the shoulder
    and standing proud of the apex. The spikes are the read: they are the only
    thing in the raw set that breaks the smooth top line of a lobe, and a
    broken top line survives motion blur where a tint does not."""
    p = _chunk(0x11, "Rock", "Iron", (0, 3, 7, 11), seg=7, jit=0.16)
    nxt = hc.rng(0x51A1)
    for k in range(3):
        a = 2.0 * math.pi * k / 3.0 + 0.55
        r = 0.13 + 0.10 * nxt()
        s = 0.14 + 0.05 * nxt()
        p.add(*of.box_data((s, s, 0.55 + 0.80 * nxt()),
                           (r * math.cos(a), r * math.sin(a), 0.92),
                           rot_z=17.0 + 23.0 * k), role="Iron")
    return p, ["Rock", "Iron"], (0.26, 0.22, 0.20)


def item_ore_chunk_copper():
    """LAYERED. Four slabs of falling size, each yawed a few degrees, host rock
    and raw metal alternating, so the silhouette is a stepped ziggurat and the
    colour break repeats up it instead of being one flat wash."""
    p = hc.Parts()
    for sx, sy, sz, cz, rz, role in ((0.92, 0.86, 0.26, 0.13, 0.0, "Rock"),
                                     (0.74, 0.68, 0.22, 0.37, 13.0, "Copper"),
                                     (0.56, 0.50, 0.20, 0.58, -21.0, "Rock"),
                                     (0.30, 0.27, 0.18, 0.79, 8.0, "Copper")):
        p.add(*of.box_data((sx, sy, sz), (0.0, 0.0, cz), rot_z=rz), role=role)
    return p, ["Rock", "Copper"], (0.26, 0.22, 0.20)


def item_coal_lump():
    """CLUSTERED. Three small lumps rather than one rock: the only multi-body
    silhouette in the whole atlas, which makes it the fastest to name at 5 m
    and stops it reading as a black-tinted stone chunk."""
    p = hc.Parts()
    for seed, dx, dy, dz, s, seg in ((0x13, -0.26, -0.10, 0.00, 0.62, 6),
                                     (0x23, 0.22, -0.16, 0.02, 0.54, 6),
                                     (0x33, 0.02, 0.24, 0.05, 0.46, 5)):
        p.add(*hc.lobe(0.50 * s, 0.46 * s, 1.0 * s, loc=(dx, dy, dz), seg=seg,
                       seed=seed, jit=0.24, role="Coal"))
    return p, ["Coal"], (0.24, 0.20, 0.18)


def item_stone_chunk():
    """BLOCKY. One truncated block with a second smaller block knocked askew on
    top. Large flat facets, no spikes and no cluster, so it is the calm shape in
    a set of busy ones - which is what "unremarkable grey rubble" should be."""
    p = hc.Parts()
    p.add(*_stack(((0.00, 0.46, 0.42),
                   (0.62, 0.40, 0.36),
                   (0.92, 0.22, 0.19)), "Rock"))
    p.add(*of.box_data((0.42, 0.38, 0.34), (0.18, -0.15, 0.90), rot_z=24.0),
          role="RockDark")
    return p, ["Rock", "RockDark"], (0.24, 0.22, 0.18)


def item_log():
    v, f, sm, roles = _prism_x(0.60, 0.09, 8, "Bark", "LeafDry")
    return hc.Parts().add(v, f, sm, roles), ["Bark", "LeafDry"], \
        (0.60, 0.18, 0.18)


def _ingot(role):
    v, f, sm, roles = _stack(((-0.04, 0.120, 0.056),
                              (-0.014, 0.140, 0.070),
                              (0.04, 0.112, 0.049)), role)
    return hc.Parts().add(v, f, sm, roles), [role], (0.28, 0.14, 0.08)


def item_ingot_iron():
    return _ingot("Iron")


def item_ingot_copper():
    return _ingot("Copper")


def item_ferrite_ore():
    # Ferrite is the off-world ore chain's entry point, so its chips are the
    # Accent orange rather than a metal: it must not be mistaken for raw iron.
    return _chunk(0x15, "Rock", "Accent", (0, 4, 9, 13)), ["Rock", "Accent"], \
        (0.26, 0.22, 0.20)


def item_ferrite_plate():
    """0.24 m deep, not 0.28. THE FLOW-AXIS BOUND (see check_belt_cargo.py):
    factory_sim.h saturates a belt at kItemSpacing / kUnitsPerTile = 64/256 of
    a 1 m tile, so four items per tile, 0.250 m apart. Anything deeper than
    that along the flow axis interpenetrates its neighbour on a full belt. This
    plate and the frame part were the only two items over the line, and nobody
    had noticed because nothing had ever put an item on a belt."""
    v, f, sm, roles = _stack(((-0.015, 0.120, 0.100),
                              (0.015, 0.140, 0.118)), "Iron")
    return hc.Parts().add(v, f, sm, roles), ["Iron"], (0.28, 0.24, 0.03)


def item_frame_part():
    """A frame with a cross brace: four Iron bars, two Steel diagonals. The hole
    in the middle is the read - it is the only item you can see through, at 64
    px and on a belt alike. 0.24 m deep for the same flow-axis reason as the
    ferrite plate."""
    p = hc.Parts()
    for sx in (-1, 1):
        p.add(*of.box_data((0.04, 0.24, 0.10), (sx * 0.12, 0.0, 0.0)),
              role="Iron")
    for sy in (-1, 1):
        p.add(*of.box_data((0.20, 0.04, 0.10), (0.0, sy * 0.10, 0.0)),
              role="Iron")
    for rz in (40.0, -40.0):
        p.add(*of.box_data((0.26, 0.035, 0.05), (0.0, 0.0, 0.0), rot_z=rz),
              role="Steel")
    return p, ["Iron", "Steel"], (0.28, 0.24, 0.10)


def item_cinderite():
    """The only item allowed an emissive (WG-4): a faint glow in the cracks is
    how the player knows the moon trip paid off."""
    return _chunk(0x16, "RockDark", "EmissiveState", (1, 6, 9)), \
        ["RockDark", "EmissiveState"], (0.24, 0.22, 0.20)


def item_combustite():
    return _chunk(0x17, "Coal", "Accent", (0, 5, 10)), ["Coal", "Accent"], \
        (0.22, 0.20, 0.18)


def item_water_canister():
    """Steel jerrycan with a glass sight strip. Canister and flask must not be
    confused, so one is a squat 8-sided can and the other a tall neck bottle."""
    p = hc.Parts()
    p.add(*of.cyl_data(0.088, 0.22, (0.0, 0.0, -0.02), "Z", 8), role="Steel")
    p.add(*of.box_data((0.07, 0.07, 0.05), (0.0, 0.0, 0.115)), role="Steel")
    p.add(*of.box_data((0.026, 0.19, 0.13), (0.076, 0.0, -0.02)), role="Glass")
    return p, ["Steel", "Glass"], (0.18, 0.18, 0.30)


def item_oil_flask():
    """A glass bottle with the oil visible inside it. The dark fill sitting
    two thirds up a transparent body is the read; OF_Oil is the only glossy
    ground surface in the palette so it stays unmistakable."""
    p = hc.Parts()
    p.add(*of.cyl_data(0.078, 0.17, (0.0, 0.0, -0.045), "Z", 8), role="Glass")
    p.add(*of.cyl_data(0.030, 0.09, (0.0, 0.0, 0.085), "Z", 6), role="Glass")
    p.add(*of.cyl_data(0.062, 0.10, (0.0, 0.0, -0.06), "Z", 8), role="Oil")
    return p, ["Glass", "Oil"], (0.16, 0.16, 0.28)


def item_crate():
    """ONE generic packed crate, which carries any ItemCategory::Buildable on a
    belt: Miner 0x10 through PowerPole 0x16, PrimitiveFurnace 0x3B, Survival
    Smelter 0x3C, and Foundation 0x40 through Door 0x43. Twelve buildables, and
    not one of them has a belt-sized mesh.

    The alternative was scaling the machine's own mesh down to fit, and a 4 m
    foundation at 0.24 m is a smudge; worse, twelve smudges would all be the
    same grey smudge, so the player would learn nothing from looking. A crate
    says "a thing packed for transport", which is the true statement, and the
    HUD says which thing.

    Timber body, four corner posts, two steel straps, and an Accent stencil on
    the lid so the top face reads at a glance from a player's eye height."""
    p = hc.Parts()
    p.add(*of.box_data((0.196, 0.196, 0.176)), role="BarkLight")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(*of.box_data((0.038, 0.038, 0.200),
                               (sx * 0.094, sy * 0.094, 0.0)), role="Bark")
    p.add(*of.box_data((0.212, 0.048, 0.186)), role="Steel")
    p.add(*of.box_data((0.048, 0.212, 0.186)), role="Steel")
    p.add(*of.box_data((0.204, 0.204, 0.020), (0.0, 0.0, 0.092)), role="Bark")
    p.add(*of.box_data((0.086, 0.086, 0.008), (0.0, 0.0, 0.105)), role="Accent")
    return p, ["BarkLight", "Bark", "Steel", "Accent"], (0.24, 0.24, 0.22)


ITEMS = [
    ("Item_OreChunk_Iron", item_ore_chunk_iron),
    ("Item_OreChunk_Copper", item_ore_chunk_copper),
    ("Item_CoalLump", item_coal_lump),
    ("Item_StoneChunk", item_stone_chunk),
    ("Item_Log", item_log),
    ("Item_IngotIron", item_ingot_iron),
    ("Item_IngotCopper", item_ingot_copper),
    ("Item_FerriteOre", item_ferrite_ore),
    ("Item_FerritePlate", item_ferrite_plate),
    ("Item_FramePart", item_frame_part),
    ("Item_Cinderite", item_cinderite),
    ("Item_Combustite", item_combustite),
    ("Item_WaterCanister", item_water_canister),
    ("Item_OilFlask", item_oil_flask),
    ("Item_Crate", item_crate),
]


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    built = []
    for name, fn in ITEMS:
        parts, order, size = fn()
        # Centre on all three axes: base_z = -h/2 puts the volumetric centre on
        # the origin, which is the item pivot rule (ASSET-SPECS 4.11).
        parts.fit(size, base_z=-size[2] * 0.5)
        mb = of.MeshBuilder()
        parts.into(mb, order)
        obj = mb.build(name, root)
        # socket_rest, a CHILD of the item. fit() has just made the AABB
        # exactly `size` centred on the origin, so the item's lowest point is
        # -size[2]/2 by construction rather than by measurement, and there is
        # no half-height table for a consumer to keep in step with the meshes.
        of.add_socket("socket_rest", (0.0, 0.0, -size[2] * 0.5), parent=obj,
                      extras={"of_role": "item_rest"})
        built.append((name, mb))

    of.report(NAME, built)
    # dedupe_socket_names: fifteen nodes want to be called socket_rest and
    # Blender will only let one of them. See the module docstring, point 4.
    of.export_glb(OUT, dedupe_socket_names=True, export_force_sampling=False)


if __name__ == "__main__":
    main()
