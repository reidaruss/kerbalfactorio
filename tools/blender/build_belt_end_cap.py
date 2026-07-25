"""
build_belt_end_cap.py - Belt end cap, TypeId 0x11.

    blender --background --python tools/blender/build_belt_end_cap.py

Produces assets/models/dist/machines/belt_end_cap.glb.

1 x 1 m cell, 0.30 m tall. A closed roller housing that terminates the head or
tail of a line so a belt never ends in a visible hole where you can see the
underside of the deck. Rails and deck height match build_belt_segment exactly,
so the cap butts against a straight tile with no seam.

No state chip and no clip: an end cap has no sim entity of its own, it is a
cosmetic terminator the renderer places at the ends of a belt line. Three
materials, not four.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "BeltEndCap"
OUT = of.dist_path("machines", "belt_end_cap.glb")

W, L, H = 1.00, 1.00, 0.30
RAIL_W = 0.10
DECK_W = W - 2 * RAIL_W
DECK_TOP = 0.25
ROLLER_R = 0.055
ROLLER_Y = L * 0.5 - ROLLER_R          # tangent to the inlet edge


def build_lod0(root):
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    # deck runs from the inlet to mid-tile, then the housing closes it off
    mb.box((DECK_W, 0.60, 0.06), (0.0, 0.20, DECK_TOP - 0.03), "Rubber")
    mb.cylinder(ROLLER_R, DECK_W, (0.0, ROLLER_Y, DECK_TOP - 0.03), axis="X",
                segments=12, role="Steel")
    # closed nose housing over the terminating roller
    mb.box((DECK_W, 0.40, 0.28), (0.0, -0.30, 0.15), "Steel")
    mb.box((W - 0.14, 0.06, H), (0.0, -L * 0.5 + 0.03, H * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, 0.60, 0.06), (0.0, 0.20, DECK_TOP - 0.03), "Rubber")
    mb.box((DECK_W, 0.40, 0.28), (0.0, -0.30, 0.15), "Steel")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, L, H), (0.0, 0.0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (W, L, H), (0.0, 0.0, H * 0.5), root)

    of.add_socket("socket_belt_in", (0.0, L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_in"})
    of.add_socket("socket_item", (0.0, 0.15, DECK_TOP + 0.03), parent=root,
                  extras={"of_role": "item_ride"})

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
