"""
build_primitive_furnace.py - Primitive furnace, TypeId 0x30
(of::gameplay::structures::Furnace).

    blender --background --python tools/blender/build_primitive_furnace.py

Produces assets/models/dist/machines/primitive_furnace.glb.

Footprint 1 x 1 m, height 1.4 m. The player's FIRST structure, and it has to
read pre-industrial standing next to the steel machines, because the visual
jump from this to the smelter is how progression is felt. Stacked field stone
in three rough courses, a clay cap, an open fire mouth and a hearth ledge.

Every block that is not load-bearing on the cell edge is yawed a few degrees:
hand-piled stone reads as piled because no two blocks share an edge angle. The
four cardinal blocks in the bottom course and the mouth jambs stay axis
aligned, because they are what puts the mesh AABB at exactly 1.00 m and a
yawed block's AABB is larger than its size.

FUEL STATE MATTERS HERE. The survival Furnace stalls with no fuel and that is
NOT the same as blocked. Map fuelTicks == 0 to VisualState 3 (no-power red)
and let the fire card go fully dark: a cold furnace must look cold.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "PrimitiveFurnace"
OUT = of.dist_path("machines", "primitive_furnace.glb")

W = D = 1.00
H = 1.40
CAP_Z0 = 1.15                   # clay cap starts here, tops out at H
MOUTH_Z0, MOUTH_Z1 = 0.14, 0.48
CARD_Y = -0.36

# FS-88, AND THE CAUSE IS THE ONE THING A PILE OF STONE SHOULD NEVER HAVE: A
# DATUM. Every block in a course was placed on one plane, so seven blocks of
# two materials had seven bottom faces on z = 0 and a course of six had six on
# z = 0.44. Different materials, same plane, same facing, overlapping areas:
# 55 same-facing coplanar pairs at LOD0, and the irony is that this file's own
# docstring already says why that is wrong (hand-piled stone reads as piled
# because no two blocks share an edge angle). It shared every edge HEIGHT.
#
# So each block now beds a different amount into what it stands on. The numbers
# are a few millimetres apart and deliberately unpatterned, which is the same
# device as the yaw angles and costs nothing.
HEARTH_T = 0.03                 # the soil bed the bottom course sits in
HEARTH_W = 0.94                 # and 0.94, not 0.96: at 0.96 the bed's own -Y
                                # face lands on y = -0.48, which is where the
                                # set-back lintel and sill now are. Introducing
                                # a part to fix coplanar faces and giving it a
                                # plane somebody else already owns is how this
                                # class of defect propagates, so it is checked
                                # for the new part too.
# Soil is already in this file's palette (it is the clay cap), so the bed costs
# no material slot. It exists because the bottom course has to bed into
# SOMETHING: z = 0 is the ground plane, nothing may go below it (the AABB and
# the ground pivot both read it), so without a bed every block's underside is
# forced onto exactly that plane and no stagger is possible.
BED_1 = (0.006, 0.018, 0.010, 0.022, 0.014, 0.026, 0.004)   # course 1
BED_JAMB, BED_SILL = 0.008, 0.012                           # the mouth


def _hearth(mb):
    """The soil bed. It sits just inside the cardinal blocks, so the cell edge
    is still theirs, and it is the ONLY part of the asset with a face on z = 0.
    Everything else beds into it at its own depth."""
    mb.box((HEARTH_W, HEARTH_W, HEARTH_T), (0, 0, HEARTH_T * 0.5), "Soil")


def _course_1(mb):
    """Bottom course. The three cardinal blocks are axis aligned and flush
    with the cell edge: they, and the mouth jambs, define the exact AABB.

    Each block's foot is BED_1[i] above z = 0, inside the hearth bed, so no two
    of them share an underside plane and none of them is on the ground plane.
    Bedding them by different amounts also staggers their TOPS, which is what
    removes the second cluster of pairs without touching a single block size."""
    for size, loc, role, bed in (
            ((0.18, 0.38, 0.44), (0.41, 0.02), "Rock", BED_1[0]),
            ((0.16, 0.42, 0.42), (-0.42, -0.04), "RockDark", BED_1[1]),
            ((0.40, 0.16, 0.40), (0.03, 0.42), "Rock", BED_1[2])):
        mb.box(size, (loc[0], loc[1], bed + size[2] * 0.5), role)
    for loc, size, rot, role, bed in (
            ((0.32, 0.32), (0.26, 0.26, 0.40), 14.0, "RockDark", BED_1[3]),
            ((-0.32, 0.32), (0.24, 0.28, 0.38), -11.0, "Rock", BED_1[4]),
            ((0.33, -0.33), (0.24, 0.24, 0.36), 9.0, "Rock", BED_1[5]),
            ((-0.33, -0.33), (0.26, 0.22, 0.38), -13.0, "RockDark", BED_1[6])):
        mb.box(size, (loc[0], loc[1], bed + size[2] * 0.5), role, rot_z=rot)


def _mouth(mb):
    """Jambs, lintel and sill frame a 0.42 x 0.34 m opening on the -Y face.

    THE JAMBS OWN THE CELL EDGE AND NOTHING ELSE MAY. Lintel, sill and ledge
    used to be the same 0.16 deep and as wide as the jambs they sit between,
    which put four RockDark faces on the three planes the jambs' own Rock faces
    are on (y = -0.50, y = -0.34, x = +/-0.43): 31 of this asset's 55 LOD0
    pairs, all of them on the one face a player looks INTO. The lintel and the
    sill are 0.12 deep and set back 20 mm now, so the mouth is a real reveal,
    and the ledge is narrow enough to clear the jambs."""
    for sx in (-1, 1):
        mb.box((0.22, 0.16, 0.60), (sx * 0.32, -0.42, BED_JAMB + 0.30), "Rock")
    mb.box((0.80, 0.12, 0.16), (0.0, -0.42, 0.56), "RockDark")
    mb.box((0.44, 0.12, MOUTH_Z0),
           (0.0, -0.42, BED_SILL + MOUTH_Z0 * 0.5), "RockDark")
    mb.box((0.40, 0.18, 0.06), (0.0, -0.41, MOUTH_Z0 + 0.02), "RockDark")


def _course_2(mb):
    """Second course. Each block sits at its own height rather than all six on
    0.44, for the reason BED_1 gives: a shared course line is a shared plane."""
    for loc, size, rot, role, base in (
            ((0.36, -0.04), (0.16, 0.34, 0.40), 7.0, "RockDark", 0.440),
            ((-0.37, 0.06), (0.15, 0.32, 0.38), -8.0, "Rock", 0.428),
            ((0.02, 0.37), (0.36, 0.15, 0.40), 5.0, "RockDark", 0.446),
            ((0.28, 0.29), (0.24, 0.22, 0.36), -16.0, "Rock", 0.434),
            ((-0.29, 0.28), (0.22, 0.24, 0.38), 12.0, "RockDark", 0.452),
            ((-0.30, -0.28), (0.24, 0.22, 0.34), 17.0, "Rock", 0.422)):
        mb.box(size, (loc[0], loc[1], base + size[2] * 0.5), role, rot_z=rot)


def _course_3(mb):
    for loc, size, rot, role, base in (
            ((0.30, 0.05), (0.16, 0.34, 0.31), -6.0, "Rock", 0.840),
            ((-0.31, -0.03), (0.16, 0.32, 0.30), 10.0, "RockDark", 0.828),
            ((0.03, 0.31), (0.34, 0.16, 0.31), 8.0, "Rock", 0.852),
            ((0.05, -0.31), (0.32, 0.16, 0.29), -12.0, "RockDark", 0.846),
            ((-0.26, 0.26), (0.20, 0.20, 0.28), 15.0, "Rock", 0.834)):
        mb.box(size, (loc[0], loc[1], base + size[2] * 0.5), role, rot_z=rot)


def build_lod0(root):
    mb = of.MeshBuilder()
    _hearth(mb)
    _course_1(mb)
    _mouth(mb)
    _course_2(mb)
    _course_3(mb)
    mb.frustum(0.42, 0.26, H - CAP_Z0, (0, 0, (CAP_Z0 + H) * 0.5), axis="Z",
               segments=8, role="Soil")
    # fire card recessed in the mouth: THE state surface, last material slot
    mb.box((0.34, 0.03, 0.28), (0.0, CARD_Y, 0.30), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _hearth(mb)
    _course_1(mb)
    for sx in (-1, 1):
        mb.box((0.22, 0.16, 0.60), (sx * 0.32, -0.42, BED_JAMB + 0.30),
               "Rock")
    mb.box((0.72, 0.72, 0.71), (0, 0, 0.795), "Rock")
    mb.frustum(0.42, 0.26, H - CAP_Z0, (0, 0, (CAP_Z0 + H) * 0.5), axis="Z",
               segments=6, role="Soil")
    mb.box((0.34, 0.03, 0.28), (0.0, CARD_Y, 0.30), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((0.92, 0.92, CAP_Z0), (0, 0, CAP_Z0 * 0.5), "Rock")
    mb.box((0.70, 0.70, H - CAP_Z0), (0, 0, (CAP_Z0 + H) * 0.5), "Soil")
    return mb, mb.build(NAME + "_LOD2", root)


def build_glow(root):
    mb = of.MeshBuilder()
    mb.box((0.30, 0.02, 0.24), (0, 0, 0), "EmissiveState")
    obj = mb.build("Furnace_FireCard", root)
    obj.location = (0.0, CARD_Y - 0.02, 0.30)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbg, glow = build_glow(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root,
                         role="RockDark")

    of.add_socket("socket_item_in", (0.0, 0.5, 0.90), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -0.5, 0.30), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_fuel_in", (0.0, -0.5, 0.55), parent=root,
                  extras={"of_role": "fuel_in"})
    of.add_socket("socket_smoke", (0.0, 0.0, H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (0.0, CARD_Y, 0.30), parent=root,
                  extras={"of_role": "state_light"})

    # Furnace_Glow: 180 frames == ticksPerSmeltFor(Furnace). Keys are
    # deliberately NOT evenly spaced and the peaks differ, so the fire
    # flickers rather than pulses. A sine wave reads as machinery; this reads
    # as fire, which is the whole point of the pre-industrial silhouette.
    of.add_clip(glow, "Furnace_Glow", "scale",
                [(1, (1.00, 1.0, 1.00)), (23, (1.09, 1.0, 1.09)),
                 (41, (1.02, 1.0, 1.02)), (67, (1.10, 1.0, 1.10)),
                 (89, (1.03, 1.0, 1.03)), (113, (1.08, 1.0, 1.08)),
                 (134, (1.01, 1.0, 1.01)), (157, (1.07, 1.0, 1.07)),
                 (181, (1.00, 1.0, 1.00))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Furnace_FireCard", mbg)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
