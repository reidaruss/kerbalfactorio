"""
build_wall.py - Tier-0 structural wall panel.

    ~/.local/bin/blender501 --background --python tools/blender/build_wall.py

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

--------------------------------------------------------------------------
RN-1600 AND RN-1601, THE SE FORM PASS
--------------------------------------------------------------------------
SPACE ENGINEERS' IDENTITY IS THE BUILDABLE BLOCK, and this panel is the block a
player sees more of than any other object in their own base. It had a frame and
a blank sheet inside it. It now has plate construction: courses, a kick course,
riveted joins and a stagger.

EVERY MILLIMETRE OF IT LIVES ON THE RECESSED FIELD, AND THE MODULE ENFORCES
THAT RATHER THAN THIS FILE REMEMBERING IT. The declared thickness is 0.25 m
TOTAL and the placement system is built on it: collinear panels share the plane
x = 4k exactly, and perpendicular ones interpenetrate a 0.125 m square that is
invisible only because it is inside solid geometry on both parts
(structure_common.py). So a greeble on the FRAME has zero room. The field
stands 45 mm back from the frame, which is 45 mm of room, and every detail
below is placed through `machine_form.Face(limit=+/-WALL_T/2)`, which refuses
anything taller BY NAME with the overshoot in metres. A `hinge` at 52 mm is a
build failure here. That is the module's own hard-edge assertion doing on a
wall exactly what it does on a machine footprint.

AND NOTHING IS OVER 15 mm, WHICH IS THE OTHER HARD EDGE AND IT IS A SHADOW ONE.
This asset is the only part in the game whose LOD1 deviates 0.00 mm from LOD0,
so all three cascades draw the cheap tier and the marginal multiplier is 1.0x -
the best number any asset in this project has. Cascade 0 is 15.47 mm per texel.
A `bolt` head at 44 mm would therefore have taken every wall in every base from
1.0x to 2.0x, which on the most numerous structural part is the single most
expensive thing this pass could have done. So the fasteners are `rivet` (15 mm,
the layer RN-1591 added for exactly this) on `seam` straps (13 mm), the whole
assembly is inside one cascade-0 texel, and the multiplier is UNCHANGED at
1.0x. Measured before and after, not assumed.

WHAT IS ACTUALLY ON THE FIELD, per face, and both faces get it because a wall
divides two cells and is seen from both:
  - FOUR HORIZONTAL PLATE COURSES, one per bay, at STAGGERED heights. Real
    plating runs in courses with staggered joints so no two adjacent seams line
    up, and the stagger is also the only asymmetry a part with mirror symmetry
    in both axes can honestly have.
  - A KICK COURSE along the foot in `SteelWorn`. This asset's `paintchip`
    consumer, on RN-1553's rule: a coating that failed where the thing gets
    HIT. The bottom 200 mm of an interior wall is hit by boots, carts and
    crates for the whole game and by nothing else.
  - A RIVET RUN along the mid-rail line, at the height a person looks.

THE 40 COPLANAR PAIRS ARE CLOSED AT THE CAUSE (RN-1601) AND THE CAUSE IS ONE
MISTAKE MADE TWICE: a part dimensioned to END exactly where the field ends.
The three mullions ran from the bottom rail's top face to the top rail's
underside, so their end faces were on the field's own end planes (24 pairs);
and the mid rail was FIELD_W wide, so its ends were on the field's ends (8
more), with LOD1 carrying 8 of the same. The FIELD runs 60 mm into each rail
now and the MID RAIL 60 mm into each post, which is what a framed panel
physically is - a frame captures a sheet - and buries every one of those faces
inside solid steel. `structures/wall: 40` is deleted from
check_coplanar.ALLOWED in this commit.

AND THE RECEIPT FOUND A SIXTH DEFECT THE CHECKER STRUCTURALLY CANNOT: two
same-material parts at the same thickness on the same plane. `_frame` and the
FIELD_BURY note below carry both cases and what they looked like in a render.
That is worth stating as a general fact rather than as two footnotes -
check_coplanar gates on DIFFERENT-material pairs by design and says so, so a
Cycles frame is the only instrument this project has for the same-material
half, and this pass is the first time anything has been caught by it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402
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

# RN-1601. The two overlaps that close 40 coplanar pairs. Both are the amount a
# framed part runs INTO its frame, and both are larger than any layer in
# machine_form, so no greeble can ever land on the buried plane either.
#
# IT IS THE FIELD THAT RUNS INTO THE RAILS, NOT THE MULLIONS, AND THE CYCLES
# RECEIPT IS WHY. The first fix ran the three mullions 100 mm into the bottom
# and top rails, which killed the 24 pairs and passed check_coplanar - because
# a mullion and a rail are BOTH `SteelDark` and that checker deliberately does
# not count a same-material overlap, on the stated ground that the pixel is the
# same colour whichever face wins. That ground is right about the COLOUR and
# says nothing about the DEPTH: a mullion is full 0.25 thickness and so is a
# rail, so through the buried 100 mm their side faces were exactly coincident,
# and the render showed black speckle at the foot of every mullion. The
# checker's blind spot is real and this is what it looks like.
#
# The FIELD is 0.16 against the frame's 0.25, so a field buried in a rail is
# strictly INSIDE it with 45 mm of clearance on both faces and nothing can be
# coincident with anything. It is also the more honest assembly: a frame
# captures a sheet, a sheet does not capture a frame.
FIELD_BURY = 0.06                # the field, into the bottom and top rails
MIDRAIL_BURY = 0.06              # the mid rail, into the two corner posts

FIELD_FACE = PANEL_T * 0.5       # 0.08: where the detail is mounted
# THE FOUR BAYS, AS (centre, width, course height). The two outer bays are
# NARROWER than the two inner ones and that is arithmetic, not taste: the field
# runs -1.84 to 1.84 and the mullions sit on -1, 0, +1, so the outer bays are
# 0.78 wide against the inner 0.88. Written out rather than derived from one
# width, because a single width is exactly the mistake RN-1601 found: the first
# draft used 0.86 for all four, which pushed the outer courses to x = 1.93, i.e.
# 90 mm INSIDE the corner post. Nothing was visible and check_shadow_lod
# reported it anyway - a vertex buried in a solid is 52 mm from the nearest
# LOD1 surface whether or not anybody can see it - and that one number took the
# wall from a 1.0x marginal multiplier to 2.0x.
#
# THE COURSE HEIGHTS ARE THE STAGGER. No two adjacent bays share a joint
# height, which is what real plating does and is the only asymmetry a part with
# mirror symmetry in both axes can honestly carry.
BAYS = ((-1.45, 0.74, 0.86), (-0.50, 0.84, 1.22),
        (0.50, 0.84, 1.06), (1.45, 0.74, 0.98))
KICK_Z = 0.30

# The rails are captured BY the posts rather than crossing them: see _frame.
RAIL_BURY = 0.03                 # into each post, so the end faces are interior
RAIL_IN = 0.005                  # thinner than the post, so the side faces are


def _frame(mb):
    """Posts and rails. THE POSTS SET THE MODULE, the rails are captured by
    them, and RN-1601 turned that round from how it shipped.

    A PRE-EXISTING DEFECT THE CYCLES RECEIPT FOUND, in the same class as the
    mullion one above and predating this pass entirely. Post and rail were BOTH
    the full 0.25 thickness and both reached x = +/-2.00, so through the rail's
    own height their side faces AND their end faces were exactly coincident.
    Same material, so check_coplanar does not count it and is right not to -
    the colour is identical either way - and the DEPTH still has nothing to
    arbitrate with, which in the render is a hard black square at the foot of
    every corner post on every wall in the game.

    The rails are 10 mm thinner than the posts and stop 30 mm inside them now.
    Both numbers are the smallest that make the rail strictly interior: the
    posts still carry +/-2.00, +/-0.125 and the full 3.50, so nothing about the
    module or the tiling moves, and there is no pair of coincident faces left
    in the frame."""
    for s in (-1, 1):
        mb.box((POST_W, T, H), (s * (W * 0.5 - POST_W * 0.5), 0, H * 0.5),
               "SteelDark")
    rail_w = FIELD_W + 2.0 * RAIL_BURY
    mb.box((rail_w, T - 2.0 * RAIL_IN, RAIL_B), (0, 0, RAIL_B * 0.5),
           "SteelDark")
    mb.box((rail_w, T - 2.0 * RAIL_IN, RAIL_T), (0, 0, H - RAIL_T * 0.5),
           "SteelDark")


def _field(mb):
    """The sheet, run 60 mm INTO the rail at each end (RN-1601)."""
    mb.box((FIELD_W, PANEL_T, FIELD_H + 2.0 * FIELD_BURY), (0, 0, FIELD_Z),
           "Steel")


def _mullions(mb, xs):
    """Full-depth stiles, rail face to rail face, exactly as shipped."""
    for x in xs:
        mb.box((MULLION_W, T, FIELD_H), (x, 0, FIELD_Z), "SteelDark")


def _mid_rail(mb):
    """The mid rail, run 60 mm INTO each corner post (RN-1601)."""
    mb.box((FIELD_W + 2.0 * MIDRAIL_BURY, TRIM_T, 0.12), (0, 0, MID_Z),
           "SteelDark")


def _plating(mb, sign):
    """One face's worth of plate construction: courses, a kick course and the
    rivet run. `sign` is which side of the wall this is.

    THE `limit` IS THE DECLARED HALF-THICKNESS AND IT IS NOT DECORATION. Every
    call below is checked against it, so a future edit that reaches for a
    `hinge` or a `bolt` gets a ValueError naming the part and the overshoot in
    metres rather than a wall 68 mm too thick and a placement system that no
    longer closes at a corner."""
    face = mf.Face("Y", sign, sign * FIELD_FACE, limit=sign * T * 0.5,
                   name="wall field %+d" % sign)
    for x, w, z in BAYS:
        mf.seam_h(mb, face, (z,), x - w * 0.5, x + w * 0.5, 0.09, "Steel")
    # the kick course: the one part of an interior wall that is hit all game
    mf.seam_h(mb, face, (KICK_Z,), -FIELD_W * 0.5 + 0.04, FIELD_W * 0.5 - 0.04,
              0.22, "SteelWorn")
    # and the rivet run on the mid-rail line, at the height a person looks.
    #
    # THE RIVETS MOUNT ON THE FIELD AND NOT ON THE STRAP, WHICH IS THE WHOLE
    # POINT OF THE 15 mm LAYER. Mounted on the strap's own outer plane they
    # STACK - 13 mm of strap plus 15 mm of head is 28 mm proud of the field,
    # measured, and that is past cascade 0's 15.47 mm texel and costs every
    # wall in the game its 1.0x multiplier. Mounted on the field they stand
    # 15 mm, which is 2 mm proud of the strap they fasten, and that is what a
    # driven rivet in a plate lap actually looks like.
    mf.seam_h(mb, face, (MID_Z - 0.34,), -FIELD_W * 0.5 + 0.10,
              FIELD_W * 0.5 - 0.10, 0.08, "Steel")
    mf.bolt_run(mb, face, -FIELD_W * 0.5 + 0.16, FIELD_W * 0.5 - 0.16,
                MID_Z - 0.34, 8, 0.05, "SteelLight", kind="rivet")


def build_lod0(root):
    mb = of.MeshBuilder()
    _frame(mb)
    _field(mb)
    _mullions(mb, MULLION_AT)
    _mid_rail(mb)
    for sign in (-1, 1):
        _plating(mb, sign)
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _frame(mb)
    _field(mb)
    _mullions(mb, (0.0,))
    # RN-1601. THE MID RAIL IS HERE NOW AND ITS TWELVE TRIANGLES ARE THE PRICE
    # OF THE 1.0x MULTIPLIER. It used to be exactly FIELD_W wide, so its end
    # vertices lay ON the field's own end plane and measured 0.00 mm against a
    # tier that did not have it - a coincidence, and the same coincidence was
    # 8 of the coplanar pairs. Burying it 60 mm in each post fixed the paint
    # and put those vertices 25 mm inside a solid, past cascade 0's 15.47 mm
    # texel. Carrying the rail on this tier as well restores the 0.00.
    _mid_rail(mb)
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
