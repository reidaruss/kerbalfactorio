"""
build_box.py - Storage box, TypeId 0x14 (of::gameplay::types::Box).

    blender --background --python tools/blender/build_box.py

Produces assets/models/dist/machines/box.glb.

Footprint 1 x 1 m, height 1.0 m. A ribbed steel crate: corner posts, banded
sides, a hinged lid and a narrow fill bar on the front face.

The fill bar is the one machine readout that carries TWO signals. It takes the
standard four VisualState colours like every other machine, and its LENGTH is
driven from the buffer level, so a player reads "full and blocked" from a long
amber bar and "running and nearly empty" from a short green one without
opening anything. Scale the bar mesh on its local X to do it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Box"
OUT = of.dist_path("machines", "box.glb")

W = D = 1.00
H = 1.00
HALF = 0.50
POST = 0.10
POST_C = HALF - POST * 0.5      # 0.45
LID_Z = 0.90
HINGE_Y = 0.43
CORNERS = [(sx * POST_C, sy * POST_C) for sx in (-1, 1) for sy in (-1, 1)]


def build_lod0(root):
    mb = of.MeshBuilder()
    for cx, cy in CORNERS:
        mb.box((POST, POST, H), (cx, cy, H * 0.5), "SteelDark")
    mb.box((0.90, 0.90, 0.86), (0, 0, 0.45), "Steel")
    mb.box((0.96, 0.96, 0.06), (0, 0, 0.03), "SteelDark")
    for z in (0.20, 0.45, 0.70):
        mb.box((0.94, 0.94, 0.05), (0, 0, z), "SteelDark")
    # front panel seam, so the -Y face reads as the front before the bar lights
    for sx in (-1, 1):
        mb.box((0.05, 0.06, 0.60), (sx * 0.22, -0.46, 0.50), "SteelDark")
    for cx, cy in CORNERS:
        mb.box((POST, POST, 0.05), (cx, cy, H - 0.025), "Accent")
    # fill bar: bezel then chip, so OF_EmissiveState is the last material slot
    mb.box((0.60, 0.04, 0.10), (0, -0.46, 0.78), "SteelDark")
    mb.box((0.52, 0.05, 0.06), (0, -0.47, 0.78), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for cx, cy in CORNERS:
        mb.box((POST, POST, H), (cx, cy, H * 0.5), "SteelDark")
    mb.box((0.90, 0.90, 0.86), (0, 0, 0.45), "Steel")
    mb.box((0.52, 0.05, 0.06), (0, -0.47, 0.78), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, H), (0, 0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_lid(root):
    """Hinged on the BACK edge. Geometry is authored relative to the hinge so
    the clip is a plain rotation about the object's own X axis."""
    mb = of.MeshBuilder()
    mb.box((0.86, 0.86, 0.09), (0, -0.43, 0.045), "Steel")
    mb.box((0.20, 0.06, 0.05), (0, -0.83, 0.115), "Accent")
    obj = mb.build("Box_Lid", root)
    obj.location = (0.0, HINGE_Y, LID_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbl, lid = build_lid(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in", (0.0, HALF, 0.60), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, 0.60), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_status", (0.0, -HALF, 0.78), parent=root,
                  extras={"of_role": "state_light"})

    # Box_Lid: one-shot open over 15 frames, played with a negative timeScale
    # to close. Negative X so the FRONT edge lifts and the player can see in.
    of.add_clip(lid, "Box_Lid", "rotation_euler",
                [(1, of.deg3(x=0)), (8, of.deg3(x=-40)), (15, of.deg3(x=-72))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Box_Lid", mbl)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
