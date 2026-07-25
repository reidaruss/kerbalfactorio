"""
build_smelter.py - Smelter, TypeId 0x12 (of::gameplay::types::Smelter).

    blender --background --python tools/blender/build_smelter.py

Produces assets/models/dist/machines/smelter.glb.

Footprint 2 x 2 m, height 2.6 m. A brick-and-steel kiln: wide base, chamfered
collar, and a short chimney offset toward the BACK. The offset is the whole
reason this does not read as a generic box next to the miner, and it is what
tells a player at 40 m which way the machine faces.

Combustion machine (ASSET-SPECS 2.3): VisualState 1 "working" overrides to
fire orange #FF7A1E at intensity 2.2 rather than the standard green. Idle,
blocked and no-power stay standard so the scanning rule still holds.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Smelter"
OUT = of.dist_path("machines", "smelter.glb")

W = D = 2.00
H = 2.60
HALF = 1.00                     # the hard edge nothing may cross

PLINTH_H = 0.25
BODY = 1.70
BODY_HALF = BODY * 0.5          # 0.85
BODY_TOP = 1.85
COLLAR_H = 0.14
CHIM_R = 0.22
CHIM_Y = 0.50                   # offset toward the back
DOOR_Z = 0.75


def _shell(mb):
    """Plinth, body and collar: the parts every LOD keeps."""
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + BODY_TOP) * 0.5), "Steel")
    mb.box((1.86, 1.86, COLLAR_H), (0, 0, BODY_TOP - COLLAR_H * 0.5), "Accent")


def build_lod0(root):
    mb = of.MeshBuilder()
    _shell(mb)

    # exposed refractory brick at the corners: the smelter's one non-steel read
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.22, 0.22, BODY_TOP - PLINTH_H - COLLAR_H),
                   (sx * 0.74, sy * 0.74,
                    (PLINTH_H + BODY_TOP - COLLAR_H) * 0.5), "Rock")
    # jacket bands and vertical seam straps
    for z in (0.70, 1.30):
        mb.box((1.74, 1.74, 0.08), (0, 0, z), "SteelDark")
    for sx in (-1, 1):
        for y in (-0.35, 0.35):
            mb.box((0.05, 0.14, 1.30), (sx * BODY_HALF, y, 1.05), "SteelDark")
        for x in (-0.35, 0.35):
            mb.box((0.14, 0.05, 1.30), (x, sx * BODY_HALF, 1.05), "SteelDark")

    # chimney, offset to +Y, carrying the machine to its full 2.60 m
    mb.cylinder(CHIM_R, 0.69, (0, CHIM_Y, BODY_TOP + 0.345), axis="Z",
                segments=10, role="Steel")
    mb.cylinder(0.28, 0.06, (0, CHIM_Y, H - 0.03), axis="Z", segments=10,
                role="SteelDark")

    # input hopper on +Y, flush with the cell edge
    mb.box((0.70, 0.30, 0.50), (0, 0.85, 0.90), "Steel")
    mb.box((0.78, 0.08, 0.10), (0, HALF - 0.04, 1.13), "Accent")
    # output chute on -Y
    mb.box((0.60, 0.40, 0.35), (0, -0.80, 0.35), "SteelDark")
    mb.box((0.66, 0.08, 0.10), (0, -HALF + 0.04, 0.22), "Accent")

    # firebox surround and status bezel go down BEFORE the emissive parts, so
    # OF_EmissiveState is always the LAST material slot on every mesh.
    mb.box((0.86, 0.05, 0.76), (0, -BODY_HALF - 0.005, DOOR_Z), "SteelDark")
    mb.box((0.05, 0.40, 0.30), (BODY_HALF - 0.01, 0, 1.30), "SteelDark")
    mb.box((0.16, 0.16, 0.20), (0.78, 0.78, 1.75), "Steel")

    # --- state surfaces: firebox door and vent slot ---
    mb.box((0.70, 0.06, 0.60), (0, -BODY_HALF, DOOR_Z), "EmissiveState")
    mb.box((0.50, 0.05, 0.08), (0, -BODY_HALF - 0.005, 1.35), "EmissiveState")
    mb.box((0.06, 0.32, 0.22), (BODY_HALF, 0, 1.30), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _shell(mb)
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.22, 0.22, BODY_TOP - PLINTH_H - COLLAR_H),
                   (sx * 0.74, sy * 0.74,
                    (PLINTH_H + BODY_TOP - COLLAR_H) * 0.5), "Rock")
    mb.box((CHIM_R * 2, CHIM_R * 2, H - BODY_TOP),
           (0, CHIM_Y, (BODY_TOP + H) * 0.5), "Steel")
    mb.box((0.70, 0.30, 0.50), (0, 0.85, 0.90), "Steel")
    mb.box((0.60, 0.40, 0.35), (0, -0.80, 0.35), "SteelDark")
    mb.box((0.70, 0.06, 0.60), (0, -BODY_HALF, DOOR_Z), "EmissiveState")
    mb.box((0.06, 0.32, 0.22), (BODY_HALF, 0, 1.30), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + BODY_TOP) * 0.5), "Steel")
    mb.box((CHIM_R * 2, CHIM_R * 2, H - BODY_TOP),
           (0, CHIM_Y, (BODY_TOP + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_glow(root):
    """The glow card behind the firebox door. Built centred on its OWN origin
    so the scale clip pulses it in place instead of sliding it toward 0,0,0."""
    mb = of.MeshBuilder()
    mb.box((0.60, 0.02, 0.50), (0, 0, 0), "EmissiveState")
    obj = mb.build("Smelter_Glow", root)
    obj.location = (0.0, -BODY_HALF + 0.03, DOOR_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbg, glow = build_glow(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in", (0.0, HALF, 0.90), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, 0.45), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (0.85, 0.85, 1.85), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_smoke", (0.0, CHIM_Y, H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (HALF, 0.0, 1.30), parent=root,
                  extras={"of_role": "state_light"})

    # Furnace_Glow: 60 frames == SmeltFerrite.timeTicks.
    # Preferred at runtime: drive emissiveIntensity from AnimPhase and drop the
    # clip entirely. It ships so the asset is complete without shader work.
    of.add_clip(glow, "Furnace_Glow", "scale",
                [(1, (1.0, 1.0, 1.0)), (31, (1.08, 1.0, 1.08)),
                 (61, (1.0, 1.0, 1.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Smelter_Glow", mbg)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
