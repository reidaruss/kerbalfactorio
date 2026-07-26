"""
build_survival_smelter.py - Survival smelter, TypeId 0x31
(of::gameplay::structures::Smelter).

    blender --background --python tools/blender/build_survival_smelter.py

Produces assets/models/dist/machines/survival_smelter.glb.

Footprint 2 x 2 m, height 2.0 m. The primitive furnace grown up: the same
stone core, now wrapped in an iron jacket with a proper flue and a bellows box
on the side. It runs the same recipes at 3x the rate, so it must read as three
times the machine while staying visibly the SAME LINEAGE - which is why the
jacket is four separate panels with the stone core showing through the corner
gaps rather than one closed box.

Combustion machine: VisualState 1 overrides to fire orange #FF7A1E at
intensity 2.2. Idle, blocked and no-power stay standard.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "SurvivalSmelter"
OUT = of.dist_path("machines", "survival_smelter.glb")

W = D = 2.00
H = 2.00
HALF = 1.00

PLINTH_H = 0.20
CORE = 1.50
JACKET_Z0, JACKET_Z1 = 0.20, 1.45
CAP_Z = 1.50
FLUE_R, FLUE_Y = 0.18, 0.45
BELLOWS_X = 0.76                # fixed end of the concertina
MOUTH_Z = 0.75


def _hull(mb):
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "Rock")
    mb.box((CORE, CORE, JACKET_Z1 - PLINTH_H),
           (0, 0, (PLINTH_H + JACKET_Z1) * 0.5), "Rock")
    # four separate jacket panels: the corner gaps are where the stone core
    # shows through, which is the whole "same lineage" read
    for sy in (-1, 1):
        mb.box((1.50, 0.10, JACKET_Z1 - PLINTH_H),
               (0, sy * 0.80, (PLINTH_H + JACKET_Z1) * 0.5), "Steel")
        mb.box((0.10, 1.50, JACKET_Z1 - PLINTH_H),
               (sy * 0.80, 0, (PLINTH_H + JACKET_Z1) * 0.5), "Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    _hull(mb)
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.16, 0.16, JACKET_Z1 - PLINTH_H),
                   (sx * 0.79, sy * 0.79, (PLINTH_H + JACKET_Z1) * 0.5),
                   "SteelDark")
    for z in (0.45, 0.95, 1.38):
        mb.box((1.74, 1.74, 0.07), (0, 0, z), "SteelDark")
    mb.box((1.80, 1.80, 0.10), (0, 0, CAP_Z), "Accent")

    mb.cylinder(FLUE_R, 0.55, (0, FLUE_Y, 1.725), axis="Z", segments=10,
                role="Steel")
    mb.cylinder(0.24, 0.06, (0, FLUE_Y, H - 0.03), axis="Z", segments=10,
                role="SteelDark")

    # bellows housing (the concertina itself is the animated sibling)
    mb.box((0.24, 0.74, 0.64), (0.88, 0, 0.90), "SteelDark")
    mb.box((0.06, 0.60, 0.10), (HALF - 0.03, 0, 1.24), "Accent")

    mb.box((0.65, 0.30, 0.45), (0, 0.85, 1.00), "Steel")
    mb.box((0.55, 0.35, 0.30), (0, -0.82, 0.35), "SteelDark")
    mb.box((0.50, 0.22, 0.07), (0, -0.89, 0.70), "Accent")

    # mouth surround and status bezel, then the emissive parts last
    mb.box((0.70, 0.06, 0.58), (0, -0.86, MOUTH_Z), "SteelDark")
    mb.box((0.05, 0.30, 0.24), (0.855, 0.60, 1.15), "SteelDark")
    mb.box((0.55, 0.06, 0.45), (0, -0.88, MOUTH_Z), "EmissiveState")
    mb.box((0.06, 0.24, 0.18), (0.87, 0.60, 1.15), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _hull(mb)
    mb.box((1.80, 1.80, 0.10), (0, 0, CAP_Z), "Accent")
    mb.box((FLUE_R * 2, FLUE_R * 2, 0.55), (0, FLUE_Y, 1.725), "Steel")
    mb.box((0.24, 0.74, 0.64), (0.88, 0, 0.90), "SteelDark")
    mb.box((0.65, 0.30, 0.45), (0, 0.85, 1.00), "Steel")
    mb.box((0.55, 0.35, 0.30), (0, -0.82, 0.35), "SteelDark")
    mb.box((0.55, 0.06, 0.45), (0, -0.88, MOUTH_Z), "EmissiveState")
    mb.box((0.06, 0.24, 0.18), (0.87, 0.60, 1.15), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "Rock")
    mb.box((1.70, 1.70, CAP_Z - PLINTH_H), (0, 0, (PLINTH_H + CAP_Z) * 0.5),
           "Steel")
    mb.box((FLUE_R * 2, FLUE_R * 2, H - CAP_Z), (0, FLUE_Y, (CAP_Z + H) * 0.5),
           "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_bellows(root):
    """Four concertina pleats between the stone core and the bellows housing.

    SPEC CORRECTION (ASSET-SPECS 4.22): the clip scaled the concertina face in
    Y. A bellows mounted on the +X face compresses along X, so it scales in X,
    with the object origin at the FIXED end against the housing so the free
    end travels inward exactly as a real bellows does."""
    mb = of.MeshBuilder()
    for dx in (-0.03, -0.095, -0.16, -0.225):
        mb.box((0.05, 0.66, 0.56), (dx, 0, 0), "SteelDark")
    obj = mb.build("SurvivalSmelter_Bellows", root)
    obj.location = (BELLOWS_X, 0.0, 0.90)
    return mb, obj


def build_glow(root):
    mb = of.MeshBuilder()
    mb.box((0.48, 0.02, 0.38), (0, 0, 0), "EmissiveState")
    obj = mb.build("SurvivalSmelter_Glow", root)
    obj.location = (0.0, -0.90, MOUTH_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbb, bellows = build_bellows(root)
    mbg, glow = build_glow(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in", (0.0, HALF, 1.00), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, 0.35), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_fuel_in", (0.0, -HALF, 0.70), parent=root,
                  extras={"of_role": "fuel_in"})
    of.add_socket("socket_bellows", (HALF, 0.0, 0.90), parent=root,
                  extras={"of_role": "bellows"})
    of.add_socket("socket_smoke", (0.0, FLUE_Y, H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (HALF, 0.60, 1.15), parent=root,
                  extras={"of_role": "state_light"})

    # 60 frames == ticksPerSmeltFor(Smelter). The two clips are phase locked:
    # the fire peaks at frame 31, exactly when the bellows bottoms out, so the
    # machine reads as a single mechanism rather than two loops.
    of.add_clip(bellows, "Smelter_Bellows", "scale",
                [(1, (1.00, 1.0, 1.0)), (31, (0.55, 1.0, 1.0)),
                 (61, (1.00, 1.0, 1.0))])
    of.add_clip(glow, "Furnace_Glow", "scale",
                [(1, (1.00, 1.0, 1.00)), (31, (1.12, 1.0, 1.12)),
                 (61, (1.00, 1.0, 1.00))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Bellows", mbb), ("Glow", mbg)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
