"""
build_assembler.py - Assembler, TypeId 0x13 (of::gameplay::types::Assembler).

    blender --background --python tools/blender/build_assembler.py

Produces assets/models/dist/machines/assembler.glb.

Footprint 3 x 3 m, height 2.8 m. An open-topped work cell: four corner posts,
an upper frame ring, a central platen, and a corner-mounted articulated arm
sweeping over it. The arm IS the read at distance - a static assembler and a
running one must be distinguishable from across the base - so it is the one
part deliberately allowed to break the box silhouette.

The arm is a sibling of _LOD0, not a child, exactly like the belt slat strip:
it keeps LOD0's bounding box at exactly 3 x 3 x 2.8 while the sweep is free to
carry the gripper wherever the cycle needs it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Assembler"
OUT = of.dist_path("machines", "assembler.glb")

W = D = 3.00
H = 2.80
HALF = 1.50

BASE_H = 0.30
POST = 0.25
POST_C = HALF - POST * 0.5      # 1.375
RING_Z = H - 0.10               # frame ring centre
PLATEN_Z = 0.90
ARM_X, ARM_Y, ARM_Z = -1.00, -1.00, 1.20    # shoulder, spec 4.16
BOOM = 1.10                     # shoulder to wrist
CORNERS = [(sx * POST_C, sy * POST_C) for sx in (-1, 1) for sy in (-1, 1)]


def _inboard(c, size):
    """Centre a part of `size` on a corner post so its OUTER face stays flush
    with the cell edge rather than crossing it."""
    return c - (size - POST) * 0.5 * (1.0 if c > 0 else -1.0)


def _frame(mb):
    """Base, posts and upper ring: the silhouette every LOD keeps."""
    mb.box((W, D, BASE_H), (0, 0, BASE_H * 0.5), "SteelDark")
    for cx, cy in CORNERS:
        mb.box((POST, POST, H - BASE_H), (cx, cy, (BASE_H + H) * 0.5), "Steel")
    for sy in (-1, 1):
        mb.box((W, 0.20, 0.20), (0, sy * 1.40, RING_Z), "Steel")
    for sx in (-1, 1):
        mb.box((0.20, D - 2 * 0.20, 0.20), (sx * 1.40, 0, RING_Z), "Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    _frame(mb)
    # Post foot plates and top gussets. Both are WIDER than the post, so each
    # is pulled inboard by half the difference: its outer corner then lands
    # exactly on the 3 m cell edge instead of 65 mm past it. Anything that
    # overhangs z-fights the neighbouring tile (ASSET-SPECS 2.2).
    for cx, cy in CORNERS:
        fx, fy = _inboard(cx, 0.38), _inboard(cy, 0.38)
        mb.box((0.38, 0.38, 0.10), (fx, fy, BASE_H + 0.05), "SteelDark")
        gx, gy = _inboard(cx, 0.30), _inboard(cy, 0.30)
        mb.box((0.30, 0.30, 0.12), (gx, gy, RING_Z - 0.22), "SteelDark")
    # side panel ribs, low enough to leave the cell open at the top
    for sx in (-1, 1):
        for y in (-0.55, 0.55):
            mb.box((0.08, 0.30, 1.10), (sx * 1.44, y, 1.05), "SteelDark")
        for x in (-0.55, 0.55):
            mb.box((0.30, 0.08, 1.10), (x, sx * 1.44, 1.05), "SteelDark")

    # work platen on its pedestal
    mb.box((0.60, 0.60, PLATEN_Z - BASE_H), (0, 0, (BASE_H + PLATEN_Z) * 0.5),
           "SteelDark")
    mb.box((1.40, 1.40, 0.15), (0, 0, PLATEN_Z - 0.075), "Steel")
    mb.box((1.48, 1.48, 0.04), (0, 0, PLATEN_Z + 0.02), "Accent")

    # hazard keep-out chevrons painted on the deck
    for sy in (-1, 1):
        mb.box((2.60, 0.12, 0.02), (0, sy * 1.30, BASE_H + 0.01), "Hazard")
        mb.box((0.12, 2.60, 0.02), (sy * 1.30, 0, BASE_H + 0.01), "Hazard")

    # input hoppers on +Y and +X, output chute on -Y, all flush with the edge
    mb.box((0.80, 0.40, 0.60), (0, 1.30, 1.00), "Steel")
    mb.box((0.88, 0.10, 0.10), (0, HALF - 0.05, 1.35), "Accent")
    mb.box((0.40, 0.80, 0.60), (1.30, 0, 1.00), "Steel")
    mb.box((0.10, 0.88, 0.10), (HALF - 0.05, 0, 1.35), "Accent")
    mb.box((0.70, 0.50, 0.50), (0, -1.25, 0.65), "SteelDark")
    mb.box((0.78, 0.10, 0.10), (0, -HALF + 0.05, 0.42), "Accent")

    # arm pedestal (the turret itself rides on the animated node)
    mb.box((0.40, 0.40, ARM_Z - BASE_H), (ARM_X, ARM_Y, (BASE_H + ARM_Z) * 0.5),
           "Steel")
    mb.box((0.16, 0.16, 0.20), (1.40, 1.40, 2.50), "Steel")

    # front status rail. Bezel before chip: OF_EmissiveState stays last.
    mb.box((2.60, 0.16, 0.16), (0, -1.42, 1.30), "Steel")
    mb.box((2.20, 0.08, 0.10), (0, -1.46, 1.30), "SteelDark")
    mb.box((2.00, 0.05, 0.07), (0, -HALF + 0.025, 1.30), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _frame(mb)
    mb.box((0.60, 0.60, PLATEN_Z - BASE_H), (0, 0, (BASE_H + PLATEN_Z) * 0.5),
           "SteelDark")
    mb.box((1.40, 1.40, 0.15), (0, 0, PLATEN_Z - 0.075), "Steel")
    mb.box((0.80, 0.40, 0.60), (0, 1.30, 1.00), "Steel")
    mb.box((0.40, 0.80, 0.60), (1.30, 0, 1.00), "Steel")
    mb.box((0.70, 0.50, 0.50), (0, -1.25, 0.65), "SteelDark")
    mb.box((0.40, 0.40, ARM_Z - BASE_H), (ARM_X, ARM_Y, (BASE_H + ARM_Z) * 0.5),
           "Steel")
    mb.box((2.00, 0.05, 0.07), (0, -HALF + 0.025, 1.30), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, BASE_H), (0, 0, BASE_H * 0.5), "SteelDark")
    mb.box((2.90, 2.90, 1.20), (0, 0, 0.90), "Steel")
    mb.box((W, D, 0.20), (0, 0, RING_Z), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_arm(root):
    """Turret, boom, forearm and two-finger gripper as ONE object, built with
    the shoulder at its local origin so a single rotation_euler Z curve is the
    whole sweep. One clip, one object - see of_lib.add_clip_multi."""
    mb = of.MeshBuilder()
    mb.cylinder(0.28, 0.35, (0, 0, 0.175), axis="Z", segments=12, role="Steel")
    mb.box((0.30, 0.30, 0.40), (0, 0, 0.55), "SteelDark")
    mb.box((0.18, BOOM, 0.18), (0, BOOM * 0.5, 0.75), "Steel")
    mb.box((0.20, 0.14, 0.20), (0, 0.85, 0.75), "Hazard")
    mb.box((0.24, 0.24, 0.24), (0, BOOM, 0.75), "SteelDark")
    mb.box((0.14, 0.14, 0.55), (0, BOOM, 0.475), "Steel")
    mb.box((0.22, 0.20, 0.10), (0, BOOM, 0.14), "SteelDark")
    for sx in (-1, 1):
        mb.box((0.06, 0.10, 0.25), (sx * 0.08, BOOM, -0.055), "Steel")
    obj = mb.build("Assembler_Arm", root)
    obj.location = (ARM_X, ARM_Y, ARM_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mba, arm = build_arm(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in_a", (0.0, HALF, 1.00), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_in_b", (HALF, 0.0, 1.00), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, 0.60), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (1.40, 1.40, 2.50), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_arm_grip", (0.0, BOOM, -0.18), parent=arm,
                  extras={"of_role": "carried_item"})
    of.add_socket("socket_status", (0.0, -HALF, 1.30), parent=root,
                  extras={"of_role": "state_light"})

    # Assembler_Arm_Cycle: 90 frames == AssembleFrame.timeTicks.
    # reach to input 1-25, swing to the platen 26-50, press 51-60, return
    # 61-90. Rotation and the press dip are two channels of ONE action, so the
    # exporter cannot split them into two same-named clips.
    # three.js: action.timeScale = 90 / recipe.craftTimeTicks.
    of.add_clip_multi(arm, "Assembler_Arm_Cycle", {
        "rotation_euler": [(1, of.deg3(z=0)), (25, of.deg3(z=12)),
                           (50, of.deg3(z=-45)), (60, of.deg3(z=-45)),
                           (91, of.deg3(z=0))],
        "location": [(1, (ARM_X, ARM_Y, ARM_Z)),
                     (50, (ARM_X, ARM_Y, ARM_Z)),
                     (55, (ARM_X, ARM_Y, ARM_Z - 0.10)),
                     (60, (ARM_X, ARM_Y, ARM_Z - 0.10)),
                     (66, (ARM_X, ARM_Y, ARM_Z)),
                     (91, (ARM_X, ARM_Y, ARM_Z))],
    })

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Assembler_Arm", mba)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
