"""
build_wall.py - Tier-0 structural wall panel.

    blender --background --python tools/blender/build_wall.py

Produces assets/models/dist/structures/wall.glb.

Module 1.00 m wide x 0.25 m thick x 2.50 m tall (structure_common WALL_H /
WALL_T). The origin is centred across the thickness, so the wall is placed ON a
cell EDGE and is shared by the two cells it divides. See structure_common for
why that is the anchor and what happens at a corner.

READ. A framed panel, not a slab: two full-depth corner posts, a bottom and a
top rail, a centre stile and a mid rail, with the Steel field recessed 45 mm
behind the SteelDark frame on both faces. All the cost is in that one depth
step, and it is what makes a 2.5 m wall read as built rather than extruded from
1 m away, which is where the player is standing.

NO ACCENT. The orange is spent entirely on the door (build_door.py). A wall run
is the background a base is read against; if every panel carried a stripe, the
one thing a player actually needs to find at a distance - the way in - would
stop standing out. That is a colour-blocking decision, not a shortage of ideas.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Wall"
OUT = of.dist_path("structures", "wall.glb")

W = sc.CELL
T = sc.WALL_T
H = sc.WALL_H

POST_W = 0.10
RAIL_B = 0.12                    # bottom rail height
RAIL_T = 0.14                    # top rail height
PANEL_T = 0.16                   # field thickness: 45 mm proud of nothing,
                                 # 45 mm recessed behind the 0.25 frame
TRIM_T = 0.20                    # stile / mid rail, between field and frame
MID_Z = 1.55


def _frame(mb):
    """Posts and rails: the parts that set the module dimensions exactly."""
    for s in (-1, 1):
        mb.box((POST_W, T, H), (s * (W * 0.5 - POST_W * 0.5), 0, H * 0.5),
               "SteelDark")
    mb.box((W, T, RAIL_B), (0, 0, RAIL_B * 0.5), "SteelDark")
    mb.box((W, T, RAIL_T), (0, 0, H - RAIL_T * 0.5), "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    _frame(mb)
    mb.box((0.84, PANEL_T, 2.30), (0, 0, 1.20), "Steel")
    mb.box((0.08, TRIM_T, 2.24), (0, 0, 1.22), "SteelDark")
    mb.box((0.84, TRIM_T, 0.08), (0, 0, MID_Z), "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _frame(mb)
    mb.box((0.84, PANEL_T, 2.30), (0, 0, 1.20), "Steel")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, T, H), (0, 0, H * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (W, T, H), (0, 0, H * 0.5), root,
                         role="SteelDark")
    sc.wall_sockets(root)

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    sc.report_bounds(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
