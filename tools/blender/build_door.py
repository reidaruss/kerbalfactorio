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

--------------------------------------------------------------------------
RN-1604 AND RN-1605, THE SE FORM PASS
--------------------------------------------------------------------------
A DOOR IS THE ONE PART OF THE STRUCTURAL SET THAT MOVES, so the thing it owed
D-020 is a MECHANISM READ: a frame you can see is a frame, an actuator that
drives the leaf, and a warning that says where the leaf goes. It had a
beautifully argued colour block and no machinery at all.

  - THE OVERHEAD CLOSER. The head recess between the door surround (2.76) and
    the top rail (3.32) was 780 mm of blank facia, directly above the opening
    and directly in a player's eye line as they walk through. It now carries a
    ram, its mounting boss and the arm down to the leaf's head - which is where
    a real closer is, is why that recess exists on a real door, and is the one
    part of this asset that explains why the leaf swings.
  - THE LEAF GOT A KICK PLATE AND A VISION PORT. The kick plate is this
    asset's `paintchip` consumer on RN-1553's rule and it is the least
    arguable one in the whole wave: the bottom 200 mm of a door leaf is
    literally the surface people kick. The port is what stops the leaf being a
    slab and is why you do not open a door into somebody.
  - HAZARD CHEVRONS ON THE SWING EDGE, which is the strip of floor the leaf
    sweeps. The threshold was already `Hazard`; the chevrons say WHICH WAY.
  - AND THE PANEL CARRIES THE WALL'S NEW PLATING, because build_wall.py's
    whole argument is that a door has to read as one of the wall panels until
    you need to go through it. Same courses, same rivet layer, same 15 mm
    ceiling.

THE 120 COPLANAR PAIRS, THE LARGEST DEBT IN THE PROJECT'S ALLOWANCE TABLE,
CLOSED AT THE CAUSE (RN-1605). Three causes, all of them a part sized to END
where another part ends:
  - THE LEAF, 56 of them and the worst of the three because the leaf MOVES, so
    the fight changes every frame the door is opening. Its field was exactly
    LEAF_W x LEAF_H and its stiles and rails were laid on top at the same
    extent, so all four edges of the field were on all four edges of its frame.
    The field is 60 mm smaller in both axes now and the frame overhangs it,
    which is what a framed leaf is.
  - THE ACCENT FACIA, on y = -0.125 with the two mullions it overlaps and, at
    LOD1 and LOD2, with the jambs' outer face and their top. It is RECESSED
    10 mm now, into the head it is mounted in, which is both a real signage
    detail and the end of every one of those pairs.
  - THE MID RAILS, which were exactly SIDE_W wide, so their ends were on the
    side fields' ends; and the FIELDS, whose top and bottom were on the
    mullions'. Both run 60 mm into what frames them now - build_wall.py's
    MIDRAIL_BURY and FIELD_BURY, for the same reason and by the same names,
    including the reason it is the thin field that is buried and not the
    full-thickness mullion.
`structures/door: 120` is deleted from check_coplanar.ALLOWED in this commit.

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
import machine_form as mf  # noqa: E402
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
FIELD_BURY = 0.06                    # the side fields, into the rails
MIDRAIL_BURY = 0.06                  # into the surround and the corner post
RAIL_BURY = 0.03                     # rails into the posts, as build_wall.py
RAIL_IN = 0.005                      # and thinner than them, for the same
#                                      pre-existing coincident-face defect its
#                                      _frame docstring describes.
PANEL_T = 0.16
TRIM_T = 0.20
FIELD_H = H - RAIL_B - RAIL_T        # 3.16
FIELD_Z = (RAIL_B + H - RAIL_T) * 0.5   # 1.74
MID_Z = 1.70

# --- the doorway ----------------------------------------------------------
# RN-1605. THE FACIA IS RECESSED 10 mm. It used to run y -0.125 .. -0.075, i.e.
# flush with the panel's own outward plane, which is the plane the two mullions,
# the jambs and (at LOD1/LOD2) the whole panel also live on. Recessed, the facia
# is a sign panel set into the head, which is what a real one is, and no face of
# it is on any plane another part owns.
FACIA_IN = 0.010                     # how far the facia is set back
FACIA_T = 0.04                       # outward face layer, y -0.115 .. -0.075
CORE_T = T - FACIA_T - FACIA_IN      # 0.20,               y -0.075 .. +0.125
FACIA_Y = -(T * 0.5 - FACIA_IN - FACIA_T * 0.5)      # -0.095
CORE_Y = (T * 0.5) - CORE_T * 0.5    # +0.025

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
# RN-1605. The field is 60 mm smaller than the leaf in BOTH axes, so the frame
# overhangs it on all four edges instead of ending on them. That one number is
# 56 of this asset's 120 coplanar pairs, on the part that moves.
LEAF_FIELD_IN = 0.06
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
        mb.box((JAMB_W - POST_W + RAIL_BURY, T - 2.0 * RAIL_IN, RAIL_B),
               (s * (JAMB_X - (POST_W - RAIL_BURY) * 0.5), 0, RAIL_B * 0.5),
               "SteelDark")
        mb.box((SIDE_W, PANEL_T, FIELD_H + 2.0 * FIELD_BURY),
               (s * SIDE_X, 0, FIELD_Z), "Steel")
        # RN-1605: 60 mm into the surround and 60 mm into the corner post, so
        # the rail's ends are buried instead of landing on the field's own.
        mb.box((SIDE_W + 2.0 * MIDRAIL_BURY, TRIM_T, 0.12),
               (s * SIDE_X, 0, MID_Z), "SteelDark")
    mb.box((W - 2.0 * POST_W + 2.0 * RAIL_BURY, T - 2.0 * RAIL_IN, RAIL_T),
           (0, 0, H - RAIL_T * 0.5), "SteelDark")
    for x in MULLION_AT:
        mb.box((MULLION_W, T, FIELD_H), (x, 0, FIELD_Z), "SteelDark")


def _side_plating(mb, sign, face_sign):
    """The wall's own plate construction on the two side fields.

    build_wall.py's ceiling applies here unchanged and for the same reason: the
    door shares a run with walls, so if its courses stood proud of theirs the
    two parts would stop reading as one system, and anything over 15.47 mm
    would cost this asset cascade 0 exactly as it would cost a wall."""
    face = mf.Face("Y", face_sign, face_sign * PANEL_T * 0.5,
                   limit=face_sign * T * 0.5,
                   name="door field %+d%+d" % (sign, face_sign))
    x = sign * SIDE_X
    mf.seam_h(mb, face, (0.96,), x - 0.34, x + 0.34, 0.09, "Steel")
    mf.seam_h(mb, face, (0.30,), x - 0.38, x + 0.38, 0.22, "SteelWorn")
    mf.bolt_run(mb, face, x - 0.30, x + 0.30, MID_Z - 0.34, 3, 0.05,
                "SteelLight", kind="rivet")


def _closer(mb):
    """The overhead closer in the head recess: a mounting boss, the ram, and the
    arm reaching down toward the leaf's head.

    IT LIVES ENTIRELY IN THE 40 mm THE RECESSED FACIA LEFT, which is what makes
    it possible at all: the panel is 0.25 m thick and every millimetre of that
    is spoken for by the placement system, so the only room on this asset is
    the depth between the head CORE's outward face (y = -0.075) and the panel's
    own plane. A closer is a 40 mm cylinder on a 4 m door. It fits because a
    real one is that size, not because it was scaled to fit."""
    y0 = CORE_Y - CORE_T * 0.5                    # -0.075, the core's own face
    mb.box((0.34, 0.045, 0.10), (-0.10, y0 - 0.010, 3.06), "SteelDark")
    mb.box((0.30, 0.036, 0.062), (-0.10, y0 - 0.031, 3.06), "Steel")
    mb.box((0.06, 0.030, 0.048), (0.10, y0 - 0.031, 3.06), "SteelLight")
    mb.box((0.26, 0.028, 0.030), (0.22, y0 - 0.025, 2.955), "Steel")


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
    # the chevrons on the strip of floor the leaf actually sweeps: the sill said
    # THERE IS A DOOR HERE, these say WHICH WAY IT OPENS
    for i in range(3):
        mb.box((0.13, T - 0.06, 0.055), (-0.42 + i * 0.34, -0.012, 0.0325),
               "SteelWorn")
    _closer(mb)
    for sign in (-1, 1):
        for face_sign in (-1, 1):
            _side_plating(mb, sign, face_sign)
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, T, H), (s * JAMB_X, 0, H * 0.5), "SteelDark")
    mb.box((FRAME_OUT, CORE_T, H - HEAD_Z0), (0, CORE_Y, (HEAD_Z0 + H) * 0.5),
           "SteelDark")
    # Full-height accent facia at LOD1: at 25 to 80 m the band IS the door, and
    # the 200 mm authored band is under a pixel tall by then.
    # RN-1605: 40 mm shy of the top rail, so the facia's own top is not on the
    # jambs' top, and recessed in y by FACIA_IN so its face is not on theirs.
    mb.box((FRAME_OUT, FACIA_T, H - HEAD_Z0 - 0.04),
           (0, FACIA_Y, (HEAD_Z0 + H) * 0.5 - 0.02), "Accent")
    mb.box((sc.DOOR_W, T, SILL_H), (0, 0, SILL_H * 0.5), "Hazard")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((JAMB_W, T, H), (s * JAMB_X, 0, H * 0.5), "SteelDark")
    # RN-1605: recessed on BOTH faces and 40 mm shy of the top, for LOD1's
    # reason. At LOD2 the accent slab was full thickness and full height, so it
    # shared three planes with the jambs it sits between: 16 pairs on the tier
    # a whole base of doors is drawn at.
    mb.box((FRAME_OUT, T - 2.0 * FACIA_IN, H - HEAD_Z0 - 0.04),
           (0, 0, (HEAD_Z0 + H) * 0.5 - 0.02), "Accent")
    return mb, mb.build(NAME + "_LOD2", root)


def build_leaf(hinge):
    """The swinging leaf, authored in HINGE-LOCAL space so the clip is a plain
    rotation of the pivot and the leaf's own transform stays the identity.

    The field is 50 mm thick and the frame 60, for the same reason the wall
    panel is layered: two elements at the SAME thickness would meet in a pair of
    coplanar faces, and coplanar is the one case that z-fights. The push bar is
    the only thing that leaves that sandwich, and it is what sets the leaf's
    0.125 m depth.

    RN-1605 FOUND THAT ARGUMENT WAS ONLY HALF MADE. The layering in Y was
    right and the extents in X and Z were not: the field was exactly LEAF_W by
    LEAF_H and every stile and rail was laid on at the same extent, so all four
    of the field's edges were on all four of the frame's, 56 same-facing pairs,
    on the ONE part of the structural kit that moves - so the fight is not even
    stable, it changes as the door swings. LEAF_FIELD_IN makes the frame
    overhang the field by 30 mm on every edge, which is what a framed leaf is.

    RN-1604 ADDED THE TWO THINGS A DOOR LEAF ACTUALLY HAS. A kick plate, which
    is the least arguable `paintchip` consumer in this wave - the bottom of a
    door leaf is the surface that is literally kicked - and a vision port,
    which is why you do not open a door into somebody, and which is also the
    only thing stopping this part being a slab with a bar on it."""
    mb = of.MeshBuilder()
    z_mid = LEAF_Z0 + LEAF_H * 0.5
    fw = LEAF_W - LEAF_FIELD_IN
    fh = LEAF_H - LEAF_FIELD_IN
    mb.box((fw, LEAF_FIELD_T, fh), (LEAF_X, 0, z_mid), "Steel")
    mb.box((LEAF_W, LEAF_FRAME_T, 0.14), (LEAF_X, 0, LEAF_Z0 + 0.07), "SteelDark")
    mb.box((LEAF_W, LEAF_FRAME_T, 0.12),
           (LEAF_X, 0, LEAF_Z0 + LEAF_H - 0.06), "SteelDark")
    mb.box((LEAF_W, LEAF_FRAME_T, 0.10), (LEAF_X, 0, 1.30), "SteelDark")
    for x in (LEAF_X - LEAF_W * 0.5 + 0.05, LEAF_X + LEAF_W * 0.5 - 0.05):
        mb.box((0.10, LEAF_FRAME_T, LEAF_H), (x, 0, z_mid), "SteelDark")
    # the kick plate: 200 mm, standing on the bottom rail, 5 mm proud of the
    # stiles so no face of it is on one of theirs
    mb.box((LEAF_W - 0.16, 0.066, 0.20), (LEAF_X, -0.006, LEAF_Z0 + 0.24),
           "SteelWorn")
    # the vision port: a bright surround with a dark light inside it, both
    # standing off the field and neither on the other's plane
    mb.box((0.34, 0.066, 0.26), (LEAF_X + 0.02, -0.004, 1.62), "SteelLight")
    mb.box((0.24, 0.072, 0.17), (LEAF_X + 0.02, -0.013, 1.62), "SteelDark")
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
