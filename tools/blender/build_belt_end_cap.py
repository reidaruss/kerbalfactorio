"""
build_belt_end_cap.py - Belt end cap, TypeId 0x11.

    blender --background --python tools/blender/build_belt_end_cap.py

Produces assets/models/dist/machines/belt_end_cap.glb.

1 x 1 m cell, 0.30 m tall. A closed roller housing that terminates the head or
tail of a line so a belt never ends in a visible hole where you can see the
underside of the deck. Rails and deck height match build_belt_segment exactly,
so the cap butts against a straight tile with no seam.

No state chip and no clip: an end cap has no sim entity of its own, it is a
cosmetic terminator the renderer places at the ends of a belt line. Three
materials, not four.

THE ITEM PATH (W11). The cap publishes socket_item_a / socket_item /
socket_item_b like every other belt tile, but its path is a STUB: it enters at
the inlet edge and terminates at the nose, so it is 0.70 m long rather than
1.000 m. Two things had to change for that to be true instead of merely
declared.

  1. The cap grew a slat strip. Every other belt tile carries cargo on slats
     whose top is at 0.28; the cap had bare deck at 0.25, so a path published
     at one height across the set would have floated 30 mm here. The strip is
     on the same 0.125 m pitch and the same phase as the straight tile's, so
     the slats of a line run into the cap without a visible break.
  2. The nose housing moved back 0.10 m and the deck grew to meet it, so the
     terminating point socket_item_b lands on real deck rather than 0.10 m
     inside a closed steel box. socket_item did not move: the geometry moved
     to make the published midpoint the true midpoint of a -> b.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import belt_common as bc  # noqa: E402
import of_lib as of  # noqa: E402

NAME = "BeltEndCap"
OUT = of.dist_path("machines", "belt_end_cap.glb")

# RN-1622: the seam dimensions come from `belt_common` rather than being typed
# here under a comment claiming they "match build_belt_segment exactly". They
# now match it because there is one copy.
W, L, H = bc.W, bc.L, bc.H
RAIL_W = bc.RAIL_W
DECK_W = bc.DECK_W
DECK_TOP = bc.DECK_TOP
SLAT_T = bc.SLAT_T
SLAT_PITCH = 0.125
SLAT_COUNT = 6                         # covers the deck, nose to inlet edge
RIDE_TOP = bc.RIDE_TOP                 # 0.28, the surface cargo rests on
ROLLER_R = bc.ROLLER_R
ROLLER_Y = L * 0.5 - ROLLER_R          # tangent to the inlet edge
NOSE_Y = -0.20                         # where the deck stops and the nose
                                       # begins: also socket_item_b
DECK_LEN = L * 0.5 - NOSE_Y            # 0.70, the stub path length

# FS-88, and all four numbers below exist for one reason: NOTHING IN THE NOSE
# MAY SHARE A PLANE WITH ANYTHING ELSE IN THE NOSE. Measured on the shipped
# bytes this asset had 57 same-facing coplanar pairs, every one of them two
# parts that had been given the same width or the same face by copying a
# number rather than deriving one:
#
#   28  the roller was exactly DECK_W long, so its end caps were on the rubber
#       deck's own side planes at +/-0.40.
#   10  the nose housing's front face and the end plate's front face were both
#       on the cell edge at y = -0.50.
#    7  the housing was DECK_W wide, so its sides were on the under-frame's.
#    6  the end plate was wider than the deck, so its underside overlapped the
#       rails' undersides on z = 0.
#    6  the housing top and the rails' top were both at 0.30 before the housing
#       was shortened; it is 0.28 and sunk, so that is already gone.
#
# The rule that comes out of it, and it is the same rule as the smelter's
# notched plinth read from the other end: when two parts must both reach a HARD
# plane (the cell edge, the ground), only one of them may have a FACE there.
ROLLER_L = DECK_W + 0.06               # 0.86: caps buried in the rails
PLATE_T = 0.06                         # the end plate, the one part on y=-0.50
PLATE_W = DECK_W                       # 0.80: exactly the deck, so its sides
                                       # are on the under-frame's own planes
                                       # (same material, therefore invisible)
                                       # and its underside only TOUCHES the
                                       # rails' rather than overlapping them.
NOSE_W = DECK_W + 0.04                 # 0.84: buried in the rails, and not on
                                       # the roller's plane at 0.43 either
NOSE_LEN = NOSE_Y + L * 0.5 - PLATE_T  # 0.24: it stops BEHIND the end plate
NOSE_CY = (NOSE_Y - L * 0.5 + PLATE_T) * 0.5


def build_lod0(root):
    mb = of.MeshBuilder()
    # RN-1622. THE SAME FABRICATED SECTION THE STRAIGHT TILE WEARS, from the
    # same function, so a cap terminating a line is the same frame as the line.
    # It was still the extruded bar RN-1563 replaced everywhere else, which is
    # the defect: a modular kit whose terminator changes section is not modular,
    # and the cap is at the END of every belt run in the game, i.e. exactly
    # where a player's eye stops.
    #
    # THE SEAM IS UNTOUCHED AND THAT IS CHECKED RATHER THAN ASSERTED. The
    # section ends SOLID FULL-SECTION at both boundary planes (see
    # belt_common's docstring), so what the inlet edge at y = +0.50 presents to
    # the straight tile butted against it is the same solid 0.10 x 0.30
    # rectangle the plain bar presented; the exported bytes on that plane are
    # compared against the pre-change build rather than argued about.
    for sx in (-1, 1):
        bc.rail_straight(mb, sx)
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    # deck runs from the inlet to the nose, then the housing closes it off
    mb.box((DECK_W, DECK_LEN, 0.06),
           (0.0, (L * 0.5 + NOSE_Y) * 0.5, DECK_TOP - 0.03), "Rubber")
    mb.cylinder(ROLLER_R, ROLLER_L, (0.0, ROLLER_Y, DECK_TOP - 0.03), axis="X",
                segments=12, role="Steel")
    # closed nose housing over the terminating roller, then the end plate that
    # closes it. The plate is the ONLY part with a face on the cell edge.
    mb.box((NOSE_W, NOSE_LEN, 0.28), (0.0, NOSE_CY, 0.15), "Steel")
    mb.box((PLATE_W, PLATE_T, H), (0.0, -L * 0.5 + PLATE_T * 0.5, H * 0.5),
           "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, DECK_LEN, 0.06),
           (0.0, (L * 0.5 + NOSE_Y) * 0.5, DECK_TOP - 0.03), "Rubber")
    mb.box((NOSE_W, NOSE_LEN, 0.28), (0.0, NOSE_CY, 0.15), "Steel")
    return mb, mb.build(NAME + "_LOD1", root)


def build_slats(root):
    """The static slat strip. A SIBLING of LOD0, exactly as on the straight
    tile, so LOD0's bounding box stays 1 x 1 x 0.30 while the strip is free to
    tuck its last slat under the nose housing.

    Static, not animated: an end cap has no sim entity, so there is nothing for
    a Belt_Scroll clip to be in phase WITH, and the contract declares no clips.
    Its job is that the slat pattern of the line does not stop dead one tile
    early, and that cargo rests on the same 0.28 surface here as everywhere."""
    mb = of.MeshBuilder()
    # Phase, not just pitch. The straight tile's slats sit on
    # y = -0.4375 + 0.125k, i.e. on centres congruent to 0.0625 modulo the
    # pitch; NOSE_Y + 0.0125 = -0.1875 is on that same lattice, so a cap butted
    # against a straight tile continues its pattern instead of restarting it.
    mb.repeat_box((DECK_W - 0.08, 0.05, SLAT_T),
                  start=(0.0, NOSE_Y + 0.0125, DECK_TOP + SLAT_T * 0.5),
                  step=(0.0, SLAT_PITCH, 0.0),
                  count=SLAT_COUNT, role="Rubber")
    return mb, mb.build(NAME + "_Slats", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, L, H), (0.0, 0.0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbs, _ = build_slats(root)

    of.add_collision_box("col_" + NAME, (W, L, H), (0.0, 0.0, H * 0.5), root)

    of.add_socket("socket_belt_in", (0.0, L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_in"})
    # The stub item path. socket_item is the exact midpoint of a -> b, which is
    # why NOSE_Y is -0.20 and not the -0.10 the deck used to stop at.
    of.add_socket("socket_item_a", (0.0, L * 0.5, RIDE_TOP), parent=root,
                  extras={"of_role": "item_path_in"})
    of.add_socket("socket_item", (0.0, (L * 0.5 + NOSE_Y) * 0.5, RIDE_TOP),
                  parent=root, extras={"of_role": "item_ride"})
    of.add_socket("socket_item_b", (0.0, NOSE_Y, RIDE_TOP), parent=root,
                  extras={"of_role": "item_path_out"})

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Slats", mbs)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
