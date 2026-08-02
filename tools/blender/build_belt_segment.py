"""
build_belt_segment.py - the reference asset AND the pipeline smoke test.

    blender --background --python tools/blender/build_belt_segment.py

Produces assets/models/dist/machines/belt_segment.glb.

This is the shape every other build script copies: reset, build LOD meshes with
MeshBuilder, add sockets and a collision proxy, author clips, export. It is
deliberately the smallest asset in the game that still exercises every part of
the contract - multi-material mesh, three LODs, a collision proxy, four
sockets, a state-emissive slot, and one looping animation clip.

Belt segment, TypeId 0x11 (of::gameplay::types::Belt).
Footprint 1 x 1 m (one build-grid cell), 0.30 m tall.
Flow runs along Blender -Y, which is three.js +Z.

THE ITEM PATH (W11). Three sockets publish where cargo rides:

    socket_item_a   where the path ENTERS the tile, on the inlet edge
    socket_item     the path MIDPOINT
    socket_item_b   where the path LEAVES the tile, on the outlet edge

and the published rule is one rule for every belt tile shape: an item's
position across a tile is the CIRCULAR ARC through those three points,
parameterised by arc length. On a straight tile they are collinear, the arc
degenerates to a line, and the client needs no per-shape special case.

All three sit at RIDE_TOP, which is the top of the SLAT strip and not the top
of the rubber deck. Those are two different surfaces 30 mm apart, and the one
an item actually rests on is the slats. The slat was 22 mm thick and
socket_item has always been at 0.28, so the socket floated 8 mm over the only
surface in the file; the slat is now 30 mm thick, which makes 0.28 the real
carrying surface rather than a number near one. Nothing moved: the geometry
came up to meet the published socket.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "BeltSegment"
OUT = of.dist_path("machines", "belt_segment.glb")

# --- dimensions (metres) ---------------------------------------------------
W, L, H = 1.00, 1.00, 0.30      # footprint X, flow Y, height Z
RAIL_W = 0.10
DECK_W = W - 2 * RAIL_W         # 0.80
DECK_TOP = 0.25
SLAT_PITCH = 0.125              # 8 slats per metre -> a whole-number loop
SLAT_COUNT = 9                  # 8 on the tile + 1 entering from the inlet
SLAT_T = 0.030                  # slat thickness: DECK_TOP + SLAT_T == RIDE_TOP
RIDE_TOP = DECK_TOP + SLAT_T    # 0.28, the surface cargo rests on
ROLLER_R = 0.055
ROLLER_Y = L * 0.5 - ROLLER_R   # tangent to the cell edge, never outside it

# FS-88. The roller used to be exactly DECK_W long, so its two end caps landed
# on exactly the planes the rubber deck's own side faces are on (x = +/-0.40),
# both pointing outward, and the depth test had to pick one per pixel. That
# single number was 56 of this asset's 84 same-facing coplanar pairs.
#
# It is 0.06 longer now, so the caps sit at +/-0.43, BURIED INSIDE the rails
# rather than flush with the deck. That is also what a roller is: a shaft that
# runs into a bearing in the frame, not a cylinder that stops at the belt's
# edge. Still short of the cell edge at 0.50, which is the hard one.
ROLLER_L = DECK_W + 0.06        # 0.86
# The LOD1 stand-in for the roller is a BOX, and a box the diameter of the
# cylinder lands its outer face on y = +/-0.50, which is the tile boundary the
# LOD0 cylinder only ever touched along a tangent line. Use the 12-gon's
# FLAT-TO-FLAT width instead of its diameter: that is the widest the polygonal
# roller actually is across a face, so the box is the honest stand-in and it
# clears the boundary plane by 1.8 mm without a fudge factor.
ROLLER_FLAT = ROLLER_R * 2.0 * math.cos(math.pi / 12.0)     # 0.1063

# The state chip. It used to be a 0.01 m inlay whose top face was at H, i.e. on
# exactly the plane the rail's own top face is on, both pointing up: the
# machine-state readout, the one part of a belt a player actually looks at, was
# the geometry least able to guarantee it would be drawn. A flush inlay in a
# solid box cannot be built without cutting the box open, and cutting the outer
# rail of the CURVE tiles open costs more triangles than those tiles have.
#
# So the chip stops being an inlay and becomes a LAMP UNDER THE RAIL'S LIP: it
# sits 7 mm below the rail top and overhangs the rail's inner face by 20 mm, so
# the visible part hangs over the deck. It shares no plane with anything, and it
# is arguably easier to see, because a belt is looked at from beside and along
# rather than from directly overhead.
CHIP_X = (W - RAIL_W) * 0.5 - 0.03      # 0.42, straddling the rail inner face
CHIP_Z = H - 0.0125                     # top at 0.293, under the 0.30 rail top


def build_lod0(root):
    mb = of.MeshBuilder()
    # side rails
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    # under-frame (reads as the machine's dark base, ties it to the ground)
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    # belt deck
    mb.box((DECK_W, L, 0.06), (0.0, 0.0, DECK_TOP - 0.03), "Rubber")
    # end rollers, axis across the flow. Tangent to the cell edge, NOT past it:
    # a machine that overhangs its footprint z-fights its neighbour on the grid.
    for sy in (-1, 1):
        mb.cylinder(ROLLER_R, ROLLER_L, (0.0, sy * ROLLER_Y, DECK_TOP - 0.03),
                    axis="X", segments=12, role="Steel")
    # state chip: a lamp under the +X rail's lip. THE machine-state readout.
    mb.box((0.08, 0.12, 0.011), (CHIP_X, 0.0, CHIP_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    """Hand-built, not decimated: a collapse decimator destroys a box
    silhouette before it saves anything worth having."""
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    mb.box((DECK_W, L, 0.06), (0.0, 0.0, DECK_TOP - 0.03), "Rubber")
    for sy in (-1, 1):
        mb.box((ROLLER_L, ROLLER_FLAT, ROLLER_FLAT),
               (0.0, sy * ROLLER_Y, DECK_TOP - 0.03), "Steel")
    # THE STATE CHIP, AND ITS ABSENCE WAS THIS TIER'S ENTIRE SHADOW DEVIATION
    # (RN-569). The chip straddles the rail's inner face: it spans x 0.38 to
    # 0.46 where the rail spans 0.40 to 0.50, so its inboard 0.020 hangs over
    # the deck with nothing under it. Omit it and the worst any LOD0 vertex
    # can be from this mesh's surface is exactly that 0.020, measured at
    # 20.00 mm against cascade 0's 15.47 mm: a 4.53 mm miss that cost this
    # asset a whole cascade.
    #
    # Twelve triangles buy it back, and they are the cheapest in my domain:
    # portcost's reference base carries 57 belts against 22 smelters, so a
    # belt is the most numerous object in a factory by a wide margin. It is
    # also a correctness fix on its own terms, because a belt at LOD1 range
    # had NO state readout at all while every other machine's LOD1 keeps its
    # EmissiveState chip.
    mb.box((0.08, 0.12, 0.011), (CHIP_X, 0.0, CHIP_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, L, H), (0.0, 0.0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_slats(root):
    """The animated strip. A SIBLING of LOD0, not a child, so LOD0's bounding
    box stays exactly 1 x 1 x 0.30 while the strip is free to overhang the
    front edge mid-loop (the overhang tucks under the next tile's roller)."""
    mb = of.MeshBuilder()
    mb.repeat_box((DECK_W - 0.08, 0.05, SLAT_T),
                  start=(0.0, -0.4375, DECK_TOP + SLAT_T * 0.5),
                  step=(0.0, SLAT_PITCH, 0.0),
                  count=SLAT_COUNT, role="Rubber")
    return mb, mb.build("Belt_Slats", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbs, slats = build_slats(root)

    of.add_collision_box("col_" + NAME, (W, L, H), (0.0, 0.0, H * 0.5), root)

    # Sockets. A socket's local -Y is its facing (three.js +Z).
    of.add_socket("socket_belt_in", (0.0, L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_in"})
    of.add_socket("socket_belt_out", (0.0, -L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_out"})
    # The item path: entry, midpoint, exit, all on the slat top. A and B sit
    # ON the tile's own boundary planes (Blender y = +/-L/2), so the path of
    # one tile starts exactly where its neighbour's ended and a line of belts
    # carries cargo with no gap and no overlap at the seams.
    of.add_socket("socket_item_a", (0.0, L * 0.5, RIDE_TOP), parent=root,
                  extras={"of_role": "item_path_in"})
    of.add_socket("socket_item", (0.0, 0.0, RIDE_TOP), parent=root,
                  extras={"of_role": "item_ride"})
    of.add_socket("socket_item_b", (0.0, -L * 0.5, RIDE_TOP), parent=root,
                  extras={"of_role": "item_path_out"})
    of.add_socket("socket_status", ((W - RAIL_W) * 0.5, 0.0, H), parent=root,
                  extras={"of_role": "state_light"})

    # One clip: the slat strip walks exactly one slat pitch over 60 frames at
    # 60 fps, so the loop is seamless and the clip is 1.000 s == 0.125 m of
    # travel. three.js: action.timeScale = beltSpeedMetresPerSecond / 0.125.
    # A tier-1 belt (8 units/tick, 256 units/tile, 60 tps) runs 1.875 m/s,
    # so timeScale = 15.
    of.add_clip(slats, "Belt_Scroll", "location",
                [(1, (0.0, 0.0, 0.0)), (61, (0.0, -SLAT_PITCH, 0.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Belt_Slats", mbs)])
    # No rig here, just an object translation, so keep the F-curve keys instead
    # of baking 60 of them.
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
