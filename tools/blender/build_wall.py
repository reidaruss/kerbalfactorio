"""
build_wall.py - Tier-0 structural wall panel.

    blender --background --python tools/blender/build_wall.py

Produces assets/models/dist/structures/wall.glb.

Module 4.00 m wide x 0.25 m thick x 3.50 m tall (structure_common WALL_H /
WALL_T). The origin is centred across the thickness, so the wall is placed ON a
cell EDGE and is shared by the two cells it divides. See structure_common for
why that is the anchor and what happens at a corner.

RESCALED 2026-07-26 (DW-32). WIDTH scaled with the plan module, 1.00 -> 4.00.
THICKNESS did not, and that is the point: 0.25 m is what a wall physically is,
and a 1 m thick partition would be a blast wall. HEIGHT went 2.50 -> 3.50, which
is not a scale either: it is the number that stops a 4 m wide bay reading squat,
and the number that makes DECK_H + WALL_H = STOREY = CELL = 4.00 exactly, so the
plan lattice and the vertical lattice became one number.

READ. A framed panel, not a slab: two full-depth corner posts, a bottom and a
top rail, THREE full-depth mullions on the 1 m voxel lines and a mid rail, with
the Steel field recessed 45 mm behind the SteelDark frame on both faces. All the
cost is in that one depth step, and it is what makes the wall read as built
rather than extruded from the 2 m away the player is standing.

THE MULLIONS ARE WHAT THE RESCALE BOUGHT. A 1 m panel needed one centre stile;
a 4 m panel with one centre stile is two 1.8 m sheets of nothing. Three mullions
put the panel back on a roughly 0.92 m rhythm, which is close to the old whole
module, so a 4 m wall reads as four bays of the size a player already learned.
They are full depth rather than applied trim because at this size they have to
be believable as the thing carrying the wall, not as a moulding on it.

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

POST_W = 0.16                    # end posts, outer faces exactly on +/-2.00
RAIL_B = 0.16                    # bottom rail height
RAIL_T = 0.18                    # top rail height
MULLION_W = 0.12
MULLION_AT = (-1.0, 0.0, 1.0)    # the 1 m voxel lines: four bays of 0.92 m
PANEL_T = 0.16                   # field thickness: 45 mm recessed behind the
                                 # 0.25 frame on BOTH faces
TRIM_T = 0.20                    # mid rail, between field and frame

FIELD_W = W - 2.0 * POST_W       # 3.68, post inner face to post inner face
FIELD_H = H - RAIL_B - RAIL_T    # 3.16, rail to rail
FIELD_Z = (RAIL_B + H - RAIL_T) * 0.5    # 1.74
MID_Z = 1.70                     # mid rail centre, a shade below mid height so
                                 # the taller bay is the one at eye level


def _frame(mb):
    """Posts and rails: the parts that set the module dimensions exactly."""
    for s in (-1, 1):
        mb.box((POST_W, T, H), (s * (W * 0.5 - POST_W * 0.5), 0, H * 0.5),
               "SteelDark")
    mb.box((W, T, RAIL_B), (0, 0, RAIL_B * 0.5), "SteelDark")
    mb.box((W, T, RAIL_T), (0, 0, H - RAIL_T * 0.5), "SteelDark")


def _field(mb):
    mb.box((FIELD_W, PANEL_T, FIELD_H), (0, 0, FIELD_Z), "Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    _frame(mb)
    _field(mb)
    for x in MULLION_AT:
        mb.box((MULLION_W, T, FIELD_H), (x, 0, FIELD_Z), "SteelDark")
    mb.box((FIELD_W, TRIM_T, 0.12), (0, 0, MID_Z), "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _frame(mb)
    _field(mb)
    mb.box((MULLION_W, T, FIELD_H), (0, 0, FIELD_Z), "SteelDark")
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
