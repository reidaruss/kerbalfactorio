"""build_items_atlas.py - the fourteen dropped-item props, one file.

    blender --background --python tools/blender/build_items_atlas.py

Produces assets/models/dist/items/items_atlas.glb (ASSET-SPECS 3.1 / 4.11).

THREE THINGS MAKE THIS FILE DIFFERENT FROM EVERY OTHER ASSET.

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

The real constraint is legibility at 64 px in an inventory icon: if the iron
ingot and the copper ingot are not instantly distinguishable, the material
contrast is wrong, not the mesh.
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
    return _chunk(0x11, "Rock", "Iron", (0, 3, 7, 11)), ["Rock", "Iron"], \
        (0.26, 0.22, 0.20)


def item_ore_chunk_copper():
    return _chunk(0x12, "Rock", "Copper", (1, 5, 8, 12)), ["Rock", "Copper"], \
        (0.26, 0.22, 0.20)


def item_coal_lump():
    return _chunk(0x13, "Coal", seg=7, jit=0.26), ["Coal"], (0.24, 0.20, 0.18)


def item_stone_chunk():
    return _chunk(0x14, "Rock", "RockDark", (2, 6, 10)), ["Rock", "RockDark"], \
        (0.24, 0.22, 0.18)


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
    v, f, sm, roles = _stack(((-0.01, 0.120, 0.120),
                              (0.01, 0.140, 0.140)), "Iron")
    return hc.Parts().add(v, f, sm, roles), ["Iron"], (0.28, 0.28, 0.02)


def item_frame_part():
    """A square frame with a cross brace: four Iron bars, two Steel diagonals.
    The hole in the middle is the icon read - it is the only item you can see
    through."""
    p = hc.Parts()
    for sx in (-1, 1):
        p.add(*of.box_data((0.04, 0.28, 0.10), (sx * 0.12, 0.0, 0.0)),
              role="Iron")
    for sy in (-1, 1):
        p.add(*of.box_data((0.20, 0.04, 0.10), (0.0, sy * 0.12, 0.0)),
              role="Iron")
    for rz in (38.0, -38.0):
        p.add(*of.box_data((0.30, 0.035, 0.05), (0.0, 0.0, 0.0), rot_z=rz),
              role="Steel")
    return p, ["Iron", "Steel"], (0.28, 0.28, 0.10)


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
        mb.build(name, root)
        built.append((name, mb))

    of.report(NAME, built)
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
