"""
build_power_pole.py - Power pole, TypeId 0x16 (of::gameplay::types::PowerPole).

    blender --background --python tools/blender/build_power_pole.py

Produces assets/models/dist/machines/power_pole.glb.

Footprint 1 x 1 m, height 4.0 m. A slim four-leg lattice mast splayed from
0.35 m at the base to 0.14 m at the top, a crossarm with two insulator caps,
and a supply lamp at 0.6 m where a player standing next to it can read it
without looking up 4 metres.

TWO SPEC CORRECTIONS (docs/web/ASSET-SPECS.md 4.19), both forced by the
whole-metre footprint rule in 2.2:

  - The crossarm was 1.10 m with sockets at +/-0.55. That is 50 mm of overhang
    past the 1 m cell on each side, which is exactly the class of bug the
    validator exists to catch. Crossarm is now 1.00 m, tangent to the cell
    edge by construction, with sockets at +/-0.42 on the insulator caps.
  - A bare lattice mast has a mesh footprint of only ~0.41 m, so nothing in
    the file would have proved the pole occupies its cell. It now stands on a
    1.00 x 1.00 m foundation pad, which makes the occupied cell legible on the
    ground during placement and makes the AABB check meaningful.

Legs are splayed, and MeshBuilder emits axis-aligned boxes, so each leg is
three stacked segments marching inward. At 4 m and 0.06 m section the steps
are well under a pixel of silhouette error, and it costs 144 triangles against
a hand-rotated leg's need for a whole transform path.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "PowerPole"
OUT = of.dist_path("machines", "power_pole.glb")

W = D = 1.00
H = 4.00
PAD_H = 0.08
LEG = 0.08
MAST_TOP = 3.75                 # crossarm height
SPLAY_BASE, SPLAY_TOP = 0.35, 0.14
SEGMENTS = 3
ARM_W = 1.00                    # tangent to the cell edge, never past it
INSUL_X = 0.42
INSUL_R = 0.08                  # 0.42 + 0.08 == 0.50 exactly
LAMP_Z = 0.60


def _splay(z):
    t = min(1.0, max(0.0, z / MAST_TOP))
    return SPLAY_BASE + (SPLAY_TOP - SPLAY_BASE) * t


def _legs(mb, segments):
    seg_h = (MAST_TOP - PAD_H) / segments
    for i in range(segments):
        z = PAD_H + seg_h * (i + 0.5)
        r = _splay(z)
        for sx in (-1, 1):
            for sy in (-1, 1):
                mb.box((LEG, LEG, seg_h), (sx * r, sy * r, z), "Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PAD_H), (0, 0, PAD_H * 0.5), "SteelDark")
    _legs(mb, SEGMENTS)
    # cross bracing: one X-brace per level, cheaper than a perimeter ring and
    # it is what actually reads as "lattice" in silhouette
    for z in (1.05, 2.05, 3.05):
        r = _splay(z)
        mb.box((2 * r, 0.05, 0.05), (0, 0, z), "SteelDark")
        mb.box((0.05, 2 * r, 0.05), (0, 0, z), "SteelDark")
    mb.box((ARM_W, 0.10, 0.10), (0, 0, MAST_TOP), "Steel")
    mb.box((0.22, 0.22, 0.16), (0, 0, MAST_TOP + 0.05), "SteelDark")
    for sx in (-1, 1):
        mb.frustum(INSUL_R, 0.05, 0.20, (sx * INSUL_X, 0, 3.90), axis="Z",
                   segments=8, role="SteelDark")
    # supply lamp on a leg at eye level. Bezel then chip: emissive stays last.
    lr = _splay(LAMP_Z)
    mb.box((0.16, 0.16, 0.18), (lr, -lr, LAMP_Z), "SteelDark")
    mb.box((0.11, 0.11, 0.12), (lr + 0.04, -lr - 0.04, LAMP_Z),
           "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PAD_H), (0, 0, PAD_H * 0.5), "SteelDark")
    _legs(mb, 1)
    mb.box((ARM_W, 0.10, 0.10), (0, 0, MAST_TOP), "Steel")
    for sx in (-1, 1):
        mb.frustum(INSUL_R, 0.05, 0.20, (sx * INSUL_X, 0, 3.90), axis="Z",
                   segments=6, role="SteelDark")
    lr = _splay(LAMP_Z)
    mb.box((0.11, 0.11, 0.12), (lr + 0.04, -lr - 0.04, LAMP_Z),
           "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PAD_H), (0, 0, PAD_H * 0.5), "SteelDark")
    mb.box((0.24, 0.24, MAST_TOP - PAD_H), (0, 0, (PAD_H + MAST_TOP) * 0.5),
           "Steel")
    mb.box((ARM_W, 0.10, 0.10), (0, 0, MAST_TOP), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (0.40, 0.40, H), (0, 0, H * 0.5), root)

    # Wires are runtime catenary THREE.Line geometry between the socket_wire_*
    # nodes of connected poles, never authored geometry.
    of.add_socket("socket_wire_a", (-INSUL_X, 0.0, 3.95), parent=root,
                  extras={"of_role": "wire"})
    of.add_socket("socket_wire_b", (INSUL_X, 0.0, 3.95), parent=root,
                  extras={"of_role": "wire"})
    lr = _splay(LAMP_Z)
    of.add_socket("socket_status", (lr + 0.06, -lr - 0.06, LAMP_Z),
                  parent=root, extras={"of_role": "state_light"})

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
