"""
build_generator.py - Generator, TypeId 0x15 (of::gameplay::types::Generator).

    blender --background --python tools/blender/build_generator.py

Produces assets/models/dist/machines/generator.glb.

Footprint 3 x 2 m, height 2.6 m. A horizontal boiler on a skid with a large
flywheel on one end and a tall offset exhaust stack.

This is the only machine whose animation must read from across the whole base,
because "is my power on" is the question players ask most. The flywheel is
therefore deliberately oversized and carries four raised spokes and a bright
crank-pin boss: a smooth 16-gon disc turning about its own axis is visually
identical to a stationary one, and a stopped generator that looks like a
running one is the single worst readability failure this machine can have.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Generator"
OUT = of.dist_path("machines", "generator.glb")

W, D, H = 3.00, 2.00, 2.60
HX, HY = 1.50, 1.00             # the hard edges nothing may cross

SKID_H = 0.30
BOIL_R = 0.65
BOIL_L = 2.20
BOIL_Z = 1.10
WHEEL_X = 1.35
WHEEL_R = 0.60
STACK_XY = (-0.90, 0.55)
STACK_R = 0.20


def _hull(mb):
    """Skid and boiler: the read every LOD keeps."""
    mb.box((W, D, SKID_H), (0, 0, SKID_H * 0.5), "SteelDark")
    mb.cylinder(BOIL_R, BOIL_L, (0, 0, BOIL_Z), axis="X", segments=16,
                role="Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    _hull(mb)
    for sx in (-1, 1):
        mb.cylinder(0.70, 0.10, (sx * (BOIL_L * 0.5), 0, BOIL_Z), axis="X",
                    segments=12, role="SteelDark")
        mb.box((0.30, 1.40, 0.55), (sx * 0.70, 0, SKID_H + 0.275), "SteelDark")
    for x in (-0.70, 0.0, 0.70):
        mb.cylinder(0.68, 0.06, (x, 0, BOIL_Z), axis="X", segments=12,
                    role="SteelDark")

    # exhaust stack, offset to the back corner, carrying the full 2.60 m
    mb.box((0.50, 0.50, 0.12), (STACK_XY[0], STACK_XY[1], 1.30), "SteelDark")
    mb.cylinder(STACK_R, 1.24, (STACK_XY[0], STACK_XY[1], 1.98), axis="Z",
                segments=10, role="Steel")
    mb.cylinder(0.26, 0.06, (STACK_XY[0], STACK_XY[1], H - 0.03), axis="Z",
                segments=10, role="SteelDark")

    # solid-fuel hopper, flush with the -Y cell edge
    mb.box((0.70, 0.60, 0.70), (0.60, -0.70, 0.65), "Steel")
    mb.box((0.78, 0.10, 0.10), (0.60, -HY + 0.05, 1.03), "Accent")

    # power take-off mast under socket_power_out
    mb.box((0.12, 0.12, 1.90), (-1.42, 0, 1.25), "Steel")
    mb.box((0.16, 0.24, 0.24), (-HX + 0.08, 0, 2.00), "SteelDark")

    # skid edge hazard stripes: the ends are where a player walks into it
    for sx in (-1, 1):
        mb.box((0.16, D, 0.04), (sx * 1.42, 0, SKID_H + 0.02), "Hazard")

    # firebox housing, then the status stalk. Emissive parts last.
    mb.box((0.90, 0.40, 0.70), (-0.35, -0.75, 0.65), "SteelDark")
    mb.box((0.40, 0.12, 0.12), (1.28, 0, 1.78), "Steel")
    mb.box((0.05, 0.40, 0.30), (1.465, 0, 1.80), "SteelDark")

    # --- state surfaces: firebox grate (combustion override) + status chip ---
    mb.box((0.60, 0.06, 0.35), (-0.35, -0.95, 0.60), "EmissiveState")
    mb.box((0.04, 0.32, 0.22), (1.478, 0, 1.80), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.box((W, D, SKID_H), (0, 0, SKID_H * 0.5), "SteelDark")
    mb.cylinder(BOIL_R, BOIL_L, (0, 0, BOIL_Z), axis="X", segments=12,
                role="Steel")
    for sx in (-1, 1):
        mb.box((0.30, 1.40, 0.55), (sx * 0.70, 0, SKID_H + 0.275), "SteelDark")
    mb.box((STACK_R * 2, STACK_R * 2, 1.30),
           (STACK_XY[0], STACK_XY[1], 1.95), "Steel")
    mb.box((0.70, 0.60, 0.70), (0.60, -0.70, 0.65), "Steel")
    mb.box((0.90, 0.40, 0.70), (-0.35, -0.75, 0.65), "SteelDark")
    mb.box((0.60, 0.06, 0.35), (-0.35, -0.95, 0.60), "EmissiveState")
    mb.box((0.04, 0.32, 0.22), (1.478, 0, 1.80), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, SKID_H), (0, 0, SKID_H * 0.5), "SteelDark")
    mb.box((BOIL_L, BOIL_R * 2, BOIL_R * 2), (0, 0, BOIL_Z), "Steel")
    mb.box((STACK_R * 2, STACK_R * 2, 1.30),
           (STACK_XY[0], STACK_XY[1], 1.95), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_flywheel(root):
    """Built about its OWN origin so Gen_Flywheel is a plain rotation, and a
    SIBLING of _LOD0 so the wheel's swept volume never enters the footprint
    check. Everything stays inside the 3 x 2 cell at every angle: the wheel
    sweeps a circle of radius 0.60 about (y=0, z=1.10)."""
    mb = of.MeshBuilder()
    mb.cylinder(WHEEL_R, 0.18, (0, 0, 0), axis="X", segments=16, role="Steel")
    for dy, dz in ((0.30, 0), (-0.30, 0), (0, 0.30), (0, -0.30)):
        size = (0.06, 0.14, 0.50) if dz == 0 else (0.06, 0.50, 0.14)
        mb.box(size, (0.11, dy, dz), "SteelDark")
    mb.cylinder(0.14, 0.26, (0, 0, 0), axis="X", segments=12, role="SteelDark")
    mb.cylinder(0.07, 0.16, (0.06, 0.40, 0), axis="X", segments=12,
                role="Accent")
    obj = mb.build("Generator_Flywheel", root)
    obj.location = (WHEEL_X, 0.0, BOIL_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbw, wheel = build_flywheel(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_fuel_in", (0.60, -HY, 0.90), parent=root,
                  extras={"of_role": "fuel_in"})
    of.add_socket("socket_power_out", (-1.40, 0.0, 2.00), parent=root,
                  extras={"of_role": "power_out"})
    of.add_socket("socket_smoke", (STACK_XY[0], STACK_XY[1], H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (HX, 0.0, 1.80), parent=root,
                  extras={"of_role": "state_light"})

    # Gen_Flywheel: 120 frames == BurnCombustite.timeTicks, two full turns per
    # burn. Keyed in 120 degree steps so the quaternion slerp cannot shortcut
    # or stall (see of_lib.add_clip).
    of.add_clip(wheel, "Gen_Flywheel", "rotation_euler",
                [(1 + i * 20, of.deg3(x=120 * i)) for i in range(7)])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Generator_Flywheel", mbw)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
