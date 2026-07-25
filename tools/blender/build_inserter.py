"""
build_inserter.py - Inserter (sim-internal, no TypeId).

    blender --background --python tools/blender/build_inserter.py

Produces assets/models/dist/machines/inserter.glb.

DW-9: inserters are not player-placeable. BuildableNetwork::connect creates
them, so they carry no item id and no BuildKind - but they exist in the world
wherever a connection exists and must be rendered, because a connection you
cannot see is a connection you cannot debug. Hence the mesh.

Footprint 1 x 1 m, height 0.9 m. Base disc, mast, and a swing arm ending in a
two-finger grip that is visibly holding something.

The arm reaches EXACTLY 0.50 m from the mast axis, which is the inscribed
radius of the 1 m cell, so the full 180 degree sweep from socket_pick to
socket_drop never crosses into a neighbouring cell at any point in the clip.
That is the whole reason the reach is 0.50 and not the 0.55 a longer forearm
would have wanted.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Inserter"
OUT = of.dist_path("machines", "inserter.glb")

BASE_R = 0.35                   # the mesh AABB: 0.70 across, inside the 1 m cell
H = 0.90
PIVOT_Z = 0.84
REACH = 0.50                    # inscribed radius of the cell
ITEM_Z = 0.35                   # belt deck height + item


def build_lod0(root):
    mb = of.MeshBuilder()
    mb.cylinder(BASE_R, 0.12, (0, 0, 0.06), axis="Z", segments=12,
                role="SteelDark")
    mb.cylinder(0.20, 0.16, (0, 0, 0.20), axis="Z", segments=12, role="Steel")
    mb.cylinder(0.21, 0.04, (0, 0, 0.28), axis="Z", segments=12, role="Accent")
    mb.cylinder(0.10, 0.50, (0, 0, 0.53), axis="Z", segments=12, role="Steel")
    mb.cylinder(0.16, 0.12, (0, 0, H - 0.06), axis="Z", segments=12,
                role="SteelDark")
    # status chip on the base rim, inside r = 0.35 so the AABB stays 0.70
    mb.box((0.12, 0.09, 0.06), (0.29, 0, 0.10), "SteelDark")
    mb.box((0.09, 0.06, 0.04), (0.305, 0, 0.10), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.cylinder(BASE_R, 0.12, (0, 0, 0.06), axis="Z", segments=8,
                role="SteelDark")
    mb.cylinder(0.10, 0.66, (0, 0, 0.45), axis="Z", segments=8, role="Steel")
    mb.cylinder(0.16, 0.12, (0, 0, H - 0.06), axis="Z", segments=8,
                role="SteelDark")
    mb.box((0.09, 0.06, 0.04), (0.305, 0, 0.10), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((BASE_R * 2, BASE_R * 2, H), (0, 0, H * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_arm(root):
    """Stepped down toward the grip so the fingers land at item height (0.35 m)
    rather than at pivot height. A sibling of _LOD0: the arm is the one part
    that must be free to move, and keeping it out of LOD0 leaves the footprint
    check exact."""
    mb = of.MeshBuilder()
    mb.box((0.20, 0.14, 0.10), (0, -0.05, 0), "SteelDark")
    for dy, dz in ((-0.13, -0.06), (-0.245, -0.19), (-0.36, -0.32)):
        mb.box((0.09, 0.16, 0.09), (0, dy, dz), "Steel")
    mb.box((0.14, 0.10, 0.10), (0, -0.44, -0.40), "Steel")
    finger_z = ITEM_Z - PIVOT_Z + 0.06      # fingers bottom out at ITEM_Z
    for sx in (-1, 1):
        mb.box((0.04, 0.07, 0.12), (sx * 0.05, -0.44, finger_z), "Accent")
    obj = mb.build("Inserter_Arm", root)
    obj.location = (0.0, 0.0, PIVOT_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mba, arm = build_arm(root)

    # SPEC CORRECTION (ASSET-SPECS 4.20): the proxy was 0.6 x 0.6, which does
    # not contain the r = 0.35 base disc the same section specifies. 0.70.
    of.add_collision_box("col_" + NAME, (0.70, 0.70, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_pick", (0.0, REACH, ITEM_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_drop", (0.0, -REACH, ITEM_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_grip", (0.0, -0.44, ITEM_Z - PIVOT_Z), parent=arm,
                  extras={"of_role": "carried_item"})
    of.add_socket("socket_status", (0.35, 0.0, 0.10), parent=root,
                  extras={"of_role": "state_light"})

    # Inserter_Swing, 30 frames, one-shot. The sim has two phases
    # (InserterPhase::Idle / Holding), so the renderer plays this forward to
    # carry and backward (negative timeScale) to return.
    #
    # SPEC CORRECTION (4.20): the spec says "+90 to -90 degrees about Z", which
    # assumes the arm is modelled along +X. It is modelled along -Y, the
    # project forward axis, so the identical sweep is 180 -> 0 degrees: 180 is
    # over socket_pick on +Y, 0 is over socket_drop on -Y. Keyed in 60 degree
    # steps because a single 180 degree quaternion step has no defined
    # direction.
    of.add_clip(arm, "Inserter_Swing", "rotation_euler",
                [(1, of.deg3(z=180)), (11, of.deg3(z=120)),
                 (21, of.deg3(z=60)), (31, of.deg3(z=0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Inserter_Arm", mba)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
