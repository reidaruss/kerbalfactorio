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
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

# --- dimensions (metres), all shared with build_belt_segment.py -------------
W = L = 1.00
H = 0.30
DECK_TOP = 0.25
R_DECK_IN, R_DECK_OUT = 0.10, 0.90     # 0.80 m deck, centre line at r = 0.5
R_RAIL_OUT = 1.00                      # tangent to the cell edge, never past
SLAT_COUNT = 9                         # 8 on the tile + 1 entering the inlet
SLAT_HALF_DEG = 4.5


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
    post = (cx - sgn * 0.05, cy - 0.05)       # inner corner bracket
    chip = _polar(cx, cy, 0.95, a_mid)

    of.reset_scene()
    root = of.add_root(name)

    # --- LOD0 ---
    mb0 = of.MeshBuilder()
    mb0.arc_band(0.90, R_RAIL_OUT, H, (cx, cy, H * 0.5), a_entry, a_exit, 6,
                 "Steel")
    mb0.box((0.10, 0.10, H), (post[0], post[1], H * 0.5), "Steel")
    mb0.arc_band(0.14, 0.86, 0.12, (cx, cy, 0.06), a_entry, a_exit, 5,
                 "SteelDark")
    mb0.arc_band(R_DECK_IN, R_DECK_OUT, 0.06, (cx, cy, DECK_TOP - 0.03),
                 a_entry, a_exit, 6, "Rubber")
    mb0.box((0.06, 0.06, 0.01), (chip[0], chip[1], H - 0.005), "EmissiveState")
    mb0.build(name + "_LOD0", root)

    # --- LOD1: the turn still has to read, the under-frame does not ---
    mb1 = of.MeshBuilder()
    mb1.arc_band(0.90, R_RAIL_OUT, H, (cx, cy, H * 0.5), a_entry, a_exit, 3,
                 "Steel")
    mb1.box((0.10, 0.10, H), (post[0], post[1], H * 0.5), "Steel")
    mb1.arc_band(R_DECK_IN, R_DECK_OUT, 0.06, (cx, cy, DECK_TOP - 0.03),
                 a_entry, a_exit, 3, "Rubber")
    mb1.box((0.06, 0.06, 0.01), (chip[0], chip[1], H - 0.005), "EmissiveState")
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
        mbs.arc_band(0.14, 0.86, 0.022, (0.0, 0.0, DECK_TOP + 0.011),
                     a - SLAT_HALF_DEG, a + SLAT_HALF_DEG, 1, "Rubber")
    slats = mbs.build(name + "_Slats", root)
    slats.location = (cx, cy, 0.0)      # rotate about the arc centre, not 0,0

    of.add_collision_box("col_" + name, (W, L, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_belt_in", (0.0, L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_in"})
    of.add_socket("socket_belt_out", (exit_x, 0.0, DECK_TOP), parent=root,
                  extras={"of_role": "belt_out"})
    item = _polar(cx, cy, 0.5, a_mid)
    of.add_socket("socket_item", (item[0], item[1], DECK_TOP + 0.03),
                  parent=root, extras={"of_role": "item_ride"})
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
