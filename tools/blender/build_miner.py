"""
build_miner.py - Miner, TypeId 0x10 (of::gameplay::types::Miner).

    blender --background --python tools/blender/build_miner.py

Produces assets/models/dist/machines/miner.glb.

Footprint 2 x 2 m, height 2.4 m. EntityDef.requiresDeposit is true, so the
design has to say "it eats the ground": four corner legs straddle the ore with
nothing between them, and you can see straight through to the deposit the
machine is bound to. That readable gap is the point of the gantry silhouette.

The drill hangs from a bob pivot so the two clips each drive exactly one
object: Drill_Bob translates the mount, Drill_Spin turns the column under it.
Neither is inside <Name>_LOD0, so the LOD0 bounding box stays exactly
2 x 2 x 2.4 and the grid-footprint check is exact.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Miner"
OUT = of.dist_path("machines", "miner.glb")

# --- dimensions (metres) ---------------------------------------------------
W = D = 2.00                    # footprint, whole metres (2 x 2 build cells)
H = 2.40
HALF = W * 0.5                  # 1.00, the hard edge nothing may cross

FOOT = 0.30                     # foot pad section
LEG = 0.25                      # leg section
LEG_TOP = 0.90                  # legs end where the body starts
BODY = 1.80
BODY_TOP = 1.75
FLANGE_H = 0.10
HOUSE = 1.10                    # drill motor housing, carries the 2.4 m height
HOUSE_Z0 = BODY_TOP + FLANGE_H  # 1.85
COL_R = 0.28                    # drill column radius
COL_H = 1.40
COL_Z = 1.05                    # column centre -> z 0.35 .. 1.75
BIT_TIP_Z = 0.05

# Feet and legs sit flush with the footprint edge, never past it.
FOOT_C = HALF - FOOT * 0.5      # 0.85
LEG_C = HALF - LEG * 0.5        # 0.875
CORNERS = [(sx * FOOT_C, sy * FOOT_C) for sx in (-1, 1) for sy in (-1, 1)]
LEG_CORNERS = [(sx * LEG_C, sy * LEG_C) for sx in (-1, 1) for sy in (-1, 1)]


def build_lod0(root):
    mb = of.MeshBuilder()
    # --- gantry: four legs on pads, open on all four sides ---
    for cx, cy in CORNERS:
        mb.box((FOOT, FOOT, 0.20), (cx, cy, 0.10), "SteelDark")
    for cx, cy in LEG_CORNERS:
        mb.box((LEG, LEG, LEG_TOP - 0.20), (cx, cy, 0.20 + (LEG_TOP - 0.20) * 0.5),
               "Steel")
    # hazard bands on the pads: the legs are the part a player walks into
    for cx, cy in CORNERS:
        mb.box((FOOT - 0.005, FOOT - 0.005, 0.06), (cx, cy, 0.23), "Hazard")

    # --- body ---
    mb.box((BODY, BODY, BODY_TOP - LEG_TOP), (0, 0, (LEG_TOP + BODY_TOP) * 0.5),
           "Steel")
    # vertical cooling ribs on both side faces, clear of the status panel at y=0
    for sx in (-1, 1):
        for y in (-0.55, -0.25, 0.25, 0.55):
            mb.box((0.06, 0.10, 0.72), (sx * (BODY * 0.5), y, 1.32), "SteelDark")
    # bright cap flange: the one horizontal line that reads at distance
    mb.box((1.92, 1.92, FLANGE_H), (0, 0, BODY_TOP + FLANGE_H * 0.5), "Accent")

    # --- drill motor housing: carries the machine to its full 2.40 m ---
    mb.box((HOUSE, HOUSE, H - HOUSE_Z0), (0, 0, (HOUSE_Z0 + H) * 0.5), "SteelDark")
    for y in (-0.30, -0.10, 0.10, 0.30):
        mb.box((HOUSE + 0.06, 0.07, 0.28), (0, y, 2.14), "Steel")

    # --- hazard collar where the column enters the body underside ---
    mb.cylinder(0.38, 0.14, (0, 0, LEG_TOP), axis="Z", segments=12, role="Hazard")

    # --- output chute on the -Y (forward) face, flush with the cell edge ---
    mb.box((0.50, 0.70, 0.50), (0, -0.65, 0.55), "SteelDark")
    mb.box((0.58, 0.10, 0.12), (0, -HALF + 0.05, 0.33), "Accent")

    # --- power inlet nub under socket_power_in ---
    mb.box((0.16, 0.16, 0.20), (0.82, 0.82, 1.85), "Steel")

    # --- status readout on the +X face. Bezel first, chip last: the emissive
    # slot is always the LAST material slot so the renderer can index it. ---
    mb.box((0.04, 0.40, 0.30), (BODY * 0.5 - 0.01, 0, 1.50), "SteelDark")
    mb.box((0.06, 0.32, 0.22), (BODY * 0.5, 0, 1.50), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    """Hand-built. The read that must survive is the open gantry, so the legs
    stay and the surface detail goes."""
    mb = of.MeshBuilder()
    for cx, cy in CORNERS:
        mb.box((FOOT, FOOT, 0.20), (cx, cy, 0.10), "SteelDark")
    for cx, cy in LEG_CORNERS:
        mb.box((LEG, LEG, LEG_TOP - 0.20), (cx, cy, 0.55), "Steel")
    mb.box((BODY, BODY, BODY_TOP - LEG_TOP), (0, 0, (LEG_TOP + BODY_TOP) * 0.5),
           "Steel")
    mb.box((1.92, 1.92, FLANGE_H), (0, 0, BODY_TOP + FLANGE_H * 0.5), "Accent")
    mb.box((HOUSE, HOUSE, H - HOUSE_Z0), (0, 0, (HOUSE_Z0 + H) * 0.5), "SteelDark")
    mb.box((0.50, 0.70, 0.50), (0, -0.65, 0.55), "SteelDark")
    mb.box((0.06, 0.32, 0.22), (BODY * 0.5, 0, 1.50), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((1.70, 1.70, LEG_TOP), (0, 0, LEG_TOP * 0.5), "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - LEG_TOP), (0, 0, (LEG_TOP + BODY_TOP) * 0.5),
           "Steel")
    mb.box((HOUSE, HOUSE, H - HOUSE_Z0), (0, 0, (HOUSE_Z0 + H) * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_drill(mount):
    """The turning column, a child of the bob mount and a SIBLING of LOD0."""
    mb = of.MeshBuilder()
    mb.cylinder(COL_R, COL_H, (0, 0, COL_Z), axis="Z", segments=12, role="Steel")
    # Three flutes proud of the column. Without them a 12-gon cylinder spinning
    # about its own axis is indistinguishable from a static one.
    mb.ring_boxes((0.10, 0.10, COL_H - 0.10), 0.26, 3, (0, 0, COL_Z), "SteelDark")
    mb.cylinder(0.32, 0.10, (0, 0, COL_Z - COL_H * 0.5), axis="Z", segments=12,
                role="SteelDark")
    mb.frustum(0.30, 0.06, (COL_Z - COL_H * 0.5) - BIT_TIP_Z,
               (0, 0, (COL_Z - COL_H * 0.5 + BIT_TIP_Z) * 0.5), axis="Z",
               segments=8, role="Hazard")
    return mb, mb.build("Miner_Drill", mount)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mount = of.add_pivot("Miner_DrillMount", (0, 0, 0), root)
    mbd, drill = build_drill(mount)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_out", (0.0, -HALF, 0.55), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (0.9, 0.9, 1.8), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_status", (HALF, 0.0, 1.50), parent=root,
                  extras={"of_role": "state_light"})
    of.add_socket("socket_drill_tip", (0.0, 0.0, 0.0), parent=root,
                  extras={"of_role": "dig_vfx"})

    # Drill_Spin: 30 frames == MineFerrite.timeTicks, one full turn about Z.
    # Keyed in 120 degree steps: glTF stores rotation as a quaternion, so a
    # two-key 0 -> 360 curve would export as no rotation at all.
    of.add_clip(drill, "Drill_Spin", "rotation_euler",
                [(1, of.deg3(z=0)), (11, of.deg3(z=120)),
                 (21, of.deg3(z=240)), (31, of.deg3(z=360))])
    # Drill_Bob: the mount sinks 80 mm and lifts back over 60 frames.
    of.add_clip(mount, "Drill_Bob", "location",
                [(1, (0, 0, 0.0)), (31, (0, 0, -0.08)), (61, (0, 0, 0.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Miner_Drill", mbd)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
