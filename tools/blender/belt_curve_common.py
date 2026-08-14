"""
belt_curve_common.py - the shared body of the two belt curve tiles.

NOT a build script (no `build_` prefix), so the "run every build_*.py" loop
skips it. build_belt_curve_l.py and build_belt_curve_r.py are the entry points
and each still produces exactly one .glb.

The left and right curves are the same tile mirrored in X, so they are one
parameterised builder rather than two 130-line files that drift apart. The
handedness is entirely captured by the arc centre and the sweep direction.

Geometry. The deck is a quarter annulus about the cell CORNER, centre-line
radius 0.5 m, so the belt enters the middle of the +Y edge and leaves the
middle of a side edge, exactly where the straight tile's sockets are. Rails,
deck width (0.80 m) and deck height (top at Z = 0.25) match build_belt_segment
so a curve butted against a straight tile has no seam.

Nothing crosses the 1 m cell: the outer rail's radius is exactly 1.00 m about
the corner, which makes it tangent to the two far cell edges rather than past
them - the same construction that fixed the straight tile's 10 mm roller
overhang.

THE ITEM PATH (W11). socket_item_a / socket_item / socket_item_b publish the
entry, midpoint and exit of the cargo path, and the client rule is the same
one the straight tile publishes: the circular arc through those three points.
Here that arc is the exact quarter circle of radius 0.5 about the cell corner
(cx, cy) - which is the SAME curve MachineBatch.ts's belt shader already walks
for its flow band, so the geometry the fragment shader draws and the geometry
the item rides are one curve rather than two that happen to look alike.

The consequence a client must not miss: this arc is pi/4 = 0.7854 m long,
21.5% SHORTER than the 1.000 m straight tile. An item advanced at a constant
rate in tile fractions therefore speeds up through a corner. Parameterise by
arc length, not by fraction of a tile.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import belt_common as bc  # noqa: E402
import of_lib as of  # noqa: E402

# --- dimensions (metres), all shared with build_belt_segment.py -------------
# RN-1622: "shared with build_belt_segment.py" is now true. It used to mean
# "transcribed from", which is the thing belt_common exists to end.
W = L = bc.W
H = bc.H
DECK_TOP = bc.DECK_TOP
R_DECK_IN, R_DECK_OUT = 0.10, 0.90     # 0.80 m deck, centre line at r = 0.5
R_RAIL_OUT = 1.00                      # tangent to the cell edge, never past
RAIL_SEGS = 6                          # the deck's subdivision; see rail_arc
SLAT_COUNT = 9                         # 8 on the tile + 1 entering the inlet
SLAT_HALF_DEG = 4.5
SLAT_T = bc.SLAT_T
RIDE_TOP = bc.RIDE_TOP                 # 0.28, the surface cargo rests on
R_PATH = 0.50                          # centre-line radius, == the shader's
R_UNDER_IN = 0.14                      # under-frame inner radius

# FS-88. The corner bracket used to be 0.10 square, and the arc centre is its
# OUTER corner, so its far corner sat at 0.10 * sqrt(2) = 0.1414 from that
# centre: 1.4 mm outside the under-frame's own inner radius. Two parts on the
# ground plane, different materials, overlapping by a 1.4 mm crescent, and the
# depth test had to arbitrate it. The bracket is now sized so its diagonal
# fits INSIDE R_UNDER_IN with real margin (0.09 * sqrt(2) = 0.127), which is a
# derivation rather than a nudge: any POST_W under R_UNDER_IN / sqrt(2) works,
# and 0.09 is the roundest one.
POST_W = 0.09

# The state chip stops being an inlay flush with the outer rail's top face and
# becomes a LAMP UNDER THE RAIL'S LIP, exactly as on build_belt_segment.py and
# for the same reason: an inlay whose top face is on H is on the plane the
# rail's top face is on, both pointing up, and a flush inlay in a solid cannot
# be built without cutting the solid open. Cutting a 6-segment arc_band into
# three costs about 100 triangles and the curve tiles have 28 of headroom, so
# the notch that fixed the smelter's plinth is not affordable here. R_CHIP puts
# the lamp astride the outer rail's inner radius (0.90) so half of it overhangs
# the deck and is seen from beside the belt, which is where a belt is looked at
# from.
R_CHIP = 0.88
CHIP_Z = H - 0.0135                    # top at 0.293, under the 0.30 rail top


def _polar(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))


def build(name, out, cx, a_entry, a_exit, exit_x):
    """cx        arc centre X (the cell corner the tile turns about)
    a_entry   arc angle of the +Y inlet, degrees
    a_exit    arc angle of the side outlet
    exit_x    X of the outlet edge, for socket_belt_out"""
    cy = L * 0.5
    pitch = (a_exit - a_entry) / 8.0          # one slat, signed: +/- 11.25 deg
    a_mid = a_entry + (a_exit - a_entry) * 0.5
    sgn = 1.0 if cx > 0 else -1.0
    # The bracket's OUTER corner is the cell corner and the arc centre both, so
    # it is placed half its own width in from there on each axis.
    post = (cx - sgn * POST_W * 0.5, cy - POST_W * 0.5)
    # socket_status stays on the rail top at r = 0.95 where it has always been:
    # it is where a light MOUNTS, and moving a published socket to follow a
    # piece of geometry is a bigger change than this fix is allowed to be. The
    # lamp itself sits below and inboard of it.
    chip = _polar(cx, cy, 0.95, a_mid)
    lamp = _polar(cx, cy, R_CHIP, a_mid)

    of.reset_scene()
    root = of.add_root(name)

    # --- LOD0 ---
    mb0 = of.MeshBuilder()
    # RN-1622. THE OUTER RAIL STOPS BEING ONE SOLID ARC BAND. It is the same
    # fabricated section the straight tile has worn since RN-1563 - flanges top
    # and bottom, a 15 mm lightening pocket between them, a `SteelWorn` top
    # flange - swept along the turn instead of extruded along the flow, and it
    # comes from the same function so the two cannot drift.
    #
    # THE CURVE'S OUTER RAIL IS THE MOST-SEEN STEEL FACE ON THE TILE, for the
    # straight tile's own reason: r = 1.00 is tangent to the two far cell
    # edges, so this band IS the belt's silhouette through a corner, and a
    # corner is where a player's eye already goes. It was a plain extrusion
    # butting against a fabricated one, which read as two different products
    # bolted together.
    #
    # THE 15 mm POCKET COSTS THIS TILE'S SHADOW LADDER NOTHING, by the same
    # measurement that justified it on the straight tile: LOD1 keeps its solid
    # arc band, and cascade 0 is 15.47 mm per texel, so every vertex the
    # pocket adds is inside one texel of the proxy that already ships. The
    # tile's measured deviation is unchanged and so is its multiplier.
    bc.rail_arc(mb0, 0.90, R_RAIL_OUT, (cx, cy, 0.0), a_entry, a_exit,
                RAIL_SEGS, "Steel", "SteelWorn")
    mb0.box((POST_W, POST_W, H), (post[0], post[1], H * 0.5), "Steel")
    mb0.arc_band(R_UNDER_IN, 0.86, 0.12, (cx, cy, 0.06), a_entry, a_exit, 5,
                 "SteelDark")
    mb0.arc_band(R_DECK_IN, R_DECK_OUT, 0.06, (cx, cy, DECK_TOP - 0.03),
                 a_entry, a_exit, RAIL_SEGS, "Rubber")
    mb0.box((0.08, 0.08, 0.011), (lamp[0], lamp[1], CHIP_Z), "EmissiveState")
    mb0.build(name + "_LOD0", root)

    # --- LOD1: the turn still has to read, the under-frame does not ---
    mb1 = of.MeshBuilder()
    mb1.arc_band(0.90, R_RAIL_OUT, H, (cx, cy, H * 0.5), a_entry, a_exit, 3,
                 "Steel")
    mb1.box((POST_W, POST_W, H), (post[0], post[1], H * 0.5), "Steel")
    mb1.arc_band(R_DECK_IN, R_DECK_OUT, 0.06, (cx, cy, DECK_TOP - 0.03),
                 a_entry, a_exit, 3, "Rubber")
    mb1.box((0.08, 0.08, 0.011), (lamp[0], lamp[1], CHIP_Z), "EmissiveState")
    mb1.build(name + "_LOD1", root)

    # --- LOD2 ---
    mb2 = of.MeshBuilder()
    mb2.box((W, L, H), (0, 0, H * 0.5), "Steel")
    mb2.build(name + "_LOD2", root)

    # --- slat fan: a SIBLING of LOD0 so LOD0 stays exactly 1 x 1 x 0.30 and
    # the fan is free to overhang mid-loop, tucking under the next tile ---
    mbs = of.MeshBuilder()
    for k in range(SLAT_COUNT):
        a = a_entry + pitch * (k - 1)
        mbs.arc_band(0.14, 0.86, SLAT_T, (0.0, 0.0, DECK_TOP + SLAT_T * 0.5),
                     a - SLAT_HALF_DEG, a + SLAT_HALF_DEG, 1, "Rubber")
    slats = mbs.build(name + "_Slats", root)
    slats.location = (cx, cy, 0.0)      # rotate about the arc centre, not 0,0

    of.add_collision_box("col_" + name, (W, L, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_belt_in", (0.0, L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_in"})
    of.add_socket("socket_belt_out", (exit_x, 0.0, DECK_TOP), parent=root,
                  extras={"of_role": "belt_out"})
    # The item path, sampled off the SAME arc the deck is swept along, so no
    # number here is retyped from the socket_belt_* pair: entry, midpoint and
    # exit are _polar() at the entry, mid and exit angles of that one sweep.
    for sock, ang, role in (("socket_item_a", a_entry, "item_path_in"),
                            ("socket_item", a_mid, "item_ride"),
                            ("socket_item_b", a_exit, "item_path_out")):
        p = _polar(cx, cy, R_PATH, ang)
        of.add_socket(sock, (p[0], p[1], RIDE_TOP), parent=root,
                      extras={"of_role": role})
    of.add_socket("socket_status", (chip[0], chip[1], H), parent=root,
                  extras={"of_role": "state_light"})

    # Belt_Scroll: the fan turns exactly one slat pitch in 60 frames, so the
    # loop is seamless and the clip is 1.000 s. Same contract as the straight
    # tile, in degrees instead of metres: at r = 0.5 one pitch is 0.098 m, so
    # action.timeScale = beltSpeedMetresPerSecond / 0.098.
    # DW-8: this clip is preview and reference. The shipping renderer scrolls
    # a shared instanced material instead of running a mixer per belt.
    of.add_clip(slats, "Belt_Scroll", "rotation_euler",
                [(1, of.deg3(z=0.0)), (61, of.deg3(z=pitch))])

    of.report(name, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Slats", mbs)])
    of.export_glb(out, export_force_sampling=False)
