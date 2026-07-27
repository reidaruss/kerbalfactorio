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
import of_lib as of  # noqa: E402

NAME = "BeltEndCap"
OUT = of.dist_path("machines", "belt_end_cap.glb")

W, L, H = 1.00, 1.00, 0.30
RAIL_W = 0.10
DECK_W = W - 2 * RAIL_W
DECK_TOP = 0.25
SLAT_T = 0.030                         # matches build_belt_segment exactly
SLAT_PITCH = 0.125
SLAT_COUNT = 6                         # covers the deck, nose to inlet edge
RIDE_TOP = DECK_TOP + SLAT_T           # 0.28, the surface cargo rests on
ROLLER_R = 0.055
ROLLER_Y = L * 0.5 - ROLLER_R          # tangent to the inlet edge
NOSE_Y = -0.20                         # where the deck stops and the nose
                                       # begins: also socket_item_b
DECK_LEN = L * 0.5 - NOSE_Y            # 0.70, the stub path length


def build_lod0(root):
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    # deck runs from the inlet to the nose, then the housing closes it off
    mb.box((DECK_W, DECK_LEN, 0.06),
           (0.0, (L * 0.5 + NOSE_Y) * 0.5, DECK_TOP - 0.03), "Rubber")
    mb.cylinder(ROLLER_R, DECK_W, (0.0, ROLLER_Y, DECK_TOP - 0.03), axis="X",
                segments=12, role="Steel")
    # closed nose housing over the terminating roller
    mb.box((DECK_W, NOSE_Y + L * 0.5, 0.28),
           (0.0, (NOSE_Y - L * 0.5) * 0.5, 0.15), "Steel")
    mb.box((W - 0.14, 0.06, H), (0.0, -L * 0.5 + 0.03, H * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, DECK_LEN, 0.06),
           (0.0, (L * 0.5 + NOSE_Y) * 0.5, DECK_TOP - 0.03), "Rubber")
    mb.box((DECK_W, NOSE_Y + L * 0.5, 0.28),
           (0.0, (NOSE_Y - L * 0.5) * 0.5, 0.15), "Steel")
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
