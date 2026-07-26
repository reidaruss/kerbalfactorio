"""
build_door.py - Tier-0 structural door: a wall cell with a way through it.

    blender --background --python tools/blender/build_door.py

Produces assets/models/dist/structures/door.glb.

Exactly the wall module - 1.00 x 0.25 x 2.50 m - so a door drops into any cell
of any wall run with no special case in the placement code. Clear opening
0.76 m wide by 2.10 m tall above the deck, which passes the 0.60 m player body
(ASSET-SPECS 3.1) with 80 mm either side.

WHY THE DOOR IS ONE CELL AND NOT TWO. Two cells would buy a 1.0 m opening and
cost the property that makes this set usable: that every structural part is one
module, so a wall run is a list of cells and any cell can become a door without
re-planning the run. A 0.76 m opening is a real door (interior doors are
0.7 to 0.8 m); a build system where the door is the one part that does not fit
the grid is not.

IT HAS TO READ AS A DOOR FROM OUTSIDE, and at 30 m the opening itself is a dark
smudge that reads exactly like a shadow. So the frame's outward face is built as
a facia layer 50 mm proud of a recessed core, and the top 160 mm of that facia
is the ONLY OF_Accent in the whole structural set: an orange lintel band over
the opening. That band is the entire reason the wall (build_wall.py) is
deliberately monochrome. Up close, the recessed leaf, its push bar and the
hazard threshold finish the read.

THE LEAF IS A SEPARATE OBJECT under a hinge Empty on the left jamb's inner
face, so Door_Swing drives one object's rotation and frame 1 is the identity
(the exported static pose is a CLOSED door, which is what a door at rest is).

COLLISION IS THREE BOXES, NOT ONE. One convex proxy per asset (ASSET-SPECS 2.5)
is the rule for a solid machine; a convex hull of a doorway is a sealed wall.
Two jambs and a header leave the opening genuinely walk-through, which is the
only thing the part exists to do. The 40 mm threshold is a step-over and carries
no proxy. The leaf carries none either: a swinging collider is a physics
decision, and until the placement lane says otherwise the doorway is open.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Door"
OUT = of.dist_path("structures", "door.glb")

W = sc.CELL
T = sc.WALL_T
H = sc.WALL_H

FACIA_T = 0.05                       # outward face layer, y -0.125 .. -0.075
CORE_T = T - FACIA_T                 # 0.20,               y -0.075 .. +0.125
FACIA_Y = -(T - FACIA_T) * 0.5       # -0.10
CORE_Y = FACIA_T * 0.5               # +0.025

JAMB_W = sc.JAMB_W                   # 0.12
JAMB_X = (W - JAMB_W) * 0.5          # 0.44
HEAD_Z0 = sc.DOOR_H                  # 2.10
BAND_H = 0.16                        # the accent lintel, z 2.34 .. 2.50
SILL_H = 0.04

LEAF_W, LEAF_T = 0.72, 0.06
LEAF_Z0, LEAF_Z1 = 0.04, 2.06
LEAF_X = 0.38                        # leaf centre in hinge-local space


def build_lod0(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, CORE_T, H), (s * JAMB_X, CORE_Y, H * 0.5), "SteelDark")
        mb.box((JAMB_W, FACIA_T, HEAD_Z0),
               (s * JAMB_X, FACIA_Y, HEAD_Z0 * 0.5), "SteelDark")
    mb.box((W, CORE_T, H - HEAD_Z0), (0, CORE_Y, (HEAD_Z0 + H) * 0.5),
           "SteelDark")
    # The outward facia over the head, split so the two colours occupy DISJOINT
    # z ranges on the same plane. Stacking them would put two coplanar faces on
    # y = -0.125, which is the one arrangement that genuinely z-fights.
    mb.box((W, FACIA_T, H - BAND_H - HEAD_Z0),
           (0, FACIA_Y, (HEAD_Z0 + H - BAND_H) * 0.5), "SteelDark")
    mb.box((W, FACIA_T, BAND_H), (0, FACIA_Y, H - BAND_H * 0.5), "Accent")
    mb.box((sc.DOOR_W, T, SILL_H), (0, 0, SILL_H * 0.5), "Hazard")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, T, H), (s * JAMB_X, 0, H * 0.5), "SteelDark")
    mb.box((W, CORE_T, H - HEAD_Z0), (0, CORE_Y, (HEAD_Z0 + H) * 0.5),
           "SteelDark")
    # Full-height accent facia at LOD1: at 25 to 80 m the band IS the door.
    mb.box((W, FACIA_T, H - HEAD_Z0), (0, FACIA_Y, (HEAD_Z0 + H) * 0.5),
           "Accent")
    mb.box((sc.DOOR_W, T, SILL_H), (0, 0, SILL_H * 0.5), "Hazard")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, T, H), (s * JAMB_X, 0, H * 0.5), "SteelDark")
    mb.box((W, T, H - HEAD_Z0), (0, 0, (HEAD_Z0 + H) * 0.5), "Accent")
    return mb, mb.build(NAME + "_LOD2", root)


def build_leaf(hinge):
    """The swinging leaf, authored in HINGE-LOCAL space so the clip is a plain
    rotation of the pivot and the leaf's own transform stays the identity."""
    mb = of.MeshBuilder()
    mb.box((LEAF_W, LEAF_T, 1.94), (LEAF_X, 0, (LEAF_Z0 + LEAF_Z1) * 0.5 + 0.04),
           "Steel")
    mb.box((LEAF_W, 0.08, 0.12), (LEAF_X, 0, LEAF_Z0 + 0.06), "SteelDark")
    mb.box((LEAF_W, 0.08, 0.10), (LEAF_X, 0, LEAF_Z1 - 0.05), "SteelDark")
    for z in (0.35, 1.75):
        mb.box((0.06, 0.08, 0.10), (0.02, 0, z), "SteelDark")
    mb.box((0.34, 0.06, 0.06), (0.52, -(LEAF_T * 0.5 + 0.025), 1.02), "Accent")
    return mb, mb.build(NAME + "_Leaf", hinge)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    hinge = of.add_pivot("door_hinge", (sc.HINGE_X, 0.0, 0.0), parent=root)
    mbl, _ = build_leaf(hinge)

    of.add_collision_box("col_Door_JambL", (JAMB_W, T, H),
                         (-JAMB_X, 0, H * 0.5), root, role="SteelDark")
    of.add_collision_box("col_Door_JambR", (JAMB_W, T, H),
                         (JAMB_X, 0, H * 0.5), root, role="SteelDark")
    of.add_collision_box("col_Door_Header", (W, T, H - HEAD_Z0),
                         (0, 0, (HEAD_Z0 + H) * 0.5), root, role="SteelDark")

    sc.wall_sockets(root)
    of.add_socket("socket_hinge", (sc.HINGE_X, 0.0, 0.0), parent=root,
                  extras={"of_role": "hinge"})

    # 25 frames at 60 fps is 0.42 s, which is a door being pushed rather than a
    # door easing open. Keyed in two steps because glTF stores rotation as a
    # quaternion and a single key pair at 95 degrees would still interpolate,
    # but a mid key keeps the arc where an author put it.
    of.add_clip(hinge, "Door_Swing", "rotation_euler",
                [(1, of.deg3(z=0.0)), (13, of.deg3(z=-50.0)),
                 (25, of.deg3(z=-95.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Leaf", mbl)])
    sc.report_bounds(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                            ("Leaf(local)", mbl)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
