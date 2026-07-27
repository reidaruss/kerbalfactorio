"""
build_door.py - Tier-0 structural door: a wall cell with a way through it.

    blender --background --python tools/blender/build_door.py

Produces assets/models/dist/structures/door.glb.

Exactly the wall module - 4.00 x 0.25 x 3.50 m - so a door drops into any cell
of any wall run with no special case in the placement code. Clear opening
1.20 m wide by 2.40 m tall above the deck, which passes the 0.60 m player body
(ASSET-SPECS 3.1) twice over, which is what a doorway carrying equipment wants.

THE DOOR IS STILL ONE FULL CELL, AND THE OPENING DELIBERATELY DID NOT SCALE.
This is the whole decision at a 4 m module (DW-32), and it has two halves.

  The panel stays one cell, because the property that makes this set usable is
  that EVERY structural part is one module: a wall run is a list of cells, and
  any cell can become a door without re-planning the run. A sub-cell door would
  need a second, finer lattice for wall furniture, and no part of the placement
  system has one; adding it to buy a narrower door would make the door the one
  part that does not fit the grid.

  The opening stays person-scale, because a full-cell opening at 4 m is a garage
  door, not a door. So the PANEL is 4 m and the HOLE in it is 1.20 m.

WHICH LEAVES 1.40 m OF WALL EITHER SIDE, and that is the thing to design for.
Treat this part as a WALL PANEL THAT HAPPENS TO HAVE A DOORWAY IN IT: it carries
the wall's own framing language across the full 4 m (the same 0.16 corner posts,
the same bottom and top rails, mullions on the same 1 m voxel lines at x = +/-1,
the same recessed field behind the same mid rail), and the doorway is cut out of
the middle bay. Stand it in a run and it reads as one of the wall panels, which
is exactly what it should read as until you need to go through it.

IT HAS TO READ AS A DOOR FROM OUTSIDE, and at 30 m the opening itself is a dark
smudge that reads exactly like a shadow. So the head's outward face is built as
a facia layer 50 mm proud of a recessed core, and the bottom 200 mm of that
facia is the ONLY OF_Accent in the whole structural set: an orange lintel band
sitting directly on the header. That band is the entire reason the wall
(build_wall.py) is deliberately monochrome.

THE BAND SPANS THE DOORWAY, NOT THE PANEL. 1.92 m: the opening plus its two
jamb returns, which is the door surround and nothing else. The 1 m door's band
was the whole panel width; stretched across four metres that stops being a door
marker and becomes a stripe, and a stripe on every fourth panel is noise. Up
close, the recessed leaf, its push bar and the hazard threshold finish the read.

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

# --- the wall's own framing language, carried across the full 4 m ----------
POST_W = 0.16                        # matches build_wall.POST_W exactly
RAIL_B = 0.16
RAIL_T = 0.18
MULLION_W = 0.12
MULLION_AT = (-1.0, 1.0)             # the wall's x = 0 mullion is the doorway
PANEL_T = 0.16
TRIM_T = 0.20
FIELD_H = H - RAIL_B - RAIL_T        # 3.16
FIELD_Z = (RAIL_B + H - RAIL_T) * 0.5   # 1.74
MID_Z = 1.70

# --- the doorway ----------------------------------------------------------
FACIA_T = 0.05                       # outward face layer, y -0.125 .. -0.075
CORE_T = T - FACIA_T                 # 0.20,               y -0.075 .. +0.125
FACIA_Y = -(T - FACIA_T) * 0.5       # -0.10
CORE_Y = FACIA_T * 0.5               # +0.025

JAMB_W = sc.JAMB_W                   # 1.40, the wall either side of the opening
JAMB_X = (W - JAMB_W) * 0.5          # 1.30
HEAD_Z0 = sc.DOOR_H                  # 2.40, the clear head height

# The doorway surround, a uniform 0.36 all round. That width is not a taste
# call: it is what makes the surround's outer face land ON the wall's mullion at
# x = +/-1.00 (overlapping it by 20 mm, because touching solids are fine but
# coincident faces are the one thing that z-fights). The doorway therefore
# occupies the panel's middle bay EXACTLY, and the two bays left over are 0.78 m
# each, which is the wall panel's own outer bay width to the millimetre. Any
# narrower and the leftover strip beside the surround is a 0.20 m sliver that
# reads as a mistake; this way the door is the wall's rhythm with one bay
# opened up.
FRAME_W = 0.36
FRAME_X = (sc.DOOR_W + FRAME_W) * 0.5        # 0.78
FRAME_OUT = sc.DOOR_W + 2.0 * FRAME_W        # 1.92, opening + both returns
FRAME_TOP = HEAD_Z0 + FRAME_W                # 2.76, top of the door surround

BAND_H = 0.20                        # the accent lintel, z 2.76 .. 2.96
SILL_H = 0.04

# The side field runs from the corner post's inner face to the door surround.
SIDE_W = (W * 0.5 - POST_W) - FRAME_OUT * 0.5        # 0.88
SIDE_X = (W * 0.5 - POST_W + FRAME_OUT * 0.5) * 0.5  # 1.40

LEAF_W = sc.DOOR_W - 0.02            # 1.18, 10 mm of clearance either side
LEAF_H = sc.DOOR_H - 0.04            # 2.36, 20 mm top and bottom
LEAF_Z0 = 0.02
LEAF_X = -sc.HINGE_X                 # 0.60: leaf centre in hinge-local space,
                                     # which puts it on the opening centreline
LEAF_FIELD_T = 0.05                  # the leaf's own recessed field
LEAF_FRAME_T = 0.06                  # its rails and stiles, 5 mm proud
BAR_Y = -0.065                       # push bar, standing off the outward face


def _panel(mb):
    """Everything the door shares with a plain wall panel: the outer frame, the
    two surviving mullions, the two side fields and their mid rails. Changing a
    number here without changing build_wall is how the door starts looking like
    a different part in a run, so these constants are copies by name, not by
    coincidence."""
    for s in (-1, 1):
        mb.box((POST_W, T, H), (s * (W * 0.5 - POST_W * 0.5), 0, H * 0.5),
               "SteelDark")
        # The bottom rail survives only outside the opening, which is exactly
        # the jamb: JAMB_W wide, centred on JAMB_X.
        mb.box((JAMB_W, T, RAIL_B), (s * JAMB_X, 0, RAIL_B * 0.5), "SteelDark")
        mb.box((SIDE_W, PANEL_T, FIELD_H), (s * SIDE_X, 0, FIELD_Z), "Steel")
        mb.box((SIDE_W, TRIM_T, 0.12), (s * SIDE_X, 0, MID_Z), "SteelDark")
    mb.box((W, T, RAIL_T), (0, 0, H - RAIL_T * 0.5), "SteelDark")
    for x in MULLION_AT:
        mb.box((MULLION_W, T, FIELD_H), (x, 0, FIELD_Z), "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    _panel(mb)
    # The door surround: two posts and a header, whose INNER faces are the clear
    # opening. Everything about the opening is measured off these.
    for s in (-1, 1):
        mb.box((FRAME_W, T, FRAME_TOP), (s * FRAME_X, 0, FRAME_TOP * 0.5),
               "SteelDark")
    mb.box((FRAME_OUT, T, FRAME_W), (0, 0, HEAD_Z0 + FRAME_W * 0.5), "SteelDark")
    # Above the surround, up to the top rail: a recessed core with an outward
    # facia. The facia is split so the two colours occupy DISJOINT z ranges on
    # the same plane; stacking them would put two coplanar faces on y = -0.125,
    # which is the one arrangement that genuinely z-fights.
    head_h = H - RAIL_T - FRAME_TOP          # 0.78
    mb.box((FRAME_OUT, CORE_T, head_h), (0, CORE_Y, FRAME_TOP + head_h * 0.5),
           "SteelDark")
    mb.box((FRAME_OUT, FACIA_T, BAND_H), (0, FACIA_Y, FRAME_TOP + BAND_H * 0.5),
           "Accent")
    mb.box((FRAME_OUT, FACIA_T, head_h - BAND_H),
           (0, FACIA_Y, FRAME_TOP + BAND_H + (head_h - BAND_H) * 0.5),
           "SteelDark")
    mb.box((sc.DOOR_W, T, SILL_H), (0, 0, SILL_H * 0.5), "Hazard")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, T, H), (s * JAMB_X, 0, H * 0.5), "SteelDark")
    mb.box((FRAME_OUT, CORE_T, H - HEAD_Z0), (0, CORE_Y, (HEAD_Z0 + H) * 0.5),
           "SteelDark")
    # Full-height accent facia at LOD1: at 25 to 80 m the band IS the door, and
    # the 200 mm authored band is under a pixel tall by then.
    mb.box((FRAME_OUT, FACIA_T, H - HEAD_Z0), (0, FACIA_Y, (HEAD_Z0 + H) * 0.5),
           "Accent")
    mb.box((sc.DOOR_W, T, SILL_H), (0, 0, SILL_H * 0.5), "Hazard")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, T, H), (s * JAMB_X, 0, H * 0.5), "SteelDark")
    mb.box((FRAME_OUT, T, H - HEAD_Z0), (0, 0, (HEAD_Z0 + H) * 0.5), "Accent")
    return mb, mb.build(NAME + "_LOD2", root)


def build_leaf(hinge):
    """The swinging leaf, authored in HINGE-LOCAL space so the clip is a plain
    rotation of the pivot and the leaf's own transform stays the identity.

    The field is 50 mm thick and the frame 60, for the same reason the wall
    panel is layered: two elements at the SAME thickness would meet in a pair of
    coplanar faces, and coplanar is the one case that z-fights. The push bar is
    the only thing that leaves that sandwich, and it is what sets the leaf's
    0.125 m depth."""
    mb = of.MeshBuilder()
    z_mid = LEAF_Z0 + LEAF_H * 0.5
    mb.box((LEAF_W, LEAF_FIELD_T, LEAF_H), (LEAF_X, 0, z_mid), "Steel")
    mb.box((LEAF_W, LEAF_FRAME_T, 0.14), (LEAF_X, 0, LEAF_Z0 + 0.07), "SteelDark")
    mb.box((LEAF_W, LEAF_FRAME_T, 0.12),
           (LEAF_X, 0, LEAF_Z0 + LEAF_H - 0.06), "SteelDark")
    mb.box((LEAF_W, LEAF_FRAME_T, 0.10), (LEAF_X, 0, 1.30), "SteelDark")
    for x in (LEAF_X - LEAF_W * 0.5 + 0.05, LEAF_X + LEAF_W * 0.5 - 0.05):
        mb.box((0.10, LEAF_FRAME_T, LEAF_H), (x, 0, z_mid), "SteelDark")
    mb.box((0.56, LEAF_FRAME_T, 0.07), (LEAF_X + 0.20, BAR_Y, 1.05), "Accent")
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
